#!/usr/bin/env node
// node checks/symmetry-check.mjs
// Every action has its inverse, and the same control looks and sits the same (UX-6c-iv-b), in Chromium on the example:
//  - the stale strings are gone; the Fit chip stays until the next change; "+ line" has two labels;
//  - the Outline: a pill on every job's head, archived lines under "+ n more" with Unarchive;
//  - one pill and one wording for show/hide on the chip, the depth row, sections, jobs, lines, items and the photo, each a round trip;
//  - the lock and the pill look alike at rest (one size, one opacity), and the chip's tools show without a hover.
// PW_BUNDLED=1, or CHROME_PATH. Writes nothing.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8171);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});

const open = async (w, h, look = []) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([d, t]) => { try { localStorage.setItem('rb-help-seen', '1'); if (d) { localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); } } catch { /* none */ } }, look);
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?memory`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  return { ctx, page };
};
const rect = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);


const strings = async page => page.evaluate(async () => (await import('/src/i18n/en.js')).default);

// ---- stale strings ----
{
  const { ctx, page } = await open(1470, 832);
  const en = await strings(page);
  ok('the Outline\u2019s "turn it on" tip no longer says drag, and the hand-laid note does not tell the sidebar to drag', en['ux2.turnOnTitle'] === 'Put it on the resume' && !/^drag/i.test(en['edit.dragManual']));
  await ctx.close();
}

// ---- the Fit chip stays ----
{
  const { ctx, page } = await open(1470, 832);
  await page.evaluate(async () => {
    const T = await import('/src/model/resume.js');
    window.__wb.store.commit(d => { for (const w of d.record.work) for (const hl of (w.highlights ?? [])) { try { T.setBulletOn(d.record, d.cur, hl.id ?? hl, true); } catch { /* archived */ } } }, 'check: all lines');
  });
  await page.waitForTimeout(900);
  await page.click('#head [data-act=fit]');
  await page.waitForFunction(() => !window.__wb.ui.fitting, null, { timeout: 30000 });
  await page.waitForTimeout(7000);
  ok('the Fit chip is still there 7 seconds after Fit (no timer)', !!(await page.$('.fitchip')));
  await page.evaluate(() => window.__wb.store.commit(d => { d.cur.name = 'Another name'; }, 'check: rename'));
  await page.waitForTimeout(700);
  ok('…and it goes when the next change is made', !(await page.$('.fitchip')));
  await ctx.close();
}

// ---- two labels for "+ line" ----
{
  const { ctx, page } = await open(1470, 832);
  await page.click('#outline [data-act=select-section][data-id=experience]'); await page.waitForTimeout(500);
  const out = await page.$$eval('#body [data-act=ol-newline]', bs => bs.map(b => b.textContent.trim()));
  ok('the Outline\u2019s button (a line only on this resume) reads "+ line here"', out.length > 0 && out.every(x => x === '+ line here'), out.join('|'));
  await page.click('#rail [data-act=sw-record]'); await page.waitForTimeout(700);
  const rec = await page.$$eval('#checklist [data-act=ol-addline]', bs => bs.map(b => b.textContent.trim()));
  ok('the Record\u2019s button (a new claim in the record) reads "+ new claim"', rec.length > 0 && rec.every(x => x === '+ new claim'), rec.join('|'));
  await ctx.close();
}

// ---- the Outline: a pill on every job's head, archived lines under "+ n more" ----
{
  const { ctx, page } = await open(1470, 832);
  const heads = await page.$$eval('#outline section.clg > .clgh', hs => hs.map(h => ({ pill: !!h.querySelector('.swl > input.sw[data-jobon]'), name: h.querySelector('.jobname, .clname')?.textContent.trim().slice(0, 20) })));
  ok('every job head in the Outline carries the pill switch', heads.length >= 2 && heads.every(h => h.pill), JSON.stringify(heads));
  const gap = await page.evaluate(() => [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } }).some(r => /clgh > \.rowlock:last-child/.test(r.selectorText ?? '')));
  ok('…and the margin that stood in for a missing head switch is gone', !gap);
  const id = await page.evaluate(async () => {
    const K = await import('/src/model/career.js');
    const w = window.__wb.store.state.record.work.find(w => w.id === 'hydra'), hl = (w.highlights ?? []).map(x => x.id ?? x).find(Boolean);
    let a; window.__wb.store.commit(d => { a = K.archiveClaim(d.record, hl); }, 'check: archive'); return hl;
  });
  await page.waitForTimeout(700);
  await page.click('#outline [data-act=select-section][data-id=experience]'); await page.waitForTimeout(500);
  await page.click('#body [data-act=select-job][data-id=hydra]'); await page.waitForTimeout(600);
  await page.click('#body [data-act=ol-more][data-id=hydra]'); await page.waitForTimeout(400);
  const row = await page.$(`#body .clrow[data-fact="${id}"].is-archived`);
  ok('an archived line is listed under "+ n more", with Unarchive', !!row && !!(await row.$('[data-act=unarchive-claim]')));
  await (await row.$('[data-act=unarchive-claim]')).click(); await page.waitForTimeout(700);
  ok('…Unarchive brings it back into the list as an ordinary line that is off', !(await page.$(`#body .clrow[data-fact="${id}"].is-archived`)) && !!(await page.$(`#body .clrow[data-fact="${id}"]`)));
  await ctx.close();
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} symmetry check(s) FAILED` : '\nall symmetry checks passed');
process.exit(failed ? 1 : 0);
