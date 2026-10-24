#!/usr/bin/env node
// node checks/screens-check.mjs
// What the three places hold (UX-6e, UX-6h; the routing, the tabs and the keys are places-check's). In Chromium on the fictional example:
//   - the Library: cards with the information beside the picture (company, role, paper, language, pages), Open now, a Sent N times badge, a tick
//     named for its resume, a second page fanned behind a longer resume, newest first; as many to a row as hold 260 px (three at 1280, five at
//     1920, seven at 2560); a click selects and a second click (or a double click) opens; the thumbnails are pictures of the real first page and
//     each is drawn once; every page of a resume is kept in the cache,
//   - the inspector in the sidebar's body: the page across its width, the name and details on a card over its foot, Use for a new job (a company
//     is required; Enter makes the copy under its parent with the company and role and opens it; what was typed survives leaving the place), Open,
//     the row menu (Duplicate opens the copy with its name ready), At a glance, where it came from, what differs (three, the rest folded), its sent copies,
//   - the growing page: scrolling down over the inspector's page grows it toward where the editor shows it, returns when let go early, becomes the
//     editor past halfway and lands on the editor's page; under reduced motion nothing grows,
//   - the hover preview: a page beside the card after the rest, "2 / 2" on a wheel, gone when the pointer leaves or anything is clicked,
//   - Compare of three (one a sent copy): back and Esc keep the ticks, N and P step the rows that differ and the inspector shows the row,
//   - Career: profile cards and the timeline (newest first), the entry docked in the inspector with both scopes named, its lines to tick,
//     search finding a line and marking it; nothing floats over the timeline,
//   - no bar across the window on any place, and, at three sizes in the ten languages with a long and a 60 character name, nothing clipped or overlapping.
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
// a part that stops (a control that is not there) is one failure with its reason, and the parts after it still run
const PART = process.env.PART;      // PART=growing runs only the parts whose name has these words
const part = async (name, fn) => { if (PART && !name.includes(PART)) return; console.log(`\n— ${name}`); try { await fn(); } catch (e){ ok(`${name}: ran to its end`, false, String(e.message ?? e).split('\n')[0].slice(0, 160)); } };
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});

async function open(w, h, look = ['tea', 'light'], { motion = false } = {}){
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: motion ? 'no-preference' : 'reduce' });
  await ctx.addInitScript(([d, t, m]) => { try { (localStorage.setItem('rb-help-seen', '1'), localStorage.setItem('rb-esc-fold', 'off')); localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); localStorage.setItem('rb-reduce-motion', m ? '0' : '1'); } catch { /* none */ } }, [...look, motion]);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const settle = (page, ms = 300) => page.waitForTimeout(ms);
const st = page => page.evaluate(() => { const s = window.__wb.store.state; return { openId: s.openId, ids: s.resumes.map(r => r.id), parents: Object.fromEntries(s.resumes.map(r => [r.id, r.parent ?? null])), names: Object.fromEntries(s.resumes.map(r => [r.id, r.name ?? null])) }; });
const view = page => page.evaluate(() => window.__wb.ui.view);
const thumbsDone = (page, n) => page.waitForFunction(n => document.querySelectorAll('#scr [data-thumb] iframe').length >= n, n, { timeout: 60000 });
const MEDTECH = 'Medtech Lisboa - Mechanical Engineer.json';      // two pages, an A4 resume that may run to two: the sidebar is at its narrow width when it is open
const goLibrary = async page => { await page.click('#ptabs [data-p=library]'); await settle(page); };
// make a resume the open one without going through the UI (it has to be a resume that is saved)
const openResume = async (page, id) => { await page.evaluate(id => window.__wb.resumes.open(id), id); await settle(page, 500); };

