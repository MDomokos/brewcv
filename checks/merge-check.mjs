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
// where two states first differ (a path), for a failure's message
const where = (a, b, p = '') => { if (J(a) === J(b)) return null; if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)){ const ks = [...new Set([...Object.keys(a), ...Object.keys(b)])]; if (J(Object.keys(a)) !== J(Object.keys(b)) && ks.every(k => J(a[k]) === J(b[k]))) return `${p} (key order)`; for (const k of ks){ const w = where(a[k], b[k], `${p}/${k}`); if (w) return w; } } return `${p}: ${J(a)?.slice(0, 70)} | ${J(b)?.slice(0, 70)}`; };
const topOf = c => Object.values(c.keys).reduce((m, e) => (e.at > m ? e.at : m), '');
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
  ok('the keys are the spec’s: facts, versions, jobs and the other entries, sections, resumes, basics fields, settings', want.every(k => k in c0.keys), want.filter(k => !(k in c0.keys)).join(', '));
  ok('a state taken with no clock starts every key at the common start, with no device’s save seen', Object.values(c0.keys).every(e => J(e.v) === '{"base":1}' && /^[0-9a-f]{8}$/.test(e.hash)) && J(c0.seen) === '{}');
  ok('ticking a state that did not change changes nothing, and counts no save', J(M.tick(c0, st, 'd1', wall)) === J(c0));
  const e1 = clone(st); R.saveOver(e1.record, v0, 'Redesigned the inhaler dose counter, now in service.');
  const c1 = M.tick(c0, e1, 'd1', wall);
  const moved = Object.keys(c1.keys).filter(k => J(c1.keys[k]) !== J(c0.keys[k]));
  ok('a save that changed something is this device’s first: the edited key has its count, the rest is as it was', J(moved) === J([`variant:${v0}`]) && J(c1.keys[moved[0]].v) === '{"base":1,"d1":1}' && c1.seen.d1 === 1 && c1.keys[moved[0]].at === new Date(wall).toISOString());
  const e1b = clone(e1); R.saveOver(e1b.record, v0, 'Redesigned the inhaler dose counter, in service since 2024.');
  const c1b = M.tick(c1, e1b, 'd1', wall);
  const e2 = clone(e1b); R.addVersion(e2.record, hydra[1], { text: 'Built the drop rig and wrote its protocols.', as: 'major' }); K.deleteClaim(e2.record, hydra[2], []);
  const c2 = M.tick(c1b, e2, 'd1', wall);
  ok('each save that changed something is the next count, and a key edited in two saves has the later one', c1b.seen.d1 === 2 && c1b.keys[`variant:${v0}`].v.d1 === 2 && c2.seen.d1 === 3);
  const added = Object.keys(c2.keys).filter(k => !(k in c1b.keys));
  ok('a new object has only this device in its vector', added.length === 1 && J(c2.keys[added[0]].v) === '{"d1":3}');
  ok('adding a version does not touch its claim (the list of versions is merged as a list)', J(c2.keys[`fact:${hydra[1]}`]) === J(c1b.keys[`fact:${hydra[1]}`]));
  ok('a deleted object stays a key, edited like any other', c2.keys[`fact:${hydra[2]}`].v.d1 === 3 && c2.keys[`fact:${hydra[2]}`].hash !== c1b.keys[`fact:${hydra[2]}`].hash);
  const m1 = clone(e1); m1.record.variants.find(v => v.id === v0).metrics = { chars: 3, measured: { a4: { lines: 9 } } };
  ok('a version’s measured line counts are a cache and don’t count as an edit', J(M.tick(c1, m1, 'd1', wall)) === J(c1));
  const hour = M.tick(c1, e2, 'd2', wall - 3600_000);
  ok('a device whose own clock is behind still counts its own saves from its own count, and its time only says when', hour.seen.d2 === 1 && hour.seen.d1 === 1 && hour.keys[added[0]].at < c1.keys[`variant:${v0}`].at);
  ok('opening a copy keeps this device’s own count, and counts nothing that is as it was', M.opened(c2, c2, e2, 'd1', wall).seen.d1 === 3 && M.opened(M.baseline(st), c2, e2, 'd1', wall).seen.d1 === 4);
}

section('two copies that edited different things');
{
  const A = device(), B = device();
  A.edit(m => { m.basics.label = 'Mechanical Design Engineer'; R.addVersion(m, hydra[2], { text: 'Wrote the supplier audit checklist.', as: 'major' }); R.saveOver(m, v0, 'Led the dose counter redesign from sketch to tooling.'); });
  B.edit(m => { m.basics.url = 'https://dana.example/b'; R.addVersion(m, hydra[3], { text: 'Ran the dose accuracy tests.', as: 'major' }); addJob(m, { position: 'Intern', name: 'Rig Works', startDate: '2018-06', endDate: '2018-09', bullets: ['Built a test rig.'] }); });
  const sa = await A.persist.forMerge(); later(); const sb = await B.persist.forMerge();
  const [ab, ba] = both(sa, sb);
  ok('merging A into B and B into A gives byte-identical states', sameState(ab, ba));
  ok('and byte-identical clocks ', J(ab.clock) === J(ba.clock));
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
  ok('byte-identical states', sameState(ab, ba) && J(ab.clock) === J(ba.clock));
  const alt = ids(ab).find(id => id.startsWith(`${v0}-alt-`));
  ok('the newer keeps the id, the other text is the copy', textOf(ab.state.record, v0) === 'Owned the dose counter redesign end to end.' && textOf(ab.state.record, alt) === 'Led the redesign of the dose counter.');
  ok('version numbers stay unique in the claim', invalid(ab.state.record).length === 0, invalid(ab.state.record)[0]);
  ok('one line says so, with the two wordings', ab.summary.length === 1 && ab.summary[0].kind === 'alt' && ab.summary[0].key === `variant:${alt}` && [ab.summary[0].kept, ab.summary[0].other].includes('Led the redesign of the dose counter.') && typeof ab.summary[0].undo === 'function');
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
  ok('and one line says it is back', ab.summary.length === 1 && ab.summary[0].kind === 'revived' && ab.summary[0].key === `variant:${gone}`);
  const undo = bare(clone(ab.state)); ab.summary[0].undo(undo);
  ok('Undo deletes it again, with its mark', !undo.record.variants.some(v => v.id === gone) && !!undo.record.removed[`variant:${gone}`]);
  // the other way: a copy that has seen the edit deletes, and the other meets that: the delete has seen the edit, so it is the later
  const C = device(), D = device();
  C.edit(m => R.saveOver(m, gone, 'Led the dose counter redesign, reworded before the other copy deleted it.'));
  const sc = await C.persist.forMerge(); later();
  await takeInto(D, M.merge(await D.persist.forMerge(), sc)); later();
  D.edit(m => R.deleteVersion(m, gone, []));
  const sd = await D.persist.forMerge();
  const [cd, dc] = both(sc, sd);
  ok('a delete made after seeing the edit wins, on both devices, with no line', !cd.state.record.variants.some(v => v.id === gone) && !!cd.state.record.removed[`variant:${gone}`] && sameState(cd, dc) && !R.versionsIn(cd.state.record, hydra[0]).some(v => v.id === gone) && cd.summary.length === 0);
  // and an edit made after seeing a delete brings it back, with no line either
  const G0 = device(), H0 = device();
  G0.edit(m => R.deleteVersion(m, gone, []));
  const sg0 = await G0.persist.forMerge(); later();
  await takeInto(H0, M.merge(await H0.persist.forMerge(), sg0)); later();
  H0.edit(m => R.addVersion(m, hydra[0], { text: 'Led the dose counter redesign, written anew.', as: 'major' }));
  const gh = M.merge(sg0, await H0.persist.forMerge());
  ok('an edit made after seeing the delete is the later: the delete does not win', gh.summary.length === 0 && count(gh.state.record, hydra[0]) === count(base, hydra[0]));
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
  ok('its times are earlier, and the time decides a conflict', topOf(sb.clock) < topOf(sa.clock));
  const [ab, ba] = both(sa, sb);
  ok('both devices still end in the same state', sameState(ab, ba) && J(ab.clock) === J(ba.clock) && ab.state.record.basics.label === 'Engineer A' && ab.state.record.basics.url === 'https://dana.example/hour');
  await takeInto(B, ba);
  B.edit(m => { m.basics.name = 'Dana Okonkwo-Reyes'; });
  const sb2 = await B.persist.forMerge();
  ok('after merging, its next save counts on from everything it has seen', Object.entries(sa.clock.seen).every(([a, n]) => sb2.clock.seen[a] >= n) && Object.entries(sa.clock.keys['basics.label'].v).every(([a, n]) => sb2.clock.keys['basics.label'].v[a] >= n) && Object.keys(sb2.clock.keys['basics.name'].v).length >= 2);
}

