// The parts of a panel: a claim, its versions, the editor, the write-in box, the rows of a list. One panel
// serves a claim wherever it was opened from (the page, the record checklist, the timeline). Pure string
// functions, rendered in Node by checks/parts-check.mjs.

import * as R from '../model/record.js';
import { isSame, sameKey, langName, DEFAULT_LANG } from '../model/lang.js';
import { t, h } from '../i18n/index.js';
import { icon } from './icons.js';
import { keyText } from './help.js';

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const clip = (s, n = 90) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + '…' : String(s));
const LANG_NAME = new Proxy({}, { get: (_, l) => langName(l) });
// A titled group of a panel (Settings, Design, Export): titled by what it acts on, with its scope when that is not this resume
export const groupHtml = (title, inner, scope = '') => `<section class="sgroup"><h3 class="sgh">${esc(title)}${scope ? ` <span class="sgs">· ${esc(scope)}</span>` : ''}</h3>${inner}</section>`;

export const crumb = (parts, { close = 'deselect' } = {}) => `<div class="crumb">${parts.map((p, i) => (p.act ? `<a data-act="${p.act}" ${p.attrs ?? ''}>${esc(p.t)}</a>` : `<span>${esc(p.t)}</span>`) + (i < parts.length - 1 ? '<span>›</span>' : '')).join('')}<button class="x ghost sm" data-act="${close}" title="Esc" aria-label="${esc(t('body.close'))}">${icon('close')}</button></div>`;

// One look for every delete and remove (UX-6 round 2): the X (the registry's delete) at the control size, the warning colour, an outline in it that fills on hover (buttons.css .del),
// press.js gives it the destructive tier. `label` (plain text) is drawn where there is room; `text: false` draws the X alone, named `name`. `row`: a
// menu's row. It stands last in its row, after a gap.
export const delBtn = (attrs, label, { text = true, name = '', row = false } = {}) =>
  `<button ${row ? 'role="menuitem" ' : ''}class="del${row ? '' : ' sm'}" ${attrs}${name || !text ? ` title="${esc(name || label)}"` : ''}${text ? '' : ` aria-label="${esc(name || label)}"`}>${icon('delete')}${text ? `<span>${esc(label)}</span>` : ''}</button>`;
// The second step of a delete that takes more than one thing with it (a line with its versions, a resume with its sent copies, a kind with its
// entries): the question, then what else may be done, Cancel, and the delete last. Undo still brings it back.
export const delAskHtml = (question, yes, yesLabel, no, extra = '') =>
  `<div class="missbar delask" role="alert"><p>${esc(question)}</p><div class="btns">${extra}<button class="ghost sm" ${no}>${h('btn.cancel')}</button>${delBtn(yes, yesLabel)}</div></div>`;

// Every on/off in the sidebar is drawn here (and named by showSw): the tick, or with ?switches in the address the old pill.
// shortcut: review flag for the tick-or-switch decision, remove when decided (deciding for switches: PILL = true, and sidebar.css's .sw.pill block stays)
export const PILL = /[?&]switches\b/.test(globalThis.location?.search ?? '');
export const sw = (attrs, on, label = '', disabled = false) =>
  `<label class="swl" ${disabled ? 'aria-disabled="true"' : ''}><input type="checkbox" class="${PILL ? 'sw pill' : 'sw press" data-tier="tertiary'}" ${attrs} ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>${label ? `<span>${label}</span>` : ''}</label>`;

// Show or hide, one look everywhere: the tick, named for what a tick means ("Show {name} on this resume", ticked or not; a button that
// shows or hides, the page chip's, is named for what it will do). `text`: the words are drawn beside the tick (the sidebar's views); else they name it.
export const showSw = (attrs, on, name, { text = false, disabled = false } = {}) => {
  const l = t(PILL && on ? 'ux6c.hideX' : 'ux6c.showX', { name });      // a pill is named for what it will do, a tick for what it means
  return sw(text ? attrs : `${attrs} aria-label="${esc(l)}"`, on, text ? esc(l) : '', disabled);
};
// the pill drawn by a button (the page chip's and the photo slot's), the same shape as the input's
// ico: a picture drawn in the tick's place (the page's photo slot) instead of the check
export const pillHtml = (on, ico = '') => `<span class="pillsw${on ? ' on' : ''}" aria-hidden="true">${ico ? icon(ico, { role: 'inline' }) : ''}</span>`;

