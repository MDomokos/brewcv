// Where the state lives between sessions: browser storage (autosave after every
// change), plus an optional linked folder that mirrors it. Only changed files are
// written, and a declined permission just stops the mirror.

import { t, keyed } from '../i18n/index.js';
import { save, serialize, load, saveResume, loadResume, detect, resumeFileName } from '../model/schema.js';
import { assetRefs } from './store.js';

export const AUTO_KINDS = new Set(['import', 'merge', 'replace', 'restore', 'first-save']);
export const AUTO_KEEP = 50;
const BACKUP_NUDGE_MS = 7 * 24 * 3600 * 1000;

export function memoryBackend(seed = []){
  const m = new Map(seed);
  return {
    async get(k){ return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async put(k, v){ m.set(k, structuredClone(v)); },
    async delete(k){ m.delete(k); },
    async list(prefix = ''){ return [...m.keys()].filter(k => k.startsWith(prefix)).sort(); },
    _map: m,
  };
}

// Version 2 added `kv` beside `handles`, so a folder handle saved by older builds survives.
export const DB_NAME = 'resume-builder', DB_VERSION = 2;
export function openDb(idb = globalThis.indexedDB){
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function idbBackend(idb = globalThis.indexedDB, store = 'kv'){
  const tx = async (mode, fn) => {
    const db = await openDb(idb);
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    get: k => tx('readonly', s => s.get(k)),
    put: (k, v) => tx('readwrite', s => s.put(v, k)),
    delete: k => tx('readwrite', s => s.delete(k)),
    list: async (prefix = '') => {
      const keys = await tx('readonly', s => s.getAllKeys());
      return keys.filter(k => typeof k === 'string' && k.startsWith(prefix)).sort();
    },
  };
}

export function memoryFolder(seed = {}){
  const files = new Map(Object.entries(seed));
  return {
    async read(p){ return files.has(p) ? files.get(p) : null; },
    async write(p, text){ files.set(p, text); },
    async list(dir){ const pre = dir.replace(/\/?$/, '/'); return [...files.keys()].filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(k => k.slice(pre.length)).sort(); },
    async permission(){ return 'granted'; },
    async remove(p){ files.delete(p); },
    name: 'memory',
    _files: files,
  };
}

// permission(true) asks; permission() only checks.
export function fsaFolder(dir){
  const walk = async (p, create) => {
    const parts = p.split('/');
    let d = dir;
    for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create });
    return { d, name: parts.at(-1) };
  };
  return {
    name: dir.name,
    handle: dir,
    async permission(ask = false){
      const q = await dir.queryPermission?.({ mode: 'readwrite' });
      if (q === 'granted' || !ask) return q ?? 'prompt';
      return dir.requestPermission({ mode: 'readwrite' });
    },
    async read(p){
      try { const { d, name } = await walk(p, false); return await (await (await d.getFileHandle(name)).getFile()).text(); }
      catch { return null; }
    },
    async list(sub){
      try {
        let d = dir;
        for (const seg of sub.split('/').filter(Boolean)) d = await d.getDirectoryHandle(seg);
        const out = [];
        for await (const [name, h] of d.entries()) if (h.kind === 'file') out.push(name);
        return out.sort();
      } catch { return []; }
    },
    async write(p, text){
      const { d, name } = await walk(p, true);
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(text); await w.close();
    },
    async remove(p){
      try { const { d, name } = await walk(p, false); await d.removeEntry(name); } catch { /* already gone */ }
    },
  };
}

// a saved resume's `id` is its file name, not part of what the file says
const stripId = r => { const c = { ...r }; delete c.id; return c; };
export function filesOf(state){
  const out = new Map();
  if (state?.record) out.set('resume-data.json', serialize(save(state.record)));
  const used = new Set();
  for (const r of state?.resumes ?? []){
    let name = resumeFileName(r), n = 2;
    while (used.has(name.toLowerCase())) name = resumeFileName(r).replace(/\.json$/, ` ${n++}.json`);
    used.add(name.toLowerCase());
    out.set(`recipes/${name}`, serialize(saveResume(state.record, stripId(r), state.frozen?.[r.id] ?? null).file));
  }
  return out;
}

export function makeBackup(state, { saved = new Date().toISOString(), checkpoints } = {}){
  return {
    resumeBuilderBackup: 1,
    saved,
    record: save(state.record),
    resumes: (state.resumes ?? []).map(r => saveResume(state.record, stripId(r), state.frozen?.[r.id] ?? null).file),
    ...(checkpoints ? { checkpoints } : {}),
  };
}

