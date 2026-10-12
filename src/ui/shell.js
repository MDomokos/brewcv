// The Workbench shell: the canvas, the sheet, and one column of three cards. State is in
// src/store/store.js; selection, preview and the page shown are view state, never undone.

import { createStore } from '../store/store.js';
import { createPersist, idbBackend, memoryBackend, fsaFolder, readFolder, readBackup, requestPersistence, SAVE_FILE_NAME } from '../store/persist.js';
import { load, loadResume, detect, resumeFileName } from '../model/schema.js';
import { chooseVariant, newResume, listedBullets, jobRefs } from '../model/resume.js';
import { isArchived } from '../model/entries.js';
import { fit, FILL_BAND, key as measureKeyOf } from '../fit.js';
import { createSheet } from './sheet.js';
import { computeLayout, pageSize, pageInView, pageTop } from './layout.js';
import { initDock } from './dock.js';
import { initChecklist } from './checklist.js';
import { initHelp } from './help.js';
import { icon } from './icons.js';
import { indexModel, targetOf, up, same, step, versionsOf, NONE } from './select.js';
import { openActualSize } from './actual.js';
import { initEdit } from './edit.js';
import { initResumes, snapBarText } from './resumes.js';
import { initSwitcher } from './switcher.js';
import { initFiles } from './files.js';
import { initExport } from './export.js';
import { initDesign } from './design.js';
import { initOnboarding } from './onboarding.js';
import { initCareer } from './career.js';
import * as RS from '../model/resumes.js';
import { switchLang, missingList, langName, langsInUse, addLangInUse } from '../model/lang.js';
import { langMenuHtml, menuKey, focusMenu } from './langmenu.js';
import { jobTypeLabel } from '../model/focus.js';
import { t, h, errText, uiLang, docChrome, loadCatalogue, setUiLang, setUiLangNow, UI_LANGS } from '../i18n/index.js';
import { initSettings, readPref, browserLang } from './settings.js';
import { ib } from './dock.js';

// Where the source is published; the menu links to it (AGPL-3.0, section 13). Change it here when the repo moves.
const SOURCE_URL = 'https://github.com/MDomokos/brewcv';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const params = new URLSearchParams(location.search);
const backend = params.has('memory') ? memoryBackend() : idbBackend();   // ?memory: a clean, throwaway session (checks)
const store = createStore({ record: null, resumes: [], cur: null, openId: null }, { settle: RS.settle });      // autosave of the open resume rides on every commit
const persist = createPersist({ store, backend });
const sheet = createSheet($('#sheet'), { onPick: pick, onKey: key, onPage: p => { ui.page = p; renderFoot(); }, onRename: (id, text) => edit.rename(id, text),
  onReveal: reveal, chrome: r => docChrome(r.lang ?? 'en'),
  extraCss: r => design.extraCss(store.state.record, r) });

function pagesMode(){ try { const m = localStorage.getItem('rb-pages'); return ['auto', 'spread', 'stack'].includes(m) ? m : 'auto'; } catch { return 'auto'; } }
function setPagesMode(m){ ui.mode = m; try { localStorage.setItem('rb-pages', m); } catch { /* this session only */ } relayout(); }

const ui = {
  pref: readPref() ?? { mode: 'follow' }, askLang: !readPref(),
  sel: NONE, previewing: false, page: 0, mode: pagesMode(), menu: false, laid: null, fills: [],
  fitting: false, lastFit: null, work: null, workKey: null, ix: null, probed: new Set(), snap: null,
};
window.__wb = { store, persist, sheet, ui, setView: v => setView(v), saveToFile: () => saveToFile() };      // for checks and the console

// The no-origin card stays English: when it shows, no module ran.
function staticText(){
  document.documentElement.lang = uiLang();
  $('#sheet').setAttribute('aria-label', t('aria.sheet'));
  $('#timeline').setAttribute('aria-label', t('ux2.timelineTitle'));
  $('#body').setAttribute('aria-label', t('ux2.panelLabel'));
}

