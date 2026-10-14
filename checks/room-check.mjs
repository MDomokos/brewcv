#!/usr/bin/env node
// node checks/room-check.mjs
// The sidebar's room and the layout around the page, as a test: on the example,
//  (d) at 1280×720, 1470×832 and 1200×750, how much of the open body's content is below its visible area (the scroll height beyond the
//      client height, as a share of the scroll height)? Everything shows whole at every size except a line's
//      versions, which may hide 7.8% at 1280×720 and 3.1% at 1200×750 (LIMITS are the measured numbers).
//  (a) at 1280×720, 1470×832 and 1920×1080 no element outside the page layer is wider than half the window (no bar across the top),
//  (b) the page at fit fills the window's height less 32px, and
//  (c) the page's x is the same for nothing selected, a line, a job, Design, Export and back.
// And the shape: no tabs, a head with undo, redo, the menu and Edit, Design and Export, a foot with the meters and Fit and nothing else.
// Chromium through Playwright (PW_BUNDLED=1, or CHROME_PATH); writes only to out/.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8141);
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

// the share of the body that is hidden: the scroll height beyond the client height, of the scroll height
const hidden = page => page.evaluate(() => {
  const e = document.querySelector('#body');
  return e.scrollHeight <= e.clientHeight + 2 ? 0 : (e.scrollHeight - e.clientHeight) / e.scrollHeight;
});
// (1470×832 is the size the sidebar must fit whole; at 1280×720 and 1200×750 only a line's versions run a little past the fold)
const LIMITS = { line: [7.8, 0, 3.1], job: [0, 0, 0], design: [0, 0, 0], export: [0, 0, 0], outline: [0, 0, 0], writing: [0, 0, 0] };
const SIZES = [[1280, 720], [1470, 832], [1200, 750]];

