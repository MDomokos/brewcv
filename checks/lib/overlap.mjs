// What the app draws over the page must not overlap (UX-6f 4c): the plate and its ring trail, the grip, the "+", the version tools, the depth chip, the socket, the
// drop line, the bumper rail, the card, the search, preview and missing-text marks, the zoom bar and the photo slot. shapes(page) collects every one that is shown, in screen
// pixels, from the app's layers (#editlay, #handlay, the zoom bar, an open list of the chip's) and from the page's frame; overlaps(list) returns the pairs that overlap beyond what the design means
// (ALLOWED), and every shape that covers printed text that is not its own. An outline (a ring, the rail, a socket, a mark) is its stroke only: a shape inside it does not
// overlap it. The veil that dims the page outside a job is a dimmer, not a mark: it is left out.

// The pairs the design means, each with why. `touch`: they may overlap by at most this many px (a tab's face over its plate's line); `inside`: the first may stand inside the
// second's box (nesting), crossing nothing.
export const ALLOWED = [
  { a: 'grip', b: 'plate', inside: true, why: 'the grip is a clear button over the left tab of its plate, which draws the dots itself (direct editing C, item 4): it stands inside the plate\'s box' },
  { a: 'plate', b: 'plus', touch: 3, why: 'on the last line the "+" is the plate\'s bottom tab: its face lies over the plate\'s line' },
  { a: 'chip', b: 'plate', touch: 99, why: 'the depth chip stands on the top edge of the plate of the block it names (UX-6c)' },
  { a: 'chip', b: 'ring', touch: 99, why: 'the depth chip stands on the top edge of its frame, which may be a ring behind the selection' },
  { a: 'lift', b: 'socket', touch: 1e9, why: 'a lifted block travels over its own socket (where it came from, where it will land)' },
  { a: 'card', b: 'socket', touch: 1e9, why: 'a large block\'s card travels over its own socket' },
  { a: 'lift', b: 'rail', touch: 1e9, why: 'the rail is the container the lifted block moves in; the block is drawn over it (in the frame, under the lift)' },
  { a: 'card', b: 'rail', touch: 1e9, why: 'the same for a large block\'s card' },
  { a: 'lift', b: 'drop', touch: 1e9, why: 'the drop line marks the place the lifted block is over; it is drawn under the block' },
  { a: 'card', b: 'drop', touch: 1e9, why: 'the same for a large block\'s card' },
  { a: 'grip', b: 'socket', touch: 3, why: 'a grip held in a drag stays at the block\'s home, flush on its socket' },
  { a: 'list', b: 'chip', touch: 1e9, why: 'a level\'s list hangs from its level in the chip' },
  { a: 'list', b: 'plate', touch: 1e9, why: 'the chip\'s open list is a popover over the block the chip names (it closes on leave, Esc or a choice); the hands and the tools step aside while it is open' },
  { a: 'list', b: 'ring', touch: 1e9, why: 'the same over the rings of what the block is part of' },
  { a: 'grip', b: 'ring', touch: 1, why: 'a line\'s grip is its plate\'s tab, which reaches across the hairline ring of its job (a ring around its child): drawn over it, the ring passes under the tab' },
  { a: 'plus', b: 'ring', touch: 1, why: 'the same for the "+" under a job\'s last line: the plate\'s bottom tab reaches across the job\'s ring' },
  { a: 'socket', b: 'rail', touch: 1, why: 'the socket is one of the places and the rail their box, at the same stand-off: at the first and the last place their hairlines lie on one another' },
];
const allowed = (a, b) => ALLOWED.find(p => (p.a === a.kind && p.b === b.kind) || (p.a === b.kind && p.b === a.kind));

