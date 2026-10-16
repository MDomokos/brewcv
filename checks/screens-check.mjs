#!/usr/bin/env node
// node checks/screens-check.mjs
// The Library (with Compare) and Career as places (UX-6e, UX-6h): drawn left of the sidebar in #scr, reached by the place tabs and the keys W, E and R; Esc goes up a level inside
// a place and never to another; no back button on a desktop (Compare's "← All resumes" is the one way back inside a place). In Chromium on the fictional example:
//   - Duplicate opens the copy at once, under its parent, with the name field focused and its text selected (Enter confirms; Esc without
//     typing keeps the default name; typed and left keeps what was typed),
//   - each card says "under <parent>", or "closest: <name>" for a resume that has no parent, and "What differs" lists an edit on the
//     resume, a line only on it and its skills arranged, in plain words,
//   - three resumes compared in one table, with real headers; a sent copy can be ticked and compared too,
//   - the thumbnails arrive as pictures of the real first page and a second visit draws none again,
//   - the Editor tab (and E) returns to the editor with the page and the selection as left, and the focus to the tab; Esc stays in the Library,
//   - no bar across the window on any screen (the name card and the foot are small cards), and, at three sizes in the ten languages with a
//     long and a 60 character name, nothing clipped or overlapping on the three screens.
// Chromium through Playwright (PW_BUNDLED=1, or CHROME_PATH); writes nothing. ONLY=de,hu limits the languages of the layout part.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8312);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
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

async function open(w, h, look = ['tea', 'light']){
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([d, t]) => { try { localStorage.setItem('rb-help-seen', '1'); localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); localStorage.setItem('rb-reduce-motion', '1'); } catch { /* none */ } }, look);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const settle = page => page.waitForTimeout(300);
const st = page => page.evaluate(() => { const s = window.__wb.store.state; return { openId: s.openId, ids: s.resumes.map(r => r.id), parents: Object.fromEntries(s.resumes.map(r => [r.id, r.parent ?? null])), names: Object.fromEntries(s.resumes.map(r => [r.id, r.name ?? null])) }; });
const view = page => page.evaluate(() => window.__wb.ui.view);
const thumbsDone = (page, n) => page.waitForFunction(n => document.querySelectorAll('#scr [data-thumb] iframe').length >= n, n, { timeout: 60000 });

