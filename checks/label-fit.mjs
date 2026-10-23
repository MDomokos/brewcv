#!/usr/bin/env node
// node checks/label-fit.mjs
// Every default heading (doc.section.*) and its "continued" note fits the gutter of its language's A4
// format and of Letter, measured in Chromium with the real theme, clearing it by at least 3px (the
// margin a4-hu.css sets). Then the app's own labels in each of the ten languages, with the sidebar at its narrowest width (316px under 1400px, 340px from there, more on a large screen)
// in three windows: the place tabs, the name card, the foot, the zoom bar with Actual size, the Outline, the checklist, the lens, the
// switcher and Settings all fit what they are in. A label that is too wide is reported with its language, its text and its
// measured width (the check never shortens one). Writes only to out/. Needs playwright and a Chromium.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const I = await import(pathToFileURL(path.join(ROOT, 'src/i18n/index.js')));
const { LANG_INFO } = await import(pathToFileURL(path.join(ROOT, 'src/model/lang.js')));
const MARGIN = 3;
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };

fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/example-recipe.json'), 'utf8'));
for (const fmt of ['a4', 'a4-hu', 'us-letter']){
  const r = structuredClone(base);
  r.meta.resumeBuilder.resume.format = fmt;
  delete r.meta.resumeBuilder.resume.lang;
  const rec = path.join(ROOT, `out/label-fit-${fmt}.json`);
  fs.writeFileSync(rec, JSON.stringify(r));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/render.mjs'), path.join(ROOT, 'data/example.json'), rec, path.join(ROOT, `out/label-fit-${fmt}.html`)], { stdio: 'ignore' });
}

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
const PORT = Number(process.env.PORT ?? 8133);
await new Promise(r => server.listen(PORT, r));
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 }, bypassCSP: true });

