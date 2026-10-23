// The resume switcher. On a desktop it is the name window: the name card grows down over the editor card and holds the full name with a
// rename field, where the resume was copied from, "This resume" (Duplicate, then Delete at the far end), the language and paper, the search and a
// list that starts with + New resume, then the last few opened (a search lists every match by job type, with the snapshots folded under the
// row they belong to), and Manage all (a full-width secondary with an arrow), which opens the
// Resumes screen (screens.js). On a phone it is the menu under the head, as it was. It lives outside #head, which is redrawn on every
// save, so the search box keeps its caret.

import * as RS from '../model/resumes.js';
import { t, h } from '../i18n/index.js';
import { icon } from './icons.js';
import { jobTypeLabel } from '../model/focus.js';
import { play } from './motion.js';

let C = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = { open: false, q: '', hover: null };
let el = null;

const RECENT_KEY = 'rb-recent', RECENT_N = 4, WINDOW_RECENT = 3;
function recentIds(){ try { const a = JSON.parse(localStorage.getItem(RECENT_KEY)); return Array.isArray(a) ? [...new Set(a.filter(x => typeof x === 'string'))] : []; } catch { return []; } }
function noteOpen(id){ try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentIds().filter(x => x !== id)].slice(0, 12))); } catch { /* this session only */ } }
function noteRename(from, to){ try { localStorage.setItem(RECENT_KEY, JSON.stringify([...new Set(recentIds().map(x => (x === from ? to : x)))])); } catch { /* ignore */ } }

const st = () => C.store.state;
const phone = () => !!C.ui.layout?.phone;

function snapLines(r){
  return RS.snapshotsOf(r).slice().reverse().map(s => {
    const first = s.sends.find(x => RS.sendLabel(x)) ?? s.sends[0];
    const more = s.sends.length > 1 ? ` +${s.sends.length - 1}` : '';
    const label = first && RS.sendLabel(first) ? t('ux1.sentTo2', { to: RS.sendLabel(first) }) : t('ux1.snapshotWord');
    return `<button class="snapline" data-act="sw-snap" data-id="${esc(r.id)}" data-sid="${esc(s.id)}">${icon('right', { role: 'inline' })} ${esc(label)} · ${esc(first?.date || s.at.slice(0, 10))}${more}</button>`;
  }).join('');
}
// A resume's name reads "Company - Role": when it does, the company is set above the role. Nothing is cut: a long name wraps.
const SPLIT = /^(.*?)\s+[-–—]\s+(.+)$/;
export function nameHtml(label){
  const m = SPLIT.exec(label);
  return m ? `<span class="swco">${esc(m[1])}</span><span class="sr"> — </span><span class="swrole">${esc(m[2])}</span>` : `<span class="swco">${esc(label)}</span>`;
}
// language and pages, as a small tag
const tagOf = r => [(r.lang ?? 'en').toUpperCase(), r.pageLimit === 0 ? t('head.anyLength') : r.pageLimit ? t('resumes.pShort', { n: r.pageLimit }) : null].filter(Boolean).join(' · ');
function rowHtml(r, where){
  const cur = r.id === st().openId;
  const out = r.forKind === 'outreach' ? `<span class="pill">${h('ux1.outreach')}</span>` : '';
  return `<div class="swrow ${cur ? 'is-cur' : ''}" role="presentation" data-rid="${esc(r.id)}">
    ${C.resumes.renamingHere(r.id, where) ? C.resumes.renameInput(r)
      : `<button class="sopt" ${cur ? 'aria-current="true"' : ''} data-act="sw-open" data-id="${esc(r.id)}"><span class="sn">${nameHtml(RS.resumeLabel(r))}</span>${out}<span class="swtag">${esc(tagOf(r))}</span></button>`}
    ${C.resumes.moreButton(r.id, where)}
    ${C.resumes.rowMenuHtml(r.id, where)}
    ${snapLines(r)}
  </div>`;
}

