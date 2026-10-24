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
import * as K from '../src/model/career.js';
import { createStore } from '../src/store/store.js';
import { validate } from './lib/validate.mjs';

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
// a setup step that throws is a FAIL with its message too, and the run goes on
const attempt = (name, fn) => { try { fn(); } catch (e) { console.log(`FAIL  ${name}  — ${e.message}`); failed++; } };

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
const missing = (store, id) => L.missingList(store.state.record, saved(store, id), RS.groupOpts(store.state, saved(store, id)));
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
  ok('a file with inStep that is not true loads without the flag, with a warning', () => {
    const file = S.saveResume(store.state.record, saved(store, hu)).file;
    file.meta.resumeBuilder.resume.inStep = 'yes';
    const got = S.loadResume(file, store.state.record);
    return !('inStep' in got.recipe) && got.warnings.some(w => /inStep/.test(w));
  });
  ok('turning it off leaves the group', () => { const st = clone(store.state); RS.setInStep(st, hu, false); return RS.groupOf(st, RS.savedOf(st, EN)).length === 1; });
  ok('…and keeps no pick in another language, so its page still draws', () => {
    const st = clone(store.state); RS.setInStep(st, hu, false);
    const r = RS.savedOf(st, hu), vs = new Map(st.record.variants.map(v => [v.id, v]));
    return Object.values(r.picks ?? {}).every(vid => (vs.get(vid)?.lang ?? 'en') === (r.lang ?? 'en'));
  });
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

section('a line with no pick prints the same number too');
{
  const { store, hu } = fresh();
  open(store, EN);
  // English prints v2 of the testing line by default (its format is listed on it); Hungarian would print its v1
  store.commit(d => { delete d.cur.picks['hydra-testing']; d.record.variants.find(v => v.id === 'hydra-testing-v2').seenIn = ['us-letter']; }, 'English default v2');
  ok('English prints v2 and Hungarian has none: it keeps the English v2 and lists the line missing at v2', () => {
    const m = want(missing(store, hu), 'hydra-testing');
    return !('hydra-testing' in (saved(store, EN).picks)) && picked(store, hu, 'hydra-testing') === 'hydra-testing-v2' && m?.kind === 'fact' && m.want === '2';
  });
  store.commit(d => { R.addVersion(d.record, 'hydra-testing', { text: 'A magyar második változat.', lang: 'hu', n: '2' }); }, 'write HU v2');
  ok('once Hungarian has v2, the next change picks it, with English still unpicked', () => picked(store, hu, 'hydra-testing') === 'hydra-testing-v2-hu' && !want(missing(store, hu), 'hydra-testing') && !('hydra-testing' in saved(store, EN).picks));
  ok('a line where both print the same number is left unpicked', () => !('hydra-suppliers' in (saved(store, hu).picks ?? {})) && !('hydra-suppliers' in saved(store, EN).picks));
  ok('Hungarian printing another default is brought to the English number the other way round too', () => {
    open(store, hu);
    store.commit(d => { delete d.cur.picks['hydra-testing']; }, 'Hungarian unpicks');
    return picked(store, EN, 'hydra-testing') === 'hydra-testing-v1';
  });
}

section('numbers carried into an earlier translation');
{
  const norm = x => x.replace(/[\u00a0\u202f]/g, ' ');
  ok('$1.2M → $1.4M arrives in a Hungarian text as 1,4, the currency staying where it was', () => L.carryNumbers('Cut tooling cost to $1.2M', 'Cut tooling cost to $1.4M', 'A szerszámköltség 1,2 M $-ra csökkent', 'hu') === 'A szerszámköltség 1,4 M $-ra csökkent');
  ok('1,200 → 1,500 is written 1 500 for French', () => norm(L.carryNumbers('Sold 1,200 units', 'Sold 1,500 units', '1 200 unités vendues', 'fr')) === '1 500 unités vendues');
  ok('a number that did not change is left as the translation has it', () => L.carryNumbers('Cut 30% in 2 weeks', 'Cut 40% in 2 weeks', '30%-kal rövidebb, 2 hét alatt', 'hu') === '40%-kal rövidebb, 2 hét alatt');
  ok('a count that differs returns the translation unchanged', () => L.carryNumbers('Cut 30%', 'Cut 30% in 2 weeks', '30%-kal csökkent', 'hu') === '30%-kal csökkent' && L.carryNumbers('Cut 30% in 2 weeks', 'Cut 40% in 2 weeks', '40%-kal csökkent', 'hu') === '40%-kal csökkent');
  ok('a text with no numbers is returned as it is', () => L.carryNumbers('Led the team', 'Led the whole team', 'Vezette a csapatot', 'hu') === 'Vezette a csapatot');
  ok('decimals keep their digits: 0.125 → 0.5 is 0,5 in German', () => L.carryNumbers('Gap of 0.125 mm', 'Gap of 0.5 mm', 'Spalt von 0,125 mm', 'de') === 'Spalt von 0,5 mm');
}

