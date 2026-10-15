#!/usr/bin/env node
// node checks/direct-check.mjs
// The model behind editing on the page: parents and the Review list's data, the 70 percent cut-off for a sub-version,
// parked edits, skill sets per language, photo, and the saved-resume keys that carry them. Fictional data only.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import * as S from '../src/model/schema.js';
import * as RS from '../src/model/resumes.js';
import * as R from '../src/model/record.js';
import * as T from '../src/model/resume.js';
import * as K from '../src/model/career.js';
import { renderPages } from '../src/render.js';
import { createDocument } from '../scripts/lib/dom.mjs';
import { createStore } from '../src/store/store.js';
import * as X from '../src/export.js';
import * as L from '../src/model/lang.js';

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
  for (const n of names){ const got = S.loadResume(read(`data/example-resumes/${n}`), model); resumes.push({ ...got.recipe, id: n }); frozen[n] = got.frozen; }
  const st = { record: clone(model), resumes, frozen, cur: null, openId: null };
  RS.openSaved(st, resumes[0].id);
  return st;
}
const words = n => Array.from({ length: n }, (_, i) => `w${i}`);
const mini = text => ({ facts: [{ id: 'f', variants: ['f-v1'], default: { en: 'f-v1' } }], variants: [{ id: 'f-v1', n: '1', lang: 'en', text, marks: [], links: [], tags: [] }] });
const change = (list, k) => list.map((w, i) => (i < k ? `x${i}` : w));

section('suggestNumber: the 70 percent cut-off');
{
  const base = words(13).join(' '), m = mini(base);
  const under = R.suggestNumber(m, 'f', change(words(13), 4).join(' '));      // 9 of 13 kept: 69 percent
  const over = R.suggestNumber(m, 'f', change(words(13), 3).join(' '));       // 10 of 13 kept: 77 percent
  ok('just under 70 percent is a new major', under.as === 'major' && under.n === '2' && under.near.id === 'f-v1', JSON.stringify(under));
  ok('just over 70 percent is a sub-version of the nearest', over.as === 'minor' && over.n === '1.1' && over.near.id === 'f-v1', JSON.stringify(over));
  ok('exactly 70 percent counts as close', R.suggestNumber(mini(words(10).join(' ')), 'f', change(words(10), 3).join(' ')).as === 'minor');
  ok('one word changed is tiny', R.suggestNumber(m, 'f', change(words(13), 1).join(' ')).tiny === true);
  ok('three words changed is not tiny', over.tiny === false);
  ok('a lower threshold is honoured', R.suggestNumber(m, 'f', change(words(13), 4).join(' '), 'en', 0.6).as === 'minor');
  const drafty = mini(base); drafty.variants.push({ id: 'f-draft-v2', n: '2', lang: 'en', text: 'x y z', marks: [], links: [], tags: [] }); drafty.facts[0].variants.push('f-draft-v2');
  ok('a draft is never the nearest', R.suggestNumber(drafty, 'f', 'x y z').near.id === 'f-v1');
  ok('no version in the language: major, nothing near', R.suggestNumber(m, 'f', 'abc', 'hu').near === null);
}

section('addVersion: marks and source');
{
  const m = mini('Cut the cycle time by a third'); m.variants[0].marks = [{ start: 4, end: 9 }]; m.variants[0].source = 'Notebook p. 4';
  const kept = R.addVersion(clone(m), 'f', { text: 'Halved the cycle time', from: 'f-v1', marks: [{ start: 0, end: 6 }] });
  ok('given marks are kept as given', eq(kept.marks, [{ start: 0, end: 6 }]));
  const re = R.addVersion(clone(m), 'f', { text: 'Cut the cycle time by half', from: 'f-v1' });
  ok('without marks the source version\'s are moved onto the new text', eq(re.marks, [{ start: 4, end: 9 }]));
  const sub = R.addVersion(clone(m), 'f', { text: 'Cut the cycle time by 30 percent', from: 'f-v1', as: 'minor' });
  ok('a sub-version copies its parent\'s source', sub.n === '1.1' && sub.source === 'Notebook p. 4');
  ok('a source given wins', R.addVersion(clone(m), 'f', { text: 'Other', from: 'f-v1', as: 'minor', source: 'Review 2025' }).source === 'Review 2025');
  ok('no source anywhere: none written', !('source' in R.addVersion(mini('a b'), 'f', { text: 'c d' })));
}

