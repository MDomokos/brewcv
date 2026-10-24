#!/usr/bin/env node
// node checks/sidebar-check.mjs           (ONLY=fit,ticks,... runs only those sections)
// The sidebar (UX-6 sidebar session), in Chromium through Playwright (CHROME_PATH, or PW_BUNDLED=1); writes nothing.
//  fit:   at the narrowest sidebar, in all ten languages, every text in the Edit views (nothing selected, a line, a skill group, a job, a section,
//         the same with a job in its own order, the header, the photo), Design, Export, Settings and the Library's inspector is at least as wide as
//         8 of its characters (or all of it, if shorter), none is cut by an ancestor or an ellipsis, and no short button or chip breaks inside its words.
//  ticks: in Tea and Coffee, light and dark, every checkbox in the Edit views, Design, Export and Settings is a square 17 px tick on the tertiary
//         press (raised), labelled, filled with the drink's --cb-on when ticked with a check of 3:1, its edge visible when not; no role=switch
//         (an Outline section's tick is 20 px and takes the accent; the ticks inside a section the drink's neutral --cb-on there);
//         Space ticks, Enter does not; the words are tied to the tick and stay "Show … on this resume"; the Outline's tick column is 24 px.
//  depth: the --elev tokens are set in the four looks; the active place tab stands up by more than colour (Tea higher with a raised shadow,
//         Coffee a raised thumb in a sunk track) with its words at 4.5:1; the open mode joins the panel, the others touch it; fields sunk;
//         the name card's button filled, with no shadow, while its window (a popover) is open.
//  finish: the Export view ends the process: a cup, four hue bands with large icons at contrast, PDF first and widest.
//  frame: the closed modes are folder tabs that touch the panel, fill or edge 1.5:1 on the mat, a step off the panel; the fold chevron 3:1.
//  corner: one "?" at the panel's bottom right (a phone: the foot) opens a card of help and info, by click and keys; no hint at the Outline's top.
//  columns: the Outline's hierarchy (sizes, weights, the kind's chip, the indents) and one tick column and one padlock column at every level.
//  lock: locked and unlocked padlocks differ by more than the icon, a state word as their title, no lock popup, a "Locked" toast, the motion.
//  switches: the review flag ?switches draws the old pill on every on/off and changes nothing else.
//  off:   a job or a line switched off keeps its place among the others, greyed with its tick, and comes back there when switched on;
//         in an order of its own too, round a reorder, and through the saved-resume file.
//  tiers: in every view each control has a tier (press.js, by its role) or a look of its own named there, and a layer, as recorded in
//         checks/fixtures/sidebar-tiers.json (WRITE=1 records a meant change); at most one primary a view.
//  width: the handle (pointer, ← →, Shift, Home, End), a double-click and Enter for the window's width, Ctrl+\ and the chevron fold to the rail
//         and back, remembered, the page's x unmoved by selection at the narrowest and widest, nothing hidden, themed, off on a phone.
//  header: (J) the depth chip is the folder tab of the header card in the section, job and line views: the only tick and padlock, no "Show … on this resume"
//         row, the page's paper at 26 px with the tick centred, attached (no gap, the card's top-left corner square), #sec-label still changes the printed heading,
//         a locked block's card and rows are darker (Coffee dark: cooler) with no left line, the header is short at 340 px, the same on a phone.
//  forms: the section panel's heading box and a language name's box still change what prints (the plain-form route, for a phone).

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickOption } from './lib/dropdown.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8151);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen({ port: PORT, backlog: 512 }, r));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const want = t => !process.env.ONLY || process.env.ONLY.split(',').some(o => t.includes(o));
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});
const LANGS = ['en', 'fr', 'de', 'hu', 'pl', 'es', 'it', 'pt', 'nl', 'cs'];

async function open({ w = 1280, h = 800, lang = 'en', drink = 'tea', theme = 'light', two = false, store = {}, query = '', motion = false, touch = false } = {}){
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(touch ? { hasTouch: true, isMobile: true } : {}), reducedMotion: motion ? 'no-preference' : 'reduce' });
  await ctx.addInitScript(([l, d, t, s]) => { try { (localStorage.setItem('rb-help-seen', '1'), localStorage.setItem('rb-esc-fold', 'off')); localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); localStorage.setItem('rb-ui', JSON.stringify({ mode: 'fixed', lang: l })); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); } catch { /* none */ } }, [lang, drink, theme, store]);
  const page = await ctx.newPage();
  const bad = []; page.on('pageerror', e => bad.push(String(e)));
  await page.goto(`http://localhost:${PORT}/?memory${query}#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.evaluate(() => { window.__wb.edit.setGuard?.(false); window.__wb.hands.gate?.(false); window.__wb.edit.setAutoFold?.(false); });
  // the example is limited to one page, which gives the sidebar up to 100px more: on two pages it is at its narrowest (316px under 1400px)
  if (two) await page.evaluate(() => window.__wb.store.commit(d => { d.cur.pageLimit = 2; }, 'two pages'));
  await page.waitForTimeout(300);
  return { ctx, page, bad };
}
const rest = async page => { await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await page.evaluate(() => window.__wb.setView(null)); await page.waitForTimeout(120); };
const clickIn = (page, sel, re) => page.evaluate(([s, r]) => [...document.querySelectorAll(s)].find(b => new RegExp(r).test(b.textContent))?.click(), [sel, re]);
const olSel = (page, id) => page.click(`#body [data-act=select-section][data-id=${id}]`);
const STATES = {
  outline: async () => {},
  line: async page => { await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await page.waitForTimeout(200); await page.keyboard.press('Escape'); },
  group: async page => { await clickIn(page, '#body .clt', 'CAD'); },
  job: async page => { await page.click('#body [data-act=select-job][data-id=free]'); },
  section: async page => { await olSel(page, 'experience'); },
  'a job in its own order': async page => { await page.evaluate(() => window.__wb.edit.moveLine('hydra-testing', 'hydra-inhaler')); await page.waitForTimeout(300); await olSel(page, 'experience'); },
  header: async page => { await olSel(page, 'header'); },
  photo: async page => { await page.evaluate(() => document.querySelector('#body .clrow [data-photo]').closest('.clrow').querySelector('.clt').click()); },
  design: async page => { await page.click('#tab-design'); },
  export: async page => { await page.click('#tab-export'); },
  settings: async page => { await page.evaluate(() => window.__wb.setView('settings')); },
  'library inspector': async page => { await page.evaluate(() => window.__wb.setView('resumes')); await page.waitForTimeout(300); await page.click('#scr .rcard >> nth=1'); },
};

// In the page: every visible text in the sidebar, against its readable minimum; cut by an ancestor or an ellipsis; a short button or chip
// broken inside its words.
function measure(){
  const out = [], cv = document.createElement('canvas').getContext('2d');
  for (const root of document.querySelectorAll('#col, #switcher')){
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());){
      const text = n.textContent.replace(/\s+/g, ' ').trim(), el = n.parentElement;
      if (!text || !el || el.closest('[hidden], script, style, .sr, [aria-hidden=true]')) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const rr = [...rg.getClientRects()].filter(r => r.width > 0);
      const cs0 = getComputedStyle(el);
      if (!rr.length || cs0.visibility === 'hidden' || Number(cs0.opacity) === 0) continue;
      let box = el; while (box.parentElement && getComputedStyle(box).display.startsWith('inline')) box = box.parentElement;
      const cs = getComputedStyle(box), w = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      cv.font = `${cs0.fontStyle} ${cs0.fontWeight} ${cs0.fontSize} ${cs0.fontFamily}`;
      const ls = parseFloat(cs0.letterSpacing) || 0, m = s => cv.measureText(s).width + ls * s.length;
      const where = [...new Set([el, box].map(e => e.tagName.toLowerCase() + (e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : '')))].join(' in ');
      const need = Math.min(m(text.slice(0, 8)), m(text)) - 1;
      if (w < need) out.push(`squeezed: "${text.slice(0, 30)}" ${Math.round(w)}px < ${Math.round(need)}px (${where})`);
      const btn = el.closest('button.sm, button.ghost, .pill, .chip, .clcount, .scount, .clv, .tag');
      if (btn && text.split(' ').length <= 3 && new Set(rr.map(r => Math.round(r.top))).size > 1) out.push(`broken: "${text.slice(0, 30)}" (${where})`);
      for (let a = el; a && a !== document.body; a = a.parentElement){
        const ac = getComputedStyle(a);
        if (ac.overflowX === 'visible' && ac.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        if (a.matches('.swrole') && matchMedia('(max-height: 850px)').matches) break;      // the name card in a short window is one line: only the role may end in an ellipsis (head-check)
        if (rr.some(r => r.right > ar.right + 1.5 || r.left < ar.left - 1.5) || (a === el && el.scrollWidth > el.clientWidth + 1)) out.push(`cut: "${text.slice(0, 30)}" by ${a.tagName.toLowerCase()}.${[...a.classList].slice(0, 2).join('.')}${ac.textOverflow === 'ellipsis' ? ' (ellipsis)' : ''}`);
        break;
      }
    }
  }
  return out;
}

