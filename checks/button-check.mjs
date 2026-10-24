#!/usr/bin/env node
// node checks/button-check.mjs           (ONLY=contrast,del,order,name runs only those sections)
// The button system (UX-6 sidebar round 2), in Chromium through Playwright (CHROME_PATH, or PW_BUNDLED=1); writes nothing.
//  contrast: in Tea and Coffee, light and dark, on every sidebar view, the name window, the ⋯ menu and a row menu, the Library and Career, the
//            export dialog, the Review list and the toast: every primary, secondary and destructive button differs from its ground by an edge or
//            a fill of 3:1 (not by its shadow); no button is left without a tier (press.js reaches the Library, the dialogs and the toast); a
//            tertiary button has no shadow; only a primary has the heavy one; Sent only and Keep look pressed when they are.
//  del:      every delete and remove in src/ui is drawn by parts.js delBtn (the chip's remove by its del flag); in the views that show them
//            (a line, its versions and tags, the name window, a row menu, the ⋯ menu, a skill group, Career) each has the class .del and the
//            one X (the registry's delete) at 16 px, in the warning colour, and nothing but another delete follows it in its row; a line with more than one version
//            and a resume with a sent copy ask first, in place (Cancel keeps them, Delete deletes, with Undo), a line with one version does not.
//  order:    the pairs of checks/fixtures/button-order.json (affirm, alternatives, dismiss, destructive last) keep their order in every view they
//            appear in, and are found in the views the fixture names; every Cancel is tertiary words (a link).
//  name:     in the four looks the name card's name is one large button (the card's top, edge to edge) and ⋯ a flat icon at least 8 px inside the
//            card, neither with a shadow at rest, on hover or open; the name window's "This resume" holds Duplicate then Delete, there is no
//            Record button, + New resume is the list's first row, Manage all is a full-width secondary with an arrow; a phone the same; menu rows
//            are flat, their hover fill 8 px inside the menu.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8403);
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
const DELETE_X = 'M4 4l8 8M12 4l-8 8';      // the close drawing: delete is an X, not the bin
const DEL_ACTS = ['rm-delete', 'snap-delete', 'delete-version', 'earlier-remove', 'delete-claim', 'tag-rm', 'd-photo-rm', 'local-remove', 'sk-del', 'c-del-entry', 'c-del-item',
  'c-kind-del', 'c-kind-del-all', 'c-jt-del', 'c-tag-del', 'c-jt-tag-rm', 'c-kw-rm', 'd-drop', 'lang-remove', 'start-over'];
const LOOKS = [['tea', 'light'], ['tea', 'dark'], ['coffee', 'light'], ['coffee', 'dark']];