function wantedUi(){
  if (ui.view === 'welcome' && onboarding.step === 'welcome' && ui.introLang) return ui.introLang;
  if (ui.askLang && ui.view === 'welcome') return ui.introLang ?? browserLang();
  const working = shown()?.lang ?? 'en';
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
function restyle(){ staticText(); renderAll(); }

async function boot(){
  requestPersistence().then(p => { ui.persisted = p; });
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
  dock.bind();
  addEventListener('resize', () => { relayout(); dock.renderFoot(); });
  $('#pages').addEventListener('scroll', onPagesScroll, { passive: true });
  addEventListener('scroll', onPagesScroll, { passive: true });
  document.addEventListener('fullscreenchange', relayout);
  persist.onStatus(renderHead);
  store.subscribe(onChange);
  // an older session may hold a resume that was never saved: save it now, as every change from here on does
  if (cur() && !store.state.openId) store.commit(() => {}, t('ux1.undoSaveDraft'));
  checkFolder();
  // the column and its first words now; the sheet follows as soon as it has been laid out
  try { relayout(); renderAll(); } catch (e){ console.error(e); }
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
  // all at once; the order of `names` is kept
  const files = await Promise.all(names.map(async n => {
    const r = await fetch(`./data/example-resumes/${encodeURIComponent(n)}`, { cache: 'no-cache' });
    return r.ok ? r.json() : null;
  }));
  for (const [i, n] of names.entries()){
    if (!files[i]) continue;
    const got = loadResume(files[i], model);
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
// What the page shows: the open resume, or the snapshot being looked at (read-only).
const snapNow = () => (ui.snap ? RS.findSnapshot(store.state, ui.snap.id) : null);
let shownKey = null, shownRecipe = null;
function shown(){
  const s = snapNow();
  if (!s){ if (ui.snap) ui.snap = null; return cur(); }
  const k = `${ui.snap.id}|${store.state.openId}|${JSON.stringify(s.sends)}|${record() ? 1 : 0}`;
  if (k !== shownKey){ shownKey = k; shownRecipe = RS.snapshotRecipe(record(), s); }
  return shownRecipe;
}
function setSnap(id){
  const had = !!ui.snap;
  ui.snap = id ? { id } : null;
  shownKey = null;
  if (id || had){ ui.sel = NONE; sheet.select(NONE, ui.ix); if (ui.previewing) endPreview(); schedule(); }
}
const lang = () => shown()?.lang ?? 'en';

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

let notedId = null;
function onChange({ kind, label }){
  shownKey = null;
  if (store.state.openId && store.state.openId !== notedId){ notedId = store.state.openId; switcher.noteOpen(notedId); }     // the switcher's “recent”
  if (ui.snap && !snapNow()) setSnap(null);
  if (ui.sel.kind !== 'none' && !stillThere(ui.sel)){ ui.sel = NONE; dock.sync(); }
  syncUi();
  if (career.tlOpen) renderTimeline();
  if (kind === 'undo') toast(t('toast.undone', { label }));
  if (kind === 'redo') toast(t('toast.redone', { label }));
  schedule();
}

function stillThere(sel){
  const ix = indexModel(record());
  if (sel.kind === 'bullet') return ix.facts.has(sel.id);
  if (sel.kind === 'job') return ix.work.has(sel.id);
  if (sel.kind === 'section') return ix.sections.has(sel.id);
  if (sel.kind === 'record' && sel.what === 'entry') return (record().education ?? []).some((e, i) => (e.id ?? `edu-${i}`) === sel.id);
  if (sel.kind === 'record' && sel.what === 'item'){ const m = record(); return (m[sel.group] ?? []).some(x => x?.id === sel.id) || (m.projects ?? []).concat(m.awards ?? []).some(x => x?.id === sel.id); }
  return true;
}

async function redraw(){
  const my = ++seq;
  if (!record() || !cur()){ renderAll(); return true; }
  try {
    const shownNow = shown();
    await loadCatalogue(lang());
    const w = work();
    const r = structuredClone(shownNow);
    const res = await sheet.show(w, r);
    if (my !== seq) return;
    ui.laid = res.laid; ui.fills = res.pages; ui.previewing = false;
    relayout();
    sheet.select(ui.sel, ui.ix);
    sheet.setFocus(edit.focusHits(), ui.ix);
    sheet.setMissing(missingList(w, r), ui.ix);
    renderAll();
    renderChip();
    document.body.classList.add('is-ready');
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
  const c = shown();
  if (!c) return;
  const pages = ui.laid?.pages?.length ?? 1;
  const L = computeLayout({ vw: innerWidth, vh: innerHeight, format: c.format, pages, mode: ui.mode, folded: dock.folded(), zoom: ui.zoom });
  const host = $('#sheet'), box = $('#pages');
  Object.assign(box.style, { left: `${L.pages.left}px`, top: `${L.pages.top}px`, width: L.phone ? '' : `${L.pages.width}px`, height: L.phone ? '' : `${L.pages.height}px` });
  box.firstElementChild.style.height = `${L.pages.content}px`;
  box.firstElementChild.style.width = L.phone ? '1px' : `${L.pages.contentW}px`;
  host.style.left = `${L.sheet.left - L.pages.left}px`;
  host.style.top = `${L.sheet.top - L.pages.top}px`;
  const col = $('#col');
  col.style.left = `${L.col.left}px`;
  col.style.top = `${L.col.top}px`;
  col.style.width = `${L.col.width}px`;
  col.style.height = `${L.col.height}px`;
  col.classList.toggle('is-folded', L.folded);
  col.classList.toggle('is-drawer', L.drawer && !L.folded);
  for (const id of ['head', 'body']){ const el = $(`#${id}`); el.inert = L.folded; }
  $('#rail').hidden = !L.folded;
  const tl = $('#timeline');
  if (L.phone) Object.assign(tl.style, { left: '0px', top: '0px', width: `${innerWidth}px`, height: `${innerHeight - L.col.height}px` });
  else Object.assign(tl.style, { left: `${G_}px`, top: `${G_}px`, width: `${L.areaW - G_}px`, height: `${innerHeight - 2 * G_}px` });
  ui.layout = L;
  document.body.dataset.phone = String(!!L.phone);
  document.body.dataset.drawer = String(!!L.drawer);
  document.body.dataset.folded = String(!!L.folded);
  // on a phone the pages scroll above the bottom sheet
  if (L.phone) document.body.style.minHeight = `${L.sheet.height + 16 + L.col.height}px`; else document.body.style.minHeight = '';
  host.style.transform = `translate(0px, 0px) scale(${L.scale})`;
  sheet.setView({ mode: L.stack ? 'stack' : 'spread', page: 0 });
  document.body.dataset.spread = String(L.spread);
  document.body.dataset.stack = String(!!L.stack);
  if (L.stack) ui.page = pageInView(L, scrollOf(), pages); else ui.page = 0;
  renderFoot();
  renderChip();
}
const G_ = 16;

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
    if (!L?.stack) return;
    const p = pageInView(L, scrollOf(), ui.fills.length || 1);
    if (p !== ui.page){ ui.page = p; renderFoot(); }
  });
}
function reveal({ page, top, bottom }){
  const L = ui.layout;
  if (!L?.stack) return;
  const view = L.phone ? innerHeight - L.col.height : L.pages.height;
  const y0 = L.sheet.top + top * L.scale, y1 = L.sheet.top + bottom * L.scale;
  const at = scrollOf();
  if (y0 >= at && y1 <= at + view) return;
  scrollPagesTo(Math.max(0, Math.min(y0 - 48, pageTop(L, page) + (y1 - y0 > view ? 0 : Math.max(0, y1 - (L.sheet.top + page * L.pageStep) - view + 48)))));
}

function pick({ variant, section }){
  if (ui.fitting || ui.snap || ui.view === 'welcome') return;
  const next = targetOf(ui.ix ?? indexModel(work()), { variant, section });
  select(next, { fromPage: true });
  if (next.kind !== 'none') help.firstTime();
}
// `fromPage`: the click was on the sheet, so the checklist scrolls to the group it opened. `keepScroll`: it was in the
// checklist, where the person is already looking, so the panel stays where it is.
function select(sel, { fromPage = false, keepScroll = false } = {}){
  if (!edit.leaving(sel)) return;
  if (ui.view && ui.view !== 'welcome' && sel.kind !== 'none'){ ui.view = null; }
  ui.sel = sel;
  if (ui.previewing){ ui.previewing = false; sheet.endPreview(); }
  sheet.select(sel, ui.ix);
  checklist.onSelect(sel, { scroll: fromPage });
  dock.sync();
  renderHead();
  renderBody(!keepScroll);
  renderChip();
}

function closeBodyMenus(){ return [resumes, career].some(m => m.closeMenus?.()); }
const hoverFact = id => sheet.setHover(id, ui.ix);

function bindChrome(){
  document.body.addEventListener('click', onClick);
  document.addEventListener('keydown', key);
  $('#file').addEventListener('change', e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) openFile(f); });
  addEventListener('dragover', e => { e.preventDefault(); });
  addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) openFile(f); });
}

