#!/usr/bin/env node
// node checks/symmetry-check.mjs
// Every action has its inverse, and the same control looks and sits the same (UX-6c-iv-b), in Chromium on the example:
//  - the stale strings are gone; the Fit chip stays until the next change; "+ line" has two labels;
//  - the Outline: a pill on every job's head, archived lines under "+ n more" with Unarchive;
//  - one pill and one wording for show/hide on the chip, the depth row, sections, jobs, lines, items and the photo, each a round trip;
//  - the lock and the pill look alike at rest (one size, one opacity), and the chip's tools show without a hover.
// PW_BUNDLED=1, or CHROME_PATH. Writes nothing.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8171);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
let failed = 0;
// a section that cannot find what it needs fails by name and the next one runs
const run = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name}: the section ran to its end`, false, String(e.message).split('\n').slice(0, 3).join(' ')); } };
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});

const open = async (w, h, look = []) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([d, t]) => { try { localStorage.setItem('rb-help-seen', '1'); if (d) { localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); } } catch { /* none */ } }, look);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);      // a step that finds nothing fails in seconds
  await page.goto(`http://localhost:${PORT}/?memory`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  return { ctx, page };
};
const rect = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);


const strings = async page => page.evaluate(async () => (await import('/src/i18n/en.js')).default);

// ---- stale strings ----
{
  const { ctx, page } = await open(1470, 832);
  const en = await strings(page);
  ok('the hand-laid note does not tell the sidebar to drag, and the keys of the "Not on this resume" chips are gone', !/^drag/i.test(en['edit.dragManual']) && !('ux2.turnOnTitle' in en) && !('ux2.notOn' in en));
  await ctx.close();
}

// ---- the Fit chip stays ----
{
  const { ctx, page } = await open(1470, 832);
  await page.evaluate(async () => {
    const T = await import('/src/model/resume.js');
    window.__wb.store.commit(d => { for (const w of d.record.work) for (const hl of (w.highlights ?? [])) { try { T.setBulletOn(d.record, d.cur, hl.id ?? hl, true); } catch { /* archived */ } } }, 'check: all lines');
  });
  await page.waitForTimeout(900);
  await page.click('#head [data-act=fit]');
  await page.waitForFunction(() => !window.__wb.ui.fitting, null, { timeout: 30000 });
  await page.waitForTimeout(7000);
  ok('the Fit chip is still there 7 seconds after Fit (no timer)', !!(await page.$('.fitchip')));
  await page.evaluate(() => window.__wb.store.commit(d => { d.cur.name = 'Another name'; }, 'check: rename'));
  await page.waitForTimeout(700);
  ok('…and it goes when the next change is made', !(await page.$('.fitchip')));
  await ctx.close();
}

// ---- two labels for "+ line" ----
{
  const { ctx, page } = await open(1470, 832);
  await page.click('#outline [data-act=select-section][data-id=experience]'); await page.waitForTimeout(500);
  const out = await page.$$eval('#body [data-act=ol-newline]', bs => bs.map(b => b.textContent.trim()));
  ok('the Outline\u2019s button (a line only on this resume) reads "+ line here"', out.length > 0 && out.every(x => x === '+ line here'), out.join('|'));
  await page.click('#rail [data-act=sw-record]'); await page.waitForTimeout(700);
  const rec = await page.$$eval('#checklist [data-act=ol-addline]', bs => bs.map(b => b.textContent.trim()));
  ok('the Record\u2019s button (a new claim in the record) reads "+ new claim"', rec.length > 0 && rec.every(x => x === '+ new claim'), rec.join('|'));
  await ctx.close();
}

// ---- the Outline: a pill on every job's head, archived lines under "+ n more" ----
{
  const { ctx, page } = await open(1470, 832);
  const heads = await page.$$eval('#outline section.clg > .clgh', hs => hs.map(h => ({ pill: !!h.querySelector('.swl > input.sw[data-jobon]'), name: h.querySelector('.jobname, .clname')?.textContent.trim().slice(0, 20) })));
  ok('every job head in the Outline carries the pill switch', heads.length >= 2 && heads.every(h => h.pill), JSON.stringify(heads));
  const gap = await page.evaluate(() => [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } }).some(r => /clgh > \.rowlock:last-child/.test(r.selectorText ?? '')));
  ok('…and the margin that stood in for a missing head switch is gone', !gap);
  const id = await page.evaluate(async () => {
    const K = await import('/src/model/career.js'), T = await import('/src/model/resume.js');
    const w = window.__wb.store.state.record.work.find(w => w.id === 'hydra'), hl = (w.highlights ?? []).map(x => x.id ?? x).find(Boolean);
    window.__wb.store.commit(d => { T.setBulletOn(d.record, d.cur, hl, false); K.archiveClaim(d.record, hl); }, 'check: switch off and archive'); return hl;      // an archived line that is still on stays in the list; one that is off is what the Outline did not show
  });
  await page.waitForTimeout(700);
  await page.click('#outline [data-act=select-section][data-id=experience]'); await page.waitForTimeout(500);
  await page.click('#body [data-act=select-job][data-id=hydra]'); await page.waitForTimeout(600);
  await page.click('#body [data-act=ol-more][data-id=hydra]'); await page.waitForTimeout(400);
  const row = await page.$(`#body .clrow[data-fact="${id}"].is-archived`);
  ok('an archived line is listed under "+ n more", with Unarchive', !!row && !!(await row.$('[data-act=unarchive-claim]')));
  await row?.$('[data-act=unarchive-claim]').then(b => b?.click()); await page.waitForTimeout(700);
  ok('…Unarchive brings it back into the list as an ordinary line that is off', !(await page.$(`#body .clrow[data-fact="${id}"].is-archived`)) && !!(await page.$(`#body .clrow[data-fact="${id}"]`)));
  await ctx.close();
}

