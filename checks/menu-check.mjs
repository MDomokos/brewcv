#!/usr/bin/env node
// node checks/menu-check.mjs
// The editor menu's layout (UX-6c-iv-a), in Chromium on the example:
//  - a desktop has no footer: nothing is drawn under the editor card, which runs to the column's end, at three window sizes;
//  - Fit is in Export only, at the top beside the page bars (the name card has neither Fit nor Saved); its chip (after a Fit that changed something) hangs right under it with no error, and Ctrl+Z undoes;
//  - the page bars at the top of Export: a click on a bar of a two-page resume brings that page forward, the "+n" goes to the first page not drawn;
//  - the Outline's counts read n/m, with the words in the tip and for a screen reader;
//  - an open section is a container (a real group, its own surface and border, no accent bar) that a closed one is not, in the four looks;
//  - a job's or section's name in the Outline wraps without an ellipsis, in ten languages.
// PW_BUNDLED=1, or CHROME_PATH. Writes nothing.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8144);
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
  await ctx.addInitScript(([d, t]) => { try { (localStorage.setItem('rb-help-seen', '1'), localStorage.setItem('rb-esc-fold', 'off')); if (d) { localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); } } catch { /* none */ } }, look);
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  return { ctx, page };
};
const rect = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);

// ---- no footer ----
for (const [w, h] of [[1280, 720], [1470, 832], [1920, 1080]]){
  const { ctx, page } = await open(w, h);
  const col = await rect(page, '#col'), body = await rect(page, '#body');
  const foot = await page.evaluate(() => { const f = document.querySelector('#foot'); return !!f && (f.getClientRects().length > 0 || f.children.length > 0); });
  ok(`${w}×${h}: there is no footer, and the editor card reaches the column's bottom`, !foot && Math.abs(body.bottom - col.bottom) < 1.5, `${body.bottom} ${col.bottom}`);
  ok(`${w}×${h}: the name card has neither Fit nor Saved: Fit is not on the page until Export is open`, !(await page.$('#head [data-act=fit], #head .savestate, [data-act=fit]')) && !!(await page.$('#rail .rhist .savestate')));
  await page.evaluate(() => window.__wb.setView('export')); await page.waitForTimeout(300);
  ok(`${w}×${h}: Fit is once, at the top of Export, beside the page bars`, (await page.$$('[data-act=fit]')).length === 1 && !!(await page.$('#body .exfit [data-act=fit]')) && !!(await page.$('#body .exfit .meter')) && !(await page.$('#head [data-act=fit], #rail [data-act=fit]')));
  await ctx.close();
}

