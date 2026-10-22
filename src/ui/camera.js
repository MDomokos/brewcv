// The camera: where the pages sit on the canvas and what the view does with a wheel, a drag or a pinch.
// Pure: numbers in, numbers out (checks/camera-check.mjs). src/ui/canvas.js moves the sheet with it.
//
// Content coordinates are the pages' own pixels: page i runs from i * (w + PAGE_GAP) across, 0 to h down.
// A camera { k, x, y } puts content (cx, cy) at the screen point (x + cx * k, y + cy * k).
// A view is the rectangle of the window the pages may use: left of the sidebar.

import { pageSize, PAGE_GAP, G } from './layout.js';

export const FADE = 0.35;             // the page that is not bright
export const OVERSHOOT = 60;          // how far a pan may be pulled past its limit, at most (px)
export const MAGNET = 35, BOUNCE = 8; // defaults: round 3 found 60 and 25 too strong
export const SNAP_FIT = 0.05;         // a zoom within this of the fit view snaps to it
export const KEEP_Y = 0.9;            // up and down, where a page runs the whole height: it never goes far off

export const rowWidth = (w, n) => n * w + Math.max(0, n - 1) * PAGE_GAP;
export const pageLeft = (geo, i) => i * (geo.w + PAGE_GAP);

// What the window and the pages allow, before anything is panned or zoomed. Whether both pages show at once is computeLayout's.
export function geometry({ vw, vh, format, pages = 1 }){
  const { w, h } = pageSize(format);
  const n = Math.max(1, pages);
  return { w, h, n, tall: (vh - 2 * G) / h };
}

// The part of the window the pages may use. `colLeft` is the left edge of the tabs. `mid` is the x the pages are centred on, and
// `fitW` the width a fitted page may have (the room beside the sidebar): computeLayout (layout.js) gives both.
export const viewRect = ({ vh, colLeft, mid, fitW }) => ({ left: 0, top: 0, width: Math.max(1, colLeft - G), height: vh, mid: mid ?? colLeft / 2, fitW });
export const midX = view => view.mid ?? view.left + view.width / 2;

// A camera that shows `scene` whole: 'all' pages, or the one page `page`, fit to the height and centred in the view.
export function fitCam(geo, view, { scene = 'all', page = 0 } = {}){
  const all = scene === 'all' && geo.n > 1;
  const span = all ? rowWidth(geo.w, geo.n) : geo.w;
  const k = Math.max(0.1, Math.min((view.height - 2 * G) / geo.h, ((view.fitW ?? view.width) - 2 * G) / span));
  const left = all ? 0 : pageLeft(geo, Math.max(0, Math.min(geo.n - 1, page)));
  return { k, x: midX(view) - span * k / 2 - left * k, y: view.top + (view.height - geo.h * k) / 2 };
}

export const screenOf = (cam, cx, cy) => ({ x: cam.x + cx * cam.k, y: cam.y + cy * cam.k });
export const contentOf = (cam, sx, sy) => ({ x: (sx - cam.x) / cam.k, y: (sy - cam.y) / cam.k });

// Zoom to scale k2 keeping the content under the screen point (px, py) where it is.
export function zoomAbout(cam, k2, px, py){
  const f = k2 / cam.k;
  return { k: k2, x: px - (px - cam.x) * f, y: py - (py - cam.y) * f };
}

// A zoom close to the fit view is the fit view. zoom is relative: 1 is the fit scale.
export const snapZoom = z => (Math.abs(z - 1) < SNAP_FIT ? 1 : z);

// Where x and y may go. Sideways: pages that fit the view (with the margin G each side) stay centred on its middle and cannot be panned;
// zoomed in, they may go until an edge is G in from the view's edge, never further. Up and down: never so far that less than
// nine tenths of the view (or the whole page, if that is less) keeps part of the pages.
export function limits(cam, geo, view){
  const W = rowWidth(geo.w, geo.n) * cam.k, H = geo.h * cam.k;
  const ky = Math.min(view.height * KEEP_Y, H);
  const c = midX(view) - W / 2, lo = view.left + view.width - G - W, hi = view.left + G;
  const fits = lo >= hi;
  return { minX: fits ? c : Math.min(lo, c), maxX: fits ? c : Math.max(hi, c), minY: view.top + ky - H, maxY: view.top + view.height - ky };
}
// A value pulled past its limit: it follows at first, then gets heavier, and stops about `max` px past.
export function rubber(v, lo, hi, max = OVERSHOOT){
  if (v > hi){ const o = v - hi; return hi + (max * o) / (o + max); }
  if (v < lo){ const o = lo - v; return lo - (max * o) / (o + max); }
  return v;
}
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const softCam = (cam, geo, view, max = OVERSHOOT) => {
  const L = limits(cam, geo, view);
  return { ...cam, x: L.minX === L.maxX ? L.minX : rubber(cam.x, L.minX, L.maxX, max), y: rubber(cam.y, L.minY, L.maxY, max) };
};
export const hardCam = (cam, geo, view) => {
  const L = limits(cam, geo, view);
  return { ...cam, x: clamp(cam.x, L.minX, L.maxX), y: clamp(cam.y, L.minY, L.maxY) };
};

// The x each page sits at when it is centred in the view at scale k: the places the wheel snaps between.
export const stops = (geo, view, k) => Array.from({ length: geo.n }, (_, i) => midX(view) - geo.w * k / 2 - pageLeft(geo, i) * k);

