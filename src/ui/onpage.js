// Editing on the page (UX-3, UX-6c). Three layers: the page, a job, a line. Esc goes up one.
//   - At the job level the job is framed and the rest of the page dims. The line being written is part of the page: no cover cut
//     out around it, the rest of the page's text fades a little (in the frame, src/ui/sheet.js setWriting), a thin outline.
//   - A line is written where it is printed: the element on the page becomes editable, holding the plain text of the version
//     (src/ui/plain.js reads it back, so the text is exactly what the old text box held). Everything else is the editor's own
//     (src/ui/edit.js): the draft, the live preview, keeping it on this resume when the line is left.
//   - A small quiet chip lies on the top-right corner of the plate of the block being edited: where you are in single words (Page › Experience › Hydra), each
//     level a button. The same component heads the editor card (parts.js depthHtml), at its normal size.
//   - The tools sit beside a line being written, in the page's right margin: the version number, ↑ and ↓, the counts.
// All of it is drawn in the app's layer (#editlay), over the page; the page's own markup and its measurements are never touched,
// and nothing here is in an export. The camera (src/ui/canvas.js) eases to the writing zoom on the first line written, stays there
// from line to line, and comes back out only at the page level (Esc to the page, a click on the bare canvas). Under reduced motion
// there is no writing zoom: the camera only scrolls the line into view.