section('writing a text at the number the line prints');
{
  const { store, hu } = fresh();
  open(store, EN);
  store.commit(d => { R.addVersion(d.record, 'hydra-testing', { text: 'Ran 1,200 tests.', lang: 'en', n: '3' }); T.pickVersion(d.record, d.cur, 'hydra-testing', d.record.variants.find(v => v.id === 'hydra-testing-v3').id); }, 'EN v3');
  open(store, hu);
  const m = want(missing(store, hu), 'hydra-testing');
  ok('the line is missing in Hungarian at v3, from English', () => m?.kind === 'fact' && m.want === '3' && m.from === 'en');
  const plan = L.writeInPlan(store.state.record, saved(store, hu), 'hydra-testing');
  ok('the plan has the English text and nothing to start from', () => plan.ref.id === 'hydra-testing-v3' && plan.n === '3' && plan.seed === '' && plan.diff === null && plan.have === null);
  let v;
  store.commit(d => { v = L.writeIn(d.record, 'hydra-testing', 'hu', '1200 tesztet futtatott.', plan.ref.id, plan.n); T.pickVersion(d.record, d.cur, 'hydra-testing', v.id); }, 'write HU v3');
  ok('writeIn with a number saves the Hungarian at that number', () => v.n === '3' && v.lang === 'hu');
  ok('…the line is no longer missing, and English still prints its v3', () => !want(missing(store, hu), 'hydra-testing') && picked(store, EN, 'hydra-testing') === 'hydra-testing-v3' && !want(missing(store, EN), 'hydra-testing'));
  ok('without a number it is still the next major, as before', () => { const m2 = clone(store.state.record); return L.writeIn(m2, 'hydra-testing', 'hu', 'Másik.').n === '4'; });
  ok('a number that is taken is refused', () => { const m2 = clone(store.state.record); try { L.writeIn(m2, 'hydra-testing', 'hu', 'Ismét.', null, '3'); return false; } catch { return true; } });

  // behind: English moves on to v3.1, Hungarian has v3
  open(store, EN);
  store.commit(d => { const x = R.addVersion(d.record, 'hydra-testing', { text: 'Ran 1,500 tests.', lang: 'en', from: 'hydra-testing-v3', as: 'minor' }); T.pickVersion(d.record, d.cur, 'hydra-testing', x.id); }, 'EN v3.1');
  open(store, hu);
  const b = want(missing(store, hu), 'hydra-testing'), bp = L.writeInPlan(store.state.record, saved(store, hu), 'hydra-testing');
  ok('a line behind lists the older number and the language it changed in', () => b?.kind === 'behind' && b.have === '3' && b.want === '3.1' && b.from === 'en');
  ok('its plan has the changes since v3 and the old text with the new number carried in', () => bp.diff.some(x => x.op === '+') && bp.diff.some(x => x.op === '-') && bp.seed.replace(/[\u00a0\u202f]/g, ' ') === '1 500 tesztet futtatott.' && bp.n === '3.1');
  let x31;
  store.commit(d => { x31 = L.writeIn(d.record, 'hydra-testing', 'hu', bp.seed, bp.ref.id, bp.n); T.pickVersion(d.record, d.cur, 'hydra-testing', x31.id); }, 'write HU v3.1');
  ok('saving it makes Hungarian v3.1 and the line is whole again', () => x31.n === '3.1' && !want(missing(store, hu), 'hydra-testing') && picked(store, hu, 'hydra-testing') === x31.id);
  ok('a line that prints its own language has no plan', () => L.writeInPlan(store.state.record, saved(store, hu), 'hydra-testing') === null);
}

section('the validator accepts a group\u2019s missing state only');
{
  const { store, hu } = fresh();
  open(store, EN);
  store.commit(d => { T.pickVersion(d.record, d.cur, 'hydra-inhaler', 'hydra-inhaler-v3'); }, 'EN v3');
  const inStep = saved(store, hu), plain = clone(inStep);
  delete plain.inStep;
  const errs = r => validate(S.save(store.state.record), r).errors;
  ok('an inStep copy with a line missing at its number has no errors', () => inStep.picks['hydra-inhaler'] === 'hydra-inhaler-v3' && errs(inStep).length === 0);
  ok('the same pick in a resume without inStep is still an error', () => errs(plain).some(e => /language is chosen once/.test(e)));
  ok('an inStep copy picking the English version where Hungarian has that number is an error', () => {
    const r = clone(inStep); r.picks['hydra-testing'] = 'hydra-testing-v1';
    return errs(r).some(e => /hydra-testing/.test(e) && /language is chosen once/.test(e));
  });
}

