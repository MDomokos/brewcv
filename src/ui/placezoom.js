// Zoom for the Library and Career: the cards and the timeline grow or tighten, the text never changes size.
// - and + step it, 0 resets, Ctrl or Cmd with the wheel (or a trackpad pinch) steps it; each place remembers its step.
// The steps are CSS numbers on the page: --lz scales the Library's cards (200 to 380 px wide, 260 the default), --cz the Career timeline.
import { isKey } from './help.js';

const MAX = 5;
const PLACE = {
  resumes: { key: 'rb-zoom-library', css: '--lz', scale: i => (260 + i * (i < 0 ? 12 : 24)) / 260 },
  record: { key: 'rb-zoom-career', css: '--cz', scale: i => 1 + i * (i < 0 ? .06 : .08) },
};
const step = {};
const read = key => { try { const n = Number(localStorage.getItem(key)); return Number.isInteger(n) ? Math.max(-MAX, Math.min(MAX, n)) : 0; } catch { return 0; } };

function paint(view){
  const p = PLACE[view];
  document.documentElement.style.setProperty(p.css, String(p.scale(step[view])));
  try { localStorage.setItem(p.key, String(step[view])); } catch { /* this session only */ }
}
function to(view, n){ step[view] = Math.max(-MAX, Math.min(MAX, n)); paint(view); }

export function initPlaceZoom({ view, scr }){
  for (const v in PLACE){ step[v] = read(PLACE[v].key); paint(v); }
  let acc = 0;
  scr.addEventListener('wheel', e => {
    const v = view();
    if (!PLACE[v] || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    acc -= e.deltaY;
    if (Math.abs(acc) < 30) return;
    to(v, step[v] + Math.sign(acc)); acc = 0;
  }, { passive: false });
  return {
    // true when the key was a zoom key in a place that has one
    key(e){
      const v = view();
      if (!PLACE[v] || e.ctrlKey || e.metaKey || e.altKey) return false;
      if (isKey(e, '-', '_')) to(v, step[v] - 1);
      else if (isKey(e, '+', '=')) to(v, step[v] + 1);
      else if (isKey(e, '0')) to(v, 0);
      else return false;
      e.preventDefault();
      return true;
    },
  };
}
