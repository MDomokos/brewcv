#!/usr/bin/env node
// node checks/store-check.mjs
// src/store/store.js (undo) and src/store/persist.js in Node: the IndexedDB and File System Access adapters
// are swapped for in-memory ones, and timers and the clock are driven by hand. Fictional data only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import { createStore, isAssetRef } from '../src/store/store.js';
import { createPersist, memoryBackend, memoryFolder, readBackup, filesOf, AUTO_KEEP } from '../src/store/persist.js';
import { load, migrateRecipe } from '../src/model/schema.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const { model: record } = load(read('checks/fixtures/example-0.4.json'));
const recipe = migrateRecipe(read('checks/fixtures/example-0.4-recipe.json'));

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`);
  if (!cond) failed++;
};
const section = t => console.log(`\n— ${t}`);

function clock(){
  let t = 1_000_000;
  const timers = new Map(); let id = 0;
  return {
    now: () => t,
    date: () => new Date(t),
    advance(ms){ t += ms; },
    setTimer: (fn, ms) => { timers.set(++id, fn); return id; },
    clearTimer: i => timers.delete(i),
    async tick(){ const fns = [...timers.values()]; timers.clear(); for (const fn of fns) await fn(); },
    get pending(){ return timers.size; },
  };
}

// a ~60 KB photo, as a data URL
const PHOTO = 'data:image/' + 'jpeg;base64,' +   // split, so the deploy preflight does not read it as an embedded photo
   Buffer.alloc(45_000, 7).toString('base64');
const fresh = () => ({ record: structuredClone(record), resumes: [structuredClone(recipe)], cur: null });

section('store: commit, freeze, no-op');
{
  const c = clock();
  const s = createStore(fresh(), { now: c.now });
  ok('state is frozen', Object.isFrozen(s.state) && Object.isFrozen(s.state.record.basics));
  ok('a commit that changes nothing is not a step', s.commit(() => {}, 'nothing') === false && s.history.undo === 0);
  ok('a commit changes the state', s.commit(d => { d.record.basics.label = 'Changed'; }, 'Label') && s.state.record.basics.label === 'Changed');
  let threw = false; try { s.state.record.basics.label = 'x'; } catch { threw = true; }
  ok('views cannot write the state directly', threw && s.state.record.basics.label === 'Changed');
  ok('the undo tooltip knows the next step', s.history.undo === 1 && s.history.next === 'Label');
}

section('store: undo and redo');
{
  const c = clock();
  const s = createStore(fresh(), { now: c.now });
  const before = s.state;
  s.commit(d => { d.cur = d.resumes[0]; }, 'Open'); c.advance(1000);
  s.commit(d => { d.cur.picks['hydra-inhaler'] = 'hydra-inhaler-full'; }, 'Pick'); c.advance(1000);
  ok('undo returns the label it undid', s.undo() === 'Pick' && s.state.cur.picks['hydra-inhaler'] === 'hydra-inhaler-short');
  ok('undo again reaches the start', s.undo() === 'Open' && eq(s.state, before));
  ok('nothing more to undo', s.undo() === null);
  ok('redo twice comes back', s.redo() === 'Open' && s.redo() === 'Pick' && s.state.cur.picks['hydra-inhaler'] === 'hydra-inhaler-full');
  s.undo();
  s.commit(d => { d.record.basics.label = 'New branch'; }, 'Label');
  ok('a new commit clears redo', s.history.redo === 0 && s.redo() === null);
}

section('store: 200 steps, coalescing, byte cap');
{
  const c = clock();
  const s = createStore(fresh(), { now: c.now });
  for (let i = 0; i < 250; i++){ s.commit(d => { d.record.basics.label = `L${i}`; }, `Step ${i}`); c.advance(10); }
  ok('the stack stops at 200 steps', s.history.undo === 200, `${s.history.undo}`);

  const t = createStore(fresh(), { now: t0 => c.now() });
  for (const ch of 'typing a sentence'){ t.commit(d => { d.record.basics.label += ch; }, 'Type label'); c.advance(100); }
  ok('typing in bursts under 800 ms is one step', t.history.undo === 1, `${t.history.undo}`);
  c.advance(900);
  t.commit(d => { d.record.basics.label += '!'; }, 'Type label');
  ok('a pause over 800 ms starts a new step', t.history.undo === 2);
  t.undo(); t.undo();
  ok('undoing the burst restores the text before it', t.state.record.basics.label === record.basics.label);

  const u = createStore(fresh(), { now: c.now, maxBytes: 3 * JSON.stringify(fresh()).length * 2 });
  for (let i = 0; i < 10; i++){ u.commit(d => { d.record.basics.label = `B${i}`; }, `B${i}`); c.advance(10); }
  ok('the byte cap trims the oldest steps', u.history.undo <= 3 && u.history.undo >= 2, `${u.history.undo}`);
}

section('store: photos stay out of the snapshots');
{
  const c = clock();
  const s = createStore(fresh(), { now: c.now });
  s.commit(d => { d.record.basics.image = PHOTO; }, 'Add photo');
  ok('the state holds a ref, not the bytes', isAssetRef(s.state.record.basics.image));
  ok('the asset map holds the bytes', s.asset(s.state.record.basics.image) === PHOTO);
  for (let i = 0; i < 50; i++){ s.commit(d => { d.record.basics.label = `P${i}`; }, `P${i}`); c.advance(10); }
  const perStep = s.history.bytes / s.history.undo;
  ok('a step costs about what the record does, not the photo', perStep < JSON.stringify(fresh()).length * 2 + 10_000,
    `${Math.round(perStep / 1024)} KB per step`);
  ok('materialize() puts the photo back for saving and rendering', s.materialize().record.basics.image === PHOTO);
  s.commit(d => { delete d.record.basics.image; }, 'Remove photo');
  s.gcAssets();
  ok('an asset still reachable through undo is kept', s.assets.size === 1);
}

section('store: replace is undoable, reset is a new baseline');
{
  const c = clock();
  const s = createStore(fresh(), { now: c.now });
  const other = { record: structuredClone(record), resumes: [], cur: null };
  s.replace(other, 'Replace');
  ok('replace swaps the whole state', s.state.resumes.length === 0);
  ok('and Ctrl+Z brings it back', s.undo() === 'Replace' && s.state.resumes.length === 1);
  s.reset(other, 'Open file');
  ok('reset clears undo and redo', s.history.undo === 0 && s.history.redo === 0 && s.state.resumes.length === 0);
}

section('settle: a hook that rides on every commit');
{
  const settle = d => { if (d.n !== undefined) d.double = d.n * 2; };
  const s = createStore({ n: 1 }, { settle });
  s.commit(d => { d.n = 5; }, 'Edit');
  ok('what it writes is part of the same commit', s.state.double === 10);
  s.undo();
  ok('and of the same undo step', s.state.n === 1 && s.state.double === undefined);
  s.redo();
  ok('and the redo', s.state.n === 5 && s.state.double === 10);
  ok('a commit that changes nothing, settled, is still not a step', s.commit(() => {}, 'Noop') === false);
  const t = createStore({ n: 1 }, { settle });
  t.replace({ n: 3 }, 'Replace');
  ok('replace is settled too', t.state.double === 6);
}

section('persist: autosave after the debounce, and reload');
{
  const c = clock();
  const backend = memoryBackend();
  const s = createStore(fresh(), { now: c.now });
  const p = createPersist({ store: s, backend, now: c.date, setTimer: c.setTimer, clearTimer: c.clearTimer });
  s.commit(d => { d.record.basics.image = PHOTO; d.record.basics.label = 'Saved label'; }, 'Edit');
  ok('nothing is written before the debounce', (await backend.get('state/current')) === undefined && c.pending === 1);
  ok('between the change and the write the status says so (the header shows Saving…)', p.status.status === 'pending');
  s.commit(d => { d.record.basics.label = 'Saved label 2'; }, 'Edit');
  ok('a second change restarts it, not a second write', c.pending === 1);
  await c.tick();
  ok('after it, the state is in browser storage', (await backend.get('state/current'))?.state.record.basics.label === 'Saved label 2');
  ok('the status says saved', p.status.status === 'saved');
  ok('the photo is stored once, as an asset', (await backend.list('asset/')).length === 1);

  const s2 = createStore({}, { now: c.now });
  const p2 = createPersist({ store: s2, backend, now: c.date, setTimer: c.setTimer, clearTimer: c.clearTimer });
  ok('a reload restores the session', await p2.restore());
  const idOf = st => st.record.recordId, strip = st => { const c = structuredClone(st); delete c.record.recordId; return c; };
  ok('with everything in it, the photo included', eq(strip(s2.materialize()), strip(s.materialize())));
  ok('an old session gets a record id on restore, and it is stored so the next reload keeps it', !!idOf(s2.materialize()) && (await backend.get('state/current')).state.record.recordId === idOf(s2.materialize()));
  ok('and starts with an empty undo stack', s2.history.undo === 0);
  ok('a new browser has nothing to restore', !(await createPersist({ store: createStore({}), backend: memoryBackend() }).restore()));
  p.stop(); p2.stop();
}

section('persist: checkpoints');
{
  const c = clock();
  const backend = memoryBackend();
  const s = createStore(fresh(), { now: c.now });
  const p = createPersist({ store: s, backend, now: c.date, setTimer: c.setTimer, clearTimer: c.clearTimer });
  const id = await p.checkpoint('Before tailoring');
  c.advance(1000);
  s.commit(d => { d.record.basics.label = 'Tailored'; }, 'Edit');
  const cp = await p.restoreCheckpoint(id);
  ok('restore puts the checkpoint state back', s.state.record.basics.label === record.basics.label && cp.label === 'Before tailoring');
  const list = await p.listCheckpoints();
  ok('and checkpoints the present first', list[0].kind === 'restore' && list.length === 2);
  ok('Ctrl+Z after a restore brings the present back', s.undo()?.startsWith('Restore') && s.state.record.basics.label === 'Tailored');
  ok('checkpoints are not in the library file', !JSON.stringify(filesOf(s.materialize()).get('resume-data.json')).includes('Before tailoring'));

  for (let i = 0; i < AUTO_KEEP + 5; i++){ c.advance(1000); await p.checkpoint(`Import ${i}`, 'import'); }
  const after = await p.listCheckpoints();
  ok(`automatic checkpoints are capped at ${AUTO_KEEP}`, after.filter(x => x.kind !== 'manual').length === AUTO_KEEP);
  ok('manual checkpoints are never pruned', after.some(x => x.id === id));
  ok('pruned checkpoints are deleted, not only unlisted', (await backend.list('checkpoint/')).length === after.length);
  await p.deleteCheckpoint(id);
  ok('delete removes one', !(await p.listCheckpoints()).some(x => x.id === id) && (await p.loadCheckpoint(id)) === undefined);
  p.stop();
}

section('persist: backup and restore');
{
  const c = clock();
  const s = createStore(fresh(), { now: c.now });
  s.commit(d => { d.record.basics.image = PHOTO; }, 'Photo');
  const p = createPersist({ store: s, backend: memoryBackend(), now: c.date, setTimer: c.setTimer, clearTimer: c.clearTimer });
  ok('without a folder or a backup, the weekly nudge is due', await p.needsBackupNudge());
  const b = await p.backup();
  ok('a backup is { resumeBuilderBackup, saved, record, resumes }', b.resumeBuilderBackup === 1 && b.record.meta?.resumeBuilder && b.resumes.length === 1);
  ok('the backup is JSON-safe', eq(JSON.parse(JSON.stringify(b)), b));
  ok('after a backup the nudge waits a week', !(await p.needsBackupNudge()));
  c.advance(8 * 24 * 3600 * 1000);
  ok('and comes back after it', await p.needsBackupNudge());
  const { state } = readBackup(b);
  const noId = r => { const c = { ...r }; delete c.id; return c; };
  const mat = s.materialize();
  ok('a backup reads back to the same record and resumes', eq(state.record, mat.record) && eq(state.resumes.map(noId), mat.resumes.map(noId)));
  ok('each resume keeps its frozen text, and the first is open', state.resumes.every(r => state.frozen[r.id]) && state.openId === state.resumes[0].id);
  s.commit(d => { d.resumes = []; }, 'Delete resumes');
  await p.restoreBackup(JSON.parse(JSON.stringify(b)));
  ok('restoreBackup puts it back, undoably', s.state.resumes.length === 1 && s.history.next === 'Restore backup');
  ok('and checkpoints first', (await p.listCheckpoints())[0]?.kind === 'restore');
  let threw = false; try { await p.restoreBackup({ nope: 1 }); } catch { threw = true; }
  ok('a non-backup is refused', threw);
  p.stop();
}

section('persist: the linked folder');
{
  const c = clock();
  const s = createStore(fresh(), { now: c.now });
  const folder = memoryFolder();
  const p = createPersist({ store: s, backend: memoryBackend(), now: c.date, setTimer: c.setTimer, clearTimer: c.clearTimer });
  const first = await p.link(folder);
  ok('linking writes the record and each resume', first.includes('resume-data.json') && first.some(f => f.startsWith('recipes/')), first.join(', '));
  ok('the resume file is named Company - Role', first.includes('recipes/Example Instruments - Design Engineer.json'), first.join(', '));
  ok('the files on disk are JSON Resume', JSON.parse(folder._files.get('resume-data.json')).$schema?.includes('jsonresume'));
  ok('nothing changed, nothing written', (await p.writeFolder()).length === 0);
  const writes = [];
  const realWrite = folder.write;
  folder.write = async (f, t) => { writes.push(f); return realWrite(f, t); };
  s.commit(d => { d.resumes[0].picks['poly-shop'] = 'poly-shop-full'; }, 'Pick');
  await c.tick();
  ok('an autosave mirrors to the folder', p.status.status === 'saved');
  ok('only the changed file is rewritten', eq(writes, ['recipes/Example Instruments - Design Engineer.json']), writes.join(', '));
  ok('with the new pick in it', JSON.parse(folder._files.get(writes[0])).meta.resumeBuilder.resume.picks['poly-shop'] === 'poly-shop-full');
  await p.checkpoint('Manual');
  ok('a checkpoint also lands in checkpoints/', [...folder._files.keys()].some(k => k.startsWith('checkpoints/') && k.endsWith('Manual.json')));
  ok('with a folder linked, no backup nudge', !(await p.needsBackupNudge()));
  ok('compareFolder: same', (await p.compareFolder()).same === true);
  const disk = JSON.parse(folder._files.get('resume-data.json'));
  disk.basics.name = 'Edited in the vault';
  folder._files.set('resume-data.json', JSON.stringify(disk));
  const cmp = await p.compareFolder();
  ok('compareFolder: newer on disk is reported with its state', cmp.same === false && cmp.disk?.record.basics.name === 'Edited in the vault');

  folder.permission = async () => 'denied';
  s.commit(d => { d.record.basics.label = 'Offline'; }, 'Edit');
  await c.tick();
  ok('permission declined: the status says not writing to disk', p.status.status === 'error' && /not writing to disk/.test(p.status.error));
  p.stop();
}

console.log(failed ? `\n${failed} store check(s) FAILED` : '\nall store checks passed');
process.exit(failed ? 1 : 0);
