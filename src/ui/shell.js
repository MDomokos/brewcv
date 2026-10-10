// The Workbench shell: the canvas, the sheet, and one column of three cards. State is in
// src/store/store.js; selection, preview and the page shown are view state, never undone.

import { createStore } from '../store/store.js';
import { createPersist, idbBackend, memoryBackend, fsaFolder, readFolder, readBackup, requestPersistence } from '../store/persist.js';
import { load, loadResume, detect, resumeFileName } from '../model/schema.js';
import { chooseVariant, newResume } from '../model/resume.js';
import { fit, FILL_BAND, key as measureKeyOf } from '../fit.js';
import { createSheet } from './sheet.js';
import { computeLayout, pageSize, pageInView, pageTop } from './layout.js';
import { indexModel, targetOf, up, same, step, versionsOf, NONE } from './select.js';
import { openActualSize } from './actual.js';
import { initEdit } from './edit.js';
import { initResumes } from './resumes.js';
import { initFiles } from './files.js';
import { initExport } from './export.js';
import { initDesign } from './design.js';
import { initOnboarding } from './onboarding.js';
import { initCareer } from './career.js';
import * as RS from '../model/resumes.js';
import { switchLang, missingList, langName, langsInUse, addLangInUse } from '../model/lang.js';
import { langMenuHtml, menuKey, focusMenu } from './langmenu.js';
import { t, h, errText, uiLang, docChrome, loadCatalogue, setUiLang, setUiLangNow, UI_LANGS } from '../i18n/index.js';
import { initSettings, readPref, browserLang } from './settings.js';
import { crumb } from './parts.js';

// Where the source is published; the menu links to it (AGPL-3.0, section 13). Change it here when the repo moves.
const SOURCE_URL = 'https://github.com/MDomokos/brewcv';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const params = new URLSearchParams(location.search);
const backend = params.has('memory') ? memoryBackend() : idbBackend();   // ?memory: a clean, throwaway session (checks)
const store = createStore({ record: null, resumes: [], cur: null, openId: null });
const persist = createPersist({ store, backend });
const sheet = createSheet($('#sheet'), { onPick: pick, onKey: key, onPage: p => { ui.page = p; renderFoot(); }, onRename: (id, text) => edit.rename(id, text),
  onReveal: reveal, chrome: r => docChrome(r.lang ?? 'en'),
  extraCss: r => design.extraCss(store.state.record, r) });

function pagesMode(){ try { const m = localStorage.getItem('rb-pages'); return ['auto', 'spread', 'stack'].includes(m) ? m : 'auto'; } catch { return 'auto'; } }
function setPagesMode(m){ ui.mode = m; try { localStorage.setItem('rb-pages', m); } catch { /* this session only */ } relayout(); }

const ui = {
  pref: readPref() ?? { mode: 'follow' }, askLang: !readPref(),
  sel: NONE, previewing: false, page: 0, mode: pagesMode(), menu: false, laid: null, fills: [],
  fitting: false, lastFit: null, work: null, workKey: null, ix: null, probed: new Set(),
};
window.__wb = { store, persist, sheet, ui };      // for checks and the console

// The no-origin card stays English: when it shows, no module ran.
function staticText(){
  document.documentElement.lang = uiLang();
  $('#sheet').setAttribute('aria-label', t('aria.sheet'));
  $('#career').setAttribute('aria-label', t('aria.career'));
  $('#thumb').textContent = t('career.thumbHover');
  $('#thumb').setAttribute('aria-label', t('career.thumbHover'));
  if ($('#thumbcap')) $('#thumbcap').textContent = t('career.thumbCap');
}

function wantedUi(){
  if (ui.view === 'welcome' && onboarding.step === 'welcome' && ui.introLang) return ui.introLang;
  if (ui.askLang && ui.view === 'welcome') return ui.introLang ?? browserLang();
  const working = ui.ws === 'career' ? career.lang : (cur()?.lang ?? 'en');
  const want = ui.pref.mode === 'fixed' ? ui.pref.lang : working;
  return UI_LANGS.includes(want) ? want : 'en';
}
// A loaded catalogue switches at once, so a toast after a commit is already in the new language.
function syncUi(redrawAll = false){
  const want = wantedUi();
  if (want === uiLang()){ if (redrawAll) restyle(); return; }
  if (setUiLangNow(want)){ staticText(); if (redrawAll) restyle(); return; }
  setUiLang(want).then(() => restyle());
}
function restyle(){ staticText(); renderAll(); if (ui.ws === 'career') renderCareer(); }

async function boot(){
  requestPersistence();
  let restored = false;
  try { restored = await persist.restore(); } catch { /* blocked storage: start fresh */ }
  if (!restored || !store.state.record){
    await loadExample({ quiet: true });
    if (!params.has('memory') || params.has('welcome')) ui.view = 'welcome';
  } else if (/\(fictional\)/.test(store.state.record.meta?.owner ?? '') && !params.has('memory')){
    // Only the example is open, so nothing of yours is: a reload goes back to the start screen. The session stays as it is.
    ui.view = 'welcome';
  }
  if (ui.view === 'welcome') onboarding.begin(); else ui.askLang = false;
  await setUiLang(wantedUi());
  // the languages you use load now, so switching between them is instant
  Promise.all(langsInUse(record()).map(l => loadCatalogue(l))).catch(() => {});
  staticText();
  bindChrome();
  addEventListener('resize', relayout);
  $('#pages').addEventListener('scroll', onPagesScroll, { passive: true });
  addEventListener('scroll', onPagesScroll, { passive: true });
  document.addEventListener('fullscreenchange', relayout);
  persist.onStatus(renderHead);
  store.subscribe(onChange);
  checkFolder();
  let drew = await redraw();
  if (drew === false && restored){
    // The saved session does not fit this build: keep it as a checkpoint and start over.
    try { await persist.checkpoint(t('checkpoint.beforeExample'), 'replace'); } catch { /* the checkpoint is a courtesy */ }
    await loadExample({ quiet: true });
    ui.view = 'welcome'; ui.askLang = !readPref();
    onboarding.begin();
    await setUiLang(wantedUi());
    staticText();
    drew = await redraw();
  }
  document.body.classList.add('is-ready');
}

