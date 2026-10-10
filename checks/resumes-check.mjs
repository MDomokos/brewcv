#!/usr/bin/env node
// node checks/resumes-check.mjs
// Saved resumes (src/model/resumes.js) in Node, and what goes to a linked folder's recipes/.
// Fictional data only; nothing is written.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import * as S from '../src/model/schema.js';
import * as RS from '../src/model/resumes.js';
import * as R from '../src/model/record.js';
import { resolve, chooseVariant } from '../src/model/resume.js';
import { filesOf, createPersist, memoryBackend, memoryFolder, readFolder } from '../src/store/persist.js';
import { createStore } from '../src/store/store.js';
import { validate } from './lib/validate.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const clone = x => structuredClone(x);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);
const throws = fn => { try { fn(); return false; } catch { return true; } };

const model = S.load(read('data/example.json')).model;
const names = read('data/example-resumes/index.json');
function exampleState(){
  const resumes = [], frozen = {};
  for (const n of names){
    const got = S.loadResume(read(`data/example-resumes/${n}`), model);
    resumes.push({ ...got.recipe, id: n });
    frozen[n] = got.frozen;
  }
  const st = { record: clone(model), resumes, frozen, cur: null, openId: null };
  RS.openSaved(st, resumes[0].id);
  return st;
}

section('opening a saved resume');
{
  const st = exampleState();
  ok('the first example opens', st.openId === names[0] && st.cur.company === 'Example Instruments');
  ok('opening it is not a change', !RS.isDirty(st));
  ok('its frozen text is current, so nothing is held', !st.cur.held && RS.newerOf(st.record, st.cur).length === 0);
  ok('a resume with no saved copy is dirty', RS.isDirty({ ...st, openId: null }));
}

section('saving');
{
  const st = exampleState();
  RS.reuse(st, names[0]);
  ok('re-use starts an unsaved copy', st.openId === null && st.cur.company === '' && !('id' in st.cur));
  ok('save refuses a resume without a company', throws(() => RS.saveNew(st, { company: '  ' })));
  const n0 = st.resumes.length;
  const used = RS.usedVersions(st.record, st.cur);
  const { id, tagged } = RS.saveNew(st, { company: 'Northwind Optics', role: 'Design Engineer', jobType: 'Optics', tags: ['hardware', ' ', 'remote'] });
  ok('saveNew adds a saved resume named Company - Role', st.resumes.length === n0 + 1 && id === 'Northwind Optics - Design Engineer.json' && st.openId === id);
  ok('the job type joins the record’s job types', st.record.jobTypes.includes('Optics'));
  ok('every version it uses is tagged with it', tagged === used.length && used.every(u => st.record.variants.find(v => v.id === u.variant).tags.includes('Optics')));
  ok('blank tags are dropped', eq(st.cur.tags, ['hardware', 'remote']));
  ok('its text is frozen as it prints now', eq(st.frozen[id], resolve(st.record, st.cur).body));
  ok('and it is not dirty', !RS.isDirty(st));
  RS.reuse(st, id);
  RS.saveNew(st, { company: 'Northwind Optics', role: 'Design Engineer' });
  ok('a second save with the same name gets " 2"', st.openId === 'Northwind Optics - Design Engineer 2.json');
  ok('without a job type nothing is tagged', !st.cur.jobType);

  st.cur.pageLimit = 2;
  ok('a change makes it dirty', RS.isDirty(st));
  RS.saveOpen(st);
  ok('save writes it back', !RS.isDirty(st) && RS.savedOf(st).pageLimit === 2);
  ok('every saved resume validates', st.resumes.every(r => validate(S.save(st.record), r).errors.length === 0),
     st.resumes.map(r => validate(S.save(st.record), r).errors[0]).filter(Boolean)[0]);
}