function renderAll(){ syncIntro(); renderHead(); renderBody(); dock.renderRail(); renderFoot(); renderTimeline(); }

// Links that act (no href) are buttons to the keyboard and to a screen reader.
function keyboardable(root){
  for (const a of root.querySelectorAll('a[data-act]:not([href]), .vmore[data-act]')){ a.tabIndex = 0; a.setAttribute('role', 'button'); }
}
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role=button][data-act], .vrow[data-act]')){ e.preventDefault(); e.target.click(); }
});
new MutationObserver(() => { keyboardable($('#body')); keyboardable($('#head')); }).observe(document.getElementById('col'), { childList: true, subtree: true });

const resumeName = r => RS.resumeLabel(r);

// The timeline opens over the page, full width, for working through a whole career. Esc closes it.
let tlWas = false;
function renderTimeline(){
  const el = $('#timeline');
  if (!el) return;
  const open = career.tlOpen && !!record();
  el.hidden = !open;
  document.body.classList.toggle('has-timeline', open);
  if (!open){ el.innerHTML = ''; tlWas = false; return; }
  const keep = el.scrollTop;
  el.innerHTML = career.timelineHtml();
  el.scrollTop = keep;
  if (!tlWas){ tlWas = true; el.querySelector('[data-act=tl-close]')?.focus(); }
  el.querySelector('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest' });
}

// Views that replace the body card until ← Back or Esc; null is the Edit view.
const VIEWS = {};
function setView(v){
  if (v && !VIEWS[v]) return;
  ui.view = v;
  if (ui.previewing) endPreview();
  resumes.reset();
  dock.sync();
  renderHead();
  renderBody(true);
}

