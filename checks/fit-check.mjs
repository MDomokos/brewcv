#!/usr/bin/env node
// node checks/fit-check.mjs [library.json] [--browser | --browser-model]
// Fit's invariants, checked against a line model of the page (src/fit.js modelMeasure). The model
// is deliberately skewed too, so the correction loop has something to correct. With a library path
// its recipes are checked as well, and only counts are printed, never text.

import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createDocument } from '../scripts/lib/dom.mjs';
import { renderPages } from '../src/render.js';
import { pinsOf } from '../src/recipe.js';
import { validate } from './lib/validate.mjs';
import { geometryFor } from './lib/geometry.mjs';
import { autoLayout } from '../src/paginate.js';
import { fit, modelMeasure, modelFlow, cost, chosen, FILL_BAND, formatReport } from '../src/fit.js';

import { REPO, base, baseRecipe, grown, onePager, jobs } from './lib/fixtures.mjs';
import { readLibrary, readRecipe } from '../scripts/lib/library.mjs';
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));

let failed = 0, ran = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`);
  if (!cond) failed++;
};
const section = t => console.log(`\n${t}`);

// `measure` is given for the browser tier; without it the line model stands in.
async function run(label, data, recipe, { skew = 1, add = false, furniture, geometry, quiet = false, expect = {}, measure: given } = {}){
  ran++;
  const measure = given ?? modelMeasure(data, {
    ...(geometry ?? geometryFor(REPO, recipe)),
    furniture: furniture ?? (recipe.pages?.length > 1 ? [7.6, 2.8] : 6.7), skew });
  const dataBefore = JSON.stringify(data), recipeBefore = JSON.stringify(recipe);
  const r = await fit(data, recipe, { measure, add });
  const rep = r.report;
  const bad = [];
  const need = (cond, msg) => { if (!cond) bad.push(msg); };

  need(!r.error, `error: ${r.error}`);
  if (r.error){ ok(label, false, bad.join('; ')); return r; }

  need(JSON.stringify(data) === dataBefore, 'the library changed: Fit edited a phrasing');
  need(JSON.stringify(recipe) === recipeBefore, 'the recipe it was given changed');
  need(r.rounds <= 4, `${r.rounds} rounds`);

  const v = validate(data, r.recipe);
  need(!v.errors.length, `the result does not validate: ${v.errors[0]}`);
  try { renderPages(data, r.recipe, createDocument()); } catch (e){ need(false, `the result does not render: ${e.message}`); }

  const lang = recipe.lang ?? 'en';
  const langOf = id => data.variants.find(x => x.id === id)?.lang ?? 'en';
  for (const p of cost(data, r.recipe).pages) for (const row of p.rows)
    need(langOf(row.variant) === lang, `${row.fact} prints ${row.variant}, which is lang ${langOf(row.variant)}`);
  for (const [fact, vid] of Object.entries(r.recipe.picks ?? {}))
    need(langOf(vid) === lang, `pick ${fact} → ${vid} is lang ${langOf(vid)}`);

  need(JSON.stringify(r.recipe.overrides ?? {}) === JSON.stringify(recipe.overrides ?? {}), 'overrides changed');
  for (const [fact, vid] of Object.entries(r.recipe.picks ?? {}))
    need(data.facts.find(f => f.id === fact)?.variants.includes(vid), `pick ${fact} → ${vid} is not one of its phrasings`);

  // read through the same accessor the fitter uses, so the older `pins` form counts too
  const pins = pinsOf(recipe);
  const claims = new Set(cost(data, r.recipe).claims);
  const heldBack = new Set(rep.shortfall.filter(s => s.direction === 'pin').map(s => s.text.split(':')[0]));
  for (const id of pins.phrasing)
    need(chosen(data, recipe, id)?.id === chosen(data, r.recipe, id)?.id, `kept phrasing ${id} changed`);
  for (const id of pins.include) if (!heldBack.has(id)) need(claims.has(id), `kept ${id} is not on the page`);
  for (const id of pins.exclude) if (!heldBack.has(id)) need(!claims.has(id), `off ${id} is on the page`);

  if (!add){
    const was = new Set(normalisedListed(data, recipe));
    for (const h of normalisedListed(data, r.recipe))
      need(was.has(h) || pins.include.has(h), `${h} was added though adds are off`);
  }

  const again = await measure(r.recipe);
  rep.pages.forEach((pg, i) => {
    need(Math.abs(pg.fill - 100 * again[i].used / again[i].usable) < 0.06, `page ${pg.page}: the report's fill is not the measured one`);
    const inBand = pg.fill >= FILL_BAND[0] && pg.fill <= FILL_BAND[1] && !(pg.overflow > 0);
    const sf = rep.shortfall.find(s => s.page === pg.page && s.direction !== 'pin');
    if (!inBand) need(!!sf && sf.lines >= 1 && /line/.test(sf.text), `page ${pg.page} is ${pg.fill}% with no shortfall that names its lines`);
    if (pg.overflow > 0) need(!!sf && /over/.test(sf.text) && !!pg.overflowSection, `page ${pg.page} overflows without naming a section`);
    if (inBand) need(!sf, `page ${pg.page} is in band but a shortfall is reported`);
  });
  if (expect.inBand) need(rep.converged, `expected to land in the band: ${rep.pages.map(p => p.fill + '%').join(' · ')}`);
  if (expect.shortfall) need(rep.shortfall.length > 0, 'expected a shortfall report');

  ok(label + (quiet ? '' : `  [${rep.pages.map(p => p.fill + '%').join(' · ')}, ${r.rounds} round${r.rounds === 1 ? '' : 's'}${rep.converged ? '' : ', shortfall reported'}]`),
     bad.length === 0, bad.join('; '));
  return r;
}

