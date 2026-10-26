#!/usr/bin/env node
// node checks/documents-check.mjs
// Documents in the state (src/model/documents.js): a file the person imported is kept with its text, details and (with no linked folder) its bytes;
// one file is one document on every device; the state carries them through a backup and a clocked merge; an older file opens as before.
// The PDF and DOCX bytes are made here from nothing; the text is the example's own.

import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import * as S from '../src/model/schema.js';
import * as DOC from '../src/model/documents.js';
import { normText } from '../src/model/record.js';
import * as M from '../src/model/merge.js';
import * as RS from '../src/model/resumes.js';
import { errText } from '../src/i18n/index.js';
import { createStore, isAssetRef } from '../src/store/store.js';
import { createPersist, memoryBackend, memoryFolder, makeBackup, readBackup, readFolder, keepOriginals, filesOf } from '../src/store/persist.js';
import { createDocument } from '../scripts/lib/dom.mjs';
import { renderPages } from '../src/render.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const clone = x => structuredClone(x);
const J = x => JSON.stringify(x);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);

const base = S.load(read('data/example.json')).model;
S.ensureRecordId(base);
const names = read('data/example-resumes/index.json');
const resumes = names.map(n => ({ ...S.loadResume(read(`data/example-resumes/${n}`), base).recipe, id: n }));
const printed = (record, list) => list.map(r => crypto.createHash('sha256').update(renderPages(record, r, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('\n')).digest('hex'));
const printedBefore = printed(base, resumes);

// ---- invented files: bytes made here, text from the example ----
const texts = base.variants.map(v => v.text);
const mine = texts.slice(0, 14), other = texts.slice(14, 28);
const DOCX_TEXT = mine.join('\n');
// what a PDF reader gives for the same lines: ligatures, curly quotes and no final full stop
const PDF_TEXT = mine.map(l => l.replace(/fi/g, 'ﬁ').replace(/'/g, '’').replace(/\.$/, '')).join('\n');
const file = (kind, tag, kb = 3) => {
  const bytes = Buffer.from(`${kind} ${tag} ${'x'.repeat(kb * 1024)}`);
  return { bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length, url: `data:application/octet-stream;base64,${bytes.toString('base64')}` };
};
const pdf = file('%PDF-1.4', 'a'), docx = file('PK', 'b'), pdf2 = file('%PDF-1.4', 'c'), pdf3 = file('%PDF-1.4', 'd');
const addFile = (state, f, extra = {}) => DOC.addDocument(state, { name: 'cv.pdf', type: 'application/pdf', bytesDataUrl: f.url, sha256: f.sha256, size: f.size,
  meta: { company: 'Northgate', role: 'Designer', date: '2026-01-05', lang: 'en', jobType: '', kind: 'resume' }, text: DOCX_TEXT, from: 'imported', addedAt: '2026-10-26T09:00:00.000Z', ...extra });
const fresh = () => ({ record: clone(base), resumes: clone(resumes), frozen: {}, cur: null, openId: null });

section('a document, and the same file again');
{
  const st = fresh();
  const d = addFile(st, pdf);
  ok('the id comes from the file: doc- and the first 12 of its sha256', d.id === `doc-${pdf.sha256.slice(0, 12)}` && st.documents.length === 1);
  const again = addFile(st, pdf, { name: 'copy of cv.pdf', addedAt: '2027-01-01T00:00:00.000Z' });
  ok('the same file added twice is one document, the first', st.documents.length === 1 && again === d && again.name === 'cv.pdf');
  ok('findBySha finds it, and not another file', DOC.findBySha(st, pdf.sha256) === d && DOC.findBySha(st, docx.sha256) === null);
  ok('an original without a linked folder is kept in the document', st.documents[0].embedded === pdf.url && !('path' in d));
  const ref = addFile(st, pdf2, { path: 'Library/2026/cv.pdf' });
  ok('with a path the original is a reference, nothing is embedded', ref.path === 'Library/2026/cv.pdf' && !('embedded' in ref));
  const huge = `data:application/pdf;base64,${'A'.repeat(14_100_000)}`;      // about 10.6 MB of bytes
  let err = null; try { addFile(st, pdf3, { bytesDataUrl: huge, size: 5 }); } catch (e){ err = e; }
  ok('an original over 10 MB is refused with a message a person can read, whatever size the caller gives', err?.key === 'i2.tooBig' && /11 MB/.test(errText(err)) && st.documents.length === 2, errText(err));
  let err2 = null; try { addFile(st, pdf3, { bytesDataUrl: huge, size: undefined }); } catch (e){ err2 = e; }
  ok('and with no size at all', err2?.key === 'i2.tooBig');
  let err3 = null; try { addFile(st, pdf3, { bytesDataUrl: 'asset:abc' }); } catch (e){ err3 = e; }
  ok('an original that is not a data: URL is refused', !!err3 && st.documents.length === 2);
  ok('the same bytes are fine when the original is a reference', !!addFile(st, pdf3, { bytesDataUrl: huge, path: 'Library/2026/big.pdf' }));
  let bad = null; try { addFile(st, { ...pdf3, sha256: 'nope' }); } catch (e){ bad = e; }
  ok('a document needs a real sha256', !!bad);
}

section('a backup keeps documents, rounds and the import log');
{
  const st = fresh();
  addFile(st, pdf, { taken: { claims: ['c1'], versions: ['v1'], skipped: [], unplaced: 2 } });
  addFile(st, docx, { name: 'cv.docx', of: `doc-${pdf.sha256.slice(0, 12)}`, round: 'r1' }).archived = true;
  st.rounds = [{ id: 'r1', name: 'Spring 2027', from: '2027-03-01' }];
  st.resumes[0].round = 'r1'; st.resumes[1].archived = true;
  DOC.logImport(st, { sha256: pdf.sha256, name: 'cv.pdf', kind: 'pdf', at: '2026-10-26T09:00:00.000Z', result: 'added', recordId: base.recordId, saved: null });
  const back = JSON.parse(JSON.stringify(makeBackup(st)));
  ok('the backup holds the three lists', back.documents.length === 2 && back.rounds.length === 1 && back.imports.length === 1);
  const rb = readBackup(back);
  ok('a document round-trips, bytes included', eq(rb.state.documents, st.documents) && rb.state.documents[0].embedded === pdf.url);
  ok('rounds and the import log round-trip', eq(rb.state.rounds, st.rounds) && eq(rb.state.imports, st.imports));
  const key = r => RS.printedKey(r, {});
  ok('round and archived are not part of what a resume prints', key({ ...st.resumes[3], round: 'r1', archived: true }) === key(st.resumes[3]) && key({ ...st.resumes[3], round: 'r2' }) === key({ ...st.resumes[3], round: 'r1' }));
  ok('a saved resume keeps its round and archived flag', rb.state.resumes[0].round === 'r1' && rb.state.resumes[1].archived === true);
  ok('and reads with no warnings', rb.warnings.length === 0, rb.warnings[0]);
  ok('saved resumes print the same with a round or archived flag', eq(printed(base, st.resumes), printedBefore) && eq(printed(rb.state.record, rb.state.resumes), printedBefore));

  const plain = JSON.parse(JSON.stringify(makeBackup(fresh())));
  ok('a state with none of them writes none of them, so the file is as it always was', !('documents' in plain) && !('rounds' in plain) && !('imports' in plain));
  const old = readBackup(plain);
  ok('an older backup, with no documents, opens with no warnings and an empty library', old.warnings.length === 0 && eq(old.state.documents, []) && eq(old.state.imports, []) && eq(old.state.rounds, []));

  // an older app reads a backup with detect, load(record) and loadResume: it never looks at the new keys
  const ignoring = obj => { if (S.detect(obj) !== 'backup') return null; const { model, warnings } = S.load(obj.record); for (const f of obj.resumes) warnings.push(...S.loadResume(f, model).warnings); return { model, warnings }; };
  const them = ignoring(back);
  ok('code that ignores the new keys still opens a backup that has them', !!them && them.warnings.length === 0);
  const stripped = clone(back); delete stripped.documents; delete stripped.rounds; delete stripped.imports;
  const rs = readBackup(stripped);
  ok('and so does this code, with the keys deleted', rs.warnings.length === 0 && rs.state.resumes.length === st.resumes.length && eq(rs.state.documents, []));
  const garbled = clone(back); garbled.documents = [{ no: 'id' }, null, 7, ...garbled.documents]; garbled.imports = 'x'; garbled.rounds = { a: 1 };
  const g = readBackup(garbled);
  ok('a hand-edited file with junk in the lists keeps only what has an id', g.state.documents.length === 2 && eq(g.state.imports, []) && eq(g.state.rounds, []));

  ok('with no documents the folder gets no library.json', !filesOf(fresh()).has('library.json'));
  const files = filesOf(st);
  ok('with documents it gets one, without the bytes', files.has('library.json') && !files.get('library.json').includes('base64') && JSON.parse(files.get('library.json')).documents.length === 2);
  ok('and the career file is the same bytes either way', files.get('resume-data.json') === filesOf(fresh()).get('resume-data.json'));
}

section('the import log');
{
  const st = fresh();
  ok('a file never seen is not already imported', DOC.alreadyImported(st, pdf.sha256) === null);
  const e = DOC.logImport(st, { sha256: pdf.sha256, name: 'cv.pdf', kind: 'pdf', at: '2026-10-26T09:00:00.000Z', result: 'added', recordId: 'r', saved: null });
  ok('after it is logged it is, and the entry says when', DOC.alreadyImported(st, pdf.sha256) === e && e.at.startsWith('2026-10-26'));
  ok('another file is not', DOC.alreadyImported(st, docx.sha256) === null);
}

section('another format of one resume');
{
  const st = fresh();
  addFile(st, pdf, { text: PDF_TEXT });
  ok('the PDF text differs from the DOCX text as written', PDF_TEXT !== DOCX_TEXT);
  ok('the DOCX of the same resume is linked to the PDF', DOC.sameDocument(st, DOCX_TEXT)?.id === `doc-${pdf.sha256.slice(0, 12)}`);
  ok('a different resume is not', DOC.sameDocument(st, other.join('\n')) === null);
  ok('a resume that shares most lines but not 90% both ways is not', DOC.sameDocument(st, [...mine.slice(0, 11), ...other.slice(0, 5)].join('\n')) === null);
  ok('a text that is only part of the stored document is not (the second direction)', DOC.sameDocument(st, mine.slice(0, 7).join('\n')) === null);
  ok('one that is the PDF plus a lot more is not', DOC.sameDocument(st, [...mine, ...other].join('\n')) === null);
  ok('a text with no lines is linked to nothing', DOC.sameDocument(st, '  \n ') === null && DOC.sameDocument(fresh(), DOCX_TEXT) === null);
}

section('inFile: is the original in a saved file');
{
  const st = fresh();
  const before = JSON.parse(JSON.stringify(makeBackup(st)));
  addFile(st, pdf); addFile(st, docx, { name: 'cv.docx' });
  const after = JSON.parse(JSON.stringify(makeBackup(st)));
  const id = d => `doc-${d.sha256.slice(0, 12)}`;
  ok('a backup saved after the import holds the documents', eq(DOC.inFile(st, after), [id(pdf), id(docx)]));
  ok('one saved before the import does not', eq(DOC.inFile(st, before), []));
  const textOnly = clone(st); DOC.keepTextOnly(textOnly, id(pdf));
  ok('a file that has only the text of a document does not hold its original', eq(DOC.inFile(st, JSON.parse(JSON.stringify(makeBackup(textOnly)))), [id(docx)]));
  const dangling = clone(after); dangling.documents.forEach(d => { d.embedded = 'asset:12345678-abc'; });
  ok('a document whose original is a dangling asset: ref is not held', eq(DOC.inFile(st, dangling), []));
  ok('a backup with no documents key, or nothing at all, holds none', eq(DOC.inFile(st, {}), []) && eq(DOC.inFile(st, null), []));
}

section('an embedded original stays out of the undo steps');
{
  const big = file('%PDF-1.4', 'big', 200);
  const s = createStore(fresh());
  s.commit(d => { addFile(d, big); }, 'Add file');
  const doc = s.state.documents[0];
  ok('the state holds a ref, not the bytes', isAssetRef(doc.embedded));
  ok('the asset map holds them, and materialize puts them back', s.asset(doc.embedded) === big.url && s.materialize().documents[0].embedded === big.url);
  for (let i = 0; i < 50; i++) s.commit(d => { d.record.basics.label = `P${i}`; }, `P${i}`);
  const perStep = s.history.bytes / s.history.undo;
  ok('a step costs about what the career does, not the file', perStep < JSON.stringify(fresh()).length * 2 + 10_000 + JSON.stringify(s.state.documents).length * 2, `${Math.round(perStep / 1024)} KB per step`);
  const small = createStore(fresh());
  small.commit(d => { addFile(d, pdf2, { bytesDataUrl: 'data:text/plain;base64,QQ==' }); }, 'Add small');
  ok('a data: URL under 1 KB stays in the state, one over it of any type goes out', small.state.documents[0].embedded.startsWith('data:') && !isAssetRef(small.state.documents[0].embedded));
}

section('keep text only frees the original');
{
  const big = file('%PDF-1.4', 'big', 200);
  let id = 0, wall = Date.parse('2026-10-26T09:00:00.000Z');
  const store = createStore(fresh()), backend = memoryBackend();
  const persist = createPersist({ store, backend, now: () => new Date(wall), setTimer: () => ++id, clearTimer: () => {} });
  store.commit(d => { addFile(d, big); }, 'Add file');
  await persist.flush();
  const ref = store.state.documents[0].embedded;
  ok('saved: the original is one asset in browser storage', (await backend.list('asset/')).length === 1 && (await backend.get(`asset/${ref}`)) === big.url);
  const s2 = createStore({});
  const p2 = createPersist({ store: s2, backend, now: () => new Date(wall), setTimer: () => ++id, clearTimer: () => {} });
  await p2.restore();
  ok('and a reload brings it back whole', s2.materialize().documents[0].embedded === big.url);
  wall += 1000;
  store.commit(d => { DOC.keepTextOnly(d, store.state.documents[0].id); }, 'Keep text only');
  ok('keepTextOnly drops the original and keeps the text and details', !('embedded' in store.state.documents[0]) && store.state.documents[0].text === DOCX_TEXT && store.state.documents[0].sha256 === big.sha256);
  await persist.flush();
  ok('the next save keeps the asset while undo can still bring the original back', (await backend.list('asset/')).length === 1);
  store.reset(store.state);
  wall += 1000; store.commit(d => { d.record.basics.label = 'After'; }, 'Edit'); await persist.flush();
  ok('and removes it once nothing points to it', (await backend.list('asset/')).length === 0);
  store.gcAssets();
  ok('the store drops it too', store.assets.size === 0);
  persist.stop(); p2.stop();
}

section('checkpoints keep the originals once');
{
  const bytes = f => Buffer.byteLength(JSON.stringify(f));
  let id = 0, wall = Date.parse('2026-10-26T09:00:00.000Z');
  const mkp = (store, backend) => createPersist({ store, backend, now: () => new Date(wall), setTimer: () => ++id, clearTimer: () => {} });
  const store = createStore(fresh()), backend = memoryBackend(), persist = mkp(store, backend);
  const files = Array.from({ length: 20 }, (_, i) => file('%PDF-1.4', `n${i}`, 100));
  store.commit(d => { files.forEach((f, i) => addFile(d, f, { name: `${i}.pdf` })); }, 'Add 20');
  await persist.flush();
  const originals = files.reduce((n, f) => n + bytes(f.url), 0);
  const first = await persist.checkpoint('First', 'manual');
  for (let i = 0; i < 49; i++){ wall += 1000; await persist.checkpoint(`C${i}`, 'import'); }
  const all = await backend.list('checkpoint/');
  const cps = (await Promise.all(all.map(k => backend.get(k)))).reduce((n, c) => n + bytes(c), 0), assets = (await backend.list('asset/')).reduce((n, k) => n + bytes(backend._map.get(k)), 0);
  ok('50 checkpoints of 20 embedded documents hold each original once, under asset/', all.length === 50 && assets <= originals + 1000 && (await backend.list('asset/')).length === 20);
  const own = bytes(store.state);      // a checkpoint is the state with refs in place of the bytes
  ok('no checkpoint holds the bytes: each is about the state’s own size', cps < 50 * own * 1.1, `${Math.round(cps / 1024)} KB of checkpoints, ${Math.round(own / 1024)} KB a state`);
  ok('so the whole backend is one copy of the originals plus the checkpoints’ own text, not 50 copies', [...backend._map.values()].reduce((n, v) => n + bytes(v), 0) < originals + 50 * own * 1.3 + 100_000 && 50 * originals > 10 * (originals + 50 * own));
  // drop the original of the first document, save, and restore the first checkpoint
  const target = store.state.documents[0].id;
  wall += 1000; store.commit(d => { DOC.keepTextOnly(d, target); }, 'Keep text only'); store.reset(store.state); await persist.flush();
  ok('the asset stays in storage while a checkpoint holds it', (await backend.list('asset/')).length === 20);
  await persist.restoreCheckpoint(first);
  ok('restoring an older checkpoint brings the original back', store.materialize().documents[0].embedded === files[0].url);
  await persist.flush();
  ok('and a loaded checkpoint is the whole state, bytes inline', (await persist.loadCheckpoint(first)).state.documents[0].embedded === files[0].url && (await persist.backup({ checkpoints: true })).checkpoints.find(c => c.id === first).state.documents.every(d => d.embedded.startsWith('data:')));
  for (const k of await backend.list('checkpoint/')) await persist.deleteCheckpoint(backend._map.get(k).id);
  store.reset(store.state); wall += 1000; store.commit(d => { DOC.keepTextOnly(d, target); }, 'Keep text only'); store.reset(store.state); await persist.flush();
  ok('with the checkpoints deleted the dropped original’s asset goes at the next save', (await backend.list('asset/')).length === 19);
  // a checkpoint made before this (the bytes inline) still restores
  const old = createStore(fresh()), oldBackend = memoryBackend(), op = mkp(old, oldBackend);
  const inline = fresh(); addFile(inline, files[0]);
  await oldBackend.put('checkpoint/c-old', { id: 'c-old', label: 'Old', kind: 'manual', at: '2026-01-01T00:00:00.000Z', state: inline });
  await oldBackend.put('checkpoints/index', [{ id: 'c-old', label: 'Old', kind: 'manual', at: '2026-01-01T00:00:00.000Z' }]);
  await op.restoreCheckpoint('c-old');
  ok('a checkpoint with the original inline restores, and its original is back in the store’s assets', old.materialize().documents[0].embedded === files[0].url && isAssetRef(old.state.documents[0].embedded));
  persist.stop(); op.stop();
}

section('saving does not read the originals back, and a failing clean-up does not fail the save');
{
  let id = 0, wall = Date.parse('2026-10-26T09:00:00.000Z');
  const inner = memoryBackend(), reads = [];
  let failDelete = false;
  const backend = { ...inner, async get(k){ if (k.startsWith('asset/')) reads.push(k); return inner.get(k); }, async delete(k){ if (failDelete && k.startsWith('asset/')) throw new Error('storage said no'); return inner.delete(k); } };
  const folder = memoryFolder();
  const store = createStore(fresh()), persist = createPersist({ store, backend, folder, now: () => new Date(wall), setTimer: () => ++id, clearTimer: () => {} });
  const five = [1, 2, 3, 4, 5].map(i => file('%PDF-1.4', `r${i}`, 50));
  store.commit(d => { five.forEach((f, i) => addFile(d, f, { name: `${i}.pdf` })); }, 'Add');
  await persist.flush();
  wall += 1000; store.commit(d => { d.record.basics.label = 'Again'; }, 'Edit'); await persist.flush();
  await persist.checkpoint('Mid', 'manual');
  ok('a save and a checkpoint read no asset back, however many originals there are', reads.length === 0 && (await inner.list('asset/')).length === 5, `${reads.length} reads`);
  const cpFile = [...folder._files.keys()].find(k => k.startsWith('checkpoints/'));
  ok('a checkpoint file in a linked folder carries the documents text-only', !!cpFile && !folder._files.get(cpFile).includes('base64') && JSON.parse(folder._files.get(cpFile)).documents.length === 5);
  ok('and so does library.json', !folder._files.get('library.json').includes('base64') && JSON.parse(folder._files.get('library.json')).documents.length === 5);
  failDelete = true;
  wall += 1000; store.commit(d => { DOC.keepTextOnly(d, store.state.documents[0].id); d.record.basics.label = 'Third'; }, 'Keep text only'); store.reset(store.state);
  for (const c of await persist.listCheckpoints()) await persist.deleteCheckpoint(c.id);
  await persist.flush();
  ok('a clean-up that cannot delete leaves the save done: saved, not an error, the clock stamped', persist.status.status === 'saved' && (await backend.get('state/current')).state.record.basics.label === 'Third' && (await backend.get('meta/clock'))?.keys['basics.label'] !== undefined);
  persist.stop();

  // two tabs on one storage: the other tab saves between this tab's write and its clean-up
  const shared = memoryBackend();
  let hook = null;
  const tabB = { ...shared, async get(k){ if (k === 'checkpoints/index' && hook){ const h = hook; hook = null; await h(); } return shared.get(k); } };
  const sa = createStore(fresh()), pa = createPersist({ store: sa, backend: shared, now: () => new Date(wall), setTimer: () => ++id, clearTimer: () => {} });
  const sb = createStore(fresh()), pb = createPersist({ store: sb, backend: tabB, now: () => new Date(wall), setTimer: () => ++id, clearTimer: () => {} });
  sa.commit(d => { addFile(d, five[0]); }, 'A adds'); await pa.flush();
  sb.commit(d => { d.record.basics.label = 'B edits'; }, 'B edits');
  hook = async () => { sa.commit(d => { d.record.basics.label = 'A again'; }, 'A edits'); await pa.flush(); };
  await pb.flush();
  ok('a tab’s clean-up keeps what another tab’s state, saved a moment before, still points to', (await shared.list('asset/')).length === 1);
  pa.stop(); pb.stop();
}

section('the folder carries documents, rounds and the import log; the one-file tool says what it cannot carry');
{
  const st = fresh();
  addFile(st, pdf); st.rounds = [{ id: 'r1', name: 'Spring 2027', from: '2027-03-01' }];
  DOC.logImport(st, { sha256: pdf.sha256, name: 'cv.pdf', kind: 'pdf', at: '2026-10-26T09:00:00.000Z', result: 'added', recordId: 'r', saved: null });
  const lib = JSON.parse(filesOf(st).get('library.json'));
  ok('library.json holds the three lists, the original left out', lib.documents.length === 1 && !('embedded' in lib.documents[0]) && lib.rounds.length === 1 && lib.imports.length === 1);
  const got = await readFolder(memoryFolder(Object.fromEntries(filesOf(st))));
  ok('a folder is read back with them, text only', got.warnings.length === 0 && got.state.documents.length === 1 && got.state.documents[0].text === DOCX_TEXT && !('embedded' in got.state.documents[0]) && eq(got.state.rounds, st.rounds) && eq(got.state.imports, st.imports));
  const none = await readFolder(memoryFolder(Object.fromEntries(filesOf(fresh()))));
  ok('a folder with no library.json reads with empty lists, and a garbled one with a warning', eq(none.state.documents, []) && (await readFolder(memoryFolder({ ...Object.fromEntries(filesOf(fresh())), 'library.json': '{' }))).warnings.length === 1);
  // "Use the folder's data": the folder's documents are text-only, and the originals this browser holds stay
  const cur = fresh(); addFile(cur, pdf); addFile(cur, docx, { name: 'cv.docx' });
  const disk = await readFolder(memoryFolder(Object.fromEntries(filesOf(cur))));
  disk.state.documents.push({ ...clone(disk.state.documents[0]), id: 'doc-other', sha256: 'f'.repeat(64) });
  disk.state.documents[0].name = 'renamed on disk.pdf';
  keepOriginals(disk.state, cur);
  ok('a document the folder and this browser both hold keeps this browser’s original, and the folder’s details', disk.state.documents.slice(0, 2).every((d, i) => d.embedded === [pdf, docx][i].url) && disk.state.documents[0].name === 'renamed on disk.pdf');
  ok('one only the folder has stays text-only', !('embedded' in disk.state.documents[2]) && keepOriginals({ documents: [] }, cur).documents.length === 0 && keepOriginals({}, null) !== null);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brewcv-docs-'));
  const run = (...args) => spawnSync(process.execPath, [path.join(REPO, 'scripts/onefile.mjs'), ...args], { encoding: 'utf8' });
  fs.writeFileSync(path.join(tmp, 'in.json'), JSON.stringify(makeBackup(st)));
  const un = run('unpack', path.join(tmp, 'in.json'), path.join(tmp, 'dir'));
  ok('unpack says whose original it cannot carry, and writes library.json', un.status === 0 && un.stderr.includes('cv.pdf') && fs.existsSync(path.join(tmp, 'dir', 'library.json')));
  const pk = run('pack', path.join(tmp, 'dir'), path.join(tmp, 'out.json'));
  const back = JSON.parse(fs.readFileSync(path.join(tmp, 'out.json'), 'utf8'));
  ok('pack keeps the documents, rounds and import log (text only) and names the originals it cannot carry', pk.status === 0 && pk.stderr.includes('cv.pdf') && back.documents.length === 1 && !('embedded' in back.documents[0]) && back.rounds.length === 1 && back.imports.length === 1);
  fs.rmSync(tmp, { recursive: true, force: true });
}

section('safety: is my old file safe to delete');
{
  const mk = (extra = {}, over = {}) => { const st = fresh(); const d = addFile(st, pdf, extra); Object.assign(d, over); return d; };
  const at = '2026-10-26T09:00:00.000Z', after = '2026-10-26T10:00:00.000Z', before = '2026-10-26T08:00:00.000Z';
  const st = fresh(); addFile(st, pdf);
  const id = st.documents[0].id;
  const s = (d, o) => DOC.safety(d, o);

  const unread = s(mk({ text: '' }), {});
  ok('not read: the file is not read, nothing is in the career, and it is not safe', !unread.read.ok && unread.read.state === 'unread' && !unread.record.ok && !unread.safe);
  const readOne = s(mk(), {});
  ok('read: the tick says how many lines', readOne.read.ok && readOne.read.text.includes(String(new Set(DOCX_TEXT.split('\n').map(normText).filter(Boolean)).size)), readOne.read.text);
  const unplaced = s(mk({ taken: { claims: [], versions: [], skipped: [], unplaced: 3 } }), { lastFileSave: { at: after }, checked: { at: after, ids: [id] } });
  ok('lines not placed: the career tick is not green, whatever else holds', !unplaced.record.ok && unplaced.record.state === 'unplaced' && unplaced.record.text.includes('3') && unplaced.kept.ok && !unplaced.safe);
  const browser = s(mk(), {});
  ok('only in this browser: kept is not green and says to save', !browser.kept.ok && browser.kept.state === 'browser' && !browser.safe);
  const staleSave = s(mk(), { lastFileSave: { at: before } });
  ok('a save from before the import does not count', staleSave.kept.state === 'browser');
  const saved = s(mk(), { lastFileSave: { at: after } });
  ok('saved to a file but not checked: still not safe, a download alone proves nothing', !saved.kept.ok && saved.kept.state === 'saved' && !saved.safe);
  const wrong = s(mk(), { lastFileSave: { at: after }, checked: { at: after, ids: [] } });
  ok('a checked file that misses the document is not a check', wrong.kept.state === 'saved' && !wrong.safe);
  const inFile = s(mk(), { lastFileSave: { at: after }, checked: { at: after, ids: [id] } });
  ok('in the file after a check: all three are green and it is safe', inFile.read.ok && inFile.record.ok && inFile.kept.ok && inFile.kept.state === 'file' && inFile.safe);
  const folder = s(mk({ path: 'Library/2026/cv.pdf', bytesDataUrl: undefined }), { folderVerified: true });
  ok('in the folder, read back and checked: safe, and the line names the path', folder.kept.state === 'folder' && folder.kept.text.includes('Library/2026/cv.pdf') && folder.safe);
  const unverified = s(mk({ path: 'Library/2026/cv.pdf', bytesDataUrl: undefined }), {});
  ok('a path nobody has read back is not kept', !unverified.kept.ok && !unverified.safe);
  const t = fresh(); const td = addFile(t, pdf); DOC.keepTextOnly(t, td.id);
  const textOnly = s(td, { lastFileSave: { at: after }, checked: { at: after, ids: [td.id] } });
  ok('with the original dropped nothing is kept, so it is not safe', !textOnly.kept.ok && textOnly.kept.state === 'none' && !textOnly.safe);
  ok('the verdict is in words', typeof inFile.text === 'string' && inFile.text !== browser.text && inFile.text.length > 0);
}

section('a clocked merge keeps both sides’ documents, rounds and import log');
{
  let id = 0, wall = Date.parse('2026-10-26T09:00:00.000Z');
  const later = () => { wall += 60_000; };
  const device = () => { const store = createStore(fresh()); return { store, persist: createPersist({ store, backend: memoryBackend(), now: () => new Date(wall), setTimer: () => ++id, clearTimer: () => {} }) }; };
  const A = device(), B = device();
  const shared = { sha256: pdf.sha256 };
  A.store.commit(d => {
    addFile(d, pdf, { name: 'cv.pdf', addedAt: '2026-10-26T09:00:00.000Z' }); addFile(d, docx, { name: 'cv.docx' });
    d.rounds = [{ id: 'r-spring', name: 'Spring 2027', from: '2027-03-01' }];
    DOC.logImport(d, { ...shared, name: 'cv.pdf', kind: 'pdf', at: '2026-10-26T09:00:00.000Z', result: 'added', recordId: 'r', saved: null });
  }, 'A imports');
  later();
  B.store.commit(d => {
    addFile(d, pdf, { name: 'Resume.pdf', addedAt: '2026-10-26T09:05:00.000Z' }); addFile(d, pdf2, { name: 'old.pdf' });
    d.rounds = [{ id: 'r-autumn', name: 'Autumn 2027', from: '2027-09-01' }];
    DOC.logImport(d, { ...shared, name: 'Resume.pdf', kind: 'pdf', at: '2026-10-26T09:05:00.000Z', result: 'nothing new', recordId: 'r', saved: null });
  }, 'B imports');
  const sa = await A.persist.forMerge(); later(); const sb = await B.persist.forMerge();
  const ab = M.merge(sa, sb), ba = M.merge(sb, sa);
  ok('merging A into B and B into A gives byte-identical states and clocks', J(ab.state) === J(ba.state) && J(ab.clock) === J(ba.clock));
  const ids = ab.state.documents.map(d => d.id).sort();
  ok('every document is in, the shared file once', J(ids) === J([pdf, docx, pdf2].map(f => `doc-${f.sha256.slice(0, 12)}`).sort()), ids.join());
  ok('with the original of each', ab.state.documents.every(d => d.embedded?.startsWith('data:')));
  ok('both sides’ rounds are in', J(ab.state.rounds.map(r => r.id).sort()) === J(['r-autumn', 'r-spring']));
  ok('the import log is the union, each entry once, oldest first', ab.state.imports.length === 2 && ab.state.imports[0].at < ab.state.imports[1].at);
  const joinedDoc = ab.state.documents.find(d => d.sha256 === pdf.sha256);
  ok('the file both added is one document: the later edit’s details, the earliest addedAt, and no line', joinedDoc.name === 'Resume.pdf' && joinedDoc.addedAt === '2026-10-26T09:00:00.000Z' && !ab.summary.some(l => l.key.startsWith('document:')) && J(ab.state) === J(ba.state));
  ok('merging again changes nothing', M.merge({ state: ab.state, clock: ab.clock }, sb).changed === 0 && M.merge({ state: ab.state, clock: ab.clock }, sa).changed === 0);
  ok('a copy that has none of them takes them, and its log counts as a change', M.merge(await device().persist.forMerge(), sb).changed > 0);
  ok('every saved resume prints the same after the merge', eq(printed(ab.state.record, ab.state.resumes), printedBefore));
  const C = device(), D = device();
  C.store.commit(d => { DOC.logImport(d, { ...shared, name: 'cv.pdf', kind: 'pdf', at: '2026-10-26T09:00:00.000Z', result: 'nothing new', recordId: 'r', saved: null }); }, 'C logs');
  const [sc, sd] = [await C.persist.forMerge(), await D.persist.forMerge()];
  const cd = M.merge(sd, sc), dc = M.merge(sc, sd);
  ok('a log that is new to a copy is one change, so it is committed, and both orders agree', cd.changed === 1 && cd.logged === true && cd.state.imports.length === 1 && ab.logged === true && J(cd.state) === J(dc.state) && M.merge(sc, sc).changed === 0);
}

console.log(failed ? `\n${failed} documents check(s) FAILED` : '\nall documents checks passed');
process.exit(failed ? 1 : 0);
