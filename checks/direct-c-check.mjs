#!/usr/bin/env node
// node checks/direct-c-check.mjs   (builder C of UX-6 direct editing, round 2; one section per item)
//  1. the tint: the plate that moves has a fill in hover and selected, in all four looks, read from what the browser draws (no --pk set by hand).
//  2. the ladder (lab v2 "light"): hover a wash of --sel-mark at the drink's strength and no edge; selected the wash x1.5 and a 1px edge in the plate ink (a job's
//     wash x0.8, a section's x0.7, and each at least 1.06:1 against the paper); writing no wash; one corner (plate-r + its stand-off) in every state, the written field at plate-r, no corner transition;
//     the fade-in 160 ms and the glide 180 ms.
//  3. hover zones: a slow pointer path down through the lines and the gaps of two sections (over the text, and in the lines' left margin) draws a job's or a section's
//     big plate only while the pointer is on its heading row; the job's side strip and the section's tab column still give theirs.
//  4. the grip is part of the plate: its dots show only as the pointer nears the plate's left side, drawn by the plate in a tab it widens into (where the words leave
//     room; a skill group's never covers the next column's words), the grip a clear button over it inside the plate's box; on touch the selected job shows its dots.
//  5. zoom and write start: across the camera's ease as writing starts, the written line's plate (and the grip's dots in it) keeps one shape on the page at every frame:
//     it never tweens against the camera.
//  6. the free drag (behind the review flag ?drag=free), lighter and tighter: a line pulled far sideways moves across only by about 12 px of give, past the first and last place it shows about 12 px of bumper
//     (none under reduced motion); the lifted line has a 1 px edge, a wash, a small lift shadow, and its socket the faint ring ink.
//  7. the hands ride the page: while the camera pans (the wheel) and zooms (an ease), the "+" and the grip stay where their block puts them, within 1 px, at every frame.
//  8. the snap drag (the default): the lifted line stands at the place it would land (its socket) lagging toward the pointer, at most 10 px along and 3 px across, however
//     far the pointer goes (over another job's words the drop is refused and its landing is home, as before); it pops to the next place when the pointer passes halfway between the two landings (within 2 px), with a glide, none under reduced motion.
// PW_BUNDLED=1, or CHROME_PATH. PORT. Writes nothing.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8493);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
server.listen(PORT, 1024);
await new Promise(r => server.once('listening', r));
let failed = 0;
const only = process.env.ONLY?.split(',');
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const run = async (name, fn) => { if (only && !only.includes(name)) return; try { await fn(); } catch (e) { ok(`${name}: the section ran to its end`, false, String(e.message).split('\n').slice(0, 3).join(' ')); } };
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});
const LOOKS = [['tea', 'light'], ['tea', 'dark'], ['coffee', 'light'], ['coffee', 'dark']];
const open = async (look = [], motion = false, w = 1470, h = 832, q = '') => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: motion ? 'no-preference' : 'reduce' });
  await ctx.addInitScript(([d, t]) => { try { localStorage.setItem('rb-help-seen', '1'); if (d) { localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); } } catch { /* none */ } }, look);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(`http://localhost:${PORT}/?memory${q}#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.evaluate(() => { window.__wb.edit.setAutoFold?.(false); });
  await page.waitForTimeout(500);
  return { ctx, page, sheet: page.frameLocator('#sheet iframe') };
};
const box = (page, sel, n = 0) => page.frameLocator('#sheet iframe').locator(sel).nth(n).boundingBox();
const rest = async page => { await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await page.waitForTimeout(400); };
const glide = async (page, x, y) => { await page.mouse.move(x - 40, y); for (let k = 1; k <= 8; k++){ await page.mouse.move(x - 40 + 5 * k, y); await page.waitForTimeout(25); } await page.waitForTimeout(350); };
// the plate the app draws for a role: its computed fill, outline and corner
const plateOf = (page, role) => page.evaluate(r => {
  const p = window.__wb.sheet.plates().find(q => q.role === r); if (!p) return null;
  const cs = p.div.ownerDocument.defaultView.getComputedStyle(p.div);
  return { rings: p.div.ownerDocument.querySelectorAll('.rb-ring').length, bg: cs.backgroundColor, ow: parseFloat(cs.outlineWidth), oc: cs.outlineColor, os: cs.outlineStyle, r: parseFloat(cs.borderTopLeftRadius), rr: parseFloat(cs.borderTopRightRadius), po: parseFloat(cs.getPropertyValue('--po')) };
}, role);
const clear = c => !c || c === 'transparent' || /,\s*0\)$/.test(c);

// ---- 1. the tint ----
await run('tint', async () => {
  for (const look of LOOKS){
    const { ctx, page } = await open(look), tag = look.join(' ');
    for (const [lv, sel, n, at] of [['line', '.entry:first-child .bullets li', 1, b => ({ x: b.x + 60, y: b.y + 6 })], ['job', '.entry .role-title', 0, b => ({ x: b.x + 30, y: b.y + 6 })]]){
      await rest(page);
      const b = await box(page, sel, n), p = at(b);
      await glide(page, p.x, p.y);
      const hot = await plateOf(page, 'hot');
      await page.mouse.click(p.x, p.y); await page.waitForTimeout(400); if (lv === 'line') await page.keyboard.press('Escape'); await page.mouse.move(4, 4); await page.waitForTimeout(400);
      const s = await plateOf(page, 'sel');
      ok(`tint: ${tag}: ${lv}: the plate has a fill when hovered and when selected`, !!hot && !clear(hot.bg) && !!s && !clear(s.bg), JSON.stringify({ hot: hot?.bg, sel: s?.bg }));
    }
    await ctx.close();
  }
});

// ---- 2. the ladder ----
const alpha = c => { const m = /rgba?\(([^)]+)\)/.exec(c ?? '') ?? /color\(srgb ([^)]+)\)/.exec(c ?? ''); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean); return v.length > 3 ? +v[3] : 1; };
await run('ladder', async () => {
  const WASH = { 'tea light': 9, 'tea dark': 10, 'coffee light': 5, 'coffee dark': 6 };
  for (const look of LOOKS){
    const { ctx, page } = await open(look), tag = look.join(' '), wash = WASH[tag] / 100, near = (a, b) => a != null && Math.abs(a - b) < .006;
    await rest(page);
    const b = await box(page, '.entry:first-child .bullets li', 1); await glide(page, b.x + 60, b.y + 6);
    const hot = await plateOf(page, 'hot');
    ok(`ladder: ${tag}: hover is the wash at ${WASH[tag]}% of --sel-mark, no edge, its corner plate-r + its stand-off`, !!hot && near(alpha(hot.bg), wash) && hot.ow === 0 && Math.abs(hot.r - (2 + hot.po)) < .1 && hot.r === hot.rr, JSON.stringify({ hot, a: alpha(hot?.bg) }));
    await page.mouse.click(b.x + 60, b.y + 6); await page.waitForTimeout(400);
    const w = await plateOf(page, 'write'), field = await page.evaluate(() => { const e = document.querySelector('#sheet iframe').contentDocument.querySelector('[contenteditable]'); return e && parseFloat(getComputedStyle(e).borderTopLeftRadius); });
    ok(`ladder: ${tag}: writing has no wash, a thin rule, the plate's corner, the field at plate-r`, !!w && clear(w.bg) && w.ow > 0 && w.ow <= 1 && Math.abs(w.r - (2 + w.po)) < .1 && field === 2, JSON.stringify({ w, field }));
    await page.keyboard.press('Escape'); await page.mouse.move(4, 4); await page.waitForTimeout(400);
    const s = await plateOf(page, 'sel');
    ok(`ladder: ${tag}: selected is the wash x1.5, no edge`, !!s && near(alpha(s.bg), wash * 1.5) && s.ow === 0 && Math.abs(s.r - (2 + s.po)) < .1, JSON.stringify({ s, a: alpha(s?.bg) }));
    await rest(page);
    const h = await box(page, '.entry .role-title', 0); await page.mouse.click(h.x + 30, h.y + 6); await page.mouse.move(4, 4); await page.waitForTimeout(400);
    const j = await plateOf(page, 'sel');
    ok(`ladder: ${tag}: a job's selected plate: its wash at x0.8 (it was x0.5), no edge, and no ring round the section`, !!j && near(alpha(j.bg), wash * 1.5 * .8) && j.ow === 0 && j.rings === 0, JSON.stringify({ j, a: alpha(j?.bg) }));
    // the big blocks are seen: a job's and a section's hover and selected wash are x0.8 and x0.7 of a line's (were x0.5 and x0.3) and each is at least 1.06:1 against the paper
    const rgba = c => { const m = /rgba?\(([^)]+)\)/.exec(c ?? ''), n = m ? m[1].split(/[ ,/]+/).filter(Boolean).map(Number) : (/color\(srgb ([^)]+)\)/.exec(c ?? '')?.[1].split(/[ /]+/).map(Number).map((v, i) => (i < 3 ? v * 255 : v)) ?? [0, 0, 0, 0]); return [n[0], n[1], n[2], n[3] ?? 1]; };
    const lum = p => { const f = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(p[0]) + .7152 * f(p[1]) + .0722 * f(p[2]); };
    const paper = rgba(await page.evaluate(() => { const e = document.createElement('i'); e.style.background = 'var(--paper)'; document.body.append(e); const c = getComputedStyle(e).backgroundColor; e.remove(); return c; }));
    const contrast = bg => { const c = rgba(bg), over = [0, 1, 2].map(i => paper[i] + (c[i] - paper[i]) * c[3]), a = lum(paper), b = lum(over); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
    const big = {};
    for (const [lv, sel, k] of [['job', '.entry .role-title', .8], ['section', '.band[data-section=experience] h2.tab', .7]]){
      await rest(page);
      const hb = await box(page, sel, 0); await glide(page, hb.x + hb.width / 2, hb.y + hb.height / 2);
      big[`${lv} hover`] = { bg: (await plateOf(page, 'hot'))?.bg, k, mult: 1 };
      await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.waitForTimeout(400); if (lv === 'section') await page.keyboard.press('Escape'); await page.mouse.move(4, 4); await page.waitForTimeout(500);
      big[`${lv} selected`] = { bg: (await plateOf(page, 'sel'))?.bg, k, mult: 1.5 };
    }
    for (const [what, v] of Object.entries(big)){
      const c = v.bg ? contrast(v.bg) : 0;
      console.log(`  ladder ${tag}: ${what} alpha ${alpha(v.bg)?.toFixed(4)} contrast ${c.toFixed(3)}`);
      ok(`ladder: ${tag}: a ${what} wash is x${v.k} of a line's and at least 1.06:1 against the paper`, !!v.bg && near(alpha(v.bg), wash * v.mult * v.k) && c >= 1.06, JSON.stringify({ bg: v.bg, c }));
    }
    if (tag === 'tea light'){
      const t = await page.evaluate(() => { const d = document.querySelector('#sheet iframe').contentDocument, p = window.__wb.sheet.plates()[0]; const cs = p && d.defaultView.getComputedStyle(p.div); return { tp: cs?.transitionProperty, in: d.documentElement.style.getPropertyValue('--plate-in'), glide: d.documentElement.style.getPropertyValue('--plate-glide') }; });
      ok('ladder: the corner is never animated, the fade-in is 160 ms and the glide 180 ms', !!t.tp && !/radius/.test(t.tp) && t.in === '160ms' && t.glide === '180ms', JSON.stringify(t));
    }
    await ctx.close();
  }
});

