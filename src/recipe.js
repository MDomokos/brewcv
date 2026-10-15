// What a recipe's `weight`, `off` and `keep` mean. Every reader goes through here
// so they agree on what a missing key means.

export const DEFAULT_WEIGHT = 3;
export const MAX_WEIGHT = 5;
export const PIN_KINDS = ['include', 'exclude', 'phrasing'];

const entryOf = (recipe, id) =>
  (recipe?.sections ?? []).find(x => x && typeof x === 'object' && x.id === id);

// The jobs of an entries section in this resume's own order: its `order`, then the jobs it names no place for, as listed.
// Ids that are no longer listed are ignored; with no order the list is returned as it is.
export function inOrder(refs, order){
  if (!Array.isArray(order) || !order.length) return refs;
  const id = r => (typeof r === 'string' ? r : r?.id);
  const named = order.map(o => refs.find(r => id(r) === o)).filter((r, i, a) => r && a.indexOf(r) === i);
  return [...named, ...refs.filter(r => !named.includes(r))];
}

export const weightOf = (recipe, id) => entryOf(recipe, id)?.weight ?? DEFAULT_WEIGHT;

// The header and the summary have no weight.
export const hasBudget = (data, id) => {
  const s = (data?.sections ?? []).find(x => x.id === id);
  return !!s && s.kind !== 'header' && id !== 'summary';
};

// Only an explicit 0 omits a section. An absent weight is 3, not 0.
export const isOmitted = (data, recipe, id) =>
  hasBudget(data, id) && entryOf(recipe, id)?.weight === 0;

// off: bullets that don't print and Fit never adds back. keep: bullets Fit won't
// touch. Older recipes with `pins` still read: off = pins.exclude,
// keep = pins.include + pins.phrasing.
const list = x => (Array.isArray(x) ? x : []);
export const offOf = recipe => (Array.isArray(recipe?.off) ? [...recipe.off] : [...list(recipe?.pins?.exclude)]);
export const keepOf = recipe => (Array.isArray(recipe?.keep) ? [...new Set(recipe.keep)]
  : [...new Set([...list(recipe?.pins?.include), ...list(recipe?.pins?.phrasing)])]);

// A kept bullet that is off stays off.
export function pinsOf(recipe){
  const off = new Set(offOf(recipe)), keep = new Set(keepOf(recipe));
  return { exclude: off, include: new Set([...keep].filter(x => !off.has(x))), phrasing: keep };
}

// Idempotent. Empty lists are not written.
export function migratePins(recipe){
  if (!recipe || typeof recipe !== 'object') return recipe;
  const r = structuredClone(recipe);
  if (r.pins === undefined) return r;
  const off = offOf(r), keep = keepOf(r);
  delete r.pins;
  if (off.length && r.off === undefined) r.off = off;
  if (keep.length && r.keep === undefined) r.keep = keep;
  return r;
}

// The name of a row of a pairs section (a language) written on this resume: recipe.terms = { [factId]: { [lang]: text } }.
export const termOf = (recipe, fid) => { const t = recipe?.terms?.[fid]?.[recipe.lang ?? 'en']; return typeof t === 'string' && t ? t : undefined; };

// A line that exists only on this resume: recipe.localLines = { [jobId]: [{ id, after, lang? }] }, its text in
// `overrides` and its highlights in `overrideMeta`. `after` is the bullet or local line it follows (null: first).
// A separate key, not the job's highlights, so an older app that does not know it just leaves the line out.
export const localOf = (recipe, jobId) => recipe?.localLines?.[jobId] ?? [];
export const localJob = (recipe, id) => Object.keys(recipe?.localLines ?? {}).find(j => recipe.localLines[j].some(l => l.id === id)) ?? null;
export const localEntry = (recipe, id) => Object.values(recipe?.localLines ?? {}).flat().find(l => l.id === id) ?? null;
export const isLocal = (recipe, id) => localJob(recipe, id) !== null;
export const localIds = recipe => new Set(Object.values(recipe?.localLines ?? {}).flat().map(l => l.id));
// A job's bullets with its local lines merged in at their places. Those switched off print nowhere (`keepOff` keeps
// them); neither does one whose text is empty, unless `blank` (the page being written, the lists). `full` is the job's
// whole bullet list: a line whose anchor is not in `ids` (Fit dropped it) follows the anchor's predecessor. `slots`
// ({ union, first }) is a job split over page slots: a line prints only in the slot that holds its anchor, else the first.
export function withLocal(recipe, jobId, ids, { keepOff = false, blank = false, full = [], slots = null } = {}){
  const out = [...ids], here = localOf(recipe, jobId), off = new Set(offOf(recipe));
  const prev = a => { const l = here.find(x => x.id === a); if (l) return l.after; const i = full.indexOf(a); return i < 0 ? undefined : full[i - 1] ?? null; };
  const root = a => { for (let n = 0; a != null && here.some(l => l.id === a) && n < 99; n++) a = prev(a); return a; };
  for (const { id, after } of here){
    if (slots){
      const r = root(after), home = r == null || !slots.union.includes(r) ? slots.first : out.includes(r);
      if (!home) continue;
    }
    let a = after;
    if (!slots) for (let n = 0; a != null && !out.includes(a) && n < 99; n++) a = prev(a);
    const k = a === undefined ? out.length - 1 : a == null ? -1 : out.indexOf(a);
    out.splice(a != null && k < 0 ? out.length : k + 1, 0, id);
  }
  const gone = id => here.some(l => l.id === id) && ((!keepOff && off.has(id)) || (!blank && recipe.overrides?.[id] === ''));
  return here.length ? out.filter(id => !gone(id)) : out;
}

// The links of the version an edit came from, kept where their anchor text still stands verbatim in the edited text; the rest are dropped.
export function keepLinks(base, text){
  const kept = [], dropped = [];
  for (const l of base?.links ?? []){
    const a = [...base.text].slice(l.start, l.end).join(''), i = a ? text.indexOf(a) : -1;
    if (i < 0){ dropped.push(l); continue; }
    const start = [...text.slice(0, i)].length;
    kept.push({ ...l, start, end: start + [...a].length });
  }
  return { kept, dropped };
}