// every shape shown, in screen px: { kind, name, rect, stroke (0: filled), about (the box of the block it belongs to, screen px, or null), own (the indices of the texts
// printed inside that block) }, and the printed text: `texts`, one rectangle a run
export function shapes(page){
  return page.evaluate(() => {
    const wb = window.__wb, fr = document.querySelector('#sheet iframe'), d = fr?.contentDocument, win = d?.defaultView, out = [];
    const S = r => wb.canvas.screenRect(r), box = r => ({ left: r.left, top: r.top, width: r.width, height: r.height });
    const shown = el => { if (!el || el.hidden) return false; const c = getComputedStyle(el); const r = el.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > .2 && r.width > 0 && r.height > 0; };
    const grow = (r, o) => ({ left: r.left - o, top: r.top - o, width: r.width + 2 * o, height: r.height + 2 * o });
    // the printed text: every run, in screen px, and the node it is of (a shape's own words are the runs inside its element)
    const texts = [], runs = [];
    if (d){
      const walker = d.createTreeWalker(d.querySelector('.document'), 4), rg = d.createRange();
      for (let n = walker.nextNode(); n; n = walker.nextNode()){
        if (!n.nodeValue.trim()) continue;
        rg.selectNodeContents(n);
        const fold = n.parentElement.closest('.rb-fold'), cut = fold ? fold.getBoundingClientRect().top + parseFloat(fold.style.getPropertyValue('--fold')) : Infinity;      // a folded block shows its heading only
        for (const q of rg.getClientRects()) if (q.width > 1 && q.height > 1 && q.top + q.height / 2 < cut){ texts.push(S(box(q))); runs.push(n); }
      }
    }
    const ownOf = el => (el ? runs.flatMap((n, i) => (el.contains(n) ? [i] : [])) : []);
    const ix = wb.ui.ix, blockOf = (fact, k) => (k === 'job' ? wb.sheet.jobEl(fact, ix) : k === 'section' ? wb.sheet.blockEls('section', fact, ix)[0] : k === 'item' ? null : wb.sheet.blockEls(k === 'group' ? 'group' : 'line', fact, ix)[0]) ?? null;
    // the app's layers
    for (const el of [...document.querySelectorAll('#editlay > *, #handlay > *')]){
      if (!shown(el) || el.matches('.obveil')) continue;
      const c = getComputedStyle(el), r = box(el.getBoundingClientRect());
      const kind = el.matches('.obchip') ? 'chip' : el.matches('.obtoolswrap') ? 'tools' : el.matches('.obgrip') ? 'grip' : el.matches('.obplus') ? 'plus' : el.matches('.obslot') ? 'slot' : el.matches('.obdrop') ? 'drop' : el.matches('.obrail') ? 'rail' : el.matches('.obghost') ? 'ghost' : el.matches('.obtip') ? 'tip' : el.matches('.oblockmark, .obsoft') ? 'lock' : el.className;
      const rr = kind === 'tools' ? box((el.querySelector('.obtools') ?? el).getBoundingClientRect()) : r;
      const of = kind === 'grip' || kind === 'plus' ? blockOf(el.dataset.k === 'line' && kind === 'plus' ? el.dataset.job : el.dataset.fact, kind === 'plus' && el.dataset.k === 'line' ? 'job' : el.dataset.k) : null;
      out.push({ kind, name: `${kind}${el.dataset.k ? `:${el.dataset.k}` : ''}`, rect: rr, stroke: kind === 'rail' ? parseFloat(c.borderTopWidth) || 1 : 0, about: of && S(box(of.getBoundingClientRect())), own: ownOf(of) });
    }
    for (const l of document.querySelectorAll('#editlay .dplist:not([hidden])')) out.push({ kind: 'list', name: 'list', rect: box(l.getBoundingClientRect()), stroke: 0, about: null });      // a level's list, open under the chip (item 10)
    const zb = document.querySelector('#zoombar');
    if (shown(zb)) out.push({ kind: 'zoombar', name: 'zoombar', rect: box(zb.getBoundingClientRect()), stroke: 0, about: null });
    if (!d) return { shapes: out, texts };
    // the frame: the plates that move, the marks on elements, the socket, the card, the frame's rail and drop line
    for (const p of wb.sheet.plates?.() ?? []){
      if (+win.getComputedStyle(p.div).opacity <= .2) continue;
      const ow = parseFloat(win.getComputedStyle(p.div).outlineWidth) || 0;
      const moving = p.div.getAnimations().some(a => /^(left|top|width|height)$/.test(a.transitionProperty));      // on its way from one block to the next (a glide, UX-6f 4c)
      out.push({ kind: 'plate', name: `plate:${p.role}${moving ? ' gliding' : ''}`, rect: S(grow(box(p.div.getBoundingClientRect()), ow)), stroke: 0, about: S(box(p.el.getBoundingClientRect())), own: ownOf(p.el), moving });
    }
    const mark = (sel, kind, fill) => { for (const el of d.querySelectorAll(sel)){ const c = win.getComputedStyle(el); if (c.outlineStyle === 'none' && kind !== 'lift' && kind !== 'card') continue; const o = parseFloat(c.outlineOffset) || 0, w = parseFloat(c.outlineWidth) || 0; out.push({ kind, name: `${kind}:${el.getAttribute('data-variant') ?? el.getAttribute('data-section') ?? el.className}`, rect: S(grow(box(el.getBoundingClientRect()), o + w)), stroke: fill ? 0 : w, about: S(box(el.getBoundingClientRect())), own: ownOf(el) }); } };
    if (!wb.sheet.plates) mark('.rb-hot, .rb-cool, .rb-sel, html.rb-writing [contenteditable]', 'plate', true);      // a tree before the plate that moves (feddab8): the plate is the block's own outline
    mark('.rb-ring', 'ring', false);
    mark('.rb-socket', 'socket', false);
    mark('.rb-prev, .rb-hover, .rb-find', 'accent', true);
    mark('.rb-miss', 'miss', false);
    mark('.rb-lift', 'lift', true);
    mark('.rb-card', 'card', true);
    for (const el of d.querySelectorAll('.rb-rail')) if (win.getComputedStyle(el).display !== 'none') out.push({ kind: 'rail', name: 'rail', rect: S(box(el.getBoundingClientRect())), stroke: parseFloat(win.getComputedStyle(el).borderTopWidth) || 1, about: null });
    for (const el of d.querySelectorAll('.rb-drop')) if (win.getComputedStyle(el).display !== 'none') out.push({ kind: 'drop', name: 'drop', rect: S(box(el.getBoundingClientRect())), stroke: 0, about: null });
    return { shapes: out, texts };
  });
}

