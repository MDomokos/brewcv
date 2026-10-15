// The Edit view: what the body card shows for the resume, a section, a job and a bullet, and what its
// controls do. One panel for a claim wherever you came from: the page, the record checklist below it, or
// the timeline. Every change is one store commit, so one undo step. Typing is not a change until it is saved.

import * as R from '../model/record.js';
import * as T from '../model/resume.js';
import { key as measureKeyOf } from '../fit.js';
import { tagVocab, planTag, applyTag, tagHits, jobTypesOf, jobTypeLabel, tagsOf, lensChoices } from '../model/focus.js';
import { missingList, isSame, setSame, sameKey, langName, writeIn, DEFAULT_LANG } from '../model/lang.js';
import * as K from '../model/career.js';
import { recordSelOfFact, factOfRecordSel } from '../model/checklist.js';
import { t, h, errText } from '../i18n/index.js';
import { play } from './motion.js';
import { esc, clip, depthHtml as depthMarkup, sw, missBar, versionsHtml, statsHtml, claimHead } from './parts.js';

let C = null;
export function initEdit(ctx){ C = ctx; return api; }

const $ = s => document.querySelector(s);
const LANG_NAME = new Proxy({}, { get: (_, l) => langName(l) });

// the editor and the panel's own view state; none of it is undone
const E = { enter: null, edit: null, compare: null, openMinor: new Set(), timer: null, drag: null, focus: null, claimDrafts: new Map(), applyOpen: false, dragItem: null, dragBullet: null, dragJob: null };

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
// the editor is closed: the line on the page stops being written. `keep`: what was typed stays on this resume (E1)
function clearEdit(keep = true){
  const was = E.edit;
  E.edit = null;
  clearTimeout(E.timer);
  if (was && !was.panel){ const live = C.onpage?.text(); if (live?.trim()) was.draft = live; C.onpage?.end(); }      // a composition not yet ended is not in the draft
  if (was && keep && T.isLocal(cur(), was.fact) && !was.draft.trim()) dropLine(was.fact);
  else if (was && keep) keepEdit(was);
}
// A line only on this resume that is left empty is not kept (an empty bullet holds nothing, and undo brings it back). The job is selected.
function dropLine(fact){
  const job = ix().highlight.get(fact);
  if (C.ui.sel.kind === 'bullet' && C.ui.sel.id === fact && job) C.ui.sel = { kind: 'job', id: job };      // Esc goes up to the job, not to the page
  const had = !!cur().overrides?.[fact];      // a line you wrote and emptied is a delete: say so, and Ctrl+Z brings it back
  commit(d => T.removeLocalLine(d.cur, fact), t('ux6c.undoRemoveLine'), had ? `${t('ux6c.lineRemoved')} ${t('toast.ctrlZUndoes')}` : undefined);
}
// Leaving a line keeps what was typed on this resume, and nothing asks: one override with the highlights it keeps and the version it
// was written from. The words of that version again drop the override.
function keepEdit(ed){
  if (!isDirty(ed) || !ed.draft.trim()) return;      // an emptied line keeps what it had: the last kept edit, or the version's words
  const text = ed.draft.trim(), base = ix().variants.get(ed.vid);
  C.ui.previewing = false;
  commit(d => {
    if (text !== base?.text.trim()) return T.setOverride(d.cur, ed.fact, text, { marks: marksFor(ed, text), base: base?.id ?? null });
    T.dropOverride(d.cur, ed.fact);
    if (base && usingOf(ed.fact)?.id !== base.id) T.pickVersion(d.cur, ed.fact, base.id);
  }, t('edit.thisOnly'));
}
// the highlights of the text the line started from, moved onto what was typed (a mark whose words are gone is dropped)
const marksFor = (ed, text) => { const from = ed.mode === 'new' ? ed.copyOf : ed.base; return R.reanchor(ed.marks, from, text, m => m.expect ?? [...from].slice(m.start, m.end).join('')); };
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
const isOn = id => { const w = T.jobOfFact(rec(), id, cur()); return !w || T.listedBullets(rec(), cur(), w.id).includes(id); };
const isKept = id => T.keepOf(cur()).includes(id);
const isArch = id => !!ix().facts.get(id)?.archived;
const jobOn = id => T.jobRefs(rec(), cur()).some(r => (typeof r === 'string' ? r : r.id) === id);
const linesOf = v => v?.metrics?.measured?.[measureKeyOf(cur())]?.lines;

const entryKeyOf = id => (['work', 'projects', 'volunteer'].find(k => (rec()[k] ?? []).some(x => x?.id === id)) ?? 'work');
const missingBar = () => missBar({ lang: lang(), list: lang() === DEFAULT_LANG ? [] : missingList(work(), cur()) });

