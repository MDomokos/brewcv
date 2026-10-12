#!/usr/bin/env node
// node checks/shell-check.mjs
// The parts of the shell that need no browser: layout (src/ui/layout.js), clicks and Esc (src/ui/select.js),
// a new resume, a linked folder read back. The shell itself runs in checks/smoke-shell.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import { computeLayout, G, COL_MIN, COL_MAX, RAIL_W, DRAWER_MAX, PHONE_MAX, RECORD_MIN, RECORD_MAX, recordWidth, ZOOM_MIN, ZOOM_MAX, clampZoom, panelWidth, actualScale, CARD_MM, NOMINAL_PX_PER_MM, pageInView, pageTop, stackHeight, PAGE_GAP, pageSize } from '../src/ui/layout.js';
import { indexModel, targetOf, up, step, versionsOf, factsOf, NONE } from '../src/ui/select.js';
import { panelShown, afterEscape, PANEL_MODES, ZOOM_WRITE } from '../src/ui/dock.js';
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

section('layout: the page area and the panel, the sheet at full height');
for (const [vw, vh] of [[1536, 864], [1440, 960], [1280, 800], [1920, 1080]]){
  for (const format of ['us-letter', 'a4']){
    const L = computeLayout({ vw, vh, format });
    const s = L.sheet, c = L.col;
    ok(`${vw}×${vh} ${format}: full height`, L.fullHeight && Math.abs(s.top - G) < 1e-6 && Math.abs(s.height - (vh - 2 * G)) < 1e-6);
    ok(`${vw}×${vh} ${format}: panel ${c.width.toFixed(0)}px within ${COL_MIN}–${COL_MAX}, ${G}px from the right and the top`, c.width >= COL_MIN && c.width <= COL_MAX && Math.abs(vw - c.left - c.width - G) < 1e-6 && c.top === G && c.height === vh - 2 * G);
    ok(`${vw}×${vh} ${format}: the page is centred in the area left of the panel`, Math.abs(c.left - G - L.areaW) < 1e-6 && Math.abs(s.left - (L.areaW - s.left - s.width)) < 1e-6 && !L.drawer);
    const F = computeLayout({ vw, vh, format, folded: true });
    ok(`${vw}×${vh} ${format}: folded, the rail is ${RAIL_W}px and the page area grows to meet it`, F.col.width === RAIL_W && F.areaW > L.areaW && Math.abs(F.col.left - G - F.areaW) < 1e-6 && F.fullHeight);
  }
}
{
  ok('the panel is 32% of the window, between its minimum and its maximum (440 to 480 px at 1440)', panelWidth(1536) === 480 && panelWidth(1440) >= 440 && panelWidth(1440) <= 480 && panelWidth(1280) === 410 && panelWidth(1000) === COL_MIN && panelWidth(2560) === COL_MAX);
  const narrow = computeLayout({ vw: 1100, vh: 1000, format: 'a4' });
  ok(`under ${DRAWER_MAX}px the panel is a drawer: the page keeps its width (the rail’s), the panel lies over its right edge`,
    narrow.drawer && narrow.areaW === 1100 - RAIL_W - 2 * G && narrow.col.left < narrow.areaW && narrow.col.width >= COL_MIN);
  ok('…and folding it changes nothing about the page', JSON.stringify(narrow.sheet) === JSON.stringify(computeLayout({ vw: 1100, vh: 1000, format: 'a4', folded: true }).sheet));
  ok('…while on a wide window folding it gives the page the panel’s room', computeLayout({ vw: 1536, vh: 864, format: 'a4', folded: true }).areaW > computeLayout({ vw: 1536, vh: 864, format: 'a4' }).areaW);
  const wide = computeLayout({ vw: 2560, vh: 1440, format: 'a4' });
  ok('very wide: the panel stops at its maximum', wide.col.width === COL_MAX);
  const two = computeLayout({ vw: 1920, vh: 1080, format: 'a4', pages: 2 });
  ok('two A4 pages at 1920×1080 sit side by side (costs under 15% of height)', two.spread && two.perView === 2);
  const tall = computeLayout({ vw: 1280, vh: 800, format: 'a4', pages: 2 });
  ok('…at 1280×800 they would cost more, so they stack and scroll', !tall.spread && tall.stack && tall.perView === 1);
  ok('the ▭▭ toggle forces a spread', computeLayout({ vw: 1280, vh: 800, format: 'a4', pages: 2, mode: 'spread' }).spread);
  ok('and ▯ forces the scrolled stack', computeLayout({ vw: 1536, vh: 864, format: 'a4', pages: 2, mode: 'stack' }).stack);
  ok('"single" from before 0.6.1 means the stack', computeLayout({ vw: 1536, vh: 864, format: 'a4', pages: 2, mode: 'single' }).stack);
  for (const folded of [false, true]) for (const [vw, vh, format, n] of [[1280, 800, 'a4', 2], [1536, 864, 'a4', 3], [1440, 960, 'us-letter', 2]]){
    const L = computeLayout({ vw, vh, format, pages: n, mode: 'stack', folded });
    const one = computeLayout({ vw, vh, format, pages: 1, folded });
    const { h } = pageSize(format);
    const tag = `${folded ? 'folded ' : ''}stack ${vw}×${vh} ${format} ×${n}`;
    ok(`${tag}: each page at the one-page scale (full height)`, Math.abs(L.scale - one.scale) < 1e-9 && L.fullHeight);
    ok(`  the sheet is n pages tall plus the gaps, scaled`, Math.abs(L.sheet.height - stackHeight(format, n) * L.scale) < 1e-6 && Math.abs(stackHeight(format, n) - (n * h + (n - 1) * PAGE_GAP)) < 1e-9);
    ok(`  the scroller is the window's height and scrolls through all of it`, L.pages.height === vh && Math.abs(L.pages.content - (G + L.sheet.height + G)) < 1e-6);
    ok(`  the panel doesn't move`, Math.abs(L.col.left - one.col.left) < 1e-9 && L.col.width === one.col.width);
    ok(`  the scroller stops short of the panel`, L.pages.width <= L.col.left && L.pages.width > L.sheet.left + L.sheet.width);
    ok(`  page in view: 1 at the top, then each page as it reaches the middle`, pageInView(L, 0, n) === 0 && pageInView(L, pageTop(L, 1), n) === 1 && pageInView(L, pageTop(L, n - 1) + 9999, n) === n - 1);
  }
  ok('the phone stacks the pages too (decision 6)', computeLayout({ vw: 390, vh: 844, format: 'a4', pages: 2 }).stack);
  const ph = computeLayout({ vw: 390, vh: 844, format: 'a4', folded: true });
  ok('the phone has no rail: the column is the bottom sheet whatever the fold', ph.phone && !ph.folded && ph.col.width === 390 && ph.col.top + ph.col.height === 844);
  ok('actual size: calibrated px per mm → scale', Math.abs(actualScale(NOMINAL_PX_PER_MM) - 1) < 1e-12 && Math.abs(actualScale(340 / CARD_MM) - (340 / CARD_MM) / NOMINAL_PX_PER_MM) < 1e-12);
  ok('there is no Career layout or thumbnail any more', computeLayout({ vw: 1536, vh: 864, format: 'a4' }).career === undefined);
}

