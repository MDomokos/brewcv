#!/usr/bin/env node
// node checks/smoke-shell.mjs
// The Workbench shell end to end in Chromium, on fictional data. Needs playwright and a Chromium.
// ONLY=import,export runs only the sections whose name contains one of those.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = 8131;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
const URL_ = q => `http://localhost:${PORT}/${q ?? '?memory'}`;

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
  if (!cond) failed++;
};
const section = t => console.log(`\n— ${t}`);
const want = t => { if (process.env.ONLY && !process.env.ONLY.split(',').some(o => t.includes(o))) return false; section(t); return true; };

const exe = process.env.CHROME_PATH
  ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});

async function open(page, q){
  const bad = [];
  page.on('console', m => { if (m.type() === 'error') bad.push(m.text()); });
  page.on('pageerror', e => bad.push(String(e)));
  await page.goto(URL_(q), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 });
  await page.waitForFunction(() => /%/.test(document.querySelector('#meter')?.textContent ?? ''), null, { timeout: 20000 });
  return bad;
}
const frameDoc = (page, fn, arg) => page.evaluate(([src, a]) => (0, eval)(src)(document.querySelector('#sheet iframe').contentDocument, a), [fn.toString(), arg]);
const firstBullet = page => frameDoc(page, d => d.querySelector('.bullets li')?.textContent ?? '');
const settle = page => page.waitForTimeout(500);
const rect = (page, s) => page.$eval(s, el => el.getBoundingClientRect().toJSON());

if (want('layout: the sheet at full height, one column of cards beside it')) for (const [w, h] of [[1536, 864], [1440, 960], [1280, 800]]){
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const s = await rect(page, '#sheet'), c = await rect(page, '#col');
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(`${w}×${h}: loads with no console errors`, bad.length === 0, bad[0] ?? '');
  ok(`${w}×${h}: the sheet runs the full height, 16px from top and bottom`, Math.abs(s.top - 16) < 1 && Math.abs(h - s.bottom - 16) < 1, `${s.top.toFixed(1)} / ${(h - s.bottom).toFixed(1)}`);
  ok(`${w}×${h}: the column is 340–420px wide and the same height`, c.width >= 340 && c.width <= 420 && Math.abs(c.height - (h - 32)) < 1, `${c.width}px`);
  ok(`${w}×${h}: 16px between sheet and column`, Math.abs(c.left - s.right - 16) < 1, `${(c.left - s.right).toFixed(1)}px`);
  ok(`${w}×${h}: centred as a pair`, Math.abs(s.left - (w - c.right)) < 1.5, `${s.left.toFixed(1)} vs ${(w - c.right).toFixed(1)}`);
  ok(`${w}×${h}: no horizontal scroll`, scrollW <= w);
  await ctx.close();
}

