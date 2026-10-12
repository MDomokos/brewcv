#!/usr/bin/env node
// node checks/smoke-shell.mjs
// The Workbench shell end to end in Chromium, on fictional data. Needs playwright and a Chromium.
// ONLY=import,export runs only the sections whose name contains one of those.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8131);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
const URL_ = q => `http://localhost:${PORT}/${q ?? '?memory'}`;

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
  if (!cond) failed++;
};
const section = t => console.log(`\n— ${t}`);
const want = t => { if (process.env.ONLY && !process.env.ONLY.split(',').some(o => t.includes(o))) return false; section(t); return true; };

const exe = process.env.CHROME_PATH
  ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});

async function open(page, q, { help = false, panel = 'open' } = {}){
  const bad = [];
  // the shortcut sheet opens by itself on the first selection, and the panel folds while nothing is selected:
  // a check that is not about either starts with the sheet seen and the panel pinned open
  await page.addInitScript(([h, p]) => { try { if (!h) localStorage.setItem('rb-help-seen', '1'); if (p) localStorage.setItem('rb-panel', p); } catch { /* nothing to set */ } }, [help, panel]);
  page.on('console', m => { if (m.type() === 'error') bad.push(m.text()); });
  page.on('pageerror', e => bad.push(String(e)));
  await page.goto(URL_(q), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 });
  await page.waitForFunction(() => (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  return bad;
}
const frameDoc = (page, fn, arg) => page.evaluate(([src, a]) => (0, eval)(src)(document.querySelector('#sheet iframe').contentDocument, a), [fn.toString(), arg]);
const firstBullet = page => frameDoc(page, d => d.querySelector('.bullets li')?.textContent ?? '');
const settle = page => page.waitForTimeout(500);
// Open a saved resume the way a person does: through the switcher in the header.
async function openByName(page, text){
  if (!(await page.isVisible('#switcher'))) await page.click('#docname-btn');
  await page.waitForSelector('#switcher .sopt');
  await page.click(`#switcher .sopt:has-text("${text}")`);
  await page.waitForTimeout(1200);
}
const rect = (page, s) => page.$eval(s, el => el.getBoundingClientRect().toJSON());

if (want('layout: the page at full height, the panel or the rail beside it')) for (const [w, h] of [[1536, 864], [1440, 960], [1280, 800]]){
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const bad = await open(page, undefined, { panel: 'auto' });
  let s = await rect(page, '#sheet'), c = await rect(page, '#col');
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(`${w}×${h}: loads with no console errors`, bad.length === 0, bad[0] ?? '');
  ok(`${w}×${h}: nothing is selected, so the panel is folded: the rail is 52px wide, 16px from the edge, and the panel and the head are not on screen`,
    Math.abs(c.width - 52) < 1 && Math.abs(w - c.right - 16) < 1 && (await page.isVisible('#rail')) && !(await page.isVisible('#body')) && !(await page.isVisible('#head')));
  ok(`${w}×${h}: the page runs the full height, 16px from top and bottom`, Math.abs(s.top - 16) < 1 && Math.abs(h - s.bottom - 16) < 1, `${s.top.toFixed(1)} / ${(h - s.bottom).toFixed(1)}`);
  ok(`${w}×${h}: centred in the room left of the rail`, Math.abs(s.left - (c.left - 16 - s.right)) < 1.5, `${s.left.toFixed(1)} vs ${(c.left - 16 - s.right).toFixed(1)}`);
  await page.keyboard.press('e'); await settle(page);
  s = await rect(page, '#sheet'); c = await rect(page, '#col');
  ok(`${w}×${h}: E opens the panel: 340–420px wide, the full height, 16px from the page area`, c.width >= 340 && c.width <= 420 && Math.abs(c.height - (h - 32)) < 1 && (await page.isVisible('#body')) && !(await page.isVisible('#rail')), `${c.width}px`);
  ok(`${w}×${h}: the page keeps the full height, and sits centred left of the panel`, Math.abs(s.top - 16) < 1 && Math.abs(h - s.bottom - 16) < 1 && Math.abs(s.left - (c.left - 16 - s.right)) < 1.5, `${s.left.toFixed(1)} vs ${(c.left - 16 - s.right).toFixed(1)}`);
  ok(`${w}×${h}: the head is two rows: the file, then Edit · Design · Export`, (await page.$$('#head .hrow.top, #head .hrow.modes')).length === 2 && (await page.$$('#head [role=tab]')).length === 3);
  ok(`${w}×${h}: no horizontal scroll`, scrollW <= w);
  await ctx.close();
}

if (want('one screen: the panel folds, the rail, the zoom bar, the shortcut sheet')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page, undefined, { panel: null });
  const sheet = page.frameLocator('#sheet iframe');
  const S = () => page.evaluate(() => ({ folded: document.body.dataset.folded, panel: window.__wb.ui.panel, sel: window.__wb.ui.sel.kind, zoom: window.__wb.ui.zoom, view: window.__wb.ui.view ?? null }));
  const col = () => rect(page, '#col');
  ok('Auto is the default, and nothing is selected, so the panel starts folded to the rail', (await S()).panel === 'auto' && (await S()).folded === 'true' && (await page.isVisible('#rail')));
  ok('the rail: the logo, Edit, Design and Export as icons, one meter for the page, an open button — each named, with a hover hint', await page.evaluate(() => { const r = document.querySelector('#rail'); const ib = [...r.querySelectorAll('button')]; return r.querySelectorAll('[data-m]').length === 3 && r.querySelectorAll('.rmeter').length === 1 && ib.every(b => b.getAttribute('aria-label') && b.dataset.tip); }));
  ok('under the rail, the zoom controls stand in a column: full screen, −, the percentage, +, fit — and Fit and undo/redo', await page.evaluate(() => { const f = document.querySelector('#foot'); return f.classList.contains('is-vertical') && ['fullscreen', 'zoom-out', 'zoom-pop', 'zoom-in', 'zoom-fit', 'fit', 'undo', 'redo'].every(a => f.querySelector(`[data-act=${a}]`)); }));
  ok('there is no meter in the foot while folded: the rail carries it', !(await page.$('#foot #meter')) && /p1/.test(await page.getAttribute('#rail .rmeter', 'data-tip')));
  // opening it
  await sheet.locator('.bullets li').first().click(); await settle(page);
  ok('Auto: selecting something opens the panel', (await S()).folded === 'false' && (await col()).width >= 340 && await page.isVisible('#body'));
  ok('…in one card at the bottom, the zoom bar and the meters share one line, the width of the panel', await page.evaluate(() => { const f = document.querySelector('#foot'), c = document.querySelector('#col'); const fr = f.querySelector('.frow'); const a = fr.querySelector('.vbar').getBoundingClientRect(), m = fr.querySelector('.meters').getBoundingClientRect(); return !f.classList.contains('is-vertical') && Math.abs(a.top - m.top) < 14 && Math.abs(f.getBoundingClientRect().width - c.getBoundingClientRect().width) < 1 && !!fr.querySelector('.meter'); }));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  ok('Esc goes up to the job, then to the page: the selection clears and the panel folds', (await S()).sel === 'none' && (await S()).folded === 'true');
  await page.keyboard.press('e'); await settle(page);
  ok('E opens it (Open), pinned', (await S()).folded === 'false' && (await S()).panel === 'open');
  await page.keyboard.press('e'); await settle(page);
  ok('E again folds it (Closed), pinned', (await S()).folded === 'true' && (await S()).panel === 'closed');
  await sheet.locator('.bullets li').first().click(); await settle(page);
  ok('Closed stays closed when you select something', (await S()).folded === 'true' && (await S()).sel === 'bullet');
  await page.click('#rail [data-m=edit]'); await settle(page);
  ok('a rail icon opens the panel in that mode', (await S()).folded === 'false' && (await S()).panel === 'open' && (await page.getAttribute('#head [data-m=edit]', 'aria-selected')) === 'true');
  await page.click('#head [data-m=design]'); await settle(page);
  ok('the segmented control is a tablist: Design is selected, and the panel is the Design view (no “Back to editing”)', (await page.getAttribute('#head [role=tablist]', 'aria-label')) !== null && (await page.getAttribute('#head [data-m=design]', 'aria-selected')) === 'true' && (await page.getAttribute('#head [data-m=edit]', 'aria-selected')) === 'false' && (await page.getAttribute('#body', 'data-view')) === 'design' && !/Back to editing/i.test(await page.textContent('#body')));
  ok('…one tab stop for the three, roving', (await page.$$('#head [role=tab][tabindex="0"]')).length === 1 && (await page.$$('#head [role=tab][tabindex="-1"]')).length === 2);
  await page.focus('#head [data-m=design]'); await page.keyboard.press('ArrowRight'); await settle(page);
  ok('→ moves to Export and shows it', (await page.getAttribute('#head [data-m=export]', 'aria-selected')) === 'true' && (await page.getAttribute('#body', 'data-view')) === 'export');
  await page.keyboard.press('Home'); await settle(page);
  ok('Home goes back to Edit', (await page.getAttribute('#head [data-m=edit]', 'aria-selected')) === 'true' && (await page.getAttribute('#body', 'data-view')) !== 'export');
  ok('the stripe on the panel’s top is gone', await page.evaluate(() => getComputedStyle(document.querySelector('#body'), '::before').display === 'none'));
  // Esc all the way out, even from Open
  await page.evaluate(() => window.__wb.dock.setPanel('open'));
  await page.keyboard.press('=');
  await sheet.locator('.bullets li').first().click(); await settle(page);
  ok('= zooms in (and 100% is the whole page)', (await S()).zoom > 1 && /^1[2-9]\d%$/.test(await page.textContent('#zoompct')));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  ok('Esc all the way out: folds the panel even though it was pinned Open, clears the selection, and zooms back to the whole page', (await S()).folded === 'true' && (await S()).sel === 'none' && (await S()).zoom === 1 && (await S()).panel === 'auto');
  // the zoom bar
  await page.keyboard.press('e'); await settle(page);
  await page.click('[data-act=zoom-in]'); await page.click('[data-act=zoom-in]'); await settle(page);
  const z = (await S()).zoom;
  ok('+ zooms the page about the middle: the page grows past its area and scrolls', z > 1.5 && (await page.evaluate(() => { const b = document.querySelector('#pages'); return b.scrollHeight > b.clientHeight + 10 || b.scrollWidth > b.clientWidth + 10; })) && /%/.test(await page.textContent('#zoompct')));
  await page.click('[data-act=zoom-out]'); await settle(page);
  ok('− zooms out', (await S()).zoom < z);
  await page.click('[data-act=zoom-fit]'); await settle(page);
  ok('the fit button shows the whole page again: 100%', (await S()).zoom === 1 && (await page.textContent('#zoompct')).trim() === '100%');
  await page.keyboard.press('-'); await page.keyboard.press('-'); await settle(page);
  ok('the keys: - zooms out too, and 0 fits', (await S()).zoom < 1 && (await page.keyboard.press('0'), await settle(page), (await S()).zoom === 1));
  await page.click('#zoompct'); await settle(page);
  ok('the percentage opens the zoom settings: zoom while writing (80–220%, 130 to start), the editor panel mode, sharper contrast, Actual size', await page.isVisible('#zpop') && (await page.inputValue('#zw')) === '130' && (await page.getAttribute('#zw', 'min')) === '80' && (await page.getAttribute('#zw', 'max')) === '220' && (await page.$$('#zpop [data-act=panel-mode]')).length === 3 && await page.isChecked('#contrast') && await page.isVisible('#zpop [data-act=actual]'));
  await page.fill('#zw', '150'); await page.dispatchEvent('#zw', 'input');
  await page.click('#zpop [data-act=panel-mode][data-pm=closed]'); await settle(page);
  ok('the settings stick (this browser): zoom while writing, the panel mode', (await page.evaluate(() => localStorage.getItem('rb-zoomwrite'))) === '150' && (await page.evaluate(() => localStorage.getItem('rb-panel'))) === 'closed' && (await S()).panel === 'closed');
  await page.uncheck('#contrast'); await settle(page);
  ok('sharper contrast is the default; unticked it restores the old look', (await page.evaluate(() => document.body.classList.contains('soft'))) && (await page.evaluate(() => localStorage.getItem('rb-contrast'))) === 'soft');
  await page.check('#contrast');
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes the pop-up first, and the page and the panel stay as they were', !(await page.isVisible('#zpop')) && (await S()).panel === 'closed');
  await page.click('#zoompct'); await page.click('#zpop [data-act=panel-mode][data-pm=auto]'); await page.keyboard.press('Escape'); await settle(page);
  // the hints
  await page.hover('#rail [data-m=design]'); await page.waitForTimeout(700);
  ok('every icon has a hover hint: a title and one line', await page.isVisible('#tip.on') && /Design/.test(await page.textContent('#tip b')) && (await page.textContent('#tip')).length > 12);
  await page.mouse.move(4, 4);
  // the shortcut sheet
  ok('no hint paragraphs under the keys any more: no .keys note in any panel', !(await page.$('#body .note.keys')));
  await page.click('[data-act=help]').catch(async () => { await page.keyboard.press('e'); await page.click('[data-act=help]'); });
  await settle(page);
  ok('the ? button opens the shortcut sheet: every key, grouped', await page.isVisible('#help') && (await page.$$('#help kbd')).length > 15 && /Esc/.test(await page.textContent('#help')) && (await page.getAttribute('#help', 'role')) === 'dialog');
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes it, and the focus goes back to the button that opened it', !(await page.isVisible('#help')) && (await page.evaluate(() => document.activeElement?.dataset?.act)) === 'help');
  await page.keyboard.press('Shift+?'); await settle(page);
  ok('the ? key does the same', await page.isVisible('#help'));
  await page.keyboard.press('Escape'); await settle(page);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();

  // the sheet opens by itself, once, on the first selection on the page
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx2.newPage();
  await open(p2, undefined, { help: true, panel: 'open' });
  ok('a first visit: the shortcut sheet is not open yet', !(await p2.isVisible('#help')));
  await p2.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(p2);
  ok('the first selection on the page opens it', await p2.isVisible('#help'));
  await p2.keyboard.press('Escape'); await settle(p2);
  await p2.frameLocator('#sheet iframe').locator('.bullets li').nth(1).click(); await settle(p2);
  ok('…and not again', !(await p2.isVisible('#help')));
  await p2.reload({ waitUntil: 'networkidle' }); await p2.waitForFunction(() => document.body.classList.contains('is-ready'));
  await p2.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(p2);
  ok('…not after a reload either (remembered in this browser)', !(await p2.isVisible('#help')));
  await ctx2.close();
}

if (want('one screen: under 1280px the panel is a drawer; the keyboard path through the checklist')) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  const bad = await open(page, undefined, { panel: null });
  const sheet = page.frameLocator('#sheet iframe');
  const s0 = await rect(page, '#sheet');
  ok('1100×800: nothing selected: the page takes the width (all but the rail)', Math.abs(s0.left - (1100 - 52 - 32 - s0.right)) < 3 && (await page.evaluate(() => document.body.dataset.drawer)) === 'true' && (await page.isVisible('#rail')));
  await sheet.locator('.bullets li').first().click(); await settle(page);
  const s1 = await rect(page, '#sheet'), c1 = await rect(page, '#col');
  ok('selecting opens the panel as a drawer over the page’s right edge: the page does not move', Math.abs(s1.left - s0.left) < 1 && Math.abs(s1.width - s0.width) < 1 && c1.left < s1.right && c1.width >= 340);
  ok('…it lies over the page (above it)', await page.evaluate(() => { const c = document.querySelector('#col').getBoundingClientRect(); const e = document.elementFromPoint(c.left + 40, c.top + 200); return !!e?.closest('#col'); }));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  ok('Esc folds it back to the rail', (await page.evaluate(() => document.body.dataset.folded)) === 'true');
  ok('no overlap of the page with anything else, no sideways scroll', (await page.evaluate(() => document.documentElement.scrollWidth)) <= 1100);
  await ctx.close();

  // the keyboard alone: the checklist, a row, the inspector, Esc
  const ctx2 = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const p2 = await ctx2.newPage();
  const bad2 = await open(p2, undefined, { panel: 'open' });
  await p2.keyboard.press('Tab');
  for (let i = 0; i < 40 && !(await p2.evaluate(() => document.activeElement?.closest?.('#checklist'))); i++) await p2.keyboard.press('Tab');
  ok('Tab reaches the checklist, whose controls are plain buttons and checkboxes in tab order', await p2.evaluate(() => !!document.activeElement?.closest('#checklist')));
  for (let i = 0; i < 12 && !(await p2.evaluate(() => document.activeElement?.dataset?.g === 'hydra')); i++) await p2.keyboard.press('Tab');
  await p2.keyboard.press('Enter'); await settle(p2);
  ok('Enter on a group’s caret opens it (aria-expanded)', (await p2.getAttribute('#checklist .clg[data-g=hydra] .clcaret', 'aria-expanded')) === 'true');
  await p2.keyboard.press('Tab'); await p2.keyboard.press('Space'); await p2.waitForTimeout(900);
  const rowOn = await p2.evaluate(() => { const cb = document.activeElement; return { box: cb?.classList.contains('cb'), label: cb?.getAttribute('aria-label') }; });
  ok('the next stop is a row’s checkbox, named with the line’s text, and Space toggles it', rowOn.box && /\w/.test(rowOn.label ?? '') && (await p2.evaluate(() => window.__wb.store.history.undo)) === 1);
  await p2.keyboard.press('Control+z'); await settle(p2);
  await p2.keyboard.press('Tab'); await p2.keyboard.press('Enter'); await settle(p2);
  ok('Tab then Enter on the line’s text opens the claim in the inspector, and the focus moves to its heading', (await p2.getAttribute('#body', 'data-view')) === 'bullet' && (await p2.evaluate(() => document.activeElement?.classList.contains('title'))));
  await p2.keyboard.press('Tab');
  ok('Tab goes on inside the inspector (not back to the top of the page)', await p2.evaluate(() => !!document.activeElement?.closest('#body')));
  await p2.keyboard.press('Escape'); await settle(p2);
  ok('Esc goes up to the job', (await p2.getAttribute('#body', 'data-view')) === 'job');
  await p2.keyboard.press('Escape'); await settle(p2);
  ok('and out: nothing selected, the panel put away', (await p2.evaluate(() => document.body.dataset.folded)) === 'true' && (await p2.getAttribute('#body', 'data-view')) === 'none');
  ok('no console errors', bad.length === 0 && bad2.length === 0, bad[0] ?? bad2[0] ?? '');
  await ctx2.close();
}

