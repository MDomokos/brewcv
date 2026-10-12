// The editor column's furniture: the panel that folds to a 52px rail (Auto, Open, Closed), the rail, and
// the one line at the bottom with the zoom controls and a fill meter for every page. Hover hints too.
// The panel's own content is edit.js's; the shell calls sync() whenever something that decides whether
// the panel shows has changed (the selection, the view, the pin).

import { icon } from './icons.js';
import { t, h } from '../i18n/index.js';
import { FILL_BAND } from '../fit.js';
import { clampZoom, ZOOM_MIN, ZOOM_MAX, PHONE_MAX } from './layout.js';

let C = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (s, r = document) => r.querySelector(s);

const PANEL_KEY = 'rb-panel', ZOOMW_KEY = 'rb-zoomwrite', CONTRAST_KEY = 'rb-contrast';
export const PANEL_MODES = ['auto', 'open', 'closed'];
export const ZOOM_WRITE = { min: 80, max: 220, step: 5, def: 130 };
const get = (k, ok, def) => { try { const v = localStorage.getItem(k); return ok(v) ? v : def; } catch { return def; } };
const set = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* this session only */ } };
export const readPanel = () => get(PANEL_KEY, v => PANEL_MODES.includes(v), 'auto');
export const readZoomWrite = () => { const n = Number(get(ZOOMW_KEY, v => v !== null && Number.isFinite(Number(v)), ZOOM_WRITE.def)); return Math.max(ZOOM_WRITE.min, Math.min(ZOOM_WRITE.max, n)); };
export const readContrast = () => get(CONTRAST_KEY, v => v === 'sharp' || v === 'soft', 'sharp');

// the pure part of "does the panel show": checks/shell-check.mjs
export function panelShown({ pref = 'auto', selected = false, view = false, peek = false, snap = false, phone = false } = {}){
  if (phone || pref === 'open' || view) return true;
  if (pref === 'closed') return false;
  return selected || peek || snap;
}
// Esc all the way out: a pin that was Open drops to Auto; Closed stays closed
export const afterEscape = pref => (pref === 'open' ? 'auto' : pref);

// ---- the state ----
let last = null;
function shown(){
  const u = C.ui;
  return panelShown({ pref: u.panel, selected: u.sel.kind !== 'none', view: !!u.view, peek: !!u.peek, snap: !!u.snap, phone: innerWidth < PHONE_MAX });
}
const folded = () => !shown();

function setPanel(pref, { peek = false } = {}){
  if (!PANEL_MODES.includes(pref)) return;
  C.ui.panel = pref; set(PANEL_KEY, pref);
  C.ui.peek = peek;
  sync(true);
}
const togglePanel = () => setPanel(shown() ? 'closed' : 'open');
// the mode segments and the rail's icons: Edit, Design, Export
function setMode(m){
  const u = C.ui;
  u.peek = m === 'edit' && u.panel === 'auto';     // Edit with nothing selected stays open until Esc or the fold button
  if (m === 'edit'){ if (u.view) C.setView(null); }
  else C.setView(m);
  sync(true);
}
function sync(force = false){
  const f = folded();
  if (force || f !== last){ last = f; C.relayout(); }
  renderRail();
  renderFoot();
}
const modeOf = () => (C.ui.view === 'design' || C.ui.view === 'export' ? C.ui.view : C.ui.view ? null : 'edit');

