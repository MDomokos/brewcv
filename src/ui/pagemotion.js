// Moments on the page (UX-4): Fit, a version under the pointer, a lens applied, a line ticked, a resume switched.
//
// The page is drawn by the real renderer into the frame, and the state has already changed when any of this starts: the final render
// is in place, exactly what prints. What moves here is a picture of the difference, made of throwaway clones in the frame's
// own document (#rb-ghosts) and Web Animations on the page's elements, which end with nothing left over:
//   snapshot(f, ix)       before the page is drawn again: where every line is, and a clone of it
//   morph(f, snap, ix)    after it: lines that moved slide to their new place (FLIP), a line whose version changed crossfades,
//                         a line that left folds away, a line that joined slides in. For one line (`words`), the words of the old
//                         version slide to their new positions, across wraps, removed words fade out and new ones fade in.
//   crossfade(f, snap)    the whole page, for switching resume
// A draw that follows within the animation's length (the probe draws twice, for one) replays the same morph from where the clock
// is, so nothing is cut short. src/ui/sheet.js calls these around its draws; nothing here touches the record or an export.

import { play, dur, reduced } from './motion.js';
import { wordMoves } from '../model/record.js';

const MIN_SHARED = 1 / 3;               // versions sharing fewer words than this fall back to a fade
const FIT_BUDGET = 600;                 // Fit's staggered crossfades finish within this many ms
const px = n => `${n.toFixed(2)}px`;
// (Both fade with a linear ease so that they meet at the same moment.)
// Two texts never show over each other (UX-6f): in one change of words the old fade out in the first half and the new fade in in the second.
const OUT = [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }];
const inFrom = (...first) => [{ opacity: 0, ...first[0] }, { opacity: 0, offset: 0.5 }, { opacity: 1, ...first[1] }];

const topLevel = el => !el.parentElement?.closest('[data-variant]');
// the lines that change and move (every printed claim), and the section tabs, which only move with them
export function lineEls(doc){ return [...doc.querySelectorAll('[data-variant], .band h2.tab')].filter(topLevel); }
// the claim a printed element belongs to (an override is the claim's own line)
export function factOf(el, ix){
  if (!el.hasAttribute('data-variant')) return `tab:${el.textContent.trim()}`;
  const v = el.getAttribute('data-variant') ?? '';
  return ix?.factOfVariant?.get(v) ?? (v.endsWith('-override') ? v.slice(0, -9) : v);
}
const rectOf = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };

// the text styles a clone needs to look like the line it stands for
function styleOf(el){
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  return {
    fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing, textTransform: cs.textTransform, color: cs.color, textAlign: cs.textAlign, paddingLeft: cs.paddingLeft,
    paddingRight: cs.paddingRight, fontVariantNumeric: cs.fontVariantNumeric,
  };
}
const wordStyleOf = el => { const cs = el.ownerDocument.defaultView.getComputedStyle(el); return { color: cs.color, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, backgroundColor: cs.backgroundColor }; };

// every word of a line, with where it is and how it is set
export function wordsOf(el){
  const doc = el.ownerDocument, out = [], range = doc.createRange();
  const walker = doc.createTreeWalker(el, 4);
  for (let n = walker.nextNode(); n; n = walker.nextNode()){
    const re = /\S+/g;
    for (let m = re.exec(n.nodeValue); m; m = re.exec(n.nodeValue)){
      range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
      const r = range.getBoundingClientRect();
      if (r.width > 0) out.push({ text: m[0], left: r.left, top: r.top, width: r.width, height: r.height, style: wordStyleOf(n.parentElement) });
    }
  }
  return out;
}

// ---- the ghosts ----
function layerOf(doc){
  let g = doc.getElementById('rb-ghosts');
  if (!g){
    g = doc.createElement('div'); g.id = 'rb-ghosts';
    Object.assign(g.style, { position: 'absolute', left: '0', top: '0', width: '0', height: '0', pointerEvents: 'none', zIndex: '5' });
    doc.body.append(g);
  }
  return g;
}
export function clearGhosts(f){
  f.doc.getElementById('rb-ghosts')?.replaceChildren();
  for (const el of f.doc.querySelectorAll('[data-rb-hid]')) el.removeAttribute('data-rb-hid');
  for (const a of f.running ?? []) { try { a.cancel(); } catch { /* over already */ } }
  f.running = [];
}
function ghostOf(f, b){
  const doc = f.doc, g = doc.createElement('div');
  Object.assign(g.style, b.style, { position: 'absolute', left: px(b.left), top: px(b.top), width: px(b.width), margin: '0', boxSizing: 'border-box', listStyle: 'none' });
  g.className = b.cls ?? '';
  g.innerHTML = b.html;
  layerOf(doc).append(g);
  return g;
}