section('frozen text and newer wording');
{
  const st = exampleState();
  const other = names[1];
  // save over a version the other resume prints
  const r1 = RS.savedOf(st, other);
  const fact = resolve(st.record, r1) && RS.usedVersions(st.record, r1).find(u => st.record.work.some(w => w.highlights.includes(u.fact)));
  const before = st.record.variants.find(v => v.id === fact.variant).text;
  R.saveOver(st.record, fact.variant, 'Newer wording for this claim.');
  ok('the other resume’s file still says what it printed', filesOf(st).get(`recipes/${other}`).includes(JSON.stringify(before).slice(1, -1)));
  const { held } = RS.openSaved(st, other);
  ok('opening it holds the old text', st.cur.overrides[fact.fact] === before && st.cur.held.includes(fact.fact));
  ok('and offers the newer wording', held.length === 1 && held[0].live === 'Newer wording for this claim.' && held[0].frozen === before);
  ok('opening a held resume is still not a change', !RS.isDirty(st));
  ok('it prints the old text', resolve(st.record, st.cur).body.work.some(w => w.highlights.includes(before)));
  const st2 = clone(st);
  RS.keepOlder(st2.cur, fact.fact);
  ok('keep the saved one: it stays, as this resume’s own text', st2.cur.overrides[fact.fact] === before && !st2.cur.held && RS.newerOf(st2.record, st2.cur).length === 0);
  RS.acceptNewer(st.cur, fact.fact);
  ok('use the newer one: the hold goes', st.cur.overrides[fact.fact] === undefined && !st.cur.held);
  ok('and it prints the new text', resolve(st.record, st.cur).body.work.some(w => w.highlights.includes('Newer wording for this claim.')));
  ok('accepting is a change to save', RS.isDirty(st));
  RS.saveOpen(st);
  ok('saving freezes the new text', JSON.stringify(st.frozen[other]).includes('Newer wording for this claim.') && RS.openSaved(st, other).held.length === 0);
  ok('a "this resume only" text of its own is never taken for a hold', (() => {
    const s3 = exampleState(); const r = RS.savedOf(s3, other);
    const u = RS.usedVersions(s3.record, r)[1];
    r.overrides = { ...(r.overrides ?? {}), [u.fact]: 'My own words.' };
    s3.frozen[other] = resolve(s3.record, r).body;
    R.saveOver(s3.record, u.variant, 'Changed under it.');
    RS.openSaved(s3, other);
    return s3.cur.overrides[u.fact] === 'My own words.' && !(s3.cur.held ?? []).includes(u.fact);
  })());
}

section('+ New resume');
{
  const st = exampleState();
  const all = RS.newFrom(st, { mode: 'all' });
  ok('everything on: every job, no saved name', st.openId === null && all.sections.find(s => s.id === 'experience').work.length === st.record.work.length);
  const type = st.record.jobTypes[0];
  const latest = RS.byNewest(st.resumes).find(r => r.jobType === type);
  RS.newFrom(st, { mode: 'latest', jobType: type });
  ok('latest of a type copies the newest saved one of it', st.openId === null && eq(st.cur.sections, latest.sections) && st.cur.jobType === type);
  RS.newFrom(st, { mode: 'tagged', jobType: type, lang: 'en' });
  ok('bullets tagged with it: the tagged versions are picked', Object.values(st.cur.picks).some(vid => (st.record.variants.find(v => v.id === vid)?.tags ?? []).includes(type)));
  ok('…and it validates', validate(S.save(st.record), st.cur).errors.length === 0, validate(S.save(st.record), st.cur).errors[0]);
  ok('latest of a type with no saved resume is refused', throws(() => RS.newFrom(st, { mode: 'latest', jobType: 'Nope' })));
}

section('listing, compare, delete');
{
  const st = exampleState();
  const g = RS.grouped(st.record, st.resumes);
  ok('grouped by job type in the record’s order', g.map(x => x.type).join('|') === st.record.jobTypes.filter(t => st.resumes.some(r => r.jobType === t)).join('|'));
  ok('newest first in each group', g.every(x => x.resumes.every((r, i, a) => i === 0 || String(a[i - 1].savedAt) >= String(r.savedAt))));
  const [a, b] = st.resumes;
  const rows = RS.compareRows(st.record, a, b);
  ok('compare: the settings first', rows.slice(0, 6).map(r => r.label).join() === 'Job type,Language,Paper,Pages,Photo,Sections');
  ok('then every claim either prints', rows.filter(r => r.kind === 'claim').length >= RS.usedVersions(st.record, a).length);
  ok('a claim only one prints shows — on the other', rows.some(r => r.kind === 'claim' && (r.a.label === '—') !== (r.b.label === '—')));
  ok('rows that differ say so', rows.some(r => r.differs) && rows.some(r => !r.differs));
  const n = st.resumes.length;
  RS.deleteSaved(st, a.id);
  ok('delete removes it and its frozen text', st.resumes.length === n - 1 && !st.frozen[a.id] && st.openId === null);
}

