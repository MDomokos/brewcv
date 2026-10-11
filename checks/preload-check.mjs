#!/usr/bin/env node
// node checks/preload-check.mjs
// index.html preloads the app's static import graph so the browser fetches it in parallel.
// The list must be exactly what src/ui/shell.js imports, or a new module loads late (or a
// removed one is fetched for nothing).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };

const graph = new Set();
(function walk(file){
  const rel = path.relative(ROOT, file);
  if (graph.has(rel)) return;
  graph.add(rel);
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/^import[^;]*?from\s+'(\.[^']+)'/gm)) walk(path.resolve(path.dirname(file), m[1]));
})(path.join(ROOT, 'src/ui/shell.js'));

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const listed = new Set([...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(m => m[1]));
const missing = [...graph].filter(f => !listed.has(f)), extra = [...listed].filter(f => !graph.has(f));
ok('every module shell.js imports is preloaded', !missing.length, missing.join(', '));
ok('nothing else is preloaded', !extra.length, extra.join(', '));
ok('the service worker caches each of them', [...graph].every(f => fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes(`'./${f}'`)));
process.exit(failed ? 1 : 0);