// Travel between pages with a magnetic feel: resistance near each page, a quick move across. `raw` is where the pointer
// has taken the camera; the result is where it is drawn. The stops run from the largest x (page 1) down.
export function magnetize(raw, xs, magnet = MAGNET){
  if (xs.length < 2) return raw;
  const m = clamp(magnet / 100, 0, 0.95);
  if (raw >= xs[0] || raw <= xs[xs.length - 1]) return raw;
  for (let i = 0; i < xs.length - 1; i++){
    const a = xs[i], b = xs[i + 1];
    if (raw <= a && raw >= b){
      const t = (a - raw) / (a - b);
      return a - (a - b) * (t - (m * Math.sin(2 * Math.PI * t)) / (2 * Math.PI));
    }
  }
  return raw;
}
// The inverse, so a drawn position goes back to the pointer's: bisection, since the curve is monotonic.
export function unmagnetize(shown, xs, magnet = MAGNET){
  if (xs.length < 2 || shown >= xs[0] || shown <= xs[xs.length - 1]) return shown;
  let lo = xs[xs.length - 1], hi = xs[0];
  for (let i = 0; i < 40; i++){ const mid = (lo + hi) / 2; if (magnetize(mid, xs, magnet) < shown) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// Which stop a camera at x settles to: the nearest, unless it was moving fast enough (px per second) to carry on.
export function settleIndex(x, xs, velocity = 0){
  let at = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[at] - x)) at = i;
  if (Math.abs(velocity) > 400) at = clamp(at + (velocity < 0 ? 1 : -1), 0, xs.length - 1);
  return at;
}

// ---- which page is bright ----
// The share of page i that is inside the view.
export function visible(cam, geo, view, i){
  const x0 = cam.x + pageLeft(geo, i) * cam.k, y0 = cam.y, x1 = x0 + geo.w * cam.k, y1 = y0 + geo.h * cam.k;
  const w = Math.min(x1, view.left + view.width) - Math.max(x0, view.left), h = Math.min(y1, view.top + view.height) - Math.max(y0, view.top);
  return w > 0 && h > 0 ? (w * h) / ((x1 - x0) * (y1 - y0)) : 0;
}
// Whether the window point (x, y) is on a sheet: the white page itself, not the mat, the gap between pages or the panel.
export function onPage(cam, geo, x, y){
  const cx = (x - cam.x) / cam.k, cy = (y - cam.y) / cam.k;
  return cy >= 0 && cy <= geo.h && Array.from({ length: geo.n }, (_, i) => pageLeft(geo, i)).some(l => cx >= l && cx <= l + geo.w);
}
// The page that is more in view than the others is the bright page. A tie (both pages cropped alike by a writing zoom, which differ only by
// rounding) keeps the current one.
export function brightPage(cam, geo, view, current){
  const fr = Array.from({ length: geo.n }, (_, i) => visible(cam, geo, view, i));
  let best = Math.max(0, Math.min(geo.n - 1, current));
  for (let i = 0; i < geo.n; i++) if (fr[i] > fr[best] + 1e-3) best = i;
  return best;
}
// Every page is wholly in view (zoomed out to see them all): none is faded.
export const allShown = (cam, geo, view) => Array.from({ length: geo.n }, (_, i) => visible(cam, geo, view, i)).every(v => v > 0.98);
// Nothing is faded while all the pages are shown equal; otherwise only the bright page is.
export const faded = (geo, bright, equal) => Array.from({ length: geo.n }, (_, i) => !equal && i !== bright);

// ---- a spring, for travel and for coming to rest ----
// Damping ratio for an overshoot of `bounce` percent of the move (0 is critically damped).
export function damping(bounce){
  const b = clamp(bounce, 0, 60) / 100;
  if (b <= 0) return 1;
  const l = Math.log(b);
  return -l / Math.sqrt(Math.PI * Math.PI + l * l);
}
// One step of a spring toward `to`. state { v, x }; omega is the natural frequency in rad/s. Substepped so it stays stable.
export function springStep(s, to, dt, { omega = 22, bounce = BOUNCE } = {}){
  const z = damping(bounce), n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
  let { x, v } = s;
  for (let i = 0; i < n; i++){ v += (-omega * omega * (x - to) - 2 * z * omega * v) * h; x += v * h; }
  return { x, v };
}
export const atRest = (s, to, eps = 0.15) => Math.abs(s.x - to) < eps && Math.abs(s.v) < eps * 4;

// ---- zoom while writing ----
// A camera at `k` with content point (cx, cy) in the middle of the view.
export function centreOn(geo, view, k, cx, cy){
  return { k, x: midX(view) - cx * k, y: view.top + view.height / 2 - cy * k };
}
// The scale of the fit-to-height view of one page, times a zoom given in percent (130 is the default for writing).
export const writingScale = (geo, view, percent) => fitCam(geo, view, { scene: 'one' }).k * (percent / 100);
// While writing, the page's left edge (and the section tabs hung beside it) stays in the view, as far as the line can stay in view
// with it: `r` is the line in content coordinates, `room` is how far (px) the line keeps from the view's right edge.
export function keepPageEdge(cam, geo, view, r, room = 70){
  const page = Math.max(0, Math.min(geo.n - 1, Math.floor((r.left + r.width / 2) / (geo.w + PAGE_GAP))));
  const dx = Math.min(view.left + G - (cam.x + pageLeft(geo, page) * cam.k), view.left + view.width - room - (cam.x + (r.left + r.width) * cam.k));
  return dx > 0 ? { ...cam, x: cam.x + dx } : cam;
}