section('overrides: meta, parking');
{
  const r = { picks: {}, overrides: {} };
  T.setOverride(r, 'f', 'Plain');
  ok('the old call leaves no meta behind', eq(r, { picks: {}, overrides: { f: 'Plain' } }));
  T.setOverride(r, 'f', 'Edited text', { marks: [{ start: 0, end: 6 }], base: 'f-v1' });
  ok('an override keeps its marks and base version', eq(r.overrideMeta.f, { marks: [{ start: 0, end: 6 }], base: 'f-v1' }) && r.overrides.f === 'Edited text');
  T.setOverride(r, 'f', 'Text only');
  ok('a text-only call drops the old meta', !('f' in r.overrideMeta) && r.overrides.f === 'Text only');
  T.setOverride(r, 'f', 'Edited text', { marks: [{ start: 0, end: 6 }], base: 'f-v1' });
  T.setOverride(r, 'f', 'Edited again', { marks: [] });
  ok('the base survives a second edit', r.overrideMeta.f.base === 'f-v1');
  ok('overrideOf says it is on', T.overrideOf(r, 'f').on === true && T.overrideOf(r, 'f').base === 'f-v1' && T.overrideOf(r, 'g') === null);
  T.parkOverride(r, 'f');
  ok('parked: not an override any more, but kept', !('f' in r.overrides) && !r.overrideMeta.f && r.parked.f.text === 'Edited again' && T.overrideOf(r, 'f').on === false);
  T.unparkOverride(r, 'f');
  ok('unparked: back, with its meta, and no longer parked', r.overrides.f === 'Edited again' && r.overrideMeta.f.base === 'f-v1' && !r.parked.f);
  T.parkOverride(r, 'nothing');
  ok('parking what is not an override does nothing', !('nothing' in (r.parked ?? {})));
  T.pickVersion(r, 'f', 'f-v2');
  ok('picking a version parks the edit', r.picks.f === 'f-v2' && !('f' in r.overrides) && r.parked.f.text === 'Edited again');
  T.dropOverride(r, 'f');
  ok('drop forgets it wherever it is', !r.parked.f && !('f' in r.overrides) && T.overrideOf(r, 'f') === null);
  T.setOverride(r, 'f', 'Again', { marks: [] }); T.setOverride(r, 'g', 'Other', { marks: [] });
  ok('both are pending', eq(T.pendingEdits(r), ['f', 'g']));
  T.keepHere(r, 'f');
  ok('kept here leaves the pending list, and the edit stays', eq(T.pendingEdits(r), ['g']) && r.overrides.f === 'Again' && r.overrideMeta.f.kept === true);
  T.keepHere(r, 'h');
  ok('keeping an edit with no meta does not throw', r.overrideMeta.h.kept === true);
  T.setOverride(r, 'g', '');
  ok('clearing the text clears the meta', !('g' in r.overrides) && !r.overrideMeta.g);
}

