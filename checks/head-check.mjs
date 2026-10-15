#!/usr/bin/env node
// node checks/head-check.mjs
// The name card, the name window, the rail and the foot, at 1280×720, 1470×832 and 1920×1080, in all ten interface languages, in Tea light and
// Coffee dark, with three names: 'Example Instruments — Mechanical Design Engineer', one of 60 characters and one unbroken word of 40.
//   - no control is covered by another or overlaps one (the control at the centre of each is itself), and no label runs out of its control,
//   - the name is never cut: no ellipsis style on it, its box wide enough for it (scrollWidth <= clientWidth), at most three lines,
//   - the name window (the name card grown over the editor card) shows all its items without scrolling at 1280×720 and the page does not move,
//   - the foot: one thin bar for each page (1, 2 and 3 pages; under, in the band, over), no text in a bar, its page, fill and state in its name.
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
  const scope = ['#rail', '#head', '#foot', '#switcher'].map(s => document.querySelector(s)).filter(e => e && vis(e));
  const controls = [...document.querySelectorAll('#rail button, #head button, #head [tabindex], #foot button, #switcher button, #switcher input, #switcher select')].filter(vis);
  out.items = controls.length;
  for (const el of controls){
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
    const top = document.elementFromPoint(cx, cy);
    if (!(top === el || el.contains(top) || (top && top.contains(el) && !top.matches('#col, #rail, #head, #foot, #switcher, body, html')))) out.covered.push(label(el) + ' under ' + (top ? top.tagName.toLowerCase() + (top.id ? '#' + top.id : '.' + String(top.className).split(' ')[0]) : 'nothing'));
    for (const t of textRects(el)) if (t.right > r.right + 1 || t.left < r.left - 1 || t.bottom > r.bottom + 1 || t.top < r.top - 1){ out.clipped.push(label(el) + ' runs out of its box'); break; }
  }
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++){
    const a = controls[i], b = controls[j];
    if (a.contains(b) || b.contains(a)) continue;
    const p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
    if (Math.min(p.right, q.right) - Math.max(p.left, q.left) > 1.5 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 1.5) out.overlap.push(label(a) + ' / ' + label(b));
  }
  const dn = document.querySelector('#docname'), btn = document.querySelector('#docname-btn');
  if (dn){
    const lines = new Set(textRects(dn).map(r => Math.round(r.top)));
    const ell = [dn, btn, ...dn.querySelectorAll('*')].filter(e => getComputedStyle(e).textOverflow === 'ellipsis').length;
    out.name = { cut: dn.scrollWidth > dn.clientWidth + 1 || btn.scrollWidth > btn.clientWidth + 1, ellipsis: ell, lines: lines.size, tall: dn.scrollHeight > dn.clientHeight + 1, inside: textRects(dn).every(t => t.right <= btn.getBoundingClientRect().right + 0.5 && t.left >= btn.getBoundingClientRect().left - 0.5) };
  }
  const sw = document.querySelector('#switcher');
  const list = sw?.querySelector('.swlist');
  out.window = sw && vis(sw) ? { scroll: Math.max(sw.scrollHeight - sw.clientHeight, list ? list.scrollHeight - list.clientHeight : 0), spare: sw.clientHeight - [...sw.children].reduce((n, c) => n + c.getBoundingClientRect().height + 6, 0) } : null;
  const sel = document.querySelectorAll('#switcher select');
  for (const s of sel) if (s.scrollWidth > s.clientWidth + 1 && vis(s)) out.clipped.push('a select is cut');
  return out;
})()`;
const pageX = page => page.evaluate(() => { const b = window.__wb.sheet.pageBoxes()[0]; const r = window.__wb.canvas.screenRect(b); return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10]; });
const settle = page => page.waitForTimeout(350);

for (const [drink, theme] of LOOKS){
  for (const [w, h] of SIZES){
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(([d, t]) => { try { localStorage.setItem('rb-help-seen', '1'); localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); } catch { /* none */ } }, [drink, theme]);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/?memory`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    // four recent resumes, so the name window is as full as it gets
    await page.evaluate(() => { localStorage.setItem('rb-recent', JSON.stringify(window.__wb.store.state.resumes.slice(0, 4).map(r => r.id))); });
    const x0 = await pageX(page);
    const tag = `${drink} ${theme} ${w}×${h}`;
    for (const lang of LANGS){
      const bad = { closed: [], opened: [] }, names = {};
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
          if (a.name.cut || a.name.ellipsis || !a.name.inside || a.name.tall) bad.closed.push(`${key}: the name is cut (${JSON.stringify(a.name)})`);
          if (a.name.lines > 3) bad.closed.push(`${key}: the name takes ${a.name.lines} lines`);
          await page.click('#docname-btn'); await settle(page);
          const o = await page.evaluate(PROBE);
          for (const k of ['covered', 'overlap', 'clipped']) bad.opened.push(...o[k].map(x => `${key}: ${x}`));
          if (!o.window) bad.opened.push(`${key}: the window is not there`);
          else if (o.window.scroll > 1) bad.opened.push(`${key}: the window scrolls by ${o.window.scroll}px`);
          if (o.name.cut || o.name.ellipsis) bad.opened.push(`${key}: the name is cut in the window`);
          const xs = await pageX(page);
          if (xs[0] !== x0[0] || xs[1] !== x0[1]) bad.opened.push(`${key}: the page moved ${x0} → ${xs}`);
          await page.keyboard.press('Escape'); await settle(page);
          if (await page.evaluate(() => document.activeElement?.id) !== 'docname-btn') bad.opened.push(`${key}: Esc did not give the focus back to the name`);
        } catch (e){ bad.opened.push(`${key}: ${String(e.message ?? e).split('\n')[0].slice(0, 80)}`); }
      }
      ok(`${tag} ${lang}: the name card, rail and foot: nothing covered, overlapping or cut; the name whole`, bad.closed.length === 0, [...new Set(bad.closed)].slice(0, 3).join(' ; '));
      ok(`${tag} ${lang}: the name window: nothing covered, overlapping or cut${h === 720 ? ', no scrolling' : ''}; the page stays; Esc returns to the name`, bad.opened.length === 0, [...new Set(bad.opened)].slice(0, 3).join(' ; '));
    }
    // ---- the foot: 1, 2 and 3 pages in the three states ----
    await page.evaluate(() => window.__wb.store.commit(d => { d.cur.name = 'Example Instruments — Mechanical Design Engineer'; }, 'name'));
    await page.evaluate(async () => { const I = await import('/src/i18n/index.js'); await I.loadCatalogue('de'); window.__wb.ui.pref = { mode: 'fixed', lang: 'de' }; window.__wb.store.commit(d => { d.cur.name = 'Beispiel'; }, 'name'); });
    await settle(page);
    const footBad = [];
    for (const n of [1, 2, 3]) for (const [state, pct] of [['under', 60], ['in the band', 92], ['over', 99]]){
      const got = await page.evaluate(([n, pct]) => {
        const u = window.__wb.ui, keep = u.fills;
        u.fills = Array.from({ length: n }, (_, i) => ({ page: i + 1, used: i === n - 1 ? pct : 100, usable: 100, overflow: 0 }));
        window.__wb.dock.renderFoot();
        const ms = [...document.querySelectorAll('#foot .meter')], f = document.querySelector('#foot [data-act=fit]'), foot = document.querySelector('#foot').getBoundingClientRect();
        const r = { n: ms.length, text: ms.map(m => m.textContent.trim()).join(''), names: ms.map(m => m.getAttribute('aria-label')), tips: ms.map(m => m.dataset.tip), classes: ms.map(m => m.className), bars: ms.map(m => m.getBoundingClientRect().width), fit: f.getBoundingClientRect(), last: ms.at(-1).getBoundingClientRect(), foot: [foot.left, foot.right] };
        u.fills = keep;
        return r;
      }, [n, pct]);
      const want = state === 'under' ? 'under' : state === 'over' ? 'over' : 'ok';
      if (got.n !== n) footBad.push(`${n} pages: ${got.n} bars`);
      if (got.text) footBad.push(`${n} pages: text in a bar “${got.text}”`);
      if (!got.names.every(x => /\d/.test(x ?? ''))) footBad.push(`${n} pages: a bar without its page and fill in its name`);
      if (!got.classes.at(-1).split(' ').includes(want)) footBad.push(`${n} pages, ${state}: the last bar is ${got.classes.at(-1)}`);
      if (got.bars.some(b => b < 24)) footBad.push(`${n} pages: a bar under 24px`);
      if (got.last.right > got.fit.left + 1 || got.fit.right > got.foot[1] + 1) footBad.push(`${n} pages: Fit and the bars collide or run out`);
    }
    await page.evaluate(() => window.__wb.dock.renderFoot());
    ok(`${tag}: the foot: one thin bar for each page (1, 2, 3; under, in the band, over), no text in it, its page, fill and state in its name, Fit beside them`, footBad.length === 0, [...new Set(footBad)].slice(0, 3).join(' ; '));
    await ctx.close();
  }
}
// ---- the name window and the page, the language select and the arrow keys ----
{
  const ctx = await browser.newContext({ viewport: { width: 1470, height: 832 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('rb-help-seen', '1'); } catch { /* none */ } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?memory`, { waitUntil: 'networkidle' });
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
  await page.goto(`http://localhost:${PORT}/?memory`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 });
  await page.evaluate(() => window.__wb.dock.setMode('export')); await settle(page);
  ok('on a phone, Export has one Save to file and one place that says where the file stands', await page.evaluate(() => document.querySelectorAll('#filestate').length === 1 && document.querySelectorAll('[data-act=save-file]').length === 1));
  await ctx.close();
}
await browser.close(); server.close();
console.log(failed ? `\n${failed} head check(s) FAILED` : '\nall head checks passed');
process.exit(failed ? 1 : 0);
