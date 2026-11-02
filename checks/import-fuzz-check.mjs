#!/usr/bin/env node
// node checks/import-fuzz-check.mjs     (SEED=n picks another run; PER=n variants a file, default 12)
// Damaged files must not hang the import or throw what nobody planned. Each committed fixture (PDF, DOCX, ODT) and a few backups of the example record are damaged a few hundred ways with a fixed seed
// (cut short, bytes flipped, a range zeroed, a range duplicated, a PDF's xref number broken, a ZIP's central directory cut or an entry dropped, JSON nested 20,000 deep or with a value replaced), and each
// is run through identify, the readers, parseResume, readImport, readBackup and merge. Pass: every variant ends within the time limit, and the only errors are coded ones (a string `code` from
// the readers, a string `key` from the model). Under a minute.
// shortcut: the time limit is measured after a variant ends, so a loop that never ends hangs the check instead of failing it (the runner's own timeout then reports it); run the variants in a worker if that happens.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { identify } from '../src/parse/identify.js';
import { readDocx } from '../src/parse/docx.js';
import { readOdt } from '../src/parse/odt.js';
import { readHtml } from '../src/parse/html.js';
import { readMd } from '../src/parse/md.js';
import { readTxt } from '../src/parse/txt.js';
import { readPages } from '../src/parse/pages.js';
import { readLinkedin } from '../src/parse/linkedin.js';
import { readPdf } from '../src/parse/pdf.js';
import { parseResume } from '../src/parse/index.js';
import { readImport } from '../src/model/import.js';
import { makeBackup, readBackup } from '../src/store/persist.js';
import { merge } from '../src/model/merge.js';
import { readLibrary, readRecipe } from '../scripts/lib/library.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIX = path.join(REPO, 'checks/fixtures/import');
const SEED = Number(process.env.SEED ?? 4), PER = Number(process.env.PER ?? 12), LIMIT = 8000;

// a small seeded generator (mulberry32): the same damage every run
let a = SEED >>> 0;
const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = n => Math.floor(rnd() * n);