function normalisedListed(data, recipe){
  const ix = new Map([...data.work, ...(data.projects ?? []).filter(p => p.display)].map(w => [w.id, w]));
  const out = [];
  for (const p of (recipe.pages ?? [])) for (const slot of p){
    if (typeof slot === 'string' || slot.id !== 'experience') continue;
    for (const ref of slot.work ?? []) out.push(...(typeof ref === 'string' ? ix.get(ref).highlights : (ref.highlights ?? ix.get(ref.id).highlights)));
  }
  if (!out.length) for (const x of recipe.sections ?? [])
    for (const ref of x.work ?? []) out.push(...(typeof ref === 'string' ? ix.get(ref).highlights : (ref.highlights ?? ix.get(ref.id).highlights)));
  return out;
}

const lines = (r, section, page = 1) => r.report.allocation.find(a => a.section === section && a.page === page);

const G = grown();
section('the fixtures');
{
  const v = validate(G, onePager(jobs(['hydra', 'orbit', 'nova', 'poly', 'free'])));
  ok('the grown fictional library validates', !v.errors.length, v.errors.slice(0, 2).join('; '));
  const before = validate(base, baseRecipe);
  ok('and the example it came from still does', !before.errors.length);
}

section('the example, as shipped');
await run('example recipe, two pages', base, baseRecipe, { expect: { shortfall: true } });
await run('the same with a model 7% too tall', base, baseRecipe, { skew: 1.07, expect: { shortfall: true } });
await run('the same with adds allowed', base, baseRecipe, { add: true });

section('a library with something to trade');
const full = onePager(jobs(['hydra', 'orbit', 'nova', 'poly', 'free']));
for (const skew of [1, 1.07, 0.93]){
  await run(`five jobs on one page, model ×${skew}, adds allowed`, G, full, { skew, add: true, expect: skew > 1 ? {} : { inBand: true } });
  await run(`five jobs on one page, model ×${skew}, adds off`, G, full, { skew, add: false });
}
const roomy = { ...onePager(jobs(['hydra', 'orbit', 'nova', 'poly', 'free'])), format: 'a4' };
for (const skew of [1.07, 0.93])
  await run(`the same on A4, model ×${skew}: the loop corrects the model`, G, roomy, { skew, add: true, expect: { inBand: true } });
const sparse = onePager(jobs(['hydra', 'orbit', 'nova', 'poly', 'free'].map(id => ({ id, highlights: [G.work.find(w => w.id === id).highlights[0]] }))));
await run('starting well under the band, adds allowed', G, sparse, { add: true, expect: { inBand: true } });
await run('starting well under the band, adds off: it lengthens what is listed and lists nothing new', G, sparse, { add: false });
await run('a page with no room to give: a shortfall, not a lie', G, full, { geometry: { usable: 330, lineH: 18.41 }, furniture: 6.7, expect: { shortfall: true } });

