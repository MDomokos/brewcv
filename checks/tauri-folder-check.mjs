#!/usr/bin/env node
// node checks/tauri-folder-check.mjs
// The desktop app's folder (tauriFolder in src/store/persist.js) against a fake window.__TAURI__: an in-memory disk with a
// scope (only paths under a picked folder work, as with the fs plugin). Fictional data only; nothing is written.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../src/model/schema.js';
import * as RS from '../src/model/resumes.js';
import { createPersist, memoryBackend, readFolder, tauriApi, tauriFolder, folderOf } from '../src/store/persist.js';
import { createStore } from '../src/store/store.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);

// files: path -> text; dirs: set of paths; scope: folders the dialog granted. Calls outside the scope throw, like the plugin.
function fakeTauri(files = {}, dirs = []){
  const disk = new Map(Object.entries(files)), d = new Set(dirs), scope = new Set(), log = [];
  const guard = p => { if (![...scope].some(s => p === s || p.startsWith(s + '/'))) throw new Error(`forbidden path: ${p}`); };
  const T = {
    _disk: disk, _dirs: d, _scope: scope, _log: log, _picked: null,
    dialog: { async open(o){ log.push(['open', o]); if (T._picked) scope.add(T._picked); return T._picked; } },
    fs: {
      async exists(p){ guard(p); return d.has(p) || disk.has(p); },
      async readTextFile(p){ guard(p); if (!disk.has(p)) throw new Error('No such file'); return disk.get(p); },
      async writeTextFile(p, t){ guard(p); if (!d.has(p.slice(0, p.lastIndexOf('/')))) throw new Error('No such directory'); disk.set(p, t); },
      async mkdir(p, o){ guard(p); log.push(['mkdir', p, o]); d.add(p); },
      async remove(p){ guard(p); if (!disk.delete(p)) throw new Error('No such file'); },
      async readDir(p){
        guard(p); if (!d.has(p)) throw new Error('No such directory');
        return [...disk.keys()].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'))
          .map(k => ({ name: k.slice(p.length + 1), isFile: true, isDirectory: false, isSymlink: false }))
          .concat([...d].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map(k => ({ name: k.slice(p.length + 1), isFile: false, isDirectory: true, isSymlink: false })));
      },
    },
  };
  return T;
}
const instant = { debounceMs: 0, setTimer: fn => { fn(); return 0; }, clearTimer: () => {} };

const model = S.load(read('data/example.json')).model;
const names = read('data/example-resumes/index.json');
function exampleState(){
  const resumes = [], frozen = {};
  for (const n of names.slice(0, 2)){ const got = S.loadResume(read(`data/example-resumes/${n}`), model); resumes.push({ ...got.recipe, id: n }); frozen[n] = got.frozen; }
  const st = { record: structuredClone(model), resumes, frozen, cur: null, openId: null };
  RS.openSaved(st, resumes[0].id);
  return st;
}

section('detecting the desktop app');
ok('no window.__TAURI__ (a browser): not the desktop app', tauriApi(undefined) === null);
ok('fs without dialog is not enough', tauriApi({ fs: {} }) === null);
const T = fakeTauri({}, ['/Users/x/CV']);
ok('fs and dialog: the desktop app', tauriApi(T) === T);

section('the folder object');
T._picked = '/Users/x/CV';
const dir = await T.dialog.open({ directory: true, recursive: true });
const f = tauriFolder(dir, T);
ok('the name is the folder\'s own name', f.name === 'CV');
ok('the handle kept for next launch is the path', f.handle === '/Users/x/CV');
ok('a granted, existing path is granted without asking', (await f.permission(false)) === 'granted' && (await f.permission(true)) === 'granted');
ok('a missing file reads as null', (await f.read('resume-data.json')) === null);
await f.write('recipes/a.json', 'A');
ok('write makes the directory it needs, then the file', T._dirs.has('/Users/x/CV/recipes') && T._disk.get('/Users/x/CV/recipes/a.json') === 'A' && T._log.some(l => l[0] === 'mkdir' && l[2]?.recursive));
ok('read gives it back', (await f.read('recipes/a.json')) === 'A');
ok('list gives file names, sorted, and no directories', JSON.stringify(await f.list('recipes')) === '["a.json"]' && !(await f.list('')).includes('recipes'));
ok('list of a missing directory is empty', (await f.list('nope')).length === 0);
await f.remove('recipes/a.json'); await f.remove('recipes/a.json');
ok('remove deletes, and a file already gone is fine', !T._disk.has('/Users/x/CV/recipes/a.json'));
ok('a trailing slash on the path changes nothing', (await tauriFolder('/Users/x/CV/', T).read('nothing')) === null && tauriFolder('/Users/x/CV/', T).name === 'CV');
ok('folderOf takes a path for the desktop and a handle for the browser', folderOf('/Users/x/CV', T).handle === '/Users/x/CV' && typeof folderOf({ name: 'h' }).read === 'function');

