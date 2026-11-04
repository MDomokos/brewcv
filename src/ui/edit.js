// The Edit view: what the body card shows for the resume, a section, a job and a bullet, and what its
// controls do. One panel for a claim wherever you came from: the page, the record checklist below it, or
// the timeline. Every change is one store commit, so one undo step. Typing is not a change until it is saved.

import * as R from '../model/record.js';
import * as MK from '../model/marks.js';
import * as T from '../model/resume.js';
import * as LK from '../model/lock.js';
import { key as measureKeyOf } from '../fit.js';
import { missingList, writeInPlan, matchPlan, isSame, sameKey, setSame, langName, writeIn, DEFAULT_LANG } from '../model/lang.js';
import { groupOf, inGroup, groupOpts, parentOf, setInStep, matchVersion, keepLabelAs, prints, resumeLabel, nameFrom, wordOf } from '../model/resumes.js';
import * as K from '../model/career.js';
import { recordSelOfFact, factOfRecordSel, groupOf as recordGroupOf } from '../model/checklist.js';
import { keyOf, isLabelKey } from './select.js';
import { t, h, errText } from '../i18n/index.js';
import { askIfLocked } from './ask.js';
import { play, played, reduced } from './motion.js';
import { icon } from './icons.js';
import { pageSize } from './layout.js';
import { esc, clip, depthHtml as depthMarkup, sw, missBar, versionsHtml, delBtn, delAskHtml, labelChangedHtml, topHtml, gist } from './parts.js';

let C = null;
export function initEdit(ctx){ C = ctx; return api; }

const $ = s => document.querySelector(s);
const LANG_NAME = new Proxy({}, { get: (_, l) => langName(l) });

// the editor and the panel's own view state; none of it is undone
const E = { armed: null, justOff: null, writeIn: null, enter: null, edit: null, compare: null, openMinor: new Set(), fold: new Map(), foldAuto: null, softShown: null, softOpen: null, guardOn: true, autoFold: true, timer: null, claimDrafts: new Map(), delAsk: null, useOpen: new Set() };

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
  if (ed.label) return keepLabel(ed);
  if (!isDirty(ed) || !ed.draft.trim()) return;      // an emptied line keeps what it had: the last kept edit, or the version's words
  const text = ed.draft.trim(), base = ix().variants.get(ed.vid), here = text !== base?.text.trim() || marksChanged(ed);
  C.ui.previewing = false;
  commit(d => {
    if (here && !T.isLocal(d.cur, ed.fact)) T.stackOverride(d.record, d.cur, ed.fact);      // the edit it follows stays a row of its own
    if (here) return T.setOverride(d.record, d.cur, ed.fact, text, { marks: marksFor(ed, text), base: base?.id ?? null });
    T.dropOverride(d.record, d.cur, ed.fact);
    if (base && usingOf(ed.fact)?.id !== base.id) T.pickVersion(d.record, d.cur, ed.fact, base.id);
  }, t('edit.thisOnly'), here ? t('ux6f.savedHere', { where: t('ux6g.onlyHere') }) : undefined, true);      // one wording with the pending row: the toast says where it was saved, with Undo
}
// A heading or a language's name written on the page: kept on this resume in its language, as one undo step. The record's own words reset it.
function keepLabel(ed){
  if (!isDirty(ed) || !ed.draft.trim()) return;
  C.ui.previewing = false;
  commit(d => T.setLabel(d.record, d.cur, ed.fact, ed.lang, ed.draft), t('ux6c.undoLabel'));
}
// the highlights of the text the line started from, moved onto what was typed (a mark whose words are gone is dropped)
// (highlights set by hand, ed.mk, are anchored to the text they were set on, so what is typed after moves them too)
const marksFor = (ed, text) => { const from = ed.mk ? ed.mk.text : ed.mode === 'new' ? ed.copyOf : ed.base; return R.reanchor(ed.mk ? ed.mk.marks : ed.marks, from, text, m => m.expect ?? [...from].slice(m.start, m.end).join('')); };
// the highlights were changed by hand (not only moved by typing): they differ from those the line started with, on the same words
const marksChanged = ed => {
  if (!ed.mk) return false;
  const was = R.reanchor(ed.marks, ed.mode === 'new' ? ed.copyOf : ed.base, ed.draft, m => m.expect ?? [...(ed.mode === 'new' ? ed.copyOf : ed.base)].slice(m.start, m.end).join(''));
  return JSON.stringify(was.map(m => [m.start, m.end])) !== JSON.stringify(marksFor(ed, ed.draft).map(m => [m.start, m.end]));
};
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

// In a group of language copies every language is checked, English too (src/model/resumes.js groupOf)
const grouped = () => inGroup(C.store.state, cur());
const missingNow = () => (lang() === DEFAULT_LANG && !grouped() ? [] : missingList(work(), cur(), groupOpts(C.store.state, cur())));
// An old copy of a resume in another language (made before copies were kept in step): the switch that puts it in step
const stepOffer = () => {
  const r = cur(), p = r?.inStep ? null : parentOf(C.store.state, r);
  return p && (p.lang ?? DEFAULT_LANG) !== (r.lang ?? DEFAULT_LANG) ? { name: C.resumeName(p) } : null;
};
const missingBar = () => missBar({ lang: lang(), list: missingNow(), group: grouped(), offer: stepOffer() });
// A heading, a language's name or a skill group's name written against text that has changed since (the list's kind 'heading-changed'): its note
// shows the other language's old words struck through and the new ones marked, with the way to keep this one as it is. Writing the label
// again saves it against the new words (src/model/resumes.js noteLabels).
const changedLabels = pred => (grouped() ? missingNow().filter(m => m.kind === 'heading-changed' && pred(m.labelKey)) : []);
const labelNotes = pred => changedLabels(pred).map(labelChangedHtml).join('');
// the lines a write-in box is for: a text the language has no version of at the number the line prints, or an older one
const isLineMiss = m => m.kind === 'fact' || m.kind === 'behind';

// The Outline: this resume in print order: the sections (checklist.js outlineHtml), then a slim row with the page lock.
function outlineView(){
  return `${C.newerBanner()}${missingBar()}
    ${C.outlineHtml()}
    <div class="pagerow">${pageLockHtml('rowend')}</div>`;
}
// the whole page's padlock: Edit with nothing selected has it
function pageLockHtml(cls = ''){
  if (C.ui.snap) return '';
  const on = lockBy(LK.PAGE) !== null, name = t(on ? 'ux6c.unlockX' : 'ux6c.lockX', { name: t('ux6c.thePage') });
  const btn = `<button type="button" class="sm ghost pagelock${on ? ' is-locked' : ''}${cls ? ' ' + cls : ''}" data-act="lock-toggle" data-id="${LK.PAGE}" aria-pressed="${on}" aria-label="${esc(name)}" title="${esc(t(on ? 'uxr.locked' : 'uxr.unlocked'))}">${icon(on ? 'lock' : 'unlock', { role: 'inline' })}${cls ? '' : `<span>${esc(t(on ? 'ux6c.pageLocked' : 'ux6c.lockPage'))}</span>`}</button>`;
  return cls ? btn : `<p class="lockbar">${btn}</p>`;      // in the Outline it is an icon at the right of a slim row of its own; alone it has a line of its own
}
// Edit with nothing selected: what this resume is for, and one line on how to pick a line
function noneView(){
  const r = cur();
  return `${C.newerBanner()}${missingBar()}
    <h2 class="title">${esc(C.resumeName(r))}</h2>
    ${pageLockHtml()}
    <p class="lead edithint">${h('ux5c.editNone')}</p>`;
}