section('projects: their bullets trade like a job’s, never a whole project');
{
  const K = await import('../src/model/career.js');
  const P = structuredClone(G);
  P.requireSource = false;      // projects written in the app have no source
  const p1 = K.addProject(P, { name: 'Caliper stand', entity: 'Independent', startDate: '2022-04', endDate: '2022-09', bullets: ['Designed a printable caliper stand and published the files; about 3,000 downloads in its first year.', 'Wrote the assembly guide and answered the build questions on the forum for a year.', 'Tested three hinge designs for stiffness on a dial-gauge rig built for the purpose.'] });
  const p2 = K.addProject(P, { name: 'Chassis jig', entity: 'Formula Student team', startDate: '2019-10', endDate: '2020-06', bullets: ['Designed the welding jig for the team’s steel spaceframe chassis; it held tolerance through two builds.', 'Machined the locating blocks on the faculty mill and wrote the setup sheet for the next team.'] });
  const r = onePager({ sections: [{ id: 'experience', weight: 5, work: ['hydra', 'orbit', 'nova', 'poly', 'free'] }, { id: 'projects', weight: 4, work: [p1, p2] }, { id: 'skills', weight: 3 }, { id: 'education', weight: 2 }], pages: [['header', 'summary', 'experience', 'projects', 'skills', 'education']] });
  const res = await run('five jobs and two projects on one page, adds off', P, r, { add: false });
  const out = res.recipe ?? r;
  const slots = (out.pages ?? [out.sections]).flat().filter(s => s && typeof s === 'object' && s.id === 'projects');
  const listed = new Set(slots.flatMap(s => (s.work ?? []).map(w => (typeof w === 'string' ? w : w.id))));
  ok('both projects are still listed (Fit drops bullets, never a whole project)', listed.has(p1) && listed.has(p2), JSON.stringify(slots));
  const drops = (res.report?.dropped ?? []).map(d => d.fact);
  ok('and what it drops are bullets', drops.every(f => P.facts.some(x => x.id === f) && ![`${p1}-position`, `${p2}-position`].includes(f)));
}

section('weights');
{
  // three jobs: with five, the one-bullet floor leaves nothing for a weight to move
  const three = ['hydra', 'orbit', 'poly'];
  const withWeights = (we, ws) => onePager({ sections: [{ id: 'experience', weight: we, work: three }, { id: 'skills', weight: ws }, { id: 'patent', weight: 2 }, { id: 'education', weight: 2 }] });
  const sixLines = { geometry: { usable: 1000, lineH: 18.41 }, furniture: 6.7, add: true, quiet: true };
  const lo = await run('skills weight 1, experience weight 5', G, withWeights(5, 1), sixLines);
  const hi = await run('skills weight 5, experience weight 1', G, withWeights(1, 5), sixLines);
  const me = await run('skills weight 3, experience weight 3', G, withWeights(3, 3), sixLines);
  ok('raising skills and lowering experience moves lines from experience to skills',
     lines(hi, 'skills').lines > lines(lo, 'skills').lines && lines(hi, 'experience').lines < lines(lo, 'experience').lines,
     `skills ${lines(lo, 'skills').lines}→${lines(hi, 'skills').lines}, experience ${lines(lo, 'experience').lines}→${lines(hi, 'experience').lines}`);
  ok('the share is monotone in the weight, in both sections',
     lines(lo, 'skills').share <= lines(me, 'skills').share && lines(me, 'skills').share <= lines(hi, 'skills').share
     && lines(lo, 'experience').share >= lines(me, 'experience').share && lines(me, 'experience').share >= lines(hi, 'experience').share,
     JSON.stringify([lo, me, hi].map(r => [lines(r, 'skills').share, lines(r, 'experience').share])));
  const omit = await run('weight 0 on skills leaves it out of the page and the budget', G, withWeights(5, 0), sixLines);
  ok('…and Fit gave it no lines', !omit.report.allocation.some(a => a.section === 'skills')
     && !cost(G, omit.recipe).pages[0].rows.some(r => r.section === 'skills'));
  const dflt = await run('an unweighted section counts as 3', G, onePager({ sections: [{ id: 'experience', weight: 5, work: three }] }), sixLines);
  ok('…and gets a share', dflt.report.allocation.find(a => a.section === 'skills')?.weight === 3);
}