// ---------------------------------------------------------------- the Library
await part('the cards: the information beside the picture, badges, ticks, the fan, newest first', async () => {
  const { ctx, page } = await open(1470, 832);
  await page.evaluate(async () => { const RS = await import('/src/model/resumes.js'); window.__wb.store.commit(d => { RS.takeSnapshot(d, { kind: 'company', company: 'Smoke Co', role: 'Role' }); }, 'send'); });
  await goLibrary(page);
  const s0 = await st(page); await thumbsDone(page, s0.ids.length);
  const c = await page.evaluate(id => {
    const cs = [...document.querySelectorAll('#scr .rcard')], R = e => e.getBoundingClientRect(), first = cs[0], open = document.querySelector('#scr .rcard.open');
    const med = document.querySelector(`#scr .rcard[data-rid="${id}"]`);
    return { n: cs.length, openFirst: first === open, openNow: first.querySelector('.is-open')?.textContent, sentBadge: first.querySelector('.rbadges .pill:not(.is-open)')?.textContent,
      role: first.querySelector('.rrole')?.textContent, meta: first.querySelector('.rmeta')?.textContent, name: first.querySelector('.rname')?.textContent.trim(),
      beside: R(first.querySelector('.rname')).left >= R(first.querySelector('.thumbwrap')).right - 1 && Math.abs(R(first.querySelector('.rname')).top - R(first.querySelector('.thumbwrap')).top) < 40,
      tickNamed: cs.every(x => (x.querySelector('input.rtick')?.getAttribute('aria-label') ?? '').length > 3), noDiffs: !document.querySelector('#scr .rcard [data-act=scr-differs], #scr .rcard .rfrom'),
      fan: getComputedStyle(med.querySelector('.thumbwrap'), '::before').content !== 'none', noFan: getComputedStyle(first.querySelector('.thumbwrap'), '::before').content === 'none' };
  }, MEDTECH);
  ok('every resume has a card; the open one is first and says "Open now"', c.n === s0.ids.length && c.openFirst && c.openNow === 'Open now');
  ok('the card has the company, the role, the paper, the language and the pages, beside the picture', c.name === 'Example Instruments' && c.role === 'Design Engineer' && /Letter/.test(c.meta) && /EN/.test(c.meta) && /1 p/.test(c.meta) && c.beside, `${c.name} | ${c.role} | ${c.meta}`);
  ok('a resume that was sent says "Sent 1×"', c.sentBadge === 'Sent 1×', c.sentBadge);
  ok('every tick box has a name, and the card holds no "What differs" (it is the inspector\u2019s)', c.tickNamed && c.noDiffs);
  ok('a resume of two pages fans its second sheet out behind the first; one of a single page does not', c.fan && c.noFan);
  const order = await page.evaluate(() => [...document.querySelectorAll('#scr .rgrid')].map(g => [...g.querySelectorAll('.rcard')].map(x => (x.classList.contains('open') ? '9999' : window.__wb.store.state.resumes.find(r => r.id === x.dataset.rid).savedAt || ''))));
  ok('within each group the cards run newest first (the open resume counts as the newest)', order.length > 1 && order.every(g => g.every((d, i) => !i || g[i - 1] >= d)) && order.some(g => g.length > 2));
  await ctx.close();
});

await part('cards per row: three at 1280, five at 1920, seven at 2560', async () => {
  for (const [w, h, want] of [[1280, 720, 3], [1920, 1080, 5], [2560, 1440, 7]]){
    const { ctx, page } = await open(w, h);
    await openResume(page, MEDTECH);      // a resume that may run to two pages: the sidebar is at its narrow width, so the cards have the room the brief measured
    await goLibrary(page);
    const cols = await page.evaluate(() => { const cs = [...document.querySelectorAll('#scr .rcard')]; return { cols: new Set(cs.map(c => Math.round(c.getBoundingClientRect().left))).size, min: Math.min(...cs.map(c => c.getBoundingClientRect().width)) }; });
    ok(`${w}×${h}: ${want} cards to a row, none under 260 px wide`, cols.cols === want && cols.min >= 260 - 1, JSON.stringify(cols));
    await ctx.close();
  }
});

