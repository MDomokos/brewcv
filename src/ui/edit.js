// The Edit view: what the body card shows for the resume, a section, a job and a bullet, and what its
// controls do. One panel for a claim wherever you came from: the page, the record checklist below it, or
// the timeline. Every change is one store commit, so one undo step. Typing is not a change until it is saved.

import * as R from '../model/record.js';
import * as T from '../model/resume.js';
import { key as measureKeyOf } from '../fit.js';
import { allTags, planTag, applyTag, tagHits, jobTypesOf, jobTypeLabel, tagsOf, lensChoices } from '../model/focus.js';
import { missingList, isSame, setSame, sameKey, langName, writeIn, DEFAULT_LANG } from '../model/lang.js';
import * as K from '../model/career.js';
import { recordSelOfFact, factOfRecordSel } from '../model/checklist.js';
import { t, h, errText } from '../i18n/index.js';
import { esc, clip, crumb, sw, factRow as partFactRow, missBar, versionsHtml, statsHtml, claimHead } from './parts.js';

let C = null;
export function initEdit(ctx){ C = ctx; return api; }

const $ = s => document.querySelector(s);
const LANG_NAME = new Proxy({}, { get: (_, l) => langName(l) });

// the editor and the panel's own view state; none of it is undone
const E = { edit: null, compare: null, openMinor: new Set(), timer: null, drag: null, focus: null, claimDraft: '', lensTags: false, applyOpen: false };

function commit(fn, label, done){
  try {
    const changed = C.store.commit(d => { fn(d); }, label);
    if (changed && done) C.toast(done);
    return changed;
  } catch (e){
    C.toast(errText(e), 'bad');
    return false;
  }
}
const autoNote = r => (r?.auto ? ' ' + t('toast.autoPages') : '');

const rec = () => C.record();
const cur = () => C.cur();
const lang = () => C.lang();
// the claim whose versions are open: the selected bullet, or the one an item's form shows
const fid = () => (C.ui.sel.kind === 'bullet' ? C.ui.sel.id : factOfRecordSel(rec(), C.ui.sel));
const ix = () => C.ix();
const work = () => C.work();
const usingOf = id => C.chooseVariant(work(), id, cur()).v;
const overrideOf = id => cur().overrides?.[id];
const isOn = id => { const w = T.jobOfFact(rec(), id); return !w || T.listedBullets(rec(), cur(), w.id).includes(id); };
const isKept = id => T.keepOf(cur()).includes(id);
const isArch = id => !!ix().facts.get(id)?.archived;
const jobOn = id => T.jobRefs(rec(), cur()).some(r => (typeof r === 'string' ? r : r.id) === id);
const linesOf = v => v?.metrics?.measured?.[measureKeyOf(cur())]?.lines;

const entryKeyOf = id => (['work', 'projects', 'volunteer'].find(k => (rec()[k] ?? []).some(x => x?.id === id)) ?? 'work');
function factRow(id, { section = null, owner = null } = {}){
  const L = lang();
  const miss = L !== DEFAULT_LANG && !R.versionsIn(work(), id, L).length && !isSame(rec(), sameKey(id)) && overrideOf(id) === undefined;
  const rs = recordSelOfFact(rec(), id);
  return partFactRow({ id, section, owner, miss, text: clip(C.textOfFact(id) || ix().facts.get(id)?.summary || id, 120), pill: miss ? h('edit.noLang', { code: L.toUpperCase() }) : '', pillMiss: true,
    ...(rs ? { act: 'select-record', attrs: `data-what="${esc(rs.what)}" ${rs.group ? `data-group="${esc(rs.group)}"` : ''} ${rs.key ? `data-key="${esc(rs.key)}"` : ''}` } : {}) });
}

const missingBar = () => missBar({ lang: lang(), list: lang() === DEFAULT_LANG ? [] : missingList(work(), cur()) });

// how much a section holds, for its row
function sectionCount(s){
  const sec = ix().sections.get(s.id);
  if (!sec) return '';
  if (sec.kind === 'entries'){
    const n = T.jobRefs(rec(), cur(), s.id).reduce((a, r) => a + T.listedBullets(rec(), cur(), typeof r === 'string' ? r : r.id).length, 0);
    return t('ux2.nBullets', { n });
  }
  const n = Object.values(sec.content ?? {}).flat().filter(x => typeof x === 'string' && ix().facts.has(x)).length;
  return t('ux2.nLines', { n });
}