// where a version starts to differ from the one in use
export function gist(text, curText){
  const a = text.split(' '), c = curText.split(' ');
  let k = 0;
  while (k < a.length && k < c.length && a[k] === c[k]) k++;
  return k < 3 ? esc(text) : `<span class="muted">…</span>${esc(a.slice(Math.max(0, k - 1)).join(' '))}`;
}

// a version in full, with the words that are not in the one in use marked
export const marked = (text, curText) => R.wordDiff(curText, text).filter(y => y.op !== '-').map(y => (y.op === '+' ? `<mark class="dw">${esc(y.text)}</mark>` : esc(y.text))).join('');

// A row with its switch (Resume). Without `swAttrs`, the same row minus the switch (Career).
// archived: dimmed, with a badge. unarchive: its button (Career, where archived claims are revealed).
export function claimRow({ id, act = 'select-bullet', text, on = true, swAttrs = null, pill = '', pillMiss = false, kept = false, attrs = '', archived = false, unarchive = false }){
  return `<div class="item row ${swAttrs ? '' : 'noswitch '}${on ? '' : 'is-off'}${archived ? ' is-archived' : ''}">${swAttrs ? sw(swAttrs, on) : ''}
        <a class="t" data-act="${act}" data-id="${esc(id)}"${attrs ? ' ' + attrs : ''}>${esc(text)}</a>
        ${archived ? `<span class="pill arch" title="${esc(t('arch.badgeTitle'))}">${h('arch.badge')}</span>` : ''}${pill ? `<span class="pill ${pillMiss ? 'miss' : ''}">${esc(pill)}</span>` : ''}${kept ? `<span class="kept" title="${esc(t('edit.keepTitle'))}">${icon('pin', { role: 'inline' })}</span>` : ''}${unarchive ? `<button class="ghost sm" data-act="unarchive-claim" data-id="${esc(id)}">${h('arch.unarchive')}</button>` : ''}</div>`;
}

export function missBar({ lang, list, act = 'go-missing' }){
  if (lang === DEFAULT_LANG) return '';
  if (!list.length) return `<div class="okbar">${h('edit.allInLang', { lang: LANG_NAME[lang] })}</div>`;
  return `<div class="missbar">${h('edit.missingBar', { n: list.length, lang: LANG_NAME[lang] })}
    <div class="list">${list.slice(0, 8).map(m => `<button class="item miss-go" data-act="${act}" data-kind="${m.kind}" data-id="${esc(m.id)}" ${m.where?.owner ? `data-owner="${esc(m.where.owner)}"` : ''} ${m.where?.section ? `data-section="${esc(m.where.section)}"` : ''}><span>◌ ${esc(clip(m.label, 60))}</span><span class="muted">›</span></button>`).join('')}</div>
    ${list.length > 8 ? `<div class="tiny muted">${h('edit.andMore', { n: list.length - 8 })}</div>` : ''}</div>`;
}

const tagChip = (tg, { vid = null, jobTypes = [], focus = [] } = {}) =>
  `<span class="tag ${jobTypes.includes(tg) ? 'jt' : ''} ${focus.includes(tg) ? 'on' : ''}">${esc(tg)}${vid ? delBtn(`data-act="tag-rm" data-v="${esc(vid)}" data-tag="${esc(tg)}"`, t('edit.removeTag', { tag: tg }), { text: false }) : ''}</span>`;
const tagBox = (v, x) => `<div class="vtags tagin">${(v.tags ?? []).map(tg => tagChip(tg, { vid: v.id, jobTypes: x.jobTypes, focus: x.focusTags ?? [] })).join('')}<input class="tag-in" data-suggest="${esc(JSON.stringify(x.tagList))}" placeholder="${esc(t('edit.tagPh'))}" data-vid="${esc(v.id)}" aria-label="${esc(t('edit.addTag', { v: v.n }))}"></div>`;

