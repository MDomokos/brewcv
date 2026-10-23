#!/usr/bin/env node
// node checks/direct-d-check.mjs   (builder D of UX-6 direct editing, round 2; one section per item)
//  1. the sidebar flash: arrow steps between lines run no CSS animation in the panel and the card never dips below full opacity ; a change of
//     panel kind runs one short opacity-only fade.
//  2. the chip: 26 px tall with the tick centred (page and card), the page chip on the page's paper, no lists on the page, and the "back" button
//     (a small icon-only ↩ AFTER the tools, not a crumb: shows after going up the same branch, returns to the depth left, expires, is cleared by another
//     selection; never after a move into another section or job: arrows, a click elsewhere).
//  3. the version pill and the movers: one row [v2 ▾] ↑ ↓ at the right of the written line, joined in ONE control with an opaque face (icons and text 3:1 on it) and an edge that shows in all
//     four looks; Alt+↑ ↓ move the line, Alt+Shift+↓ opens the versions.
//  3b. the version list: the lower numbers stack above the pill, the higher below it, the one in use is the pill (not repeated), the pill does not move, the arrows
//     cross the gap (Up to the next lower, Down to the next higher), Home/End the lowest/highest; no stack where there is no version that side.
//  4. the counts: nowhere while a line is written (not on the page, not in the sidebar, not on the version rows).
//  5. less chrome: no dimming veil at the job level and no padlock mark at a locked block's corner (the chip's padlock says it).
//  6. the header guard.
//  7. the tools row stays right of the line: its arrows may slide under the sidebar, the pill never half; when the pill would be covered the whole row goes left, in order.
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
  await ctx.addInitScript(([d, t]) => { try { localStorage.setItem('rb-help-seen', '1'); if (d) { localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); } } catch { /* none */ } }, look);
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

