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

// First version of a fact, in number order, tagged T in `lang`.
export function taggedVersion(model, factId, T, lang = 'en', ix = ixOf(model)){
  const f = ix.f.get(factId);
  if (!f) return null;
  const num = n => String(n ?? '0').split('.').map(Number);
  return f.variants.map(id => ix.v.get(id)).filter(v => v && langOf(v) === lang && (v.tags ?? []).includes(T))
    .sort((a, b) => { const x = num(a.n), y = num(b.n); return (x[0] - y[0]) || ((x[1] ?? -1) - (y[1] ?? -1)); })[0] ?? null;
}

// Job types come first, even with no versions yet. Versions of archived claims count only with `archived`.
export function allTags(model, lang = null, { archived = false } = {}){
  const m = new Map();
  const hidden = archived ? new Set() : new Set((model.facts ?? []).filter(f => f.archived).flatMap(f => f.variants ?? []));
  for (const v of model.variants ?? []) if ((!lang || langOf(v) === lang) && !hidden.has(v.id)) for (const t of v.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
  const jt = model.jobTypes ?? [];
  for (const t of jt) if (!m.has(t)) m.set(t, 0);
  return [...m].map(([tag, n]) => ({ tag, n, jobType: jt.includes(tag) }))
    .sort((a, b) => (b.jobType - a.jobType) || (b.n - a.n) || a.tag.localeCompare(b.tag));
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