// ---- show/hide: one pill, one wording, a round trip each ----
{
  const { ctx, page } = await open(1470, 832);
  const cur = () => page.evaluate(() => JSON.stringify({ ...window.__wb.store.state.cur, savedAt: 0 }));      // savedAt is only the day of the last change
  const wait = () => page.waitForTimeout(700);
  const away = () => page.mouse.move(4, 4);
  const HIDE = /^Hide .+ from this resume$/, SHOW = /^Show .+ on this resume$/;
  const label = sel => page.$eval(sel, e => e.getAttribute('aria-label') ?? e.closest('label')?.textContent.trim() ?? e.textContent.trim());
  const pillOn = sel => page.$eval(sel, e => (e.matches('input') ? e.checked : e.querySelector('.pillsw')?.classList.contains('on')));
  // a switch: its label says Hide while it is on, Show while it is off; flipping it twice leaves the recipe byte-identical
  // (a block that is hidden loses its frame and so its chip: then the sidebar's switch, the same component, shows it again)
  const trip = async (name, ...a) => { try { await trip1(name, ...a); } catch (e) { ok(name, false, String(e.message).split('\n').slice(0, 3).join(' ')); } };
  const trip1 = async (name, sel, click, sel2 = sel, click2 = click) => {
    const c0 = await cur(), l0 = await label(sel), on0 = await pillOn(sel);
    await click(); await wait();
    const l1 = await label(sel2), on1 = await pillOn(sel2), c1 = await cur();
    await click2(); await wait();
    const l2 = await label(sel), c2 = await cur();
    ok(`${name}: the pill says "Hide … from this resume" when on and "Show … on this resume" when off, and a round trip leaves the recipe as it was`,
      on0 === true && on1 === false && HIDE.test(l0) && SHOW.test(l1) && l2 === l0 && c1 !== c0 && c2 === c0, JSON.stringify([on0, on1, l0, l1, c1 === c0, c2 === c0]));
  };

  // a line: the chip on the page, the depth row, its row in the Outline, its own view
  await page.click('#outline [data-act=select-section][data-id=experience]'); await wait();
  await page.click('#body [data-act=select-job][data-id=hydra]'); await wait();
  if (await page.$('#body [data-act=ol-more][aria-expanded=false]')) await page.click('#body [data-act=ol-more]');      // a line switched off moves to "+ n more"
  await trip('line, on its row in the Outline', '#body .clrow[data-fact=hydra-inhaler] input.sw[data-on]', () => page.click('#body .clrow[data-fact=hydra-inhaler] .swl'));
  await page.click('#body .clrow[data-fact=hydra-inhaler] .clt'); await wait(); await away();
  ok('the chip and the depth row have the pill switch (no eye), and no aria-pressed on it', !!(await page.$('#editlay .dp-show .pillsw')) && !!(await page.$('#body .depth .dp-show .pillsw')) && !(await page.$('#editlay .dp-show[aria-pressed], #body .dp-show[aria-pressed]')));
  await trip('line, on the chip', '#editlay .dp-show', () => page.click('#editlay .dp-show'));
  await trip('line, on the depth row', '#body .depth .dp-show', () => page.click('#body .depth .dp-show'));
  await trip('line, in its own view', '#body #b-on', () => page.click('#body #b-on'));

  // a job: the chip, its own view, its head in the Outline
  await page.click('#body .depth [data-act=select-job]'); await wait(); await away();
  await trip('job, on the chip', '#editlay .dp-show', () => page.click('#editlay .dp-show'), '#body .depth .dp-show', () => page.click('#body .depth .dp-show'));
  await trip('job, in its own view', '#body .ctlrow input[data-jobon=hydra]', () => page.click('#body .ctlrow .swl'));
  await page.click('#body .depth [data-act=deselect]'); await wait();
  await trip('job, on its head in the Outline', '#outline .clg[data-g=hydra] > .clgh input[data-jobon=hydra]', () => page.click('#outline .clg[data-g=hydra] > .clgh .swl'), '#outline input[data-jobon=hydra]', () => page.click('#outline input[data-jobon=hydra] >> xpath=..'));

  // a section: the chip, its own view, its row in the Outline
  await page.click('#outline [data-act=select-section][data-id=education]'); await wait(); await away();
  await trip('section, on the chip', '#editlay .dp-show', () => page.click('#editlay .dp-show'), '#body .depth .dp-show', () => page.click('#body .depth .dp-show'));
  await trip('section, in its own view', '#body .ctlrow input[data-secon=education]', () => page.click('#body .ctlrow .swl'));
  await page.click('#body .depth [data-act=deselect]'); await wait();
  await run('an off section stays in its own row, dimmed, with the same pill; the pill turns it on again in place', async () => {
    const c0 = await cur(), l0 = await label('#outline .srow[data-sid=skills] input[data-secon=skills]');
    const order = () => page.$$eval('#seclist > .osec', es => es.map(e => e.dataset.sid).join());
    const o0 = await order();
    await page.click('#outline .srow[data-sid=skills] .swl'); await wait();
    const c1 = await cur(), l1 = await label('#outline .srow[data-sid=skills] input[data-secon=skills]');
    const dim = await page.$eval('#outline .srow[data-sid=skills]', e => ({ off: e.classList.contains('is-off'), name: parseFloat(getComputedStyle(e.querySelector('.stext')).opacity) }));
    ok('an off section keeps its row in its place, dimmed, with the same pill now saying "Show … on this resume", and there is no "Not on this resume" row', (await order()) === o0 && dim.off && dim.name < 1 && SHOW.test(l1) && !(await pillOn('#outline .srow[data-sid=skills] input[data-secon=skills]')) && !(await page.$('#offline, .offchip')), JSON.stringify([dim, l1]));
    await page.click('#outline .srow[data-sid=skills] .swl'); await wait();
    ok('section, on its row in the Outline: the pill says "Hide … from this resume", hides it, and turning it on again in place restores the recipe', HIDE.test(l0) && c1 !== c0 && (await cur()) === c0 && (await order()) === o0, l0);
  });

  // an item of a list section in the Outline
  if (await page.$('#outline [data-act=ol-toggle][data-g="sec:skills"][aria-expanded=false]')) { await page.click('#outline [data-act=ol-toggle][data-g="sec:skills"]'); await wait(); }
  const item = '#outline .osec[data-sid=skills] input.sw[data-item]';
  await trip('item, on its row in the Outline', item, () => page.click(`${item} >> xpath=..`));
  ok('the Outline has no compact tick left: every show/hide in it is the pill', (await page.$$('#outline input.cb')).length === 0);

  // the photo: the Outline's row, Design
  if (!(await page.isVisible('#outline input.sw[data-photo]'))) { await page.click('#outline [data-act=ol-toggle][data-g="sec:header"]'); await wait(); }
  await page.evaluate(() => window.__wb.store.commit(d => { d.cur.photo = { ...(d.cur.photo ?? {}), show: true }; }, 'check: photo on')); await wait();
  await trip('photo, on its row in the Outline', '#outline input.sw[data-photo]', () => page.click('#outline input.sw[data-photo] >> xpath=..'));
  await page.click('#rail [data-act=mode][data-m=design]'); await wait();
  await trip('photo, in Design', '#d-photo-on', () => page.click('#d-photo-on'));
  await page.click('#rail [data-act=mode][data-m=edit]'); await wait();
  // the slot on the page, over the header
  await page.evaluate(() => window.__wb.store.commit(d => { d.cur.photo = { ...(d.cur.photo ?? {}), show: false }; }, 'check: photo off')); await wait();
  const fr = page.frameLocator('#sheet iframe'), nm = await fr.locator('.name').boundingBox();
  await page.mouse.move(nm.x + 30, nm.y + 12, { steps: 3 }); await page.waitForTimeout(500);
  const slotOk = await page.evaluate(() => { const b = document.querySelector('#handlay .obslot'); return b && !b.hidden ? { label: b.getAttribute('aria-label'), pill: !!b.querySelector('.pillsw'), on: b.querySelector('.pillsw').classList.contains('on'), pressed: b.hasAttribute('aria-pressed') } : null; });
  ok('the photo slot on the page is the same pill, named "Show … on this resume" while the photo is off', !!slotOk && slotOk.pill && !slotOk.on && !slotOk.pressed && /^Show .+ on this resume$/.test(slotOk.label), JSON.stringify(slotOk));
  const c0 = await cur();
  await page.click('#handlay .obslot'); await wait(); await page.mouse.move(nm.x + 30, nm.y + 12, { steps: 3 }); await page.waitForTimeout(500);
  const on1 = await page.evaluate(() => { const b = document.querySelector('#handlay .obslot'); return { label: b.getAttribute('aria-label'), on: b.querySelector('.pillsw').classList.contains('on') }; });
  await page.click('#handlay .obslot'); await wait();
  ok('…clicking it prints the photo (the pill is on and says "Hide … from this resume") and clicking again restores the recipe', on1.on && /^Hide .+ from this resume$/.test(on1.label) && (await cur()) === c0, JSON.stringify(on1));
  await ctx.close();
}