// The editor, in place of the row it edits. x.dirty: the draft is worth saving;
// x.canOnly: a resume can hold its own text for this claim.
export function editorHtml(ed, v, x){
  const f = ed.fact, L = x.lang;
  let title, btns;
  if (ed.mode === 'edit'){
    title = t('edit.editing', { v: v.n });
    btns = `<button class="primary sm" data-act="ed-save" ${x.dirty ? '' : 'disabled'}>${h('edit.saveV', { v: v.n })}</button>
      <button class="sm" data-act="ed-saveas" ${x.dirty ? '' : 'disabled'}>${h('edit.saveAsV', { v: R.nextMinor(x.m, f, v.n, L) })}</button>
      ${x.canOnly ? `<button class="sm" data-act="ed-only" ${x.dirty ? '' : 'disabled'}>${h('edit.thisOnly')}</button>` : ''}`;
  } else if (ed.mode === 'new'){
    title = t('edit.newV', { v: R.nextMajor(x.m, f, L) });
    btns = `<button class="primary sm" data-act="ed-new" ${x.dirty ? '' : 'disabled'}>${h('edit.saveAsV', { v: R.nextMajor(x.m, f, L) })}</button>`;
  } else {
    title = t('edit.thisOnly');
    btns = `<button class="primary sm" data-act="ed-only" ${x.dirty ? '' : 'disabled'}>${h('head.save')}</button>
      ${x.using ? `<button class="sm" data-act="ed-promote" ${ed.draft.trim() ? '' : 'disabled'}>${h('edit.saveAsV', { v: R.nextMinor(x.m, f, x.using.n, L) })}</button>` : ''}`;
  }
  return `<div class="editor" data-fact="${esc(f)}">
    <div class="ed-h">${esc(title)}</div>
    <textarea id="ed" spellcheck="true" rows="3" aria-label="${esc(title)}">${esc(ed.draft)}</textarea>
    <div class="btns">${btns}<span class="grow"></span><button class="sm ghost" data-act="ed-cancel">${h('btn.cancel')}</button></div>
  </div>`;
}
export function writeInHtml({ m, fact, lang, ref }){
  const same = isSame(m, sameKey(fact));
  return `<div class="writein">
    <div class="${same ? 'okbar' : 'missbar'}">${same ? h('edit.markedSame') : h('edit.noVersionYet', { lang: LANG_NAME[lang] })}</div>
    <span class="lbl inline">${esc(LANG_NAME.en)}</span><div class="ref">${esc(ref?.text ?? '')}</div>
    <label class="field"><span class="lbl inline">${esc(LANG_NAME[lang])}</span><textarea id="ed-new" rows="3" placeholder="${esc(t('edit.writeItIn', { lang: LANG_NAME[lang] }))}" data-from="${esc(ref?.id ?? '')}"></textarea></label>
    <div class="btns"><button class="sm primary" data-act="write-in">${h('edit.saveAsVLang', { v: R.nextMajor(m, fact, lang), code: lang.toUpperCase() })}</button><span class="grow"></span>${sw(`data-same="${esc(sameKey(fact))}"`, same, h('edit.sameEvery'))}</div>
  </div>`;
}

