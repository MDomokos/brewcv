// The Edit view: what the body card shows for the resume, a section, a job and a bullet, and what its
// controls do. One panel for a claim wherever you came from: the page, the record checklist below it, or
// the timeline. Every change is one store commit, so one undo step. Typing is not a change until it is saved.

import * as R from '../model/record.js';
import * as T from '../model/resume.js';
import * as LK from '../model/lock.js';
import { key as measureKeyOf } from '../fit.js';
import { tagVocab, planTag, applyTag, tagHits, jobTypesOf, jobTypeLabel, tagsOf, lensChoices } from '../model/focus.js';
import { missingList, isSame, setSame, sameKey, langName, writeIn, DEFAULT_LANG } from '../model/lang.js';
import * as K from '../model/career.js';
import { recordSelOfFact, factOfRecordSel } from '../model/checklist.js';
import { keyOf, isLabelKey } from './select.js';
import { t, h, errText } from '../i18n/index.js';
import { askIfLocked } from './ask.js';
import { play } from './motion.js';
import { icon } from './icons.js';
import { esc, clip, depthHtml as depthMarkup, sw, showSw, missBar, versionsHtml, statsHtml, claimHead } from './parts.js';

let C = null;
export function initEdit(ctx){ C = ctx; return api; }

const $ = s => document.querySelector(s);
const LANG_NAME = new Proxy({}, { get: (_, l) => langName(l) });

// the editor and the panel's own view state; none of it is undone
const E = { enter: null, edit: null, compare: null, openMinor: new Set(), timer: null, focus: null, claimDrafts: new Map(), applyOpen: false };

