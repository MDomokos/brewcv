// The skill wordbank. Pure: no DOM, no I/O.
// model.skillBank = { words: [{ id, name, shelf?, same?, needsReview?: [lang] }], shelves?: [{ id, name }] } keeps every skill word once, in the
// bank's order, by its English `name`. A word's wording in another language, and a shelf's name, is in model.i18n[lang].labels[id]. `same`: the
// word prints its English in every language (a product name). `needsReview`: languages whose wording has had no native speaker's read. A shelf
// only sorts the bank and never prints; a word needs none. A resume's skill groups (recipe.skillArrangement) list word ids; an older arrangement's
// typed text still prints as typed until the resume is next arranged, when each text becomes the bank's word for it.

import { setI18n, dropI18n } from './labels.js';

const EN = 'en';
const NONE = Object.freeze({ words: Object.freeze([]), shelves: Object.freeze([]) });
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);

export const bankOf = m => (isObj(m?.skillBank) ? m.skillBank : NONE);
export const wordsOf = m => bankOf(m).words ?? [];
export const shelvesOf = m => bankOf(m).shelves ?? [];
const byIdMemo = new WeakMap();
const byId = m => { const ws = wordsOf(m); let x = byIdMemo.get(ws); if (!x || x.n !== ws.length){ x = { n: ws.length, map: new Map(ws.map(w => [w.id, w])) }; byIdMemo.set(ws, x); } return x.map; };
export const wordOf = (m, id) => (typeof id === 'string' ? byId(m).get(id) ?? null : null);
export const shelfOf = (m, id) => shelvesOf(m).find(s => s.id === id) ?? null;
export const labelIn = (m, id, lang) => (lang === EN ? undefined : m?.i18n?.[lang]?.labels?.[id]);

// What an item of a skill group prints in `lang`: a word's wording there, its English when it is the same in every language, else its English
// marked missing. An item that is no word of the bank is text typed into an older arrangement, and prints as typed.
export function wordText(m, item, lang = EN){
  const w = wordOf(m, item);
  if (!w) return { text: String(item), miss: false, id: null };
  if (lang === EN || w.same) return { text: w.name, miss: false, id: w.id };
  const l = labelIn(m, w.id, lang);
  return l ? { text: l, miss: false, id: w.id } : { text: w.name, miss: true, id: w.id };
}
export const shelfName = (m, id, lang = EN) => { const s = shelfOf(m, id); return s ? labelIn(m, id, lang) || s.name : ''; };

// Case, accents, spaces and punctuation are ignored (+ and # are kept: C, C++ and C# are three words).
export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}+#]+/gu, '');
const formsOf = (m, w) => [w.name, ...Object.values(m?.i18n ?? {}).map(l => l?.labels?.[w.id]).filter(x => typeof x === 'string')].map(norm);
function lev(a, b){
  let p = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++){ const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
  return p[b.length];
}
// The bank's word for a text: its wording in `lang`, else its English, else any language's. null when the bank has none.
export function findWord(m, text, lang = EN){
  const n = norm(text), ws = wordsOf(m);
  if (!n) return null;
  return ws.find(w => lang !== EN && norm(labelIn(m, w.id, lang)) === n) ?? ws.find(w => norm(w.name) === n) ?? ws.find(w => formsOf(m, w).includes(n)) ?? null;
}
// Is it in the bank already? `exact`: the same word in any language. `near`: one inside the other, or two letters apart.
export function similar(m, text, max = 8){
  const n = norm(text), near = [];
  if (!n) return { exact: null, near };
  const exact = findWord(m, text);
  if (exact) return { exact, near };
  for (const w of wordsOf(m)){
    const forms = formsOf(m, w);
    if (forms.some(f => (n.length >= 3 && f.includes(n)) || (f.length >= 3 && n.includes(f)) || (Math.min(f.length, n.length) >= 5 && lev(f, n) <= 2))) near.push(w);
  }
  return { exact: null, near: near.slice(0, max) };
}

