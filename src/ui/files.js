// Files: opening any file (picker, drop, paste), the review card, the merge preview, History
// with checkpoints, and Compare with a file. Models: src/model/import.js and src/model/diff.js.
// Resumes as documents (a DOCX, PDF, ODT, Pages, text, HTML or LinkedIn file): Reading (what each file is, the layout view of a PDF), What's new
// (Needs you, what to add, lines with no home), and the receipt (is the original safe to delete). Their model is src/model/intake.js.

import { inDesktop } from './ask.js';
import { withArrows } from './icons.js';
import * as I from '../model/import.js';
import * as D from '../model/diff.js';
import * as RS from '../model/resumes.js';
import * as M from '../model/merge.js';
import * as X from '../model/intake.js';
import * as DOC from '../model/documents.js';
import { pdfPages, pdfThumb } from '../parse/pdf.js';
import { fnv } from '../store/store.js';
import { readBackup, makeBackup, openVerdict, sha256 } from '../store/persist.js';
import { ensureRecordId, dropProto } from '../model/schema.js';
import { newResume } from '../model/resume.js';
import { t, h, errText, uiLang, has, UI_LANGS, loadCatalogue } from '../i18n/index.js';
import { langName } from '../model/lang.js';

let C = null;
export function initFiles(ctx){ C = ctx; return api; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = s => document.querySelector(s);
const st = () => C.store.state;
// drop: the files of one import being read, judged and reviewed ({ entries, plan, done, checked }); see the import door below
const F = { got: null, items: null, merged: null, outside: true, drop: null, checked: null, history: { list: null, sel: null, items: null, compare: null } };
const KIND = k => ({ library: t('files.kindLibrary'), jsonresume: t('files.kindJsonResume'), backup: t('files.kindBackup'), resume: t('files.kindResume'), theme: t('files.kindTheme'), error: t('files.kindError') }[k]);
const stamp = iso => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '—');
const isExample = () => /\(fictional\)/.test(st().record?.meta?.owner ?? '');

function commit(fn, label, done){
  try { const ok = C.store.commit(d => { fn(d); }, label); if (ok && done) C.toast(done); return ok; }
  catch (e){ C.toast(errText(e), 'bad'); return false; }
}
const bodyOf = x => (x.diff ? diffHtml(x.diff) : x.a ? `<del>${esc(x.a)}</del> → <ins>${esc(x.b)}</ins>` : esc(x.b ?? ''));
const diffHtml = runs => runs.map(r => (r.op === '=' ? esc(r.text) : r.op === '-' ? `<del>${esc(r.text)}</del>` : `<ins>${esc(r.text)}</ins>`)).join('');

function importView(){
  return `<h2 class="title">${h('files.importTitle')}</h2>
    <p class="small">${h('i6.intro')}</p>
    <p class="small">${h('i6.best')}</p>
    <div class="btns"><button class="primary" data-act="imp-pick">${h('i6.choose')}</button></div>
    <p class="note">${h('i6.orDrop')}</p>
    <span class="lbl">${h('i6.orPaste')}</span>
    <textarea id="imp-paste" class="paste" rows="6" placeholder='{ "basics": { "name": … } }' aria-label="${esc(t('i6.orPaste'))}"></textarea>
    <div class="btns"><button class="sm" data-act="imp-paste">${h('files.readIt')}</button></div>`;
}

