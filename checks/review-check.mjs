#!/usr/bin/env node
// node checks/review-check.mjs
// The Review list's layout: at 1280×720, 1470×832, 1920×1080 and on a phone (390 wide), in all ten interface languages, with a row of every kind
// (a sub-version with Update, a new version that needs a source, a line only on this resume, a heading, newer wording) and a long source typed:
//   - the dialog is inside the window (a full-screen sheet on a phone), the page behind it does not scroll sideways,
//   - no row, button, select or input runs out of its box, no two controls overlap, and the footer buttons stay in view,
//   - the body scrolls inside the dialog when the rows do not fit, so the footer is never pushed off the window.
// Chromium through Playwright (PW_BUNDLED=1, or CHROME_PATH); writes nothing.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8144);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});

const LANGS = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu'].filter(l => !ONLY || ONLY.has(l));
const SIZES = [[1280, 720], [1470, 832], [1920, 1080], [390, 780]];
const settle = page => page.waitForFunction(() => !window.__wb.busy(), null, { timeout: 10000 }).then(() => page.waitForTimeout(150));

const PROBE = `(() => {
  const d = document.querySelector('#review'), out = [];
  const lab = el => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 30);
  const R = d.getBoundingClientRect();
  if (R.left < -1 || R.top < -1 || R.right > innerWidth + 1 || R.bottom > innerHeight + 1) out.push('the dialog is outside the window');
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push('the page scrolls sideways');
  const foot = d.querySelector('.rvfoot').getBoundingClientRect();
  if (foot.bottom > innerHeight + 1 || foot.bottom > R.bottom + 1) out.push('the footer is pushed out');
  const body = d.querySelector('.rvbody');
  if (body.scrollWidth > body.clientWidth + 1) out.push('the body scrolls sideways');
  for (const row of d.querySelectorAll('.rvrow')){
    const r = row.getBoundingClientRect();
    if (row.scrollWidth > row.clientWidth + 1) out.push('a row runs out of its box');
    for (const c of row.querySelectorAll('button, select, input')){ const q = c.getBoundingClientRect(); if (!q.width && !q.height) continue; /* a select is hidden: its button is the control (dropdown.js) */ if (q.right > r.right + 1 || q.left < r.left - 1) out.push(lab(c) + ' runs out of its row'); }
  }
  // a control scrolled partly out of the body is only what shows: its box is cut to the body's
  const B = body.getBoundingClientRect();
  const box = e => { const r = e.getBoundingClientRect(); if (!body.contains(e)) return r; const l = Math.max(r.left, B.left), t = Math.max(r.top, B.top), rr = Math.min(r.right, B.right), bb = Math.min(r.bottom, B.bottom); return { left: l, top: t, right: rr, bottom: bb, width: rr - l, height: bb - t }; };
  const ctl = [...d.querySelectorAll('button, select, input')].filter(e => box(e).width > 0 && box(e).height > 0);
  for (const e of ctl){ if (e.scrollWidth > e.clientWidth + 1 && e.tagName === 'BUTTON') out.push(lab(e) + ' is cut'); }
  for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++){
    const p = box(ctl[i]), q = box(ctl[j]);
    if (Math.min(p.right, q.right) - Math.max(p.left, q.left) > 1.5 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 1.5) out.push(lab(ctl[i]) + ' / ' + lab(ctl[j]) + ' overlap');
  }
  return [...new Set(out)];
})()`;

for (const [w, h] of SIZES){
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { (localStorage.setItem('rb-help-seen', '1'), localStorage.setItem('rb-esc-fold', 'off')); } catch { /* none */ } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await settle(page);
  await page.evaluate(async () => {
    const T = await import('/src/model/resume.js'), s = window.__wb.store.state, ids = T.listedBullets(s.record, s.cur, 'hydra');
    window.__wb.store.commit(d => {
      d.record.requireSource = true;
      for (const v of d.record.variants) if (v.id.startsWith(ids[0] + '-v')) v.source = 'Lab notebook p. 4';
      T.setOverride(d.record, d.cur, ids[0], T.textOf(d.record, ids[0], d.cur).replace(/\b(\d)(\d{2}),000/, '$1$2,500'), { marks: [], base: null });
      T.setOverride(d.record, d.cur, ids[1], 'Rebuilt the whole rig from scratch around a new fixture and a new plan for the supplier audits, with a very long second sentence that goes on and on so that the row has to wrap in every language.', { marks: [], base: null });
      const n = T.addLocalLine(d.record, d.cur, 'hydra', ids[1]);
      T.setOverride(d.record, d.cur, n, 'Wrote the supplier audit checklist.', { marks: [], base: null });
      T.setSectionLabel(d.record, d.cur, 'experience', 'en', 'Work history');
      d.cur.held = [ids[2], ids[3]]; d.cur.overrides[ids[2]] = 'Older words for this line.'; d.cur.overrides[ids[3]] = 'Older words for this other line.';      // two, so Use all the newer wording shows
    }, 'review-check: edits');
  });
  await settle(page);
  for (const lang of LANGS){
    await page.evaluate(async l => { const I = await import('/src/i18n/index.js'); await I.loadCatalogue(l); await I.setUiLang(l); }, lang);
    await page.evaluate(() => window.__wb.review.open());
    await page.waitForSelector('#review[open] .rvrow');
    const src = page.locator('#review [data-rv-src]').first();
    if (await src.count()) await src.fill('A long source: the supplier audit file, section 12, page 3, signed by the quality manager and kept in the shared drive.');
    await page.waitForTimeout(100);
    const kinds = await page.$$eval('#review .rvrow', r => [...new Set(r.map(x => x.dataset.kind))].sort().join(''));
    const bad = await page.evaluate(PROBE);
    ok(`${w}×${h} ${lang}: the Review list (rows ${kinds}): inside the window, nothing cut, overlapping or pushed out`, kinds === 'eln' && bad.length === 0, bad.slice(0, 3).join(' ; '));
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !window.__wb.review.isOpen);
  }
  ok(`${w}×${h}: no page errors`, errs.length === 0, errs[0] ?? '');
  await ctx.close();
}
await browser.close(); server.close();
console.log(failed ? `\n${failed} review check(s) FAILED` : '\nall review checks passed');
process.exit(failed ? 1 : 0);
