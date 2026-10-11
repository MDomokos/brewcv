#!/usr/bin/env node
// node checks/savefile-check.mjs
// Save to file in Node: the format with its record id, the four ways a file can meet this browser, outside edits
// in a backup's record, the change count since the last file save, copies made by sync tools, the overwrite guard on
// a linked folder, and scripts/onefile.mjs. Fictional data only (data/example.json and its example resumes).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStore } from '../src/store/store.js';
import { createPersist, memoryBackend, memoryFolder, readFolder, readBackup, makeBackup, filesOf, openVerdict,
  sha256, conflictCopy, SAVE_FILE_NAME, APP_VERSION } from '../src/store/persist.js';
import { load, loadResume, detect, ensureRecordId } from '../src/model/schema.js';
import * as I from '../src/model/import.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`);
  if (!cond) failed++;
};
const section = t => console.log(`\n— ${t}`);

// the fictional example: the library and every example resume
function example(){
  const { model } = load(read('data/example.json'));
  const names = read('data/example-resumes/index.json');
  const resumes = [], frozen = {};
  for (const n of names){
    const got = loadResume(read(`data/example-resumes/${n}`), model);
    resumes.push({ ...got.recipe, id: n });
    if (got.frozen) frozen[n] = got.frozen;
  }
  return { record: model, resumes, frozen };
}
function clock(){
  let t = Date.parse('2026-10-10T12:00:00Z');
  const timers = new Map(); let id = 0;
  return { now: () => t, date: () => new Date(t), advance(ms){ t += ms; },
    setTimer: (fn) => { timers.set(++id, fn); return id; }, clearTimer: i => timers.delete(i),
    async tick(){ const fns = [...timers.values()]; timers.clear(); for (const fn of fns) await fn(); } };
}
const text = obj => JSON.stringify(obj, null, 2) + '\n';

section('the format');
{
  const ex = example();
  ensureRecordId(ex.record);
  const file = makeBackup(ex, { saved: '2026-10-10T12:00:00.000Z' });
  ok('still resumeBuilderBackup: 1, so every old backup opens', file.resumeBuilderBackup === 1 && detect(file) === 'backup');
  ok('it says which app version wrote it, and the constant is package.json’s', file.app === APP_VERSION && APP_VERSION === read('package.json').version);
  ok('it carries the record’s id, once, in the record too', file.recordId === ex.record.recordId && file.record.meta.resumeBuilder.recordId === ex.record.recordId);
  ok('no checkpoints in the saved file', !('checkpoints' in file));
  ok('the file name is one constant', SAVE_FILE_NAME === 'brewcv.json');
  const back = readBackup(JSON.parse(text(file)));
  ok('opening it gives the record, every saved resume and the id back', back.state.record.recordId === ex.record.recordId && back.state.resumes.length === ex.resumes.length && back.info.recordId === ex.record.recordId && back.info.saved === file.saved);
  const old = { resumeBuilderBackup: 1, saved: '2026-01-01T00:00:00.000Z', record: file.record, resumes: file.resumes };
  delete old.record.meta.resumeBuilder.recordId;
  const o = readBackup(old);
  ok('a backup from before this change still opens, without an id', o.info.recordId === null && o.state.resumes.length === ex.resumes.length);
  ok('and the kind is found from the content, whatever the file is called', I.readImport(text(old), `${['Resume', 'Builder'].join(' ')} backup 2026-01-01.json`).kind === 'backup' && I.readImport(text(file), 'whatever.txt').kind === 'backup');
  const withCp = makeBackup(ex, { checkpoints: [{ id: 'c1' }] });
  ok('checkpoints are only written when asked for', 'checkpoints' in withCp);
}