function reviewView(){
  const g = F.got;
  if (!g) return importView();
  if (g.kind === 'error') return `<a class="back" data-act="goto" data-v="import">${withArrows(h('files.backImport'))}</a><h2 class="title">${esc(g.file)}</h2><div class="missbar">${esc(g.message)}</div>`;
  const rows = g.review?.rows ?? [];
  let actions = '', warn = '';
  const v = g.kind === 'backup' ? g.verdict : null;
  if (v && v.kind !== 'ok'){
    const lines = [];
    if (v.kind === 'same') lines.push(t('save.upToDate'));
    if (v.kind === 'changes') lines.push(t('save.localChanges', { n: v.changes }));
    if (v.older) lines.push(t('save.older', { file: stamp(g.info?.saved), last: stamp(C.persist.fileState.last?.at) }));
    if (v.kind === 'different') lines.push(t('save.different'));
    warn = `<div class="missbar ${v.kind === 'same' ? 'ok' : ''}" role="status">${lines.map(esc).join('<br>')}</div>`;
    if (v.kind === 'same') actions = '';
    else if (v.kind === 'different') actions = `<button class="primary" data-act="imp-merge">${h('save.merge')}</button><button class="del" data-act="imp-replace">${h('files.replaceMine')}</button>`;
    else actions = `<button class="primary" data-act="imp-save-first">${h('save.saveFirst')}</button><button data-act="imp-merge">${h('save.merge')}</button><button class="del" data-act="imp-replace">${h('save.replaceAnyway')}</button>`;
  } else if (g.kind === 'library' || g.kind === 'jsonresume' || g.kind === 'backup'){
    actions = isExample()
      ? `<button class="primary" data-act="imp-replace">${h('files.openIt')}</button><button data-act="imp-merge">${h('files.addToExample')}</button>`
      : `<button class="primary" data-act="imp-merge">${h('files.addToMine')}</button><button class="del" data-act="imp-replace">${h('files.replaceMine')}</button>`;      // replacing your record is the far end: the delete look, no bin
  } else if (g.kind === 'resume'){
    const pm = I.picksMatched(st().record, g.recipe);
    actions = `<button class="primary" data-act="imp-resume">${h('files.openIt')}</button>`;
    rows.push([t('files.matches'), pm.total ? t('files.picksOf', { matched: pm.matched, total: pm.total }) : t('files.noPicks')]);
  } else if (g.kind === 'theme'){
    actions = `<button class="primary" data-act="imp-theme">${h('files.addTheme')}</button>`;
  }
  const out = g.outside ?? [];
  return `<a class="back" data-act="goto" data-v="import">${withArrows(h('files.backImport'))}</a><h2 class="title">${esc(KIND(g.kind) ?? g.kind)}</h2>
    <p class="muted small">${esc(g.file)}</p>
    ${warn}
    <table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
    ${checkPicker(g)}${checkLine(g)}
    ${(g.review?.notShown ?? []).length ? `<span class="lbl">${h('files.notShown')}</span><ul class="small">${g.review.notShown.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${out.length ? `<label class="check"><input type="checkbox" id="imp-outside" ${F.outside ? 'checked' : ''}> ${h('files.outside', { n: out.length })}</label>
      <ul class="small">${out.slice(0, 5).map(e => `<li>${esc(e.where)}: “${esc(e.text.slice(0, 60))}${e.text.length > 60 ? '…' : ''}”</li>`).join('')}</ul>` : ''}
    <div class="btns">${actions}</div>
    <p class="note">${g.kind === 'resume' || v?.kind === 'same' ? '' : h('files.eitherWay')}</p>`;
}

// A JSON Resume an assistant made from a document: its words are looked for in that document (the one its meta.source names, or one picked here).
const docsWithText = () => (st().documents ?? []).filter(d => d.text);
const checkDoc = g => (F.checkDoc === undefined ? DOC.sourceOf(st(), g.json) : docsWithText().find(d => d.id === F.checkDoc) ?? null);
const checkPicker = g => (g.kind === 'jsonresume' && docsWithText().length
  ? `<label class="field"><span class="lbl">${h('i6b.checkWith')}</span><select id="imp-doc" aria-label="${esc(t('i6b.checkWith'))}"><option value="">${h('i6b.noOriginal')}</option>${docsWithText().map(d => `<option value="${esc(d.id)}" ${checkDoc(g)?.id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>` : '');
function checkLine(g){
  if (g?.kind !== 'jsonresume') return '';
  const doc = checkDoc(g), n = doc ? DOC.checkWords(g.json, doc.text).filter(r => !r.found).length : 0;
  return `<p class="small" role="status" data-check="${doc ? (n ? 'missing' : 'ok') : 'none'}">${esc(doc ? t(n ? 'i6b.someMissing' : 'i6b.allFound', { doc: doc.name, n }) : t('i6b.notChecked'))}</p>`;
}

function itemsHtml(items, checkable){
  if (!items.length) return `<p class="muted">${h('files.noDiff')}</p>`;
  const G = checkable ? { add: t('merge.willAdd'), change: t('merge.different'), keep: t('merge.onlyYours') } : { add: t('merge.added'), change: t('merge.changed'), keep: t('merge.removed') };
  return ['notin', 'add', 'change', 'keep'].map(k => {
    const its = items.map((x, i) => [x, i]).filter(([x]) => (x.notIn ? 'notin' : x.kind) === k);
    if (!its.length) return '';
    return `<div class="mgroup ${k === 'notin' ? 'change' : k}" ${k === 'notin' ? 'data-notin="1"' : ''}>${esc(k === 'notin' ? t('i6b.notIn', { doc: its[0][0].notIn }) : G[k])} · ${its.length}</div><div class="mlist">${its.map(([x, i]) => {
      const body = bodyOf(x);
      return checkable && k !== 'keep'
        ? `<label class="mi"><input type="checkbox" data-mi="${i}" ${x.on ? 'checked' : ''}><span><span class="mw">${esc(x.what)}</span><span class="mx">${body}</span></span></label>`
        : `<div class="mi ro"><span class="sym ${k}">${k === 'add' ? '+' : k === 'change' ? '~' : '−'}</span><span><span class="mw">${esc(x.what)}</span><span class="mx">${body}</span></span></div>`;
    }).join('')}</div>`;
  }).join('');
}

function mergeView(){
  const items = F.items ?? [];
  const n = items.filter(x => x.on && x.kind !== 'keep').length;
  return `<a class="back" data-act="goto" data-v="review">${withArrows(h('merge.cancel'))}</a><h2 class="title">${h('merge.title', { file: F.got?.file ?? '' })}</h2>
    <p class="small">${h('merge.intro')}</p>
    ${checkLine(F.got)}${itemsHtml(items, true)}
    <div class="btns"><button class="primary" data-act="imp-do-merge" ${n ? '' : 'disabled'}>${h('merge.doN', { n })}</button><button class="del" data-act="imp-replace">${h('merge.replaceInstead')}</button></div>`;
}

// A file with clocks that is one record with this browser merged by itself: what both changed is told here, line by line, each with its Undo.
function mergedView(){
  const m = F.merged;
  if (!m) return importView();
  return `<h2 class="title" data-changes="${m.changed}">${h('i1.title', { n: m.changed })}</h2>
    <p class="small">${m.changed || m.summary.length ? h('i1.intro', { file: m.file }) : h('i1.nothing', { file: m.file })}${m.changed ? ` ${h('i1.cp')}` : ''}</p>
    <div class="mlist">${m.summary.map((x, i) => `<div class="mi ro" data-kind="${x.kind}"><span class="sym change">~</span><span><span class="mw">${esc(x.what)}</span><span class="mx"><ins>${esc(x.kept)}</ins>${x.other !== x.kept ? ` · <del>${esc(x.other)}</del>` : ''}</span>
      ${x.undone ? '' : `<button class="sm" data-act="imp-undo" data-i="${i}">${h('foot.undo')}</button>`}</span></div>`).join('')}</div>
    <div class="btns"><button class="primary" data-act="imp-merged-close">${h('body.close')}</button></div>`;
}

function historyView(){
  const H = F.history;
  if (!H.list){ loadHistory(); return `<h2 class="title">${h('history.title')}</h2><p class="muted">${h('body.loading')}</p>`; }
  let out = `<h2 class="title">${h('history.title')}</h2>
    <p class="small">${h('history.intro', { n: C.store.history.undo })}</p>
    ${inDesktop() ? `<label class="field"><span class="lbl">${h('history.namePrompt')}</span><input id="cp-name" type="text" maxlength="80" autocomplete="off" value="${esc(t('checkpoint.named', { date: new Date().toLocaleString() }))}"></label>` : ''}
    <div class="btns"><button class="sm primary" data-act="cp-new">${h('history.save')}</button><button class="sm" data-act="cp-file">${h('history.compareFile')}</button></div>`;
  if (H.compare) out += `<span class="lbl">${h('history.comparedNow', { file: H.compare.file })}</span><p class="note">${h('history.compareNote')}</p>${itemsHtml(H.compare.items, false)}
    <div class="btns"><button class="sm ghost" data-act="cp-compare-close">${h('body.close')}</button></div>`;
  out += `<span class="lbl">${h('history.checkpoints')}</span><div class="list">${H.list.length ? H.list.map(c => `<button class="item cprow ${H.sel === c.id ? 'is-cur' : ''}" data-act="cp-sel" data-id="${esc(c.id)}"><span class="hk ${esc(c.kind)}">${esc(t(`history.kind.${c.kind}`) === `history.kind.${c.kind}` ? c.kind : t(`history.kind.${c.kind}`))}</span><span class="t"><b>${esc(c.label)}</b><span class="tiny muted">${esc(c.at.slice(0, 16).replace('T', ' '))}</span></span></button>`).join('') : `<p class="muted small">${h('history.none')}</p>`}</div>`;
  if (H.sel && H.items){
    const c = H.list.find(x => x.id === H.sel);
    out += `<span class="lbl">${h('history.changedSince', { label: c?.label ?? '' })}</span>${itemsHtml(H.items, false)}
      <div class="btns"><button class="sm" data-act="cp-restore">${h('history.restore')}</button><button class="sm ghost" data-act="cp-dl">${h('history.download')}</button></div>`;
  }
  return out;
}

async function loadHistory(){
  F.history.list = await C.persist.listCheckpoints().catch(() => []);
  C.renderBody();
}

async function take(text, name, mode = null){
  const got = I.readImport(text, name);
  if (mode === 'compare'){
    if (!got.model && got.kind !== 'backup'){ C.toast(got.kind === 'error' ? got.message : t('toast.onlyCompare'), 'warn'); return; }
    const toRes = got.kind === 'backup' ? readBackup(got.json).state.resumes : [];
    F.history.compare = { file: name, items: D.diffRecords(st().record, got.model, { fromResumes: st().resumes, toResumes: toRes }) };
    C.setView('history');
    return;
  }
  if (got.kind === 'backup'){
    try {
      const rb = readBackup(got.json);
      got.info = rb.info;
      if (!M.clockFits(rb.state, got.info.clock)) got.info.clock = null;      // an object changed under its old clock: the file was edited outside, and goes the old way
      got.hash = await sha256(text);
      const { last, changes } = C.persist.fileState;
      got.verdict = isExample() ? { kind: 'ok' } : openVerdict({ file: { ...got.info, hash: got.hash }, last, localRecordId: st().record?.recordId ?? null, changes, localClock: C.persist.fileState.hasClock && !got.outside?.length });      // a file edited outside has no say in its clocks: it goes the old way
    } catch { got.verdict = { kind: 'ok' }; }
    if (got.verdict.kind === 'merge'){ await autoMerge(got); return; }
  }
  F.got = got;
  F.outside = true;
  F.checkDoc = undefined;
  C.setView('review');
}

async function autoMerge(g){
  const mine = await C.persist.forMerge(g.info.clock);
  const m = M.merge(mine, { state: readBackup(g.json).state, clock: g.info.clock });
  if (m.changed){
    await C.persist.checkpoint(t('checkpoint.beforeMerging', { file: g.file }), 'merge');
    C.ui.sel = C.NONE;
    if (!commit(d => M.keepOpen(d, e => Object.assign(e, structuredClone(m.state))), t('undo.merge', { file: g.file }))) return;      // the toast says why; the clock stays as it was
  }
  await C.persist.adoptClock(m.clock);      // also when nothing changed: the file's stamps are now ones this copy has seen
  F.merged = { file: g.file, changed: m.changed - (m.logged ? 1 : 0), summary: m.summary };      // a new import log is committed but is nothing to tell
  F.got = null;
  C.setView('merged');
}

// Every file comes through here, one or several. A picture, a theme and a JSON file on its own keep their screens; any other kind is read
// (src/model/intake.js), judged, and shown on the Reading screen, then What's new, then the receipt.
export async function openFiles(list, mode = null){
  const one = list.length === 1 ? list[0] : null;
  if (one && /^image\//.test(one.type) && C.onImage){ C.onImage(one); return; }
  if (one && /\.css$/i.test(one.name) && C.onThemeText){ C.onThemeText(await one.text(), one.name); return; }
  if (one && mode === 'check') return checkSaved(one);
  const entries = [];
  for (const f of list){
    const e = { name: f.name, size: f.size, type: f.type, modified: f.lastModified, ...(f.path ? { path: f.path } : {}) };      // path: a file of the linked folder, kept as a reference
    entries.push(e);
    try {
      if (f.size > X.MAX_FILE) throw Object.assign(new Error('too large'), { code: 'big' });
      e.bytes = new Uint8Array(await f.arrayBuffer());
      e.sha256 = await sha256(e.bytes);
      e.read = /\.css$/i.test(f.name) ? { kind: 'json' } : await X.readFile(e.bytes, f.name, { lang: uiLang(), words: X.wordsOf(st().record) });      // among several files a theme is a data file: opened on its own
      // the picture of a PDF's first page, drawn while the person reads the screens and kept with the document (an image the store keeps out of the undo steps); a file it cannot draw has none
      if (e.read.pdf) e.thumbP = pdfThumb(e.read.pdf, 240).catch(() => undefined);
    } catch (err){ e.error = err; e.sha256 ??= f.name; }
    if (one && !e.error && (e.read.kind === 'json' || (/\.json$/i.test(f.name) && e.read.kind === 'txt'))){ await take(new TextDecoder().decode(e.bytes), f.name, mode); return; }
  }
  if (mode === 'compare'){ C.toast(t('toast.onlyCompare'), 'warn'); return; }
  judge(entries);
  F.drop = { entries, plan: null, done: null, open: new Set(), pages: new Map() };
  F.checked = null;      // a check of a saved file is about the import it was made for
  entries.forEach((e, i) => { if (wantsLayout(e)) F.drop.open.add(i); });
  C.setView('reading');
  entries.forEach((e, i) => { if (F.drop.open.has(i)) loadPages(i); });
}

function incomingState(){
  const g = F.got;
  if (g.kind === 'backup'){
    const next = readBackup(g.json).state;
    if (F.outside && g.outside?.length) I.applyOutsideEdits(next.record, g.outside);
    return next;
  }
  const model = structuredClone(g.model);
  if (g.kind === 'library' && F.outside && g.outside?.length) I.applyOutsideEdits(model, g.outside);
  return { record: model, resumes: [], frozen: {}, cur: newResume(model, { format: 'a4' }), openId: null };
}

async function replace(){
  const g = F.got;
  const next = incomingState();
  if (next.openId) RS.openSaved(next, next.openId);
  if (!next.cur){ next.cur = newResume(next.record, { format: 'a4' }); next.openId = null; }
  await C.persist.checkpoint(t('checkpoint.beforeOpening', { file: g.file }), g.kind === 'backup' ? 'restore' : 'import');
  if (g.kind === 'backup') ensureRecordId(next.record);
  C.ui.sel = C.NONE;
  C.store.replace(next, t('undo.open', { name: g.file }));
  // the file just opened is now the last one saved here, so the next save carries on from it
  if (g.kind === 'backup') await C.persist.markFileOpened({ at: g.info?.saved ?? new Date().toISOString(), recordId: next.record.recordId ?? null, hash: g.hash ?? null, clock: g.info?.clock ?? null });
  F.got = null; F.items = null;
  C.setView(null);
  C.toast(t('toast.fileOpen', { file: g.file }));
}

async function act(a, tg){
  const H = F.history;
  if (await importAct(a, tg)) return true;
  switch (a){
    case 'imp-pick': C.pickFile(); return true;
    case 'imp-check': C.pickFile('check'); return true;
    case 'imp-paste': {
      const text = $('#imp-paste')?.value ?? '';
      if (!text.trim()){ C.toast(t('toast.pasteFirst'), 'warn'); return true; }
      if (/^\s*[{[]/.test(text)) await take(text, t('files.pasted'));      // JSON, as before
      else await openFiles([new File([text], t('i6.pastedName'), { type: 'text/plain' })]);      // a text: the text of a scan, a resume copied from a page
      return true;
    }
    case 'imp-replace': await replace(); return true;
    case 'imp-save-first': if (await C.saveToFile()) await replace(); return true;
    case 'imp-merge': {
      const inc = incomingState();
      F.items = D.diffRecords(st().record, inc.record, { fromResumes: st().resumes, toResumes: inc.resumes });
      if (F.got.kind === 'jsonresume') X.checkItems(F.items, F.got.json, checkDoc(F.got), st().record);
      F.incoming = inc;
      C.setView('merge');
      return true;
    }
    case 'imp-do-merge': {
      const its = F.items.filter(x => x.on && x.kind !== 'keep');
      await C.persist.checkpoint(t('checkpoint.beforeMerging', { file: F.got.file }), 'merge');
      const frozen = F.incoming?.frozen ?? null;
      let n = 0;
      commit(d => { n = D.applyItems(d, its, frozen); }, t('undo.merge', { file: F.got.file }));
      C.toast(t('toast.merged', { n }));
      F.got = null; F.items = null;
      C.setView(null);
      return true;
    }
    case 'imp-undo': {
      const x = F.merged?.summary[Number(tg.dataset.i)];
      if (!x || x.undone) return true;
      if (commit(d => M.keepOpen(d, x.undo), t('undo.merge', { file: F.merged.file }))) x.undone = true;
      C.renderBody();
      return true;
    }
    case 'imp-merged-close': F.merged = null; C.setView(null); return true;
    case 'imp-resume': {
      const g = F.got;
      commit(d => {
        const r = { ...g.recipe };
        r.id = RS.uniqueId(d.resumes, r);
        d.resumes = [...(d.resumes ?? []), r];
        if (g.frozen) d.frozen = { ...(d.frozen ?? {}), [r.id]: g.frozen };
        RS.openSaved(d, r.id);
      }, t('undo.open', { name: g.file }), t('toast.isOpen', { name: g.file }));
      F.got = null; C.ui.sel = C.NONE; C.setView(null);
      return true;
    }
    case 'imp-theme': if (C.onTheme) C.onTheme(F.got.json, F.got.file); else C.toast(t('toast.themesInDesign'), 'warn'); return true;
    case 'cp-new': {
      const field = $('#cp-name');
      const l = (field ? field.value : prompt(t('history.namePrompt'), t('checkpoint.named', { date: new Date().toLocaleString() })))?.trim();
      if (!l) return true;
      await C.persist.checkpoint(l);
      H.list = null; C.renderBody(); C.toast(t('toast.checkpointSaved'));
      return true;
    }
    case 'cp-file': C.pickFile('compare'); return true;
    case 'cp-folder': {
      const cmp = await C.persist.compareFolder();
      if (!cmp.disk){ C.toast(cmp.same ? t('save.folderSame') : t('save.folderNone'), 'warn'); return true; }
      H.compare = { file: C.persist.status.linked ?? '', items: D.diffRecords(st().record, cmp.disk.record, { fromResumes: st().resumes, toResumes: [] }) };
      C.setView('history');
      return true;
    }
    case 'cp-compare-close': H.compare = null; C.renderBody(); return true;
    case 'cp-sel': {
      H.sel = H.sel === tg.dataset.id ? null : tg.dataset.id;
      H.items = null;
      if (H.sel){
        const c = await C.persist.loadCheckpoint(H.sel);
        const now = C.store.materialize();
        // the checkpoint is "from", now is "to"
        H.items = c?.state?.record ? D.diffRecords(c.state.record, now.record, { fromResumes: c.state.resumes ?? [], toResumes: now.resumes ?? [] }) : [];
      }
      C.renderBody();
      return true;
    }
    case 'cp-restore': {
      const c = H.list.find(x => x.id === H.sel);
      if (!c) return true;
      await C.persist.restoreCheckpoint(c.id);
      H.list = null; H.sel = null; H.items = null;
      C.ui.sel = C.NONE;
      C.setView(null);
      C.toast(t('toast.restored', { label: c.label }));
      return true;
    }
    case 'cp-dl': {
      const c = await C.persist.loadCheckpoint(H.sel);
      if (c) C.download(JSON.stringify(makeBackup(c.state, { saved: c.at }), null, 2) + '\n', t('file.checkpointName', { date: c.at.slice(0, 10), label: c.label.replace(/[^\p{L}\p{N} _.,()-]+/gu, ' ').slice(0, 40) }));
      return true;
    }
  }
  return false;
}

// ---- documents: Reading, What's new, the receipt ----

const clip = (x, n = 40) => (String(x).length > n ? `${String(x).slice(0, n - 1)}…` : String(x));
export const kb = n => (n < 1024 * 100 ? `${(n / 1024).toFixed(1)} KB` : `${Math.round(n / 1024)} KB`);
const codeText = err => (has(`i6.err.${err?.code}`) ? t(`i6.err.${err.code}`) : t('i6.err.other'));
const isFull = e => e?.name === 'QuotaExceededError' || e?.code === 22;
const wantsLayout = e => ['pdf', 'pages'].includes(e.read?.kind) && e.status === 'resume' && e.read.doubts.some(d => d.kind !== 'letter');
const canLayout = e => ['pdf', 'pages'].includes(e.read?.kind) && ['resume', 'letter'].includes(e.status);

// What each file is, and (for a copy of a document) whether it brings anything: `news` is set by planning it
const freshCareer = () => isExample() || X.isEmpty(st());
function judge(entries){
  X.classify(st(), entries);
  try { X.plan(st(), entries, { fresh: freshCareer() }); } catch { /* made again, and its error shown, on Continue */ }
}
const formatText = e => t(e.news ? 'i6.formatNew' : 'i6.format', { name: e.of.name });
// the language a file is read in, changed from here (reading it again); a file with no page positions to read has none to choose
const langMenu = (e, i) => (e.read?.items?.length && ['resume', 'letter', 'format'].includes(e.status)
  ? `<label class="mx">${h('i6.fileLang')} <select data-flang="${i}" aria-label="${esc(t('i6.fileLang'))}">${UI_LANGS.map(l => `<option value="${l}" ${l === e.read.lang ? 'selected' : ''}>${esc(langName(l))}</option>`).join('')}</select></label>` : '');

async function loadPages(i){
  const D = F.drop, e = D?.entries[i];
  if (!e?.read?.pdf || D.pages.has(i)) return;
  D.pages.set(i, 'loading');
  try { D.pages.set(i, await pdfPages(e.read.pdf)); } catch (err){ D.pages.set(i, { error: err }); }
  C.renderBody();
}

// A page and its layout: the full-width header ends at `headerBottom`, the columns are cut at `split` (the page's own points, y up)
function pageHtml(e, i, pg, n){
  const lay = e.read.layout.find(l => l.page === n) ?? {}, { pw, ph } = pg;
  const pct = (v, of) => `${(100 * v / of).toFixed(2)}%`;
  const boxes = e.read.boxes.filter(b => b.page === n).map(b => `<div class="lvbox" data-section="${esc(b.label)}" style="left:${pct(b.x0, pw)};top:${pct(ph - b.y1, ph)};width:${pct(b.x1 - b.x0, pw)};height:${pct(b.y1 - b.y0, ph)}"><span>${esc(b.label)}</span></div>`).join('');
  const handle = (kind, at, ghost, label) => `<div class="lv${kind}${ghost ? ' ghost' : ''}" id="lv${kind}-${i}-${n}" data-lv="${kind}" data-f="${i}" data-page="${n}" role="slider" tabindex="0" aria-label="${esc(label)}" aria-orientation="${kind === 'h' ? 'vertical' : 'horizontal'}" style="${kind === 'h' ? 'top' : 'left'}:${at}"></div>`;
  return `<div class="lvpage" data-page="${n}" data-pw="${pw}" data-ph="${ph}" data-split="${lay.split ?? ''}" data-header="${lay.headerBottom ?? ''}"><img src="${pg.url}" alt="" draggable="false">${boxes}
    ${handle('h', lay.headerBottom != null ? pct(ph - lay.headerBottom, ph) : '0%', lay.headerBottom == null, t('i6.headerLine', { n }))}${handle('v', lay.split != null ? pct(lay.split, pw) : '50%', lay.split == null, t('i6.splitLine', { n }))}</div>
    <div class="btns"><button class="sm ghost" data-act="lv-one" data-f="${i}" data-page="${n}" ${lay.split == null ? 'disabled' : ''}>${h('i6.oneColumn')}</button></div>`;
}
function layoutHtml(e, i){
  const D = F.drop, pages = D.pages.get(i);
  if (!canLayout(e)) return '';
  if (!D.open.has(i)) return `<a class="lvlink" data-act="lv-open" data-f="${i}" role="button" tabindex="0">${h('i6.adjust')}</a>`;
  const body = pages === 'loading' || pages === undefined ? `<p class="muted small">${h('body.loading')}</p>` : pages.error ? `<p class="small">${esc(codeText(pages.error))}</p>`
    : `<p class="note">${h('i6.layoutHelp')}</p><div class="lvpages">${pages.map((pg, k) => pageHtml(e, i, pg, k + 1)).join('')}</div>`;
  return `<div class="lv" data-layout="${i}"><a class="lvlink" data-act="lv-close" data-f="${i}" role="button" tabindex="0">${h('i6.hideLayout')}</a>${body}</div>`;
}

function rowHtml(e, i){
  const r = e.read ?? {}, name = esc(e.name);
  const doubts = e.status === 'resume' ? r.doubts.filter(d => d.kind !== 'letter') : [];
  const lines = r.lines?.length ?? 0;
  const what = e.status === 'error' ? codeText(e.error) : e.status === 'skip' ? t(r.kind === 'image' ? 'i6.skipImage' : 'i6.skipData') : e.status === 'unread' ? t(r.kind === 'other' || !r.kind ? 'i6.unread' : 'i6.noText')
    : e.status === 'seen' ? t('i6.seen', { date: String(e.seen).slice(0, 10) }) : e.status === 'format' ? formatText(e)
    : e.status === 'letter' ? t('i6.letter') : [t(`i6.type.${r.kind}`), ...(r.pdf ? [t('head.pages', { n: r.pages })] : []), t('i6.lines', { n: lines })].join(', ');
  return `<div class="mi ro" data-file="${i}" data-status="${e.status}" data-kind="${esc(r.kind ?? '')}" data-lines="${lines}" data-read="${fnv(r.text ?? '')}" data-doubts="${doubts.map(d => d.kind).join(' ')}" data-news="${e.news ?? ''}" data-deleted="${esc(e.deleted ?? '')}"><span class="sym ${e.status === 'resume' || e.status === 'letter' ? 'add' : e.status === 'error' ? 'keep' : 'change'}">·</span>
    <span><span class="mw">${name}</span><span class="mx">${esc(what)}</span>
    ${e.deleted ? `<span class="mx doubt">${esc(t('i7.deletedOn', { date: e.deleted }))}</span>` : ''}
    ${e.size > DOC.MAX_EMBED ? `<span class="mx doubt">${esc(t('i2.tooBig', { mb: Math.ceil(e.size / 1e6), max: DOC.MAX_EMBED / 1024 / 1024 }))}</span>` : ''}
    ${doubts.length ? `<span class="mx doubt">${doubts.map(d => esc(t(`i6.d.${d.kind}`, { n: d.n ?? 0, page: d.page ?? 0 }))).join(' ')}</span>` : ''}
    ${langMenu(e, i)}
    ${layoutHtml(e, i)}</span></div>`;
}

function readingView(){
  const D = F.drop;
  if (!D) return importView();
  const go = D.entries.some(e => ['resume', 'letter', 'format', 'unread'].includes(e.status));
  return `<a class="back" data-act="goto" data-v="import">${withArrows(h('files.backImport'))}</a><h2 class="title">${h('i6.readingTitle', { n: D.entries.length })}</h2>
    <p class="small">${h('i6.readingIntro')}</p>
    <div class="mlist">${D.entries.map(rowHtml).join('')}</div>
    <div class="btns">${go ? `<button class="primary" data-act="imp-continue">${h('i6.continue')}</button>` : `<button data-act="imp-done">${h('body.close')}</button>`}</div>`;
}

const years = w => `${String(w.startDate ?? '').slice(0, 4)}–${w.endDate ? String(w.endDate).slice(0, 4) : t('diff.present')}`;
const countOf = p => p.files.reduce((n, f) => n + f.items.filter(x => x.on && x.apply).length + f.needs.filter(x => x.chosen != null).length + f.unplaced.filter(u => u.choice && u.choice !== 'skip').length, 0);

function needsHtml(p){
  const rows = [];
  p.files.forEach((f, fi) => {
    f.items.forEach((x, ii) => {
      if (x.kind !== 'change') return;
      const mine = x.a ? t('i6.keepYours', { v: clip(x.a) }) : t('i6.keepMine'), theirs = x.b ? t('i6.useFiles', { v: clip(x.b) }) : t('i6.useTheirs');
      rows.push(`<div class="mi ro" data-need="${fi}.${ii}" data-chosen="${x.on ? 'use' : 'keep'}"><span class="sym change">~</span><span><span class="mw">${esc(x.what)}</span><span class="mx">${bodyOf(x)}</span>
        <span class="btns"><button class="sm" data-act="imp-need" data-k="${fi}.${ii}" data-pick="keep" aria-pressed="${!x.on}">${esc(mine)}</button><button class="sm" data-act="imp-need" data-k="${fi}.${ii}" data-pick="use" aria-pressed="${x.on}">${esc(theirs)}</button></span></span></div>`);
    });
    f.needs.forEach((n, j) => rows.push(`<div class="mi ro" data-need="${fi}.n${j}" data-chosen="${n.chosen ?? ''}"><span class="sym change">~</span><span><span class="mw">${esc(n.what)} · ${esc(n.entry)}</span><span class="mx">${esc(n.b)}</span>
      <span class="btns">${n.options.map((o, k) => `<button class="sm" data-act="imp-opt" data-k="${fi}.${j}" data-o="${k}" aria-pressed="${n.chosen === k}">${esc(o.text)}</button>`).join('')}</span></span></div>`));
  });
  return rows.length ? `<div class="mgroup change" data-needs="${rows.length}">${h('i6.needsYou')} · ${rows.length}</div><div class="mlist">${rows.join('')}</div>` : '';
}

// The "Put it in…" menu of a line with no home (here, and in the Library's inspector); `attr` names the select for whoever listens to it
export function placeMenu(o, u, attr){
  const opt = (v, label) => `<option value="${esc(v)}" ${u.choice === v ? 'selected' : ''}>${esc(label)}</option>`;
  return `<select ${attr} aria-label="${esc(t('i6.putIn'))}"><option value="">${esc(t('i6.putIn'))}</option>
    ${o.jobs.length ? `<optgroup label="${esc(t('i6.underJob'))}">${o.jobs.map(j => opt(j.value, j.above ? `${j.label} ${t('i6.above')}` : j.label)).join('')}</optgroup>` : ''}
    ${o.claims.length ? `<optgroup label="${esc(t('i6.asWording'))}">${o.claims.map(c => opt(c.value, c.label)).join('')}</optgroup>` : ''}
    ${o.skills.length ? `<optgroup label="${esc(t('i6.inSkills'))}">${o.skills.map(c => opt(c.value, c.label)).join('')}</optgroup>` : ''}
    ${o.sections.length ? `<optgroup label="${esc(t('i6.inSection'))}">${o.sections.map(c => opt(c.value, c.label)).join('')}</optgroup>` : ''}
    ${opt('skip', t('i6.notResume'))}</select>`;
}
function placeHtml(p, fi, f){
  if (!f.unplaced.length) return '';
  return `<div class="mgroup" data-unplaced="${f.unplaced.length}">${h('i6.unplacedTitle', { n: f.unplaced.length })}${p.files.length > 1 ? ` · ${esc(f.entry.name)}` : ''}</div><p class="note">${h('i6.unplacedNote')}</p>
    <div class="mlist">${f.unplaced.map((u, ui) => `<div class="mi ro" data-line="${fi}.${ui}"><span class="sym keep">?</span><span><span class="mx">${esc(u.text)}</span>
        ${placeMenu(X.placeOptions(p, u), u, `data-place="${fi}.${ui}"`)}</span></div>`).join('')}</div>`;
}

function whatsnewView(){
  const D = F.drop, p = D?.plan;
  if (!p) return importView();
  const first = p.start ? `<p class="missbar" role="status" data-start="1">${h('i6.startsFrom', { file: p.start.name })}</p>` : '';
  const files = p.files.map((f, fi) => {
    const groups = new Map();
    f.items.forEach((x, ii) => { if (x.kind !== 'change') (groups.get(x.entry ?? '') ?? groups.set(x.entry ?? '', []).get(x.entry ?? '')).push([x, ii]); });
    const head = f.entry.status === 'letter' ? `<p class="small" data-letter="1">${h('i6.letterNote', { file: f.entry.name })}</p>` : f.entry.status === 'format' ? `<p class="small">${esc(formatText(f.entry))}</p>` : '';
    const body = [...groups].map(([entry, rows]) => {
      const n = as => rows.filter(([x]) => x.as === as).length, other = rows.length - n('line') - n('wording');
      const job = (p.sim.record.work ?? []).find(w => w.name === entry);
      const title = [n('line') && t('i6.nLines', { n: n('line') }), n('wording') && t('i6.nWordings', { n: n('wording') }), other && t('i6.nOther', { n: other })].filter(Boolean).join(', ');
      return `<div class="mgroup add" data-entry="${esc(entry)}">${esc(entry ? `${entry}${job ? `, ${years(job)}` : ''}` : t('i6.aboutYou'))}: ${esc(title)}</div><div class="mlist">${rows.map(([x, ii]) =>
        `<label class="mi"><input type="checkbox" data-pi="${fi}.${ii}" ${x.on ? 'checked' : ''}><span><span class="mw">${esc(x.what)}</span><span class="mx">${bodyOf(x)}</span></span></label>`).join('')}</div>`;
    }).join('');
    return `${head}${body}${placeHtml(p, fi, f)}`;
  }).join('');
  const n = countOf(p);
  return `<a class="back" data-act="imp-back">${withArrows(h('merge.cancel'))}</a><h2 class="title">${h('i6.newTitle')}</h2>
    <p class="small">${h('i6.newIntro')}</p>${first}${needsHtml(p)}${files || `<p class="muted">${h('files.noDiff')}</p>`}
    <div class="btns"><button class="primary" data-act="imp-apply" data-n="${n}">${n ? h('i6.addN', { n }) : h('i6.addNone')}</button></div>`;
}

function receiptView(){
  const D = F.drop;
  if (!D?.done) return importView();
  const docs = D.done.ids.map(id => (st().documents ?? []).find(x => x.id === id)).filter(Boolean);
  const rows = docs.map(doc => {
    const sf = DOC.safety(doc, { lastFileSave: C.persist.fileState.last, checked: F.checked, folderVerified: C.space.verified(doc) });
    return `<div class="mi ro" data-doc="${esc(doc.id)}" data-kind="${esc(doc.meta?.kind ?? '')}" data-safe="${sf.safe}" data-read="${sf.read.state}" data-record="${sf.record.state}" data-kept="${sf.kept.state}"><span class="sym ${sf.safe ? 'add' : 'keep'}">${sf.safe ? '✓' : '·'}</span>
      <span><span class="mw">${esc(doc.name)}${doc.of ? ` · ${esc(t('i6.formatShort'))}` : ''}</span>
      <ul class="small ticks">${[sf.read, sf.record, sf.kept].map(x => `<li data-ok="${x.ok}">${x.ok ? '✓' : '○'} ${esc(x.text)}</li>`).join('')}</ul>
      <span class="mx"><b>${esc(sf.text)}</b>${sf.safe ? `: ${esc(t('i6.safeNamed', { name: doc.name, size: kb(doc.size) }))}` : ''}</span></span></div>`;
  }).join('');
  const can = C.store.history.next === D.done.label;
  return `<h2 class="title">${h('i6.doneTitle', { n: docs.length })}</h2>
    <p class="small">${h('i6.doneIntro')}</p><div class="mlist">${rows}</div>
    <p class="note">${h('i6.checkNote')}</p>
    <div class="btns"><button class="primary" data-act="imp-save">${h('i6.saveFile')}</button><button data-act="imp-check">${h('i6.checkFile')}</button>${can ? `<button class="del" data-act="imp-undo-import">${h('i6.undoImport')}</button>` : ''}<button data-act="imp-done">${h('body.close')}</button></div>`;
}

// the file the person saved after the import, read for the originals it holds (a download alone proves nothing)
async function checkSaved(file){
  let backup;
  try { backup = dropProto(JSON.parse(await file.text())); } catch { backup = null; }
  if (!backup?.resumeBuilderBackup){ C.toast(t('i6.notBackup'), 'warn'); return; }
  const ids = DOC.inFile(st(), backup);
  F.checked = { at: new Date().toISOString(), ids };      // kept for the session: the Library’s inspector shows it too
  C.toast(t('i6.checked', { n: ids.length }));
  C.renderBody();
}

function reread(i){
  const D = F.drop, e = D.entries[i];
  e.read = { ...e.read, ...X.readIn(e.read.items, e.read.lang, e.layout) };
  judge(D.entries);
  C.renderBody();
}
// `patch` for one page of a PDF: the layout is the one used so far, with this page's header line or split given
function setLayout(i, page, patch){
  const e = F.drop.entries[i], tidy = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
  e.layout = e.read.layout.map(l => (l.page === page ? tidy({ ...l, ...patch }) : l));
  reread(i);
}

async function importAct(a, tg){
  const D = F.drop;
  if (!D) return false;
  switch (a){
    case 'imp-continue': {
      try { D.plan = X.plan(st(), D.entries, { fresh: freshCareer() }); }
      catch (e){ C.toast(errText(e), 'bad'); return true; }
      C.setView('whatsnew');
      return true;
    }
    case 'imp-back': D.plan = null; C.setView('reading'); return true;
    case 'imp-need': {
      const [fi, ii] = tg.dataset.k.split('.').map(Number);
      D.plan.files[fi].items[ii].on = tg.dataset.pick === 'use';
      C.renderBody();
      return true;
    }
    case 'imp-opt': {
      const [fi, j] = tg.dataset.k.split('.').map(Number), n = D.plan.files[fi].needs[j], o = Number(tg.dataset.o);
      n.chosen = n.chosen === o ? null : o;
      C.renderBody();
      return true;
    }
    case 'imp-apply': {
      if (D.applying) return true;      // a second click while the first is at work would make the import twice
      D.applying = true; tg.disabled = true;
      const label = t('i6.undoLabel'), at = new Date().toISOString();
      try {
        try { await C.persist.checkpoint(t('i6.checkpoint'), 'import'); }
        catch (e){ C.toast(isFull(e) ? t('i6.storageFull') : errText(e), 'bad'); return true; }      // nothing was applied
        C.ui.sel = C.NONE;
        await C.space?.file(D.entries);      // an Inbox file is filed into Library/ before its document is made, so the document has its final path
        await Promise.all(D.entries.map(async e => { if (e.thumbP) e.thumb = await e.thumbP; }));
        let made = [];
        if (!commit(d => { made = X.applyPlan(d, D.plan, { at }); }, label)) return true;
        D.done = { at, label, ids: made.map(x => x.id) };
        C.setView('receipt');
      } finally { D.applying = false; tg.disabled = false; }
      return true;
    }
    case 'imp-save': if (await C.saveToFile()) C.renderBody(); return true;
    case 'imp-undo-import':
      if (C.store.history.next === D.done.label){ C.ui.sel = C.NONE; C.store.undo(); }
      F.drop = null; C.setView(null);
      return true;
    case 'imp-done': F.drop = null; C.setView(null); return true;
    case 'lv-open': D.open.add(Number(tg.dataset.f)); loadPages(Number(tg.dataset.f)); C.renderBody(); return true;
    case 'lv-close': D.open.delete(Number(tg.dataset.f)); C.renderBody(); return true;
    case 'lv-one': setLayout(Number(tg.dataset.f), Number(tg.dataset.page), { split: null }); return true;
  }
  return false;
}

// Dragging a line over a page (or the arrow keys on it) reads the page again: the header line moves down or up, the split line left or right.
function bindLayout(body){
  const apply = (hd, fx, fy) => {
    const pg = hd.closest('.lvpage'), pw = Number(pg.dataset.pw), ph = Number(pg.dataset.ph);
    setLayout(Number(hd.dataset.f), Number(hd.dataset.page), hd.dataset.lv === 'h' ? { headerBottom: Math.round(ph * (1 - fy)) } : { split: Math.round(pw * fx) });
  };
  body.addEventListener('pointerdown', e => {
    const hd = e.target.closest?.('[data-lv]');
    if (!hd || e.button) return;
    e.preventDefault();
    const r = hd.closest('.lvpage').getBoundingClientRect(), at = ev => [Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))];
    let last = null;
    const move = ev => { last = at(ev); hd.classList.remove('ghost'); if (hd.dataset.lv === 'h') hd.style.top = `${last[1] * 100}%`; else hd.style.left = `${last[0] * 100}%`; };
    const up = () => { removeEventListener('pointermove', move); if (last) apply(hd, ...last); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up, { once: true });
    addEventListener('pointercancel', up, { once: true });
  });
  body.addEventListener('keydown', e => {
    const hd = e.target.closest?.('[data-lv]'), step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!hd || !step) return;
    e.preventDefault();
    const pg = hd.closest('.lvpage'), pw = Number(pg.dataset.pw), ph = Number(pg.dataset.ph);
    const x = pg.dataset.split !== '' ? Number(pg.dataset.split) : pw / 2, y = pg.dataset.header !== '' ? Number(pg.dataset.header) : ph;      // 4 points a press
    apply(hd, Math.min(1, Math.max(0, (x + 4 * step[0]) / pw)), Math.min(1, Math.max(0, 1 - (y - 4 * step[1]) / ph)));
  });
}
const tr = (k, p) => t(k, p);     // t(), where `t` is the event target below
function bind(body){
  body.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'cp-name'){ e.preventDefault(); $('[data-act=cp-new]')?.click(); } });
  body.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.mi !== undefined && F.items){
      F.items[Number(t.dataset.mi)].on = t.checked;
      const n = F.items.filter(x => x.on && x.kind !== 'keep').length;
      const b = $('[data-act=imp-do-merge]');
      if (b){ b.disabled = !n; b.textContent = tr('merge.doN', { n }); }
    }
    if (t.id === 'imp-outside') F.outside = t.checked;
    if (t.id === 'imp-doc'){ F.checkDoc = t.value; C.renderBody(); }
    if (t.dataset.flang !== undefined && F.drop){      // read again in another language
      const i = Number(t.dataset.flang), e = F.drop.entries[i], lang = t.value;
      loadCatalogue(lang).then(() => { e.read = { ...e.read, ...X.readIn(e.read.items, lang, e.layout) }; judge(F.drop.entries); C.renderBody(); });
    }
    const p = F.drop?.plan;
    if (p && (t.dataset.pi !== undefined || t.dataset.place !== undefined)){
      if (t.dataset.pi !== undefined){ const [fi, ii] = t.dataset.pi.split('.').map(Number); p.files[fi].items[ii].on = t.checked; }
      else { const [fi, ui] = t.dataset.place.split('.').map(Number); p.files[fi].unplaced[ui].choice = t.value; }
      const n = countOf(p), b = $('[data-act=imp-apply]');
      if (b){ b.textContent = n ? tr('i6.addN', { n }) : tr('i6.addNone'); b.dataset.n = n; }
    }
  });
  bindLayout(body);
}

const api = {
  views: { import: importView, review: reviewView, merge: mergeView, merged: mergedView, history: historyView, reading: readingView, whatsnew: whatsnewView, receipt: receiptView },
  act, bind, openFiles, take, checked: () => F.checked, receipt: () => F.drop?.done?.ids ?? [],
  compareFolder: () => act('cp-folder'),
};
