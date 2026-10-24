// The canvas: moves the sheet (the iframe with the pages in it) with the camera of src/ui/camera.js, and reads the wheel, the
// hand and the pinch. Not used on a phone, where the pages scroll above the bottom sheet (shell.js keeps that).
//
// State lives on ui: ui.cam is { k, x, y }; ui.zoom is the scale relative to the fit view (1 is the fit view); ui.page is the
// bright page. `free` is true once the person has zoomed or panned: the view then stays where it was put until 0, Fit, or Esc.

import {
  geometry, fitCam, contentOf, zoomAbout, snapZoom, hardCam, softCam, keepPageEdge, rubber, limits, stops, magnetize, unmagnetize, settleIndex,
  brightPage, allShown, onPage, faded, springStep, atRest, centreOn, writingScale, midX, MAGNET, BOUNCE,
} from './camera.js';
import { clampZoom, PHONE_MAX } from './layout.js';
import { onLinux } from './ask.js';
import { reduced, dur } from './motion.js';
import { tableSvg, tableObjects, rulerSvg } from './table.js';

// the ease between views is --m-travel
const easeOut = p => 1 - Math.pow(1 - p, 3);
const IDLE_MS = 140;                                    // the wheel or the hand has stopped

export const PAGES_MOVED = 'brewcv:pages-moved';        // fired on document once the pages have come to rest in a new place
export const PAGES_MOVING = 'brewcv:pages-moving';      // fired on document as they start to move, before they have; body.is-moving lasts until PAGES_MOVED

