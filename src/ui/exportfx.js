// What an export looks like (UX-4): one for each drink, in its own style, played over the app after the download has started (the
// export itself never waits for it).
//   Tea:    the page is rolled up like the bamboo mat into a scroll, which is carried to the button, with a little steam.
//   Coffee: a thin crema line reads the page from top to bottom, then a till receipt is printed under the button, line by line.
// `from` is the page's box on the screen, `to` the button that was pressed; both screen rectangles. Colours are the drink's tokens
// (src/ui/drinks.css, .fx-*). Under reduced motion nothing is drawn.

import { played, play, ghost, reduced, layer, dur } from './motion.js';
import { t } from '../i18n/index.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const box = r => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
const el = (cls, html = '', r = null) => { const e = document.createElement('div'); e.className = cls; e.innerHTML = html; if (r) Object.assign(e.style, box(r)); layer().append(e); return e; };

export async function exportFx({ drink, from, to, fmt = 'PDF', pages = 1 }){
  if (reduced() || !to) return;
  from ??= { left: to.left - 260, top: to.top - 160, width: 200, height: 280 };
  try { await (drink === 'coffee' ? coffee(from, to, fmt, pages) : tea(from, to, fmt)); } catch { /* it is only a picture */ }
}

async function tea(from, to, fmt){
  const slow = dur('slow');
  // 1. the mat is laid over the page from the bottom up, a roll of solid slats at its edge, so the page is wrapped in it (slat by slat)
  const H = from.height, st = `steps(${Math.max(3, Math.round(H / 34))}, jump-end)`;
  const mat = el('mo-mat', '', from);
  const roll = el('mo-roller fx-roll', '', { left: from.left, top: from.top + H - 14, width: from.width, height: 14 });
  await Promise.all([
    played(mat, [{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { ms: slow, kind: st, fill: 'forwards', name: 'export:tea-wrap' }),
    played(roll, [{ top: `${from.top + H - 14}px` }, { top: `${from.top}px` }], { ms: slow, kind: st, fill: 'forwards', name: 'export:tea-roll' }),
  ]);
  // 2. the wrapped page is carried to the button, shrinking to a small scroll, and gives off a little steam
  const end = { left: to.left + to.width / 2 - 9, top: to.top + to.height / 2 - 12, width: 18, height: 24 };
  const steam = el('fx-steam', '', { left: end.left - 2, top: end.top - 18, width: 22, height: 18 });
  steam.style.opacity = '0';
  roll.remove();
  await played(mat, [{ ...box(from), borderRadius: '2px' }, { ...box(end), borderRadius: '9px' }], { ms: slow, kind: 'move', fill: 'forwards', name: 'export:tea-carry' });
  await played(steam, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(-2px)', offset: 0.4 }, { opacity: 0, transform: 'translateY(-14px)' }], { ms: slow, kind: 'arrive', fill: 'forwards', name: 'export:tea-steam' });
  mat.remove(); steam.remove();
}

async function coffee(from, to, fmt, pages){
  const slow = dur('slow');
  // 1. a crema line reads the page, top to bottom; what it has read is tinted
  const read = el('fx-read', '', { left: from.left, top: from.top, width: from.width, height: 0 });
  const scan = el('fx-scan', '', { left: from.left, top: from.top, width: from.width, height: 2 });
  await Promise.all([
    played(scan, [{ transform: 'translateY(0)' }, { transform: `translateY(${from.height - 2}px)` }], { ms: slow, kind: 'move', fill: 'forwards', name: 'export:coffee-scan' }),
    played(read, [{ height: '0px' }, { height: `${from.height}px` }], { ms: slow, kind: 'move', fill: 'forwards', name: 'export:coffee-read' }),
  ]);
  await played(read, [{ opacity: 1 }, { opacity: 0 }], { ms: 'fast', kind: 'leave', fill: 'forwards', name: 'export:coffee-fade' });
  read.remove(); scan.remove();
  // 2. the receipt prints under the button, a line at a time (the print is stepped), stays a moment, and tears off upward
  const rows = [t('ux4.fxExport'), `${fmt} · ${t('head.pages', { n: pages })}`, '------------', t('ux4.fxDone')];
  const w = Math.max(150, to.width);
  const r = { left: Math.max(6, Math.min(innerWidth - w - 6, to.left + to.width - w)), top: to.top + to.height + 4, width: w, height: 0 };
  const ticket = el('fx-ticket', rows.map(x => `<p>${esc(x)}</p>`).join(''), r);
  ticket.style.height = 'auto';
  await played(ticket, [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0 0)' }], { ms: slow, kind: 'print', fill: 'forwards', name: 'export:coffee-print' });
  await played(ticket, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 1, transform: 'translateY(0)', offset: 0.7 }, { opacity: 0, transform: 'translateY(-10px)' }], { ms: slow * 2, kind: 'leave', fill: 'forwards', name: 'export:coffee-tear' });
  ticket.remove();
}