// ---- before ----
// words: the claim whose words will move. When its words are already moving (a version under the pointer, then another), the old
// words are where the moving ones are now.
export function snapshot(f, ix, { words = null } = {}){
  const doc = f.doc, lines = new Map(), seen = new Map();
  for (const el of lineEls(doc)){
    const fact = factOf(el, ix), n = (seen.get(fact) ?? 0) + 1;
    seen.set(fact, n);
    const b = { ...rectOf(el), fact, variant: el.getAttribute('data-variant'), cls: el.className, html: el.innerHTML, style: styleOf(el), text: el.textContent.replace(/\s+/g, ' ').trim() };
    lines.set(`${fact}#${n}`, b);
  }
  const snap = { doc, lines, words: null, page: null };
  if (words){
    const live = f.wordMove && f.wordMove.fact === words ? f.wordMove : null;
    const el = lineEls(doc).find(e => factOf(e, ix) === words);
    snap.words = live ? { fact: words, list: live.spans.map(s => ({ ...s.now(), text: s.text, style: s.style })), line: live.line }
      : el ? { fact: words, list: wordsOf(el), line: styleOf(el) } : null;
  }
  return snap;
}
// the whole page as it is (a clone), for a crossfade
export function pageSnapshot(f){
  const root = f.root, r = rectOf(root);
  return { doc: f.doc, rect: r, node: root.cloneNode(true), html: root.innerHTML };
}

// ---- after ----
function track(f, a){ if (a){ (f.running ??= []).push(a); a.addEventListener('finish', () => { f.running = f.running.filter(x => x !== a); }); } return a; }

