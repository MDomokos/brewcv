// The editor column's furniture: the panel that folds to a 52px rail (Auto, Open, Closed), the rail, and
// the one line at the bottom with the zoom controls and a fill meter for every page. Hover hints too.
// The panel's own content is edit.js's; the shell calls sync() whenever something that decides whether
// the panel shows has changed (the selection, the view, the pin).

import { icon } from './icons.js';
import { t, h } from '../i18n/index.js';
import { FILL_BAND } from '../fit.js';
import { clampZoom, ZOOM_MIN, ZOOM_MAX, PHONE_MAX, DRAWER_MAX } from './layout.js';
import { drink, onDrinkChange, logoBtn } from './drink.js';
import { play } from './motion.js';

let C = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (s, r = document) => r.querySelector(s);

const PANEL_KEY = 'rb-panel', ZOOMW_KEY = 'rb-zoomwrite', CONTRAST_KEY = 'rb-contrast';
const ZOOMON_KEY = 'rb-zoomwrite-on', DIMJOB_KEY = 'rb-dim-job', DIMLINE_KEY = 'rb-dim-line', MAGNET_KEY = 'rb-magnet', BOUNCE_KEY = 'rb-bounce';
export const PANEL_MODES = ['auto', 'open', 'closed'];
export const ZOOM_WRITE = { min: 80, max: 220, step: 5, def: 130 };
const get = (k, ok, def) => { try { const v = localStorage.getItem(k); return ok(v) ? v : def; } catch { return def; } };
const set = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* this session only */ } };
export const readPanel = () => get(PANEL_KEY, v => PANEL_MODES.includes(v), 'auto');
export const readZoomWrite = () => { const n = Number(get(ZOOMW_KEY, v => v !== null && Number.isFinite(Number(v)), ZOOM_WRITE.def)); return Math.max(ZOOM_WRITE.min, Math.min(ZOOM_WRITE.max, n)); };
// how the page looks while you write (UX-3): the zoom can be turned off, and how far everything around the line is dimmed
export const DIM = { job: { min: 40, max: 100, def: 80 }, line: { min: 60, max: 100, def: 94 } };
const num = (key, lo, hi, def) => { const n = Number(get(key, v => v !== null && Number.isFinite(Number(v)), def)); return Math.max(lo, Math.min(hi, n)); };
// the writing zoom, remembered (a pinch while writing sets it)
export function storeZoomWrite(pct){ set(ZOOMW_KEY, Math.max(ZOOM_WRITE.min, Math.min(ZOOM_WRITE.max, Math.round(pct)))); }
export const readZoomWriteOn = () => get(ZOOMON_KEY, v => v === '0' || v === '1', '1') === '1';
export const readDimJob = () => num(DIMJOB_KEY, DIM.job.min, DIM.job.max, DIM.job.def);
export const readDimLine = () => num(DIMLINE_KEY, DIM.line.min, DIM.line.max, DIM.line.def);
// the travel between pages: how much the pages hold on (magnet) and how much they overshoot (bounce); to retune on a real trackpad
export const TRAVEL = { magnet: { min: 0, max: 80, def: 35 }, bounce: { min: 0, max: 40, def: 8 } };
export const readMagnet = () => num(MAGNET_KEY, TRAVEL.magnet.min, TRAVEL.magnet.max, TRAVEL.magnet.def);
export const readBounce = () => num(BOUNCE_KEY, TRAVEL.bounce.min, TRAVEL.bounce.max, TRAVEL.bounce.def);
export const readContrast = () => get(CONTRAST_KEY, v => v === 'sharp' || v === 'soft', 'sharp');

// the pure part of "does the panel show": checks/shell-check.mjs
export function panelShown({ pref = 'auto', selected = false, view = false, peek = false, snap = false, phone = false, writing = false } = {}){
  if (writing) return false;           // a drawer closes while you write: the line and its tools are what is on screen
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
  return panelShown({ pref: u.panel, selected: u.sel.kind !== 'none', view: !!u.view, peek: !!u.peek, snap: !!u.snap, phone: innerWidth < PHONE_MAX, writing: !!u.writing && innerWidth < DRAWER_MAX });
}
const folded = () => !shown();