// ---- hover hints: data-tip="Title|One line" ----
function installTips(){
  let tip = $('#tip'); if (!tip){ tip = document.createElement('div'); tip.id = 'tip'; tip.setAttribute('role', 'presentation'); document.body.append(tip); }
  let timer = null, cur = null;
  const hide = () => { clearTimeout(timer); tip.classList.remove('on'); cur = null; };
  document.addEventListener('pointerover', e => {
    const el = e.target.closest?.('[data-tip]'); if (el === cur) return;
    hide(); if (!el) return; cur = el;
    timer = setTimeout(() => {
      const [head, ...rest] = (el.dataset.tip || '').split('|');
      tip.innerHTML = `<b>${esc(head)}</b>${esc(rest.join('|'))}`;
      const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight, pos = el.dataset.tipPos || 'b';
      let x, y;
      if (pos === 'l'){ x = r.left - tw - 8; y = r.top + r.height / 2 - th / 2; }
      else if (pos === 't'){ x = r.left + r.width / 2 - tw / 2; y = r.top - th - 8; }
      else if (pos === 'r'){ x = r.right + 8; y = r.top + r.height / 2 - th / 2; }
      else { x = r.left + r.width / 2 - tw / 2; y = r.bottom + 8; }
      if (x + tw > innerWidth - 6) x = innerWidth - tw - 6;
      if (x < 6) x = pos === 'l' ? r.right + 8 : 6;
      if (y + th > innerHeight - 6) y = r.top - th - 8;
      tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(6, y))}px)`; tip.classList.add('on');
    }, 380);
  });
  document.addEventListener('pointerdown', hide);
  document.addEventListener('wheel', hide, { passive: true });
  document.addEventListener('pointerout', e => { if (!e.relatedTarget || !e.relatedTarget.closest?.('[data-tip]')) hide(); });
}
// a button that is only an icon: its hint (title and one line) and its name
export const ib = (act, ic, name, tip, attrs = '', pos = 'b') =>
  `<button class="ib" data-act="${act}" ${attrs} data-tip="${esc(name)}|${esc(tip)}" data-tip-pos="${pos}" aria-label="${esc(name)}">${icon(ic)}</button>`;

// ---- the meters: one per page ----
function meters(){
  const fills = C.ui.fills ?? [];
  const n = fills.length;
  return fills.map((p, i) => {
    const pct = 100 * p.used / p.usable;
    const last = i === n - 1;
    const status = p.overflow > 0 ? 'overflow' : last && pct > FILL_BAND[1] ? 'over' : last && pct < FILL_BAND[0] ? 'under' : 'ok';
    const tipText = p.overflow > 0 ? t('foot.overflowPage', { page: p.page }) : t('foot.pageFill', { page: p.page, pct: pct.toFixed(1) });
    return { i, pct, status, tipText, page: p.page };
  });
}

function railMeters(){
  return meters().map(m => `<button class="rmeter ${m.status}" data-act="goto-page" data-page="${m.i}" aria-current="${C.ui.page === m.i}" data-tip="${esc(t('ux2.pageShort', { page: m.page }))}|${esc(m.tipText)}" data-tip-pos="l" aria-label="${esc(m.tipText)}"><span class="rmfill" style="height:${Math.min(100, m.pct).toFixed(0)}%"></span></button>`).join('');
}

export function renderRail(){
  const el = $('#rail');
  if (!el) return;
  const mode = modeOf();
  const m = (id, ic, key) => `<button class="ib" data-act="rail-mode" data-m="${id}" aria-pressed="${mode === id}" data-tip="${esc(t(key))}|${esc(t('ux2.railOpen'))}" data-tip-pos="l" aria-label="${esc(t(key))}">${icon(ic)}</button>`;
  el.innerHTML = `<span class="logo railogo"><img src="icons/icon.svg" alt="BrewCV" width="28" height="28"></span><hr>
    ${m('edit', 'edit', 'ux2.modeEdit')}${m('design', 'design', 'ux2.modeDesign')}${m('export', 'export', 'ux2.modeExport')}<hr>
    <div class="rmeters" id="rmeters" role="group" aria-label="${esc(t('ux2.meters'))}">${railMeters()}</div>
    ${ib('panel-open', 'left', t('ux2.openPanel'), t('ux2.openPanelTip'), '', 'l')}`;
}

// ---- the zoom bar and the meters, on one line; Fit and undo under them ----
export function renderFoot(){
  const el = $('#foot');
  if (!el) return;
  const u = C.ui, hs = C.store.history;
  const pct = Math.round((u.zoom ?? 1) * 100);
  const f = folded();
  const limit = C.shown()?.pageLimit;
  const ms = meters();
  const spread = u.layout?.spread;
  el.classList.toggle('is-vertical', f);
  const tipPos = f ? 'l' : 't';
  const view = `<div class="vbar" role="toolbar" aria-label="${esc(t('ux2.viewBar'))}">
      ${ib('fullscreen', 'full', t('head.fullscreen'), t('ux2.fullTip'), '', tipPos)}
      ${ib('zoom-out', 'minus', t('ux2.zoomOut'), t('ux2.zoomOutTip'), u.zoom <= ZOOM_MIN + 1e-9 ? 'disabled' : '', tipPos)}
      <button class="pct" id="zoompct" data-act="zoom-pop" aria-haspopup="dialog" aria-expanded="${!!u.zpop}" data-tip="${esc(t('ux2.zoomSettings'))}|${esc(t('ux2.zoomSettingsTip'))}" data-tip-pos="${tipPos}" aria-label="${esc(t('ux2.zoomSettings'))}">${pct}%</button>
      ${ib('zoom-in', 'plus', t('ux2.zoomIn'), t('ux2.zoomInTip'), u.zoom >= ZOOM_MAX - 1e-9 ? 'disabled' : '', tipPos)}
      ${ib('zoom-fit', 'fitpage', t('ux2.zoomFit'), t('ux2.zoomFitTip'), '', tipPos)}
      ${ms.length > 1 && u.layout?.canSpread ? ib('view', spread ? 'pages1' : 'pages2', spread ? t('foot.toStack') : t('foot.toSpread'), t('ux2.viewTip'), '', tipPos) : ''}
    </div>`;
  const meterHtml = ms.map(m => `<button class="meter ${m.status}" data-act="goto-page" data-page="${m.i}" aria-current="${u.page === m.i}" title="${esc(m.tipText + t('foot.band', { lo: FILL_BAND[0], hi: FILL_BAND[1] }))}"><span class="mlab">${esc(t('ux2.pageShort', { page: m.page }))}</span><span class="mbar"><span class="mband"></span><span class="mfill" style="width:${Math.min(100, m.pct).toFixed(1)}%"></span></span><span class="mpct">${m.pct.toFixed(0)}%</span></button>`).join('');
  const act = `<div class="factions">
      <button class="primary" data-act="fit" ${u.fitting || limit === 0 || u.snap ? 'disabled' : ''} title="${esc(limit === 0 ? t('foot.fitOff') : t('foot.fitTitle'))}">${u.fitting ? h('foot.fitting') : h('foot.fit')}</button>
      <span class="grow"></span>
      ${ib('undo', 'undo', t('foot.undo'), hs.next ? t('foot.undoWhat', { what: hs.next, n: hs.undo }) : t('foot.undoN', { n: hs.undo }), hs.undo ? '' : 'disabled', tipPos)}
      ${ib('redo', 'redo', t('foot.redo'), hs.nextRedo ? t('foot.redoWhat', { what: hs.nextRedo }) : t('foot.redo'), hs.redo ? '' : 'disabled', tipPos)}
    </div>`;
  el.innerHTML = f ? `${view}${act}` : `<div class="frow">${view}<div class="meters" id="meter" role="group" aria-label="${esc(t('ux2.meters'))}">${meterHtml || '<span class="muted tiny">—</span>'}</div></div>${act}`;
  if (f) { const rm = $('#rmeters'); if (rm) rm.innerHTML = railMeters(); }
  renderPop();
}

// ---- the zoom settings pop-up ----
function renderPop(){
  const el = $('#zpop');
  if (!el) return;
  el.hidden = !C.ui.zpop;
  if (!C.ui.zpop){ el.innerHTML = ''; return; }
  const zw = readZoomWrite(), pref = C.ui.panel, soft = readContrast() === 'soft';
  el.innerHTML = `<label class="dial"><span class="dl">${h('ux2.zoomWrite')}</span><output id="zw-out">${zw}%</output><input type="range" id="zw" min="${ZOOM_WRITE.min}" max="${ZOOM_WRITE.max}" step="${ZOOM_WRITE.step}" value="${zw}" aria-label="${esc(t('ux2.zoomWrite'))}"></label>
    <div class="prow"><span id="pm-l">${h('ux2.panelMode')}</span><div class="seg" role="group" aria-labelledby="pm-l">${PANEL_MODES.map(m => `<button data-act="panel-mode" data-pm="${m}" aria-pressed="${pref === m}">${h(`ux2.panel.${m}`)}</button>`).join('')}</div></div>
    <label class="swl"><input type="checkbox" class="sw" id="contrast" ${soft ? '' : 'checked'}><span>${h('ux2.sharper')}</span></label>
    <div class="prow"><button class="sm" data-act="actual">${h('ux2.actualSize')}</button></div>
    <p class="note">${h('ux2.zoomNote')}</p>`;
}
function openPop(on){
  C.ui.zpop = on ?? !C.ui.zpop;
  renderFoot();
  if (C.ui.zpop) $('#zpop [data-act=panel-mode][aria-pressed=true], #zpop input')?.focus();
  else $('#zoompct')?.focus();
}

export function applyContrast(){
  document.body.classList.toggle('soft', readContrast() === 'soft');
}

// ---- zoom ----
const STEP = 1.25;
function zoomTo(z){
  const u = C.ui;
  u.zoom = Math.abs(z - 1) < 0.02 ? 1 : clampZoom(z);
  C.relayout();
  if (u.zoom === 1){ const box = $('#pages'); box.scrollLeft = 0; if (!u.layout?.stack) box.scrollTop = 0; }
  renderFoot();
}
const zoomBy = d => zoomTo((C.ui.zoom ?? 1) * (d > 0 ? STEP : 1 / STEP));

async function act(a, tg){
  switch (a){
    case 'zoom-in': zoomBy(1); return true;
    case 'zoom-out': zoomBy(-1); return true;
    case 'zoom-fit': zoomTo(1); return true;
    case 'zoom-pop': openPop(); return true;
    case 'panel-toggle': togglePanel(); return true;
    case 'panel-open': setPanel('open'); return true;
    case 'panel-mode': { openPopKeep(() => setPanel(tg.dataset.pm)); return true; }
    case 'rail-mode': { C.ui.panel !== 'open' && setPanel('open'); setMode(tg.dataset.m); return true; }
    case 'mode': setMode(tg.dataset.m); return true;
    case 'goto-page': C.goToPage(Number(tg.dataset.page)); return true;
  }
  return false;
}
function openPopKeep(fn){ fn(); renderPop(); }

function onKey(e){
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === 'e' || e.key === 'E'){ if (e.shiftKey) return false; e.preventDefault(); togglePanel(); return true; }
  if (e.key === '-' || e.key === '_'){ e.preventDefault(); zoomBy(-1); return true; }
  if (e.key === '=' || e.key === '+'){ e.preventDefault(); zoomBy(1); return true; }
  if (e.key === '0'){ e.preventDefault(); zoomTo(1); return true; }
  return false;
}
// the segments of the mode control are one tab stop; the arrows move between them
function onModesKey(e){
  const tab = e.target.closest?.('[role=tab][data-m]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const tabs = [...tab.parentElement.querySelectorAll('[role=tab]')];
  const at = tabs.indexOf(tab);
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault();
  tabs[to].focus();
  setMode(tabs[to].dataset.m);
  tabs.forEach((x, i) => { x.tabIndex = i === to ? 0 : -1; });
  $('#head [role=tab][aria-selected=true]')?.focus();
}

function bind(){
  installTips();
  const pop = document.createElement('div');
  pop.id = 'zpop'; pop.className = 'card zpop'; pop.hidden = true;
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', t('ux2.zoomSettings'));
  $('#col').append(pop);
  pop.addEventListener('input', e => {
    if (e.target.id === 'zw'){ const v = Number(e.target.value); set(ZOOMW_KEY, v); C.ui.zoomWrite = v; $('#zw-out').textContent = `${v}%`; }
  });
  pop.addEventListener('change', e => {
    if (e.target.id === 'contrast'){ set(CONTRAST_KEY, e.target.checked ? 'sharp' : 'soft'); applyContrast(); }
  });
  pop.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); openPop(false); } });
  document.addEventListener('mousedown', e => { if (C.ui.zpop && !e.target.closest('#zpop') && !e.target.closest('#zoompct')) openPop(false); });
  $('#head').addEventListener('keydown', onModesKey);
  applyContrast();
}

export function initDock(ctx){
  C = ctx;
  C.ui.panel = readPanel(); C.ui.zoom = 1; C.ui.zoomWrite = readZoomWrite(); C.ui.peek = false; C.ui.zpop = false;
  return {
    bind, act, onKey, sync, folded, shown, setPanel, togglePanel, setMode, modeOf, renderRail, renderFoot, zoomBy, zoomTo,
    closePop(){ if (!C.ui.zpop) return false; openPop(false); return true; },
    // Esc all the way out: the pin drops to Auto, the peek ends, the view zooms out to the whole resume
    allTheWayOut(){
      const was = C.ui.panel;
      C.ui.panel = afterEscape(was); set(PANEL_KEY, C.ui.panel);
      C.ui.peek = false;
      if ((C.ui.zoom ?? 1) !== 1) zoomTo(1);
      sync(true);
    },
  };
}