// ---- Step 1b: headings and other labels, one-off texts, the old versions ----
const labelOf = (store, id, key) => T.printedLabel(store.state.record, saved(store, id), key);
const kind = (list, k, id) => list.find(m => m.kind === k && m.id === id);
const writeLabel = (store, id, fn) => { open(store, id); store.commit(d => { fn(d); }, `write a label in ${id}`); };

section('a heading written in one language is listed in the other when the first changes');
{
  const { store, hu } = fresh();
  const was = T.recordTitle(store.state.record, 'experience', 'en');
  ok('a heading in a group keeps the other language\'s text it was written against', () => {
    writeLabel(store, hu, d => T.setSectionLabel(d.record, d.cur, 'experience', 'hu', 'Munkatapasztalat'));
    return eq(saved(store, hu).labelFrom, { '~h:experience': { en: was } });
  });
  ok('labelFrom is not printed (the key ignores it) and stays each resume\'s own', () => {
    const a = saved(store, hu), b = clone(a); delete b.labelFrom;
    return RS.printedKey(a, {}) === RS.printedKey(b, {}) && !saved(store, EN).labelFrom;
  });
  ok('nothing is listed while English still says what it said', () => !kind(missing(store, hu), 'heading-changed', 'experience') && !kind(missing(store, EN), 'heading-changed', 'experience'));
  writeLabel(store, EN, d => T.setSectionLabel(d.record, d.cur, 'experience', 'en', 'Work history'));
  ok('English writes its own: it keeps the Hungarian text', () => eq(saved(store, EN).labelFrom, { '~h:experience': { hu: 'Munkatapasztalat' } }));
  ok('a renamed English heading lists the Hungarian one as heading-changed, from English, with both texts', () => {
    const m = kind(missing(store, hu), 'heading-changed', 'experience');
    return m?.from === 'en' && m.was === was && m.now === 'Work history' && m.labelKey === '~h:experience' && m.where.kind === 'section' && m.label === 'Munkatapasztalat';
  });
  ok('…and not the English one: nothing changed in Hungarian since', () => !kind(missing(store, EN), 'heading-changed', 'experience'));
  ok('outside a group the list does not have it', () => { const old = clone(saved(store, hu)); delete old.inStep; return !L.missingList(store.state.record, old).some(m => m.kind === 'heading-changed'); });
  writeLabel(store, hu, d => T.setSectionLabel(d.record, d.cur, 'experience', 'hu', 'Munkatörténet'));
  ok('saving the Hungarian heading stops it', () => !kind(missing(store, hu), 'heading-changed', 'experience') && saved(store, hu).labelFrom['~h:experience'].en === 'Work history');
  ok('…and now English is the one that has changed since it was written', () => { const m = kind(missing(store, EN), 'heading-changed', 'experience'); return m?.from === 'hu' && m.now === 'Munkatörténet'; });
  ok('keeping it as it is (confirming) stops it too, with no new words', () => {
    open(store, EN);
    store.commit(d => { RS.keepLabelAs(d, '~h:experience'); }, 'keep');
    return !kind(missing(store, EN), 'heading-changed', 'experience') && saved(store, EN).labelFrom['~h:experience'].hu === 'Munkatörténet';
  });
  ok('clearing the heading drops its labelFrom', () => { writeLabel(store, hu, d => T.setSectionLabel(d.record, d.cur, 'experience', 'hu', null)); return !saved(store, hu).labelFrom; });
  ok('one undo takes back the label and its labelFrom together', () => { store.undo(); return saved(store, hu).labelFrom?.['~h:experience'] && T.labelOf(store.state.record, saved(store, hu), 'experience', 'hu') === 'Munkatörténet'; });
  ok('a heading the other language wrote against is only listed when the section prints', () => {
    writeLabel(store, hu, d => { T.setSectionLabel(d.record, d.cur, 'experience', 'hu', 'Tapasztalat 3'); T.setSectionLabel(d.record, d.cur, 'education', 'hu', 'Tanulmányok'); });
    writeLabel(store, EN, d => { T.setSectionLabel(d.record, d.cur, 'education', 'en', 'Studies'); T.setSectionLabel(d.record, d.cur, 'experience', 'en', 'Work history 2'); });
    const ids = missing(store, hu).filter(m => m.kind === 'heading-changed').map(m => m.id).sort();
    const both = eq(ids, ['education', 'experience']);
    store.commit(d => { T.setSectionOn(d.record, d.cur, 'education', false); }, 'hide');
    return both && eq(missing(store, hu).filter(m => m.kind === 'heading-changed').map(m => m.id), ['experience']);
  });
}

