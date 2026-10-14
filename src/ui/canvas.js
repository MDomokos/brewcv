// The canvas: moves the sheet (the iframe with the pages in it) with the camera of src/ui/camera.js, and reads the wheel, the
// hand and the pinch. Not used on a phone, where the pages scroll above the bottom sheet (shell.js keeps that).
//
// State lives on ui: ui.cam is { k, x, y }; ui.zoom is the scale relative to the fit view (1 is the fit view); ui.page is the
// bright page. `free` is true once the person has zoomed or panned: the view then stays where it was put until 0, Fit, or Esc.

import {
  geometry, fitCam, contentOf, zoomAbout, snapZoom, hardCam, softCam, keepPageEdge, rubber, limits, stops, magnetize, unmagnetize, settleIndex,
  brightPage, onPage, faded, springStep, atRest, centreOn, writingScale, midX, pageLeft, rowWidth,
} from './camera.js';
import { clampZoom, PHONE_MAX } from './layout.js';
import { readMagnet, readBounce } from './dock.js';
import { reduced, dur } from './motion.js';

// the ease between views is --m-travel (a setting in the zoom pop-up scales the zoom, not this)
const easeOut = p => 1 - Math.pow(1 - p, 3);
const IDLE_MS = 140;                                    // the wheel or the hand has stopped

export const PAGES_MOVED = 'brewcv:pages-moved';        // fired on document once the pages have come to rest in a new place
export const PAGES_MOVING = 'brewcv:pages-moving';      // fired on document as they start to move, before they have; body.is-moving lasts until PAGES_MOVED

