// Editing on the page. Three layers: the page, a job, a line. Esc goes up one.
//   - At the job level the job is framed and the rest of the page dims. The line being written is part of the page: no cover cut
//     out around it, the rest of the page's text fades a little (in the frame, src/ui/sheet.js setWriting), a thin outline.
//   - A line is written where it is printed: the element on the page becomes editable, holding the plain text of the version
//     (src/ui/plain.js reads it back, so the text is exactly what the old text box held). Everything else is the editor's own
//     (src/ui/edit.js): the draft, the live preview, keeping it on this resume when the line is left.
//   - Nothing else is drawn on the page: the tick, the padlock, the versions and ↑ ↓ are the editor card's top row (edit.js), and the card follows what is
//     selected (shell.js placeCard: selRect says where it is).
// All of it is drawn in the app's layer (#editlay), over the page; the page's own markup and its measurements are never touched,
// and nothing here is in an export. The camera (src/ui/canvas.js) eases to the writing zoom on the first line written, stays there
// from line to line, and comes back out only at the page level (Esc to the page, a click on the bare canvas). Under reduced motion
// there is no writing zoom: the camera only scrolls the line into view.

import { plainOf, caretOf, setCaret, rangeOf } from './plain.js';
import { esc } from './parts.js';
import { u16Of } from '../model/marks.js';
import { readZoomWrite, readZoomWriteOn, DIM } from './dock.js';
import { step, lineSel, keyOf } from './select.js';
import * as T from '../model/resume.js';
import { t } from '../i18n/index.js';
import { PHONE_MAX } from './layout.js';
import { reduced } from './motion.js';
import { icon } from './icons.js';
import { isKey } from './help.js';
import { off } from './plate.js';

const $ = (s, r = document) => r.querySelector(s);
// how far each level's plate stands off its block (the tokens, workbench.css): the chip and the grips stand on the plate's edge, and a job's veil is cut round it
const pad = (r, p) => (r ? { left: r.left - p, top: r.top - p, width: r.width + 2 * p, height: r.height + 2 * p } : null);