section('a skill group name and a language\'s name behave the same');
{
  const { store, hu } = fresh();
  ok('a skill group name written in Hungarian keeps English\'s', () => {
    writeLabel(store, hu, d => T.writeGroup(d.record, d.cur, 'skills-cad', 'CAD és 3D tervezés\nSolidWorks, Fusion'));
    return eq(saved(store, hu).labelFrom, { '~g:skills-cad': { en: 'CAD & 3D' } });
  });
  writeLabel(store, EN, d => T.writeGroup(d.record, d.cur, 'skills-cad', 'Computer-aided design\nSolidWorks, Fusion'));
  ok('a renamed English group lists the Hungarian one, with the group\'s id, label and the skills section', () => {
    const m = kind(missing(store, hu), 'heading-changed', 'skills-cad');
    return m?.from === 'en' && m.was === 'CAD & 3D' && m.now === 'Computer-aided design' && m.labelKey === '~g:skills-cad' && m.where.section === 'skills' && m.label === 'CAD és 3D tervezés';
  });
  writeLabel(store, hu, d => T.writeGroup(d.record, d.cur, 'skills-cad', 'CAD és 3D rajz\nSolidWorks, Fusion'));
  ok('saving the Hungarian one stops it', () => !kind(missing(store, hu), 'heading-changed', 'skills-cad'));
  ok('a language\'s name written in Hungarian keeps English\'s, and a change in English lists it', () => {
    writeLabel(store, EN, d => T.setSectionOn(d.record, d.cur, 'languages', true));
    writeLabel(store, hu, d => T.setTerm(d.record, d.cur, 'lang-english', 'hu', 'Angol nyelv'));
    const kept = eq(saved(store, hu).labelFrom['~t:lang-english'], { en: 'English' });
    writeLabel(store, EN, d => T.setTerm(d.record, d.cur, 'lang-english', 'en', 'English (C1)'));
    const m = kind(missing(store, hu), 'heading-changed', 'lang-english');
    return kept && m?.labelKey === '~t:lang-english' && m.now === 'English (C1)';
  });
}

section('a label of the record (i18n) behaves the same');
{
  const { store, hu } = fresh();
  const rec = () => store.state.record;
  ok('a field written in Hungarian keeps the English it was written against', () => {
    store.commit(d => { K.updateJob(d.record, 'hydra', { location: 'Lisszabon, PT' }, 'hu'); }, 'Hungarian location');
    return rec().i18n.hu.from['fields/work/hydra/location'] === 'Lisbon, Portugal';
  });
  ok('a section heading and a skill group name written in the record keep it too', () => {
    store.commit(d => { K.updateSkill(d.record, 'skills-cad', { name: 'CAD és 3D' }, 'hu'); }, 'Hungarian skill name');
    return rec().i18n.hu.from['labels/skills-cad'] === 'CAD & 3D';
  });
  ok('nothing is listed while English is what it was', () => !missing(store, hu).some(m => m.kind === 'heading-changed'));
  ok('a changed English field lists the Hungarian resume that prints the job', () => {
    store.commit(d => { K.updateJob(d.record, 'hydra', { location: 'Lisbon, PT' }, 'en'); }, 'English location');
    const m = kind(missing(store, hu), 'heading-changed', 'work/hydra/location');
    return m?.from === 'en' && m.was === 'Lisbon, Portugal' && m.now === 'Lisbon, PT' && m.labelKey === '~f:work/hydra/location' && eq(m.where, { kind: 'job', id: 'hydra' });
  });
  ok('…and a changed English group name lists the group, as the record\'s', () => {
    store.commit(d => { K.updateSkill(d.record, 'skills-cad', { name: 'CAD and 3D' }, 'en'); }, 'English skill name');
    const m = kind(missing(store, hu), 'heading-changed', 'skills-cad');
    return m?.was === 'CAD & 3D' && m.now === 'CAD and 3D' && m.labelKey === '~g:skills-cad';
  });
  ok('saving the Hungarian ones stops them', () => {
    store.commit(d => { K.updateJob(d.record, 'hydra', { location: 'Lisszabon' }, 'hu'); K.updateSkill(d.record, 'skills-cad', { name: 'CAD és 3D rajz' }, 'hu'); }, 'Hungarian again');
    return !missing(store, hu).some(m => m.kind === 'heading-changed');
  });
  ok('a Hungarian label with no from yet is not stale', () => {
    const m = clone(store.state.record); delete m.i18n.hu.from;
    return L.missingList(m, saved(store, hu), RS.groupOpts({ ...store.state, record: m }, saved(store, hu))).every(x => x.kind !== 'heading-changed');
  });
  ok('confirming a record label for this resume stops it without writing the record', () => {
    store.commit(d => { K.updateJob(d.record, 'hydra', { location: 'Lisbon' }, 'en'); }, 'English moves again');
    const before = !!kind(missing(store, hu), 'heading-changed', 'work/hydra/location');
    open(store, hu);
    store.commit(d => { RS.keepLabelAs(d, '~f:work/hydra/location'); }, 'keep');
    return before && !kind(missing(store, hu), 'heading-changed', 'work/hydra/location') && eq(saved(store, hu).labelFrom['~f:work/hydra/location'], { en: 'Lisbon' });
  });
  ok('deleting a language row or skill group takes its from with it', () => {
    const m = clone(store.state.record); K.deleteItem(m, 'skills', 'skills-cad');
    return !m.skills.some(x => x.id === 'skills-cad') && !m.i18n.hu.labels['skills-cad'] && !m.i18n.hu.from?.['labels/skills-cad'];
  });
  ok('i18n.<lang>.from survives a save and a load', () => eq(S.load(S.save(rec())).model.i18n.hu.from, rec().i18n.hu.from));
  ok('the validator accepts it, and a malformed one is an error', () => {
    const bad = clone(rec()); bad.i18n.hu.from = { 'fields/x': 5 };
    return validate(S.save(rec())).errors.length === 0 && validate(S.save(bad)).errors.some(e => /i18n\.hu\.from/.test(e));
  });
}

