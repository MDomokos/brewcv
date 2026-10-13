// Files: opening any file (picker, drop, paste), the review card, the merge preview, History
// with checkpoints, and Compare with a file. Models: src/model/import.js and src/model/diff.js.

import { inDesktop } from './ask.js';
import * as I from '../model/import.js';
import * as D from '../model/diff.js';
import * as RS from '../model/resumes.js';
import { readBackup, makeBackup, openVerdict, sha256 } from '../store/persist.js';
import { ensureRecordId } from '../model/schema.js';
import { newResume } from '../model/resume.js';
import { t, h, errText } from '../i18n/index.js';

let C = null;
export function initFiles(ctx){ C = ctx; return api; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = s => document.querySelector(s);
const st = () => C.store.state;
const F = { got: null, items: null, outside: true, history: { list: null, sel: null, items: null, compare: null } };
const KIND = k => ({ library: t('files.kindLibrary'), jsonresume: t('files.kindJsonResume'), backup: t('files.kindBackup'), resume: t('files.kindResume'), theme: t('files.kindTheme'), error: t('files.kindError') }[k]);
const stamp = iso => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '—');
const isExample = () => /\(fictional\)/.test(st().record?.meta?.owner ?? '');

function commit(fn, label, done){
  try { const ok = C.store.commit(d => { fn(d); }, label); if (ok && done) C.toast(done); return ok; }
  catch (e){ C.toast(errText(e), 'bad'); return false; }
}
const diffHtml = runs => runs.map(r => (r.op === '=' ? esc(r.text) : r.op === '-' ? `<del>${esc(r.text)}</del>` : `<ins>${esc(r.text)}</ins>`)).join('');

function importView(){
  return `<h2 class="title">${h('files.importTitle')}</h2>
    <p class="small">${h('files.importIntro')}</p>
    <div class="btns"><button class="primary" data-act="imp-pick">${h('files.choose')}</button></div>
    <p class="note">${h('files.orDrop')}</p>
    <span class="lbl">${h('files.orPaste')}</span>
    <textarea id="imp-paste" class="paste" rows="6" placeholder='{ "basics": { "name": … } }' aria-label="${esc(t('files.orPaste'))}"></textarea>
    <div class="btns"><button class="sm" data-act="imp-paste">${h('files.readIt')}</button></div>`;
}

