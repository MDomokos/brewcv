#!/usr/bin/env node
// node checks/desktop-check.mjs
// The desktop build ships a copy of the app (scripts/desktop-stage.mjs). Every module the app imports, statically or on
// demand, must be in that copy, and every example name must already be NFC, or Tauri cannot find the file.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DIRS, FILES, IPC } from '../scripts/desktop-stage.mjs';

let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };

const graph = new Set();
(function walk(file){
  const rel = path.relative(ROOT, file);
  if (graph.has(rel)) return;
  graph.add(rel);
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^(?:import|export)[^;]*?from\s+'(\.[^']+)'/gm)) walk(path.resolve(path.dirname(file), m[1]));
  for (const m of src.matchAll(/\bimport\('(\.[^']+)'\)/g)) walk(path.resolve(path.dirname(file), m[1]));
})(path.join(ROOT, 'src/ui/shell.js'));

const covered = f => FILES.includes(f) || DIRS.some(d => f.startsWith(`${d}/`));
const missing = [...graph].filter(f => !covered(f));
ok('the stage script copies every module shell.js imports', !missing.length, missing.join(', '));
ok('the imports from outside src/ are the ones it lists', [...graph].filter(f => !f.startsWith('src/')).sort().join() === FILES.filter(f => /\.mjs$/.test(f)).sort().join(),
  [...graph].filter(f => !f.startsWith('src/')).join(', '));
ok('every file it names exists', FILES.every(f => fs.existsSync(path.join(ROOT, f))));

const names = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/example-resumes/index.json'), 'utf8'));
const bad = names.filter(n => n !== n.normalize('NFC'));
ok('every name in data/example-resumes/index.json is NFC', !bad.length, bad.join(', '));

const csp = /connect-src[^;]*/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'))?.[0];
ok("the web build's connect-src is still 'self' only (the desktop copy alone adds the IPC schemes)", csp === "connect-src 'self'" && IPC.startsWith(csp));
// The export is one HTML page with its CSS and fonts inlined (inline <style>, data: fonts). The print window writes it into itself, so
// its own CSP must allow those, or the PDF comes out as unstyled serif text; scripts stay limited to this app's files.
const printCsp = fs.readFileSync(path.join(ROOT, 'desktop/print.html'), 'utf8').match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
ok('the print window lets the export keep its inline styles, data: fonts and images', /style-src[^;]*'unsafe-inline'/.test(printCsp) && /font-src[^;]*data:/.test(printCsp) && /img-src[^;]*data:/.test(printCsp), printCsp);
ok('…and still allows script only from the app\'s own files', /script-src 'self'(;|$)/.test(printCsp));
process.exit(failed ? 1 : 0);