async function open({ w = 1470, h = 832, lang = 'en', drink = 'tea', theme = 'light', phone = false } = {}){
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 800 } : { width: w, height: h }, reducedMotion: 'reduce', ...(phone ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([l, d, t]) => { try { (localStorage.setItem('rb-help-seen', '1'), localStorage.setItem('rb-esc-fold', 'off')); localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); localStorage.setItem('rb-ui', JSON.stringify({ mode: 'fixed', lang: l })); } catch { /* none */ } }, [lang, drink, theme]);
  const page = await ctx.newPage();
  const bad = []; page.on('pageerror', e => bad.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.evaluate(() => { window.__wb.edit.setGuard?.(false); window.__wb.hands.gate?.(false); window.__wb.edit.setAutoFold?.(false); });
  await page.waitForTimeout(300);
  return { ctx, page, bad };
}
const rest = async page => { await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await page.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); window.__wb.setView(null); }); await page.waitForTimeout(150); };
const clickIn = (page, sel, re) => page.evaluate(([s, r]) => [...document.querySelectorAll(s)].find(b => new RegExp(r).test(b.textContent))?.click(), [sel, re]);
const nameWin = async page => { if (!(await page.$('#switcher:not([hidden])'))) await page.click('#docname-btn'); await page.waitForTimeout(250); };
const VIEWS = {
  outline: async () => {},
  line: async page => { await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await page.waitForTimeout(200); await page.keyboard.press('Escape'); },
  'skill group': async page => { await clickIn(page, '#body .clt', 'CAD'); },
  job: async page => { await page.click('#body [data-act=select-job][data-id=free]'); },
  section: async page => { await page.click('#body [data-act=select-section][data-id=experience]'); },
  header: async page => { await page.click('#body [data-act=select-section][data-id=header]'); },
  design: async page => { await page.click('#tab-design'); },
  export: async page => { await page.click('#tab-export'); },
  settings: async page => { await page.evaluate(() => window.__wb.setView('settings')); },
  'name window': nameWin,
  menu: async page => { await page.click('#head [data-act=menu]'); },
  'row menu': async page => { await nameWin(page); await page.click('#switcher .swrow .smore'); },
  library: async page => { await page.evaluate(() => window.__wb.setView('resumes')); await page.waitForTimeout(400); await page.click('#scr .rcard >> nth=1'); await page.click('#scr [data-act=scr-sent]'); },
  career: async page => { await page.evaluate(() => window.__wb.setView('record')); await page.waitForTimeout(400); await page.evaluate(() => document.querySelector('#scr .row, #scr .srow')?.click()); },
  'export dialog': async page => { await page.click('#tab-export'); await page.evaluate(() => window.__wb.store.commit(d => { d.cur.photo = { show: true, shape: 'rect' }; }, 'check: photo on, none')); await page.waitForTimeout(300); await page.click('[data-act=ex-html]'); },
  'review list': async page => { await page.evaluate(() => window.__wb.review.open()); },
  toast: async page => { await VIEWS.line(page); await page.hover('#body .vrow:not(.cur)'); await page.click('#body .vrow:not(.cur) [data-act=delete-version]'); },
};

// In the page: every button in the app's own layers (the sidebar, the Library and Career, the dialogs, the toast) against its ground.
async function measure(){
  const { OWN = '' } = await import('/src/ui/press.js');
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgba = c => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const [r, g, b, a] = cv.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
  const over = (top, under) => top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3])).concat(1);
  const L = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
  const canvas = rgba(getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim());
  const ground = e => {
    const stack = [];
    for (let a = e.parentElement; a; a = a.parentElement){ const c = rgba(getComputedStyle(a).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] >= .99) break; }
    let g = stack.at(-1)?.[3] >= .99 ? stack.pop() : canvas;
    for (const c of stack.reverse()) g = over(c, g);
    return g;
  };
  const name = e => `${e.dataset.act || e.id || [...e.classList].filter(c => c !== 'press')[0] || 'button'}${e.closest('#switcher') ? ' (name window)' : e.closest('dialog') ? ' (dialog)' : e.closest('#scr') ? ' (scr)' : ''}`;
  const own = e => OWN.split(',').map(x => x.trim()).filter(Boolean).some(s => e.matches(s));
  const out = { weak: [], untiered: [], shadow: [], heavy: [], n: 0, pressed: [] };
  for (const e of document.querySelectorAll(':is(#col, #scr, #find, #toast, #help, dialog[open]) button')){
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    if (!r.width || !r.height || e.closest('[hidden]') || cs.visibility === 'hidden' || e.disabled || e.closest('#editlay, #handlay')) continue;
    if (!e.classList.contains('press')){ if (!own(e)) out.untiered.push(name(e)); continue; }
    const tier = e.dataset.tier;
    const sh = cs.boxShadow === 'none' ? [] : cs.boxShadow.split(/,(?![^(]*\))/).filter(s => !/inset/.test(s)).map(s => s.replace(/rgba?\([^)]*\)|color\([^)]*\)/g, '').trim().split(/\s+/).map(parseFloat));
    if (tier === 'tertiary' && !e.matches('.clv.many') && sh.some(([x, y]) => x || y))      // a count of many versions is a stack of tags, drawn by its shadow
    out.shadow.push(name(e));
    if (tier !== 'primary' && sh.some(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) > 2)) out.heavy.push(`${name(e)} ${cs.boxShadow}`);
    if (e.matches('[data-act=scr-sent], .keep') && e.getAttribute('aria-pressed') === 'true') out.pressed.push([name(e), ratio(over(rgba(cs.backgroundColor), ground(e)), ground(e))]);
    if (!['primary', 'secondary', 'destructive'].includes(tier)) continue;
    out.n++;
    const g = ground(e), parts = [];
    if (parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none') parts.push(['edge', over(rgba(cs.borderTopColor), g)]);
    parts.push(['fill', over(rgba(cs.backgroundColor), g)]);
    for (const p of ['::before', '::after']){ const ps = getComputedStyle(e, p); if (ps.content !== 'none' && ps.content !== 'normal') parts.push([`fill ${p}`, over(rgba(ps.backgroundColor), g)]); }      // Tea's Fit is a tag drawn behind it
    const best = Math.max(...parts.map(([, c]) => ratio(c, g)));
    if (best < 3) out.weak.push(`${name(e)} ${tier} ${best.toFixed(2)}:1`);
  }
  return out;
}

