#!/usr/bin/env node
// node checks/review-ui-check.mjs
// The Review list's behaviour after the UX-6d review, in Chromium on the fictional example:
//   - a resume whose company is markup shows as text in the Update note, never as an element,
//   - 'Use all the newer wording' is one commit and one undo step and skips a locked line,
//   - the Another-option select only chooses: nothing is written until Apply, and a Replace says who else prints the version,
//   - a heading that another resume locks is not offered for every resume,
//   - Ctrl+S, O and P inside the dialog do not reach the browser, and Ctrl+S saves; a failed save keeps the dialog open,
//   - Save to file opens the list for edits and headings, not for newer wording alone.
// Chromium through Playwright (PW_BUNDLED=1, or CHROME_PATH); writes nothing.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8176);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
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

async function fresh(){
  const ctx = await browser.newContext({ viewport: { width: 1470, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('rb-help-seen', '1'); } catch { /* none */ } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.waitForFunction(() => !window.__wb.busy(), null, { timeout: 10000 });
  return { ctx, page, errs };
}
const R = '#review';
const block = async fn => { try { await fn(); } catch (e){ ok('a block ran without an error', false, String(e.message).split('\n')[0]); } };
const undoN = page => page.evaluate(() => window.__wb.store.history.undo);
const isOpen = page => page.evaluate(() => window.__wb.review.isOpen);
const openList = async page => { await page.evaluate(() => window.__wb.review.open()); await page.waitForSelector(`${R}[open]`); };
const closeList = async page => { if (await isOpen(page)) await page.keyboard.press('Escape'); await page.waitForFunction(() => !window.__wb.review.isOpen); };

// a close edit of the first hydra line on the open resume, whose version another saved resume prints too
const SETUP = `(async () => {
  const T = await import('/src/model/resume.js'), RV = await import('/src/model/review.js'), s = window.__wb.store.state;
  for (const id of T.listedBullets(s.record, s.cur, 'hydra')){
    const v = T.vOf(s.record, id, s.cur);
    if (!v || !RV.printersOf(s, v.id).length) continue;
    window.__wb.store.commit(d => { T.setOverride(d.record, d.cur, id, v.text.replace(/(\\d)(\\d\\d),000/, '$1$2,500').replace(/ (\\w+)$/, ' $1 ok'), { marks: [], base: null }); }, 'check: edit');
    return { id, vid: v.id, other: RV.printersOf(s, v.id)[0].id };
  }
  return null;
})()`;

await block(async () => { // 1: markup in another resume's name is text
  const { ctx, page } = await fresh();
  const got = await page.evaluate(SETUP);
  ok('setup: an edit whose version another resume prints', !!got);
  await page.evaluate(async o => { window.__wb.store.commit(d => { const r = d.resumes.find(x => x.id === o); r.company = '<img src=x onerror=window.__pwn=1> Corp'; r.role = '<b id=pwnb>Role</b>'; }, 'check: name'); }, got.other);
  await openList(page);
  const row = await page.$eval(`${R} .rvnote`, e => ({ text: e.textContent, imgs: e.querySelectorAll('img, b').length }));
  ok('the Update note shows the name as text', row.imgs === 0 && row.text.includes('<img'), JSON.stringify(row));
  await page.waitForTimeout(200);
  ok('…and nothing ran', !(await page.evaluate(() => window.__pwn)) && !(await page.$(`${R} img, ${R} #pwnb`)));
  await ctx.close();
});
await block(async () => { // 5, 6: the select only chooses; a Replace says who else prints it; 2: use all the newer wording
  const { ctx, page } = await fresh();
  const got = await page.evaluate(SETUP);
  await page.evaluate(async id => {
    const T = await import('/src/model/resume.js'), s = window.__wb.store.state;
    window.__wb.store.commit(d => { T.setOverride(d.record, d.cur, id, 'Quite different words about the rig and its tolerance checks', { marks: [], base: null }); d.record.requireSource = false; }, 'check: far edit');
  }, got.id);
  await openList(page);
  const u0 = await undoN(page);
  const opts = await page.$$eval(`${R} .rvrow [data-rv-pick] option`, o => o.map(x => x.value));
  const over = opts.find(v => v.startsWith('over:'));
  ok('a far edit offers Replace in the select', !!over, opts.join());
  await page.selectOption(`${R} [data-rv-pick]`, over);
  ok('choosing in the select writes nothing and offers Apply', (await undoN(page)) === u0 && !!(await page.$(`${R} [data-rv=apply]`)));
  const note = await page.$eval(`${R} .rvnote`, e => e.textContent).catch(() => '');
  ok('a Replace says how many other resumes are offered it', /other resume/.test(note), note);
  ok('the result line says what Apply will do', /Apply will do this: Replace v/.test(await page.$eval(`${R} .rvwill`, e => e.textContent)));
  await page.click(`${R} [data-rv=apply]`);
  ok('Apply makes one undo step', (await undoN(page)) === u0 + 1);
  await closeList(page);
  await ctx.close();
});
await block(async () => { // 2: all the newer wording
  const { ctx, page } = await fresh();
  const ids = await page.evaluate(async () => {
    const T = await import('/src/model/resume.js'), s = window.__wb.store.state, l = T.listedBullets(s.record, s.cur, 'hydra').slice(0, 3);
    window.__wb.store.commit(d => { d.cur.held = [...l]; l.forEach((id, i) => { d.cur.overrides[id] = `Older words number ${i} for this line`; }); d.cur.locked = [l[2]]; }, 'check: held');
    return l;
  });
  await openList(page);
  const btn = await page.$(`${R} [data-rv=newerAll]`);
  ok('group two has Use all the newer wording (2: the locked line is not in it)', !!btn && /\(2\)/.test(await btn.textContent()), btn ? await btn.textContent() : 'none');
  const u0 = await undoN(page);
  await page.click(`${R} [data-rv=newerAll]`);
  ok('it is one undo step', (await undoN(page)) === u0 + 1);
  const left = await page.evaluate(() => window.__wb.store.state.cur.held);
  ok('the locked line stays held, the others are decided', JSON.stringify(left) === JSON.stringify([ids[2]]), JSON.stringify(left));
  await page.keyboard.press('Control+z'); 
  ok('one Undo brings both back', (await page.evaluate(() => window.__wb.store.state.cur.held.length)) === 3);
  await ctx.close();
});
await block(async () => {
  const { ctx, page } = await fresh();
  await page.evaluate(async () => { const T = await import('/src/model/resume.js'), s = window.__wb.store.state, id = T.listedBullets(s.record, s.cur, 'hydra')[0]; window.__wb.store.commit(d => { d.cur.held = [id]; d.cur.overrides[id] = 'Older words for this line'; }, 'check: held'); });
  // newer wording alone does not open the list from Save to file
  const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.evaluate(() => window.__wb.review.saveFlow());
  ok('Save to file with newer wording only saves at once', !!(await dl) && !(await isOpen(page)));
  await ctx.close();
});
await block(async () => { // 4: a heading another resume locks
  const { ctx, page } = await fresh();
  await page.evaluate(async () => {
    const T = await import('/src/model/resume.js'), s = window.__wb.store.state;
    window.__wb.store.commit(d => { T.setSectionLabel(d.record, d.cur, 'experience', s.cur.lang ?? 'en', 'Work zz'); }, 'check: heading');
  });
  await openList(page);
  const sel = `${R} .rvrow[data-kind=l]`;
  ok('a heading says how many other resumes it changes', /other resume/.test(await page.$eval(sel, e => e.textContent)) && !!(await page.$(`${sel} [data-rv=every]`)));
  await closeList(page);
  await page.evaluate(() => window.__wb.store.commit(d => { const r = d.resumes.find(x => x.id !== d.openId); r.locked = ['~h:experience']; }, 'check: lock'));
  await openList(page);
  ok('…and offers nothing while another resume locks it, with the reason', !(await page.$(`${sel} [data-rv=every]`)) && /locked/.test(await page.$eval(sel, e => e.textContent)));
  // 9, 10: keys and a failed save
  await page.evaluate(() => { window.__wb.persist.prepareFile = async () => { throw new Error('no disk'); }; });
  const keys = await page.evaluate(() => ['s', 'o', 'p'].map(k => { const e = new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true }); document.querySelector('#review [data-rv=cancel]').dispatchEvent(e); return e.defaultPrevented; }));
  await page.waitForTimeout(300);
  ok('Ctrl+S, O and P inside the dialog are kept from the browser', keys.every(Boolean), keys.join());
  await page.click(`${R} [data-rv=save]`);
  await page.waitForTimeout(400);
  ok('a failed save leaves the dialog open, with the toast', await isOpen(page) && /no disk/.test(await page.$eval('#toast', e => e.textContent)));
  await closeList(page);
  await ctx.close();
});
await browser.close(); server.close();
console.log(failed ? `\n${failed} review ui check(s) FAILED` : '\nall review ui checks passed');
process.exit(failed ? 1 : 0);
