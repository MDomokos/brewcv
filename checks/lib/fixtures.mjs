// Fictional fixtures built in memory from checks/fixtures/example-0.4.json: more jobs and skills, so there is
// something to trade, and a Hungarian phrasing shorter than any English one as bait. Nothing is written.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, migrate } from '../../src/model/schema.js';

export const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
export const base = load(read(path.join(REPO, 'checks/fixtures/example-0.4.json'))).model;
export const baseRecipe = read(path.join(REPO, 'checks/fixtures/example-0.4-recipe.json'));

// A copy of one job under another id, so the library has jobs to choose between.
export function cloneJob(d, from, to){
  const ren = id => id.startsWith(from + '-') ? to + id.slice(from.length) : id;
  const w = structuredClone(d.work.find(x => x.id === from));
  Object.assign(w, { id: to, highlights: w.highlights.map(ren),
    display: { position: ren(w.display.position), meta: ren(w.display.meta) } });
  d.work.push(w);
  for (const f of d.facts.filter(x => x.id.startsWith(from + '-')).map(x => structuredClone(x))){
    const nf = { ...f, id: ren(f.id), work: to, variants: f.variants.map(ren) };
    if (f.default) nf.default = Object.fromEntries(Object.entries(f.default).map(([l, v]) => [l, ren(v)]));
    d.facts.push(nf);
    for (const id of f.variants){
      const v = structuredClone(d.variants.find(x => x.id === id));
      v.id = ren(id);
      if (v.covers) v.covers = v.covers.map(ren);
      v.metrics = { chars: v.metrics.chars };
      d.variants.push(v);
    }
  }
}

// The short Hungarian phrasings are the cheapest way to "fit", and the one Fit must never take.
export function grown(){
  const d = structuredClone(base);
  cloneJob(d, 'hydra', 'orbit'); cloneJob(d, 'hydra', 'nova');
  // three more jobs of two independent bullets each, for the order cuts are made in
  for (const id of ['pola', 'polb', 'polc']) cloneJob(d, 'poly', id);
  d.sections.find(s => s.id === 'experience').content.work = ['hydra', 'orbit', 'nova', 'poly', 'free'];
  const groups = d.sections.find(s => s.id === 'skills').content.groups;
  for (let n = 1; n <= 7; n++){
    const id = `skills-x${n}`;
    d.facts.push({ id, axis: 'density', summary: `extra group ${n}`, source: 'Example Facts.md section 8', variants: [`${id}-short`, `${id}-full`] });
    for (const [suffix, from] of [['short', 'skills-fabrication-short'], ['full', 'skills-fabrication-full']]){
      const v = structuredClone(d.variants.find(x => x.id === from));
      v.id = `${id}-${suffix}`;
      // the full phrasing runs to two lines, the short one to one, so the section can flex; appended, so mark offsets hold
      if (suffix === 'full') v.text += ' and the further example tooling, processes and materials of the fictional shop floor';
      v.metrics = { chars: [...v.text].length };
      d.variants.push(v);
    }
    groups.push(id);
  }
  for (const f of d.facts.filter(x => /-(inhaler|shop)$/.test(x.id) || /^(hydra|orbit|nova)-testing$/.test(x.id))){
    const id = `${f.id}-short-hu`;
    const text = 'Rövid magyar mondat.';
    d.variants.push({ id, lang: 'hu', text, marks: [], links: [], tags: ['hardware'], source: 'Example Facts.md section 5',
      seenIn: [], metrics: { chars: [...text].length } });
    f.variants.push(id);
  }
  // number the new versions and give the new Hungarian ones a default, as the app would
  return migrate(d);
}

export const onePager = (extra = {}) => ({
  application: 'Fit check', date: '2026-10-05', format: 'us-letter', theme: 'b2-marker', overlays: [],
  summary: 'summary',
  sections: [{ id: 'experience', weight: 5 }, { id: 'skills', weight: 3 }, { id: 'patent', weight: 2 }, { id: 'education', weight: 2 }],
  picks: {}, overrides: {},
  pages: [['header', 'summary', 'experience', 'skills', 'patent', 'education']],
  ...extra,
});
export const jobs = ids => ({ sections: [{ id: 'experience', weight: 5, work: ids }, { id: 'skills', weight: 3 }, { id: 'patent', weight: 2 }, { id: 'education', weight: 2 }] });

