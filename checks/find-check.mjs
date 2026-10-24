#!/usr/bin/env node
// node checks/find-check.mjs
// One search (UX-6f, stage 1). In Chromium on the fictional example:
//   - the key: Ctrl+F (Cmd+F on a Mac) opens the search and focuses its field in the Library, the Editor, Career and Compare (each has its own field, in the same spot); the next press, with the field
//     focused, is left to the browser; "/" does the same as the first press; plain F is a letter, full screen is F11, and Ctrl+F never reaches either; Ctrl+Shift+F is not touched,
//   - one query for the Library, Career and the Editor's bar; the results are grouped (Career entries and claims, resumes) and say where a word is, and a click goes there,
//   - "Resumes that print this" on a claim, a version and an entry goes to the Library with the search set to it; a fact no resume prints says so,
//   - in the Editor the search marks the lines of the open resume (a second highlight), counts them, steps through them with Enter and Shift+Enter, writes nothing (state and pages byte-identical),
//   - each control the search adds is pressable: the press class, a tier, a flat pressed state under reduced motion, themed in Tea and Coffee, light and dark.
// Chromium through Playwright (PW_BUNDLED=1, or CHROME_PATH); writes nothing. PART=key runs the parts whose name has these words.

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
const PART = process.env.PART;
const part = async (name, fn) => { if (PART && !name.includes(PART)) return; console.log(`\n— ${name}`); try { await fn(); } catch (e){ ok(`${name}: ran to its end`, false, String(e.message ?? e).split('\n')[0].slice(0, 160)); } };
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});

async function open(w, h, look = ['tea', 'light'], { motion = false } = {}){
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: motion ? 'no-preference' : 'reduce' });
  await ctx.addInitScript(([d, t, m]) => { try { (localStorage.setItem('rb-help-seen', '1'), localStorage.setItem('rb-esc-fold', 'off')); localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); localStorage.setItem('rb-reduce-motion', m ? '0' : '1'); } catch { /* none */ } }, [look[0], look[1], motion]);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const settle = (page, ms = 300) => page.waitForTimeout(ms);
const view = page => page.evaluate(() => window.__wb.ui.view);
const focused = page => page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName);
const goPlace = async (page, p) => { await page.click(`#ptabs [data-p=${p}]`); await settle(page); };
// the key the platform's find uses
const MOD = async page => ((await page.evaluate(() => navigator.platform)).startsWith('Mac') ? 'Meta' : 'Control');