const slugOf = (s, fallback) => String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\+/g, 'p').replace(/#/g, 'sharp').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || fallback;
function freshId(m, prefix, name){
  const taken = new Set([...wordsOf(m).map(w => w.id), ...shelvesOf(m).map(s => s.id)]);
  const base = `${prefix}-${slugOf(name, prefix === 'sw' ? 'word' : 'shelf')}`;
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}
// One word as typed: spaces collapsed. A comma separates words, so a word never holds one.
export const cleanWord = s => String(s ?? '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

// A new word at the end of the bank (or of `shelf`'s words). Typed in another language, it is that language's word and, until someone writes the
// English, its English too (marked for review in English).
export function addWord(m, { name, lang = EN, shelf = null } = {}){
  const v = cleanWord(name);
  if (!v) throw new Error('a word needs a name');
  if (shelf && !shelfOf(m, shelf)) throw new Error(`no shelf ${shelf}`);
  m.skillBank = isObj(m.skillBank) ? m.skillBank : {};
  const words = (m.skillBank.words ??= []);
  const w = { id: freshId(m, 'sw', v), name: v, ...(shelf ? { shelf } : {}), ...(lang !== EN ? { needsReview: [EN] } : {}) };
  const at = shelf ? words.findLastIndex(x => x.shelf === shelf) : -1;
  words.splice(at < 0 ? words.length : at + 1, 0, w);
  if (lang !== EN) setI18n(m, lang, 'labels', w.id, v);
  return w;
}
// A new shelf at the end. Named in another language, that is its name there and its English until someone writes it.
export function addShelf(m, name, lang = EN){
  const v = cleanWord(name);
  if (!v) throw new Error('a shelf needs a name');
  m.skillBank = isObj(m.skillBank) ? m.skillBank : {};
  m.skillBank.words ??= [];
  const s = { id: freshId(m, 'sh', v), name: v };
  (m.skillBank.shelves ??= []).push(s);
  if (lang !== EN) setI18n(m, lang, 'labels', s.id, v);
  return s;
}
// A shelf goes; its words stay in the bank, on no shelf.
export function dropShelf(m, id){
  const b = bankOf(m);
  if (!shelfOf(m, id)) return false;
  for (const w of b.words) if (w.shelf === id) delete w.shelf;
  b.shelves = b.shelves.filter(s => s.id !== id);
  if (!b.shelves.length) delete b.shelves;
  dropI18n(m, 'labels', id);
  return true;
}
// A word's English (lang en) or its wording in another language; an empty text there removes that language's wording. Written by a person, it
// needs no review in that language any more.
export function setWordText(m, id, lang, text){
  const w = wordOf(m, id);
  if (!w) throw new Error(`no word ${id}`);
  const v = cleanWord(text);
  if (lang === EN){ if (!v) return false; w.name = v; }
  else setI18n(m, lang, 'labels', id, v);
  if (w.needsReview){ w.needsReview = w.needsReview.filter(l => l !== lang); if (!w.needsReview.length) delete w.needsReview; }
  return true;
}
export function setWordSame(m, id, on){ const w = wordOf(m, id); if (!w) throw new Error(`no word ${id}`); if (on) w.same = true; else delete w.same; }
export function setShelfName(m, id, lang, text){
  const s = shelfOf(m, id), v = cleanWord(text);
  if (!s) throw new Error(`no shelf ${id}`);
  if (lang === EN){ if (v) s.name = v; } else setI18n(m, lang, 'labels', id, v);
}
// A word moved in the bank: before `beforeId` (null: the end of its shelf), onto `shelf` (null: no shelf).
export function moveWord(m, id, { shelf = null, beforeId = null } = {}){
  const words = bankOf(m).words, i = words.findIndex(w => w.id === id);
  if (i < 0) throw new Error(`no word ${id}`);
  if (shelf && !shelfOf(m, shelf)) throw new Error(`no shelf ${shelf}`);
  const [w] = words.splice(i, 1);
  if (shelf) w.shelf = shelf; else delete w.shelf;
  let at = beforeId ? words.findIndex(x => x.id === beforeId) : -1;
  if (at < 0){ const last = words.findLastIndex(x => (x.shelf ?? null) === (shelf ?? null)); at = last < 0 ? (shelf ? words.length : 0) : last + 1; }
  words.splice(at, 0, w);
}
// The word leaves the bank, with its wordings. Resumes that print it are the caller's (src/model/resume.js dropWordEverywhere).
export function dropWord(m, id){
  const b = bankOf(m), i = b.words.findIndex(w => w.id === id);
  if (i < 0) return null;
  const [w] = b.words.splice(i, 1);
  dropI18n(m, 'labels', id);
  return w;
}

// Groups whose items are word ids: each typed text of an older arrangement becomes the bank's word for it (in the group's language), made when
// the bank has none and `create` is on. A word that is already in an earlier group is not printed twice. Returns new groups; the bank may grow.
export function toWordIds(m, groups, lang = EN, create = true){
  const seen = new Set();
  return (groups ?? []).map(g => {
    const L = g.lang ?? lang;
    const items = [];
    for (const x of g.items ?? []){
      const w = wordOf(m, x) ?? findWord(m, x, L) ?? (create && cleanWord(x) ? addWord(m, { name: x, lang: L }) : null);
      const id = w ? w.id : x;
      if (w && seen.has(id)) continue;
      if (w) seen.add(id);
      items.push(id);
    }
    const out = { ...g, items };
    if (out.label === undefined) delete out.lang;      // its language was the language its words were typed in
    return out;
  });
}
// The word ids a group's items stand for, without changing anything (a typed text the bank has no word for is left out).
export const idsOf = (m, items, lang = EN) => (items ?? []).map(x => (wordOf(m, x) ?? findWord(m, x, lang))?.id).filter(Boolean);

// ---- first open: the record's skill groups become the bank ----
const split = text => String(text ?? '').split(/,\s*/).map(x => x.trim()).filter(Boolean);
const variantsOf = (m, f) => { const vs = new Map((m.variants ?? []).map(v => [v.id, v])); return (f.variants ?? []).map(id => vs.get(id)).filter(Boolean); };
const inLang = (m, f, lang) => { const vs = variantsOf(m, f).filter(v => (v.lang ?? EN) === lang); return vs.find(v => v.id === f.default?.[lang]) ?? vs.find(v => v.id.endsWith('-base')) ?? vs[0] ?? null; };
export const recordGroupIds = m => [...new Set([...(m?.sections ?? []).filter(s => s.kind === 'grid').flatMap(s => s.content?.groups ?? []), ...(m?.skills ?? []).map(s => s?.id)])]
  .filter(id => typeof id === 'string' && (m.facts ?? []).some(f => f.id === id));

// Builds the bank once, when the record has none: each skill group's English words (a word in two groups is one word), each language's wording
// matched to its English by place when the counts agree (else only the words written the same), `needs-review` copied per language, and a word
// marked same in every language when its group is, or when every language that has its group writes it as in English. The claims are untouched,
// so nothing prints differently. Idempotent: returns false when there was a bank already or nothing to seed.
export function seedBank(m){
  if (!m || m.skillBank !== undefined) return false;
  const gids = recordGroupIds(m);
  const setWords = Object.values(isObj(m.skillSets) ? m.skillSets : {}).flatMap(byLang => (Array.isArray(byLang?.[EN]) ? byLang[EN] : []).flatMap(g => g?.items ?? []));
  if (!gids.length && !setWords.length) return false;
  m.skillBank = { words: [] };
  const facts = new Map((m.facts ?? []).map(f => [f.id, f]));
  const langs = [...new Set((m.variants ?? []).map(v => v.lang ?? EN))].filter(l => l !== EN);
  for (const gid of gids){
    const f = facts.get(gid), en = inLang(m, f, EN);
    if (!en) continue;
    const toks = split(en.text), fresh = new Set();
    const ws = toks.map(t => { let w = wordsOf(m).find(x => norm(x.name) === norm(t)); if (!w){ w = addWord(m, { name: t }); fresh.add(w.id); } return w; });
    const seen = new Map(), differs = new Set();
    const align = (w, L, text, review) => {
      if (!fresh.has(w.id)) return;      // a word seeded from an earlier group keeps what it had there
      seen.set(w.id, (seen.get(w.id) ?? 0) + 1);
      if (text === w.name) return;
      differs.add(w.id);
      if (!labelIn(m, w.id, L)) setI18n(m, L, 'labels', w.id, text);
      if (review) w.needsReview = [...new Set([...(w.needsReview ?? []), L])];
    };
    for (const L of langs){
      const v = inLang(m, f, L);
      if (!v) continue;
      const lt = split(v.text), review = (v.tags ?? []).includes('needs-review');
      if (lt.length === toks.length) lt.forEach((x, i) => align(ws[i], L, x, review));
      else for (const x of lt){ const i = toks.findIndex(t => norm(t) === norm(x)); if (i >= 0) align(ws[i], L, x, review); }
    }
    const sameGroup = (m.same ?? []).includes(`fact:${gid}`);
    for (const w of ws) if (fresh.has(w.id) && !differs.has(w.id) && (sameGroup || seen.get(w.id))) w.same = true;
  }
  for (const x of setWords) if (typeof x === 'string' && cleanWord(x) && !findWord(m, x)) addWord(m, { name: x });
  return true;
}

// The bank read from a file anyone can edit: a word or shelf without an id and a name of its own is dropped, a shelf a word names that is not
// there is forgotten, and the whole key goes when it is not a bank at all. Returns the warnings.
export function cleanBank(m){
  const b = m?.skillBank, out = [];
  if (b === undefined) return out;
  if (!isObj(b)){ delete m.skillBank; return ['skillBank is not { words, shelves }; it is ignored']; }
  const ids = new Set();
  const good = x => isObj(x) && typeof x.id === 'string' && x.id && typeof x.name === 'string' && x.name.trim() && !ids.has(x.id) && ids.add(x.id);
  const listOf = x => (Array.isArray(x) ? x : x === undefined ? [] : [x]);
  const shelves = listOf(b.shelves).filter(good), words = listOf(b.words).filter(good);
  if (shelves.length + words.length !== listOf(b.shelves).length + listOf(b.words).length)
    out.push('skillBank had a word or a shelf without an id of its own or a name; it was dropped');
  const shelfIds = new Set(shelves.map(s => s.id));
  for (const w of words){
    if (w.shelf !== undefined && !shelfIds.has(w.shelf)){ delete w.shelf; out.push(`skillBank word ${w.id} named a shelf that is not there; it is on no shelf now`); }
    if (w.same !== undefined && w.same !== true) delete w.same;
    if (w.needsReview !== undefined){ const l = Array.isArray(w.needsReview) ? w.needsReview.filter(x => typeof x === 'string') : []; if (l.length) w.needsReview = l; else delete w.needsReview; }
  }
  b.words = words;
  if (shelves.length) b.shelves = shelves; else delete b.shelves;
  return out;
}
