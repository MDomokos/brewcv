// The hands over the page (UX-6c-ii): on the block under the pointer (or selected), a grip to move it, a "+" to add after it, and the photo
// slot by the name. The grip and the "+" are the tabs of the block's plate (src/ui/plate.js, `--plate-*`): flush with its edge, the same ink.
// Drawn in the app's layer (#handlay) over the page, in screen pixels, from the rectangles the sheet reports in the page's own pixels; nothing
// here is in an export. The block under the pointer also has its hover plate (`sheet.setHot`): one block at a time, the deepest text under it.
// The pointer is read for intent (UX-6f 1b, plate.js HOVER_*): what it passes does not hover, what it settles on does.
//   - A line moves only within its job, a skill group within Skills, a skill to a place in any group. A drop anywhere else is refused, and
//     nothing changes: the block meets the bumper (it follows the pointer at a third of the distance past the edge of its places, squashed a little, with the
//     shaded places only, no rail or edge, direct editing C), and over another container's places only a faint bar shows. No text says so. The sidebar's ↑ ↓ and chips are the keyboard route; the grip itself takes ↑ ↓ too.
//   - The grip and the "+" stay reachable on the way to them: a line owns the margin left of its text and the gap below it (the
//     sheet's handAt), and leaving the page waits a moment (motion.js `fast`) before they go, unless the pointer is on them.
//   - A job, a section and an item (UX-6c-iii-b) have a grip on the plate of the selected block (or of the heading under the pointer): its left
//     tab, at the top. Its plate's edge is a handle too (`onPlate`). It moves the block within its parent (jobs within their section, sections within the page, items within their section); a drop
//     elsewhere is refused the same way. A locked block has no grip (the padlock stands at its corner), no "+" and no skill drag.
//   - A drag shows a shaded drop bar and the socket's wash. Off under reduced motion: the grip's fade only, the squash and the overshoot; the drop bar
//     is feedback, not motion.

import * as T from '../model/resume.js';
import { lineSel } from './select.js';
import { icon } from './icons.js';
import { pillHtml } from './parts.js';
import { t } from '../i18n/index.js';
import { PHONE_MAX } from './layout.js';
import { dur, play, cancel, reduced } from './motion.js';
import { off, HOVER_SPEED, HOVER_WINDOW, HOVER_DWELL, HOVER_IN, GLIDE, GLIDE_KEEP, FEEL } from './plate.js';

const $ = s => document.querySelector(s);
const PLUS = { w: 24, h: 14 }, SLOT = { w: 40, h: 24 }, MOVE = 4, HOLD = 5, TAB_HOLD = 20, RIM = 8;      // TAB_HOLD: the grip's tab left of a line (its width and the stand-off), page px      // PLUS: the plate's bottom tab (width, height; the target is 4 px wider all round; the grip's is its plate's tab, sheet.tabBox); HOLD: how far from a block a press still takes it

