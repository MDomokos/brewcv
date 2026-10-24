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
import { resolve, chooseVariant, setOverride, addLocalLine, writeGroup, arrangementOf, setPhoto } from '../src/model/resume.js';
import { filesOf, createPersist, memoryBackend, memoryFolder, readFolder } from '../src/store/persist.js';
import { createStore } from '../src/store/store.js';
import { jobTypesOf } from '../src/model/focus.js';
import { missingList } from '../src/model/lang.js';
import { validate } from './lib/validate.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const clone = x => structuredClone(x);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);
const throws = fn => { try { fn(); return false; } catch { return true; } };

const model = S.load(read('data/example.json')).model;
const noSnaps = r => { const c = clone(r); delete c.snapshots; return c; };
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
  ok('opening it is not a change: the open copy is the saved one', eq(st.cur, noSnaps(RS.savedOf(st))));
  ok('its frozen text is current, so nothing is held', !st.cur.held && RS.newerOf(st.record, st.cur).length === 0);
  const before = clone(st);
  RS.settle(st);
  ok('settling an untouched resume changes nothing', eq(before, st));
}

section('autosave: the open resume is always saved');
{
  const st = exampleState();
  const store = createStore(st, { settle: RS.settle });
  ok('a change to the open resume is written into it, in the same commit', store.commit(d => { d.cur.pageLimit = 2; }, 'x') && RS.savedOf(store.state).pageLimit === 2 && store.state.cur.pageLimit === 2);
  ok('…with the date it changed', RS.savedOf(store.state).savedAt === RS.today());
  const id = store.state.openId;
  store.undo();
  ok('undo takes the saved copy back with it', RS.savedOf(store.state).pageLimit === st.cur.pageLimit && store.state.openId === id);
  store.redo();
  ok('and redo puts it back', RS.savedOf(store.state).pageLimit === 2);
  ok('its frozen text follows what it prints', eq(store.state.frozen[id], resolve(store.state.record, store.state.cur).body));
  // picks and sections and design all mirror
  store.commit(d => { d.cur.theme = 'other'; d.cur.accent = '#112233'; d.cur.sections = d.cur.sections.slice().reverse(); }, 'design');
  ok('picks, sections and design are saved as they happen', RS.savedOf(store.state).accent === '#112233' && eq(RS.savedOf(store.state).sections, store.state.cur.sections));
  ok('a commit that changes nothing is not a step', store.commit(() => {}, 'noop') === false);
}

section('autosave leaves the other saved resumes alone');
{
  const st = exampleState();
  const store = createStore(st, { settle: RS.settle });
  const other = names[1];
  const files = filesOf(store.state), otherFile = files.get(`recipes/${other}`);
  const frozenOther = JSON.stringify(store.state.frozen[other]);
  const u = RS.usedVersions(store.state.record, store.state.cur).find(x => store.state.record.work.some(w => w.highlights.includes(x.fact)));
  store.commit(d => { R.saveOver(d.record, u.variant, 'Reworded in the open resume.'); }, 'edit');
  ok('editing a version changes the open resume’s frozen text', JSON.stringify(store.state.frozen[store.state.openId]).includes('Reworded in the open resume.'));
  ok('…and no other resume’s frozen text', JSON.stringify(store.state.frozen[other]) === frozenOther);
  const printsIt = RS.usedVersions(store.state.record, RS.savedOf(store.state, other)).some(x => x.variant === u.variant);
  ok('…a resume that prints it is offered the newer wording on opening', !printsIt || RS.openSaved(clone(store.state), other).held.length >= 1);
  ok('the other resume’s file is byte-identical', filesOf(store.state).get(`recipes/${other}`) === otherFile || printsIt === false);
}

section('a resume that was never saved is saved');
{
  const st = exampleState();
  const store = createStore(st, { settle: RS.settle });
  store.commit(d => { RS.newFrom(d, { start: 'all' }); }, 'new');
  const untitled = store.state.resumes.at(-1);
  ok('a new resume is saved at once, with a default name', store.state.openId === untitled.id && untitled.name === store.state.cur.name && untitled.name.length > 0);
  store.commit(d => { d.openId = null; d.cur.pageLimit = 2; }, 'draft');
  ok('work with no saved copy gets one on the next commit', store.state.openId && store.state.resumes.length === st.resumes.length + 2 && RS.savedOf(store.state).pageLimit === 2);
  ok('…it validates', validate(S.save(store.state.record), RS.savedOf(store.state)).errors.length === 0);
  const n = store.state.resumes.length;
  store.commit(d => { d.cur.pageLimit = 1; }, 'again');
  ok('and later changes go into that one', store.state.resumes.length === n);
}

