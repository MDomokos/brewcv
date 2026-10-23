// What a click on the sheet selects, read from the data-variant and data-section
// attributes of an annotated render. Selection kinds: none, header, section {id, heading?},
// job {id}, bullet {id, job?, owner?, section}. Every printed text with a claim behind it counts as a bullet: the summary, a job's
// title and dates (owner: the job), the items of education, patent, certificates, languages, interests. A language's name is
// `~t:<fact>` and a section heading is the selection `{ kind: 'section', id, heading: true }` (its key is `~h:<id>`).

import { entriesOf } from '../model/entries.js';

export const NONE = Object.freeze({ kind: 'none' });
// Is the keyboard in something that is written in (a text box, a select, a line on the page)? The one guard for the plain-letter shortcuts:
// shell.js key() runs it for a key pressed in the app and for one forwarded from the resume's frame.
export const isTyping = el => !!el?.closest?.('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]), textarea, select, .ddbtn, [contenteditable]:not([contenteditable=false]), [role=textbox], [role=searchbox], [role=combobox]');

// `recipe`: its lines that exist only on this resume count as claims of their job (they have no versions).
export function indexModel(model, recipe = null){
  const factOfVariant = new Map();
  for (const f of model.facts ?? []) for (const v of f.variants ?? []) factOfVariant.set(v, f.id);
  const display = new Map(), highlight = new Map();
  for (const w of entriesOf(model)){
    for (const k of ['position', 'meta']) if (w.display?.[k]) display.set(w.display[k], w.id);
    for (const h of w.highlights ?? []) highlight.set(h, w.id);
  }
  const facts = new Map((model.facts ?? []).map(f => [f.id, f]));
  for (const [job, lines] of Object.entries(recipe?.localLines ?? {})) for (const { id } of lines){ highlight.set(id, job); facts.set(id, { id, variants: [] }); }
  // the skill groups: the record's, and the ones this resume's arrangement has (one made on the page is a claim with no versions)
  const skillGroups = new Set([...(model.sections ?? []).find(s => s.id === 'skills')?.content?.groups ?? [], ...(recipe?.skillArrangement?.groups ?? []).map(g => g.id)]);
  for (const id of skillGroups) if (!facts.has(id)) facts.set(id, { id, variants: [] });
  // the facts a list section prints (an item's title, subtitle and dates, a language, a certificate): fact → section; a job → its section
  const owned = new Map(), jobSection = new Map();
  for (const sec of model.sections ?? []){
    const c = sec.content ?? {};
    for (const id of sec.kind === 'item' ? [c.title, c.subtitle, c.meta] : sec.kind === 'pairs' ? c.pairs ?? [] : sec.kind === 'runs' ? c.items ?? [] : []) if (id) owned.set(id, sec.id);
    if (sec.kind === 'entries') for (const w of c.work ?? []) jobSection.set(w, sec.id);
  }
  const header = new Set(Object.values(model.basics?.display ?? {}));
  const summaries = new Set([model.basics?.summary, ...(model.sections ?? []).filter(s => s.kind === 'prose').map(s => s.content?.fact)].filter(Boolean));
  return {
    factOfVariant, display, highlight, header, summaries, skillGroups, owned, jobSection,
    facts,
    variants: new Map((model.variants ?? []).map(v => [v.id, v])),
    work: new Map(entriesOf(model).map(w => [w.id, w])),
    sections: new Map((model.sections ?? []).map(s => [s.id, s])),
  };
}

// The selection for a printed text by its key: a claim, or a key from the page's own labels (`~h:<section>`, `~t:<fact>`).
// null for a fact the page has no text of.
export function selOfFact(ix, fact, section = null){
  if (fact.startsWith('~h:')) return { kind: 'section', id: fact.slice(3), heading: true };
  if (fact.startsWith('~t:')) return { kind: 'bullet', id: fact, section: ix.owned.get(fact.slice(3)) ?? section ?? 'summary' };
  if (ix.header.has(fact)) return { kind: 'bullet', id: fact, section: 'header' };      // the name, the headline and the contact line are written where they print
  if (ix.skillGroups.has(fact)) return { kind: 'bullet', id: fact, section: 'skills' };
  if (ix.display.has(fact)){ const job = ix.display.get(fact); return { kind: 'bullet', id: fact, section: ix.jobSection.get(job) ?? 'experience', owner: job }; }
  if (ix.highlight.has(fact)) return { kind: 'bullet', id: fact, job: ix.highlight.get(fact), section: section ?? 'experience' };
  if (ix.owned.has(fact)) return { kind: 'bullet', id: fact, section: ix.owned.get(fact) };
  if (ix.summaries.has(fact) || section === 'summary') return { kind: 'bullet', id: fact, section: section ?? 'summary' };
  return null;
}

export function targetOf(ix, { variant = null, label = null, section = null } = {}){
  if (label) return selOfFact(ix, `~${label}`, section) ?? (section ? { kind: 'section', id: section } : NONE);
  // a "this resume only" text is drawn as <fact>-override
  const fact = !variant ? null : ix.factOfVariant.get(variant)
    ?? (variant.endsWith('-override') && ix.facts.has(variant.slice(0, -9)) ? variant.slice(0, -9) : null);
  const sel = fact && selOfFact(ix, fact, section);
  if (sel) return sel;
  if (section === 'header') return { kind: 'header' };
  if (section) return { kind: 'section', id: section };
  return NONE;
}

// Esc: a line selected in a job is the job level (the job is framed, the line marked), and one Esc more is the page; writing
// the line is a level below, which edit.js and onpage.js leave first. A job is the job level too. So: nothing is above both.
export function up(sel){
  return NONE;
}

// The keys of the page's labels (a heading, a language's name); a line only on one resume is `~new-n`, which is not one
export const isLabelKey = k => /^~[ht]:/.test(k ?? '');
// The selection for a text of the page by its key (a claim, or `~h:`/`~t:`): what the arrows and Tab walk through
export const lineSel = (ix, id) => selOfFact(ix, id) ?? { kind: 'bullet', id, section: 'summary' };
// the key of what a selection is on the page, or null
export const keyOf = sel => (sel?.kind === 'bullet' ? sel.id : sel?.kind === 'section' && sel.heading ? `~h:${sel.id}` : null);

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
  const i = order.indexOf(keyOf(sel));
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
