#!/usr/bin/env node
// node checks/hardening-check.mjs
// What keeps a hostile or damaged file from doing harm once it is opened (docs/DEVELOPMENT.md, "Hardening"): a link in a resume only goes to
// http, https, mailto or tel, with its quotes escaped; the key "__proto__" in an opened file is dropped by readImport, readBackup and the merge;
// a browser whose storage is full says so plainly and loses nothing. (Imported text written as text, never HTML, is the smoke test's `import` section.)
// Fictional data only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineOf, safeHref } from '../src/render.js';
import { readImport } from '../src/model/import.js';
import { merge, baseline, tick } from '../src/model/merge.js';
import { load } from '../src/model/schema.js';
import { createStore } from '../src/store/store.js';
import { createPersist, memoryBackend, memoryFolder, readBackup, readFolder, makeBackup, filesOf } from '../src/store/persist.js';
import { openFromInput } from '../src/data.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);

section('links in a resume');
{
  const html = href => inlineOf({ text: 'Visit the site now', links: [{ start: 10, end: 14, href }] });
  ok('http, https, mailto and tel make a link, in any case', ['http://a.example', 'https://a.example/x?y=1', 'mailto:a@example.org', `tel:${['+351', '000', '000', '000'].join('')}`, 'HTTPS://A.EXAMPLE'].every(h => /<a href="/.test(html(h))));
  const bad = ['javascript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', 'file:///etc/passwd', '//evil.example', '/relative', '', undefined, 7];
  ok('any other address prints as plain text, with no link', bad.every(h => !/<a\b/.test(html(h)) && html(h).includes('Visit the site now')), bad.filter(h => /<a\b/.test(html(h))).join(' | '));
  const q = html('https://a.example/?q="><img src=x onerror=alert(1)>');
  ok('quotes and brackets in an address cannot end the attribute', !/<img/.test(q) && !/href="[^"]*"[^>]*onerror/.test(q) && /<a href="https:\/\/a\.example\/\?q=&#34;&#62;&#60;img/.test(q), q);
  ok('safeHref is null for what is not an address', safeHref('javascript:1') === null && safeHref(null) === null && safeHref('https://a.example') === 'https://a.example');
}

section('the key __proto__ in an opened file');
{
  const owns = (x, seen = new Set()) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return false;
    seen.add(x);
    return Object.hasOwn(x, '__proto__') || Object.values(x).some(v => owns(v, seen));
  };
  const poison = o => JSON.parse(JSON.stringify(o).replace(/^\{/, '{"__proto__":{"polluted":"yes"},'));      // an own key at the top; the inner ones are added below
  const deep = o => { for (const k of ['record', 'basics']) if (o?.[k]) o[k] = JSON.parse(JSON.stringify(o[k]).replace(/^\{/, '{"__proto__":{"polluted":"yes"},')); return o; };
  const example = read('data/example.json');
  const clean = x => !owns(x) && ({}).polluted === undefined && !('polluted' in (x?.record ?? x ?? {}));

  const text = JSON.stringify(poison(example));
  ok('the fixture really holds the key (JSON.parse makes it an own key)', owns(JSON.parse(text)));
  const got = readImport(text, 'x.json');
  ok('readImport drops it: not in what it read, not in what it built', got.kind === 'library' && !owns(got.json) && !owns(got.model));

  const { model } = load(example);
  const doc = { id: 'doc-aaaaaaaaaaaa', name: 'cv.pdf', type: 'application/pdf', size: 1, sha256: 'a'.repeat(64), addedAt: '2026-01-01T00:00:00.000Z', meta: {}, text: '', taken: {} };
  const state = { record: model, resumes: [], frozen: {}, documents: [doc] };
  // the key where a file's own data is kept as it came: a document's details, and a setting of the record
  const backup = JSON.parse(JSON.stringify(makeBackup(state)));
  backup.documents[0] = JSON.parse(JSON.stringify(doc).replace(/^\{/, '{"__proto__":{"polluted":"yes"},').replace('"meta":{}', '"meta":{"__proto__":{"polluted":"yes"}}'));
  backup.record = poison(backup.record);
  ok('the backup fixture holds the key at three depths', owns(backup));
  const rb = readBackup(backup);
  ok('readBackup drops it, at every depth', !owns(rb.state) && !owns(rb.info) && ({}).polluted === undefined);

  const clean0 = readBackup(JSON.parse(JSON.stringify(makeBackup(state)))).state;
  const theirsState = JSON.parse(JSON.stringify(clean0));
  theirsState.record = JSON.parse(JSON.stringify(theirsState.record).replace(/^\{/, '{"__proto__":{"polluted":"yes"},"zzSetting":{"__proto__":{"polluted":"yes"}},'));
  const theirs = { state: theirsState, clock: tick(baseline(clean0), theirsState, 'dev2', Date.now() + 60000) };      // a later edit of the settings, so the merge takes this copy's
  ok('the other copy for a merge holds the key, and has the later edit', owns(theirs.state));
  const m = merge({ state: clean0, clock: baseline(clean0) }, theirs);
  ok('merge drops it: nothing it returns has the key, and no object gained a prototype from it', !owns(m.state) && ({}).polluted === undefined && Object.getPrototypeOf(m.state.record) === Object.prototype && m.state.record.polluted === undefined);
  ok('and what was not poisoned is read as before', rb.state.record.basics.name === example.basics.name && m.state.record.basics.name === example.basics.name && m.state.documents.length === 1);
  // the same key in the files of a linked folder and in a file opened as a library
  const folder = memoryFolder();
  const files = filesOf({ record: model, resumes: [], frozen: {}, documents: [doc] });
  const bad = text => text.replace(/^\{/, '{"__proto__":{"polluted":"yes"},');
  folder._files.set('resume-data.json', bad(files.get('resume-data.json')));
  folder._files.set('library.json', bad(files.get('library.json')).replace('"meta": {}', '"meta": {"__proto__":{"polluted":"yes"}}'));
  const recipe = JSON.parse(JSON.stringify(read('data/example-resumes/Example Instruments - Design Engineer.json')));
  folder._files.set('recipes/x.json', bad(JSON.stringify(recipe)));
  const fromFolder = await readFolder(folder);
  ok('a linked folder’s files are read without the key: resume-data.json, library.json and a saved resume', !owns(fromFolder.state) && fromFolder.state.resumes.length === 1 && ({}).polluted === undefined, String(owns(fromFolder.state)));
  const lib = await openFromInput({ name: 'x.json', text: async () => bad(JSON.stringify(example)).replace('"basics":{', '"basics":{"zz":{"__proto__":{"polluted":"yes"}},') });
  ok('a file opened as a library (src/data.js) is read without it', !owns(lib.data) && ({}).polluted === undefined);
}

section('the browser’s storage is full');
{
  const { model } = load(read('data/example.json'));
  let full = false;
  const backend = memoryBackend();
  const put = backend.put;
  backend.put = async (k, v) => { if (full && k === 'state/current') throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError', code: 22 }); return put(k, v); };
  const store = createStore({ record: structuredClone(model), resumes: [], frozen: {}, cur: null, openId: null });
  const p = createPersist({ store, backend, debounceMs: 0, setTimer: fn => { fn(); return 1; }, clearTimer: () => {} });
  const seen = [];
  p.onStatus(s => seen.push(s));
  store.commit(d => { d.record.basics.label = 'Saved while there was room'; }, 'one');
  await p.flush();
  ok('with room, the change is saved', p.status.status === 'saved' && (await backend.get('state/current')).state.record.basics.label === 'Saved while there was room');
  full = true;
  store.commit(d => { d.record.basics.label = 'Typed when the storage was full'; }, 'two');
  await p.flush();
  ok('with no room, the status is an error with the code storage-full and a plain message (no browser jargon)', p.status.status === 'error' && p.status.code === 'storage-full' && /storage|room|space/i.test(p.status.error) && !/QuotaExceeded|DOMException/.test(p.status.error), JSON.stringify(p.status));
  ok('nothing is lost: the change is still in the state, and the last good copy in storage is whole', store.state.record.basics.label === 'Typed when the storage was full' && (await backend.get('state/current')).state.record.basics.label === 'Saved while there was room');
  ok('and Undo still works', store.undo() === 'two' && store.state.record.basics.label === 'Saved while there was room');
  full = false;
  store.redo();
  await p.flush();
  ok('once there is room again, the next save goes through and the error is gone', p.status.status === 'saved' && p.status.code === null && (await backend.get('state/current')).state.record.basics.label === 'Typed when the storage was full', JSON.stringify(p.status));
  ok('a failed write for any other reason keeps its own message and is no storage-full', await (async () => {
    full = false;
    backend.put = async () => { throw new Error('disk on fire'); };
    store.commit(d => { d.record.basics.label = 'Three'; }, 'three');
    await p.flush();
    return p.status.status === 'error' && p.status.code === null && p.status.error === 'disk on fire';
  })());
}

process.exit(failed ? 1 : 0);