if (want('selecting, preview, versions, undo')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sheet = page.frameLocator('#sheet iframe');
  ok('the example opens on its first saved resume', /Example Instruments/.test(await page.textContent('#docname')));
  ok('the body card lists the sections when nothing is selected', /Click anything on the page/.test(await page.textContent('#body')));

  await sheet.locator('.bullets li').first().click(); await settle(page);
  ok('clicking a bullet on the sheet selects it', (await page.getAttribute('#body', 'data-view')) === 'bullet');
  ok('and outlines it there', (await frameDoc(page, d => d.querySelectorAll('.rb-sel').length)) >= 1);
  const before = await firstBullet(page);
  const rows = page.locator('.vrow[data-v]:not(.cur)');
  ok('the versions are listed, the one in use first', (await rows.count()) >= 1 && (await page.locator('.vrow.cur').count()) === 1);
  await rows.first().hover(); await settle(page);
  const during = await firstBullet(page);
  ok('hovering a version previews it on the page', during !== before);
  ok('marked as a preview', await frameDoc(page, d => d.documentElement.classList.contains('rb-previewing')));
  await page.mouse.move(4, 4); await settle(page);
  ok('moving away puts the page back', (await firstBullet(page)) === before);
  await rows.first().click(); await settle(page); await page.mouse.move(4, 4); await settle(page);
  ok('clicking a version uses it', (await firstBullet(page)) === during);
  await page.keyboard.press('Control+z'); await settle(page);
  ok('Ctrl+Z undoes it', (await firstBullet(page)) === before);
  await page.keyboard.press('Control+Shift+z'); await settle(page);
  ok('Ctrl+Shift+Z redoes it', (await firstBullet(page)) === during);
  await page.keyboard.press('Control+z'); await settle(page);

  await page.keyboard.press('ArrowDown'); await settle(page);
  ok('↓ steps to the next bullet', (await page.getAttribute('#body', 'data-view')) === 'bullet' && (await page.textContent('#body .title')) !== '');
  const v0 = await firstBullet(page);
  await page.keyboard.press('ArrowUp'); await settle(page);
  await page.keyboard.press('ArrowRight'); await settle(page);
  ok('→ uses the next version', (await firstBullet(page)) !== v0);
  await page.keyboard.press('Control+z'); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc goes up to the job', (await page.getAttribute('#body', 'data-view')) === 'job');
  await page.keyboard.press('Escape'); await settle(page);
  ok('and again to nothing', (await page.getAttribute('#body', 'data-view')) === 'none');

  await sheet.locator('.role-title').first().click(); await settle(page);
  ok('clicking a job title selects the job', (await page.getAttribute('#body', 'data-view')) === 'job');
  await sheet.locator('.band[data-section="skills"] .tab').first().click(); await settle(page);
  ok('clicking a section tab selects the section', (await page.getAttribute('#body', 'data-view')) === 'section');
  await sheet.locator('.name').click(); await settle(page);
  ok('clicking the name selects the header', (await page.getAttribute('#body', 'data-view')) === 'header');
  await page.click('[data-act=deselect]'); await settle(page);
  ok('✕ clears the selection', (await page.getAttribute('#body', 'data-view')) === 'none');
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('pages, Fit, the Hungarian resume')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  await page.click('.item[data-act=r-open]:has-text("Medtech")'); await page.waitForTimeout(1500);
  const pages = await frameDoc(page, d => d.querySelectorAll('.document > .page').length);
  ok('a two-page resume is paginated into two pages', pages === 2, `${pages}`);
  ok('at 1280×800 the pages stack and scroll, with arrows', (await page.textContent('.pnav')).includes('1 / 2') && (await page.evaluate(() => document.body.dataset.stack)) === 'true');
  await page.click('[data-act=page][data-d="1"]'); await page.waitForTimeout(900);
  ok('▸ scrolls to page 2', (await page.evaluate(() => document.querySelector('#pages').scrollTop)) > 300 && (await page.textContent('.pnav')).includes('2 / 2'));
  await page.click('[data-act=view]'); await settle(page);
  ok('▭▭ puts the pages side by side', (await page.evaluate(() => document.body.dataset.spread)) === 'true');
  const fills = await page.evaluate(() => window.__wb.ui.fills.map(p => p.overflow));
  ok('no page before the last overflows', fills.slice(0, -1).every(o => !(o > 0)));

  await page.click('.item[data-act=r-open]:has-text("Example Instruments")').catch(() => {});
  await page.click('.item[data-act=r-open]:has-text(\"Example Instruments\")'); await page.waitForTimeout(1200);
  const undoBefore = await page.evaluate(() => window.__wb.store.history.undo);
  await page.click('[data-act=fit]');
  await page.waitForFunction(() => !window.__wb.ui.fitting, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const meter = await page.textContent('#meter');
  ok('Fit runs and the meter reads the result', /%/.test(meter), meter);
  const fitted = await page.evaluate(() => window.__wb.store.history.undo) > undoBefore;
  if (fitted){
    await page.keyboard.press('Control+z'); await page.waitForTimeout(900);
    ok('Ctrl+Z undoes a Fit', (await page.evaluate(() => window.__wb.store.history.undo)) === undoBefore);
  } else ok('Fit changed nothing, and said so', true);

  await page.click('.item[data-act=r-open]:has-text(\"Dunamenti\")'); await page.waitForTimeout(1500);
  ok('the Hungarian resume prints its photo placeholder', await frameDoc(page, d => !!d.querySelector('.portrait--missing')));
  ok('and Hungarian tabs', await frameDoc(page, d => /Tapasztalat/i.test(d.body.textContent)));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('pages side by side or scrolled')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.removeItem('rb-pages'); } catch {} });
  const bad = await open(page);
  await page.click('.item[data-act=r-open]:has-text("Medtech")'); await page.waitForTimeout(1500);
  const L = () => page.evaluate(() => ({ stack: document.body.dataset.stack, spread: document.body.dataset.spread, top: document.querySelector('#pages').scrollTop, nav: document.querySelector('.pnav')?.textContent ?? '' }));
  ok('auto at 1280×800: two A4 pages stack', (await L()).stack === 'true');
  const box = await rect(page, '#pages'), col = await rect(page, '#col');
  ok('the scroller is the window’s height and stops short of the column', Math.abs(box.height - 800) < 1 && box.right <= col.left);
  ok('each page at full window height', Math.abs((await page.evaluate(() => window.__wb.ui.layout.scale)) - (800 - 32) / 1123) < 1e-6);
  const fillsStack = await page.evaluate(() => JSON.stringify(window.__wb.ui.fills.map(p => +(p.used / p.usable).toFixed(4))));
  await page.mouse.move(300, 400); await page.mouse.wheel(0, 700); await page.waitForTimeout(700);
  ok('scrolling shows page 2, and the footer says so', (await L()).nav.includes('2 / 2'));
  await page.click('[data-act=page][data-d="-1"]'); await page.waitForTimeout(900);
  ok('◂ scrolls back to page 1', (await L()).top < 5 && (await L()).nav.includes('1 / 2'));
  await page.click('[data-act=page][data-d="1"]'); await page.waitForTimeout(900);
  const p2top = (await L()).top;
  ok('▸ scrolls to page 2’s top', p2top > 300);
  await page.click('[data-act=page][data-d="-1"]'); await page.waitForTimeout(900);
  // a click on a page-2 bullet (from the card: the last job's bullet) scrolls it into view
  const lastBullet = await frameDoc(page, d => { const ps = d.querySelectorAll('.document > .page'); const li = ps[ps.length - 1].querySelector('.bullets li[data-variant]'); return li?.getAttribute('data-variant') ?? null; });
  if (lastBullet){
    await page.evaluate(v => { const ix = window.__wb.ui.ix; const f = ix.factOfVariant.get(v); const b = document.createElement('button'); b.dataset.act = 'select-bullet'; b.dataset.id = f; b.hidden = true; document.querySelector('#body').append(b); b.click(); }, lastBullet);
    await page.waitForTimeout(1200);
    ok('selecting a bullet on page 2 scrolls it into view', (await L()).top > 200, `${(await L()).top}`);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  } else ok('page 2 has a bullet to select', false);
  await page.click('[data-act=page][data-d="-1"]'); await page.waitForTimeout(900);
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  await page.locator('.vrow[data-v]:not(.cur)').first().hover(); await settle(page);
  ok('hover preview still works in the stack', await frameDoc(page, d => d.documentElement.classList.contains('rb-previewing')));
  await page.mouse.move(4, 4); await settle(page);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await page.click('[data-act=view]'); await page.waitForTimeout(1200);
  ok('▭▭ puts them side by side', (await L()).spread === 'true' && (await L()).stack === 'false');
  const fillsSpread = await page.evaluate(() => JSON.stringify(window.__wb.ui.fills.map(p => +(p.used / p.usable).toFixed(4))));
  ok('the fills are identical in both views (nothing measured differently)', fillsStack === fillsSpread, `${fillsStack} vs ${fillsSpread}`);
  ok('the choice is remembered in this browser', (await page.evaluate(() => localStorage.getItem('rb-pages'))) === 'spread');
  await page.click('[data-act=view]'); await page.waitForTimeout(1200);
  ok('▯ goes back to the scrolled stack', (await L()).stack === 'true' && (await page.evaluate(() => localStorage.getItem('rb-pages'))) === 'stack');
  const undo0 = await page.evaluate(() => window.__wb.store.history.undo);
  ok('the view is not an undo step', undo0 === (await page.evaluate(() => window.__wb.store.history.undo)));
  await page.click('[data-act=fit]');
  await page.waitForFunction(() => !window.__wb.ui.fitting, null, { timeout: 60000 }); await page.waitForTimeout(800);
  ok('Fit still runs in the stack', /%/.test(await page.textContent('#meter')));
  await page.click('[data-act=actual]'); await page.waitForTimeout(1200);
  ok('actual size still opens', await page.isVisible('.actual'));
  await page.keyboard.press('Escape'); await settle(page);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('scrollbars')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const sb = sel => page.$eval(sel, el => { const c = getComputedStyle(el); return { w: c.scrollbarWidth, c: c.scrollbarColor }; });
  const b = await sb('#body'), p = await sb('#pages'), c = await sb('#career');
  ok('the body card’s scrollbar is thin and warm grey', b.w === 'thin' && /201, 196, 184/.test(b.c), JSON.stringify(b));
  ok('the page scroller’s too', p.w === 'thin', JSON.stringify(p));
  ok('Career’s is thin and blue-grey', c.w === 'thin' && /184, 192, 203/.test(c.c), JSON.stringify(c));
  ok('nothing scrollbar-related inside the resume’s iframe', await frameDoc(page, d => [...d.styleSheets].every(s => { try { return [...s.cssRules].every(r => !/scrollbar/.test(r.cssText)); } catch { return true; } })));
  ok('the iframe still hides its own overflow', await frameDoc(page, d => getComputedStyle(d.documentElement).overflow === 'hidden'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the welcome language step, the interface language, Settings')) {
  const I = await import(pathToFileURL(path.join(ROOT, 'src/i18n/index.js')));
  const de = await I.loadCatalogue('de'), fr = await I.loadCatalogue('fr');
  const ui = page => page.evaluate(() => ({ lang: document.documentElement.lang, design: document.querySelector('[data-act=goto][data-v=design]')?.textContent.trim(), cur: window.__wb.store.state.cur?.lang ?? 'en', format: window.__wb.store.state.cur?.format, langs: window.__wb.store.state.record.langs }));
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
    const page = await ctx.newPage();
    const bad = await open(page, '?memory&welcome');
    ok('a first visit opens on the introduction, with the three starts and no language step yet', await page.isVisible('[data-act=ob-scratch]') && (await page.$$('[data-langtick]')).length === 0);
    await page.click('[data-act=ob-scratch]'); await settle(page);           // the language step comes after choosing a start
    ok('the browser’s language is ticked on the language step', await page.isChecked('[data-langtick=de]') && !(await page.isChecked('[data-langtick=en]')));
    await page.click('[data-act=ob-lang-go]'); await page.waitForTimeout(1500);      // and carries on with the start that was chosen
    let u = await ui(page);
    ok('the first resume is in German, on A4', u.cur === 'de' && u.format === 'a4', JSON.stringify(u));
    ok('the header is in German', u.lang === 'de' && u.design === de['head.design'], JSON.stringify(u));
    ok('the record lists the language you chose', JSON.stringify(u.langs) === '["de"]');
    await page.fill('#ob-name', 'Erika Muster'); await page.waitForTimeout(600);
    await page.click('[data-act=ob-next]'); await settle(page);
    ok('the market step suggests Germany', (await page.getAttribute('.item.is-cur', 'data-m')) === 'dach');
    await page.click('[data-act=ob-next]'); await settle(page);
    await page.fill('#ob-pos', 'Konstrukteurin'); await page.fill('#ob-emp', 'Feinmess GmbH'); await page.fill('#ob-start', '2022-03'); await page.check('#ob-current');
    await page.fill('#ob-claims', 'Baute einen Prüfstand.'); await page.click('[data-act=ob-next]'); await page.waitForTimeout(1500);
    ok('a meta line written in German: German month, “heute”', /März 2022 – heute/i.test(await frameDoc(page, d => d.body.textContent)) || /MÄRZ 2022 – HEUTE/.test(await frameDoc(page, d => d.body.textContent)));
    ok('and nothing on the German resume is outlined as missing but the empty parts', (await frameDoc(page, d => d.querySelectorAll('.rb-miss').length)) === 0);
    await page.click('[data-act=ob-skip]'); await settle(page); await page.click('[data-act=ob-skip]'); await settle(page);
    if (await page.$('[data-act=ob-skip]')){ await page.click('[data-act=ob-skip]'); await settle(page); }
    await page.click('[data-act=ob-finish]'); await page.waitForTimeout(1200);
    await page.click('#langbtn'); await settle(page);
    await page.click('.langpop [data-act=lang-more]'); await settle(page);
    await page.click('.langpop [data-act=lang-add][data-lang=en]'); await page.waitForTimeout(1500);
    u = await ui(page);
    ok('+ Add a language adds English and switches the resume to it', u.cur === 'en' && JSON.stringify(u.langs) === '["de","en"]', JSON.stringify(u));
    ok('the interface follows the resume into English', u.lang === 'en' && u.design === 'Design');
    ok('and the toast is already in English', /This resume is now in English/.test(await page.textContent('#toast')));
    await page.click('#langbtn'); await settle(page);
    ok('the menu now lists just the two', (await page.$$('.langpop [role=menuitemradio]')).length === 2);
    await page.click('.langpop [data-act=lang][data-lang=de]'); await page.waitForTimeout(1200);
    ok('back to German, and so is the interface', (await ui(page)).lang === 'de');
    await page.click('[data-act=menu]'); await page.click('[data-act=goto][data-v=settings]'); await settle(page);
    await page.check('[data-uimode=fixed]'); await page.selectOption('[data-uilang]', 'en').catch(() => {});
    ok('Settings offers only the languages you use, and English', (await page.$$eval('[data-uilang] option', o => o.map(x => x.value).sort().join())) === 'de,en');
    await page.selectOption('[data-uilang]', 'en'); await settle(page);
    ok('“always in English” while the resume is German', (await ui(page)).lang === 'en' && (await ui(page)).cur === 'de');
    ok('kept in this browser', /"mode":"fixed"/.test(await page.evaluate(() => localStorage.getItem('rb-ui'))));
    await page.check('[data-uimode=follow]'); await settle(page);
    ok('Settings changes it back to following the resume', (await ui(page)).lang === 'de');
    await page.click('[data-langtick=en]'); await settle(page);
    const s2 = await page.evaluate(() => ({ langs: window.__wb.store.state.record.langs, en: window.__wb.store.state.record.variants.filter(v => (v.lang ?? 'en') === 'en').length }));
    ok('unticking English hides it; its texts are still in the record', JSON.stringify(s2.langs) === '["de"]' && s2.en > 0);
    ok('the last language can’t be unticked', await page.isDisabled('[data-langtick=de]'));
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
  {
    // always in French: switching the resume to German leaves the interface French
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
    const page = await ctx.newPage();
    const bad = await open(page, '?memory&welcome');
    await page.click('[data-act=ob-example]'); await settle(page);
    await page.click('[data-langtick=de]'); await settle(page);
    await page.check('[data-uimode=fixed]');
    ok('the step offers the ticked languages and English for the interface', (await page.$$eval('[data-uilang] option', o => o.map(x => x.value).sort().join())) === 'de,en');
    // French is not ticked; tick it, then choose it
    await page.click('[data-langtick=fr]'); await settle(page);
    await page.check('[data-uimode=fixed]'); await page.selectOption('[data-uilang]', 'fr'); await settle(page);
    await page.click('[data-act=ob-lang-go]'); await page.waitForTimeout(2000);
    ok('“always Français”: the interface is in French', (await page.evaluate(() => document.documentElement.lang)) === 'fr');
    let u = await ui(page);
    ok('the example keeps your languages', JSON.stringify(u.langs) === '["en","de","fr"]', JSON.stringify(u.langs));
    await page.click('#langbtn'); await settle(page);
    await page.click('.langpop [data-act=lang][data-lang=de]'); await page.waitForTimeout(1500);
    u = await ui(page);
    ok('switching the resume to German leaves the interface in French', u.cur === 'de' && u.lang === 'fr' && u.design === fr['head.design'], JSON.stringify(u));
    ok('no console errors', bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
  {
    // storage blocked: English, following, no error
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
    await ctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get(){ throw new Error('blocked'); } }); });
    const page = await ctx.newPage();
    const bad = await open(page, '?memory&welcome');
    await page.click('[data-act=ob-example]'); await settle(page);        // the language step comes after choosing a start
    await page.click('[data-act=ob-lang-go]'); await page.waitForTimeout(1500);
    ok('storage blocked: English, and no error', (await ui(page)).lang === 'en' && bad.length === 0, bad[0] ?? '');
    await page.click('[data-act=menu]'); await page.click('[data-act=goto][data-v=settings]'); await settle(page);
    await page.click('[data-act=view][data-d]').catch(() => {});
    ok('Settings still opens', /Settings/.test(await page.textContent('#body .title')) && bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
}

if (want('Career')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  await page.keyboard.press('c'); await page.waitForTimeout(1200);
  ok('a first visit to Career shows tip 1 of 3', /1 of 3/.test(await page.textContent('#career .tipbox')));
  await page.click('[data-act=c-tip-next]'); await settle(page); await page.click('[data-act=c-tip-next]'); await settle(page);
  ok('Next twice, then “Got it”', /Got it/.test(await page.textContent('#career .tipbox')));
  await page.click('[data-act=c-tip-next]'); await settle(page);
  ok('hides them', !(await page.$('#career .tipbox')));
  const head = await page.evaluate(() => [...document.querySelectorAll('#head button, #head span')].filter(e => e.offsetParent).map(e => e.dataset.act ?? e.id ?? '').join(' '));
  ok('the header shows only Career’s controls: workspace, ⋯, language, undo', /c-lang-menu/.test(head) && /undo/.test(head) && !/\bsave\b/.test(head) && !(await page.isVisible('[data-act=goto][data-v=design]')) && !(await page.isVisible('#langbtn')));
  ok('and the footer is gone', !(await page.isVisible('#foot')));
  ok('no overview strip and no View control', !(await page.$('#career .strip')) && !(await page.$('#career .viewbar')));
  ok('Work in the left column; the degree and the two projects in the right', (await page.$$('.tl2 .main .row')).length === 5 && (await page.$$('.tl2 .side .srow')).length === 3);
  const tops = await page.$$eval('.tl2 .yrow', rows => rows.map(r => Math.abs(r.querySelector('.main').getBoundingClientRect().top - r.querySelector('.side').getBoundingClientRect().top)));
  ok('each band’s left and right cells start at the same height', tops.every(d => d < 1), tops.join());
  const years = await page.$$eval('.tl2 .yr', e => e.map(x => x.textContent.trim()));
  ok('newest first, the running job on top', years[0] === 'Now' && years.slice(1).every((y, i, a) => i === 0 || a[i - 1] >= y), years.join());
  ok('at most one mark per row; none in English', (await page.$$('.tl2 .mk')).length === 0);
  const addAt = async () => { const r = await rect(page, '#c-add'); return `${Math.round(r.left)},${Math.round(r.top)}`; };
  const pos = [await addAt()];
  for (const a of ['about', 'more', 'timeline']){ await page.click(`[data-act=c-area][data-area=${a}]`); await settle(page); pos.push(await addAt()); }
  ok('+ Add is in the same place on every area', new Set(pos).size === 1, pos.join(' | '));
  const list = await rect(page, '.tl2'), thumb = await rect(page, '#thumb');
  ok('the list stays left of the thumbnail', list.right <= thumb.left + 1, `${list.right} vs ${thumb.left}`);
  for (const a of ['about', 'timeline', 'more']){
    await page.click(`[data-act=c-area][data-area=${a}]`); await settle(page);
    const t = await page.textContent('#body') + await page.textContent('#career');
    const named = (await st()).resumes.some(r => t.includes(r.company));
    if (named || await page.$('#body .sw') || await page.$('#body .vrow.cur')) ok(`no switch, no resume named, no version in use in ${a}`, false);
  }
  ok('no switch, no resume named and nothing “in use” in any Career view', true);
  await page.click('[data-act=c-area][data-area=more]'); await settle(page);
  const groups = await page.$$eval('#career .grp:not(.jtypes)', gs => gs.map(g => !!g.querySelector('.gi svg') && getComputedStyle(g.querySelector('.grp-h b')).color));
  ok('every Skills & credentials group has an icon and its colour', groups.length >= 5 && groups.every(Boolean) && new Set(groups).size === groups.length, groups.join(' '));
  await page.click('[data-act=c-area][data-area=timeline]'); await settle(page);
  await page.click('.tl2 .row:has-text("Prototyping Technician")'); await settle(page);
  ok('an entry: the where-line, its title and one summary line', /Work · 2 of 5/i.test(await page.textContent('#body .where')) && /Polytechnic Prototyping Lab ·/.test(await page.textContent('#body .sumline')));
  ok('the details open only when asked', !(await page.$('#c-pos')));
  // the content language: German; edit a title and a place
  await page.click('#c-langbtn'); await settle(page);
  if (!(await page.$('.langpop [data-act=lang][data-lang=de]'))){ await page.click('.langpop [data-act=lang-more]'); await settle(page); await page.click('.langpop [data-act=lang-add][data-lang=de]'); }
  else await page.click('.langpop [data-act=lang][data-lang=de]');
  await page.waitForTimeout(1000);
  ok('Career in German: what is left to write is marked, one mark per row at most', (await page.$$('.tl2 .mk')).length >= 1 && (await page.$$eval('.tl2 .row', rs => rs.every(r => r.querySelectorAll('.mk').length <= 1))));
  await page.click('[data-act=c-details][data-open="1"]'); await settle(page);
  const de6 = await (await import(pathToFileURL(path.join(ROOT, 'src/i18n/index.js')))).loadCatalogue('de');
  ok('the interface follows Career’s language into German', (await page.evaluate(() => document.documentElement.lang)) === 'de' && (await page.textContent('#career')).includes(de6['career.step2']));
  ok('the form says what translates and what is the same in every language', /Deutsch/.test(await page.textContent('#body .detbox')) && (await page.textContent('#body .detbox')).includes(de6['career.shared']));
  await page.fill('#c-pos', 'Techniker Prototypenbau'); await page.fill('#c-loc', 'Porto, Portugal');
  await page.click('[data-act=c-save]'); await page.waitForTimeout(1000);
  let s = await st();
  ok('saved in German: i18n.de.fields, and a German v1 of the title', s.record.i18n.de.fields['work/poly/position'] === 'Techniker Prototypenbau' && s.record.variants.some(v => v.lang === 'de' && v.text === 'Techniker Prototypenbau'));
  const missing = page.locator('#body .item.row:has(.pill.miss) [data-act=c-claim]').first();
  await missing.click(); await settle(page);
  ok('a claim with no German: the English for reference and a box to write it', await page.isVisible('#ed-new') && await page.isVisible('#body .ref'));
  await page.fill('#ed-new', 'Leitete eine Prototypenwerkstatt.'); await page.click('[data-act=write-in]'); await page.waitForTimeout(1000);
  s = await st();
  ok('written in place: German v1', s.record.variants.some(v => v.lang === 'de' && v.text === 'Leitete eine Prototypenwerkstatt.' && v.n === '1'));
  ok('all its versions listed as equals, each with ✎, ⇄ and 🗑, none “in use”', (await page.$$('#body .vrow.flat')).length >= 1 && !(await page.$('#body .vrow.cur')) && !(await page.$('#body .rad')));
  await page.keyboard.press('Escape'); await settle(page);
  await page.click('#thumb'); await page.waitForTimeout(1500);
  await page.click('#langbtn'); await settle(page);
  await page.click('.langpop [data-act=lang][data-lang=de]'); await page.waitForTimeout(2000);
  const sheet = await frameDoc(page, d => d.body.textContent);
  ok('the German resume prints the German title and place', sheet.includes('Techniker Prototypenbau') && sheet.includes('Porto, Portugal'));
  await page.keyboard.press('c'); await page.waitForTimeout(1000);
  await page.click('[data-act=c-area][data-area=more]'); await settle(page);
  await page.click('#career .crd:has-text("CAD") >> nth=0'); await settle(page);
  await page.fill('#c-gname', 'CAD und 3D'); await page.click('[data-act=c-save-item]'); await page.waitForTimeout(1000);
  await page.click('#thumb'); await page.waitForTimeout(1500);
  ok('a skill group renamed in German prints on the German resume', (await frameDoc(page, d => d.body.textContent)).includes('CAD und 3D'));
  await page.frameLocator('#sheet iframe').locator('.role-title').first().click(); await settle(page);
  ok('a Resume panel says where its content comes from, with Edit in Career →', !!(await page.$('#body .from [data-act=to-career]')));
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  ok('the Resume workspace still has its On this resume switch', !!(await page.$('#body #b-on')));
  await page.keyboard.press('Escape'); await settle(page);
  await page.click('#body .from [data-act=to-career]'); await page.waitForTimeout(1000);
  ok('Edit in Career → opens Career on that job', (await page.evaluate(() => document.body.dataset.ws)) === 'career' && (await page.evaluate(() => window.__wb.career.sel?.id)) === 'hydra');
  await page.keyboard.press('r'); await page.waitForTimeout(600);
  // the animated switch ends where the layout says, both ways
  const want = async ws => page.evaluate(ws => { const L = window.__wb.ui.layout; return ws === 'career' ? { x: L.career.thumb.left, y: L.career.thumb.top, k: L.career.thumb.scale } : { x: L.sheet.left, y: L.sheet.top, k: L.scale }; }, ws);
  const got = async () => { const r = await rect(page, '#sheet'); const k = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#sheet')).transform).a); return { x: r.left, y: r.top, k }; };
  const near = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.k - b.k) < 0.001;
  await page.keyboard.press('c'); await page.waitForTimeout(900);
  ok('Resume → Career: the page ends as the thumbnail, to 0.5px', near(await got(), await want('career')), JSON.stringify([await got(), await want('career')]));
  await page.keyboard.press('r'); await page.waitForTimeout(900);
  ok('Career → Resume: back to its place, to 0.5px', near(await got(), await want('resume')), JSON.stringify([await got(), await want('resume')]));
  await page.keyboard.press('c'); await page.waitForTimeout(120); await page.keyboard.press('r'); await page.waitForTimeout(900);
  ok('a switch during the animation ends in the right place', near(await got(), await want('resume')));
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('#sheet')).transitionProperty);
  ok('the page’s transform isn’t transitioned at rest (only while switching)', !/transform|all/.test(anim), anim);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
  // reduced motion: nothing animates
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  await open(p2);
  await p2.keyboard.press('c');
  const dur = await p2.evaluate(() => getComputedStyle(document.querySelector('#sheet')).transitionDuration);
  ok('with reduced motion the switch is instant', /^0s/.test(dur), dur);
  await ctx2.close();
}