section('saving a new resume');
{
  const st = exampleState();
  RS.duplicate(st, names[0]);
  ok('a duplicate is a saved resume of its own, open', st.openId !== names[0] && st.resumes.some(r => r.id === st.openId) && st.cur.id === st.openId);
  const n0 = st.resumes.length;
  const used = RS.usedVersions(st.record, st.cur);
  const { id, tagged } = RS.saveNew(st, { company: 'Northwind Optics', role: 'Design Engineer', jobType: 'Optics', tags: ['hardware', ' ', 'remote'] });
  ok('saveNew adds a saved resume named Company - Role', st.resumes.length === n0 + 1 && id === 'Northwind Optics - Design Engineer.json' && st.openId === id && st.cur.name === 'Northwind Optics - Design Engineer');
  ok('its For is the company and role, with a kind', st.cur.company === 'Northwind Optics' && st.cur.role === 'Design Engineer' && st.cur.forKind === 'company');
  ok('the job type joins the record’s job types', st.record.jobTypes.includes('Optics'));
  ok('every version it uses is tagged with it', tagged === used.length && used.every(u => st.record.variants.find(v => v.id === u.variant).tags.includes('Optics')));
  ok('blank tags are dropped', eq(st.cur.tags, ['hardware', 'remote']));
  ok('its text is frozen as it prints now', eq(st.frozen[id], resolve(st.record, st.cur).body));
  RS.saveNew(st, { company: 'Northwind Optics', role: 'Design Engineer' });
  ok('a second save with the same name gets " 2"', st.openId === 'Northwind Optics - Design Engineer 2.json');
  ok('a resume keeps its own job type unless told another', st.cur.jobType === 'Optics');
  ok('no company is needed', (() => { RS.saveNew(st, { company: '', role: '', name: 'Geospatial - GIS Solutions Engineer' }); return st.cur.name === 'Geospatial - GIS Solutions Engineer' && st.cur.company === '' && !st.cur.forKind && st.openId === 'Geospatial - GIS Solutions Engineer.json'; })());
  ok('nothing at all is fine too', (() => { RS.saveNew(st, { name: '', company: '', role: '' }); return !!st.cur.name && st.resumes.some(r => r.id === st.openId); })());
  ok('outreach is a kind of For', (() => { RS.saveNew(st, { company: 'Geospatial', role: 'GIS Engineer', forKind: 'outreach' }); return st.cur.forKind === 'outreach' && st.cur.name === 'Geospatial - GIS Engineer'; })());
  ok('every saved resume validates', st.resumes.every(r => validate(S.save(st.record), r).errors.length === 0),
     st.resumes.map(r => validate(S.save(st.record), r).errors[0]).filter(Boolean)[0]);
  ok('a name with no For: the job type’s label stands in', (() => { RS.saveNew(st, { jobType: 'Optics', company: '', role: 'Lead' }); return st.cur.name === 'Optics - Lead'; })());
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
  ok('opening a held resume is still not a change', eq(st.cur, noSnaps(RS.savedOf(st))));
  ok('it prints the old text', resolve(st.record, st.cur).body.work.some(w => w.highlights.includes(before)));
  const st2 = clone(st);
  RS.keepOlder(st2.cur, fact.fact);
  ok('keep the saved one: it stays, as this resume’s own text', st2.cur.overrides[fact.fact] === before && !st2.cur.held && RS.newerOf(st2.record, st2.cur).length === 0);
  RS.acceptNewer(st.cur, fact.fact, st.record);
  ok('use the newer one: the hold goes', st.cur.overrides[fact.fact] === undefined && !st.cur.held);
  ok('and it prints the new text', resolve(st.record, st.cur).body.work.some(w => w.highlights.includes('Newer wording for this claim.')));
  RS.settle(st);
  ok('accepting is saved as it happens, and freezes the new text', JSON.stringify(st.frozen[other]).includes('Newer wording for this claim.') && RS.openSaved(st, other).held.length === 0);
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
  const n0 = st.resumes.length;
  const type = jobTypesOf(st.record)[0].id;
  const latest = RS.byNewest(st.resumes).find(r => r.jobType === type);
  const all = RS.newFrom(st, { start: 'all', name: 'Everything' });
  ok('everything on: every job, saved and open at once', st.resumes.length === n0 + 1 && st.openId === all.id && st.cur.sections.find(s => s.id === 'experience').work.length === st.record.work.length);
  RS.newFrom(st, { start: 'latest', jobType: type, fromId: latest.id, company: 'Fabrikam', role: 'Engineer' });
  ok('the last of a type copies the newest saved one of it', eq(st.cur.sections, latest.sections) && st.cur.jobType === type && st.cur.company === 'Fabrikam' && !st.cur.snapshots);
  ok('…and starts with none of its snapshots or sends', !RS.savedOf(st).snapshots);
  const other = RS.byNewest(st.resumes).find(r => r.jobType !== type) ?? st.resumes[0];
  RS.newFrom(st, { start: 'latest', fromId: other.id, name: 'Copy of another' });
  ok('"change" picks any resume to copy', eq(st.cur.sections, other.sections));
  const rec = RS.startRecipe(st, { start: 'tagged', jobType: type });
  ok('startRecipe previews without saving', st.resumes.length === n0 + 3 && !!rec.picks);
  RS.newFrom(st, { start: 'tagged', jobType: type, lang: 'en' });
  ok('bullets for the job type: the tagged versions are picked', Object.values(st.cur.picks).some(vid => (st.record.variants.find(v => v.id === vid)?.tags ?? []).includes(type)));
  ok('…and it validates', validate(S.save(st.record), st.cur).errors.length === 0, validate(S.save(st.record), st.cur).errors[0]);
  RS.newFrom(st, { start: 'empty', name: 'Blank' });
  ok('an empty page prints no job', resolve(st.record, st.cur).body.work.length === 0 && validate(S.save(st.record), st.cur).errors.length === 0, validate(S.save(st.record), st.cur).errors[0]);
  ok('latest of a type with no saved resume is refused', throws(() => RS.newFrom(st, { start: 'latest', jobType: 'Nope' })));
  RS.newFrom(st, { start: 'all', lang: 'de', format: 'a4-hu' });
  ok('language and paper are the form’s', st.cur.lang === 'de' && st.cur.format === 'a4-hu');
  RS.newFrom(st, { start: 'all', company: 'Contoso', role: '' });
  ok('a company alone names it', st.cur.name === 'Contoso' && st.openId === 'Contoso.json');
}