if (want('contrast')){
  console.log('\n— contrast');
  for (const [drink, theme] of LOOKS){
    const { ctx, page, bad } = await open({ drink, theme });
    for (const [view, go] of Object.entries(VIEWS)){
      let r = null, err = '';
      try { await rest(page); await go(page); await page.mouse.move(4, 4); await page.waitForTimeout(400); r = await page.evaluate(measure); } catch (e){ err = String(e.message ?? e).split('\n')[0].slice(0, 120); }
      const tag = `${drink} ${theme}, ${view}`;
      if (!r){ ok(`${tag}: the view opens`, false, err); continue; }
      ok(`${tag}: every primary, secondary and destructive button has an edge or a fill at 3:1 against its ground (${r.n})`, !r.weak.length, [...new Set(r.weak)].slice(0, 6).join(' | '));
      ok(`${tag}: every button has a tier (press.js) or a look of its own`, !r.untiered.length, [...new Set(r.untiered)].slice(0, 6).join(' | '));
      ok(`${tag}: no tertiary button has a shadow, and only a primary the heavy one`, !r.shadow.length && !r.heavy.length, [...r.shadow, ...r.heavy].slice(0, 4).join(' | '));
      if (r.pressed.length) ok(`${tag}: a pressed Sent only or Keep is filled (3:1 against its ground)`, r.pressed.every(([, x]) => x >= 3), JSON.stringify(r.pressed));
    }
    ok(`${drink} ${theme}: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

// In the page: every delete control shown, its look and its place in its row
function dels([acts, deleteX]){
  const out = { n: 0, bad: [] };
  const seen = e => { const r = e.getBoundingClientRect(); return r.width && r.height && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden'; };
  for (const e of document.querySelectorAll(acts.map(a => `button[data-act="${a}"]`).join(', ') + ', .dp-fix[data-act=chip-remove]')){
    if (!seen(e)) continue;
    out.n++;
    const name = `${e.dataset.act}${e.closest('.menu, [role=menu]') ? ' (menu)' : ''}`, svgs = e.querySelectorAll('svg');
    if (!e.classList.contains('del')) out.bad.push(`${name}: not .del`);
    if (svgs.length !== 1 || svgs[0].querySelector('path')?.getAttribute('d') !== deleteX || svgs[0].getAttribute('width') !== '16' || Math.round(svgs[0].getBoundingClientRect().width) !== 16) out.bad.push(`${name}: not the one X at 16 px`);
    if (e.dataset.act !== 'delete-claim' || !e.dataset.sure){
      const c = getComputedStyle(e).color, b = getComputedStyle(e).getPropertyValue('--bad').trim(), probe = document.createElement('i');
      probe.style.color = b; e.append(probe); const want = getComputedStyle(probe).color; probe.remove();
      if (c !== want) out.bad.push(`${name}: not in the warning colour (${c} / ${want})`);
    }
    const row = [...e.parentElement.children].filter(x => x.matches('button, a, input, select, [role^=menuitem]') && seen(x));
    const after = row.slice(row.indexOf(e) + 1).filter(x => !x.classList.contains('del'));
    if (after.length) out.bad.push(`${name}: followed by ${after.map(x => x.dataset.act || x.className).join(', ')}`);
  }
  return out;
}

if (want('del')){
  console.log('\n— del');
  // the source: every delete control is drawn by the one helper
  const src = fs.readdirSync(path.join(ROOT, 'src/ui')).filter(f => f.endsWith('.js')).map(f => [f, fs.readFileSync(path.join(ROOT, 'src/ui', f), 'utf8')]);
  const loose = [], found = new Set();
  for (const [f, text] of src) for (const m of text.matchAll(/data-act="([a-z-]+)"/g)){
    if (!DEL_ACTS.includes(m[1]) || text[m.index - 1] === '[') continue;      // a selector, not a control
    found.add(m[1]);
    const before = text.slice(Math.max(0, m.index - 300), m.index), helper = Math.max(before.lastIndexOf('delBtn('), before.lastIndexOf('delAskHtml('));
    if (helper < 0 || helper <= before.lastIndexOf('<button')) loose.push(`${f}: ${m[1]}`);
  }
  ok('every delete and remove in src/ui is drawn by parts.js delBtn', !loose.length && DEL_ACTS.every(a => found.has(a)), [...loose, ...DEL_ACTS.filter(a => !found.has(a)).map(a => `missing: ${a}`)].join(' | '));
  const ed = fs.readFileSync(path.join(ROOT, 'src/ui/edit.js'), 'utf8');
  ok('the chip\'s remove (a local line, a skill group) is the delete look (fixTool del), and it stands last on the depth row', (ed.match(/act: 'chip-remove', icon: 'delete', del: true/g) ?? []).length === 2);
  for (const [drink, theme] of LOOKS){
    const { ctx, page, bad } = await open({ drink, theme });
    const DV = {
      line: async () => { await VIEWS.line(page); await page.hover('#body .vrow:not(.cur)'); },
      'name window': () => nameWin(page), 'row menu': () => VIEWS['row menu'](page), menu: () => VIEWS.menu(page),
      'skill group': () => VIEWS['skill group'](page), career: async () => { await page.evaluate(() => window.__wb.setView('record')); await page.waitForTimeout(400); await page.evaluate(() => [...document.querySelectorAll('#scr [data-act=rec-job]')].find(b => b.dataset.key && b.dataset.key !== 'work')?.click()); },
      'a line on this resume only': async () => { await page.evaluate(async () => { const T = await import('/src/model/resume.js'); const job = window.__wb.store.state.record.work[0].id; let id; window.__wb.store.commit(d => { id = T.addLocalLine(d.record, d.cur, job); d.cur.overrides[id] = 'A line for this resume only'; }, 'check: local line'); window.__wb.ui.sel = { kind: 'bullet', id, job }; window.__wb.setView(null); }); },
    };
    let n = 0;
    for (const [view, go] of Object.entries(DV)){
      let r = null, err = '';
      try { await rest(page); await go(); await page.waitForTimeout(400); r = await page.evaluate(dels, [DEL_ACTS, DELETE_X]); } catch (e){ err = String(e.message ?? e).split('\n')[0].slice(0, 120); }
      if (!r){ ok(`${drink} ${theme}, ${view}: the view opens`, false, err); continue; }
      n += r.n;
      ok(`${drink} ${theme}, ${view}: every delete is .del with the one X at 16 px in the warning colour, and only a delete follows it in its row (${r.n})`, !r.bad.length, [...new Set(r.bad)].slice(0, 5).join(' | '));
    }
    ok(`${drink} ${theme}: the views showed delete controls`, n >= 6, String(n));
    if (drink === 'tea' && theme === 'light'){
      // the confirm cases
      const facts = () => page.evaluate(() => window.__wb.store.state.record.facts.map(f => f.id));
      const claimWith = k => page.evaluate(k => { const s = window.__wb.store.state, w = s.record.work.find(j => j.highlights.some(h => (k > 1) === (s.record.facts.find(f => f.id === h)?.variants?.length > 1))); const id = w?.highlights.find(h => (k > 1) === (s.record.facts.find(f => f.id === h)?.variants?.length > 1)); return id ? { id, job: w.id } : null; }, k);
      const openClaim = async c => { await rest(page); await page.evaluate(c => { window.__wb.ui.sel = { kind: 'bullet', id: c.id, job: c.job }; window.__wb.setView(null); }, c); await page.waitForTimeout(300); };
      const many = await claimWith(2);
      await openClaim(many); await page.click('#body [data-act=delete-claim]'); await page.waitForTimeout(250);
      const asked = await page.evaluate(() => { const a = document.querySelector('#body .delask'); const b = a ? [...a.querySelectorAll('button')].map(x => x.dataset.act) : []; return { b, focus: document.activeElement?.dataset?.sure === '1' }; });
      ok('a line with more than one version asks first, in place: Cancel, then Delete last, the focus on Delete; nothing deleted yet', asked.b.join() === 'delete-claim-no,delete-claim' && asked.focus && (await facts()).includes(many.id), JSON.stringify(asked));
      await page.click('#body .delask [data-act=delete-claim-no]'); await page.waitForTimeout(250);
      ok('…Cancel takes the question away and keeps the line', !(await page.$('#body .delask')) && (await facts()).includes(many.id));
      await page.click('#body [data-act=delete-claim]'); await page.waitForTimeout(200); await page.click('#body .delask [data-act=delete-claim]'); await page.waitForTimeout(400);
      ok('…Delete deletes it, with Undo on the toast', !(await facts()).includes(many.id) && !!(await page.$('#toast [data-act=toast-undo]')));
      const one = await claimWith(1);
      if (one){ await openClaim(one); await page.click('#body [data-act=delete-claim]'); await page.waitForTimeout(400); }
      ok('a line with one version is deleted at once (Undo on the toast), no question', !!one && !(await facts()).includes(one.id) && !(await page.$('#body .delask')), JSON.stringify(one));
      // a resume with a sent copy
      await rest(page);
      const rid = await page.evaluate(async () => { const RS = await import('/src/model/resumes.js'); window.__wb.store.commit(d => { RS.takeSnapshot(d, { kind: 'company', company: 'Check Co', role: 'Tester', date: '2026-10-22' }); }, 'check: sent'); return window.__wb.store.state.openId; });
      const has = () => page.evaluate(id => (window.__wb.store.state.resumes ?? []).some(r => r.id === id), rid);
      await nameWin(page); await page.click('#switcher [data-act=rm-delete]'); await page.waitForTimeout(250);
      const wq = await page.evaluate(() => { const a = document.querySelector('#switcher .delask'); return a ? { text: a.textContent, b: [...a.querySelectorAll('button')].map(x => x.dataset.act) } : null; });
      ok('the open resume with a sent copy asks first under the name window\'s Delete: Cancel, then Delete', !!wq && /sent cop/.test(wq.text) && wq.b.join() === 'rm-ask-no,rm-delete' && await has(), JSON.stringify(wq));
      await page.click('#switcher .delask [data-act=rm-ask-no]'); await page.waitForTimeout(250);
      ok('…Cancel keeps it', !(await page.$('#switcher .delask')) && await has());
      await page.click('#switcher .swrow.is-cur .smore'); await page.waitForTimeout(200); await page.click('.rowmenu [data-act=rm-delete]'); await page.waitForTimeout(250);
      const rq = await page.evaluate(() => { const m = document.querySelector('.rowmenu.delask'); return m ? [...m.querySelectorAll('[role=menuitem]')].map(x => x.dataset.act) : null; });
      ok('…and in its row menu the menu becomes the question: Cancel, then Delete', rq?.join() === 'rm-menu,rm-delete' && await has(), JSON.stringify(rq));
      await page.click('.rowmenu.delask [data-act=rm-delete]'); await page.waitForTimeout(500);
      ok('…Delete deletes it, with Undo on the toast', !(await has()) && !!(await page.$('#toast [data-act=toast-undo]')));
    }
    ok(`${drink} ${theme}: del: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

if (want('order')){
  console.log('\n— order');
  const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks/fixtures/button-order.json'), 'utf8'));
  const { ctx, page, bad } = await open({});
  const OV = {
    line: () => VIEWS.line(page), 'name window': () => nameWin(page), 'row menu': () => VIEWS['row menu'](page),
    'export dialog': () => VIEWS['export dialog'](page), 'review list': () => VIEWS['review list'](page),
    'new resume': () => page.evaluate(() => window.__wb.setView('new')),
    'mark as sent': () => page.evaluate(() => window.__wb.resumes.markSent()),
    'sent copy': async () => { await page.evaluate(async () => { const RS = await import('/src/model/resumes.js'); let sid; window.__wb.store.commit(d => { sid = RS.takeSnapshot(d, { kind: 'company', company: 'Order Co', role: 'Tester', date: '2026-10-22' })?.snap?.id; }, 'check: sent'); const s = window.__wb.store.state, r = s.resumes.find(x => x.id === s.openId); window.__wb.resumes.openSnapshot(r.id, (r.snapshots ?? []).at(-1).id); }); },
    'a question': async () => { await VIEWS.line(page); await page.click('#body [data-act=delete-claim]'); },
    merge: async () => { await page.click('#head [data-act=menu]'); await page.click('.menu [data-v=import]'); await page.waitForTimeout(300); await page.setInputFiles('#file', path.join(ROOT, 'checks/fixtures/jsonresume-sample.json')); await page.waitForTimeout(800); await page.click('[data-act=imp-merge]'); },
    'career add': async () => { await page.evaluate(() => window.__wb.setView('record')); await page.waitForTimeout(400); await page.click('[data-act=c-pop]'); await page.click('[data-act=c-add][data-what=project]'); },
  };
  const found = new Map();
  const read = () => page.evaluate(([pairs, cancels]) => {
    const seen = e => { const r = e.getBoundingClientRect(); return r.width && r.height && !e.closest('[hidden]'); };
    const out = { pairs: [], cancel: [] };
    for (const p of pairs){
      const rows = new Map();
      p.order.forEach((sel, k) => { for (const e of document.querySelectorAll(sel)) if (seen(e)) { const row = e.closest('.btns, .rvfoot-btns, .swacts, .snapacts, [role=menu], .ctlrow, .racts, .iacts, .delask, .rvbtns') ?? e.parentElement; (rows.get(row) ?? rows.set(row, []).get(row)).push([k, e]); } });
      for (const items of rows.values()){
        if (new Set(items.map(([k]) => k)).size < 2) continue;
        const dom = items.slice().sort(([, a], [, b]) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)).map(([k]) => k);
        out.pairs.push({ name: p.name, ok: dom.every((k, i) => !i || dom[i - 1] <= k), dom: dom.join(',') });
      }
    }
    for (const sel of cancels) for (const e of document.querySelectorAll(sel)) if (seen(e) && !(e.classList.contains('ghost') && e.dataset.tier === 'tertiary')) out.cancel.push(`${sel} ${e.className} ${e.dataset.tier}`);
    return out;
  }, [FX.pairs, FX.cancel]);
  for (const [view, go] of Object.entries(OV)){
    let r = null, err = '';
    try { await rest(page); await go(); await page.mouse.move(4, 4); await page.waitForTimeout(500); r = await read(); } catch (e){ err = String(e.message ?? e).split('\n')[0].slice(0, 120); }
    if (!r){ ok(`${view}: the view opens`, false, err); continue; }
    for (const p of r.pairs){ (found.get(p.name) ?? found.set(p.name, new Set()).get(p.name)).add(view); ok(`${view}: ${p.name} in its order`, p.ok, p.dom); }
    ok(`${view}: every Cancel is tertiary words (a link)`, !r.cancel.length, r.cancel.join(' | '));
  }
  // the editor's Save, Save as, This only, Cancel (parts.js editorHtml; a line is written on the page now, so the panel's editor is only in the markup snapshot)
  { const src = fs.readFileSync(path.join(ROOT, 'src/ui/parts.js'), 'utf8'), at = ['ed-save', 'ed-saveas', 'ed-only', 'ed-cancel'].map(a => src.indexOf(`data-act="${a}"`, src.indexOf('export function editorHtml')));
    ok('editor (parts.js editorHtml): Save, Save as, This only, Cancel in its order', at.every((x, k) => x > 0 && (!k || at[k - 1] < x)), at.join()); }
  for (const p of FX.pairs) for (const v of p.in) ok(`${p.name}: found in ${v}`, !!found.get(p.name)?.has(v), [...(found.get(p.name) ?? [])].join(', '));
  ok('order: no page errors', !bad.length, bad.slice(0, 2).join(' | '));
  await ctx.close();
}

if (want('name')){
  console.log('\n— name');
  const win = page => page.evaluate(() => {
    const w = document.querySelector('#switcher'), kids = [...w.children].filter(e => getComputedStyle(e).display !== 'none' && !e.matches('.sr'));
    const acts = [...w.querySelectorAll('.swacts > button')].map(b => b.dataset.act), lbl = w.querySelector('.swacts')?.previousElementSibling;
    const m = w.querySelector('.swmanage'), f = m?.parentElement.getBoundingClientRect(), mr = m?.getBoundingClientRect();
    return { acts: acts.join(), lbl: lbl?.matches('.lbl') ? lbl.textContent.trim() : null, record: !!w.querySelector('[data-act=sw-record]'), first: w.querySelector('#sw-list')?.firstElementChild?.dataset.act,
      manage: !!m && mr.width >= f.width - 1 && !!m.querySelector('svg') && m.dataset.tier === 'secondary' };
  });
  for (const [drink, theme] of LOOKS){
    const { ctx, page, bad } = await open({ drink, theme });
    const card = async () => page.evaluate(() => {
      const hd = document.querySelector('#head').getBoundingClientRect(), b = document.querySelector('#docname-btn'), m = document.querySelector('#head [data-act=menu]');
      const br = b.getBoundingClientRect(), mr = m.getBoundingClientRect(), sh = e => getComputedStyle(e).boxShadow;
      return { left: br.left - hd.left, top: br.top - hd.top, toMenu: mr.left - br.right, menuIn: Math.min(hd.right - mr.right, mr.top - hd.top), sh: [sh(b), sh(m)] };
    });
    const tag = `${drink} ${theme}`;
    const c0 = await card();
    ok(`${tag}: the name is one large button, the card's top edge to edge, and ⋯ a corner of its own 8 px inside the card`, c0.left <= 1.5 && c0.top <= 1.5 && c0.toMenu >= 0 && c0.menuIn >= 8, JSON.stringify(c0));
    await page.hover('#docname-btn'); await page.waitForTimeout(150); const c1 = await card();
    await page.hover('#head [data-act=menu]'); await page.waitForTimeout(150); const c2 = await card();
    await page.click('#docname-btn'); await page.waitForTimeout(300); await page.mouse.move(4, 4); const c3 = await card();
    ok(`${tag}: neither the name nor ⋯ has a shadow, at rest, on hover or with the window open`, [c0, c1, c2, c3].every(c => c.sh.every(x => x === 'none')), JSON.stringify([c0.sh, c1.sh, c2.sh, c3.sh]));
    const w = await win(page);
    ok(`${tag}: the name window: "This resume" holds Duplicate then Delete, no Record, + New resume first in the list, Manage all full width with an arrow`, w.acts === 'rm-dup,rm-delete' && !!w.lbl && !w.record && w.first === 'sw-new' && w.manage, JSON.stringify(w));
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await page.click('#head [data-act=menu]'); await page.waitForTimeout(200);
    const mn = await page.evaluate(() => { const m = document.querySelector('#head .menu'), r = m.getBoundingClientRect(), rows = [...m.querySelectorAll(':scope > button, :scope > a')];
      return { inset: Math.min(...rows.map(x => x.getBoundingClientRect().left - r.left)), shadow: rows.filter(x => getComputedStyle(x).boxShadow !== 'none').length, fill: rows.filter(x => !x.matches(':hover') && !/rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(x).backgroundColor)).length }; });
    ok(`${tag}: the ⋯ menu's rows are flat (no shadow, no fill at rest), their hover fill 8 px inside the menu`, mn.inset >= 7.5 && mn.inset <= 10.5 && !mn.shadow && !mn.fill, JSON.stringify(mn));
    ok(`${tag}: name: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
  const { ctx, page, bad } = await open({ phone: true });
  await page.click('#docname-btn'); await page.waitForTimeout(400);
  const w = await win(page);
  ok('a phone\'s name window: the same order (This resume: Duplicate then Delete; + New resume first; Manage all with an arrow), no Record', w.acts === 'rm-dup,rm-delete' && !!w.lbl && !w.record && w.first === 'sw-new' && w.manage, JSON.stringify(w));
  ok('phone: no page errors', !bad.length, bad.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} button checks FAILED` : '\nall button checks passed');
process.exit(failed ? 1 : 0);
