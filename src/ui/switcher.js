// The resume switcher. On a desktop it is the name window: the name card grows down over the editor card and holds the full name with a
// rename field, where the resume was copied from, Duplicate, Record, + New resume, the language and paper, the search and the last few
// opened (a search lists every match by job type, with the snapshots folded under the row they belong to), and Manage all. On a phone it is
// the menu under the head, as it was. "Manage all…" grows the window to the whole window (until the resume list is redesigned): the search stays and
// three views show the whole list, by Job type, by Date (every send, newest first) or by Company, with the tick boxes for Compare. It lives
// outside #head, which is redrawn on every save, so the search box keeps its caret.

import * as RS from '../model/resumes.js';
import { t, h } from '../i18n/index.js';
import { icon } from './icons.js';
import { jobTypeLabel } from '../model/focus.js';
import { play } from './motion.js';

let C = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = { open: false, grown: false, view: 'type', q: '', hover: null };
let el = null;

const RECENT_KEY = 'rb-recent', RECENT_N = 4, WINDOW_RECENT = 3, VIEW_KEY = 'rb-manage-view';
export const VIEWS = ['type', 'date', 'company'];
function recentIds(){ try { const a = JSON.parse(localStorage.getItem(RECENT_KEY)); return Array.isArray(a) ? [...new Set(a.filter(x => typeof x === 'string'))] : []; } catch { return []; } }
function noteOpen(id){ try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentIds().filter(x => x !== id)].slice(0, 12))); } catch { /* this session only */ } }
function noteRename(from, to){ try { localStorage.setItem(RECENT_KEY, JSON.stringify([...new Set(recentIds().map(x => (x === from ? to : x)))])); } catch { /* ignore */ } }
const savedView = () => { try { const v = localStorage.getItem(VIEW_KEY); return VIEWS.includes(v) ? v : 'type'; } catch { return 'type'; } };
const saveView = v => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* this session only */ } };

const st = () => C.store.state;
const picked = () => C.resumes.picked;
const phone = () => !!C.ui.layout?.phone;