section('duplicating');
{
  const st = exampleState();
  const src = names[0];
  const n0 = st.resumes.length;
  RS.duplicate(st, src);
  ok('a copy named after the original, open', st.resumes.length === n0 + 1 && /copy/i.test(st.cur.name) && st.cur.company === RS.savedOf(st, src).company);
  ok('…its frozen text is the original’s', eq(st.frozen[st.openId], st.frozen[src]));
  const a4src = st.resumes.find(r => r.format !== 'us-letter');
  const hu = RS.duplicate(st, a4src.id, { lang: 'hu' });
  ok('in another language: the language and its paper switch', st.cur.lang === 'hu' && st.cur.format === 'a4-hu' && /HU/.test(st.cur.name) && st.openId === hu.id);
  const lt = RS.duplicate(st, src, { lang: 'de' });
  ok('…a Letter resume stays Letter, as switching language does', st.cur.lang === 'de' && st.cur.format === 'us-letter' && st.openId === lt.id);
  ok('…the original is untouched', (RS.savedOf(st, src).lang ?? 'en') === 'en');
  ok('…lines with no version in that language are marked as missing', missingList(st.record, st.cur).length > 0);
  ok('…it validates', validate(S.save(st.record), st.cur).errors.length === 0, validate(S.save(st.record), st.cur).errors[0]);
  RS.renameSaved(st, st.openId, 'Fabrikam - Ingenieur');
  ok('rename changes the name and the file name', st.cur.name === 'Fabrikam - Ingenieur' && st.openId === 'Fabrikam - Ingenieur.json' && st.frozen['Fabrikam - Ingenieur.json'] && !st.frozen[lt.id]);
  const idOf = RS.renameSaved(st, st.openId, '  ').id;
  ok('an empty name falls back', !!RS.savedOf(st, idOf).name);
}

section('snapshots: Save freezes what is sent');
{
  const st = exampleState();
  const store = createStore(st, { settle: RS.settle, coalesceMs: 0 });
  const id = store.state.openId;
  const printed = () => JSON.stringify(resolve(store.state.record, store.state.cur).body);
  const sent1 = { kind: 'company', company: 'Medtech Lisboa', role: 'Mechanical Engineer', date: '2026-10-02' };
  let r1;
  store.commit(d => { r1 = RS.takeSnapshot(d, sent1, { at: '2026-10-02T09:00:00.000Z' }); }, 'Save');
  const snaps = () => RS.snapshotsOf(RS.savedOf(store.state));
  ok('the first Save makes a snapshot with one send', r1.added && snaps().length === 1 && snaps()[0].sends.length === 1 && eq(snaps()[0].sends[0], sent1));
  ok('…it keeps what the resume printed, its picks, design, paper and language', JSON.stringify(snaps()[0].body) === printed() && eq(snaps()[0].recipe.picks, store.state.cur.picks) && snaps()[0].recipe.format === store.state.cur.format && !('snapshots' in snaps()[0].recipe) && !('snapshots' in store.state.cur));
  ok('…and the open resume is not changed by it', eq(noSnaps(RS.savedOf(store.state)), store.state.cur));
  ok('Save again with nothing changed would add a send', RS.sameAsLatest(store.state));
  store.commit(d => { RS.takeSnapshot(d, { kind: 'company', company: 'Contoso', role: 'Engineer', date: '2026-10-03' }); }, 'Save');
  ok('a second Save with nothing changed adds a send instead of a snapshot', snaps().length === 1 && snaps()[0].sends.length === 2 && snaps()[0].sends[1].company === 'Contoso');
  store.commit(d => { RS.takeSnapshot(d, { kind: 'company', company: 'Contoso', role: 'Engineer', date: '2026-10-03' }); }, 'Save');
  ok('the same send twice is not recorded twice', snaps()[0].sends.length === 2);
  store.commit(d => { RS.takeSnapshot(d, { kind: 'outreach', company: 'Geospatial', date: '2026-10-04' }); }, 'Save');
  ok('outreach is a kind of send', snaps()[0].sends[2].kind === 'outreach' && snaps()[0].sends.length === 3);
  store.commit(d => { d.cur.accent = '#445566'; }, 'design');
  ok('a change that prints is a new snapshot on the next Save', !RS.sameAsLatest(store.state));
  store.commit(d => { RS.takeSnapshot(d, {}, { at: '2026-10-05T09:00:00.000Z', date: '2026-10-05' }); }, 'Save');
  ok('…which has its own id and the default date', snaps().length === 2 && snaps()[1].id !== snaps()[0].id && snaps()[1].sends[0].date === '2026-10-05' && snaps()[1].sends[0].company === '');
  ok('…and the first snapshot is untouched', JSON.stringify(snaps()[0].body) !== JSON.stringify(snaps()[1].body) || snaps()[0].recipe.accent !== snaps()[1].recipe.accent);
  store.commit(d => { d.cur.name = 'Renamed'; d.cur.company = 'Other Co'; d.cur.tags = ['x']; }, 'meta');
  ok('a new name, For or tags is not a change to what prints', RS.sameAsLatest(store.state));
  store.undo(); store.undo();
  ok('undo takes a snapshot back, and the rename before it', snaps().length === 1 && store.state.cur.name !== 'Renamed');
  store.undo(); store.undo();
  ok('…and a send, one step at a time', snaps().length === 1 && snaps()[0].sends.length === 2 && store.state.cur.accent !== '#445566');
  store.redo(); store.redo(); store.redo(); store.redo();
  // frozen: edits afterwards leave the snapshot as it was
  const body0 = JSON.stringify(snaps()[0].body);
  const u = RS.usedVersions(store.state.record, store.state.cur).find(x => store.state.record.work.some(w => w.highlights.includes(x.fact)));
  store.commit(d => { R.saveOver(d.record, u.variant, 'Wording changed after the snapshot.'); }, 'edit');
  ok('editing the record afterwards leaves a snapshot as it was sent', JSON.stringify(snaps()[0].body) === body0 && !JSON.stringify(snaps()[0].body).includes('Wording changed after the snapshot.'));
  const fileText = [...filesOf(store.state)].find(([k]) => k === `recipes/${S.resumeFileName(RS.savedOf(store.state))}`)?.[1];
  ok('…and the saved resume’s file keeps it', JSON.stringify(S.loadResume(JSON.parse(fileText), store.state.record).recipe.snapshots?.[0]?.body) === body0);
}

