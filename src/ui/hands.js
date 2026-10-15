// The hands over the page (UX-6c-ii): beside the line, skill group or header under the pointer (or selected), a grip to move it, a "+"
// to add after it, and the photo slot by the name. Drawn in the app's layer (#handlay) over the page, in screen pixels, from the
// rectangles the sheet reports in the page's own pixels; nothing here is in an export.
//   - A line moves only within its job, a skill group within Skills, a skill to a place in any group. A drop anywhere else is refused
//     with the reason, and nothing changes. The sidebar's ↑ ↓ and chips are the keyboard route; the grip itself takes ↑ ↓ too.
//   - The grip and the "+" stay reachable on the way to them: a line owns the margin left of its text and the gap below it (the
//     sheet's handAt), and leaving the page waits a moment (motion.js `fast`) before they go, unless the pointer is on them.
//   - A job, a section and an item (UX-6c-iii-b) have a grip on the dashed frame of the selected block: at its top edge's left end, mirrored from
//     the chip. It moves the block within its parent (jobs within their section, sections within the page, items within their section); a drop
//     elsewhere is refused with the reason. A locked block has no grip (the padlock stands at its corner), no "+" and no skill drag.
//   - A drag shows a drop line and, when refused, the reason. Off under reduced motion: the grip's fade only; the drop line is
//     feedback, not motion.

import * as T from '../model/resume.js';
import { lineSel } from './select.js';
import { icon } from './icons.js';
import { pillHtml } from './parts.js';
import { t } from '../i18n/index.js';
import { PHONE_MAX } from './layout.js';
import { dur, play } from './motion.js';

const $ = s => document.querySelector(s);
const GRIP = { w: 18, h: 18 }, PLUS = { w: 18, h: 18 }, SLOT = { w: 40, h: 24 }, OFF = 22, MOVE = 4;