function setPanel(pref, { peek = false } = {}){
  if (!PANEL_MODES.includes(pref)) return;
  C.ui.panel = pref; set(PANEL_KEY, pref);
  C.ui.peek = peek;
  sync(true);
}
const togglePanel = () => setPanel(shown() ? 'closed' : 'open');
// the mode segments and the rail's icons: Edit, Record, Design, Export
function setMode(m){
  const u = C.ui;
  u.peek = m === 'edit' && u.panel === 'auto';     // Edit with nothing selected stays open until Esc or the fold button
  if (m === 'edit'){ if (u.view) C.setView(null); }
  else C.setView(m);
  sync(true);
}
// Record widens the panel; the layout is laid again whenever that changes
const wide = () => C.ui.view === 'record' && !folded();
let lastWide = false;
function sync(force = false){
  const f = folded(), w = wide();
  if (force || f !== last || w !== lastWide){ last = f; lastWide = w; C.relayout(); }
  renderRail();
  renderFoot();
}
const modeOf = () => (['design', 'export', 'record'].includes(C.ui.view) ? C.ui.view : C.ui.view === 'sent' ? 'export' : C.ui.view ? null : 'edit');

// ---- hover hints: data-tip="Title|One line" ----
function installTips(){
  let tip = $('#tip'); if (!tip){ tip = document.createElement('div'); tip.id = 'tip'; tip.setAttribute('aria-hidden', 'true'); document.body.append(tip); }
  let timer = null, cur = null, at = null;      // at: where the pointer last was
  const hide = () => { clearTimeout(timer); tip.classList.remove('on'); cur = null; };
  const arm = el => {
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
  };
  // A tip is for a pointer that moved onto the element. A click that redraws the element under a still pointer makes the browser
  // send a pointerover from the same spot: that is not a move, so it waits for the next one.
  document.addEventListener('pointerover', e => {
    const el = e.target.closest?.('[data-tip]'); if (el === cur) return;
    if (el && at && e.clientX === at.x && e.clientY === at.y){ hide(); return; }
    arm(el);
  });
  document.addEventListener('pointermove', e => {
    const moved = !at || e.clientX !== at.x || e.clientY !== at.y;
    at = { x: e.clientX, y: e.clientY };
    if (moved && !cur) arm(e.target.closest?.('[data-tip]'));
  });
  document.addEventListener('pointerdown', e => { at = { x: e.clientX, y: e.clientY }; hide(); });
  document.addEventListener('wheel', hide, { passive: true });
  document.addEventListener('pointerout', e => { if (!e.relatedTarget || !e.relatedTarget.closest?.('[data-tip]')) hide(); });
}
// a button that is only an icon: its hint (title and one line) and its name
export const ib = (act, ic, name, tip, attrs = '', pos = 'b') =>
  `<button class="ib" data-act="${act}" ${attrs} data-tip="${esc(name)}|${esc(tip)}" data-tip-pos="${pos}" aria-label="${esc(name)}">${icon(ic)}</button>`;

// ---- the meters: one per page ----
// A page's fill says how it stands against Fit's band: ok (inside 88 to 96 percent), under or over (the last page only), or overflowing.
export const meterStatus = (p, last = true) => {
  const pct = 100 * p.used / p.usable;
  return p.overflow > 0 ? 'overflow' : last && pct > FILL_BAND[1] ? 'over' : last && pct < FILL_BAND[0] ? 'under' : 'ok';
};
// Would Fit change something? It is the one filled button on the screen when it would; Export's PDF is filled while it would not.
export const fitNeeded = fills => (fills ?? []).some((p, i, a) => meterStatus(p, i === a.length - 1) !== 'ok');
// ...and Fit is the filled one only if it can run (a resume with as many pages as needed has no Fit)
export const fitFilled = (fills, limit) => limit !== 0 && fitNeeded(fills);

