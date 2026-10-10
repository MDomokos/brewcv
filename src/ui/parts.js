// The parts of a panel, shared by the Resume workspace (edit.js) and Career (career.js) so a
// claim and its versions look and work the same in both. `ws` ('resume' | 'career') adds or
// hides each workspace's own parts: only the Resume has the version in use (◉), line counts
// and "this resume only". Pure string functions, rendered in Node by checks/parts-check.mjs.

import * as R from '../model/record.js';
import { isSame, sameKey, langName, DEFAULT_LANG } from '../model/lang.js';
import { t, h } from '../i18n/index.js';

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const clip = (s, n = 90) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + '…' : String(s));
const LANG_NAME = new Proxy({}, { get: (_, l) => langName(l) });

export const crumb = (parts, { close = 'deselect' } = {}) => `<div class="crumb">${parts.map((p, i) => (p.act ? `<a data-act="${p.act}" ${p.attrs ?? ''}>${esc(p.t)}</a>` : `<span>${esc(p.t)}</span>`) + (i < parts.length - 1 ? '<span>›</span>' : '')).join('')}<button class="x ghost sm" data-act="${close}" title="Esc" aria-label="${esc(t('body.close'))}">✕</button></div>`;

export const sw = (attrs, on, label = '', disabled = false) =>
  `<label class="swl" ${disabled ? 'aria-disabled="true"' : ''}><input type="checkbox" class="sw" ${attrs} ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>${label ? `<span>${label}</span>` : ''}</label>`;

// where a version starts to differ from the one in use
export function gist(text, curText){
  const a = text.split(' '), c = curText.split(' ');
  let k = 0;
  while (k < a.length && k < c.length && a[k] === c[k]) k++;
  return k < 3 ? esc(text) : `<span class="muted">…</span>${esc(a.slice(Math.max(0, k - 1)).join(' '))}`;
}

export function factRow({ act = 'select-fact', id, text, pill = '', pillMiss = false, miss = false, section = null, owner = null, attrs = '', cls = '', tcls = '' }){
  return `<button class="item fact ${cls ? cls + ' ' : ''}${miss ? 'miss' : ''}" data-act="${act}" data-id="${esc(id)}" ${section ? `data-section="${esc(section)}"` : ''} ${owner ? `data-owner="${esc(owner)}"` : ''}${attrs ? ' ' + attrs : ''}>
    <span${tcls ? ` class="${tcls}"` : ''}>${esc(text).replace(/\n/g, ' · ')}</span>${pill ? `<span class="pill${pillMiss ? ' miss' : ''}">${pill}</span>` : ''}</button>`;
}

// A row with its switch (Resume). Without `swAttrs`, the same row minus the switch (Career).
export function claimRow({ id, act = 'select-bullet', text, on = true, swAttrs = null, pill = '', pillMiss = false, kept = false, attrs = '' }){
  return `<div class="item row ${swAttrs ? '' : 'noswitch '}${on ? '' : 'is-off'}">${swAttrs ? sw(swAttrs, on) : ''}
        <a class="t" data-act="${act}" data-id="${esc(id)}"${attrs ? ' ' + attrs : ''}>${esc(text)}</a>
        ${pill ? `<span class="pill ${pillMiss ? 'miss' : ''}">${esc(pill)}</span>` : ''}${kept ? `<span class="kept" title="${esc(t('edit.keepTitle'))}">📌</span>` : ''}</div>`;
}

export function missBar({ lang, list, act = 'go-missing' }){
  if (lang === DEFAULT_LANG) return '';
  if (!list.length) return `<div class="okbar">${h('edit.allInLang', { lang: LANG_NAME[lang] })}</div>`;
  return `<div class="missbar">${h('edit.missingBar', { n: list.length, lang: LANG_NAME[lang] })}
    <div class="list">${list.slice(0, 8).map(m => `<button class="item miss-go" data-act="${act}" data-kind="${m.kind}" data-id="${esc(m.id)}" ${m.where?.owner ? `data-owner="${esc(m.where.owner)}"` : ''} ${m.where?.section ? `data-section="${esc(m.where.section)}"` : ''}><span>◌ ${esc(clip(m.label, 60))}</span><span class="muted">›</span></button>`).join('')}</div>
    ${list.length > 8 ? `<div class="tiny muted">${h('edit.andMore', { n: list.length - 8 })}</div>` : ''}</div>`;
}

const tagChip = (tg, { vid = null, jobTypes = [], focus = null } = {}) =>
  `<span class="tag ${jobTypes.includes(tg) ? 'jt' : ''} ${focus === tg ? 'on' : ''}">${esc(tg)}${vid ? `<button class="rm" data-act="tag-rm" data-v="${esc(vid)}" data-tag="${esc(tg)}" aria-label="${esc(t('edit.removeTag', { tag: tg }))}">×</button>` : ''}</span>`;