await part('a click selects, a second click on the selected card (or a double click) opens it; the thumbnails', async () => {
  const { ctx, page, errors } = await open(1470, 832);
  const s0 = await st(page), n = s0.ids.length;
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
  const a = await page.evaluate(id => ({ view: window.__wb.ui.view, open: window.__wb.store.state.openId, sel: document.querySelector('#scr .rcard.sel')?.dataset.rid, insp: document.querySelector('#body .insp-res .oi-name')?.textContent.trim(), inspSel: id }), other);
  ok('a click on a card selects it: it is ringed and the inspector shows it, and nothing opens', a.view === 'resumes' && a.sel === other && a.open === s0.openId && /—/.test(a.insp) && a.insp !== 'Example Instruments — Design Engineer', JSON.stringify(a));
  await page.click(`#scr .rcard[data-rid="${other}"] .rsel`); await settle(page, 500);
  ok('a click on the selected card opens it in the editor', await view(page) === null && (await st(page)).openId === other);
  await goLibrary(page);
  await page.dblclick(`#scr .rcard[data-rid="${s0.ids[2]}"] .rname`); await settle(page, 500);
  ok('a double click on a card opens it', await view(page) === null && (await st(page)).openId === s0.ids[2]);
  await goLibrary(page);
  await page.focus(`#scr .rcard[data-rid="${s0.ids[3]}"] .rsel`); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await settle(page, 500);
  ok('Enter on a card selects it, and Enter again opens it', await view(page) === null && (await st(page)).openId === s0.ids[3]);
  ok('no errors in the Library', errors.length === 0, errors[0] ?? '');
  await ctx.close();
});

