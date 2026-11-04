#!/usr/bin/env node
// node checks/places-check.mjs
// The three places, in Chromium on the fictional example: Career, the Library and the Editor.
//   - the way: Your career and Resumes (buttons, aria-current on the one you are in), then the open resume's Content and Look (the name card's
//     tabs), each with its drawing and its key in the tip; only the open one says its name,
//   - W, E and R change place, and do nothing while a field has the focus or a modifier is held,
//   - Esc goes up one level inside a place and never changes place: from Compare, from a selected card, from Career's open Add menu, from a written line,
//   - the address follows the place (#resumes, #compare, #resume, #record: ids, never a name), pushed when the place changes, so the
//     browser's Back and Forward move between places,
//   - the landing: nothing saved is the start screen, one resume the editor, two or more the Library with the open resume selected and
//     the focus on its card (Enter opens it); #resume always lands in the editor,
//   - every place keeps its state: the editor its selection, the Library its search, ticks and selection, Career its scroll,
//   - the bar (the brand, Saved, undo, redo, the "?" and the fold) is in the same spot on all three places, within 1px; the brand goes home to
//     Resumes; the "?" is the one menu (the drink and the theme, help and settings, the files); Content and Look from the Library open the
//     resume the card names, and rest while several are ticked; folded, the way and the bar are two strips of one width at the window's edge,
//   - nothing in the way moves under the pointer; in Coffee every new part has a square corner and no soft shadow,
//   - Export is a place of its own (the way keeps Content and Look): the page large on the left, a column half again as wide on the right,
//     ← Back and Esc return to where it was opened from as it was; several resumes show their pages in a row, a ready line each, and their
//     files come as one ZIP with one file for each, named after its resume; Mark each as sent marks every one in one undo step.
// Chromium through Playwright (PW_BUNDLED=1, or CHROME_PATH); writes nothing.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzip } from '../src/parse/unzip.js';

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
  await ctx.addInitScript(([d, t, m]) => { try { (localStorage.setItem('rb-help-seen', '1'), localStorage.setItem('rb-esc-fold', 'off')); localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); if (!m) localStorage.setItem('rb-reduce-motion', '1'); } catch { /* none */ } }, [...look, motion]);
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
const cur = page => page.evaluate(() => [...document.querySelectorAll('#ptabs .wtab.is-on')].map(b => b.getAttribute('aria-label')).join());
const hist = page => page.evaluate(() => { const r = document.querySelector('#rail .rhist').getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); });