async function loadExample({ quiet = false } = {}){
  const json = await (await fetch('./data/example.json', { cache: 'no-cache' })).json();
  const { model } = load(json);
  const names = await (await fetch('./data/example-resumes/index.json', { cache: 'no-cache' })).json();
  const resumes = [], frozen = {};
  for (const n of names){
    const r = await fetch(`./data/example-resumes/${encodeURIComponent(n)}`, { cache: 'no-cache' });
    if (!r.ok) continue;
    const got = loadResume(await r.json(), model);
    resumes.push({ ...got.recipe, id: n });
    if (got.frozen) frozen[n] = got.frozen;
  }
  const state = { record: model, resumes, frozen, cur: newResume(model), openId: null };
  if (resumes[0]) RS.openSaved(state, resumes[0].id);
  if (store.state.record && !quiet){ await persist.checkpoint(t('checkpoint.beforeExample'), 'replace'); store.replace(state, t('undo.loadExample')); }
  else store.reset(state, 'example');
  ui.sel = NONE;
}

const record = () => store.state.record;
const cur = () => store.state.cur;
const lang = () => cur()?.lang ?? 'en';

// The renderer's mutable copy of the record, rebuilt when the record changes. The probe
// caches line counts in it, never in the store.
function work(){
  const k = JSON.stringify(record());
  if (k !== ui.workKey){
    ui.work = store.materialize(record());
    ui.workKey = k;
    ui.ix = indexModel(ui.work);
    ui.probed.clear();
  }
  return ui.work;
}

let seq = 0, timer = null;
const schedule = () => { clearTimeout(timer); timer = setTimeout(redraw, 40); };

function onChange({ kind, label }){
  if (ui.sel.kind !== 'none' && !stillThere(ui.sel)) ui.sel = NONE;
  syncUi();
  if (ui.ws === 'career'){ const cp = $('#career'), keep = cp.scrollTop; cp.innerHTML = career.timelineHtml(); cp.scrollTop = keep; }
  if (kind === 'undo') toast(t('toast.undone', { label }));
  if (kind === 'redo') toast(t('toast.redone', { label }));
  schedule();
}

function stillThere(sel){
  const ix = indexModel(record());
  if (sel.kind === 'bullet') return ix.facts.has(sel.id);
  if (sel.kind === 'job') return ix.work.has(sel.id);
  if (sel.kind === 'section') return ix.sections.has(sel.id);
  return true;
}

async function redraw(){
  const my = ++seq;
  if (!record() || !cur()){ renderAll(); return true; }
  try {
    await loadCatalogue(lang());
    const w = work();
    const r = structuredClone(cur());
    const res = await sheet.show(w, r);
    if (my !== seq) return;
    ui.laid = res.laid; ui.fills = res.pages; ui.previewing = false;
    relayout();
    sheet.select(ui.sel, ui.ix);
    sheet.setFocus(edit.focusHits(), ui.ix);
    sheet.setMissing(missingList(w, r), ui.ix);
    renderAll();
    if (ui.flashAfter){ sheet.flash(ui.flashAfter); ui.flashAfter = null; }
    const pk = `${measureKeyOf(r)}|${lang()}`;
    if (!ui.probed.has(pk)){
      ui.probed.add(pk);
      await sheet.probe(w, r);
      if (my !== seq) return;
      const again = await sheet.show(w, r);
      ui.laid = again.laid; ui.fills = again.pages;
      sheet.select(ui.sel, ui.ix);
      renderAll();
    }
    return true;
  } catch (e){
    console.error(e);
    // place the column even when the draw failed, so only the sheet looks broken
    try { relayout(); renderAll(); } catch (e2){ console.error(e2); }
    toast(t('error.draw', { msg: e.message }), 'bad');
    return false;
  }
}

function relayout(){
  const c = cur();
  if (!c) return;
  const pages = ui.laid?.pages?.length ?? 1;
  const L = computeLayout({ vw: innerWidth, vh: innerHeight, format: c.format, pages, mode: ui.mode });
  const host = $('#sheet'), box = $('#pages');
  Object.assign(box.style, { left: `${L.pages.left}px`, top: `${L.pages.top}px`, width: L.phone ? '' : `${L.pages.width}px`, height: L.phone ? '' : `${L.pages.height}px` });
  box.firstElementChild.style.height = `${L.pages.content}px`;
  host.style.left = `${L.sheet.left - L.pages.left}px`;
  host.style.top = `${L.sheet.top - L.pages.top}px`;
  const col = $('#col');
  col.style.left = `${L.col.left}px`;
  col.style.top = `${L.col.top}px`;
  col.style.width = `${L.col.width}px`;
  col.style.height = `${L.col.height}px`;
  ui.layout = L;
  document.body.dataset.phone = String(!!L.phone);
  // on a phone the pages scroll above the bottom sheet
  if (L.phone) document.body.style.minHeight = `${L.sheet.height + 16 + L.col.height}px`; else document.body.style.minHeight = '';
  // Career: only the transform changes, so the sheet's move to its thumbnail is one transition.
  const cp = $('#career'), th = $('#thumb');
  const career = ui.ws === 'career' && L.career;
  if (career){
    const P = L.career.panel, T = L.career.thumb;
    Object.assign(cp.style, { left: `${P.left}px`, top: `${P.top}px`, width: `${P.width}px`, height: `${P.height}px` });
    const dx = T.left - L.sheet.left, dy = T.top + box.scrollTop - L.sheet.top;
    host.style.transform = `translate(${dx}px, ${dy}px) scale(${T.scale})`;
    Object.assign(th.style, { left: `${T.left}px`, top: `${T.top}px`, width: `${T.width}px`, height: `${T.height}px` });
  } else host.style.transform = `translate(0px, 0px) scale(${L.scale})`;
  cp.hidden = th.hidden = !career;
  const cap = $('#thumbcap');
  if (cap){ cap.hidden = !career; if (career) Object.assign(cap.style, { left: `${L.career.thumb.left}px`, top: `${L.career.thumb.top - 22}px`, width: `${L.career.thumb.width}px` }); }
  sheet.setView({ mode: career ? 'single' : L.stack ? 'stack' : 'spread', page: 0 });
  document.body.dataset.spread = String(L.spread);
  document.body.dataset.stack = String(!!L.stack);
  if (L.stack) ui.page = pageInView(L, scrollOf(), pages); else ui.page = 0;
  renderFoot();
}

