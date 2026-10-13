// Editing on the page (UX-3). Three layers: the page, a job, a line. Esc goes up one.
//   - At the job level the job is framed and the rest of the page dims; at the line level the job keeps a dashed frame and the
//     line has its own outline and a small lift.
//   - A line is written where it is printed: the element on the page becomes editable, holding the plain text of the version
//     (src/ui/plain.js reads it back, so the text is exactly what the old text box held). Everything else is the editor's own
//     (src/ui/edit.js): the draft, the live preview, the three ways of keeping it.
//   - The tools sit beside the line, in the page's right margin: the version badge, the three icons, the counts.
// All of it is drawn in the app's layer (#editlay), over the page; the page's own markup and its measurements are never touched,
// and nothing here is in an export. The camera (src/ui/canvas.js) eases to the writing zoom and back.

import { plainOf, caretOf, setCaret } from './plain.js';
import { toolsHtml, badgeListHtml, statsCompactHtml, esc } from './parts.js';
import { readZoomWrite, readZoomWriteOn, readDimJob, readDimLine } from './dock.js';
import { step, versionsOf } from './select.js';
import * as T from '../model/resume.js';
import { t } from '../i18n/index.js';
import { PHONE_MAX } from './layout.js';

const $ = (s, r = document) => r.querySelector(s);
const PAD_JOB = 6, PAD_LINE = 4;
const pad = (r, p) => (r ? { left: r.left - p, top: r.top - p, width: r.width + 2 * p, height: r.height + 2 * p } : null);