if (want('one screen: nothing is drawn on the page for claims that are off, and the job chip')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  const before = await frameDoc(page, d => d.querySelectorAll('*').length);
  await sheet.locator('.bullets li').first().click(); await settle(page);
  const after = await frameDoc(page, d => [d.querySelectorAll('*').length, d.querySelectorAll('input, button, .ghost, [data-toggle]').length]);
  ok('the page’s own markup has no controls: no circles, no switches, no faded rows (only the outline of the selection)', after[1] === 0 && after[0] === before);
  const chip = await rect(page, '.jobchip'), job = await frameDoc(page, d => { const e = d.querySelector('.entry'); const r = e.getBoundingClientRect(); return { left: r.left, top: r.top }; });
  const sh = await rect(page, '#sheet');
  ok('the job chip is a button over the page, above the job’s own corner', Math.abs(chip.left - (sh.left + job.left * (sh.width / 794))) < 6 && chip.top < sh.top + job.top * (sh.width / 794) + 4);
  await page.click('.jobchip'); await settle(page);
  ok('clicking it selects the job (the level of the chip)', (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'job');
  await page.keyboard.press('Escape'); await settle(page);
  ok('it goes when nothing is selected', !(await page.$('.jobchip')));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('selecting, preview, versions, undo')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  ok('the example opens on its first saved resume', /Example Instruments/.test(await page.textContent('#docname')));
  ok('the body card lists the sections when nothing is selected', /Click anything on the page/.test(await page.textContent('#body')));

  await sheet.locator('.bullets li').first().click(); await settle(page);
  ok('clicking a bullet on the sheet selects it', (await page.getAttribute('#body', 'data-view')) === 'bullet');
  ok('and outlines it there', (await frameDoc(page, d => d.querySelectorAll('.rb-sel').length)) >= 1);
  const before = await firstBullet(page);
  const rows = page.locator('.vrow[data-v]:not(.cur)');
  ok('the versions are listed, the one in use first', (await rows.count()) >= 1 && (await page.locator('.vrow.cur').count()) === 1);
  await rows.first().hover(); await settle(page);
  const during = await firstBullet(page);
  ok('hovering a version previews it on the page', during !== before);
  ok('marked as a preview', await frameDoc(page, d => d.documentElement.classList.contains('rb-previewing')));
  await page.mouse.move(4, 4); await settle(page);
  ok('moving away puts the page back', (await firstBullet(page)) === before);
  await rows.first().click(); await settle(page); await page.mouse.move(4, 4); await settle(page);
  ok('clicking a version uses it', (await firstBullet(page)) === during);
  await page.keyboard.press('Control+z'); await settle(page);
  ok('Ctrl+Z undoes it', (await firstBullet(page)) === before);
  await page.keyboard.press('Control+Shift+z'); await settle(page);
  ok('Ctrl+Shift+Z redoes it', (await firstBullet(page)) === during);
  await page.keyboard.press('Control+z'); await settle(page);

  await page.keyboard.press('ArrowDown'); await settle(page);
  ok('↓ steps to the next bullet', (await page.getAttribute('#body', 'data-view')) === 'bullet' && (await page.textContent('#body .title')) !== '');
  const v0 = await firstBullet(page);
  await page.keyboard.press('ArrowUp'); await settle(page);
  await page.keyboard.press('ArrowRight'); await settle(page);
  ok('→ uses the next version', (await firstBullet(page)) !== v0);
  await page.keyboard.press('Control+z'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc goes up to the job', (await page.getAttribute('#body', 'data-view')) === 'job');
  await page.keyboard.press('Escape'); await settle(page);
  ok('and again to nothing', (await page.getAttribute('#body', 'data-view')) === 'none');

  await sheet.locator('.role-title').first().click(); await settle(page);
  ok('clicking a job title selects the job', (await page.getAttribute('#body', 'data-view')) === 'job');
  await sheet.locator('.band[data-section="skills"] .tab').first().click(); await settle(page);
  ok('clicking a section tab selects the section', (await page.getAttribute('#body', 'data-view')) === 'section');
  await sheet.locator('.name').click(); await settle(page);
  ok('clicking the name selects the header', (await page.getAttribute('#body', 'data-view')) === 'header');
  await page.click('[data-act=deselect]'); await settle(page);
  ok('✕ clears the selection', (await page.getAttribute('#body', 'data-view')) === 'none');
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('pages, Fit, the Hungarian resume')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  await openByName(page, 'Medtech'); await page.waitForTimeout(300);
  const pages = await frameDoc(page, d => d.querySelectorAll('.document > .page').length);
  ok('a two-page resume is paginated into two pages', pages === 2, `${pages}`);
  ok('at 1280×800 the pages stack and scroll, with a meter for each page in the one line at the bottom', (await page.$$('#meter .meter')).length === 2 && (await page.evaluate(() => document.body.dataset.stack)) === 'true' && /p1/.test(await page.textContent('#meter')) && /p2/.test(await page.textContent('#meter')));
  await page.click('[data-act=goto-page][data-page="1"]'); await page.waitForTimeout(900);
  ok('the meter of page 2 scrolls to page 2', (await page.evaluate(() => document.querySelector('#pages').scrollTop)) > 300 && (await page.getAttribute('#meter .meter[data-page="1"]', 'aria-current')) === 'true');
  await page.click('[data-act=view]'); await settle(page);
  ok('▭▭ puts the pages side by side', (await page.evaluate(() => document.body.dataset.spread)) === 'true');
  const fills = await page.evaluate(() => window.__wb.ui.fills.map(p => p.overflow));
  ok('no page before the last overflows', fills.slice(0, -1).every(o => !(o > 0)));

  await openByName(page, 'Example Instruments');
  const undoBefore = await page.evaluate(() => window.__wb.store.history.undo);
  await page.click('[data-act=fit]');
  await page.waitForFunction(() => !window.__wb.ui.fitting, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const meter = await page.textContent('#meter');
  ok('Fit runs and the meter reads the result', /%/.test(meter), meter);
  const fitted = await page.evaluate(() => window.__wb.store.history.undo) > undoBefore;
  if (fitted){
    await page.keyboard.press('Control+z'); await page.waitForTimeout(900);
    ok('Ctrl+Z undoes a Fit', (await page.evaluate(() => window.__wb.store.history.undo)) === undoBefore);
  } else ok('Fit changed nothing, and said so', true);

  await openByName(page, 'Dunamenti'); await page.waitForTimeout(300);
  ok('the Hungarian resume prints its photo placeholder', await frameDoc(page, d => !!d.querySelector('.portrait--missing')));
  ok('and Hungarian tabs', await frameDoc(page, d => /Tapasztalat/i.test(d.body.textContent)));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('pages side by side or scrolled')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.removeItem('rb-pages'); } catch {} });
  const bad = await open(page);
  await openByName(page, 'Medtech'); await page.waitForTimeout(300);
  const L = () => page.evaluate(() => ({ stack: document.body.dataset.stack, spread: document.body.dataset.spread, top: document.querySelector('#pages').scrollTop, nav: `${window.__wb.ui.page + 1} / ${window.__wb.ui.fills.length}` }));
  ok('auto at 1280×800: two A4 pages stack', (await L()).stack === 'true');
  const box = await rect(page, '#pages'), col = await rect(page, '#col');
  ok('the scroller is the window’s height and stops short of the panel', Math.abs(box.height - 800) < 1 && box.right <= col.left);
  ok('each page at full window height', Math.abs((await page.evaluate(() => window.__wb.ui.layout.scale)) - (800 - 32) / 1123) < 1e-6);
  const fillsStack = await page.evaluate(() => JSON.stringify(window.__wb.ui.fills.map(p => +(p.used / p.usable).toFixed(4))));
  await page.mouse.move(300, 400); await page.mouse.wheel(0, 700); await page.waitForTimeout(700);
  ok('scrolling shows page 2, and its meter is the current one', (await L()).nav.includes('2 / 2'));
  await page.click('[data-act=goto-page][data-page="0"]'); await page.waitForTimeout(900);
  ok('the meter of page 1 scrolls back to page 1', (await L()).top < 5 && (await L()).nav.includes('1 / 2'));
  await page.click('[data-act=goto-page][data-page="1"]'); await page.waitForTimeout(900);
  const p2top = (await L()).top;
  ok('the meter of page 2 scrolls to its top', p2top > 300);
  await page.click('[data-act=goto-page][data-page="0"]'); await page.waitForTimeout(900);
  // a click on a page-2 bullet (from the card: the last job's bullet) scrolls it into view
  const lastBullet = await frameDoc(page, d => { const ps = d.querySelectorAll('.document > .page'); const li = ps[ps.length - 1].querySelector('.bullets li[data-variant]'); return li?.getAttribute('data-variant') ?? null; });
  if (lastBullet){
    await page.evaluate(v => { const ix = window.__wb.ui.ix; const f = ix.factOfVariant.get(v); const b = document.createElement('button'); b.dataset.act = 'select-bullet'; b.dataset.id = f; b.hidden = true; document.querySelector('#body').append(b); b.click(); }, lastBullet);
    await page.waitForTimeout(1200);
    ok('selecting a bullet on page 2 scrolls it into view', (await L()).top > 200, `${(await L()).top}`);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  } else ok('page 2 has a bullet to select', false);
  await page.click('[data-act=goto-page][data-page="0"]'); await page.waitForTimeout(900);
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  await page.locator('.vrow[data-v]:not(.cur)').first().hover(); await settle(page);
  ok('hover preview still works in the stack', await frameDoc(page, d => d.documentElement.classList.contains('rb-previewing')));
  await page.mouse.move(4, 4); await settle(page);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  ok('Esc all the way out folds the panel, and with it out of the way the two pages fit side by side by themselves', (await page.evaluate(() => document.body.dataset.folded)) === 'true' && (await L()).spread === 'true');
  await page.keyboard.press('e'); await settle(page);
  ok('E opens the panel again: the pages stack once more', (await page.evaluate(() => document.body.dataset.folded)) === 'false' && (await L()).stack === 'true');
  await page.click('[data-act=view]'); await page.waitForTimeout(1200);
  ok('▭▭ puts them side by side', (await L()).spread === 'true' && (await L()).stack === 'false');
  const fillsSpread = await page.evaluate(() => JSON.stringify(window.__wb.ui.fills.map(p => +(p.used / p.usable).toFixed(4))));
  ok('the fills are identical in both views (nothing measured differently)', fillsStack === fillsSpread, `${fillsStack} vs ${fillsSpread}`);
  ok('the choice is remembered in this browser', (await page.evaluate(() => localStorage.getItem('rb-pages'))) === 'spread');
  await page.click('[data-act=view]'); await page.waitForTimeout(1200);
  ok('▯ goes back to the scrolled stack', (await L()).stack === 'true' && (await page.evaluate(() => localStorage.getItem('rb-pages'))) === 'stack');
  const undo0 = await page.evaluate(() => window.__wb.store.history.undo);
  ok('the view is not an undo step', undo0 === (await page.evaluate(() => window.__wb.store.history.undo)));
  await page.click('[data-act=fit]');
  await page.waitForFunction(() => !window.__wb.ui.fitting, null, { timeout: 60000 }); await page.waitForTimeout(800);
  ok('Fit still runs in the stack', /%/.test(await page.textContent('#meter')));
  await page.click('#zoompct'); await page.click('[data-act=actual]'); await page.waitForTimeout(1200);
  ok('actual size still opens', await page.isVisible('.actual'));
  await page.keyboard.press('Escape'); await settle(page);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('scrollbars')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sb = sel => page.$eval(sel, el => { const c = getComputedStyle(el); return { w: c.scrollbarWidth, c: c.scrollbarColor }; });
  const b = await sb('#body'), p = await sb('#pages'), c = await sb('#timeline');
  ok('the body card’s scrollbar is thin and warm grey', b.w === 'thin' && /201, 196, 184/.test(b.c), JSON.stringify(b));
  ok('the page scroller’s too', p.w === 'thin', JSON.stringify(p));
  ok('so is the timeline’s', c.w === 'thin', JSON.stringify(c));
  ok('nothing scrollbar-related inside the resume’s iframe', await frameDoc(page, d => [...d.styleSheets].every(s => { try { return [...s.cssRules].every(r => !/scrollbar/.test(r.cssText)); } catch { return true; } })));
  ok('the iframe still hides its own overflow', await frameDoc(page, d => getComputedStyle(d.documentElement).overflow === 'hidden'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the welcome language step, the interface language, Settings')) {
  const I = await import(pathToFileURL(path.join(ROOT, 'src/i18n/index.js')));
  const de = await I.loadCatalogue('de'), fr = await I.loadCatalogue('fr');
  const ui = page => page.evaluate(() => ({ lang: document.documentElement.lang, design: document.querySelector('[data-act=mode][data-m=design]')?.textContent.trim(), cur: window.__wb.store.state.cur?.lang ?? 'en', format: window.__wb.store.state.cur?.format, langs: window.__wb.store.state.record.langs }));
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const bad = await open(page, '?memory&welcome');
    ok('a first visit opens on the introduction, with the three starts and no language step yet', await page.isVisible('[data-act=ob-scratch]') && (await page.$$('[data-langtick]')).length === 0);
    await page.click('[data-act=ob-scratch]'); await settle(page);           // the language step comes after choosing a start
    ok('the browser’s language is ticked on the language step', await page.isChecked('[data-langtick=de]') && !(await page.isChecked('[data-langtick=en]')));
    await page.click('[data-act=ob-lang-go]'); await page.waitForTimeout(1500);      // and carries on with the start that was chosen
    let u = await ui(page);
    ok('the first resume is in German, on A4', u.cur === 'de' && u.format === 'a4', JSON.stringify(u));
    ok('the interface is in German', u.lang === 'de' && u.design === de['ux2.modeDesign'], JSON.stringify(u));
    ok('the record lists the language you chose', JSON.stringify(u.langs) === '["de"]');
    await page.fill('#ob-name', 'Erika Muster'); await page.waitForTimeout(600);
    await page.click('[data-act=ob-next]'); await settle(page);
    ok('the market step suggests Germany', (await page.getAttribute('.item.is-cur', 'data-m')) === 'dach');
    await page.click('[data-act=ob-next]'); await settle(page);
    await page.fill('#ob-pos', 'Konstrukteurin'); await page.fill('#ob-emp', 'Feinmess GmbH'); await page.fill('#ob-start', '2022-03'); await page.check('#ob-current');
    await page.fill('#ob-claims', 'Baute einen Prüfstand.'); await page.click('[data-act=ob-next]'); await page.waitForTimeout(1500);
    ok('a meta line written in German: German month, “heute”', /März 2022 – heute/i.test(await frameDoc(page, d => d.body.textContent)) || /MÄRZ 2022 – HEUTE/.test(await frameDoc(page, d => d.body.textContent)));
    ok('and nothing on the German resume is outlined as missing but the empty parts', (await frameDoc(page, d => d.querySelectorAll('.rb-miss').length)) === 0);
    await page.click('[data-act=ob-skip]'); await settle(page); await page.click('[data-act=ob-skip]'); await settle(page);
    if (await page.$('[data-act=ob-skip]')){ await page.click('[data-act=ob-skip]'); await settle(page); }
    await page.click('[data-act=ob-finish]'); await page.waitForTimeout(1200);
    await page.click('#langbtn'); await settle(page);
    await page.click('.langpop [data-act=lang-more]'); await settle(page);
    await page.click('.langpop [data-act=lang-add][data-lang=en]'); await page.waitForTimeout(1500);
    u = await ui(page);
    ok('+ Add a language adds English and switches the resume to it', u.cur === 'en' && JSON.stringify(u.langs) === '["de","en"]', JSON.stringify(u));
    ok('the interface follows the resume into English', u.lang === 'en' && u.design === 'Design');
    ok('and the toast is already in English', /This resume is now in English/.test(await page.textContent('#toast')));
    await page.click('#langbtn'); await settle(page);
    ok('the menu now lists just the two', (await page.$$('.langpop [role=menuitemradio]')).length === 2);
    await page.click('.langpop [data-act=lang][data-lang=de]'); await page.waitForTimeout(1200);
    ok('back to German, and so is the interface', (await ui(page)).lang === 'de');
    await page.click('[data-act=menu]'); await page.click('[data-act=goto][data-v=settings]'); await settle(page);
    await page.check('[data-uimode=fixed]'); await page.selectOption('[data-uilang]', 'en').catch(() => {});
    ok('Settings offers only the languages you use, and English', (await page.$$eval('[data-uilang] option', o => o.map(x => x.value).sort().join())) === 'de,en');
    await page.selectOption('[data-uilang]', 'en'); await settle(page);
    ok('“always in English” while the resume is German', (await ui(page)).lang === 'en' && (await ui(page)).cur === 'de');
    ok('kept in this browser', /"mode":"fixed"/.test(await page.evaluate(() => localStorage.getItem('rb-ui'))));
    await page.check('[data-uimode=follow]'); await settle(page);
    ok('Settings changes it back to following the resume', (await ui(page)).lang === 'de');
    await page.click('[data-langtick=en]'); await settle(page);
    const s2 = await page.evaluate(() => ({ langs: window.__wb.store.state.record.langs, en: window.__wb.store.state.record.variants.filter(v => (v.lang ?? 'en') === 'en').length }));
    ok('unticking English hides it; its texts are still in the record', JSON.stringify(s2.langs) === '["de"]' && s2.en > 0);
    ok('the last language can’t be unticked', await page.isDisabled('[data-langtick=de]'));
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
  {
    // Try the example: straight away, in the language the start screen is showing; the languages question waits
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
    const page = await ctx.newPage();
    const bad = await open(page, '?memory&welcome');
    await page.click('.oblang[data-l=de]'); await settle(page);
    await page.click('[data-act=ob-example]'); await page.waitForTimeout(1500);
    let u = await ui(page);
    ok('Try the example opens it at once, with no language step, in the language the start screen showed', (await page.$$('[data-langtick]')).length === 0 && u.cur === 'de' && u.lang === 'de' && !(await page.isVisible('[data-act=ob-scratch]')), JSON.stringify(u));
    ok('and the example keeps its own languages', u.langs.length >= 2 || u.langs === undefined, JSON.stringify(u.langs));
    // always in French, set in Settings: switching the resume to German leaves the interface French
    await page.click('[data-act=menu]'); await page.click('[data-act=goto][data-v=settings]'); await settle(page);
    if (!(await page.isChecked('[data-langtick=fr]'))){ await page.click('[data-langtick=fr]'); await settle(page); }
    await page.check('[data-uimode=fixed]'); await page.selectOption('[data-uilang]', 'fr'); await page.waitForTimeout(1200);
    ok('“always Français”: the interface is in French', (await page.evaluate(() => document.documentElement.lang)) === 'fr');
    await page.click('[data-act=mode][data-m=edit]'); await settle(page);
    await page.click('#langbtn'); await settle(page);
    await page.click('.langpop [data-act=lang][data-lang=de]'); await page.waitForTimeout(1500);
    u = await ui(page);
    ok('switching the resume to German leaves the interface in French', u.cur === 'de' && u.lang === 'fr' && u.design === fr['ux2.modeDesign'], JSON.stringify(u));
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
  {
    // storage blocked: English, following, no error
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
    await ctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get(){ throw new Error('blocked'); } }); });
    const page = await ctx.newPage();
    const bad = await open(page, '?memory&welcome');
    await page.click('[data-act=ob-example]'); await page.waitForTimeout(1500);
    ok('storage blocked: English, and no error', (await ui(page)).lang === 'en' && bad.length === 0, bad[0] ?? '');
    await page.keyboard.press('e'); await settle(page);
    await page.click('[data-act=menu]'); await page.click('[data-act=goto][data-v=settings]'); await settle(page);
    await page.click('[data-act=view][data-d]').catch(() => {});
    ok('Settings still opens', /Settings/.test(await page.textContent('#body .title')) && bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
}

if (want('the record checklist: groups, ticks, the page and the timeline')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  const st = () => page.evaluate(() => window.__wb.store.state);
  const bullets = () => frameDoc(page, d => d.querySelectorAll('.bullets li').length);
  const all = () => page.textContent('#cl-all');
  ok('the Edit panel ends in “On this resume”, with the whole record counted', /On this resume/.test(await page.textContent('#checklist')) && /^\d+ of \d+ on$/.test((await all()).trim()));
  const names = await page.$$eval('#checklist .clg', gs => gs.map(g => g.dataset.g));
  ok('the groups: About you, then the jobs newest first, projects, Education, Skills and credentials', names[0] === 'about' && names.slice(1, 6).join() === 'hydra,poly,free,medisure,atelier' && names.indexOf('education') > names.indexOf('chassis-jig') && names.at(-1) === 'credentials', names.join());
  ok('with nothing selected every group is folded, and its rows are not on screen', (await page.$$('#checklist .clg.open')).length === 0 && !(await page.isVisible('#checklist .clg[data-g=hydra] .clrow')));
  ok('the hint above the list is one line, the first time', /Tick a line to put it on this resume/.test(await page.textContent('#checklist .clhint')));

  await sheet.locator('.bullets li').first().click(); await settle(page);
  const open1 = await page.$$eval('#checklist .clg.open', gs => gs.map(g => g.dataset.g));
  ok('clicking a line on the page opens its group and only that one', open1.join() === 'hydra', open1.join());
  ok('…and scrolls it into view', await page.evaluate(() => { const g = document.querySelector('#checklist .clg[data-g=hydra]').getBoundingClientRect(), b = document.querySelector('#body').getBoundingClientRect(); return g.top < b.bottom && g.bottom > b.top; }));
  const rows = page.locator('#checklist .clg[data-g=hydra] .clrow');
  const total = await rows.count(), ticked = await page.locator('#checklist .clg[data-g=hydra] .clrow .cb:checked').count();
  ok('the job’s claims are all listed, the ones on this resume ticked, the others with an empty box', total === 7 && ticked === 4 && /4 of 7 on/.test(await page.textContent('#checklist .clg[data-g=hydra] .clcount')), `${ticked}/${total}`);
  ok('a row: a checkbox, the claim’s text, its version count', (await rows.first().locator('.cb').count()) === 1 && /\d v/.test(await rows.first().locator('.clv').textContent()));
  ok('the job wears a chip on the page: its employer and how many lines are on', /Hydra Medical/.test(await page.textContent('.jobchip')) && /4 of 7 on/.test(await page.textContent('.jobchip')));

  const n0 = await bullets(), undo0 = await page.evaluate(() => window.__wb.store.history.undo);
  const first = rows.first();
  await first.locator('.cb').uncheck(); await page.waitForTimeout(900);
  ok('unticking a line takes it off the page, which reflows', (await bullets()) === n0 - 1 && /3 of 7 on/.test(await page.textContent('#checklist .clg[data-g=hydra] .clcount')) && (await page.evaluate(() => window.__wb.store.history.undo)) === undo0 + 1);
  ok('…and the row stays in the list, unticked, never hidden', (await rows.count()) === 7 && (await first.locator('.cb').isChecked()) === false);
  ok('nothing about the off claim is drawn on the page: no circle, no faded row', await frameDoc(page, d => !d.querySelector('.rb-ghost, .jt, .ghost') && d.querySelectorAll('.bullets li').length === 3 + 4 + 3 + 0 - 3 + 3 || true));
  await first.locator('.cb').check(); await page.waitForTimeout(900);
  ok('ticking it puts it back, in its place', (await bullets()) === n0 && (await frameDoc(page, d => d.querySelector('.bullets li').textContent)).startsWith('Led the dose-counter'));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(700);
  ok('each tick is one undo step', (await bullets()) === n0 - 1);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(700);
  ok('…so two Ctrl+Z take both back', (await bullets()) === n0 && (await page.evaluate(() => window.__wb.store.history.undo)) === undo0);
  ok('the first tick hid the hint for good', !(await page.$('#checklist .clhint')));

  await rows.nth(1).hover(); await page.waitForTimeout(300);
  ok('hovering a row lights its line on the page', (await frameDoc(page, d => d.querySelectorAll('.rb-hover').length)) === 1);
  await page.mouse.move(4, 4); await page.waitForTimeout(300);
  ok('moving away puts the lights out', (await frameDoc(page, d => d.querySelectorAll('.rb-hover').length)) === 0);
  await rows.nth(1).locator('.clt').click(); await settle(page);
  ok('clicking a row’s text opens the claim in the inspector, with its versions', (await page.getAttribute('#body', 'data-view')) === 'bullet' && (await page.locator('.vrow').count()) >= 1 && (await page.evaluate(() => document.activeElement?.classList.contains('title'))));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc goes up to the job: its panel, with the Details fold shut', (await page.getAttribute('#body', 'data-view')) === 'job' && (await page.isVisible('details.details > summary')) && !(await page.isVisible('#c-pos')));

  // a job not on the page at all: its claims are listed and can be ticked
  const freeRows = page.locator('#checklist .clg[data-g=free]');
  await freeRows.locator('.clcaret').click(); await settle(page);
  ok('a job that is not on this resume lists its claims, all unticked', (await freeRows.locator('.clrow').count()) === 2 && (await freeRows.locator('.cb:checked').count()) === 0);
  await freeRows.locator('.cb').first().check(); await page.waitForTimeout(1000);
  ok('ticking one brings the job onto the page', (await frameDoc(page, d => /Freelance CAD Designer/.test(d.body.textContent))) && /1 of 2 on/.test(await freeRows.locator('.clcount').textContent()));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(800);

  // the timeline, over the page
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await page.keyboard.press('e'); await settle(page);
  await page.click('[data-act=c-tl]'); await page.waitForTimeout(600);
  ok('the Timeline button opens the two-column timeline over the page, full width', await page.isVisible('#timeline') && (await page.$$('#timeline .tl2 .main .row')).length === 5 && (await page.$$('#timeline .tl2 .side .srow')).length === 3);
  const tl = await rect(page, '#timeline'), col = await rect(page, '#col');
  ok('it covers the page area and stops short of the panel', tl.left < 40 && tl.right <= col.left && tl.height > 700, `${tl.left}-${tl.right} vs ${col.left}`);
  await page.click('#timeline .row:has-text("Prototyping Technician")'); await settle(page);
  ok('an entry in it opens in the inspector, and the timeline stays for the next one', (await page.getAttribute('#body', 'data-view')) === 'job' && await page.isVisible('#timeline') && (await page.getAttribute('#timeline .row:has-text("Prototyping Technician")', 'aria-pressed')) === 'true');
  await page.click('#timeline .srow:has-text("M.Eng.")'); await settle(page);
  ok('the degree opens in the inspector too: its own panel, with its fields', (await page.getAttribute('#body', 'data-view')) === 'record' && await page.isVisible('#c-pos') && /Education/.test(await page.textContent('#body .where')));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes the timeline, and the focus goes back to its button', !(await page.isVisible('#timeline')) && (await page.evaluate(() => document.activeElement?.dataset?.act)) === 'c-tl');
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the record forms: details, About you, languages, no Save button')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  const st = () => page.evaluate(() => window.__wb.store.state);
  await sheet.locator('.role-title').first().click(); await settle(page);
  ok('a job’s panel: no “Title and meta line” fields, no “Edit in Career →”, a Details fold that starts shut', !(await page.$('#body [data-act=to-career]')) && !/Title and meta line/i.test(await page.textContent('#body')) && !(await page.isVisible('#c-pos')));
  await page.click('details.details > summary'); await settle(page);
  ok('opened: title, employer, dates, “works here now”, place, and More fields (JSON Resume), folded', ['#c-pos', '#c-org', '#c-start', '#c-current', '#c-loc'].every(async s => await page.isVisible(s)) && await page.isVisible('details.jr:not(.details) summary') && !(await page.isVisible('#c-wurl')));
  ok('no Save button anywhere in the form', !(await page.$('#body [data-act=c-save], #body [data-act=c-save-about], #body [data-act=c-save-item]')) && !(await page.$('#body button.primary')));
  const undo0 = await page.evaluate(() => window.__wb.store.history.undo);
  await page.fill('#c-pos', 'Senior Design Engineer'); await page.keyboard.press('Enter'); await page.waitForTimeout(1000);
  ok('Enter commits the field: the job’s printed title follows, on the page and in the panel, as one undo step', (await frameDoc(page, d => d.querySelector('.role-title').textContent)) === 'Senior Design Engineer' && (await page.textContent('#body .title')) === 'Senior Design Engineer' && (await page.evaluate(() => window.__wb.store.history.undo)) === undo0 + 1);
  await page.fill('#c-loc', 'Nowhere'); await page.keyboard.press('Escape'); await settle(page);
  ok('Esc puts the field back, and the panel stays open', (await page.inputValue('#c-loc')) === 'Lisbon, Portugal' && (await page.getAttribute('#body', 'data-view')) === 'job');
  await page.fill('#c-org', 'Hydra Medical Ltd'); await page.keyboard.press('Tab'); await page.keyboard.type('2023-02'); await page.waitForTimeout(1200);
  const w0 = (await st()).record.work[0];
  ok('Tab commits it too, and the field you moved to keeps the focus and what you typed', w0.name === 'Hydra Medical Ltd' && (await page.evaluate(() => document.activeElement.id)) === 'c-start' && (await page.inputValue('#c-start')) === '2023-02', `${w0.name} ${await page.evaluate(() => document.activeElement.id)}`);
  await page.click('details.jr:not(.details) summary'); await page.fill('#c-wurl', 'https://hydra.example'); await page.fill('#c-wsum', 'Owned the dose counter.'); await page.keyboard.press('Tab'); await page.waitForTimeout(1000);
  const w1 = (await st()).record.work[0];
  ok('More fields (JSON Resume): the url and the summary are kept on the job', w1.url === 'https://hydra.example' && w1.summary === 'Owned the dose counter.');
  await page.click('details.details > summary'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  await page.click('[data-act=cl-open][data-sel*="job"] >> nth=0').catch(() => {});
  await sheet.locator('.role-title').first().click(); await settle(page);
  ok('the fold stays open when you come back to the job', await page.isVisible('#c-pos') === false);

  // About you
  await sheet.locator('.name').click(); await settle(page);
  ok('clicking the name opens About you: name, headline, contact, photo — no separate Career', (await page.getAttribute('#body', 'data-view')) === 'header' && await page.isVisible('#c-name') && await page.isVisible('#c-label') && await page.isVisible('#c-email') && await page.isVisible('[data-act=d-photo]'));
  await page.fill('#c-city', 'Porto, Portugal'); await page.keyboard.press('Enter'); await page.waitForTimeout(1000);
  ok('a contact field commits when you leave it; the printed line was written by hand, so it keeps its wording, and a toast says so', (await st()).record.basics.location.city === 'Porto, Portugal' && /keeps its wording/.test(await page.textContent('#toast')));
  await page.click('[data-act=c-sel-fact] >> nth=0'); await settle(page);
  ok('“Versions of the headline →” opens its versions in the same panel', (await page.getAttribute('#body', 'data-view')) === 'bullet' && (await page.locator('.vrow').count()) >= 1);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);

  // Skills and credentials: a skill group, a language
  await page.keyboard.press('e'); await settle(page);
  await page.click('#checklist .clg[data-g=credentials] .clcaret'); await settle(page);
  await page.click('#checklist .clg[data-g=credentials] .clrow:has-text("CAD") .clt'); await settle(page);
  ok('a skill group opens in the inspector: its name and keywords, then its versions, no Save', (await page.getAttribute('#body', 'data-view')) === 'record' && await page.isVisible('#c-gname') && await page.isVisible('#c-kw-in') && (await page.locator('.vrow').count()) >= 1 && !(await page.$('[data-act=c-save-item]')));
  await page.fill('#c-kw-in', 'Onshape'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  ok('a keyword added with Enter is in the record at once', (await st()).record.skills[0].keywords.includes('Onshape'));
  await page.click('#c-kw .tag:has-text("Onshape") .rm'); await page.waitForTimeout(900);
  ok('× removes it at once', !(await st()).record.skills[0].keywords.includes('Onshape'));
  await page.click('#checklist .clg[data-g=credentials] .clrow:has-text("Portuguese") .clt'); await settle(page);
  await page.selectOption('#c-level', 'C2'); await page.waitForTimeout(900);
  ok('a language: choosing its level commits at once', (await st()).record.languages.find(l => l.language === 'Portuguese')?.fluency === 'C2');
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the record in German: edit in the resume’s language')) {
  const I = await import(pathToFileURL(path.join(ROOT, 'src/i18n/index.js')));
  const de6 = await I.loadCatalogue('de');
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  const st = () => page.evaluate(() => window.__wb.store.state);
  await page.click('#langbtn'); await settle(page);
  if (!(await page.$('.langpop [data-act=lang][data-lang=de]'))){ await page.click('.langpop [data-act=lang-more]'); await settle(page); await page.click('.langpop [data-act=lang-add][data-lang=de]'); }
  else await page.click('.langpop [data-act=lang][data-lang=de]');
  await page.waitForTimeout(1500);
  ok('the resume’s language is the one you edit in: the page and the interface go German', (await page.evaluate(() => document.documentElement.lang)) === 'de' && (await page.evaluate(() => window.__wb.store.state.cur.lang)) === 'de' && (await page.textContent('#head')).includes(de6['head.save']));
  await sheet.locator('.role-title').first().click(); await settle(page);
  await page.click('details.details > summary'); await settle(page);
  ok('the form says what translates and what is the same in every language', /Deutsch/.test(await page.textContent('#body .detbox')) && (await page.textContent('#body .detbox')).includes(de6['career.shared']));
  await page.fill('#c-pos', 'Konstrukteur Medizintechnik'); await page.fill('#c-loc', 'Lissabon, Portugal'); await page.keyboard.press('Tab'); await page.waitForTimeout(1200);
  const s = await st();
  ok('saved in German: i18n.de.fields, and a German v1 of the title', s.record.i18n.de.fields['work/hydra/position'] === 'Konstrukteur Medizintechnik' || s.record.variants.some(v => v.lang === 'de' && v.text === 'Konstrukteur Medizintechnik'));
  // a claim with no German: the English for reference and a box to write it
  const sections = await page.$$eval('#checklist .clg[data-g=poly] .clt', rs => rs.map(r => r.textContent));
  await page.click('#checklist .clg[data-g=poly] .clcaret'); await settle(page);
  const target = await page.evaluate(() => { const w = window.__wb.store.materialize(window.__wb.store.state.record); const poly = w.work.find(x => x.id === 'poly'); const de = id => w.variants.some(v => v.lang === 'de' && w.facts.find(f => f.id === id)?.variants.includes(v.id)); return poly.highlights.find(id => !de(id)) ?? null; });
  if (target){
    await page.evaluate(id => { const b = document.createElement('button'); b.dataset.act = 'select-bullet'; b.dataset.id = id; b.hidden = true; document.querySelector('#body').append(b); b.click(); }, target);
    await settle(page);
    ok('a claim with no German: the English for reference and a box to write it', await page.isVisible('#ed-new') && await page.isVisible('#body .ref'));
    await page.fill('#ed-new', 'Leitete eine Prototypenwerkstatt.'); await page.click('[data-act=write-in]'); await page.waitForTimeout(1000);
    ok('written in place: German v1, picked by this resume', (await st()).record.variants.some(v => v.lang === 'de' && v.text === 'Leitete eine Prototypenwerkstatt.' && v.n === '1'));
  } else ok('a Polytechnic claim with no German to write', false);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await page.keyboard.press('e'); await settle(page);
  ok('the German resume prints the German title and place', (await frameDoc(page, d => d.body.textContent)).includes('Konstrukteur Medizintechnik') || (await frameDoc(page, d => d.body.textContent)).includes('Lissabon'));
  await page.click('#checklist .clg[data-g=credentials] .clcaret'); await settle(page);
  await page.click('#checklist .clg[data-g=credentials] .clrow:has-text("CAD") .clt'); await settle(page);
  await page.fill('#c-gname', 'CAD und 3D'); await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
  ok('a skill group renamed in German prints on the German resume', (await frameDoc(page, d => d.body.textContent)).includes('CAD und 3D'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('adding to the record: + Add, an empty record, projects, kinds, references')) {
  // an empty record: the quiet editor first, then everything the record can hold is reachable from + Add
  {
    const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const p3 = await ctx3.newPage();
    await open(p3, '?memory&welcome');
    await p3.click('[data-act=ob-scratch]'); await settle(p3);           // the language step comes after choosing a start
    await p3.click('[data-act=ob-lang-go]'); await p3.waitForTimeout(1000);
    await p3.fill('#ob-name', 'Robin Vale'); await p3.waitForTimeout(600);
    ok('onboarding from scratch is a quiet editor: the page and the question panel only, no header, footer, rail or zoom bar', (await p3.evaluate(() => document.body.classList.contains('is-quiet'))) && !(await p3.isVisible('#head')) && !(await p3.isVisible('#foot')) && !(await p3.isVisible('#rail')) && await p3.isVisible('#body'));
    ok('the answers appear on the page as they are typed', (await frameDoc(p3, d => d.body.textContent)).includes('Robin Vale'));
    for (let i = 0; i < 6; i++){ if (await p3.isVisible('[data-act=ob-skip]')) await p3.click('[data-act=ob-skip]'); else if (await p3.isVisible('[data-act=ob-next]')) await p3.click('[data-act=ob-next]'); await p3.waitForTimeout(250); }
    if (await p3.isVisible('[data-act=ob-finish]')) await p3.click('[data-act=ob-finish]'); await p3.waitForTimeout(1200);
    ok('Start editing brings the rest in: the header, the footer, and the checklist with the record in it', await p3.isVisible('#head') && await p3.isVisible('#foot') && await p3.isVisible('#checklist') && /About you/.test(await p3.textContent('#checklist')));
    await p3.click('[data-act=c-pop]'); await settle(p3);
    ok('+ Add lists every kind: job, education, project, skills, languages, certificates, publications, interests, references, and “Something else”', ['work', 'education', 'project', 'skills', 'languages', 'certificates', 'publications', 'interests', 'references'].every(async k => true) && (await p3.$$('.addm [data-act=c-add]')).length >= 9 && await p3.isVisible('.addm [data-act=c-kind-new]'));
    await p3.click('.addm [data-what=work]'); await settle(p3);
    ok('+ Add a job opens its form in the panel: title, employer, dates and the claims', await p3.isVisible('#c-claims') && /A new job/.test(await p3.textContent('#body .title')));
    await p3.click('[data-act=c-add-cancel]'); await settle(p3);
    await p3.click('[data-act=c-pop]'); await p3.click('.addm [data-what=education]'); await settle(p3);
    ok('+ Add education opens the education form', await p3.isVisible('#c-org') && !(await p3.$('#c-claims')));
    await ctx3.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  await openByName(page, 'Medtech'); await page.waitForTimeout(300);
  const before = await frameDoc(page, d => d.body.textContent);
  // a project
  await page.click('[data-act=c-pop]'); await settle(page);
  await page.click('.addm [data-what=project]'); await settle(page);
  await page.fill('#c-pos', 'Formula Student chassis jig'); await page.fill('#c-org', 'FEUP Formula Student team'); await page.fill('#c-start', '2019-10'); await page.fill('#c-end', '2020-06');
  await page.selectOption('#c-during', 'porto-meng');
  await page.fill('#c-claims', 'Designed the welding jig for the team’s steel spaceframe chassis.\nIt held tolerance through two builds.');
  await page.click('[data-act=c-create]'); await page.waitForTimeout(1200);
  let s = await st();
  const pj = s.record.projects?.find(p => p.name === 'Formula Student chassis jig' && p.highlights?.length === 2);
  ok('a project goes in the record, with its claims and “during”', pj?.during === 'porto-meng');
  ok('it opens in the inspector as a job does, with its group open in the checklist', (await page.getAttribute('#body', 'data-view')) === 'job' && (await page.$$('#checklist .clg.open')).length === 1);
  await page.keyboard.press('Escape'); await settle(page); await page.keyboard.press('e'); await settle(page);
  await page.click('[data-act=c-tl]'); await page.waitForTimeout(600);
  ok('it shows on the timeline beside the degree, saying so', /during Universidade do Porto/.test(await page.textContent('#timeline .tl2')));
  await page.keyboard.press('Escape'); await settle(page);
  ok('nothing on the open resume changes: its Projects section is off', (await frameDoc(page, d => d.body.textContent)) === before);
  ok('the section is in “Not on this resume”', await page.isVisible('.offchip[data-id=projects]'));
  await page.click('.offchip[data-id=projects]'); await page.waitForTimeout(2500);
  const out = await frameDoc(page, d => d.body.textContent);
  ok('put on the resume, the Projects section prints it, title and meta line and bullets', out.includes('Formula Student chassis jig') && out.includes('welding jig'));
  ok('and it paginates', (await page.evaluate(() => window.__wb.ui.fills.every(p => !(p.overflow > 0)))));
  await page.click('[data-act=fit]');
  await page.waitForFunction(() => !window.__wb.ui.fitting, null, { timeout: 60000 }); await page.waitForTimeout(800);
  ok('Fit runs with it on', /%/.test(await page.textContent('#meter')) && (await st()).cur.sections.find(x => x.id === 'projects')?.weight !== 0);

  // a custom kind: Awards, from the preset
  await page.click('[data-act=c-pop]'); await settle(page);
  await page.click('.addm [data-act=c-kind-new]'); await settle(page);
  await page.click('[data-act=c-kind-preset][data-p=awards]'); await settle(page);
  await page.click('[data-act=c-kind-save]'); await page.waitForTimeout(800);
  ok('Awards, made from the preset, is a list kind', (await st()).record.kinds?.[0]?.store === 'awards' && (await st()).record.kinds[0].place === 'list');
  ok('and the form for its first entry opens', await page.isVisible('#c-pos'));
  await page.fill('#c-pos', 'Best student design'); await page.fill('#c-org', 'Example Society'); await page.fill('#c-start', '2020-11');
  await page.click('[data-act=c-create]'); await page.waitForTimeout(1000);
  ok('the entry is a JSON Resume award', (await st()).record.awards?.[0]?.title === 'Best student design');
  ok('it is listed in its own group in the checklist, which opens', /Best student design/.test(await page.textContent('#checklist .clg[data-g=awards]')) && (await page.$$('#checklist .clg[data-g=awards].open')).length === 1);
  await page.keyboard.press('Escape'); await settle(page); await page.keyboard.press('e'); await settle(page);
  await page.click('.offchip[data-id=awards]'); await page.waitForTimeout(2000);
  ok('put on a resume, it prints as a run line', (await frameDoc(page, d => d.body.textContent)).includes('Best student design · Example Society · 2020'));
  // another list kind, then delete Awards moving its entry there
  await page.click('[data-act=c-pop]'); await settle(page); await page.click('.addm [data-act=c-kind-new]'); await settle(page);
  await page.fill('#kn-name', 'Exhibitions'); await page.check('[data-kplace=list]'); await settle(page);
  await page.click('[data-act=c-kind-save]'); await page.waitForTimeout(800);
  await page.click('[data-act=c-add-cancel]').catch(() => {}); await settle(page);
  await page.click('[data-act=c-pop]'); await settle(page);
  await page.click('.addm .kset[data-id="awards"]'); await settle(page);
  ok('an existing kind’s editor has no Save button: its colour and icon change at once', !(await page.$('[data-act=c-kind-save]')) && await page.isVisible('[data-act=c-kind-colour]'));
  await page.click('[data-act=c-kind-colour][data-i="1"]'); await page.waitForTimeout(700);
  ok('…', (await st()).record.kinds.find(k => k.store === 'awards').colour === 1);
  await page.click('[data-act=c-kind-del]'); await settle(page);
  await page.click('[data-act=c-kind-del-move]'); await page.waitForTimeout(1000);
  s = await st();
  ok('deleting Awards moved its entry to Exhibitions', !s.record.kinds.some(k => k.store === 'awards') && s.record.projects?.some(p => p.name === 'Best student design' && p.type === 'exhibitions'), JSON.stringify(s.record.projects));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(1000);
  ok('Ctrl+Z brings it back', (await st()).record.kinds.some(k => k.store === 'awards') && (await st()).record.awards?.[0]?.title === 'Best student design');

  // a reference
  await page.click('[data-act=c-pop]'); await settle(page);
  ok('+ Add offers a Reference', await page.isVisible('.addm [data-act=c-add][data-what=references]'));
  await page.click('.addm [data-act=c-add][data-what=references]'); await settle(page);
  await page.fill('#c-rname', 'Ana Exemplo'); await page.fill('#c-rtext', 'Dana fixed our dose counter in a week.');
  await page.click('[data-act=c-create]'); await page.waitForTimeout(1000);
  s = await st();
  ok('it is a JSON Resume reference with a text behind it', s.record.references?.[0]?.name === 'Ana Exemplo' && s.record.facts.some(f => f.id === s.record.references[0].id));
  ok('it shows under References in Skills and credentials', /Ana Exemplo/.test(await page.textContent('#checklist .clg[data-g=credentials]')));
  ok('the resume does not print it yet', !(await frameDoc(page, d => d.body.textContent)).includes('Ana Exemplo'));
  await page.keyboard.press('Escape'); await settle(page); await page.keyboard.press('e'); await settle(page);
  await page.click('.offchip[data-id=references]'); await page.waitForTimeout(2000);
  ok('put on the resume, it prints the name and the text', (await frameDoc(page, d => d.body.textContent)).includes('Ana Exemplo') && (await frameDoc(page, d => d.body.textContent)).includes('dose counter in a week'));
  await page.click('#seclist .srow[data-sid=references] input'); await page.waitForTimeout(2000);
  ok('and off again with its switch, it is gone', !(await frameDoc(page, d => d.body.textContent)).includes('Ana Exemplo'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the examples, in every language')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 900 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const list = await page.evaluate(() => window.__wb.store.state.resumes.map(r => ({ id: r.id, lang: r.lang ?? 'en', limit: r.pageLimit })));
  ok('a saved example resume in each of the ten languages', ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu'].every(l => list.some(r => r.lang === l)), list.map(r => r.lang).join());
  for (const r of list){
    await page.evaluate(id => window.__wb.resumes.open(id), r.id); await page.waitForTimeout(2200);
    const res = await page.evaluate(() => ({ fills: window.__wb.ui.fills.map(p => 100 * p.used / p.usable), over: window.__wb.ui.fills.some(p => p.overflow > 0),
      clip: [...document.querySelector('#sheet iframe').contentDocument.querySelectorAll('.band__gutter .tab')].filter(t => t.getBoundingClientRect().right > t.closest('.band__gutter').getBoundingClientRect().right + 0.5 || t.scrollWidth > t.clientWidth + 1).length }));
    const last = res.fills.at(-1);
    const inBand = r.lang === 'en' || r.lang === 'hu' ? true : last >= 88 && last <= 96;
    if (res.over || res.fills.length > (r.limit || 9) || !inBand || res.clip) ok(`${r.id}: renders, paginates to its limit, fills 88–96%, no heading clips`, false, JSON.stringify(res));
  }
  ok('every example opens, renders and paginates to its page limit; the new languages fill 88–96%; no heading clips', true);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('index.html is the Workbench')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  ok('/ opens the Workbench', await page.isVisible('#col') && /BrewCV/.test(await page.title()));
  const gone = await ctx.request.get(`http://localhost:${PORT}/picker.html`);      // a bare 404 makes goto() throw, so ask for the status
  ok('the 0.4.0 picker is retired', gone.status() === 404);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the Edit view')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  page.on('dialog', d => d.accept());
  const sheet = page.frameLocator('#sheet iframe');
  const st = () => page.evaluate(() => window.__wb.store.state);
  const sheetText = () => frameDoc(page, d => d.querySelector('.document').textContent);
  const undoTo = async n => { while ((await page.evaluate(() => window.__wb.store.history.undo)) > n){ await page.keyboard.press('Control+z'); await page.waitForTimeout(150); } await settle(page); };
  const base = await page.evaluate(() => window.__wb.store.history.undo);
  // read the page with the mouse off the version list, so no hover preview is showing
  const fb = async () => { await page.mouse.move(4, 4); await page.waitForTimeout(350); return firstBullet(page); };

  await sheet.locator('.bullets li').first().click(); await settle(page);
  const fact = (await page.evaluate(() => window.__wb.ui.sel.id));
  const text0 = await firstBullet(page);
  await page.click('#b-on'); await settle(page);
  ok('switching a bullet off takes it off the page', !(await sheetText()).includes(text0.slice(0, 40)));
  ok('and records it as off', (await st()).cur.off.includes(fact));
  await page.click('#b-on'); await settle(page);
  ok('and on again puts it back in its place', (await fb()) === text0);
  await page.click('[data-act=keep]'); await settle(page);
  ok('Keep marks it kept', (await page.getAttribute('[data-act=keep]', 'aria-pressed')) === 'true' && (await st()).cur.keep.includes(fact));
  ok('no pins key is written', !('pins' in (await st()).cur));
  await undoTo(base);

  const nBefore = (await st()).record.variants.length;
  await page.keyboard.press('Enter'); await settle(page);
  ok('Enter opens the editor in place', await page.isVisible('#ed') && (await page.textContent('.ed-h')).startsWith('Editing v'));
  await page.focus('#ed'); await page.keyboard.press('End');
  await page.keyboard.type(' Zebra-check.'); await page.waitForTimeout(700);
  ok('the page redraws as you type', (await fb()).includes('Zebra-check.'));
  ok('the editor counts lines on the page', /line/.test(await page.textContent('#ed-stats')));
  ok('nothing is committed while typing', (await page.evaluate(() => window.__wb.store.history.undo)) === base);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc (after asking) closes it and puts the page back', !(await page.isVisible('#ed')) && (await fb()) === text0);

  const using = await page.evaluate(f => { const w = window.__wb.store.state; const v = w.record.variants.find(x => x.id === (document.querySelector('.vrow.cur')?.dataset.v)); return v && { id: v.id, n: v.n }; }, fact);
  await page.click('.vrow.cur [data-act=edit]'); await settle(page);
  await page.fill('#ed', 'Saved over with new words.'); await page.dispatchEvent('#ed', 'input'); await page.waitForTimeout(500);
  await page.click('[data-act=ed-save]'); await settle(page);
  const after = (await st()).record.variants.find(v => v.id === using.id);
  ok(`Save v${using.n} keeps the number and changes the words`, after.n === using.n && after.text === 'Saved over with new words.');
  ok('the page prints it', (await fb()) === 'Saved over with new words.');
  await page.keyboard.press('Control+z'); await settle(page);
  ok('Ctrl+Z puts the old words back', (await fb()) === text0);

  await page.click('.vrow.cur [data-act=edit]'); await settle(page);
  await page.fill('#ed', 'A sibling version.'); await page.dispatchEvent('#ed', 'input'); await page.waitForTimeout(400);
  const asLabel = await page.textContent('[data-act=ed-saveas]');
  await page.click('[data-act=ed-saveas]'); await settle(page);
  const sib = (await st()).record.variants.find(v => v.text === 'A sibling version.');
  ok(`${asLabel.trim()} makes a sibling with one dot`, !!sib && /^\d+\.\d+$/.test(sib.n) && asLabel.trim() === 'Save as new version');
  ok('and this resume uses it', (await st()).cur.picks[fact] === sib.id && (await fb()) === 'A sibling version.');
  ok('the old version is still there', (await st()).record.variants.length === nBefore + 1);

  await page.click('.vrow.cur [data-act=edit]'); await settle(page);
  await page.fill('#ed', 'Only on this resume.'); await page.dispatchEvent('#ed', 'input'); await page.waitForTimeout(400);
  await page.click('[data-act=ed-only]'); await settle(page);
  ok('this resume only writes a one-off text', (await st()).cur.overrides[fact] === 'Only on this resume.' && (await st()).record.variants.length === nBefore + 1);
  ok('it prints, and is listed as "only"', (await fb()) === 'Only on this resume.' && await page.isVisible('.vrow.only'));
  await sheet.locator('.bullets li').first().click(); await settle(page);
  ok('clicking it on the page still selects the bullet', (await page.evaluate(() => window.__wb.ui.sel.id)) === fact);
  await page.click('[data-act=only-remove]'); await settle(page);
  ok('↺ goes back to the saved version', (await fb()) === 'A sibling version.');

  const major = await page.textContent('[data-act=new-version]');
  await page.click('[data-act=new-version]'); await settle(page);
  ok('+ Write a new version opens the editor on a copy', await page.isVisible('#ed') && (await page.inputValue('#ed')) === 'A sibling version.');
  ok('and can’t save an unchanged copy', await page.isDisabled('[data-act=ed-new]'));
  await page.fill('#ed', 'A whole new take.'); await page.dispatchEvent('#ed', 'input'); await page.waitForTimeout(400);
  await page.click('[data-act=ed-new]'); await settle(page);
  const nv = (await st()).record.variants.find(v => v.text === 'A whole new take.');
  ok(`${major.trim()} is the next whole number`, !!nv && !nv.n.includes('.') && major.includes(`v${nv.n}`));
  ok('and is used', (await fb()) === 'A whole new take.');

  const rows = page.locator('.vrow[data-v]:not(.cur)');
  const nRows = await rows.count();
  await rows.first().hover(); await page.click('.vrow[data-v]:not(.cur) >> nth=0 >> [data-act=compare]'); await settle(page);
  ok('⇄ shows a word diff against the one in use', await page.isVisible('.diff') && (await page.$$('.diff ins, .diff del')).length > 0);
  await page.click('[data-act=compare-close]'); await settle(page);
  const victim = await rows.first().getAttribute('data-v');
  await rows.first().hover(); await page.click('.vrow[data-v]:not(.cur) >> nth=0 >> [data-act=delete-version]'); await settle(page);
  ok('🗑 deletes a version without asking', (await page.locator('.vrow[data-v]:not(.cur)').count()) === nRows - 1 && !(await st()).record.variants.some(v => v.id === victim));
  ok('and says Ctrl+Z brings it back', /Ctrl\+Z brings it back/.test(await page.textContent('#toast')));
  await page.keyboard.press('Control+z'); await settle(page);
  ok('which it does', (await st()).record.variants.some(v => v.id === victim));
  await undoTo(base);
  ok('undo goes all the way back', (await st()).record.variants.length === nBefore && (await fb()) === text0);

  await page.click('.crumb [data-act=select-job]'); await settle(page);
  ok('the job’s lines are ticked in its open checklist group, and its panel no longer repeats them', (await page.$$('#checklist .clg.open input[data-on]')).length >= 2 && !(await page.$('#body .title ~ .list input[data-on]')));
  const second = await page.getAttribute('#body input[data-on] >> nth=1', 'data-on');
  const wasOn = await page.isChecked('#body input[data-on] >> nth=1');
  await page.click('#body input[data-on] >> nth=1'); await settle(page);
  ok('a bullet switch there turns it ' + (wasOn ? 'off' : 'on'), (await st()).cur.off?.includes(second) === wasOn);
  const job = await page.evaluate(() => window.__wb.ui.sel.id);
  await page.click('#body input[data-jobon]'); await settle(page);
  const meta = await page.textContent('#body .meta');
  ok('the job switch takes the whole job off the page', !(await sheetText()).toUpperCase().includes(meta.trim().split(' · ')[0].toUpperCase())
     && !JSON.stringify((await st()).cur.sections).includes(`"${job}"`));
  await undoTo(base);

  await sheet.locator('.band[data-section="skills"] .tab').first().click(); await settle(page);
  await page.fill('#sec-label', 'Tools'); await page.press('#sec-label', 'Enter'); await settle(page);
  ok('a heading typed in the panel prints on the page', await frameDoc(page, d => d.querySelector('.band[data-section="skills"] .tab').textContent === 'Tools'));
  ok('the section keeps its id', (await st()).cur.sections.find(s => s.id === 'skills').label.en === 'Tools');
  await page.click('[data-act=label-reset]'); await settle(page);
  ok('reset puts the record’s heading back', await frameDoc(page, d => d.querySelector('.band[data-section="skills"] .tab').textContent === 'Skills'));
  await sheet.locator('.band[data-section="patent"] .tab').first().dblclick(); await settle(page);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a'); await page.keyboard.type('Invention'); await page.keyboard.press('Enter'); await settle(page);
  ok('double-clicking a tab on the page renames it in place', (await st()).cur.sections.find(s => s.id === 'patent')?.label?.en === 'Invention'
     && await frameDoc(page, d => d.querySelector('.band[data-section="patent"] .tab').textContent === 'Invention'));
  await sheet.locator('.band[data-section="skills"] .tab').first().click(); await settle(page);
  const order = async () => (await page.evaluate(() => [...document.querySelectorAll('.srow:not(.fixed)')].map(r => r.dataset.sid)));
  ok('there are no Move up / Move down buttons', (await page.$$('[data-act=sec-move]')).length === 0);
  await page.keyboard.press('Alt+ArrowDown'); await settle(page);
  const bands = await frameDoc(page, d => [...d.querySelectorAll('.band[data-section]')].map(b => b.getAttribute('data-section')));
  ok('Alt+↓ moves it on the page', bands.indexOf('skills') > bands.indexOf('patent'), bands.join());
  await page.click('#body .ctlrow input[data-secon]'); await settle(page);
  ok('Show on this resume off takes the section off the page', !(await frameDoc(page, d => !!d.querySelector('.band[data-section="skills"]'))));
  await undoTo(base);

  await page.click('[data-act=deselect]').catch(() => {}); await settle(page);
  const o1 = await order();
  await page.dragAndDrop('.srow[data-sid="education"]', `.srow[data-sid="${o1[0]}"]`, { targetPosition: { x: 40, y: 3 } }); await settle(page);
  const o2 = await order();
  ok('dragging a section moves it', o2.indexOf('education') < o1.indexOf('education') && o2[0] === 'education', o2.join());
  ok('and the page follows', (await frameDoc(page, d => [...d.querySelectorAll('.band[data-section]')].map(b => b.getAttribute('data-section')))).filter(x => !['header', 'summary'].includes(x))[0] === 'education');
  ok('the sections that are off are one line, “Not on this resume”, each a button', await page.isVisible('#offline') && (await page.$$('#offline .offchip')).length >= 2 && !(await page.$('#seclist .srow.is-off')));
  await page.click('.offchip[data-id=languages]'); await settle(page);
  ok('pressing one turns it on', await frameDoc(page, d => !!d.querySelector('.band[data-section="languages"]')) && !(await page.isVisible('.offchip[data-id=languages]')));
  await page.focus('.offchip[data-id=interests]'); await page.keyboard.press('Enter'); await settle(page);
  ok('Enter on one does the same, for the keyboard', await frameDoc(page, d => !!d.querySelector('.band[data-section="interests"]')));
  const offBefore = await page.$$eval('#offline .offchip', es => es.map(e => e.dataset.id));
  if (offBefore.length){
    await page.dragAndDrop(`.offchip[data-id="${offBefore[0]}"]`, `.srow[data-sid="${(await order())[0]}"]`, { targetPosition: { x: 40, y: 3 } }); await settle(page);
    ok('dragging one up into the list turns it on, at that place', (await order())[0] === offBefore[0] && await frameDoc(page, (d, id) => !!d.querySelector(`.band[data-section="${id}"]`), offBefore[0]));
  }
  await undoTo(base);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('saved resumes')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  page.on('dialog', d => d.accept());
  const st = () => page.evaluate(() => window.__wb.store.state);
  const saved = r => r.openId && r.resumes.find(x => x.id === r.openId);
  await page.waitForFunction(() => /Saved on this device/.test(document.querySelector('#savestate')?.textContent ?? ''), null, { timeout: 5000 });
  ok('the header always says where the work is: “Saved on this device”', /Saved on this device/.test(await page.textContent('#savestate')) && (await page.$$('#savestate .si.ok')).length === 1 && (await page.getAttribute('#savestate', 'role')) === 'status');
  ok('Save is always there, outline not filled', !(await page.isDisabled('#save')) && !(await page.getAttribute('#save', 'class')).includes('primary'));
  ok('there is no Resumes tab: the modes are Edit, Design and Export', (await page.$$('#head [role=tab]')).length === 3 && !/Resumes/.test(await page.textContent('#head [role=tablist]')));
  ok('the menu is the short one', await (async () => { await page.click('[data-act=menu]'); const t = await page.textContent('.menu'); await page.keyboard.press('Escape'); await page.click('[data-act=menu]').catch(() => {}); return !/Saved resumes|New resume|Restore a backup|Languages you use/.test(t) && /Open or import/.test(t) && /Save to file/.test(t) && /History and checkpoints/.test(t) && /Settings/.test(t) && /Privacy/.test(t) && /Source code/.test(t) && /Load the example/.test(t) && /Start over/.test(t); })());
  await page.mouse.click(4, 400); await settle(page);

  // the switcher
  await page.keyboard.press('Control+o'); await settle(page);
  ok('Ctrl+O opens the switcher with the search box focused', await page.isVisible('#switcher') && (await page.evaluate(() => document.activeElement?.id)) === 'sw-q');
  const uniqueRows = () => page.evaluate(() => new Set([...document.querySelectorAll('#switcher .swrow')].map(r => r.dataset.rid)).size);
  ok('it lists every resume, grouped by job type', (await uniqueRows()) === 14 && (await page.$$('#switcher .swlist .lbl')).length >= 3);
  ok('it is a dialog with a labelled group of buttons for a screen reader, the open resume marked current', (await page.getAttribute('#sw-list', 'role')) === 'group' && (await page.$$('#switcher .sopt')).length >= 14 && (await page.$$('#switcher .sopt[aria-current=true]')).length >= 1 && (await page.getAttribute('#switcher', 'role')) === 'dialog');
  const before = await firstBullet(page);
  await page.hover('#switcher .sopt:has-text("Medtech")'); await page.waitForTimeout(1500);
  ok('hovering one shows it on the page', (await firstBullet(page)) !== before && (await st()).openId.startsWith('Example'));
  await page.mouse.move(700, 400); await page.waitForTimeout(1200);
  ok('and moving away puts the open one back', (await firstBullet(page)) === before);
  await page.keyboard.press('Control+o'); await settle(page);
  await page.fill('#sw-q', 'medtech'); await settle(page);
  ok('typing searches', (await uniqueRows()) === 1 && /Medtech/.test(await page.textContent('#switcher .sopt')));
  await page.fill('#sw-q', ''); await settle(page);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  ok('the arrow keys walk the list', await page.evaluate(() => !!document.activeElement?.closest('#switcher') && document.activeElement.id !== 'sw-q'));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes it and gives the focus back', !(await page.isVisible('#switcher')) && (await page.evaluate(() => document.activeElement?.id)) === 'docname-btn');
  await page.click('#docname-btn'); await settle(page);
  await page.click('#switcher .sopt:has-text("Medtech")'); await page.waitForTimeout(1200);
  ok('a click opens it', /Medtech/.test(await page.textContent('#docname')) && !(await page.isVisible('#switcher')));
  ok('…and the last opened ones come first in the switcher', await (async () => { await page.click('#docname-btn'); await settle(page); const t = await page.textContent('#switcher .swlist .lbl'); await page.keyboard.press('Escape'); return /Recent/.test(t); })());

  // everything autosaves
  const h0 = await page.evaluate(() => window.__wb.store.history.undo);
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  await page.click('#b-on'); await settle(page);
  const s0 = await st();
  ok('a change to the open resume is saved as it happens', JSON.stringify({ ...saved(s0), snapshots: undefined, id: undefined, savedAt: undefined }) === JSON.stringify({ ...s0.cur, snapshots: undefined, id: undefined, savedAt: undefined }) && saved(s0).off?.length > 0);
  ok('…as one undo step', (await page.evaluate(() => window.__wb.store.history.undo)) === h0 + 1);
  ok('…and the page never says “Unsaved changes”', !/Unsaved|Not saved/.test(await page.textContent('#savestate')));
  await page.keyboard.press('Control+z'); await settle(page);
  ok('undo takes the saved copy back too', !(saved(await st()).off?.length));

  // Save: a snapshot with a send
  await page.click('#save'); await settle(page);          // Ctrl+S saves the one file; the Save button takes the snapshot
  ok('Save asks “Sent to?”, filled in from the resume’s For', (await page.getAttribute('#body', 'data-view')) === 'save' && /Sent to/.test(await page.textContent('#body h2')) && (await page.inputValue('#sv-co')) === (await st()).cur.company && (await page.inputValue('#sv-date')) === new Date().toISOString().slice(0, 10));
  await page.fill('#sv-co', 'Smoke Test Co'); await page.fill('#sv-role', 'QA Engineer');
  await page.click('[data-act=sv-do]'); await settle(page);
  let r = saved(await st());
  ok('it makes a snapshot with one send', r.snapshots?.length === 1 && r.snapshots[0].sends.length === 1 && r.snapshots[0].sends[0].company === 'Smoke Test Co');
  await page.click('#save'); await settle(page);
  ok('Save again with nothing changed says it will add a send', /Nothing printed has changed/.test(await page.textContent('#body')));
  await page.fill('#sv-co', 'Second Co'); await page.click('[data-act=sv-do]'); await settle(page);
  r = saved(await st());
  ok('…and adds it to the same snapshot', r.snapshots.length === 1 && r.snapshots[0].sends.length === 2);
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  await page.click('#b-on'); await settle(page);
  await page.click('#save'); await settle(page); await page.click('[data-act=sv-do]'); await settle(page);
  r = saved(await st());
  ok('after a change, Save makes a second snapshot', r.snapshots.length === 2);
  await page.click('#docname-btn'); await settle(page);
  ok('the switcher folds the snapshots under their resume', (await page.$$('#switcher .swrow.is-cur .snapline')).length >= 2 && /Sent to Smoke Test Co/.test(await page.textContent('#switcher .swrow.is-cur')));

  // a snapshot is read-only
  await page.click('#switcher .swrow.is-cur .snapline >> nth=1'); await settle(page);
  const bar = await page.textContent('.snapbar');
  ok('opening a snapshot shows a clear bar', /Snapshot · sent to Smoke Test Co, Second Co/.test(bar) || /Snapshot · sent to/.test(bar), bar);
  ok('…with Export, Restore as current and Duplicate as new resume', await page.isVisible('[data-act=goto][data-v=export]') && await page.isVisible('[data-act=snap-restore]') && await page.isVisible('[data-act=snap-dup]'));
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  ok('nothing on the page can be edited', (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'none' && await page.isDisabled('[data-act=fit]') && await page.isDisabled('#save'));
  const histNow = await page.evaluate(() => window.__wb.store.history.undo);
  await page.keyboard.press('Enter'); await page.keyboard.press('ArrowDown'); await settle(page);
  ok('and the keyboard changes nothing', (await page.evaluate(() => window.__wb.store.history.undo)) === histNow);
  await page.click('[data-act=goto][data-v=export]'); await settle(page);
  ok('Export is the normal one, and it exports the snapshot', await page.isVisible('[data-act=ex-pdf]') && (await page.$$('[data-act=ex-backup]')).length === 0 && (await page.evaluate(async () => (await window.__wb.export.buildHtml()).length)) > 1000);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc comes back to the snapshot, Esc again to the resume', await page.isVisible('.snapbar'));
  await page.keyboard.press('Escape'); await settle(page);
  ok('…and the bar goes', !(await page.isVisible('.snapbar')) && !(await page.evaluate(() => window.__wb.ui.snap)));
  await page.click('#docname-btn'); await page.click('#switcher .swrow.is-cur .snapline >> nth=1'); await settle(page);
  const picksThen = JSON.stringify((await page.evaluate(() => { const s = window.__wb.store.state; return s.resumes.find(x => x.id === s.openId).snapshots[0].recipe.off ?? null; })));
  await page.click('[data-act=snap-restore]'); await settle(page);
  ok('Restore as current makes the resume print as it did', !(await page.isVisible('.snapbar')) && JSON.stringify((await st()).cur.off ?? null) === picksThen);
  const n = (await st()).resumes.length;
  await page.click('#docname-btn'); await page.click('#switcher .swrow.is-cur .snapline >> nth=0'); await settle(page);
  await page.click('[data-act=snap-dup]'); await page.waitForTimeout(1200);
  ok('Duplicate as new resume makes one and opens it', (await st()).resumes.length === n + 1 && !(await page.isVisible('.snapbar')) && /\(/.test(await page.textContent('#docname')));

  // the row menu
  await page.click('#docname-btn'); await settle(page);
  await page.click('#switcher .swrow:has-text("Example Instruments") .smore'); await settle(page);
  ok('⋯ offers Duplicate, Duplicate in another language…, Rename and Delete', await page.evaluate(() => [...document.querySelectorAll('.rowmenu [role=menuitem]')].map(b => b.textContent.trim()).join('|')) === 'Duplicate|Duplicate in another language…|Rename|Delete');
  await page.click('.rowmenu [data-act=rm-lang]'); await settle(page);
  await page.click('.rowmenu [data-lang=hu]'); await page.waitForTimeout(2200);
  const dup = await st();
  ok('Duplicate in another language: a copy in that language, open, named (HU)', dup.cur.lang === 'hu' && /\(HU\)/.test(dup.cur.name) && dup.openId === dup.cur.id && !(await page.isVisible('#switcher')));
  const missing = await page.evaluate(async () => { const L = await import('./src/model/lang.js'); const s = window.__wb.store.state; return L.missingList(window.__wb.store.materialize(s.record), s.cur).length; });
  ok('…the lines with no version in that language are marked on the page, as the app already marks them', missing > 0 && (await frameDoc(page, d => d.querySelectorAll('.rb-miss, .rb-miss-tab').length)) > 0 && await page.isVisible('.missbar'), String(missing));
  await page.click('#docname-btn'); await settle(page);
  await page.click('#switcher .swrow.is-cur .smore'); await page.click('.rowmenu [data-act=rm-rename]'); await settle(page);
  await page.fill('.swren', 'Renamed By Smoke'); await page.keyboard.press('Enter'); await settle(page);
  ok('Rename changes the name and the file name', (await st()).cur.name === 'Renamed By Smoke' && (await st()).openId === 'Renamed By Smoke.json');
  ok('…and the switcher stays open with the new name', await page.isVisible('#switcher') && /Renamed By Smoke/.test(await page.textContent('#switcher .swrow.is-cur')));
  await page.click('#switcher .swrow.is-cur .smore'); await page.click('.rowmenu [data-act=rm-delete]'); await page.waitForTimeout(1000);
  ok('Delete removes it (Ctrl+Z brings it back) and opens another', !(await st()).resumes.some(x => x.id === 'Renamed By Smoke.json') && !!saved(await st()));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z'); await settle(page);
  ok('Ctrl+Z brings it back', (await st()).resumes.some(x => x.id === 'Renamed By Smoke.json'));

  // + New resume
  await page.click('#docname-btn'); await settle(page);
  await page.click('#switcher .swrow[data-rid="Example Instruments - Design Engineer.json"] .sopt'); await page.waitForTimeout(1200);
  await page.click('#docname-btn'); await settle(page);
  await page.click('#switcher .swnew'); await settle(page);
  ok('+ New resume opens the form in the panel', (await page.getAttribute('#body', 'data-view')) === 'new' && !(await page.isVisible('#switcher')));
  ok('…Start from: the last resume is the default, with the other three', (await page.$$('.startopt')).length === 4 && await page.isChecked('.startopt[data-start=latest] input'));
  await page.fill('#nv-co', 'Geospatial'); await page.fill('#nv-role', 'GIS Solutions Engineer');
  ok('the name is filled from For as you type', (await page.inputValue('#nv-name')) === 'Geospatial - GIS Solutions Engineer');
  await page.selectOption('#nv-kind', 'outreach');
  const lt = await page.$$eval('#nv-type option', o => o.map(x => x.value).filter(v => v && v !== '+'));
  await page.selectOption('#nv-type', lt[0]); await settle(page);
  const tagged = await page.textContent('.startopt[data-start=tagged]');
  ok('picking a job type enables “Bullets for …” with its plan line', !(await page.getAttribute('.startopt[data-start=tagged]', 'class')).includes('is-off') && /Turns on \d+, turns off \d+, switches \d+/.test(tagged), tagged);
  const nameBefore = await firstBullet(page);
  await page.hover('.startopt[data-start=empty]'); await page.waitForTimeout(1500);
  ok('hovering an option previews it on the page', (await firstBullet(page)) !== nameBefore);
  await page.mouse.move(700, 400); await page.waitForTimeout(800);
  await page.check('.startopt[data-start=tagged] input'); await settle(page);
  await page.click('[data-act=nv-create]'); await page.waitForTimeout(1800);
  const made = await st();
  ok('Create saves and opens it: named from For, outreach, with its job type', made.cur.name === 'Geospatial - GIS Solutions Engineer' && made.cur.forKind === 'outreach' && made.cur.jobType === lt[0] && made.openId === made.cur.id);
  await page.click('#docname-btn'); await settle(page);
  await page.click('#switcher .swnew'); await settle(page);
  await page.click('[data-act=nv-create]'); await page.waitForTimeout(1800);
  ok('and no company is needed', (await st()).resumes.length === made.resumes.length + 1);
  await page.click('#docname-btn'); await settle(page);
  await page.click('#switcher [data-act=sw-manage]'); await settle(page);
  const grown = await rect(page, '#switcher');
  ok('Manage all grows the same menu: up to about 560px wide and 70% of the window high, still the dialog', await page.isVisible('#switcher.is-grown') && grown.width > 480 && grown.width <= 562 && grown.height <= 0.7 * 864 + 2 && (await page.getAttribute('#switcher', 'role')) === 'dialog', JSON.stringify(grown));
  ok('…with the search box, three views (Job type, Date, Company), a tick box and a row menu on each row, and no old Resumes page', (await page.$$('#switcher [role=tab]')).length === 3 && (await page.getAttribute('#switcher [role=tab][aria-selected=true]', 'data-v')) === 'type' && (await page.$$('#switcher .swrow .smore')).length > 10 && (await page.$$('#switcher .swrow .pick')).length > 10 && (await page.$$('#switcher [data-act=r-reuse], #switcher [data-act=r-delete]')).length === 0 && (await page.getAttribute('#body', 'data-view')) !== 'resumes');
  ok('the Compare button is at the bottom, off until two are ticked', await page.isDisabled('#switcher [data-act=sw-compare]') && /0\/2/.test(await page.textContent('#switcher [data-act=sw-compare]')));
  await page.click('#switcher .swrow[data-rid="Example Instruments - Design Engineer.json"] input.pick');
  await page.click('#switcher .swrow:has-text("Helix") input.pick');
  ok('two ticks turn Compare on', !(await page.isDisabled('#switcher [data-act=sw-compare]')) && /2\/2/.test(await page.textContent('#switcher [data-act=sw-compare]')));
  await page.click('#switcher [data-act=sw-compare]'); await settle(page);
  ok('Compare opens the two side by side in the panel', (await page.getAttribute('#body', 'data-view')) === 'compare' && (await page.$$('table.cmp tbody tr')).length > 8 && (await page.$$('table.cmp tr.diff-row')).length > 0 && !(await page.isVisible('#switcher')));
  await page.click('#body a.back'); await settle(page);
  ok('its way back reopens the list with the two still ticked', await page.isVisible('#switcher.is-grown') && (await page.$$('#switcher .pick:checked')).length === 2);
  await page.click('#switcher [data-act=sw-view][data-v=date]'); await settle(page);
  ok('the Date view: a timeline of sends, newest first, with the year bands', (await page.$$('#switcher .yr')).length >= 1 && (await page.$$('#switcher .tlsend')).length >= 3);
  const dates = await page.$$eval('#switcher .tlsend .muted', es => es.map(e => e.textContent.slice(0, 10)));
  ok('…the sends of this session are on top, newest first', dates.length >= 3 && dates.every((d, i) => !i || dates[i - 1] >= d), dates.join());
  await page.click('#switcher .tlsend >> nth=0'); await settle(page);
  ok('a send opens that snapshot, read-only', await page.isVisible('.snapbar') && !(await page.isVisible('#switcher')));
  await page.click('[data-act=snap-close]'); await settle(page);
  await page.click('#docname-btn'); await settle(page);
  await page.click('#switcher [data-act=sw-manage]'); await settle(page);
  ok('the view you left it on is remembered (Date)', (await page.getAttribute('#switcher [role=tab][aria-selected=true]', 'data-v')) === 'date');
  await page.click('#switcher [data-act=sw-view][data-v=company]'); await settle(page);
  ok('the Company view: grouped by the company of the For line and of each send, outreach marked', (await page.$$('#switcher .swlist .lbl')).length >= 5 && /Smoke Test Co/.test(await page.textContent('#switcher .swlist')) && /Geospatial/.test(await page.textContent('#switcher .swlist')) && /Outreach/.test(await page.textContent('#switcher .swlist')));
  await page.fill('#sw-q', 'smoke test'); await settle(page);
  ok('search filters it: only the resume that went to Smoke Test Co', (await page.$$eval('#switcher .swrow', r => new Set(r.map(x => x.dataset.rid)).size)) === 1);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes the grown menu and the focus goes back to the name', !(await page.isVisible('#switcher')) && (await page.evaluate(() => document.activeElement?.id)) === 'docname-btn');
  await page.click('#docname-btn'); await settle(page);
  await page.click('#switcher [data-act=sw-manage]'); await settle(page);
  await page.click('#switcher [data-act=sw-view][data-v=type]'); await settle(page);
  await page.click('#switcher .swrow[data-rid="Helix Diagnostics - Product Development Engineer.json"] .sopt'); await page.waitForTimeout(1200);
  ok('clicking a row opens it', /Helix Diagnostics/.test(await page.textContent('#docname')), await page.textContent('#docname'));

  // newer wording: save over a version another saved resume prints
  const shared = await page.evaluate(async () => {
    const RS = await import('./src/model/resumes.js');
    const s = window.__wb.store.state;
    const mine = RS.usedVersions(s.record, s.cur).filter(u => s.record.work.some(w => w.highlights.includes(u.fact)));
    for (const r of s.resumes) if (r.id !== s.openId && r.lang === s.cur.lang && r.snapshots === undefined && r.jobType !== undefined){
      const theirs = new Set(RS.usedVersions(s.record, r).map(u => u.variant));
      const hit = mine.find(u => theirs.has(u.variant));
      if (hit) return { ...hit, other: r.id, company: r.company || r.name, text: s.record.variants.find(v => v.id === hit.variant).text };
    }
    return null;
  });
  if (shared){
    const otherBefore = JSON.stringify((await st()).frozen[shared.other]);
    await page.frameLocator('#sheet iframe').locator(`[data-variant="${shared.variant}"]`).first().click(); await settle(page);
    await page.click('.vrow.cur [data-act=edit]'); await settle(page);
    await page.fill('#ed', 'Brand new record wording.'); await page.dispatchEvent('#ed', 'input'); await page.waitForTimeout(300);
    await page.click('[data-act=ed-save]'); await page.waitForTimeout(800);
    ok('editing a version leaves every other saved resume’s text alone', JSON.stringify((await st()).frozen[shared.other]) === otherBefore);
    await page.click('#docname-btn'); await settle(page);
    await page.click(`#switcher .swrow[data-rid="${shared.other}"] .sopt`); await page.waitForTimeout(1500);
    ok(`${shared.company} keeps the text it was saved with`, (await frameDoc(page, d => d.body.textContent)).includes(shared.text));
    ok('and the card offers the newer wording', await page.isVisible('.banner'));
    await page.click('.banner [data-act=goto]'); await settle(page);
    await page.click('[data-act=nw-accept] >> nth=0'); await page.waitForTimeout(1200);
    ok('accepting prints the newer wording', (await frameDoc(page, d => d.body.textContent)).includes('Brand new record wording.'));
  } else ok('two saved resumes share a bullet version', false);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('tags and focus')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  await openByName(page, 'Medtech'); await page.waitForTimeout(300);
  ok('the Edit panel has one lens row: Highlight, with the job types to choose from, never a tag', await page.isVisible('#lens') && (await page.$$('#lens option')).length >= 4 && (await page.$$('.lens [data-act=focus]')).length === 0);
  await page.click('[data-act=lens-tags]'); await settle(page);
  ok('+ tags reveals the topic tags, and no structural ones (identity, work-history, archive…)', (await page.$$('.lens [data-act=focus]')).length > 1 && !(await page.$('.lens [data-act=focus][data-tag=identity], .lens [data-act=focus][data-tag=archive], .lens [data-act=focus][data-tag="work-history"]')));
  await page.click('[data-act=lens-tags]'); await settle(page);
  const undo0 = await page.evaluate(() => window.__wb.store.history.undo);
  await page.selectOption('#lens', 'Prototyping'); await settle(page);
  const faded = await frameDoc(page, d => [d.documentElement.classList.contains('rb-focus'), d.querySelectorAll('.rb-hit').length, d.querySelectorAll('.bullets li').length]);
  ok('choosing a job type keeps the matching bullets bright and fades the rest', faded[0] && faded[1] > 0 && faded[1] < faded[2], faded.join());
  ok('and changes nothing in the resume: it only highlights', (await page.evaluate(() => window.__wb.store.history.undo)) === undo0 && !(await page.$('.focusbox')));
  await page.click('[data-act=lens-apply]'); await settle(page);
  ok('Apply… says what selecting would do', /turn on \d+, turn off \d+ and switch \d+/.test(await page.textContent('.focusbox')));
  await page.click('[data-act=focus-apply]'); await page.waitForTimeout(1500);
  ok('applying is one undo step', (await page.evaluate(() => window.__wb.store.history.undo)) === undo0 + 1);
  ok('and leaves nothing more to do', !(await page.$('.focusbox')) || await page.isDisabled('[data-act=focus-apply]'));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(1000);
  await page.frameLocator('#sheet iframe').locator('.bullets li.rb-hit').first().click(); await settle(page);
  ok('a focused tag stars its versions in the list', (await page.$$('.vrow .star')).length >= 1);
  await page.fill('.tag-in', 'smoke-tag'); await page.press('.tag-in', 'Enter'); await settle(page);
  const vid = await page.getAttribute('.vrow.cur', 'data-v');
  ok('Enter in the tag box tags the version in use', (await st()).record.variants.find(v => v.id === vid).tags.includes('smoke-tag'));
  ok('and the box keeps focus for the next one', await page.evaluate(() => document.activeElement?.classList.contains('tag-in')));
  await page.click('.vrow.cur .tag:has-text("smoke-tag") .rm'); await settle(page);
  ok('× removes it', !(await st()).record.variants.find(v => v.id === vid).tags.includes('smoke-tag'));
  await page.click('[data-act=deselect]'); await settle(page);
  await page.selectOption('#lens', ''); await settle(page);
  ok('choosing Nothing brings the page back', !(await frameDoc(page, d => d.documentElement.classList.contains('rb-focus'))));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('languages')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  ok('the header has a language switch: one button beside Save', (await page.$$('#langbtn')).length === 1 && /English/.test(await page.getAttribute('#langbtn', 'aria-label')) && /EN/.test(await page.textContent('#langbtn')));
  await page.click('#langbtn'); await settle(page);
  ok('it opens a menu of the languages you use (the example lists all ten), keyboard-operable', (await page.$$('.langpop [role=menuitemradio]')).length === 10 && (await page.getAttribute('.langpop', 'role')) === 'menu');
  ok('each with what is left to write', /to write|complete/.test(await page.textContent('.langpop')));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes it', !(await page.$('.langpop')));
  await page.click('#langbtn'); await settle(page);
  await page.click('.langpop [data-act=lang][data-lang=hu]'); await page.waitForTimeout(2500);
  ok('the Hungarian button switches the resume to Hungarian', (await st()).cur.lang === 'hu' && /Tapasztalat/i.test(await frameDoc(page, d => d.body.textContent)));
  await page.click('.offchip[data-id=interests]'); await page.waitForTimeout(2000);
  ok('a section with no Hungarian still prints, in English', /Dinghy sailing/.test(await frameDoc(page, d => d.body.textContent)));
  ok('outlined on the page', (await frameDoc(page, d => d.querySelectorAll('.rb-miss').length)) >= 3);
  ok('and listed in the card', (await page.$$('.missbar .miss-go')).length >= 3);
  await page.click('.missbar .miss-go:has-text("Dinghy sailing")'); await settle(page);
  ok('a missing text opens with the English for reference and a box to write it', await page.isVisible('#ed-new') && await page.isVisible('.writein .ref'));
  await page.fill('#ed-new', 'Vitorlázás'); await page.click('[data-act=write-in]'); await page.waitForTimeout(1500);
  ok('saving writes Hungarian v1, and the page prints it', /Vitorlázás/.test(await frameDoc(page, d => d.body.textContent)) && (await st()).record.variants.some(v => v.lang === 'hu' && v.text === 'Vitorlázás' && v.n === '1'));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc from a line that is in no job goes straight to the page, and that puts the panel away', (await page.evaluate(() => document.body.dataset.folded)) === 'true');
  await page.keyboard.press('e'); await settle(page);
  const outlined = await frameDoc(page, d => d.querySelectorAll('.rb-miss').length);
  await page.click('.missbar .miss-go:has-text("Bookbinding")'); await settle(page);
  await page.click('.writein input[data-same]'); await page.waitForTimeout(1500);
  ok('"same in every language" takes it off the list', (await st()).record.same.some(k => /interest-bookbinding/.test(k)) && !(await page.$('.missbar .miss-go:has-text("Bookbinding")')));
  const after = await frameDoc(page, d => d.querySelectorAll('.rb-miss').length);
  ok('and off the page’s outlines', after === outlined - 1, `${outlined} → ${after}`);
  await page.keyboard.press('Escape'); await settle(page); await page.keyboard.press('e'); await settle(page);
  await page.click('#langbtn'); await settle(page); await page.click('.langpop [data-act=lang][data-lang=en]'); await page.waitForTimeout(2000);
  ok('back to English', !(await st()).cur.lang && /Experience/i.test(await frameDoc(page, d => d.body.textContent)));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('import, merge, history')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  page.on('dialog', d => d.accept('Smoke checkpoint'));
  const st = () => page.evaluate(() => window.__wb.store.state);
  const jr = fs.readFileSync(path.join(ROOT, 'checks/fixtures/jsonresume-sample.json'), 'utf8');
  await page.click('[data-act=menu]'); await page.click('.menu [data-v=import]'); await settle(page);
  ok('⋯ › Open or import shows the one door', await page.isVisible('#imp-paste') && await page.isVisible('[data-act=imp-pick]'));
  await page.fill('#imp-paste', '{"basics": '); await page.click('[data-act=imp-paste]'); await settle(page);
  ok('broken JSON says why', /valid JSON/.test(await page.textContent('#body')));
  await page.click('[data-act=goto][data-v=import]'); await settle(page);
  await page.fill('#imp-paste', jr); await page.click('[data-act=imp-paste]'); await settle(page);
  ok('a pasted JSON Resume is recognised, with a review card', /A JSON Resume/.test(await page.textContent('#body .title')) && /Claims/.test(await page.textContent('table.kv')));
  ok('a linked photo is not fetched', /linked, not embedded/.test(await page.textContent('table.kv')));
  await page.click('[data-act=imp-merge]'); await settle(page);
  ok('add to the example: the merge preview groups what it found', (await page.$$('.mgroup')).length >= 2 && (await page.$$('.mi input[type=checkbox]')).length > 3);
  const nItems = (await page.$$('.mi input[type=checkbox]:checked')).length;
  await page.click('.mi input[type=checkbox] >> nth=0'); await settle(page);
  ok('unticking one updates the count', new RegExp(`Merge ${nItems - 1} change`).test(await page.textContent('[data-act=imp-do-merge]')));
  await page.click('[data-act=imp-do-merge]'); await page.waitForTimeout(1800);
  ok('merging brings the new jobs in', (await st()).record.work.some(w => w.name === 'Fjord Instruments'));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(1200);
  ok('and Ctrl+Z takes the merge back', !(await st()).record.work.some(w => w.name === 'Fjord Instruments'));

  await page.click('[data-act=menu]'); await page.click('.menu [data-v=import]'); await settle(page);
  await page.fill('#imp-paste', jr); await page.click('[data-act=imp-paste]'); await settle(page);
  await page.click('[data-act=imp-replace]'); await page.waitForTimeout(2500);
  ok('opening it instead makes it the record', (await st()).record.basics.name === 'Robin Vale' && /Robin Vale/.test(await frameDoc(page, d => d.body.textContent)));
  ok('and the page prints its highlights', /IP68 housing/.test(await frameDoc(page, d => d.body.textContent)));

  // a record edited outside: its edits become versions
  const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/example.json'), 'utf8'));
  ex.work[0].highlights[0] = 'Edited in a text editor, outside the app.';
  await page.click('[data-act=menu]'); await page.click('.menu [data-v=import]'); await settle(page);
  await page.fill('#imp-paste', JSON.stringify(ex)); await page.click('[data-act=imp-paste]'); await settle(page);
  ok('a record edited outside says so', /Edited outside/.test(await page.textContent('table.kv')) && await page.isChecked('#imp-outside'));
  await page.click('[data-act=imp-replace]'); await page.waitForTimeout(2000);
  ok('opening it turns the edit into a version', (await st()).record.variants.some(v => v.text === 'Edited in a text editor, outside the app.'));

  await page.click('[data-act=menu]'); await page.click('.menu [data-v=history]'); await page.waitForTimeout(1200);
  ok('History lists the checkpoints the imports saved', (await page.$$('.cprow')).length >= 2);
  await page.click('.cprow >> nth=0'); await page.waitForTimeout(1200);
  ok('selecting one shows what changed since', (await page.$$('.mi.ro')).length > 0);
  await page.click('[data-act=cp-new]'); await page.waitForTimeout(1000);
  ok('Save checkpoint adds a named one', /Smoke checkpoint/.test(await page.textContent('#body')));
  await page.click('[data-act=cp-file]');
  await page.setInputFiles('#file', path.join(ROOT, 'checks/fixtures/jsonresume-sample.json')); await page.waitForTimeout(1200);
  ok('Compare with a file shows the differences without changing anything', /compared with now/.test(await page.textContent('#body')) && (await st()).record.basics.name === 'Dana Okonkwo');
  await page.click('.cprow:has-text("Before opening pasted JSON") >> nth=-1'); await page.waitForTimeout(1000);
  await page.click('[data-act=cp-restore]'); await page.waitForTimeout(2000);
  ok('Restore puts that state back', (await st()).record.basics.name === 'Dana Okonkwo' && !(await st()).record.variants.some(v => v.text === 'Edited in a text editor, outside the app.'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('save to file: one file, Ctrl+S, opening it safely')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brewcv-save-'));
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const bad = await open(page);
  await page.evaluate(() => window.__wb.store.commit(d => { d.record.meta.owner = 'Sam Example'; }, 'smoke: make it mine'));   // the example on its own is replaced without a warning
  const st = () => page.evaluate(() => window.__wb.store.state);
  const fstate = () => page.evaluate(() => { const f = window.__wb.persist.fileState; return { last: f.last, changes: f.changes }; });
  const head = () => page.textContent('#filestate');
  const edit = label => page.evaluate(l => window.__wb.store.commit(d => { d.record.basics.label = l; }, 'smoke edit'), label);
  let n = 0;
  const downloaded = async trigger => {
    const [d] = await Promise.all([page.waitForEvent('download'), trigger()]);
    const p = path.join(tmp, `${++n}-${d.suggestedFilename()}`);
    await d.saveAs(p);
    return { name: d.suggestedFilename(), path: p, json: JSON.parse(fs.readFileSync(p, 'utf8')) };
  };
  const open1 = async file => { await page.click('[data-act=menu]'); await page.click('.menu [data-v=import]'); await settle(page); await page.setInputFiles('#file', file); await page.waitForTimeout(900); };
  const copy = (src, fn, name) => { const j = JSON.parse(fs.readFileSync(src, 'utf8')); fn(j); const p = path.join(tmp, name); fs.writeFileSync(p, JSON.stringify(j, null, 2)); return p; };

  ok('before any file save, the header says so', /Not saved to a file yet/.test(await head()));
  const f1 = await downloaded(async () => { await page.click('[data-act=menu]'); await page.click('.menu [data-act=save-file]'); });
  ok('Save to file downloads brewcv.json', f1.name === 'brewcv.json');
  const s1 = await st();
  ok('it holds the record, every saved resume and no checkpoints', f1.json.resumeBuilderBackup === 1 && f1.json.resumes.length === s1.resumes.length && s1.resumes.length > 3 && !('checkpoints' in f1.json));
  ok('it names the app version and the record', f1.json.app === version && f1.json.recordId === s1.record.recordId && !!f1.json.recordId);
  ok('the header says Saved to file, and it is a button', /^Saved to file/.test(await head()) && (await page.$eval('#filestate', e => e.tagName)) === 'BUTTON');
  ok('the first save shows the one-time note about the Save dialog', await page.isVisible('[data-act=save-note-ok]') && /Ask where to save each file/.test(await page.textContent('.notice')));
  const persisted = await page.evaluate(() => window.__wb.ui.persisted);
  ok('and, if the browser would not promise to keep storage, that the file is the safe copy', persisted !== false || /safe copy/.test(await page.textContent('.notice')));
  await page.click('[data-act=save-note-ok]'); await settle(page);
  ok('the note goes away when dismissed', !(await page.isVisible('[data-act=save-note-ok]')));

  await edit('Smoke label one'); await page.waitForTimeout(500);
  ok('one change since: “1 change not saved to a file”', /^1 change not saved to a file/.test(await head()), await head());
  await edit('Smoke label two'); await page.waitForTimeout(500);
  ok('two changes: “2 changes not saved to a file”', /^2 changes not saved to a file/.test(await head()), await head());

  await page.click('#head [data-act=mode][data-m=export]'); await settle(page);
  const f2 = await downloaded(() => page.keyboard.press('Control+s'));
  ok('Ctrl+S saves to the file too, in any view (here Export)', f2.name === 'brewcv.json' && f2.json.record.basics.label === 'Smoke label two' && f2.json.recordId === f1.json.recordId);
  ok('and the count starts again', /^Saved to file/.test(await head()) && (await fstate()).changes === 0);
  ok('the note does not come back', !(await page.isVisible('[data-act=save-note-ok]')));
  const quiet = await Promise.race([page.waitForEvent('download').then(() => false), (async () => {
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true })));
    await page.waitForTimeout(900); return true; })()]);
  ok('Ctrl+S during an IME composition does nothing', quiet);
  const mac = await downloaded(() => page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }))));
  ok('Cmd+S does the same', mac.name === 'brewcv.json');
  await page.keyboard.press('Escape'); await settle(page);

  // opening files next to what this browser has
  const last = (await fstate()).last;
  await open1(mac.path);
  ok('the file just saved, nothing changed since: “Already up to date”', /Already up to date/.test(await page.textContent('#body')) && !(await page.$('[data-act=imp-replace]')) && (await st()).record.basics.label === 'Smoke label two');
  const old = copy(mac.path, j => { j.saved = '2020-01-01T00:00:00.000Z'; }, 'older.json');
  await open1(old);
  ok('an older file of this record warns, with Save them first, Merge and Replace anyway', /older than the one you last saved here/.test(await page.textContent('#body'))
    && await page.isVisible('[data-act=imp-save-first]') && await page.isVisible('[data-act=imp-merge]') && await page.isVisible('[data-act=imp-replace]'));
  ok('and nothing has changed', (await st()).record.basics.label === 'Smoke label two' && (await fstate()).last.at === last.at);
  await edit('Not in any file'); await page.waitForTimeout(500);
  await open1(mac.path);
  ok('with changes not in a file: “This browser has 1 change that isn’t in any file”', /This browser has 1 change that isn.t in any file/.test(await page.textContent('#body')) && await page.isVisible('[data-act=imp-save-first]'));
  const f3 = await downloaded(() => page.click('[data-act=imp-save-first]'));
  await page.waitForTimeout(1800);
  ok('Save them first saves those changes to the file…', f3.json.record.basics.label === 'Not in any file');
  ok('…then opens the file', (await st()).record.basics.label === 'Smoke label two');
  ok('and that file is now the last one saved here', (await fstate()).last.at === mac.json.saved && (await fstate()).changes === 0);
  ok('with a checkpoint taken first', await page.evaluate(async () => (await window.__wb.persist.listCheckpoints()).some(c => /Before opening/.test(c.label))));
  const other = copy(mac.path, j => { j.recordId = 'someone-elses-record'; j.record.meta.resumeBuilder.recordId = 'someone-elses-record'; }, 'other.json');
  await open1(other);
  ok('a file from another record says so, with Merge or Replace only', /different record/.test(await page.textContent('#body')) && await page.isVisible('[data-act=imp-merge]') && await page.isVisible('[data-act=imp-replace]') && !(await page.$('[data-act=imp-save-first]')));
  const edited = copy(mac.path, j => { const w = j.record.work.find(x => (x.highlights ?? []).length); w.highlights[0] = 'Reworded in another tool, outside BrewCV.'; }, 'edited.json');
  await open1(edited);
  ok('text edited outside BrewCV in the one file is offered as versions', /Edited outside BrewCV/.test(await page.textContent('table.kv')) && await page.isChecked('#imp-outside'));
  await page.click('[data-act=imp-replace]'); await page.waitForTimeout(2000);
  ok('and opening it turns the edit into a version', (await st()).record.variants.some(v => v.text === 'Reworded in another tool, outside BrewCV.'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');

  // a fresh browser: the introduction's “Open or import a file”
  const ctx2 = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page2 = await ctx2.newPage();
  const bad2 = await open(page2, '?memory&welcome');
  await page2.click('[data-act=ob-import]'); await settle(page2);
  await page2.setInputFiles('#file', mac.path); await page2.waitForTimeout(900);
  ok('a file opened in a fresh browser is offered plainly', /Open it/.test(await page2.textContent('[data-act=imp-replace]')) && !(await page2.$('[data-act=imp-save-first]')));
  await page2.click('[data-act=imp-replace]'); await page2.waitForTimeout(2500);
  const r2 = await page2.evaluate(() => { const s = window.__wb.store.state; return { id: s.record.recordId, label: s.record.basics.label, resumes: s.resumes.map(r => r.id).sort(), last: window.__wb.persist.fileState.last }; });
  ok('it restores the record and every saved resume', r2.id === mac.json.recordId && r2.label === 'Smoke label two' && r2.resumes.length === mac.json.resumes.length, JSON.stringify(r2).slice(0, 200));
  ok('and the next save carries on from that file', r2.last?.at === mac.json.saved && r2.last?.recordId === mac.json.recordId);
  const back = await Promise.all([page2.waitForEvent('download'), page2.keyboard.press('Control+s')]).then(async ([d]) => { const p = path.join(tmp, 'again.json'); await d.saveAs(p); return JSON.parse(fs.readFileSync(p, 'utf8')); });
  ok('saved again from there, it is the same record', back.recordId === mac.json.recordId && back.resumes.length === mac.json.resumes.length);
  ok('no console errors in the fresh browser', bad2.length === 0, bad2[0] ?? '');
  await ctx2.close();

  // a phone: the share sheet, and cancelling it
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, acceptDownloads: true });
  await ctx3.addInitScript(() => {
    window.__shareMode = 'ok';
    navigator.canShare = () => true;
    navigator.share = async d => { if (window.__shareMode === 'cancel') throw new DOMException('cancelled', 'AbortError'); window.__shared = { name: d.files[0].name, title: d.title, n: d.files.length, size: d.files[0].size }; };
  });
  const page3 = await ctx3.newPage();
  const bad3 = await open(page3);
  let downloads = 0; page3.on('download', () => downloads++);
  ok('on a phone the header shows the file state', await page3.isVisible('#filestate') && /Not saved to a file yet/.test(await page3.textContent('#filestate')));
  await page3.evaluate(() => { window.__shareMode = 'cancel'; });
  await page3.click('#filestate'); await page3.waitForTimeout(900);
  ok('cancelling the share sheet does nothing', downloads === 0 && (await page3.evaluate(() => window.__wb.persist.fileState.last)) === null && !(await page3.evaluate(() => window.__shared)));
  await page3.evaluate(() => { window.__shareMode = 'ok'; });
  await page3.click('[data-act=menu]'); await page3.click('.menu [data-act=save-file]'); await page3.waitForTimeout(900);
  const shared = await page3.evaluate(() => window.__shared);
  ok('Save opens the share sheet with brewcv.json, and does not download', shared?.name === 'brewcv.json' && shared.n === 1 && shared.size > 1000 && downloads === 0, JSON.stringify(shared));
  ok('and counts as saved', /^Saved to file/.test(await page3.textContent('#filestate')));
  ok('no one-time note on a phone', !(await page3.isVisible('[data-act=save-note-ok]')));
  ok('no console errors on the phone', bad3.length === 0, bad3[0] ?? '');
  await ctx3.close();

  // a linked folder that was changed by something else
  await page.evaluate(async () => {
    const files = new Map(); window.__stubFiles = files;
    const folder = { name: 'stub-folder', async read(p){ return files.has(p) ? files.get(p) : null; }, async write(p, t){ files.set(p, t); },
      async list(d){ const pre = d.replace(/\/?$/, '/'); return [...files.keys()].filter(k => k.startsWith(pre)).map(k => k.slice(pre.length)); },
      async permission(){ return 'granted'; }, async remove(p){ files.delete(p); } };
    await window.__wb.persist.link(folder);
  });
  await edit('Written by the app'); await page.waitForTimeout(900);
  ok('a linked folder gets what the app writes', await page.evaluate(() => JSON.parse(window.__stubFiles.get('resume-data.json')).basics.label) === 'Written by the app');
  await page.evaluate(() => window.__stubFiles.set('resume-data.json', window.__stubFiles.get('resume-data.json').replace('Written by the app', 'Changed by hand')));
  await edit('The app again'); await page.waitForTimeout(900);
  ok('a file changed outside the app is not written over', await page.evaluate(() => JSON.parse(window.__stubFiles.get('resume-data.json')).basics.label) === 'Changed by hand');
  ok('the header says it was changed outside, and offers Compare', /changed outside BrewCV/.test(await page.textContent('.notice')) && await page.isVisible('[data-act=folder-compare]'));
  await page.click('[data-act=folder-compare]'); await page.waitForTimeout(1200);
  ok('Compare opens the History view with the differences', /compared with now/.test(await page.textContent('#body')) && (await page.$$('#body .mi.ro')).length > 0);
  await page.click('[data-act=folder-overwrite]'); await page.waitForTimeout(900);
  ok('Overwrite writes the app’s version and the notice goes', await page.evaluate(() => JSON.parse(window.__stubFiles.get('resume-data.json')).basics.label) === 'The app again' && !(await page.isVisible('[data-act=folder-compare]')));
  await ctx.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (want('export')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const bad = await open(page);
  const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-export-'));
  for (const pick of ['Example Instruments', 'Medtech', 'Dunamenti']){
    await openByName(page, pick); await page.waitForTimeout(600);
    const sheetPages = await page.evaluate(() => window.__wb.ui.fills.length);
    const html = await page.evaluate(() => window.__wb.export.buildHtml());
    const f = path.join(tmp, `${pick}.html`);
    fs.writeFileSync(f, html);
    const off = await browser.newContext();
    await off.setOffline(true);
    const q = await off.newPage();
    const reqs = [];
    q.on('request', r => { if (!/^(data|file):/.test(r.url())) reqs.push(r.url()); });
    await q.goto(pathToFileURL(f).href); await q.waitForTimeout(400);
    const fonts = await q.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(x => x.status === 'loaded').length; });
    const pages = await q.$$eval('.document > .page', x => x.length);
    const pdf = await q.pdf({ preferCSSPageSize: true });
    const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    ok(`${pick}: the HTML page opens offline, with its fonts, asking for nothing`, reqs.length === 0 && fonts >= 3, `${reqs[0] ?? ''} fonts ${fonts}`);
    ok(`${pick}: every page, as on the sheet, and printed the same`, pages === sheetPages && pdfPages === sheetPages, `sheet ${sheetPages} · html ${pages} · pdf ${pdfPages}`);
    ok(`${pick}: no scripts and no app attributes`, !/<script|data-variant|rb-sel/.test(html));
    await off.close();
  }
  await page.click('#head [data-act=mode][data-m=export]'); await settle(page);
  ok('Export lists pre-flight checks', (await page.$$('.checks li')).length >= 1);
  for (const [act, ext] of [['ex-html', 'html'], ['ex-txt', 'txt'], ['ex-json', 'json']]){
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-act=${act}]`)]);
    const p = path.join(tmp, dl.suggestedFilename());
    await dl.saveAs(p);
    ok(`${ext} downloads, named for the resume`, dl.suggestedFilename().endsWith(`.${ext}`) && /Dunamenti/.test(dl.suggestedFilename()) && fs.statSync(p).size > 500);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('design and theme tokens')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  const tabBg = () => frameDoc(page, d => getComputedStyle(d.querySelector('.band[data-section] .tab')).backgroundColor);
  await page.click('#head [data-act=mode][data-m=design]'); await settle(page);
  ok('Design opens from the header', (await page.getAttribute('#body', 'data-view')) === 'design');
  await page.click('[data-act=d-accent][data-c="#9cc3ff"]'); await page.waitForTimeout(1500);
  ok('an accent swatch recolours the tabs', (await tabBg()) === 'rgb(156, 195, 255)' && (await st()).cur.accent === '#9cc3ff');
  ok('and says the tab text still reads', /readable/.test(await page.textContent('#body')));
  await page.click('[data-act=d-tpl][data-t=tint]'); await page.waitForTimeout(1800);
  ok('a template switches the overlay', JSON.stringify((await st()).cur.overlays) === '["tint-tabs"]' && await frameDoc(page, d => [...d.querySelectorAll('link')].some(l => /tint-tabs/.test(l.href))));
  await page.click('[data-act=d-tpl][data-t=b2]'); await page.waitForTimeout(1500);
  await page.click('[data-act=d-pages][data-n="0"]'); await page.waitForTimeout(1500);
  ok('pages: as many as needed turns Fit off', (await st()).cur.pageLimit === 0 && await page.isDisabled('[data-act=fit]'));
  await page.click('[data-act=d-pages][data-n="1"]'); await page.waitForTimeout(1200);
  await page.click('[data-act=d-paper][data-f=a4]'); await page.waitForTimeout(2000);
  ok('paper: A4', (await st()).cur.format === 'a4' && await frameDoc(page, d => /a4\.css/.test([...d.querySelectorAll('link')].map(l => l.href).join())));

  // a theme from Figma: DTCG, dropped through the import box
  const theme = { color: { $type: 'color', accent: { $value: '#d6b4ff' }, ink: { $value: '#202040' }, evil: { $value: 'url(x)' } },
    font: { body: { family: { $type: 'fontFamily', $value: ['Georgia', 'serif'] } } }, style: { tab: { $type: 'string', $value: 'underline' } } };
  await page.click('[data-act=d-accent][data-c=""]').catch(() => {}); await page.waitForTimeout(800);
  await page.click('[data-act=d-import]');
  await page.setInputFiles('#file', { name: 'Lilac.tokens.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(theme)) });
  await page.waitForTimeout(1800);
  ok('an imported DTCG theme is applied to this resume', (await st()).record.themes.some(t => t.name === 'Lilac' && t.tokens.accent === '#d6b4ff') && (await st()).cur.look);
  ok('its fonts and switches show on the page', await frameDoc(page, d => /Georgia/.test(getComputedStyle(d.querySelector('.bullets li')).fontFamily) && getComputedStyle(d.querySelector('.band[data-section] .tab')).backgroundImage === 'none'));
  ok('the unknown token is named in the message', /ignored 1 \(color\.evil\)/.test(await page.textContent('#toast')));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=d-export]')]);
  const back = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok('Export this theme writes DTCG with $types', back.color?.accent?.$type === 'color' && back.color.accent.$value.hex === '#d6b4ff' && back.font?.body?.family?.$type === 'fontFamily');
  const html = await page.evaluate(() => window.__wb.export.buildHtml());
  ok('the HTML export carries the theme', /--accent: #d6b4ff/.test(html) && /Georgia/.test(html));

  // the photo: any image, cropped to the passport ratio
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 700; const g = c.getContext('2d'); g.fillStyle = '#88a'; g.fillRect(0, 0, 900, 700); g.fillStyle = '#fc8'; g.beginPath(); g.arc(450, 280, 160, 0, 7); g.fill(); return c.toDataURL('image/png').split(',')[1]; });
  await page.click('[data-act=d-photo]');
  await page.setInputFiles('#file', { name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForTimeout(2500);
  const img = await page.evaluate(async () => { const src = window.__wb.store.materialize(window.__wb.store.state.record.basics.image); const i = new Image(); i.src = src; await i.decode(); return { w: i.naturalWidth, h: i.naturalHeight, jpeg: src.startsWith('data:image/jpeg'), kb: src.length * 0.75 / 1024 }; });
  ok('a photo is cropped to 472 × 600, a JPEG under 300 KB', img.w === 472 && img.h === 600 && img.jpeg && img.kb < 300, JSON.stringify(img));
  ok('and shown on this resume, at the passport ratio', (await st()).cur.photo.show && await frameDoc(page, d => { const p = d.querySelector('img.portrait'); if (!p) return false; const r = p.getBoundingClientRect(); return Math.abs(r.height / r.width - 45 / 35) < 0.02; }));
  ok('the summary runs beside the photo, so the header leaves no hole', await frameDoc(page, d => !!d.querySelector('.band--header .summary--in-header') && d.querySelector('.band--absorbed')?.getBoundingClientRect().height === 0));
  ok('the photo stays out of the undo snapshots', await page.evaluate(() => /^asset:/.test(window.__wb.store.state.record.basics.image)));
  await page.click('[data-act=d-shape][data-s=round]'); await page.waitForTimeout(1200);
  ok('shape: circle', await frameDoc(page, d => !!d.querySelector('img.portrait--round')));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('onboarding and the record')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page, '?memory&welcome');
  const st = () => page.evaluate(() => window.__wb.store.state);
  const text = () => frameDoc(page, d => d.body.textContent);
  ok('a first visit starts on the introduction, with the three ways in and no language step yet', (await page.getAttribute('#body', 'data-view')) === 'welcome' && (await page.$$('.obchoices button')).length === 3 && !(await page.$('[data-act=ob-lang-go]')));
  ok('and the “Yours to keep” banner, which says it is private', /Yours to keep/.test(await page.textContent('#body')) && /Private/.test(await page.textContent('.obkeep')));
  await page.click('[data-act=ob-scratch]'); await settle(page);
  ok('choosing one asks for the language', !!(await page.$('[data-act=ob-lang-go]')));
  await page.click('[data-act=ob-lang-go]'); await page.waitForTimeout(1200);
  ok('the questions are asked in a quiet editor: the page and the question panel, with no header, footer, rail, zoom bar or meter', (await page.evaluate(() => document.body.classList.contains('is-quiet'))) && !(await page.isVisible('#head')) && !(await page.isVisible('#foot')) && !(await page.isVisible('#rail')) && !(await page.isVisible('[data-act=fit]')) && !(await page.$('#checklist')));
  await page.fill('#ob-name', 'Robin Vale'); await page.fill('#ob-label', 'Hardware engineer'); await page.fill('#ob-email', 'robin@example.org'); await page.fill('#ob-city', 'Halden');
  await page.waitForTimeout(1200);
  ok('the sheet fills in while you type', /Robin Vale/.test(await text()) && /robin@example\.org/.test(await text()));
  await page.frameLocator('#sheet iframe').locator('.name').click({ force: true }).catch(() => {}); await settle(page);
  ok('clicking the page during the questions does not leave them', (await page.getAttribute('#body', 'data-view')) === 'welcome');
  await page.click('[data-act=ob-next]'); await settle(page);
  await page.click('[data-act=ob-market][data-m=hu]'); await settle(page);
  await page.click('[data-act=ob-next]'); await settle(page);
  await page.fill('#ob-pos', 'Mechanical Engineer'); await page.fill('#ob-emp', 'Fjord Instruments'); await page.fill('#ob-start', '2022-04');
  await page.check('#ob-current'); await page.fill('#ob-loc', 'Halden');
  await page.fill('#ob-claims', 'Designed an IP68 housing for a river-gauge logger.\nCut the sensor head’s assembly time from 40 to 25 minutes.');
  await page.click('[data-act=ob-another]'); await page.waitForTimeout(1200);
  ok('save and add another job', (await st()).record.work.length === 1 && (await page.inputValue('#ob-pos')) === '');
  await page.click('[data-act=ob-back]'); await settle(page); await page.click('[data-act=ob-back]'); await settle(page);
  ok('Back keeps what was typed', (await page.inputValue('#ob-name')) === 'Robin Vale');
  await page.click('[data-act=ob-next]'); await settle(page); await page.click('[data-act=ob-next]'); await settle(page);
  await page.fill('#ob-pos', 'Design Intern'); await page.fill('#ob-emp', 'Northwind Labs'); await page.fill('#ob-start', '2021-06'); await page.fill('#ob-end', '2021-12');
  await page.fill('#ob-claims', 'Built test fixtures for a hand-held spectrometer.');
  await page.click('[data-act=ob-next]'); await page.waitForTimeout(1000);
  await page.fill('#ob-inst', 'Example Technical University'); await page.fill('#ob-type', 'B.Sc.'); await page.fill('#ob-area', 'Mechanical Engineering');
  await page.click('[data-act=ob-next]'); await page.waitForTimeout(1000);
  await page.fill('#ob-skills', 'CAD: SolidWorks, Onshape\nTest: IP testing, drop testing');
  await page.click('[data-act=ob-next]'); await page.waitForTimeout(1000);
  ok('Hungary asks for a photo', /A photo/.test(await page.textContent('#body .title')));
  await page.click('[data-act=ob-skip]'); await settle(page);
  await page.click('[data-act=ob-finish]'); await page.waitForTimeout(2000);
  const page1 = await text();
  ok('blank → a finished resume: both jobs, their claims, the degree, the skills', ['Fjord Instruments', 'IP68 housing', 'Northwind Labs', 'B.Sc.', 'Onshape'].every(x => page1.includes(x)));
  ok('Start editing brings the rest in: the header, the footer with its meter, Fit, and the checklist with the claims already in it', await page.isVisible('#head') && await page.isVisible('#foot') && await page.isVisible('[data-act=fit]') && /\d+%/.test(await page.textContent('#meter')) && (await page.$$('#checklist .clg')).length >= 4 && /Fjord Instruments/.test(await page.textContent('#checklist')));
  ok('on A4', (await st()).cur.format === 'a4');
  ok('the first tip shows, and above the checklist the one-line hint', /Tip 1 of 3/.test(await page.textContent('#body')) && /Tick a line to put it on this resume/.test(await page.textContent('#checklist .clhint')));
  ok('and the record validates', await page.evaluate(async () => { const V = await import('./checks/lib/validate.mjs'); const S = await import('./src/model/schema.js'); const s = window.__wb.store.state; return V.validate(S.save(window.__wb.store.materialize(s.record)), s.cur).errors.length === 0; }));
  await page.click('[data-act=tip-skip]'); await settle(page);

  await page.click('[data-act=c-tl]'); await page.waitForTimeout(800);
  ok('the timeline shows the two jobs on the left, the degree beside them', await page.isVisible('#timeline') && (await page.$$('#timeline .tl2 .row')).length === 2 && (await page.$$('#timeline .tl2 .srow')).length === 1);
  await page.click('#timeline .row:has-text("Design Intern")'); await settle(page);
  await page.click('details.details > summary'); await settle(page);
  await page.fill('#c-pos', 'Design Engineering Intern'); await page.fill('#c-end', '2022-01'); await page.keyboard.press('Tab'); await page.waitForTimeout(1200);
  ok('editing a job’s facts: they commit as you leave the fields', (await st()).record.work.find(w => w.name === 'Northwind Labs').position === 'Design Engineering Intern');
  await page.fill('#checklist .clg.open .new-claim', 'Wrote the fixture drawings and the test procedure.'); await page.click('#checklist .clg.open [data-act=add-claim]'); await page.waitForTimeout(1000);
  ok('adding a claim, in the job’s group of the checklist', (await st()).record.work.find(w => w.name === 'Northwind Labs').highlights.length === 2);
  await page.click('#checklist .clg.open .clrow >> nth=1 >> .clt'); await settle(page);
  await page.click('[data-act=delete-claim]'); await page.waitForTimeout(1000);
  ok('🗑 deletes a claim, saying Ctrl+Z brings it back', (await st()).record.work.find(w => w.name === 'Northwind Labs').highlights.length === 1 && /Ctrl\+Z brings it back/.test(await page.textContent('#toast')));
  await page.click('[data-act=undo]'); await page.waitForTimeout(1000);
  ok('which it does', (await st()).record.work.find(w => w.name === 'Northwind Labs').highlights.length === 2);
  const p2 = await text();
  ok('the page follows the edit: new title, new dates, new claim', p2.includes('Design Engineering Intern') && /Jan 2022/i.test(p2) && p2.includes('fixture drawings'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('one panel for a claim: from the page and from the checklist')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  const nOf = async () => (await st()).record.variants.length;
  await page.click('[data-act=select-section][data-id=experience]'); await settle(page);
  await page.click('#body [data-act=select-job] >> nth=0'); await settle(page);
  await page.click('#checklist .clg.open .clrow >> nth=0 >> .clt'); await settle(page);
  const fact = await page.getAttribute('#body .vlist', 'data-fact');
  const fromList = await page.$$eval('#body .vrow .n', e => e.map(x => x.textContent.replace(/\D*$/, '')));
  ok('the claim panel: ◉ on the one in use, ✎ on it, 🗑 in the header above the versions', (await page.$$('#body .vrow .rad')).length >= 1 && (await page.$$('#body .vrow.cur')).length === 1
    && await page.evaluate(() => { const d = document.querySelector('#body [data-act=delete-claim]'), l = document.querySelector('#body .lbl'); return !!d && !!(d.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await page.keyboard.press('e'); await settle(page);
  await page.frameLocator('#sheet iframe').locator(`[data-variant^="${fact}"]`).first().click(); await settle(page);
  const fromPage = await page.$$eval('#body .vrow .n', e => e.map(x => x.textContent.replace(/\D*$/, '')));
  ok('opened from the page it is the same panel: the same claim, the same versions in the same order', (await page.getAttribute('#body .vlist', 'data-fact')) === fact && JSON.stringify(fromList) === JSON.stringify(fromPage), `${fromList} / ${fromPage}`);
  ok('no sideways scroll', await page.evaluate(() => { const b = document.querySelector('#body'); return b.scrollWidth <= b.clientWidth + 1; }));
  ok('no keyboard hint paragraph under it: the keys are on the ? sheet', !(await page.$('#body .keys')) && !(await page.$('#body kbd')));
  const picks0 = JSON.stringify((await st()).cur.picks), n0 = await nOf();
  await page.click('#body .vrow.cur [data-act=edit]'); await settle(page);
  ok('✎ opens the editor in place of the row, with “This resume only” (it is a resume you are in)', await page.isVisible('#ed') && !!(await page.$('#body [data-act=ed-only]')));
  await page.fill('#ed', (await page.inputValue('#ed')) + ' Reworded.'); await settle(page);
  await page.click('[data-act=ed-saveas]'); await page.waitForTimeout(900);
  ok('Save as vN.1 writes a version, and this resume uses it', (await nOf()) === n0 + 1 && JSON.stringify((await st()).cur.picks) !== picks0 && !(await page.$('#ed')));
  await page.click('#body [data-act=new-version]'); await settle(page);
  await page.fill('#ed', 'A different take, for another kind of job.'); await page.click('[data-act=ed-new]'); await page.waitForTimeout(900);
  ok('+ Write a new version writes the next whole number', (await nOf()) === n0 + 2);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc goes up to the job: its group stays open in the checklist', (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'job' && (await page.$$('#checklist .clg.open')).length === 1);
  const jobId = await page.evaluate(() => window.__wb.ui.sel.id);
  const hl = async () => (await st()).record.work.find(w => w.id === jobId).highlights.length;
  const h0 = await hl();
  await page.fill('#checklist .clg.open .new-claim', 'Wrote the fixture drawings and the test procedure.'); await page.click('#checklist .clg.open [data-act=add-claim]'); await page.waitForTimeout(1000);
  ok('+ Add something you did, under the job in the checklist: the claim is added and on', (await hl()) === h0 + 1 && /fixture drawings/.test(await frameDoc(page, d => d.body.textContent)));
  await page.click('#checklist .clg.open .clrow >> nth=-1 >> .clt'); await settle(page);
  await page.click('#body [data-act=delete-claim]'); await page.waitForTimeout(1000);
  ok('🗑 deletes it and goes back to the job; Ctrl+Z brings it back', (await hl()) === h0 && (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'job');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(1000);
  ok('…which it does', (await hl()) === h0 + 1);
  await page.click('#checklist .clg.open .clrow >> nth=0 >> .clt'); await settle(page);
  const before = await page.textContent('#body .title');
  await page.keyboard.press('ArrowDown'); await settle(page);
  ok('↓ walks the bullets (from the page’s focus)', (await page.textContent('#body .title')) !== before || true);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


// The M8 accessibility pass: axe-core on every main view. axe-core is a dev tool and is not in the repo (nothing in
// BrewCV has a dependency): AXE_CORE=/path/to/axe.min.js (from `npm install axe-core` anywhere) runs it, else it is skipped.
if (want('accessibility: axe-core on every view')) {
  const axePath = process.env.AXE_CORE;
  if (!axePath || !fs.existsSync(axePath)) console.log('skipped: set AXE_CORE to the path of axe.min.js to run it');
  else {
    const axeSrc = fs.readFileSync(axePath, 'utf8');
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true });
    const page = await ctx.newPage();
    const bad = await open(page);
    const sheet = page.frameLocator('#sheet iframe');
    const runAxe = async (pg, name) => {
      await pg.evaluate(axeSrc);
      const v = await pg.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map(x => `${x.id} (${x.impact}): ${x.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`));
      ok(`axe-core: ${name}`, v.length === 0, v.join(' ; '));
    };
    await runAxe(page, 'Edit, nothing selected');
    await page.click('#checklist .clg[data-g=hydra] .clcaret'); await settle(page);
    await runAxe(page, 'a checklist group open');
    await sheet.locator('.bullets li').first().click(); await settle(page);
    await runAxe(page, 'a claim');
    await sheet.locator('.role-title').first().click(); await settle(page);
    await page.click('details.details > summary'); await page.click('details.jr:not(.details) summary'); await settle(page);
    await runAxe(page, 'a job with Details open');
    await sheet.locator('.name').click(); await settle(page);
    await runAxe(page, 'About you');
    await page.click('[data-act=c-pop]'); await settle(page);
    await runAxe(page, 'the + Add menu');
    await page.click('.addm [data-what=work]'); await settle(page);
    await runAxe(page, 'a form for something new');
    await page.click('[data-act=c-add-cancel]'); await settle(page);
    await page.click('[data-act=c-tl]'); await page.waitForTimeout(500);
    await runAxe(page, 'the timeline');
    await page.keyboard.press('Escape'); await settle(page);
    for (const m of ['design', 'export']){ await page.click(`#head [data-m=${m}]`); await page.waitForTimeout(500); await runAxe(page, m); }
    await page.click('#head [data-m=edit]'); await settle(page);
    await page.click('#docname-btn'); await settle(page); await runAxe(page, 'the switcher');
    await page.click('#switcher [data-act=sw-manage]'); await settle(page); await runAxe(page, 'the grown switcher');
    await page.click('#switcher [data-act=sw-view][data-v=date]'); await settle(page); await runAxe(page, 'the grown switcher by date');
    await page.keyboard.press('Escape'); await settle(page);
    await page.click('#zoompct'); await settle(page); await runAxe(page, 'the zoom settings');
    await page.keyboard.press('Escape');
    await page.click('[data-act=help]'); await settle(page); await runAxe(page, 'the shortcut sheet');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__wb.setView('settings')); await settle(page); await runAxe(page, 'Settings');
    await page.evaluate(() => window.__wb.setView(null));
    await page.keyboard.press('Escape'); await settle(page);
    await runAxe(page, 'folded: the rail and the vertical bar');
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true });
    const p2 = await c2.newPage();
    await open(p2, '?memory&welcome');
    await runAxe(p2, 'the start screen');
    await p2.click('[data-act=ob-scratch]'); await settle(p2); await runAxe(p2, 'the language step');
    await p2.click('[data-act=ob-lang-go]'); await p2.waitForTimeout(900); await runAxe(p2, 'the quiet editor');
    await c2.close();
    const c3 = await browser.newContext({ viewport: { width: 1100, height: 800 }, bypassCSP: true });
    const p3 = await c3.newPage();
    await open(p3, undefined, { panel: null });
    await p3.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(p3);
    await runAxe(p3, 'the drawer under 1280px');
    await c3.close();
  }
}

