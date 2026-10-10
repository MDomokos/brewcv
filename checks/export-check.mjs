#!/usr/bin/env node
// node checks/export-check.mjs
// src/export.js in Node: the self-contained HTML page, the JSON Resume and plain-text exports, and pre-flight.
// The browser half (it opens offline, prints the same pages) is in checks/smoke-shell.mjs. Fictional data only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as X from '../src/export.js';
import * as S from '../src/model/schema.js';
import * as T from '../src/model/resume.js';
import { createDocument } from '../scripts/lib/dom.mjs';
import { renderPages } from '../src/render.js';
import { findBrowser } from '../scripts/export-pdf.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const raw = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const read = f => JSON.parse(raw(f));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);

const model = S.load(read('data/example.json')).model;
const names = read('data/example-resumes/index.json');
const resumes = names.map(n => S.loadResume(read(`data/example-resumes/${n}`), model).recipe);
const r = resumes[0];

section('the HTML page');
{
  const tpl = raw(`templates/${r.format}.html`);
  const hrefs = [...tpl.matchAll(/rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
  ok('the template names its stylesheets', hrefs.length === 2);
  const css = hrefs.map(href => {
    const p = X.normalisePath(`templates/${href}`);
    let t = raw(p);
    const map = new Map(X.cssUrls(t, p).map(u => [u.match, 'data:font/' + 'woff2;base64,AAAA']));
    return { href, text: X.replaceUrls(t, map) };
  });
  ok('font urls resolve against their stylesheet', X.cssUrls(raw('themes/b2-marker.css'), 'themes/b2-marker.css').every(u => u.url.startsWith('fonts/') && fs.existsSync(path.join(REPO, u.url))));
  const pages = renderPages(model, r, createDocument(), { annotate: true }).pages.map(p => p.outerHTML).join('\n');
  const html = X.assembleHtml({ templateHtml: tpl, css, documentHtml: X.cleanMarkup(pages), title: 'Dana Okonkwo — Example', lang: 'en', rootVars: { '--doc-accent': '#7fd1ae', 'bad name': 'x', '--x': 'url(evil)' } });
  ok('no <link>, no <script>, no comments', !/<link\b/i.test(html) && !/<script/i.test(html) && !/<!--/.test(html));
  ok('every stylesheet inlined, fonts as data: URLs', (html.match(/<style>/g) ?? []).length >= 2 && !/url\("?\.\.\/fonts/.test(html) && /data:font\/woff2/.test(html));
  ok('the pages are in .document', /<div class="document">\s*<article class="page">/.test(html));
  ok('no app attributes', !/data-variant|data-section|rb-/.test(html));
  ok('its title and language', /<title>Dana Okonkwo — Example<\/title>/.test(html) && /<html lang="en">/.test(html));
  ok('the accent is set in :root, and nothing unsafe gets through', /:root \{ --doc-accent: #7fd1ae; \}/.test(html) && !/evil/.test(html) && !/bad name/.test(html));
  ok('@page is kept, so it prints at its size', /@page\s*\{\s*size:\s*letter/.test(html));
  ok('cleanMarkup keeps the classes that are the resume’s', X.cleanMarkup('<li class="rb-sel x" data-variant="a">t</li>') === '<li class="x">t</li>');
  ok('paths normalise', X.normalisePath('templates/../formats/a4.css') === 'formats/a4.css' && X.normalisePath('formats/../fonts/x.woff2') === 'fonts/x.woff2');
}

section('JSON Resume and plain text');
{
  const { file } = X.jsonResumeFile(model, r, { now: '2026-10-06' });
  ok('the JSON Resume export is valid', S.checkJsonResume(file).length === 0 && file.meta.lastModified === '2026-10-06');
  ok('and is the resume as printed', JSON.stringify(file.work) === JSON.stringify(T.resolve(model, r).body.work));
  const txt = X.plainText(file);
  ok('plain text: name first, then contact', txt.startsWith(`${model.basics.name}\n`) && txt.split('\n')[2].includes(model.basics.email));
  ok('every bullet is a line, in order', file.work.flatMap(w => w.highlights).every(h => txt.includes(`- ${h}`)));
  ok('section headings in capitals', /\nEXPERIENCE\n-+\n/.test(txt) && /\nSKILLS\n/.test(txt));
  const hu = resumes.find(x => x.lang === 'hu');
  const I = await import('../src/i18n/index.js');
  await I.loadCatalogue('hu');
  ok('a Hungarian resume gets Hungarian headings, from the catalogue', /SZAKMAI TAPASZTALAT/.test(X.plainText(X.jsonResumeFile(model, hu).file, { lang: 'hu', chrome: I.docChrome('hu') })));
  for (const l of I.UI_LANGS.filter(x => x !== 'en')){
    await I.loadCatalogue(l);
    const txt = X.plainText(X.jsonResumeFile(model, { ...hu, lang: l }).file, { lang: l, chrome: I.docChrome(l) });
    const want = I.tIn(l, 'doc.plain.work').toUpperCase();
    if (!txt.includes(want)) ok(`plain-text headings in ${l}`, false, want);
  }
  ok('plain-text headings in all nine other languages', true);
  ok('without the catalogue the headings stay English (the CLI)', /EXPERIENCE/.test(X.plainText(X.jsonResumeFile(model, hu).file, { lang: 'hu' })));
  ok('one column: no line starts with a tab or runs two columns', !txt.split('\n').some(l => /^\t|\t/.test(l)));
}

section('pre-flight');
{
  const fit = [{ page: 1, used: 900, usable: 1000, overflow: 0 }];
  const clean = X.preflight({ model, recipe: r, fills: fit });
  ok('a clean resume: nothing to fix', clean.every(c => c.level === 'ok'), JSON.stringify(clean));
  const over = X.preflight({ model, recipe: r, fills: [{ page: 1, used: 1100, usable: 1000, overflow: 100 }] });
  ok('overflow is a problem', over.some(c => c.key === 'overflow' && c.level === 'bad'));
  const m2 = structuredClone(model); m2.basics.phone = '';
  ok('an empty contact field is named', X.preflight({ model: m2, recipe: r, fills: fit }).some(c => c.key === 'contact' && /phone/.test(c.text)));
  ok('texts printing in English on a Hungarian resume', X.preflight({ model, recipe: { ...r, lang: 'hu' }, fills: fit, missing: 3 }).some(c => c.key === 'language' && /3 texts print in English/.test(c.text)));
  ok('newer wording not reviewed', X.preflight({ model, recipe: r, fills: fit, newer: 2 }).some(c => c.key === 'newer'));
  ok('a photo on Letter', X.preflight({ model, recipe: { ...r, format: 'us-letter', photo: { show: true, shape: 'rect' } }, fills: fit }).some(c => c.key === 'photo'));
  ok('a photo switched on with no photo is a problem', X.preflight({ model, recipe: { ...r, photo: { show: true, shape: 'rect' } }, fills: fit }).some(c => c.key === 'photo-missing' && c.level === 'bad'));
  ok('unsaved changes', X.preflight({ model, recipe: r, fills: fit, dirty: true }).some(c => c.key === 'dirty'));
  ok('a file name from company, role and name', X.exportName(r, model, 'pdf') === `${r.company} - ${r.role} - ${model.basics.name}.pdf`);
}

section('finding a browser for the PDF script');
{
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const has = (...found) => p => found.includes(p);
  const none = () => null;
  ok('CHROME_PATH wins over everything', findBrowser({ CHROME_PATH: '/x/chrome' }, has('/x/chrome', mac), none) === '/x/chrome');
  ok('a CHROME_PATH that does not exist is skipped', findBrowser({ CHROME_PATH: '/x/chrome' }, has(mac), none) === mac);
  ok('Chrome before Brave on macOS', findBrowser({}, has(mac, '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'), none) === mac);
  ok('Edge is found', findBrowser({}, has('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'), none).includes('Microsoft Edge'));
  ok('a Linux location is found', findBrowser({}, has('/usr/bin/chromium'), none) === '/usr/bin/chromium');
  ok('then PATH', findBrowser({}, () => false, n => n === 'chromium' ? '/opt/bin/chromium' : null) === '/opt/bin/chromium');
  ok('none found: null, so the script can name CHROME_PATH', findBrowser({}, () => false, none) === null);
}

console.log(failed ? `\n${failed} export check(s) FAILED` : '\nall export checks passed');
process.exit(failed ? 1 : 0);