section('a linked folder');
{
  const st = exampleState();
  const store = createStore(st);
  const folder = memoryFolder();
  const p = createPersist({ store, backend: memoryBackend(), debounceMs: 0, setTimer: (fn) => { fn(); return 0; }, clearTimer: () => {} });
  await p.link(folder);
  const listed = await folder.list('recipes');
  ok('every saved resume is a file in recipes/', listed.length === names.length && names.every(n => listed.includes(n)));
  store.commit(d => { RS.reuse(d, names[0]); RS.saveNew(d, { company: 'Contoso Labs', role: 'Engineer' }); }, 'Save');
  await p.flush();
  ok('a new save appears there', (await folder.list('recipes')).includes('Contoso Labs - Engineer.json'));
  store.commit(d => RS.deleteSaved(d, 'Contoso Labs - Engineer.json'), 'Delete');
  await p.flush();
  ok('a deleted one is removed from the folder', !(await folder.list('recipes')).includes('Contoso Labs - Engineer.json'));
  const back = await readFolder(folder);
  ok('the folder reads back with its frozen texts', back.state.resumes.length === names.length && names.every(n => back.state.frozen[n]));
  ok('and the first resume open', !!back.state.openId);
  folder._files.set('recipes/notes.json', '{"hello":1}');
  store.commit(d => { d.cur.pageLimit = 0; }, 'x'); await p.flush();
  ok('a file the app didn’t write is never removed', folder._files.has('recipes/notes.json'));
}

section('archiving a claim a saved resume prints');
{
  const K = await import('../src/model/career.js');
  const { createDocument } = await import('../scripts/lib/dom.mjs');
  const { renderPages } = await import('../src/render.js');
  const html = (m, r) => renderPages(m, r, createDocument()).pages.map(p => p.outerHTML).join('');
  const st = exampleState();
  const printed = new Set(st.resumes.flatMap(r => RS.usedVersions(st.record, r).map(u => u.fact)));
  const before = st.resumes.map(r => html(st.record, r));
  const body = st.resumes.map(r => JSON.stringify(resolve(st.record, r).body));
  // archive every printed claim that may be archived
  let n = 0;
  for (const w of st.record.work) for (const h of [...w.highlights]) if (printed.has(h)) { try { K.archiveClaim(st.record, h); n++; } catch { /* a job keeps one */ } }
  ok('claims that saved resumes print were archived', n >= 3 && st.record.facts.filter(f => f.archived).length >= n, String(n));
  ok('every saved resume renders byte-identical', st.resumes.every((r, i) => html(st.record, r) === before[i]));
  ok('…and resolves to the same body', st.resumes.every((r, i) => JSON.stringify(resolve(st.record, r).body) === body[i]));
  ok('…and nothing is newer wording', st.resumes.every((r) => RS.newerOf(st.record, r).length === 0));
  const again = exampleState();
  again.record = st.record;
  RS.openSaved(again, again.resumes[0].id);
  ok('opening one holds nothing and is no change', !again.cur.held && !RS.isDirty(again));
  ok('the file it saves as is the same', JSON.stringify(S.saveResume(st.record, again.cur, again.frozen[again.openId]).file.work) === JSON.stringify(S.saveResume(model, again.resumes[0], again.frozen[again.openId]).file.work));
  // a new resume never uses one
  const fresh = RS.newFrom(st, { mode: 'all' });
  const used = new Set(RS.usedVersions(st.record, fresh).map(u => u.fact));
  ok('a new resume prints none of the archived claims', [...used].every(f => !st.record.facts.find(x => x.id === f)?.archived));
}

console.log(failed ? `\n${failed} resumes check(s) FAILED` : '\nall resumes checks passed');
process.exit(failed ? 1 : 0);
