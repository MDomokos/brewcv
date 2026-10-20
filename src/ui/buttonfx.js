// How the start screen's three ways in feel (Intro Lab v19, E2). Drawn by src/ui/start.js and src/ui/intro-side.css; this file only moves them.
//   - the lean: each button leans up to FX.tilt degrees toward the pointer, lifts a little, slides toward it and moves its flat shadow away from it;
//     pressing flattens it and sinks it. A touch has no hover, so it leans while it is pressed and only then.
//   - the string (Tea only): the primary is a tag, and its string is a simulated rope. Its far end is tied under the picture's board (36px inside the board's
//     right edge, out of sight, and it never moves); its near end is the tag's hole, read from the tag's own transform on every frame, so a lift, a lean, a slide
//     and a press all move it. The rope is drawn in a layer that sits between the straw and the board (#obrope), so it runs under the board's edge with no loose
//     end; its last stretch is drawn again over the tag (.obstr), so it is threaded through the hole.
// Nothing runs unless something moves: the frame loop stops when every button is still and the rope has settled. Under reduced motion (src/ui/motion.js) the
// buttons stay flat and the string is drawn at rest.

import { reduced, onMotionChange } from './motion.js';

// the knobs: the lean (deg), the slide and the lift (px), how fast a button follows the pointer (per frame), the perspective (px); the string's slack (px
// longer than the straight distance), the lag of its swing (higher swings and settles later), its weight, and how often it is straightened in a frame
export const FX = { tilt: 4, pan: 7, lift: 3, ease: .2, persp: 640, slack: 9, damp: .88, grav: .5, iter: 8 };
const HOLE_FROM_EDGE = 36, ANCHOR_DROP = 14, POINTS = 14;
const REST = { rx: 0, ry: 0, tx: 0, ty: 0, dx: 0, dy: 0, br: 1 };
const clamp = v => Math.max(-1, Math.min(1, v));

// ---- the lean ----
const live = new Set();              // the buttons that are moving, or about to
let raf = 0;
const kick = () => { raf ||= requestAnimationFrame(tick); };
function tick(){
  raf = 0;
  let go = false;
  for (const b of live) if (b.step()) go = true;
  if (rope?.step()) go = true;
  if (go) kick();
}

class Btn {
  constructor(w){ this.w = w; this.mv = w.querySelector('.obmv'); this.cur = { ...REST }; this.tg = { ...REST }; this.hover = this.press = this.touch = false; this.px = this.py = 0; }
  track(e){
    const r = this.w.getBoundingClientRect();
    this.px = clamp(((e.clientX - r.left) / r.width) * 2 - 1); this.py = clamp(((e.clientY - r.top) / r.height) * 2 - 1);
  }
  // where it should be now: leaning toward the pointer, pressed flat, or at rest
  aim(){
    const { hover, press, touch, px, py } = this, T = FX.tilt;
    this.w.classList.toggle('pressed', press);        // the Coffee stamp's inner rule thickens, motion or not
    if (reduced()){ this.clear(); return; }
    if (press) this.tg = { rx: touch ? -py * T * .7 : 0, ry: touch ? px * T * .7 : 0, tx: 1, ty: 2.5, dx: -2.2, dy: -3, br: 1 };
    else if (hover) this.tg = { rx: -py * T, ry: px * T, tx: px * FX.pan, ty: py * FX.pan * .5 - FX.lift, dx: 1 - px * 1.2, dy: 1.4 - py * 1.2, br: 1.05 };
    else this.tg = { ...REST };
    live.add(this); kick();
  }
  clear(){
    this.mv.style.transform = ''; for (const p of ['--dx', '--dy', '--br']) this.mv.style.removeProperty(p);
    this.cur = { ...REST }; this.tg = { ...REST }; live.delete(this);
  }
  step(){
    const c = this.cur, t = this.tg;
    let moving = false;
    for (const k in c){ const d = t[k] - c[k]; if (Math.abs(d) > .002){ c[k] += d * FX.ease; moving = true; } else c[k] = t[k]; }
    if (!moving && !this.hover && !this.press){ this.clear(); return false; }          // back at rest: no transform left to blur the text
    this.mv.style.transform = `perspective(${FX.persp}px) translate3d(${c.tx.toFixed(2)}px, ${c.ty.toFixed(2)}px, 0) rotateX(${c.rx.toFixed(2)}deg) rotateY(${c.ry.toFixed(2)}deg)`;
    this.mv.style.setProperty('--dx', `${c.dx.toFixed(2)}px`); this.mv.style.setProperty('--dy', `${c.dy.toFixed(2)}px`); this.mv.style.setProperty('--br', c.br.toFixed(3));
    return moving;
  }
}

