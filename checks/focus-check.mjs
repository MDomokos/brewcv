#!/usr/bin/env node
// node checks/focus-check.mjs
// Tags and job-type focus (src/model/focus.js): planTag says what applyTag does, and applyTag never
// touches a Keep bullet or empties a job that has no tagged bullet.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../src/model/schema.js';
import * as F from '../src/model/focus.js';
import * as T from '../src/model/resume.js';
import { validate } from './lib/validate.mjs';
import { createDocument } from '../scripts/lib/dom.mjs';
import { renderPages } from '../src/render.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const clone = x => structuredClone(x);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);

const model = S.load(read('data/example.json')).model;
const names = read('data/example-resumes/index.json');
const resumes = names.map(n => S.loadResume(read(`data/example-resumes/${n}`), model).recipe);
const en = resumes.filter(r => (r.lang ?? 'en') === 'en');
const on = (m, r) => new Set(T.jobRefs(m, r).flatMap(ref => T.listedBullets(m, r, typeof ref === 'string' ? ref : ref.id)));

section('tags');
{
  const tags = F.allTags(model, 'en');
  ok('job types come first', tags.slice(0, model.jobTypes.length).every(t => t.jobType));
  ok('then by how many versions carry them', tags.filter(t => !t.jobType).every((t, i, a) => i === 0 || a[i - 1].n >= t.n));
  const jt = model.jobTypes[0];
  const hits = F.tagHits(model, jt, 'en');
  ok(`tagHits finds the facts with a version tagged "${jt}"`, hits.size > 0 && [...hits].every(f => F.taggedVersion(model, f, jt, 'en')));
  ok('a tag in another language is not an English hit', [...F.tagHits(model, jt, 'hu')].every(f => F.taggedVersion(model, f, jt, 'hu')));
}

section('plan and apply');
for (const jt of model.jobTypes){
  for (const base of en){
    const r = clone(base);
    const plan = F.planTag(model, r, jt);
    const before = on(model, r);
    const applied = F.applyTag(model, r, jt);
    const after = on(model, r);
    const turnedOn = [...after].filter(x => !before.has(x)).length;
    const turnedOff = [...before].filter(x => !after.has(x)).length;
    const name = `${jt} on ${base.company}`;
    if (!(plan.on === turnedOn && plan.off === turnedOff && applied.on === plan.on)){ ok(`${name}: the plan says what apply does`, false, JSON.stringify({ plan, turnedOn, turnedOff })); continue; }
    // focus works on the jobs' bullets (a project's are not part of it), and leaves an archived claim as the resume has it
    const tagged = [...after].filter(f => model.work.some(w => w.highlights.includes(f)) && !model.facts.find(x => x.id === f)?.archived && F.taggedVersion(model, f, jt, 'en'));
    if (!tagged.every(f => r.picks[f] === F.taggedVersion(model, f, jt, 'en').id)){ ok(`${name}: tagged bullets use their tagged version`, false); continue; }
    const v = validate(S.save(model), r);
    if (v.errors.length){ ok(`${name}: validates`, false, v.errors[0]); continue; }
    try { renderPages(model, r, createDocument()); } catch (e){ ok(`${name}: renders`, false, e.message); continue; }
    const again = F.planTag(model, r, jt);
    if (again.on + again.off + again.sw){ ok(`${name}: applying twice changes nothing`, false, JSON.stringify(again)); continue; }
  }
}
ok('every job type on every English example: plan = apply, tagged versions picked, valid, renders, idempotent', true);

section('the rules');
{
  let jt, r, keepMe;
  for (const t of model.jobTypes) for (const b of en){
    const k = [...on(model, b)].find(f => { const c = clone(b); F.applyTag(model, c, t); return !on(model, c).has(f); });
    if (k && !keepMe){ jt = t; r = clone(b); keepMe = k; }
  }
  T.setKeep(model, r, keepMe, true);
  F.applyTag(model, r, jt);
  ok(`a Keep bullet with no tagged version stays on (${keepMe}, ${jt})`, on(model, r).has(keepMe));
  const jobs = T.jobRefs(model, r).map(x => (typeof x === 'string' ? x : x.id));
  const empty = jobs.filter(j => !T.listedBullets(model, r, j).length);
  ok('no job is left with no bullets', empty.length === 0, empty.join());
  const noHit = model.work.find(w => jobs.includes(w.id) && !w.highlights.some(h => F.taggedVersion(model, h, jt, 'en')));
  if (noHit) ok('a job with no tagged bullet keeps its first one', T.listedBullets(model, r, noHit.id).includes(noHit.highlights[0]));
  const m2 = clone(model);
  const s = m2.facts.find(f => f.id === 'summary');
  const sv = m2.variants.find(v => s.variants.includes(v.id) && v.lang === 'en' && v.id !== T.chooseVariant(m2, 'summary', en[0]).v.id);
  sv.tags = [...(sv.tags ?? []), 'Summary-test'];
  const r2 = clone(en[0]);
  F.applyTag(m2, r2, 'Summary-test');
  ok('the summary switches to its tagged version', r2.picks.summary === sv.id);
}