section('labelFrom in a saved resume');
{
  const { store, hu } = fresh();
  writeLabel(store, hu, d => T.setSectionLabel(d.record, d.cur, 'experience', 'hu', 'Munkatapasztalat'));
  const file = () => S.saveResume(store.state.record, saved(store, hu)).file;
  ok('it survives saving and loading, untouched', () => { const got = S.loadResume(file(), store.state.record); return eq(got.recipe.labelFrom, saved(store, hu).labelFrom) && got.warnings.length === 0; });
  ok('a malformed one is cleaned with a warning, keeping the text leaves', () => {
    const f = file(); f.meta.resumeBuilder.resume.labelFrom = { '~h:experience': { en: 'Experience', hu: 4 }, '~h:skills': 'x', '~h:education': { en: 5 } };
    const got = S.loadResume(f, store.state.record);
    return eq(got.recipe.labelFrom, { '~h:experience': { en: 'Experience' } }) && got.warnings.some(w => /labelFrom/.test(w));
  });
  ok('one that is not an object is dropped with a warning', () => {
    const f = file(); f.meta.resumeBuilder.resume.labelFrom = 'yes';
    const got = S.loadResume(f, store.state.record);
    return !('labelFrom' in got.recipe) && got.warnings.some(w => /labelFrom/.test(w));
  });
  ok('it is not kept inside terms or the labels, which keep only { lang: name }', () => !JSON.stringify(saved(store, hu).sections).includes('Experience') && !('terms' in saved(store, hu)));
  ok('the validator accepts a resume with it, and a raw malformed one is an error', () => {
    const r = clone(saved(store, hu)), bad = clone(r); bad.labelFrom = { '~h:experience': { en: 5 } };
    const errs = x => validate(S.save(store.state.record), x).errors;
    return errs(r).length === 0 && errs(bad).some(e => /labelFrom/.test(e));
  });
  ok('a language copy starts with none of its original\'s', () => {
    writeLabel(store, EN, d => T.setSectionLabel(d.record, d.cur, 'skills', 'en', 'Know-how'));
    store.commit(d => { RS.duplicate(d, EN, { lang: 'de' }); }, 'German copy');
    return !saved(store, store.state.openId).labelFrom;
  });
}