// ---- the Highlight lens: one row, job types only; topic tags behind "+ tags" ----
function lensBox(){
  const { types, topics } = lensChoices(rec(), lang());
  if (!types.length && !topics.length) return `<div class="lens"><span class="muted small">${h('ux2.lensNone')}</span> <button class="sm ghost" data-act="lens-edit">${h('ux2.lensEdit')}</button></div>`;
  const chosen = E.focus;
  const known = types.some(x => x.tag === chosen) || topics.some(x => x.tag === chosen);
  let out = `<div class="lens"><div class="lensrow"><label for="lens" class="lbl inline"><span class="lt">${h('ux2.lens')}</span></label>
      <select id="lens"><option value="">${h('ux2.lensOff')}</option>${types.map(x => `<option value="${esc(x.tag)}" ${chosen === x.tag ? 'selected' : ''}>${esc(x.label)} (${x.n})</option>`).join('')}
        ${chosen && !known ? `<option value="${esc(chosen)}" selected>${esc(chosen)}</option>` : ''}</select>
      ${topics.length ? `<button class="sm ghost" data-act="lens-tags" aria-expanded="${E.lensTags}">${h('ux2.lensTags')}</button>` : ''}
      <button class="sm" data-act="lens-apply" aria-expanded="${E.applyOpen}" ${chosen ? '' : 'disabled'}>${h('ux2.lensApply')}</button></div>`;
  if (E.lensTags) out += `<div class="chips">${topics.slice(0, 24).map(x => `<button class="tag ${chosen === x.tag ? 'on' : ''}" data-act="focus" data-tag="${esc(x.tag)}" aria-pressed="${chosen === x.tag}">${esc(x.label)} <span class="muted">${x.n}</span></button>`).join('')}</div>`;
  if (chosen && E.applyOpen){
    const p = planTag(work(), cur(), chosen);
    out += `<div class="focusbox">${h('edit.focusPlan', { on: p.on, off: p.off, sw: p.sw })}
      <div class="btns"><button class="sm primary" data-act="focus-apply" ${p.on + p.off + p.sw ? '' : 'disabled'}>${h('edit.focusApply', { tag: jobTypeLabel(rec(), chosen) })}</button><button class="sm ghost" data-act="lens-apply">${h('btn.cancel')}</button></div></div>`;
  }
  return out + '</div>';
}

function homeView(){
  const list = T.sectionList(rec(), cur());
  const on = list.filter(s => s.on), off = list.filter(s => !s.on);
  const manual = Array.isArray(cur().pages);
  return `${C.newerBanner()}${missingBar()}
    <p class="lead">${h('edit.lead')}</p>
    ${lensBox()}
    <span class="lbl">${h('edit.sectionsHere')}</span>
    <div class="list" id="seclist">${on.map(s => `
      <div class="item srow ${s.fixed ? 'fixed' : ''}" data-sid="${esc(s.id)}" ${s.fixed ? '' : 'draggable="true"'}>
        <span class="grip" aria-hidden="true">${s.fixed ? '' : '⠿'}</span>
        <span class="stext"><a class="t" data-act="select-section" data-id="${esc(s.id)}">${esc(C.sectionTitle(s.id))}</a><span class="muted tiny">${s.fixed ? h('edit.alwaysFirst') : esc(sectionCount(s))}</span></span>
        ${s.fixed ? '' : sw(`data-secon="${esc(s.id)}" aria-label="${esc(t('edit.showX', { name: C.sectionTitle(s.id) }))}"`, true)}
      </div>`).join('')}</div>
    ${off.length ? `<p class="notonline" id="offline"><span class="muted small">${h('ux2.notOn')}</span> ${off.map(s => `<button class="tag offchip" data-act="section-on" data-id="${esc(s.id)}" draggable="true" data-sid="${esc(s.id)}" title="${esc(t('ux2.turnOnTitle'))}">${esc(C.sectionTitle(s.id))}</button>`).join(' ')}</p>` : ''}
    ${manual ? `<p class="note">${h('edit.dragManual')}</p>` : ''}`;
}

