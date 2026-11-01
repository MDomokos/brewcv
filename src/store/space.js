// The linked folder as the person's resume space (spec: "The folder is the resume space", "Two devices, one synced folder"). persist.js writes this device's own file and the merged
// view; this reads what the folder holds besides: the other devices' files (merged by their clocks), files changed outside (a person, an agent, a sync tool), the documents (found
// by content, not by path), the Inbox, and BrewCV.md. Nothing here is deleted: a file the app takes away goes to Deleted/ (persist.js toDeleted), where a scan removes it after 30 days.
// A folder is the object persist.js describes (read, write, list, dirs, stat, readBytes, remove); the checks play two devices with two stores and one shared memoryFolder map.

import { t } from '../i18n/index.js';
import { merge } from '../model/merge.js';
import { readImport, applyOutsideEdits, lexiconFor } from '../model/import.js';
import { loadResume, dropProto, nameKey } from '../model/schema.js';
import { canon } from '../model/resumes.js';
import { openSaved } from '../model/resumes.js';
import { metaOf } from '../model/intake.js';
import { newResume } from '../model/resume.js';
import { sha256, safe, conflictCopy, ignored, readBackup, filesOf, toDeleted, sweepDeleted, uniqueName } from './persist.js';

// ---- the tree ----

const KINDS = /\.(?:pdf|docx|odt|pages|md|txt|html?)$/i;      // what a scan lists; a font, code or a picture is not a resume
const TEXT = /\.(?:md|txt|html?)$/i;                          // notes: only the ones that look like a resume
const MAX = 20000, DEEP = 8;
const skipDir = (d, depth) => d.startsWith('.') || /^(?:node_modules|fonts?)$/i.test(d) || (depth === 0 && /^(?:BrewCV|Inbox)$/i.test(d));