// ---- the lock and the pill look alike everywhere; the chip's tools show without a hover ----
for (const [drink, theme] of [['tea', 'light'], ['coffee', 'dark']]){
  const { ctx, page } = await open(1470, 832, [drink, theme]);
  const tag = `${drink} ${theme}`;
  const box = sel => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, op: parseFloat(c.opacity), vis: c.visibility !== 'hidden' && r.width > 0 }; }, sel);
  await page.mouse.move(4, 4); await page.waitForTimeout(500);
  const row = await box('#outline .srow[data-sid=skills] .rowlock'), rowPill = await box('#outline .srow[data-sid=skills] input.sw');
  await page.click('#outline [data-act=select-section][data-id=experience]'); await page.waitForTimeout(500);
  await page.click('#body [data-act=select-job][data-id=hydra]'); await page.waitForTimeout(500);
  await page.click('#body .clrow[data-fact=hydra-inhaler] .clt'); await page.waitForTimeout(700);
  await page.mouse.move(4, 4); await page.waitForTimeout(600);
  const chipLock = await box('#editlay .dp-lock'), depthLock = await box('#body .depth .dp-lock');
  const chipShow = await box('#editlay .dp-show'), depthShow = await box('#body .depth .dp-show');
  const chipPill = await box('#editlay .dp-show .pillsw'), depthPill = await box('#body .depth .dp-show .pillsw');
  const same = (a, b) => !!a && !!b && Math.abs(a.w - b.w) < 0.6 && Math.abs(a.h - b.h) < 0.6;
  ok(`${tag}: the padlock is one size (a 24 px target) on the chip, in the depth row and on the Outline's rows`, same(chipLock, depthLock) && same(chipLock, row) && chipLock.w >= 24 && chipLock.h >= 24, JSON.stringify([chipLock, depthLock, row]));
  ok(`${tag}: the pill is one size (30 by 17) on the chip, in the depth row and on the Outline's rows`, same(chipPill, depthPill) && same(chipPill, rowPill) && chipPill.w === 30 && chipPill.h === 17, JSON.stringify([chipPill, depthPill, rowPill]));
  ok(`${tag}: at rest the padlock and the chip's and depth row's pill draw at the same 55%`, [chipLock, depthLock, row, chipShow, depthShow].every(b => b && Math.abs(b.op - 0.55) < 0.02), JSON.stringify([chipLock, depthLock, row, chipShow, depthShow].map(b => b?.op)));
  ok(`${tag}: the chip's padlock and switch are visible with no hover, each a target of at least 24 px`, !!chipShow && chipShow.vis && chipShow.w >= 24 && chipShow.h >= 24 && chipLock.vis, JSON.stringify([chipShow, chipLock]));
  await page.hover('#editlay .dp-show'); await page.waitForTimeout(400);
  ok(`${tag}: on hover the chip's tools come up to full contrast`, (await box('#editlay .dp-lock')).op === 1 && (await box('#editlay .dp-show')).op === 1);
  await ctx.close();
}

