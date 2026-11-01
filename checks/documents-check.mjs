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
import * as X from '../src/model/intake.js';
import { printedFacts, newResume, chooseVariant } from '../src/model/resume.js';
import { printedFactIds } from '../src/model/lang.js';
import { usedVersions } from '../src/model/resumes.js';
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
  const ref = addFile(st, pdf2, { path: 'Documents/2026/cv.pdf' });
  ok('with a path the original is a reference, nothing is embedded', ref.path === 'Documents/2026/cv.pdf' && !('embedded' in ref));
  const huge = `data:application/pdf;base64,${'A'.repeat(14_100_000)}`;      // about 10.6 MB of bytes
  let err = null; try { addFile(st, pdf3, { bytesDataUrl: huge, size: 5 }); } catch (e){ err = e; }
  ok('an original over 10 MB is refused with a message a person can read, whatever size the caller gives', err?.key === 'i2.tooBig' && /11 MB/.test(errText(err)) && st.documents.length === 2, errText(err));
  let err2 = null; try { addFile(st, pdf3, { bytesDataUrl: huge, size: undefined }); } catch (e){ err2 = e; }
  ok('and with no size at all', err2?.key === 'i2.tooBig');
  let err3 = null; try { addFile(st, pdf3, { bytesDataUrl: 'asset:abc' }); } catch (e){ err3 = e; }
  ok('an original that is not a data: URL is refused', !!err3 && st.documents.length === 2);
  ok('the same bytes are fine when the original is a reference', !!addFile(st, pdf3, { bytesDataUrl: huge, path: 'Documents/2026/big.pdf' }));
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
  const folder = s(mk({ path: 'Documents/2026/cv.pdf', bytesDataUrl: undefined }), { folderVerified: true });
  ok('in the folder, read back and checked: safe, and the line names the path', folder.kept.state === 'folder' && folder.kept.text.includes('Documents/2026/cv.pdf') && folder.safe);
  const unverified = s(mk({ path: 'Documents/2026/cv.pdf', bytesDataUrl: undefined }), {});
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