function snapLines(r){
  return RS.snapshotsOf(r).slice().reverse().map(s => {
    const first = s.sends.find(x => RS.sendLabel(x)) ?? s.sends[0];
    const more = s.sends.length > 1 ? ` +${s.sends.length - 1}` : '';
    const label = first && RS.sendLabel(first) ? t('ux1.sentTo2', { to: RS.sendLabel(first) }) : t('ux1.snapshotWord');
    return `<button class="snapline" data-act="sw-snap" data-id="${esc(r.id)}" data-sid="${esc(s.id)}">${icon('right', { size: 12 })} ${esc(label)} · ${esc(first?.date || s.at.slice(0, 10))}${more}</button>`;
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
function rowHtml(r, where, { ticks = false, outreach = null } = {}){
  const cur = r.id === st().openId;
  const out = (outreach ?? r.forKind === 'outreach') ? `<span class="pill">${h('ux1.outreach')}</span>` : '';
  return `<div class="swrow ${cur ? 'is-cur' : ''} ${ticks ? 'has-tick' : ''}" role="presentation" data-rid="${esc(r.id)}">
    ${ticks ? `<input type="checkbox" class="pick" data-cmp="${esc(r.id)}" ${picked().includes(r.id) ? 'checked' : ''} aria-label="${esc(t('resumes.compareX', { name: RS.resumeLabel(r) }))}">` : ''}
    ${C.resumes.renamingHere(r.id, where) ? C.resumes.renameInput(r)
      : `<button class="sopt" ${cur ? 'aria-current="true"' : ''} data-act="sw-open" data-id="${esc(r.id)}"><span class="sn">${nameHtml(RS.resumeLabel(r))}</span>${out}<span class="swtag">${esc(tagOf(r))}</span></button>`}
    ${C.resumes.moreButton(r.id, where)}
    ${C.resumes.rowMenuHtml(r.id, where)}
    ${snapLines(r)}
  </div>`;
}

// ---- the grown menu's three views ----
function byType(list){
  const groups = RS.grouped(st().record, list);
  return groups.map(g => `<span class="lbl">${esc(g.type ? g.label : t('resumes.noType'))}</span>${g.resumes.map(r => rowHtml(r, 'group', { ticks: true })).join('')}`).join('');
}
function byDate(list){
  const bands = RS.sendBands(RS.sendEvents(list));
  return bands.map(b => `<div class="yr">${esc(b.year || t('ux2.noDate'))}</div>${b.events.map(e => {
    const r = e.resume;
    if (e.kind === 'saved') return `<div class="swrow tlrow" data-rid="${esc(r.id)}"><button class="sopt" data-act="sw-open" data-id="${esc(r.id)}"><span class="sn">${esc(RS.resumeLabel(r))}</span><span class="muted small">${esc(t('ux2.lastSaved', { date: e.date || '—' }))}</span></button></div>`;
    const to = RS.sendLabel(e.send);
    return `<div class="swrow tlrow" data-rid="${esc(r.id)}"><button class="snapline tlsend" data-act="sw-snap" data-id="${esc(r.id)}" data-sid="${esc(e.snap.id)}">
        <span class="sn">${esc(to || t('ux1.noRecipient'))}${e.send.kind === 'outreach' ? ` <span class="pill">${h('ux1.outreach')}</span>` : ''}</span><span class="muted small">${esc(e.send.date)} · ${esc(RS.resumeLabel(r))}</span></button></div>`;
  }).join('')}`).join('');
}
function byCompany(list){
  return RS.byCompany(list).map(g => `<span class="lbl">${esc(g.key ? g.label : t('ux2.noCompany'))}</span>${g.rows.map(row => rowHtml(row.resume, `company:${g.key}`, { ticks: true, outreach: row.outreach && !!g.key })).join('')}`).join('');
}

function html(){
  const all = st().resumes ?? [];
  const q = S.q.trim();
  const list = all.filter(r => RS.matches(st().record, r, q) || (S.view === 'company' && q && RS.snapshotsOf(r).some(s => s.sends.some(x => String(x.company).toLowerCase().includes(q.toLowerCase())))));
  const search = `<input id="sw-q" class="sw-q" type="search" aria-controls="sw-list" aria-label="${esc(t('ux1.search'))}" placeholder="${esc(t('ux1.search'))}" value="${esc(S.q)}" autocomplete="off">`;
  if (!S.grown && !phone()){
    const open = RS.savedOf(st(), st().openId), parent = open ? RS.parentOf(st(), open) : null, r = st().cur;
    const recent = q ? [] : [...new Set([st().openId, ...recentIds()])].map(id => all.find(x => x.id === id)).filter(Boolean).slice(0, WINDOW_RECENT);
    const groups = q ? RS.grouped(st().record, list) : [];
    const type = r?.jobType ? jobTypeLabel(st().record, r.jobType) : '';
    return `<label class="lbl" for="sw-rn">${h('ux1.rename')}</label>
    <input id="sw-rn" class="sw-q" value="${esc(RS.resumeLabel(r))}" autocomplete="off" ${open ? '' : 'disabled'}>
    ${parent ? `<p class="muted tiny swfrom">${h('ux6b.duplicatedFrom', { name: RS.resumeLabel(parent) })}</p>` : ''}
    <div class="swacts"><button class="sm" data-act="rm-dup" data-id="${esc(st().openId ?? '')}" ${open ? '' : 'disabled'}>${h('ux1.dup')}</button><button class="sm" data-act="sw-record">${h('ux3b.modeRecord')}</button><button class="sm swnew" data-act="sw-new">${h('ux1.newResume')}</button></div>
    <label class="sr" for="sw-lang">${h('head.langGroup')}</label>
    <div class="swlang">${C.langSelect()}<select id="sw-paper" class="sw-q" aria-label="${esc(t('design.paper'))}"><option value="a4" ${r?.format === 'us-letter' ? '' : 'selected'}>${h('paper.a4')}</option><option value="us-letter" ${r?.format === 'us-letter' ? 'selected' : ''}>${h('paper.letter')}</option></select></div>
    ${type ? `<p class="muted tiny">${esc(type)}</p>` : ''}
    ${search}
    <div id="sw-list" class="swlist" role="group" aria-label="${esc(t('ux1.switcherTitle'))}">
      ${recent.length ? `<span class="lbl">${h('ux1.recent')}</span>${recent.map(x => rowHtml(x, 'recent')).join('')}` : ''}
      ${groups.map(g => `<span class="lbl">${esc(g.type ? g.label : t('resumes.noType'))}</span>${g.resumes.map(x => rowHtml(x, 'group')).join('')}`).join('')}
      ${q && !list.length ? `<p class="muted small swnone">${h('ux1.noMatch')}</p>` : ''}
    </div>
    <div class="swfoot"><button class="sm" data-act="sw-manage">${h('ux1.manageAll', { n: all.length })}</button></div>`;
  }
  if (!S.grown){
    const groups = RS.grouped(st().record, list);
    const recent = q ? [] : recentIds().map(id => all.find(r => r.id === id)).filter(Boolean).slice(0, RECENT_N);
    return `<div class="swacts"><button class="sm" data-act="rm-dup" data-id="${esc(st().openId ?? '')}" ${st().openId ? '' : 'disabled'}>${h('ux1.dup')}</button><button class="sm" data-act="sw-record">${h('ux3b.modeRecord')}</button></div>
    ${search}
    <button class="swnew" data-act="sw-new">${h('ux1.newResume')}</button>
    <div id="sw-list" class="swlist" role="group" aria-label="${esc(t('ux1.switcherTitle'))}">
      ${recent.length ? `<span class="lbl">${h('ux1.recent')}</span>${recent.map(r => rowHtml(r, 'recent')).join('')}` : ''}
      ${groups.map(g => `<span class="lbl">${esc(g.type ? g.label : t('resumes.noType'))}</span>${g.resumes.map(r => rowHtml(r, 'group')).join('')}`).join('')}
      ${list.length ? '' : `<p class="muted small swnone">${h(all.length ? 'ux1.noMatch' : 'ux1.noneYet')}</p>`}
    </div>
    <div class="swfoot"><button class="sm" data-act="sw-manage">${h('ux1.manageAll', { n: all.length })}</button></div>`;
  }
  const views = VIEWS.map(v => `<button role="tab" data-act="sw-view" data-v="${v}" aria-selected="${S.view === v}" tabindex="${S.view === v ? 0 : -1}">${h(`ux2.view.${v}`)}</button>`).join('');
  const body = S.view === 'date' ? byDate(list) : S.view === 'company' ? byCompany(list) : byType(list);
  return `<div class="swhead">${search}<button class="ghost sm" data-act="sw-close" aria-label="${esc(t('body.close'))}">${icon('close')}</button></div>
    <div class="swhead2"><div class="seg" role="tablist" aria-label="${esc(t('ux2.manageViews'))}">${views}</div><button class="swnew sm" data-act="sw-new">${h('ux1.newResume')}</button></div>
    <div id="sw-list" class="swlist" role="group" aria-label="${esc(t('ux1.manageTitle', { n: all.length }))}">
      ${body}
      ${list.length ? '' : `<p class="muted small swnone">${h(all.length ? 'ux1.noMatch' : 'ux1.noneYet')}</p>`}
    </div>
    <div class="swfoot"><span class="muted small">${picked().length === 2 ? '' : h('ux2.tickTwo')}</span><span class="grow"></span><button class="sm primary" data-act="sw-compare" ${picked().length === 2 ? '' : 'disabled'}>${h('resumes.compareN', { n: picked().length })}</button></div>`;
}

function render({ keepFocus = true } = {}){
  if (!el) return;
  el.hidden = !S.open;
  el.classList.toggle('is-grown', S.grown);
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

function open({ grown = false } = {}){
  if (S.open){ if (grown && !S.grown){ S.grown = true; S.view = savedView(); C.relayout(); render({ keepFocus: false }); el.querySelector('#sw-q')?.focus(); } return; }
  C.closeMenus();
  S.open = true; S.q = ''; S.grown = grown; S.view = savedView();
  C.relayout();
  render({ keepFocus: false });
  C.opened?.();
  // a desktop's name window keeps the focus on the name (Tab walks into the window); the others go to the search
  if (grown || phone()) el.querySelector('#sw-q')?.focus();
  else play(el, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { key: 'namewin', name: 'namewin:in' });
  // the open resume, in view
  el.querySelector('.swrow.is-cur')?.scrollIntoView({ block: 'nearest' });
}
function close({ focusBack = false } = {}){
  if (!S.open) return;
  S.open = false; S.q = ''; S.grown = false;
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

function navItems(){ return [...el.querySelectorAll('#sw-rn, .swacts button:not(:disabled), #sw-lang, #sw-paper, #sw-q, .swnew, [role=tab][aria-selected=true], .pick, .sopt, .smore, .snapline, .swfoot button:not(:disabled)')].filter(x => !x.closest('.rowmenu')); }

async function act(a, tg){
  switch (a){
    case 'switcher': toggle(); return true;
    case 'sw-open': if (C.resumes.open(tg.dataset.id)) close(); return true;
    case 'sw-snap': C.resumes.openSnapshot(tg.dataset.id, tg.dataset.sid); close(); return true;
    case 'sw-new': close(); C.setView('new'); return true;
    case 'sw-record': close(); C.setView('record'); return true;
    case 'sw-manage': open({ grown: true }); if (!S.grown){ S.grown = true; S.view = savedView(); C.relayout(); render({ keepFocus: false }); } el.querySelector('#sw-q')?.focus(); return true;
    case 'sw-close': close({ focusBack: true }); return true;
    case 'sw-view': S.view = tg.dataset.v; saveView(S.view); render({ keepFocus: false }); el.querySelector('[role=tab][aria-selected=true]')?.focus(); return true;
    case 'sw-compare': if (picked().length === 2){ close(); C.setView('compare'); } return true;
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
    const id = e.target.dataset?.cmp;
    if (!id) return;
    C.resumes.picked = e.target.checked ? [...picked().filter(x => x !== id), id].slice(-2) : picked().filter(x => x !== id);
    render({ keepFocus: false });
    el.querySelector(`.pick[data-cmp="${CSS.escape(id)}"]`)?.focus();
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
      if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); C.resumes.renameDone(e.target, false); }
      return;
    }
    if (e.target.closest('.rowmenu')){ if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); C.resumes.closeMenus(); } return; }
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close({ focusBack: true }); return; }
    const tab = e.target.closest?.('[role=tab]');
    if (tab && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')){
      e.preventDefault();
      const at = VIEWS.indexOf(S.view);
      S.view = VIEWS[(at + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length];
      saveView(S.view); render({ keepFocus: false });
      el.querySelector('[role=tab][aria-selected=true]')?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      if (e.target.tagName === 'SELECT') return;
      const items = navItems();
      const at = items.indexOf(document.activeElement);
      const next = items[Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next){ e.preventDefault(); next.focus(); }
      return;
    }
    // typing anywhere goes to the search box
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest('input, select, textarea')) el.querySelector('#sw-q')?.focus();
  });
  document.addEventListener('mousedown', e => {
    if (S.open && !e.target.closest('#switcher, #docname-btn, #foot')) close();
  });
}

export function initSwitcher(ctx){
  C = ctx;
  return { bind, act, open, close, toggle, openOrFocus, render, noteOpen, noteRename, get isOpen(){ return S.open; }, get grown(){ return S.grown; }, get view(){ return S.view; } };
}
