#!/usr/bin/env node
// node checks/measure-variants.mjs <data.json> <recipe.json> [--probe] [--write]
// Lays the recipe out in a browser, counts the line boxes each phrasing occupies at that column width and
// caches it in metrics.measured. The counting and the cache key live in src/render.js, which the app uses too.
// --probe measures every phrasing in the recipe's language, one pass per k (src/render.js probeCount), so
// the fitter never has to estimate. It renders a measuring document, so the recipe is not touched.
// Without --write it reports and changes nothing.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { applyMeasured, measureKey, probeCount } from '../src/render.js';
import { readLibrary, readRecipe, writeLibrary } from '../scripts/lib/library.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const argv = process.argv.slice(2);
const write = argv.includes('--write');
const probe = argv.includes('--probe');
const [DATA, RECIPE] = argv.filter(a => !a.startsWith('--'));
if (!DATA || !RECIPE){
  console.error('usage: node checks/measure-variants.mjs <data.json> <recipe.json> [--probe] [--write]');
  process.exit(2);
}

const { recipe } = readRecipe(RECIPE);
const key = measureKey(recipe);
const data = readLibrary(DATA).model;
const passes = probe ? probeCount(data, recipe) : 1;
const slug = key.replace(/[^a-z0-9@-]/gi, '_');
const relOf = k => `out/.measure-${slug}${probe ? `-p${k}` : ''}.html`;

// data-variant attributes cannot affect layout, so this lays out exactly like the document that gets sent
for (let k = 0; k < passes; k++)
  execFileSync(process.execPath,
    [path.join(REPO, 'scripts/render.mjs'), DATA, RECIPE, path.join(REPO, relOf(k)), '--annotate',
     ...(probe ? ['--probe', String(k)] : [])],
    { stdio: ['ignore', 'ignore', 'inherit'] });

// served rather than opened from file://, so the page can import the renderer
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.woff2':'font/woff2', '.png':'image/png' };
const server = http.createServer((req, res) => {
  const f = path.join(REPO, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8098, r));

const exe = process.env.CHROME_PATH
  ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 }, bypassCSP: true });

const measurement = { colWidth: null, lines: {} };
const widths = new Set();
for (let k = 0; k < passes; k++){
  await page.goto(`http://localhost:8098/${relOf(k)}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(async () =>
    (await import('/src/render.js')).measureVariants(document.querySelector('.document')));
  widths.add(m.colWidth);
  measurement.colWidth = m.colWidth;
  Object.assign(measurement.lines, m.lines);
}
await browser.close();
server.close();
for (let k = 0; k < passes; k++) fs.rmSync(path.join(REPO, relOf(k)), { force: true });
if (widths.size > 1){
  console.error(`the column was ${[...widths].join(' and ')}px across passes; a probe has to measure at one width. Nothing written.`);
  process.exit(1);
}

const before = new Map((data.variants ?? []).map(v => [v.id, v.metrics?.measured?.[key]]));
const written = applyMeasured(data, key, measurement, recipe.date ?? undefined);

const moved = written.filter(id => {
  const was = before.get(id);
  return was && (was.lines !== measurement.lines[id] || was.colWidth !== measurement.colWidth);
});
console.log(`${key} · column ${measurement.colWidth}px · ${written.length} phrasings measured`
  + (probe ? ` over ${passes} pass${passes === 1 ? '' : 'es'}` : ''));
const hist = {};
for (const id of written) hist[measurement.lines[id]] = (hist[measurement.lines[id]] ?? 0) + 1;
console.log('  lines: ' + Object.entries(hist).map(([n, c]) => `${c}×${n}`).join('  '));
for (const id of moved)
  console.log(`  changed: ${id}  ${before.get(id).lines}→${measurement.lines[id]} lines`
    + (before.get(id).colWidth !== measurement.colWidth ? ` (column ${before.get(id).colWidth}→${measurement.colWidth}px)` : ''));

if (probe){
  // the probe cannot see a phrasing no section prints (e.g. an alternate summary): say so
  const lang = recipe.lang ?? 'en';
  const missing = (data.variants ?? []).filter(v => (v.lang ?? 'en') === lang && !(v.id in measurement.lines));
  console.log(missing.length
    ? `  ${missing.length} ${lang} phrasing(s) are printed by no section and stay estimated: ${missing.slice(0, 8).map(v => v.id).join(', ')}${missing.length > 8 ? ', …' : ''}`
    : `  every ${lang} phrasing is measured`);
}

if (!write){ console.log(`\nnothing written; pass --write to cache this in ${path.basename(DATA)}`); process.exit(0); }
writeLibrary(DATA, data);       // resume-data/4; a v3 original is kept once as .v3.json
console.log(`\nwrote metrics.measured["${key}"] for ${written.length} variants into ${DATA}`);
