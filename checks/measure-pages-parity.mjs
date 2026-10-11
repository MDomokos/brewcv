#!/usr/bin/env node
// node checks/measure-pages-parity.mjs <data.json> <recipe.json>
// measurePages() in src/render.js must agree with checks/pagefit.mjs: the fitter's "full" and the page-fit
// check's must be the same number. Fill must agree to 0.05 points, overflow exactly.
// Needs playwright and a Chromium. Writes only to out/, which is removed afterwards.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const [DATA, RECIPE] = process.argv.slice(2);
if (!DATA || !RECIPE){
  console.error('usage: node checks/measure-pages-parity.mjs <data.json> <recipe.json>');
  process.exit(2);
}
const rel = 'out/.parity.html';
const doc = path.join(REPO, rel);
execFileSync(process.execPath, [path.join(REPO, 'scripts/render.mjs'), DATA, RECIPE, doc, '--annotate'],
  { stdio: ['ignore', 'ignore', 'inherit'] });

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.woff2':'font/woff2', '.png':'image/png' };
const server = http.createServer((req, res) => {
  const f = path.join(REPO, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8097, r));

const exe = process.env.CHROME_PATH
  ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 }, bypassCSP: true });
await page.goto(`http://localhost:8097/${rel}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

const { theirs, ours } = await page.evaluate(async () => {
  // checks/pagefit.mjs, copied unchanged
  const theirs = [];
  document.querySelectorAll('.page').forEach((pg, i) => {
    const cs = getComputedStyle(pg);
    const padT = parseFloat(cs.paddingTop), padB = parseFloat(cs.paddingBottom);
    const usable = pg.getBoundingClientRect().height - padT - padB;
    const kids = [...pg.children].filter(el => {
      const pos = getComputedStyle(el).position;
      return pos !== 'absolute' && pos !== 'fixed';
    });
    const top = kids[0].getBoundingClientRect().top;
    const bottom = kids[kids.length - 1].getBoundingClientRect().bottom;
    const used = bottom - top;
    theirs.push({ page: i + 1, usable, used, fill: 100 * used / usable, overflow: pg.scrollHeight - pg.clientHeight });
  });
  const ours = (await import('/src/render.js')).measurePages(document.querySelector('.document'));
  return { theirs, ours };
});
await browser.close();
server.close();
fs.rmSync(doc, { force: true });

let bad = 0;
const flag = (cond, msg) => { if (!cond){ console.log(`  FAIL  ${msg}`); bad++; } };
console.log(`${path.basename(RECIPE)} · ${theirs.length} page(s)`);
if (theirs.length !== ours.length) flag(false, `pagefit sees ${theirs.length} pages, measurePages ${ours.length}`);
theirs.forEach((t, i) => {
  const o = ours[i];
  if (!o) return;
  console.log(`  page ${t.page}: pagefit ${t.fill.toFixed(2)}%  measurePages ${o.fill.toFixed(2)}%  · usable ${o.usable.toFixed(1)}px · body line ${o.lineH?.toFixed(2)}px · overflow ${o.overflow}px`
    + (o.overflowSection ? ` · overflow in ${o.overflowSection}` : ''));
  flag(Math.abs(t.fill - o.fill) < 0.05, `page ${t.page}: fill differs by ${(t.fill - o.fill).toFixed(3)}`);
  flag(Math.abs(t.usable - o.usable) < 0.05, `page ${t.page}: usable height differs`);
  flag(t.overflow === o.overflow, `page ${t.page}: overflow ${t.overflow} vs ${o.overflow}`);
  flag(Number.isFinite(o.lineH) && o.lineH > 0, `page ${t.page}: no body line height found`);
  flag(!(o.overflow > 0) || !!o.overflowSection, `page ${t.page}: overflows but no section is named`);
  flag(o.bands.length > 0 && o.bands.every(b => b.section), `page ${t.page}: a band has no section name`);
});
console.log(bad ? `\n${bad} problem(s).` : '\nmeasurePages agrees with pagefit.mjs.');
process.exit(bad ? 1 : 0);
