#!/usr/bin/env node
// node checks/garden-check.mjs
// The tea garden (src/ui/garden.js) in Chromium, on the fictional example data. Needs playwright and a Chromium.
// The garden's test hooks exist only behind ?garden-check[=idle seconds] (window.__wb.garden); a normal page has none.
// ONLY=flow,rain runs only those scenarios. Each scenario has a page of its own and they run side by side, because leaves fall slowly.
//  - the start is clean; a wave spreads out (no two leaves more than a third over each other); leaves land on the page and a stroke moves them;
//    swept leaves come to rest; moving the mouse back clears nothing, a click into the resume or a key press clears the page, and
//    the settled leaves fade either way; the page stays clear when the pages move (two pages side by side);
//  - rain makes wet spots, and the page dries on return while the mat goes on drying;
//  - the ladybug comes in from the side and leaves by it, without fading; one with nowhere to come in gives way; the snail hides;
//    a startled ladybug opens its wings and lifts; a leaf lifts as it leaves the page; a leaf lying still never moves when another lands
//    or stops beside it (bump); what lies on a page stays on its point of the page, frame for frame, while the view zooms in to
//    write (zoom); a click is a puff: a leaf leaves by the side it lies from the click (about straight above it: its nearer
//    side), far ones go too, a key blows from the line typed in, a leaf never crosses the next page, and a click on the mat
//    scatters the leaves near it, lands none on a page and keeps the rest going (puff, pages); a shower brings out a snail; petals come as a cluster; the full pause starts and wakes;
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
// the pointer at rest in the window's bottom right corner, which is the sidebar's (the mat is the garden's)
const park = page => page.evaluate(() => [innerWidth - 10, innerHeight - 10]).then(([x, y]) => page.mouse.move(x, y));