section('a one-off text in one language is listed in the others');
{
  const { store, hu } = fresh();
  open(store, EN);
  ok('nothing is listed before an edit', () => !missing(store, hu).some(m => m.kind === 'edited-elsewhere'));
  store.commit(d => { T.setOverride(d.record, d.cur, 'hydra-suppliers', 'Qualified the moulding suppliers, changed here only.'); }, 'English one-off');
  ok('an English override lists the Hungarian line as edited-elsewhere, from English', () => { const m = kind(missing(store, hu), 'edited-elsewhere', 'hydra-suppliers'); return m?.from === 'en' && /changed here only/.test(m.text) && m.where.owner === 'hydra'; });
  ok('…and not the English one, which has the text', () => !kind(missing(store, EN), 'edited-elsewhere', 'hydra-suppliers'));
  ok('the other direction too', () => {
    writeLabel(store, hu, d => T.setOverride(d.record, d.cur, 'hydra-testing', 'Csak itt módosított szöveg.'));
    return kind(missing(store, EN), 'edited-elsewhere', 'hydra-testing')?.from === 'hu';
  });
  ok('a line with its own one-off text in both is not listed', () => {
    writeLabel(store, EN, d => T.setOverride(d.record, d.cur, 'hydra-testing', 'Only here, in English too.'));
    return !kind(missing(store, hu), 'edited-elsewhere', 'hydra-testing') && !kind(missing(store, EN), 'edited-elsewhere', 'hydra-testing');
  });
  ok('a line only on one resume is not listed', () => {
    writeLabel(store, EN, d => { const id = T.addLocalLine(d.record, d.cur, 'hydra', 'hydra-inhaler'); T.setOverride(d.record, d.cur, id, 'A line only on English.'); });
    return !missing(store, hu).some(m => m.kind === 'edited-elsewhere' && m.id !== 'hydra-suppliers' && m.id !== 'hydra-testing');
  });
  ok('a line the other resume holds at older wording (held) is not an edit', () => {
    const st = clone(store.state), r = RS.savedOf(st, EN);
    r.held = ['hydra-suppliers'];
    return !L.missingList(st.record, RS.savedOf(st, hu), RS.groupOpts(st, RS.savedOf(st, hu))).some(m => m.kind === 'edited-elsewhere' && m.id === 'hydra-suppliers');
  });
  ok('it ends when the override is gone', () => {
    writeLabel(store, EN, d => T.dropOverride(d.record, d.cur, 'hydra-suppliers'));
    return !kind(missing(store, hu), 'edited-elsewhere', 'hydra-suppliers');
  });
  ok('once it is a version, the number rule takes over: the line is missing at that number', () => {
    writeLabel(store, EN, d => { T.setOverride(d.record, d.cur, 'hydra-suppliers', 'Qualified the moulding suppliers.'); });
    const v = (() => { let x; store.commit(d => { x = R.addVersion(d.record, 'hydra-suppliers', { text: 'Qualified the moulding suppliers.', lang: 'en', as: 'major' }); T.dropOverride(d.record, d.cur, 'hydra-suppliers'); T.pickVersion(d.record, d.cur, 'hydra-suppliers', x.id); }, 'make it a version'); return x; })();
    const m = kind(missing(store, hu), 'fact', 'hydra-suppliers');
    return !kind(missing(store, hu), 'edited-elsewhere', 'hydra-suppliers') && m?.want === v.n && m.from === 'en';
  });
  ok('the missing list outside a group is what it was', () => { const old = clone(saved(store, hu)); delete old.inStep; return L.missingList(store.state.record, old).every(m => m.kind === 'fact' || m.kind === 'heading'); });
}

