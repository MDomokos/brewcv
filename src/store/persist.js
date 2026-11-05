// Where the state lives between sessions: browser storage (autosave after every
// change), plus an optional linked folder that mirrors it. Only changed files are
// written, and a declined permission just stops the mirror.

import { t, keyed } from '../i18n/index.js';
import { save, serialize, load, saveResume, loadResume, detect, resumeFileName, nameKey, ensureRecordId, dropProto, BODY_KEYS } from '../model/schema.js';
import { assetRefs } from './store.js';
import { newResume } from '../model/resume.js';
import { seedBank } from '../model/skillbank.js';
import { tick, baseline, opened, floored, foreign, renameActor, cleanClock, keepOpen } from '../model/merge.js';

// The one file you save and open yourself. Never translated.
export const SAVE_FILE_NAME = 'brewcv.json';
// package.json's version, which checks/version-check.mjs keeps equal to it.
export const APP_VERSION = '1.9.3';

// of a text, or of the bytes of a file
export async function sha256(text){
  const buf = await globalThis.crypto.subtle.digest('SHA-256', typeof text === 'string' ? new TextEncoder().encode(text) : text);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Copies a sync tool leaves beside a file when two devices wrote at once. They are never read as saved resumes.
export const CONFLICT_PATTERNS = [
  { from: 'Syncthing', re: /\.sync-conflict-\d{8}-\d{6}(?:-[A-Z0-9]+)?(?:\.[^.]+)?$/i },
  { from: 'Dropbox', re: /\((?:[^)]*['’]s )?conflicted copy(?: [^)]*)?\)/i },
  { from: 'iCloud', re: /^(?:brewcv|resume-data) \d+\.json$/i },
  { from: 'Synology Drive', re: /_[^_\\/]+_[A-Za-z]{3}-\d{1,2}-\d{4}-\d{4}_[A-Za-z]*Conflict(?:\.[^.]+)?$/ },
];
export const conflictCopy = name => CONFLICT_PATTERNS.find(p => p.re.test(String(name)))?.from ?? null;
// What a sync tool or an office program leaves while it works: never read, never taken for damage.
export const IGNORED = /^(?:\.syncthing\..*\.tmp|~\$.*|\.~lock\..*#|.*\.tmp|\.DS_Store|@eaDir|#recycle|\.stfolder|\.stversions)$/i;
export const ignored = name => IGNORED.test(String(name).split('/').at(-1));

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

// A folder in memory, for the checks. `seed` is an object, or the Map (`_files`) of another memoryFolder, so two devices can share one folder.
// A value is text or bytes; `list('')` is the top; a modified time is the clock's, and goes up at every write.
export function memoryFolder(seed = {}){
  const files = seed instanceof Map ? seed : new Map(Object.entries(seed)), times = (files.times ??= new Map());
  const put = (p, v) => { files.set(p, v); times.set(p, files.tick = Math.max(Date.now(), (files.tick ?? 0) + 1)); };
  const bytes = v => (typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v));
  const under = dir => (dir ? dir.replace(/\/?$/, '/') : '');
  const rest = (dir, k) => (k.startsWith(under(dir)) ? k.slice(under(dir).length) : null);
  return {
    async read(p){ return files.has(p) ? (typeof files.get(p) === 'string' ? files.get(p) : new TextDecoder().decode(files.get(p))) : null; },
    async readBytes(p){ return files.has(p) ? bytes(files.get(p)) : null; },
    async write(p, data){ put(p, typeof data === 'string' ? data : new Uint8Array(data)); },
    async stat(p){ return files.has(p) ? { size: bytes(files.get(p)).length, mtime: times.get(p) ?? 0 } : null; },
    async list(dir){ return [...files.keys()].map(k => rest(dir, k)).filter(r => r && !r.includes('/')).sort(); },
    async dirs(dir){ return [...new Set([...files.keys()].map(k => rest(dir, k)).filter(r => r?.includes('/')).map(r => r.split('/')[0]))].sort(); },
    async permission(){ return 'granted'; },
    async remove(p){ files.delete(p); times.delete(p); },
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
    async readBytes(p){
      try { const { d, name } = await walk(p, false); return new Uint8Array(await (await (await d.getFileHandle(name)).getFile()).arrayBuffer()); }
      catch { return null; }
    },
    async stat(p){
      try { const { d, name } = await walk(p, false); const f = await (await d.getFileHandle(name)).getFile(); return { size: f.size, mtime: f.lastModified }; }
      catch { return null; }
    },
    async list(sub, kind = 'file'){
      try {
        let d = dir;
        for (const seg of sub.split('/').filter(Boolean)) d = await d.getDirectoryHandle(seg);
        const out = [];
        for await (const [name, h] of d.entries()) if (h.kind === kind) out.push(name);
        return out.sort();
      } catch { return []; }
    },
    dirs(sub){ return this.list(sub, 'directory'); },
    // text or bytes; createWritable swaps the file in when it closes, so a reader never sees half of it
    async write(p, data){
      const { d, name } = await walk(p, true);
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(data); await w.close();
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
  const fs = T.fs, base = path.replace(/[\\/]+$/, ''), at = p => (p.replace(/\/+$/, '') ? `${base}/${p.replace(/\/+$/, '')}` : base);      // '' and 'dir/' are the folder itself and `dir`
  return {
    name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
    handle: path,
    // no prompt here: a path the plugin still lets us reach is granted; otherwise the person picks the folder again
    async permission(){ try { return (await fs.exists(path)) ? 'granted' : 'prompt'; } catch { return 'prompt'; } },
    async read(p){ try { return await fs.readTextFile(at(p)); } catch { return null; } },
    async readBytes(p){ try { return new Uint8Array(await fs.readFile(at(p))); } catch { return null; } },
    async stat(p){ try { const s = await fs.stat(at(p)); return { size: s.size, mtime: +s.mtime || 0 }; } catch { return null; } },
    async list(sub, kind = 'isFile'){
      try { return (await fs.readDir(at(sub))).filter(e => e[kind]).map(e => e.name).sort(); } catch { return []; }
    },
    dirs(sub){ return this.list(sub, 'isDirectory'); },
    // text or bytes, written to a temporary name and renamed into place, so a sync tool never reads half of it
    async write(p, data){
      const i = p.lastIndexOf('/');
      if (i > 0) await fs.mkdir(at(p.slice(0, i)), { recursive: true });
      const tmp = `${at(p)}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      try { await (typeof data === 'string' ? fs.writeTextFile(tmp, data) : fs.writeFile(tmp, data)); await fs.rename(tmp, at(p)); }
      catch (e){ await fs.remove(tmp).catch(() => {}); throw e; }
    },
    async remove(p){ try { await fs.remove(at(p)); } catch { /* already gone */ } },
  };
}
// what a remembered handle was: a path (desktop) or a FileSystemDirectoryHandle (browser)
export const folderOf = (h, T) => (typeof h === 'string' ? tauriFolder(h, T) : fsaFolder(h));

// ---- the resume space (src/store/space.js): BrewCV's own data sits in BrewCV/ of the folder the person linked, or at the top of an older folder ----

// The same folder object, every path under `pre`. It marks a resume space (`space`), and `root` is the folder the person linked (Documents/ is beside BrewCV/; the Inbox is inside it).
export function prefixed(root, pre){
  const w = { name: root.name, handle: root.handle, root, space: true, permission: ask => root.permission(ask) };
  for (const m of ['read', 'readBytes', 'write', 'stat', 'list', 'dirs', 'remove']) w[m] = (p, ...a) => root[m](pre + p, ...a);
  return w;
}
// BrewCV/ when the folder has its data there (or nothing yet); else the top of it, where older folders keep resume-data.json. `legacy`: moving it into BrewCV/ is offered.
export async function dataFolder(root){
  const there = (await root.read('BrewCV/resume-data.json')) !== null;      // written last by the move into BrewCV/, so a move that stopped half way is still the older folder
  const old = !there && (await root.read('resume-data.json')) !== null;
  return Object.assign(prefixed(root, old ? '' : 'BrewCV/'), { legacy: old });
}

// A name that works on Windows, macOS, Linux and Android: none of \ / : * ? " < > | # ^ [ ], a control character (C0, DEL, C1) or a bidi control (U+202A to U+202E, U+2066 to U+2069), composed accents, at most 120 characters, no trailing dot or space.
// shortcut: a Windows reserved name (CON, NUL) is not changed; rename it by hand if a folder ever holds one.
export const safe = (s, fallback = 'checkpoint') => String(s).normalize('NFC').replace(/[\\/:*?"<>|#^\[\]\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).replace(/[. ]+$/, '') || fallback;

// The one way the app removes a file in a resume space: it goes to BrewCV/Deleted/ as `<day> <name>` (never a Deleted/ at the top of an older folder, which is the person's), copied, read back and checked,
// and only then taken from where it was. The folder is the undo. Each move is written in an index of this device (`index <by>.json`: name, sha256, day); sweepDeleted removes only what an index lists, 30 days
// after, and only while the bytes are still the ones moved. `from`: the folder `p` is in, when it is not the data folder; `copy`: leave the original (a file that is about to be overwritten).
const BIN = 'BrewCV/Deleted';
// An index is a map of name → { sha256, day }; one that is damaged (not JSON, null, a list) is an empty one, and an entry that is not an entry is skipped.
const readIndex = async (bin, file) => {
  try { const x = dropProto(JSON.parse(await bin.read(`${BIN}/${file}`))); return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; } catch { return {}; }
};
const entriesOf = index => Object.entries(index).filter(([, e]) => e && typeof e === 'object' && typeof e.sha256 === 'string');
// The file is `<day> <name> (<by>)`: the device is in the name, so two devices never write one name.
export async function toDeleted(data, p, { from = data, copy = false, by = 'app', day = new Date().toISOString().slice(0, 10) } = {}){
  const bin = data.root ?? data, bytes = await from.readBytes(p);
  if (bytes === null) return null;
  const [, stem, ext = ''] = /^(.*?)(\.[^.]*)?$/.exec(p.split('/').at(-1));
  let name = `${day} ${safe(`${stem} (${by})${ext}`, 'file')}`, n = 2;
  while (await bin.stat(`${BIN}/${name}`)) name = `${day} ${safe(`${stem} (${by}) ${n++}${ext}`, 'file')}`;
  const to = `${BIN}/${name}`, sha = await sha256(bytes);
  await bin.write(to, bytes);
  const back = await bin.readBytes(to);
  if (!back || (await sha256(back)) !== sha){ await bin.remove(to); throw new Error(t('i8.errCopy', { path: p })); }
  // shortcut: a damaged index of this device is started again, so what it listed is no longer swept (those files stay until the person removes them); upgrade by keeping a second copy of the index.
  try {
    const index = await readIndex(bin, `index ${by}.json`);
    index[name] = { sha256: sha, day };
    await bin.write(`${BIN}/index ${by}.json`, JSON.stringify(index, null, 2) + '\n');
  } catch { /* the copy is made and checked; without an index entry it is never swept, which is safe */ }
  if (!copy) await from.remove(p);
  return to;
}
// Removes the files the app moved to BrewCV/Deleted/ that are 30 days old and unchanged since. Nothing else is ever removed: not a file put there by hand, not an older folder's own Deleted/, not a name that is a path.
// An index of another device is read and its files swept, but only this device's index is rewritten, and only when it changed.
export async function sweepDeleted(data, now = new Date(), { days = 30, by = 'app' } = {}){
  if (data.legacy) return [];
  const bin = data.root ?? data, gone = [];
  for (const file of await bin.list(BIN)){
    if (!/^index .+\.json$/.test(file)) continue;
    const index = await readIndex(bin, file);
    let changed = false;
    for (const [name, e] of entriesOf(index)){
      const old = /^[^/\\]+$/.test(name) && /^\d{4}-\d\d-\d\d$/.test(e.day) && name.startsWith(`${e.day} `) && now - new Date(`${e.day}T00:00:00Z`) > days * 864e5, bytes = old ? await bin.readBytes(`${BIN}/${name}`) : null;
      if (!old) continue;
      if (bytes && (await sha256(bytes)) === e.sha256){ await bin.remove(`${BIN}/${name}`); gone.push(name); delete index[name]; changed = true; }
      else if (!bytes){ delete index[name]; changed = true; }      // already gone
    }
    if (changed && file === `index ${by}.json`) await bin.write(`${BIN}/${file}`, JSON.stringify(index, null, 2) + '\n');
  }
  return gone;
}

// a saved resume's `id` is its file name, not part of what the file says
const stripId = r => { const c = { ...r }; delete c.id; return c; };
// The body of a saved resume's file in one order of keys (BODY_KEYS, as a file read back gives them): a text frozen just now and the same text read from a file would otherwise be two files, and two devices would write both.
const ordered = f => { const o = { $schema: f.$schema }; for (const k of BODY_KEYS) if (f[k] !== undefined) o[k] = f[k]; for (const k of Object.keys(f)) if (!(k in o)) o[k] = f[k]; return o; };
// The Library's lists (documents without their bytes, rounds, the import log) are the merged view `library.json`; it is there only when one holds something.
// shortcut: a folder (and a checkpoint file in it) carries documents text-only, since an embedded original is not written out yet; upgrade with the folder layout (originals as files in Documents/<search>/<company>/).
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
    out.set(`recipes/${name}`, serialize(ordered(saveResume(state.record, stripId(r), state.frozen?.[r.id] ?? null).file)));
  }
  return out;
}

// The Library's lists, written only when they hold something, so a file without documents is the file it always was.
const LISTS = ['documents', 'rounds', 'imports'];
const listsOf = s => Object.fromEntries(LISTS.filter(k => s?.[k]?.length).map(k => [k, s[k]]));
// From a file anyone can edit: only entries that have an id (the import log: a sha256).
const cleanList = (x, key) => (Array.isArray(x) ? x.filter(e => e && typeof e === 'object' && typeof e[key] === 'string') : []);
const cleanLists = o => ({ documents: cleanList(o?.documents, 'id'), rounds: cleanList(o?.rounds, 'id'), imports: cleanList(o?.imports, 'sha256') });
const textOnly = docs => docs.map(({ embedded, thumb, ...d }) => d);

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
    ...(state.closed && state.resumes?.length ? { closed: true } : {}),      // no resume open
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
    if (mine?.thumb && !d.thumb) d.thumb = mine.thumb;
  }
  return next;
}

// recipes/ may hold v4 resume files and v3 recipes alike.
export async function readFolder(folder){
  const text = await folder.read('resume-data.json');
  if (text === null) return null;
  const { model, warnings } = load(dropProto(JSON.parse(text)));
  const resumes = [], frozen = {};
  const skipped = [], leftovers = [];
  // one saved resume can be on disk under two spellings of its name (composed or decomposed accents): the files are
  // grouped by that, and a group is one resume
  const groups = new Map();
  for (const name of await folder.list('recipes')){
    if (!name.endsWith('.json') || ignored(name)) continue;
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
      try { const text = await folder.read(`recipes/${name}`); read.push({ name, text, got: loadResume(dropProto(JSON.parse(text)), model) }); }
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
  if (lib !== null) try { lists = cleanLists(dropProto(JSON.parse(lib))); } catch (e){ warnings.push(`library.json: ${e.message}`); }
  return { state: { record: model, resumes, frozen, ...lists, cur: workingCopy(resumes[0]), openId: resumes[0]?.id ?? null }, warnings, skipped, leftovers };
}

// A backup that is JSON but damaged inside (a list holding null, a number where a list goes) is "not a backup", with the model's own message, not a TypeError.
export function readBackup(obj){
  try { return readBackupOf(obj); }
  catch (e){ throw e?.key ? e : keyed('error.notBackup'); }
}
function readBackupOf(obj){
  dropProto(obj);      // the file is untrusted: read in place, once
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
  const closed = obj.closed === true && resumes.length > 0;
  const open = closed ? { cur: newResume(model, { format: 'a4' }), openId: null, closed: true } : { cur: workingCopy(resumes[0]), openId: resumes[0]?.id ?? null };
  return { state: { record: model, resumes, frozen, ...cleanLists(obj), ...open }, warnings, info };
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

export function uniqueName(list, recipe){
  const base = resumeFileName(recipe);
  let id = base, n = 2;
  while (list.some(r => nameKey(r.id) === nameKey(id))) id = base.replace(/\.json$/, ` ${n++}.json`);
  return id;
}

const fileStamp = iso => iso.replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');

// `locks`: navigator.locks. In a resume space (a folder from dataFolder()) one window is the writer; the others only read. `deviceName`: what this device's file is called.
export function createPersist({ store, backend = memoryBackend(), folder = null, debounceMs = 400,
  now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout, locks = null, deviceName = null } = {}){
  let timer = null, waiters = [], status = 'idle', lastError = null, errorCode = null, savedAt = null;
  let linked = folder;
  // A window that does not hold the writer lock writes nothing to the browser's storage: its saves, checkpoints and clocks stay in the window.
  const raw = backend;
  backend = { get: k => raw.get(k), list: pre => raw.list(pre), put: (k, v) => (writer ? raw.put(k, v) : undefined), delete: k => (writer ? raw.delete(k) : undefined) };
  const written = new Map();          // path → text last written to the folder
  let diskHash = null;                // hash of resume-data.json as the app last read or wrote it (a linked folder)
  // A resume space: the files of the merged view (resume-data.json, library.json, recipes/) are guarded by what this device last read or wrote; one it did not is somebody else's, left alone until space.js reads it in.
  // `wrote`: the hash of what this device wrote there last, kept in the browser's storage for each folder, so a file left from an earlier session (a window closed before its last save) is this device's own and not an outside edit.
  // An older version of a file (restored from a backup, or by a sync tool) is not: it is read in or kept before it is written over.
  const known = new Map(), wrote = new Map();
  let writer = !locks;
  const folderKey = () => `wrote/${linked?.root?.name ?? linked?.name}`;
  const wasMine = (p, h) => known.get(p) === h || wrote.get(p) === h;
  const remember = async (p, h) => { known.set(p, h); wrote.set(p, h); };
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
  const guessName = () => { const ua = globalThis.navigator?.userAgent ?? ''; return /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device'; };
  // shortcut: a device is named after its system (and cannot be renamed); two Macs are told apart by the four characters of the id; upgrade with a name field in Settings.
  const nameOf = async () => safe(deviceName ?? (await backend.get('meta/deviceName')) ?? guessName(), 'device');
  const who = async () => (await actor()).slice(0, 4);
  const devicePath = async () => `devices/${await nameOf()} ${(await actor()).slice(0, 4)}.json`;
  // The text of this device's file: its state without any original, with the clock stamped now. Nothing in it changes until the state does, so an unchanged file is not written again.
  async function deviceText(){
    const state = store.materialize(), c = await stamp(state);
    const at = Object.values(c.keys).reduce((m, e) => (e.at > m ? e.at : m), '1970-01-01T00:00:00.000Z');
    return JSON.stringify(makeBackup({ ...state, documents: textOnly(state.documents ?? []) }, { saved: at, clock: c, device }), null, 2) + '\n';
  }
  // The Web Lock is held until the window closes; a window that cannot get it only reads (it writes nothing to the folder).
  const becomeWriter = () => new Promise(resolve => {
    if (writer || !locks) return resolve(writer = true);
    locks.request('brewcv-writer', { ifAvailable: true }, lock => (lock ? (resolve(writer = true), new Promise(() => {})) : resolve(false))).catch(() => resolve(false));
  });
  const statusSubs = new Set();
  const setStatus = (s, err = null, code = null) => { status = s; lastError = err; errorCode = code; for (const fn of statusSubs) fn({ status, error: err, code }); };

  // The assets in storage are told apart by one listing, never by reading them back (an original can be 10 MB).
  async function putAssets(refs){
    const had = new Set((await backend.list('asset/')).map(k => k.slice(6)));
    for (const ref of refs) if (!had.has(ref)){ await backend.put(`asset/${ref}`, store.asset(ref)); had.add(ref); }
    return had;
  }
  // Of those listed, drop what the state, undo, redo and every checkpoint no longer hold.
  // Only the window with the writer lock saves, so no other window's state is missed here.
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
      const at = now().toISOString();
      await backend.put('state/current', { savedAt: at, state });
      savedAt = at;
      try { await dropAssets(had); } catch { /* the assets are dropped at a later save; this one is done */ }
      if (state.record) try { await stamp(store.materialize()); } catch { /* the clock is made again at the next copy that leaves; the state is saved */ }
      if (pendingCommits){ file.n += pendingCommits; pendingCommits = 0; await backend.put('meta/fileDirty', file.n); }
      const mirrored = linked ? await writeFolder() : [];
      if (mirrored) setStatus('saved');     // null: the folder refused and writeFolder set the error
    } catch (e){
      // out of room in the browser's storage: what is in memory and the last good copy in storage are both as they were; the person is told what to do
      const full = e?.name === 'QuotaExceededError' || e?.code === 22;
      setStatus('error', full ? t('i6.storageFull') : e.message, full ? 'storage-full' : null);
    }
    for (const w of waiters.splice(0)) w();
  }

  async function writeFolder(){
    if ((await linked.permission()) !== 'granted'){ setStatus('error', 'not writing to disk: the folder needs permission again'); return null; }
    const spaced = !!linked.space, files = filesOf(store.materialize());
    if (spaced && store.state.record) files.set(await devicePath(), await deviceText());
    const out = [];
    for (const [p, text] of files){
      if (written.get(p) === text && !(spaced && p === 'library.json' && (await linked.read(p)) !== text)) continue;      // library.json is read again: it is derived, and somebody may have written it
      if (spaced && !p.startsWith('devices/')){
        // a file this device did not write or read is somebody else's (a person, an agent, a sync tool): not written over until space.js has read it in
        const onDisk = await linked.read(p), h = onDisk === null ? null : await sha256(onDisk);
        if (onDisk !== null && onDisk !== text && !wasMine(p, h)){
          if (p !== 'library.json') continue;      // somebody's edit, not written over until it is read in
          await toDeleted(linked, p, { copy: true, by: await who() });      // library.json is derived from the state: what is there goes to Deleted/ and the new one is written
        }
      } else if (p === 'resume-data.json'){
        // never write over a file somebody else changed since the app read or wrote it
        const onDisk = await linked.read(p);
        if (onDisk !== null && (diskHash === null || (await sha256(onDisk)) !== diskHash)){
          setStatus('error', t('save.folderChanged', { name: linked.name }), 'folder-changed');
          return null;
        }
      }
      await linked.write(p, text);
      written.set(p, text);
      if (spaced && !p.startsWith('devices/')) await remember(p, await sha256(text));
      if (p === 'resume-data.json') diskHash = await sha256(text);
      out.push(p);
    }
    // a renamed or deleted resume: remove its old file, but only one written since the folder was
    // linked, so a file put there by hand is never deleted (in a resume space it goes to Deleted/)
    for (const p of [...written.keys()]) if (p.startsWith('recipes/') && !files.has(p) && linked.remove){
      if (spaced) await toDeleted(linked, p, { by: await who() }); else await linked.remove(p);
      written.delete(p); known.delete(p);
      out.push(`-${p}`);
    }
    // a library.json for lists that are empty now is stale: it goes to Deleted/ too
    if (spaced && !files.has('library.json') && (await linked.stat('library.json'))) await toDeleted(linked, 'library.json', { by: await who() });
    if (spaced && out.length) await backend.put(folderKey(), Object.fromEntries(wrote));
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
    if (!writer) throw new Error(t('i8.readOnly'));      // a window that does not write keeps nothing in the shared storage, and a change without a checkpoint behind it must not go ahead
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
    if (linked && writer && (await linked.permission()) === 'granted')
      await linked.write(`checkpoints/${linked.space ? `${await nameOf()}/` : ''}${fileStamp(at)} ${safe(label)}.json`, serialize(makeBackup({ ...store.materialize(), documents: textOnly(store.state.documents ?? []) }, { saved: at })));
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
    get savedAt(){ return savedAt; },      // when the session was last written to this device's storage (ISO), or null
    get status(){ return { status, error: lastError, code: errorCode, linked: linked?.name ?? null, linkedPath: typeof linked?.handle === 'string' ? linked.handle : null }; },      // linkedPath: only the desktop app's folder is a path
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
    // A merge's result becomes the state in one commit. Its clock is taken first, so the save that commit starts stamps nothing (the merge is no edit); it is given back if the commit is refused.
    async adoptMerge(m, label){
      const was = clock;
      clock = m.clock;
      try { store.commit(d => keepOpen(d, e => Object.assign(e, structuredClone(keepOriginals(m.state, store.materialize())))), label); }
      catch (e){ clock = was; throw e; }
      await backend.put('meta/clock', clock);
    },
    // the resume space: who is writing, what this device's file is called, the files in the folder this device did not write (see writeFolder)
    becomeWriter,
    get writer(){ return writer; },
    get folder(){ return linked; },
    devicePath,
    knows: wasMine,
    async accept(p, text){ await remember(p, await sha256(text)); },
    // the one way a file leaves the folder (see toDeleted)
    trash: async (p, o = {}) => toDeleted(linked, p, { ...o, by: await who() }),
    sweep: async () => sweepDeleted(linked, now(), { by: await who() }),
    // the person said the files in the folder may be written over (keep this device's state)
    async acceptAll(){
      for (const p of ['resume-data.json', 'library.json', ...(await linked.list('recipes')).filter(n => n.endsWith('.json') && !ignored(n)).map(n => `recipes/${n}`)]){
        const text = await linked.read(p);
        if (text !== null) await remember(p, await sha256(text));
      }
    },
    // this device's own notes (the files last seen in the folder, the moves Organise made), kept in the browser and never in the folder
    local: k => backend.get(`local/${k}`),
    setLocal: (k, v) => backend.put(`local/${k}`, v),
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
      savedAt = saved.savedAt ?? null;
      const refs = assetRefs(saved.state);
      const entries = [];
      for (const ref of refs){ const v = await backend.get(`asset/${ref}`); if (v !== undefined) entries.push([ref, v]); }
      store.loadAssets(entries);
      // an old session gets its record id now and keeps it: a new one on every reload would make the file saved before look like another record's
      const had = !!saved.state.record?.recordId;
      ensureRecordId(saved.state.record);
      const seeded = seedBank(saved.state.record);      // a session from before the wordbank: its skill groups become it
      if ((!had && saved.state.record?.recordId) || seeded) await backend.put('state/current', saved);
      file.last = (await backend.get('meta/lastFileSave')) ?? null;
      file.n = (await backend.get('meta/fileDirty')) ?? 0;
      store.reset(saved.state, 'restore session');
      clock = floored(cleanClock(await backend.get('meta/clock')) ?? baseline(store.materialize()), await actor());
      return true;
    },

    async link(f){
      if (f.space && !(await becomeWriter())) return null;      // another window writes this folder
      linked = f;
      written.clear(); known.clear(); wrote.clear();
      if (f.space) for (const [p, hs] of Object.entries((await raw.get(`wrote/${f.root?.name ?? f.name}`)) ?? {})) wrote.set(p, hs);
      // Before the first write over a resume-data/3 folder, keep the originals once
      // as resume-data.v3.json and recipes-v3/.
      const old = await f.read('resume-data.json');
      let v3 = false;
      try { v3 = old !== null && detect(dropProto(JSON.parse(old))) === 'library-v3'; } catch {}
      if (v3 && (await f.read('resume-data.v3.json')) === null){
        await f.write('resume-data.v3.json', old);
        for (const name of (await f.list?.('recipes')) ?? []){
          const t = await f.read(`recipes/${name}`);
          if (t !== null && name.endsWith('.json')) await f.write(`recipes-v3/${name}`, t);
        }
      }
      if (f.handle !== undefined) await backend.put('handle/folder', f.handle);
      if (f.space) return [];      // nothing is written until space.js has read in what is there
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
        if (linked.space) await toDeleted(linked, `recipes/${name}`, { by: await who() }); else await linked.remove(`recipes/${name}`);
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
    unlink(){ if (!writer) return Promise.resolve(); linked = null; written.clear(); known.clear(); wrote.clear(); diskHash = null; return backend.delete('handle/folder'); },
    rememberedFolder(){ return backend.get('handle/folder'); },
    writeFolder: async () => (linked ? (await writeFolder()) ?? [] : []),

    async compareFolder(f = linked){
      const text = await f.read('resume-data.json');
      if (text === null) return { same: false, disk: null };
      const mine = filesOf(store.materialize()).get('resume-data.json');
      if (text === mine) return { same: true, disk: null };
      try { return { same: false, disk: { record: load(dropProto(JSON.parse(text))).model } }; }
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