function reviewView(){
  const g = F.got;
  if (!g) return importView();
  if (g.kind === 'error') return `<a class="back" data-act="goto" data-v="import">${h('files.backImport')}</a><h2 class="title">${esc(g.file)}</h2><div class="missbar">${esc(g.message)}</div>`;
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
    else if (v.kind === 'different') actions = `<button class="primary" data-act="imp-merge">${h('save.merge')}</button><button data-act="imp-replace">${h('files.replaceMine')}</button>`;
    else actions = `<button class="primary" data-act="imp-save-first">${h('save.saveFirst')}</button><button data-act="imp-merge">${h('save.merge')}</button><button data-act="imp-replace">${h('save.replaceAnyway')}</button>`;
  } else if (g.kind === 'library' || g.kind === 'jsonresume' || g.kind === 'backup'){
    actions = isExample()
      ? `<button class="primary" data-act="imp-replace">${h('files.openIt')}</button><button data-act="imp-merge">${h('files.addToExample')}</button>`
      : `<button class="primary" data-act="imp-merge">${h('files.addToMine')}</button><button data-act="imp-replace">${h('files.replaceMine')}</button>`;
  } else if (g.kind === 'resume'){
    const pm = I.picksMatched(st().record, g.recipe);
    actions = `<button class="primary" data-act="imp-resume">${h('files.openIt')}</button>`;
    rows.push([t('files.matches'), pm.total ? t('files.picksOf', { matched: pm.matched, total: pm.total }) : t('files.noPicks')]);
  } else if (g.kind === 'theme'){
    actions = `<button class="primary" data-act="imp-theme">${h('files.addTheme')}</button>`;
  }
  const out = g.outside ?? [];
  return `<a class="back" data-act="goto" data-v="import">${h('files.backImport')}</a><h2 class="title">${esc(KIND(g.kind) ?? g.kind)}</h2>
    <p class="muted small">${esc(g.file)}</p>
    ${warn}
    <table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
    ${(g.review?.notShown ?? []).length ? `<span class="lbl">${h('files.notShown')}</span><ul class="small">${g.review.notShown.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${out.length ? `<label class="check"><input type="checkbox" id="imp-outside" ${F.outside ? 'checked' : ''}> ${h('files.outside', { n: out.length })}</label>
      <ul class="small">${out.slice(0, 5).map(e => `<li>${esc(e.where)}: “${esc(e.text.slice(0, 60))}${e.text.length > 60 ? '…' : ''}”</li>`).join('')}</ul>` : ''}
    <div class="btns">${actions}</div>
    <p class="note">${g.kind === 'resume' || v?.kind === 'same' ? '' : h('files.eitherWay')}</p>`;
}

function itemsHtml(items, checkable){
  if (!items.length) return `<p class="muted">${h('files.noDiff')}</p>`;
  const G = checkable ? { add: t('merge.willAdd'), change: t('merge.different'), keep: t('merge.onlyYours') } : { add: t('merge.added'), change: t('merge.changed'), keep: t('merge.removed') };
  return ['add', 'change', 'keep'].map(k => {
    const its = items.map((x, i) => [x, i]).filter(([x]) => x.kind === k);
    if (!its.length) return '';
    return `<div class="mgroup ${k}">${G[k]} · ${its.length}</div><div class="mlist">${its.map(([x, i]) => {
      const body = x.diff ? diffHtml(x.diff) : x.a ? `<del>${esc(x.a)}</del> → <ins>${esc(x.b)}</ins>` : esc(x.b ?? '');
      return checkable && k !== 'keep'
        ? `<label class="mi"><input type="checkbox" data-mi="${i}" ${x.on ? 'checked' : ''}><span><span class="mw">${esc(x.what)}</span><span class="mx">${body}</span></span></label>`
        : `<div class="mi ro"><span class="sym ${k}">${k === 'add' ? '+' : k === 'change' ? '~' : '−'}</span><span><span class="mw">${esc(x.what)}</span><span class="mx">${body}</span></span></div>`;
    }).join('')}</div>`;
  }).join('');
}

function mergeView(){
  const items = F.items ?? [];
  const n = items.filter(x => x.on && x.kind !== 'keep').length;
  return `<a class="back" data-act="goto" data-v="review">${h('merge.cancel')}</a><h2 class="title">${h('merge.title', { file: F.got?.file ?? '' })}</h2>
    <p class="small">${h('merge.intro')}</p>
    ${itemsHtml(items, true)}
    <div class="btns"><button class="ghost" data-act="imp-replace">${h('merge.replaceInstead')}</button><span class="grow"></span><button class="primary" data-act="imp-do-merge" ${n ? '' : 'disabled'}>${h('merge.doN', { n })}</button></div>`;
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
      got.info = readBackup(got.json).info;
      got.hash = await sha256(text);
      const { last, changes } = C.persist.fileState;
      got.verdict = isExample() ? { kind: 'ok' } : openVerdict({ file: { ...got.info, hash: got.hash }, last, localRecordId: st().record?.recordId ?? null, changes });
    } catch { got.verdict = { kind: 'ok' }; }
  }
  F.got = got;
  F.outside = true;
  C.setView('review');
}

export async function openFile(file, mode = null){
  if (/^image\//.test(file.type) && C.onImage){ C.onImage(file); return; }
  if (/\.css$/i.test(file.name) && C.onThemeText){ C.onThemeText(await file.text(), file.name); return; }
  await take(await file.text(), file.name, mode);
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
  if (g.kind === 'backup') await C.persist.markFileOpened({ at: g.info?.saved ?? new Date().toISOString(), recordId: next.record.recordId ?? null, hash: g.hash ?? null });
  F.got = null; F.items = null;
  C.setView(null);
  C.toast(t('toast.fileOpen', { file: g.file }));
}

async function act(a, tg){
  const H = F.history;
  switch (a){
    case 'imp-pick': C.pickFile(); return true;
    case 'imp-paste': { const text = $('#imp-paste')?.value ?? ''; if (!text.trim()){ C.toast(t('toast.pasteFirst'), 'warn'); return true; } await take(text, t('files.pasted')); return true; }
    case 'imp-replace': await replace(); return true;
    case 'imp-save-first': if (await C.saveToFile()) await replace(); return true;
    case 'imp-merge': {
      const inc = incomingState();
      F.items = D.diffRecords(st().record, inc.record, { fromResumes: st().resumes, toResumes: inc.resumes });
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
  });
}

const api = {
  views: { import: importView, review: reviewView, merge: mergeView, history: historyView },
  act, bind, openFile, take,
  compareFolder: () => act('cp-folder'),
  resetHistory(){ F.history.list = null; },
};