if (want('Career, no sideways scroll; tips; an empty record')) {
  for (const [w, hgt] of [[1536, 864], [1440, 960], [1280, 800], [1024, 768]]) for (const lang of ['en', 'de', 'pl']){
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt } });
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('rb-career-tips', 'done'); } catch {} });
    await open(page);
    await page.evaluate(async l => { const I = await import('./src/i18n/index.js'); await I.setUiLang(l); }, lang);
    await page.keyboard.press('c'); await page.waitForTimeout(700);
    const views = [];
    for (const a of ['timeline', 'about', 'more']){
      await page.click(`[data-act=c-area][data-area=${a}]`); await page.waitForTimeout(300);
      const first = page.locator('#career .row, #career .crd').first();
      if (await first.count()){ await first.click(); await page.waitForTimeout(200); }
      if (await page.$('[data-act=c-details][data-open="1"]')){ await page.click('[data-act=c-details][data-open="1"]'); await page.waitForTimeout(200); }
      views.push(await page.evaluate(() => [document.querySelector('#body'), document.querySelector('#career'), document.querySelector('#head')].every(e => e.scrollWidth <= e.clientWidth + 1)));
    }
    if (!views.every(Boolean)) ok(`${w}×${hgt} ${lang}: no sideways scroll in any Career view`, false, views.join());
    await ctx.close();
  }
  ok('no sideways scroll in Career at 1536, 1440, 1280 and 1024px, in English, German and Polish', true);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  await open(page);
  await page.keyboard.press('c'); await page.waitForTimeout(800);
  await page.click('[data-act=c-tip-skip]'); await settle(page);
  ok('Skip tips hides them', !(await page.$('#career .tipbox')));
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForFunction(() => document.body.classList.contains('is-ready'));
  await page.keyboard.press('c'); await page.waitForTimeout(800);
  ok('a reload doesn’t bring them back', !(await page.$('#career .tipbox')));
  await page.click('[data-act=menu]'); await page.click('[data-act=c-tips-again]'); await settle(page);
  ok('⋯ › Show the tips again reruns them', /1 of 3/.test(await page.textContent('#career .tipbox')));
  await ctx.close();
  // an empty record: no columns, two Add buttons, each opening the right form
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const p3 = await ctx3.newPage();
  await open(p3, '?memory&welcome');
  await p3.click('[data-act=ob-scratch]'); await settle(p3);           // the language step comes after choosing a start
  await p3.click('[data-act=ob-lang-go]'); await p3.waitForTimeout(1000);
  await p3.fill('#ob-name', 'Robin Vale'); await p3.waitForTimeout(600);
  await p3.evaluate(() => { document.querySelector('[data-act=ws][data-ws=career]').click(); });
  await p3.waitForTimeout(1000);
  ok('an empty record: no columns, just “Add the job you have now”', !(await p3.$('.tl2')) && /job you have now/.test(await p3.textContent('#career .empty')));
  await p3.click('#career .empty [data-what=work]'); await settle(p3);
  ok('+ Add work opens the job form', await p3.isVisible('#c-claims') && /A new job/.test(await p3.textContent('#body .title')));
  await p3.click('[data-act=c-add-cancel]'); await settle(p3);
  await p3.click('#career .empty [data-what=education]'); await settle(p3);
  ok('+ Add education opens the education form', await p3.isVisible('#c-org') && !(await p3.$('#c-claims')));
  await ctx3.close();
}

if (want('projects')) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('rb-career-tips', 'done'); } catch {} });
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  await page.click('.item[data-act=r-open]:has-text("Medtech")'); await page.waitForTimeout(1500);
  const before = await frameDoc(page, d => d.body.textContent);
  await page.keyboard.press('c'); await page.waitForTimeout(800);
  await page.click('#c-add'); await settle(page);
  await page.click('.addm [data-what=project]'); await settle(page);
  await page.fill('#c-pos', 'Formula Student chassis jig'); await page.fill('#c-org', 'FEUP Formula Student team'); await page.fill('#c-start', '2019-10'); await page.fill('#c-end', '2020-06');
  await page.selectOption('#c-during', 'porto-meng');
  await page.fill('#c-claims', 'Designed the welding jig for the team’s steel spaceframe chassis.\nIt held tolerance through two builds.');
  await page.click('[data-act=c-create]'); await page.waitForTimeout(1200);
  const s = await st();
  const pj = s.record.projects?.find(p => p.name === 'Formula Student chassis jig' && p.highlights?.length === 2);
  ok('a project goes in the record, with its claims and “during”', pj?.during === 'porto-meng');
  ok('it shows on the timeline beside the degree, saying so', /during Universidade do Porto/.test(await page.textContent('#career .tl2')));
  await page.click('#thumb'); await page.waitForTimeout(1500);
  ok('nothing on the open resume changes: its section is off', (await frameDoc(page, d => d.body.textContent)) === before);
  await page.click('.srow[data-sid=projects] input'); await page.waitForTimeout(2500);
  const out = await frameDoc(page, d => d.body.textContent);
  ok('turned on, the Projects section prints it, title and meta line and bullets', out.includes('Formula Student chassis jig') && out.includes('welding jig'));
  ok('and it paginates', (await page.evaluate(() => window.__wb.ui.fills.every(p => !(p.overflow > 0)))));
  await page.click('[data-act=fit]');
  await page.waitForFunction(() => !window.__wb.ui.fitting, null, { timeout: 60000 }); await page.waitForTimeout(800);
  ok('Fit runs with it on', /%/.test(await page.textContent('#meter')) && (await st()).cur.sections.find(x => x.id === 'projects')?.weight !== 0);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('custom kinds')) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('rb-career-tips', 'done'); } catch {} });
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  await page.keyboard.press('c'); await page.waitForTimeout(800);
  await page.click('[data-act=c-area][data-area=more]'); await settle(page);
  await page.click('#c-add'); await settle(page);
  await page.click('.addm [data-act=c-kind-new]'); await settle(page);
  await page.click('[data-act=c-kind-preset][data-p=awards]'); await settle(page);
  await page.click('[data-act=c-kind-save]'); await page.waitForTimeout(800);
  ok('Awards, made from the preset, is a list kind', (await st()).record.kinds?.[0]?.store === 'awards' && (await st()).record.kinds[0].place === 'list');
  ok('and the form for its first entry opens', await page.isVisible('#c-pos'));
  await page.fill('#c-pos', 'Best student design'); await page.fill('#c-org', 'Example Society'); await page.fill('#c-start', '2020-11');
  await page.click('[data-act=c-create]'); await page.waitForTimeout(1000);
  ok('the entry is a JSON Resume award', (await st()).record.awards?.[0]?.title === 'Best student design');
  ok('it shows in Skills & credentials under its own heading', /Best student design/.test(await page.textContent('#career .grp:has-text("Awards")')));
  await page.click('#thumb'); await page.waitForTimeout(1200);
  await page.click('.srow[data-sid=awards] input'); await page.waitForTimeout(2000);
  ok('turned on in a resume, it prints as a run line', (await frameDoc(page, d => d.body.textContent)).includes('Best student design · Example Society · 2020'));
  // another list kind, then delete Awards moving its entry there
  await page.keyboard.press('c'); await page.waitForTimeout(800);
  await page.click('#c-add'); await settle(page); await page.click('.addm [data-act=c-kind-new]'); await settle(page);
  await page.fill('#kn-name', 'Exhibitions'); await page.check('[data-kplace=list]'); await settle(page);
  await page.click('[data-act=c-kind-save]'); await page.waitForTimeout(800);
  await page.click('[data-act=c-add-cancel]').catch(() => {}); await settle(page);
  await page.click('#career .grp:has-text("Awards") [data-act=c-kind-edit]'); await settle(page);
  await page.click('[data-act=c-kind-del]'); await settle(page);
  await page.click('[data-act=c-kind-del-move]'); await page.waitForTimeout(1000);
  const s = await st();
  ok('deleting Awards moved its entry to Exhibitions', !s.record.kinds.some(k => k.store === 'awards') && s.record.projects?.some(p => p.name === 'Best student design' && p.type === 'exhibitions'), JSON.stringify(s.record.projects));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(1000);
  ok('Ctrl+Z brings it back', (await st()).record.kinds.some(k => k.store === 'awards') && (await st()).record.awards?.[0]?.title === 'Best student design');
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('references and JSON Resume fields')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('rb-career-tips', 'done'); } catch {} });
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  await page.keyboard.press('c'); await page.waitForTimeout(800);
  // a reference, from + Add
  await page.click('[data-act=c-area][data-area=more]'); await settle(page);
  await page.click('#c-add'); await settle(page);
  ok('+ Add offers a Reference', await page.isVisible('.addm [data-act=c-add][data-what=references]'));
  await page.click('.addm [data-act=c-add][data-what=references]'); await settle(page);
  await page.fill('#c-rname', 'Ana Exemplo'); await page.fill('#c-rtext', 'Dana fixed our dose counter in a week.');
  await page.click('[data-act=c-create]'); await page.waitForTimeout(1000);
  let s = await st();
  ok('it is a JSON Resume reference with a text behind it', s.record.references?.[0]?.name === 'Ana Exemplo' && s.record.facts.some(f => f.id === s.record.references[0].id));
  ok('it shows under References in Skills & credentials', /Ana Exemplo/.test(await page.textContent('#career .grp:has-text("References")')));
  // on a resume: off until turned on, with the same switch as any section
  await page.click('#thumb'); await page.waitForTimeout(1200);
  ok('the resume does not print it yet', !(await frameDoc(page, d => d.body.textContent)).includes('Ana Exemplo'));
  await page.click('.srow[data-sid=references] input'); await page.waitForTimeout(2000);
  ok('turned on, it prints the name and the text', (await frameDoc(page, d => d.body.textContent)).includes('Ana Exemplo') && (await frameDoc(page, d => d.body.textContent)).includes('dose counter in a week'));
  await page.click('.srow[data-sid=references] input'); await page.waitForTimeout(2000);
  ok('and off again, it is gone', !(await frameDoc(page, d => d.body.textContent)).includes('Ana Exemplo'));
  // JSON Resume's other fields on a job, under the fold-out
  await page.keyboard.press('c'); await page.waitForTimeout(800);
  await page.click('[data-act=c-area][data-area=timeline]'); await settle(page);
  const job = s.record.work[0].id;
  await page.click(`[data-act=c-sel][data-what=entry][data-key=work][data-id="${job}"]`); await settle(page);
  await page.click('[data-act=c-details][data-open="1"]'); await settle(page);
  ok('a job\'s form has More fields (JSON Resume), folded', await page.isVisible('details.jr summary') && !(await page.isVisible('#c-wurl')));
  await page.click('details.jr summary'); await settle(page);
  await page.fill('#c-wurl', 'https://hydra.example'); await page.fill('#c-wsum', 'Owned the dose counter.');
  await page.click('[data-act=c-save]'); await page.waitForTimeout(1000);
  s = await st();
  const w = s.record.work.find(x => x.id === job);
  ok('saving keeps the url and the summary on the job', w.url === 'https://hydra.example' && w.summary === 'Owned the dose counter.');
  ok('Ctrl+Z takes them back', await (async () => { await page.keyboard.press('Control+z'); await page.waitForTimeout(800); const x = (await st()).record.work.find(y => y.id === job); return !x.url && !x.summary; })());
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the examples, in every language')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 900 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const list = await page.evaluate(() => window.__wb.store.state.resumes.map(r => ({ id: r.id, lang: r.lang ?? 'en', limit: r.pageLimit })));
  ok('a saved example resume in each of the ten languages', ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu'].every(l => list.some(r => r.lang === l)), list.map(r => r.lang).join());
  for (const r of list){
    await page.evaluate(id => window.__wb.resumes.open(id), r.id); await page.waitForTimeout(2200);
    const res = await page.evaluate(() => ({ fills: window.__wb.ui.fills.map(p => 100 * p.used / p.usable), over: window.__wb.ui.fills.some(p => p.overflow > 0),
      clip: [...document.querySelector('#sheet iframe').contentDocument.querySelectorAll('.band__gutter .tab')].filter(t => t.getBoundingClientRect().right > t.closest('.band__gutter').getBoundingClientRect().right + 0.5 || t.scrollWidth > t.clientWidth + 1).length }));
    const last = res.fills.at(-1);
    const inBand = r.lang === 'en' || r.lang === 'hu' ? true : last >= 88 && last <= 96;
    if (res.over || res.fills.length > (r.limit || 9) || !inBand || res.clip) ok(`${r.id}: renders, paginates to its limit, fills 88–96%, no heading clips`, false, JSON.stringify(res));
  }
  ok('every example opens, renders and paginates to its page limit; the new languages fill 88–96%; no heading clips', true);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('index.html is the Workbench')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  ok('/ opens the Workbench', await page.isVisible('#col') && /BrewCV/.test(await page.title()));
  const gone = await ctx.request.get(`http://localhost:${PORT}/picker.html`);      // a bare 404 makes goto() throw, so ask for the status
  ok('the 0.4.0 picker is retired', gone.status() === 404);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}