export function initHands(C){
  const { ui, sheet, canvas } = C;
  const lay = $('#handlay');
  const ix = () => C.ix();
  const phone = () => innerWidth < PHONE_MAX;
  const btn = (cls, icn) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.hidden = true; b.innerHTML = icon(icn, { role: 'inline' }); return b; };
  const tert = b => { b.classList.add('press'); b.dataset.tier = 'tertiary'; return b; };      // the grip and the "+" are tertiary: no lift, a subtle press, a soft tint
  const grip = tert(btn('obgrip', 'grip')), plus = tert(btn('obplus', 'add')), slot = btn('obslot', 'photo'), fgrip = tert(btn('obgrip obfgrip', 'grip'));
  const dropEl = document.createElement('div'), tip = document.createElement('div');
  dropEl.className = 'obdrop'; dropEl.hidden = true;
  tip.className = 'obtip'; tip.hidden = true; tip.setAttribute('role', 'status');
  slot.innerHTML = pillHtml(false, 'photo');      // the photo's show/hide is the pill, as on the chip
  const ghostEl = document.createElement('div');      // the line a "+" would add, in its place
  ghostEl.className = 'obghost'; ghostEl.hidden = true; ghostEl.setAttribute('aria-hidden', 'true');
  lay?.append(ghostEl, grip, plus, slot, fgrip, dropEl, tip);

  let hover = null;                 // under the pointer: { k: 'line' | 'group' | 'job' | 'section' | 'header', fact, rect, job }
  let only = null;                  // the text under the pointer that has no hands (a summary, a title, a heading), or the deepest one in the header: its plate alone
  let drag = null, pend = null;     // a drag under way; a skill pressed on the page that may become one
  let bridge = null;                // the corridor under the block, from its last row to the "+": the pointer crossing it keeps the block it is on (page pixels)
  let graceT = 0, onHands = false, dragEnded = 0, spent = false, raf = 0;
  const shown = new Set();          // the hands drawn at the last place(): only one that was not fades in
  const trail = [];                 // the pointer over the page, newest last: { t, x, y } in screen px
  let hp = null, fastAt = -1e9, settleT = 0;      // where it is (null: off the page); when it was last fast; the timer that finds the block it has stopped on
  let gateOn = true;                // a test hook turns the speed gate off for the checks that are not about it (the smoke's open(), as for the lock guard)

  const locked = id => !!id && C.edit().lockedId(id);
  const on = () => !!lay && !phone() && !ui.view && !ui.snap && !ui.preview && !ui.fitting && !document.body.classList.contains('is-quiet');
  const pt = e => { const c = canvas.cam; return { x: (e.clientX - c.x) / c.k, y: (e.clientY - c.y) / c.k }; };      // a window point, in the page's pixels
  const R = r => canvas.screenRect(r);

  // ---- what the hands are for: the hovered thing, else the selected one ----
  const reread = h => {
    if (!h) return null;
    if (h.k === 'header') { const r = sheet.headerRects(); return r ? { ...h, rect: r.band } : null; }
    if (h.k === 'job' || h.k === 'section') { const r = blockRect(h.k, h.fact); return r ? { ...h, rect: r } : null; }      // a heading's hover stands for its whole block
    const el = h.k === 'group' ? sheet.plateOf(h, ix()) : sheet.elOf(h.fact, ix());      // a skill group's plate is the whole group, its name and its skills
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
  function free(x, y, w, h, bare = true){
    const v = canvas.view ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
    if (x < v.left + 2 || x + w > v.left + v.width - 2 || y < v.top + 2 || y + h > v.top + v.height - 56) return false;
    return !bare || !sheet.textRects().some(q => { const s = R(q); return x < s.left + s.width && x + w > s.left && y < s.top + s.height && y + h > s.top; });
  }
  const put = (el, x, y, ok) => { el.hidden = !ok; if (ok) { el.style.left = `${Math.round(x)}px`; el.style.top = `${Math.round(y)}px`; } };
  // The hands glide with the plate they stand on (UX-6f 4c): a grip or "+" that was shown (or let go less than GLIDE_KEEP ms ago) and stands somewhere else now, under the same
  // camera, travels there in --plate-glide, as the plate does; one the camera moved is put there at once (the page moved, not the hand). None under reduced motion.
  const camSig = () => { const c = canvas.cam; return `${c.x.toFixed(1)}|${c.y.toFixed(1)}|${c.k.toFixed(4)}`; };
  const was = new Map(), under = new Map();      // each hand where it was last seen: { r, t, cam }; under: the camera it was last placed under
  function place(){
    const cam = camSig(), now = performance.now();
    for (const b of [grip, plus, fgrip]) if (!b.hidden) was.set(b, { r: b.getBoundingClientRect(), t: now, cam: under.get(b) ?? cam });      // (the camera it stood under, not this one: else a pan looked like a hover move and the hand glided after the page)
    placeNow();
    for (const b of [grip, plus, fgrip]) under.set(b, cam);
    for (const [i, b] of [grip, plus, fgrip].entries()){
      const w = was.get(b);
      if (w && w.cam !== cam) cancel(`glide:${i}`);      // the camera moved: the hand is where the page put it
      if (b.hidden || !w || w.cam !== cam || now - w.t > GLIDE_KEEP || b !== plus) continue;      // (a grip is a clear button over its plate's tab, and the plate glides itself: the button is where it goes at once, under a quick press)
      cancel(`glide:${i}`);
      const r = b.getBoundingClientRect(), dx = w.r.left - r.left, dy = w.r.top - r.top;
      if (Math.abs(dx) < .5 && Math.abs(dy) < .5 && Math.abs(w.r.height - r.height) < .5) continue;
      play(b, [{ translate: `${dx}px ${dy}px`, height: `${w.r.height}px` }, { translate: '0px 0px', height: `${r.height}px` }], { key: `glide:${i}`, ms: GLIDE(), kind: 'arrive', name: 'hand:glide' });
    }
  }
  function placeNow(){
    if (!lay) return;
    if (drag){ plus.hidden = slot.hidden = true; if (!drag.press) grip.hidden = fgrip.hidden = true; if (!drag.press) sheet.setTab([]); sheet.setHot(null); return; }      // the handle being dragged stays where it is
    if (ui.writing) hover = only = null;      // a line is written: nothing is hovered, and nothing is after it until the pointer moves
    const h = on() ? target() : null;
    sheet.setHot(on() ? hotEl() : null);
    const x = ix();
    // the grip (item 4): the 2x3 dots in a tab of the plate itself (sheet.setTab: the plate widens into it), shown when the pointer nears the plate's left side, on the grip
    // itself, with the grip in focus, or for the selection (and so on touch, which has no hover); while the line is written its dots dim (the plate's .is-write). The grip
    // here is a clear button over the tab: the target, the focus and the label.
    const gel = h && (h.k === 'line' || h.k === 'group') && !h.selOnly && on() && !locked(h.fact) && near(h) ? sheet.plateOf(h, ix()) : null;
    // the "+": just under the job's last line, or under the skill group it stands by
    let last = null, label = '';
    if (h && on() && (h.k === 'line' || h.k === 'group') && !locked(h.k === 'line' ? h.job : h.fact)){
      if (h.k === 'line'){ last = sheet.jobLines(h.job, x).at(-1); label = t('ux6c.plusLine', { job: C.jobName(h.job) }); }
      else { const g = sheet.skillGroups(x).find(q => q.fact === h.fact); last = g ?? h; label = t('ux6c.plusGroup'); }      // a skill group is added after the one it stands by: each column has its own (its whole box, not the skills' alone)
    }
    bridge = null;
    if (last){
      // the "+" stands at the bottom and centre of the block (the job, or the skill group), a little under its last row, so it is not taken for a grip; where printed text
      // is in the way it moves along the edge to the nearest clear place, else it stays centred
      // it hangs from where the plate it joins ends: the last line's (or the group's), or the selected job's; under any other line it stands there by itself (.is-free)
      const alone = h.k === 'line' && !h.selOnly && h.fact !== last.fact, lv = h.selOnly ? 'job' : h.k;
      const pel = h.selOnly ? sheet.jobEl(h.job, x) : sheet.plateOf({ k: h.k, fact: last.fact }, x), po = pel ? sheet.standOff(pel).y : off(lv);      // the plate it hangs from, as it is drawn
      const rb = h.selOnly ? R(blockRect('job', h.job) ?? last.rect) : R(last.rect), r = R(last.rect), py = rb.top + rb.height + po * canvas.cam.k, cx = r.left + r.width / 2 - PLUS.w / 2;
      plus.classList.toggle('is-free', alone); plus.classList.toggle('is-sel', !alone && ui.sel.id === last.fact);      // (the selected wash under a selected line)
      const at = [0, 24, -24, 48, -48, 80, -80].map(dx => cx + dx).find(x => free(x, py, PLUS.w, PLUS.h)) ?? cx, ok = free(at, py, PLUS.w, PLUS.h, false);
      put(plus, at, py, ok);
      if (ok){
        plus.setAttribute('aria-label', label); plus.title = label; plus.dataset.k = h.k; plus.dataset.job = h.job ?? ''; plus.dataset.fact = h.fact;
        const c = canvas.cam;      // a corridor from the block's last row to the "+" (not the whole strip: the next block's heading may be a few px below)
        bridge = { x: (at - 12 - c.x) / c.k, x2: (at + PLUS.w + 12 - c.x) / c.k, y: (r.top + r.height - 3 - c.y) / c.k, y2: (py + PLUS.h + 8 - c.y) / c.k };
      }
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
    // the grip of the selected job, section or item, or of the heading under the pointer: the same tab, on its plate
    const ft = on() && !ui.writing ? frameTarget(h) : null, fel = ft && near(h?.k === ft.k && h.fact === ft.id ? h : { k: ft.k, fact: ft.id }) ? (ft.k === 'item' ? sheet.plates().find(p => p.role === 'sel')?.el : sheet.plateOf({ k: ft.k, fact: ft.id }, ix())) ?? null : null;      // (an item's plate is its selected text's)
    sheet.setTab([gel, fel]); tabNear = !!h && near(h);
    putTab(grip, gel, h); putTab(fgrip, fel, ft && { k: ft.k, fact: ft.id, sid: ft.sid, job: '' });
    if (plus.hidden) hideGhost();
    // a hand that has just appeared fades in (off under reduced motion); one that was already there stays (the "+" changes its shape in place, UX-6f 4c)
    for (const b of [grip, plus, slot, fgrip]){ if (!b.hidden && !shown.has(b)) play(b, [{ opacity: 0 }, { opacity: 1 }], { key: `hand:${b.className}`, ms: HOVER_IN, name: 'hand:in' }); b.hidden ? shown.delete(b) : shown.add(b); }
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
  // a block's plate in screen pixels: its block's rectangle (the page's pixels) grown by the level's stand-off, fitted as the plate is (sheet.fitOff)
  // the grip's button over the tab of a block's plate (sheet.tabBox), named for what it holds
  function putTab(b, el, h){
    const tb = el && h && sheet.tabBox(el), s = tb && R(tb);
    put(b, s?.left ?? 0, s?.top ?? 0, !!s);
    if (!s) return;
    b.style.width = `${s.width}px`; b.style.height = `${s.height}px`;
    b.classList.toggle('is-sel', b === grip ? ui.sel.id === h.fact && (h.k === 'group' || ui.sel.kind === 'bullet') : ui.sel.kind === h.k && ui.sel.id === h.fact);
    const name = b === grip ? t(h.k === 'line' ? 'ux6c.gripLine' : 'ux6c.gripGroup') : t(`ux6c.grip.${h.k}`);
    b.setAttribute('aria-label', name); b.title = name; b.dataset.k = h.k; b.dataset.fact = h.fact; b.dataset.job = h.job ?? ''; b.dataset.sid = h.sid ?? '';
  }
  // the dots show when the pointer nears the plate's left side (NEAR page px in from the block's edge, or anywhere left of it, beside the block), is on a grip, or a grip
  // has the focus; on the selection when nothing is hovered (so its grip stays in the focus order; on touch, which has no hover, too) and on a written line (dimmed)
  const NEAR = 32;
  let tabNear = false, touch = false;
  function near(h){
    if (!hover || touch || onHands || [grip, fgrip].includes(document.activeElement) || drag?.press || (ui.writing && C.writingFact() === h.fact)) return true;
    const r = h.k === 'line' || h.k === 'group' ? h.rect : blockRect(h.k, h.fact);
    // a section's label is its tab column: anywhere on it counts as near (a look whose label sits right in the gutter, Quiet tabs)
    const reach = h.k === 'section' && h.rect ? Math.max(r?.left + NEAR, h.rect.left + h.rect.width) : r?.left + NEAR;
    return !!hp && !!r && hp.x <= reach && hp.y >= r.top - 20 && hp.y <= r.top + r.height + 20;
  }
  // the page was drawn again, or the selection changed: what the hands stood by is found again
  function refresh(){ if (!on()) { hover = null; drag = null; } place(); }
  // the page was drawn again: none of the preview's transforms are in it (a block that landed on its place was an element of the old page)
  function drawn(){ if (!drag) sheet.unnudge(false); refresh(); }

  // The selected job, section or item has its plate's edge as a handle all round: a press on the plate or just outside it (6 px), outside its block, that moves 4 px lifts it (as the grip does)
  function onPlate(x, y){
    const ft = on() && !ui.writing ? frameTarget(null) : null, r = ft && blockRect(ft.k, ft.id);
    if (!r) return null;
    const o = off(ft.k === 'section' ? 'section' : ft.k === 'job' ? 'job' : 'group') + 6, inside = x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
    return !inside && x >= r.left - o && x <= r.left + r.width + o && y >= r.top - o && y <= r.top + r.height + o ? ft : null;
  }
  // ---- hovering ----
  const grace = () => { clearTimeout(graceT); graceT = setTimeout(() => { if (!onHands && !drag){ hover = null; place(); } }, dur('fast')); };
  function pointer(e){
    if (!on()) return;
    if (e.type === 'leave'){      // off the page: a pending hover is cancelled at once, and the plate fades out (unless the pointer is only on its way to a tab: that is a pointerenter in the same breath)
      pend = null; hp = null; trail.length = 0; clearTimeout(settleT); cancelAnimationFrame(raf);
      if (!drag) setTimeout(() => { if (!onHands && !drag){ clearTimeout(graceT); hover = only = null; place(); } });
      return;
    }
    const x = e.clientX, y = e.clientY;                              // the frame's own pixels
    // A press on a skill, or on a line, group, job heading or section heading (or within HOLD px of it, on its outline), that moves 4 px is a drag;
    // one that does not is the click it was. A line being written takes its own presses.
    if (e.type === 'pointerdown') touch = e.pointerType === 'touch';
    if (e.type === 'pointerdown' && e.button === 0 && !e.defaultPrevented && !e.target.closest?.('[contenteditable]')){
      const s = sheet.skillAt(ix(), x, y), h = s || e.pointerType === 'touch' ? null : sheet.handAt(ix(), x, y);
      const tab = h && (h.k === 'line' || h.k === 'group') && x < h.rect.left && x >= h.rect.left - TAB_HOLD && y >= h.rect.top && y <= h.rect.top + h.rect.height;      // where its plate's tab (the dots) is, shown yet or not
      const mine = h && (h.d <= HOLD || tab) && h.k !== 'header' && !(ui.writing && C.writingFact() === h.fact);
      const edge = !s && !mine && e.pointerType !== 'touch' ? onPlate(x, y) : null;
      pend = s ? { ...s, kind: 'skill', x, y, id: e.pointerId } : mine ? { ...h, kind: h.k, x, y, id: e.pointerId } : edge ? { kind: edge.k, fact: edge.id, sid: edge.sid, x, y, id: e.pointerId } : null;
      if (e.pointerType !== 'touch'){ hp = { x, y }; fastAt = -1e9; trail.length = 0; clearTimeout(settleT); cancelAnimationFrame(raf); resolve(x, y, false); }      // a press is intent: the plate at once, with no speed test
      return;
    }
    if (e.type === 'pointerup' || e.type === 'pointercancel'){
      if (drag?.page) endDrag(e.type === 'pointerup' ? { x, y } : null);
      pend = null;
      return;
    }
    if (e.type !== 'pointermove') return;
    if (drag?.page){ dragMove({ x, y }); return; }
    if (pend && (e.buttons & 1) && Math.hypot(x - pend.x, y - pend.y) * canvas.cam.k > MOVE){      // 4 screen px: the frame's own pixels are the page's
      const ft = pend.kind === 'job' || pend.kind === 'section' ? frameTarget({ k: pend.kind, fact: pend.fact }) : null;
      if (locked(pend.fact)){ C.toast(t('uxr.locked'), 'warn'); pend = null; return; }      // a drag that starts on locked text is refused, with the reason
      if ((pend.kind === 'job' || pend.kind === 'section') && !ft){ pend = null; return; }      // a section that cannot be moved (the header, the summary)
      startDrag(pend.kind, { fact: pend.fact, k: pend.kind === 'skill' ? pend.k : undefined, job: pend.job, sid: ft?.sid ?? pend.sid, page: true, p0: { x: pend.x, y: pend.y } });
      try { sheet.doc?.documentElement.setPointerCapture(pend.id); } catch { /* the drag still follows the pointer over the page */ }
      sheet.doc?.documentElement.classList.add('rb-dragging');
      pend = null;
      return;
    }
    if (drag) return;
    if (bridge && x >= bridge.x && x <= bridge.x2 && y >= bridge.y && y <= bridge.y2){ clearTimeout(graceT); return; }      // on the way to the "+": it stays
    if (e.pointerType === 'touch') return;      // touch has no hover
    // Hover is intent (UX-6f 1b): above HOVER_SPEED nothing starts, and what the pointer has left goes; once it is slow for HOVER_DWELL ms (it stops, or it was slow all along: no wait) the block under it takes the plate
    const first = gateOn && !hp, v = gateOn ? pace(x, y) : 0, now = performance.now();      // the first move on the page has no pace yet (it may have come in fast from the desk): it waits for the next, or for the pointer to stop
    hp = { x, y }; clearTimeout(settleT); cancelAnimationFrame(raf);
    if (v > HOVER_SPEED) fastAt = now;
    const wait = fastAt + HOVER_DWELL - now;
    if (wait > 0 || first) settleT = setTimeout(arrive, first && wait <= 0 ? HOVER_DWELL : v > HOVER_SPEED ? HOVER_DWELL : wait);
    raf = requestAnimationFrame(() => resolve(x, y, wait > 0 || first));
  }
  // The block under the pointer takes the hover (`gated`: the pointer is too fast for that, so only what it has left is let go). The deepest text under it has the plate; the
  // hands (the grip, the "+") belong to a line, group, job or section it is on or beside.
  function resolve(x, y, gated){
    if (ui.writing || !on()) return;
    const el = sheet.plateAt(x, y), h0 = sheet.handAt(ix(), x, y), h = h0 && (h0.d === 0 || !el) ? h0 : null, prev = only, same = h && hover && hover.k === h.k && hover.fact === h.fact;
    if (gated){      // nothing starts: what is no longer under the pointer goes, at once
      if (hover && !same && !onHands){ hover = null; only = null; place(); } else if (!hover && only && only !== (!h || h.k === 'header' ? el : null)){ only = null; place(); }
      return;
    }
    only = !h || h.k === 'header' ? el : null;
    if (h){ clearTimeout(graceT); hover = h; if (!same || only !== prev || near(h) !== tabNear) place(); }      // (and as it nears the left side, where the dots show)
    else { if (hover) grace(); if (only !== prev) place(); }
  }
  // the pointer has stopped (or has been slow long enough): the block it is on takes the hover
  function arrive(){ if (!hp || drag || pend) return; trail.length = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => hp && resolve(hp.x, hp.y, false)); }
  // the pointer's pace in screen px/s over the last HOVER_WINDOW ms (a single sample has none: the first move after a rest is slow)
  function pace(x, y){
    const now = performance.now(), k = canvas.cam.k;
    trail.push({ t: now, x: x * k, y: y * k });
    while (trail.length > 1 && now - trail[0].t > HOVER_WINDOW) trail.shift();
    const a = trail[0], b = trail.at(-1);
    return Math.hypot(b.x - a.x, b.y - a.y) / Math.max(b.t - a.t, 16) * 1000;
  }
  for (const b of [grip, plus, slot, fgrip]){
    b.addEventListener('pointerenter', () => { onHands = true; clearTimeout(graceT); });
    if (b === grip || b === fgrip) for (const [ev, v] of [['pointerenter', true], ['pointerleave', false]]) b.addEventListener(ev, () => sheet.setTab(null, v));      // the dots full under the pointer, a written line's too
    b.addEventListener('pointerleave', () => { onHands = false; if (!drag) grace(); });
  }
  // the block whose plate is drawn as hovered: the hands' block (a tab in focus counts), else the text under the pointer
  function hotEl(){
    const b = [grip, fgrip].find(q => !q.hidden && q === document.activeElement), h = b ? { k: b.dataset.k, fact: b.dataset.fact } : reread(hover);
    return (h && h.k !== 'header' ? sheet.plateOf(h, ix()) : null) ?? only;
  }
  for (const b of [grip, fgrip]) for (const ev of ['focus', 'blur']) b.addEventListener(ev, () => { if (!drag) place(); });

  // ---- the line a "+" would add, in the place it will land ----
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
    sheet.endLand(); C.edit().leaveLine(); hideGhost();
    drag = { kind, ok: false, to: null, moved: true, ...info };
    document.body.classList.add('is-dragging'); sheet.doc?.addEventListener('keydown', escDrag, true);
    place();
  }
  const box = rs => ({ left: Math.min(...rs.map(r => r.left)), top: Math.min(...rs.map(r => r.top)), right: Math.max(...rs.map(r => r.left + r.width)), bottom: Math.max(...rs.map(r => r.top + r.height)) });
  const textNear = p => sheet.textRects().find(r => p.x >= r.left - RIM && p.x <= r.left + r.width + RIM && p.y >= r.top - RIM && p.y <= r.top + r.height + RIM);
  const within = (p, b, l = 70, r = 14, v = 30) => p.x >= b.left - l && p.x <= b.right + r && p.y >= b.top - v && p.y <= b.bottom + v;
  // `faint`: not where it will drop but another place the pointer is nearing (nothing drops there); `screen`: `r` is in window pixels (a row of the sidebar). Over the page the
  // drop bar is the frame's (sheet.guide), drawn under the lifted block, which is the topmost thing on the page (UX-6f 4c); over the sidebar they are the app's.
  const showDrop = (r, vertical = false, faint = false, screen = false) => {
    dropEl.hidden = !(r && screen); dropEl.classList.toggle('is-faint', !!faint);
    sheet.guide('drop', r && !screen ? (vertical ? { left: r.left - 2, top: r.top, width: 4, height: r.height } : { left: r.left, top: r.top - 2, width: r.width, height: 4 }) : null, { faint });      // (a soft shaded bar, 4 px)
    if (r && screen) Object.assign(dropEl.style, vertical ? { left: `${r.left - 2}px`, top: `${r.top}px`, width: '4px', height: `${r.height}px` } : { left: `${r.left}px`, top: `${r.top - 2}px`, width: `${r.width}px`, height: '4px' });
  };
  // the block's siblings and the room they live in, measured once when a drag starts: the preview moves them by a transform, which would move the measure
  function sibsOf(d){
    const x = ix(), pick = r => (typeof r === 'string' ? r : r.id);
    let sibs, room;
    if (d.kind === 'line'){ sibs = sheet.jobLines(d.job, x).map(l => ({ id: l.fact, rect: l.rect })); room = [box(sibs.map(q => q.rect))]; }
    else if (d.kind === 'group'){ sibs = sheet.skillGroups(x).map(g => ({ id: g.fact, rect: g.rect })); room = [box(sibs.map(q => q.rect))]; }
    else {      // a block among its siblings: the parent's room is the band (or the pages), a drop outside it is refused
      const ids = d.kind === 'job' ? T.jobRefs(rec(), C.cur(), d.sid).map(pick).filter(id => rec().work.some(w => w.id === id && !w.archived))
        : d.kind === 'section' ? T.sectionList(rec(), C.cur()).filter(q => q.on && !q.fixed).map(q => q.id) : (T.itemList(rec(), C.cur(), d.sid) ?? []).filter(i => i.on).map(i => i.id);
      const rectOf = id => (d.kind === 'job' ? sheet.rectOfJob(id, x) : d.kind === 'section' ? sheet.rectOfBand(id) : sheet.rectOfItem(id, x));
      sibs = ids.map(id => ({ id, rect: rectOf(id) })).filter(q => q.rect);
      room = (d.kind === 'section' ? sheet.pageBoxes() : sheet.rectsOfBand(d.sid)).map(b => box([b]));      // a section that runs over two pages has a band on each
    }
    if (!sibs.length) room = [];
    const pages = sheet.pageBoxes(), pageOf = r => pages.findIndex(b => r.left >= b.left - 1 && r.left < b.left + b.width);
    return { sibs, room, box: sibs.length ? box(sibs.map(q => q.rect)) : null, own: d.kind === 'line' ? sheet.rectOfJob(d.job, x) : null,      // box: the first place to the last, which the lifted block never leaves; own: the job a line's heading is part of
      pg: sibs.map(q => pageOf(q.rect)),      // the page each is on: the gap opens, and closes, page by page
      inline: d.kind === 'item' && sibs.length > 1 && sibs.every(q => Math.abs(q.rect.top - sibs[0].rect.top) < 3), els: new Map(sibs.map(q => [q.id, sheet.blockEls(d.kind, q.id, x)])) };
  }
  // A block taller than FEEL.FOLD of its page (a section such as Experience) does not follow the pointer as it is: it folds to its heading in place and a card (its heading and a
  // line count) is carried instead, so the other blocks stay in view. The places are then the collapsed layout (S.cr: where each stands with the block folded at its home, S.box
  // its box), and the slot is found on that. `S.held`: the card's rectangle where the drag took hold (none for a row of the sidebar, which has no pointer on the page).
  function openFold(d){
    const S = d.S, els = S.els.get(d.fact) ?? [], from = S.sibs.findIndex(q => q.id === d.fact), pg0 = sheet.pageBoxes()[0];
    if (!pg0 || from < 0 || d.kind === 'line' || d.kind === 'group' || !els.some(e => e.getBoundingClientRect().height > pg0.height * FEEL.FOLD)) return;
    S.fold = sheet.headOf(els[0]).h;
    const L = layout(d, { at: from, fold: true }), ax = S.inline ? 'left' : 'top', sz = S.inline ? 'width' : 'height';
    S.cr = S.sibs.map((q, i) => ({ ...q.rect, [ax]: q.rect[ax] + (L.slot[q.id] ?? 0), [sz]: i === from ? S.fold : q.rect[sz] }));
    S.box = box(S.cr);
    if (!d.p0){ sheet.fold(els); return; }
    const n = els.reduce((v, e) => v + e.querySelectorAll('li').length, 0), c = sheet.fold(els, [sheet.headOf(els[0]).text, n ? t('edit.lnShort', { n }) : ''].filter(Boolean).join(' · '));
    if (c){ S.held = { left: d.p0.x - c.w / 2, top: d.p0.y - c.h / 2, width: c.w, height: c.h }; sheet.carry(S.held.left, S.held.top); }
  }
  // The place a lifted block would take among its places (UX-6f 4b): `rs` are the places' rectangles in order (the lifted block's own, `f`, where it was lifted from), `P` the leading
  // edge of the lifted block, as a point. A neighbour is passed when the point has crossed FEEL.SWAP of its extent from the side the block comes from, along `ax`, not its
  // midpoint. Returns { at, near }: the index the block would be put at (among all the places, itself included), and the neighbour it is by.
  function slotAt(rs, f, P, ax){
    const gap = r => Math.hypot(Math.max(r.left - P.x, 0, P.x - r.left - r.width), Math.max(r.top - P.y, 0, P.y - r.top - r.height)), mid = r => Math.hypot(P.x - r.left - r.width / 2, P.y - r.top - r.height / 2);
    let m = f;
    rs.forEach((r, k) => { const g = gap(r) - gap(rs[m]); if (g < -.5 || (Math.abs(g) <= .5 && mid(r) < mid(rs[m]))) m = k; });
    if (m === f) return { at: f, near: f };
    const r = rs[m], x = ax === 'x', lo = x ? r.left : r.top, sz = x ? r.width : r.height, v = x ? P.x : P.y;
    const passed = m > f ? v >= lo + FEEL.SWAP * sz : v <= lo + sz - FEEL.SWAP * sz;
    return { at: m > f ? (passed ? m + 1 : m) : (passed ? m : m + 1), near: m };
  }
  // The drag snaps (direct editing C round 3): the lifted block is drawn at the place it would land, lagging a little toward the pointer (LAG.K of the way from that
  // place, at most LAG.MAX page px along its list and LAG.ACROSS across a one-axis list), and pops to the next place with a short glide once the pointer is nearer that place's
  // landing than this one's (halfway between them). No bumper: at either end it stays in the end place with its lag.
  // shortcut: review flag for the snap-or-free drag decision, remove when decided (`?drag=free`: the free follow with its 12 px give and bumper, shift below)
  const FREE = (() => { try { return new URLSearchParams(location.search).get('drag') === 'free'; } catch { return false; } })();
  const LAG = { K: .28, MAX: 10, ACROSS: 3 };
  const oneAxis = d => (d.kind === 'line' || d.kind === 'job' || d.kind === 'section') && new Set(d.S?.pg ?? []).size <= 1;      // (a list over two pages is laid side by side: it moves across too)
  // the place whose landing is nearest where the pointer has taken the block (`rx`, `ry`: its displacement from where it took hold): { at, near }, as slotAt gives them
  function snapAt(d, p, from, n){
    const rx = p.x - d.p0.x, ry = p.y - d.p0.y;
    let best = from, bd = Infinity;
    for (let at = 0; at <= n; at++){
      if (at === from + 1) continue;
      const o = layout(d, { at, near: at > from ? at - 1 : at })?.own; if (!o) continue;
      const v = Math.hypot(rx - o.dx, ry - o.dy);      // (both axes, also in a one-axis list: a place on the next page is across)
      if (v < bd - .01){ bd = v; best = at; }
    }
    return { at: best, near: best > from ? best - 1 : Math.min(best, n - 1) };
  }
  // Where the lifted block is held (page px): the displacement of the pointer from where it took hold, never out of the box of its places (dx, dy: what the slot is found by).
  // Past that edge it meets the bumper (ox, oy): it is shown FEEL.PULL of the way the pointer has gone, at most FEEL.REACH, and squashed (none under reduced motion: it stops at
  // the edge).
  const shift = (d, p) => {
    const S = d.S, o = S.held ?? S.sibs.find(q => q.id === d.fact)?.rect, B = S.box, cl = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    if (!o || !d.p0) return { dx: 0, dy: 0, ox: 0, oy: 0 };
    const rx = p.x - d.p0.x, ry = p.y - d.p0.y, dx = cl(rx, B.left - o.left, B.right - o.left - o.width), dy = cl(ry, B.top - o.top, B.bottom - o.top - o.height);
    const pull = v => (reduced() ? 0 : Math.sign(v) * Math.min(Math.abs(v) * FEEL.PULL, FEEL.REACH));
    if (oneAxis(d)) return { dx: pull(rx), dy, ox: 0, oy: pull(ry - dy) };      // a one-axis list: along it, and across only the give
    return { dx, dy, ox: pull(rx - dx), oy: pull(ry - dy) };
  }
  // the point of the lifted block that leads: its edge in the direction it has travelled along the places' axis (the middle when it has not moved), and that axis ('x' for a row of
  // items, and for skill groups when the block has moved further across than down)
  function lead(d, p, S, o){
    const { dx, dy } = shift(d, p), ax = S.inline || (d.kind === 'group' && Math.abs(dx) > Math.abs(dy)) ? 'x' : 'y';
    const c = { x: o.left + o.width / 2 + dx, y: o.top + o.height / 2 + dy };
    return { ax, P: ax === 'x' ? { x: c.x + Math.sign(dx) * o.width / 2, y: c.y } : { x: c.x, y: c.y + Math.sign(dy) * o.height / 2 } };
  }
  // where a drag at `p` (the page's pixels) would drop: sets drag.to / drag.at / drag.ok, draws the drop line or the reason
  function dragTo(p){
    const x = ix(), d = drag;
    d.ok = false; d.to = null; d.at = null; d.near = null; showDrop(null);
    if (d.kind !== 'skill'){
      const S = d.S ??= sibsOf(d), { sibs } = S;
      if (!sibs.length || !S.room.length) return;
      if (!S.opened){ S.opened = true; openFold(d); }
      // Over another place's text, out of its container, the move is refused (nothing drops there) and a faint line shows the slot the pointer is nearing; anywhere else the block
      // is held inside the box of its places (shift) and takes the slot its leading edge has crossed (slotAt)
      if (!S.room.some(b => within(p, b))){
        const tx = (S.own && within(p, box([S.own]), RIM, RIM, RIM)) ? null : textNear(p);
        if (tx){ showDrop({ left: tx.left, width: tx.width, top: p.y < tx.top + tx.height / 2 ? tx.top - 2 : tx.top + tx.height + 2, height: 0 }, false, true); return; }
      }
      const from = sibs.findIndex(q => q.id === d.fact), n = sibs.length;
      if (from < 0) return;
      const rs = S.cr ?? sibs.map(q => q.rect), { P, ax } = lead(d, p, S, S.held ?? rs[from]), { at, near } = FREE || S.fold || !d.p0 ? slotAt(rs, from, P, ax) : snapAt(d, p, from, n);
      d.at = at; d.near = near; d.ok = at !== from && at !== from + 1; d.to = sibs[at]?.id ?? null;
      if (d.ok && (FREE || S.fold || !d.p0)){      // (snapped, the block itself stands in the place: no bar)
        const r = rs[ax === 'x' ? near : Math.min(at, n - 1)], end = ax === 'x' ? at > near : at >= n;      // across: on the side of the neighbour it goes by; down: above the place it takes, or under the last
        const up = ax === 'y' && !end && at > 0 && S.pg[at - 1] === S.pg[at] ? rs[at - 1] : null;      // between two places on a page: the middle of the gap, as far from the words on each side as it can be (UX-6f 4c)
        showDrop(ax === 'x' ? { left: end ? r.left + r.width + 2 : r.left - 2, top: r.top, width: 0, height: r.height } : { left: r.left, width: r.width, top: end ? r.top + r.height + 2 : up ? (up.top + up.height + r.top) / 2 : r.top - 2, height: 0 }, ax === 'x');
      }
    } else {
      const gs = sheet.skillGroups(x).filter(g => g.items.length || g.fact === d.fact);
      const g = gs.find(g => within(p, box([g.rect]), 8, 8, 6)), B = box(gs.map(g => g.rect));
      if (!g) return;
      let j = g.items.findIndex(r => p.y < r.top - 1 || (p.y <= r.top + r.height && p.x < r.left + r.width / 2)); if (j < 0) j = g.items.length;
      const same = g.fact === d.fact;
      d.ok = !same || (j !== d.k && j !== d.k + 1); d.to = { g: g.fact, j: same && j > d.k ? j - 1 : j };
      if (d.ok){ const ref = g.items[Math.min(j, g.items.length - 1)]; if (ref) showDrop({ left: j < g.items.length ? ref.left - 2 : ref.left + ref.width + 1, top: ref.top, width: 0, height: ref.height }, true); }
    }
  }
  // Where each block of the container goes if the drag lands where it is now: `moves` for the siblings (in the page's pixels, from where they are printed),
  // `own` for the dragged block (its place: the drop). The siblings slide to open the gap there and close the one it left.
  function layout(d, o = {}){
    const S = d.S;
    if (!S) return null;
    const { sibs, pg } = S, n = sibs.length, from = sibs.findIndex(q => q.id === d.fact), at = o.at ?? (d.ok ? d.at : from), fold = o.fold ?? !!S.fold, moves = [], slot = {};
    let own = null;
    if (from >= 0){
      const ax = S.inline ? 'left' : 'top', sz = S.inline ? 'width' : 'height', key = S.inline ? 'dx' : 'dy', szOf = q => (fold && S.fold && q.id === d.fact ? S.fold : q.rect[sz]);      // folded: the block takes its heading's room
      const ref = sibs[o.at == null ? (d.ok ? Math.min(d.near ?? at, n - 1) : from) : Math.min(o.near ?? from, n - 1)], land = pg[sibs.indexOf(ref)];      // the sibling the block lands by, and its page
      const gap = sibs.map((q, i) => (pg[i + 1] === pg[i] ? sibs[i + 1].rect[ax] - q.rect[ax] - q.rect[sz] : null)).find(g => g != null) ?? 0;
      for (const g of new Set(pg)){
        const orig = sibs.filter((_, i) => pg[i] === g), list = orig.filter(q => q.id !== d.fact);
        if (g === land) list.splice(sibs.slice(0, at).filter((q, i) => pg[i] === g && q.id !== d.fact).length, 0, sibs[from]);
        const gaps = orig.slice(1).map((q, k) => q.rect[ax] - orig[k].rect[ax] - orig[k].rect[sz]);
        let pos = orig[0].rect[ax];
        list.forEach((q, k) => { slot[q.id] = pos - q.rect[ax]; pos += szOf(q) + (gaps[k] ?? gaps.at(-1) ?? gap); });
      }
      for (const q of sibs) if (q.id !== d.fact) moves.push({ els: S.els.get(q.id), [key]: slot[q.id] });
      own = { dx: S.inline ? slot[d.fact] : ref.rect.left - sibs[from].rect.left, dy: S.inline ? 0 : slot[d.fact] };
    }
    return { moves, own, slot };
  }
  // The live preview of a block's move: the block is lifted and follows the pointer (`p`, from where it was pressed); with no pointer on the
  // page (a row of the sidebar) it stands in its new place, gliding there.
  function preview(d, p){
    const L = layout(d);
    if (!L) return;
    const { moves, own } = L, S = d.S, { sibs } = S, from = sibs.findIndex(q => q.id === d.fact);
    if (!p && own) moves.push({ els: S.els.get(d.fact), ...own, lift: !S.fold, glide: !S.fold });      // (a folded block is placed like the others: it pops to its slot)
    if (p && d.p0){      // the block follows the pointer, and stays inside its container however far the pointer goes (past the edge it meets the bumper)
      const h = shift(d, p), q = FEEL.SQUASH / FEEL.REACH, sq = { x: h.ox * q, y: h.oy * q };
      if (S.fold){ if (own) moves.push({ els: S.els.get(d.fact), ...own }); sheet.carry(S.held.left + h.dx + h.ox, S.held.top + h.dy + h.oy, sq); }      // its card follows the pointer, its home stays folded in the slot
      else if (!FREE && own){      // snapped: at its landing place, lagging toward the pointer; a new place is reached with a short glide (none under reduced motion: play)
        const cap = (v, m) => Math.max(-m, Math.min(m, v)), x1 = oneAxis(d) && !S.inline ? LAG.ACROSS : LAG.MAX, y1 = oneAxis(d) && S.inline ? LAG.ACROSS : LAG.MAX;
        const pop = d.shown != null && d.shown !== (d.ok ? d.at : -1); d.shown = d.ok ? d.at : -1;
        moves.push({ els: S.els.get(d.fact), dx: own.dx + cap(LAG.K * (p.x - d.p0.x - own.dx), x1), dy: own.dy + cap(LAG.K * (p.y - d.p0.y - own.dy), y1), lift: true, glide: pop });
      }
      else moves.push({ els: S.els.get(d.fact), dx: h.dx + h.ox, dy: h.dy + h.oy, sq, lift: true });
    }
    if (own) sheet.socket(S.els.get(d.fact), own);      // the dashed socket where it will land (at first, its home)
    sheet.nudge(moves);
  }
  // …and the same where the pointer is over a row of the sidebar (`rows`: the block's siblings there, in order): the place is found among the rows
  function rowTo(d, rows, e){
    d.ok = false; d.to = null; d.at = null; showDrop(null);
    const S = d.S ??= sibsOf(d);
    if (!S.opened){ S.opened = true; openFold(d); }
    const rs = rows.map(el => ({ id: rowId(el), r: el.getBoundingClientRect() })).filter(q => S.sibs.some(o => o.id === q.id));
    if (!rs.length) return;
    const b = box(rs.map(q => q.r)), col = $('#body')?.getBoundingClientRect();
    if (col && (e.clientX < col.left || e.clientX > col.right)) return;      // out of the panel: nothing drops (the block stays where it was)
    // over a row of another container the move is refused (a faint line where it nears); anywhere else in the panel the block latches to the nearest place in its own rows
    const near = (d.others ?? []).find(el => { const r = el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - RIM && e.clientY <= r.bottom + RIM; });
    if (near){ const r = near.getBoundingClientRect(); showDrop({ left: r.left, width: r.width, top: e.clientY < r.top + r.height / 2 ? r.top - 1 : r.bottom + 1, height: 0 }, false, true, true); return; }
    const y = Math.min(Math.max(e.clientY, b.top), b.bottom), n = S.sibs.length, from = S.sibs.findIndex(q => q.id === d.fact), f = rs.findIndex(q => q.id === d.fact);
    if (f < 0) return;
    const k = slotAt(rs.map(q => q.r), f, { x: b.left + 1, y }, 'y').at;      // the pointer is the leading edge: a row does not follow it
    const at = k < rs.length ? S.sibs.findIndex(q => q.id === rs[k].id) : n;
    d.at = at; d.ok = at !== from && at !== from + 1; d.to = S.sibs[at]?.id ?? null;
    if (d.ok){ const ref = S.sibs[Math.min(at, n - 1)].rect; showDrop({ left: ref.left, width: ref.width, top: at < n ? ref.top - 2 : ref.top + ref.height + 2, height: 0 }); }
  }
  // The drop. A block that is let go over a place travels there from where it is (sheet.land: its shadow closing, the others already in their places), and the
  // model moves as it sets off, so an Undo while it travels is safe; the page is drawn again, with the same picture, once it has landed (sheet.hold). Esc, a refused
  // drop and a drop where it was use the same motion back. Reduced motion: it is there at once.
  function endDrag(p){
    const d = drag;
    drag = null; showDrop(null); document.body.classList.remove('is-dragging'); sheet.doc?.documentElement.classList.remove('rb-dragging');
    sheet.doc?.removeEventListener('keydown', escDrag, true);
    if (!d){ sheet.unnudge(false); return; }
    if (p) dragEnded = performance.now();
    if (p && d.moved && d.ok){
      if (d.kind === 'skill') C.edit().moveSkill(d.fact, d.k, d.to.g, d.to.j);
      else {
        const L = layout(d, { fold: false }), n0 = C.undoN(), rows = d.rowEl ? d.rows : null, tops = rows && new Map(rows.map(el => [rowId(el), el.getBoundingClientRect().top]));
        C.ui.morph = { kind: 'apply' };      // what the preview could not know (a page break the new order moves) slides from where it is
        if (d.kind === 'line') C.edit().moveLine(d.fact, d.to);
        else if (d.kind === 'group') C.edit().moveGroup(d.fact, d.to);
        else if (d.kind === 'job') C.edit().moveJob(d.fact, d.to);
        else if (d.kind === 'section') C.edit().moveSectionTo(d.fact, d.to);
        else C.edit().moveItemTo(d.sid, d.fact, d.to);
        if (C.undoN() !== n0){ sheet.hold(sheet.land(L?.own, true, d.S?.fold ? L?.moves : null)); if (tops) flipRows(tops, rows); place(); return; }
        C.ui.morph = null;
      }
    }
    sheet.land(null, false);
    place();
  }
  // the sidebar's rows, drawn again with the new order, slide from where they were (once the page is drawn)
  function flipRows(tops, old){
    const body = $('#body');
    if (!body) return;
    const stop = () => { mo.disconnect(); clearTimeout(tm); };
    const mo = new MutationObserver(() => {
      const now = [...body.querySelectorAll(ROW)].filter(el => tops.has(rowId(el)));
      if (!now.length || old.includes(now[0])) return;      // not drawn again yet
      stop();
      for (const el of now){ const dy = tops.get(rowId(el)) - el.getBoundingClientRect().top; if (Math.abs(dy) > 1) play(el, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { ms: 'base', kind: 'move', name: 'row:flip' }); }
    });
    const tm = setTimeout(stop, 2500);
    mo.observe(body, { childList: true, subtree: true });
  }
  // Esc during a drag: nothing is dropped, everything goes back, no undo step; the click that follows the release is not a click
  function escDrag(e){ if (e.key === 'Escape' && drag?.moved){ e.preventDefault(); e.stopPropagation(); spent = true; dragEnded = performance.now(); endDrag(null); } }
  window.addEventListener('keydown', escDrag, true);
  const dragMove = p => { drag.moved = true; dragTo(p); preview(drag, p); };

  // ---- the sidebar's rows: grabbing a row drags its block (no handles), the page showing the same preview ----
  const rowId = el => el.dataset.bullet ?? el.dataset.item ?? el.dataset.job ?? el.dataset.sid;
  const ROW = '.clrow[data-bullet], .clrow[data-item], .clgh[data-job], .osec > .srow[data-sid]';
  const NOT_ROW = 'input, label, select, textarea, .rowlock, .clv';      // its switch, padlock and version count act on their own
  function rowOf(el){
    const q = (sel, root = $('#body')) => [...root.querySelectorAll(sel)], ref = CSS.escape;
    const kind = (d, sel, rows) => ({ d, rows, others: q(sel).filter(r => !rows.includes(r)) });      // the rows of the same kind in other containers: the move is refused there
    if (el.matches('.clrow[data-bullet]')) return kind({ kind: 'line', fact: el.dataset.bullet, job: el.dataset.bjob }, '.clrow[data-bullet]', q(`.clrow[data-bullet][data-bjob="${ref(el.dataset.bjob)}"]`));
    if (el.matches('.clrow[data-item]')) return kind({ kind: 'item', fact: el.dataset.item, sid: el.dataset.sec }, '.clrow[data-item]', q(`.clrow[data-item][data-sec="${ref(el.dataset.sec)}"]`));
    if (el.matches('.clgh[data-job]')) return kind({ kind: 'job', fact: el.dataset.job, sid: T.sectionOfEntry(rec(), el.dataset.job) }, '.clgh[data-job]', q('.clgh[data-job]', el.closest('.osec') ?? $('#body')));
    if (el.matches('.srow:not(.fixed):not(.is-off)')) return kind({ kind: 'section', fact: el.dataset.sid }, '.osec > .srow[data-sid]:not(.fixed):not(.is-off)', q('.osec > .srow[data-sid]:not(.fixed):not(.is-off)'));
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
        sheet.endLand(); C.edit().leaveLine();
        drag = { ...r.d, ok: false, to: null, moved: true, rowEl: el, rows: r.rows, others: r.others }; began = true; document.body.classList.add('is-dragging');
        sheet.doc?.addEventListener('keydown', escDrag, true);
        place();
      } else if (drag.rowEl !== el) return off();
      rowTo(drag, r.rows, m); preview(drag, null);
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
      if (!drag.moved){ sheet.endLand(); C.edit().leaveLine(); document.body.classList.add('is-dragging'); sheet.doc?.addEventListener('keydown', escDrag, true); place(); }
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

  return { pointer, place, refresh, drawn, feel: FEEL, plate: () => sheet.plateState(), gate: on => { gateOn = !!on; }, settle: () => sheet.endLand(), justDragged: () => performance.now() - dragEnded < 250 };
}
