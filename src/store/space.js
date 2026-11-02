// The linked folder as the person's resume space. persist.js writes this device's own file and the merged
// view; this reads what the folder holds besides: the other devices' files (merged by their clocks), files changed outside (a person, an agent, a sync tool), the documents (found
// by content, not by path), the Inbox (BrewCV/Inbox/), and BrewCV.md. Nothing here is deleted: a file the app takes away goes to BrewCV/Deleted/ (persist.js toDeleted), where a scan removes what the app put there after 30 days.
// A folder is the object persist.js describes (read, write, list, dirs, stat, readBytes, remove); the checks play two devices with two stores and one shared memoryFolder map.

import { t } from '../i18n/index.js';
import { merge } from '../model/merge.js';
import { readImport, applyOutsideEdits, lexiconFor } from '../model/import.js';
import { loadResume, dropProto, nameKey } from '../model/schema.js';
import { canon } from '../model/resumes.js';
import { openSaved } from '../model/resumes.js';
import { metaOf } from '../model/intake.js';
import { newResume } from '../model/resume.js';
import { sha256, safe, conflictCopy, ignored, readBackup, filesOf, uniqueName, keepOriginals } from './persist.js';

// ---- the tree ----

const KINDS = /\.(?:pdf|docx|odt|pages|md|txt|html?)$/i;      // what a scan lists; a font, code or a picture is not a resume
const TEXT = /\.(?:md|txt|html?)$/i;                          // notes: only the ones that look like a resume
const MAX = 20000, DEEP = 8;
const skipDir = (d, depth) => d.startsWith('.') || /^(?:node_modules|fonts?)$/i.test(d) || (depth === 0 && /^(?:BrewCV|Deleted|checkpoints)$/i.test(d));

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
//   dups    a second copy of a document's bytes elsewhere in the tree: told, never moved   [path]
//   inboxDups  a copy in BrewCV/Inbox/ of a file the Library already holds                [path]
//   fresh   resume-like files that are no document yet                      [{ path, size, mtime }]
export async function reconcile(state, root, cache = {}){
  const docs = (state.documents ?? []).filter(d => d.path), isDoc = new Set(docs.map(d => d.path)), sizes = new Set(docs.map(d => d.size));
  const current = new Map();      // a document's file, as it is now: path → hash
  const { files, stubs } = await walk(root), out = { moved: [], missing: [], cloud: [], changed: [], dups: [], inboxDups: [], fresh: [] };
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
    if (h) current.set(d.path, h);
    if (h === null) out.cloud.push({ id: d.id });      // listed and sized, but it cannot be read: not downloaded
    else if (h !== d.sha256) out.changed.push({ id: d.id, path: d.path, sha256: h });
    else if (byHash.has(d.sha256)){ out.dups.push(byHash.get(d.sha256)); byHash.delete(d.sha256); }
  }
  // A copy in the Inbox of a file the Library holds is a duplicate only when it is the very file the Library holds now: if that was edited since, the copy is the original and a file of its own.
  for (const n of await root.list(INBOX)){
    const p = `${INBOX}/${n}`, s = n.startsWith('.') || ignored(n) ? null : await root.stat(p), h = s ? await hash(p, s) : null;
    if (h && docs.some(d => !d.path.startsWith(`${INBOX}/`) && current.get(d.path) === h)) out.inboxDups.push(p);
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
const DOCS = 'Documents', INBOX = 'BrewCV/Inbox';
// The company a file's name gives a folder: only the form `<date> <company> - <role>` names one (`<date> General` does not), so a name with no role has none.
const nameCompany = m => (m?.role ? m.company : '');
// The folder of a document: `<base>/<search>/<company>/`, or `<base>/<search>/` when no company is known. The search is the round whose dates cover the date (a round runs from its start to its end,
// the start of the next or the day it was archived), else the date's year; a round's name with no year in front gets its start year. `where`: { rounds, base }, base being the setting (DOCS).
// shortcut: a round archived before archiving gave it an end date still has none and covers nothing, so a document dated inside it goes to its year; upgrade by giving such a round the end the person says.
export function docDir({ rounds = [], base = DOCS }, date, company){
  const day = /^\d{4}-\d\d-\d\d/.test(date ?? '') ? date.slice(0, 10) : today();
  const round = rounds.filter(r => String(r.from) <= day && (r.to ? day < String(r.to) : !r.archived)).reduce((a, r) => (!a || String(r.from) >= String(a.from) ? r : a), null);
  const name = round ? String(round.name) : '';
  const search = round ? (/^\d{4}\b/.test(name) ? name : `${String(round.from).slice(0, 4)} ${name}`) : day.slice(0, 4);
  return [base, safe(search, ''), safe(company ?? '', '')].filter(Boolean).join('/');
}
// a name in Documents/ that no other bytes use: " 2" when it is taken
async function free(root, path){
  const [, stem, ext = ''] = /^(.*?)(\.[^.]*)?$/.exec(path);
  let p = path, n = 2;
  while (await root.stat(p)) p = `${stem} ${n++}${ext}`;
  return p;
}
const split = name => { const ext = /\.[A-Za-z0-9]{1,5}$/.exec(name)?.[0] ?? ''; return { stem: name.slice(0, name.length - ext.length), ext }; };
export const pathFor = async (root, doc, where) => {
  const date = doc.meta?.date || String(doc.addedAt ?? '').slice(0, 10) || today(), { stem, ext } = split(doc.name);
  return free(root, `${docDir(where, date, nameCompany(doc.meta))}/${libraryName({ date, stem, ext })}`);
};

// The folders of `rel` under `base` (a path on the disk) that are not there yet are made, for a dialog to open in. Returns what takes away the ones this call made: it is called when nothing was saved there,
// and a folder that has a file in it by then stays (a removal that is not recursive refuses it). `fs`: the desktop app's fs plugin.
export async function ensureDirs(fs, base, rel){
  const made = [];
  let at = base;
  for (const seg of rel.split('/')){ at += `/${seg}`; if (!(await fs.exists(at))) made.push(at); }
  await fs.mkdir(`${base}/${rel}`, { recursive: true });
  return async () => { for (const d of made.reverse()) await fs.remove(d).catch(() => {}); };
}

// A file moved by copying it, reading the copy back, checking its hash, and only then taking the old one. A copy that fails is removed and the old file stays.
export async function moveFile(root, from, to){
  const bytes = await root.readBytes(from);
  if (bytes === null) throw new Error(t('i8.errRead', { path: from }));
  if (await root.stat(to)) throw new Error(t('i8.errTaken', { path: to }));
  const want = await sha256(bytes);
  try {
    await root.write(to, bytes);
    const back = await root.readBytes(to);
    if (!back || (await sha256(back)) !== want) throw new Error(t('i8.errCopy', { path: to }));
  } catch (e){ await root.remove(to); throw e; }
  await root.remove(from);
  return want;
}

// Where the app filed a document: its path before the search folder (a segment of four digits, alone or with a name: `2026`, `2026 Lisbon`), so `Applications/2026/2026 Lisbon/Acme/x.pdf` is `Applications/2026`. A file
// read in place (`Resumes/x.pdf`) has no search folder and no base, and its folder stays open to Organise.
// shortcut: the last such segment is the search folder, so a company called `2024 Foods` makes the base too long (it then protects less, never more); upgrade by keeping where a document was filed.
const baseOf = p => { const dirs = String(p ?? '').split('/').slice(0, -1), i = dirs.findLastIndex(x => /^\d{4}(?: |$)/.test(x)); return i > 0 ? dirs.slice(0, i).join('/') : ''; };
// The folders that hold documents: Documents/, the setting now, and the base of every document the app filed (the setting was changed and changed back, another device filed into one). A path under
// one of them, whatever the case a disk keeps, is the person's own: never listed as found, never moved.
const under = ({ base, held = [] }, p) => [DOCS, base, ...held].some(b => String(p).toLowerCase().startsWith(`${String(b).toLowerCase()}/`));
// Organise: the resume-like files outside those folders (and BrewCV/, which a scan skips) as a list of moves into Documents/<search>/<company>/, carried out one at a time only on OK. It stops at the first that cannot be copied; what was moved stays moved (and is in `done`, to undo), the rest is untouched.
export async function planOrganise(root, found, where){
  const out = [], taken = new Set();
  for (const f of found.filter(f => !under(where, f.path))){
    const name = f.path.split('/').at(-1), { stem, ext } = split(name), meta = metaOf(name, f.mtime > 1e11 ? f.mtime : Date.now()), date = meta.date, company = nameCompany(meta);
    let to = await free(root, `${docDir(where, date, company)}/${libraryName({ date, stem, ext })}`), n = 2;
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
// Moved: the record, the Library's lists, the saved resumes, this device's and the other devices' files and the checkpoints (a folder inside one too), all `.json`. A Deleted/ at the top is the person's, and stays.
const TOP = ['resume-data.v3.json', 'library.json', 'resume-data.json'], TOP_DIRS = ['recipes', 'recipes-v3', 'devices', 'checkpoints'];
async function files(root, dir, out = []){
  for (const n of await root.list(dir)) if (n.endsWith('.json') && !ignored(n)) out.push(`${dir}/${n}`);      // the app's files only: anything else in those folders is the person's
  for (const d of await root.dirs(dir)) await files(root, `${dir}/${d}`, out);
  return out;
}
export async function moveIntoBrewCV(root){
  const list = [];
  for (const n of TOP) if ((await root.stat(n)) && !(await root.stat(`BrewCV/${n}`))) list.push(n);
  for (const dir of TOP_DIRS) list.push(...await files(root, dir));
  list.sort((a, b) => (a === 'resume-data.json') - (b === 'resume-data.json'));
  for (const p of list){
    const bytes = await root.readBytes(p), want = await sha256(bytes);
    await root.write(`BrewCV/${p}`, bytes);      // makes the folders it needs
    const back = await root.readBytes(`BrewCV/${p}`);
    if (!back || (await sha256(back)) !== want){ await root.remove(`BrewCV/${p}`); throw new Error(t('i8.errCopy', { path: p })); }
  }
  for (const p of list) await root.remove(p);
  return list.length;
}

const okPath = p => typeof p === 'string' && !!p && !/^[\\/]|^[A-Za-z]:|\0/.test(p) && !p.split(/[\\/]/).includes('..');
const dataUrlBytes = url => Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), c => c.charCodeAt(0));
// the same file, whatever order a tool wrote its keys in (an older build, an editor)
const same = (a, b) => { try { return a === b || JSON.stringify(canon(JSON.parse(a))) === JSON.stringify(canon(JSON.parse(b))); } catch { return false; } };
const nameOfDevice = path => path.split('/').at(-1).replace(/\.json$/, '');

export function createSpace({ persist, store, now = () => new Date() }){
  const seen = new Map(), later = new Map(), verified = new Map(), status = new Map();
  let last = null, busy = null;
  const folder = () => (persist.folder?.space && persist.writer ? persist.folder : null);
  // Where documents go: a folder inside the linked one, kept on this device (a path is not a thing to share between machines). Changing it moves nothing: files are found by content.
  // shortcut: the desktop app takes a folder inside the linked one too, not any folder on the disk (a document's path is relative to the linked folder); upgrade when a decision is made on how an outside folder is recorded.
  const where = async () => ({ rounds: store.state.rounds ?? [], base: (await persist.local('docs')) || DOCS,
    held: [...new Set((store.state.documents ?? []).map(x => baseOf(x.path)).filter(Boolean))] });

  // the device files of this career that are not this device's, newest first
  // shortcut: every device file is read in full at each scan (they hold text only, so a few hundred KB); upgrade by comparing size and time first, as documents() does.
  async function others(d){
    const me = await persist.devicePath(), rid = store.state.record?.recordId ?? null, out = [];
    for (const n of await d.list('devices')){
      if (!n.endsWith('.json') || ignored(n)) continue;
      const path = `devices/${n}`, text = await d.read(path);
      if (path === me || text === null) continue;
      let got = null;
      try { got = readBackup(JSON.parse(text)); } catch { /* half written, or not a device file: it waits for the next scan */ }
      // a path in another device's file is the place of a file in this folder: one that is absolute, climbs out with .. or is not text points at nothing of ours
      for (const doc of got?.state.documents ?? []) if (doc.path !== undefined && !okPath(doc.path)) delete doc.path;
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

  const shape = s => JSON.stringify(canon({ record: s.record, resumes: s.resumes ?? [], frozen: s.frozen ?? {}, documents: s.documents ?? [], rounds: s.rounds ?? [], imports: s.imports ?? [] }));
  const reordered = m => shape(keepOriginals(structuredClone(m.state), store.materialize())) !== shape(store.materialize());
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
      } else if (reordered(m)) await persist.adoptMerge(m, t('i8.undoSync', { name: x.name }));      // nothing to tell, but the merge puts lists in an order this copy does not have: the same order on every device
      else await persist.adoptClock(m.clock);      // the file's stamps are now ones this copy has seen
      seen.set(x.path, h);
      r.changed += m.changed - (m.logged ? 1 : 0); r.summary.push(...m.summary); r.merged.push(x.path);
      r.devices.push({ path: x.path, name: x.name, saved: x.got.info.saved, state: 'merged' });
      if (conflictCopy(x.path.split('/').at(-1))) await persist.trash(x.path);      // a copy a sync tool made of a device file, merged like any other
    }
  }

  // A merged-view file somebody else wrote. resume-data.json: its body text edited outside becomes versions (the file as it was is kept in Deleted/ first). A conflict copy of one: the same, then
  // out of the way. A recipe that is not this device's own write (browser storage keeps the hashes) and is not what the merged state would write is read in as a saved resume of its own, never over
  // another: once it has been seen twice running and has not changed for ten minutes (a device's own file may still be on its way). A conflict copy of a recipe is read in the same way, at once, when
  // it says something no saved resume does, and then moved.
  // shortcut: a conflict copy's other changes to the career are not offered, only its outside edits (its content came from device files this scan has merged); library.json is derived, so one that is not this device's is kept in Deleted/ and written again.
  async function outsideEdits(p, text, r){
    const got = readImport(text, p);
    if (got.kind !== 'library' || !got.outside.length) return;
    store.commit(x => { applyOutsideEdits(x.record, got.outside); }, t('i8.undoOutside'));
    r.outside += got.outside.length;
  }
  function readIn(n, got, own, r){
    store.commit(x => {
      const rid = own ? n.normalize('NFC') : uniqueName(x.resumes ?? [], got.recipe);
      (x.resumes ??= []).push({ ...got.recipe, id: rid });
      if (got.frozen) (x.frozen ??= {})[rid] = got.frozen;
    }, t('i8.undoRecipe', { name: n }));
    r.absorbed++;
  }
  async function absorb(d, r){
    const mine = filesOf(store.materialize());
    for (const dir of ['', 'recipes']) for (const n of await d.list(dir)){
      const p = dir ? `${dir}/${n}` : n;
      if (ignored(n) || !n.endsWith('.json') || !conflictCopy(n) || (!dir && !/^(?:resume-data|library)/i.test(n))) continue;
      const text = await d.read(p);
      try { JSON.parse(text); } catch { continue; }      // still being written
      if (!dir && /^resume-data/i.test(n)) await outsideEdits(p, text, r);
      if (dir){
        try { const got = loadResume(dropProto(JSON.parse(text)), store.state.record); if (![...mine.values()].some(v => same(v, text))) readIn(n, got, false, r); }
        catch { continue; }      // not a saved resume: it waits
      }
      await persist.trash(p);
      r.conflicts.push(p);
    }
    const view = await d.read('resume-data.json');
    if (view !== null && !persist.knows('resume-data.json', await sha256(view))){
      try {
        JSON.parse(view);
        if (!same(mine.get('resume-data.json'), view)) await persist.trash('resume-data.json', { copy: true });      // it is about to be written over: what it says is kept (an older version put back, a file edited)
        await outsideEdits('resume-data.json', view, r);
        await persist.accept('resume-data.json', view);
      }
      catch { /* half written: next scan */ }
    }
    for (const n of await d.list('recipes')){
      const p = `recipes/${n}`;
      if (!n.endsWith('.json') || ignored(n) || conflictCopy(n)) continue;
      const text = await d.read(p), h = text === null ? null : await sha256(text);
      if (text === null || persist.knows(p, h)) continue;
      if (same(mine.get(p), text)){ await persist.accept(p, text); continue; }
      let got;
      try { got = loadResume(dropProto(JSON.parse(text)), store.state.record); } catch { continue; }      // does not parse: it waits
      const m = (await d.stat(p))?.mtime ?? 0;
      // shortcut: a device file that arrives more than ten minutes after its saved resume leaves a copy of that resume (nothing is lost; delete the copy); upgrade by keeping the hashes each device file says it wrote.
      if (m > 1e11 && m <= now() && now() - m < 600000) continue;      // written a moment ago: its device file may be on its way (a time in the future, a clock out of step, counts as old)
      if (later.get(p) !== h){ later.set(p, h); continue; }
      const taken = (store.state.resumes ?? []).some(x => nameKey(x.id) === nameKey(n.normalize('NFC')));
      readIn(n, got, !taken, r);
      later.delete(p);
      await persist.trash(p, { copy: true });      // it is about to be written over
      await persist.accept(p, text);
    }
  }

  // A document is a reference to a file in the folder: the original is written to Documents/ and the embedded copy dropped, once the file there is read back and its hash checked.
  async function reference(root, r){
    const embedded = (store.materialize().documents ?? []).filter(x => x.embedded && !x.path && String(x.embedded).startsWith('data:'));
    const done = [];
    for (const x of embedded){
      try {
        const to = await pathFor(root, x, await where()), bytes = dataUrlBytes(x.embedded);
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

  // shortcut: other bytes at a document's path (`edited`) are listed and shown on its card, not read again by themselves; a file the person drops in again is the way. The second copy of one hash keeps the document's own path, not the older name.
  async function documents(d, r){
    const root = d.root, cache = (await persist.local('scan')) ?? {};
    const was = JSON.stringify(cache), got = await reconcile(store.state, root, cache);
    if (JSON.stringify(cache) !== was) await persist.setLocal('scan', cache);
    status.clear();
    for (const [k, list] of [['cloud', got.cloud], ['missing', got.missing], ['changed', got.changed]]) for (const x of list) status.set(x.id, k);
    for (const x of store.state.documents ?? []) if (x.path && !status.has(x.id) && !got.moved.some(m => m.id === x.id)) verified.set(x.path, x.sha256);
    if (got.moved.length) store.commit(x => { for (const m of got.moved){ const y = x.documents.find(z => z.id === m.id); if (y) y.path = m.to; } }, t('i8.undoMoved'));
    for (const p of got.inboxDups) await persist.trash(p, { from: root });      // the same file in the Inbox and in Documents/: the one in Documents/ stays
    const w = await where();
    Object.assign(r, { moved: got.moved.length, missing: got.missing.length, cloud: got.cloud.length, edited: got.changed, fresh: got.fresh.filter(f => !under(w, f.path)), dups: got.dups });
  }

  async function brewcvMd(root){
    if ((await root.stat('BrewCV/BrewCV.md')) || (await persist.local('brewcvMd'))) return;      // written once; the person's to edit, or to delete, from then on
    await root.write('BrewCV/BrewCV.md', t('i8.brewcvMd'));
    await persist.setLocal('brewcvMd', true);
  }

  async function run(){
    const d = folder();
    if (!d){ last = null; return null; }
    const r = { merged: [], changed: 0, summary: [], waiting: [], other: [], devices: [], conflicts: [], outside: 0, absorbed: 0, fresh: [], inbox: [] };
    await mergeDevices(d, r);
    await absorb(d, r);
    await reference(d.root, r);
    await documents(d, r);
    await persist.writeFolder();
    await persist.sweep();
    await brewcvMd(d.root);
    r.inbox = (await d.root.list(INBOX)).filter(n => !n.startsWith('.') && !ignored(n)).map(n => `${INBOX}/${n}`);
    r.docs = (await where()).base;
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
  // Before an import is applied: each Inbox file that becomes a document is filed into Documents/<search>/<company>/ (copied, read back, its hash checked, then the old file goes) and its entry points
  // there, so the document is made with its final path in the one commit. A copy of a file the Library already holds goes to Deleted/. One that cannot be moved stays in the Inbox, referenced there.
  async function file(entries){
    const d = folder();
    if (!d) return entries;
    for (const e of entries.filter(x => x.path?.startsWith(`${INBOX}/`) && x.sha256)){
      try {
        const had = (store.state.documents ?? []).find(x => x.sha256 === e.sha256);
        if (had?.path && had.path !== e.path && (await sha256((await d.root.readBytes(had.path)) ?? new Uint8Array())) === e.sha256){ await persist.trash(e.path, { from: d.root }); e.path = had.path; continue; }      // the Library's file is still this one
        if (!['resume', 'letter', 'format', 'unread'].includes(e.status)) continue;
        const to = await pathFor(d.root, { name: e.name, meta: metaOf(e.name, e.modified), addedAt: now().toISOString() }, await where());
        verified.set(to, await moveFile(d.root, e.path, to));
        e.path = to;
      } catch { /* stays in the Inbox */ }
    }
    return entries;
  }

  return {
    // one scan at a time; a second call while one runs gets that one's answer
    sync: () => (busy ??= run().finally(() => { busy = null; })),
    probe, adopt, load, file,
    // false (nothing changed) for a folder the scan would not read: BrewCV's own, a dot-folder, one it skips, or one nested deeper than it goes (a document is two folders below the setting)
    setDocs: async v => {
      const segs = String(v ?? '').split(/[\\/]/).map(x => safe(x, '')).filter(Boolean), base = segs.join('/');
      if (segs.length + 2 > DEEP || segs.some((x, i) => skipDir(x, i))) return false;
      await persist.setLocal('docs', base === DOCS ? null : base);
      return true;
    },
    // the folder for a document of this date and company, now (the desktop app's Save dialog opens there)
    dirFor: async (date, company) => docDir(await where(), date, company),
    get last(){ return last; },
    devices: () => last?.devices ?? [],
    docStatus: id => status.get(id) ?? null,
    // the file at this document's path was read back and its hash checked: the receipt's third tick
    verified: x => !!x.path && verified.get(x.path) === x.sha256,
    // A device's file goes to Deleted/ only when what it holds is already merged (what it wrote after the last scan is not).
    async forget(path){
      const d = folder(), text = d && path.startsWith('devices/') ? await d.read(path) : null;
      if (text === null || seen.get(path) !== await sha256(text)) return false;
      await persist.trash(path);
      seen.delete(path);
      return true;
    },
    // shortcut: the moves Organise made are logged in this browser's storage, so Undo is for this device and does not outlast clearing it; upgrade by a log file per device in BrewCV/.
    plan: async () => planOrganise(folder().root, last?.fresh ?? [], await where()),
    async organise(plan){
      const d = folder(), res = await organise(d.root, plan ?? await planOrganise(d.root, last?.fresh ?? [], await where()));
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