function html(){
  const all = st().resumes ?? [];
  const q = S.q.trim();
  const list = all.filter(r => RS.matches(st().record, r, q));
  const search = `<input id="sw-q" class="sw-q" type="search" aria-controls="sw-list" aria-label="${esc(t('ux1.search'))}" placeholder="${esc(t('ux1.search'))}" value="${esc(S.q)}" autocomplete="off">`;
  if (!phone()){
    const open = RS.savedOf(st(), st().openId), parent = open ? RS.parentOf(st(), open) : null, r = st().cur;
    const recent = q ? [] : [...new Set([st().openId, ...recentIds()])].map(id => all.find(x => x.id === id)).filter(Boolean).slice(0, WINDOW_RECENT);
    const groups = q ? RS.grouped(st().record, list) : [];
    const type = r?.jobType ? jobTypeLabel(st().record, r.jobType) : '';
    return `<label class="lbl" for="sw-rn">${h('ux1.rename')}</label>
    <input id="sw-rn" class="sw-q" data-rid="${esc(st().openId ?? '')}" value="${esc(RS.resumeLabel(r))}" autocomplete="off" ${open ? '' : 'disabled'}>
    ${parent ? `<p class="muted tiny swfrom">${h('ux6b.duplicatedFrom', { name: RS.resumeLabel(parent) })}</p>` : ''}
    <span class="lbl">${h('edit.thisResume')}</span>
    <div class="swacts"><button class="sm" data-act="rm-dup" data-id="${esc(st().openId ?? '')}" ${open ? '' : 'disabled'}>${h('ux1.dup')}</button>${C.resumes.delHtml(st().openId, !open)}</div>${C.resumes.askHtml(st().openId)}
    <label class="sr" for="sw-lang">${h('head.langGroup')}</label>
    <div class="swlang">${C.langSelect()}<select id="sw-paper" class="sw-q" aria-label="${esc(t('design.paper'))}"><option value="a4" ${r?.format === 'us-letter' ? '' : 'selected'}>${h('paper.a4')}</option><option value="us-letter" ${r?.format === 'us-letter' ? 'selected' : ''}>${h('paper.letter')}</option></select></div>
    ${type ? `<p class="muted tiny">${esc(type)}</p>` : ''}
    ${search}
    <div id="sw-list" class="swlist" role="group" aria-label="${esc(t('ux1.switcherTitle'))}">
      <button class="swnew" data-act="sw-new">${h('ux1.newResume')}</button>
      ${recent.length ? `<span class="lbl">${h('ux1.recent')}</span>${recent.map(x => rowHtml(x, 'recent')).join('')}` : ''}
      ${groups.map(g => `<span class="lbl">${esc(g.type ? g.label : t('resumes.noType'))}</span>${g.resumes.map(x => rowHtml(x, 'group')).join('')}`).join('')}
      ${q && !list.length ? `<p class="muted small swnone">${h('ux1.noMatch')}</p>` : ''}
    </div>
    <div class="swfoot"><button class="sm swmanage" data-act="sw-manage"><span>${h('ux1.manageAll', { n: all.length })}</span>${icon('right', { role: 'control' })}</button></div>`;
  }
  const groups = RS.grouped(st().record, list);
  const recent = q ? [] : recentIds().map(id => all.find(r => r.id === id)).filter(Boolean).slice(0, RECENT_N);
  return `<span class="lbl">${h('edit.thisResume')}</span>
  <div class="swacts"><button class="sm" data-act="rm-dup" data-id="${esc(st().openId ?? '')}" ${st().openId ? '' : 'disabled'}>${h('ux1.dup')}</button>${C.resumes.delHtml(st().openId, !st().openId)}</div>${C.resumes.askHtml(st().openId)}
  ${search}
  <div id="sw-list" class="swlist" role="group" aria-label="${esc(t('ux1.switcherTitle'))}">
    <button class="swnew" data-act="sw-new">${h('ux1.newResume')}</button>
    ${recent.length ? `<span class="lbl">${h('ux1.recent')}</span>${recent.map(r => rowHtml(r, 'recent')).join('')}` : ''}
    ${groups.map(g => `<span class="lbl">${esc(g.type ? g.label : t('resumes.noType'))}</span>${g.resumes.map(r => rowHtml(r, 'group')).join('')}`).join('')}
    ${list.length ? '' : `<p class="muted small swnone">${h(all.length ? 'ux1.noMatch' : 'ux1.noneYet')}</p>`}
  </div>
  <div class="swfoot"><button class="sm swmanage" data-act="sw-manage"><span>${h('ux1.manageAll', { n: all.length })}</span>${icon('right', { role: 'control' })}</button></div>`;
}