// recipes/ may hold v4 resume files and v3 recipes alike.
export async function readFolder(folder){
  const text = await folder.read('resume-data.json');
  if (text === null) return null;
  const { model, warnings } = load(JSON.parse(text));
  const resumes = [], frozen = {};
  for (const name of await folder.list('recipes')){
    if (!name.endsWith('.json')) continue;
    try {
      const got = loadResume(JSON.parse(await folder.read(`recipes/${name}`)), model);
      resumes.push({ ...got.recipe, id: name });
      if (got.frozen) frozen[name] = got.frozen;
    }
    catch (e){ warnings.push(`recipes/${name}: ${e.message}`); }
  }
  return { state: { record: model, resumes, frozen, cur: resumes[0] ? structuredClone(resumes[0]) : null, openId: resumes[0]?.id ?? null }, warnings };
}

export function readBackup(obj){
  if (detect(obj) !== 'backup') throw keyed('error.notBackup');
  const { model, warnings } = load(obj.record);
  const resumes = [], frozen = {};
  for (const f of obj.resumes ?? []){
    const got = loadResume(f, model);
    const id = uniqueName(resumes, got.recipe);
    resumes.push({ ...got.recipe, id });
    if (got.frozen) frozen[id] = got.frozen;
  }
  return { state: { record: model, resumes, frozen, cur: resumes[0] ? structuredClone(resumes[0]) : null, openId: resumes[0]?.id ?? null }, warnings };
}

function uniqueName(list, recipe){
  const base = resumeFileName(recipe);
  let id = base, n = 2;
  while (list.some(r => r.id.toLowerCase() === id.toLowerCase())) id = base.replace(/\.json$/, ` ${n++}.json`);
  return id;
}

