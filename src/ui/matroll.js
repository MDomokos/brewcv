// Tea and Coffee, switched by the logo (UX-4). The tea canvas is a bamboo mat and the coffee canvas is a drawn grid; the logo is the
// switch, and what it will do is shown before it is done:
//   Tea → Coffee: the mat starts to roll up from the bottom, and the grid shows under it. Coffee → Tea: the mat starts to unroll
//   from the bottom over the grid. Hovering the logo shows the first part of that (a peek); a click, or Shift+F, or the corner buttons,
//   carries it on across the whole canvas. Leaving the logo without a click puts the mat back.
// The drink has already changed when the roll starts: html[data-drink] is the new one, and this is only a layer on the canvas
// (z-index under the page and the panel, no pointer events) that shows the old canvas going away, or the new one arriving. The two
// canvases' colours are read from the tokens of both drinks (the drink attribute is flipped and flipped back within one task,
// so nothing is painted in between) and given to the layer as --mr-* properties; the shapes are in src/ui/drinks.css.
// Never blocks input: a switch during a roll starts from where the roll is; with motion off nothing is drawn.

import { play, reduced, dur, cancel } from './motion.js';
import { onDrinkBefore, onDrinkChange } from './drink.js';

const root = document.documentElement;
const TEA = ['mat-a', 'mat-b', 'mat-c', 'mat-gap', 'mat-thread', 'mat-wash', 'mat-lit'], COFFEE = ['canvas', 'grid-major', 'grid-minor'];
const PEEK = 0.16;                     // how far a hover rolls the mat: a sixth of the canvas
// the slats are solid, so the roll goes slat by slat, not smoothly: about one step for every 34 px of canvas
const steps = frac => `steps(${Math.max(3, Math.round(innerHeight * frac / 34))}, jump-end)`;

// the tokens of a drink, whichever drink is on now
function tokensOf(drink){
  const now = root.getAttribute('data-drink');
  if (now !== drink) root.setAttribute('data-drink', drink);
  const cs = getComputedStyle(root), out = {};
  for (const k of [...TEA, ...COFFEE]) out[k] = cs.getPropertyValue(`--${k}`).trim();
  if (now !== drink){ root.setAttribute('data-drink', now); void document.body.offsetWidth; }       // settled back, so the colours' fade (drink.js) starts from what was on screen
  return out;
}

let el = null, S = null;               // the layer, and { from, to, side, x } while a roll is under way or peeking
const height = () => innerHeight;
const yOf = () => (el ? parseFloat(getComputedStyle(el).getPropertyValue('--mr-y')) || 0 : 0);

function build(from, to){
  const layer = document.createElement('div');
  layer.className = 'matroll'; layer.setAttribute('aria-hidden', 'true');
  const tk = { ...tokensOf('tea'), ...Object.fromEntries(COFFEE.map(k => [k, tokensOf('coffee')[k]])) };
  for (const k of [...TEA, ...COFFEE]) layer.style.setProperty(k === 'canvas' ? '--mr-canvas' : `--mr-${k}`, tk[k]);
  layer.dataset.kind = from === 'tea' ? 'up' : 'down';        // the mat rolls up (Tea to Coffee) or unrolls (Coffee to Tea)
  layer.innerHTML = '<div class="mr-bg"></div><div class="roller mo-roller"></div>';
  document.body.prepend(layer);
  return layer;
}
// the layer draws whichever canvas the real one is not: before the switch the new canvas, below the roller (what the roll has shown
// so far); after it the old canvas, above the roller (what is still to go)
function face(side){
  const bg = el.querySelector('.mr-bg');
  el.dataset.side = side;
  bg.dataset.bg = side === 'below' ? S.to : S.from;
}
function end(){ if (el){ cancel('matroll'); el.remove(); } el = null; S = null; root.classList.remove('mr-shadows-off'); }