// The pages scroll in #pages on a big screen, and in the window on a phone.
const scrollOf = () => (ui.layout?.phone ? scrollY : $('#pages').scrollTop);
function scrollPagesTo(top){
  if (ui.layout?.phone) scrollTo({ top, behavior: 'smooth' }); else $('#pages').scrollTo({ top, behavior: 'smooth' });
}
let scrollRaf = 0;
function onPagesScroll(){
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const L = ui.layout;
    if (!L?.stack || ui.ws === 'career') return;
    const p = pageInView(L, scrollOf(), ui.fills.length || 1);
    if (p !== ui.page){ ui.page = p; renderFoot(); }
  });
}
function reveal({ page, top, bottom }){
  const L = ui.layout;
  if (!L?.stack || ui.ws === 'career') return;
  const view = L.phone ? innerHeight - L.col.height : L.pages.height;
  const y0 = L.sheet.top + top * L.scale, y1 = L.sheet.top + bottom * L.scale;
  const at = scrollOf();
  if (y0 >= at && y1 <= at + view) return;
  scrollPagesTo(Math.max(0, Math.min(y0 - 48, pageTop(L, page) + (y1 - y0 > view ? 0 : Math.max(0, y1 - (L.sheet.top + page * L.pageStep) - view + 48)))));
}

function pick({ variant, section }){
  if (ui.fitting) return;
  const next = targetOf(ui.ix ?? indexModel(work()), { variant, section });
  select(same(next, ui.sel) && next.kind !== 'none' ? next : next);
}
function select(sel){
  if (!edit.leaving(sel)) return;
  if (ui.view && ui.ws !== 'career' && sel.kind !== 'none'){ ui.view = null; renderHead(); }
  ui.sel = sel;
  if (ui.previewing){ ui.previewing = false; sheet.endPreview(); }
  sheet.select(sel, ui.ix);
  renderBody(true);
}

function closeBodyMenus(){ return [resumes, career].some(m => m.closeMenus?.()); }

function bindChrome(){
  document.body.addEventListener('click', onClick);
  document.addEventListener('keydown', key);
  $('#file').addEventListener('change', e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) openFile(f); });
  addEventListener('dragover', e => { e.preventDefault(); });
  addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) openFile(f); });
}

function renderAll(){ syncIntro(); renderHead(); renderBody(); renderFoot(); }

// Links that act (no href) are buttons to the keyboard and to a screen reader.
function keyboardable(root){
  for (const a of root.querySelectorAll('a[data-act]:not([href]), .vmore[data-act]')){ a.tabIndex = 0; a.setAttribute('role', 'button'); }
}
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role=button][data-act], .vrow[data-act]')){ e.preventDefault(); e.target.click(); }
});
new MutationObserver(() => { keyboardable($('#body')); keyboardable($('#head')); }).observe(document.getElementById('col'), { childList: true, subtree: true });

const resumeName = r => RS.resumeLabel(r);

// A second press mid-animation reverses it, because CSS transitions do that by themselves.
let wsTimer = 0;
function setWorkspace(ws){
  if (ws === (ui.ws ?? 'resume')) return;
  if (!edit.leaving(NONE)) return;
  ui.ws = ws;
  document.body.classList.add('ws-anim');
  clearTimeout(wsTimer); wsTimer = setTimeout(() => document.body.classList.remove('ws-anim'), 700);
  document.body.dataset.ws = ws;
  if (ui.previewing) endPreview();
  ui.view = ws === 'career' ? 'career' : null;
  ui.menu = false; ui.langMenu = null;
  if (ws === 'career'){ ui.sel = NONE; career.reset(); }
  syncUi();                       // leaving Career goes back to the resume's language
  renderCareer();
  relayout();
  renderHead();
  renderFoot();
}
function renderCareer(){
  if (ui.ws === 'career'){
    const cp = $('#career'), keep = cp.scrollTop;
    cp.innerHTML = career.timelineHtml();
    cp.scrollTop = keep;
    cp.querySelector('[aria-pressed=true].row, [aria-pressed=true].srow, [aria-pressed=true].crd')?.scrollIntoView({ block: 'nearest' });
  }
  renderBody(true);
}

// Views that replace the body card until ← Back or Esc; null is the Edit view.
const VIEWS = {};
function setView(v){
  if (v && !VIEWS[v]) return;
  ui.view = v;
  if (ui.previewing) endPreview();
  resumes.reset();
  renderHead();
  renderBody(true);
}