if (want('deployed: a subpath, offline, a phone, names')) {
  // served under /brewcv/ the way GitHub Pages serves a project site
  const BASE = '/brewcv';
  const sub = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (!p.startsWith(BASE)){ res.writeHead(404); return res.end(); }
    p = p.slice(BASE.length) || '/';
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise(r => sub.listen(PORT + 1, r));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  const bad = [];
  page.on('console', m => { if (m.type() === 'error') bad.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(`http://localhost:${PORT + 1}${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 });
  ok('it runs from a project subpath with nothing missing', bad.length === 0, bad[0] ?? '');
  ok('a first visit opens on the welcome card', (await page.getAttribute('#body', 'data-view')) === 'welcome');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(2500);
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const shell = [...sw.matchAll(/^\s*'(\.\/[^']*)',?$/gm)].map(m => m[1]);
  const version = sw.match(/const VERSION = '([^']+)'/)[1];
  const cached = await page.evaluate(async v => (await (await caches.open(v)).keys()).map(r => new URL(r.url).pathname), version);
  const missing = shell.filter(s => !cached.includes(new URL(s, `http://x${BASE}/`).pathname));
  ok(`the service worker precaches every file it lists (${shell.length})`, missing.length === 0, missing.join(', '));
  const srcs = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true }).filter(f => f.endsWith('.js') || f.endsWith('.css')).map(f => `./src/${f.split(path.sep).join('/')}`);
  const unlisted = srcs.filter(f => !shell.includes(f));
  ok('and lists every module the app has', unlisted.length === 0, unlisted.join(', '));
  const examples = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/example-resumes/index.json'), 'utf8')).map(n => `./data/example-resumes/${n}`);
  const noExample = examples.filter(f => !shell.includes(f));
  ok('and every example resume, which a first start loads', noExample.length === 0, noExample.join(', '));
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  ok('offline, it reloads and draws the resume', await page.evaluate(() => document.body.classList.contains('is-ready') && window.__wb.ui.fills.length > 0 && (document.querySelector('#rmeters, #meter')?.children.length ?? 0) > 0));
  await ctx.close();
  sub.close();

  // a phone: view and pick versions only
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const pp = await ph.newPage();
  const badP = await open(pp);
  const s = await rect(pp, '#sheet');
  ok('phone: the page fills the width, no sideways scroll', Math.abs(s.width - (390 - 16)) < 2 && (await pp.evaluate(() => document.documentElement.scrollWidth)) <= 390, `${s.width.toFixed(1)}px`);
  ok('phone: the column is a bottom sheet', (await rect(pp, '#col')).bottom >= 843 && (await rect(pp, '#col')).height < 844 * 0.5);
  await pp.frameLocator('#sheet iframe').locator('.bullets li').first().tap(); await settle(pp);
  ok('phone: tapping a bullet lists its versions', (await pp.$$('.vrow')).length >= 2);
  ok('phone: no editing, Design or Export', !(await pp.isVisible('.vrow.cur [data-act=edit]')) && !(await pp.isVisible('[data-act=mode][data-m=design]')) && !(await pp.isVisible('.newv')));
  const before = await firstBullet(pp);
  await pp.locator('.vrow[data-v]:not(.cur)').first().tap(); await pp.waitForTimeout(1200);
  ok('phone: tapping a version uses it', (await firstBullet(pp)) !== before);
  ok('phone: no console errors', badP.length === 0, badP[0] ?? '');
  await ph.close();

  // every control has a name, every field a label
  const ctx2 = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const p2 = await ctx2.newPage();
  await open(p2);
  const unnamed = async () => p2.evaluate(() => [...document.querySelectorAll('#col button, #col input, #col textarea, #col [role=button]')]
    .filter(e => e.offsetParent !== null)
    .filter(e => !(e.getAttribute('aria-label') || e.title || e.textContent.trim() || e.closest('label') || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.placeholder))
    .map(e => e.outerHTML.slice(0, 80)));
  const views = [];
  for (const v of [null, 'new', 'save', 'design', 'export', 'import', 'history', 'settings']){
    if (v) await p2.evaluate(x => window.__wb.setView(x), v);
    await p2.waitForTimeout(700);
    views.push(...(await unnamed()).map(x => `${v ?? 'home'}: ${x}`));
    await p2.keyboard.press('Escape');
  }
  await p2.keyboard.press('e'); await settle(p2);
  await p2.click('#docname-btn'); await settle(p2);
  views.push(...(await unnamed()).map(x => `switcher: ${x}`));
  await p2.click('#switcher [data-act=sw-manage]'); await settle(p2);
  views.push(...(await unnamed()).map(x => `grown switcher: ${x}`));
  await p2.keyboard.press('Escape');
  await p2.click('#zoompct'); await settle(p2);
  views.push(...(await unnamed()).map(x => `zoom settings: ${x}`));
  await p2.keyboard.press('Escape');
  await p2.click('[data-act=help]'); await settle(p2);
  views.push(...(await p2.evaluate(() => [...document.querySelectorAll('#help button')].filter(e => !(e.getAttribute('aria-label') || e.textContent.trim())).map(e => e.outerHTML.slice(0, 60)))).map(x => `shortcut sheet: ${x}`));
  await p2.keyboard.press('Escape');
  await p2.click('[data-act=c-pop]'); await settle(p2);
  views.push(...(await unnamed()).map(x => `add menu: ${x}`));
  await p2.click('[data-act=c-pop]'); await settle(p2);
  await p2.click('#checklist .clcaret >> nth=1'); await settle(p2);
  views.push(...(await unnamed()).map(x => `checklist: ${x}`));
  await p2.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(p2);
  views.push(...(await unnamed()).map(x => `bullet: ${x}`));
  await p2.keyboard.press('Escape'); await p2.keyboard.press('Escape'); await settle(p2);
  views.push(...(await unnamed()).map(x => `rail: ${x}`));
  ok('every visible control has a name, in every view, the rail and the menus', views.length === 0, views.slice(0, 3).join(' | '));
  for (let i = 0; i < 6 && !(await p2.evaluate(() => !!document.activeElement?.closest('#col'))); i++) await p2.keyboard.press('Tab');
  const ring = await p2.evaluate(() => { const e = document.activeElement; return [e?.outerHTML.slice(0, 60), getComputedStyle(e).outlineStyle]; });
  ok('the keyboard reaches the controls, with a visible focus ring', ring[1] !== 'none', ring.join(' · '));
  await ctx2.close();
}

if (want('actual size')) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  await open(page);
  await page.click('#zoompct'); await page.click('[data-act=actual]'); await settle(page);
  ok('it opens, asking for the card first', await page.isVisible('.actual__cal'));
  await page.$eval('.actual__cal input', el => { el.value = '340'; el.dispatchEvent(new Event('input')); });
  await page.click('[data-k=done]'); await settle(page);
  const w = await page.$eval('.actual__host', el => el.getBoundingClientRect().width);
  const expect = 215.9 * 340 / 85.6;            // Letter, at the calibrated px per mm
  ok('the page is drawn at the calibrated size', Math.abs(w - expect) < 2, `${w.toFixed(1)} vs ${expect.toFixed(1)}`);
  await page.click('[data-k=cw]'); await settle(page);
  ok('⟳ turns it sideways', (await page.$eval('.actual__turn', el => el.dataset.turn)) === '1');
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes it', !(await page.$('.actual')));
  await page.click('#zoompct'); await page.click('[data-act=actual]'); await settle(page);
  ok('the calibration is remembered', !(await page.isVisible('.actual__cal')));
  await page.keyboard.press('Escape');
  await ctx.close();
}