section('bottom job first, and the floor');
{
  const leftOf = (r, ids) => ids.map(id => {
    const ref = r.recipe.pages[0].find(s => s.id === 'experience').work.find(x => (typeof x === 'string' ? x : x.id) === id);
    return !ref ? 0 : typeof ref === 'string' ? G.work.find(w => w.id === id).highlights.length : ref.highlights.length;
  });
  const lostOf = (ids, left) => ids.map((id, i) => G.work.find(w => w.id === id).highlights.length - left[i]);
  // Bottom first, except where the bottom job is already at its one-bullet floor.
  const bottomFirst = (lost, left) => lost.every((x, i) => lost.every((y, j) => j <= i || x <= y || left[j] === 1));

  const five = ['hydra', 'orbit', 'nova', 'poly', 'free'];
  const a = await run('five jobs, every bullet, on one Letter page: cuts are needed', G, full, { geometry: { usable: 956, lineH: 18.41 }, furniture: 6.7, add: true, quiet: true });
  const la = leftOf(a, five);
  ok('every job is still there, each with at least one bullet', la.every(n => n >= 1), JSON.stringify(la));
  ok('and bullets really were cut, in more than one job', lostOf(five, la).filter(x => x > 0).length >= 2, `lost per job ${lostOf(five, la)}`);

  const four = ['poly', 'pola', 'polb', 'polc'];
  const b = await run('four jobs of two independent bullets, cuts are needed', G, onePager(jobs(four)), { geometry: { usable: 956, lineH: 18.41 }, furniture: 6.7, add: true, quiet: true });
  const lb = leftOf(b, four), lostB = lostOf(four, lb);
  ok('the bottom job gives up bullets before the one above it does', bottomFirst(lostB, lb) && lostB.some(x => x > 0), `lost per job ${lostB}`);
  ok('…and the top job is the one that kept two', lb[0] >= lb[3], `left per job ${lb}`);
}

section('archived claims');
{
  // two jobs on a page with room to spare: Fit adds claims, but never an archived one
  const A = structuredClone(G);
  const ids = ['hydra', 'orbit'];
  const hidden = new Set();
  for (const id of ids) for (const h of A.work.find(w => w.id === id).highlights.slice(1)){ A.facts.find(f => f.id === h).archived = true; hidden.add(h); }
  const lone = d => onePager(jobs(ids.map(id => ({ id, highlights: [d.work.find(w => w.id === id).highlights[0]] }))));
  const open = await run('nothing archived: Fit has claims to add', G, lone(G), { add: true, quiet: true });
  ok('with nothing archived Fit lists more than the first claim of a job', normalisedListed(G, open.recipe).length > ids.length, String(normalisedListed(G, open.recipe).length));
  const r = await run('every claim after a job’s first archived: nothing to add', A, lone(A), { add: true, quiet: true });
  const listed = normalisedListed(A, r.recipe);
  ok('Fit never adds an archived claim', listed.length === ids.length && listed.every(c => !hidden.has(c)), listed.join());
}

section('off and keep');
{
  const pinned = onePager({ ...jobs(['hydra', 'orbit', 'nova', 'poly', 'free']),
    off: ['hydra-testing'], keep: ['nova-suppliers', 'hydra-inhaler', 'orbit-inhaler'],
    picks: { 'hydra-inhaler': 'hydra-inhaler-full', 'orbit-inhaler': 'orbit-inhaler-short' } });
  const small = { geometry: { usable: 640, lineH: 18.41 }, furniture: 6.7, add: true };
  const r = await run('include, exclude and two locked phrasings, on a page that has to shrink', G, pinned, small);
  const claims = new Set(cost(G, r.recipe).claims);
  ok('the kept bullet of the bottom job survived', claims.has('nova-suppliers'));
  ok('the claim that is off is nowhere on the page', !claims.has('hydra-testing'));
  ok('the kept phrasings are exactly what they were',
     chosen(G, r.recipe, 'hydra-inhaler').id === 'hydra-inhaler-full' && chosen(G, r.recipe, 'orbit-inhaler').id === 'orbit-inhaler-short');

  const legacy = onePager({ ...jobs(['hydra', 'orbit', 'nova', 'poly', 'free']),
    pins: { include: ['nova-suppliers'], exclude: ['hydra-testing'], phrasing: ['hydra-inhaler', 'orbit-inhaler'] },
    picks: { 'hydra-inhaler': 'hydra-inhaler-full', 'orbit-inhaler': 'orbit-inhaler-short' } });
  const rl = await run('the same intent written as the 0.4.0 pins', G, legacy, { ...small, quiet: true });
  ok('the 0.4.0 pins fit exactly as the off / keep they migrate to', JSON.stringify([rl.recipe.pages, rl.recipe.picks]) === JSON.stringify([r.recipe.pages, r.recipe.picks]));

  const mergedPick = onePager({ ...jobs(['hydra']), picks: { 'hydra-testing': 'hydra-testing-merged' }, off: ['hydra-suppliers'] });
  const m = await run('pinning out a fact a merged phrasing says undoes the merge', G, mergedPick, { add: true, quiet: true });
  ok('the merged phrasing is gone and the claim with it',
     chosen(G, m.recipe, 'hydra-testing').id !== 'hydra-testing-merged' && !new Set(cost(G, m.recipe).claims).has('hydra-suppliers'));
  ok('…and the report says what it stopped saying',
     m.report.enforced.some(n => n.fact === 'hydra-testing' && /hydra-suppliers/.test(n.why)) || m.report.claims.lost.includes('hydra-suppliers'));

  const keep = onePager({ ...jobs(['hydra', 'orbit', 'nova', 'poly', 'free']),
    picks: { 'nova-testing': 'nova-testing-merged' }, keep: ['nova-suppliers'] });
  const k = await run('a pinned-in claim survives a squeeze even when it is only said inside a merge', G, keep, { geometry: { usable: 600, lineH: 18.41 }, furniture: 6.7, add: true, quiet: true });
  ok('nova-suppliers is still on the page', new Set(cost(G, k.recipe).claims).has('nova-suppliers'));

  const conflict = onePager({ ...jobs(['hydra']), picks: { 'hydra-testing': 'hydra-testing-merged' },
    off: ['hydra-suppliers'], keep: ['hydra-testing'] });
  const c = await run('a lock and an exclusion that contradict are reported, not resolved', G, conflict, { add: true, quiet: true });
  ok('…naming the fact', c.report.shortfall.some(s => s.direction === 'pin' && /hydra-suppliers/.test(s.text)));
}

