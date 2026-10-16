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
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});

const open = async (w, h, look = []) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([d, t]) => { try { localStorage.setItem('rb-help-seen', '1'); if (d) { localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); } } catch { /* none */ } }, look);
  const page = await ctx.newPage();
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
  const trip = async (name, ...a) => { try { await trip1(name, ...a); } catch (e) { ok(name, false, String(e.message).split('\n')[0]); } };
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
  { // an off section stays in its own row, dimmed, with the same pill; the pill turns it on again in place
    const c0 = await cur(), l0 = await label('#outline .srow[data-sid=skills] input[data-secon=skills]');
    const order = () => page.$$eval('#seclist > .osec', es => es.map(e => e.dataset.sid).join());
    const o0 = await order();
    await page.click('#outline .srow[data-sid=skills] .swl'); await wait();
    const c1 = await cur(), l1 = await label('#outline .srow[data-sid=skills] input[data-secon=skills]');
    const dim = await page.$eval('#outline .srow[data-sid=skills]', e => ({ off: e.classList.contains('is-off'), name: parseFloat(getComputedStyle(e.querySelector('.stext')).opacity) }));
    ok('an off section keeps its row in its place, dimmed, with the same pill now saying "Show … on this resume", and there is no "Not on this resume" row', (await order()) === o0 && dim.off && dim.name < 1 && SHOW.test(l1) && !(await pillOn('#outline .srow[data-sid=skills] input[data-secon=skills]')) && !(await page.$('#offline, .offchip')), JSON.stringify([dim, l1]));
    await page.click('#outline .srow[data-sid=skills] .swl'); await wait();
    ok('section, on its row in the Outline: the pill says "Hide … from this resume", hides it, and turning it on again in place restores the recipe', HIDE.test(l0) && c1 !== c0 && (await cur()) === c0 && (await order()) === o0, l0);
  }

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
{
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
  await ctx.close();
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} symmetry check(s) FAILED` : '\nall symmetry checks passed');
process.exit(failed ? 1 : 0);