export function initHands(C){
  const { ui, sheet, canvas } = C;
  const lay = $('#handlay');
  const ix = () => C.ix();
  const phone = () => innerWidth < PHONE_MAX;
  const btn = (cls, icn, size = 12) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.hidden = true; b.innerHTML = icon(icn, { size }); return b; };
  const grip = btn('obgrip', 'grip'), plus = btn('obplus', 'plus'), slot = btn('obslot', 'photo'), fgrip = btn('obgrip obfgrip', 'grip');
  const dropEl = document.createElement('div'), tip = document.createElement('div');
  dropEl.className = 'obdrop'; dropEl.hidden = true;
  tip.className = 'obtip'; tip.hidden = true; tip.setAttribute('role', 'status');
  slot.innerHTML = pillHtml(false);      // the photo's show/hide is the pill, as on the chip
  lay?.append(grip, plus, slot, fgrip, dropEl, tip);

  let hover = null;                 // under the pointer: { k: 'line' | 'group' | 'header', fact, rect, job }
  let drag = null, pend = null;     // a drag under way; a skill pressed on the page that may become one
  let graceT = 0, onHands = false, dragEnded = 0, raf = 0, shown = '';

  const locked = id => !!id && C.edit().lockedId(id);
  const on = () => !!lay && !phone() && !ui.view && !ui.snap && !ui.preview && !ui.fitting && !document.body.classList.contains('is-quiet');
  const pt = e => { const c = canvas.cam; return { x: (e.clientX - c.x) / c.k, y: (e.clientY - c.y) / c.k }; };      // a window point, in the page's pixels
  const R = r => canvas.screenRect(r);

  // ---- what the hands are for: the hovered thing, else the selected one ----
  const reread = h => {
    if (!h) return null;
    if (h.k === 'header') { const r = sheet.headerRects(); return r ? { ...h, rect: r.band } : null; }
    const el = sheet.elOf(h.fact, ix());
    return el ? { ...h, rect: sheet.rectOfEl(el), edge: sheet.edgeOf(el) } : null;
  };
  function fromSel(){
    const s = ui.sel, x = ix();
    if (s.kind === 'header' || (s.kind === 'bullet' && s.section === 'header')) return reread({ k: 'header' });
    if (s.kind === 'bullet' && s.job) return reread({ k: 'line', fact: s.id, job: s.job });
    if (s.kind === 'bullet' && s.section === 'skills') return reread({ k: 'group', fact: s.id });
    if (s.kind === 'job') { const l = sheet.jobLines(s.id, x).at(-1); return l ? { k: 'line', fact: l.fact, job: s.id, rect: l.rect, edge: l.edge, selOnly: true } : null; }
    return null;
  }
  const target = () => reread(hover) ?? fromSel();

  // ---- placing ----
  // a spot is free when it stays inside the pages' room, above the zoom bar, and covers no printed text
  function free(x, y, w, h){
    const v = canvas.view ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
    if (x < v.left + 2 || x + w > v.left + v.width - 2 || y < v.top + 2 || y + h > v.top + v.height - 56) return false;
    return !sheet.textRects().some(q => { const s = R(q); return x < s.left + s.width && x + w > s.left && y < s.top + s.height && y + h > s.top; });
  }
  const put = (el, x, y, ok) => { el.hidden = !ok; if (ok) { el.style.left = `${Math.round(x)}px`; el.style.top = `${Math.round(y)}px`; } };
  function place(){
    if (!lay) return;
    if (drag){ plus.hidden = slot.hidden = true; if (!drag.press) grip.hidden = fgrip.hidden = true; return; }      // the grip being dragged stays where it is
    const h = on() ? target() : null;
    const writing = h?.k && ui.writing && h.fact && C.writingFact() === h.fact;
    const x = ix();
    let gb = null;
    // the grip: beside the first row of the line or group
    if (h && (h.k === 'line' || h.k === 'group') && !h.selOnly && !writing && on() && !locked(h.fact)){
      const r = R(h.rect), row = Math.min(r.height, 16 * canvas.cam.k);
      const gx = R({ left: h.edge ?? h.rect.left, top: 0, width: 0, height: 0 }).left - OFF, gy = r.top + row / 2 - GRIP.h / 2;
      const ok = free(gx, gy, GRIP.w, GRIP.h);
      put(grip, gx, gy, ok);
      if (ok) gb = { left: gx, top: gy, bottom: gy + GRIP.h };
      const name = h.k === 'line' ? t('ux6c.gripLine') : t('ux6c.gripGroup');
      if (ok){ grip.setAttribute('aria-label', name); grip.title = name; grip.dataset.k = h.k; grip.dataset.fact = h.fact; grip.dataset.job = h.job ?? ''; }
    } else grip.hidden = true;
    // the "+": just under the job's last line, or under the skill group it stands by
    let last = null, label = '';
    if (h && on() && (h.k === 'line' || h.k === 'group') && !locked(h.k === 'line' ? h.job : h.fact)){
      if (h.k === 'line'){ last = sheet.jobLines(h.job, x).at(-1); label = t('ux6c.plusLine', { job: C.jobName(h.job) }); }
      else { last = h; label = t('ux6c.plusGroup'); }      // a skill group is added after the one it stands by: each column has its own
    }
    if (last){
      const r = R(last.rect), px = R({ left: last.edge ?? last.rect.left, top: 0, width: 0, height: 0 }).left - OFF, py = Math.max(r.top + r.height + 2, gb && Math.abs(gb.left - px) < 1 ? gb.bottom + 2 : 0);
      const ok = free(px, py, PLUS.w, PLUS.h);
      put(plus, px, py, ok);
      if (ok){ plus.setAttribute('aria-label', label); plus.title = label; plus.dataset.k = h.k; plus.dataset.job = h.job ?? ''; plus.dataset.fact = h.fact; }
    } else plus.hidden = true;
    // the photo slot: beside the name when there is no photo printed, on the photo's corner when there is
    const hd = h?.k === 'header' && on() && !locked('photo') ? sheet.headerRects() : null;
    if (hd){
      const showing = !!C.cur().photo?.show;
      let sx, sy;
      if (hd.portrait){ const p = R(hd.portrait); sx = p.left + p.width - SLOT.w - 4; sy = p.top + 4; }
      else { const n = R(hd.name); sx = n.left + n.width + 12; sy = n.top + n.height / 2 - SLOT.h / 2; }
      const lb = t(showing ? 'ux6c.hideX' : 'ux6c.showX', { name: t('design.photoWord') });
      put(slot, sx, sy, free(sx, sy, SLOT.w, SLOT.h) || !!hd.portrait);
      slot.setAttribute('aria-label', lb); slot.title = lb; slot.firstChild.classList.toggle('on', showing);
    } else slot.hidden = true;
    // the grip of the selected job, section or item: on its dashed frame, at the top edge's left end
    const ft = on() && !ui.writing ? frameTarget() : null;
    placeFrameGrip(ft);
    // a hand that has just appeared fades in (off under reduced motion)
    const sig = `${!grip.hidden}${!plus.hidden}${!slot.hidden}${!fgrip.hidden}${h?.fact ?? h?.k ?? ''}${ft?.id ?? ''}`;
    if (sig !== shown){ shown = sig; for (const b of [grip, plus, slot, fgrip]) if (!b.hidden) play(b, [{ opacity: 0 }, { opacity: 1 }], { key: `hand:${b.className}`, ms: 'fast', name: 'hand:in' }); }
  }
  // ---- the grips of jobs, sections and items ----
  const rec = () => C.record();
  // what the selection is, if it can be moved by a grip on its frame: { k: 'job' | 'section' | 'item', id, sid }
  function frameTarget(){
    const s = ui.sel;
    let ft = null;
    if (s.kind === 'job' && T.jobRefs(rec(), C.cur()).some(r => (typeof r === 'string' ? r : r.id) === s.id)) ft = { k: 'job', id: s.id, sid: T.sectionOfEntry(rec(), s.id) };
    else if (s.kind === 'section' && !s.heading && T.sectionList(rec(), C.cur()).some(x => x.id === s.id && x.on && !x.fixed)) ft = { k: 'section', id: s.id };
    else if (s.kind === 'bullet' && !s.job && s.section !== 'skills' && s.section !== 'header'){ const id = s.id.replace(/^~t:/, ''), sid = T.sectionOfItem(rec(), id); if (sid && sid !== 'skills') ft = { k: 'item', id, sid }; }
    return ft && !locked(ft.id) ? ft : null;
  }
  function placeFrameGrip(ft){
    const f = ft && C.onpage().frame();
    if (!f){ fgrip.hidden = true; return; }
    const chip = document.querySelector('#editlay .obchip')?.getBoundingClientRect();
    const hitChip = (x, y) => !!chip && x < chip.right && x + GRIP.w > chip.left && y < chip.bottom && y + GRIP.h > chip.top;
    // centred on the top edge's left end; else just outside the frame's left edge; else just above the edge, or above the chip; else along the
    // edge, to the first place clear of text, the chip and the zoom bar
    const ys = [f.top - GRIP.h / 2, f.top - GRIP.h - 1, f.top - GRIP.h - 12], xs = [f.left - GRIP.w / 2, f.left - GRIP.w - 3];      // the last row clears the chip, which may stand over the left end of a frame half under the sidebar
    const along = Array.from({ length: Math.max(0, Math.floor((f.width - GRIP.w - 40) / 8)) }, (_, k) => xs[0] + 8 * (k + 1));
    const spots = [...ys.flatMap(y => xs.map(x => ({ x, y }))), ...ys.flatMap(y => along.map(x => ({ x, y })))];
    const at = spots.find(q => free(q.x, q.y, GRIP.w, GRIP.h) && !hitChip(q.x, q.y)) ?? null;
    put(fgrip, at?.x ?? 0, at?.y ?? 0, !!at);
    if (!at) return;
    const name = t(`ux6c.grip.${ft.k}`);
    fgrip.setAttribute('aria-label', name); fgrip.title = name; fgrip.dataset.k = ft.k; fgrip.dataset.fact = ft.id; fgrip.dataset.sid = ft.sid ?? '';
  }
  // the page was drawn again, or the selection changed: what the hands stood by is found again
  function refresh(){ if (!on()) { hover = null; drag = null; } place(); }

  // ---- hovering ----
  const grace = () => { clearTimeout(graceT); graceT = setTimeout(() => { if (!onHands && !drag){ hover = null; place(); } }, dur('fast')); };
  function pointer(e){
    if (!on()) return;
    if (e.type === 'leave'){ if (pend) pend = null; if (!drag) grace(); return; }
    const x = e.clientX, y = e.clientY;                              // the frame's own pixels
    if (e.type === 'pointerdown' && e.button === 0 && !e.target.closest?.('[contenteditable]')){
      const s = sheet.skillAt(ix(), x, y);
      pend = s ? { ...s, x, y, id: e.pointerId } : null;
      return;
    }
    if (e.type === 'pointerup' || e.type === 'pointercancel'){
      if (drag?.kind === 'skill') endDrag(e.type === 'pointerup' ? { x, y } : null);
      pend = null;
      return;
    }
    if (e.type !== 'pointermove') return;
    if (drag?.kind === 'skill'){ dragMove({ x, y }); return; }
    if (pend && (e.buttons & 1) && Math.hypot(x - pend.x, y - pend.y) > MOVE){
      if (locked(pend.fact)){ C.toast(t('ux6c.lockedTip'), 'warn'); pend = null; return; }      // a drag that starts on locked text is refused, with the reason
      startDrag('skill', { fact: pend.fact, k: pend.k });
      try { sheet.doc?.documentElement.setPointerCapture(pend.id); } catch { /* the drag still follows the pointer over the page */ }
      sheet.doc?.documentElement.classList.add('rb-dragging');
      pend = null;
      return;
    }
    if (drag) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const h = sheet.handAt(ix(), x, y);
      if (h){ clearTimeout(graceT); const same = hover && hover.k === h.k && hover.fact === h.fact; hover = h; if (!same) place(); }
      else if (hover) grace();
    });
  }
  for (const b of [grip, plus, slot, fgrip]){
    b.addEventListener('pointerenter', () => { onHands = true; clearTimeout(graceT); });
    b.addEventListener('pointerleave', () => { onHands = false; if (!drag) grace(); });
  }

  // ---- dragging ----
  function startDrag(kind, info){
    C.edit().leaveLine();
    drag = { kind, ok: false, to: null, moved: true, ...info };
    document.body.classList.add('is-dragging');
    place();
  }
  const box = rs => ({ left: Math.min(...rs.map(r => r.left)), top: Math.min(...rs.map(r => r.top)), right: Math.max(...rs.map(r => r.left + r.width)), bottom: Math.max(...rs.map(r => r.top + r.height)) });
  const within = (p, b, l = 70, r = 14, v = 30) => p.x >= b.left - l && p.x <= b.right + r && p.y >= b.top - v && p.y <= b.bottom + v;
  const showDrop = (r, vertical = false) => {
    dropEl.hidden = !r;
    if (r){ const s = R(r); Object.assign(dropEl.style, vertical ? { left: `${s.left - 1}px`, top: `${s.top}px`, width: '2px', height: `${s.height}px` } : { left: `${s.left}px`, top: `${s.top - 1}px`, width: `${s.width}px`, height: '2px' }); }
  };
  const refuse = (p, text) => { tip.hidden = !text; if (text){ tip.textContent = text; const c = canvas.cam; tip.style.left = `${Math.round(p.x * c.k + c.x + 14)}px`; tip.style.top = `${Math.round(p.y * c.k + c.y + 14)}px`; } };
  // where a drag at `p` (the page's pixels) would drop: sets drag.to / drag.ok, draws the drop line or the reason
  function dragTo(p){
    const x = ix(), d = drag;
    d.ok = false; d.to = null; showDrop(null); refuse(p, '');
    if (d.kind === 'line'){
      const ls = sheet.jobLines(d.job, x);
      if (!ls.length) return;
      if (!within(p, box(ls.map(l => l.rect)))){ refuse(p, t('ux6c.refusedLine')); return; }
      let at = ls.findIndex(l => p.y < l.rect.top + l.rect.height / 2); if (at < 0) at = ls.length;
      const from = ls.findIndex(l => l.fact === d.fact);
      d.ok = at !== from && at !== from + 1; d.to = ls[at]?.fact ?? null;
      if (d.ok){ const ref = ls[Math.min(at, ls.length - 1)].rect; showDrop({ left: ref.left, width: ref.width, top: at < ls.length ? ref.top - 2 : ref.top + ref.height + 2, height: 0 }); }
    } else if (d.kind === 'group'){
      const gs = sheet.skillGroups(x);
      if (!gs.length) return;
      if (!within(p, box(gs.map(g => g.rect)))){ refuse(p, t('ux6c.refusedGroup')); return; }
      const near = gs.map((g, i) => ({ g, i, c: { x: g.rect.left + g.rect.width / 2, y: g.rect.top + g.rect.height / 2 } })).sort((a, b) => Math.hypot(p.x - a.c.x, p.y - a.c.y) - Math.hypot(p.x - b.c.x, p.y - b.c.y))[0];
      const dx = p.x - near.c.x, dy = p.y - near.c.y, after = Math.abs(dy) < near.g.rect.height / 2 ? dx > 0 : dy > 0, at = near.i + (after ? 1 : 0);
      const from = gs.findIndex(g => g.fact === d.fact);
      d.ok = at !== from && at !== from + 1; d.to = gs[at]?.fact ?? null;
      if (d.ok){ const r = near.g.rect; showDrop({ left: r.left, width: r.width, top: after ? r.top + r.height + 3 : r.top - 3, height: 0 }); }
    } else if (d.kind === 'job' || d.kind === 'section' || d.kind === 'item'){
      // a block among its siblings: the parent's room is the band (or the pages), a drop outside it is refused
      const ids = d.kind === 'job' ? T.jobRefs(rec(), C.cur(), d.sid).map(r => (typeof r === 'string' ? r : r.id)).filter(id => rec().work.some(w => w.id === id && !w.archived))
        : d.kind === 'section' ? T.sectionList(rec(), C.cur()).filter(s => s.on && !s.fixed).map(s => s.id) : (T.itemList(rec(), C.cur(), d.sid) ?? []).filter(i => i.on).map(i => i.id);
      const rectOf = id => (d.kind === 'job' ? sheet.rectOfJob(id, x) : d.kind === 'section' ? sheet.rectOfBand(id) : sheet.rectOfItem(id, x));
      const sibs = ids.map(id => ({ id, rect: rectOf(id) })).filter(s => s.rect);
      const room = d.kind === 'section' ? sheet.pageBoxes() : [sheet.rectOfBand(d.kind === 'job' ? d.sid : d.sid)].filter(Boolean);
      if (!sibs.length || !room.length) return;
      if (!room.some(b => within(p, box([b]), 70, 14, 30))){ refuse(p, t(`ux6c.refused.${d.kind}`)); return; }
      const near = sibs.map((s, i) => ({ s, i, c: { x: s.rect.left + s.rect.width / 2, y: s.rect.top + s.rect.height / 2 } })).sort((a, b) => Math.hypot(p.x - a.c.x, p.y - a.c.y) - Math.hypot(p.x - b.c.x, p.y - b.c.y))[0];
      // items of a run (certificates, interests) share a line: along the line the side of the neighbour decides, else above or below it
      const dy = p.y - near.c.y, inline = d.kind === 'item' && Math.abs(dy) < near.s.rect.height / 2 && sibs.some((o, k) => k !== near.i && Math.abs(o.rect.top - near.s.rect.top) < 3);
      const after = inline ? p.x > near.c.x : dy > 0, at = near.i + (after ? 1 : 0), from = sibs.findIndex(s => s.id === d.fact);
      d.ok = at !== from && at !== from + 1; d.to = sibs[at]?.id ?? null;
      if (d.ok){ const r = near.s.rect; if (inline) showDrop({ left: after ? r.left + r.width + 2 : r.left - 2, top: r.top, width: 0, height: r.height }, true); else showDrop({ left: r.left, width: r.width, top: after ? r.top + r.height + 2 : r.top - 2, height: 0 }); }
    } else {
      const gs = sheet.skillGroups(x).filter(g => g.items.length || g.fact === d.fact);
      const g = gs.find(g => within(p, box([g.rect]), 8, 8, 6));
      if (!g){ refuse(p, t('ux6c.refusedSkill')); return; }
      let j = g.items.findIndex(r => p.y < r.top - 1 || (p.y <= r.top + r.height && p.x < r.left + r.width / 2)); if (j < 0) j = g.items.length;
      const same = g.fact === d.fact;
      d.ok = !same || (j !== d.k && j !== d.k + 1); d.to = { g: g.fact, j: same && j > d.k ? j - 1 : j };
      if (d.ok){ const ref = g.items[Math.min(j, g.items.length - 1)]; if (ref) showDrop({ left: j < g.items.length ? ref.left - 2 : ref.left + ref.width + 1, top: ref.top, width: 0, height: ref.height }, true); }
    }
  }
  function endDrag(p){
    const d = drag;
    drag = null; showDrop(null); refuse({ x: 0, y: 0 }, ''); document.body.classList.remove('is-dragging'); sheet.doc?.documentElement.classList.remove('rb-dragging');
    if (!d) return;
    if (p) dragEnded = performance.now();
    if (!p || !d.moved) { place(); return; }
    if (!d.ok && d.refused) C.toast(d.refused, 'warn');
    else if (d.ok){
      if (d.kind === 'line') C.edit().moveLine(d.fact, d.to);
      else if (d.kind === 'group') C.edit().moveGroup(d.fact, d.to);
      else if (d.kind === 'job') C.edit().moveJob(d.fact, d.to);
      else if (d.kind === 'section') C.edit().moveSectionTo(d.fact, d.to);
      else if (d.kind === 'item') C.edit().moveItemTo(d.sid, d.fact, d.to);
      else C.edit().moveSkill(d.fact, d.k, d.to.g, d.to.j);
    }
    place();
  }
  // the reason a drop is refused is shown while dragging and said again, as a note, if it is let go there
  const dragMove = p => { drag.moved = true; dragTo(p); drag.refused = tip.hidden ? '' : tip.textContent; };

  // a grip: a press that moves is a drag; a press that does not is a click. `mk` says what it holds, `click` what a click does, `stepBy` what ↑ ↓ do.
  function wire(el, mk, click, stepBy){
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const what = mk();
      if (!what) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      pend = null;
      drag = { ...what, start: { x: e.clientX, y: e.clientY }, ok: false, to: null, moved: false, id: e.pointerId, press: true };
    });
    el.addEventListener('pointermove', e => {
      if (!drag?.press) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) < MOVE) return;
      if (!drag.moved){ C.edit().leaveLine(); document.body.classList.add('is-dragging'); place(); }
      dragMove(pt(e));
    });
    el.addEventListener('pointerup', e => { if (drag?.press){ const moved = drag.moved; if (moved) endDrag(pt(e)); else drag = null; if (moved) e.preventDefault(); else place(); } });
    el.addEventListener('pointercancel', () => { if (drag?.press) endDrag(null); });
    el.addEventListener('click', e => { if (performance.now() - dragEnded < 250) return; e.preventDefault(); click(); });
    // the keyboard: ↑ ↓ on the grip move what it holds one place
    el.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault(); e.stopPropagation();
      stepBy(e.key === 'ArrowDown' ? 1 : -1);
      place();
    });
  }
  // a line or skill group writes on a click; a job, a section or an item only has its grip
  wire(grip, () => { const h = target(); return h && { kind: h.k, fact: h.fact, job: h.job, target: h }; }, () => openLine(grip.dataset.fact),
    dir => { if (grip.dataset.k === 'line') C.edit().stepBullet(grip.dataset.fact, dir); else C.edit().stepGroup(grip.dataset.fact, dir); });
  wire(fgrip, () => { const ft = frameTarget(); return ft && { kind: ft.k, fact: ft.id, sid: ft.sid }; }, () => {},
    dir => { const { k, fact } = fgrip.dataset; if (k === 'job') C.edit().stepJob(fact, dir); else if (k === 'section') C.edit().stepSection(fact, dir); else C.edit().stepItem(fact, dir); });
  function openLine(fact){ C.select(lineSel(ix(), fact)); C.edit().startEdit(); }
  // "+": a new empty line at the job's end, or a new skill group after this one, written at once
  plus.addEventListener('click', () => { if (plus.dataset.k === 'line') C.edit().addLine(plus.dataset.job); else C.edit().addGroup(plus.dataset.fact); });
  slot.addEventListener('click', () => C.togglePhoto());

  // the reason a locked block is not written: beside the page chip's padlock for a moment. False when the chip is not on the page.
  let hintT = 0;
  function hint(text){
    const a = document.querySelector('#editlay .obchip .dp-lock'), r = a?.getBoundingClientRect();
    if (!r || !r.width) return false;
    tip.textContent = text; tip.hidden = false; tip.classList.add('is-hint'); tip.style.left = '0px';      // measured at its own width
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    Object.assign(tip.style, { left: `${Math.round(Math.max(8, Math.min(r.right - w, innerWidth - w - 8)))}px`, top: `${Math.round(r.bottom + hgt + 10 > innerHeight - 60 ? r.top - hgt - 6 : r.bottom + 6)}px` });
    clearTimeout(hintT);
    hintT = setTimeout(() => { if (tip.classList.contains('is-hint')){ tip.hidden = true; tip.classList.remove('is-hint'); } }, 2800);
    return true;
  }
  return { pointer, place, refresh, hint, justDragged: () => performance.now() - dragEnded < 250 };
}
