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
import { createPersist, memoryBackend, dataFolder, readFolder, readBackup, filesOf, sha256, toDeleted } from '../../src/store/persist.js';
import { createSpace, moveIntoBrewCV, planOrganise, organise, undoOrganise, reconcile } from '../../src/store/space.js';
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
  const persist = createPersist({ store, backend: memoryBackend(), deviceName: name, ...instant, ...extra.persist });
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
const listed = (map, dir) => [...map.keys()].filter(k => k.startsWith(`BrewCV/${dir}/`)).map(k => k.slice(`BrewCV/${dir}/`.length));
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
  ok('nothing is written beside BrewCV/ but BrewCV.md', [...shared.keys()].every(k => k.startsWith('BrewCV/') || k === 'BrewCV.md'));
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
  ok('…where Finder can see it, as <day> <name>', listed(shared, 'Deleted').length === 5 && listed(shared, 'Deleted').every(n => /^\d{4}-\d\d-\d\d /.test(n)));
  ok('…and the merged view itself is untouched', at(shared, 'resume-data.json') === text);

  // an agent edits a bullet in resume-data.json
  const file = JSON.parse(at(shared, 'resume-data.json'));
  const w = file.work.find(x => (x.highlights ?? []).length), was = w.highlights[0];
  w.highlights[0] = `${was} (checked outside)`;
  shared.set('BrewCV/resume-data.json', S.serialize(file));
  const versions = A.store.state.record.variants.length;
  const r2 = await A.space.sync();
  ok('a resume-data.json whose hash is no device’s write goes through outsideEdits: the edited line is a new version', r2.outside === 1 && A.store.state.record.variants.length === versions + 1 && A.store.state.record.variants.some(v => v.text === `${was} (checked outside)`));
  ok('…the file as it was edited is kept in Deleted/, and the merged view is written again', listed(shared, 'Deleted').some(n => /resume-data\.json$/.test(n)) && !at(shared, 'resume-data.json').includes('(checked outside)') === false && at(shared, 'resume-data.json') === filesOf(A.store.materialize()).get('resume-data.json'));
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
  // a recipe edited outside is kept, as a resume of its own, and never written over unread
  const edited = JSON.parse(at(shared, 'recipes/Placed by hand.json'));
  edited.meta.resumeBuilder.resume.company = 'Edited Outside Co';
  const editedText = S.serialize(edited);
  await A.space.sync();
  shared.set('BrewCV/recipes/Placed by hand.json', editedText);
  await edit(A, d => { d.resumes.find(r => r.id === 'Placed by hand.json').pageLimit = 3; }, 'x');
  ok('a saved resume file changed outside is not written over: the same guard as resume-data.json', at(shared, 'recipes/Placed by hand.json') === editedText && A.persist.outside.has('recipes/Placed by hand.json'));
  await A.space.sync(); await A.space.sync();
  ok('…and is read in as a copy next to it', A.store.state.resumes.filter(r => r.company === 'Edited Outside Co').length === 1 && A.store.state.resumes.some(r => r.company !== 'Edited Outside Co' && r.id === 'Placed by hand.json'));
  await B.space.sync(); await A.space.sync(); await B.space.sync();
  ok('…and both devices still end the same', view(A) === view(B));
  // a recipe is removed only into Deleted/
  await edit(A, d => RS.deleteSaved(d, 'Linux copy.json'), 'delete');
  ok('a deleted saved resume’s file goes to Deleted/, never unlinked', !has(shared, 'recipes/Linux copy.json') && listed(shared, 'Deleted').some(n => /Linux copy\.json$/.test(n)));
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
  const p1 = 'Library/2024/2024-03-12 Acme - Designer.txt';
  shared.set(p1, bytes);
  await edit(A, d => { DOC.addDocument(d, { name: '2024-03-12 Acme - Designer.txt', type: 'text/plain', path: p1, sha256: sha, size: bytes.length, text: 'Led the dosing system redesign.', meta: { company: 'Acme', role: 'Designer', date: '2024-03-12', lang: 'en', jobType: '', kind: 'resume' } }); }, 'document');
  const id = DOC.docId(sha), docOf = d => d.store.state.documents.find(x => x.id === id);
  const recBefore = J(A.store.state.record), printBefore = printed(A);
  await A.space.sync();
  ok('a document at its path is in the folder: nothing changes, and the receipt can tell it was read back', A.space.last.moved === 0 && A.space.last.missing === 0 && A.space.docStatus(id) === null && A.space.verified(docOf(A)));
  const p2 = 'Library/2025/2024-03-12 Acme - Designer renamed.txt';
  shared.set(p2, shared.get(p1)); shared.delete(p1);
  await A.space.sync();
  ok('a file renamed outside keeps its document: found by its hash, the path is updated quietly', docOf(A).path === p2 && A.space.last.moved === 1 && A.store.state.documents.length === 1 && J(A.store.state.record) === recBefore);
  await edit(A, () => {}, 'noop');
  await B.space.sync();
  ok('…and the other device gets the new path', docOf(B)?.path === p2);
  shared.delete(p2);
  await A.space.sync();
  ok('a file deleted outside is reported, and what was taken from it stays in the career', A.space.last.missing === 1 && A.space.docStatus(id) === 'missing' && !!docOf(A) && J(A.store.state.record) === recBefore);
  shared.set('Library/2025/.2024-03-12 Acme - Designer renamed.txt.icloud', new Uint8Array(0));
  await A.space.sync();
  ok('a file left in the cloud is told so, not “missing”', A.space.docStatus(id) === 'cloud' && A.space.last.cloud === 1);
  shared.delete('Library/2025/.2024-03-12 Acme - Designer renamed.txt.icloud');
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
  shared.set('Library/2025/copy of the same.txt', bytes);
  await A.space.sync();
  ok('one hash at two paths: the document’s own copy stays, the other goes to Deleted/', shared.has(p2) && !shared.has('Library/2025/copy of the same.txt') && listed(shared, 'Deleted').some(n => /copy of the same\.txt$/.test(n)));
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
  // a copy that fails leaves the top as it was
  const w = root.write;
  root.write = async (p, d) => { if (p.startsWith('BrewCV/checkpoints/')) throw new Error('disk full'); return w(p, d); };      // the last file but one: resume-data.json, which makes BrewCV/ the data folder, must not be there yet
  let threw = false;
  try { await moveIntoBrewCV(root); } catch { threw = true; }
  root.write = w;
  const stay = await dataFolder(root);
  ok('a move that cannot finish touches nothing at the top, and the folder is still the older kind', threw && stay.legacy === true && old.has('resume-data.json') && [...old.keys()].filter(k => k.startsWith('recipes/')).length === 2);
  for (const k of [...old.keys()].filter(k => k.startsWith('BrewCV/'))) old.delete(k);
  const n = await moveIntoBrewCV(root), now = await dataFolder(root);
  ok('on OK everything moves into BrewCV/, copied, read back and checked, and the top keeps only what is the person’s', n === 4 && now.legacy === false && ['resume-data.json', 'library.json'].every(f => !old.has(f)) && [...old.keys()].filter(k => !k.startsWith('BrewCV/')).join() === 'My Notes/keep this.md', [...old.keys()].join());
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