// a page with the garden's hooks; idle is the garden's idle period in seconds (600: it never rests by itself)
async function open(ok, { idle = 600, query = '', drink = null, rb = {}, ctx = {} } = {}){
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...ctx });
  const page = await context.newPage();
  const bad = [];
  page.on('console', m => { if (m.type() === 'error') bad.push(m.text()); });
  page.on('pageerror', e => bad.push(String(e)));
  await page.addInitScript(([d, extra]) => { try { (localStorage.setItem('rb-help-seen', '1'), localStorage.setItem('rb-esc-fold', 'off')); if (d) localStorage.setItem('rb-drink', d); for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v); } catch { /* nothing to set */ } }, [drink, rb]);
  await page.goto(`http://localhost:${PORT}/?memory&garden-check=${idle}${query}#resume`, { waitUntil: 'networkidle' });
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
    return { x, y, on: x < col && pg.some(q => x > q.l + EDGE && x < q.r - EDGE && y > q.t && y < q.b), o: Number(getComputedStyle(e).opacity), faded: e.classList.contains('faded'), tf: e.style.transform, len: Math.max(e.offsetWidth, e.offsetHeight) * (+(e.style.transform.match(/scale\([-\d.]+, ([\d.]+)\)/)?.[1] ?? 1)) }; });
});
// the closest pair as a share of their mean length: 1 is end to end, two thirds overlaps a third
const closestShare = ls => { let m = 1e9; for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) m = Math.min(m, Math.hypot(ls[i].x - ls[j].x, ls[i].y - ls[j].y) / ((ls[i].len + ls[j].len) / 2)); return m; };
// a point on a page at least `far` px from every leaf and wet spot, to click or move the mouse without touching one
const freeSpot = async (page, far = 70) => {
  const [p] = await pagesNow(page);
  const ls = await page.evaluate(() => [...document.querySelectorAll('#garden .g-thing, #garden .g-wet')].map(e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
  let best = null, bestD = -1;
  for (let x = p.l + 30; x < p.r - 30; x += 24) for (let y = p.t + 30; y < p.b - 200; y += 24){ const d = Math.min(1e9, ...ls.map(([a, b]) => Math.hypot(a - x, b - y))); if (d > bestD){ bestD = d; best = [x, y]; } }
  return best;
};
const clear = async page => { for (let i = 0, clean = 0; i < 80 && clean < 2; i++){ clean = (await leaves(page)).some(l => l.on) ? 0 : clean + 1; await sleep(500); } };      // (two clean looks in a row: a leaf gliding off may still cross the page between one look and the next)
const landed = async page => { for (let i = 0; i < 120 && await page.evaluate(() => document.querySelectorAll('#garden .g-leaf.falling, #garden .g-petal.falling').length); i++) await sleep(500); await sleep(2500); };

// ---- the flow: a clean start, a wave spreads, the way back, the click, the print gate ----
async function flow(){
  const ok = reporter('flow'), s = await open(ok), { page } = s;
  await ready(page);
  ok('the start is clean: nothing lies on the mat', (await page.$$('#garden .g-thing')).length === 0);
  ok('the garden is hidden from assistive technology and takes no pointer', await page.evaluate(() => { const g = document.getElementById('garden'); return g.getAttribute('aria-hidden') === 'true' && getComputedStyle(g).pointerEvents === 'none'; }));
  await park(page);
  await hook(page, 'rest'); await hook(page, 'wave', 7); await hook(page, 'wave', 6);
  await landed(page);
  const ls = await leaves(page);
  ok('two waves: most of 13 leaves lie there (the wind takes some off the screen)', ls.length >= 6 && ls.length <= 13, String(ls.length));
  ok('a wave spreads out: the closest pair overlaps a third of a leaf at most (with a little slack for the slide on landing)', closestShare(ls) >= .58, closestShare(ls).toFixed(2) + ' of a leaf apart');
  ok('leaves land on the page too', ls.filter(l => l.on).length > 0, `${ls.filter(l => l.on).length} on it`);
  ok('while you rest the leaves are fully there', ls.every(l => l.o >= 0.95 && !l.faded), String(Math.min(...ls.map(l => l.o))));
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
  ok('the settled leaves fade into the mat', back.every(l => l.faded), back.map(l => l.faded).join(' '));
  await page.mouse.click(fx, fy);
  let lifted = false; for (let i = 0; i < 40 && !lifted; i++){ await sleep(150); lifted = await page.evaluate(() => !!document.querySelector('#garden .g-thing.g-leaf.falling')); }
  ok('leaves lift (the raised layer) as they leave the page', lifted);
  await clear(page);
  const after = await leaves(page);
  ok('a click into the resume clears the page', after.filter(l => l.on).length === 0, `${after.filter(l => l.on).length} left on it`);
  ok('…and the leaves are not gone, only moved off it', after.length > 0, `${after.length} lying`);
  let faded = after; for (let i = 0; i < 20 && faded.filter(l => l.faded).length < faded.length * 0.8; i++){ await sleep(500); faded = await leaves(page); }
  ok('…and they stay faded while you work', faded.filter(l => l.faded).length >= faded.length * 0.8, faded.map(l => l.faded).join(' '));
  s.done(); await s.context.close();
}

// ---- a stroke over a leaf on the page, and a sweep that comes to rest ----
async function sweep(){
  const ok = reporter('sweep'), s = await open(ok), { page } = s;
  await ready(page);
  await park(page);
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
  await park(page);
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
  const ok = reporter('editing'), s = await open(ok, { ctx: { viewport: { width: 2560, height: 1100 } } }), { page } = s;      // wide enough for both pages beside the sidebar
  await ready(page);
  await page.click('#docname-btn'); await page.waitForSelector('#switcher .sopt');
  await page.fill('#switcher #sw-q', 'Medtech');      // the window lists the recent ones until a search
  await page.click('#switcher .sopt:has-text("Medtech")'); await sleep(1500);
  await sleep(1200);
  await page.waitForFunction(() => window.__wb.canvas.scene === 'all', null, { timeout: 10000 }).catch(() => { /* the check below says so */ });
  ok('two pages side by side', (await pagesNow(page)).length === 2 && await page.evaluate(() => window.__wb.canvas.scene === 'all'));
  await park(page);
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
  await park(page);
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
  // (the mat left of the sidebar must have room beside the page for a creature to come in: a wider window)
  const ok = reporter('creatures'), s = await open(ok, { ctx: { viewport: { width: 1920, height: 1000 } } }), { page } = s;
  await ready(page);
  await park(page);
  await hook(page, 'rest');
  ok('the ladybug comes', await hook(page, 'bug') === true);
  ok('only one of a kind at a time: a second one gives way', await hook(page, 'bug') === false);
  const xs = [];
  for (let k = 0; k < 8; k++){ await sleep(900); xs.push(await page.evaluate(() => { const e = document.querySelector('.g-bug'); return e ? Math.round(e.getBoundingClientRect().x) : null; })); }
  ok('it comes in from the side of the screen', xs[0] < 20 && xs.at(-1) > xs[0] + 30, JSON.stringify(xs));
  const b = await page.evaluate(() => { const r = document.querySelector('.g-bug').getBoundingClientRect(); return [r.x + 8, r.y + 8]; });
  await page.mouse.move(b[0] + 50, b[1]); await page.mouse.move(b[0] + 20, b[1]);
  await sleep(300);
  const fly = await page.evaluate(() => {
    const e = document.querySelector('.g-bug'), at = x => (x.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/) ?? []).slice(1).map(Number);
    return { cls: e.classList.contains('flying'), wing: getComputedStyle(e.querySelector('.wg')).display, dy: at(document.querySelector('.g-shade-bug'))[1] - at(e)[1] };
  });
  ok('a startled ladybug opens its wing cases, shows its wings and lifts (its shadow falls farther)', fly.cls && fly.wing === 'block' && fly.dy > 8, JSON.stringify(fly));
  const seen = [];
  // sampled often: a startled one flies, and can cross the margin in well under a second
  for (let k = 0; k < 120; k++){ await sleep(100); const q = await page.evaluate(() => { const e = document.querySelector('.g-bug'); return e ? [Math.round(e.getBoundingClientRect().x), getComputedStyle(e).opacity] : null; }); if (!q) break; seen.push(q); }
  ok('it runs when the pointer comes near, and leaves by the side it came in', seen.length > 0 && seen.length < 120 && Math.min(...seen.map(q => q[0])) < 20, JSON.stringify(seen.filter((q, i) => i % 3 === 0)));
  ok('…without fading', seen.every(q => q[1] === '1'));
  ok('…and is gone', await page.evaluate(() => !document.querySelector('.g-bug') && ![...document.querySelectorAll('#garden *')].some(e => e.className?.toString().includes('g-shade-bug'))));
  // the snail hides in its shell
  ok('the snail comes', await hook(page, 'snail') === true);
  // it is drawn at its real size and comes in slowly: wait until it is in view
  await page.waitForFunction(() => document.querySelector('.g-thing.g-snail')?.getBoundingClientRect().x > 10, null, { timeout: 60000 });
  const sn = await page.evaluate(() => { const r = document.querySelector('.g-thing.g-snail').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.mouse.move(sn[0] + 40, sn[1]); await page.mouse.move(sn[0] + 20, sn[1]);
  await sleep(300);
  ok('the snail hides when the pointer comes near', await page.evaluate(() => document.querySelector('.g-thing.g-snail').classList.contains('hid')));
  // a creature with nowhere to come in gives way: zoom in until no margin is left beside the pages
  await page.evaluate(() => window.__wb.canvas.zoomTo(3));
  await sleep(1500);
  ok('with no margin beside the pages the butterfly gives way (the moment goes to the next card)', await hook(page, 'butterfly') === false);
  s.done(); await s.context.close();
}

// ---- a leaf lying still never moves because another lands on it or stops beside it ----
async function bump(){
  const ok = reporter('bump'), s = await open(ok), { page } = s;
  await ready(page);
  await park(page);
  await hook(page, 'rest');
  const at = () => page.evaluate(() => [...document.querySelectorAll('#garden .g-thing.g-leaf')].map(e => ({ tf: e.style.transform, fall: e.classList.contains('falling') })));
  const xy = l => l.tf.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/).slice(1).map(Number);
  const wait = async () => { for (let i = 0; i < 120 && (await at()).some(l => l.fall); i++) await sleep(300); await sleep(3000); };
  await hook(page, 'leaf', 200, 150, 330); await wait();
  const [a] = await at(), m = xy(a);
  await hook(page, 'leaf', m[0] + 6, 150, 330 + 4); await wait();
  const two = await at(), b = xy(two[1]);
  ok('a leaf landing on one that lies there does not move it', two.length === 2 && two[0].tf === a.tf, `${a.tf} → ${two[0].tf}`);
  ok('…it steered to a spot of its own in the air, over it by a third at most', Math.hypot(b[0] - m[0], b[1] - m[1]) > 14, Math.hypot(b[0] - m[0], b[1] - m[1]).toFixed(0) + ' px');
  await hook(page, 'leaf', m[0] - 8, 150, 330 - 6); await wait();
  const three = await at();
  ok('a third one landing among them moves neither', three.length === 3 && three[0].tf === a.tf && three[1].tf === two[1].tf);
  await sleep(2500);
  ok('…and once down, none of them shifts again', (await at()).map(l => l.tf).join('|') === three.map(l => l.tf).join('|'));
  s.done(); await s.context.close();
}

// ---- what lies on a page moves with it, frame for frame, while the view zooms in to write ----
async function zoom(){
  const ok = reporter('zoom'), s = await open(ok), { page } = s;
  await ready(page);
  await park(page);
  await hook(page, 'rest');
  const [p] = await pagesNow(page);
  await hook(page, 'leaf', p.r - 90, -30, p.t + 260); await landed(page);
  const lay = (await leaves(page)).find(l => l.on);
  ok('a leaf lies on the page', !!lay);
  if (lay){
    await hook(page, 'work', p.l + 10, p.t + 250);      // the pointer at the far side: the clear's front reaches the leaf late
    const r = await page.evaluate(() => new Promise(done => {
      const fr = document.querySelector('#sheet iframe'), leaf = document.querySelector('#garden .g-thing.g-leaf');
      const at = () => { const a = leaf.getBoundingClientRect(), f = fr.getBoundingClientRect(); return { x: a.x + a.width / 2, y: a.y + a.height / 2, fl: f.left, ft: f.top, k: f.width / fr.offsetWidth, tf: leaf.style.transform }; };
      const s0 = at(), P = { x: (s0.x - s0.fl) / s0.k, y: (s0.y - s0.ft) / s0.k }, out = [], t0 = performance.now();
      window.__wb.canvas.writeTo({ left: 60, top: 80, width: 300, height: 20 }, 160);
      // until the clear's front moves the leaf itself: the leaf's centre against the point of the page it lay on
      const tick = () => {
        const n = at(); if (n.tf === s0.tf && Math.abs(n.k - s0.k) > 1e-3) out.push(Math.hypot(n.x - (n.fl + P.x * n.k), n.y - (n.ft + P.y * n.k)));
        if (n.tf === s0.tf && performance.now() - t0 < 2000) requestAnimationFrame(tick); else done({ frames: out.length, max: +Math.max(0, ...out).toFixed(2), k0: s0.k, k: n.k });
      };
      requestAnimationFrame(tick);
    }));
    ok('…and while the view zooms in to write, it stays on the point of the page under it, frame for frame', r.frames >= 3 && r.max <= 2, JSON.stringify(r));
    await sleep(3000);
    ok('…and once the view rests it is back on the mat', await page.evaluate(() => document.getElementById('gpage').children.length === 0 && document.querySelectorAll('#gworld .g-thing.g-leaf').length === 1));
  }
  s.done(); await s.context.close();
}

// ---- the puff ----
// leaves dropped one by one (each just above where it lands, so they come down quickly), then named k0, k1, … in that order
const drop = async (page, pts) => { for (const [x, y] of pts){ await hook(page, 'leaf', x - 15, y - 50, y - 7); await landed(page); } await page.evaluate(() => [...document.querySelectorAll('#garden .g-thing.g-leaf')].forEach((e, i) => { e.dataset.k ??= `k${i}`; })); };
const named = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#garden .g-thing.g-leaf')].map(e => { const r = e.getBoundingClientRect(); return [e.dataset.k, { x: r.x + r.width / 2, y: r.y + r.height / 2, tf: e.style.transform, o: Number(getComputedStyle(e).opacity) * (e.classList.contains('faded') ? .38 : 1) }]; })));
// until nothing moves: a far leaf's breeze starts late and a long way can take two seconds, so a clear page is not yet a settled one
const settled = async page => { let a = null; for (let i = 0; i < 30; i++){ await sleep(1000); const b = await page.evaluate(() => [...document.querySelectorAll('#garden .g-thing.g-leaf')].map(e => e.style.transform + e.className).join('|')); if (b === a && !b.includes('falling')) return; a = b; } };
const side = (l, p) => !l ? 'gone' : l.x < p.l ? 'left' : l.x > p.r ? 'right' : 'on';
async function puff(){
  const ok = reporter('puff'), s = await open(ok, { ctx: { viewport: { width: 1600, height: 900 } } }), { page } = s;
  await ready(page);
  await park(page);
  await hook(page, 'rest');
  const [p] = await pagesNow(page), W = p.r - p.l, O = [p.l + W * .8, p.t + 330];
  // k0 left of the click though nearer the right edge; k1 straight above the click; k2 far (over 2.5 R) below and to the left
  await drop(page, [[p.l + W * .58, O[1] + 10], [O[0], O[1] - 150], [p.l + W * .3, Math.min(p.b - 40, O[1] + 420)]]);
  const before = await named(page);
  ok('three leaves lie on the page', ['k0', 'k1', 'k2'].every(k => side(before[k], p) === 'on'), JSON.stringify(before));
  O[0] = before.k1.x;      // a falling leaf sways: straight below where it came down, not where it was dropped
  await hook(page, 'click', ...O);
  await settled(page);
  const after = await named(page);
  ok('a leaf left of the click leaves by the left edge (though the right was nearer)', side(after.k0, p) === 'left', side(after.k0, p));
  ok('a leaf straight above the click leaves by its nearer edge', side(after.k1, p) === 'right', side(after.k1, p));
  ok('a far leaf is still cleared', side(after.k2, p) === 'left' || side(after.k2, p) === 'right', side(after.k2, p));
  // a key blows from the line typed in: the pointer is far right, so from it both would go left
  const line = await page.evaluate(() => { const fr = document.querySelector('#sheet iframe'), r = fr.getBoundingClientRect(), k = r.width / fr.offsetWidth;
    const li = [...fr.contentDocument.querySelectorAll('.document .page li')].find(e => { const q = e.getBoundingClientRect(); return q.top > 250 && q.width > 200; }); li.dataset.typed = '1';
    const q = li.getBoundingClientRect(); return [r.left + (q.left + q.width / 2) * k, r.top + (q.top + q.height / 2) * k]; });
  await sleep(1300);      // past the last clear
  await drop(page, [[line[0] - 120, line[1] + 50], [line[0] + 120, line[1] + 50]]);
  await park(page);
  await page.evaluate(() => document.querySelector('#sheet iframe').contentDocument.querySelector('[data-typed]').dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true })));
  await settled(page);
  const typed = await named(page);
  ok('a key press blows from the line typed in: the leaves either side of it go their own ways', side(typed.k3, p) === 'left' && side(typed.k4, p) === 'right', `${side(typed.k3, p)} ${side(typed.k4, p)}`);
  // a press on the mat while resting: the leaves near it scatter, none onto the page, the far one and the rest stay as they are
  await hook(page, 'rest');
  await drop(page, [[p.l - 130, p.t + 310], [p.l - 160, p.t + 270], [p.l - 140, p.t + 660]]);
  const m0 = await named(page);
  // pressed just right of where the two near ones came down (they sway as they fall), so they scatter away from the page, not toward it
  const M = [Math.min(p.l - 20, Math.max(m0.k5.x, m0.k6.x) + 25), (m0.k5.y + m0.k6.y) / 2];
  await page.evaluate(([x, y]) => document.getElementById('pages').dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, isPrimary: true })), M);
  await sleep(2500);
  const m1 = await named(page), moved = k => Math.hypot(m1[k].x - m0[k].x, m1[k].y - m0[k].y);
  ok('a click on the mat scatters the leaves near it a little', moved('k5') > 8 && moved('k5') < 75 && moved('k6') > 8 && moved('k6') < 75, `${moved('k5').toFixed(0)} ${moved('k6').toFixed(0)} px`);
  ok('…not the far ones', m1.k7.tf === m0.k7.tf);
  ok('…none comes down on the page', side(m1.k5, p) === 'left' && side(m1.k6, p) === 'left');
  ok('…and the rest goes on: nothing fades', ['k5', 'k6', 'k7'].every(k => m1[k].o >= .95), ['k5', 'k6', 'k7'].map(k => m1[k].o).join(' '));
  s.done(); await s.context.close();
}

