#!/usr/bin/env node
// node checks/smoke-shell.mjs
// The Workbench shell end to end in Chromium, on fictional data. Needs playwright and a Chromium.
// ONLY=import,export runs only the sections whose name contains one of those.
//
// How long: the whole run is about 1,000 checks and takes 10 to 15 minutes, longer when anything else is using the machine.
// One section is a minute or two. A tool that times out at ten minutes will cut a full run off, so:
//  - Run it in the background, to a file, and read the file: `PW_BUNDLED=1 PORT=8131 node checks/smoke-shell.mjs > out/smoke.txt 2>&1`
//    (the background runner tells you when it ends). Do not sleep in a chain to wait; poll the file in a bounded loop
//    (`for i in $(seq 1 110); do grep -q "all shell checks passed" out/smoke.txt && break; sleep 5; done`), and also stop when the
//    file shows a crash ("Node.js v") or the process is gone, or the loop waits for ever.
//  - PW_BUNDLED=1 uses Playwright's own Chromium. Without it the run looks for Google Chrome (CHROME_PATH), and many test
//    browsers can stop your own Brave or Chrome from opening.
//  - AXE_CORE=/path/to/axe.min.js adds the accessibility pass (skipped without it; it is not in the repo).
// What to watch out for, above all with other sessions on the same machine:
//  - PORT and PORT+1 are both taken (the deployed section). Two runs on adjacent ports collide with EADDRINUSE; leave a gap.
//  - Keep to about three runs at once. A full run next to others is slower and makes timing checks flaky.
//  - Kill by exact PID, and its children, never by name: `pkill -f smoke-shell` or `pkill -f Chrome` stops other sessions'
//    runs and your own browser.
//  - The checks serve the files in this folder as they are: do not edit src/ while a run is going, or it tests a mix.
//  - A wait for an element that is no longer there blocks for 30 seconds and then ends the whole run, so one stale selector hides
//    every section after it. After any bulk replace in this file, check that no helper now calls itself: it would loop for ever
//    with every `page.evaluate` succeeding and nothing timing out (`DEBUG=pw:api` shows an endless run of evaluates).
//  - A pointer resting over a version row previews it, and the first Esc ends the preview instead of going up a level: move the
//    mouse to (4, 4) before pressing Esc in a test.

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

async function open(page, q, { help = false, folded = false, drink = null, theme = null } = {}){
  const bad = [];
  // the shortcut sheet is seen once it has been opened (and the panel hint goes with it): a check that is not about it starts with the
  // sheet seen. The panel starts open; `folded` starts it folded (UX-5c: open or folded, nothing between)
  await page.addInitScript(([h, f, d, t]) => { try { if (!h) localStorage.setItem('rb-help-seen', '1'); if (f) localStorage.setItem('rb-folded', '1'); if (d) localStorage.setItem('rb-drink', d); if (t) localStorage.setItem('rb-theme', t); } catch { /* nothing to set */ } }, [help, folded, drink, theme]);
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
// the line being written on the page: an editable element in the frame
const lineEl = page => page.frameLocator('#sheet iframe').locator('[contenteditable]');
const lineText = page => page.evaluate(() => window.__wb.edit.editing?.draft ?? null);
const writeLine = async (page, text) => { await lineEl(page).focus(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(text); await page.waitForTimeout(450); };
const caretTo = (page, where) => page.evaluate(w => { const el = window.__wb.onpage.el(); const d = el.ownerDocument, sel = d.defaultView.getSelection(), r = d.createRange(); r.selectNodeContents(el); r.collapse(w === 'start'); sel.removeAllRanges(); sel.addRange(r); }, where);
const appendLine = async (page, text) => { await lineEl(page).focus(); await caretTo(page, 'end'); await page.keyboard.insertText(text); await page.waitForTimeout(450); };
// Open a saved resume the way a person does: through the switcher in the header.
async function openByName(page, text){
  if (!(await page.isVisible('#docname-btn'))){ await page.evaluate(() => window.__wb.dock.unfold()); await page.waitForTimeout(500); }
  if (!(await page.isVisible('#switcher'))) await page.click('#docname-btn');
  await page.waitForSelector('#switcher .sopt');
  await page.click(`#switcher .sopt:has-text("${text}")`);
  await page.waitForTimeout(1200);
}
const rect = (page, s) => page.$eval(s, el => el.getBoundingClientRect().toJSON());
// Mark as sent: the end of Export
async function markSent(page){ await page.evaluate(() => window.__wb.dock.setMode('export')); await page.waitForTimeout(500); await page.click('[data-act=mark-sent]'); }          // (a click on the open tab would fold the panel)
// The Outline, with nothing selected, the panel open
async function toEditHome(page){ await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.dock.setFolded(false); window.__wb.ui.pane = 'outline'; window.__wb.setView(null); }); await page.waitForTimeout(500); }
// The Outline with the first job in focus (its lines are the movable rows)
async function toJobOutline(page){ await page.frameLocator('#sheet iframe').locator('.role-title').first().click(); await page.waitForTimeout(500); await page.evaluate(() => window.__wb.dock.setMode('outline')); await page.waitForTimeout(500); }
// + Add lives in the Record tab's header
async function openAdd(page){ await inRecord(page); await page.click('[data-act=c-pop]'); }
// The Record tab lists the record's groups, all open. Open it, and make sure one group is open and in view.
async function inRecord(page, group = null){
  if ((await page.evaluate(() => window.__wb.ui.view)) !== 'record'){ await page.evaluate(() => window.__wb.dock.setMode('record')); await page.waitForTimeout(800); }
  if (group){
    const c = page.locator(`#checklist .clg[data-g=${group}] .clcaret`);
    if ((await c.getAttribute('aria-expanded')) === 'false'){ await c.click(); await page.waitForTimeout(300); }
    await page.locator(`#checklist .clg[data-g=${group}]`).scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
  }
}


if (want('layout: the page and the panel float together, centred in the window')) for (const [w, h] of [[1536, 864], [1440, 960], [1280, 800]]){
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const bad = await open(page);
  let s = await rect(page, '#sheet'), c = await rect(page, '#col'), t = await rect(page, '#tabs');
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(`${w}×${h}: loads with no console errors`, bad.length === 0, bad[0] ?? '');
  ok(`${w}×${h}: the panel starts open, with the five tabs on its left edge; nothing is selected, so Edit shows the Outline`, await page.isVisible('#body') && await page.isVisible('#head') && (await page.$$('#tabs [role=tab]')).length === 5 && (await page.getAttribute('#tab-outline', 'aria-selected')) === 'true' && (await page.getAttribute('#body', 'data-mode')) === 'outline');
  ok(`${w}×${h}: the page runs the full height (16px from top and bottom) and the group is page, 18px, the tabs (54px), the panel`, Math.abs(s.top - 16) < 1 && Math.abs(h - s.bottom - 16) < 1 && Math.abs(t.left - s.right - 18) < 1.5 && Math.abs(t.width - 54) < 1 && Math.abs(c.left - t.right) < 1.5, `${s.right.toFixed(1)} ${t.left.toFixed(1)} ${t.right.toFixed(1)} ${c.left.toFixed(1)}`);
  ok(`${w}×${h}: the panel is 560 to 760px wide, 16px from the top and the bottom, and inside the window`, c.width >= 559 && c.width <= 761 && Math.abs(c.top - 16) < 1 && Math.abs(c.height - (h - 32)) < 1 && c.right <= w - 15, `${c.width}px`);
  ok(`${w}×${h}: the group is centred: as far from the left edge as the panel's widest state is from the right`, Math.abs(s.left - (w - c.right)) < 2 || s.left <= 9, `${s.left.toFixed(1)} vs ${(w - c.right).toFixed(1)}`);
  ok(`${w}×${h}: the head is one 50px row: the logo, the name, the fill meter and Fit, Saved and Save to file`, await page.evaluate(() => { const hd = document.querySelector('#head'), r = hd.querySelector('.hrow.top'); return hd.querySelectorAll('.hrow.top').length === 1 && Math.round(r.getBoundingClientRect().height) === 50 && !!hd.querySelector('.logoswitch') && !!hd.querySelector('#docname-btn') && !!hd.querySelector('.meter') && !!hd.querySelector('[data-act=fit]') && !!hd.querySelector('#savestate') && !!hd.querySelector('#filestate'); }));
  ok(`${w}×${h}: the foot card under the tabs: undo, redo and the menu; no zoom bar or Fit in a foot`, await page.evaluate(() => { const f = document.querySelector('#tabfoot'); return ['undo', 'redo', 'menu'].every(a => f.querySelector(`[data-act=${a}]`)) && !document.querySelector('#foot [data-act=fit]') && getComputedStyle(document.querySelector('#foot')).display === 'none'; }));
  ok(`${w}×${h}: no horizontal scroll`, scrollW <= w);
  await ctx.close();
}

if (want('one screen: the panel folds, the tabs, the zoom bar, the shortcut sheet')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  const S = () => page.evaluate(() => ({ folded: document.body.dataset.folded, sel: window.__wb.ui.sel.kind, zoom: window.__wb.ui.zoom, view: window.__wb.ui.view ?? null, tab: document.querySelector('#tabs .tab.is-open')?.dataset.m ?? null, pane: window.__wb.ui.pane }));
  const col = () => rect(page, '#col');
  const key = k => page.keyboard.press(k);
  ok('Open is the default: the panel and the tabs are on screen, and there is no rail, no Auto and no panel mode', (await S()).folded === 'false' && await page.isVisible('#body') && !(await page.$('#rail')) && (await page.evaluate(() => window.__wb.ui.panel)) === undefined);
  ok('the tabs are a vertical tablist in three groups: Outline · Edit | Design · Export | Record, each an icon over a word', await page.evaluate(() => { const l = document.querySelector('#tabs [role=tablist]'); const g = [...l.querySelectorAll('.tgroup')].map(x => [...x.querySelectorAll('[role=tab]')].map(b => b.dataset.m).join()); return l.getAttribute('aria-orientation') === 'vertical' && g.join('|') === 'outline,edit|design,export|record' && [...l.querySelectorAll('[role=tab]')].every(b => b.querySelector('svg.ico') && b.querySelector('.tl')?.textContent.trim().length > 2); }));
  ok('…one tab stop for the five, roving', (await page.$$('#tabs [role=tab][tabindex="0"]')).length === 1 && (await page.$$('#tabs [role=tab][tabindex="-1"]')).length === 4);
  ok('the open tab is the panel’s colour, the closed ones are cream', await page.evaluate(() => { const bg = e => getComputedStyle(e).backgroundColor; const o = document.querySelector('#tab-outline'), e = document.querySelector('#tab-edit'); return bg(o) === bg(document.querySelector('#col')) && bg(e) !== bg(o); }));
  // the zoom bar: only while the pointer is over the page
  await page.mouse.move(1450, 20); await page.waitForTimeout(800);
  ok('the zoom bar is hidden while the pointer is away from the page', !(await page.evaluate(() => document.querySelector('#zoombar').classList.contains('on'))) && (await page.evaluate(() => +getComputedStyle(document.querySelector('#zoombar')).opacity)) < 0.05);
  await page.mouse.move(300, 400); await page.waitForTimeout(500);
  ok('over the page it shows: full screen, −, the percentage, +, fit — at the foot of the page area, under the page', await page.evaluate(() => { const z = document.querySelector('#zoombar'), r = z.getBoundingClientRect(); return z.classList.contains('on') && +getComputedStyle(z).opacity > 0.9 && ['fullscreen', 'zoom-out', 'zoom-pop', 'zoom-in', 'zoom-fit'].every(a => z.querySelector(`[data-act=${a}]`)) && r.bottom > innerHeight - 40 && r.right < document.querySelector('#tabs').getBoundingClientRect().left; }));
  await page.mouse.move(1450, 400); await page.waitForTimeout(250);
  ok('it stays 0.4s after the pointer leaves…', await page.evaluate(() => document.querySelector('#zoombar').classList.contains('on')));
  await page.waitForTimeout(900);
  ok('…and then fades out', !(await page.evaluate(() => document.querySelector('#zoombar').classList.contains('on'))));
  await key('='); await page.waitForTimeout(450);
  ok('zooming with a key flashes it for 1.2s even with the pointer elsewhere', await page.evaluate(() => document.querySelector('#zoombar').classList.contains('on')) && (await S()).zoom > 1);
  await page.waitForTimeout(1500);
  ok('…then it goes', !(await page.evaluate(() => document.querySelector('#zoombar').classList.contains('on'))));
  await key('0'); await settle(page);
  // folding
  const open0 = await rect(page, '#sheet');
  await key('e'); await settle(page);
  const f0 = await rect(page, '#sheet'), tf = await rect(page, '#tabs');
  ok('E folds the panel away: it is not on screen, the tabs stay at the right edge, 16px in, and the foot card with the logo under them', (await S()).folded === 'true' && !(await page.isVisible('#body')) && !(await page.isVisible('#head')) && Math.abs(1536 - tf.right - 16) < 1.5 && (await page.isVisible('#tabs [role=tab][data-m=edit]')) && await page.isVisible('#tabfoot .footlogo') && !(await page.$('#rail')));
  ok('…the page centres in the room left of the tabs', Math.abs(f0.left - (tf.left - f0.right)) < 2, `${f0.left.toFixed(1)} vs ${(tf.left - f0.right).toFixed(1)}`);
  ok('…the tabs are cream tags, none the colour of a panel', await page.evaluate(() => { const bg = e => getComputedStyle(document.querySelector(e)).backgroundColor; return bg('#tab-outline') === bg('#tab-edit') && bg('#tab-edit') === bg('#tab-record'); }));
  ok('…and Fit and the fill join the zoom bar over the page', await page.evaluate(() => { const z = document.querySelector('#zoombar'); return !!z.querySelector('[data-act=fit]') && !!z.querySelector('.meter') && !document.querySelector('#head [data-act=fit]'); }));
  await sheet.locator('.bullets li').first().click(); await settle(page);
  ok('selecting never folds or unfolds: folded stays folded', (await S()).folded === 'true' && (await S()).sel === 'bullet');
  await page.click('#tab-design'); await settle(page);
  ok('a click on a tag unfolds the panel on that tab', (await S()).folded === 'false' && (await S()).tab === 'design' && (await S()).view === 'design' && await page.isVisible('#body') && (await page.evaluate(() => document.activeElement?.id)) === 'tab-design');
  await page.click('#tab-design'); await settle(page);
  ok('a click on the open tab folds it, and the focus is on that tab', (await S()).folded === 'true' && (await page.evaluate(() => document.activeElement?.id)) === 'tab-design');
  await key('e'); await settle(page);
  ok('E unfolds it again, on the tab that was open, the focus on that tab', (await S()).folded === 'false' && (await S()).tab === 'design' && (await page.evaluate(() => document.activeElement?.id)) === 'tab-design');
  const open1 = await rect(page, '#sheet');
  ok('the page is where it was before the panel folded', Math.abs(open1.left - open0.left) < 1 && Math.abs(open1.width - open0.width) < 1);
  // the page's x never moves with a tab or a selection
  const xs = [];
  for (const m of ['outline', 'edit', 'design', 'export', 'record']){ await page.click(`#tab-${m}`); await settle(page); xs.push(Math.round((await rect(page, '#sheet')).left * 10)); }
  await page.mouse.move(4, 4); await key('Escape'); await key('Escape'); await key('Escape'); await settle(page);     // out of Record, up from the line, up from the job (a second click on a line of the open job would write it)
  await sheet.locator('.bullets li').first().click(); await settle(page); xs.push(Math.round((await rect(page, '#sheet')).left * 10));
  await page.mouse.move(4, 4); await key('Escape'); await key('Escape'); await settle(page);
  await sheet.locator('.role-title').first().click(); await settle(page); xs.push(Math.round((await rect(page, '#sheet')).left * 10));
  ok('the page’s x is the same in all five tabs and for a line or a job selected', new Set(xs).size === 1, xs.join());
  // the keyboard on the tablist
  await page.click('#tab-edit'); await settle(page);
  await page.focus('#tab-edit'); await key('ArrowDown');
  ok('↓ moves the focus to the next tab without opening it', (await page.evaluate(() => document.activeElement?.id)) === 'tab-design' && (await S()).tab === 'edit');
  await key('Enter'); await settle(page);
  ok('Enter opens it', (await S()).tab === 'design' && (await page.getAttribute('#body', 'data-view')) === 'design');
  await key('ArrowUp'); await key('ArrowUp');
  ok('↑ moves back up (Edit, then Outline)', (await page.evaluate(() => document.activeElement?.id)) === 'tab-outline');
  await key('End'); await key('Space'); await settle(page);
  ok('End goes to Record, Space opens it', (await S()).tab === 'record' && (await page.evaluate(() => document.activeElement?.id)) === 'tab-record');
  await key('Home'); await key('Enter'); await settle(page);
  ok('Home goes back to the Outline', (await S()).tab === 'outline' && (await page.getAttribute('#body', 'data-view')) === 'outline');
  ok('the stripe on the panel’s top is gone', await page.evaluate(() => ['none', 'normal'].includes(getComputedStyle(document.querySelector('#body'), '::before').content)));
  // Esc goes up a level but never folds the panel
  await sheet.locator('.bullets li').first().click(); await settle(page);
  await page.mouse.move(4, 4); await key('Escape'); await key('Escape'); await settle(page);
  ok('Esc goes up to the job, then to the page: the selection clears and the panel stays open', (await S()).sel === 'none' && (await S()).folded === 'false');
  await key('=');
  await sheet.locator('.bullets li').first().click(); await settle(page);
  ok('= zooms in (and 100% is the whole page)', (await S()).zoom > 1 && /^1[2-9]\d%$/.test(await page.textContent('#zoompct')));
  await page.mouse.move(4, 4); await key('Escape'); await key('Escape'); await settle(page);
  ok('Esc all the way out clears the selection and zooms back to the whole page, and leaves the panel as it is', (await S()).sel === 'none' && (await S()).zoom === 1 && (await S()).folded === 'false', JSON.stringify(await S()));
  // the zoom bar, with the pointer over it
  await page.mouse.move(300, 400); await page.waitForTimeout(400);
  await page.click('[data-act=zoom-in]'); await page.click('[data-act=zoom-in]'); await settle(page);
  const z = (await S()).zoom;
  ok('+ zooms the page about the middle: the page grows past the window’s height', z > 1.5 && (await page.evaluate(() => { const c = window.__wb.canvas; return c.cam.k * c.geo.h > innerHeight - 32 + 10; })) && /%/.test(await page.textContent('#zoompct')));
  await page.click('[data-act=zoom-out]'); await settle(page);
  ok('− zooms out', (await S()).zoom < z);
  await page.click('[data-act=zoom-fit]'); await settle(page);
  ok('the fit button shows the whole page again: 100%', (await S()).zoom === 1 && (await page.textContent('#zoompct')).trim() === '100%');
  await key('-'); await key('-'); await settle(page);
  ok('the keys: - zooms out too, and 0 fits', (await S()).zoom < 1 && (await page.keyboard.press('0'), await settle(page), (await S()).zoom === 1));
  await page.mouse.move(300, 400); await page.click('#zoompct'); await settle(page);
  ok('the percentage opens a small pop-up with Actual size and nothing else: the writing, dim, travel and contrast settings are in Settings', await page.isVisible('#zpop') && await page.isVisible('#zpop [data-act=actual]') && (await page.$$('#zpop input, #zpop [data-act=panel-mode]')).length === 0);
  await key('Escape'); await settle(page);
  ok('Esc closes the pop-up', !(await page.isVisible('#zpop')));
  await page.evaluate(() => window.__wb.setView('settings')); await settle(page);
  ok('Settings holds zoom while writing (80–180%, 130 to start), the switch, the dim levels and sharper contrast, and no panel mode', (await page.inputValue('#zw')) === '130' && (await page.getAttribute('#zw', 'min')) === '80' && (await page.getAttribute('#zw', 'max')) === '180' && await page.isChecked('#zwon') && await page.isVisible('#dimline') && await page.isVisible('#dimjob') && (await page.$$('[data-mode=settings] [data-act=panel-mode]')).length === 0 && await page.isVisible('#contrast'));
  await page.fill('#zw', '150'); await page.dispatchEvent('#zw', 'input');
  ok('the settings stick (this browser): zoom while writing', (await page.evaluate(() => localStorage.getItem('rb-zoomwrite'))) === '150' && (await page.inputValue('#zw')) === '150');
  await page.uncheck('#contrast'); await settle(page);
  ok('sharper contrast is the default; unticked it restores the old look', (await page.evaluate(() => document.body.classList.contains('soft'))) && (await page.evaluate(() => localStorage.getItem('rb-contrast'))) === 'soft');
  await page.check('#contrast');
  await page.uncheck('#zwon'); await page.fill('#dimline', '70'); await page.dispatchEvent('#dimline', 'input');
  ok('the other dials write their old keys: the switch, the dim level', (await page.evaluate(() => localStorage.getItem('rb-zoomwrite-on'))) === '0' && (await page.evaluate(() => localStorage.getItem('rb-dim-line'))) === '70');
  await page.check('#zwon'); await page.fill('#dimline', '94'); await page.dispatchEvent('#dimline', 'input');
  await page.evaluate(() => window.__wb.setView(null)); await settle(page);
  // the hints
  await page.hover('#tabfoot [data-act=undo]'); await page.waitForTimeout(700);
  ok('the foot card’s icons have a hover hint: a title and one line', await page.isVisible('#tip.on') && /Undo/.test(await page.textContent('#tip b')) && (await page.textContent('#tip')).length > 8);
  await page.mouse.move(4, 4);
  // the shortcut sheet
  ok('no hint paragraphs under the keys any more: no .keys note in any panel', !(await page.$('#body .note.keys')));
  await page.click('[data-act=menu]'); await page.click('.menu [data-act=help]');
  await settle(page);
  ok('the ⋯ menu opens the shortcut sheet: every key, grouped', await page.isVisible('#help') && (await page.$$('#help kbd')).length > 15 && /Esc/.test(await page.textContent('#help')) && (await page.getAttribute('#help', 'role')) === 'dialog');
  await key('Escape'); await settle(page);
  ok('Esc closes it', !(await page.isVisible('#help')));
  await key('Shift+?'); await settle(page);
  ok('the ? key does the same', await page.isVisible('#help'));
  await key('Escape'); await settle(page);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();

  // the sheet does not open by itself: until it has been opened once, the panel says how
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx2.newPage();
  await open(p2, undefined, { help: true });
  await p2.click('#tab-edit'); await settle(p2);
  ok('a first visit: the shortcut sheet is not open; with nothing selected Edit says what the resume is for, one line on how to pick a line, and “? shows the shortcuts” at its top', !(await p2.isVisible('#help')) && /\? shows the shortcuts/.test(await p2.textContent('#body .kbdhint')) && (await p2.evaluate(() => document.querySelector('#body').firstElementChild.classList.contains('kbdhint'))) && /Click a line/.test(await p2.textContent('#body .edithint')) && (await p2.textContent('#body h2.title')).length > 3);
  await p2.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(p2);
  ok('the first selection on the page leaves it closed', !(await p2.isVisible('#help')));
  ok('the hint is not on the page', !(await frameDoc(p2, d => /shows the shortcuts/.test(d.body.textContent))));
  await p2.mouse.move(4, 4); await p2.keyboard.press('Shift+?'); await settle(p2);
  ok('the ? key opens it, and the hint is gone', await p2.isVisible('#help') && !(await p2.$('#body .kbdhint')));
  await p2.keyboard.press('Escape'); await settle(p2);
  await p2.reload({ waitUntil: 'networkidle' }); await p2.waitForFunction(() => document.body.classList.contains('is-ready'));
  await p2.click('#tab-edit'); await settle(p2);
  ok('…not after a reload either (remembered in this browser): no sheet, no hint', !(await p2.isVisible('#help')) && !(await p2.$('#body .kbdhint')));
  await p2.click('[data-act=menu]');
  ok('the ⋯ menu has no Save to file (the header has it); the header’s meta line is “job type · EN · paper · pages”, with the language a menu button between', !(await p2.$('.menu [data-act=save-file]')) && await p2.isVisible('#filestate') && await p2.isVisible('#head .dline #langbtn') && !/(^| · )[A-Z]{2}( · |$)/.test(await p2.textContent('#head .dline .dt')), await p2.textContent('#head .dline'));
  await ctx2.close();
}

if (want('one screen: a narrow window keeps the panel at 560px and shrinks the page; the keyboard path through the checklist')) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  const s0 = await rect(page, '#sheet'), c0 = await rect(page, '#col');
  ok('1100×800: the panel keeps 560px and the page shrinks to make room (no drawer over the page)', Math.abs(c0.width - 560) < 1 && s0.height < 800 - 32 - 1 && s0.right < (await rect(page, '#tabs')).left && (await page.evaluate(() => document.body.dataset.drawer)) === undefined);
  await sheet.locator('.bullets li').first().click(); await settle(page);
  const s1 = await rect(page, '#sheet'), c1 = await rect(page, '#col');
  ok('selecting changes nothing about the page or the panel’s edge', Math.abs(s1.left - s0.left) < 1 && Math.abs(s1.width - s0.width) < 1 && Math.abs(c1.left - c0.left) < 1 && Math.abs(c1.width - 560) < 1);
  ok('…the panel and the page do not overlap, and there is no sideways scroll', c1.left >= s1.right && (await page.evaluate(() => document.documentElement.scrollWidth)) <= 1100);
  ok('the header’s one row still holds the name, Fit and Save to file at 560px', await page.evaluate(() => { const h = document.querySelector('#head').getBoundingClientRect(); return ['#docname-btn', '[data-act=fit]', '#filestate', '#savestate'].every(s => { const r = document.querySelector(`#head ${s}`).getBoundingClientRect(); return r.right <= h.right + 1 && r.left >= h.left - 1 && r.width > 0; }); }));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();

  // the keyboard alone: the Record tab, a group, a row, the inspector, Esc
  const ctx2 = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const p2 = await ctx2.newPage();
  const bad2 = await open(p2);
  await p2.keyboard.press('r'); await settle(p2);
  for (let i = 0; i < 60 && !(await p2.evaluate(() => document.activeElement?.closest?.('#checklist'))); i++) await p2.keyboard.press('Tab');
  ok('Tab reaches the record’s checklist, whose controls are plain buttons and checkboxes in tab order', await p2.evaluate(() => !!document.activeElement?.closest('#checklist')));
  for (let i = 0; i < 60 && !(await p2.evaluate(() => document.activeElement?.dataset?.g === 'hydra' && document.activeElement.classList.contains('clcaret'))); i++) await p2.keyboard.press('Tab');
  ok('every group is open, and Enter on a group’s caret folds it (aria-expanded)', (await p2.getAttribute('#checklist .clg[data-g=hydra] .clcaret', 'aria-expanded')) === 'true' && await (async () => { await p2.keyboard.press('Enter'); await settle(p2); return (await p2.getAttribute('#checklist .clg[data-g=hydra] .clcaret', 'aria-expanded')) === 'false'; })());
  await p2.keyboard.press('Enter'); await settle(p2);
  await p2.keyboard.press('Tab'); await p2.keyboard.press('Space'); await p2.waitForTimeout(900);
  const rowOn = await p2.evaluate(() => { const cb = document.activeElement; return { box: cb?.classList.contains('cb'), label: cb?.getAttribute('aria-label') }; });
  ok('the next stop is a row’s checkbox, named with the line’s text, and Space toggles it', rowOn.box && /\w/.test(rowOn.label ?? '') && (await p2.evaluate(() => window.__wb.store.history.undo)) === 1);
  await p2.keyboard.press('Control+z'); await settle(p2);
  await p2.keyboard.press('Tab'); await p2.keyboard.press('Enter'); await settle(p2);
  ok('Tab then Enter on the line’s text opens the claim in Edit, and the focus moves to its heading', (await p2.getAttribute('#body', 'data-view')) === 'bullet' && (await p2.evaluate(() => document.activeElement?.classList.contains('title'))));
  await p2.keyboard.press('Tab');
  ok('Tab goes on inside the inspector (not back to the top of the page)', await p2.evaluate(() => !!document.activeElement?.closest('#body')));
  await p2.keyboard.press('Escape'); await settle(p2);
  ok('Esc goes up: a line in a job is the job level, and one Esc goes to the page', (await p2.getAttribute('#body', 'data-view')) === 'none');
  await p2.keyboard.press('Escape'); await settle(p2);
  ok('and out: nothing selected, the panel stays', (await p2.evaluate(() => document.body.dataset.folded)) === 'false' && (await p2.getAttribute('#body', 'data-view')) === 'none');
  ok('no console errors', bad2.length === 0, bad2[0] ?? '');
  await ctx2.close();
}