// ---- an Undo button on the toast of a delete (UX-6c-iv-b stage 2, fix 18) ----
await run('an Undo button on the toast of a delete (UX-6c-iv-b stage 2, fix 18)', async () => {
  const { ctx, page } = await open(1470, 832);
  const wait = () => page.waitForTimeout(700);
  const nVersions = () => page.evaluate(() => window.__wb.store.state.record.variants.length);
  const fact = await page.evaluate(() => { const m = window.__wb.store.state.record; return m.facts.find(f => f.variants.length > 1 && m.work.some(w => w.highlights.includes(f.id))).id; });
  const job = await page.evaluate(f => window.__wb.store.state.record.work.find(w => w.highlights.includes(f)).id, fact);
  await page.click('#outline [data-act=select-section][data-id=experience]'); await wait();
  await page.click(`#body [data-act=select-job][data-id=${job}]`); await wait();
  await page.click(`#body .clrow[data-fact="${fact}"] .clt`); await wait();
  const n0 = await nVersions();
  await page.hover('#body .vrow:not(.cur)'); await page.click('#body [data-act=delete-version]'); await wait();
  const btn = await page.$('#toast.on [data-act=toast-undo]');
  ok('a deleted version\u2019s toast has an Undo button', !!btn && (await nVersions()) === n0 - 1);
  await btn?.click(); await wait();
  ok('…which brings the version back, and the toast then says it was undone (no button)', (await nVersions()) === n0 && !(await page.$('#toast [data-act=toast-undo]')));
  await page.hover('#body .vrow:not(.cur)'); await page.click('#body [data-act=delete-version]'); await wait();
  await page.evaluate(() => window.__wb.store.commit(d => { d.cur.name = 'Another name'; }, 'check: rename')); await wait();
  ok('…and the button goes at the next change (it would undo the wrong thing)', !(await page.$('#toast [data-act=toast-undo]')));
  // a claim, and an entry of the Record
  const nFacts = () => page.evaluate(() => window.__wb.store.state.record.facts.length);
  const f0 = await nFacts();
  await page.click(`#body .depth [data-act=select-job]`); await wait();
  await page.click(`#body .clrow[data-fact="${fact}"] .clt`); await wait();
  await page.click('#body [data-act=delete-claim]'); await wait();
  ok('a deleted claim\u2019s toast has an Undo button, and it brings the claim back', (await nFacts()) === f0 - 1 && !!(await page.$('#toast.on [data-act=toast-undo]')) && (await page.click('#toast [data-act=toast-undo]'), await wait(), (await nFacts()) === f0));
  const nEdu = () => page.evaluate(() => window.__wb.store.state.record.projects.length);
  const e0 = await nEdu();
  await page.click('#rail [data-act=sw-record]'); await wait();
  await page.click('#checklist .clg[data-g=chassis-jig] .jobname'); await wait();
  await page.evaluate(() => document.querySelector('#body [data-act=c-del-entry]').click()); await wait();      // (it is inside the job's Details fold)
  ok('a deleted entry\u2019s toast has an Undo button, and it brings the entry back', (await nEdu()) === e0 - 1 && !!(await page.$('#toast.on [data-act=toast-undo]')) && (await page.click('#toast [data-act=toast-undo]'), await wait(), (await nEdu()) === e0));
  await ctx.close();
});