// ---- two pages side by side: a leaf never crosses the next page ----
async function pages(){
  const ok = reporter('pages'), s = await open(ok, { ctx: { viewport: { width: 2560, height: 1100 } } }), { page } = s;
  await ready(page);
  await page.evaluate(() => window.__wb.resumes.open('Medtech Lisboa - Mechanical Engineer.json')); await sleep(2500);
  const pp = await pagesNow(page);
  ok('two pages side by side', pp.length === 2 && pp[1].l > pp[0].r, JSON.stringify(pp));
  if (pp.length === 2){
    await park(page);
    await hook(page, 'rest');
    const [a, b] = pp, gap = b.l - a.r;
    // near the gap on page 1, the click to its left: it is blown toward page 2
    // (far enough in that a falling leaf's sway, which is in real millimetres and so wider on a big screen, doesn't set it in the gap)
    await drop(page, [[a.r - 70, a.t + 300], [a.r - 80, a.t + 420]]);
    await hook(page, 'click', a.l + 60, a.t + 360);
    await settled(page);
    const n = await named(page), where = l => !l ? 'gone' : l.x > b.l - 2 ? 'page 2 or beyond' : l.x > a.r ? 'in the gap' : l.x < a.l ? 'left of page 1' : 'on page 1';
    ok('a leaf on page 1 near the gap never ends up on or beyond page 2', ['k0', 'k1'].every(k => ['in the gap', 'left of page 1'].includes(where(n[k]))), `gap ${gap.toFixed(0)} px: ${where(n.k0)}, ${where(n.k1)}`);
  }
  s.done(); await s.context.close();
}