// The shadows go with the mat. Tea has shadows under its windows and its page, Coffee has none; while the mat rolls, a copy of Tea's shadows
// is drawn on this layer (under the page and the panel, like the shadows themselves), clipped to where Tea still is, or already is: above
// the line as the mat rolls up into Coffee, and above it again as it unrolls down into Tea. The real shadows are held off until the roll
// ends, so nothing shows twice. The copies are box shadows of each window's own box; a page's drop shadows become box shadows of the same
// offsets and colours.
const SHADOWED = '.sheet-frame, #col > #head, #col > #body, #ptabs .ptab, #rail .rhist, .scr .tbar, .scr .rcard, .scr .recmore .srow, .scr .checklist .rectl :is(.row, .srow)';
function teaShadows(){
  const now = root.getAttribute('data-drink');
  if (now !== 'tea') root.setAttribute('data-drink', 'tea');
  const out = [];
  for (const e of document.querySelectorAll(SHADOWED)){
    const r = e.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(e);
    const drops = [...cs.filter.matchAll(/drop-shadow\(((?:rgba?\([^)]*\))|#[0-9a-f]+|[a-z]+)\s+([^)]*)\)/gi)].map(m => `${m[2]} ${m[1]}`);
    const list = [cs.boxShadow !== 'none' ? cs.boxShadow : '', ...drops].filter(Boolean).join(', ');
    if (list) out.push({ r, radius: cs.borderRadius, shadow: list });
  }
  if (now !== 'tea'){ root.setAttribute('data-drink', now); void document.body.offsetWidth; }
  return out;
}
function shadowsWith(){
  const list = teaShadows();
  if (!list.length) return;
  const box = document.createElement('div');
  box.className = 'mr-shadows';
  box.innerHTML = list.map(x => `<i style="left:${x.r.left}px;top:${x.r.top}px;width:${x.r.width}px;height:${x.r.height}px;border-radius:${x.radius};box-shadow:${x.shadow}"></i>`).join('');
  el.querySelector('.roller').before(box);
  if (S.to === 'tea') root.classList.add('mr-shadows-off');
}

// hovering the logo: the mat starts to roll (or unroll) a little
export function peek(on){
  if (reduced()) return;
  if (!on){
    if (!el || S?.committed) return;
    const a = play(el, [{ '--mr-y': `${yOf()}px` }, { '--mr-y': '0px' }], { key: 'matroll', ms: 'base', kind: steps(PEEK), fill: 'forwards', name: 'mat:unpeek' });
    const mine = el;
    (a ? a.finished.catch(() => {}) : Promise.resolve()).then(() => { if (el === mine && !S?.committed) end(); });
    return;
  }
  if (S?.committed) return;
  const from = root.getAttribute('data-drink'), to = from === 'tea' ? 'coffee' : 'tea';
  if (!el){ S = { from, to, committed: false }; el = build(from, to); face('below'); el.style.setProperty('--mr-y', '0px'); }
  play(el, [{ '--mr-y': `${yOf()}px` }, { '--mr-y': `${Math.round(height() * PEEK)}px` }], { key: 'matroll', ms: 'slow', kind: steps(PEEK), fill: 'forwards', name: 'mat:peek' });
}

function before(from, to){
  if (reduced()) return;
  if (el && S && S.from === from && !S.committed) return;       // peeking already: it carries on from there
  end();
  S = { from, to, committed: false };
  el = build(from, to); face('below'); el.style.setProperty('--mr-y', '0px');
}
function after(){
  if (!el || !S) return;
  if (reduced()){ end(); return; }
  if (S.committed) return;
  const x0 = yOf();
  S.committed = true;
  face('above');
  shadowsWith();
  el.style.setProperty('--mr-y', `${x0}px`);
  const a = play(el, [{ '--mr-y': `${x0}px` }, { '--mr-y': `${height() + 80}px` }], { key: 'matroll', ms: 'roll', kind: steps(1), fill: 'forwards', name: `mat:${el.dataset.kind}` });
  const mine = el;
  if (a) a.finished.catch(() => {}).then(() => { if (el === mine) end(); }); else end();
}

export function initMatRoll(){
  onDrinkBefore(before);
  onDrinkChange(after);
  // hovering the logo (or tabbing to it) shows what a click will do
  const logo = e => e.target.closest?.('[data-act=drink-switch]');
  document.addEventListener('pointerover', e => { const l = logo(e); if (l && e.pointerType !== 'touch' && !l.contains(e.relatedTarget)) peek(true); });
  document.addEventListener('pointerout', e => { const l = logo(e); if (l && !l.contains(e.relatedTarget)) peek(false); });
  document.addEventListener('focusin', e => { if (logo(e)?.matches(':focus-visible')) peek(true); });
  document.addEventListener('focusout', e => { if (logo(e)) peek(false); });
  addEventListener('resize', () => { if (el && !S?.committed) end(); });
  void dur;
}
