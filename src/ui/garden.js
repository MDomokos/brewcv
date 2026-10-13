// The tea garden: while you rest, the bamboo mat comes alive. Loaded by shell.js only when it can run (tea, the setting on,
// motion not reduced, not a phone, not the start screen); setOn(false) rests it (coffee, the start screen), and what lay there
// is still there when it is on again. Everything it draws is in #garden (aria-hidden, no pointer events, under the panel);
// src/ui/garden.css has the shapes. Nothing in it reaches the resume: it is drawn on the app, never in the page's frame.
//  - It starts clean. The first rest (30 s without input; input on the page counts) brings a wave of leaves.
//  - Moments come every 25-40 s while resting: common ones dealt like a shuffled deck, rare ones (the snail, the butterfly by
//    day, fireflies at night) about one time in seven. After ten idle periods (5 min) everything is still until any input.
//  - Leaves and petals land where they come down, on the mat or on the page (never behind the panel), keep about a leaf's
//    width apart, and are swept by the pointer. Settled ones fade into the mat while you work.
//  - Return: moving the mouse back clears nothing on the page. A click into the resume or a key press clears it (a gust
//    front from there), dries its wet spots, and the page stays clear: when the pages move (the canvas fires PAGES_MOVED)
//    it is cleared again. Leaves and wet spots belong to the screen, not the page.
//  - One requestAnimationFrame loop, only while something moves; drops, splashes, wet spots, the snail's trail, the dappled
//    shade and the fireflies are animated in CSS. The pages' geometry is read when the canvas says they moved.

import { PAGES_MOVED } from './canvas.js';
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
// the tea leaf, and now and then a rounder camellia leaf (px at scale 1)
const SHAPES = { s1: [30, 14], s2: [26, 17] };
const CAP = 14;
const SHAPE = { leaf: 'g-leaf', petal: 'g-petal' };

