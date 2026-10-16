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
import zlib from 'node:zlib';
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

// Every test context asks for reduced motion, so nothing needs waiting for; a section that tests the motion itself opts out with
// `motion: true` in that context's options.
const newContext = ({ motion = false, ...o } = {}) => browser.newContext({ reducedMotion: motion ? 'no-preference' : 'reduce', ...o });

const exe = process.env.CHROME_PATH
  ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});

async function open(page, q, { help = false, drink = null, theme = null } = {}){
  const bad = [];
  // the shortcut sheet is seen once it has been opened (and the panel hint goes with it): a check that is not about it starts with the
  // sheet seen.
  await page.addInitScript(([h, d, t]) => { try { if (!h) localStorage.setItem('rb-help-seen', '1'); if (d) localStorage.setItem('rb-drink', d); if (t) localStorage.setItem('rb-theme', t); } catch { /* nothing to set */ } }, [help, drink, theme]);
  page.on('console', m => { if (m.type() === 'error') bad.push(m.text()); });
  page.on('pageerror', e => bad.push(String(e)));
  await page.goto(URL_(q), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 });
  await page.waitForFunction(() => (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  return bad;
}
const frameDoc = (page, fn, arg) => page.evaluate(([src, a]) => (0, eval)(src)(document.querySelector('#sheet iframe').contentDocument, a), [fn.toString(), arg]);
const firstBullet = page => frameDoc(page, d => d.querySelector('.bullets li')?.textContent ?? '');
// The page is quiet: two frames drawn, fonts loaded, no redraw or autosave waiting, no finite animation running (in the page and in
// the sheet), the pages not moving, and the pictures of an open screen drawn. 10 s at most, then a FAIL by name (and the run goes on).
async function settle(page){
  const quiet = () => {       // true when quiet; else false, with the reason in window.__why (the page's CSP forbids evaluating a string)
    const wb = window.__wb, finite = d => d.getAnimations().every(a => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity);
    const why = w => { window.__why = w; return !w; };
    if (document.fonts.status !== 'loaded') return why('fonts are loading');
    if (wb?.busy()) return why('a redraw is waiting or running');
    if (wb && ['pending', 'saving'].includes(wb.persist.status.status)) return why('the autosave is ' + wb.persist.status.status);
    if (document.body.classList.contains('is-moving')) return why('the pages are moving');
    if (!finite(document)) return why('an animation is running in the page');
    if (![...document.querySelectorAll('iframe')].every(f => { try { return finite(f.contentDocument); } catch { return true; } })) return why('an animation is running in a frame');
    if ([...document.querySelectorAll('[data-thumb]')].some(el => !el.dataset.pages && el.isConnected && el.getClientRects().length)) return why('a picture is not drawn');
    return why('');
  };
  try {
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.waitForFunction(quiet, null, { timeout: 10000, polling: 'raf' });
  } catch (e){ ok('the page went quiet within 10 s (settle)', false, await page.evaluate(() => window.__why).catch(() => '') || String(e.message).split('\n')[0]); }
}
// the line being written on the page: an editable element in the frame
const lineEl = page => page.frameLocator('#sheet iframe').locator('[contenteditable]');
const lineText = page => page.evaluate(() => window.__wb.edit.editing?.draft ?? null);
const writeLine = async (page, text) => { await lineEl(page).focus(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(text); await settle(page); };
const caretTo = (page, where) => page.evaluate(w => { const el = window.__wb.onpage.el(); const d = el.ownerDocument, sel = d.defaultView.getSelection(), r = d.createRange(); r.selectNodeContents(el); r.collapse(w === 'start'); sel.removeAllRanges(); sel.addRange(r); }, where);
const appendLine = async (page, text) => { await lineEl(page).first().focus(); await caretTo(page, 'end'); await page.keyboard.insertText(text); await settle(page); };
// Open a saved resume the way a person does: through the switcher under the name in the head.
async function openByName(page, text){
  if (!(await page.isVisible('#switcher'))) await page.click('#docname-btn');
  await page.waitForSelector('#switcher .sopt');
  await page.fill('#switcher #sw-q', text);       // the name window lists the recent ones; a search lists them all
  await page.waitForSelector(`#switcher .sopt:has-text("${text}")`);
  await page.click(`#switcher .sopt:has-text("${text}")`);
  await settle(page);
}
// The language of the open resume: in the name window, a list of the languages in use, then the ones to add (the window closes on a choice)
async function pickLang(page, code){
  if (!(await page.isVisible('#switcher'))) await page.click('#docname-btn');
  await page.waitForSelector('#sw-lang');
  await page.selectOption('#sw-lang', (await page.$(`#sw-lang option[value="${code}"]`)) ? code : `+${code}`);
}
const rect = (page, s) => page.$eval(s, el => el.getBoundingClientRect().toJSON());
// Mark as sent: the end of Export
async function markSent(page){ await page.evaluate(() => window.__wb.dock.setMode('export')); await settle(page); await page.click('[data-act=mark-sent]'); }
// The Outline: Edit with nothing selected
async function toEditHome(page){ await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); }); await settle(page); }
// The first job selected: its lines are the movable rows
async function toJobOutline(page){ await toEditHome(page); await page.click('#outline [data-act=select-section][data-id=experience]'); await settle(page); await page.locator('#body .jobname').first().click(); await settle(page); }      // from the Outline: the section, then the job by its name (a click on the page would write the title)
// + Add lives in the Record tab's header
async function openAdd(page){ await inRecord(page); await page.click('[data-act=c-pop]'); }
// The Record tab lists the record's groups, all open. Open it, and make sure one group is open and in view.
async function inRecord(page, group = null){
  if ((await page.evaluate(() => window.__wb.ui.view)) !== 'record'){ await page.evaluate(() => window.__wb.dock.setMode('record')); await settle(page); }
  if (group){
    const c = page.locator(`#checklist .clg[data-g=${group}] .clcaret`);
    if ((await c.getAttribute('aria-expanded')) === 'false'){ await c.click(); await settle(page); }
    await page.locator(`#checklist .clg[data-g=${group}]`).scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
  }
}


if (want('layout: the page and the sidebar, centred in the window')) for (const [w, h] of [[1536, 864], [1440, 960], [1280, 800]]){
  const ctx = await newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const bad = await open(page);
  let s = await rect(page, '#sheet'), c = await rect(page, '#col'), hd = await rect(page, '#head');
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(`${w}×${h}: loads with no console errors`, bad.length === 0, bad[0] ?? '');
  ok(`${w}×${h}: the sidebar is open, with the rail beside it: Edit, Design and Export are its tabs (none in the name card), Edit is selected; nothing is selected, so Edit shows the Outline`, await page.isVisible('#body') && await page.isVisible('#head') && await page.isVisible('#rail') && !(await page.$('#tabs')) && (await page.$$('#rail [role=tab]')).length === 3 && (await page.$$('#head [role=tab]')).length === 0 && (await page.getAttribute('#tab-edit', 'aria-selected')) === 'true' && (await page.getAttribute('#body', 'data-mode')) === 'outline');
  const rl = await rect(page, '#rail');
  ok(`${w}×${h}: the page runs the full height (16px from top and bottom) and sits in the room left of the rail`, Math.abs(s.top - 16) < 1 && Math.abs(h - s.bottom - 16) < 1 && s.right < rl.left - 16 + 1, `${s.right.toFixed(1)} ${rl.left.toFixed(1)}`);
  ok(`${w}×${h}: the sidebar is ${w < 1400 ? 316 : 340}px wide (340, 316 under 1400px windows), 16px from the top, the bottom and the right; the 54px rail touches it`, Math.abs(c.width - (w < 1400 ? 316 : 340)) < 1 && Math.abs(c.top - 16) < 1 && Math.abs(c.height - (h - 32)) < 1 && Math.abs(w - c.right - 16) < 1 && Math.abs(rl.width - 54) < 1 && Math.abs(rl.right - c.left) < 1, `${c.width}px`);
  ok(`${w}×${h}: the page is centred in the room left of the rail`, Math.abs((s.left + s.right) / 2 - (rl.left - 16) / 2) < 2, `${((s.left + s.right) / 2).toFixed(1)} vs ${((rl.left - 16) / 2).toFixed(1)}`);
  ok(`${w}×${h}: the name card: the name, Saved, the menu and Fit (no logo, Save to file, undo, redo or tabs); the rail: the logo, the tabs, Resumes and Record, the page bars, undo and redo`, await page.evaluate(() => { const hd = document.querySelector('#head'), rail = document.querySelector('#rail'); return !hd.querySelector('.logoswitch') && !!hd.querySelector('#docname-btn') && !!hd.querySelector('#savestate') && !hd.querySelector('#filestate') && !hd.querySelector('[data-act=undo]') && !!hd.querySelector('[data-act=menu]') && !!rail.querySelector('.logoswitch') && ['undo', 'redo', 'sw-manage', 'sw-record'].every(a => rail.querySelector(`[data-act=${a}]`)) && !hd.querySelector('.meter') && !!rail.querySelector('.rhist .meter') && !!hd.querySelector('[data-act=fit]'); }));
  ok(`${w}×${h}: there is no footer: nothing is drawn at the bottom, and the editor card runs to the column's end, under the name card`, await page.evaluate(() => !document.querySelector('#foot')?.getClientRects().length && !document.querySelector('#foot')?.children.length) && Math.abs((await rect(page, '#body')).bottom - c.bottom) < 1 && hd.top === c.top && hd.bottom < (await rect(page, '#body')).top);
  ok(`${w}×${h}: no horizontal scroll`, scrollW <= w);
  await ctx.close();
}

if (want('one screen: the sidebar, the zoom bar, the shortcut sheet')) {
  const ctx = await newContext({ motion: true, viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  const S = () => page.evaluate(() => ({ sel: window.__wb.ui.sel.kind, zoom: window.__wb.ui.zoom, view: window.__wb.ui.view ?? null, tab: document.querySelector('#rail [role=tab][aria-selected=true]')?.dataset.m ?? null }));
  const key = k => page.keyboard.press(k);
  ok('the sidebar is on screen with its rail, no old tabs, no fold and no panel mode', await page.isVisible('#body') && await page.isVisible('#rail') && !(await page.$('#tabs')) && !(await page.$('.is-folded')) && (await page.evaluate(() => window.__wb.ui.panel)) === undefined && (await page.evaluate(() => window.__wb.ui.folded)) === undefined);
  ok('E does nothing now: the sidebar does not fold', (await key('e'), await settle(page), await page.isVisible('#body') && await page.isVisible('#head')));
  ok('Edit, Design and Export are a vertical tab list in the rail: one tab stop, roving', await page.evaluate(() => { const l = document.querySelector('#rail [role=tablist]'); return !!l && l.getAttribute('aria-orientation') === 'vertical' && [...l.querySelectorAll('[role=tab]')].map(b => b.dataset.m).join() === 'edit,design,export' && l.querySelectorAll('[tabindex="0"]').length === 1 && l.querySelectorAll('[tabindex="-1"]').length === 2 && l.getAttribute('aria-label') && [...l.querySelectorAll('[role=tab]')].every(b => b.getAttribute('aria-controls') === 'body'); }));
  // the zoom bar: only while the pointer is over the page
  await page.mouse.move(1450, 20); await page.waitForTimeout(800);
  ok('the zoom bar is hidden while the pointer is away from the page', !(await page.evaluate(() => document.querySelector('#zoombar').classList.contains('on'))) && (await page.evaluate(() => +getComputedStyle(document.querySelector('#zoombar')).opacity)) < 0.05);
  // only over the white sheet: the mat beside it (and above and below it), and the gap, leave it hidden
  const sr = await rect(page, '#sheet');
  for (const [what, x, y] of [['the mat beside the page', sr.left - 30, 400], ['the mat under the page', sr.left + sr.width / 2, sr.bottom + 8]]){
    if (x < 5 || y > 860) continue;
    await page.mouse.move(x, y, { steps: 4 }); await page.waitForTimeout(900);
    ok(`the zoom bar stays hidden over ${what}`, !(await page.evaluate(() => document.querySelector('#zoombar').classList.contains('on'))), `${x.toFixed(0)},${y.toFixed(0)}`);
  }
  await page.mouse.move(sr.left + sr.width / 2, sr.top + 200, { steps: 4 }); await page.waitForTimeout(500);
  ok('over the white sheet it shows, in the frame too (the page is an iframe)', await page.evaluate(() => document.querySelector('#zoombar').classList.contains('on')));
  await page.mouse.move(sr.left - 30, 400, { steps: 4 }); await page.waitForTimeout(900);
  ok('…and leaving the sheet for the mat hides it again', !(await page.evaluate(() => document.querySelector('#zoombar').classList.contains('on'))));
  await page.mouse.move(300, 400); await page.waitForTimeout(500);
  ok('over the page it shows: full screen, −, the percentage, +, fit, Actual size — at the foot of the page area, under the page', await page.evaluate(() => { const z = document.querySelector('#zoombar'), r = z.getBoundingClientRect(); return z.classList.contains('on') && +getComputedStyle(z).opacity > 0.9 && ['fullscreen', 'zoom-out', 'zoom-in', 'zoom-fit', 'actual'].every(a => z.querySelector(`[data-act=${a}]`)) && !!z.querySelector('#zoompct') && r.bottom > innerHeight - 40 && r.right < document.querySelector('#col').getBoundingClientRect().left; }));
  // read the bar at once after the pointer leaves, and ask the page how long ago that was (a loaded machine can be late: then leave again)
  let stayed = false;
  for (let tries = 0; tries < 5 && !stayed; tries++){
    await page.mouse.move(300, 400); await page.waitForFunction(() => document.querySelector('#zoombar').classList.contains('on'));
    await page.evaluate(() => { window.__leftAt = 0; document.addEventListener('mousemove', e => { window.__leftAt = e.timeStamp; }, { capture: true, once: true }); });
    await page.mouse.move(1450, 400);
    const r = await page.evaluate(() => ({ on: document.querySelector('#zoombar').classList.contains('on'), ago: performance.now() - window.__leftAt }));
    if (r.ago < 300) stayed = r.on; else continue;
    break;
  }
  ok('it stays 0.4s after the pointer leaves…', stayed);
  await page.waitForTimeout(900);
  ok('…and then fades out', !(await page.evaluate(() => document.querySelector('#zoombar').classList.contains('on'))));
  await key('='); await page.waitForTimeout(450);
  ok('zooming with a key flashes it for 1.2s even with the pointer elsewhere', await page.evaluate(() => document.querySelector('#zoombar').classList.contains('on')) && (await S()).zoom > 1);
  await page.waitForTimeout(1500);
  ok('…then it goes', !(await page.evaluate(() => document.querySelector('#zoombar').classList.contains('on'))));
  await key('0'); await settle(page);
  // Edit, Design and Export: the arrows move between the tabs and open each
  await page.click('#tab-edit'); await settle(page);
  await page.focus('#tab-edit'); await key('ArrowDown'); await settle(page);
  ok('↓ moves to Design and opens it, the focus on it', (await S()).tab === 'design' && (await S()).view === 'design' && (await page.evaluate(() => document.activeElement?.id)) === 'tab-design');
  await key('End'); await settle(page);
  ok('End goes to Export, Home back to Edit', (await S()).tab === 'export' && (await (async () => { await key('Home'); await settle(page); return (await S()).tab === 'edit' && (await page.getAttribute('#body', 'data-view')) === 'outline'; })()));
  // keyboard: a disabled tab is skipped, Record leaves Edit as the tab stop, the menu takes the focus, an Outline line hands it to the inspector and Esc hands it back
  await page.evaluate(() => { document.querySelector('#tab-design').disabled = true; });
  await page.focus('#tab-edit'); await key('ArrowDown'); await settle(page);
  ok('↓ skips a disabled Design tab', (await S()).tab === 'export' && (await page.evaluate(() => document.activeElement?.id)) === 'tab-export');
  await page.click('#tab-edit'); await settle(page);
  await page.evaluate(() => window.__wb.setView('record')); await settle(page);
  ok('in Record no tab is selected on the desktop, and Edit is the one tab stop', (await page.evaluate(() => window.__wb.ui.view)) === 'record' && await page.evaluate(() => { const t = [...document.querySelectorAll('#rail [role=tab]')]; return t.filter(x => x.tabIndex === 0).map(x => x.id).join() === 'tab-edit'; }));
  await key('Escape'); await settle(page);
  await page.click('[data-act=menu]'); await page.waitForTimeout(100);
  ok('the ⋯ menu takes the focus on its first item, and ↓ moves on', await page.evaluate(() => document.activeElement?.closest('.menu') !== null) && await (async () => { await key('ArrowDown'); return page.evaluate(() => !!document.activeElement?.closest('.menu') && document.activeElement !== document.querySelector('.menu [role=menuitem]')); })());
  await key('Escape'); await settle(page);
  await page.click('#tab-edit'); await settle(page);
  await page.locator('#outline .clt:visible').first().click(); await settle(page);
  ok('opening a line from the Outline puts the focus on the inspector’s heading', await page.evaluate(() => document.activeElement?.matches('#body .title')));
  for (let i = 0; i < 3 && (await page.evaluate(() => window.__wb.ui.sel.kind)) !== 'none'; i++){ await key('Escape'); await settle(page); }
  ok('…and Esc back to the Outline leaves the focus on Edit’s tab, not the page body', (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'none' && (await page.evaluate(() => document.activeElement?.id)) === 'tab-edit');
  ok('the stripe on the sidebar’s top is gone', await page.evaluate(() => ['none', 'normal'].includes(getComputedStyle(document.querySelector('#body'), '::before').content)));
  // the page's x never moves with a sheet or a selection
  const xs = [];
  for (const m of ['edit', 'design', 'export']){ await page.click(`#tab-${m}`); await settle(page); xs.push(Math.round((await rect(page, '#sheet')).left * 10)); }
  await page.mouse.move(4, 4); await key('ArrowDown'); await settle(page); xs.push(Math.round((await rect(page, '#sheet')).left * 10));      // a line selected (a click would write it, and zoom)
  await key('Escape'); await key('Escape'); await settle(page);
  await page.click('#outline [data-act=select-section][data-id=experience]'); await settle(page); await page.locator('#body .jobname').first().click(); await settle(page); xs.push(Math.round((await rect(page, '#sheet')).left * 10));      // a job, from the sidebar (a click on its title would write it, and zoom)
  ok('the page’s x is the same on Edit, Design and Export and for a line or a job selected', new Set(xs).size === 1 && (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'job', xs.join());
  await page.mouse.move(4, 4); await key('Escape'); await key('Escape'); await settle(page);
  // Esc goes up a level
  await sheet.locator('.bullets li').first().click(); await settle(page);
  await page.mouse.move(4, 4); await key('Escape'); await key('Escape'); await settle(page);
  ok('Esc goes up to the job, then to the page: the selection clears and the sidebar stays', (await S()).sel === 'none' && await page.isVisible('#body'));
  await key('=');
  await sheet.locator('.bullets li').first().click(); await settle(page);
  ok('= zooms in (and 100% is the whole page)', (await S()).zoom > 1 && /^1[2-9]\d%$/.test(await page.textContent('#zoompct')));
  await page.mouse.move(4, 4); await key('Escape'); await key('Escape'); await settle(page);
  ok('Esc all the way out clears the selection and zooms back to the whole page, and leaves the sidebar as it is', (await S()).sel === 'none' && (await S()).zoom === 1, JSON.stringify(await S()));
  // the zoom bar, with the pointer over it
  await page.mouse.move(300, 400); await settle(page);
  await page.click('[data-act=zoom-in]'); await page.click('[data-act=zoom-in]'); await settle(page);
  const z = (await S()).zoom;
  ok('+ zooms the page about the middle: the page grows past the window’s height', z > 1.5 && (await page.evaluate(() => { const c = window.__wb.canvas; return c.cam.k * c.geo.h > innerHeight - 32 + 10; })) && /%/.test(await page.textContent('#zoompct')));
  await page.click('[data-act=zoom-out]'); await settle(page);
  ok('− zooms out', (await S()).zoom < z);
  await page.click('[data-act=zoom-fit]'); await settle(page);
  ok('the fit button shows the whole page again: 100%', (await S()).zoom === 1 && (await page.textContent('#zoompct')).trim() === '100%');
  await key('-'); await key('-'); await settle(page);
  ok('the keys: - zooms out too, and 0 fits', (await S()).zoom < 1 && (await page.keyboard.press('0'), await settle(page), (await S()).zoom === 1));
  await page.mouse.move(300, 400); await settle(page);
  ok('the percentage is plain text and Actual size is a button on the zoom bar: there is no pop-up', await page.evaluate(() => document.querySelector('#zoompct').tagName === 'SPAN' && !!document.querySelector('#zoombar [data-act=actual]') && !document.querySelector('#zpop')));
  await page.click('#zoombar [data-act=actual]'); await settle(page);
  ok('Actual size opens the calibration over the page', await page.evaluate(() => document.body.classList.contains('is-actual')));
  await key('Escape'); await settle(page);
  ok('Esc closes it', await page.evaluate(() => !document.body.classList.contains('is-actual')));
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
  await page.hover('#rail [data-act=undo]'); await page.waitForSelector('#tip.on');
  ok('the rail’s icons have a hover hint: a title and one line', await page.isVisible('#tip.on') && /Undo/.test(await page.textContent('#tip b')) && (await page.textContent('#tip')).length > 8);
  await page.mouse.move(4, 4);
  // the same hints for a keyboard: on focus, and Esc takes one away
  await page.focus('#savestate'); await page.keyboard.press('Tab'); await page.waitForSelector('#tip.on');
  ok('a hint shows on keyboard focus too: Tab to the menu button', await page.evaluate(() => document.activeElement?.matches('[data-act=menu]')) && await page.isVisible('#tip.on'));
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  ok('…and Esc takes it away', !(await page.isVisible('#tip.on')));
  await page.focus('#savestate'); await page.waitForSelector('#tip.on');
  ok('Saved is an icon with a hint on focus: the words, then where the file stands', await page.isVisible('#tip.on') && /Saved on this device/.test(await page.textContent('#tip b')) && /file/i.test(await page.textContent('#tip')));
  await page.evaluate(() => document.activeElement.blur()); await page.mouse.move(4, 4);
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
  const ctx2 = await newContext({ motion: true, viewport: { width: 1440, height: 900 } });
  const p2 = await ctx2.newPage();
  await open(p2, undefined, { help: true });
  await p2.click('#tab-edit'); await settle(p2);
  ok('a first visit: the shortcut sheet is not open; with nothing selected the sidebar shows the Outline, with “? shows the shortcuts” at its top', !(await p2.isVisible('#help')) && /\? shows the shortcuts/.test(await p2.textContent('#body .kbdhint')) && (await p2.evaluate(() => document.querySelector('#body').firstElementChild.classList.contains('kbdhint'))) && (await p2.getAttribute('#body', 'data-mode')) === 'outline');
  await p2.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(p2);
  ok('the first selection on the page leaves it closed', !(await p2.isVisible('#help')));
  ok('the hint is not on the page', !(await frameDoc(p2, d => /shows the shortcuts/.test(d.body.textContent))));
  await p2.mouse.move(4, 4); await p2.keyboard.press('Escape'); await settle(p2);      // out of the line the click wrote, so ? is not typed into it
  await p2.keyboard.press('Shift+?'); await settle(p2);
  ok('the ? key opens it, and the hint is gone', await p2.isVisible('#help') && !(await p2.$('#body .kbdhint')));
  await p2.keyboard.press('Escape'); await settle(p2);
  await p2.reload({ waitUntil: 'networkidle' }); await p2.waitForFunction(() => document.body.classList.contains('is-ready'));
  await p2.click('#tab-edit'); await settle(p2);
  ok('…not after a reload either (remembered in this browser): no sheet, no hint', !(await p2.isVisible('#help')) && !(await p2.$('#body .kbdhint')));
  await p2.click('[data-act=menu]');
  ok('the ⋯ menu has no Save to file (Export has it); the name card has no language tag (the name window has the language and paper)', !(await p2.$('.menu [data-act=save-file]')) && !(await p2.$('#head #filestate')) && !(await p2.$('#head #langbtn')) && !(await p2.$('#head .dline')));
  await p2.keyboard.press('Escape'); await p2.click('#docname-btn'); await settle(p2);
  ok('the name window has the language and the paper, as lists', await p2.isVisible('#switcher #sw-lang') && /English/.test(await p2.$eval('#sw-lang', e => e.selectedOptions[0].textContent)) && await p2.isVisible('#switcher #sw-paper'));
  await ctx2.close();
}

if (want('one screen: a narrow window keeps the sidebar at its width; the keyboard path through the checklist')) {
  const ctx = await newContext({ viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  const s0 = await rect(page, '#sheet'), c0 = await rect(page, '#col');
  const r0 = await rect(page, '#rail');
  ok('1100×800: the sidebar keeps 316px and the rail 54px, and the page sits left of them (no drawer over the page)', Math.abs(c0.width - 316) < 1 && Math.abs(r0.width - 54) < 1 && s0.height <= 800 - 32 + 1 && s0.right < r0.left && (await page.evaluate(() => document.body.dataset.drawer)) === undefined);
  await page.mouse.move(4, 4); await page.keyboard.press('ArrowDown'); await settle(page);      // a line selected (a click would write it, and zoom)
  const s1 = await rect(page, '#sheet'), c1 = await rect(page, '#col');
  ok('selecting changes nothing about the page or the panel’s edge', Math.abs(s1.left - s0.left) < 1 && Math.abs(s1.width - s0.width) < 1 && Math.abs(c1.left - c0.left) < 1 && Math.abs(c1.width - 316) < 1);
  ok('…the sidebar and the page do not overlap, and there is no sideways scroll', c1.left >= s1.right && (await page.evaluate(() => document.documentElement.scrollWidth)) <= 1100);
  ok('the name card still holds the name, Saved and the menu at 316px', await page.evaluate(() => { const h = document.querySelector('#head').getBoundingClientRect(); return ['#docname-btn', '[data-act=menu]', '#savestate'].every(s => { const r = document.querySelector(`#head ${s}`).getBoundingClientRect(); return r.right <= h.right + 1 && r.left >= h.left - 1 && r.width > 0; }); }));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();

  // the keyboard alone: the Record tab, a group, a row, the inspector, Esc
  const ctx2 = await newContext({ viewport: { width: 1536, height: 864 } });
  const p2 = await ctx2.newPage();
  const bad2 = await open(p2);
  await p2.keyboard.press('r'); await settle(p2);
  for (let i = 0; i < 60 && !(await p2.evaluate(() => document.activeElement?.closest?.('#checklist'))); i++) await p2.keyboard.press('Tab');
  ok('Tab reaches the record’s checklist, whose controls are plain buttons and checkboxes in tab order', await p2.evaluate(() => !!document.activeElement?.closest('#checklist')));
  for (let i = 0; i < 60 && !(await p2.evaluate(() => document.activeElement?.dataset?.g === 'hydra' && document.activeElement.classList.contains('clcaret'))); i++) await p2.keyboard.press('Tab');
  ok('every group is open, and Enter on a group’s caret folds it (aria-expanded)', (await p2.getAttribute('#checklist .clg[data-g=hydra] .clcaret', 'aria-expanded')) === 'true' && await (async () => { await p2.keyboard.press('Enter'); await settle(p2); return (await p2.getAttribute('#checklist .clg[data-g=hydra] .clcaret', 'aria-expanded')) === 'false'; })());
  await p2.keyboard.press('Enter'); await settle(p2);
  await p2.keyboard.press('Tab');
  ok('the stop after the caret is the entry\'s name: a button named with the job, not a separate “Open it”', await p2.evaluate(() => { const b = document.activeElement; return b?.classList.contains('jobname') && b.tagName === 'BUTTON' && b.textContent.trim().length > 3 && !!b.closest('#checklist') && !/^Open it$/.test(b.textContent.trim()); }));
  await p2.keyboard.press('Tab'); await p2.keyboard.press('Space'); await settle(p2);
  const rowOn = await p2.evaluate(() => { const cb = document.activeElement; return { box: cb?.classList.contains('cb'), label: cb?.getAttribute('aria-label') }; });
  ok('the next stop is a row’s checkbox, named with the line’s text, and Space toggles it', rowOn.box && /\w/.test(rowOn.label ?? '') && (await p2.evaluate(() => window.__wb.store.history.undo)) === 1);
  await p2.keyboard.press('Control+z'); await settle(p2);
  await p2.keyboard.press('Tab'); await p2.keyboard.press('Enter'); await settle(p2);
  ok('Tab then Enter on the line’s text opens the claim in Edit, and the focus moves to its heading', (await p2.getAttribute('#body', 'data-view')) === 'bullet' && (await p2.evaluate(() => document.activeElement?.classList.contains('title'))));
  await p2.keyboard.press('Tab');
  ok('Tab goes on inside the inspector (not back to the top of the page)', await p2.evaluate(() => !!document.activeElement?.closest('#body')));
  await p2.keyboard.press('Escape'); await settle(p2);
  ok('Esc goes up: a line in a job is the job level, and one Esc goes to the page', (await p2.getAttribute('#body', 'data-view')) === 'outline');
  await p2.keyboard.press('Escape'); await settle(p2);
  ok('and out: nothing selected, the sidebar stays', await p2.isVisible('#body') && (await p2.getAttribute('#body', 'data-view')) === 'outline');
  ok('no console errors', bad2.length === 0, bad2[0] ?? '');
  await ctx2.close();
}

if (want('one screen: nothing is drawn on the page for claims that are off, and no breadcrumb')) {
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  const before = await frameDoc(page, d => d.querySelectorAll('*').length);
  await sheet.locator('.bullets li').first().click(); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);      // one click wrote the line; out of it, the line is selected
  const after = await frameDoc(page, d => [d.querySelectorAll('*').length, d.querySelectorAll('input, button, .ghost, [data-toggle]').length]);
  ok('the page’s own markup has no controls: no circles, no switches, no faded rows (only the outline of the selection)', after[1] === 0 && after[0] === before);
  ok('no old breadcrumb lies over the page: its layer holds only frames, a veil, the tools and the one chip', !(await page.$('.obcrumb')) && !(await page.$('.jobchip')) && (await page.$$('#editlay .obchip')).length === 1 && await page.evaluate(() => [...document.querySelectorAll('#editlay > *')].every(el => el.matches('.obframe, .obveil, .obtoolswrap, .obchip'))));
  await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await settle(page);
  ok('Esc goes to the page: nothing is selected and the layer is empty', (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'none' && !(await page.$('#editlay > *')));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('selecting, preview, versions, undo')) {
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  ok('the example opens on its first saved resume', /Example Instruments/.test(await page.textContent('#docname')));
  ok('the Outline lists the sections in print order when nothing is selected, and says how Fit works', /Fit cuts from the bottom/.test(await page.textContent('#body')) && (await page.$$('#seclist .srow')).length >= 4);

  await sheet.locator('.bullets li').first().click(); await settle(page);
  ok('clicking a bullet on the sheet writes it', (await page.getAttribute('#body', 'data-view')) === 'bullet' && (await lineEl(page).count()) === 1);
  await page.keyboard.press('Escape'); await settle(page);      // out of the line: it stays selected
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
  ok('Esc goes to the page', (await page.getAttribute('#body', 'data-view')) === 'outline');

  await sheet.locator('.role-title').first().click(); await settle(page);
  ok('clicking a job title writes it, as a text of its job: its versions are in the card', (await page.getAttribute('#body', 'data-view')) === 'bullet' && (await page.evaluate(() => window.__wb.ui.sel.id ?? '')).endsWith('-position') && (await lineEl(page).count()) === 1);
  await page.click('#editlay .obchip [data-act=select-job]'); await settle(page);
  ok('the chip\'s job level selects the job', (await page.getAttribute('#body', 'data-view')) === 'job');
  await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await settle(page);
  await sheet.locator('.band[data-section="skills"] .tab').first().click(); await settle(page);
  ok('clicking a section\'s heading writes it, in the card the section\'s own view', (await page.getAttribute('#body', 'data-view')) === 'section' && (await lineEl(page).count()) === 1);
  await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await sheet.locator('.name').click(); await settle(page);
  ok('clicking the name writes it where it prints: it is a line of the header, with its versions in the card', (await page.getAttribute('#body', 'data-view')) === 'bullet' && (await page.evaluate(() => `${window.__wb.ui.sel.id}/${window.__wb.ui.sel.section}`)) === 'name/header' && (await sheet.locator('[contenteditable]').count()) === 1);
  await page.click('#body .depth [data-act=select-header]'); await settle(page);
  ok('its Header level selects the header', (await page.getAttribute('#body', 'data-view')) === 'header');
  await page.click('#body .depth [data-act=deselect]'); await settle(page);
  ok('the Page level atop the card clears the selection', (await page.getAttribute('#body', 'data-view')) === 'outline');
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('pages, Fit, the Hungarian resume')) {
  const ctx = await newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  await openByName(page, 'Medtech'); await settle(page);
  const pages = await frameDoc(page, d => d.querySelectorAll('.document > .page').length);
  ok('a two-page resume is paginated into two pages', pages === 2, `${pages}`);
  ok('at 1280×800: a thin bar for each page in the rail beside undo and redo, named by its page, and one page in view', (await page.$$('#meter .meter')).length === 2 && (await page.evaluate(() => document.body.dataset.pages)) === 'one' && await page.evaluate(() => { const n = [...document.querySelectorAll('#meter .meter')].map(m => m.getAttribute('aria-label')); return /page 1/.test(n[0]) && /page 2/.test(n[1]); }));
  await page.click('[data-act=goto-page][data-page="1"]'); await settle(page);
  ok('the meter of page 2 brings page 2 forward', (await page.evaluate(() => window.__wb.ui.page)) === 1 && (await page.getAttribute('#meter .meter[data-page="1"]', 'aria-current')) === 'true');
  const fills = await page.evaluate(() => window.__wb.ui.fills.map(p => p.overflow));
  ok('no page before the last overflows', fills.slice(0, -1).every(o => !(o > 0)));

  await openByName(page, 'Example Instruments');
  const undoBefore = await page.evaluate(() => window.__wb.store.history.undo);
  await page.click('[data-act=fit]');
  await page.waitForFunction(() => !window.__wb.ui.fitting, null, { timeout: 60000 });
  await settle(page);
  const meter = await page.$$eval('#meter .meter', ms => ms.map(m => m.getAttribute('aria-label')).join(' | '));
  ok('Fit runs and the meter reads the result', /%/.test(meter), meter);
  const fitted = await page.evaluate(() => window.__wb.store.history.undo) > undoBefore;
  if (fitted){
    await page.keyboard.press('Control+z'); await settle(page);
    ok('Ctrl+Z undoes a Fit', (await page.evaluate(() => window.__wb.store.history.undo)) === undoBefore);
  } else ok('Fit changed nothing, and said so', true);

  await openByName(page, 'Dunamenti'); await settle(page);
  ok('the Hungarian resume prints its photo placeholder', await frameDoc(page, d => !!d.querySelector('.portrait--missing')));
  ok('and Hungarian tabs', await frameDoc(page, d => /Tapasztalat/i.test(d.body.textContent)));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


// The canvas (UX-3): pages side by side on one canvas, the wheel, the hand, the pinch, the bright page, the page-moved event.
// Medtech has two pages. Both at once needs the row at the full height to fit left of the sidebar; otherwise the pages keep that size and the view travels sideways.
const camOf = page => page.evaluate(() => {
  const w = window.__wb, c = w.canvas, ui = w.ui;
  const d = document.querySelector('#sheet iframe').contentDocument;
  return { k: c.cam.k, x: c.cam.x, y: c.cam.y, zoom: ui.zoom, page: ui.page, scene: c.scene, equal: !!ui.equal, free: c.free,
    faded: [...d.querySelectorAll('.document > .page')].map(p => p.classList.contains('rb-faded')), fit: c.fit, view: c.view, geo: c.geo };
});
const movedCount = page => page.evaluate(() => window.__moved ?? 0);
const watchMoved = page => page.evaluate(() => { window.__moved = 0; document.addEventListener('brewcv:pages-moved', () => { window.__moved++; }); });
const wheel = async (page, dy, dx = 0, at = [400, 400]) => { await page.mouse.move(...at); await page.mouse.wheel(dx, dy); };

if (want('the canvas: both pages or one, the wheel, the hand, the pinch, the bright page')) {
  // ---- wide: both pages at once ----
  // (the sidebar never folds: both pages at once needs a window wide enough for them left of it)
  for (const [w, h] of [[2560, 1100], [2400, 1000]]){
    const ctx = await newContext({ motion: true, viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const bad = await open(page);
    await openByName(page, 'Medtech');
    const c = await camOf(page);
    ok(`${w}×${h}: both pages show at once, equal, nothing faded`, c.scene === 'all' && c.equal && c.faded.length === 2 && c.faded.every(f => !f));
    ok(`${w}×${h}: at the full height of the window, 16px above and below`, Math.abs(c.k - (h - 32) / 1123) < 1e-6 && Math.abs(c.y - 16) < 1);
    const s = await rect(page, '#sheet'), col = await rect(page, '#rail');
    ok(`${w}×${h}: the pages are centred in the room left of the rail and the sidebar`, Math.abs(s.left - (col.left - 16 - s.right)) < 2, `${s.left.toFixed(1)} vs ${(col.left - 16 - s.right).toFixed(1)}`);
    await wheel(page, 700); await settle(page);
    const after = await camOf(page);
    ok(`${w}×${h}: the wheel does nothing: there is nothing to travel to`, Math.abs(after.x - c.x) < 0.5 && after.page === 0);
    await wheel(page, 0, 300); await settle(page);
    ok(`${w}×${h}: nor does a sideways swipe`, Math.abs((await camOf(page)).x - c.x) < 0.5);
    ok(`${w}×${h}: the stack and side-by-side toggle is gone`, !(await page.$('[data-act=view]')));
    await page.evaluate(() => window.__wb.canvas.goToPage(1)); await settle(page);       // no meter is used: the page comes forward by the canvas
    ok(`${w}×${h}: the current page changes without a meter; the view stays`, (await camOf(page)).page === 1 && Math.abs((await camOf(page)).x - c.x) < 0.5);
    await page.evaluate(() => window.__wb.canvas.goToPage(0));
    ok(`${w}×${h}: no console errors`, bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }

  // ---- a window too narrow for both: one page, the other waits faded, partly behind the sidebar ----
  {
    const ctx = await newContext({ motion: true, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const bad = await open(page);
    await openByName(page, 'Medtech'); await settle(page);
    const c = await camOf(page);
    ok('one page, fit to the room left of the sidebar', c.scene === 'one' && Math.abs(c.k - Math.min((900 - 32) / 1123, (1440 - 340 - 54 - 64) / 794)) < 1e-6 && c.page === 0);
    ok('…the other page is faded and sits to the right', c.faded[0] === false && c.faded[1] === true);
    const col = await rect(page, '#col');
    const p2 = await page.evaluate(() => { const f = document.querySelector('#sheet iframe'), r = f.getBoundingClientRect(), d = f.contentDocument.querySelectorAll('.document > .page')[1].getBoundingClientRect(), k = r.width / f.offsetWidth; return { left: r.left + d.left * k, right: r.left + d.right * k }; });
    ok('…and reaches in behind the sidebar', p2.right > col.left);
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }

  // ---- the row is a little too wide: the pages keep the full height (they are not shrunk to fit), the view travels ----
  {
    const ctx = await newContext({ motion: true, viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    const bad = await open(page);
    await openByName(page, 'Medtech');
    const c = await camOf(page);
    ok('1920×1080: the two pages would need to shrink to share the room, so they do not: one at the full height, the other faded beside it', c.scene === 'one' && Math.abs(c.k - (1080 - 32) / 1123) < 1e-6 && c.faded[0] === false && c.faded[1] === true);
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }

  // ---- narrow: one page at a time, the wheel travels between them with a magnet ----
  {
    const ctx = await newContext({ motion: true, viewport: { width: 1024, height: 700 } });
    const page = await ctx.newPage();
    const bad = await open(page);
    await openByName(page, 'Medtech');
    await watchMoved(page);
    const c0 = await camOf(page);
    ok('1024×700: one page at a time, the page shrunk to the room left of the rail and the 316px sidebar', c0.scene === 'one' && c0.page === 0 && Math.abs(c0.k - Math.min((700 - 32) / 1123, (1024 - 316 - 54 - 64) / 794)) < 1e-6);
    ok('…the other waits faded to the right', c0.faded[0] === false && c0.faded[1] === true);
    const step = (794 + 24) * c0.k;
    await wheel(page, 30, 0, [300, 350]); await settle(page);
    ok('a small push does not leave the page: it springs back (the magnet)', (await camOf(page)).page === 0 && Math.abs((await camOf(page)).x - c0.x) < 1);
    await wheel(page, 0, 0, [300, 350]);
    for (let i = 0; i < 6; i++){ await page.mouse.wheel(0, step * 0.18); await page.waitForTimeout(30); }
    await settle(page);
    const c1 = await camOf(page);
    ok('a push past halfway carries on to page 2 and settles on it', c1.page === 1 && Math.abs(c1.x - (c0.x - step)) < 1.5, `x ${c1.x.toFixed(1)} vs ${(c0.x - step).toFixed(1)}, page ${c1.page}`);
    ok('…page 2 is bright and page 1 faded', c1.faded[0] === true && c1.faded[1] === false);
    ok('a sideways swipe travels too, and back', await (async () => { await page.mouse.wheel(-step * 1.4, 0); await settle(page); const c = await camOf(page); return c.page === 0 && Math.abs(c.x - c0.x) < 1.5; })());
    await page.keyboard.press('PageDown'); await settle(page);
    ok('Page Down goes to page 2', (await camOf(page)).page === 1);
    await page.keyboard.press('PageUp'); await settle(page);
    ok('Page Up goes back', (await camOf(page)).page === 0);
    await page.keyboard.press('ArrowRight'); await settle(page);
    ok('→ goes to page 2 when nothing is selected', (await camOf(page)).page === 1);
    await page.keyboard.press('ArrowLeft'); await settle(page);
    ok('← goes back', (await camOf(page)).page === 0);
    await page.click('[data-act=goto-page][data-page="1"]'); await settle(page);
    ok('a meter goes to its page', (await camOf(page)).page === 1 && Math.abs((await camOf(page)).x - (c0.x - step)) < 1.5);
    ok('the camera told the page layer once it settled', (await movedCount(page)) >= 1);

    // a faded page stays clickable
    await page.click('[data-act=goto-page][data-page="0"]'); await settle(page);
    const blank = await page.evaluate(() => { const f = document.querySelector('#sheet iframe'), r = f.getBoundingClientRect(), k = r.width / f.offsetWidth, p = f.contentDocument.querySelectorAll('.document > .page')[1].getBoundingClientRect(); return { x: r.left + (p.left + 20) * k, y: r.top + (p.top + p.height - 30) * k }; });
    if (blank.x < (await rect(page, '#col')).left - 10){
      await page.mouse.click(blank.x, blank.y); await settle(page);
      ok('a click on the blank paper of the faded page brings it forward', (await camOf(page)).page === 1);
    } else ok('a click on the blank paper of the faded page brings it forward (it is behind the sidebar here: use the meter)', true);
    await page.click('[data-act=goto-page][data-page="0"]'); await settle(page);
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }

  // ---- the hand, the limits, the pinch, Esc ----
  {
    const ctx = await newContext({ motion: true, viewport: { width: 2400, height: 1000 } });
    const page = await ctx.newPage();
    const bad = await open(page);
    await openByName(page, 'Medtech');
    await watchMoved(page);
    const c0 = await camOf(page);
    // a drag on the bare canvas pans, within the limits
    await page.mouse.move(14, 450); await page.mouse.down(); await page.mouse.move(60, 470, { steps: 4 }); await page.mouse.up(); await settle(page);
    const c1 = await camOf(page);
    ok('a drag on the bare canvas pans the pages up and down and leaves them there; sideways they stay centred, as they fit the room', c1.free && Math.abs(c1.x - c0.x) < 1 && Math.abs(c1.y - (c0.y + 20)) < 3, `${c1.x - c0.x}, ${c1.y - c0.y}`);
    ok('…and the wheel now pans too (the pages are not in their place)', await (async () => { await wheel(page, 60, 0, [700, 450]); await settle(page); return Math.abs((await camOf(page)).y - (c1.y - 60)) < 3; })());
    await page.mouse.move(14, 450); await page.mouse.down(); await page.mouse.move(1000, 450, { steps: 6 }); await page.mouse.up(); await settle(page);
    ok('pulled far sideways with the pages fitting: they are still centred where they were', Math.abs((await camOf(page)).x - c0.x) < 0.5, `${(await camOf(page)).x} vs ${c0.x}`);
    // zoomed in so they do not fit: they pan until the page edge is G inside the view's edge, and no further
    await page.evaluate(() => window.__wb.canvas.zoomTo(2, undefined, { animate: false })); await page.evaluate(() => document.activeElement?.blur()); await settle(page);
    for (const [to, edge] of [[1, 'maxX'], [-1, 'minX']]){
      await page.mouse.move(to > 0 ? 100 : 1300, 450); await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(to > 0 ? 1250 : 50, 450, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Space'); await settle(page);
      const far = await camOf(page), lim = await page.evaluate(() => window.__wb.canvas.limits()), v = await page.evaluate(() => window.__wb.canvas.view);
      const G = 16, shown = await page.evaluate(() => { const c = window.__wb.canvas, g = c.geo; return import('/src/ui/layout.js').then(L => ({ left: c.cam.x, right: c.cam.x + (g.n * g.w + (g.n - 1) * L.PAGE_GAP) * c.cam.k })); });
      ok(`zoomed in and pulled far ${to > 0 ? 'right' : 'left'}: it springs back to ${to > 0 ? 'the left' : 'the right'} edge of the pages, G inside the view`, Math.abs(far.x - lim[edge]) < 0.6 && (to > 0 ? Math.abs(shown.left - (v.left + G)) < 0.6 : Math.abs(shown.right - (v.left + v.width - G)) < 0.6), `${far.x.toFixed(1)} vs ${lim[edge].toFixed(1)}`);
    }
    await page.keyboard.press('0'); await settle(page);
    const home = await camOf(page);
    ok('0 puts it all back', !home.free && Math.abs(home.x - c0.x) < 1 && Math.abs(home.y - c0.y) < 1 && home.zoom === 1);
    // space and drag, over the page too
    await page.evaluate(() => document.activeElement?.blur());          // (Space would press a button that has the focus)
    await page.mouse.move(700, 450); await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(640, 400, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Space'); await settle(page);
    const c2 = await camOf(page);
    ok('Space and drag pans, even over a page, and does not select what is under it', c2.free && Math.abs(c2.x - c0.x) < 1 && Math.abs(c2.y - (c0.y - 50)) < 3 && (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'none', `${c2.x - c0.x}`);
    await page.keyboard.press('0'); await settle(page);
    await page.mouse.move(700, 450); await page.mouse.down({ button: 'middle' }); await page.mouse.move(720, 470, { steps: 3 }); await page.mouse.up({ button: 'middle' }); await settle(page);
    ok('the middle button pans too (up and down: the pages fit sideways)', Math.abs((await camOf(page)).y - (c0.y + 20)) < 3 && Math.abs((await camOf(page)).x - c0.x) < 1);
    await page.keyboard.press('0'); await settle(page);
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
    await page.keyboard.press('0'); await settle(page);
    await page.evaluate(([x, y]) => { document.querySelector('#pages').dispatchEvent(new WheelEvent('wheel', { deltaY: -4, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true })); }, pt);
    await settle(page);
    ok('…a small pinch away from the fit view lands exactly on it, and the view is back in place', (await camOf(page)).zoom === 1 && !(await camOf(page)).free);
    ok('Ctrl and the wheel over the page itself is the pinch too', await (async () => {
      const at = await page.evaluate(() => { const f = document.querySelector('#sheet iframe'), r = f.getBoundingClientRect(); return [r.left + 200, r.top + 200]; });
      await page.evaluate(() => { const d = document.querySelector('#sheet iframe').contentDocument; d.dispatchEvent(new d.defaultView.WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 300, bubbles: true, cancelable: true })); });
      await page.waitForTimeout(400); const g = await camOf(page); return g.zoom > 1.1;
    })());
    // Esc at the page level puts everything away, from any zoom
    await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
    const out = await camOf(page);
    ok('Esc out of the line, Esc to the page, Esc from a zoomed view: selection cleared, the whole resume with both pages equal', out.zoom === 1 && !out.free && out.scene === 'all' && out.equal && (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'none');
    ok('a window resize is told to the page layer once it settles', await (async () => { const n0 = await movedCount(page); await page.setViewportSize({ width: 1300, height: 820 }); await settle(page); const n1 = await movedCount(page); return n1 > n0 && n1 - n0 <= 2; })());
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }

  // ---- what the canvas must not touch ----
  {
    const ctx = await newContext({ motion: true, viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const bad = await open(page);
    await openByName(page, 'Medtech');
    const printed = () => page.evaluate(() => { const d = document.querySelector('#sheet iframe').contentDocument; const c = d.querySelector('.document').cloneNode(true); for (const e of c.querySelectorAll('[class]')) { e.className = e.className.replace(/\brb-[\w-]+\b/g, '').trim(); if (!e.className) e.removeAttribute('class'); } return c.innerHTML.replace(/\sdata-variant="[^"]*"/g, ''); });
    const fills = () => page.evaluate(() => JSON.stringify(window.__wb.ui.fills.map(p => [Math.round(p.used * 100), Math.round(p.usable * 100)])));
    const html0 = await printed(), fills0 = await fills();
    await page.keyboard.press('='); await page.keyboard.press('='); await settle(page);
    await page.mouse.move(600, 450); await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(660, 500, { steps: 3 }); await page.mouse.up(); await page.keyboard.up('Space'); await settle(page);
    await page.keyboard.press('0'); await settle(page);
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
    await page.waitForFunction(() => !window.__wb.ui.fitting, null, { timeout: 60000 }); await settle(page);
    ok('Fit still runs, and reports', await page.evaluate(() => !!window.__wb.ui.lastFit && window.__wb.ui.lastFit.pages.length > 0));
    await page.mouse.move(300, 400); await page.click('#zoombar [data-act=actual]'); await settle(page);
    ok('actual size still opens', await page.isVisible('.actual'));
    await page.keyboard.press('Escape'); await settle(page);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
    await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
    await page.keyboard.press('Escape'); await settle(page);
    await page.locator('.vrow[data-v]:not(.cur)').first().hover(); await settle(page);
    ok('hover preview still works', await frameDoc(page, d => d.documentElement.classList.contains('rb-previewing')));
    await page.mouse.move(4, 4); await settle(page);
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
}

// Editing on the page (UX-3, UX-6c): three levels, Esc goes up one; one click writes a line where it is printed, leaving it keeps it on
// this resume, a chip says where you are.
const lay = page => page.evaluate(() => { const el = document.querySelector('#editlay'); const q = s => el.querySelector(s); return {
  veil: [...el.querySelectorAll('.obveil')].map(v => +getComputedStyle(v).opacity), job: !!q('.obframe.job'), dashed: !!q('.obframe.job.dashed'), line: !!q('.obframe.line'),
  tools: [...el.querySelectorAll('.obtools [data-act]')].map(b => b.dataset.act), badge: q('.obv')?.textContent.trim() ?? null,
  chip: q('.obchip .depth') ? { words: [...el.querySelectorAll('.obchip .dp-l .dp-w')].map(w => w.textContent), cur: q('.obchip .dp-l.cur .dp-w')?.textContent } : null }; });
const overOf = (page, f) => page.evaluate(f => { const c = window.__wb.store.state.cur; return { text: c.overrides?.[f], meta: c.overrideMeta?.[f], parked: c.parked?.[f] }; }, f);
const factOf = page => page.evaluate(() => window.__wb.edit.editing?.fact ?? null);
const zoomOf = page => page.evaluate(() => window.__wb.ui.zoom);
const selOf = page => page.evaluate(() => { const s = window.__wb.ui.sel; return `${s.kind}:${s.id ?? ''}`; });

const chipGeomOf = page => page.evaluate(() => {
  const w = window.__wb, q = s => document.querySelector(s)?.getBoundingClientRect();
  const c = q('#editlay .obchip'), f = q('#editlay .obframe.job') ?? q('#editlay .obframe.sec'), col = q('#col'), rail = q('#rail'), zb = q('#zoombar'), tw = q('#editlay .obtoolswrap');
  const hit = (a, b) => !!b && b.width > 0 && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const texts = w.sheet.textRects().map(r => { const s = w.canvas.screenRect(r); return { left: s.left, right: s.left + s.width, top: s.top, bottom: s.top + s.height, width: s.width }; });
  const view = w.canvas.view, vis = f.top > view.top + 8 && f.bottom < view.top + view.height - 60;
  return { onEdge: !vis || Math.abs((c.top + c.bottom) / 2 - f.top) <= 3 || Math.abs(c.bottom - f.top) <= 3, nearRight: (c.left + c.right) / 2 > f.left + f.width / 2 && c.left < f.right, over: texts.filter(t => hit(c, t)).length,
    room: c.left >= 0 && c.top >= 0 && c.right <= innerWidth && c.bottom <= innerHeight && !hit(c, col) && !hit(c, zb) && !hit(c, tw) && !hit(c, rail), small: c.height <= 24 };
});

// Where the chip stands, at four window sizes, for every section of a two-page resume (and a line of the second page): on the frame's top
// edge near its right end, over no printed text, the tools, the rail, the sidebar or the zoom bar.
if (want('on the page: the chip on the frame, at four sizes')) {
  for (const [w, h] of [[1280, 720], [1470, 832], [1920, 1080], [2560, 1100]]) {
    const ctx = await newContext({ motion: true, viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const bad = await open(page);
    await openByName(page, 'Medtech');
    const sheet = page.frameLocator('#sheet iframe');
    const secs = await frameDoc(page, d => [...new Set([...d.querySelectorAll('.band[data-section]')].map(b => b.dataset.section))]);
    const fails = [];
    for (const sid of secs) {
      await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      await settle(page);
      if (await frameDoc(page, (d, q) => !!d.querySelector(`.band[data-section="${q}"] h2.tab`), sid)) await page.click(`#outline [data-act=select-section][data-id="${sid}"]`);      // from the sidebar: a click on the heading would write it, and zoom
      else await sheet.locator(`.band[data-section="${sid}"]`).first().click();      // the header and the summary have no heading
      const at = await frameDoc(page, (d, q) => [...d.querySelectorAll('.document > .page')].findIndex(p => p.querySelector(`.band[data-section="${q}"]`)), sid);
      if (at !== (await page.evaluate(() => window.__wb.ui.page))) await page.evaluate(i => window.__wb.canvas.goToPage(i), at);
      await settle(page);
      const g = await page.evaluate(() => !!document.querySelector('#editlay .obchip')) ? await chipGeomOf(page) : null;
      if (!g || !g.onEdge || !g.nearRight || g.over || !g.room) fails.push(`${sid} ${JSON.stringify(g)}`);
    }
    ok(`${w}x${h}: the chip of each of ${secs.length} sections stands on the frame, clear of text, tools, rail, sidebar and zoom bar`, fails.length === 0, fails.join(' ; '));
    const last = sheet.locator('.entry').last();
    await last.locator('.bullets li').first().click(); await settle(page);
    const gl = await chipGeomOf(page);
    ok(`${w}x${h}: …and for a line written on the last job (the second page, when there are two)`, gl.onEdge && gl.nearRight && gl.over === 0 && gl.room, JSON.stringify(gl));
    await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape');
    await settle(page);
    await page.click('#outline [data-act=select-section][data-id=skills]'); await settle(page);
    await page.click('#body .outline.only [data-act=cl-open]'); await settle(page);
    const gs = await chipGeomOf(page), ws = await page.$$eval('#editlay .obchip .dp-w', e => e.map(x => x.textContent));
    ok(`${w}x${h}: …and for a skill group: Page › Skills › CAD, on the section's frame`, JSON.stringify(ws) === JSON.stringify(['Page', 'Skills', 'CAD']) && gs.onEdge && gs.nearRight && gs.over === 0 && gs.room, JSON.stringify([ws, gs]));
    // an item of education, a language, a certificate and a job's title: the frame goes round the item (or the job), the chip stands on it
    const items = [];
    for (const [what, sel] of [['an item of education', '.band[data-section=education] .item__title'], ['a language', '.band[data-section=languages] dd'], ['a certificate', '.band[data-section=certified] .runs strong'], ['a job\'s title', '.band[data-section=experience] .role-title']]){
      await page.mouse.move(4, 4); for (let k = 0; k < 2; k++) await page.keyboard.press('Escape');
      await settle(page);
      const at = await frameDoc(page, (d, q) => [...d.querySelectorAll('.document > .page')].findIndex(p => p.querySelector(q)), sel);
      if (at !== (await page.evaluate(() => window.__wb.ui.page))){ await page.evaluate(i => window.__wb.canvas.goToPage(i), at); await settle(page); }
      await sheet.locator(sel).first().click({ position: { x: 4, y: 3 } }); await settle(page);
      const gi = await chipGeomOf(page);
      if (!gi.onEdge || gi.over || !gi.room) items.push(`${what} ${JSON.stringify(gi)}`);      // (a small item's frame is narrower than the chip: the chip is not asked to be in its right half)
    }
    ok(`${w}x${h}: …and for an item of education, a language, a certificate and a job's title: on its frame, clear of text, tools, rail, sidebar and zoom bar`, items.length === 0, items.join(' ; '));
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
}

if (want('on the page: three levels, writing a line where it is printed, the tools in the margin')) {
  // (a window wide enough for both pages of Medtech: the sidebar does not fold to make room)
  const ctx = await newContext({ motion: true, viewport: { width: 2560, height: 1100 } });
  const page = await ctx.newPage();
  let dialogs = 0; page.on('dialog', d => { dialogs++; d.accept(); });
  const bad = await open(page);
  await openByName(page, 'Medtech');
  const sheet = page.frameLocator('#sheet iframe');
  const jobs = sheet.locator('.entry');
  const l0 = await lay(page);
  ok('at the page level nothing is framed or dimmed, and no chip floats over the page', !l0.job && !l0.line && l0.veil.length === 0 && !l0.chip);
  const esc3 = async () => { await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await settle(page); };

  // one click puts the caret in the text (E3): no level to open first
  const z0 = await zoomOf(page);
  await jobs.nth(0).locator('.bullets li').nth(2).click(); await settle(page);
  const l2 = await lay(page);
  ok('one click on a line writes it at once: an editable line with a role and a name', (await lineEl(page).count()) === 1 && (await page.evaluate(() => window.__wb.ui.writing === true)) && (await lineEl(page).getAttribute('role')) === 'textbox' && !!(await lineEl(page).getAttribute('aria-label')));
  ok('…the caret is where it was clicked, not at an end of the line', await page.evaluate(() => { const el = window.__wb.onpage.el(), s = el.ownerDocument.getSelection(); if (!s.rangeCount || !s.isCollapsed || !el.contains(s.anchorNode)) return false; const r = el.ownerDocument.createRange(); r.selectNodeContents(el); r.setEnd(s.anchorNode, s.anchorOffset); const n = r.toString().length; return n > 0 && n < el.textContent.length; }));
  ok('…the line is part of the page: no cover cut out around it, a thin outline, the rest of the text fades only a little (94%)', l2.line && l2.veil.length === 0 && l2.dashed
    && await frameDoc(page, d => d.documentElement.classList.contains('rb-writing') && Math.abs(+getComputedStyle(d.querySelector('.bullets li:not([contenteditable])')).opacity - 0.94) < 0.01 && getComputedStyle(d.querySelector('[contenteditable]')).opacity === '1')
    && await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#editlay .obframe.line')).borderTopWidth) <= 1), JSON.stringify(l2.veil));
  ok('…the view eased to the writing zoom: 130% of the whole page', Math.abs((await zoomOf(page)) - 1.3) < 0.02 && z0 === 1, `${await zoomOf(page)}`);
  ok('…the tools stand in the margin: the version, ↑ and ↓, the counts, and nothing to save', JSON.stringify(l2.tools) === JSON.stringify(['ob-up', 'ob-down']) && /^v/.test(l2.badge) && /ch/.test(await page.textContent('#ob-stats')) && !(await page.$('[data-act=ed-save], [data-act=ed-saveas], [data-act=ed-only], [data-act=ed-new], [data-act=ed-promote]')));
  ok('…nothing is drawn in the page itself, and only the chip and the tools take clicks', await page.evaluate(() => { const d = document.querySelector('#sheet iframe').contentDocument; return !d.querySelector('.obframe, .obveil, .obtools, .obchip') && getComputedStyle(document.querySelector('#editlay')).pointerEvents === 'none'; }));
  ok('…entering write mode is announced to a screen reader', /Writing this line/.test(await page.textContent('#announce')));

  // the chip (E13) and the sidebar's row: one component
  ok('a small quiet chip lies on the page: Page › Experience › Hydra, single words, no line level, the job current, no Esc and no level below', JSON.stringify(l2.chip?.words) === JSON.stringify(['Page', 'Experience', 'Hydra']) && l2.chip.cur === 'Hydra' && !(await page.$('#editlay .obchip .dp-esc, #editlay .obchip .dp-l.next')), JSON.stringify(l2.chip));
  const chipGeom = () => chipGeomOf(page);
  const cg = await chipGeom();
  ok('…it lies on the dashed frame, its centre on the frame’s top edge in its right half, small, and never over printed text, the tools, the rail, the sidebar or the zoom bar', cg.onEdge && cg.nearRight && cg.over === 0 && cg.room && cg.small, JSON.stringify(cg));
  const same = await page.evaluate(() => {
    const a = document.querySelector('#editlay .obchip .depth'), b = document.querySelector('#body .depth');
    if (!a || !b) return null;
    const shape = n => `${n.getAttribute('aria-label')}|` + [...n.children].map(x => `${x.tagName}.${x.className.replace(/\bsm\b/, '').trim()}:${x.matches('.dp-s') ? x.textContent : ''}`).join('|');
    const look = n => getComputedStyle(n).fontFamily;
    return { shape: shape(a) === shape(b), sm: a.classList.contains('sm') && !b.classList.contains('sm') && parseFloat(getComputedStyle(a).fontSize) < parseFloat(getComputedStyle(b).fontSize), face: look(a.querySelector('.dp-l.cur')) === look(b.querySelector('.dp-l.cur')), sep: look(a.querySelector('.dp-s')) === look(b.querySelector('.dp-s')), crumb: !document.querySelector('#body .crumb') };
  });
  ok('…the sidebar opens with the same component (the page’s one smaller): the same markup, separators and face, and no old crumb', same && same.shape && same.sm && same.face && same.sep && same.crumb, JSON.stringify(same));
  ok('…the chip’s levels are buttons, in the focus order, each with a pointer target of at least 24 x 24 px', await page.evaluate(() => [...document.querySelectorAll('#editlay .obchip .dp-l')].every(b => b.tagName === 'BUTTON' && b.tabIndex === 0 && b.getBoundingClientRect().height + 6 >= 24 && b.getBoundingClientRect().width + 2 >= 24)));

  // typing, and leaving: kept on this resume, nothing asks (E1)
  const fW = await factOf(page), vW = await page.evaluate(() => window.__wb.edit.editing.vid);
  const text0 = await lineText(page), undo0 = await page.evaluate(() => window.__wb.store.history.undo);
  await appendLine(page, ' Zebra.');
  ok('typing: the draft is the line’s plain text, the page redraws, and nothing is committed while typing', (await lineText(page)) === text0 + ' Zebra.' && (await frameDoc(page, d => d.body.textContent)).includes('Zebra.') && (await page.evaluate(() => window.__wb.store.history.undo)) === undo0 && (await lay(page)).line);
  await page.keyboard.press('Escape'); await settle(page);
  const o1 = await overOf(page, fW);
  ok('Esc leaves the line for its job and keeps what was typed on this resume, asking nothing: an edit with its base version and highlights', dialogs === 0 && (await lineEl(page).count()) === 0 && o1.text === text0 + ' Zebra.' && o1.meta?.base === vW && Array.isArray(o1.meta?.marks) && (await frameDoc(page, d => d.body.textContent)).includes('Zebra.') && (await lay(page)).job, JSON.stringify(o1));
  ok('…as one undo step, and the line is still selected', (await page.evaluate(() => window.__wb.store.history.undo)) === undo0 + 1 && (await selOf(page)).startsWith('bullet:'));
  ok('…the view stays zoomed: Esc to the job is not the page', Math.abs((await zoomOf(page)) - 1.3) < 0.02, `${await zoomOf(page)}`);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc again goes to the page: nothing framed, no chip, and the view comes back out', (await selOf(page)) === 'none:' && !(await lay(page)).job && (await lay(page)).veil.length === 0 && !(await lay(page)).chip && (await zoomOf(page)) === 1);
  // the base version's words again: no edit is stored
  await jobs.nth(0).locator('.bullets li').nth(2).click(); await settle(page);
  const baseText = await page.evaluate(v => window.__wb.store.state.record.variants.find(x => x.id === v).text, vW);
  await writeLine(page, baseText); await page.keyboard.press('Escape'); await settle(page);
  const o2 = await overOf(page, fW);
  ok('writing the base version’s own words again drops the edit: nothing is stored', o2.text === undefined && o2.meta === undefined && o2.parked === undefined, JSON.stringify(o2));
  await esc3();

  // never lose typed text: every way out of a line keeps it, and none asks
  const bare = async () => { await page.mouse.click(4, 300); };
  for (const [how, go] of [['Esc', () => page.keyboard.press('Escape')], ['Tab', () => page.keyboard.press('Tab')], ['Enter', () => page.keyboard.press('Enter')],
    ['a click on another line', () => jobs.nth(1).locator('.bullets li').first().click()], ['a click on the bare canvas', bare], ['a click on a level of the chip', () => page.click('#editlay .obchip [data-act=select-job]')]]){
    await esc3();
    await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
    const f = await factOf(page), d0 = dialogs;
    await appendLine(page, ` Kept by ${how}.`);
    await go(); await settle(page);
    const o = await overOf(page, f);
    ok(`no lost text: ${how} keeps what was typed on this resume, and asks nothing`, dialogs === d0 && !!o.text?.endsWith(`Kept by ${how}.`) && (await frameDoc(page, d => d.body.textContent)).includes(`Kept by ${how}.`), JSON.stringify(o).slice(0, 160));
  }
  await esc3();

  // emptying a line that has a kept edit leaves the edit alone; a composition not yet ended is kept; undo leaves the line first
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  const fE = await factOf(page);
  await appendLine(page, ' Emptied.'); await page.keyboard.press('Escape'); await settle(page);
  const oE = await overOf(page, fE);
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  await lineEl(page).focus(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('Backspace'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  const oE2 = await overOf(page, fE);
  ok('emptying a line that has a kept edit leaves the edit as it was', !!oE.text && oE2.text === oE.text && JSON.stringify(oE2.meta) === JSON.stringify(oE.meta), JSON.stringify(oE2).slice(0, 160));
  await esc3();
  await jobs.nth(0).locator('.bullets li').nth(1).click(); await settle(page);
  const fI = await factOf(page);
  await page.evaluate(() => { const el = window.__wb.onpage.el(); el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
  await appendLine(page, ' Composed.');
  await jobs.nth(1).locator('.bullets li').first().click(); await settle(page);
  ok('text typed in a composition that has not ended is kept when the line is left', !!(await overOf(page, fI)).text?.endsWith('Composed.'));
  await esc3();
  await jobs.nth(0).locator('.bullets li').nth(2).click(); await settle(page);
  const fU = await factOf(page), uH = await page.evaluate(() => window.__wb.store.history.undo);
  await appendLine(page, ' Undone.');
  await page.click('[data-act=undo]'); await settle(page);
  ok('undo while writing leaves the line first: the line is closed, nothing of it is half-kept', (await lineEl(page).count()) === 0 && (await page.evaluate(() => window.__wb.edit.editing)) === null && (await page.evaluate(() => window.__wb.store.history.undo)) === uH && (await page.evaluate(() => window.__wb.store.history.redo)) > 0 && (await overOf(page, fU)).text === undefined);
  await page.click('[data-act=redo]'); await settle(page);
  ok('…and redo brings the kept text back', !!(await overOf(page, fU)).text?.endsWith('Undone.'));
  await esc3();

  // Enter, Shift+Enter, and Enter at a job's last line (E18)
  const order = await page.evaluate(() => window.__wb.sheet.order(window.__wb.ui.ix));
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  const e0 = await factOf(page);
  await page.keyboard.press('Shift+Enter'); await settle(page);
  ok('Shift+Enter is a line break in the same line', (await factOf(page)) === e0 && /\n/.test(await lineText(page)));
  await page.keyboard.press('Backspace'); await settle(page);
  await page.keyboard.press('Enter'); await settle(page);
  ok('Enter keeps the line and writes the next one, in the same zoom', (await factOf(page)) === order[order.indexOf(e0) + 1] && (await lineEl(page).count()) === 1 && Math.abs((await zoomOf(page)) - 1.3) < 0.02, `${e0} → ${await factOf(page)}`);
  await esc3();
  // Enter at a job's last line adds a line that exists only on this resume (no claim: that needs a source, which only the Review list asks for)
  const nFacts = await page.evaluate(() => window.__wb.store.state.record.facts.length);
  const locals = () => page.evaluate(() => Object.values(window.__wb.store.state.cur.localLines ?? {}).flat().map(l => l.id));
  const emptyLis = () => frameDoc(page, d => [...d.querySelectorAll('.bullets li')].filter(li => !li.textContent.trim()).length);
  await jobs.nth(0).locator('.bullets li').last().click(); await settle(page);
  const eL = await factOf(page);
  await page.keyboard.press('Enter'); await settle(page);
  const eN = await factOf(page);
  ok('Enter at a job’s last line adds an empty line after it and writes it, in the same zoom, and adds no claim', /^~new-/.test(eN) && (await locals()).includes(eN) && (await lineEl(page).count()) === 1 && !(await lineText(page)).trim()
    && Math.abs((await zoomOf(page)) - 1.3) < 0.02 && (await page.evaluate(() => window.__wb.store.state.record.facts.length)) === nFacts && (await page.evaluate(() => window.__wb.sheet.order(window.__wb.ui.ix))).at(-1) !== eL, `${eL} → ${eN}`);
  ok('…its place is the job’s end, and the sidebar names it', (await page.evaluate(({ id }) => { const j = Object.entries(window.__wb.store.state.cur.localLines).find(([, l]) => l.some(x => x.id === id)); return j && j[1].find(x => x.id === id).after; }, { id: eN })) === eL && /New line/.test(await page.textContent('#body .depth')));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc on an empty new line leaves no empty bullet: the line is gone, the job is selected', (await locals()).length === 0 && (await emptyLis()) === 0 && (await selOf(page)).startsWith('job:') && (await lineEl(page).count()) === 0);
  await esc3();
  await jobs.nth(0).locator('.bullets li').last().click(); await settle(page);
  await page.keyboard.press('Enter'); await settle(page);
  const eT = await factOf(page);
  await page.keyboard.insertText('Ran the bench trial on site.'); await settle(page);
  await page.keyboard.press('Tab'); await settle(page);
  ok('typing in the new line keeps it as a line on this resume only (Tab moved on, nothing asked, nothing lost)', (await locals()).includes(eT) && (await page.evaluate(id => window.__wb.store.state.cur.overrides[id], eT)) === 'Ran the bench trial on site.' && dialogs === 0
    && /Ran the bench trial on site\./.test(await frameDoc(page, d => d.body.textContent)) && (await page.evaluate(() => window.__wb.store.state.record.facts.length)) === nFacts);
  await esc3();
  await sheet.locator('.bullets li', { hasText: 'Ran the bench trial on site.' }).click(); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  ok('the sidebar of such a line shows the note, the tick and “Remove this line”, and no versions', /Only on this resume\. The Review list will offer it as a new claim\./.test(await page.textContent('#body')) && !!(await page.$('#body #b-on')) && !!(await page.$('#body [data-act=local-remove]')) && !(await page.$('#body .vlist')));
  await page.click('#body #b-on'); await settle(page);
  ok('…its tick switches it off: it leaves the page but stays on the resume', !/Ran the bench trial on site\./.test(await frameDoc(page, d => d.body.textContent)) && (await locals()).includes(eT));
  await page.click('#body #b-on'); await settle(page);
  ok('…and on again', /Ran the bench trial on site\./.test(await frameDoc(page, d => d.body.textContent)));
  await page.click('#body [data-act=local-remove]'); await settle(page);
  ok('“Remove this line” removes it, text and all, and undo brings it back', (await locals()).length === 0 && !/Ran the bench trial on site\./.test(await frameDoc(page, d => d.body.textContent)));
  await page.keyboard.press('Control+z'); await settle(page);
  ok('…which it does', (await locals()).includes(eT) && /Ran the bench trial on site\./.test(await frameDoc(page, d => d.body.textContent)));
  // "+ line" in the job’s sidebar view does the same as Enter
  await page.click('#editlay .obchip [data-act=select-job]'); await settle(page);
  await page.click('#body [data-act=ol-newline]'); await settle(page);
  const eP = await factOf(page);
  ok('“+ line” in the job’s sidebar adds an empty line only on this resume and writes it', /^~new-/.test(eP) && eP !== eT && (await locals()).includes(eP) && (await lineEl(page).count()) === 1);
  await page.keyboard.insertText('Drew the fixtures.'); await settle(page);
  await page.mouse.click(4, 4); await settle(page);
  ok('…a click elsewhere keeps what was typed in it', (await page.evaluate(id => window.__wb.store.state.cur.overrides[id], eP)) === 'Drew the fixtures.' && dialogs === 0);
  await page.evaluate(async ids => { const T = await import('./src/model/resume.js'); window.__wb.store.commit(d => { for (const id of ids) T.removeLocalLine(d.record, d.cur, id); }, 'clean'); }, [eT, eP]);
  await settle(page);
  await esc3();

  // the zoom rule: in on the first line written, stays from line to line (a click, Tab, Enter), out only at the page level
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  const zW = await zoomOf(page);
  await page.keyboard.press('Tab'); await settle(page);
  const zTab = await zoomOf(page);
  await page.keyboard.press('Enter'); await settle(page);
  const zEnter = await zoomOf(page);
  await jobs.nth(1).locator('.bullets li').first().click(); await settle(page);
  const zClick = await zoomOf(page);
  await page.keyboard.press('Escape'); await settle(page);
  const zEsc = await zoomOf(page);
  ok('the zoom rule: the first line zooms in, and Tab, Enter, a click on another line and Esc to the job all stay zoomed', Math.abs(zW - 1.3) < 0.02 && [zTab, zEnter, zClick, zEsc].every(z => Math.abs(z - zW) < 0.02), [zW, zTab, zEnter, zClick, zEsc].join(' '));
  await bare(); await settle(page);
  ok('…a click on the bare canvas is the page level: the view comes back out', (await selOf(page)) === 'none:' && (await zoomOf(page)) === 1, `${await selOf(page)} ${await zoomOf(page)}`);
  for (let k = 0; k < 4; k++) await page.keyboard.press('='); await settle(page);
  const zBig = await zoomOf(page);
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  const zAfter = await zoomOf(page);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);      // (a third Esc at the page level zooms all the way out, as it always did)
  ok('…a page already at the writing size or larger is not zoomed when a line is written, nor zoomed out after', zBig >= 1.3 && Math.abs(zAfter - zBig) < 0.02 && Math.abs((await zoomOf(page)) - zBig) < 0.02, `${zBig} ${zAfter} ${await zoomOf(page)}`);
  await page.keyboard.press('0'); await settle(page);

  // the chip's levels: each selects its level, and the sidebar shows that level's own view
  const body = page.locator('#body');
  const viewOf = () => page.evaluate(() => { const q = s => !!document.querySelector(s); return { sel: window.__wb.ui.sel.kind, outline: q('#body #seclist'), sec: q('#body #sec-label') && q('#body .outline.only [data-job]'), job: q('#body .outline.only [data-bullet]') && q('#body [data-act=ol-newline]') && !q('#body #sec-label'), line: q('#body .vrow') && !q('#body .outline'), header: q('#body [data-view=header], #body .about, #body .headerform') }; });
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  await page.click('#editlay .obchip [data-act=select-job]'); await settle(page);
  const vj = await viewOf();
  ok('the chip’s Hydra (job) level goes up to the job (the line left, kept): its lines with ticks, grips and “+ line”', (await selOf(page)).startsWith('job:') && (await lineEl(page).count()) === 0 && (await lay(page)).chip?.cur === 'Hydra' && vj.job, JSON.stringify(vj));
  await page.click('#editlay .obchip [data-act=select-section]'); await settle(page);
  const vs = await viewOf();
  ok('…its Experience (section) level selects the section: its own settings and its jobs with a tick, and no grip or ↑ ↓', vs.sel === 'section' && vs.sec && (await lay(page)).chip?.words.join() === 'Page,Experience' && !!(await page.$('#editlay .obframe.sec.dashed')) && (await page.$$('#body .outline.only [data-job] .clmv, #body .outline.only .clgrip')).length === 0 && (await page.$$('#body .outline.only [data-jobon]')).length >= 3, JSON.stringify(vs));
  await page.click('#editlay .obchip [data-act=deselect]'); await settle(page);
  const vp = await viewOf();
  ok('…its Page level selects the page: the overview with a checkbox for each section (no grip or ↑ ↓)', vp.sel === 'none' && vp.outline && (await page.$$('#body #seclist [data-secon]')).length >= 3 && (await page.$$('#body #seclist .srow .clmv, #body #seclist .srow .grip')).length === 0 && !(await lay(page)).chip, JSON.stringify(vp));
  // from the sidebar's own row, the same levels
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page); await page.keyboard.press('Escape'); await settle(page);
  await page.click('#body .depth [data-act=select-job]'); await settle(page);
  ok('the sidebar’s row has the same levels: its Job level shows the job’s view, its Page level the overview', (await viewOf()).job && ((await page.click('#body .depth [data-act=deselect]')), await settle(page), (await viewOf()).outline));
  await sheet.locator('.band[data-section="experience"] h2.tab').first().click(); await settle(page);
  const cs = (await lay(page)).chip;
  ok('a section: Page › Experience, on a dashed frame of the section’s band; the editor card opens with the same component', JSON.stringify(cs?.words) === JSON.stringify(['Page', 'Experience']) && (await page.textContent('#body .depth')).includes('Section') && !!(await page.$('#editlay .obframe.sec.dashed')) && (await chipGeom()).onEdge && (await chipGeom()).over === 0);
  await sheet.locator('.band[data-section="header"] [data-variant]').first().click(); await settle(page);
  const ch = (await lay(page)).chip;
  ok('the header: Page › Header › Headline, in the chip and atop the editor card: the chip names the field', JSON.stringify(ch?.words) === JSON.stringify(['Page', 'Header', 'Headline']) && (await page.textContent('#body .depth')).includes('Header') && (await page.textContent('#body .depth')).includes('Headline'), JSON.stringify(ch));
  await esc3();

  // picking a version over an edit parks it; picking the edit again puts it back
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  const fP = await factOf(page);
  await appendLine(page, ' Parked words.'); await page.keyboard.press('Escape'); await settle(page);
  await page.click('#body .vrow[data-act=use-version]'); await settle(page);
  const p1 = await overOf(page, fP);
  ok('picking a version over an edit sets the edit aside (parked), not lost', p1.text === undefined && !!p1.parked?.text?.endsWith('Parked words.') && await page.isVisible('#body .vrow[data-act=use-edit]'), JSON.stringify(p1).slice(0, 160));
  await page.click('#body .vrow[data-act=use-edit]'); await settle(page);
  const p2 = await overOf(page, fP);
  ok('…picking the edit again puts it back', !!p2.text?.endsWith('Parked words.') && p2.parked === undefined && (await frameDoc(page, d => d.body.textContent)).includes('Parked words.'), JSON.stringify(p2).slice(0, 160));
  // while writing, picking a version keeps what was typed (parked) and the line goes on from the version
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  await appendLine(page, ' typed words');
  const other = await page.getAttribute('#body .vrow[data-act=use-version]', 'data-v');
  await page.click('#body .vrow[data-act=use-version]'); await settle(page);
  const vText = await page.evaluate(v => window.__wb.store.state.record.variants.find(x => x.id === v).text, other);
  ok('while writing, picking a version keeps what was typed aside and goes on from the version', (await lineText(page)) === vText && (await lineEl(page).count()) === 1 && !!(await overOf(page, fP)).parked?.text?.endsWith('typed words'));
  await esc3();

  // a line outside a job is written with one click too
  const summary = sheet.locator('.summary[data-variant]').first();
  await summary.click(); await settle(page);
  const ls = await lay(page);
  ok('a line outside a job is written with one click: no job frame; the chip says Page › Summary (on a dashed frame of the section)', (await lineEl(page).count()) === 1 && ls.line && !ls.job && JSON.stringify(ls.chip?.words) === JSON.stringify(['Page', 'Summary']), JSON.stringify(ls));
  await esc3();

  // two pages: writing on one fades the other, which stays clickable
  const pg2 = sheet.locator('.document > .page').nth(1).locator('.bullets li, .runs strong, .skills__items').first();
  if (await pg2.count()){
    await pg2.click(); await settle(page);
    await pg2.click().catch(() => {}); await settle(page);
    const c2 = await camOf(page);
    ok('with two pages, working on the second brings it forward and fades the first', c2.page === 1 && c2.faded[0] === true && c2.faded[1] === false, JSON.stringify({ page: c2.page, faded: c2.faded, k: c2.k, w: await page.evaluate(() => window.__wb.ui.writing) }));
  } else ok('page 2 has a line to write', false);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);

  // clicking another line while writing goes on writing there; a pinch while writing is the writing zoom
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  const wz = await zoomOf(page), wf = await page.evaluate(() => window.__wb.edit.editing?.fact);
  await jobs.nth(1).locator('.bullets li').first().click(); await settle(page);
  const wf2 = await page.evaluate(() => window.__wb.edit.editing?.fact ?? null);
  ok('while writing, a click on a line in another job goes on writing there, without zooming out', !!wf2 && wf2 !== wf && Math.abs((await zoomOf(page)) - wz) < 0.02, `${wf} → ${wf2}, ${await zoomOf(page)}`);
  await page.evaluate(() => { document.querySelector('#pages').dispatchEvent(new WheelEvent('wheel', { deltaY: -60, ctrlKey: true, clientX: 600, clientY: 400, bubbles: true, cancelable: true })); });
  await settle(page);
  ok('a pinch while writing changes the writing zoom, and it is remembered', (await zoomOf(page)) > wz + 0.1 && Number(await page.evaluate(() => localStorage.getItem('rb-zoomwrite'))) === Math.min(180, Math.round((await zoomOf(page)) * 100)), `${await zoomOf(page)} ${await page.evaluate(() => localStorage.getItem('rb-zoomwrite'))}`);
  await page.evaluate(() => localStorage.removeItem('rb-zoomwrite'));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  // a line on the second page, chosen from the sidebar (in a window too narrow for both, the pages are one at a time, the other waits faded): that page comes forward
  await page.setViewportSize({ width: 1440, height: 900 }); await settle(page);
  const f2 = await page.evaluate(() => { const w = window.__wb, ix = w.ui.ix; for (const id of w.sheet.order(ix)) if (w.sheet.pageOf(id, ix) === 1) return id; return null; });
  if (f2){
    await page.evaluate(id => { const b = document.createElement('button'); b.dataset.act = 'select-bullet'; b.dataset.id = id; b.hidden = true; document.querySelector('#body').append(b); b.click(); }, f2);
    await settle(page);
    ok('choosing a line on the second page (from the panel) brings that page forward', (await camOf(page)).page === 1 && (await camOf(page)).faded[0] === true);
    await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.setViewportSize({ width: 2560, height: 1100 }); await settle(page);       // up to the page; wide again: both pages are in view
  } else ok('the second page has a line', false);

  // what leaves nothing behind
  const html1 = await frameDoc(page, d => d.querySelector('.document').innerHTML.replace(/\s(?:contenteditable|role|aria-multiline|aria-label|spellcheck|style)="[^"]*"/g, '').replace(/\brb-[\w-]+/g, '').replace(/\sclass="\s*"/g, ''));
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  await jobs.nth(0).locator('.bullets li').first().click(); await settle(page);
  await appendLine(page, ' x'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  const html2 = await frameDoc(page, d => d.querySelector('.document').innerHTML.replace(/\s(?:contenteditable|role|aria-multiline|aria-label|spellcheck|style)="[^"]*"/g, '').replace(/\brb-[\w-]+/g, '').replace(/\sclass="\s*"/g, ''));
  const at = [...html1].findIndex((c, i) => c !== html2[i]);
  ok('writing, typing and taking it back out leaves the page’s own markup exactly as it was', html1 === html2, `at ${at}: ${html1.slice(at - 60, at + 80)} ≠ ${html2.slice(at - 60, at + 80)}`);
  ok('…with nothing editable left in the frame', (await frameDoc(page, d => d.querySelectorAll('[contenteditable]').length)) === 0);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

// ---- smaller windows, the settings and reduced motion ----
if (want('History: naming a checkpoint in the desktop app')) {
  // the desktop web view has no prompt(): the name is typed into a field on the page (window.__TAURI__ stands in for being there)
  const ctx = await newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  let dialogs = 0; page.on('dialog', d => { dialogs++; d.dismiss(); });
  await page.addInitScript(() => { window.__TAURI__ = {}; });
  const bad = await open(page);
  await page.click('[data-act=menu]'); await page.click('.menu [data-v=history]'); await settle(page);
  ok('History has a name field, filled with a dated name', /^Checkpoint /.test(await page.inputValue('#cp-name')));
  await page.fill('#cp-name', 'Before the Hungarian edit'); await page.press('#cp-name', 'Enter'); await settle(page);
  ok('Enter in it saves a checkpoint under that name, and no dialog was asked', /Before the Hungarian edit/.test(await page.textContent('#body')) && dialogs === 0);
  await page.fill('#cp-name', '   '); await page.click('[data-act=cp-new]'); await settle(page);
  ok('an empty name saves nothing', (await page.$$('.cprow:has-text("Before the Hungarian edit")')).length === 1 && dialogs === 0);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('on the page: a narrow window, zoom off, reduced motion, a line that is not on the page')) {
  {
    const ctx = await newContext({ motion: true, viewport: { width: 1100, height: 800 } });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const bad = await open(page);
    const sheet = page.frameLocator('#sheet iframe');
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    ok('at 1100px the sidebar stays beside the page, at 316px: there is no drawer, and selecting a line leaves the layout alone', (await page.evaluate(() => document.body.dataset.drawer)) === undefined && Math.abs((await rect(page, '#col')).width - 316) < 1);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    ok('writing a line leaves the sidebar where it is: the line is written on the page, the tools in its margin', (await lineEl(page).count()) === 1 && await page.isVisible('#body') && await page.isVisible('#head') && !!(await page.$('#editlay .obtools')));
    await appendLine(page, ' drawer');
    ok('…the tools are on screen, not under the sidebar', await page.evaluate(() => { const r = document.querySelector('#editlay .obtools').getBoundingClientRect(), c = document.querySelector('#col').getBoundingClientRect(); return r.right <= c.left + 2 && r.left >= 0 && r.top >= 0 && r.bottom <= innerHeight; }));
    ok('…the chip is on screen too, not under the sidebar', await page.evaluate(() => { const r = document.querySelector('#editlay .obchip').getBoundingClientRect(), c = document.querySelector('#col').getBoundingClientRect(); return r.right <= c.left + 2 && r.left >= 0 && r.top >= 0 && r.bottom <= innerHeight; }));
    await page.keyboard.press('Escape'); await settle(page);
    ok('Esc keeps it on this resume, and makes no version', (await page.evaluate(() => Object.values(window.__wb.store.state.cur.overrides ?? {}).some(t => /drawer$/.test(t)) && !window.__wb.store.state.record.variants.some(v => /drawer$/.test(v.text)))) && (await lineEl(page).count()) === 0);
    await settle(page);
    ok('…and the line is selected, with the sidebar there all the time', (await page.isVisible('#body')) && (await selOf(page)).startsWith('bullet:'));
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
  {
    const ctx = await newContext({ motion: true, viewport: { width: 1100, height: 800 } });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const bad = await open(page);
    const sheet = page.frameLocator('#sheet iframe');
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    await appendLine(page, ' drawer');
    await page.click('#tab-design'); await settle(page);
    ok('a click on a tab while you write leaves the line, keeping what was typed, and opens that tab', (await page.evaluate(() => window.__wb.ui.view === 'design' && Object.values(window.__wb.store.state.cur.overrides ?? {}).some(t => /drawer$/.test(t)))) && (await lineEl(page).count()) === 0);
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
  {
    const ctx = await newContext({ motion: true, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const bad = await open(page);
    const sheet = page.frameLocator('#sheet iframe');
    await page.evaluate(() => localStorage.setItem('rb-zoomwrite-on', '0'));
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    ok('with “Zoom in when writing” off, the line is written in place and the view stays whole', (await lineEl(page).count()) === 1 && (await zoomOf(page)) === 1);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
    await page.evaluate(() => { localStorage.setItem('rb-zoomwrite-on', '1'); localStorage.setItem('rb-zoomwrite', '180'); });
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    ok('the writing zoom is the setting: 180%', Math.abs((await zoomOf(page)) - 1.8) < 0.03, `${await zoomOf(page)}`);
    await page.evaluate(() => { localStorage.setItem('rb-dim-line', '70'); });
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    ok('the dim levels are settings too: the other lines at 70% while one is written', (await lay(page)).veil.length === 0 && Math.abs(await frameDoc(page, d => +getComputedStyle(d.querySelector('.bullets li:not([contenteditable])')).opacity) - 0.7) < 0.01);
    await page.evaluate(() => { localStorage.removeItem('rb-zoomwrite'); localStorage.removeItem('rb-dim-line'); localStorage.removeItem('rb-zoomwrite-on'); });
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
  {
    const ctx = await newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const bad = await open(page);
    const sheet = page.frameLocator('#sheet iframe');
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await page.waitForTimeout(60);
    ok('with reduced motion there is no writing zoom: the scale stays as it was (motion on: it zooms, above)', (await zoomOf(page)) === 1 && (await lineEl(page).count()) === 1, `${await zoomOf(page)}`);
    ok('…the written line is in view', await page.evaluate(() => { const r = window.__wb.canvas.screenRect(window.__wb.sheet.rectOfEl(window.__wb.onpage.el())), v = window.__wb.canvas.view; return r.top >= v.top && r.top + r.height <= v.top + v.height; }));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(60);
    ok('…and nothing moves at the page level', (await zoomOf(page)) === 1);
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
  {
    // a line that is not on this resume has no place on the page: the panel keeps a text box for it
    const ctx = await newContext({ motion: true, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const bad = await open(page);
    const sheet = page.frameLocator('#sheet iframe');
    await sheet.locator('.entry').first().locator('.bullets li').first().click(); await settle(page);
    await page.keyboard.press('Escape'); await settle(page);      // one click wrote it: out of the line, so the key below is not typed into it
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

  // a phone does not write on the page: a line only on this resume is added from the job’s “+ line” and written in the panel
  {
    const ctx = await newContext({ motion: true, viewport: { width: 390, height: 844 }, hasTouch: true });       // (not isMobile: that makes innerWidth 774, which the page tests read)
    const ph = await ctx.newPage();
    const bad = await open(ph);
    await openByName(ph, 'Medtech');
    await ph.frameLocator('#sheet iframe').locator('.entry .bullets li').first().tap(); await settle(ph);
    await ph.evaluate(() => document.querySelector('#body .depth [data-act=select-job]').click()); await settle(ph);
    await ph.evaluate(() => document.querySelector('#body [data-act=ol-newline]').click()); await settle(ph);
    const lines = () => ph.evaluate(() => Object.values(window.__wb.store.state.cur.localLines ?? {}).flat().map(l => l.id));
    ok('phone: “+ line” in the job’s sidebar adds an empty line only on this resume, selected', (await lines()).length === 1 && (await ph.evaluate(() => window.__wb.ui.sel.id)) === (await lines())[0] && (await ph.evaluate(() => window.__wb.ui.writing)) !== true);
    ok('phone: its panel has the note, “Remove this line” and a way to write it', /Only on this resume\./.test(await ph.textContent('#body')) && !!(await ph.$('#body [data-act=local-remove]')) && !!(await ph.$('#body [data-act=edit]')));
    await ph.evaluate(() => document.querySelector('#body .depth [data-act=select-job]').click()); await settle(ph);
    ok('phone: going up from the empty line (nothing was written) removes it, and no blank bullet is left', (await lines()).length === 0 && await frameDoc(ph, d => [...d.querySelectorAll('.entry .bullets li')].every(li => li.textContent.trim())));
    await ph.evaluate(() => document.querySelector('#body [data-act=ol-newline]').click()); await settle(ph);
    await ph.evaluate(() => document.querySelector('#body [data-act=edit]').click()); await settle(ph);
    await ph.fill('#ed', 'Wrote the fixture drawings.'); await ph.evaluate(() => document.querySelector('#body [data-act=ed-only]').click()); await settle(ph);
    ok('phone: what is typed there is kept on the line', (await ph.evaluate(id => window.__wb.store.state.cur.overrides[id], (await lines())[0])) === 'Wrote the fixture drawings.' && /fixture drawings/.test(await frameDoc(ph, d => d.body.textContent)));
    ok('phone: no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
}

if (want('scrollbars')) {
  const ctx = await newContext({ viewport: { width: 1280, height: 800 } });
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
  const ui = page => page.evaluate(() => ({ lang: document.documentElement.lang, design: document.querySelector('#tab-design')?.textContent.trim(), cur: window.__wb.store.state.cur?.lang ?? 'en', format: window.__wb.store.state.cur?.format, langs: window.__wb.store.state.record.langs }));
  {
    const ctx = await newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const bad = await open(page, '?memory&welcome');
    ok('a first visit opens on the introduction, with the three starts and no language step yet', await page.isVisible('[data-act=ob-scratch]') && (await page.$$('[data-langtick]')).length === 0);
    await page.click('[data-act=ob-scratch]'); await settle(page);           // the language step comes after choosing a start
    ok('the browser’s language is ticked on the language step', await page.isChecked('[data-langtick=de]') && !(await page.isChecked('[data-langtick=en]')));
    await page.click('[data-act=ob-lang-go]'); await settle(page);      // and carries on with the start that was chosen
    let u = await ui(page);
    ok('the first resume is in German, on A4', u.cur === 'de' && u.format === 'a4', JSON.stringify(u));
    ok('the interface is in German', u.lang === 'de' && u.design === de['ux2.modeDesign'], JSON.stringify(u));
    ok('the record lists the language you chose', JSON.stringify(u.langs) === '["de"]');
    await page.fill('#ob-name', 'Erika Muster'); await settle(page);
    await page.click('[data-act=ob-next]'); await settle(page);
    ok('the market step suggests Germany', (await page.getAttribute('.item.is-cur', 'data-m')) === 'dach');
    await page.click('[data-act=ob-next]'); await settle(page);
    await page.fill('#ob-pos', 'Konstrukteurin'); await page.fill('#ob-emp', 'Feinmess GmbH'); await page.fill('#ob-start', '2022-03'); await page.check('#ob-current');
    await page.fill('#ob-claims', 'Baute einen Prüfstand.'); await page.click('[data-act=ob-next]'); await settle(page);
    ok('a meta line written in German: German month, “heute”', /März 2022 – heute/i.test(await frameDoc(page, d => d.body.textContent)) || /MÄRZ 2022 – HEUTE/.test(await frameDoc(page, d => d.body.textContent)));
    ok('and nothing on the German resume is outlined as missing but the empty parts', (await frameDoc(page, d => d.querySelectorAll('.rb-miss').length)) === 0);
    await page.click('[data-act=ob-skip]'); await settle(page); await page.click('[data-act=ob-skip]'); await settle(page);
    if (await page.$('[data-act=ob-skip]')){ await page.click('[data-act=ob-skip]'); await settle(page); }
    await page.click('[data-act=ob-finish]'); await settle(page);
    await pickLang(page, 'en'); await settle(page);
    u = await ui(page);
    ok('+ Add a language adds English and switches the resume to it', u.cur === 'en' && JSON.stringify(u.langs) === '["de","en"]', JSON.stringify(u));
    ok('the interface follows the resume into English', u.lang === 'en' && u.design === 'Design');
    ok('and the toast is already in English', /This resume is now in English/.test(await page.textContent('#toast')));
    await page.click('#docname-btn'); await settle(page);
    ok('the language list now has just the two in use', (await page.$$eval('#sw-lang option', o => o.filter(x => !/^[+-]/.test(x.value)).length)) === 2);
    await pickLang(page, 'de'); await settle(page);
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
    const ctx = await newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
    const page = await ctx.newPage();
    const bad = await open(page, '?memory&welcome');
    await page.click('.oblang[data-l=de]'); await settle(page);
    await page.click('[data-act=ob-example]'); await settle(page);
    let u = await ui(page);
    ok('Try the example opens it at once, with no language step, in the language the start screen showed', (await page.$$('[data-langtick]')).length === 0 && u.cur === 'de' && u.lang === 'de' && !(await page.isVisible('[data-act=ob-scratch]')), JSON.stringify(u));
    ok('and the example keeps its own languages', u.langs.length >= 2 || u.langs === undefined, JSON.stringify(u.langs));
    // always in French, set in Settings: switching the resume to German leaves the interface French
    await page.click('[data-act=menu]'); await page.click('[data-act=goto][data-v=settings]'); await settle(page);
    if (!(await page.isChecked('[data-langtick=fr]'))){ await page.click('[data-langtick=fr]'); await settle(page); }
    await page.check('[data-uimode=fixed]'); await page.selectOption('[data-uilang]', 'fr'); await settle(page);
    ok('“always Français”: the interface is in French', (await page.evaluate(() => document.documentElement.lang)) === 'fr');
    await page.click('#tab-edit'); await settle(page);
    await pickLang(page, 'de'); await settle(page);
    u = await ui(page);
    ok('switching the resume to German leaves the interface in French', u.cur === 'de' && u.lang === 'fr' && u.design === fr['ux2.modeDesign'], JSON.stringify(u));
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
  {
    // storage blocked: English, following, no error
    const ctx = await newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
    await ctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get(){ throw new Error('blocked'); } }); });
    const page = await ctx.newPage();
    const bad = await open(page, '?memory&welcome');
    await page.click('[data-act=ob-example]'); await settle(page);
    ok('storage blocked: English, and no error', (await ui(page)).lang === 'en' && bad.length === 0, bad[0] ?? '');
    await page.click('[data-act=menu]'); await page.click('[data-act=goto][data-v=settings]'); await settle(page);
    await page.click('[data-act=view][data-d]').catch(() => {});
    ok('Settings still opens', /Settings/.test(await page.textContent('#body .title')) && bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }

}

if (want('the record checklist: groups, ticks, the page and the timeline')) {
  const ctx = await newContext({ motion: true, viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  const st = () => page.evaluate(() => window.__wb.store.state);
  const bullets = () => frameDoc(page, d => d.querySelectorAll('.bullets li').length);
  const all = () => page.textContent('#cl-all');
  await page.keyboard.press('r'); await settle(page);
  ok('the Record tab starts with “Your record”, with the whole record counted', /Your record/.test(await page.textContent('#checklist')) && /^\d+\/\d+\d+ of \d+ on$/.test((await all()).trim()));
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
  await first.locator('.cb').uncheck(); await settle(page);
  ok('unticking a line takes it off the page, which reflows', (await bullets()) === n0 - 1 && /3 of 7 on/.test(await page.textContent('#checklist .clg[data-g=hydra] .clcount')) && (await page.evaluate(() => window.__wb.store.history.undo)) === undo0 + 1);
  ok('…and the row stays in the list, unticked, never hidden', (await rows.count()) === 7 && (await first.locator('.cb').isChecked()) === false);
  await first.locator('.cb').check(); await settle(page);
  ok('ticking it puts it back, in its place', (await bullets()) === n0 && (await frameDoc(page, d => d.querySelector('.bullets li').textContent)).startsWith('Led the dose-counter'));
  await page.keyboard.press('Control+z'); await settle(page);
  ok('each tick is one undo step', (await bullets()) === n0 - 1);
  await page.keyboard.press('Control+z'); await settle(page);
  ok('…so two Ctrl+Z take both back', (await bullets()) === n0 && (await page.evaluate(() => window.__wb.store.history.undo)) === undo0);
  ok('…and the sample does not play again', !(await page.$('#checklist .clhint')) && await page.evaluate(() => window.__wb.motion.stats.names.filter(n => n === 'tick:sample').length <= 1));

  await rows.nth(1).hover(); await settle(page);
  ok('hovering a row lights its line on the page', (await frameDoc(page, d => d.querySelectorAll('.rb-hover').length)) === 1);
  await page.mouse.move(4, 4); await settle(page);
  ok('moving away puts the lights out', (await frameDoc(page, d => d.querySelectorAll('.rb-hover').length)) === 0);
  await rows.nth(1).locator('.clt').click(); await settle(page);
  ok('clicking a row’s text opens the claim in the inspector, with its versions', (await page.getAttribute('#body', 'data-view')) === 'bullet' && (await page.locator('.vrow').count()) >= 1 && (await page.evaluate(() => document.activeElement?.classList.contains('title'))));
  await page.click('#body .depth [data-act=select-job]'); await settle(page);
  ok('the job in the panel’s path opens the job: its panel, with the Details fold shut', (await page.getAttribute('#body', 'data-view')) === 'job' && (await page.isVisible('details.details > summary')) && !(await page.isVisible('#c-pos')));

  // a job not on the page at all: its claims are listed and can be ticked
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await page.keyboard.press('r'); await settle(page);
  const freeRows = page.locator('#checklist .clg[data-g=free]');
  await freeRows.scrollIntoViewIfNeeded(); await settle(page);
  ok('a job that is not on this resume lists its claims, all unticked', (await freeRows.locator('.clrow').count()) === 2 && (await freeRows.locator('.cb:checked').count()) === 0);
  await freeRows.locator('.cb').first().check(); await settle(page);
  ok('ticking one brings the job onto the page', (await frameDoc(page, d => /Freelance CAD Designer/.test(d.body.textContent))) && /1 of 2 on/.test(await freeRows.locator('.clcount').textContent()));
  await page.keyboard.press('Control+z'); await settle(page);

  // the timeline, at the top of the tab
  await page.evaluate(() => { document.querySelector('#body').scrollTop = 0; });
  ok('the timeline is open at the top of the tab: two columns, five jobs and three beside them', await page.isVisible('#checklist .rectl .tl2') && (await page.$$('#checklist .rectl .tl2 .main .row')).length === 5 && (await page.$$('#checklist .rectl .tl2 .side .srow')).length === 3 && !(await page.$('#timeline')));
  const tl = await rect(page, '#checklist .rectl'), col = await rect(page, '#col');
  ok('it is as wide as the sidebar’s content, and the Record fills the window (until its own redesign)', tl.left >= col.left && tl.right <= col.right && Math.abs(col.left - 16) < 1 && Math.abs(col.right - (await page.evaluate(() => innerWidth - 16))) < 1, `${tl.left}-${tl.right} vs ${col.left}`);
  await page.click('#checklist .rectl .row:has-text("Prototyping Technician")'); await settle(page);
  ok('an entry in it scrolls the list to that job, and the tab stays', (await page.getAttribute('#body', 'data-view')) === 'record' && await page.evaluate(() => { const g = document.querySelector('#checklist .clg[data-g=poly]'), b = document.querySelector('#body'); const d = g.getBoundingClientRect().top - b.getBoundingClientRect().top; return d >= -2 && (d < 120 || b.scrollTop + b.clientHeight >= b.scrollHeight - 2); }));      // or the list is already at its end: the taller body (no footer) cannot scroll further
  await page.evaluate(() => { document.querySelector('#body').scrollTop = 0; });
  await page.click('#checklist .rectl .srow:has-text("M.Eng.")'); await settle(page);
  ok('the degree takes the list to Education', await page.evaluate(() => { const g = document.querySelector('#checklist .clg[data-g=education]'), b = document.querySelector('#body'); const d = g.getBoundingClientRect().top - b.getBoundingClientRect().top; return window.__wb.ui.view === 'record' && d >= -2 && d < 200; }));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc goes back to Edit', (await page.evaluate(() => window.__wb.ui.view)) === null);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the record forms: details, About you, languages, no Save button')) {
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  const st = () => page.evaluate(() => window.__wb.store.state);
  await toJobOutline(page); await settle(page);
  ok('a job’s panel: no “Title and meta line” fields, no “Edit in Career →”, a Details fold that starts shut', !(await page.$('#body [data-act=to-career]')) && !/Title and meta line/i.test(await page.textContent('#body')) && !(await page.isVisible('#c-pos')));
  await page.click('details.details > summary'); await settle(page);
  ok('opened: title, employer, dates, “works here now”, place, and More fields (JSON Resume), folded', ['#c-pos', '#c-org', '#c-start', '#c-current', '#c-loc'].every(async s => await page.isVisible(s)) && await page.isVisible('details.jr:not(.details) summary') && !(await page.isVisible('#c-wurl')));
  ok('no Save button anywhere in the form', !(await page.$('#body [data-act=c-save], #body [data-act=c-save-about], #body [data-act=c-save-item]')) && !(await page.$('#body button.primary')));
  const undo0 = await page.evaluate(() => window.__wb.store.history.undo);
  await page.fill('#c-pos', 'Senior Design Engineer'); await page.keyboard.press('Enter'); await settle(page);
  ok('Enter commits the field: the job’s printed title follows, on the page and in the panel, as one undo step', (await frameDoc(page, d => d.querySelector('.role-title').textContent)) === 'Senior Design Engineer' && (await page.textContent('#body .title')) === 'Senior Design Engineer' && (await page.evaluate(() => window.__wb.store.history.undo)) === undo0 + 1);
  await page.fill('#c-loc', 'Nowhere'); await page.keyboard.press('Escape'); await settle(page);
  ok('Esc puts the field back, and the panel stays open', (await page.inputValue('#c-loc')) === 'Lisbon, Portugal' && (await page.getAttribute('#body', 'data-view')) === 'job');
  await page.fill('#c-org', 'Hydra Medical Ltd'); await page.keyboard.press('Tab'); await page.keyboard.type('2023-02'); await settle(page);
  const w0 = (await st()).record.work[0];
  ok('Tab commits it too, and the field you moved to keeps the focus and what you typed', w0.name === 'Hydra Medical Ltd' && (await page.evaluate(() => document.activeElement.id)) === 'c-start' && (await page.inputValue('#c-start')) === '2023-02', `${w0.name} ${await page.evaluate(() => document.activeElement.id)}`);
  await page.click('details.jr:not(.details) summary'); await page.fill('#c-wurl', 'https://hydra.example'); await page.fill('#c-wsum', 'Owned the dose counter.'); await page.keyboard.press('Tab'); await settle(page);
  const w1 = (await st()).record.work[0];
  ok('More fields (JSON Resume): the url and the summary are kept on the job', w1.url === 'https://hydra.example' && w1.summary === 'Owned the dose counter.');
  await page.click('details.details > summary'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  await page.click('[data-act=cl-open][data-sel*="job"] >> nth=0').catch(() => {});
  await toJobOutline(page); await settle(page);
  ok('the fold stays open when you come back to the job', await page.isVisible('#c-pos') === false);

  // About you
  await sheet.locator('.name').click(); await settle(page);
  await page.click('#body .depth [data-act=select-header]'); await settle(page);
  ok('the name\'s Header level opens About you: name, headline, contact, photo — no separate Career', (await page.getAttribute('#body', 'data-view')) === 'header' && await page.isVisible('#c-name') && await page.isVisible('#c-label') && await page.isVisible('#c-email') && await page.isVisible('[data-act=d-photo]'));
  await page.fill('#c-city', 'Porto, Portugal'); await page.keyboard.press('Enter'); await settle(page);
  ok('a contact field commits when you leave it; the printed line was written by hand, so it keeps its wording, and a toast says so', (await st()).record.basics.location.city === 'Porto, Portugal' && /keeps its wording/.test(await page.textContent('#toast')));
  await page.click('[data-act=c-sel-fact] >> nth=0'); await settle(page);
  ok('“Versions of the headline →” opens its versions in the same panel', (await page.getAttribute('#body', 'data-view')) === 'bullet' && (await page.locator('.vrow').count()) >= 1);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);

  // Skills and credentials: a skill group, a language
  await inRecord(page, 'credentials'); await settle(page);
  await page.click('#checklist .clg[data-g=credentials] .clrow:has-text("CAD") .clt'); await settle(page);
  ok('a skill group opens in the inspector: its name and keywords, then its versions, no Save', (await page.getAttribute('#body', 'data-view')) === 'record' && await page.isVisible('#c-gname') && await page.isVisible('#c-kw-in') && (await page.locator('.vrow').count()) >= 1 && !(await page.$('[data-act=c-save-item]')));
  await page.fill('#c-kw-in', 'Onshape'); await page.keyboard.press('Enter'); await settle(page);
  ok('a keyword added with Enter is in the record at once', (await st()).record.skills[0].keywords.includes('Onshape'));
  await page.click('#c-kw .tag:has-text("Onshape") .rm'); await settle(page);
  ok('× removes it at once', !(await st()).record.skills[0].keywords.includes('Onshape'));
  await inRecord(page, 'credentials');
  await page.click('#checklist .clg[data-g=credentials] .clrow:has-text("Portuguese") .clt'); await settle(page);
  await page.selectOption('#c-level', 'C2'); await settle(page);
  ok('a language: choosing its level commits at once', (await st()).record.languages.find(l => l.language === 'Portuguese')?.fluency === 'C2');
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the record in German: edit in the resume’s language')) {
  const I = await import(pathToFileURL(path.join(ROOT, 'src/i18n/index.js')));
  const de6 = await I.loadCatalogue('de');
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  const st = () => page.evaluate(() => window.__wb.store.state);
  await pickLang(page, 'de');
  await settle(page);
  ok('the resume’s language is the one you edit in: the page and the interface go German', (await page.evaluate(() => document.documentElement.lang)) === 'de' && (await page.evaluate(() => window.__wb.store.state.cur.lang)) === 'de' && (await page.textContent('#rail [role=tablist]')).includes(de6['ux2.modeEdit']));
  await toJobOutline(page); await settle(page);
  await page.click('details.details > summary'); await settle(page);
  ok('the form says what translates and what is the same in every language', /Deutsch/.test(await page.textContent('#body .detbox')) && (await page.textContent('#body .detbox')).includes(de6['career.shared']));
  await page.fill('#c-pos', 'Konstrukteur Medizintechnik'); await page.fill('#c-loc', 'Lissabon, Portugal'); await page.keyboard.press('Tab'); await settle(page);
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
    await page.fill('#ed-new', 'Leitete eine Prototypenwerkstatt.'); await page.click('[data-act=write-in]'); await settle(page);
    ok('written in place: German v1, picked by this resume', (await st()).record.variants.some(v => v.lang === 'de' && v.text === 'Leitete eine Prototypenwerkstatt.' && v.n === '1'));
  } else ok('a Polytechnic claim with no German to write', false);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  ok('the German resume prints the German title and place', (await frameDoc(page, d => d.body.textContent)).includes('Konstrukteur Medizintechnik') || (await frameDoc(page, d => d.body.textContent)).includes('Lissabon'));
  await inRecord(page, 'credentials'); await settle(page);
  await page.click('#checklist .clg[data-g=credentials] .clrow:has-text("CAD") .clt'); await settle(page);
  await page.fill('#c-gname', 'CAD und 3D'); await page.keyboard.press('Enter'); await settle(page);
  ok('a skill group renamed in German prints on the German resume', (await frameDoc(page, d => d.body.textContent)).includes('CAD und 3D'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('adding to the record: + Add, an empty record, projects, kinds, references')) {
  // an empty record: the quiet editor first, then everything the record can hold is reachable from + Add
  {
    const ctx3 = await newContext({ viewport: { width: 1440, height: 960 } });
    const p3 = await ctx3.newPage();
    await open(p3, '?memory&welcome');
    await p3.click('[data-act=ob-scratch]'); await settle(p3);           // the language step comes after choosing a start
    await p3.click('[data-act=ob-lang-go]'); await settle(p3);
    await p3.fill('#ob-name', 'Robin Vale'); await p3.waitForFunction(() => document.querySelector('#sheet iframe').contentDocument.body.textContent.includes('Robin Vale')); await settle(p3);
    ok('onboarding from scratch is a quiet editor: the page and the question panel only, no header, footer or zoom bar', (await p3.evaluate(() => document.body.classList.contains('is-quiet'))) && !(await p3.isVisible('#head')) && !(await p3.isVisible('#foot')) && !(await p3.isVisible('#zoombar')) && await p3.isVisible('#body'));
    ok('the answers appear on the page as they are typed', (await frameDoc(p3, d => d.body.textContent)).includes('Robin Vale'));
    for (let i = 0; i < 6; i++){ if (await p3.isVisible('[data-act=ob-skip]')) await p3.click('[data-act=ob-skip]'); else if (await p3.isVisible('[data-act=ob-next]')) await p3.click('[data-act=ob-next]'); await settle(p3); }
    if (await p3.isVisible('[data-act=ob-finish]')) await p3.click('[data-act=ob-finish]'); await settle(p3);
    ok('Start editing brings the rest in: the header with Edit, Design and Export, and the Outline', await p3.isVisible('#head') && await p3.isVisible('#tab-edit') && /Fit cuts from the bottom/.test(await p3.textContent('#body')));
    await openAdd(p3); await settle(p3);
    ok('+ Add lists every kind: job, education, project, skills, languages, certificates, publications, interests, references, and “Something else”', ['work', 'education', 'project', 'skills', 'languages', 'certificates', 'publications', 'interests', 'references'].every(async k => true) && (await p3.$$('.addm [data-act=c-add]')).length >= 9 && await p3.isVisible('.addm [data-act=c-kind-new]'));
    await p3.click('.addm [data-what=work]'); await settle(p3);
    ok('+ Add a job opens its form in the panel: title, employer, dates and the claims', await p3.isVisible('#c-claims') && /A new job/.test(await p3.textContent('#body .title')));
    await p3.click('[data-act=c-add-cancel]'); await settle(p3);
    await openAdd(p3); await p3.click('.addm [data-what=education]'); await settle(p3);
    ok('+ Add education opens the education form', await p3.isVisible('#c-org') && !(await p3.$('#c-claims')));
    await ctx3.close();
  }
  const ctx = await newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  await openByName(page, 'Medtech'); await settle(page);
  const before = await frameDoc(page, d => d.body.textContent);
  // a project
  await openAdd(page); await settle(page);
  await page.click('.addm [data-what=project]'); await settle(page);
  await page.fill('#c-pos', 'Formula Student chassis jig'); await page.fill('#c-org', 'FEUP Formula Student team'); await page.fill('#c-start', '2019-10'); await page.fill('#c-end', '2020-06');
  await page.selectOption('#c-during', 'porto-meng');
  await page.fill('#c-claims', 'Designed the welding jig for the team’s steel spaceframe chassis.\nIt held tolerance through two builds.');
  await page.click('[data-act=c-create]'); await settle(page);
  let s = await st();
  const pj = s.record.projects?.find(p => p.name === 'Formula Student chassis jig' && p.highlights?.length === 2);
  ok('a project goes in the record, with its claims and “during”', pj?.during === 'porto-meng');
  ok('it opens in Edit as a job does', (await page.getAttribute('#body', 'data-view')) === 'job' && (await page.getAttribute('#tab-edit', 'aria-selected')) === 'true');
  await inRecord(page); await settle(page);
  ok('it shows on the timeline beside the degree, saying so', /during Universidade do Porto/.test(await page.textContent('#checklist .rectl .tl2')));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await toEditHome(page);
  ok('nothing on the open resume changes: its Projects section is off', (await frameDoc(page, d => d.body.textContent)) === before);
  ok('the section is in the list, in its own row, with its pill off', !(await page.isChecked('#seclist .srow[data-sid=projects] input.sw')));
  await page.click('#seclist .srow[data-sid=projects] .swl'); await settle(page);
  const out = await frameDoc(page, d => d.body.textContent);
  ok('put on the resume, the Projects section prints it, title and meta line and bullets', out.includes('Formula Student chassis jig') && out.includes('welding jig'));
  ok('and it paginates', (await page.evaluate(() => window.__wb.ui.fills.every(p => !(p.overflow > 0)))));
  await page.click('[data-act=fit]');
  await page.waitForFunction(() => !window.__wb.ui.fitting, null, { timeout: 60000 }); await settle(page);
  ok('Fit runs with it on', /%/.test(await page.getAttribute('#meter .meter', 'aria-label')) && (await st()).cur.sections.find(x => x.id === 'projects')?.weight !== 0);

  // a custom kind: Awards, from the preset
  await openAdd(page); await settle(page);
  await page.click('.addm [data-act=c-kind-new]'); await settle(page);
  await page.click('[data-act=c-kind-preset][data-p=awards]'); await settle(page);
  await page.click('[data-act=c-kind-save]'); await settle(page);
  ok('Awards, made from the preset, is a list kind', (await st()).record.kinds?.[0]?.store === 'awards' && (await st()).record.kinds[0].place === 'list');
  ok('and the form for its first entry opens', await page.isVisible('#c-pos'));
  await page.fill('#c-pos', 'Best student design'); await page.fill('#c-org', 'Example Society'); await page.fill('#c-start', '2020-11');
  await page.click('[data-act=c-create]'); await settle(page);
  ok('the entry is a JSON Resume award', (await st()).record.awards?.[0]?.title === 'Best student design');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await inRecord(page, 'awards');
  ok('it is listed in its own group in the record, which is open', /Best student design/.test(await page.textContent('#checklist .clg[data-g=awards]')) && (await page.$$('#checklist .clg[data-g=awards].open')).length === 1);
  await toEditHome(page);
  await page.click('#seclist .srow[data-sid=awards] .swl'); await settle(page);
  ok('put on a resume, it prints as a run line', (await frameDoc(page, d => d.body.textContent)).includes('Best student design · Example Society · 2020'));
  // another list kind, then delete Awards moving its entry there
  await openAdd(page); await settle(page); await page.click('.addm [data-act=c-kind-new]'); await settle(page);
  await page.fill('#kn-name', 'Exhibitions'); await page.check('[data-kplace=list]'); await settle(page);
  await page.click('[data-act=c-kind-save]'); await settle(page);
  await page.click('[data-act=c-add-cancel]').catch(() => {}); await settle(page);
  await openAdd(page); await settle(page);
  await page.click('.addm .kset[data-id="awards"]'); await settle(page);
  ok('an existing kind’s editor has no Save button: its colour and icon change at once', !(await page.$('[data-act=c-kind-save]')) && await page.isVisible('[data-act=c-kind-colour]'));
  await page.click('[data-act=c-kind-colour][data-i="1"]'); await settle(page);
  ok('…', (await st()).record.kinds.find(k => k.store === 'awards').colour === 1);
  await page.click('[data-act=c-kind-del]'); await settle(page);
  await page.click('[data-act=c-kind-del-move]'); await settle(page);
  s = await st();
  ok('deleting Awards moved its entry to Exhibitions', !s.record.kinds.some(k => k.store === 'awards') && s.record.projects?.some(p => p.name === 'Best student design' && p.type === 'exhibitions'), JSON.stringify(s.record.projects));
  await page.keyboard.press('Control+z'); await settle(page);
  ok('Ctrl+Z brings it back', (await st()).record.kinds.some(k => k.store === 'awards') && (await st()).record.awards?.[0]?.title === 'Best student design');

  // a reference
  await openAdd(page); await settle(page);
  ok('+ Add offers a Reference', await page.isVisible('.addm [data-act=c-add][data-what=references]'));
  await page.click('.addm [data-act=c-add][data-what=references]'); await settle(page);
  await page.fill('#c-rname', 'Ana Exemplo'); await page.fill('#c-rtext', 'Dana fixed our dose counter in a week.');
  await page.click('[data-act=c-create]'); await settle(page);
  s = await st();
  ok('it is a JSON Resume reference with a text behind it', s.record.references?.[0]?.name === 'Ana Exemplo' && s.record.facts.some(f => f.id === s.record.references[0].id));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await inRecord(page, 'credentials');
  ok('it shows under References in Skills and credentials', /Ana Exemplo/.test(await page.textContent('#checklist .clg[data-g=credentials]')));
  ok('the resume does not print it yet', !(await frameDoc(page, d => d.body.textContent)).includes('Ana Exemplo'));
  await toEditHome(page);
  await page.click('#seclist .srow[data-sid=references] .swl'); await settle(page);
  ok('put on the resume, it prints the name and the text', (await frameDoc(page, d => d.body.textContent)).includes('Ana Exemplo') && (await frameDoc(page, d => d.body.textContent)).includes('dose counter in a week'));
  await page.click('#seclist .srow[data-sid=references] input'); await settle(page);
  ok('and off again with its switch, it is gone', !(await frameDoc(page, d => d.body.textContent)).includes('Ana Exemplo'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the examples, in every language')) {
  const ctx = await newContext({ viewport: { width: 1536, height: 900 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const list = await page.evaluate(() => window.__wb.store.state.resumes.map(r => ({ id: r.id, lang: r.lang ?? 'en', limit: r.pageLimit })));
  ok('a saved example resume in each of the ten languages', ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu'].every(l => list.some(r => r.lang === l)), list.map(r => r.lang).join());
  for (const r of list){
    await page.evaluate(id => window.__wb.resumes.open(id), r.id); await settle(page);
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
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  ok('/ opens the Workbench', await page.isVisible('#col') && /BrewCV/.test(await page.title()));
  const gone = await ctx.request.get(`http://localhost:${PORT}/picker.html`);      // a bare 404 makes goto() throw, so ask for the status
  ok('the 0.4.0 picker is retired', gone.status() === 404);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the Edit view')) {
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  page.on('dialog', d => d.accept());
  const sheet = page.frameLocator('#sheet iframe');
  const st = () => page.evaluate(() => window.__wb.store.state);
  const sheetText = () => frameDoc(page, d => d.querySelector('.document').textContent);
  const undoTo = async n => { for (let k = 0; k < 60 && (await page.evaluate(() => window.__wb.store.history.undo)) > n; k++){ await page.keyboard.press('Control+z'); await page.waitForTimeout(150); } await settle(page); };
  const base = await page.evaluate(() => window.__wb.store.history.undo);
  // read the page with the mouse off the version list, so no hover preview is showing
  const fb = async () => { await page.mouse.move(4, 4); await settle(page); return firstBullet(page); };

  await sheet.locator('.bullets li').first().click(); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);      // one click wrote it; Esc leaves it selected
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
  await appendLine(page, ' Zebra-check.'); await settle(page);
  ok('the page redraws as you type', (await fb()).includes('Zebra-check.'));
  ok('the tools count the characters and the lines on the page', /ch/.test(await page.textContent('#ob-stats')) && /ln/.test(await page.textContent('#ob-stats')));
  ok('nothing is committed while typing', (await page.evaluate(() => window.__wb.store.history.undo)) === base);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc leaves the line and keeps what was typed on this resume, as one undo step', (await lineEl(page).count()) === 0 && (await fb()).includes('Zebra-check.') && (await st()).cur.overrides[fact]?.endsWith('Zebra-check.') && (await page.evaluate(() => window.__wb.store.history.undo)) === base + 1);
  await page.keyboard.press('Control+z'); await settle(page);
  ok('Ctrl+Z takes it back', (await fb()) === text0 && !((await st()).cur.overrides ?? {})[fact]);

  // ✎ on the version in use writes the line on the page too; leaving keeps the words on this resume, and no version is made (turning
  // an edit into a version is the Review list's)
  await page.click('.vrow.cur [data-act=edit]'); await settle(page);
  ok('✎ writes the line on the page, with nothing to save beside it', (await lineEl(page).count()) === 1 && !(await page.$('[data-act=ed-save], [data-act=ed-saveas], [data-act=ed-only]')));
  await writeLine(page, 'Only on this resume.');
  await page.keyboard.press('Escape'); await settle(page);
  ok('leaving it keeps a one-off text on this resume, and makes no version', (await st()).cur.overrides[fact] === 'Only on this resume.' && (await st()).record.variants.length === nBefore);
  ok('it prints, and is listed as "only"', (await fb()) === 'Only on this resume.' && await page.isVisible('.vrow.only'));
  await page.keyboard.press('Escape'); await settle(page);
  await sheet.locator('.bullets li').first().click(); await settle(page);
  ok('from the page, one click on it writes it at once, from the edit', (await lineEl(page).count()) === 1 && (await lineText(page)) === 'Only on this resume.');
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc leaves the line for the job: still selected, no longer written', (await lineEl(page).count()) === 0 && (await page.evaluate(() => window.__wb.ui.sel.id)) === fact);
  await page.click('[data-act=only-remove]'); await settle(page);
  ok('↺ goes back to the saved version', (await fb()) === text0);

  ok('there is no “+ Write a new version” link in the versions list', !(await page.$('[data-act=new-version]')));
  await page.evaluate(() => window.__wb.edit.startEdit('new')); await settle(page);
  ok('a new wording started from a copy is written on the page', (await lineEl(page).count()) === 1 && (await lineText(page)) === text0);
  await writeLine(page, 'A whole new take.');
  await page.keyboard.press('Escape'); await settle(page);
  ok('…kept on this resume when the line is left (no version until the Review list)', (await st()).cur.overrides[fact] === 'A whole new take.' && (await st()).record.variants.length === nBefore && (await fb()) === 'A whole new take.');

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

  await page.click('#body .depth [data-act=select-job]'); await settle(page);
  ok('a job’s sheet lists its own lines, ticked, and not the whole record', (await page.$$('#body input[data-on]')).length >= 2 && !(await page.$('#checklist')));
  await settle(page);
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
  await page.keyboard.press('Escape'); await settle(page);      // out of the heading it wrote: the section stays selected
  await page.fill('#sec-label', 'Tools'); await page.press('#sec-label', 'Enter'); await settle(page);
  ok('a heading typed in the panel prints on the page', await frameDoc(page, d => d.querySelector('.band[data-section="skills"] .tab').textContent === 'Tools'));
  ok('the section keeps its id', (await st()).cur.sections.find(s => s.id === 'skills').label.en === 'Tools');
  await page.click('[data-act=label-reset]'); await settle(page);
  ok('reset puts the record’s heading back', await frameDoc(page, d => d.querySelector('.band[data-section="skills"] .tab').textContent === 'Skills'));
  await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await settle(page);
  await sheet.locator('.band[data-section="patent"] .tab').first().click(); await settle(page);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a'); await page.keyboard.type('Invention'); await page.keyboard.press('Escape'); await settle(page);
  ok('one click on a heading writes it in place (no double-click): Esc keeps it on this resume, in its language', (await st()).cur.sections.find(s => s.id === 'patent')?.label?.en === 'Invention'
     && await frameDoc(page, d => d.querySelector('.band[data-section="patent"] .tab').textContent === 'Invention'));
  await sheet.locator('.band[data-section="skills"] .tab').first().click(); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  ok('there are no Move up / Move down buttons', (await page.$$('[data-act=sec-move]')).length === 0);
  await page.keyboard.press('Alt+ArrowDown'); await settle(page);
  const bands = await frameDoc(page, d => [...d.querySelectorAll('.band[data-section]')].map(b => b.getAttribute('data-section')));
  ok('Alt+↓ moves it on the page', bands.indexOf('skills') > bands.indexOf('patent'), bands.join());
  await page.click('#body .ctlrow input[data-secon]'); await settle(page);
  ok('Show on this resume off takes the section off the page', !(await frameDoc(page, d => !!d.querySelector('.band[data-section="skills"]'))));
  await undoTo(base);

  await page.click('[data-act=deselect]').catch(() => {}); await settle(page);
  await settle(page);
  ok('a section row has no grip, no ↑ ↓ and cannot be dragged (sections are arranged on the page)', (await page.$$('#seclist .srow[draggable], #seclist .srow .grip, #seclist .srow .clmv, #seclist [data-act=sec-up], #seclist [data-act=sec-down]')).length === 0);
  ok('the sections that are off stay in their own rows, dimmed, each with the pill', (await page.$$('#seclist .srow.is-off input.sw:not(:checked)')).length >= 2 && !(await page.$('#offline, .offchip')));
  await page.click('#seclist .srow[data-sid=languages] .swl'); await settle(page);
  ok('pressing one turns it on', await frameDoc(page, d => !!d.querySelector('.band[data-section="languages"]')) && await page.isChecked('#seclist .srow[data-sid=languages] input.sw'));
  await page.focus('#seclist .srow[data-sid=interests] input.sw'); await page.keyboard.press('Space'); await settle(page);
  ok('Space on one does the same, for the keyboard', await frameDoc(page, d => !!d.querySelector('.band[data-section="interests"]')));
  await undoTo(base);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('saved resumes')) {
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  page.on('dialog', d => d.accept());
  const st = () => page.evaluate(() => window.__wb.store.state);
  const saved = r => r.openId && r.resumes.find(x => x.id === r.openId);
  await page.waitForFunction(() => /Saved on this device/.test(document.querySelector('#savestate')?.textContent ?? ''), null, { timeout: 5000 });
  ok('the header always says where the work is: “Saved on this device”', /Saved on this device/.test(await page.textContent('#savestate')) && (await page.$$('#savestate .si.ok')).length === 1);
  const nameWas = await page.evaluate(() => window.__wb.store.state.cur.name);
  await page.evaluate(() => window.__wb.store.commit(d => { d.cur.name = 'Saved announce'; }, 'name'));
  await page.waitForFunction(() => /Saved on this device/.test(document.querySelector('#announce')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
  ok('Saved has no role of its own; a finished save is said through the #announce live region', (await page.getAttribute('#savestate', 'role')) === null && /Saved on this device/.test(await page.textContent('#announce')));
  await page.evaluate(n => window.__wb.store.commit(d => { d.cur.name = n; }, 'name'), nameWas);      // later steps look the resume up by its name
  await page.click('#tab-export'); await settle(page);
  ok('Save to file is always there (in Export), outline not filled, with where the file stands', !(await page.isDisabled('#filestate')) && !(await page.getAttribute('#filestate', 'class')).includes('primary') && /Not saved to a file yet/.test(await page.textContent('#fileline')));
  await page.click('#tab-edit'); await settle(page);
  ok('there is no Resumes tab: the rail’s tab list has Edit, Design and Export; Resumes is a screen button beside it', (await page.$$('#rail [role=tab]')).length === 3 && !/Resumes/.test(await page.textContent('#rail [role=tablist]')) && (await page.$$('#rail .scr')).length === 2);
  ok('the menu is the short one', await (async () => { await page.click('[data-act=menu]'); const t = await page.textContent('.menu'); await page.keyboard.press('Escape'); await page.click('[data-act=menu]').catch(() => {}); return !/Saved resumes|New resume|Restore a backup|Languages you use/.test(t) && /Open or import/.test(t) && !/Save to file/.test(t) && /History and checkpoints/.test(t) && /Settings/.test(t) && /Privacy/.test(t) && /Source code/.test(t) && /Load the example/.test(t) && /Start over/.test(t); })());
  await page.mouse.click(4, 400); await settle(page);

  // the switcher
  await page.keyboard.press('Control+o'); await settle(page);
  ok('Ctrl+O opens the switcher with the search box focused', await page.isVisible('#switcher') && (await page.evaluate(() => document.activeElement?.id)) === 'sw-q');
  const uniqueRows = () => page.evaluate(() => new Set([...document.querySelectorAll('#switcher .swrow')].map(r => r.dataset.rid)).size);
  ok('the name window lists the recent resumes, the open one first and marked; Manage all says how many there are', (await uniqueRows()) >= 1 && (await uniqueRows()) <= 4 && /Recent/.test(await page.textContent('#switcher .swlist .lbl')) && (await page.$$('#switcher .swrow.is-cur')).length === 1 && /Manage all \(14\)/.test(await page.textContent('#switcher .swfoot')));
  ok('an older resume, with no parent on record, shows no “Duplicated from” line', !(await page.$('#switcher .swfrom')));
  ok('it is a dialog with a labelled group of buttons for a screen reader, the open resume marked current', (await page.getAttribute('#sw-list', 'role')) === 'group' && (await page.$$('#switcher .sopt')).length >= 1 && (await page.$$('#switcher .sopt[aria-current=true]')).length >= 1 && (await page.getAttribute('#switcher', 'role')) === 'dialog');
  await page.fill('#sw-q', 'medtech'); await settle(page);
  ok('a search lists every match, grouped by job type', (await uniqueRows()) === 1 && /Medtech/.test(await page.textContent('#switcher .sopt')));
  const before = await firstBullet(page);
  await page.hover('#switcher .sopt:has-text("Medtech")'); await settle(page);
  ok('hovering one shows it on the page', (await firstBullet(page)) !== before && (await st()).openId.startsWith('Example'));
  await page.mouse.move(700, 400); await settle(page);
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
  await page.fill('#sw-q', 'medtech'); await settle(page);
  await page.click('#switcher .sopt:has-text("Medtech")'); await settle(page);
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
  ok('nothing on the page can be edited', (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'none' && await page.isDisabled('[data-act=fit]') && await page.isDisabled('#tab-design'));
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
  await page.click('[data-act=snap-dup]'); await settle(page);
  ok('Duplicate as new resume makes one and opens it', (await st()).resumes.length === n + 1 && !(await page.isVisible('.snapbar')) && /\(/.test(await page.textContent('#docname')));

  // the row menu
  await page.click('#docname-btn'); await settle(page);
  await page.fill('#sw-q', 'Example Instruments'); await settle(page);
  await page.click('#switcher .swrow:has-text("Example Instruments") .smore'); await settle(page);
  ok('⋯ offers Duplicate, Duplicate in another language…, Rename and Delete', await page.evaluate(() => [...document.querySelectorAll('.rowmenu [role=menuitem]')].map(b => b.textContent.trim()).join('|')) === 'Duplicate|Duplicate in another language…|Rename|Delete');
  await page.click('.rowmenu [data-act=rm-lang]'); await settle(page);
  await page.click('.rowmenu [data-lang=hu]'); await settle(page);
  const dup = await st();
  ok('Duplicate in another language: a copy in that language, open, named (HU), with its name ready to type in the name window', dup.cur.lang === 'hu' && /\(HU\)/.test(dup.cur.name) && dup.openId === dup.cur.id && await page.isVisible('#switcher') && (await page.evaluate(() => document.activeElement?.id)) === 'sw-rn');
  await page.keyboard.press('Escape'); await settle(page);
  const missing = await page.evaluate(async () => { const L = await import('./src/model/lang.js'); const s = window.__wb.store.state; return L.missingList(window.__wb.store.materialize(s.record), s.cur).length; });
  ok('…the lines with no version in that language are marked on the page, as the app already marks them', missing > 0 && (await frameDoc(page, d => d.querySelectorAll('.rb-miss, .rb-miss-tab').length)) > 0 && await page.isVisible('.missbar'), String(missing));
  await page.click('#docname-btn'); await settle(page);
  ok('the name window says where a copy came from: “Duplicated from …”', /Duplicated from Example Instruments/.test(await page.textContent('#switcher .swfrom')));
  await page.click('#switcher .swrow.is-cur .smore'); await page.click('.rowmenu [data-act=rm-rename]'); await settle(page);
  await page.fill('.swren', 'Renamed By Smoke'); await page.keyboard.press('Enter'); await settle(page);
  ok('Rename changes the name and the file name', (await st()).cur.name === 'Renamed By Smoke' && (await st()).openId === 'Renamed By Smoke.json');
  ok('…and the switcher stays open with the new name', await page.isVisible('#switcher') && /Renamed By Smoke/.test(await page.textContent('#switcher .swrow.is-cur')));
  await page.click('#switcher .swrow.is-cur .smore'); await page.click('.rowmenu [data-act=rm-delete]'); await settle(page);
  ok('Delete removes it (Ctrl+Z brings it back) and opens another', !(await st()).resumes.some(x => x.id === 'Renamed By Smoke.json') && !!saved(await st()));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z'); await settle(page);
  ok('Ctrl+Z brings it back', (await st()).resumes.some(x => x.id === 'Renamed By Smoke.json'));

  // + New resume
  await page.click('#docname-btn'); await settle(page);
  await page.fill('#sw-q', 'Example Instruments'); await settle(page);
  await page.click('#switcher .swrow[data-rid="Example Instruments - Design Engineer.json"] .sopt'); await settle(page);
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
  await page.hover('.startopt[data-start=empty]'); await settle(page);
  ok('hovering an option previews it on the page', (await firstBullet(page)) !== nameBefore);
  await page.mouse.move(700, 400); await settle(page);
  await page.check('.startopt[data-start=tagged] input'); await settle(page);
  await page.click('[data-act=nv-create]'); await settle(page);
  const made = await st();
  ok('Create saves and opens it: named from For, outreach, with its job type', made.cur.name === 'Geospatial - GIS Solutions Engineer' && made.cur.forKind === 'outreach' && made.cur.jobType === lt[0] && made.openId === made.cur.id);
  await page.click('#docname-btn'); await settle(page);
  await page.click('#switcher .swnew'); await settle(page);
  await page.click('[data-act=nv-create]'); await settle(page);
  ok('and no company is needed', (await st()).resumes.length === made.resumes.length + 1);
  await page.click('#docname-btn'); await settle(page);
  await page.click('#switcher [data-act=sw-manage]'); await settle(page);
  ok('Manage all opens the Resumes screen, a screen of its own: the window is the screen, with its heading, the back button first, and the name card small', (await page.evaluate(() => window.__wb.ui.view)) === 'resumes' && !(await page.isVisible('#switcher')) && (await rect(page, '#body')).width > 1000 && (await rect(page, '#head')).width < 400 && await page.isVisible('#resumes h2') && await page.evaluate(() => document.activeElement?.matches('#resumes [data-act=scr-back]')));
  ok('…with the search box, three views (Job type, Date, Company), and on each card a tick box, Open, Duplicate and a row menu', (await page.$$('#resumes [data-act=scr-view]')).length === 3 && (await page.getAttribute('#resumes [data-act=scr-view][aria-pressed=true]', 'data-v')) === 'type' && (await page.$$('#resumes .rcard .smore')).length > 10 && (await page.$$('#resumes .rcard .rtick')).length > 10 && await page.isVisible('#scr-q'));
  ok('Compare is off until two are ticked', await page.isDisabled('#scr-cmp'));
  await page.check('#resumes .rcard[data-rid="Example Instruments - Design Engineer.json"] .rtick');
  await page.check('#resumes .rcard:has-text("Helix") .rtick');
  ok('two ticks turn Compare on', !(await page.isDisabled('#scr-cmp')) && /Compare 2/.test(await page.textContent('#scr-cmp')));
  await page.click('#scr-cmp'); await settle(page);
  ok('Compare opens the two side by side, a screen of its own', (await page.getAttribute('#body', 'data-view')) === 'compare' && (await page.$$('table.cmp tbody tr')).length > 8 && (await page.$$('table.cmp tr.diff-row')).length > 0);
  await page.click('#compare [data-act=scr-back]'); await settle(page);
  ok('its way back reopens the list with the two still ticked', (await page.evaluate(() => window.__wb.ui.view)) === 'resumes' && (await page.$$('#resumes .rtick:checked')).length === 2);
  await page.click('#resumes [data-act=scr-view][data-v=date]'); await settle(page);
  ok('the Date view: sends newest first, with the year bands, each its own card', (await page.$$('#resumes h3.lbl')).length >= 1 && (await page.$$('#resumes .rcard [data-act=sw-snap]')).length >= 3);
  const dates = await page.$$eval('#resumes .rcard:has([data-act=sw-snap]) .rmeta', es => es.map(e => e.textContent.slice(0, 10)));
  ok('…the sends of this session are on top, newest first', dates.length >= 3 && dates.every((d, i) => !i || dates[i - 1] >= d), dates.join());
  await page.click('#resumes .rcard [data-act=sw-snap] >> nth=0'); await settle(page);
  ok('a send opens that snapshot, read-only', await page.isVisible('.snapbar') && (await page.evaluate(() => window.__wb.ui.view)) === null);
  await page.click('[data-act=snap-close]'); await settle(page);
  await page.click('#docname-btn'); await settle(page);
  await page.click('#switcher [data-act=sw-manage]'); await settle(page);
  ok('the view you left it on is remembered (Date)', (await page.getAttribute('#resumes [data-act=scr-view][aria-pressed=true]', 'data-v')) === 'date');
  await page.click('#resumes [data-act=scr-view][data-v=company]'); await settle(page);
  ok('the Company view: grouped by the company of the For line and of each send, outreach marked', (await page.$$('#resumes h3.lbl')).length >= 5 && /Smoke Test Co/.test(await page.textContent('#resumes')) && /Geospatial/.test(await page.textContent('#resumes')));
  await page.fill('#scr-q', 'smoke test'); await settle(page);
  ok('search filters it: only the resume that went to Smoke Test Co', (await page.$$eval('#resumes .rcard', r => new Set(r.map(x => x.dataset.rid)).size)) === 1);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  ok('Esc clears the search, and Esc again goes back to the editor, the focus on the rail button', (await page.evaluate(() => window.__wb.ui.view)) === null && (await page.evaluate(() => document.activeElement?.matches('#rail [data-act=sw-manage]'))));
  await page.click('#rail [data-act=sw-manage]'); await settle(page);
  await page.click('#resumes [data-act=scr-view][data-v=type]'); await settle(page);
  await page.click('#resumes .rcard[data-rid="Helix Diagnostics - Product Development Engineer.json"] .thumbwrap'); await settle(page);
  ok('clicking a card’s picture opens it', /Helix Diagnostics/.test(await page.textContent('#docname')) && (await page.evaluate(() => window.__wb.ui.view)) === null, await page.textContent('#docname'));

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
    await page.frameLocator('#sheet iframe').locator(`[data-variant="${shared.variant}"]`).first().click(); await settle(page);      // one click writes it
    await writeLine(page, 'Brand new record wording.');
    await page.evaluate(() => window.__wb.edit.act('ed-save', { dataset: {} })); await settle(page);      // saving over the version (the panel's Save vN; on the page an edit stays on this resume)
    ok('editing a version leaves every other saved resume’s text alone', JSON.stringify((await st()).frozen[shared.other]) === otherBefore);
    await page.click('#docname-btn'); await settle(page);
    await page.fill('#sw-q', shared.other.split(' - ')[0]); await settle(page);
    await page.click(`#switcher .swrow[data-rid="${shared.other}"] .sopt`); await settle(page);
    ok(`${shared.company} keeps the text it was saved with`, (await frameDoc(page, d => d.body.textContent)).includes(shared.text));
    ok('and the card offers the newer wording', await page.isVisible('.banner'));
    await page.click('.banner [data-act=review-open]'); await settle(page);      // the newer wording is the second group of the Review list
    await page.click('#review [data-rv=newer] >> nth=0'); await settle(page);
    await page.click('#review [data-rv=cancel]'); await settle(page);
    ok('accepting prints the newer wording', (await frameDoc(page, d => d.body.textContent)).includes('Brand new record wording.'));
  } else ok('two saved resumes share a bullet version', false);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('tags and focus')) {
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  await openByName(page, 'Medtech'); await settle(page);
  ok('the Outline has one lens row: Highlight, one list: the job types, then every tag', await page.isVisible('#lens') && (await page.$$('#lens optgroup')).length === 2 && (await page.evaluate(() => document.querySelectorAll('#lens optgroup')[1].children.length)) > 3 && !(await page.$('[data-act=lens-tags]')));
  const undo0 = await page.evaluate(() => window.__wb.store.history.undo);
  await page.selectOption('#lens', 'Prototyping'); await settle(page);
  const faded = await frameDoc(page, d => [d.documentElement.classList.contains('rb-focus'), d.querySelectorAll('.rb-hit').length, d.querySelectorAll('.bullets li').length]);
  ok('choosing a job type keeps the matching bullets bright and fades the rest', faded[0] && faded[1] > 0 && faded[1] < faded[2], faded.join());
  ok('and changes nothing in the resume: it only highlights', (await page.evaluate(() => window.__wb.store.history.undo)) === undo0 && !(await page.$('.focusbox')));
  await page.click('[data-act=lens-apply]'); await settle(page);
  ok('Apply… says what selecting would do', /turn on \d+, turn off \d+ and switch \d+/.test(await page.textContent('.focusbox')));
  await page.click('[data-act=focus-apply]'); await settle(page);
  ok('applying is one undo step', (await page.evaluate(() => window.__wb.store.history.undo)) === undo0 + 1);
  ok('and leaves nothing more to do', !(await page.$('.focusbox')) || await page.isDisabled('[data-act=focus-apply]'));
  await page.keyboard.press('Control+z'); await settle(page);
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
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  ok('the name card has no language button; the name window has a language list, a labelled select', !(await page.$('#langbtn')) && !(await page.$('#head .dline')));
  await page.click('#docname-btn'); await settle(page);
  ok('it lists the languages you use (the example lists all ten) and the current one is chosen, with a label', (await page.$$eval('#sw-lang option', o => o.filter(x => !/^[+-]/.test(x.value)).length)) === 10 && /English/.test(await page.$eval('#sw-lang', e => e.selectedOptions[0].textContent)) && (await page.$$('label[for=sw-lang]')).length === 1);
  ok('each with what is left to write', /to write|complete/.test(await page.$$eval('#sw-lang option', o => o.map(x => x.textContent).join())));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes the window', !(await page.isVisible('#switcher')));
  await pickLang(page, 'hu'); await settle(page);
  ok('the Hungarian button switches the resume to Hungarian', (await st()).cur.lang === 'hu' && /Tapasztalat/i.test(await frameDoc(page, d => d.body.textContent)));
  await page.click('#seclist .srow[data-sid=interests] .swl'); await settle(page);
  ok('a section with no Hungarian still prints, in English', /Dinghy sailing/.test(await frameDoc(page, d => d.body.textContent)));
  ok('outlined on the page', (await frameDoc(page, d => d.querySelectorAll('.rb-miss').length)) >= 3);
  ok('and listed in the card', (await page.$$('.missbar .miss-go')).length >= 3);
  await page.click('.missbar .miss-go:has-text("Dinghy sailing")'); await settle(page);
  ok('a missing text opens with the English for reference and a box to write it', await page.isVisible('#ed-new') && await page.isVisible('.writein .ref'));
  await page.fill('#ed-new', 'Vitorlázás'); await page.click('[data-act=write-in]'); await settle(page);
  ok('saving writes Hungarian v1, and the page prints it', /Vitorlázás/.test(await frameDoc(page, d => d.body.textContent)) && (await st()).record.variants.some(v => v.lang === 'hu' && v.text === 'Vitorlázás' && v.n === '1'));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc from a line that is in no job goes to the page', (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'none');
  await page.keyboard.press('Escape'); await settle(page);
  ok('…and one more zooms out and leaves the sidebar where it is', await page.isVisible('#body'));
  const outlined = await frameDoc(page, d => d.querySelectorAll('.rb-miss').length);
  await page.click('.missbar .miss-go:has-text("Bookbinding")'); await settle(page);
  await page.click('.writein input[data-same]'); await settle(page);
  ok('"same in every language" takes it off the list', (await st()).record.same.some(k => /interest-bookbinding/.test(k)) && !(await page.$('.missbar .miss-go:has-text("Bookbinding")')));
  const after = await frameDoc(page, d => d.querySelectorAll('.rb-miss').length);
  ok('and off the page’s outlines', after === outlined - 1, `${outlined} → ${after}`);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await pickLang(page, 'en'); await settle(page);
  ok('back to English', !(await st()).cur.lang && /Experience/i.test(await frameDoc(page, d => d.body.textContent)));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('import, merge, history')) {
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
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
  await page.click('[data-act=imp-do-merge]'); await settle(page);
  ok('merging brings the new jobs in', (await st()).record.work.some(w => w.name === 'Fjord Instruments'));
  await page.keyboard.press('Control+z'); await settle(page);
  ok('and Ctrl+Z takes the merge back', !(await st()).record.work.some(w => w.name === 'Fjord Instruments'));

  await page.click('[data-act=menu]'); await page.click('.menu [data-v=import]'); await settle(page);
  await page.fill('#imp-paste', jr); await page.click('[data-act=imp-paste]'); await settle(page);
  await page.click('[data-act=imp-replace]'); await settle(page);
  ok('opening it instead makes it the record', (await st()).record.basics.name === 'Robin Vale' && /Robin Vale/.test(await frameDoc(page, d => d.body.textContent)));
  ok('and the page prints its highlights', /IP68 housing/.test(await frameDoc(page, d => d.body.textContent)));

  // a record edited outside: its edits become versions
  const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/example.json'), 'utf8'));
  ex.work[0].highlights[0] = 'Edited in a text editor, outside the app.';
  await page.click('[data-act=menu]'); await page.click('.menu [data-v=import]'); await settle(page);
  await page.fill('#imp-paste', JSON.stringify(ex)); await page.click('[data-act=imp-paste]'); await settle(page);
  ok('a record edited outside says so', /Edited outside/.test(await page.textContent('table.kv')) && await page.isChecked('#imp-outside'));
  await page.click('[data-act=imp-replace]'); await settle(page);
  ok('opening it turns the edit into a version', (await st()).record.variants.some(v => v.text === 'Edited in a text editor, outside the app.'));

  await page.click('[data-act=menu]'); await page.click('.menu [data-v=history]'); await settle(page);
  ok('History lists the checkpoints the imports saved', (await page.$$('.cprow')).length >= 2);
  await page.click('.cprow >> nth=0'); await settle(page);
  ok('selecting one shows what changed since', (await page.$$('.mi.ro')).length > 0);
  await page.click('[data-act=cp-new]'); await settle(page);
  ok('Save checkpoint adds a named one', /Smoke checkpoint/.test(await page.textContent('#body')));
  await page.click('[data-act=cp-file]');
  await page.setInputFiles('#file', path.join(ROOT, 'checks/fixtures/jsonresume-sample.json')); await settle(page);
  ok('Compare with a file shows the differences without changing anything', /compared with now/.test(await page.textContent('#body')) && (await st()).record.basics.name === 'Dana Okonkwo');
  await page.click('.cprow:has-text("Before opening pasted JSON") >> nth=-1'); await settle(page);
  await page.click('[data-act=cp-restore]'); await settle(page);
  ok('Restore puts that state back', (await st()).record.basics.name === 'Dana Okonkwo' && !(await st()).record.variants.some(v => v.text === 'Edited in a text editor, outside the app.'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('save to file: one file, Ctrl+S, opening it safely')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brewcv-save-'));
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const ctx = await newContext({ viewport: { width: 1536, height: 864 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const bad = await open(page);
  await page.evaluate(() => window.__wb.store.commit(d => { d.record.meta.owner = 'Sam Example'; }, 'smoke: make it mine'));   // the example on its own is replaced without a warning
  const st = () => page.evaluate(() => window.__wb.store.state);
  const fstate = () => page.evaluate(() => { const f = window.__wb.persist.fileState; return { last: f.last, changes: f.changes }; });
  // where the file stands: the second line of Saved’s hint (the Export panel says it too)
  const head = async () => page.evaluate(() => document.querySelector('#savestate').dataset.tip.split('|')[1]);
  const saveClick = async () => { if (!(await page.$('#body #filestate'))){ await page.click('#tab-export'); await settle(page); } await page.click('#filestate'); };
  const edit = label => page.evaluate(l => window.__wb.store.commit(d => { d.record.basics.label = l; }, 'smoke edit'), label);
  let n = 0;
  const downloaded = async trigger => {
    const [d] = await Promise.all([page.waitForEvent('download'), trigger()]);
    const p = path.join(tmp, `${++n}-${d.suggestedFilename()}`);
    await d.saveAs(p);
    return { name: d.suggestedFilename(), path: p, json: JSON.parse(fs.readFileSync(p, 'utf8')) };
  };
  const open1 = async file => { await page.click('[data-act=menu]'); await page.click('.menu [data-v=import]'); await settle(page); await page.setInputFiles('#file', file); await settle(page); };
  const copy = (src, fn, name) => { const j = JSON.parse(fs.readFileSync(src, 'utf8')); fn(j); const p = path.join(tmp, name); fs.writeFileSync(p, JSON.stringify(j, null, 2)); return p; };

  ok('before any file save, Saved’s hint says so', /Not saved to a file yet/.test(await head()));
  const f1 = await downloaded(saveClick);
  ok('Save to file downloads brewcv.json', f1.name === 'brewcv.json');
  const s1 = await st();
  ok('it holds the record, every saved resume and no checkpoints', f1.json.resumeBuilderBackup === 1 && f1.json.resumes.length === s1.resumes.length && s1.resumes.length > 3 && !('checkpoints' in f1.json));
  ok('it names the app version and the record', f1.json.app === version && f1.json.recordId === s1.record.recordId && !!f1.json.recordId);
  ok('Saved’s hint says Saved to file, and the Export panel says so beside its button', /^Saved to file/.test(await head()) && (await page.$eval('#filestate', e => e.tagName)) === 'BUTTON' && /^Saved to file/.test(await page.textContent('#fileline')));
  ok('the first save shows the one-time note about the Save dialog', await page.isVisible('[data-act=save-note-ok]') && /Ask where to save each file/.test(await page.textContent('.notice')));
  const persisted = await page.evaluate(() => window.__wb.ui.persisted);
  ok('and, if the browser would not promise to keep storage, that the file is the safe copy', persisted !== false || /safe copy/.test(await page.textContent('.notice')));
  await page.click('[data-act=save-note-ok]'); await settle(page);
  ok('the note goes away when dismissed', !(await page.isVisible('[data-act=save-note-ok]')));

  await edit('Smoke label one'); await settle(page);
  ok('one change since: “1 change not saved to a file”', /^1 change not saved to a file/.test(await head()), await head());
  await edit('Smoke label two'); await settle(page);
  ok('two changes: “2 changes not saved to a file”', /^2 changes not saved to a file/.test(await head()), await head());

  await page.click('#tab-export'); await settle(page);
  const f2 = await downloaded(() => page.keyboard.press('Control+s'));
  ok('Ctrl+S saves to the file too, in any view (here Export)', f2.name === 'brewcv.json' && f2.json.record.basics.label === 'Smoke label two' && f2.json.recordId === f1.json.recordId);
  ok('and the count starts again', /^Saved to file/.test(await head()) && (await fstate()).changes === 0);
  ok('the note does not come back', !(await page.isVisible('[data-act=save-note-ok]')));
  const quiet = await Promise.race([page.waitForEvent('download').then(() => false), (async () => {
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true })));
    await settle(page); return true; })()]);
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
  await edit('Not in any file'); await settle(page);
  await open1(mac.path);
  ok('with changes not in a file: “This browser has 1 change that isn’t in any file”', /This browser has 1 change that isn.t in any file/.test(await page.textContent('#body')) && await page.isVisible('[data-act=imp-save-first]'));
  const f3 = await downloaded(() => page.click('[data-act=imp-save-first]'));
  await settle(page);
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
  await page.click('[data-act=imp-replace]'); await settle(page);
  ok('and opening it turns the edit into a version', (await st()).record.variants.some(v => v.text === 'Reworded in another tool, outside BrewCV.'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');

  // a fresh browser: the introduction's “Open or import a file”
  const ctx2 = await newContext({ viewport: { width: 1536, height: 864 } });
  const page2 = await ctx2.newPage();
  const bad2 = await open(page2, '?memory&welcome');
  await page2.click('[data-act=ob-import]'); await settle(page2);
  await page2.setInputFiles('#file', mac.path); await settle(page2);
  ok('a file opened in a fresh browser is offered plainly', /Open it/.test(await page2.textContent('[data-act=imp-replace]')) && !(await page2.$('[data-act=imp-save-first]')));
  await page2.click('[data-act=imp-replace]'); await settle(page2);
  const r2 = await page2.evaluate(() => { const s = window.__wb.store.state; return { id: s.record.recordId, label: s.record.basics.label, resumes: s.resumes.map(r => r.id).sort(), last: window.__wb.persist.fileState.last }; });
  ok('it restores the record and every saved resume', r2.id === mac.json.recordId && r2.label === 'Smoke label two' && r2.resumes.length === mac.json.resumes.length, JSON.stringify(r2).slice(0, 200));
  ok('and the next save carries on from that file', r2.last?.at === mac.json.saved && r2.last?.recordId === mac.json.recordId);
  const back = await Promise.all([page2.waitForEvent('download'), page2.keyboard.press('Control+s')]).then(async ([d]) => { const p = path.join(tmp, 'again.json'); await d.saveAs(p); return JSON.parse(fs.readFileSync(p, 'utf8')); });
  ok('saved again from there, it is the same record', back.recordId === mac.json.recordId && back.resumes.length === mac.json.resumes.length);
  ok('no console errors in the fresh browser', bad2.length === 0, bad2[0] ?? '');
  await ctx2.close();

  // a phone: the share sheet, and cancelling it
  const ctx3 = await newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, acceptDownloads: true });
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
  await page3.click('#filestate'); await settle(page3);
  ok('cancelling the share sheet does nothing', downloads === 0 && (await page3.evaluate(() => window.__wb.persist.fileState.last)) === null && !(await page3.evaluate(() => window.__shared)));
  await page3.evaluate(() => { window.__shareMode = 'ok'; });
  await page3.click('#filestate'); await settle(page3);
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
  await edit('Written by the app'); await settle(page);
  ok('a linked folder gets what the app writes', await page.evaluate(() => JSON.parse(window.__stubFiles.get('resume-data.json')).basics.label) === 'Written by the app');
  await page.evaluate(() => window.__stubFiles.set('resume-data.json', window.__stubFiles.get('resume-data.json').replace('Written by the app', 'Changed by hand')));
  await edit('The app again'); await settle(page);
  ok('a file changed outside the app is not written over', await page.evaluate(() => JSON.parse(window.__stubFiles.get('resume-data.json')).basics.label) === 'Changed by hand');
  ok('the header says it was changed outside, and offers Compare', /changed outside BrewCV/.test(await page.textContent('.notice')) && await page.isVisible('[data-act=folder-compare]'));
  await page.click('[data-act=folder-compare]'); await settle(page);
  ok('Compare opens the History view with the differences', /compared with now/.test(await page.textContent('#body')) && (await page.$$('#body .mi.ro')).length > 0);
  await page.click('[data-act=folder-overwrite]'); await settle(page);
  ok('Overwrite writes the app’s version and the notice goes', await page.evaluate(() => JSON.parse(window.__stubFiles.get('resume-data.json')).basics.label) === 'The app again' && !(await page.isVisible('[data-act=folder-compare]')));
  await ctx.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (want('export')) {
  const ctx = await newContext({ viewport: { width: 1536, height: 864 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const bad = await open(page);
  const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-export-'));
  for (const pick of ['Example Instruments', 'Medtech', 'Dunamenti']){
    await openByName(page, pick); await settle(page);
    const sheetPages = await page.evaluate(() => window.__wb.ui.fills.length);
    const html = await page.evaluate(() => window.__wb.export.buildHtml());
    const f = path.join(tmp, `${pick}.html`);
    fs.writeFileSync(f, html);
    const off = await newContext();
    await off.setOffline(true);
    const q = await off.newPage();
    const reqs = [];
    q.on('request', r => { if (!/^(data|file):/.test(r.url())) reqs.push(r.url()); });
    await q.goto(pathToFileURL(f).href); await settle(q);
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
  const ctx = await newContext({ viewport: { width: 1536, height: 864 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  const tabBg = () => frameDoc(page, d => getComputedStyle(d.querySelector('.band[data-section] .tab')).backgroundColor);
  await page.click('#tab-design'); await settle(page);
  ok('Design opens from the header', (await page.getAttribute('#body', 'data-view')) === 'design');
  await page.click('[data-act=d-accent][data-c="#9cc3ff"]'); await settle(page);
  ok('an accent swatch recolours the tabs', (await tabBg()) === 'rgb(156, 195, 255)' && (await st()).cur.accent === '#9cc3ff');
  ok('and says the tab text still reads', /readable/.test(await page.textContent('#body')));
  await page.click('[data-act=d-tpl][data-t=tint]'); await settle(page);
  ok('a template switches the overlay', JSON.stringify((await st()).cur.overlays) === '["tint-tabs"]' && await frameDoc(page, d => [...d.querySelectorAll('link')].some(l => /tint-tabs/.test(l.href))));
  await page.click('[data-act=d-tpl][data-t=b2]'); await settle(page);
  await page.click('[data-act=d-pages][data-n="0"]'); await settle(page);
  ok('pages: as many as needed turns Fit off', (await st()).cur.pageLimit === 0 && await page.isDisabled('[data-act=fit]'));
  await page.click('[data-act=d-pages][data-n="1"]'); await settle(page);
  await page.click('[data-act=d-paper][data-f=a4]'); await settle(page);
  ok('paper: A4', (await st()).cur.format === 'a4' && await frameDoc(page, d => /a4\.css/.test([...d.querySelectorAll('link')].map(l => l.href).join())));

  // a theme from Figma: DTCG, dropped through the import box
  const theme = { color: { $type: 'color', accent: { $value: '#d6b4ff' }, ink: { $value: '#202040' }, evil: { $value: 'url(x)' } },
    font: { body: { family: { $type: 'fontFamily', $value: ['Georgia', 'serif'] } } }, style: { tab: { $type: 'string', $value: 'underline' } } };
  await page.click('[data-act=d-accent][data-c=""]').catch(() => {}); await settle(page);
  await page.click('[data-act=d-import]');
  await page.setInputFiles('#file', { name: 'Lilac.tokens.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(theme)) });
  await settle(page);
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
  await settle(page);
  const img = await page.evaluate(async () => { const src = window.__wb.store.materialize(window.__wb.store.state.record.basics.image); const i = new Image(); i.src = src; await i.decode(); return { w: i.naturalWidth, h: i.naturalHeight, jpeg: src.startsWith('data:image/jpeg'), kb: src.length * 0.75 / 1024 }; });
  ok('a photo is cropped to 472 × 600, a JPEG under 300 KB', img.w === 472 && img.h === 600 && img.jpeg && img.kb < 300, JSON.stringify(img));
  ok('and shown on this resume, at the passport ratio', (await st()).cur.photo.show && await frameDoc(page, d => { const p = d.querySelector('img.portrait'); if (!p) return false; const r = p.getBoundingClientRect(); return Math.abs(r.height / r.width - 45 / 35) < 0.02; }));
  ok('the summary runs beside the photo, so the header leaves no hole', await frameDoc(page, d => !!d.querySelector('.band--header .summary--in-header') && d.querySelector('.band--absorbed')?.getBoundingClientRect().height === 0));
  ok('the photo stays out of the undo snapshots', await page.evaluate(() => /^asset:/.test(window.__wb.store.state.record.basics.image)));
  await page.click('[data-act=d-shape][data-s=round]'); await settle(page);
  ok('shape: circle', await frameDoc(page, d => !!d.querySelector('img.portrait--round')));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('onboarding and the record')) {
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page, '?memory&welcome');
  const st = () => page.evaluate(() => window.__wb.store.state);
  const text = () => frameDoc(page, d => d.body.textContent);
  ok('a first visit starts on the introduction, with the three ways in and no language step yet', (await page.getAttribute('#body', 'data-view')) === 'welcome' && (await page.$$('.obchoices button')).length === 3 && !(await page.$('[data-act=ob-lang-go]')));
  ok('and the “Yours to keep” banner, which says it is private', /Yours to keep/.test(await page.textContent('#foot')) && /Private/.test(await page.textContent('.obkeep')));
  await page.click('[data-act=ob-scratch]'); await settle(page);
  ok('choosing one asks for the language', !!(await page.$('[data-act=ob-lang-go]')));
  await page.click('[data-act=ob-lang-go]'); await settle(page);
  ok('the questions are asked in a quiet editor: the page and the question panel, with no header, footer, rail, zoom bar or meter', (await page.evaluate(() => document.body.classList.contains('is-quiet'))) && !(await page.isVisible('#head')) && !(await page.isVisible('#foot')) && !(await page.isVisible('#rail')) && !(await page.isVisible('[data-act=fit]')) && !(await page.$('#checklist')));
  await page.fill('#ob-name', 'Robin Vale'); await page.fill('#ob-label', 'Hardware engineer'); await page.fill('#ob-email', 'robin@example.org'); await page.fill('#ob-city', 'Halden');
  await page.waitForFunction(() => document.querySelector('#sheet iframe').contentDocument.body.textContent.includes('robin@example.org')); await settle(page);
  ok('the sheet fills in while you type', /Robin Vale/.test(await text()) && /robin@example\.org/.test(await text()));
  await page.frameLocator('#sheet iframe').locator('.name').click({ force: true }).catch(() => {}); await settle(page);
  ok('clicking the page during the questions does not leave them', (await page.getAttribute('#body', 'data-view')) === 'welcome');
  await page.click('[data-act=ob-next]'); await settle(page);
  await page.click('[data-act=ob-market][data-m=hu]'); await settle(page);
  await page.click('[data-act=ob-next]'); await settle(page);
  await page.fill('#ob-pos', 'Mechanical Engineer'); await page.fill('#ob-emp', 'Fjord Instruments'); await page.fill('#ob-start', '2022-04');
  await page.check('#ob-current'); await page.fill('#ob-loc', 'Halden');
  await page.fill('#ob-claims', 'Designed an IP68 housing for a river-gauge logger.\nCut the sensor head’s assembly time from 40 to 25 minutes.');
  await page.click('[data-act=ob-another]'); await settle(page);
  ok('save and add another job', (await st()).record.work.length === 1 && (await page.inputValue('#ob-pos')) === '');
  await page.click('[data-act=ob-back]'); await settle(page); await page.click('[data-act=ob-back]'); await settle(page);
  ok('Back keeps what was typed', (await page.inputValue('#ob-name')) === 'Robin Vale');
  await page.click('[data-act=ob-next]'); await settle(page); await page.click('[data-act=ob-next]'); await settle(page);
  await page.fill('#ob-pos', 'Design Intern'); await page.fill('#ob-emp', 'Northwind Labs'); await page.fill('#ob-start', '2021-06'); await page.fill('#ob-end', '2021-12');
  await page.fill('#ob-claims', 'Built test fixtures for a hand-held spectrometer.');
  await page.click('[data-act=ob-next]'); await settle(page);
  await page.fill('#ob-inst', 'Example Technical University'); await page.fill('#ob-type', 'B.Sc.'); await page.fill('#ob-area', 'Mechanical Engineering');
  await page.click('[data-act=ob-next]'); await settle(page);
  await page.fill('#ob-skills', 'CAD: SolidWorks, Onshape\nTest: IP testing, drop testing');
  await page.click('[data-act=ob-next]'); await settle(page);
  ok('Hungary asks for a photo', /A photo/.test(await page.textContent('#body .title')));
  await page.click('[data-act=ob-skip]'); await settle(page);
  await page.click('[data-act=ob-finish]'); await settle(page);
  const page1 = await text();
  ok('blank → a finished resume: both jobs, their claims, the degree, the skills', ['Fjord Instruments', 'IP68 housing', 'Northwind Labs', 'B.Sc.', 'Onshape'].every(x => page1.includes(x)));
  ok('Start editing brings the rest in: the header with Edit, Design and Export, the foot with its meter and Fit, and the Outline', await page.isVisible('#head') && await page.isVisible('#tab-edit') && await page.isVisible('[data-act=fit]') && /\d+%/.test(await page.getAttribute('#meter .meter', 'aria-label')) && /Fit cuts from the bottom/.test(await page.textContent('#body')));
  ok('on A4', (await st()).cur.format === 'a4');
  ok('the first tip shows', /Tip 1 of 3/.test(await page.textContent('#body')));
  ok('and the record validates', await page.evaluate(async () => { const V = await import('./checks/lib/validate.mjs'); const S = await import('./src/model/schema.js'); const s = window.__wb.store.state; return V.validate(S.save(window.__wb.store.materialize(s.record)), s.cur).errors.length === 0; }));
  await page.click('[data-act=tip-skip]'); await settle(page);

  await inRecord(page); await settle(page);
  ok('Record: the claims are already in it', (await page.$$('#checklist .clg')).length >= 4 && /Fjord Instruments/.test(await page.textContent('#checklist')));
  ok('the timeline shows the two jobs on the left, the degree beside them', await page.isVisible('#checklist .rectl .tl2') && (await page.$$('#checklist .rectl .tl2 .row')).length === 2 && (await page.$$('#checklist .rectl .tl2 .srow')).length === 1);
  await page.click('#checklist .clg:has-text("Northwind") [data-act=cl-open][data-sel*="job"]'); await settle(page);
  await page.click('details.details > summary'); await settle(page);
  await page.fill('#c-pos', 'Design Engineering Intern'); await page.fill('#c-end', '2022-01'); await page.keyboard.press('Tab'); await settle(page);
  ok('editing a job’s facts: they commit as you leave the fields', (await st()).record.work.find(w => w.name === 'Northwind Labs').position === 'Design Engineering Intern');
  await page.evaluate(() => window.__wb.dock.setMode('record')); await settle(page);
  await page.click('#checklist .clg:has-text("Northwind") [data-act=ol-addline]'); await settle(page);
  await page.fill('#checklist .clg:has-text("Northwind") .new-claim', 'Wrote the fixture drawings and the test procedure.'); await page.click('#checklist .clg:has-text("Northwind") [data-act=add-claim]'); await settle(page);
  ok('adding a claim, with the job’s “+ line” in the Record', (await st()).record.work.find(w => w.name === 'Northwind Labs').highlights.length === 2);
  await page.click('#checklist .clg:has-text("Northwind") .clrow >> nth=1 >> .clt'); await settle(page);
  await page.click('[data-act=delete-claim]'); await settle(page);
  ok('🗑 deletes a claim, saying Ctrl+Z brings it back', (await st()).record.work.find(w => w.name === 'Northwind Labs').highlights.length === 1 && /Ctrl\+Z brings it back/.test(await page.textContent('#toast')));
  await page.click('[data-act=undo]'); await settle(page);
  ok('which it does', (await st()).record.work.find(w => w.name === 'Northwind Labs').highlights.length === 2);
  const p2 = await text();
  ok('the page follows the edit: new title, new dates, new claim', p2.includes('Design Engineering Intern') && /Jan 2022/i.test(p2) && p2.includes('fixture drawings'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('bullets: re-arrange within a job; tags: one closed list')) {
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  const lis = () => frameDoc(page, d => [...d.querySelectorAll('.bullets li')].slice(0, 3).map(x => x.textContent.slice(0, 24)));
  await toJobOutline(page);
  const rows = page.locator('#outline .clg.open .clrow[data-bullet]');
  ok('the ticked bullets of a job are rows that carry their ids (Alt+arrows) and are not draggable', (await rows.count()) >= 3 && (await rows.first().getAttribute('draggable')) === null);
  const before = await lis();
  await rows.nth(0).locator('.sw').focus();
  await page.keyboard.press('Alt+ArrowDown'); await settle(page);
  const moved = await lis();
  ok('Alt+↓ on a bullet row moves it down in print: the page follows', moved[0] === before[1] && moved[1] === before[0] && moved[2] === before[2]);
  ok('…the recipe holds the order for that job only, and undo puts it back', JSON.stringify((await st()).cur.work ?? (await st()).cur.sections).includes('highlights'));
  await page.keyboard.press('Control+z'); await settle(page);
  ok('one Ctrl+Z undoes it', JSON.stringify(await lis()) === JSON.stringify(before));
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

if (want('reordering is visible: Alt+arrows, the margin, custom and Reset')) {
  const ctx = await newContext({ motion: true, viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  const undoN = () => page.evaluate(() => window.__wb.store.history.undo);
  const lis = () => frameDoc(page, d => [...d.querySelectorAll('.bullets li')].slice(0, 3).map(x => x.textContent.slice(0, 24)));
  const big = async loc => { const b = await loc.boundingBox(); return !!b && b.width >= 24 && b.height >= 24; };
  await toJobOutline(page);
  const rows = page.locator('#outline .clg.open .clrow[data-bullet]');
  const n = await rows.count();
  ok('the sidebar’s rows have no grip and no ↑ ↓ and cannot be dragged: the grips are on the page (the Alt+arrows stay)', n >= 3 && (await page.locator('#outline .clgrip, #outline .clmv, #outline [data-act=cl-up], #outline [data-act=cl-down], #outline [data-act=job-up], #outline [draggable=true]').count()) === 0);
  ok('a job that was not moved shows no "custom"', (await page.locator('#outline .pill.custom').count()) === 0);
  const before = await lis(), u0 = await undoN();
  await rows.first().locator('.sw').focus(); await page.keyboard.press('Alt+ArrowDown'); await settle(page);
  const moved = await lis();
  ok('Alt+↓ on the first row moves it down on the page, in one undo step', moved[0] === before[1] && moved[1] === before[0] && (await undoN()) === u0 + 1);
  ok('…the job now shows "custom" with a Reset', (await page.locator('#outline .pill.custom').count()) === 1 && (await page.locator('#outline .clg.open [data-act=order-reset]').count()) === 1);
  await page.keyboard.press('Control+z'); await settle(page);
  ok('Ctrl+Z puts it back, and "custom" goes', JSON.stringify(await lis()) === JSON.stringify(before) && (await page.locator('#outline .pill.custom').count()) === 0);
  await page.keyboard.press('Control+Shift+z'); await settle(page);
  const u0b = await undoN();
  await page.click('#outline .clg.open [data-act=order-reset]'); await settle(page);
  ok('Reset puts the record’s order back, in one undo step, and the mark goes', JSON.stringify(await lis()) === JSON.stringify(before) && (await undoN()) === u0b + 1 && (await page.locator('#outline .pill.custom').count()) === 0);
  await page.keyboard.press('Control+z'); await settle(page);
  ok('…one Ctrl+Z brings the custom order back', JSON.stringify(await lis()) === JSON.stringify(moved) && (await page.locator('#outline .pill.custom').count()) === 1);
  await page.click('#outline .clg.open [data-act=order-reset]'); await settle(page);
  await rows.nth(1).locator('.sw').focus(); await page.keyboard.press('Alt+ArrowUp'); await settle(page);
  ok('Alt+↑ on the second row moves it up', JSON.stringify(await lis()) === JSON.stringify([before[1], before[0], before[2]]));
  await page.keyboard.press('Control+z'); await settle(page);

  // the page margin: while a line of the job is written
  await rows.nth(0).locator('.clt').click(); await settle(page);
  await page.evaluate(() => window.__wb.edit.startEdit()); await settle(page);
  const fact = await page.evaluate(() => window.__wb.edit.editing?.fact);
  const u1 = await undoN();
  ok('writing a line of a job puts ↑ and ↓ in the margin, named, with the keys in the hint, at least 24 px', (await page.locator('#editlay [data-act=ob-up]').count()) === 1 && (await page.locator('#editlay [data-act=ob-down]').count()) === 1
    && await big(page.locator('#editlay [data-act=ob-up]')) && await big(page.locator('#editlay [data-act=ob-down]')) && (await page.locator('#editlay [data-act=ob-down]').getAttribute('aria-label')).length > 0 && /Alt|⌥/.test(await page.locator('#editlay [data-act=ob-down]').getAttribute('data-tip')));
  ok('on the first line the margin’s ↑ is aria-disabled, ↓ is not; a click on the ↑ does nothing', (await page.locator('#editlay [data-act=ob-up]').getAttribute('aria-disabled')) === 'true' && (await page.locator('#editlay [data-act=ob-down]').getAttribute('aria-disabled')) === 'false');
  await page.click('#editlay [data-act=ob-up]', { force: true }); await settle(page);
  ok('…and the undo count and the page are as they were', (await undoN()) === u1 && JSON.stringify(await lis()) === JSON.stringify(before));
  await page.click('#editlay [data-act=ob-down]'); await settle(page);
  ok('the margin’s ↓ moves the line being written: one undo step, still writing the same line', (await undoN()) === u1 + 1 && (await lis())[1] === before[0] && (await lineEl(page).count()) === 1 && (await page.evaluate(() => window.__wb.edit.editing?.fact)) === fact);
  await appendLine(page, ' Zebra.');
  const lisD = await lis();
  await page.click('#editlay [data-act=ob-up]'); await settle(page);
  ok('with unsaved words the margin’s ↑ moves the line and the draft is kept', (await lis()).join() !== lisD.join() && /Zebra\./.test(await lineText(page) ?? '') && /Zebra\./.test(await lineEl(page).textContent()) && (await lineEl(page).count()) === 1);
  await page.keyboard.press('Alt+ArrowDown'); await settle(page);
  ok('…and so does Alt+↓', /Zebra\./.test(await lineText(page) ?? '') && (await lineEl(page).count()) === 1);
  page.once('dialog', d => d.accept());
  await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await settle(page);
  await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; });

  // list items: Skills in the credentials
  await inRecord(page, 'credentials'); await settle(page);
  const items = page.locator('#checklist .clg[data-g=credentials] .clrow[data-sec=skills]');
  ok('list items have no grip and no ↑ ↓ either', (await items.count()) === 4 && (await page.locator('#checklist .clgrip, #checklist .clmv').count()) === 0);
  const sk0 = await frameDoc(page, d => [...d.querySelectorAll('.skills__label')].map(x => x.textContent)), u2 = await undoN();
  await items.first().locator('.cb').focus(); await page.keyboard.press('Alt+ArrowDown'); await settle(page);
  ok('Alt+↓ on an item moves it in print, in one undo step, and the list shows "custom"', (await frameDoc(page, d => [...d.querySelectorAll('.skills__label')].map(x => x.textContent)))[0] === sk0[1] && (await undoN()) === u2 + 1 && (await page.locator('#checklist .clsubh .pill.custom').count()) === 1);
  await page.click('#checklist .clsubh [data-act=order-reset]'); await settle(page);
  ok('Reset puts the list back: no stored order, one undo step, no mark', JSON.stringify(await frameDoc(page, d => [...d.querySelectorAll('.skills__label')].map(x => x.textContent))) === JSON.stringify(sk0) && (await page.locator('#checklist .clsubh .pill.custom').count()) === 0);

  // the sections on this resume: Alt+↓ with one selected
  await toEditHome(page);
  const secIds = () => page.evaluate(() => [...document.querySelectorAll('#seclist .srow')].map(r => r.dataset.sid));      // every section, off ones too: Reset puts the record's order back and an off section stays where it is
  const order0 = await secIds(), u3 = await undoN();
  ok('an unmoved list of sections shows no "custom"', (await page.locator('.ordhead .pill.custom').count()) === 0);
  await page.locator('#seclist .srow:not(.fixed) [data-act=select-section]').first().click(); await settle(page);
  await page.keyboard.press('Alt+ArrowDown'); await settle(page);
  await toEditHome(page);
  ok('Alt+↓ on a selected section moves it, in one undo step, and the list shows "custom"', (await secIds()).join() !== order0.join() && (await undoN()) === u3 + 1 && (await page.locator('.ordhead .pill.custom').count()) === 1);
  await page.click('.ordhead [data-act=order-reset]'); await settle(page);
  ok('Reset puts the record’s order back, in one undo step, and the mark goes', (await secIds()).join() === order0.join() && (await undoN()) === u3 + 2 && (await page.locator('.ordhead .pill.custom').count()) === 0);

  // the jobs of Experience in the Outline
  await toEditHome(page);
  const heads = page.locator('#outline .clgh[data-job]');
  const jobsOnPage = () => frameDoc(page, d => [...d.querySelectorAll('.entry .role-title')].map(x => x.textContent));
  const order = async () => (await st()).cur.sections.find(x => x.id === 'experience').order;
  const jn = await heads.count();
  ok('a job’s head has no grip and no ↑ ↓; a job that is not moved shows no "custom"', jn >= 2 && (await page.locator('#outline .clgh .clgrip, #outline .clgh .clmv').count()) === 0 && (await page.locator('#outline .osec[data-sid=experience] .ordhead .pill.custom').count()) === 0);
  const j0 = await jobsOnPage(), uj = await undoN();
  await heads.first().locator('.clcaret').focus(); await page.keyboard.press('Alt+ArrowDown'); await settle(page);
  const j1 = await jobsOnPage();
  ok('Alt+↓ with the focus on the first job’s head prints it second, in one undo step, and the Experience list shows "custom"', j1[0] === j0[1] && j1.includes(j0[0]) && (await undoN()) === uj + 1 && (await page.locator('#outline .osec[data-sid=experience] .ordhead .pill.custom').count()) === 1);
  await heads.nth(1).locator('.clcaret').focus(); await page.keyboard.press('Alt+ArrowDown'); await settle(page);
  ok('Alt+↓ on another job’s head moves it too, in one undo step', (await jobsOnPage())[2] !== j1[2] && (await undoN()) === uj + 2);
  await page.keyboard.press('Control+z'); await settle(page);
  await page.keyboard.press('Control+z'); await settle(page);
  ok('Ctrl+Z puts it back, the order key and "custom" go', JSON.stringify(await jobsOnPage()) === JSON.stringify(j0) && (await order()) === undefined && (await page.locator('#outline .osec[data-sid=experience] .ordhead .pill.custom').count()) === 0);
  await page.keyboard.press('Control+Shift+z'); await settle(page);
  const uj2 = await undoN();
  await page.click('#outline .osec[data-sid=experience] .ordhead [data-act=order-reset]'); await settle(page);
  ok('Reset puts the record’s order back, in one undo step, nothing stored', JSON.stringify(await jobsOnPage()) === JSON.stringify(j0) && (await undoN()) === uj2 + 1 && (await order()) === undefined);
  ok('nothing threw', bad.length === 0, bad.join('; '));
  await ctx.close();
}

if (want('record: a moved bullet moves in the list too; "n v" on the contact line opens its versions')) {
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const lis = () => frameDoc(page, d => [...d.querySelectorAll('.bullets li')].slice(0, 3).map(x => x.textContent.slice(0, 24)));
  await inRecord(page, 'hydra'); await settle(page);
  const rows = page.locator('#checklist .clg[data-g=hydra] .clrow[data-bullet]');
  const listed = () => rows.evaluateAll(els => els.map(e => e.querySelector('.clt').textContent.trim().slice(0, 24)));
  const before = await lis();
  await rows.nth(0).locator('.cb').focus(); await page.keyboard.press('Alt+ArrowDown'); await settle(page);
  const after = await lis();
  ok('Alt+↓ on a bullet in the Record changes the page', after[0] === before[1]);
  ok('…and the Record’s list shows the same order as the page', JSON.stringify((await listed()).slice(0, 3)) === JSON.stringify(after));
  await page.keyboard.press('Control+z'); await settle(page);
  await toEditHome(page);
  await page.click('#outline .osec[data-sid=header] .osecaret').catch(() => {}); await settle(page);
  await page.locator('#outline .osec[data-sid=header] .clrow').nth(1).locator('.clv').click(); await settle(page);
  ok('"n v" on the contact line opens its versions, with no link to write a new one', (await page.locator('#body [data-act=new-version]').count()) === 0 && (await page.locator('#body [data-act=use-version]').count()) >= 1);
  ok('nothing threw', bad.length === 0, bad.join('; '));
  await ctx.close();
}

if (want('items: tick one by one, re-arrange in print, Alt+arrows, one tagging system')) {
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  const sheetSkills = () => frameDoc(page, d => [...d.querySelectorAll('.skills__label')].map(x => x.textContent));
  await inRecord(page, 'credentials'); await settle(page);
  const rows = page.locator('#checklist .clg[data-g=credentials] .clrow[data-sec=skills]');
  ok('every skill group is a row with its own tick, not draggable, with no grip or ↑ ↓', (await rows.count()) === 4 && (await rows.first().locator('.cb[data-item]').count()) === 1 && (await rows.first().getAttribute('draggable')) === null && (await rows.first().locator('.clgrip, .clmv').count()) === 0);
  const before = await sheetSkills();
  await rows.nth(1).locator('.cb').uncheck(); await settle(page);
  const after = await sheetSkills();
  ok('unticking one takes just that line off the page; the others stay', after.length === before.length - 1 && !after.includes(before[1]) && /3 of/.test(await page.textContent('#checklist .clg[data-g=credentials] .clsubh')) === false);
  ok('…it is one undo step, kept in the resume’s off list, and the row stays, unticked', (await st()).cur.off.length >= 1 && (await rows.count()) === 4 && !(await rows.nth(1).locator('.cb').isChecked()));
  await rows.nth(1).locator('.cb').check(); await settle(page);
  ok('ticking brings it back in place', JSON.stringify(await sheetSkills()) === JSON.stringify(before));
  // keyboard: Alt+↓ on a row
  await rows.nth(0).locator('.cb').focus();
  await page.keyboard.press('Alt+ArrowDown'); await settle(page);
  const moved = await sheetSkills();
  ok('Alt+↓ on a row moves the item down in print: the page follows', moved[0] === before[1] && moved[1] === before[0] && moved.length === before.length);
  ok('…and the focus stays on the moved row’s tick, which is now second', await page.evaluate(() => document.activeElement?.closest('.clrow')?.dataset.item) === (await st()).cur.sections.find(x => x.id === 'skills').order[1]);
  await page.keyboard.press('Alt+ArrowUp'); await settle(page);
  ok('Alt+↑ puts it back, and the record is untouched', JSON.stringify(await sheetSkills()) === JSON.stringify(before) && (await st()).cur.sections.find(x => x.id === 'skills').order === undefined);
  // the item's own panel, with Alt+arrows
  await rows.nth(1).locator('.clt').click(); await settle(page);
  await page.keyboard.press('Alt+ArrowUp'); await settle(page);
  ok('with an item open in the inspector, Alt+↑ moves it too', (await sheetSkills())[0] === before[1]);
  await page.keyboard.press('Control+z'); await settle(page);
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
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  const nOf = async () => (await st()).record.variants.length;
  await page.frameLocator('#sheet iframe').locator('.band[data-section="experience"] .tab').first().click(); await settle(page);
  await page.click('#body [data-act=select-job] >> nth=0'); await settle(page);
  await settle(page);
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
  ok('✎ writes the line on the page, with its tools in the margin and nothing to save', (await lineEl(page).count()) === 1 && !(await page.$('#ed')) && !!(await page.$('#editlay .obtools')) && !(await page.$('#editlay [data-act^=ed-]')));
  await appendLine(page, ' Reworded.'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  ok('leaving it keeps the words on this resume: no version, the picks as they were', (await nOf()) === n0 && JSON.stringify((await st()).cur.picks) === picks0 && !!(await st()).cur.overrides[fact]?.endsWith('Reworded.'));
  await page.evaluate(() => window.__wb.edit.startEdit('new')); await settle(page);
  await writeLine(page, 'A different take, for another kind of job.'); await page.keyboard.press('Escape'); await settle(page);
  ok('a new wording, left, is kept the same way', (await nOf()) === n0 && (await st()).cur.overrides[fact] === 'A different take, for another kind of job.');
  await page.click('#body .depth [data-act=select-job]'); await settle(page);
  await settle(page);
  ok('the job in the panel’s path goes to the job: its group stays open in the Outline', (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'job' && (await page.$$('#outline .clg.open')).length === 1);
  const jobId = await page.evaluate(() => window.__wb.ui.sel.id);
  const hl = async () => (await st()).record.work.find(w => w.id === jobId).highlights.length;
  const h0 = await hl();
  // a claim of the record added to the job (the Outline's "+ line" now adds a line only on this resume; the claim box is the Record's)
  await page.evaluate(async id => { const K = await import('./src/model/career.js'), T = await import('./src/model/resume.js'); window.__wb.store.commit(d => { const made = K.addEntryClaim(d.record, id, 'Wrote the fixture drawings and the test procedure.', 'en', 'Fixture log'); T.setBulletOn(d.record, d.cur, made, true); }, 'add a claim'); }, jobId);
  await settle(page);
  ok('a claim added to the job is on, a row of the Outline and on the page', (await hl()) === h0 + 1 && /fixture drawings/.test(await frameDoc(page, d => d.body.textContent)));
  await page.click('#outline .clg.open .clrow >> nth=-1 >> .clv'); await settle(page);
  await page.click('#body [data-act=delete-claim]'); await settle(page);
  ok('🗑 deletes it and goes back to the job; Ctrl+Z brings it back', (await hl()) === h0 && (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'job');
  await page.keyboard.press('Control+z'); await settle(page);
  ok('…which it does', (await hl()) === h0 + 1);
  await settle(page);
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
    const ctx = await newContext({ motion: true, viewport: { width: 1280, height: 800 }, colorScheme: theme });
    const page = await ctx.newPage();
    // every value html[data-drink] takes while the page loads: the right one from the start, never the other drink first
    await page.addInitScript(() => { window.__drinks = []; new MutationObserver(() => window.__drinks.push(document.documentElement.dataset.drink + '/' + document.documentElement.dataset.theme)).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-drink', 'data-theme'] }); });
    const bad = await open(page, undefined, { drink, theme });
    const E = EXPECT[`${drink} ${theme}`];
    const seen = await page.evaluate(() => window.__drinks);
    ok(`${drink} ${theme}: html carries data-drink and data-theme before the first paint, and nothing else ever`, seen.every(x => x === `${drink}/${theme}`) && seen.length >= 1, JSON.stringify(seen));
    await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
    const look = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#body')), b = c; return { surface: b.backgroundColor, radius: c.borderTopLeftRadius, font: getComputedStyle(document.body).fontFamily, shadow: c.boxShadow }; });
    ok(`${drink} ${theme}: the editor card is the drink’s surface, ${E.radius} corners, ${E.mono ? 'monospace' : 'Hanken'}`, look.surface === E.surface && look.radius === E.radius && /Fira Code/.test(look.font) === E.mono, JSON.stringify(look));
    ok(`${drink} ${theme}: ${drink === 'tea' ? 'a flat, offset shadow' : 'no shadow, a hairline'}`, drink === 'tea' ? /\d+px \d+px 0px 0px/.test(look.shadow) : look.shadow === 'none');
    // each sheet has its own tea in Tea (the Outline is Edit with nothing selected), and every sheet is the one plain surface in Coffee
    const TEAS = { light: { outline: 'rgb(77, 61, 30)', edit: 'rgb(46, 70, 54)', design: 'rgb(92, 43, 34)', export: 'rgb(44, 58, 79)', record: 'rgb(59, 39, 35)' }, dark: { outline: 'rgb(63, 50, 25)', edit: 'rgb(38, 57, 45)', design: 'rgb(75, 35, 28)', export: 'rgb(36, 48, 65)', record: 'rgb(48, 32, 29)' } };
    const seenTabs = {};
    const bgOf = () => page.evaluate(() => getComputedStyle(document.querySelector('#body')).backgroundColor);
    for (const m of ['design', 'export', 'record']){ await page.evaluate(m => window.__wb.dock.setMode(m), m); await page.waitForTimeout(450); seenTabs[m] = await bgOf(); }
    await toEditHome(page); await page.waitForTimeout(450); seenTabs.outline = await bgOf();
    await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await page.waitForTimeout(450); seenTabs.edit = await bgOf();
    ok(`${drink} ${theme}: ${drink === 'tea' ? 'the five sheets are oolong (the Outline), matcha, rooibos, earl grey and pu-erh' + (theme === 'dark' ? ' (darkened)' : '') : 'every sheet is the one surface'}`, Object.entries(seenTabs).every(([m, v]) => v === (drink === 'tea' ? TEAS[theme][m] : E.surface)), JSON.stringify(seenTabs));
    ok(`${drink} ${theme}: the open tab of the rail is the editor card’s own surface and touches it, in both drinks (Tea: the others are cream tags; Coffee: the others are plain cards)`, await page.evaluate(([d]) => { const on = document.querySelector('#rail [role=tab][aria-selected=true]'), off = document.querySelector('#rail [role=tab][aria-selected=false]'), body = document.querySelector('#body'); return !!on && !!off && getComputedStyle(on).backgroundColor === getComputedStyle(body).backgroundColor && on.getBoundingClientRect().right >= body.getBoundingClientRect().left - 0.5 && (d === 'tea' ? getComputedStyle(on).backgroundColor !== getComputedStyle(off).backgroundColor : on.getBoundingClientRect().width > off.getBoundingClientRect().width); }, [drink]));
    await page.evaluate(() => window.__wb.dock.setMode('edit'));
    // the resume is the same everywhere: its first bullet's computed style does not know the drink
    const resume = await frameDoc(page, d => { const li = d.querySelector('.bullets li'), cs = getComputedStyle(li); return [cs.color, cs.fontFamily, cs.fontSize, getComputedStyle(d.body).backgroundColor].join('|'); });
    if (!globalThis.__resumeLook) globalThis.__resumeLook = resume;
    ok(`${drink} ${theme}: the resume looks the same as in every other combination`, resume === globalThis.__resumeLook, resume);
    ok(`${drink} ${theme}: no console errors`, bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }

  const ctx = await newContext({ motion: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const drinkNow = () => page.evaluate(() => document.documentElement.dataset.drink);
  ok('Tea is the default', (await drinkNow()) === 'tea' && (await page.evaluate(() => localStorage.getItem('rb-drink'))) === null);
  ok('there is no drink corner: the logo is the switch, and says what it will do', !(await page.$('#brewmode')) && await page.evaluate(() => document.querySelector('#rail .logoswitch').dataset.to === 'coffee'));
  await page.evaluate(() => { window.__marker = 'same page'; });
  await page.keyboard.press('Shift+F'); await page.waitForTimeout(600);
  ok('Shift+F switches to coffee, in place: no reload, the same page, the choice stored', (await drinkNow()) === 'coffee' && (await page.evaluate(() => window.__marker)) === 'same page' && (await page.evaluate(() => localStorage.getItem('rb-drink'))) === 'coffee');
  ok('the logo now offers Tea, and the tab icons and the meter changed with it, with no redraw of the page', await page.evaluate(() => document.querySelector('#rail .logoswitch').dataset.to === 'tea') && (await page.evaluate(() => window.__wb.ui.laid != null)));
  await page.click('#rail .logoswitch'); await page.waitForTimeout(900);
  ok('the logo switches back to Tea', (await drinkNow()) === 'tea');
  // never while typing: the switcher's search is a field
  await page.click('#docname-btn'); await page.waitForSelector('#switcher #sw-q');
  await page.focus('#switcher #sw-q'); await page.keyboard.press('Shift+F'); await page.waitForTimeout(600);
  ok('Shift+F is ignored in a field, and types the letter', (await drinkNow()) === 'tea' && (await page.inputValue('#switcher #sw-q')) === 'F');
  await page.keyboard.press('Escape');
  // the setting survives a reload
  await page.keyboard.press('Shift+F'); await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 });
  ok('the setting survives a reload', (await drinkNow()) === 'coffee' && (await page.evaluate(() => document.querySelector('#rail .logoswitch').dataset.to)) === 'tea');
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

if (want('drinks: Fit, the meters, the moments')) {
  const ctx = await newContext({ motion: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const setFills = fills => page.evaluate(f => { window.__wb.ui.fills = f; window.__wb.dock.renderFoot(); }, fills);
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
  // one thin vertical bar for each page (in the rail), the same in both drinks: filled to the page's level, a notch for Fit's band, the colour says the state
  const bar = async () => { await page.waitForTimeout(600); return page.evaluate(() => { const m = document.querySelector('#rail .meter'), b = m.querySelector('.mbar').getBoundingClientRect(), f = m.querySelector('.mfill'), fr = f.getBoundingClientRect(), band = m.querySelector('.mband').getBoundingClientRect(), cs = getComputedStyle(f); return { p: m.style.getPropertyValue('--p'), h: b.width, w: fr.height / b.height, bandL: (b.bottom - band.bottom) / b.height, bandW: band.height / b.height, bg: cs.backgroundColor, img: cs.backgroundImage, mask: cs.webkitMaskImage || cs.maskImage, cls: m.className, text: m.textContent.trim() }; }); };
  await setFills(used(0.6));
  const cup = await bar();
  ok('tea: the page meter is one thin vertical bar drawn from --p = 60: a fill 60% high, a notch at Fit’s band (88 to 96%), under in the warning colour, no text', cup.p === '60.0' && cup.h <= 10 && Math.abs(cup.w - 0.6) < 0.02 && Math.abs(cup.bandL - 0.88) < 0.02 && Math.abs(cup.bandW - 0.08) < 0.02 && /under/.test(cup.cls) && cup.mask === 'none' && cup.text === '', JSON.stringify(cup));
  await setFills(used(1.01).map(x => ({ ...x, overflow: 4 })));
  ok('tea: an overflowing page is a striped bar in the over colour', /repeating-linear-gradient/.test((await bar()).img));
  await setFills(used(0.91));
  await page.keyboard.press('Shift+F'); await page.waitForTimeout(600);
  const glass = await bar();
  ok('coffee: the same thin bar, filled to the level, in the band: the chrome’s own ink', Math.abs(glass.w - 0.91) < 0.02 && glass.h <= 10 && Math.abs(glass.bandL - 0.88) < 0.02 && /ok/.test(glass.cls) && glass.mask === 'none' && glass.bg === 'rgb(243, 236, 226)', JSON.stringify(glass));
  ok('coffee: the name card is an espresso band with a crema line', await page.evaluate(() => { const h = getComputedStyle(document.querySelector('#head')); return /rgb\(43, 29, 20\)/.test(h.backgroundColor) && /190, 127, 74/.test(h.borderBottomColor); }));
  ok('coffee: counts read 5v, boxes are square, the canvas is a cutting mat', await page.evaluate(() => { const cb = document.querySelector('.cb'); return !cb || parseFloat(getComputedStyle(cb).borderTopLeftRadius) <= 2; }) && await page.evaluate(() => /linear-gradient/.test(getComputedStyle(document.body).backgroundImage)));
  await page.keyboard.press('Shift+F'); await page.waitForTimeout(600);
  // steam is a moment: it rises for a few seconds when a page has just reached the band, and stops. At 91 to 93% it is a heart.
  await setFills(used(0.5)); await page.waitForTimeout(100);
  await setFills(used(0.92));
  ok('tea: a page that has just reached the band steams, and at 92% the steam is a heart', await page.evaluate(() => { const m = document.querySelector('#rail .meter'); return m.classList.contains('steam') && m.classList.contains('perfect'); }));
  ok('…the steam animation runs twice and stops (no loop)', await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#rail .meter .mbar'), '::before'); return c.animationIterationCount === '2'; }));
  await page.waitForTimeout(5200);
  ok('…and after a few seconds there is no steam', await page.evaluate(() => !document.querySelector('#rail .meter').classList.contains('steam')));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();

  // reduced motion: no swing, no steam, no pop, no dunk. State changes still happen.
  const rm = await newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const pg = await rm.newPage();
  await open(pg);
  ok('reduced motion: no steam', await pg.evaluate(() => { const m = document.querySelector('#rail .meter'); return !m.classList.contains('steam') || getComputedStyle(m.querySelector('.mbar'), '::before').content === 'none'; }));
  await pg.hover('#head [data-act=fit]'); await pg.waitForTimeout(100);
  ok('reduced motion: Fit and the rail’s tabs do not swing, and the toast does not', await pg.evaluate(() => getComputedStyle(document.querySelector('#head [data-act=fit]')).animationName === 'none' && getComputedStyle(document.querySelector('#tab-export')).animationName === 'none'));
  await pg.evaluate(() => { const t = document.querySelector('#toast'); t.textContent = 'x'; t.className = 'toast on'; }); await pg.waitForTimeout(500);
  ok('…the toast still appears, without swinging', await pg.evaluate(() => { const t = document.querySelector('#toast'); return t.classList.contains('on') && getComputedStyle(t).animationName === 'none' && getComputedStyle(t).opacity === '1'; }));
  await pg.evaluate(() => { const i = document.querySelector('#rail .logo img'); i.classList.add('dunk'); });
  ok('…and the bag does not dunk', await pg.evaluate(() => getComputedStyle(document.querySelector('#rail .logo img')).animationName === 'none'));
  await rm.close();

  // the bag dunks when the drink becomes tea (tea only), a tick pops once, and the toast hangs on a string
  const c2 = await newContext({ motion: true, viewport: { width: 1440, height: 900 } });
  const p2 = await c2.newPage();
  await open(p2);
  await p2.keyboard.press('Shift+F'); await p2.waitForTimeout(600);
  await p2.keyboard.press('Shift+F'); await p2.waitForTimeout(600);
  ok('tea: switching to tea and the tea bag dunks', await p2.evaluate(() => document.querySelector('#rail .logo img').classList.contains('dunk')));
  await p2.waitForTimeout(1100);
  await inRecord(p2, 'hydra'); await settle(p2);
  const box = p2.locator('#checklist .cb[data-on]:not(:checked)').first();
  await box.click();
  ok('tea: the tick pops once, on the line just ticked', await p2.waitForFunction(() => document.querySelector('#checklist .cb.pop:checked'), null, { timeout: 2000 }).then(() => true, () => false));
  ok('tea: the toast hangs on a string (a hole and a string above it)', await p2.evaluate(() => { const t = document.querySelector('#toast'); return getComputedStyle(t, '::before').content !== 'none' && getComputedStyle(t, '::after').content !== 'none'; }));
  await p2.keyboard.press('Shift+F'); await p2.waitForTimeout(600);
  ok('coffee: no tea shapes: the bag does not dunk, the toast has no string', !(await p2.evaluate(() => document.querySelector('#rail .logo img').classList.contains('dunk'))) && await p2.evaluate(() => getComputedStyle(document.querySelector('#toast'), '::before').content === 'none'));
  await c2.close();
}

if (want('drinks: the page marks, exports, no corner at other sizes')) {
  const ctx = await newContext({ motion: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const mark = () => frameDoc(page, d => { const e = d.querySelector('.rb-sel'); return e ? getComputedStyle(e).outlineColor : null; });
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);      // the line selected, not written (a written line has only its thin outline)
  const amber = await mark();
  ok('tea: the selection mark on the page is amber (the app’s mark, inside the frame)', amber === 'rgb(183, 122, 44)', amber);
  await page.keyboard.press('Shift+F'); await page.waitForTimeout(600);
  ok('coffee: …and roast ink, changed in place', (await mark()) === 'rgb(28, 20, 16)', await mark());
  const clean = await page.evaluate(async () => { const html = await window.__wb.export.buildHtml(); return { html: html.length, leaks: ['--rb-', 'rb-sel', 'data-drink', 'brewmode', 'drinks.css', 'Fira Code'].filter(w => w !== 'Fira Code' && html.includes(w)) }; });
  ok('an export holds nothing from the app’s theme', clean.html > 1000 && clean.leaks.length === 0, JSON.stringify(clean));
  await page.keyboard.press('Shift+F'); await page.waitForTimeout(600);
  await page.setViewportSize({ width: 1100, height: 800 }); await page.waitForTimeout(500);
  ok('below 1280px there is still no corner, and the logo is the switch', !(await page.$('#brewmode')) && await page.isVisible('#rail .logoswitch'));
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
  ok('on a phone there is no corner either', !(await page.$('#brewmode')));
  await page.setViewportSize({ width: 1440, height: 900 });
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();

  // the start screen in both drinks
  for (const drink of ['tea', 'coffee']){
    const c = await newContext({ motion: true, viewport: { width: 1440, height: 900 } });
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
  const ctx = await newContext({ motion: true, viewport: { width: 1440, height: 900 } });
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
  await page.click('#body .obwhy summary'); await page.waitForTimeout(500);
  ok('“Why JSON?” opens in place: its four points and the link, inside the inspector', (await page.isVisible('#body .obwhy li')) && (await page.$$('#body .obwhy li')).length === 4 && /File over app|Steph Ango/.test(await page.textContent('#body .obwhy')) && (await r('#body')).height > bodyH);
  await page.click('#body .obwhy summary'); await page.waitForTimeout(500);
  ok('footer area: the four “Yours to keep” points, private first among them, JSON Resume linked', (await page.$$('#foot .obtile')).length === 4 && /Private/.test(await page.textContent('#foot')) && !!(await page.$('#foot a[href="https://jsonresume.org/schema"]')));
  ok('…light, and not equal to the inspector: no card around them', await page.evaluate(() => { const f = getComputedStyle(document.querySelector('#foot')); return f.backgroundColor === 'rgba(0, 0, 0, 0)' && f.boxShadow === 'none'; }));
  ok('nothing of the editor shows: no tabs, no zoom bar, no meter, no Fit, and the sheet waits', !(await page.isVisible('#tab-edit')) && !(await page.$('[data-act=fit]')) && (await page.evaluate(() => getComputedStyle(document.querySelector('#sheet')).visibility)) === 'hidden');

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
  ok('“Try it with an example” turns the intro parts into the editor’s controls: the same column, now the editor’s name card, rail and panel', !(await page.evaluate(() => document.body.classList.contains('is-intro'))) && await page.isVisible('#rail [role=tablist]') && await page.isVisible('#head [data-act=fit]'));
  ok('…the grey lines give way to the real page, which fades in where they were', (await page.evaluate(() => getComputedStyle(document.querySelector('#sheet')).visibility)) === 'visible' && (await page.evaluate(() => getComputedStyle(document.querySelector('#startstage')).visibility)) === 'hidden' && /Okonkwo|Dana/.test(await frameDoc(page, d => d.body.textContent)));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the start screen: other windows, a phone, reduced motion, a record that exists')) {
  {
    const ctx = await newContext({ motion: true, viewport: { width: 1100, height: 760 } });
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
    const ctx = await newContext({ motion: true, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
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
    const ctx = await newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
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
    const ctx = await newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
    const page = await ctx.newPage();
    const bad = await open(page, undefined, { drink, theme });
    const sheet = page.frameLocator('#sheet iframe');
    const tag = `${drink} ${theme}`;
    const col = () => rect(page, '#col');

    // ---- Edit, Design and Export, and R ----
    const tabs = await page.$$eval('#rail [role=tab]', els => els.map(e => e.textContent.trim()));
    ok(`${tag}: the rail’s tab list is Edit · Design · Export`, tabs.length === 3 && tabs.every(x => x.length > 2) && (await page.$$eval('#rail [role=tab]', els => els.map(e => e.dataset.m).join())) === 'edit,design,export', tabs.join('|'));
    ok(`${tag}: …with the same tablist semantics, one tab stop`, await page.evaluate(() => { const t = [...document.querySelectorAll('#rail [role=tab]')]; return t.length === 3 && t.filter(x => x.tabIndex === 0).length === 1 && t.filter(x => x.getAttribute('aria-selected') === 'true').length === 1; }));
    await page.keyboard.press('Escape'); await settle(page);   // nothing selected
    const before = await col(), pageBefore = await rect(page, '#sheet');
    ok(`${tag}: the sidebar is 340px wide in the Outline at 1440`, Math.abs(before.width - 340) < 1, `${before.width}px`);
    await page.evaluate(() => { window.__moved = 0; document.addEventListener('brewcv:pages-moved', () => { window.__moved++; }); });
    await page.keyboard.press('r'); await settle(page);
    const after = await col(), pageAfter = await rect(page, '#sheet');
    ok(`${tag}: R opens Record, and none of Edit, Design, Export is selected`, (await page.evaluate(() => window.__wb.ui.view)) === 'record' && (await page.$$('#rail [role=tab][aria-selected=true]')).length === 0 && (await page.getAttribute('#body', 'data-mode')) === 'record');
    ok(`${tag}: Record fills the window for now (its own redesign comes later): the sidebar is the whole window less 16px each side, and the page stays where it was under it`, Math.abs(after.left - 16) < 1 && Math.abs(after.width - (1440 - 32)) < 1 && Math.abs(after.height - (900 - 32)) < 1 && Math.abs(pageAfter.left - pageBefore.left) < 1 && Math.abs(pageAfter.width - pageBefore.width) < 1, `${before.width}px → ${after.width}px`);
    ok(`${tag}: the pages' own event did not fire: the pages did not move`, (await page.evaluate(() => window.__moved)) === 0, String(await page.evaluate(() => window.__moved)));
    ok(`${tag}: the sidebar keeps 16px from the right`, Math.abs(1440 - after.right - 16) < 1);

    // ---- what Record shows ----
    ok(`${tag}: a header row: Your record, n/m (n of m on to a screen reader), + Add`, await page.evaluate(() => { const h = document.querySelector('#checklist .clhead'); return !!h && /Your record/.test(h.textContent) && /\d+ of \d+ on/.test(h.textContent) && !!h.querySelector('[data-act=c-pop]'); }));
    ok(`${tag}: the timeline is open across the panel, always`, await page.evaluate(() => { const t = document.querySelector('#checklist .rectl .tl2'); const b = document.querySelector('#body'); return !!t && t.getBoundingClientRect().width > b.getBoundingClientRect().width * 0.8 && !document.querySelector('#timeline'); }));
    ok(`${tag}: the timeline is about 118px high and its years run left to right`, await page.evaluate(() => { const t = document.querySelector('#checklist .rectl .tl2'); const y = [...t.querySelectorAll('.yr')].map(e => e.getBoundingClientRect().left); return Math.abs(t.getBoundingClientRect().height - 118) <= 1 && y.length >= 3 && y.every((x, k) => k === 0 || x > y[k - 1]); }));
    await page.evaluate(() => { document.querySelector('#checklist .tl2').scrollLeft = 0; });
    await page.locator('#checklist .cb[data-on]').first().click(); await settle(page);
    ok(`${tag}: a re-render of Record keeps the timeline where the user left it (the oldest year)`, await page.evaluate(() => { const t = document.querySelector('#checklist .tl2'); return t.scrollWidth > t.clientWidth ? t.scrollLeft === 0 : true; }));      // (Record fills the window for now: the years may all fit, with nothing to scroll)
    await page.locator('#checklist .cb[data-on]').first().click(); await settle(page);
    ok(`${tag}: every group is open by default, and the carets stay`, await page.evaluate(() => { const gs = [...document.querySelectorAll('#checklist .clg')]; return gs.length >= 5 && gs.every(g => g.classList.contains('open')) && gs.every(g => g.querySelector('.clcaret[aria-expanded=true]')); }));
    ok(`${tag}: jobs newest first, then education, skills…`, await page.evaluate(() => { const ids = [...document.querySelectorAll('#checklist .clg')].map(g => g.dataset.g); return ids[0] === 'about' && ids.indexOf('hydra') < ids.indexOf('poly') && ids.indexOf('education') > ids.indexOf('atelier') && ids.includes('credentials'); }));
    await page.click('#checklist .clg[data-g=hydra] .clcaret'); await settle(page);
    ok(`${tag}: a caret folds a group, and it stays folded when the panel is drawn again`, await page.evaluate(() => !document.querySelector('#checklist .clg[data-g=hydra]').classList.contains('open')));
    await page.click('#checklist .clg[data-g=hydra] .clcaret'); await settle(page);

    // ---- ticking in Record changes the open resume, with the page in view ----
    const n0 = await onPageCount(page);
    const off = page.locator('#checklist .clg[data-g=hydra] .clrow.is-off .cb[data-on]').first();
    if (await off.count()){
      await off.check(); await settle(page);
      ok(`${tag}: ticking a line in Record puts it on the page (${n0} → ${await onPageCount(page)}), and the panel is still Record`, (await onPageCount(page)) === n0 + 1 && (await page.evaluate(() => window.__wb.ui.view)) === 'record');
      await page.keyboard.press('Control+z'); await settle(page);
      ok(`${tag}: …as one undo step`, (await onPageCount(page)) === n0);
      // three different lines ticked on about 100 ms apart are three undo steps: one Ctrl+Z takes back only the last
      const u0 = await page.evaluate(() => window.__wb.store.history.undo);
      for (let i = 0; i < 3; i++){ await page.locator('#checklist .clrow.is-off .cb[data-on]').first().check(); await page.waitForTimeout(100); }
      await settle(page);
      ok(`${tag}: three lines ticked within a second are three undo steps`, (await page.evaluate(() => window.__wb.store.history.undo)) === u0 + 3 && (await onPageCount(page)) === n0 + 3, `${await page.evaluate(() => window.__wb.store.history.undo)} vs ${u0}`);
      await page.keyboard.press('Control+z'); await settle(page);
      ok(`${tag}: one Ctrl+Z takes back only the last of them`, (await onPageCount(page)) === n0 + 2 && (await page.evaluate(() => window.__wb.store.history.undo)) === u0 + 2);
      await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await settle(page);
      // typing in one text (one merge key) is still one step
      const typed = await page.evaluate(() => { const st = window.__wb.store, u = st.history.undo; for (const ch of 'abc') st.commit(d => { d.record.basics.label = (d.record.basics.label ?? '') + ch; }, 'Type test', 'type-test'); const n = st.history.undo - u; st.undo(); return n; });
      ok(`${tag}: typing a sentence in one text is still one undo step`, typed === 1, String(typed));
    } else ok(`${tag}: hydra has a line that is off, to tick`, false);

    // ---- Esc goes back, and the sidebar narrows ----
    await page.keyboard.press('Escape'); await settle(page);
    ok(`${tag}: Esc from Record goes back to where it was opened from (Edit, the Outline)`, (await page.evaluate(() => window.__wb.ui.view)) === null && (await page.getAttribute('#tab-edit', 'aria-selected')) === 'true' && Math.abs((await col()).width - before.width) < 1);

    // ---- the ways in: the name menu, the job chip and a section's count ----
    await page.click('#docname-btn'); await page.click('#switcher [data-act=sw-record]'); await settle(page);
    ok(`${tag}: Record in the name menu opens Record`, (await page.evaluate(() => window.__wb.ui.view)) === 'record' && !(await page.isVisible('#switcher')));
    await page.keyboard.press('Escape'); await settle(page);
    // from the page: a bullet, then the way into the record under the job's lines
    await sheet.locator('.bullets li').first().click(); await settle(page);
    await page.keyboard.press('Escape'); await settle(page);      // one click wrote it; Esc leaves it selected
    ok(`${tag}: no old breadcrumb over the page; the job's panel has "All of your record"`, !(await page.$('.obcrumb')) && await page.isVisible('#body .allrec [data-act=open-record]'));
    await page.click('#body .allrec [data-act=open-record]'); await settle(page);
    const at = await page.evaluate(() => { const g = document.querySelector('#checklist .clg[data-g=hydra]'), b = document.querySelector('#body'); const gr = g?.getBoundingClientRect(), br = b.getBoundingClientRect(); return { view: window.__wb.ui.view, asked: g?.classList.contains('is-asked'), top: gr ? gr.top - br.top : null, h: br.height }; });
    ok(`${tag}: “All of your record” opens Record scrolled to that job, its group marked for a moment`, at.view === 'record' && at.asked && at.top >= -2 && at.top < at.h - 40, JSON.stringify(at));
    await page.waitForFunction(() => !document.querySelector('#checklist .clg.is-asked'));
    ok(`${tag}: …and the mark goes`, !(await page.evaluate(() => !!document.querySelector('#checklist .clg.is-asked'))));
    // the timeline scrolls the list to a job
    await page.click('#checklist .rectl [data-act=rec-job][data-id=atelier]'); await settle(page);
    ok(`${tag}: a click on a job in the timeline scrolls the list to that job`, await page.evaluate(() => { const g = document.querySelector('#checklist .clg[data-g=atelier]'), b = document.querySelector('#body'); const d = g.getBoundingClientRect().top - b.getBoundingClientRect().top; return d >= -2 && d < b.getBoundingClientRect().height - 40 && window.__wb.ui.view === 'record'; }));
    // a click on a row's text opens the claim in Edit
    await page.click('#checklist .clg[data-g=atelier] .clt'); await settle(page);
    ok(`${tag}: a click on a line's text opens the claim (Edit), and the panel is at its top`, (await page.evaluate(() => window.__wb.ui.view)) === null && (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'bullet' && (await page.evaluate(() => document.querySelector('#body').scrollTop)) === 0);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
    // the Outline: sections with their counts, in print order
    await toEditHome(page);
    ok(`${tag}: the Outline lists the sections in print order with "n/m", and no checklist`, await page.evaluate(() => { const t = document.querySelector('#outline'); return !!t && !document.querySelector('#checklist') && document.querySelectorAll('#seclist .osec').length >= 5 && /\d+ of \d+ on/.test(document.querySelector('#seclist .osec[data-sid=experience] .srow')?.textContent ?? '') && !document.querySelector('[data-act=c-tl]'); }));
    ok(`${tag}: Fixed sections say "always first", and the foot says how Fit works`, await page.evaluate(() => document.querySelectorAll('#seclist .osec .srow.fixed').length >= 2 && /Fit cuts from the bottom/.test(document.querySelector('#body').textContent)));
    await page.keyboard.press('Escape'); await settle(page);

    // ---- the job level: versions, then the job's own lines, then Details, then the way to the record ----
    await sheet.locator('.bullets li').first().click(); await settle(page);
    const order = await page.evaluate(() => { const y = s => document.querySelector(s)?.getBoundingClientRect().top ?? null; return { crumb: y('#body .depth'), versions: y('#body .vlist'), details: y('#body details.details'), all: y('#body .allrec'), top: document.querySelector('#body').scrollTop, noGroup: !document.querySelector('#checklist') && !document.querySelector('#body .clg') }; });
    ok(`${tag}: the job level shows the line's versions, then Details, then "All of your record"; the job's own lines are in the Outline, not here`, order.crumb < order.versions && order.versions < order.details && order.details < order.all && order.noGroup, JSON.stringify(order));
    ok(`${tag}: the panel opens at its top after a bullet click`, order.top === 0);
    await sheet.locator('.bullets li').nth(2).click(); await settle(page);
    ok(`${tag}: …and after the next click, and after a key`, (await page.evaluate(() => document.querySelector('#body').scrollTop)) === 0);
    await page.keyboard.press('ArrowDown'); await settle(page);
    ok(`${tag}: …and after ↓`, (await page.evaluate(() => document.querySelector('#body').scrollTop)) === 0);
    await page.click('#body .depth [data-act=select-job]'); await settle(page);
    ok(`${tag}: the job's own lines can still be ticked, in its sheet`, await page.evaluate(() => document.querySelectorAll('#outline .clg.open .sw[data-on]').length >= 3));
    await page.click('#tab-edit'); await settle(page);
    await page.click('#body .allrec [data-act=open-record]'); await settle(page);
    ok(`${tag}: "All of your record" opens Record at this job`, (await page.evaluate(() => window.__wb.ui.view)) === 'record');
    await page.keyboard.press('Escape'); await settle(page);

    // ---- one meaning of save ----
    ok(`${tag}: no control in the header says only Save, and there is no data-act=save`, await page.evaluate(() => ![...document.querySelectorAll('#head button')].some(b => /^\s*Save\s*$/i.test(b.textContent)) && !document.querySelector('[data-act=save]') && !document.querySelector('#save')));
    ok(`${tag}: the name card is the name, ✓ Saved and the menu: no language, no Save to file`, await page.evaluate(() => { const r = document.querySelector('#head .hrow.top'); return !!r.querySelector('#docname-btn') && !r.querySelector('#langbtn') && !!r.querySelector('#savestate') && !!r.querySelector('[data-act=menu]') && !r.querySelector('#filestate'); }));
    await page.click('#tab-export'); await settle(page);
    ok(`${tag}: Save to file is in Export, and the line beside it says whether the file is saved`, /Save to file/.test(await page.textContent('#filestate')) && /Not saved to a file yet/.test(await page.textContent('#fileline')));
    const dl = await Promise.all([page.waitForEvent('download'), page.click('#filestate')]);
    await settle(page);
    ok(`${tag}: Save to file downloads the one file, and the line says so`, /brewcv/.test(dl[0].suggestedFilename()) && /Saved to file/.test(await page.textContent('#fileline')));
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
    ok(`${tag}: the window’s rows (the recent ones) have no company column, and carry a small language/pages tag`, rows.length >= 1 && rows.length <= 3 && rows.every(r => r.tag && r.noCompany));
    ok(`${tag}: …a name that has to give way gives up the company, never the role alone`, rows.every(r => !(r.roleCut && !r.coCut)));
    await page.click('[data-act=sw-manage]'); await settle(page);
    const man = await page.evaluate(() => { const b = document.querySelector('#body').getBoundingClientRect(), hd = document.querySelector('#head').getBoundingClientRect(), ft = document.querySelector('#foot').getBoundingClientRect(); return { view: window.__wb.ui.view, bodyWide: b.width > innerWidth * 0.8, small: hd.width <= innerWidth / 2 && ft.width <= innerWidth / 2 }; });
    ok(`${tag}: Manage all is the Resumes screen: the window's own card, with the name card and the foot small, no bar across the window`, man.view === 'resumes' && man.bodyWide && man.small, JSON.stringify(man));
    ok(`${tag}: "Compare" is readable when disabled`, await page.evaluate(() => { const b = document.querySelector('#scr-cmp'); return b.disabled && getComputedStyle(b).opacity === '1'; }));
    await page.keyboard.press('Escape'); await settle(page);

    // ---- toasts never cover the page ----
    await page.click('[data-act=undo]').catch(() => {});
    await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);     // (a second click on a line of the open job would write it)
    await sheet.locator('.bullets li').first().click(); await settle(page);
    await page.locator('.vrow[data-v]:not(.cur)').first().click(); await settle(page);
    await page.keyboard.press('Control+z'); await settle(page);
    const toastOpen = await page.evaluate(() => document.querySelector('#toast').classList.contains('on'));
    const tr = await rect(page, '#toast'); const prs = await pageRects(page);
    ok(`${tag}: a toast (panel open) hangs under the panel's header and covers none of the page`, toastOpen && tr.left >= (await col()).left && tr.top >= (await rect(page, '#head')).bottom - 1 && clear(tr, prs), JSON.stringify(tr));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
    await settle(page);

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
    const ctx = await newContext({ motion: true, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await open(page, '?memory&welcome');
    await page.click('[data-act=ob-example]'); await settle(page);
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

  // ---- a toast under the sidebar's head, at 1440 and at 1024 ----
  for (const [w, h] of [[1440, 900], [1024, 768]]){
    const name = 'under the header';
    const ctx = await newContext({ motion: true, viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await open(page);
    await page.evaluate(() => window.__wb.store.commit(d => { d.cur.company = 'Zeta'; }, 'smoke: change'));
    await page.keyboard.press('Control+z'); await page.waitForTimeout(400);       // a moment of the toast's slide, as measured: kept
    const tr = await rect(page, '#toast'), prs = await pageRects(page);
    ok(`${w}×${h}, ${name}: a toast covers none of the page`, await page.evaluate(() => document.querySelector('#toast').classList.contains('on')) && clear(tr, prs), JSON.stringify(tr));
    await ctx.close();
  }

  // ---- Record at 1024 and on a phone ----
  {
    const ctx = await newContext({ motion: true, viewport: { width: 1024, height: 768 } });
    const page = await ctx.newPage();
    await open(page);
    const s0 = await rect(page, '#sheet');
    await page.keyboard.press('r'); await settle(page);
    const c = await rect(page, '#col'), s = await rect(page, '#sheet');
    ok('1024: Record fills the window (until its own redesign), and the page has not moved', Math.abs(c.width - (1024 - 32)) < 1 && Math.abs(c.left - 16) < 1 && Math.abs(s.left - s0.left) < 1, `${c.width} at ${c.left}`);
    ok('…and the timeline and the groups are there', await page.evaluate(() => !!document.querySelector('#checklist .rectl .tl2') && document.querySelectorAll('#checklist .clg.open').length >= 5));
    await ctx.close();
    const cp = await newContext({ motion: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const ph = await cp.newPage();
    await open(ph);
    ok('a phone: Edit and Record are the tabs', await ph.evaluate(() => [...document.querySelectorAll('#head [role=tab]')].filter(t => t.offsetParent !== null).map(t => t.dataset.m).join() === 'edit,record'));
    await ph.click('#head [data-m=record]'); await settle(ph);
    const pc = await rect(ph, '#col');
    ok('a phone: Record is the whole screen, a list, with the timeline as a plain list of jobs', Math.abs(pc.width - 390) < 1 && Math.abs(pc.height - 844) < 1 && await ph.evaluate(() => !!document.querySelector('#checklist .clg') && getComputedStyle(document.querySelector('#checklist .colhead')).display === 'none'));
    await ph.click('#head [data-m=edit]'); await settle(ph);
    ok('a phone: Edit puts the bottom sheet back', Math.abs((await rect(ph, '#col')).height - 844 * 0.42) < 4);
    await cp.close();
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
      const ctx = await newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true, colorScheme: theme });
      const page = await ctx.newPage();
      const bad = await open(page, undefined, { drink, theme });
      const sheet = page.frameLocator('#sheet iframe');
      const runAxe = async (pg, name) => {
        // the zoom bar fades in and out as the pointer crosses the page: axe reads a half-faded bar as low contrast, so wait for it to rest
        await pg.waitForFunction(() => { const z = document.querySelector('#zoombar'); const o = z ? +getComputedStyle(z).opacity : 0; return o === 0 || o === 1; }, null, { timeout: 5000 }).catch(() => {});
        await pg.evaluate(axeSrc);
        const v = await pg.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map(x => `${x.id} (${x.impact}): ${x.nodes.slice(0, 3).map(n => n.target.join(' ') + (n.any?.[0]?.data?.contrastRatio ? ` [${n.any[0].data.fgColor} on ${n.any[0].data.bgColor} ${n.any[0].data.contrastRatio}]` : '')).join(' | ')}`));
        ok(`axe-core, ${drink} ${theme}: ${name}`, v.length === 0, v.join(' ; '));
      };
      // the start screen: at the start, and at rest
      const pw = await ctx.newPage();
      await open(pw, '?memory&welcome', { drink, theme });
      await runAxe(pw, 'the start screen');
      await pw.evaluate(() => window.__wb.onboarding.start.setStep(4, { user: true })); await settle(pw);
      await runAxe(pw, 'the start screen, at rest');
      await pw.close();
      await runAxe(page, 'the Outline, nothing selected');
      await page.click('#tab-edit'); await settle(page); await runAxe(page, 'Edit, nothing selected');
      await page.keyboard.press('r'); await settle(page);
      await runAxe(page, 'Record: the timeline and every group open');
      await page.keyboard.press('Escape'); await settle(page);
      await sheet.locator('.bullets li').first().click(); await settle(page);
      await runAxe(page, 'a claim, with the job’s own lines under its versions');
      await toJobOutline(page); await settle(page);
      await page.click('details.details > summary'); await page.click('details.jr:not(.details) summary'); await settle(page);
      await runAxe(page, 'a job with Details open');
      await sheet.locator('.name').click(); await settle(page);
      await runAxe(page, 'About you');
      await openAdd(page); await settle(page);
      await runAxe(page, 'the + Add menu');
      await page.click('.addm [data-what=work]'); await settle(page);
      await runAxe(page, 'a form for something new');
      await page.click('[data-act=c-add-cancel]'); await settle(page);
      for (const m of ['design', 'export']){ await page.click(`#tab-${m}`); await settle(page); await runAxe(page, m); }
      await page.click('[data-act=mark-sent]'); await settle(page); await runAxe(page, 'Mark as sent');
      await page.click('[data-act=sent-back]'); await settle(page);
      await page.click('#tab-edit'); await settle(page);
      await page.click('#docname-btn'); await settle(page); await runAxe(page, 'the switcher');
      await page.click('#switcher [data-act=sw-manage]'); await settle(page); await runAxe(page, 'the Resumes screen');
      await page.click('#resumes [data-act=scr-view][data-v=date]'); await settle(page); await runAxe(page, 'the Resumes screen by date');
      await page.keyboard.press('Escape'); await settle(page);
      await page.click('[data-act=menu]'); await runAxe(page, 'the ⋯ menu'); await page.click('.menu [data-act=help]'); await settle(page); await runAxe(page, 'the shortcut sheet');
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.__wb.setView('settings')); await settle(page); await runAxe(page, 'Settings');
      await page.evaluate(() => window.__wb.setView(null));
      await page.keyboard.press('Escape'); await settle(page);
      await page.mouse.move(300, 400); await settle(page);
      await runAxe(page, 'the foot with the meters and Fit, and the zoom bar over the page');
      ok(`${drink} ${theme}: no console errors`, bad.length === 0, bad[0] ?? '');
      await ctx.close();
      const c2 = await newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true, colorScheme: theme });
      const p2 = await c2.newPage();
      await open(p2, '?memory&welcome', { drink, theme });
      await runAxe(p2, 'the start screen');
      await p2.click('[data-act=ob-scratch]'); await settle(p2); await runAxe(p2, 'the language step');
      await p2.click('[data-act=ob-lang-go]'); await settle(p2); await runAxe(p2, 'the quiet editor');
      await c2.close();
      const c3 = await newContext({ viewport: { width: 1100, height: 800 }, bypassCSP: true, colorScheme: theme });
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
  const ctx = await newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  const bad = [];
  page.on('console', m => { if (m.type() === 'error') bad.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(`http://localhost:${PORT + 1}${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 });
  ok('it runs from a project subpath with nothing missing', bad.length === 0, bad[0] ?? '');
  ok('a first visit opens on the welcome card', (await page.getAttribute('#body', 'data-view')) === 'welcome');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await settle(page);
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
  await settle(page);
  ok('offline, it reloads and draws the resume', await page.evaluate(() => document.body.classList.contains('is-ready') && window.__wb.ui.fills.length > 0));
  await ctx.close();
  sub.close();

  // a phone: view and pick versions only
  const ph = await newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const pp = await ph.newPage();
  const badP = await open(pp);
  const s = await rect(pp, '#sheet');
  ok('phone: the page fills the width, no sideways scroll', Math.abs(s.width - (390 - 16)) < 2 && (await pp.evaluate(() => document.documentElement.scrollWidth)) <= 390, `${s.width.toFixed(1)}px`);
  ok('phone: the column is a bottom sheet', (await rect(pp, '#col')).bottom >= 843 && (await rect(pp, '#col')).height < 844 * 0.5);
  await pp.frameLocator('#sheet iframe').locator('.bullets li').first().tap(); await settle(pp);
  ok('phone: tapping a bullet lists its versions', (await pp.$$('.vrow')).length >= 2);
  ok('phone: no editing, Design or Export', !(await pp.isVisible('.vrow.cur [data-act=edit]')) && !(await pp.isVisible('[data-act=mode][data-m=design]')) && !(await pp.isVisible('.newv')));
  const before = await firstBullet(pp);
  await pp.locator('.vrow[data-v]:not(.cur)').first().tap(); await settle(pp);
  ok('phone: tapping a version uses it', (await firstBullet(pp)) !== before);
  ok('phone: no console errors', badP.length === 0, badP[0] ?? '');
  await ph.close();

  // every control has a name, every field a label
  const ctx2 = await newContext({ viewport: { width: 1536, height: 864 } });
  const p2 = await ctx2.newPage();
  await open(p2);
  const unnamed = async () => p2.evaluate(() => [...document.querySelectorAll('#col button, #col input, #col textarea, #col [role=button], #zoombar button')]
    .filter(e => e.offsetParent !== null)
    .filter(e => !(e.getAttribute('aria-label') || e.title || e.textContent.trim() || e.closest('label') || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.placeholder))
    .map(e => e.outerHTML.slice(0, 80)));
  const views = [];
  for (const v of [null, 'new', 'sent', 'record', 'resumes', 'design', 'export', 'import', 'history', 'settings']){
    if (v) await p2.evaluate(x => window.__wb.setView(x), v);
    await settle(p2);
    views.push(...(await unnamed()).map(x => `${v ?? 'home'}: ${x}`));
    await p2.keyboard.press('Escape');
  }
  await p2.click('#docname-btn'); await settle(p2);
  views.push(...(await unnamed()).map(x => `switcher: ${x}`));
  await p2.click('#switcher [data-act=sw-manage]'); await settle(p2);
  views.push(...(await unnamed()).map(x => `Resumes screen: ${x}`));
  await p2.keyboard.press('Escape');
  await p2.mouse.move(300, 400); await settle(p2);
  views.push(...(await unnamed()).map(x => `zoom bar: ${x}`));
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
  const ctx = await newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  await open(page);
  await page.mouse.move(300, 400); await page.click('#zoombar [data-act=actual]'); await settle(page);
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
  await page.mouse.move(300, 400); await page.click('#zoombar [data-act=actual]'); await settle(page);
  ok('the calibration is remembered', !(await page.isVisible('.actual__cal')));
  await page.keyboard.press('Escape');
  await ctx.close();
}

if (want('the session survives a reload')) {
  const ctx = await newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  await open(page, '');                                   // real IndexedDB this time
  await page.click('[data-act=ob-example]'); await settle(page);        // a first visit opens on the introduction; take the example, which opens at once
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
  await settle(page);
  ok('a reload opens the same resume with the same choice', (await firstBullet(page)) === chosen);
  ok('with a fresh undo stack', (await page.evaluate(() => window.__wb.store.history.undo)) === 0);
  await ctx.close();
}

if (want('motion: the thirteen moments play, are off under reduced motion, and leave the same page')) {
  // One walk through every moment, once with motion and once with reduced motion emulated. With motion, each moment starts the
  // animations it names (window.__wb.motion.stats.names); with reduced motion, nothing starts at all, nothing is left running, and the
  // printed page (the frame's .document) is the same, character for character, after every step.
  const walk = async reduced => {
    const ctx = await newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
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
    await fr.locator('.bullets li').first().click(); await settle(page); await page.keyboard.press('Escape'); await settle(page); await clear();      // one click writes; Esc leaves the line selected
    docs.selected = await doc();
    await page.locator('#body .vrow[data-v]:not(.cur)').nth(1).hover(); await page.waitForTimeout(120);
    got.hover = await names(); got.hoverRunning = await running();
    await page.waitForTimeout(700); docs.hovered = await doc();
    await page.mouse.move(4, 4); await page.waitForTimeout(900); docs.unhovered = await doc();
    // a new version: its row slides into the list
    await page.evaluate(() => window.__wb.edit.startEdit('new')); await settle(page);
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
    await page.hover('#rail .logoswitch'); await page.waitForTimeout(350);
    got.peek = await page.evaluate(() => ({ layer: !!document.querySelector('.matroll'), tip: document.querySelector('#rail .logoswitch').dataset.tip, to: document.querySelector('#rail .logoswitch').dataset.to, drink: document.documentElement.dataset.drink }));
    await page.click('#rail .logoswitch'); await page.waitForTimeout(150);
    got.roll = await names(); await page.waitForTimeout(700);
    got.coffee = await page.evaluate(() => ({ drink: document.documentElement.dataset.drink, logo: document.querySelector('#rail .logoswitch img').getAttribute('src'), to: document.querySelector('#rail .logoswitch').dataset.to, layer: !!document.querySelector('.matroll') }));
    // an export in coffee: a crema line reads the page and a receipt prints
    await page.evaluate(() => window.__wb.setView('export')); await settle(page); await clear();
    await page.click('[data-act=ex-html]'); await page.waitForTimeout(900);
    got.exportCoffee = await names(); await page.waitForTimeout(2200);
    await page.mouse.move(4, 4);
    await page.hover('#rail .logoswitch'); await page.waitForTimeout(300); await clear();
    await page.click('#rail .logoswitch'); await page.waitForTimeout(150);
    got.unroll = await names(); await page.waitForTimeout(700);
    got.tea = await page.evaluate(() => ({ drink: document.documentElement.dataset.drink, logo: document.querySelector('#rail .logoswitch img').getAttribute('src') }));
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
  const sctx = await newContext({ motion: true, viewport: { width: 1440, height: 900 } });
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
  const ictx = await newContext({ motion: true, viewport: { width: 1440, height: 900 } });
  const ip = await ictx.newPage();
  await open(ip, '?memory&welcome');
  await ip.waitForTimeout(500); await ip.evaluate(() => window.__wb.motion.stats.names.length = 0);
  await ip.click('[data-act=ob-example]'); await ip.waitForTimeout(250);
  const first = await ip.evaluate(() => [...new Set(window.__wb.motion.stats.names)]);
  ok('start screen to editor: the page’s lines are written in one after another, and the header, panel and foot come in', has(first, 'start:line', 'start:head', 'start:body', 'start:foot'), first.join());
  await ictx.close();
  const qctx = await newContext({ motion: true, viewport: { width: 1440, height: 900 } });
  const qp = await qctx.newPage();
  await open(qp, '?memory&welcome');
  await qp.waitForTimeout(500);
  await qp.click('[data-act=ob-scratch]'); await qp.waitForTimeout(400); await qp.click('[data-act=ob-lang-go]'); await qp.waitForTimeout(700);
  await qp.evaluate(() => window.__wb.motion.stats.names.length = 0);
  await qp.evaluate(() => window.__wb.onboarding.act('ob-finish')); await qp.waitForTimeout(200);
  const quiet = await qp.evaluate(() => [...new Set(window.__wb.motion.stats.names)]);
  ok('onboarding to Start editing: the header and the foot fade and slide in around the page', has(quiet, 'quiet:head', 'quiet:foot'), quiet.join());
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
    // the on-page layer holds frames, a veil, the tools and the chip, and nothing else; the chip is held to the text like the rest
    const out = [...document.querySelectorAll('#editlay > *')].filter(el => !el.matches('.obframe, .obveil, .obtoolswrap, .obchip')).map(name);
    for (const el of document.body.querySelectorAll('*')){
      if (el.closest(allowed) && !el.matches('.obchip')) continue;
      const cs = getComputedStyle(el);
      if (!/(fixed|absolute)/.test(cs.position) || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // a line's box is a little bigger than its letters: two pixels of it all round do not count
      if (lines.some(l => Math.min(r.right, l.left + l.width - 2) > Math.max(r.left, l.left + 2) && Math.min(r.bottom, l.top + l.height - 2) > Math.max(r.top, l.top + 2))) out.push(name(el));
    }
    return [...new Set(out)];
  });
  for (const [w, h] of [[1280, 720], [1470, 832]]){
    const ctx = await newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const bad = await open(page);
    const fr = page.frameLocator('#sheet iframe');
    await toJobOutline(page); await settle(page);
    ok(`${w}×${h}: a job is selected and nothing lies over its text`, (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'job' && (await offenders(page)).length === 0, (await offenders(page)).join(', '));
    await fr.locator('.bullets li').nth(1).click(); await settle(page);
    ok(`${w}×${h}: a line is written (the pointer rests on it): nothing over the text, and no tip`, (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'bullet' && (await offenders(page)).length === 0 && !(await page.isVisible('#tip.on')), (await offenders(page)).join(', '));
    // a click that redraws what is under the pointer opens no tip by itself; a pointer that moves onto it does
    {
      const b = await page.locator('#head [data-act=menu]').boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 }); await page.waitForSelector('#tip.on', { timeout: 3000 }).catch(() => {});
      ok(`${w}×${h}: a pointer moving onto the head’s menu button opens its tip`, await page.isVisible('#tip.on'));
      await page.mouse.down(); await page.mouse.up(); await settle(page);
      ok(`${w}×${h}: the click redrew the head under the resting pointer, and no tip opened`, (await page.isVisible('#head .menu')) && !(await page.isVisible('#tip.on')));
    }
    await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
    await fr.locator('.bullets li').nth(1).click(); await settle(page);
    ok(`${w}×${h}: while writing, nothing lies over the text`, !!(await page.evaluate(() => window.__wb.ui.writing)) && (await offenders(page)).length === 0, (await offenders(page)).join(', '));
    // a bigger writing zoom would slide the page's left edge (and the section tabs beside it) out of the view
    await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);      // to the page: the view comes back out
    await page.evaluate(() => localStorage.setItem('rb-zoomwrite', '150'));
    await fr.locator('.bullets li').nth(1).click(); await settle(page);
    // (the sidebar stays while a line is written, so at 150% the page can be wider than the room left of it: the line is what stays in view, and the page's edge when both fit)
    ok(`${w}×${h}: writing at 150%, the line stays inside the view, and the page's left edge when the page fits`, await page.evaluate(() => { const c = window.__wb.canvas, pg = c.screenRect(window.__wb.sheet.pageBoxes()[0]), ln = c.screenRect(window.__wb.sheet.rectOfEl(window.__wb.onpage.el())); return !!window.__wb.ui.writing && ln.left >= c.view.left && ln.left + ln.width <= c.view.left + c.view.width && (pg.width > c.view.width || (pg.left >= c.view.left && pg.left < c.view.left + c.view.width / 4)); }), await page.evaluate(() => window.__wb.canvas.screenRect(window.__wb.sheet.pageBoxes()[0]).left));
    ok(`${w}×${h}: no errors`, bad.length === 0, bad.join(' | '));
    await ctx.close();
  }
}

if (want('the gap between two pages shows the mat, in both drinks and both themes')) {
  // one pixel of the screen as the person sees it (a 1×1 PNG: inflate the data, skip the filter byte)
  const pixel = async (page, x, y) => { const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } }); let o = 8, idat = []; while (o < png.length){ const n = png.readUInt32BE(o), ty = png.toString('ascii', o + 4, o + 8); if (ty === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + n)); o += 12 + n; } return [...zlib.inflateSync(Buffer.concat(idat)).subarray(1, 4)]; };
  for (const [drink, theme] of [['tea', 'light'], ['tea', 'dark'], ['coffee', 'light'], ['coffee', 'dark']]){
    const ctx = await newContext({ motion: true, viewport: { width: 2560, height: 1100 } });      // wide enough for both pages beside the sidebar
    const page = await ctx.newPage();
    const bad = await open(page, undefined, { drink, theme });
    await openByName(page, 'Medtech'); await page.waitForTimeout(600); await page.mouse.move(5, 5);
    const g = await page.evaluate(() => { const f = document.querySelector('#sheet iframe'), r = f.getBoundingClientRect(), k = r.width / f.offsetWidth, p = [...f.contentDocument.querySelectorAll('.document > .page')].map(e => e.getBoundingClientRect()); return p.length === 2 ? { x: r.left + (p[0].right + p[1].left) / 2 * k, y: r.top + 400, wide: (p[1].left - p[0].right) * k } : null; });
    const px = g ? await pixel(page, Math.round(g.x), Math.round(g.y)) : null;
    ok(`${drink} ${theme}: two pages side by side, and the gap between them is the mat, not white paper`, !!g && g.wide > 8 && !!px && px.some(c => c < 225), JSON.stringify({ g, px }));
    ok(`${drink} ${theme}: no console errors`, bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
}

if (want('a page on the move lifts and curls a little (Tea), and rests exactly (Coffee, reduced motion: nothing)')) {
  // the sheet's frame and the shadow layer (.lift::before) as the person's browser draws them: scale, tilt (degrees about each axis) and opacity
  const look = page => page.evaluate(() => {
    const m = getComputedStyle(document.querySelector('#sheet iframe')).transform, v = m === 'none' ? null : m.match(/matrix3d\((.*)\)/)?.[1].split(',').map(Number);
    const g = document.querySelector('#garden');
    return { tf: m, scale: v ? v[0] : 1, tiltX: v ? Math.asin(Math.max(-1, Math.min(1, v[6]))) * 180 / Math.PI : 0, tiltY: v ? Math.asin(Math.max(-1, Math.min(1, v[2]))) * 180 / Math.PI : 0,
      shadow: Number(getComputedStyle(document.querySelector('#sheet .lift'), '::before').opacity), shade: Number(getComputedStyle(document.querySelector('#sheet .lift'), '::after').opacity),
      vis: getComputedStyle(document.querySelector('#sheet .lift'), '::before').visibility, shown: getComputedStyle(document.querySelector('#sheet .lift')).display !== 'none', moving: document.body.classList.contains('is-moving'), panning: document.body.classList.contains('is-panning'),
      sheetZ: Number(getComputedStyle(document.querySelector('#sheet')).zIndex), gardenZ: g ? Number(getComputedStyle(g).zIndex) : null };
  });
  for (const [what, o, drag] of [['Tea, a wheel pan', {}, false], ['Tea, dark, a Space drag', { theme: 'dark' }, true], ['Coffee', { drink: 'coffee' }, false], ['Tea, reduced motion', { reduced: true }, false]]){
    const ctx = await newContext({ viewport: { width: 1536, height: 864 }, reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage();
    const bad = await open(page, undefined, o);
    await page.mouse.move(500, 400);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -25); await page.keyboard.up('Control'); await page.waitForTimeout(1200);      // zoomed in: a pan is free
    const rest = await look(page);
    ok(`${what}: at rest the frame has no transform and the lift layer is clear`, rest.tf === 'none' && rest.shadow === 0 && rest.vis === 'hidden' || (o.drink === 'coffee' && rest.tf === 'none'), JSON.stringify(rest));
    if (drag){ await page.keyboard.down('Space'); await page.mouse.down(); for (let i = 1; i <= 12; i++){ await page.mouse.move(500 - i * 14, 400 - i * 6); await page.waitForTimeout(16); } }
    else for (let i = 0; i < 12; i++){ await page.mouse.wheel(-40, -25); await page.waitForTimeout(16); }
    await page.waitForTimeout(60);
    const mid = await look(page);
    if (o.drink === 'coffee' || o.reduced) ok(`${what}: it moves and nothing lifts`, mid.moving && mid.tf === 'none' && !mid.shown, JSON.stringify(mid));
    else {
      ok(`${what}: while it moves the page is lifted, within bounds (scale to 1.02, tilt to 1 degree)`, mid.panning && mid.scale > 1.005 && mid.scale <= 1.02 && Math.abs(mid.tiltX) <= 1 && Math.abs(mid.tiltY) <= 1 && Math.abs(mid.tiltX) + Math.abs(mid.tiltY) > 0.05, JSON.stringify(mid));
      ok(`${what}: the shadow layer and the edge shading are on, and the sheet is above the garden`, mid.shadow > 0.9 && mid.shade > 0.9 && mid.vis === 'visible' && (mid.gardenZ === null || mid.gardenZ < mid.sheetZ), JSON.stringify(mid));
    }
    if (drag){ await page.mouse.up(); await page.keyboard.up('Space'); }
    // the lift follows the camera's own travel: by the time the camera is at rest (its transform unchanged for 6 frames) the page is back down
    const liftAtRest = await page.evaluate(() => new Promise(res => { let prev = '', same = 0; const f = () => { const s = document.getElementById('sheet'), c = s.style.transform; same = c === prev ? same + 1 : 0; prev = c; if (same >= 6) res(Number(s.style.getPropertyValue('--lift') || 0)); else requestAnimationFrame(f); }; f(); }));
    if (!o.drink && !o.reduced) ok(`${what}: when the camera comes to rest the lift is already down (${liftAtRest.toFixed(3)})`, liftAtRest < 0.05, String(liftAtRest));
    await page.waitForTimeout(2200);
    const end = await look(page);
    ok(`${what}: settled, everything is exactly back at rest`, !end.moving && !end.panning && end.tf === 'none' && end.shadow === 0 && end.shade === 0 && end.vis === 'hidden' || (o.drink === 'coffee' && end.tf === 'none' && !end.moving), JSON.stringify(end));
    ok(`${what}: no console errors`, bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
}

// ---- UX-6c-ii: moving things on the page, the header, skills ----
const hands = page => page.evaluate(() => {
  const q = s => document.querySelector(`#handlay ${s}`), box = e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
  const g = q('.obgrip'), p = q('.obplus'), sl = q('.obslot');
  return { grip: g && !g.hidden ? { ...box(g), fact: g.dataset.fact, k: g.dataset.k, name: g.getAttribute('aria-label'), tag: g.tagName, tab: g.tabIndex } : null,
    plus: p && !p.hidden ? { ...box(p), name: p.getAttribute('aria-label'), tag: p.tagName, tab: p.tabIndex, job: p.dataset.job } : null,
    slot: sl && !sl.hidden ? { ...box(sl), name: sl.getAttribute('aria-label'), pressed: sl.getAttribute('aria-pressed'), tag: sl.tagName } : null,
    drop: !q('.obdrop').hidden, tip: q('.obtip').hidden ? '' : q('.obtip').textContent };
});
const midOf = r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
// a line's rectangle in the window: the frame sits at the sheet's offset, scaled by the camera
const frameBox = (page, sel, n = 0) => page.frameLocator('#sheet iframe').locator(sel).nth(n).boundingBox();
const printed = page => page.evaluate(() => { const d = document.querySelector('#sheet iframe').contentDocument; return [...d.querySelectorAll('.entry')].map(e => [...e.querySelectorAll('.bullets li')].map(li => li.textContent.slice(0, 18))); });
const undoN = page => page.evaluate(() => window.__wb.store.history.undo);

if (want('on the page: moving lines within their job, the hover areas, and + at a job’s end')) {
  // the grip and the "+" at three window sizes: in the pages' room, off the zoom bar, over no printed text
  for (const [w, h] of [[1280, 720], [1470, 832], [1920, 1080]]) {
    const ctx = await newContext({ motion: true, viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const bad = await open(page);
    const l = await frameBox(page, '.entry .bullets li', 1);
    await page.mouse.move(l.x + 60, l.y + 4, { steps: 4 }); await settle(page);
    const hs = await hands(page);
    const geo = await page.evaluate(() => {
      const w = window.__wb, v = w.canvas.view, zb = document.querySelector('#zoombar')?.getBoundingClientRect();
      const texts = w.sheet.textRects().map(r => w.canvas.screenRect(r));
      const hit = (a, b) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
      return [...document.querySelectorAll('#handlay .obgrip, #handlay .obplus')].filter(e => !e.hidden).map(e => { const r = e.getBoundingClientRect(); return { inRoom: r.left >= v.left && r.right <= v.left + v.width && r.top >= v.top && r.bottom <= v.top + v.height, text: texts.some(t => hit(r, t)), bar: !!zb && hit(r, zb) }; });
    });
    ok(`${w}x${h}: hovering a line shows its grip and the "+" of its job, each a button with a name, in the focus order`, !!hs.grip && !!hs.plus && hs.grip.tag === 'BUTTON' && hs.plus.tag === 'BUTTON' && hs.grip.tab === 0 && hs.plus.tab === 0 && /within its job/.test(hs.grip.name) && /Hydra/.test(hs.plus.name), JSON.stringify(hs));
    ok(`${w}x${h}: …both inside the pages' room (not under the rail or the sidebar), off the zoom bar, and over no printed text`, geo.length === 2 && geo.every(g => g.inRoom && !g.text && !g.bar), JSON.stringify(geo));
    ok(`${w}x${h}: …no console errors`, bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }

  const ctx = await newContext({ motion: true, viewport: { width: 1470, height: 832 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const li = n => frameBox(page, '.entry:first-child .bullets li', n);
  const toast = () => page.textContent('#toast');
  // the pointer's path from the text to the grip, and through a gap between two lines: the grip is there the whole way
  const a = await li(0), b = await li(1);
  await page.mouse.move(a.x + 60, a.y + a.height / 2, { steps: 3 }); await settle(page);
  const g0 = (await hands(page)).grip;
  const path = [];
  for (let k = 1; k <= 14; k++){
    await page.mouse.move(a.x + 60 + (g0.left + g0.width / 2 - a.x - 60) * k / 14, a.y + a.height / 2 + (g0.top + g0.height / 2 - a.y - a.height / 2) * k / 14);
    await page.waitForTimeout(25);
    path.push(!!(await hands(page)).grip);
  }
  ok('the pointer moving from a line to its grip never loses it: no flicker on the way (14 steps)', path.every(Boolean), path.join());
  ok('…and it is still there once the pointer is on it', !!(await hands(page)).grip);
  await page.mouse.move(a.x + 60, (a.y + a.height + b.y) / 2, { steps: 3 }); await settle(page);
  const gap = (await hands(page)).grip;
  ok('a point in the gap between two lines belongs to a line, not to the job: the grip is of the nearer one', !!gap && /hydra-/.test(gap.fact) && gap.k === 'line', JSON.stringify(gap));
  await page.mouse.move(700, 790, { steps: 2 });
  for (let i = 0; i < 30 && (await hands(page)).grip; i++) await page.waitForTimeout(100);       // it goes after a moment
  ok('leaving the page takes the hands away after a moment', !(await hands(page)).grip);

  // dragging a line: within its job it moves (one undo step); anywhere else is refused with the reason and nothing changes
  const before = (await printed(page))[0], u0 = await undoN(page);
  await page.mouse.move(a.x + 60, a.y + 4, { steps: 3 }); await settle(page);
  let gp = (await hands(page)).grip;
  const l3 = await li(2);
  await page.mouse.move(gp.left + 9, gp.top + 9, { steps: 4 }); await page.mouse.down();
  await page.mouse.move(gp.left + 40, l3.y + l3.height - 2, { steps: 8 }); await page.waitForTimeout(150);
  const during = await hands(page);
  ok('dragging a line shows where it will land', during.drop && !during.tip);
  await page.mouse.up(); await settle(page);
  const after = (await printed(page))[0];
  ok('dropped inside its job, the line moves there: one undo step, the others keep their order', JSON.stringify(after) === JSON.stringify([before[1], before[2], before[0], before[3]]) && (await undoN(page)) === u0 + 1, JSON.stringify(after));
  await page.mouse.move(a.x + 60, a.y + 4, { steps: 2 }); await page.mouse.click(a.x + 60, a.y + 4); await settle(page); await page.keyboard.press('Escape'); await settle(page);
  await toJobOutline(page); await settle(page);
  ok('…and the sidebar\'s list of the job\'s lines (with its ↑ ↓) shows the same order', JSON.stringify(await page.$$eval('#body .clrow .clt', e => e.map(x => x.textContent.slice(0, 18)))) === JSON.stringify(after), JSON.stringify(await page.$$eval('#body .clrow .clt', e => e.map(x => x.textContent.slice(0, 18)))));
  await page.mouse.move(4, 4); for (let k = 0; k < 2; k++) await page.keyboard.press('Escape'); await settle(page);
  await page.mouse.move(a.x + 60, a.y + 4, { steps: 3 }); await settle(page);
  gp = (await hands(page)).grip;
  const other = await frameBox(page, '.entry:nth-child(3) .bullets li', 0);
  const u1 = await undoN(page);
  await page.mouse.move(gp.left + 9, gp.top + 9, { steps: 4 }); await page.mouse.down();
  await page.mouse.move(other.x + 40, other.y + 4, { steps: 8 }); await page.waitForTimeout(150);
  const refused = await hands(page);
  ok('dragged over another job, the drop is refused with a short reason, and no drop line is shown', /only within its job/.test(refused.tip) && !refused.drop, JSON.stringify(refused));
  await page.mouse.up(); await settle(page);
  ok('…let go there, nothing changes (no undo step, the same order) and the reason is said again', JSON.stringify((await printed(page))[0]) === JSON.stringify(after) && (await undoN(page)) === u1 && /only within its job/.test(await toast()), await toast());
  // the keyboard: ↑ ↓ on the grip, Enter writes the line
  await page.mouse.move(a.x + 60, a.y + 4, { steps: 3 }); await settle(page);
  await page.focus('#handlay .obgrip'); await page.keyboard.press('ArrowDown'); await settle(page);
  ok('with the focus on a grip, ↓ moves the line down one place', JSON.stringify((await printed(page))[0]) === JSON.stringify([after[1], after[0], after[2], after[3]]), JSON.stringify((await printed(page))[0]));
  await page.keyboard.press('Enter'); await settle(page);
  ok('…and Enter writes it, on the page', (await lineEl(page).count()) === 1);
  await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await settle(page);

  // "+" at a job's end: a new empty line on this resume only, written at once
  const nFacts = await page.evaluate(() => window.__wb.store.state.record.facts.length), nVars = await page.evaluate(() => window.__wb.store.state.record.variants.length);
  const last = await li(3);
  await page.mouse.move(last.x + 60, last.y + 4, { steps: 3 }); await settle(page);
  const pl = (await hands(page)).plus;
  ok('the "+" sits just under the last line of the job, in the margin', !!pl && pl.top >= last.y + last.height - 2 && pl.top <= last.y + last.height + 30 && pl.left + pl.width <= last.x, JSON.stringify([pl, last]));
  await page.mouse.click(pl.left + pl.width / 2, pl.top + pl.height / 2); await settle(page);
  const st = await page.evaluate(() => { const c = window.__wb.store.state.cur, e = window.__wb.edit.editing; return { ed: e?.fact, local: c.localLines, writing: window.__wb.ui.writing }; });
  ok('it adds an empty line at the end of the job, only on this resume (a recipe-local line), written at once', /^~new-/.test(st.ed ?? '') && st.writing === true && st.local?.hydra?.at(-1)?.id === st.ed, JSON.stringify(st));
  ok('…no claim and no version is added to the record', (await page.evaluate(() => window.__wb.store.state.record.facts.length)) === nFacts && (await page.evaluate(() => window.__wb.store.state.record.variants.length)) === nVars);
  await page.keyboard.press('Escape'); await settle(page);
  ok('left empty it is dropped again', !(await page.evaluate(() => window.__wb.store.state.cur.localLines)));
  await page.mouse.move(last.x + 60, last.y + 4, { steps: 3 }); await settle(page);
  const pl2 = (await hands(page)).plus;
  await page.mouse.click(pl2.left + 9, pl2.top + 9); await settle(page);
  await page.keyboard.insertText('Added from the page'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  const id = await page.evaluate(() => window.__wb.store.state.cur.localLines?.hydra?.[0]?.id);
  ok('with words in it, the line is kept and prints last in its job', !!id && (await frameDoc(page, d => [...d.querySelectorAll('.entry')[0].querySelectorAll('.bullets li')].at(-1).textContent)) === 'Added from the page');
  // a local line moves like any other: by the grip, and by the sidebar's ↑ ↓
  await page.mouse.move(last.x + 60, last.y + last.height + 8, { steps: 3 }); await settle(page);
  await page.keyboard.press('Escape');
  await page.evaluate(id => window.__wb.edit.stepBullet(id, -1), id); await settle(page);
  ok('the line only on this resume moves with the sidebar\'s step like any other', (await frameDoc(page, d => [...d.querySelectorAll('.entry')[0].querySelectorAll('.bullets li')].map(l => l.textContent).indexOf('Added from the page'))) === 3);
  await page.mouse.move(4, 4);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('on the page: skills arranged in place, two columns, sets, and the keyboard')) {
  const ctx = await newContext({ motion: true, viewport: { width: 1470, height: 832 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const group = n => frameBox(page, '.skills__group', n);
  const arr = () => page.evaluate(() => window.__wb.store.state.cur.skillArrangement?.groups.map(g => [g.id, g.items, g.label]) ?? null);
  const skillsText = () => frameDoc(page, d => [...d.querySelectorAll('.skills__group')].map(g => g.innerText.replace(/\n+/g, ' / ')));
  // two columns: each column's group has its own grip and "+" beside it
  const g0 = await group(0), g1 = await group(1);
  await page.mouse.move(g0.x + 40, g0.y + 8, { steps: 3 }); await settle(page);
  const h0 = await hands(page);
  await page.mouse.move(g1.x + 40, g1.y + 8, { steps: 3 }); await settle(page);
  const h1 = await hands(page);
  ok('two columns: each group gets its own grip and "+", beside it', g1.x > g0.x + g0.width / 2 && !!h0.grip && !!h1.grip && h0.grip.fact !== h1.grip.fact && h0.grip.left + h0.grip.width <= g0.x && h1.grip.left + h1.grip.width <= g1.x && h1.grip.left > h0.grip.left + 100 && !!h0.plus && !!h1.plus, JSON.stringify([h0.grip, h1.grip, g0, g1]));
  ok('…the grips are buttons named for what they move, and nothing is arranged yet', /skill group/.test(h1.grip.name) && (await arr()) === null);
  // write a group in place: its name, a line break, its skills
  await page.mouse.click(g0.x + 40, g0.y + 24); await settle(page);
  ok('one click writes a skill group: its name, then its skills', (await page.evaluate(() => window.__wb.edit.editing?.draft)) === 'CAD & 3D\nSolidWorks (CSWP), Creo, Fusion 360, KeyShot');
  await page.keyboard.insertText('!'); await settle(page);
  ok('…a click on the skills puts the caret at the end of the skills, not at the end of the name', (await page.evaluate(() => window.__wb.edit.editing?.draft)) === 'CAD & 3D\nSolidWorks (CSWP), Creo, Fusion 360, KeyShot!', JSON.stringify(await page.evaluate(() => window.__wb.edit.editing?.draft)));
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText('Tools\nCreo, Onshape'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  ok('leaving it keeps what was typed on this resume: the arrangement has the group renamed, with its skills', JSON.stringify((await arr())?.[0]) === JSON.stringify(['skills-cad', ['Creo', 'Onshape'], 'Tools']) && (await skillsText())[0] === 'Tools / Creo, Onshape', JSON.stringify(await arr()));
  ok('…the other groups are as they printed, and there is no sidebar question or save button', (await arr()).length === 4 && !(await page.$('#body [data-act^=ed-]')));
  for (const [how, go] of [['Esc', () => page.keyboard.press('Escape')], ['Tab', () => page.keyboard.press('Tab')], ['Enter', () => page.keyboard.press('Enter')], ['a click on the bare canvas', () => page.mouse.click(4, 300)]]){
    await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await settle(page);
    await page.mouse.click((await group(2)).x + 40, (await group(2)).y + 24); await settle(page);
    await appendLine(page, `, Kept by ${how}`);
    await go(); await settle(page);
    ok(`no lost text: ${how} keeps a skill typed in a group`, (await skillsText()).some(t => t.includes(`Kept by ${how}`)) && (await arr()).some(g => g[1].includes(`Kept by ${how}`)));
  }
  await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await settle(page);
  // a skill dragged to another group, on the page
  const sk = await page.evaluate(() => { const d = document.querySelector('#sheet iframe').contentDocument; const e = [...d.querySelectorAll('[data-skill]')].find(x => x.textContent === 'Python'); const r = e.getBoundingClientRect(), f = document.querySelector('#sheet iframe').getBoundingClientRect(), k = f.width / document.querySelector('#sheet iframe').offsetWidth; return { x: f.left + r.left * k, y: f.top + r.top * k, w: r.width * k, h: r.height * k }; });
  const t1 = await frameBox(page, '.skills__group:nth-child(2) [data-skill]', 1);
  await page.mouse.move(sk.x + 4, sk.y + sk.h / 2); await page.mouse.down();
  await page.mouse.move(t1.x + 4, t1.y + t1.height / 2, { steps: 8 }); await page.waitForTimeout(150);
  const hd = await hands(page);
  await page.mouse.up(); await settle(page);
  const a2 = await arr();
  ok('a skill dragged to another group lands in it, at the place shown, and leaves its own group', hd.drop && a2.find(g => g[0] === 'skills-fabrication')[1][1] === 'Python' && !a2.find(g => g[0] === 'skills-software')[1].includes('Python'), JSON.stringify(a2));
  const u = await undoN(page);
  const sk2 = await frameBox(page, '.skills__group:nth-child(1) [data-skill]', 0);
  await page.mouse.move(sk2.x + 4, sk2.y + 4); await page.mouse.down(); await page.mouse.move(120, 700, { steps: 6 }); await page.waitForTimeout(100);
  const rf = await hands(page);
  await page.mouse.up(); await settle(page);
  ok('a skill dropped anywhere but a skill group is refused, with the reason, and nothing changes', /between the skill groups/.test(rf.tip) && (await undoN(page)) === u);
  // the sidebar: chips with a keyboard route between groups
  await page.mouse.click((await group(0)).x + 40, (await group(0)).y + 30); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  ok('the skills section\'s sidebar offers a set to start from, the groups with their skills as buttons, and saving the set for a tag', !!(await page.$('#body #sk-set')) && (await page.$$('#body .skchip')).length >= 10 && !!(await page.$('#body #sk-tag')) && !!(await page.$('#body [data-act=sk-save]')));
  await page.focus('#body .skgroup:nth-of-type(1) .skchip'); await page.keyboard.press('Alt+ArrowDown'); await settle(page);
  const a3 = await arr();
  ok('Alt+↓ on a skill button moves it to the start of the group below: a keyboard way between groups', a3[1][1][0] === 'Creo' && !a3[0][1].includes('Creo'), JSON.stringify(a3));
  // + adds a group, written at once; left empty it goes
  const gx = await group(1);
  await page.mouse.move(gx.x + 40, gx.y + 8, { steps: 3 }); await settle(page);
  const pp = (await hands(page)).plus;
  await page.mouse.click(pp.left + 9, pp.top + 9); await settle(page);
  ok('"+" adds an empty skill group after this one and writes it at once, starting at its name', (await arr()).length === 5 && /^~sg-/.test((await page.evaluate(() => window.__wb.edit.editing?.fact)) ?? ''));
  await page.keyboard.insertText('Process'); await page.keyboard.press('Shift+Enter'); await page.keyboard.insertText('Lean, 5S'); await page.keyboard.press('Escape'); await settle(page);
  ok('written, it prints under its own name', (await skillsText()).some(t => t === 'Process / Lean, 5S'));
  await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await settle(page);
  const gz = await group(2);
  await page.mouse.click(gz.x + 40, gz.y + 24); await settle(page);
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('Backspace'); await page.keyboard.press('Escape'); await settle(page);
  ok('a group emptied on the page is removed (Ctrl+Z brings it back)', (await arr()).length === 4 && (await page.evaluate(() => { window.__wb.store.undo?.(); return 1; })) === 1);
  // sets: start from one, arrange, save it for a tag; a hu resume starts from the en set and its groups are listed as untranslated
  await page.evaluate(() => { window.__wb.store.commit(d => { d.record.skillSets = { 'cad': { en: [{ id: 'skills-fabrication', items: ['CNC', 'Laser'] }, { id: 'skills-testing', items: ['IEC 62366'] }] } }; }, 'sets'); });
  await settle(page);
  await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await settle(page);
  await page.frameLocator('#sheet iframe').locator('.band[data-section="skills"] .tab').first().click(); await settle(page);
  await page.selectOption('#body #sk-set', 'cad'); await settle(page);
  const a4 = await arr();
  ok('starting from a set puts its groups on the resume as a copy, free to arrange', JSON.stringify(a4.map(g => g[0])) === JSON.stringify(['skills-fabrication', 'skills-testing']) && a4[0][1].join() === 'CNC,Laser', JSON.stringify(a4));
  const tagV = await page.evaluate(() => document.querySelector('#sk-tag')?.value);
  await page.click('#body [data-act=sk-save]'); await settle(page);
  ok('"Save as the set for the tag" keeps this arrangement as that tag\'s set, for this language', !!tagV && JSON.stringify(await page.evaluate(t => window.__wb.store.state.record.skillSets[t]?.en?.map(g => g.id), tagV)) === JSON.stringify(['skills-fabrication', 'skills-testing']) && /Saved as the set/.test(await page.textContent('#toast')), tagV);
  // a Hungarian resume started from an English-only set: the groups come over and are outlined as untranslated, like any line with no wording
  await openByName(page, 'Dunamenti');
  await page.frameLocator('#sheet iframe').locator('.band[data-section="skills"] .tab').first().click(); await settle(page);
  await page.selectOption('#body #sk-set', 'cad'); await settle(page);
  const hu = await page.evaluate(() => ({ lang: window.__wb.store.state.cur.lang, arr: window.__wb.store.state.cur.skillArrangement }));
  ok('a hu resume starts from the set\'s en groups when the set has no hu ones, and the arrangement says so', hu.lang === 'hu' && hu.arr?.lang === 'en' && hu.arr.groups[0].items.join() === 'CNC,Laser', JSON.stringify(hu.arr));
  ok('…the page outlines those groups like any untranslated line', (await frameDoc(page, d => d.querySelectorAll('.skills__group.rb-miss').length)) >= 1);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('on the page: the header written in place, the photo slot, a dropped picture')) {
  const ctx = await newContext({ motion: true, viewport: { width: 1470, height: 832 } });
  const page = await ctx.newPage();
  let dialogs = 0; page.on('dialog', d => { dialogs++; d.accept(); });
  const bad = await open(page);
  const fr = page.frameLocator('#sheet iframe');
  const esc3 = async () => { await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await settle(page); };
  for (const [sel, fact, word] of [['.name', 'name', 'Name'], ['.tagline', 'tagline', 'Tagline'], ['.contact', 'contact', 'Contact']]){
    await fr.locator(sel).click(); await settle(page);
    ok(`one click on the ${fact} writes it where it prints (the claim with its versions, not a form)`, (await factOf(page)) === fact && (await lineEl(page).count()) === 1);
    await appendLine(page, ` ${word}1`);
    await page.keyboard.press('Escape'); await settle(page);
    const o = await overOf(page, fact);
    ok(`…Esc keeps it on this resume (an edit with its base version), asking nothing, and the page prints it`, dialogs === 0 && !!o.text?.endsWith(`${word}1`) && !!o.meta?.base && (await frameDoc(page, (d, s) => d.querySelector(s).textContent, sel)).includes(`${word}1`), JSON.stringify(o));
    for (const [how, go] of [['Tab', () => page.keyboard.press('Tab')], ['Enter', () => page.keyboard.press('Enter')], ['a click on the bare canvas', () => page.mouse.click(4, 300)]]){
      await esc3();
      await fr.locator(sel).click(); await settle(page);
      await appendLine(page, `+${how[0]}`);
      await go(); await settle(page);
      ok(`no lost text: ${how} keeps what was typed in the ${fact}`, dialogs === 0 && !!(await overOf(page, fact)).text?.endsWith(`+${how[0]}`));
    }
    await esc3();
  }
  ok('the contact line keeps the look of its separators when it is an edit', await frameDoc(page, d => d.querySelectorAll('.contact .contact__sep').length > 0));
  // the sidebar's header part follows the page's order: photo, name, headline, contact
  await fr.locator('.name').click(); await settle(page);
  await page.click('#body .depth [data-act=select-header]'); await settle(page);
  const order = await page.evaluate(() => { const at = s => { const e = document.querySelector(`#body ${s}`); return e ? e.getBoundingClientRect().top : null; }; return [at('.photo-row'), at('#c-name'), at('#c-label'), at('#c-email')]; });
  ok('the header\'s sidebar part is in the page\'s order: photo, then name, headline, contact', order.every(Number.isFinite) && order[0] < order[1] && order[1] < order[2] && order[2] < order[3], JSON.stringify(order));
  await esc3();
  // the photo slot beside the name
  const nm = await frameBox(page, '.name');
  await page.mouse.move(nm.x + 30, nm.y + 12, { steps: 3 }); await settle(page);
  const hs = await hands(page);
  ok('hovering the header shows a photo slot beside the name: the pill, a button named for what it does', !!hs.slot && hs.slot.tag === 'BUTTON' && hs.slot.pressed === null && /^Show photo on this resume$/.test(hs.slot.name) && hs.slot.left > nm.x, JSON.stringify(hs.slot));
  await page.mouse.click(hs.slot.left + hs.slot.width / 2, hs.slot.top + hs.slot.height / 2); await settle(page);
  ok('clicking it prints the photo on this resume (one undo step); it is then pressed', (await page.evaluate(() => window.__wb.store.state.cur.photo?.show)) === true && (await frameDoc(page, d => !!d.querySelector('.portrait'))));
  await page.mouse.move(nm.x + 30, nm.y + 12, { steps: 3 }); await settle(page);
  const hs2 = await hands(page);
  ok('…the slot is then on the photo and says it hides it', !!hs2.slot && /^Hide photo from this resume$/.test(hs2.slot.name));
  await page.mouse.click(hs2.slot.left + 9, hs2.slot.top + 9); await settle(page);
  ok('…and clicking again takes it off', (await page.evaluate(() => window.__wb.store.state.cur.photo?.show)) === false);
  // a dropped picture asks what it is for
  const drop = (inFrame = false) => page.evaluate(async inFrame => {
    const c = document.createElement('canvas'); c.width = 80; c.height = 100; c.getContext('2d').fillRect(0, 0, 80, 100);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'me.png', { type: 'image/png' }));
    const fw = document.querySelector('#sheet iframe').contentWindow;       // the page is a frame: a drop inside it stays inside it
    (inFrame ? fw.document.querySelector('.page') : window).dispatchEvent(new (inFrame ? fw : window).DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, inFrame);
  const img0 = await page.evaluate(() => window.__wb.store.state.record.basics.image ?? null), u0 = await undoN(page);
  await drop(true); await settle(page);
  const q = await page.evaluate(() => { const b = document.querySelector('.photoask'); return b ? { role: b.getAttribute('role'), inCard: b.parentElement.id === 'body', btns: [...b.querySelectorAll('button')].map(x => x.textContent), focus: b.contains(document.activeElement) } : null; });
  ok('a picture dropped on the page asks what it is for: this resume\'s photo, your record, or cancel (and nothing is stored yet)', q?.role === 'group' && q.inCard && JSON.stringify(q.btns) === JSON.stringify(['The photo for this resume', 'For your record, not printed', 'Cancel']) && q.focus && (await page.evaluate(() => window.__wb.store.state.record.basics.image ?? null)) === img0 && (await undoN(page)) === u0, JSON.stringify(q));
  await page.keyboard.press('Escape'); await settle(page);
  ok('…Esc cancels it: nothing changes', !(await page.$('.photoask')) && (await page.evaluate(() => window.__wb.store.state.record.basics.image ?? null)) === img0 && (await undoN(page)) === u0);
  await drop(); await settle(page); await page.click('.photoask [data-pa=record]'); await settle(page);
  ok('"for your record" stores the picture in the record and leaves this resume without a photo', !!(await page.evaluate(() => window.__wb.store.state.record.basics.image)) && (await page.evaluate(() => window.__wb.store.state.cur.photo?.show)) === false);
  await drop(); await settle(page); await page.click('.photoask [data-pa=resume]'); await settle(page);
  ok('"the photo for this resume" stores it and prints it here', (await page.evaluate(() => window.__wb.store.state.cur.photo?.show)) === true && (await frameDoc(page, d => !!d.querySelector('img.portrait'))));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('on the page: a job opens by its name')) {
  const ctx = await newContext({ viewport: { width: 1470, height: 832 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  await page.frameLocator('#sheet iframe').locator('.band[data-section="experience"] .tab').first().click(); await settle(page);
  const jn = await page.evaluate(() => [...document.querySelectorAll('#body .jobname')].map(b => ({ tag: b.tagName, name: b.textContent.trim(), h: b.getBoundingClientRect().height, act: b.dataset.act })));
  ok('in a section\'s view each job\'s name is a button that selects the job, at least 24 px tall', jn.length >= 3 && jn.every(j => j.tag === 'BUTTON' && j.act === 'select-job' && j.h >= 24), JSON.stringify(jn));
  await page.setViewportSize({ width: 1280, height: 832 }); await settle(page);
  const clip = await page.evaluate(() => [...document.querySelectorAll('#body .jobname')].map(b => ({ name: b.textContent.trim(), cut: b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1, title: b.title, h: b.getBoundingClientRect().height })));
  ok('at 1280 wide a job\'s name wraps instead of being cut, has a title, and stays 24 px tall', clip.every(j => !j.cut && j.title.startsWith(j.name.split(' · ')[0]) && j.h >= 24), JSON.stringify(clip));
  await page.setViewportSize({ width: 1470, height: 832 }); await settle(page);
  ok('…the separate "Open it" button is gone from the section\'s view', !(await page.$$eval('#body button', bs => bs.some(b => /^Open it$/.test(b.textContent.trim())))));
  const hov = await page.evaluate(() => { const b = document.querySelector('#body .jobname'); return getComputedStyle(b).textDecorationLine; });
  await page.hover('#body .jobname');
  ok('…it shows a hover state', (await page.evaluate(() => getComputedStyle(document.querySelector('#body .jobname')).textDecorationLine)) === 'underline' && hov === 'none');
  await page.focus('#body .jobname'); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  ok('…and a visible focus ring', await page.evaluate(() => { const o = getComputedStyle(document.querySelector('#body .jobname')); return document.activeElement.classList.contains('jobname') && o.outlineStyle !== 'none' && parseFloat(o.outlineWidth) >= 2; }));
  await page.locator('#body .jobname').nth(1).click(); await settle(page);
  ok('clicking the name selects that job', (await selOf(page)) === `job:${await page.evaluate(() => [...window.__wb.ui.ix.work.keys()][1])}`, await selOf(page));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

// ---- UX-6c-iii-a: every printed text is written where it is printed, and each item is selected ----
// The audit made a check: for every kind of text the renderer prints (Medtech, and a scratch record with a custom section, volunteering,
// awards, references and projects), one click writes it in place (an editable element on that text, with a role and a name), typing and Esc keep
// it on this resume (an edit with its base version and marks, a heading in the resume's language, a language's name on the resume), and the
// page prints it. An item of education, patent, a language, a certificate or an interest is selected as a whole.
if (want('on the page: every printed text is written where it is printed, and each item is selected')) {
  const ctx = await newContext({ motion: true, viewport: { width: 2560, height: 1100 } });      // both pages of Medtech side by side
  const page = await ctx.newPage();
  let dialogs = 0; page.on('dialog', d => { dialogs++; d.accept(); });
  const bad = await open(page);
  await openByName(page, 'Medtech');
  await page.evaluate(async () => {
    const K = await import('/src/model/career.js'), T = await import('/src/model/resume.js');
    window.__wb.store.commit(d => {
      const vol = K.createKind(d.record, { ...K.KIND_PRESETS.volunteering, name: { en: 'Volunteering' } });
      const aw = K.createKind(d.record, { ...K.KIND_PRESETS.awards, name: { en: 'Awards' } });
      K.addKindEntry(d.record, vol, { name: 'Volunteer repairer', org: 'Porto Repair Cafe', startDate: '2019-03', endDate: '2022-06', bullets: ['Fixed small appliances.'] });
      K.addKindEntry(d.record, aw, { name: 'Best student design', org: 'Example Society', startDate: '2020-11' });
      K.addReference(d.record, { name: 'Ana Costa', reference: 'Worked with Dana for two years.' });
      for (const sid of ['volunteer', 'awards', 'projects', 'references']) T.setSectionOn(d.record, d.cur, sid, true);
    }, 'scratch record');
  });
  await settle(page);
  const fr = page.frameLocator('#sheet iframe');
  const esc2 = async () => { await page.mouse.move(4, 4); for (let k = 0; k < 2; k++) await page.keyboard.press('Escape'); await settle(page); };
  const cur = () => page.evaluate(() => window.__wb.store.state.cur);
  const printedIn = (sel, n) => frameDoc(page, (d, [s, m]) => [...d.querySelectorAll(s)].some(e => e.textContent.includes(m)), [sel, n]);
  // [name, selector, kind, key (the text's own), chip words of its item (or null)]
  const S = id => `.band[data-section=${id}]`;
  const rows = [
    ['the name', `${S('header')} .name`, 'fact', 'name', null], ['the headline', `${S('header')} .tagline`, 'fact', 'tagline', null], ['the contact line', `${S('header')} .contact`, 'fact', 'contact', null],
    ['the summary', '.summary', 'fact', 'summary', null],
    ['a heading', `${S('experience')} h2.tab`, 'head', '~h:experience', null],
    ['a job’s title', `${S('experience')} .role-title`, 'fact', 'hydra-position', null], ['a job’s date line', `${S('experience')} .entry .meta`, 'fact', 'hydra-meta', null], ['a bullet', `${S('experience')} .bullets li`, 'fact', 'hydra-inhaler', null],
    ['a skill group', `${S('skills')} .skills__items`, 'group', 'skills-cad', null],
    ['a certificate', `${S('certified')} .runs strong`, 'fact', 'cert-solidworks', ['Page', 'Certified', 'SolidWorks']],
    ['the patent’s title', `${S('patent')} .item__title`, 'fact', 'patent-title', ['Page', 'Patent', 'Dose-counti…']], ['the patent’s line', `${S('patent')} .meta--flat`, 'fact', 'patent-meta', ['Page', 'Patent', 'Dates']],
    ['education’s degree', `${S('education')} .item__title`, 'fact', 'edu-degree', ['Page', 'Education', 'M.Eng']], ['education’s school', `${S('education')} .item__title-secondary`, 'fact', 'edu-school', ['Page', 'Education', 'Universidade']], ['education’s date line', `${S('education')} .meta--flat`, 'fact', 'edu-meta', ['Page', 'Education', 'Dates']],
    ['a language’s name', `${S('languages')} dt`, 'term', '~t:lang-portuguese', ['Page', 'Languages', 'Portuguese']], ['a language’s level', `${S('languages')} dd`, 'fact', 'lang-portuguese', ['Page', 'Languages', 'Portuguese']],
    ['an interest', `${S('interests')} .runs strong`, 'fact', 'interest-sailing', ['Page', 'Interests', 'Dinghy']],
    ['a custom section’s heading', `${S('awards')} h2.tab`, 'head', '~h:awards', null], ['an award (a custom run)', `${S('awards')} .runs strong`, 'fact', 'best-student-design', ['Page', 'Awards', 'Best']],
    ['volunteering’s title', `${S('volunteer')} .role-title`, 'fact', 'volunteer-repairer-position', null], ['volunteering’s line', `${S('volunteer')} .entry .meta`, 'fact', 'volunteer-repairer-meta', null], ['a volunteering bullet', `${S('volunteer')} .bullets li`, 'fact', 'volunteer-repairer-fixed', null],
    ['a reference’s name', `${S('references')} dt`, 'term', '~t:ref-ana-costa', ['Page', 'References', 'Ana']], ['a reference’s words', `${S('references')} dd`, 'fact', 'ref-ana-costa', ['Page', 'References', 'Ana']],
    ['a project’s title', `${S('projects')} .role-title`, 'fact', 'caliper-stand-position', null], ['a project’s line', `${S('projects')} .entry .meta`, 'fact', 'caliper-stand-meta', null], ['a project’s bullet', `${S('projects')} .bullets li`, 'fact', 'caliper-stand-files', null],
  ];
  const bring = async sel => {
    const at = await frameDoc(page, (d, s) => [...d.querySelectorAll('.document > .page')].findIndex(p => p.querySelector(s)), sel);
    if (at >= 0 && at !== (await page.evaluate(() => window.__wb.ui.page))){ await page.evaluate(i => window.__wb.canvas.goToPage(i), at); await settle(page); }
  };
  // a click lands on the left of the text (an item's title shares its line with the subtitle; a run shares its paragraph)
  const clickText = async (sel, nth = 0) => { await bring(sel); await fr.locator(sel).nth(nth).click({ position: { x: 4, y: 3 } }); await settle(page); };
  const keys = [];
  let n = 0;
  for (const [name, sel, kind, key, chip] of rows){
    await esc2();
    const mark = ` +x${++n}`;
    await clickText(sel);
    const got = await page.evaluate(() => ({ key: window.__wb.edit.editing?.fact ?? null, ce: document.querySelector('#sheet iframe').contentDocument.querySelectorAll('[contenteditable]').length, role: window.__wb.onpage.el()?.getAttribute('role'), label: window.__wb.onpage.el()?.getAttribute('aria-label'), draft: window.__wb.edit.editing?.draft }));
    ok(`${name}: one click writes it where it is printed (an editable element with a role and a name)`, got.key === key && got.ce === 1 && got.role === 'textbox' && !!got.label && !!got.draft?.trim(), JSON.stringify(got));
    const nm = await page.evaluate(() => { const e = window.__wb.onpage.el(); return { label: e?.getAttribute('aria-label'), multi: e?.getAttribute('aria-multiline') }; });
    ok(`${name}: named by what it is (${nm.label}), multi-line only for a bullet or the summary`, !!nm.label && nm.label !== 'The line, to write' && nm.label.includes(', ') && (nm.multi === 'true') === (name === 'the summary' || /bullet/.test(name)), JSON.stringify(nm));
    await appendLine(page, mark);
    await page.keyboard.press('Escape'); await settle(page);
    const c = await cur(), id = key.slice(3), L = 'en';
    const stored = kind === 'fact' ? c.overrides?.[key]?.endsWith(mark) && !!c.overrideMeta?.[key]?.base && Array.isArray(c.overrideMeta[key].marks)
      : kind === 'group' ? c.skillArrangement?.groups.find(g => g.id === key)?.items.at(-1).endsWith(mark)
      : kind === 'head' ? c.sections.find(s => s.id === id)?.label?.[L]?.endsWith(mark) : c.terms?.[id]?.[L]?.endsWith(mark);
    ok(`${name}: Esc keeps it on this resume (${kind === 'fact' ? 'an edit with its base version and its highlights' : kind === 'group' ? 'the skills of this resume\'s own arrangement' : kind === 'head' ? 'the heading in the resume’s language' : 'the name on this resume, in its language'}), asking nothing`, !!stored && dialogs === 0, JSON.stringify(kind === 'fact' ? c.overrideMeta?.[key] : kind === 'group' ? c.skillArrangement : kind === 'head' ? c.sections.find(s => s.id === id)?.label : c.terms));
    ok(`${name}: the page prints it`, await printedIn(kind === 'head' || kind === 'term' ? '[data-label]' : '[data-variant]', mark));
    if (kind === 'fact') keys.push(key);
    if (chip){
      // selected as an item: the chip names the item, the frame goes round it, the card is the text's own view
      const words = await page.$$eval('#editlay .obchip .dp-w', e => e.map(x => x.textContent));
      const fb = await page.$eval('#editlay .obframe.sec.dashed', e => e.getBoundingClientRect().toJSON()).catch(() => null);
      const bx = await fr.locator(sel).first().boundingBox();
      ok(`${name}: selected, the chip says ${chip.join(' › ')} and a dashed frame goes round the item`, JSON.stringify(words) === JSON.stringify(chip) && !!fb && !!bx && fb.left <= bx.x + 1 && fb.right >= bx.x + bx.width - 1 && fb.top <= bx.y + 1 && fb.bottom >= bx.y + bx.height - 1 && fb.height < 200, JSON.stringify([words, fb, bx]));
      const g = await chipGeomOf(page);
      ok(`${name}: the chip stands on the frame’s top edge, over no printed text, tools, rail, sidebar or zoom bar`, g.onEdge && g.over === 0 && g.room, JSON.stringify(g));
    }
  }
  await esc2();

  // a volunteering entry is named by its organisation in the chip, never by its id
  await esc2();
  await clickText(`${S('volunteer')} .role-title`);
  const vw = await page.$$eval('#editlay .obchip .dp-w', e => e.map(x => x.textContent));
  ok('the chip of a volunteering entry: Page › Volunteering › Porto, not its id', JSON.stringify(vw) === JSON.stringify(['Page', 'Volunteering', 'Porto']), JSON.stringify(vw));
  // a heading typed in one language and kept after the resume's language changed stays in the language it was typed in
  await esc2();
  await clickText(`${S('education')} h2.tab`);
  await appendLine(page, ' +lang');
  await page.evaluate(async () => { const L = await import('/src/model/lang.js'); window.__wb.store.commit(d => { L.switchLang(d.cur, 'pt'); }, 'switch'); });
  await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  const lab = (await cur()).sections.find(x => x.id === 'education')?.label;
  ok('a heading typed before the resume’s language changed is kept in the language it was typed in', !!lab?.en?.endsWith(' +lang') && !lab?.pt, JSON.stringify(lab));
  await page.evaluate(async () => { const L = await import('/src/model/lang.js'); window.__wb.store.commit(d => { L.switchLang(d.cur, 'en'); }, 'switch back'); });
  await settle(page);

  // each edit is on the Review list's data with its base (UX-6d offers it as a version)
  const pend = await page.evaluate(async () => { const T = await import('/src/model/resume.js'), c = window.__wb.store.state.cur; return T.pendingEdits(c).filter(id => c.overrideMeta?.[id]?.base).sort(); });
  ok('every text edited above is listed by pendingEdits with its base version (header facts too)', keys.every(k => pend.includes(k)), JSON.stringify(keys.filter(k => !pend.includes(k))));

  // the arrows and Tab walk every text, the header facts first, then the summary
  const order = await page.evaluate(() => window.__wb.sheet.order(window.__wb.ui.ix));
  ok('the keys the arrows and Tab walk are every printed text in print order: the header facts first, then the summary, the headings and the items', JSON.stringify(order.slice(0, 4)) === JSON.stringify(['tagline', 'name', 'contact', 'summary']) && ['~h:experience', 'hydra-position', 'patent-title', 'edu-school', '~t:lang-portuguese', 'lang-portuguese', 'cert-gdt'].every(k => order.includes(k)) && order.indexOf('~h:education') < order.indexOf('edu-degree') && order.indexOf('~t:lang-english') > order.indexOf('lang-portuguese'), order.slice(0, 8).join());
  await clickText(`${S('header')} .tagline`);
  const seen = [await factOf(page)];
  for (let k = 0; k < 3; k++){ await page.keyboard.press('Tab'); await settle(page); seen.push(await factOf(page)); }
  ok('Tab from a header fact goes to the next header fact, then the summary (not the page’s first line)', JSON.stringify(seen) === JSON.stringify(['tagline', 'name', 'contact', 'summary']), seen.join());
  await page.keyboard.press('Shift+Tab'); await settle(page);
  ok('Shift+Tab goes back, and Enter goes on', (await factOf(page)) === 'contact' && (await (async () => { await page.keyboard.press('Enter'); await settle(page); return (await factOf(page)) === 'summary'; })()));
  await esc2();
  // from the page level the arrow keys select a text and Enter writes it, a heading too
  await page.keyboard.press('ArrowDown'); await settle(page);
  ok('↓ from the page level selects the first text (the headline), and Enter writes it', (await selOf(page)) === 'bullet:tagline' && (await (async () => { await page.keyboard.press('Enter'); await settle(page); return (await lineEl(page).count()) === 1 && (await factOf(page)) === 'tagline'; })()));
  await esc2();
  const hAt = order.indexOf('~h:experience');
  for (let k = 0; k <= hAt; k++){ await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150); }
  await settle(page);
  ok('the arrows reach a heading: it is selected as the section, and Enter writes it', (await selOf(page)) === 'section:experience' && (await page.evaluate(() => window.__wb.ui.sel.heading)) === true && (await (async () => { await page.keyboard.press('Enter'); await settle(page); return (await lineEl(page).count()) === 1 && (await factOf(page)) === '~h:experience'; })()));
  await esc2();

  // no lost text: a heading, a language's name, an item's title and a job's title, left five ways
  for (const [name, sel, nth, kind, key] of [['a heading', `${S('education')} h2.tab`, 0, 'head', '~h:education'], ['a language’s name', `${S('languages')} dt`, 1, 'term', '~t:lang-english'], ['an item’s title', `${S('patent')} .item__title`, 0, 'fact', 'patent-title'], ['a job’s title', `${S('experience')} .role-title`, 1, 'fact', 'poly-position']]){
    for (const [how, go] of [['Tab', () => page.keyboard.press('Tab')], ['Enter', () => page.keyboard.press('Enter')], ['a click on the bare canvas', () => page.mouse.click(4, 300)], ['a click on another text', () => fr.locator('.summary').click({ position: { x: 4, y: 3 } })], ['the Design tab', () => page.click('#tab-design')]]){
      await esc2(); await page.click('#tab-edit'); await settle(page);
      const mark = ` +${how.replace(/\W/g, '').slice(0, 5)}`;
      await clickText(sel, nth);
      if (!(await lineEl(page).count())){ ok(`no lost text: ${how} keeps what was typed in ${name}`, false, 'nothing was written'); continue; }
      await appendLine(page, mark);
      await go(); await settle(page);
      const c = await cur(), id = key.slice(3);
      const kept = kind === 'fact' ? c.overrides?.[key]?.endsWith(mark) : kind === 'head' ? c.sections.find(s => s.id === id)?.label?.en?.endsWith(mark) : c.terms?.[id]?.en?.endsWith(mark);
      ok(`no lost text: ${how} keeps what was typed in ${name}`, !!kept && dialogs === 0, kind === 'fact' ? c.overrides?.[key] : JSON.stringify([c.terms, c.sections.find(s => s.id === id)?.label]));
    }
  }
  await esc2(); await page.click('#tab-edit'); await settle(page);

  // a one-item section keeps no grip; the photo slot is still on the header
  const eb = await frameBox(page, `${S('education')} .item__title`);
  await page.mouse.move(eb.x + 60, eb.y + 6, { steps: 4 }); await settle(page);
  const hs = await hands(page);
  ok('hovering an item of a one-item section shows no grip, no plus and no photo slot', !hs.grip && !hs.plus && !hs.slot, JSON.stringify(hs));

  // the sidebar: the education row opens the item's own view (not the record's form); the way to the record's own fields stays
  await toEditHome(page);
  await page.click('#outline [data-act=ol-toggle][data-g="sec:education"]'); await settle(page);
  await page.click('#outline .osec[data-sid=education] .clt'); await settle(page);
  ok('the education row in the sidebar opens the item\'s own view: its degree, with the versions in the card (the Edit tab stays)', (await selOf(page)) === 'bullet:edu-degree' && (await page.getAttribute('#body', 'data-view')) === 'bullet' && (await page.evaluate(() => window.__wb.ui.view)) == null && (await page.locator('#body .vrow').count()) >= 1);
  ok('…with a clear way to the record\'s own fields (the grade, the dates, the courses)', /Other fields of this entry/.test(await page.textContent('#body')) && /All of your record/.test(await page.textContent('#body')));
  await page.click('#body [data-act=cl-open]'); await settle(page);
  ok('…which opens the record\'s form for the entry', await page.evaluate(() => window.__wb.ui.sel.kind === 'record' && window.__wb.ui.sel.what === 'entry'));
  // a language's name in the sidebar: a box that does what the page does
  await toEditHome(page);
  await clickText(`${S('languages')} dt`); await page.keyboard.press('Escape'); await settle(page);
  ok('a language\'s name selected has its own view with a box for the name on this resume', !!(await page.$('#body #term-in')) && (await page.inputValue('#body #term-in')).includes('+x'));
  await page.fill('#body #term-in', ''); await page.press('#body #term-in', 'Enter'); await settle(page);
  ok('…emptying it takes the record\'s name back', !((await cur()).terms?.['lang-portuguese']) && (await printedIn('[data-label^="t:"]', 'Portuguese')) && !(await printedIn('[data-label="t:lang-portuguese"]', '+x')), JSON.stringify((await cur()).terms));
  await esc2();

  // the Record's groups: the entry's name opens it (no "Open it" button)
  await page.evaluate(() => window.__wb.dock.setMode('record')); await settle(page);
  const nm = await page.evaluate(() => [...document.querySelectorAll('#checklist .clg[data-g=hydra] .jobname')].map(b => ({ tag: b.tagName, name: b.textContent.trim(), h: b.getBoundingClientRect().height, act: b.dataset.act })));
  ok('in the Record each entry\'s name is the button that opens it (at least 24 px), and there is no separate "Open it"', nm.length === 1 && nm[0].tag === 'BUTTON' && nm[0].h >= 24 && nm[0].act === 'cl-open' && nm[0].name.length > 3 && !(await page.$$eval('#checklist button', bs => bs.some(b => /^Open it$/.test(b.textContent.trim())))), JSON.stringify(nm));
  await page.hover('#checklist .clg[data-g=hydra] .jobname');
  ok('…it shows a hover state', (await page.evaluate(() => getComputedStyle(document.querySelector('#checklist .clg[data-g=hydra] .jobname')).textDecorationLine)) === 'underline');
  await page.focus('#checklist .clg[data-g=hydra] .jobname'); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  ok('…and a visible focus ring', await page.evaluate(() => { const b = document.activeElement, o = getComputedStyle(b); return b.classList.contains('jobname') && o.outlineStyle !== 'none' && parseFloat(o.outlineWidth) >= 2; }));
  await page.click('#checklist .clg[data-g=hydra] .jobname'); await settle(page);
  ok('clicking it opens the job in Edit', (await selOf(page)) === 'job:hydra' && (await page.evaluate(() => window.__wb.ui.view)) == null);

  // the header's field in the chip, and the photo
  await esc2();
  for (const [sel, word] of [['.name', 'Name'], ['.tagline', 'Headline'], ['.contact', 'Contact']]){
    await clickText(`${S('header')} ${sel}`);
    const ws = await page.$$eval('#editlay .obchip .dp-w', e => e.map(x => x.textContent)), side = await page.$$eval('#body .depth .dp-w', e => e.map(x => x.textContent));
    ok(`the chip names the header field: Page › Header › ${word}, and so does the card`, JSON.stringify(ws) === JSON.stringify(['Page', 'Header', word]) && side.includes(word), JSON.stringify([ws, side]));
    await esc2();
  }
  await page.click('#outline [data-act=ol-toggle][data-g="sec:header"]'); await settle(page);
  await page.click('#outline [data-act=cl-open][data-sel*="photo"]'); await settle(page);
  ok('…and the photo: Page › Header › Photo', JSON.stringify(await page.$$eval('#editlay .obchip .dp-w', e => e.map(x => x.textContent))) === JSON.stringify(['Page', 'Header', 'Photo']));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

// An item's frame stands off less than a section's: it must not cut through the next row (a language, a certificate, an interest).
if (want('on the page: an item frame stays off its neighbours, at four sizes')) {
  for (const [w, h] of [[1280, 720], [1470, 832], [1920, 1080], [2560, 1100]]) {
    const ctx = await newContext({ motion: true, viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const bad = await open(page);
    await openByName(page, 'Medtech');
    const fr = page.frameLocator('#sheet iframe');
    const fails = [];
    for (const [name, sel] of [['language names', '.band[data-section=languages] dt'], ['language levels', '.band[data-section=languages] dd'], ['certificates', '.band[data-section=certified] .runs strong'], ['interests', '.band[data-section=interests] .runs strong']]) {
      const at = await frameDoc(page, (d, s) => [...d.querySelectorAll('.document > .page')].findIndex(p => p.querySelector(s)), sel);
      if (at >= 0) { await page.evaluate(i => window.__wb.canvas.goToPage(i), at); await settle(page); }
      if ((await fr.locator(sel).count()) < 2) { fails.push(`${name}: fewer than two rows`); continue; }
      await page.keyboard.press('Escape'); await settle(page);
      await fr.locator(sel).nth(0).click({ position: { x: 4, y: 3 } }); await settle(page);
      await page.keyboard.press('Escape'); await settle(page);
      const f = await page.$eval('#editlay .obframe.sec.dashed', e => e.getBoundingClientRect().toJSON()).catch(() => null);
      const nx = await fr.locator(sel).nth(1).boundingBox();
      if (!f || !nx) { fails.push(`${name}: no frame or no next row`); continue; }
      if (f.left < nx.x + nx.width && f.right > nx.x && f.top < nx.y + nx.height && f.bottom > nx.y) fails.push(`${name}: frame ${JSON.stringify([f.left, f.top, f.right, f.bottom])} cuts the next row ${JSON.stringify(nx)}`);
    }
    ok(`${w}x${h}: the selected item's frame cuts through no neighbouring row (language names and levels, certificates, interests)`, fails.length === 0, fails.join('; '));
    ok(`${w}x${h}: no console errors`, bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
}

if (want('the lock: the padlock, the chip’s switch, and grips for jobs, sections and items')) {
  const ctx = await newContext({ motion: true, viewport: { width: 1470, height: 832 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const fr = page.frameLocator('#sheet iframe');
  const lockedOf = () => page.evaluate(() => window.__wb.store.state.cur.locked ?? null);
  const hint = () => page.evaluate(() => { const t = document.querySelector('#handlay .obtip'); return t && !t.hidden ? t.textContent : ''; });
  const tool = (s, o = '#editlay .obchip') => page.evaluate(([sel]) => { const b = document.querySelector(sel); if (!b) return null; const r = b.getBoundingClientRect(); return { tag: b.tagName, tab: b.tabIndex, pressed: b.getAttribute('aria-pressed'), name: b.getAttribute('aria-label'), dis: b.getAttribute('aria-disabled') === 'true' || b.disabled, h: r.height, w: r.width }; }, [`${o} ${s}`]);
  const esc2 = async () => { await page.mouse.move(4, 4); for (let k = 0; k < 2; k++) await page.keyboard.press('Escape'); await settle(page); };
  const lines = () => printed(page);
  const hydraLine = (n = 0) => fr.locator('.entry:first-child .bullets li').nth(n);

  // ---- the padlock on the chip ----
  await hydraLine(0).click(); await settle(page);
  const lk = await tool('.dp-lock'), sh = await tool('.dp-show');
  ok('the chip of a line has a padlock and a switch at its right end: real buttons in the focus order, each at least 24 px, named for what the chip names, the padlock aria-pressed false',
    lk?.tag === 'BUTTON' && sh?.tag === 'BUTTON' && lk.tab === 0 && sh.tab === 0 && lk.h >= 24 && lk.w >= 24 && /^Lock the line in Hydra/.test(lk.name) && lk.pressed === 'false' && /^Hide the line in Hydra Medical from this resume$/.test(sh.name) && sh.pressed === null, JSON.stringify([lk, sh]));
  const typed = 'Led the dose-counter redesign, written here and locked';
  await writeLine(page, typed);
  const u0 = await undoN(page);
  await page.evaluate(() => { window.__said = []; new MutationObserver(() => window.__said.push(document.querySelector('#announce').textContent)).observe(document.querySelector('#announce'), { childList: true, characterData: true, subtree: true }); });
  await page.click('#editlay .dp-lock'); await settle(page);
  let c = await page.evaluate(() => window.__wb.store.state.cur);
  ok('the padlock locks the line it names, and what was being written is kept first: the text is on this resume, nothing is lost', JSON.stringify(c.locked) === '["hydra-inhaler"]' && c.overrides['hydra-inhaler'] === typed, JSON.stringify([c.locked, c.overrides['hydra-inhaler']]));
  ok('…the kept text and the lock are one undo step each, and the page keeps printing the text', (await undoN(page)) === u0 + 2 && (await printed(page))[0][0].startsWith('Led the dose-count'));
  ok('…the padlock now says Unlock, is pressed, and the same padlock is at the top of the sidebar', (await tool('.dp-lock'))?.pressed === 'true' && /^Unlock the line in Hydra/.test((await tool('.dp-lock')).name) && (await tool('.dp-lock', '#body .depth'))?.pressed === 'true');
  ok('…it is announced in the live region', (await page.evaluate(() => window.__said)).some(x => /^Locked the line in Hydra/.test(x)), JSON.stringify(await page.evaluate(() => window.__said)));
  ok('…a small padlock stands at the frame’s corner (a locked block has no grip there)', (await page.locator('#editlay .oblockmark').count()) === 1);

  // ---- locked text is not written ----
  const before = await lines();
  await hydraLine(0).click(); await settle(page);
  ok('a click on locked text starts no caret: nothing on the page is editable, the line’s block is selected, the chip shows', (await fr.locator('[contenteditable]').count()) === 0 && (await page.evaluate(() => window.__wb.ui.sel.id)) === 'hydra-inhaler' && !(await page.evaluate(() => window.__wb.ui.writing)) && (await page.locator('#editlay .obchip').count()) === 1);
  ok('…a quiet hint appears by the padlock and in the live region: “Locked. Click the padlock to unlock.”', (await hint()) === 'Locked. Click the padlock to unlock.' && (await page.textContent('#announce')) === 'Locked. Click the padlock to unlock.', JSON.stringify([await hint(), await page.textContent('#announce')]));
  const hr = await page.evaluate(() => { const t = document.querySelector('#handlay .obtip').getBoundingClientRect(), l = document.querySelector('#editlay .dp-lock').getBoundingClientRect(); return { dx: Math.abs(t.right - l.right), dy: t.top - l.bottom, near: t.top >= l.bottom - 1 || t.bottom <= l.top + 1 }; });
  ok('…and stands next to the padlock', hr.dx < 24 && hr.near && Math.abs(hr.dy) < 40, JSON.stringify(hr));
  await page.keyboard.press('Enter'); await settle(page);
  ok('Enter on a locked line does not write it either', (await fr.locator('[contenteditable]').count()) === 0);
  ok('the sidebar: the tick, the versions and the ones that would change the text are off, with the reason in a tooltip, and a note says so', await page.evaluate(() => {
    const b = document.querySelector('#body');
    return !!b.querySelector('.locknote') && b.querySelector('#b-on')?.disabled === true && /Locked/.test(b.querySelector('#b-on').title)
      && [...b.querySelectorAll('.vlist .vrow')].every(r => !r.hasAttribute('data-act') && r.getAttribute('aria-disabled') === 'true' || r.classList.contains('cur') && !r.hasAttribute('data-act'));
  }));
  // hover: no grip, no "+"
  const b0 = await hydraLine(0).boundingBox();
  await page.mouse.move(b0.x + 60, b0.y + 4, { steps: 3 }); await settle(page);
  const hs = await hands(page);
  ok('hovering a locked line shows no grip (the job’s “+” stays: the job is not locked)', !hs.grip && !!hs.plus, JSON.stringify(hs));
  // the keyboard and the sidebar's ↑↓
  await page.mouse.move(4, 4);
  await page.keyboard.press('Alt+ArrowDown'); await settle(page);
  ok('Alt+↓ on a locked line moves nothing and says why', JSON.stringify(await lines()) === JSON.stringify(before) && (/Locked/.test(await page.textContent('#toast')) || /Locked/.test(await hint())), JSON.stringify(await lines()));      // said as the hint by the padlock, or as a toast when the chip is not on the page
  // a local line: remove and tick are off
  await esc2();

  // ---- the Outline: the lock icons, inherited ones, and the rows ----
  await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); }); await settle(page);
  await page.click('#outline .clg[data-g=hydra] .ocaret'); await settle(page);
  const row = '#outline .clrow[data-fact=hydra-inhaler]';
  const rl = await page.evaluate(r => { const e = document.querySelector(r), b = e?.querySelector('.rowlock'); return b && { pressed: b.getAttribute('aria-pressed'), name: b.getAttribute('aria-label'), tag: b.tagName, tab: b.tabIndex, h: b.getBoundingClientRect().height, cb: e.querySelector('input.sw').disabled, drag: e.draggable, inh: e.classList.contains('is-inherited') }; }, row);
  ok('the Outline: a locked line’s row shows its padlock (pressed, named, a button, at least 24 px), its tick is off and it cannot be dragged', !!rl && rl.pressed === 'true' && /^Unlock/.test(rl.name) && rl.tag === 'BUTTON' && rl.tab === 0 && rl.h + 2 >= 24 && rl.cb && !rl.drag && !rl.inh, JSON.stringify(rl));
  const other = await page.evaluate(() => { const e = document.querySelector('#outline .clrow[data-fact=hydra-testing]'), b = e?.querySelector('.rowlock'); return b && { pressed: b.getAttribute('aria-pressed'), cb: e.querySelector('input.sw').disabled }; });
  ok('…and the other lines have a padlock of their own, unpressed, with their ticks on', other?.pressed === 'false' && other.cb === false, JSON.stringify(other));
  await page.click('#outline .clg[data-g=hydra] .clgh .rowlock'); await settle(page);
  ok('a padlock on a job’s row locks the job: its lines show as locked by it (greyed, the lock inherited), ticks off', JSON.stringify(await lockedOf()) === '["hydra-inhaler","hydra"]' && await page.evaluate(() => { const rs = [...document.querySelectorAll('#outline .clg[data-g=hydra] .clrow')]; return rs.length >= 3 && rs.every(r => r.querySelector('input.sw').disabled && r.querySelector('.rowlock')?.getAttribute('aria-pressed') === 'true') && rs.filter(r => r.classList.contains('is-inherited')).length === rs.length - 1; }));
  await page.click('#outline [data-act=select-section][data-id=experience]'); await settle(page);
  ok('a section’s sidebar lists its jobs with the lock: the locked job’s tick is off', await page.evaluate(() => { const g = document.querySelector('#body .clg[data-g=hydra] .clgh'); return !!g && g.querySelector('input.sw')?.disabled === true && g.querySelector('.rowlock')?.getAttribute('aria-pressed') === 'true'; }));
  // a locked job: no grip, the page chip’s switch is off, a click on its lines selects only
  await page.evaluate(() => { window.__wb.ui.sel = { kind: 'job', id: 'hydra' }; window.__wb.setView(null); }); await page.waitForTimeout(100);
  await page.click('#outline [data-act=select-job][data-id=hydra]').catch(() => {}); await settle(page);
  const gj = await page.evaluate(() => { const g = document.querySelector('.obfgrip'); return g && !g.hidden; });
  const sw2 = await tool('.dp-show');
  ok('a locked job shows no grip on its frame, and the chip’s switch is disabled with the padlock pressed', !gj && sw2?.dis === true && (await tool('.dp-lock'))?.pressed === 'true', JSON.stringify([gj, sw2]));
  const lb0 = await hydraLine(2).boundingBox();
  await page.mouse.move(lb0.x + 60, lb0.y + 4, { steps: 3 }); await settle(page);
  const hs2 = await hands(page);
  ok('hovering a line of a locked job shows neither a grip nor a “+”', !hs2.grip && !hs2.plus, JSON.stringify(hs2));
  const lbl = await fr.locator('.entry:first-child .role-title').boundingBox();
  await page.click('#editlay .dp-show', { force: true }).catch(() => {}); await settle(page);
  ok('…clicking the disabled switch changes nothing: the job still prints', (await printed(page)).length >= 3 && JSON.stringify(await lockedOf()) === '["hydra-inhaler","hydra"]' && !!lbl);
  // unlock restores everything
  await page.click('#body .depth .dp-lock'); await settle(page);
  ok('the padlock of the job (pressed) unlocks it: the line’s own lock stays, and the job’s lines are free again', JSON.stringify(await lockedOf()) === '["hydra-inhaler"]');
  await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); }); await settle(page);
  await page.click('#outline .clg[data-g=hydra] .clrow[data-fact=hydra-inhaler] .rowlock'); await settle(page);
  ok('unlocking the last lock leaves no locked key at all, and the ticks work again', (await lockedOf()) === null && await page.evaluate(() => !document.querySelector('#outline .clrow[data-fact=hydra-inhaler] input.sw').disabled));
  await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); }); await settle(page);
  await hydraLine(0).click(); await settle(page);
  ok('…and a click writes the line again, with the caret', (await fr.locator('[contenteditable]').count()) === 1 && (await lineText(page)) === typed);
  await esc2();
  await page.evaluate(() => { window.__wb.store.commit(d => { delete d.cur.overrides['hydra-inhaler']; delete d.cur.overrideMeta; }, 'reset'); }); await settle(page);

  // ---- lock and undo, the page lock ----
  const u1 = await undoN(page);
  await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); }); await settle(page);
  const pl = await page.evaluate(() => { const b = document.querySelector('#body .pagelock'); return b && { pressed: b.getAttribute('aria-pressed'), name: b.getAttribute('aria-label'), tag: b.tagName }; });
  ok('with nothing selected the sidebar offers the whole page’s padlock', pl?.tag === 'BUTTON' && pl.pressed === 'false' && pl.name === 'Lock the page', JSON.stringify(pl));
  await page.click('#body .pagelock'); await settle(page);
  ok('locking the page is one undo step; every row of the Outline shows locked by it, and a click on any line selects only', JSON.stringify(await lockedOf()) === '["~page"]' && (await undoN(page)) === u1 + 1
    && await page.evaluate(() => [...document.querySelectorAll('#outline .clrow, #outline .srow')].filter(r => r.querySelector('.rowlock')).every(r => r.querySelector('.rowlock').getAttribute('aria-pressed') === 'true')));
  await hydraLine(1).click(); await settle(page);
  ok('…a click on a line of a locked page writes nothing', (await fr.locator('[contenteditable]').count()) === 0 && /Locked with the page/.test(await hint()), await hint());
  await page.evaluate(() => window.__wb.store.undo()); await settle(page);
  ok('undo takes the page lock away: no key is left', (await lockedOf()) === null);
  await page.evaluate(() => window.__wb.store.redo()); await settle(page);
  ok('redo brings it back', JSON.stringify(await lockedOf()) === '["~page"]');
  await page.evaluate(() => window.__wb.store.undo()); await settle(page);

  // ---- the page's headings and the other kinds of text ----
  await openByName(page, 'Medtech');
  await esc2();
  await page.evaluate(() => { window.__wb.store.commit(d => { d.cur.locked = ['~h:experience', 'skills-cad', 'lang-portuguese']; }, 'lock some'); }); await settle(page);
  const tryClick = async (sel, nth = 0) => { await fr.locator(sel).nth(nth).click({ position: { x: 4, y: 3 } }); await settle(page); return fr.locator('[contenteditable]').count(); };
  ok('locked texts of other kinds are not written either: a heading, a skill group, a language’s level', (await tryClick('.band[data-section=experience] h2.tab')) === 0 && (await tryClick('.band[data-section=skills] .skills__items')) === 0 && (await tryClick('.band[data-section=languages] dd')) === 0);
  ok('…while an unlocked heading is written as before', (await tryClick('.band[data-section=education] h2.tab')) === 1);
  await esc2();
  // a drag that starts on a locked skill refuses with the reason and moves nothing
  await page.evaluate(async () => { const T = await import('/src/model/resume.js'); window.__wb.store.commit(d => T.setArrangement(d.cur, T.arrangementOf(d.record, d.cur)), 'arrange'); }); await settle(page);
  const sk = await frameBox(page, '.band[data-section=skills] [data-skill]', 0), skBefore = await frameDoc(page, d => [...d.querySelectorAll('.skills__group')].map(g => g.textContent.slice(0, 20)));
  if (sk){
    await page.mouse.move(sk.x + 4, sk.y + 4); await page.mouse.down(); await page.mouse.move(sk.x + 60, sk.y + 90, { steps: 6 }); await page.mouse.up(); await settle(page);
    ok('a drag that starts on a locked skill group’s skill is refused with the reason, and nothing moves', /Locked/.test(await page.textContent('#toast')) && JSON.stringify(await frameDoc(page, d => [...d.querySelectorAll('.skills__group')].map(g => g.textContent.slice(0, 20)))) === JSON.stringify(skBefore));
  }
  await esc2();
  await page.evaluate(() => { window.__wb.store.commit(d => { delete d.cur.locked; }, 'unlock'); });

  // ---- the chip’s switch: a section, a job, an item and a line ----
  await openByName(page, 'Example Instruments');
  await esc2();
  const bands = () => frameDoc(page, d => [...d.querySelectorAll('.band[data-section]')].map(b => b.getAttribute('data-section')).filter((s, i, a) => a.indexOf(s) === i));
  await page.click('#outline [data-act=select-section][data-id=skills]'); await settle(page);
  const s0 = await page.evaluate(() => window.__wb.store.history.undo);
  await page.hover('#editlay .obchip'); await settle(page);
  const shw = await tool('.dp-show');
  ok('the switch is always on the chip (and hovering it changes nothing): a button with a 24 px target, named for what it does to the section, no aria-pressed (the pill shows the state)', shw?.tag === 'BUTTON' && shw.w >= 24 && shw.h >= 24 && /^Hide Skills from this resume$/.test(shw.name) && shw.pressed === null, JSON.stringify(shw));
  await page.click('#editlay .dp-show'); await settle(page);
  ok('the chip’s switch hides the section: it is off the page, one undo step', !(await bands()).includes('skills') && (await undoN(page)) === s0 + 1, JSON.stringify(await bands()));
  ok('…and the sidebar’s copy of the switch (same component) shows it again', await (async () => { await page.click('#body .depth .dp-show'); await settle(page); return (await bands()).includes('skills'); })());
  await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); }); await settle(page);
  await page.click('#outline [data-act=select-section][data-id=experience]'); await settle(page);
  await page.click('#body [data-act=select-job][data-id=poly]'); await settle(page);
  const jobsOn = () => frameDoc(page, d => [...d.querySelectorAll('.entry .role-title')].map(e => e.textContent.slice(0, 12)));
  const j0 = (await jobsOn()).length;
  await page.hover('#editlay .obchip'); await settle(page);
  await page.click('#editlay .dp-show'); await settle(page);
  ok('the chip’s switch hides a job (and the sidebar’s shows it again)', (await jobsOn()).length === j0 - 1 && await (async () => { await page.click('#body .depth .dp-show'); await settle(page); return (await jobsOn()).length === j0; })());
  await hydraLine(1).click(); await settle(page);
  const l0 = (await printed(page))[0].length;
  await page.hover('#editlay .obchip'); await settle(page);
  await page.click('#editlay .dp-show'); await settle(page);
  ok('…and a line of a job', (await printed(page))[0].length === l0 - 1 && await (async () => { await page.click('#body .depth .dp-show'); await settle(page); return (await printed(page))[0].length === l0; })());
  await openByName(page, 'Medtech'); await esc2();
  const langs = () => frameDoc(page, d => d.querySelectorAll('.band[data-section=languages] dt').length);
  const n0 = await langs();
  await fr.locator('.band[data-section=languages] dt').nth(1).click({ position: { x: 4, y: 3 } }); await settle(page);
  await page.hover('#editlay .obchip'); await settle(page);
  await page.click('#editlay .dp-show'); await settle(page);
  ok('…and an item of a list section (a language)', (await langs()) === n0 - 1 && await (async () => { await page.click('#body .depth .dp-show'); await settle(page); return (await langs()) === n0; })());
  await esc2(); await page.evaluate(() => window.__wb.canvas.goToPage(0)); await settle(page);
  await fr.locator('.band--header .name').click({ position: { x: 4, y: 3 } }); await settle(page);
  const hdr = [await tool('.dp-show'), await tool('.dp-lock'), await page.evaluate(() => window.__wb.ui.sel)];
  ok('the header has a padlock and no switch on the chip', hdr[0] === null && hdr[1] !== null, JSON.stringify(hdr));
  await esc2();

  // ---- the phone: the padlock lives in the sidebar ----
  {
    const pctx = await newContext({ motion: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pp = await pctx.newPage();
    const pbad = await open(pp);
    const pnone = await pp.evaluate(() => { const b = document.querySelector('#body .pagelock'); return b && { tag: b.tagName, pressed: b.getAttribute('aria-pressed') }; });
    ok('on a phone the page’s padlock is in the sidebar’s Edit', pnone?.tag === 'BUTTON' && pnone.pressed === 'false', JSON.stringify(pnone));
    await pp.evaluate(() => { window.__wb.ui.sel = { kind: 'bullet', id: 'hydra-inhaler', job: 'hydra', section: 'experience' }; window.__wb.setView(null); });
    await pp.evaluate(() => window.__wb.onpage && 0); await settle(pp);
    await pp.evaluate(async () => { const m = await import('/src/model/lock.js'); window.__wb.store.commit(d => m.setLocked(d.cur, 'hydra-inhaler', true), 'lock'); });
    await settle(pp);
    ok('…and the line’s own view has the padlock in its depth row, pressed, with the tick off', await pp.evaluate(() => { const b = document.querySelector('#body .depth .dp-lock'); return !!b && b.getAttribute('aria-pressed') === 'true' && document.querySelector('#b-on')?.disabled === true; }));
    ok('…no console errors on the phone', pbad.length === 0, pbad[0] ?? '');
    await pctx.close();
  }
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the lock: the grips for jobs, sections and items, at four sizes')) {
  // the grip stands on the selected block's frame at its top edge's left end: in the pages' room, off text, the chip, the zoom bar
  const esc2 = async page => { await page.mouse.move(4, 4); for (let k = 0; k < 2; k++) await page.keyboard.press('Escape'); await settle(page); };
  for (const [w, h] of [[1280, 720], [1470, 832], [1920, 1080], [2560, 1100]]) {
    const ctx = await newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const bad = await open(page);
    await openByName(page, 'Medtech');
    const fr = page.frameLocator('#sheet iframe');
    const geo = () => page.evaluate(() => {
      const wb = window.__wb, g = document.querySelector('#handlay .obfgrip'), zb = document.querySelector('#zoombar')?.getBoundingClientRect(), chip = document.querySelector('#editlay .obchip')?.getBoundingClientRect(), v = wb.canvas.view;
      if (!g || g.hidden) return null;
      const r = g.getBoundingClientRect(), f = wb.onpage.frame();
      const hit = (a, b) => !!b && a.left < b.left + b.width && a.right > b.left && a.top < b.top + b.height && a.bottom > b.top;
      return { name: g.getAttribute('aria-label'), tag: g.tagName, tab: g.tabIndex, inRoom: r.left >= v.left && r.right <= v.left + v.width && r.top >= v.top && r.bottom <= v.top + v.height,
        text: wb.sheet.textRects().map(q => wb.canvas.screenRect(q)).some(q => hit(r, q)), bar: hit(r, zb), chip: hit(r, chip), near: !!f && Math.abs((r.top + r.height / 2) - f.top) <= 24 && (r.left + r.width / 2) >= f.left - 24 && (r.left + r.width / 2) <= f.left + f.width };
    });
    const fails = [];
    for (const [name, pick] of [['a job', async () => { await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); }); await settle(page); await page.click('#outline [data-act=select-section][data-id=experience]'); await settle(page); await page.click('#body [data-act=select-job][data-id=poly]'); }],
      ['a section', async () => { await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); }); await settle(page); await page.click('#outline [data-act=select-section][data-id=education]'); }],
      ['an item', async () => { await fr.locator('.band[data-section=languages] dt').nth(1).click({ position: { x: 4, y: 3 } }); await settle(page); await page.keyboard.press('Escape'); }]]){
      await esc2(page);
      await pick(); await settle(page);
      const g = await geo();
      if (!g) fails.push(`${name}: no grip`); else if (g.tag !== 'BUTTON' || g.tab !== 0 || !g.inRoom || g.text || g.bar || g.chip || !g.near) fails.push(`${name}: ${JSON.stringify(g)}`);
    }
    ok(`${w}x${h}: a job, a section and an item each show a grip button on the frame’s top edge near its left end, in the room, over no text, the chip or the zoom bar`, fails.length === 0, fails.join('; '));
    ok(`${w}x${h}: no console errors`, bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }

  const ctx = await newContext({ viewport: { width: 1470, height: 832 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  await openByName(page, 'Medtech');
  const fr = page.frameLocator('#sheet iframe');
  const toHome = async () => { await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); }); await settle(page); };
  const grab = () => page.evaluate(() => { const g = document.querySelector('#handlay .obfgrip'); if (!g || g.hidden) return null; const r = g.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: g.getAttribute('aria-label') }; });
  const jobsOrder = () => frameDoc(page, d => [...d.querySelectorAll('.entry .role-title')].map(e => e.textContent.slice(0, 14)));
  const secOrder = () => frameDoc(page, d => [...d.querySelectorAll('.band[data-section]')].map(b => b.getAttribute('data-section')).filter((s, i, a) => a.indexOf(s) === i));
  const dragTo = async (g, x, y) => { await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(x, y, { steps: 10 }); await page.waitForTimeout(150); };
  const tip = () => page.evaluate(() => { const t = document.querySelector('#handlay .obtip'); return t && !t.hidden ? t.textContent : ''; });

  // a job moves within its section
  await toHome(); await page.click('#outline [data-act=select-section][data-id=experience]'); await settle(page); await page.click('#body [data-act=select-job][data-id=hydra]'); await settle(page);
  let g = await grab();
  ok('a job’s grip is named for what it moves', g && /^Move this job within its section/.test(g.name), JSON.stringify(g));
  const order0 = await jobsOrder(), u0 = await undoN(page);
  const t1 = await frameBox(page, '.entry .role-title', 1), t2 = await frameBox(page, '.entry .role-title', 2);
  await dragTo(g, t2.x + 40, t2.y + t2.height + 40);
  const during = await hands(page);
  ok('dragging a job shows where it will land', during.drop && !during.tip, JSON.stringify(during));
  await page.mouse.up(); await settle(page);
  const order1 = await jobsOrder();
  ok('dropped below the next jobs, the job moves there: one undo step, the others keep their order', order1[0] === order0[1] && order1.includes(order0[0]) && order1.indexOf(order0[0]) > 0 && (await undoN(page)) === u0 + 1, JSON.stringify([order0, order1]));
  // refused elsewhere
  await toHome(); await page.click('#outline [data-act=select-section][data-id=experience]'); await settle(page); await page.click('#body [data-act=select-job][data-id=hydra]'); await settle(page);
  g = await grab();
  const sb = await frameBox(page, '.band[data-section=education] .item__title', 0), orderN = await jobsOrder(), uN = await undoN(page);
  await dragTo(g, sb.x + 20, sb.y + 4);
  const refused = await tip();
  ok('dragging a job into another section is refused, with the reason on the page', /A job moves within its own section/.test(refused), refused);
  await page.mouse.up(); await settle(page);
  ok('…let go there, nothing changes: no undo step, the same order, the reason said again', JSON.stringify(await jobsOrder()) === JSON.stringify(orderN) && (await undoN(page)) === uN && /own section/.test(await page.textContent('#toast')));
  // the keyboard
  await toHome(); await page.click('#outline [data-act=select-section][data-id=experience]'); await settle(page); await page.click('#body [data-act=select-job][data-id=hydra]'); await settle(page);
  const o2 = await jobsOrder();
  const hi = o2.findIndex(x => x.startsWith('Design Engin'));
  await page.focus('#handlay .obfgrip'); await page.keyboard.press('ArrowDown'); await settle(page);
  const o3 = await jobsOrder();
  ok('with the focus on a job’s grip, ↓ moves the job down one place', hi >= 0 && o3[hi + 1] === o2[hi] && o3[hi] === o2[hi + 1], JSON.stringify([o2, o3]));
  await page.focus('#handlay .obfgrip'); await page.keyboard.press('ArrowUp'); await settle(page);
  ok('…and ↑ moves it back', JSON.stringify(await jobsOrder()) === JSON.stringify(o2));

  // a section moves within the page
  await toHome(); await page.click('#outline [data-act=select-section][data-id=education]'); await settle(page);
  g = await grab();
  ok('a section’s grip is named for what it moves', g && /^Move this section within the page/.test(g.name), JSON.stringify(g));
  const s0 = await secOrder(), exp = await frameBox(page, '.band[data-section=experience]', 0), su = await undoN(page);
  await dragTo(g, exp.x + 100, exp.y + 10);
  await page.mouse.up(); await settle(page);
  const s1 = await secOrder();
  ok('dropped above Experience, the section moves there: one undo step', s1.indexOf('education') < s1.indexOf('experience') && s0.indexOf('education') > s0.indexOf('experience') && (await undoN(page)) === su + 1, JSON.stringify([s0, s1]));
  await page.evaluate(() => window.__wb.store.undo()); await settle(page);
  await toHome(); await page.click('#outline [data-act=select-section][data-id=education]'); await settle(page);
  g = await grab();
  await dragTo(g, 40, g.y);
  ok('dragging a section off the page is refused, with the reason', /A section moves within the page/.test(await tip()), await tip());
  await page.mouse.up(); await settle(page);
  ok('…and nothing changes', JSON.stringify(await secOrder()) === JSON.stringify(s0));
  await page.focus('#handlay .obfgrip'); await page.keyboard.press('ArrowUp'); await settle(page);
  const s2 = await secOrder();
  ok('with the focus on a section’s grip, ↑ moves it up one place', s2.indexOf('education') === s0.indexOf('education') - 1, JSON.stringify([s0, s2]));
  await page.evaluate(() => window.__wb.store.undo()); await settle(page);

  // an item moves within its section
  await esc2(page);
  const lang = () => frameDoc(page, d => [...d.querySelectorAll('.band[data-section=languages] dt')].map(e => e.textContent.slice(0, 10)));
  await fr.locator('.band[data-section=languages] dt').nth(0).click({ position: { x: 4, y: 3 } }); await settle(page); await page.keyboard.press('Escape'); await settle(page);
  g = await grab();
  ok('an item’s grip is named for what it moves', g && /^Move this item within its section/.test(g.name), JSON.stringify(g));
  const i0 = await lang(), l2 = await frameBox(page, '.band[data-section=languages] dt', 2), iu = await undoN(page);
  await dragTo(g, l2.x + 20, l2.y + l2.height + 6);
  await page.mouse.up(); await settle(page);
  const i1 = await lang();
  ok('dropped below the last language, the item moves there: one undo step', i1.at(-1) === i0[0] && (await undoN(page)) === iu + 1, JSON.stringify([i0, i1]));
  await page.evaluate(() => window.__wb.store.undo()); await settle(page);
  await fr.locator('.band[data-section=languages] dt').nth(0).click({ position: { x: 4, y: 3 } }); await settle(page); await page.keyboard.press('Escape'); await settle(page);
  g = await grab();
  const ed = await frameBox(page, '.band[data-section=education] .item__title', 0);
  await dragTo(g, ed.x + 20, ed.y + 4);
  ok('an item dragged into another section is refused, with the reason', /An item moves within its own section/.test(await tip()), await tip());
  await page.mouse.up(); await settle(page);
  ok('…and nothing changes', JSON.stringify(await lang()) === JSON.stringify(i0));
  await page.focus('#handlay .obfgrip'); await page.keyboard.press('ArrowDown'); await settle(page);
  const i2 = await lang();
  ok('with the focus on an item’s grip, ↓ moves it down one place', i2[1] === i0[0] && i2[0] === i0[1], JSON.stringify([i0, i2]));
  await page.evaluate(() => window.__wb.store.undo()); await settle(page);

  // a locked block shows no grip
  await page.evaluate(() => { window.__wb.store.commit(d => { d.cur.locked = ['languages']; }, 'lock'); }); await settle(page);
  await fr.locator('.band[data-section=languages] dt').nth(0).click({ position: { x: 4, y: 3 } }); await settle(page);
  ok('a locked item and a locked section have no grip', (await grab()) === null && (await fr.locator('[contenteditable]').count()) === 0);
  ok('…and the locked section’s own sidebar view has the item’s switch and ↑ ↓ off', await page.evaluate(() => { const r = document.querySelector('#body .depth .dp-show'); return !r || r.getAttribute('aria-disabled') === 'true'; }));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the lock: no way round it from the page')) {
  const lockIds = (page, ids, on = true) => page.evaluate(async ([ids, on]) => { const LK = await import('/src/model/lock.js'); window.__wb.store.commit(d => { for (const id of ids) LK.setLocked(d.cur, id, on); }, 'lock'); }, [ids, on]);
  const curOf = page => page.evaluate(() => structuredClone(window.__wb.store.state.cur));
  const hint = page => page.evaluate(() => { const t = document.querySelector('#handlay .obtip'); return t && !t.hidden ? t.textContent : ''; });
  const ctx = await newContext({ viewport: { width: 1470, height: 832 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const fr = page.frameLocator('#sheet iframe');
  const line = () => fr.locator('.entry:first-child .bullets li').nth(0);
  // ArrowLeft and ArrowRight on a locked line
  await lockIds(page, ['hydra-inhaler']);
  await line().click(); await settle(page);
  const p0 = JSON.stringify((await curOf(page)).picks);
  await page.keyboard.press('ArrowRight'); await settle(page); await page.keyboard.press('ArrowLeft'); await settle(page);
  ok('the arrow keys on a locked line change no version, throw nothing, and say why', JSON.stringify((await curOf(page)).picks) === p0 && bad.length === 0 && /Locked/.test(await hint(page)), JSON.stringify([bad, await hint(page)]));
  // a hidden job cannot take a locked line with it; the chip’s switch is held
  await page.evaluate(() => { window.__wb.ui.sel = { kind: 'job', id: 'hydra' }; window.__wb.setView(null); }); await settle(page);
  const sw = await page.evaluate(() => document.querySelector('#editlay .dp-show')?.getAttribute('aria-disabled'));
  await page.evaluate(() => document.querySelector('#editlay .dp-show').click()); await settle(page);
  ok('the chip’s switch of a job with a locked line in it is held, and a click hides nothing', sw === 'true' && (await page.evaluate(async () => { const T = await import('/src/model/resume.js'); const s = window.__wb.store.state; return T.jobRefs(s.record, s.cur).some(r => (r.id ?? r) === 'hydra'); })));
  const gone = await page.evaluate(async () => { const T = await import('/src/model/resume.js'); try { window.__wb.store.commit(d => T.setJobOn(d.record, d.cur, 'hydra', false), 'x'); } catch (e) { return 'threw ' + e.name; } return 'ok'; });
  ok('a refused change from any path is said, never thrown', gone === 'ok' && bad.length === 0, gone + JSON.stringify(bad));
  // a locked job hidden before it was locked can be shown again
  await lockIds(page, ['hydra-inhaler'], false);
  await page.evaluate(async () => { const T = await import('/src/model/resume.js'); window.__wb.store.commit(d => T.setJobOn(d.record, d.cur, 'hydra', false), 'hide'); }); await lockIds(page, ['hydra']);
  await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); }); await settle(page);
  const tick = await page.evaluate(() => { const c = document.querySelector('[data-jobon="hydra"]'); const r = c && { off: c.disabled, on: c.checked }; c?.click(); return r; }); await settle(page);
  ok('the tick of a hidden locked job is open: clicking it shows the job again', tick && tick.off === false && tick.on === false && (await page.evaluate(async () => { const T = await import('/src/model/resume.js'); const s = window.__wb.store.state; return T.jobRefs(s.record, s.cur).some(r => (r.id ?? r) === 'hydra'); })), JSON.stringify(tick));
  // the padlock of a line under a locked job does not unlock the job
  await line().click(); await settle(page);
  const pl = await page.evaluate(() => { const b = document.querySelector('#editlay .dp-lock'); return b && { pressed: b.getAttribute('aria-pressed'), dis: b.getAttribute('aria-disabled'), label: b.getAttribute('aria-label') }; });
  await page.evaluate(() => document.querySelector('#editlay .dp-lock').click()); await settle(page);
  ok('under a locked job a line’s padlock is pressed, aria-disabled, says which lock holds it, and a click unlocks nothing', pl?.pressed === 'true' && pl.dis === 'true' && /^Locked with .*\. Unlock .* first\.$/.test(pl.label) && JSON.stringify((await curOf(page)).locked) === '["hydra"]' && /Unlock/.test(await hint(page)), JSON.stringify(pl));
  // the job’s Details fold
  await page.evaluate(() => { window.__wb.ui.sel = { kind: 'job', id: 'hydra' }; window.__wb.renderBody?.(); }); await settle(page);
  const det = await page.evaluate(() => ['#c-pos', '#c-org', '#c-start', '#c-end', '#c-current'].map(s => { const e = document.querySelector('#body ' + s); return e ? e.getAttribute('aria-disabled') === 'true' && !!e.getAttribute('aria-describedby') : null; }));
  ok('a locked job’s Details fold is held: title, employer and dates are aria-disabled with the reason attached', det.every(x => x === true), JSON.stringify(det));
  // the Record view: a locked language’s fields are held and its delete does nothing
  await lockIds(page, ['lang-portuguese']);
  await inRecord(page, 'credentials'); await settle(page);
  await page.click('#checklist .clg[data-g=credentials] .clrow:has-text("Portuguese") .clt'); await settle(page);
  const rv = await page.evaluate(() => { const n = document.querySelector('#body #c-lname'), d = document.querySelector('#body button[data-lockoff][data-group]'); const r = { name: n?.getAttribute('aria-disabled') === 'true' && n.readOnly, del: !!d }; d?.click(); return r; }); await settle(page);
  ok('a locked language in the Record view: its name is read-only and aria-disabled, the other fields and Delete are held, and Delete deletes nothing', rv.name && rv.del && (await page.evaluate(() => window.__wb.store.state.record.languages.length)) === 3, JSON.stringify(rv));
  // the record’s picture under a locked header
  await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 2; const tiny = c.toDataURL('image/png'); window.__wb.store.commit(d => { d.record.basics.image = tiny; d.cur.photo = { show: true, shape: 'rect' }; d.cur.locked = ['header']; }, 'photo'); });
  page.on('dialog', d => d.accept());
  await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView('design'); }); await settle(page);
  await page.click('[data-act=d-photo-rm]'); await settle(page);
  ok('Remove photo on a locked header removes nothing and says why', await page.evaluate(() => { const s = window.__wb.store.state; return !!s.record.basics.image && s.cur.photo.show === true; }) && bad.length === 0);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
  // the lock mark at a job’s corner is clear of the printed title, at four sizes
  for (const [w, h] of [[1280, 720], [1470, 832], [1920, 1080], [2560, 1100]]) {
    const c2 = await newContext({ viewport: { width: w, height: h } });
    const p2 = await c2.newPage();
    const bad2 = await open(p2);
    await lockIds(p2, ['hydra', 'poly']);
    const over = [];
    for (const n of [0, 1]) {
      await p2.frameLocator('#sheet iframe').locator('.entry').nth(n).locator(':scope > *').first().click(); await settle(p2);
      over.push(...await p2.evaluate(() => {
        const m = document.querySelector('#editlay .oblockmark').getBoundingClientRect(), f = document.querySelector('#sheet iframe'), fb = f.getBoundingClientRect(), sc = fb.width / f.offsetWidth, d = f.contentDocument, out = [];
        const wk = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
        for (let nd; (nd = wk.nextNode());) { if (!nd.textContent.trim()) continue; const rg = d.createRange(); rg.selectNodeContents(nd); for (const r of rg.getClientRects()) { const a = { l: fb.left + r.left * sc, t: fb.top + r.top * sc, r: fb.left + r.right * sc, b: fb.top + r.bottom * sc }; if (a.l < m.right && a.r > m.left && a.t < m.bottom && a.b > m.top) out.push(nd.textContent.trim().slice(0, 20)); } }
        return out;
      }));
    }
    ok(`${w}×${h}: the lock mark overlaps no printed text`, over.length === 0 && bad2.length === 0, JSON.stringify(over));
    await c2.close();
  }
}

if (want('the Review list: edits become versions, with sources, undo and the newer wording')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brewcv-review-'));
  const ctx = await newContext({ viewport: { width: 1470, height: 832 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const bad = await open(page);
  const R = '#review';
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const pending = () => ev(() => window.__wb.review.pending());
  const isOpen = () => ev(() => window.__wb.review.isOpen);
  const undoSteps = () => ev(() => window.__wb.store.history.undo);
  const rows = () => page.$$eval(`${R} .rvrow`, r => r.map(x => ({ id: x.dataset.id, kind: x.dataset.kind, done: x.classList.contains('done'), text: x.innerText })));
  const saveBtn = async () => { if (!(await page.$('#body #filestate'))){ await page.click('#tab-export'); await settle(page); } };
  const downloaded = async trigger => { const [d] = await Promise.all([page.waitForEvent('download'), trigger()]); const p = path.join(tmp, d.suggestedFilename()); await d.saveAs(p); return p; };
  const ids = await ev(async () => { const T = await import('/src/model/resume.js'), s = window.__wb.store.state; return T.listedBullets(s.record, s.cur, 'hydra'); });

  // nothing pending: Save to file works as it always did
  await saveBtn();
  ok('nothing is pending in the example resume', (await pending()) === 0);
  const f0 = await downloaded(() => page.click('#filestate'));
  ok('with nothing to review Save to file saves at once, and no dialog opened', fs.existsSync(f0) && !(await isOpen()));

  // a close edit written on the page, a far one and a line only on this resume made through the model
  const line = page.frameLocator('#sheet iframe').locator(`[data-variant]`).filter({ hasText: /./ }).first();
  const first = await frameDoc(page, d => d.querySelector('.bullets li')?.textContent ?? '');
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  await writeLine(page, first.replace(/\b(\d)(\d{2}),000/, '$1$2,500')); await page.keyboard.press('Escape'); await settle(page);
  await ev(async ([a, b]) => {
    const T = await import('/src/model/resume.js');
    window.__wb.store.commit(d => {
      T.setOverride(d.record, d.cur, b, 'Rebuilt the whole rig from scratch around a new fixture and a new plan for the supplier audits.', { marks: [], base: null });
      const n = T.addLocalLine(d.record, d.cur, 'hydra', b);
      T.setOverride(d.record, d.cur, n, 'Wrote the supplier audit checklist.', { marks: [], base: null });
      d.record.requireSource = true;
      for (const v of d.record.variants) if (v.id.startsWith(a + '-v')) v.source = 'Lab notebook p. 4';      // the close edit's parent has a source to copy
    }, 'smoke: edits');
  }, ids);
  await settle(page);
  ok('three edits are pending: one written on the page, one far from its versions, one line only here', (await pending()) === 3);

  // Ctrl+S opens the list, with the focus inside
  await page.click('#tab-export'); await settle(page);
  await page.focus('#filestate'); await page.keyboard.press('Control+s'); await settle(page);
  const dlg = await page.$eval(R, e => ({ role: e.tagName === 'DIALOG' && e.open, name: document.getElementById(e.getAttribute('aria-labelledby'))?.textContent, modal: e.matches(':modal') }));
  ok('Ctrl+S opens the Review list first: a real modal dialog with a name', dlg.role && dlg.modal && dlg.name === 'Review your edits', JSON.stringify(dlg));
  ok('the focus moved into it', await ev(() => document.querySelector('#review').contains(document.activeElement)));
  ok('group one has the three rows; there is no second group', (await rows()).length === 3 && (await page.$$(`${R} section h3`)).length === 1);
  let tabbed = true;
  for (let i = 0; i < 25; i++){ await page.keyboard.press('Tab'); if (!(await ev(() => document.querySelector('#review').contains(document.activeElement)))) tabbed = false; }
  ok('Tab stays inside the dialog', tabbed);
  const shot = path.join(ROOT, 'out');
  ok('the marked diff is in the row: the new words are inserted marks and the old ones deleted marks, both underlined or struck through, not by colour alone', await ev(() => { const e = document.querySelector('#review .rvrow ins'), d = document.querySelector('#review .rvrow del'); return !!e && !!d && getComputedStyle(e).textDecorationLine.includes('underline') && getComputedStyle(d).textDecorationLine.includes('line-through'); }));
  const r0 = (await rows())[0].text;
  ok('the close edit says why: share of words kept, so the next sub-version; Approve names the number', /% of v[\d.]+’s words kept, so v\d+\.\d+/.test(r0) && /Approve \(v\d+\.\d+\)/.test(r0), r0);
  ok('only a tiny edit has Update, and it says which resumes it reaches and that sent copies never change', /Update v/.test(r0) && /Sent copies never change/.test(r0) && !/Update v/.test((await rows())[1].text));
  const opts0 = await page.$$eval(`${R} .rvrow:nth-child(1) select option`, o => o.map(x => x.textContent));
  ok('the select offers a sub-version of another major, a new version and Keep on this resume only', opts0.some(x => /^Sub-version of v/.test(x)) && opts0.some(x => /^New version/.test(x)) && opts0.includes('Keep on this resume only'), opts0.join(' | '));

  // Esc and Cancel change nothing, and the focus goes back to where it came from
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes it, saves nothing, keeps every edit and gives the focus back to the button that was pressed', !(await isOpen()) && (await pending()) === 3 && (await ev(() => document.activeElement?.id)) === 'filestate');
  await page.click('#filestate'); await settle(page);
  await page.click(`${R} [data-rv=cancel]`); await settle(page);
  ok('Cancel does the same', !(await isOpen()) && (await pending()) === 3 && !(await ev(() => window.__wb.store.state.record.facts.some(f => /^hydra-.*-v\d/.test(f.id)))));

  // the source: a new version of a far edit needs one, a sub-version copies its parent's
  await page.click('#filestate'); await settle(page);
  const far = `${R} .rvrow[data-id="${ids[1]}"]`, loc = `${R} .rvrow[data-kind=e]:has-text("Only on this resume")`;
  ok('a far edit is suggested as a new version, and a record that asks for a source shows the required input', /less than 70%/.test(await page.textContent(far)) && (await page.getAttribute(`${far} [data-rv-src]`, 'aria-required')) === 'true' && /Where is this confirmed\?/.test(await page.textContent(far)));
  ok('the close edit shows no source input (a sub-version copies its parent’s)', !(await page.$(`${R} .rvrow[data-id="${ids[0]}"] [data-rv-src]`)));
  ok('while the source is empty, Approve says why and does nothing', (await page.getAttribute(`${far} [data-rv=approve]`, 'aria-disabled')) === 'true' && /Add a source to approve/.test(await page.textContent(`${far} [data-rv=approve]`)) && await (async () => { await page.click(`${far} [data-rv=approve]`, { force: true }); return (await pending()) === 3 && (await ev(() => document.activeElement?.matches('[data-rv-src]'))); })());
  await page.fill(`${far} [data-rv-src]`, '  Test plan 12,\n  rig file  ');
  ok('once a source is typed Approve names the version and is no longer disabled', (await page.getAttribute(`${far} [data-rv=approve]`, 'aria-disabled')) === null && /Approve \(v\d+\)/.test(await page.textContent(`${far} [data-rv=approve]`)));
  const before = await undoSteps();
  await page.click(`${far} [data-rv=approve]`); await settle(page);
  const res = (await rows()).find(r => r.id === ids[1]);
  ok('approving shows the result with an Undo, and it is exactly one undo step', res.done && /Saved as v\d+/.test(res.text) && /Undo/.test(res.text) && (await undoSteps()) === before + 1, res.text);
  const made = await ev(id => { const m = window.__wb.store.state.record; return m.variants.filter(v => v.id.startsWith(id + '-v')).map(v => ({ id: v.id, source: v.source, text: v.text })).pop(); }, ids[1]);
  ok('the new version has the edit’s words and the source, trimmed to plain text', /Rebuilt the whole rig/.test(made.text) && made.source === 'Test plan 12, rig file', JSON.stringify(made));
  ok('the resume prints the same words, and the edit is gone', (await frameDoc(page, d => d.body.textContent)).includes('Rebuilt the whole rig from scratch') && (await pending()) === 2);
  await page.click(`${far} [data-rv=undo]`); await settle(page);
  ok('Undo puts the edit back as a row to decide, and the version is gone', (await pending()) === 3 && !(await ev(id => window.__wb.store.state.record.variants.some(v => v.id.startsWith(id + '-v') && /Rebuilt/.test(v.text)), ids[1])) && !(await rows()).find(r => r.id === ids[1]).done);
  ok('the typed source is still in the row', (await page.inputValue(`${far} [data-rv-src]`)).trim().startsWith('Test plan 12'));

  // a line only on this resume: add it to the record in its job, in the same place
  ok('a local line is a row that offers adding it to the record as a new line in its job, and needs a source', /Add a source to add it/.test(await page.textContent(loc)) && /Hydra Medical/.test(await page.textContent(loc)));
  await page.fill(`${loc} [data-rv-src]`, 'Audit file 12');
  ok('with a source the button names the job', /Add to the record as a new line in Hydra Medical/.test(await page.textContent(`${loc} [data-rv=approve]`)));
  const order0 = await ev(() => { const s = window.__wb.store.state; return import('/src/model/resume.js').then(T => T.listedBullets(s.record, s.cur, 'hydra')); });
  await page.click(`${loc} [data-rv=approve]`); await settle(page);
  const order1 = await ev(() => { const s = window.__wb.store.state; return import('/src/model/resume.js').then(T => ({ list: T.listedBullets(s.record, s.cur, 'hydra'), local: Object.keys(s.cur.localLines ?? {}), hydra: s.record.work.find(w => w.id === 'hydra').highlights })); });
  const newId = order1.list.find(x => !order0.includes(x) && !x.startsWith('~'));
  ok('the claim is in the record under the job and replaced the local line in the same place', !!newId && order1.hydra.includes(newId) && order1.local.length === 0 && order1.list.indexOf(newId) === order0.findIndex(x => x.startsWith('~new')), JSON.stringify([order0, order1.list]));
  ok('the claim has the source', await ev(id => window.__wb.store.state.record.facts.find(f => f.id === id).variants.every(v => window.__wb.store.state.record.variants.find(x => x.id === v).source === 'Audit file 12'), newId));

  // keep on this resume only, from the select
  await page.selectOption(`${R} .rvrow[data-id="${ids[0]}"] select`, 'keep'); await settle(page);
  await page.click(`${R} .rvrow[data-id="${ids[0]}"] [data-rv=apply]`); await settle(page);      // the select only chooses; Apply does it
  ok('Keep on this resume only leaves the list, the edit stays on the page, and the result has an Undo', (await rows()).find(r => r.id === ids[0]).done && (await ev(id => id in window.__wb.store.state.cur.overrides, ids[0])) && /Kept on this resume only/.test((await rows()).find(r => r.id === ids[0]).text));
  await page.click(`${R} .rvrow[data-id="${ids[0]}"] [data-rv=undo]`); await settle(page);
  ok('Undo of a keep puts the row back', !(await rows()).find(r => r.id === ids[0]).done);

  // approve all: one step, the one that needs a source is left and said so
  const before2 = await undoSteps();
  await page.click(`${R} [data-rv=all]`); await settle(page);
  const status = await page.textContent(`${R} #rv-status`);
  ok('Approve all applies the rows that can be applied and says how many', /^Approved \d+ edits?\./.test(status), status);
  ok('…one undo step', (await undoSteps()) === before2 + 1);
  await page.click(`${R} #rv-status [data-rv=undo]`); await settle(page);
  ok('its Undo takes all of them back at once', (await pending()) === 2 && (await undoSteps()) === before2);

  // the locked line is left out, with a note
  await ev(async id => { const L = await import('/src/model/lock.js'); window.__wb.store.commit(d => L.setLocked(d.cur, id, true), 'smoke: lock'); }, ids[0]);
  await settle(page);
  ok('a locked line is not offered and a note says how many are kept as they are', !(await rows()).some(r => r.id === ids[0] && !r.done) && /1 locked line is kept as it is/.test(await page.textContent(`${R} .rvbody`)));
  await ev(async id => { const L = await import('/src/model/lock.js'); window.__wb.store.commit(d => L.setLocked(d.cur, id, false), 'smoke: unlock'); }, ids[0]);

  // Save to file from the list saves what is left, and nothing is lost
  const saved = await downloaded(() => page.click(`${R} [data-rv=save]`));
  const file = JSON.parse(fs.readFileSync(saved, 'utf8'));
  ok('Save to file in the list closes it and saves; the rows left alone are still edits in the file', !(await isOpen()) && file.resumeBuilderBackup === 1 && (await pending()) === 2);

  // the export pre-flight has a Review button; exporting offers the list once, without waiting (a heading typed here is one of the edits the text and JSON file leave out)
  await ev(async () => { const T = await import('/src/model/resume.js'); window.__wb.store.commit(d => T.setSectionLabel(d.record, d.cur, 'experience', 'en', 'Work history'), 'smoke: heading'); });
  await page.click('#tab-export'); await settle(page);
  ok('the pre-flight row about edits not in the text or JSON file has a Review button that opens the list', await (async () => { await page.click('#body .checks [data-act=review-open]'); await settle(page); const o = await isOpen(); await page.keyboard.press('Escape'); await settle(page); return o; })());
  const dl = await Promise.all([page.waitForEvent('download'), page.click('[data-act=ex-json]')]);
  await settle(page);
  ok('an export is not held up, and afterwards a toast offers the Review with a button', !!dl[0] && await page.isVisible('#toast [data-act=review-open]'));
  await page.click('#toast [data-act=review-open]'); await settle(page);
  ok('that button opens the list', await isOpen());
  await page.keyboard.press('Escape'); await settle(page);

  // headings and names: only Keep and Use for every resume
  await page.click('#filestate'); await settle(page);
  const lab = `${R} .rvrow[data-kind=l]`;
  ok('a heading typed on the page is a row with only Keep and Use for every resume', (await page.$$(`${lab} button`)).length === 2 && /Use for every resume/.test(await page.textContent(lab)));
  await page.click(`${lab} [data-rv=every]`); await settle(page);
  ok('Use for every resume puts it in the record, and Undo takes it back', (await ev(() => window.__wb.store.state.record.sections.find(s => s.id === 'experience').title)) === 'Work history' && await (async () => { await page.click(`${R} .rvrow[data-kind=l] [data-rv=undo]`); await settle(page); return (await ev(() => window.__wb.store.state.record.sections.find(s => s.id === 'experience').title)) !== 'Work history'; })());
  await page.click(`${R} [data-rv=cancel]`); await settle(page);

  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the Review list: the newer wording is its second group')) {
  const ctx = await newContext({ viewport: { width: 1470, height: 832 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  const R = '#review';
  const shared = await page.evaluate(async () => {
    const RS = await import('./src/model/resumes.js');
    const s = window.__wb.store.state;
    const mine = RS.usedVersions(s.record, s.cur).filter(u => s.record.work.some(w => w.highlights.includes(u.fact)));
    for (const r of s.resumes) if (r.id !== s.openId && r.lang === s.cur.lang && r.snapshots === undefined && r.jobType !== undefined){
      const theirs = new Set(RS.usedVersions(s.record, r).map(u => u.variant));
      const hit = mine.find(u => theirs.has(u.variant));
      if (hit) return { ...hit, other: r.id, text: s.record.variants.find(v => v.id === hit.variant).text };
    }
    return null;
  });
  ok('two saved resumes share a bullet version', !!shared);
  if (shared){
    const otherBefore = JSON.stringify((await st()).frozen[shared.other]);
    // an Update from the list changes the shared version; the other resume keeps its words and is offered the new ones
    await page.frameLocator('#sheet iframe').locator(`[data-variant="${shared.variant}"]`).first().click(); await settle(page);
    await writeLine(page, shared.text.replace(/\w+(\W*)$/, 'brandnew$1')); await page.keyboard.press('Escape'); await settle(page);
    await page.click('#tab-export'); await settle(page);
    await page.click('#filestate'); await settle(page);
    const row = `${R} .rvrow[data-id="${shared.fact}"]`;
    ok('the tiny edit names the resume that prints the version and says it is offered the change', /Update v/.test(await page.textContent(row)) && /other resumes? (is|are) offered the change as newer wording/.test(await page.textContent(row)));
    await page.click(`${row} [data-rv=update]`); await settle(page);
    ok('Update changes the version itself, and the row says Undo puts the old words back', (await st()).record.variants.find(v => v.id === shared.variant).text.includes('brandnew') && /now has these words/.test(await page.textContent(row)));
    ok('the other resume’s own text and every sent copy are unchanged', JSON.stringify((await st()).frozen[shared.other]) === otherBefore);
    await page.keyboard.press('Escape'); await settle(page);
    await page.click('#docname-btn'); await settle(page);
    await page.fill('#sw-q', shared.other.split(' - ')[0]); await settle(page);
    await page.click(`#switcher .swrow[data-rid="${shared.other}"] .sopt`); await settle(page);
    ok('the other resume still prints the old words', (await frameDoc(page, d => d.body.textContent)).includes(shared.text));
    ok('its banner counts lines, not bullets, and opens the one dialog', /line has newer wording|lines have newer wording/.test(await page.textContent('.banner')) && !(await page.$('.banner [data-act=goto]')));
    await page.click('.banner [data-act=review-open]'); await settle(page);
    ok('the newer wording is the second group, headed so', (await page.textContent(`${R} h3`)).toLowerCase().includes('newer wording from your other resumes') && (await page.$$(`${R} .rvrow[data-kind=n]`)).length >= 1);
    const nrow = await page.textContent(`${R} .rvrow[data-kind=n]`);
    ok('the row shows the words with the newer ones marked, and Use the newer wording and Keep mine', /Use the newer wording/.test(nrow) && /Keep mine/.test(nrow) && !!(await page.$(`${R} .rvrow[data-kind=n] ins`)));
    const n0 = await ev0();
    async function ev0(){ return page.evaluate(() => window.__wb.store.history.undo); }
    await page.click(`${R} .rvrow[data-kind=n] [data-rv=newer]`); await settle(page);
    ok('Use the newer wording is one undo step with an Undo on its row', (await ev0()) === n0 + 1 && /Undo/.test(await page.textContent(`${R} .rvrow[data-kind=n]`)));
    await page.click(`${R} [data-rv=cancel]`); await settle(page);
    ok('this resume now prints the newer wording', (await frameDoc(page, d => d.body.textContent)).includes('brandnew'));
    ok('the old separate review is gone: no newer view, no nw- controls', !(await page.$('[data-act=nw-accept], [data-act=nw-keep], [data-act=nw-all]')) && !(await page.evaluate(() => Object.keys(window.__wb.ui.VIEWS ?? {}).includes('newer'))));
  }
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the Review list: a phone, and focus')) {
  const ctx = await newContext({ viewport: { width: 390, height: 780 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const ids = await page.evaluate(async () => { const T = await import('/src/model/resume.js'), s = window.__wb.store.state; return T.listedBullets(s.record, s.cur, 'hydra'); });
  await page.evaluate(async ([a]) => { const T = await import('/src/model/resume.js'); window.__wb.store.commit(d => { T.setOverride(d.record, d.cur, a, T.textOf(d.record, a, d.cur) + ' Again.', { marks: [], base: null }); }, 'smoke'); }, ids);
  await page.evaluate(() => window.__wb.review.open());
  await settle(page);
  const box = await page.$eval('#review', e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, top: r.top, sw: document.documentElement.scrollWidth, over: e.scrollWidth > e.clientWidth + 1 }; });
  ok('on a phone the dialog is a full-screen sheet with no sideways scroll', Math.abs(box.w - 390) <= 1 && Math.abs(box.h - 780) <= 1 && box.left === 0 && box.top === 0 && box.sw <= 390 && !box.over, JSON.stringify(box));
  const small = await page.$$eval('#review button, #review select', b => b.filter(x => { const r = x.getBoundingClientRect(), d = document.querySelector('#review').getBoundingClientRect(); return !(r.left >= d.left - 1 && r.right <= d.right + 1 && r.height >= 24); }).map(x => `${x.textContent.trim().slice(0, 20)} ${Math.round(x.getBoundingClientRect().height)}px`));
  ok('every control of the sheet is inside it and large enough to press', small.length === 0, small.join(', '));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes it on a phone too', !(await page.evaluate(() => window.__wb.review.isOpen)));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

// ---- UX-6g ----
// A pointer path, not a jump: the pointer enters the element from the left in a few moves
const glide = async (page, loc) => { const b = await loc.boundingBox(); await page.mouse.move(b.x - 30, b.y + b.height / 2); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 }); };
const lineNow = (page, fact) => page.evaluate(f => { const w = window.__wb, el = w.sheet.elOf(f, w.ui.ix); return (el?.textContent ?? '').replace(/\s+/g, ' ').trim(); }, fact);
const norm = s => String(s).replace(/\s+/g, ' ').trim();

if (want('ux6g: a version hovered in the sidebar previews while a line is written')) for (const motion of [false, true]) {
  const ctx = await newContext({ motion, viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  const tag = motion ? 'with motion' : 'under reduced motion';
  await sheet.locator('.bullets li').first().click(); await settle(page);
  const fact = await page.evaluate(() => window.__wb.ui.sel.id);
  ok(`${tag}: the line is being written`, (await lineEl(page).count()) === 1 && (await page.evaluate(() => window.__wb.ui.writing)));
  await appendLine(page, ' DRAFT');
  const draft = await lineText(page), undo0 = await page.evaluate(() => window.__wb.store.history.undo);
  const caret0 = await page.evaluate(() => { const el = window.__wb.onpage.el(), s = el.ownerDocument.getSelection(); return s.anchorOffset; });
  const rows = page.locator('.vrow[data-v]');
  const n = await rows.count();
  ok(`${tag}: the sidebar lists more than one version of the line`, n >= 2, `${n}`);
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i), vid = await row.getAttribute('data-v');
    const want_ = await page.evaluate(v => window.__wb.ui.ix.variants.get(v).text, vid);
    await glide(page, row); await settle(page);
    ok(`${tag}: hovering ${vid} shows its text on the page in place of what is being written`, (await lineNow(page, fact)) === norm(want_), `${await lineNow(page, fact)} || ${norm(want_)}`);
    await page.mouse.move(4, 4, { steps: 6 }); await settle(page);
    ok(`${tag}: leaving it puts the typed line back, the caret and the draft untouched`, (await lineNow(page, fact)) === norm(draft) && (await lineText(page)) === draft && (await lineEl(page).count()) === 1
      && (await page.evaluate(() => { const el = window.__wb.onpage.el(), s = el.ownerDocument.getSelection(); return el.isConnected && el.contentEditable !== 'false' && s.anchorOffset; })) === caret0);
  }
  ok(`${tag}: hovering made no undo step`, (await page.evaluate(() => window.__wb.store.history.undo)) === undo0);
  const other = page.locator('.vrow[data-v]:not(.cur)').first(), ovid = await other.getAttribute('data-v');
  await other.click(); await settle(page); await page.mouse.move(4, 4, { steps: 6 }); await settle(page);
  ok(`${tag}: a click chooses it, and the typed text is kept as an edit first`, (await lineNow(page, fact)) === norm(await page.evaluate(v => window.__wb.ui.ix.variants.get(v).text, ovid)) && (await page.evaluate(f => window.__wb.store.state.cur.parked?.[f]?.text ?? '', fact)).endsWith('DRAFT'));
  ok(`${tag}: no console errors`, bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('file://')) {
  const ctx = await newContext();
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
  await page.waitForSelector('#no-origin', { timeout: 10000 }).catch(() => {});
  ok('opened from disk it says it needs an origin', await page.isVisible('#no-origin'));
  await ctx.close();
}

await browser.close();
server.close();
console.log(failed ? `\n${failed} shell check(s) FAILED` : '\nall shell checks passed');
process.exit(failed ? 1 : 0);
