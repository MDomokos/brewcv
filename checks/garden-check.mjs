#!/usr/bin/env node
// node checks/garden-check.mjs
// The tea garden (src/ui/garden.js) in Chromium, on the fictional example data. Needs playwright and a Chromium.
// The garden's test hooks exist only behind ?garden-check[=idle seconds] (window.__wb.garden); a normal page has none.
// ONLY=flow,rain runs only those scenarios. Each scenario has a page of its own and they run side by side, because leaves fall slowly.
//  - the start is clean; a wave spreads out (the closest pair about a leaf apart); leaves land on the page and a stroke moves them;
//    swept leaves come to rest; moving the mouse back clears nothing, a click into the resume or a key press clears the page, and
//    the settled leaves fade either way; the page stays clear when the pages move (two pages side by side);
//  - rain makes wet spots, and the page dries on return while the mat goes on drying;
//  - the ladybug comes in from the side and leaves by it, without fading; one with nowhere to come in gives way; the snail hides;
//    petals come as a cluster; the full pause starts and wakes;
//  - coffee rests it and tea brings it back as it was; the setting, reduced motion, a phone and the start screen load nothing;
//  - nothing from the garden prints or reaches the page's frame; an idle editor runs no animation frame; the axe pass is clean
//    with the garden out (AXE_CORE=/path/to/axe.min.js, else skipped).

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8132);
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