section('saved resumes: parent, rename, closest, same company');
{
  const st = exampleState();
  const src = st.resumes[0], oldId = src.id;
  const before = st.resumes.length;
  RS.duplicate(st, src.id);
  const child = RS.savedOf(st);
  ok('a copy records its parent', child.parent === src.id && st.cur.parent === src.id && st.resumes.length === before + 1);
  ok('parentOf finds it', RS.parentOf(st, child).id === src.id && RS.parentOf(st, src) === null);
  RS.renameSaved(st, src.id, 'A new name for the original');
  const now = RS.savedOf(st, child.id);
  ok('the parent link survives a rename of the parent', RS.parentOf(st, now)?.name === 'A new name for the original' && now.parent !== oldId && now.parent === src.id);
  RS.duplicate(st, RS.savedOf(st, now.parent).id);
  const copyOfRenamed = RS.savedOf(st);
  ok('and the copy of a copy points at the copy', copyOfRenamed.parent === now.parent && RS.parentOf(st, copyOfRenamed).id === now.parent);
  RS.deleteSaved(st, now.parent);
  ok('a deleted parent is no parent', RS.parentOf(st, RS.savedOf(st, child.id)) === null);
  const st2 = exampleState();
  const copy = st2.resumes.find(r => (r.lang ?? 'en') === 'en' && r !== st2.resumes[0]);
  const printed = r => (r.id === st2.resumes[0].id ? ['a', 'b', 'c', 'd'] : r === copy ? ['a', 'b', 'c', 'x'] : ['z']);
  ok('closestTo, with no parent recorded, picks the one printing most of the same lines', RS.closestTo(st2, st2.resumes[0], printed).r === copy && RS.closestTo(st2, st2.resumes[0], printed).s === 0.75, JSON.stringify(RS.closestTo(st2, st2.resumes[0], printed)?.s));
  const hu = st2.resumes.find(r => r.lang === 'hu');
  ok('closestTo stays in the same language', RS.closestTo(st2, hu, () => ['a']) === null);
  ok('closestTo with nothing to compare is null', RS.closestTo({ resumes: [st2.resumes[0]] }, st2.resumes[0], printed) === null);
  const a = { company: 'Acme ' }, b = { company: ' acme' }, c = { company: 'Other' }, d = { company: '' };
  ok('sameCompany ignores case and spaces, itself, and no company', eq(RS.sameCompany({ resumes: [a, b, c, d] }, a), [b]) && RS.sameCompany({ resumes: [a, d] }, d).length === 0);
}

section('skill sets: per language, falling back to English');
{
  const m = clone(model);
  const en = [{ id: 'skills-cad', items: ['CAD', 'FEA'] }], hu = [{ id: 'skills-cad', items: ['CAD', 'VEM'] }];
  ok('a record without sets has none', eq(T.skillSets(m), {}));
  T.saveSetForTag(m, 'Hardware design', { groups: en });
  T.saveSetForTag(m, 'Hardware design', { groups: hu }, 'hu');
  T.saveSetForTag(m, 'Prototyping', { groups: en });
  ok('a set holds a list of groups per language', eq(Object.keys(m.skillSets['Hardware design']), ['en', 'hu']) && m.skillSets['Hardware design'].hu[0].items[1] === 'VEM');
  const rc = T.newResume(m, { lang: 'hu' });
  T.applySet(m, rc, 'Hardware design');
  ok('applySet takes the recipe\'s language', rc.skillArrangement.from === 'Hardware design' && eq(rc.skillArrangement.groups, hu));
  T.applySet(m, rc, 'Prototyping');
  ok('hu falls back to en when the set has no hu', eq(rc.skillArrangement.groups, en));
  rc.skillArrangement.groups[0].items.push('X');
  ok('the recipe holds a copy', m.skillSets.Prototyping.en[0].items.length === 2);
  ok('an unknown set is refused', throws(() => T.applySet(m, rc, 'Nope')));
  const base = T.newResume(m, { lang: 'en' });
  base.jobType = 'Prototyping';
  const arr = T.arrangementOf(m, base);
  ok('with no arrangement of its own, the skills print as groups', arr.groups.length === 4 && arr.groups[0].id === 'skills-cad' && arr.groups[0].items.length > 1 && arr.from === 'Prototyping');
  ok('a job type with no set is from nothing', T.arrangementOf(m, { ...base, jobType: 'Other' }).from === null);
  T.setArrangement(base, { from: null, groups: hu });
  ok('an arrangement of its own wins, as a copy', eq(T.arrangementOf(m, base).groups, hu) && T.arrangementOf(m, base) === base.skillArrangement && hu[0].items.length === 2);
  ok('groupLabel reads the language\'s labels', T.groupLabel(m, { lang: 'hu' }, 'skills-cad') === 'CAD és 3D');
  ok('groupLabel falls back to the claim\'s label, then the id', T.groupLabel(m, { lang: 'en' }, 'skills-cad') === (m.facts.find(f => f.id === 'skills-cad').label ?? 'skills-cad') && T.groupLabel(m, { lang: 'en' }, 'zzz') === 'zzz');
}