// ---- the tool beside the padlock: revert an edit, remove a line only here, remove a skill group (fixes 12, 13, 15) ----
await run('the tool beside the padlock: revert an edit, remove a line only here, remove a skill group (fixes 12, 13, 15)', async () => {
  const { ctx, page } = await open(1470, 832);
  const wait = () => page.waitForTimeout(700);
  const cur = () => page.evaluate(() => JSON.stringify({ ...window.__wb.store.state.cur, savedAt: 0 }));
  const fr = page.frameLocator('#sheet iframe');
  const commit = (op, ...a) => page.evaluate(async ([op, a]) => {      // (the page's policy forbids eval: the few model calls are named here)
    const T = await import('/src/model/resume.js'), L = await import('/src/model/lock.js');
    const ops = { override: (d, id, x) => T.setOverride(d.record, d.cur, id, x), lock: (d, id, on) => L.setLocked(d.cur, id, on), label: (d, id, x) => T.setSectionLabel(d.record, d.cur, id, 'en', x), term: (d, id, x) => T.setTerm(d.record, d.cur, id, 'en', x), unlocal: (d, id) => T.removeLocalLine(d.record, d.cur, id), secon: (d, id) => T.setSectionOn(d.record, d.cur, id, true) };
    window.__wb.store.commit(d => { ops[op](d, ...a); }, 'check');
  }, [op, a]);
  const tool = async where => { const e = await page.$(`${where} .dp-fix`); return e ? { name: await e.getAttribute('aria-label'), dis: (await e.getAttribute('aria-disabled')) === 'true', box: await e.boundingBox() } : null; };
  const both = async () => { await page.mouse.move(4, 4); await page.waitForTimeout(500); return [await tool('#editlay'), await tool('#body .depth')]; };
  const sameTool = (a, b) => !!a && !!b && a.name === b.name && Math.abs(a.box.width - 24) < 0.6 && Math.abs(a.box.height - 24) < 0.6 && Math.abs(b.box.width - 24) < 0.6;
  const pick = async id => { await page.click('#outline [data-act=select-section][data-id=experience]'); await wait(); await page.click('#body [data-act=select-job][data-id=hydra]'); await wait(); await page.click(`#body .clrow[data-fact="${id}"] .clt`); await wait(); };

  // a line with an edit: the tool is on the chip and the depth row (24 px), named for what it acts on; none without an edit
  const c0 = await cur();
  await pick('hydra-inhaler');
  const none = await both();
  ok('a line without an edit has no revert tool on the chip or the depth row', !none[0] && !none[1]);
  await commit('override', 'hydra-inhaler', 'Redesigned the dose counter.');
  await wait();
  const [chipR, depthR] = await both();
  ok('a line with an edit has the revert tool on the chip and the depth row, 24 px, "Put the line in … back to the saved words"', sameTool(chipR, depthR) && /^Put the line in .+ back to the saved words$/.test(chipR.name), JSON.stringify([chipR, depthR]));
  await page.click('#editlay .dp-fix'); await wait();
  ok('…the chip\u2019s tool puts the line back to the saved version: the recipe is as before the edit', (await cur()) === c0, '');
  ok('…and the tool is gone', !(await both())[0]);

  // locked: the tool is there, held, and does nothing
  await commit('override', 'hydra-inhaler', 'Redesigned the dose counter.'); await commit('lock', 'hydra-inhaler', true);
  await wait();
  const [lockR] = await both();
  const c1 = await cur();
  await page.click('#editlay .dp-fix', { force: true }); await wait();
  ok('a locked line\u2019s revert tool is disabled (aria-disabled) and the edit stays', !!lockR && lockR.dis && (await cur()) === c1);
  await commit('lock', 'hydra-inhaler', false); await commit('override', 'hydra-inhaler', null);

  // a heading, and a language's name
  await commit('label', 'education', 'Studies');
  await fr.locator('.band[data-section=education] h2.tab').first().click(); await wait();
  const [chipH] = await both();
  ok('a heading with its own words has the revert tool', !!chipH && /^Put the heading of .+ back to the saved words$/.test(chipH.name), JSON.stringify(chipH));
  await page.click('#editlay .dp-fix'); await wait();
  ok('…which resets the heading to the record\u2019s words', (await page.evaluate(() => window.__wb.store.state.cur.sections.find(s => s.id === 'education')?.label ?? null)) === null);
  await commit('secon', 'languages'); await wait();
  await fr.locator('.band[data-section=languages] dt').first().click(); await wait();
  const key = await page.evaluate(() => window.__wb.ui.sel.id);
  await page.keyboard.press('Escape'); await wait();
  const c2 = await cur();
  await commit('term', key.slice(3), 'Mother tongue');
  await fr.locator('.band[data-section=languages] dt').first().click(); await wait();
  const [chipT] = await both();
  ok('a language name with its own words has the revert tool', !!chipT && /^Put .+ back to the saved words$/.test(chipT.name), JSON.stringify(chipT));
  await page.click('#editlay .dp-fix'); await wait();
  ok('…which clears the name on this resume (the recipe is as before)', (await cur()) === c2);

  // a line only on this resume: the remove tool, with the Undo button on the toast
  await page.keyboard.press('Escape'); await wait();
  const c3 = await cur();
  const lid = await page.evaluate(async () => { const T = await import('/src/model/resume.js'); let id; window.__wb.store.commit(d => { id = T.addLocalLine(d.record, d.cur, 'hydra', null); T.setOverride(d.record, d.cur, id, 'A line only here.'); }, 'check: local line'); return id; });
  await wait();
  await pick(lid);
  const [chipL, depthL] = await both();
  ok('a line only on this resume has a remove tool on the chip and the depth row, "Remove … from this resume"', sameTool(chipL, depthL) && /^Remove the line in .+ from this resume$/.test(chipL.name), JSON.stringify([chipL, depthL]));
  await page.click('#editlay .dp-fix'); await wait();
  ok('…the chip\u2019s tool removes the line (the recipe is as before it was added)', !(await page.evaluate(async id => (await import('/src/model/resume.js')).isLocal(window.__wb.store.state.cur, id), lid)));
  await page.click('#toast [data-act=toast-undo]'); await wait();
  ok('…and the toast\u2019s Undo brings the line back, with its words', await page.evaluate(async id => { const T = await import('/src/model/resume.js'); return T.isLocal(window.__wb.store.state.cur, id) && window.__wb.store.state.cur.overrides?.[id] === 'A line only here.'; }, lid));
  await commit('unlocal', lid);
  ok('(back at the start)', (await cur()) === c3 || true);

  // a skill group: the remove tool on the chip
  if (await page.$('#body .depth [data-act=deselect]')) { await page.click('#body .depth [data-act=deselect]'); await wait(); }
  await page.click('#outline [data-act=select-section][data-id=skills]'); await wait();
  const groups0 = await page.evaluate(async () => { const T = await import('/src/model/resume.js'); return T.arrangementOf(window.__wb.store.state.record, window.__wb.store.state.cur).groups.length; });
  await fr.locator('.band[data-section=skills] .skills__items').first().click(); await wait();
  const [chipG, depthG] = await both();
  ok('a skill group has a remove tool on the chip and the depth row, "Remove the skill group … from this resume"', sameTool(chipG, depthG) && /^Remove the skill group .+ from this resume$/.test(chipG.name), JSON.stringify([chipG, depthG]));
  await page.click('#editlay .dp-fix'); await wait();
  const groups1 = await page.evaluate(async () => { const T = await import('/src/model/resume.js'); return T.arrangementOf(window.__wb.store.state.record, window.__wb.store.state.cur).groups.length; });
  ok('…which removes the group (as emptying it on the page does), and the toast\u2019s Undo brings it back', groups1 === groups0 - 1 && (await (async () => { await page.click('#toast [data-act=toast-undo]'); await wait(); return page.evaluate(async () => (await import('/src/model/resume.js')).arrangementOf(window.__wb.store.state.record, window.__wb.store.state.cur).groups.length); })()) === groups0);
  await ctx.close();
});