// The steam moment: a page that has just reached the band steams for a few seconds, once, and at 91 to 93 percent (a perfect
// steep) the steam is a heart. Never a loop; the foot is redrawn often, so a redraw carries on from how long it has been going.
const STEAM_MS = 4400;
const steam = new Map();           // page index → { status, at, until, perfect }
let steamTimer = 0;
function noteSteam(ms){
  if (C.ui.previewing) return;      // a version under the pointer is not a page reaching the band
  const now = Date.now();
  for (const m of ms){
    const s = steam.get(m.i) ?? { status: null, at: 0, until: 0, perfect: false };
    if (m.status === 'ok' && s.status !== 'ok') Object.assign(s, { at: now, until: now + STEAM_MS, perfect: m.pct >= 91 && m.pct <= 93 });
    s.status = m.status; steam.set(m.i, s);
  }
  for (const k of [...steam.keys()]) if (k >= ms.length) steam.delete(k);
  const left = Math.max(0, ...[...steam.values()].map(s => s.until - now));
  clearTimeout(steamTimer);
  if (left > 0) steamTimer = setTimeout(() => { if (C) renderFoot(); }, left + 50);
}
const steamOf = i => { const s = steam.get(i), now = Date.now(); return s && s.until > now && s.status === 'ok' ? { on: true, perfect: s.perfect, el: now - s.at } : { on: false }; };

function meters(){
  const fills = C.ui.fills ?? [];
  const n = fills.length;
  const out = fills.map((p, i) => {
    const pct = 100 * p.used / p.usable;
    const status = meterStatus(p, i === n - 1);
    const tipText = p.overflow > 0 ? t('foot.overflowPage', { page: p.page }) : t('foot.pageFill', { page: p.page, pct: pct.toFixed(1) });
    return { i, pct, status, tipText, page: p.page };
  });
  noteSteam(out);
  return out;
}

// the cup (tea) or the shot glass (coffee) is filled to --p, 0 to 100; src/ui/drinks.css draws it
const level = pct => Math.max(0, Math.min(100, pct)).toFixed(1);
function railMeters(){
  return meters().map(m => {
    const sm = steamOf(m.i);
    return `<button class="rmeter ${m.status}${sm.on ? ' steam' : ''}${sm.on && sm.perfect ? ' perfect' : ''}" style="--p:${level(m.pct)}${sm.on ? `;--el:${sm.el}ms` : ''}" data-act="goto-page" data-page="${m.i}" aria-current="${C.ui.page === m.i}" data-tip="${esc(t('ux2.pageShort', { page: m.page }))}|${esc(m.tipText)}" data-tip-pos="l" aria-label="${esc(m.tipText)}"><span class="rmfill"></span>${sm.on ? '<span class="rsteam" aria-hidden="true"></span>' : ''}</button>`;
  }).join('');
}

// the rail and the bottom line are redrawn whenever a page is: the control that had the focus keeps it
const keyOf = el => (el?.id ? `#${el.id}` : el?.dataset?.act ? `[data-act="${el.dataset.act}"]${el.dataset.m ? `[data-m="${el.dataset.m}"]` : ''}${el.dataset.page ? `[data-page="${el.dataset.page}"]` : ''}` : null);
function keepFocus(root, draw){
  const ae = document.activeElement, k = ae && ae.closest?.(root) ? keyOf(ae) : null;
  draw();
  if (k){ const n = $(`${root} ${k}`); if (n && n !== document.activeElement) n.focus({ preventScroll: true }); }
}
// A page's meter fills (or empties) to its new level instead of jumping: Fit, a version under the pointer, a line switched on. The
// meters are drawn again with each change, so the level they were showing is read from the old ones (a half-way level too, when
// a new change arrives mid-fill) and eased to the new one. The level itself is already the new one; this only shows it.
function tween(draw){
  const was = new Map();
  for (const m of document.querySelectorAll('.meter, .rmeter')){ const v = parseFloat(getComputedStyle(m).getPropertyValue('--p')); if (Number.isFinite(v)) was.set(`${m.className.split(' ')[0]}:${m.dataset.page}`, v); }
  draw();
  if (!was.size) return;
  for (const m of document.querySelectorAll('.meter, .rmeter')){
    const k = `${m.className.split(' ')[0]}:${m.dataset.page}`, a = was.get(k), b = parseFloat(m.style.getPropertyValue('--p'));
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 0.3) play(m, [{ '--p': String(a) }, { '--p': String(b) }], { key: `meter:${k}`, ms: 'slow', kind: 'move', name: 'meter' });
  }
}
export const renderRail = () => keepFocus('#rail', () => tween(drawRail));
function drawRail(){
  const el = $('#rail');
  if (!el) return;
  const mode = modeOf();
  const tea = drink() === 'tea';
  const m = (id, ic, key) => `<button class="ib" data-act="rail-mode" data-m="${id}" aria-pressed="${mode === id}" data-tip="${esc(t(key))}|${esc(t('ux2.railOpen'))}" data-tip-pos="l" aria-label="${esc(t(key))}">${icon(ic)}</button>`;
  el.innerHTML = `${logoBtn(28, { base: 'logo railogo', pos: 'l' })}<hr>
    ${m('edit', tea ? 'leaf' : 'edit', 'ux2.modeEdit')}${m('record', 'record', 'ux3b.modeRecord')}${m('design', tea ? 'teapot' : 'design', 'ux2.modeDesign')}${m('export', tea ? 'cupserved' : 'export', 'ux2.modeExport')}<hr>
    <div class="rmeters" id="rmeters" role="group" aria-label="${esc(t('ux2.meters'))}">${railMeters()}</div>
    ${ib('panel-open', 'left', t('ux2.openPanel'), t('ux2.openPanelTip'), '', 'l')}`;
}