section('photo');
{
  const r = {};
  T.setPhoto(r, { show: true });
  ok('setPhoto fills in the shape', eq(r.photo, { show: true, shape: 'rect' }));
  T.setPhoto(r, { shape: 'round' });
  ok('and merges', eq(r.photo, { show: true, shape: 'round' }));
  const m = clone(model); T.setRecordPhoto(m, 'photo-one');
  ok('setRecordPhoto sets the record\'s photo', m.basics.image === 'photo-one');
}

section('a new claim needs a source');
{
  const m = clone(model); m.requireSource = true;
  const job = m.work[0].id;
  ok('refused without one, nothing written', throws(() => K.addEntryClaim(m, job, 'Did a new thing')) && !m.facts.some(f => /did-a-new/.test(f.id)));
  const fid = K.addEntryClaim(m, job, 'Did a new thing', 'en', 'Notebook p. 9');
  ok('with a source it is made, and every wording carries it', fid && m.facts.find(f => f.id === fid).variants.every(id => m.variants.find(v => v.id === id).source === 'Notebook p. 9'));
  const hu = K.addEntryClaim(m, job, 'Uj dolog', 'hu', 'Notebook p. 10');
  ok('in another language too', m.facts.find(f => f.id === hu).variants.length === 2 && m.facts.find(f => f.id === hu).variants.every(id => m.variants.find(v => v.id === id).source === 'Notebook p. 10'));
  const strict = clone(model); strict.requireSource = true;
  const snap = JSON.stringify(strict);
  ok('addEntryClaim refuses and leaves the record unchanged', throws(() => K.addEntryClaim(strict, job, 'Another')) && JSON.stringify(strict) === snap);
  ok('addProject with bullets and no source refuses before writing', throws(() => K.addProject(strict, { name: 'Kiln', bullets: ['Built it'] })) && JSON.stringify(strict) === snap);
  ok('addKindEntry with bullets and no source refuses before writing', throws(() => K.addKindEntry(strict, 'volunteer', { name: 'Mentor', bullets: ['Taught'] })) && JSON.stringify(strict) === snap);
  ok('with a source, a project\'s bullets carry it', (() => { const id = K.addProject(strict, { name: 'Kiln', bullets: ['Built it'], source: 'Log 3' }); return strict.projects.find(p => p.id === id).highlights.every(h => strict.facts.find(f => f.id === h).variants.every(v => strict.variants.find(x => x.id === v).source === 'Log 3')); })());
  const loose = clone(model); loose.requireSource = false;
  ok('a record that does not require sources takes one without', !!K.addEntryClaim(loose, job, 'Did a new thing'));
}

section('undo of addVersion and saveOver');
{
  const store = createStore({ record: clone(model) });
  const f = model.facts.find(x => (x.variants ?? []).length && x.work);
  const vid = f.variants[0];
  const was = store.state.record.variants.find(v => v.id === vid).text;
  store.commit(d => { R.saveOver(d.record, vid, 'Changed in place'); }, 'save');
  store.commit(d => { R.addVersion(d.record, f.id, { text: 'A new wording', from: vid }); }, 'add');
  ok('both changes land', store.state.record.variants.find(v => v.id === vid).text === 'Changed in place' && store.state.record.variants.some(v => v.text === 'A new wording'));
  store.undo();
  ok('undo takes the new version back out', !store.state.record.variants.some(v => v.text === 'A new wording') && !store.state.record.facts.find(x => x.id === f.id).variants.some(id => !f.variants.includes(id)));
  store.undo();
  ok('and undo puts the old text back', store.state.record.variants.find(v => v.id === vid).text === was);
}

