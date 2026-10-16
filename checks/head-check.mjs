#!/usr/bin/env node
// node checks/head-check.mjs
// The place tabs (Library, Editor, Career), the name card (the name and the menu: no Fit, no Saved), the name window and the seam (Saved, undo and redo; the page bars are Export's, with Fit), at 1280×720, 1470×832 and 1920×1080, in all ten interface languages, in Tea light and
// Coffee dark, with three names: 'Example Instruments — Mechanical Design Engineer', one of 60 characters and one unbroken word of 40.
//   - no control is covered by another or overlaps one (the control at the centre of each is itself), and no label runs out of its control,
//   - the name is never cut: no ellipsis style on it, its box wide enough for it (scrollWidth <= clientWidth), at most three lines; on a window 850px high or less the card is one line and the role may end in an ellipsis,
//   - the place tabs: three buttons with a name, one of them aria-current, the Editor's with its pencil, shorter on a window 850px high or less, nothing cut or overlapping,
//   - the name window (the name card grown over the editor card) shows all its items without scrolling at 1280×720 and the page does not move,
//   - the page bars, at the top of Export beside Fit: one thin vertical bar for each page (1, 2 and 3 pages; under, in the band, over; a 4th page is a "+1"), no text in a bar, its page, fill and state in its name.
// Chromium through Playwright (PW_BUNDLED=1, or CHROME_PATH); writes nothing.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8143);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;      // ONLY=de,hu: a few languages
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});

const LANGS = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu'].filter(l => !ONLY || ONLY.has(l));
const SIZES = [[1280, 720], [1470, 832], [1920, 1080]];
const LOOKS = [['tea', 'light'], ['coffee', 'dark']];
const NAMES = { long: 'Example Instruments — Mechanical Design Engineer', sixty: 'Example Instruments — Senior Mechanical Design Engineer, EMEA'.slice(0, 60), word: 'Abcdefghij'.repeat(4) };