section('matching an old version to the number of the text it translates');
{
  const { store, hu } = fresh();
  const rec = () => store.state.record, ver = id => rec().variants.find(v => v.id === id);
  ok('matchNumber moves the number and keeps the id, the default and the version\'s text', () => {
    const m = clone(model), text = m.variants.find(v => v.id === 'summary-v2-hu').text, def = clone(m.facts.find(f => f.id === 'summary').default);
    const v = R.matchNumber(m, 'summary-v2-hu', '3');
    return v.id === 'summary-v2-hu' && v.n === '3' && v.text === text && eq(m.facts.find(f => f.id === 'summary').default, def) && R.versionsIn(m, 'summary', 'hu').map(x => x.n).join() === '1,3';
  });
  ok('a number the language has is refused', () => { try { R.matchNumber(clone(model), 'summary-v2-hu', '1'); return false; } catch (e) { return e instanceof R.RecordError && /taken/.test(e.message); } });
  ok('a number the language had (retired) is refused', () => {
    const m = clone(model); R.deleteVersion(m, 'summary-v1-hu', []);
    try { R.matchNumber(m, 'summary-v2-hu', '1'); return false; } catch (e) { return e instanceof R.RecordError; }
  });
  ok('something that is not a number, or not a version, is refused', () => {
    const bad = (id, n) => { try { R.matchNumber(clone(model), id, n); return false; } catch (e) { return e instanceof R.RecordError; } };
    return bad('summary-v2-hu', 'three') && bad('summary-v2-hu', '3.') && bad('nope', '3');
  });
  ok('the same number again changes nothing', () => R.matchNumber(clone(model), 'summary-v2-hu', '2').n === '2');
  ok('takenNumber says what matchNumber would refuse', () => R.takenNumber(model, 'summary', 'hu', '2') && !R.takenNumber(model, 'summary', 'hu', '3') && R.takenNumber(model, 'summary', 'en', '4'));

  // English prints v3 of the summary; Hungarian has v1 and v2 (its v2 is the translation of English v3)
  open(store, EN);
  store.commit(d => { T.pickVersion(d.record, d.cur, 'summary', 'summary-v3'); }, 'EN v3');
  store.commit(d => { const r = RS.savedOf(d, names.find(n => /Dunamenti/.test(n))); r.picks = { ...r.picks, summary: 'summary-v2-hu' }; }, 'another resume picks the Hungarian version');
  const picksBefore = JSON.stringify(bystanders(store, [EN, hu]).map(r => r.picks)), keys = bystanders(store, [EN, hu]).map(r => keyOf(store, r));
  open(store, hu);
  ok('the Hungarian copy prints the English v3 and lists the line missing at v3', () => picked(store, hu, 'summary') === 'summary-v3' && want(missing(store, hu), 'summary')?.want === '3');
  let beforeMatch;
  attempt('matching a version commits', () => store.commit(d => { beforeMatch = JSON.stringify(RS.savedOf(d, EN)); RS.matchVersion(d, 'summary-v2-hu', '3'); }, 'match'));
  ok('after matching, the id is the same and its number is 3', () => ver('summary-v2-hu').n === '3' && ver('summary-v2-hu').id === 'summary-v2-hu');
  ok('the open copy\'s pick that held the English version is remapped to it', () => picked(store, hu, 'summary') === 'summary-v2-hu' && store.state.cur.picks.summary === 'summary-v2-hu');
  ok('…so the line is no longer missing', () => !want(missing(store, hu), 'summary') && !want(missing(store, EN), 'summary'));
  ok('English still prints its v3, unchanged', () => JSON.stringify(saved(store, EN)).includes('"summary":"summary-v3"') && picked(store, EN, 'summary') === 'summary-v3');
  ok('every other saved resume renders byte for byte what it did', () => eq(bystanders(store, [EN, hu]).map(r => keyOf(store, r)), keys));
  ok('no other saved resume\'s picks changed', () => JSON.stringify(bystanders(store, [EN, hu]).map(r => r.picks)) === picksBefore && picksBefore.includes('summary-v2-hu'));
  ok('the copy prints the Hungarian text now', () => T.resolve(rec(), saved(store, hu)).body.basics.summary === ver('summary-v2-hu').text);
  ok('one undo takes the match back, the number and the pick together', () => {
    store.undo();
    return ver('summary-v2-hu').n === '2' && picked(store, hu, 'summary') === 'summary-v3' && JSON.stringify(saved(store, EN)) === beforeMatch;
  });
  ok('matching from the English side remaps the Hungarian copy too (every member, not the open one)', () => {
    open(store, EN);
    store.commit(d => { RS.matchVersion(d, 'summary-v2-hu', '3'); }, 'match from English');
    return picked(store, hu, 'summary') === 'summary-v2-hu' && picked(store, EN, 'summary') === 'summary-v3';
  });
  ok('a refused number changes nothing and throws', () => {
    const st = clone(store.state);
    try { RS.matchVersion(st, 'summary-v1-hu', '3'); return false; } catch (e) { return e instanceof R.RecordError && JSON.stringify(st.record) === JSON.stringify(store.state.record); }
  });
  ok('a third language\'s copy is left as it was where it has no version at that number, and the Hungarian one is remapped', () => {
    const s3 = createStore(exampleState(), { settle: RS.settle });
    s3.commit(d => { T.pickVersion(d.record, d.cur, 'summary', 'summary-v3'); }, 'EN v3');
    s3.commit(d => { RS.duplicate(d, EN, { lang: 'hu' }); }, 'HU');
    const huId = s3.state.openId;
    s3.commit(d => { RS.openSaved(d, EN); RS.duplicate(d, EN, { lang: 'de' }); }, 'DE');
    const de = s3.state.openId, st = clone(s3.state);
    RS.openSaved(st, huId);
    RS.matchVersion(st, 'summary-v2-hu', '3');
    return RS.groupOf(st, RS.savedOf(st, EN)).length === 3 && RS.savedOf(st, huId).picks.summary === 'summary-v2-hu' && RS.savedOf(st, de).picks.summary === 'summary-v3' && RS.savedOf(st, EN).picks.summary === 'summary-v3' && st.cur.picks.summary === 'summary-v2-hu';
  });
}