export function initOnPage(C){
  const { ui, sheet, canvas } = C;
  const edit = () => C.edit();
  let lay = null, geom = null, sig = '';
  let S = null;                    // the line being written: { fact, el, caret }
  let hover = null, hoverT = 0, popOpen = false;
  let moving = false;              // from one line to the next: the view stays where it is
  let zoomed = false;              // the camera has been eased to the writing zoom
  const phone = () => innerWidth < PHONE_MAX;
  // entering and leaving write mode is announced
  const say = text => { const el = $('#announce'); if (el){ el.textContent = ''; setTimeout(() => { el.textContent = text; }, 30); } };

  // ---- what level are we at ----
  function target(){
    const sel = ui.sel;
    if (ui.view || ui.snap || ui.preview || phone() || ui.fitting) return null;       // another resume's paper is being previewed: nothing is framed
    if (sel.kind === 'bullet') return { fact: sel.id, jobId: sel.job ?? C.ix().highlight.get(sel.id) ?? null };
    if (sel.kind === 'job') return { fact: null, jobId: sel.id };
    return null;
  }
  // 'page' (nothing is framed), 'job', 'line' (written), 'lineSel' (a line outside a job: only selected)
  function level(){
    if (ui.writing && S) return 'line';
    const tg = target();
    return !tg ? 'page' : tg.jobId ? 'job' : tg.fact ? 'lineSel' : 'page';
  }

  // ---- what is on the page, in the page's own pixels ----
  const rectOfFact = (fact, ix) => { const el = S?.fact === fact && S.el?.isConnected ? S.el : sheet.elOf(fact, ix); return el ? sheet.rectOfEl(el) : null; };
  function read(){
    const ix = edit().editing?.ix ?? C.ix();
    const tg = target();
    const wr = ui.writing && S ? { fact: S.fact, jobId: C.ix().highlight.get(S.fact) ?? null } : null;
    const use = wr ?? tg;
    const jobId = use?.jobId ?? null;
    geom = {
      tg: use, boxes: sheet.pageBoxes(),
      line: use?.fact ? rectOfFact(use.fact, ix) : null,
      job: jobId ? sheet.rectOfJob(jobId, C.ix()) : null,
      jobId,
    };
  }

  // ---- drawing the layers ----
  function signature(lvl){
    const ed = edit().editing, tg = geom?.tg;
    return JSON.stringify([lvl, tg?.fact, tg?.jobId, hover, popOpen, !!ed, ed?.mode, ed ? edit().isDirty() : null, geom?.boxes.length, ui.lang, C.lang()]);
  }
  function render(force = false){
    lay ??= $('#editlay');
    if (!lay) return;
    const lvl = level();
    if (lvl === 'page'){ if (lay.firstChild) lay.replaceChildren(); geom = null; sig = ''; return; }
    read();
    // a job or a line that is not on this resume has nothing on the page to frame
    if (!geom.boxes.length || (!geom.job && !geom.line)){ if (lay.firstChild) lay.replaceChildren(); sig = ''; return; }
    const sg = signature(lvl);
    if (!force && sg === sig && lay.firstChild){ place(); return; }
    // a preview under the pointer (a version hovered in the badge) is a redraw: the layers stay as they are
    if (ui.previewing && lay.firstChild && !force){ place(); return; }
    sig = sg;
    const keep = document.activeElement?.closest?.('#editlay') ? document.activeElement.dataset?.act : null;
    const html = [];
    const dim = lvl === 'job' ? readDimJob() : lvl === 'line' ? readDimLine() : 100;
    if (lvl === 'job' || lvl === 'line') for (let i = 0; i < geom.boxes.length; i++) html.push(`<div class="obveil" data-p="${i}" style="opacity:${((100 - dim) / 100).toFixed(3)}"></div>`);
    if (geom.job && (lvl === 'job' || lvl === 'line')) html.push(`<div class="obframe job${lvl === 'line' ? ' dashed' : ''}"></div>`);
    if (lvl === 'line' && geom.line) html.push('<div class="obframe line"></div>');
    const tools = toolsFor(lvl);
    if (tools) html.push(`<div class="obtoolswrap" role="region" aria-label="${esc(t('ux3.tools'))}">${tools}</div>`);
    lay.innerHTML = html.join('');
    lay.style.setProperty('--ob-paper', geom.boxes[0]?.bg ?? '#fff');
    place();
    if (keep) lay.querySelector(`[data-act="${keep}"]`)?.focus({ preventScroll: true });
  }

  // the line the badge is for: the one written, else the one under the pointer, else the one selected
  const badgeFact = lvl => (lvl === 'line' ? S?.fact : hover ?? geom?.tg?.fact) ?? null;
  function toolsFor(lvl){
    if (lvl === 'lineSel') return '';
    const fact = badgeFact(lvl);
    if (!fact) return '';
    const ed = edit().editing && edit().editing.fact === fact && !edit().editing.panel ? edit().editing : null;
    const using = C.chooseVariant(C.work(), fact, C.cur()).v;
    const over = C.cur().overrides?.[fact];
    const vn = over !== undefined && !ed ? t('edit.only') : (ed?.mode === 'only' ? t('edit.only') : using?.n ?? '·');
    const canOnly = !!(T.jobOfFact(C.record(), fact) || fact === C.cur().summary);
    const html = toolsHtml({ vn, ed, dirty: !!ed && edit().isDirty(), canOnly, canMove: !!ed && !!T.jobOfFact(C.record(), fact), open: popOpen, counts: ed ? statsCompactHtml(ed) : '' });
    return html + (popOpen ? badgeListHtml({ fact, versions: versionsOf(C.ix(), fact, C.lang()), usingId: using?.id }) : '');
  }

  // where everything is on the screen: follows the camera
  function place(){
    if (!geom || !lay) return;
    const lvl = level();
    const R = r => (r ? canvas.screenRect(r) : null);
    const hole = lvl === 'job' ? R(pad(geom.job, PAD_JOB)) : lvl === 'line' ? R(pad(geom.line, PAD_LINE)) : null;
    lay.querySelectorAll('.obveil').forEach(v => {
      const b = geom.boxes[Number(v.dataset.p)];
      if (!b) return;
      const s = R(b);
      Object.assign(v.style, { left: `${s.left}px`, top: `${s.top}px`, width: `${s.width}px`, height: `${s.height}px`, background: b.bg });
      if (hole){
        const x = hole.left - s.left, y = hole.top - s.top;
        v.style.clipPath = `polygon(evenodd, 0 0, ${s.width}px 0, ${s.width}px ${s.height}px, 0 ${s.height}px, 0 0, ${x}px ${y}px, ${x + hole.width}px ${y}px, ${x + hole.width}px ${y + hole.height}px, ${x}px ${y + hole.height}px, ${x}px ${y}px)`;
      } else v.style.clipPath = '';
    });
    const box = (el, r) => { if (!el || !r) return; Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }); };
    box(lay.querySelector('.obframe.job'), R(pad(geom.job, PAD_JOB)));
    box(lay.querySelector('.obframe.line'), R(pad(geom.line, PAD_LINE)));
    // the tools sit beside the line, in the page's right margin
    const tw = lay.querySelector('.obtoolswrap');
    const fact = badgeFact(lvl);
    const lr = fact ? (fact === geom.tg?.fact || (S && fact === S.fact) ? geom.line : rectOfFact(fact, edit().editing?.ix ?? C.ix())) : null;
    if (tw && lr){
      const pg = geom.boxes.find(b => lr.left >= b.left - 1 && lr.left < b.left + b.width) ?? geom.boxes[0];
      const edgeR = R({ left: pg.left + pg.width - pg.padRight, top: lr.top, width: 0, height: 0 });
      const sr = R(lr);
      const view = canvas.view;
      const x = Math.min(edgeR.left + 8, (view ? view.left + view.width : innerWidth) - 44);
      Object.assign(tw.style, { left: `${Math.max(sr.left + sr.width + 6 > x ? sr.left + sr.width + 6 : x, 6)}px`, top: `${Math.max(6, sr.top - 4)}px` });
    } else if (tw) tw.style.display = 'none';
  }

  // ---- writing a line where it is printed ----
  const supportsPlain = (() => { try { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only'; } catch { return false; } })();
  function attach(el, caret = null){
    const ed = edit().editing;
    if (!ed) return;
    S.el = el;
    // the plain text in, with its line breaks and spaces as they are; marks come back when it is saved and drawn again
    el.textContent = ed.draft;
    el.style.whiteSpace = 'pre-wrap';
    el.contentEditable = supportsPlain ? 'plaintext-only' : 'true';
    el.spellcheck = true;
    el.setAttribute('role', 'textbox');
    el.setAttribute('aria-multiline', 'true');
    el.setAttribute('aria-label', t('ux3.lineField'));
    const offs = [];
    const on = (ev, fn) => { el.addEventListener(ev, fn); offs.push(() => el.removeEventListener(ev, fn)); };
    on('input', onInput);
    on('keydown', onKey);
    on('keyup', rememberCaret);
    on('mouseup', rememberCaret);
    on('compositionstart', () => { S.composing = true; });
    on('compositionend', () => { S.composing = false; onInput(); });
    if (!supportsPlain) on('paste', e => { e.preventDefault(); el.ownerDocument.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
    S.off = () => offs.forEach(f => f());
    el.focus({ preventScroll: true });
    if (caret) setCaret(el, caret);
    else {
      const sel = el.ownerDocument.defaultView.getSelection(), r = el.ownerDocument.createRange();
      r.selectNodeContents(el);
      if (ed.mode !== 'new') r.collapse(false);       // a new version starts with the copy selected, as the text box did
      sel.removeAllRanges(); sel.addRange(r);
    }
    rememberCaret();
  }
  function rememberCaret(){ if (S?.el?.isConnected) S.caret = caretOf(S.el) ?? S.caret; }
  function onInput(){
    if (!S || S.composing) return;
    rememberCaret();
    edit().draftChanged(plainOf(S.el));
  }

  // keys inside the line: Esc leaves it, Ctrl+Enter keeps it, Tab and the arrows at its edges go to the next line
  function atEdge(el, dir){
    const sel = el.ownerDocument.defaultView.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return false;
    const r = sel.getRangeAt(0).cloneRange(), box = el.getBoundingClientRect();
    const rect = r.getClientRects()[0] ?? r.getBoundingClientRect();
    const lh = parseFloat(el.ownerDocument.defaultView.getComputedStyle(el).lineHeight) || 14;
    if (!rect || (!rect.height && !rect.top)) return true;       // an empty line: both edges
    return dir < 0 ? rect.top - box.top < lh * 0.6 : box.bottom - rect.bottom < lh * 0.6;
  }
  function onKey(e){
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.ctrlKey || e.metaKey;
    const done = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'Escape'){ done(); edit().cancelEdit({ ask: true }); return; }
    if (e.key === 'Enter' && mod){ done(); edit().ctrlEnter(); return; }
    if (e.key === 'Tab' && !mod && !e.altKey){ done(); next(e.shiftKey ? -1 : 1); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !mod && !e.altKey && !e.shiftKey && atEdge(e.target.closest('[contenteditable]') ?? S.el, e.key === 'ArrowDown' ? 1 : -1)){ done(); next(e.key === 'ArrowDown' ? 1 : -1); }
  }
  // the next line in print order, written at once, without zooming out and in again
  function next(dir){
    const ed = edit().editing;
    if (!ed) return;
    const ix = C.ix();
    const id = step(sheet.order(ix), { kind: 'bullet', id: ed.fact }, dir);
    if (typeof id !== 'string' || id === ed.fact) return;
    const job = ix.highlight.get(id);
    const sel = job ? { kind: 'bullet', id, job, section: 'experience' } : { kind: 'bullet', id, section: 'summary' };
    moving = true;
    try { C.select(sel); if (ui.sel.kind === 'bullet' && ui.sel.id === id) edit().startEdit(); }
    finally { moving = false; }
  }

  // ---- called by edit.js ----
  // true when the line is on the page and is now written there
  function begin(){
    const ed = edit().editing;
    if (!ed || phone() || ui.view || ui.snap) return false;
    const ix = ed.ix ?? C.ix();
    const el = sheet.elOf(ed.fact, ix);
    if (!el) return false;
    ui.writing = true;
    S = { fact: ed.fact, el: null, caret: null, composing: false };
    popOpen = false; hover = null;
    attach(el);
    if (readZoomWriteOn()){
      const r = sheet.rectOfEl(el);
      canvas.writeTo(r, readZoomWrite(), { keepZoom: zoomed });
      zoomed = true;
    }
    C.writeStarted?.();
    say(t('ux3.announceOn'));
    render(true);
    return true;
  }
  // the line stops being editable. Its words were replaced by the plain text while it was written, so the page is drawn again
  // from the record (the marks come back)
  function release(){
    const el = S?.el;
    S?.off?.();
    if (el?.isConnected){
      el.removeAttribute('contenteditable'); el.removeAttribute('role'); el.removeAttribute('aria-multiline'); el.removeAttribute('aria-label');
      el.style.whiteSpace = '';
      C.redrawSoon?.();
    }
  }
  function end(){
    if (!S && !ui.writing) return;
    release();
    S = null; ui.writing = false; popOpen = false;
    if (!moving) say(t('ux3.announceOff'));
    if (!moving){
      if (zoomed){ zoomed = false; canvas.reset(); }
      C.writeEnded?.();
    }
    render(true);
  }
  // a version was picked while writing: it replaces what was typed
  function setText(text){
    if (!S?.el) return;
    S.el.textContent = text;
    S.caret = { start: text.length, end: text.length };
    setCaret(S.el, S.caret);
    refresh();
  }
  // the draft or the counts changed: the tools and the frames follow, without drawing it all again
  function refresh(){
    if (!ui.writing) return;
    read();
    const stats = $('#ob-stats');
    const ed = edit().editing;
    if (stats && ed) stats.innerHTML = statsCompactHtml(ed);
    for (const b of lay?.querySelectorAll('.obtools [data-act^=ed-]') ?? []) b.disabled = !edit().isDirty() && !(b.dataset.act === 'ed-only' && ed?.mode === 'only');
    place();
    if (geom?.line) canvas.ensureVisible(geom.line);
  }
  // the page was drawn again (a version previewed, a save, a resize of the text): the line being written is found again
  function afterDraw(){
    if (ui.writing && S){
      const ed = edit().editing;
      const el = ed ? sheet.elOf(S.fact, ed.ix ?? C.ix()) : null;
      if (el && el !== S.el) attach(el, S.caret);
    }
    render();
  }

  // ---- the badge ----
  function onHover(variant){
    clearTimeout(hoverT);
    const lvl = level();
    if (lvl !== 'job' || ui.writing) return;
    const ix = C.ix();
    const fact = variant ? (ix.factOfVariant.get(variant) ?? (variant.endsWith('-override') ? variant.slice(0, -9) : null)) : null;
    if (fact && ix.facts.has(fact) && !ix.header.has(fact)){ if (fact !== hover){ hover = fact; render(); } return; }
    // the pointer left the line: the badge stays a moment, so the pointer can reach it
    hoverT = setTimeout(() => { if (!popOpen && !lay?.matches(':hover') && !lay?.querySelector(':hover')){ hover = null; render(); } }, 450);
  }
  async function act(a){
    switch (a){
      case 'ob-badge': popOpen = !popOpen; render(true); return true;
      case 'ob-up': case 'ob-down': edit().stepLine(a === 'ob-up' ? -1 : 1); return true;
    }
    return false;
  }
  document.addEventListener('mousedown', e => { if (popOpen && !e.target.closest?.('#editlay')){ popOpen = false; render(true); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && popOpen){ popOpen = false; render(true); e.stopPropagation(); } }, true);

  // run something that leaves one line and writes another, with the view staying where it is (no zoom out and in again)
  function keepView(fn){ moving = true; try { return fn(); } finally { moving = false; } }
  return {
    begin, end, setText, refresh, afterDraw, render, place, onHover, act, keepView,
    get writing(){ return !!ui.writing; },
    closePop(){ if (!popOpen) return false; popOpen = false; render(true); return true; },
    el: () => S?.el ?? null,
    level,
  };
}