function sectionView(s){
  const sec = ix().sections.get(s.id);
  if (!sec) return homeView();
  const L = lang();
  const title = C.sectionTitle(s.id);
  const own = T.labelOf(rec(), cur(), s.id, L);
  const list = T.sectionList(rec(), cur());
  const me = list.find(x => x.id === s.id);
  const movable = list.filter(x => !x.fixed);
  const at = movable.findIndex(x => x.id === s.id);
  const isHeader = sec.kind === 'header';
  let inner = '';
  if (sec.kind === 'entries'){
    inner = `<span class="lbl">${h('edit.jobs')}</span><div class="list">${(sec.content.work ?? []).filter(id => !ix().work.get(id)?.archived || jobOn(id)).map(id => {
      const w = ix().work.get(id);
      const on = jobOn(id);
      return `<div class="item row ${on ? '' : 'is-off'}">${sw(`data-jobon="${esc(id)}" aria-label="${esc(t('edit.showX', { name: w?.name }))}"`, on)}
        <a class="t" data-act="select-job" data-id="${esc(id)}">${esc(w?.name)}<span class="muted small"> · ${esc(C.textOfFact(w?.display?.position) || w?.position)}</span></a></div>`;
    }).join('')}</div>`;
  } else if (sec.kind === 'prose'){
    const f = (s.id === 'summary' && cur().summary) || sec.content.fact;
    inner = `<span class="lbl">${h('edit.text')}</span><div class="list"><button class="item" data-act="select-bullet" data-id="${esc(f)}"><span>${esc(clip(C.textOfFact(f), 160))}</span></button></div>`;
  } else if (!isHeader){
    const ids = Object.values(sec.content ?? {}).flat().filter(x => typeof x === 'string' && ix().facts.has(x));
    inner = `<span class="lbl">${h('edit.items')}</span><div class="list">${ids.map(id => factRow(id, { section: s.id })).join('')}</div>`;
  }
  return `${crumb([{ t: t('head.resume'), act: 'deselect' }, { t: title }])}
    <h2 class="title">${esc(title)}</h2>
    ${isHeader ? '' : `<label class="field"><span class="lbl inline">${h('edit.headingHere', { lang: LANG_NAME[L] ?? L })}</span>
      <input id="sec-label" data-sid="${esc(s.id)}" value="${esc(own ?? '')}" placeholder="${esc(T.recordTitle(rec(), s.id, L))}" autocomplete="off"></label>
    ${L !== DEFAULT_LANG ? `<div class="ctlrow">${sw(`data-same="section:${esc(s.id)}"`, isSame(rec(), `section:${s.id}`), h('edit.sameHeading'))}</div>` : ''}
    <p class="muted small">${h('edit.sectionId', { id: s.id, kind: sec.kind })}${own ? ` · <a data-act="label-reset">${h('edit.resetTo', { title: T.recordTitle(rec(), s.id, L) })}</a> · <a data-act="label-all">${h('edit.labelAll')}</a>` : ''}</p>`}
    ${me && !me.fixed ? `<div class="ctlrow">${sw(`data-secon="${esc(s.id)}"`, me.on, h('edit.showHere'))}</div>
      <span class="lbl">${h('edit.position', { at: at + 1, n: movable.length })}</span>`
      : `<p class="muted small">${isHeader ? h('edit.headerFirst') : h('edit.summaryFollows')}</p>`}
    ${inner}`;
}

function jobView(s){
  const w = ix().work.get(s.id);
  if (!w) return homeView();
  const on = jobOn(s.id);
  const sid = T.sectionOfEntry(rec(), s.id);
  return `${crumb([{ t: C.sectionTitle(sid), act: 'select-section', attrs: `data-id="${esc(sid)}"` }, { t: w.name }])}
    <h2 class="title">${esc(C.textOfFact(w.display?.position) || w.position)}</h2>
    <p class="meta">${esc(C.textOfFact(w.display?.meta))}</p>
    <div class="ctlrow">${sw(`data-jobon="${esc(s.id)}"`, on, h('edit.showJob'))}</div>
    ${C.detailsHtml(s.id)}`;
}

function bulletView(s){
  const f = ix().facts.get(s.id);
  if (!f) return homeView();
  const w = s.job ? ix().work.get(s.job) : null;
  const jobId = s.job ?? s.owner;
  const jw = jobId ? ix().work.get(jobId) : null;
  const sid = jobId ? T.sectionOfEntry(rec(), jobId) : null;
  const trail = jobId ? [{ t: C.sectionTitle(sid), act: 'select-section', attrs: `data-id="${esc(sid)}"` }, { t: jw?.name ?? jobId, act: 'select-job', attrs: `data-id="${esc(jobId)}"` }, { t: clip(f.summary ?? s.id, 34) }]
    : [{ t: C.sectionTitle(s.section ?? 'summary'), act: 'select-section', attrs: `data-id="${esc(s.section ?? 'summary')}"` }, { t: clip(f.summary ?? s.id, 34) }];
  const on = isOn(s.id) && (!w || jobOn(w.id));

  return `${crumb(trail)}
    <h2 class="title" title="${esc(t('edit.claimTitle'))}">${esc(f.summary ?? s.id)}</h2>
    ${claimHead({ hasJob: !!w, on, kept: isKept(s.id), deletable: isClaim(s.id), archived: isClaim(s.id) ? isArch(s.id) : null })}`
    + versionsHtml(versionsX(s.id));
}
const isClaim = id => ix().highlight.has(id);