const damage = {
  truncate: b => b.slice(0, 1 + int(b.length - 1)),
  flip: b => { const c = b.slice(); for (let k = 0, n = 1 + int(40); k < n; k++) c[int(c.length)] ^= 1 << int(8); return c; },
  zero: b => { const c = b.slice(), at = int(c.length), n = 1 + int(Math.min(2000, c.length)); c.fill(0, at, at + n); return c; },
  duplicate: b => { const at = int(b.length), n = 1 + int(Math.min(20000, b.length - at)); return Uint8Array.from([...b.subarray(0, at + n), ...b.subarray(at, at + n), ...b.subarray(at + n)]); },
  xref: b => { const t = Buffer.from(b).toString('latin1'), m = /startxref\s+(\d+)/.exec(t); return m ? Buffer.from(t.replace(m[0], `startxref\n${int(b.length * 2)}`), 'latin1') : b.slice(0, b.length - 30); },
  zipcut: b => { const c = Buffer.from(b); const end = c.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1')); return end < 0 ? b.slice(0, b.length >> 1) : Uint8Array.from([...c.subarray(0, Math.max(0, end - 46 * (1 + int(3)))), ...c.subarray(end)]); },
  nest: b => { const t = Buffer.from(b).toString('utf8'); const at = t.indexOf(':'); return at < 0 ? b : Buffer.from(t.slice(0, at + 1) + '['.repeat(20000) + t.slice(at + 1)); },
};
// JSON with one value replaced by something that is not what the model expects
const WEIRD = [null, 0, -1, 1e999, 'x'.repeat(100000), [], {}, [[]], { a: 1 }, true, '', 'x', [null], { variants: 5 }];
function weirdJson(obj){
  const c = structuredClone(obj), paths = [];
  (function walk(o, p){ if (o && typeof o === 'object') for (const k of Object.keys(o)){ paths.push([...p, k]); walk(o[k], [...p, k]); } })(c, []);
  const p = paths[int(paths.length)], parent = p.slice(0, -1).reduce((o, k) => o[k], c);
  parent[p.at(-1)] = WEIRD[int(WEIRD.length)];
  return Buffer.from(JSON.stringify(c));
}

// the example record and two of its saved resumes, as a backup
const lib = readLibrary(path.join(REPO, 'data/example.json')).model;
const resumes = ['Helix Diagnostics - Product Development Engineer.json', 'Feinmess Instrumente GmbH - Konstrukteur.json'].map(f => ({ ...readRecipe(path.join(REPO, 'data/example-resumes', f), lib).recipe, id: f.slice(0, -5) }));
const state = { record: lib, resumes, frozen: {} };
const backup = Buffer.from(JSON.stringify(makeBackup(state)));
const goodState = readBackup(JSON.parse(backup)).state;

const coded = e => typeof e?.code === 'string' || typeof e?.key === 'string';
async function exercise(bytes, name){
  const kind = identify(bytes, name);
  let items;
  if (kind === 'pdf') items = await readPdf(bytes);
  else if (kind === 'pages') items = await readPdf(await readPages(bytes));
  else if (kind === 'docx') items = await readDocx(bytes);
  else if (kind === 'odt') items = await readOdt(bytes);
  else if (kind === 'html') items = readHtml(bytes);
  else if (kind === 'md') items = readMd(bytes);
  else if (kind === 'txt') items = readTxt(bytes);
  else if (kind === 'linkedin') await readLinkedin(bytes);
  else if (kind === 'json'){
    const text = new TextDecoder().decode(bytes), got = readImport(text, name);
    if (got.kind === 'backup'){
      const theirs = readBackup(got.json);
      merge({ state: goodState, clock: { keys: {}, seen: {} } }, { state: theirs.state, clock: theirs.info.clock });
    }
  }
  if (items){ parseResume(items); parseResume(items, undefined, [{ page: 1, headerBottom: 700, split: 300 }]); }
}

const inputs = [...fs.readdirSync(FIX).filter(f => /\.(pdf|docx|odt)$/.test(f)).sort().map(f => [f, fs.readFileSync(path.join(FIX, f)), Object.keys(damage).filter(k => k !== 'nest')]), ['backup.json', backup, ['truncate', 'flip', 'zero', 'duplicate', 'nest', 'weird']]];
let runs = 0, slow = [], bad = [];
const t0 = Date.now();
for (const [name, bytes, ops] of inputs){
  const n = name === 'backup.json' ? PER * 6 : name.endsWith('.pdf') ? PER - 2 : PER;
  for (let k = 0; k < n; k++){
    const op = ops[(k + int(ops.length)) % ops.length], damaged = op === 'weird' ? weirdJson(JSON.parse(backup)) : damage[op](new Uint8Array(bytes)), start = Date.now();
    try { await exercise(damaged, name); } catch (e){ if (!coded(e)) bad.push(`${name} ${op} #${k}: ${e?.name}: ${String(e?.message).slice(0, 100)}${process.env.STACK ? '\n' + String(e?.stack).split('\n').slice(1, 4).join('\n') : ''}`); }
    const ms = Date.now() - start;
    if (ms > LIMIT) slow.push(`${name} ${op} #${k}: ${ms} ms`);
    runs++;
  }
}
console.log(`${bad.length || slow.length ? 'FAIL' : 'PASS'}  ${runs} damaged variants of ${inputs.length} files (seed ${SEED}) end within ${LIMIT} ms and throw only coded errors  — ${Date.now() - t0} ms${bad.length ? `\n      uncaught: ${bad.slice(0, 8).join('\n                ')}` : ''}${slow.length ? `\n      slow: ${slow.slice(0, 8).join('; ')}` : ''}`);
const hurt = JSON.parse(backup); hurt.record.variants = [null, 5]; hurt.record.facts = 'x'; hurt.resumes = [7];
const door = readImport(JSON.stringify(hurt), 'b.json'), threw = (() => { try { readBackup(hurt); return null; } catch (e){ return e; } })();
console.log(`${typeof door.kind === 'string' && threw?.key === 'error.notBackup' ? 'PASS' : 'FAIL'}  a backup damaged inside (a list holding null, a number where a list goes) is a result from readImport and the keyed error "not a backup" from readBackup, not a TypeError  — ${door.kind} ${threw?.name}`);
if (!(typeof door.kind === 'string' && threw?.key === 'error.notBackup')) bad.push('door');
const clean = [['a file that is not damaged runs clean through every reader', await Promise.all(inputs.map(([name, bytes]) => exercise(new Uint8Array(bytes), name).then(() => true, () => false))).then(r => r.every(Boolean))]];
for (const [what, good] of clean) console.log(`${good ? 'PASS' : 'FAIL'}  ${what}`);
process.exit(bad.length || slow.length || !clean.every(([, g]) => g) ? 1 : 0);