export function initGarden({ ui, canvas, idle = 30, check = false }){
  let active = false;
  const box = document.createElement('div');
  box.id = 'garden'; box.hidden = true; box.setAttribute('aria-hidden', 'true');
  const dappleEl = document.createElement('div');
  dappleEl.className = 'g-dapple'; dappleEl.hidden = true; dappleEl.setAttribute('aria-hidden', 'true');
  const rainSky = document.createElement('div');
  rainSky.className = 'g-rainsky';
  box.append(rainSky);
  document.body.append(dappleEl, box);

  // ---- the pages, the margins: read when the canvas says the pages moved ----
  let pg = [], span = null, panel = innerWidth;
  const refreshGeo = () => {
    const g = ui.geo, tabs = ui.layout?.tabs;
    panel = tabs?.width ? tabs.left : innerWidth;       // the garden keeps to the mat left of the tabs
    pg = !g || !ui.cam ? [] : Array.from({ length: g.n }, (_, i) => canvas.screenRect({ left: pageLeft(g, i), top: 0, width: g.w, height: g.h }))
      .map(r => ({ left: r.left, right: r.left + r.width, top: r.top, bottom: r.top + r.height })).filter(r => r.right > 0 && r.left < panel && r.right - r.left > 50);
    // pages side by side clear as one block: a leaf blown off one must not land on the next
    span = pg.length ? { left: Math.min(...pg.map(r => r.left)), right: Math.max(...pg.map(r => r.right)), top: Math.min(...pg.map(r => r.top)), bottom: Math.max(...pg.map(r => r.bottom)) } : null;
  };
  const onPage = (x, y) => pg.some(r => x > r.left && x < r.right && y > r.top && y < r.bottom);
  const zones = () => {
    if (!pg.length) return [];
    const pageL = span.left, pageR = span.right, right = panel - 12, z = [];
    if (pageL > 80) z.push([14, pageL - 34, 'L']);
    if (right - pageR > 80) z.push([pageR + 16, right - 34, 'R']);
    return z;
  };
  const restY = x => { let y = rnd(90, innerHeight - 90); if (x < 150 && y > innerHeight - 180) y = rnd(90, innerHeight - 200); return y; };

  // ---- things, each with its own shadow ----
  const things = [];
  const div = cls => { const el = document.createElement('div'); el.className = cls; el.setAttribute('aria-hidden', 'true'); box.append(el); return el; };
  const make = (kind, extra = '', color) => {
    const el = div(`g-thing ${SHAPE[kind] ?? `g-${kind}`} ${extra}`.trim());
    if (color) el.style.setProperty('--c', color);
    const sh = kind === 'glow' ? null : div(`g-shade ${SHAPE[kind] ? `${SHAPE[kind]} ${extra}` : `g-shade-${kind}`}`.trim());
    return { el, sh };
  };
  const size = (el, w, h) => { el.style.width = w + 'px'; el.style.height = h + 'px'; };
  let working = true; // not resting
  const place = t => {
    const L = t.lift ?? 0;
    // settled on the mat while you work: part of the mat's texture
    const settled = t.landed && !t.moving && L === 0;
    const o = (t.o ?? 1) * (settled && working ? .38 : 1);
    // scale belongs inside the transform: the CSS scale property would scale the translation too
    t.el.style.transform = `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) rotate(${t.a.toFixed(1)}deg) scale(${((t.flip ? -1 : 1) * (t.k ?? 1)).toFixed(2)}, ${(t.k ?? 1).toFixed(2)})`;
    // fading into (or out of) the mat's texture eases; falling, moving and going away don't
    const ease = settled && !t.fade;
    t.el.style.transition = ease ? 'opacity 2.5s ease, filter 6s ease' : t.fade ? 'none' : 'filter 6s ease';
    t.el.style.opacity = o.toFixed(2);
    if (t.sh){
      // the offset is on the screen, not on the thing: the light doesn't turn when the leaf does. One continuous function
      // of height, so landing doesn't pop: close, crisp and faint on the mat; farther and softer the higher it is.
      const ox = 1 + 16 * L, oy = 1.4 + 22 * L, turn = t.kind === 'leaf' || t.kind === 'petal' || t.kind === 'fly' ? t.a : 0;
      // a curled leaf isn't flat: its shadow is skewed and narrower
      const curl = t.curl ? ` skewX(${t.curl.k.toFixed(1)}deg) scale(${t.curl.sx.toFixed(2)}, 1)` : '';
      t.sh.style.transform = `translate(${(t.x + ox).toFixed(1)}px, ${(t.y + oy).toFixed(1)}px) rotate(${turn.toFixed(1)}deg) scale(${(t.k ?? 1).toFixed(2)})${curl}`;
      t.sh.style.filter = `blur(${(.4 + 4.2 * L).toFixed(1)}px)`;
      t.sh.style.transition = ease ? 'opacity 2.5s ease' : 'none';
      t.sh.style.opacity = (o * (.45 + 1.4 * L * (1 - L))).toFixed(2);
    }
  };
  const drop = t => { const i = things.indexOf(t); if (i >= 0) things.splice(i, 1); t.el.remove(); t.sh?.remove(); };
  const lying = () => things.filter(t => t.kind === 'leaf' || t.kind === 'petal');
  const staying = () => lying().filter(t => !t.fade && !t.keepGoing);
  const settle = t => { t.fall = null; t.el.classList.remove('falling'); t.sh?.classList.remove('falling'); t.landed = true; t.el.classList.add('landed'); };
  const land = t => {
    t.lift = 0; t.fall = null; t.el.classList.remove('falling'); t.sh?.classList.remove('falling');
    setTimeout(() => { t.landed = true; t.el.classList.add('landed'); place(t); }, 500);
    nudge(t);
  };
  // keep about a leaf's width apart: ease apart from any too close
  const nudge = t => {
    for (const o of staying()){
      if (o === t || o.fall) continue;
      // two leaves both beside the page spread along the margin only: a push sideways could set one back on the page
      const m = span ? (span.left + span.right) / 2 : 0, side = !onPage(t.x + t.w / 2, t.y + t.h / 2) && !onPage(o.x + o.w / 2, o.y + o.h / 2) && (t.x + t.w / 2 < m) === (o.x + o.w / 2 < m), dx = side ? 0 : (t.x + t.w / 2) - (o.x + o.w / 2), dy = (t.y + t.h / 2) - (o.y + o.h / 2) || rnd(-1, 1), d = Math.hypot(dx, dy) || .1;
      const min = (Math.max(t.w, t.h) + Math.max(o.w, o.h)) * .55;
      if (d < min){ const k = (min - d) / min * 1.6; t.vx += dx / d * k; t.vy += dy / d * k; o.vx -= dx / d * k * .6; o.vy -= dy / d * k * .6; o.moving = true; }
    }
    run();
  };
  const add = (kind, opts = {}) => {
    let shape = '', w = 20, h = 17;
    if (kind === 'leaf'){ shape = Math.random() < .75 ? 's1' : 's2'; const k = rnd(.85, 1.3); [w, h] = SHAPES[shape].map(v => Math.round(v * k)); }
    else { const k = rnd(.9, 1.2); w = Math.round(20 * k); h = Math.round(17 * k); }
    const { el, sh } = make(kind, shape, kind === 'leaf' ? pick(night() ? LEAF_NIGHT : LEAF) : pick(PETAL));
    size(el, w, h); if (sh) size(sh, w, h);
    const x0 = Math.max(0, Math.min(innerWidth - w, opts.x ?? rnd(0, panel - w)));
    const curl = kind === 'leaf' && Math.random() < .4 ? { k: rnd(-22, 22), sx: rnd(.72, .92) } : null;
    const t = { el, sh, kind, curl, x: x0, y: -30 - rnd(0, 40), a: rnd(0, 360), vx: 0, vy: 0, va: 0, lift: 1, w, h,
      fall: { ty: restY(x0), ph: rnd(0, 6), sp: kind === 'petal' ? rnd(.3, .4) : rnd(.42, .6), amp: kind === 'petal' ? .8 : .55, wind: opts.wind ?? 0 } };
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
    // rAF's timestamp can be earlier than the performance.now() taken in run(): never let dt go negative
    const dt = Math.max(.25, Math.min(3, (now - last) / 16.67)); last = now;
    let busy = false;
    for (const t of [...things]){
      if (t.fade){ t.o = (t.o ?? 1) - .03 * dt; if (t.o <= 0){ drop(t); continue; } place(t); busy = true; }
      const step = STEP[t.kind];
      if (step){ busy = step(t, dt) || busy; continue; }
      if (t.carry){
        const c = t.carry, w = c.w;
        if (c.delay > 0){ c.delay -= dt; busy = true; continue; }
        // the whirl's centre moves once a frame, however many leaves it carries
        if (w.at !== now){ w.at = now; w.cx += w.vx * dt; w.cy += w.vy * dt; w.vx *= Math.pow(1.004, dt); }
        c.t += dt; c.ph += w.spin * dt * (1 + 18 / c.r); c.r = Math.max(10, c.r * Math.pow(.997, dt) + .03 * dt);
        t.lift = Math.min(.7, c.t / 90);
        t.x = w.cx + Math.cos(c.ph) * c.r; t.y = w.cy + Math.sin(c.ph) * c.r * .6 - t.lift * 30; t.a += (4 + 6 * t.lift) * dt * Math.sign(w.spin);
        if (t.x < -80 || t.x > innerWidth + 80 || t.y < -80){ drop(t); continue; }
        place(t); busy = true; continue;
      }
      if (t.gust){
        if (performance.now() < t.gust.at){ busy = true; continue; }
        // ease in: the gust's speed is reached over about half a second
        const g = t.gust; g.ramp = Math.min(1, (g.ramp ?? 0) + .035 * dt);
        t.vx += (g.vx * g.ramp - t.vx) * .25; t.vy += (g.vy * g.ramp - t.vy) * .25; t.va += (g.va * g.ramp - t.va) * .25;
        if (g.ramp >= 1){ t.gust = null; t.glide = true; }
      }
      if (t.swirl){
        const s = t.swirl; s.t += dt; s.ph += s.w * dt; s.r += .05 * dt;
        t.lift = Math.sin(Math.PI * Math.min(1, s.t / s.dur)) * .75;
        t.x = s.cx + Math.cos(s.ph) * s.r; t.y = s.cy + Math.sin(s.ph) * s.r * .6 - t.lift * 26; t.a += 5 * dt;
        if (s.t >= s.dur){ t.swirl = null; t.lift = 0; t.vx = Math.cos(s.ph) * 1.2; t.vy = Math.sin(s.ph) * .8; t.moving = true; nudge(t); }
        place(t); busy = true; continue;
      }
      if (t.fall){
        const f = t.fall; f.ph += .018 * dt;
        t.y += f.sp * dt; t.x += (f.wind + Math.sin(f.ph) * f.amp) * dt; t.a += (Math.sin(f.ph * .9) + f.wind * .8) * dt;
        t.lift = Math.max(0, Math.min(1, (f.ty - t.y) / (f.ty + 30)));
        // blown out of the screen, or about to land behind the panel: it goes on by
        if (t.x < -60 || t.x > innerWidth + 20 || (t.y >= f.ty && t.x > panel - t.w)){ if (t.y > innerHeight + 40 || t.x < -60 || t.x > innerWidth + 20){ drop(t); continue; } f.ty = innerHeight + 60; }
        if (t.y >= f.ty){ t.y = f.ty; land(t); t.vx = (f.wind + Math.sin(f.ph) * f.amp) * .8; t.vy = f.sp * .6; t.va = rnd(-1, 1); t.moving = true; }
        place(t); busy = true; continue;
      }
      if (Math.abs(t.vx) + Math.abs(t.vy) + Math.abs(t.va) > .04 || t.gust){
        t.moving = true;
        t.va = Math.max(-16, Math.min(16, t.va));
        t.x += t.vx * dt; t.y += t.vy * dt; t.a += t.va * dt;
        t.lift = Math.min(.35, (Math.abs(t.vx) + Math.abs(t.vy)) / 30); // a swept leaf lifts a little off the mat
        const k = Math.pow(t.keepGoing ? .995 : t.glide ? .975 : .86, dt); t.vx *= k; t.vy *= k;
        t.va *= Math.pow(t.keepGoing ? .99 : t.glide ? .975 : .86, dt);
        if (t.x < -60 || t.y < -60 || t.x > innerWidth + 60 || t.y > innerHeight + 60){ drop(t); continue; }
        place(t); busy = true;
      } else if (!t.gust && (t.moving || t.lift)){ t.vx = t.vy = t.va = 0; t.lift = 0; t.moving = false; t.glide = false; nudge(t); place(t); }
    }
    if (busy) requestAnimationFrame(tick); else running = false;
  }

  // ---- sweeping: the pointer pushes what it passes through, over the mat and over the page ----
  let px = null, py = null;
  const sweepAt = (x, y) => {
    if (px === null || !active || still()){ px = x; py = y; return; }
    const dx = x - px, dy = y - py; px = x; py = y;
    if (!dx && !dy) return;
    for (const t of things){
      if (t.kind === 'bug' && Math.hypot(t.x - px, t.y - py) < 90){ t.flee = true; continue; }
      if (t.kind === 'snail' && Math.hypot(t.x - px, t.y - py) < 80){ t.hide = 360; t.el.classList.add('hid'); continue; }
      if (t.kind !== 'leaf' && t.kind !== 'petal') continue;
      const cx = t.x + t.w / 2, cy = t.y + t.h / 2, d = Math.hypot(cx - px, cy - py), R = Math.max(46, t.w * .9);
      if (d > R) continue;
      const nx = (cx - px) / (d || 1), ny = (cy - py) / (d || 1), s = 1 - d / R;
      if (t.fall) settle(t);
      t.swirl = null; t.moving = true;
      t.vx += (dx * .32 + nx * 1.2) * s; t.vy += (dy * .32 + ny * 1.2) * s; t.va += (dx * ny - dy * nx) * .45 * s;
      const sp = Math.hypot(t.vx, t.vy); if (sp > 22){ t.vx *= 22 / sp; t.vy *= 22 / sp; }
      run();
    }
  };

  // ---- the breeze that clears the page: from a click into it, or from the pointer for a key ----
  const clearPage = (x, y) => {
    let any = false;
    for (const t of staying()){
      const cx = t.x + t.w / 2, cy = t.y + t.h / 2, r = span;
      if (!r || !(cx > r.left && cx < Math.min(r.right, panel) && cy > r.top && cy < r.bottom)) continue;   // what lies under the panel is not on the page
      // away from the pointer, to the nearer side of the page; with the mat's drag a leaf travels about 6x its speed
      let dir = Math.abs(cx - x) < 20 ? (cx - r.left < r.right - cx ? -1 : 1) : Math.sign(cx - x);
      if (dir > 0 && r.right + 60 > panel) dir = -1;      // never off the page into the hiding place under the panel
      const dist = dir > 0 ? r.right + rnd(18, 60) - t.x : r.left - t.w - rnd(18, 60) - t.x;
      if (t.fall) settle(t);
      t.swirl = null;
      // a gust front spreading from the pointer (nearer leaves first), and a long, gentle glide: with the glide's lighter
      // drag (0.975 a frame) a leaf travels about 39 times its starting speed
      const delay = Math.hypot(cx - x, cy - y) / .9;
      t.gust = { at: performance.now() + delay, vx: dist / 35 * rnd(1, 1.08), vy: rnd(-.25, .25) + (cy - y) * .002, va: dir * rnd(.8, 2) };
      t.moving = true; any = true;
    }
    if (any){ setTimeout(breezeTags, 250); run(); }
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
    const ls = staying(), go = ls.length >= 8 ? ls.slice(0, Math.ceil(ls.length / 2)) : [];
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
  const side = () => { const z = zones(); if (!z.length) return null; const zz = z.find(q => q[2] === 'L') ?? z[0]; return { a: zz[0], b: zz[1], home: zz[2] === 'L' ? -40 : panel + 20 }; };
  // each returns false when it can't come (no margin beside the page, or one is already out), so the moment isn't lost
  const bug = () => {
    const s = side(); if (!s || things.some(t => t.kind === 'bug')) return false;
    const { el, sh } = make('bug', `walking ${pick(['sp2', 'sp4', 'sp6', 'sp7', 'sp7'])}`);
    const y = rnd(120, innerHeight - 220);
    things.push({ el, sh, kind: 'bug', x: s.home, y, a: s.home < 0 ? 90 : 270, home: s.home, a0: s.a, b0: s.b, life: rnd(1300, 1900), lift: 0, w: 16, h: 18 }); run(); return true;
  };
  const snail = () => {
    const s = side(); if (!s || things.some(t => t.kind === 'snail')) return false;
    const { el, sh } = make('snail');
    el.innerHTML = '<i class="s-body"></i><i class="eye a"></i><i class="eye b"></i><i class="shell"></i>';
    const inward = s.home < 0 ? 1 : -1;
    things.push({ el, sh, kind: 'snail', flip: inward < 0, dir: inward, x: s.home, y: rnd(innerHeight * .45, innerHeight - 230), a: 0, home: s.home,
      turnAt: s.home < 0 ? s.a + (s.b - s.a) * rnd(.45, .7) : s.b - (s.b - s.a) * rnd(.45, .7), trail: 0, lift: 0, hide: 0, w: 34, h: 22 }); run(); return true;
  };
  const butterfly = () => {
    const s = side(); if (!s || things.some(t => t.kind === 'fly')) return false;
    const { el, sh } = make('fly', pick(['amber', 'pale']));
    el.innerHTML = '<i class="w l"></i><i class="w r"></i><b></b>';
    const y = rnd(120, innerHeight - 260);
    things.push({ el, sh, kind: 'fly', x: s.home, y, y0: y, a: s.home < 0 ? 90 : 270, u: 0, home: s.home, reach: (s.b - s.a) * rnd(.6, 1) + 60, lift: 1, w: 46, h: 34 }); run(); return true;
  };
  const fireflies = () => {
    const z = zones(); if (!z.length) return false;
    for (let k = 0; k < 6; k++){
      const [a, b] = pick(z);
      const { el } = make('glow'); el.style.animationDelay = rnd(0, 3) + 's';
      things.push({ el, kind: 'glow', x: rnd(a, b), y: rnd(80, innerHeight - 120), a: 0, life: rnd(900, 1400), vx: rnd(-.2, .2), vy: rnd(-.2, .2), w: 10, h: 10 });
    }
    run(); return true;
  };
  let dappleT = null;
  const dapple = () => { dappleEl.classList.add('on'); clearTimeout(dappleT); dappleT = setTimeout(() => dappleEl.classList.remove('on'), 50000); };

  // ---- rain: a shower in gusts; each drop falls, splashes, and leaves a wet spot that darkens the page or the mat and
  //      evaporates slowly. Drops and spots are CSS-animated, so the loop above isn't needed for them. ----
  const wets = [];
  let raining = false, rainT = null;
  const endRain = () => { raining = false; clearTimeout(rainT); rainSky.classList.remove('on'); };
  const wet = (x, y) => {
    if (!resting && onPage(x, y)) return;
    const d = div('g-wet'), r = rnd(5, 12);
    Object.assign(d.style, { width: `${r * 2}px`, height: `${r * rnd(1.6, 2)}px`, transform: `translate(${(x - r).toFixed(0)}px, ${(y - r).toFixed(0)}px)` });
    d.style.setProperty('--life', `${rnd(60, 100).toFixed(0)}s`);   // a variable, so the 1.4 s drying (.dry) isn't overridden
    d._x = x; d._y = y; wets.push(d);
    d.addEventListener('animationend', () => { d.remove(); const i = wets.indexOf(d); if (i >= 0) wets.splice(i, 1); });
    while (wets.length > 140) wets.shift().remove();
  };
  const splash = (x, y) => { const sp = div('g-splash'); sp.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`; sp.addEventListener('animationend', () => sp.remove()); };
  // a drop falls toward the screen from in front of it: it appears where it will land and grows toward the surface,
  // its shadow closing in under it, then it splashes
  const drop1 = () => {
    const x = rnd(0, panel - 6), y = rnd(30, innerHeight - 20), d = div('g-drop'), sh = div('g-drop-sh');
    for (const e of [d, sh]){ e.style.left = `${x.toFixed(0)}px`; e.style.top = `${y.toFixed(0)}px`; }
    const ms = rnd(260, 380); d.style.animationDuration = sh.style.animationDuration = `${ms.toFixed(0)}ms`;
    d.addEventListener('animationend', () => { d.remove(); sh.remove(); if (!active) return; splash(x, y); wet(x, y); });
  };
  const rain = () => {
    if (raining) return;
    raining = true; rainSky.classList.add('on');
    const dur = rnd(25000, 40000), t0 = performance.now(), gusts = rnd(2, 3.2);
    const spawn = () => {
      if (!raining || !active || paused || !resting) return endRain();
      const u = (performance.now() - t0) / dur;
      if (u >= 1) return endRain();
      // swells and eases: a hump over the whole shower, with two or three gusts in it
      const rate = 1 + 11 * Math.pow(Math.sin(Math.PI * u), 2) * (.55 + .45 * Math.sin(u * Math.PI * 2 * gusts));
      drop1();
      rainT = setTimeout(spawn, 1000 / Math.max(1, rate));
    };
    spawn();
  };
  // on return: the rain stops and the resume page dries (the mat goes on drying slowly)
  const dryPage = () => {
    for (const d of wets) if (onPage(d._x, d._y)) d.classList.add('dry');
    for (const d of box.querySelectorAll('.g-drop, .g-drop-sh')) d.remove(); // drops still on their way don't land
  };

  const steer = (t, tx, ty, turn) => { const want = Math.atan2(ty - t.y, tx - t.x) * 180 / Math.PI + 90; let d = ((want - t.a + 540) % 360) - 180; t.a += Math.max(-turn, Math.min(turn, d)); };
  const STEP = {
    bug(t, dt){
      const leaving = t.flee || t.life <= 0 || !active || paused;
      t.life -= dt; t.ph = (t.ph ?? rnd(0, 6)) + .045 * dt;
      // never a straight line: a slow swing in the heading and a little jitter on top, whatever it's doing
      const wob = Math.sin(t.ph) * 2.2 + Math.sin(t.ph * 2.7) * 1.1 + rnd(-1.2, 1.2);
      if (leaving) steer(t, t.home, t.y + Math.sin(t.ph * .7) * 80, 6 * dt);
      else if (t.x < t.a0 || t.x > t.b0) steer(t, (t.a0 + t.b0) / 2, t.y, 3 * dt);
      else if (t.y < 60 || t.y > innerHeight - 200) steer(t, t.x, innerHeight / 2, 4 * dt);
      t.a += wob * dt;
      const sp = leaving && t.flee ? 1.4 : .32, r = (t.a - 90) * Math.PI / 180;
      t.x += Math.cos(r) * sp * dt; t.y += Math.sin(r) * sp * dt;
      if (leaving && (t.x < -50 || t.x > panel + 40)){ drop(t); return false; }
      place(t); return true;
    },
    snail(t, dt){
      if (t.hide > 0){ t.hide -= dt; if (t.hide <= 0) t.el.classList.remove('hid'); place(t); return true; }
      if (!t.back && (paused || !active || (t.dir > 0 ? t.x >= t.turnAt : t.x <= t.turnAt))){ t.back = true; t.dir = -t.dir; t.flip = !t.flip; t.pause = 200; }
      if (t.pause > 0){ t.pause -= dt; place(t); return true; }
      t.ph = (t.ph ?? rnd(0, 6)) + .01 * dt;
      const vy = (Math.sin(t.ph) * .07 + Math.sin(t.ph * 2.3) * .025) + rnd(-.006, .006);
      t.x += t.dir * .09 * dt; t.y += vy * dt; t.trail += .09 * dt;
      t.a = Math.atan(vy / .09) * 180 / Math.PI * t.dir; // its nose follows the path
      if (t.trail > 9){ t.trail = 0; const d = div('g-trail'); d.style.transform = `translate(${(t.x + (t.dir > 0 ? 2 : 28)).toFixed(0)}px, ${(t.y + 18).toFixed(0)}px) rotate(${t.a.toFixed(0)}deg)`; d.addEventListener('animationend', () => d.remove()); }
      if (t.back && (t.x < -50 || t.x > panel + 40)){ drop(t); return false; }
      place(t); return true;
    },
    // in from the side on a loop over the margin, and back out the same side
    fly(t, dt){
      t.u += .0016 * dt;
      const inward = t.home < 0 ? 1 : -1, s = Math.sin(Math.PI * Math.min(1, t.u));
      const nx = t.home + inward * s * t.reach, ny = t.y0 + Math.sin(2 * Math.PI * t.u) * 70 + Math.sin(t.u * 40) * 6;
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
      t.vx += rnd(-.015, .015) * dt; t.vy += rnd(-.015, .015) * dt; t.vx *= .985; t.vy *= .985;
      t.x += t.vx * dt; t.y += t.vy * dt; place(t); return true;
    },
  };

  const MOMENTS = [wave, wave, wave, petals, petals, rain, swirl, bug, dapple, lone];
  // common moments are dealt like a shuffled deck, so each comes round once a cycle; rare ones (the snail, the
  // butterfly by day, fireflies at night) only slip in now and then, so spotting one stays a small surprise
  let lastMoment = null, first = true, deck = [];
  const RARE_CHANCE = .15;
  const deal = () => { deck = [...MOMENTS].sort(() => Math.random() - .5); };
  const rare = () => pick(night() ? [snail, fireflies, fireflies] : [snail, butterfly, butterfly]);
  const moment = () => {
    refreshGeo();
    // the first time you rest, the garden shows itself with a wave of leaves
    if (first){ first = false; lastMoment = wave; wave(); return; }
    if (staying().length >= 12){ lastMoment = breeze; breeze(); return; }
    if (Math.random() < RARE_CHANCE){ const f = rare(); if (f !== lastMoment && f() !== false){ lastMoment = f; return; } }
    for (let tries = 0; tries < 30; tries++){
      if (!deck.length) deal();
      const f = deck.shift();
      if (f === lastMoment){ deck.push(f); continue; }
      if (f === swirl && staying().length < 2) continue;
      if (f === rain && raining) continue;
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
  const leave = () => { for (const t of things){ if (t.kind === 'bug') t.flee = true; if (t.kind === 'glow') t.leave = true; if (t.kind === 'snail') t.back = true; } };
  const pause = () => {
    paused = true; box.classList.add('paused');
    leave(); dappleEl.classList.remove('on'); endRain(); run();
  };
  const loopMoments = () => {
    if (still() || document.hidden){ timer = setTimeout(loopMoments, 5000); return; }
    if (!resting){ resting = true; working = false; editing = false; restStart = performance.now(); refresh(); }
    if (performance.now() - restStart > PAUSE){ pause(); return; }
    // moments come every 0.83 to 1.33 idle periods: 25 to 40 seconds at the default 30, closer together when a
    // shorter wake is set for a check, so the ten periods before the pause hold the same number of moments
    moment(); timer = setTimeout(loopMoments, IDLE * rnd(.83, 1.33));
  };
  const poke = () => {
    if (!active) return;
    clearTimeout(timer);
    if (paused){ paused = false; box.classList.remove('paused'); }
    if (resting){ resting = false; working = true; leave(); endRain(); for (const t of things) if (t.fall) t.fall.ty = innerHeight + 60; refresh(); run(); }   // what is still falling goes on by: nothing lands while you work
    timer = setTimeout(loopMoments, IDLE);
  };
  // the page is cleared only when you click into it or start typing. Just coming back and looking leaves it as it is.
  let lastClear = 0;
  const clearFrom = (x, y) => {
    if (!active || still()) return;
    editing = true; refreshGeo();
    if (performance.now() - lastClear < 1200) return;
    lastClear = performance.now();
    clearPage(x, y); dryPage();
  };
  // while you edit, the pages can move (the panel opens, the view zooms or pans): whatever they now cover is cleared too
  document.addEventListener(PAGES_MOVED, () => {
    refreshGeo();
    if (!active || !editing || resting || still()) return;
    clearPage(px ?? innerWidth / 2, py ?? innerHeight / 2); dryPage();
  });
  const typed = e => !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== 'Shift' && !(e.shiftKey && /^f$/i.test(e.key));
  const keyed = () => { poke(); clearFrom(px ?? innerWidth / 2, py ?? innerHeight / 2); };
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, poke, { passive: true, capture: true });
  addEventListener('pointermove', e => sweepAt(e.clientX, e.clientY), { passive: true, capture: true });
  addEventListener('keydown', e => { if (typed(e)) clearFrom(px ?? innerWidth / 2, py ?? innerHeight / 2); }, { capture: true });
  // what sheet.js forwards from inside the page's frame: its coordinates are the page's own pixels, so they are scaled to the window
  const toWindow = (fr, e) => { const r = fr.getBoundingClientRect(), k = r.width / (fr.offsetWidth || r.width); return { x: r.left + e.clientX * k, y: r.top + e.clientY * k }; };

  // ---- on and off ----
  const setOn = on => {
    if (on === active) return;
    active = on; box.hidden = dappleEl.hidden = !on;
    if (on){ refreshGeo(); poke(); run(); return; }
    clearTimeout(timer); endRain(); clearTimeout(dappleT); dappleEl.classList.remove('on');
    for (const t of [...things]) if (['bug', 'fly', 'glow', 'snail'].includes(t.kind)) drop(t);
    for (const d of box.querySelectorAll('.g-drop, .g-drop-sh, .g-splash')) d.remove();
    resting = false; working = true; paused = false; box.classList.remove('paused'); refresh();
  };

  const api = {
    setOn,
    // from the frame (shell.js hands over what sheet.js forwards)
    move(fr, e){ const p = toWindow(fr, e); poke(); sweepAt(p.x, p.y); },
    down(fr, e){ const p = toWindow(fr, e); poke(); px = p.x; py = p.y; clearFrom(p.x, p.y); },
    key(e){ if (typed(e)) keyed(); else poke(); },
    wheel: poke,
  };
  if (check) api.hooks = { wave, lone, petals, rain, breeze, swirl, bug, snail, butterfly, fireflies, dapple, pause,
    rest: () => { refreshGeo(); resting = true; working = false; refresh(); }, work: (x, y) => { px = x; py = y; poke(); }, click: (x, y) => { px = x; py = y; poke(); clearFrom(x, y); } };
  return api;
}
