// Job-type and tag focus. Pure: no DOM, no I/O.
// Tagging never touches a Keep bullet and never empties a job: an untagged job keeps its first bullet.

import { chooseVariant, keepOf, jobRefs, listedBullets, setBulletOn } from './resume.js';
import { archivedIds, archivedEntryIds } from './entries.js';

const langOf = v => v?.lang ?? 'en';
const refId = r => (typeof r === 'string' ? r : r?.id);

function ixOf(model){
  return {
    v: new Map((model.variants ?? []).map(v => [v.id, v])),
    f: new Map((model.facts ?? []).map(f => [f.id, f])),
  };
}

// A job type is a string (the old form: one tag, which is also its id) or { id, label, tags }.
// This is the one place that reads either; everything else asks for the normal form.
export function normaliseJobType(x){
  if (typeof x === 'string') return x.trim() ? { id: x, label: x, tags: [x] } : null;
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id) return null;
  const tags = [...new Set((Array.isArray(x.tags) ? x.tags : []).filter(t => typeof t === 'string' && t.trim()))];
  return { id: x.id, label: typeof x.label === 'string' && x.label.trim() ? x.label : x.id, tags };
}
export const jobTypesOf = model => (model?.jobTypes ?? []).map(normaliseJobType).filter(Boolean);
export const jobTypeById = (model, id) => jobTypesOf(model).find(j => j.id === id) ?? null;
// A saved resume holds an id; one the record no longer has still shows as typed.
export const jobTypeLabel = (model, id) => jobTypeById(model, id)?.label ?? id ?? '';
// A tag, a job type id or a job type: the list of tags it stands for.
export function tagsOf(model, T){
  if (T && typeof T === 'object') return normaliseJobType(T)?.tags ?? [];
  return jobTypeById(model, T)?.tags ?? [T];
}

// The version of a fact that T (a tag, a job type id or a job type) picks in `lang`: the one carrying
// the most of its tags, then the lowest number.
export function taggedVersion(model, factId, T, lang = 'en', ix = ixOf(model)){
  const f = ix.f.get(factId);
  if (!f) return null;
  const tags = tagsOf(model, T);
  const hit = v => tags.filter(t => (v.tags ?? []).includes(t)).length;
  const num = n => String(n ?? '0').split('.').map(Number);
  return f.variants.map(id => ix.v.get(id)).filter(v => v && langOf(v) === lang && hit(v))
    .sort((a, b) => (hit(b) - hit(a)) || (() => { const x = num(a.n), y = num(b.n); return (x[0] - y[0]) || ((x[1] ?? -1) - (y[1] ?? -1)); })())[0] ?? null;
}

// Job types come first, even with no versions yet. Versions of archived claims count only with `archived`.
export function allTags(model, lang = null, { archived = false } = {}){
  const m = new Map();
  const hidden = archived ? new Set() : new Set((model.facts ?? []).filter(f => f.archived).flatMap(f => f.variants ?? []));
  for (const v of model.variants ?? []) if ((!lang || langOf(v) === lang) && !hidden.has(v.id)) for (const t of v.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
  const jts = jobTypesOf(model);
  const ids = new Set(jts.map(j => j.id));
  // a job type counts the versions any of its tags is on
  const live = (model.variants ?? []).filter(v => (!lang || langOf(v) === lang) && !hidden.has(v.id));
  const types = jts.map(j => ({ tag: j.id, label: j.label, tags: j.tags, n: live.filter(v => j.tags.some(t => (v.tags ?? []).includes(t))).length, jobType: true }));
  const plain = [...m].filter(([tag]) => !ids.has(tag)).map(([tag, n]) => ({ tag, label: tag, tags: [tag], n, jobType: false }));
  const byUse = (a, b) => (b.n - a.n) || a.tag.localeCompare(b.tag);
  return [...types.sort(byUse), ...plain.sort(byUse)];
}

function walk(model, recipe, T, fn){
  const lang = recipe.lang ?? 'en';
  const ix = ixOf(model);
  const keep = new Set(keepOf(recipe));
  const onJobs = new Set(jobRefs(model, recipe).map(refId));
  const sec = (model.sections ?? []).find(s => s.kind === 'entries');
  const arch = archivedIds(model), hiddenJobs = archivedEntryIds(model);
  const jobs = (sec?.content?.work ?? (model.work ?? []).map(w => w.id)).map(id => (model.work ?? []).find(w => w.id === id)).filter(Boolean);
  for (const w of jobs){
    if (hiddenJobs.has(w.id)) continue;     // an archived job is left as the resume has it
    const listed = new Set(onJobs.has(w.id) ? listedBullets(model, recipe, w.id) : []);
    // an archived claim is left as the resume has it: never switched on, off or re-picked
    const live = w.highlights.filter(h => !arch.has(h));
    const hits = live.filter(h => taggedVersion(model, h, T, lang, ix));
    for (const h of w.highlights){
      if (keep.has(h) || arch.has(h)) continue;
      const tv = taggedVersion(model, h, T, lang, ix);
      const on = listed.has(h);
      if (tv){
        const using = chooseVariant(model, h, recipe).v;
        fn({ kind: 'tagged', fact: h, job: w.id, on, switch: using?.id !== tv.id || recipe.overrides?.[h] !== undefined, tv });
      } else if (on && (hits.length || h !== live[0])) fn({ kind: 'off', fact: h, job: w.id });
    }
  }
  const s = recipe.summary ?? model.basics?.summary;
  if (s && !keep.has(s)){
    const tv = taggedVersion(model, s, T, lang, ix);
    if (tv && chooseVariant(model, s, recipe).v?.id !== tv.id) fn({ kind: 'summary', fact: s, tv });
  }
}

export function planTag(model, recipe, T){
  let on = 0, off = 0, sw = 0;
  const hits = new Set();
  walk(model, recipe, T, x => {
    if (x.kind === 'tagged'){ hits.add(x.fact); if (!x.on) on++; if (x.switch) sw++; }
    else if (x.kind === 'off') off++;
    else if (x.kind === 'summary'){ sw++; hits.add(x.fact); }
  });
  return { on, off, sw, hits };
}

// Facts with a version tagged T, whatever the resume does with them.
export function tagHits(model, T, lang = 'en'){
  const ix = ixOf(model);
  return new Set((model.facts ?? []).filter(f => !f.archived && taggedVersion(model, f.id, T, lang, ix)).map(f => f.id));
}

// Mutates the recipe (a store draft's d.cur). Returns the plan.
export function applyTag(model, recipe, T){
  const plan = planTag(model, recipe, T);
  const todo = [];
  walk(model, recipe, T, x => todo.push(x));
  for (const x of todo){
    if (x.kind === 'tagged'){
      if (!x.on) setBulletOn(model, recipe, x.fact, true);
      recipe.picks = { ...(recipe.picks ?? {}), [x.fact]: x.tv.id };
      if (recipe.overrides?.[x.fact] !== undefined) delete recipe.overrides[x.fact];
    } else if (x.kind === 'off') setBulletOn(model, recipe, x.fact, false);
    else if (x.kind === 'summary') recipe.picks = { ...(recipe.picks ?? {}), [x.fact]: x.tv.id };
  }
  return plan;
}
