// The sheet: the resume drawn by the real renderer into the real template, in a same-origin
// iframe. Only this module touches the iframe. setView changes how pages are shown, never
// what is measured. `work` is a mutable copy of the record (store.materialize()) because the
// renderer caches line counts in it; the store's own state is never written.

import { mount, measurePages, measureVariants, applyMeasured, measureKey, probeRecipe, probeCount, countLines } from '../render.js';
import { autoLayout, measureBlocks } from '../paginate.js';
import { pageSize, PAGE_GAP } from './layout.js';
import { t } from '../i18n/index.js';
import { reduced, dur, ease, play } from './motion.js';
import * as PM from './pagemotion.js';
import { isLabelKey } from './select.js';
import { HOVER_IN, HOVER_OUT, GLIDE_KEEP, FEEL } from './plate.js';

const VIEW_CSS = `
html, body { background: transparent !important; overflow: hidden !important; }
.document { display: flex; gap: ${PAGE_GAP}px; align-items: flex-start; width: max-content; }
.document > .page { margin: 0 !important; }
html.rb-single .document > .page:not(.rb-shown) { display: none; }
html.rb-stack .document { flex-direction: column; }
html.rb-ui [data-variant], html.rb-ui [data-label], html.rb-ui .band[data-section] { cursor: pointer; }
.document > .page { transition: opacity var(--rb-m-base, 240ms) var(--rb-m-out, ease-out); }
.document > .page { outline: 1px solid var(--rb-edge, transparent); outline-offset: 0; }
.document > .page.rb-faded { opacity: var(--rb-fade, .35); }
html.rb-still *, html.rb-still *::before, html.rb-still *::after { transition: none !important; animation: none !important; }
html[data-rb-moving] .document > .page { box-shadow: none !important; }      /* Linux only (canvas.js): an attribute, not a class, since the frame's classes are the plate's (plate-check) */
html.rb-handing, html.rb-handing * { cursor: grabbing !important; }
html.rb-dragging, html.rb-dragging * { cursor: grabbing !important; user-select: none !important; }
html.rb-space, html.rb-space * { cursor: grab !important; }
.rb-clip { overflow: clip; }      /* the page a block is lifted from: the block never floats over the next page */
/* ---- the plate: a block's own outline, one shape per level, four heights (hover, selected, writing, lifted) and the rings of its parents behind it. Every colour, width and
   offset below is a --plate-* token (workbench.css); the frame wears nothing else. Over the page: a missing text (dashed), and the socket a lifted block leaves. ---- */
[data-variant], [data-label] { --po: var(--plate-off-line); --pk: 1; }
.skills__group, .skills__group [data-variant], .pairs dt, .pairs dd { --po: var(--plate-off-group); --pk: 1; }      /* a group: a skill group, a row of languages: closer set, so closer plates */
.entry { --po: var(--plate-off-job); --pk: var(--plate-k-job); }
.band[data-section] { --po: var(--plate-off-section); --pk: var(--plate-k-section); }      /* the bigger the block, the fainter its tint */
:is(.rb-prev, .rb-find, .rb-miss, .rb-lift, .rb-card, .rb-socket) { border-radius: var(--plate-r); outline-offset: var(--po); }
:is(.rb-prev, .rb-find) { box-shadow: inset 0 0 0 100vmax var(--tint), 0 0 0 var(--po) var(--tint); }      /* the plate's tint fills the block and the stand-off round it */
/* Hover and selection (UX-6f 4c) are one shape that moves: a plate laid over the page (sheet.js paintPlates), the block's box and its level's stand-off (--po), its corner the
   block's radius turned by the stand-off. It glides from block to block (place, size and corner in --plate-glide, ease-out), fades in (--plate-in) and out (--plate-out) where
   it is, and multiplies with the paper so the words under it keep their ink. Frame furniture: aria-hidden, never in the document, the render or a print. */
.rb-plate { position: fixed; left: 0; top: 0; z-index: 4; pointer-events: none; box-sizing: border-box; mix-blend-mode: multiply; opacity: 0;
  border-radius: calc(var(--plate-r) + var(--po)); outline: var(--pw, 0px) solid var(--pc, transparent); outline-offset: 0; background-color: var(--pt, transparent);
  transition: left var(--plate-glide) var(--rb-m-out), top var(--plate-glide) var(--rb-m-out), width var(--plate-glide) var(--rb-m-out), height var(--plate-glide) var(--rb-m-out),
    outline-color var(--plate-glide) var(--rb-m-out), background-color var(--plate-glide) var(--rb-m-out), opacity var(--plate-out) var(--rb-m-out); }      /* (not the corner: it never changes as writing starts) */
.rb-plate.is-on { opacity: 1; transition-property: left, top, width, height, outline-color, background-color, opacity; transition-duration: var(--plate-glide), var(--plate-glide), var(--plate-glide), var(--plate-glide), var(--plate-glide), var(--plate-glide), var(--plate-in); }
/* the ladder (lab v2 "light"): hover is the wash alone, no edge */
.rb-plate.is-hot { --pw: 0px; --pc: transparent; --pt: color-mix(in srgb, var(--plate-tint-hover) calc(var(--pk) * 100%), transparent); }
/* selected: a deeper wash (x1.5), no edge (shading, not outlines); nothing is drawn round the blocks it is part of, the chip says where it is */
.rb-plate.is-hot.is-boost { --pt: color-mix(in srgb, var(--plate-tint-boost) calc(var(--pk) * 100%), transparent); }      /* the sidebar's row under the pointer: the same plate, x1.4 */
.rb-plate.is-sel { --pw: 0px; --pc: transparent; --pt: color-mix(in srgb, var(--plate-tint-sel) calc(var(--pk) * 100%), transparent); }
/* pressed in, writing: the line recedes to a thin rule (--plate-write) at the written field's own stand-off (--rb-wo), no tint: the field takes the paper */
html.rb-cam .rb-plate { transition: opacity var(--plate-out) var(--rb-m-out); }
.rb-plate.is-write { --pw: var(--plate-write); --pc: var(--plate-ink); }
/* the grip (item 4): 2x3 dots in the plate's own left tab (--tw wide, the plate widened into it; inside its edge where words leave no room), in the plate ink; quiet while written */
.rb-plate.is-grip::before { content: ''; position: absolute; width: 10px; height: 15px; left: calc((max(var(--tw, 0px), var(--plate-tab-w)) - 10px) / 2); top: calc(min(50%, 14px) - 7.5px);
  background: radial-gradient(circle, var(--plate-ink) 1.3px, transparent 1.7px) 0 0 / 5px 5px; }
.rb-plate.is-write.is-grip:not(.is-grip-hot)::before { opacity: .4; }
/* the preview accent: what the app shows (a row of the sidebar, a version being looked at, a search hit) in the plate's shape */
/* the chip's tick or padlock under the pointer: the block it governs wears a plate (the hover plate's shape, never an edge of its own) and one cue for the action. Tick: the plate
   deepens and the block fades (what hiding does). Padlock: the plate takes the lock wash and a hairline frame closes in on its edge in 160 ms and rests faint (unlock: it opens outward and goes). */
.rb-sel { transition: opacity 150ms var(--rb-m-out); }
.rb-fade { opacity: .3; }
.rb-plate.is-scope:is(.is-hide, .is-show) { --pt: color-mix(in srgb, var(--plate-tint-boost) calc(var(--pk) * 100%), transparent); }
.rb-plate.is-scope:is(.is-lock, .is-unlock) { --pt: color-mix(in srgb, var(--plate-lock-wash) calc(var(--pk) * 100%), transparent); }
.rb-plate.is-scope.is-unlock { --pt: color-mix(in srgb, var(--plate-lock-wash) calc(var(--pk) * 45%), transparent); }
.rb-plate:is(.is-lock, .is-unlock)::after { content: ''; position: absolute; inset: 0; box-sizing: border-box; border-radius: calc(var(--plate-r) + var(--po)); border: 1px solid var(--plate-ink); opacity: .45; }
.rb-plate.is-lock::after { animation: rbLatch 160ms var(--rb-m-out) both; }
.rb-plate.is-unlock::after { opacity: 0; animation: rbUnlatch 160ms var(--rb-m-out) both; }
@keyframes rbLatch { from { inset: -7px; opacity: 0; } to { inset: 0; opacity: .45; } }
@keyframes rbUnlatch { from { inset: 0; opacity: .45; } to { inset: -7px; opacity: 0; } }
.rb-prev { outline: var(--plate-line) solid var(--plate-accent); --tint: color-mix(in srgb, var(--plate-accent-tint) calc(var(--pk) * 100%), transparent); }
.rb-find { outline: var(--plate-hair) solid var(--plate-accent); --tint: color-mix(in srgb, var(--plate-accent-tint) calc(var(--pk) * 100%), transparent); }      /* the search's lines: a second highlight, not the writing one */
.rb-miss { outline: var(--plate-hair) dashed var(--plate-miss); }      /* a text this resume's language does not have: dashed, the one other dashed thing */
/* lifted: no outline (shading, not edges), the hover wash over the paper (in the block and its stand-off) and a small lift shadow */
.rb-lift { position: relative; }
.rb-lift, .rb-card { z-index: 5; outline: none; background-color: var(--plate-paper);
  box-shadow: inset 0 0 0 100vmax var(--plate-tint-hover), 0 0 0 var(--po) var(--plate-tint-hover), 0 0 0 var(--po) var(--plate-paper), var(--plate-lift) var(--po) var(--plate-lift-sh); }
/* a block taller than a third of its page is carried as a card (sheet.fold) and its home folds to its heading: clipped, not reflowed, so nothing else moves; its socket marks the place */
.rb-card { position: fixed; left: 0; top: 0; pointer-events: none; padding: 6px 12px; font: 600 13px/1.2 system-ui, sans-serif; color: var(--plate-ink); white-space: nowrap; max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
.rb-fold { clip-path: inset(0 0 calc(100% - var(--fold)) 0); outline: none; box-shadow: none; }
/* the drop place of a free drag over the page (?drag=free) or a skill's: a soft shaded bar (the ring's shade, no ink line), under the lifted block */
.rb-drop { position: fixed; z-index: 3; pointer-events: none; background: var(--plate-ring); border-radius: var(--plate-r); }
.rb-drop.is-faint { opacity: .35; }      /* the place the pointer is nearing, where nothing drops */
/* its home keeps a shaded socket of the same shape, the wash where it will land (sheet.socket); no outline */
.rb-socket { position: fixed; z-index: 1; pointer-events: none; background: var(--plate-tint-hover); box-shadow: 0 0 0 var(--po) var(--plate-tint-hover); }
/* pressed in, writing: the line recedes to a thin rule, its field takes the paper with a soft inner shadow; nothing is drawn past half the gap to the text around it
   (--rb-wo, sheet.setWriting: the stand-off that leaves room for the rule), so it never covers a neighbour (UX-6f 4c) */
html.rb-writing [contenteditable] { outline: none; border-radius: var(--plate-r); background-color: var(--plate-paper); box-shadow: inset 0 1px 2px var(--plate-inner), 0 0 0 max(0px, var(--rb-wo, 0px)) var(--plate-paper); }      /* its rule is the plate's (.rb-plate.is-write) */
html.rb-previewing .document > .page { outline: var(--plate-line) solid var(--plate-accent); outline-offset: var(--plate-off-job); }
html.rb-focus .bullets li[data-variant]:not(.rb-hit), html.rb-focus .summary[data-variant]:not(.rb-hit), html.rb-focus .skills__items[data-variant]:not(.rb-hit), html.rb-focus .pairs dd[data-variant]:not(.rb-hit), html.rb-focus .runs strong[data-variant]:not(.rb-hit) { opacity: .28; transition: opacity var(--rb-m-base, 240ms) var(--rb-m-out, ease-out); }
html.rb-writing :is([data-variant], [data-label]):not([contenteditable]) { opacity: var(--rb-wdim, .94); }
html.rb-ui [contenteditable] { cursor: text; }
html.rb-ui .skills__group[contenteditable] { color: var(--rb-gi); }      /* a skill group written in place (onpage.js): the name on the first line in its label's own look, the skills below in theirs */
html.rb-ui .skills__group[contenteditable]::first-line { color: var(--rb-gl); font-weight: var(--rb-gw); }
.band .tab.rb-miss-tab { background-image: repeating-linear-gradient(-45deg, color-mix(in srgb, var(--plate-miss) 45%, transparent) 0 3px, transparent 3px 7px) !important; }
[data-rb-hid] { -webkit-text-fill-color: transparent; }
[data-rb-hid]::marker { -webkit-text-fill-color: currentcolor; }
.rb-flash { animation: rb-flash 900ms var(--rb-m-out, ease-out); }
@keyframes rb-flash { from { background-color: var(--plate-tint-sel); } to { background-color: transparent; } }
`;

