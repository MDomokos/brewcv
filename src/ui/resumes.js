// Saved resumes in the panel: + New resume, Mark as sent (the end of Export), a snapshot
// opened read-only, and the newer-wording review. The switcher in the header (switcher.js) is the way to jump
// between resumes; the row menu here is shared by both. The model is src/model/resumes.js.

import * as RS from '../model/resumes.js';
import { jobTypesOf, jobTypeLabel, planTag } from '../model/focus.js';
import { wordDiff } from '../model/record.js';
import { t, h, errText, loadCatalogue } from '../i18n/index.js';
import { langName, langsInUse, addLangInUse, a4FormatOf } from '../model/lang.js';
import { newResume } from '../model/resume.js';
import { langMenuHtml, focusMenu } from './langmenu.js';
import { icon } from './icons.js';

let C = null;
export function initResumes(ctx){ C = ctx; return api; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = s => document.querySelector(s);
const V = { hover: null, menu: null, more: false, row: null, renaming: null, nv: null, send: null };

const st = () => C.store.state;
const metaOf = r => [(r.lang ?? 'en').toUpperCase(), r.format === 'us-letter' ? t('paper.letter') : t('paper.a4'),
  r.pageLimit === 0 ? t('head.anyLength') : r.pageLimit ? t('resumes.pShort', { n: r.pageLimit }) : null, r.savedAt].filter(Boolean).join(' · ');
const typeLabel = id => jobTypeLabel(st().record, id);
const forLine = r => [r.forKind === 'outreach' ? t('ux1.outreach') : null, r.company].filter(Boolean).join(' · ');

// ---- the row menu: Duplicate, Duplicate in another language…, Rename, Delete ----

// A resume can be on screen twice (under Recent and in its job type): the menu opens where it was asked for.
export function rowMenuHtml(id, where = 'group'){
  if (V.row?.id !== id || V.row.where !== where) return '';
  const r = RS.savedOf(st(), id);
  if (!r) return '';
  if (V.row.sub === 'lang'){
    const here = r.lang ?? 'en';
    return `<div class="pop card rowmenu" role="menu" aria-label="${esc(t('ux1.dupLang'))}" data-menu="row">
      ${langsInUse(st().record).filter(l => l !== here).map(l => `<button role="menuitem" data-act="rm-dup-lang" data-id="${esc(id)}" data-lang="${l}" lang="${l}">${esc(langName(l))}</button>`).join('')}
    </div>`;
  }
  return `<div class="pop card rowmenu" role="menu" aria-label="${esc(t('ux1.rowMenu', { name: RS.resumeLabel(r) }))}" data-menu="row">
    <button role="menuitem" data-act="rm-dup" data-id="${esc(id)}">${h('ux1.dup')}</button>
    <button role="menuitem" data-act="rm-lang" data-id="${esc(id)}">${h('ux1.dupLang')}</button>
    <button role="menuitem" data-act="rm-rename" data-id="${esc(id)}">${h('ux1.rename')}</button>
    <button role="menuitem" data-act="rm-delete" data-id="${esc(id)}">${h('ux1.delete')}</button>
  </div>`;
}
export const moreButton = (id, where = 'group') => `<button class="smore" data-act="rm-menu" data-id="${esc(id)}" data-where="${where}" aria-haspopup="menu" aria-expanded="${V.row?.id === id && V.row.where === where}" title="${esc(t('ux1.rowMenuTitle'))}" aria-label="${esc(t('ux1.rowMenu', { name: RS.resumeLabel(RS.savedOf(st(), id)) }))}">${icon('more')}</button>`;
export const renamingHere = (id, where = 'group') => V.renaming?.id === id && V.renaming.where === where;
export const renameInput = r => `<input class="swren" data-rename="${esc(r.id)}" value="${esc(RS.resumeLabel(r))}" aria-label="${esc(t('ux1.rename'))}" autocomplete="off">`;

// ---- + New resume ----

function nvInit(){
  const c = st().cur ?? {};
  const jobType = '';
  const nv = { name: '', touched: false, jobType, newType: '', kind: 'company', company: '', role: '',
    lang: c.lang ?? 'en', paper: c.format === 'us-letter' ? 'us-letter' : 'a4', start: null, fromId: null, picking: false };
  nv.start = lastOf(nv) ? 'latest' : 'all';
  nv.fromId = lastOf(nv)?.id ?? null;
  return nv;
}
const nv = () => (V.nv ??= nvInit());
const lastOf = n => { const list = RS.byNewest(st().resumes ?? []); return (n.jobType ? list.find(r => r.jobType === n.jobType) : list[0]) ?? null; };
const nvName = n => n.touched ? n.name : RS.nameFrom({ company: n.company, role: n.role, jobLabel: n.newType || (n.jobType ? typeLabel(n.jobType) : '') });
const formatOf = n => (n.paper === 'us-letter' ? 'us-letter' : a4FormatOf(n.lang));
const typeOf = n => (n.jobType === '+' ? n.newType.trim() : n.jobType);

function nvPlan(n){
  const T = typeOf(n);
  if (!T || !jobTypesOf(st().record).some(j => j.id === T)) return null;
  const probe = newResume(st().record, { format: formatOf(n), lang: n.lang, pageLimit: st().cur?.pageLimit ?? 1 });
  return planTag(C.work(), probe, T);
}

function newView(){
  const n = nv();
  const T = jobTypesOf(st().record);
  const last = lastOf(n) ?? null;
  const picked = n.fromId ? RS.savedOf(st(), n.fromId) : last;
  const plan = nvPlan(n);
  const L = n.lang, inUse = langsInUse(st().record);
  const opt = (v, label, extra = '', off = false) => `<label class="startopt ${off ? 'is-off' : ''}" data-start="${v}"><input type="radio" name="nv-start" value="${v}" ${n.start === v ? 'checked' : ''} ${off ? 'disabled' : ''}> <span>${label}${extra}</span></label>`;
  // The decision comes first: what kind of job, and what to start from. Then its name and who it is for, and last the language and paper.
  return `<h2 class="title">${h('ux1.newTitle')}</h2>
    <label class="field"><span class="lbl inline">${h('resumes.jobType')}</span><select id="nv-type">
      <option value="">${h('ux1.noType')}</option>${T.map(j => `<option value="${esc(j.id)}" ${n.jobType === j.id ? 'selected' : ''}>${esc(j.label)}</option>`).join('')}<option value="+" ${n.jobType === '+' ? 'selected' : ''}>${h('ux1.newType')}</option></select></label>
    ${n.jobType === '+' ? `<label class="field"><input id="nv-newtype" value="${esc(n.newType)}" autocomplete="off" placeholder="${esc(t('resumes.jobTypePh'))}" aria-label="${esc(t('ux1.newType'))}"></label>` : ''}
    <span class="lbl">${h('ux1.startFrom')}</span>
    <div class="startopts">
      ${opt('latest', typeOf(n) ? h('ux1.startLatestType', { type: typeLabel(typeOf(n)) }) : h('ux1.startLatest'), picked ? ` <b>${esc(RS.resumeLabel(picked))}</b> <a data-act="nv-change" role="button" tabindex="0">${h('ux1.change')}</a>` : '', !last)}
      ${n.picking ? `<select id="nv-from" aria-label="${esc(t('ux1.change'))}">${(st().resumes ?? []).map(r => `<option value="${esc(r.id)}" ${r.id === n.fromId ? 'selected' : ''}>${esc(RS.resumeLabel(r))}</option>`).join('')}</select>` : ''}
      ${opt('tagged', h('ux1.startTagged', { type: esc(typeOf(n) ? typeLabel(typeOf(n)) : t('ux1.thisType')) }), plan ? `<span class="muted small block">${h('ux1.startPlan', { on: plan.on, off: plan.off, sw: plan.sw })}</span>` : `<span class="muted small block">${h('ux3b.pickTypeFirst')}</span>`, !plan)}
      ${opt('all', h('ux1.startAll'))}
      ${opt('empty', h('ux1.startEmpty'))}
    </div>
    <label class="field"><span class="lbl inline">${h('ux1.name')}</span><input id="nv-name" value="${esc(nvName(n))}" autocomplete="off" placeholder="${esc(t('ux1.namePh'))}"></label>
    <span class="lbl">${h('ux1.for')}</span>
    <label class="field"><select id="nv-kind" aria-label="${esc(t('ux1.kind'))}"><option value="company" ${n.kind === 'company' ? 'selected' : ''}>${h('ux1.kindCompany')}</option><option value="outreach" ${n.kind === 'outreach' ? 'selected' : ''}>${h('ux1.kindOutreach')}</option></select></label>
    <label class="field"><span class="lbl inline">${h('resumes.company')}</span><input id="nv-co" value="${esc(n.company)}" autocomplete="off"></label>
    <label class="field"><span class="lbl inline">${h('resumes.role')}</span><input id="nv-role" value="${esc(n.role)}" autocomplete="off"></label>
    <span class="lbl">${h('resumes.language')}</span>
    <span class="lang-menu inbody"><button class="sm langbtn" data-act="lang-menu-body" data-for="new" aria-haspopup="menu" aria-expanded="${V.menu === 'new'}">${esc(langName(L))} ${icon('caret', { size: 12 })}</button>
    ${V.menu === 'new' ? langMenuHtml({ for: 'new', current: L, inUse, more: V.more, label: t('resumes.language') }) : ''}</span>
    <label class="field"><span class="lbl inline">${h('design.paper')}</span><select id="nv-paper"><option value="a4" ${n.paper !== 'us-letter' ? 'selected' : ''}>${h('paper.a4')}</option><option value="us-letter" ${n.paper === 'us-letter' ? 'selected' : ''}>${h('paper.letter')}</option></select></label>
    <div class="btns"><button class="primary" data-act="nv-create">${h('ux1.create')}</button><button class="ghost" data-act="view-back">${h('btn.cancel')}</button></div>
    <p class="note">${h('ux1.newNote')}</p>`;
}

function nvOptions(){
  const n = nv();
  const start = n.start === 'tagged' && !nvPlan(n) ? 'all' : n.start === 'latest' && !lastOf(n) ? 'all' : n.start;
  return { start, fromId: start === 'latest' ? (n.fromId ?? lastOf(n)?.id) : null, jobType: typeOf(n), name: nvName(n).trim(), company: n.company, role: n.role,
    forKind: n.kind, format: formatOf(n), lang: n.lang };
}
function nvPreview(start){
  const n = nv();
  try {
    const o = nvOptions();
    o.start = start;
    if (start === 'latest') o.fromId = n.fromId ?? lastOf(n)?.id;
    if (start === 'latest' && !o.fromId) return;
    C.previewRecipe(RS.startRecipe(st(), o), null);
  } catch { /* the option is not available */ }
}

// ---- Sent to? (Mark as sent, at the end of Export) ----

function sendDefaults(){
  const c = st().cur ?? {};
  return { kind: c.forKind === 'outreach' ? 'outreach' : 'company', company: c.company ?? '', role: c.role ?? '', date: RS.today() };
}
function saveView(){
  const s = (V.send ??= sendDefaults());
  const merge = RS.sameAsLatest(st());
  return `<h2 class="title">${h('ux1.sentTo')}</h2>
    <label class="field"><span class="lbl inline">${h('ux1.kind')}</span><select id="sv-kind"><option value="company" ${s.kind === 'company' ? 'selected' : ''}>${h('ux1.kindCompany')}</option><option value="outreach" ${s.kind === 'outreach' ? 'selected' : ''}>${h('ux1.kindOutreach')}</option></select></label>
    <label class="field"><span class="lbl inline">${h('resumes.company')}</span><input id="sv-co" value="${esc(s.company)}" autocomplete="off"></label>
    <label class="field"><span class="lbl inline">${h('resumes.role')}</span><input id="sv-role" value="${esc(s.role)}" autocomplete="off"></label>
    <label class="field"><span class="lbl inline">${h('ux1.date')}</span><input id="sv-date" type="date" value="${esc(s.date)}"></label>
    <div class="btns"><button class="primary" data-act="sv-do">${h('ux3b.markSentDo')}</button><button class="ghost" data-act="sent-back">${h('btn.cancel')}</button></div>
    <p class="note">${h(merge ? 'ux1.sendMerge' : 'ux3b.sentNote')}</p>
    <p class="note">${C.persist.status.linked ? h('resumes.savedLinked', { name: C.persist.status.linked }) : h('resumes.savedHere')}</p>`;
}
function readSend(){
  return RS.normalSend({ kind: $('#sv-kind')?.value, company: $('#sv-co')?.value, role: $('#sv-role')?.value, date: $('#sv-date')?.value });
}

// ---- a snapshot, read-only ----

export const sendsText = snap => snap.sends.map(s => [RS.sendLabel(s), s.date].filter(Boolean).join(' · ')).join(' · ');
export function snapBarText(snap){
  const sends = snap.sends.filter(s => RS.sendLabel(s));
  return sends.length ? t('ux1.snapBarSent', { to: sends.map(s => RS.sendLabel(s)).join(', '), date: sends.at(-1).date })
    : t('ux1.snapBarPlain', { date: snap.sends.at(-1)?.date || snap.at.slice(0, 10) });
}
function snapshotView(){
  const snap = RS.findSnapshot(st(), C.ui.snap?.id);
  if (!snap) return `<p class="muted">${h('ux1.noneYet')}</p>`;
  return `<a class="back" data-act="snap-close">${h('ux1.backToResume')}</a>
    <h2 class="title">${esc(RS.resumeLabel(st().cur))}</h2>
    <div class="banner snapnote"><span>${esc(snapBarText(snap))}</span></div>
    <span class="lbl">${h('ux1.sends', { n: snap.sends.length })}</span>
    <div class="list">${snap.sends.map(s => `<div class="item static"><span>${esc(RS.sendLabel(s) || t('ux1.noRecipient'))}${s.kind === 'outreach' ? ` <span class="pill">${h('ux1.outreach')}</span>` : ''}</span><span class="muted small">${esc(s.date)}</span></div>`).join('')}</div>
    <div class="btns snapacts"><button class="primary" data-act="goto" data-v="export">${h('head.export')}</button>
      <button data-act="snap-restore">${h('ux1.restore')}</button>
      <button data-act="snap-dup">${h('ux1.dupSnap')}</button></div>
    <p class="note">${h('ux1.snapNote')}</p>`;
}

// ---- newer wording ----

function reviewView(){
  const items = RS.newerOf(C.work(), st().cur);
  if (!items.length) return `<h2 class="title">${h('newer.title')}</h2><p class="muted">${h('newer.none')}</p>`;
  return `<h2 class="title">${h('newer.title')}</h2>
    <p class="small">${h('newer.intro', { n: items.length })}</p>
    ${items.map(x => `<div class="review" data-fact="${esc(x.fact)}">
      <div class="small muted">${esc(C.work().facts.find(f => f.id === x.fact)?.summary ?? x.fact)}</div>
      <div class="diff">${wordDiff(x.frozen, x.live).map(d => (d.op === '=' ? esc(d.text) : d.op === '-' ? `<del>${esc(d.text)}</del>` : `<ins>${esc(d.text)}</ins>`)).join('')}</div>
      <div class="btns"><button class="sm primary" data-act="nw-accept" data-id="${esc(x.fact)}">${h('newer.accept')}</button><button class="sm" data-act="nw-keep" data-id="${esc(x.fact)}">${h('newer.keep')}</button></div>
    </div>`).join('')}
    <div class="btns"><button class="sm" data-act="nw-all">${h('newer.all')}</button></div>`;
}

// the banner on the home view
function newerBanner(){
  const n = RS.newerOf(C.work(), st().cur).length;
  return n ? `<div class="banner"><span>${h('newer.banner', { n })}</span><button class="sm" data-act="goto" data-v="newer">${h('newer.review')}</button></div>` : '';
}

const VIEWS = { new: newView, sent: saveView, newer: reviewView, snapshot: snapshotView };

function commit(fn, label, done){
  try { const ok = C.store.commit(d => { fn(d); }, label); if (ok && done) C.toast(done); return ok; }
  catch (e){ C.toast(errText(e), 'bad'); return false; }
}

function open(id, { quiet = false } = {}){
  if (!C.leaveOk()) return false;
  let res;
  const r = RS.savedOf(st(), id);
  if (!r) return false;
  C.ui.sel = C.NONE; C.ui.page = 0;
  C.setSnap(null);
  if (st().openId !== id){ if (!C.ui.previewSwitch) C.ui.morph = { kind: 'switch' }; commit(d => { res = RS.openSaved(d, id); }, t('undo.open', { name: RS.resumeLabel(r) })); }
  V.row = null; V.renaming = null;
  C.noteOpen(id);
  C.setView(null);
  if (!quiet) C.toast(res?.held?.length ? t('toast.openHeld', { name: RS.resumeLabel(r), n: res.held.length }) : t('toast.isOpen', { name: RS.resumeLabel(r) }));
  return true;
}

function openSnapshot(rid, sid){
  if (!open(rid, { quiet: true })) return;
  C.setSnap(sid);
  C.setView(null);
}

function markSent(){
  if (C.ui.snap) return;
  V.send = null;
  C.setView('sent');
}

async function sendNow(){
  const send = readSend();
  const merge = RS.sameAsLatest(st());
  let res;
  const ok = commit(d => { res = RS.takeSnapshot(d, send); }, t(merge ? 'ux1.undoSend' : 'ux1.undoSnapshot'));
  if (ok) C.snapshotTaken?.();
  V.send = null;
  C.setView('export');
  if (!ok && res?.repeated){ C.toast(t('ux1.alreadySent')); return; }
  const to = RS.sendLabel(send);
  C.toast(res?.added ? (to ? t('ux1.snapSavedTo', { to }) : t('ux1.snapSaved')) : (to ? t('ux1.sendAddedTo', { to }) : t('ux1.sendAdded')));
}

function rerender(){ C.renderHead(); C.renderBody(); C.renderSwitcher(); }

async function act(a, tg){
  const who = tg?.dataset?.for;
  if (who === 'new'){
    if (a === 'lang-menu-body'){ V.menu = V.menu === who ? null : who; V.more = false; C.renderBody(); focusMenu('.langpop'); return true; }
    if (a === 'lang-more'){ V.more = true; C.renderBody(); focusMenu('.langpop [data-act=lang-add]'); return true; }
    if (a === 'lang' || a === 'lang-add'){
      const l = tg.dataset.lang;
      if (a === 'lang-add') commit(d => { addLangInUse(d.record, l); }, t('undo.addLanguage', { lang: langName(l) }));
      const n = nv();
      n.paper = l === 'en' && st().cur?.format === 'us-letter' ? 'us-letter' : 'a4';     // the paper that goes with the language
      n.lang = l; V.menu = null; await loadCatalogue(l); C.renderBody(); return true;
    }
  }
  switch (a){
    case 'rm-menu': {
      const id = tg.dataset.id, where = tg.dataset.where ?? 'group';
      V.row = V.row?.id === id && V.row.where === where ? null : { id, where, sub: null };
      rerender();
      if (V.row) setTimeout(() => document.querySelector('.rowmenu [role=menuitem]')?.focus(), 0);
      return true;
    }
    case 'rm-lang': V.row = { id: tg.dataset.id, where: V.row?.where ?? 'group', sub: 'lang' }; rerender(); setTimeout(() => document.querySelector('.rowmenu [role=menuitem]')?.focus(), 0); return true;
    case 'rm-dup': case 'rm-dup-lang': {
      const id = tg.dataset.id, lang = a === 'rm-dup-lang' ? tg.dataset.lang : null;
      if (!C.leaveOk()) return true;
      if (lang) await loadCatalogue(lang);
      let res;
      V.row = null;
      C.ui.sel = C.NONE; C.setSnap(null);
      const ok = commit(d => { res = RS.duplicate(d, id, { lang }); }, t(lang ? 'ux1.undoDupLang' : 'ux1.undoDup'));
      if (ok){
        C.noteOpen(res.id);
        C.setView(null);
        // the copy is open, under its parent, with its name selected to type over: that says it (a phone has no name field, and says it in a toast)
        if (!C.nameReady()) C.toast(lang ? t('ux1.dupLangDone', { name: RS.resumeLabel(st().cur), lang: langName(lang) }) : t('ux1.dupDone', { name: RS.resumeLabel(st().cur) }));
      } else rerender();
      return true;
    }
    case 'rm-rename': V.renaming = { id: tg.dataset.id, where: V.row?.where ?? 'group' }; V.row = null; rerender(); setTimeout(() => { const i = document.querySelector('.swren'); i?.focus(); i?.select(); }, 0); return true;
    case 'rm-delete': {
      const r = RS.savedOf(st(), tg.dataset.id);
      V.row = null;
      if (st().openId === tg.dataset.id){ if (!C.leaveOk()) return true; C.ui.sel = C.NONE; C.setSnap(null); }
      commit(d => RS.deleteSaved(d, tg.dataset.id), t('undo.delete', { name: RS.resumeLabel(r) }), t('toast.deletedX', { name: RS.resumeLabel(r) }));
      rerender();
      return true;
    }
    case 'nv-change': nv().picking = !nv().picking; nv().start = 'latest'; C.renderBody(); return true;
    case 'nv-create': {
      const n = nv();
      const o = nvOptions();
      if (n.jobType === '+' && !n.newType.trim()){ C.toast(t('jt.needName'), 'warn'); $('#nv-newtype')?.focus(); return true; }
      if (!C.leaveOk()) return true;
      C.ui.sel = C.NONE; C.setSnap(null);
      await loadCatalogue(n.lang);
      let res;
      const ok = commit(d => { res = RS.newFrom(d, o); }, t('resumes.newTitle'));
      if (!ok) return true;
      V.nv = null; V.menu = null;
      C.noteOpen(res.id);
      C.setView(null);
      C.toast(t('ux1.created', { name: RS.resumeLabel(st().cur) }));
      if (o.start === 'all') C.fit();
      return true;
    }
    case 'sv-do': await sendNow(); return true;
    case 'snap-close': C.setSnap(null); C.setView(null); return true;
    case 'snap-restore': {
      const sid = C.ui.snap?.id;
      if (!sid) return true;
      C.setSnap(null);
      commit(d => RS.restoreSnapshot(d, sid), t('ux1.undoRestore'), t('ux1.restored'));
      C.setView(null);
      return true;
    }
    case 'snap-dup': {
      const sid = C.ui.snap?.id;
      if (!sid) return true;
      let res;
      C.setSnap(null); C.ui.sel = C.NONE;
      if (commit(d => { res = RS.duplicateSnapshot(d, sid); }, t('ux1.undoDup'))){ C.noteOpen(res.id); C.toast(t('ux1.dupDone', { name: RS.resumeLabel(st().cur) })); }
      C.setView(null);
      return true;
    }
    case 'nw-accept': commit(d => RS.acceptNewer(d.cur, tg.dataset.id), t('undo.useNewer')); return true;
    case 'nw-keep': commit(d => RS.keepOlder(d.cur, tg.dataset.id), t('undo.keepSaved')); return true;
    case 'nw-all': commit(d => { for (const x of RS.newerOf(d.record, d.cur)) RS.acceptNewer(d.cur, x.fact); }, t('undo.useNewer'), t('toast.newerAll')); C.setView(null); return true;
    case 'mark-sent': markSent(); return true;
    case 'sent-back': V.send = null; C.setView('export'); return true;
  }
  return false;
}

function renameDone(input, keep){
  const id = input.dataset.rename;
  if (V.renaming?.id !== id) return;
  V.renaming = null;
  const name = input.value.trim();
  const r = RS.savedOf(st(), id);
  if (keep && r && name && name !== RS.resumeLabel(r)){
    let res;
    commit(d => { res = RS.renameSaved(d, id, name); }, t('ux1.undoRename'));
    if (res) C.noteRename?.(id, res.id);
  }
  rerender();
}

function bind(body){
  body.addEventListener('change', e => {
    const el = e.target;
    if (el.name === 'nv-start'){ nv().start = el.value; if (el.value !== 'latest') nv().picking = false; C.renderBody(); return; }
    const n = V.nv;
    if (el.id === 'nv-type' && n){ n.jobType = el.value; if (n.start === 'tagged' && !nvPlan(n)) n.start = 'all'; const l = lastOf(n); n.fromId = l?.id ?? null; if (n.start === 'latest' && !l) n.start = 'all'; C.renderBody(); return; }
    if (el.id === 'nv-kind' && n) n.kind = el.value;
    if (el.id === 'nv-paper' && n) n.paper = el.value;
    if (el.id === 'nv-from' && n){ n.fromId = el.value; n.picking = false; C.renderBody(); }
    if (el.id === 'sv-kind' && V.send) V.send.kind = el.value;
  });
  body.addEventListener('input', e => {
    const el = e.target, n = V.nv;
    if (el.id === 'sv-co' && V.send) V.send.company = el.value;
    if (el.id === 'sv-role' && V.send) V.send.role = el.value;
    if (el.id === 'sv-date' && V.send) V.send.date = el.value;
    if (!n) return;
    if (el.id === 'nv-name'){ n.name = el.value; n.touched = el.value.trim() !== ''; return; }
    if (el.id === 'nv-newtype') n.newType = el.value;
    if (el.id === 'nv-co') n.company = el.value;
    if (el.id === 'nv-role') n.role = el.value;
    if (['nv-newtype', 'nv-co', 'nv-role'].includes(el.id) && !n.touched){ const f = $('#nv-name'); if (f) f.value = nvName(n); }
  });
  // hover a saved resume: see it on the sheet without opening it
  body.addEventListener('mouseover', e => {
    const row = e.target.closest?.('.rrow[data-rid]');
    if (row && V.hover !== row.dataset.rid){
      V.hover = row.dataset.rid;
      previewSaved(V.hover);
      return;
    }
    const opt = e.target.closest?.('.startopt[data-start]:not(.is-off)');
    if (opt && V.hover !== `start:${opt.dataset.start}`){ V.hover = `start:${opt.dataset.start}`; nvPreview(opt.dataset.start); }
  });
  body.addEventListener('mouseout', e => {
    const list = e.target.closest?.('.rlist, .startopts');
    if (!list || e.relatedTarget?.closest?.('.rrow[data-rid], .startopt')) return;
    V.hover = null;
    C.endPreview();
  });
  body.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.closest?.('#sv-co, #sv-role, #sv-date, #sv-kind')){ e.preventDefault(); act('sv-do', e.target); }
    if (e.key === 'Enter' && e.target.closest?.('#nv-name, #nv-co, #nv-role, #nv-newtype')){ e.preventDefault(); act('nv-create', e.target); }
    if (e.target.classList?.contains('swren')){
      if (e.key === 'Enter'){ e.preventDefault(); renameDone(e.target, true); }
      if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); renameDone(e.target, false); }
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.rrow .t, [data-act=nv-change]')){ e.preventDefault(); e.target.click(); }
  });
  body.addEventListener('focusout', e => { if (e.target.classList?.contains('swren')) renameDone(e.target, true); });
}

// a saved resume as it prints: its sent wording held over the record's present one
export function heldRecipe(id){
  const r = structuredClone(RS.savedOf(st(), id));
  if (!r) return null;
  delete r.snapshots;
  RS.holdFrozen(C.work(), r, st().frozen?.[id] ?? null);
  return r;
}
export function previewSaved(id){
  const r = heldRecipe(id);
  if (r) C.previewRecipe(r, null);
}

const api = {
  views: VIEWS, act, bind, markSent, newerBanner, open, openSnapshot, rowMenuHtml, moreButton, renameInput, renamingHere, previewSaved, heldRecipe, renameDone,
  reset(){ V.hover = null; V.menu = null; V.row = null; V.renaming = null; V.nv = null; },
  closeMenus(){
    if (V.row){ V.row = null; rerender(); return true; }
    if (!V.menu) return false;
    V.menu = null; C.renderBody(); return true;
  },
  get rowOpen(){ return !!V.row; },
};
