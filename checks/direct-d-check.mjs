#!/usr/bin/env node
// node checks/direct-d-check.mjs   (one section per item)
//  1. the sidebar flash: arrow steps between lines run no CSS animation in the panel and the card never dips below full opacity ; a change of
//     panel kind runs one short opacity-only fade.
//  2. the card's top row: the toolbar 30 px tall with its 17 px tick centred; nothing of it on the page (no chip, no tools, no lists there); the add pill
//     the toolbar's height, 8 px from it.
//  3. the version button and the movers: [v2 ▾] ↑ ↓ in that order on one level in the toolbar, each readable on its face (3:1); Alt+↑ ↓ move a written
//     line, Alt+Shift+↓ opens its versions with the focus in the list.
//  3b. the version list: every version in order, the one in use marked and focused on opening; ↑ ↓ walk it, Home and End go to its ends, Enter chooses
//     (the button reads it, the list closes), Esc gives the focus back to the button.
//  4. the counts: nowhere while a line is written (not on the page, not in the sidebar, not on the version rows).
//  5. less chrome: no dimming veil at the job level and no padlock mark at a locked block's corner (the card's padlock says it).
//  6. the header guard.
//  7. at four widths nothing stands beside the written line on the page, and the card's top row fits inside the card.
// PW_BUNDLED=1, or CHROME_PATH. PORT. Writes nothing.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8491);
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
const only = process.env.ONLY?.split(',');      // ONLY=stacks,flash narrows the sections
const run = async (name, fn) => { if (only && !only.some(o => name.startsWith(o))) return; try { await fn(); } catch (e) { ok(`${name}: the section ran to its end`, false, String(e.message).split('\n').slice(0, 3).join(' ')); } };
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});
const open = async (w, h, look = []) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([d, t]) => { try { (localStorage.setItem('rb-help-seen', '1'), localStorage.setItem('rb-esc-fold', 'off')); if (d) { localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); } } catch { /* none */ } }, look);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.evaluate(() => window.__wb.edit.setAutoFold?.(false));
  await page.waitForTimeout(500);
  return { ctx, page, sheet: page.frameLocator('#sheet iframe') };
};

// ---- 1. the sidebar flash ----
await run('flash', async () => {
  const { ctx, page, sheet } = await open(1470, 832);
  await page.mouse.move(4, 4);
  await sheet.locator('.bullets li').first().click(); await page.waitForTimeout(700);
  await page.mouse.move(4, 4); await page.waitForTimeout(300);
  // a recorder: every animation that starts in the panel, and the lowest opacity the card shows, frame by frame
  await page.evaluate(() => {
    const w = window.__flash = { anims: [], low: 1, on: true };
    const body = document.querySelector('#body');
    const tick = () => { if (!w.on) return; for (const a of body.getAnimations({ subtree: true })) if (a.animationName && !w.anims.includes(a.animationName)){ w.anims.push(a.animationName); w.kf = { dur: a.effect.getTiming().duration, props: [...new Set(a.effect.getKeyframes().flatMap(k => Object.keys(k)))].filter(k => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)) }; } for (const c of [body, ...body.children]) w.low = Math.min(w.low, parseFloat(getComputedStyle(c).opacity)); requestAnimationFrame(tick); };
    tick();
  });
  for (let i = 0; i < 3; i++){ await page.keyboard.press('ArrowDown'); await page.waitForTimeout(40); }
  await page.waitForTimeout(400);
  const steps = await page.evaluate(() => ({ anims: [...window.__flash.anims], low: window.__flash.low, view: document.querySelector('#body').dataset.view }));
  ok('arrow steps between lines start no CSS animation in the panel and the card never dips below full opacity', steps.view === 'bullet' && steps.anims.length === 0 && steps.low === 1, JSON.stringify(steps));
  await page.evaluate(() => { window.__flash.anims.length = 0; window.__flash.low = 1; });
  await page.keyboard.press('Escape'); await page.waitForTimeout(40); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  const kind = await page.evaluate(() => ({ anims: [...window.__flash.anims], view: document.querySelector('#body').dataset.view, dur: [...document.styleSheets].length ? getComputedStyle(document.querySelector('#body')).animationDuration : '' }));
  ok('a change of panel kind runs one short fade, with no slide', kind.view !== 'bullet' && kind.anims.length === 1 && kind.anims[0] === 'panelIn', JSON.stringify(kind));
  const kf = await page.evaluate(() => window.__flash.kf);
  ok('the fade is opacity only and about 120 ms', !!kf && kf.props.join() === 'opacity' && kf.dur >= 100 && kf.dur <= 140, JSON.stringify(kf));
  await ctx.close();
});