// The plate's tokens (workbench.css, per drink and theme) wear the same names in the frame. The frame's document is a separate page, so they are copied across as custom
// properties: on the frame's root, which the resume's own stylesheets never read, and which is not in an export.
const PLATE_TOKENS = ['off-line', 'off-group', 'off-job', 'off-section', 'k-job', 'k-section', 'wash', 'r', 'hair', 'line', 'write', 'glide', 'lift', 'ink', 'ink-hover', 'ring', 'tint-hover', 'tint-sel', 'accent', 'accent-tint', 'miss', 'lift-sh', 'inner', 'tint-boost', 'lock-wash'].map(n => `--plate-${n}`);
function paintMarks(doc){
  const cs = getComputedStyle(document.documentElement);
  // the page's edge follows the contrast setting: the sharper look is the default, the softer one is the old look
  const soft = document.body.classList.contains('soft');
  // the motion tokens and the Reduce motion rule go across the same way (the frame has no :root of the app's)
  doc.documentElement.style.setProperty('--rb-m-base', `${dur('base')}ms`);
  doc.documentElement.style.setProperty('--rb-m-out', ease('arrive'));
  doc.documentElement.classList.toggle('rb-still', reduced());
  for (const n of PLATE_TOKENS) doc.documentElement.style.setProperty(n, cs.getPropertyValue(n).trim());
  doc.documentElement.style.setProperty('--rb-edge', cs.getPropertyValue(soft ? '--page-edge-soft' : '--page-edge').trim());
  doc.documentElement.style.setProperty('--plate-in', `${HOVER_IN}ms`);
  doc.documentElement.style.setProperty('--plate-out', `${HOVER_OUT}ms`);
}

const factOfVariant = (ix, a) => ix.factOfVariant.get(a) ?? (a.endsWith('-override') && ix.facts.has(a.slice(0, -9)) ? a.slice(0, -9) : null);

// A text that is a label, not a claim, is found by the key the renderer gave it: `~h:<section>` (a heading), `~t:<fact>` (a language's name)
const labelEl = (doc, key) => [...doc.querySelectorAll('[data-label]')].find(e => `~${e.getAttribute('data-label')}` === key) ?? null;