// the versions of a fact, under an item's form
function factPanel(id){
  if (!ix().facts.has(id)) return '';
  return versionsHtml(versionsX(id));
}

function versionsX(id){
  const L = lang();
  const using = usingOf(id);
  const ed = E.edit?.fact === id ? E.edit : null;
  const en = R.versionsIn(work(), id, DEFAULT_LANG);
  const vs = R.versionsIn(work(), id, L);
  return {
    m: work(), fact: id, lang: L,
    vs, using, over: overrideOf(id), ed,
    compare: E.compare, openMinor: E.openMinor, focus: E.focus, focusTags: E.focus ? tagsOf(rec(), E.focus) : [], focusLabel: E.focus ? jobTypeLabel(rec(), E.focus) : null,
    lines: linesOf, jobTypes: jobTypesOf(rec()).map(j => j.id), tagList: allTags(rec(), null).map(x => x.tag),
    dirty: isDirty() && !!ed && ed.draft.trim() !== '', canOnly: !!(T.jobOfFact(rec(), id) || id === cur().summary), fill: C.fillText(),
    ref: C.chooseVariant(work(), id, { ...cur(), lang: DEFAULT_LANG }).v ?? en[0],
  };
}

function startEdit(mode = null, vid = null){
  const id = fid();
  if (!id) return;
  const L = lang();
  const over = overrideOf(id);
  const using = usingOf(id);
  if (!using && over === undefined) return;
  if (over === undefined && (using.lang ?? DEFAULT_LANG) !== L){ $('#ed-new')?.focus(); return; }     // no version in this language: write one
  const m = mode ?? (over !== undefined ? 'only' : 'edit');
  const text = m === 'only' ? over : using.text;
  const lines0 = C.sheet.linesOf(ix(), id);
  E.edit = { fact: id, mode: m, vid: using?.id ?? null, base: m === 'new' ? using.text : text, draft: text, lines0, lines: lines0 };
  if (m === 'new') E.edit.base = '';     // anything typed (or the copy) can be saved, if it differs from every version
  if (m === 'new') E.edit.copyOf = using.text;
  E.compare = null;
  C.endHover();
  C.renderBody();
  focusEditor(m === 'new');
}
function focusEditor(selectAll = false){
  const ta = $('#ed');
  if (!ta) return;
  autosize(ta);
  ta.focus();
  if (selectAll) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
}
const autosize = ta => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };

export function isDirty(){
  const ed = E.edit;
  if (!ed) return false;
  return ed.mode === 'new' ? ed.draft.trim() !== (ed.copyOf ?? '').trim() : ed.draft.trim() !== ed.base.trim();
}

async function cancelEdit({ ask = false } = {}){
  if (!E.edit) return true;
  if (ask && isDirty() && !confirm(t('confirm.discard'))) return false;
  E.edit = null;
  clearTimeout(E.timer);
  await C.endPreview(true);
  C.renderBody();
  return true;
}

function onEditorInput(ta){
  const ed = E.edit;
  if (!ed) return;
  ed.draft = ta.value;
  autosize(ta);
  const changed = ed.mode === 'new' ? ed.draft.trim() && ed.draft.trim() !== (ed.copyOf ?? '').trim() : ed.draft.trim() && ed.draft.trim() !== ed.base.trim();
  for (const b of document.querySelectorAll('.editor [data-act^=ed-]:not([data-act=ed-cancel])'))
    b.disabled = b.dataset.act === 'ed-promote' ? !ed.draft.trim() : !changed;
  clearTimeout(E.timer);
  E.timer = setTimeout(livePreview, 140);
}

