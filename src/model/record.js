// Versions of the career record. Pure: changes the model in place, as a store draft wants.
// Numbers are per fact and language, at most one dot, and never reused: deleted ones stay in `fact.retired[lang]`.

import { isDraft, isArchive } from './resume.js';
import { guard } from './lock.js';

export const DEFAULT_LANG = 'en';
export const VERSION_N = /^\d+(\.\d+)?$/;
const langOf = v => v?.lang ?? DEFAULT_LANG;
const cps = s => [...s];

export const major = n => String(n ?? '0').split('.')[0];
const parts = n => String(n ?? '0').split('.').map(Number);
export const compareN = (a, b) => { const x = parts(a), y = parts(b); return (x[0] - y[0]) || ((x[1] ?? -1) - (y[1] ?? -1)); };

function index(model){
  return {
    fact: id => (model.facts ?? []).find(f => f.id === id) ?? null,
    variant: id => (model.variants ?? []).find(v => v.id === id) ?? null,
  };
}
export const factOf = (model, vid) => (model.facts ?? []).find(f => (f.variants ?? []).includes(vid)) ?? null;

function usedNumbers(model, f, lang){
  const ix = index(model);
  const live = (f.variants ?? []).map(ix.variant).filter(v => v && langOf(v) === lang).map(v => v.n).filter(Boolean);
  return [...live, ...(f.retired?.[lang] ?? [])].filter(n => VERSION_N.test(String(n)));
}

export function nextMajor(model, factId, lang = DEFAULT_LANG){
  const f = index(model).fact(factId);
  if (!f) throw new Error(`no such fact: ${factId}`);
  const ms = usedNumbers(model, f, lang).map(n => Number(major(n)));
  return String((ms.length ? Math.max(...ms) : 0) + 1);
}

export function nextMinor(model, factId, from, lang = DEFAULT_LANG){
  const f = index(model).fact(factId);
  if (!f) throw new Error(`no such fact: ${factId}`);
  const M = major(from);
  const ms = usedNumbers(model, f, lang).filter(n => major(n) === M && String(n).includes('.')).map(n => Number(String(n).split('.')[1]));
  return `${M}.${(ms.length ? Math.max(...ms) : 0) + 1}`;
}

export function versionsIn(model, factId, lang = DEFAULT_LANG){
  const ix = index(model);
  const f = ix.fact(factId);
  if (!f) return [];
  return f.variants.map(ix.variant).filter(v => v && langOf(v) === lang).sort((a, b) => compareN(a.n, b.n));
}

// Ranges are in code points. Each moves to the occurrence of its text nearest its old place, or is dropped.
export function reanchor(ranges, oldText, newText, covered = r => cps(oldText).slice(r.start, r.end).join('')){
  const nt = cps(newText);
  const out = [];
  let floor = 0;
  for (const r of [...(ranges ?? [])].sort((a, b) => a.start - b.start)){
    const want = cps(covered(r));
    if (!want.length) continue;
    let best = -1;
    for (let i = floor; i + want.length <= nt.length; i++){
      let hit = true;
      for (let k = 0; k < want.length; k++) if (nt[i + k] !== want[k]){ hit = false; break; }
      if (hit && (best < 0 || Math.abs(i - r.start) < Math.abs(best - r.start))) best = i;
    }
    if (best < 0) continue;
    out.push({ ...r, start: best, end: best + want.length });
    floor = best + want.length;
  }
  return out;
}

function setText(v, text){
  const old = v.text;
  v.marks = reanchor(v.marks, old, text, m => m.expect ?? cps(old).slice(m.start, m.end).join(''));
  v.links = reanchor(v.links, old, text);
  v.text = text;
  // old line counts are stale; the probe measures again
  v.metrics = { ...(v.metrics ?? {}), chars: cps(text).length, measured: {} };
}

const clean = t => String(t ?? '').replace(/[ \t]+$/gm, '').trim();

export class RecordError extends Error {}