// ---- 2. the card's top row ----
for (const look of [['tea', 'light'], ['coffee', 'dark']]) await run(`top ${look}`, async () => {
  const tag = look.join(' ');
  const { ctx, page, sheet } = await open(1470, 832, look);
  await sheet.locator('.band[data-section=experience] .entry:first-child .bullets li').nth(1).click(); await page.waitForTimeout(600);
  await page.keyboard.press('Escape'); await page.mouse.move(4, 4); await page.waitForTimeout(600);
  const g = await page.evaluate(() => { const c = document.querySelector('#body .ctop .cchip'), t = c?.querySelector('.dp-show .pillsw'), add = document.querySelector('#body .ctop .cadd'); if (!c || !t) return null; const a = c.getBoundingClientRect(), b = t.getBoundingClientRect(), d = add?.getBoundingClientRect();
    return { h: a.height, top: b.top - a.top, bottom: a.bottom - b.bottom, tw: b.width, th: b.height, add: d && { h: d.height, gap: Math.round(d.left - a.right), level: Math.abs(d.top - a.top) < .5 } }; });
  ok(`${tag}: the card's toolbar is 30 px tall and its 17 px tick sits centred in it (within 0.5)`, !!g && g.h === 30 && g.tw === 17 && g.th === 17 && Math.abs(g.top - g.bottom) <= .5, JSON.stringify(g));
  ok(`${tag}: …the add pill beside it is as tall, on the same level, 8 px from it`, !!g?.add && g.add.h === g.h && g.add.level && g.add.gap === 8, JSON.stringify(g?.add));
  ok(`${tag}: nothing of it is on the page: no chip, no tools, no lists`, await page.evaluate(() => !document.querySelector('#editlay .obchip, #editlay .obtools, #editlay .obtoolswrap, #editlay .dplist, #editlay [aria-haspopup]')));
  await ctx.close();
});