export function initCanvas(C){
  const { ui, host, box } = C;
  let geo = null, view = null, fit = null, scene = 'all';
  let free = false, cam = { k: 1, x: 0, y: 0 };
  let motion = null, raf = 0, idleT = 0, movedT = 0, firedSig = '';
  let moving = false, rawFree = null, drag = null, space = false, raw = null, vel = 0, lastWheel = 0, handedAt = 0;
  const pointers = new Map();
  const linux = onLinux();
  document.documentElement.classList.toggle('is-linux', linux);
  // the pages move or rest: nothing on them glides against the camera (sheet.camMoving), and on Linux their shadows are shed
  const shed = on => { document.body.classList.toggle('is-moving', on); C.sheet.camMoving?.(on); if (linux) C.sheet.setMoving(on); };
  const dials = { magnet: MAGNET, bounce: BOUNCE };

  const phone = () => innerWidth < PHONE_MAX;
  const pagesN = () => Math.max(1, ui.laid?.pages?.length ?? ui.fills?.length ?? 1);

  // ---- the table ----
  // The mat the pages lie on scales with the page's zoom, from the same point, and does not follow its pan. Zoomed out it has an edge, then
  // a table with things on it (src/ui/table.js), drawn in millimetres beside the A4 sheet; the garden's leaves scale with it (#gworld).
  // Coffee's mat is a cutting mat: a grid of centimetres and a ruler printed on two edges. The three layers (#tbl, #mat, #mruler) are made
  // here and shown while the pages are (the start screen and the places keep the mat of the body).
  let matT = null, tblKey = '', rulKey = '', ms = null, tblDrink = null, swapping = false, zoomAnchor = null;      // zoomAnchor: the point the last zoom was about
  const drinkNow = () => (document.documentElement.dataset.drink === 'coffee' ? 'coffee' : 'tea');
  const MM = 96 / 25.4;      // the page's own pixels in a millimetre
  // each layer's tile (0: the whole width or height) in the order of the layers in workbench.css; Coffee's are a centimetre and five
  const tiles = (coffee, ppm) => (coffee ? [[50 * ppm, 50 * ppm], [50 * ppm, 50 * ppm], [10 * ppm, 10 * ppm], [10 * ppm, 10 * ppm], [0, 0]] : [[0, 0], [260, 0], [0, 14.5], [0, 145]]);
  function matMove(){
    const el = document.getElementById('mat'), tbl = document.getElementById('tbl'), rul = document.getElementById('mruler'), gw = document.getElementById('gworld');
    if (!el || !geo || !view){
      matT = null; ms = null; if (gw) gw.style.transform = ''; for (const e of [el, tbl, rul]) if (e) e.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    const ref = fitCam(geo, view, { scene: 'all' }), cx = midX(view), cy = view.top + view.height / 2;
    if (!ms || Math.abs(ms.refK - ref.k) > 1e-6){ const s0 = cam.k / ref.k; ms = { refK: ref.k, s: s0, ox: cx * (1 - s0), oy: cy * (1 - s0), pk: cam.k, px: cam.x, py: cam.y }; }
    // the table follows a zoom from the point it was about (zoomTo and reset say which; the cameras alone cannot, a scroll to the bottom
    // that comes with a zoom out would drag it along), and a pan not at all
    const f = cam.k / ms.pk, a = zoomAnchor ?? { x: cx, y: cy };
    if (Math.abs(f - 1) > 1e-4){
      ms.ox = a.x - (a.x - ms.ox) * f; ms.oy = a.y - (a.y - ms.oy) * f; ms.s *= f;
      // zooming out also draws the table toward the middle (what a zoom about a corner and a scroll to the bottom left it away from), the more the further
      if (f < 1){ const r = Math.min(1, -Math.log(f) * 3); ms.ox += (cx * (1 - ms.s) - ms.ox) * r; ms.oy += (cy * (1 - ms.s) - ms.oy) * r; }
    }
    ms.pk = cam.k; ms.px = cam.x; ms.py = cam.y;
    const s = ms.s, w = s <= 1 ? 1 : Math.pow(Math.max(0, 1 - Math.log(s) / .12), 2);      // out from the fit view the page is in the middle, and so is the table; just in from it, it comes home
    const ox = ms.ox + (cx * (1 - s) - ms.ox) * w, oy = ms.oy + (cy * (1 - s) - ms.oy) * w;
    matT = { ox, oy, s };
    if (gw) gw.style.transform = `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px) scale(${s.toFixed(4)})`;
    const coffee = drinkNow() === 'coffee', V = { w: innerWidth, h: innerHeight }, ppm = MM * ref.k;      // ppm: mat px in a millimetre
    const box = (a, b) => ({ l: ox + s * a * V.w, t: oy + s * a * V.h, r: ox + s * b * V.w, b: oy + s * b * V.h });
    const m = box(-.4, 1.4), edge = m.l > .5 || m.t > .5 || m.r < V.w - .5 || m.b < V.h - .5;      // the mat's edge is on screen
    const l = Math.max(0, m.l), t = Math.max(0, m.t), r = Math.min(V.w, m.r), b = Math.min(V.h, m.b);
    const L = tiles(coffee, ppm), gx = coffee ? m.l - l : ox - l, gy = coffee ? m.t - t : oy - t;      // Coffee's grid starts at the mat's corner
    Object.assign(el.style, {
      left: `${l.toFixed(1)}px`, top: `${t.toFixed(1)}px`, width: `${Math.max(0, r - l).toFixed(1)}px`, height: `${Math.max(0, b - t).toFixed(1)}px`,
      borderRadius: edge ? `${(26 * s).toFixed(1)}px` : '0',
      boxShadow: !edge ? 'none' : coffee ? `0 0 0 ${(2 * s).toFixed(1)}px var(--line-strong), 0 ${(8 * s).toFixed(1)}px ${(18 * s).toFixed(1)}px rgba(0,0,0,.2)`
        : `0 0 0 ${(5 * s).toFixed(1)}px var(--mat-gap), 0 ${(10 * s).toFixed(1)}px ${(24 * s).toFixed(1)}px rgba(0,0,0,.3)`,
      backgroundPosition: L.map(([tw, th]) => `${(tw ? gx : 0).toFixed(1)}px ${(th ? gy : 0).toFixed(1)}px`).join(', '),
      backgroundSize: L.map(([tw, th]) => `${tw ? (tw * s).toFixed(2) + 'px' : '100%'} ${th ? (th * s).toFixed(2) + 'px' : '100%'}`).join(', '),
    });
    // Coffee's rulers, on the mat's own top and left edges
    if (rul){
      const on = edge && coffee;
      rul.style.display = on ? 'block' : 'none';
      if (on){
        const wmm = 1.8 * V.w / ppm, hmm = 1.8 * V.h / ppm, key = `${V.w}x${V.h}@${ppm.toFixed(3)}:${Math.round(ppm * s * 10)}`;
        if (key !== rulKey){ rulKey = key; rul.innerHTML = rulerSvg(+wmm.toFixed(1), +hmm.toFixed(1), ppm * s); }
        Object.assign(rul.style, { left: `${m.l.toFixed(1)}px`, top: `${m.t.toFixed(1)}px`, width: `${(m.r - m.l).toFixed(1)}px`, height: `${(m.b - m.t).toFixed(1)}px`, borderRadius: `${(26 * s).toFixed(1)}px` });
      }
    }
    if (!tbl) return;
    tbl.style.display = edge ? 'block' : 'none';
    if (!edge) return;
    const T = box(-1.1, 2.1), key = `${V.w}x${V.h}@${ppm.toFixed(3)}`, wmm = V.w / ppm, hmm = V.h / ppm;
    if (key !== tblKey || !tblDrink){
      tblKey = key; tblDrink ??= drinkNow();
      tbl.innerHTML = tableSvg(wmm, hmm);
      tbl.querySelector('#tobjs').innerHTML = tableObjects(tblDrink, wmm, hmm).join('');
    }
    Object.assign(tbl.style, { left: `${T.l.toFixed(1)}px`, top: `${T.t.toFixed(1)}px`, width: `${(T.r - T.l).toFixed(1)}px`, height: `${(T.b - T.t).toFixed(1)}px` });
    if (tblDrink !== drinkNow() && !swapping) swapTable();      // the other drink's things come when the table is next seen, one by one
  }
  // The things on the table change one by one: the old ones leave outward, a little apart, then the new ones come in from outside. Only
  // while the table is on screen; the colour of its top and its grain change with the drink by their own fade (workbench.css).
  function swapTable(){
    const tbl = document.getElementById('tbl'), g = tbl?.querySelector('#tobjs'), to = drinkNow();
    if (!g || tblDrink === to) return;
    tblDrink = to;
    if (reduced()){ tblKey = ''; matMove(); return; }
    swapping = true;
    const V = { w: innerWidth, h: innerHeight }, ppm = MM * fitCam(geo, view, { scene: 'all' }).k, old = [...g.querySelectorAll('.tobj')];
    g.insertAdjacentHTML('beforeend', tableObjects(to, V.w / ppm, V.h / ppm).join(''));
    const fresh = [...g.querySelectorAll('.tobj')].filter(e => !old.includes(e)), ease = 'cubic-bezier(.3,.7,.3,1)';
    const away = e => `translate(${e.dataset.dx}px, ${e.dataset.dy}px)`;
    const gone = old.map((e, i) => e.animate([{ transform: 'none', opacity: 1 }, { transform: away(e), opacity: 0 }], { duration: 380, delay: i * 90, easing: ease, fill: 'forwards' }).finished);
    const t0 = old.length * 90 * .6;
    fresh.forEach((e, i) => e.animate([{ transform: away(e), opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 480, delay: t0 + 250 + i * 130, easing: ease, fill: 'backwards' }));
    Promise.all(gone).then(() => { old.forEach(e => e.parentNode.remove()); swapping = false; }).catch(() => { swapping = false; });
  }
  // ---- placing the sheet ----
  // the pages start to move: said once, as the ease starts (go) or the first step is put, so nothing on them glides against the camera (the plate, sheet.camMoving)
  function startMoving(){ if (!moving){ moving = true; document.dispatchEvent(new CustomEvent(PAGES_MOVING)); shed(true); } }
  function put(next){
    startMoving();
    cam = next; ui.cam = cam;
    host.style.left = '0px'; host.style.top = '0px';
    host.style.transform = `translate(${cam.x.toFixed(2)}px, ${cam.y.toFixed(2)}px) scale(${cam.k.toFixed(5)})`;
    ui.zoom = fit ? Math.round((cam.k / fit.k) * 1000) / 1000 : 1;
    follow();
    matMove();
    C.moved?.();
  }
  // which page is bright follows what is on screen; nothing is faded while all the pages are shown in full
  function follow(){
    if (!geo) return;
    const equal = geo.n > 1 && (scene === 'all' && !free || allShown(cam, geo, view));
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
    startMoving();
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
      moving = false; shed(false);
      const sig = `${cam.k.toFixed(3)}|${cam.x.toFixed(1)}|${cam.y.toFixed(1)}|${innerWidth}|${innerHeight}`;
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
    zoomAnchor = at;
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
    free = false; raw = null; zoomAnchor = centre();
    fit = fitOf({ scene, page });
    rememberView();
    go(fit);
  }

  // ---- writing: the view eases to the writing zoom around the block, and follows it from line to line ----
  // r is the block in the page's own pixels. keepZoom: already writing, so only pan to the next block. A page already at the writing
  // size or larger is not zoomed: the block is only kept in view. True when it zoomed in.
  function writeTo(r, percent, { keepZoom = false } = {}){
    if (!geo) return false;
    const ws = writingScale(geo, view, percent);
    if (!keepZoom && cam.k >= ws - 1e-3){ ensureVisible(r); return false; }
    const k = keepZoom ? cam.k : ws;
    const next = keepPageEdge(hardCam(centreOn(geo, view, k, r.left + r.width / 2, r.top + r.height / 2), geo, view), geo, view, r);
    free = true; want = null; rememberView();
    if (keepZoom && onLinux()){ stop(); put(next); settled(); return false; }      // the next line, already zoomed: software painting redraws the page for every step of a glide, so it is there at once
    go(next);
    return !keepZoom;
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
    if (e.target?.closest?.('#col, #switcher, #help, .actual')) return false;
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
      put({ ...cam, y: fit.y, x: raw > hi || raw < lo ? rubber(raw, lo, hi) : magnetize(raw, xs, dials.magnet) });
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
    put(softCam({ ...cam, ...rawFree }, geo, view));
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
    drag = { x: e.clientX, y: e.clientY, cam: { ...cam }, id: e.pointerId, bare: bare && e.button === 0, btn: e.button, moved: false };
    try { e.target?.setPointerCapture?.(e.pointerId); } catch { /* a forwarded event has no target to hold */ }      // the drag keeps its pointer where the page moves under it
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
    put(softCam({ ...drag.cam, x: drag.cam.x + e.clientX - drag.x, y: drag.cam.y + e.clientY - drag.y }, geo, view));
  }
  // the pointer is over a sheet (not the mat, the gap or the panel): `inPages` is false when something else (the panel) is on top
  const sheetOver = (x, y, inPages = true) => { if (geo) C.sheetOver?.(inPages && onPage(cam, geo, x, y), y, x); };
  function up(e){
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2){ pinch = null; go(hardCam(cam, geo, view), { spring: true }); }
    if (!drag) return;
    const was = drag; drag = null; document.body.classList.remove('is-handing'); C.sheet.setHand(false, space);
    if (was.moved) handedAt = performance.now();
    else if (was.bare) C.bareClick?.();
    else if (was.btn === 1) reset();      // the middle button, clicked: the whole resume (the same as 0)
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
  const typingIn = t => !!t?.closest?.('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, .ddbtn, [contenteditable=true], [contenteditable=plaintext-only]');
  function keydown(e){
    if (e.code === 'Space' && !typingIn(e.target) && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, select, textarea, button, a, summary, [contenteditable], [role=button], [role=checkbox], [tabindex]')){
      space = true; document.body.classList.add('is-space'); C.sheet.setHand(false, true); e.preventDefault();
    }
  }
  function keyup(e){ if (e.code === 'Space' && space){ space = false; document.body.classList.remove('is-space'); C.sheet.setHand(!!drag, false); } }

  function bind(){
    box.addEventListener('wheel', e => wheel(e), { passive: false });
    box.addEventListener('pointerdown', e => down(e));
    // while the hand is on the page the browser must not start its own drag: a selection, a dragged link or image, or the middle button's paste and scroll
    // (a native drag holds the pointer: the cursor freezes and the page does not follow)
    const handOn = e => e.button === 1 || space || !!drag;
    box.addEventListener('mousedown', e => { if (handOn(e)) e.preventDefault(); });
    box.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
    document.addEventListener('dragstart', e => { if (space || drag) e.preventDefault(); }, true);
    document.addEventListener('selectstart', e => { if (space || drag) e.preventDefault(); }, true);
    addEventListener('pointermove', e => { move(e); sheetOver(e.clientX, e.clientY, !!e.target.closest?.('#pages')); });
    document.documentElement.addEventListener('pointerleave', () => C.sheetOver?.(false));
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('keyup', keyup, true);
    addEventListener('blur', () => { space = false; document.body.classList.remove('is-space'); });
    for (const g of ['gesturestart', 'gesturechange', 'gestureend']) box.addEventListener(g, gesture);
    document.body.insertAdjacentHTML('beforeend', '<div id="tbl"></div><div id="mat"></div><div id="mruler"></div>');
    // the Linux desktop app turns a touchpad pinch into this call (phase 0 begin, 1 update, 2 end) instead of letting WebKit zoom the whole window
    window.__pinch = (phase, scale, x, y) => gesture({ type: ['gesturestart', 'gesturechange', 'gestureend'][Math.min(2, phase)], scale, clientX: x, clientY: y, preventDefault(){} });
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
    // where a rectangle of the page (its own pixels, from the sheet's corner) is on the screen
    matTransform(){ return matT; },
    screenRect(r){ return { left: cam.x + r.left * cam.k, top: cam.y + r.top * cam.k, width: r.width * cam.k, height: r.height * cam.k }; },
    put(next){ stop(); put(next); settled(); },
    // the sheet drawn somewhere for a moment (the preview of another resume's paper), nothing else told
    showOnly(next){ stop(); host.style.transform = `translate(${next.x.toFixed(2)}px, ${next.y.toFixed(2)}px) scale(${next.k.toFixed(5)})`; },
    go,
    limits: () => (geo ? limits(cam, geo, view) : null),
    stop,
  };
}
