#!/usr/bin/env node
// node checks/direct-check.mjs
// The model behind editing on the page: parents and the Review list's data, the 70 percent cut-off for a sub-version,
// parked edits, skill sets per language, photo, and the saved-resume keys that carry them. Fictional data only.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
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
  ok('drop forgets it wherever it is', !r.parked?.f && !('f' in (r.overrides ?? {})) && T.overrideOf(r, 'f') === null);
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
  const ignorant = clone(back.recipe); for (const k of ['parent', 'parked', 'overrideMeta']) delete ignorant[k];       // the skill arrangement prints (UX-6c-ii), so code that ignores it is not the same
  ok('code that ignores the keys that do not print, prints the same as code that reads them', html(back.recipe) === html(ignorant));
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

section('a line only on this resume: empty, language, add and remove, anchors, slots, trust');
{
  const { validate } = await import('./lib/validate.mjs');
  const { withLocal } = await import('../src/recipe.js');
  const job = model.work[0].id, hs = model.work[0].highlights;
  const mk = n => clone(S.loadResume(read(`data/example-resumes/${n}`), model).recipe);
  const html = (r, o = {}) => renderPages(model, r, createDocument(), { fallback: true, ...o }).pages.map(p => p.outerHTML).join('');
  const lis = h => (h.match(/<li[ >]/g) ?? []).length;
  const plain = mk(names[0]), rc = clone(plain), first = T.listedBullets(model, rc, job);
  const a = T.addLocalLine(model, rc, job, first.at(-1));
  ok('an empty line prints nowhere: no extra bullet in the page or the PDF', lis(html(rc)) === lis(html(plain)) && html(rc) === html(plain));
  ok('…nor in the body, the printed facts or the frozen body', eq(T.resolve(model, rc).body.work, T.resolve(model, plain).body.work) && !T.printedFacts(model, rc).work.some(w => w.highlights.some(h => h.fact === a)) && (({ meta: _, ...b }) => !JSON.stringify(b).includes('~new-1'))(S.saveResume(model, rc).file));
  ok('…but the page being written and the lists keep it', lis(html(rc, { annotate: true })) === lis(html(plain)) + 1 && T.listedBullets(model, rc, job).includes(a));
  const full = clone(rc); T.setOverride(full, a, 'x', { marks: [], base: null });
  ok('with a word in it, it prints', lis(html(full)) === lis(html(plain)) + 1);
  const lines = clone(rc), a2 = T.addLocalLine(model, lines, job, a); T.setOverride(lines, a2, 'second', { marks: [], base: null });
  ok('a line after an empty one keeps its place', T.resolve(model, lines).body.work[0].highlights.at(-1) === 'second');

  const x = clone(plain), id = T.addLocalLine(model, x, job, null);
  T.setOverride(x, id, 'Typed', { marks: [], base: null });
  L.switchLang(x, 'hu'); const flagged = L.missingList(model, x).some(m => m.id === id);
  T.setOverride(x, id, 'Gépelt', { marks: [], base: null }); const cleared = !L.missingList(model, x).some(m => m.id === id);
  const xen = clone(x); L.switchLang(xen, 'en');      // the Review list is empty in English by design; the line keeps the language it was typed in
  ok('retyping a line in another language clears its flag, and it is flagged in a third', flagged && cleared && xen.localLines[job][0].lang === 'hu' && L.missingList(model, { ...x, lang: 'de' }).some(m => m.id === id));

  let same = 0;
  for (const n of names){
    const r = mk(n), was = JSON.stringify(r), j = model.work.find(w => T.listedBullets(model, r, w.id).length)?.id ?? job;
    const i1 = T.addLocalLine(model, r, j, null); T.removeLocalLine(r, i1);
    const i2 = T.addLocalLine(model, r, j, null); T.setOverride(r, i2, '');
    if (JSON.stringify(r) === was) same++;
  }
  ok('add then remove leaves every example resume byte-identical', same === names.length && names.length > 10, `${same} of ${names.length}`);

  // an anchor that goes
  const m2 = clone(model), r2 = clone(plain);
  r2.localLines = { [job]: [{ id: '~new-1', after: hs[1] }, { id: '~new-2', after: hs[0] }] };
  K.deleteClaim(m2, hs[1], [r2]);
  const mid = r2.localLines[job][0].after;
  K.deleteClaim(m2, hs[0], [r2]);
  ok('deleting the bullet a line follows re-points it to the one before, or to the first place', mid === hs[0] && r2.localLines[job][0].after === null && r2.localLines[job][1].after === null);
  const r3 = clone(plain); r3.localLines = { [job]: [{ id: '~new-1', after: hs[2] }] }; r3.overrides = { ...r3.overrides, '~new-1': 'L' };
  ok('Fit leaving the anchor out leaves the line after the bullet before it, not at the end', eq(withLocal(r3, job, hs.filter(h => h !== hs[2]), { full: hs }), [hs[0], hs[1], '~new-1', ...hs.slice(3)]));
  const r4 = clone(plain), pr = model.projects[0].id;
  r4.localLines = { [pr]: [{ id: '~new-1', after: null }] }; r4.overrides = { ...r4.overrides, '~new-1': 'L' }; r4.overrideMeta = { '~new-1': { marks: [], base: null } };
  K.deleteEntry(clone(model), pr, [r4]);
  ok('deleting a project takes its lines and their text', r4.localLines === undefined && !('~new-1' in r4.overrides) && !('~new-1' in r4.overrideMeta));

  // a job over page slots
  const r5 = clone(plain), lb = T.listedBullets(model, r5, job), b5 = T.addLocalLine(model, r5, job, lb[1]);
  T.setOverride(r5, b5, 'LOCALXYZ', { marks: [], base: null });
  const slot = h => [{ id: 'experience', work: [{ id: job, highlights: h }] }];
  r5.pages = [slot([lb[0], lb[1]]), slot([lb[2], lb[3]])]; delete r5.pageLimit;
  const count = r => (html(r).match(/LOCALXYZ/g) ?? []).length;
  ok('a job over two slots prints the line once, in the slot that holds its anchor', count(r5) === 1 && html(r5).indexOf('LOCALXYZ') < html(r5).indexOf('class="page', 10));
  const r6 = clone(r5); r6.localLines[job][0].after = null;
  const r7 = clone(r5); r7.localLines[job][0].after = lb[3];
  ok('…with no anchor, in the first slot; in the last slot when it follows a line there', count(r6) === 1 && count(r7) === 1 && html(r7).indexOf('LOCALXYZ') > html(r6).indexOf('class="page', 10));

  // a file anyone can edit
  const bad = loc => { const f = S.saveResume(model, clone(plain)).file; f.meta.resumeBuilder.resume.localLines = loc; return S.loadResume(JSON.parse(JSON.stringify(f)), model); };
  const o = [bad({ [job]: 'x' }), bad({ [job]: [null, 7, { id: 5 }] }), bad({ [job]: [{ id: hs[0], after: null }] }), bad({ [job]: [{ id: '~a', after: null }], [model.work[1].id]: [{ id: '~a', after: null }] }), bad({ [job]: [{ id: '~a', after: 'nope' }] }), bad('x')];
  ok('malformed lines, a fact id, a repeated id and a dangling anchor are cleaned, each with a warning, and the page renders',
    o.every(w => w.warnings.length && (() => { try { html(w.recipe); return true; } catch { return false; } })())
    && [0, 1, 2, 5].every(i => o[i].recipe.localLines === undefined) && o[3].recipe.localLines[job].length === 1 && !o[3].recipe.localLines[model.work[1].id] && o[4].recipe.localLines[job][0].after === null);
  const dang = clone(plain); dang.localLines = { [job]: [{ id: '~a', after: 'nope' }] };
  const v = validate(S.save(model), dang);
  ok('the validator reports a dangling anchor', v.errors.some(e => e.includes('follows nope')), v.errors.join('|'));

  // compare
  const ca = clone(plain), cb = clone(plain), j2 = model.work[1].id;
  const t1 = T.addLocalLine(model, ca, job, null), t2 = T.addLocalLine(model, cb, job, null), t3 = T.addLocalLine(model, cb, j2, null);
  for (const [r, i] of [[ca, t1], [cb, t2], [cb, t3]]) T.setOverride(r, i, 'Same words', { marks: [], base: null });
  const rows = RS.compareRows(model, ca, cb).filter(r => r.kind === 'claim' && r.label === 'Same words');
  ok('compare treats the same words in the same job as one claim, and in another job as another', rows.length === 2 && rows.filter(r => !r.differs).length === 1, JSON.stringify(rows.map(r => r.differs)));
  const cc = clone(plain); T.setOverride(cc, T.addLocalLine(model, cc, j2, null), 'Same words', { marks: [], base: null });
  const other = RS.compareRows(model, ca, cc).filter(r => r.kind === 'claim' && r.label === 'Same words');
  ok('the same id in two resumes, on different jobs, is two claims that differ', other.length === 2 && other.every(r => r.differs));
}

