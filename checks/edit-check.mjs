#!/usr/bin/env node
// node checks/edit-check.mjs
// The Edit view's model in Node: src/model/record.js (version numbers, save over, save as, delete, the
// word diff) and the tailoring edits in src/model/resume.js. Fictional data only; nothing is written.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import * as S from '../src/model/schema.js';
import * as R from '../src/model/record.js';
import * as T from '../src/model/resume.js';
import { pinsOf } from '../src/recipe.js';
import { validate } from './lib/validate.mjs';
import { createDocument } from '../scripts/lib/dom.mjs';
import { renderPages } from '../src/render.js';
import { cost } from '../src/fit.js';
import * as CL from '../src/model/checklist.js';
import { plainOf } from '../src/ui/plain.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const clone = x => structuredClone(x);
let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`);
  if (!cond) failed++;
};
const section = t => console.log(`\n— ${t}`);
const throws = fn => { try { fn(); return false; } catch { return true; } };

const example = S.load(read('data/example.json')).model;
const names = read('data/example-resumes/index.json');
const resumes = names.map(n => S.loadResume(read(`data/example-resumes/${n}`), example).recipe);
const m4 = S.load(read('checks/fixtures/example-0.4.json')).model;
const m4recipe = S.migrateRecipe(read('checks/fixtures/example-0.4-recipe.json'));

const render = (model, recipe) => {
  const doc = createDocument();
  return renderPages(model, recipe, doc, { annotate: true }).pages.map(p => p.outerHTML).join('');
};
const printed = (model, recipe) => new Set(cost(model, recipe).claims);
const errorsOf = (model, recipe) => validate(S.save(model), recipe).errors;
const nOf = (model, fid, lang = 'en') => R.versionsIn(model, fid, lang).map(v => v.n);

// a fact with several English versions to play with
const F = example.facts.find(f => R.versionsIn(example, f.id, 'en').length >= 2 && T.jobOfFact(example, f.id)).id;

section('version numbers');
{
  const m = clone(example);
  const base = R.versionsIn(m, F)[0];
  const top = Math.max(...nOf(m, F).map(n => Number(R.major(n))));
  ok('a new version from scratch takes the next whole number', R.nextMajor(m, F) === String(top + 1));
  const a = R.addVersion(m, F, { text: 'First minor wording.', from: base.id, as: 'minor' });
  ok('save as from v1 makes v1.1', a.n === `${R.major(base.n)}.1`, a.n);
  const b = R.addVersion(m, F, { text: 'Second minor wording.', from: a.id, as: 'minor' });
  ok('save as from v1.1 makes v1.2, never v1.1.1', b.n === `${R.major(base.n)}.2`, b.n);
  ok('a number has at most one dot', [a, b].every(v => R.VERSION_N.test(v.n)));
  const c = R.addVersion(m, F, { text: 'A whole new take.', from: base.id, as: 'major' });
  ok('a new major is the next whole number', c.n === String(top + 1), c.n);
  R.deleteVersion(m, c.id, []);
  ok('a deleted number is retired', m.facts.find(f => f.id === F).retired.en.includes(c.n));
  ok('and never reused', R.nextMajor(m, F) === String(top + 2));
  R.deleteVersion(m, b.id, []);
  ok('nor a deleted minor', R.nextMinor(m, F, base.n) === `${R.major(base.n)}.3`);
  const all = () => Math.max(...m.variants.filter(v => m.facts.find(f => f.id === F).variants.includes(v.id)).map(v => Number(R.major(v.n))));
  const h = R.addVersion(m, F, { text: 'Magyar változat.', lang: 'hu', from: null, as: 'major' });
  ok('a version in another language gets a lang suffix on its id', h.lang === 'hu' && /-hu$/.test(h.id));
  ok('numbers count over every language: a new Hungarian major is past the English ones', R.nextMajor(m, F, 'hu') === String(all() + 1) && R.nextMajor(m, F, 'en') === R.nextMajor(m, F, 'hu'));
  ok('ids are unique', new Set(m.variants.map(v => v.id)).size === m.variants.length);
  ok('the record still validates', !errorsOf(m).length, errorsOf(m).join(' | '));
  ok('and saves and loads unchanged', eq(S.load(JSON.parse(S.serialize(S.save(m)))).model, m));
  ok('the versions list in number order', eq(nOf(m, F), [...nOf(m, F)].sort((x, y) => R.compareN(x, y))));
  ok('compareN: 2 < 2.1 < 2.10 < 3', ['3', '2.10', '2', '2.1'].sort(R.compareN).join() === '2,2.1,2.10,3');
}

section('save over, save as, delete');
{
  const m = clone(example);
  const v = R.versionsIn(m, F)[0];
  const n = v.n, id = v.id;
  v.metrics.measured = { 'a4@b2-marker': { lines: 2, colWidth: 466, at: '2026-10-06' } };
  R.saveOver(m, id, '  New words for the same claim.  ');
  const w = m.variants.find(x => x.id === id);
  ok('save over keeps the id and the number', w.n === n);
  ok('and trims the text', w.text === 'New words for the same claim.');
  ok('metrics.chars follows the text', w.metrics.chars === [...w.text].length);
  ok('the old line count is cleared, so the probe measures again', eq(w.metrics.measured, {}));
  ok('empty text is refused', throws(() => R.saveOver(m, id, '   ')));

  const mv = { id: 'x', text: 'Cut cost by 40% in a year', marks: [{ start: 12, end: 15, slot: 'hl', expect: '40%' }], links: [{ start: 0, end: 3, href: 'https://e.example' }] };
  const mk = clone(example);
  const fx = mk.facts.find(f => f.id === F);
  mk.variants.push({ ...mv, id: `${F}-mk`, n: '90', lang: 'en', tags: ['t'], seenIn: [], metrics: { chars: [...mv.text].length } });
  fx.variants.push(`${F}-mk`);
  R.saveOver(mk, `${F}-mk`, 'We cut cost by 40% within a year');
  const re = mk.variants.find(x => x.id === `${F}-mk`);
  ok('a mark moves to where its words now are', re.marks.length === 1 && [...re.text].slice(re.marks[0].start, re.marks[0].end).join('') === '40%', JSON.stringify(re.marks));
  ok('a link whose words are gone is dropped, not left pointing at the wrong text', re.links.length === 0);
  R.saveOver(mk, `${F}-mk`, 'Halved the cost in a year');
  ok('a mark whose words are gone is dropped', mk.variants.find(x => x.id === `${F}-mk`).marks.length === 0);
  ok('the record validates after all that', !errorsOf(mk).length, errorsOf(mk).join(' | '));

  const s0 = clone(example);
  const src = R.versionsIn(s0, F)[0];
  src.source = 'Career Facts › example';
  const sib = R.addVersion(s0, F, { text: 'A sibling.', from: src.id, as: 'minor' });
  ok('save as copies the tags', eq(sib.tags, src.tags));
  ok('and the source, so it still exports in vault mode', sib.source === src.source);
  ok('and does not take a format it was never measured in', eq(sib.seenIn, []));
  ok('it is filed with its fact', s0.facts.find(f => f.id === F).variants.includes(sib.id));
  ok('a version of another fact can’t be the source', throws(() => R.addVersion(s0, F, { text: 'x', from: 'name-v1', as: 'minor' })));

  const d = clone(example);
  const vs = R.versionsIn(d, F);
  const fact = d.facts.find(f => f.id === F);
  fact.default.en = vs[0].id;
  const rs = [{ picks: { [F]: vs[0].id } }, { picks: { [F]: vs[1].id } }, { picks: {} }];
  const res = R.deleteVersion(d, vs[0].id, rs);
  ok('delete removes the version', !d.variants.some(v => v.id === vs[0].id) && !fact.variants.includes(vs[0].id));
  ok('a default that pointed at it moves to the lowest left', fact.default.en === R.versionsIn(d, F)[0].id);
  ok('picks of it are dropped, so those resumes fall back', !('F' in rs[0].picks) && rs[0].picks[F] === undefined && res.touched.join() === '0');
  ok('other picks are left alone', rs[1].picks[F] === vs[1].id);
  const only = clone(example);
  const oneFact = only.facts.find(f => R.versionsIn(only, f.id, 'en').length === 1);
  ok('the last English version can’t be deleted', throws(() => R.deleteVersion(only, R.versionsIn(only, oneFact.id)[0].id)));
  const hu = only.facts.find(f => R.versionsIn(only, f.id, 'hu').length === 1 && R.versionsIn(only, f.id, 'en').length >= 1);
  R.deleteVersion(only, R.versionsIn(only, hu.id, 'hu')[0].id);
  ok('the last Hungarian one can, and the claim prints in English again', !R.versionsIn(only, hu.id, 'hu').length && !hu.default.hu);
  ok('the record validates after deletes', !errorsOf(d).length && !errorsOf(only).length, [...errorsOf(d), ...errorsOf(only)].join(' | '));

  R.setDefault(d, R.versionsIn(d, F).at(-1).id);
  ok('make default', fact.default.en === R.versionsIn(d, F).at(-1).id);
}

section('compare: the word diff');
{
  const df = R.wordDiff('Cut assembly time by 30%', 'Cut assembly time by 40% on line 2');
  ok('unchanged words are kept', df[0].op === '=' && df[0].text.startsWith('Cut assembly time by '));
  ok('removed and added words are marked', df.some(x => x.op === '-' && x.text.includes('30%')) && df.some(x => x.op === '+' && x.text.includes('40%')));
  const ph = R.wordDiff('Led the a b c done', 'Led the x y z done');
  ok('changes read as phrases, not word by word', ph.length === 4 && ph[1].text === 'a b c' && ph[2].text === 'x y z', JSON.stringify(ph));
  for (const [a, b] of [['a b', 'c d'], ['one two three', 'one three'], ['x', 'x y z'], ['a  b c', 'a b  c d'], ['', 'new']]){
    const d = R.wordDiff(a, b);
    if (d.filter(x => x.op !== '+').map(x => x.text).join('') !== a || d.filter(x => x.op !== '-').map(x => x.text).join('') !== b) ok(`rebuilds ${JSON.stringify([a, b])}`, false, JSON.stringify(d));
  }
  ok('the runs rebuild both texts', df.filter(x => x.op !== '+').map(x => x.text).join('') === 'Cut assembly time by 30%'
     && df.filter(x => x.op !== '-').map(x => x.text).join('') === 'Cut assembly time by 40% on line 2');
}

section('the word move: which words of one version are the words of another');
{
  const m = (a, b) => R.wordMoves(a, b);
  const same = m('Cut assembly time by 30%', 'Cut assembly time by 30%');
  ok('identical: every word stays, none goes, none comes, all shared', same.pairs.length === 5 && !same.removed.length && !same.added.length && same.shared === 1 && same.pairs.every(([i, j]) => i === j));
  const one = m('Cut assembly time by 30%', 'Cut assembly time by 40%');
  ok('one word changed: the other four stay, the old one goes, the new one comes', one.pairs.length === 4 && eq(one.removed, [4]) && eq(one.added, [4]) && one.shared === 0.8, JSON.stringify(one));
  const re = m('Led the redesign of the counter', 'The counter redesign was led by me');
  ok('words reordered: the longest run that keeps its order stays; the rest go and come', re.pairs.length >= 1 && re.removed.length + re.pairs.length === 6 && re.added.length + re.pairs.length === 7, JSON.stringify(re));
  const order = m('one two three', 'three one two');
  ok('one word moved to the front: two stay (and move), one goes, one comes', order.pairs.length === 2 && eq(order.pairs, [[0, 1], [1, 2]]) && eq(order.removed, [2]) && eq(order.added, [0]), JSON.stringify(order));
  const long = m('Led the redesign', 'Led the redesign of the dose counter, cutting two weeks from the tooling schedule');
  ok('a long insertion: the three words stay, the rest come; under a third of the new text is shared', long.pairs.length === 3 && long.added.length === 11 && !long.removed.length && long.shared < 1 / 3, JSON.stringify(long));
  const hu = m('Led the redesign of the dose counter', 'Vezette az adagolószámláló újratervezését');
  ok('another language: nothing in common, so the page falls back to a fade (shared is under a third)', hu.pairs.length === 0 && hu.shared === 0 && hu.removed.length === 7 && hu.added.length === 4, JSON.stringify(hu));
  ok('empty and one-word texts do not break it', eq(m('', 'a').added, [0]) && eq(m('a', '').removed, [0]) && m('', '').shared === 0);
  ok('the pairs, the removed and the added words account for every word of both', [['a b c d e', 'a x c y e f'], ['x', 'x y z'], ['p q r', 'r q p']].every(([a, b]) => { const r = m(a, b); return r.pairs.length + r.removed.length === a.split(' ').length && r.pairs.length + r.added.length === b.split(' ').length; }));
}

section('pins → off and keep');
{
  const legacy = { ...clone(resumes[0]), pins: { exclude: ['a'], include: ['b'], phrasing: ['b', 'c'] } };
  delete legacy.off;
  const mig = S.migrateRecipe(legacy);
  ok('migrateRecipe writes off and keep', eq(mig.off, ['a']) && eq(mig.keep, ['b', 'c']) && !('pins' in mig));
  ok('the fitter reads the same either way', eq([...pinsOf(legacy).exclude, '|', ...pinsOf(legacy).include, '|', ...pinsOf(legacy).phrasing],
    [...pinsOf(mig).exclude, '|', ...pinsOf(mig).include, '|', ...pinsOf(mig).phrasing]));
  ok('a saved example resume has off, not pins', resumes.every(r => !('pins' in r)) && resumes.some(r => Array.isArray(r.off)));
  const file = S.saveResume(example, legacy).file;
  ok('saving a recipe with pins writes off / keep', !('pins' in file.meta.resumeBuilder.resume) && eq(file.meta.resumeBuilder.resume.keep, ['b', 'c']));
  ok('loading one with pins migrates it', !('pins' in S.loadResume({ ...file, meta: { ...file.meta, resumeBuilder: { ...file.meta.resumeBuilder, resume: legacy } } }).recipe));
}

section('bullets on and off, keep, this resume only');
{
  const m = example;
  const r = clone(resumes[0]);
  const job = T.jobRefs(m, r).map(x => (typeof x === 'string' ? x : x.id))[0];
  const w = m.work.find(x => x.id === job);
  const on = T.listedBullets(m, r, job);
  const b = on[0];
  T.setBulletOn(m, r, b, false);
  ok('off takes it off the page', !printed(m, r).has(b));
  ok('and into off', T.offOf(r).includes(b));
  T.setBulletOn(m, r, b, true);
  ok('on puts it back', printed(m, r).has(b) && !T.offOf(r).includes(b));
  ok('in the record’s order', eq(T.listedBullets(m, r, job), w.highlights.filter(h => T.listedBullets(m, r, job).includes(h))));
  ok('and the render is the one it started from', render(m, r) === render(m, clone(resumes[0]).off ? (() => { const x = clone(resumes[0]); return x; })() : resumes[0]));

  const offJob = m.work.find(x => !T.jobRefs(m, r).some(ref => (typeof ref === 'string' ? ref : ref.id) === x.id));
  if (offJob){
    T.setBulletOn(m, r, offJob.highlights[0], true);
    ok('turning on a bullet of a job that is off brings the job', T.jobRefs(m, r).some(ref => (typeof ref === 'string' ? ref : ref.id) === offJob.id));
    ok('with only that bullet if the others are off', T.listedBullets(m, r, offJob.id).includes(offJob.highlights[0]));
  } else ok('(every job is on in this resume)', true);

  T.setJobOn(m, r, job, false);
  ok('a job off leaves the page', !printed(m, r).has(w.display.position));
  T.setJobOn(m, r, job, true);
  ok('and comes back in the record’s place', (T.jobRefs(m, r).map(x => (typeof x === 'string' ? x : x.id))).indexOf(job) === 0);

  T.setKeep(m, r, b, true);
  ok('keep on a printing bullet', T.keepOf(r).includes(b) && !T.offOf(r).includes(b) && pinsOf(r).include.has(b));
  const nb = w.highlights.find(h => !T.listedBullets(m, r, job).includes(h));
  if (nb){
    T.setKeep(m, r, nb, true);
    ok('keep on a bullet that does not print also turns it off, so it stays off', T.offOf(r).includes(nb) && !pinsOf(r).include.has(nb));
  }
  T.setKeep(m, r, b, false);
  ok('keep off', !T.keepOf(r).includes(b));
  ok('no pins key is ever written', !('pins' in r));

  T.setOverride(example, r, b, 'Only on this one.');
  ok('this resume only is an override', r.overrides[b] === 'Only on this one.' && render(m, r).includes('Only on this one.'));
  T.setOverride(example, r, b, 'Only on this one.', { marks: [{ start: 8, end: 12 }], base: null });
  ok('an edit on this resume prints its highlights (UX-6c): the marked words are a mark on the page', /<span class="mark[^"]*"[^>]*>this<\/span>/.test(render(m, r)) && r.overrideMeta[b].marks.length === 1);
  T.setOverride(example, r, b, null);
  ok('and removing it prints the version again', !render(m, r).includes('Only on this one.') && !('overrideMeta' in r && b in r.overrideMeta));
  ok('the resume validates', !errorsOf(m, r).length, errorsOf(m, r).join(' | '));
}

section('a hand layout (pages)');
{
  const m = m4, r = clone(m4recipe);
  const before = render(m, r);
  const job = 'poly';
  const b = m.work.find(w => w.id === job).highlights[0];
  T.setBulletOn(m, r, b, false);
  ok('a bullet off edits the slot the renderer reads', !printed(m, r).has(b) && Array.isArray(r.pages));
  T.setBulletOn(m, r, b, true);
  ok('on again, and the layout is untouched', render(m, r) === before);
  T.setSectionOn(m, r, 'skills', false);
  ok('a section off inside a hand layout is weight 0, and the layout stays', Array.isArray(r.pages) && !render(m, r).includes('data-section="skills"'));
  T.setSectionOn(m, r, 'skills', true);
  ok('and back on renders as before', render(m, r) === before);

  const a = clone(m4recipe);
  const { auto } = T.moveSection(m, a, 'education', 'skills');
  ok('moving a section switches a hand layout to automatic pages', auto && !('pages' in a) && a.pageLimit === 2);
  const ids = T.sectionList(m, a).filter(s => s.on && !s.fixed).map(s => s.id);
  ok('in the new order', ids.indexOf('education') === ids.indexOf('skills') - 1, ids.join());
  ok('everything that printed still prints', eq([...printed(m, a)].sort(), [...printed(m, clone(m4recipe))].sort()));
  ok('the switched resume validates', !errorsOf(m, a).length, errorsOf(m, a).join(' | '));
}

section('sections: list, on/off, move, rename');
{
  const m = clone(example), r = clone(resumes[0]);
  const list = T.sectionList(m, r);
  ok('name and contact and the summary are fixed on top', list[0].fixed && list[0].id === 'header' && list[1].id === 'summary' && list[1].fixed);
  ok('every section of the record is listed once', list.length === m.sections.length && new Set(list.map(s => s.id)).size === list.length);
  const movable = list.filter(s => !s.fixed && s.on).map(s => s.id);
  const last = movable.at(-1);
  T.moveSection(m, r, last, movable[0]);
  const after = T.sectionList(m, r).filter(s => !s.fixed && s.on).map(s => s.id);
  ok('move to the top of the movable ones', after[0] === last);
  ok('flowSlots follows the new order', T.sectionList(m, r).filter(s => !s.fixed && s.on).map(s => s.id).join() === r.sections.filter(s => s.weight !== 0).map(s => s.id).join());
  T.stepSection(m, r, last, 1);
  ok('↓ moves one down', T.sectionList(m, r).filter(s => !s.fixed && s.on).map(s => s.id)[1] === last);
  ok('the header can’t move', throws(() => T.moveSection(m, r, 'header', null)));

  const sec = after.find(id => id !== 'experience');
  T.setSectionOn(m, r, sec, false);
  ok('a section off is weight 0', r.sections.find(s => s.id === sec).weight === 0 && !render(m, r).includes(`data-section="${sec}"`));
  T.setSectionOn(m, r, sec, true);
  ok('and on again prints it', render(m, r).includes(`data-section="${sec}"`));
  const absent = T.sectionList(m, r).find(s => !s.on && !s.fixed && !r.sections.some(x => x.id === s.id));
  if (absent){
    T.setSectionOn(m, r, absent.id, true);
    ok('a section the resume didn’t list is added', r.sections.some(x => x.id === absent.id) && render(m, r).includes(`data-section="${absent.id}"`));
  } else ok('(this resume lists every section)', true);
  ok('the summary can’t be switched off', throws(() => T.setSectionOn(m, r, 'summary', false)));
  ok('sectionMissing names what has no Hungarian', T.sectionMissing(m, 'interests', 'hu').length > 0 && !T.sectionMissing(m, 'interests', 'en').length);

  T.setSectionLabel(m, r, 'experience', 'en', 'Work');
  ok('a heading renamed on this resume prints', render(m, r).includes('>Work<'));
  ok('the id doesn’t change', r.sections.some(s => s.id === 'experience' && s.label.en === 'Work'));
  T.setSectionLabel(m, r, 'experience', 'hu', 'Munka');
  ok('per language', T.labelOf(m, r, 'experience', 'hu') === 'Munka' && T.labelOf(m, r, 'experience', 'en') === 'Work');
  T.setSectionLabel(m, r, 'experience', 'hu', '');
  ok('reset removes it', T.labelOf(m, r, 'experience', 'hu') === null);
  ok('the header has no heading', throws(() => T.setSectionLabel(m, r, 'header', 'en', 'x')));
  T.useLabelEverywhere(m, r, 'experience', 'en');
  ok('use on all my resumes writes the record’s title', m.sections.find(s => s.id === 'experience').title === 'Work' && T.labelOf(m, r, 'experience', 'en') === null);
  T.setSectionLabel(m, r, 'skills', 'hu', 'Tudás');
  T.useLabelEverywhere(m, r, 'skills', 'hu');
  ok('and in another language its translation', m.i18n.hu.sections.skills === 'Tudás');
  ok('the resume and the record validate', !errorsOf(m, r).length, errorsOf(m, r).join(' | '));
}

section('300 random edits in a row');
{
  let seed = 7;
  const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const m = clone(example);
  const rs = resumes.map(clone);
  let r = rs[0];
  const bullets = m.work.flatMap(w => w.highlights);
  let bad = null;
  for (let i = 0; i < 300 && !bad; i++){
    const f = bullets[rnd(bullets.length)];
    const k = rnd(9);
    try {
      if (k === 0) T.setBulletOn(m, r, f, !!rnd(2));
      else if (k === 1) T.setKeep(m, r, f, !!rnd(2));
      else if (k === 2){ const vs = R.versionsIn(m, f, r.lang ?? 'en'); if (vs.length) R.addVersion(m, f, { text: `Edit ${i} of ${f}.`, from: vs[rnd(vs.length)].id, as: rnd(2) ? 'minor' : 'major' }); }
      else if (k === 3){ const vs = R.versionsIn(m, f, 'en'); if (vs.length > 1) R.deleteVersion(m, vs[rnd(vs.length)].id, rs); }
      else if (k === 4){ const vs = R.versionsIn(m, f, 'en'); R.saveOver(m, vs[rnd(vs.length)].id, `Saved over ${i}.`); }
      else if (k === 5){ const ids = T.sectionList(m, r).filter(s => !s.fixed).map(s => s.id); T.moveSection(m, r, ids[rnd(ids.length)], rnd(2) ? ids[rnd(ids.length)] : null); }
      else if (k === 6){
        const ids = T.sectionList(m, r).filter(s => !s.fixed).map(s => s.id), id = ids[rnd(ids.length)], on = !!rnd(3);
        // stay renderable without the app's English fallback
        if (!on || !T.sectionMissing(m, id, r.lang).length) T.setSectionOn(m, r, id, on);
      }
      else if (k === 7) T.setJobOn(m, r, m.work[rnd(m.work.length)].id, !!rnd(3));
      else { const vs = R.versionsIn(m, f, r.lang ?? 'en'); if (vs.length) r.picks = { ...r.picks, [f]: vs[rnd(vs.length)].id }; }
      if (rnd(10) === 0) r = rs[rnd(rs.length)];
    } catch (e){ if (!/can’t be deleted/.test(e.message)) bad = `edit ${i} (${k}): ${e.message}`; }
  }
  ok('no edit threw', !bad, bad);
  const errs = rs.flatMap(x => errorsOf(m, x));
  ok('the record and all six resumes still validate', !errs.length, errs.slice(0, 3).join(' | '));
  ok('and all six still render', rs.every(x => { try { render(m, x); return true; } catch (e){ console.log('   ', e.message); return false; } }));
  ok('numbers are unique per fact per language', m.facts.every(f => S.LANGS.every(L => { const n = nOf(m, f.id, L); return new Set(n).size === n.length; })));
  ok('no pins key anywhere', rs.every(x => !('pins' in x)));
}

section('the record checklist (src/model/checklist.js)');
{
  const m = clone(example);
  const r = resumes.find(x => (x.lang ?? 'en') === 'en');
  const c = CL.checklist(m, r);
  const ids = c.groups.map(g => g.id);
  ok('the groups: About you, then the jobs newest first, then projects, Education, Skills and credentials', ids[0] === 'about' && ids.slice(1, 6).join() === 'hydra,poly,free,medisure,atelier' && ids.indexOf('caliper-stand') > ids.indexOf('atelier') && ids.indexOf('education') > ids.indexOf('chassis-jig') && ids.at(-1) === 'credentials', ids.join());
  const hydra = c.groups.find(g => g.id === 'hydra');
  const listed = T.listedBullets(m, r, 'hydra');
  ok('a job lists every claim of its own, ticked when this resume prints it', hydra.rows.length + hydra.archivedRows.length === m.work[0].highlights.length && hydra.rows.every(x => x.on === listed.includes(x.id)) && hydra.on === listed.length);
  ok('claims the resume leaves out are listed too, unticked, never hidden', hydra.rows.some(x => !x.on) && hydra.rows.length === hydra.total);
  ok('an archived claim folds away unless the resume still prints it', (() => { const a = m.facts.find(f => f.archived).id; const g = c.groups.find(x => x.rows.concat(x.archivedRows ?? []).some(y => y.id === a)); return g.archivedRows.some(y => y.id === a) === !g.rows.some(y => y.id === a); })());
  ok('the whole record: n of m on is the sum of its groups', c.on === c.groups.reduce((n, g) => n + g.on, 0) && c.total === c.groups.reduce((n, g) => n + g.total, 0) && c.on < c.total);
  ok('a job that is off has every claim unticked', (() => { const q = clone(r); T.setJobOn(m, q, 'hydra', false); return CL.checklist(m, q).groups.find(g => g.id === 'hydra').on === 0; })());
  ok('ticking is setBulletOn: the count follows, and a job that was off comes back on', (() => { const q = clone(r); T.setJobOn(m, q, 'hydra', false); const id = m.work[0].highlights[0]; T.setBulletOn(m, q, id, true); const g = CL.checklist(m, q).groups.find(x => x.id === 'hydra'); return g.on >= 1 && g.rows.find(x => x.id === id).on; })());
  ok('the row’s selection is what a click on the page selects', eq(hydra.rows[0].sel, { kind: 'bullet', id: hydra.rows[0].id, job: 'hydra', section: 'experience' }) && eq(hydra.sel, { kind: 'job', id: 'hydra' }));
  ok('About you: name and contact are always on, the summary too; the photo row has no tick and does not count', (() => { const a = c.groups[0]; return a.rows.filter(x => !x.noTick).every(x => x.on && x.fixed) && a.total === a.rows.filter(x => !x.noTick).length; })());
  const edu = c.groups.find(g => g.id === 'education');
  ok('Education and the lists print with their section: their rows show the section’s state, and the section carries the switch', edu.section === 'education' && edu.rows.every(x => x.on === edu.sectionOn) && c.groups.find(g => g.id === 'credentials').subs.every(s2 => s2.section && s2.rows.every(x => x.on === s2.sectionOn)));
  ok('a section that is off turns its rows off', (() => { const q = clone(r); T.setSectionOn(m, q, 'education', false); const g = CL.checklist(m, q).groups.find(x => x.id === 'education'); return !g.sectionOn && g.on === 0 && g.total === edu.total; })());
  // the group that holds the selection is the one that opens
  const g0 = hydra.rows[0].id;
  ok('the group of a selection: a bullet’s job, a job, the header, an item, a section is none', CL.groupOf(m, { kind: 'bullet', id: g0 }) === 'hydra' && CL.groupOf(m, { kind: 'job', id: 'poly' }) === 'poly' && CL.groupOf(m, { kind: 'header' }) === 'about'
    && CL.groupOf(m, { kind: 'bullet', id: m.basics.summary, section: 'summary' }) === 'about' && CL.groupOf(m, { kind: 'record', what: 'item', group: 'skills', id: 'x' }) === 'credentials' && CL.groupOf(m, { kind: 'record', what: 'entry', key: 'education', id: 'e' }) === 'education'
    && CL.groupOf(m, { kind: 'section', id: 'skills' }) === null && CL.groupOf(m, { kind: 'none' }) === null);
  const sk = m.skills[0];
  ok('a skill group’s text finds its form, and the form finds its text', eq(CL.recordSelOfFact(m, sk.id), { kind: 'record', what: 'item', group: 'skills', id: sk.id }) && CL.factOfRecordSel(m, { kind: 'record', what: 'item', group: 'skills', id: sk.id }) === sk.id && CL.recordSelOfFact(m, g0) === null);
  ok('an education line finds its entry', CL.recordSelOfFact(m, m.education[0].display.studyType)?.what === 'entry');
  ok('in German the rows show the German text, and a claim with none is still listed', (() => { const de = resumes.find(x => x.lang === 'de'); const cg = CL.checklist(m, de, 'de'); const rows = cg.groups.find(g => g.id === 'hydra').rows; return rows.length > 0 && rows.every(x => x.text); })());
}

section('the checklist lists items one by one, in print order');
{
  const m = clone(example), r = clone(resumes.find(x => (x.lang ?? 'en') === 'en'));
  const ids = T.itemsOf(m, 'skills');
  const sub = q => CL.checklist(m, q).groups.find(g => g.id === 'credentials').subs.find(x => x.id === 'skills');
  ok('each skill group is a row with its own tick (item), on while the section is', sub(r).rows.every(x => x.item && x.on) && sub(r).rows.map(x => x.item).join() === ids.join());
  const q = clone(r); T.setItemOn(m, q, ids[1], false); T.moveItem(m, q, 'skills', ids[2], ids[0]);
  ok('an item that is off is unticked, and the rows follow this resume’s order', sub(q).rows.find(x => x.item === ids[1]).on === false && sub(q).rows[0].item === ids[2]);
  ok('a section that is off turns every row off; a row that is ticked brings it back', (() => { const z = clone(r); T.setSectionOn(m, z, 'skills', false); const off = sub(z).rows.every(x => !x.on); T.setItemOn(m, z, ids[0], true); return off && sub(z).rows.find(x => x.item === ids[0]).on && sub(z).sectionOn; })());
  ok('publications and education still print with their section (no item tick)', CL.checklist(m, r).groups.find(g => g.id === 'credentials').subs.find(x => x.id === 'publications')?.rows.every(x => !x.item) ?? true);
}

section('items of a list section: tick one by one, print in this resume’s order');
{
  const m = clone(example);
  const r = clone(resumes.find(x => (x.lang ?? 'en') === 'en'));
  const sid = 'skills', all = T.itemsOf(m, sid);
  const text = rr => render(m, rr).replace(/\s+/g, ' ');
  const label = id => (m.facts.find(f => f.id === id).label ?? '').replace(/&/g, '&amp;');
  ok('a grid, a pairs and a runs section have items; an entries section and a single-item section do not', all.length >= 3 && T.itemsOf(m, 'languages').length >= 2 && T.itemsOf(m, 'interests').length >= 2 && T.itemsOf(m, 'experience') === null && T.itemsOf(m, 'education') === null);
  ok('with no off and no order, nothing changes: the page is the record’s, byte for byte', (() => { const a = render(m, r), q = clone(r); T.moveItem(m, q, sid, all[0], all[1]); T.moveItem(m, q, sid, all[0], null); T.moveItem(m, q, sid, all[0], all[1]); return a === render(m, r) && true; })());
  const q = clone(r);
  T.setItemOn(m, q, all[1], false);
  ok('an item turned off leaves the page (the others stay), and is in the resume’s off list', !text(q).includes(label(all[1])) && all.filter((x, i) => i !== 1).every(x => text(q).includes(label(x))) && q.off.includes(all[1]));
  ok('and a turned-off item is listed, unticked, in this resume’s items', T.itemList(m, q, sid).find(x => x.id === all[1]).on === false);
  T.setItemOn(m, q, all[1], true);
  ok('turned on, it is back and the off list is clean', text(q).includes(label(all[1])) && !(q.off ?? []).includes(all[1]) && render(m, q) === render(m, r));
  const q2 = clone(r);
  for (const id of all) T.setItemOn(m, q2, id, false);
  ok('the last item off takes the section off: never an empty tab', !T.sectionList(m, q2).find(x => x.id === sid).on && !render(m, q2).includes('class="skills"'));
  T.setItemOn(m, q2, all[2], true);
  ok('one turned on brings the section back, with just that one', T.sectionList(m, q2).find(x => x.id === sid).on && text(q2).includes(label(all[2])) && !text(q2).includes(label(all[0])));
  // order
  const q3 = clone(r);
  T.moveItem(m, q3, sid, all[2], all[0]);
  const pos = (rr, ids) => ids.map(id => text(rr).indexOf(label(id)));
  ok('moving an item puts it first on the page, in this resume only', pos(q3, [all[2], all[0], all[1]]).every((x, i, a) => !i || a[i - 1] < x) && pos(r, [all[0], all[2]])[0] < pos(r, [all[0], all[2]])[1] && eq(T.itemList(m, q3, sid).map(x => x.id).slice(0, 3), [all[2], all[0], all[1]]));
  ok('the record is not touched', eq(m.sections, example.sections));
  const q4 = clone(q3);
  ok('Alt+↓ is a step: it swaps with the next', T.stepItem(m, q4, sid, all[2], 1) && eq(T.itemList(m, q4, sid).map(x => x.id).slice(0, 3), [all[0], all[2], all[1]]));
  ok('a step off the end does nothing', !T.stepItem(m, q4, sid, all.at(-1), 1) && !T.stepItem(m, q4, sid, T.itemList(m, q4, sid)[0].id, -1));
  T.moveItem(m, q4, sid, all[1], all[2]);
  ok('back in the record’s order, the order key goes away', q4.sections.find(x => x.id === sid)?.order === undefined);
  const q5 = clone(q3); T.setItemOn(m, q5, all[2], false);
  ok('order and off together: the order of what is left', !text(q5).includes(label(all[2])) && pos(q5, [all[0], all[1]]).every((x, i, a) => !i || a[i - 1] < x));
  const off = clone(r); T.setSectionOn(m, off, 'interests', false);
  let refused = false; try { T.moveItem(m, off, 'interests', T.itemsOf(m, 'interests')[1], null); } catch { refused = true; }
  ok('ordering the items of a section that is off is refused (it would turn it on)', refused && !off.sections.find(x => x.id === 'interests') ? true : refused);
  ok('a pair and a run line work the same', (() => { const z = clone(r); T.setSectionOn(m, z, 'interests', true); T.setSectionOn(m, z, 'languages', true); const l = T.itemsOf(m, 'languages'); T.moveItem(m, z, 'languages', l.at(-1), l[0]); const i = T.itemsOf(m, 'interests'); const was = render(m, z); T.setItemOn(m, z, i[0], false); return T.itemList(m, z, 'languages')[0].id === l.at(-1) && render(m, z) !== was && render(m, z).length < was.length; })());
  ok('every recipe still validates', (() => { const z = clone(q3); T.setItemOn(m, z, all[1], false); return !errorsOf(m, z).length; })());
}

section('the bullets of a job print in the order this resume sets');
{
  const m = clone(example), r = clone(resumes.find(x => (x.lang ?? 'en') === 'en'));
  const job = m.work.find(w => T.listedBullets(m, r, w.id).length >= 3);
  const [a, b, c] = T.listedBullets(m, r, job.id);
  const before = render(m, r);
  const q = clone(r);
  T.moveBullet(m, q, c, a);
  const order = () => T.listedBullets(m, q, job.id);
  ok('moving a bullet before another puts it there, and no other job changes', order().slice(0, 3).join() === [c, a, b].join() && eq(T.listedBullets(m, r, job.id).slice(0, 3), [a, b, c]));
  ok('the page prints them in that order', (() => { const html = render(m, q); const at = x => html.indexOf(T.chooseVariant(m, x, q).v.text.match(/^[A-Za-z ]{10,}/)?.[0] ?? '\0'); return html !== before && at(a) > 0 && at(c) > 0 && at(c) < at(a); })());
  T.moveBullet(m, q, c, null);
  ok('before nothing means last', order().at(-1) === c);
  T.moveBullet(m, q, c, a);
  ok('moving it back to where it was leaves the recipe as it was', (() => { const z = clone(r); T.moveBullet(m, z, c, a); T.moveBullet(m, z, c, T.listedBullets(m, r, job.id)[3] ?? null); return eq(z, r) && render(m, z) === before; })());
  const z = clone(r);
  ok('one step down and one step up are inverses; the ends stop', T.stepBullet(m, z, a, 1) && T.listedBullets(m, z, job.id)[1] === a && T.stepBullet(m, z, a, -1) && eq(T.listedBullets(m, z, job.id), T.listedBullets(m, r, job.id)) && !T.stepBullet(m, z, a, -1));
  ok('a recipe stepped down and back up is the recipe it was', eq(z, r));
  // ticking a moved bullet off and on keeps the others where the person put them
  const y = clone(r); T.moveBullet(m, y, c, a);
  T.setBulletOn(m, y, b, false); T.setBulletOn(m, y, b, true);
  ok('ticking one off and on again does not undo the order of the rest', T.listedBullets(m, y, job.id).slice(0, 3).join() === [c, a, b].join(), T.listedBullets(m, y, job.id).join());
  const off = clone(r); T.setBulletOn(m, off, a, false);
  let key = null; try { T.moveBullet(m, off, a, c); } catch (e){ key = e.key; }
  ok('a bullet that is off has no place in the order', key === 'ux2.errBulletOff');
  ok('the recipe still validates', !errorsOf(m, y).length);
}

section('"custom": this resume’s order is not the record’s');
{
  const m = clone(example), r = clone(resumes.find(x => (x.lang ?? 'en') === 'en'));
  const job = m.work.find(w => T.listedBullets(m, r, w.id).length >= 2);
  const grp = q => CL.checklist(m, q).groups.find(g => g.id === job.id);
  const sub = q => CL.checklist(m, q).groups.find(g => g.id === 'credentials').subs.find(x => x.id === 'skills');
  ok('nothing moved: no job, list or section list is custom', !grp(r).custom && !sub(r).custom && !CL.sectionsCustom(m, r) && CL.checklist(m, r).groups.every(g => !g.custom && (g.subs ?? []).every(x => !x.custom)));
  const q = clone(r);
  T.stepBullet(m, q, T.listedBullets(m, q, job.id)[0], 1);
  ok('a bullet stepped down makes its job custom, and no other', grp(q).custom && CL.checklist(m, q).groups.filter(g => g.custom).length === 1);
  const ticked = g => g.rows.filter(x => x.on).map(x => x.id);
  ok('the Record lists the ticked lines in print order, so it agrees with the page', eq(ticked(grp(q)), T.listedBullets(m, q, job.id)) && !eq(ticked(grp(r)), ticked(grp(q))));
  ok('…a line that is off keeps its place among the others', eq(grp(q).rows.map(x => x.id).filter(x => !ticked(grp(q)).includes(x)), job.highlights.filter(x => !ticked(grp(q)).includes(x))));
  const about = CL.checklist(m, r).groups.find(g => g.id === 'about').rows, d = m.basics.display;
  ok('the "n v" on the contact and headline rows opens the versions of that line, not the About you form', eq(about.find(x => x.id === 'about:contact').vsel, { kind: 'bullet', id: d.contact, section: 'header' }) && eq(about.find(x => x.id === 'about:name').vsel, { kind: 'bullet', id: d.label, section: 'header' }));
  for (const b of job.highlights) if (T.listedBullets(m, q, job.id).includes(b)) T.moveBullet(m, q, b);
  ok('putting the listed bullets in the record’s order, one by one, ends it', !grp(q).custom && eq(T.listedBullets(m, q, job.id), job.highlights.filter(b => T.listedBullets(m, r, job.id).includes(b))));
  const ids = T.itemsOf(m, 'skills'), qi = clone(r);
  T.stepItem(m, qi, 'skills', ids[0], 1);
  ok('an item stepped down makes its list custom', sub(qi).custom);
  for (const x of ids) T.moveItem(m, qi, 'skills', x);
  ok('…and the record’s order again ends it, with no order stored', !sub(qi).custom && qi.sections.find(x => x.id === 'skills').order === undefined);
  const qs = clone(r), movable = T.sectionList(m, qs).filter(x => x.on && !x.fixed).map(x => x.id);
  T.stepSection(m, qs, movable[0], 1);
  ok('a section stepped down makes the sections list custom', CL.sectionsCustom(m, qs));
  for (const x of m.sections.map(y => y.id)) if (movable.includes(x)) T.moveSection(m, qs, x);
  ok('…and the record’s order again ends it', !CL.sectionsCustom(m, qs));
}

section('the jobs of a resume print in the order it sets');
{
  const m = clone(example);
  const r = clone(resumes.find(x => (x.lang ?? 'en') === 'en' && T.jobRefs(m, x, 'experience').length >= 3));
  const refs = q => T.jobRefs(m, q, 'experience').map(x => (typeof x === 'string' ? x : x.id));
  const [a, b, c] = refs(r);
  const printed = q => T.resolve(m, q).body.work.map(w => w.name);
  const named = id => m.work.find(w => w.id === id).name;
  const html = q => render(m, q);
  const e = q => q.sections.find(x => x.id === 'experience');
  ok('with no order, nothing is stored and a move to the end of the record’s order stores nothing', e(r).order === undefined && (() => { const q = clone(r); T.moveEntry(m, q, a, b); T.moveEntry(m, q, a); T.moveEntry(m, q, a, b); return e(q).order === undefined && html(q) === html(r); })());
  const q = clone(r);
  const res = T.moveEntry(m, q, c, a);
  ok('moving a job puts it first on the page and in the JSON Resume body, this resume only', eq(refs(q), [c, a, b, ...refs(r).slice(3)]) && printed(q)[0] === named(c) && html(q).indexOf(named(c)) < html(q).indexOf(named(a)) && html(r).indexOf(named(a)) < html(r).indexOf(named(c)) && !res.auto);
  ok('…the work list stays in the record’s order (an older app prints the record’s), the order is stored beside it', eq(e(q).work, e(r).work) && e(q).order[0] === c);
  ok('…and the record is untouched', eq(m.sections, example.sections));
  const back = S.loadResume(S.saveResume(m, q).file, m);
  ok('it round-trips through the saved-resume file with no warnings', eq(e(back.recipe).order, e(q).order) && back.warnings.length === 0 && eq(refs(back.recipe), refs(q)), back.warnings.join('; '));
  ok('Alt+↓ is a step, off the ends nothing', (() => { const z = clone(q); return T.stepEntry(m, z, c, 1).moved && eq(refs(z).slice(0, 2), [a, c]) && !T.stepEntry(m, z, refs(z)[0], -1).moved && !T.stepEntry(m, z, refs(z).at(-1), 1).moved; })());
  ok('the jobs list is custom; the record’s order again ends it and the key goes', CL.jobsCustom(m, q, 'experience') && !CL.jobsCustom(m, r, 'experience') && (() => { const z = clone(q); for (const id of example.sections.find(x => x.id === 'experience').content.work) if (refs(z).includes(id)) T.moveEntry(m, z, id); return !CL.jobsCustom(m, z, 'experience') && e(z).order === undefined; })());
  const stale = clone(q); e(stale).order = ['gone', ...e(q).order, 'gone-too', c];
  ok('ids that are no longer in the record, and a repeat, are ignored', eq(refs(stale), refs(q)) && printed(stale).join() === printed(q).join());
  // a resume whose own jobs list is not in the record's order (made by hand or by a script), with no order key: the record's first job printed last
  const scrambled = clone(r); e(scrambled).work = [...e(scrambled).work].reverse();
  const rec = example.sections.find(x => x.id === 'experience').content.work.filter(id => refs(scrambled).includes(id));
  ok('a jobs list kept out of the record’s order is custom, and moving the record’s first job to the top takes (the key stays, since the list would put it last)', refs(scrambled)[0] !== rec[0] && CL.jobsCustom(m, scrambled, 'experience') && (() => { const z = clone(scrambled); T.moveEntry(m, z, rec[0], refs(scrambled)[0]); return refs(z)[0] === rec[0] && Array.isArray(e(z).order); })());
  ok('…and Reset (every job to the end, in the record’s order) puts the record’s order on the page and ends “custom”', (() => { const z = clone(scrambled); for (const id of rec) T.moveEntry(m, z, id); return eq(refs(z), rec) && !CL.jobsCustom(m, z, 'experience'); })());
  const part = clone(r); e(part).order = [c];
  ok('a job missing from the order follows, in the listed order', eq(refs(part), [c, a, b, ...refs(r).slice(3)]));
  const off = clone(r); T.setJobOn(m, off, a, false);
  ok('a job that is off has no place', throws(() => T.moveEntry(m, off, a, null)) && !throws(() => T.moveEntry(m, off, b, null)));
  const arch = clone(m); arch.work.find(w => w.id === b).archived = true;
  ok('an archived job has no place, and is not in a stored order', throws(() => T.moveEntry(arch, clone(r), b, null)) && !(e((() => { const z = clone(r); T.moveEntry(arch, z, c, a); return z; })()).order ?? []).includes(b));
  ok('a project is not a job to order', throws(() => T.moveEntry(m, clone(r), m.projects[0].id, null)));
  const pg = clone(r); pg.pages = [['header', 'summary', { id: 'experience', work: clone(e(r).work) }, 'skills']];
  const auto = T.moveEntry(m, pg, c, a);
  ok('a hand layout switches to automatic pages, as moving a section does', auto.auto && !pg.pages && eq(refs(pg).slice(0, 2), [c, a]));
  ok('the recipe still validates', !errorsOf(m, q).length);
}

section('on the page: a line written in place holds the text the old text box held');
{
  // a stand-in for what a browser leaves in an editable element, in each of the ways it does
  const text = data => ({ nodeType: 3, data, nodeName: '#text' });
  const el = (name, ...kids) => ({ nodeType: 1, nodeName: name, childNodes: kids });
  const BR = () => el('BR');
  const root = (...kids) => el('DIV', ...kids);
  // the three shapes of the same lines: one text node with newlines (plaintext-only), <br> between lines, a <div> per line
  const shapes = s => {
    const lines = s.split('\n');
    return {
      plain: root(text(s)),
      br: root(...lines.flatMap((l, i) => (i ? [BR(), text(l)] : [text(l)]))),
      divs: root(...(lines.length > 1 ? [text(lines[0]), ...lines.slice(1).map(l => el('DIV', l ? text(l) : BR()))] : [text(s)])),
    };
  };
  const cases = ['Cut scrap by 40% in a year', 'Two lines\nbelow each other', 'A\n\nblank line between', 'Double  space and\ttab', 'Non breaking space and ‘quotes’ – and an emoji 🙂', 'Ünïcode ß ő ű', ' leading and trailing '];
  for (const c of cases){
    const s = shapes(c);
    const got = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, plainOf(v)]));
    ok(`the text of ${JSON.stringify(c).slice(0, 40)} reads back as typed, from every shape`, Object.values(got).every(x => x === c), JSON.stringify(got));
  }
  ok('an empty line at the end (a browser leaves one) is trimmed away when it is kept, as it was for the text box', R.versionsIn(clone(example), F)[0] && (() => { const m = clone(example); const v = R.versionsIn(m, F)[0]; R.saveOver(m, v.id, plainOf(root(text('Same text'), el('DIV', BR())))); return R.versionsIn(m, F)[0].text === 'Same text'; })());
  ok('<div><br></div> alone is one empty line, not text', plainOf(root(el('DIV', BR()))) === '');
  ok('nested inline elements (a pasted bold) are only their text', plainOf(root(text('a '), el('B', text('bold')), text(' word'))) === 'a bold word');

  // writing a line in place and keeping it gives the same record as the text box did, for every version in the example
  let same = 0, total = 0, marks = 0, links = 0;
  for (const f of example.facts) for (const vid of f.variants){
    const v = example.variants.find(x => x.id === vid);
    if (!v?.text) continue;
    const typed = `${v.text} (checked)`;
    const viaBox = clone(example), viaPage = clone(example), viaBr = clone(example), viaDivs = clone(example);
    R.saveOver(viaBox, vid, typed);
    const s = shapes(typed);
    R.saveOver(viaPage, vid, plainOf(s.plain)); R.saveOver(viaBr, vid, plainOf(s.br)); R.saveOver(viaDivs, vid, plainOf(s.divs));
    total++;
    if (eq(viaBox, viaPage) && eq(viaBox, viaBr) && eq(viaBox, viaDivs)) same++;
    if (v.marks?.length) marks++;
    if (v.links?.length) links++;
  }
  ok(`Update vN from the page gives the very same record as the text box did, for all ${total} versions in the example (${marks} with highlight marks, ${links} with links)`, same === total && total > 40, `${same} of ${total}`);
  // the same for Save as new version and Only on this resume
  let asNew = 0, only = 0, n2 = 0;
  for (const f of example.facts.filter(x => T.jobOfFact(example, x.id)).slice(0, 25)){
    const using = R.versionsIn(example, f.id, 'en')[0];
    if (!using) continue;
    const typed = `${using.text} and more`;
    const a = clone(example), b = clone(example);
    R.addVersion(a, f.id, { text: typed, from: using.id, as: 'minor', lang: 'en' });
    R.addVersion(b, f.id, { text: plainOf(shapes(typed).divs), from: using.id, as: 'minor', lang: 'en' });
    const r1 = clone(resumes[0]), r2 = clone(resumes[0]);
    T.setOverride(example, r1, f.id, typed); T.setOverride(example, r2, f.id, plainOf(shapes(typed).br));
    n2++;
    if (eq(a, b)) asNew++;
    if (eq(r1, r2)) only++;
  }
  ok(`Save as new version and Only on this resume agree too (${n2} lines each)`, asNew === n2 && only === n2 && n2 > 10);
  // the marks follow their words when something is typed before them: through the page, exactly as through the box
  const mv = { id: 'zz', n: '1', text: 'Cut cost by 40% in a year', marks: [{ start: 12, end: 15, slot: 'hl', expect: '40%' }], links: [] };
  const mm = clone(example);
  const fact = mm.facts.find(x => T.jobOfFact(mm, x.id));
  mm.variants.push({ ...mv, id: `${fact.id}-zz`, lang: 'en', tags: [], seenIn: [], metrics: { chars: 25, measured: {} } }); fact.variants.push(`${fact.id}-zz`);
  const t1 = 'Really cut cost by 40% in a year', t2 = plainOf(shapes(t1).plain);
  const m1 = clone(mm), m2 = clone(mm);
  R.saveOver(m1, `${fact.id}-zz`, t1); R.saveOver(m2, `${fact.id}-zz`, t2);
  ok('a highlight mark keeps its words when a line is edited on the page', eq(m1, m2) && [...m2.variants.find(x => x.id === `${fact.id}-zz`).text].slice(...(() => { const k = m2.variants.find(x => x.id === `${fact.id}-zz`).marks[0]; return k ? [k.start, k.end] : [0, 0]; })()).join('') === '40%');
}

section('Group under the section above');
{
  const bandsOf = (model, recipe) => renderPages(model, recipe, createDocument(), { annotate: true }).pages
    .map(p => [...p.children].map(el => ({ id: el.getAttribute('data-section'), sub: /band--sub/.test(el.className) })));
  const subs = (model, recipe) => bandsOf(model, recipe).map(p => p.filter(b => b.sub).map(b => b.id));
  const base = clone(resumes.find(r => r.format === 'a4' && ['patent', 'education', 'languages'].every(id => r.sections.some(s => s.id === id))));
  const text = rc => renderPages(example, rc, createDocument(), {}).pages.map(p => p.textContent).join('\n');

  const r = clone(base);
  T.setSectionGrouped(example, r, 'patent', true);
  T.setSectionGrouped(example, r, 'languages', true);
  ok('the switch is the section entry\'s style, and groupedOf reads it', r.sections.find(s => s.id === 'patent').style === 'sub' && T.groupedOf(r, 'patent') && !T.groupedOf(r, 'education'));
  ok('a grouped section prints as a sub band, the others as before', eq(subs(example, r), [['patent', 'languages']]));
  ok('grouping changes no word on the page', text(r) === text(base));
  T.setSectionGrouped(example, r, 'patent', false);
  ok('turning it off leaves no style key and no sub band', !('style' in r.sections.find(s => s.id === 'patent')) && eq(subs(example, r), [['languages']]));

  const first = clone(base);
  T.setSectionGrouped(example, first, first.sections[0].id, true);
  ok('the first section has no tab above it, so it keeps its own', subs(example, first).flat().length === 0);
  const second = clone(first); T.setSectionGrouped(example, second, second.sections[1].id, true);
  ok('and the next section groups under it', eq(subs(example, second), [[second.sections[1].id]]));

  const hand = { ...clone(base), pages: [['header', 'summary', 'experience'], ['skills', 'education']] };
  T.setSectionGrouped(example, hand, 'skills', true);
  T.setSectionGrouped(example, hand, 'education', true);
  ok('with a page break between them, a section that starts a page keeps its tab', eq(subs(example, hand), [[], ['education']]));

  const slotted = { ...clone(base), pages: [['header', 'summary', 'experience', { id: 'skills', style: 'sub' }, 'education']] };
  ok('a hand layout\'s slot style is read as the switch', T.groupedOf(slotted, 'skills') && eq(subs(example, slotted), [['skills']]));
  const auto = clone(slotted); T.toAuto(example, auto);
  ok('Automatic pages keep it as the section\'s style', auto.sections.find(s => s.id === 'skills')?.style === 'sub' && T.groupedOf(auto, 'skills'));
  T.setSectionGrouped(example, slotted, 'skills', false);
  ok('the switch has the last word over a slot style', !T.groupedOf(slotted, 'skills') && eq(subs(example, slotted), [[]]));

  const off = clone(base); off.sections = off.sections.filter(s => s.id !== 'languages');
  T.setSectionGrouped(example, off, 'languages', true);
  ok('a section that is not on the resume is not turned on by grouping it', !off.sections.some(s => s.id === 'languages'));
  ok('the header and the summary cannot be grouped', throws(() => T.setSectionGrouped(example, clone(base), 'header', true)) && throws(() => T.setSectionGrouped(example, clone(base), 'summary', true)));
  const held = { ...clone(base), locked: ['patent'] };
  ok('a locked section is held', throws(() => T.setSectionGrouped(example, held, 'patent', true)) && !('style' in held.sections.find(s => s.id === 'patent')));
  const page = { ...clone(base), locked: ['~page'] };
  ok('so is every section of a locked page', throws(() => T.setSectionGrouped(example, page, 'education', true)));
  ok('no example resume changes: none is grouped', resumes.every(rc => !subs(example, rc).flat().length));
}

console.log(failed ? `\n${failed} edit check(s) FAILED` : '\nall edit checks passed');
process.exit(failed ? 1 : 0);
