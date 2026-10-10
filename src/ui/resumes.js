// Saved resumes: the list, open, re-use, compare two, + New resume, the first-save form and
// the newer-wording review. Each view replaces the body card. The model is src/model/resumes.js.

import * as RS from '../model/resumes.js';
import { allTags } from '../model/focus.js';
import { wordDiff } from '../model/record.js';
import { t, h, errText, loadCatalogue } from '../i18n/index.js';
import { langName, langsInUse, addLangInUse, switchLang, missingList } from '../model/lang.js';
import { langMenuHtml, focusMenu } from './langmenu.js';

let C = null;
export function initResumes(ctx){ C = ctx; return api; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = s => document.querySelector(s);
const V = { picked: [], hover: null, lang: null, menu: null, more: false };

const st = () => C.store.state;
const back = () => `<a class="back" data-act="view-back">${h('nav.backToEditing')}</a>`;
const metaOf = r => [(r.lang ?? 'en').toUpperCase(), r.format === 'us-letter' ? t('paper.letter') : t('paper.a4'),
  r.pageLimit === 0 ? t('head.anyLength') : r.pageLimit ? t('resumes.pShort', { n: r.pageLimit }) : null, r.savedAt].filter(Boolean).join(' · ');
const types = () => [...new Set([...(st().record.jobTypes ?? []), ...(st().resumes ?? []).map(r => r.jobType).filter(Boolean)])];

const chosenLang = () => V.lang ?? st().cur?.lang ?? 'en';
function langPick(who){
  const L = chosenLang(), inUse = langsInUse(st().record);
  return `<span class="lbl">${h('resumes.language')}</span>
    <span class="lang-menu inbody"><button class="sm langbtn" data-act="lang-menu-body" data-for="${who}" aria-haspopup="menu" aria-expanded="${V.menu === who}">${esc(langName(L))} ▾</button>
    ${V.menu === who ? langMenuHtml({ for: who, current: L, inUse, more: V.more, label: t('resumes.language') }) : ''}</span>`;
}

function resumesView(){
  const groups = RS.grouped(st().record, st().resumes ?? []);
  V.picked = V.picked.filter(id => (st().resumes ?? []).some(r => r.id === id));
  return `${back()}<h2 class="title">${h('head.resumes')}</h2>
    <div class="btns"><button class="sm primary" data-act="goto" data-v="new">${h('edit.newResume')}</button>
      <button class="sm" data-act="goto" data-v="compare" ${V.picked.length === 2 ? '' : 'disabled'} title="${esc(t('resumes.tickTwo'))}">${h('resumes.compareN', { n: V.picked.length })}</button></div>
    ${groups.map(g => `<span class="lbl">${esc(g.type || t('resumes.noType'))}</span>
      <div class="list rlist">${g.resumes.map(r => `
        <div class="item rrow ${st().openId === r.id ? 'is-cur' : ''}" data-rid="${esc(r.id)}">
          <input type="checkbox" class="pick" data-cmp="${esc(r.id)}" ${V.picked.includes(r.id) ? 'checked' : ''} aria-label="${esc(t('resumes.compareX', { name: RS.resumeLabel(r) }))}">
          <span class="t"><b>${esc(RS.resumeLabel(r))}</b><span class="muted small">${esc(metaOf(r))}</span></span>
          <span class="rbtns"><button class="sm" data-act="r-open" data-id="${esc(r.id)}">${st().openId === r.id ? h('resumes.openTick') : h('resumes.open')}</button><button class="sm ghost" data-act="r-reuse" data-id="${esc(r.id)}" title="${esc(t('resumes.reuseTitle'))}">${h('resumes.reuse')}</button><button class="sm ghost" data-act="r-delete" data-id="${esc(r.id)}" title="${esc(t('resumes.deleteTitle'))}" aria-label="${esc(t('resumes.deleteTitle'))}">🗑</button></span>
        </div>`).join('')}</div>`).join('') || `<p class="muted">${h('resumes.none')}</p>`}
    <p class="note">${h('resumes.note')}</p>`;
}

function compareView(){
  const [a, b] = V.picked.map(id => RS.savedOf(st(), id));
  if (!a || !b) return resumesView();
  const rows = RS.compareRows(C.work(), a, b);
  const cell = c => (typeof c === 'string' ? esc(c) : `<span title="${esc(c.text)}">${esc(c.label)}</span>`);
  return `<a class="back" data-act="goto" data-v="resumes">${h('resumes.back')}</a><h2 class="title">${h('resumes.compare')}</h2>
    <table class="cmp"><thead><tr><th></th><th>${esc(RS.resumeLabel(a))}</th><th>${esc(RS.resumeLabel(b))}</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="${r.differs ? 'diff-row' : ''} ${r.kind}"><th title="${esc(r.label)}">${esc(r.label.length > 46 ? r.label.slice(0, 45) + '…' : r.label)}</th><td>${cell(r.a)}</td><td>${cell(r.b)}</td></tr>`).join('')}
    </tbody></table>
    <p class="note">${h('resumes.compareNote')}</p>`;
}

function newView(){
  const T = types();
  const latest = t => (st().resumes ?? []).some(r => r.jobType === t);
  return `<a class="back" data-act="goto" data-v="resumes">${h('resumes.back')}</a><h2 class="title">${h('resumes.newTitle')}</h2>
    ${langPick('new')}
    <div class="btns"><button class="primary" data-act="r-new" data-mode="all">${h('resumes.everything')}</button></div>
    <p class="note">${h('resumes.everythingNote')}</p>
    ${T.length ? `<span class="lbl">${h('resumes.fromType')}</span><div class="list">${T.map(ty => `<div class="item row2"><span class="t"><span class="tag jt">${esc(ty)}</span></span>
      <span class="rbtns"><button class="sm" data-act="r-new" data-mode="latest" data-type="${esc(ty)}" ${latest(ty) ? '' : `disabled title="${esc(t('resumes.noneOfType'))}"`}>${h('resumes.latest')}</button><button class="sm" data-act="r-new" data-mode="tagged" data-type="${esc(ty)}">${h('resumes.tagged', { tag: ty })}</button></span></div>`).join('')}</div>` : ''}`;
}

function saveView(){
  const c = st().cur;
  const T = types();
  const n = RS.usedVersions(C.work(), c).length;
  return `${back()}<h2 class="title">${h('resumes.saveTitle')}</h2>
    <label class="field"><span class="lbl inline">${h('resumes.company')}</span><input id="sv-co" value="${esc(c.company ?? '')}" autocomplete="off" required></label>
    <label class="field"><span class="lbl inline">${h('resumes.role')}</span><input id="sv-role" value="${esc(c.role ?? '')}" autocomplete="off"></label>
    <label class="field"><span class="lbl inline">${h('resumes.jobType')}</span><input id="sv-type" list="sv-types" value="${esc(c.jobType ?? '')}" autocomplete="off" placeholder="${esc(t('resumes.jobTypePh'))}"><datalist id="sv-types">${T.map(ty => `<option value="${esc(ty)}">`).join('')}</datalist></label>
    ${T.length ? `<div class="chips">${T.map(ty => `<button class="tag jt" data-act="sv-type" data-type="${esc(ty)}">${esc(ty)}</button>`).join('')}</div>` : ''}
    <label class="field"><span class="lbl inline">${h('resumes.otherTags')}</span><input id="sv-tags" value="${esc((c.tags ?? []).join(', '))}" placeholder="${esc(t('resumes.tagsPh'))}" autocomplete="off"></label>
    <label class="check"><input type="checkbox" id="sv-tagv" checked> ${h('resumes.tagVersions', { n })}</label>
    ${langPick('save')}
    <div class="btns"><button class="primary" data-act="sv-do">${h('head.save')}</button><button class="ghost" data-act="view-back">${h('btn.cancel')}</button></div>
    <p class="note">${C.persist.status.linked ? h('resumes.savedLinked', { name: C.persist.status.linked }) : h('resumes.savedHere')}</p>`;
}

function reviewView(){
  const items = RS.newerOf(C.work(), st().cur);
  if (!items.length) return `${back()}<h2 class="title">${h('newer.title')}</h2><p class="muted">${h('newer.none')}</p>`;
  return `${back()}<h2 class="title">${h('newer.title')}</h2>
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