function render({ keepFocus = true } = {}){
  if (!el) return;
  el.hidden = !S.open;
  document.getElementById('col')?.classList.toggle('is-name', S.open);      // the editor card collapses away while the name window is open
  el.setAttribute('aria-label', t('ux1.switcherTitle'));
  document.getElementById('docname-btn')?.setAttribute('aria-expanded', String(S.open));
  if (!S.open){ el.innerHTML = ''; return; }
  const q = el.querySelector('#sw-q');
  const hadFocus = keepFocus && q && document.activeElement === q;
  const pos = q?.selectionStart ?? null;
  const scroll = el.querySelector('.swlist')?.scrollTop ?? 0;
  el.innerHTML = html();
  // on a phone the menu hangs below the header row
  const hd = document.getElementById('head');
  if (hd && phone()){
    const top = hd.offsetHeight + 6, col = document.getElementById('col').getBoundingClientRect();
    el.style.setProperty('--sw-top', `${top}px`);
    el.style.setProperty('--sw-max', `${Math.max(240, Math.round(col.height - top - 8))}px`);      // it ends at the panel's foot
  }
  const list = el.querySelector('.swlist');
  if (list) list.scrollTop = scroll;
  if (hadFocus){ const n = el.querySelector('#sw-q'); n.focus(); if (pos != null) n.setSelectionRange(pos, pos); }
}

// `name`: the name is to be typed over (a copy was just made): the window opens, or is drawn again, with the name field selected
function open({ name = false } = {}){
  if (S.open){ if (name){ render({ keepFocus: false }); nameField(); } return; }
  C.closeMenus();
  S.open = true; S.q = '';
  C.relayout();
  render({ keepFocus: false });
  C.opened?.();
  // a desktop's name window keeps the focus on the name (Tab walks into the window); the others go to the search
  if (name && !phone()) nameField();
  else if (phone()) el.querySelector('#sw-q')?.focus();
  else play(el, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { key: 'namewin', name: 'namewin:in' });
  // the open resume, in view
  el.querySelector('.swrow.is-cur')?.scrollIntoView({ block: 'nearest' });
}
const nameField = () => { const n = el.querySelector('#sw-rn'); n?.focus(); n?.select(); };
function close({ focusBack = false } = {}){
  if (!S.open) return;
  const rn = el.querySelector('#sw-rn');
  if (rn && rn.dataset.rid === st().openId) rename(rn);                  // a name typed and not confirmed is kept (not on another resume: it was opened)
  S.open = false; S.q = '';
  C.relayout();
  render();
  C.resumes.reset();
  C.endPreview();
  play(document.getElementById('body'), [{ opacity: 0 }, { opacity: 1 }], { key: 'namewin', ms: 'fast', name: 'namewin:out' });
  if (focusBack) document.getElementById('docname-btn')?.focus();
}
const toggle = () => (S.open ? close({ focusBack: true }) : open());
// Ctrl+O: open it, or if it is open already, back to the search box
const openOrFocus = () => { if (!S.open) open(); el.querySelector('#sw-q')?.focus(); };

function navItems(){ return [...el.querySelectorAll('#sw-rn, .swacts button:not(:disabled), .delask button, #sw-q, .ddbtn, .swnew, .sopt, .smore, .snapline, .swfoot button:not(:disabled)')].filter(x => !x.closest('.rowmenu')); }