await part('the inspector: the page across the panel, the name on a card over its foot, At a glance, where it came from, what differs, sent copies', async () => {
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
      const g = T.arrangementOf(model, d.cur).groups[0]; T.writeGroup(model, d.cur, g.id, `Renamed group\nOne skill, Another skill`);
    }, 'edits');
    b.store.commit(d => { RS.takeSnapshot(d, { kind: 'company', company: 'Smoke Co', role: 'Role' }); }, 'send');
  });
  const kid = (await st(page)).openId;
  await goLibrary(page); await thumbsDone(page, 3); await settle(page);
  const g = await page.evaluate(() => {
    const R = e => e.getBoundingClientRect(), b = document.querySelector('#body'), hero = b.querySelector('.ihero'), cap = b.querySelector('.ihcap'), br = R(b);
    const pitch = b.querySelector('.glance .gpitch')?.textContent ?? '', jobs = [...b.querySelectorAll('.glance .gjobs li')].map(li => li.textContent), dt = [...b.querySelectorAll('.glance dt')].map(x => x.textContent);
    return { heroW: R(hero).width, bodyW: br.width, heroLeft: R(hero).left - br.left, capOver: R(cap).top < R(hero).bottom - 10, capBg: getComputedStyle(cap).backgroundColor, capShadowFade: getComputedStyle(cap).backgroundImage === 'none',
      name: b.querySelector('.oi-name').textContent.trim(), primary: b.querySelector('.iacts .primary')?.textContent.trim(), keep: [...b.querySelectorAll('.iacts button')].map(x => x.textContent.trim()), more: !!b.querySelector('.iacts .rcmore .smore'),
      pitch, jobs, dt, labels: [...b.querySelectorAll('.lbl')].map(x => x.textContent.trim()), ovt: [...b.querySelectorAll('.ovw dt')].map(x => x.textContent), ov: [...b.querySelectorAll('.ovw dd')].map(x => x.textContent.replace(/\s+/g, ' ').trim()), ovFirst: b.querySelector('.ihcap ~ .ovw, .iacts ~ .ovw') === b.querySelector('.ovw') && !!b.querySelector('.ovw .pill'),
      diffs: b.querySelectorAll('.oi-diff li').length, folded: b.querySelector('details.imore summary')?.textContent, sent: [...b.querySelectorAll('.oi-sent li')].map(x => x.textContent.replace(/\s+/g, ' ').trim()) };
  });
  ok('the page runs across the panel\u2019s full width, edge to edge', Math.abs(g.heroW - g.bodyW) < 2 && Math.abs(g.heroLeft) < 2, `${g.heroW} of ${g.bodyW}`);
  ok('the name and details are a card of the panel\u2019s own surface over the page\u2019s foot, with no fade', g.capOver && g.capShadowFade && g.capBg !== 'rgba(0, 0, 0, 0)');
  ok('Use for a new job is the primary action, with Keep editing (the resume is open) and the ⋯ menu', g.primary === 'Use for a new job…' && g.keep.includes('Keep editing') && g.more, g.keep.join(' | '));
  ok('At a glance: the pitch, the jobs in order with how many of their lines print, the skills in order', g.dt.join() === 'Pitch,Jobs,Skills, in order' && g.pitch.length > 20 && g.jobs.length >= 2 && /\d+ lines?/.test(g.jobs[0]), JSON.stringify(g.jobs));
  ok('the overview is a table of fields, the sent facts first (the chip, to whom, when), then from, language, pages, last changed', g.ovt.join() === 'Sent,From,Language,Pages,Last changed' && /^Sent 1× Smoke Co - Role · 20\d\d-\d\d-\d\d/.test(g.ov[0]) && g.ovFirst, JSON.stringify(g.ov));
  ok('…From names the parent, Language the language, Pages the limit, Last changed a date; a resume nobody sent says Not sent', await page.evaluate(() => { const dd = [...document.querySelectorAll('#body .ovw dd')].map(x => x.textContent.replace(/\s+/g, ' ').trim()); return /Example Instruments/.test(dd[1]) && dd[2] === 'English' && /page/.test(dd[3]) && /^20\d\d-/.test(dd[4]); }) && await (async () => { await page.click(`#scr .rcard[data-rid="${s0.ids[3]}"] .rsel`); await settle(page); return /^Not sent/.test(await page.textContent('#body .ovw dd')); })());
  await page.click(`#scr .rcard[data-rid="${kid}"] .rsel`); await settle(page);
  ok('what differs: the first three, the rest folded', g.diffs === 3 && /more/.test(g.folded ?? ''), `${g.diffs} ${g.folded}`);
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
  await page.click(`#scr .rcard[data-rid="${s1.openId}"] .rsel`); await settle(page);      // already selected (it is open): this opens it
  await goLibrary(page);
  await page.click('#body .iacts .smore'); await page.click('#body .rowmenu [data-act=rm-rename]'); await settle(page);
  ok('Rename is in place on the card', await page.isVisible('#scr .rcard .swren'));
  await page.fill('#scr .swren', 'Renamed here'); await page.keyboard.press('Enter'); await settle(page);
  ok('…and keeps what was typed', Object.values((await st(page)).names).includes('Renamed here'));
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
  ok('Enter makes the copy under its parent and opens it in the editor, with the company and the role in the fields a resume has', await view(page) === null && s1.ids.length === s0.ids.length + 1 && s1.parents[s1.openId] === parent && r.company === 'Contoso Labs' && r.role === 'Lead Engineer' && r.name === 'Contoso Labs - Lead Engineer', JSON.stringify(r));
  // the copy says what it came from: under its name in the name card, on its card, and it is the selected card
  const nm = await page.evaluate(() => ({ own: document.querySelector('#docname')?.textContent.replace(/\s+/g, ' ').trim(), from: document.querySelector('#head .dfrom')?.textContent }));
  await goLibrary(page);
  const lib = await page.evaluate(() => { const c = document.querySelector('#scr .rcard.sel'); return { id: c?.dataset.rid, from: c?.querySelector('.rfrom')?.textContent }; });
  const parentName = await page.evaluate(async id => (await import('/src/model/resumes.js')).resumeLabel(window.__wb.store.state.resumes.find(x => x.id === id)), parent);
  ok('after the copy the name card has its own name and "from <parent>", and the Library has the copy selected with "from <parent>" on its card', /^Contoso Labs \W+ Lead Engineer$/.test(nm.own ?? '') && nm.from === `from ${parentName}` && lib.id === s1.openId && lib.from === `from ${parentName}`, JSON.stringify({ nm, lib }));
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