// `recipe`: the open resume. It refuses when that resume has the claim locked (its printed words would change under the lock).
export function saveOver(model, vid, text, recipe = null){
  const v = index(model).variant(vid);
  if (!v) throw new RecordError(`no such version: ${vid}`);
  if (recipe?.locked?.length && factOf(model, vid)) guard(model, recipe, factOf(model, vid).id);
  const t = clean(text);
  if (!t) throw new RecordError('a version needs some text');
  setText(v, t);
  return v;
}

function freeId(model, base){
  const ids = new Set((model.variants ?? []).map(v => v.id));
  if (!ids.has(base)) return base;
  for (let i = 2; ; i++) if (!ids.has(`${base}-${i}`)) return `${base}-${i}`;
}

// Tags, language and source come from `from`. `as`: 'minor' (vN.x under from's major) or 'major'.
// `marks` are the highlights the text already has; without them `from`'s are moved onto the new text. `source` wins over from's.
export function addVersion(model, factId, { text, lang, from = null, as = 'major', tagsFrom = null, marks = null, source = null } = {}){
  const ix = index(model);
  const f = ix.fact(factId);
  if (!f) throw new RecordError(`no such fact: ${factId}`);
  const src = from ? ix.variant(from) : null;
  if (from && (!src || !f.variants.includes(from))) throw new RecordError(`${from} is not a version of ${factId}`);
  const L = lang ?? langOf(src) ?? DEFAULT_LANG;
  const t = clean(text);
  if (!t) throw new RecordError('a version needs some text');
  const n = as === 'minor' && src ? nextMinor(model, factId, src.n, L) : nextMajor(model, factId, L);
  const id = freeId(model, `${factId}-v${n.replace('.', '-')}${L === DEFAULT_LANG ? '' : `-${L}`}`);
  const v = {
    id, n, lang: L, text: t, marks: [], links: [],
    tags: [...(src?.tags ?? (tagsFrom ? ix.variant(tagsFrom)?.tags : null) ?? [])],
    ...(source ?? src?.source ? { source: source ?? src.source } : {}),
    seenIn: [],
    metrics: { chars: cps(t).length, measured: {} },
  };
  if (src && langOf(src) === L){ v.marks = reanchor(src.marks, src.text, t, m => m.expect ?? cps(src.text).slice(m.start, m.end).join('')); v.links = reanchor(src.links, src.text, t); }
  if (marks) v.marks = marks;
  // after the fact's last version, so the record stays grouped by fact
  const at = Math.max(-1, ...f.variants.map(x => model.variants.findIndex(y => y.id === x)));
  model.variants.splice(at + 1, 0, v);
  f.variants.push(id);
  f.default ??= {};
  if (!f.default[L]) f.default[L] = id;
  return v;
}

// The last default-language version can't go: a claim needs one to print. Picks of it fall back to the default.
export function deleteVersion(model, vid, recipes = [], recipe = null){
  const ix = index(model);
  const v = ix.variant(vid);
  const f = v && factOf(model, vid);
  if (!v || !f) throw new RecordError(`no such version: ${vid}`);
  if (recipe?.locked?.length) guard(model, recipe, f.id);      // clearing the pick would change a locked line
  const L = langOf(v);
  const same = versionsIn(model, f.id, L);
  if (L === DEFAULT_LANG && same.length < 2) throw new RecordError('the last version of a claim can’t be deleted');
  model.variants = model.variants.filter(x => x.id !== vid);
  f.variants = f.variants.filter(x => x !== vid);
  if (VERSION_N.test(String(v.n))){
    f.retired ??= {};
    f.retired[L] = [...new Set([...(f.retired[L] ?? []), String(v.n)])].sort(compareN);
  }
  if (f.default?.[L] === vid){
    const left = versionsIn(model, f.id, L);
    if (left.length) f.default[L] = left[0].id; else delete f.default[L];
  }
  const touched = [];
  recipes.forEach((r, i) => {
    if (r?.picks?.[f.id] === vid){ delete r.picks[f.id]; touched.push(i); }
    for (const o of Object.values(r?.byLang ?? {})) if (o?.picks?.[f.id] === vid){ delete o.picks[f.id]; if (!touched.includes(i)) touched.push(i); }
  });
  return { fact: f.id, touched };
}

