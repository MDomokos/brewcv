// The Workbench shell: the canvas, the sheet, and one column of three cards. State is in
// src/store/store.js; selection, preview and the page shown are view state, never undone.

import { createStore } from '../store/store.js';
import { askOk } from './ask.js';
import { createPersist, idbBackend, memoryBackend, fsaFolder, tauriApi, tauriFolder, folderOf, readFolder, requestPersistence, SAVE_FILE_NAME } from '../store/persist.js';
import { load, loadResume, LANGS } from '../model/schema.js';
import { chooseVariant, newResume, pickVersion } from '../model/resume.js';
import { LockedError } from '../model/lock.js';
import { groupOf } from '../model/checklist.js';
import { fit, key as measureKeyOf } from '../fit.js';
import { createSheet } from './sheet.js';
import { computeLayout, pageSize, pageInView, pageTop, G, PHONE_MAX, RAIL_W } from './layout.js';
import { initCanvas, PAGES_MOVED } from './canvas.js';
import { initOnPage } from './onpage.js';
import { initHands } from './hands.js';
import { bindDepthMenu } from './depthmenu.js';
import { pageLeft, springStep, atRest } from './camera.js';
import { initDock, storeZoomWrite, ib, barAside } from './dock.js';
import { initChecklist } from './checklist.js';
import { initRecord } from './record.js';
import { initHelp, keyText } from './help.js';
import { initPress, tierAll } from './press.js';
import { initSide, syncSide, side, toggleSide } from './sidewidth.js';
import { initDropdowns } from './dropdown.js';
import { initSuggest } from './suggest.js';
import { initFind, isFindKey, hasFocus as inFind } from './find.js';
import { initReview } from './review.js';
import { icon, withArrows } from './icons.js';
import { indexModel, targetOf, up, same, step, lineSel, keyOf, versionsOf, NONE, isTyping } from './select.js';
import { openActualSize } from './actual.js';
import { initEdit } from './edit.js';
import { initResumes, snapBarText } from './resumes.js';
import { initSwitcher, nameHtml } from './switcher.js';
import { initScreens } from './screens.js';
import { initThumbs } from './thumbs.js';
import { initFiles } from './files.js';
import { initExport } from './export.js';
import { initDesign } from './design.js';
import { initOnboarding } from './onboarding.js';
import { initCareer } from './career.js';
import * as RS from '../model/resumes.js';
import { switchLang, missingList, langName, langsInUse, addLangInUse, removeLang, removableLangs } from '../model/lang.js';
import { langMenuHtml, menuKey, focusMenu } from './langmenu.js';
import { delBtn } from './parts.js';
import { jobTypeLabel } from '../model/focus.js';
import { t, h, errText, uiLang, docChrome, loadCatalogue, setUiLang, setUiLangNow, UI_LANGS } from '../i18n/index.js';
import { initSettings, readPref, browserLang, readGarden } from './settings.js';
import * as motion from './motion.js';
import { reduced, onMotionChange, play, ghost, fly } from './motion.js';
import * as arrive from './arrive.js';
import { initDrink, onDrinkChange, isDrinkKey, toggleDrink, setDrink, setThemePref, themePref, resolveTheme, drink, logoBtn } from './drink.js';
import { initMatRoll } from './matroll.js';

// Where the source is published; the menu links to it (AGPL-3.0, section 13). Change it here when the repo moves.
const SOURCE_URL = 'https://github.com/MDomokos/brewcv';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const params = new URLSearchParams(location.search);
const backend = params.has('memory') ? memoryBackend() : idbBackend();   // ?memory: a clean, throwaway session (checks)
const store = createStore({ record: null, resumes: [], cur: null, openId: null }, { settle: RS.settle });      // autosave of the open resume rides on every commit
// A change the lock refuses, from any path, says why and changes nothing: it never surfaces as an uncaught error.
const rawCommit = store.commit;
store.commit = (fn, label, merge) => {
  const peers = alsoSaid ? null : peersOf();
  try {
    const changed = rawCommit(fn, label, merge);
    if (changed && peers) alsoChanged(peers);
    return changed;
  } catch (e){ if (!(e instanceof LockedError)) throw e; edit.lockSaid([e.id ?? edit.lockIdOf()], e.message); return false; }
};
// The first change that reaches another language of a group says so, once per sitting. The saved copies of the open resume's group, as they are.
let alsoSaid = false;
const peersOf = () => {
  const st = store.state, me = st.cur && RS.savedOf(st, st.openId);
  return me ? RS.groupOf(st, me).filter(r => r.id !== me.id).map(r => [r.id, JSON.stringify(r)]) : [];
};
function alsoChanged(peers){
  const st = store.state, hit = peers.filter(([id, json]) => { const r = RS.savedOf(st, id); return r && JSON.stringify(r) !== json; });
  if (!hit.length) return;
  const names = [...new Set(hit.map(([id]) => langName(RS.savedOf(st, id).lang ?? 'en')))].join(', ');
  // after the change's own message, which stays if there is one: the next change says it then
  setTimeout(() => { if ($('#toast').classList.contains('on')) return; alsoSaid = true; toast(t('ml2.alsoChanged', { lang: names }), '', true); }, 0);
}
const persist = createPersist({ store, backend });
let garden = null, gardenLoading = false;       // the tea garden (src/ui/garden.js), loaded the first time it can run
const sheet = createSheet($('#sheet'), { onPick: pick, onKey: key, onDrop: e => dropFile(e), onPage: p => { ui.page = p; renderFoot(); },
  onReveal: reveal, chrome: r => docChrome(r.lang ?? 'en'),
  onDrawn: () => { onpage?.afterDraw(); hands?.drawn(); find?.refresh(); }, onPointer: e => hands?.pointer(e),
  extraCss: r => design.extraCss(store.state.record, r),
  // the hand, the wheel and the pinch over the page itself go to the canvas
  frameEvents: {
    wheel: (...a) => { garden?.wheel(); return canvas.frameEvents.wheel(...a); }, down: (...a) => { garden?.down(...a); return canvas.frameEvents.down(...a); },
    move: (...a) => { garden?.move(...a); return canvas.frameEvents.move(...a); },
    up: (...a) => canvas.frameEvents.up(...a), gesture: (...a) => canvas.frameEvents.gesture(...a),
    key: { down: e => { garden?.key(e); canvas.frameEvents.key.down(e); }, up: e => canvas.frameEvents.key.up(e) },
  } });

const ui = {
  pref: readPref() ?? { mode: 'follow' }, askLang: !readPref(),
  sel: NONE, previewing: false, page: 0, menu: false, laid: null, fills: [], zoom: 1,
  back: null, fitting: false, lastFit: null, work: null, workKey: null, ix: null, probed: new Set(), snap: null,
};
const canvas = initCanvas({ ui, host: $('#sheet'), box: $('#pages'), sheet, writeZoomChanged: pct => { storeZoomWrite(pct); ui.zoomWrite = pct; }, sheetOver: (on, y) => dock?.sheetOver(on, y), moved: () => { placeOverflow(); onpage?.place(); hands?.place(); barAside(); const z = $('#zoompct'); if (z) z.textContent = `${Math.round((ui.zoom ?? 1) * 100)}%`; }, pageChanged: () => renderFoot(), bareClick: () => bareClick() });
const onpage = initOnPage({ ui, sheet, canvas, edit: () => edit, record: () => record(), cur: () => cur(), work: () => work(), lang: () => lang(), chooseVariant,
  ix: () => ui.ix ?? indexModel(work(), cur()), fillText: () => fillText(), select: sel => select(sel),
  writeStarted: () => { dock.renderFoot(); hands?.refresh(); }, writeEnded: () => { dock.renderFoot(); hands?.refresh(); }, redrawSoon: () => schedule(),
  endHover: () => { ui.hoverV = null; if (ui.previewing) endPreview(); }, previewVersion: (fact, vid) => { ui.hoverV = vid; return previewVersion(fact, vid); } });
const hands = initHands({ ui, sheet, canvas, edit: () => edit, onpage: () => onpage, record: () => record(), cur: () => cur(), ix: () => ui.ix ?? indexModel(work(), cur()), select: sel => select(sel), toast: (m, k) => toast(m, k), undoN: () => store.history.undo,
  jobName: id => (ui.ix ?? indexModel(work(), cur())).work.get(id)?.name ?? id, writingFact: () => onpage.fact(), togglePhoto: () => design.togglePhoto() });
window.__wb = { store, persist, sheet, ui, canvas, onpage, hands, renderOverflow: () => renderOverflow(), setView: v => setView(v), saveToFile: () => saveToFile(), busy: () => timer !== null || drawing > 0 };      // for checks and the console

// The tea garden runs in tea, with its setting on, with motion allowed, off a phone and off the start screen; otherwise it rests.
// ?garden-check[=idle seconds] is for checks/garden-check.mjs: a short idle time and the garden's test hooks on __wb.garden.
function syncGarden(){
  const can = drink() === 'tea' && readGarden() && !reduced() && !ui.layout?.phone && !introNow();
  if (garden) return garden.setOn(can);
  if (!can || gardenLoading) return;
  gardenLoading = true;
  import('./garden.js').then(m => {
    garden = m.initGarden({ ui, canvas, idle: Number(params.get('garden-check')) || 30, check: params.has('garden-check') });
    if (garden.hooks) window.__wb.garden = garden.hooks;
    syncGarden();
  }).catch(() => { gardenLoading = false; });
}

// The no-origin card stays English: when it shows, no module ran.
function staticText(){
  document.documentElement.lang = uiLang();
  $('#sheet').setAttribute('aria-label', t('aria.sheet'));
  $('#body').setAttribute('aria-label', t('ux2.panelLabel'));
  $('#rail').setAttribute('aria-label', t('ux6b.rail'));
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
  initDrink();
  initMatRoll();
  onDrinkChange(() => { sheet.restyle(); renderChip(); syncGarden(); renderHead(); if (ui.view === 'settings') renderBody(); });
  onMotionChange(() => { sheet.restyle(); syncGarden(); });
  // the languages you use load now, so switching between them is instant
  Promise.all(langsInUse(record()).map(l => loadCatalogue(l))).catch(() => {});
  staticText();
  bindChrome();
  dock.bind();
  mountFullBar();
  addEventListener('resize', () => { relayout(); dock.renderFoot(); syncWinFull(); });
  canvas.bind();
  bindDepthMenu();
  document.addEventListener(PAGES_MOVED, () => { renderFoot(); renderChip(); });
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
  // the landing (N8, D4): the address names a place; else one resume opens in the editor, and two or more in the Library, the open resume selected
  if (ui.view !== 'welcome'){
    if (['#resumes', '#compare', '#record'].includes(location.hash)) route();
    else if (location.hash !== '#resume' && (store.state.resumes?.length ?? 0) >= 2) setView('resumes');
    history.replaceState(null, '', hashOf());
  }
  document.body.classList.add('is-ready');
  ui.ready = true;
}