function renderHead(){
  const r = cur();
  const st = persist.status;
  const saved = st.status === 'error' ? `<span class="bad" title="${esc(st.error)}">${h('head.notSaved')}</span>`
    : st.status === 'saving' ? h('head.saving') : st.status === 'saved' ? h('head.savedHere') : h('head.staysHere');
  const dirty = r ? resumes.isDirty() : false;
  const meta = r ? [r.jobType, (r.lang ?? 'en').toUpperCase(), r.format === 'us-letter' ? t('paper.letter') : t('paper.a4'),
    r.pageLimit === 0 ? t('head.anyLength') : r.pageLimit ? t('head.pages', { n: r.pageLimit }) : null].filter(Boolean).join(' · ') : '';
  const careerRow = ui.ws === 'career' ? `<div class="hrow only-c">${career.langControl()}<span class="grow"></span>
      <button class="tool" data-act="undo" ${store.history.undo ? '' : 'disabled'} title="${esc(store.history.next ? t('foot.undoWhat', { what: store.history.next, n: store.history.undo }) : t('foot.undoN', { n: store.history.undo }))}" aria-label="${esc(t('foot.undo'))}">↶</button>
      <button class="tool" data-act="redo" ${store.history.redo ? '' : 'disabled'} aria-label="${esc(t('foot.redo'))}" title="${esc(t('foot.redo'))}">↷</button></div>` : '';
  $('#head').innerHTML = `
    <div class="hrow">
      <h1 class="logo"><img src="icons/icon.svg" alt="" width="28" height="28">BrewCV</h1>
      <span class="ws" role="group" aria-label="${esc(t('head.workspace'))}">
        <button data-act="ws" data-ws="career" aria-pressed="${ui.ws === 'career'}" title="${esc(t('head.careerTitle'))}">${h('head.career')}</button>
        <button data-act="ws" data-ws="resume" aria-pressed="${ui.ws !== 'career'}" title="${esc(t('head.resumeTitle'))}">${h('head.resume')}</button>
      </span>
      <button class="tool" data-act="menu" aria-haspopup="true" aria-expanded="${ui.menu}" title="${esc(t('head.menuTitle'))}" aria-label="${esc(t('head.menuTitle'))}">⋯</button>
    </div>
    ${careerRow}
    <div class="hrow only-r">
      <button class="docname" data-act="goto" data-v="resumes" title="${esc(t('head.docTitle'))}"><span class="dn" id="docname">${esc(resumeName(r))}${dirty ? `<span class="dirty" title="${esc(t('head.unsaved'))}"> •</span>` : ''}</span><span class="dt">${esc(meta)}</span></button>
      ${r ? langButton(r) : ''}
      <button class="sm ${dirty ? 'primary' : ''}" data-act="save" id="save" title="${esc(store.state.openId ? t('head.saveTitle') : t('head.saveNameTitle'))}" ${dirty ? '' : 'disabled'}>${store.state.openId ? h('head.save') : h('head.saveAs')}</button>
    </div>
    <div class="hrow small only-r">
      <span class="savestate ${st.status === 'error' ? 'bad' : 'muted'}" id="savestate">${dirty ? (store.state.openId ? h('head.unsavedSep') : h('head.notSavedYetSep')) : ''}${saved}${st.linked ? ` · <span title="${esc(t('head.linkedFolder'))}">📁 ${esc(st.linked)}</span>` : ''}</span>
    </div>
    <div class="hrow tools only-r">
      <button class="tool" data-act="goto" data-v="resumes" aria-pressed="${['resumes', 'compare', 'new', 'save'].includes(ui.view)}">${h('head.resumes')}</button>
      <button class="tool" data-act="goto" data-v="design" aria-pressed="${ui.view === 'design'}">${h('head.design')}</button>
      <button class="tool" data-act="goto" data-v="export" aria-pressed="${ui.view === 'export'}">${h('head.export')}</button>
      <span class="grow"></span>
      <button class="tool" data-act="actual" title="${esc(t('head.actualTitle'))}">${h('head.actual')}</button>
      <button class="tool" data-act="fullscreen" title="${esc(t('head.fullscreen'))}" aria-label="${esc(t('head.fullscreen'))}">${document.fullscreenElement ? '⤡' : '⤢'}</button>
    </div>
    ${ui.reconnect ? `<div class="hrow notice"><span class="small">${h('head.reconnectNote', { name: ui.reconnect.name })}</span><button class="sm" data-act="reconnect">${h('head.reconnect')}</button></div>` : ''}
    ${ui.menu ? menuHtml() : ''}`;
}

function langButton(r){
  const L = r.lang ?? 'en';
  const n = missingList(work(), r).length;
  const inUse = langsInUse(record());
  const open = ui.langMenu === 'resume';
  return `<span class="langs lang-menu"><button class="sm langbtn ${inUse.includes(L) ? '' : 'off'}" id="langbtn" data-act="lang-menu" aria-haspopup="menu" aria-expanded="${open}" title="${esc(t('head.langGroup'))}${n ? esc(t('head.langMissing', { n })) : ''}">${esc(langName(L))} ▾${n ? `<span class="badge">${n}</span>` : ''}</button>
    ${open ? langMenuHtml({ for: 'resume', current: L, inUse, more: ui.langMore, label: t('head.langGroup'),
      count: l => (ui.langCounts?.[l] ?? null) }) : ''}</span>`;
}
async function openLangMenu(){
  if (ui.langMenu === 'resume'){ ui.langMenu = null; renderHead(); return; }
  ui.menu = false; ui.langMenu = 'resume'; ui.langMore = false;
  const inUse = langsInUse(record());
  await Promise.all(inUse.map(l => loadCatalogue(l)));
  ui.langCounts = Object.fromEntries(inUse.map(l => [l, l === 'en' ? 0 : missingList(work(), { ...cur(), lang: l }).length]));
  renderHead();
  focusMenu('.langpop');
}
async function useLanguage(to, { add = false } = {}){
  ui.langMenu = null;
  if (to === lang() && !add){ renderHead(); return; }
  ui.sel = NONE;
  await loadCatalogue(to);
  store.commit(d => { if (add) addLangInUse(d.record, to); switchLang(d.cur, to); }, add ? t('undo.addLanguage', { lang: langName(to) }) : t('undo.language', { lang: langName(to) }));
  const n = missingList(work(), cur()).length;
  toast(t('toast.langNow', { lang: langName(to) }) + (n ? ' ' + t('toast.langMissing', { n, lang: langName(to) }) : ''));
}

function menuHtml(){
  const linked = persist.status.linked;
  const others = (store.state.resumes ?? []);
  return `<div class="menu card" role="menu">
    <button role="menuitem" data-act="goto" data-v="import">${h('menu.open')}</button>
    <button role="menuitem" data-act="${linked ? 'unlink' : 'link'}" ${'showDirectoryPicker' in window || linked ? '' : `disabled title="${esc(t('menu.linkNeeds'))}"`}>${linked ? h('menu.unlink', { name: linked }) : h('menu.link')}</button>
    <button role="menuitem" data-act="backup">${h('menu.backup')}</button>
    <button role="menuitem" data-act="goto" data-v="import">${h('menu.restore')}</button>
    <button role="menuitem" data-act="goto" data-v="history">${h('menu.history')}</button>
    <a role="menuitem" href="${SOURCE_URL}" target="_blank" rel="noopener">${h('src.link')}</a>
    <hr>
    <button role="menuitem" data-act="goto" data-v="languages"><span>${h('menu.languages')}</span> <small class="muted">${langsInUse(record()).length}</small></button>
    <button role="menuitem" data-act="goto" data-v="settings">${h('menu.settings')}</button>
    <hr>
    <button role="menuitem" data-act="goto" data-v="resumes">${h('menu.saved', { n: others.length })}</button>
    <button role="menuitem" data-act="goto" data-v="new">${h('menu.newResume')}</button>
    <hr>
    ${ui.ws === 'career' ? `<button role="menuitem" data-act="c-tips-again">${h('menu.tipsAgain')}</button>` : ''}
    <button role="menuitem" data-act="example">${h('menu.example')}</button>
    <button role="menuitem" data-act="start-over">${h('menu.startOver')}</button>
  </div>`;
}