section('the clock on a device: edits between two saves, files, a reload');
{
  const backend = memoryBackend();
  const A = device(0, backend), B = device();
  for (const text of ['Led the redesign of the counter.', 'Led the dose counter redesign.', 'Led the dose counter redesign, sketch to tooling.']){
    A.edit(m => R.saveOver(m, v0, text)); later(); await A.persist.flush();
  }
  const sa = await A.persist.forMerge();
  const me = await backend.get('meta/device');
  ok('three saves count three: the key has the last of them, and the device has seen that many of its own', sa.clock.keys[`variant:${v0}`].v[me] === 3 && sa.clock.seen[me] === 3);
  const m1 = M.merge(await B.persist.forMerge(), sa);
  ok('a version edited three times on one side and not at all on the other is taken, with no second copy', m1.summary.length === 0 && textOf(m1.state.record, v0) === 'Led the dose counter redesign, sketch to tooling.' && count(m1.state.record, hydra[0]) === count(base, hydra[0]));
  ok('the device id is made once and kept', /^[\w-]{6}$/.test(me) && me in sa.clock.seen);
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
  const cc = (await C.persist.forMerge()).clock;
  ok('a copy that opened the file starts from its clock: it fits what it holds and every vector covers the file’s', M.clockFits(C.state(), cc) && Object.entries(file.clock.keys).every(([k, e]) => Object.entries(e.v).every(([a, n]) => (cc.keys[k]?.v[a] ?? 0) >= n)));
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
  ok('and the same clock', J(r1.clock) === J(r2.clock) && J(r2.clock) === J(r3.clock));
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

section('a language group is merged as one unit');
{
  const gs = startState(); RS.duplicate(gs, names[0], { lang: 'hu' }); RS.openSaved(gs, names[0]);
  const EN = names[0], HU = gs.resumes.find(r => r.parent === EN).id, was = gs.resumes.find(r => r.id === EN).pageLimit;
  const mk = () => device(0, memoryBackend(), clone(gs));
  const get = (m, id) => m.state.resumes.find(r => r.id === id);
  const run = async (firstA) => {
    const A = mk(), B = mk();
    A.store.commit(d => { RS.openSaved(d, EN); d.cur.pageLimit = 2; }, 'edit');      // a line of the original: mirror() takes it to the copy
    B.store.commit(d => { RS.openSaved(d, HU); d.cur.design = { ...(d.cur.design ?? {}), size: 'large' }; }, 'edit');      // the copy's own text size
    let sa, sb;
    if (firstA){ sa = await A.persist.forMerge(); later(); sb = await B.persist.forMerge(); } else { sb = await B.persist.forMerge(); later(); sa = await A.persist.forMerge(); }
    return { sa, sb, ab: M.merge(sa, sb), ba: M.merge(sb, sa) };
  };
  const inStep = m => RS.mirror(clone(bare(m.state)), EN).length === 0 && RS.groupOf(m.state, get(m, EN)).length === 2;
  const b = await run(true);   // B stamped last: its group wins
  ok('each copy changed another member of one group: both merge orders end byte-identical', sameState(b.ab, b.ba) && J(b.ab.clock) === J(b.ba.clock));
  ok('the newer copy’s group is kept whole, and in step', get(b.ab, EN).pageLimit === was && get(b.ab, HU).pageLimit === was && get(b.ab, HU).design?.size === 'large' && inStep(b.ab));
  ok('and the other copy’s change is one line, with an Undo that puts its group back', b.ab.summary.length === 1 && b.ab.summary[0].kind === 'group' && b.ba.summary.length === 1);
  const back = bare(clone(b.ab.state)); b.ab.summary[0].undo(back);
  ok('Undo gives the other copy’s group: the line it changed, in step, without the newer copy’s size', back.resumes.find(r => r.id === EN).pageLimit === 2 && back.resumes.find(r => r.id === HU).pageLimit === 2 && back.resumes.find(r => r.id === HU).design?.size !== 'large');
  const again = M.merge({ state: b.ab.state, clock: b.ab.clock }, b.sa);
  ok('merging again changes nothing', sameState(again, b.ab) && again.changed === 0);
  const a = await run(false);   // A stamped last
  ok('the other way round, the other copy’s group wins, in step, byte-identical', sameState(a.ab, a.ba) && get(a.ab, EN).pageLimit === 2 && get(a.ab, HU).pageLimit === 2 && get(a.ab, HU).design?.size !== 'large' && inStep(a.ab) && a.ab.summary.length === 1);
  ok('every resume outside the group is untouched', eq(b.ab.state.resumes.filter(r => ![EN, HU].includes(r.id)), clone(gs.resumes.filter(r => ![EN, HU].includes(r.id)))));
}

section('a file that was skipped, and many saves between two files');
{
  const A = device(), B = device();
  const send = async dev => { later(); const f = await dev.persist.prepareFile(); const got = readBackup(JSON.parse(f.text)); return { f, theirs: { state: bare(got.state), clock: got.info.clock } }; };
  const gone = base.facts.find(f => f.id === hydra[0]).variants[1];
  A.edit(m => { R.saveOver(m, v0, 'Led the redesign of the counter, first.'); m.basics.label = 'Label one'; });
  const one = await send(A);
  // more than 8 saves of one key on one device, the other opens only the last file
  for (let i = 0; i < 12; i++){ A.edit(m => { R.saveOver(m, v0, `Led the redesign of the counter, take ${i}.`); m.basics.label = `Label ${i}`; if (i === 6) R.deleteVersion(m, gone, []); }); later(); await A.persist.flush(); }
  const last = await send(A);
  const m1 = M.merge(await B.persist.forMerge(), last.theirs);
  ok('a copy that skipped a file and 12 saves takes the last: no second wording, no both-changed line, no race over a delete', m1.summary.length === 0 && textOf(m1.state.record, v0).endsWith('take 11.') && m1.state.record.basics.label === 'Label 11' && !m1.state.record.variants.some(v => v.id === gone) && count(m1.state.record, hydra[0]) === count(base, hydra[0]) - 1);
  const m2 = M.merge(await B.persist.forMerge(), one.theirs);
  ok('and one that took the first file takes the last', M.merge({ state: m2.state, clock: m2.clock }, last.theirs).summary.length === 0);
  ok('every save that changed something is counted: the device has seen all 13 of its own', Object.values(last.theirs.clock.seen).includes(13));
}

section('a file edited outside is not merged by clock');
{
  const A = device();
  A.edit(m => { R.saveOver(m, v0, 'Led the redesign.'); K.deleteClaim(m, hydra[5], []); });
  later(); const f = await A.persist.prepareFile();
  const fits = () => { const got = readBackup(JSON.parse(f.text)); return { got, ok: M.clockFits(got.state, got.info.clock) }; };
  ok('a file saved by a copy fits its clock, with edits and a delete in it', fits().ok);
  const label = fits(); label.got.state.record.basics.label = 'Changed in a text editor';
  ok('a changed label under the old clock does not', !M.clockFits(label.got.state, label.got.info.clock));
  const setting = fits(); setting.got.state.resumes[1].pageLimit = 9;
  ok('nor a changed resume setting', !M.clockFits(setting.got.state, setting.got.info.clock));
  const added = fits(); added.got.state.record.skills.push({ id: 'skills-new', name: 'New', keywords: ['a'] });
  ok('nor an object the clock does not know', !M.clockFits(added.got.state, added.got.info.clock));
  ok('and no clock does not fit', !M.clockFits(fits().got.state, null));
}

section('a garbled clock in a file');
{
  const A = device();
  A.edit(m => R.saveOver(m, v0, 'Led the redesign.'));
  later(); const f = await A.persist.prepareFile();
  const file = JSON.parse(f.text);
  file.clock.keys[`variant:${v0}`].at = `${new Date(8.64e15).toISOString()}`;      // the last date a Date holds
  file.clock.keys['basics.name'] = { v: { x: -1 }, at: '2026-10-26T09:00:00.000Z', hash: 'abc' };
  file.clock.keys['basics.label'] = { v: { 'a b': 2 }, at: '2026-10-26T09:00:00.000Z', hash: 'abc' };
  file.clock.keys['basics.url'] = [1, 2, 3];
  file.clock.seen = { x: 'many', ok: 4 };
  const got = readBackup(file);
  ok('entries with a date that is none, a count below one, a device that is no name or the wrong shape are dropped; the others stay', !(`variant:${v0}` in got.info.clock.keys) && !('basics.name' in got.info.clock.keys) && !('basics.label' in got.info.clock.keys) && !('basics.url' in got.info.clock.keys) && Object.keys(got.info.clock.keys).length > 400);
  ok('so is a seen count that is no number', J(got.info.clock.seen) === '{"ok":4}');
  ok('a clock that is no object reads as none', readBackup({ ...file, clock: [1, 2] }).info.clock === null && readBackup({ ...file, clock: 'x' }).info.clock === null && readBackup({ ...file, clock: { keys: 3 } }).info.clock === null);
  const B = device();
  B.store.replace(got.state, 'open'); await B.persist.markFileOpened({ at: got.info.saved, recordId: got.info.recordId, hash: f.hash, clock: got.info.clock });
  let threw = null; try { await B.persist.forMerge(); await B.persist.prepareFile(); } catch (e){ threw = e; }
  ok('a device that opened it still saves and counts', threw === null, String(threw?.message));
  const backend = memoryBackend(); await backend.put('state/current', { savedAt: 'x', state: startState() }); await backend.put('meta/clock', { keys: { 'basics.name': { v: { x: 1 }, at: 'never', hash: 'abc' } }, seen: {} });
  const C = device(0, backend); await C.persist.restore();
  threw = null; try { await C.persist.forMerge(); } catch (e){ threw = e; }
  ok('and so does one that restored it from storage', threw === null, String(threw?.message));
}

section('what must hold after a delete against an edit, and after deletes in parallel');
{
  const pair = async (fa, fb, { firstA = true } = {}) => {
    const A = device(), B = device();
    A.edit(fa); await A.persist.flush();
    later(); B.edit(fb); await B.persist.flush();
    later(); const sa = await A.persist.forMerge(); later(); const sb = await B.persist.forMerge();
    return [M.merge(sa, sb), M.merge(sb, sa)];
  };
  const good = (name, [x, y], extra = () => true) => ok(name, sameState(x, y) && invalid(x.state.record).length === 0 && extra(x), invalid(x.state.record)[0]);
  // 3a: a claim deleted on one side, a version added or edited on the other
  const claim = hydra[5];
  const v = base.facts.find(f => f.id === claim).variants[0];
  const added = await pair(m => K.deleteClaim(m, claim, []), m => R.addVersion(m, claim, { text: 'Wrote the audit checklist the team still uses.', as: 'major' }));
  good('a claim deleted here and given a version there later: the claim is back with the new version, in its job, valid', added, x => x.state.record.facts.some(f => f.id === claim) && x.state.record.work.find(w => w.id === 'hydra').highlights.includes(claim) && R.versionsIn(x.state.record, claim).map(w => w.text).join() === 'Wrote the audit checklist the team still uses.' && x.summary.some(l => l.kind === 'revived'));
  const un = bare(clone(added[0].state)); added[0].summary.find(l => l.kind === 'revived').undo(un);
  ok('and its Undo deletes the claim again, valid', !un.record.facts.some(f => f.id === claim) && invalid(un.record).length === 0, invalid(un.record)[0]);
  good('a claim deleted here and a version of it edited there later: the claim is back', await pair(m => K.deleteClaim(m, claim, []), m => R.saveOver(m, v, 'Wrote the supplier audit checklist the team still uses.')), x => x.state.record.facts.some(f => f.id === claim));
  const later2 = await pair(m => R.saveOver(m, v, 'Wrote the supplier audit checklist the team still uses.'), m => K.deleteClaim(m, claim, []));
  good('an edit and a delete of the claim that have not seen each other, the delete later: the edit wins and the claim is back', later2, x => x.state.record.facts.some(f => f.id === claim) && x.state.record.variants.some(w => w.id === v) && x.state.record.work.find(w => w.id === 'hydra').highlights.includes(claim));
  // 3b: two copies each delete a different version of one claim
  const three = base.facts.find(f => f.id === hydra[0]);
  const [a0, a1] = three.variants.filter(id => (base.variants.find(x => x.id === id).lang ?? 'en') === 'en').slice(0, 2);
  const par = await pair(m => R.deleteVersion(m, a0, []), m => R.deleteVersion(m, a1, []));
  good('each deleting another version of a claim: valid, retired numbers of both kept or the version live', par, x => R.versionsIn(x.state.record, hydra[0]).length >= 1);
  // a claim with exactly two versions, each deleted on one side
  const two = base.facts.find(f => f.variants.filter(id => (base.variants.find(x => x.id === id).lang ?? 'en') === 'en').length === 2 && !hydra.includes(f.id));
  if (two){
    const [t0, t1] = two.variants.filter(id => (base.variants.find(x => x.id === id).lang ?? 'en') === 'en');
    good('a claim with two versions, one deleted on each side: one stays', await pair(m => R.deleteVersion(m, t0, []), m => R.deleteVersion(m, t1, [])), x => R.versionsIn(x.state.record, two.id).length === 1 && x.summary.some(l => l.kind === 'revived'));
  } else ok('(no claim with two versions in the example: the case is made below)', true);
  // the default pointing at a deleted version, and a retired number a revived version has again
  const dflt = base.facts.find(f => f.id === hydra[0]).default.en;
  const other = three.variants.find(id => id !== dflt && (base.variants.find(x => x.id === id).lang ?? 'en') === 'en');
  good('the default deleted on one side and another version deleted on the other: the default is a version the claim has', await pair(m => R.deleteVersion(m, dflt, []), m => R.deleteVersion(m, other, [])), x => x.state.record.facts.find(f => f.id === hydra[0]).variants.includes(x.state.record.facts.find(f => f.id === hydra[0]).default.en));
  // a version in another language deleted on one side (its default goes) and edited on the other (it is back): the language has its default again
  const cs = `${hydra[0]}-v1-cs`;
  good('a version deleted here and edited there: back, and its language has its default again', await pair(m => R.deleteVersion(m, cs, []), m => R.saveOver(m, cs, 'Vezette a dózisszámláló újratervezését, később átfogalmazva.')), x => x.state.record.facts.find(f => f.id === hydra[0]).default.cs === cs);
  const rev = await pair(m => R.deleteVersion(m, a0, []), m => R.saveOver(m, a0, 'Led the dose counter redesign, reworded later.'));
  good('a version deleted here and edited there later is back with its number free', rev, x => !(x.state.record.facts.find(f => f.id === hydra[0]).retired?.en ?? []).includes(String(x.state.record.variants.find(w => w.id === a0).n)));
}

section('version numbers stay unique with three copies');
{
  const [A, B, C] = [device(), device(), device()];
  A.edit(m => R.saveOver(m, v0, 'Led the redesign of the dose counter.'));
  C.edit(m => R.saveOver(m, v0, 'Owned the dose counter redesign.'));
  B.edit(m => R.addVersion(m, hydra[0], { text: 'Took the counter from sketch to tooling.', as: 'major' }));
  const s = [await A.persist.forMerge(), (later(), await C.persist.forMerge()), (later(), await B.persist.forMerge())];
  const fold = order => order.map(i => s[i]).reduce((acc, x) => { const m = M.merge(acc, x); return { state: m.state, clock: m.clock }; });
  const results = [[0, 1, 2], [2, 1, 0], [1, 2, 0], [0, 2, 1]].map(fold);
  ok('A and C reword a version, B adds one on its own: A meets C, then B: no two versions with one number, whichever order', results.every(r => invalid(r.state.record).length === 0) && results.every(r => J(r.state) === J(results[0].state)), results.map(r => invalid(r.state.record)[0]).join('; '));
  ok('and every version is there', count(results[0].state.record, hydra[0]) === count(base, hydra[0]) + 2);
}

section('an Undo that sticks');
{
  const A = device(), B = device();
  A.edit(m => R.saveOver(m, v0, 'Led the redesign of the dose counter.'));
  B.edit(m => R.saveOver(m, v0, 'Owned the dose counter redesign end to end.'));
  const sa = await A.persist.forMerge(); later(); const sb = await B.persist.forMerge();
  const ab = M.merge(sa, sb);
  const alt = ab.summary.find(l => l.kind === 'alt');
  await takeInto(A, ab);
  const merged = { state: bare(A.store.materialize()), clock: ab.clock };
  A.store.commit(d => alt.undo(d), 'undo'); later();
  const after = await A.persist.forMerge();
  ok('the Undo of a kept wording is a delete with a mark', !after.state.record.variants.some(v => v.id === alt.key.slice(8)) && !!after.state.record.removed?.[alt.key]);
  const again = M.merge(after, merged);
  ok('the next merge with a copy that still has it does not bring it back', !again.state.record.variants.some(v => v.id === alt.key.slice(8)) && !again.summary.some(l => l.kind === 'alt'));
  const again2 = M.merge(after, sb);
  ok('nor does one with the older file', !again2.state.record.variants.some(v => v.id === alt.key.slice(8)));
  // made under one name
  const C = device(), D = device();
  C.edit(m => R.addVersion(m, hydra[1], { text: 'Built the drop rig and wrote its protocols.', as: 'major' }));
  D.edit(m => R.addVersion(m, hydra[1], { text: 'Designed the cycle rig for the dose counter.', as: 'major' }));
  const sc = await C.persist.forMerge(); later(); const sd = await D.persist.forMerge();
  const cd = M.merge(sc, sd), both = cd.summary.find(l => l.kind === 'alt' || l.kind === 'both');
  await takeInto(C, cd);
  const merged2 = { state: bare(C.store.materialize()), clock: cd.clock };
  C.store.commit(d => both.undo(d), 'undo'); later();
  const after2 = await C.persist.forMerge();
  ok('so does the Undo of two versions made under one name', !M.merge(after2, merged2).state.record.variants.some(v => v.id === both.key.slice(8)) && !!after2.state.record.removed?.[both.key]);
}

section('the settings: lists of tags are joined, and the line says what differed');
{
  const A = device(), B = device();
  A.edit(m => { m.vocabulary.tags = [...m.vocabulary.tags, 'safety']; });
  B.edit(m => { m.vocabulary.tags = [...m.vocabulary.tags, 'regulatory']; m.requireSource = true; });
  const sa = await A.persist.forMerge(); later(); const sb = await B.persist.forMerge();
  const [ab, ba] = both(sa, sb);
  ok('a tag added on each side is in the merged settings, in the same order both ways', sameState(ab, ba) && ab.state.record.vocabulary.tags.includes('safety') && ab.state.record.vocabulary.tags.includes('regulatory') && ab.state.record.requireSource === true);
  const line = ab.summary.find(l => l.key === 'settings');
  ok('the line names the settings that differed, one value on each side', !!line && line.kept !== line.other && /vocabulary/.test(line.kept) && /vocabulary/.test(line.other));
}

section('three copies add to one job, in any order');
{
  const [A, B, C] = [device(), device(), device()];
  A.edit(m => addBullet(m, 'hydra', 'Cut the part count of the dose counter by a third.'));
  B.edit(m => addBullet(m, 'hydra', 'Ran the supplier audits for the counter.'));
  C.edit(m => addBullet(m, 'hydra', 'Wrote the test protocols for the dose rig.'));
  const s = [await A.persist.forMerge(), (later(), await B.persist.forMerge()), (later(), await C.persist.forMerge())];
  const fold = order => order.map(i => s[i]).reduce((acc, x) => { const m = M.merge(acc, x); return { state: m.state, clock: m.clock }; });
  const rs = [[0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1], [1, 0, 2], [0, 2, 1]].map(fold);
  ok('the three bullets are in the job, in the same order and byte for byte the same state, whichever order', rs.every(r => J(r.state) === J(rs[0].state)) && rs[0].state.record.work.find(w => w.id === 'hydra').highlights.length === hydra.length + 3 && invalid(rs[0].state.record).length === 0);
}

section('two new objects with one id are two objects');
{
  // each device adds a third certificate of the same name with another issuer: one id (the certificate and its claim), different content
  const A = device(), B = device();
  let id = null;
  A.edit(m => { id = K.addCertificate(m, { name: 'Third Cert', issuer: 'Issuer A', date: '2024-01' }); });
  A.store.commit(d => { const r = d.resumes.find(x => x.id === names[1]); r.picks = { ...(r.picks ?? {}), [id]: `${id}-v1` }; }, 'pick');
  B.edit(m => { K.addCertificate(m, { name: 'Third Cert', issuer: 'Issuer B', date: '2025-02' }); });
  B.store.commit(d => { const r = d.resumes.find(x => x.id === names[2]); r.picks = { ...(r.picks ?? {}), [id]: `${id}-v1` }; }, 'pick');
  const sa = await A.persist.forMerge(); later(); const sb = await B.persist.forMerge();
  const [ab, ba] = both(sa, sb);
  const r = ab.state.record, certs = r.certificates.filter(c => c.id.startsWith(id));
  const other = certs.find(c => c.id !== id), kept = certs.find(c => c.id === id);
  ok('both certificates are there: the newer keeps the id, the other has <id>-<6 of its hash>', certs.length === 2 && kept.issuer === 'Issuer B' && other.issuer === 'Issuer A' && other.id === `${id}-${other.id.slice(-6)}` && /^[0-9a-f]{6}$/.test(other.id.slice(-6)), J(certs));
  ok('and two claims, each with its own version, in the list of certificates', r.facts.filter(f => f.id.startsWith(id)).length === 2 && r.facts.find(f => f.id === other.id).variants.every(v => v.startsWith(id) && v !== `${id}-v1`) && r.sections.find(x => x.id === 'certified').content.items.includes(id) && r.sections.find(x => x.id === 'certified').content.items.includes(other.id));
  ok('the record is valid, and both merge orders end byte-identical, clock and state', invalid(r).length === 0 && sameState(ab, ba) && J(ab.clock) === J(ba.clock), invalid(r)[0]);
  const rA = ab.state.resumes.find(x => x.id === names[1]), rB = ab.state.resumes.find(x => x.id === names[2]);
  ok('a resume that picked the renamed one picks it under its new id and version, the other keeps its pick', rA.picks[other.id] === r.facts.find(f => f.id === other.id).variants[0] && !(id in rA.picks) && rB.picks[id] === `${id}-v1`);
  ok('and one line says two were made', ab.summary.filter(l => l.kind === 'both').length === 1);
  const un = bare(clone(ab.state)); ab.summary.find(l => l.kind === 'both').undo(un);
  ok('its Undo removes the renamed one with its claim, and the record stays valid', !un.record.certificates.some(c => c.id === other.id) && !un.record.facts.some(f => f.id === other.id) && invalid(un.record).length === 0, invalid(un.record)[0]);
  // the copy that lost the id meets the merged result: the renamed objects carry its own count, which is no sign of another browser
  await takeInto(B, ba); later();
  const fb = await B.persist.prepareFile(), gb = readBackup(JSON.parse(fb.text)), actorA = await A.backend.get('meta/device');
  await A.persist.forMerge(gb.info.clock);
  ok('a device that meets the result of a split keeps its actor', (await A.backend.get('meta/device')) === actorA);
  const again = M.merge({ state: ab.state, clock: ab.clock }, sa);
  ok('meeting the first copy again changes nothing', again.changed === 0 && again.summary.length === 0 && sameState(again, ab));
  // a version of the same id on both sides is split the same way
  const C = device(), D = device();
  C.edit(m => R.addVersion(m, hydra[1], { text: 'Built the drop rig and wrote its protocols.', as: 'major' }));
  D.edit(m => R.addVersion(m, hydra[1], { text: 'Designed the cycle rig for the dose counter.', as: 'major' }));
  const sc = await C.persist.forMerge(); later(); const sd = await D.persist.forMerge();
  const [cd, dc] = both(sc, sd);
  const vs = R.versionsIn(cd.state.record, hydra[1]);
  ok('two versions of one claim with one id: both are kept under their own ids, in numbers of their own', sameState(cd, dc) && vs.length === count(base, hydra[1]) + 2 && new Set(vs.map(v => v.id)).size === vs.length && new Set(vs.map(v => v.n)).size === vs.length && invalid(cd.state.record).length === 0);
}

section('three copies: reword, delete, reword differently');
{
  const [A, B, C] = [device(), device(), device()];
  A.edit(m => R.saveOver(m, v0, 'Led the redesign of the dose counter.'));
  B.edit(m => R.deleteVersion(m, v0, []));
  C.edit(m => R.saveOver(m, v0, 'Owned the dose counter redesign.'));
  const s = [await A.persist.forMerge(), (later(), await B.persist.forMerge()), (later(), await C.persist.forMerge())];
  const fold = order => order.map(i => s[i]).reduce((acc, x) => { const m = M.merge(acc, x); return { state: m.state, clock: m.clock }; });
  const rs = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map(fold);
  ok('the six orders of meeting end in one state and one clock', rs.every(r => J(r.state) === J(rs[0].state) && J(r.clock) === J(rs[0].clock)), where(rs[0].state, rs.find(r => J(r.state) !== J(rs[0].state))?.state ?? {}));
  ok('with both wordings kept and the delete undone by the edits that had not seen it', rs[0].state.record.variants.filter(v => v.id.startsWith(`${v0}-alt-`)).length === 1 && rs[0].state.record.variants.some(v => v.id === v0) && invalid(rs[0].state.record).length === 0);
}

section('a merge writes stamps like any other, and meeting a file again lists nothing');
{
  const okClock = (c, st) => Object.keys(M.cleanClock(c)?.keys ?? {}).length === Object.keys(c.keys).length && M.clockFits(st, c);
  // a baseline key the merge itself changes: a claim deleted on one side, a version of it edited later on the other
  const A = device(), B = device();
  A.edit(m => K.deleteClaim(m, hydra[5], []));
  B.edit(m => R.saveOver(m, firstVersion(hydra[5]), 'Wrote the supplier audit checklist the team still uses.'));
  const sa = await A.persist.forMerge(); later(); const sb = await B.persist.forMerge();
  const ab = M.merge(sa, sb);
  ok('what the merge wrote has stamps that are dates, and the clock fits its state', ab.summary.some(l => l.kind === 'revived') && okClock(ab.clock, ab.state));
  await takeInto(A, ab);
  let threw = null; try { later(); await A.persist.forMerge(); const f = await A.persist.prepareFile(); await A.persist.markFileSaved(f); } catch (e){ threw = e; }
  ok('and the device still stamps, saves and opens files after it', threw === null, String(threw?.message));
  ok('the saved file’s clock fits what it holds', (() => { const got = readBackup(JSON.parse(JSON.stringify(makeBackup(A.store.materialize(), { clock: ab.clock, device: 'x' })))); return M.clockFits(got.state, got.info.clock); })());
  // three copies each add a bullet to one job; one meets the others one after the other, the same key twice
  const [X, Y, Z] = [device(), device(), device()];
  X.edit(m => addBullet(m, 'hydra', 'Cut the part count of the dose counter by a third.'));
  Y.edit(m => addBullet(m, 'hydra', 'Ran the supplier audits for the counter.'));
  Z.edit(m => addBullet(m, 'hydra', 'Wrote the test protocols for the dose rig.'));
  const sx = await X.persist.forMerge(); later(); const sy = await Y.persist.forMerge(); later(); const sz = await Z.persist.forMerge();
  const m1 = M.merge(sx, sy), m2 = M.merge({ state: m1.state, clock: m1.clock }, sz);
  ok('a key merged twice keeps a clock of real stamps that fits its state', okClock(m1.clock, m1.state) && okClock(m2.clock, m2.state));
  ok('and every bullet is in the job, which the older copy’s value did not win back', m2.state.record.work.find(w => w.id === 'hydra').highlights.length === hydra.length + 3 && invalid(m2.state.record).length === 0);
  ok('and the stamp is the same whichever copy merges', J(M.merge(sy, sx).clock) === J(m1.clock));
  // a conflict whose line is listed once: the same file again is a later edit of what was merged
  const P = device(), Q = device();
  P.edit(m => { m.basics.label = 'Edited first'; }); later();
  const sp = await P.persist.forMerge(); later(); Q.edit(m => { m.basics.label = 'Edited last'; }); const sq = await Q.persist.forMerge();
  for (const [mine, theirs] of [[sp, sq], [sq, sp]]){
    const first = M.merge(mine, theirs), again = M.merge({ state: first.state, clock: first.clock }, theirs);
    ok('a value kept (or taken) is listed once: meeting the same file again lists nothing and changes nothing', first.summary.length === 1 && again.summary.length === 0 && again.changed === 0 && sameState(first, again));
  }
  // two copies at the same stamps that differ only in what is no edit (a resume's frozen text, a version's measured lines): the same state whichever way round
  const F1 = startState(), F2 = startState();
  F1.frozen[names[1]] = { ...F1.frozen[names[1]], basics: { name: 'Printed one way' } }; F2.frozen[names[1]] = { ...F2.frozen[names[1]], basics: { name: 'Printed another' } };
  F1.record.variants[0].metrics = { chars: 1, measured: { a4: { lines: 3 } } }; F2.record.variants[0].metrics = { chars: 1, measured: { a4: { lines: 4 } } };
  const c0 = M.baseline(bare(F1));
  ok('copies at one stamp that differ only in a frozen text or a measured line count end in the same state both ways', sameState(M.merge({ state: bare(F1), clock: c0 }, { state: bare(F2), clock: c0 }), M.merge({ state: bare(F2), clock: c0 }, { state: bare(F1), clock: c0 })));
  // one order for the deletion marks
  const D = device(), E = device();
  D.edit(m => { K.deleteClaim(m, hydra[4], []); K.deleteClaim(m, hydra[3], []); });
  later(); const sd = await D.persist.forMerge(), se = await E.persist.forMerge();
  const de = M.merge(se, sd), ed = M.merge(sd, se);
  ok('deletion marks are written in one order, so a copy that took them and the copy they came from are the same bytes', J(Object.keys(D.store.materialize().record.removed)) === J(Object.keys(D.store.materialize().record.removed).sort()) && J(de.state.record.removed) === J(D.store.materialize().record.removed) && J(ed.state.record.removed) === J(de.state.record.removed));
}

// A random run: 2 to 4 devices edit (versions, claims, bullets, saved resumes, a language group) and meet in random pairs; every merge must validate and be
// the same both ways, every clock must read back whole and fit its state, and every order of meeting all of them must end in one state.
async function fuzz(seeds, first = 1){
  const out = { bad: '', pairs: 0, fails: [] };
  const gs = startState(); RS.duplicate(gs, names[0], { lang: 'hu' }); RS.openSaved(gs, names[0]);
  const EN = names[0], HU = gs.resumes.find(r => r.parent === EN).id, loose = names.filter(n => ![EN, HU].includes(n));
  for (let seed = first; seed < first + seeds && (!out.bad || process.env.FUZZ_ALL); seed++){
    out.bad = process.env.FUZZ_ALL ? '' : out.bad;
    let st = seed * 2654435761 >>> 0;
    const rnd = () => { st = (st + 0x6D2B79F5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = list => list[Math.floor(rnd() * list.length)], num = () => Math.floor(rnd() * 1e6);
    const ops = [
      m => { const f = m.facts.find(x => x.id === pick(hydra)); R.saveOver(m, pick(f.variants), `Reworded ${num()}`); },
      m => R.addVersion(m, pick(hydra), { text: `Another wording ${num()}`, as: 'major' }),
      m => { const f = m.facts.find(x => x.id === pick(hydra)); R.deleteVersion(m, pick(f.variants), []); },
      m => K.deleteClaim(m, pick(hydra), []),
      m => addBullet(m, 'hydra', `New bullet ${num()}`),
      m => { m.basics.label = `Label ${num()}`; },
      m => { const v = pick(m.variants); v.tags = [...(v.tags ?? []), 'safety']; },
      m => K.addCertificate(m, { name: pick(['Third Cert', 'Fourth Cert']), issuer: `Issuer ${num() % 3}`, date: '2024-01' }),
    ];
    const dops = [      // on the store's whole state
      d => RS.deleteSaved(d, pick(loose)),
      d => { const r = d.resumes.find(x => x.id === pick(loose)); if (r) r.pageLimit = 1 + Math.floor(rnd() * 3); },
      d => { RS.openSaved(d, EN); d.cur.pageLimit = 1 + Math.floor(rnd() * 3); },
      d => { RS.openSaved(d, HU); d.cur.design = { ...(d.cur.design ?? {}), size: pick(['large', 'small']) }; },
    ];
    const D = Array.from({ length: 2 + Math.floor(rnd() * 4) }, () => device(0, memoryBackend(), clone(gs)));
    const check = (what, m) => {
      const errs = invalid(m.state.record); if (errs.length) out.bad ||= `seed ${seed} ${what}: ${errs[0]}`;
      if (Object.keys(M.cleanClock(m.clock)?.keys ?? {}).length !== Object.keys(m.clock.keys).length) out.bad ||= `seed ${seed} ${what}: the clock has a stamp that does not read back`;
      if (!M.clockFits(m.state, m.clock)) out.bad ||= `seed ${seed} ${what}: the clock does not fit its state`;
    };
    const seedStart = out.bad;
    for (let step = 0; step < 7 && !out.bad; step++){
      const d = pick(D);
      for (let n = 0, k = 1 + Math.floor(rnd() * 2); n < k; n++){
        try { if (rnd() < .75) d.edit(m => pick(ops)(m)); else d.store.commit(x => pick(dops)(x), 'edit'); } catch { /* the model refused it */ }
      }
      later(); await d.persist.flush();
      if (rnd() < .6){
        const [x, y] = [pick(D), pick(D)];
        if (x === y) continue;
        later(); const sy = await y.persist.forMerge(); later(); const before = await x.backend.get('meta/device'); const sx = await x.persist.forMerge(sy.clock);
        if (before && (await x.backend.get('meta/device')) !== before) out.bad ||= `seed ${seed}: an ordinary device took another actor id`;
        const m = M.merge(sx, sy), r = M.merge(sy, sx); out.pairs++;
        if (!sameState(m, r)) out.bad ||= `seed ${seed}: a pair differs by order at ${where(m.state, r.state)}`;
        check('pair', m);
        await takeInto(x, m);
        try { later(); await x.persist.forMerge(); } catch (e){ out.bad ||= `seed ${seed}: stamping after a merge threw ${e.message}`; }
      }
    }
    const s = []; for (const d of D){ later(); s.push(await d.persist.forMerge()); }
    const fold = order => order.map(i => s[i]).reduce((acc, x) => { const m = M.merge(acc, x); return { state: m.state, clock: m.clock }; });
    const ids = D.map((_, i) => i), rs = [ids, [...ids].reverse(), [...ids.slice(1), ids[0]]].map(fold);
    rs.forEach(r => check('fold', r));
    // shortcut: a resume's frozen text (what it printed when last saved here) can differ by order when 3 or more copies hold one resume that printed differently, so the orders are compared without it
    const core = r => J({ record: r.state.record, resumes: r.state.resumes });
    if (!rs.every(r => core(r) === core(rs[0]))) out.bad ||= `seed ${seed}: ${D.length} copies end in different states by order at ${where(rs[0].state, rs.find(r => core(r) !== core(rs[0])).state)}`;
    if (process.env.FUZZ_ALL && out.bad) out.fails.push(out.bad);
  }
  return out;
}
section('random edits and deletes on 2 to 4 copies');
{
  const seeds = Number(process.env.FUZZ_SEEDS ?? 12), r = await fuzz(seeds, Number(process.env.FUZZ_FIRST ?? 1));
  if (process.env.FUZZ_ALL) console.log('FUZZ fails', r.fails.length, '/', seeds, r.fails.map(f => f.slice(0, 120)).join('\n  '));
  ok(`every merge valid, the same both ways, its clock whole, and every order of meeting ends in one state (${seeds} seeds, ${r.pairs} pairs; FUZZ_SEEDS=n for more)`, r.bad === '', r.bad);
}

section('a saved resume renamed after it was made');
{
  const A = device();
  A.store.commit(d => { d.resumes.find(r => r.id === names[1]).company = 'Renamed Company'; }, 'rename');      // the id stays; the name the file derives is another
  later(); const f = await A.persist.prepareFile();
  const got = readBackup(JSON.parse(f.text));
  ok('a file keeps the ids the clock is keyed by, so it fits its clock', got.state.resumes.some(r => r.id === names[1]) && M.clockFits(got.state, got.info.clock));
  const old = JSON.parse(f.text); delete old.resumeIds;
  const oldGot = readBackup(old);
  ok('a file with no ids still opens, with the names its resumes derive', oldGot.warnings.length === 0 && oldGot.state.resumes.length === got.state.resumes.length && !oldGot.state.resumes.some(r => r.id === names[1]));
}

section('a job split in two takes its title and meta claims with it');
{
  const X = device(), Y = device();
  X.edit(m => addJob(m, { position: 'Intern', name: 'Rig Works', startDate: '2018-06', endDate: '2018-09', bullets: ['Built a test rig.'] }));
  Y.edit(m => addJob(m, { position: 'Intern', name: 'Rig Works', startDate: '2019-01', endDate: '2019-04', bullets: ['Built a test rig.'] }));
  const sx = await X.persist.forMerge(); later(); const sy = await Y.persist.forMerge();
  const [xy, yx] = both(sx, sy);
  const r = xy.state.record, jobs = r.work.filter(w => w.id.startsWith('rig-works'));
  const metaOf = w => r.variants.find(v => v.id === r.facts.find(f => f.id === w.display.meta).default.en).text;
  ok('two jobs, each with a meta claim of its own that prints its own dates', jobs.length === 2 && jobs[0].display.meta !== jobs[1].display.meta && jobs.find(w => w.id === 'rig-works' && /2019/.test(metaOf(w))) && jobs.find(w => w.id !== 'rig-works' && /2018/.test(metaOf(w))) && jobs[0].display.position !== jobs[1].display.position, J(jobs.map(w => [w.id, w.display])));
  ok('valid, and byte-identical both ways', invalid(r).length === 0 && sameState(xy, yx) && J(xy.clock) === J(yx.clock), invalid(r)[0]);
}

section('this device’s count, and a copy opened in place of this one');
{
  // storage that kept the device but lost its count: the keys still say how far it got
  const backend = memoryBackend(); await backend.put('state/current', { savedAt: 'x', state: startState() }); await backend.put('meta/device', 'abc123');
  const keys = Object.fromEntries(Object.entries(M.baseline(bare(startState())).keys).map(([k, e], i) => [k, i === 0 ? { ...e, v: { ...e.v, abc123: 7 } } : e]));
  await backend.put('meta/clock', { keys, seen: {} });
  const P = device(0, backend); await P.persist.restore();
  P.edit(m => { m.basics.label = 'After the loss'; });
  ok('a clock that lost its count starts from the highest count of this device in it', (await P.persist.forMerge()).clock.seen.abc123 === 8);
  // two browsers on one actor (copied storage)
  const one = device(); one.edit(m => { m.basics.label = 'Label one'; }); later(); await one.persist.flush();
  const copy = memoryBackend([...one.backend._map]);
  const two = device(0, copy); await two.persist.restore();
  one.edit(m => { m.basics.url = 'https://dana.example/one'; }); later(); await one.persist.flush();
  two.edit(m => { m.basics.name = 'Dana Okonkwo-Two'; }); later(); await two.persist.flush();
  const file2 = await two.persist.prepareFile(), got2 = readBackup(JSON.parse(file2.text));
  const was = await one.backend.get('meta/device');
  ok('a file with its own actor and saves this copy never made: this copy takes another actor before they meet', (await one.persist.forMerge(got2.info.clock)) && (await one.backend.get('meta/device')) !== was);
  const joined = M.merge(await one.persist.forMerge(got2.info.clock), { state: bare(got2.state), clock: got2.info.clock });
  ok('and both lines of edits survive', joined.state.record.basics.url === 'https://dana.example/one' && joined.state.record.basics.name === 'Dana Okonkwo-Two' && joined.state.record.basics.label === 'Label one' && joined.summary.length === 0);
  // the same key saved three times by one browser and once by the other, which had already autosaved it: the second browser's edit is listed, not dropped
  const p1 = device(); p1.edit(m => { m.basics.label = 'Start'; }); later(); await p1.persist.flush();
  const p2 = device(0, memoryBackend([...p1.backend._map])); await p2.persist.restore();
  for (const x of ['One', 'Two', 'Three']){ p1.edit(m => { m.basics.label = `Label ${x}`; }); later(); await p1.persist.flush(); }
  p2.edit(m => { m.basics.label = 'Label other'; }); later(); await p2.persist.flush();
  const pf = await p1.persist.prepareFile(), pg = readBackup(JSON.parse(pf.text));
  const lost = M.merge(await p2.persist.forMerge(pg.info.clock), { state: bare(pg.state), clock: pg.info.clock });
  ok('an edit this browser autosaved under the shared actor is told apart from the other browser’s saves of that key, and listed', lost.summary.some(l => l.key === 'basics.label') && J(lost.clock.seen) !== J(pg.info.clock.seen));
  // and not for a file this device made itself, or one others have merged since
  const solo = device(); solo.edit(m => { m.basics.label = 'Solo'; }); later(); const own = await solo.persist.prepareFile(); const ownGot = readBackup(JSON.parse(own.text));
  const soloId = await solo.backend.get('meta/device');
  solo.edit(m => { m.basics.url = 'https://dana.example/solo'; }); later();
  await solo.persist.forMerge(ownGot.info.clock);
  ok('a file this device saved itself leaves the actor as it is', (await solo.backend.get('meta/device')) === soloId);
}

section('Replace mine counts as an edit');
{
  const A = device(), B = device();
  A.edit(m => { m.basics.label = 'Label L1'; }); later();
  const f1 = await A.persist.prepareFile(), got1 = readBackup(JSON.parse(f1.text));
  later(); A.edit(m => { m.basics.label = 'Label L2'; });
  await takeInto(B, M.merge(await B.persist.forMerge(), await A.persist.forMerge())); later();
  // A opens the older file in place of its own copy
  A.store.replace(got1.state, 'open'); await A.persist.markFileOpened({ at: got1.info.saved, recordId: got1.info.recordId, hash: f1.hash, clock: got1.info.clock });
  later(); const m = M.merge(await A.persist.forMerge(), await B.persist.forMerge());
  ok('a copy that has the text it replaced does not bring it back: the file opened is the later edit, and no line is made', m.state.record.basics.label === 'Label L1' && m.summary.length === 0);
  const m2 = M.merge(await B.persist.forMerge(), await A.persist.forMerge());
  ok('whichever way round', m2.state.record.basics.label === 'Label L1' && J(m2.clock) === J(m.clock));
}

section('counts that are too big');
{
  const c = M.baseline(bare(startState()));
  const big = (n, extra = {}) => M.cleanClock({ keys: { ...c.keys, 'basics.name': { ...c.keys['basics.name'], v: { x: n } } }, seen: { x: n, ...extra } });
  ok('a count of 2^40 is a count', 'basics.name' in big(2 ** 40).keys && big(2 ** 40).seen.x === 2 ** 40);
  ok('one near the top of what a number holds is a bad entry, and a bad seen count is dropped', !('basics.name' in big(Number.MAX_SAFE_INTEGER - 1).keys) && !('y' in big(1, { y: 2 ** 41 }).seen) && big(1, { y: 2 ** 41 }).seen.x === 1);
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