function commit(fn, label, done, undo = false){
  try {
    const changed = C.store.commit(d => { fn(d); }, label);
    if (changed && done) C.toast(done, '', undo);
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
  commit(d => T.removeLocalLine(d.record, d.cur, fact), t('ux6c.undoRemoveLine'), had ? `${t('ux6c.lineRemoved')} ${t('toast.ctrlZUndoes')}` : undefined, true);
}
// Leaving a line keeps what was typed on this resume, and nothing asks: one override with the highlights it keeps and the version it
// was written from. The words of that version again drop the override.
function keepEdit(ed){
  if (ed.group) return keepGroup(ed);
  if (ed.label) return keepLabel(ed);
  if (!isDirty(ed) || !ed.draft.trim()) return;      // an emptied line keeps what it had: the last kept edit, or the version's words
  const text = ed.draft.trim(), base = ix().variants.get(ed.vid);
  C.ui.previewing = false;
  commit(d => {
    if (text !== base?.text.trim()) return T.setOverride(d.record, d.cur, ed.fact, text, { marks: marksFor(ed, text), base: base?.id ?? null });
    T.dropOverride(d.record, d.cur, ed.fact);
    if (base && usingOf(ed.fact)?.id !== base.id) T.pickVersion(d.record, d.cur, ed.fact, base.id);
  }, t('edit.thisOnly'));
}
// A heading or a language's name written on the page: kept on this resume in its language, as one undo step. The record's own words reset it.
function keepLabel(ed){
  if (!isDirty(ed) || !ed.draft.trim()) return;
  C.ui.previewing = false;
  commit(d => T.setLabel(d.record, d.cur, ed.fact, ed.lang, ed.draft), t('ux6c.undoLabel'));
}
// A skill group written on the page: its name and skills, kept on this resume's arrangement. No skills left (a new group, or all
// of them deleted): the group goes, and Ctrl+Z brings it back.
function keepGroup(ed){
  const had = T.arrangementOf(rec(), cur()).groups.find(g => g.id === ed.fact)?.items.length;
  if (ed.draft === ed.base && had) return;
  C.ui.previewing = false;
  commit(d => T.writeGroup(d.record, d.cur, ed.fact, ed.draft), t('ux6c.undoSkills'), had && !T.readGroup(ed.draft).items.length ? `${t('ux6c.groupRemoved')} ${t('toast.ctrlZUndoes')}` : undefined, true);
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
function lensBox(extra = ''){
  const { types, tags } = lensChoices(rec(), lang());
  if (!types.length && !tags.length) return `<div class="lens"><span class="muted small">${h('ux2.lensNone')}</span> <button class="sm ghost" data-act="lens-edit">${h('ux2.lensEdit')}</button>${extra}</div>`;
  const chosen = E.focus;
  const known = types.some(x => x.tag === chosen) || tags.some(x => x.tag === chosen);
  const opt = x => `<option value="${esc(x.tag)}" ${chosen === x.tag ? 'selected' : ''}>${esc(x.label)} (${x.n})</option>`;
  let out = `<div class="lens"><div class="lensrow"><label for="lens" class="lbl inline"><span class="lt">${h('ux3b.lens')}</span></label>
      <select id="lens"><option value="">${h('ux2.lensOff')}</option>
        ${types.length ? `<optgroup label="${esc(t('ux2.lensTypes'))}">${types.map(opt).join('')}</optgroup>` : ''}
        ${tags.length ? `<optgroup label="${esc(t('ux2.lensTagsGroup'))}">${tags.map(opt).join('')}</optgroup>` : ''}
        ${chosen && !known ? `<option value="${esc(chosen)}" selected>${esc(chosen)}</option>` : ''}</select>
      <button class="sm" data-act="lens-apply" aria-expanded="${E.applyOpen}" ${chosen ? '' : 'disabled'}>${h('ux3b.lensApply')}</button>${extra}</div>`;
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
    ${lensBox(pageLockHtml('lensrow-end'))}
    ${C.outlineHtml()}
    <p class="muted tiny outfoot">${h('ux5c.outlineFoot')}</p>`;
}
// the whole page's padlock: Edit with nothing selected has it
function pageLockHtml(cls = ''){
  if (C.ui.snap) return '';
  const on = lockBy(LK.PAGE) !== null, name = t(on ? 'ux6c.unlockX' : 'ux6c.lockX', { name: t('ux6c.thePage') });
  const btn = `<button type="button" class="sm ghost pagelock${on ? ' is-locked' : ''}${cls ? ' ' + cls : ''}" data-act="lock-toggle" data-id="${LK.PAGE}" aria-pressed="${on}" aria-label="${esc(name)}" title="${esc(name)}">${icon(on ? 'lock' : 'unlock', { size: 12 })}${cls ? '' : `<span>${esc(t(on ? 'ux6c.pageLocked' : 'ux6c.lockPage'))}</span>`}</button>`;
  return cls ? btn : `<p class="lockbar">${btn}</p>`;      // in the Outline it is an icon on the lens's last line (no extra height); alone it has a line of its own
}
// Edit with nothing selected: what this resume is for, and one line on how to pick a line
function noneView(){
  const r = cur(), type = r.jobType ? jobTypeLabel(rec(), r.jobType) : '';
  return `${C.newerBanner()}${missingBar()}
    <h2 class="title">${esc(C.resumeName(r))}</h2>
    ${type ? `<p class="meta">${esc(type)}</p>` : ''}
    ${pageLockHtml()}
    <p class="lead edithint">${h('ux5c.editNone')}</p>`;
}

// bullets and prose run over several lines; the other texts are one line
const multiline = ed => !ed.label && !ed.group && (!!T.jobOfFact(rec(), ed.fact, cur()) || ix().summaries.has(ed.fact));
// The accessible name of a text written on the page: the heading of its section and what it is there (Education, degree)
function fieldName(ed){
  const id = ed.fact, of = (sec, what) => `${sec}, ${what}`, secOf = sid => C.sectionTitle(sid);
  if (ed.label) return id.startsWith('~h:') ? of(secOf(id.slice(3)), t('ux6c.n.heading')) : of(secOf(ix().owned.get(id.slice(3))), t('ux6c.n.name'));
  if (ed.group) return of(secOf('skills'), t('ux6c.n.group'));
  const f = Object.entries(rec().basics?.display ?? {}).find(([, x]) => x === id);
  if (f) return of(t('ux6c.header'), t(`ux6c.f.${f[0]}`));
  const w = [...ix().work.values()].find(x => Object.values(x.display ?? {}).includes(id));
  if (w) return of(w.name ?? w.organization ?? w.entity ?? w.id, id === w.display?.meta ? t('ux6c.f.dates') : t('ux6c.n.title'));
  const sid = ix().owned.get(id), c = ix().sections.get(sid)?.content;
  if (sid) return of(secOf(sid), ix().sections.get(sid).kind === 'item' ? (id === c.title ? t('ux6c.n.title') : id === c.subtitle ? t('ux6c.n.subtitle') : t('ux6c.f.dates')) : t('ux6c.n.text'));
  const j = T.jobOfFact(rec(), id, cur());
  return j ? of(j.name ?? j.organization ?? j.entity ?? j.id, t('ux3.crumbLine')) : of(secOf('summary'), t('ux6c.n.text'));
}
// what a line is called in the depth chip and the card: its summary, else its words; a new empty line only on this resume is "New line"
const lineName = id => (id.startsWith('~t:') ? T.labelNow(rec(), cur(), id, lang()) : '') || (ix().skillGroups.has(id) ? T.arrangementOf(rec(), cur()).groups.find(g => g.id === id)?.label ?? T.groupLabel(rec(), cur(), id) : '')
  || ix().facts.get(id)?.summary || C.textOfFact(id) || (T.isLocal(cur(), id) ? t('ux6c.newLine') : id);

// One depth indicator (UX-6c): the levels of what is selected, from the page down. The chip on the page and the row at the top of
// the editor card both draw it, from parts.js depthHtml. The sidebar's row names the specific content (full job and line names); the
// page's chip is general and in single words (Page › Experience › Hydra, Page › Skills › CAD, no line level).
function depth(sel = C.ui.sel, page = false){
  const L = [{ word: t('ux3.crumbPage'), act: 'deselect' }];
  const at = id => `data-id="${esc(id)}"`;
  const jobId = sel.kind === 'job' ? sel.id : sel.kind === 'bullet' ? sel.job ?? sel.owner : null;
  const item = sel.kind === 'record' && sel.what === 'item';       // a skill group, a language: an item of a list section
  const sid = sel.kind === 'section' ? sel.id : sel.kind === 'bullet' ? sel.section ?? 'summary' : jobId ? T.sectionOfEntry(rec(), jobId) : item ? T.sectionOfItem(rec(), sel.id) : null;
  const word = s => clip(String(s ?? '').trim().split(/\s+/)[0].replace(/[,.;:]+$/, ''), 12);
  const jw = jobId && ix().work.get(jobId), jobName = jw?.name ?? jw?.organization ?? jw?.entity ?? jobId;
  // an item's word ties to its real content; a date line is Dates; a language's or reference's text takes its pair's name
  const itemWord = id => word(id.startsWith('~t:') || ix().skillGroups.has(id) ? lineName(id) : /-meta$/.test(id) ? t('ux6c.f.dates') : ix().sections.get(ix().owned.get(id))?.kind === 'pairs' ? lineName(`~t:${id}`) : C.textOfFact(id) || lineName(id));
  // the header's field the selection is on: Name, Headline, Contact or Photo
  const field = sel.kind === 'header' ? (sel.id ? t(`ux6c.f.${sel.id}`) : null) : sel.kind === 'bullet' ? Object.entries(rec().basics?.display ?? {}).map(([k, f]) => (f === sel.id ? t(`ux6c.f.${k}`) : null)).find(Boolean) : null;
  const fieldLevel = field && { word: field, ...(sel.kind === 'bullet' ? { act: 'select-fact', attrs: `${at(sel.id)} data-section="header"` } : { act: 'select-header' }) };
  if (page){
    if (sel.kind === 'header' || sid === 'header'){ L.push({ word: t('ux6c.header'), act: 'select-header' }); if (fieldLevel) L.push(fieldLevel); }
    else if (sid) L.push({ word: word(C.sectionTitle(sid)), act: 'select-section', attrs: at(sid) });
    if (jobId) L.push({ word: word(jobName), act: 'select-job', attrs: at(jobId) });
    else if (item) L.push({ word: itemWord(sel.id), act: 'select-record', attrs: `${at(sel.id)} data-what="item" data-group="${esc(sel.group ?? '')}"` });
    else if (sel.kind === 'bullet' && sid !== 'header' && sid !== 'summary') L.push({ word: itemWord(sel.id), act: 'select-fact', attrs: `${at(sel.id)} data-section="${esc(sid ?? '')}"${sel.owner ? ` data-owner="${esc(sel.owner)}"` : ''}` });
    return L;
  }
  if (jobId) L.push({ word: t('ux3.crumbJob'), name: jobName, act: 'select-job', attrs: at(jobId) });
  else if (sel.kind === 'header' || sid === 'header') L.push({ word: t('ux6c.header'), act: 'select-header' });
  else if (sid) L.push({ word: t('ux6c.section'), name: C.sectionTitle(sid), act: 'select-section', attrs: at(sid) });
  if (fieldLevel) L.push(fieldLevel);
  else if (sel.kind === 'bullet') L.push({ word: jobId ? t('ux3.crumbLine') : t('ux6c.item'), name: T.isLocal(cur(), sel.id) || ix().skillGroups.has(sel.id) ? lineName(sel.id) : ix().facts.get(sel.id)?.summary ?? sel.id,
    act: 'select-fact', attrs: `${at(sel.id)} data-section="${esc(sid ?? '')}"${sel.owner ? ` data-owner="${esc(sel.owner)}"` : ''}` });
  return L;
}
const depthHtml = (sel = C.ui.sel, { page = false } = {}) => depthMarkup(depth(sel, page), { small: page, ...chipTools(sel, page) });

// ---- the lock (UX-6c-iii-b) ----
// the id the padlock holds for a selection: the block the chip names (a heading is its own block)
function lockIdOf(sel = C.ui.sel){
  switch (sel.kind){
    case 'none': return LK.PAGE;
    case 'header': return sel.id ?? 'header';
    case 'job': return sel.id;
    case 'section': return sel.heading ? `~h:${sel.id}` : sel.id;
    case 'bullet': return sel.id;
    case 'record': return sel.what === 'item' ? factOfRecordSel(rec(), sel) ?? sel.id : null;      // the display claim the lock is held on, not the publication's id
  }
  return null;
}
const lockBy = id => (id ? LK.lockedBy(rec(), cur(), id) : null);
const isLockedId = id => lockBy(id) !== null;
// what a lock is called to a person
function lockName(id){
  if (id === LK.PAGE) return t('ux6c.thePage');
  if (id.startsWith('~h:')) return t('ux6c.headingOf', { name: C.sectionTitle(id.slice(3)) });
  if (ix().sections.has(id)) return C.sectionTitle(id);
  if (ix().work.has(id)){ const w = ix().work.get(id); return w.name ?? w.organization ?? w.entity ?? id; }
  return clip(lineName(id), 40);
}
// the switch the chip offers for the block it names: a section, a job, a line, or an item of a list section; null for the others
function showOf(sel){
  const un = id => id.replace(/^~t:/, '');
  if (sel.kind === 'section' && !sel.heading){ const me = T.sectionList(rec(), cur()).find(x => x.id === sel.id); return me && !me.fixed ? { kind: 'section', id: sel.id, on: me.on } : null; }
  if (sel.kind === 'job') return { kind: 'job', id: sel.id, on: jobOn(sel.id) };
  const id = sel.kind === 'bullet' || (sel.kind === 'record' && sel.what === 'item') ? un(sel.id) : null;
  if (!id) return null;
  if (sel.kind === 'bullet' && sel.job) return { kind: 'line', id, on: isOn(id) };
  const sid = T.sectionOfItem(rec(), id);
  return sid ? { kind: 'item', id, on: !!T.itemList(rec(), cur(), sid)?.find(x => x.id === id)?.on && !!T.sectionList(rec(), cur()).find(x => x.id === sid)?.on } : null;
}
// A switch is held when turning it would change locked text: hiding a block that is locked or holds a locked line, or showing one under a
// locked ancestor. Showing a locked block itself changes no text, so that stays open.
const switchHeld = (kind, id, on) => { const by = lockBy(id); return kind === 'line' ? by !== null : on ? by !== null || LK.lockedInside(rec(), cur(), id) : by !== null && by !== id; };
// the padlock and the switch at the right end of the depth row (not on a sent copy)
function chipTools(sel, page){
  const id = !C.ui.snap && lockIdOf(sel);
  if (!id) return {};
  const lv = depth(sel, page).at(-1), by = lockBy(id), s = showOf(sel);
  // the page's chip stops at the job: a line in it is named for what it is
  const name = sel.kind === 'section' && sel.heading ? lockName(id) : sel.kind === 'bullet' && sel.job ? t('ux6c.lineIn', { name: lockName(sel.job) }) : lv.name ? `${lv.word} ${lv.name}` : lv.word;
  return { lock: { id, on: by !== null, name, byName: by !== null && by !== id ? lockName(by) : null }, show: s ? { ...s, name, disabled: switchHeld(s.kind, s.id, s.on) } : null, fix: fixTool(sel, id, name, by !== null) };
}
// The tool beside the padlock that undoes what was done here: an edit put back to the record's words (a line or header field, a heading,
// a language's name), a line only on this resume or a skill group removed. Held while the block is locked.
function fixTool(sel, id, name, held){
  const key = keyOf(sel), group = ix().skillGroups.has(id);
  const revert = { act: 'chip-revert', icon: 'replay', name: t('ux6c.revertX', { name }), disabled: held };
  if (isLabelKey(key)) return (key.startsWith('~h:') ? T.labelOf(rec(), cur(), key.slice(3), lang()) != null : T.termOf(cur(), key.slice(3)) != null) ? revert : null;
  if (sel.kind !== 'bullet' && !(sel.kind === 'record' && group)) return null;
  if (group) return { act: 'chip-remove', icon: 'trash', name: t('ux6c.removeX', { name: t('ux6c.theGroup', { name: clip(lineName(id) === id ? t('ux6c.newGroup') : lineName(id), 30) }) }), disabled: held };
  if (T.isLocal(cur(), id)) return { act: 'chip-remove', icon: 'trash', name: t('ux6c.removeX', { name }), disabled: held };
  return overrideOf(id) !== undefined ? revert : null;
}
// What the padlock of a lock id selects: the block it holds.
const selOfLock = id => (id === LK.PAGE ? { kind: 'none' } : id.startsWith('~h:') ? { kind: 'section', id: id.slice(3), heading: true } : ix().work.has(id) ? { kind: 'job', id } : ix().sections.has(id) ? { kind: 'section', id } : null);
// Lock or unlock: what is being written is kept first. A lock an ancestor holds is not lifted from here: it says so and selects the ancestor.
function lockToggle(id){
  const by = lockBy(id);
  if (by !== null && by !== id){
    C.hint(t('ux6c.lockedUnder', { name: lockName(by) }));
    const s = selOfLock(by); if (s) C.select(s);
    return;
  }
  const on = by === null;
  clearEdit();
  commit(d => LK.setLocked(d.cur, id, on), on ? t('ux6c.undoLock') : t('ux6c.undoUnlock'));
  const name = id === lockIdOf() ? chipTools(C.ui.sel, true).lock.name : lockName(id);      // as the chip names it
  C.say(on ? t('ux6c.nowLocked', { name }) : t('ux6c.nowUnlocked', { name }));
}
// a click on locked text selects its block and says why nothing is written
function lockedHint(sel = C.ui.sel){
  const id = lockIdOf(sel), by = lockBy(id);
  C.hint(by && by !== id ? t('ux6c.lockedWith', { name: lockName(by) }) : t('ux6c.lockedHint'));
}
// the chip's switch (show or hide)
function chipOn(kind, id){
  const on = kind === 'section' ? T.sectionList(rec(), cur()).find(x => x.id === id)?.on : kind === 'job' ? jobOn(id) : kind === 'line' ? isOn(id) : !!showOf({ kind: 'bullet', id })?.on;
  if (switchHeld(kind, id, !!on)) return lockedHint({ kind: kind === 'line' ? 'bullet' : kind, id });
  if (kind === 'section') setSection(id, !on);
  else if (kind === 'job') commit(d => T.setJobOn(d.record, d.cur, id, !on), !on ? t('undo.showJob') : t('undo.hideJob'));
  else if (kind === 'line') setBullet(id, !on);
  else commit(d => T.setItemOn(d.record, d.cur, id, !on), !on ? t('undo.turnOn') : t('undo.turnOff'));
}

// The skills of this resume as groups of skills: where to start from, the groups and skills to arrange, and where to keep the result.
// Each skill is a button (Alt+← → moves it in its group, Alt+↑ ↓ to the group above or below) and can be dragged to another group.
function skillsHtml(){
  const m = rec(), arr = T.arrangementOf(m, cur()), sets = Object.keys(T.skillSets(m)), { types, tags } = lensChoices(m, lang());
  const tag = cur().jobType ?? arr.from ?? '', all = [...types, ...tags], arranged = !!cur().skillArrangement;
  const saved = x => !!T.skillSets(m)[x]?.[arr.lang ?? cur().lang ?? DEFAULT_LANG];      // the set Save writes for this tag, in this language
  return `<div class="skarr">
    <label class="field"><span class="lbl inline">${h('ux6c.startFrom')}</span><select id="sk-set" ${sets.length || arranged ? '' : 'disabled'}><option value="">${esc(arr.from ? t('ux6c.setNow', { name: jobTypeLabel(m, arr.from) }) : t('ux6c.setNone'))}</option>
      ${arranged ? `<option value="~record">${esc(t('ux6c.recordGroups'))}</option>` : ''}
      ${sets.map(n => `<option value="${esc(n)}">${esc(jobTypeLabel(m, n))}</option>`).join('')}</select></label>
    ${sets.length ? '' : `<p class="muted small">${h('ux6c.noSets')}</p>`}
    ${arr.groups.map(g => { const name = g.label ?? T.groupLabel(m, cur(), g.id) ?? ''; return `<div class="skgroup" data-g="${esc(g.id)}"><div class="skghead"><b>${esc(name || t('ux6c.newGroup'))}</b></div>
      <div class="skchips">${g.items.map((x, k) => `<button class="skchip" draggable="true" data-g="${esc(g.id)}" data-k="${k}" title="${esc(t('ux6c.skillTip', { name: x }))}">${esc(x)}</button>`).join('')}</div></div>`; }).join('')}
    <button class="sm ghost addline" data-act="sk-addgroup">${h('ux6c.addGroup')}</button>
    <div class="skfoot"><label class="field"><span class="lbl inline">${h('ux6c.saveFor')}</span><select id="sk-tag">${all.map(x => `<option value="${esc(x.tag)}" ${x.tag === tag ? 'selected' : ''} ${saved(x.tag) ? 'data-set="1"' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
      <button class="sm" data-act="sk-save" ${all.length ? '' : 'disabled'}>${h('ux6c.saveSet')}</button>
      <button class="sm" data-act="sk-del" ${saved(tag) ? '' : 'disabled'}>${h('ux6c.deleteSet')}</button></div>
  </div>`;
}
// a skill group one place up or down, or before another (the drag on the page); a line before another of its job
function stepGroupBy(id, d){
  const ids = T.arrangementOf(rec(), cur()).groups.map(g => g.id), i = ids.indexOf(id), j = i + d;
  if (i < 0 || !ids[j]) return false;
  return moveGroupBy(id, d < 0 ? ids[j] : ids[j + 1] ?? null);
}
function moveGroupBy(id, before){
  commit(d => T.moveSkillGroup(d.record, d.cur, id, before), t('ux6c.undoSkills'));
  return true;
}
function moveLineBy(id, before){
  commit(d => T.moveBullet(d.record, d.cur, id, before), t('ux2.undoMoveItem'));
  return true;
}
// A new empty skill group after `afterId`, written at once on the page. It goes again if it is left empty.
async function addGroup(afterId = null){
  clearEdit();
  let id;
  commit(d => { id = T.addSkillGroup(d.record, d.cur, afterId); }, t('ux6c.undoSkills'));
  if (!id) return false;
  C.work();
  await C.redrawNow?.();
  C.select({ kind: 'bullet', id, section: 'skills' });
  if (C.ui.sel.id === id && document.body.dataset.phone !== 'true') startEdit();
  return true;
}
// one skill of a group to a place in another group (the keyboard route, the drag in the sidebar and the drag on the page share it);
// `j` is its place there once it has left
function moveSkillBy(g, k, to, j){
  let ok = true;
  commit(d => { try { T.moveSkill(d.record, d.cur, g, k, to, j); } catch { ok = false; } }, t('ux6c.undoSkills'));
  return ok;
}

function sectionView(s, sel = s){
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
  const inner = isHeader ? '' : s.id === 'skills' ? skillsHtml() + (cur().skillArrangement ? '' : C.outlineHtml(null, s.id)) : C.outlineHtml(null, s.id);
  return `${depthHtml(sel)}
    <h2 class="title">${esc(title)}</h2>
    ${isHeader ? '' : `<label class="field"><span class="lbl inline">${h('edit.headingHere', { lang: LANG_NAME[L] ?? L })}</span>
      <input id="sec-label" data-sid="${esc(s.id)}" value="${esc(own ?? '')}" placeholder="${esc(T.recordTitle(rec(), s.id, L))}" autocomplete="off"></label>
    ${L !== DEFAULT_LANG ? `<div class="ctlrow">${sw(`data-same="section:${esc(s.id)}"`, isSame(rec(), `section:${s.id}`), h('edit.sameHeading'))}</div>` : ''}
    <p class="muted small">${h('edit.sectionId', { id: s.id, kind: sec.kind })}${own ? ` · <a data-act="label-reset">${h('edit.resetTo', { title: T.recordTitle(rec(), s.id, L) })}</a> · <a data-act="label-all">${h('edit.labelAll')}</a>` : ''}</p>`}
    ${me && !me.fixed ? `<div class="ctlrow">${showSw(`data-secon="${esc(s.id)}"`, me.on, title, { text: true })}</div>
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
    <div class="ctlrow">${showSw(`data-jobon="${esc(s.id)}"`, on, t('ux6c.thisJob'), { text: true })}</div>${details ? `\n    ${C.detailsHtml(s.id)}` : ''}`;
}

// A language's name, written on the page: its words here, and the record's to go back to
function termView(s){
  const L = lang(), fid = s.id.slice(3), own = T.termOf(cur(), fid) ?? '';
  return `${depthHtml(s)}
    <h2 class="title">${esc(T.labelNow(rec(), cur(), s.id, L))}</h2>
    <label class="field"><span class="lbl inline">${h('ux6c.termHere', { lang: LANG_NAME[L] ?? L })}</span>
      <input id="term-in" data-key="${esc(s.id)}" value="${esc(own)}" placeholder="${esc(T.recordTerm(rec(), fid, L))}" autocomplete="off"></label>
    <p class="muted small">${h('ux6c.termNote')}</p>`;
}
// the record's own form for the entry a printed text is part of (what only the record edits: dates, links, the grade)
function entryLink(id){
  const sel = recordSelOfFact(rec(), id);
  return sel ? `<p class="allrec"><button class="sm ghost" data-act="cl-open" data-sel="${esc(JSON.stringify(sel))}">${h('ux6c.entryFields')}</button></p>` : '';
}

function bulletView(s){
  if (s.id.startsWith('~t:')) return termView(s);
  const f = ix().facts.get(s.id);
  if (!f) return noneView();
  const w = s.job ? ix().work.get(s.job) : null;
  const on = isOn(s.id) && (!w || jobOn(w.id));
  // a line that exists only on this resume has no versions: what it is, the tick, and the way to remove it
  if (T.isLocal(cur(), s.id)) return `${depthHtml(s)}
    <h2 class="title">${esc(clip(lineName(s.id), 80))}</h2>
    <div class="ctlrow">${showSw('id="b-on"', on, t('ux6c.thisLine'), { text: true })}</div>
    <p class="note">${h('ux6c.localNote')}</p>
    ${document.body.dataset.phone === 'true' ? versionsHtml(versionsX(s.id)) : ''}
    <div class="ctlrow"><button class="sm" data-act="local-remove">${h('ux6c.removeLine')}</button></div>`;

  return `${depthHtml(s)}
    <h2 class="title" title="${esc(t('edit.claimTitle'))}">${esc(f.summary ?? s.id)}</h2>
    ${claimHead({ hasJob: !!w, name: t('ux6c.thisLine'), on, kept: isKept(s.id), deletable: isClaim(s.id), archived: isClaim(s.id) ? isArch(s.id) : null })}`
    + versionsHtml(versionsX(s.id)) + entryLink(s.id);
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
  if (isLockedId(jobId)){ lockedHint({ kind: 'job', id: jobId }); return false; }
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
  if (isLockedId(lockIdOf()) || isLockedId(fid())) return lockedHint();      // a locked text is not written: its block is selected and the reason said
  const key = keyOf(C.ui.sel), id = isLabelKey(key) ? null : fid();
  if (isLabelKey(key)) return startLabel(key);
  if (!id) return;
  if (ix().skillGroups.has(id)) return startGroup(id);
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
// A skill group is written on the page only: its name, a line break, its skills (nothing to pick from, no versions)
function startGroup(id){
  const text = T.groupText(rec(), cur(), id);
  E.edit = { fact: id, group: true, mode: 'edit', vid: null, marks: [], base: text, draft: text };
  E.compare = null;
  C.endHover();
  if (!C.onpage?.begin()){ E.edit = null; return; }
  E.edit.panel = false;
  C.renderBody();
}
// A heading or a language's name is written on the page only: the text printed now, kept in this resume's language
function startLabel(key){
  const text = T.labelNow(rec(), cur(), key, lang());
  E.edit = { fact: key, label: true, lang: lang(), mode: 'edit', vid: null, marks: [], base: text, draft: text };
  E.compare = null;
  C.endHover();
  if (!C.onpage?.begin()){ E.edit = null; return; }
  E.edit.panel = false;
  C.renderBody();
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
  commit(d => T.pickVersion(d.record, d.cur, ed.fact, vid), t('undo.useVersion', { n: v.n }));
  Object.assign(ed, { vid, mode: 'edit', base: v.text, draft: v.text, copyOf: v.text, marks: v.marks ?? [] });
  C.onpage?.setText(v.text);
  return true;
}

// The page redraws with the draft as it will be kept: this resume's own text for the line, with its highlights.
async function livePreview(){
  const ed = E.edit;
  if (!ed || !ed.draft.trim()) return;
  const text = ed.draft.trim(), r = structuredClone(cur());
  if (ed.label) T.setLabel(rec(), r, ed.fact, ed.lang, text);
  else if (ed.group){ if (!T.readGroup(ed.draft).items.length) return; T.writeGroup(rec(), r, ed.fact, ed.draft); }      // a group with no skills yet is left as it is until the line is left
  else {
    try { T.setOverride(rec(), r, ed.fact, text, { marks: marksFor(ed, text), base: ed.vid }); }
    catch (e){ if (!(e instanceof LK.LockedError)) throw e; clearEdit(false); C.onpage?.end(); lockedHint(); return; }      // locked while it was open
  }
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
  if (kind === 'over') commit(d => { R.saveOver(d.record, ed.vid, text, d.cur); }, t('undo.saveV', { v: v.n }), t('toast.savedV', { v: v.n }));
  else if (kind === 'as' || kind === 'promote'){
    let n;
    commit(d => {
      const nv = R.addVersion(d.record, f, { text, from: ed.vid, as: 'minor', lang: lang() });
      n = nv.n; E.enter = nv.id;
      if (resume){ LK.guard(d.record, d.cur, f); d.cur.picks = { ...(d.cur.picks ?? {}), [f]: nv.id }; }
      if (kind === 'promote') T.setOverride(d.record, d.cur, f, null);
      E.openMinor.add(`${f}:${lang()}:${R.major(nv.n)}`);
    }, t('undo.saveAsNew'), null);
    if (n) C.toast(t('toast.savedAsV', { v: n }));
  } else if (kind === 'new'){
    let n;
    commit(d => {
      const nv = R.addVersion(d.record, f, { text, from: ed.vid, as: 'major', lang: lang() });
      n = nv.n; E.enter = nv.id;
      if (resume){ LK.guard(d.record, d.cur, f); d.cur.picks = { ...(d.cur.picks ?? {}), [f]: nv.id }; }
    }, t('undo.writeNew'), null);
    if (n) C.toast(t('toast.savedNewV', { v: n }));
  } else if (kind === 'only'){
    commit(d => { T.setOverride(d.record, d.cur, f, text); if (T.jobOfFact(d.record, f) && !T.listedBullets(d.record, d.cur, T.jobOfFact(d.record, f).id).includes(f)) T.setBulletOn(d.record, d.cur, f, true); },
      t('edit.thisOnly'), t('toast.changedOnlyHere'));
  }
  if (!resume) C.renderBody();     // closes the editor even when nothing changed
}

async function act(a, tg){
  const s = { id: fid() }, sel = C.ui.sel;     // s: the claim open; sel: what the Resume has selected (a section, for the cases below)
  switch (a){
    case 'edit': startEdit(null, tg?.dataset?.v ?? null); return true;
    case 'ed-cancel': cancelEdit({ discard: true }); return true;
    case 'use-edit': commit(d => T.unparkOverride(d.record, d.cur, s.id), t('edit.thisOnly')); return true;
    case 'ed-save': saveEdit('over'); return true;
    case 'ed-saveas': saveEdit('as'); return true;
    case 'ed-only': saveEdit('only'); return true;
    case 'ed-new': saveEdit('new'); return true;
    case 'ed-promote': saveEdit('promote'); return true;
    case 'local-remove': clearEdit(false); dropLine(s.id); C.renderBody(); return true;
    // the chip's and the depth row's tool beside the padlock: put an edit back, or remove what is only here (held while locked)
    case 'chip-revert': case 'chip-remove': {
      if (tg.getAttribute('aria-disabled') === 'true'){ lockedHint(); return true; }
      clearEdit();      // what is being written is kept first, as for the padlock
      const key = keyOf(sel);
      if (a === 'chip-remove') await act(ix().skillGroups.has(s.id) ? 'group-remove' : 'local-remove', tg);
      else if (isLabelKey(key)) commit(d => T.setLabel(d.record, d.cur, key, lang(), ''), t('undo.resetHeading'), t('toast.backToSaved'));
      else await act('only-remove', tg);
      return true;
    }
    case 'group-remove': commit(d => T.writeGroup(d.record, d.cur, s.id, ''), t('ux6c.undoSkills'), `${t('ux6c.groupRemoved')} ${t('toast.ctrlZUndoes')}`, true); C.select({ kind: 'section', id: 'skills' }); return true;
    case 'only-remove': commit(d => T.setOverride(d.record, d.cur, s.id, null), t('edit.backToSaved'), t('toast.backToSaved')); return true;
    case 'unfold': E.openMinor.add(`${s.id}:${lang()}:${tg.dataset.m}`); C.renderBody(); return true;
    case 'compare': E.compare = E.compare === tg.dataset.v ? null : tg.dataset.v; C.renderBody(); return true;
    case 'compare-close': E.compare = null; C.renderBody(); return true;
    case 'delete-version': {
      const v = ix().variants.get(tg.dataset.v);
      if (!v) return true;
      if (E.compare === v.id) E.compare = null;
      C.endHover();
      commit(d => { R.deleteVersion(d.record, v.id, [d.cur, ...(d.resumes ?? [])], d.cur); }, t('edit.deleteV', { v: v.n }), t('toast.deletedV', { v: v.n }), true);
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
      if (!await askIfLocked(C.store.state, (m, rs) => K.deleteClaim(m, id, rs))) return true;
      commit(d => { res = K.deleteClaim(d.record, id, [d.cur, ...(d.resumes ?? [])]); }, t('undo.deleteClaim'));
      if (res){
        C.toast(t('career.deletedClaim', { name, n: res.versions }), '', true);
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
      commit(d => { LK.guard(d.record, d.cur, id); const v = writeIn(d.record, id, L, text, ta.dataset.from || null); n = v.n; T.pickVersion(d.record, d.cur, id, v.id); }, t('undo.writeIn', { lang: LANG_NAME[L] }));
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
    case 'focus-apply': {
      const F = E.focus;
      let p;
      C.ui.morph = { kind: 'apply' };       // joining lines slide in, leaving ones fold away
      commit(d => { p = applyTag(d.record, d.cur, F); }, t('undo.selectFor', { tag: jobTypeLabel(rec(), F) }));
      E.applyOpen = false;
      if (p) C.toast(t('toast.selectedFor', { tag: jobTypeLabel(rec(), F), on: p.on, off: p.off, sw: p.sw }), '', true);
      return true;
    }
    case 'tag-rm': {
      const vid = tg.dataset.v, tag = tg.dataset.tag;
      commit(d => { const v = d.record.variants.find(x => x.id === vid); if (v) v.tags = (v.tags ?? []).filter(x => x !== tag); }, t('undo.removeTag'));
      return true;
    }
    case 'sk-save': {
      const name = $('#sk-tag')?.value;
      if (!name) return true;
      commit(d => { const arr = T.arrangementOf(d.record, d.cur); T.saveSetForTag(d.record, name, arr, d.cur.lang ?? DEFAULT_LANG); T.setArrangement(d.cur, { ...arr, from: name }); }, t('ux6c.undoSaveSet'), t('ux6c.setSaved', { name: jobTypeLabel(rec(), name) }));
      return true;
    }
    case 'sk-addgroup': addGroup(T.arrangementOf(rec(), cur()).groups.at(-1)?.id ?? null); return true;      // at the end, written at once on the page
    case 'sk-del': {
      const name = $('#sk-tag')?.value, L = T.arrangementOf(rec(), cur()).lang ?? cur().lang ?? DEFAULT_LANG;
      if (name) commit(d => { T.deleteSkillSet(d.record, name, L); }, t('ux6c.undoDeleteSet'), t('ux6c.setDeleted', { name: jobTypeLabel(rec(), name) }), true);
      return true;
    }
    case 'order-reset': resetOrder(tg.dataset.kind, tg.dataset.id); return true;
    case 'label-reset': commit(d => T.setSectionLabel(d.record, d.cur, sel.id, lang(), null), t('undo.resetHeading')); return true;
    case 'lock-toggle': case 'row-lock': lockToggle(tg.dataset.id); return true;
    case 'chip-on': if (tg.getAttribute('aria-disabled') !== 'true') chipOn(tg.dataset.kind, tg.dataset.id); return true;
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
  // a held control (aria-disabled, read-only fields aside) does nothing, and says why
  for (const ev of ['click', 'change', 'keydown']) body.addEventListener(ev, e => {
    const el = e.target.closest?.('[data-lockoff]');
    if (!el || (ev === 'keydown' && !['Enter', ' '].includes(e.key))) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (ev === 'click') lockedHint();
  }, true);
  body.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.secon) setSection(t.dataset.secon, t.checked);
    else if (t.dataset.jobon){ const id = t.dataset.jobon, on = t.checked; commit(d => T.setJobOn(d.record, d.cur, id, on), on ? tr('undo.showJob') : tr('undo.hideJob')); }
    else if (t.dataset.on){ const id = t.dataset.on, on = t.checked; setBullet(id, on); }
    else if (t.id === 'b-on') setBullet(C.ui.sel.id, t.checked);
    else if (t.dataset.photo !== undefined) C.togglePhoto();
    else if (t.dataset.item){ const id = t.dataset.item, on = t.checked; commit(d => T.setItemOn(d.record, d.cur, id, on), on ? tr('undo.turnOn') : tr('undo.turnOff')); }
    else if (t.id === 'sk-set'){
      if (t.value === '~record') commit(d => T.clearArrangement(d.record, d.cur), tr('ux6c.undoStartFrom'), tr('ux6c.setCleared'));
      else if (t.value){ const name = t.value; commit(d => T.applySet(d.record, d.cur, name), tr('ux6c.undoStartFrom'), tr('ux6c.setApplied', { name: jobTypeLabel(rec(), name) })); }
    }
    else if (t.id === 'sk-tag'){ const b = $('[data-act=sk-del]'); if (b) b.disabled = !t.selectedOptions[0]?.dataset.set; }      // the button follows the tag chosen
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
    if (t.classList?.contains('skchip') && e.altKey && e.key.startsWith('Arrow')){
      e.preventDefault(); e.stopPropagation();
      const g = t.dataset.g, k = Number(t.dataset.k), ids = T.arrangementOf(rec(), cur()).groups.map(x => x.id), at = ids.indexOf(g);
      const n = (id, i) => T.arrangementOf(rec(), cur()).groups.find(x => x.id === id)?.items.length ?? i;
      const to = e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? [g, k + (e.key === 'ArrowLeft' ? -1 : 1)]
        : e.key === 'ArrowUp' ? [ids[at - 1], n(ids[at - 1], 0)] : [ids[at + 1], 0];
      if (to[0] && to[1] >= 0 && (to[0] !== g || to[1] < n(g, 0)) && moveSkillBy(g, k, to[0], to[1])) E.chip = { g: to[0], k: to[1] };
      return;
    }
    if ((t.id === 'sec-label' || t.id === 'term-in') && e.key === 'Enter'){ e.preventDefault(); t.blur(); }
    if (t.id === 'sec-label' && e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); t.value = T.labelOf(rec(), cur(), t.dataset.sid, lang()) ?? ''; t.blur(); }
    if (t.id === 'term-in' && e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); t.value = T.termOf(cur(), t.dataset.key.slice(3)) ?? ''; t.blur(); }
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
    if (t.id === 'term-in') renameTerm(t.dataset.key, t.value);
    if (t.id === 'sec-label') rename(t.dataset.sid, t.value);
  });

  body.addEventListener('dragstart', e => {
    const sk = e.target.closest?.('.skchip[draggable=true]');
    if (!sk) return;
    E.dragSkill = { g: sk.dataset.g, k: Number(sk.dataset.k) }; sk.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', sk.textContent);
  });
  body.addEventListener('dragover', e => {
    if (!E.dragSkill) return;
    const chip = e.target.closest?.('.skchip'), box = chip?.parentElement ?? e.target.closest?.('.skchips');
    if (!box) return;
    e.preventDefault();
    for (const n of body.querySelectorAll('.drop-above, .drop-below')) n.classList.remove('drop-above', 'drop-below');
    if (chip){ const bb = chip.getBoundingClientRect(); chip.classList.add(e.clientX < bb.left + bb.width / 2 ? 'drop-above' : 'drop-below'); }
  });
  body.addEventListener('drop', e => {
    if (!E.dragSkill) return;
    const from = E.dragSkill, chip = e.target.closest?.('.skchip'), box = chip?.parentElement ?? e.target.closest?.('.skchips');
    E.dragSkill = null;
    if (!box) return;
    e.preventDefault();
    const to = box.closest('.skgroup').dataset.g, at = chip ? Number(chip.dataset.k) + (chip.classList.contains('drop-below') ? 1 : 0) : box.children.length;
    moveSkillBy(from.g, from.k, to, to === from.g && at > from.k ? at - 1 : at);
  });
  body.addEventListener('dragend', () => {
    E.dragSkill = null;
    for (const n of body.querySelectorAll('.dragging, .drop-above, .drop-below')) n.classList.remove('dragging', 'drop-above', 'drop-below');
  });
}

function setBullet(id, on){
  C.ui.morph = { kind: 'tick' };       // the page shows the change moving (src/ui/pagemotion.js)
  commit(d => T.setBulletOn(d.record, d.cur, id, on), on ? t('undo.turnOn') : t('undo.turnOff'));
}

function rename(id, value){
  const L = lang(), key = `~h:${id}`, txt = String(value ?? '').trim();
  const now = T.labelOf(rec(), cur(), id, L) ?? '';
  const same = !txt || txt === T.recordTitle(rec(), id, L);
  if ((same && !now) || txt === now) return;
  commit(d => T.setLabel(d.record, d.cur, key, L, txt), t('undo.renameSection'),
    same ? t('toast.headingReset') : t('toast.renamedHere', { lang: LANG_NAME[L] ?? L, id }));
}
// a language's name in the sidebar's box: the same, without the note
function renameTerm(key, value){
  const L = lang();
  if (String(value ?? '').trim() === (T.termOf(cur(), key.slice(3)) ?? '')) return;
  commit(d => T.setLabel(d.record, d.cur, key, L, value), t('ux6c.undoLabel'));
}

// The commands behind Alt+↑ / Alt+↓, the ↑ ↓ buttons and the margin's arrows: one step, one undo step. They return whether anything moved.
// …and the same to a place: the grips on the page drop a job, a section or an item before another (null: last)
function moveJobBy(id, before){
  let r;
  commit(x => { r = T.moveEntry(x.record, x.cur, id, before); }, t('ux2.undoMoveItem'));
  if (r){ C.flash(T.sectionOfEntry(rec(), id)); if (r.auto) C.toast(autoNote(r).trim()); }
  return !!r;
}
function moveSectionBy(id, before){
  let r;
  commit(x => { r = T.moveSection(x.record, x.cur, id, before); }, t('undo.moveSection'));
  if (r){ C.flash(id); if (r.auto) C.toast(autoNote(r).trim()); }
  return !!r;
}
function moveItemBy(sid, id, before){
  let ok = false;
  commit(x => { T.moveItem(x.record, x.cur, sid, id, before); ok = true; }, t('ux2.undoMoveItem'));
  if (ok) C.flash(sid);
  return ok;
}
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
// ---- a locked block in the sidebar ----
const SOFT = '#c-pos, #c-org, #c-start, #c-end, #c-current, #c-during, #c-loc, #c-wurl, #c-wdesc, #c-wsum, [data-act=c-arch-entry], #c-lname, #c-level, #c-slevel, #c-cname, #c-date, #c-expires, #c-gname, #c-issuer, #c-pname, #c-publisher, #c-url, #c-kw, #c-kw-in, [data-act=c-kw-rm], [data-act=c-del-item], [data-act=c-del-entry], [data-act=c-tag-add], [data-act=c-tag-del]';
// Every row of the Outline gets its padlock (a locked ancestor shows its children locked, greyed, with the lock inherited); a locked row's
// tick, move buttons and drag are off. A locked block's own view has its switches, its versions and its removal off, with the reason.
function lockPass(){
  const body = $('#body');
  if (!body || C.ui.snap) return;
  const rec_ = !C.ui.view;      // the Outline's rows are in the Edit view only; the Record view's own fields are held below
  const why = t('ux6c.lockedTip');
  const off = (el, tip = why) => {
    if (el.matches('input, select, textarea, button')) el.disabled = true;
    else { el.removeAttribute('data-act'); el.removeAttribute('data-v'); el.removeAttribute('tabindex'); el.setAttribute('aria-disabled', 'true'); }
    el.title = tip;
  };
  for (const row of rec_ ? body.querySelectorAll('.clrow, .srow[data-sid], section.clg[data-g]') : []){
    const id = row.dataset.fact || row.dataset.item || row.dataset.sid || (ix().work.has(row.dataset.g) ? row.dataset.g : '');
    if (!id) continue;
    const host = row.matches('section.clg') ? row.querySelector(':scope > .clgh') : row;
    if (!host) continue;
    const by = lockBy(id), name = t(by ? 'ux6c.unlockX' : 'ux6c.lockX', { name: lockName(id) });
    const inh = by && by !== id ? t('ux6c.lockedUnder', { name: lockName(by) }) : null;
    const tick = host.querySelector(':scope > .cb, :scope > .cbnone, :scope > .swl');      // the padlock comes before the tick, as on the page chip
    (tick ?? host).insertAdjacentHTML(tick ? 'beforebegin' : 'beforeend', `<button type="button" class="rowlock${by ? ' is-locked' : ''}${inh ? ' inherited' : ''}" data-act="row-lock" data-id="${esc(id)}" aria-pressed="${by !== null}"${inh ? ' aria-disabled="true"' : ''} aria-label="${esc(inh ?? name)}" title="${esc(inh ?? name)}">${icon(by ? 'lock' : 'unlock', { size: 12 })}</button>`);
    if (!by) continue;
    host.classList.add('is-locked'); if (by !== id) host.classList.add('is-inherited');
    host.draggable = false;
    for (const el of host.querySelectorAll('input[type=checkbox]')) if (el.checked || by !== id || el.dataset.on){ el.disabled = true; el.title = why; }      // a hidden locked block can be shown again
  }
  // an unlocked block that holds a locked line cannot be hidden either
  for (const row of rec_ ? body.querySelectorAll('.clrow, .srow[data-sid], section.clg[data-g]') : []){
    const id = row.dataset.fact || row.dataset.item || row.dataset.sid || (ix().work.has(row.dataset.g) ? row.dataset.g : '');
    if (!id || lockBy(id) || !LK.lockedInside(rec(), cur(), id)) continue;
    for (const el of row.querySelectorAll('input[type=checkbox]:checked')) if (el.closest('.clrow, .srow[data-sid], section.clg[data-g]') === row){ el.disabled = true; el.title = t('ux6c.lockedInside'); }
  }
  const sel = C.ui.sel, id = lockIdOf(sel);
  if (sel.kind === 'none' || !isLockedId(id)) return;
  const note = `<p class="note locknote" id="locknote">${esc(t('ux6c.lockedNote'))}</p>`;
  if (body.querySelector('.depth')) body.querySelector('.depth').insertAdjacentHTML('afterend', note); else if (!rec_) body.querySelector('#c-lname, #c-pos, #c-slevel, #c-cname, #c-gname, #c-pname')?.closest('.field, label, div')?.insertAdjacentHTML('beforebegin', note);
  // the Record's own fields of the block: kept in the tab order, read-only, with the reason attached (a disabled control can't be focused)
  for (const el of body.querySelectorAll(SOFT)){
    el.setAttribute('aria-disabled', 'true'); el.setAttribute('aria-describedby', 'locknote'); el.title = why;
    if (el.matches('input:not([type=checkbox]):not([type=radio]), textarea')) el.readOnly = true;
    else if (el.matches('button, [data-act]')){ el.removeAttribute('data-act'); el.dataset.lockoff = '1'; }
    else el.dataset.lockoff = '1';      // a checkbox or a select: the capture listener in bind() holds it
  }
  for (const el of body.querySelectorAll('#b-on, #sec-label, #term-in, #sk-set, #ed-new, [data-act="write-in"], .ctlrow > .swl > [data-jobon], .ctlrow > .swl > [data-secon], .skchip, .vlist .vrow, .vlist button, .vlist input, [data-act="local-remove"], [data-act="keep"], [data-act="delete-claim"], [data-act="archive-claim"], [data-act="label-reset"], [data-act="label-all"], [data-act^="sk-"]')) off(el);
}
function key(e){
  // writing a line on the page: Esc leaves it for the job, keeping what was typed, wherever the focus is
  if (e.key === 'Escape' && E.edit && !E.edit.panel){ e.preventDefault(); cancelEdit(); return true; }
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')
    && (C.ui.sel.kind === 'section' || document.activeElement?.closest?.('.clrow[data-item], .clrow[data-bullet], .clgh[data-job]') || (C.ui.sel.kind === 'bullet' && C.ui.sel.job) || (C.ui.sel.kind === 'record' && C.ui.sel.what === 'item'))){
    e.preventDefault(); return moveWhatIsHere(e.key === 'ArrowDown' ? 1 : -1);
  }
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && keyOf(C.ui.sel) && !E.edit && document.body.dataset.phone !== 'true'){ e.preventDefault(); startEdit(); return true; }
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
  leaveLine: () => { if (E.edit) clearEdit(); }, moveLine: moveLineBy, moveGroup: moveGroupBy, moveSkill: moveSkillBy, stepBullet: stepBulletBy, stepGroup: stepGroupBy, addGroup,
  outlineView, noneView, lensBox, sectionView, jobView, bulletView, factPanel, act, bind, key, stepJob: stepJobBy, stepSection: stepSectionBy, stepItem: stepItemBy, moveJob: moveJobBy, moveSectionTo: moveSectionBy, moveItemTo: moveItemBy, lockedId: isLockedId, lockIdOf, lockName, stepLine: d => E.edit && stepBulletBy(E.edit.fact, d), leaving, startEdit, addLine, cancelEdit, isDirty, draftChanged, pickWhileWriting, depthHtml, fieldName, multiline,
  get editing(){ return E.edit; },
  claimDraftOf: id => E.claimDrafts.get(id) ?? '',
  afterRender(){
    lockPass();
    if (E.edit && $('#ed') && document.activeElement?.id !== 'ed') focusEditor(); else if ($('#ed')) autosize($('#ed'));
    // a skill moved with the keyboard keeps the focus, where it landed (it may have left its group empty: that group is gone)
    if (E.chip){ const c = document.querySelector(`#body .skchip[data-g="${CSS.escape(E.chip.g)}"][data-k="${E.chip.k}"]`); E.chip = null; c?.focus(); }
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