export function createSheet(host, hooks = {}){
  let fr = null;
  let shown = null, textCache = null;
  let view = { mode: 'spread', page: 0 };
  let marked = { sel: null, ix: null, prev: null, focus: null, miss: null, hover: null, find: null, scope: false };
  let fade = [];
  let card = null, folded = [], foldHome = null;   // a large lifted block: the card carried at the pointer, the elements folded in place and where they stood
  let sockets = [];              // the lifted block's home, one socket for each element it is printed in (a section runs over two pages)
  let tabEls = [], tabHot = false;      // the blocks whose plates show the grip's dots (the line's or group's, the job's or section's), and whether the pointer is on one
  let plates = [];               // the plates over the page (UX-6f 4c): { div, el, role: 'hot' | 'sel' | 'write', on, hid }
  let pv = null;                 // the block a row of the sidebar under the pointer stands for (setHover)
  let hot = null;                // the block whose hover plate is drawn
  const nudged = new Set();      // the elements a drag preview has moved
  let landing = null;            // the lifted block coming down: { anims, done }
  let pending = null;
  let revealed = null;            // the selection last scrolled into view (stack mode)
  let focusKey = '';              // which lines the lens picks, as one string: a redraw that picks the same ones does not brighten them again
  // One drawing at a time: a preview, its end, a redraw and a Fit can overlap, and two on
  // different templates would each swap the iframe out from under the other.
  let chain = Promise.resolve();
  const queue = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  const ro = (recipe, extra = {}) => ({ annotate: true, fallback: true, chrome: hooks.chrome?.(recipe) ?? null, ...extra });

  function frameFor(recipe){
    const sig = [recipe.format, recipe.theme, ...(recipe.overlays ?? [])].join('|');
    if (fr?.sig === sig && fr.frame.isConnected) return Promise.resolve(fr);
    if (pending?.sig === sig) return pending.p;
    const p = new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.title = t('aria.frame');
      frame.setAttribute('scrolling', 'no');
      frame.className = 'sheet-frame';
      frame.src = `templates/${recipe.format}.html`;
      frame.addEventListener('load', async () => {
        const doc = frame.contentDocument;
        const root = doc?.querySelector('.document');
        if (!root) return reject(new Error(`templates/${recipe.format}.html has no .document`));
        const theme = [...doc.querySelectorAll('link[rel=stylesheet]')]
          .find(l => (l.getAttribute('href') ?? '').endsWith(`themes/${recipe.theme}.css`));
        const added = [];
        let after = theme;
        for (const o of recipe.overlays ?? []){
          if (!after) break;
          const l = doc.createElement('link');
          l.rel = 'stylesheet'; l.href = `../themes/${o}.css`;
          after.after(l); after = l;
          added.push(new Promise(r => { l.onload = l.onerror = r; }));
        }
        await Promise.all(added);
        // a theme's tokens and the resume's accent, after the theme
        const tk = doc.createElement('style');
        tk.id = 'rb-tokens';
        doc.head.append(tk);
        const st = doc.createElement('style');
        st.textContent = VIEW_CSS;
        doc.head.append(st);
        doc.documentElement.classList.add('rb-ui');
        paintMarks(doc);
        doc.addEventListener('click', e => {
          if (e.target.closest?.('[contenteditable]:not([contenteditable=false])')) return;      // the line being written takes its own clicks
          const pg = [...doc.querySelectorAll('.document > .page')].indexOf(e.target.closest?.('.document > .page'));
          const hit = e.target.closest?.('[data-variant], [data-label], .band[data-section]'), g = e.target.closest?.('.skills__group');
          const el = g && !g.contains(hit) ? g.querySelector('[data-variant]') ?? hit : hit;      // a skill group's name is its group's (UX-6f 4c: a click on it writes the group)
          if (!el) return hooks.onPick?.({ variant: null, section: null, page: pg });
          const band = el.closest('.band[data-section]');
          hooks.onPick?.({ variant: el.getAttribute('data-variant'), label: el.getAttribute('data-label'), section: band?.getAttribute('data-section') ?? null, page: pg, at: { x: e.clientX, y: e.clientY } });
        });
        // the hand, the wheel and the pinch work over the page too: the canvas gets them, in the page's own pixels
        const fe = hooks.frameEvents;
        if (fe){
          doc.addEventListener('wheel', e => { fe.wheel(frame, e); }, { passive: false });
          doc.addEventListener('pointerdown', e => { fe.down(frame, e); }, { capture: true });
          doc.addEventListener('pointermove', e => fe.move(frame, e), { passive: true });
          doc.addEventListener('pointerup', e => fe.up(frame, e));
          doc.addEventListener('pointercancel', e => fe.up(frame, e));
          for (const g of ['gesturestart', 'gesturechange', 'gestureend']) doc.addEventListener(g, e => fe.gesture(frame, e));
          doc.addEventListener('keydown', e => fe.key.down(e), true);
          doc.addEventListener('keyup', e => fe.key.up(e), true);
        }
        // what is under the pointer, for the grip and the "+" over the page (src/ui/hands.js), and a skill dragged from where it is printed
        for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) doc.addEventListener(ev, e => hooks.onPointer?.(e), { passive: true });
        doc.documentElement.addEventListener('mouseleave', () => hooks.onPointer?.({ type: 'leave' }));
        doc.addEventListener('keydown', e => hooks.onKey?.(e));
        // a file dropped on the page goes to the same door as one dropped on the window (the page is a frame: its drops stay inside it)
        doc.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault(); });
        doc.addEventListener('drop', e => hooks.onDrop?.(e));
        fr = { sig, frame, root, doc, fonts: false };
        pending = null;
        resolve(fr);
      }, { once: true });
      host.querySelector('.sheet-frame')?.remove(); host.prepend(frame);
    });
    pending = { sig, p };
    return p;
  }

  async function settle(f){
    void f.doc.body?.offsetHeight;
    try { await f.doc.fonts?.ready; } catch { /* measure what is there */ }
    f.fonts = true;
  }

  // measuring sees every page; how they are arranged never matters to it
  const allShown = f => f.doc.documentElement.classList.remove('rb-single');

  async function layoutIn(f, work, recipe){
    return autoLayout(work, recipe, async flow => {
      mount(f.root, work, flow, ro(recipe));
      return measureBlocks(f.root);
    });
  }

  function size(f, n, format){
    const { w, h } = pageSize(format);
    const one = view.mode === 'single' || n < 2;
    const cols = one || view.mode === 'stack' ? 1 : n;
    const rows = !one && view.mode === 'stack' ? n : 1;
    f.frame.style.width = `${cols * w + (cols - 1) * PAGE_GAP}px`;
    f.frame.style.height = `${rows * h + (rows - 1) * PAGE_GAP}px`;
  }

  function applyView(){
    if (!fr || !shown) return;
    const pages = [...fr.root.querySelectorAll(':scope > .page')];
    view.page = Math.max(0, Math.min(view.page, pages.length - 1));
    const html = fr.doc.documentElement;
    html.classList.toggle('rb-single', view.mode === 'single' && pages.length > 1);
    html.classList.toggle('rb-stack', view.mode === 'stack' && pages.length > 1);
    pages.forEach((p, i) => { p.classList.toggle('rb-shown', i === view.page); p.classList.toggle('rb-faded', !!fade[i]); });
    size(fr, pages.length, shown.laid.format);
  }

  function tokens(f, recipe){
    const css = hooks.extraCss?.(recipe) ?? '';
    const el = f.doc.getElementById('rb-tokens');
    if (el && el.textContent !== css) el.textContent = css;
  }

  async function draw(work, recipe){
    const f = await frameFor(recipe);
    tokens(f, recipe);
    PM.clearGhosts(f);
    if (!f.fonts){ mount(f.root, work, recipe.pages ? recipe : { ...recipe, pages: [['header']] }, ro(recipe)); await settle(f); }
    allShown(f);
    const laid = await layoutIn(f, work, recipe);
    mount(f.root, work, laid, ro(recipe));
    const pages = measurePages(f.root);
    return { f, laid, pages };
  }

  // ---- moments on the page (src/ui/pagemotion.js) ----
  // `mo` = { kind, words?, ix?, foreign? } asks for a morph from how the page is now to how this draw leaves it. The "before" is taken
  // here, inside the queue, so a draw that overlaps another still morphs from what is really on the screen. A draw that follows
  // while a morph is under way replays it from where its clock is, so the probe's second draw does not cut it short.
  let ongoing = null;
  // Fit measures by drawing its candidates in this frame, so it takes its "before" first (take()) and hands it in as mo.pre
  const before = mo => {
    if (!mo || reduced() || !fr?.frame.isConnected) return null;
    if (mo.pre) return mo.pre.f === fr ? { mo, f: fr, snap: mo.pre.snap } : null;
    return { mo, f: fr, snap: mo.kind === 'switch' ? PM.pageSnapshot(fr) : PM.snapshot(fr, marked.ix ?? mo.ix, { words: mo.words }) };
  };
  function after(b){
    if (reduced()){ ongoing = null; return; }
    const now = performance.now();
    let use = b ? { ...b, t0: now } : ongoing && now - ongoing.t0 < ongoing.total ? ongoing : null;
    if (!use){ ongoing = null; return; }
    const offset = b ? 0 : now - use.t0, ix = use.mo.ix ?? marked.ix;
    let total = 0;
    if (use.mo.kind === 'switch'){
      if (use.snap.doc === fr.doc) total = PM.crossfade(fr, use.snap, { offset });
      else if (b){ const a = play(fr.frame, [{ opacity: 0 }, { opacity: 1 }], { ms: dur('base') * 1.2, fill: 'backwards', name: 'switch:frame' }); total = a ? dur('base') * 1.2 : 0; }
    } else total = PM.morph(fr, use.snap, ix, { kind: use.mo.kind, words: use.mo.words, foreign: use.mo.foreign, offset });
    use.total = total;
    ongoing = total > 0 ? use : null;
  }

  // the printed lines (a claim's element, the outermost when two nest) whose words hold the search, in page order
  function findEls(){
    const n = (marked.find ?? '').trim().toLowerCase();
    if (!n || !fr?.frame.isConnected) return [];
    const hit = [...fr.doc.querySelectorAll('[data-variant]')].filter(el => el.textContent.toLowerCase().includes(n));
    return hit.filter(el => !hit.some(o => o !== el && o.contains(el)));
  }

  // the paper under the plate: a lifted block and a written line take its colour, so what is behind them does not show through
  function paper(){
    const win = fr.doc.defaultView, pg = fr.doc.querySelector('.document > .page'), c = pg && win ? win.getComputedStyle(pg).backgroundColor : '';      // (no window: the frame was swapped out)
    fr.doc.documentElement.style.setProperty('--plate-paper', !c || /rgba\(.*, 0\)|transparent/.test(c) ? '#fff' : c);
  }
  const unsocket = () => { for (const q of sockets) q.remove(); sockets = []; };
  // ---- the plates that move (UX-6f 4c): hover and selection are drawn by shapes laid over the page, one per block, that glide from block to block ----
  // What is wanted: while a line is written, its field's plate (pressed in); else the selection's (each element it is printed in) and the hovered block's, unless that is selected.
  // A plate keeps to its role (the hover's moves with the hover, the selection's with the selection) and glides from where it is, or from where it was let go GLIDE_KEEP ms ago;
  // otherwise it appears where it goes. Nothing is drawn while a block is lifted (the lifted block wears its own plate). Reduced motion: no glide (the frame's rb-still).
  function wantedPlates(){
    if (!fr?.frame.isConnected || nudged.size) return [];
    const d = fr.doc;
    if (d.documentElement.classList.contains('rb-writing')){ const ed = d.querySelector('[contenteditable]:not([contenteditable=false])'); return ed ? [{ el: ed, role: 'write' }] : []; }
    const sel = [...d.querySelectorAll('.rb-sel')], out = sel.map(el => ({ el, role: 'sel' }));
    const lead = pv?.isConnected ? pv : hot;      // (the sidebar's hover is the one hover plate; the pointer is not on the page then)
    if (lead?.isConnected && !sel.includes(lead)) out.push({ el: lead, role: 'hot', boost: lead === pv });
    if (marked.scope) for (const el of sel.filter(e => e.classList.contains('rb-scope'))) out.push({ el, role: 'scope', mode: marked.scope });      // the chip's tick or padlock: a second plate on the selection
    return out;
  }
  const family = r => (r === 'hot' || r === 'scope' ? r : 'sel');
  // How far a plate stands off its box (UX-6f 4c): its level's stand-off (`po`), but never so far that its rule (`lw` px) passes half the gap to the printed text around it
  // (negative: the rule is drawn inside the box). Across (x) the words on the same rows count, up and down (y) the words above and below it, so a line keeps its stand-off to
  // the side (where its grip stands) and comes in where the next line is close; `u` is one stand-off all round (the nearest words in any direction), a written line's. Hover,
  // selection, the socket and the hands on them take the selection's rule (the thicker), so a plate keeps its shape from hover to selection.
  function fitOff(r, po, lw){
    lw ??= Math.max(1, parseFloat(fr.doc.defaultView.getComputedStyle(fr.doc.documentElement).getPropertyValue('--plate-line')) || 2);
    const right = r.left + r.width, bottom = r.top + r.height;
    const under = (cx, cy) => folded.some((el, i) => { const h = foldHome[i]; return cx >= h.left && cx <= h.left + h.width && cy > h.top + parseFloat(el.style.getPropertyValue('--fold')) && cy <= h.top + h.height; });
    let g = Infinity, gx = Infinity, gy = Infinity, gl = Infinity;
    for (const q of api.textRects()){
      const cx = q.left + q.width / 2, cy = q.top + q.height / 2;
      if ((cx >= r.left && cx <= right && cy >= r.top && cy <= bottom) || under(cx, cy)) continue;      // its own words, and those a folded block hides
      const dx = Math.max(q.left - right, r.left - q.left - q.width, 0), dy = Math.max(q.top - bottom, r.top - q.top - q.height, 0);
      g = Math.min(g, Math.hypot(dx, dy));
      if (!dy){ gx = Math.min(gx, dx); if (q.left + q.width <= r.left) gl = Math.min(gl, dx); } else if (dx < po + lw) gy = Math.min(gy, dy);      // (words further across than the plate reaches are never under it)
    }
    const fit = d => Math.max(-lw, Math.min(po, Math.floor(d / 2 - lw)));      // whole pixels: an outline's offset is drawn on them
    return { x: fit(gx), y: fit(gy), u: fit(g), l: gl };      // l: the gap to the words left of it on its rows (the grip's tab widens the plate into it)
  }
  const poOf = el => parseFloat(fr.doc.defaultView.getComputedStyle(el).getPropertyValue('--po')) || 0;
  const standOff = (el, lw) => fitOff(el.getBoundingClientRect(), poOf(el), lw);
  const tabW = () => parseFloat(fr.doc.defaultView.getComputedStyle(fr.doc.documentElement).getPropertyValue('--plate-tab-w')) || 14;
  const lw0 = () => Math.max(1, parseFloat(fr.doc.defaultView.getComputedStyle(fr.doc.documentElement).getPropertyValue('--plate-line')) || 1);
  const writeRule = () => Math.max(1, parseFloat(fr.doc.defaultView.getComputedStyle(fr.doc.documentElement).getPropertyValue('--plate-write')) || 1);      // the rule as drawn (a browser rounds a thin one up to a whole pixel)
  function paintPlates(){
    if (!fr?.doc) return;
    const win = fr.doc.defaultView, now = performance.now(), want = wantedPlates(), spare = plates.filter(p => p.div.isConnected && p.div.ownerDocument === fr.doc), used = [];
    plates = spare;
    for (const w of want){
      const pick = f => spare.find(q => !used.includes(q) && f(q));
      let p = pick(q => q.on && q.el === w.el && (q.role === 'scope') === (w.role === 'scope')) ?? pick(q => family(q.role) === family(w.role) && (q.on || now - q.hid < GLIDE_KEEP)) ?? pick(q => !q.on && (q.role === 'scope') === (w.role === 'scope'));
      const glide = !!p && (p.on || now - p.hid < GLIDE_KEEP) && family(p.role) === family(w.role);
      if (!p){ const div = fr.doc.createElement('div'); div.className = 'rb-plate'; div.setAttribute('aria-hidden', 'true'); fr.doc.body.append(div); p = { div, on: false, hid: 0 }; plates.push(p); }
      used.push(p);
      const cs = win.getComputedStyle(w.el), r = w.el.getBoundingClientRect(), f = w.role === 'write' ? standOff(w.el, writeRule()) : standOff(w.el), o = w.role === 'write' ? { x: f.u, y: f.u } : f;
      // the grip (item 4): its 2x3 dots are this plate's, in a tab it widens into on the left when the gap to the words there leaves room, else inside its own edge
      const tab = tabEls.includes(w.el), tw = tab && o.x + tabW() + lw0() <= f.l - 1 ? tabW() : 0;
      const st = { left: `${r.left - o.x - tw}px`, top: `${r.top - o.y}px`, width: `${r.width + 2 * o.x + tw}px`, height: `${r.height + 2 * o.y}px` };
      p.box = tab ? { left: r.left - o.x - tw, top: r.top - o.y, width: Math.max(tw, tabW()), height: r.height + 2 * o.y } : null;
      if (!glide) p.div.style.transition = 'none';
      Object.assign(p.div.style, st);
      p.o = o; p.div.style.setProperty('--po', `${Math.max(o.x, o.y)}px`);      // (its corner: the block's turned by the stand-off across, where the grip joins it)
      p.div.style.setProperty('--pk', cs.getPropertyValue('--pk').trim() || '1');      // its level's tint scale (a job's and a section's fainter)
      for (const k of ['hot', 'sel', 'write', 'scope']) p.div.classList.toggle(`is-${k}`, k === w.role);
      p.div.classList.toggle('is-boost', !!w.boost);
      for (const k of ['hide', 'show', 'lock', 'unlock']) p.div.classList.toggle(`is-${k}`, k === w.mode);
      p.div.classList.toggle('is-grip', tab); p.div.style.setProperty('--tw', `${tw}px`); p.div.classList.toggle('is-grip-hot', tab && tabHot);
      if (!glide){ void p.div.offsetWidth; p.div.style.transition = ''; }
      p.div.classList.add('is-on'); p.on = true; p.el = w.el; p.role = w.role;
    }
    for (const p of plates.filter(q => q.role === 'scope' && !used.includes(q))){ p.div.remove(); plates.splice(plates.indexOf(p), 1); }      // (the chip's preview goes at once, and comes the same way again)
    for (const p of plates) if (!used.includes(p) && p.on){ p.on = false; p.hid = now; p.div.classList.remove('is-on'); }
    for (const p of plates.filter(q => !q.on && now - q.hid > 2000)){ p.div.remove(); plates.splice(plates.indexOf(p), 1); }      // (spares long out of use)
    // a written line that grows takes its plate along: its size is watched (by the frame's own observer, and only when the set changes: observing reports at once)
    const set = used.map(p => p.el);
    if (watch.doc !== fr.doc){ watch.ro?.disconnect(); watch.doc = fr.doc; watch.ro = win.ResizeObserver ? new win.ResizeObserver(() => paintPlates()) : null; watch.els = []; }
    if (set.length !== watch.els.length || set.some((e, i) => e !== watch.els[i])){ watch.ro?.disconnect(); for (const e of set) watch.ro?.observe(e); watch.els = set; }
  }
  const watch = { doc: null, ro: null, els: [] };
  // translate (and squash, `sq`: by this fraction of its size along each axis, positive when it is pushed down or right, so its leading edge holds), about that edge: no transform-origin to put back
  const xform = (dx, dy, sq, el) => {
    const f = (v, size) => (v ? { s: 1 - Math.abs(v), t: v > 0 ? size * Math.abs(v) : 0 } : { s: 1, t: 0 }), qx = f(sq?.x, el.offsetWidth), qy = f(sq?.y, el.offsetHeight);
    return dx || dy ? `translate(${(dx ?? 0) + qx.t}px, ${(dy ?? 0) + qy.t}px)${qx.s !== 1 || qy.s !== 1 ? ` scale(${qx.s}, ${qy.s})` : ''}` : '';
  };
  // the page's elements of a block { kind: 'bullet' | 'job' | 'section' | 'header', id }: what a selection or a row under the pointer in the sidebar stands for
  const byFacts = (id, ix) => {
    const vs = new Set([...(ix.facts.get(id)?.variants ?? []), `${id}-override`]);
    return [...fr.doc.querySelectorAll('[data-variant]')].filter(el => vs.has(el.getAttribute('data-variant')));
  };
  function elsOf(sel, ix){
    const byFactsOf = facts => facts.flatMap(id => byFacts(id, ix));
    let els = [];
    if (sel.kind === 'bullet') els = isLabelKey(sel.id) ? [labelEl(fr.doc, sel.id)].filter(Boolean) : byFactsOf([sel.id]);
    else if (sel.kind === 'job'){
      const w = ix.work.get(sel.id);
      els = byFactsOf([w?.display?.position].filter(Boolean)).map(el => el.closest('.entry') ?? el);
    }
    else if (sel.kind === 'section') els = [...fr.doc.querySelectorAll(`.band[data-section="${CSS.escape(sel.id)}"]`)];
    else if (sel.kind === 'header') els = [...fr.doc.querySelectorAll('.band[data-section="header"]')];
    els = els.map(el => el.closest('.skills__group') ?? el);      // a skill group is one block, its name and its skills
    return els;
  }
  function mark(){ markEls(); paintPlates(); }
  function markEls(){
    if (!fr) return;
    for (const el of fr.doc.querySelectorAll('.rb-sel, .rb-scope, .rb-fade, .rb-prev, .rb-hit, .rb-find, .rb-miss, .rb-miss-tab')) el.classList.remove('rb-sel', 'rb-scope', 'rb-fade', 'rb-prev', 'rb-hit', 'rb-find', 'rb-miss', 'rb-miss-tab');
    paper();
    // texts with no version in the resume's language print in English, outlined
    if (marked.miss && marked.ix){
      for (const el of fr.doc.querySelectorAll('[data-variant]')){
        const f = factOfVariant(marked.ix, el.getAttribute('data-variant'));       // a skill group of an arrangement is printed as <fact>-override
        if (f && marked.miss.facts.has(f)) el.classList.add('rb-miss');
      }
      for (const id of marked.miss.headings) for (const t of fr.doc.querySelectorAll(`.band[data-section="${CSS.escape(id)}"] .tab`)) t.classList.add('rb-miss-tab');
    }
    for (const el of findEls()) el.classList.add('rb-find');      // the search's second highlight; the page's own markup is untouched
    fr.doc.documentElement.classList.toggle('rb-focus', !!marked.focus);
    if (marked.focus && marked.ix){
      for (const el of fr.doc.querySelectorAll('[data-variant]')){
        const a = el.getAttribute('data-variant');
        const f = marked.ix.factOfVariant.get(a) ?? (a.endsWith('-override') ? a.slice(0, -9) : null);
        if (f && marked.focus.has(f)) el.classList.add('rb-hit');
      }
    }
    pv = marked.hover && marked.ix ? elsOf(marked.hover, marked.ix)[0] ?? null : null;      // a row of the sidebar under the pointer: its block takes the page's one hover plate, a little stronger
    const { sel, ix } = marked;
    if (!sel || !ix) return;
    const els = elsOf(sel, ix);
    for (const el of els) el.classList.add('rb-sel');      // the plate (no rings round what it is part of)
    if (marked.scope) for (const el of els) el.classList.add('rb-scope', ...(marked.scope === 'hide' ? ['rb-fade'] : []));      // the chip's tick or lock under the pointer: what it would act on, never in the render
    if (marked.prev) for (const el of byFacts(marked.prev, ix)) el.classList.add('rb-prev');
    const key = sel.kind === 'none' ? null : JSON.stringify(sel);
    if (els[0] && view.mode === 'stack' && key !== revealed){
      // stacked pages scroll: ask the shell to bring it into view, if it isn't
      revealed = key;
      const pages = [...fr.root.querySelectorAll(':scope > .page')];
      const at = pages.indexOf(els[0].closest('.page'));
      const r = els[0].getBoundingClientRect();
      if (at >= 0) hooks.onReveal?.({ page: at, top: r.top, bottom: r.bottom });
    } else if (view.mode === 'single' && els[0]){
      const pages = [...fr.root.querySelectorAll(':scope > .page')];
      const at = pages.indexOf(els[0].closest('.page'));
      if (at >= 0 && at !== view.page){ view.page = at; applyView(); hooks.onPage?.(at); }
    }
    if (!key) revealed = null;
  }

  const api = {
    get pageCount(){ return shown?.laid.pages?.length ?? 1; },
    get laid(){ return shown?.laid ?? null; },
    get pages(){ return shown?.pages ?? []; },

    take(mo){ return before(mo); },
    reveal(){ return fr?.frame.isConnected ? PM.reveal(fr) : 0; },
    show(work, recipe, mo = null){ return queue(() => this._show(work, recipe, mo)); },
    async _show(work, recipe, mo = null){
      const b = before(mo);
      const { laid, pages } = await draw(work, recipe);
      fr.doc.documentElement.classList.remove('rb-previewing');
      shown = { work, recipe, laid, pages };
      textCache = null;
      applyView();
      marked.prev = null;
      mark();
      after(b);
      hooks.onDrawn?.();
      return { laid, pages };
    },

    preview(work, recipe, fact = null, mo = null){ return queue(() => this._preview(work, recipe, fact, mo)); },
    async _preview(work, recipe, fact = null, mo = null){
      const b = before(mo);
      const { laid, pages } = await draw(work, recipe);
      fr.doc.documentElement.classList.add('rb-previewing');
      shown = { ...shown, laid };
      textCache = null;
      applyView();
      marked.prev = fact;
      mark();
      after(b);
      hooks.onDrawn?.();
      return { laid, pages };
    },
    endPreview(mo = null){ return queue(() => (shown ? this._show(shown.work, shown.recipe, mo) : null)); },

    // For Fit: the same DOM measurement as the meter; the caller redraws afterwards.
    measure(work, recipe){ return queue(() => this._measure(work, recipe)); },
    async _measure(work, recipe){
      const f = await frameFor(recipe);
      tokens(f, recipe);
      allShown(f);
      mount(f.root, work, recipe, ro(recipe));
      return measurePages(f.root);
    },
    layout(work, recipe){ return queue(async () => { const f = await frameFor(recipe); tokens(f, recipe); allShown(f); return layoutIn(f, work, recipe); }); },
    // Line counts for every phrasing in the recipe's language at this format (see src/render.js).
    probe(work, recipe){ return queue(() => this._probe(work, recipe)); },
    async _probe(work, recipe){
      const f = await frameFor(recipe);
      tokens(f, recipe);
      if (!f.fonts) await settle(f);
      allShown(f);
      const k = measureKey(recipe);
      // only the sections this resume prints: a probe of a section it leaves
      // out could need a language that section does not have
      const pr = probeRecipe(work, recipe);
      const wanted = new Set(['header', 'summary', ...(recipe.sections ?? []).map(s => s?.id ?? s),
        ...(recipe.pages ?? []).flat().map(x => (typeof x === 'string' ? x : x.id))]);
      pr.pages = [pr.pages[0].filter(id => wanted.has(id))];
      for (let i = 0, n = probeCount(work, recipe); i < n; i++){
        mount(f.root, work, pr, ro(recipe, { probe: i, annotate: false }));
        applyMeasured(work, k, measureVariants(f.root));
      }
    },

    // each page's box in its own pixels, and where its bottom margin begins: what the overflow line is drawn from
    pageBoxes(){
      const win = fr?.doc.defaultView;
      if (!win || !fr.frame.isConnected) return [];     // the frame was swapped for another one that has not loaded yet
      return [...fr.root.querySelectorAll(':scope > .page')].map(pg => {
        const r = pg.getBoundingClientRect(), pb = parseFloat(win.getComputedStyle(pg).paddingBottom) || 0;
        const cs = win.getComputedStyle(pg);
        return { left: r.left, top: r.top, width: r.width, height: r.height, limit: r.top + r.height - pb, bg: cs.backgroundColor, padRight: parseFloat(cs.paddingRight) || 0 };
      });
    },
    // the element a claim is printed in (the first, when it is printed twice), for the line to be written in place
    elOf(factId, ix){
      if (!fr?.frame.isConnected) return null;
      const vs = new Set([...(ix.facts.get(factId)?.variants ?? []), `${factId}-override`]);
      const el = isLabelKey(factId) ? labelEl(fr.doc, factId) : [...fr.doc.querySelectorAll('[data-variant]')].find(e => vs.has(e.getAttribute('data-variant')));
      return el?.querySelector(':scope > [data-write]') ?? el ?? null;      // an item's title is written without its subtitle (onpage.js wraps it while it is written)
    },
    // the item a text is part of, as a rectangle in the page's own pixels: an item of education or patent as a whole, a language's name and level together, else the text
    rectOfItem(factId, ix){
      const rs = this.itemEls(factId, ix).map(e => this.rectOfEl(e));
      if (!rs.length) return null;
      const l = Math.min(...rs.map(r => r.left)), tp = Math.min(...rs.map(r => r.top));
      return { left: l, top: tp, width: Math.max(...rs.map(r => r.left + r.width)) - l, height: Math.max(...rs.map(r => r.top + r.height)) - tp };
    },
    itemEls(factId, ix){
      const el = this.elOf(factId, ix);
      return el ? [el.closest('.item__title, .meta--flat') ? el.closest('.band__content') : el.closest('dd') ? el.closest('dd').previousElementSibling : el.closest('dt') ? el.closest('dt').nextElementSibling : null, el.closest('dd') ?? el].filter(Boolean) : [];
    },
    // which page a claim is printed on (-1 when it is not on the page)
    pageOf(factId, ix){
      const el = this.elOf(factId, ix);
      const pg = el?.closest('.document > .page');
      return pg ? [...fr.root.querySelectorAll(':scope > .page')].indexOf(pg) : -1;
    },
    // every run of printed text, as rectangles in the page's own pixels (what the layers over the page keep clear of); cached until the next draw
    textRects(){
      if (!fr?.doc || !fr.frame.isConnected) return [];
      if (textCache) return textCache;
      const out = [], walker = fr.doc.createTreeWalker(fr.root, 4), range = fr.doc.createRange();
      for (let n = walker.nextNode(); n; n = walker.nextNode()){
        if (!n.nodeValue.trim()) continue;
        range.selectNodeContents(n);
        for (const q of range.getClientRects()) if (q.width > 1 && q.height > 1) out.push({ left: q.left, top: q.top, width: q.width, height: q.height });
      }
      return (textCache = out);
    },
    // a rectangle of an element of the frame, in the page's own pixels
    rectOfEl(el){ const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; },
    get doc(){ return fr?.doc ?? null; },
    // pages the camera has set aside are faded, and stay clickable
    setFade(list){ fade = list ?? []; if (!fr) return; [...fr.root.querySelectorAll(':scope > .page')].forEach((p, i) => p.classList.toggle('rb-faded', !!fade[i])); },
    // the cursor over the page while the hand is on the canvas
    // Linux only (canvas.js): no blurred shadow on the pages while they move, which software painting redraws every frame
    setMoving(on){ fr?.doc.documentElement.toggleAttribute('data-rb-moving', on); },
    setHand(handing, space){ if (!fr) return; fr.doc.documentElement.classList.toggle('rb-handing', !!handing); fr.doc.documentElement.classList.toggle('rb-space', !!space); },
    setView(next){ const before = view.mode; view = { ...view, ...next }; if (view.mode !== before) revealed = null; applyView(); mark(); },
    get view(){ return { ...view }; },

    select(sel, ix){ marked.sel = sel; marked.ix = ix; marked.scope = false; mark(); },
    setScope(on, mode){ const next = on ? mode || 'show' : false; if (marked.scope === next) return; marked.scope = next; mark(); },
    // the search over the open resume's page: its lines marked (nothing is written); `finds` is their claims, in page order
    setFind(q, ix){ marked.find = q || null; if (ix) marked.ix = ix; mark(); },
    finds(ix){ return findEls().map(el => factOfVariant(ix, el.getAttribute('data-variant'))).filter(Boolean); },
    setMissing(list, ix){
      marked.miss = list?.length ? { facts: new Set(list.filter(x => x.kind === 'fact').map(x => x.id)), headings: list.filter(x => x.kind === 'heading').map(x => x.id) } : null;
      if (ix) marked.ix = ix; mark();
    },
    // a row of the record checklist is under the pointer: its line on the page lights up, if it is on the page
    setHover(h, ix){ marked.hover = typeof h === 'string' ? { kind: 'bullet', id: h } : h; if (ix) marked.ix = ix; mark(); },
    // where something is on the page, in the page's own pixels (undefined when it is not there)
    rectOf(factId, ix){
      if (!fr) return null;
      const vs = new Set([...(ix.facts.get(factId)?.variants ?? []), `${factId}-override`]);
      const el = [...fr.doc.querySelectorAll('[data-variant]')].find(e => vs.has(e.getAttribute('data-variant')));
      if (!el) return null;
      const r = el.getBoundingClientRect(), page = el.closest('.page')?.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height, page: page ? { left: page.left, top: page.top } : null };
    },
    // every band a section is printed in (one a page it runs over), in the page's own pixels
    rectsOfBand(id){ return [...(fr?.doc.querySelectorAll(`.band[data-section="${CSS.escape(id)}"]`) ?? [])].map(e => this.rectOfEl(e)); },
    // a section's band, in the page's own pixels: the one on the same page as `near` (a rectangle) when it runs over two pages, else the first
    rectOfBand(id, near){
      const rs = [...(fr?.doc.querySelectorAll(`.band[data-section="${CSS.escape(id)}"]`) ?? [])].map(e => this.rectOfEl(e));
      return (near && rs.find(r => near.left >= r.left - 40 && near.left < r.left + r.width + 40)) || rs[0] || null;
    },
    // a line being written is part of the page: the rest of the text fades a little (dim, 60 to 100); null when nothing is written
    setWriting(dim){
      const d = fr?.doc?.documentElement; if (!d) return;
      d.classList.toggle('rb-writing', dim != null);
      if (dim == null){ d.style.removeProperty('--rb-wo'); return paintPlates(); }
      d.style.setProperty('--rb-wdim', String(dim / 100));
      const el = fr.doc.querySelector('[contenteditable]:not([contenteditable=false])');
      if (el) d.style.setProperty('--rb-wo', `${standOff(el, writeRule()).u}px`);
      paintPlates();
    },
    // the written field's rule as drawn, in the page's pixels: its stand-off ({ x, y }) and its width (the grip stands flush on it)
    writeShape(){ const p = plates.find(q => q.on && q.role === 'write'); return p ? { ...p.o, rule: parseFloat(fr.doc.defaultView.getComputedStyle(p.div).outlineWidth) || 1 } : null; },
    // a block's plate's stand-off ({ x, y, u }: fitOff), and the same for any box of the page (`r`, the page's pixels) at the stand-off `po`: the rail of a drag, a frame
    standOff: (el, lw) => standOff(el, lw),
    fitOff: (r, po, lw) => fitOff(r, po, lw),
    // a job's box on the page, in the page's own pixels from the sheet's corner
    jobEl(jobId, ix){
      const w = ix.work.get(jobId);
      const vs = new Set([...(ix.facts.get(w?.display?.position)?.variants ?? []), `${w?.display?.position}-override`]);
      return fr ? [...fr.doc.querySelectorAll('[data-variant]')].find(e => vs.has(e.getAttribute('data-variant')))?.closest('.entry') ?? null : null;
    },
    rectOfJob(jobId, ix){
      const el = this.jobEl(jobId, ix);
      return el ? this.rectOfEl(el) : null;
    },
    // a job's heading (title and date line) as a rectangle: where the pointer finds the job's grip
    jobHeadRect(el){
      const rs = [...el.querySelectorAll(':scope > .role-title, :scope > .meta')].map(e => this.rectOfEl(e));
      if (!rs.length) return null;
      const l = Math.min(...rs.map(r => r.left)), tp = Math.min(...rs.map(r => r.top));
      return { left: l, top: tp, width: Math.max(...rs.map(r => r.left + r.width)) - l, height: Math.max(...rs.map(r => r.top + r.height)) - tp };
    },
    // ---- the plate of the block under the pointer (hands.js), one at a time, drawn with the selection's by the plates that move (paintPlates) ----
    // the element a hand's block is printed in: a line, a skill group, a job, a section's band
    plateOf(h, ix){ return h?.k === 'job' ? this.jobEl(h.fact, ix) : h?.k === 'section' ? this.blockEls('section', h.fact, ix)[0] ?? null : h?.k === 'line' || h?.k === 'group' ? this.blockEls(h.k, h.fact, ix)[0] ?? null : null; },
    // the deepest text under a point (a summary, a title, a language, a heading): the plate of what is not a line or a job
    plateAt(x, y){ return fr?.frame.isConnected ? fr.doc.elementFromPoint(x, y)?.closest('[data-variant], [data-label]') ?? null : null; },
    // the blocks whose plates show the grip's dots (item 4): at most the line's or group's and the job's, section's or item's; `hot`: the pointer is on a grip (full dots while writing)
    setTab(els, hot = tabHot){ const t = (els ?? tabEls).filter(e => e?.isConnected); if (hot !== tabHot || t.length !== tabEls.length || t.some((e, i) => e !== tabEls[i])){ tabEls = t; tabHot = hot; paintPlates(); } },
    // where the tab of a block's plate is to be, in the page's pixels (not where a glide has it now): the grip's button is laid over it
    // the camera is moving (canvas.js): the plates take their new shape at once, never tweening against the ease (a glide under way ends where it was going)
    camMoving(on){ fr?.doc.documentElement.classList.toggle('rb-cam', on); },
    tabBox(el){ const p = el && plates.find(q => q.on && q.box && q.el === el); return p ? { ...p.box } : null; },
    // for the checks: the block that is hovered, how many hover plates are drawn (one at most: the plate moves), the strongest of them (0 to 1), and whether it is gliding
    plateState(){
      const win = fr?.frame.isConnected ? fr.doc.defaultView : null, ps = win ? plates.filter(p => p.role === 'hot' && p.div.isConnected) : [], on = ps.find(p => p.on);
      const key = e => e && (e.getAttribute('data-variant') ?? e.getAttribute('data-label') ?? e.getAttribute('data-section') ?? e.querySelector(':scope > .role-title')?.getAttribute('data-variant') ?? e.tagName);
      const op = p => +win.getComputedStyle(p.div).opacity, mine = on ?? (hot?.isConnected ? plates.find(p => p.on && p.el === hot) : null);      // (a hovered block that is selected wears the selection's plate)
      return { hot: key(mine?.el) ?? null, hots: mine ? 1 : 0, n: ps.filter(p => op(p) > 0).length, a: Math.max(0, ...ps.map(op), mine ? op(mine) : 0), moving: !!mine && mine.div.getAnimations().some(a => /^(top|left|height)$/.test(a.transitionProperty)) };
    },
    setHot(el){
      const next = el?.isConnected ? el : null;
      if (hot === next) return;
      hot?.classList.remove('rb-hot');      // the marker of the block under the pointer (the plate itself is drawn over it)
      hot = next; hot?.classList.add('rb-hot');
      paintPlates();
    },
    plates(){ return plates.filter(p => p.on && p.div.isConnected).map(p => ({ role: p.role, div: p.div, el: p.el })); },
    // the dashed socket of a lifted block: where it will land (`to`, from its home: { dx, dy }), the same shape as its plate; it is made where the block is, the first time
    socket(els, to){
      if (!fr?.frame.isConnected || !els?.length) return;
      if (!sockets.length) for (const el of els){
        const r = el.getBoundingClientRect(), q = fr.doc.createElement('div');
        q.className = 'rb-socket'; q.setAttribute('aria-hidden', 'true');
        const h = el.classList.contains('rb-fold') ? parseFloat(el.style.getPropertyValue('--fold')) : r.height, o = fitOff({ left: r.left, top: r.top, width: r.width, height: h }, poOf(el));      // the plate's shape, fitted as the plate is (a folded block's to its heading)
        Object.assign(q.style, { left: `${r.left - o.x}px`, top: `${r.top - o.y}px`, width: `${r.width + 2 * o.x}px`, height: `${h + 2 * o.y}px`, borderRadius: `calc(var(--plate-r) + ${Math.max(o.x, o.y)}px)` });
        q.style.setProperty('--po', '0px');
        fr.doc.body.append(q); sockets.push(q);
      }
      for (const q of sockets) q.style.transform = to ? `translate(${to.dx ?? 0}px, ${to.dy ?? 0}px)` : '';
    },
    // the rail and the drop line of a drag over the page (hands.js), `r` in the page's pixels (null: gone); `on`: its states ({ top, faint, … }). Frame furniture under the
    // lifted block, which stays the topmost thing on the page (UX-6f 4c)
    guide(kind, r, on = {}){
      if (!fr?.frame.isConnected) return;
      let el = fr.doc.querySelector(`body > .rb-${kind}`);
      if (!r){ el?.remove(); return; }
      if (!el){ el = fr.doc.createElement('div'); el.className = `rb-${kind}`; el.setAttribute('aria-hidden', 'true'); fr.doc.body.append(el); }
      Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      for (const [k, v] of Object.entries(on)) el.classList.toggle(`is-${k}`, !!v);
    },
    // ---- a block taller than a third of its page (hands.js) is carried as a card, and its home folds to its heading: the elements are clipped, never reflowed ----
    // a block's heading: its height in the page's pixels (the title and the date line under it, else the first row) and its words
    headOf(el){
      const r = el.getBoundingClientRect(), b = Math.max(0, ...[el.querySelector('.role-title'), el.querySelector('.meta')].filter(Boolean).map(e => e.getBoundingClientRect().bottom));
      return { h: Math.ceil(Math.min(r.height, b ? b - r.top : 28)) + 2, text: (el.querySelector('.tab, .role-title')?.textContent ?? '').trim() };
    },
    // folds each element to its heading, and (with `label`) makes the card that stands for the block, returning its size
    fold(els, label){
      if (!fr?.frame.isConnected || !els.length) return null;
      folded = els; foldHome = els.map(e => this.rectOfEl(e));
      for (const el of els){ el.style.setProperty('--fold', `${this.headOf(el).h}px`); el.classList.add('rb-fold'); nudged.add(el); }
      if (label == null) return null;
      card = fr.doc.createElement('div');
      card.className = 'rb-card'; card.setAttribute('aria-hidden', 'true'); card.textContent = label;
      card.style.setProperty('--po', fr.doc.defaultView.getComputedStyle(els[0]).getPropertyValue('--po'));
      fr.doc.body.append(card);
      return { w: card.offsetWidth, h: card.offsetHeight };
    },
    // the card at (x, y) in the page's pixels, squashed by `sq` against the bumper
    carry(x, y, sq){ if (card) card.style.transform = xform(x, y, sq, card) || 'translate(0px, 0px)'; },
    unfold(){
      for (const el of folded){ el.classList.remove('rb-fold'); el.style.removeProperty('--fold'); }
      card?.remove(); card = null; folded = []; foldHome = null;
    },
    // ---- the live reorder preview (hands.js): blocks moved by a transform alone, never in the document; unnudge puts every one back exactly ----
    // the elements a block is printed in: a line, a skill group, a job, a section's band or an item
    blockEls(kind, id, ix){
      if (!fr?.frame.isConnected) return [];
      if (kind === 'job') return [this.jobEl(id, ix)].filter(Boolean);
      if (kind === 'section') return [...fr.doc.querySelectorAll(`.band[data-section="${CSS.escape(id)}"]`)];
      if (kind === 'item') return this.itemEls(id, ix);
      const el = this.elOf(id, ix);
      return [el?.closest(kind === 'line' ? 'li' : '.skills__group')].filter(Boolean);
    },
    // moves: [{ els, dx, dy, lift, glide }] in the page's pixels; a neighbour pops across (FEEL.POP, none under reduced motion) from where it is now, even when it is
    // already sliding; the lifted block follows at once (`glide`: it slides, as when no pointer is on the page), rising with its shadow when it is first lifted
    nudge(moves){
      const now = el => { const t = fr.doc.defaultView.getComputedStyle(el).transform; return t === 'none' ? '' : t; };
      for (const m of moves) for (const el of m.els){
        const to = xform(m.dx, m.dy, m.sq, el), rising = m.lift && !el.classList.contains('rb-lift');
        if (!nudged.size){ nudged.add(el); paintPlates(); }      // a block is lifted: the plates are let go (it wears its own)
        nudged.add(el); el.classList.toggle('rb-lift', !!m.lift);
        if (m.lift) el.closest('.page')?.classList.add('rb-clip');
        if (rising) play(el, [{ boxShadow: '0 0 0 transparent' }, { boxShadow: fr.doc.defaultView.getComputedStyle(el).boxShadow }], { key: `rise:${[...nudged].indexOf(el)}`, ms: FEEL.LAND_MIN, name: 'lift:rise' });
        if (to === el.style.transform) continue;
        const was = now(el);
        el.style.transform = to;
        if (!m.lift || m.glide) play(el, [{ transform: was || 'none' }, { transform: to || 'none' }], { key: `nudge:${[...nudged].indexOf(el)}`, ms: m.lift ? FEEL.LAND_MIN : FEEL.POP, kind: 'move', name: 'nudge' });
      }
    },
    // The lifted block comes down: from where it is to `to` ({ dx, dy }, its own place when none), its shadow closing and its outline fading, in a time that grows with the
    // distance (FEEL.LAND_MIN to LAND_MAX), and the page stays as the preview left it: the others have already slid. With `stay` (a drop) the transforms stay
    // until the page is drawn again with the moved model (`release`); without it (Esc, a refused drop) the others slide back to their own places too and everything is
    // clean when it has landed. A large block (`fin`: the others' places once it is open again, with a drop) comes down as its card, which opens into it as the others make the room. Resolves when it has landed, at once under reduced motion.
    land(to, stay, fin){
      const folds = el => el.classList.contains('rb-fold'), lifted = [...nudged].filter(el => el.classList.contains('rb-lift') || folds(el)), win = fr?.doc.defaultView, anims = [];
      if (!win) return Promise.resolve();
      const mat = el => new DOMMatrix(win.getComputedStyle(el).transform), at = el => { const m = mat(el); return { x: m.m41, y: m.m42 }; };
      const target = to ? { x: to.dx ?? 0, y: to.dy ?? 0 } : { x: 0, y: 0 }, cardTo = card && foldHome ? { x: foldHome[0].left + target.x, y: foldHome[0].top + target.y } : null;
      const dist = Math.max(0, ...lifted.map(el => Math.hypot(at(el).x - target.x, at(el).y - target.y)), cardTo ? Math.hypot(at(card).x - cardTo.x, at(card).y - cardTo.y) : 0);
      const ms = Math.round(FEEL.LAND_MIN + (FEEL.LAND_MAX - FEEL.LAND_MIN) * Math.min(1, dist / FEEL.LAND_FAR)), shut = { boxShadow: '0 0 0 transparent', outlineColor: 'transparent' };
      const room = fin && new Map(fin.flatMap(m => m.els.map(el => [el, xform(m.dx, m.dy, null, el)])));      // a fold: the others open the room the block needs now, in the same motion
      fr.doc.querySelectorAll('.rb-clip').forEach(p => p.classList.remove('rb-clip'));      // across a gap to another page it is not clipped
      for (const el of nudged){
        const from = win.getComputedStyle(el).transform, lift = lifted.includes(el), cs = win.getComputedStyle(el);
        if (!lift && stay && !room?.has(el)) continue;
        el.style.transform = lift ? (to ? `translate(${target.x}px, ${target.y}px)` : '') : (stay ? room.get(el) : '');
        const kf = lift ? [{ transform: from, boxShadow: cs.boxShadow, outlineColor: cs.outlineColor, ...(folds(el) ? { clipPath: cs.clipPath } : {}) }, { transform: el.style.transform || 'none', ...shut, ...(folds(el) ? { clipPath: 'inset(0px)' } : {}) }] : [{ transform: from }, { transform: el.style.transform || 'none' }];
        const a = play(el, kf, { key: `land:${[...nudged].indexOf(el)}`, ms, kind: 'arrive', fill: 'forwards', name: lift ? 'land' : 'land:back' });
        if (a) anims.push(a);
      }
      if (card && cardTo){      // the card comes to the block's place and opens into it: it flies there, its shadow closing, and is gone as the block shows
        const from = win.getComputedStyle(card).transform, cs = win.getComputedStyle(card);
        card.style.transform = `translate(${cardTo.x}px, ${cardTo.y}px)`;
        const a = play(card, [{ transform: from, opacity: 1, boxShadow: cs.boxShadow, outlineColor: cs.outlineColor }, { transform: card.style.transform, opacity: 0, ...shut }], { key: 'land:card', ms, kind: 'arrive', fill: 'forwards', name: 'land:card' });
        if (a) anims.push(a);
      }
      const done = () => {
        for (const el of lifted) el.classList.remove('rb-lift');
        this.unfold(); unsocket();
        if (!stay) this.unnudge(false);
        for (const a of anims) try { a.cancel(); } catch { /* over already */ }
        if (landing?.anims === anims) landing = null;
      };
      if (!anims.length){ done(); return Promise.resolve(); }
      landing = { anims, done };
      return Promise.all(anims.map(a => a.finished.catch(() => {}))).then(done);
    },
    // a landing is cut short (Undo, a new drag): it is over at once, in its place
    endLand(){ const l = landing; if (l){ landing = null; for (const a of l.anims) try { a.finish(); } catch { /* over already */ } l.done(); } },
    // draws wait until `p` is over: the block that is landing is the page's own element, and a draw would replace it
    hold(p){ chain = Promise.all([chain, p]).then(() => {}, () => {}); },
    // everything a preview moved is put back as the document has it (no motion): the page was drawn again, or nothing is landing
    unnudge(animate){
      for (const el of nudged){
        const was = el.style.transform;
        el.style.transform = ''; el.classList.remove('rb-lift');
        if (animate && was) play(el, [{ transform: was }, { transform: 'none' }], { ms: 'fast', kind: 'move', name: 'nudge:back' });
      }
      fr?.doc.querySelectorAll('.rb-clip').forEach(p => p.classList.remove('rb-clip'));
      this.unfold(); unsocket();
      nudged.clear(); paintPlates();
    },
    setFocus(facts, ix){
      const was = focusKey;
      marked.focus = facts && facts.size ? facts : null; focusKey = marked.focus ? [...marked.focus].sort().join() : '';
      if (ix) marked.ix = ix; mark();
      // the lens has just been turned on, or changed: the lines it picks out brighten (the others dim by a transition, in the frame's CSS)
      if (focusKey && focusKey !== was) for (const el of fr?.doc.querySelectorAll('.rb-hit') ?? []) play(el, [{ filter: 'brightness(1.2)' }, { filter: 'none' }], { ms: 'slow', name: 'lens:hit' });
    },
    flash(sectionId){
      for (const el of fr?.doc.querySelectorAll(`.band[data-section="${CSS.escape(sectionId)}"]`) ?? []){
        el.classList.remove('rb-flash'); void el.offsetWidth; el.classList.add('rb-flash');
      }
    },
    // every text that can be written, in print order: the keys the arrows and Tab walk through (a claim's id, `~h:<section>`, `~t:<fact>`)
    order(ix){
      if (!fr) return [];
      const out = [];
      for (const el of fr.doc.querySelectorAll('[data-variant], [data-label]')){
        const lb = el.getAttribute('data-label'), f = lb ? `~${lb}` : factOfVariant(ix, el.getAttribute('data-variant'));
        if (f && !out.includes(f)) out.push(f);
      }
      return out;
    },
    // ---- what the grip, the "+" and the photo slot over the page are placed by (rectangles in the page's own pixels) ----
    // The line, skill group or header under a point. A line owns the margin left of its text and the gap below it, so the gaps between
    // lines belong to a line and not to the job: the nearest one within reach gets the point, a point inside one beats a point near one.
    // A job or a section (the big plates) is a candidate only on its heading row (a small slop round it) or in the strip at its side (`side`: the margin left of a job,
    // a section's tab column), never through the vertical reach into a gap, so a slow pointer between lines or blocks never jumps to the bigger one (lab v2 mode A).
    handAt(ix, x, y){
      if (!fr?.frame.isConnected) return null;
      let best = null, bd = Infinity;
      const dist = r => (x < r.left ? r.left - x : x > r.left + r.width ? x - r.left - r.width : 0) + (y < r.top ? r.top - y : y > r.top + r.height ? y - r.top - r.height : 0);
      const take = (k, el, fact, rect, side) => {
        const r = rect ?? this.rectOfEl(el), slop = side ? 4 : 20;
        let d = x < r.left - 48 || x > r.left + r.width + 6 || y < r.top - slop || y > r.top + r.height + slop ? Infinity : dist(r);
        if (side && x >= side.left && x < side.right && y >= side.top && y <= side.bottom) d = Math.min(d, side.d);
        if (d < bd){ bd = d; best = { k, fact, rect: r, edge: el ? this.edgeOf(el) : r.left, job: k === 'line' ? ix.highlight.get(fact) ?? null : null, d }; }
      };
      for (const li of fr.doc.querySelectorAll('.entry .bullets li[data-variant]')){ const f = factOfVariant(ix, li.getAttribute('data-variant')); if (f) take('line', li, f); }
      for (const g of fr.doc.querySelectorAll('.skills__group')){ const f = factOfVariant(ix, (g.getAttribute('data-variant') ?? g.querySelector('[data-variant]')?.getAttribute('data-variant')) ?? ''); if (f) take('group', g, f); }
      // a job's heading (its title and date line) and a section's heading give their block's grip
      for (const e of fr.doc.querySelectorAll('.entry')){
        const v = e.querySelector(':scope > .role-title')?.getAttribute('data-variant'), id = v && [...ix.work].find(([, w]) => w.display?.position === factOfVariant(ix, v))?.[0], r = id && this.jobHeadRect(e);
        const s = r && this.rectOfEl(e);      // its side: left of the job's box, short of where its lines' own grips stand
        if (r) take('job', null, id, r, { left: s.left - 48, right: s.left - 4, top: s.top, bottom: s.top + s.height, d: Math.max(0, s.left - x) });
      }
      for (const b of fr.doc.querySelectorAll('.band[data-section] .tab:not(.tab--cont)')){
        const t = this.rectOfEl(b), s = this.rectOfEl(b.closest('.band'));      // its side: the tab's column, the band's whole height
        take('section', b, b.closest('.band').getAttribute('data-section'), t, { left: s.left - 48, right: t.left + t.width + 6, top: s.top, bottom: s.top + s.height, d: Math.max(0, s.left - x) });
      }
      const hd = fr.doc.querySelector('.band--header');
      if (!best && hd){ const r = this.rectOfEl(hd); if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) best = { k: 'header', rect: r, d: 0 }; }
      return best;
    },
    // a job's lines in print order (every page)
    jobLines(jobId, ix){
      if (!fr?.frame.isConnected) return [];
      return [...fr.doc.querySelectorAll('.entry .bullets li[data-variant]')].map(li => ({ fact: factOfVariant(ix, li.getAttribute('data-variant')), rect: this.rectOfEl(li), edge: this.edgeOf(li) }))
        .filter(l => l.fact && ix.highlight.get(l.fact) === jobId);
    },
    // where the text column of what an element is part of begins (a job's title, a skill group's name): a line's bullet hangs right of it
    edgeOf(el){ return (el.closest('.entry, .skills__group') ?? el).getBoundingClientRect().left; },
    // the skill groups with the rectangle of each of their skills (the page's copy of an arranged group marks them)
    skillGroups(ix){
      if (!fr?.frame.isConnected) return [];
      return [...fr.doc.querySelectorAll('.skills__group')].map(g => ({ fact: factOfVariant(ix, (g.getAttribute('data-variant') ?? g.querySelector('[data-variant]')?.getAttribute('data-variant')) ?? ''), rect: this.rectOfEl(g), edge: this.edgeOf(g),
        items: [...g.querySelectorAll('[data-skill]')].map(e => this.rectOfEl(e)) })).filter(g => g.fact);
    },
    // the skill under a point: { fact, k }
    skillAt(ix, x, y){
      for (const g of this.skillGroups(ix)){
        const k = g.items.findIndex(r => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height);
        if (k >= 0) return { fact: g.fact, k };
      }
      return null;
    },
    // the header's parts: the text of the name, and the photo if it is printed
    headerRects(){
      const hd = fr?.doc.querySelector('.band--header'), name = hd?.querySelector('.name');
      if (!hd || !name) return null;
      const rg = fr.doc.createRange(); rg.selectNodeContents(name);
      const q = rg.getBoundingClientRect(), pt = hd.querySelector('.portrait');
      return { band: this.rectOfEl(hd), name: { left: q.left, top: q.top, width: q.width, height: q.height }, portrait: pt ? this.rectOfEl(pt) : null };
    },
    // the drink or the theme changed: the marks take the new colours
    restyle(){ if (fr?.doc) paintMarks(fr.doc); },
    focus(){ fr?.frame.focus(); },
    linesOf(ix, factId){
      if (!fr) return null;
      const vs = new Set([...(ix.facts.get(factId)?.variants ?? []), `${factId}-override`]);
      const els = [...fr.doc.querySelectorAll('[data-variant]')].filter(el => vs.has(el.getAttribute('data-variant')));
      return els.length ? els.reduce((n, el) => n + countLines(el), 0) : null;
    },
  };
  return api;
}