section('a decoy: the shortest phrasings are Hungarian');
{
  const r = await run('Fit never takes a Hungarian phrasing in an English recipe', G, full,
    { geometry: { usable: 500, lineH: 18.41 }, furniture: 6.7, add: true, quiet: true });
  ok('none of the library\'s -hu phrasings was picked or printed',
     !Object.values(r.recipe.picks ?? {}).some(v => /-hu$/.test(v))
     && !cost(G, r.recipe).pages.flatMap(p => p.rows).some(x => /-hu$/.test(x.variant)));
}

section('a moved job: its place is its priority');
{
  const ids = ['poly', 'pola', 'polb', 'polc'];
  const D = structuredClone(G);
  D.sections.find(s => s.id === 'experience').content.work = ids;     // the record lists them, in this order
  const auto = onePager(jobs(ids));
  delete auto.pages;
  auto.pageLimit = 1;
  const g = { usable: 956, lineH: 18.41, furniture: 6.7 }, layout = r => autoLayout(D, r, modelFlow(D, g));
  const left = async order => {
    const a = structuredClone(auto);
    if (order) a.sections.find(s => s.id === 'experience').order = order;
    const res = await fit(D, a, { measure: modelMeasure(D, g), layout, add: true });
    return { res, n: Object.fromEntries(res.recipe.sections.find(s => s.id === 'experience').work.map(r => [r.id ?? r, (r.highlights ?? D.work.find(w => w.id === r).highlights).length])) };
  };
  const plain = await left(null), flipped = await left([...ids].reverse());
  ok('Fit runs on both', !plain.res.error && !flipped.res.error, plain.res.error ?? flipped.res.error);
  ok('without an order the last job in the record gives up bullets first', plain.n.poly > plain.n.polc, JSON.stringify(plain.n));
  ok('with the order flipped, the job printed last gives up bullets first, and the first keeps its bullets', flipped.n.polc > flipped.n.poly, JSON.stringify(flipped.n));
  ok('the fitted lists go back to the record’s order, beside the stored order', flipped.res.recipe.sections.find(s => s.id === 'experience').work.map(r => r.id ?? r).join() === ids.join()
    && flipped.res.recipe.sections.find(s => s.id === 'experience').order.join() === [...ids].reverse().join());
}

section('stability');
{
  const a = await run('first fit', G, full, { add: true, quiet: true });
  const b = await run('fitting the fitted recipe', G, a.recipe, { add: true, quiet: true });
  ok('a second Fit changes nothing', JSON.stringify(a.recipe.pages) === JSON.stringify(b.recipe.pages)
     && JSON.stringify(a.recipe.picks) === JSON.stringify(b.recipe.picks), formatReport(b.report).slice(1, 4).join(' | '));
  const sorted = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
  ok('the sections lists repeat what the page slots hold', sorted({ x: JSON.stringify(a.recipe.sections.find(s => s.id === 'experience').work) })
     === sorted({ x: JSON.stringify(a.recipe.pages[0].find(s => s.id === 'experience').work) }));
}