// ---- the zoom bar and the meters, on one line; Fit and undo under them ----
export const renderFoot = () => keepFocus('#foot', () => tween(drawFoot));
function drawFoot(){
  const el = $('#foot');
  if (!el) return;
  // on the start screen the footer area is "Yours to keep"
  if (document.body.classList.contains('is-intro')){ el.classList.remove('is-vertical'); el.innerHTML = C.startFoot(); return; }
  const u = C.ui, hs = C.store.history;
  const pct = Math.round((u.zoom ?? 1) * 100);
  const f = folded();
  const limit = C.shown()?.pageLimit;
  const ms = meters();
  const needed = fitFilled(u.fills, limit);
  el.classList.toggle('is-vertical', f);
  const tipPos = f ? 'l' : 't';
  const view = `<div class="vbar" role="toolbar" aria-label="${esc(t('ux2.viewBar'))}">
      ${ib('fullscreen', 'full', t('head.fullscreen'), t('ux2.fullTip'), '', tipPos)}
      ${ib('zoom-out', 'minus', t('ux2.zoomOut'), t('ux2.zoomOutTip'), u.zoom <= ZOOM_MIN + 1e-9 ? 'disabled' : '', tipPos)}
      <button class="pct" id="zoompct" data-act="zoom-pop" aria-haspopup="dialog" aria-expanded="${!!u.zpop}" data-tip="${esc(t('ux2.zoomSettings'))}|${esc(t('ux5a.zoomTip'))}" data-tip-pos="${tipPos}" aria-label="${esc(t('ux2.zoomSettings'))}">${pct}%</button>
      ${ib('zoom-in', 'plus', t('ux2.zoomIn'), t('ux2.zoomInTip'), u.zoom >= ZOOM_MAX - 1e-9 ? 'disabled' : '', tipPos)}
      ${ib('zoom-fit', 'fitpage', t('ux2.zoomFit'), t('ux2.zoomFitTip'), '', tipPos)}
    </div>`;
  const meterHtml = ms.map(m => {
    const sm = steamOf(m.i);
    return `<button class="meter ${m.status}${sm.on ? ' steam' : ''}${sm.on && sm.perfect ? ' perfect' : ''}" style="--p:${level(m.pct)}${sm.on ? `;--el:${sm.el}ms` : ''}" data-act="goto-page" data-page="${m.i}" aria-current="${u.page === m.i}" title="${esc(m.tipText + t('foot.band', { lo: FILL_BAND[0], hi: FILL_BAND[1] }))}"><span class="mlab">${esc(t('ux2.pageShort', { page: m.page }))}</span><span class="mbar" aria-hidden="true"><span class="mband"></span><span class="mfill"></span></span><span class="mpct">${m.pct.toFixed(0)}%</span></button>`;
  }).join('');
  const act = `<div class="factions">
      <button class="fit${needed ? ' primary' : ''}" data-act="fit" ${u.fitting || limit === 0 || u.snap ? 'disabled' : ''} title="${esc(limit === 0 ? t('foot.fitOff') : t('foot.fitTitle'))}">${u.fitting ? h('foot.fitting') : h('foot.fit')}</button>
      <span class="grow"></span>
      ${ib('undo', 'undo', t('foot.undo'), hs.next ? t('foot.undoWhat', { what: hs.next, n: hs.undo }) : t('foot.undoN', { n: hs.undo }), hs.undo ? '' : 'disabled', tipPos)}
      ${ib('redo', 'redo', t('foot.redo'), hs.nextRedo ? t('foot.redoWhat', { what: hs.nextRedo }) : t('foot.redo'), hs.redo ? '' : 'disabled', tipPos)}
    </div>`;
  el.innerHTML = f ? `${view}${act}` : `<div class="frow">${view}<div class="meters" id="meter" role="group" aria-label="${esc(t('ux2.meters'))}">${meterHtml || '<span class="muted tiny">—</span>'}</div></div>${act}`;
  if (f) { const rm = $('#rmeters'); if (rm) rm.innerHTML = railMeters(); }
  renderPop();
}