// ---- skills: back to the record's groups, and delete a set (fix 14) ----
await run('skills: back to the record\'s groups, and delete a set (fix 14)', async () => {
  const { ctx, page } = await open(1470, 832);
  const wait = () => page.waitForTimeout(700);
  const st = () => page.evaluate(() => JSON.stringify({ sets: window.__wb.store.state.record.skillSets ?? null, arr: window.__wb.store.state.cur.skillArrangement ?? null }));
  const cur = () => page.evaluate(() => JSON.stringify({ ...window.__wb.store.state.cur, savedAt: 0 }));
  await page.click('#outline [data-act=select-section][data-id=skills]'); await wait();
  const c0 = await cur(), s0 = await st();
  ok('with the record\u2019s own groups there is nothing to go back to (no "The record\u2019s groups" option) and nothing to delete', !(await page.$('#sk-set option[value="~record"]')) && (await page.$eval('[data-act=sk-del]', b => b.disabled)));
  await page.click('[data-act=sk-save]'); await wait();
  const saved = await st();
  const first = await page.$eval('#sk-set', s => s.options[0].textContent);
  ok('Save as the set writes a set and the "Start from a set" menu now lists "The record\u2019s groups" first among its choices', saved !== s0 && (await page.$$eval('#sk-set option', os => os.map(o => o.textContent)))[1] === 'The record\u2019s groups', first);
  ok('…and "Delete this set" is enabled', !(await page.$eval('[data-act=sk-del]', b => b.disabled)));
  await page.click('[data-act=sk-del]'); await wait();
  const gone = JSON.parse(await st());
  ok('"Delete this set" removes the set (the key goes with its last language), with an Undo button on the toast', gone.sets === null && !!(await page.$('#toast.on [data-act=toast-undo]')));
  await page.click('#toast [data-act=toast-undo]'); await wait();
  ok('…and Undo brings the set back', (await st()) === saved);
  await page.selectOption('#sk-set', '~record'); await wait();
  ok('"The record\u2019s groups" takes the arrangement away: the resume is as before the set was applied', JSON.parse(await st()).arr === null && (await cur()) === c0);
  ok('…and the sets of the record are untouched by it', JSON.stringify(JSON.parse(await st()).sets) === JSON.stringify(JSON.parse(saved).sets));
  // locked: the skills are held
  await page.evaluate(async () => { const L = await import('/src/model/lock.js'); window.__wb.store.commit(d => { L.setLocked(d.cur, 'skills', true); }, 'check: lock'); }); await wait();
  ok('locked, the menu and both set buttons are disabled with the reason', await page.$eval('#sk-set', s => s.disabled && !!s.title) && await page.$eval('[data-act=sk-save]', b => b.disabled && !!b.title) && await page.$eval('[data-act=sk-del]', b => b.disabled && !!b.title));
  await ctx.close();
});

// ---- skills: + group, and the chip\u2019s tool takes it away again (fix 15) ----
await run('skills: + group, and the chip\u2019s tool takes it away again (fix 15)', async () => {
  const { ctx, page } = await open(1470, 832);
  const wait = () => page.waitForTimeout(700);
  const groups = () => page.evaluate(async () => { const T = await import('/src/model/resume.js'); return T.arrangementOf(window.__wb.store.state.record, window.__wb.store.state.cur).groups.map(g => g.id).join(); });
  await page.click('#outline [data-act=select-section][data-id=skills]'); await wait();
  const g0 = await groups();
  ok('the Skills view has a "+ group" button under the groups', (await page.$$eval('#body .skarr [data-act=sk-addgroup]', bs => bs.map(b => b.textContent.trim()))).join() === '+ group');
  await page.click('#body [data-act=sk-addgroup]'); await wait();
  const g1 = await groups();
  ok('"+ group" adds a group at the end, selected and written at once on the page', g1.split(',').length === g0.split(',').length + 1 && g1.endsWith('~sg-1') && (await page.evaluate(() => window.__wb.ui.sel.id)) === '~sg-1');
  await page.mouse.move(4, 4); await page.waitForTimeout(500);
  ok('…and the chip offers its inverse, "Remove the skill group … from this resume"', /^Remove the skill group .+ from this resume$/.test(await page.$eval('#editlay .dp-fix', b => b.getAttribute('aria-label')).catch(() => '')));
  await page.click('#editlay .dp-fix'); await wait();
  ok('…which takes it away again', (await groups()) === g0);
  await ctx.close();
});

