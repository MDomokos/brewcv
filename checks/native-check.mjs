#!/usr/bin/env node
// node checks/native-check.mjs            the native form controls in src/ and index.html, against the list in checks/fixtures/native-controls.snapshot.json
// node checks/native-check.mjs --write    record the list (only when a control was added or taken out on purpose)
// UX-6f: a browser's own select list, date and month popup, colour picker and datalist cannot take the drink's tokens, so none of them may stay in
// the app's own screens. What remains must be listed here with what themes it:
//   select      shown as the app's own menu (src/ui/dropdown.js dresses every <select> that is drawn, hidden, as the field)
//   range       themed by accent-color and the page's color-scheme
//   file        a hidden input that only opens the system's file dialog: there is nothing of the browser's to theme
//   date, month, time, color, datetime-local, week, datalist, list=   none: monthpick.js (months and days), the hex field in Design, suggest.js
// A new native control, or one more of a kind, fails until it is themed or replaced and the list is written again.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SNAP = path.join(ROOT, 'checks/fixtures/native-controls.snapshot.json');
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };

const files = [];
const walk = dir => { for (const f of fs.readdirSync(dir, { withFileTypes: true })){ const p = path.join(dir, f.name); if (f.isDirectory()){ if (f.name !== 'i18n') walk(p); } else if (/\.(m?js|html)$/.test(f.name)) files.push(p); } };
walk(path.join(ROOT, 'src'));
for (const d of ['desktop']) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
files.push(path.join(ROOT, 'index.html'));

// comments are not controls
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
const IN = '<input\\b[^>]*?\\stype=(?:\\\\?["\']?)';      // an input's type attribute (not a selector such as :not([type=range]))
const KINDS = {
  select: /<select\b/g,
  datalist: /<datalist\b|<input\b[^>]*?\slist=/g,
  ...Object.fromEntries(['date', 'month', 'time', 'color', 'file', 'datetime-local', 'week', 'range'].map(k => [k, new RegExp(`${IN}${k}\\b`, 'g')])),
};
const found = {};
for (const f of files){
  const s = strip(fs.readFileSync(f, 'utf8')), rel = path.relative(ROOT, f);
  for (const [k, rx] of Object.entries(KINDS)){ const n = (s.match(rx) ?? []).length; if (n) (found[k] ??= {})[rel] = n; }
}

if (process.argv.includes('--write')){
  fs.writeFileSync(SNAP, JSON.stringify(found, null, 2) + '\n');
  console.log(`wrote ${Object.keys(found).length} kinds to checks/fixtures/native-controls.snapshot.json`);
  process.exit(0);
}

const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
const list = o => Object.entries(o).flatMap(([k, fs_]) => Object.entries(fs_).map(([f, n]) => `${k} ${f} x${n}`)).sort();
const now = list(found), was = list(snap);
const added = now.filter(x => !was.includes(x)), gone = was.filter(x => !now.includes(x));
ok('the native controls are the ones on the list (a new one: theme it or use the app\'s own, then --write)', !added.length && !gone.length, [...added.map(x => `new ${x}`), ...gone.map(x => `gone ${x}`)].join('; '));

// what themes each kind that is left
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const css = read('src/ui/workbench.css'), shell = read('src/ui/shell.js');
ok('no date, month, time, colour, datetime-local, week or datalist control is left: the browser\'s popup cannot be themed', ['date', 'month', 'time', 'color', 'datetime-local', 'week', 'datalist'].every(k => !found[k]), Object.keys(found).filter(k => !['select', 'range', 'file'].includes(k)).join());
ok('every select is dressed in the app\'s own menu: dropdown.js is started by the shell, and the select itself is hidden', /initDropdowns\(\)/.test(shell) && /select\[data-dd\]\s*\{\s*display:\s*none\s*!important/.test(css));
ok('a range is themed: accent-color for input[type=range]', /input\[type=range\][^{}]*\{[^}]*accent-color/.test(css));
ok('a file input is only the hidden one in index.html (it opens the system\'s dialog)', JSON.stringify(Object.keys(found.file ?? {})) === '["index.html"]' && /<input type="file"[^>]*\bhidden\b/.test(read('index.html')));
ok('the page follows the theme in its form controls: color-scheme light and dark on html[data-theme]', /html\[data-theme="light"\]\s*\{\s*color-scheme:\s*light/.test(css) && /html\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark/.test(css));

console.log(failed ? `\n${failed} native-control check(s) FAILED` : '\nall native-control checks passed');
process.exit(failed ? 1 : 0);