await part('the growing page: it grows as you scroll over the inspector\u2019s page, returns when let go, becomes the editor past halfway; nothing grows under reduced motion', async () => {
  const { ctx, page } = await open(1470, 832, ['tea', 'light'], { motion: true });
  const s0 = await st(page), other = s0.ids[1];
  await goLibrary(page);
  await page.click(`#scr .rcard[data-rid="${other}"] .rsel`); await settle(page);
  await page.waitForFunction(() => document.querySelector('#body .ihpage [data-thumb] iframe'), null, { timeout: 20000 });
  const hero = await page.locator('#body .ihero').boundingBox();
  await page.mouse.move(hero.x + 100, hero.y + 100);
  await page.mouse.wheel(0, 120); await page.waitForTimeout(80);
  const g1 = await page.evaluate(() => { const g = document.querySelector('.growpage'); return g && { w: g.getBoundingClientRect().width, flat: !/matrix3d|translate3d|rotate[XYZ]/.test(g.style.transform + getComputedStyle(g).transform), willChange: getComputedStyle(g).willChange, hidden: getComputedStyle(document.querySelector('#body .ihpage')).visibility }; });
  ok('scrolling down over the page lifts a copy of it out of the panel (its own page, flat: no 3D transform, no will-change); the panel\u2019s page is hidden meanwhile', !!g1 && g1.flat && g1.willChange === 'auto' && g1.hidden === 'hidden', JSON.stringify(g1));
  await page.waitForTimeout(1000);
  ok('letting go early returns it: no copy, the page is back, nothing opened', await page.evaluate(() => !document.querySelector('.growpage') && getComputedStyle(document.querySelector('#body .ihpage')).visibility === 'visible' && window.__wb.ui.view === 'resumes' && window.__wb.store.state.openId !== window.__wb.store.state.resumes[1].id));
  await page.mouse.wheel(0, 250); await page.mouse.wheel(0, 250); await page.waitForTimeout(200);
  const mid = await page.evaluate(() => { const g = document.querySelector('.growpage'); return g && g.getBoundingClientRect().width; });
  ok('past halfway it is bigger than it was', mid > g1.w * 1.2, `${g1.w} → ${mid}`);
  await page.waitForFunction(() => window.__wb.ui.view === null, null, { timeout: 4000 });
  await page.waitForTimeout(150);
  const landed = await page.evaluate(() => { const g = document.querySelector('.growpage'), b = window.__wb.ui.layout.sheet; if (!g) return null; const a = g.getBoundingClientRect(); return { dl: Math.abs(a.left - b.left), dt: Math.abs(a.top - b.top), dw: Math.abs(a.width - b.width), open: window.__wb.store.state.openId }; });
  ok('it settles and becomes the editor on that resume, in the place the editor shows its page', !!landed && landed.open === other && landed.dl < 8 && landed.dt < 8 && landed.dw < 8, JSON.stringify(landed));
  await page.waitForTimeout(700);
  ok('…and the copy is gone a moment later', await page.evaluate(() => !document.querySelector('.growpage')));
  await ctx.close();
  const r = await open(1470, 832);
  await goLibrary(r.page); await r.page.click(`#scr .rcard[data-rid="${other}"] .rsel`); await settle(r.page);
  await r.page.waitForFunction(() => document.querySelector('#body .ihpage [data-thumb] iframe'), null, { timeout: 20000 });
  const h2 = await r.page.locator('#body .ihero').boundingBox();
  await r.page.mouse.move(h2.x + 100, h2.y + 100); await r.page.mouse.wheel(0, 300); await settle(r.page);
  ok('under reduced motion nothing grows', await r.page.evaluate(() => !document.querySelector('.growpage')) && await view(r.page) === 'resumes');
  await r.page.click('#body .ihpage'); await settle(r.page, 500);
  ok('…and a click on the page opens it', await view(r.page) === null && (await st(r.page)).openId === other);
  await r.ctx.close();
});