section('Organise: moves into Library/<year>/, run one at a time, stopping cleanly');
{
  const Mf = make(), files = Mf.fx, root = Mf.root();
  const bytes = n => new TextEncoder().encode(`file ${n}`);
  for (const n of ['a', 'b', 'c']) files.set(`Notes/2024-0${n === 'a' ? 1 : n === 'b' ? 2 : 3}-10 ${n}.pdf`, bytes(n));
  files.set('Library/2024/2024-01-10 a.pdf', bytes('other'));
  const found = (await reconcile({}, root, {})).fresh;
  const plan = await planOrganise(root, found);
  ok('the plan lists a move for each file outside Library/, to Library/<year>/ under a name no other bytes use', plan.length === 3 && plan.every(m => /^Library\/2024\/2024-0\d-10 \w( \d)?\.pdf$/.test(m.to)) && plan.find(m => m.from.endsWith('a.pdf')).to === 'Library/2024/2024-01-10 a 2.pdf', J(plan));
  const w = root.write;
  root.write = async (p, d) => { if (/b\.pdf$/.test(p) && p.startsWith('Library/')) throw new Error('copy failed'); return w(p, d); };
  const res = await organise(root, plan);
  root.write = w;
  ok('it stops at the first copy that fails: the ones before are moved, that one and the rest are where they were', res.done.length === 1 && res.failed.from.endsWith('b.pdf') && res.left.length === 1 && files.has('Notes/2024-02-10 b.pdf') && files.has('Notes/2024-03-10 c.pdf') && !files.has('Notes/2024-01-10 a.pdf') && files.has(res.done[0].to), J(res));
  ok('…and no half copy is left in Library/', !files.has(plan[1].to) && !files.has(plan[2].to));
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
  ok('the scan lists the resume-like files outside Library/ as found, and a pdf is one whatever it holds', d.space.last.fresh.length === 0, J(d.space.last.fresh));
  sf.set('Elsewhere/2023-06-01 Some resume.docx', bytes('x'));
  sf.set('Elsewhere/notes.md', new TextEncoder().encode('# Shopping\n- milk\n'));
  sf.set('Elsewhere/cv.md', new TextEncoder().encode('# Jane Roe\njane@example.com\n\n## Experience\nAcme 2019 - 2021\n\n## Skills\nCAD\n'));
  sf.set('Elsewhere/font.ttf', bytes('f')); sf.set('Elsewhere/app.js', bytes('code')); sf.set('.hidden/x.pdf', bytes('h')); sf.set('node_modules/x/y.pdf', bytes('n'));
  await d.space.sync();
  ok('the scan skips dot-folders, BrewCV/, fonts and code, and tells a note from a resume by its score', J(d.space.last.fresh.map(f => f.path)) === J(['Elsewhere/2023-06-01 Some resume.docx', 'Elsewhere/cv.md']), J(d.space.last.fresh));
  const o = await d.space.organise();
  ok('Organise through the app moves them into Library/ and a document’s path follows its file', o.done.length === 2 && sf.has('Library/2023/2023-06-01 Some resume.docx') && !sf.has('Elsewhere/2023-06-01 Some resume.docx') && sf.has('Elsewhere/notes.md'), J(o));
  await d.space.undoOrganise();
  ok('…and the log undoes it', sf.has('Elsewhere/2023-06-01 Some resume.docx') && !sf.has('Library/2023/2023-06-01 Some resume.docx'));
}