async function loadExample({ quiet = false } = {}){
  const json = await (await fetch('./data/example.json', { cache: 'no-cache' })).json();
  const { model } = load(json);
  const names = await (await fetch('./data/example-resumes/index.json', { cache: 'no-cache' })).json();
  const resumes = [], frozen = {};
  // all at once; the order of `names` is kept
  const files = await Promise.all(names.map(async n => {
    const r = await fetch(`./data/example-resumes/${encodeURIComponent(n)}`, { cache: 'no-cache' });
    // a server that answers a missing file with its own page (Tauri does) must not stop the start
    return r.ok ? r.json().catch(() => null) : null;
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
  const k = JSON.stringify(record()) + JSON.stringify(cur()?.localLines ?? null) + JSON.stringify(cur()?.skillArrangement?.groups?.map(g => g.id) ?? null);       // the index lists a resume's own lines and skill groups
  if (k !== ui.workKey){
    ui.work = store.materialize(record());
    ui.workKey = k;
    ui.ix = indexModel(ui.work, cur());
    ui.probed.clear();
  }
  return ui.work;
}

let seq = 0, timer = null, drawing = 0;
const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { timer = null; redraw(); }, 40); };

let notedId = null;
function onChange({ kind, label }){
  shownKey = null;
  if (chipEl && store.history.undo !== chipAt) dropChip();      // the chip's Undo is for Fit's change only
  if (toastAt !== -1 && store.history.undo !== toastAt) dropToastUndo();      // so is the toast's, for the change it speaks of
  if (store.state.openId && store.state.openId !== notedId){ notedId = store.state.openId; switcher.noteOpen(notedId); }     // the switcher's “recent”
  if (ui.snap && !snapNow()) setSnap(null);
  if (ui.sel.kind !== 'none' && !stillThere(ui.sel)){ ui.sel = NONE; dock.renderFoot(); }
  syncUi();
  if (ui.exampleChip && !isExample()){ ui.exampleChip = false; renderHead(); }
  if (kind === 'undo' || kind === 'redo') hands?.settle();      // a block still landing is there at once: the page is drawn from the model as it is now
  if (kind === 'undo') toast(t('toast.undone', { label }));
  if (kind === 'redo') toast(t('toast.redone', { label }));
  schedule();
}

function stillThere(sel){
  const ix = indexModel(record(), cur());
  if (sel.kind === 'bullet') return ix.facts.has(sel.id) || (sel.id.startsWith('~t:') && ix.owned.has(sel.id.slice(3)));
  if (sel.kind === 'job') return ix.work.has(sel.id);
  if (sel.kind === 'section') return ix.sections.has(sel.id);
  if (sel.kind === 'record' && sel.what === 'entry') return (record().education ?? []).some((e, i) => (e.id ?? `edu-${i}`) === sel.id);
  if (sel.kind === 'record' && sel.what === 'item'){ const m = record(); return (m[sel.group] ?? []).some(x => x?.id === sel.id) || (m.projects ?? []).concat(m.awards ?? []).some(x => x?.id === sel.id); }
  return true;
}

async function redraw(){ drawing++; try { return await drawSheet(); } finally { drawing--; } }
async function drawSheet(){
  const my = ++seq;
  if (!record() || !cur()){ renderAll(); return true; }
  try {
    const shownNow = shown();
    await loadCatalogue(lang());
    const w = work();
    const r = structuredClone(shownNow);
    const mo = ui.morph; ui.morph = null;           // an action that asked for its change to be shown moving (Fit, a lens, a tick, another resume)
    const res = await sheet.show(w, r, mo ? { ...mo, ix: mo.ix ?? ui.ix } : null);
    if (my !== seq) return;
    ui.laid = res.laid; ui.fills = res.pages; ui.previewing = false; ui.previewSwitch = false;
    relayout();
    sheet.select(ui.sel, ui.ix);
    sheet.setFocus(edit.focusHits(), ui.ix);
    sheet.setMissing(missingList(w, r, RS.groupOpts(store.state, r)), ui.ix);
    renderAll();
    renderChip();
    checklist.landed();
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

// The Library (with Compare) and Career are places of their own, drawn left of the sidebar in #scr; everything else is the editor's.
// On a phone they are the whole screen, as they were.
const SCREENS = ['record', 'resumes', 'compare'];
const fullWindow = () => innerWidth < PHONE_MAX && SCREENS.includes(ui.view);
// the layout changes only when the sidebar becomes the whole screen or stops being it (a phone)
const syncFull = () => { if ($('#col').classList.contains('is-full') !== fullWindow()) relayout(); };
function relayout(){
  const c = shown();
  if (!c) return;
  const pages = ui.laid?.pages?.length ?? 1;
  const L = computeLayout({ vw: innerWidth, vh: innerHeight, format: c.format, pages, zoom: 1, wide: fullWindow(), slim: ui.view === 'welcome', oneUp: c.pageLimit === 1, side: side() });
  const host = $('#sheet'), box = $('#pages');
  const col = $('#col');
  Object.assign(col.style, { left: `${L.col.left}px`, top: `${L.col.top}px`, width: `${L.col.width}px`, height: `${L.col.height}px` });
  col.classList.toggle('is-full', fullWindow());
  ui.layout = L;
  syncSide(L);
  layoutScreen();
  document.body.dataset.phone = String(!!L.phone);
  syncGarden();
  if (L.phone){
    // on a phone the pages scroll above the bottom sheet
    Object.assign(box.style, { left: `${L.pages.left}px`, top: `${L.pages.top}px`, width: '', height: '' });
    box.firstElementChild.style.height = `${L.pages.content}px`;
    box.firstElementChild.style.width = '1px';
    host.style.left = `${L.sheet.left - L.pages.left}px`;
    host.style.top = `${L.sheet.top - L.pages.top}px`;
    document.body.style.minHeight = `${L.sheet.height + 16 + L.col.height}px`;
    host.style.transform = `translate(0px, 0px) scale(${L.scale})`;
    sheet.setView({ mode: L.stack ? 'stack' : 'spread', page: 0 });
    document.body.dataset.spread = String(L.spread);
    document.body.dataset.stack = String(!!L.stack);
    document.body.dataset.pages = 'phone';
    if (L.stack) ui.page = pageInView(L, scrollOf(), pages); else ui.page = 0;
    ui.zoom = 1; ui.equal = false;
    sheet.setFade([]);
  } else {
    // the pages are a canvas under the whole window; the sidebar sits on it. The camera places the sheet.
    document.body.style.minHeight = '';
    Object.assign(box.style, { left: '0px', top: '0px', width: `${innerWidth}px`, height: `${innerHeight}px` });
    box.firstElementChild.style.height = '0px';
    box.firstElementChild.style.width = '0px';
    sheet.setView({ mode: 'spread', page: 0 });
    canvas.layout(L, c.format);
    document.body.dataset.spread = String(canvas.scene === 'all');
    document.body.dataset.stack = 'false';
    document.body.dataset.pages = canvas.scene;
    // the zoom bar sits at the foot of the page area, under the page
    const zb = $('#zoombar');
    if (zb){ zb.style.left = `${L.view.mid}px`; }
  }
  // the start screen's picture takes the page area left of the column
  document.body.style.setProperty('--startw', `${Math.max(240, L.col.left - 2 * G)}px`);
  document.body.style.setProperty('--colleft', `${L.col.left}px`);
  document.body.style.setProperty('--colw', `${L.col.width}px`);
  renderFoot();
  renderChip();
  placeRail();
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

function pick({ variant, label = null, section, page = -1, at = null }){
  if (ui.fitting || ui.snap || ui.view === 'welcome' || canvas.handed || hands.justDragged()) return;
  const next = targetOf(ui.ix ?? indexModel(work(), cur()), { variant, label, section });
  // a faded page stays clickable: its blank paper brings it forward, and a line on it is worked on there
  const other = !ui.layout?.phone && page >= 0 && page !== ui.page;
  if (other && next.kind === 'none'){ canvas.goToPage(page); return; }
  // From the page, one click on a line puts the caret in it, where it was clicked (no mode to enter first); while a line is written, a
  // click on another goes on writing there, in the same zoom, whichever job or page it is on. A phone only selects.
  const writes = (next.kind === 'bullet' || next.heading) && !ui.layout?.phone;
  // a job's title and dates: the first click selects the job and shows its lines; once the job is selected, a click on them writes
  const head = edit.headOf(next);
  if (head){
    const s = ui.sel;
    if (!(s.kind === 'job' && s.id === head) && !(s.kind === 'bullet' && (s.job === head || s.owner === head))){ select({ kind: 'job', id: head }); return; }
    edit.openGuard(next.id);
  }
  const go = () => { select(next, { stay: writes }); if (writes && keyOf(ui.sel) === keyOf(next) && !edit.editing){ ui.clickAt = at; edit.startEdit(); } };
  if (other && writes) ui.page = page;      // the page it is on is the bright one once the writing zoom has moved there
  if (ui.writing && writes) onpage.keepView(go); else go();
  if (other && !ui.writing) canvas.goToPage(page);      // a line written there is brought into view by the writing zoom
}
// the page a selection is on (the claim for a bullet, the title for a job), or -1
function pageOfSel(sel){
  const ix = ui.ix ?? indexModel(work(), cur());
  const fact = sel.kind === 'bullet' ? sel.id : sel.kind === 'job' ? ix.work.get(sel.id)?.display?.position : null;
  return fact ? sheet.pageOf(fact, ix) : -1;
}
// a click on the bare canvas (not on a page) puts you at the page level
function bareClick(){ if (ui.view || ui.snap) return; if (ui.sel.kind !== 'none') select(NONE); }
// Going up the same branch leaves a "back" on the page chip for a moment, to the depth just left (never a move into another section or job); any other selection write clears it (the chip's redraw shows it).
const BACK_MS = 2500;
let backT = 0;
function setBack(from, to){
  clearTimeout(backT);
  ui.back = edit.isAbove(to, from) ? { sel: from, until: performance.now() + BACK_MS } : null;
  if (ui.back) backT = setTimeout(() => { ui.back = null; renderChip(); }, BACK_MS);
}
// `keepScroll`: the click was on a row of the job's own lines, where the person is already looking, so the panel stays where it is.
// `stay`: a line clicked on the page, about to be written: the camera stays for the writing zoom to move it.
function select(sel, { keepScroll = false, stay = false } = {}){
  if (!edit.leaving(sel)) return;
  if (sel.kind !== 'none') switcher.close();       // a click on the page never reaches the document, so the name window's outside click does not run
  // a selection made from Record, Design or Export (a row, a form to add something) is looked at in Edit
  const left = ui.view && ui.view !== 'welcome' && sel.kind !== 'none';
  if (left) ui.view = null;
  setBack(ui.sel, sel);
  ui.sel = sel;
  if (ui.previewing){ ui.previewing = false; sheet.endPreview(); }
  sheet.select(sel, ui.ix);
  const was = ui.view;
  const at = ui.layout?.phone ? -1 : pageOfSel(sel);
  if (at >= 0 && at !== ui.page && !stay){ ui.page = at; canvas.goToPage(at); }       // a line on another page, chosen from the panel: that page comes forward
  if (left){ syncFull(); remember(); }         // a selection made in Career is looked at in the editor: the address follows
  dock.renderFoot();
  renderHead();
  // The sidebar opens at its top (the line's versions are what you came for). Only a click on a row of the Outline or the Record,
  // which keeps it where it is, leaves it alone; leaving a view is a new sheet.
  renderBody(!keepScroll || !!was);
  renderChip();
}

// a picture dropped on the editor or on the page asks what it is for; any other file goes through the one door
function dropFile(e){ e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (!f) return; if (/^image\//.test(f.type) && cur() && !ui.layout?.phone && !['welcome', 'record'].includes(ui.view)) design.askPhoto(f); else openFile(f); }

function closeBodyMenus(){ return [resumes, career].some(m => m.closeMenus?.()); }
const hoverFact = id => sheet.setHover(id, ui.ix);

function bindChrome(){
  document.body.addEventListener('click', onClick);
  document.addEventListener('keydown', key);
  $('#file').addEventListener('change', e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) openFile(f); });
  addEventListener('dragover', e => { e.preventDefault(); });
  addEventListener('drop', dropFile);
  new ResizeObserver(placeRail).observe($('#head'));        // the name wraps to more or fewer lines: the tabs follow the editor card
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
const isExample = () => /\(fictional\)/.test(record()?.meta?.owner ?? '');

// Views that replace the body card until ← Back or Esc; null is the Edit view.
const VIEWS = {};
function setView(v){
  if (v && !VIEWS[v]) return;
  const was = ui.view;
  ui.focusKept = false;
  if (SCREENS.includes(was) && !ui.layout?.phone) (ui.scrolled ??= {})[was] = $('#scr').scrollTop;      // each place keeps its scroll (N6)
  ui.view = v;
  find.sync();
  syncIntro();                 // the start screen's areas are the editor's again before they are drawn
  if (ui.previewing) endPreview();
  resumes.reset();
  syncFull();                  // on a phone a place is the whole screen
  dock.renderFoot();
  renderHead();
  renderBody(true);
  renderChip();
  if (SCREENS.includes(v) && !ui.layout?.phone) $('#scr').scrollTop = ui.scrolled?.[v] ?? 0;
  // a place opens with the focus on its tab (the Library: on the selected card); leaving one for the editor puts it on the Editor tab
  if (SCREENS.includes(v) && !SCREENS.includes(was)) (v === 'resumes' && screens.focusSel() || $(`#ptabs [data-p="${placeOf()}"]`) || $('#body [data-act=scr-back]'))?.focus({ preventScroll: true });
  else if (SCREENS.includes(was) && !SCREENS.includes(v) && !ui.focusKept) $(`#ptabs [data-p="${placeOf()}"]`)?.focus({ preventScroll: true });
  remember();
}
// The three places (N1): the Library (and Compare, its mode), the editor (the open resume and everything in its tabs), and Career.
const placeOf = (v = ui.view) => (v === 'resumes' || v === 'compare' ? 'library' : v === 'record' ? 'career' : 'editor');
async function goPlace(p){
  if (p === placeOf() && p !== 'library') return;
  if (ui.writing && !(await edit.cancelEdit())) return;      // a line being written is left first, asking if there is a draft
  if (p === 'career') return dock.setMode('record');
  if (p === 'library') return setView('resumes');
  if (SCREENS.includes(ui.view)) setView(null);
}
// D4: the address follows the place, so the browser's Back and Forward move between places. Ids only, never names.
const hashOf = (v = ui.view) => ({ resumes: '#resumes', compare: '#compare', record: '#record' }[v] ?? '#resume');
let routing = false;
function remember(){ if (!routing && ui.ready && ui.view !== 'welcome' && location.hash !== hashOf()) history.pushState(null, '', hashOf()); }
function route(){
  const v = { '#resumes': 'resumes', '#compare': screens.canCompare() ? 'compare' : 'resumes', '#record': 'record' }[location.hash] ?? null;
  if (ui.view === 'welcome' || (v === null && !SCREENS.includes(ui.view)) || v === ui.view) return;
  routing = true; try { setView(v); } finally { routing = false; }
  if (location.hash !== hashOf()) history.replaceState(null, '', hashOf());
}
addEventListener('popstate', route);
// Esc goes up one level inside a place and never to another: Compare to the grid (the ticks stay); then the selection is cleared
// (a phone's screens are the whole screen: their back button and Esc return to the editor, Compare to the Library)
const leaveView = () => (ui.view === 'compare' ? setView('resumes') : fullWindow() ? setView(null) : ui.view === 'resumes' ? screens.clearSel() : recordTab.clearSel());

// the head is redrawn on every save: the control that had the focus keeps it
const focusKey = el => (el?.id ? `#${el.id}` : el?.dataset?.act ? `[data-act="${el.dataset.act}"]${el.dataset.m ? `[data-m="${el.dataset.m}"]` : ''}${el.dataset.p ? `[data-p="${el.dataset.p}"]` : ''}` : null);
function renderHead(){
  const ae = document.activeElement, kept = ae && ae.closest?.('#head, #rail, #ptabs') ? focusKey(ae) : null;
  drawHead();
  for (const id of ['#head', '#rail', '#ptabs', '#foot']){ const n = $(id); if (n) tierAll(n); }      // styled before the first paint
  if (kept){ const n = $(`#head ${kept}`) ?? $(`#rail ${kept}`) ?? $(`#ptabs ${kept}`); if (n && n !== document.activeElement) n.focus({ preventScroll: true }); }
}
let saidSave = '';
function drawHead(){
  // on the start screen the header area is the logo, the name and the tagline
  if (document.body.classList.contains('is-intro')){ $('#head').innerHTML = onboarding.headHtml(); $('#rail').innerHTML = ''; $('#ptabs').hidden = true; return; }
  const r = shown();
  const st = persist.status;
  const saving = st.status === 'saving' || st.status === 'pending';
  const saveText = st.status === 'error' ? t('ux1.saveFailed') : saving ? t('head.saving') : t('ux1.savedDevice');
  // the head is drawn afresh, so a live region inside it is unreliable: say the end of a save through #announce
  if (saveText !== saidSave){ if (saidSave && !saving && $('#announce')) $('#announce').textContent = saveText; saidSave = saveText; }
  // Saved is an icon: a check (saved), a turning arrow (saving), a triangle (not saved); the words are in its tip and for a screen reader
  const saved = `<span class="si ${st.status === 'error' ? 'bad' : saving ? 'wait' : 'ok'}" aria-hidden="true">${icon(st.status === 'error' ? 'warn' : saving ? 'saving' : 'check', { role: 'control' })}</span><span class="sr">${esc(saveText)}${st.status === 'error' && st.error ? ': ' + esc(st.error) : ''}</span>`;
  const snap = snapNow();
  const file = fileLine();
  const sent = sentLine(), from = fromLine();
  const notices = `${ui.exampleChip && isExample() ? `<div class="hrow notice examplechip" role="status"><span class="small" title="${esc(t('toast.thisIsExample'))}">${esc(t('ux3b.exampleChip'))}</span><button class="ghost sm" data-act="example-ok" aria-label="${esc(t('body.close'))}">${icon('close', { role: 'inline' })}</button></div>` : ''}
    ${st.code === 'folder-changed' ? `<div class="hrow notice" role="alert"><span class="small">${esc(st.error)}</span><span class="btns"><button class="sm" data-act="folder-compare">${h('save.folderCompare')}</button><button class="sm" data-act="folder-overwrite">${h('save.folderOverwrite')}</button></span></div>` : ''}
    ${ui.saveNote ? `<div class="hrow notice" role="status"><span class="small">${esc(t('save.note'))}${ui.persisted === false ? ' ' + esc(t('save.noteStorage')) : ''}</span><button class="sm" data-act="save-note-ok">${h('save.noteOk')}</button></div>` : ''}
    ${snap ? `<div class="hrow notice snapbar" role="status"><span>${esc(snapBarText(snap))}</span><button class="sm" data-act="snap-close">${withArrows(h('ux1.backToResume'))}</button></div>` : ''}
    ${ui.reconnect ? `<div class="hrow notice"><span class="small">${h('head.reconnectNote', { name: ui.reconnect.name })}</span><button class="sm" data-act="reconnect">${h('head.reconnect')}</button></div>` : ''}`;
  const savedState = `<span class="savestate ${st.status === 'error' ? 'bad' : 'muted'}" id="savestate" tabindex="0" data-tip="${esc(savedTip())}" data-tip-pos="b">${saved}${st.linked ? `<span class="sr"> · ${esc(t('head.linkedFolder'))}: ${esc(st.linked)}</span>` : ''}</span>`;
  const mode = dock.modeOf();
  const tab = (m, key) => `<button role="tab" id="tab-${m}" data-act="mode" data-m="${m}" aria-selected="${mode === m}" aria-controls="body" tabindex="${mode === m || (m === 'edit' && !['edit', 'record', 'design', 'export'].includes(mode)) ? 0 : -1}" ${(m === 'design' || m === 'record') && ui.snap ? 'disabled' : ''}>${h(key)}</button>`;
  if (!ui.layout?.phone){
    const menuBtn = `<button class="ib" data-act="menu" aria-haspopup="true" aria-expanded="${!!ui.menu}" data-tip="${esc(t('head.menuTitle'))}|" aria-label="${esc(t('head.menuTitle'))}">${icon('more')}</button>`;
    if (SCREENS.includes(ui.view)){
      // the place card under the tabs: the counts and the action of the place (the tab names it); the app menu stays in its corner
      $('#head').innerHTML = `${screens.placeCard(ui.view, recordTab.summary())}<div class="pcorner">${menuBtn}</div>${notices}${ui.menu ? menuHtml() : ''}`;
      $('#head').classList.add('is-place');
    } else {
      // the name card: the resume's name (never cut: it wraps) and the app menu. Saved, undo and redo are the seam's; Fit is Export's.
      $('#head').classList.remove('is-place');
      $('#head').innerHTML = `
    <div class="hrow top">
      <button class="docname" id="docname-btn" data-act="switcher" aria-haspopup="dialog" aria-expanded="${switcher.isOpen}" aria-controls="switcher" title="${esc(t('head.docTitle'))}"><span class="dn" id="docname">${nameHtml(resumeName(cur()))}</span><span class="car" aria-hidden="true">${icon('caret', { role: 'inline' })}</span></button>
      <div class="hside"><div class="hsidetop">${menuBtn}</div></div>
    </div>
    ${from ? `<div class="hrow sentrow"><span class="dfrom">${esc(from)}</span></div>` : ''}
    ${sent ? `<div class="hrow sentrow"><span class="dsent">${esc(sent)}</span></div>` : ''}
    ${notices}
    ${ui.menu ? menuHtml() : ''}`;
    }
    drawRail(mode, savedState);
  } else {
  $('#ptabs').hidden = true;
  const meta = r ? [jobTypeLabel(store.state.record, r.jobType), r.format === 'us-letter' ? t('paper.letter') : t('paper.a4'),
    r.pageLimit === 0 ? t('head.anyLength') : r.pageLimit ? t('head.pages', { n: r.pageLimit }) : null].filter(Boolean).join(' · ') : '';
  const savebtn = `<button class="sm filebtn ${file.stale ? 'stale' : ''}" data-act="save-file" id="filestate" title="${esc(t('save.title', { name: SAVE_FILE_NAME }) + ' · ' + file.text)}">${h('ux3b.saveFile')}<span class="sr"> · ${esc(file.text)}</span></button>`;
  $('#head').innerHTML = `
    <div class="hrow top">
      ${logoBtn(28)}
      <button class="docname" id="docname-btn" data-act="switcher" aria-haspopup="dialog" aria-expanded="${switcher.isOpen}" title="${esc(t('head.docTitle'))}"><span class="dn" id="docname">${esc(resumeName(cur()))}<span aria-hidden="true"> ${icon('caret', { role: 'inline' })}</span></span><span class="dt">${esc(meta)}</span>${from ? `<span class="dfrom">${esc(from)}</span>` : ''}${sent ? `<span class="dsent">${esc(sent)}</span>` : ''}</button>
      ${r ? langButton(r) : ''}
      ${savedState}
      ${savebtn}
      <button class="tool" data-act="menu" aria-haspopup="true" aria-expanded="${ui.menu}" title="${esc(t('head.menuTitle'))}" aria-label="${esc(t('head.menuTitle'))}">${icon('more')}</button>
    </div>
    <div class="hrow modes">
      <div class="seg" role="tablist" aria-label="${esc(t('ux2.modes'))}">${tab('edit', 'ux2.modeEdit')}${tab('record', 'ux3b.modeRecord')}${tab('design', 'ux2.modeDesign')}${tab('export', 'ux2.modeExport')}</div>
    </div>
    ${notices}
    ${ui.menu ? menuHtml() : ''}`;
  $('#rail').innerHTML = ''; $('#corner').innerHTML = '';
  }
  headMoments(sent);
}

// ---- the rail (a desktop): the logo, the editor's tabs, the other screens, undo and redo. Three containers: the tabs touch the editor card,
// the screens are dashed and icon only, undo and redo sit at the foot. ----
function drawRail(mode, saved = ''){
  const hs = store.history, tea = drink() === 'tea', editor = placeOf() === 'editor';
  const tab = (m, key, ic) => `<button role="tab" class="tab" id="tab-${m}" data-act="mode" data-m="${m}" aria-selected="${mode === m}" aria-controls="body" tabindex="${mode === m || (m === 'edit' && !['edit', 'design', 'export'].includes(mode)) ? 0 : -1}" ${m === 'design' && ui.snap ? 'disabled' : ''}><span class="ti">${icon(tea ? ic[1] : ic[0], { role: 'header' })}</span><span class="tl">${h(key)}</span></button>`;
  // the seam: undo, redo and Saved in one card at the top, the same on every place; Edit, Design and Export joined to the panel in the editor only; the logo at the foot
  $('#rail').innerHTML = `${logoBtn(30, { base: 'logo', pos: 'l' })}
    ${editor ? `<div class="rtabs" id="rtabs" role="tablist" aria-orientation="vertical" aria-label="${esc(t('ux2.modes'))}" data-tea="${esc(dock.teaNow())}">${tab('edit', 'ux2.modeEdit', ['edit', 'steep'])}${tab('design', 'ux2.modeDesign', ['design', 'latte'])}${tab('export', 'ux2.modeExport', ['export', 'cupout'])}</div>` : ''}
    <div class="rhist" role="group" aria-label="${esc(t('ux6b.history'))}">
      <span class="rsaved">${saved}</span>
      ${ib('undo', 'undo', t('foot.undo'), hs.next ? t('foot.undoWhat', { what: hs.next, n: hs.undo }) : t('foot.undoN', { n: hs.undo }), hs.undo ? '' : 'disabled', 'l')}
      ${ib('redo', 'redo', t('foot.redo'), hs.nextRedo ? t('foot.redoWhat', { what: hs.nextRedo }) : t('foot.redo'), hs.redo ? '' : 'disabled', 'l')}
    </div>
    ${ib('side-fold', side().off ? 'left' : 'right', t(side().off ? 'uxs.sideShow' : 'uxs.sideHide'), keyText('Ctrl', '\\'), `aria-expanded="${!side().off}" aria-controls="body"`, 'l')}`;
  $('#corner').innerHTML = cornerHtml();
  drawPlaces();
  placeRail();
}
// The place tabs on top of the right column: Library, Editor (the pencil) and Career, in this order, each a button with its key in the tip.
function drawPlaces(){
  const pt = $('#ptabs'), here = placeOf(), on = RS.savedOf(store.state, store.state.openId);
  const tea = drink() === 'tea';      // the places that show a rail tab's idea draw that tab's drawing in this drink (steep / edit, recordbook / timeline)
  const P = [['library', 'list', t('ux6h.placeLibrary'), 'W'], ['editor', tea ? 'steep' : 'edit', t('ux6h.placeEditor'), 'E', on && t('ux6h.editorOpen', { name: resumeName(on) })], ['career', tea ? 'recordbook' : 'timeline', t('ux6h.placeCareer'), 'R']];
  pt.hidden = false;
  pt.setAttribute('aria-label', t('ux6h.places'));
  pt.style.setProperty('--ti', String(P.findIndex(x => x[0] === here)));      // Coffee's sliding thumb
  pt.innerHTML = P.map(([k, ic, name, key, tip]) => `<button class="ptab" data-act="place" data-p="${k}" ${here === k ? 'aria-current="page"' : ''} data-tip="${esc(tip || name)}|${esc(t('ux6h.key', { key }))}" data-tip-pos="b" aria-label="${esc(name)}">${icon(ic, { role: 'control' })}<span>${esc(name)}</span></button>`).join('');
}
// The tabs hang off the editor card: the first starts 30px below its top, whatever the name card's height. Not while the name window
// has the card's place (the body is not there to measure).
function placeRail(){
  const body = $('#body');
  if (!body || !body.offsetParent || ui.layout?.phone) return;
  $('#rail').style.setProperty('--tt', `${body.offsetTop + 30}px`);
}

// #scr holds the Library and Career: from the left gutter to the seam, the sidebar's height
function layoutScreen(){
  const L = ui.layout, scr = $('#scr');
  if (!L || L.phone || scr.hidden) return;
  Object.assign(scr.style, { left: `${G}px`, top: `${G}px`, height: `${innerHeight - 2 * G}px`, width: `${Math.max(0, L.col.left - RAIL_W - 2 * G)}px` });
}

// Tea: the place tags hang on threads and swing when the pointer brushes past them, as the folded Tea tags did on main (dock.js swingTags):
// the sideways movement near a tag pushes it, its neighbour gets a share, and a critically damped spring brings each back (no wiggle).
// Nothing moves under reduced motion or in Coffee; the loop runs only while a tag moves. Decoration: a click never waits for it.
const SWG = { s: [], raf: 0, last: 0, px: null, A: 0.9, omega: 6.64 / 0.75 };      // about a degree for one 60px brush (a sweep across all three adds up to about 3), settled in 0.75s
function swingFrame(now){
  SWG.raf = 0;
  const tabs = document.querySelectorAll('#ptabs .ptab'), dt = Math.min(.05, (now - SWG.last) / 1000); SWG.last = now;
  let live = false;
  SWG.s.forEach((s, i) => {
    if (!s) return;
    const n = springStep(s, 0, dt, { omega: SWG.omega * (1 - .12 * i), bounce: 0 });
    SWG.s[i] = atRest(n, 0, .03) ? { x: 0, v: 0 } : n;
    if (SWG.s[i].x || SWG.s[i].v) live = true;
    if (tabs[i]) tabs[i].style.rotate = SWG.s[i].x ? `${SWG.s[i].x.toFixed(3)}deg` : '';
  });
  if (live) SWG.raf = requestAnimationFrame(swingFrame);
}
function swingPlaces(e){
  const px = SWG.px; SWG.px = e.clientX;
  if (px === null || drink() !== 'tea' || reduced() || ui.layout?.phone) return;
  const dx = Math.max(-45, Math.min(45, e.clientX - px)); if (!dx) return;
  const tabs = [...document.querySelectorAll('#ptabs:not([hidden]) .ptab')];
  const at = tabs.findIndex(x => { const r = x.getBoundingClientRect(); return e.clientX > r.left - 10 && e.clientX < r.right + 10 && e.clientY > r.top - 14 && e.clientY < r.bottom + 6; });
  if (at < 0) return;
  tabs.forEach((x, i) => {
    if (Math.abs(i - at) > 1) return;
    const s = SWG.s[i] ??= { x: 0, v: 0 }, k = -dx / 60 * (i === at ? 1 : .45) * Math.E, cap = 1.4 * SWG.A * SWG.omega * Math.E;
    s.v = Math.max(-cap, Math.min(cap, s.v + k * SWG.A * SWG.omega));
  });
  if (!SWG.raf){ SWG.last = performance.now(); SWG.raf = requestAnimationFrame(swingFrame); }
}
document.addEventListener('pointermove', swingPlaces, { passive: true });

// "Saved on this device", and under it where the file stands
const savedTip = () => {
  const st = persist.status, saving = st.status === 'saving' || st.status === 'pending';
  return `${st.status === 'error' ? t('ux1.saveFailed') : saving ? t('head.saving') : t('ux1.savedDevice')}|${fileLine().text}`;
};

// "from <parent>": a copy says what it was made from, under its name
function fromLine(){
  const r = RS.savedOf(store.state, store.state.openId), p = r && !ui.snap ? RS.parentOf(store.state, r) : null;
  return p ? t('ux6f.from', { name: RS.resumeLabel(p) }) : '';
}
// "Sent to Company - Role · 2026-10-11": the open resume's latest send, under its name (none until it has been sent)
function sentLine(){
  const r = RS.savedOf(store.state, store.state.openId), snap = r && !ui.snap ? RS.snapshotsOf(r).at(-1) : null, send = snap?.sends.at(-1);
  return send && RS.sendLabel(send) ? `${t('ux1.sentTo2', { to: RS.sendLabel(send) })} · ${send.date || snap.at.slice(0, 10)}` : '';
}

// ---- moments in the header (UX-4) ----
// Another resume was opened: its name slides in. A snapshot was taken: a small copy of the page drops into the name, and the "Sent to"
// line appears under it. All of it after the fact: the head already says the new thing.
let namedId;
function headMoments(sent){
  const id = store.state.openId, dn = $('#docname');
  if (dn && namedId !== undefined && id !== namedId) play(dn, [{ opacity: 0.2, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { key: 'name', name: 'switch:name' });
  if (dn || namedId === undefined) namedId = id;      // in the Library or Career there is no name card: the new name slides in when the editor shows it
  if (ui.sentEnter && sent){
    ui.sentEnter = false;
    play($('#head .dsent'), [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { key: 'sent', name: 'snapshot:line', delay: 160, fill: 'backwards' });
  }
}
function snapshotTaken(){
  ui.sentEnter = true;
  const box = ui.layout?.phone ? null : sheet.pageBoxes()[ui.page], to = $('#docname-btn')?.getBoundingClientRect();
  if (!box || !to) return;
  const from = canvas.screenRect(box);
  const g = ghost(from, '<i></i><i></i><i></i><i></i><i></i>', 'mo-ghost mo-mini');
  fly(g, from, { left: to.left + 6, top: to.top + 2, width: 22, height: 31 }, { key: 'snapshot', ms: 'slow', name: 'snapshot:drop' });
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
  if (b){ const sr = b.querySelector('.sr'); if (sr) sr.textContent = ` · ${l.text}`; b.classList.toggle('stale', l.stale); b.title = `${t('save.title', { name: SAVE_FILE_NAME })} · ${l.text}`; }
  const f = $('#fileline'); if (f) f.textContent = l.text;
  const sv = $('#savestate'); if (sv) sv.dataset.tip = savedTip();
}
setInterval(refreshFileLine, 30000);

function langButton(r){
  const L = r.lang ?? 'en';
  const n = missingList(work(), r, RS.groupOpts(store.state, r)).length;
  const inUse = langsInUse(record());
  const open = ui.langMenu === 'resume';
  return `<span class="langs lang-menu"><button class="sm langbtn ${inUse.includes(L) ? '' : 'off'}" id="langbtn" data-act="lang-menu" aria-haspopup="menu" aria-expanded="${open}" aria-label="${esc(t('head.langGroup'))}: ${esc(langName(L))}${n ? esc(t('head.langMissing', { n })) : ''}" ${ui.snap ? 'disabled' : ''} title="${esc(langName(L))}${n ? esc(t('head.langMissing', { n })) : ''}">${esc(L.toUpperCase())} ${icon('caret', { role: 'inline' })}${n ? `<span class="badge">${n}</span>` : ''}</button>
    ${open ? langMenuHtml({ for: 'resume', current: L, inUse, more: ui.langMore, label: t('head.langGroup'),
      count: l => (ui.langCounts?.[l] ?? null), removable: removableLangs(store.state) }) : ''}</span>`;
}
// how many texts each language lacks, were the open resume in it (English has none, unless the resume is in a group)
function langCounts(inUse){
  const g = RS.groupOpts(store.state, cur());
  return Object.fromEntries(inUse.map(l => [l, l === 'en' && !g.inGroup ? 0 : missingList(work(), { ...cur(), lang: l }, g).length]));
}
async function openLangMenu(){
  if (ui.langMenu === 'resume'){ ui.langMenu = null; renderHead(); return; }
  switcher.close();
  ui.menu = false; ui.langMenu = 'resume'; ui.langMore = false;
  const inUse = langsInUse(record());
  await Promise.all(inUse.map(l => loadCatalogue(l)));
  ui.langCounts = langCounts(inUse);
  renderHead();
  focusMenu('.langpop');
}
async function useLanguage(to, { add = false } = {}){
  ui.langMenu = null;
  switcher.close({ focusBack: true });
  if (to === lang() && !add){ renderHead(); return; }
  ui.sel = NONE;
  await loadCatalogue(to);
  store.commit(d => { if (add) addLangInUse(d.record, to); switchLang(d.cur, to, d.record); }, add ? t('undo.addLanguage', { lang: langName(to) }) : t('undo.language', { lang: langName(to) }));
  const n = missingList(work(), cur(), RS.groupOpts(store.state, cur())).length;
  toast(t('toast.langNow', { lang: langName(to) }) + (n ? ' ' + t('toast.langMissing', { n, lang: langName(to) }) : ''));
}

// The inverse of adding a language: it leaves the list when no resume and no version uses it, and says why when one does
function removeLanguage(l){
  ui.langMenu = null;
  switcher.close({ focusBack: true });
  try {
    store.commit(d => { removeLang(d, l); }, t('ux6c.undoRemoveLang', { lang: langName(l) }));
    toast(t('ux6c.langRemoved', { lang: langName(l) }), '', true);
  } catch (e){ toast(errText(e), 'warn'); }
  renderHead();
}

// The name window's language: the languages in use (with how many texts each lacks), then the others to add. Chosen from a list, as a
// phone's button opens a menu.
const langNote = l => { const n = ui.langCounts?.[l]; return n == null ? '' : ` · ${n ? t('lang.toWrite', { n }) : t('lang.complete')}`; };
function langSelect(){
  const L = cur()?.lang ?? 'en', inUse = langsInUse(record()), used = inUse.includes(L) ? inUse : [...inUse, L], others = LANGS.filter(l => !used.includes(l)), gone = removableLangs(store.state);
  return `<select id="sw-lang" class="sw-q" ${ui.snap ? 'disabled' : ''}>${used.map(l => `<option value="${l}" lang="${l}" ${l === L ? 'selected' : ''}>${esc(langName(l) + langNote(l))}</option>`).join('')}${others.length ? `<optgroup label="${esc(t('lang.add'))}">${others.map(l => `<option value="+${l}" lang="${l}">+ ${esc(langName(l))}</option>`).join('')}</optgroup>` : ''}${gone.length ? `<optgroup label="${esc(t('ux6c.removeLangHead'))}">${gone.map(({ lang: l, why }) => `<option value="-${l}" lang="${l}" ${why ? 'disabled' : ''}>− ${esc(langName(l))}${why ? ` · ${esc(t(why))}` : ''}</option>`).join('')}</optgroup>` : ''}</select>`;
}
async function loadLangCounts(){
  const inUse = langsInUse(record());
  await Promise.all(inUse.map(l => loadCatalogue(l)));
  ui.langCounts = langCounts(inUse);
  const sel = $('#sw-lang');
  if (sel && document.activeElement !== (sel._dd ?? sel)) sel.outerHTML = langSelect();
}

// The "?" corner (round 2): help and info at the sidebar's foot, out of the Outline's way: the shortcuts, privacy, the source, the version.
// A desktop draws it in #corner over the panel's bottom right (the panel keeps a row free under its content); a phone in the foot (dock.js).
function cornerHtml(){
  const open = !!ui.corner;
  return `<span class="corner">${open ? `<div class="menu card cornermenu" role="menu" aria-label="${esc(t('uxr.help'))}">
    <button role="menuitem" data-act="help">${h('ux2.shortcuts')}</button>
    <a role="menuitem" href="${SOURCE_URL}/blob/main/docs/PRIVACY.md" target="_blank" rel="noopener">${h('priv.link')}</a>
    <a role="menuitem" href="${SOURCE_URL}" target="_blank" rel="noopener">${h('src.link')}</a>
    <button role="menuitem" data-act="goto" data-v="settings">${h('uxs.about')} <span class="muted">${settings.versionHtml()}</span></button>
  </div>` : ''}${ib('corner', 'help', t('uxr.help'), '', `aria-haspopup="true" aria-expanded="${open}"`, 'l')}</span>`;
}
const drawCorner = () => { if (ui.layout?.phone){ $('#corner').innerHTML = ''; renderFoot(); } else $('#corner').innerHTML = cornerHtml(); };
const closeCorner = () => { if (!ui.corner) return false; ui.corner = false; drawCorner(); return true; };

function menuHtml(){
  const linked = persist.status.linked;
  return `<div class="menu card" role="menu">
    <button role="menuitem" data-act="goto" data-v="import">${h('menu.open')}</button>
    <button role="menuitem" data-act="${linked ? 'unlink' : 'link'}" ${'showDirectoryPicker' in window || tauriApi() || linked ? '' : `disabled title="${esc(t('menu.linkNeeds'))}"`}>${linked ? h('menu.unlink', { name: linked }) : h('menu.link')}</button>
    <button role="menuitem" data-act="goto" data-v="history">${h('menu.history')}</button>
    <hr>
    <button role="menuitem" data-act="goto" data-v="settings">${h('menu.settings')}</button>
    <hr>
    <button role="menuitem" data-act="example">${h('menu.example')}</button>
    <hr>
    ${delBtn('data-act="start-over"', t('menu.startOver'), { row: true })}
  </div>`;
}

const introNow = () => ui.view === 'welcome' && ['welcome', 'lang'].includes(onboarding.step);
let wasIntro = null, wasQuiet = null;
function syncIntro(){
  const welcome = ui.view === 'welcome';
  // the start screen (and the language question that follows a choice on it) is laid out in the editor's own areas
  const intro = introNow();
  document.body.classList.toggle('is-intro', intro);
  onboarding.stage(intro);
  syncGarden();
  // onboarding from scratch is a quiet editor: the page and the question panel, nothing else
  const quiet = welcome && !['welcome', 'lang'].includes(onboarding.step);
  document.body.classList.toggle('is-quiet', quiet);
  // leaving the start screen for the editor, or the quiet editor for the whole one: the change is shown moving (src/ui/arrive.js)
  const left = wasIntro === true && !intro && !quiet, opened = wasQuiet === true && !quiet && !intro;
  wasIntro = intro; wasQuiet = quiet;
  if (left) requestAnimationFrame(() => arrive.fromStart({ sheet }));
  else if (opened) requestAnimationFrame(() => arrive.fromQuiet());
}
function renderBody(animate = false){
  syncIntro();
  let el = $('#body');
  if (!record() || !cur()){ el.innerHTML = `<p class="muted">${h('body.loading')}</p>`; return; }
  // the Library and Career are drawn in #scr, left of the sidebar, and their inspector (the selected resume or entry) in the sidebar's body; a phone draws them in the body
  const there = SCREENS.includes(ui.view) && !ui.layout?.phone, scr = $('#scr');
  document.body.classList.toggle('has-scr', there);
  scr.hidden = !there;
  if (there){ $('#body').dataset.view = $('#body').dataset.mode = 'inspector'; el = scr; layoutScreen(); }
  else if (scr.innerHTML) scr.innerHTML = '';
  const s = ui.sel, before = el.dataset.view;
  const keep = el.scrollTop, keepSide = there ? $('#body').scrollTop : 0;
  // a record form with something typed in it is not redrawn under the caret; one you have left or not changed is, and the focus stays where it was
  // (a place's inspector is in the sidebar's body: the focus may be there)
  const ae = document.activeElement, fh = there && $('#body').contains(ae) ? $('#body') : el;
  const typing = !animate && fh.contains(ae) && ae.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea') && !!ae.closest('[data-form]');
  if (typing && ae.value !== ae.defaultValue) return;
  const had = typing && ae.id ? { id: ae.id, start: ae.selectionStart, end: ae.selectionEnd } : null;
  // a tick or a switch redraws the panel; the control that had the focus keeps it: found by what it is, else by its place
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  const q = v => String(v).replace(/["\\]/g, '\\$&');
  const keyOf = e => {
    const d = e.dataset ?? {};
    if (e.id) return `#${CSS.escape(e.id)}`;
    for (const k of ['on', 'item', 'secon', 'jobon', 'same', 'cmp']) if (d[k] !== undefined) return `input[data-${k}="${q(d[k])}"]`;
    if (d.act) return `[data-act="${q(d.act)}"]${d.id ? `[data-id="${q(d.id)}"]` : ''}${d.g ? `[data-g="${q(d.g)}"]` : ''}${d.v ? `[data-v="${q(d.v)}"]` : ''}${d.sel ? `[data-sel="${q(d.sel)}"]` : ''}`;
    return null;
  };
  const tabs0 = !animate && !had && ae && ae !== fh && fh.contains(ae) ? [...fh.querySelectorAll(FOCUSABLE)] : null;
  const at0 = tabs0 ? tabs0.indexOf(ae) : -1, key0 = tabs0 ? keyOf(ae) : null;
  if (ui.snap && !ui.view && !snapNow()) ui.snap = null;
  const finish = () => {
    tierAll(el); if (there) tierAll($('#body'));      // styled before the first paint, so no button fades its shadow in
    // a step between two lines of one kind of panel does not animate; a new kind of panel fades in once (opacity only)
    el.classList.remove('anim-in');
    if (animate && el.dataset.view !== before){ void el.offsetWidth; el.classList.add('anim-in'); }
    if (animate) el.scrollTop = 0; else el.scrollTop = keep;
    if (there) $('#body').scrollTop = animate ? 0 : keepSide;
    if (had){ const n = document.getElementById(had.id); if (n && n !== document.activeElement){ n.focus(); try { n.setSelectionRange(had.start, had.end); } catch { /* not a text box */ } } }
    else if (at0 >= 0){
      const now = [...fh.querySelectorAll(FOCUSABLE)];
      const to = (key0 && fh.querySelector(key0)) || (now.length === tabs0.length ? now[at0] : null);
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
    if (ui.view === 'record') recordTab.afterRender();
    screens.after[ui.view]?.();
    finish();
    if (ui.view === 'record') recordTab.refocus();
    if (ui.view === 'export' && !ui.layout?.phone) el.querySelector('.exstat')?.insertAdjacentHTML('beforeend', `<div class="exfit"><span class="fitslot">${dock.fitHtml()}</span>${dock.barsHtml()}</div>`);      // Fit and the page fill live in Export, once: at the end of the status row
    return;
  }
  // Edit is whatever is selected: nothing selected is the Outline, a job is its lines, a line its versions (a phone has no Outline: its
  // Edit says how to pick a line)
  const outline = s.kind === 'none' && !ui.layout?.phone;
  const main = outline ? edit.outlineView() : s.kind === 'bullet' && s.section === 'skills' ? edit.sectionView({ kind: 'section', id: 'skills' }, s) : s.kind === 'bullet' ? edit.bulletView(s) : s.kind === 'job' ? edit.jobView(s, { details: false }) + checklist.outlineHtml(s.id) : s.kind === 'section' ? edit.sectionView(s)
    : ['header', 'record', 'add', 'kind'].includes(s.kind) ? career.panel(s) : edit.noneView();
  el.innerHTML = main + jobTail(s) + (s.kind === 'none' ? `<p class="muted tiny privacy">${h('body.privacy')}</p>` : '');
  el.dataset.mode = outline ? 'outline' : 'edit';
  el.dataset.view = outline ? 'outline' : s.kind;
  el.dataset.editing = edit.editing ? edit.editing.mode : '';
  finish();
  edit.afterRender();
  checklist.afterRender();
}

// Under a job or a line of one: its details, and the way to the rest of the record. Under anything else that
// belongs to a group (About you, a skill, an education line), only the way into the record.
function jobTail(s){
  if (!['job', 'bullet', 'record'].includes(s.kind)) return '';
  const g = groupOf(work(), s);
  if (!g) return '';
  const w = ui.ix?.work.get(g);
  const link = `<p class="allrec"><button class="sm ghost" data-act="open-record" data-g="${esc(g)}">${withArrows(h('ux3b.allRecord'))}</button></p>`;
  return (w ? career.detailsHtml(g) : '') + link;
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
const renderFoot = () => { dock.renderFoot(); renderOverflow(); };

// A page that overflows shows a dashed line at the bottom margin, and the lines below it faded. Drawn over the page in the app's
// own layer, never in the page: what prints is untouched.
let ovBoxes = [];
function renderOverflow(){
  const el = $('#ovlay');
  if (!el) return;
  ovBoxes = [];
  if (!ui.layout?.phone && !ui.preview && ui.view !== 'welcome'){
    const boxes = sheet.pageBoxes();
    (ui.fills ?? []).forEach((p, i) => { if (p.overflow > 0 && boxes[i]) ovBoxes.push({ ...boxes[i], extra: p.overflow }); });
  }
  if (el.children.length !== ovBoxes.length) el.innerHTML = ovBoxes.map(() => '<div class="ov"><i class="ov-veil"></i><i class="ov-line"></i></div>').join('');
  placeOverflow();
}
function placeOverflow(){
  const el = $('#ovlay');
  ovBoxes.forEach((b, i) => {
    const o = el?.children[i];
    if (!o) return;
    const r = canvas.screenRect({ left: b.left, top: b.limit, width: b.width, height: b.top + b.height - b.limit + b.extra });
    Object.assign(o.style, { left: `${r.left.toFixed(1)}px`, top: `${r.top.toFixed(1)}px`, width: `${r.width.toFixed(1)}px`, height: `${r.height.toFixed(1)}px` });
  });
}

// The layers over the page (the job's frame, the breadcrumb that says which job and how many of its lines are on, the tools) are
// src/ui/onpage.js's; the shell only says when to draw them again
function renderChip(){ onpage?.render(); hands?.refresh(); }
// a meter was clicked: bring that page into view (stacked pages on a phone scroll; on a desktop the camera travels)
function goToPage(i){
  const L = ui.layout, n = ui.fills.length || 1;
  if (L && !L.phone){ canvas.goToPage(i); renderFoot(); return; }
  ui.page = Math.max(0, Math.min(n - 1, i));
  if (L?.stack) scrollPagesTo(pageTop(L, ui.page));
  renderFoot();
}

async function onClick(e){
  const tg = e.target.closest('[data-act]');
  if (ui.menu && !e.target.closest('.menu') && tg?.dataset.act !== 'menu'){ ui.menu = false; renderHead(); }
  if (ui.corner && tg?.dataset.act !== 'corner' && !(e.target.closest('.cornermenu') && !e.target.closest('a'))) setTimeout(closeCorner);      // a link opens its tab first
  if (ui.langMenu && !e.target.closest('.langpop') && tg?.dataset.act !== 'lang-menu'){ ui.langMenu = null; renderHead(); }
  if (!e.target.closest('.langpop, .rowmenu') && tg?.dataset.act !== 'lang-menu-body') closeBodyMenus();      // a click on a row menu's own item is its act's to handle, which needs the row it came from
  if (!tg || !tg.dataset.act) return;
  const act = tg.dataset.act, id = tg.dataset.id;
  if (await onpage.act(act, tg)) return;
  if (await find.act(act, tg)) return;
  if (await recordTab.act(act, tg)) return;
  if (await switcher.act(act, tg)) return;
  if (act === 'goto'){ ui.menu = false; ui.corner = false; setView(tg.dataset.v); return; }
  if (await dock.act(act, tg)) return;
  if (await checklist.act(act, tg)) return;
  if (await onboarding.act(act, tg)) return;
  if (await settings.act(act, tg)) return;
  if (await career.act(act, tg)) return;
  if (act === 'view-back'){ setView(null); return; }
  if (act === 'place'){ goPlace(tg.dataset.p); return; }
  if (act === 'scr-back'){ leaveView(); return; }
  if (await screens.act(act, tg)) return;
  if (await resumes.act(act, tg)) return;
  if (await files.act(act, tg)) return;
  if (await exporter.act(act, tg)) return;
  if (await design.act(act, tg)) return;
  if (await edit.act(act, tg)) return;
  switch (act){
    case 'menu': ui.menu = !ui.menu; if (ui.menu) switcher.close(); renderHead(); if (ui.menu) focusMenu('.menu'); break;
    case 'select-record': {
      const d = tg.dataset;
      select({ kind: 'record', what: d.what, ...(d.group ? { group: d.group } : {}), ...(d.key ? { key: d.key } : {}), id });
      break;
    }
    case 'help': if (ui.menu){ ui.menu = false; renderHead(); } closeCorner(); help.toggle(); break;
    case 'corner': ui.corner = !ui.corner; if (ui.corner && ui.menu){ ui.menu = false; renderHead(); } drawCorner(); if (ui.corner) focusMenu('.cornermenu'); break;
    case 'deselect': select(NONE); break;
    case 'chip-back': if (ui.back) select(ui.back.sel); break;
    case 'select-header': select({ kind: 'header' }); break;
    case 'select-section': select({ kind: 'section', id }); sheet.flash(id); break;
    case 'select-job': select({ kind: 'job', id }); break;
    case 'select-fact': select({ kind: 'bullet', id, section: tg.dataset.section ?? 'summary', ...(tg.dataset.owner ? { owner: tg.dataset.owner } : {}) }); break;
    case 'lang-menu': openLangMenu(); break;
    case 'lang-more': ui.langMore = true; renderHead(); focusMenu('.langpop [data-act=lang-add]'); break;
    case 'lang': if ((tg.dataset.for ?? 'resume') === 'resume') useLanguage(tg.dataset.lang); break;
    case 'lang-add': if ((tg.dataset.for ?? 'resume') === 'resume') useLanguage(tg.dataset.lang, { add: true }); break;
    case 'lang-remove': if ((tg.dataset.for ?? 'resume') === 'resume') removeLanguage(tg.dataset.lang); break;
    case 'select-bullet': {
      const job = ui.ix.highlight.get(id);
      select(job ? { kind: 'bullet', id, job, section: 'experience' } : { kind: 'bullet', id, section: 'summary' });
      break;
    }
    case 'use-version': useVersion(tg.closest('.vlist, .obvlist')?.dataset.fact ?? ui.sel.id, tg.dataset.v); break;
    case 'drink-switch': toggleDrink(); break;
    case 'drink-set': setDrink(tg.dataset.m); break;          // the start screen's two cups
    case 'theme-toggle': setThemePref(resolveTheme(themePref()) === 'dark' ? 'light' : 'dark'); break;
    case 'chip-undo': store.undo(); dropChip(); break;
    case 'toast-act': { const run = toastAct; toastAct = null; $('#toast').classList.remove('on'); run?.(); break; }
    case 'toast-undo': if (store.history.undo === toastAt) store.undo(); else dropToastUndo(); break;
    case 'undo': stepHistory('undo'); break;
    case 'redo': stepHistory('redo'); break;
    case 'side-fold': toggleSide(); break;
    case 'fit': if (placeOf() === 'editor') runFit(); break;      // a phone's screen holds Fit
    case 'actual': openActual(); break;
    case 'fullscreen': toggleFullscreen(); break;
    case 'open': ui.menu = false; pickFile(); break;
    case 'link': ui.menu = false; linkFolder(); break;
    case 'unlink': ui.menu = false; await persist.unlink(); renderHead(); toast(t('toast.unlinked')); break;
    case 'reconnect': reconnect(); break;
    case 'save-file': ui.menu = false; review.saveFlow(tg); break;
    case 'review-open': review.open(tg); break;
    case 'save-note-ok': ui.saveNote = false; renderHead(); break;
    case 'folder-compare': files.compareFolder(); break;
    case 'folder-overwrite': await persist.overwriteFolder(); renderHead(); break;

    case 'checkpoint': ui.menu = false; await persist.checkpoint(t('checkpoint.named', { date: new Date().toLocaleString() })); toast(t('toast.checkpointSaved')); renderHead(); break;
    case 'example': ui.menu = false; await loadExample(); toast(t('toast.exampleOpen')); break;
    case 'example-ok': ui.exampleChip = false; renderHead(); break;
  }
}

document.addEventListener('mouseover', e => {
  const row = e.target.closest?.('.vrow[data-v], .obvopt[data-v]');
  if (!row || !row.dataset.v || ui.fitting || edit.editing?.panel || (row.classList.contains('cur') && !edit.editing)) return;      // while a line is written its own version is previewed too: the draft is what differs
  if (ui.hoverV === row.dataset.v) return;
  const fact = row.closest('.vlist, .obvlist')?.dataset.fact;
  if (!fact) return;
  ui.hoverV = row.dataset.v;
  previewVersion(fact, row.dataset.v);
});
document.addEventListener('mouseout', e => {
  const list = e.target.closest?.('.vlist, .obvlist');
  if (!list || list.contains(e.relatedTarget)) return;
  ui.hoverV = null;
  endPreview();
});

async function previewVersion(factId, vid){
  const r = structuredClone(cur());
  ui.previewing = true; ui.hoverFact = factId;
  let res;
  try {
    pickVersion(store.state.record, r, factId, vid);      // on the copy: an edit on this resume is set aside there, and a locked line is not previewed
    res = await sheet.preview(work(), r, factId, { kind: 'hover', words: factId, ix: ui.ix });      // the words move from one version to the other
  } catch { ui.previewing = false; ui.hoverFact = null; return; }       // the version was deleted under the pointer: nothing to show
  if (!ui.previewing) return sheet.endPreview({ kind: 'hover', words: factId, ix: ui.ix });
  ui.fills = res.pages; renderFoot();
}
async function endPreview(){
  if (!ui.previewing) return;
  ui.previewing = false;
  const back = ui.hoverFact, sw = ui.previewSwitch; ui.hoverFact = null; ui.previewSwitch = false;
  const res = await sheet.endPreview(back ? { kind: 'hover', words: back, ix: ui.ix } : sw ? { kind: 'switch' } : null);
  if (ui.preview){ ui.preview = null; relayout(); }    // back to the open resume's size and view
  if (res){ ui.fills = res.pages; renderFoot(); }
  sheet.select(ui.sel, ui.ix);
  if (back) edit.redraft();      // a line being written gets its draft on the page again
}
async function previewRecipe(r, fact = null, w = work()){
  ui.previewing = true;
  const my = ui.previewSeq = (ui.previewSeq ?? 0) + 1;
  if (!fact) ui.previewSwitch = true;            // another resume under the pointer: the page crossfades to it, and back
  const res = await sheet.preview(w, r, fact, fact ? null : { kind: 'switch' });
  if (!ui.previewing || my !== ui.previewSeq) return;
  // Another saved resume can be another paper size or page count. The column never moves:
  // its first page is shown in the space the open resume's page has.
  if (r.format !== shown().format || res.laid?.pages?.length !== ui.laid?.pages?.length){
    ui.preview = { format: r.format };
    const L = ui.layout, a = pageSize(shown().format), b = pageSize(r.format);
    sheet.setView({ mode: 'single', page: 0 });
    sheet.setFade([]);
    const k = Math.min(a.h / b.h, a.w / b.w, 1.2);
    if (L.phone){
      $('#sheet').style.top = `${L.sheet.top + (L.stack ? $('#pages').scrollTop : 0)}px`;
      $('#sheet').style.transform = `translate(0px, 0px) scale(${L.scale * k})`;
    } else {
      // its first page, where the bright page was, a little larger or smaller to fill the same room
      const c = canvas.cam;
      canvas.showOnly({ k: c.k * k, x: c.x + pageLeft(canvas.geo, ui.page) * c.k, y: c.y });
    }
  } else if (ui.preview){ ui.preview = null; relayout(); }
  ui.fills = res.pages; renderFoot();
}

function useVersion(factId, vid){
  ui.previewing = false; ui.hoverV = null; ui.hoverFact = null;
  if (edit.editing?.fact === factId && !edit.editing.panel){ edit.pickWhileWriting(vid); return; }
  const v = ui.ix.variants.get(vid);
  store.commit(d => pickVersion(d.record, d.cur, factId, vid), t('undo.useVersion', { n: v?.n ?? '?' }));      // an edit on this resume is set aside, not lost
}


async function runFit(){
  if (ui.fitting || !cur() || ui.snap) return;
  const pre = sheet.take({ kind: 'fit', ix: ui.ix });      // how the page is now, before Fit draws its candidates in the frame
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
    if (changed){ ui.morph = { kind: 'fit', pre }; store.commit(d => { d.cur = res.recipe; }, t('undo.fit')); }
    toast(fitSummary(res.report) + (changed ? ' ' + t('toast.ctrlZUndoes') : ''), res.report.converged ? '' : 'warn');
    if (changed) fitChip(res.report);
  } catch (e){
    console.error(e); toast(t('fit.stopped', { msg: errText(e) }), 'bad');
  } finally {
    ui.fitting = false;
    await redraw();
  }
}

// The chip sits by Fit's place and never over the page: in the sidebar, just under the Fit button in the name card, at the card's right edge; on a phone it stays above the sheet.
function placeChip(el){
  const L = ui.layout;
  for (const k of ['left', 'right', 'top', 'maxWidth']) el.style[k] = '';
  if (!L || L.phone) return;
  const ft = ($('.fitslot .fit') ?? $('.fitslot') ?? $('#body')).getBoundingClientRect();      // Fit is in Export; the chip waits under it, else at the panel's top
  Object.assign(el.style, { left: `${Math.round(Math.max(L.col.left + 8, ft.right - el.offsetWidth))}px`, top: `${Math.round(ft.bottom + 6)}px`, maxWidth: `${L.col.width - 16}px` });
}
// After Fit: what it did, in a chip that stays until the next change (dropChip runs when the history moves), with Undo. Fit only chose among wordings that were already there.
let chipEl = null, chipAt = -1;
function dropChip(now = false){
  const el = chipEl; chipEl = null; chipAt = -1;
  if (!el) return;
  const a = now ? null : play(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px)' }], { kind: 'leave', ms: 'fast', fill: 'forwards', name: 'chip:out' });
  if (a) a.finished.catch(() => {}).then(() => el.remove()); else el.remove();
}
function fitChip(rep){
  const shorter = rep.swaps.filter(x => x.lines[1] < x.lines[0]).length, longer = rep.swaps.filter(x => x.lines[1] > x.lines[0]).length;
  const same = rep.swaps.length - shorter - longer, out = rep.dropped.length, added = rep.added.length;
  const parts = [shorter && t('ux4.chipShorter', { n: shorter }), longer && t('ux4.chipLonger', { n: longer }), same && t('ux4.chipSwapped', { n: same }),
    out && t('ux4.chipOut', { n: out }), added && t('ux4.chipAdded', { n: added })].filter(Boolean);
  dropChip(true);
  if (!parts.length) return;
  chipEl = document.createElement('div');
  chipEl.className = 'fitchip'; chipEl.setAttribute('role', 'status');
  chipEl.innerHTML = `<span>${esc(parts.join(' · '))}</span><button class="sm" data-act="chip-undo">${h('foot.undo')}</button>`;
  document.body.append(chipEl);
  placeChip(chipEl);
  chipAt = store.history.undo;
  play(chipEl, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { kind: 'arrive', fill: 'backwards', name: 'chip:in' });
}

// the first line of Fit's report (src/fit.js formatReport, which the CLI prints in English)
function fitSummary(r){
  const pages = r.pages.map(x => t(x.held ? 'fit.pageHeld' : 'fit.page', { page: x.page, fill: x.fill })).join(' · ');
  return t(r.converged ? 'fit.inBand' : 'fit.notInBand', { n: r.rounds, pages, lo: r.band[0], hi: r.band[1] });
}

// the panel redraws on leaving a line, which drops the focus to the body: Edit's tab takes it
function backToTab(){ if (document.activeElement === document.body || !document.activeElement) $('#tab-edit')?.focus({ preventScroll: true }); }
// the line being written is left first (its text kept, as Esc does), so undo never runs under an open draft
const stepHistory = async kind => { if (edit.editing) await edit.cancelEdit(); store[kind](); };
function key(e){
  if (menuKey(e)) return;
  const typing = isTyping(e.target);
  const mod = e.ctrlKey || e.metaKey;
  if (typing && mod && ['z', 'y'].includes(e.key.toLowerCase())) return;      // the text box's own undo
  if (e.key === 'F11' && !mod && !e.altKey && !e.shiftKey){ e.preventDefault(); toggleFullscreen(); return; }      // full screen is F11, in a text box too; a plain F is a letter
  if (mod && !e.altKey && e.key.toLowerCase() === 'z'){ e.preventDefault(); stepHistory(e.shiftKey ? 'redo' : 'undo'); return; }
  if (mod && e.key.toLowerCase() === 'y'){ e.preventDefault(); stepHistory('redo'); return; }
  if (mod && !e.altKey && e.key.toLowerCase() === 's'){ e.preventDefault(); if (!e.isComposing && e.keyCode !== 229) review.saveFlow(); return; }
  if (mod && e.key.toLowerCase() === 'o'){ e.preventDefault(); switcher.openOrFocus(); return; }
  if (mod && !e.altKey && e.code === 'Backslash' && !ui.layout?.phone && ui.view !== 'welcome'){ e.preventDefault(); toggleSide(); return; }      // the sidebar folds to the rail and back (sidewidth.js)
  // the app's search: the first press is ours, the next one (the field has the focus) is the browser's own find; a dialog keeps its keys
  if (isFindKey(e) && ui.view !== 'welcome' && !inFind() && !e.target.closest?.('dialog, [aria-modal=true]')){ e.preventDefault(); find.open(); return; }
  if (typing) return;
  if (isDrinkKey(e)){ e.preventDefault(); toggleDrink(); return; }          // Shift+F: tea or coffee, in place
  if (ui.view === 'welcome') return;                    // the introduction and the questions have their own keys
  if (ui.snap && e.key !== 'Escape') return;           // a snapshot is read-only
  if (e.key === 'Escape'){
    if (help.isOpen){ help.close(); return; }
    if (switcher.isOpen){ switcher.close({ focusBack: true }); return; }
    if (ui.menu){ ui.menu = false; renderHead(); return; }
    if (closeCorner()){ $('[data-act=corner]')?.focus(); return; }
    if (ui.langMenu){ ui.langMenu = null; renderHead(); $('#langbtn')?.focus(); return; }
    if (closeBodyMenus()) return;
    if (edit.key(e)) return;
    if (SCREENS.includes(ui.view)){ leaveView(); return; }      // up one level inside the place, never to another
    if (ui.view){ setView(null); return; }
    if (ui.snap){ setSnap(null); renderAll(); return; }
    if (ui.previewing){ endPreview(); return; }
    // up one level (writing a line is left by edit.js before this); a job, or a line in one, is the job level, and one Esc
    // goes to the page. At the page level, the sidebar folds and the view zooms out
    const next = up(ui.sel);
    if (next.kind !== 'none'){ select(next); return; }
    if (ui.sel.kind !== 'none'){ select(NONE); backToTab(); return; }
    if (!ui.layout?.phone && !side().off && escFolds()) toggleSide();      // the sidebar folds away, and the pages centre in the whole window
    dock.allTheWayOut();
    return;
  }
  if (!mod && !e.altKey && !e.shiftKey && 'wer'.includes(e.key.toLowerCase()) && e.key.length === 1){ e.preventDefault(); goPlace({ w: 'library', e: 'editor', r: 'career' }[e.key.toLowerCase()]); return; }      // W E R: the three places, in a row
  if (edit.key(e)) return;
  if (e.key === '?' && !mod){ e.preventDefault(); help.toggle(); return; }
  if (e.key === '/' && !mod && !e.altKey && ui.view !== 'welcome'){ e.preventDefault(); find.open(); return; }      // the way in where a browser or a window keeps Ctrl+F
  if (dock.onKey(e)) return;
  // the arrows walk the page; inside the panel, the timeline or a menu they belong to what has the focus
  if (e.target.closest?.('#col, #timeline, #help, #switcher')) return;
  // between the pages: Page Up and Page Down, and the side arrows when nothing is selected
  if (!mod && !e.altKey && !ui.layout?.phone && (e.key === 'PageDown' || e.key === 'PageUp' || (ui.sel.kind === 'none' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')))){
    e.preventDefault(); canvas.travel(e.key === 'PageDown' || e.key === 'ArrowRight' ? 1 : -1); return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    const id = step(sheet.order(ui.ix), ui.sel, e.key === 'ArrowDown' ? 1 : -1);
    if (typeof id === 'string'){ e.preventDefault(); select(lineSel(ui.ix, id)); }
    return;
  }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && ui.sel.kind === 'bullet' && ui.sel.section !== 'skills'){
    const vs = versionsOf(ui.ix, ui.sel.id, lang());
    const at = vs.findIndex(v => v.id === chooseVariant(ui.work, ui.sel.id, cur()).v?.id);
    const next = vs[at + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next){ e.preventDefault(); useVersion(ui.sel.id, next.id); }
  }
}

// rb-esc-fold = off keeps the sidebar open at the page level (for the checks, which press Esc to rest)
const escFolds = () => { try { return localStorage.getItem('rb-esc-fold') !== 'off'; } catch { return true; } };
async function toggleFullscreen(){
  const win = globalThis.__TAURI__?.window?.getCurrentWindow?.();      // the desktop app: the window itself, which Esc does not leave (the page's full screen is left by Esc)
  if (win){
    try { await win.setFullscreen(!(await win.isFullscreen())); await syncWinFull(); relayout(); } catch { toast(t('toast.noFullscreen'), 'warn'); }
    return;
  }
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.()
    // ask the browser to hand Esc to the page: one press steps up a level, and holding it leaves full screen (Chrome and Edge)
    .then(() => navigator.keyboard?.lock?.(['Escape']).catch(() => {}))
    .catch(() => toast(t('toast.noFullscreen'), 'warn'));
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) navigator.keyboard?.unlock?.(); });
// The desktop app's full screen has no title bar, so the top edge brings one back: a bar with the window's controls (src/ui/workbench.css, .fsbar)
const fsWin = () => globalThis.__TAURI__?.window?.getCurrentWindow?.();
async function syncWinFull(){
  const w = fsWin(); if (!w) return;
  const on = await w.isFullscreen().catch(() => false);
  document.body.classList.toggle('is-fs', on);
  if (on) for (const [act, key] of [['min', 'fs.minimise'], ['exit', 'fs.exit'], ['close', 'fs.close']]){ const b = document.querySelector(`.fsbar [data-fs=${act}]`); if (b) b.title = b.ariaLabel = t(key); }
}
function mountFullBar(){
  const w = fsWin(); if (!w || document.querySelector('.fsbar')) return;
  document.body.insertAdjacentHTML('beforeend', `<div class="fsbar-zone" aria-hidden="true"></div><div class="fsbar" role="toolbar" aria-label="BrewCV"><b>BrewCV</b>
    <button type="button" data-fs="min">${icon('minus')}</button><button type="button" data-fs="exit">${icon('full')}</button><button type="button" data-fs="close">${icon('close')}</button></div>`);
  document.querySelector('.fsbar').addEventListener('click', async e => {
    const b = e.target.closest('[data-fs]'); if (!b) return;
    if (b.dataset.fs === 'min') w.minimize();
    else if (b.dataset.fs === 'close') w.close();
    else { await w.setFullscreen(false); await syncWinFull(); relayout(); }
  });
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
  if (edit.editing) await edit.cancelEdit();      // the line being written is kept on this resume first, so the file has it
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
    renderHead(); refreshFileLine();
    return true;
  } catch (e){ toast(t('toast.exportFailed', { msg: errText(e) }), 'bad'); return false; }
}
function readFlag(k){ try { return localStorage.getItem(k) === '1'; } catch { return false; } }
function setFlag(k){ try { localStorage.setItem(k, '1'); } catch { /* shown again next time */ } }

// A linked folder mirrors the record and its resumes to disk. It is never needed.
async function linkFolder(startAt){
  let f;
  try {
    const T = tauriApi();
    if (T){ const dir = await T.dialog.open({ directory: true, recursive: true, ...(startAt ? { defaultPath: startAt } : {}) }); if (!dir) return; f = tauriFolder(dir); }
    else f = fsaFolder(await showDirectoryPicker({ id: 'brewcv', mode: 'readwrite' }));
  } catch { return; }
  if ((await f.permission(true)) !== 'granted') return toast(t('toast.noFolderPermission'), 'warn');
  await adoptFolder(f, true);
}

async function adoptFolder(f, fresh){
  const disk = await readFolder(f).catch(e => { toast(`${f.name}: ${errText(e)}`, 'bad'); return null; });
  let adopted = false;
  if (disk){
    const cmp = await persist.compareFolder(f);
    if (!cmp.same){
      const useDisk = await askOk(t(disk.state.resumes.length ? 'confirm.folderHasResumes' : 'confirm.folderHas', { name: f.name, n: disk.state.resumes.length }), { ok: 'OK', cancel: 'Cancel' });
      if (useDisk){
        await persist.checkpoint(t('checkpoint.beforeFolder', { name: f.name }), 'replace');
        ui.sel = NONE;
        const st = disk.state;
        if (st.openId) RS.openSaved(st, st.openId);
        if (!st.cur){ st.cur = newResume(st.record); st.openId = null; }
        store.replace(st, t('undo.useFolder', { name: f.name }));
        adopted = true;
      }
    }
  }
  const wrote = await persist.link(f);
  if (adopted) await persist.dropMerged(disk.leftovers).catch(() => {});     // a spelling of a name that was merged into the one just written
  ui.reconnect = null;
  renderHead();
  toast(wrote.length ? t('toast.linkedWrote', { name: f.name, n: wrote.length }) : t('toast.linked', { name: f.name }));
}

async function checkFolder(){
  const h = await persist.rememberedFolder().catch(() => null);
  if (!h) return;
  const f = folderOf(h);
  if ((await f.permission(false)) === 'granted') return adoptFolder(f, false);
  ui.reconnect = f; renderHead();
}
async function reconnect(){
  const f = ui.reconnect;
  if (!f) return;
  // desktop: a path has no permission to ask for and the folder may have moved, so the person picks it again, starting beside the old one
  if (typeof f.handle === 'string') return linkFolder(f.handle.replace(/[\\/][^\\/]*$/, '') || undefined);
  if ((await f.permission(true)) !== 'granted') return toast(t('toast.stillNoDisk'), 'warn');
  await adoptFolder(f, false);
}

// A toast never covers the page. It hangs under the sidebar's header, over the sidebar's own body. (On a phone the page fills the
// width: it stays at the top.)
function placeToast(el){
  const L = ui.layout;
  el.classList.remove('docked');
  for (const k of ['left', 'right', 'top', 'width', 'maxWidth']) el.style[k] = '';
  if (!L || L.phone) return;
  const c = $('#col').getBoundingClientRect(), hd = $('#head').getBoundingClientRect();
  el.classList.add('docked');
  Object.assign(el.style, { left: `${Math.round(c.left + 8)}px`, top: `${Math.round(hd.bottom + 8)}px`, width: `${Math.round(c.width - 16)}px` });
}
// the live region (a lock explains itself by moving, edit.js lockSaid, not by a sentence)
const say = text => { const el = $('#announce'); if (el){ el.textContent = ''; setTimeout(() => { el.textContent = text; }, 30); } };
// `undo`: the action is one Ctrl+Z away, and the toast carries the button for it (the same undo, for as long as nothing else has changed)
let toastAt = -1, toastAct = null;
const dropToastUndo = () => { toastAt = -1; $('#toast [data-act=toast-undo]')?.remove(); };
// `act`: { label, run }, one more button that does something (Use the dates)
function toast(msg, tone = '', undo = false, offer = false, act = null){
  const el = $('#toast');
  el.replaceChildren(msg);
  toastAt = -1; toastAct = act?.run ?? null;
  if (act){ const b = Object.assign(document.createElement('button'), { className: 'sm', textContent: act.label }); b.dataset.act = 'toast-act'; el.append(' ', b); }
  // after an export: the Review list, offered once and never in the way
  if ((offer = offer && review.pending() > 0)){ const b = Object.assign(document.createElement('button'), { className: 'sm', textContent: t('newer.review') }); b.dataset.act = 'review-open'; el.append(` ${t('ux6d.offer', { n: review.pending() })} `, b); }
  if (undo){ const b = Object.assign(document.createElement('button'), { className: 'sm', textContent: t('foot.undo') }); b.dataset.act = 'toast-undo'; el.append(b); toastAt = store.history.undo; }
  el.className = `toast on ${tone}`;
  placeToast(el);
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), undo || offer || act ? 7000 : 3600);
}

const review = initReview({ store, ui, work, saveToFile, leaveLine: () => (edit.editing ? edit.cancelEdit() : null), fieldName: ed => edit.fieldName(ed), renderBody: () => renderBody(), toast });
window.__wb.review = review;
const edit = initEdit({
  pendingHtml: (id, at) => review.pendingHtml(id, at), canPend: (id, at) => review.canPend(id, at),
  store, ui, sheet, toast, say, record, cur, lang, work, chooseVariant, sectionTitle, textOfFact, resumeName, fillText,
  ix: () => ui.ix ?? indexModel(work(), cur()), togglePhoto: () => design.togglePhoto(),
  redrawNow: () => { clearTimeout(timer); timer = null; return redraw(); },
  onpage: { keepView: fn => onpage.keepView(fn), begin: () => onpage.begin(), end: () => onpage.end(), text: () => onpage.text(), setText: t => onpage.setText(t), refresh: () => onpage.refresh(), render: f => onpage.render(f) },
  newerBanner: () => resumes.newerBanner() + onboarding.tipHtml(),
  outlineHtml: (...a) => checklist.outlineHtml(...a), depthKids: (...a) => checklist.kidsOf(...a), sectionInfo: (...a) => checklist.sectionInfo(...a),
  setFocus: () => sheet.setFocus(edit.focusHits(), ui.ix),
  select: (sel, o) => select(sel, o),
  renderBody: () => renderBody(),
  flash: id => { ui.flashAfter = id; },
  endHover: () => { ui.hoverV = null; if (ui.previewing) endPreview(); },
  endPreview: () => endPreview(),
  previewRecipe,
  detailsHtml: id => career.detailsHtml(id),
});
edit.bind($('#body'));
window.__wb.edit = edit;
window.__wb.motion = motion;
const resumes = initResumes({
  store, ui, persist, toast, work, NONE, setView, setSnap, snapshotTaken: () => snapshotTaken(),
  renderBody: () => renderBody(), renderHead: () => renderHead(),
  leaveOk: () => edit.leaving(NONE),
  endPreview: () => endPreview(),
  previewRecipe,
  noteOpen: id => switcher.noteOpen(id), noteRename: (a, b) => switcher.noteRename(a, b),
  nameReady: () => { if (ui.layout?.phone){ switcher.close(); return false; } switcher.open({ name: true }); return true; }, renderSwitcher: () => switcher.render(),
  fit: () => runFit(),
});
const switcher = initSwitcher({ store, ui, toast, setView, work, previewRecipe, resumes,
  endPreview: () => endPreview(),
  langSelect, opened: loadLangCounts,
  chooseLang: v => { if (v.startsWith('-')) removeLanguage(v.slice(1)); else { const add = v.startsWith('+'); useLanguage(add ? v.slice(1) : v, { add }); } },
  choosePaper: v => design.act('d-paper', { dataset: { f: v === 'us-letter' ? 'us-letter' : 'a4' } }),
  relayout: () => syncFull(),
  closeMenus: () => { if (ui.menu || ui.langMenu){ ui.menu = false; ui.langMenu = null; renderHead(); } },
});
switcher.bind();
Object.assign(VIEWS, resumes.views);
VIEWS.record = () => recordTab.view();
const thumbs = initThumbs({ work, extraCss: r => design.extraCss(store.state.record, r), chrome: r => docChrome(r.lang ?? 'en') });
const screens = initScreens({ store, work, setView, resumes, view: () => ui.view, renderBody: () => renderBody(), leave: () => leaveView() }, thumbs);
Object.assign(VIEWS, screens.views);
window.__wb.thumbs = thumbs; window.__wb.screens = screens;
const files = initFiles({
  store, ui, persist, toast, NONE, setView, pickFile, download, saveToFile,
  onImage: f => design.setPhoto(f), onThemeText: (t, n) => design.importTheme(t, n), onTheme: (j, n) => design.importTheme(j, n),
  renderBody: () => renderBody(),
});
Object.assign(VIEWS, files.views);
files.bind($('#body'));
window.__wb.files = files;
const exporter = initExport({ store, ui, toast, work, cur: () => shown(),
  // the Fix of a major warning: to the page, the header or the line it is about, in the Editor, with the thing in view and the keyboard on it (the photo's switch, the line's version in use)
  goFix: async f => {
    await dock.setMode('edit');
    if (f.header){ goToPage(0); select({ kind: 'header' }); document.getElementById('d-photo-on')?.focus({ preventScroll: false }); }
    else if (f.fact){ select(lineSel(ui.ix, f.fact)); const v = document.querySelector('#body .vrow.cur'); if (v){ v.tabIndex = -1; v.focus(); } }
    else if (f.page != null){ select(NONE); goToPage(f.page); }      // the page itself: a line or the header picked by an earlier Fix is let go
  },
  reviewCount: () => review.count(), offerReview: () => review.pending() && toast('', '', false, true), download, fileLine, renderBody: () => renderBody(),
  pageBox: () => { const b = ui.layout?.phone ? null : sheet.pageBoxes()[ui.page]; return b ? canvas.screenRect(b) : null; },
  extraCss: (r, medium) => design.extraCss(store.state.record, r, medium) });
const design = initDesign({ store, ui, toast, cur, setView, renderBody: () => renderBody(), pickFile, download, photoUrl: () => store.materialize(store.state.record?.basics?.image) });
Object.assign(VIEWS, design.views);
const onboarding = initOnboarding({ store, ui, persist, toast, setView, renderBody: (a) => renderBody(a), restyle: () => restyle() });
Object.assign(VIEWS, onboarding.views);
onboarding.bind($('#body'));
window.__wb.onboarding = onboarding;
const career = initCareer({ store, ui, toast, work, setView, syncUi: r => syncUi(r), edit, lang, select: s => select(s), renderBody: (a) => renderBody(a),
  renderHead: () => renderHead(), photoUrl: () => store.materialize(store.state.record?.basics?.image) });
career.bind($('#body'));
window.__wb.career = career;
const checklist = initChecklist({ store, ui, work, cur, lang, edit, career, sectionTitle, lineBox: id => { const r = ui.ix && sheet.rectOf(id, ui.ix); return r ? canvas.screenRect(r) : null; }, select: (s, o) => select(s, { keepScroll: true, ...o }), hoverFact, renderBody: () => renderBody(), timelineHtml: () => career.timelineHtml() });
checklist.bind($('#body'));
window.__wb.checklist = checklist;
const recordTab = initRecord({ ui, checklist, career, work, cur, lang, openName: () => resumeName(RS.savedOf(store.state, store.state.openId)), renderBody: () => renderBody(), setMode: m => dock.setMode(m) });
window.__wb.record = recordTab;
const help = initHelp({ ui });
const find = initFind({ view: () => ui.view, leaveWriting: async () => !ui.writing || edit.cancelEdit(), goLibrary: () => goPlace('library'), renderBody: () => renderBody(), work, cur, lang, openLang: () => shown()?.lang ?? null,
  setFind: q => sheet.setFind(q, ui.ix), finds: () => sheet.finds(ui.ix), selectFact: id => select(lineSel(ui.ix, id)),
  resumes: () => store.state.resumes ?? [], held: id => resumes.heldRecipe(id), pickResume: id => { screens.pick(id); goPlace('library'); } });
window.__wb.find = find;
initPress();
initSide(document.getElementById('col'), () => relayout());
initDropdowns();      // every select is shown in the app's own menu (dropdown.js), and a field's suggestions in the app's own card (suggest.js)
initSuggest();
window.__wb.help = help;
const dock = initDock({ store, ui, shown, setView, leaveWriting: () => edit.cancelEdit(), goToPage, canvas, sheet, restyleMarks: () => sheet.restyle(), startFoot: () => onboarding.footHtml(), cornerHtml: () => cornerHtml() });
window.__wb.dock = dock;
design.bind($('#body'));
window.__wb.design = design;
Object.assign(VIEWS, exporter.views);
window.__wb.export = exporter;
resumes.bind($('#body'));
screens.bind($('#body'));
for (const m of [screens, resumes, checklist, career, edit]) m.bind($('#scr'));      // the Library and Career have their own host (the ticks are edit.js's)
window.__wb.resumes = resumes;
window.__wb.switcher = switcher;

const settings = initSettings({ store, ui, toast, setView, renderBody: () => renderBody(), syncUi: r => syncUi(r), syncGarden });
Object.assign(VIEWS, settings.views);
settings.bind($('#body'));
window.__wb.settings = settings;

window.__booted = true;
boot().catch(e => { console.error(e); toast(t('error.start', { msg: errText(e) }), 'bad'); });