// ---- 2. the chip ----
for (const look of [['tea', 'light'], ['coffee', 'dark']]) await run(`chip ${look}`, async () => {
  const tag = look.join(' ');
  const { ctx, page, sheet } = await open(1470, 832, look);
  await sheet.locator('.band[data-section=experience] .entry:first-child .bullets li').nth(1).click(); await page.waitForTimeout(600);
  await page.keyboard.press('Escape'); await page.mouse.move(4, 4); await page.waitForTimeout(600);
  const geom = sel => page.evaluate(s => { const c = document.querySelector(s), t = c?.querySelector('.dp-show .pillsw'); if (!c || !t) return null; const a = c.getBoundingClientRect(), b = t.getBoundingClientRect(); return { h: a.height, top: b.top - a.top - 1, bottom: a.bottom - 1 - b.bottom, tw: b.width, th: b.height }; }, sel);
  for (const [name, sel] of [['page', '#editlay .obchip .depth'], ['card', '#body .depth']]){
    const g = await geom(sel);
    ok(`${tag}: the ${name} chip is 26 px tall and its 17 px tick sits centred in it (3.5 px above and below, within 0.5)`, !!g && g.h === 26 && g.tw === 17 && g.th === 17 && Math.abs(g.top - 3.5) <= .5 && Math.abs(g.bottom - 3.5) <= .5, JSON.stringify(g));
  }
  ok(`${tag}: the page chip is on the page's paper with the paper's ink; the card's tab is the same paper and ink, attached (J, rewritten: it kept the sidebar surface)`, await page.evaluate(() => { const col = v => { const e = document.createElement('i'); e.style.cssText = `background:${v};color:${v}`; document.body.append(e); const c = getComputedStyle(e).backgroundColor; e.remove(); return c; }; const p = getComputedStyle(document.querySelector('#editlay .obchip .depth')), k = getComputedStyle(document.querySelector('#body .depth')), cur = getComputedStyle(document.querySelector('#editlay .obchip .dp-l.cur')); return p.backgroundColor === col('var(--paper)') && cur.color === col('var(--paper-ink)') && k.backgroundColor === p.backgroundColor && getComputedStyle(document.querySelector('#body .depth .dp-l.cur')).color === cur.color && !!document.querySelector('#body .hdr > .depth'); }));
  ok(`${tag}: the page chip has no per-level list`, await page.evaluate(() => !document.querySelector('#editlay .dplist, #editlay .dpwrap, #editlay [aria-haspopup]')));
  // the "back" button
  const sel0 = await page.evaluate(() => JSON.stringify(window.__wb.ui.sel));
  await page.click('#editlay .obchip .dp-l >> nth=1'); await page.waitForTimeout(300);
  const up = await page.evaluate(() => ({ sel: window.__wb.ui.sel.kind, back: document.querySelector('#editlay .dp-back')?.textContent ?? null }));
  const upBack = () => page.evaluate(() => { const c = document.querySelector('#editlay .obchip .depth'), b = c?.querySelector('.dp-back'); return b ? { text: b.textContent.trim(), label: b.getAttribute('aria-label'), crumb: !!b.closest('.dp-l') || b.classList.contains('dp-l'), icon: !!b.querySelector('svg'), after: !!c.querySelector('.dp-tools') && !!(c.querySelector('.dp-tools').compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) } : null; });
  const ub = await upBack();
  ok(`${tag}: a word on the page chip goes up and a small icon-only ↩ appears AFTER the tools, named for the level left (not a crumb)`, up.sel === 'section' && !!ub && ub.icon && ub.text === '' && !ub.crumb && ub.after && /\S/.test(ub.label ?? ''), JSON.stringify(ub));
  await page.click('#editlay .dp-back'); await page.waitForTimeout(300);
  ok(`${tag}: "back" returns to the depth left, and goes away`, (await page.evaluate(() => JSON.stringify(window.__wb.ui.sel))) === sel0 && await page.evaluate(() => !document.querySelector('#editlay .dp-back')));
  await page.click('#editlay .obchip .dp-l >> nth=1'); await page.waitForTimeout(2200);
  const still = await page.evaluate(() => !!document.querySelector('#editlay .dp-back'));
  await page.waitForTimeout(700);
  ok(`${tag}: "back" stays for about 2.5 s and then expires`, still && await page.evaluate(() => !document.querySelector('#editlay .dp-back') && !window.__wb.ui.back));
  await page.click('#editlay .obchip .dp-l >> nth=1'); await page.waitForTimeout(200);
  await sheet.locator('.band[data-section=experience] .entry:first-child .bullets li').nth(2).click(); await page.waitForTimeout(500);
  ok(`${tag}: any other selection clears "back"`, await page.evaluate(() => !window.__wb.ui.back && !document.querySelector('#editlay .dp-back')));
  // the "+" is below the chip: where their rects meet the chip is the topmost thing (the chip is in #editlay, the "+" in #handlay)
  await sheet.locator('.band[data-section=experience] .entry:first-child .bullets li').nth(1).click(); await page.waitForTimeout(500);
  const top = await page.evaluate(() => { const c = document.querySelector('#editlay .obchip'), p = document.querySelector('#handlay .obplus'); if (!c || !p) return null; const r = c.getBoundingClientRect(); p.hidden = false; p.style.left = `${r.left + r.width / 2 - 12}px`; p.style.top = `${r.top + r.height / 2 - 12}px`; const q = p.getBoundingClientRect(), x = Math.max(r.left, q.left) + 2, y = Math.max(r.top, q.top) + 2, e = document.elementFromPoint(x, y); return { overlap: x < Math.min(r.right, q.right) && y < Math.min(r.bottom, q.bottom), chipOnTop: !!e?.closest('.obchip'), hit: e?.className?.toString?.() }; });
  ok(`${tag}: where the chip and the "+" overlap the chip is the topmost element (elementFromPoint)`, !!top && top.overlap && top.chipOnTop, JSON.stringify(top));
  // a move sideways is not "going up": no back control and a chip that names where you are (the reproduced bug: "Page > Skills > ↩ Medisure")
  const words = () => page.$$eval('#editlay .obchip .dp-l .dp-w', e => e.map(x => x.textContent).join(' > '));
  const noBack = () => page.evaluate(() => !window.__wb.ui.back && !document.querySelector('#editlay .dp-back'));
  await sheet.locator('.band[data-section=experience] .entry:last-child .bullets li').last().click(); await page.waitForTimeout(500);
  let trail = [];
  for (let i = 0; i < 4; i++){ await page.keyboard.press('ArrowDown'); await page.waitForTimeout(450); trail.push(await words()); if (!await noBack()) trail.push('BACK'); }      // (a long last line takes one step to its end)
  ok(`${tag}: ArrowDown from the last Experience bullet into Skills: the chip reads "Page > Skills" then "Page > Skills > CAD", never a back control on the way`, trail.includes('Page > Skills > CAD') && !trail.includes('BACK') && trail.every(w => !/↩/.test(w)), trail.join(' | '));
  ok(`${tag}: …and it is Skills now (so the next click leaves it)`, /^Page > Skills/.test(await words()), await words());
  await sheet.locator('.band[data-section=education] h2.tab').first().click(); await page.waitForTimeout(500);
  ok(`${tag}: the Education heading clicked from Skills: the chip reads "Page > Education" with no back control`, (await words()) === 'Page > Education' && await noBack(), await words());
  await sheet.locator('.band[data-section=experience] .entry:first-child .bullets li').nth(1).click(); await page.waitForTimeout(500);
  const job = (await page.$$eval('#editlay .obchip .dp-l .dp-w', e => e.map(x => x.textContent)))[2];
  await page.click(`#editlay .obchip .dp-l >> nth=2`); await page.waitForTimeout(300);
  ok(`${tag}: the job word ("${job}") clicked from one of its bullets: the back control appears and returns to the bullet`, !!(await upBack()));
  await page.click('#editlay .dp-back'); await page.waitForTimeout(300);
  ok(`${tag}: …and it returns to the line`, await page.evaluate(() => window.__wb.ui.sel.kind === 'bullet') && await noBack());
  await ctx.close();
});