section('link, edit, read back');
{
  const T2 = fakeTauri({}, ['/D']); T2._picked = '/D'; await T2.dialog.open({});
  const folder = tauriFolder('/D', T2);
  const st = exampleState(), store = createStore(st);
  const backend = memoryBackend();
  const p = createPersist({ store, backend, ...instant });
  await p.link(folder);
  const listed = await folder.list('recipes');
  ok('link writes resume-data.json and one recipe per saved resume', T2._disk.has('/D/resume-data.json') && listed.length === st.resumes.length, listed.join(' | '));
  ok('link keeps the path for the next launch', (await p.rememberedFolder()) === '/D');
  const back = await readFolder(folderOf(await p.rememberedFolder(), T2));
  ok('readFolder through the remembered path reads them back', back.state.resumes.length === st.resumes.length);
  const id = st.resumes[1].id;
  store.commit(d => { RS.renameSaved(d, id, 'Renamed Co'); }, 'Rename');
  await p.flush();
  const renamed = await folder.list('recipes');
  ok('a rename writes the new file and removes the old one', renamed.length === listed.length && !renamed.includes(id) && renamed.includes('Renamed Co.json'), renamed.join(' | '));
  store.commit(d => { RS.deleteSaved(d, 'Renamed Co.json'); }, 'Delete');
  await p.flush();
  const after = await folder.list('recipes');
  ok('deleting a saved resume removes its file', after.length === listed.length - 1 && !after.includes('Renamed Co.json'), after.join(' | '));
  await p.unlink();
  ok('unlink forgets the path', (await p.rememberedFolder()) === undefined);
}

section('accents in file names');
{
  const nfc = 'Ingénieure conception', nfd = nfc.normalize('NFD');
  const T2 = fakeTauri({}, ['/D']); T2._picked = '/D'; await T2.dialog.open({});
  const folder = tauriFolder('/D', T2);
  const st = exampleState(), store = createStore(st);
  const p = createPersist({ store, backend: memoryBackend(), ...instant });
  await p.link(folder);
  store.commit(d => { RS.duplicate(d, names[0], { name: nfc }); }, 'Save');
  await p.flush();
  const text = T2._disk.get(`/D/recipes/${nfc}.json`);
  ok('the composed file is on disk', text !== undefined);
  T2._disk.delete(`/D/recipes/${nfc}.json`); T2._disk.set(`/D/recipes/${nfd}.json`, text);
  const got = await readFolder(folder);
  ok('a decomposed name on disk opens under the composed id', got.state.resumes.some(r => r.id === `${nfc}.json`));
  T2._disk.set(`/D/recipes/${nfc}.json`, text);
  const both = await readFolder(folder);
  const p2 = createPersist({ store: createStore(both.state), backend: memoryBackend(), ...instant });
  await p2.link(folder);
  const gone = await p2.dropMerged(both.leftovers);
  ok('dropMerged removes the other spelling through the plugin', gone.includes(`${nfd}.json`) && !T2._disk.has(`/D/recipes/${nfd}.json`) && T2._disk.has(`/D/recipes/${nfc}.json`));
}

section('a folder that is gone, or no longer granted');
{
  const T2 = fakeTauri({}, ['/D']); T2._picked = '/D'; await T2.dialog.open({});
  const f2 = tauriFolder('/D', T2);
  T2._dirs.delete('/D');
  ok('a folder deleted or moved since: prompt, so the reconnect row shows', (await f2.permission(false)) === 'prompt');
  const T3 = fakeTauri({}, ['/E']);
  ok('a path the plugin does not allow (scope lost): prompt, not an error', (await tauriFolder('/E', T3).permission(false)) === 'prompt');
  ok('…and reading it gives null, listing gives nothing', (await tauriFolder('/E', T3).read('resume-data.json')) === null && (await tauriFolder('/E', T3).list('recipes')).length === 0);
  let threw = false; try { await tauriFolder('/E', T3).write('x.json', '1'); } catch { threw = true; }
  ok('…and a write is refused loudly (the save shows its error)', threw);
  T3._picked = null;
  ok('cancelling the dialog gives no folder', (await T3.dialog.open({ directory: true })) === null);
}
section('linking a folder that already holds the same files');
{
  const T4 = fakeTauri({}, ['/E']); T4._picked = '/E'; await T4.dialog.open({});
  const folder = tauriFolder('/E', T4);
  const st = exampleState(), store = createStore(st);
  const first = await createPersist({ store, backend: memoryBackend(), ...instant }).link(folder);
  ok('the first link writes every file', first.length === st.resumes.length + 1, String(first.length));
  const again = createPersist({ store, backend: memoryBackend(), ...instant });
  ok('linking the same folder again writes nothing (no new modification times for a sync tool to carry about)', (await again.link(folder)).length === 0);
  const id = st.resumes[0].id;
  store.commit(d => { d.resumes.find(r => r.id === id).pageLimit = 2; }, 'x');
  await again.flush();
  T4._disk.set('/E/recipes/' + id, 'changed elsewhere');
  const third = await createPersist({ store, backend: memoryBackend(), ...instant }).link(folder);
  ok('a file that differs on disk is written again, and only that one', third.length === 1 && third[0] === 'recipes/' + id, third.join(' | '));
}
process.exit(failed ? 1 : 0);