const LIB = process.argv.slice(2).find(a => !a.startsWith('--'));
if (LIB){
  section(`the library you passed, and its recipes (counts only)`);
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const before = sha(LIB);
  const lib = readLibrary(LIB).model;
  const dir = path.join(path.dirname(LIB), 'recipes');
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
  const bigGeom = { 'us-letter': 6.7 };
  for (const name of names){
    const recipe = readRecipe(path.join(dir, name)).recipe;
    for (const add of [false, true])
      await run(`${name.replace(/\.json$/, '')}, adds ${add ? 'on' : 'off'}`, lib, recipe,
        { add, furniture: recipe.pages?.length > 1 ? [7.6, 2.8] : bigGeom[recipe.format] ?? 6.7 });
  }
  ok('the library file on disk was not touched', sha(LIB) === before);
}

// --browser: every measurement is Chromium's, and line counts come from a probe
// (measure-variants.mjs --probe --write) run on a temp copy; the library you pass is never written.
// --browser-model rehearses the same wiring on the line model and measures nothing.

const BROWSER = process.argv.includes('--browser');
const REHEARSE = process.argv.includes('--browser-model');
let browserRan = false, browserNote = 'Not run here: the browser tier, which measures real pages (--browser).';
if (BROWSER || REHEARSE){
  section(REHEARSE ? 'browser tier: REHEARSAL on the line model, nothing is measured' : 'browser tier: real pages, measured in Chromium');
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const targets = [{ label: 'example', file: path.join(REPO, 'checks/fixtures/example-0.4.json'),
    recipes: [{ name: 'example recipe', file: path.join(REPO, 'checks/fixtures/example-0.4-recipe.json') }] }];
  if (LIB){
    const dir = path.join(path.dirname(LIB), 'recipes');
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
    targets.push({ label: 'library', file: LIB,
      recipes: names.map(n => ({ name: n.replace(/\.json$/, ''), file: path.join(dir, n) })) });
  }
  let open = null;
  if (!REHEARSE){
    // asking for real pages and not getting them is a failure of this run, not a pass
    try { await import('playwright'); ({ openMeasurer: open } = await import('./lib/browser-measure.mjs')); }
    catch { console.log('NOT RUN  the browser tier needs playwright and a Chromium on this machine, and playwright is not installed.'); failed++; }
  }
  if (REHEARSE || open){
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-check-'));
    try {
      for (const t of targets){
        const before = sha(t.file);
        const copy = path.join(scratch, `${t.label}.json`);
        fs.copyFileSync(t.file, copy);
        if (!REHEARSE)
          for (const r of t.recipes)
            execFileSync(process.execPath, [path.join(REPO, 'checks/measure-variants.mjs'), copy, r.file, '--probe', '--write'],
              { stdio: ['ignore', 'ignore', 'inherit'] });
        const data = readLibrary(copy).model;
        const m = REHEARSE ? null : await open({ repo: REPO, data: copy });
        try {
          for (const r of t.recipes){
            const recipe = readRecipe(r.file).recipe;
            for (const add of [false, true]){
              const measure = REHEARSE
                ? modelMeasure(data, { ...geometryFor(REPO, recipe), furniture: recipe.pages?.length > 1 ? [7.6, 2.8] : 6.7 })
                : m.measure;
              const res = await run(`${t.label === 'example' ? r.name : r.name}, adds ${add ? 'on' : 'off'}${REHEARSE ? ' (model)' : ''}`,
                data, recipe, { add, measure });
              if (!REHEARSE) ok(`  no row was planned from an estimate`, res.report?.estimated === 0, `${res.report?.estimated} estimated`);
            }
          }
        } finally { await m?.close(); }
        ok(`the ${t.label} file you passed was not written`, sha(t.file) === before);
      }
      browserRan = true;
      browserNote = REHEARSE ? 'Browser tier REHEARSED on the line model: its wiring ran, no page was measured.'
                             : 'Browser tier ran: every page above was measured in Chromium.';
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
}

console.log(`\n${ran} Fit runs · ${failed ? failed + ' FAILED' : `all fit checks passed (${browserRan && !REHEARSE ? 'plan tier on a modelled page, browser tier on real pages' : 'plan tier, modelled page'})`}`);
console.log(browserNote);
process.exit(failed ? 1 : 0);