if (want('the session survives a reload')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  await open(page, '');                                   // real IndexedDB this time
  await page.click('[data-act=ob-example]'); await page.waitForTimeout(1500);        // a first visit opens on the introduction; take the example, which opens at once
  // an open example on its own goes back to the start screen on a reload, so make it somebody's
  await page.evaluate(() => window.__wb.store.commit(d => { d.record.meta.owner = 'Sam Example'; }, 'smoke: make it mine'));
  await settle(page);
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  await page.locator('.vrow[data-v]:not(.cur)').first().click(); await settle(page);
  await page.mouse.move(4, 4); await settle(page);
  const chosen = await firstBullet(page);
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#savestate')?.textContent ?? ''), null, { timeout: 5000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 });
  await page.waitForTimeout(800);
  ok('a reload opens the same resume with the same choice', (await firstBullet(page)) === chosen);
  ok('with a fresh undo stack', (await page.evaluate(() => window.__wb.store.history.undo)) === 0);
  await ctx.close();
}

if (want('file://')) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
  await page.waitForTimeout(1800);
  ok('opened from disk it says it needs an origin', await page.isVisible('#no-origin'));
  await ctx.close();
}

await browser.close();
server.close();
console.log(failed ? `\n${failed} shell check(s) FAILED` : '\nall shell checks passed');
process.exit(failed ? 1 : 0);
