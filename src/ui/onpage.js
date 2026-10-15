// Editing on the page (UX-3, UX-6c). Three layers: the page, a job, a line. Esc goes up one.
//   - At the job level the job is framed and the rest of the page dims. The line being written is part of the page: no cover cut
//     out around it, the rest of the page's text fades a little (in the frame, src/ui/sheet.js setWriting), a thin outline.
//   - A line is written where it is printed: the element on the page becomes editable, holding the plain text of the version
//     (src/ui/plain.js reads it back, so the text is exactly what the old text box held). Everything else is the editor's own
//     (src/ui/edit.js): the draft, the live preview, keeping it on this resume when the line is left.
//   - A small chip floats over the page: where you are (Page › Job › Line), each level a button, the level below and Esc. The same
//     component heads the editor card (parts.js depthHtml).
//   - The tools sit beside a line being written, in the page's right margin: the version number, ↑ and ↓, the counts.
// All of it is drawn in the app's layer (#editlay), over the page; the page's own markup and its measurements are never touched,
// and nothing here is in an export. The camera (src/ui/canvas.js) eases to the writing zoom on the first line written, stays there
// from line to line, and comes back out only at the page level (Esc to the page, a click on the bare canvas).

import { plainOf, caretOf, setCaret } from './plain.js';
import { toolsHtml, statsCompactHtml, esc } from './parts.js';
import { readZoomWrite, readZoomWriteOn, readDimJob, readDimLine } from './dock.js';
import { step } from './select.js';
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
  let moving = false;              // from one line to the next: nothing is announced
  let zoomed = false;              // the camera has been eased to the writing zoom; it comes back at the page level
  const phone = () => innerWidth < PHONE_MAX;
  // entering and leaving write mode is announced
  const say = text => { const el = $('#announce'); if (el){ el.textContent = ''; setTimeout(() => { el.textContent = text; }, 30); } };

  // ---- what level are we at ----
  function target(){
    const sel = ui.sel;
    if (ui.view || ui.snap || ui.preview || phone() || ui.fitting) return null;       // another resume's paper is being previewed: nothing is framed
    if (sel.kind === 'bullet') return { fact: sel.id, jobId: sel.job ?? C.ix().highlight.get(sel.id) ?? null };
    if (sel.kind === 'job') return { fact: null, jobId: sel.id };
    if (sel.kind === 'section' || sel.kind === 'header') return { band: sel.kind === 'header' ? 'header' : sel.id };
    return null;
  }
  // 'page' (nothing is framed), 'job', 'line' (written), 'lineSel' (a line outside a job: only selected), 'band' (a section or the
  // header: only the chip)
  function level(){
    if (ui.writing && S) return 'line';
    const tg = target();
    return !tg ? 'page' : tg.jobId ? 'job' : tg.fact ? 'lineSel' : tg.band ? 'band' : 'page';
  }

  // ---- what is on the page, in the page's own pixels ----
  const rectOfFact = (fact, ix) => { const el = S?.fact === fact && S.el?.isConnected ? S.el : sheet.elOf(fact, ix); return el ? sheet.rectOfEl(el) : null; };
  function read(){
    const ix = C.ix();
    const tg = target();
    const wr = ui.writing && S ? { fact: S.fact, jobId: C.ix().highlight.get(S.fact) ?? null } : null;
    const use = wr ?? tg;
    const jobId = use?.jobId ?? null;
    geom = {
      tg: use, boxes: sheet.pageBoxes(),
      line: use?.fact ? rectOfFact(use.fact, ix) : null,
      job: jobId ? sheet.rectOfJob(jobId, C.ix()) : null,
      band: use?.band ? sheet.rectOfBand(use.band) : null,
      jobId,
    };
  }

  // ---- drawing the layers ----
  function signature(lvl){
    const ed = edit().editing, tg = geom?.tg;
    return JSON.stringify([lvl, ui.sel, tg?.fact, tg?.jobId, !!ed, ed ? lineEnds(ed.fact) : null, geom?.boxes.length, ui.lang, C.lang()]);
  }
  function render(force = false){
    lay ??= $('#editlay');
    if (!lay) return;
    const lvl = level();
    if (zoomed && !ui.writing && ui.sel.kind === 'none'){ zoomed = false; canvas.reset(); }      // the page level: the view comes back out
    sheet.setWriting(lvl === 'line' ? readDimLine() : null);
    if (lvl === 'page'){ if (lay.firstChild) lay.replaceChildren(); geom = null; sig = ''; return; }
    read();
    // a job or a line that is not on this resume has nothing on the page to frame
    if (!geom.boxes.length || (!geom.job && !geom.line && !geom.band)){ if (lay.firstChild) lay.replaceChildren(); sig = ''; return; }
    const sg = signature(lvl);
    if (!force && sg === sig && lay.firstChild){ place(); return; }
    // a preview under the pointer (a version hovered in the sidebar) is a redraw: the layers stay as they are
    if (ui.previewing && lay.firstChild && !force){ place(); return; }
    sig = sg;
    const keep = document.activeElement?.closest?.('#editlay') ? document.activeElement.dataset?.act : null;
    const html = [];
    const dim = readDimJob();
    if (lvl === 'job') for (let i = 0; i < geom.boxes.length; i++) html.push(`<div class="obveil" data-p="${i}" style="opacity:${((100 - dim) / 100).toFixed(3)}"></div>`);
    if (geom.job && (lvl === 'job' || lvl === 'line')) html.push(`<div class="obframe job${lvl === 'line' ? ' dashed' : ''}"></div>`);
    if (lvl === 'line' && geom.line) html.push('<div class="obframe line"></div>');
    const tools = toolsFor(lvl);
    if (tools) html.push(`<div class="obtoolswrap" role="region" aria-label="${esc(t('ux3.tools'))}">${tools}</div>`);
    html.push(`<div class="obchip">${edit().depthHtml(ui.sel, { next: true, escKey: true })}</div>`);
    lay.innerHTML = html.join('');
    place();
    if (keep) lay.querySelector(`[data-act="${keep}"]`)?.focus({ preventScroll: true });
  }

  function lineEnds(fact){
    const w = T.jobOfFact(C.record(), fact), ids = w ? T.listedBullets(C.record(), C.cur(), w.id) : [];
    return { first: ids[0] === fact, last: ids.at(-1) === fact };
  }
  // the tools are for the line being written; the sidebar shows the versions
  function toolsFor(lvl){
    const fact = lvl === 'line' ? S?.fact : null;
    if (!fact) return '';
    const ed = edit().editing && edit().editing.fact === fact && !edit().editing.panel ? edit().editing : null;
    if (!ed) return '';
    const vn = C.work().variants.find(v => v.id === ed.vid)?.n ?? '·';       // the version the line was written from
    return toolsHtml({ vn, canMove: !!T.jobOfFact(C.record(), fact), ends: lineEnds(fact), counts: statsCompactHtml(ed) });
  }

  // where everything is on the screen: follows the camera
  function place(){
    if (!geom || !lay) return;
    const lvl = level();
    const R = r => (r ? canvas.screenRect(r) : null);
    const hole = lvl === 'job' ? R(pad(geom.job, PAD_JOB)) : null;
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
    const fact = lvl === 'line' ? S?.fact : null;
    const lr = fact ? (fact === geom.tg?.fact || (S && fact === S.fact) ? geom.line : rectOfFact(fact, C.ix())) : null;
    if (tw && lr){
      const pg = geom.boxes.find(b => lr.left >= b.left - 1 && lr.left < b.left + b.width) ?? geom.boxes[0];
      const edgeR = R({ left: pg.left + pg.width - pg.padRight, top: lr.top, width: 0, height: 0 });
      const sr = R(lr);
      const view = canvas.view, room = view ? view.left + view.width : innerWidth, twW = tw.offsetWidth;
      const x = Math.min(edgeR.left + 8, room - Math.max(44, twW + 6));
      let left = Math.max(sr.left + sr.width + 6 > x ? sr.left + sr.width + 6 : x, 6);
      if (left + twW > room) left = Math.max(6, sr.left - twW - 6);       // no room right of the line (a narrow window): to its left, never under the tabs
      Object.assign(tw.style, { left: `${left}px`, top: `${Math.max(6, sr.top - 4)}px` });
    } else if (tw) tw.style.display = 'none';
    const near = geom.line ?? geom.job ?? geom.band;
    const pg = near && (geom.boxes.find(b => near.left >= b.left - 1 && near.left < b.left + b.width) ?? geom.boxes[0]);
    placeChip(lay.querySelector('.obchip'), [geom.line, geom.job, geom.band].filter(Boolean).map(R), pg && R(pg));
  }
  // The chip floats over the page near what is selected and opens no gap: above the line, else in the margin to its left, else the
  // same around its job, else in the page's top or bottom margin, wherever no printed text is under it; inside the pages' room (never
  // under the rail or the sidebar) and above the zoom bar. With no clear place, above the nearest.
  function placeChip(chip, anchors, page){
    if (!chip || !anchors.length) return;
    const v = canvas.view ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const w = chip.offsetWidth, h = chip.offsetHeight;
    const fit = (x, y) => [Math.max(v.left + 6, Math.min(x, v.left + v.width - w - 6)), Math.max(v.top + 6, Math.min(y, v.top + v.height - h - 56))];
    const texts = sheet.textRects().map(r => canvas.screenRect(r));
    const clear = ([x, y]) => !texts.some(q => x < q.left + q.width && x + w > q.left && y < q.top + q.height && y + h > q.top);
    const margins = page ? [fit(anchors[0].left, page.top + 4), fit(anchors[0].left, page.top + page.height - h - 4)] : [];
    const at = [...anchors.flatMap(a => [fit(a.left, a.top - h - 6), fit(a.left - w - 10, a.top)]), ...margins].find(clear) ?? fit(anchors[0].left, anchors[0].top - h - 6);
    Object.assign(chip.style, { left: `${at[0]}px`, top: `${at[1]}px` });
  }

  // ---- writing a line where it is printed ----
  const supportsPlain = (() => { try { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only'; } catch { return false; } })();
  function attach(el, caret = null, point = null){
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
    const doc = el.ownerDocument, hit = point && caretAt(doc, point);
    if (caret) setCaret(el, caret);
    else if (hit && el.contains(hit.startContainer)){ const sel = doc.defaultView.getSelection(); sel.removeAllRanges(); sel.addRange(hit); }      // one click: the caret where it was clicked
    else {
      const sel = el.ownerDocument.defaultView.getSelection(), r = el.ownerDocument.createRange();
      r.selectNodeContents(el);
      if (ed.mode !== 'new') r.collapse(false);       // a new version starts with the copy selected, as the text box did
      sel.removeAllRanges(); sel.addRange(r);
    }
    rememberCaret();
  }
  // the caret under a point of the frame (Chromium and Safari, then Firefox)
  function caretAt(doc, p){
    if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(p.x, p.y);
    const c = doc.caretPositionFromPoint?.(p.x, p.y);
    if (!c) return null;
    const r = doc.createRange(); r.setStart(c.offsetNode, c.offset); return r;
  }
  function rememberCaret(){ if (S?.el?.isConnected) S.caret = caretOf(S.el) ?? S.caret; }
  function onInput(){
    if (!S || S.composing) return;
    rememberCaret();
    edit().draftChanged(plainOf(S.el));
  }

  // keys inside the line: Esc leaves it, Enter and Tab and the arrows at its edges go to the next line (each keeps what was typed),
  // Shift+Enter is a line break (the browser's own)
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
    if (e.key === 'Escape'){ done(); edit().cancelEdit(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey){ done(); if (!next(1)) edit().cancelEdit(); return; }
    if (e.key === 'Tab' && !mod && !e.altKey){ done(); next(e.shiftKey ? -1 : 1); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !mod && !e.altKey && !e.shiftKey && atEdge(e.target.closest('[contenteditable]') ?? S.el, e.key === 'ArrowDown' ? 1 : -1)){ done(); next(e.key === 'ArrowDown' ? 1 : -1); }
  }
  // The next line in print order, written at once, in the same zoom. A job's last line goes on to the next job's first: a new empty
  // line needs a claim of its own, which only the Review list (UX-6d) can add with a source. False at the page's last line.
  function next(dir){
    const ed = edit().editing;
    if (!ed) return false;
    const ix = C.ix();
    const id = step(sheet.order(ix), { kind: 'bullet', id: ed.fact }, dir);
    if (typeof id !== 'string' || id === ed.fact) return false;
    const job = ix.highlight.get(id);
    const sel = job ? { kind: 'bullet', id, job, section: 'experience' } : { kind: 'bullet', id, section: 'summary' };
    moving = true;
    try { C.select(sel); if (ui.sel.kind === 'bullet' && ui.sel.id === id) edit().startEdit(); }
    finally { moving = false; }
    return true;
  }

  // ---- called by edit.js ----
  // true when the line is on the page and is now written there
  function begin(){
    const ed = edit().editing;
    if (!ed || phone() || ui.view || ui.snap) return false;
    const el = sheet.elOf(ed.fact, C.ix());
    if (!el) return false;
    ui.writing = true;
    S = { fact: ed.fact, el: null, caret: null, composing: false };
    attach(el, null, ui.clickAt);
    ui.clickAt = null;
    // the first line written zooms in (unless the page is already that large); the next ones only pan
    if (readZoomWriteOn()) zoomed = canvas.writeTo(sheet.rectOfEl(el), readZoomWrite(), { keepZoom: zoomed }) || zoomed;
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
    S = null; ui.writing = false;
    if (!moving){ say(t('ux3.announceOff')); C.writeEnded?.(); }
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
    place();
    if (geom?.line) canvas.ensureVisible(geom.line);
  }
  // the page was drawn again (a version previewed, a save, a resize of the text): the line being written is found again
  function afterDraw(){
    if (ui.writing && S){
      const ed = edit().editing;
      const el = ed ? sheet.elOf(S.fact, C.ix()) : null;
      if (el && el !== S.el) attach(el, S.caret);
    }
    render();
  }

  // ---- the tools ----
  async function act(a){
    switch (a){
      case 'ob-up': case 'ob-down': { const e = lineEnds(edit().editing?.fact); if (!(a === 'ob-up' ? e.first : e.last)) edit().stepLine(a === 'ob-up' ? -1 : 1); return true; }
    }
    return false;
  }

  // run something that leaves one line and writes another, with the view staying where it is (no zoom out and in again)
  function keepView(fn){ moving = true; try { return fn(); } finally { moving = false; } }
  return {
    begin, end, text: () => (S?.composing && S.el?.isConnected ? plainOf(S.el) : null), setText, refresh, afterDraw, render, place, act, keepView,
    get writing(){ return !!ui.writing; },
    el: () => S?.el ?? null,
    level,
  };
}