section('skills arranged on the page (UX-6c-ii)');
{
  const m = clone(model), html = r => renderPages(m, r, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('');
  const rc = clone(S.loadResume(read(`data/example-resumes/${names[0]}`), m).recipe);
  const before = html(rc), groups0 = T.arrangementOf(m, rc).groups.map(g => g.id);
  ok('a resume with no arrangement prints as before', !rc.skillArrangement && html(clone(rc)) === before);
  T.writeGroup(m, rc, 'skills-cad', 'Tools\nCreo, Fusion 360\nKeyShot');
  const cad = rc.skillArrangement.groups.find(g => g.id === 'skills-cad');
  ok('writing a group: the first line is its name, the rest its skills (commas or line breaks)', cad.label === 'Tools' && eq(cad.items, ['Creo', 'Fusion 360', 'KeyShot']) && eq(rc.skillArrangement.groups.map(g => g.id), groups0));
  ok('…the first change copies the other groups as they print', rc.skillArrangement.groups.every(g => g.items.length) && T.groupText(m, rc, 'skills-cad') === 'Tools\nCreo, Fusion 360, KeyShot');
  const page = html(rc);
  ok('the renderer prints the arrangement: the name, the skills joined, in order', page.includes('>Tools</span><br><span class="skills__items">Creo, Fusion 360, KeyShot</span>') && !page.includes('SolidWorks (CSWP)') && page !== before);
  ok('one line only is its skills, the name stays', (T.writeGroup(m, rc, 'skills-cad', 'A, B'), rc.skillArrangement.groups[0].label === 'Tools' && eq(rc.skillArrangement.groups[0].items, ['A', 'B'])));
  const g = T.addSkillGroup(m, rc, 'skills-cad');
  ok('a new group follows the one it was added after, empty, and prints nowhere until it has skills', g === '~sg-1' && rc.skillArrangement.groups[1].id === g && !html(rc).includes('~sg-1'));
  T.writeGroup(m, rc, g, 'Process\nLean, 5S');
  ok('written, it prints under its own name', html(rc).includes('>Process</span><br><span class="skills__items">Lean, 5S</span>'));
  T.moveSkill(m, rc, 'skills-cad', 0, g, 1);
  ok('a skill moves to a place in another group', eq(rc.skillArrangement.groups[0].items, ['B']) && eq(rc.skillArrangement.groups[1].items, ['Lean', 'A', '5S']));
  T.moveSkill(m, rc, 'skills-cad', 0, g, 0);
  ok('a group left with no skills goes', !rc.skillArrangement.groups.some(x => x.id === 'skills-cad') && rc.skillArrangement.groups[0].id === g);
  T.moveSkillGroup(m, rc, g, null);
  ok('a group moves before another, or last', rc.skillArrangement.groups.at(-1).id === g);
  T.writeGroup(m, rc, g, '');
  ok('emptied, a group is removed', !rc.skillArrangement.groups.some(x => x.id === g));
  ok('an unknown group is refused', throws(() => T.writeGroup(m, rc, 'nope', 'x')) && throws(() => T.moveSkill(m, rc, 'nope', 0, g, 0)));
  const arranged = clone(rc);
  const back = S.loadResume(JSON.parse(JSON.stringify(S.saveResume(m, arranged).file)), m);
  ok('the arrangement comes back from the saved file, with no warnings', back.warnings.length === 0 && eq(back.recipe.skillArrangement, arranged.skillArrangement));
  const ex = X.jsonResumeFile(m, arranged).file, txt = X.plainText(ex);
  ok('the exports follow the arrangement: the JSON Resume file has the groups as arranged, and a skill taken off the page is not in the text', eq(ex.skills.map(x => x.name), arranged.skillArrangement.groups.map(g => g.label ?? T.groupLabel(m, arranged, g.id))) && !ex.skills.some(x => x.keywords.includes('SolidWorks (CSWP)')) && !txt.includes('SolidWorks (CSWP)') && txt.includes('Fabrication'), JSON.stringify(ex.skills));
  ok('…a resume with no arrangement exports the record\'s groups, and the old note is gone', X.jsonResumeFile(m, clone(S.loadResume(read(`data/example-resumes/${names[0]}`), m).recipe)).file.skills.some(x => x.keywords.includes('SolidWorks (CSWP)')) && !T.resolve(m, rc).problems.some(x => x.includes('arranges')));
  // a file anyone can edit
  const mal = v => { const f = S.saveResume(m, clone(arranged)).file; f.meta.resumeBuilder.resume.skillArrangement = v; return S.loadResume(JSON.parse(JSON.stringify(f)), m); };
  const bad = [mal('x'), mal({ groups: 'x' }), mal({ groups: [null, { id: 'a' }, { id: 'a', items: ['x'] }, { id: 'a', items: ['y'] }, { id: 'b', items: [1] }, { id: 'c', items: ['z'], label: 5 }] })];
  ok('a malformed arrangement is cleaned, each with a warning, and the page renders', bad.every(w => w.warnings.length && (() => { try { html(w.recipe); return true; } catch { return false; } })())
    && bad[0].recipe.skillArrangement === undefined && bad[1].recipe.skillArrangement === undefined && eq(bad[2].recipe.skillArrangement.groups, [{ id: 'a', items: ['x'] }, { id: 'c', items: ['z'] }]), JSON.stringify(bad.map(w => w.recipe.skillArrangement)));
  // sets per language: hu falls back to en, and what falls back is listed as untranslated
  const hr = T.newResume(m, { lang: 'hu' });
  T.saveSetForTag(m, 'Hardware', { groups: [{ id: 'skills-fabrication', items: ['CAD', 'FEA'] }] });
  T.applySet(m, hr, 'Hardware');
  ok('a set with no hu groups starts a hu resume from the en ones, and says so', hr.skillArrangement.lang === 'en' && eq(hr.skillArrangement.groups, [{ id: 'skills-fabrication', items: ['CAD', 'FEA'] }]));
  ok('…those groups are listed as untranslated', L.missingList(m, hr).some(x => x.id === 'skills-fabrication' && x.key === 'fact:skills-fabrication'));
  T.writeGroup(m, hr, 'skills-fabrication', 'CAD\nCAD, VEM');
  ok('…until written in hu', !L.missingList(m, hr).some(x => x.id === 'skills-fabrication'));
  T.saveSetForTag(m, 'Hardware', { groups: [{ id: 'skills-fabrication', items: ['CAD', 'VEM'] }] }, 'hu');
  T.applySet(m, hr, 'Hardware');
  ok('a set that has hu groups does not fall back', hr.skillArrangement.lang === undefined && eq(Object.keys(m.skillSets.Hardware), ['en', 'hu']));
  // the arrangement as a set for a tag
  T.saveSetForTag(m, 'Medical', T.arrangementOf(m, arranged), 'en');
  const again = clone(rc); T.applySet(m, again, 'Medical');
  ok('saved as the set for a tag, and applied from it, the arrangement is the same', eq(again.skillArrangement.groups, arranged.skillArrangement.groups) && again.skillArrangement.from === 'Medical');
}

section('skill sets follow their tag and job type; a fallback set is saved as English; no skills, no band');
{
  const m = clone(model), html = r => renderPages(m, r, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('');
  const rc = clone(S.loadResume(read(`data/example-resumes/${names[0]}`), m).recipe);
  T.writeGroup(m, rc, 'skills-cad', 'Tools\nCreo');
  const emptied = clone(rc); emptied.skillArrangement.groups = [];
  ok('an arrangement with no groups prints no Skills band, and none with only empty groups', !html(emptied).includes('data-section="skills"') && !/>Skills</.test(html(emptied)) && html(rc).includes('>Tools</span>'));
  const [t1, t2] = m.vocabulary.tags;      // two tags of the record's own list
  const arr = clone(T.arrangementOf(m, rc));
  T.saveSetForTag(m, t1, { ...arr, lang: 'en' }, 'hu');
  ok('groups that are still the English fallback are saved as the English set', eq(Object.keys(m.skillSets[t1]), ['en']));
  T.saveSetForTag(m, t2, arr, 'hu');
  const mine = clone(rc); mine.skillArrangement.from = t1;
  K.renameTag(m, t1, 'Renamed tag', [mine]);
  ok('renaming a tag renames its skill set and the arrangements that began as it', !m.skillSets[t1] && !!m.skillSets['Renamed tag'] && mine.skillArrangement.from === 'Renamed tag');
  K.mergeTag(m, 'Renamed tag', t2, [mine]);
  ok('merging keeps the target\'s sets and adds the other\'s', eq(Object.keys(m.skillSets), [t2]) && eq(Object.keys(m.skillSets[t2]).sort(), ['en', 'hu']) && mine.skillArrangement.from === t2);
  K.deleteTag(m, t2, [mine]);
  ok('deleting a tag deletes its set and unlinks the arrangements', !m.skillSets && mine.skillArrangement.from === undefined);
  const jt = K.addJobType(m, 'CAD jobs', []); T.saveSetForTag(m, 'CAD jobs', arr, 'en');
  const two = clone(rc); two.skillArrangement.from = 'CAD jobs';
  K.renameJobType(m, jt, 'Design jobs', [two]);
  ok('renaming a job type renames its set too', !!m.skillSets['Design jobs'] && !m.skillSets['CAD jobs'] && two.skillArrangement.from === 'Design jobs');
}
section('an edited contact line keeps the links whose words it still has');
{
  const m = clone(model), html = r => renderPages(m, r, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('');
  const rc = clone(S.loadResume(read(`data/example-resumes/${names[0]}`), m).recipe);
  T.setOverride(rc, 'contact', 'Lisbon  ·  dana@example.org  ·  +351 900 000 000', { marks: [], base: 'contact-v1' });
  const page = html(rc);
  ok('the link whose words are still there stays, re-anchored; the one whose words went is dropped, with a warning', page.includes('<a href="mailto:dana@example.org">dana@example.org</a>') && !page.includes('https://danaokonkwo.example') && T.resolve(m, rc).problems.some(x => x.includes('dropped the link to https://danaokonkwo.example')) && !T.resolve(m, rc).problems.some(x => x.includes('dropped the link to mailto')));
}
section('every printed text can be written on the resume: an edit with its base and highlights, a heading, a language\'s name (UX-6c-iii-a)');
{
  const m = clone(model), page = r => renderPages(m, r, createDocument(), { fallback: true, annotate: true }).pages.map(p => p.outerHTML).join('');
  const rc = clone(S.loadResume(read('data/example-resumes/Medtech Lisboa - Mechanical Engineer.json'), m).recipe);
  const baseOf = id => m.facts.find(f => f.id === id).variants.map(v => m.variants.find(x => x.id === v)).find(v => (v.lang ?? 'en') === 'en').id;
  // the header, a job's title and dates, education's three fields, patent, a certificate, a language's level, an interest
  const ids = ['tagline', 'name', 'contact', 'hydra-position', 'hydra-meta', 'edu-degree', 'edu-school', 'edu-meta', 'patent-title', 'patent-meta', 'cert-gdt', 'lang-portuguese', 'interest-sailing'];
  ids.forEach((id, n) => T.setOverride(rc, id, `Edited ${n}`, { marks: [], base: baseOf(id) }));
  const printed = page(rc);
  ok('each of them prints as an edit, on the page the app draws and in what is sent', ids.every((id, n) => printed.includes(`data-variant="${id}-override"`) && printed.includes(`Edited ${n}`)));
  ok('each is on the Review list (pendingEdits) with its base version and its marks, so UX-6d can offer it as a version', eq(T.pendingEdits(rc).sort(), [...ids].sort()) && ids.every(id => rc.overrideMeta[id].base === baseOf(id) && Array.isArray(rc.overrideMeta[id].marks)));
  ok('an edit equal to its base drops, and the resume is as it was', (() => { const r2 = clone(rc); for (const id of ids) T.dropOverride(r2, id); return !r2.overrides || !Object.keys(r2.overrides).length; })());
  // a heading: the existing per-language label
  const r3 = clone(S.loadResume(read('data/example-resumes/Medtech Lisboa - Mechanical Engineer.json'), m).recipe), before = JSON.stringify(r3);
  T.setLabel(m, r3, '~h:education', 'en', 'Study');
  ok('a heading is written in the resume\'s language and prints, with its page key', T.labelOf(m, r3, 'education', 'en') === 'Study' && page(r3).includes('data-label="h:education">Study</h2>') && T.labelNow(m, r3, '~h:education', 'en') === 'Study');
  T.setLabel(m, r3, '~h:education', 'hu', 'Tanulmányok');
  ok('…another language keeps its own', T.labelOf(m, r3, 'education', 'en') === 'Study' && T.labelOf(m, r3, 'education', 'hu') === 'Tanulmányok');
  T.setLabel(m, r3, '~h:education', 'hu', T.recordTitle(m, 'education', 'hu')); T.setLabel(m, r3, '~h:education', 'en', ' Education ');
  ok('the record\'s own words (or none) take it back, and the resume is as it was', JSON.stringify(r3) === before && T.labelNow(m, r3, '~h:education', 'en') === 'Education');
  // a language's name: this resume's own, per language
  T.setLabel(m, r3, '~t:lang-portuguese', 'en', 'Portuguese (native)');
  const html3 = page(r3);
  ok('a language\'s name is kept on this resume and prints, with its page key', eq(r3.terms, { 'lang-portuguese': { en: 'Portuguese (native)' } }) && html3.includes('data-label="t:lang-portuguese">Portuguese (native)</dt>') && T.labelNow(m, r3, '~t:lang-portuguese', 'en') === 'Portuguese (native)');
  ok('…the same text in another language is not it', !renderPages(m, { ...r3, lang: 'hu', picks: {}, overrides: {} }, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('').includes('Portuguese (native)'));
  T.setLabel(m, r3, '~t:lang-portuguese', 'en', 'Portuguese');
  ok('the record\'s name takes it back: no `terms` key is left', JSON.stringify(r3) === before && !('terms' in r3));
  ok('a name or heading that was never written leaves no trace in what is sent', !renderPages(m, rc, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('').includes('data-label'));
}
section('UX-6c-iii-a fixes: line breaks, hand-edited names, dropped facts, edits per language');
{
  const r = T.newResume(model, {});
  T.setLabel(model, r, '~h:education', 'en', 'Stud\n  ies');
  T.setLabel(model, r, '~t:lang-portuguese', 'en', 'Luso\nphone ');
  ok('a heading and a name written with line breaks are stored on one line', r.sections.find(x => x.id === 'education').label.en === 'Stud ies' && r.terms['lang-portuguese'].en === 'Luso phone', JSON.stringify([r.terms, r.sections.find(x => x.id === 'education').label]));
  const bad = clone(r); bad.terms = { 'lang-portuguese': 'Luso', 'x': { en: 5, hu: 'ok' }, 'y': 7 };
  const back = S.loadResume(S.saveResume(model, bad).file, model);
  ok('terms read from a file keep only names by language', JSON.stringify(back.recipe.terms) === JSON.stringify({ x: { hu: 'ok' } }) && back.warnings.some(m => /terms/.test(m)), JSON.stringify(back.recipe.terms));
  K.deleteItem(clone(model), 'languages', 'lang-portuguese', [r]);
  ok('dropping a fact leaves no name for it in terms', !('terms' in r), JSON.stringify(r.terms));
  const e = T.newResume(model, {});
  T.setOverride(e, 'edu-degree', 'English words', { marks: [], base: 'edu-degree-v1' });
  L.switchLang(e, 'hu'); T.setOverride(e, 'edu-degree', 'Magyar', { marks: [], base: 'other' });
  L.switchLang(e, 'en');
  ok('an edit keeps its base and marks per language', e.overrides['edu-degree'] === 'English words' && e.overrideMeta['edu-degree'].base === 'edu-degree-v1', JSON.stringify(e.overrideMeta));
}
section('a resume that uses none of it renders as before (the 14 example resumes)');
{
  // SHA-256 of every example resume's pages, in file order, as drawn before UX-6c-i. Change it only when the example or the renderer is meant to change.
  const h = crypto.createHash('sha256');
  for (const n of fs.readdirSync(path.join(REPO, 'data/example-resumes')).filter(f => f.endsWith('.json') && f !== 'index.json').sort())
    h.update(renderPages(model, S.loadResume(read(`data/example-resumes/${n}`), model).recipe, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join(''));
  ok('the 14 example resumes hash to what they always did', h.digest('hex') === 'a8e35aad45ca8f34f3a8a53a4f9cdfd44ff68f1a465445b43e5f5fa17b5c406d');
}

console.log(failed ? `\n${failed} direct check(s) FAILED` : '\nall direct checks passed');
process.exit(failed ? 1 : 0);