const tagBox = (v, x) => `<div class="vtags tagin">${(v.tags ?? []).map(tg => tagChip(tg, { vid: v.id, jobTypes: x.jobTypes, focus: x.focus })).join('')}<input class="tag-in" list="tag-list" placeholder="${esc(t('edit.tagPh'))}" data-vid="${esc(v.id)}" aria-label="${esc(t('edit.addTag', { v: v.n }))}"><datalist id="tag-list">${x.tagList.map(tg => `<option value="${esc(tg)}">`).join('')}</datalist></div>`;

// The editor, in place of the row it edits. x.dirty: the draft is worth saving;
// x.canOnly: a resume can hold its own text for this claim.
export function editorHtml(ed, v, x){
  const f = ed.fact, L = x.lang;
  let title, btns;
  if (ed.mode === 'edit'){
    title = t('edit.editing', { v: v.n });
    btns = `<button class="primary sm" data-act="ed-save" ${x.dirty ? '' : 'disabled'}>${h('edit.saveV', { v: v.n })}</button>
      <button class="sm" data-act="ed-saveas" ${x.dirty ? '' : 'disabled'}>${h('edit.saveAsV', { v: R.nextMinor(x.m, f, v.n, L) })}</button>
      ${x.ws === 'resume' && x.canOnly ? `<button class="sm" data-act="ed-only" ${x.dirty ? '' : 'disabled'}>${h('edit.thisOnly')}</button>` : ''}`;
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
// order. x.using and x.over: the resume's chosen version and its own text (Resume only).
export function versionsHtml(x){
  const { ws, m, fact, lang: L, vs, using, over, ed } = x;
  const career = ws === 'career';
  let out = '';

  if (x.compare && vs.some(v => v.id === x.compare) && (career || using || over !== undefined)){
    const other = vs.find(v => v.id === x.compare);
    const at = vs.indexOf(other);
    // Resume: against the one in use. Career: against the version above it.
    const from = career ? vs[at - 1] : other, to = career ? other : null;
    if (!career || from){
      const mine = career ? to.text : over ?? using.text;
      const base = career ? from.text : other.text;
      const tag = career ? `<del>v${esc(from.n)}</del> → <ins>v${esc(to.n)}</ins>` : `<del>v${esc(other.n)}</del> → <ins>${over !== undefined ? h('edit.thisResume') : `v${esc(using.n)}`}</ins>`;
      out += `<div class="diff"><div class="dh"><span>${tag}</span><a data-act="compare-close">${h('body.close')}</a></div>
      ${R.wordDiff(base, mine).map(y => (y.op === '=' ? esc(y.text) : y.op === '-' ? `<del>${esc(y.text)}</del>` : `<ins>${esc(y.text)}</ins>`)).join('')}</div>`;
    }
  }

  if (!vs.length && over === undefined) return out + `<span class="lbl">${esc(LANG_NAME[L])}</span>` + writeInHtml({ m, fact, lang: L, ref: x.ref });

  const E = v => editorHtml(ed, v, x);
  out += `<span class="lbl">${h('edit.versions', { code: L.toUpperCase() })}</span><div class="vlist${career ? ' flat' : ''}" data-fact="${esc(fact)}">`;
  if (over !== undefined){
    out += ed?.mode === 'only' ? E() : `<div class="vrow cur only"><span class="rad"></span><span class="n" title="${esc(t('edit.onlyTitle'))}">${h('edit.only')}</span><span class="tx">${esc(over)}</span>
      <span class="vbtn"><button class="ghost sm" data-act="edit" title="${esc(t('edit.editEnter'))}" aria-label="${esc(t('edit.editEnter'))}">✎</button><button class="ghost sm" data-act="only-remove" title="${esc(t('edit.backToSaved'))}" aria-label="${esc(t('edit.backToSaved'))}">↺</button></span></div>`;
  }
  const row = v => (career ? flatRow(v, x) : vrow(v, using, over, x));
  if (career){
    for (const v of vs) out += ed?.mode === 'edit' && ed.vid === v.id ? E(v) : row(v);
  } else {
    // grouped by major; minors fold unless one is in use
    const groups = new Map();
    for (const v of vs) (groups.get(R.major(v.n)) ?? groups.set(R.major(v.n), []).get(R.major(v.n))).push(v);
    for (const [M, g] of groups){
      const head = g.find(v => !String(v.n).includes('.')) ?? g[0];
      const minors = g.filter(v => v !== head);
      const open = x.openMinor.has(`${fact}:${L}:${M}`) || minors.some(v => v.id === using?.id);
      out += ed?.mode === 'edit' && v_isCur(head, using, over) ? E(head) : row(head);
      if (minors.length){
        if (open) for (const v of minors) out += ed?.mode === 'edit' && v_isCur(v, using, over) ? E(v) : row(v);
        else out += `<div class="vmore" data-act="unfold" data-m="${esc(M)}">▸ ${h('edit.moreUnder', { n: minors.length, v: M })}</div>`;
      }
    }
  }
  if (ed?.mode === 'new') out += E();
  out += '</div>';
  if (!ed && vs.length) out += `<a class="newv" data-act="new-version">${h('edit.newVersion', { v: R.nextMajor(m, fact, L) })}</a>`;
  out += `<p class="note">${career ? h('career.versionsNote') : h('edit.versionsNote')}</p>`;
  return out;
}

const v_isCur = (v, using, over) => over === undefined && v.id === using?.id;

// a Resume row: the version in use in full, the others as a gist
function vrow(v, using, over, x){
  const isCur = v_isCur(v, using, over);
  const minor = String(v.n).includes('.');
  const ln = x.lines(v);
  const star = x.focus && (v.tags ?? []).includes(x.focus) ? `<span class="star" title="${esc(t('edit.tagged', { tag: x.focus }))}">★</span>` : '';
  if (isCur) return `<div class="vrow cur ${minor ? 'minor' : ''}" data-v="${esc(v.id)}"><span class="rad"></span><span class="n">v${esc(v.n)}${star}</span><span class="tx">${esc(v.text)}</span>
    <span class="vbtn"><button class="ghost sm" data-act="edit" title="${esc(t('edit.editThis'))}" aria-label="${esc(t('edit.editThis'))}">✎</button></span>
    ${tagBox(v, x)}</div>`;
  return `<div class="vrow ${minor ? 'minor' : ''}" data-act="use-version" data-v="${esc(v.id)}" tabindex="0" title="${esc(v.text)}">
    <span class="rad"></span><span class="n">v${esc(v.n)}${star}</span><span class="tx">${gist(v.text, over ?? using?.text ?? '')}</span>
    <span class="mt2">${ln ? `${h('edit.lnShort', { n: ln })} · ` : ''}${h('edit.chShort', { n: [...v.text].length })}</span>
    <span class="acts"><button class="ghost sm" data-act="compare" data-v="${esc(v.id)}" title="${esc(t('edit.compareTitle'))}" aria-label="${esc(t('edit.compareTitle'))}">⇄</button><button class="ghost sm" data-act="delete-version" data-v="${esc(v.id)}" title="${esc(t('edit.deleteV', { v: v.n }))}" aria-label="${esc(t('edit.deleteV', { v: v.n }))}">🗑</button></span>
    ${(v.tags ?? []).length ? `<div class="vtags">${v.tags.slice(0, 4).map(tg => tagChip(tg, { jobTypes: x.jobTypes, focus: x.focus })).join('')}${v.tags.length > 4 ? `<span class="muted tiny">+${v.tags.length - 4}</span>` : ''}</div>` : ''}</div>`;
}

function flatRow(v, x){
  const minor = String(v.n).includes('.');
  const star = x.focus && (v.tags ?? []).includes(x.focus) ? `<span class="star" title="${esc(t('edit.tagged', { tag: x.focus }))}">★</span>` : '';
  return `<div class="vrow flat ${minor ? 'minor' : ''} ${x.pick === v.id ? 'is-pick' : ''}" data-v="${esc(v.id)}"><span class="n">v${esc(v.n)}${star}</span><span class="tx">${esc(v.text)}</span>
    <span class="vbtn"><button class="ghost sm" data-act="edit" data-v="${esc(v.id)}" title="${esc(t('edit.editEnter'))}" aria-label="${esc(t('edit.editThis'))}">✎</button><button class="ghost sm" data-act="compare" data-v="${esc(v.id)}" title="${esc(t('career.compareAbove'))}" aria-label="${esc(t('career.compareAbove'))}" ${x.vs[0] === v ? 'disabled' : ''}>⇄</button><button class="ghost sm" data-act="delete-version" data-v="${esc(v.id)}" title="${esc(t('edit.deleteV', { v: v.n }))}" aria-label="${esc(t('edit.deleteV', { v: v.n }))}">🗑</button></span>
    ${tagBox(v, x)}</div>`;
}

// Under the claim's heading. The Resume adds on/off and Keep; 🗑 deletes the claim and every
// version of it. deletable: the claim is one of an entry's, not a title or a summary.
export function claimHead({ ws, hasJob = false, on = false, kept = false, deletable = false }){
  const del = deletable ? `<button class="ghost sm" data-act="delete-claim" title="${esc(t('career.deleteClaim'))}" aria-label="${esc(t('career.deleteClaim'))}">🗑</button>` : '';
  if (ws === 'career') return del ? `<div class="ctlrow"><span class="grow"></span>${del}</div>` : '';
  return `<div class="ctlrow">${hasJob ? sw('id="b-on"', on, h('edit.onThis')) : ''}<span class="grow"></span>
      <button class="keep sm" data-act="keep" aria-pressed="${kept}" title="${esc(t('edit.keepTitle'))}">📌 ${kept ? h('edit.kept') : h('edit.keep')}</button>${del}</div>`;
}

export const addClaimHtml = ({ id, key, draft = '' }) =>
  `<label class="field addclaim"><span class="sr">${h('career.addClaim')}</span><textarea id="new-claim" rows="2" placeholder="${esc(t('career.claimPh'))}">${esc(draft)}</textarea></label>
      <div class="btns"><button class="sm addc" data-act="add-claim" data-key="${esc(key)}" data-id="${esc(id)}">${h('career.addClaim')}</button></div>`;
