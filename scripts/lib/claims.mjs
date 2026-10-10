// What an agent may pick, read from a record. Shared by claims.mjs and new-resume.mjs so they cannot disagree.

import { DEFAULT_LANG, refusal } from '../../src/model/resume.js';
export { refusal };
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entriesOf } from '../../src/model/entries.js';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const namesIn = (dir, ext) => fs.readdirSync(path.join(REPO, dir)).filter(f => f.endsWith(ext)).map(f => f.slice(0, -ext.length)).sort();
// What picks.json may name for format and theme
export const optionsOf = model => ({
  formats: namesIn('templates', '.html'),
  themes: [...new Set([...namesIn('themes', '.css'), ...(model.themes ?? []).map(t => t?.id ?? t?.name).filter(Boolean)])],
});

export const langOf = v => v?.lang ?? DEFAULT_LANG;
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
      default: fact.default?.[lang] === v.id, needsReview: (v.tags ?? []).includes('needs-review'), refused: refusal(fact, v) }));
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
