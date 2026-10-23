// The sidebar's width (UX-6 sidebar, item 4). A handle on its inner edge widens it on a big screen (pointer, or ← → on the focused handle, Shift for
// bigger steps, Home and End for the narrowest and widest); a double-click on it, or Enter, gives back the width the window would choose. Ctrl+\ (⌘\)
// or the rail's chevron folds it to the rail, and the page takes the width; the key, the chevron, a mode tab or the handle bring it back. Remembered
// per browser. The page refits by the camera's own rule (computeLayout, canvas.layout); a selection never changes the width, so the page's x moves
// only by this control. A phone keeps its bottom sheet: the control is off there.
import { t } from '../i18n/index.js';
import { SIDE_MIN, sideMax, clampSide } from './layout.js';
import { keyText } from './help.js';
import { icon } from './icons.js';

const KEY = 'rb-side', STEP = 16;
const read = () => { try { const s = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return s && typeof s === 'object' ? s : {}; } catch { return {}; } };
let S = read(), relayout = () => {}, grip = null;
// { w: the width the person set, absent for the window's own; off: folded to the rail }
export const side = () => S;
function setSide(next){
  S = { ...S, ...next };
  if (S.w == null) delete S.w;
  if (!S.off) delete S.off;
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* storage blocked: for this visit only */ }
  // a short ease when it folds or opens (no animation under reduced motion: the rule for html[data-motion=reduce] ends every transition)
  if ('off' in next) document.body.classList.add('side-moving'), setTimeout(() => document.body.classList.remove('side-moving'), 200);
  relayout();
}
export const toggleSide = () => setSide({ off: !S.off });
export const openSide = () => { if (S.off) setSide({ off: false }); };

// the handle's numbers follow the layout (called by relayout)
export function syncSide(L){
  document.body.classList.toggle('side-off', !!S.off && !L.phone);
  if (!grip) return;
  grip.hidden = !!L.phone || !L.railW;      // a phone's sheet and the start screen's column keep their own width
  grip.setAttribute('aria-valuemin', SIDE_MIN);
  grip.setAttribute('aria-valuemax', sideMax(innerWidth));
  grip.setAttribute('aria-valuenow', S.off ? 0 : Math.round(L.col.width));
  grip.setAttribute('aria-label', t('uxs.sideWidth'));
  grip.dataset.tip = `${t('uxs.sideWidth')}|${t('uxs.sideTip')}`;
  const fold = document.querySelector('#rail [data-act=side-fold]');
  if (fold){ const name = t(S.off ? 'uxs.sideShow' : 'uxs.sideHide'); fold.setAttribute('aria-expanded', String(!S.off)); fold.setAttribute('aria-label', name); fold.dataset.tip = `${name}|${keyText('Ctrl', '\\')}`; fold.innerHTML = icon(S.off ? 'left' : 'right'); }
}

export function initSide(col, onChange){
  relayout = onChange;
  grip = Object.assign(document.createElement('div'), { className: 'sidegrip', tabIndex: 0 });
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.setAttribute('aria-controls', 'body');
  grip.dataset.tipPos = 'l';
  col.append(grip);
  const now = () => (S.off ? SIDE_MIN : col.getBoundingClientRect().width);
  const to = w => setSide({ w: clampSide(w, innerWidth), off: false });
  let raf = 0;
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); grip.setPointerCapture(e.pointerId); grip.classList.add('is-drag');
    const right = col.getBoundingClientRect().right;
    const move = ev => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; to(right - ev.clientX); }); };
    const up = () => { grip.classList.remove('is-drag'); grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => setSide({ w: null, off: false }));
  grip.addEventListener('keydown', e => {
    const step = e.shiftKey ? STEP * 4 : STEP;
    const k = { ArrowLeft: () => to(now() + step), ArrowRight: () => to(now() - step), Home: () => to(SIDE_MIN), End: () => to(sideMax(innerWidth)), Enter: () => setSide({ w: null, off: false }) }[e.key];
    if (k){ e.preventDefault(); e.stopPropagation(); k(); }
  });
  // a mode tab opens a folded sidebar (the page then moves: by this control, never by a selection)
  col.addEventListener('click', e => { if (S.off && e.target.closest?.('.rtabs .tab')) openSide(); }, true);
}