section('the saved-resume file: new keys round trip, old files open, nothing prints differently');
{
  const rc = clone(S.loadResume(read(`data/example-resumes/${names[0]}`), model).recipe);
  const plain = clone(rc);
  const f = model.facts.find(x => x.work);
  T.setOverride(rc, f.id, 'An edit', { marks: [{ start: 0, end: 2 }], base: f.variants[0] });
  T.parkOverride(rc, f.id);
  T.setArrangement(rc, { from: 'Prototyping', groups: [{ id: 'skills-cad', items: ['CAD'] }] });
  rc.parent = 'Some other.json';
  const { file } = S.saveResume(model, rc);
  const back = S.loadResume(JSON.parse(JSON.stringify(file)), model);
  ok('parent, parked, overrideMeta and skillArrangement come back as saved, with no warnings', back.warnings.length === 0 && eq(back.recipe.parked, rc.parked) && eq(back.recipe.skillArrangement, rc.skillArrangement) && back.recipe.parent === rc.parent);
  const edited = clone(rc); T.unparkOverride(edited, f.id);
  ok('overrideMeta is carried', eq(S.loadResume(JSON.parse(JSON.stringify(S.saveResume(model, edited).file)), model).recipe.overrideMeta, edited.overrideMeta));
  const old = S.saveResume(model, plain).file;
  ok('a file without the keys opens with no warnings', S.loadResume(JSON.parse(JSON.stringify(old)), model).warnings.length === 0 && !JSON.stringify(old).includes('overrideMeta') && !JSON.stringify(old).includes('"parent"'));
  const html = r => renderPages(model, r, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('');
  const ignorant = clone(back.recipe); for (const k of ['parent', 'parked', 'overrideMeta', 'skillArrangement']) delete ignorant[k];
  ok('code that ignores the keys prints the same as code that reads them', html(back.recipe) === html(ignorant));
  ok('and a copy\'s parent link is not part of what it prints', RS.printedKey(rc, {}) === RS.printedKey({ ...rc, parent: 'x', parked: {} }, {}));
}

section('a line that exists only on this resume');
{
  const job = model.work[0].id;
  const mk = () => clone(S.loadResume(read(`data/example-resumes/${names[0]}`), model).recipe);
  const html = r => renderPages(model, r, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('');
  const rc = mk(), plain = clone(rc);
  const first = T.listedBullets(model, rc, job);
  const a = T.addLocalLine(model, rc, job, first.at(-1));
  ok('a new line has its own id and follows the line it was added after', a === '~new-1' && eq(T.listedBullets(model, rc, job), [...first, a]) && T.isLocal(rc, a) && !T.isLocal(rc, first[0]));
  ok('…empty, with a place for its text and highlights', rc.overrides[a] === '' && eq(rc.overrideMeta[a], { marks: [], base: null }));
  const b = T.addLocalLine(model, rc, job, null);
  ok('another is unique in the recipe, and null puts it first', b === '~new-2' && T.listedBullets(model, rc, job)[0] === b);
  T.setOverride(rc, a, 'Piloted the bench trial', { marks: [{ start: 12, end: 17 }], base: null });
  T.setOverride(rc, b, 'Ran the first build', { marks: [], base: null });
  const page = html(rc);
  ok('it prints as a bullet of its job, with its highlights', /<li[^>]*>Piloted the <span[^>]*>bench<\/span> trial<\/li>/.test(page));
  const at = txt => page.indexOf(txt.slice(0, 15));
  ok('in its place: after the job\'s last line, and first for null', at('Piloted the ') > at(T.textOf(model, first.at(-1), plain)) && at('Ran the first') < at(T.textOf(model, first[0], plain)));
  ok('a resume without one prints the same as before', html(plain) === html(mk()) && !html(plain).includes("Piloted the bench"));
  ok('pending edits list it', T.pendingEdits(rc).includes(a) && T.pendingEdits(rc).includes(b));

  // moving: stepBullet and moveBullet, past records' bullets and past each other
  const order = () => T.listedBullets(model, rc, job);
  const n0 = order().length;
  ok('↑ moves it above the line before it', T.stepBullet(model, rc, a, -1) && order().indexOf(a) === n0 - 2 && order().length === n0);
  ok('↓ moves it back', T.stepBullet(model, rc, a, 1) && order().at(-1) === a);
  const mid = order()[2];
  T.moveBullet(model, rc, a, mid);
  ok('moveBullet puts it before a named line', order().indexOf(a) === order().indexOf(mid) - 1);
  const fact = first[0];
  T.moveBullet(model, rc, fact, a);
  ok('a record bullet moved past it keeps its place, and the local line stays where it was', order().indexOf(fact) === order().indexOf(a) - 1);
  ok('the stored list holds the record\'s bullets only', !JSON.stringify(rc).includes('"highlights":["~') && rc.localLines[job].every(l => l.after === null || order().includes(l.after)));
  T.moveBullet(model, rc, a);
  ok('and it goes last', order().at(-1) === a);

  // off and on
  T.setBulletOn(model, rc, a, false);
  ok('switched off it prints nowhere, but is still on the resume\'s list', !order().includes(a) && !html(rc).includes('Piloted the') && T.isLocal(rc, a) && T.offOf(rc).includes(a));
  T.setBulletOn(model, rc, a, true);
  ok('switched on it is back in place', order().at(-1) === a && html(rc).includes('Piloted the') && !T.offOf(rc).includes(a));
  T.setBulletOn(model, rc, first[1], false);
  ok('a line it followed switched off leaves it where it is', order().includes(a) && order().indexOf(a) === order().length - 1);
  T.setBulletOn(model, rc, first[1], true);

  // the exports
  const jr = X.jsonResumeFile(model, rc);
  ok('the JSON Resume file leaves it out, and the pre-flight list says why', !JSON.stringify(jr.file).includes('bench trial') && jr.problems.some(p => /exists only on this resume/.test(p) && /left out of an ATS export/.test(p)));
  const txt = X.plainText(T.resolve(model, rc).body);
  ok('the text export prints it', txt.includes('- Piloted the bench trial'));
  ok('resolve names a record override as before', (() => { const r2 = mk(); T.setOverride(r2, first[0], 'x'); return T.resolve(model, r2).problems.some(p => /overrides hydra-inhaler with one-off text/.test(p)); })());

  // remove
  const gone = clone(rc);
  T.removeLocalLine(gone, b);
  ok('removing takes the line, its text and its place', !T.isLocal(gone, b) && !(b in gone.overrides) && !(b in (gone.overrideMeta ?? {})) && !T.listedBullets(model, gone, job).includes(b) && T.isLocal(gone, a));
  T.removeLocalLine(gone, a);
  ok('the last one takes the key too', gone.localLines === undefined && eq(T.listedBullets(model, gone, job), first));
  const emptied = clone(rc); T.setOverride(emptied, a, '');
  ok('emptying its text removes the line', !T.isLocal(emptied, a));

  // saved resume, the one file, copies
  const { file } = S.saveResume(model, rc);
  const back = S.loadResume(JSON.parse(JSON.stringify(file)), model);
  ok('a saved resume keeps it, text, highlights and place, with no warnings', back.warnings.length === 0 && eq(back.recipe.localLines, rc.localLines) && eq(back.recipe.overrides, rc.overrides) && eq(back.recipe.overrideMeta, rc.overrideMeta));
  ok('the frozen text has it', JSON.stringify(back.frozen).includes('Piloted the bench trial') && html(back.recipe) === html(rc));
  ok('and nothing in it is newer than the record', S.newerWording(model, back.frozen, back.recipe).length === 0);
  const st = exampleState();
  st.cur.localLines = clone(rc.localLines); st.cur.overrides = clone(rc.overrides); st.cur.overrideMeta = clone(rc.overrideMeta);
  const id0 = st.openId;
  RS.settle(st);
  ok('saving the open resume keeps it', eq(RS.savedOf(st, id0).localLines, rc.localLines) && JSON.stringify(st.frozen[id0]).includes('Piloted the bench trial'));
  const dup = RS.duplicate(st, id0);
  ok('a duplicate has it', eq(st.cur.localLines, rc.localLines) && st.cur.overrides[a] === 'Piloted the bench trial');
  const snap = RS.takeSnapshot(Object.assign(st, { openId: id0, cur: clone(RS.savedOf(st, id0)) }), { company: 'Acme', role: 'Engineer' });
  const kept = RS.snapshotsOf(RS.savedOf(st, id0)).find(x => x.id === snap.id);
  ok('a snapshot keeps it', eq(kept.recipe.localLines, rc.localLines) && JSON.stringify(kept.body).includes('Piloted the bench trial'));
  const before = JSON.stringify(kept);
  T.removeLocalLine(st.cur, a); RS.settle(st);
  ok('and removing it from the resume never changes the snapshot', JSON.stringify(RS.snapshotsOf(RS.savedOf(st, id0)).find(x => x.id === snap.id)) === before);

  // the language: the line stays as typed and is listed as untranslated
  const hu = clone(rc);
  L.switchLang(hu, 'hu');
  ok('switching language keeps the line, as typed', hu.overrides[a] === 'Piloted the bench trial' && T.listedBullets(model, hu, job).includes(a));
  ok('and lists it as a text with no version in that language', L.missingList(model, hu).some(m => m.id === a));
  const there = clone(hu); T.setOverride(there, a, 'Vezette a padi próbát');
  L.switchLang(there, 'en');
  ok('the line is the same one back in English; a record edit of the other language is unaffected', there.overrides[a] === 'Vezette a padi próbát' && !L.missingList(model, there).some(m => m.id === a));
  const typedHu = clone(plain); typedHu.lang = 'hu'; const c = T.addLocalLine(model, typedHu, job, null);
  T.setOverride(typedHu, c, 'Vezette a próbát');
  ok('a line typed in a language is not listed in that language, and is in another', !L.missingList(model, typedHu).some(m => m.id === c) && L.missingList(model, { ...typedHu, lang: 'de' }).some(m => m.id === c));

  // undo, through the store
  const store = createStore({ record: clone(model), cur: mk() });
  let id;
  store.commit(d => { id = T.addLocalLine(d.record, d.cur, job, T.listedBullets(d.record, d.cur, job).at(-1)); }, 'add a line');
  store.commit(d => { T.setOverride(d.cur, id, 'Typed once', { marks: [], base: null }); }, 'edit');
  ok('the store has the line', T.isLocal(store.state.cur, id) && store.state.cur.overrides[id] === 'Typed once');
  store.undo(); store.undo();
  ok('undo takes it back out', !T.isLocal(store.state.cur, id) && store.state.cur.localLines === undefined);
  store.redo(); store.redo();
  ok('and redo brings it back', T.isLocal(store.state.cur, id) && store.state.cur.overrides[id] === 'Typed once');

  // an older app (the commit before this one): opens the file, renders it, and leaves the line out
  let tree = null;
  try {
    execFileSync('git', ['cat-file', '-e', 'ae6f472^{commit}'], { cwd: REPO, stdio: 'ignore' });
    tree = fs.mkdtempSync(path.join(os.tmpdir(), 'brewcv-old-'));
    execFileSync('sh', ['-c', `git archive ae6f472 src scripts/lib | tar -x -C "${tree}"`], { cwd: REPO });
  } catch { console.log('SKIP  the previous commit is not in this clone: the older app is not tried'); }
  if (tree){
    const O = await Promise.all(['src/model/schema.js', 'src/model/resume.js', 'src/render.js'].map(f => import(pathToFileURL(path.join(tree, f)).href)));
    let err = null, old = null, out = '';
    try {
      const m = O[0].load(read('data/example.json')).model;
      old = O[0].loadResume(JSON.parse(JSON.stringify(file)), m);
      O[1].resolve(m, old.recipe);
      out = O[2].renderPages(m, old.recipe, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('');
    } catch (e){ err = e; }
    ok('the previous commit opens a file with a line only on this resume, and renders it without throwing', !err && old && !out.includes('Piloted the bench trial'), String(err));
    fs.rmSync(tree, { recursive: true, force: true });
  }
}

console.log(failed ? `\n${failed} direct check(s) FAILED` : '\nall direct checks passed');
process.exit(failed ? 1 : 0);