// ---------------------------------------------------------------- the behaviour
{
  const { ctx, page, errors } = await open(1470, 832);
  const s0 = await st(page);
  // where it was left: a job on the page, and the page
  await page.evaluate(() => window.__wb.setView(null));
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  await page.mouse.move(4, 4); await page.keyboard.press('Escape'); await settle(page);
  const left = await page.evaluate(() => JSON.stringify({ sel: window.__wb.ui.sel, page: window.__wb.ui.page }));

  await page.click('#ptabs [data-p=library]'); await settle(page);
  ok('the Library tab opens the Library, drawn in #scr with a heading, aria-current on its tab, the selected card (the open resume) has the focus, and the sidebar\u2019s body is empty', await view(page) === 'resumes' && /resumes/i.test(await page.textContent('#scr h2')) && await page.getAttribute('#ptabs [data-p=library]', 'aria-current') === 'page' && await page.evaluate(() => document.activeElement?.matches('#scr .rcard.sel .rsel') && document.querySelector('#body').childElementCount === 0));
  ok('…and there is no back button on a desktop', !(await page.$('#scr [data-act=scr-back]')));
  const n = s0.ids.length;
  ok('every resume has a card with a named tick box, an Open and a Duplicate', await page.evaluate(n => { const c = [...document.querySelectorAll('#resumes .rcard')]; return c.length === n && c.every(x => x.querySelector('input.rtick')?.getAttribute('aria-label') && x.querySelector('.racts [data-act=sw-open]') && x.querySelector('.racts [data-act=rm-dup]')); }, n));
  // thumbnails
  await thumbsDone(page, n);
  const pics = await page.evaluate(() => [...document.querySelectorAll('#resumes [data-thumb] iframe')].map(f => { const d = f.contentDocument; return { text: d?.querySelector('.page')?.textContent ?? '', w: f.getBoundingClientRect().width }; }));
  ok(`the thumbnails come: one picture of the real first page for each of the ${n} resumes, small`, pics.length === n && pics.every(p => /Okonkwo/.test(p.text) && p.w > 80 && p.w < 260));
  const drawn = await page.evaluate(() => window.__wb.thumbs.stats.drawn);
  ok('…each was drawn once', drawn === n, String(drawn));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc stays in the Library (it never changes place); E returns to the editor, with the selection and the page as they were, and the focus on the Editor tab', await view(page) === 'resumes' && (await page.keyboard.press('e'), await settle(page), await view(page) === null) && await page.evaluate(() => document.activeElement?.matches('#ptabs [data-p=editor]') && JSON.stringify({ sel: window.__wb.ui.sel, page: window.__wb.ui.page })) === left, left);
  await page.click('#ptabs [data-p=library]'); await thumbsDone(page, n);
  ok('a second visit draws no picture again: the pictures are kept by what each resume prints', await page.evaluate(() => window.__wb.thumbs.stats.drawn) === drawn);
  { const fit = w => page.evaluate(w => { const slot = document.querySelector('#resumes [data-thumb]'); slot.style.width = `${w}px`; return new Promise(r => setTimeout(() => r(slot.querySelector('iframe').getBoundingClientRect().width / slot.clientWidth), 150)); }, w);
    const a = await fit(120), b = await fit(80);
    ok('a thumbnail follows its box at two widths (the picture fills the box, not the size it had when drawn)', Math.abs(a - 1) < 0.02 && Math.abs(b - 1) < 0.02, `${a} ${b}`);
    await page.evaluate(() => { document.querySelector('#resumes [data-thumb]').style.width = ''; }); }
  await page.click('#ptabs [data-p=editor]'); await settle(page);
  ok('the Editor tab does the same', await view(page) === null && await page.evaluate(() => JSON.stringify({ sel: window.__wb.ui.sel, page: window.__wb.ui.page })) === left);

  // where each came from
  await page.click('#ptabs [data-p=library]'); await settle(page);
  const from = await page.evaluate(() => [...document.querySelectorAll('#resumes .rcard')].map(c => ({ id: c.dataset.rid, from: c.querySelector('.rfrom')?.textContent ?? '' })));
  ok('a resume with no parent says "Closest: …(a guess)"; none says "Under"', from.length > 5 && from.filter(f => /^Closest: .+\(a guess\)$/.test(f.from)).length >= 3 && !from.some(f => /^Under /.test(f.from)), JSON.stringify(from.slice(0, 2)));

  // Duplicate: the copy is open at once, under its parent, with the name selected
  const parent = s0.openId;
  await page.click(`#resumes .rcard[data-rid="${parent}"] [data-act=rm-dup]`); await settle(page);
  const s1 = await st(page), copy = s1.openId;
  const f = await page.evaluate(() => { const a = document.activeElement; return { id: a?.id, all: a?.selectionStart === 0 && a?.selectionEnd === a?.value.length && a.value.length > 0, value: a?.value, shown: !document.querySelector('#switcher')?.hidden }; });
  ok('Duplicate leaves the screen and opens the copy under its parent, in the name window with the name field focused and its text selected', await view(page) === null && copy !== parent && s1.parents[copy] === parent && f.id === 'sw-rn' && f.all && f.shown, JSON.stringify(f));
  ok('…and the window says it was duplicated from the parent', /Duplicated from/.test(await page.textContent('#switcher .swfrom')));
  await page.keyboard.type('Typed copy'); await page.keyboard.press('Enter'); await settle(page);
  const s2 = await st(page), named = s2.openId;       // a new name is a new file name: the id follows it
  ok('Enter confirms the new name and closes the window, and the copy is still under its parent', s2.names[named] === 'Typed copy' && s2.parents[named] === parent && !(await page.isVisible('#switcher')) && /Typed copy/.test(await page.textContent('#docname')));
  await page.click('#ptabs [data-p=library]'); await settle(page);
  await page.click(`#resumes .rcard[data-rid="${named}"] [data-act=rm-dup]`); await settle(page);
  let copy2 = (await st(page)).openId;
  const dflt = await page.inputValue('#sw-rn');
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc without typing keeps the default name', (await st(page)).names[copy2] === dflt && !(await page.isVisible('#switcher')), dflt);
  ok('…and the copy of a copy is under the copy', (await st(page)).parents[copy2] === named);
  await page.click('#docname-btn'); await settle(page);
  await page.fill('#sw-rn', 'Typed and left'); await page.keyboard.press('Escape'); await settle(page);
  copy2 = (await st(page)).openId;
  ok('a name typed and left by Esc is kept, never lost', (await st(page)).names[copy2] === 'Typed and left');

  // What differs: an edit, a line only on this resume, the skills arranged
  await page.evaluate(async () => {
    const T = await import('/src/model/resume.js'), b = window.__wb;
    const model = b.store.materialize(b.store.state.record);
    b.store.commit(d => {
      const job = model.work[0], fact = job.highlights.find(h => d.cur.overrides?.[h] === undefined);
      T.setOverride(model, d.cur, fact, 'A sentence written only on this resume.', { marks: [], base: null });
      const id = T.addLocalLine(model, d.cur, job.id, null); T.setOverride(model, d.cur, id, 'A line that only this resume has.', { marks: [], base: null });
      const g = T.arrangementOf(model, d.cur).groups[0]; T.writeGroup(model, d.cur, g.id, `Renamed group\nOne skill, Another skill`);
    }, 'edits');
  });
  await settle(page);
  await page.click('#ptabs [data-p=library]'); await settle(page);
  ok('a card with a parent says "Under <parent>" and has "What differs"', /^Under /.test(await page.textContent(`#resumes .rcard[data-rid="${copy2}"] .rfrom`)) && await page.isVisible(`#resumes .rcard[data-rid="${copy2}"] [data-act=scr-differs]`));
  ok('…an edit on this resume is counted on the card', /edit/.test(await page.textContent(`#resumes .rcard[data-rid="${copy2}"] .rpend`)));
  await page.click(`#resumes .rcard[data-rid="${copy2}"] [data-act=scr-differs]`); await settle(page);
  const sum = await page.$$eval('#compare .diffsum li', l => l.map(x => x.textContent));
  ok('"What differs from <parent>" lists the new name, the edit, the local line and the skills', await view(page) === 'compare' && /What differs from /.test(await page.textContent('#compare h2')) && sum.some(x => /^Named Typed and left/.test(x)) && sum.some(x => /^Edited on this resume: /.test(x)) && sum.some(x => /^Adds a line only on this resume: A line that only this resume has/.test(x)) && sum.some(x => /^Skills arranged as: Renamed group/.test(x)) && sum.length === 4, JSON.stringify(sum));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc from Compare goes back to the Library, and the next Esc stays in it', await view(page) === 'resumes' && (await page.keyboard.press('Escape'), await settle(page), await view(page) === 'resumes'));
  await page.click('#ptabs [data-p=editor]'); await settle(page);

  // compare three, one of them a sent copy
  await page.evaluate(() => window.__wb.setView('export')); await settle(page);
  await page.click('[data-act=mark-sent]').catch(() => {}); await settle(page);
  await page.evaluate(() => window.__wb.setView(null));
  await page.evaluate(async () => { const RS = await import('/src/model/resumes.js'); window.__wb.store.commit(d => { RS.takeSnapshot(d, { kind: 'company', company: 'Smoke Co', role: 'Role' }); }, 'send'); });
  await page.click('#ptabs [data-p=library]'); await settle(page);
  ok('a sent copy has its own tick box on its resume\'s card', await page.isVisible(`#resumes .rcard[data-rid="${copy2}"] .rsent .rtick`));
  ok('the sent-copy tick box names its resume, so the ticks can be told apart', await page.evaluate(id => { const c = document.querySelector(`#resumes .rcard[data-rid="${id}"]`); return c.querySelector('.rsent .rtick').getAttribute('aria-label').includes(c.querySelector('.rname').textContent.replace(/\s*·.*$/, '').trim()); }, copy2));
  ok('Compare is off until two are ticked, and says how many', await page.isDisabled('#scr-cmp'));
  await page.check(`#resumes .rcard[data-rid="${s0.ids[1]}"] .rtick`); await page.check(`#resumes .rcard[data-rid="${s0.ids[2]}"] .rtick`); await page.check(`#resumes .rcard[data-rid="${copy2}"] .rsent .rtick`);
  ok('three ticks turn Compare on: "Compare 3"', !(await page.isDisabled('#scr-cmp')) && /Compare 3/.test(await page.textContent('#scr-cmp')) && (await page.$$('#resumes .rcard.ticked')).length >= 2);
  await page.click('#scr-cmp'); await settle(page);
  const cmp = await page.evaluate(() => { const t = document.querySelector('table.cmp'); return { view: window.__wb.ui.view, cols: t.querySelectorAll('thead th[scope=col]').length, rowHeads: t.querySelectorAll('tbody th[scope=row]').length, rows: t.querySelectorAll('tbody tr').length, diff: t.querySelectorAll('tr.diff-row').length, labels: [...t.querySelectorAll('tbody th')].map(x => x.textContent), cap: !!t.querySelector('caption'), sent: /sent/.test(t.querySelector('thead').textContent) }; });
  ok('Compare shows the three side by side: a column each (the sent copy among them), real row and column headers, a caption', cmp.view === 'compare' && cmp.cols === 4 && cmp.rowHeads === cmp.rows && cmp.cap && cmp.sent && cmp.rows > 20 && cmp.diff > 0, JSON.stringify({ ...cmp, labels: null }));
  ok('…with the job order, the skills, the photo, the paper and the pages', ['Job order', 'Skills', 'Photo', 'Paper', 'Pages', 'Pages printed'].every(l => cmp.labels.includes(l)));
  await page.waitForFunction(() => [...document.querySelectorAll('[data-pagesof]')].every(c => /^\d+$/.test(c.textContent)), null, { timeout: 60000 });
  ok('…the pages printed are filled in as the pictures come', true);
  await page.click('#compare [data-act=scr-back]'); await settle(page);
  ok('its back button reopens Resumes with the three still ticked', await view(page) === 'resumes' && (await page.$$('#resumes .rtick:checked')).length === 3);
  await page.click('[data-act=scr-clear]');
  ok('Clear ticks clears them', (await page.$$('#resumes .rtick:checked')).length === 0 && await page.isDisabled('#scr-cmp'));
  await page.click('#ptabs [data-p=editor]'); await settle(page);

  // the views, search and the row menu are still here
  await page.click('#ptabs [data-p=library]'); await settle(page);
  await page.click('[data-act=scr-view][data-v=date]'); await settle(page);
  ok('the Date view lists the sends, with the year, each a card with its own tick', (await page.$$('#resumes h3.lbl')).length >= 1 && await page.isVisible('#resumes .rcard .rtick'));
  await page.click('[data-act=scr-view][data-v=company]'); await settle(page);
  await page.fill('#scr-q', 'smoke co'); await settle(page);
  ok('the Company view groups by company, and search finds a send\'s company', (await page.$$eval('#resumes .rcard', c => new Set(c.map(x => x.dataset.rid)).size)) === 1);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc in the search box clears it first', await page.inputValue('#scr-q') === '' && await view(page) === 'resumes');
  await page.click('[data-act=scr-view][data-v=type]'); await settle(page);
  await page.click(`#resumes .rcard[data-rid="${copy2}"] .smore`); await settle(page);
  ok('the ⋯ menu has Duplicate, another language, Rename and Delete', (await page.$$('#resumes .rowmenu [role=menuitem]')).length === 4);
  await page.click('#resumes .rowmenu [data-act=rm-rename]'); await settle(page);
  ok('Rename is in place on the card', await page.isVisible('#resumes .rcard .swren'));
  await page.fill('#resumes .swren', 'Renamed here'); await page.keyboard.press('Enter'); await settle(page);
  ok('…and keeps what was typed', Object.values((await st(page)).names).includes('Renamed here'));
  { const rid = Object.entries((await st(page)).names).find(([, n]) => n === 'Renamed here')[0];
    await page.click(`#resumes .rcard[data-rid="${rid}"] .smore`); await settle(page); await page.click('#resumes .rowmenu [data-act=rm-rename]'); await settle(page);
    await page.fill('#resumes .swren', 'Typed then Esc'); await page.keyboard.press('Escape'); await settle(page);
    ok('Esc in the card rename keeps what was typed, and stays on the screen', Object.values((await st(page)).names).includes('Typed then Esc') && await view(page) === 'resumes'); }
  await page.click('#ptabs [data-p=editor]'); await settle(page);
  ok('no errors on the screens', errors.length === 0, errors[0] ?? '');
  await ctx.close();
}