// Resume-like text: at least two of three signs (section titles on lines of their own, years, an address or a number to call).
// shortcut: English section words only; a note in another language needs two of the other signs. Upgrade by reading the lexicon of the interface language.
export function resumeLike(text){
  const low = String(text).slice(0, 200000).toLowerCase(), words = lexiconFor('en').titleWords;
  const titles = words.filter(w => low.split('\n').some(l => l.replace(/^[#*\s]+|[:*\s]+$/g, '') === w)).length;
  return (titles >= 2) + ((low.match(/\b(?:19|20)\d\d\b/g) ?? []).length >= 2) + /[\w.+-]+@[\w-]+\.[\w.-]+|\+?\d[\d ()-]{7,}\d/.test(low) >= 2;
}

// Every file of the tree a scan lists, and the `.name.icloud` stubs (a file iCloud keeps in the cloud) as the path of the file they stand for.
// shortcut: a folder of more than 20,000 such files is cut at that; a tree deeper than 8 is not read below it.
export async function walk(root, dir = '', depth = 0, out = { files: [], stubs: new Set() }){
  const at = n => (dir ? `${dir}/${n}` : n);
  for (const n of await root.list(dir)){
    if (/^\..+\.icloud$/.test(n)) out.stubs.add(at(n.slice(1, -7)));
    else if (!n.startsWith('.') && !ignored(n) && KINDS.test(n) && out.files.length < MAX) out.files.push(at(n));
  }
  if (depth < DEEP) for (const d of await root.dirs(dir)) if (!skipDir(d, depth)) await walk(root, at(d), depth + 1, out);
  return out;
}

// What the folder holds against what the state says of its documents. Found by content, not by path, and the size and time are compared before a file is hashed (`cache` keeps them for this device).
//   moved   a known hash at a new path (a move or rename made outside)     { id, to }
//   missing the file is gone                                                { id }
//   cloud   iCloud or another tool keeps it in the cloud                    { id }
//   changed other bytes at a known path: a new version of the document      { id, path, sha256 }
//   dups    a second copy of a document's bytes at another path             [path]
//   fresh   resume-like files that are no document yet                      [{ path, size, mtime }]
export async function reconcile(state, root, cache = {}){
  const docs = (state.documents ?? []).filter(d => d.path), isDoc = new Set(docs.map(d => d.path)), sizes = new Set(docs.map(d => d.size));
  const { files, stubs } = await walk(root), out = { moved: [], missing: [], cloud: [], changed: [], dups: [], fresh: [] };
  const hash = async (p, s) => {
    const c = cache[p];
    if (c && c.size === s.size && c.mtime === s.mtime) return c.sha256;
    const bytes = await root.readBytes(p);
    return bytes ? (cache[p] = { size: s.size, mtime: s.mtime, sha256: await sha256(bytes) }).sha256 : null;
  };
  const byHash = new Map(), fresh = [];
  for (const p of files.filter(p => !isDoc.has(p))){
    const s = await root.stat(p);
    if (!s) continue;
    fresh.push({ path: p, size: s.size, mtime: s.mtime });
    if (sizes.has(s.size)){ const h = await hash(p, s); if (h) byHash.set(h, p); }
  }
  for (const d of docs){
    const s = await root.stat(d.path);
    if (!s){
      const to = byHash.get(d.sha256);
      if (stubs.has(d.path)) out.cloud.push({ id: d.id });
      else if (to){ out.moved.push({ id: d.id, to }); byHash.delete(d.sha256); }
      else out.missing.push({ id: d.id });
      continue;
    }
    const h = await hash(d.path, s);
    if (h === null) out.cloud.push({ id: d.id });      // listed and sized, but it cannot be read: not downloaded
    else if (h !== d.sha256) out.changed.push({ id: d.id, path: d.path, sha256: h });
    else if (byHash.has(d.sha256)){ out.dups.push(byHash.get(d.sha256)); byHash.delete(d.sha256); }
  }
  const claimed = new Set([...out.moved.map(m => m.to), ...out.dups]);
  for (const f of fresh.filter(f => !claimed.has(f.path))){
    if (TEXT.test(f.path)){
      const c = cache[`like:${f.path}`];
      if (!(c && c.size === f.size && c.mtime === f.mtime)){
        const text = f.size < 400000 ? await root.read(f.path) : null;
        cache[`like:${f.path}`] = { size: f.size, mtime: f.mtime, like: text !== null && resumeLike(text) };
      }
      if (!cache[`like:${f.path}`].like) continue;
    }
    out.fresh.push(f);
  }
  return out;
}

// ---- names, copies and moves ----

// "2024-03-12 Acme - Product Designer (hu).pdf": the date, the company and the role, the language when it is not English. A file that already starts with a date keeps its name.
export function libraryName({ date, company, role, lang, stem, ext = '' }){
  if (/^\d{4}-\d\d-\d\d /.test(stem ?? '')) return safe(stem, 'resume') + ext;
  return safe(`${date} ${[company, role].filter(Boolean).join(' - ') || stem || 'resume'}${lang && lang !== 'en' ? ` (${lang})` : ''}`, 'resume') + ext;
}
const today = () => new Date().toISOString().slice(0, 10);
export const libraryDir = date => `Library/${/^\d{4}/.test(date ?? '') ? date.slice(0, 4) : today().slice(0, 4)}`;
// a name in Library/ that no other bytes use: " 2" when it is taken
async function free(root, path){
  const [, stem, ext = ''] = /^(.*?)(\.[^.]*)?$/.exec(path);
  let p = path, n = 2;
  while (await root.stat(p)) p = `${stem} ${n++}${ext}`;
  return p;
}
const split = name => { const ext = /\.[A-Za-z0-9]{1,5}$/.exec(name)?.[0] ?? ''; return { stem: name.slice(0, name.length - ext.length), ext }; };
export const pathFor = async (root, doc) => {
  const date = doc.meta?.date || String(doc.addedAt ?? '').slice(0, 10) || today(), { stem, ext } = split(doc.name);
  return free(root, `${libraryDir(date)}/${libraryName({ date, stem, ext })}`);
};

// A file moved by copying it, reading the copy back, checking its hash, and only then taking the old one. A copy that fails is removed and the old file stays.
export async function moveFile(root, from, to){
  const bytes = await root.readBytes(from);
  if (bytes === null) throw new Error(`${from}: cannot be read`);
  if (await root.stat(to)) throw new Error(`${to}: is taken`);
  const want = await sha256(bytes);
  try {
    await root.write(to, bytes);
    const back = await root.readBytes(to);
    if (!back || (await sha256(back)) !== want) throw new Error(`${to}: the copy did not read back the same`);
  } catch (e){ await root.remove(to); throw e; }
  await root.remove(from);
  return want;
}

// Organise: the resume-like files outside Library/ and Inbox/ as a list of moves into Library/<year>/, carried out one at a time only on OK. It stops at the first that cannot be copied; what was moved stays
// moved (and is in `done`, to undo), the rest is untouched.
export async function planOrganise(root, found){
  const out = [], taken = new Set();
  for (const f of found.filter(f => !f.path.startsWith('Library/'))){
    const name = f.path.split('/').at(-1), { stem, ext } = split(name), date = /^\d{4}-\d\d-\d\d /.test(stem) ? stem.slice(0, 10) : new Date(f.mtime > 1e11 ? f.mtime : Date.now()).toISOString().slice(0, 10);
    let to = await free(root, `${libraryDir(date)}/${libraryName({ date, stem, ext })}`), n = 2;
    while (taken.has(to)) to = to.replace(/(?: \d+)?(\.[^.]*)?$/, ` ${n++}$1`);
    taken.add(to);
    out.push({ from: f.path, to });
  }
  return out;
}
export async function organise(root, moves){
  const done = [];
  for (const m of moves){
    try { done.push({ ...m, sha256: await moveFile(root, m.from, m.to) }); }
    catch (e){ return { done, failed: m, error: e.message, left: moves.slice(done.length + 1) }; }
  }
  return { done, failed: null, left: [] };
}
export async function undoOrganise(root, done){
  const back = [];
  for (const m of [...done].reverse()) try { await moveFile(root, m.to, m.from); back.push(m); } catch { /* the place it came from is taken: it stays where it is */ }
  return back;
}

// An older folder keeps its data at the top. Moved into BrewCV/ once, on OK: every copy is made and checked first (resume-data.json last, since it is what makes BrewCV/ the data folder), then the old files go.
const TOP = ['resume-data.v3.json', 'library.json', 'resume-data.json'], TOP_DIRS = ['recipes', 'recipes-v3', 'checkpoints'];
export async function moveIntoBrewCV(root){
  const list = [];
  for (const n of TOP) if ((await root.stat(n)) && !(await root.stat(`BrewCV/${n}`))) list.push(n);
  for (const dir of TOP_DIRS) for (const n of await root.list(dir)) if (!ignored(n)) list.push(`${dir}/${n}`);
  list.sort((a, b) => (a === 'resume-data.json') - (b === 'resume-data.json'));
  for (const p of list){
    const bytes = await root.readBytes(p), want = await sha256(bytes);
    await root.write(`BrewCV/${p}`, bytes);
    const back = await root.readBytes(`BrewCV/${p}`);
    if (!back || (await sha256(back)) !== want){ await root.remove(`BrewCV/${p}`); throw new Error(`${p}: the copy did not read back the same`); }
  }
  for (const p of list) await root.remove(p);
  return list.length;
}

const dataUrlBytes = url => Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), c => c.charCodeAt(0));
// the same file, whatever order a tool wrote its keys in (an older build, an editor)
const same = (a, b) => { try { return a === b || JSON.stringify(canon(JSON.parse(a))) === JSON.stringify(canon(JSON.parse(b))); } catch { return false; } };
const nameOfDevice = path => path.split('/').at(-1).replace(/\.json$/, '');

export function createSpace({ persist, store, now = () => new Date() }){
  const seen = new Map(), later = new Map(), verified = new Map(), status = new Map();
  let last = null, busy = null;
  const folder = () => (persist.folder?.space && persist.writer ? persist.folder : null);

  // the device files of this career that are not this device's, newest first
  async function others(d){
    const me = await persist.devicePath(), rid = store.state.record?.recordId ?? null, out = [];
    for (const n of await d.list('devices')){
      if (!n.endsWith('.json') || ignored(n)) continue;
      const path = `devices/${n}`, text = await d.read(path);
      if (path === me || text === null) continue;
      let got = null;
      try { got = readBackup(JSON.parse(text)); } catch { /* half written, or not a device file: it waits for the next scan */ }
      out.push({ path, name: nameOfDevice(path), text, got, same: !!got && !!rid && got.info.recordId === rid });
    }
    return out.sort((a, b) => String(b.got?.info.saved).localeCompare(String(a.got?.info.saved)));
  }

  // Before a folder is linked: is there a career in it to merge with this one, or a different one to ask about?
  async function probe(d){
    const all = await others(d);
    return { mergeable: all.some(x => x.same), newest: all.find(x => x.got && !x.same) ?? null };
  }
  // The person chose the folder's career over this device's: the newest device file becomes the state, with its clock, and the others merge into it.
  async function adopt(x){
    await persist.checkpoint(t('i8.checkpointAdopt', { name: x.name }), 'replace');
    const state = structuredClone(x.got.state);
    if (state.openId) openSaved(state, state.openId);
    if (!state.cur){ state.cur = newResume(state.record, { format: 'a4' }); state.openId = null; }
    store.replace(state, t('i8.undoAdopt', { name: x.name }));
    await persist.markFileOpened({ at: x.got.info.saved ?? now().toISOString(), recordId: state.record.recordId ?? null, hash: null, clock: x.got.info.clock });
  }

  async function mergeDevices(d, r){
    for (const x of await others(d)){
      const h = await sha256(x.text);
      if (seen.get(x.path) === h) { r.devices.push({ path: x.path, name: x.name, saved: x.got?.info.saved, state: 'merged' }); continue; }
      if (!x.got){ r.waiting.push(x.path); r.devices.push({ path: x.path, name: x.name, state: 'waiting' }); continue; }
      if (!x.same || !x.got.info.clock){ r.other.push(x.path); r.devices.push({ path: x.path, name: x.name, saved: x.got.info.saved, state: 'other' }); continue; }
      const m = merge(await persist.forMerge(x.got.info.clock), { state: x.got.state, clock: x.got.info.clock });
      if (m.changed){
        await persist.checkpoint(t('i8.checkpointSync', { name: x.name }), 'merge');
        await persist.adoptMerge(m, t('i8.undoSync', { name: x.name }));
      } else await persist.adoptClock(m.clock);      // the file's stamps are now ones this copy has seen
      seen.set(x.path, h);
      r.changed += m.changed - (m.logged ? 1 : 0); r.summary.push(...m.summary); r.merged.push(x.path);
      r.devices.push({ path: x.path, name: x.name, saved: x.got.info.saved, state: 'merged' });
      if (conflictCopy(x.path)) await toDeleted(d, x.path);      // a copy a sync tool made of a device file, merged like any other
    }
  }

  // A merged-view file somebody else wrote. resume-data.json: its body text edited outside becomes versions (the file as it was is kept in Deleted/ first). A conflict copy of one: the same, then
  // out of the way. A recipe the app has no resume for, or one that differs from it, is read in as a saved resume of its own once it has been seen twice running (a device's own file may still be on its way).
  // shortcut: a conflict copy's other changes are not offered, only its outside edits (its content came from device files this scan has merged); library.json written by hand is written over.
  async function outsideEdits(d, p, text, r){
    const got = readImport(text, p);
    if (got.kind !== 'library' || !got.outside.length) return;
    await toDeleted(d, p, { copy: true });
    store.commit(x => { applyOutsideEdits(x.record, got.outside); }, t('i8.undoOutside'));
    r.outside += got.outside.length;
  }
  async function absorb(d, r){
    for (const dir of ['', 'recipes']) for (const n of await d.list(dir)){
      const p = dir ? `${dir}/${n}` : n;
      if (ignored(n) || !n.endsWith('.json') || !conflictCopy(n) || (!dir && !/^(?:resume-data|library)/i.test(n))) continue;
      const text = await d.read(p);
      try { JSON.parse(text); } catch { continue; }      // still being written
      if (!dir && /^resume-data/i.test(n)) await outsideEdits(d, p, text, r);
      await toDeleted(d, p);
      r.conflicts.push(p);
    }
    const view = await d.read('resume-data.json');
    if (view !== null && !persist.knows('resume-data.json', await sha256(view))){
      try { JSON.parse(view); await outsideEdits(d, 'resume-data.json', view, r); await persist.accept('resume-data.json', view); }
      catch { /* half written: next scan */ }
    }
    const mine = filesOf(store.materialize());
    for (const n of await d.list('recipes')){
      const p = `recipes/${n}`;
      if (!n.endsWith('.json') || ignored(n) || conflictCopy(n)) continue;
      const text = await d.read(p), h = text === null ? null : await sha256(text);
      if (text === null || persist.knows(p, h)) continue;
      if (same(mine.get(p), text)){ await persist.accept(p, text); continue; }
      let got;
      try { got = loadResume(dropProto(JSON.parse(text)), store.state.record); } catch { continue; }      // does not parse: it waits
      if (later.get(p) !== h){ later.set(p, h); continue; }
      const id = n.normalize('NFC'), list = store.state.resumes ?? [], taken = list.some(x => nameKey(x.id) === nameKey(id));
      store.commit(x => {
        const rid = taken ? uniqueName(x.resumes, got.recipe) : id;
        (x.resumes ??= []).push({ ...got.recipe, id: rid });
        if (got.frozen) (x.frozen ??= {})[rid] = got.frozen;
      }, t('i8.undoRecipe', { name: n }));
      later.delete(p); r.absorbed++;
      await persist.accept(p, text);
    }
  }

  // A document is a reference to a file in the folder: the original is written to Library/ and the embedded copy dropped, once the file there is read back and its hash checked.
  async function reference(root, r){
    const embedded = (store.materialize().documents ?? []).filter(x => x.embedded && !x.path && String(x.embedded).startsWith('data:'));
    const done = [];
    for (const x of embedded){
      try {
        const to = await pathFor(root, x), bytes = dataUrlBytes(x.embedded);
        if ((await sha256(bytes)) !== x.sha256) continue;      // the stored original is not the file the document says; it stays where it is
        await root.write(to, bytes);
        const back = await root.readBytes(to);
        if (!back || (await sha256(back)) !== x.sha256){ await root.remove(to); continue; }
        verified.set(to, x.sha256); done.push({ id: x.id, to });
      } catch { /* it stays embedded; the next scan tries again */ }
    }
    if (!done.length) return;
    store.commit(d => { for (const m of done){ const x = d.documents.find(y => y.id === m.id); if (x){ x.path = m.to; delete x.embedded; } } }, t('i8.undoReference'));
    store.gcAssets();
    r.referenced = done.length;
  }

  async function documents(d, r){
    const root = d.root, cache = (await persist.local('scan')) ?? {};
    const got = await reconcile(store.state, root, cache);
    await persist.setLocal('scan', cache);
    status.clear();
    for (const [k, list] of [['cloud', got.cloud], ['missing', got.missing], ['changed', got.changed]]) for (const x of list) status.set(x.id, k);
    for (const x of store.state.documents ?? []) if (x.path && !status.has(x.id) && !got.moved.some(m => m.id === x.id)) verified.set(x.path, x.sha256);
    if (got.moved.length) store.commit(x => { for (const m of got.moved){ const y = x.documents.find(z => z.id === m.id); if (y) y.path = m.to; } }, t('i8.undoMoved'));
    for (const p of got.dups) await toDeleted(d, p, { from: root });      // one hash at two paths: the document's own copy stays
    Object.assign(r, { moved: got.moved.length, missing: got.missing.length, cloud: got.cloud.length, edited: got.changed, fresh: got.fresh, dups: got.dups.length });
  }

  async function brewcvMd(root){
    if ((await root.stat('BrewCV.md')) || (await persist.local('brewcvMd'))) return;      // written once; the person's to edit, or to delete, from then on
    await root.write('BrewCV.md', t('i8.brewcvMd'));
    await persist.setLocal('brewcvMd', true);
  }

  async function run(){
    const d = folder();
    if (!d) return null;
    const r = { merged: [], changed: 0, summary: [], waiting: [], other: [], devices: [], conflicts: [], outside: 0, absorbed: 0, fresh: [], inbox: [] };
    await mergeDevices(d, r);
    await absorb(d, r);
    await reference(d.root, r);
    await documents(d, r);
    await persist.writeFolder();
    await sweepDeleted(d, now());
    await brewcvMd(d.root);
    r.inbox = (await d.root.list('Inbox')).filter(n => !n.startsWith('.') && !ignored(n)).map(n => `Inbox/${n}`);
    const me = await persist.devicePath();
    r.devices.unshift({ path: me, name: nameOfDevice(me), saved: now().toISOString(), state: 'mine', mine: true });
    return (last = r);
  }

  // The Inbox's (or a found file's) bytes as the objects the import door takes in place of the browser's File.
  async function load(paths){
    const root = folder().root, out = [];
    for (const path of paths){
      const bytes = await root.readBytes(path), s = await root.stat(path);
      if (bytes) out.push({ name: path.split('/').at(-1), path, size: bytes.length, type: '', lastModified: s?.mtime ?? 0, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => new TextDecoder().decode(bytes) });
    }
    return out;
  }
  // Before an import is applied: each Inbox file that becomes a document is filed into Library/<year>/ (copied, read back, its hash checked, then the old file goes) and its entry points
  // there, so the document is made with its final path in the one commit. A copy of a file the Library already holds goes to Deleted/. One that cannot be moved stays in Inbox/, referenced there.
  async function file(entries){
    const d = folder();
    if (!d) return entries;
    for (const e of entries.filter(x => x.path?.startsWith('Inbox/') && x.sha256)){
      try {
        const had = (store.state.documents ?? []).find(x => x.sha256 === e.sha256);
        if (had?.path && had.path !== e.path && await d.root.stat(had.path)){ await toDeleted(d, e.path, { from: d.root }); e.path = had.path; continue; }
        if (!['resume', 'letter', 'format', 'unread'].includes(e.status)) continue;
        const to = await pathFor(d.root, { name: e.name, meta: metaOf(e.name, e.modified), addedAt: now().toISOString() });
        verified.set(to, await moveFile(d.root, e.path, to));
        e.path = to;
      } catch { /* stays in Inbox/ */ }
    }
    return entries;
  }

  return {
    // one scan at a time; a second call while one runs gets that one's answer
    sync: () => (busy ??= run().finally(() => { busy = null; })),
    probe, adopt, load, file,
    get last(){ return last; },
    devices: () => last?.devices ?? [],
    docStatus: id => status.get(id) ?? null,
    // the file at this document's path was read back and its hash checked: the receipt's third tick
    verified: x => !!x.path && verified.get(x.path) === x.sha256,
    async forget(path){ const d = folder(); if (d && path.startsWith('devices/')){ await toDeleted(d, path); seen.delete(path); } },
    plan: () => planOrganise(folder().root, last?.fresh ?? []),
    async organise(plan){
      const d = folder(), res = await organise(d.root, plan ?? await planOrganise(d.root, last?.fresh ?? []));
      await persist.setLocal('moves', [...((await persist.local('moves')) ?? []), ...res.done]);
      const to = new Map(res.done.map(m => [m.from, m.to]));
      if (to.size) store.commit(x => { for (const y of x.documents ?? []) if (to.has(y.path)) y.path = to.get(y.path); }, t('i8.undoOrganise'));
      return res;
    },
    async undoOrganise(){
      const d = folder(), back = await undoOrganise(d.root, (await persist.local('moves')) ?? []);
      await persist.setLocal('moves', []);
      const to = new Map(back.map(m => [m.to, m.from]));
      if (to.size) store.commit(x => { for (const y of x.documents ?? []) if (to.has(y.path)) y.path = to.get(y.path); }, t('i8.undoOrganise'));
      return back;
    },
  };
}
