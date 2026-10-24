#!/usr/bin/env node
// node checks/multilingual-check.mjs
// Language copies kept in step (groupOf, inStep, mirror, setInStep), version numbers matched across languages (addVersion's n,
// numbers counted over every language), and the missing list in a group. Model and store only; fictional data; nothing is written.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import * as S from '../src/model/schema.js';
import * as RS from '../src/model/resumes.js';
import * as R from '../src/model/record.js';
import * as L from '../src/model/lang.js';
import * as T from '../src/model/resume.js';
import { createStore } from '../src/store/store.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const clone = x => structuredClone(x);
let failed = 0;
// a case that throws is a FAIL with its message, so a missing function names the case instead of stopping the run
const ok = (name, cond) => {
  let pass = false, extra = '';
  try { pass = typeof cond === 'function' ? !!cond() : !!cond; } catch (e) { extra = `  — ${e.message}`; }
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : extra}`);
  if (!pass) failed++;
};
const section = t => console.log(`\n— ${t}`);

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
const EN = names[0];
const open = (store, id) => store.commit(d => { RS.openSaved(d, id); }, 'open');
const saved = (store, id) => RS.savedOf(store.state, id);
const order = (store, id, job = 'hydra') => T.listedBullets(store.state.record, saved(store, id), job);
const picked = (store, id, fact) => saved(store, id).picks?.[fact];
const missing = (store, id) => L.missingList(store.state.record, saved(store, id), { inGroup: RS.inGroup(store.state, saved(store, id)) });
const want = (list, fact) => list.find(m => m.id === fact);

// the English example resume with a Hungarian copy of it in step; the Hungarian one is open
function fresh(){
  const store = createStore(exampleState(), { settle: RS.settle });
  store.commit(d => { T.pickVersion(d.record, d.cur, 'hydra-inhaler', 'hydra-inhaler-v2'); }, 'pick');
  store.commit(d => { RS.duplicate(d, EN, { lang: 'hu' }); }, 'copy in Hungarian');
  return { store, hu: store.state.openId };
}
const bystanders = (store, skip) => store.state.resumes.filter(r => !skip.includes(r.id));
const keyOf = (store, r) => RS.printedKey(r, T.resolve(store.state.record, r).body);

section('a language copy is in its original\'s group');
{
  const { store, hu } = fresh();
  ok('the copy has inStep and a parent in another language', () => saved(store, hu).inStep === true && saved(store, hu).parent === EN && saved(store, hu).lang === 'hu');
  ok('the group is the original and the copy', () => eq(RS.groupOf(store.state, saved(store, EN)).map(r => r.id), [EN, hu]));
  ok('…from either of them', () => eq(RS.groupOf(store.state, saved(store, hu)).map(r => r.id), [EN, hu]));
  ok('a resume with no copies is a group of one', () => RS.groupOf(store.state, saved(store, names[1])).length === 1);
  ok('a copy for a new job (same language) is not in the group', () => {
    store.commit(d => { RS.duplicate(d, EN, { company: 'Other Co', role: 'Other Role' }); }, 'copy for a job');
    const id = store.state.openId, c = saved(store, id);
    return c.parent === EN && !c.inStep && RS.groupOf(store.state, c).length === 1 && RS.groupOf(store.state, saved(store, EN)).length === 2;
  });
  ok('the copy starts with the original\'s picks, not the empty ones switching leaves', () => picked(store, hu, 'hydra-inhaler') === 'hydra-inhaler-v2-hu' && saved(store, EN).picks['hydra-inhaler'] === 'hydra-inhaler-v2');
  ok('inStep is not printed (the key ignores it)', () => { const a = saved(store, hu), b = clone(a); delete b.inStep; return RS.printedKey(a, {}) === RS.printedKey(b, {}); });
  ok('inStep survives saving a resume and loading it back', () => {
    const file = S.saveResume(store.state.record, saved(store, hu)).file;
    return S.loadResume(file, store.state.record).recipe.inStep === true;
  });
  ok('turning it off leaves the group', () => { const st = clone(store.state); RS.setInStep(st, hu, false); return RS.groupOf(st, RS.savedOf(st, EN)).length === 1; });
}

section('order and other structure goes both ways');
{
  const { store, hu } = fresh();
  const before = order(store, EN);
  ok('English prints inhaler first', () => before[0] === 'hydra-inhaler');
  store.commit(d => { T.moveBullet(d.record, d.cur, 'hydra-suppliers', 'hydra-inhaler'); }, 'move in Hungarian');
  ok('moving a line in Hungarian moves it in English', () => order(store, EN)[0] === 'hydra-suppliers' && eq(order(store, EN), order(store, hu)));
  open(store, EN);
  store.commit(d => { T.moveBullet(d.record, d.cur, 'hydra-testing', 'hydra-suppliers'); }, 'move in English');
  ok('moving a line in English moves it in Hungarian', () => order(store, hu)[0] === 'hydra-testing' && eq(order(store, EN), order(store, hu)));
  store.commit(d => { T.setBulletOn(d.record, d.cur, 'hydra-tolerance', false); }, 'hide in English');
  ok('hiding a line in English hides it in Hungarian', () => !order(store, hu).includes('hydra-tolerance') && eq(order(store, EN), order(store, hu)));
  store.commit(d => { T.moveSection(d.record, d.cur, 'education', 'skills'); }, 'move a section');
  const ids = id => T.sectionList(store.state.record, saved(store, id)).map(s => s.id);
  ok('a section moves in both', () => eq(ids(EN), ids(hu)) && ids(hu).indexOf('education') < ids(hu).indexOf('skills'));
  store.commit(d => { d.cur.locked = ['hydra-testing']; }, 'lock');
  ok('a lock is shared', () => eq(saved(store, hu).locked, ['hydra-testing']));
}

section('each language keeps its own');
{
  const { store, hu } = fresh();
  open(store, EN);
  store.commit(d => { d.cur.design = { colour: 'green', size: 'large', density: 'compact' }; }, 'English look');
  open(store, hu);
  store.commit(d => { d.cur.design = { ...d.cur.design, size: 'small' }; d.cur.format = 'a4'; d.cur.name = 'Magyar neve'; T.setOverride(d.record, d.cur, 'poly-shop', 'Only on the Hungarian one.'); }, 'Hungarian size and one-off');
  const en = saved(store, EN), h = saved(store, hu);
  ok('the look is shared: colour reached the Hungarian', () => h.design.colour === 'green');
  ok('text size and density stay each language\'s', () => en.design.size === 'large' && h.design.size === 'small' && en.design.density === 'compact' && h.design.density === undefined);
  ok('the paper format and language stay', () => en.format === 'us-letter' && h.format === 'a4' && h.lang === 'hu' && en.lang === undefined);
  ok('name stays', () => h.name === 'Magyar neve' && en.name !== 'Magyar neve');
  ok('a one-off text stays on its resume', () => h.overrides['poly-shop'] === 'Only on the Hungarian one.' && !('poly-shop' in (en.overrides ?? {})));
  open(store, EN);
  store.commit(d => { d.cur.pageLimit = 2; d.cur.design = { ...d.cur.design, colour: 'blue' }; }, 'English again');
  ok('an English edit leaves the Hungarian one-off text and size alone', () => saved(store, hu).overrides['poly-shop'] === 'Only on the Hungarian one.' && saved(store, hu).design.size === 'small' && saved(store, hu).design.colour === 'blue' && saved(store, hu).pageLimit === 2);
  store.commit(d => { T.setSectionLabel(d.record, d.cur, 'skills', 'en', 'Know-how'); }, 'English heading');
  ok('a heading typed in English does not replace the Hungarian one', () => T.labelOf(store.state.record, saved(store, hu), 'skills', 'en') === null);
  store.commit(d => { const r = RS.savedOf(d, hu); T.setSectionLabel(d.record, r, 'skills', 'hu', 'Tudás'); }, 'Hungarian heading, set in place');
  store.commit(d => { d.cur.pageLimit = 1; }, 'English once more');
  ok('…and a Hungarian heading survives an English edit', () => T.labelOf(store.state.record, saved(store, hu), 'skills', 'hu') === 'Tudás');
  ok('a local line travels with its text until the copy has its own', () => {
    let id;
    store.commit(d => { id = T.addLocalLine(d.record, d.cur, 'hydra', 'hydra-inhaler'); T.setOverride(d.record, d.cur, id, 'A line only on this resume.'); }, 'local line');
    const ids = r => Object.values(r.localLines ?? {}).flat().map(l => l.id);
    const there = eq(order(store, hu), order(store, EN)) && order(store, hu)[1] === id && saved(store, hu).overrides[id] === 'A line only on this resume.';
    store.commit(d => { T.removeLocalLine(d.record, d.cur, id); }, 'remove it');
    return there && !ids(saved(store, hu)).includes(id) && !(id in saved(store, hu).overrides);
  });
}

section('a pick maps by number');
{
  const { store, hu } = fresh();
  open(store, EN);
  const pick = (id, v) => store.commit(d => { T.pickVersion(d.record, d.cur, id, v); }, `pick ${v}`);
  pick('hydra-testing', 'hydra-testing-v1');
  ok('EN v1 becomes HU v1', () => picked(store, hu, 'hydra-testing') === 'hydra-testing-v1-hu');
  pick('hydra-inhaler', 'hydra-inhaler-v3');
  ok('EN v3 stays the English version while Hungarian has no v3', () => picked(store, hu, 'hydra-inhaler') === 'hydra-inhaler-v3');
  ok('…and the line is missing in Hungarian at v3', () => { const m = want(missing(store, hu), 'hydra-inhaler'); return m?.kind === 'fact' && m.want === '3'; });
  store.commit(d => { R.addVersion(d.record, 'hydra-inhaler', { text: 'A magyar harmadik változat.', lang: 'hu', n: '3' }); }, 'write HU v3');
  ok('writing HU v3 (n: 3) makes the pick HU v3 on the next change', () => { pick('hydra-inhaler', 'hydra-inhaler-v3'); return picked(store, hu, 'hydra-inhaler') === 'hydra-inhaler-v3-hu'; });
  ok('…and nothing is missing for it', () => !want(missing(store, hu), 'hydra-inhaler'));
  pick('hydra-inhaler', 'hydra-inhaler-v2-1');
  ok('EN v2.1 lists Hungarian as behind, v2 → v2.1', () => { const m = want(missing(store, hu), 'hydra-inhaler'); return m?.kind === 'behind' && m.have === '2' && m.want === '2.1'; });
  ok('the pick is back to English in the group\'s other direction too', () => picked(store, EN, 'hydra-inhaler') === 'hydra-inhaler-v2-1');
  ok('the Hungarian one prints the English text for it, as a missing line does', () => (T.chooseVariant(store.state.record, 'hydra-inhaler', saved(store, hu)).v.lang ?? 'en') === 'en');
  ok('English is checked too (it is in a group), and nothing is missing in it here', () => missing(store, EN).length === 0);
  pick('summary', 'summary-v3');
  ok('a line with no Hungarian at the number is listed, one that has it is not', () => { const ids = missing(store, hu).map(m => m.id); return ids.includes('summary') && ids.includes('hydra-inhaler') && !ids.includes('hydra-testing'); });
  ok('outside a group the missing list is what it was', () => {
    const old = clone(saved(store, hu)); delete old.inStep;
    return L.missingList(store.state.record, old).every(m => m.kind !== 'behind') && L.missingList(store.state.record, saved(store, EN)).length === 0;
  });
}

section('new numbers count over every language');
{
  const { store, hu } = fresh();
  const m = clone(store.state.record);
  ok('EN has v1 to v3 of the inhaler line, so a new Hungarian major is v4', () => R.nextMajor(m, 'hydra-inhaler', 'hu') === '4' && R.nextMajor(m, 'hydra-inhaler', 'en') === '4');
  ok('a new minor under v2 is v2.3, whichever language asks', () => R.nextMinor(m, 'hydra-inhaler', '2', 'hu') === '2.3' && R.nextMinor(m, 'hydra-inhaler', '2', 'en') === '2.3');
  ok('the new Hungarian major is v4 and its id does not clash with English', () => {
    const v = R.addVersion(m, 'hydra-inhaler', { text: 'Negyedik változat.', lang: 'hu', as: 'major' });
    const en4 = R.addVersion(m, 'hydra-inhaler', { text: 'Fourth version.', lang: 'en', n: '4' });
    return v.n === '4' && v.id === 'hydra-inhaler-v4-hu' && en4.id === 'hydra-inhaler-v4' && new Set(m.variants.map(x => x.id)).size === m.variants.length;
  });
  ok('a language with no text for the line yet starts at v1', () => R.nextMajor(m, 'hydra-tolerance', 'hu') === '1' && R.nextMajor(m, 'hydra-tolerance', 'en') === '2');
  ok('existing versions keep their numbers', () => model.variants.every(v => m.variants.find(x => x.id === v.id)?.n === v.n));
  ok('a number already taken in the language is refused', () => {
    try { R.addVersion(clone(model), 'hydra-inhaler', { text: 'Again.', lang: 'hu', n: '2' }); return false; } catch (e) { return e instanceof R.RecordError; }
  });
  ok('a deleted number is not reused either', () => {
    const c = clone(model); R.deleteVersion(c, 'hydra-inhaler-v2-hu', []);
    try { R.addVersion(c, 'hydra-inhaler', { text: 'Again.', lang: 'hu', n: '2' }); return false; } catch (e) { return e instanceof R.RecordError; }
  });
  ok('a number that is not a number is refused', () => {
    try { R.addVersion(clone(model), 'hydra-inhaler', { text: 'x', lang: 'hu', n: 'three' }); return false; } catch (e) { return e instanceof R.RecordError; }
  });
  open(store, hu);
  store.commit(d => { const v = R.addVersion(d.record, 'hydra-inhaler', { text: 'Negyedik változat.', lang: 'hu', as: 'major' }); T.pickVersion(d.record, d.cur, 'hydra-inhaler', v.id); }, 'new HU major');
  ok('a new HU major lists English as missing at that number', () => { const x = want(missing(store, EN), 'hydra-inhaler'); return picked(store, EN, 'hydra-inhaler') === 'hydra-inhaler-v4-hu' && x?.kind === 'fact' && x.want === '4'; });
}

section('one undo restores both');
{
  const { store, hu } = fresh();
  open(store, EN);
  const before = JSON.stringify([store.state.resumes, store.state.frozen, store.state.cur]);
  store.commit(d => { T.moveBullet(d.record, d.cur, 'hydra-suppliers', 'hydra-inhaler'); }, 'move');
  ok('the move reached the Hungarian copy', () => order(store, hu)[0] === 'hydra-suppliers');
  store.undo();
  ok('undo puts both resumes back', () => JSON.stringify([store.state.resumes, store.state.frozen, store.state.cur]) === before && order(store, hu)[0] === 'hydra-inhaler');
  store.redo();
  ok('redo does both again', () => order(store, hu)[0] === 'hydra-suppliers' && order(store, EN)[0] === 'hydra-suppliers');
}

section('the copy\'s frozen text is current');
{
  const { store, hu } = fresh();
  open(store, EN);
  store.commit(d => { T.pickVersion(d.record, d.cur, 'hydra-testing', 'hydra-testing-v1'); T.moveBullet(d.record, d.cur, 'hydra-suppliers', 'hydra-inhaler'); }, 'change');
  ok('its frozen body is what it prints now', () => eq(store.state.frozen[hu], T.resolve(store.state.record, saved(store, hu)).body));
  ok('opening it offers nothing as newer wording', () => { const st = clone(store.state); const r = RS.openSaved(st, hu); return r.held.length === 0 && !st.cur.held; });
}

section('a copy made before inStep is left alone');
{
  const { store, hu } = fresh();
  store.commit(d => { delete RS.savedOf(d, hu).inStep; RS.openSaved(d, hu); }, 'make it an old copy');
  const old = JSON.stringify(saved(store, hu)), oldFrozen = JSON.stringify(store.state.frozen[hu]);
  ok('it is not in a group', () => RS.groupOf(store.state, saved(store, hu)).length === 1 && RS.groupOf(store.state, saved(store, EN)).length === 1);
  open(store, EN);
  store.commit(d => { T.moveBullet(d.record, d.cur, 'hydra-suppliers', 'hydra-inhaler'); T.pickVersion(d.record, d.cur, 'hydra-testing', 'hydra-testing-v1'); }, 'English edit');
  ok('an English edit leaves it byte for byte', () => JSON.stringify(saved(store, hu)) === old && JSON.stringify(store.state.frozen[hu]) === oldFrozen);
  open(store, hu);
  store.commit(d => { T.moveBullet(d.record, d.cur, 'hydra-testing', 'hydra-inhaler'); }, 'Hungarian edit');
  ok('and a Hungarian edit does not reach English', () => order(store, EN)[0] === 'hydra-suppliers');
  ok('turning it on stores its own picks in byLang first', () => {
    store.commit(d => { T.pickVersion(d.record, d.cur, 'hydra-dfm', 'hydra-dfm-v1-hu'); }, 'its own pick');
    const own = clone(saved(store, hu).picks);
    store.commit(d => { RS.setInStep(d, hu, true); }, 'keep in step');
    return saved(store, hu).inStep === true && eq(saved(store, hu).byLang.hu.picks, own);
  });
  ok('…and then it takes the English order and picks', () => eq(order(store, hu), order(store, EN)) && picked(store, hu, 'hydra-testing') === 'hydra-testing-v1-hu');
  ok('one undo undoes turning it on', () => { store.undo(); return !saved(store, hu).inStep && JSON.stringify(saved(store, EN)) !== undefined && order(store, hu)[0] === 'hydra-testing'; });
  ok('a resume with no original in another language can\'t be put in step', () => {
    try { RS.setInStep(clone(store.state), names[1], true); return false; } catch { return true; }
  });
}

section('resumes outside a group are untouched');
{
  const { store, hu } = fresh();
  const others = bystanders(store, [EN, hu]);
  const snap = JSON.stringify([others, others.map(r => store.state.frozen[r.id])]), keys = others.map(r => keyOf(store, r));
  open(store, EN);
  store.commit(d => { T.moveBullet(d.record, d.cur, 'hydra-suppliers', 'hydra-inhaler'); T.pickVersion(d.record, d.cur, 'hydra-inhaler', 'hydra-inhaler-v3'); d.cur.design = { colour: 'green' }; }, 'English edit');
  open(store, hu);
  store.commit(d => { T.moveBullet(d.record, d.cur, 'hydra-testing', 'hydra-inhaler'); }, 'Hungarian edit');
  const after = bystanders(store, [EN, hu]);
  ok('every other resume is byte for byte what it was, frozen text included', () => JSON.stringify([after, after.map(r => store.state.frozen[r.id])]) === snap);
  ok('…and prints the same', () => eq(after.map(r => keyOf(store, r)), keys));
  ok('there are other resumes to compare', () => others.length === names.length - 1);
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
