#!/usr/bin/env node
// node checks/shell-check.mjs
// The parts of the shell that need no browser: layout (src/ui/layout.js), clicks and Esc (src/ui/select.js),
// a new resume, a linked folder read back. The shell itself runs in checks/smoke-shell.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import { computeLayout, G, COL_MIN, COL_MAX, actualScale, CARD_MM, NOMINAL_PX_PER_MM, pageInView, pageTop, stackHeight, PAGE_GAP, pageSize } from '../src/ui/layout.js';
import { indexModel, targetOf, up, step, versionsOf, factsOf, NONE } from '../src/ui/select.js';
import { load, save, serialize, saveResume } from '../src/model/schema.js';
import { newResume } from '../src/model/resume.js';
import { memoryFolder, readFolder, createPersist, memoryBackend } from '../src/store/persist.js';
import { createStore } from '../src/store/store.js';
import { validate } from './lib/validate.mjs';
import { renderPages } from '../src/render.js';
import { createDocument } from '../scripts/lib/dom.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`);
  if (!cond) failed++;
};
const section = t => console.log(`\n— ${t}`);

section('the source link (AGPL-3.0, section 13)');
{
  const src = fs.readFileSync(path.join(REPO, 'src/ui/shell.js'), 'utf8');
  const urls = [...src.matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/g)].map(m => m[0]);
  ok('the menu links to one SOURCE_URL constant', /^const SOURCE_URL = 'https:\/\/github\.com\/[^']+';$/m.test(src) && src.includes('href="${SOURCE_URL}"') && new Set(urls).size === 1);
  ok('it opens in a new tab without handing over the opener', /href="\$\{SOURCE_URL\}" target="_blank" rel="noopener"/.test(src));
  ok('the menu text goes through t() under src.link', src.includes("h('src.link')"));
  const langs = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu'];
  const have = langs.filter(l => /^  'src\.link': '[^']*AGPL-3\.0[^']*',$/m.test(fs.readFileSync(path.join(REPO, `src/i18n/${l}.js`), 'utf8')));
  ok('all ten catalogues name the licence in src.link', have.length === 10, `missing: ${langs.filter(l => !have.includes(l))}`);
}

