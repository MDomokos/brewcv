#!/usr/bin/env node
// node checks/room-check.mjs
// The sidebar's room and the layout around the page, as a test: on the example,
//  (d) at 1280×720, 1470×832 and 1200×750, how much of the open body's content is below its visible area (the scroll height beyond the
//      client height, as a share of the scroll height)? A job and Export show whole at every size; the rest are held to what they hide
//      in the sidebar (LIMITS are the measured numbers).
//  (a) at 1280×720, 1470×832 and 1920×1080 no element outside the page layer is wider than half the window (no bar across the top),
//  (b) the page at fit fills the window's height less 32px, and
//  (c) the page's x is the same for nothing selected, a line, a job, Design, Export and back; writing a line zooms in, and the page is back
//      where it was at the page level.
// And the shape: the place tabs, the name card (the name and the menu), the history card (undo, redo, Saved and the fold chevron at the rail's foot; Content and Look joined to the
// panel; the logo at the foot) and no footer: the editor card runs to the column's end. The sidebar is what sideWidth says (316 to 520px, and up to 100px more for a
// resume limited to one page), the rail 54px more.
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
// measured shares, in percent, for 1280×720, 1470×832 and 1200×750.  The line at 1470×832 hides 2.2% since the switch reads "Hide this line from this resume", which takes the row of its Keep and Archive buttons. The Outline keeps the sections that are off in their rows, so at rest it hides 22.5%, 5.7% and 18.7% (12.8, 0 and 8.5 before). A job's employer wraps under its title instead of being cut: 6.1% at 1470×832. The panel's foot (a 42 px band the rows scroll under, where the "?" stands) takes 28 px more than the old bottom padding: the Outline 23.5, 9.3, 19.7, Design 9.6 at 1470×832. The Outline's sections are headings (14.5 px, a 16 px chip, a 20 px tick, a 33 px row): 25.4, 11.5, 21.7. The name card is one large button with its own padding (the button system): with that the Outline 26.1, 12.2, 22.4, Design 10.3 at 1470×832.
const LIMITS = { line: [24.1, 2.2, 20.4], job: [3.5, 0, 0], design: [26.9, 10.3, 23.3], export: [0, 0, 0], outline: [26.1, 12.2, 22.4], writing: [0, 0, 0] };
const SIZES = [[1280, 720], [1470, 832], [1200, 750]];