// ---- 3. hover zones ----
await run('zones', async () => {
  const { ctx, page } = await open(['tea', 'light']);
  await rest(page);
  // the frame's rows, on the screen: the jobs' and the sections' heading rows, a line's left edge, the path's ends
  const geo = await page.evaluate(() => {
    const w = window.__wb, d = document.querySelector('#sheet iframe').contentDocument, S = r => w.canvas.screenRect(r), R = e => S(e.getBoundingClientRect());
    const heads = [...d.querySelectorAll('.entry')].map(e => S(w.sheet.jobHeadRect(e))).concat([...d.querySelectorAll('.band[data-section] .tab:not(.tab--cont)')].map(R));
    const li = R(d.querySelector('.entry .bullets li')), ex = R(d.querySelector('.band[data-section=experience]')), nx = d.querySelector('.band[data-section=experience] ~ .band[data-section]');
    return { heads: heads.map(h => [h.top, h.top + h.height]), x: li.left + 60, xm: li.left - 6, y0: ex.top - 30, y1: (nx ? R(nx).top : ex.top + ex.height) + 40, k: w.canvas.cam.k, entry: R(d.querySelector('.entry')), tab: R(d.querySelector('.band[data-section=experience] .tab')) };
  });
  const sample = () => page.evaluate(() => { const p = window.__wb.sheet.plates().find(q => q.role === 'hot'); if (!p) return null; const r = p.div.getBoundingClientRect(), k = window.__wb.canvas.cam.k; return { area: Math.round(r.width * r.height * k * k), big: p.el.matches('.entry, .band') }; });
  const slop = 4 * geo.k + 1, onHead = y => geo.heads.some(([a, b]) => y >= a - slop && y <= b + slop);
  for (const [name, x] of [['over the text', geo.x], ['in the lines\' margin', geo.xm]]){
    await page.mouse.move(x, geo.y0 - 20); await page.waitForTimeout(200);
    const rec = [];
    for (let y = geo.y0; y <= geo.y1; y += 2){ await page.mouse.move(x, y); await page.waitForTimeout(28); const s = await sample(); rec.push({ y: Math.round(y), ...(s ?? { area: 0 }) }); }
    const spikes = rec.filter(r => r.big && !onHead(r.y)), small = rec.filter(r => r.area && !r.big).map(r => r.area), big = rec.filter(r => r.big).map(r => r.area);
    console.log(`  zones ${name}: ${rec.length} samples, line plates up to ${Math.max(0, ...small)} px², big plates ${big.length} (up to ${Math.max(0, ...big)} px²), outside a heading row ${spikes.length}`);
    ok(`zones: a slow path ${name} through the gaps shows a big plate only on a heading row`, rec.length > 50 && small.length > 10 && spikes.length === 0, JSON.stringify(spikes.slice(0, 4)));
    await rest(page);
  }
  // the sides still give the big plates: the strip left of a job, a section's tab column below its tab
  const side = async (x, y) => { await page.mouse.move(x, y - 30); await page.mouse.move(x, y, { steps: 8 }); await page.waitForTimeout(400); return page.evaluate(() => window.__wb.sheet.plates().find(q => q.role === 'hot')?.el.className ?? null); };
  const js = await side(geo.entry.left - 10 * geo.k, geo.entry.top + geo.entry.height / 2), ss = await side(geo.tab.left + 10, geo.tab.top + geo.tab.height + 60 * geo.k);
  ok('zones: the strip left of a job gives the job, a section\'s tab column the section', /entry/.test(js ?? '') && /band/.test(ss ?? ''), JSON.stringify({ js, ss }));
  await ctx.close();
});

