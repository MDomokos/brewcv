// The resume switcher: the resume's name in the header opens it. Search, + New resume, the last few opened, then
// every resume by job type, with the snapshots folded under the row they belong to. It lives outside #head,
// which is redrawn on every save, so the search box keeps its caret.

import * as RS from '../model/resumes.js';
import { t, h } from '../i18n/index.js';

let C = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = { open: false, q: '', hover: null };
let el = null;

const RECENT_KEY = 'rb-recent', RECENT_N = 4;
function recentIds(){ try { const a = JSON.parse(localStorage.getItem(RECENT_KEY)); return Array.isArray(a) ? [...new Set(a.filter(x => typeof x === 'string'))] : []; } catch { return []; } }
function noteOpen(id){ try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentIds().filter(x => x !== id)].slice(0, 12))); } catch { /* this session only */ } }
function noteRename(from, to){ try { localStorage.setItem(RECENT_KEY, JSON.stringify([...new Set(recentIds().map(x => (x === from ? to : x)))])); } catch { /* ignore */ } }

const st = () => C.store.state;

function rowHtml(r, where){
  const cur = r.id === st().openId;
  const sub = [r.forKind === 'outreach' ? t('ux1.outreach') : null, r.company].filter(Boolean).join(' · ');
  const snaps = RS.snapshotsOf(r).slice().reverse();
  return `<div class="swrow ${cur ? 'is-cur' : ''}" role="presentation" data-rid="${esc(r.id)}">
    ${C.resumes.renamingHere(r.id, where) ? C.resumes.renameInput(r)
      : `<button class="sopt" role="option" aria-selected="${cur}" data-act="sw-open" data-id="${esc(r.id)}"><span class="sn">${esc(RS.resumeLabel(r))}</span>${sub ? `<span class="muted small">${esc(sub)}</span>` : ''}</button>`}
    ${C.resumes.moreButton(r.id, where)}
    ${C.resumes.rowMenuHtml(r.id, where)}
    ${snaps.map(s => {
      const first = s.sends.find(x => RS.sendLabel(x)) ?? s.sends[0];
      const more = s.sends.length > 1 ? ` +${s.sends.length - 1}` : '';
      const label = first && RS.sendLabel(first) ? t('ux1.sentTo2', { to: RS.sendLabel(first) }) : t('ux1.snapshotWord');
      return `<button class="snapline" data-act="sw-snap" data-id="${esc(r.id)}" data-sid="${esc(s.id)}">⤷ ${esc(label)} · ${esc(first?.date || s.at.slice(0, 10))}${more}</button>`;
    }).join('')}
  </div>`;
}

function html(){
  const all = st().resumes ?? [];
  const q = S.q.trim();
  const list = all.filter(r => RS.matches(st().record, r, q));
  const groups = RS.grouped(st().record, list);
  const recent = q ? [] : recentIds().map(id => all.find(r => r.id === id)).filter(Boolean).slice(0, RECENT_N);
  return `<input id="sw-q" class="sw-q" type="search" role="combobox" aria-expanded="true" aria-controls="sw-list" aria-label="${esc(t('ux1.search'))}" placeholder="${esc(t('ux1.search'))}" value="${esc(S.q)}" autocomplete="off">
    <button class="swnew" data-act="sw-new">${h('ux1.newResume')}</button>
    <div id="sw-list" class="swlist" role="listbox" aria-label="${esc(t('ux1.switcherTitle'))}">
      ${recent.length ? `<span class="lbl">${h('ux1.recent')}</span>${recent.map(r => rowHtml(r, 'recent')).join('')}` : ''}
      ${groups.map(g => `<span class="lbl">${esc(g.type ? g.label : t('resumes.noType'))}</span>${g.resumes.map(r => rowHtml(r, 'group')).join('')}`).join('')}
      ${list.length ? '' : `<p class="muted small swnone">${h(all.length ? 'ux1.noMatch' : 'ux1.noneYet')}</p>`}
    </div>
    <div class="swfoot"><button class="sm" data-act="sw-compare" ${all.length > 1 ? '' : 'disabled'}>${h('ux1.compareTwo')}</button><button class="sm" data-act="sw-manage">${h('ux1.manageAll', { n: all.length })}</button></div>`;
}