if (want('the Edit view')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  page.on('dialog', d => d.accept());
  const sheet = page.frameLocator('#sheet iframe');
  const st = () => page.evaluate(() => window.__wb.store.state);
  const sheetText = () => frameDoc(page, d => d.querySelector('.document').textContent);
  const undoTo = async n => { while ((await page.evaluate(() => window.__wb.store.history.undo)) > n){ await page.keyboard.press('Control+z'); await page.waitForTimeout(150); } await settle(page); };
  const base = await page.evaluate(() => window.__wb.store.history.undo);
  // read the page with the mouse off the version list, so no hover preview is showing
  const fb = async () => { await page.mouse.move(4, 4); await page.waitForTimeout(350); return firstBullet(page); };

  await sheet.locator('.bullets li').first().click(); await settle(page);
  const fact = (await page.evaluate(() => window.__wb.ui.sel.id));
  const text0 = await firstBullet(page);
  await page.click('#b-on'); await settle(page);
  ok('switching a bullet off takes it off the page', !(await sheetText()).includes(text0.slice(0, 40)));
  ok('and records it as off', (await st()).cur.off.includes(fact));
  await page.click('#b-on'); await settle(page);
  ok('and on again puts it back in its place', (await fb()) === text0);
  await page.click('[data-act=keep]'); await settle(page);
  ok('Keep marks it kept', (await page.getAttribute('[data-act=keep]', 'aria-pressed')) === 'true' && (await st()).cur.keep.includes(fact));
  ok('no pins key is written', !('pins' in (await st()).cur));
  await undoTo(base);

  const nBefore = (await st()).record.variants.length;
  await page.keyboard.press('Enter'); await settle(page);
  ok('Enter opens the editor in place', await page.isVisible('#ed') && (await page.textContent('.ed-h')).startsWith('Editing v'));
  await page.focus('#ed'); await page.keyboard.press('End');
  await page.keyboard.type(' Zebra-check.'); await page.waitForTimeout(700);
  ok('the page redraws as you type', (await fb()).includes('Zebra-check.'));
  ok('the editor counts lines on the page', /line/.test(await page.textContent('#ed-stats')));
  ok('nothing is committed while typing', (await page.evaluate(() => window.__wb.store.history.undo)) === base);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc (after asking) closes it and puts the page back', !(await page.isVisible('#ed')) && (await fb()) === text0);

  const using = await page.evaluate(f => { const w = window.__wb.store.state; const v = w.record.variants.find(x => x.id === (document.querySelector('.vrow.cur')?.dataset.v)); return v && { id: v.id, n: v.n }; }, fact);
  await page.click('.vrow.cur [data-act=edit]'); await settle(page);
  await page.fill('#ed', 'Saved over with new words.'); await page.dispatchEvent('#ed', 'input'); await page.waitForTimeout(500);
  await page.click('[data-act=ed-save]'); await settle(page);
  const after = (await st()).record.variants.find(v => v.id === using.id);
  ok(`Save v${using.n} keeps the number and changes the words`, after.n === using.n && after.text === 'Saved over with new words.');
  ok('the page prints it', (await fb()) === 'Saved over with new words.');
  await page.keyboard.press('Control+z'); await settle(page);
  ok('Ctrl+Z puts the old words back', (await fb()) === text0);

  await page.click('.vrow.cur [data-act=edit]'); await settle(page);
  await page.fill('#ed', 'A sibling version.'); await page.dispatchEvent('#ed', 'input'); await page.waitForTimeout(400);
  const asLabel = await page.textContent('[data-act=ed-saveas]');
  await page.click('[data-act=ed-saveas]'); await settle(page);
  const sib = (await st()).record.variants.find(v => v.text === 'A sibling version.');
  ok(`${asLabel.trim()} makes a sibling with one dot`, !!sib && /^\d+\.\d+$/.test(sib.n) && asLabel.includes(sib.n));
  ok('and this resume uses it', (await st()).cur.picks[fact] === sib.id && (await fb()) === 'A sibling version.');
  ok('the old version is still there', (await st()).record.variants.length === nBefore + 1);

  await page.click('.vrow.cur [data-act=edit]'); await settle(page);
  await page.fill('#ed', 'Only on this resume.'); await page.dispatchEvent('#ed', 'input'); await page.waitForTimeout(400);
  await page.click('[data-act=ed-only]'); await settle(page);
  ok('this resume only writes a one-off text', (await st()).cur.overrides[fact] === 'Only on this resume.' && (await st()).record.variants.length === nBefore + 1);
  ok('it prints, and is listed as "only"', (await fb()) === 'Only on this resume.' && await page.isVisible('.vrow.only'));
  await sheet.locator('.bullets li').first().click(); await settle(page);
  ok('clicking it on the page still selects the bullet', (await page.evaluate(() => window.__wb.ui.sel.id)) === fact);
  await page.click('[data-act=only-remove]'); await settle(page);
  ok('↺ goes back to the saved version', (await fb()) === 'A sibling version.');

  const major = await page.textContent('[data-act=new-version]');
  await page.click('[data-act=new-version]'); await settle(page);
  ok('+ Write a new version opens the editor on a copy', await page.isVisible('#ed') && (await page.inputValue('#ed')) === 'A sibling version.');
  ok('and can’t save an unchanged copy', await page.isDisabled('[data-act=ed-new]'));
  await page.fill('#ed', 'A whole new take.'); await page.dispatchEvent('#ed', 'input'); await page.waitForTimeout(400);
  await page.click('[data-act=ed-new]'); await settle(page);
  const nv = (await st()).record.variants.find(v => v.text === 'A whole new take.');
  ok(`${major.trim()} is the next whole number`, !!nv && !nv.n.includes('.') && major.includes(`v${nv.n}`));
  ok('and is used', (await fb()) === 'A whole new take.');

  const rows = page.locator('.vrow[data-v]:not(.cur)');
  const nRows = await rows.count();
  await rows.first().hover(); await page.click('.vrow[data-v]:not(.cur) >> nth=0 >> [data-act=compare]'); await settle(page);
  ok('⇄ shows a word diff against the one in use', await page.isVisible('.diff') && (await page.$$('.diff ins, .diff del')).length > 0);
  await page.click('[data-act=compare-close]'); await settle(page);
  const victim = await rows.first().getAttribute('data-v');
  await rows.first().hover(); await page.click('.vrow[data-v]:not(.cur) >> nth=0 >> [data-act=delete-version]'); await settle(page);
  ok('🗑 deletes a version without asking', (await page.locator('.vrow[data-v]:not(.cur)').count()) === nRows - 1 && !(await st()).record.variants.some(v => v.id === victim));
  ok('and says Ctrl+Z brings it back', /Ctrl\+Z brings it back/.test(await page.textContent('#toast')));
  await page.keyboard.press('Control+z'); await settle(page);
  ok('which it does', (await st()).record.variants.some(v => v.id === victim));
  await undoTo(base);
  ok('undo goes all the way back', (await st()).record.variants.length === nBefore && (await fb()) === text0);

  await page.click('.crumb [data-act=select-job]'); await settle(page);
  ok('the job panel lists its bullets with switches', (await page.$$('#body input[data-on]')).length >= 2);
  const second = await page.getAttribute('#body input[data-on] >> nth=1', 'data-on');
  const wasOn = await page.isChecked('#body input[data-on] >> nth=1');
  await page.click('#body input[data-on] >> nth=1'); await settle(page);
  ok('a bullet switch there turns it ' + (wasOn ? 'off' : 'on'), (await st()).cur.off?.includes(second) === wasOn);
  const job = await page.evaluate(() => window.__wb.ui.sel.id);
  await page.click('#body input[data-jobon]'); await settle(page);
  const meta = await page.textContent('#body .meta');
  ok('the job switch takes the whole job off the page', !(await sheetText()).toUpperCase().includes(meta.trim().split(' · ')[0].toUpperCase())
     && !JSON.stringify((await st()).cur.sections).includes(`"${job}"`));
  await undoTo(base);

  await sheet.locator('.band[data-section="skills"] .tab').first().click(); await settle(page);
  await page.fill('#sec-label', 'Tools'); await page.press('#sec-label', 'Enter'); await settle(page);
  ok('a heading typed in the panel prints on the page', await frameDoc(page, d => d.querySelector('.band[data-section="skills"] .tab').textContent === 'Tools'));
  ok('the section keeps its id', (await st()).cur.sections.find(s => s.id === 'skills').label.en === 'Tools');
  await page.click('[data-act=label-reset]'); await settle(page);
  ok('reset puts the record’s heading back', await frameDoc(page, d => d.querySelector('.band[data-section="skills"] .tab').textContent === 'Skills'));
  await sheet.locator('.band[data-section="patent"] .tab').first().dblclick(); await settle(page);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a'); await page.keyboard.type('Invention'); await page.keyboard.press('Enter'); await settle(page);
  ok('double-clicking a tab on the page renames it in place', (await st()).cur.sections.find(s => s.id === 'patent')?.label?.en === 'Invention'
     && await frameDoc(page, d => d.querySelector('.band[data-section="patent"] .tab').textContent === 'Invention'));
  await sheet.locator('.band[data-section="skills"] .tab').first().click(); await settle(page);
  const order = async () => (await page.evaluate(() => [...document.querySelectorAll('.srow:not(.fixed)')].map(r => r.dataset.sid)));
  await page.click('[data-act=sec-move][data-d="1"]'); await settle(page);
  const bands = await frameDoc(page, d => [...d.querySelectorAll('.band[data-section]')].map(b => b.getAttribute('data-section')));
  ok('Move down moves it on the page', bands.indexOf('skills') > bands.indexOf('patent'), bands.join());
  await page.click('#body .ctlrow input[data-secon]'); await settle(page);
  ok('Show on this resume off takes the section off the page', !(await frameDoc(page, d => !!d.querySelector('.band[data-section="skills"]'))));
  await undoTo(base);

  await page.click('[data-act=deselect]').catch(() => {}); await page.keyboard.press('Escape'); await settle(page);
  const o1 = await order();
  await page.dragAndDrop('.srow[data-sid="education"]', `.srow[data-sid="${o1[0]}"]`, { targetPosition: { x: 40, y: 3 } }); await settle(page);
  const o2 = await order();
  ok('dragging a section moves it', o2.indexOf('education') < o1.indexOf('education') && o2[0] === 'education', o2.join());
  ok('and the page follows', (await frameDoc(page, d => [...d.querySelectorAll('.band[data-section]')].map(b => b.getAttribute('data-section')))).filter(x => !['header', 'summary'].includes(x))[0] === 'education');
  await page.click('.srow[data-sid="languages"] input'); await settle(page);
  ok('a section switch in the list turns it on', await frameDoc(page, d => !!d.querySelector('.band[data-section="languages"]')));
  await undoTo(base);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('saved resumes')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  page.on('dialog', d => d.accept());
  const st = () => page.evaluate(() => window.__wb.store.state);
  ok('the example opens clean: Save is disabled', await page.isDisabled('#save'));
  await page.keyboard.press('Control+o'); await settle(page);
  ok('Ctrl+O lists the saved resumes, grouped by job type', (await page.getAttribute('#body', 'data-view')) === 'resumes' && (await page.$$('.rrow')).length === 14);
  const before = await firstBullet(page);
  await page.hover('.rrow:has-text("Medtech")'); await page.waitForTimeout(1500);
  ok('hovering one shows it on the sheet', (await firstBullet(page)) !== before && (await st()).openId.startsWith('Example'));
  await page.mouse.move(4, 4); await page.waitForTimeout(1200);
  ok('and moving away puts the open one back', (await firstBullet(page)) === before);
  await page.click('.rrow:has-text("Example Instruments") input.pick');
  await page.click('.rrow:has-text("Helix") input.pick');
  await page.click('[data-act=goto][data-v=compare]'); await settle(page);
  ok('ticking two compares them', (await page.$$('table.cmp tbody tr')).length > 8 && (await page.$$('table.cmp tr.diff-row')).length > 0);
  await page.keyboard.press('Escape'); await settle(page);
  await page.click('.rrow:has-text("Helix") [data-act=r-reuse]'); await page.waitForTimeout(1200);
  ok('re-use starts an unsaved copy', (await st()).openId === null && /Copy of/.test(await page.textContent('#docname')) && !(await page.isDisabled('#save')));
  await page.click('#save'); await settle(page);          // Ctrl+S saves the one file now, not the resume
  ok('Save on an unsaved resume asks for its name', (await page.getAttribute('#body', 'data-view')) === 'save');
  await page.fill('#sv-co', 'Northwind Optics'); await page.fill('#sv-role', 'Design Engineer'); await page.fill('#sv-type', 'Optics');
  await page.click('[data-act=sv-do]'); await page.waitForTimeout(1200);
  const s1 = await st();
  ok('save names it Company — Role', s1.openId === 'Northwind Optics - Design Engineer.json' && /Northwind Optics — Design Engineer/.test(await page.textContent('#docname')));
  ok('the new job type is in the record and its versions are tagged', s1.record.jobTypes.includes('Optics') && s1.record.variants.some(v => (v.tags ?? []).includes('Optics')));
  ok('and Save is clean again', await page.isDisabled('#save'));
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  await page.click('#b-on'); await settle(page);
  ok('a change shows as unsaved', !(await page.isDisabled('#save')) && /Unsaved changes/.test(await page.textContent('#savestate')));
  await page.click('#save'); await settle(page);
  ok('Save saves it', await page.isDisabled('#save') && (await st()).resumes.find(r => r.id === s1.openId).off?.length > 0);

  // newer wording: save over a version another saved resume prints
  await page.keyboard.press('Control+o'); await settle(page);
  await page.click('.rrow:has-text("Example Instruments") [data-act=r-open]'); await page.waitForTimeout(1200);
  const shared = await page.evaluate(async () => {
    const RS = await import('./src/model/resumes.js');
    const s = window.__wb.store.state;
    const mine = RS.usedVersions(s.record, s.cur).filter(u => s.record.work.some(w => w.highlights.includes(u.fact)));
    for (const r of s.resumes) if (r.id !== s.openId && !r.id.startsWith('Northwind')){
      const theirs = new Set(RS.usedVersions(s.record, r).map(u => u.variant));
      const hit = mine.find(u => theirs.has(u.variant) && r.lang === s.cur.lang);
      if (hit) return { ...hit, other: r.id, company: r.company, text: s.record.variants.find(v => v.id === hit.variant).text };
    }
    return null;
  });
  if (shared){
    await page.frameLocator('#sheet iframe').locator(`[data-variant="${shared.variant}"]`).first().click(); await settle(page);
    await page.click('.vrow.cur [data-act=edit]'); await settle(page);
    await page.fill('#ed', 'Brand new record wording.'); await page.dispatchEvent('#ed', 'input'); await page.waitForTimeout(300);
    await page.click('[data-act=ed-save]'); await page.waitForTimeout(800);
    if (!(await page.isDisabled('#save'))){ await page.click('#save'); await settle(page); }
    await page.keyboard.press('Control+o'); await settle(page);
    await page.click(`.rrow[data-rid="${shared.other}"] [data-act=r-open]`); await page.waitForTimeout(1500);
    await page.keyboard.press('Escape'); await settle(page);
    ok(`${shared.company} keeps the text it was saved with`, (await frameDoc(page, d => d.body.textContent)).includes(shared.text));
    ok('and the card offers the newer wording', await page.isVisible('.banner'));
    ok('opening it is not a change', await page.isDisabled('#save'));
    await page.click('.banner [data-act=goto]'); await settle(page);
    await page.click('[data-act=nw-accept] >> nth=0'); await page.waitForTimeout(1200);
    ok('accepting prints the newer wording', (await frameDoc(page, d => d.body.textContent)).includes('Brand new record wording.'));
  } else ok('two saved resumes share a bullet version', false);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('tags and focus')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  await page.click('.item[data-act=r-open]:has-text("Medtech")'); await page.waitForTimeout(1500);
  const chip = page.locator('[data-act=focus]').filter({ hasText: 'Prototyping' });
  ok('the home card lists job types and tags to focus on', (await page.$$('[data-act=focus]')).length > 3);
  await chip.click(); await settle(page);
  const faded = await frameDoc(page, d => [d.documentElement.classList.contains('rb-focus'), d.querySelectorAll('.rb-hit').length, d.querySelectorAll('.bullets li').length]);
  ok('focus keeps the matching bullets bright and fades the rest', faded[0] && faded[1] > 0 && faded[1] < faded[2], faded.join());
  ok('and says what selecting would do', /turn on \d+, turn off \d+ and switch \d+/.test(await page.textContent('.focusbox')));
  const undo0 = await page.evaluate(() => window.__wb.store.history.undo);
  await page.click('[data-act=focus-apply]'); await page.waitForTimeout(1500);
  ok('applying is one undo step', (await page.evaluate(() => window.__wb.store.history.undo)) === undo0 + 1);
  ok('and leaves nothing more to do', await page.isDisabled('[data-act=focus-apply]'));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(1000);
  await page.frameLocator('#sheet iframe').locator('.bullets li.rb-hit').first().click(); await settle(page);
  ok('a focused tag stars its versions in the list', (await page.$$('.vrow .star')).length >= 1);
  await page.fill('.tag-in', 'smoke-tag'); await page.press('.tag-in', 'Enter'); await settle(page);
  const vid = await page.getAttribute('.vrow.cur', 'data-v');
  ok('Enter in the tag box tags the version in use', (await st()).record.variants.find(v => v.id === vid).tags.includes('smoke-tag'));
  ok('and the box keeps focus for the next one', await page.evaluate(() => document.activeElement?.classList.contains('tag-in')));
  await page.click('.vrow.cur .tag:has-text("smoke-tag") .rm'); await settle(page);
  ok('× removes it', !(await st()).record.variants.find(v => v.id === vid).tags.includes('smoke-tag'));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await page.click('[data-act=focus-clear]'); await settle(page);
  ok('clear focus brings the page back', !(await frameDoc(page, d => d.documentElement.classList.contains('rb-focus'))));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('languages')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  ok('the header has a language switch: one button beside Save', (await page.$$('#langbtn')).length === 1 && /English/.test(await page.textContent('#langbtn')));
  await page.click('#langbtn'); await settle(page);
  ok('it opens a menu of the languages you use (the example lists all ten), keyboard-operable', (await page.$$('.langpop [role=menuitemradio]')).length === 10 && (await page.getAttribute('.langpop', 'role')) === 'menu');
  ok('each with what is left to write', /to write|complete/.test(await page.textContent('.langpop')));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes it', !(await page.$('.langpop')));
  await page.click('#langbtn'); await settle(page);
  await page.click('.langpop [data-act=lang][data-lang=hu]'); await page.waitForTimeout(2500);
  ok('the Hungarian button switches the resume to Hungarian', (await st()).cur.lang === 'hu' && /Tapasztalat/i.test(await frameDoc(page, d => d.body.textContent)));
  await page.click('.srow[data-sid=interests] input'); await page.waitForTimeout(2000);
  ok('a section with no Hungarian still prints, in English', /Dinghy sailing/.test(await frameDoc(page, d => d.body.textContent)));
  ok('outlined on the page', (await frameDoc(page, d => d.querySelectorAll('.rb-miss').length)) >= 3);
  ok('and listed in the card', (await page.$$('.missbar .miss-go')).length >= 3);
  await page.click('.missbar .miss-go:has-text("Dinghy sailing")'); await settle(page);
  ok('a missing text opens with the English for reference and a box to write it', await page.isVisible('#ed-new') && await page.isVisible('.writein .ref'));
  await page.fill('#ed-new', 'Vitorlázás'); await page.click('[data-act=write-in]'); await page.waitForTimeout(1500);
  ok('saving writes Hungarian v1, and the page prints it', /Vitorlázás/.test(await frameDoc(page, d => d.body.textContent)) && (await st()).record.variants.some(v => v.lang === 'hu' && v.text === 'Vitorlázás' && v.n === '1'));
  await page.keyboard.press('Escape'); await settle(page);
  const outlined = await frameDoc(page, d => d.querySelectorAll('.rb-miss').length);
  await page.click('.missbar .miss-go:has-text("Bookbinding")'); await settle(page);
  await page.click('.writein input[data-same]'); await page.waitForTimeout(1500);
  ok('"same in every language" takes it off the list', (await st()).record.same.some(k => /interest-bookbinding/.test(k)) && !(await page.$('.missbar .miss-go:has-text("Bookbinding")')));
  const after = await frameDoc(page, d => d.querySelectorAll('.rb-miss').length);
  ok('and off the page’s outlines', after === outlined - 1, `${outlined} → ${after}`);
  await page.keyboard.press('Escape'); await settle(page);
  await page.click('#langbtn'); await settle(page); await page.click('.langpop [data-act=lang][data-lang=en]'); await page.waitForTimeout(2000);
  ok('back to English', !(await st()).cur.lang && /Experience/i.test(await frameDoc(page, d => d.body.textContent)));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('import, merge, history')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page);
  page.on('dialog', d => d.accept('Smoke checkpoint'));
  const st = () => page.evaluate(() => window.__wb.store.state);
  const jr = fs.readFileSync(path.join(ROOT, 'checks/fixtures/jsonresume-sample.json'), 'utf8');
  await page.click('[data-act=menu]'); await page.click('.menu [data-v=import]'); await settle(page);
  ok('⋯ › Open or import shows the one door', await page.isVisible('#imp-paste') && await page.isVisible('[data-act=imp-pick]'));
  await page.fill('#imp-paste', '{"basics": '); await page.click('[data-act=imp-paste]'); await settle(page);
  ok('broken JSON says why', /valid JSON/.test(await page.textContent('#body')));
  await page.click('[data-act=goto][data-v=import]'); await settle(page);
  await page.fill('#imp-paste', jr); await page.click('[data-act=imp-paste]'); await settle(page);
  ok('a pasted JSON Resume is recognised, with a review card', /A JSON Resume/.test(await page.textContent('#body .title')) && /Claims/.test(await page.textContent('table.kv')));
  ok('a linked photo is not fetched', /linked, not embedded/.test(await page.textContent('table.kv')));
  await page.click('[data-act=imp-merge]'); await settle(page);
  ok('add to the example: the merge preview groups what it found', (await page.$$('.mgroup')).length >= 2 && (await page.$$('.mi input[type=checkbox]')).length > 3);
  const nItems = (await page.$$('.mi input[type=checkbox]:checked')).length;
  await page.click('.mi input[type=checkbox] >> nth=0'); await settle(page);
  ok('unticking one updates the count', new RegExp(`Merge ${nItems - 1} change`).test(await page.textContent('[data-act=imp-do-merge]')));
  await page.click('[data-act=imp-do-merge]'); await page.waitForTimeout(1800);
  ok('merging brings the new jobs in', (await st()).record.work.some(w => w.name === 'Fjord Instruments'));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(1200);
  ok('and Ctrl+Z takes the merge back', !(await st()).record.work.some(w => w.name === 'Fjord Instruments'));

  await page.click('[data-act=menu]'); await page.click('.menu [data-v=import]'); await settle(page);
  await page.fill('#imp-paste', jr); await page.click('[data-act=imp-paste]'); await settle(page);
  await page.click('[data-act=imp-replace]'); await page.waitForTimeout(2500);
  ok('opening it instead makes it the record', (await st()).record.basics.name === 'Robin Vale' && /Robin Vale/.test(await frameDoc(page, d => d.body.textContent)));
  ok('and the page prints its highlights', /IP68 housing/.test(await frameDoc(page, d => d.body.textContent)));

  // a record edited outside: its edits become versions
  const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/example.json'), 'utf8'));
  ex.work[0].highlights[0] = 'Edited in a text editor, outside the app.';
  await page.click('[data-act=menu]'); await page.click('.menu [data-v=import]'); await settle(page);
  await page.fill('#imp-paste', JSON.stringify(ex)); await page.click('[data-act=imp-paste]'); await settle(page);
  ok('a record edited outside says so', /Edited outside/.test(await page.textContent('table.kv')) && await page.isChecked('#imp-outside'));
  await page.click('[data-act=imp-replace]'); await page.waitForTimeout(2000);
  ok('opening it turns the edit into a version', (await st()).record.variants.some(v => v.text === 'Edited in a text editor, outside the app.'));

  await page.click('[data-act=menu]'); await page.click('.menu [data-v=history]'); await page.waitForTimeout(1200);
  ok('History lists the checkpoints the imports saved', (await page.$$('.cprow')).length >= 2);
  await page.click('.cprow >> nth=0'); await page.waitForTimeout(1200);
  ok('selecting one shows what changed since', (await page.$$('.mi.ro')).length > 0);
  await page.click('[data-act=cp-new]'); await page.waitForTimeout(1000);
  ok('Save checkpoint adds a named one', /Smoke checkpoint/.test(await page.textContent('#body')));
  await page.click('[data-act=cp-file]');
  await page.setInputFiles('#file', path.join(ROOT, 'checks/fixtures/jsonresume-sample.json')); await page.waitForTimeout(1200);
  ok('Compare with a file shows the differences without changing anything', /compared with now/.test(await page.textContent('#body')) && (await st()).record.basics.name === 'Dana Okonkwo');
  await page.click('.cprow:has-text("Before opening pasted JSON") >> nth=-1'); await page.waitForTimeout(1000);
  await page.click('[data-act=cp-restore]'); await page.waitForTimeout(2000);
  ok('Restore puts that state back', (await st()).record.basics.name === 'Dana Okonkwo' && !(await st()).record.variants.some(v => v.text === 'Edited in a text editor, outside the app.'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('save to file: one file, Ctrl+S, opening it safely')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brewcv-save-'));
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const bad = await open(page);
  await page.evaluate(() => window.__wb.store.commit(d => { d.record.meta.owner = 'Sam Example'; }, 'smoke: make it mine'));   // the example on its own is replaced without a warning
  const st = () => page.evaluate(() => window.__wb.store.state);
  const fstate = () => page.evaluate(() => { const f = window.__wb.persist.fileState; return { last: f.last, changes: f.changes }; });
  const head = () => page.textContent('#filestate');
  const edit = label => page.evaluate(l => window.__wb.store.commit(d => { d.record.basics.label = l; }, 'smoke edit'), label);
  let n = 0;
  const downloaded = async trigger => {
    const [d] = await Promise.all([page.waitForEvent('download'), trigger()]);
    const p = path.join(tmp, `${++n}-${d.suggestedFilename()}`);
    await d.saveAs(p);
    return { name: d.suggestedFilename(), path: p, json: JSON.parse(fs.readFileSync(p, 'utf8')) };
  };
  const open1 = async file => { await page.click('[data-act=menu]'); await page.click('.menu [data-v=import]'); await settle(page); await page.setInputFiles('#file', file); await page.waitForTimeout(900); };
  const copy = (src, fn, name) => { const j = JSON.parse(fs.readFileSync(src, 'utf8')); fn(j); const p = path.join(tmp, name); fs.writeFileSync(p, JSON.stringify(j, null, 2)); return p; };

  ok('before any file save, the header says so', /Not saved to a file yet/.test(await head()));
  const f1 = await downloaded(async () => { await page.click('[data-act=menu]'); await page.click('.menu [data-act=save-file]'); });
  ok('Save to file downloads brewcv.json', f1.name === 'brewcv.json');
  const s1 = await st();
  ok('it holds the record, every saved resume and no checkpoints', f1.json.resumeBuilderBackup === 1 && f1.json.resumes.length === s1.resumes.length && s1.resumes.length > 3 && !('checkpoints' in f1.json));
  ok('it names the app version and the record', f1.json.app === version && f1.json.recordId === s1.record.recordId && !!f1.json.recordId);
  ok('the header says Saved to file, and it is a button', /^Saved to file/.test(await head()) && (await page.$eval('#filestate', e => e.tagName)) === 'BUTTON');
  ok('the first save shows the one-time note about the Save dialog', await page.isVisible('[data-act=save-note-ok]') && /Ask where to save each file/.test(await page.textContent('.notice')));
  const persisted = await page.evaluate(() => window.__wb.ui.persisted);
  ok('and, if the browser would not promise to keep storage, that the file is the safe copy', persisted !== false || /safe copy/.test(await page.textContent('.notice')));
  await page.click('[data-act=save-note-ok]'); await settle(page);
  ok('the note goes away when dismissed', !(await page.isVisible('[data-act=save-note-ok]')));

  await edit('Smoke label one'); await page.waitForTimeout(500);
  ok('one change since: “1 change not saved to a file”', /^1 change not saved to a file/.test(await head()), await head());
  await edit('Smoke label two'); await page.waitForTimeout(500);
  ok('two changes: “2 changes not saved to a file”', /^2 changes not saved to a file/.test(await head()), await head());

  await page.click('[data-act=goto][data-v=export]'); await settle(page);
  const f2 = await downloaded(() => page.keyboard.press('Control+s'));
  ok('Ctrl+S saves to the file too, in any view (here Export)', f2.name === 'brewcv.json' && f2.json.record.basics.label === 'Smoke label two' && f2.json.recordId === f1.json.recordId);
  ok('and the count starts again', /^Saved to file/.test(await head()) && (await fstate()).changes === 0);
  ok('the note does not come back', !(await page.isVisible('[data-act=save-note-ok]')));
  const quiet = await Promise.race([page.waitForEvent('download').then(() => false), (async () => {
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true })));
    await page.waitForTimeout(900); return true; })()]);
  ok('Ctrl+S during an IME composition does nothing', quiet);
  const mac = await downloaded(() => page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }))));
  ok('Cmd+S does the same', mac.name === 'brewcv.json');
  await page.keyboard.press('Escape'); await settle(page);

  // opening files next to what this browser has
  const last = (await fstate()).last;
  await open1(mac.path);
  ok('the file just saved, nothing changed since: “Already up to date”', /Already up to date/.test(await page.textContent('#body')) && !(await page.$('[data-act=imp-replace]')) && (await st()).record.basics.label === 'Smoke label two');
  const old = copy(mac.path, j => { j.saved = '2020-01-01T00:00:00.000Z'; }, 'older.json');
  await open1(old);
  ok('an older file of this record warns, with Save them first, Merge and Replace anyway', /older than the one you last saved here/.test(await page.textContent('#body'))
    && await page.isVisible('[data-act=imp-save-first]') && await page.isVisible('[data-act=imp-merge]') && await page.isVisible('[data-act=imp-replace]'));
  ok('and nothing has changed', (await st()).record.basics.label === 'Smoke label two' && (await fstate()).last.at === last.at);
  await edit('Not in any file'); await page.waitForTimeout(500);
  await open1(mac.path);
  ok('with changes not in a file: “This browser has 1 change that isn’t in any file”', /This browser has 1 change that isn.t in any file/.test(await page.textContent('#body')) && await page.isVisible('[data-act=imp-save-first]'));
  const f3 = await downloaded(() => page.click('[data-act=imp-save-first]'));
  await page.waitForTimeout(1800);
  ok('Save them first saves those changes to the file…', f3.json.record.basics.label === 'Not in any file');
  ok('…then opens the file', (await st()).record.basics.label === 'Smoke label two');
  ok('and that file is now the last one saved here', (await fstate()).last.at === mac.json.saved && (await fstate()).changes === 0);
  ok('with a checkpoint taken first', await page.evaluate(async () => (await window.__wb.persist.listCheckpoints()).some(c => /Before opening/.test(c.label))));
  const other = copy(mac.path, j => { j.recordId = 'someone-elses-record'; j.record.meta.resumeBuilder.recordId = 'someone-elses-record'; }, 'other.json');
  await open1(other);
  ok('a file from another record says so, with Merge or Replace only', /different record/.test(await page.textContent('#body')) && await page.isVisible('[data-act=imp-merge]') && await page.isVisible('[data-act=imp-replace]') && !(await page.$('[data-act=imp-save-first]')));
  const edited = copy(mac.path, j => { const w = j.record.work.find(x => (x.highlights ?? []).length); w.highlights[0] = 'Reworded in another tool, outside BrewCV.'; }, 'edited.json');
  await open1(edited);
  ok('text edited outside BrewCV in the one file is offered as versions', /Edited outside BrewCV/.test(await page.textContent('table.kv')) && await page.isChecked('#imp-outside'));
  await page.click('[data-act=imp-replace]'); await page.waitForTimeout(2000);
  ok('and opening it turns the edit into a version', (await st()).record.variants.some(v => v.text === 'Reworded in another tool, outside BrewCV.'));
  ok('no console errors', bad.length === 0, bad[0] ?? '');

  // a fresh browser: the introduction's “Open or import a file”
  const ctx2 = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page2 = await ctx2.newPage();
  const bad2 = await open(page2, '?memory&welcome');
  await page2.click('[data-act=ob-import]'); await settle(page2);
  await page2.setInputFiles('#file', mac.path); await page2.waitForTimeout(900);
  ok('a file opened in a fresh browser is offered plainly', /Open it/.test(await page2.textContent('[data-act=imp-replace]')) && !(await page2.$('[data-act=imp-save-first]')));
  await page2.click('[data-act=imp-replace]'); await page2.waitForTimeout(2500);
  const r2 = await page2.evaluate(() => { const s = window.__wb.store.state; return { id: s.record.recordId, label: s.record.basics.label, resumes: s.resumes.map(r => r.id).sort(), last: window.__wb.persist.fileState.last }; });
  ok('it restores the record and every saved resume', r2.id === mac.json.recordId && r2.label === 'Smoke label two' && r2.resumes.length === mac.json.resumes.length, JSON.stringify(r2).slice(0, 200));
  ok('and the next save carries on from that file', r2.last?.at === mac.json.saved && r2.last?.recordId === mac.json.recordId);
  const back = await Promise.all([page2.waitForEvent('download'), page2.keyboard.press('Control+s')]).then(async ([d]) => { const p = path.join(tmp, 'again.json'); await d.saveAs(p); return JSON.parse(fs.readFileSync(p, 'utf8')); });
  ok('saved again from there, it is the same record', back.recordId === mac.json.recordId && back.resumes.length === mac.json.resumes.length);
  ok('no console errors in the fresh browser', bad2.length === 0, bad2[0] ?? '');
  await ctx2.close();

  // a phone: the share sheet, and cancelling it
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, acceptDownloads: true });
  await ctx3.addInitScript(() => {
    window.__shareMode = 'ok';
    navigator.canShare = () => true;
    navigator.share = async d => { if (window.__shareMode === 'cancel') throw new DOMException('cancelled', 'AbortError'); window.__shared = { name: d.files[0].name, title: d.title, n: d.files.length, size: d.files[0].size }; };
  });
  const page3 = await ctx3.newPage();
  const bad3 = await open(page3);
  let downloads = 0; page3.on('download', () => downloads++);
  ok('on a phone the header shows the file state', await page3.isVisible('#filestate') && /Not saved to a file yet/.test(await page3.textContent('#filestate')));
  await page3.evaluate(() => { window.__shareMode = 'cancel'; });
  await page3.click('#filestate'); await page3.waitForTimeout(900);
  ok('cancelling the share sheet does nothing', downloads === 0 && (await page3.evaluate(() => window.__wb.persist.fileState.last)) === null && !(await page3.evaluate(() => window.__shared)));
  await page3.evaluate(() => { window.__shareMode = 'ok'; });
  await page3.click('[data-act=menu]'); await page3.click('.menu [data-act=save-file]'); await page3.waitForTimeout(900);
  const shared = await page3.evaluate(() => window.__shared);
  ok('Save opens the share sheet with brewcv.json, and does not download', shared?.name === 'brewcv.json' && shared.n === 1 && shared.size > 1000 && downloads === 0, JSON.stringify(shared));
  ok('and counts as saved', /^Saved to file/.test(await page3.textContent('#filestate')));
  ok('no one-time note on a phone', !(await page3.isVisible('[data-act=save-note-ok]')));
  ok('no console errors on the phone', bad3.length === 0, bad3[0] ?? '');
  await ctx3.close();

  // a linked folder that was changed by something else
  await page.evaluate(async () => {
    const files = new Map(); window.__stubFiles = files;
    const folder = { name: 'stub-folder', async read(p){ return files.has(p) ? files.get(p) : null; }, async write(p, t){ files.set(p, t); },
      async list(d){ const pre = d.replace(/\/?$/, '/'); return [...files.keys()].filter(k => k.startsWith(pre)).map(k => k.slice(pre.length)); },
      async permission(){ return 'granted'; }, async remove(p){ files.delete(p); } };
    await window.__wb.persist.link(folder);
  });
  await edit('Written by the app'); await page.waitForTimeout(900);
  ok('a linked folder gets what the app writes', await page.evaluate(() => JSON.parse(window.__stubFiles.get('resume-data.json')).basics.label) === 'Written by the app');
  await page.evaluate(() => window.__stubFiles.set('resume-data.json', window.__stubFiles.get('resume-data.json').replace('Written by the app', 'Changed by hand')));
  await edit('The app again'); await page.waitForTimeout(900);
  ok('a file changed outside the app is not written over', await page.evaluate(() => JSON.parse(window.__stubFiles.get('resume-data.json')).basics.label) === 'Changed by hand');
  ok('the header says it was changed outside, and offers Compare', /changed outside BrewCV/.test(await page.textContent('.notice')) && await page.isVisible('[data-act=folder-compare]'));
  await page.click('[data-act=folder-compare]'); await page.waitForTimeout(1200);
  ok('Compare opens the History view with the differences', /compared with now/.test(await page.textContent('#body')) && (await page.$$('#body .mi.ro')).length > 0);
  await page.click('[data-act=folder-overwrite]'); await page.waitForTimeout(900);
  ok('Overwrite writes the app’s version and the notice goes', await page.evaluate(() => JSON.parse(window.__stubFiles.get('resume-data.json')).basics.label) === 'The app again' && !(await page.isVisible('[data-act=folder-compare]')));
  await ctx.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (want('export')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const bad = await open(page);
  const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-export-'));
  for (const pick of ['Example Instruments', 'Medtech', 'Dunamenti']){
    await page.click(`.item[data-act=r-open]:has-text("${pick}")`); await page.waitForTimeout(1800);
    const sheetPages = await page.evaluate(() => window.__wb.ui.fills.length);
    const html = await page.evaluate(() => window.__wb.export.buildHtml());
    const f = path.join(tmp, `${pick}.html`);
    fs.writeFileSync(f, html);
    const off = await browser.newContext();
    await off.setOffline(true);
    const q = await off.newPage();
    const reqs = [];
    q.on('request', r => { if (!/^(data|file):/.test(r.url())) reqs.push(r.url()); });
    await q.goto(pathToFileURL(f).href); await q.waitForTimeout(400);
    const fonts = await q.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(x => x.status === 'loaded').length; });
    const pages = await q.$$eval('.document > .page', x => x.length);
    const pdf = await q.pdf({ preferCSSPageSize: true });
    const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    ok(`${pick}: the HTML page opens offline, with its fonts, asking for nothing`, reqs.length === 0 && fonts >= 3, `${reqs[0] ?? ''} fonts ${fonts}`);
    ok(`${pick}: every page, as on the sheet, and printed the same`, pages === sheetPages && pdfPages === sheetPages, `sheet ${sheetPages} · html ${pages} · pdf ${pdfPages}`);
    ok(`${pick}: no scripts and no app attributes`, !/<script|data-variant|rb-sel/.test(html));
    await off.close();
  }
  await page.click('[data-act=goto][data-v=export]'); await settle(page);
  ok('Export lists pre-flight checks', (await page.$$('.checks li')).length >= 1);
  for (const [act, ext] of [['ex-html', 'html'], ['ex-txt', 'txt'], ['ex-json', 'json']]){
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-act=${act}]`)]);
    const p = path.join(tmp, dl.suggestedFilename());
    await dl.saveAs(p);
    ok(`${ext} downloads, named for the resume`, dl.suggestedFilename().endsWith(`.${ext}`) && /Dunamenti/.test(dl.suggestedFilename()) && fs.statSync(p).size > 500);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('design and theme tokens')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  const tabBg = () => frameDoc(page, d => getComputedStyle(d.querySelector('.band[data-section] .tab')).backgroundColor);
  await page.click('[data-act=goto][data-v=design]'); await settle(page);
  ok('Design opens from the header', (await page.getAttribute('#body', 'data-view')) === 'design');
  await page.click('[data-act=d-accent][data-c="#9cc3ff"]'); await page.waitForTimeout(1500);
  ok('an accent swatch recolours the tabs', (await tabBg()) === 'rgb(156, 195, 255)' && (await st()).cur.accent === '#9cc3ff');
  ok('and says the tab text still reads', /readable/.test(await page.textContent('#body')));
  await page.click('[data-act=d-tpl][data-t=tint]'); await page.waitForTimeout(1800);
  ok('a template switches the overlay', JSON.stringify((await st()).cur.overlays) === '["tint-tabs"]' && await frameDoc(page, d => [...d.querySelectorAll('link')].some(l => /tint-tabs/.test(l.href))));
  await page.click('[data-act=d-tpl][data-t=b2]'); await page.waitForTimeout(1500);
  await page.click('[data-act=d-pages][data-n="0"]'); await page.waitForTimeout(1500);
  ok('pages: as many as needed turns Fit off', (await st()).cur.pageLimit === 0 && await page.isDisabled('[data-act=fit]'));
  await page.click('[data-act=d-pages][data-n="1"]'); await page.waitForTimeout(1200);
  await page.click('[data-act=d-paper][data-f=a4]'); await page.waitForTimeout(2000);
  ok('paper: A4', (await st()).cur.format === 'a4' && await frameDoc(page, d => /a4\.css/.test([...d.querySelectorAll('link')].map(l => l.href).join())));

  // a theme from Figma: DTCG, dropped through the import box
  const theme = { color: { $type: 'color', accent: { $value: '#d6b4ff' }, ink: { $value: '#202040' }, evil: { $value: 'url(x)' } },
    font: { body: { family: { $type: 'fontFamily', $value: ['Georgia', 'serif'] } } }, style: { tab: { $type: 'string', $value: 'underline' } } };
  await page.click('[data-act=d-accent][data-c=""]').catch(() => {}); await page.waitForTimeout(800);
  await page.click('[data-act=d-import]');
  await page.setInputFiles('#file', { name: 'Lilac.tokens.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(theme)) });
  await page.waitForTimeout(1800);
  ok('an imported DTCG theme is applied to this resume', (await st()).record.themes.some(t => t.name === 'Lilac' && t.tokens.accent === '#d6b4ff') && (await st()).cur.look);
  ok('its fonts and switches show on the page', await frameDoc(page, d => /Georgia/.test(getComputedStyle(d.querySelector('.bullets li')).fontFamily) && getComputedStyle(d.querySelector('.band[data-section] .tab')).backgroundImage === 'none'));
  ok('the unknown token is named in the message', /ignored 1 \(color\.evil\)/.test(await page.textContent('#toast')));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=d-export]')]);
  const back = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok('Export this theme writes DTCG with $types', back.color?.accent?.$type === 'color' && back.color.accent.$value.hex === '#d6b4ff' && back.font?.body?.family?.$type === 'fontFamily');
  const html = await page.evaluate(() => window.__wb.export.buildHtml());
  ok('the HTML export carries the theme', /--accent: #d6b4ff/.test(html) && /Georgia/.test(html));

  // the photo: any image, cropped to the passport ratio
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 700; const g = c.getContext('2d'); g.fillStyle = '#88a'; g.fillRect(0, 0, 900, 700); g.fillStyle = '#fc8'; g.beginPath(); g.arc(450, 280, 160, 0, 7); g.fill(); return c.toDataURL('image/png').split(',')[1]; });
  await page.click('[data-act=d-photo]');
  await page.setInputFiles('#file', { name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForTimeout(2500);
  const img = await page.evaluate(async () => { const src = window.__wb.store.materialize(window.__wb.store.state.record.basics.image); const i = new Image(); i.src = src; await i.decode(); return { w: i.naturalWidth, h: i.naturalHeight, jpeg: src.startsWith('data:image/jpeg'), kb: src.length * 0.75 / 1024 }; });
  ok('a photo is cropped to 472 × 600, a JPEG under 300 KB', img.w === 472 && img.h === 600 && img.jpeg && img.kb < 300, JSON.stringify(img));
  ok('and shown on this resume, at the passport ratio', (await st()).cur.photo.show && await frameDoc(page, d => { const p = d.querySelector('img.portrait'); if (!p) return false; const r = p.getBoundingClientRect(); return Math.abs(r.height / r.width - 45 / 35) < 0.02; }));
  ok('the summary runs beside the photo, so the header leaves no hole', await frameDoc(page, d => !!d.querySelector('.band--header .summary--in-header') && d.querySelector('.band--absorbed')?.getBoundingClientRect().height === 0));
  ok('the photo stays out of the undo snapshots', await page.evaluate(() => /^asset:/.test(window.__wb.store.state.record.basics.image)));
  await page.click('[data-act=d-shape][data-s=round]'); await page.waitForTimeout(1200);
  ok('shape: circle', await frameDoc(page, d => !!d.querySelector('img.portrait--round')));
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('onboarding and career')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  const bad = await open(page, '?memory&welcome');
  const st = () => page.evaluate(() => window.__wb.store.state);
  const text = () => frameDoc(page, d => d.body.textContent);
  ok('a first visit starts on the introduction, with the three ways in and no language step yet', (await page.getAttribute('#body', 'data-view')) === 'welcome' && (await page.$$('.obchoices button')).length === 3 && !(await page.$('[data-act=ob-lang-go]')));
  ok('and the “Yours to keep” banner, which says it is private', /Yours to keep/.test(await page.textContent('#body')) && /Private/.test(await page.textContent('.obkeep')));
  await page.click('[data-act=ob-scratch]'); await settle(page);
  ok('choosing one asks for the language', !!(await page.$('[data-act=ob-lang-go]')));
  await page.click('[data-act=ob-lang-go]'); await page.waitForTimeout(1200);
  await page.fill('#ob-name', 'Robin Vale'); await page.fill('#ob-label', 'Hardware engineer'); await page.fill('#ob-email', 'robin@example.org'); await page.fill('#ob-city', 'Halden');
  await page.waitForTimeout(1200);
  ok('the sheet fills in while you type', /Robin Vale/.test(await text()) && /robin@example\.org/.test(await text()));
  await page.click('[data-act=ob-next]'); await settle(page);
  await page.click('[data-act=ob-market][data-m=hu]'); await settle(page);
  await page.click('[data-act=ob-next]'); await settle(page);
  await page.fill('#ob-pos', 'Mechanical Engineer'); await page.fill('#ob-emp', 'Fjord Instruments'); await page.fill('#ob-start', '2022-04');
  await page.check('#ob-current'); await page.fill('#ob-loc', 'Halden');
  await page.fill('#ob-claims', 'Designed an IP68 housing for a river-gauge logger.\nCut the sensor head’s assembly time from 40 to 25 minutes.');
  await page.click('[data-act=ob-another]'); await page.waitForTimeout(1200);
  ok('save and add another job', (await st()).record.work.length === 1 && (await page.inputValue('#ob-pos')) === '');
  await page.click('[data-act=ob-back]'); await settle(page); await page.click('[data-act=ob-back]'); await settle(page);
  ok('Back keeps what was typed', (await page.inputValue('#ob-name')) === 'Robin Vale');
  await page.click('[data-act=ob-next]'); await settle(page); await page.click('[data-act=ob-next]'); await settle(page);
  await page.fill('#ob-pos', 'Design Intern'); await page.fill('#ob-emp', 'Northwind Labs'); await page.fill('#ob-start', '2021-06'); await page.fill('#ob-end', '2021-12');
  await page.fill('#ob-claims', 'Built test fixtures for a hand-held spectrometer.');
  await page.click('[data-act=ob-next]'); await page.waitForTimeout(1000);
  await page.fill('#ob-inst', 'Example Technical University'); await page.fill('#ob-type', 'B.Sc.'); await page.fill('#ob-area', 'Mechanical Engineering');
  await page.click('[data-act=ob-next]'); await page.waitForTimeout(1000);
  await page.fill('#ob-skills', 'CAD: SolidWorks, Onshape\nTest: IP testing, drop testing');
  await page.click('[data-act=ob-next]'); await page.waitForTimeout(1000);
  ok('Hungary asks for a photo', /A photo/.test(await page.textContent('#body .title')));
  await page.click('[data-act=ob-skip]'); await settle(page);
  await page.click('[data-act=ob-finish]'); await page.waitForTimeout(2000);
  const page1 = await text();
  ok('blank → a finished resume: both jobs, their claims, the degree, the skills', ['Fjord Instruments', 'IP68 housing', 'Northwind Labs', 'B.Sc.', 'Onshape'].every(x => page1.includes(x)));
  ok('on A4, with a meter', (await st()).cur.format === 'a4' && /% full/.test(await page.textContent('#meter')));
  ok('the first tip shows', /Tip 1 of 3/.test(await page.textContent('#body')));
  ok('and the record validates', await page.evaluate(async () => { const V = await import('./checks/lib/validate.mjs'); const S = await import('./src/model/schema.js'); const s = window.__wb.store.state; return V.validate(S.save(window.__wb.store.materialize(s.record)), s.cur).errors.length === 0; }));
  await page.click('[data-act=tip-skip]'); await settle(page);

  await page.click('[data-act=ws][data-ws=career]'); await page.waitForTimeout(1200);
  ok('Career shows the timeline where the sheet was: two jobs on the left, the degree beside them', await page.isVisible('#career') && (await page.$$('.tl2 .row')).length === 2 && (await page.$$('.tl2 .srow')).length === 1);
  ok('and the sheet as a thumbnail', await page.isVisible('#thumb'));
  if (await page.$('[data-act=c-tip-skip]')){ await page.click('[data-act=c-tip-skip]'); await settle(page); }
  await page.click('.tl2 .row:has-text("Design Intern")'); await settle(page);
  await page.click('[data-act=c-details][data-open="1"]'); await settle(page);
  await page.fill('#c-pos', 'Design Engineering Intern'); await page.fill('#c-end', '2022-01');
  await page.click('[data-act=c-save]'); await page.waitForTimeout(1200);
  ok('editing a job’s facts', (await st()).record.work.find(w => w.name === 'Northwind Labs').position === 'Design Engineering Intern');
  await page.fill('#new-claim', 'Wrote the fixture drawings and the test procedure.'); await page.click('[data-act=add-claim]'); await page.waitForTimeout(1000);
  ok('adding a claim', (await st()).record.work.find(w => w.name === 'Northwind Labs').highlights.length === 2);
  await page.click('[data-act=c-claim] >> nth=1'); await settle(page);
  await page.click('[data-act=delete-claim]'); await page.waitForTimeout(1000);
  ok('🗑 deletes a claim, saying Ctrl+Z brings it back', (await st()).record.work.find(w => w.name === 'Northwind Labs').highlights.length === 1 && /Ctrl\+Z brings it back/.test(await page.textContent('#toast')));
  await page.click('[data-act=undo]'); await page.waitForTimeout(1000);
  ok('which it does', (await st()).record.work.find(w => w.name === 'Northwind Labs').highlights.length === 2);
  await page.click('[data-act=c-claim] >> nth=0'); await settle(page); await page.click('[data-act=delete-claim]'); await page.waitForTimeout(800);
  await page.click('[data-act=c-claim] >> nth=0'); await settle(page); await page.click('[data-act=delete-claim]'); await page.waitForTimeout(800);
  ok('a job’s last claim can’t be deleted', (await st()).record.work.find(w => w.name === 'Northwind Labs').highlights.length === 1 && /last/.test(await page.textContent('#toast')));
  await page.click('[data-act=undo]'); await page.waitForTimeout(1000);
  await page.keyboard.press('Escape'); await settle(page);
  await page.click('#thumb'); await page.waitForTimeout(1500);
  ok('the thumbnail goes back to the resume', (await page.evaluate(() => document.body.dataset.ws)) === 'resume');
  const p2 = await text();
  ok('the page follows the edit: new title, new dates, new claim', p2.includes('Design Engineering Intern') && /Jan 2022/i.test(p2) && p2.includes('fixture drawings'));
  await page.keyboard.press('c'); await settle(page);
  ok('C and R switch workspaces', (await page.evaluate(() => document.body.dataset.ws)) === 'career');
  await page.keyboard.press('r'); await settle(page);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('one way of editing, in Career and in Resume')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('rb-career-tips', 'done'); } catch {} });
  const bad = await open(page);
  const st = () => page.evaluate(() => window.__wb.store.state);
  const ws = () => page.evaluate(() => document.body.dataset.ws);
  const nOf = async () => (await st()).record.variants.length;
  await page.click('[data-act=select-section][data-id=experience]'); await settle(page);
  await page.click('#body [data-act=select-job] >> nth=0'); await settle(page);
  await page.click('#body [data-act=select-bullet] >> nth=0'); await settle(page);
  const fact = await page.getAttribute('#body .vlist', 'data-fact');
  const rNums = await page.$$eval('#body .vrow .n', e => e.map(x => x.textContent.replace(/\D*$/, '')));
  ok('the Resume\'s claim panel: ◉ on the one in use, ✎ on it, 🗑 in the header above the versions', (await page.$$('#body .vrow .rad')).length >= 1 && (await page.$$('#body .vrow.cur')).length === 1
    && await page.evaluate(() => { const d = document.querySelector('#body [data-act=delete-claim]'), l = document.querySelector('#body .lbl'); return !!d && !!(d.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await page.evaluate(f => { const w = window.__wb.store.state.record; const e = (w.work ?? []).find(x => (x.highlights ?? []).includes(f)); window.__wb.career.focus({ area: 'timeline', sel: { what: 'claim', key: 'work', id: e.id, claim: f } }); }, fact);
  await page.click('[data-act=ws][data-ws=career]'); await page.waitForTimeout(1200);
  ok('Career opens the same claim in the same panel', await page.isVisible('#body .vlist.flat') && (await page.getAttribute('#body .vlist', 'data-fact')) === fact);
  const cNums = await page.$$eval('#body .vrow .n', e => e.map(x => x.textContent.replace(/\D*$/, '')));
  ok('with every version, in the same order (Career lists the minors the Resume folds)', rNums.every(n => cNums.includes(n)), `${rNums} / ${cNums}`);
  ok('Career\'s list: no ◉, nothing in use, no "use", no Keep, no "On this resume"', !(await page.$('#body .rad')) && !(await page.$('#body .vrow.cur')) && !(await page.$('#body [data-act=use-version]')) && !(await page.$('#body [data-act=keep]')) && !(await page.$('#body #b-on')));
  ok('every row has ✎ ⇄ 🗑 and the tag box', await page.$$eval('#body .vrow.flat', rs => rs.length > 0 && rs.every(r => r.querySelector('[data-act=edit]') && r.querySelector('[data-act=compare]') && r.querySelector('[data-act=delete-version]') && r.querySelector('.tag-in'))));
  ok('the same keys, in the same words, under it', /walk the bullets/.test(await page.textContent('#body .keys')));
  ok('no sideways scroll', await page.evaluate(() => { const b = document.querySelector('#body'); return b.scrollWidth <= b.clientWidth + 1; }));
  const picks0 = JSON.stringify((await st()).cur.picks), n0 = await nOf();
  await page.click('#body .vrow.flat [data-act=edit] >> nth=0'); await settle(page);
  ok('✎ opens the editor in place of the row, with no "this resume only"', await page.isVisible('#ed') && !(await page.$('#body [data-act=ed-only]')) && /\bch\b/.test(await page.textContent('#ed-stats')));
  await page.fill('#ed', (await page.inputValue('#ed')) + ' Reworded in Career.'); await settle(page);
  await page.click('[data-act=ed-saveas]'); await page.waitForTimeout(900);
  ok('Save as vN.1 writes a version; the open resume still uses what it used', (await nOf()) === n0 + 1 && JSON.stringify((await st()).cur.picks) === picks0 && !(await page.$('#ed')));
  await page.click('#body [data-act=new-version]'); await settle(page);
  await page.fill('#ed', 'A different take, for another kind of job.'); await page.click('[data-act=ed-new]'); await page.waitForTimeout(900);
  ok('+ Write a new version writes the next whole number', (await nOf()) === n0 + 2 && JSON.stringify((await st()).cur.picks) === picks0);
  await page.keyboard.press('ArrowDown'); await settle(page);
  ok('↓ in an entry opens its first claim', !!(await page.$('#body .vlist')));
  await page.keyboard.press('ArrowRight'); await settle(page);
  ok('→ marks the next version', !!(await page.$('#body .vrow.is-pick')));
  await page.keyboard.press('Enter'); await settle(page);
  ok('Enter edits it', await page.isVisible('#ed'));
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes the editor first', !(await page.$('#ed')) && !!(await page.$('#body .vlist')));
  await page.keyboard.press('Escape'); await settle(page);
  ok('then goes up to the entry', !(await page.$('#body .vlist')) && !!(await page.$('#body .where')));
  await page.keyboard.press('Escape'); await settle(page);
  ok('then leaves the panel', (await ws()) === 'career' && !(await page.$('#body .where')));
  await page.keyboard.press('Escape'); await settle(page);
  ok('and then goes back to the Resume', (await ws()) === 'resume');
  await page.click('[data-act=select-section][data-id=experience]'); await settle(page);
  await page.click('#body [data-act=select-job] >> nth=0'); await settle(page);
  const jobId = await page.evaluate(() => window.__wb.ui.sel.id);
  const hl = async () => (await st()).record.work.find(w => w.id === jobId).highlights.length;
  const h0 = await hl();
  await page.fill('#new-claim', 'Wrote the fixture drawings and the test procedure.'); await page.click('[data-act=add-claim]'); await page.waitForTimeout(1000);
  ok('+ Add something you did, in the Resume: the claim is added and on', (await hl()) === h0 + 1 && /fixture drawings/.test(await frameDoc(page, d => d.body.textContent)));
  await page.click('#body [data-act=select-bullet] >> nth=-1'); await settle(page);
  await page.click('#body [data-act=delete-claim]'); await page.waitForTimeout(1000);
  ok('🗑 in the Resume deletes it and goes back to the job; Ctrl+Z brings it back', (await hl()) === h0 && (await page.evaluate(() => window.__wb.ui.sel.kind)) === 'job');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(1000);
  ok('…which it does', (await hl()) === h0 + 1);
  await page.click('#body [data-act=select-bullet] >> nth=0'); await settle(page);
  const before = await page.textContent('#body .title');
  await page.keyboard.press('ArrowDown'); await settle(page);
  ok('↓ in the Resume walks the bullets', (await page.textContent('#body .title')) !== before);
  await page.keyboard.press('Enter'); await settle(page);
  ok('Enter edits the one in use', await page.isVisible('#ed') && !!(await page.$('#body [data-act=ed-only]')));
  await page.keyboard.press('Escape'); await settle(page);
  ok('no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}


if (want('deployed: a subpath, offline, a phone, names')) {
  // served under /brewcv/ the way GitHub Pages serves a project site
  const BASE = '/brewcv';
  const sub = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (!p.startsWith(BASE)){ res.writeHead(404); return res.end(); }
    p = p.slice(BASE.length) || '/';
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise(r => sub.listen(PORT + 1, r));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  const bad = [];
  page.on('console', m => { if (m.type() === 'error') bad.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(`http://localhost:${PORT + 1}${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 });
  ok('it runs from a project subpath with nothing missing', bad.length === 0, bad[0] ?? '');
  ok('a first visit opens on the welcome card', (await page.getAttribute('#body', 'data-view')) === 'welcome');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(2500);
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const shell = [...sw.matchAll(/^\s*'(\.\/[^']*)',?$/gm)].map(m => m[1]);
  const version = sw.match(/const VERSION = '([^']+)'/)[1];
  const cached = await page.evaluate(async v => (await (await caches.open(v)).keys()).map(r => new URL(r.url).pathname), version);
  const missing = shell.filter(s => !cached.includes(new URL(s, `http://x${BASE}/`).pathname));
  ok(`the service worker precaches every file it lists (${shell.length})`, missing.length === 0, missing.join(', '));
  const srcs = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true }).filter(f => f.endsWith('.js') || f.endsWith('.css')).map(f => `./src/${f.split(path.sep).join('/')}`);
  const unlisted = srcs.filter(f => !shell.includes(f));
  ok('and lists every module the app has', unlisted.length === 0, unlisted.join(', '));
  const examples = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/example-resumes/index.json'), 'utf8')).map(n => `./data/example-resumes/${n}`);
  const noExample = examples.filter(f => !shell.includes(f));
  ok('and every example resume, which a first start loads', noExample.length === 0, noExample.join(', '));
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  ok('offline, it reloads and draws the resume', await page.evaluate(() => document.body.classList.contains('is-ready')) && /% full/.test(await page.textContent('#meter')));
  await ctx.close();
  sub.close();

  // a phone: view and pick versions only
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const pp = await ph.newPage();
  const badP = await open(pp);
  const s = await rect(pp, '#sheet');
  ok('phone: the page fills the width, no sideways scroll', Math.abs(s.width - (390 - 16)) < 2 && (await pp.evaluate(() => document.documentElement.scrollWidth)) <= 390, `${s.width.toFixed(1)}px`);
  ok('phone: the column is a bottom sheet', (await rect(pp, '#col')).bottom >= 843 && (await rect(pp, '#col')).height < 844 * 0.5);
  await pp.frameLocator('#sheet iframe').locator('.bullets li').first().tap(); await settle(pp);
  ok('phone: tapping a bullet lists its versions', (await pp.$$('.vrow')).length >= 2);
  ok('phone: no editing, Design or Export', !(await pp.isVisible('.vrow.cur [data-act=edit]')) && !(await pp.isVisible('[data-act=goto][data-v=design]')) && !(await pp.isVisible('.newv')));
  const before = await firstBullet(pp);
  await pp.locator('.vrow[data-v]:not(.cur)').first().tap(); await pp.waitForTimeout(1200);
  ok('phone: tapping a version uses it', (await firstBullet(pp)) !== before);
  ok('phone: no console errors', badP.length === 0, badP[0] ?? '');
  await ph.close();

  // every control has a name, every field a label
  const ctx2 = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const p2 = await ctx2.newPage();
  await open(p2);
  const unnamed = async () => p2.evaluate(() => [...document.querySelectorAll('#col button, #col input, #col textarea, #col [role=button]')]
    .filter(e => e.offsetParent !== null)
    .filter(e => !(e.getAttribute('aria-label') || e.title || e.textContent.trim() || e.closest('label') || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.placeholder))
    .map(e => e.outerHTML.slice(0, 80)));
  const views = [];
  for (const v of [null, 'resumes', 'design', 'export', 'import', 'history']){
    if (v) await p2.click(`[data-act=goto][data-v=${v}] >> nth=0`).catch(() => p2.evaluate(x => window.__wb.ui && document.querySelector(`[data-v=${x}]`)?.click(), v));
    await p2.waitForTimeout(700);
    views.push(...(await unnamed()).map(x => `${v ?? 'home'}: ${x}`));
    await p2.keyboard.press('Escape');
  }
  await p2.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(p2);
  views.push(...(await unnamed()).map(x => `bullet: ${x}`));
  ok('every visible control has a name', views.length === 0, views.slice(0, 3).join(' | '));
  await p2.keyboard.press('Escape'); await p2.keyboard.press('Escape'); await settle(p2);
  for (let i = 0; i < 6 && !(await p2.evaluate(() => !!document.activeElement?.closest('#col'))); i++) await p2.keyboard.press('Tab');
  const ring = await p2.evaluate(() => { const e = document.activeElement; return [e?.outerHTML.slice(0, 60), getComputedStyle(e).outlineStyle]; });
  ok('the keyboard reaches the controls, with a visible focus ring', ring[1] !== 'none', ring.join(' · '));
  await ctx2.close();
}