// ---- the snail comes only after rain: a short shower brings it out onto the wet mat ----
async function shower(){
  const ok = reporter('shower'), s = await open(ok, { ctx: { viewport: { width: 1920, height: 1000 } } }), { page } = s;
  await ready(page);
  await park(page);
  await hook(page, 'rest'); await hook(page, 'rain', 1500);
  const came = await page.waitForFunction(() => !!document.querySelector('.g-thing.g-snail'), null, { timeout: 30000 }).then(() => true, () => false);
  ok('a snail comes out after a shower', came);
  s.done(); await s.context.close();
}

// ---- petals ----
async function petals(){
  const ok = reporter('petals'), s = await open(ok), { page } = s;
  await ready(page);
  await park(page);
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
// the drink switch is in the "?" menu at the bar's foot
const switchDrink = async page => { await page.click('#rail [data-act=menu]'); await page.click('.appmenu [data-act=drink-switch]'); await page.keyboard.press('Escape'); };
async function drinks(){
  const ok = reporter('coffee'), s = await open(ok), { page } = s;
  await ready(page);
  await park(page);
  await hook(page, 'rest'); await hook(page, 'wave', 4); await hook(page, 'bug');
  await sleep(7000); await landed(page);      // (the count is taken when every leaf has come down)
  const lying = (await page.$$('#garden .g-thing.g-leaf')).length;
  await switchDrink(page); await sleep(900);
  ok('switching to coffee rests it: nothing shows', await page.evaluate(() => getComputedStyle(document.getElementById('garden')).display === 'none'));
  ok('…and the creatures have gone', (await page.$$('#garden .g-bug')).length === 0);
  await switchDrink(page); await sleep(900);
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
  const n = await open(ok, { query: '' }); await n.page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
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
    await park(page);
    await hook(page, 'rest'); await hook(page, 'wave', 5); await hook(page, 'petals'); await hook(page, 'rain'); await hook(page, 'bug'); await hook(page, 'snail'); await hook(page, 'butterfly');
    await sleep(6000);
    await page.evaluate(src);
    const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map(x => `${x.id} (${x.impact}): ${x.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`));
    ok(`axe-core, tea ${theme}, with leaves, petals, rain and creatures out`, v.length === 0, v.join(' ; '));
    await s.context.close();
  }
}

const all = { flow, sweep, key: keyClear, editing, rain, shower, creatures, bump, zoom, puff, pages, petals, pause, drinks, gates, axe };
const only = process.env.ONLY?.split(',');           // ONLY=editing,gates runs just those
await Promise.all(Object.entries(all).filter(([n]) => !only || only.includes(n)).map(([, f]) => f()));
await browser.close(); server.close();
for (const l of lines.sort()) console.log(l);
console.log(failed ? `\n${failed} FAILED` : '\nAll garden checks pass.');
process.exit(failed ? 1 : 0);
