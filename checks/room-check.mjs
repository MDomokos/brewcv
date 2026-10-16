#!/usr/bin/env node
// node checks/room-check.mjs
// The sidebar's room and the layout around the page, as a test: on the example,
//  (d) at 1280×720, 1470×832 and 1200×750, how much of the open body's content is below its visible area (the scroll height beyond the
//      client height, as a share of the scroll height)? A job and Export show whole at every size; the rest are held to what they hide
//      in the 340px sidebar (LIMITS are the measured numbers).
//  (a) at 1280×720, 1470×832 and 1920×1080 no element outside the page layer is wider than half the window (no bar across the top),
//  (b) the page at fit fills the window's height less 32px, and
//  (c) the page's x is the same for nothing selected, a line, a job, Design, Export and back; writing a line zooms in, and the page is back
//      where it was at the page level.
// And the shape: the name card (name, Saved and menu, with Fit under them), the rail (logo, Edit, Design and Export, Resumes and Record, the page bars with
// undo and redo) and no footer: the editor card runs to the column's end. The sidebar is 340px (316 under 1400px), the rail 54px more.
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
// The sidebar is 340px (316px under 1400px windows), with no footer under it: at 1470×832 a line with its five versions, a job, Export, the Outline and a line
// being written show whole; Design (a form) hides its photo shape row and hint; at 1280×720 and 1200×750 the line, Design and the Outline scroll. LIMITS are the
// measured shares, in percent, for 1280×720, 1470×832 and 1200×750.  The line at 1470×832 hides 2.2% since the switch reads "Hide this line from this resume" (UX-6c-iv-b), which takes the row of its Keep and Archive buttons. The Outline keeps the sections that are off in their rows (UX-6c-iv-b stage 2), so at rest it hides 22.5%, 5.7% and 18.7% (12.8, 0 and 8.5 before).
const LIMITS = { line: [24.1, 2.2, 20.4], job: [0, 0, 0], design: [26.9, 6.6, 23.3], export: [0, 0, 0], outline: [22.6, 5.8, 18.8], writing: [0, 0, 0] };
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
    line: async () => { await frame.locator('.bullets li').first().click(); await page.keyboard.press('Escape'); },      // one click writes; Esc leaves the line selected
    job: async () => { await page.click('#outline [data-act=select-section][data-id=experience]'); await page.waitForTimeout(300); await page.locator('#body .jobname').first().click(); },      // by its name in the sidebar: a click on its title on the page writes it
    design: async () => { await page.click('#tab-design'); },
    export: async () => { await page.click('#tab-export'); },
    outline: async () => { await frame.locator('.bullets li').first().click(); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); },
    writing: async () => { await frame.locator('.bullets li').nth(1).click(); await page.waitForTimeout(500); },
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
    // a line chosen with the arrow keys is selected, not written: the page stays; one written on the page zooms, and is back at the page level
    await page.mouse.move(4, 4); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(400); xs.push((await pageRect(page)).left);
    const chose = await page.evaluate(() => window.__wb.ui.sel.kind === 'bullet' && !window.__wb.ui.writing);
    await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await frame.locator('.bullets li').first().click(); await page.waitForTimeout(500);
    const zoomed = (await pageRect(page)).width > r0.width + 1;
    await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(700); xs.push((await pageRect(page)).left);
    ok(`${w}×${h}: writing a line zooms in, and Esc to the page brings the page back`, zoomed && Math.abs(xs.at(-1) - r0.left) < 0.5);
    await page.click('#outline [data-act=select-section][data-id=experience]'); await page.waitForTimeout(300); await page.locator('#body .jobname').first().click(); await page.waitForTimeout(400); xs.push((await pageRect(page)).left);      // a job, by its name in the sidebar (a click on its title would write it, and zoom)
    await page.click('#tab-design'); await page.waitForTimeout(400); xs.push((await pageRect(page)).left);
    await page.click('#tab-export'); await page.waitForTimeout(400); xs.push((await pageRect(page)).left);
    await page.click('#tab-edit'); await page.waitForTimeout(400); xs.push((await pageRect(page)).left);
    ok(`${w}×${h}: the page's x is the same for nothing selected, a line, a job, Design, Export and Edit`, chose && Math.max(...xs) - Math.min(...xs) < 0.5, xs.map(x => x.toFixed(1)).join(' '));
  } catch (e){ ok(`${w}×${h}: the layout measures`, false, String(e.message ?? e).split('\n')[0].slice(0, 100)); }
  await ctx.close();
}
{
  const { ctx, page } = await open(1470, 832);
  try {
    const shape = await page.evaluate(() => {
      const r = s => document.querySelector(s)?.getBoundingClientRect();
      const col = r('#col'), rail = r('#rail'), body = r('#body'), head = r('#head'), tab = r('#tab-edit');
      return {
        tabs: !!document.querySelector('#tabs'), folded: !!document.querySelector('.is-folded'),
        segs: [...document.querySelectorAll('#rail [role=tab]')].map(b => b.dataset.m),
        tablist: document.querySelector('#rail [role=tablist]'),
        segRole: document.querySelector('#rail [role=tablist]')?.getAttribute('aria-label') ?? null,
        vertical: document.querySelector('#rail [role=tablist]')?.getAttribute('aria-orientation'),
        headTabs: document.querySelectorAll('#head [role=tab]').length,
        head: ['switcher', 'menu', 'fit', 'save-file', 'undo', 'redo', 'drink-switch'].filter(a => document.querySelector(`#head [data-act="${a}"]`)),
        railActs: [...document.querySelectorAll('#rail [data-act]')].map(b => b.dataset.act),
        screens: [...document.querySelectorAll('#rail .scr')].map(b => ({ act: b.dataset.act, name: b.getAttribute('aria-label'), tip: !!b.dataset.tip, text: b.textContent.trim() })),
        footShown: !!document.querySelector('#foot')?.getClientRects().length,
        bodyBottom: body.bottom, colBottom: col.bottom,
        barsText: document.querySelector('#rail .meters').textContent.trim(), barsInHist: !!document.querySelector('#rail .rhist .meters'),
        meterNames: [...document.querySelectorAll('#rail .meter')].map(b => b.getAttribute('aria-label') ?? ''),
        fitRect: r('#head .fit'), savedRect: r('#head .savestate'), menuRect: r('#head [data-act=menu]'), nameRect: r('#docname'),
        zoombar: [...document.querySelectorAll('#zoombar [data-act]')].map(b => b.dataset.act),
        widths: { col: col.width, rail: rail.width, gap: col.left - rail.right, tabTouches: Math.abs(tab.right - body.left) < 1.5, tabInside: tab.top >= body.top && tab.bottom <= body.bottom, nameAbove: head.bottom <= body.top },
        saveInExport: null,
      };
    });
    ok('no old tabs and no fold', !shape.tabs && !shape.folded);
    ok('the rail has Edit, Design and Export as a vertical, labelled tab list; the head has no tabs', shape.segs.join() === 'edit,design,export' && !!shape.segRole && shape.vertical === 'vertical' && shape.headTabs === 0, shape.segs.join());
    ok('the sidebar is 340px (316 under 1400px) with a 54px rail touching it; the first tab touches the editor card, inside its height; the name card is above it', shape.widths.col === 340 && shape.widths.rail === 54 && Math.abs(shape.widths.gap) < 1 && shape.widths.tabTouches && shape.widths.tabInside && shape.widths.nameAbove, JSON.stringify(shape.widths));
    ok('the name card has the name, Saved, the menu and Fit; Save to file, undo, redo and the logo are not in it', shape.head.join() === 'switcher,menu,fit', shape.head.join());
    const sr = shape.savedRect, mr = shape.menuRect, fr = shape.fitRect, nr = shape.nameRect, hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    ok('Fit is in the name card under Saved and the menu, overlapping neither them nor the name', fr.top >= Math.max(sr.bottom, mr.bottom) - 1 && !hit(fr, sr) && !hit(fr, mr) && !hit(fr, nr) && fr.right <= mr.right + 1, JSON.stringify([fr, sr, mr, nr]));
    ok('the rail has the logo (the drink switch), the tabs, Resumes and Record, undo and redo', ['drink-switch', 'mode', 'sw-manage', 'sw-record', 'undo', 'redo'].every(a => shape.railActs.includes(a)), shape.railActs.join());
    ok('Resumes and Record are icon only buttons with a name and a tip', shape.screens.length === 2 && shape.screens.every(x => x.name && x.tip && x.text === ''), JSON.stringify(shape.screens));
    ok('there is no footer: the editor card runs to the column\'s end', !shape.footShown && Math.abs(shape.bodyBottom - shape.colBottom) < 1.5, `${shape.bodyBottom} ${shape.colBottom}`);
    ok('the page bars are in the rail beside undo and redo: one thin bar for each page, no text, each named with its page, fill and state', shape.barsInHist && shape.meterNames.length >= 1 && shape.barsText === '' && shape.meterNames.every(n => /\d/.test(n) && n.length > 10), shape.meterNames.join(' | '));
    ok('Actual size is on the zoom bar', shape.zoombar.includes('actual'), shape.zoombar.join());
    // the tab list: the arrow keys (up and down) move between the tabs and open them
    await page.focus('#tab-edit'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300);
    ok('the arrow keys move down Edit, Design, Export and open each', await page.evaluate(() => document.activeElement.id === 'tab-design' && window.__wb.ui.view === 'design'));
    await page.keyboard.press('End'); await page.waitForTimeout(300);
    ok('End goes to Export, Home to Edit', await page.evaluate(() => document.activeElement.id === 'tab-export' && window.__wb.ui.view === 'export'));
    ok('Save to file is in the Export panel, with where the file stands', await page.evaluate(() => !!document.querySelector('#body #filestate[data-act=save-file]') && /file/i.test(document.querySelector('#fileline')?.textContent ?? '')));
    await page.keyboard.press('Home'); await page.waitForTimeout(300);
    ok('Home goes to Edit', await page.evaluate(() => document.activeElement.id === 'tab-edit' && !window.__wb.ui.view));
  } catch (e){ ok('the sidebar has the new shape', false, String(e.message ?? e).split('\n')[0].slice(0, 100)); }
  await ctx.close();
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} room check(s) FAILED` : '\nall room checks passed');
process.exit(failed ? 1 : 0);