// ---- 3 and 4. the pill, the movers and the counts ----
for (const look of [['tea', 'light'], ['tea', 'dark'], ['coffee', 'light'], ['coffee', 'dark']]) await run(`pill ${look}`, async () => {
  const tag = look.join(' ');
  const { ctx, page, sheet } = await open(1470, 832, look);
  const LI = '.band[data-section=experience] .entry:first-child .bullets li';
  await sheet.locator(LI).nth(1).click(); await page.waitForTimeout(500);
  await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  const g = await page.evaluate(() => {
    const q = s => document.querySelector(`#editlay ${s}`), cs = e => getComputedStyle(e), r = e => e.getBoundingClientRect(), tagEl = q('.obv'), bar = q('.obtools'), up = q('[data-act=ob-up]'), down = q('[data-act=ob-down]');
    if (!tagEl || !up || !down) return null;
    const px = c => { const k = document.createElement('canvas').getContext('2d'); k.fillStyle = c; k.fillRect(0, 0, 1, 1); return [...k.getImageData(0, 0, 1, 1).data]; };
    const lum = ([R, G, B]) => .2126 * R / 255 + .7152 * G / 255 + .0722 * B / 255, lin = v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    const L = c => { const p = px(c); return .2126 * lin(p[0] / 255) + .7152 * lin(p[1] / 255) + .0722 * lin(p[2] / 255); }, cr = (a, b) => (Math.max(L(a), L(b)) + .05) / (Math.min(L(a), L(b)) + .05);
    const probe = document.createElement('i'); probe.style.background = 'var(--paper)'; document.body.append(probe); const paper = cs(probe).backgroundColor; probe.remove();
    const ring = cs(bar).boxShadow.match(/(rgba?|color)\([^)]*\)/)?.[0] ?? '';
    // the control is ONE face (the bar's); what each part is drawn on is its nearest opaque background (the desk, where there is none: the base's arrows had none)
    const faceOf = e => { for (let n = e; n && n !== document.documentElement; n = n.parentElement){ const p = px(cs(n).backgroundColor); if (p[3] === 255) return { p, own: n === bar }; } return { p: px(cs(document.body).backgroundColor), own: false }; };
    const Lp = p => .2126 * lin(p[0] / 255) + .7152 * lin(p[1] / 255) + .0722 * lin(p[2] / 255), crp = (a, b) => (Math.max(Lp(a), Lp(b)) + .05) / (Math.min(Lp(a), Lp(b)) + .05);
    const ink = (c, op, f) => { const p = px(c), a = p[3] / 255 * op; return [0, 1, 2].map(i => Math.round(p[i] * a + f[i] * (1 - a))); };
    const part = (e, svg) => { const f = faceOf(e), icon = svg && e.querySelector('svg'); return { onBar: f.own, contrast: +crp(ink(cs(e).color, icon ? +cs(icon).opacity : 1, f.p), f.p).toFixed(2), off: e.getAttribute('aria-disabled') === 'true' }; };
    return { contrast: { pill: part(tagEl, false), up: part(up, true), down: part(down, true) }, faceAlpha: px(cs(bar).backgroundColor)[3], pillL: r(tagEl).left, upL: r(up).left, downL: r(down).left, mid: [tagEl, up, down].map(e => Math.round((r(e).top + r(e).bottom) / 2)), alpha: px(cs(bar).backgroundColor)[3], face: cr(cs(bar).backgroundColor, paper), edge: ring ? cr(ring, paper) : 0, h: r(tagEl).height, caret: cs(tagEl, '::after').content !== 'none', stats: !!document.querySelector('#editlay #ob-stats, #editlay .obstats') };
  });
  ok(`${tag}: ↑ and ↓ stand on one row with the version pill, in that order, level with each other`, !!g && g.pillL < g.upL && g.upL < g.downL && Math.max(...g.mid) - Math.min(...g.mid) <= 1, JSON.stringify(g));
  ok(`${tag}: the pill, ↑ and ↓ are ONE control with one opaque face: each part is drawn on it, and its text and icons keep 3 to 1 against it (so they read over the paper and over the desk alike)`, !!g && g.faceAlpha === 255 && Object.values(g.contrast).every(c => c.onBar && (c.off || c.contrast >= 3)), JSON.stringify(g));
  ok(`${tag}: the control has an opaque face and a thin edge that show against the paper at rest, and the pill a caret`, !!g && g.alpha === 255 && g.face > 1.03 && g.edge >= 1.5 && g.h >= 28 && g.caret, JSON.stringify(g));
  ok(`${tag}: no counts while a line is written: not beside it on the page, not under the text in the sidebar, not on the version rows`, !!g && !g.stats && await page.evaluate(() => !document.querySelector('#editlay #ob-stats, #editlay .obstats, #body #ed-stats, #body .mt2') && !/\d+ ch\b/.test(document.querySelector('#body').textContent)));
  if (look[0] === 'tea' && look[1] === 'light'){
    const texts = () => sheet.locator(LI).allTextContents();
    const t0 = (await texts()).map(x => x.trim());
    await page.keyboard.press('Alt+ArrowDown'); await page.waitForTimeout(900);
    const t1 = (await texts()).map(x => x.trim());
    ok(`${tag}: Alt+↓ moves the line being written down (not the version list)`, t1.join() !== t0.join() && [...t1].sort().join() === [...t0].sort().join() && !await page.evaluate(() => document.querySelector('#editlay .obvlist:not([hidden])')), JSON.stringify([t0.map(x => x.slice(0, 12)), t1.map(x => x.slice(0, 12))]));
    await page.keyboard.press('Alt+ArrowUp'); await page.waitForTimeout(900);
    ok(`${tag}: Alt+↑ moves it back up`, (await texts()).map(x => x.trim()).join() === t0.join());
    await page.keyboard.press('Alt+Shift+ArrowDown'); await page.waitForTimeout(500);
    ok(`${tag}: Alt+Shift+↓ opens the version list with the focus in it`, await page.evaluate(() => !!document.querySelector('#editlay .obvlist:not([hidden])') && document.activeElement?.classList.contains('obvlist')));
  }
  // the list (each stack of it) is the pill opened: the pill's own face (the bar's, from the plate tokens) and the paper's ink, in all four looks
  if (!await page.evaluate(() => !!document.querySelector('#editlay .obvlist:not([hidden])'))){ await page.keyboard.press('Alt+Shift+ArrowDown'); await page.waitForTimeout(500); }
  const lf = await page.evaluate(() => {
    const px = c => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(v => (/^color\(/.test(c) ? v * 255 : v)), lum = p => { const f = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(p[0]) + .7152 * f(p[1]) + .0722 * f(p[2]); };
    const cs = e => getComputedStyle(e), bar = document.querySelector('#editlay .obtools'), l = document.querySelector('#editlay .obvlist:not([hidden]) .obvstack'); if (!bar || !l) return null;
    const face = px(cs(l).backgroundColor), want = px(cs(bar).backgroundColor), ink = px(cs(l.querySelector('.obvopt')).color), [a, b] = [lum(face), lum(ink)];
    return { delta: Math.max(...face.map((v, i) => Math.abs(v - want[i]))), contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), radius: Math.max(...['TopLeft', 'BottomLeft'].map(c => parseFloat(cs(l)[`border${c}Radius`]))) > 0, alpha: px(cs(l).backgroundColor).length === 3 && !/,\s*0\)$/.test(cs(l).backgroundColor), raised: cs(l).backgroundColor === (() => { const e = document.createElement('i'); e.style.background = 'var(--raised)'; document.body.append(e); const c = cs(e).backgroundColor; e.remove(); return c; })() };
  });
  ok(`${tag}: the version list has the pill's face (within 3 per channel), its corner, and text at 4.5:1 on it`, !!lf && lf.delta <= 3 && lf.radius && lf.contrast >= 4.5 && !lf.raised, JSON.stringify(lf));
  await ctx.close();
});