section('layout: the panel in Record');
{
  ok(`Record is ${RECORD_MIN} to ${RECORD_MAX} px wide and never more than half the window`, recordWidth(1440) === 720 && recordWidth(1280) === 640 && recordWidth(1600) === 720 && [1280, 1366, 1440, 1920, 2560].every(vw => recordWidth(vw) <= vw / 2 && recordWidth(vw) >= RECORD_MIN));
  ok('under 1280 px Record is a drawer of 90% of the window, and on a phone the whole screen', recordWidth(1100) === 990 && recordWidth(PHONE_MAX - 1) === PHONE_MAX - 1);
  for (const [vw, vh] of [[1440, 900], [1280, 800], [1920, 1080]]){
    const n = computeLayout({ vw, vh, format: 'a4' }), w = computeLayout({ vw, vh, format: 'a4', wide: true });
    ok(`${vw}×${vh}: Record widens the panel to ${w.col.width}px, keeps it ${G}px from the right, and the page area gives way (${n.areaW} → ${w.areaW})`,
      w.col.width === recordWidth(vw) && Math.abs(vw - w.col.left - w.col.width - G) < 1e-6 && w.areaW === n.areaW - (w.col.width - n.col.width) && w.sheet.left + w.sheet.width <= w.areaW);
  }
  const d = computeLayout({ vw: 1100, vh: 800, format: 'a4', wide: true }), dn = computeLayout({ vw: 1100, vh: 800, format: 'a4' });
  ok('as a drawer, Record lies over the page, which does not move for it, and a sliver of the page stays in view', d.drawer && d.areaW === dn.areaW && JSON.stringify(d.sheet) === JSON.stringify(dn.sheet) && d.col.left > 0 && d.col.left + d.col.width === 1100 - G);
  ok('folded, the rail is the rail whatever the mode', computeLayout({ vw: 1440, vh: 900, format: 'a4', folded: true, wide: true }).col.width === RAIL_W);
  const ph = computeLayout({ vw: 390, vh: 844, format: 'a4', wide: true });
  ok('on a phone, Record is the whole screen', ph.phone && ph.col.left === 0 && ph.col.top === 0 && ph.col.width === 390 && ph.col.height === 844);
}