// Everything under the claim's heading: the comparison, the version list (the editor in place
// of the row being edited) and + Write a new version. x.vs: the versions in `lang`, in number
// order. x.using and x.over: the resume's chosen version and its own text.
export function versionsHtml(x){
  const { m, fact, lang: L, vs, using, over, ed } = x;
  let out = '';

  if (x.compare && vs.some(v => v.id === x.compare) && (using || over !== undefined)){
    const other = vs.find(v => v.id === x.compare);
    const tag = `<del>v${esc(other.n)}</del> → <ins>${over !== undefined ? h('edit.thisResume') : `v${esc(using.n)}`}</ins>`;
    out += `<div class="diff"><div class="dh"><span>${tag}</span><a data-act="compare-close">${h('body.close')}</a></div>
      ${R.wordDiff(other.text, over ?? using.text).map(y => (y.op === '=' ? esc(y.text) : y.op === '-' ? `<del>${esc(y.text)}</del>` : `<ins>${esc(y.text)}</ins>`)).join('')}</div>`;
  }

  if (!vs.length && over === undefined) return out + `<span class="lbl">${esc(LANG_NAME[L])}</span>` + writeInHtml({ m, fact, lang: L, ref: x.ref });

  const E = v => editorHtml(ed, v, x);
  // folded: only the version in use, an edit on this resume and the editor stay; the toggle counts the ones put away
  const hidden = x.folded ? vs.filter(v => !v_isCur(v, using, over)).length : 0, fold = x.folded && hidden > 0, hide = v => fold && !v_isCur(v, using, over);
  const toggle = vs.length > 1 ? `<button type="button" class="sm press fold" data-tier="secondary" data-act="fold" data-fact="${esc(fact)}" aria-expanded="${!x.folded}" aria-controls="vl-${esc(fact)}">${icon(x.folded ? 'right' : 'caret', { role: 'inline' })} ${h(x.folded ? 'ux6f.vHidden' : 'ux6f.fewer', { n: hidden || vs.length - 1 })}</button>` : '';
  out += `<div class="vhead"><span class="lbl">${h('edit.versions', { code: L.toUpperCase() })}</span>${toggle}</div><div class="vlist${x.full ? ' full' : ''}${fold ? ' folded' : ''}" id="vl-${esc(fact)}" data-fact="${esc(fact)}">`;
  if (over !== undefined){
    if (ed?.mode === 'only') out += E();
    else if (!x.pend) out += `<div class="vrow cur only"><span class="rad"></span><span class="n" title="${esc(t('edit.onlyTitle'))}">${h('edit.only')}</span><span class="tx">${esc(over)}</span>
      <span class="vbtn">${x.full ? '' : pencil}<button class="ghost sm" data-act="only-remove" title="${esc(t('edit.backToSaved'))}" aria-label="${esc(t('edit.backToSaved'))}">${icon('revert')}</button></span></div>`;
  } else if (x.parked !== undefined){
    // an edit set aside when a version was picked over it: picking it puts it back
    out += `<div class="vrow only" data-act="use-edit" tabindex="0" title="${esc(x.parked)}"><span class="rad"></span><span class="n" title="${esc(t('edit.onlyTitle'))}">${h('edit.only')}</span><span class="tx">${esc(x.parked)}</span></div>`;
  }
  // grouped by major; minors fold unless one is in use
  const groups = new Map();
  for (const v of vs) (groups.get(R.major(v.n)) ?? groups.set(R.major(v.n), []).get(R.major(v.n))).push(v);
  // the pending rows (the edit on this resume, and the line's earlier edits) stand where each would be numbered, the lower numbers first
  const todo = ed?.mode === 'only' ? [] : [...(x.earlier ?? []), ...(x.pend ? [x.pend] : [])].sort((p, q) => R.compareN(p.n, q.n)), placed = new Set();
  const flush = (list, before) => { let o = ''; for (const p of list) if (!placed.has(p) && (before == null || R.compareN(before, p.n) > 0)){ placed.add(p); o += pendRow(x, over, p); } return o; };
  for (const [M, g] of groups){
    const head = g.find(v => !String(v.n).includes('.')) ?? g[0];
    const minors = g.filter(v => v !== head);
    const here = todo.filter(p => String(p.n).includes('.') && R.major(p.n) === M);      // pending sub-versions stand among these
    const open = x.openMinor.has(`${fact}:${L}:${M}`) || minors.some(v => v.id === using?.id) || here.length > 0;
    if (!hide(head)) out += ed?.mode === 'edit' && v_isCur(head, using, over) ? E(head) : vrow(head, using, over, x);
    if (minors.length || here.length){
      if (open || fold){
        for (const v of minors){
          out += flush(here, v.n);
          if (!hide(v)) out += ed?.mode === 'edit' && v_isCur(v, using, over) ? E(v) : vrow(v, using, over, x);
        }
        out += flush(here);
      } else out += `<div class="vmore" data-act="unfold" data-m="${esc(M)}">${icon('right', { role: 'inline' })} ${h('edit.moreUnder', { n: minors.length, v: M })}</div>`;
    }
  }
  out += flush(todo);      // a new version after the last one
  if (ed?.mode === 'new') out += E();
  out += '</div>';
  if (x.writing) out += `<p class="note">${h('ux3.writingNote')}</p>`
  return out;
}

