// The scenarios of the resume space (src/store/space.js, and the device file in src/store/persist.js), played against whatever folder `make()` gives: memoryFolder (checks/folder-sync-check.mjs)
// or the desktop app's tauriFolder over a fake window.__TAURI__ (checks/tauri-folder-check.mjs). Two devices are two stores, two backends and two folder objects over one storage.
// make() -> { fx, root }: fx is a Map-like view of the storage (paths from the linked folder, text or bytes), root() a new folder object over it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../../src/model/schema.js';
import * as RS from '../../src/model/resumes.js';
import * as DOC from '../../src/model/documents.js';
import * as X from '../../src/model/intake.js';
import { createStore } from '../../src/store/store.js';
import { createPersist, memoryBackend, dataFolder, readFolder, readBackup, filesOf, sha256, toDeleted, sweepDeleted, conflictCopy } from '../../src/store/persist.js';
import { createSpace, moveIntoBrewCV, planOrganise, organise, undoOrganise, reconcile, ensureDirs } from '../../src/store/space.js';
import { clockFits } from '../../src/model/merge.js';
import { readLibrary } from '../../scripts/lib/library.mjs';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { renderPages } from '../../src/render.js';
import { createDocument } from '../../scripts/lib/dom.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const J = JSON.stringify;
const instant = { debounceMs: 0, setTimer: fn => { fn(); return 0; }, clearTimer: () => {} };