const measure = async (fmt, words, notes) => {
  await page.goto(`http://localhost:${PORT}/out/label-fit-${fmt}.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(([words, notes]) => {
    const tab = [...document.querySelectorAll('.band--section h2.tab:not(.tab--cont)')][1];
    const gut = tab.closest('.band').querySelector('.band__gutter');
    const gw = gut.getBoundingClientRect().width;
    const note = document.createElement('p'); note.className = 'tab-note'; gut.append(note);
    note.style.width = 'max-content';
    const out = { gutter: gw, tabs: {}, notes: {} };
    for (const w of words){ tab.textContent = w; out.tabs[w] = Math.max(tab.getBoundingClientRect().width, tab.scrollWidth); }
    for (const w of notes){ note.textContent = w; out.notes[w] = note.getBoundingClientRect().width; }
    return out;
  }, [words, notes]);
};

for (const lang of I.UI_LANGS.filter(l => l !== 'en')){
  const cat = await I.loadCatalogue(lang);
  const heads = Object.entries(cat).filter(([k]) => k.startsWith('doc.section.')).map(([k, v]) => [k.slice(12), v]);
  const words = [...new Set(heads.map(([, v]) => v))];
  const notes = [cat['doc.continued']].filter(Boolean);
  for (const fmt of [LANG_INFO[lang].a4Format, 'us-letter']){
    const m = await measure(fmt, words, notes);
    const tight = heads.filter(([, w]) => m.tabs[w] > m.gutter - MARGIN);
    ok(`${lang} on ${fmt}: every default heading clears the ${m.gutter}px gutter by ${MARGIN}px`, tight.length === 0,
      tight.map(([id, w]) => `${id} “${w}” ${m.tabs[w].toFixed(1)}px`).join(', '));
    const widest = heads.reduce((a, [, w]) => (m.tabs[w] > a[1] ? [w, m.tabs[w]] : a), ['', 0]);
    console.log(`      widest: “${widest[0]}” ${widest[1].toFixed(1)}px`);
    const longNote = notes.filter(w => m.notes[w] > m.gutter);
    ok(`${lang} on ${fmt}: “${notes[0]}” fits under a continued tab`, longNote.length === 0, longNote.map(w => `${w} ${m.notes[w].toFixed(1)}px`).join(', '));
  }
}

// ---- the app's own labels ----
// Things that are meant to shorten with an ellipsis; everything else has to fit whole.
const ELLIPSIS = '.dn, .dt, .clname, .clt, .tx, .filestate, .sn, .muted, .sopt, .stext, .jn, .lt, .lr, .dp-n, option, .title, .t, .tlsend, .lbl, .where, .kb, .crumb, .sumline, .meta, .field input, .field select, .field textarea';
// the sidebar is 340px wide (316px under 1400px windows); the name card, the rail and the name window are checked in every language by head-check.mjs
const widths = [[1200, 750, '1200×750'], [1470, 832, '1470×832'], [1920, 1080, '1920×1080']];
for (const lang of I.UI_LANGS){
  for (const [vw, vh, what] of widths){
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, bypassCSP: true });
    await ctx.addInitScript(l => { try { localStorage.setItem('rb-ui', JSON.stringify({ mode: 'fixed', lang: l })); localStorage.setItem('rb-help-seen', '1'); } catch { /* none */ } }, lang);
    const pg = await ctx.newPage();
    await pg.goto(`http://localhost:${PORT}/index.html?memory#resume`, { waitUntil: 'networkidle' });
    await pg.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
    await pg.waitForTimeout(600);
    await pg.waitForTimeout(300);
    const probe = (name, sel) => pg.evaluate(([name, sel, ELL]) => {
      const col = document.querySelector('#col').getBoundingClientRect();
      const bad = [];
      for (const el of document.querySelectorAll(sel)){
        if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.right > col.right + 1.5 && !el.closest('#switcher, #help')) bad.push(`${el.tagName}.${el.className || el.id} runs ${(r.right - col.right).toFixed(0)}px out of the panel: “${(el.textContent || '').trim().slice(0, 30)}”`);
        if (!el.matches(ELL) && !el.matches('.sr') && !el.closest(ELL) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') bad.push(`${el.tagName}.${el.className || el.id} is cut: “${(el.textContent || '').trim().slice(0, 30)}” ${el.scrollWidth}>${el.clientWidth}`);
      }
      return bad;
    }, [name, sel, ELLIPSIS]);
    let problems = [];
    problems.push(...await probe('head', '#head button, #head .hrow, #ptabs .ptab, #ptabs .ptab span'));
    problems.push(...await probe('foot', '#foot button, #foot .hfill, #foot .meters'));
    problems.push(...await probe('zoom bar', '#zoombar button, #zoombar .vbar, #zoombar .meters'));
    problems.push(...await probe('outline', '#outline .srow *, #outline .clcaret, #outline .clcount, #outline .archmore, #outline .addline, .lens button, .lens select, .lensrow, .tailor button, .tailorchip'));
    // Record, Export's Mark as sent, and the job level
    await pg.keyboard.press('r'); await pg.waitForTimeout(700);
    problems.push(...await probe('record', '#checklist .clhead *, #checklist .clcount, #checklist .clcaret, #checklist .nlink, #checklist .rectl .kw, #checklist .addline'));
    await pg.keyboard.press('e'); await pg.waitForTimeout(500);      // E: Career is a place of its own, and Esc stays in it: back to the editor
    await pg.click('#tab-export'); await pg.waitForTimeout(400);
    problems.push(...await probe('export', '.sentrow *, .filerow *, .sentrule, .dl button'));
    await pg.click('[data-act=mark-sent]'); await pg.waitForTimeout(400);
    problems.push(...await probe('mark as sent', '#body .btns button, #body .field *, #body .note'));
    await pg.click('#tab-design'); await pg.waitForTimeout(400);
    problems.push(...await probe('design', '#body .seg button, #body .tpl, #body .drow .item, #body .drow .btns button, #body .drow .note, #body .photo-ctl .btns button, #body .photo-ctl .note'));
    await pg.click('#tab-edit'); await pg.waitForTimeout(300);
    await pg.evaluate(() => { window.__wb.ui.sel = { kind: 'job', id: 'hydra' }; window.__wb.setView(null); }); await pg.waitForTimeout(500);
    problems.push(...await probe('the job level', '#body .allrec button, #body .depth, #body .depth > *, #body .depth .dp-w, #body .ctlrow *'));
    // the row at the top of the editor card (the chip's component): Page › Job › Line fits its row, the names give way, the level words never do
    await pg.evaluate(() => { const w = window.__wb, j = w.store.state.record.work[0]; w.ui.sel = { kind: 'bullet', id: j.highlights[0], job: j.id, section: 'experience' }; w.setView(null); }); await pg.waitForTimeout(500);
    problems.push(...await probe('the line level', '#body .depth, #body .depth > *, #body .depth .dp-w'));
    problems.push(...await pg.evaluate(() => { const d = document.querySelector('#body .depth'), c = document.querySelector('#body').getBoundingClientRect(); if (!d) return ['the line level: no depth row']; const r = d.getBoundingClientRect(); return [...d.querySelectorAll('.dp-w')].filter(w => w.scrollWidth > w.clientWidth + 1 || w.getBoundingClientRect().right > r.right + 0.5).map(w => `the line level: the level word “${w.textContent}” is clipped`).concat(r.right > c.right + 0.5 ? ['the line level: the depth row runs out of the card'] : []); }));
    await pg.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); });
    // the Resumes screen: its heading, the views, the ticks and each card's buttons are whole
    await pg.click('#docname-btn'); await pg.waitForTimeout(250);
    await pg.click('#switcher [data-act=sw-manage]'); await pg.waitForTimeout(350);
    problems.push(...await pg.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('#resumes .scrhead button, #resumes .scrhead h2:not(.sr), #resumes .scrhead span, #resumes .racts button')){
        if (el.scrollWidth > el.clientWidth + 1) out.push(`resumes: ${el.className || el.textContent} is cut`);
      }
      return out;
    }));
    await pg.keyboard.press('e'); await pg.waitForTimeout(250);      // E: back to the editor (Esc stays in the Library)
    // the zoom bar over the page, with Actual size, and the page and sidebar settings, which live in Settings
    await pg.mouse.move(300, 400); await pg.waitForTimeout(300);
    await pg.evaluate(() => window.__wb.setView('settings')); await pg.waitForTimeout(400);
    problems.push(...await pg.evaluate(() => { const z = document.querySelector('[data-mode=settings]'); const out = []; if (!z) return ['settings: not open']; for (const b of z.querySelectorAll('.seg button, .dial .dl, .swl span')) if (b.scrollWidth > b.clientWidth + 1) out.push(`settings: “${b.textContent.trim()}” is cut`); if (document.querySelector('#body').scrollWidth > document.querySelector('#body').clientWidth + 1) out.push('settings: wider than the panel'); return out; }));
    await pg.evaluate(() => window.__wb.setView(null));
    ok(`${lang} at ${what}: the new labels fit (name card, foot, zoom bar, Outline, Record, Export, Design, the job level, Resumes, the settings)`, problems.length === 0, [...new Set(problems)].slice(0, 4).join(' ; '));
    await ctx.close();
  }
}