// The page redraws with the draft as it will look once saved: a copy of the record with the
// edit applied (so marks move with their words), or the one-off text for "this resume only".
async function livePreview(){
  const ed = E.edit;
  if (!ed || !ed.draft.trim()) return;
  const text = ed.draft.trim();
  const w = structuredClone(work());
  const r = structuredClone(cur());
  try {
    if (ed.mode === 'edit') R.saveOver(w, ed.vid, text);
    else if (ed.mode === 'new'){ const nv = R.addVersion(w, ed.fact, { text, from: ed.vid, as: 'major', lang: lang() }); r.picks = { ...(r.picks ?? {}), [ed.fact]: nv.id }; }
    else r.overrides = { ...(r.overrides ?? {}), [ed.fact]: text };
  } catch { return; }
  await C.previewRecipe(r, ed.fact, w);
  if (E.edit !== ed) return;
  ed.lines = C.sheet.linesOf(C.indexOf(w), ed.fact);
  const st = $('#ed-stats');
  if (st) st.innerHTML = statsHtml(ed, C.fillText());
}

function saveEdit(kind){
  const ed = E.edit;
  if (!ed) return;
  const text = ed.draft.trim();
  if (!text) return C.toast(t('toast.writeFirst'), 'warn');
  const f = ed.fact;
  const v = ed.vid ? ix().variants.get(ed.vid) : null;
  const resume = true;
  E.edit = null;
  clearTimeout(E.timer);
  C.ui.previewing = false;
  if (kind === 'over') commit(d => { R.saveOver(d.record, ed.vid, text); }, t('undo.saveV', { v: v.n }), t('toast.savedV', { v: v.n }));
  else if (kind === 'as' || kind === 'promote'){
    let n;
    commit(d => {
      const nv = R.addVersion(d.record, f, { text, from: ed.vid, as: 'minor', lang: lang() });
      n = nv.n;
      if (resume) d.cur.picks = { ...(d.cur.picks ?? {}), [f]: nv.id };
      if (kind === 'promote') T.setOverride(d.cur, f, null);
      E.openMinor.add(`${f}:${lang()}:${R.major(nv.n)}`);
    }, t('undo.saveAsNew'), null);
    if (n) C.toast(t('toast.savedAsV', { v: n }));
  } else if (kind === 'new'){
    let n;
    commit(d => {
      const nv = R.addVersion(d.record, f, { text, from: ed.vid, as: 'major', lang: lang() });
      n = nv.n;
      if (resume) d.cur.picks = { ...(d.cur.picks ?? {}), [f]: nv.id };
    }, t('undo.writeNew'), null);
    if (n) C.toast(t('toast.savedNewV', { v: n }));
  } else if (kind === 'only'){
    commit(d => { T.setOverride(d.cur, f, text); if (T.jobOfFact(d.record, f) && !T.listedBullets(d.record, d.cur, T.jobOfFact(d.record, f).id).includes(f)) T.setBulletOn(d.record, d.cur, f, true); },
      t('edit.thisOnly'), t('toast.changedOnlyHere'));
  }
  if (!resume) C.renderBody();     // closes the editor even when nothing changed
}