section('the Library: rounds, the archive, groups, removing and rebuilding');
{
  const lines = r => { const p = printedFacts(base, r); return [p.summary, ...p.work.flatMap(w => [w.position, ...w.highlights])].filter(x => x?.text).map(x => x.text); };
  const en = resumes.find(r => (r.lang ?? 'en') === 'en' && lines(r).length >= 8), enLines = lines(en);
  const doc = (n, extra = {}) => { const f = file('%PDF-1.4', `lib-${n}`); return { f, add: (st, more = {}) => { const x = { ...extra, ...more }, d = addFile(st, f, { name: `${n}.pdf`, text: enLines.join('\n'), ...x }); for (const k of ['with', 'resume']) if (x[k]) d[k] = x[k]; return d; } }; };      // a letter’s links are set by the import, not by addDocument

  // rounds: the current one is the newest that is not archived; new and duplicated resumes go into it
  const st = fresh(); st.cur = newResume(st.record, { format: 'a4' });
  ok('with no round, a new resume has none (it is saved as it always was)', RS.saveNew(st, { name: 'No round' }) && st.resumes.at(-1).round === undefined);
  let threw = false; try { DOC.startRound(st, '  '); } catch { threw = true; }
  ok('a round needs a name', threw && !st.rounds);
  const spring = DOC.startRound(st, 'Spring 2027', '2027-03-01'), autumn = DOC.startRound(st, 'Autumn 2027', '2027-09-01');
  ok('starting a round closes the one before it, and the new one is the current round', st.rounds.find(r => r.id === spring.id).to === '2027-09-01' && DOC.currentRound(st).id === autumn.id && DOC.startRound(st, 'Autumn 2027', '2027-09-01').id === autumn.id && st.rounds.length === 2);
  const made1 = RS.saveNew(st, { name: 'In autumn' }), made2 = RS.duplicate(st, st.resumes[0].id);
  ok('a new resume and a duplicate go into the current round', st.resumes.find(r => r.id === made1.id).round === autumn.id && st.resumes.find(r => r.id === made2.id).round === autumn.id);
  DOC.mark(st, 'resumes', made2.id, { round: spring.id });
  ok('moving the open resume to a round changes its working copy too, so the next save keeps it, and its last-saved date does not move', (() => { const was = st.resumes.find(r => r.id === made2.id).savedAt; RS.settle(st); const r = st.resumes.find(x => x.id === made2.id); return r.round === spring.id && st.cur.round === spring.id && r.savedAt === was; })());
  const dup3 = RS.duplicate(st, made2.id);
  ok('a copy of a resume in an older round goes into the current one, not its original’s', st.resumes.find(r => r.id === dup3.id).round === autumn.id);
  DOC.mark(st, 'rounds', spring.id, { archived: true });
  ok('a resume in an archived round is hidden, one that is archived itself is hidden, the rest are not', DOC.hidden(st, st.resumes.find(r => r.id === made2.id)) && !DOC.hidden(st, st.resumes.find(r => r.id === made1.id)) && (DOC.mark(st, 'resumes', made1.id, { archived: true }), DOC.hidden(st, st.resumes.find(r => r.id === made1.id))));
  DOC.mark(st, 'resumes', made1.id, { archived: false });
  ok('and the archive flag goes away when it is switched off', !('archived' in st.resumes.find(r => r.id === made1.id)) && DOC.currentRound(st).id === autumn.id);
  {
    const sw = fresh(), w = DOC.startRound(sw, 'Winter', '2028-01-01'), at = () => sw.rounds.find(r => r.id === w.id);
    DOC.mark(sw, 'rounds', w.id, { archived: true }, '2028-02-15');
    ok('archiving a round with no end date ends it on that day', at().to === '2028-02-15' && at().archived === true);
    DOC.mark(sw, 'rounds', w.id, { archived: false });
    ok('…and un-archiving it takes that end back, so it is open again', !('to' in at()) && !('archived' in at()));
    DOC.startRound(sw, 'Next', '2028-06-01');
    DOC.mark(sw, 'rounds', w.id, { archived: true }, '2028-09-09'); DOC.mark(sw, 'rounds', w.id, { archived: false });
    ok('a round that ended when the next began keeps that end, archived or not', at().to === '2028-06-01');
  }
  ok('rounds and the archive are not printed: every saved resume renders byte for byte the same', eq(printed(st.record, resumes.map(r => st.resumes.find(x => x.id === r.id)).filter(Boolean)), printed(base, resumes)));

  // groups: formats of one resume, the same company and role in another language, a letter, the resume a file was exported from
  const g = fresh();
  const a = doc('a', { meta: { company: 'Northgate', role: 'Designer', date: '2026-01-05', lang: 'en', jobType: '', kind: 'resume' } }).add(g, { addedAt: '2026-10-26T09:00:00.000Z' });
  const b = doc('b').add(g, { of: a.id, addedAt: '2026-10-26T09:01:00.000Z', text: enLines.join('\n') });
  const hu = doc('hu').add(g, { text: 'Egy más nyelvű önéletrajz\nnincs benne semmi közös', meta: { company: 'Northgate', role: 'Designer', date: '2026-01-05', lang: 'hu', jobType: '', kind: 'resume' }, addedAt: '2026-10-26T09:02:00.000Z' });
  const letter = doc('letter').add(g, { text: 'Dear hiring team,', with: a.id, meta: { company: 'Northgate', role: 'Designer', date: '2026-01-05', lang: 'en', jobType: '', kind: 'cover-letter' }, addedAt: '2026-10-26T09:03:00.000Z' });
  const lone = doc('lone').add(g, { text: 'Something else entirely\nthat no resume prints', meta: { company: 'Other', role: 'Welder', date: '2025-01-05', lang: 'en', jobType: '', kind: 'resume' }, addedAt: '2026-10-26T09:04:00.000Z' });
  const gs = RS.docGroups(g);
  const mine = gs.find(x => x.id === a.id);
  ok('another format, the same company and role in another language, and a letter dropped with the file are one group; an unrelated file is its own', gs.length === 2 && J(mine.members.map(m => m.id)) === J([a.id, b.id, hu.id, letter.id].sort((x, y) => g.documents.findIndex(d => d.id === x) - g.documents.findIndex(d => d.id === y))) && mine.lead.id === a.id && gs.find(x => x.id === lone.id).members.length === 1);
  ok('a group whose file holds the lines a saved resume prints sits with that resume; one that holds none sits with none', mine.resume !== null && RS.savedOf(g, mine.resume) && lines(RS.savedOf(g, mine.resume)).every(l => normText(enLines.join('\n')).includes(normText(l))) && gs.find(x => x.id === lone.id).resume === null);
  const few = fresh(); few.resumes = [en]; few.frozen = {};
  const cut = k => enLines.slice(0, enLines.length - k).join('\n');
  const k1 = Math.floor(enLines.length * 0.1), k2 = Math.ceil(enLines.length * 0.2);
  ok('90% of a resume’s lines in the document is enough, 80% is not, and a few lines prove nothing', RS.exportedFrom(few, cut(k1))?.id === en.id && RS.exportedFrom(few, cut(k2)) === null && RS.exportedFrom(few, enLines.slice(0, 2).join('\n')) === null);
  const lett = fresh(); doc('l2').add(lett, { text: 'Dear team', meta: { company: 'Z', role: 'Q', date: '', lang: 'en', jobType: '', kind: 'cover-letter' }, resume: resumes[3].id });
  ok('a letter with no file of its own joins the saved resume it went out with', RS.docGroups(lett)[0].resume === resumes[3].id);

  // removing: a mark in the record, the copies that pointed at it are re-pointed, a merge does not bring it back
  const rm = fresh();
  const r1 = doc('r1').add(rm, { addedAt: '2026-10-26T09:00:00.000Z' }), r2 = doc('r2').add(rm, { of: r1.id, addedAt: '2026-10-26T09:01:00.000Z' }), r3 = doc('r3').add(rm, { of: r1.id, addedAt: '2026-10-26T09:02:00.000Z' });
  const lt = doc('r4').add(rm, { text: 'Dear', with: r1.id, meta: { kind: 'cover-letter' }, addedAt: '2026-10-26T09:03:00.000Z' });
  DOC.removeDocuments(rm, [r1.id]);
  ok('removing the first copy leaves a mark in the record, and the next copy becomes the original the others point to', rm.record.removed?.[`document:${r1.id}`]?.hash && !rm.documents.some(d => d.id === r1.id) && !('of' in rm.documents.find(d => d.id === r2.id)) && rm.documents.find(d => d.id === r3.id).of === r2.id && !('with' in rm.documents.find(d => d.id === lt.id)));
  ok('the mark does not hold the original’s bytes', !JSON.stringify(rm.record.removed ?? {}).includes('base64'));
  DOC.removeDocuments(rm, [r2.id, r3.id, lt.id]);
  ok('removing the last ones leaves no list', rm.documents === undefined);
  {
    let id = 0, wall = Date.parse('2026-11-01T09:00:00.000Z');
    const device = () => { const store = createStore(fresh()); return { store, persist: createPersist({ store, backend: memoryBackend(), now: () => new Date(wall), setTimer: () => ++id, clearTimer: () => {} }) }; };
    const A = device(), B = device();
    A.store.commit(d => { doc('m1').add(d); }, 'A adds'); wall += 60_000;
    const withDoc = await A.persist.forMerge();
    const taken = M.merge(await B.persist.forMerge(), withDoc);      // B opens A’s file the way the app does: merge, commit, and adopt the clock
    B.store.commit(d => { Object.assign(d, structuredClone(taken.state)); }, 'B takes it'); await B.persist.adoptClock(taken.clock);
    wall += 60_000;
    const sb = await B.persist.forMerge(); wall += 60_000;
    const gone = doc('m1').f;
    A.store.commit(d => { DOC.removeDocuments(d, [DOC.docId(gone.sha256)]); }, 'A removes it'); wall += 60_000;
    const sa = await A.persist.forMerge();
    const ab = M.merge(sa, sb), ba = M.merge(sb, sa);
    ok('a copy that still has a removed document does not bring it back, in either order, and both orders agree', !(ab.state.documents ?? []).length && !(ba.state.documents ?? []).length && J(ab.state) === J(ba.state) && ab.state.record.removed?.[`document:${DOC.docId(gone.sha256)}`]);
  }

  // Every path that drops bytes or documents: a copy may go only when its original is safe (in a saved file that was checked); the copies are true copies; one copy with bytes stays
  const dp = fresh();
  const c1 = doc('c1').add(dp, { addedAt: '2026-10-26T09:00:00.000Z' }), c2 = doc('c2').add(dp, { of: c1.id, addedAt: '2026-10-26T09:01:00.000Z' }), c3 = doc('c3').add(dp, { of: c1.id, addedAt: '2026-10-26T09:02:00.000Z' });
  const ids3 = [c1.id, c2.id, c3.id], safe = ids => ({ checked: { at: '2026-10-26T10:00:00.000Z', ids } }), all3 = safe(ids3);
  ok('a dry run says what would go and removes nothing; with nothing ticked the first copy stays', J(RS.dropDuplicates(dp, ids3, [], all3, true)) === J([c2.id, c3.id]) && dp.documents.length === 3);
  ok('a copy whose original is not in a checked saved file is not removed, ticked or not', J(RS.dropDuplicates(dp, ids3, [c1.id], {}, true)) === J([]) && J(RS.dropDuplicates(dp, ids3, [c1.id], safe([c2.id]), true)) === J([c2.id]));
  ok('a ticked copy that is not one of the copies never lets all of them go', J(RS.dropDuplicates(dp, ids3, ['doc-not-one-of-them'], all3, true)) === J([c2.id, c3.id]) && J(RS.dropDuplicates(dp, ids3, ['doc-not-one-of-them', 'other'], all3, true)).indexOf(c1.id) < 0);
  const to = fresh(), o1 = doc('o1').add(to, { addedAt: '2026-10-26T09:00:00.000Z' }), o2 = doc('o2').add(to, { of: o1.id, addedAt: '2026-10-26T09:01:00.000Z' });
  DOC.keepTextOnly(to, o1.id); DOC.keepTextOnly(to, o2.id);
  ok('with copies that hold no bytes, a ticked id that is not one of them still never lets all of them go', J(RS.dropDuplicates(to, [o1.id, o2.id], ['elsewhere'], {}, true)) === J([o2.id]));
  const tx = fresh(), t1 = doc('t1').add(tx, { addedAt: '2026-10-26T09:00:00.000Z' }), t2 = doc('t2').add(tx, { of: t1.id, addedAt: '2026-10-26T09:01:00.000Z' }), t3 = doc('t3').add(tx, { of: t1.id, addedAt: '2026-10-26T09:02:00.000Z' });
  DOC.keepTextOnly(tx, t1.id);
  ok('when the copies ticked to stay hold no bytes, the first copy that does is kept too', J(RS.dropDuplicates(tx, [t1.id, t2.id, t3.id], [t1.id], safe([t2.id, t3.id]), true)) === J([t3.id]));
  const used = fresh(); const dd = doc('c4').add(used); const dd2 = doc('c5').add(used, { of: dd.id });
  const pv = used.resumes.flatMap(r => usedVersions(used.record, r))[0];
  used.record.variants.find(v => v.id === pv.variant).origin = { doc: dd2.sha256.slice(0, 12) };
  DOC.keepTextOnly(used, dd2.id); const noBytes = RS.dropGuard(used, [dd2.id], safe([dd2.id]));
  ok('a copy a version a saved resume prints links back to is not removed until it is safe, even with no bytes of its own', J(RS.dropGuard(used, [dd2.id], {})) === J([dd2.id]) && noBytes.length === 1);
  // a link from a job title, the header or an item of another section guards the copy as well
  const kinds = ['title', 'item', 'header'].map(kind => { const u2 = fresh(), x = doc(`u-${kind}`).add(u2), r = u2.resumes[0], f = printedFactIds(u2.record, r).find(p => p.kind === kind);
    if (!f) return null;
    const v = chooseVariant(u2.record, f.fact, r).v; u2.record.variants.find(y => y.id === v.id).origin = { doc: x.sha256.slice(0, 12) };
    DOC.keepTextOnly(u2, x.id); return [kind, RS.dropGuard(u2, [x.id], safe([x.id])).length === 1 && RS.dropGuard({ ...u2, resumes: [] }, [x.id], {}).length === 0]; });
  ok('a copy linked from a printed job title, the header or an item of another section is guarded too, and not when no saved resume prints that version', kinds.filter(Boolean).length >= 2 && kinds.filter(Boolean).every(k => k[1]), J(kinds));
  ok('a copy in the receipt on the screen is not removed until it is safe either', J(RS.dropGuard(dp, [c2.id], { protect: [c2.id] })) === J([c2.id]) && RS.dropGuard(dp, [c2.id], { protect: [c2.id], ...safe([c2.id]) }).length === 0);
  const gone3 = RS.dropDuplicates(dp, ids3, [c1.id, c3.id], all3);
  ok('the ticked copies stay, the others go with a mark, and the one that was only a copy of a copy is re-pointed', J(gone3) === J([c2.id]) && dp.documents.length === 2 && dp.record.removed?.[`document:${c2.id}`] && dp.documents.find(d => d.id === c3.id).of === c1.id);
  const rg = fresh(), g1 = doc('g1').add(rg), g2 = doc('g2').add(rg);
  let thrown = null; try { RS.removeGuarded(rg, [g1.id], {}); } catch (e) { thrown = e.key; }
  ok('Remove from Library and Remove these… refuse an original that is not safe, with the one line saying to save first, and remove nothing', thrown === 'i7.saveFirst' && rg.documents.length === 2 && !rg.record.removed);
  RS.removeGuarded(rg, [g1.id], safe([g1.id]));
  ok('and remove it once it is safe', rg.documents.length === 1 && rg.record.removed?.[`document:${g1.id}`]);
  let thrown2 = null; try { RS.keepTextGuarded(rg, g2.id, {}); } catch (e) { thrown2 = e.key; }
  ok('Keep text only is refused the same way, and works once safe', thrown2 === 'i7.saveFirst' && rg.documents[0].embedded && (RS.keepTextGuarded(rg, g2.id, safe([g2.id])), !rg.documents[0].embedded));
  const so = fresh(), s1 = doc('so').add(so); DOC.keepTextOnly(so, s1.id);
  ok('a document with no original to lose is not held back', RS.dropGuard(so, [s1.id], {}).length === 0);
  // true copies only
  const cp = fresh(), CO = { company: 'Northgate', role: 'Designer', date: '', jobType: '', kind: 'resume' };
  const z1 = doc('z1').add(cp, { meta: { ...CO, lang: 'en' }, addedAt: '2026-10-26T09:00:00.000Z' }), z2 = doc('z2').add(cp, { of: z1.id, meta: { ...CO, lang: 'en' }, addedAt: '2026-10-26T09:01:00.000Z' });
  const z3 = doc('z3').add(cp, { meta: { ...CO, lang: 'hu' }, addedAt: '2026-10-26T09:02:00.000Z' }), z4 = doc('z4').add(cp, { meta: { ...CO, lang: 'en' }, addedAt: '2026-10-26T09:03:00.000Z' });
  const z5 = doc('z5').add(cp, { of: z1.id, meta: { ...CO, lang: 'hu' }, addedAt: '2026-10-26T09:04:00.000Z' }), z6 = doc('z6').add(cp, { text: 'Dear', meta: { ...CO, lang: 'en', kind: 'cover-letter' }, addedAt: '2026-10-26T09:05:00.000Z' });
  ok('the copies of a document are its formats in its own language: not another language, not another resume of the same company and role, not a letter', J(RS.copiesOf(cp, z2.id)) === J([z1.id, z2.id]) && J(RS.copiesOf(cp, z1.id)) === J([z1.id, z2.id]) && J(RS.copiesOf(cp, z3.id)) === J([z3.id]) && J(RS.copiesOf(cp, z4.id)) === J([z4.id]) && RS.docGroups(cp).some(g => g.members.length > 4));
  const ZL = doc('zl').add(cp, { of: z1.id, meta: { ...CO, lang: '' }, addedAt: '2026-10-26T09:06:00.000Z' });
  ok('a copy with no language is in its original’s, and the copies are those of the language of the one opened', J(RS.copiesOf(cp, ZL.id)) === J([z1.id, z2.id, ZL.id]) && J(RS.copiesOf(cp, z2.id)) === J([z1.id, z2.id, ZL.id]) && J(RS.copiesOf(cp, z5.id)) === J([z5.id]));
  const hu0 = fresh(), h1 = doc('h1').add(hu0, { meta: { ...CO, lang: 'hu' }, addedAt: '2026-10-26T09:00:00.000Z' }), h2 = doc('h2').add(hu0, { of: h1.id, meta: { ...CO, lang: '' }, addedAt: '2026-10-26T09:01:00.000Z' }), h3 = doc('h3').add(hu0, { of: h1.id, meta: { ...CO, lang: 'en' }, addedAt: '2026-10-26T09:02:00.000Z' });
  ok('opened from a copy with no language, the copies are those of the original’s language, not of every language', J(RS.copiesOf(hu0, h2.id)) === J([h1.id, h2.id]) && J(RS.copiesOf(hu0, h3.id)) === J([h3.id]));
  // Remove these… takes the files that are in the round, not the rest of their group
  const rr = fresh(), q1 = doc('q1').add(rr, { round: 'r-old' }), q2 = doc('q2').add(rr, { of: q1.id, round: 'r-new' });
  rr.resumes[0].round = 'r-old';
  ok('what Remove these… lists for a round is its resumes and the documents in that round themselves', J(DOC.roundItems(rr, 'r-old').documents) === J([q1.id]) && J(DOC.roundItems(rr, 'r-old').resumes) === J([rr.resumes[0].id]) && J(DOC.roundItems(rr, 'r-new').documents) === J([q2.id]));

  // the claims a letter leans on
  const claim = base.variants.find(v => v.text.split(/\s+/).length >= 8);
  const says = X.mentions(base, `Dear team,\n\nIn my last role ${claim.text.replace(/\.$/, '').toLowerCase()}, which is why I am writing.\nA sentence that no claim of the career is anything like at all, about gardening in spring.`);
  ok('a sentence close to a version names its claim, once; a sentence like none names nothing', says.length === 1 && says[0].text === claim.text);

  // rounds: the same name on one day is one round; two on one day, the later started is current whatever their ids
  const sd = fresh(), a1 = DOC.startRound(sd, 'Spring', '2027-03-01'), a2 = DOC.startRound(sd, 'Spring', '2027-03-01');
  ok('the same name on the same day is the round that is there: it does not close itself', a1 === a2 && sd.rounds.length === 1 && !('to' in sd.rounds[0]));
  const orders = [['Alpha', 'Beta'], ['Beta', 'Alpha'], ['Zed', 'Ant'], ['Ant', 'Zed']].map(([x, y]) => { const t = fresh(); DOC.startRound(t, x, '2027-05-05'); const later = DOC.startRound(t, y, '2027-05-05'); return DOC.currentRound(t).id === later.id; });
  ok('two rounds started on one day: the one started later is current, in either order of names', orders.every(Boolean), J(orders));

  // restoring a sent copy keeps the round and the archive mark of the resume
  const rs = fresh(); rs.cur = newResume(rs.record, { format: 'a4' }); DOC.startRound(rs, 'Autumn', '2027-09-01'); const made0 = RS.saveNew(rs, { name: 'Sent one' });
  RS.takeSnapshot(rs, { company: 'Acme', role: 'Tester' }); DOC.mark(rs, 'resumes', made0.id, { archived: true });
  RS.restoreSnapshot(rs, RS.snapshotsOf(RS.savedOf(rs, made0.id))[0].id);
  ok('restoring a sent copy keeps the open resume’s round and archive mark', RS.savedOf(rs, made0.id).round === rs.rounds[0].id && RS.savedOf(rs, made0.id).archived === true);

  // the picture of a document is not an edit (not in the merge hash), and the folder’s text-only copy drops it and reading the folder back keeps this one’s
  const pic = `${['data:image', '/png;base64,'].join('')}${'A'.repeat(2000)}`, th = fresh(), tdoc = addFile(th, pdf, { thumb: pic });
  const h0 = M.tick(null, th, 'a').keys[`document:${tdoc.id}`].hash, th2 = clone(th); delete th2.documents[0].thumb;
  ok('a document with its picture and one without hash alike, so making the picture on one device is no edit', tdoc.thumb === pic && M.tick(null, th2, 'a').keys[`document:${tdoc.id}`].hash === h0);
  const fo = filesOf(th), lib = JSON.parse(fo.get('library.json')), bare = !('thumb' in lib.documents[0]) && !('embedded' in lib.documents[0]), back = keepOriginals({ documents: lib.documents }, th);
  ok('the folder’s library.json holds neither the original nor the picture; reading it back keeps this state’s picture', bare && back.documents[0].thumb === pic && back.documents[0].embedded === th.documents[0].embedded);

  // rebuild never picks a version still tagged archive
  const ra = fresh(), raDoc = doc('ra').add(ra, { text: enLines.join('\n') });
  const bul = ra.record.variants.find(v => enLines.includes(v.text) && v.id !== 'summary');
  bul.tags = [...(bul.tags ?? []), 'archive'];
  const raRes = RS.rebuildFrom(raDoc, ra), raMade = ra.resumes.find(r => r.id === raRes.id);
  ok('a version still tagged archive is never picked: its line is left out or the resume’s own text, never that version', !Object.values(raMade.picks).includes(bul.id) && raRes.picked < enLines.length);

  // rebuild: an exact version is picked, a close wording is this resume's own, the rest is counted; the career is not touched
  const rb = fresh(), allVersions = base.variants.length, record0 = J(rb.record);
  const d1 = doc('rb').add(rb, { text: enLines.join('\n'), meta: { company: 'Northgate', role: 'Designer', date: '', lang: 'en', jobType: '', kind: 'resume' } });
  const n0 = rb.resumes.length, res = RS.rebuildFrom(d1, rb);
  const rmade = rb.resumes.find(r => r.id === res.id), got = lines(rmade).map(normText);
  ok('every line of the document is an exact version of the career: all are picked, none is the resume’s own, none is left out', res.picked === enLines.length && res.own === 0 && res.left === 0 && rb.resumes.length === n0 + 1 && rb.openId === res.id && rmade.company === 'Northgate');
  ok('the new resume prints those same lines', enLines.every(l => got.includes(normText(l))), J(got.slice(0, 2)));
  ok('the career and the other saved resumes are as they were', J(rb.record) === record0 && J(rb.record.variants).length > 0 && rb.record.variants.length === allVersions && eq(printed(rb.record, resumes), printedBefore));
  const edited = enLines.slice(), at = edited.findIndex(l => l.split(' ').length > 8);
  edited[at] = edited[at].replace(/\b(\w{4,})\b/, 'sturdy $1');
  const rb2 = fresh(), d2 = doc('rb2').add(rb2, { text: [...edited, 'A line that is like none of the career’s claims at all, about gardening'].join('\n') });
  const rres2 = RS.rebuildFrom(d2, rb2), rmade2 = rb2.resumes.find(r => r.id === rres2.id);
  ok('a wording close to a claim’s is the resume’s own text for it (the version is not changed), and a line like none is left out and counted', rres2.own === 1 && rres2.picked === enLines.length - 1 && rres2.left === 1 && Object.values(rmade2.overrides).includes(edited[at]) && J(rb2.record) === record0);
  ok('the resume’s own text is kept as a one-off, not offered as a pending edit', Object.keys(rmade2.overrides).every(f => rmade2.overrideMeta[f].kept === true));
  const hu2 = resumes.find(r => r.lang === 'hu'), huLines = lines(hu2);
  const rb3 = fresh(), res3 = RS.rebuildFrom(doc('rb3').add(rb3, { text: huLines.join('\n') }), rb3);
  ok('a document in another language gives a resume in that language', rb3.resumes.find(r => r.id === res3.id).lang === 'hu' && res3.picked === huLines.length, `${res3.picked}/${huLines.length}`);

  // placing the lines a document left: the same menu as at import, stamped, and the document follows
  const pl = fresh(), pd = doc('pl').add(pl, { taken: { claims: [], versions: [], skipped: [], unplaced: 2, lines: ['Taught the new hires to read a drawing in one afternoon', 'Some line that is not a resume line'] } });
  const job0 = pl.record.work[0].id, v0 = pl.record.variants.length;
  X.placeLines(pl, pd.id, [{ text: 'Taught the new hires to read a drawing in one afternoon', choice: `job:${job0}` }, { text: 'Some line that is not a resume line', choice: 'skip' }], { at: '2026-11-02T10:00:00.000Z' });
  const nd = pl.documents.find(d => d.id === pd.id), nv = pl.record.variants.slice(v0);
  ok('a line put under a job is a new claim with one version, stamped with the document, tagged imported, and the document says nothing is left unplaced', nv.length === 1 && nv[0].source === 'Imported from pl.pdf, 2026-11-02' && nv[0].tags.includes('imported') && nv[0].origin.doc === pd.sha256.slice(0, 12) && nd.taken.unplaced === 0 && !('lines' in nd.taken) && nd.taken.versions.includes(nv[0].id) && nd.taken.skipped.length === 1);
  const pl2 = fresh(), pd2 = doc('pl2').add(pl2, { taken: { claims: [], versions: [], skipped: [], unplaced: 2, lines: ['one', 'two'] } });
  X.placeLines(pl2, pd2.id, [{ text: 'one', choice: '' }], {});
  ok('a line left alone stays unplaced and nothing is added', pl2.documents[0].taken.lines.length === 2 && pl2.record.variants.length === base.variants.length);
}

console.log(failed ? `\n${failed} documents check(s) FAILED` : '\nall documents checks passed');
process.exit(failed ? 1 : 0);