export function initCanvas(C){
  const { ui, host, box } = C;
  let geo = null, view = null, fit = null, scene = 'all';
  let free = false, cam = { k: 1, x: 0, y: 0 };
  let motion = null, raf = 0, idleT = 0, movedT = 0, firedSig = '';
  let lean = { x: 0, y: 0 };                            // the pan's recent speed in px per step, smoothed: how far the sheet's edge lifts (drinks.css)
  let moving = false, rawFree = null, drag = null, space = false, raw = null, vel = 0, lastWheel = 0, handedAt = 0;
  const pointers = new Map();
  const dials = { magnet: readMagnet(), bounce: readBounce() };

  const phone = () => innerWidth < PHONE_MAX;
  const pagesN = () => Math.max(1, ui.laid?.pages?.length ?? ui.fills?.length ?? 1);

  // ---- placing the sheet ----
  function put(next, panned){                           // panned: a wheel pan or a drag, the only moves that lift the page (body.is-panning, drinks.css)
    if (!moving){ moving = true; document.dispatchEvent(new CustomEvent(PAGES_MOVING)); document.body.classList.add('is-moving'); }
    if (panned) document.body.classList.add('is-panning');
    lean = { x: lean.x * .6 + (next.x - cam.x) * .4, y: lean.y * .6 + (next.y - cam.y) * .4 };
    host.style.setProperty('--lx', (-Math.max(-1, Math.min(1, lean.x / 24)) * .8).toFixed(3)); host.style.setProperty('--ly', (Math.max(-1, Math.min(1, lean.y / 24)) * .8).toFixed(3));
    cam = next; ui.cam = cam;
    host.style.left = '0px'; host.style.top = '0px';
    host.style.transform = `translate(${cam.x.toFixed(2)}px, ${cam.y.toFixed(2)}px) scale(${cam.k.toFixed(5)})`;
    ui.zoom = fit ? Math.round((cam.k / fit.k) * 1000) / 1000 : 1;
    follow();
    C.moved?.();
  }
  // which page is bright follows what is on screen; nothing is faded while both are shown equal and in place
  function follow(){
    if (!geo) return;
    const equal = scene === 'all' && !free && geo.n > 1;
    const bright = geo.n > 1 ? brightPage(cam, geo, view, ui.page) : 0;
    const changed = bright !== ui.page;
    ui.page = bright;
    ui.equal = equal;
    C.sheet.setFade(geo.n > 1 ? faded(geo, bright, equal) : []);
    if (changed) C.pageChanged?.(bright);
  }

  // ---- moving: an ease, or a spring ----
  function stop(){ cancelAnimationFrame(raf); raf = 0; motion = null; }
  function go(to, { spring = false, ms = dur('travel') } = {}){
    clearTimeout(movedT);
    if (reduced() || !ui.ready){ stop(); put(to); settled(); return; }
    motion = { from: { ...cam }, to, t0: performance.now(), ms, spring, sx: { x: cam.x, v: 0 }, sy: { x: cam.y, v: 0 }, last: performance.now() };
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function frame(now){
    raf = 0;
    const m = motion;
    if (!m) return;
    const p = Math.min(1, (now - m.t0) / m.ms), e = easeOut(p);
    const k = m.from.k * Math.pow(m.to.k / m.from.k, e);
    let x, y, done;
    if (m.spring){
      const dt = Math.min(0.05, (now - m.last) / 1000); m.last = now;
      m.sx = springStep(m.sx, m.to.x, dt, dials); m.sy = springStep(m.sy, m.to.y, dt, dials);
      x = m.sx.x; y = m.sy.x;
      done = p >= 1 && atRest(m.sx, m.to.x) && atRest(m.sy, m.to.y);
      if (now - m.t0 > 1500) done = true;
    } else {
      x = m.from.x + (m.to.x - m.from.x) * e; y = m.from.y + (m.to.y - m.from.y) * e;
      done = p >= 1;
    }
    if (done){ motion = null; put({ ...m.to }); settled(); return; }
    put({ k, x, y });
    raf = requestAnimationFrame(frame);
  }
  // the pages have come to rest: tell whoever draws on top of them, once per place
  function settled(){
    want = null;
    clearTimeout(movedT);
    movedT = setTimeout(() => {
      if (motion || drag || raw !== null) return;
      moving = false; document.body.classList.remove('is-moving', 'is-panning');
      lean = { x: 0, y: 0 }; host.style.removeProperty('--lx'); host.style.removeProperty('--ly');
      const sig = `${cam.k.toFixed(3)}|${cam.x.toFixed(1)}|${cam.y.toFixed(1)}|${innerWidth}|${innerHeight}|${ui.layout?.folded}`;
      if (sig === firedSig) return;
      firedSig = sig;
      document.dispatchEvent(new CustomEvent(PAGES_MOVED, { detail: { cam: { ...cam }, zoom: ui.zoom, page: ui.page } }));
    }, 90);
  }

  const fitOf = opts => fitCam(geo, view, opts);

  // ---- the layout: called whenever the window, the panel, the pages or the page size changes ----
  function layout(L, format){
    geo = geometry({ vw: innerWidth, vh: innerHeight, format, pages: pagesN() });
    view = L.view;
    scene = L.spread ? 'all' : 'one';
    ui.page = Math.max(0, Math.min(geo.n - 1, ui.page ?? 0));
    fit = fitOf({ scene, page: ui.page });
    ui.geo = geo; ui.pageView = view;
    // one soft layer per page for the lift to draw its shadow and edge shading on (drinks.css); sheet.js keeps them when the frame is swapped
    host.querySelectorAll('.lift').forEach(e => e.remove());
    for (let i = 0; i < geo.n; i++){
      const e = document.createElement('i'), left = pageLeft(geo, i);
      e.className = 'lift'; e.setAttribute('aria-hidden', 'true');
      e.style.cssText = `left:${left}px;width:${geo.w}px;height:${geo.h}px;--o:${rowWidth(geo.w, geo.n) / 2 - left}px ${geo.h / 2}px`;
      host.append(e);
    }
    if (!free){ go(fit); return; }
    // the view was put somewhere on purpose: it keeps its zoom and the content in the middle, whatever the window does
    const at = motion ? motion.to : cam;                // a move under way counts as already made
    const was = at.k / (ui.fitK ?? fit.k);
    const mid = contentOf(at, (ui.viewWas ?? view).left + (ui.viewWas ?? view).width / 2, (ui.viewWas ?? view).top + (ui.viewWas ?? view).height / 2);
    go(hardCam(centreOn(geo, view, fit.k * was, mid.x, mid.y), geo, view));
  }
  const rememberView = () => { ui.fitK = fit?.k; ui.viewWas = view; };

  const centre = () => ({ x: midX(view), y: view.top + view.height / 2 });

  // ---- zoom ----
  let want = null;
  function zoomTo(z, at = centre(), { animate = true } = {}){
    if (!geo) return;
    z = snapZoom(clampZoom(z));
    want = animate ? z : null;
    if (z === 1 && !ui.writing){ reset(); return; }
    free = true;
    const next = hardCam(zoomAbout(cam, fit.k * z, at.x, at.y), geo, view);
    rememberView();
    animate ? go(next) : (stop(), put(next), settled());
  }
  const zoomBy = (f, at) => zoomTo((ui.zoom ?? 1) * f, at);
  // 0, Fit, Esc: back to the whole thing
  function reset({ page = ui.page } = {}){
    if (!geo) return;
    free = false; raw = null;
    fit = fitOf({ scene, page });
    rememberView();
    go(fit);
  }

  // ---- writing: the view eases to the writing zoom around the block, and follows it from line to line ----
  // r is the block in the page's own pixels. keepZoom: already writing, so only pan to the next block.
  function writeTo(r, percent, { keepZoom = false } = {}){
    if (!geo) return;
    const k = keepZoom ? cam.k : writingScale(geo, view, percent);
    const next = keepPageEdge(hardCam(centreOn(geo, view, k, r.left + r.width / 2, r.top + r.height / 2), geo, view), geo, view, r);
    free = true; want = null; rememberView();
    go(next);
  }
  // keep a block (a line that grows as you type) inside the view, with some room
  function ensureVisible(r, room = 70){
    if (!geo || motion || drag) return;
    const s = { left: cam.x + r.left * cam.k, top: cam.y + r.top * cam.k, right: cam.x + (r.left + r.width) * cam.k, bottom: cam.y + (r.top + r.height) * cam.k };
    let dx = 0, dy = 0;
    if (s.top < view.top + room) dy = view.top + room - s.top; else if (s.bottom > view.top + view.height - room) dy = view.top + view.height - room - s.bottom;
    if (s.left < view.left + room) dx = view.left + room - s.left; else if (s.right > view.left + view.width - room) dx = view.left + view.width - room - s.right;
    if (dx || dy){ free = true; rememberView(); go(hardCam({ ...cam, x: cam.x + dx, y: cam.y + dy }, geo, view)); }
  }

  // ---- a page: from a meter, a key, a click on a faded page ----
  function goToPage(i){
    if (!geo) return;
    i = Math.max(0, Math.min(geo.n - 1, i));
    if (scene === 'all' && !free){ ui.page = i; follow(); C.pageChanged?.(i); return; }       // both are on screen already
    free = false; raw = null; ui.page = i;
    fit = fitOf({ scene, page: i });
    rememberView();
    go(fit, { spring: true });
    follow();
  }
  const travel = d => goToPage((ui.page ?? 0) + d);

  // ---- the wheel ----
  // true when a wheel would travel between pages: one page at a time, nothing zoomed or panned, nothing being written
  const travelling = () => scene === 'one' && geo?.n > 1 && !free && !ui.writing;
  function unit(e){ return e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.height : 1; }
  function wheel(e, at){
    if (!geo || phone()) return false;
    if (e.ctrlKey){                                                         // a trackpad pinch (Chrome, Edge) or Ctrl and the wheel
      e.preventDefault();
      zoomTo((ui.zoom ?? 1) * Math.exp(-e.deltaY * unit(e) * 0.01), at ?? { x: e.clientX, y: e.clientY }, { animate: false });
      if (ui.writing) C.writeZoomChanged?.(Math.round((ui.zoom ?? 1) * 100));      // while writing, a pinch is the writing zoom
      return true;
    }
    if (e.target?.closest?.('#col, #switcher, #help, .zpop, .actual')) return false;
    const dx = e.deltaX * unit(e), dy = e.deltaY * unit(e);
    if (scene === 'all' && !free && !ui.writing){ e.preventDefault(); return true; }   // both pages are in view: nothing to travel to
    e.preventDefault();
    stop();
    if (travelling()){
      const xs = stops(geo, view, fit.k);
      const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      const now = performance.now();
      vel = lastWheel ? -d / Math.max(8, now - lastWheel) * 1000 : 0; lastWheel = now;
      raw = (raw ?? unmagnetize(cam.x, xs, dials.magnet)) - d;
      const lo = xs[xs.length - 1], hi = xs[0];
      put({ ...cam, y: fit.y, x: raw > hi || raw < lo ? rubber(raw, lo, hi) : magnetize(raw, xs, dials.magnet) }, true);
      rest(() => {
        const at = settleIndex(cam.x, xs, vel);
        raw = null; vel = 0; lastWheel = 0;
        ui.page = at; fit = fitOf({ scene: 'one', page: at }); rememberView();
        go(fit, { spring: true });
      });
      return true;
    }
    free = true; rememberView();
    // the pull is kept unrubbered and the rubber is applied to it once: rubbering the already rubbered position, event after event, made the edge jitter
    rawFree = { x: (rawFree?.x ?? cam.x) - dx, y: (rawFree?.y ?? cam.y) - dy };
    put(softCam({ ...cam, ...rawFree }, geo, view), true);
    rest(() => { rawFree = null; go(hardCam(cam, geo, view), { spring: true }); });
    return true;
  }
  function rest(fn){ clearTimeout(idleT); idleT = setTimeout(fn, IDLE_MS); }

  // ---- the hand: Space and drag, the middle button, a drag on the bare canvas, two fingers ----
  function down(e, inFrame = false){
    if (!geo || phone() || ui.view === 'welcome') return false;
    if (e.pointerType === 'touch' || e.pointerType === 'pen') pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2){ drag = null; pinchStart(); return true; }
    const bare = !inFrame && (e.target === box || e.target === box.firstElementChild);
    const hand = e.button === 1 || (space && e.button === 0) || (bare && e.button === 0);
    if (!hand) return false;
    e.preventDefault();
    stop(); clearTimeout(idleT);
    drag = { x: e.clientX, y: e.clientY, cam: { ...cam }, id: e.pointerId, bare: bare && e.button === 0, moved: false };
    document.body.classList.add('is-handing'); C.sheet.setHand(true, space);
    return true;
  }
  function move(e){
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) return pinchMove();
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
    drag.moved = true;
    free = true; rememberView();
    put(softCam({ ...drag.cam, x: drag.cam.x + e.clientX - drag.x, y: drag.cam.y + e.clientY - drag.y }, geo, view), true);
  }
  // the pointer is over a sheet (not the mat, the gap or the panel): `inPages` is false when something else (the panel) is on top
  const sheetOver = (x, y, inPages = true) => { if (geo) C.sheetOver?.(inPages && onPage(cam, geo, x, y)); };
  function up(e){
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2){ pinch = null; go(hardCam(cam, geo, view), { spring: true }); }
    if (!drag) return;
    const was = drag; drag = null; document.body.classList.remove('is-handing'); C.sheet.setHand(false, space);
    if (was.moved) handedAt = performance.now();
    else if (was.bare) C.bareClick?.();
    if (was.moved) go(hardCam(cam, geo, view), { spring: true });
  }
  let pinch = null;
  function pinchStart(){
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: ui.zoom ?? 1 };
  }
  function pinchMove(){
    if (!pinch) return;
    const [a, b] = [...pointers.values()];
    zoomTo(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { animate: false });
  }
  // Safari sends a pinch as gesture events
  let gz = 1;
  function gesture(e){
    if (!geo || phone()) return;
    e.preventDefault();
    if (e.type === 'gesturestart'){ gz = ui.zoom ?? 1; return; }
    if (e.type === 'gesturechange') zoomTo(gz * e.scale, { x: e.clientX, y: e.clientY }, { animate: false });
  }

  // Space pans (outside a line, where it is a space)
  const typingIn = t => !!t?.closest?.('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, [contenteditable=true], [contenteditable=plaintext-only]');
  function keydown(e){
    if (e.code === 'Space' && !typingIn(e.target) && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, select, textarea, button, a, summary, [contenteditable], [role=button], [role=checkbox], [tabindex]')){
      space = true; document.body.classList.add('is-space'); C.sheet.setHand(false, true); e.preventDefault();
    }
  }
  function keyup(e){ if (e.code === 'Space' && space){ space = false; document.body.classList.remove('is-space'); C.sheet.setHand(!!drag, false); } }

  function bind(){
    box.addEventListener('wheel', e => wheel(e), { passive: false });
    box.addEventListener('pointerdown', e => down(e));
    addEventListener('pointermove', e => { move(e); sheetOver(e.clientX, e.clientY, !!e.target.closest?.('#pages')); });
    document.documentElement.addEventListener('pointerleave', () => C.sheetOver?.(false));
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('keyup', keyup, true);
    addEventListener('blur', () => { space = false; document.body.classList.remove('is-space'); });
    for (const g of ['gesturestart', 'gesturechange', 'gestureend']) box.addEventListener(g, gesture);
  }

  // what sheet.js forwards from inside the frame: coordinates are the page's own pixels, so they are scaled to the window
  const toWindow = (fr, e) => { const r = fr.getBoundingClientRect(), k = r.width / (fr.offsetWidth || r.width); return { x: r.left + e.clientX * k, y: r.top + e.clientY * k }; };
  const frameEvents = {
    wheel(fr, e){ const p = toWindow(fr, e); return wheel({ ...copy(e), clientX: p.x, clientY: p.y, target: box }, p) ? (e.preventDefault(), true) : false; },
    down(fr, e){ const p = toWindow(fr, e); const fake = { ...copy(e), clientX: p.x, clientY: p.y, target: e.target, button: e.button, pointerId: e.pointerId, pointerType: e.pointerType, preventDefault: () => e.preventDefault() }; return down(fake, true); },
    move(fr, e){ const p = toWindow(fr, e); move({ clientX: p.x, clientY: p.y, pointerId: e.pointerId }); sheetOver(p.x, p.y); },
    up(fr, e){ const p = toWindow(fr, e); up({ clientX: p.x, clientY: p.y, pointerId: e.pointerId }); },
    gesture(fr, e){ const p = toWindow(fr, e); gesture({ type: e.type, scale: e.scale, clientX: p.x, clientY: p.y, preventDefault: () => e.preventDefault() }); },
    key: { down: keydown, up: keyup },
  };
  const copy = e => ({ ctrlKey: e.ctrlKey, deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, preventDefault: () => e.preventDefault() });

  // ---- for the rest of the shell ----
  return {
    bind, layout, writeTo, ensureVisible, zoomTo, zoomBy: (f, at) => zoomTo((want ?? ui.zoom ?? 1) * f, at), reset, goToPage, travel, frameEvents,
    get cam(){ return { ...cam }; },
    get free(){ return free; },
    // a drag that moved the pages must not also be a click on a line
    get handed(){ return performance.now() - handedAt < 250; },
    get geo(){ return geo; }, get view(){ return view; }, get fit(){ return fit; }, get scene(){ return scene; },
    // dials from the zoom pop-up and the console
    set(d){ Object.assign(dials, d); },
    // where a rectangle of the page (its own pixels, from the sheet's corner) is on the screen
    screenRect(r){ return { left: cam.x + r.left * cam.k, top: cam.y + r.top * cam.k, width: r.width * cam.k, height: r.height * cam.k }; },
    put(next){ stop(); put(next); settled(); },
    // the sheet drawn somewhere for a moment (the preview of another resume's paper), nothing else told
    showOnly(next){ stop(); host.style.transform = `translate(${next.x.toFixed(2)}px, ${next.y.toFixed(2)}px) scale(${next.k.toFixed(5)})`; },
    go,
    limits: () => (geo ? limits(cam, geo, view) : null),
    stop,
  };
}