section('guessing which version a line matches');
{
  const state = () => createStore(exampleState(), { settle: RS.settle });
  // an old copy, as one made before copies were kept in step: it picked its own Hungarian version, then was put in step
  const oldCopy = () => {
    const store = state();
    store.commit(d => { T.pickVersion(d.record, d.cur, 'summary', 'summary-v3'); }, 'EN v3');
    store.commit(d => { RS.duplicate(d, EN, { lang: 'hu' }); }, 'HU');
    const hu = store.state.openId;
    store.commit(d => { delete RS.savedOf(d, hu).inStep; RS.openSaved(d, hu); T.pickVersion(d.record, d.cur, 'summary', 'summary-v2-hu'); }, 'its own pick');
    store.commit(d => { RS.setInStep(d, hu, true); }, 'keep in step');
    return { store, hu };
  };
  ok('the pair is found in the copy\'s memory: the original\'s pick at copy time and its own', () => {
    const { store, hu } = oldCopy(), g = L.guessMatch(store.state, saved(store, hu), 'summary');
    return eq(saved(store, hu).byLang.en.picks.summary, 'summary-v3') && eq(saved(store, hu).byLang.hu.picks.summary, 'summary-v2-hu') && g?.vid === 'summary-v2-hu' && g.n === '3' && g.why === 'pick' && g.sure === true;
  });
  ok('with no memory it falls back to the tags: English v3 and Hungarian v2 are both manufacturing', () => {
    const store = state();
    store.commit(d => { T.pickVersion(d.record, d.cur, 'summary', 'summary-v3'); }, 'EN v3');
    store.commit(d => { RS.duplicate(d, EN, { lang: 'hu' }); }, 'HU');
    const g = L.guessMatch(store.state, saved(store, store.state.openId), 'summary');
    return !saved(store, store.state.openId).byLang?.hu && g?.vid === 'summary-v2-hu' && g.n === '3' && g.why === 'tags' && g.sure === false;
  });
  ok('tags that fit more than one version are no clue', () => {
    const store = state();
    store.commit(d => { T.pickVersion(d.record, d.cur, 'summary', 'summary-v3'); R.addVersion(d.record, 'summary', { text: 'Más szöveg.', lang: 'hu', n: '4' }); d.record.variants.find(v => v.id === 'summary-v4-hu').tags = ['manufacturing']; }, 'EN v3, a second manufacturing text in Hungarian');
    store.commit(d => { RS.duplicate(d, EN, { lang: 'hu' }); }, 'HU');
    return L.guessMatch(store.state, saved(store, store.state.openId), 'summary') === null;
  });
  ok('then the same numbers in the text', () => {
    const store = state();
    store.commit(d => {
      const en = R.addVersion(d.record, 'hydra-dfm', { text: 'Cut tooling cost by 12% over 3 years.', lang: 'en', n: '5' });
      R.addVersion(d.record, 'hydra-dfm', { text: 'A szerszámköltség 12%-kal csökkent 3 év alatt.', lang: 'hu', n: '7' });
      R.addVersion(d.record, 'hydra-dfm', { text: 'Egészen más szöveg számok nélkül.', lang: 'hu', n: '8' });
      d.record.variants.find(v => v.id === 'hydra-dfm-v7-hu').tags = ['other'];
      T.pickVersion(d.record, d.cur, 'hydra-dfm', en.id);
    }, 'texts');
    store.commit(d => { RS.duplicate(d, EN, { lang: 'hu' }); }, 'HU');
    const g = L.guessMatch(store.state, saved(store, store.state.openId), 'hydra-dfm');
    return g?.vid === 'hydra-dfm-v7-hu' && g.n === '5' && g.why === 'numbers' && g.sure === false;
  });
  ok('with no clue it is null', () => {
    const store = state();
    store.commit(d => { T.pickVersion(d.record, d.cur, 'hydra-inhaler', 'hydra-inhaler-v3'); }, 'EN v3 (Medical devices)');
    store.commit(d => { RS.duplicate(d, EN, { lang: 'hu' }); }, 'HU');
    return L.guessMatch(store.state, saved(store, store.state.openId), 'hydra-inhaler') === null;
  });
  ok('a line that prints its own language has nothing to guess', () => {
    const { store } = oldCopy();
    return L.guessMatch(store.state, saved(store, EN), 'summary') === null;
  });
  ok('matchPlan lists this language\'s versions, the guess first and marked, each with the number it would get', () => {
    const { store, hu } = oldCopy();
    // after setInStep the copy printed English v3: the line is missing at 3 (its Hungarian v2 is the translation)
    const p = L.matchPlan(store.state, saved(store, hu), 'summary');
    return p?.n === '3' && p.from === 'en' && p.rows[0].v.id === 'summary-v2-hu' && p.rows[0].probably && p.rows[0].n === '3' && p.rows[0].free && p.rows.every(r => r.n === '3') && p.rows.length === 2;
  });
  ok('a number the language had is listed as not free', () => {
    const { store, hu } = oldCopy();
    store.commit(d => { R.deleteVersion(d.record, 'summary-v1-hu', []); }, 'delete');
    const st = clone(store.state);
    st.record.facts.find(f => f.id === 'summary').retired = { hu: ['3'] };
    return L.matchPlan(st, RS.savedOf(st, hu), 'summary').rows.every(r => !r.free);
  });
  ok('no plan when the line prints this language\'s own version', () => { const { store, hu } = oldCopy(); return L.matchPlan(store.state, saved(store, EN), 'summary') === null; });
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