// ---- what the page is asked, in the page ----
const PROBE = `(() => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = el => (el.getAttribute('aria-label') || el.textContent || el.id || el.className || el.tagName).toString().trim().replace(/\\s+/g, ' ').slice(0, 28);
  const textRects = el => { const out = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n; (n = w.nextNode());){ if (!n.nodeValue.trim() || n.parentElement.closest('.sr')) continue; const g = document.createRange(); g.selectNodeContents(n); out.push(...g.getClientRects()); } return out; };
  const out = { covered: [], overlap: [], clipped: [], name: {}, items: 0 };
  const scope = ['#rail', '#ptabs', '#head', '#switcher'].map(s => document.querySelector(s)).filter(e => e && vis(e));
  const controls = [...document.querySelectorAll('#rail button, #ptabs button, #head button, #head [tabindex], #switcher button, #switcher input, #switcher select')].filter(vis);
  out.items = controls.length;
  for (const el of controls){
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
    const top = document.elementFromPoint(cx, cy);
    if (!(top === el || el.contains(top) || (top && top.contains(el) && !top.matches('#col, #rail, #ptabs, #head, #switcher, body, html')))) out.covered.push(label(el) + ' under ' + (top ? top.tagName.toLowerCase() + (top.id ? '#' + top.id : '.' + String(top.className).split(' ')[0]) : 'nothing'));
    if (el.matches('#docname-btn') && matchMedia('(max-height: 850px)').matches) continue;      // compact: the name is one line and ends in an ellipsis
    for (const t of textRects(el)) if (t.right > r.right + 1 || t.left < r.left - 1 || t.bottom > r.bottom + 1 || t.top < r.top - 1){ out.clipped.push(label(el) + ' runs out of its box'); break; }
  }
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++){
    const a = controls[i], b = controls[j];
    if (a.contains(b) || b.contains(a)) continue;
    let p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
    // Tea's tags are tucked behind the name card: only what shows above it counts
    const tuck = (r, el) => (el.closest('#ptabs') ? { left: r.left, right: r.right, top: r.top, bottom: Math.min(r.bottom, document.querySelector('#head').getBoundingClientRect().top) } : r);
    p = tuck(p, a); q = tuck(q, b);
    if (Math.min(p.right, q.right) - Math.max(p.left, q.left) > 1.5 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 1.5) out.overlap.push(label(a) + ' / ' + label(b));
  }
  const dn = document.querySelector('#docname'), btn = document.querySelector('#docname-btn');
  if (dn){
    const lines = new Set(textRects(dn).map(r => Math.round(r.top)));
    const ell = [dn, btn, ...dn.querySelectorAll('*')].filter(e => getComputedStyle(e).textOverflow === 'ellipsis').length;
    out.name = { compact: matchMedia('(max-height: 850px)').matches, cut: dn.scrollWidth > dn.clientWidth + 1 || btn.scrollWidth > btn.clientWidth + 1, ellipsis: ell, lines: lines.size, tall: dn.scrollHeight > dn.clientHeight + 1, headFit: dn.getBoundingClientRect().right <= document.querySelector('#head').getBoundingClientRect().right + 0.5, inside: textRects(dn).every(t => t.right <= btn.getBoundingClientRect().right + 0.5 && t.left >= btn.getBoundingClientRect().left - 0.5) };
  }
  const sw = document.querySelector('#switcher');
  const list = sw?.querySelector('.swlist');
  out.window = sw && vis(sw) ? { scroll: Math.max(sw.scrollHeight - sw.clientHeight, list ? list.scrollHeight - list.clientHeight : 0), spare: sw.clientHeight - [...sw.children].reduce((n, c) => n + c.getBoundingClientRect().height + 6, 0) } : null;
  // Fit and Saved have left the name card: Saved is the seam's, Fit is Export's
  if (document.querySelector('#head [data-act=fit], #head .savestate, #head .fitslot')) out.clipped.push('Fit or Saved is still in the name card');
  if (!document.querySelector('#rail .rhist .savestate') || !document.querySelector('#head [data-act=menu]')) out.clipped.push('no Saved in the seam, or no menu in the name card');
  const pt = [...document.querySelectorAll('#ptabs .ptab')];
  out.tabs = { names: pt.map(b => b.getAttribute('aria-label')), current: pt.filter(b => b.getAttribute('aria-current') === 'page').length, svg: pt.map(b => !!b.querySelector('svg')), h: pt.map(b => Math.round(b.getBoundingClientRect().height)), cut: pt.some(b => [...b.querySelectorAll('span')].some(x => x.scrollWidth > x.clientWidth + 1)) };
  const sel = document.querySelectorAll('#switcher select');
  for (const s of sel) if (s.scrollWidth > s.clientWidth + 1 && vis(s)) out.clipped.push('a select is cut');
  return out;
})()`;
const pageX = page => page.evaluate(() => { const b = window.__wb.sheet.pageBoxes()[0]; const r = window.__wb.canvas.screenRect(b); return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10]; });
const settle = page => page.waitForTimeout(350);

