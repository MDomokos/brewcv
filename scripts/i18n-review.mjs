#!/usr/bin/env node
// node scripts/i18n-review.mjs <lang|all> [--out <dir>]     one review sheet (CSV) per language
// node scripts/i18n-review.mjs --apply <sheet.csv>           write its "corrected" column back
//
// A sheet has the columns key, english, current, corrected, note, sorted by key. Row 1 names the
// catalogue the sheet maps to. Fill in "corrected" where the current text is wrong and leave it
// empty where it's fine. A plural key is split in one row per form: `head.pages#one`, `head.pages#other`.
// --apply changes only the lines that were corrected and keeps the rest of the file as it was.
// It never changes the `review` marker: that stays 'machine' until a language is fully reviewed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const UI_LANGS = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu'];
const BOM = '﻿';

// --- CSV ------------------------------------------------------------------------------------
const cell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = rows => BOM + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
export function parseCsv(text){
  const rows = []; let row = [], cur = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++){
    const c = s[i];
    if (q){ if (c === '"'){ if (s[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ','){ row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r'){ if (c === '\r' && s[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length){ row.push(cur); rows.push(row); }
  return rows;
}

// --- the catalogues ---------------------------------------------------------------------------
const catalogue = async (root, lang) => (await import(pathToFileURL(path.join(root, `src/i18n/${lang}.js`)).href + `?t=${Date.now()}`)).default;
const flat = cat => Object.entries(cat).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : Object.entries(v).map(([f, s]) => [`${k}#${f}`, s])));
const holes = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
const quote = (s, q) => {
  const body = s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(new RegExp(q, 'g'), '\\' + q);
  return q + body + q;
};

export async function sheet(root, lang){
  const en = await catalogue(root, 'en'), cur = await catalogue(root, lang);
  const eng = new Map(flat(en)), now = new Map(flat(cur));
  const rows = [['file', `src/i18n/${lang}.js`, '', '', ''], ['key', 'english', 'current', 'corrected', 'note']];
  for (const k of [...eng.keys()].sort()) rows.push([k, eng.get(k), now.get(k) ?? '', '', '']);
  return toCsv(rows);
}

const LINE = /^(  )'([^']+)': (.*),$/;
const STR = /^(['"])((?:[^\\]|\\.)*?)\1$/;

// Returns { text, changed, skipped: [{ key, why }] }. Pure, so the test can run it on a copy.
export async function applyTo(root, csvText){
  const rows = parseCsv(csvText).filter(r => r.some(x => x !== ''));
  const m = /^src\/i18n\/(\w+)\.js$/.exec(rows[0]?.[0] === 'file' ? rows[0][1] : '');
  if (!m || !UI_LANGS.includes(m[1]) || m[1] === 'en') throw new Error('Row 1 should read: file, src/i18n/<lang>.js (not en)');
  const lang = m[1];
  const head = rows[1] ?? [];
  if (head.join() !== 'key,english,current,corrected,note') throw new Error('Row 2 should be the column names: key, english, current, corrected, note');
  const en = new Map(flat(await catalogue(root, 'en')));
  const fix = new Map(), skipped = [];
  for (const [key, , , corrected] of rows.slice(2)){
    if (!corrected?.trim()) continue;
    if (!en.has(key)){ skipped.push({ key, why: 'no such key' }); continue; }
    if (holes(corrected) !== holes(en.get(key))){ skipped.push({ key, why: `placeholders differ from English (${holes(en.get(key)) || 'none'})` }); continue; }
    fix.set(key, corrected);
  }
  const file = path.join(root, `src/i18n/${lang}.js`);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let changed = 0;
  const used = new Set();
  const out = lines.map(line => {
    const mm = LINE.exec(line);
    if (!mm) return line;
    const [, ind, key, lit] = mm;
    const sm = STR.exec(lit);
    if (sm){
      if (!fix.has(key)) return line;
      used.add(key);
      if (unescape(sm[2], sm[1]) === fix.get(key)) return line;
      changed++;
      return `${ind}'${key}': ${quote(fix.get(key), sm[1])},`;
    }
    if (!lit.startsWith('{')) return line;
    let touched = false;
    const next = lit.replace(/(\w+): (['"])((?:[^\\]|\\.)*?)\2/g, (all, form, q, body) => {
      const k = `${key}#${form}`;
      if (!fix.has(k)) return all;
      used.add(k);
      if (unescape(body, q) === fix.get(k)) return all;
      touched = true;
      return `${form}: ${quote(fix.get(k), q)}`;
    });
    if (touched) changed++;
    return touched ? `${ind}'${key}': ${next},` : line;
  });
  for (const k of fix.keys()) if (!used.has(k)) skipped.push({ key: k, why: 'not in the catalogue' });
  return { lang, file, text: out.join('\n'), changed, skipped };
}
// What a quoted JS literal means: \n, \\, the quote, and nothing else this catalogue uses.
const unescape = (s, q) => s.replace(/\\(n|\\|'|")/g, (m, c) => (c === 'n' ? '\n' : c));

// --- command line -----------------------------------------------------------------------------
async function main(argv){
  const apply = argv.indexOf('--apply');
  if (apply >= 0){
    const f = argv[apply + 1];
    if (!f) throw new Error('--apply needs a sheet: node scripts/i18n-review.mjs --apply out/i18n-review/hu.csv');
    const r = await applyTo(ROOT, fs.readFileSync(f, 'utf8'));
    fs.writeFileSync(r.file, r.text);
    console.log(`${r.lang}: ${r.changed} line(s) corrected in src/i18n/${r.lang}.js`);
    for (const s of r.skipped) console.log(`  skipped ${s.key}: ${s.why}`);
    console.log("The file still says review: 'machine'. Change that by hand when the whole language is reviewed.");
    return;
  }
  const oi = argv.indexOf('--out');
  const outDir = path.resolve(oi >= 0 ? argv[oi + 1] : path.join(ROOT, 'out/i18n-review'));
  const which = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out')[0];
  if (!which) throw new Error('Usage: node scripts/i18n-review.mjs <lang|all> [--out <dir>]   or   --apply <sheet.csv>');
  const langs = which === 'all' ? UI_LANGS.filter(l => l !== 'en') : [which];
  for (const l of langs) if (!UI_LANGS.includes(l) || l === 'en') throw new Error(`Not a translated language: ${l}`);
  fs.mkdirSync(outDir, { recursive: true });
  for (const l of langs){
    const f = path.join(outDir, `${l}.csv`);
    fs.writeFileSync(f, await sheet(ROOT, l));
    console.log(f);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
}
