#!/usr/bin/env node
// node checks/places-check.mjs
// The three places (UX-6h), in Chromium on the fictional example: Library, Editor and Career.
//   - three place tabs, buttons with a name and their key in the tip, aria-current on the one you are in; the Editor's has the pencil,
//   - W, E and R change place, and do nothing while a field has the focus or a modifier is held,
//   - Esc goes up one level inside a place and never changes place: from Compare, from a selected card, from Career's open Add menu, from a written line,
//   - the address follows the place (#resumes, #compare, #resume, #record: ids, never a name), pushed when the place changes, so the
//     browser's Back and Forward move between places,
//   - the landing: nothing saved is the start screen, one resume the editor, two or more the Library with the open resume selected and
//     the focus on its card (Enter opens it); #resume always lands in the editor,
//   - every place keeps its state: the editor its selection, the Library its search, ticks and selection, Career its scroll,
//   - the seam (undo, redo and Saved) is in the same spot on all three places, within 1px,
//   - Tea's tags swing when the pointer brushes past, in steps, and rest within 0.75 s; nothing moves in Coffee or under reduced motion,
//   - in Coffee every new part has a square corner and no shadow.
// Chromium through Playwright (PW_BUNDLED=1, or CHROME_PATH); writes nothing.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8313);
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

async function open(w, h, { look = ['tea', 'light'], url = '?memory#resume', motion = false } = {}){
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([d, t, m]) => { try { localStorage.setItem('rb-help-seen', '1'); localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); if (!m) localStorage.setItem('rb-reduce-motion', '1'); } catch { /* none */ } }, [...look, motion]);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/${url}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 });
  await page.waitForFunction(() => window.__wb.ui.view === 'welcome' || (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const settle = page => page.waitForTimeout(350);
const view = page => page.evaluate(() => window.__wb.ui.view ?? null);
const hash = page => page.evaluate(() => location.hash);
const cur = page => page.evaluate(() => [...document.querySelectorAll('#ptabs .ptab[aria-current=page]')].map(b => b.getAttribute('aria-label')).join());
const hist = page => page.evaluate(() => { const r = document.querySelector('#rail .rhist').getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); });

// ---------------------------------------------------------------- the tabs, the keys, Esc, the address, the state
{
  const { ctx, page, errors } = await open(1470, 832);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('#ptabs button.ptab')].map(b => ({ name: b.getAttribute('aria-label'), cur: b.getAttribute('aria-current'), tip: b.dataset.tip, svg: !!b.querySelector('svg') })));
  ok('three place tabs, buttons named Library, Editor and Career with their key in the tip, aria-current on the Editor', tabs.map(t => t.name).join() === 'Library,Editor,Career' && tabs.map(t => t.cur).join() === ',page,' && tabs.every((t, i) => t.svg && t.tip.includes(`Key: ${'WER'[i]}`)), JSON.stringify(tabs));
  ok('the address is #resume in the editor', await hash(page) === '#resume');
  ok('the place tabs come first in the focus order: before the seam, the card and the panel', await page.evaluate(() => { const t = document.querySelector('#ptabs'), later = n => !!(t.compareDocumentPosition(document.querySelector(n)) & Node.DOCUMENT_POSITION_FOLLOWING); return later('#rail') && later('#head') && later('#body'); }));

  // the keys
  await page.keyboard.press('w'); await settle(page);
  ok('W opens the Library: its tab is current, the address is #resumes', await view(page) === 'resumes' && await cur(page) === 'Library' && await hash(page) === '#resumes');
  await page.keyboard.press('r'); await settle(page);
  ok('R opens Career: its tab is current, the address is #record', await view(page) === 'record' && await cur(page) === 'Career' && await hash(page) === '#record');
  await page.keyboard.press('e'); await settle(page);
  ok('E opens the Editor again: #resume', await view(page) === null && await cur(page) === 'Editor' && await hash(page) === '#resume');
  await page.keyboard.press('w'); await settle(page);
  await page.focus('#scr-q'); await page.keyboard.type('ewr'); await settle(page);
  ok('typing in a field changes no place: W, E and R are letters there', await view(page) === 'resumes' && await page.inputValue('#scr-q') === 'ewr');
  await page.fill('#scr-q', ''); await page.evaluate(() => document.activeElement.blur()); await page.dispatchEvent('#scr-q', 'input');
  await page.keyboard.press('Control+e'); await settle(page);
  ok('a key with a modifier changes no place', await view(page) === 'resumes');
  await page.click('#ptabs [data-p=career]'); await settle(page);
  ok('a click on a tab changes place the same way', await view(page) === 'record' && await hash(page) === '#record');
  await page.click('#ptabs [data-p=editor]'); await settle(page);

  // Esc never changes place
  await page.click('#ptabs [data-p=library]'); await settle(page);
  const ids = await page.evaluate(() => window.__wb.store.state.resumes.map(r => r.id));
  await page.check(`#scr .rcard[data-rid="${ids[1]}"] .rtick`); await page.check(`#scr .rcard[data-rid="${ids[2]}"] .rtick`);
  await page.click('#scr-cmp'); await settle(page);
  ok('Compare is a mode of the Library: its tab is the Library’s, the address is #compare, "← All resumes" is the way back', await view(page) === 'compare' && await cur(page) === 'Library' && await hash(page) === '#compare' && /All resumes/.test(await page.textContent('#compare [data-act=scr-back]')));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc from Compare goes to the grid with the ticks kept', await view(page) === 'resumes' && (await page.$$('#scr .rtick:checked')).length === 2 && await hash(page) === '#resumes');
  await page.click(`#scr .rcard[data-rid="${ids[3]}"] .rsel`); await settle(page);
  const sel = () => page.evaluate(() => document.querySelector('#scr .rcard.sel')?.dataset.rid);
  ok('a click on a card selects it', await sel() === ids[3]);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc from a selected card puts the selection back on the open resume and stays in the Library', await view(page) === 'resumes' && await sel() === await page.evaluate(() => window.__wb.store.state.openId));
  await page.keyboard.press('Escape'); await settle(page);
  ok('the next Esc clears the ticks, and still stays in the Library', await view(page) === 'resumes' && (await page.$$('#scr .rtick:checked')).length === 0);
  await page.click('#ptabs [data-p=career]'); await settle(page);
  await page.click('#c-add'); await settle(page);
  ok('Career has its Add menu open', !!(await page.$('#scr .addmenu, #scr [role=menu]')));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes the open form of Career and stays in Career', await view(page) === 'record' && !(await page.$('#scr .addmenu, #scr [role=menu]')));
  await page.keyboard.press('Escape'); await settle(page);
  ok('…and the next Esc stays in Career too', await view(page) === 'record' && await cur(page) === 'Career');
  await page.keyboard.press('e'); await settle(page);
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  ok('a line of the page is written in place', await page.evaluate(() => !!window.__wb.ui.writing));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc from a written line leaves the line and stays in the Editor', await page.evaluate(() => !window.__wb.ui.writing) && await view(page) === null && await cur(page) === 'Editor');

  // the address, Back and Forward: ids only
  await page.evaluate(() => { history.pushState(null, '', '#resume'); });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.keyboard.press('w'); await settle(page);
  await page.keyboard.press('r'); await settle(page);
  await page.goBack(); await settle(page);
  ok('Back goes from Career to the Library', await view(page) === 'resumes' && await cur(page) === 'Library' && await hash(page) === '#resumes');
  await page.goBack(); await settle(page);
  ok('Back again goes to the Editor', await view(page) === null && await cur(page) === 'Editor');
  await page.goForward(); await settle(page);
  ok('Forward goes to the Library again', await view(page) === 'resumes' && await cur(page) === 'Library');
  ok('the address is an id, never a name', await page.evaluate(() => /^#(resume|resumes|compare|record)$/.test(location.hash) && !/Example|Okonkwo|Helix/.test(decodeURIComponent(location.href))));
  ok('no errors', errors.length === 0, errors[0] ?? '');
  await ctx.close();
}

// ---------------------------------------------------------------- each place keeps its state
{
  const { ctx, page } = await open(1470, 832);
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  await page.click('#outline [data-act=select-section][data-id=experience]').catch(() => {}); await settle(page);
  const sel0 = await page.evaluate(() => JSON.stringify({ sel: window.__wb.ui.sel, page: window.__wb.ui.page }));
  await page.keyboard.press('r'); await settle(page);
  await page.keyboard.press('e'); await settle(page);
  ok('Career and back: the same selection in the editor', await page.evaluate(() => JSON.stringify({ sel: window.__wb.ui.sel, page: window.__wb.ui.page })) === sel0 && JSON.parse(sel0).sel.kind !== 'none', sel0);
  await page.keyboard.press('w'); await settle(page);
  const ids = await page.evaluate(() => window.__wb.store.state.resumes.map(r => r.id));
  await page.fill('#scr-q', 'Medtech'); await settle(page);
  await page.check('#scr .rcard .rtick');
  const rid = await page.evaluate(() => document.querySelector('#scr .rcard').dataset.rid);
  await page.click('#scr .rcard .rsel'); await settle(page);
  await page.keyboard.press('e'); await settle(page);
  await page.keyboard.press('w'); await settle(page);
  ok('the Library keeps its search, its ticks and its selection when you leave and come back', await page.inputValue('#scr-q') === 'Medtech' && (await page.$$('#scr .rtick:checked')).length === 1 && await page.evaluate(() => document.querySelector('#scr .rcard.sel')?.dataset.rid) === rid && ids.length > 2);
  await page.fill('#scr-q', ''); await page.dispatchEvent('#scr-q', 'input'); await page.evaluate(() => document.activeElement.blur());
  await page.setViewportSize({ width: 1470, height: 520 });      // short enough for the timeline to scroll
  await page.keyboard.press('r'); await settle(page);
  await page.evaluate(() => { document.querySelector('#scr').scrollTop = 300; }); await settle(page);
  const top0 = await page.evaluate(() => document.querySelector('#scr').scrollTop);
  await page.keyboard.press('w'); await settle(page);
  await page.keyboard.press('r'); await settle(page);
  const top1 = await page.evaluate(() => document.querySelector('#scr').scrollTop);
  ok('Career keeps its scroll', top0 > 100 && Math.abs(top1 - top0) < 2, `${top0} then ${top1}`);
  await page.setViewportSize({ width: 1470, height: 832 });
  await ctx.close();
}

// ---------------------------------------------------------------- the landing
{
  // #resume lands in the editor; the bare address lands in the Library with the open resume selected and the focus on its card
  const a = await open(1470, 832, { url: '?memory' });
  ok('two or more saved resumes: the app opens on the Library, the address #resumes, the open resume selected and focused', await view(a.page) === 'resumes' && await hash(a.page) === '#resumes' && await a.page.evaluate(() => { const s = document.querySelector('#scr .rcard.sel'); return s?.dataset.rid === window.__wb.store.state.openId && document.activeElement === s.querySelector('.rsel'); }));
  await a.page.keyboard.press('Enter'); await settle(a.page);
  ok('…and Enter on it opens it in the editor', await view(a.page) === null && await hash(a.page) === '#resume');
  await a.ctx.close();
  const b = await open(1470, 832, { url: '?memory#resume' });
  ok('#resume in the address always lands in the editor', await view(b.page) === null && await cur(b.page) === 'Editor');
  await b.ctx.close();
  const c = await open(1470, 832, { url: '?memory#record' });
  ok('#record lands in Career', await view(c.page) === 'record' && await cur(c.page) === 'Career');
  await c.ctx.close();
  // nothing saved, one resume, three: a browser that keeps its own storage (no ?memory)
  const w = await open(1470, 832, { url: '' });
  ok('nothing saved: the start screen, with no place tabs', await view(w.page) === 'welcome' && await w.page.evaluate(() => document.querySelector('#ptabs').hidden || getComputedStyle(document.querySelector('#ptabs')).display === 'none'));
  for (const [n, want] of [[3, 'resumes'], [1, null]]){      // fewer each time: the first slice is what is kept
    await w.page.evaluate(async n => {
      const RS = await import('/src/model/resumes.js'), s = window.__wb.store;
      s.commit(d => { d.record.meta.owner = 'Landing check'; d.resumes = d.resumes.slice(0, n); RS.openSaved(d, d.resumes[0].id); }, 'landing');
      await window.__wb.persist.flush();
    }, n);
    await w.page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await w.page.reload({ waitUntil: 'networkidle' });
    await w.page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
    ok(`${n} saved resume${n > 1 ? 's' : ''}: the app opens ${want ? 'on the Library' : 'in the editor, on that resume'}`, await view(w.page) === want && await hash(w.page) === (want ? '#resumes' : '#resume') && (await w.page.evaluate(() => window.__wb.store.state.resumes.length)) === n);
  }
  await w.ctx.close();
}

// ---------------------------------------------------------------- the seam is in the same spot on every place
{
  const { ctx, page } = await open(1470, 832);
  const spots = [];
  for (const k of ['e', 'w', 'r']){ await page.keyboard.press(k); await settle(page); spots.push(await hist(page)); }
  ok('undo, redo and Saved are one card in the same spot on all three places (within 1px)', spots.every(s => s.every((v, i) => Math.abs(v - spots[0][i]) <= 1)) && await page.evaluate(() => !!document.querySelector('#rail .rhist .savestate') && !!document.querySelector('#rail [data-act=undo]') && !!document.querySelector('#rail .logo')), JSON.stringify(spots));
  ok('the logo is at the seam’s foot and Edit, Design and Export only in the editor', await page.evaluate(() => { const l = document.querySelector('#rail .logo').getBoundingClientRect(), c = document.querySelector('#col').getBoundingClientRect(); return Math.abs(c.bottom - l.bottom) < 2 && !document.querySelector('#rail .rtabs'); }));
  await ctx.close();
}

// ---------------------------------------------------------------- Tea's tags swing; Coffee and reduced motion do not
{
  const sweep = async (page) => {
    const b = await page.evaluate(() => { const r = document.querySelector('#ptabs [data-p=editor]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(b.x - 40, b.y);
    const seen = [];
    for (let i = 0; i < 8; i++){ await page.mouse.move(b.x - 40 + i * 12, b.y); await page.waitForTimeout(40); seen.push(await page.evaluate(() => [...document.querySelectorAll('#ptabs .ptab')].map(t => parseFloat(t.style.rotate) || 0))); }
    return seen;
  };
  const rest = page => page.evaluate(() => [...document.querySelectorAll('#ptabs .ptab')].every(t => !t.style.rotate));
  const tea = await open(1470, 832, { motion: true });
  const s1 = await sweep(tea.page);
  const flat = s1.flat(), peak = Math.max(...flat.map(Math.abs));
  ok('Tea: a brush across a tag swings it by about a degree, in steps (no jump), and never more than three', peak > 0.1 && peak <= 3 && s1.every((r, i) => i === 0 || r.every((v, j) => Math.abs(v - s1[i - 1][j]) < 1.5)) && new Set(flat.map(v => v.toFixed(2))).size > 3, `peak ${peak.toFixed(2)}`);
  await tea.page.waitForTimeout(900);
  ok('…and it rests within 0.75 s of the last movement', await rest(tea.page));
  await tea.ctx.close();
  const reduced = await open(1470, 832, { motion: false });
  ok('under reduced motion nothing swings', (await sweep(reduced.page)).flat().every(v => v === 0));
  await reduced.ctx.close();
  const coffee = await open(1470, 832, { look: ['coffee', 'dark'], motion: true });
  ok('Coffee: nothing swings either', (await sweep(coffee.page)).flat().every(v => v === 0));
  // Coffee: every new part is square and flat
  await coffee.page.keyboard.press('w'); await settle(coffee.page);
  const flatSquare = await coffee.page.evaluate(() => {
    const bad = [];
    for (const [sel, pseudo] of [['#ptabs'], ['#ptabs', '::before'], ['#ptabs .ptab'], ['#head.is-place'], ['#scr'], ['#rail .rhist']]){
      const e = document.querySelector(sel); if (!e){ bad.push(`${sel}: missing`); continue; }
      const s = getComputedStyle(e, pseudo), radii = ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].map(c => parseFloat(s[`border${c}Radius`]));
      if (radii.some(r => r > 2.01)) bad.push(`${sel}${pseudo ?? ''} radius ${radii}`);
      if (s.boxShadow !== 'none') bad.push(`${sel}${pseudo ?? ''} shadow ${s.boxShadow}`);
    }
    return bad;
  });
  ok('Coffee: the place tabs (and the pill’s thumb), the place card, #scr and the seam have square corners and no shadow', flatSquare.length === 0, flatSquare.join(' ; '));
  await coffee.ctx.close();
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} places check(s) FAILED` : '\nall places checks passed');
process.exit(failed ? 1 : 0);
