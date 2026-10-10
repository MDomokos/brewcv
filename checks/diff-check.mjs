#!/usr/bin/env node
// node checks/diff-check.mjs
// The merge engine (src/model/diff.js) on an edited copy of the fictional example: nothing changes until
// items are applied, and applying the ticked ones leaves a record that validates and renders.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import * as S from '../src/model/schema.js';
import * as D from '../src/model/diff.js';
import * as R from '../src/model/record.js';
import * as B from '../src/model/build.js';
import { newResume } from '../src/model/resume.js';
import { validate } from './lib/validate.mjs';
import { createDocument } from '../scripts/lib/dom.mjs';
import { renderPages } from '../src/render.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const clone = x => structuredClone(x);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);

const mine = S.load(read('data/example.json')).model;
const names = read('data/example-resumes/index.json');
const resumes = names.map(n => ({ ...S.loadResume(read(`data/example-resumes/${n}`), mine).recipe, id: n }));

section('the same record: nothing to do');
{
  const items = D.diffRecords(mine, clone(mine), { fromResumes: resumes, toResumes: clone(resumes) });
  ok('no add or change items', items.every(x => x.kind === 'keep'), JSON.stringify(items.map(x => x.what)));
}

section('an edited copy');
const theirs = clone(mine);
// a claim renamed under the same id: matched by id, not reported as new
const hydra = theirs.work.find(w => w.id === 'hydra');
theirs.facts.find(f => f.id === hydra.highlights[0]).summary = 'Inhaler dose counter, redesigned';
// a claim under a new id: matched by its text
const h2 = hydra.highlights[1];
const f2 = theirs.facts.find(f => f.id === h2);
const newId = 'renamed-claim';
f2.id = newId; hydra.highlights[1] = newId;
for (const v of theirs.variants.filter(v => f2.variants.includes(v.id))) v.id = v.id.replace(h2, newId);
f2.variants = f2.variants.map(v => v.replace(h2, newId));
f2.default = Object.fromEntries(Object.entries(f2.default).map(([l, v]) => [l, v.replace(h2, newId)]));
R.addVersion(theirs, newId, { text: 'Built the drop and cycle test rig, and wrote the protocols the team still runs.', from: f2.variants[0], as: 'minor' });
B.addBullet(theirs, 'poly', 'Ran the lab’s weekly safety walk-round and kept its log.');
const tagged = theirs.variants.find(v => v.id === theirs.facts.find(f => f.id === 'poly-shop')?.variants[0]) ?? theirs.variants.find(v => v.lang === 'en' && (v.tags ?? []).length);
tagged.tags = [...tagged.tags, 'safety'];
theirs.work.find(w => w.id === 'medisure').endDate = '2021-01';
B.addJob(theirs, { position: 'Test Engineer', name: 'Lumen Devices', location: 'Braga', startDate: '2016-01', endDate: '2016-12', bullets: ['Ran 300 drop tests on a hand-held meter.', 'Wrote the test reports.'] });
theirs.jobTypes.push('Test engineering');
const theirResumes = [...clone(resumes), { ...newResume(theirs), company: 'Lumen Devices', role: 'Test Engineer', id: 'Lumen Devices - Test Engineer.json' }];
// something only in mine
const onlyMine = mine.work.find(w => w.id === 'atelier');
theirs.work = theirs.work.filter(w => w.id !== 'atelier');
theirs.sections.find(s => s.id === 'experience').content.work = theirs.sections.find(s => s.id === 'experience').content.work.filter(x => x !== 'atelier');

const items = D.diffRecords(mine, theirs, { fromResumes: resumes, toResumes: theirResumes });
const has = re => items.find(x => re.test(x.what));
const c = D.counts(items);
ok('it finds adds, changes and things only in yours', c.add > 0 && c.change > 0 && c.keep > 0, JSON.stringify(c));
ok('a renamed claim is not a new claim', !items.some(x => x.what.startsWith('New claim') && /dose counter/i.test(x.b ?? '')));
ok('a claim under a new id is matched by its wording, and its new version found', !!has(/New version · Hydra Medical/) && !items.some(x => x.what === 'New claim · Hydra Medical' && /drop and cycle/i.test(x.b)));
ok('a new version is shown as a word diff against its nearest sibling', has(/New version · Hydra Medical/).diff.some(r => r.op === '+') && has(/New version · Hydra Medical/).diff.some(r => r.op === '='));
ok('a new claim in an existing job', /safety walk-round/.test(items.find(x => x.what === 'New claim · Polytechnic Prototyping Lab')?.b ?? ''));
ok('new tags on a version', /safety/.test(has(/^Tags ·/)?.b ?? ''));
ok('conflicting dates are a change, not ticked', has(/Medisure.* · end/)?.kind === 'change' && has(/Medisure.* · end/).on === false);
ok('a new job', /Lumen Devices/.test(items.find(x => x.what === 'New job')?.b ?? '') && items.find(x => x.what === 'New job').on);
ok('a job type and a saved resume', !!has(/^Job type/) && !!has(/^Saved resume$/));
ok('a job only in yours is listed, to keep', items.some(x => x.kind === 'keep' && x.b.includes(onlyMine.name)));

