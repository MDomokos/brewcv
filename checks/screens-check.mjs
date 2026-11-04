#!/usr/bin/env node
// node checks/screens-check.mjs
// What the three places hold (the routing, the tabs and the keys are places-check's). In Chromium on the fictional example:
//   - the Library: cards with the information beside the picture (company, role, paper, language, pages), Open now, a Sent N times badge, a tick
//     named for its resume, a second page fanned behind a longer resume, newest first; as many to a row as hold 260 px (three at 1280, five at
//     1920, seven at 2560); a click selects (a second one too) and Enter, a double click or the inspector's Open opens; the thumbnails are pictures of the real first page and
//     each is drawn once; every page of a resume is kept in the cache,
//   - the inspector in the sidebar's body, with no scroll of its own: every page across its width, scrolled in place (the wheel and a click there never
//     open it), Open as the primary and Use for a new job right under them, then the language with a switch, last changed, where it came from, the
//     round, and the sent copies and files folded; Use for a new job (a
//     company is required; Enter makes the copy under its parent with the company and role and opens it; what was typed survives leaving the place),
//     the row menu (Duplicate opens the copy with its name ready), its sent copies,
//   - the hover preview: a page beside the card after the rest, "2 / 2" on a wheel, gone when the pointer leaves or anything is clicked,
//   - Compare of three (one a sent copy): back and Esc keep the ticks, N and P step the rows that differ and the inspector shows the row,
//   - the Library as a list: a row for each resume and file, the sent copies and files of a resume folded under it, selecting, opening, the keys,
//     ticks, search, rounds and carrying a row onto one, remembered; fewer columns when narrow; a phone keeps the cards,
//   - Career: profile cards and the timeline (newest first), the entry docked in the inspector with its scope named, its lines to tick,
//     search finding a line and marking it; nothing floats over the timeline,
//   - no bar across the window on any place, and, at three sizes in the ten languages with a long and a 60 character name, nothing clipped or overlapping.
// Chromium through Playwright (PW_BUNDLED=1, or CHROME_PATH); writes nothing. ONLY=de,hu limits the languages of the layout part.

import { chromium } from 'playwright';
import { plainExample } from './lib/plain-example.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickOption } from './lib/dropdown.mjs';

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
// a part that stops (a control that is not there) is one failure with its reason, and the parts after it still run
const PART = process.env.PART;      // PART=pages runs only the parts whose name has these words
const part = async (name, fn) => { if (PART && !name.includes(PART)) return; console.log(`\n— ${name}`); try { await fn(); } catch (e){ ok(`${name}: ran to its end`, false, String(e.message ?? e).split('\n')[0].slice(0, 160)); } };
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});

// The parts below were written for the example's fourteen resumes with no rounds, files or sends, and make their own: the example's Library (its rounds, files, sends and
// language copies) is taken off first. `library` keeps it, for the part that looks at it.
async function open(w, h, look = ['tea', 'light'], { motion = false, library = false } = {}){
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: motion ? 'no-preference' : 'reduce' });
  await ctx.addInitScript(([d, t, m]) => { try { (localStorage.setItem('rb-help-seen', '1'), localStorage.setItem('rb-esc-fold', 'off')); localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); localStorage.setItem('rb-reduce-motion', m ? '0' : '1');
    if (!localStorage.getItem('rb-manage-view')) localStorage.setItem('rb-manage-view', 'date'); } catch { /* none */ } }, [...look, motion]);      // the parts measure groups of several cards: the example's roles all differ, so grouped by role each card is a group of its own
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  if (!library) await page.evaluate(plainExample);
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const settle = (page, ms = 300) => page.waitForTimeout(ms);
const st = page => page.evaluate(() => { const s = window.__wb.store.state; return { openId: s.openId, ids: s.resumes.map(r => r.id), parents: Object.fromEntries(s.resumes.map(r => [r.id, r.parent ?? null])), names: Object.fromEntries(s.resumes.map(r => [r.id, r.name ?? null])) }; });
const view = page => page.evaluate(() => window.__wb.ui.view);
const thumbsDone = (page, n) => page.waitForFunction(n => document.querySelectorAll('#scr [data-thumb] iframe').length >= n, n, { timeout: 60000 });
// the Library's resume items: a resume and its copies in other languages are one, the hidden ones (in an archived round) left out
const items = page => page.evaluate(async () => { const RS = await import('/src/model/resumes.js'), DOC = await import('/src/model/documents.js'), s = window.__wb.store.state; return new Set(s.resumes.filter(r => !DOC.hidden(s, r)).map(r => RS.langRoot(s, r).id)).size; });
const MEDTECH = 'Medtech Lisboa - Mechanical Engineer.json';      // two pages, an A4 resume that may run to two: the sidebar is at its narrow width when it is open
const goLibrary = async page => { await page.click('#ptabs [data-p=library]'); await settle(page); };
// make a resume the open one without going through the UI (it has to be a resume that is saved)
const openResume = async (page, id) => { await page.evaluate(id => window.__wb.resumes.open(id), id); await settle(page, 500); };

// ---------------------------------------------------------------- the Library
await part('the cards: the information beside the picture, badges, ticks, the fan, newest first', async () => {
  const { ctx, page } = await open(1470, 832);
  await page.evaluate(async () => { const RS = await import('/src/model/resumes.js'); window.__wb.store.commit(d => { RS.takeSnapshot(d, { kind: 'company', company: 'Smoke Co', role: 'Role' }); }, 'send'); });
  await goLibrary(page);
  const n0 = await items(page); await thumbsDone(page, n0);
  const c = await page.evaluate(id => {
    const cs = [...document.querySelectorAll('#scr .rcard:not(.rdoc)')], R = e => e.getBoundingClientRect(), first = cs[0], open = document.querySelector('#scr .rcard.open');
    const med = document.querySelector(`#scr .rcard[data-rid="${id}"]`);
    return { n: cs.length, openFirst: first === open, openNow: first.querySelector('.is-open')?.textContent, sentBadge: first.querySelector('.rbadges .pill:not(.is-open)')?.textContent,
      role: first.querySelector('.rrole')?.textContent, meta: first.querySelector('.rmeta')?.textContent, name: first.querySelector('.rname')?.textContent.trim(),
      beside: R(first.querySelector('.rname')).left >= R(first.querySelector('.thumbwrap')).right - 1 && Math.abs(R(first.querySelector('.rname')).top - R(first.querySelector('.thumbwrap')).top) < 40,
      tickNamed: cs.every(x => (x.querySelector('input.rtick')?.getAttribute('aria-label') ?? '').length > 3), noDiffs: !document.querySelector('#scr .rcard [data-act=scr-differs], #scr .rcard .rfrom'),
      fan: getComputedStyle(med.querySelector('.thumbwrap'), '::before').content !== 'none', noFan: getComputedStyle(first.querySelector('.thumbwrap'), '::before').content === 'none' };
  }, MEDTECH);
  ok('every resume has a card, its language copies on it; the open one is first and says "Open now"', c.n === n0 && c.openFirst && c.openNow === 'Open now');
  ok('the card has the company, the role, the paper, the language and the pages, beside the picture', c.name === 'Example Instruments' && c.role === 'Design Engineer' && /Letter/.test(c.meta) && /EN/.test(c.meta) && /1 p/.test(c.meta) && c.beside, `${c.name} | ${c.role} | ${c.meta}`);
  ok('a resume that was sent says "Sent 1×"', c.sentBadge === 'Sent 1×', c.sentBadge);
  ok('every tick box has a name, and the card holds no "What differs" (it is the inspector\u2019s)', c.tickNamed && c.noDiffs);
  ok('a resume of two pages fans its second sheet out behind the first; one of a single page does not', c.fan && c.noFan);
  const order = await page.evaluate(() => [...document.querySelectorAll('#scr .rgrid')].map(g => [...g.querySelectorAll('.rcard:not(.rdoc)')].map(x => (x.classList.contains('open') ? '9999' : window.__wb.store.state.resumes.find(r => r.id === x.dataset.rid).savedAt || ''))));
  ok('within each group the cards run newest first (the open resume counts as the newest)', order.length > 1 && order.every(g => g.every((d, i) => !i || g[i - 1] >= d)) && order.some(g => g.length > 2));
  await ctx.close();
});

await part('cards per row: three at 1280, five at 1920, seven at 2560 (no rail: the Library has its width back)', async () => {
  for (const [w, h, want] of [[1280, 720, 3], [1920, 1080, 5], [2560, 1440, 7]]){
    const { ctx, page } = await open(w, h);
    await openResume(page, MEDTECH);      // a resume that may run to two pages: the sidebar is at its narrow width, so the cards have the room they need
    await goLibrary(page);
    const cols = await page.evaluate(() => { const cs = [...document.querySelectorAll('#scr .rcard')]; return { cols: new Set(cs.map(c => Math.round(c.getBoundingClientRect().left))).size, min: Math.min(...cs.map(c => c.getBoundingClientRect().width)) }; });
    ok(`${w}×${h}: ${want} cards to a row, none under 260 px wide`, cols.cols === want && cols.min >= 260 - 1, JSON.stringify(cols));
    await ctx.close();
  }
});

await part('zoom: the Library cards and the Career timeline step with - + 0 and Ctrl+wheel, within limits, remembered, text size unchanged, not while typing', async () => {
  const { ctx, page } = await open(1470, 832);
  const lib = () => page.evaluate(() => { const c = document.querySelector('#scr .rcard'); return { w: Math.round(c.querySelector('.rthumb').getBoundingClientRect().width), cols: new Set([...document.querySelectorAll('#scr .rcard')].map(x => Math.round(x.getBoundingClientRect().left))).size, fs: getComputedStyle(c.querySelector('.rrole')).fontSize, store: localStorage.getItem('rb-zoom-library') }; });
  await goLibrary(page);
  const d = await lib();
  for (let i = 0; i < 8; i++) await page.keyboard.press('-');
  const out = await lib();
  if (process.env.ZOOM_SHOTS) await page.screenshot({ path: `${process.env.ZOOM_SHOTS}/zoom-lib-out.png` });
  await page.keyboard.press('0'); const back = await lib();
  for (let i = 0; i < 8; i++) await page.keyboard.press('+');
  const inn = await lib();
  if (process.env.ZOOM_SHOTS) await page.screenshot({ path: `${process.env.ZOOM_SHOTS}/zoom-lib-in.png` });
  ok('Library: - shrinks the cards (more to a row), 0 resets, + enlarges them (two or more still to a row), the text keeps its size', out.w < d.w && inn.w > d.w && back.w === d.w && out.cols > d.cols && inn.cols < d.cols && inn.cols >= 2 && out.fs === d.fs && inn.fs === d.fs, JSON.stringify({ d, out, back, inn }));
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForFunction(() => document.body.classList.contains('is-ready')); await goLibrary(page);
  ok('Library: a reload keeps the zoom', (await lib()).w === inn.w && (await lib()).store === '5');
  await page.fill('#scr-q', ''); await page.focus('#scr-q'); await page.keyboard.type('+-0');
  ok('typing + - 0 in the search field does not zoom, and the keys are the field’s', await page.evaluate(() => localStorage.getItem('rb-zoom-library')) === '5' && await page.inputValue('#scr-q') === '+-0');
  await page.fill('#scr-q', ''); await page.evaluate(() => document.activeElement.blur());
  await page.click('#ptabs [data-p=career]'); await settle(page, 500);
  const car = () => page.evaluate(() => { const r = document.querySelector('#scr .ce-tg'), row = document.querySelector('#scr .ce-card'); return { w: Math.round(r.getBoundingClientRect().width), h: Math.round(r.getBoundingClientRect().height), fs: getComputedStyle(row.querySelector('.t b')).fontSize, store: localStorage.getItem('rb-zoom-career') }; });
  const c0 = await car();
  for (let i = 0; i < 8; i++) await page.keyboard.press('-');
  const c1 = await car();
  if (process.env.ZOOM_SHOTS) await page.screenshot({ path: `${process.env.ZOOM_SHOTS}/zoom-career-out.png` });
  await page.keyboard.press('0'); const c2 = await car();
  await page.mouse.move(400, 400); await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control'); await settle(page, 200);
  const c3 = await car();
  ok('Career: - tightens the timeline (shorter, to 5 steps), 0 resets, Ctrl+wheel steps it; the text keeps its size; the Library’s zoom is its own', c1.h < c0.h && c1.store === '-5' && c2.h === c0.h && c2.w === c0.w && c3.store === '1' && c3.h > c0.h && c1.fs === c0.fs && c3.fs === c0.fs, JSON.stringify({ c0, c1, c2, c3 }));
  await ctx.close();
});