// ---- the Fit chip ----
{
  const { ctx, page } = await open(1470, 832);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(() => window.__wb.setView('export'));
  await page.evaluate(async () => {
    const T = await import('/src/model/resume.js');
    window.__wb.store.commit(d => { for (const w of d.record.work) for (const hl of (w.highlights ?? [])) { try { T.setBulletOn(d.record, d.cur, hl.id ?? hl, true); } catch { /* archived */ } } }, 'check: all lines');
  });
  await page.waitForTimeout(900);
  const before = await page.evaluate(() => window.__wb.store.history.undo);
  await page.click('#body [data-act=fit]');
  await page.waitForFunction(() => !window.__wb.ui.fitting, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  const chip = await rect(page, '.fitchip'), fit = await rect(page, '#body [data-act=fit]'), col = await rect(page, '#col');
  ok('the Fit chip appears right under the Fit button in Export, inside the column, is a status, and shows without an error', !!chip && chip.top >= fit.bottom && chip.top - fit.bottom < 16 && chip.left >= col.left && chip.right <= col.right + 1 && (await page.getAttribute('.fitchip', 'role')) === 'status' && errors.length === 0, JSON.stringify([chip, fit, errors]));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(500);
  ok('Ctrl+Z undoes the Fit, and the chip goes', (await page.evaluate(() => window.__wb.store.history.undo)) <= before + 1 && !(await page.$('.fitchip')) && (await page.evaluate(() => window.__wb.store.history.redo)) >= 1);
  await ctx.close();
}

// ---- a click on a page bar ----
{
  const { ctx, page } = await open(1280, 800);
  await page.click('#docname-btn'); await page.fill('#switcher #sw-q', 'Medtech'); await page.click('#switcher .sopt:has-text("Medtech")'); await page.waitForTimeout(1200);
  await page.evaluate(() => window.__wb.setView('export')); await page.waitForTimeout(300);
  const n = await page.$$eval('#body .exfit .meter', ms => ms.length);
  await page.click('#body .exfit .meter[data-page="1"]'); await page.waitForTimeout(900);
  ok('Export shows one bar for each of the two pages, and a click on page 2’s bar brings page 2 forward', n === 2 && (await page.evaluate(() => window.__wb.ui.page)) === 1 && (await page.getAttribute('#body .exfit .meter[data-page="1"]', 'aria-current')) === 'true');
  await page.click('#body .exfit .meter[data-page="0"]'); await page.waitForTimeout(900);
  ok('…and a click on page 1’s goes back', (await page.evaluate(() => window.__wb.ui.page)) === 0);
  await page.evaluate(() => { const u = window.__wb.ui; u.fills = Array.from({ length: 5 }, (_, i) => ({ page: i + 1, used: 90, usable: 100, overflow: 0 })); window.__wb.dock.renderFoot(); });
  ok('five pages: three bars and a "+2" that goes to the fourth', (await page.$$eval('#body .exfit .meter', ms => ms.length)) === 3 && (await page.textContent('#body .exfit .rmore')) === '+2' && (await page.getAttribute('#body .exfit .rmore', 'data-page')) === '3');
  await ctx.close();
}

// ---- the Outline: counts, containers, names ----
for (const [drink, theme] of [['tea', 'light'], ['tea', 'dark'], ['coffee', 'light'], ['coffee', 'dark']]){
  const { ctx, page } = await open(1280, 720, [drink, theme]);
  const tag = `${drink} ${theme}`;
  const counts = await page.evaluate(() => [...document.querySelectorAll('#outline .osec .scount, #outline .clcount')].map(e => ({ vis: e.querySelector('[aria-hidden=true]')?.textContent ?? e.textContent, sr: e.querySelector('.sr')?.textContent ?? '', tip: e.querySelector('[title]')?.title ?? e.title })).filter(c => c.vis));
  ok(`${tag}: the counts read n/m, and say "n of m on" in the tip and to a screen reader`, counts.length >= 4 && counts.filter(c => /^\d+\/\d+$/.test(c.vis)).every(c => /^\d+ of \d+ on$/.test(c.sr) && c.sr === c.tip) && counts.some(c => /^\d+\/\d+$/.test(c.vis)), JSON.stringify(counts.slice(0, 3)));
  await page.click('[data-act=ol-toggle][data-g="sec:skills"]'); await page.waitForTimeout(400);
  const look = await page.evaluate(() => {
    const cs = e => getComputedStyle(e), open = document.querySelector('#outline .osec.open[data-sid=skills]'), shut = document.querySelector('#outline .osec:not(.open)'), head = open?.querySelector(':scope > .srow');
    if (!open || !shut) return null;
    return { role: open.getAttribute('role'), name: open.getAttribute('aria-label'), expanded: open.querySelector('[data-act=ol-toggle]')?.getAttribute('aria-expanded'),
      openBg: cs(open).backgroundColor, openBorder: cs(open).borderLeftWidth, openBorderColor: cs(open).borderLeftColor, headBg: cs(head).backgroundColor, shutBg: cs(shut).backgroundColor, shutBorder: cs(shut).borderLeftColor === 'rgba(0, 0, 0, 0)' ? '0' : cs(shut).borderLeftWidth, shutExpanded: shut.querySelector('[data-act=ol-toggle]')?.getAttribute('aria-expanded'),
      gap: parseFloat(cs(open).marginTop) };
  });
  // (UX-6 sidebar, audit (c)): one sign of containment, the flat card: its edge and surface; the accent bar and the tinted header said it twice more.
  // Round 2 (item 16): the open section's head had a quiet band in its kind's colour (at most 12%); round 3's design pass: every section's head is a band of its kind's hue (one of six), opaque; a closed
  // section's 1 px edge is transparent (it keeps the tick column).
  const quiet = c => c === 'rgba(0, 0, 0, 0)' || (+(/\/ ([\d.]+)\)$/.exec(c)?.[1] ?? /rgba\([^)]*, ([\d.]+)\)$/.exec(c)?.[1] ?? 1)) <= 0.12;
  ok(`${tag}: an open section is a container: a group with a name, aria-expanded on its header, an edge and a surface that a closed one does not have, no accent bar, its head a band of its kind's hue (round 3's design pass: it was a quiet 12% band on the open one only)`, !!look && look.role === 'group' && !!look.name && look.expanded === 'true' && look.shutExpanded === 'false' && parseFloat(look.openBorder) === 1 && parseFloat(look.shutBorder) === 0 && look.openBg !== look.shutBg && look.headBg !== 'rgba(0, 0, 0, 0)' && look.gap >= 4, JSON.stringify(look));
  await ctx.close();
}
{
  const { ctx, page } = await open(1280, 720);
  const bad = [];
  for (const lang of ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu']){
    await page.evaluate(async l => { const I = await import('/src/i18n/index.js'); await I.loadCatalogue(l); window.__wb.ui.pref = { mode: 'fixed', lang: l }; window.__wb.store.commit(d => { d.cur.name = 'x'; }, 'name'); }, lang);
    await page.waitForTimeout(400);
    for (const open of [false, true]) {
      if (open) await page.click('#outline [data-act=select-section][data-id=experience]').catch(() => {});
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => [...document.querySelectorAll('#outline .srow .t, #outline .jtl, #outline .clname:not(:has(.jtl)), #body .jobname .jtl')].filter(e => e.getClientRects().length).map(e => {
        const s = getComputedStyle(e); return { t: e.textContent.trim().slice(0, 24), ell: s.textOverflow === 'ellipsis' && (s.whiteSpace === 'nowrap' || s.overflow === 'hidden'), cut: e.scrollWidth > e.clientWidth + 1 }; }).filter(x => x.ell || x.cut));
      bad.push(...r.map(x => `${lang}: ${x.t}`));
    }
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  }
  ok('a job’s or section’s name in the Outline and a section’s view wraps, never an ellipsis, in ten languages', bad.length === 0, [...new Set(bad)].slice(0, 4).join(' ; '));
  await ctx.close();
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} menu check(s) FAILED` : '\nall menu checks passed');
process.exit(failed ? 1 : 0);
