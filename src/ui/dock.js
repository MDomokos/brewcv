// The editor's furniture around the page: the page bars (one thin vertical bar for each page, in the rail beside undo and redo), Fit (in the name card), the zoom bar that shows while the pointer is
// over the page (with Actual size), the hints, and the rail's keys. On a phone the column is the bottom sheet and keeps its two-row head
// and its foot with the zoom bar. The sidebar's content is edit.js's, checklist.js's and the other sheets'; the shell calls renderFoot()
// whenever something that decides which sheet is open has changed.

import { icon } from './icons.js';
import { t, h } from '../i18n/index.js';
import { FILL_BAND } from '../fit.js';
import { ZOOM_MIN, ZOOM_MAX, PHONE_MAX } from './layout.js';
import { onDrinkChange } from './drink.js';
import { play } from './motion.js';

let C = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (s, r = document) => r.querySelector(s);

const ZOOMW_KEY = 'rb-zoomwrite', CONTRAST_KEY = 'rb-contrast';
const ZOOMON_KEY = 'rb-zoomwrite-on', DIMJOB_KEY = 'rb-dim-job', DIMLINE_KEY = 'rb-dim-line', MAGNET_KEY = 'rb-magnet', BOUNCE_KEY = 'rb-bounce';
export const ZOOM_WRITE = { min: 80, max: 180, step: 5, def: 130 };
const get = (k, ok, def) => { try { const v = localStorage.getItem(k); return ok(v) ? v : def; } catch { return def; } };
const set = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* this session only */ } };
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

// ---- the sheets ----
// Edit, Design and Export are the rail's tabs, beside the editor card, in the editor place only; Career is a place of its own (the place
// tabs, and R). On a phone the head has its own tabs, Career among them. Edit is whatever is selected, so it has no tab of its own for the Outline.
const phone = () => innerWidth < PHONE_MAX;
const tabOf = () => { const v = C.ui.view; return v === 'design' ? 'design' : v === 'export' || v === 'sent' ? 'export' : v === 'record' ? 'record' : v ? null : 'edit'; };
// the sidebar's tea: the open sheet's (the Outline is Edit with nothing selected)
const teaOf = () => (phone() ? '' : tabOf() === 'edit' ? (C.ui.sel.kind === 'none' ? 'outline' : 'edit') : tabOf() ?? 'edit');
const TEA_ON = ['body', 'rtabs'];      // the editor card and the tabs that touch it wear the open sheet's tea
// a tab: Edit leaves the view that replaces it; the others open one. A line being written is left first (asking, if there is a draft).
async function setMode(m){
  if (C.ui.writing && !(await C.leaveWriting())) return;
  C.ui.focusKept = false;
  if (m !== 'edit') C.setView(m); else if (C.ui.view) C.setView(null);
  if (!C.ui.focusKept) $(`#tab-${m}`)?.focus({ preventScroll: true });
}
const modeOf = tabOf;

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
  // a keyboard gets the same hints: on focus, and Esc takes one away
  document.addEventListener('focusin', e => { const el = e.target.closest?.('[data-tip]'); if (el && e.target.matches?.(':focus-visible')) arm(el); });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
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

// the controls keep the focus when they are drawn again
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
  for (const m of document.querySelectorAll('.meter')){ const v = parseFloat(getComputedStyle(m).getPropertyValue('--p')); if (Number.isFinite(v)) was.set(`${m.className.split(' ')[0]}:${m.dataset.page}`, v); }
  draw();
  if (!was.size) return;
  for (const m of document.querySelectorAll('.meter')){
    const k = `${m.className.split(' ')[0]}:${m.dataset.page}`, a = was.get(k), b = parseFloat(m.style.getPropertyValue('--p'));
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 0.3) play(m, [{ '--p': String(a) }, { '--p': String(b) }], { key: `meter:${k}`, ms: 'slow', kind: 'move', name: 'meter' });
  }
}

