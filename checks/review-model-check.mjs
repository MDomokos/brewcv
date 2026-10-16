#!/usr/bin/env node
// node checks/review-model-check.mjs
// The Review list's model after the UX-6d review: a draft or an archived version is never a parent or a pick, a duplicate keeps the lines
// its original holds, a heading typed equal to the record's is not listed, highlights follow the trimmed text, what an update or
// 'Use for every resume' does to the other resumes is counted without the resumes that lock it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, loadResume } from '../src/model/schema.js';
import { setOverride, setSectionLabel, addLocalLine, textOf } from '../src/model/resume.js';
import { applyEdit, reviewList, printersOf, majorsOf, everywhereOf } from '../src/model/review.js';
import * as RS from '../src/model/resumes.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')), clone = x => structuredClone(x);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const throws = f => { try { f(); return false; } catch { return true; } };

const model = load(read('data/example.json')).model, names = read('data/example-resumes/index.json');
function state(){
  const resumes = [], frozen = {};
  for (const n of names){ const got = loadResume(read(`data/example-resumes/${n}`), model); resumes.push({ ...got.recipe, id: n }); frozen[n] = got.frozen; }
  const st = { record: clone(model), resumes, frozen, cur: null, openId: null };
  RS.openSaved(st, resumes[0].id);
  return st;
}
const fact = 'hydra-tolerance', vid = 'hydra-tolerance-v1';
const edit = (st, text, marks = []) => setOverride(st.record, st.cur, fact, text, { marks, base: null });

{ // 3: a draft or an archived version is no parent and no pick
  const st = state(), base = st.record.variants.find(v => v.id === vid);
  st.record.requireSource = false;
  const mk = (id, extra) => { st.record.variants.push({ ...clone(base), id, n: extra.n, ...extra }); st.record.facts.find(f => f.id === fact).variants.push(id); };
  mk('hydra-tolerance-v7', { n: '7', tags: ['archive'] }); mk('hydra-tolerance-draft-1', { n: '8' });
  const ids = majorsOf(st.record, fact, 'en').map(v => v.id);
  ok('majorsOf leaves out an archived and a draft version', !ids.includes('hydra-tolerance-v7') && !ids.includes('hydra-tolerance-draft-1') && ids.includes(vid), ids.join());
  edit(st, 'Something different about this tolerance');
  ok('a pick of an archived version is refused', throws(() => applyEdit(st.record, st.cur, fact, { do: 'minor', from: 'hydra-tolerance-v7' })));
  ok('a replace of a draft version is refused', throws(() => applyEdit(st.record, st.cur, fact, { do: 'over', vid: 'hydra-tolerance-draft-1' })));
}
{ // 7: printersOf does not count a resume that locks the line
  const st = state(), n0 = printersOf(st, vid).length;
  st.resumes.find(r => r.id !== st.openId && printersOf(st, vid).includes(r)).locked = [fact];
  ok('printersOf subtracts the resumes that lock the line', n0 > 0 && printersOf(st, vid).length === n0 - 1, `${n0} -> ${printersOf(st, vid).length}`);
}
{ // 4: what 'Use for every resume' does to the others
  const st = state(), mine = everywhereOf(st, '~h:experience');
  ok('everywhereOf counts the other resumes that print the new heading', mine.n > 0 && mine.locked === 0, JSON.stringify(mine));
  st.resumes[1].locked = ['~h:experience'];
  ok('…and the ones that lock it', everywhereOf(st, '~h:experience').locked === 1);
}
{ // 8: a duplicate behaves like its original for a held line
  const st = state();
  edit(st, textOf(st.record, fact, st.cur).replace(/\w+(\W*)$/, 'zzz$1'));
  applyEdit(st.record, st.cur, fact, { do: 'over', vid }); RS.settle(st);
  const other = printersOf(st, vid)[0].id;
  RS.openSaved(st, other);
  const held = RS.newerOf(st.record, st.cur).length;
  RS.duplicate(st, other);
  ok('a duplicate keeps the held line and its newer wording', held === 1 && RS.newerOf(st.record, st.cur).length === 1 && (st.cur.held ?? []).includes(fact), `held ${held}`);
  ok('…and the Review does not offer the old words as an edit', !reviewList(st.record, st.cur).edits.includes(fact));
}
{ // 11: a heading typed equal to the record's is not listed
  const st = state(), title = st.record.sections.find(s => s.id === 'experience').title;
  setSectionLabel(st.record, st.cur, 'experience', 'en', title);
  ok('a heading equal to the record title is not listed', !reviewList(st.record, st.cur).labels.some(l => l.key === '~h:experience'));
  setSectionLabel(st.record, st.cur, 'experience', 'en', 'Work zz');
  ok('…a different one is', reviewList(st.record, st.cur).labels.some(l => l.key === '~h:experience'));
}
{ // 12: highlights follow the trimmed text
  const st = state();
  st.record.requireSource = false;
  edit(st, '  Rebuilt the rig again', [{ start: 2, end: 9 }]);      // "Rebuilt" with the two spaces in front
  const out = applyEdit(st.record, st.cur, fact, { do: 'major', source: 'Lab notebook' });
  const v = st.record.variants.find(x => x.id === out.vid);
  ok('marks shift by the trimmed leading characters', v.text === 'Rebuilt the rig again' && JSON.stringify(v.marks.map(m => [m.start, m.end])) === '[[0,7]]', JSON.stringify(v.marks));
}
console.log(failed ? `\n${failed} review model check(s) FAILED` : '\nall review model checks passed');
process.exit(failed ? 1 : 0);
