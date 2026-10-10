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

console.log(failed ? `\n${failed} focus check(s) FAILED` : '\nall focus checks passed');
process.exit(failed ? 1 : 0);