function render({ keepFocus = true } = {}){
  if (!el) return;
  el.hidden = !S.open;
  el.setAttribute('aria-label', t('ux1.switcherTitle'));
  document.getElementById('docname-btn')?.setAttribute('aria-expanded', String(S.open));
  if (!S.open){ el.innerHTML = ''; return; }
  const q = el.querySelector('#sw-q');
  const hadFocus = keepFocus && q && document.activeElement === q;
  const pos = q?.selectionStart ?? null;
  const scroll = el.querySelector('.swlist')?.scrollTop ?? 0;
  el.innerHTML = html();
  const list = el.querySelector('.swlist');
  if (list) list.scrollTop = scroll;
  if (hadFocus){ const n = el.querySelector('#sw-q'); n.focus(); if (pos != null) n.setSelectionRange(pos, pos); }
}

function open(){
  if (S.open) return;
  C.closeMenus();
  S.open = true; S.q = '';
  render({ keepFocus: false });
  el.querySelector('#sw-q')?.focus();
  // the open resume, in view
  el.querySelector('.swrow.is-cur')?.scrollIntoView({ block: 'nearest' });
}
function close({ focusBack = false } = {}){
  if (!S.open) return;
  S.open = false; S.q = '';
  render();
  C.resumes.reset();
  C.endPreview();
  if (focusBack) document.getElementById('docname-btn')?.focus();
}
const toggle = () => (S.open ? close({ focusBack: true }) : open());
// Ctrl+O: open it, or if it is open already, back to the search box
const openOrFocus = () => { if (S.open) el.querySelector('#sw-q')?.focus(); else open(); };

function navItems(){ return [...el.querySelectorAll('#sw-q, .swnew, .sopt, .smore, .snapline, .swfoot button:not(:disabled)')].filter(x => !x.closest('.rowmenu')); }

async function act(a, tg){
  switch (a){
    case 'switcher': toggle(); return true;
    case 'sw-open': if (C.resumes.open(tg.dataset.id)) close(); return true;
    case 'sw-snap': C.resumes.openSnapshot(tg.dataset.id, tg.dataset.sid); close(); return true;
    case 'sw-new': close(); C.setView('new'); return true;
    case 'sw-manage': close(); C.setView('resumes'); return true;
    case 'sw-compare': close(); C.setView('resumes'); C.toast(t('ux1.tickTwo')); return true;
  }
  return false;
}

function bind(){
  el = document.createElement('div');
  el.id = 'switcher';
  el.className = 'pop card switcher';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('ux1.switcherTitle'));
  document.getElementById('col').append(el);
  el.addEventListener('input', e => { if (e.target.id === 'sw-q'){ S.q = e.target.value; render(); } });
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
      if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); C.resumes.renameDone(e.target, false); }
      return;
    }
    if (e.target.closest('.rowmenu')){ if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); C.resumes.closeMenus(); } return; }
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close({ focusBack: true }); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      const items = navItems();
      const at = items.indexOf(document.activeElement);
      const next = items[Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next){ e.preventDefault(); next.focus(); }
      return;
    }
    // typing anywhere goes to the search box
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.target.id !== 'sw-q') el.querySelector('#sw-q')?.focus();
  });
  document.addEventListener('mousedown', e => {
    if (S.open && !e.target.closest('#switcher') && !e.target.closest('#docname-btn')) close();
  });
}

export function initSwitcher(ctx){
  C = ctx;
  return { bind, act, open, close, toggle, openOrFocus, render, noteOpen, noteRename, get isOpen(){ return S.open; } };
}