const pencil = `<button class="ghost sm" data-act="edit" title="${esc(t('edit.editThis'))}" aria-label="${esc(t('edit.editThis'))}">${icon('edit')}</button>`;
// An edit on this resume, in the list where it would be numbered (UX-6g): the number, "on this resume only", the Review list's choices for it
// (p.html; none when locked) and the way back to the saved version. An earlier edit of the line (UX-6f, `p.at`) is a row of its own: its words,
// a button to show it on the page, the same choices, and a way to throw it away.
const pendRow = (x, over, p = x.pend) => {
  const early = p.at !== undefined, at = early ? ` data-at="${p.at}"` : '';
  const btns = early
    ? `<button class="ghost sm" data-act="use-earlier" title="${esc(t('ux6f.showEarlier'))}" aria-label="${esc(t('ux6f.showEarlier'))}">${h('ux6f.useEarlier')}</button>${delBtn('data-act="earlier-remove"', t('ux6f.discard'), { text: false })}`
    : `${x.full ? '' : pencil}<button class="ghost sm" data-act="only-remove" title="${esc(t('edit.backToSaved'))}" aria-label="${esc(t('edit.backToSaved'))}">${icon('revert')}</button>`;
  return `<div class="vrow only pend${early ? ' earlier' : ' cur'}" data-fact="${esc(x.fact)}"${at}><span class="rad"></span>
    <span class="pendhd"><span class="n" title="${esc(t('edit.onlyTitle'))}">v${esc(p.n)}</span><span class="mine">${h(early ? 'ux6f.earlierHere' : 'ux6g.onlyHere')}</span><span class="grow"></span><span class="vbtn">${btns}</span></span>
    <div class="pendbody">${early ? `<span class="tx">${esc(p.text)}</span>` : ''}${p.html || (early ? '' : `<span class="tx">${esc(over)}</span>`)}</div></div>`;
};
const v_isCur = (v, using, over) => over === undefined && v.id === using?.id;

// a Resume row: the version in use in full, the others as a gist
function vrow(v, using, over, x){
  const isCur = v_isCur(v, using, over);
  const minor = String(v.n).includes('.');
  const star = (x.focusTags ?? []).some(tg => (v.tags ?? []).includes(tg)) ? `<span class="star" title="${esc(t('edit.tagged', { tag: x.focusLabel ?? x.focus }))}">${icon('focus', { role: 'inline' })}</span>` : '';
  if (isCur) return `<div class="vrow cur ${minor ? 'minor' : ''}" data-v="${esc(v.id)}"><span class="rad"></span><span class="n">v${esc(v.n)}${star}</span><span class="tx">${esc(v.text)}</span>
    ${x.full ? '' : `<span class="vbtn">${pencil}</span>`}
    ${tagBox(v, x)}</div>`;
  return `<div class="vrow ${minor ? 'minor' : ''}" data-act="use-version" data-v="${esc(v.id)}" tabindex="0" title="${esc(v.text)}">
    <span class="rad"></span><span class="n">v${esc(v.n)}${star}</span><span class="tx">${x.full ? marked(v.text, over ?? using?.text ?? '') : gist(v.text, over ?? using?.text ?? '')}</span>
    <span class="acts"><button class="ghost sm" data-act="compare" data-v="${esc(v.id)}" title="${esc(t('edit.compareTitle'))}" aria-label="${esc(t('edit.compareTitle'))}">${icon('compare')}</button>${delBtn(`data-act="delete-version" data-v="${esc(v.id)}"`, t('edit.deleteV', { v: v.n }), { text: false })}</span>
    ${(v.tags ?? []).length ? `<div class="vtags">${v.tags.slice(0, 4).map(tg => tagChip(tg, { jobTypes: x.jobTypes, focus: x.focusTags ?? [] })).join('')}${v.tags.length > 4 ? `<span class="muted tiny">+${v.tags.length - 4}</span>` : ''}</div>` : ''}</div>`;
}

// Under the claim's heading: Keep (its on/off is the chip's tick). 🗑 deletes the claim and every version of it.
// deletable: the claim is one of an entry's, not a title or a summary.
// archived: null for a claim that can't be archived, else whether it is.
// ask ({ name, n }): the claim has more than one version and its 🗑 was pressed once: the question, under the row.
export function claimHead({ kept = false, deletable = false, archived = null, ask = null }){
  const del = deletable ? delBtn('data-act="delete-claim"', t('career.deleteClaim'), { text: false }) : '';
  const arch = archived === null ? '' : `<button class="ghost sm" data-act="${archived ? 'unarchive-claim' : 'archive-claim'}" title="${esc(t(archived ? 'arch.unarchiveTitle' : 'arch.archiveTitle'))}">${h(archived ? 'arch.unarchive' : 'arch.archive')}</button>`;
  return `<div class="ctlrow"><span class="grow"></span>
      <button class="keep sm" data-act="keep" aria-pressed="${kept}" title="${esc(t('edit.keepTitle'))}" aria-label="${esc(t('edit.keepTitle'))}">${icon('pin', { role: 'control' })}</button>${arch}${del}</div>${ask ? delAskHtml(t('ux6r.delClaimAsk', { name: clip(ask.name, 60), n: ask.n }), 'data-act="delete-claim" data-sure="1"', t('ux1.delete'), 'data-act="delete-claim-no"') : ''}`;
}