// the start screen's labels, in every language
for (const lang of I.UI_LANGS){
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true });
  await ctx.addInitScript(l => { try { localStorage.setItem('rb-ui', JSON.stringify({ mode: 'fixed', lang: l })); localStorage.setItem('rb-help-seen', '1'); } catch { /* none */ } }, lang);
  const pg = await ctx.newPage();
  await pg.goto(`http://localhost:${PORT}/index.html?memory&welcome`, { waitUntil: 'networkidle' });
  await pg.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 20000 });
  await pg.waitForTimeout(500);
  const bad = await pg.evaluate(() => {
    const out = [];
    // UX-3: the start screen's own labels fit where they are drawn
    for (const el of document.querySelectorAll('.obchoices .obb > span, .oblang, .obhero, .obsub, .obeye, .obkhead h3, .obwhy, .obkb span, .ncur, .nmenu button, .num, .nlabel, .cap, .mrow .t, .obreplay')){
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline') out.push(`“${el.textContent.trim().slice(0, 30)}” is cut`);
    }
    const col = document.querySelector('#col');
    if (col.scrollWidth > col.clientWidth + 1) out.push('the column is wider than it is');
    if (document.documentElement.scrollWidth > innerWidth) out.push('the page scrolls sideways');
    return out;
  });
  ok(`${lang} on the start screen: its labels fit`, bad.length === 0, bad.join(' ; '));
  await ctx.close();
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} label-fit check(s) FAILED` : '\nall label-fit checks passed');
process.exit(failed ? 1 : 0);
