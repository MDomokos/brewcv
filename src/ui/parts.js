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

export const crumb = (parts, { close = 'deselect' } = {}) => `<div class="crumb">${parts.map((p, i) => (p.act ? `<a data-act="${p.act}" ${p.attrs ?? ''}>${esc(p.t)}</a>` : `<span>${esc(p.t)}</span>`) + (i < parts.length - 1 ? '<span>›</span>' : '')).join('')}<button class="x ghost sm" data-act="${close}" title="Esc" aria-label="${esc(t('body.close'))}">${icon('close')}</button></div>`;

export const sw = (attrs, on, label = '', disabled = false) =>
  `<label class="swl" ${disabled ? 'aria-disabled="true"' : ''}><input type="checkbox" class="sw" ${attrs} ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>${label ? `<span>${label}</span>` : ''}</label>`;

// Show or hide, one look and one wording everywhere: the pill switch, named for what it does ("Hide {name} from this resume" when it is
// on, "Show {name} on this resume" when it is off). `text`: the words are drawn beside the pill (the sidebar's views); else they name it.
export const showSw = (attrs, on, name, { text = false, disabled = false } = {}) => {
  const l = t(on ? 'ux6c.hideX' : 'ux6c.showX', { name });
  return sw(text ? attrs : `${attrs} aria-label="${esc(l)}"`, on, text ? esc(l) : '', disabled);
};
// the pill drawn by a button (the page chip's and the photo slot's), the same shape as the input's
export const pillHtml = on => `<span class="pillsw${on ? ' on' : ''}" aria-hidden="true"></span>`;

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
        ${archived ? `<span class="pill arch" title="${esc(t('arch.badgeTitle'))}">${h('arch.badge')}</span>` : ''}${pill ? `<span class="pill ${pillMiss ? 'miss' : ''}">${esc(pill)}</span>` : ''}${kept ? `<span class="kept" title="${esc(t('edit.keepTitle'))}">${icon('pin', { size: 12 })}</span>` : ''}${unarchive ? `<button class="ghost sm" data-act="unarchive-claim" data-id="${esc(id)}">${h('arch.unarchive')}</button>` : ''}</div>`;
}

export function missBar({ lang, list, act = 'go-missing' }){
  if (lang === DEFAULT_LANG) return '';
  if (!list.length) return `<div class="okbar">${h('edit.allInLang', { lang: LANG_NAME[lang] })}</div>`;
  return `<div class="missbar">${h('edit.missingBar', { n: list.length, lang: LANG_NAME[lang] })}
    <div class="list">${list.slice(0, 8).map(m => `<button class="item miss-go" data-act="${act}" data-kind="${m.kind}" data-id="${esc(m.id)}" ${m.where?.owner ? `data-owner="${esc(m.where.owner)}"` : ''} ${m.where?.section ? `data-section="${esc(m.where.section)}"` : ''}><span>◌ ${esc(clip(m.label, 60))}</span><span class="muted">›</span></button>`).join('')}</div>
    ${list.length > 8 ? `<div class="tiny muted">${h('edit.andMore', { n: list.length - 8 })}</div>` : ''}</div>`;
}

const tagChip = (tg, { vid = null, jobTypes = [], focus = [] } = {}) =>
  `<span class="tag ${jobTypes.includes(tg) ? 'jt' : ''} ${focus.includes(tg) ? 'on' : ''}">${esc(tg)}${vid ? `<button class="rm" data-act="tag-rm" data-v="${esc(vid)}" data-tag="${esc(tg)}" aria-label="${esc(t('edit.removeTag', { tag: tg }))}">×</button>` : ''}</span>`;
const tagBox = (v, x) => `<div class="vtags tagin">${(v.tags ?? []).map(tg => tagChip(tg, { vid: v.id, jobTypes: x.jobTypes, focus: x.focusTags ?? [] })).join('')}<input class="tag-in" list="tag-list" placeholder="${esc(t('edit.tagPh'))}" data-vid="${esc(v.id)}" aria-label="${esc(t('edit.addTag', { v: v.n }))}"><datalist id="tag-list">${x.tagList.map(tg => `<option value="${esc(tg)}">`).join('')}</datalist></div>`;

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
    <div class="stats" id="ed-stats">${statsHtml(ed, x.fill)}</div>
    <div class="btns">${btns}<span class="grow"></span><button class="sm ghost" data-act="ed-cancel">${h('btn.cancel')}</button></div>
  </div>`;
}
export function statsHtml(ed, fill = ''){
  const ch = [...ed.draft].length;
  const ln = ed.lines;
  const d = ln != null && ed.lines0 != null ? ln - ed.lines0 : 0;
  return `<span>${h('edit.statCh', { n: ch })}</span>${ln != null ? `<span>${h('edit.statLines', { n: ln })}</span>` : ''}${d ? `<span class="${d > 0 ? 'up' : 'dn'}">${h('edit.statVs', { d: `${d > 0 ? '+' : ''}${d}` })}</span>` : ''}${fill ? `<span>${esc(fill)}</span>` : ''}`;
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
  out += `<span class="lbl">${h('edit.versions', { code: L.toUpperCase() })}</span><div class="vlist${x.full ? ' full' : ''}" data-fact="${esc(fact)}">`;
  if (over !== undefined){
    out += ed?.mode === 'only' ? E() : `<div class="vrow cur only"><span class="rad"></span><span class="n" title="${esc(t('edit.onlyTitle'))}">${h('edit.only')}</span><span class="tx">${esc(over)}</span>
      <span class="vbtn"><button class="ghost sm" data-act="edit" title="${esc(t('edit.editEnter'))}" aria-label="${esc(t('edit.editEnter'))}">${icon('edit')}</button><button class="ghost sm" data-act="only-remove" title="${esc(t('edit.backToSaved'))}" aria-label="${esc(t('edit.backToSaved'))}">↺</button></span></div>`;
  } else if (x.parked !== undefined){
    // an edit set aside when a version was picked over it: picking it puts it back
    out += `<div class="vrow only" data-act="use-edit" tabindex="0" title="${esc(x.parked)}"><span class="rad"></span><span class="n" title="${esc(t('edit.onlyTitle'))}">${h('edit.only')}</span><span class="tx">${esc(x.parked)}</span></div>`;
  }
  // grouped by major; minors fold unless one is in use
  const groups = new Map();
  for (const v of vs) (groups.get(R.major(v.n)) ?? groups.set(R.major(v.n), []).get(R.major(v.n))).push(v);
  for (const [M, g] of groups){
    const head = g.find(v => !String(v.n).includes('.')) ?? g[0];
    const minors = g.filter(v => v !== head);
    const open = x.openMinor.has(`${fact}:${L}:${M}`) || minors.some(v => v.id === using?.id);
    out += ed?.mode === 'edit' && v_isCur(head, using, over) ? E(head) : vrow(head, using, over, x);
    if (minors.length){
      if (open) for (const v of minors) out += ed?.mode === 'edit' && v_isCur(v, using, over) ? E(v) : vrow(v, using, over, x);
      else out += `<div class="vmore" data-act="unfold" data-m="${esc(M)}">${icon('right', { size: 12 })} ${h('edit.moreUnder', { n: minors.length, v: M })}</div>`;
    }
  }
  if (ed?.mode === 'new') out += E();
  out += '</div>';
  if (x.writing) out += `<p class="note">${h('ux3.writingNote')}</p>`;
  return out;
}