// bullets and prose run over several lines; the other texts are one line
const multiline = ed => !ed.label && (!!T.jobOfFact(rec(), ed.fact, cur()) || ix().summaries.has(ed.fact));
// The accessible name of a text written on the page: the heading of its section and what it is there (Education, degree)
function fieldName(ed){
  const id = ed.fact, of = (sec, what) => `${sec}, ${what}`, secOf = sid => C.sectionTitle(sid);
  if (ed.label) return id.startsWith('~h:') ? of(secOf(id.slice(3)), t('ux6c.n.heading')) : id.startsWith('~g:') ? of(secOf('skills'), t('ux6c.n.group')) : of(secOf(ix().owned.get(id.slice(3))), t('ux6c.n.name'));
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
const lineName = id => (id.startsWith('~g:') ? T.labelNow(rec(), cur(), id, lang()) : id.startsWith('~t:') ? T.labelNow(rec(), cur(), id, lang()) : '') || (ix().skillGroups.has(id) ? T.printedLabel(rec(), cur(), `~g:${id}`) : '')
  || ix().facts.get(id)?.summary || C.textOfFact(id) || (T.isLocal(cur(), id) ? t('ux6c.newLine') : id);

// One depth indicator: the levels of what is selected, from the page down. The chip on the page and the row at the top of
// the editor card are one component (parts.js depthHtml): general, in single words (Page › Experience › Hydra, Page › Skills › CAD, no
// line level); the card's title under it names the content in full. A level with deeper ones carries them (`kids`, the Outline's rows) and the one
// the selection came through (`came`): its list goes deeper or sideways, its word goes up.
function depth(sel = C.ui.sel){
  const kids = (kind, id, came) => ({ kids: C.depthKids?.(kind, id) ?? [], came });
  const at = id => `data-id="${esc(id)}"`;
  const jobId = sel.kind === 'job' ? sel.id : sel.kind === 'bullet' ? sel.job ?? sel.owner : null;
  const item = sel.kind === 'record' && sel.what === 'item';       // a skill group, a language: an item of a list section
  const sid = sel.kind === 'section' ? sel.id : sel.kind === 'bullet' ? sel.section ?? 'summary' : jobId ? T.sectionOfEntry(rec(), jobId) : item ? T.sectionOfItem(rec(), sel.id) : null;
  const word = s => clip(String(s ?? '').trim().split(/\s+/)[0].replace(/[,.;:]+$/, ''), 12);
  const jw = jobId && ix().work.get(jobId), jobName = jw?.name ?? jw?.organization ?? jw?.entity ?? jobId;
  // an item's word ties to its real content; a date line is Dates; a language's or reference's text takes its pair's name
  const itemWord = id => word(id.startsWith('~t:') || id.startsWith('~g:') || ix().skillGroups.has(id) ? lineName(id) : /-meta$/.test(id) ? t('ux6c.f.dates') : ix().sections.get(ix().owned.get(id))?.kind === 'pairs' ? lineName(`~t:${id}`) : C.textOfFact(id) || lineName(id));
  // the header's field the selection is on: Name, Headline, Contact or Photo
  const field = sel.kind === 'header' ? (sel.id ? t(`ux6c.f.${sel.id}`) : null) : sel.kind === 'bullet' ? Object.entries(rec().basics?.display ?? {}).map(([k, f]) => (f === sel.id ? t(`ux6c.f.${k}`) : null)).find(Boolean) : null;
  const fieldLevel = field && { word: field, ...(sel.kind === 'bullet' ? { act: 'select-fact', attrs: `${at(sel.id)} data-section="header"` } : { act: 'select-header' }) };
  const L = [{ word: t('ux3.crumbPage'), act: 'deselect', ...kids('page', null, sel.kind === 'header' ? 'header' : sid) }];
  if (sel.kind === 'header' || sid === 'header'){ L.push({ word: t('ux6c.header'), act: 'select-header', ...kids('section', 'header', sel.kind === 'bullet' ? sel.id : null) }); if (fieldLevel) L.push(fieldLevel); }
  else if (sid) L.push({ word: word(C.sectionTitle(sid)), act: 'select-section', attrs: at(sid), ...kids('section', sid, jobId ?? (sel.kind === 'section' ? null : sel.id)) });
  if (jobId) L.push({ word: word(jobName), act: 'select-job', attrs: at(jobId), ...kids('job', jobId, sel.kind === 'bullet' ? sel.id : null) });
  else if (item) L.push({ word: itemWord(sel.id), act: 'select-record', attrs: `${at(sel.id)} data-what="item" data-group="${esc(sel.group ?? '')}"` });
  else if (sel.kind === 'bullet' && sid !== 'header' && sid !== 'summary') L.push({ word: itemWord(sel.id), act: 'select-fact', attrs: `${at(sel.id)} data-section="${esc(sid ?? '')}"${sel.owner ? ` data-owner="${esc(sel.owner)}"` : ''}` });
  return L;
}
// `page`: the chip on the page (its own ids and name), else the card's
const depthHtml = (sel = C.ui.sel, { page = false } = {}) => depthMarkup(depth(sel), { where: page ? 'page' : 'card', back: page ? backOf() : null, ...chipTools(sel) });
// a selection above another on the same branch (Page, the section, the job of a line); the chip's "back" is set only then, never for a move sideways
const isAbove = (to, from) => { try { const a = depth(to), b = depth(from), k = l => `${l.act}|${l.attrs ?? ''}`; return (a.length < b.length || (to.kind === 'job' && from.kind === 'bullet')) && a.every((l, i) => k(l) === k(b[i])); } catch { return false; } };
const backOf = () => { const b = C.ui.back; if (!b) return null; try { return { word: depth(b.sel).at(-1).word }; } catch { return null; } };

// ---- the lock ----
// the id the padlock holds for a selection: the block the chip names (a heading is its own block)
function lockIdOf(sel = C.ui.sel){
  switch (sel.kind){
    case 'none': return LK.PAGE;
    case 'header': return sel.id ?? 'header';
    case 'job': return sel.id;
    case 'section': return sel.heading ? `~h:${sel.id}` : sel.id;
    case 'bullet': return sel.section === 'skills' ? sel.id.replace(/^~g:/, '') : sel.id;      // a skill group's heading is held by the group's lock
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
function chipTools(sel){
  const id = !C.ui.snap && lockIdOf(sel);
  if (!id) return {};
  const lv = depth(sel).at(-1), by = lockBy(id), s = showOf(sel);
  // the page's chip stops at the job: a line in it is named for what it is
  const name = sel.kind === 'section' && sel.heading ? lockName(id) : sel.kind === 'bullet' && sel.job ? t('ux6c.lineIn', { name: lockName(sel.job) }) : lv.name ? `${lv.word} ${lv.name}` : lv.word;
  return { lock: { id, on: by !== null, name, byName: by !== null && by !== id ? lockName(by) : null }, show: s ? { ...s, name, disabled: switchHeld(s.kind, s.id, s.on) } : null, fix: fixTool(sel, id, name, by !== null) };
}
// The tool beside the padlock that undoes what was done here: an edit put back to the record's words (a line or header field, a heading,
// a language's name), a line only on this resume or a skill group removed. Held while the block is locked.
function fixTool(sel, id, name, held){
  const key = keyOf(sel), group = ix().skillGroups.has(id);
  const revert = { act: 'chip-revert', icon: 'replay', name: t('ux6c.revertX', { name }), disabled: held };
  if (isLabelKey(key)) return (key.startsWith('~h:') ? T.labelOf(rec(), cur(), key.slice(3), lang()) != null : key.startsWith('~g:') ? !!(cur().skillArrangement?.groups ?? []).find(g => g.id === key.slice(3))?.label : T.termOf(cur(), key.slice(3)) != null) ? revert : null;
  if (sel.kind !== 'bullet' && !(sel.kind === 'record' && group)) return null;
  if (group) return { act: 'chip-remove', icon: 'delete', del: true, name: t('ux6c.removeX', { name: t('ux6c.theGroup', { name: clip(lineName(id) === id ? t('ux6c.newGroup') : lineName(id), 30) }) }), disabled: held };
  if (T.isLocal(cur(), id)) return { act: 'chip-remove', icon: 'delete', del: true, name: t('ux6c.removeX', { name }), disabled: held };
  return overrideOf(id) !== undefined ? revert : null;
}
// What the padlock of a lock id selects: the block it holds.
const selOfLock = id => (id === LK.PAGE ? { kind: 'none' } : id.startsWith('~h:') ? { kind: 'section', id: id.slice(3), heading: true } : ix().work.has(id) ? { kind: 'job', id } : ix().sections.has(id) ? { kind: 'section', id } : null);
// Lock or unlock: what is being written is kept first. A lock an ancestor holds is not lifted from here: it says so and selects the ancestor.
function lockToggle(id){
  const by = lockBy(id);
  if (by !== null && by !== id){
    const s = selOfLock(by); if (s) C.select(s);
    lockSaid([id, by], t('ux6c.lockedUnder', { name: lockName(by) }));
    return;
  }
  const on = by === null;
  clearEdit();
  commit(d => LK.setLocked(d.cur, id, on), on ? t('ux6c.undoLock') : t('ux6c.undoUnlock'));
  const name = id === lockIdOf() ? chipTools(C.ui.sel).lock.name : lockName(id);      // as the chip names it
  C.say(on ? t('ux6c.nowLocked', { name }) : t('ux6c.nowUnlocked', { name }));
  lockMotion(id, on ? 'lock' : 'unlock');
}
// No sentence explains a lock, the lock itself answers. Every padlock of a block on screen (the Outline's row, the
// page chip, the depth row, the page lock), once the redraw is in: locking drops the shackle in and sends a ring out, unlocking lifts it; a click on locked or guarded
// text wobbles the lock, sends a ring out of it and flashes the block's plate once in the lock's accent (the live region keeps the sentence). A short "Locked" toast
// only where no lock is on screen to move. Nothing moves under reduced motion.
const padlocks = id => [...document.querySelectorAll('[data-act=row-lock], [data-act=lock-toggle]')].filter(b => b.dataset.id === id && b.getClientRects().length);
const accentOf = b => (b && getComputedStyle(b).getPropertyValue('--accent').trim()) || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || 'currentColor';
const ring = b => play(b, [{ boxShadow: `0 0 0 0 ${accentOf(b)}` }, { boxShadow: '0 0 0 7px transparent' }], { ms: 'slow', kind: 'arrive', name: 'lock:ring' });
function lockMotion(id, how){
  requestAnimationFrame(() => requestAnimationFrame(() => { for (const b of padlocks(id)){
    if (how === 'shake'){ wobble(b); continue; }
    const shackle = b.querySelector('svg path');
    if (shackle) play(shackle, how === 'lock' ? [{ transform: 'translateY(-3px)' }, { transform: 'none' }] : [{ transform: 'translateY(1px)' }, { transform: 'translateY(-2px)' }, { transform: 'none' }], { ms: 'base', kind: 'arrive', name: `lock:${how}` });
    ring(b);
  } }));
}
const wobble = b => { play(b, [{ transform: 'rotate(0)' }, { transform: 'rotate(-16deg)' }, { transform: 'rotate(12deg)' }, { transform: 'rotate(-6deg)' }, { transform: 'rotate(0)' }], { ms: 'base', kind: 'move', name: 'lock:shake' }); ring(b); };
// the block's plate flashes once in the lock's accent (about 300 ms; the plate is the selected one: a click on the block selected it)
const flashPlate = lock => { const p = C.sheet.plates().find(q => q.role === 'sel' || q.role === 'write'); if (p) play(p.div, [{ backgroundColor: `color-mix(in srgb, ${accentOf(lock)} 32%, transparent)` }, {}], { ms: 300, kind: 'arrive', name: 'lock:flash' }); };
// `soft`: the guard's small lock (.obsoft) on the page is one of the locks; `ids`: the block's own and its locked ancestor's
function lockShow(ids, { soft = false } = {}){
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const locks = [...new Set(ids.filter(Boolean))].flatMap(padlocks);
    if (soft) locks.push(...document.querySelectorAll('#editlay .obsoft'));
    for (const b of locks) wobble(b);
    flashPlate(locks[0]);
    if (!locks.length) C.toast(t('uxr.locked'), 'warn');
  }));
}
const lockSaid = (ids, text) => { C.say(text); lockShow(ids); };
// a click on locked text selects its block and says why nothing is written
function lockedHint(sel = C.ui.sel){
  const id = lockIdOf(sel), by = lockBy(id);
  lockSaid([id, by], by && by !== id ? t('ux6c.lockedWith', { name: lockName(by) }) : t('ux6c.lockedHint'));
}
// the chip's switch (show or hide)
function chipOn(kind, id){
  const on = kind === 'section' ? T.sectionList(rec(), cur()).find(x => x.id === id)?.on : kind === 'job' ? jobOn(id) : kind === 'line' ? isOn(id) : !!showOf({ kind: 'bullet', id })?.on;
  if (switchHeld(kind, id, !!on)) return lockedHint({ kind: kind === 'line' ? 'bullet' : kind, id });
  if (kind === 'section') setSection(id, !on);
  else if (kind === 'job') commit(d => T.setJobOn(d.record, d.cur, id, !on), !on ? t('undo.showJob') : t('undo.hideJob'));
  else if (kind === 'line') setBullet(id, !on);
  else commit(d => T.setItemOn(d.record, d.cur, id, !on), !on ? t('undo.turnOn') : t('undo.turnOff'));
  if (on) goUp(kind, id);
}
// Turning off what is selected goes up a level: the card shows the parent, the old card shrinks into the row of what was turned off, and that row
// is marked (its own wash, a ring on its tick) for 3 s, held while the pointer is on it (CSS .is-just). Nothing else is said.
const UP_MS = 350, JUST_MS = 3000;
function goUp(kind, id){
  const sel = C.ui.sel;
  const here = kind === 'line' ? sel.kind === 'bullet' && sel.id === id : kind === 'job' ? sel.kind === 'job' && sel.id === id : kind === 'section' && sel.kind === 'section' && sel.id === id && !sel.heading;
  const up = !here ? null : kind === 'line' ? (sel.job ? { kind: 'job', id: sel.job } : null) : kind === 'job' ? { kind: 'section', id: T.sectionOfEntry(rec(), id) } : { kind: 'none' };
  if (!up) return;
  const body = $('#body'), r = body?.getBoundingClientRect();
  let pic = null;
  if (r?.width && !reduced()){      // the old card, as a picture, to shrink into its row
    pic = body.cloneNode(true); pic.removeAttribute('id'); pic.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
    pic.inert = true; pic.setAttribute('aria-hidden', 'true'); pic.classList.add('upshot');
    Object.assign(pic.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', maxHeight: 'none', overflow: 'hidden', transformOrigin: '0 0', zIndex: '12', pointerEvents: 'none' });
  }
  E.justOff = { kind, id, until: performance.now() + JUST_MS, at: keyOf(up), pic };
  C.select(up);
}
function markJust(){
  const j = E.justOff, body = $('#body');
  if (!j) return;
  const left = j.until - performance.now();
  if (left <= 0 || keyOf(C.ui.sel) !== j.at){ j.pic?.remove(); E.justOff = null; return; }
  const q = CSS.escape(j.id), row = j.kind === 'section' ? body.querySelector(`.osec:not(.is-cont) > .srow[data-sid="${q}"]`)
    : j.kind === 'job' ? body.querySelector(`[data-jobon="${q}"]`)?.closest('.item, .clgh') : body.querySelector(`.clrow[data-fact="${q}"]`);
  if (!row) return;
  row.classList.add('is-just'); row.style.animationDelay = `${Math.round(left - JUST_MS)}ms`;      // a redraw carries the fade on where it was
  row.addEventListener('animationend', e => { if (e.animationName === 'just-fade' && E.justOff === j) E.justOff = null; });
  row.scrollIntoView({ block: 'nearest' });
  const pic = j.pic; j.pic = null;
  if (!pic) return;
  document.body.append(pic);
  const a = pic.getBoundingClientRect(), b = row.getBoundingClientRect();
  pic.animate([{ transform: 'none', opacity: 1 }, { opacity: 1, offset: .6 }, { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width}, ${Math.max(.02, b.height / a.height)})`, opacity: 0 }], { duration: UP_MS, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished.finally(() => pic.remove());
  body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: UP_MS, easing: 'ease-out' });      // the parent's rows come in as the old card goes into its row
}

// The skills of this resume: its groups by name, in print order, under Position (src/ui/wordbank.js). The picked one takes the bank's words.
const skillsHtml = () => C.bank().namesHtml();
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
// A new empty skill group after `afterId` (null: at the end), picked, its heading written at once on the page. An empty group stays until deleted.
async function addGroup(afterId = null){
  clearEdit();
  let id;
  commit(d => { id = T.addSkillGroup(d.record, d.cur, afterId); }, t('ux6c.undoSkills'));
  if (!id) return false;
  C.work();
  await C.redrawNow?.();
  C.select({ kind: 'bullet', id: `~g:${id}`, section: 'skills' });
  if (C.ui.sel.id === `~g:${id}`) startEdit();
  return true;
}
// one skill of a group to a place in another group (the keyboard route, the drag in the sidebar and the drag on the page share it);
// `j` is its place there once it has left
function moveSkillBy(g, k, to, j){
  let ok = true;
  commit(d => { try { T.moveSkill(d.record, d.cur, g, k, to, j); } catch { ok = false; } }, t('ux6c.undoSkills'));
  return ok;
}

// The header of the section, job and line views: the card's top row (its tick and padlock are the block's only ones), then the name alone (a section's
// and a job's; a line is the page's own) and the few controls that belong to the block. `hue` colours the card; `off`: hidden on this resume.
const headHtml = (sel, hue, card, { off = false, title = '' } = {}) => `${topOf(sel)}<div class="hdr${off ? ' hoff' : ''}" style="--hk:${hue}">${title ? `<h2 class="title ctitle">${esc(title)}</h2>` : ''}${card ? `<div class="hcard">${card}</div>` : ''}</div>`;

// ---- the card's top row (parts.js topHtml): the tick and the padlock, the versions, ↑ ↓, ⋯ and the add, for what is selected ----
// the siblings a selection moves among, in print order (null where it moves among none)
const skillGroupSel = sel => sel.kind === 'bullet' && sel.section === 'skills';
const sibId = sel => (skillGroupSel(sel) ? sel.id.replace(/^~g:/, '') : sel.id);
function siblings(sel){
  const r = rec(), c = cur();
  if (skillGroupSel(sel)) return T.arrangementOf(r, c).groups.map(g => g.id);
  if (sel.kind === 'bullet') return sel.job ? T.listedBullets(r, c, sel.job) : null;
  if (sel.kind === 'job') return T.jobRefs(r, c, T.sectionOfEntry(r, sel.id)).map(x => (typeof x === 'string' ? x : x.id));
  if (sel.kind === 'section' && !sel.heading) return T.sectionList(r, c).filter(x => !x.fixed && x.on).map(x => x.id);
  if (sel.kind === 'record' && sel.what === 'item'){ const sid = T.sectionOfItem(r, sel.id); return sid ? (T.itemList(r, c, sid) ?? []).filter(x => x.on).map(x => x.id) : null; }
  return null;
}
function stepSel(d){
  const sel = C.ui.sel, id = sibId(sel);
  if (skillGroupSel(sel)) stepGroupBy(id, d); else if (sel.kind === 'bullet') stepBulletBy(id, d); else if (sel.kind === 'job') stepJobBy(id, d);
  else if (sel.kind === 'section') stepSectionBy(id, d); else if (sel.kind === 'record') stepItemBy(id, d);
}
// the line's versions in this language, where each differs from the one in use; an edit on this resume where it would be numbered
function versOf(sel){
  const id = sel.id;
  if (sel.kind !== 'bullet' || skillGroupSel(sel) || id.startsWith('~') || T.isLocal(cur(), id) || !ix().facts.has(id)) return null;
  const L = lang(), m = work(), over = overrideOf(id), using = usingOf(id), ref = over ?? using?.text ?? '';
  const miss = grouped() ? missingNow().find(x => x.id === id && isLineMiss(x)) : null;
  if (miss?.want && over === undefined) return { fact: id, miss: { n: miss.want, from: miss.from } };
  const items = R.versionsIn(m, id, L).map(v => { const now = over === undefined && v.id === using?.id; return { id: v.id, n: v.n, cur: now, gist: now ? esc(clip(v.text, 90)) : gist(v.text, ref) }; });
  const mine = over ?? cur().parked?.[id]?.text;
  if (mine !== undefined && String(mine).trim()){
    const n = R.suggestNumber(m, id, mine, L).n, at = items.findIndex(o => R.compareN(o.n, n) > 0);
    items.splice(at < 0 ? items.length : at, 0, { id: null, n, mine: true, cur: over !== undefined, gist: esc(clip(mine, 90)) });
  }
  const ed = E.edit?.fact === id && !E.edit.panel ? E.edit : null;      // a line being written says the version it was written from
  return { fact: id, n: (ed && m.variants.find(v => v.id === ed.vid)?.n) ?? items.find(o => o.cur)?.n ?? using?.n ?? '·', items: items.length > 1 ? items : [], locked: isLockedId(id), mine: over !== undefined };      // mine: the line prints an edit on this resume only
}
function moreOf(sel){
  const out = [];
  if (sel.kind === 'bullet' && isClaim(sel.id)){
    const kept = isKept(sel.id);
    out.push({ act: 'keep', label: t(kept ? 'card.unpin' : 'card.pin'), attrs: `aria-pressed="${kept}" title="${esc(t('edit.keepTitle'))}"` });
    out.push(isArch(sel.id) ? { act: 'unarchive-claim', label: t('arch.unarchive') } : { act: 'archive-claim', label: t('arch.archive'), attrs: `title="${esc(t('arch.archiveTitle'))}"` });
    out.push({ act: 'delete-claim', label: t('career.deleteClaim'), del: true });
  }
  if (sel.kind === 'section' && !sel.heading && T.labelOf(rec(), cur(), sel.id, lang())){
    const cap = x => x.charAt(0).toLocaleUpperCase(lang()) + x.slice(1);      // (sentence pieces elsewhere; a menu item of their own here)
    out.push({ act: 'label-reset', label: cap(t('edit.resetTo', { title: T.recordTitle(rec(), sel.id, lang()) })) }, { act: 'label-all', label: cap(t('edit.labelAll')) });
  }
  const g = sel.kind === 'job' || sel.kind === 'bullet' ? recordGroupOf(work(), sel) : null;
  if (g) out.push({ act: 'open-record', label: t('card.openCareer'), attrs: `data-g="${esc(g)}"` });
  return out;
}
// the section's Career kind: what a new entry of it is
const kindOfSection = sid => [...K.TIMELINE_KINDS, ...K.LIST_GROUPS, ...K.kindsOf(work()).map(k => k.id)].find(k => K.sectionFor(work(), k) === sid) ?? null;
// what "+ New …" adds here. A new line, version, skill or skill group is added in place; a new job, entry or section goes into the career record
// (`major`): its first press only says so, the second opens the add.
function addOf(sel){
  if (C.ui.snap) return null;
  if (sel.kind === 'none') return { label: t('card.newSection'), major: 'card.noteSection' };
  if (sel.kind === 'job') return jobOn(sel.id) ? { label: t('card.newLine') } : null;
  if (skillGroupSel(sel)) return { label: t('card.newSkill') };
  if (sel.kind === 'bullet') return ix().facts.has(sel.id) && !T.isLocal(cur(), sel.id) && !sel.id.startsWith('~') ? { label: t('card.newVersion') } : sel.job ? { label: t('card.newLine') } : null;
  if (sel.kind !== 'section' || sel.heading || ['header', 'summary'].includes(sel.id)) return null;
  if (sel.id === 'skills') return { label: t('card.newGroup') };
  const what = kindOfSection(sel.id);
  return what ? { label: t(what === 'work' ? 'card.newJob' : 'card.newEntry'), major: what === 'work' ? 'card.noteJob' : 'card.noteEntry', what } : null;
}
function topOf(sel = C.ui.sel){
  if (sel.kind === 'section' && sel.heading) sel = { kind: 'section', id: sel.id };      // a heading clicked beside its words: the card is the section's
  const ct = chipTools(sel), sib = siblings(sel), at = sib ? sib.indexOf(sibId(sel)) : -1, lv = depth(sel).at(-1);
  const line = sel.kind === 'bullet' && sel.job ? clip(C.textOfFact(sel.id) || lineName(sel.id), 40) : null;      // a job's line is named by its words, not by its job
  return topHtml({ name: line ?? (lv.name ? `${lv.word} ${lv.name}` : lv.word), lock: ct.lock, show: ct.show, fix: ct.fix, vers: versOf(sel),
    move: at >= 0 && sib.length > 1 ? { first: at === 0, last: at === sib.length - 1 } : null, more: moreOf(sel), add: addOf(sel) });
}
// the menus of the top row: one open at a time; a press elsewhere, Esc or a choice closes it
function closeTop(){
  for (const p of document.querySelectorAll('#body .cpop:not([hidden])')){ p.hidden = true; p.previousElementSibling?.setAttribute('aria-expanded', 'false'); C.endHover(); }
}
// "+ New …": the first press of a major add arms it (the pill says where it goes, a line under the row says what it does); a second within 5 s
// opens the add; a press elsewhere, Esc or 5 s puts it back
const ARM_MS = 5000;
function disarm(){
  if (!E.armed) return;
  clearTimeout(E.armed.t); E.armed = null;
  for (const b of document.querySelectorAll('#body [data-act=top-add].is-armed')){ b.classList.remove('is-armed'); b.innerHTML = b.dataset.was; }
  document.querySelectorAll('#body .cnote').forEach(n => n.remove());
}
function addNow(tg){
  const sel = C.ui.sel, a = addOf(sel);
  if (!a) return;
  if (a.major && !E.armed){
    E.armed = { t: setTimeout(disarm, ARM_MS) };
    tg.dataset.was = tg.innerHTML; tg.classList.add('is-armed'); tg.textContent = t('card.armed');
    (tg.closest('.ctop, .cnewrow') ?? tg).insertAdjacentHTML('afterend', `<p class="cnote">${esc(t(a.major))}</p>`);
    return;
  }
  disarm();
  if (sel.kind === 'none') C.careerAdd();      // a new section: Career's + Add, where every kind of section starts
  else if (a.what) C.select({ kind: 'add', what: a.what });      // the add form, in the editor
  else if (sel.kind === 'job') addLine(sel.id);
  else if (skillGroupSel(sel)) C.bank().addWordIn(sibId(sel));
  else if (sel.kind === 'section') addGroup(T.arrangementOf(rec(), cur()).groups.at(-1)?.id ?? null);
  else if (versOf(sel)){ clearEdit(); startEdit('new'); }
  else if (sel.job) addLine(sel.job, sel.id);
}

function sectionView(s, sel = s){
  const sec = ix().sections.get(s.id);
  if (!sec) return noneView();
  const L = lang();
  const list = T.sectionList(rec(), cur());
  const me = list.find(x => x.id === s.id);
  const movable = list.filter(x => !x.fixed);
  const isHeader = sec.kind === 'header';
  // its own list: the jobs or the items, each with a tick, a grip and ↑ ↓ (the Outline's rows)
  const inner = isHeader ? '' : s.id === 'skills' ? skillsHtml() : C.outlineHtml(null, s.id);
  const grouped = me && !me.fixed && me.on, info = C.sectionInfo(s.id);
  // the heading is written on the page; here only the switches that have no place there (the same heading in every language, grouped under the one before)
  const first = grouped && movable.find(x => x.on)?.id === s.id;
  const rows = `${!isHeader && L !== DEFAULT_LANG ? `<div class="ctlrow">${sw(`data-same="section:${esc(s.id)}"`, isSame(rec(), `section:${s.id}`), h('edit.sameHeading'))}</div>` : ''}${grouped ? `<div class="ctlrow hgrp" ${first ? `title="${esc(t('edit.groupFirst'))}"` : ''}>${sw(`data-secgroup="${esc(s.id)}"`, T.groupedOf(cur(), s.id), `<span class="gl" aria-hidden="true"><i></i><i></i></span>${h('edit.groupUnder')}`, first)}</div>` : ''}`;
  return `${headHtml(sel, info.hue, sel.kind === 'section' ? rows : '', { off: !!me && !me.fixed && !me.on, title: sel.kind === 'section' ? C.sectionTitle(s.id) : '' })}${labelNotes(k => k === `~h:${s.id}`)}
    ${me && !me.fixed && s.id === 'skills' ? `<div class="hposrow"><span class="grow"></span>${C.bank().delGroupHtml()}</div>` : ''}
    ${inner}`;
}

// `details: false`: the shell puts the job's own lines before the Details fold (src/ui/shell.js jobTail)
function jobView(s, { details = true } = {}){
  const w = ix().work.get(s.id);
  if (!w) return noneView();
  const on = jobOn(s.id);
  const sid = T.sectionOfEntry(rec(), s.id), pos = w.display?.position;
  // the title and the date line are written on the page; the card is named for the job
  return `${headHtml(s, C.sectionInfo(sid).hue, '', { off: !on, title: C.textOfFact(pos) || w.position || w.name || s.id })}${labelNotes(k => k.startsWith(`~f:work/${s.id}/`))}${details ? `\n    ${C.detailsHtml(s.id)}` : ''}`;
}

// A language's name, written on the page: its words here, and the record's to go back to
function termView(s){
  const L = lang(), fid = s.id.slice(3), own = T.termOf(cur(), fid) ?? '';
  return `${topOf(s)}
    <h2 class="title ctitle">${esc(T.labelNow(rec(), cur(), s.id, L))}</h2>
    <label class="field"><span class="lbl inline">${h('ux6c.termHere', { lang: LANG_NAME[L] ?? L })}</span>
      <input id="term-in" data-key="${esc(s.id)}" value="${esc(own)}" placeholder="${esc(T.recordTerm(rec(), fid, L))}" autocomplete="off"></label>
    <p class="muted small">${h('ux6c.termNote')}</p>${labelNotes(k => k === s.id)}`;
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
  const hue = C.sectionInfo(s.section ?? (s.job ? T.sectionOfEntry(rec(), s.job) : 'summary')).hue, off = !!w && !on;
  // a line that exists only on this resume has no versions: what it is, and the way to remove it (its tick is the chip's)
  if (T.isLocal(cur(), s.id)) return `${headHtml(s, hue, '', { off })}
    ${document.body.dataset.phone === 'true' ? versionsHtml(versionsX(s.id)) : ''}`;

  const ask = E.delAsk === s.id ? delAskHtml(t('ux6r.delClaimAsk', { name: clip(f.summary ?? s.id, 60), n: versionCount(s.id) }), 'data-act="delete-claim" data-sure="1"', t('ux1.delete'), 'data-act="delete-claim-no"') : '';
  return headHtml(s, hue, ask, { off })
    + labelNotes(k => k === `~g:${s.id}`) + versionsHtml(versionsX(s.id)) + entryLink(s.id);
}
const isClaim = id => ix().highlight.has(id) && !T.isLocal(cur(), id);
const versionCount = id => ix().facts.get(id)?.variants?.length ?? 0;      // every language's

// the versions of a fact, under an item's form
function factPanel(id){
  if (!ix().facts.has(id)) return '';
  return versionsHtml(versionsX(id));
}

// An edit on this resume, as the pending version it would become: its number where the Review list would put it, and the Review list's own
// choices for it (none for a line that is locked, held or off the page)
function pendOf(id, L, ed){
  const over = overrideOf(id);
  if (over === undefined || ed || T.isLocal(cur(), id) || !ix().facts.has(id)) return null;
  const free = !isLockedId(id) && C.pendingHtml && C.canPend(id);
  return { n: R.suggestNumber(work(), id, over, L).n, html: free ? C.pendingHtml(id) : '' };
}
// …and the line's earlier edits, each its own pending row, oldest first
function earlierRows(id, L, ed){
  if (ed || T.isLocal(cur(), id) || !ix().facts.has(id)) return [];
  const free = !isLockedId(id) && C.pendingHtml;
  return T.earlierOf(cur(), id).map((e, at) => ({ at, text: e.text, n: R.suggestNumber(work(), id, e.text, L).n, html: free && C.canPend(id, at) ? C.pendingHtml(id, at) : '' }));
}

// The versions list is folded by the person's last toggle of that claim (this session), else by a measure made once when the line is selected:
// folded when the whole list would not fit the height the panel has below its top (afterRender measures it). Not redecided on a resize or a language.
const folded = id => E.fold.get(id) ?? (E.foldAuto?.fact === id ? E.foldAuto.folded : (E.foldAuto = { fact: id, folded: undefined }).folded) ?? false;
// The write-in box of a group's line that prints the other language's version: its plan (src/model/lang.js writeInPlan), the way chosen and
// the text the box starts with. `open`: its number was clicked (with no version of this language it is always open).
function writeInX(id){
  if (!grouped() || !(missingNow().some(m => m.id === id && isLineMiss(m)) || isSame(work(), sameKey(id)))) return null;
  const plan = writeInPlan(work(), cur(), id), on = E.writeIn?.fact === id ? E.writeIn : null;
  if (!plan) return null;
  const others = [...new Set(groupOf(C.store.state, cur()).map(r => r.lang ?? DEFAULT_LANG))].filter(l => l !== lang()).map(langName).join(', ');
  const mp = plan.have ? null : matchPlan(C.store.state, cur(), id);      // this language may already have it, under another number
  return { plan, mode: on?.mode === 'match' && !mp ? 'translate' : on?.mode ?? 'translate', seed: on?.seed ?? null, open: !!on, others, match: mp && { ...mp, pick: on?.pick ?? null } };
}
// The saved resumes that print each version of a claim: Map(version id → [{ id, name }]), the name as "Role, Company · word". A line edited on one resume only counts for no version.
function usesOf(id){
  const m = work(), out = new Map();
  for (const r of C.store.state.resumes ?? []){
    if (r.overrides?.[id] !== undefined || !prints(m, r, [id])) continue;
    const vid = T.chooseVariant(m, id, r).v?.id;
    // an old "Company - Role" name reads role first; a name that is all word stays
    if (vid) out.set(vid, [...(out.get(vid) ?? []), { id: r.id, name: r.company && r.role && !(r.name && wordOf(r) === r.name) ? nameFrom({ company: r.company, role: r.role, word: wordOf(r) }) : resumeLabel(r) }]);
  }
  return out;
}
function versionsX(id){
  const L = lang();
  const using = usingOf(id);
  const ed = E.edit?.fact === id && E.edit.panel ? E.edit : null;       // the panel's own editor: only for a line that is not on the page
  const writing = E.edit?.fact === id && !E.edit.panel;
  const en = R.versionsIn(work(), id, DEFAULT_LANG);
  const vs = R.versionsIn(work(), id, L);
  return {
    pend: pendOf(id, L, ed), earlier: earlierRows(id, L, ed),
    m: work(), fact: id, lang: L, full: document.body.dataset.phone !== 'true',     // every version in full, with what differs marked (the phone's sheet keeps the gist)
    vs, using, folded: folded(id), over: overrideOf(id), parked: cur().parked?.[id]?.text, ed, writing,
    compare: E.compare, openMinor: E.openMinor, lines: linesOf, uses: usesOf(id), openId: C.store.state.openId, useOpen: E.useOpen,
    dirty: isDirty() && !!ed && ed.draft.trim() !== '', canOnly: !!(T.jobOfFact(rec(), id, cur()) || id === cur().summary),
    ref: C.chooseVariant(work(), id, { ...cur(), lang: DEFAULT_LANG }).v ?? en[0],
    wi: writeInX(id),
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

// the name, the date lines and the contact line are guarded against a stray click (a per-session guard, not recipe.locked: it is not saved,
// asks for no migration of the saved resumes and does not hold the line against the Career forms). The first click or Enter selects the line and
// shows a small lock (it turns in); a second click, Enter, or the lock itself opens it for writing, until the selection moves to another line.
const guarded = id => E.guardOn && (id === 'name' || id === 'contact' || /-(meta|position)$/.test(id));
// on a phone a job's title and date line are guarded by the JOB: the first tap selects the job (shell.js pick), the second writes
const headOf = sel => (E.guardOn && sel?.kind === 'bullet' && sel.owner && /-(meta|position)$/.test(sel.id) ? sel.owner : null);
async function softUnlock(id){
  const b = $('#editlay .obsoft');
  if (b){ b.innerHTML = icon('unlock', { role: 'inline' }); await played(b, [{ transform: 'rotate(0)' }, { transform: 'rotate(-24deg)' }, { transform: 'rotate(0)' }], { ms: 'fast', kind: 'move', name: 'lock:turn' }); }
  E.softShown = null; E.softOpen = id;
  C.onpage?.render(true);
  startEdit();
}
function softLock(id){
  if (E.softShown === id) return softUnlock(id);
  E.softShown = id;
  C.onpage?.render(true);
  const b = $('#editlay .obsoft');
  if (b) play(b, [{ transform: 'rotate(-40deg) scale(.6)', opacity: 0 }, { transform: 'rotate(8deg) scale(1.05)', opacity: 1, offset: .7 }, { transform: 'none', opacity: 1 }], { ms: 'base', kind: 'arrive', name: 'lock:in' });
  C.say(t('ux6f.softLocked'));      // the live region only: the lock turning in and the plate flashing are the answer
  if (b) requestAnimationFrame(() => { ring(b); flashPlate(b); }); else lockShow([], { soft: true });
}
function startEdit(mode = null, vid = null){
  if (isLockedId(lockIdOf()) || isLockedId(fid())) return lockedHint();      // a locked text is not written: its block is selected and the reason said
  const key = keyOf(C.ui.sel), id = isLabelKey(key) ? null : fid();
  if (isLabelKey(key)) return startLabel(key);
  if (!id) return;
  if (ix().skillGroups.has(id)) return;      // a group is picked, not written: its heading is written where it prints, its words come from the bank
  if (guarded(id) && E.softOpen !== id) return softLock(id);
  const L = lang();
  const over = overrideOf(id);
  const using = usingOf(id);
  if (!using && over === undefined) return;
  if (over === undefined && (using.lang ?? DEFAULT_LANG) !== L){      // no version in this language: write one (in a group, in the box the number opens)
    if (grouped() && E.writeIn?.fact !== id){ E.writeIn = { fact: id, mode: 'translate' }; C.renderBody(); }
    $('#ed-new')?.focus();
    return;
  }
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
// A skill group is written on the page: its name, a line break, its skills (nothing to pick from, no versions); where it cannot be, in the panel
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
// The list's changed label: its own editor, with the note above it. A heading is its section's, a language's name and a group's name are lines of
// their own, a field is the job's.
function goLabel(key, id){
  const sel = key.startsWith('~h:') ? { kind: 'section', id }
    : key.startsWith('~t:') ? { kind: 'bullet', id: key, section: ix().owned.get(id) ?? 'languages' }
    : key.startsWith('~g:') ? { kind: 'bullet', id, section: 'skills' }
    : { kind: 'job', id: id.split('/')[1] };
  C.select(sel, { pane: 'edit' });
  return true;
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
  return (ed.mode === 'new' ? ed.draft.trim() !== (ed.copyOf ?? '').trim() : ed.draft.trim() !== ed.base.trim()) || marksChanged(ed);
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
// Highlights written on the page (the pointer with Alt or Ctrl+Alt held, or Ctrl/Cmd+Shift+H): the highlights of `text` as they are now, and a drag from a to b
// (UTF-16 offsets of the plain text, as the browser has them) toggles the whole words it touches. Nothing is kept until the line is left, as for the words.
const writtenMarks = ed => !!ed && !ed.label && !ed.panel;
function marksNow(text){ const ed = E.edit; return writtenMarks(ed) ? marksFor(ed, text ?? ed.draft) : []; }
function setMarks(text, next){
  const ed = E.edit;
  ed.draft = text; ed.mk = { text, marks: next };
  clearTimeout(E.timer);
  E.timer = setTimeout(livePreview, 140);
  C.onpage?.refresh();
}
function toggleMark(text, a, b){
  const ed = E.edit;
  if (!writtenMarks(ed)) return false;
  const now = marksNow(text), next = MK.toggleMarks(now, text, MK.cpOf(text, a), MK.cpOf(text, b));
  if (JSON.stringify(now) === JSON.stringify(next)) return false;
  setMarks(text, next);
  return true;
}
// a click on a highlight clears it
function unmarkAt(text, at){
  const ed = E.edit;
  if (!writtenMarks(ed)) return false;
  const m = MK.markAt(marksNow(text), MK.cpOf(text, at));
  if (!m) return false;
  setMarks(text, MK.toggleMarks(marksNow(text), text, m.start, m.end));
  return true;
}
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
  Object.assign(ed, { vid, mode: 'edit', base: v.text, draft: v.text, copyOf: v.text, marks: v.marks ?? [], mk: null });
  C.onpage?.setText(v.text);
  return true;
}

// The page redraws with the draft as it will be kept: this resume's own text for the line, with its highlights.
async function livePreview(){
  const ed = E.edit;
  if (!ed || !ed.draft.trim() || C.ui.hoverFact) return;      // a version under the pointer is on the page; the draft is drawn again when the pointer leaves
  const text = ed.draft.trim(), r = structuredClone(cur());
  if (ed.label) T.setLabel(rec(), r, ed.fact, ed.lang, text);
  else {
    try { T.setOverride(rec(), r, ed.fact, text, { marks: marksFor(ed, text), base: ed.vid }); }
    catch (e){ if (!(e instanceof LK.LockedError)) throw e; clearEdit(false); C.onpage?.end(); lockedHint(); return; }      // locked while it was open
  }
  await C.previewRecipe(r, ed.fact);
  if (E.edit !== ed) return;
  ed.lines = C.sheet.linesOf(ix(), ed.fact);
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

// Resting on a resume in a version's list shows its page small, the version's words marked (no touch: a tap opens it).
let usePv = null, useT = 0, useQuiet = 0;      // useQuiet: no peek for a moment after a jump, the pointer rests on the new list
function hideUsePeek(){ clearTimeout(useT); usePv?.remove(); usePv = null; }
function showUsePeek(b){
  hideUsePeek();
  const rid = b.dataset.rid, vid = b.closest('.vuse')?.dataset.v, r = C.store.state.resumes.find(x => x.id === rid), recipe = r && C.heldRecipe(rid);
  if (!recipe) return;
  const { w, h } = pageSize(r.format), W = 230, H = Math.round(W * h / w), c = b.getBoundingClientRect();
  const el = document.createElement('div'); el.className = 'vusepv'; el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `width:${W}px;height:${H}px;left:${Math.max(8, ($('#body')?.getBoundingClientRect().left ?? c.left) - 12 - W)}px;top:${Math.max(8, Math.min(innerHeight - H - 8, c.top - H / 3))}px`;
  document.body.append(el); usePv = el;
  C.thumbEntry(recipe).then(e => {
    if (!e || usePv !== el) return;
    const mark = `<style>[data-variant="${CSS.escape(vid)}"]{background:#ffe27a!important;outline:3px solid #ffe27a}</style></head>`;
    const i = Math.max(0, e.srcs.findIndex(x => x.includes(`data-variant="${vid}"`))), f = document.createElement('iframe');
    f.tabIndex = -1; f.setAttribute('scrolling', 'no'); f.srcdoc = e.srcs[i].replace('</head>', mark);
    f.style.cssText = `width:${w}px;height:${h}px;transform:scale(${W / w});transform-origin:0 0;border:0`;
    el.append(f);
  });
}

async function act(a, tg){
  const s = { id: fid() }, sel = C.ui.sel;     // s: the claim open; sel: what the Resume has selected (a section, for the cases below)
  switch (a){
    case 'vuse-open': hideUsePeek(); useQuiet = Date.now() + 1000; await C.jumpTo(tg.dataset.rid, C.ui.sel); return true;
    case 'edit': startEdit(null, tg?.dataset?.v ?? null); return true;
    case 'job-details': {      // the card's link: the job's own fields (dates, links) are in the Details fold below its lines
      const d = $(`#body details[data-det="${CSS.escape(tg.dataset.job)}"]`);
      if (d){ d.open = true; d.scrollIntoView({ block: 'nearest' }); d.querySelector('summary')?.focus(); }
      return true;
    }
    case 'job-fact': {      // the job view's pencils: the title or the date line, written as a page edit is (the deliberate click is the second one)
      const { id, job } = tg.dataset;
      if (isLockedId(job) || isLockedId(id)) return lockedHint({ kind: 'job', id: job }), true;
      E.softOpen = id;
      C.select({ kind: 'bullet', id, section: T.sectionOfEntry(rec(), job), owner: job }, { stay: document.body.dataset.phone !== 'true' });
      if (C.ui.sel.id === id) startEdit();
      return true;
    }
    case 'new-version': clearEdit(); startEdit('new'); return true;
    case 'top-menu': {      // a menu of the top row opens with the focus on its chosen item, else its first
      const pop = tg.nextElementSibling, open = !!pop?.hidden; closeTop();
      if (open){ pop.hidden = false; tg.setAttribute('aria-expanded', 'true'); (pop.querySelector('[aria-selected=true]') ?? pop.querySelector('[role=option], [role=menuitem]'))?.focus(); }
      return true;
    }
    case 'top-step': closeTop(); if (tg.getAttribute('aria-disabled') !== 'true') stepSel(Number(tg.dataset.d)); return true;
    case 'top-add': addNow(tg); return true;      // the version tag's "+ New version" on a line with one version: written as a new version, from this one
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
      if (a === 'chip-remove') await act(ix().skillGroups.has(s.id.replace(/^~g:/, '')) ? 'group-remove' : 'local-remove', tg);
      else if (isLabelKey(key)) commit(d => T.setLabel(d.record, d.cur, key, lang(), ''), t('undo.resetHeading'), t('toast.backToSaved'));
      else await act('only-remove', tg);
      return true;
    }
    case 'group-remove': case 'sk-delgroup': C.bank().deleteGroup(s.id.replace(/^~g:/, '')); return true;
    case 'sk-pick': { const g = tg.dataset.g; C.bank().pickGroup(sel.kind === 'bullet' && sel.section === 'skills' && sel.id.replace(/^~g:/, '') === g ? null : g); return true; }      // a click on the picked one lets it go
    case 'only-remove': commit(d => T.setOverride(d.record, d.cur, s.id, null), t('edit.backToSaved'), t('toast.backToSaved')); return true;
    case 'unfold': E.openMinor.add(`${s.id}:${lang()}:${tg.dataset.m}`); C.renderBody(); return true;
    case 'fold': { const id = tg.dataset.fact ?? s.id; E.fold.set(id, !folded(id)); C.renderBody(); return true; }
    case 'soft-unlock': if (E.softShown) softUnlock(E.softShown); return true;
    case 'use-earlier': clearEdit(); commit(d => T.swapEarlier(d.record, d.cur, s.id, Number(tg.closest('[data-at]').dataset.at)), t('edit.thisOnly')); return true;
    case 'earlier-remove': commit(d => T.dropEarlier(d.record, d.cur, s.id, Number(tg.closest('[data-at]').dataset.at)), t('ux6f.undoDiscard'), t('ux6f.discarded'), true); return true;
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
    case 'delete-claim-no': E.delAsk = null; C.renderBody(); return true;
    case 'delete-claim': {
      const id = s.id, name = ix().facts.get(id)?.summary ?? id;
      if (!id || !isClaim(id)) return true;
      // a claim with more than one version asks first, in place (two steps for a delete that takes more than one thing)
      if (versionCount(id) > 1 && !tg.dataset.sure){ E.delAsk = id; C.renderBody(); setTimeout(() => document.querySelector('#body .delask [data-act=delete-claim]')?.focus(), 0); return true; }
      E.delAsk = null;
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
      commit(d => { LK.guard(d.record, d.cur, id); const v = writeIn(d.record, id, L, text, ta.dataset.from || null, ta.dataset.n || null); n = v.n; T.pickVersion(d.record, d.cur, id, v.id); }, t('undo.writeIn', { lang: LANG_NAME[L] }));
      E.writeIn = null;
      if (n) C.toast(t('toast.langVSaved', { lang: LANG_NAME[L], v: n }));
      return true;
    }
    case 'ob-miss': {      // the greyed number beside a line: its write-in box, in the sidebar
      E.writeIn = { fact: tg.dataset.fact, mode: 'translate' };
      C.renderBody();
      $('#ed-new')?.focus();
      return true;
    }
    case 'wi-pick': {      // a version of this language chosen to be matched to the number the line prints
      E.writeIn = { fact: s.id, mode: 'match', pick: tg.dataset.vid };
      C.renderBody();
      return true;
    }
    case 'wi-match': {      // …and confirmed: it takes that number, one undo step
      const vid = tg.dataset.vid, n = tg.dataset.n, id = s.id;
      if (!vid || !n) return true;
      const was = ix().variants.get(vid)?.n, L = lang();
      const done = commit(d => { LK.guard(d.record, d.cur, id); matchVersion(d, vid, n); }, t('ml3.undoMatch', { lang: LANG_NAME[L] }));
      E.writeIn = null;
      if (done) C.toast(t('ml3.matched', { lang: LANG_NAME[L], from: was, n }));
      C.renderBody();
      return true;
    }
    case 'wi-mode': case 'wi-seed': {
      const ta = $('#ed-new'), now = E.writeIn?.fact === s.id ? E.writeIn : { fact: s.id };
      E.writeIn = a === 'wi-mode' ? { ...now, mode: tg.dataset.mode, seed: ta ? ta.value : now.seed } : { fact: s.id, mode: 'translate', seed: R.versionsIn(work(), s.id, lang()).find(v => v.id === tg.dataset.vid)?.text ?? '' };
      C.renderBody();
      $('#ed-new')?.focus();
      return true;
    }
    case 'label-keep': commit(d => keepLabelAs(d, tg.dataset.key), t('ml3.undoKeep')); return true;      // the label is still right: it is taken as written against the new words
    case 'go-missing': {
      const k = tg.dataset.kind, id = tg.dataset.id;
      if (k === 'heading-changed') return goLabel(tg.dataset.lkey, id);
      if (k === 'group') return goLabel(`~g:${id}`, id);      // a skill group's heading of this resume's own: written where it prints
      if (k === 'word'){ C.select({ kind: 'section', id: 'skills' }, { pane: 'edit' }); C.bank().openWords(lang(), id); return true; }      // a skill word: its line in the bank's words view
      if (k !== 'heading' && k !== 'edited-elsewhere' && grouped()) E.writeIn = { fact: id, mode: 'translate' };      // a group's line opens with its box
      // the missing text is written in Edit, wherever the list was
      if (k === 'heading') C.select({ kind: 'section', id }, { pane: 'edit' });
      else { const job = T.jobOfFact(rec(), id, cur()); C.select(job ? { kind: 'bullet', id, job: job.id, section: 'experience' } : { kind: 'bullet', id, section: tg.dataset.section ?? 'summary', owner: tg.dataset.owner ?? undefined }, { pane: 'edit' }); }
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
    else if (t.dataset.secgroup){ const id = t.dataset.secgroup, on = t.checked; commit(d => T.setSectionGrouped(d.record, d.cur, id, on), tr('undo.groupSection')); }
    else if (t.dataset.jobon){ const id = t.dataset.jobon, on = t.checked; commit(d => T.setJobOn(d.record, d.cur, id, on), on ? tr('undo.showJob') : tr('undo.hideJob')); }
    else if (t.dataset.on){ const id = t.dataset.on, on = t.checked; setBullet(id, on); }
    else if (t.id === 'b-on') setBullet(C.ui.sel.id, t.checked);
    else if (t.dataset.photo !== undefined) C.togglePhoto();
    else if (t.dataset.item){ const id = t.dataset.item, on = t.checked; commit(d => T.setItemOn(d.record, d.cur, id, on), on ? tr('undo.turnOn') : tr('undo.turnOff')); }
    else if (t.dataset.instep !== undefined){ const id = cur().id, name = stepOffer()?.name; if (name) commit(d => setInStep(d, id, true), tr('ml2.keepInStep', { name })); }
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
    if (t.classList?.contains('new-claim') && e.key === 'Enter' && !e.shiftKey && !e.isComposing){ e.preventDefault(); t.closest('.addrow')?.querySelector('[data-act=add-claim]')?.click(); }
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
  // the chip's tick or padlock under the pointer or the focus: the block it governs, drawn on the page
  const scope = on => e => { const b = e.target.closest?.('.ctop .dp-show, .ctop .dp-lock'); if (b && !(on === false && b.contains(e.relatedTarget))) C.sheet.setScope(on, b.classList.contains('dp-lock') ? (b.classList.contains('is-locked') ? 'unlock' : 'lock') : b.querySelector('.pillsw.on') ? 'hide' : 'show'); };
  for (const [ev, on] of [['mouseover', true], ['focusin', true], ['mouseout', false], ['focusout', false]]) body.addEventListener(ev, scope(on));
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest?.('#body .cwrap')) closeTop();
    if (E.armed && !e.target.closest?.('[data-act=top-add]')) disarm();
  }, true);
  document.addEventListener('keydown', e => {
    const pop = e.target.closest?.('#body .cpop:not([hidden])');
    // in an open menu of the top row: ↑ ↓ walk its items, Home and End go to the ends
    if (pop && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)){
      const items = [...pop.querySelectorAll('[role=option], [role=menuitem]')].filter(b => !b.disabled), at = items.indexOf(e.target.closest('[role=option], [role=menuitem]'));
      const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
      items[to]?.focus(); e.preventDefault(); e.stopPropagation(); return;
    }
    if (e.key !== 'Escape') return;
    const open = document.querySelector('#body .cpop:not([hidden])');
    if (open){ const btn = open.previousElementSibling; closeTop(); if (pop) btn?.focus(); e.preventDefault(); e.stopPropagation(); }      // Esc from inside it gives the focus back to its button
    else if (E.armed){ disarm(); e.preventDefault(); e.stopPropagation(); }
  }, true);
  body.addEventListener('click', e => { if (e.target.closest?.('.cpop [data-act]')) setTimeout(closeTop); });
  // which saved resumes print a version: folded until asked, and kept open across redraws
  body.addEventListener('pointerover', e => { const b = e.target.closest?.('.vuseb'); if (b && e.pointerType !== 'touch' && Date.now() > useQuiet && !b.contains(e.relatedTarget)){ clearTimeout(useT); useT = setTimeout(() => showUsePeek(b), 250); } });
  body.addEventListener('pointerout', e => { const b = e.target.closest?.('.vuseb'); if (b && !b.contains(e.relatedTarget)) hideUsePeek(); });
  body.addEventListener('toggle', e => { const d = e.target; if (d.classList?.contains('vuse')) E.useOpen[d.open ? 'add' : 'delete'](d.dataset.v); }, true);
  body.addEventListener('focusout', e => {
    const t = e.target;
    if (t.id === 'term-in') renameTerm(t.dataset.key, t.value);
    if (t.id === 'sec-label') rename(t.dataset.sid, t.value);
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
    else {      // the printed sections take the record's order; an off section keeps its place in the list
      const list = T.sectionList(d.record, d.cur).filter(s => !s.fixed);
      const rec = d.record.sections.map(s => s.id).filter(id => list.some(s => s.on && s.id === id));
      for (const id of list.map(s => (s.on ? rec.shift() : s.id))) auto ||= T.moveSection(d.record, d.cur, id).auto;
    }
  }, t('ux5b.undoReset'));
  if (auto) C.toast(t('toast.autoPages'));
}
// ---- a locked block in the sidebar ----
const SOFT = '#c-pos, #c-org, #c-start, #c-end, #c-start-b, #c-end-b, #c-date-b, #c-expires-b, #c-current, #c-during, #c-loc, #c-wurl, #c-wdesc, #c-wsum, [data-act=c-arch-entry], #c-lname, #c-level, #c-slevel, #c-cname, #c-date, #c-expires, #c-gname, #c-issuer, #c-pname, #c-publisher, #c-url, #c-kw, #c-kw-in, [data-act=c-kw-rm], [data-act=c-del-item], [data-act=c-del-entry], [data-act=c-tag-add], [data-act=c-tag-del]';
// Every row of the Outline gets its padlock (a locked ancestor shows its children locked, greyed, with the lock inherited); a locked row's
// tick, move buttons and drag are off. A locked block's own view has its switches, its versions and its removal off, with the reason.
function lockPass(){
  const body = $('#body');
  if (!body || C.ui.snap) return;
  const rec_ = !C.ui.view;      // the Outline's rows are in the Edit view only; the Record view's own fields are held below
  const why = t('uxr.locked');      // a short word, not a sentence
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
    (tick ?? host).insertAdjacentHTML(tick ? 'beforebegin' : 'beforeend', `<button type="button" class="rowlock${by ? ' is-locked' : ''}${inh ? ' inherited' : ''}" data-act="row-lock" data-id="${esc(id)}" aria-pressed="${by !== null}"${inh ? ' aria-disabled="true"' : ''} aria-label="${esc(inh ?? name)}" title="${esc(t(by ? 'uxr.locked' : 'uxr.unlocked'))}">${icon(by ? 'lock' : 'unlock', { role: 'inline' })}</button>`);
    if (!by) continue;
    host.classList.add('is-locked'); if (by !== id) host.classList.add('is-inherited');
    host.draggable = false;
    for (const el of host.querySelectorAll('input[type=checkbox]')) if (el.checked || by !== id || el.dataset.on){ el.disabled = true; el.title = why; }      // a hidden locked block can be shown again
  }
  // an unlocked block that holds a locked line cannot be hidden either
  for (const row of rec_ ? body.querySelectorAll('.clrow, .srow[data-sid], section.clg[data-g]') : []){
    const id = row.dataset.fact || row.dataset.item || row.dataset.sid || (ix().work.has(row.dataset.g) ? row.dataset.g : '');
    if (!id || lockBy(id) || !LK.lockedInside(rec(), cur(), id)) continue;
    for (const el of row.querySelectorAll('input[type=checkbox]:checked')) if (el.closest('.clrow, .srow[data-sid], section.clg[data-g]') === row){ el.disabled = true; el.title = why; }
  }
  const sel = C.ui.sel, id = lockIdOf(sel);
  body.querySelector('.hdr')?.classList.toggle('hlk', isLockedId(id));      // the card's wash (sidebar.css): its own lock or an ancestor's
  if (sel.kind === 'none' || !isLockedId(id)) return;
  // the Record's own fields of the block: kept in the tab order, read-only, "Locked" in their title (a disabled control can't be focused)
  for (const el of body.querySelectorAll(SOFT)){
    el.setAttribute('aria-disabled', 'true'); el.title = why;
    if (el.matches('input:not([type=checkbox]):not([type=radio]), textarea')) el.readOnly = true;
    else if (el.matches('button, [data-act]')){ el.removeAttribute('data-act'); el.dataset.lockoff = '1'; }
    else el.dataset.lockoff = '1';      // a checkbox or a select: the capture listener in bind() holds it
  }
  for (const el of body.querySelectorAll('#b-on, #sec-label, #term-in, #sk-set, #ed-new, [data-act="write-in"], .ctlrow > .swl > [data-jobon], .ctlrow > .swl > [data-secon], .ctlrow > .swl > [data-secgroup], .skchip, .vlist .vrow, .vlist button, .vlist input, [data-act="local-remove"], [data-act="keep"], [data-act="delete-claim"], [data-act="archive-claim"], [data-act="label-reset"], [data-act="label-all"], [data-act^="sk-"]')) off(el);
}
function key(e){
  // writing a line on the page: Esc leaves it for the job, keeping what was typed, wherever the focus is
  if (e.key === 'Escape' && E.edit && !E.edit.panel){ e.preventDefault(); cancelEdit(); return true; }
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')
    && (C.ui.sel.kind === 'section' || document.activeElement?.closest?.('.clrow[data-item], .clrow[data-bullet], .clgh[data-job]') || (C.ui.sel.kind === 'bullet' && C.ui.sel.job) || (C.ui.sel.kind === 'record' && C.ui.sel.what === 'item'))){
    e.preventDefault(); return moveWhatIsHere(e.key === 'ArrowDown' ? 1 : -1);
  }
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && keyOf(C.ui.sel) && !E.edit && document.body.dataset.phone !== 'true' && !document.body.classList?.contains('side-off') && !e.target?.closest?.('#body .ctop :is(button, [role=option], [role=menuitem])')){ e.preventDefault(); startEdit(); return true; }      // (on a control of the card's top row Enter presses it)
  return false;
}

