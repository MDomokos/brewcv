#!/usr/bin/env node
// node checks/shell-check.mjs
// The parts of the shell that need no browser: layout (src/ui/layout.js), clicks and Esc (src/ui/select.js),
// a new resume, a linked folder read back. The shell itself runs in checks/smoke-shell.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import { computeLayout, SLIM_MIN, SLIM_MAX, G, sideWidth, RAIL_W, PHONE_MAX, ZOOM_MIN, ZOOM_MAX, clampZoom, actualScale, CARD_MM, NOMINAL_PX_PER_MM, pageInView, pageTop, stackHeight, PAGE_GAP, pageSize } from '../src/ui/layout.js';
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

section('layout: the page and the sidebar');
const SIZES = [[1200, 750], [1280, 720], [1470, 832], [1920, 1080], [2560, 1440]];
const lay = (vw, vh, o = {}) => computeLayout({ vw, vh, format: 'a4', ...o });
for (const [vw, vh] of SIZES){
  const L = lay(vw, vh);
  const tag = `${vw}×${vh}`;
  const SIDE_W = sideWidth(vw);
  ok(`${tag}: the sidebar is one skinny column of ${SIDE_W}px (340, 316 under 1400px windows), ${G}px from the right, the top and the bottom`, SIDE_W === (vw < 1400 ? 316 : 340) && L.col.width === SIDE_W && L.col.left + L.col.width === vw - G && L.col.top === G && L.col.height === vh - 2 * G);
  ok(`${tag}: the page is centred in the room left of the rail and the sidebar (the rail is ${RAIL_W}px more), and is not under them`, L.railW === RAIL_W && Math.abs(L.sheet.left + L.sheet.width / 2 - (L.col.left - RAIL_W - G) / 2) < 1e-6 && L.sheet.left + L.sheet.width <= L.col.left - RAIL_W - G + 1e-6 && L.sheet.left >= G / 2);
  ok(`${tag}: the page and the view are the same in every state: the layout takes no selection and no sheet`, JSON.stringify(L) === JSON.stringify(lay(vw, vh, { wide: false, slim: false })) && L.view.mid === (L.col.left - RAIL_W - G) / 2);
  ok(`${tag}: no tabs, no fold, no second sheet`, L.tabs === undefined && L.folded === undefined && L.two === undefined && L.twoSheets === undefined);
  ok(`${tag}: the sidebar and its rail are under a third of the window (${(100 * (SIDE_W + RAIL_W) / vw).toFixed(0)}%)`, L.col.width + RAIL_W < vw / 3 + 1e-9 || vw < 1200);
}
{
  const a = lay(1470, 832);
  ok('1470×832, A4: the page runs the full height, 16px from top and bottom', a.fullHeight && Math.abs(a.sheet.top - G) < 1e-6 && Math.abs(a.sheet.height - (832 - 2 * G)) < 1e-6);
  const narrow = lay(1100, 1000);
  ok('under about 1100px the page shrinks so the sidebar keeps its width', narrow.col.width === sideWidth(1100) && !narrow.fullHeight && narrow.sheet.width < lay(1400, 1000).sheet.width && narrow.col.left + narrow.col.width <= 1100 - G + 1e-6);
  ok('very wide: the sidebar does not grow', lay(2560, 1440).col.width === 340);
}
section('layout: pages always side by side');
{
  const n2 = (vw, vh, o = {}) => lay(vw, vh, { pages: 2, ...o });
  const wide = n2(3200, 1080), tall = n2(1280, 800), mid = n2(1920, 1080);
  ok('two A4 pages at 3200×1080 sit side by side, the room left of the sidebar wide enough for both at the full height', wide.spread && wide.sheet.width > lay(3200, 1080).sheet.width);
  ok('…at 1920×1080 they do not fit and are not shrunk to: the view scrolls', !mid.spread && mid.fullHeight);
  ok('…at 1280×800 the row is wider than the room: the pages stay at the full height of one page and the view scrolls sideways (no spread, no stack, no shrinking)',
    !tall.spread && !tall.stack && Math.abs(tall.scale - lay(1280, 800).scale) < 1e-9 && tall.fullHeight && tall.pages.contentW <= tall.areaW + 1e-6);
  ok('there is no stack heuristic or mode left', tall.canSpread === undefined && tall.perView === undefined && n2(1280, 800, { mode: 'spread' }).spread === false);
  ok('a spread group is centred like a single page: in the room left of the sidebar', Math.abs(wide.sheet.left + wide.sheet.width / 2 - wide.view.mid) < 1e-6 && wide.col.left + wide.col.width <= 3200 - G + 1e-6);
  ok('the page area has the width of everything left of the sidebar, so a wider row can float under it', tall.view.width === tall.areaW && tall.areaW === tall.col.left - RAIL_W - G);
  ok('the page does not move with the number of pages while the row does not fit', n2(1280, 800).sheet.left === lay(1280, 800).sheet.left && n2(1280, 800, { pages: 3 }).sheet.left === lay(1280, 800).sheet.left);
  for (const [format, n] of [['a4', 2], ['us-letter', 3]]){
    const L = computeLayout({ vw: 390, vh: 844, format, pages: n });
    const { h } = pageSize(format);
    const tag = `phone ${format} ×${n}`;
    ok(`${tag}: the sheet is n pages tall plus the gaps, scaled`, Math.abs(L.sheet.height - stackHeight(format, n) * L.scale) < 1e-6 && Math.abs(stackHeight(format, n) - (n * h + (n - 1) * PAGE_GAP)) < 1e-9);
  }
}
{
  ok('zoom is kept between its limits, and a bad number means 1', clampZoom(0) === ZOOM_MIN && clampZoom(99) === ZOOM_MAX && clampZoom(NaN) === 1 && clampZoom(1.5) === 1.5);
  const z = lay(1470, 832, { zoom: 2 }), one = lay(1470, 832);
  ok('zoom 2 doubles the sheet, not the sidebar', Math.abs(z.scale - 2 * one.scale) < 1e-9 && z.col.left === one.col.left && !z.fullHeight);
}
section('layout: the start screen keeps its slim column');
for (const [vw, vh] of [[1536, 864], [1440, 900], [1100, 760]]){
  const L = lay(vw, vh, { slim: true });
  ok(`${vw}×${vh}: one column of ${L.col.width}px (380 to 480) and no rail, ${G}px from the right and the top; the page centred in the room left of it`, L.railW === 0 && L.col.width >= SLIM_MIN && L.col.width <= SLIM_MAX && Math.abs(vw - L.col.left - L.col.width - G) < 1e-6 && Math.abs(L.sheet.left - (L.col.left - G - L.sheet.left - L.sheet.width)) < 1e-6);
}
section('layout: a phone');
{
  ok('the phone stacks the pages (decision 6)', computeLayout({ vw: 390, vh: 844, format: 'a4', pages: 2 }).stack);
  const ph = computeLayout({ vw: 390, vh: 844, format: 'a4' });
  ok('the phone: the column is the bottom sheet', ph.phone && ph.col.width === 390 && ph.col.top + ph.col.height === 844);
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