// ---- 3b. the version list is two stacks round the pill ----
await run('stacks', async () => {
  const { ctx, page, sheet } = await open(1470, 832);
  const LIS = '.band[data-section=experience] .bullets li';
  const state = () => page.evaluate(() => { const l = document.querySelector('#editlay .obvlist'), pill = document.querySelector('#editlay .obv[aria-haspopup]'), r = e => { const q = e?.getBoundingClientRect(); return q && { top: Math.round(q.top), bottom: Math.round(q.bottom), left: Math.round(q.left) }; }, txt = s => [...(l?.querySelectorAll(`.obvstack.${s} .obvopt`) ?? [])].map(o => o.textContent.trim());
    return { pill: pill?.textContent.trim(), pillRect: r(pill), up: txt('up'), dn: txt('dn'), upBox: r(l?.querySelector('.obvstack.up')), dnBox: r(l?.querySelector('.obvstack.dn')), act: l?.querySelector('.act')?.textContent.trim() ?? null, open: l?.hidden === false }; });
  const hold = async i => { await sheet.locator(LIS).nth(i).click(); await page.waitForTimeout(500); await page.mouse.move(4, 4); await page.waitForTimeout(200); return state(); };
  // a line in the middle of its versions
  const rest0 = await hold(0);
  await page.keyboard.press('Alt+Shift+ArrowDown'); await page.waitForTimeout(400);
  const s0 = await state();
  ok('stacks: the list opens round the pill, which does not move; the pill\'s own number is in neither stack', s0.open && JSON.stringify(s0.pillRect) === JSON.stringify(rest0.pillRect) && ![...s0.up, ...s0.dn].includes(s0.pill), JSON.stringify({ rest0, s0 }));
  const asc = a => a.every((x, i) => !i || (x.slice(1).split('.').map(Number)[0] - a[i - 1].slice(1).split('.').map(Number)[0]) >= 0);
  ok('stacks: the lower numbers stack above the pill and the higher below, ascending top to bottom (the nearest lower directly above, the nearest higher directly below)', s0.up.length >= 1 && s0.dn.length >= 1 && asc([...s0.up, s0.pill, ...s0.dn]) && Math.abs(s0.upBox.bottom - s0.pillRect.top) <= 2 && Math.abs(s0.dnBox.top - s0.pillRect.bottom) <= 2, JSON.stringify(s0));
  // ONE continuous column as wide as the version pill: the upper stack, the pill and the lower stack share left and right edges and a face; the outer corners are the plate's, at the top
  // and the bottom of the whole, the joins are square; the column is lifted (a shadow) and topmost; the arrows stay beside the pill, outside the column
  const colm = await page.evaluate(() => {
    const cs = e => getComputedStyle(e), r = e => e.getBoundingClientRect(), bar = document.querySelector('#editlay .obtools'), pill = bar.querySelector('.obv'), up = bar.querySelector('.obvstack.up'), dn = bar.querySelector('.obvstack.dn'), wrap = pill.closest('.obvwrap');
    const rad = (e, c) => parseFloat(cs(e)[`border${c}Radius`]), top = (e, sel) => { const q = r(e), el = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return !!el?.closest(sel); };
    const opts = [...bar.querySelectorAll('.obvopt')], arrows = [...bar.querySelectorAll('[data-act=ob-up], [data-act=ob-down]')].map(r);
    return { edges: [up, pill, dn].map(e => [Math.round(r(e).left * 2) / 2, Math.round(r(e).right * 2) / 2].join()), outer: [rad(up, 'TopLeft'), rad(up, 'TopRight'), rad(dn, 'BottomLeft'), rad(dn, 'BottomRight')], joins: [rad(up, 'BottomLeft'), rad(up, 'BottomRight'), rad(dn, 'TopLeft'), rad(dn, 'TopRight'), rad(pill, 'TopLeft'), rad(pill, 'BottomLeft'), rad(pill, 'TopRight'), rad(pill, 'BottomRight'), rad(bar, 'TopLeft'), rad(bar, 'BottomLeft'), ...opts.map(o => rad(o, 'TopLeft'))], shadow: cs(up).boxShadow !== 'none' && cs(wrap).filter !== 'none', topmost: top(up, '.obvstack') && top(dn, '.obvstack') && top(pill, '.obv'), face: cs(up).backgroundColor === cs(dn).backgroundColor, z: parseInt(cs(bar.closest('.obtoolswrap')).zIndex), arrowsOutside: arrows.length === 2 && arrows.every(a => a.left >= r(pill).right - .5 && Math.abs(a.top - r(bar).top) < 1.5), pillRight: r(pill).right, upRight: r(up).right };
  });
  ok('stacks: the open control is one column as wide as the pill: the stacks and the pill have the same left and right edges', new Set(colm.edges).size === 1, JSON.stringify(colm.edges));
  ok('stacks: the outer corners (top of the whole, bottom of the whole) carry the plate radius and every inner join is square', colm.outer.every(x => x > 0 && x === colm.outer[0]) && colm.joins.every(x => x === 0), JSON.stringify(colm));
  ok('stacks: the column is one face, lifted (a shadow), above the other marks (z-index) and the topmost thing at its centre', colm.face && colm.shadow && colm.topmost && colm.z >= 5, JSON.stringify(colm));
  ok('stacks: the ↑ and ↓ stay on the pill\'s row, to the right of the column, never under or over it', colm.arrowsOutside, JSON.stringify(colm));
  const key = async k => { await page.keyboard.press(k); await page.waitForTimeout(150); return (await state()).act; };
  const trail = [await key('ArrowDown'), await key('ArrowDown'), await key('ArrowUp'), await key('ArrowUp')];
  ok('stacks: Down from the pill goes to the next higher number, Up back across the gap to the next lower', trail[0] === s0.dn[0] && trail[1] === (s0.dn[1] ?? s0.dn[0]) && trail[2] === s0.dn[0] && trail[3] === s0.up.at(-1), JSON.stringify({ trail, s0 }));
  ok('stacks: Home is the lowest number and End the highest', (await key('Home')) === s0.up[0] && (await key('End')) === s0.dn.at(-1));
  await page.keyboard.press('Enter'); await page.waitForTimeout(700); await page.mouse.move(4, 4); await page.waitForTimeout(300);
  const top = await state();
  ok('stacks: Enter chooses the highest: the pill reads it, the list is closed, and it has no lower stack to open', top.pill === s0.dn.at(-1) && !top.open, JSON.stringify(top));
  await page.keyboard.press('Alt+Shift+ArrowDown'); await page.waitForTimeout(400);
  const s1 = await state();
  ok('stacks: the highest version as the current one has no stack below, and all the others above in ascending order', s1.dn.length === 0 && s1.up.length >= 2 && asc(s1.up) && !s1.dnBox, JSON.stringify(s1));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  // the first of two versions
  await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await hold(2); await page.keyboard.press('Alt+Shift+ArrowDown'); await page.waitForTimeout(400);
  const s2 = await state();
  ok('stacks: the first version as the current one has no stack above', s2.up.length === 0 && !s2.upBox && s2.dn.length >= 1, JSON.stringify(s2));
  // a line with ONE version: a + where the caret is, and one row, "+ New version", that starts writing a new version
  await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await hold(3);
  const pillOf = () => page.evaluate(() => { const b = document.querySelector('#editlay .obv[aria-haspopup]'); return b && { plus: !!b.querySelector('svg') && b.classList.contains('one'), caret: getComputedStyle(b, '::after').content !== 'none' }; });
  const p1 = await pillOf();
  await page.keyboard.press('Alt+Shift+ArrowDown'); await page.waitForTimeout(400);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#editlay .obvlist:not([hidden]) .obvopt')].map(o => ({ text: o.textContent.trim(), label: o.getAttribute('aria-label'), title: o.title, svg: !!o.querySelector('svg'), l: Math.round(o.getBoundingClientRect().left * 2) / 2, r: Math.round(o.getBoundingClientRect().right * 2) / 2 })));
  const pillEdge = await page.evaluate(() => { const q = document.querySelector('#editlay .obv[aria-haspopup]').getBoundingClientRect(); return { l: Math.round(q.left * 2) / 2, r: Math.round(q.right * 2) / 2 }; });
  ok('stacks: a line with one version shows a + glyph (the add icon) where the caret was, and its list is exactly one icon-only row (no visible words) named "New version" by aria-label and title', p1.plus && !p1.caret && rows.length === 1 && rows[0].svg && rows[0].text === '' && /New version/.test(rows[0].label) && /New version/.test(rows[0].title), JSON.stringify({ p1, rows }));
  ok('stacks: that one row is only as wide as the pill (left and right edges equal the pill\'s)', rows.length === 1 && rows[0].l === pillEdge.l && rows[0].r === pillEdge.r, JSON.stringify({ rows, pillEdge }));
  await page.click('#editlay .obnew'); await page.waitForTimeout(600);
  ok('stacks: a click on the icon-only row starts writing a new version (edit mode "new")', await page.evaluate(() => window.__wb.edit.editing?.mode === 'new'), JSON.stringify(await page.evaluate(() => window.__wb.edit.editing?.mode)));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.mouse.move(4, 4); await hold(3);
  await page.keyboard.press('Alt+Shift+ArrowDown'); await page.waitForTimeout(400);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
  ok('stacks: Down and Enter on that row start writing a new version (edit mode "new")', await page.evaluate(() => window.__wb.edit.editing?.mode === 'new'), JSON.stringify(await page.evaluate(() => window.__wb.edit.editing?.mode)));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.mouse.move(4, 4);
  await hold(2);
  const p2 = await pillOf();
  await page.keyboard.press('Alt+Shift+ArrowDown'); await page.waitForTimeout(400);
  ok('stacks: a line with two versions keeps the caret and has no new-version row', !p2.plus && p2.caret && await page.evaluate(() => !document.querySelector('#editlay .obnew')), JSON.stringify(p2));
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
  const k = await after('#editlay .dp-lock', () => sheet.locator('.band[data-section=experience] .bullets li').first().click());
  ok('lock: a click on a locked line wobbles the chip\'s padlock (a running animation, a ring) and flashes the plate; no text window and no toast while a lock is on screen', k.running && ['lock:shake', 'lock:ring', 'lock:flash'].every(n => k.names.includes(n)) && !k.tip && !k.toast, JSON.stringify(k));
  await ctx.close();
});

