#!/usr/bin/env node
// node checks/merge-check.mjs
// Merging an older copy of the career (src/model/diff.js): what you deleted or reworded since is not brought back ticked,
// two copies of one career end in the same record in any order, a merged version keeps its source, and no saved resume prints differently.
// Merging two copies that both have object clocks (src/model/merge.js): no questions in the usual cases, the same state whichever way round.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import * as S from '../src/model/schema.js';
import * as D from '../src/model/diff.js';
import * as R from '../src/model/record.js';
import * as K from '../src/model/career.js';
import * as RS from '../src/model/resumes.js';
import { fnv, createStore } from '../src/store/store.js';
import { createPersist, memoryBackend, makeBackup, readBackup, openVerdict } from '../src/store/persist.js';
import * as M from '../src/model/merge.js';
import { addJob, addBullet } from '../src/model/build.js';
import { validate } from './lib/validate.mjs';
import { createDocument } from '../scripts/lib/dom.mjs';
import { renderPages } from '../src/render.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const clone = x => structuredClone(x);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);

const base = S.load(read('data/example.json')).model;
S.ensureRecordId(base);
const names = read('data/example-resumes/index.json');
const resumes = names.map(n => ({ ...S.loadResume(read(`data/example-resumes/${n}`), base).recipe, id: n }));
// every saved resume as it prints: one hash each
const printed = (record, list = resumes) => list.map(r => crypto.createHash('sha256').update(renderPages(record, r, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('\n')).digest('hex'));
const printedBefore = printed(base);
const diff = (mine, theirs, a = resumes, b = clone(resumes)) => D.diffRecords(mine, theirs, { fromResumes: a, toResumes: b });
const ticked = items => items.filter(x => x.on);
const hydra = base.work.find(w => w.id === 'hydra').highlights;
const count = (m, fact) => R.versionsIn(m, fact).length;
const firstVersion = fact => base.facts.find(f => f.id === fact).variants[0];

section('the same file twice');
{
  ok('a copy of the same career gives no items', diff(base, clone(base)).length === 0);
  const theirs = clone(base);
  R.addVersion(theirs, hydra[0], { text: 'Led the redesign of the inhaler dose counter from sketch to production.', as: 'major' });
  const mine = clone(base);
  const first = diff(mine, theirs);
  ok('a new version is a ticked add', first.length === 1 && first[0].kind === 'add' && first[0].on, JSON.stringify(first.map(x => x.what)));
  const d = { record: mine, resumes: clone(resumes) };
  D.applyItems(d, first);
  ok('opening the same file again adds nothing', diff(d.record, theirs, d.resumes).length === 0);
}

section('problem 1: an older copy no longer brings back what was deleted or edited');
const now = clone(base);
const edited = firstVersion(hydra[0]);
R.saveOver(now, edited, 'Redesigned the inhaler dose counter, now in service.');
K.deleteClaim(now, hydra[2], []);
const items = diff(now, base);
{
  ok('nothing is ticked', ticked(items).length === 0, JSON.stringify(ticked(items).map(x => x.what)));
  const edit = items.find(x => x.kind === 'change' && /Another text of v1/.test(x.what));
  ok('the edited version is an unticked change, "another text of v1"', !!edit && edit.on === false);
  const gone = items.find(x => x.kind === 'keep' && /^You deleted this on \d{4}-\d{2}-\d{2} · /.test(x.what));
  ok('the deleted claim is an unticked item "You deleted this on <date>"', !!gone && gone.on === false && typeof gone.apply === 'function', JSON.stringify(items.map(x => `${x.kind}: ${x.what}`)));
  ok('no other item', items.length === 2, JSON.stringify(items.map(x => `${x.kind}: ${x.what}`)));
  const d = { record: clone(now), resumes: clone(resumes) };
  D.applyItems(d, items);
  ok('merging with nothing ticked changes nothing', eq(d.record, now));
  const back = { record: clone(now), resumes: clone(resumes) };
  D.applyItems(back, items.map(x => ({ ...x, on: true })));
  ok('ticking the deleted claim brings it back', back.record.facts.some(f => f.id === hydra[2]) && back.record.work.find(w => w.id === 'hydra').highlights.includes(hydra[2]));
  const texts = R.versionsIn(back.record, hydra[0]).map(v => v.text);
  ok('ticking the change adds a version and never writes over yours', texts.length === count(base, hydra[0]) + 1 && texts.includes('Redesigned the inhaler dose counter, now in service.') && texts.includes(base.variants.find(v => v.id === edited).text));
  const other = clone(base); delete other.recordId;
  ok('copies of different careers keep the old rule: a reworded version is a ticked add', diff(now, other).some(x => x.kind === 'add' && x.on && /New version/.test(x.what)));
}

section('a deleted version, saved resume and sent copy');
{
  const m = clone(base);
  const fact = base.facts.find(f => f.id === hydra[1]);
  const second = R.addVersion(m, fact.id, { text: 'Built the drop and cycle rig and wrote its protocols.', as: 'major' });
  const old = clone(m);
  R.deleteVersion(m, second.id, []);
  const it = diff(m, old);
  ok('a deleted version is listed, unticked, not added', ticked(it).length === 0 && it.some(x => x.kind === 'keep' && /You deleted this/.test(x.what) && /dose|rig|protocols|New version/.test(x.what)), JSON.stringify(it.map(x => `${x.kind}: ${x.what}`)));

  const mk = () => { const st = { record: clone(base), resumes: clone(resumes), frozen: {}, cur: null, openId: null }; RS.openSaved(st, names[0]); return st; };
  const a = mk();
  const gone = names[1];
  const oldResumes = clone(a.resumes);
  RS.deleteSaved(a, gone);
  const itR = diff(a.record, a.record, a.resumes, oldResumes);
  ok('a deleted saved resume is listed, unticked, not added', ticked(itR).length === 0 && itR.some(x => x.kind === 'keep' && /You deleted this on .* · Saved resume/.test(x.what)), JSON.stringify(itR.map(x => `${x.kind}: ${x.what}`)));

  const b = mk();
  RS.takeSnapshot(b, { company: 'Medtech Lisboa', role: 'Engineer', date: '2026-10-02' }, { at: '2026-10-02T09:00:00.000Z' });
  const withSnap = clone(b.resumes);
  RS.deleteSnapshot(b, 's1');
  const itS = diff(b.record, b.record, b.resumes, withSnap);
  ok('a deleted sent copy is listed, unticked, not added', ticked(itS).length === 0 && itS.some(x => x.kind === 'keep' && /You deleted this on .* · Snapshot of/.test(x.what)), JSON.stringify(itS.map(x => `${x.kind}: ${x.what}`)));

  const file = S.save(now);
  const back = S.load(JSON.parse(JSON.stringify(file))).model;
  ok('the tombstones survive a save and a load', eq(back.removed, now.removed) && Object.keys(now.removed).some(k => k.startsWith('fact:')) && Object.keys(now.removed).some(k => k.startsWith('variant:')));
  ok('and a record with them validates', validate(file).errors.length === 0, validate(file).errors[0]);
}

section('what was deleted stays out, whatever changed in the older copy since');
{
  // a claim that gained a version after the old copy, then was deleted
  const m = clone(base);
  const old = clone(base);
  R.addVersion(m, hydra[2], { text: 'Wrote the supplier audit checklist the team still uses.', as: 'major' });
  K.deleteClaim(m, hydra[2], []);
  const it = diff(m, old);
  ok('a claim that gained a version after the old copy is listed, unticked, not added', ticked(it).length === 0 && it.some(x => x.kind === 'keep' && /^You deleted this on .* · New claim/.test(x.what)), JSON.stringify(it.map(x => `${x.kind}${x.on ? '*' : ''}: ${x.what}`)));
  // a saved resume retitled and given another page limit after the old copy, then deleted
  const a = { record: clone(base), resumes: clone(resumes), frozen: {}, cur: null, openId: null };
  RS.openSaved(a, names[0]);
  const older = clone(a.resumes);
  const target = a.resumes.find(r => r.id === names[1]);
  target.title = 'Retitled after the old copy'; target.pageLimit = (target.pageLimit ?? 1) + 1;
  RS.deleteSaved(a, names[1]);
  const itR = diff(a.record, a.record, a.resumes, older);
  ok('a saved resume retitled and given another page limit, then deleted, is listed, unticked, not added', ticked(itR).length === 0 && itR.some(x => x.kind === 'keep' && /^You deleted this on .* · Saved resume/.test(x.what)), JSON.stringify(itR.map(x => `${x.kind}${x.on ? '*' : ''}: ${x.what}`)));
  // a version the old copy has in other words under an id I deleted
  const v = base.facts.find(f => f.id === hydra[0]).variants[1];
  const n = clone(base), o = clone(base);
  R.deleteVersion(n, v, []);
  R.saveOver(o, v, 'Led the dose counter redesign, reworded since.');
  ok('a version deleted here and reworded there is listed, unticked, not added', ticked(diff(n, o)).length === 0 && diff(n, o).some(x => x.kind === 'keep' && /You deleted this/.test(x.what)));
  ok('a version’s mark hashes its normalised text', n.removed[`variant:${v}`].hash === fnv(D.normText(base.variants.find(x => x.id === v).text)));
}

section('a file from outside never crashes the merge');
{
  const mine = clone(now);
  for (const x of Object.values(mine.removed)) delete x.at;
  let it;
  try { it = diff(mine, base); } catch (e){ it = e; }
  ok('a mark with no day still reads', Array.isArray(it) && it.some(x => x.kind === 'keep' && /^You deleted this on/.test(x.what)), String(it?.message ?? ''));
}

section('every delete leaves its mark');
{
  const m = clone(base);
  const proj = m.projects[0].id, skill = m.skills[0].id;
  K.deleteEntry(m, proj, []);
  K.deleteItem(m, 'skills', skill, []);
  const keys = Object.keys(m.removed ?? {});
  ok('an entry and its claims', keys.includes(`projects:${proj}`) && keys.some(k => k.startsWith('fact:')) && keys.some(k => k.startsWith('variant:')), keys.join(', '));
  ok('a skill group', keys.includes(`skills:${skill}`) && keys.includes(`fact:${skill}`));
  ok('each mark has a day and a hash', Object.values(m.removed).every(x => /^\d{4}-\d{2}-\d{2}$/.test(x.at) && /^[0-9a-f]{8}$/.test(x.hash)));
  ok('a record that deleted nothing has no removed key', !('removed' in base));
}

section('a merged version keeps its source');
{
  const theirs = clone(base);
  const v = R.addVersion(theirs, hydra[0], { text: 'Took the dose counter from first sketch through to the supplier’s tooling.', as: 'major', source: 'Annual review, 2024' });
  const mine = clone(base);
  mine.requireSource = true;
  const d = { record: mine, resumes: clone(resumes) };
  D.applyItems(d, diff(mine, theirs));
  const got = d.record.variants.find(x => x.text === v.text);
  ok('the new version has the source it was written with', got?.source === 'Annual review, 2024', JSON.stringify(got?.source));
  const a = clone(base), b = clone(base);
  b.variants.find(x => x.id === firstVersion(hydra[0])).source = 'Job description, 2019';
  const id = D.copyFact(a, b, hydra[0]);
  ok('a copied claim keeps the source of its versions', a.facts.find(f => f.id === id).variants.some(x => a.variants.find(y => y.id === x).source === 'Job description, 2019'));
}

section('normText');
{
  const same = (x, y, name) => ok(`normText: ${name}`, D.normText(x) === D.normText(y), `${JSON.stringify(D.normText(x))} vs ${JSON.stringify(D.normText(y))}`);
  same('Kept the curly’s tidy', "Kept the curly's tidy", 'curly’s and curly\'s alike');
  same('“Quoted” work', '"Quoted" work', 'curly double quotes');
  same('Cut scrap by 20 – 30%', 'Cut scrap by 20 - 30%', 'an en dash');
  same('Cut scrap — by half', 'Cut scrap - by half', 'an em dash');
  same('Led the ﬁnal ﬂow', 'Led the final flow', 'ligatures');
  same('Led the team', 'Led the team', 'a non-breaking space');
  same('Led the te­am', 'Led the team', 'a soft hyphen');
  same('A well- known supplier', 'A well-known supplier', 'a word split at a line end');
  same('Led the team , then left .', 'Led the team, then left', 'a space before punctuation and a final full stop');
  same('Cut 2 × 3 mm', 'Cut 2 x 3 mm', 'a times sign');
  same('Worked 2019- 2021', 'Worked 2019-2021', 'a number split at a line end, as the original\'s \\w joins it');
  same('  Led   the\nteam ', 'led the team', 'case and white space');
  ok('normText: different words are different', D.normText('Led the team') !== D.normText('Led the teams'));
  ok('normText: a Hungarian text keeps its letters', D.normText('Műszaki tervező.') === 'műszaki tervező');
}

section('five copies of one career, merged in any order');
{
  // one career saved five times, each save with one more edit; every edit lands somewhere of its own
  const s = clone(base);
  const files = [];
  const save = () => files.push(clone(s));
  R.addVersion(s, hydra[0], { text: 'Led the dose counter redesign, sketch to supplier tooling.', as: 'major' }); save();
  R.addVersion(s, hydra[1], { text: 'Built the drop and cycle rig and wrote its protocols.', as: 'major' }); save();
  const tagged = s.variants.find(v => v.id === firstVersion(hydra[3]));
  tagged.tags = [...(tagged.tags ?? []), 'safety']; save();
  R.saveOver(s, firstVersion(hydra[4]), 'Held every tolerance stack to the drawing.'); save();
  K.deleteClaim(s, hydra[5], []); save();
  // shortcut: these edits are to different claims, so any order agrees. Two copies that each add a version to the same claim number them in the
  // order they are merged; that case is settled by merging oldest first and by the object clocks (step I-1), not here.
  const merge = order => {
    const d = { record: clone(base), resumes: clone(resumes) };
    for (const i of order) D.applyItems(d, diff(d.record, files[i], d.resumes));
    return d;
  };
  const forward = merge([0, 1, 2, 3, 4]), backward = merge([4, 3, 2, 1, 0]), shuffled = merge([2, 0, 4, 1, 3]);
  const json = d => JSON.stringify(d.record);
  ok('forward, backward and shuffled end in byte-identical records', json(forward) === json(backward) && json(backward) === json(shuffled));
  ok('and the edits that add are in', count(forward.record, hydra[0]) === count(base, hydra[0]) + 1 && count(forward.record, hydra[1]) === count(base, hydra[1]) + 1 && forward.record.variants.find(v => v.id === firstVersion(hydra[3])).tags.includes('safety'));
  ok('the edit and the deletion were left to the person', R.versionsIn(forward.record, hydra[4])[0].text === base.variants.find(v => v.id === firstVersion(hydra[4])).text && forward.record.facts.some(f => f.id === hydra[5]));
  const again = merge([0, 1, 2, 3, 4]);
  for (const i of [0, 1, 2, 3, 4]) D.applyItems(again, diff(again.record, files[i], again.resumes));
  ok('merging all five a second time changes nothing', json(again) === json(forward));
  ok('every saved resume prints byte for byte the same after the merges', eq(printed(forward.record, forward.resumes), printedBefore));
  const v = validate(S.save(forward.record));
  ok('and the merged record validates', v.errors.length === 0, v.errors[0]);
}


// ---- I-1: object clocks and merge ----
let wall = Date.parse('2026-10-26T09:00:00.000Z');
const later = () => { wall += 60_000; };
const J = x => JSON.stringify(x);
const startState = () => { const st = { record: clone(base), resumes: clone(resumes), frozen: {}, cur: null, openId: null }; RS.openSaved(st, names[0]); RS.settle(st); return st; };
const bare = s => ({ record: s.record, resumes: s.resumes, frozen: s.frozen });
// a device: its own store and persist, a clock that may run behind; timers never fire by themselves
function device(offset = 0, backend = memoryBackend(), state = startState()){
  const store = createStore(state, { settle: RS.settle });
  let id = 0;
  const persist = createPersist({ store, backend, now: () => new Date(wall + offset), setTimer: () => ++id, clearTimer: () => {} });
  return { store, persist, backend, edit: fn => store.commit(d => { fn(d.record, d); }, 'edit'), state: () => bare(store.materialize()) };
}
const both = (x, y) => [M.merge(x, y), M.merge(y, x)];
const sameState = (m, n) => J(m.state) === J(n.state);
const topOf = c => Object.values(c).reduce((m, e) => (e[0] > m ? e[0] : m), '');
const takeInto = async (dev, m) => { dev.store.commit(d => M.keepOpen(d, e => Object.assign(e, structuredClone(m.state))), 'merge'); await dev.persist.adoptClock(m.clock); };
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)){ Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const v0 = firstVersion(hydra[0]), v1 = firstVersion(hydra[1]);
const textOf = (rec, vid) => rec.variants.find(v => v.id === vid)?.text;
const invalid = rec => validate(S.save(rec)).errors;

section('object clocks: keys and ticks');
{
  ok('the example starts every device at the same printed hashes', eq(printed(startState().record, startState().resumes), printedBefore));
  const st = { record: clone(base), resumes: clone(resumes), frozen: {} };
  const c0 = M.baseline(st);
  const want = ['basics.name', 'settings', `fact:${hydra[0]}`, `variant:${v0}`, 'work:hydra', 'education:porto-meng', 'skills:skills-cad', 'section:experience', `resume:${names[0]}`];
  ok('the keys are the spec’s: facts, versions, jobs and the other entries, sections, resumes, basics fields, settings', want.every(k => k in c0), want.filter(k => !(k in c0)).join(', '));
  ok('a state taken with no clock starts every key at the common start', Object.values(c0).every(e => e[0] === '' && e[1] === '' && /^[0-9a-f]{8}$/.test(e[2])));
  ok('ticking a state that did not change changes nothing', J(M.tick(c0, st, 'd1', wall)) === J(c0));
  const e1 = clone(st); R.saveOver(e1.record, v0, 'Redesigned the inhaler dose counter, now in service.');
  const c1 = M.tick(c0, e1, 'd1', wall);
  const moved = Object.keys(c1).filter(k => J(c1[k]) !== J(c0[k]));
  ok('only the edited key gets a stamp, and its prev is the stamp it had', J(moved) === J([`variant:${v0}`]) && c1[moved[0]][1] === '' && c1[moved[0]][0].endsWith('~d1'));
  const e2 = clone(e1); R.addVersion(e2.record, hydra[1], { text: 'Built the drop rig and wrote its protocols.', as: 'major' });
  const c2 = M.tick(c1, e2, 'd1', wall);
  const added = Object.keys(c2).filter(k => !(k in c1));
  ok('a new object has no prev, and a stamp after every one seen even when the wall clock has not moved', added.length === 1 && c2[added[0]][1] === null && c2[added[0]][0] > c1[`variant:${v0}`][0]);
  ok('adding a version does not stamp its claim (the list of versions is merged as a list)', J(c2[`fact:${hydra[1]}`]) === J(c1[`fact:${hydra[1]}`]));
  const e3 = clone(e2); K.deleteClaim(e3.record, hydra[2], []);
  const c3 = M.tick(c2, e3, 'd1', wall);
  ok('a deleted object stays a key, stamped like an edit, with the stamp it had as prev', c3[`fact:${hydra[2]}`]?.[1] === c2[`fact:${hydra[2]}`][0] && c3[`fact:${hydra[2]}`][2] !== c2[`fact:${hydra[2]}`][2]);
  const e1b = clone(e1); R.saveOver(e1b.record, v0, 'Redesigned the inhaler dose counter, in service since 2024.');
  const c1b = M.tick(c1, e1b, 'd1', wall);
  ok('an edit nobody has seen, edited again, is still one event: the stamp moves on, prev stays', c1b[`variant:${v0}`][0] > c1[`variant:${v0}`][0] && c1b[`variant:${v0}`][1] === '');
  const left = M.share(c1b);
  ok('a clock leaving takes the marks off, and every stamp in it is then known', Object.values(left).every(e => e.length === 3) && J(left[`variant:${v0}`]) === J(c1b[`variant:${v0}`].slice(0, 3)));
  const e1c = clone(e1b); R.saveOver(e1c.record, v0, 'Redesigned the inhaler dose counter, in service since 2025.');
  ok('an edit after that has the stamp the others know as its prev', M.tick(left, e1c, 'd1', wall)[`variant:${v0}`][1] === left[`variant:${v0}`][0]);
  const m1 = clone(e1); m1.record.variants.find(v => v.id === v0).metrics = { chars: 3, measured: { a4: { lines: 9 } } };
  ok('a version’s measured line counts are a cache and don’t count as an edit', J(M.tick(c1, m1, 'd1', wall)) === J(c1));
  const hour = M.tick(c1, e2, 'd2', wall - 3600_000);
  ok('a clock an hour behind still stamps after what it has seen', hour[added[0]][0] > c1[`variant:${v0}`][0] && hour[added[0]][0].endsWith('~d2'));
}

section('two copies that edited different things');
{
  const A = device(), B = device();
  A.edit(m => { m.basics.label = 'Mechanical Design Engineer'; R.addVersion(m, hydra[2], { text: 'Wrote the supplier audit checklist.', as: 'major' }); R.saveOver(m, v0, 'Led the dose counter redesign from sketch to tooling.'); });
  B.edit(m => { m.basics.url = 'https://dana.example/b'; R.addVersion(m, hydra[3], { text: 'Ran the dose accuracy tests.', as: 'major' }); addJob(m, { position: 'Intern', name: 'Rig Works', startDate: '2018-06', endDate: '2018-09', bullets: ['Built a test rig.'] }); });
  const sa = await A.persist.forMerge(); later(); const sb = await B.persist.forMerge();
  const [ab, ba] = both(sa, sb);
  ok('merging A into B and B into A gives byte-identical states', sameState(ab, ba));
  ok('and byte-identical clocks (apart from which edits a copy has not shared)', J(M.share(ab.clock)) === J(M.share(ba.clock)));
  const r = ab.state.record;
  ok('every edit is in', r.basics.label === 'Mechanical Design Engineer' && r.basics.url === 'https://dana.example/b' && count(r, hydra[2]) === count(base, hydra[2]) + 1 && count(r, hydra[3]) === count(base, hydra[3]) + 1
    && textOf(r, v0).startsWith('Led the dose counter redesign') && r.work.some(w => w.name === 'Rig Works') && r.sections.find(s => s.id === 'experience').content.work.length === base.work.length + 1);
  ok('no question was needed', ab.summary.length === 0 && ba.summary.length === 0);
  ok('the merged state validates', invalid(r).length === 0, invalid(r)[0]);
  const again = M.merge({ state: ab.state, clock: ab.clock }, sb), againA = M.merge(sa, { state: ab.state, clock: ab.clock });
  ok('merging again changes nothing', sameState(again, ab) && again.changed === 0 && againA.changed > 0 && sameState(againA, ab));
  ok('merging the same file twice lists nothing', again.summary.length === 0);
  await takeInto(A, ab); await takeInto(B, ba);
  ok('the two devices hold the same state', J(A.state()) === J(B.state()));
  const [x, y] = [await A.persist.forMerge(), await B.persist.forMerge()];
  ok('and meeting again changes nothing on either', M.merge(x, y).changed === 0 && M.merge(y, x).changed === 0);
  // history carries on through a merge: B edits what it took from A, and A takes it without a question
  B.edit(m => R.saveOver(m, v0, 'Led the dose counter redesign, sketch to supplier tooling.'));
  later(); const sb2 = await B.persist.forMerge();
  const next = M.merge(await A.persist.forMerge(), sb2);
  ok('an edit of what was merged is a later edit, not a second one', next.summary.length === 0 && textOf(next.state.record, v0).endsWith('supplier tooling.') && count(next.state.record, hydra[0]) === count(base, hydra[0]));
  const frozenIn = deepFreeze(clone(sa)), frozenB = deepFreeze(clone(sb));
  let threw = null; try { M.merge(frozenIn, frozenB); } catch (e){ threw = e; }
  ok('merge leaves what it is given alone', threw === null, String(threw?.message));
}

section('a version both copies reworded, or both added');
{
  const A = device(), B = device();
  A.edit(m => R.saveOver(m, v0, 'Led the redesign of the dose counter.'));
  B.edit(m => R.saveOver(m, v0, 'Owned the dose counter redesign end to end.'));
  const sa = await A.persist.forMerge(); later(); const sb = await B.persist.forMerge();
  const [ab, ba] = both(sa, sb);
  const ids = m => R.versionsIn(m.state.record, hydra[0]).map(v => v.id);
  ok('the same version edited on both sides gives two versions with the same ids on both devices', J(ids(ab)) === J(ids(ba)) && ids(ab).length === count(base, hydra[0]) + 1 && ids(ab).some(id => new RegExp(`^${v0}-alt-[0-9a-f]{6}$`).test(id)), ids(ab).join());
  ok('byte-identical states', sameState(ab, ba) && J(M.share(ab.clock)) === J(M.share(ba.clock)));
  const alt = ids(ab).find(id => id.startsWith(`${v0}-alt-`));
  ok('the newer keeps the id, the other text is the copy', textOf(ab.state.record, v0) === 'Owned the dose counter redesign end to end.' && textOf(ab.state.record, alt) === 'Led the redesign of the dose counter.');
  ok('version numbers stay unique in the claim', invalid(ab.state.record).length === 0, invalid(ab.state.record)[0]);
  ok('one line says so, with the two wordings', ab.summary.length === 1 && ab.summary[0].key === `variant:${alt}` && /Led the redesign/.test(ab.summary[0].other + ab.summary[0].kept) && typeof ab.summary[0].undo === 'function');
  const back = bare(clone(ab.state)); ab.summary[0].undo(back);
  ok('its Undo takes the copy away again', count(back.record, hydra[0]) === count(base, hydra[0]) && !back.record.variants.some(v => v.id === alt));
  const again = M.merge({ state: ab.state, clock: ab.clock }, sa);
  ok('merging the older copy again makes no second copy', sameState(again, ab) && again.changed === 0);
  // a version added to the same claim on both sides
  const C = device(), D = device();
  C.edit(m => R.addVersion(m, hydra[1], { text: 'Built the drop rig and wrote its protocols.', as: 'major' }));
  D.edit(m => R.addVersion(m, hydra[1], { text: 'Designed the cycle rig for the dose counter.', as: 'major' }));
  const sc = await C.persist.forMerge(); later(); const sd = await D.persist.forMerge();
  const [cd, dc] = both(sc, sd);
  const vs = R.versionsIn(cd.state.record, hydra[1]);
  ok('a version added to one claim on both sides keeps both, whichever way round', sameState(cd, dc) && vs.length === count(base, hydra[1]) + 2 && new Set(vs.map(v => v.id)).size === vs.length, vs.map(v => `${v.id}:${v.n}`).join());
  ok('with numbers of their own', new Set(vs.map(v => v.n)).size === vs.length && invalid(cd.state.record).length === 0, invalid(cd.state.record)[0]);
  ok('and the texts both survive', vs.some(v => v.text.startsWith('Built the drop rig')) && vs.some(v => v.text.startsWith('Designed the cycle rig')));
}

section('a plain value both copies changed');
{
  const A = device(), B = device();
  A.edit(m => { m.basics.label = 'Engineer A'; });
  B.edit(m => { m.basics.label = 'Engineer B'; });
  const sa = await A.persist.forMerge(); later(); const sb = await B.persist.forMerge();
  const [ab, ba] = both(sa, sb);
  ok('the newer wins on both devices', ab.state.record.basics.label === 'Engineer B' && sameState(ab, ba));
  ok('and the other is listed with its Undo', ab.summary.length === 1 && ab.summary[0].key === 'basics.label' && ab.summary[0].other === 'Engineer A' && ba.summary[0].other === 'Engineer A');
  const back = bare(clone(ab.state)); ab.summary[0].undo(back);
  ok('Undo puts it back', back.record.basics.label === 'Engineer A');
  // the stamp decides, not the direction: the other way round A is the newer
  const A2 = device(), B2 = device();
  A2.edit(m => { m.basics.label = 'Engineer A'; }); B2.edit(m => { m.basics.label = 'Engineer B'; });
  const sb2 = await B2.persist.forMerge(); later(); const sa2 = await A2.persist.forMerge();
  ok('whoever stamped last wins, whoever merges', M.merge(sa2, sb2).state.record.basics.label === 'Engineer A' && M.merge(sb2, sa2).state.record.basics.label === 'Engineer A');
  // the stamp is the time of the edit, not of the merge: the one who edited last wins even if the other is the one who merges last
  const E = device(), F = device();
  E.edit(m => { m.basics.label = 'Edited first'; }); later(); await E.persist.flush();
  later(); F.edit(m => { m.basics.label = 'Edited last'; }); later(); await F.persist.flush();
  later(); const sf = await F.persist.forMerge(); later(); const se = await E.persist.forMerge();
  ok('the later edit wins, whoever shares last', M.merge(se, sf).state.record.basics.label === 'Edited last' && M.merge(sf, se).state.record.basics.label === 'Edited last');
  // a bullet added to one job on both sides: the older whole is not the end of it
  const C = device(), D = device();
  C.edit(m => addBullet(m, 'hydra', 'Cut the dose counter part count by a third.'));
  D.edit(m => addBullet(m, 'hydra', 'Ran the supplier audits for the counter.'));
  const sc = await C.persist.forMerge(); later(); const sd = await D.persist.forMerge();
  const [cd, dc] = both(sc, sd);
  const job = cd.state.record.work.find(w => w.id === 'hydra');
  ok('a bullet added to one job on both sides: both are in the job, whichever way round', sameState(cd, dc) && job.highlights.length === hydra.length + 2 && job.highlights.every(h => cd.state.record.facts.some(f => f.id === h)), job.highlights.join());
}

section('a delete against an edit');
{
  const gone = base.facts.find(f => f.id === hydra[0]).variants[1];
  // a version deleted, then edited on the other side later: the edit wins
  const A = device(), B = device();
  A.edit(m => R.deleteVersion(m, gone, []));
  B.edit(m => R.saveOver(m, gone, 'Led the dose counter redesign, reworded after the other copy deleted it.'));
  const sa = await A.persist.forMerge(); later(); const sb = await B.persist.forMerge();
  const [ab, ba] = both(sa, sb);
  ok('a delete against a later edit: the edit wins, on both devices', textOf(ab.state.record, gone)?.startsWith('Led the dose counter redesign, reworded') && sameState(ab, ba) && !ab.state.record.removed?.[`variant:${gone}`] && R.versionsIn(ab.state.record, hydra[0]).some(v => v.id === gone));
  ok('and the line says it is back', ab.summary.length === 1 && /deleted in one copy and edited later/.test(ab.summary[0].what));
  const undo = bare(clone(ab.state)); ab.summary[0].undo(undo);
  ok('Undo deletes it again, with its mark', !undo.record.variants.some(v => v.id === gone) && !!undo.record.removed[`variant:${gone}`]);
  // the other way: edited, then deleted later on the other side: the delete wins
  const C = device(), D = device();
  C.edit(m => R.saveOver(m, gone, 'Led the dose counter redesign, reworded before the other copy deleted it.'));
  D.edit(m => R.deleteVersion(m, gone, []));
  const sc = await C.persist.forMerge(); later(); const sd = await D.persist.forMerge();
  const [cd, dc] = both(sc, sd);
  ok('an edit against a later delete: the delete wins, on both devices', !cd.state.record.variants.some(v => v.id === gone) && !!cd.state.record.removed[`variant:${gone}`] && sameState(cd, dc) && !R.versionsIn(cd.state.record, hydra[0]).some(v => v.id === gone));
  const un = bare(clone(cd.state)); cd.summary[0].undo(un);
  ok('Undo brings the edit back and drops the mark', textOf(un.record, gone)?.includes('before the other copy deleted it') && !un.record.removed?.[`variant:${gone}`]);
  // a saved resume
  const E = device(), F = device();
  E.store.commit(d => RS.deleteSaved(d, names[1]), 'delete');
  F.store.commit(d => { d.resumes.find(r => r.id === names[1]).pageLimit = 3; }, 'edit');
  const se = await E.persist.forMerge(); later(); const sf = await F.persist.forMerge();
  const [ef, fe] = both(se, sf);
  ok('a saved resume deleted here and edited there later is back, edited', ef.state.resumes.find(r => r.id === names[1])?.pageLimit === 3 && sameState(ef, fe) && !ef.state.record.removed?.[`resume:${names[1]}`]);
  // an old copy does not bring back what a merge deleted
  const G = device(), H = device(), I = device();
  G.edit(m => R.deleteVersion(m, gone, []));
  const sg = await G.persist.forMerge();
  const si = await I.persist.forMerge();
  const gi = M.merge(si, sg);
  ok('the tombstone travels: a copy that never edited it takes the delete', !gi.state.record.variants.some(v => v.id === gone) && !!gi.state.record.removed[`variant:${gone}`] && gi.summary.length === 0);
  const old = M.merge({ state: gi.state, clock: gi.clock }, await H.persist.forMerge());
  ok('and an old copy that still has it does not bring it back', !old.state.record.variants.some(v => v.id === gone) && old.changed === 0 && old.summary.length === 0);
}

section('a clock that runs an hour behind');
{
  const A = device(), B = device(-3600_000);
  A.edit(m => { m.basics.label = 'Engineer A'; });
  B.edit(m => { m.basics.label = 'Engineer B'; m.basics.url = 'https://dana.example/hour'; });
  const sa = await A.persist.forMerge(); later(); const sb = await B.persist.forMerge();
  ok('its stamps are earlier, and the stamp decides', topOf(sb.clock) < topOf(sa.clock));
  const [ab, ba] = both(sa, sb);
  ok('both devices still end in the same state', sameState(ab, ba) && J(M.share(ab.clock)) === J(M.share(ba.clock)) && ab.state.record.basics.label === 'Engineer A' && ab.state.record.basics.url === 'https://dana.example/hour');
  await takeInto(B, ba);
  B.edit(m => { m.basics.name = 'Dana Okonkwo-Reyes'; });
  const sb2 = await B.persist.forMerge();
  ok('after merging, its next stamp is after everything it has seen', topOf(sb2.clock) > topOf(sa.clock));
}

section('the clock on a device: edits between two saves, files, a reload');
{
  const backend = memoryBackend();
  const A = device(0, backend), B = device();
  for (const text of ['Led the redesign of the counter.', 'Led the dose counter redesign.', 'Led the dose counter redesign, sketch to tooling.']){
    A.edit(m => R.saveOver(m, v0, text)); later(); await A.persist.flush();
  }
  const sa = await A.persist.forMerge();
  ok('three saves are one event: the stamp of the last, the prev the others know', sa.clock[`variant:${v0}`][1] === '' && sa.clock[`variant:${v0}`][3] === 1);
  const m1 = M.merge(await B.persist.forMerge(), sa);
  ok('a version edited three times on one side and not at all on the other is taken, with no second copy', m1.summary.length === 0 && textOf(m1.state.record, v0) === 'Led the dose counter redesign, sketch to tooling.' && count(m1.state.record, hydra[0]) === count(base, hydra[0]));
  ok('the device id is made once and kept', sa.clock[`variant:${v0}`][0].endsWith(`~${await backend.get('meta/device')}`) && (await backend.get('meta/device')).length === 6);
  const again = device(0, backend, startState());
  ok('a reload keeps the clock', await again.persist.restore() && J((await again.persist.forMerge()).clock) === J(sa.clock) && again.persist.fileState.hasClock);
  // a file: the clock goes into it, and a device that opens it carries on from it
  later(); const f = await A.persist.prepareFile();
  const file = JSON.parse(f.text), got = readBackup(file);
  ok('the file carries the clock and the device', J(file.clock) === J((await A.persist.forMerge()).clock) && file.device === (await backend.get('meta/device')) && J(got.info.clock) === J(file.clock) && got.info.device === file.device);
  const old = readBackup(JSON.parse(JSON.stringify(makeBackup(startState()))));
  ok('a file with no clock is read as before', old.info.clock === null && old.info.device === null && old.warnings.length === 0);
  // a device merging the file gets what it would get from the device itself
  later(); B.edit(m => { m.basics.name = 'Dana Okonkwo-Reyes'; });
  const sbNow = await B.persist.forMerge(), saNow = await A.persist.forMerge();
  const viaFile = M.merge(sbNow, { state: bare(got.state), clock: got.info.clock }), viaDevice = M.merge(sbNow, saNow);
  ok('merging a file gives what merging the device gives', J(viaFile.state.record) === J(viaDevice.state.record) && J(viaFile.clock) === J(viaDevice.clock) && viaFile.summary.length === 0 && viaFile.changed > 0);
  const C = device();
  C.store.replace(got.state, 'open'); await C.persist.markFileOpened({ at: got.info.saved, recordId: got.info.recordId, hash: f.hash, clock: got.info.clock });
  ok('a copy that opened the file starts from its clock', J((await C.persist.forMerge()).clock) === J(file.clock));
  C.edit(m => { m.basics.url = 'https://dana.example/c'; }); later();
  const back = M.merge(await A.persist.forMerge(), await C.persist.forMerge());
  ok('and what it edits next goes back to the first as a later edit', back.summary.length === 0 && back.state.record.basics.url === 'https://dana.example/c' && textOf(back.state.record, v0).endsWith('sketch to tooling.'));
  // the open resume: a merge that changes it must not be written over by the next change
  const D = device(), E = device();
  E.store.commit(d => { d.cur.pageLimit = 4; }, 'edit');
  later(); const se = await E.persist.forMerge();
  await takeInto(D, M.merge(await D.persist.forMerge(), se));
  D.edit(m => { m.basics.name = 'Dana Okonkwo-Reyes'; });
  ok('a merge that changes the open resume is not written over by the next change', D.store.state.resumes.find(r => r.id === names[0]).pageLimit === 4 && D.store.state.cur.pageLimit === 4);
}

section('three copies end in one state');
{
  const [A, B, C] = [device(), device(), device()];
  A.edit(m => { m.basics.label = 'Engineer A'; R.saveOver(m, v0, 'Led the redesign of the dose counter.'); });
  B.edit(m => { m.basics.url = 'https://dana.example/three'; K.deleteClaim(m, hydra[5], []); });
  C.edit(m => { R.addVersion(m, hydra[1], { text: 'Ran the drop and cycle tests.', as: 'major' }); R.saveOver(m, v0, 'Owned the dose counter redesign.'); });
  const s = [await A.persist.forMerge(), (later(), await B.persist.forMerge()), (later(), await C.persist.forMerge())];
  const fold = order => order.map(i => s[i]).reduce((acc, x) => { const m = M.merge(acc, x); return { state: m.state, clock: m.clock }; });
  const [r1, r2, r3] = [fold([0, 1, 2]), fold([2, 1, 0]), fold([1, 2, 0])];
  ok('merged in three different orders, the same state', J(r1.state) === J(r2.state) && J(r2.state) === J(r3.state), '');
  ok('and the same clock', J(M.share(r1.clock)) === J(M.share(r2.clock)) && J(M.share(r2.clock)) === J(M.share(r3.clock)));
  ok('nothing was lost', r1.state.record.basics.label === 'Engineer A' && r1.state.record.basics.url === 'https://dana.example/three' && !r1.state.record.facts.some(f => f.id === hydra[5]) && invalid(r1.state.record).length === 0, invalid(r1.state.record)[0]);
}

section('files with and without clocks');
{
  const rid = base.recordId;
  const clk = { 'basics.name': ['', '', 'abcd1234'] };
  const verdict = (extra = {}) => openVerdict({ file: { recordId: rid, saved: '2026-10-20T10:00:00.000Z', clock: clk, ...extra.file }, last: null, localRecordId: rid, changes: 0, localClock: true, ...extra.rest });
  ok('both with clocks and one record: merge', verdict().kind === 'merge');
  ok('a file with no clock: as before', verdict({ file: { clock: null } }).kind === 'ok' && verdict({ file: { clock: null }, rest: { changes: 2 } }).kind === 'changes');
  ok('a browser with no clock: as before', verdict({ rest: { localClock: false } }).kind === 'ok');
  ok('another record: different, clocks or not', verdict({ file: { recordId: 'other' } }).kind === 'different');
  ok('the file this browser saved last, nothing changed since: up to date', verdict({ file: { hash: 'h' }, rest: { last: { recordId: rid, at: '2026-10-20T10:00:00.000Z', hash: 'h' } } }).kind === 'same');
  ok('with changes since and clocks: still a merge', verdict({ rest: { changes: 3 } }).kind === 'merge');
  // an old backup with no clock still goes through diffRecords
  const oldFile = JSON.parse(JSON.stringify(makeBackup(startState())));
  const got = readBackup(oldFile);
  const items = D.diffRecords(now, got.state.record, { fromResumes: startState().resumes, toResumes: got.state.resumes });
  ok('an old backup with no clock still goes through diffRecords, deletions listed', got.info.clock === null && items.some(x => x.kind === 'keep' && /You deleted this/.test(x.what)) && ticked(items).length === 0, JSON.stringify(items.map(x => `${x.kind}: ${x.what}`)));
}

section('what a merge leaves alone');
{
  const A = device(), B = device();
  A.edit(m => { R.addVersion(m, hydra[2], { text: 'Wrote the supplier audit checklist.', as: 'major' }); const t = m.variants.find(v => v.id === firstVersion(hydra[3])); t.tags = [...(t.tags ?? []), 'safety']; });
  B.edit(m => addJob(m, { position: 'Intern', name: 'Rig Works', startDate: '2018-06', endDate: '2018-09', bullets: ['Built a test rig.'] }));
  const sa = await A.persist.forMerge(); later(); const sb = await B.persist.forMerge();
  const [ab, ba] = both(sa, sb);
  ok('every saved resume prints byte for byte the same after a merge that changed nothing they print', eq(printed(ab.state.record, ab.state.resumes), printedBefore) && eq(printed(ba.state.record, ba.state.resumes), printedBefore));
  ok('and in the same order', eq(ab.state.resumes.map(r => r.id), names));
  const withMetrics = device(); withMetrics.edit(m => { m.variants[0].metrics = { chars: 1, measured: { a4: { lines: 7 } } }; });
  const other = device(); other.edit(m => { m.variants[0].metrics = { chars: 1, measured: { a4: { lines: 8 } } }; });
  const mm = M.merge(await withMetrics.persist.forMerge(), await other.persist.forMerge());
  ok('versions measured differently on two devices are not a conflict', mm.summary.length === 0 && mm.changed === 0);
}

console.log(failed ? `\n${failed} merge check(s) FAILED` : '\nall merge checks passed');
process.exit(failed ? 1 : 0);