// ---------------------------------------------------------------- Career
{
  const { ctx, page } = await open(1470, 832);
  await page.click('#ptabs [data-p=career]'); await settle(page);
  ok('the Career tab opens Career in #scr, aria-current on it, no back button, and the job names open the job', await view(page) === 'record' && await page.getAttribute('#ptabs [data-p=career]', 'aria-current') === 'page' && !(await page.$('#scr [data-act=scr-back]')) && await page.isVisible('#scr #checklist .clg .jobname[data-act=cl-open]') && !(await page.$('#checklist .clopen [data-act=cl-open]:not([data-sel*=jobtypes])')));
  await page.click('#checklist .clg:has-text("Hydra") .jobname'); await settle(page);
  ok('a job\'s name opens it in the editor, and the address follows', await view(page) === null && await page.evaluate(() => window.__wb.ui.sel.kind) === 'job' && await page.evaluate(() => location.hash) === '#resume');
  await page.click('#ptabs [data-p=career]'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc stays in Career (it never changes place), and R is the key for it', await view(page) === 'record' && await page.evaluate(() => location.hash) === '#record');
  await ctx.close();
}

// ---------------------------------------------------------------- no bar, ten languages, three sizes
const LANGS = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu'].filter(l => !ONLY || ONLY.has(l));
const SIZES = [[1280, 720], [1470, 832], [1920, 1080]];
const NAMES = { long: 'Example Instruments — Mechanical Design Engineer', sixty: 'Example Instruments — Senior Mechanical Design Engineer, EMEA'.slice(0, 60) };
const PROBE = `(() => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = el => (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).toString().trim().replace(/\\s+/g, ' ').slice(0, 30);
  const textRects = el => { const out = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n; (n = w.nextNode());){ if (!n.nodeValue.trim() || n.parentElement.closest('.sr')) continue; const g = document.createRange(); g.selectNodeContents(n); out.push(...g.getClientRects()); } return out; };
  const out = { clipped: [], overlap: [], bars: [], wide: 0, scroll: 0 };
  for (const id of ['#head', '#foot']){ const e = document.querySelector(id); if (e && vis(e) && e.getBoundingClientRect().width > innerWidth / 2) out.bars.push(id + ' ' + Math.round(e.getBoundingClientRect().width)); }
  const body = document.querySelector('#scr'); out.scroll = body.scrollWidth - body.clientWidth;
  const controls = [...document.querySelectorAll('#scr button, #scr input:not([type=checkbox]), #scr select, #scr h2, #ptabs button, #head button, #head .psub')].filter(vis).filter(e => !e.closest('.cmpscroll, .rowmenu, .rectl, .sr'));
  for (const el of controls){
    const r = el.getBoundingClientRect();
    for (const t of textRects(el)) if (t.right > r.right + 1 || t.left < r.left - 1){ out.clipped.push(label(el)); break; }
    if (el.matches('h2, .rname') && el.scrollWidth > el.clientWidth + 1) out.clipped.push(label(el));
  }
  for (const el of document.querySelectorAll('#scr .rname')) if (vis(el) && el.scrollWidth > el.clientWidth + 1) out.clipped.push(label(el));
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++){
    const a = controls[i], b = controls[j];
    if (a.contains(b) || b.contains(a)) continue;
    let p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
    const tuck = (r, el) => (el.closest('#ptabs') ? { left: r.left, right: r.right, top: r.top, bottom: Math.min(r.bottom, document.querySelector('#head').getBoundingClientRect().top) } : r);      // Tea's tags are tucked behind the card
    p = tuck(p, a); q = tuck(q, b);
    if (Math.min(p.right, q.right) - Math.max(p.left, q.left) > 1.5 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 1.5) out.overlap.push(label(a) + ' / ' + label(b));
  }
  return out;
})()`;
for (const [w, h] of SIZES){
  const { ctx, page } = await open(w, h, w === 1470 ? ['coffee', 'dark'] : ['tea', 'light']);
  await page.evaluate(() => { window.__wb.thumbs.fill = () => {}; });      // the layout does not wait for pictures; the boxes are there
  const s0 = await st(page);
  for (const lang of LANGS){
    const bad = [];
    for (const [key, name] of Object.entries(NAMES)){
      await page.evaluate(async ([l, n, other]) => {
        const I = await import('/src/i18n/index.js'); await I.loadCatalogue(l);
        window.__wb.ui.pref = { mode: 'fixed', lang: l };
        window.__wb.store.commit(d => { d.cur.name = n; const o = d.resumes.find(r => r.id === other); o.name = n + ' (2)'; }, 'name');
      }, [lang, name, s0.ids[1]]);
      await settle(page);
      for (const screen of ['resumes', 'compare', 'record']){
        try {
          if (screen === 'compare') await page.evaluate(ids => window.__wb.screens.compare(ids), s0.ids.slice(0, 3));
          else await page.evaluate(s => window.__wb.setView(s), screen);
          await page.waitForTimeout(200);
          const a = await page.evaluate(PROBE);
          for (const k of ['clipped', 'overlap', 'bars']) bad.push(...a[k].map(x => `${screen} ${key}: ${k} ${x}`));
          if (a.scroll > 1 && screen !== 'compare') bad.push(`${screen} ${key}: the screen scrolls sideways by ${a.scroll}px`);
        } catch (e){ bad.push(`${screen} ${key}: ${String(e.message ?? e).split('\n')[0].slice(0, 80)}`); }
        await page.evaluate(() => window.__wb.setView(null));
      }
    }
    ok(`${w}×${h} ${lang}: Library, Compare and Career: tabs and place card above the column, no bar across the window, nothing clipped or overlapping, no sideways scroll`, bad.length === 0, [...new Set(bad)].slice(0, 3).join(' ; '));
  }
  await ctx.close();
}
// ---------------------------------------------------------------- a phone: Resumes cards two to a row, thumbnails cropped behind the text, a tidy header
{
  const { ctx, page } = await open(390, 844);
  await page.evaluate(() => { window.__wb.thumbs.fill = () => {}; });
  const s0 = await st(page);
  for (const lang of LANGS){
    const bad = [];
    for (const [key, name] of Object.entries(NAMES)){
      await page.evaluate(async ([l, n, other]) => {
        const I = await import('/src/i18n/index.js'); await I.loadCatalogue(l);
        window.__wb.ui.pref = { mode: 'fixed', lang: l };
        window.__wb.store.commit(d => { d.cur.name = n; const o = d.resumes.find(r => r.id === other); o.name = n + ' (2)'; }, 'name');
      }, [lang, name, s0.ids[1]]);
      await page.evaluate(() => window.__wb.setView('resumes')); await page.waitForTimeout(200);
      const a = await page.evaluate(() => {
        const R = e => e.getBoundingClientRect(), cards = [...document.querySelectorAll('#body .rcard')], c0 = cards[0], w = R(c0).width;
        const body = R(document.querySelector('#resumes')), q = R(document.querySelector('#scr-q')), seg = R(document.querySelector('#resumes .seg'));
        const thumb = R(c0.querySelector('.thumbwrap'));
        const over = [];
        for (const c of cards){
          const tk = R(c.querySelector('.rtick')), tb = R(c.querySelector('.thumbwrap')), cw = R(c).width;
          if (tb.height >= cw * 0.7) over.push('uncropped');
          for (const b of c.querySelectorAll('button:not(.thumbwrap), .rtick ~ .rname')){
            const r = R(b); if (!r.width) continue;
            if (b !== c.querySelector('.rtick') && Math.min(r.right, tk.right) - Math.max(r.left, tk.left) > 1.5 && Math.min(r.bottom, tk.bottom) - Math.max(r.top, tk.top) > 1.5) over.push('tick covered by ' + (b.textContent || '').trim().slice(0, 12));
          }
          const bs = [...c.querySelectorAll('.racts button')].filter(b => R(b).width);
          for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++){ const p = R(bs[i]), r = R(bs[j]); if (Math.min(p.right, r.right) - Math.max(p.left, r.left) > 1.5 && Math.min(p.bottom, r.bottom) - Math.max(p.top, r.top) > 1.5) over.push('buttons overlap'); }
          for (const b of bs) if (R(b).height < 24 - 0.5) over.push('target under 24px');
        }
        return { cols: new Set(cards.map(c => Math.round(R(c).left))).size, qw: q.width / body.width, segw: seg.width / body.width, thumbH: thumb.height / w, over: [...new Set(over)], scroll: document.querySelector('#body').scrollWidth - document.querySelector('#body').clientWidth };
      });
      if (a.cols !== 2) bad.push(`${key}: ${a.cols} columns`);
      if (a.qw < 0.9) bad.push(`${key}: search ${Math.round(a.qw * 100)}% wide`);
      if (a.segw < 0.9) bad.push(`${key}: views ${Math.round(a.segw * 100)}% wide`);
      if (a.thumbH >= 0.7) bad.push(`${key}: thumbnail ${a.thumbH.toFixed(2)} of the card width`);
      bad.push(...a.over.map(x => `${key}: ${x}`));
      if (a.scroll > 1) bad.push(`${key}: sideways scroll ${a.scroll}`);
      await page.evaluate(() => window.__wb.setView(null));
    }
    ok(`390 phone ${lang}: Resumes in two columns, search and views full width, thumbnail cropped, nothing over the tick or buttons`, bad.length === 0, [...new Set(bad)].slice(0, 3).join(' ; '));
  }
  await ctx.close();
}
await browser.close(); server.close();
console.log(failed ? `\n${failed} screens check(s) FAILED` : '\nall screens checks passed');
process.exit(failed ? 1 : 0);
