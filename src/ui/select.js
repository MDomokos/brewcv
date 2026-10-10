// What a click on the sheet selects, read from the data-variant and data-section
// attributes of an annotated render. Selection kinds: none, header, section {id},
// job {id}, bullet {id, job?, section}. The summary counts as a bullet.

import { entriesOf } from '../model/entries.js';

export const NONE = Object.freeze({ kind: 'none' });

export function indexModel(model){
  const factOfVariant = new Map();
  for (const f of model.facts ?? []) for (const v of f.variants ?? []) factOfVariant.set(v, f.id);
  const display = new Map(), highlight = new Map();
  for (const w of entriesOf(model)){
    for (const k of ['position', 'meta']) if (w.display?.[k]) display.set(w.display[k], w.id);
    for (const h of w.highlights ?? []) highlight.set(h, w.id);
  }
  const header = new Set(Object.values(model.basics?.display ?? {}));
  const summaries = new Set([model.basics?.summary, ...(model.sections ?? []).filter(s => s.kind === 'prose').map(s => s.content?.fact)].filter(Boolean));
  return {
    factOfVariant, display, highlight, header, summaries,
    facts: new Map((model.facts ?? []).map(f => [f.id, f])),
    variants: new Map((model.variants ?? []).map(v => [v.id, v])),
    work: new Map(entriesOf(model).map(w => [w.id, w])),
    sections: new Map((model.sections ?? []).map(s => [s.id, s])),
  };
}

export function targetOf(ix, { variant = null, section = null } = {}){
  // a "this resume only" text is drawn as <fact>-override
  const fact = !variant ? null : ix.factOfVariant.get(variant)
    ?? (variant.endsWith('-override') && ix.facts.has(variant.slice(0, -9)) ? variant.slice(0, -9) : null);
  if (fact){
    if (ix.header.has(fact)) return { kind: 'header' };
    if (ix.display.has(fact)) return { kind: 'job', id: ix.display.get(fact) };
    if (ix.highlight.has(fact)) return { kind: 'bullet', id: fact, job: ix.highlight.get(fact), section: section ?? 'experience' };
    if (ix.summaries.has(fact) || section === 'summary') return { kind: 'bullet', id: fact, section: section ?? 'summary' };
  }
  if (section === 'header') return { kind: 'header' };
  if (section) return { kind: 'section', id: section };
  return NONE;
}

// Esc: bullet → its job (or nothing, for the summary) → nothing.
export function up(sel){
  if (sel?.kind === 'bullet' && sel.job) return { kind: 'job', id: sel.job };
  return NONE;
}

export const same = (a, b) => (a?.kind ?? 'none') === (b?.kind ?? 'none') && (a?.id ?? null) === (b?.id ?? null);

export function factsOf(ix, sel){
  if (sel?.kind === 'bullet') return [sel.id];
  if (sel?.kind === 'job'){
    const w = ix.work.get(sel.id);
    return w ? [w.display?.position, w.display?.meta, ...(w.highlights ?? [])].filter(Boolean) : [];
  }
  return [];
}

// `order` is the bullet facts in print order.
export function step(order, sel, dir){
  if (!order.length) return NONE;
  const i = sel?.kind === 'bullet' ? order.indexOf(sel.id) : -1;
  const j = i < 0 ? (dir > 0 ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, i + dir));
  return order[j];
}

// A fact's versions in one language, sorted by number (v1, v2, v2.1).
export function versionsOf(ix, factId, lang = 'en'){
  const f = ix.facts.get(factId);
  if (!f) return [];
  const num = n => String(n ?? '0').split('.').map(Number);
  return f.variants.map(id => ix.variants.get(id)).filter(v => v && (v.lang ?? 'en') === lang)
    .sort((a, b) => { const x = num(a.n), y = num(b.n); return (x[0] - y[0]) || ((x[1] ?? -1) - (y[1] ?? -1)); });
}
