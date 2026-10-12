#!/usr/bin/env node
// node checks/label-fit.mjs
// Every default heading (doc.section.*) and its "continued" note fits the gutter of its language's A4
// format and of Letter, measured in Chromium with the real theme, clearing it by at least 3px (the
// margin a4-hu.css sets). Then the app's own labels in each of the ten languages, at the narrowest panel
// (340px, in the drawer) and a wide one: the three modes on one row, the header, the checklist, the lens, the
// zoom bar, the grown switcher and the zoom settings all fit what they are in. Writes only to out/. Needs
// playwright and a Chromium.

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
await new Promise(r => server.listen(8133, r));
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 }, bypassCSP: true });

const measure = async (fmt, words, notes) => {
  await page.goto(`http://localhost:8133/out/label-fit-${fmt}.html`, { waitUntil: 'networkidle' });
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
const ELLIPSIS = '.dn, .dt, .clname, .clt, .tx, .filestate, .sn, .muted, .sopt, .stext, .jn, .lt, .lr, option, .title, .t, .tlsend, .lbl, .where, .kb, .crumb, .sumline, .meta, .field input, .field select, .field textarea';
const widths = [[1100, 'drawer, 340px'], [1440, '403px']];
for (const lang of I.UI_LANGS){
  for (const [vw, what] of widths){
    const ctx = await browser.newContext({ viewport: { width: vw, height: 900 }, bypassCSP: true });
    await ctx.addInitScript(l => { try { localStorage.setItem('rb-ui', JSON.stringify({ mode: 'fixed', lang: l })); localStorage.setItem('rb-panel', 'open'); localStorage.setItem('rb-help-seen', '1'); } catch { /* none */ } }, lang);
    const pg = await ctx.newPage();
    await pg.goto('http://localhost:8133/index.html?memory', { waitUntil: 'networkidle' });
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
        if (r.right > col.right + 1.5 && !el.closest('#switcher, #zpop, #help')) bad.push(`${el.tagName}.${el.className || el.id} runs ${(r.right - col.right).toFixed(0)}px out of the panel: “${(el.textContent || '').trim().slice(0, 30)}”`);
        if (!el.matches(ELL) && !el.closest(ELL) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') bad.push(`${el.tagName}.${el.className || el.id} is cut: “${(el.textContent || '').trim().slice(0, 30)}” ${el.scrollWidth}>${el.clientWidth}`);
      }
      return bad;
    }, [name, sel, ELLIPSIS]);
    const rows = await pg.evaluate(() => { const t = [...document.querySelectorAll('#head [role=tab]')].map(x => Math.round(x.getBoundingClientRect().top)); return { tabsOnOneRow: new Set(t).size === 1, tabs: t.length, headRows: [...document.querySelectorAll('#head .hrow')].map(r => Math.round(r.getBoundingClientRect().height)) }; });
    let problems = [];
    if (!rows.tabsOnOneRow) problems.push('the three modes wrap onto more than one row');
    problems.push(...await probe('head', '#head button, #head .seg, #head .hrow, #head .docname, #head .savestate'));
    problems.push(...await probe('foot', '#foot button, #foot .vbar, #foot .meters, #foot .frow'));
    problems.push(...await probe('lens and sections', '.lens button, .lens select, .lensrow, .offchip, #seclist .srow, .item.srow'));
    problems.push(...await probe('checklist', '#checklist button, #checklist .clhead, #checklist .clcount, #checklist .clcaret, #checklist .clhint'));
    // the heads of the groups, opened: the count stays whole next to a long name
    await pg.click('#checklist .clg[data-g=hydra] .clcaret').catch(() => {});
    problems.push(...await probe('checklist, opened', '#checklist .clg.open button, #checklist .clrow, #checklist .addclaim'));
    // the grown switcher
    await pg.click('#docname-btn'); await pg.waitForTimeout(250);
    await pg.click('#switcher [data-act=sw-manage]'); await pg.waitForTimeout(350);
    problems.push(...await pg.evaluate(ELL => {
      const out = [];
      const sw = document.querySelector('#switcher');
      for (const el of sw.querySelectorAll('[role=tab], .swhead2 button, .swfoot button, .swfoot span')){
        if (el.scrollWidth > el.clientWidth + 1) out.push(`switcher: ${el.className || el.textContent} is cut`);
      }
      const tabs = [...sw.querySelectorAll('[role=tab]')].map(x => Math.round(x.getBoundingClientRect().top));
      if (new Set(tabs).size !== 1) out.push('switcher: the three views wrap');
      return out;
    }, ELLIPSIS));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
    // the zoom settings
    await pg.click('#zoompct'); await pg.waitForTimeout(250);
    problems.push(...await pg.evaluate(() => { const z = document.querySelector('#zpop'); const out = []; if (z.scrollWidth > z.clientWidth + 1) out.push('zoom settings: wider than the card'); for (const b of z.querySelectorAll('.seg button')) if (b.scrollWidth > b.clientWidth + 1) out.push(`zoom settings: “${b.textContent}” is cut`); const seg = z.querySelector('.seg').getBoundingClientRect(); if (seg.right > z.getBoundingClientRect().right - 4) out.push('zoom settings: the panel modes run out of the card'); return out; }));
    await pg.keyboard.press('Escape');
    ok(`${lang} at ${what}: the new labels fit (modes on one row, header, zoom bar, lens, checklist, switcher, zoom settings)`, problems.length === 0, [...new Set(problems)].slice(0, 4).join(' ; '));
    await ctx.close();
  }
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} label-fit check(s) FAILED` : '\nall label-fit checks passed');
process.exit(failed ? 1 : 0);