// ---- 5. less chrome ----
await run('chrome', async () => {
  const { ctx, page } = await open(1470, 832);
  await page.click('#outline [data-act=select-section][data-id=experience]'); await page.waitForTimeout(400);
  await page.click('#body [data-act=select-job][data-id=hydra]'); await page.waitForTimeout(900);
  await page.mouse.move(4, 4); await page.waitForTimeout(300);
  ok('a job is selected and the page is not dimmed: there is no veil in the page layer', await page.evaluate(() => window.__wb.ui.sel.kind === 'job' && !!document.querySelector('#editlay .obchip') && !document.querySelector('#editlay .obveil')));
  await page.click('#editlay .obchip .dp-lock'); await page.waitForTimeout(700);
  ok('a locked block has no padlock mark at its corner: the chip’s padlock is pressed and says it', await page.evaluate(() => document.querySelector('#editlay .obchip .dp-lock')?.getAttribute('aria-pressed') === 'true' && !document.querySelector('#editlay .oblockmark')));
  await ctx.close();
});

// ---- 6. the header guard ----
await run('guard', async () => {
  const { ctx, page, sheet } = await open(1470, 832);
  const st = () => page.evaluate(() => ({ kind: window.__wb.ui.sel.kind, id: window.__wb.ui.sel.id, editing: window.__wb.edit.editing?.fact ?? null, body: document.querySelector('#body').dataset.view }));
  const title = sheet.locator('.entry .role-title').first();
  await title.click({ position: { x: 20, y: 6 } }); await page.waitForTimeout(700);
  const a = await st();
  ok('a first click on a job’s title selects the job (its sidebar) and does not open writing', a.kind === 'job' && a.editing === null && a.body === 'job', JSON.stringify(a));
  await page.waitForTimeout(1200);
  await title.click({ position: { x: 20, y: 6 } }); await page.waitForTimeout(700);
  const b = await st();
  ok('the second click opens the title for writing', /-position$/.test(b.id) && b.editing === b.id, JSON.stringify(b));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await page.evaluate(() => window.__wb.edit.setGuard(false));
  await title.click({ position: { x: 20, y: 6 } }); await page.waitForTimeout(700);
  const c = await st();
  ok('with the guard off (as the checks open it) one click writes the title, as before', /-position$/.test(c.id) && c.editing === c.id, JSON.stringify(c));
  await ctx.close();
});