section('archived claims');
{
  const m = clone(model);
  const fid = m.facts.find(f => f.archived).id;
  const job = T.jobOfFact(m, fid);
  const tag = m.variants.find(v => v.id === m.facts.find(f => f.id === fid).variants[0]).tags.find(x => !m.jobTypes.includes(x)) ?? m.variants.find(v => v.id === m.facts.find(f => f.id === fid).variants[0]).tags[0];
  ok('the example archives a claim whose version carries a tag', !!tag, tag);
  const fresh = T.newResume(m);
  ok('a new resume does not list the archived claim', !on(m, fresh).has(fid) && T.listedBullets(m, fresh, job.id).length === job.highlights.length - 1);
  const plan = F.planTag(m, fresh, tag);
  F.applyTag(m, fresh, tag);
  ok('Focus never switches an archived claim on', !on(m, fresh).has(fid) && !plan.hits.has(fid));
  ok('tagHits leaves it out', !F.tagHits(m, tag, 'en').has(fid));
  let refused = false; try { T.setBulletOn(m, fresh, fid, true); } catch { refused = true; }
  ok('an archived claim can not be switched on by hand', refused && !on(m, fresh).has(fid));
  T.setJobOn(m, fresh, job.id, false);
  T.setJobOn(m, fresh, job.id, true);
  ok('switching its job off and on does not bring it back', !on(m, fresh).has(fid));

  // a saved resume that prints it keeps printing it, whatever Focus does
  const live = clone(model);
  const lf = live.facts.find(f => f.id === fid);
  delete lf.archived;
  const saved = T.newResume(live);
  T.setBulletOn(live, saved, fid, true);
  saved.picks = { [fid]: lf.variants[0] };
  lf.archived = true;
  const before = JSON.stringify(saved);
  F.applyTag(live, saved, tag);
  ok('a saved resume that prints an archived claim still prints it after Focus', on(live, saved).has(fid) && JSON.stringify(saved.picks[fid]) === JSON.stringify(lf.variants[0]));
  const other = clone(saved);
  F.applyTag(live, other, 'a-tag-nothing-has');
  ok('…and Focus on a tag it does not carry does not switch it off', on(live, other).has(fid));
  void before;

  const n0 = F.allTags(m, 'en').find(x => x.tag === tag)?.n ?? 0;
  const n1 = F.allTags(m, 'en', { archived: true }).find(x => x.tag === tag)?.n ?? 0;
  ok('tag counts leave archived claims out unless asked', n1 > n0, `${n0} vs ${n1}`);
}

section('archived jobs');
{
  const m = clone(model);
  const jid = 'free';
  const mine = (mm, rr) => JSON.stringify(T.listedBullets(mm, rr, jid)) + JSON.stringify(T.listedBullets(mm, rr, jid).map(f => rr.picks?.[f]));
  // a resume and a job type that do change this job when it is not archived
  let pair = null;
  for (const jt of m.jobTypes) for (const base of en){
    const probe = clone(base);
    const was = mine(m, probe);
    F.applyTag(m, probe, jt);
    if (mine(m, probe) !== was){ pair = [jt, base]; break; }
  }
  ok('(setup) some job type changes the job when it is not archived', !!pair);
  m.work.find(w => w.id === jid).archived = true;
  const r = clone(pair[1]);
  const was = mine(m, r);
  F.applyTag(m, r, pair[0]);
  ok('Focus leaves an archived job exactly as the resume has it', mine(m, r) === was);
}

