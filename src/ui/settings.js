// Settings.
// The interface language is a per-browser setting in localStorage['rb-ui'], never in the
// record, a resume, a backup or undo. With storage blocked: English, following the resume,
// this session only. "follow" uses the language you're working in; "fixed" always one.

import { LANGS } from '../model/schema.js';
import { langName, langsInUse, setLangsInUse } from '../model/lang.js';
import { t, h, errText, MACHINE, UI_LANGS } from '../i18n/index.js';
import { DRINKS, THEMES, drink, themePref, setDrink, setThemePref } from './drink.js';
import { readReduce, setReduce } from './motion.js';
import { viewSettingsHtml, viewSettingChanged } from './dock.js';
import { groupHtml, sw } from './parts.js';

let C = null;
export function initSettings(ctx){ C = ctx; return api; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'rb-ui';

export function readPref(){
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v && ['follow', 'fixed'].includes(v.mode) && (v.mode === 'follow' || UI_LANGS.includes(v.lang))) return v;
  } catch { /* blocked or garbled: no preference */ }
  return null;
}
export function writePref(p){ try { localStorage.setItem(KEY, JSON.stringify(p)); return true; } catch { return false; } }
export function clearPref(){ try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ } }

export function browserLang(){
  for (const l of (globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? 'en'])){
    const code = String(l).slice(0, 2).toLowerCase();
    if (LANGS.includes(code)) return code;
  }
  return 'en';
}

// "Garden while you rest" (tea only): on unless it was switched off; per browser, like the other settings.
const GARDEN_KEY = 'rb-garden';
export const readGarden = () => { try { return localStorage.getItem(GARDEN_KEY) !== 'off'; } catch { return true; } };
const writeGarden = on => { try { localStorage.setItem(GARDEN_KEY, on ? 'on' : 'off'); } catch { /* this session only */ } };

// At least one language stays ticked.
export function langChecks(ticked, { id = 'langs' } = {}){
  return `<div class="langs-pick" role="group" aria-label="${esc(t('set.langsUse'))}" id="${id}">${LANGS.map(l => {
    const on = ticked.includes(l), last = on && ticked.length === 1;
    return `<label class="${on ? 'on' : ''}" lang="${l}"><input type="checkbox" class="cb press" data-tier="tertiary" data-langtick="${l}" ${on ? 'checked' : ''} ${last ? 'disabled' : ''}>${esc(langName(l))}</label>`;
  }).join('')}</div>`;
}
export function uiChoice(pref, offer, { name = 'ui' } = {}){
  const fixed = pref.mode === 'fixed';
  const opts = [...new Set(['en', ...offer])].filter(l => UI_LANGS.includes(l));
  return `<div class="uichoice" role="radiogroup" aria-label="${esc(t('set.uiHead'))}">
    <label class="opt"><input type="radio" name="${name}" value="follow" data-uimode="follow" ${fixed ? '' : 'checked'}><span class="opt-t">${h('ux3b.uiFollow')}</span></label>
    <label class="opt"><input type="radio" name="${name}" value="fixed" data-uimode="fixed" ${fixed ? 'checked' : ''}> ${h('set.uiFixed')}
      <select data-uilang aria-label="${esc(t('set.uiFixedLang'))}">${opts.map(l => `<option value="${l}" ${(fixed ? pref.lang : 'en') === l ? 'selected' : ''}>${esc(langName(l))}${MACHINE.has(l) ? ` ${esc(t('set.machine'))}` : ''}</option>`).join('')}</select></label>
  </div>`;
}