// ---- the Highlight lens: one list of tags, job types (bundles of tags) first ----
function lensBox(){
  const { types, tags } = lensChoices(rec(), lang());
  if (!types.length && !tags.length) return `<div class="lens"><span class="muted small">${h('ux2.lensNone')}</span> <button class="sm ghost" data-act="lens-edit">${h('ux2.lensEdit')}</button></div>`;
  const chosen = E.focus;
  const known = types.some(x => x.tag === chosen) || tags.some(x => x.tag === chosen);
  const opt = x => `<option value="${esc(x.tag)}" ${chosen === x.tag ? 'selected' : ''}>${esc(x.label)} (${x.n})</option>`;
  let out = `<div class="lens"><div class="lensrow"><label for="lens" class="lbl inline"><span class="lt">${h('ux3b.lens')}</span></label>
      <select id="lens"><option value="">${h('ux2.lensOff')}</option>
        ${types.length ? `<optgroup label="${esc(t('ux2.lensTypes'))}">${types.map(opt).join('')}</optgroup>` : ''}
        ${tags.length ? `<optgroup label="${esc(t('ux2.lensTagsGroup'))}">${tags.map(opt).join('')}</optgroup>` : ''}
        ${chosen && !known ? `<option value="${esc(chosen)}" selected>${esc(chosen)}</option>` : ''}</select>
      <button class="sm" data-act="lens-apply" aria-expanded="${E.applyOpen}" ${chosen ? '' : 'disabled'}>${h('ux3b.lensApply')}</button></div>`;
  if (chosen && E.applyOpen){
    const p = planTag(work(), cur(), chosen);
    out += `<div class="focusbox">${h('edit.focusPlan', { on: p.on, off: p.off, sw: p.sw })}
      <div class="btns"><button class="sm primary" data-act="focus-apply" ${p.on + p.off + p.sw ? '' : 'disabled'}>${h('edit.focusApply', { tag: jobTypeLabel(rec(), chosen) })}</button><button class="sm ghost" data-act="lens-apply">${h('btn.cancel')}</button></div></div>`;
  }
  return out + '</div>';
}

// The Outline: this resume in print order. The Highlight lens at its head, then the sections (checklist.js outlineHtml), and the way
// Fit works at the foot.
function outlineView(){
  return `${C.newerBanner()}${missingBar()}
    ${lensBox()}
    ${C.outlineHtml()}
    <p class="muted tiny outfoot">${h('ux5c.outlineFoot')}</p>`;
}
// Edit with nothing selected: what this resume is for, and one line on how to pick a line
function noneView(){
  const r = cur(), type = r.jobType ? jobTypeLabel(rec(), r.jobType) : '';
  return `${C.newerBanner()}${missingBar()}
    <h2 class="title">${esc(C.resumeName(r))}</h2>
    ${type ? `<p class="meta">${esc(type)}</p>` : ''}
    <p class="lead edithint">${h('ux5c.editNone')}</p>`;
}

// what a line is called in the depth chip and the card: its summary, else its words; a new empty line only on this resume is "New line"
const lineName = id => ix().facts.get(id)?.summary || C.textOfFact(id) || (T.isLocal(cur(), id) ? t('ux6c.newLine') : id);

// One depth indicator (UX-6c): the levels of what is selected, from the page down. The chip on the page and the row at the top of
// the editor card both draw it, from parts.js depthHtml. The sidebar's row names the specific content (full job and line names); the
// page's chip is general and in single words (Page › Experience › Hydra, Page › Skills › CAD, no line level).
function depth(sel = C.ui.sel, page = false){
  const L = [{ word: t('ux3.crumbPage'), act: 'deselect' }];
  const at = id => `data-id="${esc(id)}"`;
  const jobId = sel.kind === 'job' ? sel.id : sel.kind === 'bullet' ? sel.job ?? sel.owner : null;
  const item = sel.kind === 'record' && sel.what === 'item';       // a skill group, a language: an item of a list section
  const sid = sel.kind === 'section' ? sel.id : sel.kind === 'bullet' ? sel.section ?? 'summary' : jobId ? T.sectionOfEntry(rec(), jobId) : item ? T.sectionOfItem(rec(), sel.id) : null;
  const word = s => clip(String(s ?? '').trim().split(/\s+/)[0], 12);
  if (page){
    if (sel.kind === 'header' || sid === 'header') L.push({ word: t('ux6c.header'), act: 'select-header' });
    else if (sid) L.push({ word: word(C.sectionTitle(sid)), act: 'select-section', attrs: at(sid) });
    if (jobId) L.push({ word: word(ix().work.get(jobId)?.name ?? jobId), act: 'select-job', attrs: at(jobId) });
    else if (item) L.push({ word: word(ix().facts.get(sel.id)?.summary || C.textOfFact(sel.id) || sel.id), act: 'select-record', attrs: `${at(sel.id)} data-what="item" data-group="${esc(sel.group ?? '')}"` });
    else if (sel.kind === 'bullet' && sid !== 'header' && sid !== 'summary') L.push({ word: word(lineName(sel.id)), act: 'select-fact', attrs: `${at(sel.id)} data-section="${esc(sid ?? '')}"${sel.owner ? ` data-owner="${esc(sel.owner)}"` : ''}` });
    return L;
  }
  if (jobId) L.push({ word: t('ux3.crumbJob'), name: ix().work.get(jobId)?.name ?? jobId, act: 'select-job', attrs: at(jobId) });
  else if (sel.kind === 'header' || sid === 'header') L.push({ word: t('ux6c.header'), act: 'select-header' });
  else if (sid) L.push({ word: t('ux6c.section'), name: C.sectionTitle(sid), act: 'select-section', attrs: at(sid) });
  if (sel.kind === 'bullet') L.push({ word: jobId ? t('ux3.crumbLine') : t('ux6c.item'), name: T.isLocal(cur(), sel.id) ? lineName(sel.id) : ix().facts.get(sel.id)?.summary ?? sel.id,
    act: 'select-fact', attrs: `${at(sel.id)} data-section="${esc(sid ?? '')}"${sel.owner ? ` data-owner="${esc(sel.owner)}"` : ''}` });
  return L;
}
const depthHtml = (sel = C.ui.sel, { page = false } = {}) => depthMarkup(depth(sel, page), { small: page });