// One text box that adds on Enter (Shift+Enter is a new line). The button is only a visible way to do the same.
// There is one under every job in the checklist, so none of them has an id.
export const addClaimHtml = ({ id, key, draft = '' }) =>
  `<label class="field addclaim"><span class="lbl inline">${h('career.addClaim')}</span>
      <span class="addrow"><textarea class="new-claim" data-entry="${esc(id)}" rows="1" placeholder="${esc(t('career.claimPh'))}">${esc(draft)}</textarea><button class="sm addc" data-act="add-claim" data-key="${esc(key)}" data-id="${esc(id)}" title="${esc(t('ux1.addEnter'))}" aria-label="${esc(t('career.addClaim'))}">${h('ux1.add')}</button></span></label>`;

// ---- on the page (UX-3): the three levels drawn over the page, and the tools in the line's right margin ----
// Pure strings, like the rest of this file; src/ui/onpage.js puts them over the page and keeps them in place.

const iconButton = (act, ic, name, tip, attrs = '') =>
  `<button class="ib" data-act="${act}" ${attrs} data-tip="${esc(name)}|${esc(tip)}" data-tip-pos="l" aria-label="${esc(name)}">${icon(ic)}</button>`;

// The version number beside a line is a control (UX-6g): hovering, focusing or clicking it lists the line's other versions as numbers (lower stacked above the
// pill, higher below it; the one in use is the pill and is not listed again); moving over one previews it on the page, a click or Enter chooses it, Esc closes. `tag`: { fact, items, locked },
// items [{ id, n, cur, mine }] in number order (`mine`: the edit on this resume, shown where it would be numbered); `mine` (of the tag): the text is on this resume only, a dot
// on the tag with the words in its tooltip and its name; `locked`: the lock's words.
// A line with no versions (one only on this resume) has the number alone.
export function versionTagHtml(vn, tag = null){
  if (!tag?.items?.length) return `<span class="obv">v${esc(vn)}</span>`;
  if (tag.locked) return `<button type="button" class="obv" disabled aria-disabled="true" aria-label="${esc(tag.locked)}">v${esc(vn)}</button>`;
  // the pill IS the one in use and stays where it is: the lower versions stack above it (the nearest lower one next to it), the higher ones below it, the one in use is not repeated
  const opt = (o, i) => {
    const name = o.mine ? t('ux6g.optMine', { v: o.n }) : `v${o.n}`;
    return `<div class="obvopt${o.mine ? ' mine' : ''}" role="option" id="ob-vo-${i}" data-act="${o.mine ? 'use-edit' : 'use-version'}" data-v="${esc(o.id ?? '')}" aria-selected="false" aria-label="${esc(name)}">v${esc(o.n)}${o.mine ? '<span class="obdot" aria-hidden="true"></span>' : ''}</div>`;
  };
  // one version only: the caret is a small + and the list is one icon-only row below (aria-label "New version"), as wide as the pill, in the same column look (it starts a new version written from this one)
  const one = tag.items.length === 1;
  const at = tag.items.findIndex(o => o.cur), up = at < 0 ? 0 : at;
  const stack = (k, from, to) => to > from ? `<div class="obvstack ${k}" role="presentation">${tag.items.slice(from, to).map((o, i) => opt(o, from + i)).join('')}</div>` : '';
  const newRow = `<div class="obvstack dn" role="presentation"><div class="obvopt obnew" role="option" id="ob-vo-new" data-act="new-version" aria-selected="false" aria-label="${esc(t('diff.newVersion'))}" title="${esc(t('diff.newVersion'))}">${icon('add', { role: 'inline' })}</div></div>`;
  return `<span class="obvwrap"><button type="button" class="obv${one ? ' one' : ''}${tag.mine ? ' mine' : ''}" data-act="ob-vers" aria-haspopup="listbox" aria-expanded="false" aria-controls="ob-vlist"${tag.mine ? ` title="${esc(t('ux6g.onlyHere'))}"` : ''} aria-label="${esc(t(tag.mine ? 'ux6g.tagNameMine' : 'ux6g.tagName', { v: vn }))}">v${esc(vn)}${one ? icon('add', { role: 'inline' }) : ''}</button>
    <div class="obvlist" id="ob-vlist" data-fact="${esc(tag.fact)}" role="listbox" tabindex="-1" aria-label="${esc(t('ux6g.tagList'))}" hidden>${one ? newRow : `${stack('up', 0, up)}${stack('dn', at < 0 ? 0 : at + 1, tag.items.length)}`}</div></span>`;
}