const VIEWS = { resumes: resumesView, compare: compareView, new: newView, save: saveView, newer: reviewView };

function commit(fn, label, done){
  try { const ok = C.store.commit(d => { fn(d); }, label); if (ok && done) C.toast(done); return ok; }
  catch (e){ C.toast(errText(e), 'bad'); return false; }
}

function open(id){
  if (!C.leaveOk()) return;
  let res;
  const r = RS.savedOf(st(), id);
  C.ui.sel = C.NONE; C.ui.page = 0;
  commit(d => { res = RS.openSaved(d, id); }, t('undo.open', { name: RS.resumeLabel(r) }));
  C.setView(null);
  C.toast(res?.held?.length ? t('toast.openHeld', { name: RS.resumeLabel(r), n: res.held.length }) : t('toast.isOpen', { name: RS.resumeLabel(r) }));
}

function save(){
  if (!st().openId) return C.setView('save');
  commit(d => RS.saveOpen(d), t('head.save'), t('toast.savedX', { name: RS.resumeLabel(st().cur) }));
}

async function act(a, tg){
  const who = tg?.dataset?.for;
  if (['new', 'save'].includes(who)){
    if (a === 'lang-menu-body'){ V.menu = V.menu === who ? null : who; V.more = false; C.renderBody(); focusMenu('.langpop'); return true; }
    if (a === 'lang-more'){ V.more = true; C.renderBody(); focusMenu('.langpop [data-act=lang-add]'); return true; }
    if (a === 'lang' || a === 'lang-add'){
      const l = tg.dataset.lang;
      if (a === 'lang-add') commit(d => { addLangInUse(d.record, l); }, t('undo.addLanguage', { lang: langName(l) }));
      V.lang = l; V.menu = null; await loadCatalogue(l); C.renderBody(); return true;
    }
  }
  switch (a){
    case 'r-open': open(tg.dataset.id); return true;
    case 'r-reuse': {
      const r = RS.savedOf(st(), tg.dataset.id);
      C.ui.sel = C.NONE;
      commit(d => RS.reuse(d, tg.dataset.id), t('resumes.reuse'), t('toast.reused', { name: RS.resumeLabel(r) }));
      C.setView(null); return true;
    }
    case 'r-delete': {
      const r = RS.savedOf(st(), tg.dataset.id);
      commit(d => RS.deleteSaved(d, tg.dataset.id), t('undo.delete', { name: RS.resumeLabel(r) }), t('toast.deletedX', { name: RS.resumeLabel(r) }));
      return true;
    }
    case 'r-new': {
      const mode = tg.dataset.mode, type = tg.dataset.type ?? '';
      C.ui.sel = C.NONE;
      const L = chosenLang();
      V.lang = null; V.menu = null;
      commit(d => { RS.newFrom(d, { mode, jobType: type }); switchLang(d.cur, L); }, t('resumes.newTitle'),
        mode === 'tagged' ? t('toast.newTagged', { tag: type }) : mode === 'latest' ? t('toast.newLatest', { type }) : t('toast.newAll'));
      C.setView(null); return true;
    }
    case 'sv-type': $('#sv-type').value = tg.dataset.type; return true;
    case 'sv-do': {
      const company = $('#sv-co').value.trim();
      if (!company){ C.toast(t('toast.addCompany'), 'warn'); $('#sv-co').focus(); return true; }
      let res;
      const L = chosenLang();
      V.lang = null; V.menu = null;
      const ok = commit(d => { switchLang(d.cur, L); res = RS.saveNew(d, { company, role: $('#sv-role').value, jobType: $('#sv-type').value,
        tags: $('#sv-tags').value.split(','), tagVersions: $('#sv-tagv').checked }); }, t('undo.saveNewResume'));
      if (ok){
        C.setView(null);
        await C.persist.checkpoint(t('checkpoint.saved', { name: RS.resumeLabel(st().cur) }), 'first-save').catch(() => {});
        C.toast(res.tagged ? t('toast.savedTagged', { name: RS.resumeLabel(st().cur), n: res.tagged, type: st().cur.jobType }) : t('toast.savedQuoted', { name: RS.resumeLabel(st().cur) }));
      }
      return true;
    }
    case 'nw-accept': commit(d => RS.acceptNewer(d.cur, tg.dataset.id), t('undo.useNewer')); return true;
    case 'nw-keep': commit(d => RS.keepOlder(d.cur, tg.dataset.id), t('undo.keepSaved')); return true;
    case 'nw-all': commit(d => { for (const x of RS.newerOf(d.record, d.cur)) RS.acceptNewer(d.cur, x.fact); }, t('undo.useNewer'), t('toast.newerAll')); C.setView(null); return true;
    case 'save': save(); return true;
  }
  return false;
}

