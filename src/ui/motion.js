// Motion that explains (UX-4). One place for the rules every moment follows:
//   - a moment is 150 to 400 ms; things arriving ease out, things leaving ease in. The durations and easings are custom properties
//     on :root (src/ui/workbench.css, --m-*), read from there, so they are tuned in one place.
//   - it never blocks input: the state has already changed when an animation starts, a new action retargets or skips the one under
//     way (play() with the same key cancels the last), and nothing queues.
//   - it is off under prefers-reduced-motion and under the Reduce motion setting (html[data-motion="reduce"]): play() then returns
//     null and nothing moves; every caller already holds the final state.
//   - the printed resume never changes: animations are Web Animations on the app's own layers (or on throwaway clones in the page's
//     frame that are removed when they end). Nothing here writes to the record or to what is exported.
// No animation library: the Web Animations API and CSS only.

const root = globalThis.document?.documentElement;      // none in Node: checks import this module
const KEY = 'rb-reduce-motion';
const mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;

const get = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
let setting = get();
const listeners = new Set();

export const readReduce = () => setting;
export const reduced = () => setting || !!mq?.matches;
export const onMotionChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
function paint(){ root?.setAttribute('data-motion', reduced() ? 'reduce' : 'full'); for (const fn of listeners) fn(reduced()); }
export function setReduce(on){
  setting = !!on;
  try { localStorage.setItem(KEY, setting ? '1' : '0'); } catch { /* this session only */ }
  if (reduced()) cancelAll();
  paint();
}
mq?.addEventListener?.('change', () => { if (mq.matches) cancelAll(); paint(); });
globalThis.addEventListener?.('storage', e => { if (e.key === KEY){ setting = get(); if (reduced()) cancelAll(); paint(); } });
paint();

// ---- the tokens ----
const css = name => (root ? getComputedStyle(root).getPropertyValue(name).trim() : '');
export const MS = { fast: '--m-fast', base: '--m-base', slow: '--m-slow', travel: '--m-travel', roll: '--m-roll', stagger: '--m-stagger' };
export const dur = (k = 'base') => { const n = parseFloat(css(MS[k] ?? k)); return Number.isFinite(n) ? n : { fast: 150, base: 240, slow: 400, travel: 300, roll: 1000, stagger: 60 }[k] ?? 240; };
export const EASE = { arrive: '--m-out', leave: '--m-in', move: '--m-inout' };
const FALLBACK = { arrive: 'cubic-bezier(.2,.8,.2,1)', leave: 'cubic-bezier(.4,0,1,1)', move: 'cubic-bezier(.4,0,.2,1)', print: 'steps(9, end)' };
export const ease = (k = 'arrive') => (EASE[k] ? css(EASE[k]) : '') || FALLBACK[k] || k;

// ---- playing ----
const live = new Map();                                 // key → Animation: one at a time per key, the newest wins
export const stats = { played: 0, names: [] };          // for checks/smoke-shell.mjs: what has started, and (under reduced motion) nothing
export function cancelAll(){
  for (const a of live.values()) { try { a.cancel(); } catch { /* already over */ } }
  live.clear();
  globalThis.document?.getElementById('motionlay')?.replaceChildren();      // whatever was flying is gone with it
}
export function cancel(key){ const a = live.get(key); if (a){ try { a.cancel(); } catch { /* already over */ } live.delete(key); } }

// play(el, keyframes, { key, ms, ease, delay, fill }) → the Animation, or null when motion is off. No fill by default: when it
// ends, the element is exactly what the document says it is.
export function play(el, keyframes, { key = null, ms = 'base', kind = 'arrive', delay = 0, fill = 'none', name = '' } = {}){
  if (reduced() || !el?.animate) return null;
  if (key) cancel(key);
  const a = el.animate(keyframes, { duration: typeof ms === 'number' ? ms : dur(ms), easing: ease(kind), delay, fill });
  stats.played++; if (name) stats.names.push(name);
  if (key){
    live.set(key, a);
    const drop = () => { if (live.get(key) === a) live.delete(key); };
    a.addEventListener('finish', drop); a.addEventListener('cancel', drop);
  }
  return a;
}
// the same, resolved when it is over (or at once when motion is off)
export const played = (el, keyframes, o) => { const a = play(el, keyframes, o); return a ? a.finished.catch(() => {}) : Promise.resolve(); };

// A throwaway layer in the app (never in the page): fixed over everything, no pointer events. Elements put in it are removed by
// their own animation's end, or all at once when motion is turned off.
export function layer(id = 'motionlay'){
  let el = document.getElementById(id);
  if (!el){ el = document.createElement('div'); el.id = id; el.className = 'motionlay'; el.setAttribute('aria-hidden', 'true'); document.body.append(el); }
  return el;
}
// a clone of something, set down where it was, to move from there to somewhere else. `box` is a screen rectangle.
export function ghost(box, html, cls = 'mo-ghost'){
  const g = document.createElement('div');
  g.className = cls; g.innerHTML = html;
  Object.assign(g.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  layer().append(g);
  return g;
}
// move a ghost from one screen rectangle to another (its box is animated, so its text is never stretched) and take it away on arrival
export function fly(g, from, to, { ms = 'slow', kind = 'move', key = null, name = 'fly' } = {}){
  const box = r => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  const a = play(g, [{ ...box(from), opacity: 1 }, { ...box(to), opacity: 0.15 }], { key, ms, kind, name, fill: 'forwards' });
  if (!a){ g.remove(); return Promise.resolve(); }
  return a.finished.catch(() => {}).then(() => g.remove());
}
