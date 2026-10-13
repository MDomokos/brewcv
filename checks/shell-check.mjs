#!/usr/bin/env node
// node checks/shell-check.mjs
// The parts of the shell that need no browser: layout (src/ui/layout.js), clicks and Esc (src/ui/select.js),
// a new resume, a linked folder read back. The shell itself runs in checks/smoke-shell.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import { computeLayout, SLIM_MIN, SLIM_MAX, G, TAB_GAP, TABS_W, PANEL_MIN, PANEL_ONE, PANEL_TWO, TWO_FROM, FOLD_INSET, PHONE_MAX, ZOOM_MIN, ZOOM_MAX, clampZoom, actualScale, CARD_MM, NOMINAL_PX_PER_MM, pageInView, pageTop, stackHeight, PAGE_GAP, pageSize } from '../src/ui/layout.js';
import { indexModel, targetOf, up, step, versionsOf, factsOf, NONE } from '../src/ui/select.js';
import { ZOOM_WRITE } from '../src/ui/dock.js';
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

section('layout: the page and the panel float together');
// the five tabs; Edit alone can show two sheets
const TABS = { outline: false, edit: true, design: false, export: false, record: false };
const SIZES = [[1200, 750], [1280, 720], [1470, 832], [1920, 1080], [2560, 1440]];
const lay = (vw, vh, o = {}) => computeLayout({ vw, vh, format: 'a4', ...o });
for (const [vw, vh] of SIZES){
  const one = lay(vw, vh), two = lay(vw, vh, { two: true });
  const widest = Math.max(one.col.width, two.col.width);
  const tag = `${vw}×${vh}`;
  ok(`${tag}: the panel is ${PANEL_MIN} to ${PANEL_ONE} px with one sheet (${one.col.width.toFixed(0)})`, one.col.width >= PANEL_MIN && one.col.width <= PANEL_ONE);
  ok(`${tag}: the group is page, ${TAB_GAP}px, the tabs (${TABS_W}px), the panel, in the window`, Math.abs(one.tabs.left - (one.sheet.left + one.sheet.width + TAB_GAP)) < 1e-6 && Math.abs(one.col.left - (one.tabs.left + TABS_W)) < 1e-6 && widest + one.col.left <= vw - G + 1e-6 && one.sheet.left >= G / 2);
  ok(`${tag}: the group is centred on the panel's widest state (${widest.toFixed(0)}px)`, Math.abs(one.sheet.left - (vw - (one.col.left + widest))) < 1e-6 || one.sheet.left === G / 2);
  ok(`${tag}: two sheets only with ${TWO_FROM}px beside the page, up to ${PANEL_TWO}px`, two.twoSheets === (vw - 2 * G - TABS_W - TAB_GAP - one.sheet.width >= TWO_FROM) && (two.twoSheets ? two.col.width > one.col.width && two.col.width <= PANEL_TWO : two.col.width === one.col.width));
  ok(`${tag}: the panel is ${G}px from the top and the bottom; the tabs run alongside`, one.col.top === G && one.col.height === vh - 2 * G && one.tabs.top === G && one.tabs.height === vh - 2 * G);
  for (const [tab, wantTwo] of Object.entries(TABS)){
    const L = lay(vw, vh, { two: wantTwo });
    if (JSON.stringify(L.sheet) !== JSON.stringify(one.sheet) || L.tabs.left !== one.tabs.left || L.col.left !== one.col.left || L.view.mid !== one.view.mid){ ok(`${tag}: the ${tab} tab leaves the page, the tabs and the panel's left edge where they were`, false); break; }
  }
  ok(`${tag}: …whichever of the five tabs is open, the page's x and the tabs do not move`, true);
}
{
  const a = lay(1470, 832);
  ok('1470×832, A4: the page runs the full height, 16px from top and bottom', a.fullHeight && Math.abs(a.sheet.top - G) < 1e-6 && Math.abs(a.sheet.height - (832 - 2 * G)) < 1e-6);
  const narrow = lay(1100, 1000);
  ok('under about 1100px the page shrinks so the panel keeps 560px', narrow.col.width === PANEL_MIN && !narrow.fullHeight && narrow.sheet.width < lay(1400, 1000).sheet.width && narrow.col.left + narrow.col.width <= 1100 - G + 1e-6);
  ok('1920×1080 with one page has room for two sheets, 1470×832 does not', lay(1920, 1080).twoSheets && !lay(1470, 832).twoSheets && !lay(1280, 720).twoSheets);
  ok('a tab that is not Edit never has two sheets', lay(1920, 1080, { two: false }).col.width <= PANEL_ONE && lay(1920, 1080, { two: true }).col.width > PANEL_ONE);
  const wide = lay(2560, 1440);
  ok('very wide: the panel stops at 1080px with two sheets, 760px with one', wide.col.width === PANEL_ONE && lay(2560, 1440, { two: true }).col.width === PANEL_TWO);
  ok('the page is the same size in every panel state', lay(1920, 1080).scale === lay(1920, 1080, { two: true }).scale);
}
section('layout: pages side by side or one at a time');
{
  const n2 = (vw, vh, o = {}) => lay(vw, vh, { pages: 2, ...o });
  const wide = n2(2560, 1440), tall = n2(1280, 800), mid = n2(1920, 1080);
  ok('two A4 pages at 2560×1440 sit side by side (costs under 15% with the panel at its minimum)', wide.spread && wide.perView === 2 && wide.sheet.width > lay(2560, 1440).sheet.width);
  ok('…at 1280×800 and at 1920×1080 they would cost more, so they travel one at a time (stack)', !tall.spread && tall.stack && tall.perView === 1 && !mid.spread && mid.stack);
  ok('the spread is counted with the panel at its minimum, so opening a wider sheet changes nothing', JSON.stringify(n2(2560, 1440, { two: true }).sheet) === JSON.stringify(wide.sheet));
  ok('mode "spread" forces a spread, "stack" a stack, an old "single" means "stack"', n2(1280, 800, { mode: 'spread' }).spread && n2(2560, 1440, { mode: 'stack' }).stack && n2(2560, 1440, { mode: 'single' }).stack);
  ok('a spread group is centred like a single page: the tabs follow the two pages', Math.abs(wide.tabs.left - (wide.sheet.left + wide.sheet.width + TAB_GAP)) < 1e-6 && wide.col.left + wide.col.width <= 2560 - G + 1e-6);
  for (const [vw, vh, format, n] of [[1280, 800, 'a4', 2], [1536, 864, 'a4', 3], [1440, 960, 'us-letter', 2]]){
    const L = computeLayout({ vw, vh, format, pages: n, mode: 'stack' });
    const one = computeLayout({ vw, vh, format, pages: 1 });
    const { h } = pageSize(format);
    const tag = `stack ${vw}×${vh} ${format} ×${n}`;
    ok(`${tag}: each page at the one-page scale (full height)`, Math.abs(L.scale - one.scale) < 1e-9 && L.fullHeight);
    ok(`  the sheet is n pages tall plus the gaps, scaled`, Math.abs(L.sheet.height - stackHeight(format, n) * L.scale) < 1e-6 && Math.abs(stackHeight(format, n) - (n * h + (n - 1) * PAGE_GAP)) < 1e-9);
    ok(`  the panel and the tabs don't move`, Math.abs(L.col.left - one.col.left) < 1e-9 && L.col.width === one.col.width && L.tabs.left === one.tabs.left);
    ok(`  page in view: 1 at the top, then each page as it reaches the middle`, pageInView(L, 0, n) === 0 && pageInView(L, pageTop(L, 1), n) === 1 && pageInView(L, pageTop(L, n - 1) + 9999, n) === n - 1);
  }
}
section('layout: folded');
for (const [vw, vh] of SIZES){
  const F = lay(vw, vh, { folded: true }), O = lay(vw, vh);
  const tag = `${vw}×${vh}`;
  ok(`${tag}: folded, the tabs stay at the right edge, ${FOLD_INSET}px in, and keep their height`, F.folded && Math.abs(F.tabs.left - (vw - FOLD_INSET - TABS_W)) < 1e-6 && F.tabs.top === O.tabs.top && F.tabs.height === O.tabs.height && F.tabs.width === TABS_W);
  ok(`${tag}: …and the page is centred in the room left`, Math.abs(F.sheet.left - (F.tabs.left - F.sheet.left - F.sheet.width)) < 1e-6 && F.sheet.width >= O.sheet.width);
  ok(`${tag}: …with no sheet beside them (the panel keeps its place to slide back to)`, F.twoSheets === false && F.col.left >= O.col.left - 1e-6 && F.view.mid === F.tabs.left / 2);
}
{
  ok('zoom is kept between its limits, and a bad number means 1', clampZoom(0) === ZOOM_MIN && clampZoom(99) === ZOOM_MAX && clampZoom(NaN) === 1 && clampZoom(1.5) === 1.5);
  const z = lay(1470, 832, { zoom: 2 }), one = lay(1470, 832);
  ok('zoom 2 doubles the sheet, not the group', Math.abs(z.scale - 2 * one.scale) < 1e-9 && z.tabs.left === one.tabs.left && z.col.left === one.col.left && !z.fullHeight);
}
section('layout: the start screen keeps its slim column');
for (const [vw, vh] of [[1536, 864], [1440, 900], [1100, 760]]){
  const L = lay(vw, vh, { slim: true });
  ok(`${vw}×${vh}: one column of ${L.col.width}px (380 to 480), ${G}px from the right and the top, no tabs; the page centred in the room left of it`, L.col.width >= SLIM_MIN && L.col.width <= SLIM_MAX && Math.abs(vw - L.col.left - L.col.width - G) < 1e-6 && L.tabs.width === 0 && Math.abs(L.sheet.left - (L.col.left - G - L.sheet.left - L.sheet.width)) < 1e-6 && !L.twoSheets);
}
section('layout: a phone');
{
  ok('the phone stacks the pages (decision 6)', computeLayout({ vw: 390, vh: 844, format: 'a4', pages: 2 }).stack);
  const ph = computeLayout({ vw: 390, vh: 844, format: 'a4', folded: true });
  ok('the phone has no tabs or fold: the column is the bottom sheet whatever the fold', ph.phone && !ph.folded && ph.col.width === 390 && ph.col.top + ph.col.height === 844 && ph.tabs.width === 0);
  const rec = computeLayout({ vw: 390, vh: 844, format: 'a4', wide: true });
  ok('on a phone, Record is the whole screen', rec.phone && rec.col.left === 0 && rec.col.top === 0 && rec.col.width === 390 && rec.col.height === 844);
  ok('actual size: calibrated px per mm → scale', Math.abs(actualScale(NOMINAL_PX_PER_MM) - 1) < 1e-12 && Math.abs(actualScale(340 / CARD_MM) - (340 / CARD_MM) / NOMINAL_PX_PER_MM) < 1e-12);
  ok('there is no Career layout or thumbnail any more', computeLayout({ vw: 1536, vh: 864, format: 'a4' }).career === undefined);
  ok('there is no panel mode left: no Auto, no peek, no drawer on a desktop', computeLayout({ vw: 1100, vh: 800, format: 'a4' }).drawer === undefined && ZOOM_WRITE.min === 80 && ZOOM_WRITE.max === 180 && ZOOM_WRITE.def === 130);
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
  ok('Esc: a line in a job is the job level, and one Esc goes to the page; a job likewise', eq(up({ kind: 'bullet', id: 'hydra-inhaler', job: 'hydra' }), NONE) && eq(up({ kind: 'job', id: 'hydra' }), NONE));
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