section('layout: zoom (1 is the whole page in the window)');
{
  const one = computeLayout({ vw: 1440, vh: 900, format: 'a4' });
  const big = computeLayout({ vw: 1440, vh: 900, format: 'a4', zoom: 2 });
  ok('zoom 2 doubles the sheet, not the area', Math.abs(big.scale - 2 * one.scale) < 1e-9 && big.areaW === one.areaW && !big.fullHeight);
  ok('a zoomed sheet that no longer fits starts at the corner and the scroller grows to hold it', big.sheet.left === G && big.sheet.top === G && big.pages.contentW >= big.sheet.width + 2 * G && big.pages.content >= big.sheet.height + 2 * G);
  ok('zoomed out, it stays centred', Math.abs(computeLayout({ vw: 1440, vh: 900, format: 'a4', zoom: 0.5 }).sheet.left - (one.areaW - computeLayout({ vw: 1440, vh: 900, format: 'a4', zoom: 0.5 }).sheet.width) / 2) < 1e-6);
  ok('zoom is kept between its limits, and a bad number means 1', clampZoom(0) === ZOOM_MIN && clampZoom(99) === ZOOM_MAX && clampZoom(NaN) === 1 && clampZoom(1.5) === 1.5);
}

section('the panel: Auto, Open, Closed');
{
  ok('Auto folds while nothing is selected, and opens when something is', !panelShown({ pref: 'auto' }) && panelShown({ pref: 'auto', selected: true }));
  ok('Open and Closed pin it, whatever is selected', panelShown({ pref: 'open' }) && !panelShown({ pref: 'closed', selected: true }));
  ok('a view (Design, Export, Settings, a form) needs the panel, even when it is closed', panelShown({ pref: 'closed', view: true }) && panelShown({ pref: 'auto', view: true }));
  ok('E on a folded Auto panel and the rail’s Edit keep it open until Esc (a peek); a snapshot opens it too', panelShown({ pref: 'auto', peek: true }) && panelShown({ pref: 'auto', snap: true }) && !panelShown({ pref: 'closed', peek: true }));
  ok('on a phone the column is always the bottom sheet', panelShown({ pref: 'closed', phone: true }));
  ok('Esc all the way out: Open drops to Auto, Auto and Closed stay', afterEscape('open') === 'auto' && afterEscape('auto') === 'auto' && afterEscape('closed') === 'closed');
  ok('the three modes, and the zoom-while-writing range from 80 to 220, 130 to start', eq(PANEL_MODES, ['auto', 'open', 'closed']) && ZOOM_WRITE.min === 80 && ZOOM_WRITE.max === 220 && ZOOM_WRITE.def === 130);
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