import { plainOf, caretOf, setCaret } from './plain.js';
import { toolsHtml, esc } from './parts.js';
import * as R from '../model/record.js';
import { readZoomWrite, readZoomWriteOn, DIM } from './dock.js';
import { step, lineSel, keyOf } from './select.js';
import * as T from '../model/resume.js';
import { t } from '../i18n/index.js';
import { PHONE_MAX } from './layout.js';
import { reduced } from './motion.js';
import { icon } from './icons.js';
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
  function signature(lvl, chip){
    const ed = edit().editing, tg = geom?.tg;
    return JSON.stringify([lvl, ui.sel, tg?.fact, tg?.jobId, !!ed, ed ? lineEnds(ed.fact) : null, ed && !ed.group && !ed.label ? [versionItems(ed.fact), isMine(ed.fact)] : null, selMiss(lvl), ed ? missTag(ed.fact) : null, geom?.boxes.length, ui.lang, C.lang(), chip]);
  }
  function render(force = false){
    lay ??= $('#editlay');
    if (!lay) return;
    if (!lay.dataset.vers){ lay.dataset.vers = '1'; bindVers(); }
    const lvl = level();
    if (zoomed && !ui.writing && ui.sel.kind === 'none'){ zoomed = false; canvas.reset(); }      // the page level: the view comes back out
    sheet.setWriting(lvl === 'line' ? DIM.line : null);
    if (lvl === 'page'){ if (lay.firstChild) lay.replaceChildren(); geom = null; sig = ''; return; }
    read();
    // a job or a line that is not on this resume has nothing on the page to frame
    if (!geom.boxes.length || (!geom.job && !geom.line && !geom.band)){ if (lay.firstChild) lay.replaceChildren(); sig = ''; return; }
    const chipHtml = edit().depthHtml(ui.sel, { page: true });      // the padlock and the switch change with the lock and the switch
    const sg = signature(lvl, chipHtml);
    if (!force && sg === sig && lay.firstChild){ place(); return; }
    // a preview under the pointer (a version hovered in the sidebar) is a redraw: the layers stay as they are
    if (ui.previewing && lay.firstChild && !force){ place(); return; }
    sig = sg;
    const keep = document.activeElement?.closest?.('#editlay') ? document.activeElement.dataset?.act : null;
    const html = [];
    const tools = toolsFor(lvl);
    if (tools) html.push(`<div class="obtoolswrap" role="region" aria-label="${esc(t('ux3.tools'))}">${tools}</div>`);
    if (edit().softShown && edit().softShown === ui.sel.id && geom.line) html.push(`<button type="button" class="obsoft press" data-tier="tertiary" data-act="soft-unlock" aria-label="${esc(t('ux6f.softUnlock'))}">${icon('lock', { role: 'inline' })}</button>`);      // a guarded line (the name, a date, the contact): the lock that opens it for writing
    html.push(`<div class="obchip">${chipHtml}</div>`);
    lay.innerHTML = html.join('');
    place();
    if (keep){ quiet = true; lay.querySelector(`[data-act="${keep}"]`)?.focus({ preventScroll: true }); quiet = false; }      // the focus put back after a redraw does not open the list
  }

  function lineEnds(fact){
    const w = T.jobOfFact(C.record(), fact, C.cur()), ids = w ? T.listedBullets(C.record(), C.cur(), w.id) : [];
    return { first: ids[0] === fact, last: ids.at(-1) === fact };
  }
  // the tools are for the line being written; the sidebar shows the versions
  function toolsFor(lvl){
    const fact = lvl === 'line' ? S?.fact : null;
    const sm = !fact && selMiss(lvl);
    if (sm) return toolsHtml({ vn: sm.n, tag: { fact: ui.sel.id, items: [], miss: sm }, canMove: false });      // a line that prints the other language is not written here: its greyed number is all it has
    if (!fact) return '';
    const ed = edit().editing && edit().editing.fact === fact && !edit().editing.panel ? edit().editing : null;
    if (!ed || ed.group || ed.label) return '';      // a skill group, a heading and a language's name have no versions
    const vn = C.work().variants.find(v => v.id === ed.vid)?.n ?? '·';       // the version the line was written from
    return toolsHtml({ vn, tag: { fact, items: versionItems(fact), mine: isMine(fact), miss: missTag(fact), locked: edit().lockedId(fact) ? t('ux6c.lockedHint') : '' }, canMove: !!T.jobOfFact(C.record(), fact, C.cur()), ends: lineEnds(fact) });
  }

  // a line of a group of language copies that prints the other language's version (the number is greyed and says whose it is)
  function missTag(fact){
    const m = edit().missingOf(fact);
    return m?.want && !isMine(fact) ? { n: m.want, from: m.from } : null;
  }

  // the line selected, not written, when it prints the other language's version in a group
  const selMiss = lvl => (['job', 'lineSel'].includes(lvl) && ui.sel.kind === 'bullet' ? missTag(ui.sel.id) : null);

  // the text of the line is on this resume only: an edit kept, or one being typed
  const isMine = fact => C.cur().overrides?.[fact] !== undefined || edit().isDirty();
  // the line's versions as the list beside it shows them: numbers in order, the one in use marked, an edit on this resume (or one set aside)
  // where it would be numbered
  function versionItems(fact){
    const L = C.lang(), m = C.work(), cur = C.cur(), vs = R.versionsIn(m, fact, L);
    if (!vs.length) return [];
    const over = cur.overrides?.[fact], mine = over ?? cur.parked?.[fact]?.text, using = C.chooseVariant(m, fact, cur).v?.id;
    const items = vs.map(v => ({ id: v.id, n: v.n, cur: over === undefined && v.id === using }));
    if (mine !== undefined && String(mine).trim()){
      const n = R.suggestNumber(m, fact, mine, L).n, at = items.findIndex(o => R.compareN(o.n, n) > 0);
      items.splice(at < 0 ? items.length : at, 0, { id: null, n, mine: true, cur: over !== undefined });
    }
    return items;
  }

  // ---- the version tag's list ----
  // Opens on hover, focus or a click; moving over a number (or the arrows) previews it on the page; a click or Enter chooses it; Esc or
  // leaving closes it and the page goes back. The list is part of the tools column, over no printed text.
  let opened = null, quiet = false, touched = false;                                // how the list was opened: 'hover', 'focus', 'click' or 'key'
  const tag = () => lay?.querySelector('.obv[aria-haspopup]'), list = () => lay?.querySelector('.obvlist');
  const optAct = () => list()?.querySelector('.obvopt.act');
  function openVers(how){
    const l = list(), b = tag();
    if (!l || !b || b.disabled) return;
    if (l.hidden){ l.hidden = false; b.setAttribute('aria-expanded', 'true'); capStacks(l, b); }
    opened = how;
    if (how === 'key' || how === 'click') l.focus({ preventScroll: true });      // no number is marked: the arrows start from the pill
  }
  // a stack that would run out of the visible canvas (the window's top, the zoom bar at the bottom) is capped and scrolls, anchored at the pill: the pill never moves
  function capStacks(l, b){
    const v = canvas.view ?? { top: 0, height: innerHeight }, r = b.getBoundingClientRect();
    const up = l.querySelector('.obvstack.up'), dn = l.querySelector('.obvstack.dn');
    if (up){ up.style.maxHeight = `${Math.max(28, r.top - (v.top + 6))}px`; up.scrollTop = up.scrollHeight; }      // the nearest lower version stays by the pill
    if (dn){ dn.style.maxHeight = `${Math.max(28, v.top + v.height - 56 - r.bottom)}px`; dn.scrollTop = 0; }
  }
  // end: the preview goes too (not when a version was just chosen: the choice takes the page over)
  function closeVers({ end = true, back = false } = {}){
    const l = list(), b = tag();
    opened = null;
    if (!l || l.hidden) return;
    l.hidden = true; l.removeAttribute('aria-activedescendant');
    l.querySelectorAll('.act').forEach(o => o.classList.remove('act'));
    b?.setAttribute('aria-expanded', 'false');
    if (end) C.endHover();
    if (back){ quiet = true; b?.focus({ preventScroll: true }); quiet = false; }      // the focus returning to the number does not open the list again
  }
  function markOpt(o, preview = true){
    const l = list();
    if (!l || !o) return;
    l.querySelectorAll('.act').forEach(x => x.classList.remove('act'));
    o.classList.add('act'); l.setAttribute('aria-activedescendant', o.id); o.scrollIntoView({ block: 'nearest' });
    if (!preview) return;
    if (o.dataset.v) C.previewVersion(l.dataset.fact, o.dataset.v); else C.endHover();
  }
  function versKey(e){
    const l = list(), b = tag();
    if (!l || !b) return;
    if (e.target === b && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)){ e.preventDefault(); e.stopPropagation(); openVers('key'); return; }
    if (e.target !== l) return;
    // screen order is number order (lower stack, then higher stack); the pill is the gap between them: with none marked the arrows start there, Up to the next lower number, Down to the next higher
    const os = [...l.querySelectorAll('.obvopt')], gap = l.querySelectorAll('.obvstack.up .obvopt').length - .5, i = os.indexOf(optAct()), at = i < 0 ? gap : i, stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ stop(); markOpt(os[Math.min(os.length - 1, Math.max(0, e.key === 'ArrowDown' ? Math.floor(at + 1) : Math.ceil(at - 1)))]); }
    else if (e.key === 'Home' || e.key === 'End'){ stop(); markOpt(os[e.key === 'Home' ? 0 : os.length - 1]); }
    else if (e.key === 'Enter' || e.key === ' '){ stop(); const o = optAct(); closeVers({ end: false }); if (o) o.click(); else C.endHover(); }
    else if (e.key === 'Escape'){ stop(); closeVers({ back: true }); }
    else if (e.key === 'Tab') closeVers();
  }
  function bindVers(){
    lay.addEventListener('keydown', versKey);
    lay.addEventListener('mouseover', e => { if (e.target.closest?.('.obv[aria-haspopup]') && list()?.hidden) openVers('hover'); });
    lay.addEventListener('pointerdown', e => { touched = e.pointerType === 'touch'; });
    lay.addEventListener('mouseout', e => { const w = e.target.closest?.('.obvwrap'); if (w && !w.contains(e.relatedTarget) && opened !== 'key' && !touched) closeVers(); });      // a finger leaves nothing to leave: the list stays until a number is chosen, Esc, or a tap elsewhere
    lay.addEventListener('focusin', e => { if (!quiet && e.target.closest?.('.obv[aria-haspopup]') && list()?.hidden) openVers('focus'); });
    lay.addEventListener('focusout', e => { const w = e.target.closest?.('.obvwrap'); if (w && !w.contains(e.relatedTarget)) closeVers(); });
    lay.addEventListener('click', e => { if (e.target.closest?.('.obvopt')) closeVers({ end: false }); });      // the choice (shell.js) takes the page over
  }

  const secPad = () => (geom.itemFrame ? off('group') : off('section'));
  // where everything is on the screen: follows the camera
  function place(){
    if (!geom || !lay) return;
    const lvl = level();
    const R = r => (r ? canvas.screenRect(r) : null);
    const fit = (r, p) => { const o = r && sheet.fitOff(r, p); return o ? { left: r.left - o.x, top: r.top - o.y, width: r.width + 2 * o.x, height: r.height + 2 * o.y } : null; };      // the selected block's plate, fitted as it is drawn (sheet.fitOff)
    // the tools sit beside the line, in the page's right margin
    const tw = lay.querySelector('.obtoolswrap');
    const fact = lvl === 'line' ? S?.fact : selMiss(lvl) ? ui.sel.id : null;
    const lr = fact ? (fact === geom.tg?.fact || (S && fact === S.fact) ? geom.line : rectOfFact(fact, C.ix())) : null;
    if (tw && lr){
      const pg = geom.boxes.find(b => lr.left >= b.left - 1 && lr.left < b.left + b.width) ?? geom.boxes[0];
      const edgeR = R({ left: pg.left + pg.width - pg.padRight, top: lr.top, width: 0, height: 0 });
      const sr = R(lr);
      const view = canvas.view, room = view ? view.left + view.width : innerWidth, twW = tw.offsetWidth;
      const ring = geom.sec && !geom.itemFrame ? R(pad(geom.sec, off('section') + 1)) : null;      // outside the section's ring (UX-6f 4c: the tools cross no line of the plate's)
      // The row stays right of the line. Its ↑ ↓ may run past `room` and slide under the sidebar (the layer is below it); only when the
      // pill itself would be partly covered does the whole row go left of the line, all together, never split.
      const pw = tw.querySelector('.obvwrap, .obv')?.offsetWidth ?? twW, x = Math.max(edgeR.left + 8, ring ? ring.left + ring.width + 4 : 0);
      let left = Math.max(sr.left + sr.width + 6 > x ? sr.left + sr.width + 6 : x, 6);
      if (left + pw + 3 > room) left = Math.max(6, sr.left - twW - 6);
      // what runs past the sidebar's rail is hidden: the arrows go behind the editor (the layer is under the sidebar, but the rail's empty height shows through)
      const rl = document.querySelector('#rail')?.getBoundingClientRect(), cut = rl && rl.width ? Math.max(room, rl.left) : room, over = left + twW - cut;
      tw.style.clipPath = over > 0 ? `inset(-6px ${Math.ceil(over)}px -6px -6px)` : '';
      Object.assign(tw.style, { left: `${left}px`, top: `${Math.max(6, sr.top - 4)}px` });
    } else if (tw) tw.style.display = 'none';
    frameNow = geom.job && (lvl === 'job' || lvl === 'line') ? R(lvl === 'job' ? fit(geom.job, off('job')) : pad(geom.job, off('job'))) : R(fit(geom.sec ?? geom.job ?? geom.line, secPad()));      // a line's frame is its job's ring, at its full stand-off
    placeChip(lay.querySelector('.obchip'), frameNow);
    const soft = lay.querySelector('.obsoft'), sl = soft && geom.line ? R(pad(geom.line, off('line'))) : null;
    if (sl) Object.assign(soft.style, { left: `${Math.round(sl.left - 14)}px`, top: `${Math.round(sl.top - 14)}px` });      // on the line's top-left corner: its right side has the photo slot, its left the grip
  }
  // One rule: the chip lies on the plate of the current block (the job's, or the section's), centred on its top edge in its
  // top-right corner (where the top edge has no clear place, the bottom edge). Kept inside the page, in the pages' room (never under the rail or the sidebar) and above the zoom bar; moved
  // along the edge until it is clear of printed text, of the tools beside the line and of the photo slot. It follows the frame with the camera.
  function placeChip(chip, f){
    if (!chip || !f) return;
    const v = canvas.view ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const w = chip.offsetWidth, h = chip.offsetHeight;
    const pg = geom.boxes.map(b => canvas.screenRect(b)).find(b => f.left >= b.left - 1 && f.left < b.left + b.width);
    const lo = Math.max(v.left + 6, pg ? pg.left + 2 : -Infinity), hi = v.left + v.width - w - 6;      // the chip may stand past the page's right edge, on the desk, when the page's margin has no clear place for its tools
    const lowest = v.top + v.height - h - 56;
    // on the top edge, else just above it (a tight item frame has text under its edge), each also 3px up or down (with denser lines the gap between two lines can be a pixel short of the chip);
    // else on the bottom edge or just under it (UX-6f 4c: never over text)
    const clampY = y => Math.max(v.top + 6, Math.min(y, lowest));
    const top = [0, -3, 3].flatMap(d => [f.top - h / 2, f.top - h].map(y => clampY(y) + d)), ys = [...top, ...[f.top + f.height - h / 2, f.top + f.height].map(clampY)];
    const texts = sheet.textRects().map(r => canvas.screenRect(r));
    const tw = lay.querySelector('.obtoolswrap'), tr = tw && tw.style.display !== 'none' ? tw.getBoundingClientRect() : null, sr = document.querySelector('#handlay .obslot:not([hidden])')?.getBoundingClientRect(), pl = document.querySelector('#handlay .obplus:not([hidden])')?.getBoundingClientRect();      // and the photo slot and the "+" (hands.js)
    const hit = (x, q, y) => x < q.left + q.width && x + w > q.left && y < q.top + q.height && y + h > q.top;
    const gt = { left: f.left - 14 * canvas.cam.k - 12, top: f.top - 2, width: 28 * canvas.cam.k + 14, height: f.height + 4 };      // the grip's tab at the frame's left side, widened out of it or inside it (sheet.tabBox, with its wider target): the chip keeps clear of it
    const pz = geom.job ? { left: f.left + f.width / 2 - 44, top: f.top + f.height - 2, width: 88, height: 20 } : null;      // a selected job's "+" hangs at its bottom centre (hands.js), shown on a hover after the chip is placed
    const x0 = Math.max(lo, Math.min(f.left + f.width - w - 12, hi));
    // the corner first, then outwards along the edge into the page's margin, then inwards, to the first place clear of text and tools
    const xs = [x0, ...Array.from({ length: Math.max(0, Math.floor((hi - x0) / 8)) }, (_, i) => x0 + 8 * (i + 1)), ...Array.from({ length: Math.max(0, Math.floor((x0 - lo) / 8)) }, (_, i) => x0 - 8 * (i + 1))];
    let y = ys[0], x;
    const right = xs.filter(x => x + w / 2 > f.left + f.width / 2 && x < f.left + f.width - 8);      // on the right half of the top edge first, at either height, then anywhere along an edge
    for (const [yy, set] of [...top.map(yy => [yy, right]), ...ys.map(yy => [yy, xs])]){ x = set.find(x => !texts.some(q => hit(x, q, yy)) && !(tr && hit(x, tr, yy)) && !(sr && hit(x, sr, yy)) && !(pl && hit(x, pl, yy)) && !(pz && hit(x, pz, yy)) && !hit(x, gt, yy)); if (x !== undefined){ y = yy; break; } }
    if (x === undefined) for (const yy of [...ys, Math.max(v.top + 6, f.top - h - 3)]){ x = xs.find(q => !hit(q, gt, yy)); if (x !== undefined){ y = yy; break; } }      // no place clear of everything: at least off the grip's tab
    Object.assign(chip.style, { left: `${x ?? x0}px`, top: `${y}px` });
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
  // A skill group is written where it is printed, whole: its own paragraph, the name on the first line where its label stands and the skills below (UX-6f 4c: no second
  // name under the real one). The label's and the skills' own looks are kept for the two lines (the frame's .skills__group[contenteditable] rules).
  const fieldOf = el => (edit().editing?.group ? el?.closest('.skills__group') ?? el : el);
  function attach(el, caret = null, point = null){
    const ed = edit().editing;
    if (!ed) return;
    if (ed.group){
      const g = el.closest('.skills__group'), cs = q => g.ownerDocument.defaultView.getComputedStyle(g.querySelector(q) ?? g);
      if (g){ el = g; const l = cs('.skills__label'), i = cs('.skills__items'); g.style.setProperty('--rb-gl', l.color); g.style.setProperty('--rb-gw', l.fontWeight); g.style.setProperty('--rb-gi', i.color); }
    } else el = writable(el);
    S.el = el;
    // the plain text in, with its line breaks and spaces as they are; marks come back when it is saved and drawn again
    const onSkills = ed.group && point && !!el.ownerDocument.elementFromPoint(point.x, point.y)?.closest('.skills__items');      // a click on a group's skills puts the caret at their end (the group is written as name, line break, skills)
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
    on('mouseup', rememberCaret);
    on('compositionstart', () => { S.composing = true; });
    on('compositionend', () => { S.composing = false; onInput(); });
    if (!supportsPlain) on('paste', e => { e.preventDefault(); el.ownerDocument.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
    S.off = () => offs.forEach(f => f());
    if (!document.activeElement?.closest?.('#editlay')) el.focus({ preventScroll: true });      // a redraw while the version tag has the focus does not take it back
    const doc = el.ownerDocument, hit = point && caretAt(doc, point);
    if (caret) setCaret(el, caret);
    else if (onSkills){ const sel = doc.defaultView.getSelection(), r = doc.createRange(); r.selectNodeContents(el); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
    else if (hit && el.contains(hit.startContainer)){ const sel = doc.defaultView.getSelection(); sel.removeAllRanges(); sel.addRange(hit); }      // one click: the caret where it was clicked
    else {
      const sel = el.ownerDocument.defaultView.getSelection(), r = el.ownerDocument.createRange();
      r.selectNodeContents(el);
      if (ed.mode !== 'new') r.collapse(!!ed.group && !ed.base.trim());      // a new skill group starts at its name; a new version starts with the copy selected, as the text box did
      sel.removeAllRanges(); sel.addRange(r);
    }
    rememberCaret();
    sheet.setWriting(DIM.line);      // the field is there now: its stand-off is measured and the plate takes it (UX-6f 4c)
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
    // Alt+↑ ↓ move the line, as the arrows beside it say (and as they do for a selected line); Alt+Shift+↓ is the way from the line to its versions
    if (e.altKey && !mod && (e.key === 'ArrowDown' || e.key === 'ArrowUp')){
      if (e.shiftKey && e.key === 'ArrowDown' && tag() && !tag().disabled){ done(); openVers('key'); return; }
      if (!e.shiftKey && lay?.querySelector('[data-act=ob-up]')){ done(); act(e.key === 'ArrowUp' ? 'ob-up' : 'ob-down'); return; }
    }
    if (e.key === 'Escape'){ done(); edit().cancelEdit(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && edit().editing?.group && toSkills()){ done(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey){ done(); if (!addAfter() && !next(1)) edit().cancelEdit(); return; }
    if (e.key === 'Tab' && !mod && !e.altKey){ done(); next(e.shiftKey ? -1 : 1); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !mod && !e.altKey && !e.shiftKey && atEdge(e.target.closest('[contenteditable]') ?? S.el, e.key === 'ArrowDown' ? 1 : -1)){ done(); next(e.key === 'ArrowDown' ? 1 : -1); }
  }
  // Enter on a skill group's name goes down to its skills (their end), never a second name; on the skills it goes on as on a line. False when the caret is on the skills.
  function toSkills(){
    const tx = plainOf(S.el), nl = tx.indexOf('\n'), at = caretOf(S.el)?.start ?? tx.length;
    if (nl >= 0 && at > nl) return false;
    if (nl < 0){ S.el.textContent = `${tx}\n`; onInput(); }      // a group with no skills yet: their line is made
    const end = plainOf(S.el).length;
    setCaret(S.el, { start: end, end }); rememberCaret();
    return true;
  }
  // Enter at a job's last line (with words in it): a new empty line after it, only on this resume until the Review list (UX-6d) makes
  // it a claim with a source. Written at once, in the same zoom. False when this is not that, or the job's last line is empty.
  function addAfter(){
    const ed = edit().editing;
    if (!ed || !ed.draft.trim()) return false;
    const w = T.jobOfFact(C.record(), ed.fact, C.cur());
    if (!w || !lineEnds(ed.fact).last) return false;
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
    const el = fieldOf(sheet.elOf(ed.fact, C.ix()));
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
    const ed = edit().editing;
    const b = tag();
    if (b && ed){ const m = isMine(ed.fact); b.classList.toggle('mine', m); m ? b.setAttribute('title', t('ux6g.onlyHere')) : b.removeAttribute('title'); b.setAttribute('aria-label', t(m ? 'ux6g.tagNameMine' : 'ux6g.tagName', { v: b.textContent.trim().slice(1) })); }      // typing makes the line this resume's own
    place();
    if (geom?.line) canvas.ensureVisible(geom.line);
  }
  // the page was drawn again (a version previewed, a save, a resize of the text): the line being written is found again
  function afterDraw(){
    if (ui.writing && S){
      const ed = edit().editing;
      const el = ed ? fieldOf(sheet.elOf(S.fact, C.ix())) : null;
      if (el && el !== S.el && !ui.hoverFact) attach(el, S.caret);      // a version under the pointer in the sidebar shows in place of the draft; the draft comes back with the page
    }
    render();
  }

  // ---- the tools ----
  async function act(a){
    switch (a){
      case 'ob-vers': if (list()?.hidden === false && opened !== 'hover' && opened !== 'focus') closeVers({ back: true }); else openVers('click'); return true;
      case 'ob-up': case 'ob-down': { const e = lineEnds(edit().editing?.fact); if (!(a === 'ob-up' ? e.first : e.last)) edit().stepLine(a === 'ob-up' ? -1 : 1); return true; }
    }
    return false;
  }

  // run something that leaves one line and writes another, with the view staying where it is (no zoom out and in again)
  function keepView(fn){ moving = true; try { return fn(); } finally { moving = false; } }
  return {
    begin, end, text: () => (S?.composing && S.el?.isConnected ? plainOf(S.el) : null), setText, refresh, afterDraw, render, place, act, keepView,
    get writing(){ return !!ui.writing; },
    frame: () => (lay?.firstChild ? frameNow : null),
    el: () => S?.el ?? null,
    fact: () => S?.fact ?? null,
    level,
  };
}