// ---- Fit (at the top of Export, and the phone's foot); the page bars (Export's, beside Fit; a phone's foot has the cups); the zoom bar over the page ----
const fitBtn = (u, limit, needed) => {
  const away = phone() && ['record', 'resumes', 'compare'].includes(u.view);      // a phone's screen covers the page Fit would work on: held, with the reason (a desktop's Fit is Export's)
  const why = esc(t('ux6c.fitAway'));
  return `<button class="fit sm${needed ? ' primary' : ''}" data-act="fit" ${u.fitting || limit === 0 || u.snap ? 'disabled' : ''}${away ? ` aria-disabled="true" aria-description="${why}"` : ''} title="${away ? why : esc(limit === 0 ? t('foot.fitOff') : t('foot.fitTitle'))}">${u.fitting ? h('foot.fitting') : h('foot.fit')}</button>`;
};
const STATE_WORD = { under: 'ux6b.fillUnder', ok: 'ux6b.fillIn', over: 'ux6b.fillOver', overflow: 'ux6b.fillOver' };
// A desktop draws at most this many bars; more pages end in a "+n" that goes to the first page not drawn.
const MAX_BARS = 3;
function meterHtml(){
  const u = C.ui, thin = !phone();
  const all = meters(), shown = thin ? all.slice(0, MAX_BARS) : all, more = all.length - shown.length;
  const rows = shown.map(m => {
    const sm = steamOf(m.i);
    const tip = m.tipText + t('foot.band', { lo: FILL_BAND[0], hi: FILL_BAND[1] });
    const cls = `meter ${m.status}${thin ? ' thin' : ''}${sm.on ? ' steam' : ''}${sm.on && sm.perfect ? ' perfect' : ''}`, style = `--p:${level(m.pct)}${sm.on ? `;--el:${sm.el}ms` : ''}`;
    const bar = '<span class="mbar" aria-hidden="true"><span class="mband"></span><span class="mfill"></span></span>';
    // a desktop's bar is only the bar: the page, the exact fill and the state are its tip and its name
    if (thin) return `<button class="${cls}" style="${style}" data-act="goto-page" data-page="${m.i}" aria-current="${u.page === m.i}" data-tip="${esc(tip)}|${esc(t(STATE_WORD[m.status]))}" data-tip-pos="l" aria-label="${esc(`${tip}: ${t(STATE_WORD[m.status])}`)}">${bar}</button>`;
    return `<button class="${cls}" style="${style}" data-act="goto-page" data-page="${m.i}" aria-current="${u.page === m.i}" title="${esc(tip)}"><span class="mlab">${esc(t('ux2.pageShort', { page: m.page }))}</span>${bar}<span class="mpct">${m.pct.toFixed(0)}%</span></button>`;
  }).join('') + (more > 0 ? `<button class="rmore ${all.slice(MAX_BARS).some(m => m.status === 'overflow') ? 'overflow' : ''}" data-act="goto-page" data-page="${MAX_BARS}" aria-label="${esc(t('ux6c.morePages', { n: more }))}" data-tip="${esc(t('ux6c.morePages', { n: more }))}|" data-tip-pos="l">+${more}</button>` : '');
  return `<div class="meters${thin ? ' rbars' : ''}" id="meter" role="group" aria-label="${esc(t('ux2.meters'))}">${rows || '<span class="muted tiny">—</span>'}</div>`;
}
// Fit: the compact button at the top of Export
const fitHtml = () => { const u = C.ui, limit = C.shown()?.pageLimit; return fitBtn(u, limit, fitFilled(u.fills, limit)); };
// the rail's page bars, drawn in the rail by the shell (the bars it already has stay, so their fill eases)
const viewBar = (u, tipPos) => `<div class="vbar" role="toolbar" aria-label="${esc(t('ux2.viewBar'))}">
      ${ib('fullscreen', 'full', t('head.fullscreen'), t('ux2.fullTip'), '', tipPos)}
      ${ib('zoom-out', 'minus', t('ux2.zoomOut'), t('ux2.zoomOutTip'), u.zoom <= ZOOM_MIN + 1e-9 ? 'disabled' : '', tipPos)}
      <span class="pct" id="zoompct">${Math.round((u.zoom ?? 1) * 100)}%</span>
      ${ib('zoom-in', 'plus', t('ux2.zoomIn'), t('ux2.zoomInTip'), u.zoom >= ZOOM_MAX - 1e-9 ? 'disabled' : '', tipPos)}
      ${ib('zoom-fit', 'fitpage', t('ux2.zoomFit'), t('ux2.zoomFitTip'), '', tipPos)}
      <button class="sm" data-act="actual">${h('ux2.actualSize')}</button>
    </div>`;