function syncIntro(){
  document.body.classList.toggle('is-intro', ui.view === 'welcome' && ['welcome', 'lang'].includes(onboarding.step));
  document.body.classList.toggle('is-intro-wide', ui.view === 'welcome' && onboarding.step === 'welcome');
}
function renderBody(animate = false){
  syncIntro();
  const el = $('#body');
  if (!record() || !cur()){ el.innerHTML = `<p class="muted">${h('body.loading')}</p>`; return; }
  const s = ui.sel;
  const keep = el.scrollTop;
  if (ui.view && VIEWS[ui.view]){
    // don't redraw a form under the caret (the claim editor and write-in box excepted)
    if (!animate && ['welcome', 'career'].includes(ui.view) && el.contains(document.activeElement) && document.activeElement.matches('input:not([type=checkbox]):not([type=radio]), textarea') && !document.activeElement.closest('.editor, .writein')) return;
    el.innerHTML = VIEWS[ui.view]();
    if (ui.view === 'career') el.style.setProperty('--kc', career.stripe()); else el.style.removeProperty('--kc');
    el.dataset.view = ui.view;
    el.dataset.mode = ui.view;
    if (animate){ el.classList.remove('anim-in'); void el.offsetWidth; el.classList.add('anim-in'); el.scrollTop = 0; } else el.scrollTop = keep;
    if (ui.view === 'career') edit.afterRender();
    return;
  }
  el.dataset.mode = 'edit';
  el.innerHTML = s.kind === 'bullet' ? edit.bulletView(s) : s.kind === 'job' ? edit.jobView(s) : s.kind === 'section' ? edit.sectionView(s)
    : s.kind === 'header' ? headerView() : edit.homeView();
  el.dataset.view = s.kind;
  el.dataset.editing = edit.editing ? edit.editing.mode : '';
  if (animate){ el.classList.remove('anim-in'); void el.offsetWidth; el.classList.add('anim-in'); el.scrollTop = 0; }
  else el.scrollTop = keep;
  edit.afterRender();
}


function sectionTitle(id){
  const s = ui.ix.sections.get(id);
  const own = cur().sections?.find(x => x?.id === id)?.label;
  return (typeof own === 'string' ? own : own?.[lang()]) ?? record().i18n?.[lang()]?.sections?.[id] ?? s?.title ?? (id === 'header' ? t('section.header') : id);
}
const textOfFact = id => (id && cur().overrides?.[id]) ?? chooseVariant(ui.work, id, cur()).v?.text ?? '';

function headerView(){
  const b = record().basics ?? {};
  return `${crumb([{ t: t('section.header') }])}
    <div class="from">${h('edit.fromCareerArea', { area: t('career.step1') })} · <a data-act="to-career" data-area="about" data-what="about" data-id="name">${h('edit.editInCareer')}</a></div>
    <h2 class="title">${esc(textOfFact(b.display?.name) || b.name)}</h2>
    <span class="lbl">${h('header.texts')}</span>
    <div class="list">${['name', 'label', 'contact'].map(k => b.display?.[k]).filter(Boolean).map(id => `<button class="item fact" data-act="select-fact" data-id="${esc(id)}" data-section="header"><span>${esc(textOfFact(id)).replace(/\n/g, ' · ')}</span></button>`).join('')}</div>
    <p class="muted small">${h('header.note')}</p>`;
}

function fillText(){
  const last = (ui.fills ?? []).at(-1);
  if (!last) return '';
  const over = ui.fills.find(p => p.overflow > 0);
  return over ? t('foot.overflowOn', { page: over.page }) : `${ui.fills.length > 1 ? t('foot.pageSep', { page: ui.fills.length }) : ''}${t('foot.full', { pct: (100 * last.used / last.usable).toFixed(1) })}`;
}
function renderFoot(){
  const fills = ui.fills ?? [];
  const n = fills.length;
  const last = fills.at(-1);
  const pct = last ? 100 * last.used / last.usable : 0;
  const over = fills.find(p => p.overflow > 0);
  const status = over ? 'overflow' : pct > FILL_BAND[1] ? 'over' : pct < FILL_BAND[0] ? 'under' : 'ok';
  const text = !last ? '—' : over ? (over.overflowSection ? t('foot.overflowIn', { section: sectionTitle(over.overflowSection), page: over.page }) : t('foot.overflowPage', { page: over.page }))
    : `${n > 1 ? t('foot.pageSep', { page: n }) : ''}${t('foot.full', { pct: pct.toFixed(1) })}`;
  const spread = ui.layout?.spread, stack = ui.layout?.stack;
  const nav = n > 1 ? `<span class="pnav">${stack ? `<button class="ghost sm" data-act="page" data-d="-1" ${ui.page <= 0 ? 'disabled' : ''} aria-label="${esc(t('foot.prevPage'))}">◂</button><span id="pagenum">${ui.page + 1} / ${n}</span><button class="ghost sm" data-act="page" data-d="1" ${ui.page >= n - 1 ? 'disabled' : ''} aria-label="${esc(t('foot.nextPage'))}">▸</button>` : ''}
    ${ui.layout?.canSpread ? `<button class="ghost sm" data-act="view" title="${esc(spread ? t('foot.toStack') : t('foot.toSpread'))}" aria-label="${esc(spread ? t('foot.toStack') : t('foot.toSpread'))}">${spread ? '▯' : '▭▭'}</button>` : ''}</span>` : '';
  const hs = store.history;
  const limit = cur()?.pageLimit;
  $('#foot').innerHTML = `
    <div class="mp ${status}" title="${esc(fills.map(p => t('foot.pageFill', { page: p.page, pct: (100 * p.used / p.usable).toFixed(1) })).join(' · ') + t('foot.band', { lo: FILL_BAND[0], hi: FILL_BAND[1] }))}">
      <div class="mbar"><div class="mband"></div><div class="mfill" style="width:${Math.min(100, pct)}%"></div></div>
      <span class="mt" id="meter">${esc(text)}</span>
    </div>
    ${nav}
    <button class="primary" data-act="fit" ${ui.fitting || limit === 0 ? 'disabled' : ''} title="${esc(limit === 0 ? t('foot.fitOff') : t('foot.fitTitle'))}">${ui.fitting ? h('foot.fitting') : h('foot.fit')}</button>
    <button class="tool" data-act="undo" ${hs.undo ? '' : 'disabled'} title="${esc(hs.next ? t('foot.undoWhat', { what: hs.next, n: hs.undo }) : t('foot.undoN', { n: hs.undo }))}" aria-label="${esc(t('foot.undo'))}">↶</button>
    <button class="tool" data-act="redo" ${hs.redo ? '' : 'disabled'} title="${esc(hs.nextRedo ? t('foot.redoWhat', { what: hs.nextRedo }) : t('foot.redo'))}" aria-label="${esc(t('foot.redo'))}">↷</button>`;
}