const v_isCur = (v, using, over) => over === undefined && v.id === using?.id;

// a Resume row: the version in use in full, the others as a gist
function vrow(v, using, over, x){
  const isCur = v_isCur(v, using, over);
  const minor = String(v.n).includes('.');
  const ln = x.lines(v);
  const star = (x.focusTags ?? []).some(tg => (v.tags ?? []).includes(tg)) ? `<span class="star" title="${esc(t('edit.tagged', { tag: x.focusLabel ?? x.focus }))}">★</span>` : '';
  if (isCur) return `<div class="vrow cur ${minor ? 'minor' : ''}" data-v="${esc(v.id)}"><span class="rad"></span><span class="n">v${esc(v.n)}${star}</span><span class="tx">${esc(v.text)}</span>
    <span class="vbtn"><button class="ghost sm" data-act="edit" title="${esc(t('edit.editThis'))}" aria-label="${esc(t('edit.editThis'))}">${icon('edit')}</button></span>
    ${tagBox(v, x)}</div>`;
  return `<div class="vrow ${minor ? 'minor' : ''}" data-act="use-version" data-v="${esc(v.id)}" tabindex="0" title="${esc(v.text)}">
    <span class="rad"></span><span class="n">v${esc(v.n)}${star}</span><span class="tx">${x.full ? marked(v.text, over ?? using?.text ?? '') : gist(v.text, over ?? using?.text ?? '')}</span>
    <span class="mt2">${ln ? `${h('edit.lnShort', { n: ln })} · ` : ''}${h('edit.chShort', { n: [...v.text].length })}</span>
    <span class="acts"><button class="ghost sm" data-act="compare" data-v="${esc(v.id)}" title="${esc(t('edit.compareTitle'))}" aria-label="${esc(t('edit.compareTitle'))}">${icon('compare')}</button><button class="ghost sm" data-act="delete-version" data-v="${esc(v.id)}" title="${esc(t('edit.deleteV', { v: v.n }))}" aria-label="${esc(t('edit.deleteV', { v: v.n }))}">${icon('trash')}</button></span>
    ${(v.tags ?? []).length ? `<div class="vtags">${v.tags.slice(0, 4).map(tg => tagChip(tg, { jobTypes: x.jobTypes, focus: x.focusTags ?? [] })).join('')}${v.tags.length > 4 ? `<span class="muted tiny">+${v.tags.length - 4}</span>` : ''}</div>` : ''}</div>`;
}