export const renderFoot = () => {
  const tea = teaOf();
  for (const id of TEA_ON){ const e = document.getElementById(id); if (e) e.dataset.tea = tea; }
  keepFocus('#head', () => keepFocus('#rail', () => keepFocus('#body', () => keepFocus('#foot', () => tween(drawFoot)))));
  if (!phone() && !document.body.classList.contains('is-intro')) keepFocus('#zoombar', () => tween(drawZoombar));
};
function drawZoombar(){
  const el = $('#zoombar');
  if (el) el.innerHTML = viewBar(C.ui, 't');
}

// ---- the foot: a desktop has none (Fit is in the name card, the page bars in the rail); on a phone the zoom bar and the cups on one line, Fit
// and undo under them; on the start screen the footer area is "Yours to keep" ----
function drawFoot(){
  const el = $('#foot');
  if (!el) return;
  if (document.body.classList.contains('is-intro')){ el.innerHTML = C.startFoot(); return; }
  const u = C.ui, hs = C.store.history;
  if (!phone()){
    el.textContent = '';
    const fit = $('.fitslot'), bars = $('#meter');
    if (fit) fit.innerHTML = fitHtml();
    if (bars) bars.outerHTML = meterHtml();
    return;
  }
  const limit = C.shown()?.pageLimit;
  const needed = fitFilled(u.fills, limit);
  const act = `<div class="factions">
      ${fitBtn(u, limit, needed)}
      <span class="grow"></span>
      ${ib('undo', 'undo', t('foot.undo'), hs.next ? t('foot.undoWhat', { what: hs.next, n: hs.undo }) : t('foot.undoN', { n: hs.undo }), hs.undo ? '' : 'disabled', 't')}
      ${ib('redo', 'redo', t('foot.redo'), hs.nextRedo ? t('foot.redoWhat', { what: hs.nextRedo }) : t('foot.redo'), hs.redo ? '' : 'disabled', 't')}
    </div>`;
  el.innerHTML = `<div class="frow">${viewBar(u, 't')}${meterHtml()}</div>${act}`;
}

// ---- the zoom bar shows while the pointer is over a sheet (the white page, not the mat) or the bar ----
// It fades out 0.4 s after the pointer leaves, and flashes for 1.2 s when the keys zoom. The bar is in the page area, at its foot.
const BAR_OUT_MS = 400, BAR_FLASH_MS = 1200;
let barOver = 0, sheetOn = false, barT = 0, flashT = 0;
function bar(){ return $('#zoombar'); }
function showBar(on){
  clearTimeout(barT);
  if (on){ bar()?.classList.add('on'); return; }
  barT = setTimeout(() => { if (!barOver && !sheetOn && !bar()?.matches(':focus-within') && !flashT) bar()?.classList.remove('on'); }, BAR_OUT_MS);
}
function sheetOver(on){
  if (on === sheetOn) return;
  sheetOn = on;
  showBar(on || !!barOver);
}
function flashBar(){
  bar()?.classList.add('on');
  clearTimeout(flashT);
  flashT = setTimeout(() => { flashT = 0; if (!barOver && !sheetOn) showBar(false); }, BAR_FLASH_MS);
}

