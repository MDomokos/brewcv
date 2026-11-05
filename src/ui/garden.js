// The tea garden: while you rest, the bamboo mat comes alive. Loaded by shell.js only when it can run (tea, the setting on,
// motion not reduced, not a phone, not the start screen); setOn(false) rests it (coffee, the start screen), and what lay there
// is still there when it is on again. Everything it draws is in #garden (aria-hidden, no pointer events, under the sidebar's cards);
// src/ui/garden.css has the shapes. Nothing in it reaches the resume: it is drawn on the app, never in the page's frame.
//  - It starts clean. The first rest (30 s without input; input on the page counts) brings a wave of leaves.
//  - Moments come every 25-40 s while resting: common ones dealt like a shuffled deck, rare ones (the butterfly by day, fireflies
//    at night) about one time in seven. The snail comes only after a shower, onto the wet mat. After ten idle periods (5 min) everything is still until any input.
//  - Leaves and petals land where they come down, on the mat or on the page, across the whole window, and may overlap a little,
//    as real ones do: a falling leaf steers toward a free spot early in its fall, and once it lies still only the pointer, a gust
//    or a puff moves it, never another leaf. Settled ones fade into the mat while you work. A leaf the pointer bumps lifts,
//    tumbles on a curving path and tilts as it goes (it foreshortens, its shadow with it), settling as the push dies.
//  - Return: moving the mouse back clears nothing on the page. A click into a page or a key press is a puff of air: from the click,
//    or from the line being typed in. Its front spreads from there (the near leaves go first, the far ones on a softer breeze just
//    after), and every leaf on that page lifts, leaves along the push, curves to its own page's edge on the side it lies from the
//    puff (about straight above or below: the nearer edge) and comes down on the mat beyond it, farther the stronger the puff. It
//    never crosses another page: a gap between pages is mat only if the leaf comes down clear of both. The page's wet spots dry,
//    and it stays clear: when the pages move (the canvas fires PAGES_MOVED) it is cleared again, by the nearest edges.
//  - A click on the mat is play: a small puff scatters the leaves near it and startles the creatures, and does not end a rest.
//  - A page that starts to move (PAGES_MOVING) clears what lies on it the same way, with a puff from a zoom's anchor (a pan has
//    none: the nearest edges), and what lies on it or blows off it moves with it, frame for frame (#gpage follows the camera on
//    PAGES_STEP), until it rests and they are back on the mat. While it moves (body.is-moving) the rest of the garden sits under
//    it, so it covers whatever lies on the mat; no wet spot lands on it.
//  - Everything is drawn at a size in the page's millimetres (the canvas says how many of #gworld's px that is), so it keeps its
//    size against the page on any screen: a ladybug 7 mm, a snail 20 mm, a butterfly 28 mm across, a leaf 12 to 17 mm.
//  - Whatever comes or goes does it wholly off the screen, its shadow too (off, view): nothing pops in or out at an edge.
//  - One requestAnimationFrame loop, only while something moves; drops, splashes, wet spots, the snail's trail, the dappled
//    shade and the fireflies are animated in CSS. The pages' geometry is read when the canvas says they moved.
//  - A ladybug the pointer startles opens its wing cases, lifts and flies off the nearest side with a wobble; one sent away by
//    your return only walks out. Rain is the rarest common moment: dealt with a chance of being skipped, and light.

import { PAGES_MOVED, PAGES_MOVING, PAGES_STEP } from './canvas.js';
import { pageLeft } from './camera.js';
import { reduced } from './motion.js';

const css = document.createElement('link');
css.rel = 'stylesheet'; css.href = new URL('./garden.css', import.meta.url).href;
document.head.append(css);

const root = document.documentElement;
const still = () => reduced();
const night = () => root.dataset.theme === 'dark';
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
// mostly greens, a few yellowing, the odd ochre
const LEAF = ['#4f6b3c', '#5d7d43', '#6f8f4e', '#4a6638', '#5d7d43', '#7f9a46', '#a9a43a', '#c49a3a'];
const LEAF_NIGHT = ['#7d9a5a', '#a9c77f', '#8fae5a', '#6f8f4e', '#b6c46a', '#c9a86a'];
const PETAL = ['#f4c3cf', '#f7d3dc', '#efb3c2', '#fbe3e8'];
// the tea leaf, and now and then a rounder camellia leaf (width for a length of 1)
const SHAPES = { s1: .47, s2: .65 };
const CAP = 14;
// the snail's shell, seen a little from the side: stacked whorls (class m) that garden.js moves toward the light as it turns
const SHELL = '<svg class="shell" viewBox="0 0 18 15"><defs><radialGradient id="g-shellg" cx=".34" cy=".3" r=".8"><stop offset="0" stop-color="#f4cf92"/><stop offset=".5" stop-color="#d4964f"/>'
  + '<stop offset=".9" stop-color="#a0612a"/><stop offset="1" stop-color="#764217"/></radialGradient></defs><g stroke="#6a3c15" fill="url(#g-shellg)">'
  + '<ellipse cx="9" cy="7.8" rx="8.6" ry="6.9" stroke-width=".6"/><ellipse class="m" rx="7.1" ry="5.6" fill="none" stroke="#5a3212" stroke-opacity=".45" stroke-width=".9"/>'
  + '<ellipse class="m" rx="5.4" ry="4.4" stroke-width=".55"/><ellipse class="m" rx="3.1" ry="2.6" stroke-width=".5"/><ellipse class="m" rx="1.2" ry="1" fill="#f6d9a6" stroke-width=".4"/></g>'
  + '<ellipse class="m" rx="2" ry="1.1" fill="#fff" fill-opacity=".45"/></svg>';
const SHAPE = { leaf: 'g-leaf', petal: 'g-petal' };