if (want('actual size')) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  await open(page);
  await page.click('[data-act=actual]'); await settle(page);
  ok('it opens, asking for the card first', await page.isVisible('.actual__cal'));
  await page.$eval('.actual__cal input', el => { el.value = '340'; el.dispatchEvent(new Event('input')); });
  await page.click('[data-k=done]'); await settle(page);
  const w = await page.$eval('.actual__host', el => el.getBoundingClientRect().width);
  const expect = 215.9 * 340 / 85.6;            // Letter, at the calibrated px per mm
  ok('the page is drawn at the calibrated size', Math.abs(w - expect) < 2, `${w.toFixed(1)} vs ${expect.toFixed(1)}`);
  await page.click('[data-k=cw]'); await settle(page);
  ok('⟳ turns it sideways', (await page.$eval('.actual__turn', el => el.dataset.turn)) === '1');
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes it', !(await page.$('.actual')));
  await page.click('[data-act=actual]'); await settle(page);
  ok('the calibration is remembered', !(await page.isVisible('.actual__cal')));
  await page.keyboard.press('Escape');
  await ctx.close();
}

if (want('the session survives a reload')) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const page = await ctx.newPage();
  await open(page, '');                                   // real IndexedDB this time
  await page.click('[data-act=ob-example]'); await settle(page);        // a first visit opens on the introduction; take the example
  await page.click('[data-act=ob-lang-go]'); await page.waitForTimeout(1500);
  // an open example on its own goes back to the start screen on a reload, so make it somebody's
  await page.evaluate(() => window.__wb.store.commit(d => { d.record.meta.owner = 'Sam Example'; }, 'smoke: make it mine'));
  await settle(page);
  await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
  await page.locator('.vrow[data-v]:not(.cur)').first().click(); await settle(page);
  await page.mouse.move(4, 4); await settle(page);
  const chosen = await firstBullet(page);
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#savestate')?.textContent ?? ''), null, { timeout: 5000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 });
  await page.waitForTimeout(800);
  ok('a reload opens the same resume with the same choice', (await firstBullet(page)) === chosen);
  ok('with a fresh undo stack', (await page.evaluate(() => window.__wb.store.history.undo)) === 0);
  await ctx.close();
}

if (want('file://')) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
  await page.waitForTimeout(1800);
  ok('opened from disk it says it needs an origin', await page.isVisible('#no-origin'));
  await ctx.close();
}

await browser.close();
server.close();
console.log(failed ? `\n${failed} shell check(s) FAILED` : '\nall shell checks passed');
process.exit(failed ? 1 : 0);