await part('the hover preview: a readable page beside the card after a rest; the wheel turns its pages; it goes when the pointer leaves or anything is clicked', async () => {
  const { ctx, page } = await open(1470, 832, ['tea', 'light'], { motion: true });
  const s0 = await st(page);
  await goLibrary(page); await thumbsDone(page, s0.ids.length);
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
  ok('Compare is not offered until something is ticked, and then is off until two are', !(await page.$('#scr-cmp')) && (await page.check(`#scr .rcard[data-rid="${s0.ids[1]}"] .rtick`), await page.isDisabled('#scr-cmp')));
  const bar = () => page.evaluate(() => { const b = document.querySelector('#scr-bar'), c = b?.querySelector('[data-act=scr-compare]'); return { shown: !!c && b.getBoundingClientRect().height > 0, tier: c?.dataset.tier, clear: !!b?.querySelector('[data-act=scr-clear]'),
    primaries: [...document.querySelectorAll('#scr [data-tier=primary], #body [data-tier=primary], #scr button.primary, #body button.primary')].filter(x => x.offsetParent).length, nj: document.querySelector('#body [data-act=nj-open]')?.dataset.tier }; });
  const b1 = await bar();
  await page.check(`#scr .rcard[data-rid="${s0.ids[2]}"] .rtick`);
  const b2 = await bar();
  ok('two ticked: Compare (primary tier) and Clear appear in a bar by the cards, and nothing else in the view is primary; with one ticked there is no bar and Use for a new job is the primary', !b1.shown && b1.primaries === 1 && b1.nj === 'primary' && b2.shown && b2.tier === 'primary' && b2.clear && b2.primaries === 1 && b2.nj === 'secondary', JSON.stringify({ b1, b2 }));
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
  ok('a sent copy has its own tick in the inspector, named for its resume, and compares', await page.evaluate(() => !!document.querySelector('#body .oi-sent .rtick')?.getAttribute('aria-label')) && (await page.check('#body .oi-sent .rtick'), await page.check(`#scr .rcard[data-rid="${s0.ids[1]}"] .rtick`), await page.click('#scr-cmp'), await settle(page), (await page.$$('#compare thead th[scope=col]')).length === 3));
  await ctx.close();
});

await part('Mark as sent… from the Library: in the inspector and in the ⋯ menu, the same dialog as Export\u2019s, and the Library again when it is done', async () => {
  const { ctx, page, errors } = await open(1470, 832);
  const s0 = await st(page), other = s0.ids[2];
  await goLibrary(page);
  await page.click(`#scr .rcard[data-rid="${other}"] .rsel`); await settle(page);
  const sentCount = id => page.evaluate(id => (window.__wb.store.state.resumes.find(r => r.id === id).snapshots ?? []).length, other);
  ok('the inspector of a resume that is not open has Mark as sent… (a secondary), and the ⋯ menu (the card\u2019s menu on a phone) has it too',
    await page.evaluate(() => { const b = document.querySelector('#body [data-act=rm-sent]'); return b?.textContent.includes('Mark as sent') && b.dataset.tier === 'secondary'; })
    && (await page.click('#body .iacts .smore'), await page.isVisible('.rowmenu [data-act=rm-sent]')));
  await page.keyboard.press('Escape'); await settle(page);
  await page.click('#body .iacts .smore'); await page.click('.rowmenu [data-act=rm-sent]'); await settle(page, 500);
  const d = await page.evaluate(() => ({ view: window.__wb.ui.view, open: window.__wb.store.state.openId, co: !!document.querySelector('#sv-co'), date: !!document.querySelector('#sv-date'), prim: document.querySelector('#body [data-act=sv-do]')?.dataset.tier, sec: document.querySelector('#body [data-act=sent-back]')?.dataset.tier }));
  ok('from the ⋯ menu: Export\u2019s own dialog (Sent to?) for that resume, which is opened, with its confirm as the primary and Cancel as tertiary words (one Cancel, UX-6 round 2)', d.view === 'sent' && d.open === other && d.co && d.date && d.prim === 'primary' && d.sec === 'tertiary', JSON.stringify(d));
  await page.click('[data-act=sent-back]'); await settle(page);
  ok('Cancel goes back to the Library, nothing sent', await view(page) === 'resumes' && await sentCount() === 0);
  await page.click('#body [data-act=rm-sent]'); await settle(page, 400);
  await page.fill('#sv-co', 'Northgate Dosing'); await page.fill('#sv-role', 'Mechanical Design Engineer'); await page.click('[data-act=sv-do]'); await settle(page, 600);
  const e = await page.evaluate(() => ({ view: window.__wb.ui.view, sel: document.querySelector('#scr .rcard.sel')?.dataset.rid, badge: document.querySelector('#scr .rcard.sel .pill:not(.is-open)')?.textContent, list: document.querySelector('#body .oi-sent')?.textContent.replace(/\s+/g, ' ') }));
  ok('Mark as sent keeps a copy and returns to the Library with that resume selected, its card badged and the inspector listing the send', await view(page) === 'resumes' && await sentCount() === 1 && e.sel === other && /Sent 1/.test(e.badge ?? '') && /Northgate Dosing/.test(e.list ?? ''), JSON.stringify(e));
  ok('no errors', errors.length === 0, errors[0] ?? '');
  await ctx.close();
});