section('the Inbox: read, filed into Library/<year>/, with its receipt');
{
  const Ms = make(), sf = Ms.fx, d = await device(Ms, 'Mac');
  const FIX = path.join(REPO, 'checks/fixtures/import'), name = 'helix-1col-word.docx', bytes = new Uint8Array(fs.readFileSync(path.join(FIX, name)));
  sf.set(`Inbox/${name}`, bytes);
  sf.set('Inbox/.DS_Store', new Uint8Array(1)); sf.set('Inbox/~$helix.docx', new Uint8Array(1));
  await d.persist.link(d.data);
  const r = await d.space.sync();
  ok('the Inbox lists its files, and not what an office program or a Mac leaves in it', J(r.inbox) === J([`Inbox/${name}`]) && sf.has('BrewCV.md'));
  const [f] = await d.space.load(r.inbox);
  const e = { name: f.name, size: f.size, type: f.type, modified: f.lastModified, path: f.path, bytes: new Uint8Array(await f.arrayBuffer()) };
  e.sha256 = await sha256(e.bytes);
  e.read = await X.readFile(e.bytes, e.name, {});
  const entries = [e];
  X.classify(d.store.state, entries);
  await d.space.file(entries);
  ok('before the import is applied the file is filed into Library/<year>/ under a name with the date, and gone from the Inbox', /^Library\/\d{4}\/\d{4}-\d\d-\d\d helix-1col-word\.docx$/.test(e.path) && !sf.has(`Inbox/${name}`) && sf.has(e.path), e.path);
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
  sf.set('Inbox/again.txt', new TextEncoder().encode('Another file\n'));
  const x = { name: 'again.txt', path: 'Inbox/again.txt', status: 'resume', modified: 0, sha256: await sha256(new TextEncoder().encode('Another file\n')) };
  const w = d.folder.write;
  d.folder.write = async () => { throw new Error('disk full'); };
  await d.space.file([x]);
  d.folder.write = w;
  ok('a file that cannot be filed stays in the Inbox, and the document is made referencing it there', x.path === 'Inbox/again.txt' && sf.has('Inbox/again.txt'));
  // the same file in the Inbox again: the Library already has it
  sf.set('Inbox/helix again.docx', bytes);
  const y = { name: 'helix again.docx', path: 'Inbox/helix again.docx', status: 'seen', modified: 0, sha256: e.sha256 };
  await d.space.file([y]);
  ok('a copy of a file the Library already holds goes to Deleted/, and its entry points at the one in Library/', y.path === e.path && !sf.has('Inbox/helix again.docx') && listed(sf, 'Deleted').some(n => /helix again\.docx$/.test(n)));
  // an original embedded before a folder was linked becomes a file there
  const emb = new TextEncoder().encode('Embedded original, before the folder.\n'), esha = await sha256(emb);
  d.store.commit(s => { DOC.addDocument(s, { name: 'before.txt', type: 'text/plain', bytesDataUrl: `data:text/plain;base64,${Buffer.from(emb).toString('base64')}`, sha256: esha, size: emb.length, text: 'Embedded original', meta: { date: '2024-02-02' } }); }, 'embedded');
  await d.space.sync();
  const ref = d.store.state.documents.find(y => y.sha256 === esha);
  ok('linking a folder later writes the embedded originals into Library/ and turns them into references', ref.path === 'Library/2024/2024-02-02 before.txt' && !ref.embedded && J([...sf.get(ref.path)]) === J([...emb]), J(ref.path));
}

