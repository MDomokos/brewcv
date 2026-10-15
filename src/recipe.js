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

// A line that exists only on this resume: recipe.localLines = { [jobId]: [{ id, after, lang? }] }, its text in
// `overrides` and its highlights in `overrideMeta`. `after` is the bullet or local line it follows (null: first).
// A separate key, not the job's highlights, so an older app that does not know it just leaves the line out.
export const localOf = (recipe, jobId) => recipe?.localLines?.[jobId] ?? [];
export const localJob = (recipe, id) => Object.keys(recipe?.localLines ?? {}).find(j => recipe.localLines[j].some(l => l.id === id)) ?? null;
export const localEntry = (recipe, id) => Object.values(recipe?.localLines ?? {}).flat().find(l => l.id === id) ?? null;
export const isLocal = (recipe, id) => localJob(recipe, id) !== null;
export const localIds = recipe => new Set(Object.values(recipe?.localLines ?? {}).flat().map(l => l.id));
// A job's bullets with its local lines merged in at their places; those switched off print nowhere.
// shortcut: a hand layout that splits one job over slots prints its local line in each slot that holds its anchor.
export function withLocal(recipe, jobId, ids, keepOff = false){
  const out = [...ids], here = localOf(recipe, jobId), off = new Set(offOf(recipe));
  for (const { id, after } of here){
    const k = after == null ? -1 : out.indexOf(after);
    out.splice(after != null && k < 0 ? out.length : k + 1, 0, id);
  }
  return here.length && !keepOff ? out.filter(id => !(off.has(id) && here.some(l => l.id === id))) : out;
}
