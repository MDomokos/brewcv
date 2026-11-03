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
import * as SB from '../src/model/skillbank.js';

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
  T.setOverride(model, r, 'f', 'Plain');
  ok('the old call leaves no meta behind', eq(r, { picks: {}, overrides: { f: 'Plain' } }));
  T.setOverride(model, r, 'f', 'Edited text', { marks: [{ start: 0, end: 6 }], base: 'f-v1' });
  ok('an override keeps its marks and base version', eq(r.overrideMeta.f, { marks: [{ start: 0, end: 6 }], base: 'f-v1' }) && r.overrides.f === 'Edited text');
  T.setOverride(model, r, 'f', 'Text only');
  ok('a text-only call drops the old meta', !('f' in r.overrideMeta) && r.overrides.f === 'Text only');
  T.setOverride(model, r, 'f', 'Edited text', { marks: [{ start: 0, end: 6 }], base: 'f-v1' });
  T.setOverride(model, r, 'f', 'Edited again', { marks: [] });
  ok('the base survives a second edit', r.overrideMeta.f.base === 'f-v1');
  ok('overrideOf says it is on', T.overrideOf(r, 'f').on === true && T.overrideOf(r, 'f').base === 'f-v1' && T.overrideOf(r, 'g') === null);
  T.parkOverride(model, r, 'f');
  ok('parked: not an override any more, but kept', !('f' in r.overrides) && !r.overrideMeta.f && r.parked.f.text === 'Edited again' && T.overrideOf(r, 'f').on === false);
  T.unparkOverride(model, r, 'f');
  ok('unparked: back, with its meta, and no longer parked', r.overrides.f === 'Edited again' && r.overrideMeta.f.base === 'f-v1' && !r.parked.f);
  T.parkOverride(model, r, 'nothing');
  ok('parking what is not an override does nothing', !('nothing' in (r.parked ?? {})));
  T.pickVersion(model, r, 'f', 'f-v2');
  ok('picking a version parks the edit', r.picks.f === 'f-v2' && !('f' in r.overrides) && r.parked.f.text === 'Edited again');
  T.dropOverride(model, r, 'f');
  ok('drop forgets it wherever it is', !r.parked?.f && !('f' in (r.overrides ?? {})) && T.overrideOf(r, 'f') === null);
  T.setOverride(model, r, 'f', 'Again', { marks: [] }); T.setOverride(model, r, 'g', 'Other', { marks: [] });
  ok('both are pending', eq(T.pendingEdits(r), ['f', 'g']));
  T.keepHere(r, 'f');
  ok('kept here leaves the pending list, and the edit stays', eq(T.pendingEdits(r), ['g']) && r.overrides.f === 'Again' && r.overrideMeta.f.kept === true);
  T.keepHere(r, 'h');
  ok('keeping an edit with no meta does not throw', r.overrideMeta.h.kept === true);
  T.setOverride(model, r, 'g', '');
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