// Under the claim's heading: on/off for this resume and Keep. 🗑 deletes the claim and every version of it.
// deletable: the claim is one of an entry's, not a title or a summary.
// archived: null for a claim that can't be archived, else whether it is.
export function claimHead({ hasJob = false, name = '', on = false, kept = false, deletable = false, archived = null }){
  const del = deletable ? `<button class="ghost sm" data-act="delete-claim" title="${esc(t('career.deleteClaim'))}" aria-label="${esc(t('career.deleteClaim'))}">${icon('trash')}</button>` : '';
  const arch = archived === null ? '' : `<button class="ghost sm" data-act="${archived ? 'unarchive-claim' : 'archive-claim'}" title="${esc(t(archived ? 'arch.unarchiveTitle' : 'arch.archiveTitle'))}">${h(archived ? 'arch.unarchive' : 'arch.archive')}</button>`;
  return `<div class="ctlrow">${hasJob ? showSw('id="b-on"', on, name, { text: true }) : ''}<span class="grow"></span>
      <button class="keep sm" data-act="keep" aria-pressed="${kept}" title="${esc(t('edit.keepTitle'))}" aria-label="${esc(t('edit.keepTitle'))}">${icon('pin', { size: 14 })}</button>${arch}${del}</div>`;
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

// The column beside the line being written: the number of the version it was written from, ↑ and ↓, the counts. Nothing to save:
// leaving the line keeps it on this resume. (The sidebar lists the other versions.)
export function toolsHtml({ vn, canMove = false, ends = {}, counts = '' }){
  const badge = `<span class="obv">v${esc(vn)}</span>`;
  const tip = (k, arrow) => t(k, { keys: keyText('Alt', arrow) });
  const mv = !canMove ? '' : iconButton('ob-up', 'up', t('ux5b.lineUp'), tip('ux5b.lineUpTip', '↑'), `aria-disabled="${!!ends.first}"`) + iconButton('ob-down', 'caret', t('ux5b.lineDown'), tip('ux5b.lineDownTip', '↓'), `aria-disabled="${!!ends.last}"`);
  return `<div class="obtools writing" role="toolbar" aria-label="${esc(t('ux3.tools'))}">${badge}${mv}<div class="obstats" id="ob-stats">${counts}</div></div>`;
}

// The counts under the tools: short, because the column is narrow. Characters, lines on the page, and how many more or fewer.
export function statsCompactHtml(ed){
  const ch = [...ed.draft].length, ln = ed.lines;
  const d = ln != null && ed.lines0 != null ? ln - ed.lines0 : 0;
  return `<span>${h('edit.chShort', { n: ch })}</span>${ln != null ? `<span>${h('edit.lnShort', { n: ln })}</span>` : ''}${d ? `<span class="${d > 0 ? 'up' : 'dn'}">${d > 0 ? '+' : ''}${d}</span>` : ''}`;
}

// "custom" and Reset, at the header of a job, a list or the sections: this resume's order is not the record's. kind: job | items | sections
export const orderMarkHtml = (custom, kind, id, name) => (custom
  ? `<span class="pill custom">${h('ux5b.custom')}</span><button class="ghost sm" data-act="order-reset" data-kind="${kind}" data-id="${esc(id)}" aria-label="${esc(t('ux5b.resetTitle', { name }))}">${h('ux5b.reset')}</button>` : '');

// One depth indicator (UX-6c), the same markup and styles on the page (the floating chip, `small`) and at the top of the editor card:
// Page › Job › Line, Page › Section › Item, Page › Header. levels: [{ word, name?, act, attrs? }] from the page down, the last is where
// you are; a name gives way with an ellipsis, a level's word never does.
// `lock` ({ id, on, by, name }) and `show` ({ kind, id, on, name, disabled }) are the two small buttons at its right end (UX-6c-iii-b): the
// padlock of the block the chip names, and its on/off switch. Both are real buttons with a name; the padlock is aria-pressed when locked.
export function depthHtml(levels, { small = false, lock = null, show = null, fix = null } = {}){
  const btn = (l, cls = '') => `<button type="button" class="dp-l${cls}" data-act="${l.act}" ${l.attrs ?? ''}${cls === ' cur' ? ' aria-current="location"' : ''}><span class="dp-w">${esc(l.word)}</span>${l.name ? `<span class="dp-n">${esc(l.name)}</span>` : ''}</button>`;
  const tool = (cls, ic, act, attrs, name, pressed, disabled = false) => `<button type="button" class="dp-t ${cls}" data-act="${act}" ${attrs} aria-pressed="${pressed}" aria-label="${esc(name)}" title="${esc(name)}"${disabled ? ' aria-disabled="true"' : ''}>${icon(ic, { size: 12 })}</button>`;
  const showL = show && t(show.on ? 'ux6c.hideX' : 'ux6c.showX', { name: show.name });
  // `fix`: the tool beside the padlock that undoes what was done here (put an edit back, remove what is only on this resume): { act, icon, name, disabled }
  const tools = [
    lock && tool(`dp-lock${lock.on ? ' is-locked' : ''}${lock.byName ? ' inherited' : ''}`, lock.on ? 'lock' : 'unlock', 'lock-toggle', `data-id="${esc(lock.id)}"`, lock.byName ? t('ux6c.lockedUnder', { name: lock.byName }) : t(lock.on ? 'ux6c.unlockX' : 'ux6c.lockX', { name: lock.name }), lock.on, !!lock.byName),
    fix && `<button type="button" class="dp-t dp-fix" data-act="${fix.act}" aria-label="${esc(fix.name)}" title="${esc(fix.name)}"${fix.disabled ? ' aria-disabled="true"' : ''}>${icon(fix.icon, { size: 12 })}</button>`,
    show && `<button type="button" class="dp-t dp-show" data-act="chip-on" data-kind="${esc(show.kind)}" data-id="${esc(show.id)}" aria-label="${esc(showL)}" title="${esc(showL)}"${show.disabled ? ' aria-disabled="true"' : ''}>${pillHtml(show.on)}</button>`,
  ].filter(Boolean);
  return `<nav class="depth${small ? ' sm' : ''}" aria-label="${esc(t('ux6c.depth'))}">${levels.map((l, i) => btn(l, i === levels.length - 1 ? ' cur' : '')).join('<span class="dp-s" aria-hidden="true">›</span>')}${tools.length ? `<span class="dp-tools">${tools.join('')}</span>` : ''}</nav>`;
}
