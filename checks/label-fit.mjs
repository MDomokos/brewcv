#!/usr/bin/env node
// node checks/label-fit.mjs
// Every default heading (doc.section.*) and its "continued" note fits the gutter of its language's A4
// format and of Letter, measured in Chromium with the real theme, clearing it by at least 3px (the
// margin a4-hu.css sets). Writes only to out/. Needs playwright and a Chromium.

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

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript' };
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

await browser.close(); server.close();
console.log(failed ? `\n${failed} label-fit check(s) FAILED` : '\nall label-fit checks passed');
process.exit(failed ? 1 : 0);