await part('a click selects (a second one too); Enter, a double click or Open opens it; the thumbnails', async () => {
  const { ctx, page, errors } = await open(1470, 832);
  const s0 = await st(page), n = await items(page);
  await goLibrary(page);
  ok('the Library opens with the open resume selected and the focus on its card; the sidebar\u2019s body is the inspector', await view(page) === 'resumes' && await page.evaluate(() => document.activeElement?.matches('#scr .rcard.sel .rsel') && document.querySelector('#body').dataset.view === 'inspector' && !!document.querySelector('#body .insp-res')));
  ok('…and there is no back button on a desktop', !(await page.$('#scr [data-act=scr-back]')));
  await thumbsDone(page, n);
  await page.waitForFunction(() => [...document.querySelectorAll('#resumes [data-thumb] iframe')].every(f => f.contentDocument?.querySelector('.page')), null, { timeout: 20000 }).catch(() => {});      // a frame exists before its page is drawn
  const pics = await page.evaluate(() => [...document.querySelectorAll('#resumes [data-thumb] iframe')].map(f => ({ text: f.contentDocument?.querySelector('.page')?.textContent ?? '', w: f.getBoundingClientRect().width })));
  ok(`the thumbnails come: one picture of the real first page for each of the ${n} resumes, small`, pics.length === n && pics.every(p => /Okonkwo/.test(p.text) && p.w > 60 && p.w < 260), JSON.stringify(pics.filter(p => !/Okonkwo/.test(p.text) || p.w <= 60 || p.w >= 260).map(p => [p.text.slice(0, 20), p.w])));
  const drawn = await page.evaluate(() => window.__wb.thumbs.stats.drawn);
  ok('…each was drawn once (the inspector\u2019s picture is the same one)', drawn === n, String(drawn));
  const entry = await page.evaluate(async id => { const b = window.__wb, e = await b.thumbs.entry(b.resumes.heldRecipe(id)); return { pages: e.pages, srcs: e.srcs.length, second: /class="page/.test(e.srcs[1] ?? '') && e.srcs[1] !== e.srcs[0] }; }, MEDTECH);
  ok('the thumbnail cache keeps every page of a resume, one document each (not only the first)', entry.pages === 2 && entry.srcs === 2 && entry.second, JSON.stringify(entry));
  const other = s0.ids[1];
  await page.click(`#scr .rcard[data-rid="${other}"] .rsel`); await settle(page);
  const a = await page.evaluate(id => ({ view: window.__wb.ui.view, open: window.__wb.store.state.openId, sel: document.querySelector('#scr .rcard.sel')?.dataset.rid, insp: document.querySelector('#body .insp-res')?.getAttribute('aria-label'), inspSel: id }), other);
  ok('a click on a card selects it: it is ringed and the inspector shows it, and nothing opens', a.view === 'resumes' && a.sel === other && a.open === s0.openId && /—/.test(a.insp) && a.insp !== 'Example Instruments — Design Engineer', JSON.stringify(a));
  await page.click(`#scr .rcard[data-rid="${other}"] .rsel`); await settle(page, 500);
  await page.click(`#scr .rcard[data-rid="${other}"] .thumbwrap`); await settle(page, 500);
  ok('a second click on the selected card, on its name or its picture, opens nothing', await view(page) === 'resumes' && (await st(page)).openId === s0.openId && await page.$(`#scr .rcard.sel[data-rid="${other}"]`));
  await page.click('#body .iacts .iopen'); await settle(page, 500);
  ok('the inspector\u2019s Open (a real button, the primary) opens it in the editor', await view(page) === null && (await st(page)).openId === other);
  await goLibrary(page);
  await page.dblclick(`#scr .rcard[data-rid="${s0.ids[2]}"] .rname`); await settle(page, 500);
  ok('a double click on a card opens it', await view(page) === null && (await st(page)).openId === s0.ids[2]);
  await goLibrary(page);
  await page.focus(`#scr .rcard[data-rid="${s0.ids[3]}"] .rsel`); await page.keyboard.press('Enter'); await settle(page, 500);
  ok('Enter on a card opens it', await view(page) === null && (await st(page)).openId === s0.ids[3]);
  ok('no errors in the Library', errors.length === 0, errors[0] ?? '');
  await ctx.close();
});

await part('the inspector: the pages across the panel, the name and the facts under them, Open, where it came from, sent copies', async () => {
  const { ctx, page } = await open(1470, 832);
  const s0 = await st(page);
  // a copy under a parent with edits, a line only on it and its skills arranged, and a sent copy
  await page.evaluate(() => window.__wb.resumes.open(window.__wb.store.state.resumes[0].id));
  await page.evaluate(async () => {
    const RS = await import('/src/model/resumes.js'), T = await import('/src/model/resume.js'), b = window.__wb;
    let res; b.store.commit(d => { res = RS.duplicate(d, d.openId, { name: 'Child copy' }); }, 'dup');
    const model = b.store.materialize(b.store.state.record);
    b.store.commit(d => {
      const job = model.work[0], fact = job.highlights.find(h => d.cur.overrides?.[h] === undefined);
      T.setOverride(model, d.cur, fact, 'A sentence written only on this resume.', { marks: [], base: null });
      const id = T.addLocalLine(model, d.cur, job.id, null); T.setOverride(model, d.cur, id, 'A line that only this resume has.', { marks: [], base: null });
      const g = T.arrangementOf(model, d.cur).groups[0]; T.setGroupHeading(model, d.cur, g.id, 'Renamed group');
    }, 'edits');
    b.store.commit(d => { RS.takeSnapshot(d, { kind: 'company', company: 'Smoke Co', role: 'Role' }); }, 'send');
  });
  const kid = (await st(page)).openId;
  await goLibrary(page); await thumbsDone(page, 3); await settle(page);
  const g = await page.evaluate(() => {
    const R = e => e.getBoundingClientRect(), b = document.querySelector('#body'), hero = b.querySelector('.ihero'), br = R(b);
    return { heroW: R(hero).width, bodyW: br.width, heroLeft: R(hero).left - br.left, noScroll: b.scrollHeight <= b.clientHeight + 1, gone: !b.querySelector('.glance, .oi-diff, .imore, .ihcap'),
      primary: b.querySelector('.iacts .primary')?.textContent.trim(), keep: [...b.querySelectorAll('.iacts button')].map(x => x.textContent.trim()), more: !!b.querySelector('.iacts .rcmore .smore'),
      ovt: [...b.querySelectorAll('.ovw dt')].map(x => x.textContent), ov: Object.fromEntries([...b.querySelectorAll('.ovw dt')].map(x => [x.textContent, x.nextElementSibling.textContent.replace(/\s+/g, ' ').trim()])), actsFirst: !!b.querySelector('.ihero + .iacts + .ovw'),
      sentSum: b.querySelector('.idet[data-k=sent] summary')?.textContent.replace(/\s+/g, ' ').trim(), sent: [...b.querySelectorAll('.oi-sent li')].map(x => x.textContent.replace(/\s+/g, ' ').trim()) };
  });
  ok('the pages run across the panel\u2019s full width, edge to edge', Math.abs(g.heroW - g.bodyW) < 2 && Math.abs(g.heroLeft) < 2, `${g.heroW} of ${g.bodyW}`);
  ok('the buttons follow the pages on their own line, then the facts; no name line, At a glance or what differs (the card says those); the panel does not scroll', g.actsFirst && g.gone && g.noScroll);
  ok('Keep editing (the resume is open) is the primary action, with Use for a new job and the ⋯ menu', g.primary === 'Keep editing' && g.keep.includes('Use for a new job…') && g.more, g.keep.join(' | '));
  ok('the facts: last changed and where it came from; the sent copies fold under a line with the chip, to whom and when', g.ovt.filter(x => x !== 'Round').join() === 'Language,Last changed,From' && g.ov.Language === 'English' && /^Sent 1×\s*Smoke Co - Role · 20\d\d-\d\d-\d\d$/.test(g.sentSum ?? '') && /Example Instruments/.test(g.ov.From) && /^20\d\d-/.test(g.ov['Last changed']), JSON.stringify({ ov: g.ov, sentSum: g.sentSum }));
  ok('…company and role are no facts here, even when the name lacks them (the card shows them)', await (async () => { await page.evaluate(id => { const b = window.__wb; b.store.commit(d => { const r = d.resumes.find(x => x.id === id); r.name = 'My own name'; r.company = 'Acme'; r.role = 'Engineer'; }, 'name'); }, s0.ids[3]); await page.click(`#scr .rcard[data-rid="${s0.ids[3]}"] .rsel`); await settle(page); return page.evaluate(() => [...document.querySelectorAll('#body .ovw dt')].map(x => x.textContent).join()); })().then(x => !/Company|Role/.test(x)));
  ok('…a resume nobody sent has no sent fold (its card has no Sent chip either)', await (async () => { await page.click(`#scr .rcard[data-rid="${s0.ids[3]}"] .rsel`); await settle(page); return page.evaluate(() => !document.querySelector('#body .idet[data-k=sent]')); })());
  await page.click(`#scr .rcard[data-rid="${kid}"] .rsel`); await settle(page);
  ok('its sent copies are listed with their dates', g.sent.length === 1 && /Smoke Co/.test(g.sent[0]) && /20\d\d/.test(g.sent[0]), g.sent.join());
  await page.click('#body [data-act=scr-differs]'); await settle(page);
  ok('"Compare with it" opens Compare of the copy and its parent', await view(page) === 'compare' && (await page.$$('#compare thead th[scope=col]')).length === 3);      // the line's heading and the two resumes
  await page.keyboard.press('Escape'); await settle(page);
  // the row menu, from the inspector: Duplicate leaves the Library and opens the copy with its name ready
  await page.click('#body .iacts .smore'); await settle(page);
  ok('the ⋯ menu in the inspector has Duplicate, another language, Rename, Mark as sent… and Delete', (await page.$$('#body .rowmenu [role=menuitem]')).length === 5);
  await page.click('#body .rowmenu [data-act=rm-dup]'); await settle(page);
  const s1 = await st(page), f = await page.evaluate(() => { const a = document.activeElement; return { id: a?.id, all: a?.selectionStart === 0 && a?.selectionEnd === a?.value.length && a.value.length > 0 }; });
  ok('Duplicate opens the copy at once, under its parent, with the name field focused and its text selected', await view(page) === null && s1.parents[s1.openId] === kid && f.id === 'sw-rn' && f.all, JSON.stringify(f));
  await page.keyboard.press('Escape'); await settle(page);
  await goLibrary(page);
  await page.click('#body .iacts .smore'); await page.click('#body .rowmenu [data-act=rm-rename]'); await settle(page);
  ok('Rename is in place on the card', await page.isVisible('#scr .rcard .swren'));
  await page.fill('#scr .swren[data-f=company]', 'Renamed'); await page.fill('#scr .swren[data-f=role]', 'here'); await page.fill('#scr .swren[data-f=word]', ''); await page.keyboard.press('Enter'); await settle(page);
  ok('…and keeps what was typed', Object.values((await st(page)).names).includes('here, Renamed'));
  await ctx.close();
});

await part('Use for a new job: a company is required; Enter makes the copy under its parent, with the company and the role; what was typed is kept', async () => {
  const { ctx, page, errors } = await open(1470, 832);
  const s0 = await st(page), parent = s0.ids[1];
  await goLibrary(page);
  await page.click(`#scr .rcard[data-rid="${parent}"] .rsel`); await settle(page);
  await page.click('#body [data-act=nj-open]'); await settle(page);
  ok('the form asks for the company and the role in the inspector, the company focused; the role starts as the resume\u2019s own', await page.evaluate(() => document.activeElement?.id) === 'nj-company' && await page.isVisible('#body #nj-role') && (await page.inputValue('#nj-role')).length > 3);
  await page.fill('#nj-role', 'Lead Engineer'); await page.click('#body [data-act=nj-create]'); await settle(page);
  ok('without a company nothing is made, the focus goes to the company and the role stays', (await st(page)).ids.length === s0.ids.length && await view(page) === 'resumes' && await page.evaluate(() => document.activeElement?.id) === 'nj-company' && await page.inputValue('#nj-role') === 'Lead Engineer');
  await page.fill('#nj-company', 'Contoso Labs');
  // leaving the place and coming back keeps what was typed
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('e'); await settle(page); await page.keyboard.press('w'); await settle(page);
  ok('what was typed survives leaving the Library and coming back (company and role)', await page.inputValue('#nj-company') === 'Contoso Labs' && await page.inputValue('#nj-role') === 'Lead Engineer');
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes the form (Esc never changes place) and the text is still there when it is opened again', await view(page) === 'resumes' && !(await page.$('#nj-company')) && (await page.click('#body [data-act=nj-open]'), await settle(page), await page.inputValue('#nj-company')) === 'Contoso Labs');
  await page.focus('#nj-role'); await page.keyboard.press('Enter'); await settle(page, 600);
  const s1 = await st(page), r = await page.evaluate(() => { const s = window.__wb.store.state, c = s.resumes.find(x => x.id === s.openId); return { company: c.company, role: c.role, name: c.name, keys: Object.keys(c).sort().join() }; });
  ok('Enter makes the copy under its parent and opens it in the editor, with the company and the role in the fields a resume has', await view(page) === null && s1.ids.length === s0.ids.length + 1 && s1.parents[s1.openId] === parent && r.company === 'Contoso Labs' && r.role === 'Lead Engineer' && r.name === 'Lead Engineer, Contoso Labs', JSON.stringify(r));
  // the copy says what it came from: under its name in the name card, on its card, and it is the selected card
  const nm = await page.evaluate(() => ({ own: document.querySelector('#docname')?.textContent.replace(/\s+/g, ' ').trim(), from: document.querySelector('#head .dfrom')?.textContent }));
  await goLibrary(page);
  const lib = await page.evaluate(() => { const c = document.querySelector('#scr .rcard.sel'); return { id: c?.dataset.rid, from: c?.querySelector('.rfrom')?.textContent }; });
  const parentName = await page.evaluate(async id => (await import('/src/model/resumes.js')).resumeLabel(window.__wb.store.state.resumes.find(x => x.id === id)), parent);
  ok('after the copy the name card has its own name and "from <parent>", and the Library has the copy selected with "from <parent>" on its card', nm.own === 'Lead Engineer, Contoso Labs' && nm.from === `from ${parentName}` && lib.id === s1.openId && lib.from === `from ${parentName}`, JSON.stringify({ nm, lib }));
  ok('…and its form is empty next time (the draft went with the copy)', (await goLibrary(page), await page.click(`#scr .rcard[data-rid="${parent}"] .rsel`), await page.click('#body [data-act=nj-open]'), await settle(page), await page.inputValue('#nj-company')) === '');
  ok('no errors', errors.length === 0, errors[0] ?? '');
  await ctx.close();
});

await part('a phone: the name card of a copy says "from <parent>" under its name, as the desktop card does', async () => {
  const { ctx, page, errors } = await open(390, 844);
  const s0 = await st(page), parent = s0.ids[1];
  const own = await page.evaluate(() => document.querySelector('#head .dfrom')?.textContent ?? null);
  await page.evaluate(async id => { const RS = await import('/src/model/resumes.js'); window.__wb.store.commit(d => { RS.duplicate(d, id); }, 'copy'); }, parent);
  await settle(page);
  const nm = await page.evaluate(() => { const f = document.querySelector('#head .dfrom'), b = document.querySelector('#docname-btn'); return { from: f?.textContent, inBtn: !!f && b.contains(f), fits: !!f && f.scrollWidth <= f.clientWidth + 1 || !!f && getComputedStyle(f).textOverflow === 'ellipsis' }; });
  const parentName = await page.evaluate(async id => (await import('/src/model/resumes.js')).resumeLabel(window.__wb.store.state.resumes.find(x => x.id === id)), parent);
  ok('the phone\u2019s name card shows "from <parent>" for a copy (and nothing for a resume with no parent), inside the name button, cut with an ellipsis if long', own === null && nm.from === `from ${parentName}` && nm.inBtn && nm.fits, JSON.stringify(nm));
  ok('no errors', errors.length === 0, errors[0] ?? '');
  await ctx.close();
});

await part('the inspector\u2019s pages: every page, scrolled in place; the wheel over them and a click on them never open the resume', async () => {
  const { ctx, page, errors } = await open(1470, 832, ['tea', 'light'], { motion: true });
  const s0 = await st(page);
  await goLibrary(page);
  await page.click(`#scr .rcard[data-rid="${MEDTECH}"] .rsel`); await settle(page);
  await page.waitForFunction(() => document.querySelectorAll('#body .ihero [data-thumb] iframe').length === 2, null, { timeout: 20000 });
  const hero = await page.locator('#body .ihero').boundingBox();
  ok('a resume of two pages shows both, one under the other, taller than the panel shows', await page.evaluate(() => { const h = document.querySelector('#body .ihero'), f = [...h.querySelectorAll('iframe')].map(x => x.getBoundingClientRect()); return f[1].top >= f[0].bottom - 1 && h.scrollHeight > h.clientHeight + 40; }));
  await page.mouse.move(hero.x + 100, hero.y + 100);
  for (let i = 0; i < 4; i++){ await page.mouse.wheel(0, 250); await page.waitForTimeout(80); }
  await settle(page, 500);
  const w = await page.evaluate(() => ({ top: document.querySelector('#body .ihero').scrollTop, view: window.__wb.ui.view, open: window.__wb.store.state.openId }));
  ok('the wheel over them scrolls them, and nothing opens', w.top > 100 && w.view === 'resumes' && w.open === s0.openId && w.open !== MEDTECH, JSON.stringify(w));
  await page.click('#body .ihero'); await settle(page, 500);
  ok('a click on them opens nothing either', await view(page) === 'resumes' && (await st(page)).openId === s0.openId);
  await page.dblclick(`#scr .rcard[data-rid="${MEDTECH}"] .thumbwrap`); await settle(page, 500);
  ok('a double click on the card opens it', await view(page) === null && (await st(page)).openId === MEDTECH);
  ok('no errors', errors.length === 0, errors[0] ?? '');
  await ctx.close();
});

await part('the hover preview: a readable page beside the card after a rest; the wheel turns its pages; it goes when the pointer leaves or anything is clicked', async () => {
  const { ctx, page } = await open(1470, 832, ['tea', 'light'], { motion: true });
  const s0 = await st(page);
  await goLibrary(page); await thumbsDone(page, await items(page));
  const w1 = `#scr .rcard[data-rid="${MEDTECH}"] .thumbwrap`;
  await page.locator(w1).scrollIntoViewIfNeeded();
  await page.hover(w1); await page.waitForTimeout(150);
  ok('it does not show at once', !(await page.$('.hoverprev')));
  await page.waitForTimeout(450);
  const p = await page.evaluate(() => { const e = document.querySelector('.hoverprev'); if (!e) return null; const r = e.getBoundingClientRect(); return { h: r.height, w: r.width, vh: innerHeight, left: r.left, right: r.right, rail: document.querySelector('#rail').getBoundingClientRect().left, page: e.querySelector('.hppage')?.textContent, text: e.querySelector('iframe')?.contentDocument?.body.innerText.length ?? 0 }; });
  ok('after about a third of a second it shows the first page, as tall as the window and large enough to read', !!p && p.h >= p.vh - 40 && p.w > 380 && p.left >= 0 && p.right <= p.rail, JSON.stringify(p));
  ok('a resume of two pages says "1 / 2"', p?.page === '1 / 2');
  await page.mouse.wheel(0, 120); await page.waitForTimeout(400);
  ok('scrolling over the picture turns to page 2 ("2 / 2")', await page.evaluate(() => document.querySelector('.hppage')?.textContent) === '2 / 2');
  await page.mouse.wheel(0, -120); await page.waitForTimeout(300);
  ok('…and back to page 1', await page.evaluate(() => document.querySelector('.hppage')?.textContent) === '1 / 2');
  await page.mouse.move(5, 400); await page.waitForTimeout(150);
  ok('it goes when the pointer leaves', !(await page.$('.hoverprev')));
  await page.hover(w1); await page.waitForTimeout(700);
  await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(100);
  ok('…and when anything is clicked', !(await page.$('.hoverprev')));
  await ctx.close();
});

await part('Compare of three (one a sent copy): back and Esc keep the ticks; Previous, Next, N and P step the rows that differ, and the inspector shows the row', async () => {
  const { ctx, page } = await open(1470, 832);
  await page.evaluate(async () => { const RS = await import('/src/model/resumes.js'); window.__wb.store.commit(d => { RS.takeSnapshot(d, { kind: 'company', company: 'Smoke Co', role: 'Role' }); }, 'send'); });
  const s0 = await st(page);
  await goLibrary(page);
  ok('Compare is not offered until two are ticked', !(await page.$('#scr-cmp')) && (await page.check(`#scr .rcard[data-rid="${s0.ids[1]}"] .rtick`), !(await page.$('#scr-cmp'))));
  const bar = () => page.evaluate(() => { const b = document.querySelector('#scr-ticks'), c = b?.querySelector('[data-act=scr-compare]'); return { shown: !!c && b.getBoundingClientRect().height > 0, tier: c?.dataset.tier, clear: !!b?.querySelector('[data-act=scr-clear]'), floats: !b?.closest('.tbar'),
    primaries: [...document.querySelectorAll('#scr [data-tier=primary], #scr button.primary')].filter(x => x.offsetParent).map(x => x.dataset.act).join(), open: document.querySelector('#body .iopen')?.dataset.tier }; });
  const b1 = await bar();
  await page.check(`#scr .rcard[data-rid="${s0.ids[2]}"] .rtick`);
  const b2 = await bar();
  ok('two ticked: Compare (a secondary) and Clear float at the list\u2019s foot, out of the header; the list\u2019s one primary stays New resume; with one ticked there is no Compare and the inspector\u2019s Open is the primary', !b1.shown && b1.clear && b1.floats && b1.primaries === 'sw-new' && b1.open === 'primary' && b2.shown && b2.tier === 'secondary' && b2.clear && b2.primaries === 'sw-new' && b2.open === 'secondary', JSON.stringify({ b1, b2 }));
  await page.check(`#scr .rcard[data-rid="${s0.ids[0]}"] .rtick`);
  ok('three ticks turn Compare on: "Compare 3"', !(await page.isDisabled('#scr-cmp')) && /Compare 3/.test(await page.textContent('#scr-cmp')));
  await page.click('#scr-cmp'); await settle(page);
  const cmp = await page.evaluate(() => { const t = document.querySelector('table.cmp'); return { view: window.__wb.ui.view, cols: t.querySelectorAll('thead th[scope=col]').length, rows: t.querySelectorAll('tbody tr').length, rowHeads: t.querySelectorAll('tbody th[scope=row]').length, cap: !!t.querySelector('caption'), diff: t.querySelectorAll('tr.diff-row').length, place: document.querySelector('#head').textContent, labels: [...t.querySelectorAll('tbody th[scope=row]')].map(x => x.textContent.trim()) }; });
  ok('Compare shows the three side by side, a mode of the Library: a column each, real headers, a caption, rows that differ marked', cmp.view === 'compare' && cmp.cols === 4 && cmp.rowHeads === cmp.rows && cmp.cap && cmp.diff > 3, JSON.stringify({ ...cmp, labels: null }));
  ok('…the place card says Compare with the count and the rows that differ; the tab is still the Library', /Compare/.test(cmp.place) && /3 resumes/.test(cmp.place) && await page.getAttribute('#ptabs [data-p=library]', 'aria-current') === 'page');
  ok('…with the job order, the skills, the photo, the paper and the pages', ['Job order', 'Skills', 'Photo', 'Paper', 'Pages'].every(l => cmp.labels.includes(l)));
  ok('the inspector asks for a row until one is picked', /Pick a row/.test(await page.textContent('#body')));
  await page.keyboard.press('n'); await settle(page, 400);
  const r1 = await page.evaluate(() => ({ here: document.querySelector('#compare tr.is-here')?.className, th: document.querySelector('#compare tr.is-here th')?.textContent, lbl: document.querySelector('#body .insp .lbl')?.textContent, cells: document.querySelectorAll('#body .cmpcells dt').length, name: document.querySelector('#body .oi-name')?.textContent }));
  ok('N steps to the first row that differs: it is marked, and the inspector shows it, with what each of the three prints', /diff-row/.test(r1.here ?? '') && /^Row 1 of \d+ that differ/.test(r1.lbl ?? '') && r1.cells === 3 && r1.name === r1.th, JSON.stringify(r1));
  await page.keyboard.press('n'); await settle(page, 400); await page.keyboard.press('n'); await settle(page, 400);
  const r3 = await page.textContent('#body .insp .lbl');
  await page.keyboard.press('p'); await settle(page, 400);
  const r2 = await page.textContent('#body .insp .lbl');
  ok('N steps on and P steps back', /^Row 3 of/.test(r3) && /^Row 2 of/.test(r2), `${r3} / ${r2}`);
  await page.click('#compare [data-act=cmp-next]'); await settle(page, 400);
  ok('Next difference and Previous in the toolbar do the same', /^Row 3 of/.test(await page.textContent('#body .insp .lbl')) && (await page.click('#compare [data-act=cmp-prev]'), await settle(page, 400), /^Row 2 of/.test(await page.textContent('#body .insp .lbl'))));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc goes back to the grid with the three ticks kept (and does not change place)', await view(page) === 'resumes' && (await page.$$('#scr .rtick:checked')).length === 3 && await page.getAttribute('#ptabs [data-p=library]', 'aria-current') === 'page');
  await page.click('#scr-cmp'); await settle(page); await page.click('#compare [data-act=scr-back]'); await settle(page);
  ok('"← All resumes" does the same: the ticks are kept', await view(page) === 'resumes' && (await page.$$('#scr .rtick:checked')).length === 3);
  await page.click('[data-act=scr-clear]');
  ok('Clear ticks clears them', (await page.$$('#scr .rtick:checked')).length === 0 && !(await page.$('#scr-cmp')));
  // a sent copy in the inspector can be ticked too
  ok('a sent copy has its own tick in the inspector, named for its resume, and compares', await page.evaluate(() => !!document.querySelector('#body .oi-sent .rtick')?.getAttribute('aria-label')) && (await page.click('#body .idet[data-k=sent] summary'), await page.check('#body .oi-sent .rtick'), await page.check(`#scr .rcard[data-rid="${s0.ids[1]}"] .rtick`), await page.click('#scr-cmp'), await settle(page), (await page.$$('#compare thead th[scope=col]')).length === 3));
  await ctx.close();
});

await part('Mark as sent… from the Library: in the inspector’s ⋯ menu, the same dialog as Export\u2019s, and the Library again when it is done', async () => {
  const { ctx, page, errors } = await open(1470, 832);
  const s0 = await st(page), other = s0.ids[2];
  await goLibrary(page);
  await page.click(`#scr .rcard[data-rid="${other}"] .rsel`); await settle(page);
  const sentCount = id => page.evaluate(id => (window.__wb.store.state.resumes.find(r => r.id === id).snapshots ?? []).length, other);
  ok('the inspector\u2019s ⋯ menu (the card\u2019s menu on a phone) has Mark as sent…', (await page.click('#body .iacts .smore'), await page.isVisible('.rowmenu [data-act=rm-sent]')));
  await page.keyboard.press('Escape'); await settle(page);
  await page.click('#body .iacts .smore'); await page.click('.rowmenu [data-act=rm-sent]'); await settle(page, 500);
  const d = await page.evaluate(() => ({ view: window.__wb.ui.view, open: window.__wb.store.state.openId, co: !!document.querySelector('#sv-co'), date: !!document.querySelector('#sv-date'), prim: document.querySelector('#body [data-act=sv-do]')?.dataset.tier, sec: document.querySelector('#body [data-act=sent-back]')?.dataset.tier }));
  ok('from the ⋯ menu: Export\u2019s own dialog (Sent to?) for that resume, which is opened, with its confirm as the primary and Cancel as tertiary words (one Cancel)', d.view === 'sent' && d.open === other && d.co && d.date && d.prim === 'primary' && d.sec === 'tertiary', JSON.stringify(d));
  await page.click('[data-act=sent-back]'); await settle(page);
  ok('Cancel goes back to the Library, nothing sent', await view(page) === 'resumes' && await sentCount() === 0);
  await page.click('#body .iacts .smore'); await page.click('.rowmenu [data-act=rm-sent]'); await settle(page, 400);
  await page.fill('#sv-co', 'Northgate Dosing'); await page.fill('#sv-role', 'Mechanical Design Engineer'); await page.click('[data-act=sv-do]'); await settle(page, 600);
  const e = await page.evaluate(() => ({ view: window.__wb.ui.view, sel: document.querySelector('#scr .rcard.sel')?.dataset.rid, badge: document.querySelector('#scr .rcard.sel .pill:not(.is-open)')?.textContent, list: document.querySelector('#body .oi-sent')?.textContent.replace(/\s+/g, ' ') }));
  ok('Mark as sent keeps a copy and returns to the Library with that resume selected, its card badged and the inspector listing the send', await view(page) === 'resumes' && await sentCount() === 1 && e.sel === other && /Sent 1|1× elküldve/.test(e.badge ?? '') && /Northgate Dosing/.test(e.list ?? ''), JSON.stringify(e));
  ok('no errors', errors.length === 0, errors[0] ?? '');
  await ctx.close();
});

await part('the Library\u2019s toolbar: its groups, tiers and selection line; search finds a send\u2019s company, the views, Sent only, the row menu; Esc clears the search first', async () => {
  const { ctx, page } = await open(1470, 832);
  await page.evaluate(async () => { const RS = await import('/src/model/resumes.js'); window.__wb.store.commit(d => { RS.takeSnapshot(d, { kind: 'company', company: 'Smoke Co', role: 'Role' }); }, 'send'); });
  await goLibrary(page);
  const distinct = () => page.$$eval('#scr .rcard', r => new Set(r.map(x => x.dataset.rid)).size);      // the Company view lists a resume under each company it was sent to
  const all = await distinct();
  const hd = await page.evaluate(() => {
    const tb = document.querySelector('#resumes .tbar'), kids = [...tb.children], bar = tb.querySelector('.lbar'), sw = [...bar.querySelectorAll('.lswitch button')];
    const tier = sel => { const b = tb.querySelector(sel); return b ? [b.dataset.tier, !!b.querySelector('svg'), b.hasAttribute('data-icon')].join() : null; };
    const ctl = [...tb.querySelectorAll('.sw-q, button:not(.newres), .ddbtn, .lswitch, .lctl')].filter(e => e.getClientRects().length && !e.closest('.lswitch button, .lctl .ddbtn')), cs = e => getComputedStyle(e);
    return { kids: kids.map(e => e.id || e.className.split(' ')[0]).join(), acts: [...tb.querySelectorAll(':scope > .tgrp button')].map(b => b.dataset.act).join(),
      add: tier('[data-act=goto][data-v=import]'), round: tier('[data-act=round-new]'), nr: tier('[data-act=sw-new]'), nrh: Math.round(tb.querySelector('[data-act=sw-new]').getBoundingClientRect().height), filtersOwnRow: tb.querySelector('.lctl').getBoundingClientRect().top >= tb.querySelector('.sw-q').getBoundingClientRect().bottom, tabTop: Math.round(document.querySelector('.wsheets > .wtab').getBoundingClientRect().top) === Math.round(tb.querySelector('[data-act=sw-new]').getBoundingClientRect().top), dds: [...bar.querySelectorAll('select[data-named]')].map(x => `${x.id}=${x._dd?.textContent.trim()}`).join(),
      sw: sw.map(b => [b.dataset.act, b.getAttribute('aria-pressed'), !!b.querySelector('svg'), !!b.title && b.title === b.getAttribute('aria-label')].join(':')).join(),
      hint: !!bar.querySelector('#scr-hint > #scr-tickinfo'), chips: tb.querySelectorAll('.fchip, .seg [data-act=scr-view]').length, under: !!document.querySelector('#scr-bar, #resumes .cmpbar'),
      one: ['height', 'fontSize'].map(p => new Set(ctl.map(e => cs(e)[p])).size).join() };
  });
  ok('the header, one row while there is room: the search, Group and Show (the app\u2019s dropdowns, named, in one box), the cards/list switch (icons with names), then New round, Add files and New resume; Content and Look start on its buttons\u2019 top; no chips, no bar under the cards', hd.kids === 'scr-q,tgrp,scr-lbar' && hd.acts === 'round-new,goto,sw-new' && !hd.filtersOwnRow && hd.tabTop && hd.dds === 'scr-group=Group: Date,scr-show=Show: All' && hd.sw === 'scr-cards:true:true:true,scr-list:false:true:true' && hd.hint && !hd.chips && !hd.under, JSON.stringify(hd));
  ok('…New resume the 32 px primary, Add files a secondary and New round tertiary words, each with its icon; one height and one font size for every other control in the header', hd.nr === 'primary,true,false' && hd.nrh === 32 && hd.add === 'secondary,true,false' && hd.round === 'tertiary,true,false' && hd.one === '1,1', JSON.stringify(hd));
  await page.setViewportSize({ width: 1150, height: 832 }); await settle(page, 300);
  ok('…with less room it is the two rows again: Group, Show and the switch under the search', await page.evaluate(() => { const tb = document.querySelector('#resumes .tbar'); return tb.querySelector('.lctl').getBoundingClientRect().top >= tb.querySelector('.sw-q').getBoundingClientRect().bottom; }));
  await page.setViewportSize({ width: 1470, height: 832 }); await settle(page, 300);
  await page.check('#scr .rcard .rtick >> nth=0'); await page.check('#scr .rcard .rtick >> nth=1'); await settle(page, 100);
  const line = await page.evaluate(() => ({ kids: [...document.querySelectorAll('#resumes > #scr-ticks > *')].map(e => e.dataset.act ?? e.id).join(), hint: !!document.querySelector('#scr-tickinfo'), pos: getComputedStyle(document.querySelector('#scr-ticks')).position }));
  ok('two ticked: the floating bar at the list\u2019s foot says "2 ticked", then Compare and Clear (no rounds: no Move to round…); the hint has gone', line.kids === 'scr-nticked,scr-compare,scr-clear' && !line.hint && line.pos === 'absolute' && /^2 ticked$/.test((await page.textContent('#scr-nticked')).trim()), JSON.stringify(line));
  await page.click('#scr-ticks [data-act=scr-clear]'); await settle(page);
  await pickOption(page, '#scr-show', 'sent'); await settle(page);
  ok('Show: Sent only lists the resumes that have sends', (await distinct()) === 1 && await page.$eval('#scr-show', x => x.value) === 'sent');
  await pickOption(page, '#scr-show', 'all'); await settle(page);
  await pickOption(page, '#scr-group', 'company'); await settle(page);
  await page.fill('#scr-q', 'smoke co'); await settle(page);
  ok('search finds a send\u2019s company: only the resume that went to Smoke Co', (await distinct()) === 1);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc clears the search first', await page.inputValue('#scr-q') === '' && (await distinct()) === all && await view(page) === 'resumes');
  await pickOption(page, '#scr-group', 'role'); await settle(page);
  ok('the Role view groups by the role as typed, each group a heading', (await page.$$('#scr h3.lbl')).length >= 2 && await page.evaluate(() => localStorage.getItem('rb-manage-view')) === 'role');
  await pickOption(page, '#scr-group', 'date'); await settle(page);
  ok('the Date view: a round\u2019s resumes by date with no year headings inside it (the round says when), and the view is remembered', !(await page.$('#scr .rround h3.lbl')) && await page.$eval('#scr-group', x => x.value) === 'date' && await page.evaluate(() => localStorage.getItem('rb-manage-view')) === 'date');
  await pickOption(page, '#scr-group', 'role'); await settle(page);
  await ctx.close();
});

await part('the sidebar’s card: what it names and Export takes (ticks win, else the open resume; the inspector names the selected one), the deck, the inspector’s strip', async () => {
  const { ctx, page, errors } = await open(1470, 832);
  const s0 = await st(page), ids = s0.ids.filter(id => id !== s0.openId), L = await page.evaluate(async () => { const RS = await import('/src/model/resumes.js'); return Object.fromEntries(window.__wb.store.state.resumes.map(r => [r.id, RS.resumeLabel(r)])); }), lbl = id => L[id];
  const card = () => page.evaluate(() => { const h = document.querySelector('#head'), x = h.querySelector('.hstub'), d = h.querySelector('.hdeck'), hr = h.getBoundingClientRect(), xr = x.getBoundingClientRect();
    return { tag: h.querySelector('.htagl')?.textContent, name: h.querySelector('.hmain .docname')?.textContent.replace(/\s+/g, ' ').trim(), note: h.querySelector('.dnote')?.textContent ?? '', deck: [...(d?.querySelectorAll('li:not(.hmore)') ?? [])].map(l => (l.classList.contains('is-insp') ? '>' : '') + l.textContent.replace(/\s+/g, ' ').trim()),
      more: h.querySelector('.hmorebtn')?.textContent ?? '', layers: h.dataset.layers, stub: x.textContent.replace(/\s+/g, ' ').trim(), foot: Math.abs(xr.width - hr.width + 14) < 3 && (!d || xr.top >= d.getBoundingClientRect().bottom - 1), side: Math.abs(hr.right - xr.right - 7) <= 1.5 && Math.abs(xr.top - hr.top - 7) <= 1.5,      // the stub is inset 7 px
      strip: [...(document.querySelector('#istrip:not([hidden])')?.children ?? [])].map(e => e.textContent.trim()).join(' ') }; });
  const xp = () => page.evaluate(() => ({ view: window.__wb.ui.view, ids: window.__wb.ui.xp?.ids, from: window.__wb.ui.xp?.from }));
  const flat = n => String(n).replace(/\s+/g, ' ').trim();
  let c = await card();
  ok('the editor: no tag, the open resume\u2019s name, Export a button inset at the card’s right end', !c.tag && c.side && /^Export$/.test(c.stub), JSON.stringify(c));
  await page.click('#head .hstub'); await settle(page, 500);
  let x = await xp();
  ok('…Export opens the Export place for the open resume, back to the editor', x.view === 'export' && x.ids?.join() === s0.openId && x.from === null, JSON.stringify(x));
  await page.evaluate(() => window.__wb.setView(null)); await settle(page);
  await goLibrary(page);
  c = await card();
  ok('the Library, nothing selected or ticked: the open resume, no Library counts and no New resume in the card', !c.tag && !c.note && !(await page.$('#head [data-act=sw-new], #head .psub')), JSON.stringify(c));
  await page.click(`#scr .rcard[data-rid="${ids[1]}"] .rsel`); await settle(page);
  c = await card();
  const it = await page.evaluate(() => document.querySelector('#body .insp-res .ititle')?.textContent.trim());
  ok('a selected resume: the card still names the open one, with no tag; the inspector names the selected one at its top', !c.tag && flat(c.name) === flat(lbl(s0.openId)) && !c.note && !c.strip && flat(it) === flat(lbl(ids[1])), JSON.stringify({ ...c, it }));
  await page.check(`#scr .rcard[data-rid="${ids[2]}"] .rtick`); await settle(page);
  c = await card();
  ok('a tick wins over the selection: "1 ticked in the Library" names the ticked one; the inspector (still the selected one) says it is not in the export', c.tag === '1 ticked in the Library' && flat(c.name) === flat(lbl(ids[2])) && c.strip === 'Not in the export · Export takes the 1 ticked Add to export', JSON.stringify(c));
  await page.click('#istrip [data-act=scr-tick]'); await settle(page);
  c = await card();
  ok('"Add to export" ticks the inspector’s resume: two ticked are a deck of two rows over one sheet, the inspector’s marked; Export a bar inset along the foot, "Export 2"', c.tag === '2 ticked in the Library' && c.deck.join('|') === `${flat(lbl(ids[2]))}|>${flat(lbl(ids[1]))}` && c.layers === '1' && c.foot && c.stub === 'Export 2' && c.strip === '✓ In the export · 2 of 2 Take out', JSON.stringify(c));
  ok('…its card is ticked too', await page.isChecked(`#scr .rcard[data-rid="${ids[1]}"] .rtick`));
  for (const id of ids.slice(3, 5)) await page.check(`#scr .rcard[data-rid="${id}"] .rtick`);
  await settle(page);
  c = await card();
  ok('four ticked: two sheets behind, every name its own row, open by default with "Fold to two"', c.tag === '4 ticked in the Library' && c.deck.length === 4 && c.layers === '2' && /^Fold to two/.test(c.more), JSON.stringify(c));
  await page.click('#head .hmorebtn'); await settle(page);
  c = await card();
  ok('…folded: the first two and "+2 more · show all", which opens it again', c.deck.length === 2 && /^\+2 more · show all/.test(c.more) && (await page.click('#head .hmorebtn'), await settle(page), (await card()).deck.length === 4), JSON.stringify(c));
  await page.click('#head .hstub'); await settle(page, 500);
  x = await xp();
  ok('Export takes the four ticked, in the order they were ticked, back to the Library', x.view === 'export' && x.ids?.join() === [ids[2], ids[1], ids[3], ids[4]].join() && x.from === 'resumes', JSON.stringify(x));
  await page.evaluate(() => window.__wb.setView('resumes')); await settle(page);
  await page.click('#istrip [data-act=scr-tick]'); await settle(page);
  ok('"Take out" unticks the inspector’s resume', (await card()).tag === '3 ticked in the Library' && !(await page.isChecked(`#scr .rcard[data-rid="${ids[1]}"] .rtick`)));
  ok('no page errors', !errors.length, errors.join(' | '));
  await ctx.close();
});

await part('the Library\u2019s search finds a resume by the lines it prints (DFM, inhaler), shows the line with the word marked, and keeps the selected resume in the results', async () => {
  const { ctx, page } = await open(1470, 832);
  await goLibrary(page);
  const names = () => page.$$eval('#scr .rcard', r => r.map(x => x.querySelector('.rname')?.textContent.trim() ?? ''));
  const hit = () => page.$$eval('#scr .rcard .rhit mark.fnd', m => m.map(x => x.textContent.toLowerCase()));
  await page.fill('#scr-q', 'DFM'); await settle(page);
  const dfm = await names();
  ok('DFM lists the resumes that print a line with DFM in it (their names have no DFM)', dfm.length >= 5 && dfm.some(n => /Ferro Tools/.test(n)) && dfm.some(n => /Medtech/.test(n)) && !dfm.some(n => /DFM/.test(n)), dfm.join(' | '));
  ok('each shows the matching line with the word marked', dfm.length > 0 && (await hit()).length === dfm.length && (await hit()).every(x => x === 'dfm'), (await hit()).join());
  await page.fill('#scr-q', 'inhaler'); await settle(page);
  const inh = await names();
  ok('inhaler lists the resumes that print it', inh.some(n => /Ferro Tools/.test(n)) && inh.some(n => /Example Instruments/.test(n)), inh.join(' | '));
  await page.fill('#scr-q', ''); await settle(page);
  await page.click('#scr .rcard:has-text("Medtech") .rsel'); await settle(page);
  await page.fill('#scr-q', 'zzz-nothing'); await settle(page);
  const left = await page.$$eval('#scr .rcard', r => r.map(x => [x.querySelector('.rname')?.textContent.trim(), x.classList.contains('sel')]));
  ok('a search nothing matches leaves the selected resume in the results', left.length === 1 && /Medtech/.test(left[0][0]) && left[0][1], JSON.stringify(left));
  await page.fill('#scr-q', ''); await settle(page);
  await page.check('#scr .rcard:has-text("Helix") .rtick'); await page.fill('#scr-q', 'Feinmess'); await settle(page);
  const tk = await names();
  ok('a resume ticked for Compare stays in the results when the search moves on, so the second one can be ticked beside it', tk.some(n => /Helix/.test(n)) && tk.some(n => /Feinmess/.test(n)), tk.join(' | '));
  await page.fill('#scr-q', ''); await settle(page);
  await ctx.close();
});

await part('the list view: rows with the columns, files folded under their resume, select and open, the keys, ticks, search, rounds and carrying, remembered', async () => {
  const { ctx, page, errors } = await open(1470, 832);
  const s0 = await st(page);
  await page.evaluate(async id => {
    const RS = await import('/src/model/resumes.js'), DOC = await import('/src/model/documents.js');
    window.__wb.store.commit(d => {
      RS.takeSnapshot(d, { kind: 'company', company: 'Smoke Co', role: 'Role' });
      DOC.addDocument(d, { name: 'attached.txt', type: 'text/plain', sha256: 'a'.repeat(64), size: 10, meta: { kind: 'resume', company: 'Attachco', role: 'Rolea' }, text: 'attached line' }).resume = id;
      DOC.addDocument(d, { name: 'free.txt', type: 'text/plain', sha256: 'b'.repeat(64), size: 10, meta: { kind: 'resume', company: 'Freeco', role: 'Roleb' }, text: 'free line' });
    }, 'seed');
  }, s0.ids[1]);
  await goLibrary(page);
  await page.click('[data-act=scr-list]'); await settle(page);
  const L = await page.evaluate(async ([ids, rid]) => {
    const list = document.querySelector('#scr-list'), att = list.querySelector(`tr.rsub.rdoc[data-did][data-parent="${CSS.escape(rid)}"]`), DOC = await import('/src/model/documents.js'), s = window.__wb.store.state;
    const shown = ids.filter(id => !DOC.hidden(s, s.resumes.find(r => r.id === id)));      // a language copy is its original's row, or a row under it
    return { pressed: document.querySelector('[data-act=scr-list]').getAttribute('aria-pressed'), cards: list.querySelectorAll('.rcard').length, rows: shown.every(id => list.querySelectorAll(`tr.rline[data-rid="${CSS.escape(id)}"], tr[data-lid="${CSS.escape(id)}"]`).length >= 1),
      th: list.querySelector('table.rtable thead tr')?.children.length, tables: list.querySelectorAll('table').length, heads: list.querySelectorAll('thead').length, groups: list.querySelectorAll('tbody.rgroup > tr.rghead:first-child').length, thumbs: list.querySelectorAll('[data-thumb]').length, attHidden: !!att?.hidden, attParent: att?.dataset.parent === rid, free: list.querySelectorAll('tr.rdoc:not(.rsub):not([data-parent])').length };
  }, [s0.ids, s0.ids[1]]);
  ok('the list switch shows one table: one column header (the tick, name, paper, language, pages, sent, last changed), each group a header row in it, a row for each resume, no pictures', L.pressed === 'true' && L.cards === 0 && L.rows && L.th === 7 && L.tables === 1 && L.heads === 1 && L.groups >= 2 && L.thumbs === 0, JSON.stringify(L));
  ok('a file exported from a resume is folded under its row; a file of its own has a row of its own', L.attHidden && L.attParent && L.free === 1, JSON.stringify(L));
  const fold = `#scr tr.rline[data-rid="${s0.ids[1]}"] .rfold`;
  await page.click(fold); await settle(page, 100);
  ok('the fold arrow shows it and says so', await page.getAttribute(fold, 'aria-expanded') === 'true' && await page.isVisible('#scr tr.rsub.rdoc[data-did]'));
  await page.click(`#scr tr.rline[data-rid="${s0.ids[2]}"] td.c-name`); await settle(page);
  const sel = await page.evaluate(id => ({ sel: document.querySelector('#scr tr.rline.sel')?.dataset.rid, insp: document.querySelector('#body .insp-res')?.getAttribute('aria-label'), name: document.querySelector(`#scr tr.rline[data-rid="${CSS.escape(id)}"] .rsel`)?.textContent.trim() }), s0.ids[2]);
  ok('a click on a row selects it and the inspector shows it', sel.sel === s0.ids[2] && /—/.test(sel.insp ?? '') && await view(page) === 'resumes', JSON.stringify(sel));
  await page.dblclick(`#scr tr.rline[data-rid="${s0.ids[3]}"] td.c-name`); await settle(page, 500);
  ok('a double click on a row opens it', await view(page) === null && (await st(page)).openId === s0.ids[3]);
  await goLibrary(page);
  await page.focus(`#scr tr.rline[data-rid="${s0.ids[2]}"] .rsel`);
  const next = await page.evaluate(() => { const all = [...document.querySelectorAll('#scr-list .rtable tr:not([hidden]) .rsel')].filter(b => b.getClientRects().length); return all[all.indexOf(document.activeElement) + 1]?.closest('tr').dataset.rid; });
  await page.keyboard.press('ArrowDown');
  await settle(page);
  ok('ArrowDown moves to the next row and selects it, opening nothing', !!next && await page.evaluate(() => document.activeElement?.closest('tr')?.dataset.rid) === next && await page.evaluate(() => document.querySelector('#scr tr.rline.sel')?.dataset.rid) === next && await view(page) === 'resumes', next);
  await page.keyboard.press('Enter'); await settle(page, 500);
  ok('Enter opens it', await view(page) === null && (await st(page)).openId === next);
  await goLibrary(page);
  await page.check(`#scr tr.rline[data-rid="${s0.ids[1]}"] .rtick`); await page.check(`#scr tr.rline[data-rid="${s0.ids[2]}"] .rtick`); await settle(page, 100);
  ok('ticking two rows offers Compare in the floating bar and marks the rows', !!(await page.$('#resumes > #scr-ticks #scr-cmp')) && (await page.$$('#scr tr.rline.ticked')).length === 2);
  await page.click('#scr-ticks [data-act=scr-clear]'); await settle(page);
  await page.fill('#scr-q', 'DFM'); await settle(page);
  ok('a search marks the word in the rows', (await page.$$('#scr-list .rtable .rhit mark.fnd')).length > 0);
  await page.fill('#scr-q', ''); await settle(page);
  await page.evaluate(async () => { const DOC = await import('/src/model/documents.js'); window.__wb.store.commit(d => { DOC.startRound(d, 'Autumn'); }, 'round'); window.__wb.setView(null); window.__wb.setView('resumes'); });
  await settle(page);
  const round = await page.evaluate(() => window.__wb.store.state.rounds[0].id);
  ok('with a round, the rounds are header rows of the same table, every round open', (await page.$$('#scr table')).length === 1 && (await page.$$('#scr .rtable tbody.rrhead')).length === 2 && await page.getAttribute('#scr tbody.rrhead[data-round=""] .rfold', 'aria-expanded') === 'true' && await page.isVisible(`#scr tr.rline[data-rid="${s0.ids[2]}"]`));
  const a = await page.locator(`#scr tr.rline[data-rid="${s0.ids[2]}"] td.c-name`).boundingBox(), b = await page.locator('#scr tbody.rrhead[data-current] th').boundingBox();
  await page.mouse.move(a.x + 10, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(b.x + 20, b.y + b.height / 2, { steps: 8 }); await page.mouse.up(); await settle(page);
  ok('a row carried onto a round’s name moves there', await page.evaluate(id => window.__wb.store.state.resumes.find(r => r.id === id).round, s0.ids[2]) === round);
  // a round's name is written in place, in the list's header row and in the cards' fold (a click there does not fold it); Earlier has none
  const rname = () => page.evaluate(() => window.__wb.store.state.rounds[0].name);
  await page.click('#scr tbody.rrhead[data-current] .rrname'); await page.keyboard.type('Winter push'); await page.keyboard.press('Enter'); await settle(page);
  const inList = await rname();
  await page.click('[data-act=scr-cards]'); await settle(page);
  const det = '#scr .rround[data-current]', wasOpen = await page.evaluate(d => document.querySelector(d).open, det);
  await page.click(`${det} > summary .rrname`); await settle(page, 100);
  const ed = await page.evaluate(d => ({ focus: document.activeElement?.id, open: document.querySelector(d).open, pen: !!document.querySelector('.rround[data-round=""] .rrname') }), det);
  await page.keyboard.type('zzz'); await page.keyboard.press('Escape'); await settle(page);
  const afterEsc = await rname(), u = await page.evaluate(() => window.__wb.store.history.undo);
  await page.click(`${det} > summary .rrname`); await page.keyboard.type('Spring'); await page.locator('#scr-q').click(); await settle(page);
  const left = await rname(), u2 = await page.evaluate(() => window.__wb.store.history.undo);
  await page.evaluate(() => window.__wb.store.undo()); await settle(page);
  ok('a round\u2019s name is written in place: in the list\u2019s header row, and in the cards\u2019 fold without folding it; Enter or leaving keeps it as one undo step, Esc does not; Earlier has none', inList === 'Winter push' && ed.focus === 'rr-name' && ed.open === wasOpen && !ed.pen && afterEsc === 'Winter push' && left === 'Spring' && u2 === u + 1 && await rname() === 'Winter push', JSON.stringify({ inList, ed, afterEsc, left }));
  await page.click('[data-act=scr-list]'); await settle(page);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForFunction(() => document.body.classList.contains('is-ready')); await goLibrary(page);
  ok('the list is remembered', (await page.$$('#scr .rtable')).length > 0 && (await page.$$('#scr .rcard')).length === 0);
  await page.click('[data-act=scr-cards]'); await settle(page);
  ok('the switch again brings the cards back', (await page.$$('#scr .rtable')).length === 0 && (await page.$$('#scr .rcard')).length > 0 && await page.evaluate(() => localStorage.getItem('rb-manage-list')) === '0');
  ok('no errors', errors.length === 0, errors[0] ?? '');
  await ctx.close();
  const n = await open(1280, 720);
  await goLibrary(n.page); await n.page.click('[data-act=scr-list]'); await settle(n.page);
  const w = await n.page.evaluate(() => { const q = s => document.querySelector(`#scr .rtable ${s}`).getBoundingClientRect(), tb = q('');
    return { paper: q('th.c-paper').width, name: q('th.c-name').width, cut: [...document.querySelectorAll('#scr .rtable tr.rline td.c-lang')].filter(td => td.scrollWidth > td.clientWidth).length, fill: Math.round(tb.right - q('tr.rline td.c-changed').right), scroll: document.querySelector('#scr').scrollWidth - document.querySelector('#scr').clientWidth }; });
  ok('at 1280 the list drops the paper and pages columns (keeping language), its rows fill the table, no language cell cut, and nothing scrolls sideways', w.paper === 0 && w.cut === 0 && w.fill <= 2 && w.scroll <= 1, JSON.stringify(w));
  await n.ctx.close();
});

await part('language copies: one item with a chip for each language, a chip selects, a move takes them all, the files chip, the list folds a row for each language', async () => {
  const { ctx, page, errors } = await open(1470, 832);
  // Medtech Lisboa in German (sent once, a file exported from it), then a French copy of the German one, open: one item of three; a round to move it to
  const ids = await page.evaluate(async id => {
    const RS = await import('/src/model/resumes.js'), DOC = await import('/src/model/documents.js'); let de, fr;
    window.__wb.store.commit(d => {
      de = RS.duplicate(d, id, { lang: 'de' }).id; RS.takeSnapshot(d, { kind: 'company', company: 'Smoke Co', role: 'Role' }); fr = RS.duplicate(d, de, { lang: 'fr' }).id;
      DOC.addDocument(d, { name: 'sent.txt', type: 'text/plain', sha256: 'c'.repeat(64), size: 10, meta: { kind: 'resume', company: 'Medco', role: 'Rolec' }, text: 'sent line' }).resume = de;
      DOC.startRound(d, 'Autumn');
    }, 'seed');
    return [id, de, fr];
  }, MEDTECH);
  await goLibrary(page);
  const card = id => `#scr .rcard[data-rid="${id}"]`, chips = id => page.evaluate(c => [...document.querySelectorAll(`${c} .rlang`)].map(b => `${b.textContent}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}${b.classList.contains('ticked') ? '+' : ''}`).join(' '), card(id));
  const a = await page.evaluate(ids => ({ cards: ids.map(id => document.querySelectorAll(`#scr .rcard[data-rid="${CSS.escape(id)}"]`).length).join(), sel: document.querySelector(`#scr .rcard[data-rid="${CSS.escape(ids[2])}"]`)?.classList.contains('sel'), from: !!document.querySelector(`#scr .rcard[data-rid="${CSS.escape(ids[2])}"] .rfrom`) }), ids);
  ok('a resume and its copies in other languages are one card: the open copy shown, a chip for each language (the shown one marked), no "from" line', a.cards === '0,0,1' && await chips(ids[2]) === 'EN DE FR*' && a.sel && !a.from, JSON.stringify({ ...a, chips: await chips(ids[2]) }));
  const cur = await page.evaluate(() => window.__wb.store.state.rounds[0].id);
  await pickOption(page, '#body [data-res-round]', cur); await settle(page);
  ok('moving it to a round moves the original and every language copy', await page.evaluate(ids => ids.map(id => window.__wb.store.state.resumes.find(r => r.id === id).round), ids).then(rs => rs.every(r => r === cur)));
  await page.click(`${card(ids[2])} .rlang:text-is("DE")`); await settle(page);
  const b = await page.evaluate(() => ({ lbl: document.querySelector('#body .ilangs [aria-pressed=true]')?.textContent, view: window.__wb.ui.view }));
  ok('a chip selects that language: the card shows it, marked, and the inspector\u2019s language switch marks it', await page.$(card(ids[1])) && await chips(ids[1]) === 'EN DE* FR' && /Deutsch/.test(b.lbl ?? '') && b.view === 'resumes' && await page.evaluate(c => document.querySelector(c).classList.contains('sel'), card(ids[1])), JSON.stringify(b));
  await page.click('#body .ilangs [lang=fr]'); await settle(page);
  ok('…the inspector\u2019s switch selects another language: the card follows', await chips(ids[2]) === 'EN DE FR*' && /Français/.test(await page.textContent('#body .ilangs [aria-pressed=true]')), await chips(ids[2]));
  await page.click('#body .ilangs [lang=de]'); await settle(page);
  await page.click(`${card(ids[1])} .rlang:text-is("DE")`); await settle(page, 500);
  ok('…a second click on it opens nothing', await view(page) === 'resumes' && (await st(page)).openId !== ids[1]);
  await page.dblclick(`${card(ids[1])} .rlang:text-is("DE")`); await settle(page, 500);
  ok('…and a double click on it opens that language', await view(page) === null && (await st(page)).openId === ids[1]);
  await goLibrary(page);
  const want = await page.evaluate(async ids => { const RS = await import('/src/model/resumes.js'), s = window.__wb.store.state; return ids.reduce((n, id) => n + RS.snapshotsOf(RS.savedOf(s, id)).length, 0) + RS.docGroups(s).filter(g => ids.includes(g.resume)).reduce((n, g) => n + g.members.length, 0); }, ids);
  const said = await page.evaluate(async n => (await import('/src/i18n/index.js')).t('i7.nFiles', { n }), want);      // the open resume's language may be the page's
  ok(`the card counts the files of all its languages, sent copies and documents: "${want} files"`, want >= 2 && (await page.textContent(`${card(ids[1])} .rfiles`)).trim() === said, said);
  await page.click(`${card(ids[1])} .rfiles`); await settle(page, 400);
  const f = await page.evaluate(() => { const x = document.querySelector('#body .idet[open] li'), r = x?.getBoundingClientRect(), b = document.querySelector('#body').getBoundingClientRect(); return { n: document.querySelectorAll('#body .idet[open] li').length, seen: !!r && r.top >= b.top - 1 && r.top < b.bottom - 20 }; });
  ok('…the chip unfolds them in the inspector, one line each', f.n === want && f.seen, JSON.stringify(f));
  await page.check(`${card(ids[1])} .rtick`); await settle(page, 100);
  ok('a tick ticks the language shown, and its chip says so', await page.evaluate(() => [...document.querySelectorAll('#scr-ticks, #scr-nticked')].length > 0) && await chips(ids[1]) === 'EN DE*+ FR');
  await page.click('#scr-ticks [data-act=scr-clear]'); await settle(page);
  const frName = await page.evaluate(id => window.__wb.store.state.resumes.find(r => r.id === id).name, ids[2]);
  await page.fill('#scr-q', frName); await settle(page);
  ok('a search that finds a copy shows its item with that language marked', await page.$(card(ids[2])) && (await chips(ids[2])).includes('FR*'), `${frName}: ${await chips(ids[2])}`);
  await page.fill('#scr-q', ''); await settle(page);
  await page.click('[data-act=scr-list]'); await settle(page);
  const L = await page.evaluate(ids => {
    const q = s => [...document.querySelectorAll(`#scr-list ${s}`)], sub = q(`tr.rsub[data-parent="${CSS.escape(ids[0])}"]`);
    return { rows: ids.map(id => q(`tr.rline[data-rid="${CSS.escape(id)}"]`).length).join(), langs: sub.filter(x => x.dataset.lid).map(x => x.querySelector('.rsel').textContent).join(), first: sub.findIndex(x => !x.dataset.lid), last: sub.map(x => !!x.dataset.lid).lastIndexOf(true),
      files: sub.filter(x => !x.dataset.lid).reduce((n, x) => n + Number(x.dataset.formats ?? 1), 0), hidden: sub.every(x => x.hidden), chip: q(`tr.rline[data-rid="${CSS.escape(ids[1])}"] .c-sent .rfiles`).length };
  }, ids);
  ok('the list: one row for the item, and folded under it a row for each language before the files of all of them, as many as the card counts', L.rows === '0,1,0' && L.langs === 'English,Deutsch,Français' && L.last < L.first && L.files === want && L.hidden && L.chip === 1, JSON.stringify(L));
  await page.click(`#scr tr.rline[data-rid="${ids[1]}"] .rfiles`); await settle(page, 100);
  ok('…its files chip unfolds the row', await page.getAttribute(`#scr tr.rline[data-rid="${ids[1]}"] .rfold`, 'aria-expanded') === 'true' && await page.isVisible(`#scr tr[data-lid="${ids[2]}"]`));
  await page.click(`#scr tr[data-lid="${ids[2]}"] .rsel`); await settle(page);
  ok('…a language row selects that language', await page.$(`#scr tr.rline.sel[data-rid="${ids[2]}"]`) && await page.$(`#body .ihero[data-id="${ids[2]}"]`));
  ok('no errors', errors.length === 0, errors[0] ?? '');
  await page.click('[data-act=scr-cards]'); await settle(page);
  await ctx.close();
});

await part('the example’s own Library: rounds (the current one open, an older one folded, an archived one hidden until asked for) and Earlier, files with the resume they went out with, one application in three languages, sent copies', async () => {
  const { ctx, page, errors } = await open(1470, 832, undefined, { library: true });
  await goLibrary(page);
  const look = () => page.evaluate(async () => {
    const RS = await import('/src/model/resumes.js'), st = window.__wb.store.state, all = sel => [...document.querySelectorAll(sel)];
    const doc = name => all('#scr .rcard.rdoc').find(c => c.querySelector('.rsel')?.textContent.trim() === name);
    const fein = st.resumes.find(r => r.company.startsWith('Feinmess') && !r.parent), copies = st.resumes.filter(r => r.parent === fein.id);
    return { rounds: all('#scr .rround').map(d => [d.querySelector('summary').textContent.split('·')[0].trim(), d.open ? 'open' : 'shut', d.dataset.current ? 'current' : '', d.dataset.archived ? `archived ${d.dataset.n}` : ''].filter(Boolean).join(' ')),
      pdf: { ...doc('2026-09-29 Example Instruments - Design Engineer.pdf')?.dataset }, cv: doc('Dana Okonkwo CV 2023.docx')?.closest('.rround')?.dataset.round, cvState: doc('Dana Okonkwo CV 2023.docx')?.dataset.state,
      langs: copies.map(r => r.lang ?? 'en').sort().join(), inStep: copies.filter(r => r.inStep).map(r => r.lang ?? 'en').join(), group: RS.groupOf(st, fein).length,
      attached: RS.docGroups(st).filter(g => g.resume && all('#scr .rcard.rdoc').some(c => c.dataset.did === g.id)).length, alone: all('#scr .rcard.rdoc').length,
      counts: all('#scr .rgrid').every(g => (g.previousElementSibling?.matches('h3') ? g.previousElementSibling : g.closest('.rround')?.querySelector('summary'))?.textContent.trim().endsWith(`· ${g.children.length}`)),      // a round with no headings inside counts on its own name
      sent: st.resumes.filter(r => RS.snapshotsOf(r).length).length, letters: st.documents.filter(d => d.meta.kind === 'cover-letter').length, originals: st.documents.every(d => d.embedded) };
  });
  const a = await look();
  ok('three rounds: the current one first and open, the older one open too, the archived one left out, then Earlier, open', a.rounds.join('|') === 'October 2026 open current|September 2026 open|Earlier open', a.rounds.join('|'));
  ok('a document that belongs to a resume (the PDF sent to Example Instruments, its Word copy and its letter) is no card of its own; documents tied to no resume are, and each heading (or the round\u2019s name) counts the cards under it', !a.pdf.from && a.attached === 0 && a.alone >= 1 && a.counts, JSON.stringify({ pdf: a.pdf, attached: a.attached, alone: a.alone, counts: a.counts }));
  ok('an old resume on its own is in Earlier, with a line the career does not hold', a.cv === '' && a.cvState === 'unplaced', `${a.cv} ${a.cvState}`);
  ok('one application in three languages: the German original, an English copy kept in step, a French one that is not', a.langs === 'en,fr' && a.inStep === 'en' && a.group === 2, JSON.stringify(a));
  ok('four resumes have sent copies, two letters went with them, and every file keeps its original', a.sent === 4 && a.letters === 2 && a.originals);
  await page.evaluate(() => { const s = document.querySelector('#scr-show'); s.value = 'archived'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(page);
  ok('Show archived brings the archived round back, with its two resumes', (await look()).rounds.includes('Summer 2026 open archived 2'), (await look()).rounds.join('|'));
  const fam = await page.evaluate(async () => { const RS = await import('/src/model/resumes.js'), s = window.__wb.store.state; return RS.langFamily(s, s.resumes.find(r => r.company.startsWith('Feinmess') && !r.parent)).map(r => r.id); });
  const u = await page.evaluate(async fam => {
    const RS = await import('/src/model/resumes.js'), s = window.__wb.store.state, cards = [...document.querySelectorAll('#scr .rcard:not(.rdoc)')].filter(c => fam.includes(c.dataset.rid));
    const want = fam.reduce((n, id) => n + RS.snapshotsOf(RS.savedOf(s, id)).length, 0) + RS.docGroups(s).filter(g => fam.includes(g.resume)).reduce((n, g) => n + g.members.length, 0);
    return { cards: cards.length, chips: [...(cards[0]?.querySelectorAll('.rlang') ?? [])].map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(' '), files: cards[0]?.querySelector('.rfiles')?.textContent.trim(), want };
  }, fam);
  ok('the application in three languages is one card: a chip for each language, the original shown; its files chip counts the sent copies and documents of all three', u.cards === 1 && u.chips === 'DE* EN FR' && u.files === `${u.want} files` && u.want >= 4, JSON.stringify(u));
  await page.click('[data-act=scr-list]'); await settle(page);
  const L = await page.evaluate(fam => {
    const q = s => [...document.querySelectorAll(`#scr-list ${s}`)], sub = q(`tr.rsub[data-parent="${CSS.escape(fam[0])}"]`);
    return { rows: fam.map(id => q(`tr.rline[data-rid="${CSS.escape(id)}"]`).length).join(), langs: sub.filter(x => x.dataset.lid).map(x => x.querySelector('.rsel').textContent).join(), files: sub.filter(x => !x.dataset.lid).reduce((n, x) => n + Number(x.dataset.formats ?? 1), 0), langsFirst: sub.findIndex(x => !x.dataset.lid) === 3 };
  }, fam);
  ok('…in the list one row, folded under it a row for each language and then its files, as many as the card counts', L.rows === '1,0,0' && L.langs === 'Deutsch,English,Français' && L.files === u.want && L.langsFirst, JSON.stringify(L));
  await page.setViewportSize({ width: 1180, height: 832 }); await settle(page);
  const pill = await page.evaluate(() => { const p = document.querySelector('#scr tr.rline.open .pill.is-open'), td = p?.closest('td'), r = p?.getBoundingClientRect(); return p && { whole: p.scrollWidth <= p.clientWidth + 1 && r.right <= td.getBoundingClientRect().right + 1, cut: (n => n.scrollWidth > n.clientWidth)(td.querySelector('.rsel')), text: p.textContent }; });
  ok('in a narrow list the "Open now" pill keeps its width, inside its cell', !!pill?.whole, JSON.stringify(pill));
  await page.click('[data-act=scr-cards]'); await settle(page);
  await page.fill('#scr-q', '2026-09-29'); await settle(page, 400);
  const sq = await page.evaluate(() => ({ cards: [...document.querySelectorAll('#scr .rcard')].map(c => c.dataset.rid ?? `doc:${c.dataset.did}`), hit: [...document.querySelectorAll('#scr .rcard .rfiles.is-hit')].map(b => b.closest('.rcard').dataset.rid) }));
  ok('a search that finds only a document’s words shows its resume’s card, with the files chip marked', sq.cards.join() === 'Example Instruments - Design Engineer.json' && sq.hit.join() === 'Example Instruments - Design Engineer.json', JSON.stringify(sq));
  await page.fill('#scr-q', ''); await settle(page, 400);
  ok('no page errors', !errors.length, errors.join(' | '));
  await ctx.close();
});

// ---------------------------------------------------------------- Career
await part('Career: About you, the timeline (newest first) and the cards; an entry opens in place; one asked for docks in the inspector with its scope named; search finds a line', async () => {
  const { ctx, page } = await open(1470, 832);
  await page.click('#ptabs [data-p=career]'); await settle(page, 500);
  const c = await page.evaluate(() => {
    const R = e => e.getBoundingClientRect(), years = [...document.querySelectorAll('#scr .ce-yr')].map(y => y.textContent.trim()), tl = document.querySelector('#scr .ce-tg');
    const flo = [...document.querySelectorAll('#scr *')].filter(e => { const s = getComputedStyle(e); return (s.position === 'fixed' || s.position === 'absolute') && R(e).width > 120 && R(e).height > 30 && !e.closest('.tbar') && !e.matches('.sr, .sr *'); }).map(e => e.className);
    return { years, first: document.querySelector('#scr .ce-card .t b')?.textContent, floating: flo, toolbar: !!document.querySelector('#scr .tbar #rec-q'), aboutAbove: R(document.querySelector('#scr .ce-about')).bottom <= R(tl).top, boxes: document.querySelectorAll('#scr .ce-box').length, side: !!document.querySelector('#body .ce-side .ce-chips') };
  });
  ok('About you on top, the timeline under it, newest year first, then the cards of Skills & credentials; the sidebar lists the languages', c.aboutAbove && c.years[0] === 'Now' && +c.years[1] > +c.years.at(-1) && c.first === 'Design Engineer' && c.boxes >= 4 && c.side, JSON.stringify(c));
  ok('nothing floats over the timeline: only the toolbar is above it', c.floating.length === 0 && c.toolbar, c.floating.join());
  await page.click('#scr .ce-card[data-ce-card=poly] .ce-ch'); await settle(page);
  ok('a click on an entry opens its lines in place, and the sidebar speaks of it', await page.evaluate(() => document.querySelectorAll('#scr .ce-card.is-open').length === 1 && !!document.querySelector('#scr .ce-card[data-ce-card=poly] .ce-lines') && /Prototyping Technician/.test(document.querySelector('#body .ce-side').textContent)));
  await page.evaluate(() => window.__wb.record.open(['hydra'])); await settle(page);
  const d = await page.evaluate(() => { const b = document.querySelector('#body'); return { name: b.querySelector('.oi-name')?.textContent.trim(), scopes: [...b.querySelectorAll('.scope')].map(x => x.textContent.trim()), det: b.querySelector('details.details')?.open, lines: b.querySelectorAll('.clrow .cb').length, back: !!b.querySelector('[data-act=rec-back]') }; });
  ok('an entry asked for (the page\u2019s job chip, Edit\u2019s links) docks in the inspector, its lines to tick, Details folded, with a way back', /Design Engineer/.test(d.name) && d.det === false && d.lines >= 5 && d.back, JSON.stringify(d));
  ok('the scope is named: a change reaches every resume that prints it (the ticks need no note)', d.scopes.length === 1 && /reaches every resume that prints it/.test(d.scopes[0]), d.scopes.join(' | '));
  const cb = page.locator('#body .clrow .cb').nth(3); await cb.focus(); const was = await cb.isChecked(); await page.keyboard.press('Space'); await settle(page, 500);
  ok('a tick in the inspector changes the open resume and keeps the focus on the tick', await page.evaluate(w => document.activeElement?.classList.contains('cb') && document.activeElement.checked === !w, was));
  await page.click('#body details.details summary'); await settle(page, 200);
  await page.fill('#c-loc', 'Porto, Portugal'); await settle(page, 300);
  ok('what is typed in a field of the entry\u2019s Details stays there', await page.inputValue('#c-loc') === 'Porto, Portugal');
  await page.click('#body [data-act=rec-back]'); await settle(page);
  ok('Back gives the sidebar back to Career', await page.evaluate(() => !!document.querySelector('#body .ce-side') && !document.querySelector('#body .insp-rec')));
  await page.fill('#rec-q', 'caliper'); await settle(page, 500);
  const q = await page.evaluate(() => ({ cards: [...document.querySelectorAll('#scr .ce-card')].map(x => x.querySelector('.t b').textContent), open: document.querySelectorAll('#scr .ce-card.is-open').length, focus: document.activeElement?.id }));
  ok('search finds a line: only the entries that hold it are left, open, and the caret stays in the search box', q.cards.length >= 1 && q.cards.length < 6 && q.open === q.cards.length && q.focus === 'rec-q', JSON.stringify(q));
  await page.fill('#rec-q', ''); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc stays in Career', await view(page) === 'record');
  await ctx.close();
});

// ---------------------------------------------------------------- no bar, ten languages, three sizes
if (PART){ await browser.close(); server.close(); console.log(failed ? `\n${failed} screens check(s) FAILED` : '\nall screens checks passed'); process.exit(failed ? 1 : 0); }
const LANGS = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu'].filter(l => !ONLY || ONLY.has(l));
const SIZES = [[1280, 720], [1470, 832], [1920, 1080]];
const NAMES = { long: 'Example Instruments — Mechanical Design Engineer', sixty: 'Example Instruments — Senior Mechanical Design Engineer, EMEA'.slice(0, 60) };
const PROBE = `(() => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = el => (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).toString().trim().replace(/\\s+/g, ' ').slice(0, 30);
  const textRects = el => { const out = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n; (n = w.nextNode());){ if (!n.nodeValue.trim() || n.parentElement.closest('.sr') || getComputedStyle(n.parentElement).opacity === '0') continue; const g = document.createRange(); g.selectNodeContents(n); out.push(...g.getClientRects()); } return out; };
  const out = { clipped: [], overlap: [], bars: [], wide: 0, scroll: 0 };
  for (const id of ['#head', '#foot']){ const e = document.querySelector(id); if (e && vis(e) && e.getBoundingClientRect().width > innerWidth / 2) out.bars.push(id + ' ' + Math.round(e.getBoundingClientRect().width)); }
  const body = document.querySelector('#scr'); out.scroll = body.scrollWidth - body.clientWidth;
  const controls = [...document.querySelectorAll('#scr button, #scr input:not([type=checkbox]), #scr select, #scr h2, #ptabs button, #head button, #head .psub')].filter(vis).filter(e => !e.closest('.cmpscroll, .rowmenu, .rectl, .sr, #head .docname'));      // the name card's name is head-check's (a short window keeps it one line)
  for (const el of controls){      // (a closed tab of the way hides its word: only the open one says it)
    const r = el.getBoundingClientRect();
    if (!el.matches('.rtable .cname > .rsel')) for (const t of textRects(el)) if (t.right > r.right + 1 || t.left < r.left - 1){ out.clipped.push(label(el)); break; }      // (a list row's name is cut short before its pills: the narrow list's own check)
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
      for (const screen of ['resumes', 'compare', 'record', ...(w === 1280 ? ['list'] : [])]){      // list: the Library as a table
        try {
          if (screen === 'compare') await page.evaluate(ids => window.__wb.screens.compare(ids), s0.ids.slice(0, 3));
          else await page.evaluate(s => window.__wb.setView(s), screen === 'list' ? 'resumes' : screen);
          if (screen === 'list') await page.click('[data-act=scr-list]');
          await page.waitForTimeout(200);
          const a = await page.evaluate(PROBE);
          if (screen === 'list') await page.click('[data-act=scr-cards]');
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
  await page.evaluate(() => localStorage.setItem('rb-manage-list', '1')); await page.reload({ waitUntil: 'networkidle' }); await page.waitForFunction(() => document.body.classList.contains('is-ready'));
  await page.evaluate(plainExample);      // (the reload brought the example's Library back)
  await page.evaluate(() => { window.__wb.thumbs.fill = () => {}; });
  await page.evaluate(() => window.__wb.setView('resumes')); await page.waitForTimeout(200);
  ok('a phone keeps the cards with the list remembered, and has no list switch', await page.evaluate(() => !document.querySelector('[data-act=scr-list]') && !document.querySelector('.rtable') && document.querySelectorAll('#body .rcard').length > 0));
  await page.evaluate(() => window.__wb.setView(null));
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
        const body = R(document.querySelector('#resumes')), q = R(document.querySelector('#scr-q')), seg = R(document.querySelector('#resumes .lbar'));      // the list's bar (Group and Show) took the views' place
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
      if (a.segw < 0.9) bad.push(`${key}: the list\u2019s bar ${Math.round(a.segw * 100)}% wide`);
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