await part('the Library\u2019s toolbar: search finds a send\u2019s company, the views, Sent only, the row menu; Esc clears the search first', async () => {
  const { ctx, page } = await open(1470, 832);
  await page.evaluate(async () => { const RS = await import('/src/model/resumes.js'); window.__wb.store.commit(d => { RS.takeSnapshot(d, { kind: 'company', company: 'Smoke Co', role: 'Role' }); }, 'send'); });
  await goLibrary(page);
  const distinct = () => page.$$eval('#scr .rcard', r => new Set(r.map(x => x.dataset.rid)).size);      // the Company view lists a resume under each company it was sent to
  const all = await distinct();
  await page.click('[data-act=scr-sent]'); await settle(page);
  ok('Sent only lists the resumes that have sends', (await distinct()) === 1 && await page.getAttribute('[data-act=scr-sent]', 'aria-pressed') === 'true');
  await page.click('[data-act=scr-sent]'); await settle(page);
  await page.click('[data-act=scr-view][data-v=company]'); await settle(page);
  await page.fill('#scr-q', 'smoke co'); await settle(page);
  ok('search finds a send\u2019s company: only the resume that went to Smoke Co', (await distinct()) === 1);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc clears the search first', await page.inputValue('#scr-q') === '' && (await distinct()) === all && await view(page) === 'resumes');
  await page.click('[data-act=scr-view][data-v=date]'); await settle(page);
  ok('the Date view groups by year, the open resume under Now, and the view is remembered', /Now/.test(await page.textContent('#scr h3.lbl')) && await page.getAttribute('[data-act=scr-view][data-v=date]', 'aria-pressed') === 'true');
  await page.click('[data-act=scr-view][data-v=type]'); await settle(page);
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

// ---------------------------------------------------------------- Career
await part('Career: profile cards and the timeline (newest first); the entry docked in the inspector with both scopes named; search finds a line', async () => {
  const { ctx, page } = await open(1470, 832);
  await page.click('#ptabs [data-p=career]'); await settle(page, 500);
  const c = await page.evaluate(() => {
    const R = e => e.getBoundingClientRect(), years = [...document.querySelectorAll('#scr .rectl .yr')].map(y => y.textContent.trim()), cards = [...document.querySelectorAll('#scr .recmore .srow')].map(x => x.textContent.trim()), tl = document.querySelector('#scr .rectl .tl2');
    const flo = [...document.querySelectorAll('#scr *')].filter(e => { const s = getComputedStyle(e); return (s.position === 'fixed' || s.position === 'absolute') && R(e).width > 120 && R(e).height > 30 && !e.closest('.tbar') && !e.matches('.sr, .sr *'); }).map(e => e.className);
    return { years, cards, first: document.querySelector('#scr .rectl .row')?.textContent, view: window.__wb.ui.view, floating: flo, detail: !!document.querySelector('.recdetail'), toolbar: !!document.querySelector('#scr .tbar #rec-q'), cardsAbove: R(document.querySelector('#scr .recmore')).bottom <= R(tl.querySelector('.colhead')).top + 2, strip: getComputedStyle(tl).display };
  });
  ok('profile cards on top (About you, Skills and credentials), the timeline under them, newest year first, vertical', c.cards.includes('About you') && c.cards.some(x => /Skills/.test(x)) && c.cardsAbove && c.years[0] === 'Now' && +c.years[1] > +c.years.at(-1) && c.strip === 'block', JSON.stringify(c));
  ok('nothing floats over the timeline: no pop-over detail card, only the toolbar is above it', c.floating.length === 0 && !c.detail && c.toolbar, c.floating.join());
  const d = await page.evaluate(() => { const b = document.querySelector('#body'); return { name: b.querySelector('.oi-name')?.textContent.trim(), scopes: [...b.querySelectorAll('.scope')].map(x => x.textContent.trim()), det: b.querySelector('details.details')?.open, lines: b.querySelectorAll('.clrow .cb').length, sel: document.querySelectorAll('#scr .rectl .is-sel').length, inChecklist: !!document.querySelector('#scr #checklist .clg:not([style*=none]) .clrow') }; });
  ok('the newest entry is docked in the inspector, selected on the timeline, its lines to tick (Details folded, so they show without scrolling)', /Design Engineer/.test(d.name) && d.det === false && d.lines >= 5 && d.sel === 1, JSON.stringify(d));
  ok('both scopes are named: a change reaches every resume that prints it; ticks put lines on the open resume', /reaches every resume that prints it/.test(d.scopes[0]) && /Ticks put lines on Example Instruments/.test(d.scopes.at(-1)), d.scopes.join(' | '));
  await page.click('#scr .rectl .row:has-text("Prototyping Technician")'); await settle(page);
  ok('a click on another entry docks that one', /Prototyping Technician/.test(await page.textContent('#body .oi-name')) && await page.evaluate(() => document.querySelectorAll('#scr .rectl .is-sel').length) === 1);
  await page.click('#scr .recmore .srow:has-text("About you")'); await settle(page);
  ok('a card opens in the inspector too', /About you/.test(await page.textContent('#body .oi-name')));
  await page.fill('#rec-q', 'caliper'); await settle(page, 500);
  const q = await page.evaluate(() => ({ name: document.querySelector('#body .oi-name')?.textContent.trim(), hit: [...document.querySelectorAll('#body .clrow.qhit')].map(x => x.textContent.trim().slice(0, 40)), focus: document.activeElement?.id, shown: [...document.querySelectorAll('#scr .rectl [data-grp]')].filter(b => b.style.display !== 'none').length }));
  ok('search finds a line: its entry is selected and the line is marked (and the caret stays in the search box)', /caliper/i.test(q.name + q.hit.join()) && q.hit.length >= 1 && q.focus === 'rec-q' && q.shown >= 1, JSON.stringify(q));
  await page.fill('#rec-q', ''); await settle(page);
  // a tick, with the focus kept
  await page.click('#scr .rectl .row:has-text("Design Engineer")'); await settle(page);
  const cb = page.locator('#body .clrow .cb').nth(3); await cb.focus(); const was = await cb.isChecked(); await page.keyboard.press('Space'); await settle(page, 500);
  ok('a tick in the inspector changes the open resume and keeps the focus on the tick', await page.evaluate(w => document.activeElement?.classList.contains('cb') && document.activeElement.checked === !w, was));
  // typing in a Details field is not redrawn away
  await page.click('#body details.details summary'); await settle(page, 200);
  await page.fill('#c-loc', 'Porto, Portugal'); await settle(page, 300);
  ok('what is typed in a field of the entry\u2019s Details stays there', await page.inputValue('#c-loc') === 'Porto, Portugal');
  await page.fill('#rec-q', 'zzz-nothing'); await settle(page, 300); await page.fill('#rec-q', ''); await settle(page, 300);
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
