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
import { dur, play, cancel } from './motion.js';

const $ = s => document.querySelector(s);
const GRIP = { w: 16, h: 16 }, PLUS = { w: 18, h: 18 }, SLOT = { w: 40, h: 24 }, OFF = 22, MOVE = 4;

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
  const shadeEl = document.createElement('div'), ghostEl = document.createElement('div');      // what a grip moves, shaded; the line a "+" would add, in its place
  shadeEl.className = 'obshade'; shadeEl.hidden = true; ghostEl.className = 'obghost'; ghostEl.hidden = true;
  shadeEl.setAttribute('aria-hidden', 'true'); ghostEl.setAttribute('aria-hidden', 'true');
  lay?.append(shadeEl, ghostEl, grip, plus, slot, fgrip, dropEl, tip);

  let hover = null;                 // under the pointer: { k: 'line' | 'group' | 'header', fact, rect, job }
  let drag = null, pend = null;     // a drag under way; a skill pressed on the page that may become one
  let graceT = 0, onHands = false, dragEnded = 0, spent = false, raf = 0, shown = '';

  const locked = id => !!id && C.edit().lockedId(id);
  const on = () => !!lay && !phone() && !ui.view && !ui.snap && !ui.preview && !ui.fitting && !document.body.classList.contains('is-quiet');
  const pt = e => { const c = canvas.cam; return { x: (e.clientX - c.x) / c.k, y: (e.clientY - c.y) / c.k }; };      // a window point, in the page's pixels
  const R = r => canvas.screenRect(r);

  // ---- what the hands are for: the hovered thing, else the selected one ----
  const reread = h => {
    if (!h) return null;
    if (h.k === 'header') { const r = sheet.headerRects(); return r ? { ...h, rect: r.band } : null; }
    if (h.k === 'job' || h.k === 'section') { const r = blockRect(h.k, h.fact); return r ? { ...h, rect: r } : null; }      // a heading's hover stands for its whole block
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
    const ft = on() && !ui.writing ? frameTarget(h) : null;
    placeFrameGrip(ft, h?.k === 'job' || h?.k === 'section' ? R(h.rect) : null);
    if (grip.hidden && fgrip.hidden) unshade();
    if (plus.hidden) hideGhost();
    // a hand that has just appeared fades in (off under reduced motion)
    const sig = `${!grip.hidden}${!plus.hidden}${!slot.hidden}${!fgrip.hidden}${h?.fact ?? h?.k ?? ''}${ft?.id ?? ''}`;
    if (sig !== shown){ shown = sig; for (const b of [grip, plus, slot, fgrip]) if (!b.hidden) play(b, [{ opacity: 0 }, { opacity: 1 }], { key: `hand:${b.className}`, ms: 'fast', name: 'hand:in' }); }
  }
  // ---- the grips of jobs, sections and items ----
  const rec = () => C.record();
  // what the selection is, if it can be moved by a grip on its frame: { k: 'job' | 'section' | 'item', id, sid }
  const blockRect = (k, id, sid) => (k === 'job' ? sheet.rectOfJob(id, ix()) : k === 'section' ? sheet.rectOfBand(id) : k === 'item' ? sheet.rectOfItem(id, ix()) : null);
  function frameTarget(h){
    const s = h?.k === 'job' || h?.k === 'section' ? { kind: h.k, id: h.fact } : ui.sel;      // the heading under the pointer, else the selection
    let ft = null;
    if (s.kind === 'job' && T.jobRefs(rec(), C.cur()).some(r => (typeof r === 'string' ? r : r.id) === s.id)) ft = { k: 'job', id: s.id, sid: T.sectionOfEntry(rec(), s.id) };
    else if (s.kind === 'section' && !s.heading && T.sectionList(rec(), C.cur()).some(x => x.id === s.id && x.on && !x.fixed)) ft = { k: 'section', id: s.id };
    else if (s.kind === 'bullet' && !s.job && s.section !== 'skills' && s.section !== 'header'){ const id = s.id.replace(/^~t:/, ''), sid = T.sectionOfItem(rec(), id); if (sid && sid !== 'skills') ft = { k: 'item', id, sid }; }
    return ft && !locked(ft.id) ? ft : null;
  }
  function placeFrameGrip(ft, hovered){
    const f = ft && (hovered ?? C.onpage().frame());
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

  // ---- what a grip moves, shaded; the line a "+" would add, in the place it will land ----
  function shade(b){
    const pr = b === fgrip ? blockRect(b.dataset.k, b.dataset.fact) : target()?.rect, r = pr && R(pr);
    shadeEl.hidden = !r;
    if (r) Object.assign(shadeEl.style, { left: `${r.left - 4}px`, top: `${r.top - 3}px`, width: `${r.width + 8}px`, height: `${r.height + 6}px` });
  }
  const unshade = () => { shadeEl.hidden = true; };
  for (const b of [grip, fgrip]){
    for (const ev of ['pointerenter', 'focus']) b.addEventListener(ev, () => { if (!drag) shade(b); });
    for (const ev of ['pointerleave', 'blur']) b.addEventListener(ev, unshade);
  }
  // a job's end ("line"), or the skill group it follows ("group"): one row, growing in (none under reduced motion, where it just shows)
  function showGhost(kind, id){
    if (!on() || drag) return;
    const x = ix(), last = kind === 'line' ? sheet.jobLines(id, x).at(-1)?.rect : sheet.skillGroups(x).find(g => g.fact === id)?.rect;
    if (!last) return;
    const r = R({ left: last.left, top: last.top + last.height + 2, width: last.width, height: Math.min(last.height, 16) });
    Object.assign(ghostEl.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    ghostEl.hidden = false;
    play(ghostEl, [{ height: '0px', opacity: 0 }, { height: `${r.height}px`, opacity: 1 }], { key: 'ghost', ms: 'fast', name: 'ghost:in' });
  }
  function hideGhost(){ cancel('ghost'); ghostEl.hidden = true; }
  const plusGhost = () => (plus.dataset.k === 'line' ? showGhost('line', plus.dataset.job) : showGhost('group', plus.dataset.fact));
  for (const ev of ['pointerenter', 'focus']) plus.addEventListener(ev, plusGhost);
  for (const ev of ['pointerleave', 'blur']) plus.addEventListener(ev, hideGhost);
  // the sidebar's "+ line here" adds at the same place
  const addBtn = e => e.target.closest?.('#body [data-act="ol-newline"]');
  for (const ev of ['mouseover', 'focusin']) document.addEventListener(ev, e => { const b = addBtn(e); if (b) showGhost('line', b.dataset.id); });
  for (const ev of ['mouseout', 'focusout']) document.addEventListener(ev, e => { const b = addBtn(e); if (b && !b.contains(e.relatedTarget)) hideGhost(); });
  document.addEventListener('click', e => { if (addBtn(e)) hideGhost(); }, true);

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
  // `s`: where the reason stands, in window pixels; else beside a point in the page's pixels
  const refuse = (p, text, s) => { tip.hidden = !text; if (text){ tip.textContent = text; const c = canvas.cam; tip.style.left = `${Math.round((s ? s.x : p.x * c.k + c.x) + 14)}px`; tip.style.top = `${Math.round((s ? s.y : p.y * c.k + c.y) + 14)}px`; } };
  // the block's siblings and the room they live in, measured once when a drag starts: the preview moves them by a transform, which would move the measure
  function sibsOf(d){
    const x = ix(), pick = r => (typeof r === 'string' ? r : r.id);
    let sibs, room, say = `ux6c.refused.${d.kind}`;
    if (d.kind === 'line'){ sibs = sheet.jobLines(d.job, x).map(l => ({ id: l.fact, rect: l.rect })); room = [box(sibs.map(q => q.rect))]; say = 'ux6c.refusedLine'; }
    else if (d.kind === 'group'){ sibs = sheet.skillGroups(x).map(g => ({ id: g.fact, rect: g.rect })); room = [box(sibs.map(q => q.rect))]; say = 'ux6c.refusedGroup'; }
    else {      // a block among its siblings: the parent's room is the band (or the pages), a drop outside it is refused
      const ids = d.kind === 'job' ? T.jobRefs(rec(), C.cur(), d.sid).map(pick).filter(id => rec().work.some(w => w.id === id && !w.archived))
        : d.kind === 'section' ? T.sectionList(rec(), C.cur()).filter(q => q.on && !q.fixed).map(q => q.id) : (T.itemList(rec(), C.cur(), d.sid) ?? []).filter(i => i.on).map(i => i.id);
      const rectOf = id => (d.kind === 'job' ? sheet.rectOfJob(id, x) : d.kind === 'section' ? sheet.rectOfBand(id) : sheet.rectOfItem(id, x));
      sibs = ids.map(id => ({ id, rect: rectOf(id) })).filter(q => q.rect);
      room = (d.kind === 'section' ? sheet.pageBoxes() : [sheet.rectOfBand(d.sid)].filter(Boolean)).map(b => box([b]));
    }
    if (!sibs.length) room = [];
    const pages = sheet.pageBoxes(), pageOf = r => pages.findIndex(b => r.left >= b.left - 1 && r.left < b.left + b.width);
    return { sibs, room, say, pg: sibs.map(q => pageOf(q.rect)),      // the page each is on: the gap opens, and closes, page by page
      inline: d.kind === 'item' && sibs.length > 1 && sibs.every(q => Math.abs(q.rect.top - sibs[0].rect.top) < 3), els: new Map(sibs.map(q => [q.id, sheet.blockEls(d.kind, q.id, x)])) };
  }
  // where a drag at `p` (the page's pixels) would drop: sets drag.to / drag.at / drag.ok, draws the drop line or the reason
  function dragTo(p){
    const x = ix(), d = drag;
    d.ok = false; d.to = null; d.at = null; d.near = null; showDrop(null); refuse(p, '');
    if (d.kind !== 'skill'){
      const S = d.S ??= sibsOf(d), { sibs } = S;
      if (!sibs.length || !S.room.length) return;
      if (!S.room.some(b => within(p, b))){ refuse(p, t(S.say)); return; }
      const from = sibs.findIndex(q => q.id === d.fact), n = sibs.length;
      let at, drop, nearI = null;
      if (d.kind === 'line'){
        at = sibs.findIndex(q => p.y < q.rect.top + q.rect.height / 2); if (at < 0) at = n;
        const ref = sibs[Math.min(at, n - 1)].rect;
        drop = [{ left: ref.left, width: ref.width, top: at < n ? ref.top - 2 : ref.top + ref.height + 2, height: 0 }]; nearI = Math.min(at, n - 1);
      } else {
        const near = sibs.map((q, i) => ({ q, i, c: { x: q.rect.left + q.rect.width / 2, y: q.rect.top + q.rect.height / 2 } })).sort((a, b) => Math.hypot(p.x - a.c.x, p.y - a.c.y) - Math.hypot(p.x - b.c.x, p.y - b.c.y))[0];
        const dx = p.x - near.c.x, dy = p.y - near.c.y, r = near.q.rect, level = Math.abs(dy) < r.height / 2;
        // items of a run (certificates, interests) share a line, as do skill groups in columns: along the line the side of the neighbour decides, else above or below it
        const inline = d.kind === 'item' && level && sibs.some((o, k) => k !== near.i && Math.abs(o.rect.top - r.top) < 3);
        const after = inline || (d.kind === 'group' && level) ? dx > 0 : dy > 0;
        at = near.i + (after ? 1 : 0); nearI = near.i;
        drop = inline ? [{ left: after ? r.left + r.width + 2 : r.left - 2, top: r.top, width: 0, height: r.height }, true] : [{ left: r.left, width: r.width, top: after ? r.top + r.height + 2 : r.top - 2, height: 0 }];
      }
      d.at = at; d.near = nearI; d.ok = at !== from && at !== from + 1; d.to = sibs[at]?.id ?? null;
      if (d.ok) showDrop(...drop);
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
  // The live preview of a block's move: the block is lifted and follows the pointer (`p`, from where it was pressed); with no pointer on the
  // page (a row of the sidebar) it stands in its new place. The siblings slide to open the gap there and close the one it left.
  function preview(d, p){
    const S = d.S;
    if (!S) return;
    const { sibs, pg } = S, n = sibs.length, from = sibs.findIndex(q => q.id === d.fact), at = d.ok ? d.at : from, moves = [];
    if (from >= 0){
      const ax = S.inline ? 'left' : 'top', sz = S.inline ? 'width' : 'height', key = S.inline ? 'dx' : 'dy', slot = {};
      const ref = sibs[d.ok ? Math.min(d.near ?? at, n - 1) : from], land = pg[sibs.indexOf(ref)];      // the sibling the block lands by, and its page
      const gap = sibs.map((q, i) => (pg[i + 1] === pg[i] ? sibs[i + 1].rect[ax] - q.rect[ax] - q.rect[sz] : null)).find(g => g != null) ?? 0;
      for (const g of new Set(pg)){
        const orig = sibs.filter((_, i) => pg[i] === g), list = orig.filter(q => q.id !== d.fact);
        if (g === land) list.splice(sibs.slice(0, at).filter((q, i) => pg[i] === g && q.id !== d.fact).length, 0, sibs[from]);
        const gaps = orig.slice(1).map((q, k) => q.rect[ax] - orig[k].rect[ax] - orig[k].rect[sz]);
        let pos = orig[0].rect[ax];
        list.forEach((q, k) => { slot[q.id] = pos - q.rect[ax]; pos += q.rect[sz] + (gaps[k] ?? gaps.at(-1) ?? gap); });
      }
      for (const q of sibs) if (q.id !== d.fact) moves.push({ els: S.els.get(q.id), [key]: slot[q.id] });
      if (!p) moves.push({ els: S.els.get(d.fact), dx: S.inline ? slot[d.fact] : ref.rect.left - sibs[from].rect.left, dy: S.inline ? 0 : slot[d.fact], lift: true });      // from a row: it stands in its new place
    }
    if (p && d.p0) moves.push({ els: S.els.get(d.fact), dx: p.x - d.p0.x, dy: p.y - d.p0.y, lift: true });
    sheet.nudge(moves);
  }
  // …and the same where the pointer is over a row of the sidebar (`rows`: the block's siblings there, in order): the place is found among the rows
  function rowTo(d, rows, e){
    d.ok = false; d.to = null; d.at = null; showDrop(null); refuse(null, '');
    const S = d.S ??= sibsOf(d), rs = rows.map(el => ({ id: rowId(el), r: el.getBoundingClientRect() })).filter(q => S.sibs.some(o => o.id === q.id));
    if (!rs.length) return;
    const b = box(rs.map(q => q.r));
    if (e.clientX < b.left - 24 || e.clientX > b.right + 24 || e.clientY < b.top - 30 || e.clientY > b.bottom + 30){ refuse(null, t(S.say), { x: e.clientX, y: e.clientY }); return; }
    const k = rs.filter(q => q.r.top + q.r.height / 2 < e.clientY).length, n = S.sibs.length, from = S.sibs.findIndex(q => q.id === d.fact);
    const at = k < rs.length ? S.sibs.findIndex(q => q.id === rs[k].id) : n;
    d.at = at; d.ok = at !== from && at !== from + 1; d.to = S.sibs[at]?.id ?? null;
    if (d.ok){ const ref = S.sibs[Math.min(at, n - 1)].rect; showDrop({ left: ref.left, width: ref.width, top: at < n ? ref.top - 2 : ref.top + ref.height + 2, height: 0 }); }
  }
  function endDrag(p){
    const d = drag;
    drag = null; showDrop(null); refuse({ x: 0, y: 0 }, ''); document.body.classList.remove('is-dragging'); sheet.doc?.documentElement.classList.remove('rb-dragging');
    sheet.doc?.removeEventListener('keydown', escDrag, true);
    sheet.unnudge(!(p && d?.ok));      // dropped: the page is drawn again from the model; else everything slides back
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
  // Esc during a drag: nothing is dropped, everything goes back, no undo step; the click that follows the release is not a click
  function escDrag(e){ if (e.key === 'Escape' && drag?.moved){ e.preventDefault(); e.stopPropagation(); spent = true; endDrag(null); } }
  window.addEventListener('keydown', escDrag, true);
  // the reason a drop is refused is shown while dragging and said again, as a note, if it is let go there
  const dragMove = p => { drag.moved = true; dragTo(p); drag.refused = tip.hidden ? '' : tip.textContent; preview(drag, p); };

  // ---- the sidebar's rows: grabbing a row drags its block (no handles), the page showing the same preview ----
  const rowId = el => el.dataset.bullet ?? el.dataset.item ?? el.dataset.job ?? el.dataset.sid;
  const ROW = '.clrow[data-bullet], .clrow[data-item], .clgh[data-job], .osec > .srow[data-sid]';
  const NOT_ROW = 'input, label, select, textarea, .rowlock, .clv';      // its switch, padlock and version count act on their own
  function rowOf(el){
    const q = (sel, root = $('#body')) => [...root.querySelectorAll(sel)], ref = CSS.escape;
    if (el.matches('.clrow[data-bullet]')) return { d: { kind: 'line', fact: el.dataset.bullet, job: el.dataset.bjob }, rows: q(`.clrow[data-bullet][data-bjob="${ref(el.dataset.bjob)}"]`) };
    if (el.matches('.clrow[data-item]')) return { d: { kind: 'item', fact: el.dataset.item, sid: el.dataset.sec }, rows: q(`.clrow[data-item][data-sec="${ref(el.dataset.sec)}"]`) };
    if (el.matches('.clgh[data-job]')) return { d: { kind: 'job', fact: el.dataset.job, sid: T.sectionOfEntry(rec(), el.dataset.job) }, rows: q('.clgh[data-job]', el.closest('.osec') ?? $('#body')) };
    if (el.matches('.srow:not(.fixed):not(.is-off)')) return { d: { kind: 'section', fact: el.dataset.sid }, rows: q('.osec > .srow[data-sid]:not(.fixed):not(.is-off)') };
    return null;
  }
  $('#body')?.addEventListener('pointerdown', e => {
    spent = false;
    const el = e.button === 0 && e.pointerType !== 'touch' && on() && !drag ? e.target.closest?.(ROW) : null;
    if (!el || e.target.closest(NOT_ROW) || el.classList.contains('is-locked') || locked(rowId(el))) return;
    const r = rowOf(el);
    if (!r || r.rows.length < 2) return;
    let began = false;      // a drag that was ended (Esc) is not started again by the next move
    const x0 = e.clientX, y0 = e.clientY, ctl = new AbortController(), off = () => ctl.abort();
    const opt = { signal: ctl.signal, capture: true };
    document.addEventListener('pointermove', m => {
      if (!drag){
        if (began) return off();
        if (Math.hypot(m.clientX - x0, m.clientY - y0) < MOVE) return;
        C.edit().leaveLine();
        drag = { ...r.d, ok: false, to: null, moved: true, rowEl: el }; began = true; document.body.classList.add('is-dragging');
        sheet.doc?.addEventListener('keydown', escDrag, true);
        place();
      } else if (drag.rowEl !== el) return off();
      rowTo(drag, r.rows, m); drag.refused = tip.hidden ? '' : tip.textContent; preview(drag, null);
    }, opt);
    document.addEventListener('pointerup', () => { off(); if (drag?.rowEl === el){ endDrag({}); spent = true; } }, opt);
    document.addEventListener('pointercancel', () => { off(); if (drag?.rowEl === el) endDrag(null); }, opt);
  });
  $('#body')?.addEventListener('click', e => { if (spent){ spent = false; e.stopPropagation(); e.preventDefault(); } }, true);      // the click that ends a row's drag, or follows an Esc, is not a click

  // a grip: a press that moves is a drag; a press that does not is a click. `mk` says what it holds, `click` what a click does, `stepBy` what ↑ ↓ do.
  function wire(el, mk, click, stepBy){
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      spent = false;
      const what = mk();
      if (!what) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      pend = null;
      drag = { ...what, start: { x: e.clientX, y: e.clientY }, p0: pt(e), ok: false, to: null, moved: false, id: e.pointerId, press: true };
    });
    el.addEventListener('pointermove', e => {
      if (!drag?.press) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) < MOVE) return;
      if (!drag.moved){ C.edit().leaveLine(); document.body.classList.add('is-dragging'); sheet.doc?.addEventListener('keydown', escDrag, true); unshade(); place(); }
      dragMove(pt(e));
    });
    el.addEventListener('pointerup', e => { if (drag?.press){ const moved = drag.moved; if (moved) endDrag(pt(e)); else drag = null; if (moved) e.preventDefault(); else place(); } });
    el.addEventListener('pointercancel', () => { if (drag?.press) endDrag(null); });
    el.addEventListener('click', e => { if (performance.now() - dragEnded < 250 || spent) return; e.preventDefault(); click(); });
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
  wire(fgrip, () => { const ft = frameTarget(target()); return ft && { kind: ft.k, fact: ft.id, sid: ft.sid }; }, () => {},
    dir => { const { k, fact } = fgrip.dataset; if (k === 'job') C.edit().stepJob(fact, dir); else if (k === 'section') C.edit().stepSection(fact, dir); else C.edit().stepItem(fact, dir); });
  function openLine(fact){ C.select(lineSel(ix(), fact)); C.edit().startEdit(); }
  // "+": a new empty line at the job's end, or a new skill group after this one, written at once
  plus.addEventListener('click', () => { hideGhost(); if (plus.dataset.k === 'line') C.edit().addLine(plus.dataset.job); else C.edit().addGroup(plus.dataset.fact); });
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