// the head is redrawn on every save: the control that had the focus keeps it
const focusKey = el => (el?.id ? `#${el.id}` : el?.dataset?.act ? `[data-act="${el.dataset.act}"]${el.dataset.m ? `[data-m="${el.dataset.m}"]` : ''}` : null);
function renderHead(){
  const ae = document.activeElement, kept = ae && ae.closest?.('#head') ? focusKey(ae) : null;
  drawHead();
  if (kept){ const n = $(`#head ${kept}`); if (n && n !== document.activeElement) n.focus({ preventScroll: true }); }
}
function drawHead(){
  const r = shown();
  const st = persist.status;
  const saving = st.status === 'saving' || st.status === 'pending';
  const saveText = st.status === 'error' ? t('ux1.saveFailed') : saving ? t('head.saving') : t('ux1.savedDevice');
  const saved = `<span class="si ${st.status === 'error' ? 'bad' : saving ? '' : 'ok'}" aria-hidden="true">${st.status === 'error' ? '⚠' : saving ? '…' : '✓'}</span><span class="stext2">${esc(st.status === 'error' ? saveText : saving ? t('head.saving') : t('ux2.savedShort'))}</span><span class="sr">${esc(saveText)}${st.status === 'error' && st.error ? ': ' + esc(st.error) : ''}</span>`;
  const meta = r ? [jobTypeLabel(store.state.record, r.jobType), (r.lang ?? 'en').toUpperCase(), r.format === 'us-letter' ? t('paper.letter') : t('paper.a4'),
    r.pageLimit === 0 ? t('head.anyLength') : r.pageLimit ? t('head.pages', { n: r.pageLimit }) : null].filter(Boolean).join(' · ') : '';
  const snap = snapNow();
  const mode = dock.modeOf();
  const tab = (m, key) => `<button role="tab" id="tab-${m}" data-act="mode" data-m="${m}" aria-selected="${mode === m}" aria-controls="body" tabindex="${mode === m || (!mode && m === 'edit') ? 0 : -1}" ${m === 'design' && ui.snap ? 'disabled' : ''}>${h(key)}</button>`;
  $('#head').innerHTML = `
    <div class="hrow top">
      <h1 class="logo"><img src="icons/icon.svg" alt="" width="28" height="28"><span class="sr">BrewCV</span></h1>
      <button class="docname" id="docname-btn" data-act="switcher" aria-haspopup="dialog" aria-expanded="${switcher.isOpen}" title="${esc(t('head.docTitle'))}"><span class="dn" id="docname">${esc(resumeName(cur()))}<span aria-hidden="true"> ▾</span></span><span class="dt">${esc(meta)}</span></button>
      ${r ? langButton(r) : ''}
      <span class="savestate ${st.status === 'error' ? 'bad' : 'muted'}" id="savestate" role="status" title="${esc(saveText)}">${saved}${st.linked ? `<span class="sr"> · ${esc(t('head.linkedFolder'))}: ${esc(st.linked)}</span>` : ''}</span>
      <button class="sm" data-act="save" id="save" title="${esc(t('ux1.saveTitle'))}" ${ui.snap ? 'disabled' : ''}>${h('head.save')}</button>
      ${ib('panel-toggle', 'right', t('ux2.foldPanel'), t('ux2.foldPanelTip'), '', 'b')}
      <button class="tool" data-act="menu" aria-haspopup="true" aria-expanded="${ui.menu}" title="${esc(t('head.menuTitle'))}" aria-label="${esc(t('head.menuTitle'))}">⋯</button>
    </div>
    <div class="hrow modes">
      <div class="seg" role="tablist" aria-label="${esc(t('ux2.modes'))}">${tab('edit', 'ux2.modeEdit')}${tab('design', 'ux2.modeDesign')}${tab('export', 'ux2.modeExport')}</div>
      ${ib('help', 'help', t('ux2.shortcuts'), t('ux2.shortcutsTip'), '', 'b')}
      <button class="filestate ${fileLine().stale ? 'stale' : ''}" data-act="save-file" id="filestate" title="${esc(t('save.title', { name: SAVE_FILE_NAME }))}">${esc(fileLine().text)}</button>
    </div>
    ${st.code === 'folder-changed' ? `<div class="hrow notice" role="alert"><span class="small">${esc(st.error)}</span><span class="btns"><button class="sm" data-act="folder-compare">${h('save.folderCompare')}</button><button class="sm" data-act="folder-overwrite">${h('save.folderOverwrite')}</button></span></div>` : ''}
    ${ui.saveNote ? `<div class="hrow notice" role="status"><span class="small">${esc(t('save.note'))}${ui.persisted === false ? ' ' + esc(t('save.noteStorage')) : ''}</span><button class="sm" data-act="save-note-ok">${h('save.noteOk')}</button></div>` : ''}
    ${snap ? `<div class="hrow notice snapbar" role="status"><span>${esc(snapBarText(snap))}</span><button class="sm" data-act="snap-close">${h('ux1.backToResume')}</button></div>` : ''}
    ${ui.reconnect ? `<div class="hrow notice"><span class="small">${h('head.reconnectNote', { name: ui.reconnect.name })}</span><button class="sm" data-act="reconnect">${h('head.reconnect')}</button></div>` : ''}
    ${ui.menu ? menuHtml() : ''}`;
}

// "n changes not saved to a file", "Saved to file 10 min ago", or "Not saved to a file yet"
function fileLine(){
  const { last, changes } = persist.fileState;
  if (!last) return { text: t('save.never'), stale: true };
  if (changes) return { text: t('save.changes', { n: changes }), stale: true };
  const mins = Math.max(0, Math.round((Date.now() - new Date(last.at)) / 60000));
  const rtf = new Intl.RelativeTimeFormat(uiLang(), { numeric: 'auto', style: 'short' });
  const when = mins < 1 ? rtf.format(0, 'second') : mins < 60 ? rtf.format(-mins, 'minute') : mins < 1440 ? rtf.format(-Math.round(mins / 60), 'hour') : rtf.format(-Math.round(mins / 1440), 'day');
  return { text: t('save.ago', { when }), stale: false };
}
function refreshFileLine(){
  const b = $('#filestate'), l = fileLine();
  if (b){ b.textContent = l.text; b.classList.toggle('stale', l.stale); }
}
setInterval(refreshFileLine, 30000);