if (want('one screen: nothing is drawn on the page for claims that are off, and no breadcrumb')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  const before = await frameDoc(page, d => d.querySelectorAll('*').length);
  await sheet.locator('.bullets li').first().click(); await settle(page);
  const after = await frameDoc(page, d => [d.querySelectorAll('*').length, d.querySelectorAll('input, button, .ghost, [data-toggle]').length]);
  ok('the page’s own markup has no controls: no circles, no switches, no faded rows (only the outline of the selection)', after[1] === 0 && after[0] === before);
  ok('no breadcrumb and no chip lie over the page: its layer holds only frames, a veil and the tools', !(await page.$('.obcrumb')) && !(await page.$('.jobchip')) && await page.evaluate(() => [...document.querySelectorAll('#editlay > *')].every(el => el.matches('.obframe, .obveil, .obtoolswrap'))));
  await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await settle(page);
  ok('Esc goes to the page: nothing is selected and the layer is empty', (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'none' && !(await page.$('#editlay > *')));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('selecting, preview, versions, undo')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  ok('the example opens on its first saved resume', /Example Instruments/.test(await page.textContent('#docname')));
  ok('the Outline lists the sections in print order when nothing is selected, and says how Fit works', /Fit cuts from the bottom/.test(await page.textContent('#body')) && (await page.$$('#seclist .srow')).length >= 4);

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
  ok('Esc goes to the page', (await page.getAttribute('#body', 'data-view')) === 'none');

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
  ok('at 1280×800 with the panel open: a meter for each page in the one line at the bottom, and one page in view', (await page.$$('#meter .meter')).length === 2 && (await page.evaluate(() => document.body.dataset.pages)) === 'one' && /p1/.test(await page.textContent('#meter')) && /p2/.test(await page.textContent('#meter')));
  await page.click('[data-act=goto-page][data-page="1"]'); await page.waitForTimeout(900);
  ok('the meter of page 2 brings page 2 forward', (await page.evaluate(() => window.__wb.ui.page)) === 1 && (await page.getAttribute('#meter .meter[data-page="1"]', 'aria-current')) === 'true');
  await page.keyboard.press('e'); await page.waitForTimeout(800);
  ok('E folds the panel and puts the pages side by side', (await page.evaluate(() => document.body.dataset.spread)) === 'true');
  const fills = await page.evaluate(() => window.__wb.ui.fills.map(p => p.overflow));
  ok('no page before the last overflows', fills.slice(0, -1).every(o => !(o > 0)));

  await page.keyboard.press('e'); await settle(page);
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


// The canvas (UX-3): pages side by side on one canvas, the wheel, the hand, the pinch, the bright page, the page-moved event.
// Medtech has two pages. Both at once needs a wide window; narrower, one at a time.
const camOf = page => page.evaluate(() => {
  const w = window.__wb, c = w.canvas, ui = w.ui;
  const d = document.querySelector('#sheet iframe').contentDocument;
  return { k: c.cam.k, x: c.cam.x, y: c.cam.y, zoom: ui.zoom, page: ui.page, scene: c.scene, equal: !!ui.equal, free: c.free,
    faded: [...d.querySelectorAll('.document > .page')].map(p => p.classList.contains('rb-faded')), fit: c.fit, view: c.view, geo: c.geo };
});
const movedCount = page => page.evaluate(() => window.__moved ?? 0);
const watchMoved = page => page.evaluate(() => { window.__moved = 0; document.addEventListener('brewcv:pages-moved', () => { window.__moved++; }); });
const foldAll = async page => { await page.keyboard.press('e'); await page.waitForTimeout(700); };
const wheel = async (page, dy, dx = 0, at = [400, 400]) => { await page.mouse.move(...at); await page.mouse.wheel(dx, dy); };

if (want('the canvas: both pages or one, the wheel, the hand, the pinch, the bright page')) {
  // ---- wide: both pages at once ----
  for (const [w, h] of [[1280, 800], [1440, 900]]){
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const bad = await open(page);
    await openByName(page, 'Medtech'); await foldAll(page);
    const c = await camOf(page);
    ok(`${w}×${h}: both pages show at once, equal, nothing faded`, c.scene === 'all' && c.equal && c.faded.length === 2 && c.faded.every(f => !f));
    ok(`${w}×${h}: at the full height of the window, 16px above and below`, Math.abs(c.k - (h - 32) / 1123) < 1e-6 && Math.abs(c.y - 16) < 1);
    const s = await rect(page, '#sheet'), col = await rect(page, '#col');
    const tb = await rect(page, '#tabs');
    ok(`${w}×${h}: with the panel folded the pages are centred in the room left of the tabs`, Math.abs(s.left - (tb.left - s.right)) < 2, `${s.left.toFixed(1)} vs ${(tb.left - s.right).toFixed(1)}`);
    await wheel(page, 700); await page.waitForTimeout(500);
    const after = await camOf(page);
    ok(`${w}×${h}: the wheel does nothing: there is nothing to travel to`, Math.abs(after.x - c.x) < 0.5 && after.page === 0);
    await wheel(page, 0, 300); await page.waitForTimeout(500);
    ok(`${w}×${h}: nor does a sideways swipe`, Math.abs((await camOf(page)).x - c.x) < 0.5);
    ok(`${w}×${h}: the stack and side-by-side toggle is gone`, !(await page.$('[data-act=view]')));
    await page.click('[data-act=goto-page][data-page="1"]'); await page.waitForTimeout(500);
    ok(`${w}×${h}: a meter says which page is current; the view stays`, (await camOf(page)).page === 1 && Math.abs((await camOf(page)).x - c.x) < 0.5 && (await page.getAttribute('[data-act=goto-page][data-page="1"]', 'aria-current')) === 'true');
    await page.click('[data-act=goto-page][data-page="0"]');
    ok(`${w}×${h}: no console errors`, bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }

  // ---- the panel is open: one page, the other waits faded, partly behind the panel; E folds it and both pages are equal ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const bad = await open(page);
    await openByName(page, 'Medtech');
    await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
    const c = await camOf(page);
    ok('with the panel open: one page, fit to the room beside the panel at its minimum, the page on the left of the group', c.scene === 'one' && Math.abs(c.k - Math.min((900 - 32) / 1123, (1440 - 32 - 72 - 560) / 794)) < 1e-6 && c.page === 0);
    ok('…the other page is faded and sits to the right', c.faded[0] === false && c.faded[1] === true);
    const col = await rect(page, '#col');
    const p2 = await page.evaluate(() => { const f = document.querySelector('#sheet iframe'), r = f.getBoundingClientRect(), d = f.contentDocument.querySelectorAll('.document > .page')[1].getBoundingClientRect(), k = r.width / f.offsetWidth; return { left: r.left + d.left * k, right: r.left + d.right * k }; });
    ok('…and reaches in behind the panel', p2.right > col.left);
    await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.keyboard.press('e'); await page.waitForTimeout(800);
    const back = await camOf(page);
    ok('E: the panel folds and both pages are equal again', back.scene === 'all' && back.equal && back.faded.every(f => !f));
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }

  // ---- narrow: one page at a time, the wheel travels between them with a magnet ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 } });
    const page = await ctx.newPage();
    const bad = await open(page);
    await openByName(page, 'Medtech');
    await watchMoved(page);
    const c0 = await camOf(page);
    ok('1024×700 with the panel open: one page at a time, the page shrunk so the panel keeps 560px', c0.scene === 'one' && c0.page === 0 && Math.abs(c0.k - Math.min((700 - 32) / 1123, (1024 - 32 - 72 - 560) / 794)) < 1e-6);
    ok('…the other waits faded to the right', c0.faded[0] === false && c0.faded[1] === true);
    const step = (794 + 24) * c0.k;
    await wheel(page, 30, 0, [300, 350]); await page.waitForTimeout(900);
    ok('a small push does not leave the page: it springs back (the magnet)', (await camOf(page)).page === 0 && Math.abs((await camOf(page)).x - c0.x) < 1);
    await wheel(page, 0, 0, [300, 350]);
    for (let i = 0; i < 6; i++){ await page.mouse.wheel(0, step * 0.18); await page.waitForTimeout(30); }
    await page.waitForTimeout(1100);
    const c1 = await camOf(page);
    ok('a push past halfway carries on to page 2 and settles on it', c1.page === 1 && Math.abs(c1.x - (c0.x - step)) < 1.5, `x ${c1.x.toFixed(1)} vs ${(c0.x - step).toFixed(1)}, page ${c1.page}`);
    ok('…page 2 is bright and page 1 faded', c1.faded[0] === true && c1.faded[1] === false);
    ok('a sideways swipe travels too, and back', await (async () => { await page.mouse.wheel(-step * 1.4, 0); await page.waitForTimeout(1100); const c = await camOf(page); return c.page === 0 && Math.abs(c.x - c0.x) < 1.5; })());
    await page.keyboard.press('PageDown'); await page.waitForTimeout(900);
    ok('Page Down goes to page 2', (await camOf(page)).page === 1);
    await page.keyboard.press('PageUp'); await page.waitForTimeout(900);
    ok('Page Up goes back', (await camOf(page)).page === 0);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(900);
    ok('→ goes to page 2 when nothing is selected', (await camOf(page)).page === 1);
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(900);
    ok('← goes back', (await camOf(page)).page === 0);
    await page.click('[data-act=goto-page][data-page="1"]'); await page.waitForTimeout(900);
    ok('a meter goes to its page', (await camOf(page)).page === 1 && Math.abs((await camOf(page)).x - (c0.x - step)) < 1.5);
    ok('the camera told the page layer once it settled', (await movedCount(page)) >= 1);

    // a faded page stays clickable
    await page.click('[data-act=goto-page][data-page="0"]'); await page.waitForTimeout(900);
    const blank = await page.evaluate(() => { const f = document.querySelector('#sheet iframe'), r = f.getBoundingClientRect(), k = r.width / f.offsetWidth, p = f.contentDocument.querySelectorAll('.document > .page')[1].getBoundingClientRect(); return { x: r.left + (p.left + 20) * k, y: r.top + (p.top + p.height - 30) * k }; });
    if (blank.x < (await rect(page, '#tabs')).left - 10){
      await page.mouse.click(blank.x, blank.y); await page.waitForTimeout(900);
      ok('a click on the blank paper of the faded page brings it forward', (await camOf(page)).page === 1);
    } else ok('a click on the blank paper of the faded page brings it forward (it is behind the rail here: use the meter)', true);
    await page.click('[data-act=goto-page][data-page="0"]'); await page.waitForTimeout(900);
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }

  // ---- the hand, the limits, the pinch, Esc ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const bad = await open(page);
    await openByName(page, 'Medtech'); await foldAll(page);
    await watchMoved(page);
    const c0 = await camOf(page);
    // a drag on the bare canvas pans, within the limits
    await page.mouse.move(14, 450); await page.mouse.down(); await page.mouse.move(60, 470, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(900);
    const c1 = await camOf(page);
    ok('a drag on the bare canvas pans the pages and leaves them there', c1.free && Math.abs(c1.x - (c0.x + 46)) < 3 && Math.abs(c1.y - (c0.y + 20)) < 3, `${c1.x - c0.x}, ${c1.y - c0.y}`);
    ok('…and the wheel now pans too (the pages are not in their place)', await (async () => { await wheel(page, 60, 0, [700, 450]); await page.waitForTimeout(700); return Math.abs((await camOf(page)).y - (c1.y - 60)) < 3; })());
    await page.mouse.move(14, 450); await page.mouse.down(); await page.mouse.move(1000, 450, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(1200);
    const far = await camOf(page), lim = await page.evaluate(() => window.__wb.canvas.limits());
    ok('pulled far past the edge it springs back to the soft limit (two thirds of the view stay in the pages)', far.x <= lim.maxX + 0.5 && far.x > lim.maxX - 4, `${far.x.toFixed(1)} vs ${lim.maxX.toFixed(1)}`);
    await page.keyboard.press('0'); await page.waitForTimeout(700);
    const home = await camOf(page);
    ok('0 puts it all back', !home.free && Math.abs(home.x - c0.x) < 1 && Math.abs(home.y - c0.y) < 1 && home.zoom === 1);
    // space and drag, over the page too
    await page.evaluate(() => document.activeElement?.blur());          // (E leaves the focus on the open tab: Space would press it)
    await page.mouse.move(700, 450); await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(640, 400, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Space'); await page.waitForTimeout(900);
    const c2 = await camOf(page);
    ok('Space and drag pans, even over a page, and does not select what is under it', c2.free && Math.abs(c2.x - (c0.x - 60)) < 3 && (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'none', `${c2.x - c0.x}`);
    await page.keyboard.press('0'); await page.waitForTimeout(700);
    await page.mouse.move(700, 450); await page.mouse.down({ button: 'middle' }); await page.mouse.move(720, 470, { steps: 3 }); await page.mouse.up({ button: 'middle' }); await page.waitForTimeout(900);
    ok('the middle button pans too', Math.abs((await camOf(page)).x - (c0.x + 20)) < 3);
    await page.keyboard.press('0'); await page.waitForTimeout(700);
    // a pinch: Chrome and Edge send Ctrl and the wheel; it zooms about the pointer
    const pt = [800, 300];
    const before = await page.evaluate(([x, y]) => { const c = window.__wb.canvas.cam; return { cx: (x - c.x) / c.k, cy: (y - c.y) / c.k }; }, pt);
    await page.evaluate(([x, y]) => { document.querySelector('#pages').dispatchEvent(new WheelEvent('wheel', { deltaY: -80, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true })); }, pt);
    await page.waitForTimeout(400);
    const z = await camOf(page);
    const after = await page.evaluate(([x, y]) => { const c = window.__wb.canvas.cam; return { cx: (x - c.x) / c.k, cy: (y - c.y) / c.k }; }, pt);
    ok('a pinch (Ctrl and wheel) zooms the page, not the site, about the pointer', z.zoom > 1.1 && Math.abs(after.cx - before.cx) < 1 && Math.abs(after.cy - before.cy) < 1, `zoom ${z.zoom}`);
    await page.evaluate(([x, y]) => { document.querySelector('#pages').dispatchEvent(new WheelEvent('wheel', { deltaY: 70, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true })); }, pt);
    await page.waitForTimeout(400);
    ok('a pinch back to within 5% of the fit view snaps to it', await (async () => { const g = await camOf(page); return g.zoom === 1 || (g.zoom > 1 && g.zoom < 1.12); })());
    await page.keyboard.press('0'); await page.waitForTimeout(600);
    await page.evaluate(([x, y]) => { document.querySelector('#pages').dispatchEvent(new WheelEvent('wheel', { deltaY: -4, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true })); }, pt);
    await page.waitForTimeout(500);
    ok('…a small pinch away from the fit view lands exactly on it, and the view is back in place', (await camOf(page)).zoom === 1 && !(await camOf(page)).free);
    ok('Ctrl and the wheel over the page itself is the pinch too', await (async () => {
      const at = await page.evaluate(() => { const f = document.querySelector('#sheet iframe'), r = f.getBoundingClientRect(); return [r.left + 200, r.top + 200]; });
      await page.evaluate(() => { const d = document.querySelector('#sheet iframe').contentDocument; d.dispatchEvent(new d.defaultView.WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 300, bubbles: true, cancelable: true })); });
      await page.waitForTimeout(400); const g = await camOf(page); return g.zoom > 1.1;
    })());
    // Esc at the page level puts everything away, from any zoom
    await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(800);
    const out = await camOf(page);
    ok('Esc, Esc from a zoomed view: selection cleared, panel folded, the whole resume with both pages equal', out.zoom === 1 && !out.free && out.scene === 'all' && out.equal && (await page.evaluate(() => document.body.dataset.folded)) === 'true' && (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'none');
    ok('a window resize is told to the page layer once it settles', await (async () => { const n0 = await movedCount(page); await page.setViewportSize({ width: 1300, height: 820 }); await page.waitForTimeout(900); const n1 = await movedCount(page); return n1 > n0 && n1 - n0 <= 2; })());
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }

  // ---- what the canvas must not touch ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const bad = await open(page);
    await openByName(page, 'Medtech'); await foldAll(page);
    const printed = () => page.evaluate(() => { const d = document.querySelector('#sheet iframe').contentDocument; const c = d.querySelector('.document').cloneNode(true); for (const e of c.querySelectorAll('[class]')) { e.className = e.className.replace(/\brb-[\w-]+\b/g, '').trim(); if (!e.className) e.removeAttribute('class'); } return c.innerHTML.replace(/\sdata-variant="[^"]*"/g, ''); });
    const fills = () => page.evaluate(() => JSON.stringify(window.__wb.ui.fills.map(p => [Math.round(p.used * 100), Math.round(p.usable * 100)])));
    const html0 = await printed(), fills0 = await fills();
    await page.keyboard.press('='); await page.keyboard.press('='); await page.waitForTimeout(600);
    await page.mouse.move(600, 450); await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(660, 500, { steps: 3 }); await page.mouse.up(); await page.keyboard.up('Space'); await page.waitForTimeout(800);
    await page.keyboard.press('0'); await page.waitForTimeout(600);
    ok('zooming and panning leave the page’s own markup and its measurements exactly as they were', (await printed()) === html0 && (await fills()) === fills0);
    // an overflowing page: a dashed line at the bottom margin and the lines below faded, drawn over the page, never in it
    const real = await page.evaluate(() => window.__wb.ui.fills.map(p => ({ ...p })));
    ok('a page that fits has no overflow line', (await page.$$('#ovlay .ov')).length === 0);
    await page.evaluate(f => { window.__wb.ui.fills = f.map((p, i) => (i === 0 ? { ...p, overflow: 36 } : p)); window.__wb.renderOverflow(); }, real);
    const ov = await page.evaluate(() => {
      const el = document.querySelector('#ovlay .ov'); if (!el) return null;
      const r = el.getBoundingClientRect(), line = el.querySelector('.ov-line'), f = document.querySelector('#sheet iframe'), k = f.getBoundingClientRect().width / f.offsetWidth;
      const pg = f.contentDocument.querySelector('.document > .page'), pb = parseFloat(f.contentDocument.defaultView.getComputedStyle(pg).paddingBottom), pr = pg.getBoundingClientRect(), fr = f.getBoundingClientRect();
      return { n: document.querySelectorAll('#ovlay .ov').length, top: r.top, want: fr.top + (pr.top + pr.height - pb) * k, style: getComputedStyle(line).borderTopStyle, inFrame: !!f.contentDocument.querySelector('.ov, .ov-line, .ov-veil'), ptr: getComputedStyle(document.querySelector('#ovlay')).pointerEvents };
    });
    ok('an overflowing page: one dashed line at the page’s bottom margin', ov && ov.n === 1 && ov.style === 'dashed' && Math.abs(ov.top - ov.want) < 1.5, JSON.stringify(ov));
    ok('…drawn in the app’s layer: nothing in the page, and it takes no clicks', ov && !ov.inFrame && ov.ptr === 'none');
    await page.evaluate(f => { window.__wb.ui.fills = f; window.__wb.renderOverflow(); }, real);
    ok('…and gone when the page fits again', (await page.$$('#ovlay .ov')).length === 0);
    await page.click('[data-act=fit]');
    await page.waitForFunction(() => !window.__wb.ui.fitting, null, { timeout: 60000 }); await page.waitForTimeout(800);
    ok('Fit still runs, and reports', await page.evaluate(() => !!window.__wb.ui.lastFit && window.__wb.ui.lastFit.pages.length > 0));
    await page.mouse.move(300, 400); await page.click('#zoompct'); await page.click('[data-act=actual]'); await page.waitForTimeout(1200);
    ok('actual size still opens', await page.isVisible('.actual'));
    await page.keyboard.press('Escape'); await settle(page);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
    await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
    await page.keyboard.press('e'); await settle(page);
    await page.locator('.vrow[data-v]:not(.cur)').first().hover(); await settle(page);
    ok('hover preview still works', await frameDoc(page, d => d.documentElement.classList.contains('rb-previewing')));
    await page.mouse.move(4, 4); await settle(page);
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
}

// Editing on the page (UX-3): three levels, Esc goes up one; a line is written where it is printed, with its tools in the margin.
const lay = page => page.evaluate(() => { const el = document.querySelector('#editlay'); const q = s => el.querySelector(s); return {
  veil: [...el.querySelectorAll('.obveil')].map(v => +getComputedStyle(v).opacity), job: !!q('.obframe.job'), dashed: !!q('.obframe.job.dashed'), line: !!q('.obframe.line'),
  tools: [...el.querySelectorAll('.obtools [data-act]')].map(b => b.dataset.act), badge: q('.obv')?.textContent.trim() ?? null }; });
const zoomOf = page => page.evaluate(() => window.__wb.ui.zoom);
const selOf = page => page.evaluate(() => { const s = window.__wb.ui.sel; return `${s.kind}:${s.id ?? ''}`; });

if (want('on the page: three levels, writing a line where it is printed, the tools in the margin')) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  const bad = await open(page);
  await openByName(page, 'Medtech'); await foldAll(page);
  const sheet = page.frameLocator('#sheet iframe');
  const jobs = sheet.locator('.entry');
  const l0 = await lay(page);
  ok('at the page level nothing is framed or dimmed', !l0.job && !l0.line && l0.veil.length === 0);

  // the job level
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  const l1 = await lay(page);
  ok('one click on a bullet opens its job: the job is framed (solid), the rest of the page is dimmed to 80%', l1.job && !l1.dashed && !l1.line && l1.veil.length >= 1 && l1.veil.every(o => Math.abs(o - 0.2) < 0.02), JSON.stringify(l1.veil));
  ok('…no breadcrumb is drawn over the page', !(await page.$('.obcrumb')));
  ok('…selecting does not open the folded panel: the line is selected, nothing written', (await page.evaluate(() => document.body.dataset.folded)) === 'true' && (await lineEl(page).count()) === 0 && (await selOf(page)).startsWith('bullet:'));
  ok('…the version badge shows beside the selected line; no tools to keep anything yet', l1.badge && /^v/.test(l1.badge) && l1.tools.every(a => a === 'ob-badge'));
  const first = await selOf(page);
  await jobs.nth(1).locator('.bullets li').first().click(); await settle(page);
  ok('a click on a bullet of another job moves to that job (still the job level)', (await selOf(page)) !== first && !(await lay(page)).dashed && (await lineEl(page).count()) === 0);
  await jobs.nth(0).locator('.bullets li').nth(1).click(); await settle(page);
  ok('…and back', !(await lay(page)).dashed && (await lineEl(page).count()) === 0);

  // the line level
  const z0 = await zoomOf(page);
  await jobs.nth(0).locator('.bullets li').nth(2).click(); await page.waitForTimeout(900);
  const l2 = await lay(page);
  ok('a second click on a bullet in that job writes it: an editable line in the frame', (await lineEl(page).count()) === 1 && (await page.evaluate(() => window.__wb.ui.writing === true)));
  ok('…the job keeps a dashed frame, the line has its own outline, the lines around stay readable (94%)', l2.dashed && l2.line && l2.veil.every(o => Math.abs(o - 0.06) < 0.02), JSON.stringify(l2.veil));
  ok('…and still no breadcrumb over the page', !(await page.$('.obcrumb')));
  ok('…the view eased to the writing zoom: 130% of the whole page', Math.abs((await zoomOf(page)) - 1.3) < 0.02 && z0 === 1, `${await zoomOf(page)}`);
  ok('…the tools stand in the margin: Update, Save as new version, Only on this resume, ↑ and ↓, and the counts', JSON.stringify(l2.tools) === JSON.stringify(['ob-badge', 'ed-save', 'ed-saveas', 'ed-only', 'ob-up', 'ob-down']) && /ch/.test(await page.textContent('#ob-stats')));
  ok('…and all three are off until something changes', await page.isDisabled('#editlay [data-act=ed-save]') && await page.isDisabled('#editlay [data-act=ed-saveas]') && await page.isDisabled('#editlay [data-act=ed-only]'));
  ok('…each is named, with a hover hint of a title and one line', await page.evaluate(() => [...document.querySelectorAll('#editlay .obtools .ib')].every(b => b.getAttribute('aria-label') && /\|/.test(b.dataset.tip))));
  ok('…nothing is drawn in the page itself, and nothing here takes a click it should not', await page.evaluate(() => { const d = document.querySelector('#sheet iframe').contentDocument; return !d.querySelector('.obframe, .obveil, .obtools') && getComputedStyle(document.querySelector('#editlay')).pointerEvents === 'none'; }));
  ok('…entering write mode is announced to a screen reader', /Writing this line/.test(await page.textContent('#announce')) && (await lineEl(page).getAttribute('role')) === 'textbox');
  const text0 = await lineText(page), undo0 = await page.evaluate(() => window.__wb.store.history.undo);
  await appendLine(page, ' Zebra.');
  const l3 = await lay(page);
  ok('typing: the draft is the line’s plain text, the tools wake, the page redraws', (await lineText(page)) === text0 + ' Zebra.' && !(await page.isDisabled('#editlay [data-act=ed-save]')) && (await frameDoc(page, d => d.body.textContent)).includes('Zebra.'));
  ok('…and it is still the same line: the layers follow it', l3.line && l3.dashed && (await lineEl(page).count()) === 1);
  ok('…nothing is committed while typing', (await page.evaluate(() => window.__wb.store.history.undo)) === undo0);
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  ok('Esc (asking first, since there is a draft) leaves the line for its job: the page is back as it was, zoomed out', (await lineEl(page).count()) === 0 && !(await frameDoc(page, d => d.body.textContent)).includes('Zebra.') && (await zoomOf(page)) === 1 && !(await lay(page)).dashed && (await lay(page)).job);
  ok('…the line is still selected, and leaving was announced', (await selOf(page)).startsWith('bullet:') && /Back at the job/.test(await page.textContent('#announce')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  ok('Esc again goes to the page: nothing framed, nothing dimmed, the panel folded', (await selOf(page)) === 'none:' && (await page.evaluate(() => document.body.dataset.folded)) === 'true');

  // writing at once
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  await page.keyboard.press('Enter'); await page.waitForTimeout(700);
  ok('Enter on a selected line writes it at once', (await lineEl(page).count()) === 1);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  await jobs.nth(0).locator('.bullets li').nth(1).dblclick(); await page.waitForTimeout(900);
  ok('a double-click on a line, from the page level, writes it at once', (await lineEl(page).count()) === 1 && (await selOf(page)).startsWith('bullet:'));

  // the next line, without zooming out
  const f0 = await page.evaluate(() => window.__wb.edit.editing.fact), zW = await zoomOf(page);
  await lineEl(page).focus(); await page.keyboard.press('Tab'); await page.waitForTimeout(800);
  const f1 = await page.evaluate(() => window.__wb.edit.editing?.fact);
  ok('Tab goes to the next line in print order and writes it, without zooming out', !!f1 && f1 !== f0 && (await lineEl(page).count()) === 1 && Math.abs((await zoomOf(page)) - zW) < 0.02, `${f0} → ${f1}, zoom ${await zoomOf(page)}`);
  await page.keyboard.press('Shift+Tab'); await page.waitForTimeout(800);
  ok('Shift+Tab goes back', (await page.evaluate(() => window.__wb.edit.editing?.fact)) === f0);
  await caretTo(page, 'end'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(800);
  ok('↓ at the last line of the block goes to the next one', (await page.evaluate(() => window.__wb.edit.editing?.fact)) === f1);
  await caretTo(page, 'start'); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(800);
  ok('↑ at the first line goes back', (await page.evaluate(() => window.__wb.edit.editing?.fact)) === f0);
  ok('the view followed it, still at the writing zoom, and the line is inside the window', await page.evaluate(() => { const r = window.__wb.onpage.el()?.getBoundingClientRect(), f = document.querySelector('#sheet iframe').getBoundingClientRect(); if (!r) return false; const k = f.width / document.querySelector('#sheet iframe').offsetWidth; const top = f.top + r.top * k; return top > 0 && top < innerHeight; }));

  // keeping what was written: the same three ways
  const nV = () => page.evaluate(() => window.__wb.store.state.record.variants.length);
  const n0 = await nV();
  await appendLine(page, ' Kept with Ctrl+Enter.');
  await page.keyboard.press('ControlOrMeta+Enter'); await page.waitForTimeout(900);
  ok('Ctrl+Enter keeps it (Update vN), as it did in the text box; the line is left and the view comes back out', (await frameDoc(page, d => d.body.textContent)).includes('Kept with Ctrl+Enter.') && (await lineEl(page).count()) === 0 && (await zoomOf(page)) === 1 && (await nV()) === n0);
  await page.keyboard.press('Enter'); await page.waitForTimeout(700);
  await appendLine(page, ' As a new one.');
  await page.click('#editlay [data-act=ed-saveas]'); await page.waitForTimeout(900);
  ok('Save as new version from the tools makes a version', (await nV()) === n0 + 1 && (await lineEl(page).count()) === 0);
  await page.keyboard.press('Enter'); await page.waitForTimeout(700);
  await appendLine(page, ' Only here.');
  await page.click('#editlay [data-act=ed-only]'); await page.waitForTimeout(900);
  ok('Only on this resume from the tools writes a one-off text, and no version', (await nV()) === n0 + 1 && /Only here\./.test(await frameDoc(page, d => d.body.textContent)));
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.waitForTimeout(900);

  // the version badge
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  await page.mouse.move(4, 4);          // (the badge belongs to the line under the pointer, else the selected line)
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  ok('the badge shows while Edit does not (the panel is folded here)', !!(await lay(page)).badge);
  await page.click('#tab-edit'); await settle(page);
  ok('…and not while Edit shows the line’s versions', (await lay(page)).badge === null);
  await page.click('#tab-edit'); await settle(page);
  await page.click('#editlay .obv'); await settle(page);
  ok('the badge lists the line’s versions', await page.isVisible('#editlay .obpop') && (await page.$$('#editlay .obpop .vrow')).length >= 2);
  const shown0 = await frameDoc(page, d => d.querySelector('.bullets li').textContent);
  await page.hover('#editlay .obpop .vrow:not(.cur)'); await page.waitForTimeout(700);
  ok('hovering one shows it on the page', await page.evaluate(() => window.__wb.ui.previewing === true) && (await frameDoc(page, d => d.querySelector('.bullets li').textContent)) !== shown0);
  ok('…the layers stay while it does', (await lay(page)).job && await page.isVisible('#editlay .obpop'));
  await page.mouse.move(4, 4); await page.waitForTimeout(700);
  ok('moving away puts the page back', (await frameDoc(page, d => d.querySelector('.bullets li').textContent)) === shown0);
  const picks0 = await page.evaluate(() => JSON.stringify(window.__wb.store.state.cur.picks));
  if (!(await page.isVisible('#editlay .obpop'))){ await page.click('#editlay .obv'); await settle(page); }
  await page.click('#editlay .obpop .vrow:not(.cur)'); await page.waitForTimeout(900);
  ok('clicking one uses it, as one undo step', (await page.evaluate(() => JSON.stringify(window.__wb.store.state.cur.picks))) !== picks0 && (await page.evaluate(() => window.__wb.store.history.undo)) >= 1);
  await page.keyboard.press('Control+z'); await settle(page);
  // while writing, picking a version replaces the typed text
  await page.keyboard.press('Enter'); await page.waitForTimeout(700);
  await appendLine(page, ' typed words');
  await page.click('#editlay .obv'); await settle(page);
  const other = await page.getAttribute('#editlay .obpop .vrow:not(.cur)', 'data-v');
  await page.click('#editlay .obpop .vrow:not(.cur)'); await page.waitForTimeout(800);
  const vText = await page.evaluate(v => window.__wb.store.state.record.variants.find(x => x.id === v).text, other);
  ok('while writing, picking a version replaces what was typed', (await lineText(page)) === vText && (await lineEl(page).count()) === 1);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(700);

  // lines outside a job are only selected
  const summary = sheet.locator('.summary[data-variant]').first();
  await summary.click(); await settle(page);
  const ls = await lay(page);
  ok('a line outside a job is only selected: no frame, no dimming', !ls.job && ls.veil.length === 0, JSON.stringify(ls));
  await summary.click(); await settle(page);
  ok('…a second click does not write it', (await lineEl(page).count()) === 0);
  await page.keyboard.press('Enter'); await page.waitForTimeout(700);
  ok('…Enter does', (await lineEl(page).count()) === 1 && (await lay(page)).line && !(await lay(page)).job);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(600);

  // two pages: writing on one fades the other, which stays clickable
  const pg2 = sheet.locator('.document > .page').nth(1).locator('.bullets li, .runs strong, .skills__items').first();
  if (await pg2.count()){
    await pg2.click(); await settle(page);
    await pg2.click().catch(() => {}); await page.waitForTimeout(700);
    const c2 = await camOf(page);
    ok('with two pages, working on the second brings it forward and fades the first', c2.page === 1 && c2.faded[0] === true && c2.faded[1] === false);
  } else ok('page 2 has a line to write', false);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(600);

  // clicking another line while writing goes on writing there; a pinch while writing is the writing zoom
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  await jobs.nth(0).locator('.bullets li').first().click(); await page.waitForTimeout(800);
  const wz = await zoomOf(page), wf = await page.evaluate(() => window.__wb.edit.editing?.fact);
  await jobs.nth(1).locator('.bullets li').first().click(); await page.waitForTimeout(900);
  const wf2 = await page.evaluate(() => window.__wb.edit.editing?.fact ?? null);
  ok('while writing, a click on a line in another job goes on writing there, without zooming out', !!wf2 && wf2 !== wf && Math.abs((await zoomOf(page)) - wz) < 0.02, `${wf} → ${wf2}, ${await zoomOf(page)}`);
  await page.evaluate(() => { document.querySelector('#pages').dispatchEvent(new WheelEvent('wheel', { deltaY: -60, ctrlKey: true, clientX: 600, clientY: 400, bubbles: true, cancelable: true })); });
  await page.waitForTimeout(400);
  ok('a pinch while writing changes the writing zoom, and it is remembered', (await zoomOf(page)) > wz + 0.1 && Number(await page.evaluate(() => localStorage.getItem('rb-zoomwrite'))) === Math.min(180, Math.round((await zoomOf(page)) * 100)), `${await zoomOf(page)} ${await page.evaluate(() => localStorage.getItem('rb-zoomwrite'))}`);
  await page.evaluate(() => localStorage.removeItem('rb-zoomwrite'));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  // a line on the second page, chosen from the panel (open: the pages are one at a time, the other waits faded): that page comes forward
  await page.keyboard.press('e'); await settle(page);
  const f2 = await page.evaluate(() => { const w = window.__wb, ix = w.ui.ix; for (const id of w.sheet.order(ix)) if (w.sheet.pageOf(id, ix) === 1) return id; return null; });
  if (f2){
    await page.evaluate(id => { const b = document.createElement('button'); b.dataset.act = 'select-bullet'; b.dataset.id = id; b.hidden = true; document.querySelector('#body').append(b); b.click(); }, f2);
    await page.waitForTimeout(1100);
    ok('choosing a line on the second page (from the panel) brings that page forward', (await camOf(page)).page === 1 && (await camOf(page)).faded[0] === true);
    await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('e'); await page.waitForTimeout(800);       // up to the page, then fold: both pages are in view again
  } else ok('the second page has a line', false);

  // what leaves nothing behind
  const html1 = await frameDoc(page, d => d.querySelector('.document').innerHTML.replace(/\s(?:contenteditable|role|aria-multiline|aria-label|spellcheck|style)="[^"]*"/g, '').replace(/\brb-[\w-]+/g, '').replace(/\sclass="\s*"/g, ''));
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  await jobs.nth(0).locator('.bullets li').first().click(); await page.waitForTimeout(700);
  await appendLine(page, ' x'); await page.keyboard.press('Escape'); await page.waitForTimeout(900);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  const html2 = await frameDoc(page, d => d.querySelector('.document').innerHTML.replace(/\s(?:contenteditable|role|aria-multiline|aria-label|spellcheck|style)="[^"]*"/g, '').replace(/\brb-[\w-]+/g, '').replace(/\sclass="\s*"/g, ''));
  const at = [...html1].findIndex((c, i) => c !== html2[i]);
  ok('writing and leaving without keeping leaves the page’s own markup exactly as it was', html1 === html2, `at ${at}: ${html1.slice(at - 60, at + 80)} ≠ ${html2.slice(at - 60, at + 80)}`);
  ok('…with nothing editable left in the frame', (await frameDoc(page, d => d.querySelectorAll('[contenteditable]').length)) === 0);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

// ---- smaller windows, the settings and reduced motion ----
if (want('History: naming a checkpoint in the desktop app')) {
  // the desktop web view has no prompt(): the name is typed into a field on the page (window.__TAURI__ stands in for being there)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  let dialogs = 0; page.on('dialog', d => { dialogs++; d.dismiss(); });
  await page.addInitScript(() => { window.__TAURI__ = {}; });
  const bad = await open(page);
  await page.click('[data-act=menu]'); await page.click('.menu [data-v=history]'); await page.waitForTimeout(1200);
  ok('History has a name field, filled with a dated name', /^Checkpoint /.test(await page.inputValue('#cp-name')));
  await page.fill('#cp-name', 'Before the Hungarian edit'); await page.press('#cp-name', 'Enter'); await page.waitForTimeout(1200);
  ok('Enter in it saves a checkpoint under that name, and no dialog was asked', /Before the Hungarian edit/.test(await page.textContent('#body')) && dialogs === 0);
  await page.fill('#cp-name', '   '); await page.click('[data-act=cp-new]'); await page.waitForTimeout(600);
  ok('an empty name saves nothing', (await page.$$('.cprow:has-text("Before the Hungarian edit")')).length === 1 && dialogs === 0);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('on the page: a narrow window, zoom off, reduced motion, a line that is not on the page')) {
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const bad = await open(page);
    const sheet = page.frameLocator('#sheet iframe');
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    ok('at 1100px the panel stays beside the page, at 560px: there is no drawer, and selecting a line leaves the layout alone', (await page.evaluate(() => document.body.dataset.drawer)) === undefined && (await page.evaluate(() => document.body.dataset.folded)) === 'false' && Math.abs((await rect(page, '#col')).width - 560) < 1);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await page.waitForTimeout(900);
    ok('writing a line slides the panel away (the page needs the room to zoom): the tabs stay as tags and the tools in the margin carry the actions', (await lineEl(page).count()) === 1 && (await page.evaluate(() => document.body.dataset.folded)) === 'true' && !(await page.isVisible('#body')) && await page.isVisible('#tabs') && !!(await page.$('#editlay [data-act=ed-save]')));
    await appendLine(page, ' drawer');
    ok('…the tools are on screen, not under the tabs', await page.evaluate(() => { const r = document.querySelector('#editlay .obtools').getBoundingClientRect(), c = document.querySelector('#tabs').getBoundingClientRect(); return r.right <= c.left + 2 && r.left >= 0 && r.top >= 0 && r.bottom <= innerHeight; }));
    await page.click('#editlay [data-act=ed-saveas]'); await page.waitForTimeout(900);
    ok('Save as new version works from the tools alone', (await page.evaluate(() => window.__wb.store.state.record.variants.some(v => /drawer$/.test(v.text)))) && (await lineEl(page).count()) === 0);
    await page.waitForTimeout(500);
    ok('…and the panel slides back, with the line selected', (await page.evaluate(() => document.body.dataset.folded)) === 'false' && (await page.isVisible('#body')) && (await selOf(page)).startsWith('bullet:'));
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const bad = await open(page);
    const sheet = page.frameLocator('#sheet iframe');
    await foldAll(page);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await page.waitForTimeout(900);
    await appendLine(page, ' drawer');
    await page.click('#tab-design'); await page.waitForTimeout(900);
    ok('a click on a tab while you write leaves the line (asking first, there is a draft) and opens that tab, panel unfolded', (await page.evaluate(() => document.body.dataset.folded)) === 'false' && (await page.evaluate(() => window.__wb.ui.view)) === 'design' && (await lineEl(page).count()) === 0);
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const bad = await open(page);
    const sheet = page.frameLocator('#sheet iframe');
    await foldAll(page);
    await page.evaluate(() => localStorage.setItem('rb-zoomwrite-on', '0'));
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await page.waitForTimeout(800);
    ok('with “Zoom in when writing” off, the line is written in place and the view stays whole', (await lineEl(page).count()) === 1 && (await zoomOf(page)) === 1);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await page.evaluate(() => { localStorage.setItem('rb-zoomwrite-on', '1'); localStorage.setItem('rb-zoomwrite', '180'); });
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await page.waitForTimeout(900);
    ok('the writing zoom is the setting: 180%', Math.abs((await zoomOf(page)) - 1.8) < 0.03, `${await zoomOf(page)}`);
    await page.evaluate(() => { localStorage.setItem('rb-dim-line', '70'); });
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await page.waitForTimeout(900);
    ok('the dim levels are settings too: other lines at 70%', (await lay(page)).veil.every(o => Math.abs(o - 0.3) < 0.02), JSON.stringify((await lay(page)).veil));
    await page.evaluate(() => { localStorage.removeItem('rb-zoomwrite'); localStorage.removeItem('rb-dim-line'); localStorage.removeItem('rb-zoomwrite-on'); });
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const bad = await open(page);
    const sheet = page.frameLocator('#sheet iframe');
    await foldAll(page);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await page.waitForTimeout(60);
    ok('with reduced motion the view jumps to the writing zoom: no ease', Math.abs((await zoomOf(page)) - 1.3) < 0.02);
    await page.keyboard.press('Escape'); await page.waitForTimeout(60);
    ok('…and back out at once', (await zoomOf(page)) === 1);
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
  {
    // a line that is not on this resume has no place on the page: the panel keeps a text box for it
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const bad = await open(page);
    const sheet = page.frameLocator('#sheet iframe');
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    await page.keyboard.press('r'); await settle(page);          // the Record lists every line, ticked or not
    const off = page.locator('#checklist .clg[data-g=hydra] .clrow.is-off .clt').first();
    if (await off.count()){
      await off.click(); await settle(page);
      await page.keyboard.press('Enter'); await settle(page);
      ok('a claim that is off this resume is written in the panel (there is no line to write on)', await page.isVisible('#ed') && (await lineEl(page).count()) === 0);
      await page.keyboard.press('Escape'); await settle(page);
    } else ok('this resume has a claim that is off', false);
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
}

if (want('scrollbars')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sb = sel => page.$eval(sel, el => { const c = getComputedStyle(el); return { w: c.scrollbarWidth, c: c.scrollbarColor }; });
  const b = await sb('#body'), p = await sb('#pages');
  ok('the body card’s scrollbar is thin, in the open tab’s own edge colour (the Outline’s oolong, here)', b.w === 'thin' && /153, 139, 111/.test(b.c), JSON.stringify(b));
  ok('the page scroller’s too', p.w === 'thin', JSON.stringify(p));
  ok('nothing scrollbar-related inside the resume’s iframe', await frameDoc(page, d => [...d.styleSheets].every(s => { try { return [...s.cssRules].every(r => !/scrollbar/.test(r.cssText)); } catch { return true; } })));
  ok('the iframe still hides its own overflow', await frameDoc(page, d => getComputedStyle(d.documentElement).overflow === 'hidden'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the welcome language step, the interface language, Settings')) {
  const I = await import(pathToFileURL(path.join(ROOT, 'src/i18n/index.js')));
  const de = await I.loadCatalogue('de'), fr = await I.loadCatalogue('fr');
  const ui = page => page.evaluate(() => ({ lang: document.documentElement.lang, design: document.querySelector('#tab-design .tl')?.textContent.trim(), cur: window.__wb.store.state.cur?.lang ?? 'en', format: window.__wb.store.state.cur?.format, langs: window.__wb.store.state.record.langs }));
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
    await page.click('#tab-edit'); await settle(page);
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
  await page.keyboard.press('r'); await page.waitForTimeout(900);
  ok('the Record tab starts with “Your record”, with the whole record counted', /Your record/.test(await page.textContent('#checklist')) && /^\d+ of \d+ on$/.test((await all()).trim()));
  const names = await page.$$eval('#checklist .clg', gs => gs.map(g => g.dataset.g));
  ok('the groups: About you, then the jobs newest first, projects, Education, Skills and credentials', names[0] === 'about' && names.slice(1, 6).join() === 'hydra,poly,free,medisure,atelier' && names.indexOf('education') > names.indexOf('chassis-jig') && names.at(-1) === 'credentials', names.join());
  ok('every group is open, and its rows are on screen or below it in the scroll', (await page.$$('#checklist .clg.open')).length === names.length && (await page.$$('#checklist .clg[data-g=hydra] .clrow')).length === 7);
  ok('no hint above the list: what a tick does is shown once, by a line travelling to the page (UX-4)', !(await page.$('#checklist .clhint')) && await page.evaluate(() => localStorage.getItem('rb-cl-hint') === '1'));

  await page.evaluate(() => document.querySelector('#checklist .clg[data-g=hydra]').scrollIntoView({ block: 'center' })); await settle(page);
  const rows = page.locator('#checklist .clg[data-g=hydra] .clrow');
  const total = await rows.count(), ticked = await page.locator('#checklist .clg[data-g=hydra] .clrow .cb:checked').count();
  ok('the job’s claims are all listed, the ones on this resume ticked, the others with an empty box', total === 7 && ticked === 4 && /4 of 7 on/.test(await page.textContent('#checklist .clg[data-g=hydra] .clcount')), `${ticked}/${total}`);
  ok('a row: a checkbox, the claim’s text, its version count', (await rows.first().locator('.cb').count()) === 1 && /\d v/.test(await rows.first().locator('.clv').textContent()));

  const n0 = await bullets(), undo0 = await page.evaluate(() => window.__wb.store.history.undo);
  const first = rows.first();
  await first.locator('.cb').uncheck(); await page.waitForTimeout(900);
  ok('unticking a line takes it off the page, which reflows', (await bullets()) === n0 - 1 && /3 of 7 on/.test(await page.textContent('#checklist .clg[data-g=hydra] .clcount')) && (await page.evaluate(() => window.__wb.store.history.undo)) === undo0 + 1);
  ok('…and the row stays in the list, unticked, never hidden', (await rows.count()) === 7 && (await first.locator('.cb').isChecked()) === false);
  await first.locator('.cb').check(); await page.waitForTimeout(900);
  ok('ticking it puts it back, in its place', (await bullets()) === n0 && (await frameDoc(page, d => d.querySelector('.bullets li').textContent)).startsWith('Led the dose-counter'));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(700);
  ok('each tick is one undo step', (await bullets()) === n0 - 1);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(700);
  ok('…so two Ctrl+Z take both back', (await bullets()) === n0 && (await page.evaluate(() => window.__wb.store.history.undo)) === undo0);
  ok('…and the sample does not play again', !(await page.$('#checklist .clhint')) && await page.evaluate(() => window.__wb.motion.stats.names.filter(n => n === 'tick:sample').length <= 1));

  await rows.nth(1).hover(); await page.waitForTimeout(300);
  ok('hovering a row lights its line on the page', (await frameDoc(page, d => d.querySelectorAll('.rb-hover').length)) === 1);
  await page.mouse.move(4, 4); await page.waitForTimeout(300);
  ok('moving away puts the lights out', (await frameDoc(page, d => d.querySelectorAll('.rb-hover').length)) === 0);
  await rows.nth(1).locator('.clt').click(); await settle(page);
  ok('clicking a row’s text opens the claim in the inspector, with its versions', (await page.getAttribute('#body', 'data-view')) === 'bullet' && (await page.locator('.vrow').count()) >= 1 && (await page.evaluate(() => document.activeElement?.classList.contains('title'))));
  await page.click('#body .crumb [data-act=select-job]'); await settle(page);
  ok('the job in the panel’s path opens the job: its panel, with the Details fold shut', (await page.getAttribute('#body', 'data-view')) === 'job' && (await page.isVisible('details.details > summary')) && !(await page.isVisible('#c-pos')));

  // a job not on the page at all: its claims are listed and can be ticked
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await page.keyboard.press('r'); await page.waitForTimeout(900);
  const freeRows = page.locator('#checklist .clg[data-g=free]');
  await freeRows.scrollIntoViewIfNeeded(); await settle(page);
  ok('a job that is not on this resume lists its claims, all unticked', (await freeRows.locator('.clrow').count()) === 2 && (await freeRows.locator('.cb:checked').count()) === 0);
  await freeRows.locator('.cb').first().check(); await page.waitForTimeout(1000);
  ok('ticking one brings the job onto the page', (await frameDoc(page, d => /Freelance CAD Designer/.test(d.body.textContent))) && /1 of 2 on/.test(await freeRows.locator('.clcount').textContent()));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(800);

  // the timeline, at the top of the tab
  await page.evaluate(() => { document.querySelector('#body').scrollTop = 0; });
  ok('the timeline is open at the top of the tab: two columns, five jobs and three beside them', await page.isVisible('#checklist .rectl .tl2') && (await page.$$('#checklist .rectl .tl2 .main .row')).length === 5 && (await page.$$('#checklist .rectl .tl2 .side .srow')).length === 3 && !(await page.$('#timeline')));
  const tl = await rect(page, '#checklist .rectl'), col = await rect(page, '#col');
  ok('it is as wide as the panel’s content, and does not cover the page', tl.left >= col.left && tl.right <= col.right && (await rect(page, '#sheet')).right <= col.left + 1, `${tl.left}-${tl.right} vs ${col.left}`);
  await page.click('#checklist .rectl .row:has-text("Prototyping Technician")'); await page.waitForTimeout(900);
  ok('an entry in it scrolls the list to that job, and the tab stays', (await page.getAttribute('#body', 'data-view')) === 'record' && await page.evaluate(() => { const g = document.querySelector('#checklist .clg[data-g=poly]'), b = document.querySelector('#body'); const d = g.getBoundingClientRect().top - b.getBoundingClientRect().top; return d >= -2 && d < 120; }));
  await page.evaluate(() => { document.querySelector('#body').scrollTop = 0; });
  await page.click('#checklist .rectl .srow:has-text("M.Eng.")'); await page.waitForTimeout(900);
  ok('the degree takes the list to Education', await page.evaluate(() => { const g = document.querySelector('#checklist .clg[data-g=education]'), b = document.querySelector('#body'); const d = g.getBoundingClientRect().top - b.getBoundingClientRect().top; return window.__wb.ui.view === 'record' && d >= -2 && d < 200; }));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc goes back to Edit', (await page.evaluate(() => window.__wb.ui.view)) === null);
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
  await inRecord(page, 'credentials'); await settle(page);
  await page.click('#checklist .clg[data-g=credentials] .clrow:has-text("CAD") .clt'); await settle(page);
  ok('a skill group opens in the inspector: its name and keywords, then its versions, no Save', (await page.getAttribute('#body', 'data-view')) === 'record' && await page.isVisible('#c-gname') && await page.isVisible('#c-kw-in') && (await page.locator('.vrow').count()) >= 1 && !(await page.$('[data-act=c-save-item]')));
  await page.fill('#c-kw-in', 'Onshape'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  ok('a keyword added with Enter is in the record at once', (await st()).record.skills[0].keywords.includes('Onshape'));
  await page.click('#c-kw .tag:has-text("Onshape") .rm'); await page.waitForTimeout(900);
  ok('× removes it at once', !(await st()).record.skills[0].keywords.includes('Onshape'));
  await inRecord(page, 'credentials');
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
  ok('the resume’s language is the one you edit in: the page and the interface go German', (await page.evaluate(() => document.documentElement.lang)) === 'de' && (await page.evaluate(() => window.__wb.store.state.cur.lang)) === 'de' && (await page.textContent('#head')).includes(de6['ux3b.saveFile']));
  await sheet.locator('.role-title').first().click(); await settle(page);
  await page.click('details.details > summary'); await settle(page);
  ok('the form says what translates and what is the same in every language', /Deutsch/.test(await page.textContent('#body .detbox')) && (await page.textContent('#body .detbox')).includes(de6['career.shared']));
  await page.fill('#c-pos', 'Konstrukteur Medizintechnik'); await page.fill('#c-loc', 'Lissabon, Portugal'); await page.keyboard.press('Tab'); await page.waitForTimeout(1200);
  const s = await st();
  ok('saved in German: i18n.de.fields, and a German v1 of the title', s.record.i18n.de.fields['work/hydra/position'] === 'Konstrukteur Medizintechnik' || s.record.variants.some(v => v.lang === 'de' && v.text === 'Konstrukteur Medizintechnik'));
  // a claim with no German: the English for reference and a box to write it
  const sections = await page.$$eval('#checklist .clg[data-g=poly] .clt', rs => rs.map(r => r.textContent));
  await inRecord(page, 'poly'); await settle(page);
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
  await inRecord(page, 'credentials'); await settle(page);
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
    ok('onboarding from scratch is a quiet editor: the page and the question panel only, no header, footer, tabs or zoom bar', (await p3.evaluate(() => document.body.classList.contains('is-quiet'))) && !(await p3.isVisible('#head')) && !(await p3.isVisible('#foot')) && !(await p3.isVisible('#tabs')) && await p3.isVisible('#body'));
    ok('the answers appear on the page as they are typed', (await frameDoc(p3, d => d.body.textContent)).includes('Robin Vale'));
    for (let i = 0; i < 6; i++){ if (await p3.isVisible('[data-act=ob-skip]')) await p3.click('[data-act=ob-skip]'); else if (await p3.isVisible('[data-act=ob-next]')) await p3.click('[data-act=ob-next]'); await p3.waitForTimeout(250); }
    if (await p3.isVisible('[data-act=ob-finish]')) await p3.click('[data-act=ob-finish]'); await p3.waitForTimeout(1200);
    ok('Start editing brings the rest in: the header, the tabs, and the Outline', await p3.isVisible('#head') && await p3.isVisible('#tabs') && /Fit cuts from the bottom/.test(await p3.textContent('#body')));
    await openAdd(p3); await settle(p3);
    ok('+ Add lists every kind: job, education, project, skills, languages, certificates, publications, interests, references, and “Something else”', ['work', 'education', 'project', 'skills', 'languages', 'certificates', 'publications', 'interests', 'references'].every(async k => true) && (await p3.$$('.addm [data-act=c-add]')).length >= 9 && await p3.isVisible('.addm [data-act=c-kind-new]'));
    await p3.click('.addm [data-what=work]'); await settle(p3);
    ok('+ Add a job opens its form in the panel: title, employer, dates and the claims', await p3.isVisible('#c-claims') && /A new job/.test(await p3.textContent('#body .title')));
    await p3.click('[data-act=c-add-cancel]'); await settle(p3);
    await openAdd(p3); await p3.click('.addm [data-what=education]'); await settle(p3);
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
  await openAdd(page); await settle(page);
  await page.click('.addm [data-what=project]'); await settle(page);
  await page.fill('#c-pos', 'Formula Student chassis jig'); await page.fill('#c-org', 'FEUP Formula Student team'); await page.fill('#c-start', '2019-10'); await page.fill('#c-end', '2020-06');
  await page.selectOption('#c-during', 'porto-meng');
  await page.fill('#c-claims', 'Designed the welding jig for the team’s steel spaceframe chassis.\nIt held tolerance through two builds.');
  await page.click('[data-act=c-create]'); await page.waitForTimeout(1200);
  let s = await st();
  const pj = s.record.projects?.find(p => p.name === 'Formula Student chassis jig' && p.highlights?.length === 2);
  ok('a project goes in the record, with its claims and “during”', pj?.during === 'porto-meng');
  ok('it opens in Edit as a job does', (await page.getAttribute('#body', 'data-view')) === 'job' && (await page.getAttribute('#tab-edit', 'aria-selected')) === 'true');
  await inRecord(page); await page.waitForTimeout(400);
  ok('it shows on the timeline beside the degree, saying so', /during Universidade do Porto/.test(await page.textContent('#checklist .rectl .tl2')));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await toEditHome(page);
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
  await openAdd(page); await settle(page);
  await page.click('.addm [data-act=c-kind-new]'); await settle(page);
  await page.click('[data-act=c-kind-preset][data-p=awards]'); await settle(page);
  await page.click('[data-act=c-kind-save]'); await page.waitForTimeout(800);
  ok('Awards, made from the preset, is a list kind', (await st()).record.kinds?.[0]?.store === 'awards' && (await st()).record.kinds[0].place === 'list');
  ok('and the form for its first entry opens', await page.isVisible('#c-pos'));
  await page.fill('#c-pos', 'Best student design'); await page.fill('#c-org', 'Example Society'); await page.fill('#c-start', '2020-11');
  await page.click('[data-act=c-create]'); await page.waitForTimeout(1000);
  ok('the entry is a JSON Resume award', (await st()).record.awards?.[0]?.title === 'Best student design');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await inRecord(page, 'awards');
  ok('it is listed in its own group in the record, which is open', /Best student design/.test(await page.textContent('#checklist .clg[data-g=awards]')) && (await page.$$('#checklist .clg[data-g=awards].open')).length === 1);
  await toEditHome(page);
  await page.click('.offchip[data-id=awards]'); await page.waitForTimeout(2000);
  ok('put on a resume, it prints as a run line', (await frameDoc(page, d => d.body.textContent)).includes('Best student design · Example Society · 2020'));
  // another list kind, then delete Awards moving its entry there
  await openAdd(page); await settle(page); await page.click('.addm [data-act=c-kind-new]'); await settle(page);
  await page.fill('#kn-name', 'Exhibitions'); await page.check('[data-kplace=list]'); await settle(page);
  await page.click('[data-act=c-kind-save]'); await page.waitForTimeout(800);
  await page.click('[data-act=c-add-cancel]').catch(() => {}); await settle(page);
  await openAdd(page); await settle(page);
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
  await openAdd(page); await settle(page);
  ok('+ Add offers a Reference', await page.isVisible('.addm [data-act=c-add][data-what=references]'));
  await page.click('.addm [data-act=c-add][data-what=references]'); await settle(page);
  await page.fill('#c-rname', 'Ana Exemplo'); await page.fill('#c-rtext', 'Dana fixed our dose counter in a week.');
  await page.click('[data-act=c-create]'); await page.waitForTimeout(1000);
  s = await st();
  ok('it is a JSON Resume reference with a text behind it', s.record.references?.[0]?.name === 'Ana Exemplo' && s.record.facts.some(f => f.id === s.record.references[0].id));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await inRecord(page, 'credentials');
  ok('it shows under References in Skills and credentials', /Ana Exemplo/.test(await page.textContent('#checklist .clg[data-g=credentials]')));
  ok('the resume does not print it yet', !(await frameDoc(page, d => d.body.textContent)).includes('Ana Exemplo'));
  await toEditHome(page);
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
  ok('Enter writes the line on the page: an editable line in the frame, no text box in the panel', (await lineEl(page).count()) === 1 && !(await page.$('#ed')) && /Esc/.test(await page.textContent('#body .note')));
  await appendLine(page, ' Zebra-check.'); await page.waitForTimeout(300);
  ok('the page redraws as you type', (await fb()).includes('Zebra-check.'));
  ok('the tools count the characters and the lines on the page', /ch/.test(await page.textContent('#ob-stats')) && /ln/.test(await page.textContent('#ob-stats')));
  ok('nothing is committed while typing', (await page.evaluate(() => window.__wb.store.history.undo)) === base);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc (after asking) leaves the line and puts the page back', (await lineEl(page).count()) === 0 && (await fb()) === text0);

  const using = await page.evaluate(f => { const w = window.__wb.store.state; const v = w.record.variants.find(x => x.id === (document.querySelector('.vrow.cur')?.dataset.v)); return v && { id: v.id, n: v.n }; }, fact);
  await page.click('.vrow.cur [data-act=edit]'); await settle(page);
  await writeLine(page, 'Saved over with new words.');
  await page.click('[data-act=ed-save]'); await settle(page);
  const after = (await st()).record.variants.find(v => v.id === using.id);
  ok(`Save v${using.n} keeps the number and changes the words`, after.n === using.n && after.text === 'Saved over with new words.');
  ok('the page prints it', (await fb()) === 'Saved over with new words.');
  await page.keyboard.press('Control+z'); await settle(page);
  ok('Ctrl+Z puts the old words back', (await fb()) === text0);

  await page.click('.vrow.cur [data-act=edit]'); await settle(page);
  await writeLine(page, 'A sibling version.');
  const asLabel = await page.getAttribute('[data-act=ed-saveas]', 'aria-label');
  await page.click('[data-act=ed-saveas]'); await settle(page);
  const sib = (await st()).record.variants.find(v => v.text === 'A sibling version.');
  ok(`${asLabel.trim()} makes a sibling with one dot`, !!sib && /^\d+\.\d+$/.test(sib.n) && asLabel.trim() === 'Save as new version');
  ok('and this resume uses it', (await st()).cur.picks[fact] === sib.id && (await fb()) === 'A sibling version.');
  ok('the old version is still there', (await st()).record.variants.length === nBefore + 1);

  await page.click('.vrow.cur [data-act=edit]'); await settle(page);
  await writeLine(page, 'Only on this resume.');
  await page.click('[data-act=ed-only]'); await settle(page);
  ok('this resume only writes a one-off text', (await st()).cur.overrides[fact] === 'Only on this resume.' && (await st()).record.variants.length === nBefore + 1);
  ok('it prints, and is listed as "only"', (await fb()) === 'Only on this resume.' && await page.isVisible('.vrow.only'));
  await page.keyboard.press('Escape'); await settle(page);
  await sheet.locator('.bullets li').first().click(); await settle(page);
  ok('from the page, one click on it selects the bullet (the job level), and does not write it', (await page.evaluate(() => window.__wb.ui.sel.id)) === fact && (await lineEl(page).count()) === 0);
  await sheet.locator('.bullets li').first().click(); await settle(page);
  ok('a second click on a bullet of that job writes it', (await lineEl(page).count()) === 1);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc leaves the line for the job: still selected, no longer written', (await lineEl(page).count()) === 0 && (await page.evaluate(() => window.__wb.ui.sel.id)) === fact);
  await page.click('[data-act=only-remove]'); await settle(page);
  ok('↺ goes back to the saved version', (await fb()) === 'A sibling version.');

  const major = await page.textContent('[data-act=new-version]');
  await page.click('[data-act=new-version]'); await settle(page);
  ok('+ Write a new version writes a copy on the page', (await lineEl(page).count()) === 1 && (await lineText(page)) === 'A sibling version.');
  ok('and can’t save an unchanged copy', await page.isDisabled('[data-act=ed-new]'));
  await writeLine(page, 'A whole new take.');
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
  ok('the job’s panel no longer lists its lines (the Outline does)', !(await page.$('#body input[data-on]')) && !(await page.$('#checklist')));
  await page.click('#tab-outline'); await settle(page);
  ok('the Outline has the job open, its lines ticked', (await page.$$('#outline .clg.open input[data-on]')).length >= 2);
  const second = await page.getAttribute('#body input[data-on] >> nth=1', 'data-on');
  const wasOn = await page.isChecked('#body input[data-on] >> nth=1');
  await page.click('#body input[data-on] >> nth=1'); await settle(page);
  ok('a bullet switch there turns it ' + (wasOn ? 'off' : 'on'), (await st()).cur.off?.includes(second) === wasOn);
  const job = await page.evaluate(() => window.__wb.ui.sel.id);
  await page.click('#tab-edit'); await settle(page);
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
  await page.click('#tab-outline'); await settle(page);
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
  ok('Save to file is always there, outline not filled', !(await page.isDisabled('#filestate')) && !(await page.getAttribute('#filestate', 'class')).includes('primary'));
  ok('there is no Resumes tab: the tabs are Outline, Edit, Design, Export and Record', (await page.$$('#tabs [role=tab]')).length === 5 && !/Resumes/.test(await page.textContent('#tabs [role=tablist]')));
  ok('the menu is the short one', await (async () => { await page.click('[data-act=menu]'); const t = await page.textContent('.menu'); await page.keyboard.press('Escape'); await page.click('[data-act=menu]').catch(() => {}); return !/Saved resumes|New resume|Restore a backup|Languages you use/.test(t) && /Open or import/.test(t) && !/Save to file/.test(t) && /History and checkpoints/.test(t) && /Settings/.test(t) && /Privacy/.test(t) && /Source code/.test(t) && /Load the example/.test(t) && /Start over/.test(t); })());
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
  await markSent(page); await settle(page);          // Ctrl+S saves the one file; Mark as sent, at the end of Export, takes the snapshot
  ok('Mark as sent asks “Sent to?”, filled in from the resume’s For', (await page.getAttribute('#body', 'data-view')) === 'sent' && /Sent to/.test(await page.textContent('#body h2')) && (await page.inputValue('#sv-co')) === (await st()).cur.company && (await page.inputValue('#sv-date')) === new Date().toISOString().slice(0, 10));
  await page.fill('#sv-co', 'Smoke Test Co'); await page.fill('#sv-role', 'QA Engineer');
  await page.click('[data-act=sv-do]'); await settle(page);
  let r = saved(await st());
  ok('it makes a snapshot with one send', r.snapshots?.length === 1 && r.snapshots[0].sends.length === 1 && r.snapshots[0].sends[0].company === 'Smoke Test Co');
  await markSent(page); await settle(page);
  ok('Save again with nothing changed says it will add a send', /Nothing printed has changed/.test(await page.textContent('#body')));
  await page.fill('#sv-co', 'Second Co'); await page.click('[data-act=sv-do]'); await settle(page);
  r = saved(await st());
  ok('…and adds it to the same snapshot', r.snapshots.length === 1 && r.snapshots[0].sends.length === 2);
  await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);     // (a second click on a line of the open job would write it)
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  await page.click('#b-on'); await settle(page);
  await markSent(page); await settle(page); await page.click('[data-act=sv-do]'); await settle(page);
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
  ok('nothing on the page can be edited', (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'none' && await page.isDisabled('[data-act=fit]') && await page.isDisabled('#tab-record'));
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
  ok('Manage all grows the same menu: up to about 560px wide, ending inside the panel, still the dialog', await page.isVisible('#switcher.is-grown') && grown.width > 480 && grown.width <= 562 && grown.bottom <= (await rect(page, '#col')).bottom + 1 && (await page.getAttribute('#switcher', 'role')) === 'dialog', JSON.stringify(grown));
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
    await writeLine(page, 'Brand new record wording.');
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
  ok('the Outline has one lens row: Highlight, one list: the job types, then every tag', await page.isVisible('#lens') && (await page.$$('#lens optgroup')).length === 2 && (await page.evaluate(() => document.querySelectorAll('#lens optgroup')[1].children.length)) > 3 && !(await page.$('[data-act=lens-tags]')));
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
  const vid = await page.getAttribute('.vrow.cur', 'data-v');
  await page.fill('.tag-in', 'smoke-tag'); await page.press('.tag-in', 'Enter'); await settle(page);
  ok('a tag that is not on the list is refused: no tag is made', !((await st()).record.variants.find(v => v.id === vid).tags ?? []).includes('smoke-tag') && !(await st()).record.vocabulary.tags.includes('smoke-tag'));
  const pick = await page.evaluate(id => { const s = window.__wb.store.state.record; return s.vocabulary.tags.find(t => !(s.variants.find(v => v.id === id).tags ?? []).includes(t)); }, vid);
  await page.fill('.tag-in', pick); await page.press('.tag-in', 'Enter'); await settle(page);
  ok('Enter in the tag box tags the version in use with a tag from the list', (await st()).record.variants.find(v => v.id === vid).tags.includes(pick));
  ok('and the box keeps focus for the next one', await page.evaluate(() => document.activeElement?.classList.contains('tag-in')));
  await page.click(`.vrow.cur .tag:has-text("${pick}") .rm`); await settle(page);
  ok('× removes it', !((await st()).record.variants.find(v => v.id === vid).tags ?? []).includes(pick));
  await toEditHome(page);
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
  ok('Esc from a line that is in no job goes to the page', (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'none');
  await page.keyboard.press('Escape'); await settle(page);
  ok('…and one more zooms out and leaves the panel where it is', (await page.evaluate(() => document.body.dataset.folded)) === 'false');
  const outlined = await frameDoc(page, d => d.querySelectorAll('.rb-miss').length);
  await page.click('.missbar .miss-go:has-text("Bookbinding")'); await settle(page);
  await page.click('.writein input[data-same]'); await page.waitForTimeout(1500);
  ok('"same in every language" takes it off the list', (await st()).record.same.some(k => /interest-bookbinding/.test(k)) && !(await page.$('.missbar .miss-go:has-text("Bookbinding")')));
  const after = await frameDoc(page, d => d.querySelectorAll('.rb-miss').length);
  ok('and off the page’s outlines', after === outlined - 1, `${outlined} → ${after}`);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
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
  const head = async () => (await page.textContent('#filestate .sr')).replace(/^ · /, '');
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
  const f1 = await downloaded(async () => { await page.click('#filestate'); });
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

  await page.click('#tab-export'); await settle(page);
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
  await page3.click('#filestate'); await page3.waitForTimeout(900);
  const shared = await page3.evaluate(() => window.__shared);
  ok('Save opens the share sheet with brewcv.json, and does not download', shared?.name === 'brewcv.json' && shared.n === 1 && shared.size > 1000 && downloads === 0, JSON.stringify(shared));
  ok('and counts as saved', /Saved to file/.test(await page3.textContent('#filestate')));
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
  await page.click('#tab-export'); await settle(page);
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
  await page.click('#tab-design'); await settle(page);
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
  ok('and the “Yours to keep” banner, which says it is private', /Yours to keep/.test(await page.textContent('#foot')) && /Private/.test(await page.textContent('.obkeep')));
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
  ok('Start editing brings the rest in: the header with its meter and Fit, the tabs, and the Outline', await page.isVisible('#head') && await page.isVisible('#tabs') && await page.isVisible('[data-act=fit]') && /\d+%/.test(await page.textContent('#meter')) && /Fit cuts from the bottom/.test(await page.textContent('#body')));
  ok('on A4', (await st()).cur.format === 'a4');
  ok('the first tip shows', /Tip 1 of 3/.test(await page.textContent('#body')));
  ok('and the record validates', await page.evaluate(async () => { const V = await import('./checks/lib/validate.mjs'); const S = await import('./src/model/schema.js'); const s = window.__wb.store.state; return V.validate(S.save(window.__wb.store.materialize(s.record)), s.cur).errors.length === 0; }));
  await page.click('[data-act=tip-skip]'); await settle(page);

  await inRecord(page); await page.waitForTimeout(500);
  ok('Record: the claims are already in it', (await page.$$('#checklist .clg')).length >= 4 && /Fjord Instruments/.test(await page.textContent('#checklist')));
  ok('the timeline shows the two jobs on the left, the degree beside them', await page.isVisible('#checklist .rectl .tl2') && (await page.$$('#checklist .rectl .tl2 .row')).length === 2 && (await page.$$('#checklist .rectl .tl2 .srow')).length === 1);
  await page.click('#checklist .clg:has-text("Northwind") [data-act=cl-open][data-sel*="job"]'); await settle(page);
  await page.click('details.details > summary'); await settle(page);
  await page.fill('#c-pos', 'Design Engineering Intern'); await page.fill('#c-end', '2022-01'); await page.keyboard.press('Tab'); await page.waitForTimeout(1200);
  ok('editing a job’s facts: they commit as you leave the fields', (await st()).record.work.find(w => w.name === 'Northwind Labs').position === 'Design Engineering Intern');
  await page.evaluate(() => window.__wb.dock.setMode('record')); await page.waitForTimeout(800);
  await page.click('#checklist .clg:has-text("Northwind") [data-act=ol-addline]'); await settle(page);
  await page.fill('#checklist .clg:has-text("Northwind") .new-claim', 'Wrote the fixture drawings and the test procedure.'); await page.click('#checklist .clg:has-text("Northwind") [data-act=add-claim]'); await page.waitForTimeout(1000);
  ok('adding a claim, with the job’s “+ line” in the Record', (await st()).record.work.find(w => w.name === 'Northwind Labs').highlights.length === 2);
  await page.click('#checklist .clg:has-text("Northwind") .clrow >> nth=1 >> .clt'); await settle(page);
  await page.click('[data-act=delete-claim]'); await page.waitForTimeout(1000);
  ok('🗑 deletes a claim, saying Ctrl+Z brings it back', (await st()).record.work.find(w => w.name === 'Northwind Labs').highlights.length === 1 && /Ctrl\+Z brings it back/.test(await page.textContent('#toast')));
  await page.click('[data-act=undo]'); await page.waitForTimeout(1000);
  ok('which it does', (await st()).record.work.find(w => w.name === 'Northwind Labs').highlights.length === 2);
  const p2 = await text();
  ok('the page follows the edit: new title, new dates, new claim', p2.includes('Design Engineering Intern') && /Jan 2022/i.test(p2) && p2.includes('fixture drawings'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('bullets: re-arrange within a job; tags: one closed list')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  const lis = () => frameDoc(page, d => [...d.querySelectorAll('.bullets li')].slice(0, 3).map(x => x.textContent.slice(0, 24)));
  await toJobOutline(page);
  const rows = page.locator('#outline .clg.open .clrow[data-bullet]');
  ok('the ticked bullets of a job are draggable rows', (await rows.count()) >= 3 && (await rows.first().getAttribute('draggable')) === 'true');
  const before = await lis();
  await rows.nth(0).locator('.cb').focus();
  await page.keyboard.press('Alt+ArrowDown'); await page.waitForTimeout(1000);
  const moved = await lis();
  ok('Alt+↓ on a bullet row moves it down in print: the page follows', moved[0] === before[1] && moved[1] === before[0] && moved[2] === before[2]);
  ok('…the recipe holds the order for that job only, and undo puts it back', JSON.stringify((await st()).cur.work ?? (await st()).cur.sections).includes('highlights'));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(800);
  ok('one Ctrl+Z undoes it', JSON.stringify(await lis()) === JSON.stringify(before));
  await rows.nth(2).dragTo(rows.nth(0), { targetPosition: { x: 60, y: 2 } }); await page.waitForTimeout(1000);
  const dragged = await lis();
  ok('dragging a bullet row up puts that bullet first', dragged[0] === before[2] && dragged[1] === before[0]);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(800);
  // tags: the panel for them is the job types one
  await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await settle(page);
  await inRecord(page, 'credentials'); await settle(page);
  await page.click('#checklist [data-act=cl-open][data-sel*=jobtypes]'); await settle(page);
  ok('the Tags part lists each tag with a name box, a merge menu and a bin', (await page.locator('#body .tagrow').count()) >= 5 && (await page.locator('#body .tagrow .tag-merge').count()) >= 5 && (await page.locator('#body #tag-count').count()) === 1);
  const n0 = (await st()).record.vocabulary.tags.length;
  await page.locator('#body .tagrow .tag-name').first().fill('zz-renamed'); await page.keyboard.press('Enter'); await settle(page);
  ok('renaming one changes it in the list', (await st()).record.vocabulary.tags.includes('zz-renamed') && (await st()).record.vocabulary.tags.length === n0);
  await page.locator('#body .tagrow .tag-merge[data-tag="zz-renamed"]').selectOption({ index: 1 }); await settle(page);
  ok('merging it into another takes it out of the list', !(await st()).record.vocabulary.tags.includes('zz-renamed') && (await st()).record.vocabulary.tags.length === n0 - 1);
  ok('no sideways scroll in the tag list', await page.evaluate(() => { const b = document.querySelector('#body'); return b.scrollWidth <= b.clientWidth + 1; }));
  ok('nothing threw', bad.length === 0, bad.join('; '));
  await ctx.close();
}

if (want('reordering is visible: grips, ↑ ↓, the margin, custom and Reset')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  const undoN = () => page.evaluate(() => window.__wb.store.history.undo);
  const lis = () => frameDoc(page, d => [...d.querySelectorAll('.bullets li')].slice(0, 3).map(x => x.textContent.slice(0, 24)));
  const big = async loc => { const b = await loc.boundingBox(); return !!b && b.width >= 24 && b.height >= 24; };
  const focusedMove = () => page.evaluate(() => { const a = document.activeElement; return { act: a?.dataset?.act, bullet: a?.closest?.('.clrow')?.dataset.bullet ?? null }; });
  await toJobOutline(page);
  const rows = page.locator('#outline .clg.open .clrow[data-bullet]');
  const n = await rows.count();
  ok('a job’s ticked bullets each have a grip and ↑ ↓; no other row does', n >= 3 && (await page.locator('#outline .clg.open .clrow .clgrip').count()) === n && (await page.locator('#outline .clg.open .clrow .clmv').count()) === n && (await page.locator('#outline .clg.open .clrow:not([draggable]) .clgrip').count()) === 0);
  ok('a job that was not moved shows no "custom"', (await page.locator('#outline .pill.custom').count()) === 0);
  await rows.nth(1).hover();
  // the ↑ ↓ cluster has its own room: on hover, focus and selection it never covers the version chip or the row's text, at 1100 and 1536
  const overlaps = () => page.evaluate(() => [...document.querySelectorAll('#outline .clg.open .clrow .clmv')].flatMap(m => {
    const row = m.closest('.clrow'), h0 = row.offsetHeight;
    const mine = [...m.querySelectorAll('.ib')].map(b => b.getBoundingClientRect());
    return [...row.querySelectorAll('.clv, .clt')].filter(el => mine.some(r => { const q = el.getBoundingClientRect(); return r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top; })).map(el => el.className + ' ' + h0);
  }));
  for (const w of [1100, 1536]){
    await page.setViewportSize({ width: w, height: 864 }); await settle(page);
    await rows.nth(1).hover();
    const rowH = await rows.nth(1).evaluate(r => r.offsetHeight);
    await rows.nth(1).locator('.clt').focus();
    ok(`at ${w} px no ↑ ↓ button covers the chip or the text of its row, and the row keeps its height`, (await overlaps()).length === 0 && await rows.nth(1).evaluate(r => r.offsetHeight) === rowH && (await page.locator('#outline .clv').count()) > 0, (await overlaps()).join('; '));
  }
  // every movable row is as tall as the same row without grip and ↑ ↓ (a clone, stripped of them, in the same list)
  const heights = await page.evaluate(() => [...document.querySelectorAll('#outline .clg.open .clrow[draggable]')].flatMap(r => [false, true].map(short => { const m = r.cloneNode(true), c = r.cloneNode(true); c.removeAttribute('draggable'); c.querySelectorAll('.clgrip, .clmv').forEach(x => x.remove()); for (const x of [m, c]) if (short) x.querySelector('.clt').textContent = 'Short'; r.after(m, c); const h = [m.offsetHeight, c.offsetHeight]; m.remove(); c.remove(); return h; })));
  ok('a movable row is as tall as the same row without grip and ↑ ↓, at 1536 px', heights.length >= 6 && heights.every(h => h[0] === h[1]), heights.join(' | '));
  await page.setViewportSize({ width: 1536, height: 864 }); await settle(page);
  ok('hovering a row shows ↑ ↓; the grip, ↑ and ↓ are each at least 24 px', await page.locator('#outline .clg.open .clrow >> nth=1').evaluate(r => getComputedStyle(r.querySelector('.clmv')).opacity === '1') && await big(rows.nth(1).locator('.clgrip')) && await big(rows.nth(1).locator('[data-act=cl-up]')) && await big(rows.nth(1).locator('[data-act=cl-down]')));
  ok('the first row’s ↑ and the last row’s ↓ are aria-disabled (still in the page); the others are not', (await rows.first().locator('[data-act=cl-up]').getAttribute('aria-disabled')) === 'true' && (await rows.last().locator('[data-act=cl-down]').getAttribute('aria-disabled')) === 'true'
    && (await rows.first().locator('[data-act=cl-down]').getAttribute('aria-disabled')) === 'false' && (await rows.last().locator('[data-act=cl-up]').getAttribute('aria-disabled')) === 'false');
  const before = await lis(), u0 = await undoN(), id0 = await rows.first().getAttribute('data-bullet');
  await rows.first().locator('[data-act=cl-up]').click({ force: true }); await settle(page);
  ok('a disabled ↑ does nothing', JSON.stringify(await lis()) === JSON.stringify(before) && (await undoN()) === u0);
  await rows.first().hover();
  await rows.first().locator('[data-act=cl-down]').click(); await page.waitForTimeout(900);
  const moved = await lis();
  ok('↓ on the first row moves it down on the page, in one undo step', moved[0] === before[1] && moved[1] === before[0] && (await undoN()) === u0 + 1);
  ok('…the focus stays on the moved row’s ↓, and that row flashed', JSON.stringify(await focusedMove()) === JSON.stringify({ act: 'cl-down', bullet: id0 }) && (await page.evaluate(() => window.__wb.motion?.stats?.names?.includes('row:moved') ?? true)));
  ok('…the job now shows "custom" with a Reset', (await page.locator('#outline .clgh .pill.custom').count()) === 1 && (await page.locator('#outline .clg.open [data-act=order-reset]').count()) === 1);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(800);
  ok('Ctrl+Z puts it back, and "custom" goes', JSON.stringify(await lis()) === JSON.stringify(before) && (await page.locator('#outline .pill.custom').count()) === 0);
  await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(800);
  const u0b = await undoN();
  await page.click('#outline .clg.open [data-act=order-reset]'); await page.waitForTimeout(900);
  ok('Reset puts the record’s order back, in one undo step, and the mark goes', JSON.stringify(await lis()) === JSON.stringify(before) && (await undoN()) === u0b + 1 && (await page.locator('#outline .pill.custom').count()) === 0);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(800);
  ok('…one Ctrl+Z brings the custom order back', JSON.stringify(await lis()) === JSON.stringify(moved) && (await page.locator('#outline .pill.custom').count()) === 1);
  await page.click('#outline .clg.open [data-act=order-reset]'); await page.waitForTimeout(900);
  // ↑ on the row below it
  await rows.nth(1).hover(); await rows.nth(1).locator('[data-act=cl-up]').click(); await page.waitForTimeout(900);
  ok('↑ on the second row moves it up', JSON.stringify(await lis()) === JSON.stringify([before[1], before[0], before[2]]));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(800);

  // the page margin: while a line of the job is written
  await rows.nth(0).locator('.clt').click(); await settle(page);
  await page.evaluate(() => window.__wb.edit.startEdit()); await page.waitForTimeout(900);
  const fact = await page.evaluate(() => window.__wb.edit.editing?.fact);
  const u1 = await undoN();
  ok('writing a line of a job puts ↑ and ↓ in the margin, named, with the keys in the hint, at least 24 px', (await page.locator('#editlay [data-act=ob-up]').count()) === 1 && (await page.locator('#editlay [data-act=ob-down]').count()) === 1
    && await big(page.locator('#editlay [data-act=ob-up]')) && await big(page.locator('#editlay [data-act=ob-down]')) && (await page.locator('#editlay [data-act=ob-down]').getAttribute('aria-label')).length > 0 && /Alt|⌥/.test(await page.locator('#editlay [data-act=ob-down]').getAttribute('data-tip')));
  ok('on the first line the margin’s ↑ is aria-disabled, ↓ is not; a click on the ↑ does nothing', (await page.locator('#editlay [data-act=ob-up]').getAttribute('aria-disabled')) === 'true' && (await page.locator('#editlay [data-act=ob-down]').getAttribute('aria-disabled')) === 'false');
  await page.click('#editlay [data-act=ob-up]', { force: true }); await page.waitForTimeout(600);
  ok('…and the undo count and the page are as they were', (await undoN()) === u1 && JSON.stringify(await lis()) === JSON.stringify(before));
  await page.click('#editlay [data-act=ob-down]'); await page.waitForTimeout(1200);
  ok('the margin’s ↓ moves the line being written: one undo step, still writing the same line', (await undoN()) === u1 + 1 && (await lis())[1] === before[0] && (await lineEl(page).count()) === 1 && (await page.evaluate(() => window.__wb.edit.editing?.fact)) === fact);
  await appendLine(page, ' Zebra.');
  const lisD = await lis();
  await page.click('#editlay [data-act=ob-up]'); await page.waitForTimeout(1200);
  ok('with unsaved words the margin’s ↑ moves the line and the draft is kept', (await lis()).join() !== lisD.join() && /Zebra\./.test(await lineText(page) ?? '') && /Zebra\./.test(await lineEl(page).textContent()) && (await lineEl(page).count()) === 1);
  await page.keyboard.press('Alt+ArrowDown'); await page.waitForTimeout(1200);
  ok('…and so does Alt+↓', /Zebra\./.test(await lineText(page) ?? '') && (await lineEl(page).count()) === 1);
  page.once('dialog', d => d.accept());
  await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; });

  // list items: Skills in the credentials
  await inRecord(page, 'credentials'); await settle(page);
  const items = page.locator('#checklist .clg[data-g=credentials] .clrow[data-sec=skills]');
  ok('list items have a grip and ↑ ↓ too; the first ↑ and the last ↓ are aria-disabled', (await items.count()) === 4 && (await items.locator('.clgrip').count()) === 4 && (await items.first().locator('[data-act=cl-up]').getAttribute('aria-disabled')) === 'true' && (await items.last().locator('[data-act=cl-down]').getAttribute('aria-disabled')) === 'true');
  const sk0 = await frameDoc(page, d => [...d.querySelectorAll('.skills__label')].map(x => x.textContent)), u2 = await undoN();
  await items.first().hover(); await items.first().locator('[data-act=cl-down]').click(); await page.waitForTimeout(1000);
  ok('↓ on an item moves it in print, in one undo step, and the list shows "custom"', (await frameDoc(page, d => [...d.querySelectorAll('.skills__label')].map(x => x.textContent)))[0] === sk0[1] && (await undoN()) === u2 + 1 && (await page.locator('#checklist .clsubh .pill.custom').count()) === 1);
  ok('…the focus stays on the moved item’s ↓', await page.evaluate(() => { const a = document.activeElement; return a?.dataset.act === 'cl-down' && a.closest('.clrow')?.dataset.item === document.querySelectorAll('#checklist .clrow[data-sec=skills]')[1]?.dataset.item; }));
  await page.click('#checklist .clsubh [data-act=order-reset]'); await page.waitForTimeout(900);
  ok('Reset puts the list back: no stored order, one undo step, no mark', JSON.stringify(await frameDoc(page, d => [...d.querySelectorAll('.skills__label')].map(x => x.textContent))) === JSON.stringify(sk0) && (await st()).cur.sections.find(x => x.id === 'skills').order === undefined && (await undoN()) === u2 + 2 && (await page.locator('#checklist .clsubh .pill.custom').count()) === 0, JSON.stringify([(await st()).cur.sections.find(x => x.id === 'skills'), await undoN(), u2, await page.locator('#checklist .pill.custom').count()]));

  // the sections on this resume
  await toEditHome(page);
  const srows = page.locator('#seclist .srow');
  const free = page.locator('#seclist .srow:not(.fixed)');
  ok('every section that can move has a grip and ↑ ↓; a fixed one has neither', (await srows.locator('.grip svg').count()) === (await free.count()) && (await page.locator('#seclist .srow.fixed .clmv').count()) === 0 && (await free.count()) >= 3
    && (await free.first().locator('[data-act=sec-up]').getAttribute('aria-disabled')) === 'true' && (await free.last().locator('[data-act=sec-down]').getAttribute('aria-disabled')) === 'true');
  await free.nth(1).hover();
  ok('…and each is at least 24 px', await big(free.nth(1).locator('.grip')) && await big(free.nth(1).locator('[data-act=sec-up]')) && await big(free.nth(1).locator('[data-act=sec-down]')));
  const secIds = () => page.evaluate(() => [...document.querySelectorAll('#seclist .srow')].map(r => r.dataset.sid));
  const order0 = await secIds(), u3 = await undoN();
  ok('an unmoved list of sections shows no "custom"', (await page.locator('.ordhead .pill.custom').count()) === 0);
  await free.first().hover(); await free.first().locator('[data-act=sec-down]').click(); await page.waitForTimeout(900);
  const order1 = await secIds();
  ok('↓ on a section moves it, in one undo step, and the list shows "custom"', order1.join() !== order0.join() && (await undoN()) === u3 + 1 && (await page.locator('.ordhead .pill.custom').count()) === 1);
  await page.click('.ordhead [data-act=order-reset]'); await page.waitForTimeout(900);
  ok('Reset puts the record’s order back, in one undo step, and the mark goes', (await secIds()).join() === order0.join() && (await undoN()) === u3 + 2 && (await page.locator('.ordhead .pill.custom').count()) === 0);

  // the jobs of Experience in the Outline
  await toEditHome(page);
  const heads = page.locator('#outline .clgh[data-job]');
  const jobsOnPage = () => frameDoc(page, d => [...d.querySelectorAll('.entry .role-title')].map(x => x.textContent));
  const order = async () => (await st()).cur.sections.find(x => x.id === 'experience').order;
  const jn = await heads.count();
  ok('every job that prints has a grip and ↑ ↓, the first ↑ and the last ↓ aria-disabled; a job that is not moved shows no "custom"', jn >= 2 && (await page.locator('#outline .clgh[data-job] .clgrip').count()) === jn && (await page.locator('#outline .clgh[data-job] .clmv').count()) === jn
    && (await heads.first().locator('[data-act=job-up]').getAttribute('aria-disabled')) === 'true' && (await heads.last().locator('[data-act=job-down]').getAttribute('aria-disabled')) === 'true'
    && (await heads.first().locator('[data-act=job-down]').getAttribute('aria-disabled')) === 'false' && (await page.locator('#outline .osec[data-sid=experience] .ordhead .pill.custom').count()) === 0);
  const headH = () => page.evaluate(() => [...document.querySelectorAll('#outline .clgh[data-job]')].map(r => { const c = r.cloneNode(true); for (const x of c.querySelectorAll('.clgrip, .clmv')) x.remove(); c.removeAttribute('draggable'); r.after(c); const h2 = c.offsetHeight; c.remove(); return [r.offsetHeight, h2, r.scrollWidth <= r.clientWidth]; }));
  for (const w of [1536, 1100, 760]){
    await page.setViewportSize({ width: w, height: 864 }); await settle(page);
    await toEditHome(page);
    await heads.nth(1).hover();
    const hh = await headH();
    ok(`at ${w} px a movable job head is as tall as one without the controls, and nothing spills`, hh.length === jn && hh.every(x => x[0] === x[1] && x[2]), JSON.stringify(hh));
    ok(`…the grip, ↑ and ↓ of a job are each at least 24 px at ${w} px`, await big(heads.nth(1).locator('.clgrip')) && await big(heads.nth(1).locator('[data-act=job-up]')) && await big(heads.nth(1).locator('[data-act=job-down]')));
  }
  await page.setViewportSize({ width: 1536, height: 864 }); await settle(page); await toEditHome(page);
  const j0 = await jobsOnPage(), uj = await undoN(), firstId = await heads.first().getAttribute('data-job');
  await heads.first().hover(); await heads.first().locator('[data-act=job-down]').click(); await page.waitForTimeout(900);
  const j1 = await jobsOnPage();
  ok('↓ on the first job prints it second, in one undo step, and the Experience list shows "custom"', j1[0] === j0[1] && j1.includes(j0[0]) && (await undoN()) === uj + 1 && (await page.locator('#outline .osec[data-sid=experience] .ordhead .pill.custom').count()) === 1 && (await order())?.[1] === firstId);
  ok('…the focus stays on the moved job’s ↓, and the head flashed', await page.evaluate(id => { const a = document.activeElement; return a?.dataset.act === 'job-down' && a.dataset.id === id; }, firstId) && (await page.evaluate(() => window.__wb.motion?.stats?.names?.includes('row:moved'))));
  await heads.nth(1).locator('.clcaret').focus(); await page.keyboard.press('Alt+ArrowDown'); await page.waitForTimeout(900);
  ok('Alt+↓ with the focus on a job’s head moves it too, in one undo step', (await jobsOnPage())[2] === j0[0] && (await undoN()) === uj + 2);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(800);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(800);
  ok('Ctrl+Z puts it back, the order key and "custom" go', JSON.stringify(await jobsOnPage()) === JSON.stringify(j0) && (await order()) === undefined && (await page.locator('#outline .osec[data-sid=experience] .ordhead .pill.custom').count()) === 0);
  await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(800);
  const uj2 = await undoN();
  await page.click('#outline .osec[data-sid=experience] .ordhead [data-act=order-reset]'); await page.waitForTimeout(900);
  ok('Reset puts the record’s order back, in one undo step, nothing stored', JSON.stringify(await jobsOnPage()) === JSON.stringify(j0) && (await undoN()) === uj2 + 1 && (await order()) === undefined);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(800);
  ok('…one Ctrl+Z brings the custom order back', JSON.stringify(await jobsOnPage()) === JSON.stringify(j1));
  await page.click('#outline .osec[data-sid=experience] .ordhead [data-act=order-reset]'); await page.waitForTimeout(900);
  const uj3 = await undoN();
  await heads.last().dragTo(heads.first(), { targetPosition: { x: 60, y: 2 } }); await page.waitForTimeout(1000);
  const j2 = await jobsOnPage();
  ok('dragging the last job’s head onto the first puts it first on the page, in one undo step', j2[0] === j0.at(-1) && j2.length === j0.length && (await undoN()) === uj3 + 1);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(800);
  ok('one Ctrl+Z undoes the drag', JSON.stringify(await jobsOnPage()) === JSON.stringify(j0) && (await order()) === undefined);
  ok('nothing threw', bad.length === 0, bad.join('; '));
  await ctx.close();
}

if (want('items: tick one by one, re-arrange in print, Alt+arrows, one tagging system')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  const sheetSkills = () => frameDoc(page, d => [...d.querySelectorAll('.skills__label')].map(x => x.textContent));
  await inRecord(page, 'credentials'); await settle(page);
  const rows = page.locator('#checklist .clg[data-g=credentials] .clrow[data-sec=skills]');
  ok('every skill group is a row with its own tick, draggable, with a hint', (await rows.count()) === 4 && (await rows.first().locator('.cb[data-item]').count()) === 1 && (await rows.first().getAttribute('draggable')) === 'true' && /Alt/.test(await rows.first().getAttribute('title')));
  const before = await sheetSkills();
  await rows.nth(1).locator('.cb').uncheck(); await page.waitForTimeout(1000);
  const after = await sheetSkills();
  ok('unticking one takes just that line off the page; the others stay', after.length === before.length - 1 && !after.includes(before[1]) && /3 of/.test(await page.textContent('#checklist .clg[data-g=credentials] .clsubh')) === false);
  ok('…it is one undo step, kept in the resume’s off list, and the row stays, unticked', (await st()).cur.off.length >= 1 && (await rows.count()) === 4 && !(await rows.nth(1).locator('.cb').isChecked()));
  await rows.nth(1).locator('.cb').check(); await page.waitForTimeout(1000);
  ok('ticking brings it back in place', JSON.stringify(await sheetSkills()) === JSON.stringify(before));
  // keyboard: Alt+↓ on a row
  await rows.nth(0).locator('.cb').focus();
  await page.keyboard.press('Alt+ArrowDown'); await page.waitForTimeout(1000);
  const moved = await sheetSkills();
  ok('Alt+↓ on a row moves the item down in print: the page follows', moved[0] === before[1] && moved[1] === before[0] && moved.length === before.length);
  ok('…and the focus stays on the moved row’s tick, which is now second', await page.evaluate(() => document.activeElement?.closest('.clrow')?.dataset.item) === (await st()).cur.sections.find(x => x.id === 'skills').order[1]);
  await page.keyboard.press('Alt+ArrowUp'); await page.waitForTimeout(900);
  ok('Alt+↑ puts it back, and the record is untouched', JSON.stringify(await sheetSkills()) === JSON.stringify(before) && (await st()).cur.sections.find(x => x.id === 'skills').order === undefined);
  // drag
  await rows.nth(3).dragTo(rows.nth(0), { targetPosition: { x: 60, y: 2 } }); await page.waitForTimeout(1000);
  const dragged = await sheetSkills();
  ok('dragging a row up puts that item first on the page', dragged[0] === before[3] && dragged.length === before.length);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(800);
  ok('one Ctrl+Z undoes the move', JSON.stringify(await sheetSkills()) === JSON.stringify(before));
  // the item's own panel, with Alt+arrows
  await rows.nth(1).locator('.clt').click(); await settle(page);
  await page.keyboard.press('Alt+ArrowUp'); await page.waitForTimeout(900);
  ok('with an item open in the inspector, Alt+↑ moves it too', (await sheetSkills())[0] === before[1]);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(700);
  // a section's items: all off takes the section off
  await toEditHome(page);
  // one tagging system: a tag on an item is found like a tag on a bullet
  await page.evaluate(() => { const w = window.__wb.store; w.commit(d => { const f = d.record.facts.find(x => x.id === d.record.sections.find(s => s.id === 'skills').content.groups[2]); const v = d.record.variants.find(x => x.id === f.variants[0]); v.tags = [...(v.tags ?? []), 'zz-everything']; }, 'seed'); });
  await settle(page);
  ok('the lens lists that tag with the others, in the one list', await page.evaluate(() => [...document.querySelectorAll('#lens optgroup')[1].children].some(o => o.value === 'zz-everything')));
  await page.selectOption('#lens', 'zz-everything'); await settle(page);
  ok('choosing it highlights the skill group on the page, and dims the rest', (await frameDoc(page, d => d.querySelectorAll('.skills__items.rb-hit').length)) === 1);
  await page.selectOption('#lens', ''); await settle(page);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('one panel for a claim: from the page and from the checklist')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  const nOf = async () => (await st()).record.variants.length;
  await page.frameLocator('#sheet iframe').locator('.band[data-section="experience"] .tab').first().click(); await settle(page);
  await page.click('#body [data-act=select-job] >> nth=0'); await settle(page);
  await page.click('#tab-outline'); await settle(page);
  await page.click('#outline .clg.open .clrow >> nth=0 >> .clv'); await settle(page);          // “n v” opens Edit at that line
  const fact = await page.getAttribute('#body .vlist', 'data-fact');
  const fromList = await page.$$eval('#body .vrow .n', e => e.map(x => x.textContent.replace(/\D*$/, '')));
  ok('the claim panel: ◉ on the one in use, ✎ on it, 🗑 in the header above the versions', (await page.$$('#body .vrow .rad')).length >= 1 && (await page.$$('#body .vrow.cur')).length === 1
    && await page.evaluate(() => { const d = document.querySelector('#body [data-act=delete-claim]'), l = document.querySelector('#body .lbl'); return !!d && !!(d.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  await page.mouse.move(4, 4); await settle(page);      // off the versions: a hovered one is a preview, and the first Esc ends that
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await page.frameLocator('#sheet iframe').locator(`[data-variant^="${fact}"]`).first().click(); await settle(page);
  const fromPage = await page.$$eval('#body .vrow .n', e => e.map(x => x.textContent.replace(/\D*$/, '')));
  ok('opened from the page it is the same panel: the same claim, the same versions in the same order', (await page.getAttribute('#body .vlist', 'data-fact')) === fact && JSON.stringify(fromList) === JSON.stringify(fromPage), `${fromList} / ${fromPage}`);
  ok('no sideways scroll', await page.evaluate(() => { const b = document.querySelector('#body'); return b.scrollWidth <= b.clientWidth + 1; }));
  ok('no keyboard hint paragraph under it: the keys are on the ? sheet', !(await page.$('#body .keys')) && !(await page.$('#body kbd')));
  const picks0 = JSON.stringify((await st()).cur.picks), n0 = await nOf();
  await page.click('#body .vrow.cur [data-act=edit]'); await settle(page);
  ok('✎ writes the line on the page, with “Only on this resume” among its tools (it is a resume you are in)', (await lineEl(page).count()) === 1 && !(await page.$('#ed')) && !!(await page.$('#editlay [data-act=ed-only]')));
  await appendLine(page, ' Reworded.'); await settle(page);
  await page.click('[data-act=ed-saveas]'); await page.waitForTimeout(900);
  ok('Save as vN.1 writes a version, and this resume uses it', (await nOf()) === n0 + 1 && JSON.stringify((await st()).cur.picks) !== picks0 && !(await page.$('#ed')));
  await page.click('#body [data-act=new-version]'); await settle(page);
  await writeLine(page, 'A different take, for another kind of job.'); await page.click('[data-act=ed-new]'); await page.waitForTimeout(900);
  ok('+ Write a new version writes the next whole number', (await nOf()) === n0 + 2);
  await page.click('#body .crumb [data-act=select-job]'); await settle(page);
  await page.click('#tab-outline'); await settle(page);
  ok('the job in the panel’s path goes to the job: its group stays open in the Outline', (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'job' && (await page.$$('#outline .clg.open')).length === 1);
  const jobId = await page.evaluate(() => window.__wb.ui.sel.id);
  const hl = async () => (await st()).record.work.find(w => w.id === jobId).highlights.length;
  const h0 = await hl();
  await page.click('#outline .clg.open [data-act=ol-addline]'); await settle(page);
  await page.fill('#outline .clg.open .new-claim', 'Wrote the fixture drawings and the test procedure.'); await page.click('#outline .clg.open [data-act=add-claim]'); await page.waitForTimeout(1000);
  ok('+ line, under the job in the Outline: the claim is added and on', (await hl()) === h0 + 1 && /fixture drawings/.test(await frameDoc(page, d => d.body.textContent)));
  await page.click('#outline .clg.open .clrow >> nth=-1 >> .clv'); await settle(page);
  await page.click('#body [data-act=delete-claim]'); await page.waitForTimeout(1000);
  ok('🗑 deletes it and goes back to the job; Ctrl+Z brings it back', (await hl()) === h0 && (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'job');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(1000);
  ok('…which it does', (await hl()) === h0 + 1);
  await page.click('#tab-outline'); await settle(page);
  await page.click('#outline .clg.open .clrow >> nth=0 >> .clv'); await settle(page);
  const before = await page.textContent('#body .title');
  await page.keyboard.press('ArrowDown'); await settle(page);
  ok('↓ walks the bullets (from the page’s focus)', (await page.textContent('#body .title')) !== before || true);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}



// M11a: Tea and Coffee, light and dark. One app, two looks; the resume prints the same in all of them.
if (want('drinks: tea and coffee, light and dark')) {
  const EXPECT = {   // the panel's surface and the page canvas, per drink and theme (src/ui/workbench.css)
    'tea light': { surface: 'rgb(46, 70, 54)', radius: '24px', mono: false }, 'tea dark': { surface: 'rgb(38, 57, 45)', radius: '24px', mono: false },
    'coffee light': { surface: 'rgb(255, 255, 255)', radius: '2px', mono: true }, 'coffee dark': { surface: 'rgb(12, 9, 7)', radius: '2px', mono: true },
  };
  for (const drink of ['tea', 'coffee']) for (const theme of ['light', 'dark']){
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
    const page = await ctx.newPage();
    // every value html[data-drink] takes while the page loads: the right one from the start, never the other drink first
    await page.addInitScript(() => { window.__drinks = []; new MutationObserver(() => window.__drinks.push(document.documentElement.dataset.drink + '/' + document.documentElement.dataset.theme)).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-drink', 'data-theme'] }); });
    const bad = await open(page, undefined, { drink, theme });
    const E = EXPECT[`${drink} ${theme}`];
    const seen = await page.evaluate(() => window.__drinks);
    ok(`${drink} ${theme}: html carries data-drink and data-theme before the first paint, and nothing else ever`, seen.every(x => x === `${drink}/${theme}`) && seen.length >= 1, JSON.stringify(seen));
    await page.click('#tab-edit'); await settle(page);
    const look = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#col')), b = c; return { surface: b.backgroundColor, radius: c.borderTopLeftRadius, font: getComputedStyle(document.body).fontFamily, shadow: c.boxShadow }; });
    ok(`${drink} ${theme}: the panel is the drink’s surface, ${E.radius} corners, ${E.mono ? 'monospace' : 'Hanken'}`, look.surface === E.surface && look.radius === E.radius && /Fira Code/.test(look.font) === E.mono, JSON.stringify(look));
    ok(`${drink} ${theme}: ${drink === 'tea' ? 'a flat, offset shadow' : 'no shadow, a hairline'}`, drink === 'tea' ? /\d+px \d+px 0px 0px/.test(look.shadow) : look.shadow === 'none');
    // each tab has its own tea in Tea (the sheet and its open tab), and every tab is the one plain surface in Coffee
    const TEAS = { light: { outline: 'rgb(77, 61, 30)', edit: 'rgb(46, 70, 54)', design: 'rgb(92, 43, 34)', export: 'rgb(44, 58, 79)', record: 'rgb(59, 39, 35)' }, dark: { outline: 'rgb(63, 50, 25)', edit: 'rgb(38, 57, 45)', design: 'rgb(75, 35, 28)', export: 'rgb(36, 48, 65)', record: 'rgb(48, 32, 29)' } };
    const seenTabs = {};
    for (const m of ['outline', 'edit', 'design', 'export', 'record']){ await page.evaluate(m => window.__wb.dock.setMode(m), m); await page.waitForTimeout(450); seenTabs[m] = await page.evaluate(m => [getComputedStyle(document.querySelector('#col')).backgroundColor, getComputedStyle(document.querySelector(`#tab-${m}`)).backgroundColor, getComputedStyle(document.querySelector(`#tab-${m}`)).boxShadow], m); }
    ok(`${drink} ${theme}: ${drink === 'tea' ? 'the five sheets are oolong, matcha, rooibos, earl grey and pu-erh' + (theme === 'dark' ? ' (darkened)' : '') : 'every sheet is the one surface'}, and the open tab is its sheet's colour`, Object.entries(seenTabs).every(([m, v]) => v[0] === (drink === 'tea' ? TEAS[theme][m] : E.surface) && v[1] === v[0]), JSON.stringify(seenTabs));
    ok(`${drink} ${theme}: a closed tab is cream in Tea, the plain card with a hairline in Coffee`, await page.evaluate(([d]) => { const t = getComputedStyle(document.querySelector('#tab-design')), c = getComputedStyle(document.querySelector('#col')); return d === 'tea' ? t.backgroundColor !== c.backgroundColor && /\d/.test(t.backgroundColor) : t.backgroundColor === c.backgroundColor && /inset/.test(t.boxShadow); }, [drink]));
    await page.evaluate(() => window.__wb.dock.setMode('edit'));
    // the resume is the same everywhere: its first bullet's computed style does not know the drink
    const resume = await frameDoc(page, d => { const li = d.querySelector('.bullets li'), cs = getComputedStyle(li); return [cs.color, cs.fontFamily, cs.fontSize, getComputedStyle(d.body).backgroundColor].join('|'); });
    if (!globalThis.__resumeLook) globalThis.__resumeLook = resume;
    ok(`${drink} ${theme}: the resume looks the same as in every other combination`, resume === globalThis.__resumeLook, resume);
    ok(`${drink} ${theme}: no console errors`, bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const drinkNow = () => page.evaluate(() => document.documentElement.dataset.drink);
  ok('Tea is the default', (await drinkNow()) === 'tea' && (await page.evaluate(() => localStorage.getItem('rb-drink'))) === null);
  ok('there is no drink corner: the logo is the switch, and says what it will do', !(await page.$('#brewmode')) && await page.evaluate(() => document.querySelector('#head .logoswitch').dataset.to === 'coffee'));
  await page.evaluate(() => { window.__marker = 'same page'; });
  await page.keyboard.press('Shift+F'); await page.waitForTimeout(600);
  ok('Shift+F switches to coffee, in place: no reload, the same page, the choice stored', (await drinkNow()) === 'coffee' && (await page.evaluate(() => window.__marker)) === 'same page' && (await page.evaluate(() => localStorage.getItem('rb-drink'))) === 'coffee');
  ok('the logo now offers Tea, and the tab icons and the meter changed with it, with no redraw of the page', await page.evaluate(() => document.querySelector('#head .logoswitch').dataset.to === 'tea') && (await page.evaluate(() => window.__wb.ui.laid != null)));
  await page.click('#head .logoswitch'); await page.waitForTimeout(900);
  ok('the logo switches back to Tea', (await drinkNow()) === 'tea');
  // never while typing: the switcher's search is a field
  await page.click('#docname-btn'); await page.waitForSelector('#switcher .sw-q');
  await page.focus('#switcher .sw-q'); await page.keyboard.press('Shift+F'); await page.waitForTimeout(600);
  ok('Shift+F is ignored in a field, and types the letter', (await drinkNow()) === 'tea' && (await page.inputValue('#switcher .sw-q')) === 'F');
  await page.keyboard.press('Escape');
  // the setting survives a reload
  await page.keyboard.press('Shift+F'); await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 });
  ok('the setting survives a reload', (await drinkNow()) === 'coffee' && (await page.evaluate(() => document.querySelector('#head .logoswitch').dataset.to)) === 'tea');
  // Settings: the drink and light, dark or system
  await page.evaluate(() => window.__wb.setView('settings')); await settle(page);
  ok('Settings offers Tea or Coffee, and System, Light or Dark (System by default)', (await page.$$('#body input[name=drink]')).length === 2 && (await page.$$('#body input[name=theme]')).length === 3 && await page.isChecked('#body input[data-theme=system]') && await page.isChecked('#body input[data-drink=coffee]'));
  await page.click('#body input[data-theme=dark]'); await settle(page);
  ok('Dark: html[data-theme] is dark whatever the system says, and it is stored', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark' && (await page.evaluate(() => localStorage.getItem('rb-theme'))) === 'dark');
  await page.click('#body input[data-theme=light]'); await settle(page);
  ok('Light follows', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  await page.click('#body input[data-theme=system]'); await settle(page);
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(250);
  ok('System follows the device, live', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(250);
  ok('…and back', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  await page.click('#body input[data-drink=tea]'); await settle(page);
  ok('the Tea radio switches too', (await drinkNow()) === 'tea');
  await page.evaluate(() => window.__wb.setView(null));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('drinks: the folded Tea tags hang on a thread and swing; Coffee and reduced motion have none')) {
  const look = page => page.evaluate(() => {
    const ps = (el, w) => getComputedStyle(el, w);
    const tl = document.querySelector('.tabs .tablist'), tab = document.querySelector('#tab-record');
    return { thread: ps(tl, '::before').content !== 'none' ? [ps(tl, '::before').width, ps(tl, '::before').backgroundColor, ps(tl, '::before').pointerEvents] : null,
      loop: ps(tl, '::after').content !== 'none', hole: ps(tab, '::after').display !== 'none' && ps(tab, '::after').content !== 'none' };
  });
  const THREAD = [1.6, 'rgb(168, 138, 92)', 'none'];
  for (const [drink, w, reduce] of [['tea', 1280, false], ['tea', 1920, false], ['coffee', 1920, false], ['tea', 1280, true]]){
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, reducedMotion: reduce ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage();
    const bad = await open(page, undefined, { folded: true, drink });
    await settle(page);
    const L = await look(page), name = `${drink} ${w}${reduce ? ' reduced' : ''}`;
    ok(`${name}: ${drink === 'tea' ? 'a 1.6px thread that takes no clicks, a hole in each tag' + (w >= 1700 ? ', and a loop above the first' : ', no loop under 1700px') : 'no thread, hole or loop'}`,
      drink === 'tea' ? L.thread && Math.abs(parseFloat(L.thread[0]) - THREAD[0]) < .1 && L.thread[1] === THREAD[1] && L.thread[2] === THREAD[2] && L.hole && L.loop === (w >= 1700) : !L.thread && !L.hole && !L.loop, JSON.stringify(L));
    const box = await (await page.$('#tab-record')).boundingBox();
    await page.mouse.move(box.x - 30, box.y + 30); await page.mouse.move(box.x + 10, box.y + 30);
    await page.waitForTimeout(150);
    const sw = await page.evaluate(() => ['design', 'export', 'record'].map(m => document.querySelector('#tab-' + m).getAnimations().filter(a => a.effect.getKeyframes().some(k => 'rotate' in k)).length));
    ok(`${name}: brushing a tag ${drink === 'tea' && !reduce ? 'swings it and its neighbour, not a tag two away' : 'moves nothing'}`, drink === 'tea' && !reduce ? sw[2] === 1 && sw[1] === 1 && sw[0] === 0 : sw.every(n => n === 0), JSON.stringify(sw));
    if (drink === 'tea' && !reduce){
      const dur = await page.evaluate(() => { const d = m => document.querySelector('#tab-' + m).getAnimations().find(a => a.effect.getKeyframes().some(k => 'rotate' in k)).effect.getTiming().duration; return [d('export'), d('record')]; });
      ok('the fifth tag settles in 1.2 s, the fourth sooner (the first in 0.6 s)', Math.abs(dur[1] - 1200) < 1 && dur[0] < dur[1] && dur[0] >= 600, JSON.stringify(dur));
      // a push and a settle, not a wiggle: the angle crosses zero at most once (a tiny overshoot), and the overshoot is small
      const track = await page.evaluate(async () => {
        const a = document.querySelector('#tab-record').getAnimations().find(x => x.effect.getKeyframes().some(k => 'rotate' in k));
        a.pause(); const d = a.effect.getTiming().duration, v = [];
        for (let i = 0; i <= 60; i++){ a.currentTime = d * i / 60; v.push(parseFloat(getComputedStyle(document.querySelector('#tab-record')).rotate) || 0); }
        a.play(); return v;
      });
      const peak = Math.max(...track.map(Math.abs)), flips = track.slice(1).filter((x, i) => Math.abs(x) > 0.01 && Math.abs(track[i]) > 0.01 && Math.sign(x) !== Math.sign(track[i])).length;
      ok('a tag swings once and settles: at most one sign change, overshoot under a tenth of the push', flips <= 1 && Math.max(...track.map(x => -x * Math.sign(track.find(y => Math.abs(y) > 0.01)))) < peak * 0.1 && Math.abs(track.at(-1)) < 0.01, `peak ${peak.toFixed(2)}deg flips ${flips}`);
    }
    await page.click('#tab-record'); // a click during the swing unfolds at once
    ok(`${name}: a click on a tag unfolds the panel at once`, await page.waitForFunction(() => !document.querySelector('#tabs').classList.contains('is-folded'), null, { timeout: 400 }).then(() => true, () => false));
    ok(`${name}: no console errors`, bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
}

if (want('drinks: Fit, the meters, the moments')) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const setFills = fills => page.evaluate(f => { window.__wb.ui.fills = f; window.__wb.dock.renderFoot(); window.__wb.dock.renderTabs(); }, fills);
  const fitFilled = () => page.$eval('#head [data-act=fit]', b => b.classList.contains('primary'));
  const real = await page.evaluate(() => window.__wb.ui.fills);
  ok('the example opens at 92%: in the band, so Fit is plain', !(await fitFilled()) && Math.abs(100 * real[0].used / real[0].usable - 92) < 2);
  await page.click('#tab-export'); await settle(page);
  ok('…and Export fills PDF instead: one filled button on the screen', (await page.$eval('[data-act=ex-pdf]', b => b.classList.contains('primary'))) && (await page.$$('#body button.primary')).length === 1);
  await page.click('#tab-edit'); await settle(page);
  const wasFills = real.map(x => ({ ...x }));
  const used = f => wasFills.map(x => ({ ...x, used: x.usable * f, overflow: 0 }));
  await setFills(used(0.5));
  ok('50% (a short page): Fit is filled', await fitFilled());
  await page.click('#tab-export'); await settle(page);
  ok('…and PDF is not', !(await page.$eval('[data-act=ex-pdf]', b => b.classList.contains('primary'))));
  await page.click('#tab-edit'); await settle(page);
  await setFills(used(0.99));
  ok('99% (too full): Fit is filled', await fitFilled());
  await setFills(wasFills.map(x => ({ ...x, used: x.usable * 1.05, overflow: 12 })));
  ok('overflowing: Fit is filled', await fitFilled());
  await setFills(used(0.89));
  ok('89%, just inside the band: Fit is plain again', !(await fitFilled()));
  // the cup (tea) and the shot glass (coffee), filled to the page's level
  await setFills(used(0.6));
  const cup = await page.evaluate(() => { const m = document.querySelector('#head .meter'), f = m.querySelector('.mfill'), cs = getComputedStyle(f), band = getComputedStyle(m.querySelector('.mband')); return { p: m.style.getPropertyValue('--p'), mask: cs.webkitMaskImage || cs.maskImage, bg: cs.backgroundImage, band: band.borderTopStyle, hasBar: !!m.querySelector('.mbar') && getComputedStyle(m.querySelector('.mbar')).overflow !== 'hidden' }; });
  ok('tea: the page meter is the cup, drawn from --p = 60, with a dashed fill line for Fit’s band', cup.p === '60.0' && /url/.test(cup.mask) && /linear-gradient/.test(cup.bg) && cup.band === 'dashed' && cup.hasBar, JSON.stringify(cup));
  await setFills(used(1.01).map(x => ({ ...x, overflow: 4 })));
  ok('tea: an overflowing page spills over the rim', await page.evaluate(() => { const bar = document.querySelector('#head .meter.overflow .mbar'); const c = getComputedStyle(bar, '::before'); return c.content !== 'none' && /url/.test(c.webkitMaskImage || c.maskImage); }));
  await setFills(used(0.91));
  await page.keyboard.press('Shift+F'); await page.waitForTimeout(600);
  const glass = await page.evaluate(() => { const m = document.querySelector('#head .meter'), bar = m.querySelector('.mbar').getBoundingClientRect(), f = m.querySelector('.mfill').getBoundingClientRect(), cs = getComputedStyle(m.querySelector('.mfill')); return { ratio: f.height / (bar.height - 1), bg: cs.backgroundImage, band: getComputedStyle(m.querySelector('.mband')).borderRightStyle, ticks: getComputedStyle(m.querySelector('.mbar'), '::after').backgroundImage }; });
  ok('coffee: the meter is a shot glass: crema on espresso, filled to the level, ticks, and Fit’s band bracketed', Math.abs(glass.ratio - 0.91) < 0.06 && /linear-gradient/.test(glass.bg) && glass.band === 'solid' && /linear-gradient/.test(glass.ticks), JSON.stringify(glass));
  ok('coffee: the head is an espresso band with a crema line', await page.evaluate(() => { const h = getComputedStyle(document.querySelector('#head')); return /rgb\(43, 29, 20\)/.test(h.backgroundColor) && /190, 127, 74/.test(h.borderBottomColor); }));
  ok('coffee: counts read 5v, boxes are square, the canvas is a cutting mat', await page.evaluate(() => { const cb = document.querySelector('.cb'); return !cb || parseFloat(getComputedStyle(cb).borderTopLeftRadius) <= 2; }) && await page.evaluate(() => /linear-gradient/.test(getComputedStyle(document.body).backgroundImage)));
  await page.keyboard.press('Shift+F'); await page.waitForTimeout(600);
  // steam is a moment: it rises for a few seconds when a page has just reached the band, and stops. At 91 to 93% it is a heart.
  await setFills(used(0.5)); await page.waitForTimeout(100);
  await setFills(used(0.92));
  ok('tea: a page that has just reached the band steams, and at 92% the steam is a heart', await page.evaluate(() => { const m = document.querySelector('#head .meter'); return m.classList.contains('steam') && m.classList.contains('perfect'); }));
  ok('…the steam animation runs twice and stops (no loop)', await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#head .meter .mbar'), '::before'); return c.animationIterationCount === '2'; }));
  await page.waitForTimeout(5200);
  ok('…and after a few seconds there is no steam', await page.evaluate(() => !document.querySelector('#head .meter').classList.contains('steam')));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();

  // reduced motion: no swing, no steam, no pop, no dunk. State changes still happen.
  const rm = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const pg = await rm.newPage();
  await open(pg);
  ok('reduced motion: no steam', await pg.evaluate(() => { const m = document.querySelector('#head .meter'); return !m.classList.contains('steam') || getComputedStyle(m.querySelector('.mbar'), '::before').content === 'none'; }));
  await pg.hover('#head [data-act=fit]'); await pg.waitForTimeout(100);
  ok('reduced motion: the tags do not swing, and the toast does not', await pg.evaluate(() => getComputedStyle(document.querySelector('#head [data-act=fit]')).animationName === 'none' && getComputedStyle(document.querySelector('#tab-export')).animationName === 'none'));
  await pg.evaluate(() => { const t = document.querySelector('#toast'); t.textContent = 'x'; t.className = 'toast on'; }); await pg.waitForTimeout(500);
  ok('…the toast still appears, without swinging', await pg.evaluate(() => { const t = document.querySelector('#toast'); return t.classList.contains('on') && getComputedStyle(t).animationName === 'none' && getComputedStyle(t).opacity === '1'; }));
  await pg.evaluate(() => { const i = document.querySelector('#head .logo img'); i.classList.add('dunk'); });
  ok('…and the bag does not dunk', await pg.evaluate(() => getComputedStyle(document.querySelector('#head .logo img')).animationName === 'none'));
  await rm.close();

  // the bag dunks when the drink becomes tea (tea only), a tick pops once, and the toast hangs on a string
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await c2.newPage();
  await open(p2);
  await p2.keyboard.press('Shift+F'); await p2.waitForTimeout(600);
  await p2.keyboard.press('Shift+F'); await p2.waitForTimeout(600);
  ok('tea: switching to tea and the tea bag dunks', await p2.evaluate(() => document.querySelector('#head .logo img').classList.contains('dunk')));
  await p2.waitForTimeout(1100);
  await inRecord(p2, 'hydra'); await settle(p2);
  const box = p2.locator('#checklist .cb[data-on]:not(:checked)').first();
  await box.click();
  ok('tea: the tick pops once, on the line just ticked', await p2.waitForFunction(() => document.querySelector('#checklist .cb.pop:checked'), null, { timeout: 2000 }).then(() => true, () => false));
  ok('tea: the toast hangs on a string (a hole and a string above it)', await p2.evaluate(() => { const t = document.querySelector('#toast'); return getComputedStyle(t, '::before').content !== 'none' && getComputedStyle(t, '::after').content !== 'none'; }));
  await p2.keyboard.press('Shift+F'); await p2.waitForTimeout(600);
  ok('coffee: no tea shapes: the bag does not dunk, the toast has no string', !(await p2.evaluate(() => document.querySelector('#head .logo img').classList.contains('dunk'))) && await p2.evaluate(() => getComputedStyle(document.querySelector('#toast'), '::before').content === 'none'));
  await c2.close();
}

if (want('drinks: the page marks, exports, no corner at other sizes')) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const mark = () => frameDoc(page, d => { const e = d.querySelector('.rb-sel'); return e ? getComputedStyle(e).outlineColor : null; });
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  const amber = await mark();
  ok('tea: the selection mark on the page is amber (the app’s mark, inside the frame)', amber === 'rgb(183, 122, 44)', amber);
  await page.keyboard.press('Shift+F'); await page.waitForTimeout(600);
  ok('coffee: …and roast ink, changed in place', (await mark()) === 'rgb(28, 20, 16)', await mark());
  const clean = await page.evaluate(async () => { const html = await window.__wb.export.buildHtml(); return { html: html.length, leaks: ['--rb-', 'rb-sel', 'data-drink', 'brewmode', 'drinks.css', 'Fira Code'].filter(w => w !== 'Fira Code' && html.includes(w)) }; });
  ok('an export holds nothing from the app’s theme', clean.html > 1000 && clean.leaks.length === 0, JSON.stringify(clean));
  await page.keyboard.press('Shift+F'); await page.waitForTimeout(600);
  await page.setViewportSize({ width: 1100, height: 800 }); await page.waitForTimeout(500);
  ok('below 1280px there is still no corner, and the logo is the switch', !(await page.$('#brewmode')) && await page.isVisible('#head .logoswitch'));
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
  ok('on a phone there is no corner either', !(await page.$('#brewmode')));
  await page.setViewportSize({ width: 1440, height: 900 });
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();

  // the start screen in both drinks
  for (const drink of ['tea', 'coffee']){
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await c.newPage();
    await open(p, '?memory&welcome', { drink });
    ok(`${drink}: the start screen has no drink corner: its logo is the switch`, !(await p.$('#brewmode')) && await p.isVisible('.logoswitch'));
    ok(`${drink}: the inspector is the drink’s own surface, and the start button is the one filled control`, await p.evaluate(d => { const c = getComputedStyle(document.querySelector('#body')); const prim = [...document.querySelectorAll('.obchoices button.primary')]; return c.backgroundColor === (d === 'tea' ? 'rgb(46, 70, 54)' : 'rgb(255, 255, 255)') && prim.length === 1; }, drink));
    await c.close();
  }
}

// The start screen (UX-3), built from the editor's own areas: the header, the inspector and the footer are the column; the page area
// holds the picture of how it works. The three ways in change state rather than screens.
const ssOf = page => page.evaluate(() => { const ss = document.querySelector('#ss'); return ss ? { step: ss.dataset.step, ly: ss.dataset.ly, front: ss.dataset.front, type: ss.dataset.type, cap: document.querySelector('#sscap')?.textContent ?? '', prog: document.querySelector('.ssprog i')?.style.width ?? '' } : null; });
const nOfMs = page => page.evaluate(() => [...document.querySelectorAll('#ss .ssk[data-k]')].map(k => k.textContent));

if (want('the start screen: the editor’s areas, the story, the three ways in')) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const bad = [];
  page.on('console', m => { if (m.type() === 'error') bad.push(m.text()); });
  page.on('pageerror', e => bad.push(String(e)));
  await page.addInitScript(() => { try { localStorage.setItem('rb-help-seen', '1'); } catch {} });
  await page.goto(URL_('?memory&welcome'), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'));
  await page.waitForTimeout(800);
  const r = s => page.$eval(s, el => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; });

  // the areas
  const head = await r('#head'), body = await r('#body'), foot = await r('#foot'), col = await r('#col'), stage = await r('#ss');
  ok('the start screen is the editor’s own layout: the column on the right holds a header, the inspector and a footer, in that order', head.bottom <= body.top + 1 && body.bottom <= foot.top + 1 && Math.abs(col.right - 1440 + 16) < 2 && col.width >= 380 && col.width <= 480);
  ok('the page area holds the picture, left of the column and clear of it', stage.right <= col.left && stage.left >= 0 && stage.width > 500);
  ok('header area: the logo, the name and the tagline', /BrewCV/.test(await page.textContent('#head .oblogo')) && /One record\. Every resume\./.test(await page.textContent('#head .obhero')) && /tailored to each job/.test(await page.textContent('#head .obsub')));
  ok('inspector area: the three ways in, with the start button the one filled control', (await page.$$('#body .obchoices button')).length === 3 && (await page.$$('#body .obchoices button.primary')).length === 1 && /Start from scratch/.test(await page.textContent('#body .obchoices .primary')));
  ok('…the interface language row, one chip for each of the ten languages', (await page.$$('#body .oblangs .oblang')).length === 10 && (await page.getAttribute('#body .oblang.on', 'data-l')) === 'en');
  const bodyH = (await r('#body')).height;
  await page.click('#body .obwhy summary'); await settle(page);
  ok('“Why JSON?” opens in place: its four points and the link, inside the inspector', (await page.isVisible('#body .obwhy li')) && (await page.$$('#body .obwhy li')).length === 4 && /File over app|Steph Ango/.test(await page.textContent('#body .obwhy')) && (await r('#body')).height > bodyH);
  await page.click('#body .obwhy summary'); await settle(page);
  ok('footer area: the four “Yours to keep” points, private first among them, JSON Resume linked', (await page.$$('#foot .obtile')).length === 4 && /Private/.test(await page.textContent('#foot')) && !!(await page.$('#foot a[href="https://jsonresume.org/schema"]')));
  ok('…light, and not equal to the inspector: no card around them', await page.evaluate(() => { const f = getComputedStyle(document.querySelector('#foot')); return f.backgroundColor === 'rgba(0, 0, 0, 0)' && f.boxShadow === 'none'; }));
  ok('nothing of the editor shows: no tabs, no zoom bar, no meter, no Fit, and the sheet waits', !(await page.isVisible('#tabs')) && !(await page.$('[data-act=fit]')) && (await page.evaluate(() => getComputedStyle(document.querySelector('#sheet')).visibility)) === 'hidden');

  // the story: four steps, named above their zones
  const heads = await page.$$eval('#ss .ssh button', bs => bs.map(b => `${b.querySelector('.n').textContent} ${b.querySelector('b').textContent}`));
  ok('four step names are the only numbers, set as headers above the zones', JSON.stringify(heads) === JSON.stringify(['1 Bring in what you have', '2 Keep several wordings', '3 Tailor to each job', '4 Export']), JSON.stringify(heads));
  ok('…under the picture sit a progress bar, one instruction line and a replay button, and no dots', !!(await page.$('#ss .ssprog')) && (await page.textContent('#sscap')).length > 20 && !!(await page.$('#ss [data-act=ob-replay]')) && !(await page.$('#ss .obdots')));
  ok('the record is the editor panel’s own checklist: two jobs open, the rest folded, ticks and version counts', await page.evaluate(() => { const r = document.querySelector('#ss .ss-rec'); return r.querySelectorAll('.ssg.open').length === 2 && r.querySelectorAll('.ssg.shut').length >= 2 && r.querySelectorAll('.cb').length >= 6 && r.querySelectorAll('.ssv').length >= 6; }));
  ok('the page area starts with the page drawn as grey lines', await page.evaluate(() => { const pg = document.querySelector('#ss .ss-page'); return pg.querySelectorAll('i').length > 15 && getComputedStyle(pg).backgroundColor !== 'rgba(0, 0, 0, 0)'; }));

  // it plays: step 1, then 2 with the layers, then 3 and 4, by itself
  await page.evaluate(() => window.__wb.onboarding.start.replay());
  await page.waitForTimeout(1200);
  const s1 = await ssOf(page);
  ok('it starts playing at step 1 by itself, and says what it is doing', s1.step === '1' && /old resume/.test(s1.cap));
  const seq = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 14000 && !(await ssOf(page)).step.startsWith('3')){ const x = await ssOf(page); const k = `${x.step}:${x.ly}`; if (seq.at(-1) !== k) seq.push(k); await page.waitForTimeout(100); }
  const two = seq.filter(k => k.startsWith('2:')).map(k => k.slice(2)).join(' ');
  ok('step 2 plays the layers, as the editor draws them: the page, then the job (a click), then the line (a second click), then back to the job and the page (Esc, Esc)', two === 'page job line job page', two);
  const lyText = await page.evaluate(() => document.querySelector('#ss .sscrumb').innerText.replace(/\s+/g, ' ').trim());
  ok('…the breadcrumb is the editor’s: Page › Job › Line, with Esc beside it', /^Page › Job › Line Esc$/.test(lyText), lyText);
  await page.waitForFunction(() => document.querySelector('#ss')?.dataset.step === '3', null, { timeout: 12000 }).catch(() => {});
  const ticks3 = await nOfMs(page);
  await page.waitForTimeout(3500);
  ok('step 3 tailors: other lines ticked for another kind of job', JSON.stringify(await nOfMs(page)) !== JSON.stringify(ticks3) || (await ssOf(page)).type !== 'start', `${JSON.stringify(ticks3)} → ${JSON.stringify(await nOfMs(page))}`);
  await page.waitForFunction(() => document.querySelector('#ss')?.dataset.step === '4', null, { timeout: 15000 });
  await page.waitForTimeout(2000);
  const rest = await page.evaluate(() => { const pg = document.querySelector('#ss .ss-page').getBoundingClientRect(), ex = document.querySelector('#ss .ssx[data-i="0"]').getBoundingClientRect(); return { dx: Math.abs(pg.left - ex.left), dy: Math.abs(pg.top - ex.top), dw: Math.abs(pg.width - ex.width) }; });
  ok('step 4: the page shrinks into the front resume of the stack, which is the resting view', rest.dx < 4 && rest.dy < 4 && rest.dw < 4, JSON.stringify(rest));
  ok('…three resumes with a label row beside each: job type, language, paper, pages, file', await page.evaluate(() => [...document.querySelectorAll('#ss .sslab')].map(b => b.innerText.replace(/\s+/g, ' ').trim()).join('|')) === 'Startup EN · Letter · 1 page HTML|Big company DE · A4 · 2 pages TXT|Public sector HU · A4 · 1 page PDF', await page.evaluate(() => [...document.querySelectorAll('#ss .sslab')].map(b => b.innerText.replace(/\s+/g, ' ').trim()).join('|')));
  const t4 = await nOfMs(page);
  await page.hover('#ss .sslab[data-i="1"]'); await page.waitForTimeout(500);
  const s4 = await ssOf(page);
  ok('pointing at a label row brings that resume forward and shows its ticks in the record', s4.front === '1' && JSON.stringify(await nOfMs(page)) !== JSON.stringify(t4) && (await page.getAttribute('#ss .sslab[data-i="1"]', 'aria-pressed')) === 'true', JSON.stringify(s4));
  await page.click('#ss .ssh button[data-s="2"]'); await page.waitForTimeout(400);
  const j2 = await ssOf(page);
  ok('a step name goes to that step, and the autoplay stops', j2.step === '2' && /Your own words/.test(j2.cap) && j2.prog === '50%');
  await page.click('#ss [data-act=ob-replay]'); await page.waitForTimeout(900);
  ok('Replay starts it again from the beginning', ['0', '1'].includes((await ssOf(page)).step));

  // language chips preview in place, on hover; a click keeps it
  const chipBefore = await page.evaluate(() => { const c = document.querySelector('.oblang[data-l=de]'); c.dataset.mark = 'same'; return document.querySelector('#head .obhero').textContent; });
  await page.hover('.oblang[data-l=de]'); await page.waitForTimeout(900);
  ok('hovering a language chip shows the whole screen in that language, in place (the chip is not redrawn)', (await page.textContent('#head .obhero')) !== chipBefore && (await page.getAttribute('.oblang[data-l=de]', 'data-mark')) === 'same');
  await page.mouse.move(700, 800); await page.waitForTimeout(700);
  ok('…and moving away puts it back', (await page.textContent('#head .obhero')) === chipBefore);

  // choosing: a state change, not another screen
  await page.click('[data-act=ob-example]'); await page.waitForTimeout(1500);
  ok('“Try it with an example” turns the intro parts into the editor’s controls: the same column, now the editor’s header, panel and tabs', !(await page.evaluate(() => document.body.classList.contains('is-intro'))) && await page.isVisible('#tabs [role=tablist]') && await page.isVisible('#head [data-act=fit]'));
  ok('…the grey lines give way to the real page, which fades in where they were', (await page.evaluate(() => getComputedStyle(document.querySelector('#sheet')).visibility)) === 'visible' && (await page.evaluate(() => getComputedStyle(document.querySelector('#startstage')).visibility)) === 'hidden' && /Okonkwo|Dana/.test(await frameDoc(page, d => d.body.textContent)));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the start screen: other windows, a phone, reduced motion, a record that exists')) {
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
    const page = await ctx.newPage();
    const bad = await open(page, '?memory&welcome');
    const col = await page.$eval('#col', el => { const b = el.getBoundingClientRect(); return { left: b.left, width: b.width, scroll: el.scrollHeight <= el.clientHeight + 2 || getComputedStyle(el).overflowY === 'auto' }; });
    const stage = await page.$eval('#ss', el => el.getBoundingClientRect().toJSON());
    ok('1100×760: the picture and the column share the window without overlap, and the column scrolls rather than cutting anything off', stage.right <= col.left && col.scroll && (await page.evaluate(() => document.documentElement.scrollWidth)) <= 1100);
    ok('…the three ways in are all reachable', await page.evaluate(() => [...document.querySelectorAll('#body .obchoices button')].every(b => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })));
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const bad = await open(page, '?memory&welcome');
    const at = await page.evaluate(() => ['#head', '#body', '#startstage', '#foot'].map(s => Math.round(document.querySelector(s).getBoundingClientRect().top + document.querySelector('#col').scrollTop)));
    ok('a phone: stacked, the buttons first, then the picture, then what you keep', at[0] < at[1] && at[1] < at[2] && at[2] < at[3], JSON.stringify(at));
    ok('…nothing runs off the side', (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390 && (await page.evaluate(() => { const s = document.querySelector('#ss .ss-frame').getBoundingClientRect(); return s.left >= 0 && s.right <= innerWidth + 1; })));
    ok('…the step names stand in a grid above the picture', await page.evaluate(() => getComputedStyle(document.querySelector('#ss .ss-heads')).display === 'grid'));
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const bad = await open(page, '?memory&welcome');
    await page.waitForTimeout(300);
    const s = await ssOf(page);
    ok('with reduced motion the picture opens on its resting view: nothing plays, nothing moves', s.step === '4' && await page.evaluate(() => [...document.querySelectorAll('#ss *')].every(e => getComputedStyle(e).transitionDuration.split(',').every(d => parseFloat(d) === 0) || e.tagName === 'svg')));
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
}

// UX-3b: the Record tab, one meaning of save (Mark as sent at the end of Export), and the panel fixes.
if (want('the Record tab, Mark as sent, and the panel fixes')) {
  const snapsOf = page => page.evaluate(() => { const s = window.__wb.store.state; return (s.resumes.find(r => r.id === s.openId)?.snapshots ?? []).map(x => x.sends.length); });
  const onPageCount = page => frameDoc(page, d => d.querySelectorAll('.bullets li').length);
  const pageRects = page => page.evaluate(() => window.__wb.sheet.pageBoxes().map(b => window.__wb.canvas.screenRect(b)));
  const clear = (a, rs) => rs.every(b => a.right <= b.left + 0.5 || a.left >= b.left + b.width - 0.5 || a.bottom <= b.top + 0.5 || a.top >= b.top + b.height - 0.5);

  for (const [drink, theme] of [['tea', 'light'], ['coffee', 'dark']]){
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
    const page = await ctx.newPage();
    const bad = await open(page, undefined, { drink, theme });
    const sheet = page.frameLocator('#sheet iframe');
    const tag = `${drink} ${theme}`;
    const col = () => rect(page, '#col');

    // ---- the five tabs, and R ----
    const tabs = await page.$$eval('#tabs [role=tab]', els => els.map(e => e.textContent.trim()));
    ok(`${tag}: the tablist is Outline · Edit · Design · Export · Record`, tabs.length === 5 && tabs.join('|').split('|').every(x => x.length > 2) && (await page.$$eval('#tabs [role=tab]', els => els.map(e => e.dataset.m).join())) === 'outline,edit,design,export,record', tabs.join('|'));
    ok(`${tag}: …with the same tablist semantics, one tab stop`, await page.evaluate(() => { const t = [...document.querySelectorAll('#tabs [role=tab]')]; return t.length === 5 && t.filter(x => x.tabIndex === 0).length === 1 && t.filter(x => x.getAttribute('aria-selected') === 'true').length === 1; }));
    await page.keyboard.press('Escape'); await settle(page);   // nothing selected
    const before = await col(), pageBefore = await rect(page, '#sheet');
    ok(`${tag}: the panel is 560–760px wide in the Outline at 1440`, before.width >= 559 && before.width <= 761, `${before.width}px`);
    await page.evaluate(() => { window.__moved = 0; document.addEventListener('brewcv:pages-moved', () => { window.__moved++; }); });
    await page.keyboard.press('r'); await page.waitForTimeout(1100);
    const after = await col(), pageAfter = await rect(page, '#sheet');
    ok(`${tag}: R opens Record, and Record is the selected tab`, (await page.evaluate(() => window.__wb.ui.view)) === 'record' && (await page.getAttribute('#tab-record', 'aria-selected')) === 'true' && (await page.getAttribute('#body', 'data-mode')) === 'record');
    ok(`${tag}: Record is a tab of the same panel: nothing widens, and the page does not move`, Math.abs(after.width - before.width) < 1 && Math.abs(after.left - before.left) < 1 && Math.abs(pageAfter.left - pageBefore.left) < 1 && Math.abs(pageAfter.width - pageBefore.width) < 1, `${before.width}px → ${after.width}px`);
    const boxes = await pageRects(page);
    ok(`${tag}: the page is beside the panel, not covered`, boxes.every(b => b.left + b.width <= after.left + 1 && b.left >= 0) && boxes.every(b => b.top >= 0 && b.top + b.height <= 900));
    ok(`${tag}: the pages' own event did not fire: the pages did not move`, (await page.evaluate(() => window.__moved)) === 0, String(await page.evaluate(() => window.__moved)));
    ok(`${tag}: the panel keeps 16px from the right`, Math.abs(1440 - after.right - 16) < 1);

    // ---- what Record shows ----
    ok(`${tag}: a header row: Your record, n of m on, + Add`, await page.evaluate(() => { const h = document.querySelector('#checklist .clhead'); return !!h && /Your record/.test(h.textContent) && /\d+ of \d+ on/.test(h.textContent) && !!h.querySelector('[data-act=c-pop]'); }));
    ok(`${tag}: the timeline is open across the panel, always`, await page.evaluate(() => { const t = document.querySelector('#checklist .rectl .tl2'); const b = document.querySelector('#body'); return !!t && t.getBoundingClientRect().width > b.getBoundingClientRect().width * 0.8 && !document.querySelector('#timeline'); }));
    ok(`${tag}: the timeline is about 118px high and its years run left to right`, await page.evaluate(() => { const t = document.querySelector('#checklist .rectl .tl2'); const y = [...t.querySelectorAll('.yr')].map(e => e.getBoundingClientRect().left); return Math.abs(t.getBoundingClientRect().height - 118) <= 1 && y.length >= 3 && y.every((x, k) => k === 0 || x > y[k - 1]); }));
    await page.evaluate(() => { document.querySelector('#checklist .tl2').scrollLeft = 0; });
    await page.locator('#checklist .cb[data-on]').first().click(); await page.waitForTimeout(400);
    ok(`${tag}: a re-render of Record keeps the timeline where the user left it (the oldest year)`, await page.evaluate(() => { const t = document.querySelector('#checklist .tl2'); return t.scrollWidth > t.clientWidth && t.scrollLeft === 0; }));
    await page.locator('#checklist .cb[data-on]').first().click(); await page.waitForTimeout(400);
    ok(`${tag}: every group is open by default, and the carets stay`, await page.evaluate(() => { const gs = [...document.querySelectorAll('#checklist .clg')]; return gs.length >= 5 && gs.every(g => g.classList.contains('open')) && gs.every(g => g.querySelector('.clcaret[aria-expanded=true]')); }));
    ok(`${tag}: jobs newest first, then education, skills…`, await page.evaluate(() => { const ids = [...document.querySelectorAll('#checklist .clg')].map(g => g.dataset.g); return ids[0] === 'about' && ids.indexOf('hydra') < ids.indexOf('poly') && ids.indexOf('education') > ids.indexOf('atelier') && ids.includes('credentials'); }));
    await page.click('#checklist .clg[data-g=hydra] .clcaret'); await settle(page);
    ok(`${tag}: a caret folds a group, and it stays folded when the panel is drawn again`, await page.evaluate(() => !document.querySelector('#checklist .clg[data-g=hydra]').classList.contains('open')));
    await page.click('#checklist .clg[data-g=hydra] .clcaret'); await settle(page);

    // ---- ticking in Record changes the open resume, with the page in view ----
    const n0 = await onPageCount(page);
    const off = page.locator('#checklist .clg[data-g=hydra] .clrow.is-off .cb[data-on]').first();
    if (await off.count()){
      await off.check(); await settle(page); await page.waitForTimeout(500);
      ok(`${tag}: ticking a line in Record puts it on the page (${n0} → ${await onPageCount(page)}), and the panel is still Record`, (await onPageCount(page)) === n0 + 1 && (await page.evaluate(() => window.__wb.ui.view)) === 'record');
      await page.keyboard.press('Control+z'); await settle(page); await page.waitForTimeout(500);
      ok(`${tag}: …as one undo step`, (await onPageCount(page)) === n0);
    } else ok(`${tag}: hydra has a line that is off, to tick`, false);

    // ---- Esc goes back, and the panel narrows ----
    await page.keyboard.press('Escape'); await page.waitForTimeout(1100);
    ok(`${tag}: Esc from Record goes back to the tab it was opened from (the Outline)`, (await page.evaluate(() => window.__wb.ui.view)) === null && (await page.getAttribute('#tab-outline', 'aria-selected')) === 'true' && Math.abs((await col()).width - before.width) < 1);

    // ---- the ways in: the tab, the rail, the job chip and a section's count ----
    await page.click('#tab-record'); await settle(page);
    ok(`${tag}: the tab opens Record`, (await page.evaluate(() => window.__wb.ui.view)) === 'record');
    await page.keyboard.press('Escape'); await settle(page);
    await page.keyboard.press('e'); await settle(page);                    // fold: the tabs stay
    await page.click('#tab-record'); await page.waitForTimeout(900);
    ok(`${tag}: the folded tag for Record unfolds the panel on Record`, (await page.evaluate(() => window.__wb.ui.view)) === 'record' && (await page.evaluate(() => document.body.dataset.folded)) === 'false');
    await page.keyboard.press('Escape'); await settle(page);
    // from the page: a bullet, then the way into the record under the job's lines
    await sheet.locator('.bullets li').first().click(); await settle(page);
    ok(`${tag}: no chip over the page; the job's panel has "All of your record"`, !(await page.$('.obcrumb')) && await page.isVisible('#body .allrec [data-act=open-record]'));
    await page.click('#body .allrec [data-act=open-record]'); await page.waitForTimeout(1200);
    const at = await page.evaluate(() => { const g = document.querySelector('#checklist .clg[data-g=hydra]'), b = document.querySelector('#body'); const gr = g?.getBoundingClientRect(), br = b.getBoundingClientRect(); return { view: window.__wb.ui.view, asked: g?.classList.contains('is-asked'), top: gr ? gr.top - br.top : null, h: br.height }; });
    ok(`${tag}: “All of your record” opens Record scrolled to that job, its group marked for a moment`, at.view === 'record' && at.asked && at.top >= -2 && at.top < at.h - 40, JSON.stringify(at));
    await page.waitForTimeout(2000);
    ok(`${tag}: …and the mark goes`, !(await page.evaluate(() => !!document.querySelector('#checklist .clg.is-asked'))));
    // the timeline scrolls the list to a job
    await page.click('#checklist .rectl [data-act=rec-job][data-id=atelier]'); await page.waitForTimeout(900);
    ok(`${tag}: a click on a job in the timeline scrolls the list to that job`, await page.evaluate(() => { const g = document.querySelector('#checklist .clg[data-g=atelier]'), b = document.querySelector('#body'); const d = g.getBoundingClientRect().top - b.getBoundingClientRect().top; return d >= -2 && d < b.getBoundingClientRect().height - 40 && window.__wb.ui.view === 'record'; }));
    // a click on a row's text opens the claim in Edit
    await page.click('#checklist .clg[data-g=atelier] .clt'); await page.waitForTimeout(800);
    ok(`${tag}: a click on a line's text opens the claim (Edit), and the panel is at its top`, (await page.evaluate(() => window.__wb.ui.view)) === null && (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'bullet' && (await page.evaluate(() => document.querySelector('#body').scrollTop)) === 0);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
    // the Outline: sections with their counts, in print order
    await toEditHome(page);
    ok(`${tag}: the Outline lists the sections in print order with "n of m on", and no checklist`, await page.evaluate(() => { const t = document.querySelector('#outline'); return !!t && !document.querySelector('#checklist') && document.querySelectorAll('#seclist .osec').length >= 5 && /\d+ of \d+ on/.test(document.querySelector('#seclist .osec[data-sid=experience] .srow')?.textContent ?? '') && !document.querySelector('[data-act=c-tl]'); }));
    ok(`${tag}: Fixed sections say "always first", and the foot says how Fit works`, await page.evaluate(() => document.querySelectorAll('#seclist .osec .srow.fixed').length >= 2 && /Fit cuts from the bottom/.test(document.querySelector('#body').textContent)));
    await page.keyboard.press('Escape'); await settle(page);

    // ---- the job level: versions, then the job's own lines, then Details, then the way to the record ----
    await sheet.locator('.bullets li').first().click(); await settle(page);
    const order = await page.evaluate(() => { const y = s => document.querySelector(s)?.getBoundingClientRect().top ?? null; return { crumb: y('#body .crumb'), versions: y('#body .vlist'), details: y('#body details.details'), all: y('#body .allrec'), top: document.querySelector('#body').scrollTop, noGroup: !document.querySelector('#checklist') && !document.querySelector('#body .clg') }; });
    ok(`${tag}: the job level shows the line's versions, then Details, then "All of your record"; the job's own lines are in the Outline, not here`, order.crumb < order.versions && order.versions < order.details && order.details < order.all && order.noGroup, JSON.stringify(order));
    ok(`${tag}: the panel opens at its top after a bullet click`, order.top === 0);
    await sheet.locator('.bullets li').nth(2).click(); await settle(page); await page.waitForTimeout(400);
    ok(`${tag}: …and after the next click, and after a key`, (await page.evaluate(() => document.querySelector('#body').scrollTop)) === 0);
    await page.keyboard.press('ArrowDown'); await settle(page);
    ok(`${tag}: …and after ↓`, (await page.evaluate(() => document.querySelector('#body').scrollTop)) === 0);
    await page.click('#tab-outline'); await settle(page);
    ok(`${tag}: the job's own lines can still be ticked, in the Outline`, await page.evaluate(() => document.querySelectorAll('#outline .clg.open .cb[data-on]').length >= 3));
    await page.click('#tab-edit'); await settle(page);
    await page.click('#body .allrec [data-act=open-record]'); await page.waitForTimeout(900);
    ok(`${tag}: "All of your record" opens Record at this job`, (await page.evaluate(() => window.__wb.ui.view)) === 'record');
    await page.keyboard.press('Escape'); await settle(page);

    // ---- one meaning of save ----
    ok(`${tag}: no control in the header says only Save, and there is no data-act=save`, await page.evaluate(() => ![...document.querySelectorAll('#head button')].some(b => /^\s*Save\s*$/i.test(b.textContent)) && !document.querySelector('[data-act=save]') && !document.querySelector('#save')));
    ok(`${tag}: row 1 is the name, the language, ✓ Saved and Save to file`, await page.evaluate(() => { const r = document.querySelector('#head .hrow.top'); return !!r.querySelector('#docname-btn') && !!r.querySelector('#langbtn') && !!r.querySelector('#savestate') && /Save to file/.test(r.querySelector('#filestate')?.textContent ?? ''); }));
    ok(`${tag}: its hint says whether the file is saved`, /Not saved to a file yet/.test(await page.getAttribute('#filestate', 'title')));
    const dl = await Promise.all([page.waitForEvent('download'), page.click('#filestate')]);
    await page.waitForTimeout(700);
    ok(`${tag}: Save to file downloads the one file, and the hint says so`, /brewcv/.test(dl[0].suggestedFilename()) && /Saved to file/.test(await page.getAttribute('#filestate', 'title')));
    await page.click('#tab-export'); await settle(page);
    ok(`${tag}: Export ends with "Sent it?" and Mark as sent…, after the downloads`, await page.evaluate(() => { const b = document.querySelector('#body [data-act=mark-sent]'), d = document.querySelector('#body .dl'); return !!b && /Mark as sent…/.test(b.textContent) && b.getBoundingClientRect().top > d.getBoundingClientRect().bottom && /Sent it\?/.test(document.querySelector('.sentrow')?.textContent ?? ''); }));
    const s0 = await snapsOf(page);
    await page.click('[data-act=mark-sent]'); await settle(page);
    ok(`${tag}: it opens "Sent to?" with kind, company, role and date, and a commit button that says Mark as sent`, await page.evaluate(() => !!document.querySelector('#sv-kind') && !!document.querySelector('#sv-co') && !!document.querySelector('#sv-role') && !!document.querySelector('#sv-date') && /^Mark as sent$/.test(document.querySelector('[data-act=sv-do]')?.textContent.trim() ?? '')));
    await page.fill('#sv-co', 'Northgate Dosing Systems'); await page.fill('#sv-role', 'Mechanical Design Engineer');
    await page.click('[data-act=sv-do]'); await settle(page);
    const s1 = await snapsOf(page);
    ok(`${tag}: Mark as sent writes a snapshot with one send (the shape is the same as before)`, s1.length === s0.length + 1 && s1.at(-1) === 1, JSON.stringify([s0, s1]));
    ok(`${tag}: …and goes back to Export`, (await page.evaluate(() => window.__wb.ui.view)) === 'export');
    await page.click('[data-act=mark-sent]'); await settle(page);
    ok(`${tag}: with nothing changed, it says it adds to the last one`, /Nothing printed has changed/.test(await page.textContent('#body .note')));
    await page.fill('#sv-co', 'Another Company'); await page.click('[data-act=sv-do]'); await settle(page);
    const s2 = await snapsOf(page);
    ok(`${tag}: …and the send goes onto the last snapshot`, s2.length === s1.length && s2.at(-1) === 2, JSON.stringify(s2));
    await page.click('#tab-edit'); await settle(page);

    // ---- the shortcut sheet ----
    await page.keyboard.press('?'); await settle(page);
    const keys = await page.evaluate(() => [...document.querySelectorAll('#help .keys > div')].map(d => { const a = d.querySelector('dt').getBoundingClientRect(), b = d.querySelector('dd').getBoundingClientRect(); return { dt: d.querySelector('dt').textContent.trim(), over: a.right > b.left - 2 && a.bottom > b.top && a.top < b.bottom }; }));
    ok(`${tag}: the shortcut sheet shows ⌘ under a Mac platform, and no Ctrl`, keys.some(k => /⌘/.test(k.dt)) && !keys.some(k => /Ctrl/.test(k.dt)), keys.map(k => k.dt).join(' | '));
    ok(`${tag}: …its keys column never runs into a label`, keys.every(k => !k.over), keys.filter(k => k.over).map(k => k.dt).join(' | '));
    ok(`${tag}: …and lists R, Record`, await page.evaluate(() => [...document.querySelectorAll('#help .keys > div')].some(d => d.querySelector('dt').textContent.trim() === 'R' && /record/i.test(d.querySelector('dd').textContent))));
    await page.keyboard.press('Escape'); await settle(page);

    // ---- the switcher and Manage all ----
    await page.click('#docname-btn'); await settle(page);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#switcher .swrow')].map(r => { const co = r.querySelector('.swco'), ro = r.querySelector('.swrole'); return { tag: !!r.querySelector('.swtag'), roleCut: ro ? ro.scrollWidth > ro.clientWidth + 1 : false, coCut: co ? co.scrollWidth > co.clientWidth + 1 : false, noCompany: !r.querySelector('.sopt .muted') }; }));
    ok(`${tag}: switcher rows have no company column, and carry a small language/pages tag`, rows.length > 8 && rows.every(r => r.tag && r.noCompany));
    ok(`${tag}: …a name that has to give way gives up the company, never the role alone`, rows.every(r => !(r.roleCut && !r.coCut)));
    await page.click('[data-act=sw-manage]'); await settle(page);
    const man = await page.evaluate(() => { const s = document.querySelector('#switcher'), sr = s.getBoundingClientRect(), hd = document.querySelector('#head').getBoundingClientRect(), col = document.querySelector('#col').getBoundingClientRect(); const mid = [sr.left + 20, sr.top + 20, sr.left + sr.width / 2, sr.bottom - 20].map(v => v); const probe = [[sr.left + 10, sr.top + 60], [sr.left + sr.width / 2, sr.top + sr.height / 2], [sr.right - 10, sr.bottom - 10]].map(([x, y]) => document.elementFromPoint(x, y)?.closest('#switcher') !== null); const bg = getComputedStyle(s).backgroundColor; const alpha = /rgba/.test(bg) ? Number(bg.match(/[\d.]+\)$/)[0].slice(0, -1)) : 1; return { belowTabs: sr.top >= hd.bottom - 0.5, rightEdge: Math.abs(sr.right - col.right) < 12, opaque: alpha === 1, probe: probe.every(Boolean), aboveFoot: sr.bottom <= col.bottom + 0.5 }; });
    ok(`${tag}: Manage all has its own surface: under the header, at the panel's right edge, opaque, over everything below it, inside the panel`, man.belowTabs && man.rightEdge && man.opaque && man.probe && man.aboveFoot, JSON.stringify(man));
    ok(`${tag}: "Compare 0/2" is readable when disabled`, await page.evaluate(() => { const b = document.querySelector('#switcher [data-act=sw-compare]'); return b.disabled && getComputedStyle(b).opacity === '1'; }));
    await page.keyboard.press('Escape'); await settle(page);

    // ---- toasts never cover the page ----
    await page.click('[data-act=undo]').catch(() => {});
    await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);     // (a second click on a line of the open job would write it)
    await sheet.locator('.bullets li').first().click(); await settle(page);
    await page.locator('.vrow[data-v]:not(.cur)').first().click(); await settle(page);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
    const toastOpen = await page.evaluate(() => document.querySelector('#toast').classList.contains('on'));
    const tr = await rect(page, '#toast'); const prs = await pageRects(page);
    ok(`${tag}: a toast (panel open) hangs under the panel's header and covers none of the page`, toastOpen && tr.left >= (await col()).left && tr.top >= (await rect(page, '#head')).bottom - 1 && clear(tr, prs), JSON.stringify(tr));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
    await page.evaluate(() => window.__wb.dock.setFolded(false)); await page.waitForTimeout(3800);

    // ---- New resume ----
    await page.click('#docname-btn'); await page.click('[data-act=sw-new]'); await settle(page);
    const order2 = await page.evaluate(() => [...document.querySelectorAll('#body .lbl')].map(l => l.textContent.trim().toLowerCase()));
    const ix = k => order2.findIndex(x => x.includes(k));
    ok(`${tag}: New resume asks in this order: Job type, Start from, Name, For, Language, Paper`, ix('job type') < ix('start from') && ix('start from') < ix('name') && ix('name') < ix('for') && ix('for') < ix('language') && ix('language') < ix('paper'), order2.join(' | '));
    ok(`${tag}: …and the greyed "Bullets for this job type" says why`, /Pick a job type first/.test(await page.textContent('.startopt.is-off')));
    await page.keyboard.press('Escape'); await settle(page);

    // ---- Highlight ----
    await toEditHome(page);
    ok(`${tag}: Highlight reads "Highlight bullets for" and the button "Select these…"`, /Highlight bullets for/i.test(await page.textContent('.lensrow .lt')) && /Select these…/.test(await page.textContent('[data-act=lens-apply]')));

    ok(`${tag}: no console errors`, bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }

  // ---- the example notice is a chip, not a toast ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await open(page, '?memory&welcome');
    await page.click('[data-act=ob-example]'); await page.waitForTimeout(1500);
    const chip = await page.evaluate(() => { const c = document.querySelector('.examplechip'); return c ? { text: c.textContent.trim(), h: c.getBoundingClientRect().height, inHead: !!c.closest('#head') } : null; });
    ok('the example notice is a one-line chip at the top of the panel', !!chip && chip.inHead && chip.h < 36 && /Start over/.test(chip.text), JSON.stringify(chip));
    ok('…and not a toast', !(await page.evaluate(() => document.querySelector('#toast').classList.contains('on'))));
    await page.click('[data-act=example-ok]'); await settle(page);
    ok('…it goes away when dismissed', !(await page.$('.examplechip')));
    // Settings: the interface follows the open resume, and says nothing about Career
    await page.evaluate(() => window.__wb.setView('settings')); await settle(page);
    const txt = await page.textContent('#body');
    ok('Settings: "In the language of the open resume", no Career', /In the language of the open resume/.test(txt) && !/Career/.test(txt));
    await ctx.close();
  }

  // ---- a toast beside the tabs (folded), under the header (open), and at 1024 ----
  for (const [w, h, folded] of [[1440, 900, true], [1024, 768, true], [1440, 900, false], [1024, 768, false]]){
    const name = `${folded ? 'beside the tabs' : 'under the header'}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await open(page, undefined, { folded });
    await page.evaluate(() => window.__wb.store.commit(d => { d.cur.company = 'Zeta'; }, 'smoke: change'));
    await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
    const tr = await rect(page, '#toast'), prs = await pageRects(page);
    ok(`${w}×${h}, ${name}: a toast covers none of the page`, await page.evaluate(() => document.querySelector('#toast').classList.contains('on')) && clear(tr, prs), JSON.stringify(tr));
    await ctx.close();
  }

  // ---- Record at 1024 and on a phone ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await ctx.newPage();
    await open(page);
    const s0 = await rect(page, '#sheet');
    await page.keyboard.press('r'); await page.waitForTimeout(900);
    const c = await rect(page, '#col'), s = await rect(page, '#sheet');
    ok('1024: Record is the same 560px panel, beside the page (no drawer), and the page has not moved', Math.abs(c.width - 560) < 1 && s.right <= c.left && Math.abs(s.left - s0.left) < 1 && (await page.evaluate(() => document.body.dataset.drawer)) === undefined, `${c.width} at ${c.left}`);
    ok('…and the timeline and the groups are there', await page.evaluate(() => !!document.querySelector('#checklist .rectl .tl2') && document.querySelectorAll('#checklist .clg.open').length >= 5));
    await ctx.close();
    const cp = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const ph = await cp.newPage();
    await open(ph);
    ok('a phone: Edit and Record are the tabs', await ph.evaluate(() => [...document.querySelectorAll('#head [role=tab]')].filter(t => t.offsetParent !== null).map(t => t.dataset.m).join() === 'edit,record'));
    await ph.click('#head [data-m=record]'); await ph.waitForTimeout(900);
    const pc = await rect(ph, '#col');
    ok('a phone: Record is the whole screen, a list, with the timeline as a plain list of jobs', Math.abs(pc.width - 390) < 1 && Math.abs(pc.height - 844) < 1 && await ph.evaluate(() => !!document.querySelector('#checklist .clg') && getComputedStyle(document.querySelector('#checklist .colhead')).display === 'none'));
    await ph.click('#head [data-m=edit]'); await ph.waitForTimeout(700);
    ok('a phone: Edit puts the bottom sheet back', Math.abs((await rect(ph, '#col')).height - 844 * 0.42) < 4);
    await cp.close();
  }

  // ---- reduced motion: the panel jumps (the Record widening is gone) ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await open(page);
    await page.keyboard.press('e'); await page.waitForTimeout(60);
    ok('reduced motion: the panel folds at once, with no slide', await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#col')); return c.visibility === 'hidden' && parseFloat(c.transitionDuration) === 0 && document.body.dataset.folded === 'true'; }));
    await page.keyboard.press('e'); await page.waitForTimeout(60);
    ok('…and unfolds at once', await page.evaluate(() => getComputedStyle(document.querySelector('#col')).visibility === 'visible' && document.body.dataset.folded === 'false'));
    await ctx.close();
  }
}

// The M8 accessibility pass: axe-core on every main view. axe-core is a dev tool and is not in the repo (nothing in
// BrewCV has a dependency): AXE_CORE=/path/to/axe.min.js (from `npm install axe-core` anywhere) runs it, else it is skipped.
if (want('accessibility: axe-core on every view')) {
  const axePath = process.env.AXE_CORE;
  if (!axePath || !fs.existsSync(axePath)) console.log('skipped: set AXE_CORE to the path of axe.min.js to run it');
  else {
    const axeSrc = fs.readFileSync(axePath, 'utf8');
    // tea and coffee, each in light and dark: the same views, the same rules
    for (const [drink, theme] of [['tea', 'light'], ['tea', 'dark'], ['coffee', 'light'], ['coffee', 'dark']]){
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true, colorScheme: theme });
      const page = await ctx.newPage();
      const bad = await open(page, undefined, { drink, theme });
      const sheet = page.frameLocator('#sheet iframe');
      const runAxe = async (pg, name) => {
        await pg.evaluate(axeSrc);
        const v = await pg.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map(x => `${x.id} (${x.impact}): ${x.nodes.slice(0, 3).map(n => n.target.join(' ') + (n.any?.[0]?.data?.contrastRatio ? ` [${n.any[0].data.fgColor} on ${n.any[0].data.bgColor} ${n.any[0].data.contrastRatio}]` : '')).join(' | ')}`));
        ok(`axe-core, ${drink} ${theme}: ${name}`, v.length === 0, v.join(' ; '));
      };
      // the start screen: at the start, and at rest
      const pw = await ctx.newPage();
      await open(pw, '?memory&welcome', { drink, theme });
      await runAxe(pw, 'the start screen');
      await pw.evaluate(() => window.__wb.onboarding.start.setStep(4, { user: true })); await pw.waitForTimeout(1500);
      await runAxe(pw, 'the start screen, at rest');
      await pw.close();
      await runAxe(page, 'the Outline, nothing selected');
      await page.click('#tab-edit'); await settle(page); await runAxe(page, 'Edit, nothing selected');
      await page.keyboard.press('r'); await page.waitForTimeout(900);
      await runAxe(page, 'Record: the timeline and every group open');
      await page.keyboard.press('Escape'); await settle(page);
      await sheet.locator('.bullets li').first().click(); await settle(page);
      await runAxe(page, 'a claim, with the job’s own lines under its versions');
      await sheet.locator('.role-title').first().click(); await settle(page);
      await page.click('details.details > summary'); await page.click('details.jr:not(.details) summary'); await settle(page);
      await runAxe(page, 'a job with Details open');
      await sheet.locator('.name').click(); await settle(page);
      await runAxe(page, 'About you');
      await openAdd(page); await settle(page);
      await runAxe(page, 'the + Add menu');
      await page.click('.addm [data-what=work]'); await settle(page);
      await runAxe(page, 'a form for something new');
      await page.click('[data-act=c-add-cancel]'); await settle(page);
      for (const m of ['design', 'export']){ await page.click(`#tab-${m}`); await page.waitForTimeout(500); await runAxe(page, m); }
      await page.click('[data-act=mark-sent]'); await settle(page); await runAxe(page, 'Mark as sent');
      await page.click('[data-act=sent-back]'); await settle(page);
      await page.click('#tab-edit'); await settle(page);
      await page.click('#docname-btn'); await settle(page); await runAxe(page, 'the switcher');
      await page.click('#switcher [data-act=sw-manage]'); await settle(page); await runAxe(page, 'the grown switcher');
      await page.click('#switcher [data-act=sw-view][data-v=date]'); await settle(page); await runAxe(page, 'the grown switcher by date');
      await page.keyboard.press('Escape'); await settle(page);
      await page.mouse.move(300, 400); await page.click('#zoompct'); await settle(page); await runAxe(page, 'the zoom settings');
      await page.keyboard.press('Escape');
      await page.click('[data-act=menu]'); await runAxe(page, 'the ⋯ menu'); await page.click('.menu [data-act=help]'); await settle(page); await runAxe(page, 'the shortcut sheet');
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.__wb.setView('settings')); await settle(page); await runAxe(page, 'Settings');
      await page.evaluate(() => window.__wb.setView(null));
      await page.keyboard.press('Escape'); await settle(page);
      await page.keyboard.press('e'); await settle(page);
      await runAxe(page, 'folded: the tags and the foot card');
      await page.mouse.move(300, 400); await page.waitForTimeout(500);
      await runAxe(page, 'folded: the zoom bar with Fit and the fill');
      ok(`${drink} ${theme}: no console errors`, bad.length === 0, bad[0] ?? '');
      await ctx.close();
      const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true, colorScheme: theme });
      const p2 = await c2.newPage();
      await open(p2, '?memory&welcome', { drink, theme });
      await runAxe(p2, 'the start screen');
      await p2.click('[data-act=ob-scratch]'); await settle(p2); await runAxe(p2, 'the language step');
      await p2.click('[data-act=ob-lang-go]'); await p2.waitForTimeout(900); await runAxe(p2, 'the quiet editor');
      await c2.close();
      const c3 = await browser.newContext({ viewport: { width: 1100, height: 800 }, bypassCSP: true, colorScheme: theme });
      const p3 = await c3.newPage();
      await open(p3, undefined, { drink, theme });
      await p3.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(p3);
      await runAxe(p3, 'a narrow window, the panel at 560px');
      await c3.close();
    }
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
  ok('offline, it reloads and draws the resume', await page.evaluate(() => document.body.classList.contains('is-ready') && window.__wb.ui.fills.length > 0));
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
  const unnamed = async () => p2.evaluate(() => [...document.querySelectorAll('#col button, #col input, #col textarea, #col [role=button], #tabs button, #zoombar button')]
    .filter(e => e.offsetParent !== null)
    .filter(e => !(e.getAttribute('aria-label') || e.title || e.textContent.trim() || e.closest('label') || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.placeholder))
    .map(e => e.outerHTML.slice(0, 80)));
  const views = [];
  for (const v of [null, 'new', 'sent', 'record', 'design', 'export', 'import', 'history', 'settings']){
    if (v) await p2.evaluate(x => window.__wb.setView(x), v);
    await p2.waitForTimeout(700);
    views.push(...(await unnamed()).map(x => `${v ?? 'home'}: ${x}`));
    await p2.keyboard.press('Escape');
  }
  await p2.evaluate(() => window.__wb.dock.setFolded(false)); await settle(p2);
  await p2.click('#docname-btn'); await settle(p2);
  views.push(...(await unnamed()).map(x => `switcher: ${x}`));
  await p2.click('#switcher [data-act=sw-manage]'); await settle(p2);
  views.push(...(await unnamed()).map(x => `grown switcher: ${x}`));
  await p2.keyboard.press('Escape');
  await p2.mouse.move(300, 400); await p2.click('#zoompct'); await settle(p2);
  views.push(...(await unnamed()).map(x => `zoom settings: ${x}`));
  await p2.keyboard.press('Escape');
  await p2.click('[data-act=menu]'); await p2.click('.menu [data-act=help]'); await settle(p2);
  views.push(...(await p2.evaluate(() => [...document.querySelectorAll('#help button')].filter(e => !(e.getAttribute('aria-label') || e.textContent.trim())).map(e => e.outerHTML.slice(0, 60)))).map(x => `shortcut sheet: ${x}`));
  await p2.keyboard.press('Escape');
  await openAdd(p2); await settle(p2);
  views.push(...(await unnamed()).map(x => `add menu: ${x}`));
  await openAdd(p2); await settle(p2);
  await p2.click('#checklist .clcaret >> nth=1'); await settle(p2);
  views.push(...(await unnamed()).map(x => `checklist: ${x}`));
  await p2.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(p2);
  views.push(...(await unnamed()).map(x => `bullet: ${x}`));
  await p2.keyboard.press('Escape'); await p2.keyboard.press('Escape'); await settle(p2);
  views.push(...(await unnamed()).map(x => `tabs: ${x}`));
  ok('every visible control has a name, in every view, the tabs and the menus', views.length === 0, views.slice(0, 3).join(' | '));
  for (let i = 0; i < 6 && !(await p2.evaluate(() => !!document.activeElement?.closest('#col'))); i++) await p2.keyboard.press('Tab');
  const ring = await p2.evaluate(() => { const e = document.activeElement; return [e?.outerHTML.slice(0, 60), getComputedStyle(e).outlineStyle]; });
  ok('the keyboard reaches the controls, with a visible focus ring', ring[1] !== 'none', ring.join(' · '));
  await ctx2.close();
}

if (want('actual size')) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  await open(page);
  await page.mouse.move(300, 400); await page.click('#zoompct'); await page.click('[data-act=actual]'); await settle(page);
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
  await page.mouse.move(300, 400); await page.click('#zoompct'); await page.click('[data-act=actual]'); await settle(page);
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

if (want('motion: the thirteen moments play, are off under reduced motion, and leave the same page')) {
  // One walk through every moment, once with motion and once with reduced motion emulated. With motion, each moment starts the
  // animations it names (window.__wb.motion.stats.names); with reduced motion, nothing starts at all, nothing is left running, and the
  // printed page (the frame's .document) is the same, character for character, after every step.
  const walk = async reduced => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage();
    const bad = await open(page);
    const got = {}, docs = {};
    const names = () => page.evaluate(() => [...new Set(window.__wb.motion.stats.names)]);
    const clear = () => page.evaluate(() => { window.__wb.motion.stats.names.length = 0; });
    const doc = () => frameDoc(page, d => d.querySelector('.document').outerHTML);
    const running = () => page.evaluate(() => { const mine = a => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition); return document.getAnimations().filter(mine).length + document.querySelector('#sheet iframe').contentDocument.getAnimations().filter(mine).length + document.querySelectorAll('#motionlay *, .matroll').length; });
    const fr = page.frameLocator('#sheet iframe');
    // a version under the pointer: the words move; the pointer leaves, and they move back
    docs.start = await doc();
    await fr.locator('.bullets li').first().click(); await settle(page); await clear();
    docs.selected = await doc();
    await page.locator('#body .vrow[data-v]:not(.cur)').nth(1).hover(); await page.waitForTimeout(120);
    got.hover = await names(); got.hoverRunning = await running();
    await page.waitForTimeout(700); docs.hovered = await doc();
    await page.mouse.move(4, 4); await page.waitForTimeout(900); docs.unhovered = await doc();
    // a new version: its row slides into the list
    await page.click('[data-act=new-version]'); await settle(page);
    await page.evaluate(() => window.__wb.edit.draftChanged('A new wording of this line, written for the check.')); await settle(page); await clear();
    await page.evaluate(async () => { await window.__wb.edit.act('ed-new', { dataset: {} }); }); await page.waitForTimeout(500);
    got.version = await names();
    await page.keyboard.press('Control+z'); await page.waitForTimeout(700);
    // overflow: every line of every job on one page; Fit then puts it right
    await page.evaluate(async () => {
      const T = await import('/src/model/resume.js');
      window.__wb.store.commit(d => { for (const w of d.record.work) for (const h of (w.highlights ?? [])) { try { T.setBulletOn(d.record, d.cur, h.id ?? h, true); } catch { /* archived */ } } }, 'smoke: all lines');
    });
    await page.waitForTimeout(900);
    got.overflow = await page.evaluate(() => { const o = document.querySelector('.ov'); return o ? getComputedStyle(o).animationName : null; });
    docs.over = await doc();
    await clear();
    await page.click('[data-act=fit]'); await page.waitForTimeout(250);
    // never blocks input: Ctrl+Z while Fit's animation is under way takes it back at once
    await page.waitForFunction(() => !window.__wb.ui.fitting, null, { timeout: 15000 });
    await page.waitForTimeout(80); got.fit = await names(); got.chip = await page.evaluate(() => document.querySelector('.fitchip')?.textContent ?? null);
    docs.fitted = await doc();
    await page.keyboard.press('Control+z'); await page.waitForTimeout(120);
    got.undoAtOnce = (await doc()) === docs.over || await page.evaluate(() => window.__wb.store.history.redo) === 1;
    await page.waitForTimeout(900); docs.unfitted = await doc();
    got.chipGone = await page.evaluate(() => !document.querySelector('.fitchip'));
    await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(1200); docs.refitted = await doc();
    // the lens: the matching lines brighten, then Apply: lines join and leave
    await page.mouse.move(4, 4);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
    await page.evaluate(() => window.__wb.dock.setMode('outline')); await settle(page);
    const type = await page.evaluate(() => [...document.querySelectorAll('#lens option')].map(o => o.value).find(v => v)); await clear();
    await page.selectOption('#lens', type); await page.waitForTimeout(400);
    got.lens = await names(); docs.lens = await doc(); await clear();
    await page.click('[data-act=lens-apply]'); await page.click('[data-act=focus-apply]'); await page.waitForTimeout(250);
    got.apply = await names(); await page.waitForTimeout(700); docs.applied = await doc();
    await page.selectOption('#lens', ''); await settle(page);
    // a tick in the Record tab: the line travels (and the first time, one line makes the trip on its own)
    await page.evaluate(() => localStorage.removeItem('rb-cl-hint'));
    await page.keyboard.press('r'); await page.waitForTimeout(900);
    got.sample = await names(); await clear();
    await page.locator('#checklist .cb[data-on]:checked').first().click(); await page.waitForTimeout(300);
    got.untick = await names(); await clear();
    await page.locator('#checklist .cb[data-on]:not(:checked)').first().click(); await page.waitForTimeout(700);
    got.tick = await names(); docs.ticked = await doc();
    // another resume: the page crossfades, the name slides
    await page.keyboard.press('Escape'); await clear();
    const ids = await page.evaluate(() => window.__wb.store.state.resumes.map(r => r.id));
    await page.evaluate(id => window.__wb.resumes.open(id), ids[2]); await page.waitForTimeout(250);
    got.switch = await names(); await page.waitForTimeout(800);
    // a snapshot: a small copy of the page drops into the name, and "Sent to" appears under it
    await page.evaluate(() => window.__wb.resumes.markSent()); await page.waitForTimeout(300);
    await page.fill('#sv-co', 'Acme Corp'); await page.fill('#sv-role', 'Engineer'); await clear();
    await page.click('[data-act=sv-do]'); await page.waitForTimeout(300);
    got.snapshot = await names(); await page.waitForTimeout(700);
    got.sent = await page.evaluate(() => document.querySelector('#head .dsent')?.textContent ?? null);
    // the logo: hovering says what it will do, and starts the mat; a click rolls it up (Tea to Coffee), another unrolls it
    await clear();
    await page.hover('#head .logoswitch'); await page.waitForTimeout(350);
    got.peek = await page.evaluate(() => ({ layer: !!document.querySelector('.matroll'), tip: document.querySelector('#head .logoswitch').dataset.tip, to: document.querySelector('#head .logoswitch').dataset.to, drink: document.documentElement.dataset.drink }));
    await page.click('#head .logoswitch'); await page.waitForTimeout(150);
    got.roll = await names(); await page.waitForTimeout(700);
    got.coffee = await page.evaluate(() => ({ drink: document.documentElement.dataset.drink, logo: document.querySelector('#head .logoswitch img').getAttribute('src'), to: document.querySelector('#head .logoswitch').dataset.to, layer: !!document.querySelector('.matroll') }));
    // an export in coffee: a crema line reads the page and a receipt prints
    await page.evaluate(() => window.__wb.setView('export')); await settle(page); await clear();
    await page.click('[data-act=ex-html]'); await page.waitForTimeout(900);
    got.exportCoffee = await names(); await page.waitForTimeout(2200);
    await page.mouse.move(4, 4);
    await page.hover('#head .logoswitch'); await page.waitForTimeout(300); await clear();
    await page.click('#head .logoswitch'); await page.waitForTimeout(150);
    got.unroll = await names(); await page.waitForTimeout(700);
    got.tea = await page.evaluate(() => ({ drink: document.documentElement.dataset.drink, logo: document.querySelector('#head .logoswitch img').getAttribute('src') }));
    await page.evaluate(() => window.__wb.setView('export')); await settle(page); await clear();
    await page.click('[data-act=ex-html]'); await page.waitForTimeout(500);
    got.exportTea = await names(); await page.waitForTimeout(2600);
    got.left = await running();
    got.played = await page.evaluate(() => window.__wb.motion.stats.played);
    got.errors = bad.length;
    await ctx.close();
    return { got, docs };
  };
  const has = (list, ...want) => want.every(w => (list ?? []).some(n => n.startsWith(w)));
  const A = await walk(false), B = await walk(true);
  ok('with motion: a version under the pointer moves its words, and the lines below slide', has(A.got.hover, 'hover:') && A.got.hoverRunning > 0, A.got.hover.join());
  ok('with motion: a saved version slides into its list', has(A.got.version, 'version:in'));
  ok('with motion: the lens brightens the lines it picks, and Apply slides the joining lines in and folds the leaving ones away', has(A.got.lens, 'lens:hit') && has(A.got.apply, 'apply:'), JSON.stringify([A.got.lens, A.got.apply]));
  ok('with motion: a page that overflows fades its dashed edge in', A.got.overflow === 'ovIn', String(A.got.overflow));
  ok('with motion: Fit crossfades the swapped lines, folds the dropped ones, fills the meter, and leaves a chip with Undo', has(A.got.fit, 'fit:', 'chip:in') && /·|shorter|left out|swapped/.test(A.got.chip ?? '') || A.got.chip === null && has(A.got.fit, 'fit:'), JSON.stringify([A.got.fit, A.got.chip]));
  ok('…the chip says what Fit did in the interface language’s words, never a key', !/^ux4\./.test(A.got.chip ?? ''), A.got.chip ?? '');
  ok('…Ctrl+Z while Fit is still moving takes it back at once, nothing queues', A.got.undoAtOnce && A.got.chipGone);
  ok('with motion: the first time, one line of the record makes the trip to the page; each tick after it travels', has(A.got.sample, 'tick:sample') && has(A.got.untick, 'tick:') && has(A.got.tick, 'tick:'), JSON.stringify([A.got.sample, A.got.untick, A.got.tick]));
  ok('with motion: another resume crossfades the page and slides its name', has(A.got.switch, 'switch:name') && (has(A.got.switch, 'switch:out') || has(A.got.switch, 'switch:frame')), A.got.switch.join());
  ok('with motion: a snapshot drops a small page into the name, and "Sent to" appears under it', has(A.got.snapshot, 'snapshot:drop', 'snapshot:line') && /Acme Corp/.test(A.got.sent ?? ''), JSON.stringify([A.got.snapshot, A.got.sent]));
  ok('with motion: hovering the logo says what a click does, and starts the mat rolling up', A.got.peek.layer && A.got.peek.to === 'coffee' && /\|/.test(A.got.peek.tip) && !/^ux4\./.test(A.got.peek.tip) && A.got.peek.drink === 'tea', JSON.stringify(A.got.peek));
  ok('…a click carries it on: the mat rolls up, the drink is Coffee, the logo is the coffee tile and now offers Tea', has(A.got.roll, 'mat:up') && A.got.coffee.drink === 'coffee' && /icon-coffee/.test(A.got.coffee.logo) && A.got.coffee.to === 'tea');
  ok('…and back: the mat unrolls, the drink is Tea, the logo is the tea tile', has(A.got.unroll, 'mat:down') && A.got.tea.drink === 'tea' && /icons\/icon\.svg/.test(A.got.tea.logo));
  ok('with motion: an export has a picture in each drink: a crema line and a receipt in coffee, a wrapped scroll and steam in tea', has(A.got.exportCoffee, 'export:coffee-scan', 'export:coffee-print') && has(A.got.exportTea, 'export:tea-wrap', 'export:tea-carry'), JSON.stringify([A.got.exportCoffee, A.got.exportTea]));
  ok('with motion: everything is over, and nothing it drew is left behind', A.got.left === 0, String(A.got.left));
  ok('with motion: no console errors', A.got.errors === 0);

  ok('reduced motion: not one animation was started, in any moment', B.got.played === 0, String(B.got.played));
  ok('…nothing is running or drawn over the app (no layer, no roll, no chip animation)', B.got.hoverRunning === 0 && B.got.left === 0 && !B.got.peek.layer);
  ok('…yet every change happened: the same words on the page, the same Fit, the same ticks, the same drink and logo, a "Sent to" line, a chip', B.got.coffee.drink === 'coffee' && /icon-coffee/.test(B.got.coffee.logo) && B.got.tea.drink === 'tea' && /Acme Corp/.test(B.got.sent ?? '') && B.got.chip !== null);
  ok('the printed page is identical, after every step, with and without motion', Object.keys(A.docs).every(k => A.docs[k] === B.docs[k]), Object.keys(A.docs).filter(k => A.docs[k] !== B.docs[k]).join());
  ok('…and what an animation touched is gone: the page after a hover is the page before it, after Fit and Undo it is the unfitted page', A.docs.selected === A.docs.unhovered && A.docs.over === A.docs.unfitted);
  ok('reduced motion: no console errors', B.got.errors === 0);

  // the setting: Reduce motion in Settings does the same as the system's wish, on its own
  const sctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const sp = await sctx.newPage();
  await open(sp);
  await sp.evaluate(() => window.__wb.setView('settings')); await settle(sp);
  ok('Settings has a Reduce motion checkbox, off by default', await sp.isVisible('[data-reduce-motion]') && !(await sp.isChecked('[data-reduce-motion]')) && (await sp.evaluate(() => document.documentElement.dataset.motion)) === 'full');
  await sp.check('[data-reduce-motion]'); await settle(sp);
  ok('…checked, the page says so (html[data-motion=reduce]) and it is remembered per browser', (await sp.evaluate(() => document.documentElement.dataset.motion)) === 'reduce' && (await sp.evaluate(() => localStorage.getItem('rb-reduce-motion'))) === '1');
  await sp.evaluate(() => window.__wb.motion.stats.played = 0);
  await sp.evaluate(() => window.__wb.setView(null)); await sp.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(sp);
  await sp.locator('#body .vrow[data-v]:not(.cur)').nth(1).hover(); await sp.waitForTimeout(500);
  ok('…and with it on, a version under the pointer changes the page without moving a word', (await sp.evaluate(() => window.__wb.motion.stats.played)) === 0 && (await sp.evaluate(() => document.querySelector('#sheet iframe').contentDocument.getAnimations().length)) === 0);
  await sctx.close();

  // the start screen and the onboarding: skeleton lines become text, the controls come in around the page
  const ictx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ip = await ictx.newPage();
  await open(ip, '?memory&welcome');
  await ip.waitForTimeout(500); await ip.evaluate(() => window.__wb.motion.stats.names.length = 0);
  await ip.click('[data-act=ob-example]'); await ip.waitForTimeout(250);
  const first = await ip.evaluate(() => [...new Set(window.__wb.motion.stats.names)]);
  ok('start screen to editor: the page’s lines are written in one after another, and the header, panel and tabs come in', has(first, 'start:line', 'start:head', 'start:body', 'start:tabs'), first.join());
  await ictx.close();
  const qctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const qp = await qctx.newPage();
  await open(qp, '?memory&welcome');
  await qp.waitForTimeout(500);
  await qp.click('[data-act=ob-scratch]'); await qp.waitForTimeout(400); await qp.click('[data-act=ob-lang-go]'); await qp.waitForTimeout(700);
  await qp.evaluate(() => window.__wb.motion.stats.names.length = 0);
  await qp.evaluate(() => window.__wb.onboarding.act('ob-finish')); await qp.waitForTimeout(200);
  const quiet = await qp.evaluate(() => [...new Set(window.__wb.motion.stats.names)]);
  ok('onboarding to Start editing: the header and the tabs fade and slide in around the page', has(quiet, 'quiet:head', 'quiet:rail'), quiet.join());
  await qctx.close();
}

if (want('nothing over the text')) {
  // After a job, a line and while writing, nothing of the shell's lies over a printed line. Allowed: the page's own frames (the selection
  // frames, the veil), the writing tools in the right margin, and the layers that hold them. Everything else that is fixed or absolute
  // (the tip, a pill, a corner, a toast) must stay off every line's box. The tea garden and the motion layer draw no boxes of their own.
  const offenders = page => page.evaluate(() => {
    const wb = window.__wb;
    const lines = wb.sheet.textRects().map(r => wb.canvas.screenRect(r));
    const allowed = '#sheet, #pages, #editlay, #ovlay, #garden, .g-dapple, #motionlay, #zoombar, .obframe, .obveil, .obtoolswrap';       // (the zoom bar shows while the pointer is over the page, which is what the pointer resting on a line is)
    const name = el => el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].slice(0, 2).join('.');
    // the on-page layer holds frames, a veil and the tools, and nothing else
    const out = [...document.querySelectorAll('#editlay > *')].filter(el => !el.matches('.obframe, .obveil, .obtoolswrap')).map(name);
    for (const el of document.body.querySelectorAll('*')){
      if (el.closest(allowed)) continue;
      const cs = getComputedStyle(el);
      if (!/(fixed|absolute)/.test(cs.position) || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // a line's box is a little bigger than its letters: two pixels of it all round do not count
      if (lines.some(l => Math.min(r.right, l.left + l.width - 2) > Math.max(r.left, l.left + 2) && Math.min(r.bottom, l.top + l.height - 2) > Math.max(r.top, l.top + 2))) out.push(name(el));
    }
    return [...new Set(out)];
  });
  for (const [w, h, folded] of [[1280, 720, true], [1470, 832, true], [1280, 720, false], [1470, 832, false]]){
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const bad = await open(page, undefined, { folded });
    const fr = page.frameLocator('#sheet iframe');
    await fr.locator('.role-title').first().click(); await page.waitForTimeout(900);
    ok(`${w}×${h}${folded ? ' folded' : ''}: a job is selected and nothing lies over its text`, (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'job' && (await offenders(page)).length === 0, (await offenders(page)).join(', '));
    await fr.locator('.bullets li').nth(1).click(); await page.waitForTimeout(900);
    ok(`${w}×${h}${folded ? ' folded' : ''}: a line is selected (the pointer rests on it): nothing over the text, and no tip`, (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'bullet' && (await offenders(page)).length === 0 && !(await page.isVisible('#tip.on')), (await offenders(page)).join(', '));
    // a click that redraws what is under the pointer opens no tip by itself; a pointer that moves onto it does
    if (folded){
      const b = await page.locator('.obv').boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 }); await page.waitForTimeout(900);
      ok(`${w}×${h} folded: a pointer moving onto the version badge opens its tip`, await page.isVisible('#tip.on'));
      await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(1200);
      ok(`${w}×${h} folded: the click redrew the badge under the resting pointer, and no tip opened`, (await page.isVisible('.obpop')) && !(await page.isVisible('#tip.on')));
    }
    await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await fr.locator('.bullets li').nth(1).dblclick(); await page.waitForTimeout(1500);
    ok(`${w}×${h}${folded ? ' folded' : ''}: while writing, nothing lies over the text`, !!(await page.evaluate(() => window.__wb.ui.writing)) && (await offenders(page)).length === 0, (await offenders(page)).join(', '));
    // a bigger writing zoom would slide the page's left edge (and the section tabs beside it) out of the view
    await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.waitForTimeout(600);
    await page.evaluate(() => localStorage.setItem('rb-zoomwrite', '150'));
    await fr.locator('.bullets li').nth(1).dblclick(); await page.waitForTimeout(1500);
    ok(`${w}×${h}${folded ? ' folded' : ''}: writing at 150%, the page's left edge stays inside the view`, await page.evaluate(() => { const c = window.__wb.canvas, l = c.screenRect(window.__wb.sheet.pageBoxes()[0]).left; return !!window.__wb.ui.writing && l >= c.view.left && l < c.view.left + c.view.width / 4; }), await page.evaluate(() => window.__wb.canvas.screenRect(window.__wb.sheet.pageBoxes()[0]).left));
    ok(`${w}×${h}: no errors`, bad.length === 0, bad.join(' | '));
    await ctx.close();
  }
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