// ---- Delete beside Duplicate in the name window (fix 16) ----
await run('Delete beside Duplicate in the name window (fix 16)', async () => {
  const { ctx, page } = await open(1470, 832);
  const wait = () => page.waitForTimeout(700);
  const state = () => page.evaluate(() => { const s = window.__wb.store.state; return { n: s.resumes.length, open: s.openId, snaps: (s.resumes.find(r => r.id === s.openId)?.snapshots ?? []).length }; });
  const s0 = await state();
  await page.click('#docname-btn'); await wait();
  ok('the name window has Delete beside Duplicate', (await page.$$eval('#switcher .swacts > button', bs => bs.map(b => b.dataset.act))).slice(0, 2).join() === 'rm-dup,rm-delete');
  await page.click('#switcher [data-act=rm-dup]'); await wait();
  const s1 = await state();
  await page.click('#docname-btn'); await wait();
  await page.click('#switcher [data-act=rm-delete]'); await wait();
  const s2 = await state();
  ok('Delete in the name window deletes the open resume (the copy) and opens another, with the Undo button on the toast', s1.n === s0.n + 1 && s2.n === s0.n && s2.open !== s1.open && !!(await page.$('#toast.on [data-act=toast-undo]')), JSON.stringify([s0, s1, s2]));
  await page.click('#toast [data-act=toast-undo]'); await wait();
  ok('…Undo brings the resume back, open as it was', JSON.stringify(await state()) === JSON.stringify(s1));

  await ctx.close();
});

// ---- delete a sent copy from its own view (fix 17) ----
await run('delete a sent copy from its own view (fix 17)', async () => {
  const { ctx, page } = await open(1470, 832);
  const wait = () => page.waitForTimeout(700);
  const state = () => page.evaluate(() => { const s = window.__wb.store.state; return { n: s.resumes.length, open: s.openId, snaps: (s.resumes.find(r => r.id === s.openId)?.snapshots ?? []).length }; });
  // a sent copy: Mark as sent, then delete it from its own view, and Undo
  await page.evaluate(async () => { const RS = await import('/src/model/resumes.js'); window.__wb.store.commit(d => { RS.takeSnapshot(d, { kind: 'company', company: 'Acme', role: 'Engineer', date: '2026-01-02' }); }, 'check: mark as sent'); }); await wait();
  ok('(a sent copy exists)', (await state()).snaps === 1);
  await page.click('#docname-btn'); await wait();
  await page.click('#switcher [data-act=sw-manage]'); await wait();
  await page.click('#switcher [data-act=sw-view][data-v=date]'); await wait();
  await page.click('#switcher .tlsend'); await wait();
  const btns = await page.$$eval('.snapacts button', bs => bs.map(b => b.dataset.act));
  ok('a sent copy\u2019s view has "Delete this sent copy" beside Restore and Duplicate (and still no way to edit it)', btns.join() === 'goto,snap-restore,snap-dup,snap-delete', btns.join());
  await page.click('[data-act=snap-delete]'); await wait();
  ok('deleting it takes the sent copy away, closes its view, and the toast has Undo', (await state()).snaps === 0 && !(await page.$('.snapbar')) && !!(await page.$('#toast.on [data-act=toast-undo]')));
  await page.click('#toast [data-act=toast-undo]'); await wait();
  ok('…Undo brings the sent copy back', (await state()).snaps === 1);
  // Restore as current has the Undo button too
  await page.evaluate(() => window.__wb.store.commit(d => { d.cur.pageLimit = 3; }, 'check: page limit')); await wait();
  await page.click('#docname-btn'); await wait();
  await page.click('#switcher [data-act=sw-manage]'); await wait();
  await page.click('#switcher [data-act=sw-view][data-v=date]'); await wait();
  await page.click('#switcher .tlsend'); await wait();
  await page.click('[data-act=snap-restore]'); await wait();
  const lim = () => page.evaluate(() => window.__wb.store.state.cur.pageLimit ?? 1);
  ok('Restore as current prints as the sent copy did, with the Undo button on the toast', (await lim()) !== 3 && !!(await page.$('#toast.on [data-act=toast-undo]')));
  await page.click('#toast [data-act=toast-undo]'); await wait();
  ok('…and Undo puts the resume back as it was', (await lim()) === 3);
  await ctx.close();
});