async function act(a, tg){
  const s = { id: fid() }, sel = C.ui.sel;     // s: the claim open; sel: what the Resume has selected (a section, for the cases below)
  switch (a){
    case 'edit': startEdit(null, tg?.dataset?.v ?? null); return true;
    case 'new-version': startEdit('new'); return true;
    case 'ed-cancel': cancelEdit(); return true;
    case 'ed-save': saveEdit('over'); return true;
    case 'ed-saveas': saveEdit('as'); return true;
    case 'ed-only': saveEdit('only'); return true;
    case 'ed-new': saveEdit('new'); return true;
    case 'ed-promote': saveEdit('promote'); return true;
    case 'only-remove': commit(d => T.setOverride(d.cur, s.id, null), t('edit.backToSaved'), t('toast.backToSaved')); return true;
    case 'unfold': E.openMinor.add(`${s.id}:${lang()}:${tg.dataset.m}`); C.renderBody(); return true;
    case 'compare': E.compare = E.compare === tg.dataset.v ? null : tg.dataset.v; C.renderBody(); return true;
    case 'compare-close': E.compare = null; C.renderBody(); return true;
    case 'delete-version': {
      const v = ix().variants.get(tg.dataset.v);
      if (!v) return true;
      if (E.compare === v.id) E.compare = null;
      C.endHover();
      commit(d => { R.deleteVersion(d.record, v.id, [d.cur, ...(d.resumes ?? [])]); }, t('edit.deleteV', { v: v.n }), t('toast.deletedV', { v: v.n }));
      return true;
    }
    case 'keep': {
      const on = !isKept(s.id);
      commit(d => T.setKeep(d.record, d.cur, s.id, on), on ? t('edit.keep') : t('undo.release'), on ? t('toast.kept') : t('toast.released'));
      return true;
    }
    case 'delete-claim': {
      const id = s.id, name = ix().facts.get(id)?.summary ?? id;
      if (!id || !isClaim(id)) return true;
      const job = ix().highlight.get(id);
      let res;
      E.edit = null; E.compare = null; clearTimeout(E.timer);
      C.endHover();
      commit(d => { res = K.deleteClaim(d.record, id, [d.cur, ...(d.resumes ?? [])]); }, t('undo.deleteClaim'));
      if (res){
        C.toast(t('career.deletedClaim', { name, n: res.versions }));
        C.select(job ? { kind: 'job', id: job } : { kind: 'none' });
      }
      return true;
    }
    case 'archive-claim': {
      const id = s.id, job = ix().highlight.get(id);
      if (!id || !isClaim(id)) return true;
      let res;
      E.edit = null; E.compare = null; clearTimeout(E.timer);
      C.endHover();
      commit(d => { res = K.archiveClaim(d.record, id); }, t('arch.undoArchive'));
      if (res?.changed){
        C.toast(t('arch.archived'));
        C.select(job ? { kind: 'job', id: job } : { kind: 'none' });
      }
      return true;
    }
    case 'unarchive-claim': {
      const id = tg?.dataset?.id ?? s.id;
      if (!id) return true;
      let res;
      commit(d => { res = K.unarchiveClaim(d.record, id); }, t('arch.undoUnarchive'), t('arch.unarchived'));
      if (res?.changed) C.renderBody();
      return true;
    }
    case 'add-claim': {
      const ta = $('#new-claim'), text = ta?.value.trim();
      if (!text){ C.toast(t('career.writeClaimFirst'), 'warn'); ta?.focus(); return true; }
      const entry = tg.dataset.id;
      commit(d => {
        const made = K.addEntryClaim(d.record, entry, text, lang());
        if (made && T.jobRefs(d.record, d.cur).some(r => (typeof r === 'string' ? r : r.id) === entry)) T.setBulletOn(d.record, d.cur, made, true);     // the entry is on: so is its new line
      }, t('undo.addClaim'), t('career.claimAdded'));
      E.claimDraft = '';
      C.renderBody();
      setTimeout(() => $('#new-claim')?.focus(), 30);
      return true;
    }
    case 'write-in': {
      const ta = $('#ed-new'), text = ta?.value.trim();
      if (!text){ C.toast(t('toast.writeItFirst'), 'warn'); ta?.focus(); return true; }
      const L = lang(), id = s.id;
      let n;
      commit(d => { const v = writeIn(d.record, id, L, text, ta.dataset.from || null); n = v.n; d.cur.picks = { ...(d.cur.picks ?? {}), [id]: v.id }; }, t('undo.writeIn', { lang: LANG_NAME[L] }));
      if (n) C.toast(t('toast.langVSaved', { lang: LANG_NAME[L], v: n }));
      return true;
    }
    case 'go-missing': {
      const k = tg.dataset.kind, id = tg.dataset.id;
      if (k === 'heading') C.select({ kind: 'section', id });
      else { const job = T.jobOfFact(rec(), id); C.select(job ? { kind: 'bullet', id, job: job.id, section: 'experience' } : { kind: 'bullet', id, section: tg.dataset.section ?? 'summary', owner: tg.dataset.owner ?? undefined }); }
      return true;
    }
    case 'focus': E.focus = E.focus === tg.dataset.tag ? null : tg.dataset.tag; E.applyOpen = false; C.setFocus(); C.renderBody(); return true;
    case 'focus-clear': E.focus = null; E.applyOpen = false; C.setFocus(); C.renderBody(); return true;
    case 'lens-tags': E.lensTags = !E.lensTags; C.renderBody(); return true;
    case 'lens-apply': E.applyOpen = !E.applyOpen && !!E.focus; C.renderBody(); return true;
    case 'lens-edit': C.select({ kind: 'record', what: 'jobtypes' }); return true;
    case 'section-on': setSection(tg.dataset.id, true); return true;
    case 'focus-apply': {
      const F = E.focus;
      let p;
      commit(d => { p = applyTag(d.record, d.cur, F); }, t('undo.selectFor', { tag: jobTypeLabel(rec(), F) }));
      E.applyOpen = false;
      if (p) C.toast(t('toast.selectedFor', { tag: jobTypeLabel(rec(), F), on: p.on, off: p.off, sw: p.sw }));
      return true;
    }
    case 'tag-rm': {
      const vid = tg.dataset.v, tag = tg.dataset.tag;
      commit(d => { const v = d.record.variants.find(x => x.id === vid); if (v) v.tags = (v.tags ?? []).filter(x => x !== tag); }, t('undo.removeTag'));
      return true;
    }
    case 'label-reset': commit(d => T.setSectionLabel(d.record, d.cur, sel.id, lang(), null), t('undo.resetHeading')); return true;
    case 'label-all': commit(d => T.useLabelEverywhere(d.record, d.cur, sel.id, lang()), t('undo.headingAll'), t('toast.headingAll')); return true;
  }
  return false;
}