// ---- the string ----
// Where it disappears under: the picture's board once there is one, else a little left of the column.
function boardEdge(){
  const b = document.getElementById('ss')?.getBoundingClientRect();
  return b?.width ? b.right : document.getElementById('col').getBoundingClientRect().left - 16;
}

class Rope {
  constructor(){
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.id = 'obrope'; svg.setAttribute('class', 'obrope'); svg.setAttribute('aria-hidden', 'true');
    this.path = svg.appendChild(document.createElementNS(NS, 'path'));
    document.body.append(svg);
    this.pts = []; this.rest = null; this.w = null;
  }
  bind(w){
    this.w = w; this.mv = w.querySelector('.obmv'); this.front = w.querySelector('.obstr'); this.fpath = this.front.querySelector('path');
    this.pts = []; this.rest = null;
  }
  // false when there is no string to draw: Coffee, a phone (the CSS shows no .obstr there), or no tag
  visible(){ return !!this.w?.isConnected && this.front.getClientRects().length > 0; }
  show(on){ this.path.style.display = on ? '' : 'none'; }
  geo(){
    const wr = this.w.getBoundingClientRect(), H = this.mv.offsetHeight;
    if (!wr.width) return false;
    Object.assign(this, { wr, W: this.mv.offsetWidth, H, fr: this.front.getBoundingClientRect() });
    this.hx = parseFloat(getComputedStyle(this.w).getPropertyValue('--d')) + 4;   // the hole: the notch's depth and half the hole's width, from the tag's left edge
    this.H0 = [wr.left + this.hx, wr.top + H / 2];                              // the hole at rest
    this.A = [boardEdge() - HOLE_FROM_EDGE, wr.top + H / 2 + ANCHOR_DROP];      // where it is tied
    return true;
  }
  // the hole now: its place at rest carried through the tag's transform
  hole(){
    const t = getComputedStyle(this.mv).transform, m = t === 'none' ? new DOMMatrix() : new DOMMatrix(t), P = m.transformPoint(new DOMPoint(this.hx - this.W / 2, 0, 0));
    return [this.wr.left + this.W / 2 + P.x / P.w, this.wr.top + this.H / 2 + P.y / P.w];
  }
  setup(){
    const [ax, ay] = this.A, [hx, hy] = this.H0;
    this.pts = Array.from({ length: POINTS }, (_, i) => { const t = i / (POINTS - 1), x = ax + (hx - ax) * t, y = ay + (hy - ay) * t + Math.sin(Math.PI * t) * 10; return { x, y, px: x, py: y }; });
  }
  // one frame of a rope under gravity and damping (verlet) whose segments keep their length, a little more than the straight distance in all; returns how much it moved
  sim(H, damp, grav, iter){
    const p = this.pts, n = p.length, seg = (Math.hypot(this.H0[0] - this.A[0], this.H0[1] - this.A[1]) + FX.slack) / (n - 1);
    Object.assign(p[n - 1], { x: H[0], y: H[1], px: H[0], py: H[1] }); Object.assign(p[0], { x: this.A[0], y: this.A[1], px: this.A[0], py: this.A[1] });
    let en = 0;
    for (let i = 1; i < n - 1; i++){ const a = p[i], vx = (a.x - a.px) * damp, vy = (a.y - a.py) * damp; a.px = a.x; a.py = a.y; a.x += vx; a.y += vy + grav; en += Math.abs(vx) + Math.abs(vy); }
    for (let k = 0; k < iter; k++) for (let i = 0; i < n - 1; i++){
      const a = p[i], b = p[i + 1], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6, f = (d - seg) / d, pinA = i === 0, pinB = i + 1 === n - 1;
      if (pinA){ b.x -= dx * f; b.y -= dy * f; } else if (pinB){ a.x += dx * f; a.y += dy * f; } else { a.x += dx * f / 2; a.y += dy * f / 2; b.x -= dx * f / 2; b.y -= dy * f / 2; }
    }
    return en;
  }
  // the rope's rest shape for the tag where it is, found by running it until it stops (no animation)
  settle(){
    if (!this.pts.length) this.setup();
    const H = this.hole();
    for (let i = 0; i < 300; i++) this.sim(H, .6, .5, 8);
    this.rest = this.pts.map(({ x, y }) => ({ x, y }));
    this.draw(this.pts);
  }
  // a smooth curve through the points, in the coordinates of the svg it is drawn in
  curve(pts, ox, oy){
    const f = v => v.toFixed(1), n = pts.length;
    let d = `M${f(pts[0].x - ox)} ${f(pts[0].y - oy)}`;
    for (let i = 1; i < n - 1; i++) d += `Q${f(pts[i].x - ox)} ${f(pts[i].y - oy)} ${f((pts[i].x + pts[i + 1].x) / 2 - ox)} ${f((pts[i].y + pts[i + 1].y) / 2 - oy)}`;
    return `${d}L${f(pts[n - 1].x - ox)} ${f(pts[n - 1].y - oy)}`;
  }
  draw(pts){
    this.path.setAttribute('d', this.curve(pts, 0, 0));          // the layer is fixed at the window's corner: client pixels
    this.fpath.setAttribute('d', this.curve(pts, this.fr.left, this.fr.top));
  }
  step(){
    if (!this.visible()) return false;
    if (reduced()){ if (!this.rest) this.settle(); this.draw(this.rest); return false; }
    const en = this.sim(this.hole(), FX.damp, FX.grav, FX.iter);
    this.draw(this.pts);
    return en > .03;
  }
}
let rope = null;

