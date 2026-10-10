// What an agent may pick, read from a record. Shared by claims.mjs and new-resume.mjs so they cannot disagree.

import { isDraft, DEFAULT_LANG } from '../../src/model/resume.js';
import { entriesOf } from '../../src/model/entries.js';

export const langOf = v => v?.lang ?? DEFAULT_LANG;
export const isArchive = v => (v?.tags ?? []).some(t => String(t).toLowerCase() === 'archive');

// Why a version can't be picked, or null. `fact.archived` exists only once the record can archive a claim.
export function refusal(fact, v){
  if (isDraft(v)) return 'draft';
  if (isArchive(v)) return 'archive';
  if (fact?.archived) return 'archived claim';
  return null;
}

export function indexOf(model){
  return {
    fact: new Map((model.facts ?? []).map(f => [f.id, f])),
    version: new Map((model.variants ?? []).map(v => [v.id, v])),
    factOf: new Map((model.facts ?? []).flatMap(f => (f.variants ?? []).map(id => [id, f]))),
  };
}

// A claim's versions in one language, with the reason each can't be picked.
export function versionsOf(model, ix, fact, lang){
  return (fact.variants ?? []).map(id => ix.version.get(id)).filter(v => v && langOf(v) === lang)
    .map(v => ({ id: v.id, n: v.n ?? '', chars: [...(v.text ?? '')].length, tags: v.tags ?? [], text: v.text ?? '',
      default: fact.default?.[lang] === v.id, refused: refusal(fact, v) }));
}

export const jobsOf = model => entriesOf(model);

// Fact ids a section's content refers to, in order. Skills groups are not claims and are listed by name.
export function factIdsOfSection(section, ix){
  const out = [];
  (function walk(x){
    if (typeof x === 'string'){ if (ix.fact.has(x) && !out.includes(x)) out.push(x); }
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  })(section.content);
  return out;
}