// The row beside the line being written: the number of the version it was written from (a control), ↑ and ↓. Nothing to save:
// leaving the line keeps it on this resume. (The counts are in the sidebar while a line is written.)
export function toolsHtml({ vn, tag = null, canMove = false, ends = {} }){
  const badge = versionTagHtml(vn, tag);
  const tip = (k, arrow) => t(k, { keys: keyText('Alt', arrow) });
  const mv = !canMove ? '' : iconButton('ob-up', 'up', t('ux5b.lineUp'), tip('ux5b.lineUpTip', '↑'), `aria-disabled="${!!ends.first}"`) + iconButton('ob-down', 'caret', t('ux5b.lineDown'), tip('ux5b.lineDownTip', '↓'), `aria-disabled="${!!ends.last}"`);
  return `<div class="obtools writing" role="toolbar" aria-label="${esc(t('ux3.tools'))}">${badge}${mv}</div>`;
}

// The photo, in one place (UX-6g): the sidebar's About you. The picture (or its absence), add / replace / remove, the switch (the same pill
// as the page's slot and the Outline row), the shape. `rec`: the record, `r`: the open resume, `url`: the picture's address.
export function photoHtml({ rec, r, a4 = true, url = '' }){
  const hasPhoto = !!(rec.basics?.image || rec.basics?.portrait?.state === 'present');
  return `<div class="photo-row">${hasPhoto && rec.basics?.image ? `<img class="thumb" src="${esc(url)}" alt="">` : `<span class="thumb empty"><span class="sr">${hasPhoto ? h('design.photoWord') : h('design.none')}</span></span>`}
      <div class="photo-ctl">
        <div class="btns"><button class="sm" data-act="d-photo">${hasPhoto ? h('design.replacePhoto') : h('design.addPhoto')}</button>
          ${showSw('id="d-photo-on"', !!r.photo?.show, t('design.photoWord'), { text: true })}${rec.basics?.image ? delBtn('data-act="d-photo-rm"', t('design.remove')) : ''}</div>
        <div class="seg" role="group" aria-label="${esc(t('design.shape'))}">${[['rect', t('design.passport')], ['soft', t('design.rounded')], ['round', t('design.circle')]].map(([s, l]) => `<button data-act="d-shape" data-s="${s}" aria-pressed="${(r.photo?.shape ?? 'rect') === s}">${esc(l)}</button>`).join('')}</div>
        <p class="note" data-tip="${esc(t('design.photoNote') + ' ' + t('design.photoCrop'))}" aria-description="${esc(t('design.photoNote') + ' ' + t('design.photoCrop'))}" tabindex="0">${h('ux6b.photoHint')}${r.photo?.show && !a4 ? ' ' + h('design.letterPhoto') : ''}</p></div></div>`
}

// "custom" and Reset, at the header of a job, a list or the sections: this resume's order is not the record's. kind: job | items | sections
export const orderMarkHtml = (custom, kind, id, name) => (custom
  ? `<span class="pill custom">${h('ux5b.custom')}</span><button class="ghost sm" data-act="order-reset" data-kind="${kind}" data-id="${esc(id)}" aria-label="${esc(t('ux5b.resetTitle', { name }))}">${h('ux5b.reset')}</button>` : '');

