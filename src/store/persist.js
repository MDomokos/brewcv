// Where the state lives between sessions: browser storage (autosave after every
// change), plus an optional linked folder that mirrors it. Only changed files are
// written, and a declined permission just stops the mirror.

import { t, keyed } from '../i18n/index.js';
import { save, serialize, load, saveResume, loadResume, detect, resumeFileName, nameKey, ensureRecordId } from '../model/schema.js';
import { assetRefs } from './store.js';
import { tick, baseline, opened, floored, foreign, renameActor, cleanClock } from '../model/merge.js';

// The one file you save and open yourself. Never translated.
export const SAVE_FILE_NAME = 'brewcv.json';
// package.json's version, which checks/version-check.mjs keeps equal to it.
export const APP_VERSION = '1.6.2';

export async function sha256(text){
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Copies a sync tool leaves beside a file when two devices wrote at once. They are never read as saved resumes.
export const CONFLICT_PATTERNS = [
  { from: 'Syncthing', re: /\.sync-conflict-\d{8}-\d{6}(?:-[A-Z0-9]+)?(?:\.[^.]+)?$/i },
  { from: 'Dropbox', re: /\((?:[^)]*['’]s )?conflicted copy(?: [^)]*)?\)/i },
  { from: 'iCloud', re: /^(?:brewcv|resume-data) \d+\.json$/i },
];
export const conflictCopy = name => CONFLICT_PATTERNS.find(p => p.re.test(String(name)))?.from ?? null;

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
// Old name, kept: renaming it would orphan saved data.
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

// The desktop app (Tauri) has no showDirectoryPicker. Its fs and dialog plugins stand in; the folder's PATH is the handle kept for the
// next launch (the persisted-scope plugin keeps the permission the dialog gave it). `T` is window.__TAURI__ (a fake in the checks).
export const tauriApi = (T = globalThis.__TAURI__) => (T?.fs && T?.dialog ? T : null);
export function tauriFolder(path, T = tauriApi()){
  const fs = T.fs, at = p => `${path.replace(/[\\/]+$/, '')}/${p}`;
  return {
    name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
    handle: path,
    // no prompt here: a path the plugin still lets us reach is granted; otherwise the person picks the folder again
    async permission(){ try { return (await fs.exists(path)) ? 'granted' : 'prompt'; } catch { return 'prompt'; } },
    async read(p){ try { return await fs.readTextFile(at(p)); } catch { return null; } },
    async list(sub){
      try { return (await fs.readDir(at(sub))).filter(e => e.isFile).map(e => e.name).sort(); } catch { return []; }
    },
    async write(p, text){
      const i = p.lastIndexOf('/');
      if (i > 0) await fs.mkdir(at(p.slice(0, i)), { recursive: true });
      await fs.writeTextFile(at(p), text);
    },
    async remove(p){ try { await fs.remove(at(p)); } catch { /* already gone */ } },
  };
}
// what a remembered handle was: a path (desktop) or a FileSystemDirectoryHandle (browser)
export const folderOf = (h, T) => (typeof h === 'string' ? tauriFolder(h, T) : fsaFolder(h));

// a saved resume's `id` is its file name, not part of what the file says
const stripId = r => { const c = { ...r }; delete c.id; return c; };
// The Library's lists (documents without their bytes, rounds, the import log) are the merged view `library.json`; it is there only when one holds something.
// shortcut: a folder (and a checkpoint file in it) carries documents text-only, since an embedded original is not written out yet; upgrade with the folder layout (I-8: originals as files in Library/<year>/).
export function filesOf(state){
  const out = new Map();
  if (state?.record) out.set('resume-data.json', serialize(save(state.record)));
  const lib = listsOf(state);
  if (lib.documents) lib.documents = textOnly(lib.documents);
  if (Object.keys(lib).length) out.set('library.json', serialize(lib));
  const used = new Set();
  for (const r of state?.resumes ?? []){
    let name = resumeFileName(r), n = 2;
    while (used.has(nameKey(name))) name = resumeFileName(r).replace(/\.json$/, ` ${n++}.json`);
    used.add(nameKey(name));
    out.set(`recipes/${name}`, serialize(saveResume(state.record, stripId(r), state.frozen?.[r.id] ?? null).file));
  }
  return out;
}

// The Library's lists, written only when they hold something, so a file without documents is the file it always was.
const LISTS = ['documents', 'rounds', 'imports'];
const listsOf = s => Object.fromEntries(LISTS.filter(k => s?.[k]?.length).map(k => [k, s[k]]));
// From a file anyone can edit: only entries that have an id (the import log: a sha256).
const cleanList = (x, key) => (Array.isArray(x) ? x.filter(e => e && typeof e === 'object' && typeof e[key] === 'string') : []);
const cleanLists = o => ({ documents: cleanList(o?.documents, 'id'), rounds: cleanList(o?.rounds, 'id'), imports: cleanList(o?.imports, 'sha256') });
const textOnly = docs => docs.map(({ embedded, ...d }) => d);

// `clock`, `device`: the object clocks (src/model/merge.js) and the device that stamped them. A file without them is read as before.
export function makeBackup(state, { saved = new Date().toISOString(), checkpoints, app = APP_VERSION, clock, device } = {}){
  return {
    // Old name, kept: renaming it would orphan saved data.
    resumeBuilderBackup: 1,
    saved,
    app,
    ...(state.record?.recordId ? { recordId: state.record.recordId } : {}),
    record: save(state.record),
    resumes: (state.resumes ?? []).map(r => saveResume(state.record, stripId(r), state.frozen?.[r.id] ?? null).file),
    resumeIds: (state.resumes ?? []).map(r => r.id ?? resumeFileName(r)),      // the ids the clock is keyed by (a resume renamed after it was made has an id its name no longer says)
    ...listsOf(state),
    ...(clock ? { clock, device } : {}),
    ...(checkpoints ? { checkpoints } : {}),
  };
}

// The open resume's working copy: the saved one without its snapshots, which only the saved one keeps.
const workingCopy = r => { if (!r) return null; const c = structuredClone(r); delete c.snapshots; return c; };

// A state read from a folder holds its documents text-only; each one the current state also holds (the same sha256) keeps that state's original.
export function keepOriginals(next, current){
  for (const d of next.documents ?? []){
    const mine = (current?.documents ?? []).find(x => x.sha256 === d.sha256);
    if (mine?.embedded && !d.embedded) d.embedded = mine.embedded;
  }
  return next;
}

// recipes/ may hold v4 resume files and v3 recipes alike.
export async function readFolder(folder){
  const text = await folder.read('resume-data.json');
  if (text === null) return null;
  const { model, warnings } = load(JSON.parse(text));
  const resumes = [], frozen = {};
  const skipped = [], leftovers = [];
  // one saved resume can be on disk under two spellings of its name (composed or decomposed accents): the files are
  // grouped by that, and a group is one resume
  const groups = new Map();
  for (const name of await folder.list('recipes')){
    if (!name.endsWith('.json')) continue;
    const from = conflictCopy(name);
    if (from){ skipped.push(name); warnings.push(`skipped recipes/${name}: a conflict copy made by ${from}`); continue; }
    const k = nameKey(name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(name);
  }
  for (const names of groups.values()){
    names.sort((x, y) => Number(y === y.normalize('NFC')) - Number(x === x.normalize('NFC')));   // the name the app writes first
    const read = [];
    for (const name of names){
      try { const text = await folder.read(`recipes/${name}`); read.push({ name, text, got: loadResume(JSON.parse(text), model) }); }
      catch (e){ warnings.push(`recipes/${name}: ${e.message}`); }
    }
    if (!read.length) continue;
    // the one saved last wins, the composed name on a tie; a copy with the same text is no news, a different one stays on disk, untouched
    const keep = read.reduce((a, b) => (b.got.recipe.savedAt ?? '') > (a.got.recipe.savedAt ?? '') ? b : a);
    for (const o of read) if (o !== keep && o.text !== keep.text) warnings.push(`recipes/${o.name}: same name as recipes/${keep.name} once accents are composed; the one saved last is open`);
    const id = keep.name.normalize('NFC');
    for (const o of read) if (o.name !== id && read.length > 1) leftovers.push(o.name);   // every other spelling, the open one included
    resumes.push({ ...keep.got.recipe, id });
    if (keep.got.frozen) frozen[id] = keep.got.frozen;
  }
  let lists = cleanLists();
  const lib = await folder.read('library.json');
  if (lib !== null) try { lists = cleanLists(JSON.parse(lib)); } catch (e){ warnings.push(`library.json: ${e.message}`); }
  return { state: { record: model, resumes, frozen, ...lists, cur: workingCopy(resumes[0]), openId: resumes[0]?.id ?? null }, warnings, skipped, leftovers };
}

export function readBackup(obj){
  if (detect(obj) !== 'backup') throw keyed('error.notBackup');
  const { model, warnings } = load(obj.record);
  const resumes = [], frozen = {};
  for (const f of obj.resumes ?? []){
    const got = loadResume(f, model);
    const own = obj.resumeIds?.[resumes.length];
    const id = typeof own === 'string' && own && !resumes.some(r => nameKey(r.id) === nameKey(own)) ? own : uniqueName(resumes, got.recipe);
    resumes.push({ ...got.recipe, id });
    if (got.frozen) frozen[id] = got.frozen;
  }
  const info = { recordId: obj.recordId ?? model.recordId ?? null, saved: obj.saved ?? null, app: obj.app ?? null, clock: cleanClock(obj.clock), device: obj.device ?? null };
  return { state: { record: model, resumes, frozen, ...cleanLists(obj), cur: workingCopy(resumes[0]), openId: resumes[0]?.id ?? null }, warnings, info };
}

// What to do with a file the person opens, given what this browser last saved to a file.
//   same: this is the file last saved here and nothing changed since; merge: the file and this browser both have clocks and one record, so they
//   merge by themselves; changes / older: warn and offer Save first, Merge or Replace; different: another record; ok: carry on as before.
export function openVerdict({ file, last, localRecordId, changes, localClock = false }){
  if (!file.recordId || !localRecordId || file.recordId !== localRecordId) return { kind: 'different' };
  const older = !!(last && last.recordId === file.recordId && file.saved && last.at && String(file.saved) < String(last.at));
  // the same date and the same text; a file somebody edited after it was saved is not "up to date"
  const sameText = !file.hash || !last?.hash || file.hash === last.hash;
  if (!changes && last && last.recordId === file.recordId && last.at === file.saved && sameText) return { kind: 'same' };
  if (file.clock && localClock) return { kind: 'merge' };
  if (changes) return { kind: 'changes', changes, older };
  if (older) return { kind: 'older', older };
  return { kind: 'ok' };
}

function uniqueName(list, recipe){
  const base = resumeFileName(recipe);
  let id = base, n = 2;
  while (list.some(r => nameKey(r.id) === nameKey(id))) id = base.replace(/\.json$/, ` ${n++}.json`);
  return id;
}

const fileStamp = iso => iso.replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
const safe = s => String(s).replace(/[^\p{L}\p{N} _.,()-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'checkpoint';

export function createPersist({ store, backend = memoryBackend(), folder = null, debounceMs = 400,
  now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout } = {}){
  let timer = null, waiters = [], status = 'idle', lastError = null, errorCode = null;
  let linked = folder;
  const written = new Map();          // path → text last written to the folder
  let diskHash = null;                // hash of resume-data.json as the app last read or wrote it (a linked folder)
  const file = { last: null, n: 0 }; // the last save to the one file, and the changes since (kept in the browser's storage)
  let pendingCommits = 0;
  // The object clocks (src/model/merge.js), ticked at every save. A state that is here from the start is the common start of every copy made from it.
  let clock = store.state?.record ? baseline(store.materialize()) : { keys: {}, seen: {} };
  let device = null;      // this device's actor id: random, made once
  const newActor = async () => { device = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)).slice(0, 6); await backend.put('meta/device', device); return device; };
  const actor = async () => (device ??= (await backend.get('meta/device')) ?? await newActor());
  const stamp = async state => {
    clock = tick(clock, state, await actor(), now().getTime());
    await backend.put('meta/clock', clock);
    return clock;
  };
  const statusSubs = new Set();
  const setStatus = (s, err = null, code = null) => { status = s; lastError = err; errorCode = code; for (const fn of statusSubs) fn({ status, error: err, code }); };

  // The assets in storage are told apart by one listing, never by reading them back (an original can be 10 MB).
  async function putAssets(refs){
    const had = new Set((await backend.list('asset/')).map(k => k.slice(6)));
    for (const ref of refs) if (!had.has(ref)){ await backend.put(`asset/${ref}`, store.asset(ref)); had.add(ref); }
    return had;
  }
  // Of those listed, drop what the state, undo, redo and every checkpoint no longer hold.
  // shortcut: a second tab on this storage can save between the check and the delete; the state it saved is read again just before, which narrows it, and I-8's single-writer lock closes it.
  async function dropAssets(had){
    const keep = store.liveRefs();
    for (const c of (await backend.get('checkpoints/index')) ?? []) for (const r of c.refs ?? []) keep.add(r);
    assetRefs((await backend.get('state/current'))?.state, keep);
    for (const r of had) if (!keep.has(r)) await backend.delete(`asset/${r}`);
  }

  async function saveNow(){
    clearTimer(timer); timer = null;
    setStatus('saving');
    try {
      const state = store.state;
      // assets first, then the state that points at them, then the assets nothing points at any more
      const had = await putAssets(assetRefs(state));
      await backend.put('state/current', { savedAt: now().toISOString(), state });
      try { await dropAssets(had); } catch { /* the assets are dropped at a later save; this one is done */ }
      if (state.record) try { await stamp(store.materialize()); } catch { /* the clock is made again at the next copy that leaves; the state is saved */ }
      if (pendingCommits){ file.n += pendingCommits; pendingCommits = 0; await backend.put('meta/fileDirty', file.n); }
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
      if (p === 'resume-data.json'){
        // never write over a file somebody else changed since the app read or wrote it
        const onDisk = await linked.read(p);
        if (onDisk !== null && (diskHash === null || (await sha256(onDisk)) !== diskHash)){
          setStatus('error', t('save.folderChanged', { name: linked.name }), 'folder-changed');
          return null;
        }
      }
      await linked.write(p, text);
      written.set(p, text);
      if (p === 'resume-data.json') diskHash = await sha256(text);
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

  const unsub = store.subscribe(ev => {
    if (['commit', 'undo', 'redo'].includes(ev?.kind)) pendingCommits++;
    if (status !== 'pending') setStatus('pending');     // changed, not yet written: the header says Saving…
    clearTimer(timer);
    timer = setTimer(saveNow, debounceMs);
  });

  // A checkpoint keeps asset refs, like state/current: the bytes (a photo, an original) are stored once under asset/, and the index says which refs a checkpoint holds.
  // A checkpoint made before that has the data inline; hydrate() reads both.
  const hydrate = async c => {
    if (!c) return c;
    const entries = [];
    for (const ref of assetRefs(c.state)){ const v = await backend.get(`asset/${ref}`); if (v !== undefined) entries.push([ref, v]); }
    store.loadAssets(entries);
    return { ...c, state: store.materialize(c.state) };
  };
  async function addCheckpoint(label, kind = 'manual'){
    const at = now().toISOString();
    const id = `c-${at}-${Math.random().toString(36).slice(2, 7)}`;
    const refs = assetRefs(store.state);
    await putAssets(refs);
    await backend.put(`checkpoint/${id}`, { id, label, kind, at, state: store.state });
    const index = (await backend.get('checkpoints/index')) ?? [];
    index.unshift({ id, label, kind, at, ...(refs.size ? { refs: [...refs] } : {}) });
    // automatic checkpoints are capped; manual ones are never pruned
    const autos = index.filter(c => AUTO_KINDS.has(c.kind));
    for (const c of autos.slice(AUTO_KEEP)){
      index.splice(index.indexOf(c), 1);
      await backend.delete(`checkpoint/${c.id}`);
    }
    await backend.put('checkpoints/index', index);
    if (linked && (await linked.permission()) === 'granted')
      await linked.write(`checkpoints/${fileStamp(at)} ${safe(label)}.json`, serialize(makeBackup({ ...store.materialize(), documents: textOnly(store.state.documents ?? []) }, { saved: at })));
    return id;
  }

  // the one file: what to save, and what was saved last
  async function markFile(m){
    file.last = { at: m.at, recordId: m.recordId ?? null, hash: m.hash ?? null };
    file.n = 0; pendingCommits = 0;
    await backend.put('meta/lastFileSave', file.last);
    await backend.put('meta/lastBackup', m.at);
    await backend.put('meta/fileDirty', 0);
    setStatus(status, lastError, errorCode);
  }

  return {
    get status(){ return { status, error: lastError, code: errorCode, linked: linked?.name ?? null }; },
    get fileState(){ return { last: file.last, changes: file.n + pendingCommits, recordId: store.state?.record?.recordId ?? null, hasClock: Object.keys(clock.keys).length > 0 }; },
    // this copy as a merge takes it: the state with its clock stamped now, and the clock it is merged into
    // `theirs`: the other copy's clock; if it holds saves of this device's actor that this copy never made, this copy takes another actor first
    async forMerge(theirs = null){
      const me = await actor();
      if (foreign(clock, theirs, me)){ const was = me; await newActor(); clock = renameActor(clock, was, device); }
      const state = store.materialize();
      return { state: { record: state.record, resumes: state.resumes ?? [], frozen: state.frozen ?? {}, ...listsOf(state) }, clock: await stamp(state) };
    },
    async adoptClock(c){ clock = c; await backend.put('meta/clock', clock); },
    // the backup text for the one file, without checkpoints; markFileSaved once it was delivered
    async prepareFile(){
      if (store.state?.record && !store.state.record.recordId) store.commit(d => { ensureRecordId(d.record); }, t('save.recordId'));
      const at = now().toISOString(), state = store.materialize();
      const text = JSON.stringify(makeBackup(state, { saved: at, clock: await stamp(state), device }), null, 2) + '\n';
      return { text, name: SAVE_FILE_NAME, at, recordId: store.state.record?.recordId ?? null, hash: await sha256(text) };
    },
    markFileSaved: markFile,
    // a file opened in place of this copy: its clock is this copy's now, and a file without one starts a history
    async markFileOpened(m){
      await markFile(m);
      const state = store.materialize();
      clock = opened(m.clock ?? baseline(state), clock, state, await actor(), now().getTime());
      await backend.put('meta/clock', clock);
    },
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
      // an old session gets its record id now and keeps it: a new one on every reload would make the file saved before look like another record's
      const had = !!saved.state.record?.recordId;
      ensureRecordId(saved.state.record);
      if (!had && saved.state.record?.recordId) await backend.put('state/current', saved);
      file.last = (await backend.get('meta/lastFileSave')) ?? null;
      file.n = (await backend.get('meta/fileDirty')) ?? 0;
      store.reset(saved.state, 'restore session');
      clock = floored(cleanClock(await backend.get('meta/clock')) ?? baseline(store.materialize()), await actor());
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
      const there = await f.read('resume-data.json');         // what is on disk now is what the person chose to keep or replace
      diskHash = there === null ? null : await sha256(there);
      // a file already on disk with the same text is left alone: no new modification time for a sync tool to carry to other devices
      for (const [p, text] of filesOf(store.materialize())) if ((await f.read(p)) === text) written.set(p, text);
      return (await writeFolder()) ?? [];
    },
    // After link() has written the open resumes under their composed names: the other spelling of a merged resume is
    // removed, but only when the composed file is there and this one is not it.
    async dropMerged(names){
      const gone = [];
      for (const name of names){
        if (name === name.normalize('NFC') || !linked?.remove) continue;
        if ((await linked.read(`recipes/${name.normalize('NFC')}`)) === null) continue;
        await linked.remove(`recipes/${name}`);
        gone.push(name);
      }
      return gone;
    },
    // the person said to overwrite the file that changed outside the app
    async overwriteFolder(){
      const there = linked ? await linked.read('resume-data.json') : null;
      diskHash = there === null ? null : await sha256(there);
      written.delete('resume-data.json');
      if (status === 'error' && errorCode === 'folder-changed') setStatus('idle');
      return linked ? (await writeFolder()) ?? [] : [];
    },
    unlink(){ linked = null; written.clear(); diskHash = null; return backend.delete('handle/folder'); },
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
        .map(async c => hydrate(await backend.get(`checkpoint/${c.id}`)))) : undefined;
      await backend.put('meta/lastBackup', now().toISOString());
      const state = store.materialize();
      return makeBackup(state, { saved: now().toISOString(), checkpoints: cps, clock: await stamp(state), device });
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
    async loadCheckpoint(id){ return hydrate(await backend.get(`checkpoint/${id}`)); },
    async restoreCheckpoint(id){
      const c = await hydrate(await backend.get(`checkpoint/${id}`));
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