section('layout: the pair, centred, the sheet at full height');
for (const [vw, vh] of [[1536, 864], [1440, 960], [1280, 800], [1920, 1080]]){
  for (const format of ['us-letter', 'a4']){
    const L = computeLayout({ vw, vh, format });
    const s = L.sheet, c = L.col;
    ok(`${vw}×${vh} ${format}: full height`, L.fullHeight && Math.abs(s.top - G) < 1e-6 && Math.abs(s.height - (vh - 2 * G)) < 1e-6);
    ok(`${vw}×${vh} ${format}: column ${c.width.toFixed(0)}px within ${COL_MIN}–${COL_MAX}`, c.width >= COL_MIN && c.width <= COL_MAX);
    ok(`${vw}×${vh} ${format}: 16px apart, centred, inside the window`,
      Math.abs(c.left - (s.left + s.width) - G) < 1e-6 && Math.abs(s.left - (vw - c.left - c.width)) < 1e-6 && c.left + c.width <= vw - G + 1e-6);
  }
}
{
  const narrow = computeLayout({ vw: 900, vh: 1000, format: 'a4' });
  ok('too narrow for both: the sheet shrinks, the column keeps its minimum', !narrow.fullHeight && narrow.col.width === COL_MIN && narrow.sheet.left >= G);
  const wide = computeLayout({ vw: 2560, vh: 1440, format: 'a4' });
  ok('very wide: the column stops at its maximum', wide.col.width === COL_MAX);
  const two = computeLayout({ vw: 1536, vh: 864, format: 'a4', pages: 2 });
  ok('two A4 pages at 1536×864 sit side by side (costs under 15% of height)', two.spread && two.perView === 2);
  const tall = computeLayout({ vw: 1280, vh: 800, format: 'a4', pages: 2 });
  ok('…at 1280×800 they would cost more, so they stack and scroll', !tall.spread && tall.stack && tall.perView === 1);
  ok('the ▭▭ toggle forces a spread', computeLayout({ vw: 1280, vh: 800, format: 'a4', pages: 2, mode: 'spread' }).spread);
  ok('and ▯ forces the scrolled stack', computeLayout({ vw: 1536, vh: 864, format: 'a4', pages: 2, mode: 'stack' }).stack);
  ok('"single" from before 0.6.1 means the stack', computeLayout({ vw: 1536, vh: 864, format: 'a4', pages: 2, mode: 'single' }).stack);
  for (const [vw, vh, format, n] of [[1280, 800, 'a4', 2], [1536, 864, 'a4', 3], [1440, 960, 'us-letter', 2]]){
    const L = computeLayout({ vw, vh, format, pages: n, mode: 'stack' });
    const one = computeLayout({ vw, vh, format, pages: 1 });
    const { h } = pageSize(format);
    ok(`stack ${vw}×${vh} ${format} ×${n}: each page at the one-page scale (full height)`, Math.abs(L.scale - one.scale) < 1e-9 && L.fullHeight);
    ok(`  the sheet is n pages tall plus the gaps, scaled`, Math.abs(L.sheet.height - stackHeight(format, n) * L.scale) < 1e-6 && Math.abs(stackHeight(format, n) - (n * h + (n - 1) * PAGE_GAP)) < 1e-9);
    ok(`  the scroller is the window's height and scrolls through all of it`, L.pages.height === vh && Math.abs(L.pages.content - (G + L.sheet.height + G)) < 1e-6);
    ok(`  the column doesn't move`, Math.abs(L.col.left - one.col.left) < 1e-9 && L.col.width === one.col.width);
    ok(`  the scroller stops short of the column`, L.pages.width < L.col.left && L.pages.width > L.sheet.left + L.sheet.width);
    ok(`  page in view: 1 at the top, then each page as it reaches the middle`, pageInView(L, 0, n) === 0 && pageInView(L, pageTop(L, 1), n) === 1 && pageInView(L, pageTop(L, n - 1) + 9999, n) === n - 1);
  }
  ok('the phone stacks the pages too (decision 6)', computeLayout({ vw: 390, vh: 844, format: 'a4', pages: 2 }).stack);
  const C = computeLayout({ vw: 1536, vh: 864, format: 'a4' }).career;
  ok('Career: the thumbnail sits 20px in from the panel’s bottom-right corner', Math.abs(C.thumb.left + C.thumb.width - (C.panel.left + C.panel.width - 20)) < 1e-9 && Math.abs(C.thumb.top + C.thumb.height - (C.panel.top + C.panel.height - 20)) < 1e-9);
  ok('actual size: calibrated px per mm → scale', Math.abs(actualScale(NOMINAL_PX_PER_MM) - 1) < 1e-12 && Math.abs(actualScale(340 / CARD_MM) - (340 / CARD_MM) / NOMINAL_PX_PER_MM) < 1e-12);
}