section('applying');
{
  const d = { record: clone(mine), resumes: clone(resumes), frozen: {} };
  const before = clone(d);
  const n = D.applyItems(d, items);
  ok('the ticked items apply', n === items.filter(x => x.on && x.kind !== 'keep').length);
  ok('the new job is in, with its claims', d.record.work.some(w => w.name === 'Lumen Devices' && w.highlights.length === 2));
  ok('the new claim is in its job', d.record.work.find(w => w.id === 'poly').highlights.some(h => /safety walk-round/.test(d.record.variants.find(v => v.id === d.record.facts.find(f => f.id === h).variants[0]).text)));
  ok('the reworded version is a new version on the existing claim', R.versionsIn(d.record, h2).some(v => /protocols the team still runs/.test(v.text)));
  ok('the end date was not changed (not ticked)', d.record.work.find(w => w.id === 'medisure').endDate === mine.work.find(w => w.id === 'medisure').endDate);
  ok('nothing of yours was removed', mine.work.every(w => d.record.work.some(x => x.id === w.id)) && mine.facts.every(f => d.record.facts.some(x => x.id === f.id)));
  ok('the job type and the saved resume are in', d.record.jobTypes.includes('Test engineering') && d.resumes.some(r => r.company === 'Lumen Devices'));
  const v = validate(S.save(d.record));
  ok('the merged record validates', v.errors.length === 0, v.errors[0]);
  ok('and every resume still renders', d.resumes.every(r => { try { renderPages(d.record, r, createDocument(), { fallback: true }); return true; } catch (e){ console.log('   ', e.message); return false; } }));
  const again = D.diffRecords(d.record, theirs, { fromResumes: d.resumes, toResumes: theirResumes });
  ok('merging the same file again finds nothing new to add, except what was left unticked', again.filter(x => x.kind === 'add').length === 0 && again.some(x => x.kind === 'change'),
     JSON.stringify(again.filter(x => x.kind === 'add').map(x => x.what)));
  const ticked = items.map(x => ({ ...x, on: x.kind !== 'keep' }));
  const d2 = { record: clone(mine), resumes: clone(resumes) };
  D.applyItems(d2, ticked);
  ok('ticking a change applies it', d2.record.work.find(w => w.id === 'medisure').endDate === '2021-01');
}

section('copying a fact never collides');
{
  const a = clone(mine), b = clone(mine);
  const id = D.copyFact(a, b, 'hydra-inhaler');
  ok('a fact copied into a record that has its id gets a new one', id !== 'hydra-inhaler' && a.facts.filter(f => f.id === id).length === 1);
  ok('with new version ids', new Set(a.variants.map(v => v.id)).size === a.variants.length);
  ok('and its default points at its own versions', Object.values(a.facts.find(f => f.id === id).default).every(v => a.facts.find(f => f.id === id).variants.includes(v)));
}

section('archiving and unarchiving are changes a merge shows and applies');
{
  const hydraId = mine.work.find(w => w.id === 'hydra').highlights;
  const target = hydraId[2];
  const theirs2 = clone(mine);
  theirs2.facts.find(f => f.id === target).archived = true;
  const it = D.diffRecords(mine, theirs2, { fromResumes: resumes, toResumes: clone(resumes) });
  const arch = it.filter(x => /archived/.test(x.b ?? ''));
  ok('archiving in theirs is one change, not ticked', arch.length === 1 && arch[0].kind === 'change' && arch[0].on === false && arch[0].b === 'archived' && arch[0].a === 'not archived', JSON.stringify(it.map(x => x.what)));
  const d = { record: clone(mine), resumes: clone(resumes), frozen: {} };
  D.applyItems(d, it.map(x => ({ ...x, on: x.kind !== 'keep' })));
  ok('ticking it archives the claim here', d.record.facts.find(f => f.id === target).archived === true);
  ok('…and it is the only difference', JSON.stringify(d.record.facts.filter(f => f.archived).map(f => f.id).sort()) === JSON.stringify([...mine.facts.filter(f => f.archived).map(f => f.id), target].sort()));
  const un = clone(mine);
  const was = mine.facts.find(f => f.archived).id;
  delete un.facts.find(f => f.id === was).archived;
  const back = D.diffRecords(mine, un, { fromResumes: resumes, toResumes: clone(resumes) }).filter(x => x.kind === 'change' && /archived/.test(x.b ?? ''));
  ok('unarchiving in theirs is a change too', back.length === 1 && back[0].b === 'not archived');
  const d3 = { record: clone(mine), resumes: clone(resumes) };
  D.applyItems(d3, back.map(x => ({ ...x, on: true })));
  ok('…and applying it unarchives the claim', !d3.record.facts.find(f => f.id === was).archived);
  const both = D.diffRecords(mine, clone(mine), { fromResumes: resumes, toResumes: clone(resumes) });
  ok('two records that agree on what is archived show nothing', both.every(x => x.kind === 'keep'));
}

section('archiving a whole job is a change too');
{
  const theirs3 = clone(mine);
  theirs3.work.find(w => w.id === 'atelier').archived = true;
  const it = D.diffRecords(mine, theirs3, { fromResumes: resumes, toResumes: clone(resumes) }).filter(x => x.kind === 'change');
  ok('it is one change, not ticked', it.length === 1 && it[0].on === false && it[0].b === 'archived', JSON.stringify(it.map(x => x.what)));
  const d = { record: clone(mine), resumes: clone(resumes) };
  D.applyItems(d, it.map(x => ({ ...x, on: true })));
  ok('applying it archives the job here', d.record.work.find(w => w.id === 'atelier').archived === true);
}

console.log(failed ? `\n${failed} diff check(s) FAILED` : '\nall diff checks passed');
process.exit(failed ? 1 : 0);