const tabHeights = {};
for (const [drink, theme] of LOOKS){
  for (const [w, h] of SIZES){
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(([d, t]) => { try { localStorage.setItem('rb-help-seen', '1'); localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); } catch { /* none */ } }, [drink, theme]);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    // four recent resumes, so the name window is as full as it gets
    await page.evaluate(() => { localStorage.setItem('rb-recent', JSON.stringify(window.__wb.store.state.resumes.slice(0, 4).map(r => r.id))); });
    const x0 = await pageX(page);
    const tag = `${drink} ${theme} ${w}×${h}`;
    for (const lang of LANGS){
      const bad = { closed: [], opened: [] }, names = {}, tabH = [];
      for (const [key, name] of Object.entries(NAMES)){
        try {
          await page.evaluate(async ([l, n]) => {
            const I = await import('/src/i18n/index.js'); await I.loadCatalogue(l);
            window.__wb.ui.pref = { mode: 'fixed', lang: l };
            window.__wb.store.commit(d => { d.cur.name = n; }, 'name');
          }, [lang, name]);
          await settle(page);
          if (await page.evaluate(() => document.querySelector('#switcher') && !document.querySelector('#switcher').hidden)) await page.keyboard.press('Escape');
          const a = await page.evaluate(PROBE);
          names[key] = a.name;
          for (const k of ['covered', 'overlap', 'clipped']) bad.closed.push(...a[k].map(x => `${key}: ${x}`));
          if (a.name.compact){ if (a.name.lines !== 1 || !a.name.headFit) bad.closed.push(`${key}: the compact name card is not one line (${JSON.stringify(a.name)})`); }
          else if (a.name.cut || a.name.ellipsis || !a.name.inside || a.name.tall) bad.closed.push(`${key}: the name is cut (${JSON.stringify(a.name)})`);
          if (a.name.lines > 3) bad.closed.push(`${key}: the name takes ${a.name.lines} lines`);
          if (a.tabs.names.join() !== 'Library,Editor,Career' || a.tabs.current !== 1 || !a.tabs.svg.every(Boolean) || a.tabs.cut) bad.closed.push(`${key}: the place tabs (${JSON.stringify(a.tabs)})`);
          tabH.push(...a.tabs.h);
          await page.click('#docname-btn'); await settle(page);
          const o = await page.evaluate(PROBE);
          for (const k of ['covered', 'overlap', 'clipped']) bad.opened.push(...o[k].map(x => `${key}: ${x}`));
          if (!o.window) bad.opened.push(`${key}: the window is not there`);
          else if (o.window.scroll > 1) bad.opened.push(`${key}: the window scrolls by ${o.window.scroll}px`);
          if (!o.name.compact && (o.name.cut || o.name.ellipsis)) bad.opened.push(`${key}: the name is cut in the window`);
          const xs = await pageX(page);
          if (xs[0] !== x0[0] || xs[1] !== x0[1]) bad.opened.push(`${key}: the page moved ${x0} → ${xs}`);
          await page.keyboard.press('Escape'); await settle(page);
          if (await page.evaluate(() => document.activeElement?.id) !== 'docname-btn') bad.opened.push(`${key}: Esc did not give the focus back to the name`);
        } catch (e){ bad.opened.push(`${key}: ${String(e.message ?? e).split('\n')[0].slice(0, 80)}`); }
      }
      if (lang === LANGS[0]) tabHeights[tag] = Math.max(...tabH);
      ok(`${tag} ${lang}: the place tabs, the name card (no Fit, no Saved) and the seam: nothing covered, overlapping or cut; the name whole`, bad.closed.length === 0, [...new Set(bad.closed)].slice(0, 3).join(' ; '));
      ok(`${tag} ${lang}: the name window: nothing covered, overlapping or cut${h === 720 ? ', no scrolling' : ''}; the page stays; Esc returns to the name`, bad.opened.length === 0, [...new Set(bad.opened)].slice(0, 3).join(' ; '));
    }
    // ---- the page bars at the top of Export, beside Fit: 1, 2 and 3 pages in the three states, and a fourth ----
    await page.evaluate(() => window.__wb.store.commit(d => { d.cur.name = 'Example Instruments — Mechanical Design Engineer'; }, 'name'));
    await page.evaluate(async () => { const I = await import('/src/i18n/index.js'); await I.loadCatalogue('de'); window.__wb.ui.pref = { mode: 'fixed', lang: 'de' }; window.__wb.store.commit(d => { d.cur.name = 'Beispiel'; }, 'name'); });
    await settle(page);
    await page.evaluate(() => window.__wb.setView('export')); await settle(page);
    const barBad = [];
    for (const n of [1, 2, 3, 4]) for (const [state, pct] of [['under', 60], ['in the band', 92], ['over', 99]]){
      const got = await page.evaluate(([n, pct]) => {
        const u = window.__wb.ui, keep = u.fills;
        u.fills = Array.from({ length: n }, (_, i) => ({ page: i + 1, used: i === n - 1 ? pct : 100, usable: 100, overflow: 0 }));
        window.__wb.dock.renderFoot();
        const ms = [...document.querySelectorAll('#body .exfit .meter')], more = document.querySelector('#body .exfit .rmore'), hist = document.querySelector('#body .exfit').getBoundingClientRect(), undo = { top: 1e9 };
        const R = e => e.getBoundingClientRect();
        const r = { n: ms.length, text: ms.map(m => m.textContent.trim()).join(''), names: ms.map(m => m.getAttribute('aria-label')), tips: ms.map(m => m.dataset.tip), classes: ms.map(m => m.className), bars: ms.map(m => R(m).width), tall: ms.map(m => R(m).height), more: more ? more.textContent : null, moreName: more?.getAttribute('aria-label'),
          inside: [...ms, ...(more ? [more] : [])].every(m => R(m).left >= hist.left - 0.5 && R(m).right <= hist.right + 0.5 && R(m).bottom <= undo.top + 0.5), apart: ms.every((m, i) => i === 0 || R(m).left >= R(ms[i - 1]).right - 0.5), fills: ms.map(m => parseFloat(getComputedStyle(m.querySelector('.mfill')).height) / parseFloat(getComputedStyle(m.querySelector('.mbar')).height)) };
        u.fills = keep;
        return r;
      }, [n, pct]);
      const want = state === 'under' ? 'under' : state === 'over' ? 'over' : 'ok', shown = Math.min(n, 3);
      if (got.n !== shown) barBad.push(`${n} pages: ${got.n} bars`);
      if ((got.more ?? null) !== (n > 3 ? `+${n - 3}` : null)) barBad.push(`${n} pages: the "+n" says ${got.more}`);
      if (n > 3 && !/\d/.test(got.moreName ?? '')) barBad.push(`${n} pages: "+n" has no name`);
      if (got.text) barBad.push(`${n} pages: text in a bar “${got.text}”`);
      if (!got.names.every(x => /\d/.test(x ?? '') && /%/.test(x ?? '') && x.length > 10)) barBad.push(`${n} pages: a bar without its page, fill and state in its name`);
      if (!got.tips.every(x => /%/.test(x ?? ''))) barBad.push(`${n} pages: a bar without its tip`);
      if (n <= 3 && !got.classes.at(-1).split(' ').includes(want)) barBad.push(`${n} pages, ${state}: the last bar is ${got.classes.at(-1)}`);
      if (got.bars.some(b => b < 12) || got.tall.some(b => b < 40)) barBad.push(`${n} pages: a bar under 12 x 40px`);
      if (!got.inside || !got.apart) barBad.push(`${n} pages: the bars run out of their card or overlap`);
    }
    await page.evaluate(() => window.__wb.dock.renderFoot());
    ok(`${tag}: Fit and the page bars are in Export only, once: one thin vertical bar for each page (1, 2, 3 and a +1; under, in the band, over), no text in it, its page, fill and state in its name, inside their row`, barBad.length === 0 && await page.evaluate(() => document.querySelectorAll('[data-act=fit]').length === 1 && !document.querySelector('#rail .meter, #head .fitslot')), [...new Set(barBad)].slice(0, 3).join(' ; '));
    await ctx.close();
  }
}
// ---- the name window and the page, the language select and the arrow keys ----
{
  const ctx = await browser.newContext({ viewport: { width: 1470, height: 832 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('rb-help-seen', '1'); } catch { /* none */ } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const shown = () => page.evaluate(() => { const e = document.querySelector('#switcher'); return !!e && !e.hidden; });
  await page.click('#docname-btn'); await settle(page);
  await page.focus('#sw-lang'); await page.keyboard.press('ArrowDown'); await settle(page);
  ok('ArrowDown on the language select changes the select and leaves the focus in it', await page.evaluate(() => document.activeElement?.id) === 'sw-lang');
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  ok('a click on a line of the page closes the name window', !(await shown()));
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('rb-help-seen', '1'); } catch { /* none */ } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 });
  await page.evaluate(() => window.__wb.dock.setMode('export')); await settle(page);
  ok('on a phone, Export has one Save to file and one place that says where the file stands', await page.evaluate(() => document.querySelectorAll('#filestate').length === 1 && document.querySelectorAll('[data-act=save-file]').length === 1));
  await ctx.close();
}
for (const [drink, theme] of LOOKS){ const T = n => tabHeights[`${drink} ${theme} ${n}`]; ok(`${drink}: on a window 850px high or less the place tabs are shorter than on a tall one`, T('1280×720') < T('1920×1080') && T('1470×832') < T('1920×1080'), JSON.stringify(tabHeights)); }
await browser.close(); server.close();
console.log(failed ? `\n${failed} head check(s) FAILED` : '\nall head checks passed');
process.exit(failed ? 1 : 0);