// ---- 3 and 4. the version button, the movers and the counts ----
for (const look of [['tea', 'light'], ['tea', 'dark'], ['coffee', 'light'], ['coffee', 'dark']]) await run(`pill ${look}`, async () => {
  const tag = look.join(' ');
  const { ctx, page, sheet } = await open(1470, 832, look);
  const LI = '.band[data-section=experience] .entry:first-child .bullets li';
  await sheet.locator(LI).nth(1).click(); await page.waitForTimeout(900);
  const g = await page.evaluate(() => {
    const q = s => document.querySelector(`#body .ctop ${s}`), cs = e => getComputedStyle(e), r = e => e.getBoundingClientRect(), vers = q('.cver'), up = q('.cmv[data-d="-1"]'), down = q('.cmv[data-d="1"]');
    if (!vers || !up || !down) return null;
    const px = c => { const k = document.createElement('canvas').getContext('2d'); k.fillStyle = '#fff'; k.fillRect(0, 0, 1, 1); k.fillStyle = c; k.fillRect(0, 0, 1, 1); return [...k.getImageData(0, 0, 1, 1).data]; };
    const lin = v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4, Lp = p => .2126 * lin(p[0] / 255) + .7152 * lin(p[1] / 255) + .0722 * lin(p[2] / 255), cr = (a, b) => (Math.max(Lp(a), Lp(b)) + .05) / (Math.min(Lp(a), Lp(b)) + .05);
    const faceOf = e => { for (let n = e; n && n !== document.documentElement; n = n.parentElement){ const c = cs(n).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return px(c); } return px(cs(document.body).backgroundColor); };
    const part = e => { const icon = e.querySelector('svg'), f = faceOf(e), p = px(cs(e).color), a = icon ? +cs(icon).opacity : 1; return { contrast: +cr([0, 1, 2].map(i => Math.round(p[i] * a + f[i] * (1 - a))), f).toFixed(2), off: e.getAttribute('aria-disabled') === 'true' }; };
    return { order: r(vers).left < r(up).left && r(up).left < r(down).left, mid: [vers, up, down].map(e => Math.round((r(e).top + r(e).bottom) / 2)), parts: { vers: part(vers), up: part(up), down: part(down) }, caret: !!vers.querySelector('svg') };
  });
  ok(`${tag}: the version button, ↑ and ↓ stand in the toolbar in that order, level with each other`, !!g && g.order && Math.max(...g.mid) - Math.min(...g.mid) <= 1, JSON.stringify(g));
  ok(`${tag}: …each reads on its face (3 to 1), and the version button has a caret`, !!g && g.caret && Object.values(g.parts).every(c => c.off || c.contrast >= 3), JSON.stringify(g?.parts));
  ok(`${tag}: no counts while a line is written: not beside it on the page, not under the text in the sidebar, not on the version rows`, await page.evaluate(() => !!window.__wb.ui.writing && !document.querySelector('#editlay #ob-stats, #editlay .obstats, #body #ed-stats, #body .mt2') && !/\d+ ch\b/.test(document.querySelector('#body').textContent)));
  if (look[0] === 'tea' && look[1] === 'light'){
    const texts = () => sheet.locator(LI).allTextContents();
    const t0 = (await texts()).map(x => x.trim());
    await page.keyboard.press('Alt+ArrowDown'); await page.waitForTimeout(900);
    const t1 = (await texts()).map(x => x.trim());
    ok(`${tag}: Alt+↓ moves the line being written down (not the version list)`, t1.join() !== t0.join() && [...t1].sort().join() === [...t0].sort().join() && !await page.evaluate(() => document.querySelector('#body .cvlist:not([hidden])')), JSON.stringify([t0.map(x => x.slice(0, 12)), t1.map(x => x.slice(0, 12))]));
    await page.keyboard.press('Alt+ArrowUp'); await page.waitForTimeout(900);
    ok(`${tag}: Alt+↑ moves it back up`, (await texts()).map(x => x.trim()).join() === t0.join());
    await page.keyboard.press('Alt+Shift+ArrowDown'); await page.waitForTimeout(500);
    ok(`${tag}: Alt+Shift+↓ opens the version list with the focus in it`, await page.evaluate(() => !!document.querySelector('#body .cvlist:not([hidden])') && !!document.activeElement?.closest('.cvlist')));
  }
  if (!await page.evaluate(() => !!document.querySelector('#body .cvlist:not([hidden])'))){ await page.click('#body .ctop .cver'); await page.waitForTimeout(400); }
  const lf = await page.evaluate(() => {
    const px = c => { const k = document.createElement('canvas').getContext('2d'); k.fillStyle = '#fff'; k.fillRect(0, 0, 1, 1); k.fillStyle = c; k.fillRect(0, 0, 1, 1); return [...k.getImageData(0, 0, 1, 1).data]; };
    const lin = v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4, Lp = p => .2126 * lin(p[0] / 255) + .7152 * lin(p[1] / 255) + .0722 * lin(p[2] / 255);
    const l = document.querySelector('#body .cvlist:not([hidden])'), o = l?.querySelector('.cvo b'); if (!l || !o) return null;
    const a = Lp(px(getComputedStyle(l).backgroundColor)), b = Lp(px(getComputedStyle(o).color));
    return { contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), opaque: !/rgba\(.*, 0\)|transparent/.test(getComputedStyle(l).backgroundColor) };
  });
  ok(`${tag}: the version list has a face of its own and its numbers read at 4.5:1 on it`, !!lf && lf.opaque && lf.contrast >= 4.5, JSON.stringify(lf));
  await ctx.close();
});