function bind(body){
  body.addEventListener('change', e => {
    const t = e.target;
    if (!t.dataset.cmp) return;
    const id = t.dataset.cmp;
    V.picked = t.checked ? [...V.picked.filter(x => x !== id), id].slice(-2) : V.picked.filter(x => x !== id);
    C.renderBody();
  });
  // hover a saved resume: see it on the sheet without opening it
  body.addEventListener('mouseover', e => {
    const row = e.target.closest?.('.rrow[data-rid]');
    if (!row || V.hover === row.dataset.rid) return;
    V.hover = row.dataset.rid;
    const r = structuredClone(RS.savedOf(st(), V.hover));
    if (!r) return;
    RS.holdFrozen(C.work(), r, st().frozen?.[r.id] ?? null);
    C.previewRecipe(r, null);
  });
  body.addEventListener('mouseout', e => {
    const list = e.target.closest?.('.rlist');
    if (!list || e.relatedTarget?.closest?.('.rrow[data-rid]')) return;
    V.hover = null;
    C.endPreview();
  });
  body.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.closest?.('#sv-co, #sv-role, #sv-type, #sv-tags')){ e.preventDefault(); act('sv-do', e.target); }
  });
}

const api = {
  views: VIEWS, act, bind, save, newerBanner, open,
  isDirty: () => RS.isDirty(st()),
  reset(){ V.hover = null; V.menu = null; V.lang = null; },
  closeMenus(){ if (!V.menu) return false; V.menu = null; C.renderBody(); return true; },
};