// ---- 4. the grip in the plate ----
const gripState = page => page.evaluate(() => {
  const w = window.__wb, p = w.sheet.plates().find(q => q.div.classList.contains('is-grip')), b = [...document.querySelectorAll('#handlay .obgrip')].find(e => !e.hidden);
  const d = document.querySelector('#sheet iframe').contentDocument, S = r => w.canvas.screenRect(r);
  if (!p) return { dots: false, grip: !!b };
  const r = S(p.div.getBoundingClientRect()), q = b?.getBoundingClientRect(), own = p.el;
  // the words of other blocks under the plate's tab (the strip left of its block)
  const el = S(own.getBoundingClientRect()), strip = { left: r.left, right: el.left, top: r.top, bottom: r.top + r.height }, wk = d.createTreeWalker(d.querySelector('.document'), 4), rg = d.createRange(); let under = 0;
  for (let n = wk.nextNode(); n; n = wk.nextNode()){ if (!n.nodeValue.trim() || own.contains(n)) continue; rg.selectNodeContents(n); for (const t of rg.getClientRects()){ const u = S(t); if (u.width > 1 && u.left < strip.right - 1 && u.left + u.width > strip.left + 1 && u.top < strip.bottom - 1 && u.top + u.height > strip.top + 1) under++; } }
  return { dots: true, role: p.role, tw: parseFloat(p.div.style.getPropertyValue('--tw')) || 0, inside: !!q && q.left >= r.left - 1 && q.right <= r.left + r.width + 1 && q.top >= r.top - 1 && q.bottom <= r.top + r.height + 1, under };
});
await run('grip', async () => {
  const { ctx, page } = await open(['tea', 'light']);
  for (const [lv, sel, n] of [['line', '.entry:first-child .bullets li', 1], ['group', '.skills__group', 1]]){
    await rest(page);
    const b = await box(page, sel, n);
    await glide(page, b.x + b.width * .6, b.y + 6);
    const far = await gripState(page);
    await page.mouse.move(b.x + 4, b.y + 6, { steps: 8 }); await page.waitForTimeout(450);
    const nearS = await gripState(page);
    ok(`grip: ${lv}: no dots while the pointer is over the middle of the text; near the left side the plate draws them, the grip's button inside its box`, !far.dots && nearS.dots && nearS.inside, JSON.stringify({ far, nearS }));
    ok(`grip: ${lv}: the tab covers none of the other blocks' words${lv === 'line' ? ', and the plate widens into it' : ''}`, nearS.under === 0 && (lv !== 'line' || nearS.tw > 0), JSON.stringify(nearS));
  }
  await ctx.close();
  // touch: no hover; a tap on a job's heading selects the job (the header guard) and its plate shows the dots
  const tctx = await browser.newContext({ viewport: { width: 1470, height: 832 }, hasTouch: true, reducedMotion: 'reduce' });
  await tctx.addInitScript(() => { try { localStorage.setItem('rb-help-seen', '1'); } catch { /* none */ } });
  const tp = await tctx.newPage();
  await tp.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await tp.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await tp.waitForTimeout(500);
  const h = await box(tp, '.entry .role-title', 0); await tp.touchscreen.tap(h.x + 30, h.y + 6); await tp.waitForTimeout(600);
  const ts = await gripState(tp), sel = await tp.evaluate(() => window.__wb.ui.sel.kind);
  ok('grip: on touch the selected job shows its dots in its plate', sel === 'job' && ts.dots && ts.role === 'sel', JSON.stringify({ sel, ts }));
  await tctx.close();
});