// ---- the zoom pop-up: Actual size ----
function renderPop(){
  const el = $('#zpop');
  if (!el) return;
  el.hidden = !C.ui.zpop;
  if (!C.ui.zpop){ el.innerHTML = ''; return; }
  el.innerHTML = `<div class="prow"><button class="sm" data-act="actual">${h('ux2.actualSize')}</button></div>`;
}

// ---- the page and panel settings, shown in Settings (settings.js) ----
// Their keys and read functions are above; this draws them and applies a change at once.
export function viewSettingsHtml(){
  const zw = readZoomWrite(), pref = C.ui.panel, soft = readContrast() === 'soft';
  const dial = (id, key, v, lo, hi, step = 1) => `<label class="dial"><span class="dl">${h(key)}</span><output id="${id}-out">${v}%</output><input type="range" id="${id}" min="${lo}" max="${hi}" step="${step}" value="${v}" aria-label="${esc(t(key))}"></label>`;
  const multi = (C.ui.fills?.length ?? 1) > 1;
  return `<label class="swl"><input type="checkbox" class="sw" id="zwon" ${readZoomWriteOn() ? 'checked' : ''}><span>${h('ux3.zoomWriteOn')}</span></label>
    <label class="dial"><span class="dl">${h('ux2.zoomWrite')}</span><output id="zw-out">${zw}%</output><input type="range" id="zw" min="${ZOOM_WRITE.min}" max="${ZOOM_WRITE.max}" step="${ZOOM_WRITE.step}" value="${zw}" aria-label="${esc(t('ux2.zoomWrite'))}"></label>
    ${dial('dimline', 'ux3.dimLine', readDimLine(), DIM.line.min, DIM.line.max)}${dial('dimjob', 'ux3.dimJob', readDimJob(), DIM.job.min, DIM.job.max)}
    ${multi ? dial('magnet', 'ux3.magnet', readMagnet(), TRAVEL.magnet.min, TRAVEL.magnet.max) + dial('bounce', 'ux3.bounce', readBounce(), TRAVEL.bounce.min, TRAVEL.bounce.max) : ''}
    <div class="prow"><span id="pm-l">${h('ux2.panelMode')}</span><div class="seg" role="group" aria-labelledby="pm-l">${PANEL_MODES.map(m => `<button data-act="panel-mode" data-pm="${m}" aria-pressed="${pref === m}">${h(`ux2.panel.${m}`)}</button>`).join('')}</div></div>
    <label class="swl"><input type="checkbox" class="sw" id="contrast" ${soft ? '' : 'checked'}><span>${h('ux2.sharper')}</span></label>
    <p class="note">${h('ux2.zoomNote')}</p>`;
}
// a slider moved (input) or a switch flipped (change) in Settings
export function viewSettingChanged(e){
  const el = e.target, v = Number(el.value), out = document.getElementById(`${el.id}-out`);
  if (e.type === 'input'){
    if (el.id === 'zw'){ set(ZOOMW_KEY, v); C.ui.zoomWrite = v; }
    else if (el.id === 'dimline'){ set(DIMLINE_KEY, v); C.layers?.(); }
    else if (el.id === 'dimjob'){ set(DIMJOB_KEY, v); C.layers?.(); }
    else if (el.id === 'magnet'){ set(MAGNET_KEY, v); C.canvas.set({ magnet: v }); }
    else if (el.id === 'bounce'){ set(BOUNCE_KEY, v); C.canvas.set({ bounce: v }); }
    if (out) out.textContent = `${v}%`;
  } else {
    if (el.id === 'contrast'){ set(CONTRAST_KEY, el.checked ? 'sharp' : 'soft'); applyContrast(); }
    if (el.id === 'zwon') set(ZOOMON_KEY, el.checked ? '1' : '0');
  }
}
function openPop(on){
  C.ui.zpop = on ?? !C.ui.zpop;
  renderFoot();
  if (C.ui.zpop) $('#zpop button')?.focus();
  else $('#zoompct')?.focus();
}