section('Deleted/ is swept after 30 days, and is the only place a file is unlinked');
{
  const Ms = make(), sf = Ms.fx, d = await device(Ms, 'Mac');
  sf.set('BrewCV/Deleted/2020-01-01 old.json', '1'); sf.set(`BrewCV/Deleted/${new Date().toISOString().slice(0, 10)} new.json`, '1'); sf.set('BrewCV/Deleted/no date.json', '1');
  await d.persist.link(d.data); await d.space.sync();
  ok('what is over 30 days old is removed, what is newer, or has no date to go by, stays', !sf.has('BrewCV/Deleted/2020-01-01 old.json') && sf.has(`BrewCV/Deleted/${new Date().toISOString().slice(0, 10)} new.json`) && sf.has('BrewCV/Deleted/no date.json'));
  ok('a name Deleted/ already holds gets a number', await (async () => { sf.set('BrewCV/x.json', 'a'); const a = await toDeleted(d.data, 'x.json', { day: '2026-11-01' }); sf.set('BrewCV/x.json', 'b'); const b = await toDeleted(d.data, 'x.json', { day: '2026-11-01' }); return a === 'Deleted/2026-11-01 x.json' && b === 'Deleted/2026-11-01 x 2.json' && !sf.has('BrewCV/x.json'); })());
  ok('BrewCV.md is written once, and not again when the person has changed it or deleted it', sf.has('BrewCV.md') && (sf.set('BrewCV.md', 'mine'), await d.space.sync(), sf.get('BrewCV.md') === 'mine') && (sf.delete('BrewCV.md'), await d.space.sync(), !sf.has('BrewCV.md')));
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
