// What ties the editor card to what is selected on the page: in Tea a string, in Coffee a plain line. It runs from the element's own right edge, at
// its first row (from the paper's edge, level with it, where other text stands to its right: two columns), to the card's punched hole (Tea) or the
// left end of its top row (Coffee). Tea's string hangs in a soft curve, its sag about 12% of the span (18 to 48 px), round the text of other lines
// where it can; a new selection glides its page end there (300 to 420 ms, ease-in-out) and the sag follows on a spring (17 rad/s, damping .7: one
// overshoot at most). Coffee's line always has two turns, 4 px corners and no spring. None at the map: it comes when something is selected.
// Zoomed far out (under 0.7 of the fit) nobody writes: the card fades to half (full under the pointer), the string is cut at its middle and both
// halves fall slack and fade; above 0.8 it is tied again. Drawn on events only (shell.js placeCard asks, on every draw and camera step); one frame
// loop runs while an end glides, the sag settles or the card glides, none at rest. Under reduced motion: no glide, no spring.
import { reduced } from './motion.js';
import { onDrinkChange, drink } from './drink.js';

const NS = 'http://www.w3.org/2000/svg';
const HOLE = 14;      // Tea's punched hole, from the card's top-left corner (sidebar.css draws it)
const K = 300, D = 2 * .7 * Math.sqrt(K);      // the sag's spring: 17 rad/s, damping .7

