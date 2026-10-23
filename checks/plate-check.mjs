#!/usr/bin/env node
// node checks/plate-check.mjs
// The plate (UX-6f 4b): a block's own outline is the one selection system, four heights (hover, selected, writing, lifted), one shape per level
// (line, group, job, section), every colour, width and stand-off a `--plate-*` token (workbench.css, per drink and theme), copied into the page's frame.
//  (a) the frame's stylesheet: the selection classes it knows are exactly the plate's, and every rule of one takes its outline, shadow, radius and fill from
//      the plate tokens (no stray one), and the tokens reach the frame in all four looks (Tea, Coffee, light, dark)
//  (b) each class on each level, by what the browser draws: width, style, colour, stand-off, radius and shadow are what the tokens give
//  (c) the real states per level: the pointer on a block gives it the hover plate (and no other block), a click or the sidebar the selected one, the ring trail behind
//      it, writing the pressed-in field, a drag the lifted plate and the dashed socket at its home
//  (d) hover is intent (UX-6f 1b): a fast sweep across blocks, or off the page, draws no plate; a slow one shows the block it stops on and only one at a time; a stop after
//      a fast sweep shows it within 150 ms; a press, a grip in focus and an arrow step show theirs at once; leaving the page cancels it; into the sidebar and out leaves nothing
// Chromium through Playwright (PW_BUNDLED=1, or CHROME_PATH); writes nothing.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8161);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
let failed = 0;
const part = k => !process.env.PARTS || process.env.PARTS.split(',').includes(k);      // PARTS=a,c,d,e runs only those parts
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});

async function open(drink, theme, motion = false){
  const ctx = await browser.newContext({ viewport: { width: 1470, height: 832 }, reducedMotion: motion ? 'no-preference' : 'reduce' });
  await ctx.addInitScript(([d, t]) => { try { localStorage.setItem('rb-help-seen', '1'); localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); } catch { /* none */ } }, [drink, theme]);
  const page = await ctx.newPage(), bad = [];
  page.on('console', m => { if (m.type() === 'error') bad.push(m.text()); });
  page.on('pageerror', e => bad.push(String(e)));
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.evaluate(() => { window.__wb.edit.setGuard?.(false); window.__wb.edit.setAutoFold?.(false); });
  await page.waitForTimeout(500);
  return { ctx, page, bad };
}
const frameDoc = (page, fn, arg) => page.evaluate(([src, a]) => (0, eval)(src)(document.querySelector('#sheet iframe').contentDocument, a), [fn.toString(), arg]);
async function openByName(page, text){
  if (!(await page.isVisible('#switcher'))) await page.click('#docname-btn');
  await page.waitForSelector('#switcher .sopt'); await page.fill('#switcher #sw-q', text);
  await page.waitForSelector(`#switcher .sopt:has-text("${text}")`); await page.click(`#switcher .sopt:has-text("${text}")`);
  await page.waitForTimeout(900);
}
const box = (page, sel, n = 0) => page.frameLocator('#sheet iframe').locator(sel).nth(n).boundingBox();
const rest = async page => { await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await page.waitForTimeout(400); };
// a slow, deliberate approach: the pointer arrives at about 200 px/s
const glide = async (page, x, y) => { await page.mouse.move(x - 40, y); for (let k = 1; k <= 8; k++){ await page.mouse.move(x - 40 + 5 * k, y); await page.waitForTimeout(25); } await page.waitForTimeout(350); };

// ---- the levels: the element that is the block, where to put the pointer for its hover, how the sidebar selects it ----
const LEVELS = {
  line: { sel: '.entry:first-child .bullets li', n: 1, at: b => ({ x: b.x + 60, y: b.y + 6 }), token: 'line' },
  group: { sel: '.skills__group', n: 0, at: b => ({ x: b.x + 90, y: b.y + 20 }), token: 'group' },
  job: { sel: '.entry', n: 0, head: '.entry .role-title', token: 'job' },
  section: { sel: '.band[data-section=experience]', n: 0, head: '.band[data-section=experience] .tab', token: 'section' },
};