function langButton(r){
  const L = r.lang ?? 'en';
  const n = missingList(work(), r).length;
  const inUse = langsInUse(record());
  const open = ui.langMenu === 'resume';
  return `<span class="langs lang-menu"><button class="sm langbtn ${inUse.includes(L) ? '' : 'off'}" id="langbtn" data-act="lang-menu" aria-haspopup="menu" aria-expanded="${open}" aria-label="${esc(t('head.langGroup'))}: ${esc(langName(L))}${n ? esc(t('head.langMissing', { n })) : ''}" ${ui.snap ? 'disabled' : ''} title="${esc(langName(L))}${n ? esc(t('head.langMissing', { n })) : ''}">${esc(L.toUpperCase())} ▾${n ? `<span class="badge">${n}</span>` : ''}</button>
    ${open ? langMenuHtml({ for: 'resume', current: L, inUse, more: ui.langMore, label: t('head.langGroup'),
      count: l => (ui.langCounts?.[l] ?? null) }) : ''}</span>`;
}
async function openLangMenu(){
  if (ui.langMenu === 'resume'){ ui.langMenu = null; renderHead(); return; }
  switcher.close();
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
  return `<div class="menu card" role="menu">
    <button role="menuitem" data-act="goto" data-v="import">${h('menu.open')}</button>
    <button role="menuitem" data-act="save-file">${h('menu.backup')}</button>
    <button role="menuitem" data-act="${linked ? 'unlink' : 'link'}" ${'showDirectoryPicker' in window || linked ? '' : `disabled title="${esc(t('menu.linkNeeds'))}"`}>${linked ? h('menu.unlink', { name: linked }) : h('menu.link')}</button>
    <button role="menuitem" data-act="goto" data-v="history">${h('menu.history')}</button>
    <hr>
    <button role="menuitem" data-act="goto" data-v="settings">${h('menu.settings')}</button>
    <a role="menuitem" href="${SOURCE_URL}/blob/main/docs/PRIVACY.md" target="_blank" rel="noopener">${h('priv.link')}</a>
    <a role="menuitem" href="${SOURCE_URL}" target="_blank" rel="noopener">${h('src.link')}</a>
    <hr>
    <button role="menuitem" data-act="example">${h('menu.example')}</button>
    <button role="menuitem" data-act="start-over">${h('menu.startOver')}</button>
  </div>`;
}