section('opening a file next to what this browser has');
{
  const f = { recordId: 'R1', saved: '2026-10-10T12:00:00.000Z' };
  const last = { at: '2026-10-10T12:00:00.000Z', recordId: 'R1', hash: 'h' };
  ok('the file last saved here, nothing changed since: already up to date', openVerdict({ file: f, last, localRecordId: 'R1', changes: 0 }).kind === 'same');
  ok('the same date but different text (edited after it was saved): not "up to date"', openVerdict({ file: { ...f, hash: 'other' }, last, localRecordId: 'R1', changes: 0 }).kind === 'ok');
  ok('the same date and the same text: up to date', openVerdict({ file: { ...f, hash: 'h' }, last, localRecordId: 'R1', changes: 0 }).kind === 'same');
  const c = openVerdict({ file: f, last, localRecordId: 'R1', changes: 3 });
  ok('changes since the last save: warns with the count', c.kind === 'changes' && c.changes === 3);
  const older = openVerdict({ file: { ...f, saved: '2026-10-09T08:00:00.000Z' }, last, localRecordId: 'R1', changes: 0 });
  ok('a file older than the last one saved here: warns', older.kind === 'older');
  ok('older and changed: one warning, both facts', (() => { const v = openVerdict({ file: { ...f, saved: '2026-10-09T08:00:00.000Z' }, last, localRecordId: 'R1', changes: 2 }); return v.kind === 'changes' && v.older; })());
  ok('another record’s id: a different record', openVerdict({ file: { ...f, recordId: 'R2' }, last, localRecordId: 'R1', changes: 0 }).kind === 'different');
  ok('a file with no id (an old backup) is not mistaken for this record’s', openVerdict({ file: { saved: f.saved, recordId: null }, last, localRecordId: 'R1', changes: 0 }).kind === 'different');
  ok('a newer file of this record, nothing local to lose: carries on as before', openVerdict({ file: { ...f, saved: '2026-10-11T08:00:00.000Z' }, last, localRecordId: 'R1', changes: 0 }).kind === 'ok');
  ok('never saved to a file here and no changes: carries on', openVerdict({ file: f, last: null, localRecordId: 'R1', changes: 0 }).kind === 'ok');
}

section('a backup edited outside BrewCV');
{
  const ex = example();
  ensureRecordId(ex.record);
  const file = JSON.parse(text(makeBackup(ex)));
  ok('an untouched file has no outside edits', I.readImport(text(file), 'b.json').outside.length === 0);
  const job = file.record.work.find(w => (w.highlights ?? []).length);
  const was = job.highlights[0];
  job.highlights[0] = 'A line somebody rewrote in another tool.';
  const got = I.readImport(text(file), 'b.json');
  ok('the backup’s record reports the edited text', got.kind === 'backup' && got.outside.length === 1 && got.outside[0].text.startsWith('A line somebody'), JSON.stringify(got.outside));
  ok('and the review table has the same row as a library file does', got.review.rows.some(r => /outside/i.test(r[0])));
  const next = readBackup(got.json).state;
  const before = next.record.variants.length;
  const n = I.applyOutsideEdits(next.record, got.outside);
  ok('applying it adds a version, as for a library', n === 1 && next.record.variants.length === before + 1 && next.record.variants.some(v => v.text.startsWith('A line somebody')));
  ok('the old text stays as a version', next.record.variants.some(v => v.text === was) || was === undefined);
}

section('the file save state: when, and how many changes since');
{
  const c = clock();
  const ex = example();
  const store = createStore({ ...ex, cur: null, openId: null }, { now: c.now });
  const backend = memoryBackend();
  const p = createPersist({ store, backend, now: c.date, setTimer: c.setTimer, clearTimer: c.clearTimer });
  ok('before any file save: nothing saved, no changes counted', p.fileState.last === null && p.fileState.changes === 0);
  const f = await p.prepareFile();
  ok('prepareFile gives the text, the fixed name and an id', f.name === SAVE_FILE_NAME && !!f.recordId && f.hash === await sha256(f.text) && JSON.parse(f.text).recordId === f.recordId);
  ok('a record with no id gets one the first time (kept in the record)', store.state.record.recordId === f.recordId);
  await p.markFileSaved(f);
  ok('after saving: last is set, no changes since', p.fileState.last.at === f.at && p.fileState.last.hash === f.hash && p.fileState.changes === 0);
  const tag = store.state.record.work[0];
  store.commit(d => { d.record.basics.label = 'One'; }, 'edit');
  store.commit(d => { d.record.basics.label = 'Two'; }, 'edit');
  ok('two commits: two changes not saved to a file', p.fileState.changes === 2);
  store.undo();
  ok('an undo counts as a step too', p.fileState.changes === 3);
  await c.tick();
  const again = createPersist({ store: createStore({}), backend, now: c.date, setTimer: c.setTimer, clearTimer: c.clearTimer });
  await again.restore();
  ok('a reload keeps the last file save and the count', again.fileState.last?.hash === f.hash && again.fileState.changes === 3 && again.fileState.recordId === f.recordId);
  const f2 = await again.prepareFile();
  ok('the next save carries on from the same record id', f2.recordId === f.recordId);
  await again.markFileSaved(f2);
  ok('and clears the count', again.fileState.changes === 0);
  const g = createPersist({ store: createStore({}), backend, now: c.date, setTimer: c.setTimer, clearTimer: c.clearTimer });
  await g.restore();
  ok('also after another reload', g.fileState.changes === 0 && g.fileState.last.at === f2.at);
  await g.markFileOpened({ at: '2026-01-01T00:00:00.000Z', recordId: 'X', hash: 'y' });
  ok('opening a file makes it the last one saved here', g.fileState.last.recordId === 'X' && g.fileState.changes === 0);
}