let failed = 0;
const lines = [];
const reporter = name => (label, cond, extra = '') => { lines.push(`${cond ? 'PASS' : 'FAIL'}  ${name}: ${label}${extra !== '' ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});
const sleep = ms => new Promise(r => setTimeout(r, ms));

// a page with the garden's hooks; idle is the garden's idle period in seconds (600: it never rests by itself)
async function open(ok, { idle = 600, query = '', drink = null, rb = {}, ctx = {} } = {}){
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...ctx });
  const page = await context.newPage();
  const bad = [];
  page.on('console', m => { if (m.type() === 'error') bad.push(m.text()); });
  page.on('pageerror', e => bad.push(String(e)));
  await page.addInitScript(([d, extra]) => { try { localStorage.setItem('rb-help-seen', '1'); localStorage.setItem('rb-panel', 'auto'); if (d) localStorage.setItem('rb-drink', d); for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v); } catch { /* nothing to set */ } }, [drink, rb]);
  await page.goto(`http://localhost:${PORT}/?memory&garden-check=${idle}${query}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 });
  await page.waitForFunction(() => (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  return { page, context, bad, done: () => ok('no console errors', bad.length === 0, bad[0] ?? '') };
}
const ready = page => page.waitForFunction(() => !!window.__wb.garden, null, { timeout: 10000 });
const hook = (page, fn, ...a) => page.evaluate(([f, args]) => window.__wb.garden[f](...args), [fn, a]);
// the pages as the person sees them, from the page's own elements in the frame (not from the garden's own reckoning)
const pagesNow = page => page.evaluate(() => {
  const fr = document.querySelector('#sheet iframe'), r = fr.getBoundingClientRect(), k = r.width / (fr.offsetWidth || r.width);
  return [...fr.contentDocument.querySelectorAll('.document > .page')].map(p => { const q = p.getBoundingClientRect(); return { l: r.left + q.left * k, r: r.left + q.right * k, t: r.top + q.top * k, b: r.top + q.bottom * k }; });
});
const leaves = page => page.evaluate(() => {
  const pg = (() => { const fr = document.querySelector('#sheet iframe'), r = fr.getBoundingClientRect(), k = r.width / (fr.offsetWidth || r.width);
    return [...fr.contentDocument.querySelectorAll('.document > .page')].map(p => { const q = p.getBoundingClientRect(); return { l: r.left + q.left * k, r: r.left + q.right * k, t: r.top + q.top * k, b: r.top + q.bottom * k }; }); })();
  const col = document.getElementById('col').getBoundingClientRect().left;   // what lies under the panel is not seen
  const EDGE = 24;                                                            // a leaf that hangs over the edge by less than this is off the page
  return [...document.querySelectorAll('#garden .g-thing.g-leaf')].map(e => { const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x, y, on: x < col && pg.some(q => x > q.l + EDGE && x < q.r - EDGE && y > q.t && y < q.b), o: Number(getComputedStyle(e).opacity), tf: e.style.transform }; });
});
const closest = ls => { let m = 1e9; for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) m = Math.min(m, Math.hypot(ls[i].x - ls[j].x, ls[i].y - ls[j].y)); return m; };
// a point on a page at least `far` px from every leaf and wet spot, to click or move the mouse without touching one
const freeSpot = async (page, far = 70) => {
  const [p] = await pagesNow(page);
  const ls = await page.evaluate(() => [...document.querySelectorAll('#garden .g-thing, #garden .g-wet')].map(e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
  let best = null, bestD = -1;
  for (let x = p.l + 30; x < p.r - 30; x += 24) for (let y = p.t + 30; y < p.b - 200; y += 24){ const d = Math.min(1e9, ...ls.map(([a, b]) => Math.hypot(a - x, b - y))); if (d > bestD){ bestD = d; best = [x, y]; } }
  return best;
};
const clear = async page => { for (let i = 0; i < 80 && (await leaves(page)).some(l => l.on); i++) await sleep(500); };
const landed = async page => { for (let i = 0; i < 120 && await page.evaluate(() => document.querySelectorAll('#garden .g-leaf.falling, #garden .g-petal.falling').length); i++) await sleep(500); await sleep(2500); };

// ---- the flow: a clean start, a wave spreads, the way back, the click, the print gate ----
async function flow(){
  const ok = reporter('flow'), s = await open(ok), { page } = s;
  await ready(page);
  ok('the start is clean: nothing lies on the mat', (await page.$$('#garden .g-thing')).length === 0);
  ok('the garden is hidden from assistive technology and takes no pointer', await page.evaluate(() => { const g = document.getElementById('garden'); return g.getAttribute('aria-hidden') === 'true' && getComputedStyle(g).pointerEvents === 'none'; }));
  await page.mouse.move(1270, 790);
  await hook(page, 'rest'); await hook(page, 'wave', 7); await hook(page, 'wave', 6);
  await landed(page);
  const ls = await leaves(page);
  ok('two waves: most of 13 leaves lie there (the wind takes some off the screen)', ls.length >= 6 && ls.length <= 13, String(ls.length));
  ok('a wave spreads out: the closest pair is at least about a leaf apart', closest(ls) >= 26, closest(ls).toFixed(0) + ' px');
  ok('leaves land on the page too', ls.filter(l => l.on).length > 0, `${ls.filter(l => l.on).length} on it`);
  ok('while you rest the leaves are fully there', ls.every(l => l.o >= 0.95), String(Math.min(...ls.map(l => l.o))));
  // the print gate, with things out
  await page.emulateMedia({ media: 'print' });
  ok('nothing from the garden prints', await page.evaluate(() => getComputedStyle(document.getElementById('garden')).display === 'none' && getComputedStyle(document.querySelector('.g-dapple')).display === 'none'));
  await page.emulateMedia({ media: 'screen' });
  ok('nothing from the garden is in the page\'s frame', await page.evaluate(() => { const d = document.querySelector('#sheet iframe').contentDocument; return !d.querySelector('#garden, .g-thing, .g-dapple') && ![...d.styleSheets].some(x => /garden/.test(x.href ?? '')) && !/g-thing|garden/.test(d.documentElement.outerHTML); }));
  // the way back: only moving the mouse clears nothing; the settled leaves fade
  const before = ls.filter(l => l.on).length;
  const [fx, fy] = await freeSpot(page);
  await page.mouse.move(fx, fy); await page.mouse.move(fx + 2, fy + 2);
  await sleep(3500);
  const back = await leaves(page);
  ok('moving the mouse back clears nothing on the page', back.filter(l => l.on).length === before, `${before} → ${back.filter(l => l.on).length}`);
  ok('the settled leaves fade into the mat', back.every(l => l.o <= 0.45), String(Math.max(...back.map(l => l.o))));
  await page.mouse.click(fx, fy);
  await clear(page);
  const after = await leaves(page);
  ok('a click into the resume clears the page', after.filter(l => l.on).length === 0, `${after.filter(l => l.on).length} left on it`);
  ok('…and the leaves are not gone, only moved off it', after.length > 0, `${after.length} lying`);
  let faded = after; for (let i = 0; i < 20 && faded.filter(l => l.o <= 0.45).length < faded.length * 0.8; i++){ await sleep(500); faded = await leaves(page); }
  ok('…and they stay faded while you work', faded.filter(l => l.o <= 0.45).length >= faded.length * 0.8, faded.map(l => l.o.toFixed(2)).join(' '));
  s.done(); await s.context.close();
}

// ---- a stroke over a leaf on the page, and a sweep that comes to rest ----
async function sweep(){
  const ok = reporter('sweep'), s = await open(ok), { page } = s;
  await ready(page);
  await page.mouse.move(1270, 790);
  await hook(page, 'rest'); await hook(page, 'wave', 7); await hook(page, 'wave', 6);
  await landed(page);
  const ls = await leaves(page);
  const target = ls.find(l => l.on);
  ok('a leaf lies on the page', !!target);
  if (target){
    await page.mouse.move(target.x - 60, target.y);
    for (let k = 0; k <= 12; k++) await page.mouse.move(target.x - 60 + k * 10, target.y + 1);
    await sleep(1500);
    const now = await leaves(page);
    ok('a stroke over the page moves the leaf under it', !now.some(l => Math.hypot(l.x - target.x, l.y - target.y) < 3) );
  }
  const [p] = await pagesNow(page);
  for (let y = p.t + 20; y < p.b; y += 34){ await page.mouse.move(p.l + 10, y); for (let x = p.l + 10; x < p.r + 40; x += 26) await page.mouse.move(x, y); }
  await sleep(3500);
  const t1 = (await leaves(page)).map(l => l.tf).join('|');
  await sleep(1500);
  const t2 = (await leaves(page)).map(l => l.tf).join('|');
  ok('swept leaves come to rest', t1 === t2);
  s.done(); await s.context.close();
}

// ---- a key press clears the page, from the pointer ----
async function keyClear(){
  const ok = reporter('key'), s = await open(ok), { page } = s;
  await ready(page);
  await page.mouse.move(1270, 790);
  await hook(page, 'rest'); await hook(page, 'wave', 7); await hook(page, 'wave', 7);
  await landed(page);
  const n = (await leaves(page)).filter(l => l.on).length;
  ok('leaves lie on the page', n > 0, String(n));
  const [fx, fy] = await freeSpot(page);
  await page.mouse.move(fx, fy); await sleep(1500);
  ok('the mouse alone left them there', (await leaves(page)).filter(l => l.on).length === n);
  await page.keyboard.press('x');
  await clear(page);
  ok('a key press clears the page', (await leaves(page)).filter(l => l.on).length === 0);
  s.done(); await s.context.close();
}

// ---- the page stays clear when the pages move: two pages side by side, then a zoom ----
async function editing(){
  const ok = reporter('editing'), s = await open(ok, { rb: { 'rb-panel': 'open' } }), { page } = s;
  await ready(page);
  await page.click('#docname-btn'); await page.waitForSelector('#switcher .sopt');
  await page.click('#switcher .sopt:has-text("Medtech")'); await sleep(1500);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(1200);
  ok('two pages side by side', (await pagesNow(page)).length === 2 && await page.evaluate(() => window.__wb.canvas.scene === 'all'));
  await page.mouse.move(1270, 790);
  await hook(page, 'rest'); await hook(page, 'wave', 7); await hook(page, 'wave', 7);
  await landed(page);
  const [fx, fy] = await freeSpot(page);
  const air = await page.evaluate(() => document.querySelectorAll('#garden .g-leaf.falling').length);
  await page.mouse.click(fx, fy); await clear(page);
  const left = (await leaves(page)).filter(l => l.on);
  ok('a click clears both pages', left.length === 0, `${air} still falling at the click; ` + JSON.stringify(left.map(l => [Math.round(l.x), Math.round(l.y)])) + ' ' + JSON.stringify(await pagesNow(page)));
  // leaves that come down while you work land on the pages; the canvas moves them: cleared again
  await hook(page, 'wave', 7); await hook(page, 'wave', 7);
  await landed(page);
  const lying = (await leaves(page)).filter(l => l.on).length;
  await page.evaluate(() => { window.__moved = 0; document.addEventListener('brewcv:pages-moved', () => { window.__moved++; }); window.__wb.canvas.zoomTo(1.7); });
  await sleep(7000);
  const now = await leaves(page);
  ok('the canvas says the pages moved', (await page.evaluate(() => window.__moved)) >= 1);
    ok('zooming clears what the pages now cover', now.filter(l => l.on).length === 0, `${lying} on the pages before, ${now.filter(l => l.on).length} after`);
  s.done(); await s.context.close();
}

// ---- rain ----
async function rain(){
  const ok = reporter('rain'), s = await open(ok), { page } = s;
  await ready(page);
  await page.mouse.move(1270, 790);
  await hook(page, 'rest'); await hook(page, 'rain');
  await sleep(14000);
  const count = () => page.evaluate(() => {
    const fr = document.querySelector('#sheet iframe'), r = fr.getBoundingClientRect(), k = r.width / (fr.offsetWidth || r.width);
    const pg = [...fr.contentDocument.querySelectorAll('.document > .page')].map(p => { const q = p.getBoundingClientRect(); return { l: r.left + q.left * k, r: r.left + q.right * k, t: r.top + q.top * k, b: r.top + q.bottom * k }; });
    const w = [...document.querySelectorAll('#garden .g-wet:not(.dry)')].map(e => { const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
    return { drops: document.querySelectorAll('#garden .g-drop').length, wet: w.length, onPage: w.filter(([x, y]) => pg.some(q => x > q.l && x < q.r && y > q.t && y < q.b)).length,
      sky: Number(getComputedStyle(document.querySelector('.g-rainsky')).opacity), raining: document.querySelector('.g-rainsky').classList.contains('on') };
  });
  const mid = await count();
  ok('a shower makes wet spots, on the page and on the mat', mid.wet > 5 && mid.onPage > 0 && mid.wet > mid.onPage, JSON.stringify(mid));
  ok('the scene dims a touch while it rains', mid.raining && mid.sky > 0);
  const [fx, fy] = await freeSpot(page, 20);
  await page.mouse.move(fx, fy); await sleep(1500);
  ok('moving the mouse back dries nothing', (await count()).onPage >= mid.onPage);
  await page.mouse.click(fx, fy); await sleep(2800);
  const end = await count();
  ok('a click into the resume dries the page in a moment', end.onPage === 0, JSON.stringify(end));
  ok('the rain stops and no drop is left on its way', !end.raining && end.drops === 0);
  ok('the mat goes on drying slowly', end.wet > 0, String(end.wet));
  s.done(); await s.context.close();
}

// ---- the creatures ----
async function creatures(){
  const ok = reporter('creatures'), s = await open(ok), { page } = s;
  await ready(page);
  await page.mouse.move(1270, 790);
  await hook(page, 'rest');
  ok('the ladybug comes', await hook(page, 'bug') === true);
  ok('only one of a kind at a time: a second one gives way', await hook(page, 'bug') === false);
  const xs = [];
  for (let k = 0; k < 8; k++){ await sleep(900); xs.push(await page.evaluate(() => { const e = document.querySelector('.g-bug'); return e ? Math.round(e.getBoundingClientRect().x) : null; })); }
  ok('it comes in from the side of the screen', xs[0] < 20 && xs.at(-1) > xs[0] + 30, JSON.stringify(xs));
  const b = await page.evaluate(() => { const r = document.querySelector('.g-bug').getBoundingClientRect(); return [r.x + 8, r.y + 8]; });
  await page.mouse.move(b[0] + 50, b[1]); await page.mouse.move(b[0] + 20, b[1]);
  const seen = [];
  for (let k = 0; k < 24; k++){ await sleep(500); const q = await page.evaluate(() => { const e = document.querySelector('.g-bug'); return e ? [Math.round(e.getBoundingClientRect().x), getComputedStyle(e).opacity] : null; }); if (!q) break; seen.push(q); }
  ok('it runs when the pointer comes near, and leaves by the side it came in', seen.length < 24 && Math.min(...seen.map(q => q[0])) < 20, JSON.stringify(seen));
  ok('…without fading', seen.every(q => q[1] === '1'));
  ok('…and is gone', await page.evaluate(() => !document.querySelector('.g-bug') && ![...document.querySelectorAll('#garden *')].some(e => e.className?.toString().includes('g-shade-bug'))));
  // the snail hides in its shell
  ok('the snail comes', await hook(page, 'snail') === true);
  await sleep(2500);
  const sn = await page.evaluate(() => { const r = document.querySelector('.g-thing.g-snail').getBoundingClientRect(); return [r.x + 17, r.y + 11]; });
  await page.mouse.move(sn[0] + 40, sn[1]); await page.mouse.move(sn[0] + 20, sn[1]);
  await sleep(300);
  ok('the snail hides when the pointer comes near', await page.evaluate(() => document.querySelector('.g-thing.g-snail').classList.contains('hid')));
  // a creature with nowhere to come in gives way: zoom in until no margin is left beside the pages
  await page.evaluate(() => window.__wb.canvas.zoomTo(3));
  await sleep(1500);
  ok('with no margin beside the pages the butterfly gives way (the moment goes to the next card)', await hook(page, 'butterfly') === false);
  s.done(); await s.context.close();
}

// ---- petals ----
async function petals(){
  const ok = reporter('petals'), s = await open(ok), { page } = s;
  await ready(page);
  await page.mouse.move(1270, 790);
  await hook(page, 'rest'); await hook(page, 'petals');
  for (let i = 0, n = -1, same = 0; i < 20 && same < 2; i++){ await sleep(700); const c = await page.evaluate(() => document.querySelectorAll('#garden .g-thing.g-petal').length); same = c === n ? same + 1 : 0; n = c; }
  const xs = await page.evaluate(() => [...document.querySelectorAll('#garden .g-thing.g-petal')].map(e => Math.round(e.getBoundingClientRect().x)));
  ok('petals come as a cluster of four to six', xs.length >= 4 && xs.length <= 6, String(xs.length));
  ok('…from one spot', Math.max(...xs) - Math.min(...xs) < 300, `${Math.max(...xs) - Math.min(...xs)} px wide`);
  s.done(); await s.context.close();
}

// ---- the full pause (a two second idle period: the pause comes after twenty seconds) ----
async function pause(){
  const ok = reporter('pause'), s = await open(ok, { idle: 2 }), { page } = s;
  await ready(page);
  const paused = () => page.evaluate(() => document.getElementById('garden').classList.contains('paused'));
  await sleep(6000);
  ok('the first rest brings a wave', (await page.$$('#garden .g-thing.g-leaf')).length > 0);
  ok('resting for a few periods: not paused', !(await paused()));
  await sleep(22000);
  ok('after ten idle periods the garden pauses', await paused());
  const n = (await page.$$('#garden .g-thing')).length;
  await sleep(8000);
  ok('nothing more comes while it is paused', (await page.$$('#garden .g-thing')).length <= n);
  await page.mouse.move(600, 400); await sleep(300);
  ok('any input wakes it', !(await paused()));
  s.done(); await s.context.close();
}

// ---- coffee rests it; the setting; the places it does not run ----
async function drinks(){
  const ok = reporter('coffee'), s = await open(ok), { page } = s;
  await ready(page);
  await page.mouse.move(1270, 790);
  await hook(page, 'rest'); await hook(page, 'wave', 4); await hook(page, 'bug');
  await sleep(7000);
  const lying = (await page.$$('#garden .g-thing.g-leaf')).length;
  await page.click('#brewmode button[data-drink=coffee]'); await sleep(500);
  ok('switching to coffee rests it: nothing shows', await page.evaluate(() => getComputedStyle(document.getElementById('garden')).display === 'none'));
  ok('…and the creatures have gone', (await page.$$('#garden .g-bug')).length === 0);
  await page.click('#brewmode button[data-drink=tea]'); await sleep(500);
  ok('back to tea, what lay there is still there', await page.evaluate(() => getComputedStyle(document.getElementById('garden')).display !== 'none') && (await page.$$('#garden .g-thing.g-leaf')).length === lying, String(lying));
  // the setting
  await page.evaluate(() => window.__wb.setView('settings')); await sleep(600);
  ok('Settings has "Garden while you rest", on', await page.evaluate(() => document.querySelector('[data-garden]')?.checked === true));
  await page.click('[data-garden]'); await sleep(400);
  ok('switching it off rests the garden and is remembered', await page.evaluate(() => getComputedStyle(document.getElementById('garden')).display === 'none' && localStorage.getItem('rb-garden') === 'off'));
  await page.click('[data-garden]'); await sleep(400);
  ok('switching it on again brings it back', await page.evaluate(() => getComputedStyle(document.getElementById('garden')).display !== 'none'));
  s.done(); await s.context.close();
}
async function gates(){
  const ok = reporter('gates');
  const cases = [
    ['coffee', { drink: 'coffee' }],
    ['the setting off', { rb: { 'rb-garden': 'off' } }],
    ['reduced motion', { ctx: { reducedMotion: 'reduce' } }],
    ['a phone', { ctx: { viewport: { width: 600, height: 800 } } }],
    ['the start screen', { query: '&welcome' }],
  ];
  await Promise.all(cases.map(async ([name, o]) => {
    const s = await open(ok, o);
    await sleep(2500);
    const g = await s.page.evaluate(() => ({ el: !!document.getElementById('garden'), hooks: !!window.__wb.garden, dap: !!document.querySelector('.g-dapple'), css: !!document.querySelector('link[href*="garden.css"]') }));
    ok(`${name}: the garden is not loaded and shows nothing`, !g.el && !g.hooks && !g.dap && !g.css, JSON.stringify(g));
    await s.context.close();
  }));
  // a normal page has no hooks
  const n = await open(ok, { query: '' }); await n.page.goto(`http://localhost:${PORT}/?memory`, { waitUntil: 'networkidle' });
  await n.page.waitForFunction(() => document.body.classList.contains('is-ready')); await sleep(1500);
  ok('without the flag there are no hooks on any global', await n.page.evaluate(() => !window.__garden && !window.__wb.garden && !!document.getElementById('garden')));
  await n.context.close();
  // an idle editor costs nothing: no animation frame, no matter how long it sits
  const i = await open(ok, { idle: 600 });
  await ready(i.page);
  await i.page.evaluate(() => { window.__raf = 0; const f = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => { window.__raf++; return f(cb); }; });
  await sleep(3000);
  ok('an idle editor runs no animation frame', (await i.page.evaluate(() => window.__raf)) === 0);
  i.done(); await i.context.close();
}

// ---- axe, with the garden out ----
async function axe(){
  const ok = reporter('axe'), axePath = process.env.AXE_CORE;
  if (!axePath || !fs.existsSync(axePath)){ lines.push('skipped  axe: set AXE_CORE to the path of axe.min.js to run it'); return; }
  const src = fs.readFileSync(axePath, 'utf8');
  for (const theme of ['light', 'dark']){
    const s = await open(ok, { ctx: { bypassCSP: true, colorScheme: theme }, rb: { 'rb-theme': theme } }), { page } = s;
    await ready(page);
    await page.mouse.move(1270, 790);
    await hook(page, 'rest'); await hook(page, 'wave', 5); await hook(page, 'petals'); await hook(page, 'rain'); await hook(page, 'bug'); await hook(page, 'snail'); await hook(page, 'butterfly');
    await sleep(6000);
    await page.evaluate(src);
    const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map(x => `${x.id} (${x.impact}): ${x.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`));
    ok(`axe-core, tea ${theme}, with leaves, petals, rain and creatures out`, v.length === 0, v.join(' ; '));
    await s.context.close();
  }
}

const all = { flow, sweep, key: keyClear, editing, rain, creatures, petals, pause, drinks, gates, axe };
const only = process.env.ONLY?.split(',');           // ONLY=editing,gates runs just those
await Promise.all(Object.entries(all).filter(([n]) => !only || only.includes(n)).map(([, f]) => f()));
await browser.close(); server.close();
for (const l of lines.sort()) console.log(l);
console.log(failed ? `\n${failed} FAILED` : '\nAll garden checks pass.');
process.exit(failed ? 1 : 0);