section('Mark as sent (the end of Export): the same snapshot and send, written through the new door');
{
  const ui = fs.readFileSync(path.join(REPO, 'src/ui/resumes.js'), 'utf8'), exp = fs.readFileSync(path.join(REPO, 'src/ui/export.js'), 'utf8'), shell = fs.readFileSync(path.join(REPO, 'src/ui/shell.js'), 'utf8');
  ok('the button writes through RS.takeSnapshot, with the same send and the same undo labels', /RS\.takeSnapshot\(d, send\)/.test(ui) && /ux1\.undoSend/.test(ui) && /ux1\.undoSnapshot/.test(ui) && /RS\.normalSend\(/.test(ui));
  ok('Export ends with it, and the header has no Save: no data-act="save" is left anywhere in the app', /data-act="mark-sent"/.test(exp) && !/data-act="save"/.test(shell + ui + exp) && !/case 'save':/.test(ui));
  const st = exampleState();
  const store = createStore(st, { settle: RS.settle, coalesceMs: 0 });
  store.commit(d => { RS.takeSnapshot(d, { kind: 'company', company: 'Northgate Dosing Systems', role: 'Mechanical Design Engineer', date: '2026-10-12' }, { at: '2026-10-12T09:00:00.000Z' }); }, 'Mark as sent');
  const snap = RS.snapshotsOf(RS.savedOf(store.state))[0];
  ok('the snapshot keeps its shape: id, time, the sends, the recipe and the printed body', eq(Object.keys(snap).sort(), ['at', 'body', 'id', 'recipe', 'sends']) && eq(Object.keys(snap.sends[0]).sort(), ['company', 'date', 'kind', 'role']));
}

section('opening a snapshot: read-only, restore, duplicate');
{
  const st = exampleState();
  const store = createStore(st, { settle: RS.settle, coalesceMs: 0 });
  store.commit(d => { RS.takeSnapshot(d, { company: 'Medtech Lisboa', date: '2026-10-02' }); }, 'Save');
  const sid = RS.snapshotsOf(RS.savedOf(store.state))[0].id;
  const bodyThen = JSON.stringify(resolve(store.state.record, store.state.cur).body);
  // the wording it was sent with outlives a later edit in the record
  const u = RS.usedVersions(store.state.record, store.state.cur).find(x => store.state.record.work.some(w => w.highlights.includes(x.fact)));
  store.commit(d => { R.saveOver(d.record, u.variant, 'Changed since it was sent.'); d.cur.pageLimit = 2; }, 'edit');
  const snap = RS.findSnapshot(store.state, sid);
  const shownR = RS.snapshotRecipe(store.state.record, snap);
  ok('the page shows the snapshot as it was sent', JSON.stringify(resolve(store.state.record, shownR).body) === bodyThen);
  const before = JSON.stringify(store.state);
  RS.snapshotRecipe(store.state.record, snap);
  ok('looking at it changes nothing in the state', JSON.stringify(store.state) === before);
  store.commit(d => { RS.restoreSnapshot(d, sid); }, 'Restore');
  ok('Restore as current: the resume prints as it did', JSON.stringify(resolve(store.state.record, store.state.cur).body) === bodyThen && store.state.cur.pageLimit === snap.recipe.pageLimit);
  ok('…keeps its name and snapshots, and is saved', store.state.cur.name === RS.savedOf(store.state).name && RS.snapshotsOf(RS.savedOf(store.state)).length === 1 && eq(noSnaps(RS.savedOf(store.state)), store.state.cur));
  ok('…the wording it was sent with is kept, and the newer wording is offered', RS.newerOf(store.state.record, store.state.cur).length >= 1 && !JSON.stringify(resolve(store.state.record, store.state.cur).body).includes('Changed since it was sent.'));
  store.undo();
  ok('undo puts the resume back', store.state.cur.pageLimit === 2);
  const n0 = store.state.resumes.length, from = store.state.openId;
  let dup;
  store.commit(d => { dup = RS.duplicateSnapshot(d, sid); }, 'Duplicate');
  ok('Duplicate as new resume: a resume of its own, open', store.state.resumes.length === n0 + 1 && store.state.openId === dup.id && dup.id !== from && !RS.savedOf(store.state).snapshots);
  ok('…printing as the snapshot did', JSON.stringify(resolve(store.state.record, store.state.cur).body) === bodyThen);
  ok('…and the original is untouched', RS.snapshotsOf(RS.savedOf(store.state, from)).length === 1 && RS.savedOf(store.state, from).pageLimit === 2);
  ok('…it validates', validate(S.save(store.state.record), RS.savedOf(store.state)).errors.length === 0);
  // a snapshot of a job type teaches the record
  const t0 = clone(st);
  const jt = jobTypesOf(t0.record).find(j => typeof j.tags?.length === 'number' && j.tags.length === 1);
  if (jt){
    t0.cur.jobType = jt.id; RS.settle(t0);
    const before = JSON.stringify(t0.record.variants);
    RS.takeSnapshot(t0, {});
    ok('a snapshot of a job type tags the versions it used, as the first save did', JSON.stringify(t0.record.variants) !== before || RS.usedVersions(t0.record, t0.cur).every(x => t0.record.variants.find(v => v.id === x.variant).tags?.includes(jt.tags[0])));
  }
  // other resumes' frozen text is untouched by snapshots and by edits in the open one
  const other = names[1], f0 = JSON.stringify(store.state.frozen[other]), file0 = filesOf(store.state).get(`recipes/${other}`);
  store.commit(d => { d.cur.pageLimit = 1; RS.takeSnapshot(d, { company: 'X' }); }, 'x');
  ok('a snapshot and an edit leave every other resume alone', JSON.stringify(store.state.frozen[other]) === f0 && filesOf(store.state).get(`recipes/${other}`) === file0);
}

section('a reload keeps the open resume, its snapshots and what was sent');
{
  const st = exampleState();
  const backend = memoryBackend();
  const store = createStore(st, { settle: RS.settle });
  const p = createPersist({ store, backend, debounceMs: 0, setTimer: fn => { fn(); return 0; }, clearTimer: () => {} });
  store.commit(d => { d.cur.pageLimit = 2; RS.takeSnapshot(d, { company: 'Medtech Lisboa', date: '2026-10-02' }); }, 'Save');
  await p.flush();
  const store2 = createStore({}, { settle: RS.settle });
  const p2 = createPersist({ store: store2, backend, debounceMs: 0, setTimer: fn => { fn(); return 0; }, clearTimer: () => {} });
  ok('the session comes back', await p2.restore());
  const back = store2.state, was = RS.savedOf(store.state);
  ok('with the open resume, saved and equal to the page', back.openId === store.state.openId && eq(noSnaps(RS.savedOf(back)), back.cur) && back.cur.pageLimit === 2);
  ok('and its snapshot with its send', eq(RS.snapshotsOf(RS.savedOf(back)), was.snapshots) && RS.savedOf(back).snapshots[0].sends[0].company === 'Medtech Lisboa');
  ok('a commit after the reload is not an extra step for the restore', store2.history.undo === 0 && store2.commit(() => {}, 'noop') === false);
  p.stop(); p2.stop();
}

section('listing, compare, delete');
{
  const st = exampleState();
  const g = RS.grouped(st.record, st.resumes);
  ok('grouped by job type in the record’s order', g.map(x => x.type).join('|') === jobTypesOf(st.record).map(j => j.id).filter(t => st.resumes.some(r => r.jobType === t)).join('|'));
  ok('newest first in each group', g.every(x => x.resumes.every((r, i, a) => i === 0 || String(a[i - 1].savedAt) >= String(r.savedAt))));
  const [a, b] = st.resumes;
  const rows = RS.compareRows(st.record, a, b);
  ok('compare: the settings first', rows.slice(0, 6).map(r => r.label).join() === 'Job type,Language,Paper,Pages,Photo,Sections');
  ok('then every claim either prints', rows.filter(r => r.kind === 'claim').length >= RS.usedVersions(st.record, a).length);
  ok('a claim only one prints shows — on the other', rows.some(r => r.kind === 'claim' && (r.a.label === '—') !== (r.b.label === '—')));
  ok('rows that differ say so', rows.some(r => r.differs) && rows.some(r => !r.differs));
  const n = st.resumes.length;
  RS.deleteSaved(st, a.id);
  ok('delete removes it and its frozen text', st.resumes.length === n - 1 && !st.frozen[a.id]);
  ok('deleting the open one opens the newest left', st.openId && st.openId !== a.id && st.cur.id === st.openId);
  const only = exampleState();
  for (const r of [...only.resumes]) RS.deleteSaved(only, r.id);
  ok('deleting the last one leaves a fresh page to work on', only.resumes.length === 0 && !!only.cur && only.openId === null);
  RS.settle(only);
  ok('…which is saved the moment it changes', only.resumes.length === 1 && only.openId === only.resumes[0].id);
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
  store.commit(d => { RS.duplicate(d, names[0], { name: 'Contoso Labs - Engineer' }); }, 'Save');
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
  ok('opening one holds nothing and is no change', !again.cur.held && eq(again.cur, noSnaps(RS.savedOf(again))));
  ok('the file it saves as is the same', JSON.stringify(S.saveResume(st.record, again.cur, again.frozen[again.openId]).file.work) === JSON.stringify(S.saveResume(model, again.resumes[0], again.frozen[again.openId]).file.work));
  // a new resume never uses one
  RS.newFrom(st, { start: 'all' });
  const used = new Set(RS.usedVersions(st.record, st.cur).map(u => u.fact));
  ok('a new resume prints none of the archived claims', [...used].every(f => !st.record.facts.find(x => x.id === f)?.archived));
}

section('saving and listing with a bundle job type');
{
  const st = exampleState();
  st.record.jobTypes.push({ id: 'cad-designer', label: 'CAD designer', tags: ['cad', 'Hardware design'] });
  RS.duplicate(st, names[0]);
  const r = RS.saveNew(st, { company: 'Bundle Co', role: 'Designer', jobType: 'cad designer' });
  ok('a typed label finds the job type, and the resume keeps its id', st.cur.jobType === 'cad-designer' && st.record.jobTypes.filter(j => (j.id ?? j) === 'cad-designer' || j === 'cad designer').length === 1);
  ok('a bundle does not tag the versions the resume used', r.tagged === 0 && !JSON.stringify(st.record.variants).includes('"cad designer"'));
  const g = RS.grouped(st.record, st.resumes).find(x => x.type === 'cad-designer');
  ok('listing groups by id and shows the label', g?.label === 'CAD designer' && g.resumes.length === 1);
  const cmp = RS.compareRows(st.record, st.resumes.find(x => x.jobType === 'cad-designer'), st.resumes[0]).find(x => x.kind === 'setting');
  ok('compare shows the label', cmp.a === 'CAD designer');
  RS.newFrom(st, { start: 'tagged', jobType: 'cad-designer' });
  ok('a new resume from a bundle applies it and keeps the id', st.cur.jobType === 'cad-designer');
  const st2 = exampleState();
  RS.duplicate(st2, names[0]);
  RS.saveNew(st2, { company: 'Old Co', jobType: 'Brand new type' });
  ok('a new typed name is still the old one-tag form', st2.record.jobTypes.at(-1) === 'Brand new type');
}

section('the grown switcher: the Date and Company views');
{
  const st = exampleState();
  const a = st.resumes[0], b = st.resumes[1], c = st.resumes[2];
  // a is sent to Acme (twice, the second time as outreach), b to Acme and Birch, c never sent
  RS.openSaved(st, a.id);
  RS.takeSnapshot(st, { company: 'Acme', role: 'Engineer', date: '2026-03-02' });
  RS.takeSnapshot(st, { kind: 'outreach', company: 'Acme', role: 'Engineer', date: '2026-04-09' });
  RS.openSaved(st, b.id);
  RS.takeSnapshot(st, { company: 'acme', role: 'Lead', date: '2025-12-30' });
  RS.takeSnapshot(st, { company: 'Birch', role: 'Lead', date: '2026-01-15' });
  const rs = st.resumes;
  const ev = RS.sendEvents(rs);
  ok('Date: every send is an event, newest first', ev.filter(e => e.kind === 'send').length === 4 && ev.filter(e => e.kind === 'send').every((e, i, l) => !i || l[i - 1].date >= e.date), ev.map(e => e.date).join());
  ok('…a resume never sent comes in once, at the day it was saved', ev.filter(e => e.kind === 'saved').length === rs.length - 2 && ev.filter(e => e.kind === 'saved').every(e => e.resume.id !== a.id && e.resume.id !== b.id));
  const bands = RS.sendBands(ev);
  ok('…in bands of a year, newest year first', bands.every(x => x.events.every(e => e.date.slice(0, 4) === x.year)) && bands.map(x => x.year).join() === [...new Set(ev.map(e => e.date.slice(0, 4)))].join());
  const co = RS.byCompany(rs);
  ok('Company: one group for Acme however it is spelled, with both resumes that went there', co.filter(g => g.key === 'acme').length === 1 && co.find(g => g.key === 'acme').rows.map(x => x.resume.id).sort().join() === [a.id, b.id].sort().join());
  ok('…a resume sent to two companies is in both groups', co.find(g => g.key === 'birch').rows.some(x => x.resume.id === b.id));
  ok('…outreach is marked: a resume only ever sent as outreach to a company is an outreach row, one sent for real is not', co.find(g => g.key === 'acme').rows.find(x => x.resume.id === a.id).outreach === false && (() => { const q = exampleState(); RS.openSaved(q, q.resumes[0].id); RS.takeSnapshot(q, { kind: 'outreach', company: 'Sector', date: '2026-02-01' }); return RS.byCompany(q.resumes).find(g => g.key === 'sector').rows[0].outreach === true; })());
  const nameless = { ...clone(c), id: 'nameless', name: 'Nameless', company: '', role: '' };
  const co2 = RS.byCompany([...rs, nameless]);
  ok('…each row remembers its sends, and a resume with no company is in the last, unnamed group', co.find(g => g.key === 'acme').rows.find(x => x.resume.id === a.id).sends.length === 2 && co2.at(-1).key === '' && co2.at(-1).rows.some(x => x.resume.id === 'nameless'));
  ok('…the named groups are in alphabetical order', co.slice(0, -1).every((g, i, l) => !i || l[i - 1].label.localeCompare(g.label, undefined, { sensitivity: 'base' }) <= 0));
}

section('accents in file names (composed and decomposed are one name)');
{
  const nfc = 'Ingénieure conception', nfd = nfc.normalize('NFD');
  ok('the fixture really differs', nfc !== nfd);
  ok('a saved resume\'s file name has composed accents', S.resumeFileName({ name: nfd }) === `${nfc}.json`);
  ok('index.json lists composed names', names.every(n => n === n.normalize('NFC')));
  ok('a name typed either way is taken', RS.uniqueId([{ id: `${nfc}.json` }], { name: nfd }) === `${nfc} 2.json`);
  const st = exampleState();
  const store = createStore(st);
  const folder = memoryFolder();
  const p = createPersist({ store, backend: memoryBackend(), debounceMs: 0, setTimer: (fn) => { fn(); return 0; }, clearTimer: () => {} });
  await p.link(folder);
  store.commit(d => { RS.duplicate(d, names[0], { name: nfc }); }, 'Save');
  store.commit(d => { RS.duplicate(d, names[0], { name: nfd }); }, 'Save');
  await p.flush();
  const files = (await folder.list('recipes')).filter(n => n.startsWith('Ingénieure'));
  ok('two resumes named the same way write two files, never one over the other', files.length === 2 && files.every(n => n === n.normalize('NFC')), files.join(' | '));
  const disk = memoryFolder({ 'resume-data.json': folder._files.get('resume-data.json'), [`recipes/${nfd}.json`]: folder._files.get(`recipes/${nfc}.json`) });
  const back = await readFolder(disk);
  ok('a file a Mac or a sync tool named with decomposed accents opens under the composed name', back.state.resumes.length === 1 && back.state.resumes[0].id === `${nfc}.json`, JSON.stringify(back.state.resumes.map(r => r.id)));
  const text = folder._files.get(`recipes/${nfc}.json`);
  const twin = memoryFolder({ 'resume-data.json': folder._files.get('resume-data.json'), [`recipes/${nfd}.json`]: text, [`recipes/${nfc}.json`]: text });
  const both = await readFolder(twin);
  ok('both spellings with the same text load once, silently', both.state.resumes.length === 1 && both.state.resumes[0].id === `${nfc}.json` && both.warnings.length === 0, JSON.stringify(both.warnings));
  const later = JSON.parse(text); later.meta.resumeBuilder.resume.savedAt = '2099-01-01'; later.meta.resumeBuilder.resume.company = 'Newer Co';
  const diff = memoryFolder({ 'resume-data.json': folder._files.get('resume-data.json'), [`recipes/${nfd}.json`]: JSON.stringify(later), [`recipes/${nfc}.json`]: text });
  const merged = await readFolder(diff);
  ok('two different ones: the one saved last opens, under the composed name', merged.state.resumes.length === 1 && merged.state.resumes[0].company === 'Newer Co' && merged.state.resumes[0].id === `${nfc}.json`);
  ok('…and the other is named in a warning, and listed to be dropped', merged.warnings.some(w => /same name/.test(w)) && merged.leftovers.length === 1 && diff._files.has(`recipes/${nfd}.json`));
  const st2 = merged.state; st2.cur = RS.savedOf(st2) ? JSON.parse(JSON.stringify(RS.savedOf(st2))) : st2.cur;
  const p2 = createPersist({ store: createStore(st2), backend: memoryBackend(), debounceMs: 0, setTimer: (fn) => { fn(); return 0; }, clearTimer: () => {} });
  await p2.link(diff);
  const gone = await p2.dropMerged(merged.leftovers);
  ok('after the write, the other spelling is removed and the composed file holds the newer resume', gone.length === 1 && !diff._files.has(`recipes/${nfd}.json`) && JSON.parse(diff._files.get(`recipes/${nfc}.json`)).meta.resumeBuilder.resume.company === 'Newer Co');
  const same2 = await readFolder(diff);
  ok('and the folder reads back as one resume with nothing to warn about', same2.state.resumes.length === 1 && same2.warnings.length === 0 && same2.leftovers.length === 0, JSON.stringify(same2.warnings));
  ok('a spelling that is the composed one is never dropped', (await p2.dropMerged([`${nfc}.json`])).length === 0 && diff._files.has(`recipes/${nfc}.json`));
}

section('compare any number, and what differs (UX-6e)');
{
  const st = exampleState(), m = st.record, [a, b, c] = st.resumes;
  const rows = RS.compareMany(m, [a, b, c]);
  ok('a cell for each of the three on every row, the settings first', rows.every(r => r.cells.length === 3) && rows.slice(0, 6).map(r => r.label).join() === 'Job type,Language,Paper,Pages,Photo,Sections');
  ok('the job order and the skill order are rows of their own', ['Job order', 'Skills'].every(l => rows.some(r => r.kind === 'setting' && r.label === l)));
  ok('the header lines are claims too, and a claim only some print says — for the others', rows.some(r => r.kind === 'claim' && r.fact === 'tagline') && rows.some(r => r.kind === 'claim' && r.cells.some(x => x.label === '—') && r.cells.some(x => x.label !== '—')));
  ok('for two it is compareRows', RS.compareRows(m, a, b).every((r, i) => eq(r.a, RS.compareMany(m, [a, b])[i].cells[0]) && eq(r.b, RS.compareMany(m, [a, b])[i].cells[1])));
  ok('an edit on one resume shows as "only here" in its column', (() => { const x = clone(a); setOverride(m, x, 'tagline', 'Written here', { marks: [], base: null }); const r = RS.compareMany(m, [a, x, b]).find(q => q.fact === 'tagline'); return r.cells[1].label === 'only here' && r.cells[0].label !== 'only here' && r.differs; })());
  // a copy with an edit, a line only on it, its skills arranged, no photo → photo
  RS.duplicate(st, a.id, { name: 'Child' });
  const parent = RS.savedOf(st, a.id), kid = RS.savedOf(st, st.openId);
  ok('a copy has no differences from its parent, but its name', eq(RS.differences(m, parent, kid), [`Named Child`]), JSON.stringify(RS.differences(m, parent, kid)));
  const job = (kid.sections.find(x => x.id === 'experience')?.work ?? [])[0], jobId = typeof job === 'string' ? job : job.id ?? m.work[0].id;
  const fact = m.work.find(w => w.id === jobId).highlights[0];
  setOverride(m, kid, fact, 'Only on the copy.', { marks: [], base: null });
  const local = addLocalLine(m, kid, jobId, null); setOverride(m, kid, local, 'A line only the copy has.', { marks: [], base: null });
  writeGroup(m, kid, arrangementOf(m, kid).groups[0].id, 'Renamed\nOne, Two');
  setPhoto(m, kid, { show: !kid.photo?.show });
  const d = RS.differences(m, parent, kid);
  ok('what differs: the name, the edit, the line only here, the photo and the skills, in plain words', d.length === 5 && /^Named Child/.test(d[0]) && d.some(x => /^Edited on this resume: /.test(x)) && d.some(x => /^Adds a line only on this resume: A line only the copy has\./.test(x)) && d.some(x => /^Photo: /.test(x)) && d.some(x => /^Skills arranged as: Renamed/.test(x)), JSON.stringify(d));
  ok('…and the other way round: the line is left out, the edit is a version again', (() => { const e = RS.differences(m, kid, parent); return e.some(x => /^Leaves out: A line only the copy has/.test(x)) && e.some(x => /^[^:]+: only here to v\d/.test(x)); })(), JSON.stringify(RS.differences(m, kid, parent)));
  ok('a version picked instead is "v1 to v2"', (() => { const x = clone(a), f = m.facts.find(q => q.id === 'tagline'); const other = f.variants.map(v => m.variants.find(q => q.id === v)).find(v => v.lang === 'en' && v.id !== chooseVariant(m, 'tagline', a).v.id); if (!other) return true; x.picks = { ...x.picks, tagline: other.id }; return RS.differences(m, a, x).some(q => /^Discipline line for the gutter: v\d+ to v\d+/.test(q)); })());
  // UX-6e fix round: names, not ids, and only the jobs that print
  const jobsRow = r => RS.compareMany(m, [r]).find(q => q.label === 'Job order').cells[0];
  ok('the Job order row names projects as well as jobs, never an id', [...m.work, ...m.projects].every(w => !jobsRow(a).includes(w.id)) && jobsRow(a).includes(m.projects[0].name), jobsRow(a));
  const withOff = ids => { const x = clone(a), e = x.sections.find(q => q.id === 'experience'); e.work = [...e.work.map(w => (typeof w === 'string' ? { id: w } : w)), ...ids.map(id => ({ id, highlights: [] }))]; return x; };
  const off1 = withOff(['free', 'atelier']), off2 = withOff(['atelier', 'free']);
  ok('jobs with no picked bullet are not in the Job order, so reordering them is no difference', !jobsRow(off1).includes('Self-employed') && !RS.differences(m, off1, off2).some(q => /^Job order/i.test(q) || q.includes('›')), JSON.stringify(RS.differences(m, off1, off2)));
  const stc = { resumes: [{ id: 'p', savedAt: '2026-01-01' }, { id: 'q', savedAt: '2026-02-01' }, { id: 'r', savedAt: '2026-03-01' }, { id: 'z', savedAt: '2026-04-01' }] };
  const lines = { p: ['x'], q: ['x'], r: ['x'], z: ['y'] };
  ok('closest: no common line gives no guess', RS.closestTo(stc, stc.resumes[3], r => lines[r.id]) === null);
  ok('closest: of resumes that print the same, the newest', RS.closestTo(stc, stc.resumes[0], r => lines[r.id])?.r.id === 'r');
  ok('printedIds is kept by content: the same answer, not recomputed', RS.printedIds(m, a) === RS.printedIds(m, a) && RS.printedIds(m, a) !== RS.printedIds(m, b));
  ok('printedIds names what a resume prints, for the closest-resume guess', RS.printedIds(m, a).includes('tagline') && RS.printedIds(m, a).length > 5);
}

section('Use for a new job, and a resume at a glance (UX-6h)');
{
  const st = exampleState(), src = st.resumes[0], before = Object.keys(src).sort();
  const res = RS.duplicate(st, src.id, { name: RS.nameFrom({ company: 'Contoso Labs', role: 'Lead Engineer' }), company: 'Contoso Labs', role: 'Lead Engineer' });
  const kid = RS.savedOf(st, res.id);
  ok('a copy made for a job has the company and the role in the fields a resume already has, and opens under its parent', kid.company === 'Contoso Labs' && kid.role === 'Lead Engineer' && kid.parent === src.id && st.openId === kid.id && kid.name === 'Contoso Labs - Lead Engineer');
  const st2 = exampleState(), plain = RS.savedOf(st2, RS.duplicate(st2, st2.resumes[0].id).id);
  ok('a plain duplicate keeps the company and the role of its source, as before', plain.company === st2.resumes[0].company && plain.role === st2.resumes[0].role);
  ok('…and the copy made for a job has the very keys a plain duplicate has: no new format', eq(Object.keys(kid).sort(), Object.keys(plain).sort()));
  const m = model, a = RS.savedOf(exampleState(), names[0]);
  const g = RS.glance(m, a);
  ok('at a glance: the pitch is the summary\u2019s words', g.pitch === 'Mechanical engineer on single-use medical devices, from sketch to tooling release; EU patent holder.');
  ok('…the jobs in the order they print, each with how many of its lines print', eq(g.jobs, [{ name: 'Hydra Medical', n: 4 }, { name: 'Polytechnic Prototyping Lab', n: 2 }, { name: 'Medisure Contract Manufacturing', n: 3 }]));
  ok('…and the skill groups in order, as names', g.skills === 'CAD & 3D, Fabrication, Test & QA, Software');
  const none = clone(a); none.sections = (none.sections ?? []).map(x => (x.id === 'experience' ? { ...x, work: [] } : x));
  ok('a resume with no jobs lists none', RS.glance(m, none).jobs.length === 0);
}

section('RS.hits: the lines a resume prints that hold a word');
{
  const r = S.loadResume(read('data/example-resumes/Ferro Tools - Manufacturing Engineer.json'), model).recipe;
  const dfm = RS.hits(model, r, 'dfm'), inh = RS.hits(model, r, ' Inhaler ');
  ok('a word finds the printed lines that hold it, whatever its case', dfm.length >= 1 && dfm.every(x => /dfm/i.test(x.text) && x.fact) && inh.length >= 1);
  ok('no word finds nothing; a word no printed line holds finds nothing', RS.hits(model, r, '').length === 0 && RS.hits(model, r, 'zzz-nothing').length === 0);
  ok('a line the resume does not print is not found (a bullet taken off)', (() => { const c = clone(r); const f = dfm[0].fact; c.overrides = { ...(c.overrides ?? {}), [f]: 'no such word here' }; return !RS.hits(model, c, 'dfm').some(x => x.fact === f); })());
}

section('RS.prints: which resumes print a claim, and in which version');
{
  const rs = fs.readdirSync(path.join(REPO, 'data/example-resumes')).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => S.loadResume(read(`data/example-resumes/${f}`), model).recipe);
  const n = (facts, vid) => rs.filter(r => RS.prints(model, r, facts, vid)).length;
  ok('a claim is printed by the resumes that pick one of its versions (the other languages print their own wording of it)', n(['hydra-dfm']) === 8 && n(['hydra-inhaler', 'hydra-testing']) === 14);
  ok('a version is printed by the resumes that pick that very one', n(['hydra-dfm'], 'hydra-dfm-v1') === 2 && n(['hydra-dfm'], 'hydra-dfm-v1-hu') === 0);
  ok('a claim no resume prints is found by none, and a job\u2019s title counts as printed with the job', n(['caliper-stand-files']) === 0 && n(['hydra-position']) === 14);
  const r = clone(rs.find(x => RS.prints(model, x, ['hydra-dfm'], 'hydra-dfm-v1')));
  r.overrides = { ...(r.overrides ?? {}), 'hydra-dfm': 'Only here' };
  ok('a text edited on this resume only is the claim, not a version of it', RS.prints(model, r, ['hydra-dfm']) && !RS.prints(model, r, ['hydra-dfm'], 'hydra-dfm-v1'));
}

console.log(failed ? `\n${failed} resumes check(s) FAILED` : '\nall resumes checks passed');
process.exit(failed ? 1 : 0);
