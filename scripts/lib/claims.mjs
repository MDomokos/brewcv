// What an agent may pick, read from a record. Shared by claims.mjs and new-resume.mjs so they cannot disagree.

import { DEFAULT_LANG, refusal } from '../../src/model/resume.js';
export { refusal };
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entriesOf } from '../../src/model/entries.js';
import { THEMES } from '../../src/themes.js';
import { offersOf, MEDIA } from '../../src/model/design.js';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const namesIn = (dir, ext) => fs.readdirSync(path.join(REPO, dir)).filter(f => f.endsWith(ext)).map(f => f.slice(0, -ext.length)).sort();
// What picks.json may name: the formats, the looks a resume can be given (not the earlier ones, which only render) with what each
// offers for `design` (A4: Small is not offered on Letter), and the export media. `defaults` are the look's own, written as the Design view shows.
export const optionsOf = () => ({
  formats: namesIn('templates', '.html'),
  looks: THEMES.filter(x => !x.earlier).map(x => ({ id: x.id, name: x.name, note: x.note, design: offersOf(x, 'a4'),
    defaults: { preset: x.design.preset, fonts: x.design.font } })),
  exportMedia: MEDIA,
});
// The stylesheet names the old `theme` field takes (it can set a base theme that is really an overlay: use `look`)
export const stylesheetsOf = model => [...new Set([...namesIn('themes', '.css'), ...(model.themes ?? []).map(t => t?.id ?? t?.name).filter(Boolean)])];

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
