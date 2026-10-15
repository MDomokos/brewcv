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
html.rb-handing, html.rb-handing * { cursor: grabbing !important; }
html.rb-dragging, html.rb-dragging * { cursor: grabbing !important; user-select: none !important; }
html.rb-space, html.rb-space * { cursor: grab !important; }
html.rb-ui :is([data-variant], [data-label]):hover { outline: 2px solid color-mix(in srgb, var(--rb-sel) 40%, transparent); outline-offset: 2px; border-radius: 2px; }
.rb-sel { outline: 2px solid var(--rb-sel) !important; outline-offset: 2px; border-radius: 2px; background-color: var(--rb-sel-soft); }
.rb-band-sel { outline: 2px solid var(--rb-sel) !important; outline-offset: 5px; border-radius: 4px; }
.rb-prev { outline: 2px solid var(--rb-prev) !important; outline-offset: 2px; border-radius: 2px; background-color: var(--rb-prev-soft); }
.rb-hover { outline: 2px solid var(--rb-prev) !important; outline-offset: 2px; border-radius: 2px; background-color: var(--rb-prev-soft); }
html.rb-previewing .document > .page { outline: 3px solid var(--rb-prev); outline-offset: 6px; }
html.rb-focus .bullets li[data-variant]:not(.rb-hit), html.rb-focus .summary[data-variant]:not(.rb-hit), html.rb-focus .skills__items[data-variant]:not(.rb-hit), html.rb-focus .pairs dd[data-variant]:not(.rb-hit), html.rb-focus .runs strong[data-variant]:not(.rb-hit) { opacity: .28; transition: opacity var(--rb-m-base, 240ms) var(--rb-m-out, ease-out); }
html.rb-writing :is([data-variant], [data-label]):not([contenteditable]) { opacity: var(--rb-wdim, .94); }
html.rb-ui [contenteditable] { cursor: text; }
html.rb-writing .rb-sel { outline: none !important; background-color: transparent; }
.rb-miss { outline: 1.5px dashed var(--rb-miss) !important; outline-offset: 2px; }
.band .tab.rb-miss-tab { background-image: repeating-linear-gradient(-45deg, color-mix(in srgb, var(--rb-miss) 45%, transparent) 0 3px, transparent 3px 7px) !important; }
[data-rb-hid] { -webkit-text-fill-color: transparent; }
[data-rb-hid]::marker { -webkit-text-fill-color: currentcolor; }
.rb-flash { animation: rb-flash 900ms var(--rb-m-out, ease-out); }
@keyframes rb-flash { from { background-color: var(--rb-sel-soft); } to { background-color: transparent; } }
`;

// The app's own marks inside the frame (the rb-* classes) wear the drink's colours. The frame's document is a separate page, so
// the colours are copied across from the app's tokens as custom properties: on the frame's root, which the resume's own
// stylesheets never read, and which is not in an export.
const MARK_TOKENS = { '--rb-sel': '--sel-mark', '--rb-sel-soft': '--sel-mark-soft', '--rb-prev': '--prev-mark', '--rb-prev-soft': '--prev-mark-soft', '--rb-miss': '--page-warn', '--rb-edge': '--page-edge' };
function paintMarks(doc){
  const cs = getComputedStyle(document.documentElement);
  // the page's edge follows the contrast setting: the sharper look is the default, the softer one is the old look
  const soft = document.body.classList.contains('soft');
  // the motion tokens and the Reduce motion rule go across the same way (the frame has no :root of the app's)
  doc.documentElement.style.setProperty('--rb-m-base', `${dur('base')}ms`);
  doc.documentElement.style.setProperty('--rb-m-out', ease('arrive'));
  doc.documentElement.classList.toggle('rb-still', reduced());
  for (const [prop, token] of Object.entries(MARK_TOKENS)) doc.documentElement.style.setProperty(prop, cs.getPropertyValue(prop === '--rb-edge' && soft ? '--page-edge-soft' : token).trim());
}

const factOfVariant = (ix, a) => ix.factOfVariant.get(a) ?? (a.endsWith('-override') && ix.facts.has(a.slice(0, -9)) ? a.slice(0, -9) : null);

// A text that is a label, not a claim, is found by the key the renderer gave it: `~h:<section>` (a heading), `~t:<fact>` (a language's name)
const labelEl = (doc, key) => [...doc.querySelectorAll('[data-label]')].find(e => `~${e.getAttribute('data-label')}` === key) ?? null;

export function createSheet(host, hooks = {}){
  let fr = null;
  let shown = null, textCache = null;
  let view = { mode: 'spread', page: 0 };
  let marked = { sel: null, ix: null, prev: null, focus: null, miss: null, hover: null };
  let fade = [];
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
          const el = e.target.closest?.('[data-variant], [data-label], .band[data-section]');
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
      host.querySelector('.sheet-frame')?.remove(); host.prepend(frame);          // the lift layers (canvas.js) stay
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

  function mark(){
    if (!fr) return;
    for (const el of fr.doc.querySelectorAll('.rb-sel, .rb-band-sel, .rb-prev, .rb-hover, .rb-hit, .rb-miss, .rb-miss-tab')) el.classList.remove('rb-sel', 'rb-band-sel', 'rb-prev', 'rb-hover', 'rb-hit', 'rb-miss', 'rb-miss-tab');
    // texts with no version in the resume's language print in English, outlined
    if (marked.miss && marked.ix){
      for (const el of fr.doc.querySelectorAll('[data-variant]')){
        const f = factOfVariant(marked.ix, el.getAttribute('data-variant'));       // a skill group of an arrangement is printed as <fact>-override
        if (f && marked.miss.facts.has(f)) el.classList.add('rb-miss');
      }
      for (const id of marked.miss.headings) for (const t of fr.doc.querySelectorAll(`.band[data-section="${CSS.escape(id)}"] .tab`)) t.classList.add('rb-miss-tab');
    }
    fr.doc.documentElement.classList.toggle('rb-focus', !!marked.focus);
    if (marked.focus && marked.ix){
      for (const el of fr.doc.querySelectorAll('[data-variant]')){
        const a = el.getAttribute('data-variant');
        const f = marked.ix.factOfVariant.get(a) ?? (a.endsWith('-override') ? a.slice(0, -9) : null);
        if (f && marked.focus.has(f)) el.classList.add('rb-hit');
      }
    }
    if (marked.hover && marked.ix){
      const vs = new Set([...(marked.ix.facts.get(marked.hover)?.variants ?? []), `${marked.hover}-override`]);
      for (const el of fr.doc.querySelectorAll('[data-variant]')) if (vs.has(el.getAttribute('data-variant'))) el.classList.add('rb-hover');
    }
    const { sel, ix } = marked;
    if (!sel || !ix) return;
    const byFacts = facts => {
      const vs = new Set(facts.flatMap(id => [...(ix.facts.get(id)?.variants ?? []), `${id}-override`]));
      return [...fr.doc.querySelectorAll('[data-variant]')].filter(el => vs.has(el.getAttribute('data-variant')));
    };
    let els = [];
    if (sel.kind === 'bullet') els = isLabelKey(sel.id) ? [labelEl(fr.doc, sel.id)].filter(Boolean) : byFacts([sel.id]);
    else if (sel.kind === 'job'){
      const w = ix.work.get(sel.id);
      els = byFacts([w?.display?.position].filter(Boolean)).map(el => el.closest('.entry') ?? el);
    }
    else if (sel.kind === 'section') els = [...fr.doc.querySelectorAll(`.band[data-section="${CSS.escape(sel.id)}"]`)];
    else if (sel.kind === 'header') els = [...fr.doc.querySelectorAll('.band[data-section="header"]')];
    for (const el of els) el.classList.add(sel.kind === 'section' || sel.kind === 'header' ? 'rb-band-sel' : 'rb-sel');
    if (marked.prev) for (const el of byFacts([marked.prev])) el.classList.add('rb-prev');
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

  return {
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
      const el = this.elOf(factId, ix);
      if (!el) return null;
      const rs = [el.closest('.item__title, .meta--flat') ? el.closest('.band__content') : el.closest('dd') ? el.closest('dd').previousElementSibling : el.closest('dt') ? el.closest('dt').nextElementSibling : null, el.closest('dd') ?? el].filter(Boolean).map(e => this.rectOfEl(e));
      const l = Math.min(...rs.map(r => r.left)), tp = Math.min(...rs.map(r => r.top));
      return { left: l, top: tp, width: Math.max(...rs.map(r => r.left + r.width)) - l, height: Math.max(...rs.map(r => r.top + r.height)) - tp };
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
    setHand(handing, space){ if (!fr) return; fr.doc.documentElement.classList.toggle('rb-handing', !!handing); fr.doc.documentElement.classList.toggle('rb-space', !!space); },
    setView(next){ const before = view.mode; view = { ...view, ...next }; if (view.mode !== before) revealed = null; applyView(); mark(); },
    get view(){ return { ...view }; },

    select(sel, ix){ marked.sel = sel; marked.ix = ix; mark(); },
    setMissing(list, ix){
      marked.miss = list?.length ? { facts: new Set(list.filter(x => x.kind === 'fact').map(x => x.id)), headings: list.filter(x => x.kind === 'heading').map(x => x.id) } : null;
      if (ix) marked.ix = ix; mark();
    },
    // a row of the record checklist is under the pointer: its line on the page lights up, if it is on the page
    setHover(factId, ix){ marked.hover = factId; if (ix) marked.ix = ix; mark(); },
    // where something is on the page, in the page's own pixels (undefined when it is not there)
    rectOf(factId, ix){
      if (!fr) return null;
      const vs = new Set([...(ix.facts.get(factId)?.variants ?? []), `${factId}-override`]);
      const el = [...fr.doc.querySelectorAll('[data-variant]')].find(e => vs.has(e.getAttribute('data-variant')));
      if (!el) return null;
      const r = el.getBoundingClientRect(), page = el.closest('.page')?.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height, page: page ? { left: page.left, top: page.top } : null };
    },
    // a section's band, in the page's own pixels: the one on the same page as `near` (a rectangle) when it runs over two pages, else the first
    rectOfBand(id, near){
      const rs = [...(fr?.doc.querySelectorAll(`.band[data-section="${CSS.escape(id)}"]`) ?? [])].map(e => this.rectOfEl(e));
      return (near && rs.find(r => near.left >= r.left - 40 && near.left < r.left + r.width + 40)) || rs[0] || null;
    },
    // a line being written is part of the page: the rest of the text fades a little (dim, 60 to 100); null when nothing is written
    setWriting(dim){ const d = fr?.doc?.documentElement; if (!d) return; d.classList.toggle('rb-writing', dim != null); if (dim != null) d.style.setProperty('--rb-wdim', String(dim / 100)); },
    // a job's box on the page, in the page's own pixels from the sheet's corner
    rectOfJob(jobId, ix){
      if (!fr) return null;
      const w = ix.work.get(jobId);
      const vs = new Set([...(ix.facts.get(w?.display?.position)?.variants ?? []), `${w?.display?.position}-override`]);
      const el = [...fr.doc.querySelectorAll('[data-variant]')].find(e => vs.has(e.getAttribute('data-variant')))?.closest('.entry');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
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
    handAt(ix, x, y){
      if (!fr?.frame.isConnected) return null;
      let best = null, bd = Infinity;
      const take = (k, el, fact) => {
        const r = this.rectOfEl(el);
        if (x < r.left - 48 || x > r.left + r.width + 6 || y < r.top - 20 || y > r.top + r.height + 20) return;
        const d = (x < r.left ? r.left - x : x > r.left + r.width ? x - r.left - r.width : 0) + (y < r.top ? r.top - y : y > r.top + r.height ? y - r.top - r.height : 0);
        if (d < bd){ bd = d; best = { k, fact, rect: r, edge: this.edgeOf(el), job: k === 'line' ? ix.highlight.get(fact) ?? null : null }; }
      };
      for (const li of fr.doc.querySelectorAll('.entry .bullets li[data-variant]')){ const f = factOfVariant(ix, li.getAttribute('data-variant')); if (f) take('line', li, f); }
      for (const g of fr.doc.querySelectorAll('.skills__group')){ const f = factOfVariant(ix, (g.getAttribute('data-variant') ?? g.querySelector('[data-variant]')?.getAttribute('data-variant')) ?? ''); if (f) take('group', g, f); }
      const hd = fr.doc.querySelector('.band--header');
      if (!best && hd){ const r = this.rectOfEl(hd); if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) best = { k: 'header', rect: r }; }
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
}