// ---------------------------------------------------------------- the key
await part('the key: Ctrl+F (Cmd+F on a Mac) opens the search and focuses its field in every place; the next press is the browser’s', async () => {
  const { ctx, page, errors } = await open(1470, 832);
  const mod = await MOD(page);
  await page.evaluate(() => { window.__fs = 0; document.documentElement.requestFullscreen = () => { window.__fs++; return Promise.resolve(); }; window.__prevented = []; addEventListener('keydown', e => window.__prevented.push([e.key, e.defaultPrevented]), true); addEventListener('keydown', e => { window.__lastPrevented = e.defaultPrevented; }); });
  const press = async chord => { await page.keyboard.press(chord); await settle(page, 200); };
  // the Editor: a bar over the page
  await press(`${mod}+f`);
  ok('Editor: Ctrl+F shows the bar and focuses its field', await focused(page) === 'find-q' && await page.isVisible('#find'));
  ok('Ctrl+F did not reach full screen (plain F)', await page.evaluate(() => window.__fs) === 0);
  await press(`${mod}+f`);
  ok('with the field focused the next press is left to the browser (not prevented)', await page.evaluate(() => window.__lastPrevented) === false && await focused(page) === 'find-q');
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes the bar and gives the focus back', !(await page.isVisible('#find')) && await focused(page) !== 'find-q');
  // the Library
  await goPlace(page, 'library');
  await press(`${mod}+f`);
  ok('Library: the field in its toolbar has the focus', await focused(page) === 'scr-q' && await view(page) === 'resumes');
  await page.evaluate(() => document.activeElement.blur());
  // Compare has its own field
  await page.evaluate(() => { const s = window.__wb.store.state; window.__wb.screens.compare(s.resumes.slice(0, 2).map(r => r.id)); }); await settle(page, 400);
  ok('(Compare is open)', await view(page) === 'compare');
  await press(`${mod}+f`);
  ok('Compare: its own field in the toolbar has the focus (the place does not change)', await view(page) === 'compare' && await focused(page) === 'cmp-q');
  await page.evaluate(() => document.activeElement.blur());
  // Career
  await goPlace(page, 'career');
  await press(`${mod}+f`);
  ok('Career: the field in its toolbar has the focus', await focused(page) === 'rec-q' && await view(page) === 'record');
  // back in the Editor: the bar is gone, and "/" opens it
  await page.evaluate(() => document.activeElement.blur());
  await goPlace(page, 'editor');
  ok('leaving for the Editor does not leave a bar open', !(await page.isVisible('#find')));
  await page.keyboard.press('/'); await settle(page, 200);
  ok('"/" is the fallback: it opens the search like Ctrl+F', await focused(page) === 'find-q');
  await page.keyboard.press('Escape'); await settle(page);
  await page.keyboard.press('f'); await settle(page, 200);
  ok('plain F is a letter now: it is not full screen', await page.evaluate(() => window.__fs) === 0);
  await page.keyboard.press('F11'); await settle(page, 200);
  ok('F11 is full screen (the same toggle), and its key press is taken', await page.evaluate(() => window.__fs) === 1);
  await press(`${mod}+Shift+f`);
  ok('Ctrl+Shift+F is not taken', await page.evaluate(() => window.__lastPrevented) === false && !(await page.isVisible('#find')));
  ok('no script errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
});

await part('the keyboard: typing f or F in any writing surface never toggles full screen; plain F is a letter, F11 is full screen, in a text box too', async () => {
  const { ctx, page, errors } = await open(1470, 900, ['tea', 'light'], { motion: true });
  const mod = await MOD(page);
  await page.evaluate(() => { window.__fs = 0; document.documentElement.requestFullscreen = () => { window.__fs++; return Promise.resolve(); }; window.__wb.edit.setGuard?.(false); });
  const fs = () => page.evaluate(() => window.__fs);
  const sheet = page.frameLocator('#sheet iframe');
  const leave = async () => { await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page, 150); };
  const surfaces = [];
  const typeIn = async (name, prep) => {
    const before = await fs();
    await prep(); await settle(page, 250);
    const where = await page.evaluate(() => (document.activeElement?.classList.contains('ddbtn') ? 'SELECT' : document.activeElement?.tagName) + '#' + (document.activeElement?.id ?? ''));      // a select is its button (dropdown.js)
    await page.keyboard.type('fF'); await settle(page, 250);
    surfaces.push([name, (await fs()) - before, where]);
    await leave();
  };
  await typeIn('a line on the page', () => sheet.locator('.bullets li').first().click());
  await typeIn('the name on the page', () => sheet.locator('.name').first().click());
  await typeIn('a skill group on the page', async () => { const b = await sheet.locator('.skills__group').first().boundingBox(); await page.mouse.click(b.x + 40, b.y + 24); });
  await typeIn('the sidebar heading field', async () => { await page.evaluate(() => { window.__wb.ui.sel = { kind: 'section', id: 'experience' }; window.__wb.setView(null); }); await settle(page, 300); await page.click('#sec-label'); });
  await typeIn('a select', async () => { await page.evaluate(() => { window.__wb.setView(null); }); await page.evaluate(() => { if (!document.querySelector('#lens')) document.querySelector('[data-act=tailor-toggle]')?.click(); }); await page.waitForTimeout(200); await page.focus('.ddbtn[data-ddf=lens]'); });
  await typeIn('the Editor’s search bar', async () => { await page.keyboard.press(`${mod}+f`); });
  await leave();
  await typeIn('the name window’s search', async () => { await page.click('#docname-btn'); await page.waitForSelector('#switcher #sw-q'); await page.focus('#switcher #sw-q'); });
  await page.evaluate(() => window.__wb.setView('resumes')); await settle(page, 500);
  await typeIn('the Library’s search', () => page.click('#scr-q'));
  await page.evaluate(() => window.__wb.dock.setMode('record')); await settle(page, 500);
  await typeIn('Career’s search', () => page.click('#rec-q'));
  await page.evaluate(() => window.__wb.record.open(['work'])); await settle(page, 600);
  await page.click('#body summary:has-text("Details")'); await settle(page, 300);
  await page.click('#c-pos'); await settle(page, 200);
  const b0 = await fs();
  await page.keyboard.type('fF'); await settle(page, 200);
  surfaces.push(['a Career field', (await fs()) - b0, await page.evaluate(() => document.activeElement?.tagName + '#' + document.activeElement?.id)]);
  ok('typing f and F in ' + surfaces.length + ' writing surfaces never toggles full screen', surfaces.every(([, n]) => n === 0), surfaces.filter(([, n]) => n).map(x => x.join(' ')).join(' ; '));
  ok('…and the keyboard really was in each of them', surfaces.every(([, , w]) => /^(INPUT|TEXTAREA|SELECT|IFRAME)#/.test(w)), surfaces.map(x => x[2]).join(' '));
  // the date picker is a button and a menu, not a text box: a letter in it is a letter, F11 is still full screen
  const t0 = await fs();
  await page.keyboard.press('F11'); await settle(page, 200);      // still in the Career field
  ok('F11 is full screen in a text box too (the same toggle as the dock button)', (await fs()) === t0 + 1);
  await page.evaluate(() => document.activeElement.blur?.()); await page.mouse.click(5, 450); await settle(page, 150);
  await page.keyboard.press('f'); await settle(page, 150);
  ok('plain f with nothing written in is not full screen either', (await fs()) === t0 + 1);
  await page.evaluate(() => window.__wb.dock.setMode('edit')); await settle(page, 500);
  await page.evaluate(() => document.querySelector('[data-act=fullscreen]').click()); await settle(page, 200);
  ok('the dock button still toggles it', (await fs()) === t0 + 2);
  await page.keyboard.press('Shift+F'); await settle(page, 300);
  ok('Shift+F is still tea or coffee, not full screen', (await fs()) === t0 + 2 && (await page.evaluate(() => document.documentElement.dataset.drink)) === 'coffee');
  ok('no script errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
});

await part('the key: Help lists it', async () => {
  const { ctx, page } = await open(1470, 832);
  await page.keyboard.press('?'); await settle(page, 200);
  const rows = await page.$$eval('#help dl.keys div', r => r.map(x => x.textContent));
  ok('the shortcut sheet has a row for the search, with Ctrl F (Cmd F) and /', rows.some(x => /Search the resumes/.test(x) && /\//.test(x) && /F/.test(x)), rows.join(' | ').slice(0, 200));
  await ctx.close();
});

// ---------------------------------------------------------------- one search over the resumes and Career
await part('one search: the fields share one query; results are grouped (resumes, Career) and say where a word is', async () => {
  const { ctx, page } = await open(1470, 832);
  const mod = await MOD(page);
  await page.keyboard.press(`${mod}+f`); await settle(page, 200);
  await page.keyboard.type('caliper'); await settle(page, 200);
  await goPlace(page, 'library');
  ok('a query typed in the Editor\u2019s bar is in the Library\u2019s field', await page.inputValue('#scr-q') === 'caliper');
  const lib = await page.evaluate(() => ({ career: document.querySelector('#scr .found[aria-label*="Career"]')?.textContent ?? '', rows: [...document.querySelectorAll('#scr .found .frow')].map(x => x.textContent.trim()), cards: document.querySelectorAll('#scr .rcard').length }));
  ok('Library: a word only Career holds lists the Career entry under the cards, and says it is in Career, not on this resume', lib.rows.length >= 1 && /caliper/i.test(lib.rows.join()) && /in Career, not on this resume/.test(lib.rows.join()), JSON.stringify(lib));
  await page.click('#scr .found .frow >> nth=0'); await settle(page, 400);
  const at = await page.evaluate(() => ({ view: window.__wb.ui.view, name: document.querySelector('#body .oi-name')?.textContent.trim(), q: document.querySelector('#rec-q')?.value }));
  ok('a click goes to that entry in Career (docked in the inspector), the query kept', at.view === 'record' && /Caliper/i.test(at.name) && at.q === 'caliper', JSON.stringify(at));
  await page.fill('#rec-q', 'toolmaker'); await settle(page, 400);
  const vers = () => page.evaluate(() => { const item = [...document.querySelectorAll('#scr .found > ul > li')].find(l => /Ran DFM reviews with the toolmaker/.test(l.querySelector('.fwhere')?.textContent ?? '')); const shown = [...(item?.querySelectorAll(':scope > .fvers > li') ?? [])]; const folds = [...(item?.querySelectorAll('[data-act=find-fold]') ?? [])]; return { open: shown.map(r => r.querySelector('.fv').textContent), hit: shown.filter(r => r.classList.contains('hit')).length, marked: shown.filter(r => r.querySelector('mark.fnd')).length, folds: folds.map(f => [f.dataset.label, f.getAttribute('aria-expanded'), f.dataset.tier, f.nextElementSibling.hidden]) }; });
  const v1 = await vers();
  ok('Career: the open resume\u2019s language (EN) shows its versions with number and language, the word marked; a language with no match has no fold at all', JSON.stringify(v1.open) === '["v1 \u00b7 EN","v1.1 \u00b7 EN"]' && v1.hit === 2 && v1.marked === 2 && v1.folds.length === 0, JSON.stringify(v1));
  await page.fill('#rec-q', 'dfm'); await settle(page, 400);
  const v2 = await vers();
  ok('a word every language has: EN open, the other nine each in a shut secondary fold named by language and the number of matches', v2.open.length === 2 && v2.folds.length === 9 && v2.folds.every(f => f[1] === 'false' && f[2] === 'secondary' && f[3] === true && / \u00b7 1$/.test(f[0])) && v2.folds.some(f => f[0] === 'Magyar \u00b7 1') && !v2.folds.some(f => /English/.test(f[0])), JSON.stringify(v2));
  await page.click('#scr .found [data-act=find-fold]:has-text("Magyar")'); await settle(page, 200);
  const hu = await page.evaluate(() => { const f = [...document.querySelectorAll('#scr .found [data-act=find-fold]')].find(b => /Magyar/.test(b.dataset.label)); return { shown: !f.nextElementSibling.hidden, rows: [...f.nextElementSibling.querySelectorAll('.fv')].map(x => x.textContent), marked: !!f.nextElementSibling.querySelector('mark.fnd') }; });
  ok('a language\u2019s fold opens in place and shows that language\u2019s version with the word marked', hu.shown && JSON.stringify(hu.rows) === '["v1 \u00b7 HU"]' && hu.marked, JSON.stringify(hu));
  await page.fill('#rec-q', 'toolmaker'); await settle(page, 300);
  // the open resume is Hungarian: its language is the one that is open, and English is a fold
  await page.evaluate(() => { const r = window.__wb.store.state.resumes.find(x => x.lang === 'hu'); return window.__wb.resumes.open(r.id); }); await settle(page, 800);
  await goPlace(page, 'career'); await page.fill('#rec-q', 'dfm'); await settle(page, 500);
  const v3 = await vers();
  ok('with a Hungarian resume open, HU is the open language and English is a fold ("English \u00b7 2")', JSON.stringify(v3.open) === '["v1 \u00b7 HU"]' && v3.folds.some(f => f[0] === 'English \u00b7 2') && v3.folds.length === 9, JSON.stringify(v3));
  await page.evaluate(() => { const r = window.__wb.store.state.resumes.find(x => (x.lang ?? 'en') === 'en'); return window.__wb.resumes.open(r.id); }); await settle(page, 800);
  await goPlace(page, 'career'); await page.fill('#rec-q', 'toolmaker'); await settle(page, 400);
  ok('the result rows are not timeline rows: none is hidden by the timeline\u2019s filter or ringed as the selected entry', await page.evaluate(() => { const rows = [...document.querySelectorAll('#scr .found .frow')]; return rows.length > 0 && rows.every(b => b.style.display !== 'none' && !b.classList.contains('is-sel') && !b.dataset.grp); }));
  await page.fill('#rec-q', 'dfm'); await settle(page, 400);
  const car = await page.evaluate(() => ({ groups: [...document.querySelectorAll('#scr .found')].map(x => x.getAttribute('aria-label')), resumes: [...document.querySelectorAll('#scr .found [data-act=find-resume]')].map(x => x.textContent.trim().slice(0, 60)) }));
  ok('Career: its results are grouped, Career first and the resumes that print the word second, with the matching line', car.groups.length === 2 && /Career/.test(car.groups[0]) && /resumes/.test(car.groups[1]) && car.resumes.length >= 5 && car.resumes.some(x => /Ferro Tools/.test(x) && /DFM/.test(x)), JSON.stringify(car));
  const fo = () => page.evaluate(() => { const vis = [...document.querySelectorAll('#scr .found [data-act=find-resume]')].filter(b => b.offsetParent); const f = document.querySelector('#scr .found [data-act=find-fold][data-key=resumes]'); return { visible: vis.length, label: f?.textContent.trim(), expanded: f?.getAttribute('aria-expanded'), tier: f?.dataset.tier, total: document.querySelectorAll('#scr .found [data-act=find-resume]').length }; });
  const f1 = await fo();
  ok('Career: the first two resumes show and the other 6 are in a fold, "6 more", shut and secondary', f1.visible === 2 && f1.total === 8 && f1.label === '6 more' && f1.expanded === 'false' && f1.tier === 'secondary', JSON.stringify(f1));
  await page.click('#scr .found [data-act=find-fold][data-key=resumes]'); await settle(page, 200);
  const f2 = await fo();
  ok('the fold opens in place (all 8 show, the button says Show fewer) and shuts again', f2.visible === 8 && f2.expanded === 'true' && f2.label === 'Show fewer' && (await page.click('#scr .found [data-act=find-fold][data-key=resumes]'), await settle(page, 200), (await fo()).visible === 2));
  await page.click('#scr .found [data-act=find-fold][data-key=resumes]'); await page.fill('#rec-q', 'dfm '); await settle(page, 300); await page.fill('#rec-q', 'dfm'); await settle(page, 300);
  ok('a new search folds it again: the folds remember nothing between searches', (await fo()).visible === 2);
  await page.click('#scr .found [data-act=find-resume]:has-text("Ferro Tools")'); await settle(page, 400);
  const lib2 = await page.evaluate(() => ({ view: window.__wb.ui.view, q: document.querySelector('#scr-q')?.value, sel: document.querySelector('#scr .rcard.sel .rname')?.textContent.trim() }));
  ok('a resume in the results opens the Library with that resume selected and the query kept', lib2.view === 'resumes' && lib2.q === 'dfm' && /Ferro Tools/.test(lib2.sel), JSON.stringify(lib2));
  await page.fill('#scr-q', ''); await settle(page, 200);
  ok('with no query there are no result groups', await page.evaluate(() => document.querySelectorAll('#scr .found').length) === 0);
  await ctx.close();
});

// ---------------------------------------------------------------- Compare
await part('Compare: the search marks the rows that hold the word, counts them, and Enter and Shift+Enter step through them', async () => {
  const { ctx, page } = await open(1470, 832);
  await page.evaluate(() => { const s = window.__wb.store.state; window.__wb.screens.compare(s.resumes.slice(0, 2).map(r => r.id)); }); await settle(page, 600);
  await page.fill('#cmp-q', 'toolmaker'); await settle(page, 300);
  const m = await page.evaluate(() => ({ n: document.querySelector('#cmp-n').textContent, found: [...document.querySelectorAll('#compare tbody tr.is-found')].map(r => Number(r.dataset.i)) }));
  ok('rows that hold the word are marked and counted', /^\d+ rows$/.test(m.n) && m.found.length >= 1 && m.n === `${m.found.length} rows`, JSON.stringify(m));
  await page.keyboard.press('Enter'); await settle(page, 300);
  const a = await page.evaluate(() => ({ here: Number(document.querySelector('#compare tr.is-here')?.dataset.i), focus: document.activeElement.id }));
  ok('Enter goes to the first marked row (the inspector shows it) and the focus stays in the field', a.here === m.found[0] && a.focus === 'cmp-q', JSON.stringify(a));
  await page.fill('#cmp-q', ''); await settle(page, 200);
  ok('an empty search marks nothing', await page.evaluate(() => document.querySelectorAll('#compare tr.is-found').length === 0 && document.querySelector('#cmp-n').textContent === ''));
  await page.fill('#cmp-q', 'zzz'); await page.keyboard.press('Escape'); await settle(page, 300);
  ok('Esc clears the search first, and then leaves Compare for the grid', await page.inputValue('#cmp-q') === '' && (await view(page)) === 'compare' && (await page.focus('#cmp-q'), await page.keyboard.press('Escape'), await settle(page, 300), await view(page)) === 'resumes');
  await ctx.close();
});

// ---------------------------------------------------------------- one place for it
await part('one place: the search field is in the same spot in the Library, Editor, Career and Compare, at 1280x720 and 900x700', async () => {
  for (const [w, h] of [[1280, 720], [900, 700]]){
    const { ctx, page } = await open(w, h);
    const mod = await MOD(page), at = {};
    const rect = sel => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
    await page.keyboard.press(`${mod}+f`); await settle(page, 300); at.editor = await rect('#find-q');
    await page.keyboard.press('Escape'); await settle(page, 200);
    await goPlace(page, 'library'); at.library = await rect('#scr-q');
    await page.evaluate(() => { const s = window.__wb.store.state; window.__wb.screens.compare(s.resumes.slice(0, 2).map(r => r.id)); }); await settle(page, 600); at.compare = await rect('#cmp-q');
    await goPlace(page, 'career'); at.career = await rect('#rec-q');
    const all = Object.values(at);
    ok(`${w}x${h}: the field is at the same spot in all four places (within 2 px)`, all.every(p => Math.abs(p[0] - all[0][0]) <= 2 && Math.abs(p[1] - all[0][1]) <= 2), JSON.stringify(at));
    await ctx.close();
  }
});

// ---------------------------------------------------------------- from a fact to its resumes
await part('Resumes that print this: from a claim, a version or an entry to the Library with the search set to it; a fact no resume prints says so', async () => {
  const { ctx, page } = await open(1470, 832);
  await goPlace(page, 'career'); await page.fill('#rec-q', 'toolmaker'); await settle(page, 400);
  const cards = () => page.$$eval('#scr .rcard .rname', r => r.map(x => x.textContent.trim()));
  await page.click('#scr .found .fhead [data-act=find-prints]'); await settle(page, 500);
  const chip = () => page.evaluate(() => document.querySelector('#scr [data-act=find-claim-clear]')?.textContent.trim() ?? '');
  const a = await cards();
  ok('the claim\u2019s button goes to the Library with the search set to it: the 8 resumes that print it, the field empty, a chip names the claim', await view(page) === 'resumes' && a.length === 8 && /Prints: Ran DFM reviews/.test(await chip()) && await page.inputValue('#scr-q') === '', a.length + ' ' + await chip());
  await page.click('[data-act=find-claim-clear]'); await settle(page, 300);
  ok('the chip clears it and every resume is back', (await cards()).length === 14 && !(await chip()));
  await goPlace(page, 'career'); await page.fill('#rec-q', 'toolmaker'); await settle(page, 400);
  await page.focus('#scr .found .fvers li:first-child .fvp'); await page.keyboard.press('Enter'); await settle(page, 500);
  const b = await cards();
  ok('a version row\u2019s button (reached by the keyboard) lists only the resumes that print that very version', b.length === 2 && b.some(x => /Ferro Tools/.test(x)) && b.some(x => /Medtech/.test(x)), b.join(' | '));
  await page.focus('#scr-q'); await page.keyboard.press('Escape'); await settle(page, 300);
  ok('Esc in the field clears the claim first', !(await chip()) && (await cards()).length === 14 && await view(page) === 'resumes');
  // an entry
  await goPlace(page, 'career'); await page.fill('#rec-q', ''); await settle(page, 300);
  await page.click('#scr .rectl .row:has-text("Design Engineer")'); await settle(page, 300);
  await page.click('#body .insp-rec [data-act=find-prints]'); await settle(page, 500);
  ok('an entry has the button too: the resumes that print any of its lines', await view(page) === 'resumes' && (await cards()).length === 14 && /Prints: Design Engineer/.test(await chip()), await chip());
  await page.click('[data-act=find-claim-clear]'); await settle(page, 200);
  // a fact no resume prints
  await goPlace(page, 'career'); await page.fill('#rec-q', 'printable caliper stand'); await settle(page, 400);
  await page.click('#scr .found li:has-text("Published a printable caliper stand") .fhead [data-act=find-prints]'); await settle(page, 500);
  ok('a fact no resume prints says so', (await cards()).length === 0 && /No resume prints this/.test(await page.textContent('#scr-list')), await page.textContent('#scr-list'));
  await ctx.close();
});

// ---------------------------------------------------------------- in the Editor: where is this word used
await part('the Editor: the search marks the lines on the open resume, counts them, Enter and Shift+Enter step through them; nothing is written; Esc clears', async () => {
  const { ctx, page } = await open(1470, 832);
  const snap = () => page.evaluate(() => { const norm = h => h.replace(/ class=""/g, ''); return { doc: norm(window.__wb.sheet.doc.querySelector('.document').outerHTML), state: JSON.stringify(window.__wb.store.state.cur) + JSON.stringify(window.__wb.store.state.resumes), pages: window.__wb.sheet.pages.map(p => p.outerHTML ?? String(p)).join('') }; });
  const before = await snap();
  await page.keyboard.press('/'); await settle(page, 200);
  await page.keyboard.type('the'); await settle(page, 300);
  const m = await page.evaluate(() => ({ n: window.__wb.sheet.doc.querySelectorAll('.rb-find').length, text: document.querySelector('#find-n').textContent, facts: window.__wb.sheet.finds(window.__wb.ui.ix) }));
  ok('lines are marked on the page (a second highlight) and counted: "N on this resume"', m.n >= 3 && m.text === `${m.n} on this resume` && m.facts.length === m.n, JSON.stringify(m));
  const sel = () => page.evaluate(() => ({ id: window.__wb.ui.sel.id, focus: document.activeElement.id, marked: window.__wb.sheet.doc.querySelectorAll('.rb-sel').length }));
  await page.keyboard.press('Enter'); await settle(page, 300);
  const a = await sel();
  await page.keyboard.press('Enter'); await settle(page, 300);
  const b = await sel();
  await page.keyboard.press('Shift+Enter'); await settle(page, 300);
  const c = await sel();
  await page.keyboard.press('Shift+Enter'); await settle(page, 300);
  const d = await sel();
  ok('Enter selects the first line and the next, Shift+Enter goes back and then wraps to the last; the focus stays in the field', a.id === m.facts[0] && b.id === m.facts[1] && c.id === m.facts[0] && d.id === m.facts.at(-1) && [a, b, c, d].every(x => x.focus === 'find-q' && x.marked >= 1), JSON.stringify({ a, b, c, d, m: m.facts }));
  await page.click('[data-act=find-next]'); await settle(page, 300);
  ok('the step buttons do the same', (await sel()).id === m.facts[0]);
  const during = await snap();
  ok('nothing is written and the rendered pages are byte-identical while marked', during.state === before.state && during.pages === before.pages);
  await page.keyboard.press('Escape'); await settle(page, 300);
  const after = await snap();
  const gone = [await page.evaluate(() => window.__wb.sheet.doc.querySelectorAll('.rb-find').length) === 0, !(await page.isVisible('#find')), await focused(page) !== 'find-q'];
  const strip = h => h.replace(/ ?rb-(sel|ring|tab-full|tab|hot|cool)\b/g, '').replace(/ class=""/g, '');      // the selected line's plate, and the rings and the grip's tab that go with it
  ok('Esc clears the marks, closes the bar and the focus is not left in it; the page is as it was (but for the selected line)', gone.every(Boolean) && strip(after.doc) === strip(before.doc), JSON.stringify(gone));
  await page.keyboard.press('/'); await settle(page, 200); await page.keyboard.type('zzz-nothing'); await settle(page, 200);
  ok('a word on no line counts 0 and the step buttons are off', await page.textContent('#find-n') === '0 on this resume' && await page.isDisabled('[data-act=find-next]'));
  await ctx.close();
});

// ---------------------------------------------------------------- pressable controls: the tier, the pressed look, the keys
// The tier of each control the search adds: the step buttons and "Resumes that print this" and the chip are secondary; the close button, the result rows and a version's button are tertiary.
await part('the press: each control is raised in Tea and Coffee, light and dark, and lowered when pressed (static under reduced motion), flat when disabled, and Enter and Space press it', async () => {
  for (const [look, motion] of [[['tea', 'light'], true], [['tea', 'dark'], true], [['coffee', 'light'], true], [['coffee', 'dark'], true], [['coffee', 'dark'], false]]){
    const tag = `${look.join(' ')}${motion ? '' : ', reduced motion'}`;
    const { ctx, page } = await open(1470, 832, look, { motion });
    await page.keyboard.press('/'); await settle(page, 200); await page.keyboard.type('the'); await settle(page, 300);
    const read = sel => page.$eval(sel, b => ({ tier: b.dataset.tier, press: b.classList.contains('press'), sh: getComputedStyle(b).boxShadow, tf: getComputedStyle(b).transform, tr: getComputedStyle(b).transitionDuration, icon: b.hasAttribute('data-icon'), frame: parseFloat(getComputedStyle(b).borderTopWidth) >= 1 && !/, 0\)$|transparent/.test(getComputedStyle(b).borderTopColor) }));
    for (const [name, sel, tier] of [['step button', '#find [data-act=find-next]', 'secondary'], ['close button', '#find [data-act=find-close]', 'tertiary']]){
      const rest = await read(sel);
      await page.$eval(sel, b => b.classList.add('is-down')); await settle(page, motion ? 400 : 10);
      const down = await read(sel);
      // UX-6 round 2: a secondary has a shadow that closes; a tertiary icon (the close button) has none, only its quiet frame (buttons.css)
      if (tier === 'secondary') ok(`${tag}: the ${name} is a ${tier} press: a shadow at rest that closes and a face that moves when pressed`, rest.press && rest.tier === tier && rest.sh !== 'none' && /(^| )0px 0px 0px 0px$/.test(down.sh) && down.tf !== rest.tf && down.tf !== 'none', JSON.stringify({ rest, down }));
      else ok(`${tag}: the ${name} is a ${tier} press, an icon tool: no shadow, a quiet frame at rest, and a face that moves when pressed`, rest.press && rest.tier === tier && rest.icon && rest.sh === 'none' && rest.frame && down.tf !== rest.tf && down.tf !== 'none', JSON.stringify({ rest, down }));
      if (!motion) ok(`${tag}: no transition, so the pressed look is there at once`, rest.tr === '0s', rest.tr);
      if (process.env.SHOTS){ const shot = n => page.screenshot({ path: path.join(process.env.SHOTS, `find-${name.split(' ')[0]}-${look.join('-')}${motion ? '' : '-rm'}-${n}.png`), clip: { x: 0, y: 0, width: 520, height: 70 } }); await shot('pressed'); await page.$eval(sel, b => b.classList.remove('is-down')); await settle(page, 400); await shot('rest'); }
      else await page.$eval(sel, b => b.classList.remove('is-down'));
    }
    if (motion && look[0] === 'tea'){
      // the tier's travel: primary > secondary > tertiary, in the tokens
      const t = await page.evaluate(() => { const c = getComputedStyle(document.documentElement); return ['p', 's', 't'].map(k => parseFloat(c.getPropertyValue(`--press-${k}-travel`))); });
      ok('the tiers\u2019 travel shrinks from primary to tertiary (3, 1.5, 1 px)', t[0] > t[1] && t[1] > t[2], t.join());
      // Enter and Space hold the press, as the pointer does
      // (on a control that does nothing, so the focus stays: the step buttons hand it back to the field)
      await page.evaluate(() => { const b = document.createElement('button'); b.id = 'tmp-press'; b.className = 'press'; b.textContent = 'x'; document.body.append(b); b.focus(); });
      const down = () => page.$eval('#tmp-press', b => b.classList.contains('is-down'));
      await page.keyboard.down('Enter'); const e = await down(); await page.keyboard.up('Enter');
      await page.keyboard.down('Space'); const sp = await down(); await page.keyboard.up('Space');
      ok('Enter and Space hold the press while the key is down, and let go', e && sp && !(await down()));
      // a disabled control is flat
      await page.fill('#find-q', 'zzz-nothing'); await settle(page, 600);
      ok('a disabled step button is flat: no shadow, no travel', await page.$eval('#find [data-act=find-next]', b => b.disabled && getComputedStyle(b).boxShadow === 'none' && getComputedStyle(b).transform === 'none'));
    }
    await ctx.close();
  }
});

await part('the press: the result rows (tertiary) and "Resumes that print this" (secondary) wear a paper shadow on paper, in all four looks', async () => {
  for (const look of [['tea', 'light'], ['tea', 'dark'], ['coffee', 'light'], ['coffee', 'dark']]){
    const { ctx, page } = await open(1470, 832, look, { motion: true });
    await goPlace(page, 'career'); await page.fill('#rec-q', 'toolmaker'); await settle(page, 500);
    const r = await page.evaluate(() => { const f = s => { const b = document.querySelector(s); return { tier: b.dataset.tier, sh: getComputedStyle(b).boxShadow, edge: getComputedStyle(b).borderTopColor }; }; return { row: f('#scr .found .frow'), btn: f('#scr .found .fhead [data-act=find-prints]'), ver: f('#scr .found .fvp') }; });
    ok(`${look.join(' ')}: a result row is tertiary, the button secondary, the version\u2019s button tertiary, all with the paper shadow`, r.row.tier === 'tertiary' && r.btn.tier === 'secondary' && r.ver.tier === 'tertiary' && /rgba\(34, 48, 42/.test(r.btn.sh) && /2px 2px/.test(r.btn.sh), JSON.stringify(r));
    if (process.env.SHOTS){
      const clip = { x: 10, y: 80, width: 940, height: 130 }, name = `find-results-${look.join('-')}`;
      await page.screenshot({ path: path.join(process.env.SHOTS, `${name}-rest.png`), clip });
      await page.$eval('#scr .found .fhead [data-act=find-prints]', b => b.classList.add('is-down')); await page.$eval('#scr .found .frow', b => b.classList.add('is-down')); await settle(page, 400);
      await page.screenshot({ path: path.join(process.env.SHOTS, `${name}-pressed.png`), clip });
    }
    await ctx.close();
  }
});

await browser.close(); server.close();
console.log(failed ? `\n${failed} find check(s) FAILED` : '\nall find checks passed');
process.exit(failed ? 1 : 0);
