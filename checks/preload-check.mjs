#!/usr/bin/env node
// node checks/preload-check.mjs
// index.html preloads the app's static import graph so the browser fetches it in parallel.
// The list must be exactly what src/ui/shell.js imports (statically, or on demand with import('./x.js')), or a new module loads late (or a
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
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^import[^;]*?from\s+'(\.[^']+)'/gm)) walk(path.resolve(path.dirname(file), m[1]));
  // a module loaded on demand (the tea garden) is still preloaded, so it is there the moment it can run
  for (const m of src.matchAll(/\bimport\('(\.[^']+\.js)'\)/g)) walk(path.resolve(path.dirname(file), m[1]));
})(path.join(ROOT, 'src/ui/shell.js'));

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const listed = new Set([...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(m => m[1]));
const missing = [...graph].filter(f => !listed.has(f)), extra = [...listed].filter(f => !graph.has(f));
ok('every module shell.js imports is preloaded', !missing.length, missing.join(', '));
ok('nothing else is preloaded', !extra.length, extra.join(', '));
ok('the service worker caches each of them', [...graph].every(f => fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes(`'./${f}'`)));
// The first paint is a page of its own (a blank page and the column's frame, drawn from the markup and the stylesheets before any script runs). The one script that
// blocks it, the drink and theme setter, is asked for before the module list: behind seventy modules it arrived last, and the first paint waited for all of them.
const at = s => html.indexOf(s);
ok('the head’s only blocking script, drink-boot.js, comes after the stylesheets and before the module list', at('src/ui/drink-boot.js') > at('src/ui/flow.css') && at('src/ui/drink-boot.js') < at('rel="modulepreload"'));
ok('the first-paint page is in the markup: a blank page, the column’s frame with the name and three grey lines', /class="paper-skel"/.test(html) && /<header id="head"[^>]*>.*BrewCV/.test(html) && (html.match(/class="skel-line"/g) ?? []).length === 3);
ok('the app starts after the markup (a module script, last in the body) and the start screen’s own stage is not in the markup', html.lastIndexOf('<script type="module" src="src/ui/shell.js">') > at('</main>') && !/id="ss"/.test(html));
process.exit(failed ? 1 : 0);