export function applyContrast(){
  document.body.classList.toggle('soft', readContrast() === 'soft');
  C?.restyleMarks?.();      // the page's edge is one of the marks the frame takes from the tokens
}

// ---- zoom ----
const STEP = 1.25;
function zoomTo(z){ C.canvas.zoomTo(z); renderFoot(); }
const zoomBy = d => { C.canvas.zoomBy(d > 0 ? STEP : 1 / STEP); renderFoot(); };

async function act(a, tg){
  switch (a){
    case 'zoom-in': zoomBy(1); return true;
    case 'zoom-out': zoomBy(-1); return true;
    case 'zoom-fit': zoomTo(1); return true;
    case 'zoom-pop': openPop(); return true;
    case 'panel-toggle': togglePanel(); return true;
    case 'panel-open': setPanel('open'); return true;
    case 'panel-mode': setPanel(tg.dataset.pm); C.renderAll(); return true;
    case 'rail-mode': { C.ui.panel !== 'open' && setPanel('open'); setMode(tg.dataset.m); return true; }
    case 'mode': setMode(tg.dataset.m); return true;
    case 'goto-page': C.goToPage(Number(tg.dataset.page)); return true;
  }
  return false;
}

function onKey(e){
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === 'e' || e.key === 'E'){ if (e.shiftKey) return false; e.preventDefault(); togglePanel(); return true; }
  if (e.key === 'r' || e.key === 'R'){ if (e.shiftKey || C.ui.snap) return false; e.preventDefault(); setMode('record'); return true; }
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
  onDrinkChange(() => { renderRail(); renderFoot(); });
  const pop = document.createElement('div');
  pop.id = 'zpop'; pop.className = 'card zpop'; pop.hidden = true;
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', t('ux2.zoomSettings'));
  $('#col').append(pop);
  pop.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); openPop(false); } });
  document.addEventListener('mousedown', e => { if (C.ui.zpop && !e.target.closest('#zpop') && !e.target.closest('#zoompct')) openPop(false); });
  $('#head').addEventListener('keydown', onModesKey);
  applyContrast();
}

export function initDock(ctx){
  C = ctx;
  C.ui.panel = readPanel(); C.ui.zoom = 1; C.ui.zoomWrite = readZoomWrite(); C.ui.peek = false; C.ui.zpop = false;
  return {
    bind, act, onKey, sync, folded, shown, wide, setPanel, togglePanel, setMode, modeOf, renderRail, renderFoot, zoomBy, zoomTo,
    closePop(){ if (!C.ui.zpop) return false; openPop(false); return true; },
    // Esc all the way out: the pin drops to Auto, the peek ends, the view zooms out to the whole resume
    allTheWayOut(){
      const was = C.ui.panel;
      C.ui.panel = afterEscape(was); set(PANEL_KEY, C.ui.panel);
      C.ui.peek = false;
      C.canvas.reset();
      sync(true);
    },
  };
}