const inter = (a, b) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
const depth = (a, b) => Math.min(Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left), Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
// an outline is its four stroke bands; a filled shape is itself
const parts = s => (!s.stroke ? [s.rect] : [
  { left: s.rect.left, top: s.rect.top, width: s.rect.width, height: s.stroke }, { left: s.rect.left, top: s.rect.top + s.rect.height - s.stroke, width: s.rect.width, height: s.stroke },
  { left: s.rect.left, top: s.rect.top, width: s.stroke, height: s.rect.height }, { left: s.rect.left + s.rect.width - s.stroke, top: s.rect.top, width: s.stroke, height: s.rect.height }]);
const within = (a, b) => a.left >= b.left - .5 && a.top >= b.top - .5 && a.left + a.width <= b.left + b.width + .5 && a.top + a.height <= b.top + b.height + .5;

// The overlaps: [{ a, b, px }] for pairs beyond what ALLOWED says (px: how deep, in screen px), and [{ a, px }] for a shape over printed text that is not its own (a text whose
// node is inside the shape's block, or whose middle is inside its box, `about`, is its own; the words of a lifted block travel with it, over everything, item 6). Sub-pixel touches (under .75 px) are not overlaps.
export function overlaps({ shapes: list, texts }, { slack = .75 } = {}){
  const pairs = [], text = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++){
    const a = list[i], b = list[j];
    let px = 0;
    for (const p of parts(a)) for (const q of parts(b)) if (inter(p, q) > 0) px = Math.max(px, depth(p, q));
    if (px <= slack) continue;
    const ok = allowed(a, b);
    if (ok && px <= ok.touch) continue;
    if (ok?.inside){ const [f, o] = a.kind === ok.a ? [a, b] : [b, a]; if (o.moving || within(f.rect, o.rect)) continue; }      // nesting: the first stands inside the second's box (where a gliding one is going)
    if ((a.kind === 'ring' || b.kind === 'ring' || a.kind === 'rail' || b.kind === 'rail') && !a.stroke !== !b.stroke){ const [f, r] = a.stroke ? [b, a] : [a, b]; if (within(f.rect, { left: r.rect.left + r.stroke, top: r.rect.top + r.stroke, width: r.rect.width - 2 * r.stroke, height: r.rect.height - 2 * r.stroke })) continue; }      // nested inside a ring
    pairs.push({ a: a.name, b: b.name, px: Math.round(px * 10) / 10 });
  }
  const lifted = list.filter(s => s.kind === 'lift' || s.kind === 'card'), carried = t => lifted.some(l => within({ left: t.left + t.width / 2, top: t.top + t.height / 2, width: 0, height: 0 }, l.rect));
  for (const s of list){
    const own = (t, i) => carried(t) || !!s.own?.includes(i) || !!s.about && t.left + t.width / 2 >= s.about.left - 1 && t.left + t.width / 2 <= s.about.left + s.about.width + 1 && t.top + t.height / 2 >= s.about.top - 1 && t.top + t.height / 2 <= s.about.top + s.about.height + 1;
    if (['lift', 'card', 'accent', 'list'].includes(s.kind) || s.moving) continue;      // (the chip's open list is the topmost thing while it is open, as a lifted block is)      // a lifted block covers what it passes (it is the topmost thing, item 6), and so does a plate on its way to the next block (for --plate-glide); a mark tints its own text
    let px = 0;
    for (const [i, t] of texts.entries()){ if (own(t, i)) continue; for (const p of parts(s)) if (inter(p, t) > 0) px = Math.max(px, depth(p, t)); }
    if (px > slack) text.push({ a: s.name, px: Math.round(px * 10) / 10 });
  }
  return { pairs, text };
}
