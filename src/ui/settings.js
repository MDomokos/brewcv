// Settings.
// The interface language is a per-browser setting in localStorage['rb-ui'], never in the
// record, a resume, a backup or undo. With storage blocked: English, following the resume,
// this session only. "follow" uses the language you're working in; "fixed" always one.

import { LANGS } from '../model/schema.js';
import { langName, langsInUse, setLangsInUse } from '../model/lang.js';
import { t, h, errText, MACHINE, UI_LANGS } from '../i18n/index.js';

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

// At least one language stays ticked.
export function langChecks(ticked, { id = 'langs' } = {}){
  return `<div class="langs-pick" role="group" aria-label="${esc(t('set.langsUse'))}" id="${id}">${LANGS.map(l => {
    const on = ticked.includes(l), last = on && ticked.length === 1;
    return `<label class="${on ? 'on' : ''}" lang="${l}"><input type="checkbox" data-langtick="${l}" ${on ? 'checked' : ''} ${last ? 'disabled' : ''}>${esc(langName(l))}</label>`;
  }).join('')}</div>`;
}
export function uiChoice(pref, offer, { name = 'ui' } = {}){
  const fixed = pref.mode === 'fixed';
  const opts = [...new Set(['en', ...offer])].filter(l => UI_LANGS.includes(l));
  return `<div class="uichoice" role="radiogroup" aria-label="${esc(t('set.uiHead'))}">
    <label class="opt"><input type="radio" name="${name}" value="follow" data-uimode="follow" ${fixed ? '' : 'checked'}><span class="opt-t">${h('set.uiFollow')}</span></label>
    <label class="opt"><input type="radio" name="${name}" value="fixed" data-uimode="fixed" ${fixed ? 'checked' : ''}> ${h('set.uiFixed')}
      <select data-uilang aria-label="${esc(t('set.uiFixedLang'))}">${opts.map(l => `<option value="${l}" ${(fixed ? pref.lang : 'en') === l ? 'selected' : ''}>${esc(langName(l))}${MACHINE.has(l) ? ` ${esc(t('set.machine'))}` : ''}</option>`).join('')}</select></label>
  </div>`;
}

function settingsView(){
  const rec = C.store.state.record;
  const inUse = langsInUse(rec);
  const pref = C.ui.pref;
  const pages = C.ui.mode;
  loadVersion();
  const langs = `<span class="lbl">${h('set.langsUse')}</span>
    <p class="small muted">${h('set.langsUseNote')}</p>
    ${langChecks(inUse)}
    <p class="note">${h('set.untickNote')}</p>`;
  return `<h2 class="title">${h('set.title')}</h2>
    ${langs}
    <span class="lbl">${h('set.uiHead')}</span>${uiChoice(pref, inUse)}
    <p class="note">${h('set.machineNote')}</p>
    <span class="lbl">${h('set.pagesHead')}</span>
    <div class="uichoice" role="radiogroup" aria-label="${esc(t('set.pagesHead'))}">
      ${[['auto', 'set.pagesAuto'], ['spread', 'set.pagesSpread'], ['stack', 'set.pagesStack']].map(([m, k]) => `<label class="opt"><input type="radio" name="pages" data-pagesmode="${m}" ${pages === m ? 'checked' : ''}><span class="opt-t">${h(k)}</span></label>`).join('')}
    </div>
    <p class="note">${h('set.pagesNote')}</p>
    <span class="lbl">${h('set.startHead')}</span>
    <div class="btns"><button class="sm" data-act="set-ask-again">${h('set.askAgain')}</button></div>
    <p class="note">${h('set.thisBrowser')}</p>
    <span class="lbl">${h('set.versionHead')}</span>
    <p class="small" data-appversion>${esc(appVersion ?? '…')}</p>
    <p class="note">${h('set.versionNote')}</p>`;
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
  }
  return false;
}

function bind(body){
  body.addEventListener('change', e => {
    const el = e.target;
    if (!el.closest?.('[data-mode=settings]')) return;
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
    if (el.dataset.pagesmode){ C.setPagesMode(el.dataset.pagesmode); return; }
  });
}

const api = {
  views: { settings: () => settingsView() },
  act, bind,
};