// ---- 3b. the version list ----
await run('versions', async () => {
  const { ctx, page, sheet } = await open(1470, 832);
  const LIS = '.band[data-section=experience] .bullets li';
  const state = () => page.evaluate(() => { const l = document.querySelector('#body .cvlist'), n = o => o.querySelector('b')?.textContent.trim();
    return { button: document.querySelector('#body .ctop .cver')?.textContent.trim(), open: l?.hidden === false, opts: [...(l?.querySelectorAll('.cvo') ?? [])].map(n), cur: [...(l?.querySelectorAll('.cvo[aria-selected=true]') ?? [])].map(n), focus: document.activeElement?.closest('.cvo') ? n(document.activeElement) : document.activeElement?.className ?? null }; });
  await sheet.locator(LIS).nth(1).click(); await page.waitForTimeout(500); await page.keyboard.press('Escape'); await page.mouse.move(4, 4); await page.waitForTimeout(300);
  await page.click('#body .ctop .cver'); await page.waitForTimeout(300);
  const s0 = await state(), num = v => v.slice(1).split('.').map(Number), asc = a => a.every((x, i) => !i || num(x)[0] > num(a[i - 1])[0] || (num(x)[0] === num(a[i - 1])[0] && (num(x)[1] ?? 0) >= (num(a[i - 1])[1] ?? 0)));
  ok('versions: the list holds every version in order, the one in use marked once, the button reading it, and the focus on it', s0.open && s0.opts.length >= 2 && asc(s0.opts) && s0.cur.length === 1 && s0.button.startsWith(s0.cur[0]) && s0.focus === s0.cur[0], JSON.stringify(s0));
  const key = async k => { await page.keyboard.press(k); await page.waitForTimeout(120); return (await state()).focus; };
  const at = s0.opts.indexOf(s0.cur[0]);
  const trail = [await key('ArrowDown'), await key('ArrowUp')];
  ok('versions: ↓ goes to the next version, ↑ back', trail[0] === (s0.opts[at + 1] ?? s0.opts[at]) && trail[1] === s0.cur[0], JSON.stringify({ trail, s0 }));
  ok('versions: Home is the first and End the last', (await key('Home')) === s0.opts[0] && (await key('End')) === s0.opts.at(-1));
  await page.keyboard.press('Enter'); await page.waitForTimeout(700);
  const s1 = await state();
  ok('versions: Enter chooses it: the button reads it and the list is closed', !s1.open && s1.button.startsWith(s0.opts.at(-1)), JSON.stringify(s1));
  await page.click('#body .ctop .cver'); await page.waitForTimeout(300); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok('versions: Esc closes it and gives the focus back to the button', await page.evaluate(() => document.querySelector('#body .cvlist').hidden && document.activeElement?.classList.contains('cver')));
  await ctx.close();
});

// ---- 3c. a lock explains itself by moving, never by a text window ----
await run('lock', async () => {
  const { ctx, page, sheet } = await open(1470, 832);
  await page.evaluate(() => window.__wb.edit.setGuard?.(true));
  const after = async (what, act) => {
    await page.evaluate(() => { window.__wb.motion.stats.names.length = 0; });
    await act(); await page.waitForTimeout(120);
    return page.evaluate(sel => ({ names: [...new Set(window.__wb.motion.stats.names)].filter(n => n.startsWith('lock:')), running: !!document.querySelector(sel)?.getAnimations().length, tip: [...document.querySelectorAll('.obtip, [role=tooltip]')].some(e => !e.hidden && e.textContent.trim()), toast: !!document.querySelector('#toast.on.warn'), titled: [...document.querySelectorAll('#editlay [title], #editlay .obsoft')].some(e => (e.title ?? '').split(' ').length > 2) }), what);
  };
  // a guarded line (the name): the first click turns its small lock in; the lock rings and the plate flashes, no bubble and no title sentence
  const g = await after('#editlay .obsoft', () => sheet.locator('.name').first().click());
  ok('lock: a click on a guarded line animates its lock (it runs an animation: a ring) and flashes the plate; no text window, no toast, no title sentence', g.running && g.names.includes('lock:ring') && g.names.includes('lock:flash') && !g.tip && !g.toast && !g.titled, JSON.stringify(g));
  ok('lock: …and the lock has a name for a screen reader and no title', await page.evaluate(() => { const b = document.querySelector('#editlay .obsoft'); return !!b && !!b.getAttribute('aria-label') && !b.hasAttribute('title'); }));
  // a locked line: the padlock on the chip wobbles with a ring and the plate flashes; the toast is only for a lock that is off screen
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.click('#outline .srow[data-sid=experience] [data-act=row-lock]'); await page.waitForTimeout(500);
  const k = await after('#body .ctop .dp-lock', () => sheet.locator('.band[data-section=experience] .bullets li').first().click());
  ok('lock: a click on a locked line wobbles the card\'s padlock (a running animation, a ring) and flashes the plate; no text window and no toast while a lock is on screen', k.running && ['lock:shake', 'lock:ring', 'lock:flash'].every(n => k.names.includes(n)) && !k.tip && !k.toast, JSON.stringify(k));
  await ctx.close();
});