if (want('fit')){
  console.log('\n— fit');
  for (const lang of LANGS){
    const { ctx, page, bad } = await open({ lang, two: true });
    const colW = await page.evaluate(() => Math.round(document.querySelector('#col').getBoundingClientRect().width));
    ok(`${lang}: the sidebar is at its narrowest (316px)`, colW === 316, String(colW));
    for (const [name, go] of Object.entries(STATES)){
      let probs = [], err = '';
      try { await rest(page); await go(page); await page.waitForTimeout(350); probs = await page.evaluate(measure); } catch (e){ err = String(e.message ?? e).split('\n')[0].slice(0, 100); }
      ok(`${lang}: ${name}: every text at least 8 characters wide, none cut, no short button broken`, !err && !probs.length, err || [...new Set(probs)].slice(0, 6).join(' | '));
    }
    ok(`${lang}: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

// ticks: every show/hide and plain on/off in the sidebar is a themed checkbox, in the four looks
const LOOKS = [['tea', 'light'], ['tea', 'dark'], ['coffee', 'light'], ['coffee', 'dark']];
function ticks(){
  const px = c => { const x = document.createElement('canvas').getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1, 1); x.fillStyle = c; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = c => { const [r, g, b] = px(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // the fill a ticked box should have where it stands (round 2: the Outline's content ticks take a neutral ink; round 3's design pass: its section ticks the accent, one colour for every section)
  const fillAt = e => { const probe = document.createElement('i'); probe.style.color = e.matches('#outline .srow input[data-secon]') ? 'var(--accent)' : 'var(--cb-on)'; e.parentElement.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c; };
  const out = [], seen = [];
  for (const e of document.querySelectorAll('#col input[type=checkbox], #switcher input[type=checkbox]')){
    const r = e.getBoundingClientRect(); if (!r.width || e.closest('[hidden]')) continue;
    const c = getComputedStyle(e), b = getComputedStyle(e, '::before'), name = (e.getAttribute('aria-label') || [...e.labels].map(l => l.textContent).join(' ')).trim();
    const id = `${e.className || 'input'}${e.dataset.secon ? `[secon=${e.dataset.secon}]` : ''}${e.id ? '#' + e.id : ''} "${name.slice(0, 24)}"`;
    seen.push(id);
    if (c.appearance !== 'none' || Math.abs(r.width - r.height) > 0.5 || r.width > (e.matches('#outline .srow input[data-secon]') ? 20 : 18)) out.push(`not a tick: ${id} ${r.width}×${r.height}`);
    if (!e.matches('.press[data-tier=tertiary]')) out.push(`not the tertiary press: ${id}`);
    if (!name) out.push(`no label: ${id}`);
    if (!e.disabled && c.boxShadow === 'none') out.push(`not raised: ${id}`);
    if (e.checked && !e.disabled){
      const cbOn = fillAt(e); if (c.backgroundColor !== cbOn) out.push(`ticked but not the drink's fill: ${id} ${c.backgroundColor} ≠ ${cbOn}`);
      if (ratio(b.backgroundColor, c.backgroundColor) < 3) out.push(`check too faint: ${id} ${ratio(b.backgroundColor, c.backgroundColor).toFixed(2)}`);
    }
    if (!e.checked && !e.disabled){
      const panel = getComputedStyle(document.querySelector('#body')).backgroundColor;
      if (ratio(c.borderTopColor, panel) < 1.5 && ratio(c.borderTopColor, c.backgroundColor) < 1.5) out.push(`unticked edge invisible: ${id}`);
    }
  }
  if (document.querySelector('[role=switch]')) out.push('a role=switch is left');
  return { out, seen };
}
if (want('ticks')){
  console.log('\n— ticks');
  for (const [drink, theme] of LOOKS){
    const { ctx, page, bad } = await open({ drink, theme, two: true });
    const all = new Set();
    for (const st of ['outline', 'line', 'job', 'section', 'header', 'photo', 'design', 'export', 'settings']){
      await rest(page); await STATES[st](page); await page.waitForTimeout(350);
      const { out, seen } = await page.evaluate(ticks);
      seen.forEach(s => all.add(s));
      ok(`${drink} ${theme}: ${st}: every checkbox is a square tick (17 px; an Outline section's 20 px), the tertiary press, raised, labelled, the fill of where it stands (a section's: the accent) and a check of 3:1`, !out.length, [...new Set(out)].slice(0, 5).join(' | '));
    }
    ok(`${drink} ${theme}: the views have ticks (at least 20 seen)`, all.size >= 20, String(all.size));
    if (drink === 'tea' && theme === 'light'){
      await rest(page); await page.waitForTimeout(300);      // (J, rewritten: the section's tick is the Outline's row and the chip's; the view's own "Show … on this resume" row is gone)
      const sel = '#outline .srow[data-sid=experience] input[data-secon=experience]';
      const on0 = await page.isChecked(sel), u0 = await page.evaluate(() => window.__wb.store.history.undo);
      await page.focus(sel); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
      const afterEnter = await page.isChecked(sel);
      await page.focus(sel); await page.keyboard.press('Space'); await page.waitForTimeout(400);
      const on1 = await page.isChecked(sel), shown = await page.evaluate(() => (window.__wb.store.state.cur.sections ?? []).some?.(s => (s.id ?? s) === 'experience'));
      ok('Space ticks a tick (the section leaves the resume, one undo step); Enter does not', on0 && afterEnter && !on1 && (await page.evaluate(() => window.__wb.store.history.undo)) === u0 + 1, JSON.stringify({ on0, afterEnter, on1, shown }));
      await page.focus(sel); await page.keyboard.press('Space'); await page.waitForTimeout(400);
      ok('…and Space again puts it back', await page.isChecked(sel));
      ok('the tick\'s name stays "Show … on this resume", ticked or not', /^Show Experience on this resume$/.test((await page.getAttribute(sel, 'aria-label')).trim()));
      await rest(page); await STATES.settings(page); await page.waitForTimeout(300);
      const c0 = await page.isChecked('#contrast');
      await page.click('label.swl:has(#contrast) > span'); await page.waitForTimeout(250);
      ok('the label is tied to its tick: a click on the words ticks it (Settings, Sharper contrast)', (await page.isChecked('#contrast')) === !c0);
      await page.click('label.swl:has(#contrast) > span');
      await rest(page); await page.waitForTimeout(250);
      const endCol = await page.evaluate(() => [...document.querySelectorAll('#outline .srow > .swl, #outline .clgh > .swl')].map(e => Math.round(e.getBoundingClientRect().width)));
      ok('the Outline\'s tick column is the 24 px target (the pill took 30)', endCol.length > 3 && endCol.every(w => w === 24), endCol.join());
    }
    ok(`${drink} ${theme}: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

// depth: the elevation tokens and the switchers, in the four looks
function depth(){
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const over = (bg, fg) => { cv.fillStyle = '#fff'; cv.fillRect(0, 0, 1, 1); cv.fillStyle = bg; cv.fillRect(0, 0, 1, 1); cv.fillStyle = fg; cv.fillRect(0, 0, 1, 1); return [...cv.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (bg, fg) => { const [x, y] = [lum(over(bg, fg)), lum(over(bg, bg))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const root = getComputedStyle(document.documentElement), out = { bad: [] };
  for (const k of ['flat', 'low', 'raised', 'inset', 'panel', 'pop']) if (!root.getPropertyValue(`--elev-${k}`).trim()) out.bad.push(`--elev-${k} missing`);
  const coffee = document.documentElement.dataset.drink === 'coffee';
  const tabs = [...document.querySelectorAll('#ptabs .ptab')], act = tabs.find(b => b.getAttribute('aria-current') === 'page'), rest = tabs.filter(b => b !== act);
  const R = e => e.getBoundingClientRect();
  if (!act || rest.length !== 2) out.bad.push('place tabs: no active one');
  else if (coffee){
    const th = getComputedStyle(document.querySelector('#ptabs'), '::before'), tr = getComputedStyle(document.querySelector('#ptabs'));
    if (th.boxShadow === 'none') out.bad.push('coffee: the thumb is not raised');
    if (!/inset/.test(tr.boxShadow)) out.bad.push('coffee: the track is not sunk');
    const tl = R(document.querySelector('#ptabs')).left + parseFloat(th.left);
    if (Math.abs(tl - R(act).left) > 4) out.bad.push(`coffee: the thumb is not under the active place (${Math.round(tl)} vs ${Math.round(R(act).left)})`);
    const c = ratio(th.backgroundColor, getComputedStyle(act).color); if (c < 4.5) out.bad.push(`coffee: the active place's words ${c.toFixed(2)}:1`);
  } else {
    if (!rest.every(b => R(b).top - R(act).top >= 3)) out.bad.push(`tea: the active tag does not stand higher (${[act, ...rest].map(b => Math.round(R(b).top))})`);
    if ((getComputedStyle(act).filter.match(/drop-shadow/g) ?? []).length < 2) out.bad.push('tea: the active tag has no raised shadow');
    for (const b of tabs){ const cs = getComputedStyle(b), c = ratio(cs.getPropertyValue('--tg').trim(), cs.color); if (c < 4.5) out.bad.push(`tea: "${b.textContent.trim()}" ${c.toFixed(2)}:1`); }
  }
  const panel = R(document.querySelector('#body')), modes = [...document.querySelectorAll('#rail .rtabs .tab')], on = modes.find(b => b.getAttribute('aria-selected') === 'true');
  if (!on || Math.abs(R(on).right - panel.left) > 1.5) out.bad.push('the open mode does not join the panel');
  for (const b of modes) if (b !== on && (R(b).right < panel.left - 0.01 || R(b).right > panel.left + 1.01)) out.bad.push(`the mode "${b.textContent.trim()}" does not touch the panel (${(R(b).right - panel.left).toFixed(1)} px under it)`);      // rewritten in round 2: the folder tabs touch the panel
  const fld = document.querySelector('#body input:not([type]):not(#sec-label), #body input[type=text], #body textarea');      // (J: the section's heading is written in place on its band, no box)
  if (fld && !/inset/.test(getComputedStyle(fld).boxShadow)) out.bad.push('a field is not sunk');
  return out;
}
if (want('depth')){
  console.log('\n— depth');
  for (const [drink, theme] of LOOKS){
    const { ctx, page, bad } = await open({ drink, theme, two: true });
    await rest(page); await STATES.section(page); await page.waitForTimeout(300);
    const d = await page.evaluate(depth);
    ok(`${drink} ${theme}: the --elev tokens are set; the active place stands up by more than colour (Tea: 3 px higher and a raised shadow; Coffee: a raised thumb in a sunk track), its words 4.5:1; the open mode joins the panel, the others touch it (at most 1 px under it); a field is sunk`, !d.bad.length, d.bad.join(' | '));
    await page.click('#docname-btn'); await page.waitForTimeout(400);
    const nc = await page.evaluate(() => ({ btn: getComputedStyle(document.querySelector('#docname-btn')).boxShadow, fill: getComputedStyle(document.querySelector('#docname-btn')).backgroundColor, win: getComputedStyle(document.querySelector('#switcher')).boxShadow, pop: getComputedStyle(document.documentElement).getPropertyValue('--elev-pop').trim() }));
    // UX-6 round 2 (item 11): no shadow on the name card's button, not even sunk: it reads open by its fill
    ok(`${drink} ${theme}: the name card's button is filled, with no shadow, while its window is open, the window a popover (--elev-pop)`, nc.btn === 'none' && !/rgba\(0, 0, 0, 0\)/.test(nc.fill) && nc.win !== 'none' && !!nc.pop, JSON.stringify(nc));
    await page.keyboard.press('Escape');
    ok(`${drink} ${theme}: depth: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

// frame (round 2): the modes are the panel's folder tabs: each closed one touches the panel (0 to 1 px under its edge), its fill or its edge
// stands 1.5:1 off the mat and its fill a visible step (1.1:1) off the panel; the fold chevron is a chrome card, its icon 3:1 on its face and
// its face or edge 3:1 on the mat. In the four looks, in Edit and Design (each mode is its own tea).
function frame(){
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const over = (...cs) => { cv.fillStyle = '#fff'; cv.fillRect(0, 0, 1, 1); for (const c of cs){ cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); } return [...cv.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const root = getComputedStyle(document.documentElement), v = k => root.getPropertyValue(k).trim() || 'transparent';
  const mats = ['--mat-a', '--mat-b', '--mat-c'].map(k => over(v('--canvas'), v(k), v('--mat-wash')));
  const vsMat = c => Math.min(...mats.map(m => ratio(c, m)));
  const R = e => e.getBoundingClientRect(), bodyEl = document.querySelector('#body'), panel = R(bodyEl), pbg = over(v('--canvas'), getComputedStyle(bodyEl).backgroundColor);
  const bad = [], nums = [];
  for (const b of document.querySelectorAll('#rail .rtabs .tab:not([aria-selected=true])')){
    const cs = getComputedStyle(b), name = b.textContent.trim(), fill = over(v('--canvas'), cs.backgroundColor);
    const edge = parseFloat(cs.borderLeftWidth) > 0 ? cs.borderLeftColor : cs.getPropertyValue('--line').trim();
    const under = R(b).right - panel.left, f = vsMat(fill), e = vsMat(over(cs.backgroundColor, edge)), p = ratio(fill, pbg);
    nums.push(`${name}: ${under.toFixed(1)} px under, fill ${f.toFixed(2)} edge ${e.toFixed(2)} on the mat, ${p.toFixed(2)} on the panel`);
    if (under < -0.01 || under > 1.01) bad.push(`"${name}" does not touch the panel (${under.toFixed(1)})`);
    if (Math.max(f, e) < 1.5) bad.push(`"${name}" melts into the mat (fill ${f.toFixed(2)}, edge ${e.toFixed(2)})`);
    if (p < 1.1) bad.push(`"${name}" is the panel's own tone (${p.toFixed(2)})`);
  }
  const fold = document.querySelector('#rail [data-act=side-fold]');
  if (!fold) bad.push('no fold chevron');
  else {
    const cs = getComputedStyle(fold), face = over(v('--canvas'), cs.backgroundColor), icon = ratio(over(cs.backgroundColor, cs.color), face);
    const ground = Math.max(vsMat(face), parseFloat(cs.borderTopWidth) > 0 ? vsMat(over(cs.backgroundColor, cs.borderTopColor)) : 0);
    nums.push(`fold: icon ${icon.toFixed(2)} on its face, ${ground.toFixed(2)} on the mat`);
    if (icon < 3) bad.push(`the fold's icon ${icon.toFixed(2)}:1 on its face`);
    if (ground < 3) bad.push(`the fold ${ground.toFixed(2)}:1 on the mat`);
    if (R(fold).width !== 28) bad.push(`the fold is ${R(fold).width} px`);
  }
  return { bad, nums };
}
if (want('frame')){
  console.log('\n— frame');
  for (const [drink, theme] of LOOKS){
    const { ctx, page, bad } = await open({ drink, theme });
    for (const mode of ['edit', 'design']){
      await rest(page); if (mode === 'design') await STATES.design(page); await page.waitForTimeout(300);
      const r = await page.evaluate(frame);
      ok(`${drink} ${theme} ${mode}: the closed modes are folder tabs touching the panel (fill or edge 1.5:1 on the mat, a step off the panel); the fold chevron 3:1`, !r.bad.length, r.bad.join(' | ') || (process.env.NUMS ? r.nums.join(' | ') : ''));
      if (process.env.NUMS) console.log('   ', r.nums.join(' | '));
    }
    ok(`${drink} ${theme}: frame: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

// finish (round 3, rewritten in round 3's design pass): the Export view ends the process, one hierarchy: 1 the finish header (a cup of 44 px) and the
// status row (one 24 px glyph, the page result, Fit and the page bars at its end), 2 "Get the file" (PDF the hero, taller, first and widest; the three other
// formats three equal rows), 3 "Sent it?" (the same row), then the backup as a quiet row without band or icon. The bands are on the sidebar's six muted
// hues (--hue-1..6: distinct, none a primary, hues), the words 4.5:1 and the icon 3:1 on their band in the four looks; every icon is 44 (the cup) or 24 px (one size reads as a header).
if (want('finish') || want('hues')){
  console.log('\n— finish');
  for (const [drink, theme] of LOOKS){
    const { ctx, page, bad } = await open({ drink, theme });
    await STATES.export(page); await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      const rgb = c => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); return [...cv.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const lum = a => { const [r, g, b] = a.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const panel = rgb(getComputedStyle(document.querySelector('#body')).backgroundColor);
      const bandOf = h => rgb(getComputedStyle(h).backgroundColor);
      const bands = [...document.querySelectorAll('.exg > .sgh')].map(h => { const bg = bandOf(h), ic = h.querySelector('.exic'), sv = ic.querySelector('svg').getBoundingClientRect();
        return { k: h.parentElement.dataset.k, bg, text: ratio(rgb(getComputedStyle(h.querySelector('.exht')).color), bg), icon: ratio(rgb(getComputedStyle(ic).color), bg), size: sv.width, tint: ratio(bg, panel) }; });
      const hero = document.querySelector('.exhero'), hb = bandOf(hero), st = document.querySelector('.exstat'), glyph = st.querySelector('.exst svg');
      const dl = [...document.querySelectorAll('.exg[data-k=file] .dl > button')], hs = dl.map(b => Math.round(b.getBoundingClientRect().height)), w = dl.map(b => b.getBoundingClientRect().width);
      const sent = document.querySelector('.exg[data-k=sent] .dl > button'), keep = document.querySelector('.exkeep');
      const sizes = [...document.querySelectorAll('.exhero svg, .exg > .sgh svg, .exstat .exst svg, .exkeep svg')].map(s => Math.round(s.getBoundingClientRect().width));
      const hue = [1, 2, 3, 4, 5, 6].map(n => rgb(getComputedStyle(document.documentElement).getPropertyValue(`--hue-${n}`).trim()));
      const sat = c => { const [r, g, b] = c.map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === mn ? 0 : (mx - mn) / (1 - Math.abs(mx + mn - 1)); };
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const apart = Math.min(...hue.flatMap((a, i) => hue.slice(i + 1).map(b => dist(a, b))));
      const fit = st.querySelector('.exfit [data-act=fit]'), meter = st.querySelector('.exfit #meter');
      const topOf = e => e?.getBoundingClientRect().top ?? -1;
      return { bands, heroText: ratio(rgb(getComputedStyle(hero.querySelector('.title')).color), hb), cup: ratio(rgb(getComputedStyle(hero.querySelector('.excup')).color), hb), cupSize: hero.querySelector('.excup svg').getBoundingClientRect().width,
        glyph: ratio(rgb(getComputedStyle(st.querySelector('.exst')).color), panel), glyphSize: glyph?.getBoundingClientRect().width, statText: ratio(rgb(getComputedStyle(st.querySelector('.ct')).color), panel),
        fitIn: !!fit && !!meter, finishFirst: topOf(hero) < topOf(st) && topOf(st) < topOf(document.querySelector('.exg')), fits: document.querySelectorAll('[data-act=fit]').length,
        pdfFirst: dl[0]?.dataset.act === 'ex-pdf', pdfWidest: w[0] >= Math.max(...w) && w[0] > 0, pdfTall: hs[0] > hs[1] + 8, rows: hs.slice(1), sentH: Math.round(sent?.getBoundingClientRect().height), sentSecondary: !sent?.classList.contains('primary'),
        keepAfter: !!keep && keep.previousElementSibling?.dataset.k === 'sent' && keep.nextElementSibling === null, keepBare: !keep?.querySelector('svg') && !getComputedStyle(keep).backgroundColor.match(/[1-9]\d*\)$/) , order: [...document.querySelectorAll('#body .exg')].map(e => e.dataset.k).join(),
        sizes, hues: new Set(bands.map(b => b.bg.join())).size, hueSat: Math.max(...hue.map(sat)), apart };
    });
    ok(`${drink} ${theme}: the six hues are muted (saturation 0.75 at most) and 30 apart in RGB at least`, r.hueSat <= 0.75 && r.apart >= 30, `sat ${r.hueSat.toFixed(2)}, apart ${r.apart.toFixed(0)}`);
    ok(`${drink} ${theme}: two bands, "Get the file" then "Sent it?", each on its own hue, the backup after them with no band and no icon`, r.order === 'file,sent' && r.hues === 2 && r.keepAfter && r.keepBare, `${r.order}, ${r.hues} hues, backup after ${r.keepAfter}, bare ${r.keepBare}`);
    ok(`${drink} ${theme}: a band's icon is 24 px at 3:1 on it, its words 4.5:1, and it is a tint apart from the panel`, r.bands.every(b => b.size === 24 && b.icon >= 3 && b.text >= 4.5 && b.tint >= 1.15), r.bands.map(b => `${b.k} ${b.size}px icon ${b.icon.toFixed(1)} text ${b.text.toFixed(1)} tint ${b.tint.toFixed(2)}`).join(' | '));
    ok(`${drink} ${theme}: the finish header: words 4.5:1, a cup of 44 px at 3:1`, r.heroText >= 4.5 && r.cup >= 3 && r.cupSize === 44, `title ${r.heroText.toFixed(1)}, cup ${r.cup.toFixed(1)} at ${r.cupSize}px`);
    ok(`${drink} ${theme}: the status row is under the finish header and over the bands: one 24 px glyph at 3:1, its words 4.5:1, Fit and the page bars at its end, once`, r.finishFirst && r.glyphSize === 24 && r.glyph >= 3 && r.statText >= 4.5 && r.fitIn && r.fits === 1, `glyph ${r.glyphSize}px ${r.glyph.toFixed(1)}, text ${r.statText.toFixed(1)}, fit+meter in ${r.fitIn}, first ${r.finishFirst}, fits ${r.fits}`);
    ok(`${drink} ${theme}: PDF is the first, the widest and the tallest button; the other formats and "Mark as sent…" are rows of one height (secondary)`, r.pdfFirst && r.pdfWidest && r.pdfTall && new Set(r.rows).size === 1 && r.sentH === r.rows[0] && r.sentSecondary, `pdf first ${r.pdfFirst}, rows ${r.rows.join('/')}, sent ${r.sentH}`);
    ok(`${drink} ${theme}: every icon on the screen is 44 or 24 px`, r.sizes.length >= 4 && r.sizes.every(n => [44, 24].includes(n)), r.sizes.join(','));
    ok(`${drink} ${theme}: finish: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

// corner (round 2): help and info live in one "?" at the panel's bottom right (a phone: its foot), not in a hint at the Outline's top: a 28 px
// tertiary icon with a visible edge in the four looks; a click, or Enter on it, opens a card of four rows (the shortcuts, privacy, the source,
// the version), arrows walk it, Esc closes it and gives the focus back; the shortcuts row opens the sheet, and so does the ? key; the card stays
// in the window, and at the end of a scroll the "?" covers none of the last row's controls; the ⋯ menu no longer lists those three.
if (want('corner')){
  console.log('\n— corner');
  const look = () => { const b = document.querySelector('#corner [data-act=corner]'); if (!b) return null; const cs = getComputedStyle(b), r = b.getBoundingClientRect();
    const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const over = (...c) => { cv.fillStyle = '#fff'; cv.fillRect(0, 0, 1, 1); for (const x of c){ cv.fillStyle = x; cv.fillRect(0, 0, 1, 1); } return [...cv.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const lum = rgb => { const [x, y, z] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
    const body = document.querySelector('#body'), panel = getComputedStyle(body).backgroundColor, a = lum(over(panel, cs.borderTopColor)), p = lum(over(panel));
    const B = body.getBoundingClientRect();
    return { w: r.width, h: r.height, tier: b.dataset.tier, border: parseFloat(cs.borderTopWidth), edge: +((Math.max(a, p) + 0.05) / (Math.min(a, p) + 0.05)).toFixed(2), label: b.getAttribute('aria-label'), popup: b.getAttribute('aria-haspopup'),
      right: B.right - r.right, bottom: B.bottom - r.bottom }; };
  for (const [drink, theme] of LOOKS){
    const { ctx, page, bad } = await open({ drink, theme, store: { 'rb-help-seen': '' } });
    const tag = `${drink} ${theme}`;
    const top = await page.evaluate(() => ({ hint: !!document.querySelector('#body .kbdhint') || /shows the shortcuts/.test(document.querySelector('#body').textContent), first: document.querySelector('#body > *')?.className }));
    ok(`${tag}: the Outline has no hint at its top (a first visit too)`, !top.hint, JSON.stringify(top));
    const l = await page.evaluate(look);
    ok(`${tag}: one "?" at the panel's bottom right, 28 px, a tertiary press with an edge 1.5:1 on the panel, named, a menu button`, !!l && l.w === 28 && l.h === 28 && l.tier === 'tertiary' && l.border >= 1 && l.edge >= 1.5 && !!l.label && l.popup === 'true' && l.right >= 0 && l.right <= 16 && l.bottom >= 0 && l.bottom <= 16, JSON.stringify(l));
    if (!l){ await ctx.close(); continue; }
    await page.click('#corner [data-act=corner]'); await page.waitForTimeout(250);
    const card = await page.evaluate(() => { const m = document.querySelector('#corner .cornermenu[role=menu]'); if (!m) return null; const r = m.getBoundingClientRect();
      return { rows: [...m.querySelectorAll('[role=menuitem]')].map(e => e.dataset.act || (e.getAttribute('href') ?? '').replace(/.*\//, '')), version: !!m.querySelector('[data-appversion]'), inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, focus: document.activeElement?.closest('.cornermenu') === m }; });
    ok(`${tag}: a click opens the card: the shortcuts, privacy, the source and the version (About this copy), inside the window, the focus on its first row`, !!card && card.rows.join() === 'help,PRIVACY.md,brewcv,goto' && card.version && card.inside && card.focus, JSON.stringify(card));
    if (drink === 'tea' && theme === 'light'){
      await page.keyboard.press('ArrowDown'); const second = await page.evaluate(() => document.activeElement?.getAttribute('href') ?? '');
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      const shut = await page.evaluate(() => ({ card: !!document.querySelector('.cornermenu'), focus: document.activeElement?.dataset.act }));
      ok('↓ walks the card; Esc closes it and the focus goes back to the "?"', /PRIVACY/.test(second) && !shut.card && shut.focus === 'corner', JSON.stringify({ second, ...shut }));
      await page.keyboard.press('Enter'); await page.waitForTimeout(250);
      const kb = await page.evaluate(() => (document.activeElement?.closest('.cornermenu') ? document.activeElement.dataset.act : null));
      await page.keyboard.press('Enter'); await page.waitForTimeout(250);
      ok('…Enter on the "?" opens it from the keyboard, and Enter on its first row opens the shortcut sheet and closes the card', kb === 'help' && await page.isVisible('#help') && !(await page.$('.cornermenu')), String(kb));
      await page.keyboard.press('Escape'); await page.waitForTimeout(150); await rest(page);
      await page.keyboard.press('?'); await page.waitForTimeout(250);
      ok('the ? key still opens the shortcut sheet', await page.isVisible('#help'));
      await page.keyboard.press('Escape'); await page.waitForTimeout(150);
      const end = await page.evaluate(() => { const b = document.querySelector('#body'); b.scrollTop = b.scrollHeight; const q = document.querySelector('#corner [data-act=corner]').getBoundingClientRect();
        const rows = [...b.querySelectorAll('#outline .srow, #outline .clgh, #outline .clrow, #outline .ojob')].filter(e => e.getBoundingClientRect().height);
        const ctl = [...rows.at(-1).querySelectorAll('button, input, a, .swl')].map(e => e.getBoundingClientRect());
        return { scrolls: b.scrollHeight > b.clientHeight, hit: ctl.filter(r => r.right > q.left && r.left < q.right && r.bottom > q.top && r.top < q.bottom).length }; });
      ok('at the end of the Outline\'s scroll, the "?" covers none of the last row\'s controls', end.hit === 0, JSON.stringify(end));
      await page.click('#head [data-act=menu]'); await page.waitForTimeout(200);
      const menu = await page.evaluate(() => [...document.querySelectorAll('#head .menu [role=menuitem]')].map(e => e.dataset.act || e.getAttribute('href')));
      ok('the ⋯ menu no longer lists the shortcuts, privacy or the source', menu.length > 3 && !menu.some(x => x === 'help' || /github|PRIVACY/.test(x ?? '')), menu.join());
      await page.keyboard.press('Escape');
    }
    ok(`${tag}: corner: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // a phone: the "?" is at the end of the foot, and its card stays on the screen
  { const { ctx, page, bad } = await open({ w: 390, h: 844 });
    const ph = await page.evaluate(() => ({ foot: !!document.querySelector('#foot [data-act=corner]'), corner: !!document.querySelector('#corner [data-act=corner]') }));
    if (ph.foot) await page.click('#foot [data-act=corner]');
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => { const m = document.querySelector('#foot .cornermenu'); if (!m) return null; const b = m.getBoundingClientRect(); return { n: m.querySelectorAll('[role=menuitem]').length, inside: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight }; });
    ok('a phone: the "?" is in the foot (none over the panel), and its card of four rows stays on the screen', ph.foot && !ph.corner && r?.n === 4 && r.inside, JSON.stringify({ ph, r }));
    ok('phone: no page errors', !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close(); }
}

// columns (round 2): the Outline reads as a hierarchy and its controls stand in columns. With Experience, a job in it and Skills open, in the
// four looks, in English and German: every tick's centre (sections, jobs, the off jobs, lines, a section's own items) is on one x within
// 0.5 px, every padlock's (a fixed section's too) on another; a section's heading is a band of its kind's hue (one of the six) with the title 14.5 px / 750 beside a 24 px monochrome icon (no coloured circle) at 3:1,
// the words 4.5:1, in the four looks, at most six hues; a job's 13 px / 650, a line's 12.5 px / 450; a line and a section's own item start under the
// job's title (not left of it). (Rewritten in round 3's design pass: the 16 px coloured chip and the open section's band only became this.)
if (want('columns')){
  console.log('\n— columns');
  for (const lang of ['en', 'de']) for (const [drink, theme] of LOOKS){
    const { ctx, page, bad } = await open({ lang, drink, theme });
    const tag = `${lang} ${drink} ${theme}`;
    await page.evaluate(() => { document.querySelector('#outline .clg[data-g=hydra] .clcaret')?.click(); }); await page.waitForTimeout(250);
    await page.evaluate(() => { document.querySelector('#outline [data-act=ol-toggle][data-g="sec:skills"]')?.click(); }); await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const mid = e => { const b = e.getBoundingClientRect(); return b.width ? b.left + b.width / 2 : null; };
      const kind = e => e.closest('.clrow') ? 'line' : e.closest('.clgh') ? 'job' : e.closest('.ojob') ? 'off job' : e.closest('.srow') ? 'section' : 'other';
      const ticks = [...document.querySelectorAll('#outline input[type=checkbox]')].map(e => [kind(e), mid(e)]).filter(x => x[1] != null);
      const locks = [...document.querySelectorAll('#outline .rowlock')].map(e => [kind(e) + (e.closest('.srow.fixed') ? ' (fixed)' : ''), mid(e)]).filter(x => x[1] != null);
      const spread = xs => Math.max(...xs.map(x => x[1])) - Math.min(...xs.map(x => x[1]));
      const f = s => { const e = document.querySelector(s); if (!e) return null; const c = getComputedStyle(e); return { size: parseFloat(c.fontSize), weight: +c.fontWeight, left: e.getBoundingClientRect().left }; };
      const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      const rgb = c => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); return [...cv.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const lum = a => { const [r, g, b] = a.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const heads = [...document.querySelectorAll('#outline .osec:not(:has(> .srow.is-off)) > .srow')].map(h => { const bg = rgb(getComputedStyle(h).backgroundColor), i = h.querySelector('.si');
        return { sid: h.dataset.sid, bg: bg.join(), text: ratio(rgb(getComputedStyle(h.querySelector('.t')).color), bg), icon: ratio(rgb(getComputedStyle(i).color), bg), size: Math.round(i.querySelector('svg').getBoundingClientRect().width) }; });
      const chip = document.querySelector('#outline .osec[data-sid=experience] > .srow .si'), band = getComputedStyle(document.querySelector('#outline .osec.open[data-sid=experience] > .srow')).backgroundColor;
      return { ticks: [...new Set(ticks.map(x => x[0]))], locks: [...new Set(locks.map(x => x[0]))], tickSpread: +spread(ticks).toFixed(2), lockSpread: +spread(locks).toFixed(2),
        sec: f('#outline .osec[data-sid=experience] > .srow .t'), job: f('#outline .clg[data-g=hydra] .jtl'), line: f('#outline .clg[data-g=hydra] .clrow .clt'), item: f('#outline .osec[data-sid=skills] .clrow .clt'),
        chip: chip && Math.round(chip.querySelector('svg').getBoundingClientRect().width), chipBg: chip && getComputedStyle(chip).backgroundColor, band, heads };
    });
    ok(`${tag}: one tick column for sections, jobs, off jobs, lines and items, within 0.5 px`, r.tickSpread <= 0.5 && ['section', 'job', 'off job', 'line'].every(k => r.ticks.includes(k)), JSON.stringify({ spread: r.tickSpread, kinds: r.ticks }));
    ok(`${tag}: one padlock column for sections (a fixed one too), jobs and lines, within 0.5 px`, r.lockSpread <= 0.5 && ['section', 'section (fixed)', 'job', 'line'].every(k => r.locks.includes(k)), JSON.stringify({ spread: r.lockSpread, kinds: r.locks }));
    ok(`${tag}: a section is a heading (14.5 px / 750; Coffee 15 px / 700, its Fira Code having one real weight; a 24 px icon with no coloured circle), a job 13 px / 650, a line 12.5 px / 450`, r.sec?.size === (/coffee/.test(tag) ? 15 : 14.5) && r.sec.weight >= (/coffee/.test(tag) ? 700 : 750) && r.chip === 24 && r.chipBg === 'rgba(0, 0, 0, 0)' && r.band !== 'rgba(0, 0, 0, 0)' && r.job?.size === 13 && r.job.weight === 650 && r.line?.size === 12.5 && r.line.weight === 450, JSON.stringify({ sec: r.sec, chip: r.chip, band: r.band, job: r.job, line: r.line }));
    ok(`${tag}: every section heading is a band (at most six hues, a tint off the panel), its icon 24 px at 3:1 and its words 4.5:1`, r.heads.length >= 6 && new Set(r.heads.map(x => x.bg)).size <= 6 && r.heads.every(x => x.size === 24 && x.icon >= 3 && x.text >= 4.5), r.heads.map(x => `${x.sid} ${x.size}px icon ${x.icon.toFixed(1)} text ${x.text.toFixed(1)}`).join(' | '));
    ok(`${tag}: a line and a section's own item start under the job's title (within 1 px), not left of it`, Math.abs(r.line.left - r.job.left) <= 1 && Math.abs(r.item.left - r.job.left) <= 1, JSON.stringify({ job: r.job?.left, line: r.line?.left, item: r.item?.left }));
    if (drink === 'tea' && theme === 'light' && lang === 'en') console.log(`    tick x spread ${r.tickSpread}, padlock x spread ${r.lockSpread}`);
    ok(`${tag}: columns: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

// lock (round 2): locked and unlocked differ by more than the icon (computed style: the padlock's opacity, its chip, its filled body; the
// row's marker) in the four looks, on the Outline's rows, the depth row and the page chip, and the page lock; a padlock's title is a state
// word; no .obtip or .locknote ever appears for a lock; a click on locked text moves the padlock (no toast while one is on screen); locking, unlocking and that click
// play the padlock's motion (lock:lock, lock:ring, lock:unlock, lock:shake), and under reduced motion nothing starts.
if (want('lock')){
  console.log('\n— lock');
  const st = sel => document.querySelector(sel) && (() => { const e = document.querySelector(sel), c = getComputedStyle(e), r = e.querySelector('svg rect'); return { op: +c.opacity * +(e.querySelector('svg') ? getComputedStyle(e.querySelector('svg')).opacity : 1), bg: c.backgroundColor, fill: r ? getComputedStyle(r).fill : null, title: e.title, row: getComputedStyle(e.closest('.srow, .clgh, .clrow') ?? e).boxShadow, wash: getComputedStyle(e.closest('.srow, .clgh, .clrow') ?? e).boxShadow !== 'none' }; })();
  const differ = (a, b) => !!a && !!b && a.op > b.op && a.bg !== b.bg && a.bg !== 'rgba(0, 0, 0, 0)' && a.fill !== 'none' && b.fill === 'none';
  const popups = () => ({ tip: [...document.querySelectorAll('.obtip')].some(e => !e.hidden && e.textContent), note: !!document.querySelector('.locknote') });
  for (const [drink, theme] of LOOKS){
    const { ctx, page, bad } = await open({ drink, theme });
    const tag = `${drink} ${theme}`, row = '#outline .srow[data-sid=experience] [data-act=row-lock]';
    const off = await page.evaluate(st, row), offPage = await page.evaluate(st, '#body .pagelock');
    await page.click(row); await page.waitForTimeout(300);
    const on = await page.evaluate(st, row);
    ok(`${tag}: a locked row's padlock differs by more than its icon (full strength, a warm chip, a filled body), the row has the wash and no left marker (J, rewritten: was a 2 px marker), the title is a state word`, differ(on, off) && on.wash && !off.wash && !/ 2px 0px 0px 0px/.test(on.row) && off.row === 'none' && on.title === 'Locked' && off.title === 'Unlocked', JSON.stringify({ on, off }));
    await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await page.waitForTimeout(400);
    const toast = await page.evaluate(() => document.querySelector('#toast.on.warn')?.textContent ?? '');
    const chip = await page.evaluate(st, '#editlay .dp-lock'), depth = await page.evaluate(st, '#body .depth .dp-lock'), pop = await page.evaluate(popups);
    ok(`${tag}: a click on locked text: no toast (a padlock is on screen to move), no .obtip and no .locknote; the chip's and the depth row's padlocks read locked`, toast === '' && !pop.tip && !pop.note && chip?.fill !== 'none' && chip?.bg !== 'rgba(0, 0, 0, 0)' && depth?.fill !== 'none', JSON.stringify({ toast, pop, chip, depth }));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    await page.click(row); await page.waitForTimeout(250);
    await page.click('#body .pagelock'); await page.waitForTimeout(300);
    const onPage = await page.evaluate(st, '#body .pagelock');
    ok(`${tag}: the page lock too: locked it is filled on a warm chip, unlocked an outline`, differ(onPage, offPage), JSON.stringify({ onPage, offPage }));
    await page.click('#body .pagelock'); await page.waitForTimeout(250);
    ok(`${tag}: lock: never a popup; no page errors`, !(await page.evaluate(popups)).tip && !(await page.evaluate(popups)).note && !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // the motion: on with motion, nothing under reduced motion
  for (const motion of [true, false]){
    const ctx = await browser.newContext({ viewport: { width: 1470, height: 832 }, reducedMotion: motion ? 'no-preference' : 'reduce' });
    await ctx.addInitScript(() => { try { localStorage.setItem('rb-ui', JSON.stringify({ mode: 'fixed', lang: 'en' })); } catch { /* none */ } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
    await page.evaluate(() => { window.__wb.edit.setGuard?.(false); window.__wb.hands.gate?.(false); }); await page.waitForTimeout(500);
    const n0 = await page.evaluate(() => window.__wb.motion.stats.played);
    await page.click('#outline .srow[data-sid=experience] [data-act=row-lock]'); await page.waitForTimeout(600);
    await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await page.waitForTimeout(600);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.click('#outline .srow[data-sid=experience] [data-act=row-lock]'); await page.waitForTimeout(600);
    const m = await page.evaluate(n => ({ names: [...new Set(window.__wb.motion.stats.names)].filter(x => x.startsWith('lock:')), played: window.__wb.motion.stats.played - n }), n0);
    if (motion) ok('with motion, locking closes the shackle with a ring, a click on locked text shakes the padlock, unlocking lifts it', ['lock:lock', 'lock:ring', 'lock:shake', 'lock:unlock'].every(x => m.names.includes(x)), JSON.stringify(m));
    else ok('under reduced motion the padlocks do not move (no lock motion starts)', !m.names.length, JSON.stringify(m));
    await ctx.close();
  }
}

// switches: the review flag ?switches draws the old pill for every on/off and changes nothing else (shortcut: remove with the flag)
if (want('switches')){
  console.log('\n— switches');
  const seen = async q => { const { ctx, page, bad } = await open({ two: true, query: q }); const out = {};
    for (const st of ['outline', 'section', 'settings']){ await rest(page); await STATES[st](page); await page.waitForTimeout(300);
      out[st] = await page.evaluate(() => [...document.querySelectorAll('#col input[type=checkbox]')].filter(e => e.getBoundingClientRect().width).map(e => ({ k: [...e.attributes].filter(a => a.name.startsWith('data-') && a.name !== 'data-tier' || a.name === 'id').map(a => a.name + '=' + a.value).join(' '), pill: e.classList.contains('pill'), w: Math.round(e.getBoundingClientRect().width), on: e.checked }))); }
    out.cur = await page.evaluate(() => JSON.stringify({ ...window.__wb.store.state.cur, savedAt: 0 }));
    await ctx.close(); return { out, bad }; };
  const a = await seen(''), b = await seen('&switches');
  const pills = ['outline', 'section', 'settings'].flatMap(st => b.out[st].filter(x => x.pill));
  ok('?switches: every .sw is the 30 px pill; without it none is', pills.length >= 15 && pills.every(x => x.w === 30) && !['outline', 'section', 'settings'].some(st => a.out[st].some(x => x.pill)), `${pills.length} pills`);
  ok('…and nothing else changes: the same controls, the same states, the same recipe', ['outline', 'section', 'settings'].every(st => JSON.stringify(a.out[st].map(x => [x.k, x.on])) === JSON.stringify(b.out[st].map(x => [x.k, x.on]))) && a.out.cur === b.out.cur && !a.bad.length && !b.bad.length);
}

// off: a job or a line that is switched off keeps its place among the others in the sidebar, and comes back to it
if (want('off')){
  console.log('\n— off');
  const { ctx, page, bad } = await open({});
  const cur = () => page.evaluate(() => JSON.stringify({ ...window.__wb.store.state.cur, savedAt: 0 }));
  const run = (fn, ...args) => page.evaluate(async ([fn, args]) => { const T = await import('/src/model/resume.js'); window.__wb.store.commit(d => { T[fn](d.record, d.cur, ...args); }, 'check'); }, [fn, args]);
  const settle = () => page.waitForTimeout(500);
  const jobs = () => page.$$eval('#body input[data-jobon]', es => es.map(e => (e.checked ? '' : '-') + e.dataset.jobon));
  const lines = () => page.$$eval('#body .clrows:first-of-type > .clrow[data-fact]:not(.is-archived)', es => es.map(e => (e.classList.contains('is-off') ? '-' : '') + e.dataset.fact));
  const toSection = async () => { await rest(page); await page.click('#body [data-act=select-section][data-id=experience]'); await settle(); };
  const toJob = async id => { await toSection(); await page.click(`#body [data-act=select-job][data-id=${id}]`); await settle(); };
  // jobs
  await toSection();
  const c0 = await cur(), j0 = await jobs(), first = j0[0];
  await page.click(`#body label.swl:has(input[data-jobon=${first}])`); await settle();
  const j1 = await jobs();
  ok('a job switched off keeps its place among the jobs, greyed with its tick', j1.length === j0.length && j1[0] === '-' + first && j1.slice(1).join() === j0.slice(1).join(), `${j0} → ${j1}`);
  await page.click(`#body label.swl:has(input[data-jobon=${first}])`); await settle();
  ok('…switched on again it is back in the same place, and the recipe is as it was', (await jobs()).join() === j0.join() && (await cur()) === c0, String(await jobs()));
  await run('setJobOn', 'free', true); await run('moveEntry', 'medisure', 'hydra'); await toSection();
  const k0 = await jobs();      // medisure, hydra, …
  await page.click('#body label.swl:has(input[data-jobon=hydra])'); await settle();
  const k1 = await jobs();
  ok('in an order of its own, a job switched off keeps its place', k1.indexOf('-hydra') === k0.indexOf('hydra'), `${k0} → ${k1}`);
  await run('moveEntry', 'free', 'poly'); await toSection();      // the jobs that print stay in an order of their own (back in the record's, the key goes and all stand in the record's places)
  const k2 = await jobs();
  ok('…moving another job round it, the off job stays after the job it followed', k2.indexOf('-hydra') === k2.indexOf('medisure') + 1 && k2.indexOf('free') < k2.indexOf('poly'), `${k1} → ${k2}`);
  const rt = await page.evaluate(async () => { const S = await import('/src/model/schema.js'), T = await import('/src/model/resume.js'); const s = window.__wb.store.state; const back = S.loadResume(S.saveResume(s.record, s.cur).file, s.record);
    return { same: JSON.stringify(T.jobOrder(s.record, back.recipe, 'experience')) === JSON.stringify(T.jobOrder(s.record, s.cur, 'experience')), warn: back.warnings.length }; });
  ok('…and it round-trips through the saved-resume file with no warnings', rt.same && !rt.warn, JSON.stringify(rt));
  await run('setJobOn', 'hydra', true); await toSection();
  ok('…switched on, it prints there', (await jobs()).join() === k2.join().replace('-hydra', 'hydra'), String(await jobs()));
  // lines
  await toJob('hydra');
  const c1 = await cur(), l0 = (await lines()).filter(x => !x.startsWith('-')), second = l0[1];
  await page.click(`#body .clrow[data-fact="${second}"] .swl`); await settle();
  const l1 = await lines();
  ok('a line switched off keeps its place among its job\'s lines, greyed with its tick (no "+ n more" for it)', l1.indexOf('-' + second) === 1, `${l0} → ${l1}`);
  await page.click(`#body .clrow[data-fact="${second}"] .swl`); await settle();
  ok('…switched on again it is back in the same place, and the recipe is as it was', (await lines()).indexOf(second) === 1 && (await cur()) === c1, String(await lines()));
  await run('moveBullet', l0[2], l0[0]); await toJob('hydra');      // l0[2] first: an order of this resume's own
  const m0 = await lines(), a = m0[1];
  await page.click(`#body .clrow[data-fact="${a}"] .swl`); await settle();
  const m1 = await lines();
  ok('in an order of its own, a line switched off keeps its place', m1.indexOf('-' + a) === 1, `${m0} → ${m1}`);
  const live = m1.filter(x => !x.startsWith('-'));
  await run('moveBullet', live.at(-1), live[1]); await toJob('hydra');
  const m2 = await lines();
  ok('…reordering the others round it, the off line stays after the line it followed', m2.indexOf('-' + a) === m2.indexOf(m1[0]) + 1, `${m1} → ${m2}`);
  const rl = await page.evaluate(async () => { const S = await import('/src/model/schema.js'), T = await import('/src/model/resume.js'); const s = window.__wb.store.state; const back = S.loadResume(S.saveResume(s.record, s.cur).file, s.record);
    return { same: JSON.stringify(T.lineOrder(s.record, back.recipe, 'hydra')) === JSON.stringify(T.lineOrder(s.record, s.cur, 'hydra')), warn: back.warnings.length }; });
  ok('…and the line\'s place round-trips through the saved-resume file with no warnings', rl.same && !rl.warn, JSON.stringify(rl));
  ok('off: no page errors', !bad.length, bad.slice(0, 2).join(' | '));
  await ctx.close();
}

// tiers: every control in the sidebar has a tier (press.js) or a look of its own named there, and a layer; at most one primary a view.
// The snapshot (checks/fixtures/sidebar-tiers.json; WRITE=1 records it) names them, so a new control nobody classified fails.
const TIER_STATES = { outline: STATES.outline, line: STATES.line, job: STATES.job, section: STATES.section, header: STATES.header, design: STATES.design, export: STATES.export, settings: STATES.settings,
  'name window': async page => { await page.click('#docname-btn'); }, menu: async page => { await page.click('#head [data-act=menu]'); },
  '? card': async page => { await page.click('#corner [data-act=corner]'); }, 'library inspector': STATES['library inspector'],
  'career inspector': async page => { await page.evaluate(() => window.__wb.setView('record')); await page.waitForTimeout(400); },
  // the card's depth row with a level's list open (parts.js depthHtml, depthmenu.js): its options are list rows, a look of their own
  'depth list': async page => { await STATES.job(page); await page.waitForTimeout(300); await page.focus('#col .depth .dp-l[aria-haspopup]'); await page.keyboard.press('Alt+ArrowDown'); } };
async function tiers(){
  const { OWN = '' } = await import('/src/ui/press.js');
  const name = e => e.dataset.act || e.id || e.getAttribute('role') || [...e.classList].filter(c => c !== 'press')[0] || e.tagName.toLowerCase();
  const layer = e => e.closest('.switcher, .menu, .ddpop') ? 'popover' : e.matches('.ptab, .rtabs .tab, [role=tab]') ? 'tab' : e.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select') ? 'field'
    : e.closest('.item, .clrow, .clgh, .srow, .vrow, .ojob, .depth, li, .opt, .swl') ? 'row' : e.closest('.sgroup, .osec.open, .dl, .clg, .tpls, .sws, .seg') ? 'card' : 'panel';
  const own = e => { const k = OWN.split(',').map(x => x.trim()).filter(Boolean).find(s => e.matches(s)); return k ? `own ${k}` : null; };
  const out = {}, bad = [];
  for (const e of document.querySelectorAll('#col :is(button, a[data-act], [role=button], [role=option], input, select, textarea), #switcher :is(button, input, select)')){
    const r = e.getBoundingClientRect(); if (!r.width || e.closest('[hidden]')) continue;
    const t = e.classList.contains('press') ? e.dataset.tier : e.matches('input, select, textarea, a') ? e.tagName.toLowerCase() : own(e);
    if (!t) bad.push(`unclassified: ${e.tagName.toLowerCase()}.${[...e.classList].join('.')} ${name(e)}`);
    out[`${name(e)} ${e.tagName.toLowerCase()}${e.type && e.matches('input') ? ':' + e.type : ''}`] = `${t ?? '?'} / ${layer(e)}`;
  }
  const primaries = [...document.querySelectorAll('#col .press[data-tier=primary], #switcher .press[data-tier=primary]')].filter(e => e.getBoundingClientRect().width).length;
  return { out, bad, primaries };
}
if (want('tiers')){
  console.log('\n— tiers');
  const SNAP = path.join(ROOT, 'checks/fixtures/sidebar-tiers.json'), snap = fs.existsSync(SNAP) ? JSON.parse(fs.readFileSync(SNAP, 'utf8')) : {}, now = {};
  const { ctx, page, bad } = await open({ w: 1470, h: 832 });
  for (const [st, go] of Object.entries(TIER_STATES)){
    await rest(page); try { await go(page); } catch { /* the view's own check names it */ } await page.waitForTimeout(400);
    const r = await page.evaluate(tiers); now[st] = r.out;
    ok(`${st}: every control has a tier or a look of its own named in press.js`, !r.bad.length, [...new Set(r.bad)].slice(0, 5).join(' | '));
    ok(`${st}: at most one primary`, r.primaries <= 1, String(r.primaries));
    const was = snap[st] ?? {}, diff = [...new Set([...Object.keys(was), ...Object.keys(r.out)])].filter(k => was[k] !== r.out[k]).map(k => `${k}: ${was[k] ?? 'new'} → ${r.out[k] ?? 'gone'}`);
    if (!process.env.WRITE) ok(`${st}: every control's tier and layer is the recorded one (WRITE=1 records a meant change)`, !diff.length, diff.slice(0, 6).join(' | '));
  }
  if (process.env.WRITE){ fs.writeFileSync(SNAP, JSON.stringify(now, null, 1) + '\n'); console.log(`wrote ${SNAP}`); }
  ok('tiers: no page errors', !bad.length, bad.slice(0, 2).join(' | '));
  await ctx.close();
}

// width: the handle widens the sidebar by pointer and keys, a double-click and Enter give back the window's own width, Ctrl+\ and the rail's
// chevron fold it to the rail and back, the choice is remembered, the page refits and its x never moves on a selection at any width, the
// sidebar hides nothing at the widest and narrowest, the handle is themed and off on a phone
if (want('width')){
  console.log('\n— width');
  const colW = page => page.evaluate(() => Math.round(document.querySelector('#col').getBoundingClientRect().width));
  const pageX = page => page.evaluate(() => Math.round(document.querySelector('#sheet').getBoundingClientRect().left * 10) / 10);
  const grip = '#col > .sidegrip';
  for (const [drink, theme] of LOOKS){
    const { ctx, page, bad } = await open({ w: 1920, h: 1080, drink, theme });
    const tag = `${drink} ${theme}`;
    const w0 = await colW(page), g = await page.evaluate(s => { const e = document.querySelector(s); return e && { role: e.getAttribute('role'), or: e.getAttribute('aria-orientation'), now: +e.getAttribute('aria-valuenow'), min: +e.getAttribute('aria-valuemin'), max: +e.getAttribute('aria-valuemax'), tab: e.tabIndex, label: e.getAttribute('aria-label') }; }, grip);
    ok(`${tag}: a handle on the sidebar's edge: a focusable vertical separator with its width, its least and its most, and a name`, !!g && g.role === 'separator' && g.or === 'vertical' && g.now === w0 && g.min === 316 && g.max === 640 && g.tab === 0 && !!g.label, JSON.stringify(g));
    // themed: its line shows on hover in the drink's edge colour, on focus in the focus colour
    await page.hover(grip); await page.waitForTimeout(200);
    const hov = await page.evaluate(s => { const c = getComputedStyle(document.querySelector(s), '::after').backgroundColor, p = document.createElement('i'); p.style.color = 'var(--line-strong)'; document.body.append(p); const want = getComputedStyle(p).color; p.remove(); return { c, want }; }, grip);
    ok(`${tag}: the handle is tertiary (no lift, no shadow) and its line takes the drink's edge colour on hover`, hov.c === hov.want && (await page.evaluate(s => getComputedStyle(document.querySelector(s)).boxShadow, grip)) === 'none', JSON.stringify(hov));
    if (drink !== 'tea' || theme !== 'light'){ ok(`${tag}: no page errors`, !bad.length, bad.slice(0, 2).join(' | ')); await ctx.close(); continue; }
    // the pointer
    const b = await page.locator(grip).boundingBox(), x0 = await pageX(page);
    const gy = b.y + b.height - 160;      // below the rail's tabs, above its logo
    await page.mouse.move(b.x + 4, gy); await page.mouse.down(); await page.mouse.move(b.x - 140, gy, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(400);
    const w1 = await colW(page), x1 = await pageX(page);
    ok('dragging the handle 144 px to the left widens the sidebar by that much, and the page refits in the room left (it moves: by this control)', Math.abs(w1 - (w0 + 144)) <= 2 && x1 !== x0, `${w0} → ${w1}, x ${x0} → ${x1}`);
    // the keys
    await page.focus(grip); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(250);
    const w2 = await colW(page); await page.keyboard.press('Shift+ArrowRight'); await page.waitForTimeout(250);
    const w3 = await colW(page); await page.keyboard.press('End'); await page.waitForTimeout(250);
    const wMax = await colW(page); await page.keyboard.press('Home'); await page.waitForTimeout(250);
    const wMin = await colW(page);
    ok('← widens by 16, Shift+→ narrows by 64, End is the widest (640), Home the narrowest (316)', w2 === w1 + 16 && w3 === w2 - 64 && wMax === 640 && wMin === 316, [w1, w2, w3, wMax, wMin].join(' '));
    // the page's x by selection, at the narrowest and the widest
    for (const [k, w] of [['Home', 316], ['End', 640]]){
      await page.focus(grip); await page.keyboard.press(k); await page.waitForTimeout(400);
      const xs = [];
      for (const go of [STATES.outline, STATES.line, STATES.job, STATES.design, STATES.export]){ await rest(page); await go(page); await page.waitForTimeout(350); xs.push(await pageX(page)); }
      ok(`at ${w} px the page's x is the same for nothing selected, a line, a job, Design and Export`, xs.every(x => x === xs[0]), xs.join(' '));
      await rest(page);
      const hid = await page.evaluate(() => { const e = document.querySelector('#body'); return e.scrollWidth > e.clientWidth + 1; });
      ok(`at ${w} px the sidebar hides nothing sideways (no text wider than its panel)`, !hid);
    }
    // remembered
    await page.focus(grip); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(250);
    const kept = await colW(page);
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 }); await page.waitForTimeout(400);
    ok('the width is remembered in this browser (a reload keeps it)', (await colW(page)) === kept, `${kept} → ${await colW(page)}`);
    // the window's own width again: a double-click, and Enter
    await page.dblclick(grip); await page.waitForTimeout(400);
    const back = await colW(page);
    await page.focus(grip); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    ok('a double-click on the handle, and Enter on it, give back the window\'s own width', back === w0 && (await colW(page)) === w0, `${back} ${await colW(page)} (own ${w0})`);
    // fold to the rail and back: the key and the chevron
    const xOpen = await pageX(page);
    await page.mouse.move(600, 500); await page.keyboard.press('Control+Backslash'); await page.waitForTimeout(500);
    const folded = await page.evaluate(() => ({ w: Math.round(document.querySelector('#col').getBoundingClientRect().width), body: !!document.querySelector('#body').offsetParent || !!document.querySelector('#head').offsetParent || !!document.querySelector('#ptabs').offsetParent, rail: !!document.querySelector('#rail .rtabs')?.offsetParent, fold: document.querySelector('#rail [data-act=side-fold]')?.getAttribute('aria-expanded'), tier: document.querySelector('#rail [data-act=side-fold]')?.dataset.tier }));
    const xFold = await pageX(page);
    ok('Ctrl+\\ folds the sidebar to the rail: the panel goes, the rail stays, its chevron says so (a tertiary press), and the page takes the width', folded.w === 0 && !folded.body && folded.rail && folded.fold === 'false' && folded.tier === 'tertiary' && xFold !== xOpen, JSON.stringify({ ...folded, xOpen, xFold }));
    const xs = []; for (const go of [STATES.line, STATES.job]){ await rest(page); await page.keyboard.press('Escape'); await go(page).catch(() => {}); await page.waitForTimeout(300); xs.push(await pageX(page)); }
    ok('…folded, a selection on the page does not open it, and the page\'s x stays', xs.every(x => x === xFold) && (await colW(page)) === 0, xs.join(' '));
    await rest(page);
    await page.click('#rail [data-act=side-fold]'); await page.waitForTimeout(500);
    ok('…the chevron opens it again at its width, and the page goes back', (await colW(page)) === w0 && (await pageX(page)) === xOpen);
    await page.keyboard.press('Control+Backslash'); await page.waitForTimeout(400);
    await page.click('#tab-design'); await page.waitForTimeout(500);
    ok('…a mode tab opens a folded sidebar too', (await colW(page)) === w0);
    ok(`${tag}: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // under reduced motion nothing eases; with motion the fold eases briefly
  { const { ctx, page } = await open({ w: 1470, h: 832 });
    const tr = await page.evaluate(() => { document.body.classList.add('side-moving'); const d = getComputedStyle(document.querySelector('#col')).transitionDuration; document.body.classList.remove('side-moving'); return d; });
    ok('under reduced motion the fold does not animate', tr.split(',').every(x => parseFloat(x) === 0), tr);
    await ctx.close(); }
  // a phone keeps its sheet: no handle, and the key does nothing
  { const { ctx, page } = await open({ w: 390, h: 844 });
    const ph = await page.evaluate(() => ({ grip: !!document.querySelector('#col > .sidegrip')?.offsetParent || !document.querySelector('#col > .sidegrip')?.hidden }));
    await page.keyboard.press('Control+Backslash'); await page.waitForTimeout(300);
    ok('a phone has no handle and Ctrl+\\ changes nothing there', !ph.grip && !(await page.evaluate(() => document.body.classList.contains('side-off'))), JSON.stringify(ph));
    await ctx.close(); }
}

// rowhover: a section row, a job row or a line row in the Outline drives the page's hover plate (the same plate, a little stronger, no outline), and glides from row to row
if (want('rowhover')){
  console.log('\n— rowhover');
  const { ctx, page, bad } = await open({ store: { 'rb-side': JSON.stringify({ w: 340 }) }, motion: true });
  const plate = () => page.frameLocator('#sheet iframe').locator('body').evaluate(b => { const d = b.ownerDocument, w = d.defaultView, R = e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; },
    on = [...d.querySelectorAll('.rb-plate.is-hot')].filter(p => +w.getComputedStyle(p).opacity > 0.02), p = on[0], cs = p && w.getComputedStyle(p), root = w.getComputedStyle(d.documentElement);
    const alpha = c => +(/\/ ([\d.]+)\)/.exec(c)?.[1] ?? 1);
    return { n: on.length, boost: !!p?.classList.contains('is-boost'), rect: p && R(p), bg: p && alpha(cs.backgroundColor), want: p && alpha((() => { const i = d.createElement('i'); i.style.background = 'var(--plate-tint-hover)'; d.body.append(i); const c = w.getComputedStyle(i).backgroundColor; i.remove(); return c; })()) * 1.4 * (parseFloat(cs.getPropertyValue('--pk')) || 1), outline: cs ? `${cs.outlineStyle} ${cs.outlineWidth}` : null,
      old: d.querySelectorAll('.rb-hover').length, entries: [...d.querySelectorAll('.entry')].map(R), bands: Object.fromEntries([...d.querySelectorAll('.band[data-section]')].map(e => [e.dataset.section, R(e)])) }; });
  const within = (p, r, m) => p && r && p.l <= r.l + 1 && p.t <= r.t + 1 && p.r >= r.r - 1 && p.b >= r.b - 1 && r.l - p.l <= m && r.t - p.t <= m && p.r - r.r <= m && p.b - r.b <= m;
  await rest(page); await page.waitForTimeout(300);
  await page.hover('#body .osec[data-sid=experience] > .srow .t'); await page.waitForTimeout(450); const s1 = await plate();
  ok('rowhover: a section row shows ONE hover plate on its section, stronger than a pointer hover (x1.4), no outline, no old .rb-hover mark', s1.n === 1 && s1.boost && within(s1.rect, s1.bands.experience, 16) && Math.abs(s1.bg - s1.want) < .02 && /^(none|solid) 0px$/.test(s1.outline) && s1.old === 0, JSON.stringify({ ...s1, entries: 0, bands: 0 }));
  const exp = s1.bands.experience;
  await page.hover('#body .osec[data-sid=education] > .srow .t'); await page.waitForTimeout(70); const g1 = await plate(); await page.waitForTimeout(450); const g2 = await plate();
  ok('rowhover: moving from one section row to the next glides the one plate (its top is between the two, not a jump)', g1.n === 1 && g2.n === 1 && g2.rect && Math.abs(g2.rect.t - exp.t) > 20 && g1.rect.t !== g2.rect.t && g1.rect.t !== s1.rect.t, JSON.stringify([s1.rect, g1.rect, g2.rect]));
  await page.mouse.move(4, 4); await page.waitForTimeout(450); const o1 = await plate();
  ok('rowhover: leaving the row fades the plate out', o1.n === 0, JSON.stringify(o1.n));
  await page.hover('#body .clgh[data-job=hydra] .clmid'); await page.waitForTimeout(450); const j1 = await plate();
  ok('rowhover: a job row shows ONE boosted plate on that job (its entry), no outline', j1.n === 1 && j1.boost && j1.entries.some(e => within(j1.rect, e, 20)) && !j1.old, JSON.stringify({ ...j1, entries: j1.entries.length, bands: 0 }));
  await page.mouse.move(4, 4); await page.waitForTimeout(300);
  const fact = await page.$eval('#body .clrow[data-fact]:not([data-fact=""])', e => e.dataset.fact).catch(() => null);
  if (fact){ await page.hover(`#body .clrow[data-fact="${fact}"] .clt`); await page.waitForTimeout(450); const l1 = await plate();
    const vs = await page.evaluate(f => [...window.__wb.ui.ix.facts.get(f).variants], fact);
    const lineBox = await page.frameLocator('#sheet iframe').locator('body').evaluate((b, v) => { const e = [...b.ownerDocument.querySelectorAll('[data-variant]')].find(x => v.includes(x.getAttribute('data-variant')) || v.includes(x.getAttribute('data-variant')?.replace(/-override$/, ''))); const r = e?.getBoundingClientRect(); return r && { l: r.left, t: r.top, r: r.right, b: r.bottom }; }, vs);
    ok('rowhover: a line row shows ONE boosted plate on that line, no outline', l1.n === 1 && l1.boost && within(l1.rect, lineBox, 14) && !l1.old, JSON.stringify([l1.n, l1.boost, l1.rect, lineBox])); }
  else ok('rowhover: a line row is in the Outline to hover', false);
  ok('rowhover: no page errors', !bad.length, bad.slice(0, 2).join(' | '));
  await ctx.close();
}

// headers: the Outline's section titles read at 7:1 and the section view's heading box at 4.5:1 in the four looks, by pixels: the title is made transparent, the band under it
// sampled where the words stood, the words' computed colour (and alpha) laid over each sampled pixel; the middle of the samples counts (the bands are gradients at their edges)
if (want('headers')){
  console.log('\n— headers');
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const measure = async (page, sel) => {
    const els = await page.$$eval(sel, es => es.filter(e => e.offsetParent).map(e => { const cs = getComputedStyle(e), r = document.createRange(); r.selectNodeContents(e); const b = (e.tagName === 'INPUT' ? e : r).getBoundingClientRect();
      return { c: cs.color, x: Math.max(0, b.left + (e.tagName === 'INPUT' ? 4 : 0)), y: b.top + 1, w: Math.max(4, Math.min(b.width - (e.tagName === 'INPUT' ? 8 : 0), 160)), h: Math.max(4, b.height - 2), t: (e.value ?? e.textContent).trim().slice(0, 12) }; }));
    const st = await page.addStyleTag({ content: `${sel}{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}` });
    const out = [];
    for (const e of els){
      const buf = await page.screenshot({ clip: { x: e.x, y: e.y, width: e.w, height: e.h } });
      const px = await page.evaluate(async b64 => { const im = new Image(); im.src = 'data:image/png' + ';base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; const o = []; for (let i = 0; i < d.length; i += 4) o.push([d[i], d[i + 1], d[i + 2]]); return o; }, buf.toString('base64'));
      const m = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(e.c), q = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/.exec(e.c), k = m ?? q;
      const tc = [1, 2, 3].map(i => +k[i] * (m ? 255 : 1)), al = k[4] === undefined ? 1 : +k[4];
      const rs = px.map(bg => ratio(tc.map((v, i) => v * al + bg[i] * (1 - al)), bg)).sort((a, b) => a - b);
      out.push({ t: e.t, r: +rs[rs.length >> 1].toFixed(2) });
    }
    await st.evaluate(n => n.remove());
    return out;
  };
  for (const [drink, theme] of [['tea', 'light'], ['tea', 'dark'], ['coffee', 'light'], ['coffee', 'dark']]){
    const { ctx, page, bad } = await open({ drink, theme, store: { 'rb-side': JSON.stringify({ w: 340 }) } });
    await rest(page);
    const rows = (await measure(page, '#body .osec > .srow:not(.is-off) .stext .t')).filter(o => o.r);
    const lo = Math.min(...rows.map(o => o.r));
    ok(`headers: ${drink} ${theme}: the Outline's section titles read at 7:1 or more on their bands (pixel-sampled)`, rows.length >= 4 && lo >= 7, `${lo}  ${rows.map(o => `${o.t}:${o.r}`).join(' ')}`);
    await olSel(page, 'experience'); await page.waitForTimeout(500);
    const card = await measure(page, '#body .hdr #sec-label');
    ok(`headers: ${drink} ${theme}: the section view's heading box reads at 4.5:1 or more (pixel-sampled)`, card.length === 1 && card[0].r >= 4.5, JSON.stringify(card));
    ok(`headers: ${drink} ${theme}: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

// forms: the plain-form route survives the regrouping: the section panel's heading box and a language name's box change what prints
// header (J): the chip is the folder tab of the header card; the card's own tick and padlock are gone
if (want('header')){
  console.log('\n— header');
  const SIDE = { 'rb-side': JSON.stringify({ w: 340 }) };
  const geom = () => {
    const R = e => e.getBoundingClientRect(), tab = document.querySelector('#body .hdr > .depth'), card = document.querySelector('#body .hdr > .hcard'), hdr = document.querySelector('#body .hdr');
    if (!tab || !card) return null;
    const probe = document.createElement('i'); probe.style.color = 'var(--paper)'; document.body.append(probe); const paper = getComputedStyle(probe).color; probe.remove();
    const t = R(tab), c = R(card), tick = tab.querySelector('.dp-show'), k = tick && R(tick);
    return { h: Math.round(R(hdr).height * 10) / 10, tabH: t.height, face: getComputedStyle(tab).backgroundColor, paper, tickOff: k ? Math.abs((k.top + k.height / 2) - (t.top + t.height / 2)) : null, gap: c.top - t.bottom, tl: getComputedStyle(card).borderTopLeftRadius,
      ticks: document.querySelectorAll('#body .hdr [data-act=chip-on]').length, locks: document.querySelectorAll('#body .hdr [data-act=lock-toggle]').length,
      extra: document.querySelectorAll('#body #b-on, #body .hdr input[type=checkbox][data-secon], #body .hdr input[type=checkbox][data-jobon], #body .ctlrow input[data-jobon], #body .ctlrow input[data-secon]').length,
      show: [...document.querySelectorAll('#body label.swl')].some(l => /^Show .* on this resume$/.test(l.textContent.trim())), where: R(tab).left - R(card).left };
  };
  const views = { section: async p => olSel(p, 'education'), job: async p => { await olSel(p, 'experience'); await p.click('#body [data-act=select-job][data-id=hydra]'); }, line: STATES.line };
  { const { ctx, page, bad } = await open({ store: SIDE });
    const w = await page.evaluate(() => Math.round(document.querySelector('#col').getBoundingClientRect().width));
    ok('header: the sidebar is 340 px for these', w === 340 || Math.abs(w - 340) <= 1, String(w));
    for (const [name, go] of Object.entries(views)){
      await rest(page); await go(page); await page.waitForTimeout(400);
      const g = await page.evaluate(geom);
      ok(`header, ${name} view: the chip is the only tick and padlock (one each, in the header), with no tick of the view's own and no "Show … on this resume" row`, !!g && g.ticks === 1 && g.locks === 1 && g.extra === 0 && !g.show, JSON.stringify(g));
      ok(`header, ${name} view: the chip's face is the page's paper, 26 px tall, its tick centred (±0.5 px)`, !!g && g.face === g.paper && Math.abs(g.tabH - 26) <= 0.5 && g.tickOff !== null && g.tickOff <= 0.5, JSON.stringify(g));
      ok(`header, ${name} view: the tab and the card share an edge (no gap, at most the 1 px overlap) and the card's top-left corner is square`, !!g && g.gap <= 0 && g.gap >= -1.5 && g.tl === '0px' && Math.abs(g.where) <= 1, JSON.stringify(g));
    }
    await rest(page); await views.section(page); await page.waitForTimeout(400);
    const hs = await page.evaluate(geom);
    ok('header, section view at 340 px: the whole header (tab and card) is at most about 100 px tall', !!hs && hs.h <= 102, String(hs?.h));
    await rest(page); await olSel(page, 'experience'); await page.waitForTimeout(400);
    const he = await page.evaluate(geom);
    ok('header, the first section (Group disabled, with its short reason): at most 120 px', !!he && he.h <= 120, String(he?.h));
    // the heading is written in place and still changes the printed heading; a reset arrow only once it is changed
    const printed = x => page.frameLocator('#sheet iframe').locator('body').evaluate((b, y) => b.textContent.includes(y), x);
    const before = !!(await page.$('#body .hdr [data-act=label-reset]'));
    await page.fill('#body .hdr #sec-label', 'Bench Years'); await page.press('#body .hdr #sec-label', 'Enter'); await page.waitForTimeout(700);
    ok('header: #sec-label is in the card, changes the printed heading, and a reset arrow comes only after the change (which puts it back)', before === false && await printed('Bench Years') && !!(await page.$('#body .hdr [data-act=label-reset]')));
    await page.click('#body .hdr [data-act=label-reset]'); await page.waitForTimeout(600);
    ok('header: the reset arrow puts the record\'s heading back and goes', !(await printed('Bench Years')) && !(await page.$('#body .hdr [data-act=label-reset]')));
    // the heading's pencil is not drawn at rest: it comes with the hover (the band's wash) or the focus in the box, bare, 12 px
    const hp = () => page.evaluate(() => { const r = document.querySelector('#body .hdr .hhead'), p = r.querySelector('.pen') ?? r, cs = getComputedStyle(p), b = p.getBoundingClientRect();
      return { op: +cs.opacity, w: b.width, h: b.height, border: cs.borderTopWidth, shadow: cs.boxShadow, bg: getComputedStyle(r).backgroundColor, direct: !!r.querySelector(':scope > svg') }; });
    await page.mouse.move(2, 2); await page.waitForTimeout(250); const h0 = await hp();
    await page.hover('#body .hdr .hhead'); await page.waitForTimeout(350); const h1 = await hp();
    await page.mouse.move(2, 2); await page.focus('#body .hdr #sec-label'); await page.waitForTimeout(350); const h2 = await hp();
    ok('header: the section heading shows no pencil at rest; on hover (a wash on the band) and on focus a bare pencil of at most 14 px comes', h0.op === 0 && !h0.direct && h1.op >= 0.9 && h1.bg !== h0.bg && h1.w <= 14 && h1.h <= 14 && h1.border === '0px' && h1.shadow === 'none' && h2.op >= 0.9, JSON.stringify({ h0, h1, h2 }));
    ok('header: no page errors', !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // the chip's tick and padlock under the pointer draw the block's own plate (never an edge of their own) and one cue for the action: the tick fades the block, the padlock
  // tints the plate with the lock wash and closes a hairline frame in on its edge; reduced motion shows the end state at once with nothing moving
  for (const [motion, drink, theme] of [[true, 'tea', 'light'], [false, 'tea', 'light'], [true, 'coffee', 'dark']]){
    const { ctx, page, bad } = await open({ store: SIDE, motion, drink, theme });
    await rest(page); await olSel(page, 'experience'); await page.waitForTimeout(500);
    const fr = () => page.frameLocator('#sheet iframe').locator('body');
    const probe = () => fr().evaluate(b => { const d = b.ownerDocument, band = d.querySelector('.band[data-section=experience]'), p = d.querySelector('.rb-plate.is-scope');
      const cs = p && d.defaultView.getComputedStyle(p), ring = p && d.defaultView.getComputedStyle(p, '::after');
      return { op: +d.defaultView.getComputedStyle(band).opacity, plate: !!p, hide: !!p?.classList.contains('is-hide'), lock: !!p?.classList.contains('is-lock'), bg: cs?.backgroundColor, ring: !!ring && ring.content !== 'none' && ring.borderTopWidth === '1px', anim: p ? p.getAnimations({ subtree: true }).length : 0,
        dashed: [...d.querySelectorAll('.rb-scope, .rb-plate')].some(e => d.defaultView.getComputedStyle(e).outlineStyle === 'dashed') }; });
    const tag = `${motion ? 'with motion' : 'reduced motion'}, ${drink} ${theme}`;
    await page.hover('#body .hdr .dp-show'); await page.waitForTimeout(450); const h1 = await probe();
    await page.mouse.move(4, 4); await page.waitForTimeout(450); const h2 = await probe();
    ok(`header: ${tag}: the tick's hover is the block's plate and fades the block (opacity below .5), and leaving puts it back to 1`, h1.plate && h1.hide && h1.op < .5 && h2.op === 1 && !h2.plate && !h1.dashed, JSON.stringify([h1, h2]));
    await page.hover('#body .hdr .dp-lock'); await page.waitForTimeout(450); const l1 = await probe();
    await page.mouse.move(4, 4); await page.waitForTimeout(450); const l2 = await probe();
    ok(`header: ${tag}: the padlock's hover is the plate in the lock wash with a hairline frame (${motion ? 'closing in' : 'at rest, nothing moving'}); no dashed outline anywhere`, l1.plate && l1.lock && l1.ring && !!l1.bg && /srgb 0\.0\d* 0\.\d+ 0\.\d+ \/ 0\.[1-9]/.test(l1.bg) && l1.op === 1 && !l1.dashed && (motion ? true : l1.anim === 0) && !l2.plate, JSON.stringify([l1, l2]));
    if (motion){ await page.hover('#body .hdr .dp-lock'); await page.waitForTimeout(40); const m = await probe(); ok('header: with motion the frame is closing in as the pointer arrives (an animation runs)', m.anim > 0, JSON.stringify(m)); }
    ok(`header: ${tag}: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // the lock wash, in the four looks: a locked section's card and its Position rows are darker than unlocked (Coffee dark: cooler, its surface is nearly black); no left line
  const sample = async (page, sel, at) => {
    const r = await page.$eval(sel, (e, a) => { const b = e.getBoundingClientRect(); return a === 'bottom' ? { x: b.left + 10, y: b.bottom - 3, width: 24, height: 2 } : { x: b.left + 12, y: b.top + 1, width: 24, height: 2 }; }, at);
    const buf = await page.screenshot({ clip: r });
    return page.evaluate(async b64 => { const im = new Image(); im.src = 'data:image/png' + ';base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 4){ r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } return [r / n, g / n, b / n]; }, buf.toString('base64'));
  };
  const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const [drink, theme] of LOOKS){
    const { ctx, page, bad } = await open({ drink, theme, store: SIDE });
    await rest(page); await olSel(page, 'experience'); await page.waitForTimeout(500);
    const card0 = await sample(page, '#body .hdr > .hcard', 'bottom'), row0 = await sample(page, '#body .outline .clgh', 'top');
    await page.click('#body .hdr .dp-lock'); await page.waitForTimeout(700);
    const card1 = await sample(page, '#body .hdr > .hcard', 'bottom'), row1 = await sample(page, '#body .outline .clgh', 'top');
    const dark = (a, b) => (lum(a) + 0.05) / (lum(b) + 0.05), cool = (a, b) => (b[2] - b[0]) - (a[2] - a[0]);
    const cd = dark(card0, card1), rd = dark(row0, row1), rc = cool(row0, row1);
    const cardOk = !!(cd >= 1.12 && card1.every(Number.isFinite)), rowOk = drink === 'coffee' && theme === 'dark' ? rc >= 6 : rd >= 1.12;
    ok(`${drink} ${theme}: locking the section makes its card darker (luminance ratio ≥ 1.12 between unlocked and locked) and its Position rows ${drink === 'coffee' && theme === 'dark' ? 'cooler (blue over red +6: its surface is nearly black)' : 'darker (≥ 1.12)'}`, cardOk && rowOk, JSON.stringify({ cd: +cd.toFixed(2), rd: +rd.toFixed(2), rc: Math.round(rc) }));
    const row = await page.$eval('#body .outline .clgh.is-locked', e => { const c = getComputedStyle(e), b = getComputedStyle(e, '::before'); return { shadow: c.boxShadow, left: c.borderLeftWidth, before: b.content, bg: c.boxShadow !== 'none' }; }).catch(() => null);
    ok(`${drink} ${theme}: a locked row has no left accent line (no 2 px inset shadow, no left border, no marker), the wash instead`, !!row && !/ 2px 0px 0px 0px/.test(row.shadow) && row.left === '0px' && (row.before === 'none' || row.before === 'normal') && row.bg, JSON.stringify(row));
    const chip = await page.$eval('#body .hdr .dp-lock', e => ({ pressed: e.getAttribute('aria-pressed'), filled: getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)' }));
    ok(`${drink} ${theme}: the chip's padlock is the lock: pressed, filled glyph on a tint chip`, chip.pressed === 'true' && chip.filled, JSON.stringify(chip));
    ok(`${drink} ${theme}: header: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // a phone: the same markup, full width
  { const { ctx, page, bad } = await open({ w: 390, h: 844 });
    await page.evaluate(() => { window.__wb.ui.sel = { kind: 'section', id: 'education' }; window.__wb.setView(null); }); await page.waitForTimeout(500);
    const g = await page.evaluate(() => { const b = document.querySelector('#body').getBoundingClientRect(), h = document.querySelector('#body .hdr > .hcard')?.getBoundingClientRect(); return h && { bodyW: b.width, cardW: h.width, tab: document.querySelector('#body .hdr > .depth')?.getBoundingClientRect().height }; });
    ok('header, a phone: the same tab and card, the card nearly the full width of the body, the tab 26 px', !!g && g.cardW >= g.bodyW - 40 && Math.abs(g.tab - 26) <= 0.5, JSON.stringify(g));
    ok('header, a phone: no page errors', !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

// jobheader: in the job view the title and the date line are plain rows written in place (a click or Enter; a pencil only on hover, focus or a touch screen), with the page's guard still on for the page
if (want('jobheader')){
  console.log('\n— jobheader');
  const { ctx, page, bad } = await open({ store: { 'rb-side': JSON.stringify({ w: 340 }) } });
  await page.evaluate(() => window.__wb.edit.setGuard(true));      // the page keeps its guard: only the sidebar's row writes at once
  const frame = page.frameLocator('#sheet iframe');
  const st = () => page.evaluate(() => ({ kind: window.__wb.ui.sel.kind, id: window.__wb.ui.sel.id, editing: window.__wb.edit.editing?.fact ?? null }));
  const toJob = async () => { await rest(page); await olSel(page, 'experience'); await page.click('#body [data-act=select-job][data-id=hydra]'); await page.waitForTimeout(400); };
  await toJob();
  const g = await page.evaluate(() => { const w = window.__wb.ui.ix.work.get('hydra'), q = s => [...document.querySelectorAll(s)].map(b => b.dataset.id);
    return { pos: w.display.position, meta: w.display.meta, title: q('#body .hdr .jhead button.hedit[data-act=job-fact]'), date: q('#body .hdr .jmeta button.hedit[data-act=job-fact]'), link: !!document.querySelector('#body .hdr [data-act=job-details]'), h: document.querySelector('#body .hdr').getBoundingClientRect().height }; });
  ok('jobheader: the title row is a button row for the -position fact and the date row one for the -meta fact (no pencil button of its own)', g.title.length === 1 && g.title[0] === g.pos && /-position$/.test(g.pos) && g.date.length === 1 && g.date[0] === g.meta && /-meta$/.test(g.meta) && !(await page.$('#body .hdr .hpen')), JSON.stringify(g));
  await page.click('#body .hdr [data-act=job-details]'); await page.waitForTimeout(200);
  ok('jobheader: a link to the entry\'s other fields (dates, links) is in the card and opens the Details fold', g.link && await page.evaluate(() => document.querySelector('#body details[data-det=hydra]')?.open === true));
  ok('jobheader: the whole header at 340 px is at most 110 px tall (no pencil boxes)', g.h <= 110, String(g.h));
  for (const [what, row, re, text] of [['title', '.jhead', /-position$/, 'Lead Design Engineer'], ['date line', '.jmeta', /-meta$/, 'Zed Works · 2001 to 2002']]){
    await toJob();
    await page.click(`#body .hdr ${row} button.hedit`); await page.waitForTimeout(700);
    const a = await st();
    ok(`jobheader: a click on the ${what} row opens its editor at once (the guard is the page's), for the right fact`, re.test(a.id ?? '') && a.editing === a.id && a.kind === 'bullet', JSON.stringify(a));
    await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type(text); await page.waitForTimeout(300);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(600);
    const printed = await frame.locator('body').evaluate((b, x) => b.textContent.includes(x), text);
    const kept = await page.evaluate(([f, x]) => Object.values(window.__wb.store.state.cur.overrides ?? {}).includes(x) && f in (window.__wb.store.state.cur.overrides ?? {}), [a.id, text]);
    ok(`jobheader: the ${what} written there is printed on the page and kept on this resume as a page edit is`, printed && kept, JSON.stringify({ printed, kept }));
  }
  // no pencil at rest; a wash, a text cursor and a small bare pencil on hover and on focus; a Enter on the row writes too
  await toJob();
  const probe = sel => page.evaluate(q => { const r = document.querySelector(q), p = r.querySelector('.pen') ?? r, cs = getComputedStyle(p), b = p.getBoundingClientRect(), rc = getComputedStyle(r);
    return { op: +cs.opacity, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, border: cs.borderTopWidth, shadow: cs.boxShadow, bg: rc.backgroundColor, cur: rc.cursor, rowH: Math.round(r.getBoundingClientRect().height * 10) / 10, svg: p.querySelector('svg') ? Math.round(p.querySelector('svg').getBoundingClientRect().width) : 0 }; }, sel);
  for (const [what, sel] of [['title', '#body .hdr .jhead button.hedit'], ['date line', '#body .hdr .jmeta button.hedit']]){
    await page.mouse.move(2, 2); await page.waitForTimeout(250);
    const r0 = await probe(sel);
    await page.hover(sel); await page.waitForTimeout(350);
    const r1 = await probe(sel);
    ok(`jobheader: the ${what} row has no pencil at rest, and on hover a wash, a text cursor and a pencil of at most 14 px with no border or shadow`, r0.op === 0 && r1.op >= 0.9 && r1.bg !== r0.bg && r1.cur === 'text' && r1.w <= 14 && r1.h <= 14 && r1.svg === 12 && r1.border === '0px' && r1.shadow === 'none' && r1.rowH >= 24, JSON.stringify({ r0, r1 }));
    await page.mouse.move(2, 2); await page.keyboard.press('Shift'); await page.focus(sel); await page.waitForTimeout(350);
    const r2 = await probe(sel);
    ok(`jobheader: on keyboard focus the ${what} row shows the same wash and pencil`, r2.op >= 0.9 && r2.bg !== r0.bg, JSON.stringify(r2));
    await page.keyboard.press('Enter'); await page.waitForTimeout(700);
    const e = await st();
    ok(`jobheader: Enter on the ${what} row opens its editor for the right fact`, /-(position|meta)$/.test(e.id ?? '') && e.editing === e.id && (what === 'title') === /-position$/.test(e.id), JSON.stringify(e));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await toJob();
  }
  { const { ctx: c2, page: p2 } = await open({ touch: true, store: { 'rb-side': JSON.stringify({ w: 340 }) } });
    await rest(p2); await olSel(p2, 'experience'); await p2.click('#body [data-act=select-job][data-id=hydra]'); await p2.waitForTimeout(500);
    const t2 = await p2.evaluate(() => ({ none: matchMedia('(hover: none)').matches, ops: ['.jhead', '.jmeta'].map(q => +getComputedStyle(document.querySelector(`#body .hdr ${q} .pen`)).opacity) }));
    ok('jobheader: where there is no hover (@media (hover: none)) the pencils are shown at rest, faintly', t2.none && t2.ops.every(o => o > 0 && o < 1), JSON.stringify(t2));
    await c2.close(); }
  // the page's own guard still holds: a first click on a job's title selects the job and does not write
  await rest(page);
  await frame.locator('.entry .role-title').first().click({ position: { x: 20, y: 6 } }); await page.waitForTimeout(700);
  const f = await st();
  ok('jobheader: on the page a first click on the title still only selects the job (the guard holds)', f.kind === 'job' && f.editing === null, JSON.stringify(f));
  ok('jobheader: no page errors', !bad.length, bad.slice(0, 2).join(' | '));
  await ctx.close();
}

// tailor: the Highlight lens is one quiet row at the foot of the Outline (shut at first); the top is a slim row with the page lock, so the sections come first
if (want('tailor')){
  console.log('\n— tailor');
  const { ctx, page, bad } = await open({ w: 1470, h: 832 });
  await rest(page); await page.waitForTimeout(300);
  const st = () => page.evaluate(() => {
    const body = document.querySelector('#body'), R = e => e.getBoundingClientRect(), vis = e => R(e).width > 0 && R(e).height > 0;
    const act = [...body.querySelectorAll('button, select, input, a[href]')].filter(vis), first = body.querySelector('.outline [data-act=select-section]');
    const tail = body.querySelector('.tailor'), after = tail && [...body.querySelectorAll('button, select, input')].filter(vis).filter(e => !tail.contains(e) && tail.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { lock: act[0]?.classList.contains('pagelock'), second: !!act[1]?.closest('.outline'), room: first ? Math.round(R(first).top - R(body).top) : null, tail: !!tail, after: after ? after.length : null,
      exp: tail?.querySelector('[data-act=tailor-toggle]')?.getAttribute('aria-expanded'),
      sel: !!document.querySelector('#lens'), apply: !!document.querySelector('[data-act=lens-apply]'), chip: body.querySelector('.tailorchip')?.textContent.trim() ?? null, focus: window.__wb.edit.focus ?? null };
  });
  const a = await st();
  ok('tailor: the first control of the Outline is the page lock (a slim top row), and the next one is a section row', a.lock && a.second, JSON.stringify(a));
  ok('tailor: the Tailor row is the last row of the Outline (nothing interactive after it but its own), shut at first: no select, no "Select these…"', a.tail && a.after === 0 && a.exp === 'false' && !a.sel && !a.apply, JSON.stringify(a));
  ok('tailor: the Outline gains room: its first section row is at least 30 px higher than with the lens at the top (base: 97 px below the panel\'s top at 1470 x 832)', a.room !== null && a.room <= 97 - 30, String(a.room));
  await page.click('#body [data-act=tailor-toggle]'); await page.waitForTimeout(250);
  const b = await st();
  ok('tailor: opening the row shows the select and "Select these…" in it', b.exp === 'true' && b.sel && b.apply, JSON.stringify(b));
  const type = await page.evaluate(() => [...document.querySelectorAll('#lens option')].map(o => o.value).find(v => v));
  const undo0 = await page.evaluate(() => window.__wb.store.history.undo);
  await pickOption(page, '#lens', type); await page.waitForTimeout(300);
  await page.click('[data-act=lens-apply]'); await page.waitForTimeout(300);
  const plan = await page.textContent('.focusbox').catch(() => '');
  ok('tailor: choosing a job type and "Select these…" says the plan, as before', /turn on \d+, turn off \d+ and switch \d+/.test(plan) && (await page.evaluate(() => window.__wb.store.history.undo)) === undo0, plan.slice(0, 80));
  await page.click('[data-act=focus-apply]'); await page.waitForTimeout(500);
  ok('tailor: applying it changes the resume as before (one undo step)', (await page.evaluate(() => window.__wb.store.history.undo)) !== undo0);
  await page.click('#body [data-act=tailor-toggle]'); await page.waitForTimeout(250);
  const c = await st();
  ok('tailor: shut with a type chosen, the row shows a chip "Tailor: …" with the type, and the select is gone', !!c.chip && /^Tailor: /.test(c.chip) && !c.sel && c.focus === type, JSON.stringify(c));
  await page.click('#body .tailorchip [data-act=focus-clear]'); await page.waitForTimeout(250);
  const d = await st();
  ok('tailor: the chip\'s x clears the lens and the chip goes', d.chip === null && d.focus === null, JSON.stringify(d));
  ok('tailor: no page errors', !bad.length, bad.slice(0, 2).join(' | '));
  await ctx.close();
}

// rows: with Skills off, a hairline you can see (1.3:1 against the rows above and below it, pixel-sampled) separates every pair of adjacent closed section rows
// in the Outline: off above off, off above a band, a band above off, a band above a band; no double line (the two pixel rows next to it are plain)
if (want('rows')){
  console.log('\n— rows');
  const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  for (const [drink, theme] of LOOKS){
    const { ctx, page, bad } = await open({ drink, theme, w: 1470, h: 832 });
    await rest(page); await page.click('#body .srow[data-sid=skills] input[data-secon]'); await page.waitForTimeout(500);
    const pairs = await page.evaluate(() => { const l = [...document.querySelectorAll('#body .outline .osec')], out = [];
      for (let i = 1; i < l.length; i++){ const a = l[i - 1], b = l[i]; if (a.classList.contains('open') || b.classList.contains('open')) continue; const r = b.getBoundingClientRect();
        out.push({ name: `${a.dataset.sid} (${a.querySelector('.srow').classList.contains('is-off') ? 'off' : 'on'}) over ${b.dataset.sid} (${b.querySelector('.srow').classList.contains('is-off') ? 'off' : 'on'})`, y: r.top, x: r.left + 44, w: 8, vis: r.bottom <= innerHeight - 4 }); } return out; });
    const bad2 = [];
    for (const q of pairs.filter(q => q.vis)){
      const buf = await page.screenshot({ clip: { x: q.x, y: Math.floor(q.y) - 4, width: q.w, height: 8 } });
      const rows = await page.evaluate(async ([b64, lumS]) => { const im = new Image(); im.src = 'data:image/png' + ';base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
        const out = []; for (let y = 0; y < im.height; y++){ let r = 0, g = 0, b = 0; for (let k = 0; k < im.width; k++){ const d = x.getImageData(k, y, 1, 1).data; r += d[0]; g += d[1]; b += d[2]; } out.push([r / im.width, g / im.width, b / im.width]); } return out; }, [buf.toString('base64')]);
      const L = rows.map(lum);      // the 8 pixel rows around the seam
      const line = [2, 3, 4, 5].reduce((m, i) => Math.min(cr(L[i], L[i - 1]), cr(L[i], L[i + 1])) > Math.min(cr(L[m], L[m - 1]), cr(L[m], L[m + 1])) ? i : m, 2);
      const ratio = Math.min(cr(L[line], L[line - 1]), cr(L[line], L[line + 1]));
      if (!(ratio >= 1.3)) bad2.push(`${q.name}: ${ratio.toFixed(2)}`);
    }
    ok(`rows, ${drink} ${theme}: with Skills off, every adjacent pair of closed section rows (${pairs.filter(q => q.vis).length} pairs, off over band and band over off among them) has a visible hairline, 1.3:1 or more against the pixels beside it`, pairs.filter(q => q.vis).length >= 5 && !bad2.length, bad2.join(' | '));
    ok(`rows, ${drink} ${theme}: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

// ordermark: the "custom" pill and its Reset are for the groups whose order can be time (the jobs of an entries section, degrees); a reordered skills list,
// languages, a job's own lines, or the list of sections is only a choice of what to show first, so none of them is marked
if (want('ordermark')){
  console.log('\n— ordermark');
  const { ctx, page, bad } = await open({ w: 1470, h: 832 });
  await page.click('#outline .srow[data-sid=languages] input[data-secon]').catch(() => {}); await page.waitForTimeout(400);
  const did = await page.evaluate(async () => { const T = await import('/src/model/resume.js'), wb = window.__wb, S = () => wb.store.state;
    const jobs = wb.edit.stepJob('hydra', 1), lines = wb.edit.moveLine('hydra-testing', 'hydra-inhaler');
    const sk = T.itemList(S().record, S().cur, 'skills')?.map(x => x.id) ?? [], lg = T.itemList(S().record, S().cur, 'languages')?.map(x => x.id) ?? [];
    wb.store.commit(d => { if (sk.length > 1) T.stepItem(d.record, d.cur, 'skills', sk[0], 1); if (lg.length > 1) T.stepItem(d.record, d.cur, 'languages', lg[0], 1); T.stepSection(d.record, d.cur, 'patent', -1); }, 'check: reorder');
    return { jobs, sk: sk.length, lg: lg.length }; });
  await page.waitForTimeout(500); await rest(page);
  const n = sel => page.locator(sel).count(), M = '.pill.custom, [data-act=order-reset]';
  ok('ordermark: the jobs of Experience, reordered, show "custom" and a Reset in the Outline (they can be time)', did.jobs && (await n('#outline .osec[data-sid=experience] .ordhead .pill.custom')) === 1 && (await n('#outline .osec[data-sid=experience] .ordhead [data-act=order-reset]')) === 1, JSON.stringify(did));
  ok('ordermark: with the sections, a job\'s lines, skills and languages reordered, nothing else in the Outline is marked (no pill or Reset on the list of sections or on a job)', (await n(`#outline ${M.split(', ').join(', #outline ')}`)) === 2);   // the Experience jobs' own pill and Reset, nothing more
  await olSel(page, 'experience'); await page.click('#body [data-act=select-job][data-id=hydra]'); await page.waitForTimeout(400);
  ok('ordermark: a job\'s own lines, reordered, show no "custom" and no Reset in its view', (await n(`#body ${M.split(', ').join(', #body ')}`)) === 0);
  await rest(page);
  const rec = async g => { await page.evaluate(() => window.__wb.dock.setMode('record')); await page.waitForTimeout(300); await page.evaluate(g => window.__wb.record.open([g]), g); await page.waitForTimeout(400); return n(`#body ${M.split(', ').join(', #body ')}`); };
  ok('ordermark: in Career, a job\'s lines, the skills and the languages, reordered, show no "custom" and no Reset', (await rec('hydra')) === 0 && (await rec('credentials')) === 0 && (await rec('languages')) === 0 && did.sk > 1);
  ok('ordermark: no page errors', !bad.length, bad.slice(0, 2).join(' | '));
  await ctx.close();
}

if (want('forms')){
  console.log('\n— forms');
  const { ctx, page, bad } = await open({});
  const printed = s => page.frameLocator('#sheet iframe').locator('body').evaluate((b, x) => b.textContent.includes(x), s);
  await page.evaluate(() => { window.__wb.ui.sel = { kind: 'section', id: 'experience' }; window.__wb.setView(null); }); await page.waitForTimeout(400);
  await page.fill('#body #sec-label', 'Workbench Years'); await page.press('#body #sec-label', 'Enter'); await page.waitForTimeout(600);
  ok('the section panel\'s heading box (#sec-label) changes the printed heading', await printed('Workbench Years'));
  await rest(page);
  await page.click('#seclist .srow[data-sid=languages] .swl'); await page.waitForTimeout(600);      // Languages is off in the example
  await page.evaluate(() => { window.__wb.ui.sel = { kind: 'bullet', id: '~t:lang-portuguese' }; window.__wb.setView(null); }); await page.waitForTimeout(400);
  const has = !!(await page.$('#body #term-in'));
  if (has){ await page.fill('#body #term-in', 'Portuguese Zed'); await page.press('#body #term-in', 'Enter'); await page.waitForTimeout(600); }
  ok('a language name\'s box (#term-in) changes the printed name', has && await printed('Portuguese Zed'));
  ok('forms: no page errors', !bad.length, bad.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} sidebar checks FAILED` : '\nall sidebar checks passed');
process.exit(failed ? 1 : 0);