section('job types as bundles of tags');
{
  const m = clone(model);
  ok('the example has an object job type and an old string one', m.jobTypes.some(j => typeof j === 'string') && m.jobTypes.some(j => typeof j === 'object'));
  ok('the normaliser reads both', F.jobTypesOf(m).length === m.jobTypes.length && F.jobTypesOf(m).every(j => j.id && j.label && Array.isArray(j.tags) && j.tags.length >= 1));
  const old = F.normaliseJobType('Medical devices');
  ok('a string is one tag, which is also its id and label', old.id === 'Medical devices' && old.label === 'Medical devices' && old.tags.join() === 'Medical devices');
  ok('junk is dropped', F.normaliseJobType(3) === null && F.normaliseJobType({ label: 'x' }) === null && F.jobTypesOf({ jobTypes: [3, '', { id: 'a' }] }).length === 1);

  // ranking: the version carrying the most of the bundle's tags wins, then the lowest number
  const fact = m.facts.find(f => (m.variants.filter(v => f.variants.includes(v.id) && (v.lang ?? 'en') === 'en').length >= 3));
  const vs = m.variants.filter(v => fact.variants.includes(v.id) && (v.lang ?? 'en') === 'en').sort((a, b) => parseFloat(a.n) - parseFloat(b.n));
  for (const v of vs) v.tags = [];
  vs[0].tags = ['t-a']; vs[1].tags = ['t-a', 't-b']; vs[2].tags = ['t-b'];
  const bundle = { id: 'bun', label: 'Bundle', tags: ['t-a', 't-b'] };
  m.jobTypes.push(bundle);
  ok('the version with most of the bundle’s tags wins', F.taggedVersion(m, fact.id, 'bun', 'en').id === vs[1].id);
  ok('…a plain tag still takes the lowest number', F.taggedVersion(m, fact.id, 't-b', 'en').id === vs[1].id && F.taggedVersion(m, fact.id, 't-a', 'en').id === vs[0].id);
  ok('…a job type object works as well as its id', F.taggedVersion(m, fact.id, bundle, 'en').id === vs[1].id);
  vs[1].tags = ['t-a']; vs[2].tags = ['t-a'];
  ok('equal counts: the lowest version number', F.taggedVersion(m, fact.id, 'bun', 'en').id === vs[0].id);
  ok('a fact with none of its tags has no tagged version', F.taggedVersion(m, fact.id, { id: 'z', tags: ['nope'] }, 'en') === null);
  const hu = m.variants.find(v => (v.lang ?? 'en') === 'hu');
  const huFact = m.facts.find(f => f.variants.includes(hu.id));
  hu.tags = ['t-hu'];
  m.jobTypes.push({ id: 'hu-only', label: 'Hu', tags: ['t-hu'] });
  ok('language filtering: a Hungarian version is no English hit', F.taggedVersion(m, huFact.id, 'hu-only', 'en') === null && F.taggedVersion(m, huFact.id, 'hu-only', 'hu')?.id === hu.id);

  // a claim is hit if any version carries any tag of the bundle
  const hits = F.tagHits(m, 'bun', 'en');
  ok('tagHits: a claim is hit if any version carries any of the tags', hits.has(fact.id));
  const arch = m.facts.find(f => f.archived);
  arch && (m.variants.find(v => v.id === arch.variants[0]).tags = ['t-a']);
  ok('an archived claim is never a hit', !F.tagHits(m, 'bun', 'en').has(arch.id));

  // apply: plan = apply, one resume, idempotent, picks the bundle's version
  const r = clone(en[0]);
  const plan = F.planTag(m, r, 'bun');
  const before = on(m, r);
  F.applyTag(m, r, 'bun');
  const after = on(m, r);
  ok('plan = apply for a bundle', plan.on === [...after].filter(x => !before.has(x)).length && plan.off === [...before].filter(x => !after.has(x)).length);
  ok('applying twice changes nothing', (a => a.on + a.off + a.sw)(F.planTag(m, r, 'bun')) === 0);
  ok('the old string form still works through Focus', (() => { const q = clone(en[0]); F.applyTag(model, q, 'Medical devices'); return (a => a.on + a.off + a.sw)(F.planTag(model, q, 'Medical devices')) === 0; })());

  // allTags: job types first, a bundle counts the versions any of its tags is on
  const tags = F.allTags(m, 'en');
  const b = tags.find(x => x.tag === 'bun');
  ok('allTags lists a bundle first, with its label and the versions it hits', b?.jobType && b.label === 'Bundle' && b.tags.join() === 't-a,t-b' && b.n === m.variants.filter(v => (v.lang ?? 'en') === 'en' && ((v.tags ?? []).includes('t-a') || (v.tags ?? []).includes('t-b'))).length - (arch ? 1 : 0) && tags.findIndex(x => !x.jobType) > tags.findLastIndex(x => x.jobType));
  ok('a tag named like a job type id is not listed twice', tags.filter(x => x.tag === 'Medical devices').length === 1);
}

console.log(failed ? `\n${failed} focus check(s) FAILED` : '\nall focus checks passed');
process.exit(failed ? 1 : 0);