// kind: 'fit' | 'apply' | 'hover' | 'tick'. Returns how long it will take, in ms (0 when nothing moves).
export function morph(f, snap, ix, { kind = 'apply', words = null, offset = 0, foreign = false } = {}){
  if (reduced() || !snap || snap.doc !== f.doc) return 0;
  const doc = f.doc, after = new Map(), seen = new Map();
  for (const el of lineEls(doc)){
    const fact = factOf(el, ix), n = (seen.get(fact) ?? 0) + 1;
    seen.set(fact, n);
    after.set(`${fact}#${n}`, { el, fact, variant: el.getAttribute('data-variant'), ...rectOf(el) });
  }
  const base = dur('base'), slow = dur('slow'), step = dur('stagger');
  let end = 0;
  const run = (el, kf, { drop = false, ...o }) => {
    const a = play(el, kf, { ms: base, ...o });
    if (!a) return;
    track(f, a);
    if (drop) a.finished.catch(() => {}).then(() => el.remove());
    if (offset) a.currentTime = Math.min(offset, a.effect.getComputedTiming().endTime ?? 0);
    end = Math.max(end, (o.delay ?? 0) + (typeof o.ms === 'number' ? o.ms : base));
  };
  // Fit crossfades its swapped lines one after another, in print order, inside the budget
  const changed = [...after].filter(([k, a]) => snap.lines.get(k) && snap.lines.get(k).variant !== a.variant).map(([k]) => k);
  const gap = kind === 'fit' ? Math.min(step * 2, Math.max(0, (FIT_BUDGET - base) / Math.max(1, changed.length - 1))) : 0;
  let nth = 0;
  for (const [k, b] of snap.lines){
    const a = after.get(k);
    if (!a){                                                    // left: it folds away where it was
      const g = ghostOf(f, b);
      g.style.transformOrigin = '50% 0';
      run(g, [{ opacity: 1, transform: 'scaleY(1)' }, { opacity: 0, transform: 'scaleY(.35)' }], { kind: 'leave', fill: 'both', name: `${kind}:fold`, drop: true });
      continue;
    }
    const dx = b.left - a.left, dy = b.top - a.top, moved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
    const swapped = b.variant !== a.variant && b.text !== a.el.textContent.replace(/\s+/g, ' ').trim();
    if (swapped && !(words && a.fact === words)){              // its version changed: the old words fade out, the new fade in
      const delay = nth++ * gap;
      const g = ghostOf(f, b);
      run(g, OUT, { kind: 'linear', delay, fill: 'both', name: `${kind}:out`, drop: true });
      run(a.el, inFrom({ transform: moved ? `translate(${px(dx)}, ${px(dy)})` : 'none' }, { transform: 'none' }), { kind: 'linear', delay, fill: 'backwards', name: `${kind}:in` });
    } else if (swapped){
      // this one is the line whose words move (below); the others slide
    } else if (moved){                                           // the lines below slide to their new place
      run(a.el, [{ transform: `translate(${px(dx)}, ${px(dy)})` }, { transform: 'none' }], { kind: 'move', name: `${kind}:slide` });
    }
  }
  for (const [k, a] of after){
    if (snap.lines.has(k)) continue;                             // joined: it slides in from the left
    run(a.el, [{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { name: `${kind}:join`, fill: 'backwards' });
  }
  if (words && snap.words){
    const el = [...after.values()].find(a => a.fact === words)?.el;
    if (el) end = Math.max(end, wordMove(f, snap.words, el, { offset, foreign }));
  }
  f.morphEnd = end;
  return end;
}

// The words of one line move from the old version to the new (or fade, when they share little or the language differs).
function wordMove(f, old, el, { offset = 0, foreign = false } = {}){
  const doc = f.doc, nw = wordsOf(el);
  if (!nw.length || !old.list.length) return 0;
  const a = old.list.map(w => w.text), b = nw.map(w => w.text);
  const m = wordMoves(a.join(' '), b.join(' '));
  const base = dur('base');
  const lineStyle = styleOf(el);
  const layer = layerOf(doc);
  const spans = [];
  const mk = (w, st) => {
    const s = doc.createElement('span');
    s.textContent = w.text;
    Object.assign(s.style, lineStyle, w.style ?? {}, { position: 'absolute', left: px(w.left), top: px(w.top), width: 'auto', height: px(w.height), whiteSpace: 'pre', margin: '0', padding: '0', textAlign: 'left', ...st });
    layer.append(s);
    return s;
  };
  el.setAttribute('data-rb-hid', '1');       // its words are drawn by the overlay while they move (sheet.js: the text is clear, the bullet and the highlight stay)
  const fade = foreign || m.shared < MIN_SHARED;
  const anims = [];
  const go = (node, kf, o) => { const an = play(node, kf, { ms: base, fill: 'both', ...o }); if (an){ track(f, an); anims.push(an); if (offset) an.currentTime = Math.min(offset, base + (o.delay ?? 0)); } return an; };
  const now = s => () => { const r = s.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
  if (fade){
    old.list.forEach(w => go(mk(w), OUT, { kind: 'linear', name: 'hover:out' }));
    nw.forEach((w, j) => { const s = mk(w); spans.push({ el: s, text: w.text, style: w.style, now: now(s) }); go(s, inFrom({}, {}), { kind: 'linear', name: 'hover:in' }); });
  } else {
    const from = new Map(m.pairs.map(([i, j]) => [j, i]));
    nw.forEach((w, j) => {
      const s = mk(w);
      spans.push({ el: s, text: w.text, style: w.style, now: now(s) });
      if (from.has(j)){
        const o = old.list[from.get(j)];
        go(s, [{ transform: `translate(${px(o.left - w.left)}, ${px(o.top - w.top)})` }, { transform: 'none' }], { kind: 'move', name: 'hover:move' });
      } else go(s, inFrom({}, {}), { kind: 'linear', name: 'hover:in' });
    });
    for (const i of m.removed) go(mk(old.list[i]), OUT, { kind: 'linear', name: 'hover:out' });
  }
  // while it moves the line is the overlay; when it ends the real line is back (a draw that comes first does the same)
  f.wordMove = { fact: old.fact, spans, line: lineStyle };
  const done = () => { if (f.wordMove?.spans === spans){ f.wordMove = null; } el.removeAttribute('data-rb-hid'); layer.replaceChildren(); };
  if (!anims.length){ done(); return 0; }
  Promise.all(anims.map(an => an.finished.catch(() => {}))).then(() => { if (f.wordMove?.spans === spans) done(); });
  return base * 1.35;
}

// ---- the whole page: switching resume ----
export function crossfade(f, snap, { offset = 0 } = {}){
  if (reduced() || !snap || snap.doc !== f.doc) return 0;
  const doc = f.doc, g = layerOf(doc), ms = dur('base') * 1.2;
  const old = doc.createElement('div');
  Object.assign(old.style, { position: 'absolute', left: px(snap.rect.left), top: px(snap.rect.top), width: px(snap.rect.width), height: px(snap.rect.height), display: 'flex', gap: doc.defaultView.getComputedStyle(f.root).gap || '0', alignItems: 'flex-start' });
  old.className = 'document';
  old.innerHTML = snap.html;
  g.append(old);
  const out = play(old, [{ opacity: 1 }, { opacity: 0 }], { ms, kind: 'leave', fill: 'both', name: 'switch:out' });
  const into = play(f.root, [{ opacity: 0 }, { opacity: 1 }], { ms, fill: 'backwards', name: 'switch:in' });
  for (const an of [out, into]) if (an){ track(f, an); if (offset) an.currentTime = Math.min(offset, ms); }
  if (out) out.finished.catch(() => {}).then(() => old.remove());
  return ms;
}

// ---- the start screen turns into the editor: the grey lines become the page's text, line by line ----
export function reveal(f, { total = 640 } = {}){
  if (reduced()) return 0;
  const els = lineEls(f.doc), n = els.length;
  if (!n) return 0;
  const base = dur('base'), step = Math.min(dur('stagger') * 0.7, Math.max(0, (total - base) / Math.max(1, n - 1)));
  els.forEach((el, i) => track(f, play(el, [{ clipPath: 'inset(0 100% 0 0)', opacity: 0.25 }, { clipPath: 'inset(0 0 0 0)', opacity: 1 }], { ms: base, delay: i * step, fill: 'backwards', name: 'start:line' })));
  return base + (n - 1) * step;
}