// Leaving a line keeps what was typed (E1), so leaving is always allowed. The shell's select() ends any preview itself.
function leaving(next){
  const s = C.ui.sel;
  if (E.writeIn && !(next?.kind === 'bullet' && next.id === E.writeIn.fact)) E.writeIn = null;      // a group's write-in box belongs to its line
  if ((E.softShown || E.softOpen) && !(next?.kind === 'bullet' && next.id === (E.softShown ?? E.softOpen))){ const was = E.softShown; E.softShown = E.softOpen = null; if (was) C.onpage?.render(true); }      // the guard is back on when the selection moves      // no editor open (the phone, a click on the sidebar): an empty line is still dropped when the selection leaves it
  if (!E.edit){ if (s.kind === 'bullet' && T.isLocal(cur(), s.id) && cur().overrides?.[s.id] === '' && !(next?.kind === 'bullet' && next.id === s.id)) dropLine(s.id); return true; }
  if (next?.kind === 'bullet' && next.id === E.edit.fact) return true;
  clearEdit(); E.compare = null;
  return true;
}

const api = {
  leaveLine: () => { if (E.edit) clearEdit(); }, redraft: () => { if (E.edit && !E.edit.panel && isDirty()) livePreview(); }, moveLine: moveLineBy, moveGroup: moveGroupBy, moveSkill: moveSkillBy, stepBullet: stepBulletBy, stepGroup: stepGroupBy, addGroup,
  fieldName, isAbove, outlineView, noneView, sectionView, jobView, bulletView, factPanel, act, bind, key, toggleMark, unmarkAt, marksNow, stepJob: stepJobBy, stepSection: stepSectionBy, stepItem: stepItemBy, moveJob: moveJobBy, moveSectionTo: moveSectionBy, moveItemTo: moveItemBy, lockedId: isLockedId, lockIdOf, lockSaid, lockName, stepLine: d => E.edit && stepBulletBy(E.edit.fact, d), leaving, startEdit, addLine, cancelEdit, isDirty, draftChanged, pickWhileWriting, depthHtml, multiline,
  missingOf: id => (grouped() ? missingNow().find(m => m.id === id && isLineMiss(m)) ?? null : null),      // a group's line that prints the other language's version
  get editing(){ return E.edit; },
  get softShown(){ return E.softShown; },
  setAutoFold(on){ E.autoFold = !!on; E.foldAuto = null; },      // for a check that is not about the fold: a short window would hide the versions it clicks
  headOf, openGuard(id){ E.softOpen = id; },      // pick(): a click on a heading row of the job that is already selected opens it
  setGuard(on){ E.guardOn = !!on; E.softShown = E.softOpen = null; },      // for a check that is not about the guard
  claimDraftOf: id => E.claimDrafts.get(id) ?? '',
  afterRender(){
    lockPass();
    markJust();
    const vl = $('#body .vlist[data-fact], #scr .vlist[data-fact]');
    if (!vl) E.foldAuto = null;
    else if (E.autoFold && E.foldAuto?.fact === vl.dataset.fact && E.foldAuto.folded === undefined && vl.offsetHeight){
      const room = vl.closest('#body, #scr').getBoundingClientRect().bottom - vl.getBoundingClientRect().top;
      E.foldAuto.folded = document.body.dataset.phone !== 'true' && vl.getBoundingClientRect().height > room && vl.children.length > 1;      // a phone's sheet shows the versions and nothing else, and scrolls
      if (E.foldAuto.folded && !E.fold.has(vl.dataset.fact)) return C.renderBody();
    }
    if (E.edit && $('#ed') && document.activeElement?.id !== 'ed') focusEditor(); else if ($('#ed')) autosize($('#ed'));
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
};