async function onClick(e){
  const tg = e.target.closest('[data-act]');
  if (ui.menu && !e.target.closest('.menu') && tg?.dataset.act !== 'menu'){ ui.menu = false; renderHead(); }
  if (ui.langMenu && !e.target.closest('.langpop') && tg?.dataset.act !== 'lang-menu'){ ui.langMenu = null; renderHead(); }
  if (!e.target.closest('.langpop') && tg?.dataset.act !== 'lang-menu-body') closeBodyMenus();
  if (!tg || !tg.dataset.act) return;
  const act = tg.dataset.act, id = tg.dataset.id;
  if (act === 'goto'){ ui.menu = false; setView(tg.dataset.v); return; }
  if (act === 'ws'){ ui.menu = false; setWorkspace(tg.dataset.ws); return; }
  if (await onboarding.act(act, tg)) return;
  if (await settings.act(act, tg)) return;
  if (await career.act(act, tg)) return;
  if (act === 'view-back'){ setView(null); return; }
  if (await resumes.act(act, tg)) return;
  if (await files.act(act, tg)) return;
  if (await exporter.act(act, tg)) return;
  if (await design.act(act, tg)) return;
  if (await edit.act(act, tg)) return;
  switch (act){
    case 'menu': ui.menu = !ui.menu; renderHead(); break;
    case 'to-career': {
      const d = tg.dataset;
      career.focus({ area: d.area, sel: d.what ? { what: d.what, key: d.key, id: d.id } : null });
      setWorkspace('career');
      break;
    }
    case 'deselect': select(NONE); break;
    case 'select-section': select({ kind: 'section', id }); sheet.flash(id); break;
    case 'select-job': select({ kind: 'job', id }); break;
    case 'select-fact': select({ kind: 'bullet', id, section: tg.dataset.section ?? 'summary', ...(tg.dataset.owner ? { owner: tg.dataset.owner } : {}) }); break;
    case 'lang-menu': openLangMenu(); break;
    case 'lang-more': ui.langMore = true; renderHead(); focusMenu('.langpop [data-act=lang-add]'); break;
    case 'lang': if ((tg.dataset.for ?? 'resume') === 'resume') useLanguage(tg.dataset.lang); break;
    case 'lang-add': if ((tg.dataset.for ?? 'resume') === 'resume') useLanguage(tg.dataset.lang, { add: true }); break;
    case 'select-bullet': {
      const job = ui.ix.highlight.get(id);
      select(job ? { kind: 'bullet', id, job, section: 'experience' } : { kind: 'bullet', id, section: 'summary' });
      break;
    }
    case 'use-version': useVersion(ui.sel.id, tg.dataset.v); break;
    case 'undo': store.undo(); break;
    case 'redo': store.redo(); break;
    case 'fit': runFit(); break;
    case 'page': {
      ui.page = Math.max(0, Math.min((ui.fills.length || 1) - 1, ui.page + Number(tg.dataset.d)));
      if (ui.layout?.stack) scrollPagesTo(pageTop(ui.layout, ui.page));
      renderFoot(); break;
    }
    case 'view': setPagesMode(ui.layout?.spread ? 'stack' : 'spread'); break;
    case 'actual': openActual(); break;
    case 'fullscreen': toggleFullscreen(); break;
    case 'open': ui.menu = false; pickFile(); break;
    case 'link': ui.menu = false; linkFolder(); break;
    case 'unlink': ui.menu = false; await persist.unlink(); renderHead(); toast(t('toast.unlinked')); break;
    case 'reconnect': reconnect(); break;
    case 'backup': ui.menu = false; downloadBackup(); break;

    case 'checkpoint': ui.menu = false; await persist.checkpoint(t('checkpoint.named', { date: new Date().toLocaleString() })); toast(t('toast.checkpointSaved')); renderHead(); break;
    case 'example': ui.menu = false; await loadExample(); toast(t('toast.exampleOpen')); break;
  }
}

document.addEventListener('mouseover', e => {
  const row = e.target.closest?.('.vrow[data-v]');
  if (!row || row.classList.contains('cur') || row.classList.contains('flat') || ui.ws === 'career' || ui.fitting || edit.editing) return;
  if (ui.hoverV === row.dataset.v) return;
  ui.hoverV = row.dataset.v;
  previewVersion(ui.sel.id, row.dataset.v);
});
document.addEventListener('mouseout', e => {
  const list = e.target.closest?.('.vlist');
  if (!list || list.contains(e.relatedTarget) || edit.editing || ui.ws === 'career') return;
  ui.hoverV = null;
  endPreview();
});