function settingsView(){
  const rec = C.store.state.record;
  const inUse = langsInUse(rec);
  const pref = C.ui.pref;
  loadVersion();
  const browser = t('uxs.thisBrowser');
  // grouped by what each acts on, this browser first, then the career
  return `<h2 class="title">${h('set.title')}</h2>
    ${groupHtml(t('uxs.look'), `<div class="kv">
    <span class="lbl">${h('m11.setDrinkHead')}</span>
    <div class="seg fill rseg" role="radiogroup" aria-label="${esc(t('m11.setDrinkHead'))}">
      ${DRINKS.map(d => `<label title="${esc(t(`m11.${d}Hint`))}"><input type="radio" name="drink" data-drink="${d}" ${drink() === d ? 'checked' : ''}><span>${h(`m11.${d}`)}</span></label>`).join('')}
    </div>
    <span class="lbl">${h('m11.setThemeHead')}</span>
    <div class="seg fill rseg" role="radiogroup" aria-label="${esc(t('m11.setThemeHead'))}" title="${esc(t('m11.themeNote'))}">
      ${THEMES.map(m => `<label><input type="radio" name="theme" data-theme="${m}" ${themePref() === m ? 'checked' : ''}><span>${h(`m11.theme${m[0].toUpperCase()}${m.slice(1)}`)}</span></label>`).join('')}
    </div>
    <p class="note">${h('m11.setDrinkNote')}</p></div>
    <div title="${esc(t('ux4.reduceMotionNote'))}">${sw('data-reduce-motion', readReduce(), h('ux4.reduceMotion'))}</div>
    <div title="${esc(t('m11b.gardenNote'))}">${sw('data-garden', readGarden(), h('m11b.garden'))}</div>`, browser)}
    ${groupHtml(t('set.uiHead'), `${uiChoice(pref, inUse)}
    <p class="note">${h('set.machineNote')}</p>`, browser)}
    ${groupHtml(t('ux5a.viewHead'), viewSettingsHtml(), browser)}
    ${C.persist.folder?.space ? groupHtml(t('i8.folder'), folderHtml(), C.persist.status.linked) : ''}
    ${groupHtml(t('set.langsUse'), `<p class="small muted">${h('set.langsUseNote')}</p>
    ${langChecks(inUse)}
    <p class="note">${h('set.untickNote')}</p>`, t('uxs.everyResume'))}
    ${groupHtml(t('uxs.about'), `<span class="lbl">${h('set.startHead')}</span>
    <div class="btns"><button class="sm" data-act="set-ask-again">${h('set.askAgain')}</button></div>
    <p class="note">${h('set.thisBrowser')}</p>
    <span class="lbl">${h('set.versionHead')}</span>
    <p class="small" data-appversion>${esc(appVersion ?? '…')}</p>
    <p class="note">${h('set.versionNote')}</p>`)}`;
}

// ---- the linked folder: what was found in it, Organise, and the devices that write to it ----
// A name from the folder (a device, a file) is only ever written through esc().
const P = { plan: null, result: null, undo: false };
const time = iso => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
function folderHtml(){
  const last = C.space.last, found = last?.fresh ?? [], devs = C.space.devices();
  const row = d => `<li class="mrow"><span>${esc(d.name)}</span> <span class="muted small">${esc(d.mine ? t('i8.deviceThis') : d.state === 'waiting' ? t('i8.deviceWaiting') : d.state === 'other' ? t('i8.deviceOther') : t('i8.deviceSeen', { time: time(d.saved) }))}</span>${d.state === 'merged' ? ` <button class="sm ghost" data-act="folder-forget" data-p="${esc(d.path)}">${h('i8.forget')}</button>` : ''}</li>`;
  return `<p class="small">${h('i8.folderNote', { name: C.persist.status.linked })}</p>
    <label class="field"><span class="lbl">${h('i8b.docs')}</span><input data-docs autocomplete="off" maxlength="120" value="${esc(last?.docs ?? 'Documents')}"></label>
    <p class="note">${h('i8b.docsNote')}</p>
    <div class="btns"><button class="sm" data-act="folder-rescan">${h('i8.rescan')}</button></div>
    ${found.length ? `<p class="small">${h('i8.found', { n: found.length })}</p>
      <div class="btns"><button class="sm" data-act="folder-read">${h('i8.readFound')}</button><button class="sm" data-act="folder-organise">${h('i8.organise')}</button></div>` : ''}
    ${P.plan ? `<div class="dpanel"><p class="note">${h('i8.organiseNote')}</p>
      <ul class="mlist">${P.plan.map(m => `<li class="mrow"><span>${esc(m.from)}</span> <span class="muted">→</span> <span>${esc(m.to)}</span></li>`).join('')}</ul>
      <div class="btns"><button class="primary sm" data-act="folder-organise-ok">${h('i8.organiseOk', { n: P.plan.length })}</button><button class="sm ghost" data-act="folder-organise-no">${h('btn.cancel')}</button></div></div>` : ''}
    ${P.result ? `<p class="small" role="status">${esc(P.result)} ${P.undo ? `<button class="sm ghost" data-act="folder-organise-undo">${h('i8.organiseUndo')}</button>` : ''}</p>` : ''}
    <span class="lbl">${h('i8.devices')}</span>
    <ul class="mlist">${devs.map(row).join('')}</ul>
    ${devs.length < 2 ? `<p class="note">${h('i8.noOthers')}</p>` : ''}`;
}