// ---- 7. the tools row and the sidebar ----
for (const [w, h] of [[1470, 832], [1100, 720], [900, 700], [800, 700]]) await run(`tools ${w}`, async () => {
  const { ctx, page, sheet } = await open(w, h);
  const LI = '.band[data-section=experience] .entry:first-child .bullets li';
  await sheet.locator(LI).nth(1).click(); await page.waitForTimeout(500);
  await page.keyboard.press('Enter'); await page.waitForTimeout(1200); await page.mouse.move(4, 4); await page.waitForTimeout(300);
  const g = await page.evaluate(() => {
    const r = s => document.querySelector(s)?.getBoundingClientRect(), v = window.__wb.canvas.view, room = v.left + v.width;
    const pill = r('#editlay .obv'), up = r('#editlay [data-act=ob-up]'), down = r('#editlay [data-act=ob-down]'), li = document.querySelector('#sheet iframe').contentDocument.querySelector('[contenteditable]'), f = document.querySelector('#sheet iframe').getBoundingClientRect(), k = f.width / document.querySelector('#sheet iframe').offsetWidth, lr = li.getBoundingClientRect();
    const line = { left: f.left + lr.left * k, right: f.left + lr.right * k };
    const top = document.elementFromPoint(down.right - 4, down.top + down.height / 2);
    return { room, line, pill: { l: pill.left, r: pill.right }, up: { l: up.left, r: up.right }, down: { l: down.left, r: down.right }, clipped: getComputedStyle(document.querySelector('#editlay .obtoolswrap')).clipPath !== 'none', hit: !!top?.closest('.obtoolswrap'), rowH: [pill, up, down].map(e => Math.round((e.top + e.bottom) / 2)) };
  });
  if (process.env.DD) console.log(w, JSON.stringify(g));
  const right = g.pill.l >= g.line.right, left = g.down.r <= g.line.left + 1, nowhere = g.line.left < 120;      // (at 800 px the line has no room on either side: the row keeps to the page's edge)
  ok(`${w}: the row is never split: the pill, ↑, ↓ in that order, side by side, on one level`, g.pill.l < g.up.l && g.up.l < g.down.l && g.up.l - g.pill.r <= 4 && g.down.l - g.up.r <= 4 && Math.max(...g.rowH) - Math.min(...g.rowH) <= 1, JSON.stringify(g));
  ok(`${w}: on the right of the line the pill is fully before the sidebar and only the arrows may run under it; otherwise the whole row is left of the line`, right ? g.pill.r <= g.room + .5 : (left || nowhere), JSON.stringify(g));
  if (w >= 900 && w < 1400) ok(`${w}: with the sidebar open the arrows run past its edge and are hidden behind it (clipped, not clickable there) instead of the row jumping left`, right && g.down.r > g.room && g.clipped && !g.hit, JSON.stringify(g));
  if (w === 1470) ok(`${w}: when the whole row fits it is not clipped`, right && !g.clipped, JSON.stringify(g));
  await ctx.close();
});

server.close(); await browser.close();
console.log(failed ? `${failed} check(s) FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