export function initOnPage(C){
  const { ui, sheet, canvas } = C;
  const edit = () => C.edit();
  let lay = null, geom = null, sig = '';
  let S = null;                    // the line being written: { fact, el, caret }
  let moving = false;              // from one line to the next: nothing is announced
  let frameNow = null;             // the frame the chip stands on, in screen pixels (the grips of a job, a section and an item stand by it)
  let zoomed = false;              // the camera has been eased to the writing zoom; it comes back at the page level
  const phone = () => innerWidth < PHONE_MAX;
  // entering and leaving write mode is announced
  const say = text => { const el = $('#announce'); if (el){ el.textContent = ''; setTimeout(() => { el.textContent = text; }, 30); } };

  // the job a printed text is part of: a line of it, or its title or dates
  const jobOf = (fact, job = null) => job ?? C.ix().highlight.get(fact) ?? C.ix().display.get(fact) ?? null;

  // ---- what level are we at ----
  function target(){
    const sel = ui.sel;
    if (ui.view || ui.snap || ui.preview || phone() || ui.fitting) return null;       // another resume's paper is being previewed: nothing is framed
    if (sel.kind === 'bullet') return { fact: sel.id, jobId: jobOf(sel.id, sel.job) };
    if (sel.kind === 'job') return { fact: null, jobId: sel.id };
    if (sel.kind === 'section' || sel.kind === 'header') return { band: sel.kind === 'header' ? 'header' : sel.id };
    if (sel.kind === 'record' && sel.what === 'item'){ const sid = T.sectionOfItem(C.record(), sel.id); return sid ? { band: sid } : null; }       // a skill group, a language: its section is framed
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
    const wr = ui.writing && S ? { fact: S.fact, jobId: jobOf(S.fact) } : null;
    const use = wr ?? tg;
    const jobId = use?.jobId ?? null;
    geom = {
      tg: use, boxes: sheet.pageBoxes(),
      line: use?.fact ? rectOfFact(use.fact, ix) : null,
      job: jobId ? sheet.rectOfJob(jobId, C.ix()) : null,
      band: use?.band ? sheet.rectOfBand(use.band) : null,
      jobId,
    };
    // the section being edited: where the chip stands (the band on this page when the section runs over two)
    const sel = ui.sel, sid = use?.band ?? (jobId ? T.sectionOfEntry(C.record(), jobId) : sel.kind === 'bullet' ? sel.section ?? 'summary' : sel.kind === 'section' ? sel.id : null);
    // the frame the chip stands on: the section's band, or for an item of a list section (education, a language, a certificate) the item
    const item = !jobId && sel.kind === 'bullet' && use?.fact === sel.id && !['summary', 'header', 'skills'].includes(sid);
    const it = sid && item ? sheet.rectOfItem(sel.id, ix) : null;
    geom.itemFrame = !!it;      // an item stands off less than a section: its neighbours are a line away
    geom.sec = sid ? it || sheet.rectOfBand(sid, geom.line ?? geom.job ?? geom.band) : null;
  }

  // ---- drawing the layers ----
  function signature(lvl){
    const ed = edit().editing, tg = geom?.tg;
    return JSON.stringify([lvl, ui.sel, tg?.fact, tg?.jobId, !!ed, edit().softShown, geom?.boxes.length, ui.lang, C.lang()]);
  }
  function render(force = false){
    lay ??= $('#editlay');
    if (!lay) return;
    const lvl = level();
    if (zoomed && !ui.writing && ui.sel.kind === 'none'){ zoomed = false; canvas.reset(); }      // the page level: the view comes back out
    sheet.setWriting(lvl === 'line' ? DIM.line : null);
    if (lvl === 'page'){ if (lay.firstChild) lay.replaceChildren(); geom = null; sig = ''; return; }
    read();
    // a job or a line that is not on this resume has nothing on the page to frame
    if (!geom.boxes.length || (!geom.job && !geom.line && !geom.band)){ if (lay.firstChild) lay.replaceChildren(); sig = ''; return; }
    const sg = signature(lvl);
    if (!force && sg === sig && lay.firstChild){ place(); return; }
    // a preview under the pointer (a version hovered in the sidebar) is a redraw: the layers stay as they are
    if (ui.previewing && lay.firstChild && !force){ place(); return; }
    sig = sg;
    const html = [];
    if (edit().softShown && edit().softShown === ui.sel.id && geom.line) html.push(`<button type="button" class="obsoft press" data-tier="tertiary" data-act="soft-unlock" aria-label="${esc(t('ux6f.softUnlock'))}">${icon('lock', { role: 'inline' })}</button>`);      // a guarded line (the name, a date, the contact): the lock that opens it for writing
    if (lay.innerHTML !== html.join('')) lay.innerHTML = html.join('');
    place();
  }

  const secPad = () => (geom.itemFrame ? off('group') : off('section'));
  // where everything is on the screen: follows the camera
  function place(){
    if (!geom || !lay) return;
    const lvl = level();
    const R = r => (r ? canvas.screenRect(r) : null);
    const fit = (r, p) => { const o = r && sheet.fitOff(r, p); return o ? { left: r.left - o.x, top: r.top - o.y, width: r.width + 2 * o.x, height: r.height + 2 * o.y } : null; };      // the selected block's plate, fitted as it is drawn (sheet.fitOff)
    frameNow = geom.job && (lvl === 'job' || lvl === 'line') ? R(lvl === 'job' ? fit(geom.job, off('job')) : pad(geom.job, off('job'))) : R(fit(geom.sec ?? geom.job ?? geom.line, secPad()));      // a line's frame is its job's ring, at its full stand-off
    const soft = lay.querySelector('.obsoft'), sl = soft && geom.line ? R(pad(geom.line, off('line'))) : null;
    if (sl) Object.assign(soft.style, { left: `${Math.round(sl.left - 14)}px`, top: `${Math.round(sl.top - 14)}px` });      // on the line's top-left corner: its right side has the photo slot, its left the grip
  }
  // ---- writing a line where it is printed ----
  const supportsPlain = (() => { try { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only'; } catch { return false; } })();
  // An item's title shares its element with the subtitle, a claim of its own: the title's words are wrapped, and only they are written
  function writable(el){
    const lead = [];
    for (const n of el.childNodes){ if (n.nodeType === 1 && n.hasAttribute('data-variant')) break; lead.push(n); }
    if (lead.length === el.childNodes.length) return el;
    const w = el.ownerDocument.createElement('span');
    w.setAttribute('data-write', '');
    el.insertBefore(w, el.firstChild);
    w.append(...lead);
    return w;
  }
  function attach(el, caret = null, point = null){
    const ed = edit().editing;
    if (!ed) return;
    el = writable(el);
    S.el = el;
    // the plain text in, with its line breaks and spaces as they are; marks come back when it is saved and drawn again
    el.textContent = ed.draft;
    el.style.whiteSpace = 'pre-wrap';
    el.contentEditable = supportsPlain ? 'plaintext-only' : 'true';
    el.spellcheck = true;
    el.setAttribute('role', 'textbox');
    if (edit().multiline(ed)) el.setAttribute('aria-multiline', 'true'); else el.removeAttribute('aria-multiline');
    el.setAttribute('aria-label', edit().fieldName(ed));
    const offs = [];
    const on = (ev, fn) => { el.addEventListener(ev, fn); offs.push(() => el.removeEventListener(ev, fn)); };
    on('input', onInput);
    on('keydown', onKey);
    on('keyup', rememberCaret);
    on('mousedown', e => { S.markDrag = e.altKey && !e.metaKey; });      // Alt, or Ctrl+Alt, held as the pointer goes down: what it selects is highlighted
    const doc0 = el.ownerDocument, up = () => { rememberCaret(); if (S?.markDrag){ S.markDrag = false; markSelection(); } };      // (the pointer may be let go outside the line)
    doc0.addEventListener('mouseup', up); offs.push(() => doc0.removeEventListener('mouseup', up));
    on('compositionstart', () => { S.composing = true; });
    on('compositionend', () => { S.composing = false; onInput(); });
    if (!supportsPlain) on('paste', e => { e.preventDefault(); el.ownerDocument.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
    S.off = () => offs.forEach(f => f());
    if (!document.activeElement?.closest?.('#editlay, #body .ctop')) el.focus({ preventScroll: true });      // a redraw while the card's top row has the focus (its versions list) does not take it back
    const doc = el.ownerDocument, hit = point && caretAt(doc, point);
    if (caret) setCaret(el, caret);
    else if (hit && el.contains(hit.startContainer)){ const sel = doc.defaultView.getSelection(); sel.removeAllRanges(); sel.addRange(hit); }      // one click: the caret where it was clicked
    else {
      const sel = el.ownerDocument.defaultView.getSelection(), r = el.ownerDocument.createRange();
      r.selectNodeContents(el);
      if (ed.mode !== 'new') r.collapse(!ed.base.trim());      // an empty heading (a new skill group's) starts with the caret; a new version starts with the copy selected, as the text box did
      sel.removeAllRanges(); sel.addRange(r);
    }
    rememberCaret();
    paintMarks();
    sheet.setWriting(DIM.line);      // the field is there now: its stand-off is measured and the plate takes it
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
    paintMarks();
  }
  // The highlights, painted over the words while the line is written (the CSS Custom Highlight API: nothing is added to the text; where a
  // webview lacks it they show again once the line is left)
  function paintMarks(){
    const el = S?.el, win = el?.ownerDocument.defaultView;
    if (!el?.isConnected || !win?.CSS?.highlights || !win.Highlight) return;
    const text = plainOf(el);
    win.CSS.highlights.set('rb-mark', new win.Highlight(...edit().marksNow(text).map(m => rangeOf(el, u16Of(text, m.start), u16Of(text, m.end)))));
  }
  // What is selected is highlighted, or cleared if it all is; a click (nothing selected) on a highlight clears it. The caret goes to the end.
  function markSelection(){
    const el = S?.el;
    if (!el?.isConnected) return false;
    const c = caretOf(el);
    if (!c) return false;
    const text = plainOf(el), did = c.start === c.end ? edit().unmarkAt(text, c.start) : edit().toggleMark(text, c.start, c.end);
    if (did){ setCaret(el, { start: c.end, end: c.end }); rememberCaret(); paintMarks(); }
    return did;
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
    if (mod && e.shiftKey && !e.altKey && isKey(e, 'h')){ done(); markSelection(); return; }      // Ctrl/Cmd+Shift+H: the selection, highlighted or cleared
    // Alt+↑ ↓ move the line, as the card's arrows do (and as they do for a selected line); Alt+Shift+↓ opens its versions, the card's menu
    if (e.altKey && !mod && (e.key === 'ArrowDown' || e.key === 'ArrowUp')){
      const vers = document.querySelector('#body .ctop .cver[data-act=top-menu]:not(:disabled)');
      if (e.shiftKey && e.key === 'ArrowDown' && vers){ done(); vers.click(); vers.nextElementSibling?.querySelector('.cvo')?.focus(); return; }
      if (!e.shiftKey && document.querySelector('#body .ctop [data-act=top-step]')){ done(); edit().stepLine(e.key === 'ArrowUp' ? -1 : 1); return; }
    }
    if (e.key === 'Escape'){ done(); edit().cancelEdit(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey){ done(); if (!addAfter() && !next(1)) edit().cancelEdit(); return; }
    if (e.key === 'Tab' && !mod && !e.altKey){ done(); next(e.shiftKey ? -1 : 1); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !mod && !e.altKey && !e.shiftKey && atEdge(e.target.closest('[contenteditable]') ?? S.el, e.key === 'ArrowDown' ? 1 : -1)){ done(); next(e.key === 'ArrowDown' ? 1 : -1); }
  }
  // Enter at a job's last line (with words in it): a new empty line after it, only on this resume until the Review list makes
  // it a claim with a source. Written at once, in the same zoom. False when this is not that, or the job's last line is empty.
  function addAfter(){
    const ed = edit().editing;
    if (!ed || !ed.draft.trim()) return false;
    const w = T.jobOfFact(C.record(), ed.fact, C.cur());
    if (!w || T.listedBullets(C.record(), C.cur(), w.id).at(-1) !== ed.fact) return false;      // (the job's last line only)
    keepView(() => edit().addLine(w.id, ed.fact));
    return true;
  }
  // The next line in print order, written at once, in the same zoom. A job's last line goes on to the next job's first.
  // False at the page's last line.
  function next(dir){
    const ed = edit().editing;
    if (!ed) return false;
    const ix = C.ix();
    const order = sheet.order(ix);
    let id = step(order, lineSel(ix, ed.fact), dir);
    for (let n = 0; typeof id === 'string' && id !== ed.fact && edit().lockedId(id) && n < order.length; n++){      // a locked text is passed over: it cannot be written
      const after = step(order, lineSel(ix, id), dir);
      if (after === id) return false;
      id = after;
    }
    if (typeof id !== 'string' || id === ed.fact || edit().lockedId(id)) return false;
    const sel = lineSel(ix, id);
    moving = true;
    try { C.select(sel); if (keyOf(ui.sel) === id) edit().startEdit(); }
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
    // reduced motion: no writing zoom at all, the line is only kept in view
    if (reduced()) canvas.ensureVisible(sheet.rectOfEl(el));
    else if (readZoomWriteOn()) zoomed = canvas.writeTo(sheet.rectOfEl(el), readZoomWrite(), { keepZoom: zoomed }) || zoomed;
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
    el?.ownerDocument.defaultView?.CSS?.highlights?.delete('rb-mark');
    if (el?.isConnected){
      el.removeAttribute('contenteditable'); el.removeAttribute('role'); el.removeAttribute('aria-multiline'); el.removeAttribute('aria-label');
      el.style.whiteSpace = ''; for (const v of ['--rb-gl', '--rb-gw', '--rb-gi']) el.style.removeProperty(v);
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
    place();
    if (geom?.line) canvas.ensureVisible(geom.line);
  }
  // the page was drawn again (a version previewed, a save, a resize of the text): the line being written is found again
  function afterDraw(){
    if (ui.writing && S){
      const ed = edit().editing;
      const el = ed ? sheet.elOf(S.fact, C.ix()) : null;
      if (el && el !== S.el && !ui.hoverFact) attach(el, S.caret);      // a version under the pointer in the sidebar shows in place of the draft; the draft comes back with the page
    }
    render();
  }

  // ---- the tools: none on the page now (the card's top row has them) ----
  async function act(){ return false; }

  // run something that leaves one line and writes another, with the view staying where it is (no zoom out and in again)
  function keepView(fn){ moving = true; try { return fn(); } finally { moving = false; } }
  return {
    begin, end, text: () => (S?.composing && S.el?.isConnected ? plainOf(S.el) : null), setText, refresh, afterDraw, render, place, act, keepView,
    get writing(){ return !!ui.writing; },
    frame: () => (geom ? frameNow : null),
    // where what is selected is on the screen (the line, the job, the item or the section): the editor card aims at it
    selRect: () => { const r = geom && (geom.line ?? geom.job ?? geom.sec ?? geom.band); return r ? canvas.screenRect(r) : null; },
    el: () => S?.el ?? null,
    fact: () => S?.fact ?? null,
    level,
  };
}