// The app's version is the service worker's VERSION: one place, stamped with the commit on deploy.
let appVersion = null;
async function loadVersion(){
  if (appVersion) return;
  try {
    const res = await fetch('sw.js');
    appVersion = (await res.text()).match(/const VERSION = '([^']+)'/)?.[1] ?? null;
  } catch { /* offline and not cached: show a dash */ }
  if (!appVersion) appVersion = '—';
  for (const el of document.querySelectorAll('[data-appversion]')) el.textContent = appVersion;
}

function setUiPref(pref){
  C.ui.pref = pref;
  if (!writePref(pref)) C.ui.prefVolatile = true;
  C.syncUi(true);
}
async function act(a, tg){
  switch (a){
    case 'set-ask-again': clearPref(); C.toast(t('toast.askAgain')); return true;
    case 'folder-rescan': await C.space.sync(); P.result = null; C.renderBody(); return true;
    case 'folder-read': C.files.openFiles(await C.space.load(C.space.last.fresh.map(f => f.path))); return true;
    case 'folder-organise': P.plan = await C.space.plan(); P.result = null; C.renderBody(); return true;
    case 'folder-organise-no': P.plan = null; C.renderBody(); return true;
    case 'folder-organise-ok': {
      const res = await C.space.organise(P.plan);
      P.plan = null;
      P.result = res.failed ? t('i8.organiseStopped', { n: res.done.length, file: res.failed.from }) : t('i8.organiseDone', { n: res.done.length });
      P.undo = res.done.length > 0;
      await C.space.sync(); C.renderBody();
      return true;
    }
    case 'folder-organise-undo': await C.space.undoOrganise(); P.undo = false; P.result = null; await C.space.sync(); C.renderBody(); return true;
    case 'folder-forget': await C.space.forget(tg.dataset.p); await C.space.sync(); C.renderBody(); return true;
  }
  return false;
}

function bind(body){
  body.addEventListener('input', e => { if (e.target.closest?.('[data-mode=settings]') && e.target.type === 'range') viewSettingChanged(e); });
  body.addEventListener('change', e => {
    const el = e.target;
    if (!el.closest?.('[data-mode=settings]')) return;
    if (el.id === 'zwon' || el.id === 'contrast'){ viewSettingChanged(e); return; }
    if (el.dataset.langtick){
      const l = el.dataset.langtick, on = el.checked;
      const now = langsInUse(C.store.state.record);
      const next = on ? [...now, l] : now.filter(x => x !== l);
      try {
        C.store.commit(d => { setLangsInUse(d.record, next); }, on ? t('undo.addLanguage', { lang: langName(l) }) : t('undo.hideLanguage', { lang: langName(l) }));
        if (!on) C.toast(t('toast.langHidden', { lang: langName(l) }));
      } catch (err){ C.toast(errText(err), 'warn'); }
      C.renderBody();
      return;
    }
    if (el.dataset.uimode){ const sel = body.querySelector('[data-uilang]'); setUiPref(el.dataset.uimode === 'fixed' ? { mode: 'fixed', lang: sel?.value ?? 'en' } : { mode: 'follow' }); C.renderBody(); return; }
    if (el.dataset.uilang !== undefined){ setUiPref({ mode: 'fixed', lang: el.value }); C.renderBody(); return; }
    if (el.dataset.docs !== undefined){ C.space.setDocs(el.value).then(ok => { if (!ok) C.toast(t('i8b.docsBad'), 'warn'); return C.space.sync(); }).then(() => C.renderBody()); return; }
    if (el.dataset.reduceMotion !== undefined){ setReduce(el.checked); C.syncGarden(); return; }
    if (el.dataset.garden !== undefined){ writeGarden(el.checked); C.syncGarden(); return; }
    if (el.dataset.drink){ setDrink(el.dataset.drink); return; }
    if (el.dataset.theme){ setThemePref(el.dataset.theme); return; }
  });
}

const api = {
  views: { settings: () => settingsView() },
  act, bind,
  // the version for the "?" corner (shell.js), the same line as About this copy's
  versionHtml: () => { loadVersion(); return `<span data-appversion>${esc(appVersion ?? '…')}</span>`; },
};