// ---- 5. less chrome ----
await run('chrome', async () => {
  const { ctx, page } = await open(1470, 832);
  await page.click('#outline [data-act=select-section][data-id=experience]'); await page.waitForTimeout(400);
  await page.click('#body [data-act=select-job][data-id=hydra]'); await page.waitForTimeout(900);
  await page.mouse.move(4, 4); await page.waitForTimeout(300);
  ok('a job is selected and the page is not dimmed: there is no veil in the page layer', await page.evaluate(() => window.__wb.ui.sel.kind === 'job' && !!document.querySelector('#body .ctop') && !document.querySelector('#editlay .obveil')));
  await page.click('#body .ctop .dp-lock'); await page.waitForTimeout(700);
  ok('a locked block has no padlock mark at its corner: the card’s padlock is pressed and says it', await page.evaluate(() => document.querySelector('#body .ctop .dp-lock')?.getAttribute('aria-pressed') === 'true' && !document.querySelector('#editlay .oblockmark')));
  await ctx.close();
});

// ---- 6. the header guard ----
await run('guard', async () => {
  const { ctx, page, sheet } = await open(1470, 832);
  const st = () => page.evaluate(() => ({ kind: window.__wb.ui.sel.kind, id: window.__wb.ui.sel.id, editing: window.__wb.edit.editing?.fact ?? null, body: document.querySelector('#body').dataset.view }));
  const title = sheet.locator('.entry .role-title').first(), tb = await title.boundingBox();
  await title.click({ position: { x: tb.width - 4, y: 6 } }); await page.waitForTimeout(700);
  const a = await st();
  ok('a click on a job’s title beside its words selects the job (its sidebar) and does not open writing', a.kind === 'job' && a.editing === null && a.body === 'job', JSON.stringify(a));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await title.click({ position: { x: 20, y: 6 } }); await page.waitForTimeout(700);
  const b = await st();
  ok('a click on its words opens the title for writing at once', /-position$/.test(b.id) && b.editing === b.id, JSON.stringify(b));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await page.evaluate(() => window.__wb.edit.setGuard(false));
  await title.click({ position: { x: 20, y: 6 } }); await page.waitForTimeout(700);
  const c = await st();
  ok('with the guard off (as the checks open it) one click on the words writes the title too', /-position$/.test(c.id) && c.editing === c.id, JSON.stringify(c));
  await ctx.close();
});

// ---- 7. a written line has nothing beside it on the page; the card's top row fits the card ----
for (const [w, h] of [[1470, 832], [1100, 720], [900, 700], [800, 700]]) await run(`tools ${w}`, async () => {
  const { ctx, page, sheet } = await open(w, h);
  await sheet.locator('.band[data-section=experience] .entry:first-child .bullets li').nth(1).click(); await page.waitForTimeout(1200); await page.mouse.move(4, 4); await page.waitForTimeout(300);
  const g = await page.evaluate(() => { const b = document.querySelector('#body').getBoundingClientRect(), t = document.querySelector('#body .ctop')?.getBoundingClientRect(); return { writing: !!window.__wb.ui.writing, lay: [...document.querySelectorAll('#editlay > *')].filter(e => !e.hidden && e.getBoundingClientRect().width).map(e => e.className), row: t && { l: t.left - b.left, r: b.right - t.right } }; });
  ok(`${w}: a line is written and nothing stands beside it on the page`, g.writing && !g.lay.some(c => /obtools|obchip|obv/.test(c)), JSON.stringify(g));
  ok(`${w}: the card's top row fits inside the card`, !!g.row && g.row.l >= 0 && g.row.r >= 0, JSON.stringify(g.row));
  await ctx.close();
});

server.close(); await browser.close();
console.log(failed ? `${failed} check(s) FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
