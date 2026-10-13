#!/usr/bin/env node
// node checks/paginate-check.mjs [resume-data.json] [--browser]
// Block pagination (src/paginate.js) and the per-resume fields around it, on hand-built measurements
// and the line model. --browser paginates every example resume (and each recipe of a library you pass)
// from Chromium's measurements, then measures the pages again. Nothing is written next to the library.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import { paginate, flowSlots, flowRecipe, autoLayout, blocksOf, isAuto } from '../src/paginate.js';
import { fit, modelMeasure, modelFlow } from '../src/fit.js';
import { renderPages } from '../src/render.js';
import { resolve } from '../src/model/resume.js';
import { load, loadResume } from '../src/model/schema.js';
import { validate } from './lib/validate.mjs';
import { geometryFor } from './lib/geometry.mjs';
import { createDocument, serialize } from '../scripts/lib/dom.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.isAbsolute(f) ? f : path.join(REPO, f), 'utf8'));
const clone = x => structuredClone(x);
const argv = process.argv.slice(2);
const BROWSER = argv.includes('--browser');
const LIB = argv.find(a => !a.startsWith('--'));

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`);
  if (!cond) failed++;
};
const section = t => console.log(`\n— ${t}`);

const { model: example } = load(read('data/example.json'));
const resumesDir = path.join(REPO, 'data/example-resumes');
const resumes = fs.readdirSync(resumesDir).filter(f => f.endsWith('.json') && f !== 'index.json').sort()
  .map(f => ({ name: f.replace(/\.json$/, ''), recipe: loadResume(read(path.join(resumesDir, f)), example).recipe }));
const stripped = r => { const x = clone(r); delete x.pages; return x; };
const jobsIn = pages => pages.flat().flatMap(s => (typeof s === 'object' && s.work ? s.work.map(w => (typeof w === 'string' ? w : w.id)) : []));
const html = (data, recipe) => renderPages(data, recipe, createDocument()).pages.map(p => serialize(p)).join('\n');

// a measured flow, by hand: [id, height] or [id, [job heights]]; `head` is an
// entries band's top padding, `gap` the space between bands
function flow(spec, { usable = 1000, gap = 10, head = 6 } = {}){
  let y = 0;
  const bands = [], slots = [];
  for (const [id, h] of spec){
    const top = y;
    if (Array.isArray(h)){
      const entries = [];
      y += head;
      h.forEach((jh, j) => { entries.push({ top: y, bottom: y + jh }); y += jh; });
      bands.push({ section: id, top, bottom: y, entries });
      slots.push({ id, work: h.map((_, j) => `job${j + 1}`) });
    } else {
      y += h;
      bands.push({ section: id, top, bottom: y, entries: [] });
      slots.push({ id });
    }
    y += gap;
  }
  return { measured: { usable, bands }, slots };
}

section('paginate: blocks onto pages');
{
  const a = flow([['header', 100], ['summary', 40], ['experience', [100, 100, 100]], ['skills', 80]]);
  ok('everything that fits stays on one page',
    eq(paginate(a.measured, a.slots), [['header', 'summary', { id: 'experience', work: ['job1', 'job2', 'job3'] }, 'skills']]));

  const b = flow([['header', 100], ['summary', 40], ['experience', [300, 300, 300, 300]], ['skills', 80], ['education', 60]]);
  const pb = paginate(b.measured, b.slots);
  ok('a long Experience breaks between jobs', pb.length === 2 && eq(jobsIn(pb), ['job1', 'job2', 'job3', 'job4']), JSON.stringify(pb));
  ok('and continues at the top of the next page', typeof pb[1][0] === 'object' && pb[1][0].id === 'experience');
  ok('the sections after it follow, in order', eq(pb[1].slice(1), ['skills', 'education']));
  ok('no job is split or repeated', new Set(jobsIn(pb)).size === 4);

  const c = flow([['header', 100], ['experience', [500, 450]], ['skills', 80]]);
  const pc = paginate(c.measured, c.slots);
  ok('a job that does not fit moves whole, it is never cut', eq(jobsIn([pc[0]]), ['job1']) && eq(jobsIn([pc[1]]), ['job2']), JSON.stringify(pc));

  const d = flow([['header', 100], ['experience', [400, 400, 400, 400]], ['skills', 300]]);
  ok('no limit: as many pages as needed', paginate(d.measured, d.slots).length === 3);
  ok('pageLimit 2: two pages, the rest stays on the last', paginate(d.measured, d.slots, { pageLimit: 2 }).length === 2
    && paginate(d.measured, d.slots, { pageLimit: 2 })[1].includes('skills'));
  ok('pageLimit 1: everything on one page, to overflow there', paginate(d.measured, d.slots, { pageLimit: 1 }).length === 1);
  ok('pageLimit 0 is no limit', paginate(d.measured, d.slots, { pageLimit: 0 }).length === 3);

  const e = flow([['header', 100], ['experience', [1200]], ['skills', 80]]);
  const pe = paginate(e.measured, e.slots);
  ok('a block taller than a page gets a page of its own', pe.length === 3 && eq(jobsIn([pe[1]]), ['job1']), JSON.stringify(pe));
  ok('the header is always first', pe[0][0] === 'header');

  const f = flow([['header', 100], ['summary', 40]]);
  let threw = false; try { paginate(f.measured, [{ id: 'header' }]); } catch { threw = true; }
  ok('a measurement of a different flow is refused, not guessed at', threw);
  const tight = flow([['header', 600], ['skills', 389.6]], { gap: 10 });
  ok('a band that ends within half a pixel of the bottom fits', paginate(tight.measured, tight.slots).length === 1);
}

section('flowSlots: what a recipe without pages prints');
{
  const r = { format: 'a4', theme: 'b2-marker', summary: 'summary',
    sections: [{ id: 'experience', work: ['hydra', { id: 'poly', highlights: ['poly-shop'] }] }, { id: 'skills' }, { id: 'patent', weight: 0 }, { id: 'nope' }] };
  const s = flowSlots(example, r);
  ok('header and summary first, then the recipe order', eq(s.map(x => x.id), ['header', 'summary', 'experience', 'skills']));
  ok('weight 0 and unknown sections are left out', !s.some(x => x.id === 'patent' || x.id === 'nope'));
  ok('the work list, subsets and all, comes from the recipe', eq(s[2].work, r.sections[0].work));
  ok('flowRecipe renders like the old one-page plan', html(example, flowRecipe(example, r)) === html(example, r));
  ok('a manual layout is not auto', !isAuto({ pages: [] }) && isAuto({}));
}

section('a moved job: flowSlots and the pages keep this resume’s order');
{
  const r = { format: 'a4', theme: 'b2-marker', summary: 'summary', sections: [{ id: 'experience', work: ['hydra', { id: 'poly', highlights: ['poly-shop'] }, 'free'], order: ['free', 'poly', 'gone'] }] };
  const s = flowSlots(example, r).find(x => x.id === 'experience');
  ok('the slot lists the jobs in the order the resume sets; a stale id is ignored, one it does not name follows', eq(s.work.map(w => (typeof w === 'string' ? w : w.id)), ['free', 'poly', 'hydra']));
  const { order, ...plain } = r.sections[0];
  ok('the same recipe without the order lists the work as it is', eq(flowSlots(example, { ...r, sections: [plain] }).find(x => x.id === 'experience').work.map(w => (typeof w === 'string' ? w : w.id)), ['hydra', 'poly', 'free']));
  ok('the page prints the jobs in that order, like the plan', html(example, flowRecipe(example, r)) === html(example, r) && html(example, r).indexOf('Self-employed') < html(example, r).indexOf('Hydra Medical'));
  const g = geometryFor(REPO, r);
  const laid = await autoLayout(example, r, modelFlow(example, g));
  ok('pagination keeps the moved order', eq(jobsIn(laid.pages), ['free', 'poly', 'hydra']));
}

section('the line model: the example resumes, paginated');
for (const { name, recipe } of resumes){
  const auto = stripped(recipe);
  const g = geometryFor(REPO, auto);
  const laid = await autoLayout(example, auto, modelFlow(example, g));
  const m = await modelMeasure(example, g)(laid);
  ok(`${name}: ${laid.pages.length} page(s), limit ${auto.pageLimit}`, laid.pages.length <= auto.pageLimit);
  ok(`${name}: no page before the last overflows`, m.slice(0, -1).every(p => !(p.overflow > 0)), m.map(p => Math.round(p.used)).join(' / '));
  ok(`${name}: every job prints once, in order`, eq(jobsIn(laid.pages), jobsIn([flowSlots(example, auto)])));
  let pages = 0, err = '';
  try { pages = renderPages(example, laid, createDocument()).pages.length; } catch (e){ err = e.message; }
  ok(`${name}: renders`, pages === laid.pages.length, err);
  ok(`${name}: validates`, validate(example, laid).errors.length === 0, validate(example, laid).errors[0]);
}

section('Fit on a paginated resume aims the last page');
{
  const base = resumes.find(r => r.recipe.pageLimit === 2).recipe;
  const auto = stripped(base);
  // more than two pages of material: every bullet on
  const sec = auto.sections.find(s => s.id === 'experience');
  sec.work = example.work.map(w => w.id);
  const g = geometryFor(REPO, auto);
  const layout = r => autoLayout(example, r, modelFlow(example, g));
  const res = await fit(example, auto, { measure: modelMeasure(example, g), layout });
  ok('Fit runs', !res.error, res.error);
  ok('and gives back a recipe with no pages, to be paginated again', !res.error && res.recipe.pages === undefined && res.paginated === true);
  ok('the result validates', validate(example, res.recipe).errors.length === 0, validate(example, res.recipe).errors[0]);
  const last = res.report.pages.at(-1);
  ok('the last page is in the band, or the report says why', last.status === 'in-band' || res.report.shortfall.length > 0, JSON.stringify(last));
  ok('pages before the last are held, not aimed', res.report.pages.slice(0, -1).every(p => p.held && p.status === 'in-band'));
  ok('no page overflows', res.report.pages.every(p => !(p.overflow > 0)), res.report.pages.map(p => p.fill).join(' / '));
  ok('it stays within the page limit', res.report.pages.length <= auto.pageLimit);
  const again = await layout(res.recipe);
  ok('paginated again, it breaks where Fit measured it', again.pages.length === res.report.pages.length);
  const off = await fit(example, { ...auto, pageLimit: 0 }, { measure: modelMeasure(example, g), layout });
  ok('as many pages as needed: Fit is off', /Fit is off/.test(off.error ?? ''));
  const manual = await fit(example, await layout(base), { measure: modelMeasure(example, g), layout });
  ok('a manual layout keeps its pages through Fit', Array.isArray(manual.recipe.pages));
}

section('section labels per resume');
{
  const r = clone(resumes.find(x => x.recipe.format === 'us-letter').recipe);
  const before = html(example, r);
  r.sections.find(s => s.id === 'skills').label = 'Tools';
  const doc = html(example, r);
  ok('a label renames the tab', /class="tab">Tools</.test(doc) && !/class="tab">Skills</.test(doc));
  ok('and nothing else changes', doc.replaceAll('Tools', 'Skills') === before);
  const hu = clone(resumes.find(x => x.recipe.lang === 'hu').recipe);
  hu.sections.find(s => s.id === 'skills').label = { en: 'Tools', hu: 'Eszközök' };
  ok('a per-language label prints in the resume\'s language', /class="tab">Eszközök</.test(html(example, hu)));
  hu.sections.find(s => s.id === 'skills').label = { en: 'Tools' };
  ok('a label with no text in that language falls back to the translation', /class="tab">Készségek</.test(html(example, hu)));
  const plain = clone(resumes.find(x => x.recipe.format === 'us-letter').recipe);
  ok('no label, no change', html(example, plain) === before);
}

section('the photo switch');
{
  const base = clone(resumes.find(x => x.recipe.format === 'us-letter').recipe);
  const withPhoto = (photo, image) => {
    const d = clone(example);
    if (image) d.basics.image = image;
    const r = clone(base);
    if (photo === undefined) delete r.photo; else r.photo = photo;
    return html(d, r);
  };
  const IMG = 'data:image/' + 'png;base64,AAAA';
  ok('show: false prints no photo, even where the portrait would', !/portrait/.test(withPhoto({ show: false, shape: 'rect' })));
  ok('show: true with no image prints the placeholder, in any template', /portrait portrait--missing/.test(withPhoto({ show: true, shape: 'rect' })));
  ok('show: true with basics.image prints it', withPhoto({ show: true, shape: 'rect' }, IMG).includes(`class="portrait" src="${IMG}"`));
  ok('the shape is a class', /class="portrait portrait--round"/.test(withPhoto({ show: true, shape: 'round' }, IMG)));
  ok('an unmaterialised asset ref is never printed as a src', !withPhoto({ show: true }, 'asset:0000-1').includes('asset:'));
  ok('no photo key: the portrait\'s formats decide, as before (none on Letter)', !/portrait/.test(withPhoto(undefined)));
  const a4 = clone(resumes.find(x => x.recipe.format === 'a4').recipe); delete a4.photo;
  ok('…and the placeholder on A4, as before', /portrait--missing/.test(html(example, a4)));
}

section('static fields per language');
{
  const hu = resumes.find(x => x.recipe.lang === 'hu').recipe;
  const body = resolve(example, hu).body;
  ok('a Hungarian resume writes the Hungarian location', body.work[0].location === 'Lisszabon', body.work[0].location);
  ok('an English one the spine value', resolve(example, resumes.find(x => !x.recipe.lang).recipe).body.work.find(w => w.name === 'Hydra Medical')?.location === 'Lisbon, Portugal');
}

if (BROWSER){
  section('browser: paginated from Chromium\'s measurements');
  let open;
  try { await import('playwright'); ({ openMeasurer: open } = await import('./lib/browser-measure.mjs')); }
  catch { console.log('NOT RUN  the browser tier needs playwright and a Chromium on this machine.'); failed++; }
  if (open){
    const targets = [{ label: 'example', file: path.join(REPO, 'data/example.json'), data: example,
      recipes: resumes.map(r => ({ name: r.name, recipe: stripped(r.recipe), limit: r.recipe.pageLimit })) }];
    if (LIB){
      const { model } = load(read(LIB));
      const dir = path.join(path.dirname(LIB), 'recipes');
      const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
      const huFirst = (x, y) => (y.recipe.lang === 'hu') - (x.recipe.lang === 'hu');
      targets.push({ label: 'library', file: LIB, data: model, recipes: names.map(n => {
        const r = loadResume(read(path.join(dir, n)), model).recipe;
        // the manual layout's sections, in its order, as the resume's own list
        const ids = [...new Set((r.pages ?? []).flat().map(x => (typeof x === 'string' ? x : x.id)))].filter(id => id !== 'header' && id !== 'summary');
        const exp = r.sections?.find(s => s.id === 'experience');
        const auto = stripped(r);
        auto.sections = ids.map(id => (id === 'experience' && exp ? exp : (r.sections?.find(s => s.id === id) ?? { id })));
        auto.pageLimit = Math.min(2, r.pages?.length ?? 1);
        return { name: n.replace(/\.json$/, ''), recipe: auto, limit: auto.pageLimit };
      }).sort(huFirst) });
    }
    for (const t of targets){
      const before = fs.readFileSync(t.file);
      const m = await open({ repo: REPO, data: t.file });
      try {
        for (const { name, recipe, limit } of t.recipes){
          const laid = await m.layout(recipe);
          const pages = await m.measure(laid);
          const fills = pages.map(p => `${p.fill.toFixed(1)}%`).join(' · ');
          ok(`${t.label} · ${name}: ${laid.pages.length} page(s) within the limit of ${limit}  [${fills}]`, laid.pages.length <= limit);
          ok(`  no page before the last overflows`, pages.slice(0, -1).every(p => !(p.overflow > 0)), fills);
          ok(`  every job once, in order`, eq(jobsIn(laid.pages), jobsIn([flowSlots(t.data, recipe)])));
        }
        if (t.label === 'example'){
          const two = t.recipes.find(r => r.limit === 2).recipe;
          const res = await fit(t.data, two, { measure: r => m.measure(r), layout: r => m.layout(r) });
          ok('Fit on a paginated resume runs', !res.error, res.error);
          if (!res.error){
            const again = await m.measure(await m.layout(res.recipe));
            const said = res.report.pages.at(-1).fill, now = 100 * again.at(-1).used / again.at(-1).usable;
            ok(`  the last page it reports is the last page as drawn  [${said}% vs ${now.toFixed(1)}%]`, Math.abs(said - now) < 0.15);
            ok('  no page overflows', again.every(p => !(p.overflow > 0)));
          }
        }
      } finally { await m.close(); }
      ok(`the ${t.label} file was not written`, fs.readFileSync(t.file).equals(before));
    }
  }
} else console.log('\nNot run here: the browser tier (--browser), which paginates from real measurements.');

console.log(failed ? `\n${failed} paginate check(s) FAILED` : '\nall paginate checks passed');
process.exit(failed ? 1 : 0);