section('copies a sync tool makes');
{
  const hits = ['brewcv.sync-conflict-20261010-123456-ABCDEFG.json', 'Ferro Tools - Manufacturing Engineer.sync-conflict-20261010-123456-ABCDEFG.json',
    'brewcv (Pat’s conflicted copy 2026-10-10).json', "Ferro Tools (Pat's conflicted copy 2026-10-10).json", 'brewcv (conflicted copy).json', 'brewcv 2.json', 'resume-data 3.json'];
  for (const n of hits) ok(`${n}: a conflict copy`, !!conflictCopy(n));
  const fine = ['brewcv.json', 'resume-data.json', 'Example Instruments - Design Engineer.json', 'Ferro Tools - Manufacturing Engineer 2.json', 'Synchronised Systems - Role.json', 'Conflict Labs - Engineer.json'];
  for (const n of fine) ok(`${n}: a real file`, !conflictCopy(n));
  const ex = example();
  ensureRecordId(ex.record);
  const files = filesOf(ex);
  const seed = Object.fromEntries(files);
  const copy = 'recipes/Example Instruments - Design Engineer.sync-conflict-20261010-123456-ABCDEFG.json';
  seed[copy] = seed['recipes/Example Instruments - Design Engineer.json'];
  seed['recipes/Helix Diagnostics (Pat’s conflicted copy 2026-10-10).json'] = seed['recipes/Helix Diagnostics - Product Development Engineer.json'];
  const got = await readFolder(memoryFolder(seed));
  ok('a linked folder lists the real resumes and not the copies', got.state.resumes.length === ex.resumes.length, `${got.state.resumes.length} vs ${ex.resumes.length}`);
  ok('and names each skipped copy, twice over: in skipped and in the warnings', got.skipped.length === 2 && got.skipped.every(n => got.warnings.some(w => w.includes(n))));
}

section('the overwrite guard on a linked folder');
{
  const c = clock();
  const ex = example();
  const store = createStore({ ...ex, cur: null, openId: null }, { now: c.now });
  const folder = memoryFolder();
  const p = createPersist({ store, backend: memoryBackend(), folder, now: c.date, setTimer: c.setTimer, clearTimer: c.clearTimer });
  await p.link(folder);
  const first = folder._files.get('resume-data.json');
  ok('linking writes the record', typeof first === 'string' && first.length > 100);
  store.commit(d => { d.record.basics.label = 'Mine'; }, 'edit');
  await c.tick();
  ok('a normal change is written', JSON.parse(folder._files.get('resume-data.json')).basics.label === 'Mine' && p.status.status === 'saved');
  const outside = folder._files.get('resume-data.json').replace('"Mine"', '"Changed by hand"');
  folder._files.set('resume-data.json', outside);
  store.commit(d => { d.record.basics.label = 'Mine again'; }, 'edit');
  await c.tick();
  ok('a file changed outside the app is not written over', folder._files.get('resume-data.json') === outside);
  ok('the save state says so, with a code the screen can act on', p.status.status === 'error' && p.status.code === 'folder-changed' && /memory/.test(p.status.error));
  const cmp = await p.compareFolder();
  ok('the compare view can read what is on disk', !cmp.same && cmp.disk.record.basics.label === 'Changed by hand');
  store.commit(d => { d.record.basics.label = 'And again'; }, 'edit');
  await c.tick();
  ok('and it keeps refusing while the file is unchanged since', folder._files.get('resume-data.json') === outside && p.status.code === 'folder-changed');
  await p.overwriteFolder();
  ok('only when the person says so is it overwritten', JSON.parse(folder._files.get('resume-data.json')).basics.label === 'And again');
  store.commit(d => { d.record.basics.label = 'After'; }, 'edit');
  await c.tick();
  ok('and then saving works again', JSON.parse(folder._files.get('resume-data.json')).basics.label === 'After' && p.status.status === 'saved');
  // a touched-up lastModified alone must not matter, only the content: the same text written by someone else is fine
  const same = folder._files.get('resume-data.json');
  folder._files.set('resume-data.json', same);
  store.commit(d => { d.record.basics.label = 'Last'; }, 'edit');
  await c.tick();
  ok('the same content (a touched file) does not stop it', JSON.parse(folder._files.get('resume-data.json')).basics.label === 'Last');
  const q = clock();
  const folder2 = memoryFolder({ 'resume-data.json': '{"not":"ours"}' });
  const s2 = createStore({ ...ex, cur: null, openId: null }, { now: q.now });
  const p2 = createPersist({ store: s2, backend: memoryBackend(), folder: folder2, now: q.date, setTimer: q.setTimer, clearTimer: q.clearTimer });
  s2.commit(d => { d.record.basics.label = 'X'; }, 'edit');
  await q.tick();
  ok('a folder never read or written by this session is not overwritten either', folder2._files.get('resume-data.json') === '{"not":"ours"}' && p2.status.code === 'folder-changed');
}