function syncIntro(){
  const welcome = ui.view === 'welcome';
  document.body.classList.toggle('is-intro', welcome && ['welcome', 'lang'].includes(onboarding.step));
  document.body.classList.toggle('is-intro-wide', welcome && onboarding.step === 'welcome');
  // onboarding from scratch is a quiet editor: the page and the question panel, nothing else
  document.body.classList.toggle('is-quiet', welcome && !['welcome', 'lang'].includes(onboarding.step));
}
function renderBody(animate = false){
  syncIntro();
  const el = $('#body');
  if (!record() || !cur()){ el.innerHTML = `<p class="muted">${h('body.loading')}</p>`; return; }
  const s = ui.sel;
  const keep = el.scrollTop;
  // a record form with something typed in it is not redrawn under the caret; one you have left or not changed is, and the focus stays where it was
  const ae = document.activeElement;
  const typing = !animate && el.contains(ae) && ae.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea') && !!ae.closest('[data-form]');
  if (typing && ae.value !== ae.defaultValue) return;
  const had = typing && ae.id ? { id: ae.id, start: ae.selectionStart, end: ae.selectionEnd } : null;
  // a tick or a switch redraws the panel; the control that had the focus keeps it: found by what it is, else by its place
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  const q = v => String(v).replace(/["\\]/g, '\\$&');
  const keyOf = e => {
    const d = e.dataset ?? {};
    if (e.id) return `#${CSS.escape(e.id)}`;
    for (const k of ['on', 'secon', 'jobon', 'same', 'cmp']) if (d[k] !== undefined) return `[data-${k}="${q(d[k])}"]`;
    if (d.act) return `[data-act="${q(d.act)}"]${d.id ? `[data-id="${q(d.id)}"]` : ''}${d.g ? `[data-g="${q(d.g)}"]` : ''}${d.v ? `[data-v="${q(d.v)}"]` : ''}${d.sel ? `[data-sel="${q(d.sel)}"]` : ''}`;
    return null;
  };
  const tabs0 = !animate && !had && ae && ae !== el && el.contains(ae) ? [...el.querySelectorAll(FOCUSABLE)] : null;
  const at0 = tabs0 ? tabs0.indexOf(ae) : -1, key0 = tabs0 ? keyOf(ae) : null;
  if (ui.snap && !ui.view && !snapNow()) ui.snap = null;
  const finish = () => {
    if (animate){ el.classList.remove('anim-in'); void el.offsetWidth; el.classList.add('anim-in'); el.scrollTop = 0; } else el.scrollTop = keep;
    if (had){ const n = document.getElementById(had.id); if (n && n !== document.activeElement){ n.focus(); try { n.setSelectionRange(had.start, had.end); } catch { /* not a text box */ } } }
    else if (at0 >= 0){
      const now = [...el.querySelectorAll(FOCUSABLE)];
      const to = (key0 && el.querySelector(key0)) || (now.length === tabs0.length ? now[at0] : null);
      if (to && to !== document.activeElement) to.focus({ preventScroll: true });
    }
  };
  if (ui.snap && !ui.view){
    el.innerHTML = VIEWS.snapshot();
    el.dataset.view = el.dataset.mode = 'snapshot';
    finish();
    return;
  }
  if (ui.view && VIEWS[ui.view]){
    // don't redraw a form under the caret (the claim editor and write-in box excepted)
    if (!animate && ui.view === 'welcome' && el.contains(document.activeElement) && document.activeElement.matches('input:not([type=checkbox]):not([type=radio]), textarea') && !document.activeElement.closest('.editor, .writein')) return;
    el.innerHTML = VIEWS[ui.view]();
    el.dataset.view = ui.view;
    el.dataset.mode = ui.view;
    finish();
    return;
  }
  el.dataset.mode = 'edit';
  const main = s.kind === 'bullet' ? edit.bulletView(s) : s.kind === 'job' ? edit.jobView(s) : s.kind === 'section' ? edit.sectionView(s)
    : ['header', 'record', 'add', 'kind'].includes(s.kind) ? career.panel(s) : edit.homeView();
  el.innerHTML = main + checklist.html() + (s.kind === 'none' ? `<p class="muted tiny privacy">${h('body.privacy')}</p>` : '');
  el.dataset.view = s.kind;
  el.dataset.editing = edit.editing ? edit.editing.mode : '';
  finish();
  edit.afterRender();
  checklist.afterRender();
}


function sectionTitle(id){
  const s = ui.ix.sections.get(id);
  const own = shown().sections?.find(x => x?.id === id)?.label;
  return (typeof own === 'string' ? own : own?.[lang()]) ?? record().i18n?.[lang()]?.sections?.[id] ?? s?.title ?? (id === 'header' ? t('section.header') : id);
}
const textOfFact = id => (id && cur().overrides?.[id]) ?? chooseVariant(ui.work, id, cur()).v?.text ?? '';

function fillText(){
  const last = (ui.fills ?? []).at(-1);
  if (!last) return '';
  const over = ui.fills.find(p => p.overflow > 0);
  return over ? t('foot.overflowOn', { page: over.page }) : `${ui.fills.length > 1 ? t('foot.pageSep', { page: ui.fills.length }) : ''}${t('foot.full', { pct: (100 * last.used / last.usable).toFixed(1) })}`;
}
const renderFoot = () => dock.renderFoot();

// The job being worked on wears a chip on the page: its employer and how many of its lines are on this resume.
function renderChip(){
  const lay = $('#pagelay');
  if (!lay) return;
  const s = ui.sel, L = ui.layout, m = record();
  const jobId = s.kind === 'job' ? s.id : s.kind === 'bullet' ? (s.job ?? s.owner ?? null) : null;
  const w = jobId && ui.ix?.work.get(jobId);
  const r = w && L && !L.phone && !ui.snap && !ui.previewing ? sheet.rectOfJob(jobId, ui.ix) : null;
  if (!r){ lay.innerHTML = ''; return; }
  const on = jobRefs(m, cur()).some(x => (typeof x === 'string' ? x : x.id) === jobId) ? listedBullets(m, cur(), jobId).length : 0;
  const total = (w.highlights ?? []).filter(x => !isArchived(m, x)).length;
  const left = L.sheet.left - L.pages.left + r.left * L.scale, top = L.sheet.top - L.pages.top + r.top * L.scale;
  lay.innerHTML = `<button class="jobchip" data-act="select-job" data-id="${esc(jobId)}" style="left:${Math.round(left)}px;top:${Math.max(4, Math.round(top - 30))}px" title="${esc(t('ux2.chipTitle'))}"><span class="jn">${esc(w.name)}</span><span class="jc">${esc(t('ux2.nOfM', { n: on, m: total }))}</span></button>`;
}
// a meter was clicked: bring that page into view (stacked pages scroll; zoomed side-by-side pages scroll across)
function goToPage(i){
  const L = ui.layout, n = ui.fills.length || 1;
  ui.page = Math.max(0, Math.min(n - 1, i));
  if (L?.stack) scrollPagesTo(pageTop(L, ui.page));
  else if (L && !L.phone && L.sheet.width + 2 * 16 > L.areaW){
    const { w } = pageSize(shown().format);
    $('#pages').scrollTo({ left: Math.max(0, L.sheet.left + ui.page * (w + 24) * L.scale - 16), behavior: 'smooth' });
  }
  renderFoot();
}

async function onClick(e){
  const tg = e.target.closest('[data-act]');
  if (ui.menu && !e.target.closest('.menu') && tg?.dataset.act !== 'menu'){ ui.menu = false; renderHead(); }
  if (ui.langMenu && !e.target.closest('.langpop') && tg?.dataset.act !== 'lang-menu'){ ui.langMenu = null; renderHead(); }
  if (!e.target.closest('.langpop') && tg?.dataset.act !== 'lang-menu-body') closeBodyMenus();
  if (!tg || !tg.dataset.act) return;
  const act = tg.dataset.act, id = tg.dataset.id;
  if (await switcher.act(act, tg)) return;
  if (act === 'goto'){ ui.menu = false; setView(tg.dataset.v); return; }
  if (await dock.act(act, tg)) return;
  if (await checklist.act(act, tg)) return;
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
    case 'menu': ui.menu = !ui.menu; if (ui.menu) switcher.close(); renderHead(); break;
    case 'select-record': {
      const d = tg.dataset;
      select({ kind: 'record', what: d.what, ...(d.group ? { group: d.group } : {}), ...(d.key ? { key: d.key } : {}), id });
      break;
    }
    case 'help': help.toggle(); break;
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
    case 'use-version': useVersion(tg.closest('.vlist')?.dataset.fact ?? ui.sel.id, tg.dataset.v); break;
    case 'undo': store.undo(); break;
    case 'redo': store.redo(); break;
    case 'fit': runFit(); break;
    case 'view': setPagesMode(ui.layout?.spread ? 'stack' : 'spread'); break;
    case 'actual': dock.closePop(); openActual(); break;
    case 'fullscreen': toggleFullscreen(); break;
    case 'open': ui.menu = false; pickFile(); break;
    case 'link': ui.menu = false; linkFolder(); break;
    case 'unlink': ui.menu = false; await persist.unlink(); renderHead(); toast(t('toast.unlinked')); break;
    case 'reconnect': reconnect(); break;
    case 'save-file': ui.menu = false; saveToFile(); break;
    case 'save-note-ok': ui.saveNote = false; renderHead(); break;
    case 'folder-compare': files.compareFolder(); break;
    case 'folder-overwrite': await persist.overwriteFolder(); renderHead(); break;

    case 'checkpoint': ui.menu = false; await persist.checkpoint(t('checkpoint.named', { date: new Date().toLocaleString() })); toast(t('toast.checkpointSaved')); renderHead(); break;
    case 'example': ui.menu = false; await loadExample(); toast(t('toast.exampleOpen')); break;
  }
}

document.addEventListener('mouseover', e => {
  const row = e.target.closest?.('.vrow[data-v]');
  if (!row || row.classList.contains('cur') || ui.fitting || edit.editing) return;
  if (ui.hoverV === row.dataset.v) return;
  const fact = row.closest('.vlist')?.dataset.fact;
  if (!fact) return;
  ui.hoverV = row.dataset.v;
  previewVersion(fact, row.dataset.v);
});
document.addEventListener('mouseout', e => {
  const list = e.target.closest?.('.vlist');
  if (!list || list.contains(e.relatedTarget) || edit.editing) return;
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
  if (r.format !== shown().format || res.laid?.pages?.length !== ui.laid?.pages?.length){
    ui.preview = { format: r.format };
    const L = ui.layout, a = pageSize(shown().format), b = pageSize(r.format);
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
  if (ui.fitting || !cur() || ui.snap) return;
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
  const typing = e.target.closest?.('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, [contenteditable=true]');
  const mod = e.ctrlKey || e.metaKey;
  if (typing && mod && ['z', 'y'].includes(e.key.toLowerCase())) return;      // the text box's own undo
  if (mod && !e.altKey && e.key.toLowerCase() === 'z'){ e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
  if (mod && e.key.toLowerCase() === 'y'){ e.preventDefault(); store.redo(); return; }
  if (mod && !e.altKey && e.key.toLowerCase() === 's'){ e.preventDefault(); if (!e.isComposing && e.keyCode !== 229) saveToFile(); return; }
  if (mod && e.key.toLowerCase() === 'o'){ e.preventDefault(); switcher.openOrFocus(); return; }
  if (typing) return;
  if (ui.view === 'welcome') return;                    // the introduction and the questions have their own keys
  if (ui.snap && e.key !== 'Escape') return;           // a snapshot is read-only
  if (e.key === 'Escape'){
    if (help.isOpen){ help.close(); return; }
    if (dock.closePop()) return;
    if (switcher.isOpen){ switcher.close({ focusBack: true }); return; }
    if (ui.menu){ ui.menu = false; renderHead(); return; }
    if (ui.langMenu){ ui.langMenu = null; renderHead(); $('#langbtn')?.focus(); return; }
    if (closeBodyMenus()) return;
    if (career.closeTimeline()) return;
    if (edit.key(e)) return;
    if (ui.view){ setView(null); return; }
    if (ui.snap){ setSnap(null); renderAll(); return; }
    if (ui.previewing){ endPreview(); return; }
    // up one level; at the page level, put everything away: the panel folds (even pinned open) and the view zooms out
    const next = up(ui.sel);
    if (next.kind !== 'none'){ select(next); return; }
    if (ui.sel.kind !== 'none') select(NONE);
    dock.allTheWayOut();
    return;
  }
  if (edit.key(e)) return;
  if (e.key === '?' && !mod){ e.preventDefault(); help.toggle(); return; }
  if (e.shiftKey && e.key.toLowerCase() === 'f' && !mod){ e.preventDefault(); toggleFullscreen(); return; }
  if (dock.onKey(e)) return;
  // the arrows walk the page; inside the panel, the timeline or a menu they belong to what has the focus
  if (e.target.closest?.('#col, #timeline, #help, #switcher')) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    const id = step(sheet.order(ui.ix), ui.sel, e.key === 'ArrowDown' ? 1 : -1);
    if (typeof id === 'string'){ e.preventDefault(); const job = ui.ix.highlight.get(id); select(job ? { kind: 'bullet', id, job, section: 'experience' } : { kind: 'bullet', id, section: 'summary' }, { fromPage: true }); }
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
  openActualSize({ work: work(), recipe: structuredClone(shown()), laid: ui.laid, onClose: () => document.body.classList.remove('is-actual') });
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

// Save to file: everything in one file with a fixed name. Desktop downloads it; a touch device opens the
// share sheet when it can. The page never asks for file access. Resolves true once the file was delivered.
let saving = null;
function saveToFile(){ return saving ??= doSaveToFile().finally(() => { saving = null; }); }
async function doSaveToFile(){
  if (!store.state.record) return false;
  try {
    const f = await persist.prepareFile();
    const touch = !matchMedia('(pointer: fine)').matches;
    const file = new File([f.text], f.name, { type: 'application/json' });
    let how = 'download';
    if (touch && navigator.canShare?.({ files: [file] })){
      try { await navigator.share({ files: [file], title: SAVE_FILE_NAME }); how = 'share'; }
      catch (e){ if (e?.name === 'AbortError') return false; how = 'download'; }      // cancelled: do nothing; refused: download
    }
    if (how === 'download') download(f.text, f.name);
    await persist.markFileSaved(f);
    toast(t('save.done', { name: f.name }));
    if (how === 'download' && !touch && !readFlag('rb-save-note')){
      setFlag('rb-save-note');
      ui.saveNote = true;
    }
    renderHead();
    return true;
  } catch (e){ toast(t('toast.exportFailed', { msg: errText(e) }), 'bad'); return false; }
}
function readFlag(k){ try { return localStorage.getItem(k) === '1'; } catch { return false; } }
function setFlag(k){ try { localStorage.setItem(k, '1'); } catch { /* shown again next time */ } }

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
  detailsHtml: id => career.detailsHtml(id),
});
edit.bind($('#body'));
window.__wb.edit = edit;
const resumes = initResumes({
  store, ui, persist, toast, work, NONE, setView, setSnap,
  renderBody: () => renderBody(), renderHead: () => renderHead(),
  leaveOk: () => edit.leaving(NONE),
  endPreview: () => endPreview(),
  previewRecipe,
  noteOpen: id => switcher.noteOpen(id), noteRename: (a, b) => switcher.noteRename(a, b),
  closeSwitcher: () => switcher.close(), renderSwitcher: () => switcher.render(),
  fit: () => runFit(),
});
const switcher = initSwitcher({ store, ui, toast, setView, work, previewRecipe, resumes,
  endPreview: () => endPreview(),
  ensurePanel: () => { if (dock.folded()){ ui.peek = true; dock.sync(); } },
  closeMenus: () => { if (ui.menu || ui.langMenu){ ui.menu = false; ui.langMenu = null; renderHead(); } },
});
switcher.bind();
Object.assign(VIEWS, resumes.views);
const files = initFiles({
  store, ui, persist, toast, NONE, setView, pickFile, download, saveToFile,
  onImage: f => design.setPhoto(f), onThemeText: (t, n) => design.importTheme(t, n), onTheme: (j, n) => design.importTheme(j, n),
  renderBody: () => renderBody(),
});
Object.assign(VIEWS, files.views);
files.bind($('#body'));
window.__wb.files = files;
const exporter = initExport({ store, ui, toast, work, cur: () => shown(), download, renderBody: () => renderBody(),
  extraCss: r => design.extraCss(store.state.record, r) });
const design = initDesign({ store, ui, toast, cur, setView, pickFile, download, photoUrl: () => store.materialize(store.state.record?.basics?.image) });
Object.assign(VIEWS, design.views);
const onboarding = initOnboarding({ store, ui, persist, toast, setView, renderBody: (a) => renderBody(a), restyle: () => restyle() });
Object.assign(VIEWS, onboarding.views);
onboarding.bind($('#body'));
const career = initCareer({ store, ui, toast, work, setView, syncUi: r => syncUi(r), edit, lang, select: s => select(s), renderBody: (a) => renderBody(a), renderTimeline: () => renderTimeline(),
  renderHead: () => renderHead(), photoUrl: () => store.materialize(store.state.record?.basics?.image) });
career.bind($('#body'));
window.__wb.career = career;
const checklist = initChecklist({ store, ui, work, cur, lang, edit, career, select: (s, o) => select(s, { keepScroll: true, ...o }), hoverFact, renderBody: () => renderBody() });
checklist.bind($('#body'));
window.__wb.checklist = checklist;
const help = initHelp({ ui });
window.__wb.help = help;
const dock = initDock({ store, ui, shown, relayout: () => relayout(), setView, goToPage, renderAll: () => renderAll() });
window.__wb.dock = dock;
design.bind($('#body'));
window.__wb.design = design;
Object.assign(VIEWS, exporter.views);
window.__wb.export = exporter;
resumes.bind($('#body'));
window.__wb.resumes = resumes;
window.__wb.switcher = switcher;

const settings = initSettings({ store, ui, toast, setView, renderBody: () => renderBody(), syncUi: r => syncUi(r), setPagesMode: m => setPagesMode(m) });
Object.assign(VIEWS, settings.views);
settings.bind($('#body'));
window.__wb.settings = settings;

window.__booted = true;
boot().catch(e => { console.error(e); toast(t('error.start', { msg: errText(e) }), 'bad'); });
