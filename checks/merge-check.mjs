#!/usr/bin/env node
// node checks/merge-check.mjs
// Merging an older copy of the career (src/model/diff.js): what you deleted or reworded since is not brought back ticked,
// two copies of one career end in the same record in any order, a merged version keeps its source, and no saved resume prints differently.

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
import { fnv } from '../src/store/store.js';
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

console.log(failed ? `\n${failed} merge check(s) FAILED` : '\nall merge checks passed');
process.exit(failed ? 1 : 0);