section('scripts/onefile.mjs');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brewcv-onefile-'));
  const run = (...args) => spawnSync(process.execPath, [path.join(REPO, 'scripts/onefile.mjs'), ...args], { encoding: 'utf8' });
  try {
    const ex = example();
    ensureRecordId(ex.record);
    const dir1 = path.join(tmp, 'data1');
    for (const [p, t] of filesOf(ex)){ fs.mkdirSync(path.dirname(path.join(dir1, p)), { recursive: true }); fs.writeFileSync(path.join(dir1, p), t); }
    fs.writeFileSync(path.join(dir1, 'recipes', 'Ferro Tools - Manufacturing Engineer.sync-conflict-20261010-123456-ABCDEFG.json'), '{"junk":true}');
    const f1 = path.join(tmp, 'one.json');
    const a = run('pack', dir1, f1);
    ok('pack runs', a.status === 0, a.stderr);
    ok('it names the conflict copy it skipped', /sync-conflict-20261010-123456-ABCDEFG/.test(a.stderr) && /skipped 1/.test(a.stdout), a.stderr + a.stdout);
    const one = JSON.parse(fs.readFileSync(f1, 'utf8'));
    ok('the file is the app’s format, with every saved resume and no checkpoints', detect(one) === 'backup' && one.resumes.length === ex.resumes.length && !('checkpoints' in one) && one.recordId === ex.record.recordId);
    const again = run('pack', dir1, f1);
    ok('pack will not replace a file without --force', again.status === 1 && /--force/.test(again.stderr));
    const dir2 = path.join(tmp, 'data2');
    const b = run('unpack', f1, dir2);
    ok('unpack runs', b.status === 0, b.stderr);
    const names = fs.readdirSync(path.join(dir2, 'recipes')).sort();
    ok('it writes the record and every saved resume as files', fs.existsSync(path.join(dir2, 'resume-data.json')) && names.length === ex.resumes.length);
    const dir2b = run('unpack', f1, dir2);
    ok('unpack will not write into a folder with things in it', dir2b.status === 1 && /not empty/.test(dir2b.stderr));
    ok('unless told to', run('unpack', f1, dir2, '--force').status === 0);
    const f2 = path.join(tmp, 'two.json');
    ok('pack again', run('pack', dir2, f2).status === 0);
    const x = JSON.parse(fs.readFileSync(f1, 'utf8')), y = JSON.parse(fs.readFileSync(f2, 'utf8'));
    x.saved = y.saved = 'same';
    ok('pack, unpack, pack: the same bytes except the saved date', text(x) === text(y));
    // the folder form the app writes opens as the same thing
    const viaFolder = await readFolder(memoryFolder(Object.fromEntries(filesOf(readBackup(one).state))));
    ok('and the folder reads back through the app’s own code', viaFolder.state.resumes.length === ex.resumes.length);
    ok('a folder with no record is refused', run('pack', path.join(tmp, 'nothing'), path.join(tmp, 'x.json')).status === 1);
    ok('so is a bad command', run('squash', 'a', 'b').status === 2);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

console.log(failed ? `\n${failed} save-file check(s) FAILED` : '\nall save-file checks passed');
process.exit(failed ? 1 : 0);