section('select: a click means');
const { model } = load(read('data/example.json'));
const ix = indexModel(model);
const vid = id => model.facts.find(f => f.id === id).variants[0];
{
  ok('a bullet', eq(targetOf(ix, { variant: vid('hydra-inhaler'), section: 'experience' }), { kind: 'bullet', id: 'hydra-inhaler', job: 'hydra', section: 'experience' }));
  ok('a job title is the job', eq(targetOf(ix, { variant: vid('poly-position'), section: 'experience' }), { kind: 'job', id: 'poly' }));
  ok('its meta line too', eq(targetOf(ix, { variant: vid('poly-meta'), section: 'experience' }), { kind: 'job', id: 'poly' }));
  ok('the summary is a bullet of its own', targetOf(ix, { variant: vid('summary'), section: 'summary' }).kind === 'bullet');
  ok('a "this resume only" text selects its bullet', eq(targetOf(ix, { variant: 'hydra-inhaler-override', section: 'experience' }), { kind: 'bullet', id: 'hydra-inhaler', job: 'hydra', section: 'experience' }));
  ok('the name is the header', eq(targetOf(ix, { variant: vid('name'), section: 'header' }), { kind: 'header' }));
  ok('a skills group is its section', eq(targetOf(ix, { variant: vid('skills-cad'), section: 'skills' }), { kind: 'section', id: 'skills' }));
  ok('a tab (no phrasing) is its section', eq(targetOf(ix, { section: 'patent' }), { kind: 'section', id: 'patent' }));
  ok('empty paper is nothing', eq(targetOf(ix, {}), NONE));
  ok('Esc: bullet → job → nothing', eq(up({ kind: 'bullet', id: 'hydra-inhaler', job: 'hydra' }), { kind: 'job', id: 'hydra' }) && eq(up({ kind: 'job', id: 'hydra' }), NONE));
  ok('Esc from the summary goes straight to nothing', eq(up({ kind: 'bullet', id: 'summary' }), NONE));
  const order = ['summary', 'hydra-inhaler', 'hydra-testing'];
  ok('↓ from nothing is the first bullet, ↑ the last', step(order, NONE, 1) === 'summary' && step(order, NONE, -1) === 'hydra-testing');
  ok('↓ / ↑ step and stop at the ends', step(order, { kind: 'bullet', id: 'summary' }, 1) === 'hydra-inhaler' && step(order, { kind: 'bullet', id: 'summary' }, -1) === 'summary');
  const vs = versionsOf(ix, 'hydra-inhaler', 'en').map(v => v.n);
  ok('versions in number order: v1, v2, v2.1, v2.2, v3', eq(vs, ['1', '2', '2.1', '2.2', '3']), vs.join(' '));
  ok('per language', eq(versionsOf(ix, 'hydra-inhaler', 'hu').map(v => v.n), ['1', '2']));
  ok('a job outlines its title, meta and bullets', factsOf(ix, { kind: 'job', id: 'free' }).length === 2 + ix.work.get('free').highlights.length);
}

section('a new resume');
{
  const r = newResume(model, { format: 'us-letter' });
  ok('validates against the record', validate(model, r).errors.length === 0, validate(model, r).errors[0]);
  ok('has no manual layout, one page', r.pages === undefined && r.pageLimit === 1);
  ok('lists every section after the summary, every job', r.sections.map(s => s.id).join() === model.sections.filter(s => s.kind !== 'header' && s.id !== 'summary').map(s => s.id).join()
    && r.sections.find(s => s.id === 'experience').work.length === model.work.length);
  ok('renders', renderPages(model, r, createDocument()).pages.length === 1);
}

section('a linked folder, read back');
{
  const r = newResume(model);
  const f = memoryFolder({ 'resume-data.json': serialize(save(model)), 'recipes/A - B.json': serialize(saveResume(model, { ...r, company: 'A', role: 'B' }).file),
    'recipes/notes.txt': 'not a resume', 'recipes/sub/x.json': '{}' });
  const got = await readFolder(f);
  ok('the record and its saved resumes come back', got && eq(got.state.record, model) && got.state.resumes.length === 1 && got.state.resumes[0].company === 'A');
  ok('the first one is opened', got.state.cur?.company === 'A');
  ok('an empty folder has nothing to read', (await readFolder(memoryFolder())) === null);

  const v3 = read('checks/fixtures/example-0.4.v3.json');
  const old = memoryFolder({ 'resume-data.json': JSON.stringify(v3), 'recipes/Old.json': JSON.stringify(read('checks/fixtures/example-0.4-recipe.json')) });
  const s = createStore({ record: load(v3).model, resumes: [read('checks/fixtures/example-0.4-recipe.json')], cur: null });
  const p = createPersist({ store: s, backend: memoryBackend() });
  await p.link(old);
  ok('linking over a v3 folder keeps resume-data.v3.json', (await old.read('resume-data.v3.json')) === JSON.stringify(v3));
  ok('and the v3 recipes in recipes-v3/', (await old.read('recipes-v3/Old.json')) !== null);
  ok('then writes v4', JSON.parse(await old.read('resume-data.json')).meta?.resumeBuilder?.schema === 'resume-data/4');
  const again = await old.read('resume-data.v3.json');
  await p.link(old);
  ok('and only the first time', (await old.read('resume-data.v3.json')) === again);
  p.stop();
}

console.log(failed ? `\n${failed} shell check(s) FAILED` : '\nall shell checks passed');
process.exit(failed ? 1 : 0);