section('photo');
{
  const r = {};
  T.setPhoto(model, r, { show: true });
  ok('setPhoto fills in the shape', eq(r.photo, { show: true, shape: 'rect' }));
  T.setPhoto(model, r, { shape: 'round' });
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
  T.setOverride(model, rc, f.id, 'An edit', { marks: [{ start: 0, end: 2 }], base: f.variants[0] });
  T.parkOverride(model, rc, f.id);
  T.setArrangement(rc, { from: 'Prototyping', groups: [{ id: 'skills-cad', items: ['CAD'] }] });
  rc.parent = 'Some other.json';
  const { file } = S.saveResume(model, rc);
  const back = S.loadResume(JSON.parse(JSON.stringify(file)), model);
  ok('parent, parked, overrideMeta and skillArrangement come back as saved, with no warnings', back.warnings.length === 0 && eq(back.recipe.parked, rc.parked) && eq(back.recipe.skillArrangement, rc.skillArrangement) && back.recipe.parent === rc.parent);
  const edited = clone(rc); T.unparkOverride(model, edited, f.id);
  ok('overrideMeta is carried', eq(S.loadResume(JSON.parse(JSON.stringify(S.saveResume(model, edited).file)), model).recipe.overrideMeta, edited.overrideMeta));
  const old = S.saveResume(model, plain).file;
  ok('a file without the keys opens with no warnings', S.loadResume(JSON.parse(JSON.stringify(old)), model).warnings.length === 0 && !JSON.stringify(old).includes('overrideMeta') && !JSON.stringify(old).includes('"parent"'));
  const html = r => renderPages(model, r, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('');
  const ignorant = clone(back.recipe); for (const k of ['parent', 'parked', 'overrideMeta']) delete ignorant[k];       // the skill arrangement prints, so code that ignores it is not the same
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
  T.setOverride(model, rc, a, 'Piloted the bench trial', { marks: [{ start: 12, end: 17 }], base: null });
  T.setOverride(model, rc, b, 'Ran the first build', { marks: [], base: null });
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
  ok('resolve names a record override as before', (() => { const r2 = mk(); T.setOverride(model, r2, first[0], 'x'); return T.resolve(model, r2).problems.some(p => /overrides hydra-inhaler with one-off text/.test(p)); })());

  // remove
  const gone = clone(rc);
  T.removeLocalLine(model, gone, b);
  ok('removing takes the line, its text and its place', !T.isLocal(gone, b) && !(b in gone.overrides) && !(b in (gone.overrideMeta ?? {})) && !T.listedBullets(model, gone, job).includes(b) && T.isLocal(gone, a));
  T.removeLocalLine(model, gone, a);
  ok('the last one takes the key too', gone.localLines === undefined && eq(T.listedBullets(model, gone, job), first));
  const emptied = clone(rc); T.setOverride(model, emptied, a, '');
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
  T.removeLocalLine(model, st.cur, a); RS.settle(st);
  ok('and removing it from the resume never changes the snapshot', JSON.stringify(RS.snapshotsOf(RS.savedOf(st, id0)).find(x => x.id === snap.id)) === before);

  // the language: the line stays as typed and is listed as untranslated
  const hu = clone(rc);
  L.switchLang(hu, 'hu');
  ok('switching language keeps the line, as typed', hu.overrides[a] === 'Piloted the bench trial' && T.listedBullets(model, hu, job).includes(a));
  ok('and lists it as a text with no version in that language', L.missingList(model, hu).some(m => m.id === a));
  const there = clone(hu); T.setOverride(model, there, a, 'Vezette a padi próbát');
  L.switchLang(there, 'en');
  ok('the line is the same one back in English; a record edit of the other language is unaffected', there.overrides[a] === 'Vezette a padi próbát' && !L.missingList(model, there).some(m => m.id === a));
  const typedHu = clone(plain); typedHu.lang = 'hu'; const c = T.addLocalLine(model, typedHu, job, null);
  T.setOverride(model, typedHu, c, 'Vezette a próbát');
  ok('a line typed in a language is not listed in that language, and is in another', !L.missingList(model, typedHu).some(m => m.id === c) && L.missingList(model, { ...typedHu, lang: 'de' }).some(m => m.id === c));

  // undo, through the store
  const store = createStore({ record: clone(model), cur: mk() });
  let id;
  store.commit(d => { id = T.addLocalLine(d.record, d.cur, job, T.listedBullets(d.record, d.cur, job).at(-1)); }, 'add a line');
  store.commit(d => { T.setOverride(model, d.cur, id, 'Typed once', { marks: [], base: null }); }, 'edit');
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
  const full = clone(rc); T.setOverride(model, full, a, 'x', { marks: [], base: null });
  ok('with a word in it, it prints', lis(html(full)) === lis(html(plain)) + 1);
  const lines = clone(rc), a2 = T.addLocalLine(model, lines, job, a); T.setOverride(model, lines, a2, 'second', { marks: [], base: null });
  ok('a line after an empty one keeps its place', T.resolve(model, lines).body.work[0].highlights.at(-1) === 'second');

  const x = clone(plain), id = T.addLocalLine(model, x, job, null);
  T.setOverride(model, x, id, 'Typed', { marks: [], base: null });
  L.switchLang(x, 'hu'); const flagged = L.missingList(model, x).some(m => m.id === id);
  T.setOverride(model, x, id, 'Gépelt', { marks: [], base: null }); const cleared = !L.missingList(model, x).some(m => m.id === id);
  const xen = clone(x); L.switchLang(xen, 'en');      // the Review list is empty in English by design; the line keeps the language it was typed in
  ok('retyping a line in another language clears its flag, and it is flagged in a third', flagged && cleared && xen.localLines[job][0].lang === 'hu' && L.missingList(model, { ...x, lang: 'de' }).some(m => m.id === id));

  let same = 0;
  for (const n of names){
    const r = mk(n), was = JSON.stringify(r), j = model.work.find(w => T.listedBullets(model, r, w.id).length)?.id ?? job;
    const i1 = T.addLocalLine(model, r, j, null); T.removeLocalLine(model, r, i1);
    const i2 = T.addLocalLine(model, r, j, null); T.setOverride(model, r, i2, '');
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
  T.setOverride(model, r5, b5, 'LOCALXYZ', { marks: [], base: null });
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
  for (const [r, i] of [[ca, t1], [cb, t2], [cb, t3]]) T.setOverride(model, r, i, 'Same words', { marks: [], base: null });
  const rows = RS.compareRows(model, ca, cb).filter(r => r.kind === 'claim' && r.label === 'Same words');
  ok('compare treats the same words in the same job as one claim, and in another job as another', rows.length === 2 && rows.filter(r => !r.differs).length === 1, JSON.stringify(rows.map(r => r.differs)));
  const cc = clone(plain); T.setOverride(model, cc, T.addLocalLine(model, cc, j2, null), 'Same words', { marks: [], base: null });
  const other = RS.compareRows(model, ca, cc).filter(r => r.kind === 'claim' && r.label === 'Same words');
  ok('the same id in two resumes, on different jobs, is two claims that differ', other.length === 2 && other.every(r => r.differs));
}

section('a resume\'s own skill groups: words from the bank, placed, moved and taken back');
{
  const m = clone(model), html = r => renderPages(m, r, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('');
  const rc = clone(S.loadResume(read(`data/example-resumes/${names[0]}`), m).recipe);
  const before = html(rc), groups0 = T.arrangementOf(m, rc).groups.map(g => g.id), id = n => SB.findWord(m, n).id;
  const texts = g => g.items.map(x => SB.wordText(m, x).text);
  ok('a resume with no groups of its own prints the record\'s, and lists their words as on it', !rc.skillArrangement && html(clone(rc)) === before && T.wordsOnResume(m, rc).get(id('Creo')) === 'skills-cad');
  T.takeWord(m, rc, id('SolidWorks (CSWP)'));
  ok('taking a word off copies the groups as they print, as the bank\'s words, without it', eq(rc.skillArrangement.groups.map(g => g.id), groups0) && rc.skillArrangement.groups.every(g => g.items.every(x => SB.wordOf(m, x))) && eq(texts(rc.skillArrangement.groups[0]), ['Creo', 'Fusion 360', 'KeyShot']));
  const page = html(rc);
  ok('the renderer prints the groups: the heading, the words joined, in order', page.includes('>CAD &amp; 3D</span><br><span class="skills__items">Creo, Fusion 360, KeyShot</span>') && !page.includes('SolidWorks (CSWP)') && page !== before);
  T.placeWord(m, rc, id('SolidWorks (CSWP)'), 'skills-software', id('Git'));
  ok('a word from the bank goes into a group, before a word, or at its end', eq(texts(rc.skillArrangement.groups[3]), ['Python', 'MATLAB', 'SolidWorks (CSWP)', 'Git', 'Excel']));
  T.placeWord(m, rc, id('SolidWorks (CSWP)'), 'skills-cad');
  ok('…from another group it moves, never twice on a resume', eq(texts(rc.skillArrangement.groups[0]), ['Creo', 'Fusion 360', 'KeyShot', 'SolidWorks (CSWP)']) && !rc.skillArrangement.groups[3].items.includes(id('SolidWorks (CSWP)')));
  const g = T.addSkillGroup(m, rc, 'skills-cad');
  ok('a new group follows the one it was added after (none: last), empty, and prints nowhere until it has words', g === '~sg-1' && rc.skillArrangement.groups[1].id === g && !html(rc).includes('~sg-1') && T.addSkillGroup(m, clone(rc)) === '~sg-2');
  T.setGroupHeading(m, rc, g, 'Process'); T.placeWord(m, rc, id('PPAP'), g);
  ok('its heading written, it prints under it', html(rc).includes('>Process</span><br><span class="skills__items">PPAP</span>') && rc.skillArrangement.groups[1].label === 'Process' && rc.skillArrangement.groups[1].lang === 'en');
  T.moveSkill(m, rc, 'skills-cad', 0, g, 1);
  ok('a word moves to a place in another group (the keyboard route)', eq(texts(rc.skillArrangement.groups[1]), ['PPAP', 'Creo']));
  for (const w of [...rc.skillArrangement.groups[0].items]) T.takeWord(m, rc, w);
  ok('a group left with no words stays, and prints nothing', rc.skillArrangement.groups[0].id === 'skills-cad' && !rc.skillArrangement.groups[0].items.length && !html(rc).includes('CAD &amp; 3D'));
  T.moveSkillGroup(m, rc, g, null);
  ok('a group moves before another, or last', rc.skillArrangement.groups.at(-1).id === g);
  T.removeSkillGroup(m, rc, g);
  ok('a group deleted from the resume is gone, its words still in the bank', !rc.skillArrangement.groups.some(x => x.id === g) && !!SB.wordOf(m, id('PPAP')));
  ok('an unknown group or word is refused', throws(() => T.removeSkillGroup(m, rc, 'nope')) && throws(() => T.placeWord(m, rc, 'sw-nope', 'skills-software')) && throws(() => T.moveSkill(m, rc, 'nope', 0, 'skills-cad', 0)));
  // headings: its own in this language, a shelf's name, or the record group's back
  const sh = SB.addShelf(m, 'Design'); SB.setShelfName(m, sh.id, 'de', 'Konstruktion');
  T.setGroupHeading(m, rc, 'skills-cad', 'design');
  ok('a heading that is a shelf\'s name uses the shelf\'s name, in every language', rc.skillArrangement.groups[0].shelf === sh.id && rc.skillArrangement.groups[0].label === undefined && T.printedLabel(m, { ...rc, lang: 'de' }, '~g:skills-cad') === 'Konstruktion');
  T.setLabel(m, rc, '~g:skills-cad', 'en', 'CAD & 3D');
  ok('…the record group\'s own heading takes it back to the record\'s', !('shelf' in rc.skillArrangement.groups[0]) && !('label' in rc.skillArrangement.groups[0]));
  const arranged = clone(rc);
  const back = S.loadResume(JSON.parse(JSON.stringify(S.saveResume(m, arranged).file)), m);
  ok('the groups come back from the saved file, with no warnings', back.warnings.length === 0 && eq(back.recipe.skillArrangement, arranged.skillArrangement));
  const ex = X.jsonResumeFile(m, arranged).file, txt = X.plainText(ex);
  ok('the exports follow the groups: a word taken off the page is not in the JSON Resume file or the text', !ex.skills.some(x => x.keywords.includes('KeyShot')) && !txt.includes('KeyShot') && txt.includes('Fabrication'), JSON.stringify(ex.skills));
  // start from another resume
  const other = clone(S.loadResume(read(`data/example-resumes/${names[1]}`), m).recipe);
  T.useGroupsOf(m, other, arranged);
  ok('starting from another resume copies its groups, as words, in place of this one\'s', eq(other.skillArrangement.groups.map(x => x.items), arranged.skillArrangement.groups.map(x => x.items)));
  // a file anyone can edit
  const mal = v => { const f = S.saveResume(m, clone(arranged)).file; f.meta.resumeBuilder.resume.skillArrangement = v; return S.loadResume(JSON.parse(JSON.stringify(f)), m); };
  const bad = [mal('x'), mal({ groups: 'x' }), mal({ groups: [null, { id: 'a' }, { id: 'a', items: ['x'] }, { id: 'a', items: ['y'] }, { id: 'b', items: [1] }, { id: 'c', items: ['z'], label: 5 }] })];
  ok('a malformed arrangement is cleaned, each with a warning, and the page renders', bad.every(w => w.warnings.length && (() => { try { html(w.recipe); return true; } catch { return false; } })())
    && bad[0].recipe.skillArrangement === undefined && bad[1].recipe.skillArrangement === undefined && eq(bad[2].recipe.skillArrangement.groups, [{ id: 'a', items: ['x'] }, { id: 'c', items: ['z'] }]), JSON.stringify(bad.map(w => w.recipe.skillArrangement)));
  const emptied = clone(rc); emptied.skillArrangement.groups = [];
  ok('an arrangement with no groups prints no Skills band, and none with only empty groups', !html(emptied).includes('data-section="skills"') && !/>Skills</.test(html(emptied)));
  // the set of an older version: still in the file, and its tag still follows a rename
  const [t1] = m.vocabulary.tags; m.skillSets = { [t1]: { en: [{ id: 'skills-cad', items: ['Creo'] }] } };
  K.renameTag(m, t1, 'Renamed tag', []);
  ok('an older version\'s skill set is kept and follows its tag', !!m.skillSets['Renamed tag']);
}
section('an edited contact line keeps the links whose words it still has');
{
  const m = clone(model), html = r => renderPages(m, r, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('');
  const rc = clone(S.loadResume(read(`data/example-resumes/${names[0]}`), m).recipe);
  T.setOverride(model, rc, 'contact', 'Lisbon  ·  dana@example.org  ·  +351 900 000 000', { marks: [], base: 'contact-v1' });
  const page = html(rc);
  ok('the link whose words are still there stays, re-anchored; the one whose words went is dropped, with a warning', page.includes('<a href="mailto:dana@example.org">dana@example.org</a>') && !page.includes('https://danaokonkwo.example') && T.resolve(m, rc).problems.some(x => x.includes('dropped the link to https://danaokonkwo.example')) && !T.resolve(m, rc).problems.some(x => x.includes('dropped the link to mailto')));
}
section('every printed text can be written on the resume: an edit with its base and highlights, a heading, a language\'s name');
{
  const m = clone(model), page = r => renderPages(m, r, createDocument(), { fallback: true, annotate: true }).pages.map(p => p.outerHTML).join('');
  const rc = clone(S.loadResume(read('data/example-resumes/Medtech Lisboa - Mechanical Engineer.json'), m).recipe);
  const baseOf = id => m.facts.find(f => f.id === id).variants.map(v => m.variants.find(x => x.id === v)).find(v => (v.lang ?? 'en') === 'en').id;
  // the header, a job's title and dates, education's three fields, patent, a certificate, a language's level, an interest
  const ids = ['tagline', 'name', 'contact', 'hydra-position', 'hydra-meta', 'edu-degree', 'edu-school', 'edu-meta', 'patent-title', 'patent-meta', 'cert-gdt', 'lang-portuguese', 'interest-sailing'];
  ids.forEach((id, n) => T.setOverride(model, rc, id, `Edited ${n}`, { marks: [], base: baseOf(id) }));
  const printed = page(rc);
  ok('each of them prints as an edit, on the page the app draws and in what is sent', ids.every((id, n) => printed.includes(`data-variant="${id}-override"`) && printed.includes(`Edited ${n}`)));
  ok('each is on the Review list (pendingEdits) with its base version and its marks, so the Review list can offer it as a version', eq(T.pendingEdits(rc).sort(), [...ids].sort()) && ids.every(id => rc.overrideMeta[id].base === baseOf(id) && Array.isArray(rc.overrideMeta[id].marks)));
  ok('an edit equal to its base drops, and the resume is as it was', (() => { const r2 = clone(rc); for (const id of ids) T.dropOverride(model, r2, id); return !r2.overrides || !Object.keys(r2.overrides).length; })());
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
section('line breaks, hand-edited names, dropped facts, edits per language');
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
  T.setOverride(model, e, 'edu-degree', 'English words', { marks: [], base: 'edu-degree-v1' });
  L.switchLang(e, 'hu'); T.setOverride(model, e, 'edu-degree', 'Magyar', { marks: [], base: 'other' });
  L.switchLang(e, 'en');
  ok('an edit keeps its base and marks per language', e.overrides['edu-degree'] === 'English words' && e.overrideMeta['edu-degree'].base === 'edu-degree-v1', JSON.stringify(e.overrideMeta));
}
section('the lock');
{
  const LK = await import('../src/model/lock.js');
  const F = await import('../src/model/focus.js');
  const lockedErr = fn => { try { fn(); return false; } catch (e){ return e instanceof LK.LockedError; } };
  const withLock = (r, ...ids) => { const c = clone(r); for (const id of ids) LK.setLocked(c, id, true); return c; };
  const base = T.newResume(model, {});
  const job = 'hydra', line = 'hydra-inhaler', other = 'poly', otherLine = model.work.find(w => w.id === other).highlights[0];
  const nobody = clone(base); delete nobody.locked;

  // isLocked walks up the ancestors, and only up
  const lk = (r, id) => LK.isLocked(model, r, id);
  const every = (r, ids) => ids.every(id => lk(r, id)), none = (r, ids) => ids.every(id => !lk(r, id));
  const rl = clone(base); const added = T.addLocalLine(model, rl, job, line);
  ok('nothing is locked by default', none(base, [line, job, 'experience', LK.PAGE, '~h:experience', 'name']) && !('locked' in base));
  ok('a locked line locks that line only', every(withLock(rl, line), [line]) && none(withLock(rl, line), [job, 'hydra-testing', otherLine, 'experience']));
  ok('a locked job locks its bullets, title, date line and local lines, not another job', every(withLock(rl, job), [job, line, 'hydra-position', 'hydra-meta', added]) && none(withLock(rl, job), [other, otherLine, 'experience', '~h:experience']));
  ok('a locked section locks its heading, jobs and bullets', every(withLock(rl, 'experience'), ['experience', '~h:experience', job, line, 'hydra-position', added, other, otherLine]) && none(withLock(rl, 'experience'), ['skills', 'skills-cad', 'name']));
  ok('a locked heading locks the heading only', every(withLock(rl, '~h:experience'), ['~h:experience']) && none(withLock(rl, '~h:experience'), ['experience', job, line]));
  ok('a locked list section locks its items and their names; a locked name locks that name', every(withLock(rl, 'languages'), ['lang-portuguese', '~t:lang-portuguese', '~h:languages']) && lk(withLock(rl, '~t:lang-portuguese'), '~t:lang-portuguese') && !lk(withLock(rl, '~t:lang-portuguese'), 'lang-english'));
  ok('a locked skills section locks its groups and the groups made on the page', every(withLock(rl, 'skills'), ['skills-cad', '~sg-1', '~h:skills']) && none(withLock(rl, 'skills'), ['experience']));
  ok('a locked skill group locks that group', lk(withLock(rl, 'skills-cad'), 'skills-cad') && !lk(withLock(rl, 'skills-cad'), 'skills-software'));
  ok('the header locks its parts and the photo', every(withLock(rl, 'header'), ['name', 'tagline', 'contact', 'photo']) && lk(withLock(rl, 'name'), 'name') && !lk(withLock(rl, 'name'), 'contact'));
  ok('an item section (education) locks its fields', every(withLock(rl, 'education'), ['edu-degree', 'edu-school', 'edu-meta']) && !lk(withLock(rl, 'edu-degree'), 'edu-school'));
  ok('the page lock locks everything, even an id it has never heard of', every(withLock(rl, LK.PAGE), [line, job, 'experience', '~h:skills', 'name', 'photo', added, 'no-such-id']));
  ok('lockedBy names the lock that holds a child', LK.lockedBy(model, withLock(rl, job), line) === job && LK.lockedBy(model, withLock(rl, job), other) === null);
  const un = withLock(rl, line); LK.setLocked(un, line, false);
  ok('unlocking the last lock leaves no key at all', !('locked' in un) && JSON.stringify(un) === JSON.stringify(rl));

  // every function that changes locked content or its place refuses and leaves the recipe as it was; the same call on an unlocked one works
  const jobs = model.work.map(w => w.id), itemOf = 'cert-gdt', sec = 'certified';
  const calls = {
    setOverride: [line, r => T.setOverride(model, r, line, 'Typed', { marks: [], base: null })],
    'setOverride (header)': ['name', r => T.setOverride(model, r, 'name', 'Typed', { marks: [], base: null })],
    dropOverride: [line, r => T.dropOverride(model, r, line)],
    parkOverride: [line, r => T.parkOverride(model, r, line)],
    unparkOverride: [line, r => T.unparkOverride(model, r, line)],
    pickVersion: [line, r => T.pickVersion(model, r, line, model.facts.find(f => f.id === line).variants[0])],
    setBulletOn: [line, r => T.setBulletOn(model, r, line, false)],
    setKeep: [line, r => T.setKeep(model, r, line, true)],
    moveBullet: [line, r => T.moveBullet(model, r, line, null)],
    stepBullet: [line, r => T.stepBullet(model, r, line, 1)],
    setJobOn: [job, r => T.setJobOn(model, r, job, false)],
    moveEntry: [job, r => T.moveEntry(model, r, job, null)],
    stepEntry: [job, r => T.stepEntry(model, r, job, 1)],
    moveSection: ['skills', r => T.moveSection(model, r, 'skills', null)],
    stepSection: ['skills', r => T.stepSection(model, r, 'skills', 1)],
    setSectionOn: ['skills', r => T.setSectionOn(model, r, 'skills', false)],
    moveItem: [itemOf, r => T.moveItem(model, r, sec, itemOf, null)],
    stepItem: [itemOf, r => T.stepItem(model, r, sec, itemOf, -1)],
    setItemOn: [itemOf, r => T.setItemOn(model, r, itemOf, false)],
    setLabel: ['~h:education', r => T.setLabel(model, r, '~h:education', 'en', 'Studies')],
    'setLabel (a name)': ['~t:lang-portuguese', r => T.setLabel(model, r, '~t:lang-portuguese', 'en', 'Luso')],
    setSectionLabel: ['~h:education', r => T.setSectionLabel(model, r, 'education', 'en', 'Studies')],
    addLocalLine: [job, r => T.addLocalLine(model, r, job, null)],
    removeLocalLine: ['~new-1', r => T.removeLocalLine(model, r, '~new-1')],
    setGroupHeading: ['skills-cad', r => T.setGroupHeading(model, r, 'skills-cad', 'CAD')],
    'setLabel (a skill group)': ['skills-cad', r => T.setLabel(model, r, '~g:skills-cad', 'en', 'CAD')],
    placeWord: ['skills-cad', r => T.placeWord(model, r, 'sw-python', 'skills-cad')],
    takeWord: ['skills-cad', r => T.takeWord(model, r, 'sw-creo')],
    removeSkillGroup: ['skills-cad', r => T.removeSkillGroup(model, r, 'skills-cad')],
    addSkillGroup: ['skills', r => T.addSkillGroup(model, r, null)],
    moveSkillGroup: ['skills-cad', r => T.moveSkillGroup(model, r, 'skills-cad', null)],
    moveSkill: ['skills-cad', r => T.moveSkill(model, r, 'skills-cad', 0, 'skills-software', 0)],
    useGroupsOf: ['skills', r => T.useGroupsOf(model, r, nobody)],
    setPhoto: ['header', r => T.setPhoto(model, r, { show: true })],
    acceptNewer: [line, r => RS.acceptNewer(r, line, model)],
  };
  for (const [name, [id, fn]] of Object.entries(calls)){
    const run = r => fn(r);
    // the target locked directly, then by the nearest ancestor that is not the page
    const prep = r => { if (name === 'removeLocalLine'){ r.localLines = { [job]: [{ id: '~new-1', after: null }] }; r.overrides = { '~new-1': 'x' }; } if (name === 'parkOverride') r.overrides = { [line]: 'x' }; if (name === 'acceptNewer') r.held = [line]; if (name === 'unparkOverride') r.parked = { [line]: { text: 'p', meta: {} } }; return r; };
    const direct = prep(withLock(base, id)), page = prep(withLock(base, LK.PAGE)), free = prep(clone(nobody));
    const before = JSON.stringify(direct), beforeP = JSON.stringify(page);
    const refused = lockedErr(() => run(direct)) && JSON.stringify(direct) === before;
    const refusedP = lockedErr(() => run(page)) && JSON.stringify(page) === beforeP;
    let worked = true; try { run(free); } catch (e){ worked = false; console.log('   ', name, String(e)); }
    ok(`${name}: refused when locked (the id itself, then the page), unchanged, and works when not`, refused && refusedP && worked, JSON.stringify([refused, refusedP, worked]));
  }
  ok('an ancestor locks it too: a locked job refuses its bullet and a locked section its job', lockedErr(() => T.setBulletOn(model, withLock(base, job), line, false)) && lockedErr(() => T.moveEntry(model, withLock(base, 'experience'), job, null)) && lockedErr(() => T.moveItem(model, withLock(base, sec), sec, itemOf, null)));
  ok('an unlocked neighbour of a locked line still works', !lockedErr(() => T.setBulletOn(model, withLock(base, line), 'hydra-testing', false)) && !lockedErr(() => T.setOverride(model, withLock(base, line), otherLine, 'ok', { marks: [], base: null })));
  ok('the refusal reads as a reason', (() => { try { T.setOverride(model, withLock(base, line), line, 'x'); } catch (e){ return e.key === 'ux6c.locked' && /Locked/.test(e.message); } })());
  const hl = withLock(base, '~h:experience');
  ok('a locked heading refuses its rename and "use this heading everywhere" skips it', lockedErr(() => T.setLabel(model, hl, '~h:experience', 'en', 'Work')) && (() => { const r = clone(base); T.setSectionLabel(model, r, 'experience', 'en', 'Work'); r.locked = ['~h:experience']; const m = clone(model); return T.useLabelEverywhere(m, r, 'experience', 'en') === false && r.sections.find(x => x.id === 'experience').label.en === 'Work' && m.sections.find(x => x.id === 'experience').title !== 'Work'; })());

  // bulk functions skip locked content and report it
  {
    const jt = F.jobTypesOf(model)[0]?.id;
    const open = clone(mk0());
    function mk0(){ return S.loadResume(read(`data/example-resumes/${names[1]}`), model).recipe; }
    const plan = F.planTag(model, clone(open), jt), pageLocked = withLock(open, LK.PAGE), plan2 = F.planTag(model, pageLocked, jt);
    const applied = clone(pageLocked); F.applyTag(model, applied, jt);
    ok('tag focus changes an unlocked resume (the control)', plan.on + plan.off + plan.sw > 0, JSON.stringify([jt, plan.on, plan.off, plan.sw]));
    ok('tag focus on a locked page changes nothing and reports what it skipped', plan2.on + plan2.off + plan2.sw === 0 && plan2.locked > 0 && JSON.stringify(applied) === JSON.stringify(pageLocked), JSON.stringify([plan2.on, plan2.off, plan2.sw, plan2.locked]));
  }
  {
    const r = clone(base); r.held = [line]; r.overrides = { ...r.overrides, [line]: 'older words' };
    const live = T.chooseVariant(model, line, { ...r, overrides: {} }).v.text;
    ok('newer wording is not offered for a locked line, and accepting it is refused', RS.newerOf(model, r).some(x => x.fact === line) === (live !== 'older words') && RS.newerOf(model, withLock(r, line)).every(x => x.fact !== line) && lockedErr(() => RS.acceptNewer(withLock(r, job), line, model)));
    const kept = withLock(r, line); RS.keepOlder(kept, line);
    ok('keeping the older words is still allowed (it changes no text)', kept.overrides[line] === 'older words' && !kept.held);
  }
  {
    const e = clone(base); T.setOverride(model, e, line, 'English words', { marks: [], base: null }); const eLocked = withLock(e, job), eFree = clone(e);
    L.switchLang(eLocked, 'hu', model); L.switchLang(eFree, 'hu', model);
    ok('switching language: a locked line stays as typed, an unlocked edit goes with its language', eLocked.overrides?.[line] === 'English words' && eFree.overrides?.[line] === undefined, JSON.stringify([eLocked.overrides, eFree.overrides]));
    const back = clone(eLocked); L.switchLang(back, 'en', model);
    ok('…and comes back unchanged', back.overrides[line] === 'English words' && JSON.stringify(back.locked) === JSON.stringify(eLocked.locked));
  }

  const edited = clone(base); T.setOverride(model, edited, line, 'Edited', { marks: [], base: null }); T.setOverride(model, edited, 'hydra-testing', 'Edited too', { marks: [], base: null });
  ok('the Review list’s edits leave out a locked line (and what is under a lock)', eq(T.reviewableEdits(model, edited), [line, 'hydra-testing']) && eq(T.reviewableEdits(model, withLock(edited, line)), ['hydra-testing']) && T.reviewableEdits(model, withLock(edited, job)).length === 0 && T.reviewableEdits(model, withLock(edited, LK.PAGE)).length === 0);
  // undo, duplicate, copy, snapshot, save and load
  {
    const store = createStore({ record: clone(model), cur: clone(base) });
    store.commit(d => LK.setLocked(d.cur, line, true), 'lock');
    ok('lock is one undo step', eq(store.state.cur.locked, [line]));
    store.undo();
    ok('…and undo takes the key away', !('locked' in store.state.cur));
    store.redo(); store.commit(d => LK.setLocked(d.cur, line, false), 'unlock');
    ok('unlock is one step too', !('locked' in store.state.cur));
    store.undo();
    ok('…and undo brings the lock back', eq(store.state.cur.locked, [line]));

    const st = exampleState(); st.cur.locked = [line]; RS.settle(st);
    const id0 = st.openId;
    ok('saving keeps the lock', eq(RS.savedOf(st, id0).locked, [line]));
    const dup = RS.duplicate(st, id0);
    ok('a duplicate keeps the lock', eq(st.cur.locked, [line]) && eq(RS.savedOf(st, dup.id ?? st.openId).locked, [line]));
    ok('a new resume started from a copy keeps the lock', eq(RS.startRecipe(st, { start: 'latest', fromId: id0 }).locked, [line]));
    const snap = RS.takeSnapshot(Object.assign(st, { openId: id0, cur: clone(RS.savedOf(st, id0)) }), { company: 'Acme', role: 'Engineer' });
    const had = JSON.stringify(RS.snapshotsOf(RS.savedOf(st, id0)).find(x => x.id === snap.id));
    st.cur.locked = [line, job]; RS.settle(st);
    ok('a sent copy keeps what it had and never changes', JSON.stringify(RS.snapshotsOf(RS.savedOf(st, id0)).find(x => x.id === snap.id)) === had && !had.includes(`"${job}"]`));
    ok('a lock alone is not a change since the last send', (() => { const s2 = exampleState(); s2.cur.locked = [line]; const a = RS.printedKey(s2.cur, {}), b = RS.printedKey(Object.assign(clone(s2.cur), { locked: [line, job] }), {}); return a === b; })());

    const { file } = S.saveResume(model, withLock(base, line, job));
    const back = S.loadResume(JSON.parse(JSON.stringify(file)), model);
    ok('a saved resume writes and reads the lock back, with no warnings', eq(back.recipe.locked, [line, job]) && back.warnings.length === 0);
    ok('a resume with no lock saves with no locked key anywhere', !JSON.stringify(S.saveResume(model, nobody).file).includes('"locked"'));
    const bad = clone(file); bad.meta.resumeBuilder.resume.locked = [line, 5, null, line, '', { a: 1 }];
    const cleaned = S.loadResume(bad, model);
    ok('a malformed locked list keeps the strings and warns', eq(cleaned.recipe.locked, [line]) && cleaned.warnings.some(w => /locked/.test(w)), JSON.stringify([cleaned.recipe.locked, cleaned.warnings]));
    const worse = clone(file); worse.meta.resumeBuilder.resume.locked = 'hydra';
    const gone = S.loadResume(worse, model);
    ok('a locked that is not a list is dropped with a warning', !('locked' in gone.recipe) && gone.warnings.some(w => /locked/.test(w)));
    const stray = clone(file); stray.meta.resumeBuilder.resume.locked = ['no-such-id'];
    ok('an id that matches nothing is harmless', eq(S.loadResume(stray, model).recipe.locked, ['no-such-id']) && renderPages(model, S.loadResume(stray, model).recipe, createDocument(), { fallback: true }).pages.length > 0);
    ok('nothing printed differs for a lock', renderPages(model, withLock(base, LK.PAGE), createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('') === renderPages(model, base, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('')
      && JSON.stringify(T.resolve(model, withLock(base, LK.PAGE)).body) === JSON.stringify(T.resolve(model, base).body));
    ok('dropping a claim from the record drops its lock', (() => { const r = withLock(base, 'lang-portuguese', job); K.deleteItem(clone(model), 'languages', 'lang-portuguese', [r]); return !(r.locked ?? []).includes('lang-portuguese') && (r.locked ?? []).includes(job); })());

    // an older app (the commit before this one) opens the file, ignores the key and prints it as before
    let tree = null;
    try {
      execFileSync('git', ['cat-file', '-e', 'd4189b1^{commit}'], { cwd: REPO, stdio: 'ignore' });
      tree = fs.mkdtempSync(path.join(os.tmpdir(), 'brewcv-old-'));
      execFileSync('sh', ['-c', `git archive d4189b1 src scripts/lib | tar -x -C "${tree}"`], { cwd: REPO });
    } catch { console.log('SKIP  the previous commit is not in this clone: the older app is not tried'); }
    if (tree){
      const O = await Promise.all(['src/model/schema.js', 'src/model/resume.js', 'src/render.js'].map(f => import(pathToFileURL(path.join(tree, f)).href)));
      let err = null, out = '';
      try {
        const m = O[0].load(read('data/example.json')).model, o = O[0].loadResume(JSON.parse(JSON.stringify(file)), m);
        O[1].resolve(m, o.recipe);
        out = O[2].renderPages(m, o.recipe, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('');
      } catch (e){ err = e; }
      ok('the previous commit opens a file with a lock, ignores it, and prints it as before', !err && out === renderPages(model, back.recipe, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join(''), String(err));
      fs.rmSync(tree, { recursive: true, force: true });
    }
  }
}
section('hiding, layout, stale locks, restore, record edits');
{
  const LK = await import('../src/model/lock.js');
  const lockedErr = fn => { try { fn(); return false; } catch (e){ return e instanceof LK.LockedError; } };
  const withLock = (r, ...ids) => { const c = clone(r); for (const id of ids) LK.setLocked(c, id, true); return c; };
  const base = T.newResume(model, {}); delete base.locked;
  const job = 'hydra', line = 'hydra-inhaler', itemA = 'cert-gdt', sec = 'certified';
  const other = (model.sections.find(s => s.id === sec).content.runs ?? model.sections.find(s => s.id === sec).content.items ?? []).find(x => x !== itemA);
  // 1. hiding a block that holds locked content
  ok('hiding a job with a locked line in it is refused, and the same call works unlocked', lockedErr(() => T.setJobOn(model, withLock(base, line), job, false)) && !lockedErr(() => T.setJobOn(model, clone(base), job, false)));
  ok('hiding a section with a locked line (two levels down) is refused', lockedErr(() => T.setSectionOn(model, withLock(base, line), 'experience', false)) && !lockedErr(() => T.setSectionOn(model, clone(base), 'experience', false)));
  ok('hiding the last item of a section is refused when a hidden item in it is locked, with nothing written', (() => {
    const r = clone(base); T.setItemOn(model, r, itemA, false); const only = T.itemList(model, r, sec).filter(x => x.on).map(x => x.id);
    for (const x of only.slice(1)) T.setItemOn(model, r, x, false);
    const hold = withLock(r, itemA); const before = JSON.stringify(hold);
    return only.length >= 1 && lockedErr(() => T.setItemOn(model, hold, only[0], false)) && JSON.stringify(hold) === before;
  })());
  ok('showing a hidden locked job, section or item is allowed', (() => {
    const r = clone(base); T.setJobOn(model, r, job, false); T.setSectionOn(model, r, sec, false);
    const l = withLock(r, job, sec);
    const a = !lockedErr(() => T.setJobOn(model, l, job, true)), b = !lockedErr(() => T.setSectionOn(model, l, sec, true));
    return a && b && T.sectionList(model, l).find(x => x.id === sec).on;
  })());
  ok('showing a row of an off section leaves a locked row as it is', (() => {
    const r = clone(base); T.setSectionOn(model, r, sec, false); const l = withLock(r, other);
    T.setItemOn(model, l, itemA, true);
    return !(l.off ?? []).includes(other) && !(l.off ?? []).includes(itemA);
  })());
  // 8. a hand layout is not reset under a lock
  const hand = clone(base); hand.pages = [['header', 'summary', { id: 'experience', work: model.work.map(w => ({ id: w.id, highlights: [...w.highlights] })) }, 'skills']]; delete hand.pageLimit;
  ok('moving a section, or switching one on, would reset a hand layout: refused under a lock', lockedErr(() => T.moveSection(model, withLock(hand, 'name'), 'education', null)) && lockedErr(() => T.toAuto(model, withLock(hand, 'name'))) && !lockedErr(() => T.moveSection(model, clone(hand), 'education', null)));
  // 9. stale locks
  ok('a new local line is not born locked by an old lock on that name', (() => { const r = withLock(base, '~new-1'); return T.addLocalLine(model, r, job, null) === '~new-2'; })());
  ok('deleting an entry takes its lock away', (() => { const m = clone(model), r = withLock(base, 'caliper-stand'); K.deleteEntry(m, 'caliper-stand', [r]); return !r.locked; })());
  ok('deleting a kind takes the lock on its section away', (() => { const m = clone(model); const id = K.createKind(m, { name: { en: 'Clubs' }, store: 'projects' }); const k = m.kinds.find(x => x.id === id); const r = withLock(base, k.section, `~h:${k.section}`); K.deleteKind(m, id, { recipes: [r] }); return !r.locked; })());
  // 10. who holds a lock on what a delete takes out
  ok('a delete lists the resumes whose lock covers it, and none when nothing is locked', (() => {
    const r1 = withLock(base, job), r2 = clone(base);
    const got = K.lockedOnDelete(model, [r1, r2], (m, rs) => K.deleteClaim(m, line, rs));
    const none = K.lockedOnDelete(model, [r2], (m, rs) => K.deleteClaim(m, line, rs));
    const entry = K.lockedOnDelete(model, [withLock(base, 'caliper-stand'), r2], (m, rs) => K.deleteEntry(m, 'caliper-stand', rs));
    return eq(got, [0]) && eq(none, []) && eq(entry, [0]);
  })());
  // 11. the record is needed once there is a lock
  ok('lockedBy and guard throw a TypeError when a locked resume is asked without the record', (() => { const r = withLock(base, line); try { LK.lockedBy(undefined, r, line); return false; } catch (e){ return e instanceof TypeError; } })() && LK.lockedBy(undefined, base, line) === null);
  // 4. restoring a snapshot
  ok('restore as current is refused while the open resume has a lock, and works without', (() => {
    const st = exampleState(); const snap = RS.takeSnapshot(st, { company: 'Acme', role: 'Engineer' });
    st.cur.locked = [line]; const before = JSON.stringify(st.cur);
    let refused = false; try { RS.restoreSnapshot(st, snap.id); } catch (e){ refused = /Unlock/.test(e.message); }
    delete st.cur.locked; RS.restoreSnapshot(st, snap.id);
    return refused && JSON.stringify(st.cur) !== before;
  })());
  // 3. record edits that change what the open resume prints
  const vid = model.facts.find(f => f.id === line).variants[0];
  const heads = (() => { const m = clone(model), id = K.createKind(m, { name: { en: 'Clubs' }, store: 'projects' }); return { m, id, sec: m.kinds.find(k => k.id === id).section }; })();
  ok('saving over a version, deleting one, and renaming a kind refuse when the open resume has it locked', lockedErr(() => R.saveOver(clone(model), vid, 'New words', withLock(base, line))) && lockedErr(() => R.deleteVersion(clone(model), vid, [], withLock(base, job))) && lockedErr(() => K.updateKind(heads.m, heads.id, { name: { en: 'Societies' } }, [], withLock(base, `~h:${heads.sec}`)))
    && !lockedErr(() => R.saveOver(clone(model), vid, 'New words', clone(base))));
}
section('the Review list\'s model');
{
  const V = await import('../src/model/review.js');
  const LK = await import('../src/model/lock.js');
  const base = S.loadResume(read(`data/example-resumes/${names[0]}`), model).recipe;
  const fresh = (strict = false) => { const m = clone(model); if (strict) m.requireSource = true; return m; };
  const lineId = 'hydra-inhaler', v2 = model.variants.find(v => v.id === 'hydra-inhaler-v2'), mark = { start: 0, end: 3 };
  const edit = (r, m, id, text, marks = []) => T.setOverride(m, r, id, text, { marks, base: null });
  const closeText = v2.text.replace('400,000', '450,000');                  // one word changed: close to v2, and tiny
  const farText = 'Rebuilt the counter from scratch with a different supplier and a new test plan for it';
  const sourced = (m, src = 'Notebook p. 3') => { m.variants.find(v => v.id === 'hydra-inhaler-v2').source = src; return m; };
  const asJson = (...x) => JSON.stringify(x);

  // the list
  { const r = clone(base), m = clone(model); edit(r, m, lineId, closeText); edit(r, m, 'hydra-suppliers', 'Qualified suppliers.');
    ok('the list holds the edits, not the locked ones, and says how many it left out', eq(V.reviewList(m, r).edits, [lineId, 'hydra-suppliers']) && V.reviewList(m, withLockR(r, lineId)).locked === 1 && eq(V.reviewList(m, withLockR(r, lineId)).edits, ['hydra-suppliers'])); }
  function withLockR(r, ...ids){ const c = clone(r); for (const id of ids) LK.setLocked(c, id, true); return c; }

  // a sub-version copies the parent's source, and the page prints the same words and highlights
  { const m = sourced(fresh(true)), r = clone(base); edit(r, m, lineId, closeText, [mark]);
    const row = V.editRow(m, r, lineId);
    ok('a close edit is suggested as a sub-version of the nearest, with the next free number', row.as === 'minor' && row.near.id === 'hydra-inhaler-v2' && row.n === '2.3' && row.tiny === true);
    const made = V.applyEdit(m, r, lineId, { do: 'minor', from: row.near.id });
    const v = m.variants.find(x => x.id === made.vid);
    ok('approving makes v2.3 with the parent\'s source, the edit\'s words and highlights', v.n === '2.3' && v.source === 'Notebook p. 3' && v.text === closeText && eq(v.marks, [mark]));
    ok('…drops the edit and picks the new version, so the resume prints the same words', !(lineId in (r.overrides ?? {})) && r.picks[lineId] === v.id && T.textOf(m, lineId, r) === closeText); }
  // a new major needs a typed source when the record asks for one
  { const m = fresh(true), r = clone(base); edit(r, m, lineId, farText);
    const before = asJson(m, r);
    const refused = throws(() => V.applyEdit(m, r, lineId, { do: 'major' })) && throws(() => V.applyEdit(m, r, lineId, { do: 'major', source: '   ' }));
    ok('a new major without a source is refused when the record asks for one, and nothing changed', refused && asJson(m, r) === before);
    const made = V.applyEdit(m, r, lineId, { do: 'major', source: '  Interview notes,\n 2024  ' });
    ok('…and is accepted with one, trimmed to plain text', made.n === '4' && m.variants.find(x => x.id === made.vid).source === 'Interview notes, 2024');
    ok('the source is cut at 300 characters', V.cleanSource('x'.repeat(400)).length === V.SOURCE_MAX);
    const loose = fresh(false), r2 = clone(base); edit(r2, loose, lineId, farText);
    ok('a record that does not ask for a source takes a new major without one', V.applyEdit(loose, r2, lineId, { do: 'major' }).n === '4' && !V.needsSource(loose)); }
  { const m = fresh(true), r = clone(base); edit(r, m, lineId, closeText);
    ok('a sub-version of a parent with no source needs one too', throws(() => V.applyEdit(m, r, lineId, { do: 'minor', from: 'hydra-inhaler-v2' })) && V.applyEdit(m, r, lineId, { do: 'minor', from: 'hydra-inhaler-v2', source: 'Memo' }).n === '2.3'); }
  // keep it here
  { const m = fresh(), r = clone(base); edit(r, m, lineId, closeText);
    V.applyEdit(m, r, lineId, { do: 'keep' });
    ok('keeping it on this resume leaves the edit, and it leaves the list', r.overrides[lineId] === closeText && !V.reviewList(m, r).edits.includes(lineId) && T.textOf(m, lineId, r) !== undefined);
    edit(r, m, lineId, closeText + ' again');
    ok('…and a later edit of the line is offered again', V.reviewList(m, r).edits.includes(lineId)); }
  // a locked line is not offered and not changed
  { const m = fresh(), r0 = clone(base); edit(r0, m, lineId, closeText, [mark]); const r = withLockR(r0, lineId);
    const before = asJson(m, r);
    ok('a locked line is refused and nothing changes', ['minor', 'major', 'over'].every(d => throws(() => V.applyEdit(m, r, lineId, { do: d, from: 'hydra-inhaler-v2', vid: 'hydra-inhaler-v2', source: 'x' }))) && asJson(m, r) === before); }
  // update v2: the other resumes see it as newer wording, a sent copy does not change
  { const st = exampleState();
    const cur = st.cur, mineSet = new Set(RS.usedVersions(st.record, cur).filter(u => st.record.work.some(w => w.highlights.includes(u.fact))).map(u => u.variant));
    const other = st.resumes.find(r => r.id !== st.openId && r.lang === cur.lang && RS.usedVersions(st.record, r).some(u => mineSet.has(u.variant)));
    const vid = RS.usedVersions(st.record, other).find(u => mineSet.has(u.variant)).variant, fact = st.record.facts.find(f => f.variants.includes(vid)).id;
    const text = st.record.variants.find(v => v.id === vid).text, curId = st.openId;
    RS.openSaved(st, other.id); const snap = RS.takeSnapshot(st, { company: 'Acme', role: 'Engineer' }); RS.openSaved(st, curId);
    const snapBefore = JSON.stringify(st.resumes.find(r => r.id === other.id).snapshots);
    edit(st.cur, st.record, fact, text.replace(/\w+(\W*)$/, 'changed$1'));
    const row = V.editRow(st.record, st.cur, fact);
    ok('a one-word change of a version is a tiny edit of it', row.near.id === vid && row.tiny === true);
    ok('the resumes that print that version are named', V.printersOf(st, vid).some(r => r.id === other.id) && !V.printersOf(st, vid).some(r => r.id === curId));
    V.applyEdit(st.record, st.cur, fact, { do: 'over', vid });
    ok('update: the nearest version has the edit\'s words, the edit is gone', st.record.variants.find(v => v.id === vid).text.includes('changed') && !(fact in (st.cur.overrides ?? {})));
    RS.openSaved(st, other.id);
    ok('the other resume keeps its words and is offered the new ones', RS.newerOf(st.record, st.cur).some(x => x.fact === fact && x.live.includes('changed') && x.frozen === text));
    ok('a sent copy is unchanged', JSON.stringify(st.resumes.find(r => r.id === other.id).snapshots) === snapBefore && snap.id !== undefined);
    // keep mine / use the newer, and the held line is not an edit
    ok('a held line is not an edit to review', !V.reviewList(st.record, st.cur).edits.includes(fact) && V.reviewList(st.record, st.cur).newer.length >= 1);
    RS.keepOlder(st.cur, fact);
    ok('keeping mine takes it off both lists', V.reviewCount(st.record, st.cur) === V.reviewList(st.record, st.cur).newer.length + V.reviewList(st.record, st.cur).edits.length && !V.reviewList(st.record, st.cur).newer.some(x => x.fact === fact) && !V.reviewList(st.record, st.cur).edits.includes(fact)); }
  // headings and language names
  { const m = fresh(), r = clone(base);
    T.setSectionLabel(m, r, 'experience', 'en', 'Work history'); T.setTerm(m, r, 'lang-portuguese', 'en', 'Portuguese (native)');
    ok('a heading and a language name are on the list', eq(V.reviewList(m, r).labels.map(l => l.key), ['~h:experience', '~t:lang-portuguese']));
    V.keepLabel(m, r, '~h:experience');
    ok('keeping a heading leaves it as typed and off the list', T.labelOf(m, r, 'experience', 'en') === 'Work history' && eq(V.reviewList(m, r).labels.map(l => l.key), ['~t:lang-portuguese']));
    T.setSectionLabel(m, r, 'experience', 'en', 'Work');
    ok('…until its words change', V.reviewList(m, r).labels.some(l => l.key === '~h:experience'));
    ok('use for every resume: the record has the heading and the resume no longer needs its own', V.useEverywhere(m, r, '~h:experience') && m.sections.find(s => s.id === 'experience').title === 'Work' && T.labelOf(m, r, 'experience', 'en') === null);
    ok('…and the same for a language\'s name', V.useEverywhere(m, r, '~t:lang-portuguese') && T.recordTerm(m, 'lang-portuguese', 'en') === 'Portuguese (native)' && !r.terms);
    T.setSectionLabel(m, r, 'education', 'en', 'Studies'); const lk = withLockR(r, '~h:education');
    ok('a locked heading is not offered and not sent to the record', V.reviewList(m, lk).labels.every(l => l.key !== '~h:education') && V.reviewList(m, lk).locked >= 1 && throws(() => V.useEverywhere(m, lk, '~h:education')));
  }
  // a line only on this resume becomes a claim, in its place
  { const base2 = S.loadResume(read(`data/example-resumes/${names[0]}`), model).recipe;
    const m = fresh(true), r = clone(base2), id = T.addLocalLine(m, r, 'hydra', 'hydra-testing');
    edit(r, m, id, 'Wrote the supplier audit checklist', [{ start: 0, end: 5 }]);
    const row = V.editRow(m, r, id), order = T.listedBullets(m, r, 'hydra'), at = order.indexOf(id);
    const before = asJson(m, r);
    ok('a local line is a row of its own, in its job', row.local && row.job === 'hydra' && V.reviewList(m, r).edits.includes(id));
    ok('adding it to the record without a source is refused when the record asks, and nothing changes', throws(() => V.applyEdit(m, r, id, { do: 'claim' })) && asJson(m, r) === before);
    const { fact } = V.applyEdit(m, r, id, { do: 'claim', source: 'Audit file 12' });
    const now = T.listedBullets(m, r, 'hydra');
    ok('the claim is in the job, with the source and the highlights', m.work.find(w => w.id === 'hydra').highlights.includes(fact) && m.variants.filter(v => m.facts.find(f => f.id === fact).variants.includes(v.id)).every(v => v.source === 'Audit file 12' && eq(v.marks, [{ start: 0, end: 5 }])));
    ok('…and it replaces the local line in the same place on this resume', !T.isLocal(r, id) && !(id in (r.overrides ?? {})) && now.indexOf(fact) === at && now.length === order.length && T.textOf(m, fact, r) === 'Wrote the supplier audit checklist');
    // a local line in a record that does not ask for a source needs none
    const loose = fresh(false), r3 = clone(base2), id3 = T.addLocalLine(loose, r3, 'hydra', null); edit(r3, loose, id3, 'First line of all');
    const f3 = V.applyEdit(loose, r3, id3, { do: 'claim' }).fact;
    ok('with no source asked for, a local line needs none; a line with no job place goes where it was (first)', T.listedBullets(loose, r3, 'hydra')[0] === f3); }
  // every kind of text with versions is a row: header facts, a job's title and dates, the items of patent, education, certificates and interests
  { const ids = ['name', 'tagline', 'contact', 'hydra-position', 'hydra-meta', 'patent-title', 'edu-degree', 'edu-meta', 'cert-gdt', 'interest-sailing'];
    const m = fresh(true), r = clone(base);
    for (const id of ids) edit(r, m, id, `${T.textOf(m, id, r)} (edited)`, [mark]);
    ok('every kind of text is on the list', eq(V.reviewList(m, r).edits.sort(), [...ids].sort()));
    const done = ids.map(id => { const o = V.applyEdit(m, r, id, { do: 'major', source: 'Record check' }); return [id, m.variants.find(v => v.id === o.vid), T.textOf(m, id, r)]; });
    ok('each becomes a version with its words, highlights and source, and the resume prints the same', done.every(([id, v, shown]) => /\(edited\)$/.test(v.text) && v.source === 'Record check' && eq(v.marks, [mark]) && shown === v.text) && !V.reviewList(m, r).edits.length); }
  // the exports follow the versions: an edit that became a version (with a source) is in the files and no longer a problem or a row; one kept here is still both
  { const sourcedAll = () => { const m = fresh(true); for (const v of m.variants) v.source ??= 'Record check'; return m; };
    const json = (m, r) => JSON.stringify(X.jsonResumeFile(m, r).file), problems = (m, r) => T.resolve(m, r).problems.filter(p => /no source/.test(p));
    const m = sourcedAll(), r = clone(base), kept = clone(base);
    edit(r, m, lineId, farText); edit(kept, m, lineId, farText); edit(r, m, 'name', 'Dana Q. Okonkwo'); edit(kept, m, 'name', 'Dana Q. Okonkwo');
    ok('before: the edits are problems for an ATS export and the name edit is counted by the pre-flight row', problems(m, r).length === 2 && X.unexported(m, r) === 1);
    V.applyEdit(m, r, lineId, { do: 'major', source: 'Interview notes' }); V.applyEdit(m, r, 'name', { do: 'major', source: 'ID card' });
    ok('after approving: the line is in the JSON Resume file, no override has no source, nothing is counted as left out', json(m, r).includes('Rebuilt the counter') && problems(m, r).length === 0 && X.unexported(m, r) === 0);
    V.applyEdit(m, kept, lineId, { do: 'keep' }); V.applyEdit(m, kept, 'name', { do: 'keep' });
    ok('kept on this resume: it still prints, is still a problem for an ATS export and is still named by the row', kept.overrides[lineId] === farText && JSON.stringify(T.resolve(m, kept).body).includes('Rebuilt the counter') && problems(m, kept).length === 2 && X.unexported(m, kept) === 1); }
  // each apply is one undo step
  { const m = sourced(fresh(true)), r = clone(base); edit(r, m, lineId, closeText, [mark]);
    const store = createStore({ record: m, cur: r }), was = JSON.stringify(store.state);
    store.commit(d => { V.applyEdit(d.record, d.cur, lineId, { do: 'minor', from: 'hydra-inhaler-v2' }); }, 'review');
    ok('an apply is one undo step', store.history.undo === 1 && JSON.stringify(store.state) !== was);
    store.undo();
    ok('…and undo puts the edit back and takes the version away', JSON.stringify(store.state) === was);
    ok('a refused apply in a commit changes nothing and adds no step', throws(() => store.commit(d => { V.applyEdit(d.record, d.cur, lineId, { do: 'major' }); }, 'review')) && store.history.undo === 0 && JSON.stringify(store.state) === was); }
}
section('the skill wordbank: seeded from the record on first open');
{
  const file = read('data/example.json');
  const bare = clone(file); delete bare.meta.resumeBuilder.skillBank;
  for (const l of Object.values(bare.meta.resumeBuilder.i18n)) for (const k of Object.keys(l.labels ?? {})) if (k.startsWith('sw-')) delete l.labels[k];
  const m = S.load(bare).model, words = SB.wordsOf(m);
  ok('a record with no bank gets one from its skill groups: each word once, in order', words.map(w => w.name).join('|') === 'SolidWorks (CSWP)|Creo|Fusion 360|KeyShot|3D printing FDM/SLA|CNC milling|laser cutting|silicone tooling|injection-moulding DFM|ISO 13485|IEC 62366|design verification|first-article inspection|PPAP|Python|MATLAB|Git|Excel');
  ok('…the same bank the shipped example carries', eq(m.skillBank, model.skillBank));
  const w = n => words.find(x => x.name === n);
  ok('a translation matches its English by place, and needs-review is kept per language', SB.wordText(m, w('CNC milling').id, 'hu').text === 'CNC-marás' && SB.wordText(m, w('CNC milling').id, 'de').text === 'CNC-Fräsen' && w('CNC milling').needsReview.includes('de') && !w('CNC milling').needsReview.includes('hu'));
  ok('a word of a group marked same, written the same everywhere, is same in every language', w('Creo').same === true && SB.wordText(m, w('Creo').id, 'hu').text === 'Creo');
  ok('a word of a same group that another language writes differently is not, and is missing where it has no wording', !w('design verification').same && SB.wordText(m, w('design verification').id, 'hu').miss === true && SB.wordText(m, w('design verification').id, 'de').text === 'Designverifizierung');
  ok('the claims are untouched', eq(m.facts, S.load(file).model.facts) && eq(m.variants, S.load(file).model.variants));
  ok('seeding again changes nothing', SB.seedBank(m) === false && eq(SB.wordsOf(m), words));
  ok('a record with no skills gets no bank', SB.seedBank(S.emptyModel('x')) === false);
  // counts that differ: only the words written the same are matched
  const odd = clone(bare);
  const rb = odd.meta.resumeBuilder, hu = rb.variants.find(v => v.id === 'skills-fabrication-v1-hu');
  hu.text = 'CNC milling, lézervágás és szilikonszerszám';
  const mo = S.load(odd).model, cnc = SB.wordsOf(mo).find(x => x.name === 'CNC milling'), lz = SB.wordsOf(mo).find(x => x.name === 'laser cutting');
  ok('a translation with another number of words is matched only where a word is written the same', !SB.labelIn(mo, cnc.id, 'hu') && SB.wordText(mo, lz.id, 'hu').miss === true);
  // finding a word: any language, case, accents and punctuation ignored; C, C++ and C# apart
  ok('a word is found in any language, whatever its case and accents', SB.findWord(m, 'cnc-marás')?.name === 'CNC milling' && SB.findWord(m, 'creo ')?.name === 'Creo');
  ok('words like it: one inside the other, or two letters apart', SB.similar(m, 'Solidwork').near.some(x => x.name === 'SolidWorks (CSWP)') && SB.similar(m, 'Pythn').near.some(x => x.name === 'Python'));
  { const c = clone(m); SB.addWord(c, { name: 'C' }); SB.addWord(c, { name: 'C++' }); ok('C, C++ and C# are three words', SB.findWord(c, 'c#') === null && SB.findWord(c, 'C++').name === 'C++'); }
  // typed text of an older arrangement becomes the bank's words
  { const c = clone(m);
    const g = SB.toWordIds(c, [{ id: 'skills-cad', items: ['Creo', 'creo'] }, { id: '~sg-1', label: 'Werkzeuge', lang: 'de', items: ['CNC-Fräsen', 'Bohren'] }], 'en');
    const made = SB.wordsOf(c).at(-1);
    ok('typed text becomes the word the bank has for it (in the group\'s language), never twice', eq(g[0].items, [w('Creo').id]) && g[1].items[0] === w('CNC milling').id);
    ok('…and a text the bank lacks becomes a new word, its English a stand-in marked for review', made.name === 'Bohren' && eq(made.needsReview, ['en']) && SB.labelIn(c, made.id, 'de') === 'Bohren' && g[1].items[1] === made.id && g[1].lang === 'de');
    ok('an item that is a word prints in the resume\'s language; typed text prints as typed', SB.wordText(c, w('CNC milling').id, 'de').text === 'CNC-Fräsen' && SB.wordText(c, 'Something typed', 'de').text === 'Something typed'); }
  // read from a file anyone can edit
  { const f = clone(file), r = read('data/example-resumes/index.json')[0], res = read(`data/example-resumes/${r}`);
    f.meta.resumeBuilder.skillBank.words.push({ id: 'sw-creo', name: 'dup' }, { name: 'no id' }, { id: 'sw-x', name: 'X', shelf: 'sh-gone', same: 'yes' });
    const got = S.load(f);
    ok('a bank word without an id of its own is dropped, a shelf that is not there forgotten, and it says so', SB.wordsOf(got.model).length === words.length + 1 && !('shelf' in SB.wordOf(got.model, 'sw-x')) && !('same' in SB.wordOf(got.model, 'sw-x')) && got.warnings.some(x => /skillBank/.test(x)));
    res.meta.resumeBuilder.resume.skillArrangement = { groups: [{ id: 'skills-cad', items: ['sw-creo', 'sw-gone', 'Typed'] }, { id: 'skills-software', items: ['sw-creo', 'sw-python'] }] };
    const back = S.loadResume(res, model);
    ok('a resume\'s word the bank does not have, or a word twice, is dropped with a warning; typed text stays', eq(back.recipe.skillArrangement.groups.map(g => g.items), [['sw-creo', 'Typed'], ['sw-python']]) && back.warnings.some(x => /a word twice/.test(x))); }
}
section('the skill wordbank: a resume\'s groups print the bank\'s words in its language');
{
  const m = clone(model), page = (r, o = {}) => renderPages(m, r, createDocument(), { fallback: true, annotate: true, ...o }).pages.map(p => p.outerHTML).join('');
  const hu = clone(S.loadResume(read('data/example-resumes/Dunamenti Műszer Kft. - Terméktervező.json'), m).recipe), before = page(hu);
  ok('a resume never arranged prints its record groups as before, and its JSON Resume skills are in its language now', !hu.skillArrangement && T.resolve(m, hu).body.skills[1].name === 'Gyártás' && T.resolve(m, hu).body.skills[1].keywords[1] === 'CNC-marás');
  const id = n => SB.findWord(m, n).id;
  hu.skillArrangement = { groups: [{ id: 'skills-fabrication', items: [id('CNC milling'), id('Creo'), id('design verification')] }, { id: '~sg-1', label: 'Saját', items: [] }] };
  const p = page(hu);
  ok('arranged, each word prints in the resume\'s language, a product name as it is, the page\'s copy marks each word', p.includes(`<span data-skill data-word="${id('CNC milling')}">CNC-marás</span>, <span data-skill data-word="${id('Creo')}">Creo</span>`) && p !== before);
  ok('…a word with no Hungarian prints its English in the app, and is listed as missing', p.includes('>design verification</span>') && L.missingList(m, hu).some(x => x.kind === 'word' && x.id === id('design verification')) && !L.missingList(m, hu).some(x => x.kind === 'word' && x.id === id('Creo')));
  ok('…the command line refuses it, as it refuses a claim with no version in the language', (() => { try { renderPages(m, hu, createDocument(), {}); return false; } catch (e){ return e.missingLang === true && /design verification/.test(e.message); } })());
  ok('…the JSON Resume skills say the same words, with the missing one as a problem', eq(T.resolve(m, hu).body.skills, [{ name: 'Gyártás', keywords: ['CNC-marás', 'Creo', 'design verification'] }]) && T.resolve(m, hu).problems.some(x => x.includes(id('design verification'))));
  ok('an empty group prints only on the page\'s copy', page(hu).includes('data-group="~sg-1"') && !renderPages(m, hu, createDocument(), { fallback: true }).pages[0].outerHTML.includes('Saját'));
  SB.setWordText(m, id('design verification'), 'hu', 'tervezésellenőrzés');
  ok('written in Hungarian in the bank, every resume prints it, and it is no longer missing', page(hu).includes('>tervezésellenőrzés</span>') && !L.missingList(m, hu).some(x => x.kind === 'word'));
  const shelf = SB.addShelf(m, 'Quality'); SB.setShelfName(m, shelf.id, 'hu', 'Minőség');
  hu.skillArrangement.groups[1] = { id: '~sg-1', shelf: shelf.id, items: [id('ISO 13485')] };
  ok('a group named after a shelf prints the shelf\'s name in the resume\'s language', page(hu).includes('>Minőség</span><br>'));
  // Fit: the resume's own groups are fixed rows, never swapped
  const F = await import('../src/fit.js');
  const c = F.cost(m, hu), rows = c.pages.flatMap(x => x.rows).filter(r => r.section === 'skills');
  ok('Fit costs the resume\'s own groups as fixed rows and offers no swap for them', rows.length === 2 && rows.every(r => r.fixed && r.fact === null) && !F.candidates(m, hu).some(x => /^skills-/.test(x.fact)) && !c.unmeasured.includes(null));
  const plain = clone(S.loadResume(read('data/example-resumes/Dunamenti Műszer Kft. - Terméktervező.json'), m).recipe); plain.off = [...(plain.off ?? []), 'skills-software'];
  ok('…a resume never arranged costs its record groups, the ones it leaves out not', !F.cost(m, plain).pages.flatMap(x => x.rows).some(r => r.fact === 'skills-software') && F.cost(m, plain).pages.flatMap(x => x.rows).some(r => r.fact === 'skills-cad'));
}
section('the skill wordbank and the record\'s groups: one list of words, every resume alike');
{
  const st = exampleState(), m = st.record, id = n => SB.findWord(m, n).id;
  K.updateSkill(m, 'skills-cad', { keywords: [...m.skills[0].keywords, 'Onshape'] });
  ok('a skill written into one of the record\'s groups in Career is a word of the bank too, once', !!SB.findWord(m, 'Onshape') && SB.wordsOf(m).filter(w => w.name === 'Onshape').length === 1);
  K.updateSkill(m, 'skills-cad', { keywords: m.skills[0].keywords });
  ok('…written again, it is not added twice', SB.wordsOf(m).filter(w => w.name === 'Onshape').length === 1);
  const plain = st.resumes.find(r => !r.skillArrangement && (r.lang ?? 'en') === 'hu');
  RS.renameWord(m, id('CNC milling'), 'hu', 'CNC marás');
  ok('a word written anew in the bank is written so in the record\'s groups, so a resume that prints them as they are says it too', T.resolve(m, plain).body.skills.some(g => g.keywords.includes('CNC marás')) && !JSON.stringify(m.variants).includes('CNC-marás'));
  RS.renameWord(m, id('Creo'), 'en', 'PTC Creo');
  ok('…its English too, in every language where it prints its English', m.skills[0].keywords.includes('PTC Creo') && T.resolve(m, plain).body.skills[0].keywords.includes('PTC Creo'));
  const arranged = st.resumes[0]; T.takeWord(m, arranged, id('KeyShot'));
  const uses = RS.wordUses(st, id('Python')).length, n = RS.dropWordEverywhere(st, id('Python'));
  ok('deleting a word takes it off every saved resume that prints it, its own groups and the record\'s alike, and out of the bank', n === uses && n > 1 && !SB.findWord(m, 'Python') && !st.resumes.some(r => JSON.stringify(T.resolve(m, r).body.skills ?? []).includes('"Python"')) && !m.skills.some(g => g.keywords.includes('Python')));
  const sh = ['Tools', 'Quality', 'Design'].map(x => SB.addShelf(m, x).id);
  SB.moveShelf(m, sh[2], sh[0]); SB.moveShelf(m, sh[0], null);
  ok('a shelf moves before another, or to the end, the others keeping their order', eq(SB.shelvesOf(m).map(s => s.id), [sh[2], sh[1], sh[0]]));
  { const c = clone(m), f = c.facts.find(x => x.id === 'skills-testing'), v1 = c.variants.find(v => v.id === f.default.en), plain = { lang: 'en', format: 'a4' };
    const v2 = R.addVersion(c, f.id, { text: 'ISO 13485, PPAP', lang: 'en', as: 'major' }); R.setDefault(c, v2.id);
    ok('a skill group\'s words are the version a resume with no pick prints (not the default the JSON Resume body shows)', T.textOf(c, f.id, plain) === v1.text && eq(K.skillWords(c, f.id, 'en'), v1.text.split(', ')));
    K.setSkillWords(c, f.id, [...K.skillWords(c, f.id, 'en'), 'FMEA'], 'en');
    ok('…written there, that resume prints them; the other version stays, and the record\'s keywords follow', T.textOf(c, f.id, plain).endsWith(', FMEA') && c.variants.find(v => v.id === v2.id).text === 'ISO 13485, PPAP' && c.skills.find(s => s.id === f.id).keywords.at(-1) === 'FMEA' && !!SB.findWord(c, 'FMEA')); }
  K.moveSkill(m, 'skills-software', 'skills-cad'); K.moveSkill(m, 'skills-cad', null);
  ok('a record skill group moves before another, or to the end, and the skills section lists them so', eq(m.skills.map(s => s.id), ['skills-software', 'skills-fabrication', 'skills-testing', 'skills-cad']) && eq(T.itemsOf(m, 'skills'), m.skills.map(s => s.id)));
}
section('the skill wordbank: shelves made from the record\'s skill groups, when the person asks');
{
  const m = clone(model), shelfOfWord = n => SB.wordOf(m, SB.findWord(m, n).id).shelf, groups = m.skills.map(s => s.id), gname = s => s.name;
  const bank0 = clone(m.skillBank), dry = SB.shelvesFromGroups(m, { dry: true });
  ok('counted first, it changes nothing: a shelf per group, every word of the groups', eq(dry, { shelves: 4, words: SB.wordsOf(m).length }) && eq(m.skillBank, bank0));
  const got = SB.shelvesFromGroups(m), shelves = SB.shelvesOf(m);
  ok('a shelf per record group, named as the group, in the record\'s group order', eq(got, dry) && eq(shelves.map(s => s.name), m.skills.map(gname)) && eq(m.skills.map(s => s.id), groups));
  ok('…its name in each language the group has one is the shelf\'s there', shelves.every((s, i) => Object.keys(m.i18n).every(l => SB.shelfName(m, s.id, l) === (m.i18n[l].labels?.[groups[i]] ?? s.name))) && SB.shelfName(m, shelves[1].id, 'hu') === 'Gyártás');
  ok('each word lands on its group\'s shelf, the words of a group in its order', eq(SB.wordsOf(m).filter(w => w.shelf === shelves[0].id).map(w => w.name), m.skills[0].keywords) && shelfOfWord('PPAP') === shelves[2].id && shelfOfWord('Excel') === shelves[3].id);
  const done = clone(m.skillBank);
  ok('asked again, nothing changes', eq(SB.shelvesFromGroups(m), { shelves: 0, words: 0 }) && eq(m.skillBank, done));
  // a shelf of the name is used (case and accents ignored), a word on a shelf stays, a word in no group stays, a word in two groups goes to the first
  const c = clone(model), id = n => SB.findWord(c, n).id, cs = SB.addShelf(c, 'FABRICATIÓN'), extra = SB.addShelf(c, 'Extras');
  SB.moveWord(c, id('CNC milling'), { shelf: extra.id }); SB.addWord(c, { name: 'Onshape' }); c.skills[1].keywords.push('Creo');
  const r = SB.shelvesFromGroups(c), by = n => SB.wordOf(c, id(n)).shelf;
  ok('a shelf that has the group\'s name is used, not made again; only the others are made', r.shelves === 3 && SB.shelvesOf(c).length === 5 && SB.shelvesOf(c)[0].id === cs.id && by('laser cutting') === cs.id && by('3D printing FDM/SLA') === cs.id);
  ok('a word already on a shelf stays, a word in no group stays on none, a word in two groups goes to the first', by('CNC milling') === extra.id && by('Onshape') === undefined && by('Creo') === SB.shelvesOf(c)[2].id);
  ok('the shelves made follow the group order after the ones there already', eq(SB.shelvesOf(c).map(s => s.name), ['FABRICATIÓN', 'Extras', 'CAD & 3D', 'Test & QA', 'Software']));
  ok('a record with no bank is left alone', eq(SB.shelvesFromGroups({ skills: m.skills }), { shelves: 0, words: 0 }));
}
section('a language copy and the headings of a resume\'s own skill groups');
{
  const m = clone(model), base = clone(S.loadResume(read(`data/example-resumes/${names[0]}`), m).recipe);
  const a = { ...clone(base), id: 'A.json' }; T.addSkillGroup(m, a, null); T.setGroupHeading(m, a, '~sg-1', 'Tools'); T.placeWord(m, a, 'sw-git', '~sg-1');
  const b = { ...clone(a), id: 'B.json', lang: 'hu', parent: 'A.json', inStep: true }; delete b.skillArrangement.groups.at(-1).label; delete b.skillArrangement.groups.at(-1).lang;
  const st = { record: m, resumes: [a, b], frozen: {}, cur: clone(a), openId: 'A.json' };
  RS.mirror(st, 'A.json');
  const g = RS.savedOf(st, 'B.json').skillArrangement.groups.at(-1);
  ok('a copy with no heading of its own for a group made on the page prints the original\'s, in its language, and lists it as missing', g.label === 'Tools' && g.lang === 'en' && L.missingList(m, RS.savedOf(st, 'B.json')).some(x => x.kind === 'group' && x.id === '~sg-1'));
  ok('…and a group with no heading at all is not named by its id', T.groupHeading(m, a, { id: '~sg-9', items: [] }) === '');
}
section('a resume that uses none of it renders as before (the 14 example resumes that are not language copies)');
{
  // SHA-256 of every example resume's pages, in file order, as drawn before direct editing (re-set when the look settings changed, and again when the job title went beside the name in Compact density only: the Polish and Czech one-pagers lose a bullet again, to fill 88-96%). Change it only when the example or the renderer is meant to change.
  // The language copies (`parent`) came later and are left out, so the hash still says the fourteen print as they did.
  const h = crypto.createHash('sha256');
  const own = fs.readdirSync(path.join(REPO, 'data/example-resumes')).filter(f => f.endsWith('.json') && f !== 'index.json').sort().map(n => S.loadResume(read(`data/example-resumes/${n}`), model).recipe).filter(r => !r.parent);
  for (const r of own) h.update(renderPages(model, r, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join(''));
  ok('the 14 example resumes hash to what they always did', own.length === 14 && h.digest('hex') === 'a8e35aad45ca8f34f3a8a53a4f9cdfd44ff68f1a465445b43e5f5fa17b5c406d');
}

console.log(failed ? `\n${failed} direct check(s) FAILED` : '\nall direct checks passed');
process.exit(failed ? 1 : 0);