export function initGarden({ ui, canvas, idle = 30, check = false }){
  let active = false;
  const box = document.createElement('div');
  box.id = 'garden'; box.hidden = true; box.setAttribute('aria-hidden', 'true');
  const dappleEl = document.createElement('div');
  dappleEl.className = 'g-dapple'; dappleEl.hidden = true; dappleEl.setAttribute('aria-hidden', 'true');
  const rainSky = document.createElement('div');
  rainSky.className = 'g-rainsky';
  // everything that lies on the mat is in #gworld, in the mat's own pixels, and scales with the table when the view zooms (canvas.js matMove)
  const world = document.createElement('div');
  world.id = 'gworld';
  // while the pages move, what lies on them is in #gpage, which follows the camera from where the move began (held)
  const sheetLayer = document.createElement('div');
  sheetLayer.id = 'gpage';
  box.append(rainSky, world, sheetLayer);
  document.body.append(dappleEl, box);
  const T = () => canvas.matTransform?.() ?? { ox: 0, oy: 0, s: 1 };
  const toMat = (x, y) => { const m = T(); return { x: (x - m.ox) / m.s, y: (y - m.oy) / m.s }; };
  // sizes are real, in millimetres of the page; speeds and reaches scale by u, 1 where they were tuned (a 1280 by 800 window)
  const mm = v => v * (T().ppm ?? 2.83), u = () => mm(1) / 2.83;
  // what the screen shows of #gworld; SH: a shadow's farthest offset and blur at full height
  const view = () => { const m = T(); return { l: -m.ox / m.s, t: -m.oy / m.s, r: Math.min(panel, (innerWidth - m.ox) / m.s), b: (innerHeight - m.oy) / m.s }; };
  const SH = 30, reach = t => Math.max(t.w, t.h) * (t.k ?? 1) / 2 + SH;
  // top: false for what falls in from above, which is off the screen until it comes into view
  const off = (t, top = true) => { const v = view(), r = reach(t), cx = t.x + t.w / 2, cy = t.y + t.h / 2; return cx + r < v.l || cx - r > v.r || (top && cy + r < v.t) || cy - r > v.b; };

  // ---- the pages, the margins: read when the canvas says the pages moved ----
  let pg = [], span = null, panel = innerWidth, held = null;
  const refreshGeo = () => {
    if (held) return;      // what is held is in the pages' frame from the start of the move: the geometry stays that frame's too
    const g = ui.geo;
    const m = T();
    // the garden's right edge is the window's: the sidebar is see-through in places, so the mat under it is part of the scene
    panel = (innerWidth - m.ox) / m.s;
    pg = !g || !ui.cam ? [] : Array.from({ length: g.n }, (_, i) => canvas.screenRect({ left: pageLeft(g, i), top: 0, width: g.w, height: g.h }))
      .map(r => ({ left: (r.left - m.ox) / m.s, right: (r.left + r.width - m.ox) / m.s, top: (r.top - m.oy) / m.s, bottom: (r.top + r.height - m.oy) / m.s })).filter(r => r.right > 0 && r.left < panel && r.right - r.left > 50);
    // pages side by side clear as one block: a leaf blown off one must not land on the next
    span = pg.length ? { left: Math.min(...pg.map(r => r.left)), right: Math.max(...pg.map(r => r.right)), top: Math.min(...pg.map(r => r.top)), bottom: Math.max(...pg.map(r => r.bottom)) } : null;
  };
  const onPage = (x, y) => pg.some(r => x > r.left && x < r.right && y > r.top && y < r.bottom);
  const zones = () => {
    if (!pg.length) return [];
    // the margins as far as the screen shows them (zoomed in, part of the mat is off it: a margin there is not one)
    const pageL = span.left, pageR = span.right, v = view(), right = v.r - 12, z = [];
    if (pageL - v.l > 80) z.push([v.l + 14, pageL - 34, 'L']);
    if (right - pageR > 80) z.push([pageR + 16, right - 34, 'R']);
    return z;
  };
  const restY = x => { let y = rnd(90, innerHeight - 90); if (x < 150 && y > innerHeight - 180) y = rnd(90, innerHeight - 200); return y; };

  // ---- things, each with its own shadow ----
  const things = [];
  const div = cls => { const el = document.createElement('div'); el.className = cls; el.setAttribute('aria-hidden', 'true'); world.append(el); return el; };
  const make = (kind, extra = '', color) => {
    const el = div(`g-thing ${SHAPE[kind] ?? `g-${kind}`} ${extra}`.trim());
    if (color) el.style.setProperty('--c', color);
    const sh = kind === 'glow' ? null : div(`g-shade ${SHAPE[kind] ? `${SHAPE[kind]} ${extra}` : `g-shade-${kind}`}`.trim());
    // a shaped shadow is masked here and blurred on a child: engines disagree on the order of a mask and a filter on one element
    // a leaf's or petal's shadow lies just under it: on top of another, it falls on that one
    if (SHAPE[kind]){ sh.innerHTML = '<i></i>'; world.insertBefore(sh, el); }
    return { el, sh };
  };
  const size = (el, w, h) => { el.style.width = w + 'px'; el.style.height = h + 'px'; };
  let working = true; // not resting
  const place = t => {
    const L = t.lift ?? 0, f = t.flut;
    // a bumped leaf is stiff: it tilts, foreshortening along one axis (which turns slowly) to 0.8 at most, once a swing; its shadow too
    const ta = f ? (f.ax + f.ph * 25).toFixed(0) : 0, wob = f ? ` rotate(${ta}deg) scale(${(1 - .2 * f.e * (.5 - .5 * Math.cos(f.ph))).toFixed(3)}, 1) rotate(${-ta}deg)` : '';
    // settled on the mat while you work: part of the mat's texture. It fades by colour toward what is under it and stays opaque,
    // so two that overlap don't show through each other the way see-through shapes do
    const settled = !!t.landed && !t.moving && L === 0, faded = settled && working, o = t.o ?? 1;
    if (faded !== t.el.classList.contains('faded')){
      if (faded) t.el.style.setProperty('--under', onPage(t.x + t.w / 2, t.y + t.h / 2) ? '#fff' : 'var(--mat-a)');
      t.el.classList.toggle('faded', faded);
    }
    // scale belongs inside the transform: the CSS scale property would scale the translation too
    t.el.style.transform = `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) rotate(${t.a.toFixed(1)}deg) scale(${((t.flip ? -1 : 1) * (t.k ?? 1)).toFixed(2)}, ${(t.k ?? 1).toFixed(2)})${wob}`;
    // fading into (or out of) the mat's texture eases; falling, moving and going away don't
    const ease = settled && !t.fade;
    t.el.style.transition = ease ? 'background-color 2.5s ease, filter 6s ease' : t.fade ? 'none' : 'filter 6s ease';
    t.el.style.opacity = o.toFixed(2);
    if (t.kind === 'bug' || t.kind === 'snail') light(t);
    if (t.sh){
      // one light for the whole garden, from the top left: every shadow falls down and to the right at 6 to 7, the way the
      // page's own shadow does (--page-shadow), on the screen and not on the thing, so it doesn't turn when the thing does.
      // One continuous function of height, so landing doesn't pop: close, crisp and faint on the mat; farther and softer the higher it is.
      const ox = 1.2 + 18.9 * L, oy = 1.4 + 22 * L, turn = ['leaf', 'petal', 'fly', 'snail'].includes(t.kind) ? t.a : 0;
      // a curled leaf isn't flat: its shadow is skewed and narrower
      const curl = t.curl ? ` skewX(${t.curl.k.toFixed(1)}deg) scale(${t.curl.sx.toFixed(2)}, 1)` : '';
      t.sh.style.transform = `translate(${(t.x + ox).toFixed(1)}px, ${(t.y + oy).toFixed(1)}px) rotate(${turn.toFixed(1)}deg) scale(${(t.k ?? 1).toFixed(2)})${curl}${wob}`;
      (t.sh.firstElementChild ?? t.sh).style.filter = `blur(${(1 + 3.6 * L).toFixed(1)}px)`;      // lying, soft enough to fade across a leaf beneath
      t.sh.style.transition = ease ? 'opacity 2.5s ease' : 'none';
      t.sh.style.opacity = (o * (faded ? .38 : 1) * (.45 + 1.4 * L * (1 - L))).toFixed(2);
      if (t.ss) shellShade(t);
    }
  };
  // The light comes from the screen's top left (6 across to 7 down, as the shadows fall), however a creature turns: lu is that way in the creature's own (turned, maybe
  // mirrored) drawing. The ladybug's highlight sits toward it; the snail's whorls rise toward it, and its shell, which stands
  // about a sixth of the way up the height rule, casts its own shadow that much farther from it, on the mat (t.ss).
  const light = t => {
    const fx = t.flip ? -1 : 1, key = `${t.a.toFixed(0)}${fx}`;
    if (t.lit === key) return;
    t.lit = key;
    const r = t.a * Math.PI / 180, lu = [fx * (-.65 * Math.cos(r) - .76 * Math.sin(r)), .65 * Math.sin(r) - .76 * Math.cos(r)];
    const set = (k, v) => t.el.style.setProperty(k, v);
    if (t.kind === 'bug'){ set('--lx', `${(50 + 23 * lu[0]).toFixed(0)}%`); set('--ly', `${(50 + 23 * lu[1]).toFixed(0)}%`); set('--dx', `${(2.4 * lu[0]).toFixed(2)}px`); set('--dy', `${(2.4 * lu[1]).toFixed(2)}px`); return; }
    set('--cx', `${(-.92 * lu[0]).toFixed(2)}px`); set('--cy', `${(-.92 * lu[1]).toFixed(2)}px`);      // the shell's contact shadow
    const at = (el, s) => { el.setAttribute('cx', (9 + lu[0] * s).toFixed(2)); el.setAttribute('cy', (7.8 + lu[1] * s).toFixed(2)); };
    const [band, w2, w3, apex, hi] = t.el.querySelectorAll('.shell .m'), g = t.el.querySelector('.shell radialGradient');
    at(band, .92); at(w2, 1.85); at(w3, 2.9); at(apex, 3.7); at(hi, 5.2);
    g.setAttribute('cx', (.5 + .25 * lu[0]).toFixed(2)); g.setAttribute('cy', (.5 + .26 * lu[1]).toFixed(2));
  };
  const shellShade = t => {
    const r = t.a * Math.PI / 180, fx = t.flip ? -1 : 1, cx = t.x + 17 - 4 * fx * t.k * Math.cos(r), cy = t.y + 11 - 4 * fx * t.k * Math.sin(r);
    const L = t.lift ?? 0;
    t.ss.style.transform = `translate(${(cx + 1.2 + 18.9 * L + 2.83 * u() - 8.5).toFixed(1)}px, ${(cy + 1.4 + 22 * L + 3.3 * u() - 6.5).toFixed(1)}px) rotate(${t.a.toFixed(1)}deg) scale(${t.k.toFixed(2)})`;
    t.ss.style.opacity = t.sh.style.opacity;
  };
  // the snail's body, bent by b (-1 to 1): its ends swing to the inside of the turn, its middle (under the shell) stays
  const bend = (t, b) => {
    if (Math.abs(b - (t.bent ?? 9)) < .04) return;
    t.bent = b;
    const B = 2.4 * b, mid = x => 5 + B * ((x - 16) / 16) ** 2, hw = x => x <= 16 ? .5 + 3.7 * Math.sin(x / 32 * Math.PI) : 4.2 - (x - 16) / 14 * 2.2;
    const xs = Array.from({ length: 16 }, (_, i) => i * 2), f = v => v.toFixed(2);
    const [body, line] = t.el.querySelectorAll('.s-body path');
    body.setAttribute('d', `M0 ${f(mid(0))}${xs.slice(1).map(x => `L${x} ${f(mid(x) - hw(x))}`).join('')}Q32.6 ${f(mid(31))} 30 ${f(mid(30) + hw(30))}${xs.slice(1).reverse().map(x => `L${x} ${f(mid(x) + hw(x))}`).join('')}Z`);
    line.setAttribute('d', `M2 ${f(mid(2))}${xs.slice(2, 15).map(x => `L${x} ${f(mid(x))}`).join('')}`);
    t.el.style.setProperty('--hy', `${f(mid(30) - 5)}px`);
  };
  const drop = t => { const i = things.indexOf(t); if (i >= 0) things.splice(i, 1); t.el.remove(); t.sh?.remove(); t.ss?.remove(); };
  const lying = () => things.filter(t => t.kind === 'leaf' || t.kind === 'petal');
  const staying = () => lying().filter(t => !t.fade && !t.keepGoing);
  const onTop = t => { if (t.el.parentNode === world) world.append(t.sh ?? '', t.el); };      // what comes down lies on top
  const settle = t => { onTop(t); t.fall = null; t.el.classList.remove('falling'); t.sh?.classList.remove('falling'); t.landed = true; t.el.classList.add('landed'); };
  const land = t => {
    onTop(t); t.lift = 0; t.fall = null; t.el.classList.remove('falling'); t.sh?.classList.remove('falling');
    setTimeout(() => { t.landed = true; t.el.classList.add('landed'); place(t); }, 500);
  };
  // where a falling leaf will come down (its centre): its drift and the rest of its sway (about 30 px either way), summed exactly
  const lands = o => { const f = o.fall, n = Math.max(0, (f.ty - o.y) / f.sp); return [o.x + o.w / 2 + f.wind * n + f.amp * (Math.cos(f.ph) - Math.cos(f.ph + .018 * n)) / .018, f.ty + o.h / 2]; };
  // the way out of what lies, or will, where a falling leaf will come down (x, y: its centre then): closer than two thirds of a
  // leaf is crowded, so they overlap a third at most. Only falling leaves steer; nothing lying is ever pushed.
  const crowd = (t, x, y) => {
    let ux = 0, uy = 0;
    for (const o of staying()){
      if (o === t) continue;
      const [cx, cy] = o.fall ? lands(o) : [o.x + o.w / 2, o.y + o.h / 2];
      // two leaves both beside the page spread along the margin only: a step sideways could set one back on the page
      const m = span ? (span.left + span.right) / 2 : 0, side = !onPage(x, y) && !onPage(cx, cy) && (x < m) === (cx < m), dx = side ? 0 : x - cx, dy = y - cy || rnd(-1, 1), d = Math.hypot(dx, dy) || .1;
      const min = (Math.max(t.w, t.h) + Math.max(o.w, o.h)) * .34;
      if (d < min){ const k = (min - d) / min; ux += dx / d * k; uy += dy / d * k; }
    }
    return [ux, uy];
  };
  const add = (kind, opts = {}) => {
    // a small leaf is 12 to 17 mm long (a real tea leaf, 35 mm and up, covers too much of the page), a petal 7 to 9.5 mm across
    let shape = '', w, h;
    if (kind === 'leaf'){ shape = Math.random() < .75 ? 's1' : 's2'; w = Math.round(mm(rnd(12, 17))); h = Math.round(w * SHAPES[shape]); }
    else { w = Math.round(mm(rnd(7, 9.5))); h = Math.round(w * .85); }
    const { el, sh } = make(kind, shape, kind === 'leaf' ? pick(night() ? LEAF_NIGHT : LEAF) : pick(PETAL));
    size(el, w, h); if (sh) size(sh, w, h);
    const x0 = Math.max(0, Math.min(innerWidth - w, opts.x ?? rnd(0, panel - w)));
    const curl = kind === 'leaf' && Math.random() < .4 ? { k: rnd(-22, 22), sx: rnd(.72, .92) } : null;
    const y0 = opts.y0 ?? view().t - h / 2 - (Math.max(w, h) / 2 + SH) - rnd(0, 40);
    const t = { el, sh, kind, curl, x: x0, y: y0, a: rnd(0, 360), vx: 0, vy: 0, va: 0, lift: 1, w, h,
      fall: { y0, ty: opts.ty ?? restY(x0), ph: rnd(0, 6), sp: (kind === 'petal' ? rnd(.3, .4) : rnd(.42, .6)) * u(), amp: (kind === 'petal' ? .8 : .55) * u(), wind: opts.wind ?? 0 } };
    el.classList.add('falling'); sh?.classList.add('falling');
    things.push(t); place(t);
    const st = staying(); for (let k = 0; k < st.length - CAP; k++) st[k].fade = true;
    run();
  };

  // ---- the loop: runs only while something moves ----
  let running = false, last = 0;
  const run = () => { if (!running && active){ running = true; last = performance.now(); requestAnimationFrame(tick); } };
  function tick(now){
    if (!active){ running = false; return; }
    if (document.body.classList.contains('is-switching')){ last = now; requestAnimationFrame(tick); return; }      // a place is changing: the garden waits
    // rAF's timestamp can be earlier than the performance.now() taken in run(): never let dt go negative
    const dt = Math.max(.25, Math.min(3, (now - last) / 16.67)); last = now;
    let busy = false;
    for (const t of [...things]){
      if (t.fade){ t.o = (t.o ?? 1) - .03 * dt; if (t.o <= 0){ drop(t); continue; } place(t); busy = true; }
      const step = STEP[t.kind];
      if (step){ busy = step(t, dt) || busy; continue; }
      if (t.puff){
        // carried by a puff: once its front arrives, along a curve that leaves along the push and bends to where it comes down,
        // fast at first and gently down (an ease out), lifting and turning on the way
        const f = t.puff, ms = performance.now() - f.at;
        if (ms < 0){ busy = true; continue; }
        if (!f.up){ f.up = true; t.moving = true; t.landed = false; t.el.classList.add('falling'); t.sh?.classList.add('falling'); t.el.classList.remove('landed'); }
        const u = Math.min(1, ms / f.dur), e = 1 - Math.pow(1 - u, 3), v = 1 - e;
        t.x = v * v * f.p0.x + 2 * v * e * f.c.x + e * e * f.to.x; t.y = v * v * f.p0.y + 2 * v * e * f.c.y + e * e * f.to.y;
        t.a += f.spin * (e - (f.e ?? 0)); f.e = e; t.lift = f.L * Math.sin(Math.PI * e);
        if (u >= 1){ t.puff = null; t.lift = 0; t.moving = false; if (f.gone && (t.held || off(t))){ drop(t); continue; } settle(t); }      // never gone while still in view: it lands there
        place(t); busy = true; continue;
      }
      if (t.carry){
        const c = t.carry, w = c.w;
        if (c.delay > 0){ c.delay -= dt; busy = true; continue; }
        // the whirl's centre moves once a frame, however many leaves it carries
        if (w.at !== now){ w.at = now; w.cx += w.vx * dt; w.cy += w.vy * dt; w.vx *= Math.pow(1.004, dt); }
        c.t += dt; c.ph += w.spin * dt * (1 + 18 / c.r); c.r = Math.max(10, c.r * Math.pow(.997, dt) + .03 * dt);
        t.lift = Math.min(.7, c.t / 90);
        t.x = w.cx + Math.cos(c.ph) * c.r; t.y = w.cy + Math.sin(c.ph) * c.r * .6 - t.lift * 30; t.a += (4 + 6 * t.lift) * dt * Math.sign(w.spin);
        if (off(t)){ drop(t); continue; }
        place(t); busy = true; continue;
      }
      if (t.swirl){
        const s = t.swirl; s.t += dt; s.ph += s.w * dt; s.r += .05 * dt;
        t.lift = Math.sin(Math.PI * Math.min(1, s.t / s.dur)) * .75;
        t.x = s.cx + Math.cos(s.ph) * s.r; t.y = s.cy + Math.sin(s.ph) * s.r * .6 - t.lift * 26; t.a += 5 * dt;
        if (s.t >= s.dur){ t.swirl = null; t.lift = 0; t.vx = Math.cos(s.ph) * 1.2; t.vy = Math.sin(s.ph) * .8; t.moving = true; }
        place(t); busy = true; continue;
      }
      if (t.fall){
        const f = t.fall; f.ph += .018 * dt;
        t.y += f.sp * dt; t.x += (f.wind + Math.sin(f.ph) * f.amp) * dt; t.a += (Math.sin(f.ph * .9) + f.wind * .8) * .6 * dt;
        t.lift = Math.max(0, Math.min(1, (f.ty - t.y) / (f.ty + 30)));
        // in the first part of its fall it chooses a free spot, from where its drift will set it down: later it no longer steers, so the correction isn't seen
        if (f.ty < 1e5 && t.y - f.y0 < (f.ty - f.y0) * .6){ const [ux, uy] = crowd(t, ...lands(t)); t.x += ux * .6 * dt; f.ty = Math.max(60, Math.min(innerHeight - 40, f.ty + uy * .6 * dt)); }
        // blown out of the screen, or about to land past its right edge: it goes on by
        if (off(t, false)){ drop(t); continue; }
        if (t.x + t.w < view().l || (t.y >= f.ty && t.x > panel - t.w)) f.ty = 1e6;
        if (t.y >= f.ty){ t.y = f.ty; land(t); t.vx = (f.wind + Math.sin(f.ph) * f.amp) * .8; t.vy = f.sp * .6; t.va = rnd(-.4, .4); t.moving = true; }
        place(t); busy = true; continue;
      }
      if (Math.abs(t.vx) + Math.abs(t.vy) + Math.abs(t.va) > .04 || t.flut){
        t.moving = true;
        t.va = Math.max(-6, Math.min(6, t.va));
        t.x += t.vx * dt; t.y += t.vy * dt; t.a += t.va * dt;
        t.lift = Math.min(.35, (Math.abs(t.vx) + Math.abs(t.vy)) / 30); // a swept leaf lifts a little off the mat
        const fl = t.flut;
        if (fl){
          // bumped: it lifts with the push, swings across its way and tumbles, all dying away together
          fl.ph += .14 * dt; fl.e *= Math.pow(.94, dt);      // a swing about every 0.75 s; about one before it lies flat
          const sw = Math.cos(fl.ph) * .5 * fl.e * dt; t.x += fl.nx * sw; t.y += fl.ny * sw; t.a += fl.spin * fl.e * dt;
          t.lift = Math.min(.5, t.lift + .3 * fl.e);
          if (fl.e < .02) t.flut = null;
        }
        const k = Math.pow(t.keepGoing ? .995 : .86, dt); t.vx *= k; t.vy *= k;
        t.va *= Math.pow(t.keepGoing ? .99 : .86, dt);
        if (off(t)){ drop(t); continue; }
        place(t); busy = true;
      } else if (t.moving || t.lift){ t.vx = t.vy = t.va = 0; t.lift = 0; t.moving = false; place(t); }
    }
    if (document.body.classList.contains('g-clearing')) leaving();
    if (busy) requestAnimationFrame(tick); else running = false;
  }

  // ---- sweeping: the pointer pushes what it passes through, over the mat and over the page ----
  let px = null, py = null;
  const sweepAt = (sx, sy) => {
    const { x, y } = toMat(sx, sy);      // the pointer is on the screen, the leaves on the mat
    if (px === null || !active || still()){ px = x; py = y; return; }
    const dx = x - px, dy = y - py; px = x; py = y;
    if (!dx && !dy) return;
    const at = performance.now(), rested = at - (sweepAt.last ?? 0) > 350; sweepAt.last = at;      // the pointer moving on after a pause
    for (const t of things){
      const dd = Math.hypot(t.x + t.w / 2 - px, t.y + t.h / 2 - py), near = dd / u();
      // its eyes go in as you come near; it hides as you pass over it, and hidden, the pointer nudges its shell along like a leaf
      if (t.kind === 'snail' && near < 80){
        // the first pass over it only shuts it in its shell. Once it is fully shut (.7 s), the pointer coming back to the shell, or
        // moving on after a pause, nudges it: only right over the shell, and only a little, as it is heavy
        const shut = t.hide > 0 && performance.now() - t.shutAt > 700, onShell = dd < 9 * t.k;
        if (shut && onShell && (t.armed || rested)){ t.vx = (t.vx ?? 0) + dx * .05; t.vy = (t.vy ?? 0) + dy * .05; }
        else if (shut && !onShell) t.armed = true;
        startle(t, dd < 17 * t.k); continue;
      }
      if (t.kind === 'bug' && near < 90){ startle(t); continue; }
      if ((t.kind !== 'leaf' && t.kind !== 'petal') || t.held || t.puff) continue;      // a held leaf is in the moving pages' frame, not the mat's
      const cx = t.x + t.w / 2, cy = t.y + t.h / 2, d = Math.hypot(cx - px, cy - py), R = Math.max(46, t.w * .9);
      if (d > R) continue;
      const nx = (cx - px) / (d || 1), ny = (cy - py) / (d || 1), s = 1 - d / R;
      if (t.fall) settle(t);
      t.swirl = null; t.moving = true;
      t.vx += (dx * .32 + nx * 1.2) * s; t.vy += (dy * .32 + ny * 1.2) * s; t.va += (dx * ny - dy * nx) * .2 * s;
      const sp = Math.hypot(t.vx, t.vy); if (sp > 22){ t.vx *= 22 / sp; t.vy *= 22 / sp; }
      // the flutter: as strong as the push, across the way it goes (it swings side to side about that line)
      const f = t.flut ??= { e: 0, ph: 0, ax: rnd(0, 180), spin: pick([-1, 1]) * rnd(.5, 1) }, v = Math.hypot(t.vx, t.vy) || 1;
      f.e = Math.min(1, f.e + s * Math.min(1, Math.hypot(dx, dy) / 10)); f.nx = -t.vy / v; f.ny = t.vx / v;
      run();
    }
  };

  // a click, a key or a page that moves blows a snail away as it does the leaves: it draws in, and a moment later slides off its side
  // a snail on its way home: turned to its own side of the screen (a turn takes a moment)
  // a snail on its way home, to its own side of the screen: it turns there along a curve, the way that bends toward the middle
  // of the screen (a snail can't turn on the spot)
  const homeward = t => {
    if (t.back) return;
    t.back = true;
    const v = view(), sign = (Math.cos(t.base * Math.PI / 180) > 0 ? 1 : -1) * (t.y + 11 < (v.t + v.b) / 2 ? 1 : -1);
    t.aim = t.base + sign * ((sign * ((t.left ? 180 : 0) - t.base)) % 360 + 360) % 360;
  };
  // a click, a key or a page that moves: a snail over a page's area (the page grew over it) is blown off it like a leaf, in its
  // shell, only until it is clear of the page; there it comes out and crawls home. One beside the page just heads home.
  const blowSnails = () => {
    for (const t of things){
      if (t.kind !== 'snail' || t.blow) continue;
      homeward(t);
      const e = 17 * t.k, eh = 11 * t.k, cx = t.x + 17, cy = t.y + 11, q = pg.find(r => cx + e > r.left - 8 && cx - e < r.right + 8 && cy + eh > r.top && cy - eh < r.bottom);
      if (!q) continue;
      startle(t);
      const to = { x: (t.left ? q.left - 14 - e : q.right + 14 + e) - 17, y: t.y + rnd(-15, 15) };
      t.blow = { at: performance.now() + 450, p0: { x: t.x, y: t.y }, to, a0: t.a, spin: (t.left ? -1 : 1) * rnd(25, 50), dur: Math.max(500, Math.min(1400, Math.abs(to.x - t.x) * 3)) };
    }
    run();
  };
  // the ladybug flies off, the snail draws in its eyes (and hides in its shell when touched), the butterfly heads out
  const startle = (t, touched = true) => {
    if (t.kind === 'bug' && !t.scare){ t.flee = t.scare = true; const v = view(); t.exit = t.x < (v.l + v.r) / 2 ? v.l - 400 : v.r + 400; t.el.classList.add('flying'); }
    if (t.kind === 'snail'){
      t.wary = 150; t.el.classList.add('wary');
      if (touched){ if (!t.el.classList.contains('hid')){ t.shutAt = performance.now(); t.armed = false; } t.hide = 150; t.peek = 0; for (const e of [t.el, t.sh]){ e.classList.remove('peek'); e.classList.add('hid'); } }
    }
    if (t.kind === 'fly') t.spook = true;
  };

  // ---- the puff: a click (a key, a zoom) is a puff of air from a point o. Its front spreads at V (the mat's pixels, so it
  //      scales with the zoom): a leaf d away feels it d / V ms later, as strongly as 1 / (1 + (d / R)^2) ----
  const V = .9, R = 160;
  // a leaf's flight from where it lies (its box's corner) to `to`: it leaves along the push (ux, uy) and bends toward `to`, the
  // bend kept between lo and hi across (its own page, so it never crosses another); gone: it is dropped where it comes down
  const fly = (t, to, ux, uy, s, { at, L, reach = 40 + 80 * s, lo = -1e9, hi = 1e9, gone = false }) => {
    const p0 = { x: t.x, y: t.y }, len = Math.hypot(to.x - p0.x, to.y - p0.y), a = Math.min(len * .5, reach);
    if (t.fall) settle(t);
    t.swirl = t.flut = null; t.vx = t.vy = t.va = 0;
    t.puff = { at, p0, c: { x: Math.max(lo, Math.min(hi, p0.x + ux * a)), y: p0.y + uy * a }, to, L, gone,
      spin: (Math.sign(to.x - p0.x) || 1) * (10 + 60 * s) * rnd(.7, 1.2), dur: Math.max(400, Math.min(2200, len / (.25 + .55 * s))) };
    run();
  };
  // a puff from o (null: no origin, a pan or the panel opening) clears what lies on `only` (null: on every page). Each leaf
  // leaves its own page by the side it lies on from o (about straight above or below o, or with no o: the nearer side).
  // The gap to the next page is mat only if the leaf comes down clear of both pages, and nothing goes off the screen: then
  // it takes its page's other side. Far ones go too, on a softer breeze a moment after the front, so the page always clears.
  const clearPage = (o, only = null) => {
    let any = false;
    const now = performance.now();
    for (const t of staying()){
      if (t.puff) continue;      // already on its way
      const cx = t.x + t.w / 2, cy = t.y + t.h / 2, q = pg.find(r => cx > r.left && cx < r.right && cy > r.top && cy < r.bottom);
      if (!q || cx > panel || (only && q !== only)) continue;
      const e = Math.max(t.w, t.h) * (t.k ?? 1) / 2, d = o ? Math.hypot(cx - o.x, cy - o.y) : 0, s = o ? 1 / (1 + (d / R) ** 2) : .3, far = o && d > 2.5 * R;
      const out = e + 6 + 70 * s + rnd(0, 25);
      const exit = dir => {
        const edge = dir > 0 ? q.right : q.left, gaps = pg.filter(r => r !== q && r.bottom > q.top && r.top < q.bottom && (dir > 0 ? r.left >= q.right - 1 : r.right <= q.left + 1)).map(r => dir > 0 ? r.left - q.right : q.left - r.right);
        if (gaps.length){ const g = Math.min(...gaps); return g > 2 * e + 8 ? edge + dir * Math.max(e + 4, Math.min(g - e - 4, out)) : null; }
        return dir > 0 && edge + out + e > panel ? null : edge + dir * out;
      };
      const near = cx - q.left < q.right - cx ? -1 : 1, want = o && Math.abs(cx - o.x) >= e ? Math.sign(cx - o.x) : near;
      let x = exit(want), gone = false;
      if (x === null) x = exit(-want);
      // shortcut: a page hemmed in on both sides (between two narrow gaps, or a narrow gap and the window's edge) sends its leaves off the screen, where they are dropped
      if (x === null){ gone = true; x = Math.max(panel, q.right) + 3 * e + 40; }
      const ux = o ? (cx - o.x) / (d || 1) : Math.sign(x - cx), uy = o ? (cy - o.y) / (d || 1) : 0;
      const to = { x: x - t.w / 2, y: Math.max(40, Math.min(innerHeight - 40, cy + uy * Math.abs(x - cx) * .35)) - t.h / 2 };
      fly(t, to, ux, uy, s, { at: now + d / V + (far ? 300 : 0), L: far ? .12 : .25 + .35 * s, lo: q.left - t.w / 2, hi: q.right - t.w / 2, gone });
      any = true;
    }
    if (any) setTimeout(breezeTags, 250);
  };
  // a click on the mat while you rest is play: a small puff scatters the leaves near it 20 to 60 px and startles the
  // creatures; nothing is cleared, and nothing comes down on a page or off the screen
  const RM = 90;
  const puffMat = o => {
    if (!active || still()) return;
    const now = performance.now();
    for (const t of staying()){
      const cx = t.x + t.w / 2, cy = t.y + t.h / 2, d = Math.hypot(cx - o.x, cy - o.y);
      if (t.puff || t.held || d > 2 * RM || onPage(cx, cy)) continue;
      const s = 1 / (1 + (d / RM) ** 2), a = d ? 0 : rnd(0, 6.3), ux = d ? (cx - o.x) / d : Math.cos(a), uy = d ? (cy - o.y) / d : Math.sin(a), e = Math.max(t.w, t.h) * (t.k ?? 1) / 2;
      const clear = (x, y) => x + e < panel && !pg.some(r => x + e > r.left && x - e < r.right && y + e > r.top && y - e < r.bottom);
      let D = 20 + 40 * s; while (D > 4 && !clear(cx + ux * D, cy + uy * D)) D /= 2;
      if (D <= 4) D = 0;
      fly(t, { x: t.x + ux * D, y: t.y + uy * D }, ux, uy, s, { at: now + d / V, L: .3 * s, reach: D * .3 });
    }
    for (const t of things) if (Math.hypot(t.x + t.w / 2 - o.x, t.y + t.h / 2 - o.y) < 2 * RM) startle(t);
  };
  const breezeTags = () => { restart(root, 'g-breeze'); setTimeout(() => root.classList.remove('g-breeze'), 1900); };

  // ---- the moments ----
  // a wave: four to seven leaves over a few seconds, on one wind, spread across the screen
  const wave = (n = Math.round(rnd(4, 7))) => {
    const wind = pick([-1, 1]) * rnd(.18, .42), span = panel;
    const xs = Array.from({ length: n }, (_, k) => (k + rnd(.15, .85)) / n * span - wind * 120).sort(() => Math.random() - .5);
    xs.forEach((x, k) => setTimeout(() => active && !paused && resting && add('leaf', { x, wind: wind * rnd(.8, 1.2) }), k * rnd(450, 900)));
  };
  const lone = () => wave(1);
  // petals: always a small cluster, from one spot
  const petals = () => {
    const n = Math.round(rnd(4, 6)), wind = pick([-1, 1]) * rnd(.12, .3), cx = rnd(60, panel - 60);
    for (let k = 0; k < n; k++) setTimeout(() => active && !paused && resting && add('petal', { x: cx + rnd(-70, 70), wind: wind * rnd(.8, 1.2) }), k * rnd(220, 420));
  };
  // a breeze is a whirl, not a blower: the leaves it takes are picked up, circle round a centre that drifts toward the
  // nearer edge of the screen, and are carried off it; the rest only stir and turn where they lie
  const breeze = () => {
    breezeTags();
    const ls = staying().filter(t => !t.puff), go = ls.length >= 8 ? ls.slice(0, Math.ceil(ls.length / 2)) : [];
    if (go.length){
      const gx = go.reduce((a, t) => a + t.x, 0) / go.length, gy = go.reduce((a, t) => a + t.y, 0) / go.length, dir = gx < innerWidth / 2 ? -1 : 1;
      const whirl = { cx: gx, cy: gy, vx: dir * rnd(.9, 1.4), vy: rnd(-.35, -.1), spin: dir * rnd(.03, .045) };
      for (const t of go){
        const dx = t.x - gx, dy = (t.y - gy) / .6;
        t.carry = { w: whirl, r: Math.max(12, Math.hypot(dx, dy)), ph: Math.atan2(dy, dx), t: 0, delay: rnd(0, 40) };
        t.keepGoing = true; t.vx = t.vy = t.va = 0;
      }
    }
    for (const t of ls) if (!go.includes(t)){ t.vx += rnd(-.5, .5); t.vy += rnd(-.4, .4); t.va += rnd(-2.5, 2.5); t.moving = true; }
    run();
  };
  // a swirl: a little gust lifts a few leaves in one margin, turns them round, and sets them down spread out
  const swirl = () => {
    const z = zones(); if (!z.length) return;
    const [a, b] = pick(z), cx = (a + b) / 2, cy = restY(cx);
    const ls = staying().filter(t => !t.fall && t.x > a - 10 && t.x < b + 10).slice(-4);
    if (ls.length < 2) return wave();
    for (const t of ls){ t.swirl = { cx, cy, r: rnd(18, 40), ph: rnd(0, 6.3), w: rnd(.035, .055), t: 0, dur: rnd(220, 300) }; t.vx = t.vy = t.va = 0; }
    run();
  };
  // the creatures come in from the side of the screen, and leave the same way
  // home is just off the screen for a box hw wide each side of its middle, drawn e wide each side (it is scaled to its real size)
  const side = (hw, e) => { const z = zones(); if (!z.length) return null; const zz = z.find(q => q[2] === 'L') ?? z[0], v = view(); return { a: zz[0], b: zz[1], left: zz[2] === 'L', home: zz[2] === 'L' ? v.l - hw - e - SH : v.r - hw + e + SH }; };
  // each returns false when it can't come (no margin beside the page, or one is already out), so the moment isn't lost
  const bug = () => {
    const k = mm(7) / 18, s = side(8, 9 * k); if (!s || things.some(t => t.kind === 'bug')) return false;
    const { el, sh } = make('bug', `walking ${pick(['sp2', 'sp4', 'sp6', 'sp7', 'sp7'])}`);
    el.innerHTML = '<i class="wg l"></i><i class="wg r"></i><i class="h l"></i><i class="h r"></i>';
    const y = rnd(120, innerHeight - 220);
    things.push({ el, sh, kind: 'bug', x: s.home, y, a: s.left ? 90 : 270, home: s.home, away: s.left ? -1 : 1, a0: s.a, b0: s.b, life: rnd(1300, 1900), lift: 0, w: 16, h: 18, k }); run(); return true;
  };
  const snail = () => {
    // a banded snail: 20 mm long as it crawls. It turns back with its head 8 px short of the page, and comes only if most of it fits
    const k = mm(20) / 34, e = 17 * k, s = side(17, e); if (!s || things.some(t => t.kind === 'snail')) return false;
    const far = s.left ? span.left - 8 - e - 20 * u() : panel - e, near = s.left ? e : span.right + 8 + e + 20 * u();      // where its middle may start its turn
    if (far - near < -.4 * e) return false;
    const { el, sh } = make('snail');
    el.innerHTML = '<svg class="s-body" viewBox="0 0 32 10"><path/><path/></svg><i class="eye a"></i><i class="eye b"></i>' + SHELL;
    sh.innerHTML = '<i class="sb"></i>';
    const ss = div('g-shade g-shade-shell'), slime = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    slime.setAttribute('class', 'g-trail'); world.prepend(slime);
    const room = Math.max(0, far - near) * rnd(0, .4), turn = s.left ? Math.min(far, far - room) : Math.max(near, near + room), base = (s.left ? 0 : 180) + rnd(-25, 25);
    things.push({ el, sh, kind: 'snail', base, aim: base, x: s.home, y: rnd(innerHeight * .45, innerHeight - 230), a: base, home: s.home,
      turnAt: turn - 17, trail: 0, lift: 0, hide: 0, wary: 0, peek: 0, left: s.left, w: 34, h: 22, k, ss, slime }); bend(things.at(-1), 0); run(); return true;
  };
  const butterfly = () => {
    const k = mm(28) / 46, s = side(23, 23 * k); if (!s || things.some(t => t.kind === 'fly')) return false;
    // its loop reaches no farther than its wings' tips at the page's edge
    const lim = s.left ? span.left - 23 - 23 * k : span.right - 23 + 23 * k, reach = Math.abs(lim - s.home);
    if (reach < Math.abs(s.home - (s.left ? view().l : view().r)) + 46 * k) return false;
    const { el, sh } = make('fly', pick(['amber', 'pale']));
    el.innerHTML = '<i class="w l"></i><i class="w r"></i><b></b>';
    const y = rnd(120, innerHeight - 260);
    things.push({ el, sh, kind: 'fly', x: s.home, y, y0: y, a: s.left ? 90 : 270, u: 0, home: s.home, away: s.left ? -1 : 1, reach: reach * rnd(.8, 1), lift: 1, w: 46, h: 34, k }); run(); return true;
  };
  const fireflies = () => {
    const z = zones(); if (!z.length) return false;
    for (let k = 0; k < 6; k++){
      const [a, b] = pick(z);
      const { el } = make('glow'); el.style.animationDelay = rnd(0, 3) + 's';
      things.push({ el, kind: 'glow', x: rnd(a, b), y: rnd(80, innerHeight - 120), a: 0, life: rnd(900, 1400), vx: rnd(-.2, .2), vy: rnd(-.2, .2), w: 10, h: 10, k: u() });
    }
    run(); return true;
  };
  let dappleT = null;
  const dapple = () => { dappleEl.classList.add('on'); clearTimeout(dappleT); dappleT = setTimeout(() => dappleEl.classList.remove('on'), 50000); };

  // ---- rain: a shower in gusts; each drop falls, splashes, and leaves a wet spot that darkens the page or the mat and
  //      evaporates slowly. Drops and spots are CSS-animated, so the loop above isn't needed for them. ----
  const wets = [];
  let raining = false, rainT = null;
  let snailDue = false;
  const trySnail = () => { if (snailDue && active && !paused && resting && snail() !== false) snailDue = false; };
  const endRain = () => { raining = false; clearTimeout(rainT); rainSky.classList.remove('on'); };
  const wet = (x, y) => {
    if (onPage(x, y) && (!resting || document.body.classList.contains('is-moving'))) return;
    const d = div('g-wet'), r = mm(rnd(1.1, 2.8));
    d._l = x - r; d._t = y - r;
    Object.assign(d.style, { width: `${r * 2}px`, height: `${r * rnd(1.6, 2)}px`, transform: `translate(${d._l.toFixed(0)}px, ${d._t.toFixed(0)}px)` });
    d.style.setProperty('--life', `${rnd(60, 100).toFixed(0)}s`);   // a variable, so the 1.4 s drying (.dry) isn't overridden
    d._x = x; d._y = y; wets.push(d);
    d.addEventListener('animationend', () => { d.remove(); const i = wets.indexOf(d); if (i >= 0) wets.splice(i, 1); leaving(); });
    while (wets.length > 140) wets.shift().remove();
  };
  const splash = (x, y) => { const sp = div('g-splash'); sp.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`; sp.addEventListener('animationend', () => sp.remove()); };
  // a drop falls straight down from above the screen onto where it lands, its shadow closing in directly under it, then it splashes
  const drop1 = () => {
    const x = rnd(0, panel - 6), y = rnd(30, innerHeight - 20), d = div('g-drop'), sh = div('g-drop-sh');
    for (const e of [d, sh]){ e.style.left = `${x.toFixed(0)}px`; e.style.top = `${y.toFixed(0)}px`; }
    d.style.setProperty('--fall', `${(view().t - y - 30).toFixed(0)}px`);   // it comes straight down from above the screen
    const ms = 200 + Math.sqrt(y) * rnd(7, 9); d.style.animationDuration = sh.style.animationDuration = `${ms.toFixed(0)}ms`;
    d.addEventListener('animationend', () => { d.remove(); sh.remove(); if (!active) return; splash(x, y); wet(x, y); });
  };
  const rain = (dur = rnd(25000, 40000) * Math.min(1, IDLE / 30000)) => {      // (shorter with a check's shorter rest)
    if (raining) return;
    raining = true; rainSky.classList.add('on');
    const t0 = performance.now(), gusts = rnd(2, 3.2);
    const spawn = () => {
      if (!raining || !active || paused || !resting) return endRain();
      const u = (performance.now() - t0) / dur;
      // the shower over, a snail comes out onto the wet mat (or, with no room for it now, at the next moment while the mat is wet)
      if (u >= 1){ endRain(); snailDue = true; setTimeout(trySnail, rnd(6000, 16000) * Math.min(1, IDLE / 30000)); return; }
      // swells and eases: a hump over the whole shower, with two or three gusts in it
      const rate = .9 + 8.5 * Math.pow(Math.sin(Math.PI * u), 2) * (.55 + .45 * Math.sin(u * Math.PI * 2 * gusts));
      drop1();
      rainT = setTimeout(spawn, 1000 / Math.max(.5, rate));
    };
    spawn();
  };
  // on return: the rain stops and the resume page dries (the mat goes on drying slowly)
  const dryPage = () => {
    for (const d of wets) if (onPage(d._x, d._y)) d.classList.add('dry');
    for (const d of box.querySelectorAll('.g-drop, .g-drop-sh')) d.remove(); // drops still on their way don't land
  };

  // body.g-clearing keeps the garden above a page that moves until what lay on it has left (a leaf gliding off the page) or dried
  const leaving = () => {
    refreshGeo();
    // until every leaf blown off a page is clear of it, tip and shadow too, and a snail blown away has gone
    const over = t => { const r = reach(t), cx = t.x + t.w / 2, cy = t.y + t.h / 2; return pg.some(q => cx + r > q.left && cx - r < q.right && cy + r > q.top && cy - r < q.bottom); };
    document.body.classList.toggle('g-clearing', active && (things.some(t => (t.puff && over(t)) || t.blow) || wets.some(d => d.classList.contains('dry'))));
  };
  const steer = (t, tx, ty, turn) => { const want = Math.atan2(ty - t.y, tx - t.x) * 180 / Math.PI + 90; let d = ((want - t.a + 540) % 360) - 180; t.a += Math.max(-turn, Math.min(turn, d)); };
  // a snail onto page r: its head within 8 px of it beside it, or a third of its length over a corner
  const onto = (t, r) => {
    const e = 17 * t.k, eh = 11 * t.k, cx = t.x + 17, cy = t.y + 11, ox = Math.min(cx + e, r.right) - Math.max(cx - e, r.left), oy = Math.min(cy + eh, r.bottom) - Math.max(cy - eh, r.top);
    return (ox > -8 && oy > eh) || (ox > .66 * e && oy > 0);
  };
  const STEP = {
    bug(t, dt){
      const leaving = t.flee || t.life <= 0 || !active || paused;
      t.life -= dt; t.ph = (t.ph ?? rnd(0, 6)) + .045 * dt;
      // startled: the wing cases open, it lifts (its shadow falls farther) and flies off the nearest side
      const fl = t.scare ? (t.fl = Math.min(1, (t.fl ?? 0) + .02 * dt)) : 0; t.lift = .85 * fl;
      // never a straight line: a slow swing in the heading and a little jitter on top, whatever it's doing
      const wob = (Math.sin(t.ph) * 2.2 + Math.sin(t.ph * 2.7) * 1.1 + rnd(-1.2, 1.2)) * (1 + fl);
      // leaving, it heads for a point well past the edge, so it goes straight out instead of circling just off the screen
      if (leaving) steer(t, t.scare ? t.exit : t.home + t.away * 400, t.y + Math.sin(t.ph * .7) * 80, 6 * dt);
      else if (t.x < t.a0 || t.x > t.b0) steer(t, (t.a0 + t.b0) / 2, t.y, 3 * dt);
      else if (t.y < view().t - 10 || t.y > view().b - 30) steer(t, t.x, (view().t + view().b) / 2, 4 * dt);      // it may pass under the bars at the top and foot
      t.a += wob * dt;
      const sp = (t.scare ? .4 + 2.6 * fl : leaving && t.flee ? 1.4 : .32) * u(), r = (t.a - 90) * Math.PI / 180;
      t.x += Math.cos(r) * sp * dt; t.y += Math.sin(r) * sp * dt;
      if (leaving && off(t)){ drop(t); return false; }
      place(t); return true;
    },
    snail(t, dt){
      if (t.vx || t.vy){
        const x0 = t.x, y0 = t.y; t.x += t.vx * dt; t.y += t.vy * dt; t.vx *= Math.pow(.8, dt); t.vy *= Math.pow(.8, dt);
        if (pg.some(r => onto(t, r))){ t.x = x0; t.y = y0; t.vx = t.vy = 0; }      // nudged, it still never goes onto a page
        if (Math.abs(t.vx) + Math.abs(t.vy) < .02) t.vx = t.vy = 0;
      }
      if (t.hide > 0 || t.peek > 0 || t.wary > 0 || t.pause > 0) t.tail = null;      // stopped or turning: its trail starts again where it next goes
      // blown away like a leaf when you come back: in its shell, it slides and turns off its side of the screen
      if (t.blow){
        const b = t.blow, ms = performance.now() - b.at;
        if (ms > 0){
          const u = Math.min(1, ms / b.dur), e = 1 - (1 - u) ** 3;
          t.x = b.p0.x + (b.to.x - b.p0.x) * e; t.y = b.p0.y + (b.to.y - b.p0.y) * e; t.a = b.a0 + b.spin * e; t.lift = .3 * Math.sin(Math.PI * u);
          if (u >= 1){ t.blow = null; t.lift = 0; t.hide = 20; t.base = t.aim = t.th = t.a; t.back = false; homeward(t); }      // clear of the page: a moment, then it peeks and comes out
        }
        place(t); return true;
      }
      // coming out: the eyes first, at the shell's edge, looking about (.peek), then the body, and only then it moves on
      if (t.hide > 0){ t.hide -= dt; if (t.hide <= 0){ t.peek = 125; t.wary = 0; t.el.classList.remove('wary'); for (const e of [t.el, t.sh]){ e.classList.remove('hid'); e.classList.add('peek'); } } place(t); return true; }
      if (t.peek > 0){ t.peek -= dt; if (t.peek <= 0){ for (const e of [t.el, t.sh]) e.classList.remove('peek'); t.pause = 30; } place(t); return true; }
      if (t.wary > 0){ t.wary -= dt; if (t.wary <= 0) t.el.classList.remove('wary'); place(t); return true; }      // still, eyes in, until it feels safe
      // it never turns on the spot: to head back (at its turning point, when the rest ends, or with a page ahead) it swings round
      // a tight curve as it crawls on, so it starts that turn a turning circle early and the curve keeps it off the page
      if (!t.back && (paused || !active)) homeward(t);
      const sp = .09 * u(), v = view(), r0 = t.a * Math.PI / 180, ahead = 34 * u(), cx = t.x + 17, cy = t.y + 11;
      if (!t.back && ((t.left ? 1 : -1) * (t.x - t.turnAt) >= 0 || pg.some(q => onto({ k: t.k, x: t.x + Math.cos(r0) * ahead, y: t.y + Math.sin(r0) * ahead }, q)))) homeward(t);
      if (t.pause > 0){ t.pause -= dt; place(t); return true; }
      // a slow meander: its heading (base) swings toward where it means to go at most .45 degrees a frame, with long curves and
      // short wiggles on top, and bends back toward the middle of the screen near its top or foot; no jitter
      t.ph = (t.ph ?? rnd(0, 6)) + .01 * dt; t.p1 ??= rnd(0, 6);
      const toward = Math.sin(t.base * Math.PI / 180), nudge = t.y < v.t + 90 && toward < .3 ? 1 : t.y > v.b - 130 && toward > -.3 ? -1 : 0;
      if (nudge){ const k = nudge * (Math.cos(t.base * Math.PI / 180) > 0 ? 1 : -1) * .25 * dt; t.base += k; t.aim += k; }
      t.base += Math.max(-.45 * dt, Math.min(.45 * dt, t.aim - t.base));
      t.wig = (t.wig ?? 0) + ((1 - Math.min(1, Math.abs(t.aim - t.base) / 60)) - (t.wig ?? 0)) * Math.min(1, .015 * dt);      // the wiggles fade out for a turn, and back in
      const th = t.base + t.wig * (34 * Math.sin(t.ph * .35 + t.p1) + 16 * Math.sin(t.ph) + 5 * Math.sin(t.ph * 2.3)), r = th * Math.PI / 180;
      bend(t, Math.max(-1, Math.min(1, (th - (t.th ?? th)) / dt / .4))); t.th = th;      // as its path turns, its body bends with it
      t.x += sp * Math.cos(r) * dt; t.y += sp * Math.sin(r) * dt; t.trail += sp * dt; t.a = th;
      // the trail: one line along the path its middle took (its tail swings as it turns; the path doesn't), each bit from where
      // the last ended. The bits fade one by one; their group is see-through as a whole (.g-trail), so where two meet they don't add up
      const bx = cx, by = cy + 2 * t.k;
      if (!t.tail) t.tail = [bx, by];
      else if (t.trail > 3 * t.k){
        t.trail = 0;
        const s = document.createElementNS('http://www.w3.org/2000/svg', 'line'), [x1, y1] = t.tail;
        for (const [k, v] of [['x1', x1], ['y1', y1], ['x2', bx], ['y2', by], ['stroke-width', 3 * t.k]]) s.setAttribute(k, v.toFixed(1));
        s.addEventListener('animationend', () => { s.remove(); if (!t.slime.childElementCount && !things.includes(t)) t.slime.remove(); });
        t.slime.append(s); t.tail = [bx, by];
      }
      if (t.back && off(t)){ drop(t); return false; }
      place(t); return true;
    },
    // in from the side on a loop over the margin, and back out the same side
    fly(t, dt){
      t.u += (t.spook ? .006 : .0016) * dt;      // startled, it hurries out the way it came
      const inward = -t.away, s = Math.sin(Math.PI * Math.min(1, t.u));
      const nx = t.home + inward * s * t.reach, ny = t.y0 + (Math.sin(2 * Math.PI * t.u) * 70 + Math.sin(t.u * 40) * 6) * u();
      // it faces where it's going (it's drawn head up): never sideways
      const dx = nx - t.x, dy = ny - t.y;
      if (Math.abs(dx) + Math.abs(dy) > .01){ const want = Math.atan2(dy, dx) * 180 / Math.PI + 90; const d = ((want - t.a + 540) % 360) - 180; t.a += d * Math.min(1, .15 * dt); }
      t.x = nx; t.y = ny;
      if (t.u >= 1){ drop(t); return false; }
      place(t); return true;
    },
    glow(t, dt){
      t.life -= dt;
      if (t.life <= 0 || t.leave || !active || paused){ t.o = (t.o ?? 1) - .015 * dt; if (t.o <= 0){ drop(t); return false; } }
      // it drifts, but turns back before it reaches an edge: it never blinks in and out along one
      const v = view(), m = 40 * u(), r = (innerWidth - T().ox) / T().s;      // (under the sidebar too)
      t.vx += (rnd(-.015, .015) + (t.x < v.l + m ? .01 : t.x > r - m ? -.01 : 0)) * dt; t.vy += (rnd(-.015, .015) + (t.y < v.t + m ? .01 : t.y > v.b - m ? -.01 : 0)) * dt; t.vx *= .985; t.vy *= .985;
      t.x += t.vx * dt; t.y += t.vy * dt; place(t); return true;
    },
  };

  const MOMENTS = [wave, wave, wave, petals, petals, rain, swirl, bug, dapple, lone];
  // common moments are dealt like a shuffled deck, so each comes round once a cycle; rare ones (the butterfly by day,
  // fireflies at night) only slip in now and then, so spotting one stays a small surprise
  let lastMoment = null, first = true, deck = [];
  const RARE_CHANCE = .15;
  const deal = () => { deck = [...MOMENTS].sort(() => Math.random() - .5); };
  const rare = () => night() ? fireflies : butterfly;
  const moment = () => {
    refreshGeo();
    // the first time you rest, the garden shows itself with a wave of leaves
    if (first){ first = false; lastMoment = wave; wave(); return; }
    if (snailDue && wets.some(d => !d.classList.contains('dry'))){ trySnail(); if (!snailDue){ lastMoment = snail; return; } }
    if (staying().length >= 12){ lastMoment = breeze; breeze(); return; }
    if (Math.random() < RARE_CHANCE){ const f = rare(); if (f !== lastMoment && f() !== false){ lastMoment = f; return; } }
    for (let tries = 0; tries < 30; tries++){
      if (!deck.length) deal();
      const f = deck.shift();
      if (f === lastMoment){ deck.push(f); continue; }
      if (f === swirl && staying().length < 2) continue;
      if (f === rain && (raining || Math.random() < .5)) continue;   // a shower is light and not every round
      if (f === dapple && dappleEl.classList.contains('on')) continue;
      if (f() === false) continue; // a creature with nowhere to come in: deal the next card
      lastMoment = f; return;
    }
    breeze();
  };

  // ---- resting, working, and the full pause ----
  const IDLE = Math.max(2, idle) * 1000, PAUSE = IDLE * 10;
  let timer = null, resting = false, paused = false, restStart = 0, editing = false;
  const refresh = () => { for (const t of things) if (t.landed) place(t); };
  const leave = () => { for (const t of things){ if (t.kind === 'bug') t.flee = true; if (t.kind === 'glow') t.leave = true; if (t.kind === 'snail') homeward(t); } };
  const pause = () => {
    paused = true; box.classList.add('paused');
    leave(); dappleEl.classList.remove('on'); endRain(); run();
  };
  const loopMoments = () => {
    if (still() || document.hidden){ timer = setTimeout(loopMoments, 5000); return; }
    if (!resting){ resting = true; working = false; editing = false; restStart = performance.now(); refresh(); }
    // the full pause waits for a shower to end and its snail to come out (the pause then sends it home)
    const snailing = raining || (snailDue && wets.some(d => !d.classList.contains('dry')));
    if (performance.now() - restStart > PAUSE && !snailing){ pause(); return; }
    // moments come every 0.83 to 1.33 idle periods: 25 to 40 seconds at the default 30, closer together when a
    // shorter wake is set for a check, so the ten periods before the pause hold the same number of moments
    moment(); timer = setTimeout(loopMoments, IDLE * rnd(.83, 1.33));
  };
  const poke = () => {
    if (!active) return;
    clearTimeout(timer);
    if (paused){ paused = false; box.classList.remove('paused'); }
    if (resting){ resting = false; working = true; leave(); endRain(); for (const t of things) if (t.fall) t.fall.ty = 1e6; refresh(); run(); }   // what is still falling goes on by: nothing lands while you work
    timer = setTimeout(loopMoments, IDLE);
  };
  // the page is cleared only when you click into it or start typing. Just coming back and looking leaves it as it is.
  let lastClear = 0;
  // a puff from o clears every page: the one clicked at once, the others on the softer breeze a moment after (they are far)
  const clearFrom = o => {
    if (!active || still()) return;
    editing = true; refreshGeo();
    if (performance.now() - lastClear < 1200) return;
    lastClear = performance.now();
    clearPage(o); dryPage(); blowSnails();
  };
  // a key's puff comes from the line being typed in (the caret, or the line in focus), else from the pointer, else the pages' middle
  const keyOrigin = e => {
    const d = e?.target?.ownerDocument, fr = d?.defaultView?.frameElement, sel = d?.getSelection?.();
    if (fr && e.target !== d.body && e.target.getBoundingClientRect){
      const c = sel?.rangeCount && e.target.contains(sel.anchorNode) ? sel.getRangeAt(0).getBoundingClientRect() : null;
      const r = c && (c.width || c.height) ? c : e.target.getBoundingClientRect(), w = toWindow(fr, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
      return toMat(w.x, w.y);
    }
    return px !== null ? { x: px, y: py } : span ? { x: (span.left + Math.min(span.right, panel)) / 2, y: (span.top + span.bottom) / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
  };
  // ---- held: what lies on a moving page, or blows off it, goes with it as if on the paper ----
  // #gpage starts as the mat's transform and follows the camera from the start of the move: a point x of the mat then is
  // on the page at (m.ox + x m.s - c.x) / c.k, and on the screen now at cam.x + that cam.k. At rest it all goes back to the mat.
  const layerOf = () => { const c = ui.cam, h = held, r = c.k / h.c.k; return { a: c.x + (h.m.ox - h.c.x) * r, b: c.y + (h.m.oy - h.c.y) * r, s: h.m.s * r }; };
  const hold = () => {
    const m = T(); held = { c: { ...ui.cam }, m, things: lying().filter(t => t.puff || onPage(t.x + t.w / 2, t.y + t.h / 2)), wets: wets.filter(d => onPage(d._x, d._y)) };
    sheetLayer.style.transform = `translate(${m.ox}px, ${m.oy}px) scale(${m.s})`;
    for (const t of held.things){ t.held = true; sheetLayer.append(t.sh ?? '', t.el); }
    sheetLayer.append(...held.wets);
  };
  const release = () => {
    const h = held, L = layerOf(), m = T(), q = L.s / m.s, X = x => (L.a + x * L.s - m.ox) / m.s, Y = y => (L.b + y * L.s - m.oy) / m.s;
    held = null;
    for (const t of h.things){
      t.held = false;
      if (!t.el.isConnected) continue;
      const cx = X(t.x + t.w / 2), cy = Y(t.y + t.h / 2);
      t.k = (t.k ?? 1) * q; t.x = cx - t.w / 2; t.y = cy - t.h / 2; t.vx *= q; t.vy *= q;
      if (t.puff) for (const k of ['p0', 'c', 'to']){ const pt = t.puff[k]; t.puff[k] = { x: X(pt.x + t.w / 2) - t.w / 2, y: Y(pt.y + t.h / 2) - t.h / 2 }; }
      world.append(t.sh ?? '', t.el); place(t);
    }
    for (const d of h.wets){
      if (!d.isConnected) continue;
      d._x = X(d._x); d._y = Y(d._y); d._l = X(d._l); d._t = Y(d._t);
      d.style.transformOrigin = '0 0'; d.style.transform = `translate(${d._l.toFixed(1)}px, ${d._t.toFixed(1)}px) scale(${q.toFixed(4)})`;
      world.append(d);
    }
  };
  document.addEventListener(PAGES_STEP, () => {
    if (!held) return;
    if (!document.body.classList.contains('is-moving')){ release(); refreshGeo(); return; }
    const L = layerOf(); sheetLayer.style.transform = `translate(${L.a}px, ${L.b}px) scale(${L.s})`;
  });
  // a page starting to move (a pan, a pinch, a zoom) clears what lies on it with a puff from the zoom's anchor (a pan has none);
  // what lay on it rides the page and leaves it in view, then the garden sits under it until it has settled
  document.addEventListener(PAGES_MOVING, e => {
    if (held){ release(); refreshGeo(); }      // a move that came back to where it began fires no PAGES_MOVED
    if (!active || still()) return;
    refreshGeo(); if (ui.cam) hold();
    const at = e.detail?.at;
    clearPage(at ? toMat(at.x, at.y) : null); dryPage(); blowSnails(); leaving();
  });
  // while you edit, the pages can move (the panel opens, the view zooms or pans): whatever they now cover is cleared too
  document.addEventListener(PAGES_MOVED, () => {
    refreshGeo(); if (active && !still()) blowSnails();
    if (!active || !editing || resting || still()) return;
    clearPage(null); dryPage();
  });
  const typed = e => !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== 'Shift' && !(e.shiftKey && /^f$/i.test(e.key));
  for (const ev of ['pointermove', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, poke, { passive: true, capture: true });
  addEventListener('pointermove', e => sweepAt(e.clientX, e.clientY), { passive: true, capture: true });
  addEventListener('keydown', e => { if (typed(e)) clearFrom(keyOrigin(e)); }, { capture: true });
  // a press on the mat (#pages, off the pages) puffs there; while you rest it is play, so the rest goes on
  const pressAt = (o, mat) => { if (!(mat && resting)) poke(); if (mat) puffMat(o); else { px = o.x; py = o.y; clearFrom(o); } };
  addEventListener('pointerdown', e => { const o = toMat(e.clientX, e.clientY); if (e.target?.id === 'pages' && !onPage(o.x, o.y) && o.x < panel) pressAt(o, true); else poke(); }, { passive: true, capture: true });
  // what sheet.js forwards from inside the page's frame: its coordinates are the page's own pixels, so they are scaled to the window
  const toWindow = (fr, e) => { const r = fr.getBoundingClientRect(), k = r.width / (fr.offsetWidth || r.width); return { x: r.left + e.clientX * k, y: r.top + e.clientY * k }; };

  // ---- on and off ----
  const setOn = on => {
    if (on === active) return;
    active = on; box.hidden = dappleEl.hidden = !on;
    if (on){ refreshGeo(); poke(); run(); return; }
    document.body.classList.remove('g-clearing');
    clearTimeout(timer); endRain(); clearTimeout(dappleT); dappleEl.classList.remove('on');
    for (const t of [...things]) if (['bug', 'fly', 'glow', 'snail'].includes(t.kind)) drop(t);
    for (const d of box.querySelectorAll('.g-drop, .g-drop-sh, .g-splash')) d.remove();
    resting = false; working = true; paused = false; box.classList.remove('paused'); refresh();
  };

  const api = {
    setOn,
    // from the frame (shell.js hands over what sheet.js forwards)
    move(fr, e){ const p = toWindow(fr, e); poke(); sweepAt(p.x, p.y); },
    down(fr, e){ const w = toWindow(fr, e), p = toMat(w.x, w.y); refreshGeo(); pressAt(p, !onPage(p.x, p.y)); },
    key(e){ poke(); if (typed(e)) clearFrom(keyOrigin(e)); },
    wheel: poke,
  };
  if (check) api.hooks = { leaf: (x, y0, ty) => add('leaf', { x, y0, ty }), wave, lone, petals, rain, breeze, swirl, bug, snail, butterfly, fireflies, dapple, pause,
    rest: () => { refreshGeo(); resting = true; working = false; refresh(); }, work: (x, y) => { px = x; py = y; poke(); }, click: (x, y) => { px = x; py = y; poke(); clearFrom({ x, y }); } };
  return api;
}