// ---- starting up ----
const states = new WeakMap();
const btn = el => {
  const w = el?.closest?.('.obw');
  if (!w) return null;
  if (!states.has(w)) states.set(w, new Btn(w));
  return states.get(w);
};

let started = false;
export function initButtonFx(){
  if (started) return;
  started = true;
  // the buttons are drawn again from time to time (the language, the drink), so the events are on the document
  document.addEventListener('pointerover', e => { const b = btn(e.target); if (b && e.pointerType !== 'touch' && !b.w.contains(e.relatedTarget)){ b.hover = true; b.track(e); b.aim(); } });
  document.addEventListener('pointermove', e => { const b = btn(e.target); if (b && (b.hover || b.press)){ b.track(e); b.aim(); } });
  document.addEventListener('pointerout', e => { const b = btn(e.target); if (b && !b.w.contains(e.relatedTarget)){ b.hover = false; b.aim(); } });
  document.addEventListener('pointerdown', e => { const b = btn(e.target); if (b){ b.press = true; b.touch = e.pointerType === 'touch'; b.track(e); b.aim(); } });
  const release = e => document.querySelectorAll('.obw.pressed').forEach(w => { const b = states.get(w); b.press = false; if (e.pointerType === 'touch') b.hover = false; b.aim(); });
  document.addEventListener('pointerup', release); document.addEventListener('pointercancel', release);
  document.getElementById('col')?.addEventListener('scroll', refresh, { passive: true });
  onMotionChange(() => { document.querySelectorAll('.obw').forEach(w => states.get(w)?.aim()); refresh(); });
  refresh();
}

// the layout changed (a part was drawn again, the window or the board moved, the drink changed): find the tag and its string again, and settle it
export function refresh(){
  rope ??= new Rope();
  const w = document.querySelector('.obw.p');
  if (w && w !== rope.w) rope.bind(w);
  if (!w || !rope.visible() || !rope.geo()){ rope.show(false); return; }
  rope.show(true);
  rope.settle();
}