// The default is what the JSON Resume body shows and what a resume with no pick prints.
export function setDefault(model, vid){
  const v = index(model).variant(vid);
  const f = v && factOf(model, vid);
  if (!f) throw new RecordError(`no such version: ${vid}`);
  f.default = { ...(f.default ?? {}), [langOf(v)]: vid };
}

// LCS over words and spaces. op '-' is only in a, '+' only in b.
export function wordDiff(a, b){
  const x = String(a).split(/(\s+)/), y = String(b).split(/(\s+)/);
  const m = x.length, n = y.length;
  const L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
    L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  const push = (op, text) => { if (!text) return; const last = out.at(-1); if (last?.op === op) last.text += text; else out.push({ op, text }); };
  let i = 0, j = 0;
  while (i < m && j < n){
    if (x[i] === y[j]){ push('=', x[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push('-', x[i++]);
    else push('+', y[j++]);
  }
  while (i < m) push('-', x[i++]);
  while (j < n) push('+', y[j++]);
  // a space between two changes joins both sides, so "a b" → "c d" is one deletion and one insertion
  const res = [];
  let del = '', ins = '', gap = '';
  const flush = () => { if (del) res.push({ op: '-', text: del }); if (ins) res.push({ op: '+', text: ins }); del = ins = ''; };
  for (const r of out){
    if (r.op === '=' && !r.text.trim() && (del || ins)){ gap += r.text; continue; }
    if (r.op === '='){ flush(); if (gap) res.push({ op: '=', text: gap }); gap = ''; res.push({ ...r }); continue; }
    if (gap){ del += gap; ins += gap; gap = ''; }
    if (r.op === '-') del += r.text; else ins += r.text;
  }
  flush();
  if (gap) res.push({ op: '=', text: gap });
  return res;
}

// Which words of one version are the words of another (the same longest common subsequence as wordDiff, on words only): the pairs
// [index in a, index in b] that stay, the indexes that go and the indexes that come, and the share of the longer text that stays.
// What the page's word-move (src/ui/pagemotion.js) animates; the inspector's underlined differences read the same diff.
export function wordMoves(a, b){
  const count = text => text.split(/\s+/).filter(Boolean).length;
  const pairs = [], removed = [], added = [];
  let i = 0, j = 0;
  for (const d of wordDiff(a, b)){
    const n = count(d.text);
    for (let k = 0; k < n; k++){
      if (d.op === '='){ pairs.push([i++, j++]); } else if (d.op === '-') removed.push(i++); else added.push(j++);
    }
  }
  return { pairs, removed, added, shared: pairs.length / Math.max(i, j, 1) };
}

// What number would this edited text get? Close to a live version (at least `threshold` of the longer text's words
// kept): a sub-version of the nearest one. Else a new major. `tiny`: two words or fewer changed, nearly all kept.
export function suggestNumber(model, factId, text, lang = DEFAULT_LANG, threshold = 0.7){
  const vs = versionsIn(model, factId, lang).filter(v => !isDraft(v) && !isArchive(v) && String(v.text ?? '').trim());
  if (!vs.length) return { as: 'major', n: nextMajor(model, factId, lang), near: null, shared: 0, tiny: false };
  let best = null;
  for (const v of vs){
    const w = wordMoves(v.text, text);
    if (!best || w.shared > best.shared) best = { v, shared: w.shared, changed: Math.max(w.removed.length, w.added.length) };
  }
  const close = best.shared >= threshold;
  return { as: close ? 'minor' : 'major', n: close ? nextMinor(model, factId, best.v.n, lang) : nextMajor(model, factId, lang), near: best.v, shared: best.shared, tiny: best.changed <= 2 && best.shared >= 0.8 };
}