export const model = S.load(read('data/example.json')).model;
S.ensureRecordId(model);
const names = read('data/example-resumes/index.json');
export function exampleState(){
  const resumes = [], frozen = {};
  for (const n of names.slice(0, 2)){ const got = S.loadResume(read(`data/example-resumes/${n}`), model); resumes.push({ ...got.recipe, id: n }); frozen[n] = got.frozen; }
  const st = { record: structuredClone(model), resumes, frozen, cur: null, openId: null };
  RS.openSaved(st, resumes[0].id);
  return st;
}
// a device: its own store, backend and persist, and its own folder object on the shared storage
async function device(M, name, extra = {}){
  const store = createStore(extra.state ?? exampleState());
  const persist = createPersist({ store, backend: extra.backend ?? memoryBackend(), deviceName: name, ...instant, ...extra.persist });
  const folder = M.root(), data = await dataFolder(folder);
  const space = createSpace({ persist, store });
  return { store, persist, folder, data, space, files: M };
}
// every saved resume of a device, printed: the hash of its pages
const printed = d => d.store.state.resumes.map(r => crypto.createHash('sha256').update(renderPages(d.store.state.record, r, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('\n')).digest('hex')).join();
const view = d => [...filesOf(d.store.materialize())].map(([k, v]) => `${k}\n${v}`).join('\n=====\n');
const label = d => d.store.state.record.basics.label;
const edit = (d, fn, what = 'edit') => { d.store.commit(fn, what); return d.persist.flush(); };
const at = (map, p) => map.get(`BrewCV/${p}`);
const has = (map, p) => map.has(`BrewCV/${p}`);
const listed = (map, dir) => [...map.keys()].filter(k => k.startsWith(`BrewCV/${dir}/`)).map(k => k.slice(`BrewCV/${dir}/`.length)).filter(n => dir !== 'Deleted' || !/^index /.test(n));      // Deleted/ also holds the index of what the app moved there
const deviceFiles = map => [...map.keys()].filter(k => /^BrewCV\/devices\/[^/]+\.json$/.test(k));

export async function scenarios({ ok, section, make }){
section('two devices, one folder: each edits alone, then they meet');
const M = make(), shared = M.fx;
const A = await device(M, 'Mac');
const startState = structuredClone(A.store.state);
const B = await device(M, 'Linux', { state: structuredClone(startState) });
{
  ok('the folder is linked into BrewCV/ and nothing is written by the link itself', (await A.persist.link(A.data)) !== null && shared.size === 0);
  await A.space.sync();
  ok('the first sync writes the merged view and this device’s own file in BrewCV/', has(shared, 'resume-data.json') && listed(shared, 'recipes').length === 2 && deviceFiles(shared).length === 1 && /^BrewCV\/devices\/Mac [0-9a-f]{4}\.json$/.test(deviceFiles(shared)[0]));
  ok('the app writes nothing at the top of the folder except Documents/ and BrewCV/', [...shared.keys()].every(k => k.startsWith('BrewCV/') || k.startsWith('Documents/')) && has(shared, 'BrewCV.md'));
  await B.persist.link(B.data);
  const r = await B.space.sync();
  ok('a second device of the same career finds the first’s file and merges it with nothing to change', r.merged.length === 1 && r.changed === 0 && deviceFiles(shared).length === 2, J(r.merged));
  await edit(A, d => { d.record.basics.label = 'Edited on the Mac'; }, 'A edits');
  await edit(B, d => { d.record.basics.url = 'https://example.com/b'; RS.duplicate(d, names[0], { name: 'Linux copy' }); }, 'B edits');
  ok('each device has only its own edit before they meet', label(A) === 'Edited on the Mac' && label(B) !== 'Edited on the Mac' && A.store.state.record.basics.url !== 'https://example.com/b' && A.store.state.resumes.length === 2 && B.store.state.resumes.length === 3);
  const before = view(B);
  const ra = await A.space.sync(), rb = await B.space.sync(), rc = await A.space.sync();
  ok('they meet: each merged the other’s file', ra.merged.length === 1 && rb.merged.length === 1 && ra.changed > 0 && rb.changed > 0, `${ra.changed} ${rb.changed}`);
  await A.persist.flush(); await B.persist.flush();
  ok('both end with the same career and the same saved resumes, byte for byte', view(A) === view(B) && label(B) === 'Edited on the Mac' && A.store.state.record.basics.url === 'https://example.com/b' && A.store.state.resumes.length === 3 && view(B) !== before);
  const cA = JSON.parse(at(shared, [...shared.keys()].find(k => /devices\/Mac/.test(k)).slice(7))), cB = JSON.parse(at(shared, [...shared.keys()].find(k => /devices\/Linux/.test(k)).slice(7)));
  ok('each device file is whole: its clock fits what it holds (the stamp is made at every write), and the two end with one clock', clockFits(readBackup(cA).state, readBackup(cA).info.clock) && clockFits(readBackup(cB).state, readBackup(cB).info.clock) && J(cA.clock.keys) === J(cB.clock.keys));
  ok('a device file holds no original, and the merged view on disk is what both hold', cA.resumeBuilderBackup === 1 && !J(cA).includes('"embedded"') && at(shared, 'resume-data.json') === filesOf(A.store.materialize()).get('resume-data.json'));
  await A.space.sync(); await B.space.sync();
  ok('meeting again changes nothing', view(A) === view(B) && rc.merged.length === 1);
  const writes = [];
  for (const d of [A, B]){ const w = d.folder.write; d.folder.write = async (p, ...a) => { writes.push(p); return w.call(d.folder, p, ...a); }; }
  await A.space.sync(); await B.space.sync(); await A.space.sync(); await B.space.sync();
  ok('once they have met, nothing is written any more: two devices do not keep each other busy', writes.length === 0, J(writes));
  const dev = A.space.devices();
  ok('the devices are listed with this one first', dev[0].mine && dev.length === 2 && dev.some(x => x.state === 'merged' && /Linux/.test(x.name)));
}

section('a conflict copy of the merged view, and a file edited outside');
{
  const text = at(shared, 'resume-data.json');
  const names3 = ['resume-data.sync-conflict-20261101-120000-ABCDEFG.json', 'resume-data (conflicted copy).json', 'resume-data_MacBook_Nov-01-1200-2026_FileConflict.json', 'resume-data 2.json'];
  for (const n of names3) shared.set(`BrewCV/${n}`, text);
  shared.set('BrewCV/recipes/Linux copy.sync-conflict-20261101-120000-ABCDEFG.json', at(shared, 'recipes/Linux copy.json'));
  const rec = A.store.state.record, before = J(rec);
  const r = await A.space.sync();
  ok('every conflict copy is absorbed, adds nothing, and is moved to Deleted/', r.conflicts.length === 5 && names3.every(n => !has(shared, n)) && !has(shared, 'recipes/Linux copy.sync-conflict-20261101-120000-ABCDEFG.json') && J(A.store.state.record) === before, J(r.conflicts));
  ok('…where Finder can see it, as <day> <name>', listed(shared, 'Deleted').filter(n => /conflict|resume-data 2|Linux copy/i.test(n)).length === 5 && listed(shared, 'Deleted').every(n => /^\d{4}-\d\d-\d\d /.test(n)), J(listed(shared, 'Deleted')));
  ok('…and the merged view itself is untouched', at(shared, 'resume-data.json') === text);

  // an agent edits a bullet in resume-data.json
  const file = JSON.parse(at(shared, 'resume-data.json'));
  const w = file.work.find(x => (x.highlights ?? []).length), was = w.highlights[0];
  w.highlights[0] = `${was} (checked outside)`;
  shared.set('BrewCV/resume-data.json', S.serialize(file));
  const versions = A.store.state.record.variants.length;
  const r2 = await A.space.sync();
  ok('a resume-data.json whose hash is no device’s write goes through outsideEdits: the edited line is a new version', r2.outside === 1 && A.store.state.record.variants.length === versions + 1 && A.store.state.record.variants.some(v => v.text === `${was} (checked outside)`));
  ok('…the file as it was edited is kept in Deleted/, and the merged view is written again', listed(shared, 'Deleted').some(n => /resume-data \(\w+\)( \d+)?\.json$/.test(n)) && !at(shared, 'resume-data.json').includes('(checked outside)') === false && at(shared, 'resume-data.json') === filesOf(A.store.materialize()).get('resume-data.json'));
  await B.space.sync(); await A.space.sync();
  ok('the other device gets the new version through the device file', B.store.state.record.variants.some(v => v.text === `${was} (checked outside)`) && view(A) === view(B));

  // a new recipe put in recipes/ by hand is a saved resume, once it has been seen twice
  const [, newText] = [...filesOf((() => { const s = exampleState(); RS.duplicate(s, names[0], { name: 'Placed by hand' }); return s; })())].find(([k]) => k === 'recipes/Placed by hand.json');
  shared.set('BrewCV/recipes/Placed by hand.json', newText);
  const n0 = A.store.state.resumes.length;
  await A.space.sync();
  ok('a recipe the app has no resume for waits one scan (a device’s file may still be on its way)', A.store.state.resumes.length === n0 && at(shared, 'recipes/Placed by hand.json') === newText);
  await A.space.sync();
  ok('…and is read in as a saved resume the second time', A.store.state.resumes.length === n0 + 1 && A.store.state.resumes.some(r => r.id === 'Placed by hand.json'));
  // a file whose time is in the future (a clock out of step) is not held back for days
  const [, futureText] = [...filesOf((() => { const s = exampleState(); RS.duplicate(s, names[0], { name: 'From a fast clock' }); return s; })())].find(([k]) => k === 'recipes/From a fast clock.json');
  shared.set('BrewCV/recipes/From a fast clock.json', futureText); shared.later('BrewCV/recipes/From a fast clock.json');
  await A.space.sync(); await A.space.sync();
  ok('…a file dated in the future is read in like any other, not held back', A.store.state.resumes.some(r => r.id === 'From a fast clock.json'));
  await edit(A, d => RS.deleteSaved(d, 'From a fast clock.json'), 'delete');
  // a recipe edited outside is kept, as a resume of its own, and never written over unread
  const edited = JSON.parse(at(shared, 'recipes/Placed by hand.json'));
  edited.meta.resumeBuilder.resume.company = 'Edited Outside Co';
  const editedText = S.serialize(edited);
  await A.space.sync();
  shared.set('BrewCV/recipes/Placed by hand.json', editedText);
  await edit(A, d => { d.resumes.find(r => r.id === 'Placed by hand.json').pageLimit = 3; }, 'x');
  ok('a saved resume file changed outside is not written over: the same guard as resume-data.json', at(shared, 'recipes/Placed by hand.json') === editedText);
  await A.space.sync(); await A.space.sync();
  ok('…and is read in as a copy next to it', A.store.state.resumes.filter(r => r.company === 'Edited Outside Co').length === 1 && A.store.state.resumes.some(r => r.company !== 'Edited Outside Co' && r.id === 'Placed by hand.json'));
  await B.space.sync(); await A.space.sync(); await B.space.sync();
  ok('…and both devices still end the same', view(A) === view(B));
  // a recipe is removed only into Deleted/
  await edit(A, d => RS.deleteSaved(d, 'Linux copy.json'), 'delete');
  ok('a deleted saved resume’s file goes to Deleted/, never unlinked', !has(shared, 'recipes/Linux copy.json') && listed(shared, 'Deleted').some(n => /Linux copy.*\.json$/.test(n)));
  await B.space.sync(); await A.space.sync();
  ok('…and the other device lets it go too', !B.store.state.resumes.some(r => r.id === 'Linux copy.json') && view(A) === view(B));
}

section('files that are not finished are skipped, then read once complete');
{
  const text = at(shared, [...shared.keys()].find(k => /devices\/Linux/.test(k)).slice(7));
  const path = 'BrewCV/devices/Phone 9999.json';
  const other = await device(make(), 'Phone', { state: structuredClone(A.store.state) });
  await edit(other, d => { d.record.basics.phone = '+00 000 000 000'; }, 'phone');
    await other.persist.link(other.data); await other.space.sync();
  const theirs = [...other.files.fx.entries()].find(([k]) => /devices\//.test(k))[1];
  shared.set(path, theirs.slice(0, Math.floor(theirs.length / 2)));
  shared.set('BrewCV/devices/.syncthing.Phone 9999.json.tmp', theirs.slice(0, 10));
  shared.set('BrewCV/devices/~$Phone.json', 'x');
  shared.set('BrewCV/recipes/.syncthing.x.json.tmp', '{"half":');
  shared.set('BrewCV/recipes/~$x.json', 'x');
  shared.set('BrewCV/recipes/a.tmp', 'x');
  const phone = A.store.state.record.basics.phone, n = A.store.state.resumes.length;
  const r = await A.space.sync();
  ok('a device file that does not parse waits: nothing changes and it is named', r.waiting.includes('devices/Phone 9999.json') && A.store.state.record.basics.phone === phone && A.store.state.resumes.length === n, J(r.waiting));
  ok('temp and lock files are never read, never taken for damage and never in a warning', !r.waiting.some(x => /tmp|~\$/.test(x)) && r.conflicts.length === 0 && shared.has('BrewCV/devices/~$Phone.json') && shared.has('BrewCV/recipes/a.tmp'));
  shared.set(path, theirs);
  const r2 = await A.space.sync();
  ok('once the file is whole it is merged', r2.merged.includes('devices/Phone 9999.json') && A.store.state.record.basics.phone === '+00 000 000 000');
  // the next device is not the same career
  const rid = A.store.state.record.recordId;
  const alien = JSON.parse(theirs); alien.recordId = 'someone-else'; alien.record.meta.resumeBuilder.recordId = 'someone-else';
  shared.set('BrewCV/devices/Alien 0001.json', J(alien));
  const r3 = await A.space.sync();
  ok('a device file of another career is never merged, only named', r3.other.includes('devices/Alien 0001.json') && A.store.state.record.recordId === rid);
  shared.delete('BrewCV/devices/Alien 0001.json');
}

section('a document moved, renamed or deleted outside');
{
  const bytes = new TextEncoder().encode('A resume as a text file. Led the dosing system redesign.\n');
  const sha = await sha256(bytes);
  const p1 = 'Documents/2024/Acme/2024-03-12 Acme - Designer.txt';
  shared.set(p1, bytes);
  await edit(A, d => { DOC.addDocument(d, { name: '2024-03-12 Acme - Designer.txt', type: 'text/plain', path: p1, sha256: sha, size: bytes.length, text: 'Led the dosing system redesign.', meta: { company: 'Acme', role: 'Designer', date: '2024-03-12', lang: 'en', jobType: '', kind: 'resume' } }); }, 'document');
  const id = DOC.docId(sha), docOf = d => d.store.state.documents.find(x => x.id === id);
  const recBefore = J(A.store.state.record), printBefore = printed(A);
  await A.space.sync();
  ok('a document at its path is in the folder: nothing changes, and the receipt can tell it was read back', A.space.last.moved === 0 && A.space.last.missing === 0 && A.space.docStatus(id) === null && A.space.verified(docOf(A)));
  const p2 = 'Documents/2025/Acme/2024-03-12 Acme - Designer renamed.txt';
  shared.set(p2, shared.get(p1)); shared.delete(p1);
  await A.space.sync();
  ok('a file renamed outside keeps its document: found by its hash, the path is updated quietly', docOf(A).path === p2 && A.space.last.moved === 1 && A.store.state.documents.length === 1 && J(A.store.state.record) === recBefore);
  await edit(A, () => {}, 'noop');
  await B.space.sync();
  ok('…and the other device gets the new path', docOf(B)?.path === p2);
  shared.delete(p2);
  await A.space.sync();
  ok('a file deleted outside is reported, and what was taken from it stays in the career', A.space.last.missing === 1 && A.space.docStatus(id) === 'missing' && !!docOf(A) && J(A.store.state.record) === recBefore);
  shared.set('Documents/2025/Acme/.2024-03-12 Acme - Designer renamed.txt.icloud', new Uint8Array(0));
  await A.space.sync();
  ok('a file left in the cloud is told so, not “missing”', A.space.docStatus(id) === 'cloud' && A.space.last.cloud === 1);
  shared.delete('Documents/2025/Acme/.2024-03-12 Acme - Designer renamed.txt.icloud');
  shared.set(p2, bytes);
  await A.space.sync();
  ok('the file back: the document is whole again', A.space.docStatus(id) === null && docOf(A).path === p2);
  const read = A.folder.readBytes;
  A.folder.readBytes = async p => (p === p2 ? null : read(p));      // listed and sized, but not downloaded
  await A.space.sync();
  A.folder.readBytes = read;
  ok('a file that is listed but cannot be read is in the cloud too', true);
  shared.set(p2, new TextEncoder().encode('other bytes'));
  await A.space.sync();
  ok('other bytes at a known path are a new version of the document, listed for the person', A.space.docStatus(id) === 'changed' && A.space.last.edited[0].id === id);
  shared.set(p2, bytes);
  shared.set('Documents/2025/Acme/my own copy.txt', bytes);
  shared.set('BrewCV/Inbox/the same file again.txt', bytes);
  await A.space.sync();
  ok('a copy of a document’s bytes in the person’s own folder is told and never moved', shared.has('Documents/2025/Acme/my own copy.txt') && A.space.last.dups.includes('Documents/2025/Acme/my own copy.txt') && listed(shared, 'Deleted').every(n => !/my own copy/.test(n)));
  ok('the same file in the Inbox and in Documents/: the one in the Inbox goes to Deleted/, the one in Documents/ stays', shared.has(p2) && !shared.has('BrewCV/Inbox/the same file again.txt') && listed(shared, 'Deleted').some(n => /the same file again.*\.txt$/.test(n)));
  shared.delete('Documents/2025/Acme/my own copy.txt');
  ok('none of it changes a page: every saved resume prints byte for byte as before', printed(A) === printBefore);
  shared.delete(p2); await A.space.sync();
}

section('an older folder, with the data at the top, opens and moves into BrewCV/ on OK');
{
  const Mo = make(), old = Mo.fx, st = exampleState();
  for (const [p, text] of filesOf(st)) old.set(p, text);
  old.set('checkpoints/2026-10-01T10-00-00Z Manual.json', '{"resumeBuilderBackup":1}');
  old.set('My Notes/keep this.md', '# mine');
  const root = Mo.root(), top = await dataFolder(root);
  ok('data folder: the top of an older folder, flagged so the move is offered', top.legacy === true && top.space === true && (await top.read('resume-data.json')) !== null);
  const got = await readFolder(top);
  ok('…and it reads as it always did', got.state.resumes.length === 2 && got.warnings.length === 0);
  // the folder has been linked and synced first: this device's file, a checkpoint of its own (a folder inside checkpoints/) and the person’s own Deleted/ are at the top
  old.set('Deleted/2020-01-01 mine.pdf', 'the person’s');
  old.set('recipes/my notes.txt', 'mine'); old.set('devices/read me.md', 'mine'); old.set('checkpoints/backup.bak', 'mine');      // not the app’s
  const D = await device(Mo, 'Mac', { state: st });
  await D.persist.link(D.data); await D.space.sync(); await D.persist.checkpoint('Before moving', 'replace');
  ok('linked and synced in the older layout, its files are at the top', [...old.keys()].some(k => /^devices\/Mac /.test(k)) && [...old.keys()].some(k => /^checkpoints\/Mac\/.* Before moving\.json$/.test(k)));
  // a copy that fails leaves the top as it was
  const w = root.write;
  root.write = async (p, d) => { if (p.startsWith('BrewCV/checkpoints/')) throw new Error('disk full'); return w(p, d); };      // after the device file and before resume-data.json, which makes BrewCV/ the data folder
  let threw = false;
  try { await moveIntoBrewCV(root); } catch { threw = true; }
  root.write = w;
  const stay = await dataFolder(root);
  ok('a move that cannot finish touches nothing at the top, and the folder is still the older kind (the device files copied already do not turn BrewCV/ into the data folder)', threw && stay.legacy === true && old.has('resume-data.json') && [...old.keys()].filter(k => k.startsWith('recipes/') && k.endsWith('.json')).length === 2 && [...old.keys()].some(k => /^BrewCV\/devices\//.test(k)));
  for (const k of [...old.keys()].filter(k => k.startsWith('BrewCV/'))) old.delete(k);
  const n = await moveIntoBrewCV(root), now = await dataFolder(root);
  ok('on OK everything moves into BrewCV/, copied, read back and checked: the record, the saved resumes, the device files and the checkpoints, a folder inside them too', n >= 6 && now.legacy === false && [...old.keys()].some(k => /^BrewCV\/devices\/Mac /.test(k)) && [...old.keys()].some(k => /^BrewCV\/checkpoints\/Mac\/.* Before moving\.json$/.test(k)), [...old.keys()].join());
  ok('…and the top keeps only what is the person’s: its own folders and its own Deleted/, and what is in the app’s folders that is not the app’s json', [...old.keys()].filter(k => !k.startsWith('BrewCV/')).sort().join() === 'Deleted/2020-01-01 mine.pdf,My Notes/keep this.md,checkpoints/backup.bak,devices/read me.md,recipes/my notes.txt', [...old.keys()].filter(k => !k.startsWith('BrewCV/')).join());
  const after = await readFolder(now);
  ok('…and BrewCV/ reads back the same career and resumes', after.state.resumes.length === 2 && J(after.state.record) === J(got.state.record) && after.warnings.length === 0);
  ok('a folder with nothing yet is the new kind', (await dataFolder(make().root())).legacy === false);
}

section('the command-line tools read either layout');
{
  const os = await import('node:os'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brewcv-layout-')), st = exampleState();
  try {
    for (const [sub, pre] of [['older', ''], ['newer', 'BrewCV/']]) for (const [p, text] of filesOf(st)){
      const file = path.join(dir, sub, pre, p); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
    }
    const a = readLibrary(path.join(dir, 'older')), b = readLibrary(path.join(dir, 'newer')), c = readLibrary(path.join(dir, 'newer', 'BrewCV', 'resume-data.json'));
    ok('a data folder of either layout, or its record file, gives the same career', a.model.basics.name === b.model.basics.name && J(a.model) === J(b.model) && J(b.model) === J(c.model));
    const out = path.join(dir, 'one.json'), pack = sub => spawnSync(process.execPath, [path.join(REPO, 'scripts/onefile.mjs'), 'pack', path.join(dir, sub), out, '--force'], { encoding: 'utf8' });
    const p1 = pack('older'), p2 = pack('newer');
    ok('the one-file tool packs either layout', p1.status === 0 && p2.status === 0 && /the record and 2 saved resumes/.test(p1.stdout) && /the record and 2 saved resumes/.test(p2.stdout), p1.stderr + p2.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

section('Organise: moves into Documents/<search>/<company>/, run one at a time, stopping cleanly');
{
  const Mf = make(), files = Mf.fx, root = Mf.root();
  const bytes = n => new TextEncoder().encode(`file ${n}`);
  for (const n of ['a', 'b', 'c']) files.set(`Notes/2024-0${n === 'a' ? 1 : n === 'b' ? 2 : 3}-10 ${n}.pdf`, bytes(n));
  files.set('Documents/2024/2024-01-10 a.pdf', bytes('other'));
  const found = (await reconcile({}, root, {})).fresh;
  const plan = await planOrganise(root, found, { rounds: [], base: 'Documents' });
  ok('the plan lists a move for each file outside Documents/, to Documents/<year>/ under a name no other bytes use, and none for the file already under Documents/', plan.length === 3 && plan.every(m => /^Documents\/2024\/2024-0\d-10 \w( \d)?\.pdf$/.test(m.to)) && plan.find(m => m.from.endsWith('a.pdf')).to === 'Documents/2024/2024-01-10 a 2.pdf', J(plan));
  const w = root.write;
  root.write = async (p, d) => { if (/b\.pdf$/.test(p) && p.startsWith('Documents/')) throw new Error('copy failed'); return w(p, d); };
  const res = await organise(root, plan);
  root.write = w;
  ok('it stops at the first copy that fails: the ones before are moved, that one and the rest are where they were', res.done.length === 1 && res.failed.from.endsWith('b.pdf') && res.left.length === 1 && files.has('Notes/2024-02-10 b.pdf') && files.has('Notes/2024-03-10 c.pdf') && !files.has('Notes/2024-01-10 a.pdf') && files.has(res.done[0].to), J(res));
  ok('…and no half copy is left in Documents/', !files.has(plan[1].to) && !files.has(plan[2].to));
  root.write = async (p, d) => w(p, p === plan[1].to ? new TextEncoder().encode('wrong') : d);
  const res2 = await organise(root, plan.slice(1));
  root.write = w;
  ok('a copy that reads back different is a failure too: it is taken away again and the original stays', res2.done.length === 0 && res2.failed.from.endsWith('b.pdf') && files.has('Notes/2024-02-10 b.pdf') && !files.has(plan[1].to));
  const res3 = await organise(root, plan.slice(1));
  ok('run again, the rest moves', res3.done.length === 2 && res3.failed === null && !files.has('Notes/2024-02-10 b.pdf'));
  const back = await undoOrganise(root, [...res.done, ...res3.done]);
  ok('every move was logged and can be undone', back.length === 3 && files.has('Notes/2024-01-10 a.pdf') && files.has('Notes/2024-03-10 c.pdf') && !files.has(plan[2].to));
  // through the space, with a document that points at a moved file
  const Ms = make(), sf = Ms.fx, d = await device(Ms, 'Mac');
  sf.set('Docs/2024-05-01 Old cv.pdf', bytes('doc'));
  const sha = await sha256(bytes('doc'));
  await d.persist.link(d.data);
  await edit(d, x => { DOC.addDocument(x, { name: '2024-05-01 Old cv.pdf', type: 'application/pdf', path: 'Docs/2024-05-01 Old cv.pdf', sha256: sha, size: 3, text: 't', meta: { date: '2024-05-01' } }); }, 'doc');
  await d.space.sync();
  ok('the scan lists the resume-like files outside Documents/ as found, and a pdf is one whatever it holds', d.space.last.fresh.length === 0, J(d.space.last.fresh));
  sf.set('Elsewhere/2023-06-01 Some resume.docx', bytes('x'));
  sf.set('Elsewhere/notes.md', new TextEncoder().encode('# Shopping\n- milk\n'));
  sf.set('Elsewhere/cv.md', new TextEncoder().encode('# Jane Roe\njane@example.com\n\n## Experience\nAcme 2019 - 2021\n\n## Skills\nCAD\n'));
  sf.set('Elsewhere/font.ttf', bytes('f')); sf.set('Elsewhere/app.js', bytes('code')); sf.set('.hidden/x.pdf', bytes('h')); sf.set('node_modules/x/y.pdf', bytes('n'));
  await d.space.sync();
  ok('the scan skips dot-folders, BrewCV/, fonts and code, and tells a note from a resume by its score', J(d.space.last.fresh.map(f => f.path)) === J(['Elsewhere/2023-06-01 Some resume.docx', 'Elsewhere/cv.md']), J(d.space.last.fresh));
  const o = await d.space.organise();
  ok('Organise through the app moves them into Documents/ and a document’s path follows its file', o.done.length === 2 && sf.has('Documents/2023/2023-06-01 Some resume.docx') && !sf.has('Elsewhere/2023-06-01 Some resume.docx') && sf.has('Elsewhere/notes.md'), J(o));
  await d.space.undoOrganise();
  ok('…and the log undoes it', sf.has('Elsewhere/2023-06-01 Some resume.docx') && !sf.has('Documents/2023/2023-06-01 Some resume.docx'));
}

section('an Inbox copy of an original is a duplicate only while Documents/ still holds that file');
{
  const Ms = make(), sf = Ms.fx, d = await device(Ms, 'Mac'), orig = new TextEncoder().encode('The original wording of the file.\n'), sha = await sha256(orig), path = 'Documents/2024/2024-03-12 o.txt';
  sf.set(path, orig);
  await d.persist.link(d.data);
  await edit(d, x => { DOC.addDocument(x, { name: '2024-03-12 o.txt', type: 'text/plain', path, sha256: sha, size: orig.length, text: 'x', meta: { date: '2024-03-12' } }); }, 'document');
  sf.set('BrewCV/Inbox/o copy.txt', orig);
  await d.space.sync();
  ok('while the file in Documents/ is the document’s own, the copy in the Inbox is a duplicate and goes to Deleted/', !sf.has('BrewCV/Inbox/o copy.txt') && listed(sf, 'Deleted').some(n => /o copy/.test(n)));
  sf.set(path, new TextEncoder().encode('The file, edited since, so longer.\n'));
  sf.set('BrewCV/Inbox/o copy.txt', orig);
  const e = { name: 'o copy.txt', path: 'BrewCV/Inbox/o copy.txt', status: 'seen', modified: 0, sha256: sha };
  await d.space.sync(); await d.space.file([e]);
  ok('once that file was edited, the copy is the original and is kept: the scan leaves it and filing does not call it a duplicate', sf.has('BrewCV/Inbox/o copy.txt') && e.path === 'BrewCV/Inbox/o copy.txt' && listed(sf, 'Deleted').filter(n => /o copy/.test(n)).length === 1);
}

section('the Inbox (BrewCV/Inbox/): read, filed into Documents/<search>/<company>/, with its receipt');
{
  const Ms = make(), sf = Ms.fx, d = await device(Ms, 'Mac');
  const FIX = path.join(REPO, 'checks/fixtures/import'), name = 'helix-1col-word.docx', bytes = new Uint8Array(fs.readFileSync(path.join(FIX, name)));
  sf.set(`BrewCV/Inbox/${name}`, bytes);
  sf.set('BrewCV/Inbox/.DS_Store', new Uint8Array(1)); sf.set('BrewCV/Inbox/~$helix.docx', new Uint8Array(1));
  await d.persist.link(d.data);
  const r = await d.space.sync();
  ok('the Inbox lists its files, and not what an office program or a Mac leaves in it', J(r.inbox) === J([`BrewCV/Inbox/${name}`]) && sf.has('BrewCV/BrewCV.md'));
  const [f] = await d.space.load(r.inbox);
  const e = { name: f.name, size: f.size, type: f.type, modified: f.lastModified, path: f.path, bytes: new Uint8Array(await f.arrayBuffer()) };
  e.sha256 = await sha256(e.bytes);
  e.read = await X.readFile(e.bytes, e.name, {});
  const entries = [e];
  X.classify(d.store.state, entries);
  await d.space.file(entries);
  ok('before the import is applied the file is filed into Documents/<year>/ (no company is known) under a name with the date, and gone from the Inbox', /^Documents\/\d{4}\/\d{4}-\d\d-\d\d helix-1col-word\.docx$/.test(e.path) && !sf.has(`BrewCV/Inbox/${name}`) && sf.has(e.path), e.path);
  const plan = X.plan(d.store.state, entries, { fresh: true });
  let made = [];
  d.store.commit(x => { made = X.applyPlan(x, plan, { at: '2026-11-01T10:00:00.000Z' }); }, 'import');
  const doc2 = d.store.state.documents[0];
  ok('the document is made with that path in the one commit: a reference to the file there, no copy of it in the state', made.length === 1 && doc2.path === e.path && !doc2.embedded && doc2.sha256 === e.sha256);
  const sf2 = DOC.safety(doc2, { folderVerified: d.space.verified(doc2) });
  ok('the receipt’s third tick is “in your folder”, because the file was read back and its hash checked', sf2.kept.ok && sf2.kept.state === 'folder' && d.space.verified(doc2) && sf2.read.ok, J(sf2.kept));
  ok('…and not before: a document nobody read back is not verified', !d.space.verified({ ...doc2, sha256: 'x' }));
  const r2 = await d.space.sync();
  ok('the next scan finds the filed document where it should be', r2.inbox.length === 0 && r2.missing === 0 && r2.moved === 0 && d.space.docStatus(doc2.id) === null);
  // a copy that fails leaves the file in the Inbox
  sf.set('BrewCV/Inbox/again.txt', new TextEncoder().encode('Another file\n'));
  const x = { name: 'again.txt', path: 'BrewCV/Inbox/again.txt', status: 'resume', modified: 0, sha256: await sha256(new TextEncoder().encode('Another file\n')) };
  const w = d.folder.write;
  d.folder.write = async () => { throw new Error('disk full'); };
  await d.space.file([x]);
  d.folder.write = w;
  ok('a file that cannot be filed stays in the Inbox, and the document is made referencing it there', x.path === 'BrewCV/Inbox/again.txt' && sf.has('BrewCV/Inbox/again.txt'));
  // the same file in the Inbox again: Documents/ already has it
  sf.set('BrewCV/Inbox/helix again.docx', bytes);
  const y = { name: 'helix again.docx', path: 'BrewCV/Inbox/helix again.docx', status: 'seen', modified: 0, sha256: e.sha256 };
  await d.space.file([y]);
  ok('a copy of a file the Library already holds goes to Deleted/, and its entry points at the one in Documents/', y.path === e.path && !sf.has('BrewCV/Inbox/helix again.docx') && listed(sf, 'Deleted').some(n => /helix again.*\.docx$/.test(n)));
  // an original embedded before a folder was linked becomes a file there
  const emb = new TextEncoder().encode('Embedded original, before the folder.\n'), esha = await sha256(emb);
  d.store.commit(s => { DOC.addDocument(s, { name: 'before.txt', type: 'text/plain', bytesDataUrl: `data:text/plain;base64,${Buffer.from(emb).toString('base64')}`, sha256: esha, size: emb.length, text: 'Embedded original', meta: { date: '2024-02-02' } }); }, 'embedded');
  await d.space.sync();
  const ref = d.store.state.documents.find(y => y.sha256 === esha);
  ok('linking a folder later writes the embedded originals into Documents/ and turns them into references', ref.path === 'Documents/2024/2024-02-02 before.txt' && !ref.embedded && J([...sf.get(ref.path)]) === J([...emb]), J(ref.path));
}

section('Documents by search and company (the setting, the Inbox, Organise, the Save dialog’s folder)');
{
  const Ms = make(), sf = Ms.fx, d = await device(Ms, 'Mac'), dir = (date, company) => d.space.dirFor(date, company);
  await d.persist.link(d.data); await d.space.sync();
  ok('with no round running a document sits in its year’s folder, under its company when one is known', await dir('2024-03-12', 'Northgate') === 'Documents/2024/Northgate' && await dir('2024-03-12') === 'Documents/2024' && await dir('2024-03-12', '') === 'Documents/2024');
  ok('…and every name goes through safe()', await dir('2024-03-12', 'A#B/C:[1]') === 'Documents/2024/A B C 1');
  await edit(d, x => { DOC.startRound(x, 'Lisbon', '2026-03-01'); }, 'round');
  ok('during a round an export lands in Documents/<round>/<company>/, a round called Lisbon started in 2026 being 2026 Lisbon', await dir('2026-11-01', 'Acme') === 'Documents/2026 Lisbon/Acme' && await dir('2026-11-01') === 'Documents/2026 Lisbon');
  ok('…a date before the round is still its year', await dir('2025-12-31', 'Acme') === 'Documents/2025/Acme');
  // an Inbox file in BrewCV/Inbox/ ends in its search’s folder, with its receipt
  const bring = async (name, text, modified) => {
    const b = new TextEncoder().encode(text), sha = await sha256(b), e = { name, path: `BrewCV/Inbox/${name}`, status: 'resume', modified, sha256: sha };
    sf.set(e.path, b);
    await d.space.file([e]);
    return { e, b, sha };
  };
  const meta = e => ({ ...X.metaOf(e.name, e.modified), kind: 'resume' });
  const may = Date.parse('2026-05-05T10:00:00Z');
  const one = await bring('2026-05-05 Northgate - Design Engineer.txt', 'Led the dosing system redesign at Northgate.\n', may);
  ok('an Inbox file ends in its round’s folder, under the company its name carries, with the date in its name', one.e.path === 'Documents/2026 Lisbon/Northgate/2026-05-05 Northgate - Design Engineer.txt' && !sf.has(`BrewCV/Inbox/${one.e.name}`) && J([...sf.get(one.e.path)]) === J([...one.b]), one.e.path);
  ok('…its receipt’s third tick is “in your folder”: read back and checked', d.space.verified({ path: one.e.path, sha256: one.sha }));
  const two = await bring('notes from a call.txt', 'Another file with no company in its name.\n', may);
  ok('a document with no company known sits in the search’s own folder', /^Documents\/2026 Lisbon\/\d{4}-\d\d-\d\d notes from a call\.txt$/.test(two.e.path) && sf.has(two.e.path), two.e.path);
  const gen = await bring('2026-05-07 General.txt', 'A file named for a date and a word, no role.\n', may);
  ok('a company folder comes only from a name of the form <date> <company> - <role>: “<date> General” sits in the search’s folder', gen.e.path === 'Documents/2026 Lisbon/2026-05-07 General.txt' && sf.has(gen.e.path), gen.e.path);
  ok('the app writes nothing at the top of the folder except Documents/ and BrewCV/', [...sf.keys()].every(k => /^(?:BrewCV|Documents)\//.test(k)), [...sf.keys()].filter(k => !/^(?:BrewCV|Documents)\//.test(k)).join());
  await edit(d, x => { for (const o of [one, two]) DOC.addDocument(x, { name: o.e.name, type: 'text/plain', path: o.e.path, sha256: o.sha, size: o.b.length, text: o.e.name, meta: meta(o.e) }); }, 'documents');
  await edit(d, x => { DOC.startRound(x, '2027 Berlin', '2027-02-01'); }, 'round 2');
  ok('a round that has ended covers only its own dates, and a name that starts with a year is left as it is', await dir('2027-01-31', 'Acme') === 'Documents/2026 Lisbon/Acme' && await dir('2027-02-01', 'Acme') === 'Documents/2027 Berlin/Acme' && await dir('2026-02-28') === 'Documents/2026');
  await edit(d, x => { DOC.mark(x, 'rounds', x.rounds.find(r => r.name === '2027 Berlin').id, { archived: true }, '2027-03-01'); }, 'archive');
  ok('a round archived with no end date ends on the day it was archived: its own dates stay in its folder, a later date is its year', await dir('2027-02-15', 'Acme') === 'Documents/2027 Berlin/Acme' && await dir('2027-03-01', 'Acme') === 'Documents/2027/Acme' && await dir('2027-06-01', 'Acme') === 'Documents/2027/Acme');
  // Organise leaves everything under Documents/ alone
  const keep = { 'Documents/2026 Lisbon/Acme/2026-05-01 Acme - Old.pdf': 'a', 'Documents/loose/2025-01-01 mine.docx': 'b', 'Documents/2026-05-09 here.pdf': 'c' };
  for (const [k, v] of Object.entries(keep)) sf.set(k, v);
  sf.set('Notes/2025-02-02 Beta - Role.pdf', 'd'); sf.set('Notes/2023-06-01 Resume.pdf', 'e');
  await d.space.sync();
  ok('the scan leaves what is under Documents/ out of the files found elsewhere (a job ad is not a resume to read in or move), and lists the rest', Object.keys(keep).every(k => !d.space.last.fresh.some(f => f.path === k)) && ['Notes/2025-02-02 Beta - Role.pdf', 'Notes/2023-06-01 Resume.pdf'].every(k => d.space.last.fresh.some(f => f.path === k)), J(d.space.last.fresh.map(f => f.path)));
  const plan = await d.space.plan();
  ok('Organise lists only the files outside Documents/ and BrewCV/, into its search and company folder (a name with no role has no company)', J(plan) === J([{ from: 'Notes/2023-06-01 Resume.pdf', to: 'Documents/2023/2023-06-01 Resume.pdf' }, { from: 'Notes/2025-02-02 Beta - Role.pdf', to: 'Documents/2025/Beta/2025-02-02 Beta - Role.pdf' }]), J(plan));
  await d.space.organise(plan);
  ok('…and every file under Documents/ is where it was, with its bytes', Object.entries(keep).every(([k, v]) => sf.get(k) === v) && plan.every(m => sf.has(m.to) && !sf.has(m.from)));
  // the setting moves nothing
  const before = new Map([...sf.entries()].filter(([k]) => !k.startsWith('BrewCV/')));
  const ids = [one, two].map(o => DOC.docId(o.sha));
  await d.space.setDocs('Applications/2026');
  const r = await d.space.sync();
  ok('changing the setting moves nothing: every file is where it was, and the old documents open (found, read back)', r.docs === 'Applications/2026' && [...before].every(([k, v]) => sf.get(k) === v) && [one, two].every(o => d.space.verified({ path: o.e.path, sha256: o.sha })) && ids.every(id => d.space.docStatus(id) === null && d.store.state.documents.find(x => x.id === id).path.startsWith('Documents/')) && r.moved === 0 && r.missing === 0);
  const plan2 = await d.space.plan();
  ok('…Organise still leaves the old Documents/ alone, whatever the setting is now', plan2.every(m => !m.from.startsWith('Documents/')));
  ok('…and the next document goes to the new place, by the same rule', await dir('2026-11-01', 'Acme') === 'Applications/2026/2026 Lisbon/Acme');
  const three = await bring('2026-06-06 Acme - Product Designer.txt', 'A third file, for the new place.\n', Date.parse('2026-06-06T10:00:00Z'));
  ok('…an Inbox file is filed there', three.e.path === 'Applications/2026/2026 Lisbon/Acme/2026-06-06 Acme - Product Designer.txt' && sf.has(three.e.path));
  const set = async v => { const ok = await d.space.setDocs(v); await d.space.sync(); return [ok, d.space.last.docs]; };
  ok('a setting with nothing safe in it is the default; one that climbs out of the folder cannot', J(await set('../..\\:')) === J([true, 'Documents']) && J(await set('../Outside/a:b')) === J([true, 'Outside/a b']));
  ok('…and empty is the default again', J(await set('')) === J([true, 'Documents']));
  // a folder the scan skips, BrewCV's own, or one nested deeper than the scan reads cannot hold documents: the setting is refused, and the one before stays
  await set('Applications');
  const refused = ['BrewCV', 'brewcv/x', 'BrewCV/Inbox', '.hidden', 'a/.git', 'node_modules', 'a/Fonts', 'Deleted', 'checkpoints', 'a/b/c/d/e/f/g'];
  const answers = []; for (const v of refused) answers.push(J(await set(v)));
  ok('the setting refuses BrewCV and what is under it, dot-folders, names the scan skips, and a folder too deep for the scan, and keeps the one before', answers.every(a => a === J([false, 'Applications'])), answers.join());
  ok('…a folder the scan reads is fine, even one that is only skipped at the top, or as deep as it goes', J(await set('x/Deleted')) === J([true, 'x/Deleted']) && J(await set('a/b/c/d/e/f')) === J([true, 'a/b/c/d/e/f']));
  // Organise protects, whatever case a disk keeps, the setting now and the top folder of every document the state holds
  await set('Applications/2026');
  sf.set('Applications/2026/2026-07-07 Zed - Dev.pdf', 'z'); sf.set('Notes2/2026-08-01 Lee - Dev.pdf', 'l');
  await d.space.sync();
  ok('the folder the setting names is protected: a file there is neither found elsewhere nor listed by Organise', !d.space.last.fresh.some(f => f.path.startsWith('Applications/')) && J((await d.space.plan()).map(m => m.from)) === J(['Notes2/2026-08-01 Lee - Dev.pdf']), J(d.space.last.fresh.map(f => f.path)));
  await edit(d, x => { DOC.addDocument(x, { name: three.e.name, type: 'text/plain', path: three.e.path, sha256: three.sha, size: three.b.length, text: 'x', meta: meta(three.e) }); DOC.addDocument(x, { name: 'q.txt', type: 'text/plain', path: 'Theirs/2026 Lisbon/Acme/q.txt', sha256: 'f'.repeat(64), size: 1, text: 'q', meta: {} }); DOC.addDocument(x, { name: 'r.txt', type: 'text/plain', path: 'Notes3/r.txt', sha256: 'e'.repeat(64), size: 1, text: 'r', meta: {} }); }, 'more documents');
  await set('');
  sf.set('Applications/2026/other/2026-07-08 Yan - Dev.pdf', 'y'); sf.set('Notes3/2026-09-02 Kim - Dev.pdf', 'k'); sf.set('Theirs/2026-07-11 Pal - Eng.pdf', 'p'); sf.set('documents/2026-07-09 Low - Dev.pdf', 'w'); sf.set('DOCUMENTS/x/2026-07-10 Up - Dev.pdf', 'u');
  await d.space.sync();
  const mine = (await d.space.plan()).map(m => m.from);
  ok('…and so is the base of every document the app filed (the setting changed back, a folder another device filed into), whatever the case', J(mine) === J(['Notes2/2026-08-01 Lee - Dev.pdf', 'Notes3/2026-09-02 Kim - Dev.pdf']) && !d.space.last.fresh.some(f => /^(?:Applications|Theirs|documents|DOCUMENTS)\//.test(f.path)), J(mine) + J(d.space.last.fresh.map(f => f.path)));
  ok('…but only the base a document was filed under (before its search folder): a file read in place in Notes3/ leaves the other resumes there to Organise and the found list', mine.includes('Notes3/2026-09-02 Kim - Dev.pdf') && d.space.last.fresh.some(f => f.path === 'Notes3/2026-09-02 Kim - Dev.pdf'));
  // the Save dialog's folder is made before the dialog opens, and taken away again, when the app made it and it is still empty
  const tree = new Set(['/F']), fs = { exists: async p => tree.has(p), mkdir: async p => { for (let i = p.indexOf('/', 1); i > 0; i = p.indexOf('/', i + 1)) tree.add(p.slice(0, i)); tree.add(p); }, remove: async p => { if ([...tree].some(k => k.startsWith(`${p}/`))) throw new Error('not empty'); tree.delete(p); } };
  const undo = await ensureDirs(fs, '/F', 'Documents/2026 Lisbon/Acme');
  ok('the folders the Save dialog opens in are made', tree.has('/F/Documents/2026 Lisbon/Acme'));
  await undo();
  ok('…and taken away again when nothing was saved, the ones the app made', !tree.has('/F/Documents') && !tree.has('/F/Documents/2026 Lisbon') && tree.has('/F'));
  tree.add('/F/Documents'); tree.add('/F/Documents/2026 Lisbon'); tree.add('/F/Documents/2026 Lisbon/Beta'); tree.add('/F/Documents/2026 Lisbon/Beta/x.pdf');
  const undo2 = await ensureDirs(fs, '/F', 'Documents/2026 Lisbon/Acme'); await undo2();
  ok('…but a folder that was there already, and a folder that is not empty, are left alone', tree.has('/F/Documents/2026 Lisbon/Beta/x.pdf') && tree.has('/F/Documents/2026 Lisbon') && !tree.has('/F/Documents/2026 Lisbon/Acme'));
  const undo3 = await ensureDirs(fs, '/F', 'Documents/2026 Lisbon/Acme'); tree.add('/F/Documents/2026 Lisbon/Acme/y.pdf'); await undo3();
  ok('…and one the app made that has a file in it by then stays', tree.has('/F/Documents/2026 Lisbon/Acme/y.pdf') && tree.has('/F/Documents/2026 Lisbon/Acme'));
}

section('Deleted/ is swept after 30 days, only what the app put there, and is the only place the app unlinks');
{
  const Ms = make(), sf = Ms.fx, d = await device(Ms, 'Mac');
  const today = new Date().toISOString().slice(0, 10);
  sf.set('BrewCV/Deleted/2020-01-01 placed by hand.json', 'mine'); sf.set('BrewCV/Deleted/no date.json', '1');
  sf.set('BrewCV/a.json', 'old one'); sf.set('BrewCV/b.json', 'changed later'); sf.set('BrewCV/c.json', 'new one');
  await d.persist.link(d.data);
  const ta = await d.persist.trash('a.json', { day: '2020-01-01' }), tb = await d.persist.trash('b.json', { day: '2020-01-01' }), tc = await d.persist.trash('c.json', { day: today });
  sf.set(tb, 'edited by the person since');
  const index = JSON.parse(sf.get([...sf.keys()].find(k => /Deleted\/index /.test(k))));
  const nameOf = t => t.slice('BrewCV/Deleted/'.length);
  ok('each file the app moves is written in an index of the device: its name (with the device in it), its hash and the day', Object.keys(index).length === 3 && /^2020-01-01 a \([0-9a-f]{4}\)\.json$/.test(nameOf(ta)) && index[nameOf(ta)].sha256 === await sha256(new TextEncoder().encode('old one')) && index[nameOf(tc)].day === today);
  await d.space.sync();
  ok('what the app moved and is over 30 days old goes for good', !sf.has(ta));
  ok('…what is newer stays', sf.has(tc));
  ok('…a file put there by hand stays, dated or not', sf.has('BrewCV/Deleted/2020-01-01 placed by hand.json') && sf.has('BrewCV/Deleted/no date.json'));
  ok('…and an indexed file whose bytes are not the ones moved stays', sf.get(tb) === 'edited by the person since');
  const writes = []; const w = d.folder.write; d.folder.write = async (p, ...a) => { writes.push(p); return w.call(d.folder, p, ...a); };
  await d.space.sync(); await d.space.sync();
  d.folder.write = w;
  ok('the index of the device is written only when it changed: scans that find nothing to sweep write nothing', !writes.some(p => /Deleted\/index/.test(p)), J(writes));
  // an index entry is only ever a plain name the app made: it cannot reach another folder
  sf.set('BrewCV/Deleted/2020-01-01 ../escape.txt', 'outside'); sf.set('BrewCV/Deleted/2020-01-01 ..\\escape2.txt', 'outside');
  const ix = [...sf.keys()].find(k => /Deleted\/index /.test(k)), idx = JSON.parse(sf.get(ix)), sh = await sha256(new TextEncoder().encode('outside'));
  idx['2020-01-01 ../escape.txt'] = { sha256: sh, day: '2020-01-01' }; idx['2020-01-01 ..\\escape2.txt'] = { sha256: sh, day: '2020-01-01' };
  sf.set(ix, J(idx));
  await d.space.sync();
  ok('…a name with a slash or a backslash in an index is never followed', sf.has('BrewCV/Deleted/2020-01-01 ../escape.txt') && sf.has('BrewCV/Deleted/2020-01-01 ..\\escape2.txt'));
  // a damaged index of its own, or of another device, breaks nothing
  for (const bad of ['null', '{', '[1,2]', '{"2020-01-01 a (x).json":null,"b":5}', '"text"']){
    sf.set(ix, bad); sf.set('BrewCV/Deleted/index Other.json', bad); sf.set('BrewCV/z.json', 'z');
    let threw = null, to = null;
    try { to = await d.persist.trash('z.json', { day: today }); await d.space.sync(); } catch (e){ threw = e; }
    ok(`a damaged index (${bad.slice(0, 12)}) is an empty one: the file is still copied, checked and moved, and the scan goes on`, !threw && to && sf.has(to) && !sf.has('BrewCV/z.json'), String(threw));
  }
  ok('a name Deleted/ already holds gets a number', await (async () => { sf.set('BrewCV/x.json', 'a'); const a = await toDeleted(d.data, 'x.json', { day: '2026-11-01' }); sf.set('BrewCV/x.json', 'b'); const b = await toDeleted(d.data, 'x.json', { day: '2026-11-01' }); return a === 'BrewCV/Deleted/2026-11-01 x (app).json' && b === 'BrewCV/Deleted/2026-11-01 x (app) 2.json' && !sf.has('BrewCV/x.json'); })());
  ok('BrewCV.md is written once, and not again when the person has changed it or deleted it', has(sf, 'BrewCV.md') && (sf.set('BrewCV/BrewCV.md', 'mine'), await d.space.sync(), at(sf, 'BrewCV.md') === 'mine') && (sf.delete('BrewCV/BrewCV.md'), await d.space.sync(), !has(sf, 'BrewCV.md')));
  // an older folder: its own Deleted/ is the person’s, nothing is swept or moved there
  const Ml = make(), lf = Ml.fx, st = exampleState();
  for (const [p, text] of filesOf(st)) lf.set(p, text);
  lf.set('Deleted/2020-01-01 mine.pdf', 'the person’s'); lf.set('Deleted/index Mac.json', '{"2020-01-01 mine.pdf":{"sha256":"x","day":"2020-01-01"}}');
  const L = await device(Ml, 'Mac', { state: st });
  lf.set('BrewCV/Deleted/2020-01-01 x.json', 'x'); lf.set('BrewCV/Deleted/index Mac.json', J({ '2020-01-01 x.json': { sha256: await sha256(new TextEncoder().encode('x')), day: '2020-01-01' } }));
  ok('while the folder is the older kind nothing is swept, even what an index lists', L.data.legacy === true && (await sweepDeleted(L.data, new Date('2030-01-01'))).length === 0 && lf.has('BrewCV/Deleted/2020-01-01 x.json'));
  await L.persist.link(L.data); await L.space.sync();
  await edit(L, x => RS.deleteSaved(x, names[1]), 'delete');
  ok('…its own Deleted/ is never used or swept, and what the app takes away goes to BrewCV/Deleted/', lf.has('Deleted/2020-01-01 mine.pdf') && lf.has('Deleted/index Mac.json') && [...lf.keys()].filter(k => k.startsWith('Deleted/')).length === 2 && [...lf.keys()].some(k => /^BrewCV\/Deleted\/.* Medtech Lisboa/.test(k)) && lf.has('BrewCV/Deleted/2020-01-01 x.json'));
}

section('a file this device wrote is its own, whenever it was written');
{
  // the window was closed within the debounce: the state was saved to the browser, the folder still holds the file of the save before
  const Mx = make(), be = memoryBackend(), f = `recipes/${names[0]}`;
  const A1 = await device(Mx, 'Mac', { backend: be });
  await A1.persist.link(A1.data); await A1.space.sync();
  const v1 = at(Mx.fx, f);
  const w1 = A1.folder.write;
  A1.folder.write = async () => { throw new Error('the window was closed'); };      // v2 reaches the browser's storage, never the folder
  await edit(A1, x => { x.resumes.find(r => r.id === names[0]).pageLimit = 3; }, 'v2');
  A1.folder.write = w1;
  ok('(the last save never reached the folder: it still holds the file of the save before)', at(Mx.fx, f) === v1);
  const A2 = await device(Mx, 'Mac', { backend: be });
  await A2.persist.restore();
  const n = A2.store.state.resumes.length, v2 = filesOf(A2.store.materialize()).get(f);
  await A2.persist.link(A2.data); await A2.space.sync(); await A2.space.sync(); await A2.space.sync();
  ok('a file left from an earlier session (the last save never reached the folder) is not an outside edit: no copy, and it is written again', A2.store.state.resumes.length === n && n === 2 && at(Mx.fx, f) === v2 && listed(Mx.fx, 'Deleted').length === 0, `${A2.store.state.resumes.length} ${listed(Mx.fx, 'Deleted')}`);
  // an older version put back (a backup restored, a sync tool’s version): not this device’s last write, so it is kept before it is written over
  const older = JSON.parse(v1); older.meta.resumeBuilder.resume.company = 'An Older Company';
  Mx.fx.set(`BrewCV/${f}`, S.serialize(older));
  const A3 = await device(Mx, 'Mac', { backend: be });
  await A3.persist.restore(); await A3.persist.link(A3.data); await A3.space.sync(); await A3.space.sync(); await A3.space.sync();
  const kept = [...Mx.fx.entries()].filter(([k]) => /BrewCV\/Deleted\//.test(k) && !/index /.test(k)).some(([, v]) => String(v).includes('An Older Company')) || A3.store.state.resumes.some(r => r.company === 'An Older Company');
  ok('an older version of a file put back is never lost: it is in Deleted/ or a saved resume of its own, and the file is written again', kept && at(Mx.fx, f) === filesOf(A3.store.materialize()).get(f));
  // another device's saved resume arrives before that device's own file
  const M2 = make(), Aa = await device(M2, 'Mac'), Bb = await device(M2, 'Linux', { state: structuredClone(Aa.store.state) });
  await Aa.persist.link(Aa.data); await Aa.space.sync(); await Bb.persist.link(Bb.data); await Bb.space.sync(); await Aa.space.sync();
  const bFile = [...M2.fx.keys()].find(k => /devices\/Linux/.test(k)), before = M2.fx.get(bFile);
  await edit(Bb, x => { x.resumes.find(r => r.id === names[0]).pageLimit = 3; }, 'b edits');
  const after = M2.fx.get(bFile);
  M2.fx.set(bFile, before);      // its device file has not arrived yet
  await Aa.space.sync(); await Aa.space.sync(); await Aa.space.sync();
  ok('a saved resume that arrives before its device’s file waits: no copy of it, and it is not written over', Aa.store.state.resumes.length === 2 && JSON.parse(at(M2.fx, f)).meta.resumeBuilder.resume.pageLimit === 3);
  M2.fx.set(bFile, after);
  await Aa.space.sync(); await Bb.space.sync(); await Aa.space.sync(); await Bb.space.sync(); await Aa.space.sync();
  ok('…and when the file arrives it is merged: the same resume, changed, on both devices', Aa.store.state.resumes.length === 2 && Aa.store.state.resumes.find(r => r.id === names[0]).pageLimit === 3 && view(Aa) === view(Bb));
}

section('library.json is derived: what is there goes to Deleted/ and the new one is written');
{
  const Ms = make(), sf = Ms.fx, d = await device(Ms, 'Mac');
  await d.persist.link(d.data);
  await edit(d, x => { DOC.addDocument(x, { name: 'a.txt', type: 'text/plain', path: 'Documents/2024/a.txt', sha256: 'a'.repeat(64), size: 1, text: 'a', meta: {} }); }, 'document');
  sf.set('Documents/2024/a.txt', 'a');
  await d.space.sync();
  const mine = at(sf, 'library.json');
  ok('with a document the merged view holds a library.json', !!mine && JSON.parse(mine).documents.length === 1);
  for (const bad of ['{', 'null', '[]', '{"documents":null,"rounds":5}', mine.replace('a.txt', 'edited.txt')]){
    sf.set('BrewCV/library.json', bad);
    let threw = null;
    try { await d.space.sync(); await edit(d, x => { x.record.basics.label = `L ${Math.random()}`; }, 'edit'); } catch (e){ threw = e; }
    ok(`a library.json somebody else wrote (${bad.slice(0, 18)}) is no crash: it is kept in Deleted/ and the right one is written`, !threw && at(sf, 'library.json') === filesOf(d.store.materialize()).get('library.json') && listed(sf, 'Deleted').some(n => /library \(\w+\)( \d+)?\.json$/.test(n)), String(threw) + ' ' + listed(sf, 'Deleted'));
  }
  await edit(d, x => DOC.removeDocuments(x, [x.documents[0].id]), 'remove');
  ok('when the lists are empty there is no library.json: a stale one goes to Deleted/', !has(sf, 'library.json'));
}

section('Forget: only a device whose file is merged');
{
  const Ms = make(), sf = Ms.fx, d = await device(Ms, 'Mac');
  const o = await device(make(), 'Linux', { state: structuredClone(d.store.state) });
  await o.persist.link(o.data); await o.space.sync();
  const file = [...o.files.fx.keys()].find(k => /devices\/Linux/.test(k)), whole = o.files.fx.get(file);
  await d.persist.link(d.data); await d.space.sync();
  sf.set(file, whole.slice(0, whole.length / 2));
  await d.space.sync();
  ok('a file that is not whole is not merged, and cannot be forgotten', (await d.space.forget(file.slice(7))) === false && sf.has(file));
  sf.set(file, whole); await d.space.sync();
  sf.set(file, whole.replace('"saved"', '"saved":"2099-01-01T00:00:00.000Z","was"'));
  ok('…nor one that changed since it was merged (its news is not in this career yet)', (await d.space.forget(file.slice(7))) === false && sf.has(file));
  sf.set(file, whole); await d.space.sync();
  ok('a merged one goes to Deleted/, with what it held already in the career', (await d.space.forget(file.slice(7))) === true && !sf.has(file) && listed(sf, 'Deleted').some(n => /Linux/.test(n)));
}

section('a saved resume’s conflict copy, a path from another device, and what a scan skips');
{
  const Ms = make(), sf = Ms.fx, d = await device(Ms, 'Mac'), f = `recipes/${names[0]}`;
  await d.persist.link(d.data); await d.space.sync();
  const edited = JSON.parse(at(sf, f)); edited.meta.resumeBuilder.resume.company = 'Said Elsewhere Co';
  sf.set(`BrewCV/recipes/${names[0].replace('.json', '')}.sync-conflict-20261101-120000-ABCDEFG.json`, S.serialize(edited));
  const n = d.store.state.resumes.length;
  const r = await d.space.sync();
  ok('a conflict copy of a saved resume that says something else is read in as a saved resume of its own, at once, and moved', r.conflicts.length === 1 && d.store.state.resumes.length === n + 1 && d.store.state.resumes.some(x => x.company === 'Said Elsewhere Co') && listed(sf, 'recipes').every(x => !/conflict/.test(x)) && listed(sf, 'Deleted').some(x => /conflict/.test(x)));
  // a device's document paths
  const o = await device(make(), 'Linux', { state: structuredClone(d.store.state) });
  await o.persist.link(o.data); await o.space.sync();
  const file = JSON.parse([...o.files.fx.entries()].find(([k]) => /devices\/Linux/.test(k))[1]);
  const doc = (id, p) => ({ id: `doc-${id.repeat(12)}`, name: 'x.pdf', type: 'application/pdf', size: 1, sha256: id.repeat(64), addedAt: '2026-11-01T00:00:00.000Z', path: p, meta: {}, from: 'imported', taken: { claims: [], versions: [], skipped: [], unplaced: 0 }, text: 'x' });
  file.documents = [doc('1', '/etc/passwd'), doc('2', '../../outside.pdf'), doc('3', 'C:\\Windows\\x.pdf'), doc('4', 'Documents/2024/fine.pdf'), doc('5', 'a/../../b.pdf')];
  sf.set('BrewCV/devices/Paths 0003.json', J(file));
  await d.space.sync();
  const got = Object.fromEntries((d.store.state.documents ?? []).map(x => [x.id.slice(4, 5), x.path]));
  ok('a path in another device’s file that is absolute, climbs out with .. or names a drive is dropped, a path inside the folder stays', got['1'] === undefined && got['2'] === undefined && got['3'] === undefined && got['5'] === undefined && got['4'] === 'Documents/2024/fine.pdf' && Object.keys(got).length === 5, J(got));
  sf.set('Deleted/old.pdf', 'x'); sf.set('checkpoints/a.pdf', 'x'); sf.set('Notes/real.pdf', 'x');
  await d.space.sync();
  ok('the scan skips Deleted/ and checkpoints/ as it does BrewCV/', J(d.space.last.fresh.map(x => x.path)) === J(['Notes/real.pdf']), J(d.space.last.fresh.map(x => x.path)));
}

section('a window that cannot write leaves the browser’s storage to the one that can');
{
  const held = new Set(), locks = { request(name, o, cb){ if (held.has(name)) return Promise.resolve(cb(null)); held.add(name); cb({ name }); return new Promise(() => {}); } };
  const be = memoryBackend(), M = make();
  const w1 = await device(M, 'Mac', { backend: be, persist: { locks } }), w2 = await device(M, 'Mac', { backend: be, persist: { locks }, state: structuredClone(w1.store.state) });
  await w1.persist.becomeWriter(); await w2.persist.becomeWriter();
  await be.put('handle/folder', 'kept');
  await edit(w1, x => { x.record.basics.label = 'Written by the first window'; }, 'one');
  await edit(w2, x => { x.record.basics.label = 'Written by the second window'; }, 'two');
  let threw = false; try { await w2.persist.checkpoint('x'); } catch { threw = true; }
  await w2.persist.unlink();
  await w2.persist.flush();
  const saved = await be.get('state/current');
  ok('the second window saved nothing: the state in storage is the first’s', w1.persist.writer && !w2.persist.writer && saved.state.record.basics.label === 'Written by the first window' && w2.store.state.record.basics.label === 'Written by the second window');
  ok('…made no checkpoint (and says so, so no change goes ahead without one), and did not forget the folder', threw && (await be.list('checkpoint/')).length === 0 && (await be.get('handle/folder')) === 'kept');
}

section('what a file from the folder cannot do');
{
  const Ms = make(), sf = Ms.fx, d = await device(Ms, 'Mac');
  await d.persist.link(d.data); await d.space.sync();
  const plant = text => text.replace(/^\{/, '{"__proto__":{"polluted":"yes"},').replace(/"basics":\s*\{/, '"basics":{"__proto__":{"polluted":"deep"},');
  const mineFile = [...sf.keys()].find(k => /devices\/Mac/.test(k)), recipeFile = [...sf.keys()].find(k => k.startsWith('BrewCV/recipes/'));
  // a device whose edit is a place with the key in it: its file carries a change the merge takes
  const evil = await device(make(), 'Evil', { state: structuredClone(d.store.state) });
  await evil.persist.link(evil.data);
  await edit(evil, x => { x.record.basics.location = { city: 'Elsewhere' }; }, 'evil');
  await evil.space.sync();
  sf.set('BrewCV/devices/Evil 0001.json', plant([...evil.files.fx.entries()].find(([k]) => /devices\/Evil/.test(k))[1]).replace(/"location":\s*\{/, '"location":{"__proto__":{"polluted":"yes"},'));
  sf.set('BrewCV/recipes/Evil.json', plant(sf.get(recipeFile)));
  sf.set('BrewCV/resume-data.sync-conflict-20261101-120000-ABCDEFG.json', plant(sf.get('BrewCV/resume-data.json')));
  const rr = await d.space.sync(); await d.space.sync();
  const owns = (x, seen = new Set()) => !!x && typeof x === 'object' && !seen.has(x) && (seen.add(x), Object.hasOwn(x, '__proto__') || Object.values(x).some(v => owns(v, seen)));
  ok('a __proto__ key in a device file, a recipe or a conflict copy reaches no object’s prototype, and is in nothing the state holds', !owns(d.store.state) && !owns(d.store.materialize()) && ({}).polluted === undefined && Object.prototype.polluted === undefined && d.store.state.record.polluted === undefined && d.store.state.record.basics.polluted === undefined);
  ok('…the device file and the recipe were read in all the same, without it', rr.merged.includes('devices/Evil 0001.json') && d.store.state.record.basics.location.city === 'Elsewhere' && d.store.state.resumes.some(r => r.id === 'Evil.json'), J([rr.merged, rr.changed, d.store.state.record.basics.location]));
  sf.set('BrewCV/devices/Names <img src=x onerror=1>.json', sf.get(mineFile));
  await d.space.sync();
  ok('a name from the folder is data: the device list holds it as text for the screens to escape', d.space.devices().every(x => typeof x.name === 'string') && d.space.devices().some(x => x.name.includes('<img')));
}

section('two windows get one writer');
{
  const held = new Set();
  const locks = { request(name, opts, cb){ if (held.has(name)) return Promise.resolve(cb(null)); held.add(name); cb({ name }); return new Promise(() => {}); } };
  const Ms = make(), sf = Ms.fx, w1 = await device(Ms, 'Mac', { persist: { locks } }), w2 = await device(Ms, 'Mac', { persist: { locks }, state: structuredClone(startState) });
  const r1 = await w1.persist.link(w1.data);
  const r2 = await w2.persist.link(w2.data);
  ok('the first window gets the writer lock, the second does not and says so by returning nothing', r1 !== null && w1.persist.writer && r2 === null && !w2.persist.writer);
  await w1.space.sync();
  const keys = [...sf.keys()].sort().join();
  ok('the window without the lock writes nothing and syncs nothing', (await w2.space.sync()) === null && [...sf.keys()].sort().join() === keys);
  await edit(w2, d => { d.record.basics.label = 'Edited in the second window'; }, 'edit');
  ok('…its edits stay in its own storage, and the folder is as the writer left it', [...sf.keys()].sort().join() === keys && !String([...sf.values()].join()).includes('Edited in the second window'));
  held.clear();
  ok('when the first window closes, the second can take over', (await w2.persist.becomeWriter()) === true && w2.persist.writer);
  await w2.persist.link(w2.data); await w2.space.sync();
  ok('…and then writes', String(sf.get(`BrewCV/${[...sf.keys()].find(k => /devices\/Mac/.test(k) && sf.get(k).includes('Edited in the second window'))?.slice(7)}`) ?? '').includes('Edited in the second window'));
  ok('without Web Locks a window is the writer', createPersist({ store: createStore(exampleState()), backend: memoryBackend() }).writer === true);
}

}