function setSection(id, on){
  let r;
  commit(d => { r = T.setSectionOn(d.record, d.cur, id, on); }, on ? t('undo.showSection') : t('undo.hideSection'));
  if (on) C.flash(id);
  if (r?.auto) C.toast(autoNote(r).trim());
}

const tr = (k, p) => t(k, p);     // t(), inside handlers where `t` is the event target
function bind(body){
  body.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.secon) setSection(t.dataset.secon, t.checked);
    else if (t.dataset.jobon){ const id = t.dataset.jobon, on = t.checked; commit(d => T.setJobOn(d.record, d.cur, id, on), on ? tr('undo.showJob') : tr('undo.hideJob')); }
    else if (t.dataset.on){ const id = t.dataset.on, on = t.checked; setBullet(id, on); }
    else if (t.id === 'b-on') setBullet(C.ui.sel.id, t.checked);
    else if (t.id === 'lens'){ E.focus = t.value || null; E.applyOpen = false; C.setFocus(); C.renderBody(); }
    else if (t.dataset.same){ const k = t.dataset.same, on = t.checked; commit(d => setSame(d.record, k, on), on ? tr('edit.sameEvery') : tr('undo.notSame')); }
  });
  body.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'ed') onEditorInput(t);
    if (t.id === 'new-claim') E.claimDraft = t.value;
  });
  // the heading box commits on blur (Enter blurs it), as one undo step
  body.addEventListener('keydown', e => {
    const t = e.target;
    if (t.classList?.contains('tag-in') && e.key === 'Escape'){ E.tagFocus = null; t.blur(); return; }
    if (t.classList?.contains('tag-in') && e.key === 'Enter'){
      e.preventDefault();
      const tag = t.value.trim(), vid = t.dataset.vid;
      if (!tag) return;
      commit(d => { const v = d.record.variants.find(x => x.id === vid); if (v && !(v.tags ?? []).includes(tag)) v.tags = [...(v.tags ?? []), tag]; }, tr('undo.addTag'));
      return;
    }
    if (t.id === 'new-claim' && e.key === 'Enter' && !e.shiftKey && !e.isComposing){ e.preventDefault(); body.querySelector('[data-act=add-claim]')?.click(); }
    if (t.id === 'sec-label' && e.key === 'Enter'){ e.preventDefault(); t.blur(); }
    if (t.id === 'sec-label' && e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); t.value = T.labelOf(rec(), cur(), t.dataset.sid, lang()) ?? ''; t.blur(); }
    if (t.id === 'ed'){
      if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); cancelEdit({ ask: true }); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){
        e.preventDefault();
        const ed = E.edit;
        if (ed && (isDirty() || ed.mode === 'only')) saveEdit(ed.mode === 'edit' ? 'over' : ed.mode === 'new' ? 'new' : 'only');
      }
    }
  });
  body.addEventListener('focusin', e => { if (e.target.classList?.contains('tag-in')) E.tagFocus = e.target.dataset.vid; });
  document.addEventListener('mousedown', e => { if (!e.target.closest?.('.tag-in')) E.tagFocus = null; }, true);
  body.addEventListener('focusout', e => {
    const t = e.target;
    if (t.classList?.contains('tag-in') && e.relatedTarget) E.tagFocus = null;     // moved on, not redrawn
    if (t.id !== 'sec-label') return;
    rename(t.dataset.sid, t.value);
  });

  body.addEventListener('dragstart', e => {
    const r = e.target.closest?.('.srow[draggable=true], .offchip[draggable=true]');
    if (!r) return;
    E.drag = r.dataset.sid;
    E.dragOff = r.classList.contains('offchip');
    r.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', E.drag);
  });
  body.addEventListener('dragover', e => {
    const r = e.target.closest?.('.srow:not(.fixed)');
    if (E.drag && E.dragOff && e.target.closest?.('#seclist')){ e.preventDefault(); if (!r) return; }
    if (!r || !E.drag) return;
    e.preventDefault();
    for (const n of body.querySelectorAll('.drop-above, .drop-below')) n.classList.remove('drop-above', 'drop-below');
    const bb = r.getBoundingClientRect();
    r.classList.add(e.clientY < bb.top + bb.height / 2 ? 'drop-above' : 'drop-below');
  });
  body.addEventListener('drop', e => {
    const r = e.target.closest?.('.srow:not(.fixed)');
    const id = E.drag, fromOff = E.dragOff;
    E.drag = null; E.dragOff = false;
    if (!id) return;
    // a section dragged up from "Not on this resume" turns on where it lands (last, when dropped on the list itself)
    if (fromOff && !r && e.target.closest?.('#seclist')){ e.preventDefault(); setSection(id, true); return; }
    if (!r) return;
    e.preventDefault();
    const below = r.classList.contains('drop-below');
    const ids = T.sectionList(rec(), cur()).filter(x => !x.fixed && x.on).map(x => x.id).filter(x => x !== id);
    const at = ids.indexOf(r.dataset.sid) + (below ? 1 : 0);
    const before = ids[at] ?? null;
    if (r.dataset.sid === id) return;
    let res;
    commit(d => { if (fromOff) T.setSectionOn(d.record, d.cur, id, true); res = T.moveSection(d.record, d.cur, id, before); }, fromOff ? tr('undo.showSection') : tr('undo.moveSection'));
    C.flash(id);
    if (res?.auto) C.toast(autoNote(res).trim());
  });
  body.addEventListener('dragend', () => {
    E.drag = null; E.dragOff = false;
    for (const n of body.querySelectorAll('.dragging, .drop-above, .drop-below')) n.classList.remove('dragging', 'drop-above', 'drop-below');
  });
}