async function previewVersion(factId, vid){
  const r = structuredClone(cur());
  r.picks = { ...r.picks, [factId]: vid };
  ui.previewing = true;
  const res = await sheet.preview(work(), r, factId);
  if (!ui.previewing) return sheet.endPreview();
  ui.fills = res.pages; renderFoot();
}
async function endPreview(){
  if (!ui.previewing) return;
  ui.previewing = false;
  const res = await sheet.endPreview();
  if (ui.preview){ ui.preview = null; relayout(); }    // back to the open resume's size and view
  if (res){ ui.fills = res.pages; renderFoot(); }
  sheet.select(ui.sel, ui.ix);
}
async function previewRecipe(r, fact = null, w = work()){
  ui.previewing = true;
  const my = ui.previewSeq = (ui.previewSeq ?? 0) + 1;
  const res = await sheet.preview(w, r, fact);
  if (!ui.previewing || my !== ui.previewSeq) return;
  // Another saved resume can be another paper size or page count. The column never moves:
  // its first page is shown in the space the open resume's page has.
  if (r.format !== cur().format || res.laid?.pages?.length !== ui.laid?.pages?.length){
    ui.preview = { format: r.format };
    const L = ui.layout, a = pageSize(cur().format), b = pageSize(r.format);
    sheet.setView({ mode: 'single', page: 0 });
    $('#sheet').style.top = `${L.sheet.top + (L.stack && !L.phone ? $('#pages').scrollTop : 0)}px`;
    $('#sheet').style.transform = `translate(0px, 0px) scale(${L.scale * Math.min(a.h / b.h, a.w / b.w, 1.2)})`;
  } else if (ui.preview){ ui.preview = null; relayout(); }
  ui.fills = res.pages; renderFoot();
}

function useVersion(factId, vid){
  ui.previewing = false; ui.hoverV = null;
  const v = ui.ix.variants.get(vid);
  store.commit(d => {
    d.cur.picks = { ...(d.cur.picks ?? {}), [factId]: vid };
    if (d.cur.overrides?.[factId] !== undefined) delete d.cur.overrides[factId];   // back from "this resume only"
  }, t('undo.useVersion', { n: v?.n ?? '?' }));
}


async function runFit(){
  if (ui.fitting || !cur()) return;
  ui.fitting = true; renderFoot();
  const w = work();
  const before = structuredClone(cur());
  try {
    await sheet.probe(w, before);
    const res = await fit(w, before, {
      measure: r => sheet.measure(w, r),
      layout: r => sheet.layout(w, r),
    });
    if (res.error){ toast(res.errorKey ? t(res.errorKey) : res.error, 'bad'); return; }
    ui.lastFit = res.report;
    const changed = JSON.stringify(res.recipe) !== JSON.stringify(before);
    if (changed) store.commit(d => { d.cur = res.recipe; }, t('undo.fit'));
    toast(fitSummary(res.report) + (changed ? ' ' + t('toast.ctrlZUndoes') : ''), res.report.converged ? '' : 'warn');
  } catch (e){
    console.error(e); toast(t('fit.stopped', { msg: errText(e) }), 'bad');
  } finally {
    ui.fitting = false;
    await redraw();
  }
}

// the first line of Fit's report (src/fit.js formatReport, which the CLI prints in English)
function fitSummary(r){
  const pages = r.pages.map(x => t(x.held ? 'fit.pageHeld' : 'fit.page', { page: x.page, fill: x.fill })).join(' · ');
  return t(r.converged ? 'fit.inBand' : 'fit.notInBand', { n: r.rounds, pages, lo: r.band[0], hi: r.band[1] });
}

function key(e){
  if (menuKey(e)) return;
  const typing = e.target.closest?.('input, textarea, select, [contenteditable=true]');
  const mod = e.ctrlKey || e.metaKey;
  if (typing && mod && ['z', 'y'].includes(e.key.toLowerCase())) return;      // the text box's own undo
  if (mod && !e.altKey && e.key.toLowerCase() === 'z'){ e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
  if (mod && e.key.toLowerCase() === 'y'){ e.preventDefault(); store.redo(); return; }
  if (mod && e.key.toLowerCase() === 's'){ e.preventDefault(); if (resumes.isDirty() || !store.state.openId) resumes.save(); return; }
  if (mod && e.key.toLowerCase() === 'o'){ e.preventDefault(); setView('resumes'); return; }
  if (typing) return;
  if (ui.ws === 'career' ? career.key(e) : edit.key(e)) return;
  if (e.key === 'Escape'){
    if (ui.menu){ ui.menu = false; renderHead(); return; }
    if (ui.langMenu){ ui.langMenu = null; renderHead(); $('#langbtn')?.focus(); return; }
    if (closeBodyMenus()) return;
    if (ui.ws === 'career'){ if (career.escape()) return; setWorkspace('resume'); return; }
    if (ui.view){ setView(['compare', 'new'].includes(ui.view) ? 'resumes' : null); return; }
    if (ui.previewing){ endPreview(); return; }
    select(up(ui.sel)); return;
  }
  if (e.shiftKey && e.key.toLowerCase() === 'f' && !mod){ e.preventDefault(); toggleFullscreen(); return; }
  if (!mod && !e.altKey && !e.shiftKey && (e.key === 'c' || e.key === 'r') && !ui.view?.match?.(/welcome/)){ setWorkspace(e.key === 'c' ? 'career' : 'resume'); return; }
  if (ui.ws === 'career') return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    const id = step(sheet.order(ui.ix), ui.sel, e.key === 'ArrowDown' ? 1 : -1);
    if (typeof id === 'string'){ e.preventDefault(); const job = ui.ix.highlight.get(id); select(job ? { kind: 'bullet', id, job, section: 'experience' } : { kind: 'bullet', id, section: 'summary' }); }
    return;
  }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && ui.sel.kind === 'bullet'){
    const vs = versionsOf(ui.ix, ui.sel.id, lang());
    const at = vs.findIndex(v => v.id === chooseVariant(ui.work, ui.sel.id, cur()).v?.id);
    const next = vs[at + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next){ e.preventDefault(); useVersion(ui.sel.id, next.id); }
  }
}

function toggleFullscreen(){
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => toast(t('toast.noFullscreen'), 'warn'));
}
function openActual(){
  if (!cur()) return;
  document.body.classList.add('is-actual');
  openActualSize({ work: work(), recipe: structuredClone(cur()), laid: ui.laid, onClose: () => document.body.classList.remove('is-actual') });
}