for (const [i, [w, h]] of SIZES.entries()){
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() => { try { localStorage.setItem('rb-help-seen', '1'); } catch { /* none */ } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?memory`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const frame = page.frameLocator('#sheet iframe');
  const rest = async () => { await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await page.waitForTimeout(300); };
  const states = {
    line: async () => { await frame.locator('.bullets li').first().click(); },
    job: async () => { await frame.locator('.role-title').first().click(); },
    design: async () => { await page.click('#tab-design'); },
    export: async () => { await page.click('#tab-export'); },
    outline: async () => { await frame.locator('.bullets li').first().click(); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); },
    writing: async () => { await frame.locator('.bullets li').nth(1).dblclick(); await page.waitForTimeout(500); },
  };
  for (const [name, go] of Object.entries(states)){
    let share = null, err = '';
    try { await rest(); await go(); await page.waitForTimeout(600); share = await hidden(page); } catch (e){ err = String(e.message ?? e).split('\n')[0].slice(0, 90); }
    const limit = LIMITS[name][i];
    ok(`${w}×${h}: ${name} hides ${share == null ? 'unknown' : `${(share * 100).toFixed(1)}%`} of the body (at most ${limit}%)`, share != null && share * 100 <= limit + 1e-9, err);
  }
  await ctx.close();
}

// ---- (a) (b) (c) and the shape ----
const open = async (w, h) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() => { try { localStorage.setItem('rb-help-seen', '1'); } catch { /* none */ } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?memory`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  return { ctx, page };
};
const pageRect = page => page.evaluate(() => { const b = window.__wb.sheet.pageBoxes()[0]; const r = window.__wb.canvas.screenRect(b); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
for (const [w, h] of [[1280, 720], [1470, 832], [1920, 1080]]){
  const { ctx, page } = await open(w, h);
  const frame = page.frameLocator('#sheet iframe');
  try {
    // (a) every box that is not the page layer or the garden: none is wider than half the window
    const wide = await page.evaluate(() => [...document.body.querySelectorAll('*')]
      .filter(e => !e.closest('#pages, #garden, .g-dapple, #startstage, #motionlay, script, #tip') && e.getClientRects().length)
      .filter(e => { const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'contents' && s.opacity !== '0'; })
      .map(e => [e, e.getBoundingClientRect()]).filter(([e, r]) => r.width > 0.5 * innerWidth && r.height > 0 && !['HTML', 'BODY'].includes(e.tagName))
      .map(([e, r]) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''} ${Math.round(r.width)}px`));
    ok(`${w}×${h}: no element outside the page is wider than half the window`, wide.length === 0, wide.slice(0, 4).join(', '));
    // (b) the page at fit
    const r0 = await pageRect(page);
    ok(`${w}×${h}: the page fills the height less at most 32px (${r0.height.toFixed(0)} of ${h})`, r0.height >= h - 32 - 1 && r0.height <= h);
    // (c) the page's x for every selection and sheet
    const xs = [r0.left];
    await frame.locator('.bullets li').first().click(); await page.waitForTimeout(400); xs.push((await pageRect(page)).left);
    await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await frame.locator('.role-title').first().click(); await page.waitForTimeout(400); xs.push((await pageRect(page)).left);
    await page.click('#tab-design'); await page.waitForTimeout(400); xs.push((await pageRect(page)).left);
    await page.click('#tab-export'); await page.waitForTimeout(400); xs.push((await pageRect(page)).left);
    await page.click('#tab-edit'); await page.waitForTimeout(400); xs.push((await pageRect(page)).left);
    ok(`${w}×${h}: the page's x is the same for nothing selected, a line, a job, Design, Export and Edit`, Math.max(...xs) - Math.min(...xs) < 0.5, xs.map(x => x.toFixed(1)).join(' '));
  } catch (e){ ok(`${w}×${h}: the layout measures`, false, String(e.message ?? e).split('\n')[0].slice(0, 100)); }
  await ctx.close();
}
{
  const { ctx, page } = await open(1470, 832);
  try {
    const shape = await page.evaluate(() => ({
      tabs: !!document.querySelector('#tabs'), folded: !!document.querySelector('.is-folded'),
      segs: [...document.querySelectorAll('#head [role=tab]')].map(b => b.dataset.m),
      oneRow: (() => { const a = document.querySelector('#head .seg').getBoundingClientRect(), b = document.querySelector('#docname-btn').getBoundingClientRect(); const h = document.querySelector('#head').getBoundingClientRect(); return a.bottom <= h.top + 52 && b.bottom <= h.top + 52 && h.height < 60; })(),
      segRole: document.querySelector('#head [role=tablist]')?.getAttribute('aria-label') ?? null,
      head: ['undo', 'redo', 'menu', 'save-file', 'drink-switch'].filter(a => document.querySelector(`#head [data-act="${a}"]`)),
      foot: [...document.querySelectorAll('#foot button')].map(b => b.dataset.act),
      zoombar: [...document.querySelectorAll('#zoombar [data-act]')].map(b => b.dataset.act),
    }));
    ok('no tabs and no fold', !shape.tabs && !shape.folded);
    ok('the head has Edit, Design and Export as a labelled tab list', shape.segs.join() === 'edit,design,export' && !!shape.segRole, shape.segs.join());
    ok('the segmented control sits on the first row beside the name; the head is one row tall', shape.oneRow);
    ok('the head has the logo, Save to file, undo, redo and the menu', shape.head.length === 5, shape.head.join());
    ok('the foot has the page meters and Fit, nothing else', shape.foot.length >= 2 && shape.foot.every(a => a === 'goto-page' || a === 'fit') && shape.foot.at(-1) === 'fit', shape.foot.join());
    ok('Actual size is on the zoom bar', shape.zoombar.includes('actual'), shape.zoombar.join());
    // the head's tab list: arrow keys move between the tabs and open them
    await page.focus('#tab-edit'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
    ok('the arrow keys move along Edit, Design, Export and open each', await page.evaluate(() => document.activeElement.id === 'tab-design' && window.__wb.ui.view === 'design'));
  } catch (e){ ok('the sidebar has the new shape', false, String(e.message ?? e).split('\n')[0].slice(0, 100)); }
  await ctx.close();
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} room check(s) FAILED` : '\nall room checks passed');
process.exit(failed ? 1 : 0);