function sectionView(s){
  const sec = ix().sections.get(s.id);
  if (!sec) return noneView();
  const L = lang();
  const title = C.sectionTitle(s.id);
  const own = T.labelOf(rec(), cur(), s.id, L);
  const list = T.sectionList(rec(), cur());
  const me = list.find(x => x.id === s.id);
  const movable = list.filter(x => !x.fixed);
  const at = movable.findIndex(x => x.id === s.id);
  const isHeader = sec.kind === 'header';
  // its own list: the jobs or the items, each with a tick, a grip and ↑ ↓ (the Outline's rows)
  const inner = isHeader ? '' : C.outlineHtml(null, s.id);
  return `${depthHtml(s)}
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

// `details: false`: the shell puts the job's own lines before the Details fold (src/ui/shell.js jobTail)
function jobView(s, { details = true } = {}){
  const w = ix().work.get(s.id);
  if (!w) return noneView();
  const on = jobOn(s.id);
  const sid = T.sectionOfEntry(rec(), s.id);
  return `${depthHtml(s)}
    <h2 class="title">${esc(C.textOfFact(w.display?.position) || w.position)}</h2>
    <p class="meta">${esc(C.textOfFact(w.display?.meta))}</p>
    <div class="ctlrow">${sw(`data-jobon="${esc(s.id)}"`, on, h('edit.showJob'))}</div>${details ? `\n    ${C.detailsHtml(s.id)}` : ''}`;
}

function bulletView(s){
  const f = ix().facts.get(s.id);
  if (!f) return noneView();
  const w = s.job ? ix().work.get(s.job) : null;
  const on = isOn(s.id) && (!w || jobOn(w.id));
  // a line that exists only on this resume has no versions: what it is, the tick, and the way to remove it
  if (T.isLocal(cur(), s.id)) return `${depthHtml(s)}
    <h2 class="title">${esc(clip(lineName(s.id), 80))}</h2>
    <div class="ctlrow">${sw('id="b-on"', on, h('edit.onThis'))}</div>
    <p class="note">${h('ux6c.localNote')}</p>
    ${document.body.dataset.phone === 'true' ? versionsHtml(versionsX(s.id)) : ''}
    <div class="ctlrow"><button class="sm" data-act="local-remove">${h('ux6c.removeLine')}</button></div>`;

  return `${depthHtml(s)}
    <h2 class="title" title="${esc(t('edit.claimTitle'))}">${esc(f.summary ?? s.id)}</h2>
    ${claimHead({ hasJob: !!w, on, kept: isKept(s.id), deletable: isClaim(s.id), archived: isClaim(s.id) ? isArch(s.id) : null })}`
    + versionsHtml(versionsX(s.id));
}
const isClaim = id => ix().highlight.has(id) && !T.isLocal(cur(), id);

// the versions of a fact, under an item's form
function factPanel(id){
  if (!ix().facts.has(id)) return '';
  return versionsHtml(versionsX(id));
}

function versionsX(id){
  const L = lang();
  const using = usingOf(id);
  const ed = E.edit?.fact === id && E.edit.panel ? E.edit : null;       // the panel's own editor: only for a line that is not on the page
  const writing = E.edit?.fact === id && !E.edit.panel;
  const en = R.versionsIn(work(), id, DEFAULT_LANG);
  const vs = R.versionsIn(work(), id, L);
  return {
    m: work(), fact: id, lang: L, full: document.body.dataset.phone !== 'true',     // every version in full, with what differs marked (the phone's sheet keeps the gist)
    vs, using, over: overrideOf(id), parked: cur().parked?.[id]?.text, ed, writing,
    compare: E.compare, openMinor: E.openMinor, focus: E.focus, focusTags: E.focus ? tagsOf(rec(), E.focus) : [], focusLabel: E.focus ? jobTypeLabel(rec(), E.focus) : null,
    lines: linesOf, jobTypes: jobTypesOf(rec()).map(j => j.id), tagList: tagVocab(rec()),
    dirty: isDirty() && !!ed && ed.draft.trim() !== '', canOnly: !!(T.jobOfFact(rec(), id, cur()) || id === cur().summary), fill: C.fillText(),
    ref: C.chooseVariant(work(), id, { ...cur(), lang: DEFAULT_LANG }).v ?? en[0],
  };
}

// A new empty line only on this resume, after `afterId` (the job's last line when none is given), written at once on the page.
// The line being written is kept first. The page is drawn again before the new line is looked for on it.
async function addLine(jobId, afterId = undefined){
  if (!ix().work.has(jobId) || !jobOn(jobId)) return false;
  const after = afterId === undefined ? T.listedBullets(rec(), cur(), jobId).at(-1) ?? null : afterId;
  clearEdit();
  let id;
  commit(d => { id = T.addLocalLine(d.record, d.cur, jobId, after); }, t('ux6c.undoAddLine'));
  if (!id) return false;
  C.work();
  await C.redrawNow?.();
  C.select({ kind: 'bullet', id, job: jobId, section: 'experience' });
  if (C.ui.sel.id === id && document.body.dataset.phone !== 'true') startEdit();
  return true;
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
  const meta = m === 'only' ? cur().overrideMeta?.[id] : null;       // an edit already on this resume: its highlights and the version it came from
  E.edit = { fact: id, mode: m, vid: meta?.base ?? using?.id ?? null, marks: (meta ? meta.marks : using?.marks) ?? [], base: m === 'new' ? using.text : text, draft: text, lines0, lines: lines0 };
  if (m === 'new') E.edit.base = '';     // anything typed (or the copy) can be saved, if it differs from every version
  if (m === 'new') E.edit.copyOf = using.text;
  E.compare = null;
  C.endHover();
  // a line that is on the page is written there; one that is not (a claim off this resume) keeps the panel's text box
  E.edit.panel = !C.onpage?.begin();
  C.renderBody();
  if (E.edit.panel) focusEditor(m === 'new');
}
function focusEditor(selectAll = false){
  const ta = $('#ed');
  if (!ta) return;
  autosize(ta);
  ta.focus();
  if (selectAll) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
}
const autosize = ta => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };

export function isDirty(ed = E.edit){
  if (!ed) return false;
  return ed.mode === 'new' ? ed.draft.trim() !== (ed.copyOf ?? '').trim() : ed.draft.trim() !== ed.base.trim();
}

// Esc and the like: what was typed is kept on this resume. `discard`: only the panel's own Cancel button drops it
async function cancelEdit({ discard = false } = {}){
  if (!E.edit) return true;
  const fact = E.edit.fact;
  clearEdit(!discard);
  if (discard && T.isLocal(cur(), fact) && !cur().overrides?.[fact]) dropLine(fact);
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

// the line on the page was typed in: the same bookkeeping as the text box, from the plain text of the line
function draftChanged(text){
  const ed = E.edit;
  if (!ed) return;
  ed.draft = text;
  clearTimeout(E.timer);
  E.timer = setTimeout(livePreview, 140);
  C.onpage?.refresh();
}
// A version picked while writing: what was typed is kept first, so the pick sets it aside (parks it) and the line goes on from the
// version's words
function pickWhileWriting(vid){
  const ed = E.edit, v = ix().variants.get(vid);
  if (!ed || !v) return false;
  clearTimeout(E.timer);
  keepEdit(ed);
  commit(d => T.pickVersion(d.cur, ed.fact, vid), t('undo.useVersion', { n: v.n }));
  Object.assign(ed, { vid, mode: 'edit', base: v.text, draft: v.text, copyOf: v.text, marks: v.marks ?? [] });
  C.onpage?.setText(v.text);
  return true;
}

// The page redraws with the draft as it will be kept: this resume's own text for the line, with its highlights.
async function livePreview(){
  const ed = E.edit;
  if (!ed || !ed.draft.trim()) return;
  const text = ed.draft.trim(), r = structuredClone(cur());
  T.setOverride(r, ed.fact, text, { marks: marksFor(ed, text), base: ed.vid });
  await C.previewRecipe(r, ed.fact);
  if (E.edit !== ed) return;
  ed.lines = C.sheet.linesOf(ix(), ed.fact);
  const st = $('#ed-stats');
  if (st) st.innerHTML = statsHtml(ed, C.fillText());
  C.onpage?.refresh();
}

function saveEdit(kind){
  const ed = E.edit;
  if (!ed) return;
  const text = ed.draft.trim();
  if (!text) return C.toast(t('toast.writeFirst'), 'warn');
  const f = ed.fact;
  const v = ed.vid ? ix().variants.get(ed.vid) : null;
  const resume = true;
  clearEdit(false);
  C.ui.previewing = false;
  if (kind === 'over') commit(d => { R.saveOver(d.record, ed.vid, text); }, t('undo.saveV', { v: v.n }), t('toast.savedV', { v: v.n }));
  else if (kind === 'as' || kind === 'promote'){
    let n;
    commit(d => {
      const nv = R.addVersion(d.record, f, { text, from: ed.vid, as: 'minor', lang: lang() });
      n = nv.n; E.enter = nv.id;
      if (resume) d.cur.picks = { ...(d.cur.picks ?? {}), [f]: nv.id };
      if (kind === 'promote') T.setOverride(d.cur, f, null);
      E.openMinor.add(`${f}:${lang()}:${R.major(nv.n)}`);
    }, t('undo.saveAsNew'), null);
    if (n) C.toast(t('toast.savedAsV', { v: n }));
  } else if (kind === 'new'){
    let n;
    commit(d => {
      const nv = R.addVersion(d.record, f, { text, from: ed.vid, as: 'major', lang: lang() });
      n = nv.n; E.enter = nv.id;
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
    case 'ed-cancel': cancelEdit({ discard: true }); return true;
    case 'use-edit': commit(d => T.unparkOverride(d.cur, s.id), t('edit.thisOnly')); return true;
    case 'ed-save': saveEdit('over'); return true;
    case 'ed-saveas': saveEdit('as'); return true;
    case 'ed-only': saveEdit('only'); return true;
    case 'ed-new': saveEdit('new'); return true;
    case 'ed-promote': saveEdit('promote'); return true;
    case 'local-remove': clearEdit(false); dropLine(s.id); C.renderBody(); return true;
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
      clearEdit(false); E.compare = null;
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
      clearEdit(false); E.compare = null;
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
      const ta = tg.closest?.('.addrow')?.querySelector('textarea') ?? $('#new-claim'), text = ta?.value.trim();
      if (!text){ C.toast(t('career.writeClaimFirst'), 'warn'); ta?.focus(); return true; }
      const entry = tg.dataset.id;
      commit(d => {
        const made = K.addEntryClaim(d.record, entry, text, lang());
        if (made && T.jobRefs(d.record, d.cur).some(r => (typeof r === 'string' ? r : r.id) === entry)) T.setBulletOn(d.record, d.cur, made, true);     // the entry is on: so is its new line
      }, t('undo.addClaim'), t('career.claimAdded'));
      E.claimDrafts.delete(entry);
      C.renderBody();
      setTimeout(() => document.querySelector(`.new-claim[data-entry="${CSS.escape(entry)}"]`)?.focus(), 30);
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
      // the missing text is written in Edit, wherever the list was
      if (k === 'heading') C.select({ kind: 'section', id }, { pane: 'edit' });
      else { const job = T.jobOfFact(rec(), id, cur()); C.select(job ? { kind: 'bullet', id, job: job.id, section: 'experience' } : { kind: 'bullet', id, section: tg.dataset.section ?? 'summary', owner: tg.dataset.owner ?? undefined }, { pane: 'edit' }); }
      return true;
    }
    case 'focus': E.focus = E.focus === tg.dataset.tag ? null : tg.dataset.tag; E.applyOpen = false; C.setFocus(); C.renderBody(); return true;
    case 'focus-clear': E.focus = null; E.applyOpen = false; C.setFocus(); C.renderBody(); return true;
    case 'lens-apply': E.applyOpen = !E.applyOpen && !!E.focus; C.renderBody(); return true;
    case 'lens-edit': C.select({ kind: 'record', what: 'jobtypes' }); return true;
    case 'section-on': setSection(tg.dataset.id, true); return true;
    case 'focus-apply': {
      const F = E.focus;
      let p;
      C.ui.morph = { kind: 'apply' };       // joining lines slide in, leaving ones fold away
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
    case 'sec-up': case 'sec-down': if (tg.getAttribute('aria-disabled') !== 'true') stepSectionBy(tg.dataset.id, a === 'sec-up' ? -1 : 1); return true;
    case 'order-reset': resetOrder(tg.dataset.kind, tg.dataset.id); return true;
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
    else if (t.dataset.item){ const id = t.dataset.item, on = t.checked; commit(d => T.setItemOn(d.record, d.cur, id, on), on ? tr('undo.turnOn') : tr('undo.turnOff')); }
    else if (t.id === 'lens'){ E.focus = t.value || null; E.applyOpen = false; C.setFocus(); C.renderBody(); }
    else if (t.dataset.same){ const k = t.dataset.same, on = t.checked; commit(d => setSame(d.record, k, on), on ? tr('edit.sameEvery') : tr('undo.notSame')); }
  });
  body.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'ed') onEditorInput(t);
    if (t.classList?.contains('new-claim')) E.claimDrafts.set(t.dataset.entry, t.value);
  });
  // the heading box commits on blur (Enter blurs it), as one undo step
  body.addEventListener('keydown', e => {
    const t = e.target;
    if (t.classList?.contains('tag-in') && e.key === 'Escape'){ E.tagFocus = null; t.blur(); return; }
    if (t.classList?.contains('tag-in') && e.key === 'Enter'){
      e.preventDefault();
      const tag = t.value.trim(), vid = t.dataset.vid;
      if (!tag) return;
      commit(d => K.tagVersion(d.record, vid, tag), tr('undo.addTag'));
      return;
    }
    if (t.classList?.contains('new-claim') && e.key === 'Enter' && !e.shiftKey && !e.isComposing){ e.preventDefault(); t.closest('.addrow')?.querySelector('[data-act=add-claim]')?.click(); }
    if (t.id === 'sec-label' && e.key === 'Enter'){ e.preventDefault(); t.blur(); }
    if (t.id === 'sec-label' && e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); t.value = T.labelOf(rec(), cur(), t.dataset.sid, lang()) ?? ''; t.blur(); }
    if (t.id === 'ed'){
      if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); cancelEdit(); }
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
    const jb = e.target.closest?.('.clgh[data-job][draggable=true]');
    if (jb){ E.dragJob = jb.dataset.job; jb.closest('.clg').classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', jb.dataset.job); return; }
    const bu = e.target.closest?.('.clrow[data-bullet][draggable=true]');
    if (bu){ E.dragBullet = { id: bu.dataset.bullet, job: bu.dataset.bjob }; bu.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', bu.dataset.bullet); return; }
    const it = e.target.closest?.('.clrow[data-item][draggable=true]');
    if (it){ E.dragItem = { id: it.dataset.item, sec: it.dataset.sec }; it.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.dataset.item); return; }
    const r = e.target.closest?.('.srow[draggable=true], .offchip[draggable=true]');
    if (!r) return;
    E.drag = r.dataset.sid;
    E.dragOff = r.classList.contains('offchip');
    r.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', E.drag);
  });
  body.addEventListener('dragover', e => {
    if (E.dragJob){
      const tj = e.target.closest?.('.clg:has(> .clgh[data-job])');
      if (tj && tj.closest('.obody') === body.querySelector(`.clgh[data-job="${CSS.escape(E.dragJob)}"]`)?.closest('.obody')){
        e.preventDefault();
        for (const n of body.querySelectorAll('.drop-above, .drop-below')) n.classList.remove('drop-above', 'drop-below');
        const bb = tj.getBoundingClientRect();
        tj.classList.add(e.clientY < bb.top + bb.height / 2 ? 'drop-above' : 'drop-below');
      }
      return;
    }
    if (E.dragBullet){
      const tb = e.target.closest?.('.clrow[data-bullet]');
      if (tb && tb.dataset.bjob === E.dragBullet.job){
        e.preventDefault();
        for (const n of body.querySelectorAll('.drop-above, .drop-below')) n.classList.remove('drop-above', 'drop-below');
        const bb = tb.getBoundingClientRect();
        tb.classList.add(e.clientY < bb.top + bb.height / 2 ? 'drop-above' : 'drop-below');
      }
      return;
    }
    const tr0 = e.target.closest?.('.clrow[data-item]');
    if (E.dragItem){
      if (tr0 && tr0.dataset.sec === E.dragItem.sec){
        e.preventDefault();
        for (const n of body.querySelectorAll('.drop-above, .drop-below')) n.classList.remove('drop-above', 'drop-below');
        const bb = tr0.getBoundingClientRect();
        tr0.classList.add(e.clientY < bb.top + bb.height / 2 ? 'drop-above' : 'drop-below');
      }
      return;
    }
    const r = e.target.closest?.('.srow:not(.fixed)');
    if (E.drag && E.dragOff && e.target.closest?.('#seclist')){ e.preventDefault(); if (!r) return; }
    if (!r || !E.drag) return;
    e.preventDefault();
    for (const n of body.querySelectorAll('.drop-above, .drop-below')) n.classList.remove('drop-above', 'drop-below');
    const bb = r.getBoundingClientRect();
    r.classList.add(e.clientY < bb.top + bb.height / 2 ? 'drop-above' : 'drop-below');
  });
  body.addEventListener('drop', e => {
    if (E.dragJob){
      const from = E.dragJob, tj = e.target.closest?.('.clg:has(> .clgh[data-job])');
      E.dragJob = null;
      const to = tj?.dataset.g;
      if (!to || to === from) return;
      e.preventDefault();
      const ids = [...tj.closest('.obody').querySelectorAll('.clgh[data-job]')].map(n => n.dataset.job).filter(x => x !== from);
      const at = ids.indexOf(to) + (tj.classList.contains('drop-below') ? 1 : 0);
      let r;
      commit(d => { r = T.moveEntry(d.record, d.cur, from, ids[at] ?? null); }, tr('ux2.undoMoveItem'));
      C.flash(T.sectionOfEntry(rec(), from));
      if (r?.auto) C.toast(autoNote(r).trim());
      return;
    }
    if (E.dragBullet){
      const row = e.target.closest?.('.clrow[data-bullet]'), from = E.dragBullet;
      E.dragBullet = null;
      if (!row || row.dataset.bjob !== from.job || row.dataset.bullet === from.id) return;
      e.preventDefault();
      const below = row.classList.contains('drop-below');
      const w = T.jobOfFact(rec(), from.id, cur());
      const ids = (w ? T.listedBullets(rec(), cur(), w.id) : []).filter(x => x !== from.id);
      const at = ids.indexOf(row.dataset.bullet) + (below ? 1 : 0);
      commit(d => T.moveBullet(d.record, d.cur, from.id, ids[at] ?? null), tr('ux2.undoMoveItem'));
      return;
    }
    if (E.dragItem){
      const row = e.target.closest?.('.clrow[data-item]'), from = E.dragItem;
      E.dragItem = null;
      if (!row || row.dataset.sec !== from.sec || row.dataset.item === from.id) return;
      e.preventDefault();
      const below = row.classList.contains('drop-below');
      const ids = (T.itemList(rec(), cur(), from.sec) ?? []).map(x => x.id).filter(x => x !== from.id);
      const at = ids.indexOf(row.dataset.item) + (below ? 1 : 0);
      commit(d => T.moveItem(d.record, d.cur, from.sec, from.id, ids[at] ?? null), tr('ux2.undoMoveItem'));
      C.flash(from.sec);
      return;
    }
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
    E.drag = null; E.dragOff = false; E.dragItem = null; E.dragBullet = null; E.dragJob = null;
    for (const n of body.querySelectorAll('.dragging, .drop-above, .drop-below')) n.classList.remove('dragging', 'drop-above', 'drop-below');
  });
}

function setBullet(id, on){
  C.ui.morph = { kind: 'tick' };       // the page shows the change moving (src/ui/pagemotion.js)
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

// The commands behind Alt+↑ / Alt+↓, the ↑ ↓ buttons and the margin's arrows: one step, one undo step. They return whether anything moved.
function stepSectionBy(id, d){
  let r;
  commit(x => { r = T.stepSection(x.record, x.cur, id, d); }, t('undo.moveSection'));
  if (r?.moved){ C.flash(id); if (r.auto) C.toast(autoNote(r).trim()); }
  return !!r?.moved;
}
function stepBulletBy(id, d){
  let moved = false;
  commit(x => { moved = T.stepBullet(x.record, x.cur, id, d); }, t('ux2.undoMoveItem'));
  return moved;
}
function stepJobBy(id, d){
  let r;
  commit(x => { r = T.stepEntry(x.record, x.cur, id, d); }, t('ux2.undoMoveItem'));
  if (r?.moved){ C.flash(T.sectionOfEntry(rec(), id)); if (r.auto) C.toast(autoNote(r).trim()); }
  return !!r?.moved;
}
function stepItemBy(id, d){
  const sid = T.sectionOfItem(rec(), id);
  let moved = false;
  commit(x => { moved = T.stepItem(x.record, x.cur, sid, id, d); }, t('ux2.undoMoveItem'));
  if (moved) C.flash(sid);
  return moved;
}
const stepRow = (row, d) => (row.dataset.bullet ? stepBulletBy(row.dataset.bullet, d) : stepItemBy(row.dataset.item, d));

// Alt+↑ / Alt+↓ move what has the focus or is selected: a bullet of a job, an item of a list section in its section's print
// order, else the selected section
function moveWhatIsHere(d){
  const job = document.activeElement?.closest?.('.clgh[data-job]')?.dataset.job;
  if (job){ stepJobBy(job, d); return true; }
  const bullet = document.activeElement?.closest?.('.clrow[data-bullet]')?.dataset.bullet
    ?? (C.ui.sel.kind === 'bullet' && C.ui.sel.job ? C.ui.sel.id : null);
  if (bullet){ stepBulletBy(bullet, d); return true; }
  const row = document.activeElement?.closest?.('.clrow[data-item]');
  const sel = C.ui.sel;
  const id = row?.dataset.item ?? (sel.kind === 'record' && sel.what === 'item' && T.sectionOfItem(rec(), sel.id) ? sel.id : null);
  if (id){ stepItemBy(id, d); return true; }
  if (sel.kind !== 'section') return false;
  stepSectionBy(sel.id, d);
  return true;
}
// "custom" → Reset: this resume's order goes back to the record's, as one undo step
function resetOrder(kind, id){
  let auto = false;
  commit(d => {
    if (kind === 'jobs'){
      const listed = new Set(T.jobRefs(d.record, d.cur, id).map(r => (typeof r === 'string' ? r : r.id)));
      for (const x of d.record.sections.find(s => s.id === id)?.content.work ?? []) if (listed.has(x) && d.record.work.some(w => w.id === x && !w.archived)) auto ||= T.moveEntry(d.record, d.cur, x).auto;
    }
    else if (kind === 'job'){
      const on = new Set(T.listedBullets(d.record, d.cur, id));
      for (const b of [...(ix().work.get(id)?.highlights ?? []), ...T.listedBullets(d.record, d.cur, id).filter(x => T.isLocal(d.cur, x))]) if (on.has(b)) T.moveBullet(d.record, d.cur, b);       // the lines only here stay after the record's
    }
    else if (kind === 'items') for (const x of T.itemsOf(d.record, id) ?? []) T.moveItem(d.record, d.cur, id, x);
    else { const on = new Set(T.sectionList(d.record, d.cur).filter(s => s.on && !s.fixed).map(s => s.id)); for (const s of d.record.sections) if (on.has(s.id)) auto ||= T.moveSection(d.record, d.cur, s.id).auto; }
  }, t('ux5b.undoReset'));
  if (auto) C.toast(t('toast.autoPages'));
}
function key(e){
  // writing a line on the page: Esc leaves it for the job, keeping what was typed, wherever the focus is
  if (e.key === 'Escape' && E.edit && !E.edit.panel){ e.preventDefault(); cancelEdit(); return true; }
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')
    && (C.ui.sel.kind === 'section' || document.activeElement?.closest?.('.clrow[data-item], .clrow[data-bullet], .clgh[data-job]') || (C.ui.sel.kind === 'bullet' && C.ui.sel.job) || (C.ui.sel.kind === 'record' && C.ui.sel.what === 'item'))){
    e.preventDefault(); return moveWhatIsHere(e.key === 'ArrowDown' ? 1 : -1);
  }
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && C.ui.sel.kind === 'bullet' && !E.edit && document.body.dataset.phone !== 'true'){ e.preventDefault(); startEdit(); return true; }
  return false;
}

// Leaving a line keeps what was typed (E1), so leaving is always allowed. The shell's select() ends any preview itself.
function leaving(next){
  const s = C.ui.sel;      // no editor open (the phone, a click on the sidebar): an empty line is still dropped when the selection leaves it
  if (!E.edit){ if (s.kind === 'bullet' && T.isLocal(cur(), s.id) && cur().overrides?.[s.id] === '' && !(next?.kind === 'bullet' && next.id === s.id)) dropLine(s.id); return true; }
  if (next?.kind === 'bullet' && next.id === E.edit.fact) return true;
  clearEdit(); E.compare = null;
  return true;
}

const api = {
  outlineView, noneView, lensBox, sectionView, jobView, bulletView, factPanel, act, bind, key, stepRow, stepJob: stepJobBy, stepLine: d => E.edit && stepBulletBy(E.edit.fact, d), leaving, rename, startEdit, addLine, cancelEdit, isDirty, draftChanged, pickWhileWriting, depthHtml,
  get editing(){ return E.edit; },
  claimDraftOf: id => E.claimDrafts.get(id) ?? '',
  afterRender(){
    if (E.edit && $('#ed') && document.activeElement?.id !== 'ed') focusEditor(); else if ($('#ed')) autosize($('#ed'));
    // the tag box keeps focus across the redraw a new tag causes
    const ti = E.tagFocus && document.querySelector(`.tag-in[data-vid="${CSS.escape(E.tagFocus)}"]`);
    if (ti && document.activeElement !== ti) ti.focus();
    // a version just saved: its row slides into the list under its parent (the list already has it; this shows where it came from)
    if (E.enter){
      const row = document.querySelector(`#body .vlist .vrow[data-v="${CSS.escape(E.enter)}"]`);
      E.enter = null;
      if (row){
        const hgt = row.offsetHeight;
        play(row, [{ opacity: 0, height: '0px', transform: 'translateY(-10px)', overflow: 'hidden' }, { opacity: 1, height: `${hgt}px`, transform: 'none', overflow: 'hidden' }], { name: 'version:in', key: 'version-row' });
      }
    }
  },
  get focus(){ return E.focus; },
  focusHits(){ return E.focus ? tagHits(work(), E.focus, lang()) : null; },
};