// ---------------------------------------------------------------- the tabs, the keys, Esc, the address, the state
{
  const { ctx, page, errors } = await open(1470, 832);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('#ptabs button.wtab')].map(b => ({ name: b.getAttribute('aria-label'), on: b.classList.contains('is-on'), cur: b.getAttribute('aria-current') ?? b.getAttribute('aria-selected'), tip: b.dataset.tip, svg: !!b.querySelector('svg'), word: getComputedStyle(b.querySelector('.ww')).opacity })));
  ok('the way: Your career and Resumes, then Content and Look (tabs of the name card), each with its drawing, the keys R, W and E in the tips, Content open and the only one that says its name', tabs.map(t => t.name).join() === 'Your career,Resumes,Content,Look' && tabs.map(t => t.on).join() === 'false,false,true,false' && tabs.map(t => t.cur).join() === ',,true,false' && tabs.every((t, i) => t.svg && (i > 2 || t.tip.includes(`Key: ${'RWE'[i]}`))) && tabs.map(t => t.word === '1').join() === 'false,false,true,false', JSON.stringify(tabs));
  ok('the address is #resume in the editor', await hash(page) === '#resume');
  ok('the place tabs come first in the focus order: before the seam, the card and the panel', await page.evaluate(() => { const t = document.querySelector('#ptabs'), later = n => !!(t.compareDocumentPosition(document.querySelector(n)) & Node.DOCUMENT_POSITION_FOLLOWING); return later('#rail') && later('#head') && later('#body'); }));

  // the keys
  await page.keyboard.press('w'); await settle(page);
  ok('W opens the Library: its tab is current, the address is #resumes', await view(page) === 'resumes' && await cur(page) === 'Resumes' && await hash(page) === '#resumes');
  await page.keyboard.press('r'); await settle(page);
  ok('R opens Career: its tab is current, the address is #record', await view(page) === 'record' && await cur(page) === 'Your career' && await hash(page) === '#record');
  await page.keyboard.press('e'); await settle(page);
  ok('E opens the Editor again: #resume', await view(page) === null && await cur(page) === 'Content' && await hash(page) === '#resume');
  await page.keyboard.press('w'); await settle(page);
  await page.focus('#scr-q'); await page.keyboard.type('ewr'); await settle(page);
  ok('typing in a field changes no place: W, E and R are letters there', await view(page) === 'resumes' && await page.inputValue('#scr-q') === 'ewr');
  await page.fill('#scr-q', ''); await page.evaluate(() => document.activeElement.blur()); await page.dispatchEvent('#scr-q', 'input');
  await page.keyboard.press('Control+e'); await settle(page);
  ok('a key with a modifier changes no place', await view(page) === 'resumes');
  await page.click('#ptabs [data-p=career]'); await settle(page);
  ok('a click on a tab changes place the same way', await view(page) === 'record' && await hash(page) === '#record');
  await page.click('#tab-edit'); await settle(page);

  // Esc never changes place
  await page.click('#ptabs [data-p=library]'); await settle(page);
  const ids = await page.evaluate(() => [...document.querySelectorAll('#scr .rcard[data-rid]')].filter(c => c.checkVisibility()).map(c => c.dataset.rid));      // the cards on the screen: a folded or archived round's are not
  await page.check(`#scr .rcard[data-rid="${ids[1]}"] .rtick`); await page.check(`#scr .rcard[data-rid="${ids[2]}"] .rtick`);
  await page.click('#scr-cmp'); await settle(page);
  ok('Compare is a mode of the Library: its tab is the Library’s, the address is #compare, "← All resumes" is the way back', await view(page) === 'compare' && await cur(page) === 'Resumes' && await hash(page) === '#compare' && /All resumes/.test(await page.textContent('#compare [data-act=scr-back]')));
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
  ok('…and the next Esc stays in Career too', await view(page) === 'record' && await cur(page) === 'Your career');
  await page.keyboard.press('e'); await settle(page);
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  ok('a line of the page is written in place', await page.evaluate(() => !!window.__wb.ui.writing));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc from a written line leaves the line and stays in the Editor', await page.evaluate(() => !window.__wb.ui.writing) && await view(page) === null && await cur(page) === 'Content');

  // the address, Back and Forward: ids only
  await page.evaluate(() => { history.pushState(null, '', '#resume'); });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.keyboard.press('w'); await settle(page);
  await page.keyboard.press('r'); await settle(page);
  await page.goBack(); await settle(page);
  ok('Back goes from Career to the Library', await view(page) === 'resumes' && await cur(page) === 'Resumes' && await hash(page) === '#resumes');
  await page.goBack(); await settle(page);
  ok('Back again goes to the Editor', await view(page) === null && await cur(page) === 'Content');
  await page.goForward(); await settle(page);
  ok('Forward goes to the Library again', await view(page) === 'resumes' && await cur(page) === 'Resumes');
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
  ok('#resume in the address always lands in the editor', await view(b.page) === null && await cur(b.page) === 'Content');
  await b.ctx.close();
  const c = await open(1470, 832, { url: '?memory#record' });
  ok('#record lands in Career', await view(c.page) === 'record' && await cur(c.page) === 'Your career');
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
  ok('undo, redo and Saved are one group in the same spot on all three places (within 1px)', spots.every(s => s.every((v, i) => Math.abs(v - spots[0][i]) <= 1)) && await page.evaluate(() => !!document.querySelector('#rail .rhist .savestate') && !!document.querySelector('#rail [data-act=undo]') && !!document.querySelector('#rail .brand')), JSON.stringify(spots));
  ok('the bar is the column’s full width at its foot, the brand at its left end, the "?" and the fold at its right; no ⋯ and no Content | Look row in the name card', await page.evaluate(() => {
    const b = document.querySelector('#rail').getBoundingClientRect(), c = document.querySelector('#col').getBoundingClientRect(), br = document.querySelector('#rail .brand').getBoundingClientRect(), q = document.querySelector('#rail [data-act=menu]').getBoundingClientRect(), f = document.querySelector('#rail [data-act=side-fold]').getBoundingClientRect();
    return Math.abs(b.width - c.width) < 1 && Math.abs(b.bottom - c.bottom) < 2 && br.left - b.left < 12 && q.left > b.left + b.width / 2 && f.left > q.left && !document.querySelector('#head [data-act=menu], #head .hmodes');
  }));
  // the brand is home; the "?" is the one menu
  await page.keyboard.press('e'); await settle(page);
  await page.click('#rail .brand'); await settle(page);
  ok('the brand goes home: Resumes', await view(page) === 'resumes' && await cur(page) === 'Resumes');
  await page.click('#rail [data-act=menu]'); await settle(page);
  const menu = await page.evaluate(() => { const m = document.querySelector('#rail .appmenu'); return m && { drinks: [...m.querySelectorAll('.mdrink .seg button')].map(b => b.getAttribute('aria-pressed')).join(), theme: !!m.querySelector('[data-act=theme-toggle]'), acts: [...m.querySelectorAll('[role=menuitem]')].map(b => b.dataset.act === 'goto' ? b.dataset.v : b.dataset.act ?? 'link').join(), up: m.getBoundingClientRect().bottom <= document.querySelector('#rail').getBoundingClientRect().top, focus: document.activeElement?.closest('.appmenu') === m }; });
  ok('the "?" opens one menu above the bar: Tea or Coffee and light or dark, then help, settings, privacy and the source, then the files, the example and Start over; the focus is in it', !!menu && menu.drinks === 'true,false' && menu.theme && menu.acts === 'help,settings,link,link,import,link,history,example,start-over' && menu.up && menu.focus, JSON.stringify(menu));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes it, the focus back on the "?"', await page.evaluate(() => !document.querySelector('#rail .appmenu') && document.activeElement?.matches('#rail [data-act=menu]')) && await view(page) === 'resumes');
  // Content and Look from the Library: the resume the card names; with several ticked they rest
  const other = await page.evaluate(() => [...document.querySelectorAll('#scr .rcard[data-rid]')].map(c => c.dataset.rid).find(id => id !== window.__wb.store.state.openId));
  await page.click(`#scr .rcard[data-rid="${other}"] .rsel`); await settle(page);
  await page.click('#tab-design'); await page.waitForTimeout(700);
  const looked = { view: await view(page), open: await page.evaluate(() => window.__wb.store.state.openId), cur: await page.evaluate(() => document.querySelector('#ptabs .wtab.is-on')?.id) };
  ok('from the Library, Look opens the resume the card names, on Look', looked.view === 'design' && looked.open === other && looked.cur === 'tab-design', JSON.stringify({ ...looked, other }));
  await page.keyboard.press('w'); await settle(page);
  const ids = await page.evaluate(() => [...document.querySelectorAll('#scr .rcard[data-rid]')].filter(c => c.checkVisibility()).map(c => c.dataset.rid));
  await page.check(`#scr .rcard[data-rid="${ids[0]}"] .rtick`); await page.check(`#scr .rcard[data-rid="${ids[1]}"] .rtick`); await settle(page);
  ok('with two ticked, Content and Look rest (aria-disabled), and a click on one changes nothing', await page.evaluate(() => ['#tab-edit', '#tab-design'].every(s => document.querySelector(s).getAttribute('aria-disabled') === 'true')) && (await page.click('#tab-edit', { force: true }), await settle(page), await view(page) === 'resumes'));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  // folded: two strips of one width at the window's edge, the page not under them
  await page.keyboard.press('e'); await settle(page);
  await page.keyboard.press('Control+Backslash'); await page.waitForTimeout(700);
  const fold = await page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(), top = r('#ptabs'), bar = r('#rail'), sh = r('#sheet iframe');
    return { w: [top.width, bar.width], right: [innerWidth - top.right, innerWidth - bar.right], gap: bar.top - top.bottom, under: sh.right > top.left, top: [...document.querySelectorAll('#ptabs .wtab, #ptabs .wexport')].filter(e => e.checkVisibility()).map(e => e.dataset.p ?? e.dataset.m ?? 'export').join(), bar: [...document.querySelectorAll('#rail .savestate, #rail .ib, #rail .brand')].filter(e => e.checkVisibility()).map(e => (e.dataset.act ?? 'saved').replace('place', 'brand')).join(), card: getComputedStyle(document.querySelector('#head')).display }; });
  ok('folded: the way and the bar are two strips, 54px wide, at the window’s edge; the top one holds the places, Content, Look and Export, the bottom one Saved, undo, redo, the "?", the fold and the brand; the name card goes and the page is not under them', fold.w.every(x => Math.abs(x - 54) < 1) && Math.abs(fold.right[0] - fold.right[1]) < 1 && fold.gap > 0 && !fold.under && fold.top === 'career,library,edit,design,export' && ['saved', 'undo', 'redo', 'menu', 'side-fold', 'brand'].every(k => fold.bar.split(',').includes(k)) && fold.card === 'none', JSON.stringify(fold));
  await page.keyboard.press('Control+Backslash'); await settle(page);
  await ctx.close();
}