// One depth indicator (UX-6c), the same markup and styles on the page (the floating chip, `small`) and at the top of the editor card:
// Page › Section › Job, Page › Section › Item, Page › Header › Field. levels: [{ word, act, attrs?, kids?, came? }] from the page down, the last is where
// you are.
// `lock` ({ id, on, by, name }) and `show` ({ kind, id, on, name, disabled }) are the two small buttons at its right end (UX-6c-iii-b): the
// padlock of the block the chip names, and its on/off switch. Both are real buttons with a name; the padlock is aria-pressed when locked.
// One component on the page and in the card (UX-6f 4c): `where` ('page' | 'card') only names it and keeps its ids apart. A level with `kids`
// ([{ text, sel }], the Outline's rows) has a list of them (src/ui/depthmenu.js opens it), the one it came through (`came`) marked: the word goes up, the list deeper or sideways.
// On the page (`where` 'page') a word only goes one level up: no lists. `back` ({ word }): for a moment after going up its own branch, a small ↩ after the tools (not a crumb) returns to the depth just left.
export function depthHtml(levels, { where = 'card', lock = null, show = null, fix = null, back = null } = {}){
  if (where === 'page') levels = levels.map(({ kids, came, ...l }) => l);
  const list = (l, k) => `<div class="dplist" id="dp-${where}-${k}" role="listbox" tabindex="-1" aria-label="${esc(l.word)}" hidden>${l.kids.map((o, i) => {
    const came = o.sel.id === l.came;
    return `<div class="dpopt${came ? ' cur' : ''}" role="option" id="dp-${where}-${k}-${i}" data-act="dp-open" data-sel="${esc(JSON.stringify(o.sel))}" aria-selected="${came}" title="${esc(o.text)}">${esc(clip(o.text, 30))}</div>`; }).join('')}</div>`;
  const btn = (l, cls, k) => { const pop = l.kids?.length ? ` aria-haspopup="listbox" aria-expanded="false" aria-controls="dp-${where}-${k}"` : '';
    const b = `<button type="button" class="dp-l${cls}" data-act="${l.act}" ${l.attrs ?? ''}${cls === ' cur' ? ' aria-current="location"' : ''}${pop}><span class="dp-w">${esc(l.word)}</span></button>`;
    return pop ? `<span class="dpwrap">${b}${list(l, k)}</span>` : b; };
  const tool = (cls, ic, act, attrs, name, pressed, disabled = false, tip = name) => `<button type="button" class="dp-t ${cls}" data-act="${act}" ${attrs} aria-pressed="${pressed}" aria-label="${esc(name)}" title="${esc(tip)}"${disabled ? ' aria-disabled="true"' : ''}>${icon(ic, { role: 'inline' })}</button>`;
  const showL = show && t(show.on ? 'ux6c.hideX' : 'ux6c.showX', { name: show.name });
  // `fix`: the tool after the switch that undoes what was done here (put an edit back, remove what is only on this resume): { act, icon, name, disabled, del }
  const tools = [
    lock && tool(`dp-lock${lock.on ? ' is-locked' : ''}${lock.byName ? ' inherited' : ''}`, lock.on ? 'lock' : 'unlock', 'lock-toggle', `data-id="${esc(lock.id)}"`, lock.byName ? t('ux6c.lockedUnder', { name: lock.byName }) : t(lock.on ? 'ux6c.unlockX' : 'ux6c.lockX', { name: lock.name }), lock.on, !!lock.byName, t(lock.on ? 'uxr.locked' : 'uxr.unlocked')),      // the title a state word (round 2)
    show && `<button type="button" class="dp-t dp-show" data-act="chip-on" data-kind="${esc(show.kind)}" data-id="${esc(show.id)}" aria-label="${esc(showL)}" title="${esc(showL)}"${show.disabled ? ' aria-disabled="true"' : ''}>${pillHtml(show.on)}</button>`,
    fix && `<button type="button" class="dp-t dp-fix${fix.del ? ' del' : ''}" data-act="${fix.act}" aria-label="${esc(fix.name)}" title="${esc(fix.name)}"${fix.disabled ? ' aria-disabled="true"' : ''}>${icon(fix.del ? 'delete' : fix.icon, { role: fix.del ? 'control' : 'inline' })}</button>`,      // last: a remove stands at the end
  ].filter(Boolean);
  return `<nav class="depth sm" aria-label="${esc(t(where === 'page' ? 'ux6f.depthPage' : 'ux6c.depth'))}">${levels.map((l, i) => btn(l, i === levels.length - 1 ? ' cur' : '', i)).join('<span class="dp-s" aria-hidden="true">›</span>')}${tools.length ? `<span class="dp-tools">${tools.join('')}</span>` : ''}${back ? `<button type="button" class="dp-t dp-back" data-act="chip-back" aria-label="${esc(t('ux6f.backTo', { name: back.word }))}">${icon('revert', { role: 'inline' })}</button>` : ''}</nav>`;
}