// ---- (a) the frame's stylesheet ----
const FURNITURE = ['rb-ui', 'rb-single', 'rb-stack', 'rb-shown', 'rb-faded', 'rb-still', 'rb-cam', 'rb-handing', 'rb-dragging', 'rb-space', 'rb-clip', 'rb-fold', 'rb-writing', 'rb-focus', 'rb-hit', 'rb-previewing', 'rb-sel', 'rb-fade', 'rb-flash', 'rb-miss-tab'];
// (UX-6f 4c: hover and selection are drawn by .rb-plate, the shape that moves; rb-hot and rb-sel only mark their blocks, and rb-cool and rb-tab are gone)
const PLATE_CLASSES = ['rb-plate', 'rb-prev', 'rb-find', 'rb-miss', 'rb-lift', 'rb-card', 'rb-socket', 'rb-drop'];      // (rb-rail, rb-drop: a drag's rail and drop line, in the frame under the lifted block since 4c-6)
const LOOKS = [['tea', 'light'], ['tea', 'dark'], ['coffee', 'light'], ['coffee', 'dark']];
const TOKENS = ['off-line', 'off-group', 'off-job', 'off-section', 'r', 'hair', 'line', 'write', 'lift', 'ink', 'ink-hover', 'ring', 'tint-hover', 'tint-sel', 'accent', 'accent-tint', 'miss', 'lift-sh', 'inner'];
for (const [drink, theme] of part('a') ? LOOKS : []){
  const { ctx, page, bad } = await open(drink, theme);
  await openByName(page, 'Medtech');
  const tag = `${drink} ${theme}`;
  if (drink === 'tea' && theme === 'light'){
    const sheetInfo = await frameDoc(page, d => {
      const rules = [...d.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } }).filter(r => r.selectorText);
      const classes = new Set(); for (const r of rules) for (const m of r.selectorText.matchAll(/\.(rb-[\w-]+)/g)) classes.add(m[1]);
      const mine = rules.filter(r => /\.rb-(plate|ring|prev|hover|find|miss|lift|card|socket|rail|drop)\b|\.rb-writing \[contenteditable\]|rb-previewing/.test(r.selectorText));
      const PROPS = ['outline', 'outline-color', 'outline-width', 'outline-offset', 'box-shadow', 'border-radius', 'background-color', 'background'];
      const stray = [];
      for (const r of mine) for (const p of PROPS){
        const v = r.style.getPropertyValue(p);
        if (v && !/var\(--(plate|po|tint|pw|pc|pt|e-[tblr])\b/.test(v) && !/^(none|transparent|initial|0(px)?)$/.test(v)) stray.push(`${r.selectorText} { ${p}: ${v} }`);
      }
      const tint = mine.filter(r => /\.rb-(prev|hover|find)/.test(r.selectorText) && r.style.getPropertyValue('--tint')).every(r => /var\(--plate-/.test(r.style.getPropertyValue('--tint'))) && mine.filter(r => /\.rb-plate\.is-/.test(r.selectorText) && r.style.getPropertyValue('--pt')).every(r => /var\(--plate-/.test(r.style.getPropertyValue('--pt')));
      return { classes: [...classes], stray, tint, n: mine.length };
    });
    const unknown = sheetInfo.classes.filter(c => !FURNITURE.includes(c) && !PLATE_CLASSES.includes(c));
    ok('plate: every selection class the frame knows is one of the plate\'s (no old class left, none added)', unknown.length === 0 && PLATE_CLASSES.every(c => sheetInfo.classes.includes(c)), JSON.stringify({ unknown, have: sheetInfo.classes }));
    ok('plate: every rule of a selection class takes its outline, shadow, radius and fill from the plate tokens (no stray one)', sheetInfo.n >= 12 && sheetInfo.stray.length === 0 && sheetInfo.tint, JSON.stringify(sheetInfo.stray));
  }
  // the tokens, in the app and in the frame, in this look
  const tk = await page.evaluate(names => {
    const app = getComputedStyle(document.documentElement), fd = document.querySelector('#sheet iframe').contentDocument, fr = fd.defaultView.getComputedStyle(fd.documentElement);
    return names.map(n => [n, app.getPropertyValue(`--plate-${n}`).trim(), fr.getPropertyValue(`--plate-${n}`).trim()]);
  }, TOKENS);
  ok(`plate: ${tag}: every plate token is set in the app, and reaches the frame the same`, tk.every(([, a, f]) => a && a === f), JSON.stringify(tk.filter(([, a, f]) => !a || a !== f)));
  // the two colour roles are two colours: selection ink and preview accent are not one
  const roles = Object.fromEntries(tk.map(([n, a]) => [n, a]));
  ok(`plate: ${tag}: two colour roles, selection ink and the preview accent, are different colours`, roles.ink !== roles.accent && roles['ink-hover'] !== roles.accent, `${roles.ink} / ${roles.accent}`);

  if (drink === 'tea' && theme === 'light'){
    // ---- (b) each class on each level, by what the browser draws ----
    const draw = await frameDoc(page, (d, LV) => {
      const win = d.defaultView, root = d.documentElement; root.classList.add('rb-still');
      const probe = d.createElement('i'); d.body.append(probe);
      const read = css => { probe.style.cssText = `outline-style: solid; ${css}`; const c = win.getComputedStyle(probe); return { color: c.outlineColor, width: c.outlineWidth, offset: c.outlineOffset, radius: c.borderTopLeftRadius, shadow: c.boxShadow }; };
      const CASES = { 'rb-prev': { w: 'line', c: 'accent', style: 'solid' },
        'rb-find': { w: 'hair', c: 'accent', style: 'solid' }, 'rb-miss': { w: 'hair', c: 'miss', style: 'dashed' }, 'rb-lift': { w: 'line', c: 'ink', style: 'none' } };      // (the lift: no outline, direct editing C)
      const out = [];
      for (const [lv, spec] of Object.entries(LV)){
        const el = d.querySelectorAll(spec.sel)[spec.n]; if (!el){ out.push({ lv, missing: true }); continue; }
        const want = off => read(`outline-offset: var(--plate-off-${off}); border-radius: var(--plate-r)`);
        const shape = want(spec.token);
        for (const [cls, c] of Object.entries(CASES)){
          el.classList.add(cls); el.style.setProperty('--plate-paper', '#fff');
          const cs = win.getComputedStyle(el), got = { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow };
          const w = read(`outline-width: var(--plate-${c.w}); outline-color: var(--plate-${c.c})`);
          const bad = [];
          if (got.style !== c.style) bad.push(`style ${got.style}`);
          if (c.style !== 'none' && got.width !== w.width) bad.push(`width ${got.width} != ${w.width}`);
          if (c.style !== 'none' && got.color !== w.color) bad.push(`color ${got.color} != ${w.color}`);
          if (got.offset !== shape.offset) bad.push(`offset ${got.offset} != ${shape.offset}`);
          if (got.radius !== shape.radius) bad.push(`radius ${got.radius} != ${shape.radius}`);
          // (the lighter lift, direct editing C item 6: the hover wash over the paper, a small shadow)
          if (cls === 'rb-lift'){ const sh = read(`box-shadow: inset 0 0 0 100vmax var(--plate-tint-hover), 0 0 0 var(--plate-off-${spec.token}) var(--plate-tint-hover), 0 0 0 var(--plate-off-${spec.token}) var(--plate-paper), var(--plate-lift) var(--plate-off-${spec.token}) var(--plate-lift-sh)`).shadow; if (got.shadow !== sh) bad.push(`shadow ${got.shadow} != ${sh}`); }
          else if (cls !== 'rb-ring' && cls !== 'rb-miss' && !/inset/.test(got.shadow)) bad.push(`no tint: ${got.shadow}`);
          out.push({ lv, cls, bad });
          el.classList.remove(cls); el.style.removeProperty('--plate-paper');
        }
        // hover and selection: the plate that moves (UX-6f 4c), laid over the block at its level's stand-off, its corner the block's radius turned by it
        // (the ladder, lab v2 "light": hover is the wash alone, no edge; selected a 1px edge in the plate ink, lighter on a job and a section by its --pe)
        for (const [role, c] of Object.entries({ hot: { w: '0px', c: 'transparent' }, sel: { w: '0px', c: 'transparent' } })){      // (direct editing C, round 3: selected is a deeper wash, no edge)
          const pl = d.createElement('div'), ecs = win.getComputedStyle(el);
          pl.className = `rb-plate is-${role} is-on`; for (const k of ['--po', '--pk', '--pe']) pl.style.setProperty(k, ecs.getPropertyValue(k)); d.body.append(pl);
          const cs = win.getComputedStyle(pl), w = read(`--pe: ${ecs.getPropertyValue('--pe')}; outline-width: ${c.w}; outline-color: ${c.c}`), rr = read(`border-radius: calc(var(--plate-r) + var(--plate-off-${spec.token}))`).radius, bad = [];
          if (cs.outlineStyle !== 'solid') bad.push(`style ${cs.outlineStyle}`);
          if (cs.outlineWidth !== w.width) bad.push(`width ${cs.outlineWidth} != ${w.width}`);
          if (cs.outlineColor !== w.color) bad.push(`color ${cs.outlineColor} != ${w.color}`);
          if (cs.borderTopLeftRadius !== rr) bad.push(`radius ${cs.borderTopLeftRadius} != ${rr}`);
          if (cs.mixBlendMode !== 'multiply' || /rgba\(0, 0, 0, 0\)/.test(cs.backgroundColor)) bad.push(`tint ${cs.backgroundColor} ${cs.mixBlendMode}`);
          if (cs.pointerEvents !== 'none' || pl.closest('.document')) bad.push('not furniture');
          out.push({ lv, cls: `rb-plate is-${role}`, bad }); pl.remove();
        }
      }
      probe.remove(); root.classList.remove('rb-still');
      return out;
    }, Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [k, { sel: v.sel, n: v.n, token: v.token }])));
    const bads = draw.filter(o => o.missing || o.bad?.length);
    ok('plate: each class (and the plate that moves, hovered and selected) draws what the tokens say on a line, a group, a job and a section: width, style, colour, stand-off, radius and shadow', draw.length >= 24 && bads.length === 0, JSON.stringify(bads.slice(0, 6)));
    // one stand-off per level, the same for every state (the offsets are the level's, and bigger for bigger blocks)
    const offs = await page.evaluate(() => { const g = n => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--plate-off-${n}`)); return { line: g('line'), group: g('group'), job: g('job'), section: g('section') }; });
    ok('plate: the stand-off grows with the level (group, line, job, section) and the code that places things by it reads the same numbers', offs.group > 0 && offs.group <= offs.line && offs.line < offs.job && offs.job < offs.section
      && await page.evaluate(async o => { const { off } = await import('/src/ui/plate.js'); return ['line', 'group', 'job', 'section'].every(k => off(k) === o[k]); }, offs), JSON.stringify(offs));
  }
  ok(`plate: ${tag}: no console errors`, bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

// ---- (c) the real states, per level ----
if (part('c')) {
  const { ctx, page, bad } = await open('tea', 'light');
  await openByName(page, 'Medtech');
  const st = (lv) => frameDoc(page, (d, spec) => {
    const el = d.querySelectorAll(spec.sel)[spec.n], win = d.defaultView, cs = el && win.getComputedStyle(el);
    const on = c => [...d.querySelectorAll(`.${c}`)];
    const pl = el && window.__wb.sheet.plates().find(p => p.el === el), pc = pl && win.getComputedStyle(pl.div), er = el?.getBoundingClientRect(), pr = pl?.div.getBoundingClientRect();      // its plate: the shape that moves (UX-6f 4c)
    return { cls: el ? [...el.classList].filter(c => c.startsWith('rb-')) : null, hot: on('rb-hot').length, sel: on('rb-sel').length, lift: on('rb-lift').length, socket: on('rb-socket').length, ring: on('rb-ring').length, plates: window.__wb.sheet.plates().length,
      outline: pl ? { style: pc.outlineStyle, width: pc.outlineWidth, offset: `${Math.round(pr.right - er.right)}px`, role: pl.role } : null, writing: d.documentElement.classList.contains('rb-writing') };
  }, { sel: LEVELS[lv].sel, n: LEVELS[lv].n, token: LEVELS[lv].token });
  const tok = name => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  const off = async lv => `${await tok(`--plate-off-${LEVELS[lv].token}`)}`;
  const px = v => `${parseFloat(v)}px`;

  // hover: the pointer settles on the block, and it, alone, has the hover plate
  for (const lv of ['line', 'group', 'job', 'section']){
    await rest(page);
    const spec = LEVELS[lv], b = await box(page, spec.head ?? spec.sel, spec.head ? 0 : spec.n), at = spec.at ? spec.at(b) : { x: b.x + Math.min(40, b.width / 2), y: b.y + 6 };
    await glide(page, at.x, at.y);
    const s = await st(lv);
    ok(`plate: ${lv}: hover is the wash plate (no edge) on that block and no other`, s.cls?.includes('rb-hot') && s.hot === 1 && s.sel === 0 && s.plates === 1 && s.outline?.role === 'hot' && s.outline.width === '0px' && s.outline.offset === px(await off(lv)), JSON.stringify(s));
    // the grip's dots are the plate's own (direct editing C, item 4): they show as the pointer nears the left side, in the plate's tab; the grip is a clear button over it
    await page.mouse.move(b.x + 6, at.y, { steps: 6 }); await page.waitForTimeout(400);
    const tab = await page.evaluate(() => { const g = [...document.querySelectorAll('#handlay .obgrip')].find(e => !e.hidden), p = window.__wb.sheet.plates().find(q => q.div.classList.contains('is-grip')); if (!g || !p) return null; const c = getComputedStyle(g), dots = p.div.ownerDocument.defaultView.getComputedStyle(p.div, '::before'); return { bg: c.backgroundColor, shadow: c.boxShadow, dots: dots.content !== 'none' && dots.backgroundImage.includes('radial'), w: g.getBoundingClientRect().width }; });
    ok(`plate: ${lv}: near its left side the plate draws the grip's dots in its own tab; the grip is a clear button, no shadow`, !!tab && tab.dots && /, 0\)$|transparent/.test(tab.bg) && tab.shadow === 'none' && tab.w <= 16, JSON.stringify(tab));
  }
  // selected: the 2px plate, the ring trail behind it
  const select = {
    line: async () => { const b = await box(page, LEVELS.line.sel, 1); await page.mouse.click(b.x + 60, b.y + 6); await page.waitForTimeout(400); await page.keyboard.press('Escape'); await page.mouse.move(4, 4); await page.waitForTimeout(400); },
    group: async () => { const b = await box(page, '.skills__items', 0); await page.mouse.click(b.x + 20, b.y + 6); await page.waitForTimeout(400); await page.keyboard.press('Escape'); await page.mouse.move(4, 4); await page.waitForTimeout(400); },
    job: async () => { await page.click('#outline [data-act=select-section][data-id=experience]'); await page.waitForTimeout(300); await page.click('#body [data-act=select-job][data-id=hydra]'); await page.mouse.move(4, 4); await page.waitForTimeout(400); },
    section: async () => { await page.click('#outline [data-act=select-section][data-id=experience]'); await page.mouse.move(4, 4); await page.waitForTimeout(400); },
  };
  for (const lv of ['line', 'group', 'job', 'section']){
    await rest(page); await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); }); await page.waitForTimeout(300);
    await select[lv]();
    const s = await st(lv);
    ok(`plate: ${lv}: selected is the deeper wash, no edge, at the level's stand-off`, s.cls?.includes('rb-sel') && s.sel >= 1 && s.outline?.role === 'sel' && s.outline.width === '0px' && s.outline.offset === px(await off(lv)), JSON.stringify(s));
    const rings = await frameDoc(page, d => ({ entry: !!d.querySelector('.entry.rb-ring'), band: !!d.querySelector('.band[data-section].rb-ring'), n: d.querySelectorAll('.rb-ring').length }));
    ok(`plate: ${lv}: nothing is drawn round the blocks it is part of (no ring trail: the chip says where it is)`, rings.n === 0, JSON.stringify(rings));
  }
  // writing: the line (and a skill group) recede to a hairline, the field takes the paper
  for (const lv of ['line', 'group']){
    await rest(page); await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); }); await page.waitForTimeout(300);
    const b = await box(page, lv === 'group' ? '.skills__items' : LEVELS.line.sel, lv === 'group' ? 0 : 1);
    await page.mouse.click(b.x + 30, b.y + 6); await page.waitForTimeout(600);
    const w = await frameDoc(page, d => { const e = d.querySelector('[contenteditable]'); if (!e) return null; const pl = window.__wb.sheet.plates().find(p => p.role === 'write'); if (!pl) return { plate: false }; const pc = d.defaultView.getComputedStyle(pl.div), cs = d.defaultView.getComputedStyle(e), r = d.createElement('i'); d.body.append(r); r.style.cssText = 'background-color: var(--plate-paper); outline: 1px solid var(--plate-ink)'; const want = d.defaultView.getComputedStyle(r); const o = { style: pc.outlineStyle, width: pc.outlineWidth, color: pc.outlineColor === want.outlineColor, paper: cs.backgroundColor === want.backgroundColor, inner: /inset/.test(cs.boxShadow), hot: window.__wb.sheet.plates().filter(p => p.role !== 'write').length, own: cs.outlineStyle }; r.remove(); return o; });
    ok(`plate: ${lv}: writing is pressed in: a thin rule (--plate-write, the plate's, UX-6f 4c) in the selection ink, the field the paper's colour with a soft inner shadow, no other plate on it`, !!w && w.own === 'none' && w.style === 'solid' && w.width === (await frameDoc(page, d => { const i = d.createElement('i'); d.body.append(i); i.style.cssText = 'outline: var(--plate-write) solid'; const v = d.defaultView.getComputedStyle(i).outlineWidth; i.remove(); return v; })) && w.color && w.paper && w.inner && w.hot === 0, JSON.stringify(w));
  }
  // lifted: the plate rises with the larger press shadow, and its home keeps a dashed socket of the same shape
  for (const lv of ['line', 'group', 'job', 'section']){
    await rest(page); await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); }); await page.waitForTimeout(300);
    const spec = LEVELS[lv], home = await box(page, spec.sel, spec.n);
    const grab = lv === 'line' || lv === 'group' ? { x: home.x + 40, y: home.y + 6 } : (b => ({ x: b.x + 30, y: b.y + 6 }))(await box(page, spec.head, 0));
    await glide(page, grab.x, grab.y);
    await page.mouse.down(); await page.mouse.move(grab.x + 6, grab.y + 24, { steps: 6 }); await page.mouse.move(grab.x + 8, grab.y + 70, { steps: 8 }); await page.waitForTimeout(500);
    const s = await frameDoc(page, (d, spec) => {
      const home = d.querySelectorAll(spec.sel)[spec.n], big = home.classList.contains('rb-fold'), el = big ? d.querySelector('.rb-card') : home, cs = d.defaultView.getComputedStyle(el), so = d.querySelector('.rb-socket'), sc = so && d.defaultView.getComputedStyle(so);      // a large block (a section such as Experience) is carried as its card, and its home folds to its heading
      const probe = d.createElement('i'); d.body.append(probe);
      probe.style.cssText = `box-shadow: inset 0 0 0 100vmax var(--plate-tint-hover), 0 0 0 var(--plate-off-${spec.token}) var(--plate-tint-hover), 0 0 0 var(--plate-off-${spec.token}) var(--plate-paper), var(--plate-lift) var(--plate-off-${spec.token}) var(--plate-lift-sh)`;
      const want = d.defaultView.getComputedStyle(probe), res = { lifted: el.classList.contains(big ? 'rb-card' : 'rb-lift'), big, shadow: cs.boxShadow === want.boxShadow, outline: cs.outlineStyle === 'none', n: d.querySelectorAll('.rb-lift, .rb-card').length, hot: d.querySelectorAll('.rb-hot').length,
        socket: so ? { bg: sc.backgroundColor, style: sc.outlineStyle, width: sc.outlineWidth, offset: sc.outlineOffset, radius: sc.borderTopLeftRadius, w: Math.round(so.getBoundingClientRect().width), h: Math.round(so.getBoundingClientRect().height), n: d.querySelectorAll('.rb-socket').length } : null, nLift: d.querySelectorAll('.rb-lift, .rb-fold').length, el: { w: Math.round(home.getBoundingClientRect().width), h: Math.round(big ? parseFloat(home.style.getPropertyValue('--fold')) : home.getBoundingClientRect().height), offset: cs.outlineOffset, radius: cs.borderTopLeftRadius } };
      probe.remove(); return res;
    }, { sel: spec.sel, n: spec.n, token: spec.token });
    ok(`plate: ${lv}: lifted is the same plate risen: the wash, a small lift shadow, no outline, and nothing else drawn on it${lv === 'section' ? ' (a section is carried as its card, its home folded)' : ''}`, s.lifted && s.shadow && s.outline && s.n >= 1 && s.hot === 0, JSON.stringify(s));
    // (UX-6f 4c, rewritten: the socket is the plate's shape as drawn: the home's box grown by its stand-off fitted to the words around it, no further than the level's, its corner turned by it)
    const so = s.socket && { x: (s.socket.w - s.el.w) / 2, y: (s.socket.h - s.el.h) / 2 }, tokOff = parseFloat(await tok(`--plate-off-${spec.token}`)), r0 = parseFloat(await tok('--plate-r'));
    ok(`plate: ${lv}: its home keeps a shaded socket of the plate's shape, no outline (its box grown by the fitted stand-off, never past the level's, its corner turned by it), one for each element lifted`, !!so && s.socket.style === 'none' && !/, 0\)$|transparent/.test(s.socket.bg) && s.socket.n === s.nLift && s.socket.offset === '0px' && [so.x, so.y].every(v => v >= -2.6 && v <= tokOff + .6) && Math.abs(parseFloat(s.socket.radius) - (r0 + Math.max(so.x, so.y))) <= .6, JSON.stringify({ s, so }));
    await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(500);
    const gone = await frameDoc(page, d => d.querySelectorAll('.rb-socket, .rb-lift, .rb-card, .rb-fold').length);
    ok(`plate: ${lv}: the socket and the lift are gone when it is put back`, gone === 0, String(gone));
  }
  // a row of the sidebar lights its line with the page's own hover plate (the same shape, x1.4 the wash, no outline of its own)
  await rest(page);
  const acc = await page.evaluate(async () => {
    const w = window.__wb, ix = w.ui.ix, fact = [...ix.facts.keys()].find(k => k.startsWith('hydra-testing'));
    w.sheet.setHover(fact, ix); await new Promise(r => setTimeout(r, 400));
    const d = document.querySelector('#sheet iframe').contentDocument, pl = d.querySelectorAll('.rb-plate.is-hot.is-boost.is-on'), cs = pl[0] && d.defaultView.getComputedStyle(pl[0]);
    const res = pl.length === 1 ? { n: 1, outline: cs.outlineWidth, op: +cs.opacity, old: d.querySelectorAll('.rb-hover').length, radius: cs.borderTopLeftRadius } : { n: pl.length };
    w.sheet.setHover(null, ix); await new Promise(r => setTimeout(r, 400)); return res;      // (and its plate is let go before the next test)
  });
  ok('plate: a row of the sidebar lights its line with the hover plate, stronger (is-boost), in the plate\'s shape: no outline, no old mark', !!acc && acc.n === 1 && acc.outline === '0px' && acc.op === 1 && acc.old === 0, JSON.stringify(acc));
  ok('plate: no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

// ---- (d) hover is intent, not a reflex (UX-6f 1b) ----
for (const motion of part('d') ? [true, false] : []){
  const { ctx, page, bad } = await open('tea', 'light', motion);
  await openByName(page, 'Medtech');
  const tag = motion ? 'with motion' : 'reduced motion';
  const plate = () => page.evaluate(() => window.__wb.hands.plate?.() ?? null);
  const lines = async () => { const out = []; for (let i = 0; i < 6; i++) out.push(await box(page, '.entry:first-child .bullets li', i)); return out; };
  const keyOf = async i => frameDoc(page, (d, n) => d.querySelectorAll('.entry:first-child .bullets li')[n].getAttribute('data-variant'), i);
  const record = () => page.evaluate(() => { window.__rec = []; window.__gap = 0; let last = 0; const d = document.querySelector('#sheet iframe').contentDocument; window.__recL = () => { const n = performance.now(); if (last && n - last > window.__gap) window.__gap = n - last; last = n; }; d.addEventListener('pointermove', window.__recL); const f = () => { const p = window.__wb.hands.plate?.() ?? null; window.__rec.push({ t: performance.now(), ...p }); window.__raf = requestAnimationFrame(f); }; f(); });
  const stopRec = () => page.evaluate(() => { cancelAnimationFrame(window.__raf); document.querySelector('#sheet iframe').contentDocument.removeEventListener('pointermove', window.__recL); return window.__rec; });
  // a sweep only counts when the browser kept the pace of its events (no gap of 35 ms or more between two: a pointer that has stopped is a stop): else it is run again
  const pace = () => page.evaluate(() => window.__gap);
  const sheetBox = await page.locator('#sheet iframe').boundingBox();
  const desk = { x: (await page.locator('#col').boundingBox()).x - 6, y: 120 };      // off the page, at the sidebar's edge: its rows light their blocks now, so no sweep ends or crosses on them
  // a fast sweep: from off the page across several blocks, in one burst
  const sweep = async (L, steps = 10) => { await page.mouse.move(sheetBox.x - 30, L[0].y - 20); await page.mouse.move(L[5].x + 100, L[5].y + 6, { steps }); };      // one move: a burst of events, a few ms apart
  // …and the same slowly (200 px/s)
  const slow = async L => { await page.mouse.move(L[0].x + 100, L[0].y - 6); for (let y = L[0].y; y <= L[5].y + 6; y += 5){ await page.mouse.move(L[0].x + 100, y); await page.waitForTimeout(25); } };
  let L = await lines();
  await rest(page);
  let rec, end, gap;
  for (let tries = 0; tries < 6; tries++){
    await rest(page); L = await lines();
    await page.mouse.move(sheetBox.x - 30, L[0].y - 20); await record(); await page.mouse.move(desk.x, L[5].y + 30, { steps: 25 }); await page.waitForTimeout(350);
    rec = await stopRec(); end = await plate(); gap = await pace();
    if (gap < 35) break;
  }
  ok(`intent: ${tag}: a fast sweep across five blocks and off the page leaves no plate above 20% at any sampled frame, and none hovered at the end`, gap < 35 && rec.length > 10 && rec.every(r => r.a <= .2) && !!end && end.hot === null && end.hots === 0, JSON.stringify({ frames: rec.length, max: Math.max(...rec.map(r => r.a)), end }));
  await rest(page); L = await lines();
  await record(); await slow(L); await page.waitForTimeout(400);
  rec = await stopRec(); end = await plate();
  const stop = await keyOf(5);
  ok(`intent: ${tag}: the same sweep, slowed, shows the block it stops on, and never two hovered at once`, rec.length > 10 && rec.every(r => r.hots <= 1) && !!end && end.hot === stop && Math.max(...rec.map(r => r.hots)) === 1, JSON.stringify({ end, stop, hots: Math.max(...rec.map(r => r.hots)) }));
  if (motion){
    // the plates fade: the one it left fades out while the next fades in, so for a moment two are drawn, one hovered
    // the plate moves (UX-6f 4c, no longer a cross-fade): one plate travels from block to block, never two drawn
    ok('intent: with motion the slow sweep glides: one plate travels from block to block, and never two are drawn', rec.some(r => r.moving) && rec.every(r => r.n <= 1), JSON.stringify({ moving: rec.filter(r => r.moving).length, two: rec.filter(r => r.n > 1).length }));
  } else {
    ok('intent: with reduced motion the plate is there at once (no fade in any frame) and goes at once', rec.every(r => r.n === 0 || r.a === 1 || r.hots === 0) && rec.every(r => r.n <= 1), JSON.stringify(rec.filter(r => r.n > 1).slice(0, 3)));
  }
  // a stop after a fast sweep shows the plate within 150 ms
  let tStop;
  for (let tries = 0; tries < 6; tries++){
    await rest(page); L = await lines();
    await record(); await sweep(L); tStop = await page.evaluate(() => performance.now()); await page.waitForTimeout(400);
    rec = await stopRec(); gap = await pace();
    if (gap < 35) break;
  }
  const first = rec.find(r => r.hot === stop && r.t >= tStop - 30), early = rec.filter(r => r.t < tStop - 20 && r.a > .2);
  ok(`intent: ${tag}: a stop after a fast sweep shows the plate within 150 ms, and not before it`, gap < 35 && !!first && first.t - tStop <= 150 && early.length === 0, JSON.stringify({ after: first && Math.round(first.t - tStop), early: early.length }));
  // a press, a focus and an arrow step show their plate with no delay
  await rest(page); L = await lines();
  await page.mouse.move(sheetBox.x - 30, L[3].y + 4); await page.mouse.move(L[3].x + 100, L[3].y + 6, { steps: 2 }); await page.mouse.down();
  const down = await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(window.__wb.hands.plate?.() ?? null)))));
  await page.mouse.up(); await page.keyboard.press('Escape');
  ok(`intent: ${tag}: a press shows the plate at once, with no speed test (a pointer that has only just arrived)`, !!down && down.hot === await keyOf(3), JSON.stringify(down));
  await rest(page); L = await lines();
  await page.mouse.click(L[2].x + 100, L[2].y + 6); await page.waitForTimeout(300); await page.keyboard.press('Escape'); await page.mouse.move(desk.x, desk.y); await page.waitForTimeout(400);
  await page.focus('#handlay .obgrip:not(.obfgrip)');
  const foc = await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(window.__wb.hands.plate?.() ?? null))));
  ok(`intent: ${tag}: a grip in focus shows its block's plate at once, the pointer nowhere near`, !!foc && foc.hot === await keyOf(2), JSON.stringify(foc));
  await rest(page); L = await lines();      // (with motion the writing zoom moved the page: measured again)
  await page.mouse.click(L[2].x + 100, L[2].y + 6); await page.waitForTimeout(300); await page.keyboard.press('Escape'); await page.mouse.move(desk.x, desk.y); await page.waitForTimeout(500);
  const sel0 = await frameDoc(page, d => d.querySelector('.rb-sel')?.getAttribute('data-variant') ?? null);
  await page.keyboard.press('ArrowDown');
  const arrow = await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(document.querySelector('#sheet iframe').contentDocument.querySelector('.rb-sel')?.getAttribute('data-variant') ?? null))));
  ok(`intent: ${tag}: an arrow-key step shows the next block's plate at once`, !!sel0 && !!arrow && arrow !== sel0, JSON.stringify({ sel0, arrow }));
  // leaving the page cancels a pending hover at once, and nothing fades in after the pointer has gone
  await rest(page); L = await lines();
  await page.mouse.move(L[1].x + 100, L[1].y - 6); for (let y = L[1].y - 6; y <= L[1].y + 4; y += 5){ await page.mouse.move(L[1].x + 100, y); await page.waitForTimeout(20); }
  await record(); await page.mouse.move(L[1].x + 100, L[1].y + 6); await page.mouse.move(desk.x, desk.y, { steps: 3 }); await page.waitForTimeout(400);
  rec = await stopRec(); end = await plate();
  const after = rec.slice(rec.findIndex(r => r.hots === 0));
  ok(`intent: ${tag}: leaving the page right after arriving cancels the hover at once, and nothing fades in after the pointer has gone`, !!end && end.hot === null && end.a === 0 && after.length > 5 && after.every((r, i) => i === 0 || r.a <= after[i - 1].a + .001) && after.every(r => r.hots === 0), JSON.stringify({ end, after: after.length }));
  // into the sidebar over a block and out leaves nothing hovered
  await rest(page); L = await lines();
  await glide(page, L[1].x + 100, L[1].y + 6);
  const before = await plate();
  const side = await page.locator('#col').boundingBox();
  await page.mouse.move(side.x + 80, side.y + 20, { steps: 8 });      // (over the sidebar's head, not a row: a row lights its block) await page.waitForTimeout(300);
  const inSide = await plate();
  await page.mouse.move(desk.x, 40, { steps: 5 }); await page.waitForTimeout(300);
  const out = await plate();
  ok(`intent: ${tag}: a block hovered, then the sidebar, then out again: nothing is hovered (and no plate is drawn)`, !!before && before.hot !== null && inSide?.hot === null && inSide.hots === 0 && out?.hot === null && out.a === 0, JSON.stringify({ before, inSide, out }));
  // hovering never changes what the page says or the sidebar shows (nothing selected, nothing written)
  ok(`intent: ${tag}: hover from the page selects nothing and writes nothing`, await page.evaluate(() => window.__wb.ui.sel.kind === 'none' && !window.__wb.ui.writing));
  ok(`intent: ${tag}: no console errors`, bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

// ---- (e) UX-6f 4c ----
// the plate drawn now (hover, else selection), in window pixels: its edges (where its line starts) and its outer corner's radius on the camera's scale
const drawnPlate = page => page.evaluate(() => {
  const w = window.__wb, p = w.sheet.plates().find(q => q.role === 'hot') ?? w.sheet.plates().find(q => q.role === 'sel'); if (!p) return null;
  const s = w.canvas.screenRect(p.div.getBoundingClientRect()), k = w.canvas.cam.k;
  return { left: s.left, top: s.top, bottom: s.top + s.height, r: parseFloat(p.div.ownerDocument.defaultView.getComputedStyle(p.div).borderTopRightRadius) * k };      // (its left corners are square where the grip stands)
});
// 4c-1: writing is lighter: what the written line draws (its rule and its paper) stays inside its own box plus half the gap to the printed text around it
const writtenShape = page => frameDoc(page, d => {
  const el = d.querySelector('[contenteditable]:not([contenteditable=false])'); if (!el) return null;
  const cs = d.defaultView.getComputedStyle(el), r = el.getBoundingClientRect();
  const spread = Math.max(0, ...[...cs.boxShadow.matchAll(/(?:^|,)\s*(?:rgba?\([^)]*\)\s*)?(-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px(?!.*inset)/g)].filter(m => !/inset/.test(m[0])).map(m => +m[4] + Math.max(Math.abs(+m[1]), Math.abs(+m[2]))));
  // the written field's own outline and paper, and (UX-6f 4c) the plate laid over it, its rule drawn outside its box
  const pl = window.__wb?.sheet.plates?.().find(p => p.role === 'write'), pr = pl?.div.getBoundingClientRect(), pw = pl ? parseFloat(d.defaultView.getComputedStyle(pl.div).outlineWidth) : 0;
  const tw = pl ? parseFloat(pl.div.style.getPropertyValue('--tw')) || 0 : 0;      // (the grip's tab, direct editing C item 4: the plate widens into it only where the words on its rows leave room)
  const plateExt = pr ? Math.max(r.left - pr.left - tw, r.top - pr.top, pr.right - r.right, pr.bottom - r.bottom) + pw : 0;
  const ext = Math.max(cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth), spread, plateExt);
  const walker = d.createTreeWalker(d.querySelector('.document'), 4), rg = d.createRange(), near = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()){
    if (!n.nodeValue.trim() || el.contains(n)) continue;
    rg.selectNodeContents(n);
    for (const q of rg.getClientRects()){ if (q.width < 1 || q.height < 1) continue; const cx = q.left + q.width / 2, cy = q.top + q.height / 2; if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) continue;
      near.push(Math.hypot(Math.max(q.left - r.right, r.left - q.right, 0), Math.max(q.top - r.bottom, r.top - q.bottom, 0))); }
  }
  const gap = Math.min(...near);
  return { ext: Math.round(ext * 100) / 100, gap: Math.round(gap * 100) / 100, width: cs.outlineWidth, offset: cs.outlineOffset, spread };
});
for (const motion of part('e') ? [true, false] : []){
  const { ctx, page, bad } = await open('tea', 'light', motion);
  await openByName(page, 'Medtech');
  const tag = motion ? 'with motion' : 'reduced motion';
  const WRITE = { 'a middle line': ['.entry:first-child .bullets li', 2, 60], 'the first line of a job': ['.entry:first-child .bullets li', 0, 60], 'a skill group': ['.skills__items', 0, 20], 'the summary': ['.summary', 0, 40], 'a job title': ['.entry:first-child .role-title', 0, 20] };
  for (const [name, [sel, n, dx]] of Object.entries(WRITE)){
    await rest(page); await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); window.__wb.canvas.reset({ page: 0 }); }); await page.waitForTimeout(900);      // (the camera comes back out from the writing zoom)
    const b = await box(page, sel, n); if (!b){ ok(`4c-1: ${tag}: ${name} is on the page`, false); continue; }
    await page.mouse.click(b.x + dx, b.y + 6); await page.waitForTimeout(500); if (!(await page.evaluate(() => window.__wb.ui.writing))) await page.mouse.click(b.x + dx, b.y + 6); await page.waitForTimeout(900);
    const w = await writtenShape(page);
    ok(`4c-1: ${tag}: writing ${name}: nothing it draws passes half the gap to the text around it`, !!w && w.ext <= w.gap / 2 + .3, JSON.stringify(w));
    ok(`4c-1: ${tag}: writing ${name}: its drawn shape covers no neighbour's text`, !!w && w.ext < w.gap, JSON.stringify(w));
  }
  // 4c-2 (rewritten for the joined control): the version pill and the ↑ ↓ beside a written line: one row at the right of the line, ONE control with one opaque face tinted
  // from the plate, a thin edge, the plate's corner, visible against the paper; the parts have no face of their own at rest, the arrows in the paper's ink (readable on the face
  // over the desk too) and the plate's corner; the same targets as before
  {
    await rest(page); await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); window.__wb.canvas.reset({ page: 0 }); }); await page.waitForTimeout(900);
    const b = await box(page, '.entry:first-child .bullets li', 2); await page.mouse.click(b.x + 60, b.y + 6); await page.waitForTimeout(900);
    const t = await page.evaluate(() => {
      const q = s => document.querySelector(`#editlay ${s}`), cs = e => getComputedStyle(e), bar = q('.obtools'), tag = q('.obv'), up = q('[data-act=ob-up]'), down = q('[data-act=ob-down]'), probe = document.createElement('i');
      if (!bar || !tag || !up || !down) return null;
      document.body.append(probe); probe.style.cssText = 'color: var(--paper-ink); border-radius: calc(var(--plate-r) + var(--plate-off-line)); background: var(--paper)'; const want = { ink: cs(probe).color, r: cs(probe).borderTopLeftRadius, paper: cs(probe).backgroundColor }; probe.remove();
      const r = e => e.getBoundingClientRect(), lum = c => { const k = document.createElement('canvas').getContext('2d'); k.fillStyle = c; k.fillRect(0, 0, 1, 1); const [R, G, B] = [...k.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * R + .7152 * G + .0722 * B; };
      const ring = cs(bar).boxShadow.match(/(rgba?|color)\([^)]*\)/)?.[0] ?? '', cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      return { row: { pill: r(tag).left, up: r(up).left, down: r(down).left, tops: [r(tag), r(up), r(down)].map(x => Math.round((x.top + x.bottom) / 2)) },
        bar: { bg: cs(bar).backgroundColor, shadow: cs(bar).boxShadow, border: cs(bar).borderTopWidth, r: cs(bar).borderTopLeftRadius, faceVsPaper: cr(cs(bar).backgroundColor, want.paper) }, tag: { bg: cs(tag).backgroundColor, ring, r: cs(tag).borderTopLeftRadius, h: Math.round(r(tag).height), w: Math.round(r(tag).width), faceVsPaper: cr(cs(bar).backgroundColor, want.paper), edgeVsPaper: ring ? cr(ring, want.paper) : 0 },
        up: { color: cs(up).color, r: cs(up).borderTopLeftRadius, w: Math.round(r(up).width), h: Math.round(r(up).height) }, want };
    });
    const clear = c => /rgba\(0, 0, 0, 0\)|transparent/.test(c);
    ok(`4c-2: ${tag}: the tools beside a written line stand in one row: the version pill, then ↑, then ↓, level with each other`, !!t && t.row.pill < t.row.up && t.row.up < t.row.down && Math.max(...t.row.tops) - Math.min(...t.row.tops) <= 1, JSON.stringify(t));
    ok(`4c-2: ${tag}: the control (pill and arrows joined) has ONE opaque face tinted from the plate, a thin edge and the plate's corner; the pill has none of its own`, !!t && !clear(t.bar.bg) && t.bar.bg !== t.want.paper && t.bar.faceVsPaper > 1.02 && t.bar.r === t.want.r && t.bar.shadow !== 'none' && t.bar.border === '0px' && clear(t.tag.bg), JSON.stringify(t));
    ok(`4c-2: ${tag}: the control's edge shows against the paper at rest (at least 1.5 to 1), and the arrows wear the plate's corner and the paper's ink`, !!t && t.tag.edgeVsPaper >= 1.5 && t.up.r === t.want.r && t.up.color === t.want.ink, JSON.stringify(t));
    ok(`4c-2: ${tag}: their targets are as big as before (the pill 28 px tall, the arrows 28 px square, a control box)`, !!t && t.tag.h >= 28 && t.tag.w >= 28 && t.up.w >= 28 && t.up.h >= 28, JSON.stringify(t));
  }
  // 4c-3 (rewritten for direct editing C: the plate's ladder): the "+": under a line that is not the job's last it is a shaded pill of its own (the wash, no edge but a faint
  // hairline round it, round corners); on the last line it is the plate's bottom tab, the same wash, no edge, square at the top; between the two it changes with an
  // animation (none under reduced motion)
  {
    await rest(page); await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); window.__wb.canvas.reset({ page: 0 }); }); await page.waitForTimeout(900);
    const job = page.frameLocator('#sheet iframe').locator('.band[data-section=experience] .entry').first().locator('.bullets li'), n = await job.count();
    const plusNow = () => page.evaluate(() => { const p = document.querySelector('#handlay .obplus'); if (!p || p.hidden) return null; const c = getComputedStyle(p), r = p.getBoundingClientRect();
      return { free: p.classList.contains('is-free'), top: r.top, bw: parseFloat(c.borderTopWidth), wash: /gradient/.test(c.backgroundImage), ring: c.boxShadow, tc: parseFloat(c.borderTopWidth) > 0 ? c.borderTopColor : 'transparent', lc: c.borderLeftColor, tl: parseFloat(c.borderTopLeftRadius), bl: parseFloat(c.borderBottomLeftRadius), anims: p.getAnimations().filter(a => a.transitionProperty).length }; });
    const mid = await job.nth(1).boundingBox(); await glide(page, mid.x + 60, mid.y + 6);
    const a = await plusNow();
    ok(`4c-3: ${tag}: under a middle line the "+" is a shaded pill of its own: the wash, no edge (a faint hairline round it), four round corners`, !!a && a.free && a.wash && a.bw === 0 && a.ring !== 'none' && a.tl > 0 && a.bl > 0, JSON.stringify(a));
    const last = await job.nth(n - 1).boundingBox(), prev = await job.nth(n - 2).boundingBox();
    await glide(page, prev.x + 60, prev.y + 6);
    await page.evaluate(() => { window.__plusRec = []; const f = () => { const p = document.querySelector('#handlay .obplus'); if (p && !p.hidden){ const c = getComputedStyle(p); window.__plusRec.push({ tc: c.borderTopColor, tl: c.borderTopLeftRadius, anims: p.getAnimations().filter(a => a.transitionProperty).length }); } window.__plusRaf = requestAnimationFrame(f); }; f(); });
    for (let k = 1; k <= 8; k++){ await page.mouse.move(last.x + 60, prev.y + 6 + (last.y - prev.y) * k / 8); await page.waitForTimeout(20); }
    await page.waitForTimeout(400);
    const rec = await page.evaluate(() => { cancelAnimationFrame(window.__plusRaf); return window.__plusRec; });
    const z = await plusNow();
    const edge = (await drawnPlate(page))?.bottom;      // where the last line's plate as drawn (its stand-off, fitted to the words around it) ends: the plate's line is drawn from there out
    ok(`4c-3: ${tag}: on the job's last line the "+" is the plate's bottom tab: the plate's wash, no edge, square at the top`, !!z && !z.free && z.wash && z.bw === 0 && z.ring === 'none' && z.tl === 0 && Math.abs(z.top - edge) < 1.5, JSON.stringify({ z, edge }));
    const between = rec.filter(r => r.anims > 0 || (r.tl !== '0px' && r.tl !== rec.at(-1)?.tl && r.tl !== rec[0]?.tl));
    ok(`4c-3: ${tag}: between the two forms the "+" ${motion ? 'changes with an animation' : 'changes at once (no animation)'}`, motion ? between.length > 0 : between.length === 0, JSON.stringify({ frames: rec.length, between: between.length }));
  }
  // 4c-4 (rewritten for direct editing C, item 4): the grip is part of the plate: its dots are in the plate's left tab, the plate widened into it where the words leave room,
  // and its button lies over that tab, inside the plate's box; while a line is written the dots stay at about 40%, and full again under the pointer
  for (const lv of ['line', 'group', 'job', 'section']){
    await rest(page); await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); window.__wb.canvas.reset({ page: 0 }); }); await page.waitForTimeout(900);
    const spec = LEVELS[lv], b = await box(page, spec.head ?? spec.sel, spec.head ? 0 : spec.n), at = spec.at ? spec.at(b) : { x: b.x + Math.min(40, b.width / 2), y: b.y + 6 };
    await glide(page, at.x, at.y); await page.mouse.move(b.x + 6, at.y, { steps: 6 }); await page.waitForTimeout(500);
    const g = await page.evaluate(() => {
      const w = window.__wb, e = [...document.querySelectorAll('#handlay .obgrip')].find(q => !q.hidden), p = w.sheet.plates().find(q => q.div.classList.contains('is-grip')); if (!e || !p) return { e: !!e, p: !!p };
      const q = e.getBoundingClientRect(), r = w.canvas.screenRect(p.div.getBoundingClientRect()), el = w.canvas.screenRect(p.el.getBoundingClientRect()), tw = parseFloat(p.div.style.getPropertyValue('--tw')) * w.canvas.cam.k;
      return { g: [q.left, q.top, q.right, q.bottom].map(Math.round), plate: [r.left, r.top, r.left + r.width, r.top + r.height].map(Math.round), gap: Math.round(el.left - r.left), tw: Math.round(tw), role: p.role };
    });
    const [gl, gt, gr, gb] = g.g ?? [], [pl, pt, pr, pb] = g.plate ?? [];
    ok(`4c-4: ${tag}: ${lv}: the grip's button lies over the plate's left tab, the plate's full height, inside its box${lv === 'line' ? ', the plate widened into the tab' : ''}`,
      !!g.g && Math.abs(gl - pl) <= 1 && Math.abs(gt - pt) <= 1 && Math.abs(gb - pb) <= 1 && gr <= pr && (lv !== 'line' || g.tw > 0), JSON.stringify(g));
  }
  {
    await rest(page); await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); window.__wb.canvas.reset({ page: 0 }); }); await page.waitForTimeout(900);
    const b = await box(page, '.entry:first-child .bullets li', 2); await page.mouse.click(b.x + 60, b.y + 6); await page.waitForTimeout(900);
    const dim = () => page.evaluate(() => { const p = window.__wb.sheet.plates().find(q => q.role === 'write'), e = [...document.querySelectorAll('#handlay .obgrip:not(.obfgrip)')].find(q => !q.hidden); return p && e ? { o: +p.div.ownerDocument.defaultView.getComputedStyle(p.div, '::before').opacity, grip: p.div.classList.contains('is-grip'), r: e.getBoundingClientRect().toJSON() } : null; });
    const d0 = await dim();
    ok(`4c-4: ${tag}: while a line is written its dots stay in its plate's tab, dimmed to about 40%`, !!d0 && d0.grip && d0.o > .3 && d0.o < .5, JSON.stringify(d0));
    if (d0){ await page.mouse.move(d0.r.x + d0.r.width / 2, d0.r.y + d0.r.height / 2, { steps: 4 }); await page.waitForTimeout(400); }
    const d1 = await dim();
    ok(`4c-4: ${tag}: …and full again under the pointer`, !!d1 && d1.o === 1, JSON.stringify(d1));
  }
  // 4c-5: one plate that moves: hover and selection are a shape over the page that glides (place, size and corner, about 120 ms, ease-out) from block to block, a fast
  // sweep shows nothing on the way and the plate then travels to where the pointer settles; reduced motion: it is at its place at once. Frame furniture only.
  {
    const rec0 = role => page.evaluate(r => { window.__pr = []; const f = () => { const p = window.__wb.sheet.plates?.().find(q => q.role === r), b = p?.div.getBoundingClientRect(); window.__pr.push({ t: performance.now(), top: b ? Math.round(b.top * 10) / 10 : null, h: b ? Math.round(b.height * 10) / 10 : null, a: p ? +getComputedStyle(p.div).opacity : 0, n: window.__wb.sheet.plates?.().filter(q => q.role === r).length ?? 0 }); window.__prR = requestAnimationFrame(f); }; f(); }, role);
    const stop0 = () => page.evaluate(() => { cancelAnimationFrame(window.__prR); return window.__pr; });
    const between = (rec, a, b) => rec.filter(r => r.top != null && r.top > Math.min(a, b) + 1 && r.top < Math.max(a, b) - 1);
    // the selection: an arrow step
    await rest(page); await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); window.__wb.canvas.reset({ page: 0 }); }); await page.waitForTimeout(900);
    const l1 = await box(page, '.entry:first-child .bullets li', 1); await page.mouse.click(l1.x + 60, l1.y + 6); await page.waitForTimeout(500); await page.keyboard.press('Escape'); await page.mouse.move(4, 400); await page.waitForTimeout(700);
    const selTop = () => page.evaluate(() => { const p = window.__wb.sheet.plates?.().find(q => q.role === 'sel'); return p ? p.div.getBoundingClientRect().top : null; });
    const s0 = await selTop();
    await rec0('sel'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(500);
    let rec = await stop0(); const s1 = await selTop();
    const mid = s0 != null && s1 != null ? between(rec, s0, s1) : [];
    const done = rec.find(r => r.top != null && Math.abs(r.top - s1) < .6 && rec.indexOf(r) > rec.findIndex(q => q.top != null && Math.abs(q.top - s0) > .6));
    ok(`4c-5: ${tag}: an arrow step ${motion ? 'glides the selection\'s plate to the next line (frames in between, there in under 250 ms)' : 'puts the selection\'s plate on the next line at once (no frame in between)'}`,
      s0 != null && s1 != null && s1 > s0 + 5 && (motion ? mid.length >= 2 && !!done && done.t - rec[0].t < 250 : mid.length === 0) && rec.every(r => r.n <= 1), JSON.stringify({ s0, s1, mid: mid.length, ms: done && Math.round(done.t - rec[0].t), frames: rec.length }));
    // the hover: from one line to the next, slowly
    await rest(page); const L = []; for (let i = 0; i < 6; i++) L.push(await box(page, '.entry:first-child .bullets li', i));
    await glide(page, L[1].x + 100, L[1].y + 6);
    const hTop = () => page.evaluate(() => { const p = window.__wb.sheet.plates?.().find(q => q.role === 'hot'); return p ? p.div.getBoundingClientRect().top : null; });
    const h0 = await hTop();
    await rec0('hot'); for (let k = 1; k <= 6; k++){ await page.mouse.move(L[1].x + 100, L[1].y + 6 + (L[3].y - L[1].y) * k / 6); await page.waitForTimeout(16); } await page.waitForTimeout(400);
    rec = await stop0(); const h1 = await hTop();
    ok(`4c-5: ${tag}: the hover's plate ${motion ? 'travels' : 'jumps'} from line to line as the pointer goes slowly, one plate at every frame`, h0 != null && h1 != null && h1 > h0 + 10 && rec.every(r => r.n <= 1) && (motion ? between(rec, h0, h1).length >= 3 : true), JSON.stringify({ h0, h1, mid: between(rec, h0, h1).length }));
    // a fast sweep across three sections: nothing shows on the way; where it settles the plate comes from where it was (with motion) and stays there
    await rest(page); await page.evaluate(() => window.__wb.canvas.reset({ page: 0 })); await page.waitForTimeout(700);
    const secs = []; for (const sel of ['.summary', '.band[data-section=experience] .role-title', '.band[data-section=education] [data-variant]', '.skills__group']){ const b = await box(page, sel, 0); if (b) secs.push(b); }      // a text in each of four sections
    const A = { x: secs[0].x - 60, y: secs[0].y + 6 - 10 }, Z = { x: secs.at(-1).x - 60, y: secs.at(-1).y + 8 - 10 };      // (the points below are x + 80, y + 10)
    let sw, gap = 99;
    for (let tries = 0; tries < 5 && gap >= 35; tries++){
      await rest(page); await glide(page, A.x + 80, A.y + 10);
      const a0 = await hTop();
      await page.evaluate(() => { window.__gap = 0; let last = 0; const d = document.querySelector('#sheet iframe').contentDocument; window.__gl = () => { const n = performance.now(); if (last && n - last > window.__gap) window.__gap = n - last; last = n; }; d.addEventListener('pointermove', window.__gl); });
      await rec0('hot'); await page.mouse.move(Z.x + 80, Z.y + 10, { steps: 18 }); const tStop = await page.evaluate(() => performance.now()); await page.waitForTimeout(450);
      rec = await stop0(); gap = await page.evaluate(() => { document.querySelector('#sheet iframe').contentDocument.removeEventListener('pointermove', window.__gl); return window.__gap; });
      sw = { a0, tStop, end: await hTop(), rec };
    }
    const during = sw.rec.filter(r => r.t < sw.tStop - 10), after = sw.rec.filter(r => r.t >= sw.tStop);
    const onWay = during.filter(r => r.a > .2 && !(sw.a0 != null && Math.abs(r.top - sw.a0) < 1));      // the plate it left fades out where it was
    ok(`4c-5: ${tag}: a fast sweep over three sections draws no plate on the way (above 20%): the one it left fades where it was`, gap < 35 && during.length > 3 && sw.a0 != null && onWay.length === 0, JSON.stringify({ gap, a0: sw.a0, onWay: onWay.slice(0, 3) }));
    ok(`4c-5: ${tag}: …where it settles the plate ${motion ? 'travels in from where it was (frames in between)' : 'is there at once'} and ends on the block under the pointer, one plate all the way`,
      sw.end != null && sw.end > (sw.a0 ?? 0) + 50 && sw.rec.every(r => r.n <= 1) && (motion ? between(after, sw.a0, sw.end).length >= 1 : between(after.filter(r => r.a > 0), sw.a0, sw.end).length === 0), JSON.stringify({ a0: sw.a0, end: sw.end, mid: between(after, sw.a0, sw.end).length }));
    // frame furniture: never in the document, hidden from assistive tech, takes no pointer
    const furn = await frameDoc(page, d => { const ps = [...d.querySelectorAll('.rb-plate')]; return { n: ps.length, inDoc: !!d.querySelector('.document .rb-plate'), hidden: ps.every(p => p.getAttribute('aria-hidden') === 'true'), events: ps.every(p => d.defaultView.getComputedStyle(p).pointerEvents === 'none') }; });
    ok(`4c-5: ${tag}: the plates are frame furniture: outside the printed document, aria-hidden, no pointer events`, furn.n >= 1 && !furn.inDoc && furn.hidden && furn.events, JSON.stringify(furn));
  }
  // 4c-6: a lifted block (its text, plate and shadow) is the topmost thing on the page: at points over it nothing of the page's or of the app's layers is drawn over it
  for (const lv of ['line', 'group', 'job', 'section']){
    await rest(page); await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); window.__wb.canvas.reset({ page: 0 }); }); await page.waitForTimeout(900);
    const spec = LEVELS[lv], home = await box(page, spec.sel, spec.n);
    const g = lv === 'line' || lv === 'group' ? { x: home.x + 40, y: home.y + 6 } : (b => ({ x: b.x + 30, y: b.y + 6 }))(await box(page, spec.head, 0));
    await glide(page, g.x, g.y);
    await page.mouse.down(); await page.mouse.move(g.x + 6, g.y + 24, { steps: 6 }); await page.mouse.move(g.x + 8, g.y + 60, { steps: 8 }); await page.waitForTimeout(500);
    const top = await page.evaluate(() => {
      const fr = document.querySelector('#sheet iframe'), d = fr.contentDocument, win = d.defaultView, lift = d.querySelector('.rb-lift') ?? d.querySelector('.rb-card'); if (!lift) return null;
      const cs = win.getComputedStyle(lift), po = parseFloat(cs.getPropertyValue('--po')) || 0, r = lift.getBoundingClientRect(), z = +cs.zIndex || 0, card = lift.matches('.rb-card');
      const S = q => window.__wb.canvas.screenRect(q), over = [], pts = [];
      for (let fy = -.15; fy <= 1.151; fy += .1) for (let fx = -.02; fx <= 1.021; fx += .08) pts.push({ x: r.left - po + (r.width + 2 * po) * Math.min(1, Math.max(0, fx + .02)), y: r.top - po + (r.height + 2 * po) * Math.min(1, Math.max(0, fy + .15) / 1.3), inBox: fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1 });
      // the page: what is hit at a point inside its box is the lifted block; and nothing of the frame's furniture stands above it
      for (const p of pts) if (p.inBox && !card){ const e = d.elementFromPoint(p.x, p.y); if (e && !lift.contains(e) && e !== lift) over.push(`page: ${e.tagName}.${e.className}`); }
      for (const e of d.querySelectorAll('body > *:not(.document)')) if (e !== lift && win.getComputedStyle(e).display !== 'none' && (+win.getComputedStyle(e).zIndex || 0) >= z){ const q = e.getBoundingClientRect(); if (q.width && q.right > r.left - po && q.left < r.right + po && q.bottom > r.top - po && q.top < r.bottom + po) over.push(`frame: ${e.className} z ${win.getComputedStyle(e).zIndex}`); }
      // the app's layers lie over the whole frame: none of what they show may cover the lifted block (the grip held in the drag stays at the block's home, beside it)
      const held = [...document.querySelectorAll('#handlay .obgrip')].find(e => !e.hidden && e.matches(':active, .is-down'));
      for (const e of [...document.querySelectorAll('#editlay > *, #handlay > *'), document.querySelector('#zoombar')].filter(Boolean)){
        const c = getComputedStyle(e); if (e.hidden || c.display === 'none' || c.visibility === 'hidden' || +c.opacity < .05 || e === held || e.matches('.obveil')) continue;
        const q = e.getBoundingClientRect(); if (!q.width || !q.height) continue;
        for (const p of pts){ const s = S({ left: p.x, top: p.y, width: 0, height: 0 }); if (s.left > q.left && s.left < q.right && s.top > q.top && s.top < q.bottom){ over.push(`app: ${e.className || e.id}`); break; } }
      }
      return { lifted: lift.className, n: pts.length, over: [...new Set(over)] };
    });
    ok(`4c-6: ${tag}: ${lv}: the lifted block is the topmost thing on the page: nothing of the page, the frame's furniture or the app's layers is drawn over it`, !!top && top.over.length === 0, JSON.stringify(top));
    await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(500);
  }
  ok(`4c-1: ${tag}: no console errors`, bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} FAILED` : '\nall plate checks passed');
process.exit(failed ? 1 : 0);