// ---- 5. zoom and write start ----
await run('zoom', async () => {
  const { ctx, page } = await open(['tea', 'light'], true);
  await page.evaluate(() => window.__wb.canvas.reset({ page: 0 })); await page.waitForTimeout(900);
  const b = await box(page, '.entry:first-child .bullets li', 1);
  await glide(page, b.x + 4, b.y + 6); await page.waitForTimeout(300);
  await page.evaluate(() => { const w = window.__wb, rec = window.__zrec = []; const t0 = performance.now(); const tick = () => { const p = w.sheet.plates().find(q => q.role === 'write'); if (p){ const r = p.div.getBoundingClientRect(), win = p.div.ownerDocument.defaultView, dots = win.getComputedStyle(p.div, '::before'); rec.push({ t: performance.now() - t0, k: w.canvas.cam.k, r: [r.left, r.top, r.width, r.height], grip: p.div.classList.contains('is-grip'), dl: parseFloat(dots.left) }); } if (performance.now() - t0 < 900) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await page.mouse.click(b.x + 60, b.y + 6); await page.waitForTimeout(1100);
  const rec = await page.evaluate(() => window.__zrec), last = rec.at(-1), ks = rec.map(r => r.k);
  const dev = rec.length ? Math.max(...rec.map(r => Math.max(...r.r.map((v, i) => Math.abs(v - last.r[i]))))) : 99, eased = Math.max(...ks) - Math.min(...ks) > .01 && new Set(ks.map(k => k.toFixed(3))).size > 3;
  console.log(`  zoom: ${rec.length} frames, camera k ${Math.min(...ks).toFixed(3)}..${Math.max(...ks).toFixed(3)}, the plate's largest step from its place ${dev.toFixed(2)} page px, dots in it at every frame: ${rec.every(r => r.grip)}`);
  ok('zoom: across the camera\'s ease as writing starts the written line\'s plate and its grip\'s tab keep one shape on the page (within 1 px) at every frame', eased && dev <= 1 && rec.every(r => r.grip && r.dl === last.dl), JSON.stringify({ n: rec.length, eased, dev, first: rec[0], last }));
  await ctx.close();
});

// ---- 6. the drag, lighter and tighter ----
await run('drag', async () => {
  for (const motion of [true, false]){
    const { ctx, page } = await open(['tea', 'light'], motion, 1470, 832, '&drag=free'), tag = `${motion ? 'with motion' : 'reduced motion'}, ?drag=free`;      // (the free follow, kept behind the review flag)
    await rest(page);
    const b = await box(page, '.entry:first-child .bullets li', 1), x0 = b.x + 60, y0 = b.y + 6;
    const home = await page.evaluate(() => { const ls = [...document.querySelector('#sheet iframe').contentDocument.querySelectorAll('.entry:first-child .bullets li')], r = ls[1].getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, boxTop: ls[0].getBoundingClientRect().top, boxBottom: ls.at(-1).getBoundingClientRect().bottom }; });
    // the lifted block's offset from its home (page px), and how it looks
    const held = () => page.evaluate(h => {
      const d = document.querySelector('#sheet iframe').contentDocument, win = d.defaultView, el = d.querySelector('.rb-lift'); if (!el) return null;
      const r = el.getBoundingClientRect(), c = win.getComputedStyle(el), so = d.querySelector('.rb-socket'), sc = so && win.getComputedStyle(so);
      const sh = [...c.boxShadow.matchAll(/(-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px/g)].map(m => m.slice(1, 5).map(Number)), lift = sh.filter(s => s[0] || s[1]);
      return { dx: Math.round((r.left - h.left) * 10) / 10, dy: Math.round((r.top - h.top) * 10) / 10, dyb: Math.round((r.bottom - h.bottom) * 10) / 10, ow: parseFloat(c.outlineWidth), os: c.outlineStyle, lift: lift.map(s => Math.max(Math.abs(s[0]), Math.abs(s[1]))), wash: /inset/.test(c.boxShadow), socketLine: sc?.outlineStyle ?? null, socketBg: sc?.backgroundColor ?? null, rail: !!d.querySelector('.rb-rail') || !!document.querySelector('#handlay .obrail') };
    }, home);
    await page.mouse.move(x0, y0); await page.waitForTimeout(300);
    await page.mouse.down(); await page.mouse.move(x0 + 8, y0 + 2, { steps: 4 }); await page.waitForTimeout(150);
    const k = await page.evaluate(() => window.__wb.canvas.cam.k), far = 400;
    await page.mouse.move(x0 + far, y0 + 2, { steps: 12 }); await page.waitForTimeout(350); const side = await held();
    await page.mouse.move(x0 - far, y0 + 2, { steps: 20 }); await page.waitForTimeout(350); const side2 = await held();
    await page.mouse.move(x0, y0 - far, { steps: 20 }); await page.waitForTimeout(350); const up = await held();
    await page.mouse.move(x0, y0 + far, { steps: 30 }); await page.waitForTimeout(350); const down = await held();
    await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(500);
    const give = motion ? 12.6 : .6;
    console.log(`  drag ${tag}: across ${side?.dx} / ${side2?.dx} px, past the top ${up?.dy} px, past the bottom ${down?.dyb} px (page px; camera ${k.toFixed(2)})`);
    ok(`drag: ${tag}: a line pulled far sideways moves across only by the give (${motion ? 'about 12 px' : 'none'})`, !!side && !!side2 && Math.abs(side.dx) <= give && Math.abs(side2.dx) <= give && (!motion || side.dx > 4), JSON.stringify({ side, side2 }));
    const over = up && down && { top: Math.round((home.boxTop - (home.top + up.dy)) * 10) / 10, bottom: Math.round((home.bottom + down.dyb - home.boxBottom) * 10) / 10 };
    console.log(`  drag ${tag}: beyond its places: ${over?.top} px over the top, ${over?.bottom} px under the bottom`);
    ok(`drag: ${tag}: pulled far past the first and the last place it shows a bumper of ${motion ? 'about 12 px' : 'nothing'} beyond its places`, !!over && over.top >= -.6 && over.top <= give && over.bottom >= -.6 && over.bottom <= give && (!motion || over.top > 4), JSON.stringify({ over, up, down }));
    if (motion) ok('drag: the lifted line is shading only: no outline, a wash, a lift shadow of 4 px at most; its socket a wash with no outline; no rail', !!side && side.os === 'none' && side.wash && side.lift.length > 0 && Math.max(...side.lift) <= 4 && side.socketLine === 'none' && !clear(side.socketBg) && !side.rail, JSON.stringify(side));
    await ctx.close();
  }
});

// ---- 7. the hands ride the page ----
await run('ride', async () => {
  const { ctx, page } = await open(['tea', 'light'], true);
  await page.evaluate(() => window.__wb.canvas.reset({ page: 0 })); await page.waitForTimeout(900);
  const b = await box(page, '.entry:first-child .bullets li', 1);
  // the line selected, the pointer on the desk beside the page (so what is under it never changes): its grip and its job's "+" show
  await page.mouse.click(b.x + 60, b.y + 6); await page.waitForTimeout(400); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const desk = await page.evaluate(() => { const r = window.__wb.canvas.screenRect(document.querySelector('#sheet iframe').contentDocument.querySelector('.page').getBoundingClientRect()); return { x: r.left - 24, y: r.top + 200 }; });
  await page.mouse.move(desk.x, desk.y, { steps: 4 }); await page.waitForTimeout(600);
  // every frame: the "+" and the grip against their blocks (the job's last line, the hovered line) on the screen
  const rec = () => page.evaluate(() => { const w = window.__wb, rows = window.__ride = []; const t0 = performance.now(); const tick = () => {
    const d = document.querySelector('#sheet iframe').contentDocument, ls = d.querySelectorAll('.entry:first-child .bullets li'), S = e => w.canvas.screenRect(e.getBoundingClientRect());
    const pl = document.querySelector('#handlay .obplus'), gr = [...document.querySelectorAll('#handlay .obgrip')].find(e => !e.hidden), a = S(ls[ls.length - 1]), g = S(ls[1]);
    if (pl && !pl.hidden){ const p = pl.getBoundingClientRect(), q = gr?.getBoundingClientRect(); rows.push({ k: w.canvas.cam.k, ay: a.top, px: p.left + p.width / 2 - (a.left + a.width / 2), py: p.top - (a.top + a.height), gx: q ? q.right - g.left : null, gy: q ? q.top - g.top : null }); }
    if (performance.now() - t0 < 1400) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const spread = (rows, k) => { const v = rows.map(r => r[k]).filter(x => x != null); return v.length ? Math.round((Math.max(...v) - Math.min(...v)) * 10) / 10 : 99; };
  // a pan: the wheel, the pointer still
  await rec(); for (let i = 0; i < 8; i++){ await page.mouse.wheel(0, 40); await page.waitForTimeout(30); } await page.waitForTimeout(1200);
  const pan = await page.evaluate(() => window.__ride);
  const zoomRows = async () => { await rec(); await page.evaluate(() => window.__wb.canvas.zoomBy(1.25)); await page.waitForTimeout(1400); return page.evaluate(() => window.__ride); };
  const zoom = await zoomRows();
  const sp = rows => ({ n: rows.length, moved: spread(rows, 'ay'), ks: new Set(rows.map(r => r.k.toFixed(3))).size, plus: Math.max(spread(rows, 'px'), spread(rows, 'py')), grip: Math.max(spread(rows, 'gx'), spread(rows, 'gy')) });
  const P = sp(pan), Z = sp(zoom);
  console.log(`  ride: pan ${P.n} frames, "+" off its block by up to ${P.plus} px, grip ${P.grip} px; zoom ${Z.n} frames (${Z.ks} scales), "+" ${Z.plus} px, grip ${Z.grip} px`);
  ok('ride: while the camera pans the "+" and the grip stay on their blocks within 1 px at every frame', P.n > 10 && P.moved > 20 && P.plus <= 1 && P.grip <= 1, JSON.stringify(P));
  ok('ride: while the camera zooms (an ease) the "+" and the grip stay on their blocks within 2 px at every frame (the stand-off scales with the zoom, and the hands are put on whole pixels)', Z.n > 10 && Z.ks > 3 && Z.plus <= 2 && Z.grip <= 2, JSON.stringify(Z));
  await ctx.close();
});

// ---- 8. the snap drag ----
await run('snap', async () => {
  for (const motion of [true, false]){
    const { ctx, page } = await open(['tea', 'light'], motion), tag = motion ? 'with motion' : 'reduced motion';
    await rest(page);
    const b = await box(page, '.entry:first-child .bullets li', 1), x0 = b.x + 60, y0 = b.y + 6, k = await page.evaluate(() => window.__wb.canvas.cam.k);
    // the lifted block against its socket (where it lands), centre to centre, page px; the socket's offset from home; a glide running on it
    const at = () => page.evaluate(() => { const d = document.querySelector('#sheet iframe').contentDocument, l = d.querySelector('.rb-lift'), so = d.querySelector('.rb-socket'); if (!l || !so) return null;
      const a = l.getBoundingClientRect(), c = so.getBoundingClientRect(); return { lx: a.left + a.width / 2 - c.left - c.width / 2, ly: a.top + a.height / 2 - c.top - c.height / 2, sy: c.top + c.height / 2, anim: l.getAnimations().filter(q => !q.transitionProperty && q.effect?.getKeyframes().some(f => f.transform)).length }; });
    await page.mouse.move(x0, y0); await page.waitForTimeout(300); await page.mouse.down(); await page.mouse.move(x0, y0 + 6, { steps: 3 }); await page.waitForTimeout(200);
    const rows = [];
    const go = async (x, y, n) => { for (let i = 1; i <= n; i++){ const px = x.from + (x.to - x.from) * i / n, py = y.from + (y.to - y.from) * i / n; await page.mouse.move(px, py); await page.waitForTimeout(16); const s = await at(); if (s) rows.push({ ry: (py - y0) / k, ...s }); } };
    await go({ from: x0, to: x0 }, { from: y0 + 6, to: y0 + 86 }, 40);      // slowly down over its job's next lines, 2 screen px a step
    const down = rows.slice();
    await go({ from: x0, to: x0 + 400 }, { from: y0 + 86, to: y0 + 86 }, 20);      // far sideways
    await go({ from: x0 + 400, to: x0 }, { from: y0 + 86, to: y0 - 400 }, 40);      // far past the top
    await go({ from: x0, to: x0 }, { from: y0 - 400, to: y0 + 600 }, 60);      // far past the bottom
    await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(400);
    const worst = rows.filter(r => !r.anim).reduce(      // (a pop's glide aside: it travels between two landings)
      (m, r) => ({ x: Math.max(m.x, Math.abs(r.lx)), y: Math.max(m.y, Math.abs(r.ly)) }), { x: 0, y: 0 });
    console.log(`  snap ${tag}: ${rows.length} samples, the block off its landing by at most ${worst.y.toFixed(1)} px along and ${worst.x.toFixed(1)} px across (page px)`);
    ok(`snap: ${tag}: however far the pointer goes (sideways, past either end) the block stays within the lag of its landing place (10 px along, 3 across)`, rows.length > 120 && worst.y <= 10.6 && worst.x <= 3.6, JSON.stringify(worst));
    // the pops on the slow way down: where the landing changes, the pointer is halfway between the two landings
    const hc = down[0]?.sy ?? 0, pops = []; for (let i = 1; i < down.length; i++) if (Math.abs(down[i].sy - down[i - 1].sy) > 4) pops.push({ ry: Math.round(down[i].ry * 10) / 10, prev: Math.round(down[i - 1].ry * 10) / 10, mid: Math.round(((down[i - 1].sy - hc) + (down[i].sy - hc)) / 2 * 10) / 10 });
    console.log(`  snap ${tag}: pops (pointer, halfway) ${JSON.stringify(pops.map(q => [q.ry, q.mid]))}`);
    ok(`snap: ${tag}: on a slow way down it pops into each next place as the pointer passes halfway between the two landings (within 2 px)`, pops.length >= 1 && pops.every(q => q.prev <= q.mid + 2 && q.ry >= q.mid - 2), JSON.stringify(pops));
    ok(`snap: ${tag}: the pop ${motion ? 'glides' : 'is at once (no glide)'}`, motion ? down.some(r => r.anim > 0) : rows.every(r => r.anim === 0), JSON.stringify(down.filter(r => r.anim).length));
    await ctx.close();
  }
});

await browser.close(); server.close();
console.log(failed ? `\n${failed} FAILED` : '\nall direct-c checks passed');
process.exit(failed ? 1 : 0);