// ---------------------------------------------------------------- nothing in the way moves under the pointer; Coffee square and flat
{
  const still = async (page) => {
    const at = () => page.evaluate(() => [...document.querySelectorAll('#ptabs .wtab')].map(t => { const r = t.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.height)}`; }).join(' '));
    const before = await at(), seen = [];
    for (const sel of ['#ptabs [data-p=career]', '#ptabs [data-p=library]', '#tab-design']){ await page.hover(sel); await page.waitForTimeout(300); seen.push(await at()); }
    return seen.every(x => x === before) ? '' : `${before} → ${seen.join(' | ')}`;
  };
  const tea = await open(1470, 832, { motion: true });
  const tm = await still(tea.page);
  ok('Tea: hovering the places and the card’s tabs moves none of them (a colour only: no lift, no swing)', !tm, tm);
  await tea.ctx.close();
  const coffee = await open(1470, 832, { look: ['coffee', 'dark'], motion: true });
  const cm = await still(coffee.page);
  ok('Coffee: nothing moves either', !cm, cm);
  // Coffee: every new part is square and flat
  await coffee.page.keyboard.press('w'); await settle(coffee.page);
  const flatSquare = await coffee.page.evaluate(() => {
    const bad = [];
    for (const [sel, pseudo] of [['#ptabs .wtab'], ['#ptabs .wsheets .wtab'], ['#head.is-place'], ['#head .hstub'], ['#scr'], ['#rail']]){
      const e = document.querySelector(sel); if (!e){ bad.push(`${sel}: missing`); continue; }
      const s = getComputedStyle(e, pseudo), radii = ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].map(c => parseFloat(s[`border${c}Radius`]));
      if (radii.some(r => r > 2.01)) bad.push(`${sel}${pseudo ?? ''} radius ${radii}`);
      // a hard edge (no blur) is Coffee's own depth; a blurred shadow never is
      const hard = s.boxShadow !== 'none' && [...s.boxShadow.matchAll(/(-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px/g)].every(m => m[3] === '0');
      if (s.boxShadow !== 'none' && !hard) bad.push(`${sel}${pseudo ?? ''} shadow ${s.boxShadow}`);
    }
    return bad;
  });
  ok('Coffee: the places, the card’s tabs, the name card, its Export, #scr and the bar have square corners and no soft shadow', flatSquare.length === 0, flatSquare.join(' ; '));
  await coffee.ctx.close();
}

// ---------------------------------------------------------------- Career's lens: its picks, or the whole career
{
  const { ctx, page } = await open(1470, 832);
  await page.keyboard.press('r'); await settle(page);
  const st = () => page.evaluate(() => ({ lens: document.body.dataset.lens, frame: document.querySelector('#head').classList.contains('is-lens'), btns: [...document.querySelectorAll('#head .hlens [data-act=lens]')].map(b => b.dataset.v + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(), off: [...document.querySelectorAll('#scr .tl2 [data-unpicked]')].map(r => r.dataset.id) }));
  const a = await st();
  ok('Career with a resume open: the name card\'s row is Whole career | Its picks, Its picks on, the card framed in the accent', a.lens === 'picks' && a.frame && a.btns === 'whole,picks*', JSON.stringify(a));
  const shown = await page.evaluate(() => { const w = window.__wb, d = document.querySelector('#sheet iframe').contentDocument, ix = w.ui.ix, p = new Set([...d.querySelectorAll('[data-variant]')].map(e => ix.factOfVariant.get(e.dataset.variant)).filter(Boolean)); return [...document.querySelectorAll('#scr .tl2 [data-id]')].map(r => { const x = (w.store.materialize(w.store.state.record)[r.dataset.key] ?? []).find(e => e.id === r.dataset.id); return [r.dataset.id, !!x && [...Object.values(x.display ?? {}), ...(x.highlights ?? [])].some(f => p.has(f))]; }); });
  ok('…the entries the resume does not print are dimmed in place, and only those (an education printed is not)', shown.length > 3 && shown.every(([id, on]) => a.off.includes(id) === !on) && shown.some(([, on]) => on) && a.off.length > 0, JSON.stringify({ shown, off: a.off }));
  await page.click('#head .hlens [data-v=whole]'); await settle(page);
  const b = await st();
  ok('Whole career: no frame, nothing dimmed', b.lens === 'whole' && !b.frame && b.off.length === 0 && b.btns === 'whole*,picks', JSON.stringify(b));
  await page.keyboard.press('e'); await settle(page);
  ok('…and the row is Career\'s only: none in the editor', !(await page.$('#head .hlens')) && (await page.evaluate(() => document.body.dataset.lens)) === '');
  await ctx.close();
}

// ---------------------------------------------------------------- the string between the card and the selection
{
  const tea = await open(1470, 832, { motion: true });
  const { page } = tea, fr = page.frameLocator('#sheet iframe');
  const st = () => page.evaluate(() => { const s = document.querySelector('#string'), b = document.querySelector('#body').getBoundingClientRect(); return { shown: s?.style.display !== 'none', hole: document.querySelector('#body').classList.contains('has-string'), ...window.__wb.string.state, card: [b.left, b.top] }; });
  ok('none at the map', !(await st()).shown);
  await fr.locator('.bullets li').nth(1).click({ position: { x: 40, y: 6 } }); await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
  const a = await st(), li = await page.evaluate(() => { const w = window.__wb, el = document.querySelector('#sheet iframe').contentDocument.querySelectorAll('.bullets li')[1], r = w.canvas.screenRect(w.sheet.rectOfEl(el)); return r.left + r.width; });
  ok('Tea: a line selected, the string runs from its right edge to the card’s punched hole (14 px in), and the card shows the hole', a.shown && a.hole && Math.abs(a.p[0] - li) < 2 && Math.abs(a.p[2] - (a.card[0] + 14)) < 1 && Math.abs(a.p[3] - (a.card[1] + 14)) < 1, JSON.stringify({ a, li }));
  const idle = await page.evaluate(() => new Promise(r => { let n = 0; const o = window.requestAnimationFrame; window.requestAnimationFrame = f => { n++; return o(f); }; setTimeout(() => { window.requestAnimationFrame = o; r(n); }, 1500); }));
  ok('…at rest it asks for no frames (nothing in the app does)', !a.raf && idle === 0, `${idle} frames`);
  await page.evaluate(() => window.__wb.canvas.zoomTo(0.55)); await page.waitForTimeout(1200);
  const z = await st(), op = await page.evaluate(() => [getComputedStyle(document.querySelector('#body')).opacity, getComputedStyle(document.querySelector('#string')).opacity]);
  ok('zoomed far out (under 0.7) the string is cut and fades, and the card is at half', z.away && z.d === 1 && op[0] === '0.5' && op[1] === '0', JSON.stringify({ z, op }));
  await page.evaluate(() => window.__wb.canvas.zoomTo(1)); await page.waitForTimeout(1200);
  ok('…back at the fit it is tied again', !(await st()).away && (await st()).d === 0);
  await page.keyboard.press('Shift+F'); await page.waitForTimeout(1200);
  const d = await page.evaluate(() => document.querySelector('#string path').getAttribute('d'));
  ok('Coffee: the drink change draws a plain line with two turns (out, a jog, in) and no hole', (d.match(/Q/g) ?? []).length === 2 && /H.*V.*H/.test(d) && await page.evaluate(() => !/radial/.test(getComputedStyle(document.querySelector('#body')).backgroundImage)), d);
  await tea.ctx.close();
}

// ---------------------------------------------------------------- the Export place
{
  const { ctx, page, errors } = await open(1440, 900);
  const rail = await page.evaluate(() => [...document.querySelectorAll('#ptabs .wsheets [role=tab]')].map(b => b.dataset.m).join());
  ok('the name card’s tabs are Content and Look only: Export is a place of its own', rail === 'edit,design' && !(await page.$('#tab-export')), rail);
  const before = await page.evaluate(() => ({ colW: document.getElementById('col').getBoundingClientRect().width, sel: (window.__wb.ui.sel = { kind: 'job', id: 'hydra' }, 'hydra') }));
  await page.evaluate(() => window.__wb.setView(null)); await settle(page);
  await page.evaluate(() => window.__wb.export.open()); await page.waitForTimeout(700);
  const one = await page.evaluate(() => {
    const col = document.getElementById('col').getBoundingClientRect(), sheet = document.querySelector('#sheet iframe').getBoundingClientRect(), shown = id => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; };
    return { view: window.__wb.ui.view, place: document.body.classList.contains('is-export'), colW: col.width, colLeft: col.left, pageRight: sheet.right, pageH: sheet.height, chrome: ['ptabs', 'rail', 'head'].filter(shown),
      back: document.querySelector('#body [data-act=xp-back]')?.textContent.trim(), focus: document.activeElement?.dataset?.act, title: document.querySelector('#body .xpwhat .title')?.textContent,
      blocks: [...document.querySelectorAll('#body .xpgrid > .xpb')].map(b => b.dataset.k).join(), cards: [...document.querySelectorAll('#body [data-k=file] .dl button')].map(b => b.dataset.act).join(), sent: !!document.querySelector('#body [data-act=mark-sent]') };
  });
  ok('Export opens as a place: the view is Export, the way, the name card and the bar step aside', one.view === 'export' && one.place && one.chrome.length === 0, JSON.stringify(one.chrome));
  ok('the column is as wide as the sidebar (its panel fits; it widens only when it does not), and the editor’s page stays uncovered on the left', Math.abs(one.colW - before.colW) <= 2 && one.pageRight <= one.colLeft && one.pageH > 700, `${before.colW} → ${one.colW}, page right ${one.pageRight} col ${one.colLeft}`);
  ok('the panel: ← Back to Editor (with the focus), Exporting the resume, then Ready, Made for, Download, Sent, Backup; four download cards and Mark as sent', /Back to Editor/.test(one.back) && one.focus === 'xp-back' && /Example Instruments/.test(one.title) && one.blocks === 'ready,medium,file,sent,keep' && one.cards === 'ex-pdf,ex-html,ex-txt,ex-json' && one.sent, JSON.stringify(one));
  await page.click('#body [data-act=ex-medium][data-v=pen]'); await page.waitForTimeout(900);
  ok('Made for: a highlighter pen draws the page on the left for paper (its class on the page) and is saved with the resume', await page.evaluate(() => document.querySelector('#sheet iframe').contentDocument.documentElement.classList.contains('medium-print') && window.__wb.store.state.cur.exportMedium === 'pen'));
  await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await page.waitForTimeout(900);
  const backed = await page.evaluate(() => ({ view: window.__wb.ui.view ?? null, sel: window.__wb.ui.sel, place: document.body.classList.contains('is-export'), colW: document.getElementById('col').getBoundingClientRect().width, paper: document.querySelector('#sheet iframe').contentDocument.documentElement.classList.contains('medium-print') }));
  ok('Esc goes back to the editor as it was: the same selection, the sidebar its own width, the page on a screen again', backed.view === null && backed.sel?.id === 'hydra' && !backed.place && Math.abs(backed.colW - before.colW) < 1 && !backed.paper, JSON.stringify(backed));
  await page.evaluate(() => { window.__wb.store.undo?.(); });

  // several, from the Library
  await page.evaluate(() => window.__wb.setView('resumes')); await settle(page);
  const ids = await page.evaluate(() => window.__wb.store.state.resumes.filter(r => r.id !== window.__wb.store.state.openId).slice(0, 3).map(r => r.id));
  const sends = () => page.evaluate(ids => ids.map(id => (window.__wb.store.state.resumes.find(r => r.id === id).snapshots ?? []).reduce((n, x) => n + x.sends.length, 0)), ids);
  const sends0 = await sends(), open0 = await page.evaluate(() => ({ id: window.__wb.store.state.openId, cur: JSON.stringify({ ...window.__wb.store.state.cur, savedAt: 0 }) }));
  await page.evaluate(ids => window.__wb.export.open(ids, 'resumes'), ids);
  await page.waitForFunction(() => document.querySelectorAll('#xpages .xpslot iframe').length >= 3 && !document.querySelector('#body [data-k=ready] li.wait'), null, { timeout: 30000 });
  const many = await page.evaluate(() => {
    const col = document.getElementById('col').getBoundingClientRect(), figs = [...document.querySelectorAll('#xpages .xpfig')];
    return { figs: figs.length, inRoom: document.getElementById('xpages').getBoundingClientRect().right <= col.left, canvas: getComputedStyle(document.getElementById('pages')).visibility,
      title: document.querySelector('#body .xpwhat .title').textContent, lines: [...document.querySelectorAll('#body [data-k=ready] li[data-id]')].length,
      cards: [...document.querySelectorAll('#body [data-k=file] .dl button b')].map(b => b.textContent), zip: /one \.zip/.test(document.querySelector('#body [data-k=file] .note').textContent),
      send: document.querySelector('#body [data-act=xp-send]')?.textContent.trim(), back: document.querySelector('#body [data-act=xp-back]').textContent.trim() };
  });
  ok('several: every resume’s pages in a row left of the panel (the editor’s page hidden), "3 resumes", a ready line for each', many.figs === 3 && many.inRoom && many.canvas === 'hidden' && many.title === '3 resumes' && many.lines === 3, JSON.stringify(many));
  ok('several: each download card says "· 3 files", the note says they come as one .zip, Mark each as sent…, ← Back to Library', many.cards.every(c => / · 3 files$/.test(c)) && many.cards.length === 4 && many.zip && many.send === 'Mark each as sent…' && /Back to Library/.test(many.back), JSON.stringify(many));
  const shown = () => page.evaluate(() => [...document.querySelectorAll('#xpages .xptravel')].map(b => getComputedStyle(b).display !== 'none'));
  const t0 = await shown();
  await page.click('#xpages .xptravel[data-d="1"]'); await page.waitForTimeout(700);
  const t1 = await shown(), moved = await page.evaluate(() => document.querySelector('#xpages .xptrack').scrollLeft);
  ok('several: the row does not fit, so › travels to the next resume and ‹ appears; at the start there is no ‹', t0.join() === 'false,true' && moved > 100 && t1[0] === true, `${t0} → ${t1}, scrolled ${moved}`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#body [data-act=ex-html]')]);
  const z = unzip(new Uint8Array(fs.readFileSync(await dl.path())));
  const want = await page.evaluate(ids => ids.map(id => { const r = window.__wb.store.state.resumes.find(x => x.id === id); return [r.company, r.role].filter(Boolean).join(' - '); }), ids);
  const html = await z.read(z.names[0]);
  ok('several: HTML comes as one .zip with one file for each resume, each named after its resume', /\.zip$/.test(dl.suggestedFilename()) && z.names.length === 3 && want.every(w => z.names.some(n => n.startsWith(w) && n.endsWith('.html'))) && /<html/i.test(new TextDecoder().decode(html)), `${dl.suggestedFilename()}: ${z.names.join(' | ')}`);
  await page.click('#body [data-act=xp-send]'); await settle(page);
  await page.click('#body [data-act=xp-send-do]'); await page.waitForTimeout(500);
  const sends1 = await sends(), open1 = await page.evaluate(() => ({ id: window.__wb.store.state.openId, cur: JSON.stringify({ ...window.__wb.store.state.cur, savedAt: 0 }) }));
  ok('Mark each as sent: every listed resume has a new send, the open resume is still the one open, unchanged', sends1.every((n, i) => n === sends0[i] + 1) && open1.id === open0.id && open1.cur === open0.cur, `${sends0} → ${sends1}`);
  await page.click('#body [data-act=xp-back]'); await page.waitForTimeout(600);
  ok('← Back goes to the Library; the row of pages is gone and the editor’s page is back', await page.evaluate(() => window.__wb.ui.view === 'resumes' && !document.getElementById('xpages') && !document.body.classList.contains('xp-list')));
  ok('no errors on the page', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} places check(s) FAILED` : '\nall places checks passed');
process.exit(failed ? 1 : 0);