for (const [i, [w, h]] of SIZES.entries()){
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() => { try { (localStorage.setItem('rb-help-seen', '1'), localStorage.setItem('rb-esc-fold', 'off')); } catch { /* none */ } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const frame = page.frameLocator('#sheet iframe');
  const rest = async () => { await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await page.waitForTimeout(300); };
  const states = {
    line: async () => { await frame.locator('.bullets li').first().click(); await page.keyboard.press('Escape'); },      // one click writes; Esc leaves the line selected
    job: async () => { await page.click('#outline [data-act=select-section][data-id=experience]'); await page.waitForTimeout(300); await page.locator('#body .jobname').first().click(); },      // by its name in the sidebar: a click on its title on the page writes it
    design: async () => { await page.click('#tab-design'); },
    export: async () => { await page.evaluate(() => window.__wb.export.open()); },
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
  await ctx.addInitScript(() => { try { (localStorage.setItem('rb-help-seen', '1'), localStorage.setItem('rb-esc-fold', 'off')); } catch { /* none */ } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
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
    await page.evaluate(() => window.__wb.export.open()); await page.waitForTimeout(400);      // Export is a place of its own, with a wider column: the page moves there
    await page.evaluate(() => window.__wb.export.back()); await page.waitForTimeout(400); xs.push((await pageRect(page)).left);
    await page.click('#tab-edit'); await page.waitForTimeout(400); xs.push((await pageRect(page)).left);
    ok(`${w}×${h}: the page's x is the same for nothing selected, a line, a job, Design, back from Export and Edit`, chose && Math.max(...xs) - Math.min(...xs) < 0.5, xs.map(x => x.toFixed(1)).join(' '));
  } catch (e){ ok(`${w}×${h}: the layout measures`, false, String(e.message ?? e).split('\n')[0].slice(0, 100)); }
  await ctx.close();
}
{
  const { ctx, page } = await open(1470, 832);
  try {
    const shape = await page.evaluate(async () => {
      const { sideWidth } = await import('/src/ui/layout.js');
      const r = s => document.querySelector(s)?.getBoundingClientRect();
      const col = r('#col'), rail = r('#rail'), body = r('#body'), head = r('#head'), tab = r('#tab-edit'), pt = r('#ptabs'), hist = r('#rail .rhist'), brand = r('#rail .brand');
      const one = window.__wb.store.state.resumes.find(x => x.id === window.__wb.store.state.openId)?.pageLimit === 1;
      return {
        tabs: !!document.querySelector('#tabs'), folded: !!document.querySelector('.is-folded'),
        segs: [...document.querySelectorAll('#ptabs .wsheets [role=tab]')].map(b => b.dataset.m),
        segRole: document.querySelector('#ptabs .wsheets[role=tablist]')?.getAttribute('aria-label') ?? null,
        railTabs: document.querySelectorAll('#rail [role=tab]').length,
        head: ['switcher', 'menu', 'fit', 'save-file', 'undo', 'redo', 'drink-switch'].filter(a => document.querySelector(`#head [data-act="${a}"]`)),
        railActs: [...document.querySelectorAll('#rail [data-act]')].map(b => b.dataset.act),
        places: [...document.querySelectorAll('#ptabs .wtab')].map(b => b.getAttribute('aria-label') + (b.classList.contains('is-on') ? '*' : '')),
        footShown: !!document.querySelector('#foot')?.getClientRects().length,
        bodyBottom: body.bottom, colBottom: col.bottom, barTop: rail.top, barBottom: rail.bottom, barW: rail.width,
        barsInRail: !!document.querySelector('#rail .meter'), screensInRail: !!document.querySelector('#rail .scr, #rail .rscreens'),
        savedInSeam: !!document.querySelector('#rail .rhist .savestate'),
        zoombar: [...document.querySelectorAll('#zoombar [data-act]')].map(b => b.dataset.act),
        seam: { histIn: hist.top >= rail.top && hist.bottom <= rail.bottom, brandLeft: brand.left - rail.left },
        want: sideWidth(innerWidth, innerHeight, one), one,
        widths: { col: col.width, tabOnHead: Math.abs(tab.bottom - head.top) < 1, nameAbove: head.bottom <= body.top, placesAbove: pt.bottom <= head.top + 1 },
      };
    });
    ok('no old tabs and no fold', !shape.tabs && !shape.folded);
    ok('Content and Look are a labelled tab list, the name card\'s tabs (Export is inside the card); the bar has no tabs', shape.segs.join() === 'edit,design' && !!shape.segRole && shape.railTabs === 0, shape.segs.join());
    ok(`the sidebar is what sideWidth says (${shape.want}px, ${shape.one ? 'a one-page resume' : 'two pages'}); Content stands on the name card; the way and the name card are above the editor card`, shape.widths.col === shape.want && shape.widths.tabOnHead && shape.widths.nameAbove && shape.widths.placesAbove, JSON.stringify(shape.widths));
    ok('the way on top of the column: Your career, Resumes, Content (open) and Look', shape.places.join() === 'Your career,Resumes,Content*,Look', shape.places.join());
    ok('the name card has the name: no menu, Save to file, undo, redo, logo, Fit or Saved', shape.head.join() === 'switcher' && shape.savedInSeam, shape.head.join());
    ok('the bar at the column\'s foot, its full width: the brand first (home), then Saved, undo and redo, the "?" and the fold', ['place', 'undo', 'redo', 'menu', 'side-fold'].every(a => shape.railActs.includes(a)) && shape.railActs[0] === 'place' && shape.seam.histIn && shape.seam.brandLeft < 12 && Math.abs(shape.barBottom - shape.colBottom) < 1.5 && Math.abs(shape.barW - shape.widths.col) < 1, JSON.stringify({ ...shape.seam, acts: shape.railActs }));
    ok('no screen buttons and no page bars in the bar (the places are the way\'s; the page bars are Export\'s)', !shape.barsInRail && !shape.screensInRail);
    ok('there is no footer: the editor card ends above the bar', !shape.footShown && shape.bodyBottom <= shape.barTop - 4, `${shape.bodyBottom} ${shape.barTop}`);
    ok('Actual size is on the zoom bar', shape.zoombar.includes('actual'), shape.zoombar.join());
    // the tab list: the arrow keys move between the tabs and open them
    await page.focus('#tab-edit'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
    ok('the arrow keys move along Content and Look and open each', await page.evaluate(() => document.activeElement.id === 'tab-design' && window.__wb.ui.view === 'design'));
    await page.keyboard.press('End'); await page.waitForTimeout(300);
    await page.keyboard.press('Home'); await page.waitForTimeout(300);
    ok('End goes to Look, the last tab (Export is a place of its own)', await page.evaluate(() => document.activeElement.id === 'tab-edit') && await (async () => { await page.keyboard.press('End'); await page.waitForTimeout(300); return page.evaluate(() => document.activeElement.id === 'tab-design' && window.__wb.ui.view === 'design'); })());
    await page.evaluate(() => window.__wb.export.open()); await page.waitForTimeout(300);
    ok('Save to file is in the Export panel, with where the file stands', await page.evaluate(() => !!document.querySelector('#body #filestate[data-act=save-file]') && /file/i.test(document.querySelector('#fileline')?.textContent ?? '')));
    await page.evaluate(() => window.__wb.export.back()); await page.waitForTimeout(300);
    await page.focus('#tab-design'); await page.keyboard.press('Home'); await page.waitForTimeout(300);
    ok('Home goes to Edit', await page.evaluate(() => document.activeElement.id === 'tab-edit' && !window.__wb.ui.view));
  } catch (e){ ok('the sidebar has the new shape', false, String(e.message ?? e).split('\n')[0].slice(0, 100)); }
  await ctx.close();
}

// the editor card's room at 1280×720 (compact): from its top, under the way and the name card, to the bar; a way or a name card taller than that would show here
{
  const { ctx, page } = await open(1280, 720);
  const hgt = await page.evaluate(() => Math.round(document.querySelector('#rail').getBoundingClientRect().top - document.querySelector('#body').getBoundingClientRect().top));
  ok('1280×720: the editor card has about 524px between the name card and the bar', hgt >= 512 && hgt <= 540, `${hgt}px`);
  await ctx.close();
}
await browser.close(); server.close();
console.log(failed ? `\n${failed} room check(s) FAILED` : '\nall room checks passed');
process.exit(failed ? 1 : 0);
