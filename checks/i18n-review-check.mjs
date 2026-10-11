#!/usr/bin/env node
// node checks/i18n-review-check.mjs
// scripts/i18n-review.mjs on a temporary copy of the catalogues: the sheet, and --apply changing only
// the lines that were corrected.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const S = await import(pathToFileURL(path.join(ROOT, 'scripts/i18n-review.mjs')).href);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-review-'));
fs.mkdirSync(path.join(tmp, 'src'));
fs.cpSync(path.join(ROOT, 'src/i18n'), path.join(tmp, 'src/i18n'), { recursive: true });
const huFile = path.join(tmp, 'src/i18n/hu.js');
const before = fs.readFileSync(huFile, 'utf8');
const read = async () => (await import(pathToFileURL(huFile).href + `?t=${Math.random()}`)).default;
const hu = await read();
const en = (await import(pathToFileURL(path.join(ROOT, 'src/i18n/en.js')).href)).default;

const csv = await S.sheet(tmp, 'hu');
ok('the sheet starts with a byte order mark', csv.charCodeAt(0) === 0xFEFF);
const rows = S.parseCsv(csv);
ok('row 1 names the file, row 2 the columns', rows[0][1] === 'src/i18n/hu.js' && rows[1].join() === 'key,english,current,corrected,note');
const keys = rows.slice(2).map(r => r[0]);
ok('rows are sorted by key', keys.every((k, i) => !i || keys[i - 1] <= k));
ok('every key of English is a row (a plural as one row per form)', rows.length - 2 === Object.values(en).reduce((n, v) => n + (typeof v === 'string' ? 1 : Object.keys(v).length), 0));
const multi = rows.find(r => r[1].includes('\n'));
ok('a text with line breaks survives the CSV', multi && multi[1] === en[multi[0]]);

const none = await S.applyTo(tmp, csv);
ok('a sheet with nothing corrected changes nothing', none.text === before && none.changed === 0);

// correct a plain string, a plural form, a text with a line break, and try one that drops a placeholder
const plain = 'head.notSaved', plural = 'head.pages#other', brk = multi[0], withHole = 'undo.language';
const edit = (k, v) => rows.find(r => r[0] === k)[3] = v;
edit(plain, 'Még nincs mentve'); edit(plural, '{n} oldal (javítva)'); edit(brk, `Első sor ${(en[brk].match(/\{\w+\}/g) ?? []).join(' ')}\nMásodik "sor" it's`); edit(withHole, 'Nyelv');
const done = await S.applyTo(tmp, S.toCsv(rows));
fs.writeFileSync(huFile, done.text);
const after = await read();
ok('the corrected string is in the catalogue', after[plain] === 'Még nincs mentve');
ok('the corrected plural form is in, its other forms untouched', after['head.pages'].other === '{n} oldal (javítva)' && after['head.pages'].one === hu['head.pages'].one);
ok('quotes and line breaks are escaped so the file still loads', after[brk].includes('\nMásodik "sor" it\'s') && after[brk].startsWith('Első sor'));
ok('a correction that drops a placeholder is refused, and said so', after[withHole] === hu[withHole] && done.skipped.some(s => s.key === withHole));
const a = before.split('\n'), b = done.text.split('\n');
ok('only the three corrected lines changed; same line count', a.length === b.length && a.filter((l, i) => l !== b[i]).length === 3 && done.changed === 3);
ok("the review marker is still 'machine'", /^export const review = 'machine';$/m.test(done.text) && /NEEDS A NATIVE REVIEW/.test(done.text.split('\n')[0]));
const other = fs.readFileSync(path.join(tmp, 'src/i18n/de.js'), 'utf8') === fs.readFileSync(path.join(ROOT, 'src/i18n/de.js'), 'utf8');
ok('no other catalogue was touched', other);

const bad = S.parseCsv(csv); bad[0][1] = 'src/i18n/en.js';
let refused = false; try { await S.applyTo(tmp, S.toCsv(bad)); } catch { refused = true; }
ok('a sheet for English is refused', refused);

const outDir = path.join(tmp, 'out');
execFileSync('node', [path.join(ROOT, 'scripts/i18n-review.mjs'), 'hu', '--out', outDir]);
ok('the command line writes <out>/hu.csv', fs.existsSync(path.join(outDir, 'hu.csv')));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nAll i18n review checks pass.');
process.exit(failed ? 1 : 0);