export function initString({ ui, sheet, canvas, selRect, leave }){
  const svg = document.createElementNS(NS, 'svg');
  svg.id = 'string'; svg.setAttribute('aria-hidden', 'true'); svg.style.display = 'none';
  svg.innerHTML = '<path/><path/><circle r="3"/>';
  document.body.append(svg);
  const [p1, p2] = svg.querySelectorAll('path'), knot = svg.querySelector('circle');
  // p: the ends as drawn; pt: where they belong; g: the page end's glide; c, v, t: the sag's control point, its speed, where it rests; d: 0 tied .. 1 cut
  const S = { on: false, p: [0, 0, 0, 0], pt: [0, 0, 0, 0], off: [0, 0], g: null, c: [0, 0], v: [0, 0], t: [0, 0], d: 0, dt: 0, k: 1, raf: 0, last: 0, key: '', geo: '', tx: [], pageR: 0 };
  let away = false, gliding = false;
  const tea = () => drink() === 'tea';
  const f = n => n.toFixed(1);

  const easeIO = x => (x < .5 ? 4 * x * x * x : 1 - Math.pow(2 - 2 * x, 3) / 2);
  const endsAt = now => { const e = S.g ? easeIO(Math.min(1, (now - S.g.t0) / S.g.dur)) : 1; return [S.pt[0] + S.off[0] * (1 - e), S.pt[1] + S.off[1] * (1 - e), S.pt[2], S.pt[3]]; };
  // Tea: two halves that meet at the middle; cut (d 1), each falls slack from its own end
  function drawString(){
    const [x0, y0, x1, y1] = S.p, [cx, cy] = S.c, d = S.d, mx = .25 * x0 + .5 * cx + .25 * x1, my = .25 * y0 + .5 * cy + .25 * y1;
    const e1 = [mx + (x0 + 6 - mx) * d, my + (y0 + 40 - my) * d], e2 = [mx + (x1 - 6 - mx) * d, my + (y1 + 40 - my) * d];
    const c1 = [(1 - d) * (x0 + cx) / 2 + d * (x0 + e1[0]) / 2, (1 - d) * (y0 + cy) / 2 + d * ((y0 + e1[1]) / 2 + 8)], c2 = [(1 - d) * (cx + x1) / 2 + d * (x1 + e2[0]) / 2, (1 - d) * (cy + y1) / 2 + d * ((y1 + e2[1]) / 2 + 8)];
    p1.setAttribute('d', `M${f(x0)} ${f(y0)}Q${f(c1[0])} ${f(c1[1])} ${f(e1[0])} ${f(e1[1])}`);
    p2.setAttribute('d', `M${f(e2[0])} ${f(e2[1])}Q${f(c2[0])} ${f(c2[1])} ${f(x1)} ${f(y1)}`);
    knot.setAttribute('cx', f(x0)); knot.setAttribute('cy', f(y0));
  }
  // Coffee: out at least 12 px, a jog of at least 16 px in the gap beside the paper, in at least 12 px; nearly level, the card's end goes 16 px lower
  function drawLine(){
    let [x0, y0, x1, y1] = S.p; if (Math.abs(y1 - y0) < 16) y1 = y0 + 16;
    const xm = Math.max(x0 + 12, Math.min(x1 - 12, (Math.max(S.pageR, x0) + x1) / 2)), r = 4, u = Math.sign(y1 - y0);
    p1.setAttribute('d', `M${f(x0)} ${f(y0)}H${f(xm - r)}Q${f(xm)} ${f(y0)} ${f(xm)} ${f(y0 + u * r)}V${f(y1 - u * r)}Q${f(xm)} ${f(y1)} ${f(xm + r)} ${f(y1)}H${f(x1)}`);
    p2.setAttribute('d', '');
  }
  const draw = () => (tea() ? drawString() : drawLine());
  // where the sag rests: below the chord's middle, deeper when slack, or arched over when text is in the way (the plain hang first, then the way it hung last, so it does not flick)
  function restOf(x0, y0, x1, y1){
    const c = Math.hypot(x1 - x0, y1 - y0), s = Math.min(48, Math.max(18, .12 * c)), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const lo = Math.min(x0, x1) - 2, hi = Math.max(x0, x1) + 2, top = Math.min(y0, y1) - 80, bot = Math.max(y0, y1) + 90;
    const tx = S.tx.filter(q => q.r > lo && q.l < hi && q.b > top && q.t < bot);
    const hits = cy => { let n = 0; for (let i = 1; i < 30; i++){ const u = i / 30, w = 1 - u, x = w * w * x0 + 2 * u * w * mx + u * u * x1, y = w * w * y0 + 2 * u * w * cy + u * u * y1; if (tx.some(q => x > q.l && x < q.r && y > q.t && y < q.b)) n++; } return n; };
    let best = null;
    for (const m of [1, S.k, 1.8, 2.8, .4, -.3, -.6, -1, -1.8, -3]){ const cy = my + 2 * s * m, n = tx.length ? hits(cy) : 0; if (!best || n < best.n) best = { n, cy, m }; if (!n) break; }
    S.k = best.m;
    return [mx, best.cy];
  }
  const settled = () => !S.g && Math.hypot(S.c[0] - S.t[0], S.c[1] - S.t[1]) < .2 && Math.hypot(S.v[0], S.v[1]) < 3 && S.d === S.dt;
  function frame(now){
    S.raf = 0;
    const dt = Math.min(.032, (now - S.last) / 1000); S.last = now;
    if (gliding) measure();      // the card glides (its margin, CSS): its end follows it
    if (S.g){ S.p = endsAt(now); if (now - S.g.t0 >= S.g.dur) S.g = null; if (tea()) S.t = restOf(...S.p); }
    for (let n = 0; n < 2; n++) for (let i = 0; i < 2; i++){ S.v[i] += (-K * (S.c[i] - S.t[i]) - D * S.v[i]) * dt / 2; S.c[i] += S.v[i] * dt / 2; }
    S.d = reduced() ? S.dt : S.d + Math.sign(S.dt - S.d) * Math.min(Math.abs(S.dt - S.d), dt / .3);
    if (settled()){ S.c = [...S.t]; S.v = [0, 0]; }
    draw();
    if (gliding || !settled()) S.raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!S.raf){ S.last = performance.now(); S.raf = requestAnimationFrame(frame); } };
  // pt: the ends where they belong now. A new selection glides the page end from where it is drawn; anything else (the camera, the card) pins it at once.
  function to(pt, fresh){
    const now = performance.now(), first = !S.on || reduced();
    if (first){ S.g = null; S.off = [0, 0]; }
    else if (fresh){ const dx = S.p[0] - pt[0], dy = S.p[1] - pt[1], dist = Math.hypot(dx, dy); S.off = [dx, dy]; S.g = dist > 3 ? { t0: now, dur: Math.min(420, 300 + dist / 4) } : null; }
    S.on = true; S.pt = pt; S.p = endsAt(now);
    if (tea()) S.t = restOf(...S.p);
    if (first){ S.c = [...S.t]; S.v = [0, 0]; }
    if (reduced()) S.d = S.dt;
    draw();
    if (!settled()) kick();
  }
  function hide(){
    if (svg.style.display === 'none') return;
    svg.style.display = 'none'; document.querySelector('#body')?.classList.remove('has-string');
    Object.assign(S, { on: false, key: '', geo: '', g: null }); cancelAnimationFrame(S.raf); S.raf = 0;
  }
  // zoomed far out: cut below 0.7, tied again above 0.8 (so it does not flicker); writing ends
  function zoomNow(){
    const z = ui.zoom ?? 1, was = away; away = z < .7 || (away && z <= .8);
    if (away === was) return;
    document.body.toggleAttribute('data-away', away);
    S.dt = away && tea() ? 1 : 0; S.geo = '';
    if (!away && tea()) S.v = [0, 260];      // tied again: it swings up and settles
    if (away && ui.writing) leave();
    if (S.on) kick();
  }
  // where the ends are now, from the selection's place on the screen and the card's
  function measure(){
    const body = document.querySelector('#body'), r = ui.sel.kind !== 'none' && body?.classList.contains('is-float') ? selRect() : null;
    if (!r){ hide(); return; }
    const card = body.getBoundingClientRect(), row = body.querySelector('.ctop')?.getBoundingClientRect(), vh = innerHeight;
    const scr = canvas.screenRect.bind(canvas);
    // the page's text on the screen (what the string goes round and what decides the latch), taken again only when the page or the camera has moved
    const cam = canvas.cam, tk = `${cam.x}|${cam.y}|${cam.k}|${sheet.textRects().length}`;
    if (S.tk !== tk){ S.tk = tk; S.tx = sheet.textRects().map(q => { const s = scr(q); return { l: s.left + 1, r: s.left + s.width - 1, t: s.top + 1, b: s.top + s.height - 1 }; }); }
    const rr = { l: r.left, r: r.left + r.width, t: r.top, b: r.top + r.height };
    const pg = sheet.pageBoxes().map(scr).find(b => rr.l >= b.left - 1 && rr.l <= b.left + b.width + 1) ?? null;
    S.pageR = pg ? pg.left + pg.width : rr.r;
    const beside = S.tx.some(q => q.l > rr.r + 2 && q.b > rr.t + 1 && q.t < rr.b - 1);      // two columns: the paper's edge, level with it
    const first = S.tx.filter(q => q.l >= rr.l - 2 && q.r <= rr.r + 2 && q.t >= rr.t - 2 && q.b <= rr.b + 2).sort((a, b) => a.t - b.t)[0];
    const lo = Math.max(rr.t, 8), hi = Math.min(rr.b, vh - 8), at = first ? (first.t + first.b) / 2 : (lo + hi) / 2;
    const x1 = card.left + (tea() ? HOLE : 0), y1 = tea() ? card.top + HOLE : row ? row.top + row.height / 2 : card.top + 22;
    const x0 = Math.min(Math.max(beside ? S.pageR : rr.r, 4), x1 - (tea() ? 8 : 24)), y0 = hi < lo ? (rr.b < 8 ? 8 : vh - 8) : Math.min(Math.max(at, lo), hi);
    const key = `${ui.sel.kind}:${ui.sel.id}`, geo = [x0, y0, x1, y1].map(v => Math.round(v * 2)).join('|') + `|${key}|${drink()}|${innerWidth}`;
    if (svg.style.display === 'none'){ svg.style.display = ''; body.classList.add('has-string'); }
    if (geo === S.geo) return;
    S.geo = geo;
    const fresh = key !== S.key; S.key = key;
    to([x0, y0, x1, y1], fresh);
  }
  function update(){ zoomNow(); measure(); }
  // the card's own glide (a CSS transition of its margin): the card end follows it, frame by frame, only while it runs
  const card = () => document.querySelector('#body');
  document.addEventListener('transitionrun', e => { if (e.target === card() && e.propertyName === 'margin-top' && S.on){ gliding = true; kick(); } });
  for (const ev of ['transitionend', 'transitioncancel']) document.addEventListener(ev, e => { if (e.target === card() && e.propertyName === 'margin-top'){ gliding = false; measure(); } });
  // a drink change redraws it at once, in the new drink's form
  onDrinkChange(() => { S.on = false; S.g = null; cancelAnimationFrame(S.raf); S.raf = 0; S.d = S.dt = away && tea() ? 1 : 0; S.geo = ''; requestAnimationFrame(update); });
  return { update, get state(){ return { on: S.on, away, d: S.d, p: [...S.p], raf: !!S.raf }; } };
}