const fileStamp = iso => iso.replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
const safe = s => String(s).replace(/[^\p{L}\p{N} _.,()-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'checkpoint';

export function createPersist({ store, backend = memoryBackend(), folder = null, debounceMs = 400,
  now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout } = {}){
  let timer = null, waiters = [], status = 'idle', lastError = null;
  let linked = folder;
  const written = new Map();          // path → text last written to the folder
  const statusSubs = new Set();
  const setStatus = (s, err = null) => { status = s; lastError = err; for (const fn of statusSubs) fn({ status, error: err }); };

  async function saveNow(){
    clearTimer(timer); timer = null;
    setStatus('saving');
    try {
      const state = store.state;
      // assets first, then the state that points at them
      for (const ref of assetRefs(state))
        if ((await backend.get(`asset/${ref}`)) === undefined) await backend.put(`asset/${ref}`, store.asset(ref));
      await backend.put('state/current', { savedAt: now().toISOString(), state });
      const mirrored = linked ? await writeFolder() : [];
      if (mirrored) setStatus('saved');     // null: the folder refused and writeFolder set the error
    } catch (e){ setStatus('error', e.message); }
    for (const w of waiters.splice(0)) w();
  }

  async function writeFolder(){
    if ((await linked.permission()) !== 'granted'){ setStatus('error', 'not writing to disk: the folder needs permission again'); return null; }
    const files = filesOf(store.materialize());
    const out = [];
    for (const [p, text] of files){
      if (written.get(p) === text) continue;
      await linked.write(p, text);
      written.set(p, text);
      out.push(p);
    }
    // a renamed or deleted resume: remove its old file, but only one written since the folder was
    // linked, so a file put there by hand is never deleted
    for (const p of [...written.keys()]) if (p.startsWith('recipes/') && !files.has(p) && linked.remove){
      await linked.remove(p);
      written.delete(p);
      out.push(`-${p}`);
    }
    return out;
  }

  const unsub = store.subscribe(() => {
    clearTimer(timer);
    timer = setTimer(saveNow, debounceMs);
  });

  async function addCheckpoint(label, kind = 'manual'){
    const at = now().toISOString();
    const id = `c-${at}-${Math.random().toString(36).slice(2, 7)}`;
    const state = store.materialize();
    await backend.put(`checkpoint/${id}`, { id, label, kind, at, state });
    const index = (await backend.get('checkpoints/index')) ?? [];
    index.unshift({ id, label, kind, at });
    // automatic checkpoints are capped; manual ones are never pruned
    const autos = index.filter(c => AUTO_KINDS.has(c.kind));
    for (const c of autos.slice(AUTO_KEEP)){
      index.splice(index.indexOf(c), 1);
      await backend.delete(`checkpoint/${c.id}`);
    }
    await backend.put('checkpoints/index', index);
    if (linked && (await linked.permission()) === 'granted')
      await linked.write(`checkpoints/${fileStamp(at)} ${safe(label)}.json`, serialize(makeBackup(state, { saved: at })));
    return id;
  }

  return {
    get status(){ return { status, error: lastError, linked: linked?.name ?? null }; },
    onStatus(fn){ statusSubs.add(fn); return () => statusSubs.delete(fn); },

    async flush(){ if (timer) await saveNow(); else if (status === 'saving') await new Promise(r => waiters.push(r)); },
    stop(){ unsub(); clearTimer(timer); },

    async restore(){
      const saved = await backend.get('state/current');
      if (!saved?.state) return false;
      const refs = assetRefs(saved.state);
      const entries = [];
      for (const ref of refs){ const v = await backend.get(`asset/${ref}`); if (v !== undefined) entries.push([ref, v]); }
      store.loadAssets(entries);
      store.reset(saved.state, 'restore session');
      return true;
    },

    async link(f){
      linked = f;
      written.clear();
      // Before the first write over a resume-data/3 folder, keep the originals once
      // as resume-data.v3.json and recipes-v3/.
      const old = await f.read('resume-data.json');
      let v3 = false;
      try { v3 = old !== null && detect(JSON.parse(old)) === 'library-v3'; } catch {}
      if (v3 && (await f.read('resume-data.v3.json')) === null){
        await f.write('resume-data.v3.json', old);
        for (const name of (await f.list?.('recipes')) ?? []){
          const t = await f.read(`recipes/${name}`);
          if (t !== null && name.endsWith('.json')) await f.write(`recipes-v3/${name}`, t);
        }
      }
      if (f.handle !== undefined) await backend.put('handle/folder', f.handle);
      return writeFolder();
    },
    unlink(){ linked = null; written.clear(); return backend.delete('handle/folder'); },
    rememberedFolder(){ return backend.get('handle/folder'); },
    writeFolder: async () => (linked ? (await writeFolder()) ?? [] : []),

    async compareFolder(f = linked){
      const text = await f.read('resume-data.json');
      if (text === null) return { same: false, disk: null };
      const mine = filesOf(store.materialize()).get('resume-data.json');
      if (text === mine) return { same: true, disk: null };
      try { return { same: false, disk: { record: load(JSON.parse(text)).model } }; }
      catch (e){ return { same: false, disk: null, error: e.message }; }
    },

    async backup({ checkpoints = false } = {}){
      const cps = checkpoints ? await Promise.all(((await backend.get('checkpoints/index')) ?? [])
        .map(c => backend.get(`checkpoint/${c.id}`))) : undefined;
      await backend.put('meta/lastBackup', now().toISOString());
      return makeBackup(store.materialize(), { saved: now().toISOString(), checkpoints: cps });
    },
    async restoreBackup(obj){
      const { state, warnings } = readBackup(obj);
      await addCheckpoint(t('checkpoint.beforeRestore'), 'restore');
      store.replace(state, t('undo.restoreBackup'));
      return warnings;
    },
    async needsBackupNudge(){
      if (linked) return false;
      const last = await backend.get('meta/lastBackup');
      return !last || now() - new Date(last) > BACKUP_NUDGE_MS;
    },

    checkpoint: addCheckpoint,
    async listCheckpoints(){ return (await backend.get('checkpoints/index')) ?? []; },
    async loadCheckpoint(id){ return backend.get(`checkpoint/${id}`); },
    async restoreCheckpoint(id){
      const c = await backend.get(`checkpoint/${id}`);
      if (!c) throw new Error(`no checkpoint ${id}`);
      await addCheckpoint(t('checkpoint.beforeRestoreX', { label: c.label }), 'restore');
      store.replace(c.state, t('undo.restoreX', { label: c.label }));   // undoable: Ctrl+Z brings the present back
      return c;
    },
    async deleteCheckpoint(id){
      const index = ((await backend.get('checkpoints/index')) ?? []).filter(c => c.id !== id);
      await backend.put('checkpoints/index', index);
      await backend.delete(`checkpoint/${id}`);
    },
  };
}

// Ask the browser not to clear this origin's storage under pressure.
export async function requestPersistence(nav = globalThis.navigator){
  try { return (await nav?.storage?.persisted?.()) || (await nav?.storage?.persist?.()) || false; }
  catch { return false; }
}