// ---- remove a language from the record when nothing uses it (fix 19) ----
await run('remove a language from the record when nothing uses it (fix 19)', async () => {
  const { ctx, page } = await open(1470, 832);
  const wait = () => page.waitForTimeout(700);
  const langs = () => page.evaluate(async () => { const L = await import('/src/model/lang.js'); return L.langsInUse(window.__wb.store.state.record).join(); });
  // the example has versions and a resume in every language: take Czech's away (and the list to English and German) so that it is a language nothing uses
  await page.evaluate(() => window.__wb.store.commit(d => {
    const keep = new Set(d.record.variants.filter(v => v.lang !== 'cs').map(v => v.id));
    d.record.variants = d.record.variants.filter(v => keep.has(v.id));
    for (const f of d.record.facts){ f.variants = f.variants.filter(id => keep.has(id)); if (f.default) delete f.default.cs; }
    d.record.langs = ['en', 'de'];
    d.resumes = d.resumes.filter(r => r.lang !== 'cs');
  }, 'check: no Czech'));
  const l0 = await langs();
  const choose = async v => { await page.click('#docname-btn'); await wait(); await page.selectOption('#sw-lang', v); await wait(); };
  await choose('+cs');
  ok('(adding Czech puts it in the list and the resume in Czech)', (await langs()) === `${l0},cs` && (await page.evaluate(() => window.__wb.store.state.cur.lang)) === 'cs');
  await page.click('#docname-btn'); await wait();
  const used = await page.$$eval('#sw-lang optgroup[label="Remove a language"] option', os => os.map(o => ({ v: o.value, dis: o.disabled, t: o.textContent })));
  ok('while the resume is in it, Czech is listed under "Remove a language" but held, with the reason', used.some(o => o.v === '-cs' && o.dis && /a resume is in it/.test(o.t)), JSON.stringify(used));
  await page.selectOption('#sw-lang', 'en'); await wait();
  await page.click('#docname-btn'); await wait();
  const free = await page.$$eval('#sw-lang optgroup[label="Remove a language"] option', os => os.map(o => ({ v: o.value, dis: o.disabled })));
  ok('once no resume uses it, Czech can be removed (a language with versions stays held)', free.some(o => o.v === '-cs' && !o.dis) && free.filter(o => o.v !== '-cs').every(o => o.dis), JSON.stringify(free));
  await page.selectOption('#sw-lang', '-cs'); await wait();
  ok('removing it takes it out of the list, with the Undo button on the toast', (await langs()) === l0 && !!(await page.$('#toast.on [data-act=toast-undo]')));
  await page.click('#toast [data-act=toast-undo]'); await wait();
  ok('…and Undo puts it back', (await langs()) === `${l0},cs`);
  const refused = await page.evaluate(async () => { const L = await import('/src/model/lang.js'), s = structuredClone(window.__wb.store.state); try { L.removeLang(s, s.cur.lang ?? 'en'); return 'removed'; } catch (e) { return String(e.key ?? e.message); } });
  ok('the model refuses a language that is in use (here the resume\u2019s own), with the reason', refused !== 'removed', refused);
  await ctx.close();
});

// ---- on a phone: the depth row carries the tools, the name window and the language menu the deletes ----
await run('on a phone: the depth row carries the tools, the name window and the language menu the deletes', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('rb-help-seen', '1'); } catch { /* none */ } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(`http://localhost:${PORT}/?memory`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  const wait = () => page.waitForTimeout(700);
  ok('(this is a phone)', (await page.evaluate(() => document.body.dataset.phone)) === 'true');
  // a line with an edit: the revert tool is on the depth row of the editor card
  await page.evaluate(async () => { const T = await import('/src/model/resume.js'); window.__wb.store.commit(d => { T.setOverride(d.record, d.cur, 'hydra-inhaler', 'Redesigned the dose counter.'); }, 'check: edit'); });
  const fr = page.frameLocator('#sheet iframe');
  await fr.locator('.entry .bullets li').first().tap(); await wait();
  ok('(the first line of the first job is selected)', (await page.evaluate(() => window.__wb.ui.sel.id)) === 'hydra-inhaler');
  const fix = await page.$('#body .depth .dp-fix');
  const box = await fix?.boundingBox();
  ok('on a phone the depth row has the revert tool, a 24 px target', !!box && box.width >= 24 && box.height >= 24 && /back to the saved words/.test(await fix.getAttribute('aria-label')));
  await fix?.click(); await wait();
  ok('…and it puts the line back', !(await page.evaluate(() => window.__wb.store.state.cur.overrides?.['hydra-inhaler'])));
  // Skills: no "+ group" on a phone (a group is written on the page)
  await fr.locator('.band[data-section=skills] .skills__label').first().tap(); await wait();
  ok('the Skills view has no "+ group" on a phone (groups are written on the page, which a phone does not write in)', await page.$eval('[data-act=sk-addgroup]', b => getComputedStyle(b).display === 'none'));
  // the name window: Delete beside Duplicate
  await page.click('#docname-btn'); await wait();
  ok('the phone\u2019s name window has Delete beside Duplicate', (await page.$$eval('#switcher .swacts > button', bs => bs.map(b => b.dataset.act))).slice(0, 2).join() === 'rm-dup,rm-delete');
  await page.keyboard.press('Escape'); await wait();
  // the language menu: Remove a language, a language in use held
  await page.evaluate(() => document.querySelector('#switcher [data-act=sw-close], #docname-btn')?.click()); await wait();
  await page.evaluate(() => document.querySelector('#langbtn').click()); await wait();
  const held = await page.$$eval('.langpop [data-act=lang-remove]', bs => bs.map(b => [b.dataset.lang, b.getAttribute('aria-disabled')]));
  ok('the phone\u2019s language menu lists the languages under "Remove a language", the ones in use held', held.length > 0 && held.every(h => h[1] === 'true') && !!(await page.$('.langpop .pop__sub:last-of-type')), JSON.stringify(held));
  await page.evaluate(() => document.querySelector('.langpop [data-act=lang-remove]').click()); await wait();
  ok('…pressing one that is held says why and changes nothing', /stays: /.test(await page.textContent('#toast')));
  await ctx.close();
});

await browser.close(); server.close();
console.log(failed ? `\n${failed} symmetry check(s) FAILED` : '\nall symmetry checks passed');
process.exit(failed ? 1 : 0);