// Every file goes through one door (src/ui/files.js); `ui.pickMode` says who asked.
async function openFile(file){
  const mode = ui.pickMode ?? null; ui.pickMode = null;
  try {
    if (mode === 'photo' || /^image\//.test(file.type)) return await design.setPhoto(file);
    if (mode === 'theme') return design.importTheme(await file.text(), file.name);
    return await files.openFile(file, mode);
  } catch (e){ toast(`${file.name}: ${errText(e)}`, 'bad'); }
}
function pickFile(mode = null){ ui.pickMode = mode; $('#file').click(); }
function download(text, name, type = 'application/json'){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

function downloadBackup(){
  persist.backup().then(b => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2) + '\n'], { type: 'application/json' }));
    a.download = t('file.backupName', { date: new Date().toISOString().slice(0, 10) });
    document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    toast(t('toast.backupDone'));
  });
}

// A linked folder mirrors the record and its resumes to disk. It is never needed.
async function linkFolder(){
  let handle;
  try { handle = await showDirectoryPicker({ id: 'brewcv', mode: 'readwrite' }); }
  catch { return; }
  const f = fsaFolder(handle);
  if ((await f.permission(true)) !== 'granted') return toast(t('toast.noFolderPermission'), 'warn');
  await adoptFolder(f, true);
}

async function adoptFolder(f, fresh){
  const disk = await readFolder(f).catch(e => { toast(`${f.name}: ${errText(e)}`, 'bad'); return null; });
  if (disk){
    const cmp = await persist.compareFolder(f);
    if (!cmp.same){
      const useDisk = confirm(t(disk.state.resumes.length ? 'confirm.folderHasResumes' : 'confirm.folderHas', { name: f.name, n: disk.state.resumes.length }));
      if (useDisk){
        await persist.checkpoint(t('checkpoint.beforeFolder', { name: f.name }), 'replace');
        ui.sel = NONE;
        const st = disk.state;
        if (st.openId) RS.openSaved(st, st.openId);
        if (!st.cur){ st.cur = newResume(st.record); st.openId = null; }
        store.replace(st, t('undo.useFolder', { name: f.name }));
      }
    }
  }
  const wrote = await persist.link(f);
  ui.reconnect = null;
  renderHead();
  toast(wrote.length ? t('toast.linkedWrote', { name: f.name, n: wrote.length }) : t('toast.linked', { name: f.name }));
}

async function checkFolder(){
  const h = await persist.rememberedFolder().catch(() => null);
  if (!h) return;
  const f = fsaFolder(h);
  if ((await f.permission(false)) === 'granted') return adoptFolder(f, false);
  ui.reconnect = f; renderHead();
}
async function reconnect(){
  const f = ui.reconnect;
  if (!f) return;
  if ((await f.permission(true)) !== 'granted') return toast(t('toast.stillNoDisk'), 'warn');
  await adoptFolder(f, false);
}

function toast(msg, tone = ''){
  const t = $('#toast');
  t.textContent = msg; t.className = `toast on ${tone}`;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3600);
}

const edit = initEdit({
  store, ui, sheet, toast, record, cur, lang, work, chooseVariant, sectionTitle, textOfFact, resumeName, fillText,
  ix: () => ui.ix ?? indexModel(work()),
  newerBanner: () => resumes.newerBanner() + onboarding.tipHtml(),
  setFocus: () => sheet.setFocus(edit.focusHits(), ui.ix),
  select: sel => select(sel),
  renderBody: () => renderBody(),
  flash: id => { ui.flashAfter = id; },
  endHover: () => { ui.hoverV = null; if (ui.previewing) endPreview(); },
  endPreview: () => endPreview(),
  indexOf: m => indexModel(m),
  previewRecipe,
  careerLang: () => career.lang, careerFact: () => career.fact(), careerUp: () => career.up(),
});
edit.bind($('#body'));
window.__wb.edit = edit;
const resumes = initResumes({
  store, ui, persist, toast, work, NONE, setView,
  renderBody: () => renderBody(),
  leaveOk: () => edit.leaving(NONE),
  endPreview: () => endPreview(),
  previewRecipe,
});
Object.assign(VIEWS, resumes.views);
const files = initFiles({
  store, ui, persist, toast, NONE, setView, pickFile, download,
  onImage: f => design.setPhoto(f), onThemeText: (t, n) => design.importTheme(t, n), onTheme: (j, n) => design.importTheme(j, n),
  renderBody: () => renderBody(),
});
Object.assign(VIEWS, files.views);
files.bind($('#body'));
window.__wb.files = files;
const exporter = initExport({ store, ui, toast, work, cur, download, downloadBackup, renderBody: () => renderBody(),
  extraCss: r => design.extraCss(store.state.record, r) });
const design = initDesign({ store, ui, toast, cur, setView, pickFile, download, photoUrl: () => store.materialize(store.state.record?.basics?.image) });
Object.assign(VIEWS, design.views);
const onboarding = initOnboarding({ store, ui, persist, toast, setView, renderBody: (a) => renderBody(a), restyle: () => restyle() });
Object.assign(VIEWS, onboarding.views);
onboarding.bind($('#body'));
const career = initCareer({ store, ui, toast, work, setView, syncUi: r => syncUi(r), edit, select: s => select(s), setWorkspace: w => setWorkspace(w), renderBody: (a) => renderBody(a), renderCareer: () => renderCareer(),
  renderHead: () => renderHead(), photoUrl: () => store.materialize(store.state.record?.basics?.image) });
Object.assign(VIEWS, career.views);
career.bind($('#body'));
window.__wb.career = career;
design.bind($('#body'));
window.__wb.design = design;
Object.assign(VIEWS, exporter.views);
window.__wb.export = exporter;
resumes.bind($('#body'));
window.__wb.resumes = resumes;

const settings = initSettings({ store, ui, toast, setView, renderBody: () => renderBody(), syncUi: r => syncUi(r), setPagesMode: m => setPagesMode(m) });
Object.assign(VIEWS, settings.views);
settings.bind($('#body'));
window.__wb.settings = settings;

window.__booted = true;
boot().catch(e => { console.error(e); toast(t('error.start', { msg: errText(e) }), 'bad'); });