// ---- the page and panel settings, shown in Settings (settings.js) ----
// Their keys and read functions are above; this draws them and applies a change at once.
export function viewSettingsHtml(){
  const zw = readZoomWrite(), soft = readContrast() === 'soft';
  const dial = (id, key, v, lo, hi, step = 1) => `<label class="dial"><span class="dl">${h(key)}</span><output id="${id}-out">${v}%</output><input type="range" id="${id}" min="${lo}" max="${hi}" step="${step}" value="${v}" aria-label="${esc(t(key))}"></label>`;
  const multi = (C.ui.fills?.length ?? 1) > 1;
  return `<label class="swl"><input type="checkbox" class="sw" id="zwon" ${readZoomWriteOn() ? 'checked' : ''}><span>${h('ux3.zoomWriteOn')}</span></label>
    <label class="dial"><span class="dl">${h('ux2.zoomWrite')}</span><output id="zw-out">${zw}%</output><input type="range" id="zw" min="${ZOOM_WRITE.min}" max="${ZOOM_WRITE.max}" step="${ZOOM_WRITE.step}" value="${zw}" aria-label="${esc(t('ux2.zoomWrite'))}"></label>
    ${dial('dimline', 'ux3.dimLine', readDimLine(), DIM.line.min, DIM.line.max)}${dial('dimjob', 'ux3.dimJob', readDimJob(), DIM.job.min, DIM.job.max)}
    ${multi ? dial('magnet', 'ux3.magnet', readMagnet(), TRAVEL.magnet.min, TRAVEL.magnet.max) + dial('bounce', 'ux3.bounce', readBounce(), TRAVEL.bounce.min, TRAVEL.bounce.max) : ''}
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
    case 'mode': setMode(tg.dataset.m); return true;
    case 'goto-page': C.goToPage(Number(tg.dataset.page)); return true;
  }
  return false;
}

function onKey(e){
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === '-' || e.key === '_'){ e.preventDefault(); zoomBy(-1); flashBar(); return true; }
  if (e.key === '=' || e.key === '+'){ e.preventDefault(); zoomBy(1); flashBar(); return true; }
  if (e.key === '0'){ e.preventDefault(); zoomTo(1); flashBar(); return true; }
  return false;
}
// The tabs (the rail's, up and down; a phone's, in its head, left and right) are one tab stop: the arrows move between them and open each
function onModesKey(e){
  const tab = e.target.closest?.('[role=tab][data-m]');
  if (!tab) return;
  const vertical = tab.parentElement.getAttribute('aria-orientation') === 'vertical', [back, fwd] = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
  if (![back, fwd, 'Home', 'End'].includes(e.key)) return;
  const tabs = [...tab.parentElement.querySelectorAll('[role=tab]:not(:disabled)')];
  const at = tabs.indexOf(tab);
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (at + (e.key === fwd ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault(); e.stopPropagation();      // the tab is drawn again below: the page's own arrow keys must not take this key for theirs
  tabs[to].focus();
  setMode(tabs[to].dataset.m);
  tabs.forEach((x, i) => { x.tabIndex = i === to ? 0 : -1; });
  $('#col [role=tab][aria-selected=true]')?.focus();
}

function bind(){
  installTips();
  onDrinkChange(renderFoot);
  const bar = document.createElement('div');
  bar.id = 'zoombar'; bar.className = 'zoombar';
  bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', t('ux2.viewBar'));
  document.body.append(bar);
  // over a sheet (canvas.js tells us), or the bar itself, or a key inside it, the bar shows
  bar.addEventListener('pointerenter', () => { barOver = 1; showBar(true); });
  bar.addEventListener('pointerleave', () => { barOver = 0; showBar(sheetOn); });
  bar.addEventListener('focusin', () => showBar(true));
  bar.addEventListener('focusout', () => showBar(false));
  $('#col').addEventListener('keydown', onModesKey);
  applyContrast();
}

export function initDock(ctx){
  C = ctx;
  C.ui.zoom = 1; C.ui.zoomWrite = readZoomWrite();
  return {
    bind, act, onKey, sheetOver, setMode, modeOf, teaNow: teaOf, renderFoot, fitHtml, barsHtml: meterHtml, zoomBy, zoomTo,
    // Esc all the way out: the view zooms out to the whole resume
    allTheWayOut(){ C.canvas.reset(); },
  };
}