async function act(a, tg){
  switch (a){
    case 'switcher': toggle(); return true;
    case 'sw-open': if (C.resumes.open(tg.dataset.id)) close(); return true;
    case 'sw-snap': C.resumes.openSnapshot(tg.dataset.id, tg.dataset.sid); close(); return true;
    case 'sw-new': close(); C.setView('new'); return true;
    case 'sw-manage': close(); C.setView('resumes'); return true;
  }
  return false;
}

// the open resume's name, from the rename field (on Enter or when the field is left)
function rename(input){
  const id = st().openId, r = RS.savedOf(st(), id), name = input.value.trim();
  if (!r || !name || name === RS.resumeLabel(r)){ input.value = RS.resumeLabel(st().cur); return; }
  let res;
  try { C.store.commit(d => { res = RS.renameSaved(d, id, name); }, t('ux1.undoRename')); } catch (e){ C.toast(e.message, 'bad'); return; }
  if (res) noteRename(id, res.id);
}

function bind(){
  el = document.createElement('div');
  el.id = 'switcher';
  el.className = 'pop card switcher';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('ux1.switcherTitle'));
  document.getElementById('head').after(el);        // under the name card: with it, one card while the window is open
  el.addEventListener('input', e => { if (e.target.id === 'sw-q'){ S.q = e.target.value; render(); } });
  el.addEventListener('change', e => {
    if (e.target.id === 'sw-rn') return rename(e.target);
    if (e.target.id === 'sw-lang') return C.chooseLang(e.target.value);
    if (e.target.id === 'sw-paper') return C.choosePaper(e.target.value);
  });
  el.addEventListener('mouseover', e => {
    const row = e.target.closest?.('.sopt, .snapline');
    const key = row ? `${row.dataset.id ?? row.closest('.swrow')?.dataset.rid}:${row.dataset.sid ?? ''}` : null;
    if (!row || S.hover === key || C.resumes.rowOpen) return;
    S.hover = key;
    if (row.classList.contains('snapline')){
      const r = RS.savedOf(st(), row.dataset.id), snap = r && RS.snapshotsOf(r).find(x => x.id === row.dataset.sid);
      if (snap) C.previewRecipe(RS.snapshotRecipe(C.work(), snap), null);
    } else C.resumes.previewSaved(row.dataset.id);
  });
  el.addEventListener('mouseout', e => {
    if (e.relatedTarget && el.contains(e.relatedTarget) && e.relatedTarget.closest?.('.sopt, .snapline')) return;
    if (S.hover === null) return;
    S.hover = null;
    C.endPreview();
  });
  el.addEventListener('focusin', e => {
    const row = e.target.closest?.('.sopt');
    if (row && S.hover !== `${row.dataset.id}:`){ S.hover = `${row.dataset.id}:`; C.resumes.previewSaved(row.dataset.id); }
  });
  // renaming a row happens in place
  el.addEventListener('focusout', e => { if (e.target.classList?.contains('swren')) C.resumes.renameDone(e.target, true); });
  el.addEventListener('keydown', e => {
    if (e.target.classList?.contains('swren')){
      if (e.key === 'Enter'){ e.preventDefault(); C.resumes.renameDone(e.target, true); }
      if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); C.resumes.renameDone(e.target, true); }
      return;
    }
    if (e.target.closest('.rowmenu')){ if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); C.resumes.closeMenus(); } return; }
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close({ focusBack: true }); return; }
    if (e.target.id === 'sw-rn' && e.key === 'Enter'){ e.preventDefault(); close({ focusBack: true }); return; }      // Enter confirms the name
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      if (e.target.tagName === 'SELECT') return;
      const items = navItems();
      const at = items.indexOf(document.activeElement);
      const next = items[Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next){ e.preventDefault(); next.focus(); }
      return;
    }
    // typing anywhere goes to the search box
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest('input, select, textarea, .ddbtn')) el.querySelector('#sw-q')?.focus();
  });
  document.addEventListener('mousedown', e => {
    if (S.open && !e.target.closest('#switcher, #docname-btn, #foot')) close();
  });
}

export function initSwitcher(ctx){
  C = ctx;
  return { bind, act, open, close, toggle, openOrFocus, render, noteOpen, noteRename, get isOpen(){ return S.open; } };
}