function setBullet(id, on){
  commit(d => T.setBulletOn(d.record, d.cur, id, on), on ? t('undo.turnOn') : t('undo.turnOff'));
}

function rename(id, value){
  const L = lang();
  const txt = String(value ?? '').trim();
  const now = T.labelOf(rec(), cur(), id, L) ?? '';
  const same = !txt || txt === T.recordTitle(rec(), id, L);
  if ((same && !now) || txt === now) return;
  commit(d => T.setSectionLabel(d.record, d.cur, id, L, same ? null : txt), t('undo.renameSection'),
    same ? t('toast.headingReset') : t('toast.renamedHere', { lang: LANG_NAME[L] ?? L, id }));
}

// Alt+↑ / Alt+↓ move the selected section.
function moveSelected(d){
  const sel = C.ui.sel;
  if (sel.kind !== 'section') return false;
  let r;
  commit(x => { r = T.stepSection(x.record, x.cur, sel.id, d); }, t('undo.moveSection'));
  if (r?.moved){ C.flash(sel.id); if (r.auto) C.toast(autoNote(r).trim()); }
  return true;
}

function key(e){
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && C.ui.sel.kind === 'section'){
    e.preventDefault(); return moveSelected(e.key === 'ArrowDown' ? 1 : -1);
  }
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && C.ui.sel.kind === 'bullet' && !E.edit && document.body.dataset.phone !== 'true'){ e.preventDefault(); startEdit(); return true; }
  return false;
}

// Leaving a bullet with a typed draft asks first. Synchronous: the shell's
// select() ends any preview itself.
function leaving(next){
  if (!E.edit) return true;
  if (next?.kind === 'bullet' && next.id === E.edit.fact) return true;
  if (isDirty() && !confirm(t('confirm.discard'))) return false;
  E.edit = null; E.compare = null;
  clearTimeout(E.timer);
  return true;
}

const api = {
  homeView, sectionView, jobView, bulletView, factPanel, act, bind, key, leaving, rename, startEdit, cancelEdit, isDirty,
  get editing(){ return E.edit; },
  get claimDraft(){ return E.claimDraft; },
  afterRender(){
    if (E.edit && $('#ed') && document.activeElement?.id !== 'ed') focusEditor(); else if ($('#ed')) autosize($('#ed'));
    // the tag box keeps focus across the redraw a new tag causes
    const ti = E.tagFocus && document.querySelector(`.tag-in[data-vid="${CSS.escape(E.tagFocus)}"]`);
    if (ti && document.activeElement !== ti) ti.focus();
  },
  get focus(){ return E.focus; },
  focusHits(){ return E.focus ? tagHits(work(), E.focus, lang()) : null; },
};
