// Reading the record through one resume. Pure: no DOM, no I/O.
// Selection matches src/render.js: the pick, else a version seen in this format, else -base, else the first.

export const DEFAULT_LANG = 'en';
const langOf = v => v?.lang ?? DEFAULT_LANG;
export const isDraft = v => /-draft(-|$)/.test(v?.id ?? '');
// One archive: the `archived` flag, on a claim, a job or (when its claim is not wholly archived) one wording.
// The old `archive` tag is still read, so a file nobody has opened yet is refused as before; loading removes it.
export const isArchive = v => v?.archived === true || (v?.tags ?? []).some(t => String(t).toLowerCase() === 'archive');
// Why a version must not be chosen for a new resume, or null. Fit and the command-line tools share it.
// `fact.archived` is honoured if the record has it.
export function refusal(fact, v){
  if (isDraft(v)) return 'draft';
  if (isArchive(v)) return 'archive';
  if (fact?.archived) return 'archived claim';
  return null;
}

import { keyed, t } from '../i18n/index.js';
import { entriesOf, entryKey, isEntry, archivedIds, archivedEntryIds } from './entries.js';
import { offOf, keepOf, keepLinks, migratePins, inOrder, localOf, localJob, localIds, isLocal, withLocal, termOf } from '../recipe.js';
import { designOf, PRESETS, RELATED } from './design.js';
import { lookOf } from '../themes.js';
import { LockedError, guard, guardOff, guardUp, isLocked, skillsSection } from './lock.js';
export { offOf, keepOf, migratePins, inOrder, isLocal, localOf, termOf };

function index(model){
  return {
    byId: new Map((model.variants ?? []).map(v => [v.id, v])),
    factById: new Map((model.facts ?? []).map(f => [f.id, f])),
  };
}

export function chooseVariant(model, factId, recipe = null, ix = index(model)){
  const lang = recipe?.lang ?? DEFAULT_LANG;
  const probs = [];
  const f = ix.factById.get(factId);
  if (!f) return { v: null, probs: [`no such fact: ${factId}`] };
  const wanted = recipe?.picks?.[factId];
  let v = wanted ? ix.byId.get(wanted) : null;
  if (wanted && !v) probs.push(`recipe picks ${wanted} for ${factId}, which does not exist`);
  if (v && !f.variants.includes(v.id)) probs.push(`recipe picks ${v.id} for ${factId}, which is not one of its phrasings`);
  if (v && langOf(v) !== lang) probs.push(`recipe picks ${v.id} for ${factId}, which is lang "${langOf(v)}", in a lang "${lang}" export`);
  if (!v){
    const vs = f.variants.map(x => ix.byId.get(x)).filter(Boolean).filter(x => langOf(x) === lang);
    v = vs.find(x => (x.seenIn ?? []).includes(recipe?.format)) ?? vs.find(x => x.id.endsWith('-base')) ?? vs[0];
  }
  // No version in this language: English prints. Reported unless the fact is marked same everywhere.
  if (!v && lang !== DEFAULT_LANG){
    const ens = f.variants.map(x => ix.byId.get(x)).filter(Boolean).filter(x => langOf(x) === DEFAULT_LANG);
    v = ens.find(x => (x.seenIn ?? []).includes(recipe?.format)) ?? ens.find(x => x.id.endsWith('-base')) ?? ens[0] ?? null;
    if (v && !(model.same ?? []).includes(`fact:${factId}`)) probs.push(`fact ${factId} has no "${lang}" version, so it prints in ${DEFAULT_LANG === 'en' ? 'English' : DEFAULT_LANG}`);
  }
  if (!v){
    const had = [...new Set(f.variants.map(x => langOf(ix.byId.get(x))))];
    return { v: null, probs: [...probs, `fact ${factId} has no "${lang}" phrasing to export` + (had.length ? `; it has ${had.join(', ')}` : '')] };
  }
  if (isDraft(v)) probs.push(`${v.id} is an unreviewed draft and cannot be exported`);
  if (!v.source && model.requireSource !== false) probs.push(`${v.id} has no source and cannot be exported`);
  if (v.text.includes('⬜')) probs.push(`${v.id} carries a ⬜ placeholder`);
  return { v, probs };
}

export const vOf = (model, factId, recipe = null) => chooseVariant(model, factId, recipe).v;
export const textOf = (model, factId, recipe = null) => vOf(model, factId, recipe)?.text ?? '';

// What the record file's JSON Resume body shows. Unlike the renderer's rule, it ignores the format.
export function defaultVariant(model, factId, lang = DEFAULT_LANG, ix = index(model)){
  const f = ix.factById.get(factId);
  if (!f) return null;
  const set = f.default?.[lang] && ix.byId.get(f.default[lang]);
  if (set && langOf(set) === lang && f.variants.includes(set.id)) return set;
  const vs = f.variants.map(x => ix.byId.get(x)).filter(v => v && langOf(v) === lang);
  return vs.find(v => v.id.endsWith('-base')) ?? vs[0] ?? null;
}

// strips the app's own keys
const appless = x => { if (!x || typeof x !== 'object') return x; const { id, display, during, highlights, ...rest } = structuredClone(x); return highlights === undefined ? rest : { ...rest, highlights }; };
// JSON Resume v1.0.0's own fields, per section (the same list as schema.js's
// conformance check). The printed resume carries these and leaves the app's
// own keys (ids, display refs, work rights, a patent's number) behind.
const JR = {
  location: ['address', 'postalCode', 'city', 'countryCode', 'region'],
  work: ['url', 'description', 'summary'],
  education: ['url', 'courses'],
  certificates: ['date', 'url'],
  skills: ['level'],
  interests: ['keywords'],
};
const std = (x, keys) => Object.fromEntries(keys.filter(k => x?.[k] !== undefined && x[k] !== null && x[k] !== '').map(k => [k, structuredClone(x[k])]));

// The body is built even with ATS `problems`: a saved resume must record what it printed.
// `local: false` leaves out the lines that exist only on this resume (the JSON Resume file).
export function resolve(model, recipe = null, { local = true } = {}){
  const ix = index(model);
  const problems = [];
  const over = id => recipe?.overrides?.[id];
  const pick = id => { const { v, probs } = chooseVariant(model, id, recipe, ix); problems.push(...probs); return v; };
  const textFor = id => { if (over(id) !== undefined) return String(over(id)); const v = pick(id); return v ? v.text : null; };

  // bullets a picked -merged version covers never print, so they are dropped unreported
  function highlightsOf(w, only){
    const base = only ?? w.highlights;
    for (const id of base) if (!w.highlights.includes(id)) problems.push(`recipe asks ${w.id} for ${id}, which is not one of its highlights`);
    const ids = local ? withLocal(recipe, w.id, base, { full: w.highlights }) : base;
    const got = ids.map(id => [id, chooseVariant(model, id, recipe, ix)]);
    const covered = new Set();
    for (const [, { v }] of got) for (const c of v?.covers ?? []) covered.add(c);
    const out = [];
    for (const [id, { v, probs }] of got){
      if (covered.has(id)) continue;
      if (over(id) !== undefined){ out.push(String(over(id))); continue; }
      problems.push(...probs);
      if (v) out.push(v.text);
    }
    return out;
  }

  for (const [factId, text] of Object.entries(recipe?.overrides ?? {})){
    const base = ix.byId.get(recipe.overrideMeta?.[factId]?.base);
    for (const l of keepLinks(base, String(text)).dropped) problems.push(`the edit of ${factId} dropped the link to ${l.href}: its words are not in the new text`);
    problems.push(isLocal(recipe, factId)
      ? `recipe has a line that exists only on this resume ("${String(text).slice(0, 40)}…"): it has no source, so it is left out of an ATS export`
      : `recipe overrides ${factId} with one-off text ("${String(text).slice(0, 40)}…"): overrides have no source, so they cannot go to an ATS export`);
  }

  const workRefs = inOrder((recipe && recipe.sections?.find(s => s.id === 'experience')?.work) ?? (model.work ?? []).map(w => w.id), recipe?.sections?.find(s => s.id === 'experience')?.order)
    .map(r => (typeof r === 'string' ? { id: r } : r));
  const workById = new Map((model.work ?? []).map(w => [w.id, w]));
  const wantSection = id => !recipe ? true : (recipe.sections ?? []).some(s => s.id === id) || id === 'header';

  const b = model.basics ?? {};
  const summaryFact = recipe?.summary ?? b.summary;
  // i18n.<lang>.fields["work/<id>/location"]
  const lang = recipe?.lang ?? DEFAULT_LANG;
  const field = (path, fallback) => (lang !== DEFAULT_LANG ? model.i18n?.[lang]?.fields?.[path] : undefined) ?? fallback;

  const body = {
    basics: {
      name: b.name,
      label: b.label,
      email: b.email,
      phone: b.phone,
      url: b.url,
      summary: summaryFact ? textFor(summaryFact) : undefined,
      location: { city: b.location?.city, countryCode: b.location?.countryCode, ...std(b.location, JR.location) },
      profiles: (b.profiles ?? [])
        .filter(p => p.url !== b.url)
        .map(p => ({ network: p.network, username: p.username, url: p.url })),
    },
    work: workRefs.filter(ref => {
      if (workById.has(ref.id)) return true;
      problems.push(`recipe names work entry ${ref.id}, which does not exist`);
      return false;
    }).map(ref => {
      const r = workById.get(ref.id);
      const highlights = highlightsOf(r, ref.highlights ?? null);
      return {
        name: r.name,
        position: (r.display?.position ? textFor(r.display.position) : null) ?? r.position,
        location: field(`work/${r.id}/location`, r.location),
        startDate: r.startDate,
        ...(r.endDate ? { endDate: r.endDate } : {}),
        ...std(r, JR.work),
        highlights,
      };
    }),
    // `score` is JSON Resume's field for a grade or honours
    education: (model.education ?? []).map(e => ({
      institution: e.institution,
      area: e.area,
      studyType: e.studyType,
      ...(e.startDate ? { startDate: e.startDate } : {}),
      ...(e.endDate ? { endDate: e.endDate } : {}),
      ...((e.score ?? e.honours) ? { score: e.score ?? e.honours } : {}),
      ...std(e, JR.education),
    })),
    publications: (model.publications ?? []).map(p => ({
      name: p.name,
      publisher: p.publisher,
      releaseDate: p.releaseDate,
      ...(p.url ? { url: p.url } : {}),
      summary: p.summary ?? [p.role, p.identifier].filter(Boolean).join(' · '),
    })),
    certificates: (model.certificates ?? []).map(c => ({ name: c.name, issuer: c.issuer, ...std(c, JR.certificates) })),
    skills: recipe?.skillArrangement      // the groups this resume arranges on its page, as it prints them
      ? (wantSection('skills') ? recipe.skillArrangement.groups.filter(a => a.items.length).map(a => ({ name: a.label ?? groupLabel(model, recipe, a.id), keywords: [...a.items] })) : [])
      : (model.skills ?? []).filter(() => wantSection('skills'))
        .map(s => ({ name: s.name, ...std(s, JR.skills), keywords: s.keywords })),
    languages: (model.languages ?? []).map(l => ({ language: l.language, fluency: l.fluency })),
    interests: (model.interests ?? []).map(i => ({ name: i.name, ...std(i, JR.interests) })),
  };

  // a merged pick can empty a job
  body.work = body.work.filter(w => w.highlights.length);
  // sections the app doesn't draw go back out as they came, so the round trip loses nothing
  for (const k of ['projects', 'volunteer', 'awards', 'references'])
    if (Array.isArray(model[k]) && model[k].length) body[k] = structuredClone(model[k]).filter(x => !isEntry(x) && !(k === 'references' && x?.id)).map(appless);
  // the app's references, as printed: only when the resume shows their section (always, with no resume)
  const refs = (model.references ?? []).filter(r => r?.id);
  const refsOn = !recipe || (recipe.sections ?? []).some(s => (typeof s === 'string' ? s : s?.id) === 'references' && s?.weight !== 0);
  if (refs.length && refsOn) body.references = [...(body.references ?? []), ...refs.map(r => ({ name: r.name, reference: textFor(r.id) ?? r.reference }))];
  if (Array.isArray(body.references) && !body.references.length) delete body.references;
  // entries made from projects and volunteering: those their section lists, or all with no recipe
  for (const k of ['projects', 'volunteer']){
    const made = (model[k] ?? []).filter(isEntry);
    if (!made.length) continue;
    const byId = new Map(made.map(x => [x.id, x]));
    const refs = made.map(x => {
      const sid = sectionOfEntry(model, x.id);
      const sec = recipe?.sections?.find(s => s?.id === sid);
      if (recipe && (!sec || sec.weight === 0)) return null;
      const ref = (sec?.work ?? []).map(r => (typeof r === 'string' ? { id: r } : r)).find(r => r.id === x.id);
      return recipe && sec?.work ? ref ?? null : { id: x.id };
    }).filter(Boolean);
    const out = refs.map(ref => {
      const x = byId.get(ref.id);
      const highlights = highlightsOf(x, ref.highlights ?? null);
      const title = (x.display?.position ? textFor(x.display.position) : null);
      const dates = { ...(x.startDate ? { startDate: x.startDate } : {}), ...(x.endDate ? { endDate: x.endDate } : {}) };
      return k === 'projects' ? { ...appless(x), name: title ?? x.name, ...dates, highlights }
        : { ...appless(x), position: title ?? x.position, ...dates, highlights };
    }).filter(x => x.highlights.length);
    if (out.length) body[k] = [...(body[k] ?? []), ...out];
    else if (!(body[k] ?? []).length) delete body[k];
  }
  // JSON.stringify drops undefined; do it here so the body equals its own file
  return { body: JSON.parse(JSON.stringify(body)), problems };
}

// Same selection and order as resolve(), so printed[i] is where body text i came from.
export function printedFacts(model, recipe = null){
  const ix = index(model);
  const textOf2 = id => (recipe?.overrides?.[id] !== undefined ? String(recipe.overrides[id]) : chooseVariant(model, id, recipe, ix).v?.text ?? null);
  const b = model.basics ?? {};
  const summaryFact = recipe?.summary ?? b.summary;
  const out = { summary: summaryFact ? { fact: summaryFact, text: textOf2(summaryFact) } : null, work: [] };
  const workRefs = inOrder((recipe && recipe.sections?.find(s => s.id === 'experience')?.work) ?? (model.work ?? []).map(w => w.id), recipe?.sections?.find(s => s.id === 'experience')?.order)
    .map(r => (typeof r === 'string' ? { id: r } : r));
  const workById = new Map((model.work ?? []).map(w => [w.id, w]));
  for (const ref of workRefs){
    const w = workById.get(ref.id);
    if (!w) continue;
    const ids = withLocal(recipe, w.id, ref.highlights ?? w.highlights, { full: w.highlights });
    const got = ids.map(id => [id, chooseVariant(model, id, recipe, ix).v]);
    const covered = new Set(got.flatMap(([, v]) => v?.covers ?? []));
    const hs = got.filter(([id, v]) => !covered.has(id) && (v || recipe?.overrides?.[id] !== undefined)).map(([id]) => ({ fact: id, text: textOf2(id) }));
    if (!hs.length) continue;
    const pos = w.display?.position;
    out.work.push({ job: w.id, position: pos ? { fact: pos, text: textOf2(pos) } : null, highlights: hs });
  }
  return out;
}

// Matched by position. A job whose bullet count changed is skipped rather than guessed.
export function frozenDiffs(model, recipe, frozen){
  if (!frozen) return [];
  const p = printedFacts(model, recipe);
  const out = [];
  const cmp = (slot, text) => { if (slot && typeof text === 'string' && slot.text !== null && text !== slot.text) out.push({ fact: slot.fact, frozen: text, live: slot.text }); };
  cmp(p.summary, frozen.basics?.summary);
  const fw = frozen.work ?? [];
  p.work.forEach((w, i) => {
    const f = fw[i];
    if (!f) return;
    cmp(w.position, f.position);
    if ((f.highlights ?? []).length !== w.highlights.length) return;
    w.highlights.forEach((h, j) => cmp(h, f.highlights[j]));
  });
  return out;
}

// Everything on, paginated by measurement. Empty picks let the selection rule decide.
export function newResume(model, { format = 'a4', lang = DEFAULT_LANG, pageLimit = 1, theme = 'b2-marker' } = {}){
  const arch = archivedIds(model);
  const entries = new Map(entriesOf(model).map(w => [w.id, w]));
  // an archived claim is left out; a job with none left is left out too
  const hiddenJobs = archivedEntryIds(model);
  const refs = ids => ids.filter(id => !hiddenJobs.has(id)).map(id => {
    const w = entries.get(id);
    if (!w || !(w.highlights ?? []).some(h => arch.has(h))) return id;
    const hs = w.highlights.filter(h => !arch.has(h));
    return hs.length ? { id, highlights: hs } : null;
  }).filter(Boolean);
  const sections = (model.sections ?? []).filter(s => s.kind !== 'header' && s.id !== 'summary')
    .map(s => (s.kind === 'entries' ? { id: s.id, weight: s.off ? 0 : 5, work: refs([...(s.content?.work ?? [])]) } : s.off ? { id: s.id, weight: 0 } : { id: s.id }));
  return {
    application: model.basics?.name ? t('resumes.newName', { name: model.basics.name }) : t('resumes.newNameless'),
    company: '', role: '', jobType: '', tags: [],
    format, theme, overlays: [],
    ...(lang !== DEFAULT_LANG ? { lang } : {}),
    summary: model.basics?.summary ?? 'summary',
    sections, picks: {}, overrides: {},
    pageLimit,
    photo: { show: false, shape: 'rect' },
    savedAt: null,
  };
}

// Tailoring: edits a recipe in place. Only useLabelEverywhere() writes to the record.
// Printed bullets live in the `pages` slot for a hand layout, else sections[experience].work.
// `off`: Fit never adds the bullet back. `keep`: Fit won't change or remove it.

const factIx = model => ({
  work: new Map(entriesOf(model).map(w => [w.id, w])),
  sections: new Map((model.sections ?? []).map(s => [s.id, s])),
});
const refId = r => (typeof r === 'string' ? r : r?.id);
const isFixed = (model, id) => id === 'header' || id === 'summary' || factIx(model).sections.get(id)?.kind === 'header';
const hasBudgetIn = (model, id) => factIx(model).sections.has(id) && !isFixed(model, id);
const entryOf = (recipe, id) => (recipe.sections ?? []).find(x => x && typeof x === 'object' && x.id === id);
const entriesId = model => (model.sections ?? []).find(s => s.kind === 'entries')?.id ?? 'experience';
const entriesIds = model => { const ids = (model.sections ?? []).filter(s => s.kind === 'entries').map(s => s.id); return ids.length ? ids : ['experience']; };
export const sectionOfEntry = (model, id) => (model.sections ?? []).find(s => s.kind === 'entries' && (s.content?.work ?? []).includes(id))?.id ?? entriesId(model);

// also finds projects and volunteering
// A line that exists only on this resume belongs to its job through `recipe`.
export const jobOfFact = (model, factId, recipe = null) => {
  const own = recipe && localJob(recipe, factId);
  return entriesOf(model).find(w => own ? w.id === own : (w.highlights ?? []).includes(factId)) ?? null;
};

// A hand layout's page slots, else the section entry (made if missing).
function workLists(model, recipe, make = true, sid = entriesId(model)){
  if (Array.isArray(recipe.pages)){
    const out = [];
    for (const page of recipe.pages) for (const [i, slot] of page.entries()){
      if (refId(slot) !== sid) continue;
      if (typeof slot === 'string'){
        page[i] = { id: sid, work: structuredClone(entryOf(recipe, sid)?.work ?? factIx(model).sections.get(sid)?.content?.work ?? []) };
      }
      page[i].work ??= structuredClone(entryOf(recipe, sid)?.work ?? factIx(model).sections.get(sid)?.content?.work ?? []);
      out.push(page[i].work);
    }
    return out;
  }
  let e = entryOf(recipe, sid);
  if (!e){
    if (!make) return [];
    recipe.sections ??= [];
    e = { id: sid, weight: 5 };
    recipe.sections.splice(Math.min(recipe.sections.length, 0), 0, e);
  }
  e.work ??= [...(factIx(model).sections.get(sid)?.content?.work ?? [])];
  return [e.work];
}

// For a hand layout, sections[experience].work mirrors the slots, as Fit's finalise() writes it.
function syncSections(model, recipe){
  if (!Array.isArray(recipe.pages)) return;
  for (const sid of entriesIds(model)){
    const e = entryOf(recipe, sid);
    if (!e || !e.work) continue;
    e.work = structuredClone(recipe.pages.flat().filter(s => typeof s === 'object' && s.id === sid).flatMap(s => s.work ?? []));
  }
}

// a ref with every highlight in library order is the bare id
function tidyRef(w, ref){
  const hs = typeof ref === 'string' ? w.highlights : ref.highlights ?? w.highlights;
  if (hs.length === w.highlights.length && hs.every((h, i) => h === w.highlights[i])) return w.id;
  return { ...(typeof ref === 'object' ? ref : {}), id: w.id, highlights: [...hs] };
}
const highlightsOfRef = (w, ref) => [...((typeof ref === 'string' ? null : ref.highlights) ?? w.highlights)];

const addTo = (list, id) => { if (!list.includes(id)) list.push(id); return list; };
const dropFrom = (list, id) => (list ?? []).filter(x => x !== id);
function setList(recipe, k, id, on){
  recipe[k] = on ? addTo([...(recipe[k] ?? (k === 'off' ? offOf(recipe) : keepOf(recipe)))], id)
    : dropFrom(recipe[k] ?? (k === 'off' ? offOf(recipe) : keepOf(recipe)), id);
  delete recipe.pins;
  if (!recipe[k].length) delete recipe[k];
}

// `sid` narrows to one entries section.
export function jobRefs(model, recipe, sid = null){
  const one = id => (Array.isArray(recipe.pages)
    ? recipe.pages.flat().filter(s => typeof s === 'object' && s.id === id).map(s => s.work ?? [])
    : [inOrder(entryOf(recipe, id)?.work ?? (entryOf(recipe, id) ? factIx(model).sections.get(id)?.content?.work ?? [] : []), entryOf(recipe, id)?.order)]).flat();
  return (sid ? [sid] : entriesIds(model)).flatMap(one);
}
// The jobs of an entries section in this resume's order, with the ones that are off kept in their places (the sidebar lists them so, and
// turning one on puts it back there): an off job stands after the job before it in the section's `order`, else where the record puts it
// (before the first job that is on and comes later in the record). Archived jobs are not listed.
export function jobOrder(model, recipe, sid){
  const all = (factIx(model).sections.get(sid)?.content?.work ?? []).filter(id => !archivedEntryIds(model).has(id)), rank = id => all.indexOf(id);
  const out = jobRefs(model, recipe, sid).map(refId), order = Array.isArray(recipe.pages) ? [] : entryOf(recipe, sid)?.order ?? [];
  for (const id of new Set([...order.filter(x => all.includes(x)), ...all])){
    if (out.includes(id)) continue;
    const k = order.indexOf(id), prev = k < 0 ? undefined : order.slice(0, k).reverse().find(x => out.includes(x));
    const at = k >= 0 ? (prev == null ? 0 : out.indexOf(prev) + 1) : out.findIndex(x => rank(x) > rank(id));
    out.splice(at < 0 ? out.length : at, 0, id);
  }
  return out;
}
const listedFacts = (model, recipe, jobId) => {
  const w = factIx(model).work.get(jobId);
  return w ? jobRefs(model, recipe).filter(r => refId(r) === jobId).flatMap(r => highlightsOfRef(w, r)) : [];
};
// what prints, in order: the job's bullets and its local lines
export const listedBullets = (model, recipe, jobId) => withLocal(recipe, jobId, listedFacts(model, recipe, jobId), { blank: true, full: factIx(model).work.get(jobId)?.highlights });
// …with the local lines that are switched off kept in their places
const fullOrder = (model, recipe, jobId) => withLocal(recipe, jobId, listedFacts(model, recipe, jobId), { keepOff: true, blank: true, full: factIx(model).work.get(jobId)?.highlights });
// A job's lines in this resume's order with the ones that are off kept in their places (the sidebar lists them so, and turning one on puts it
// back there): an off line stands after the line before it in the `order` its job's ref keeps while a line is off, else where the record
// puts it. Archived lines are not listed. The ref's `order` never prints (render reads `highlights`).
export function lineOrder(model, recipe, jobId){
  const w = factIx(model).work.get(jobId);
  if (!w) return [];
  const arch = archivedIds(model), all = w.highlights.filter(h => !arch.has(h)), rank = id => all.indexOf(id);
  const out = fullOrder(model, recipe, jobId), ref = jobRefs(model, recipe).find(r => refId(r) === jobId);
  const order = (typeof ref === 'object' && Array.isArray(ref?.order)) ? ref.order : [];
  for (const id of new Set([...order.filter(x => all.includes(x)), ...all])){
    if (out.includes(id)) continue;
    const k = order.indexOf(id), prev = k < 0 ? undefined : order.slice(0, k).reverse().find(x => out.includes(x));
    const at = k >= 0 ? (prev == null ? 0 : out.indexOf(prev) + 1) : out.findIndex(x => rank(x) > rank(id));
    out.splice(at < 0 ? out.length : at, 0, id);
  }
  return out;
}
// …kept on the job's refs (`order`, the record's lines only) only while it places an off line where the record's order would not
function keepLineOrder(model, recipe, jobId, shown){
  const w = factIx(model).work.get(jobId), lists = workLists(model, recipe, true, sectionOfEntry(model, jobId));
  const order = shown.filter(x => w.highlights.includes(x)), mine = (l, i) => refId(l[i]) === jobId && typeof l[i] === 'object';
  for (const l of lists) l.forEach((r, i) => { if (mine(l, i)){ const { order: _, ...rest } = r; l[i] = tidyRef(w, rest); } });
  const plain = lineOrder(model, recipe, jobId).filter(x => w.highlights.includes(x));
  if (plain.length === order.length && plain.every((x, i) => x === order[i])) return;
  for (const l of lists) l.forEach((r, i) => { if (mine(l, i)) l[i] = { ...r, order }; });
}
// A local line follows the one before it in `order`; the list is kept in print order so each anchor comes first.
function reanchor(recipe, jobId, order){
  const mine = localOf(recipe, jobId);
  recipe.localLines = { ...recipe.localLines, [jobId]: order.filter(id => mine.some(l => l.id === id))
    .map(id => ({ ...mine.find(l => l.id === id), after: order[order.indexOf(id) - 1] ?? null })) };
}

// A new empty line on this resume only, after `afterId` (a bullet or local line of the job; null: first).
export function addLocalLine(model, recipe, jobId, afterId = null){
  if (!factIx(model).work.has(jobId)) throw new Error(`no such job: ${jobId}`);
  guard(model, recipe, jobId);
  const used = localIds(recipe);
  let n = 1; while (used.has(`~new-${n}`) || recipe.locked?.includes(`~new-${n}`)) n++;      // a stale lock on that name must not be inherited
  const id = `~new-${n}`, order = fullOrder(model, recipe, jobId), at = order.indexOf(afterId);
  order.splice(afterId == null ? 0 : at < 0 ? order.length : at + 1, 0, id);
  recipe.localLines = { ...recipe.localLines, [jobId]: [...localOf(recipe, jobId), { id, after: null, ...((recipe.lang ?? DEFAULT_LANG) !== DEFAULT_LANG ? { lang: recipe.lang } : {}) }] };
  reanchor(recipe, jobId, order);
  // empty, so the page has a line to write in; leaving it empty removes the line
  recipe.overrides = { ...recipe.overrides, [id]: '' };
  recipe.overrideMeta = { ...recipe.overrideMeta, [id]: { marks: [], base: null } };
  return id;
}
export function removeLocalLine(model, recipe, id){
  const job = localJob(recipe, id);
  if (!job) return;
  guard(model, recipe, id);
  const rest = localOf(recipe, job).filter(l => l.id !== id).map(l => (l.after === id ? { ...l, after: localOf(recipe, job).find(x => x.id === id).after } : l));
  recipe.localLines = Object.fromEntries(Object.entries({ ...recipe.localLines, [job]: rest }).filter(([, l]) => l.length));
  if (!Object.keys(recipe.localLines).length) delete recipe.localLines;
  dropOverride(model, recipe, id);
  setList(recipe, 'off', id, false);
}

export function setJobOn(model, recipe, jobId, on){
  const w = factIx(model).work.get(jobId);
  if (!w) throw new Error(`no such job: ${jobId}`);
  if (on) guardUp(model, recipe, jobId); else guardOff(model, recipe, jobId);
  const sid = sectionOfEntry(model, jobId);
  const lists = workLists(model, recipe, true, sid);
  if (on && w.archived && !lists.some(l => l.some(r => refId(r) === jobId))) throw keyed('arch.jobNeedUnarchive');
  const has = lists.some(l => l.some(r => refId(r) === jobId));
  if (!on){
    for (const l of lists) for (let i = l.length - 1; i >= 0; i--) if (refId(l[i]) === jobId) l.splice(i, 1);
  } else if (!has && lists.length){
    // back where the sidebar showed it while it was off (jobOrder): before the next job that is on
    const shown = jobOrder(model, recipe, sid), on = new Set(lists.flat().map(refId));
    const next = shown.slice(shown.indexOf(jobId) + 1).find(x => on.has(x));
    const l = lists.find(l => l.some(r => refId(r) === next)) ?? lists.at(-1);
    const at = next == null ? -1 : l.findIndex(r => refId(r) === next);
    const off = new Set(offOf(recipe)), arch = archivedIds(model);
    l.splice(at < 0 ? l.length : at, 0, tidyRef(w, { id: jobId, highlights: w.highlights.filter(h => !off.has(h) && !arch.has(h)) }));
  }
  syncSections(model, recipe);
}

export function setBulletOn(model, recipe, factId, on){
  const w = jobOfFact(model, factId, recipe);
  if (!w) throw new Error(`${factId} is not a bullet of any job`);
  guard(model, recipe, factId);
  if (isLocal(recipe, factId)) return setList(recipe, 'off', factId, !on);
  const order = on || !localOf(recipe, w.id).length ? null : fullOrder(model, recipe, w.id);
  const sid = sectionOfEntry(model, w.id);
  if (on && archivedIds(model).has(factId) && !listedBullets(model, recipe, w.id).includes(factId)) throw keyed('arch.needUnarchive');
  if (on && !jobRefs(model, recipe, sid).some(r => refId(r) === w.id)){
    setList(recipe, 'off', factId, false);
    setJobOn(model, recipe, w.id, true);
  }
  const shown = lineOrder(model, recipe, w.id);      // where the sidebar shows it: an off line keeps that place, and comes back to it
  const lists = workLists(model, recipe, true, sid);
  let placed = false;
  for (const l of lists) l.forEach((r, i) => {
    if (refId(r) !== w.id) return;
    let hs = highlightsOfRef(w, r);
    if (!on) hs = hs.filter(h => h !== factId);
    else if (!placed && !hs.includes(factId)){
      // before the next line that prints after its place, so an order the person set stays as it is
      const next = shown.slice(shown.indexOf(factId) + 1).find(h => hs.includes(h)), at = next == null ? -1 : hs.indexOf(next);
      hs.splice(at < 0 ? hs.length : at, 0, factId);
    }
    if (on && hs.includes(factId)) placed = true;
    l[i] = tidyRef(w, { ...(typeof r === 'object' ? r : {}), id: w.id, highlights: hs });
  });
  setList(recipe, 'off', factId, !on);
  if (order) reanchor(recipe, w.id, order.filter(x => x !== factId));   // its local lines stay where they were
  keepLineOrder(model, recipe, w.id, shown);
  syncSections(model, recipe);
}

// Keeping a bullet that doesn't print also turns it off, so it stays off.
export function setKeep(model, recipe, factId, on){
  guard(model, recipe, factId);
  setList(recipe, 'keep', factId, on);
  if (on){
    const w = jobOfFact(model, factId);
    if (w && !listedBullets(model, recipe, w.id).includes(factId)) setList(recipe, 'off', factId, true);
  }
}

// One-off text for this resume only. null removes it. `{ marks, base }` (the highlights it keeps and the version it was
// written from) go in recipe.overrideMeta; without them the call leaves the recipe's other keys alone.
export function setOverride(model, recipe, factId, text, meta = null){
  guard(model, recipe, factId);
  if (text == null || text === '') return isLocal(recipe, factId) ? removeLocalLine(model, recipe, factId) : dropOverride(model, recipe, factId);   // a line only here, emptied, is gone
  recipe.overrides = { ...(recipe.overrides ?? {}), [factId]: String(text) };
  const job = localJob(recipe, factId);      // a line only here is in the language it was last typed in
  if (job){
    const to = recipe.lang ?? DEFAULT_LANG;
    recipe.localLines = { ...recipe.localLines, [job]: localOf(recipe, job).map(l => { if (l.id !== factId) return l; const { lang: _, ...r } = l; return to === DEFAULT_LANG ? r : { ...r, lang: to }; }) };
  }
  if (!meta){ if (recipe.overrideMeta?.[factId]) recipe.overrideMeta = Object.fromEntries(Object.entries(recipe.overrideMeta).filter(([k]) => k !== factId)); return; }
  recipe.overrideMeta = { ...(recipe.overrideMeta ?? {}), [factId]: { marks: meta.marks ?? [], base: meta.base ?? recipe.overrideMeta?.[factId]?.base ?? null } };
  if (recipe.parked) delete recipe.parked[factId];
}

// An edit set aside (parked) when a version is picked over it; picking the edit again (unpark) puts it back.
export function dropOverride(model, recipe, factId){
  guard(model, recipe, factId);
  if (recipe.overrides) recipe.overrides = Object.fromEntries(Object.entries(recipe.overrides).filter(([k]) => k !== factId));
  for (const k of ['overrideMeta', 'parked']){      // an emptied map goes too, so a recipe that is back where it was is byte-identical
    if (!recipe[k]) continue;
    const rest = Object.fromEntries(Object.entries(recipe[k]).filter(([id]) => id !== factId));
    if (Object.keys(rest).length) recipe[k] = rest; else delete recipe[k];
  }
}
export function parkOverride(model, recipe, factId){
  guard(model, recipe, factId);
  if (!(factId in (recipe.overrides ?? {}))) return;
  recipe.parked = { ...(recipe.parked ?? {}), [factId]: { text: recipe.overrides[factId], meta: recipe.overrideMeta?.[factId] } };
  const { [factId]: _o, ...overrides } = recipe.overrides; recipe.overrides = overrides;
  if (recipe.overrideMeta){ const { [factId]: _m, ...meta } = recipe.overrideMeta; recipe.overrideMeta = meta; }
}
export function unparkOverride(model, recipe, factId){
  const p = recipe.parked?.[factId];
  if (p) setOverride(model, recipe, factId, p.text, p.meta ?? {});
}
export const overrideOf = (recipe, factId) => (factId in (recipe.overrides ?? {})
  ? { text: recipe.overrides[factId], ...(recipe.overrideMeta?.[factId] ?? {}), on: true }
  : recipe.parked?.[factId] ? { text: recipe.parked[factId].text, ...(recipe.parked[factId].meta ?? {}), on: false } : null);
// A second edit of a line does not replace the first (UX-6f): the one on the page, if it is still to be decided on, is kept among the line's earlier
// edits (recipe.earlier[fact], oldest first) before the new text is set, so each stays its own row of the versions list. Not printed.
export function stackOverride(model, recipe, factId){
  guard(model, recipe, factId);
  const o = overrideOf(recipe, factId);
  if (!o?.on || o.kept) return;
  const rest = (recipe.earlier?.[factId] ?? []).filter(e => e.text !== o.text);
  recipe.earlier = { ...(recipe.earlier ?? {}), [factId]: [...rest, { text: o.text, marks: o.marks ?? [], base: o.base ?? null }] };
}
// The saved resumes that print a line in their own words (an edit of it on that resume, not locked), and the switch back to the record's wording
// for all of them (UX-6f: a date line follows its dates again). A locked resume is left as it is.
export const ownWording = (model, recipes, factId) => recipes.filter(r => r.overrides?.[factId] !== undefined && !isLocked(model, r, factId));
export function useRecordWording(model, recipes, factId){
  const rs = ownWording(model, recipes, factId);
  for (const r of rs) dropOverride(model, r, factId);
  return rs.length;
}
export const earlierOf = (recipe, factId) => recipe.earlier?.[factId] ?? [];
// An earlier edit goes: used up (made a version) or thrown away.
export function dropEarlier(model, recipe, factId, at){
  guard(model, recipe, factId);
  const rest = earlierOf(recipe, factId).filter((_, i) => i !== at);
  if (rest.length) recipe.earlier = { ...recipe.earlier, [factId]: rest };
  else if (recipe.earlier){ const { [factId]: _e, ...others } = recipe.earlier; if (Object.keys(others).length) recipe.earlier = others; else delete recipe.earlier; }
}
// Show an earlier edit on the page: it and the one on the page change places.
export function swapEarlier(model, recipe, factId, at){
  const e = earlierOf(recipe, factId)[at];
  if (!e) return;
  guard(model, recipe, factId);
  const now = overrideOf(recipe, factId);
  if (now?.on) recipe.earlier = { ...recipe.earlier, [factId]: earlierOf(recipe, factId).map((x, i) => (i === at ? { text: now.text, marks: now.marks ?? [], base: now.base ?? null } : x)) };
  else dropEarlier(model, recipe, factId, at);
  setOverride(model, recipe, factId, e.text, { marks: e.marks, base: e.base });
}
// The edits not yet decided on (UX-6d's Review list).
export const pendingEdits = recipe => Object.keys(recipe.overrides ?? {}).filter(f => !recipe.overrideMeta?.[f]?.kept);
// …and the ones UX-6d's Review list may offer: it skips a locked line (it would change its text), so it reads this, not pendingEdits.
export const reviewableEdits = (model, recipe) => pendingEdits(recipe).filter(f => !isLocked(model, recipe, f));
export function keepHere(recipe, factId){
  recipe.overrideMeta = { ...(recipe.overrideMeta ?? {}), [factId]: { ...recipe.overrideMeta?.[factId], kept: true } };
}
// Picking a version sets any edit of that claim aside.
export function pickVersion(model, recipe, factId, vid){
  guard(model, recipe, factId);
  recipe.picks = { ...(recipe.picks ?? {}), [factId]: vid };
  parkOverride(model, recipe, factId);
}

// ---- skill sets: model.skillSets[name] = { [lang]: [{ id, items }] }, one per job type or tag ----
export const skillSets = model => model.skillSets ?? {};
const groupsOf = (model, name, lang) => skillSets(model)[name]?.[lang] ?? skillSets(model)[name]?.[DEFAULT_LANG] ?? null;
// This resume's own arrangement, or the skills section as it prints now; `from` names the set it matches by name.
export function arrangementOf(model, recipe){
  if (recipe.skillArrangement) return recipe.skillArrangement;
  const lang = recipe.lang ?? DEFAULT_LANG;
  const groups = (itemList(model, recipe, 'skills') ?? []).filter(g => g.on)
    .map(g => ({ id: g.id, items: String(chooseVariant(model, g.id, recipe).v?.text ?? '').split(/,\s*/).filter(Boolean) }));
  return { from: recipe.jobType && groupsOf(model, recipe.jobType, lang) ? recipe.jobType : null, groups };
}
export function setArrangement(recipe, arrangement){ recipe.skillArrangement = structuredClone(arrangement); }
// A set with no groups in the resume's language starts it from the English ones: `lang: 'en'` says so (they are listed as untranslated)
export function applySet(model, recipe, name){
  const L = recipe.lang ?? DEFAULT_LANG, groups = groupsOf(model, name, L);
  if (!groups) throw new Error(`no skill set ${name}`);
  guard(model, recipe, skillsSection(model));
  for (const g of arrangementOf(model, recipe).groups) guard(model, recipe, g.id);      // a set replaces every group
  recipe.skillArrangement = { from: name, ...(skillSets(model)[name][L] ? {} : { lang: DEFAULT_LANG }), groups: structuredClone(groups) };
}
// Back to the record's own groups (the inverse of applySet): the resume's arrangement goes. Held like applySet.
export function clearArrangement(model, recipe){
  if (!recipe.skillArrangement) return;
  guard(model, recipe, skillsSection(model));
  for (const g of arrangementOf(model, recipe).groups) guard(model, recipe, g.id);
  delete recipe.skillArrangement;
}
// The set saved for a tag in one language goes; the tag's last set takes its key with it (and the last key, `skillSets`).
export function deleteSkillSet(model, name, lang = DEFAULT_LANG){
  const mine = { ...skillSets(model)[name] };
  if (!mine[lang]) return false;
  delete mine[lang];
  const sets = { ...skillSets(model) };
  if (Object.keys(mine).length) sets[name] = mine; else delete sets[name];
  if (Object.keys(sets).length) model.skillSets = sets; else delete model.skillSets;
  return true;
}
export function saveSetForTag(model, name, arrangement, lang = DEFAULT_LANG){
  const L = arrangement.lang ?? lang;      // groups that are still the English fallback are the English set, not the resume's language's
  model.skillSets = { ...skillSets(model), [name]: { ...skillSets(model)[name], [L]: structuredClone(arrangement.groups) } };
}
export const groupLabel = (model, recipe, gid) => model.i18n?.[recipe.lang ?? DEFAULT_LANG]?.labels?.[gid] ?? (model.facts ?? []).find(f => f.id === gid)?.label ?? gid;

// Arranging the skills on this resume: the first change copies what prints now into `recipe.skillArrangement`, and each change after it
// is to that copy. A group is { id, items, label? }: a group of the record keeps its id (and its name, unless `label` renames it here);
// one made on the page is `~sg-n` and has a `label` of its own.
const arrange = (model, recipe, fn, ...ids) => { for (const id of [skillsSection(model), ...ids.filter(Boolean)]) guard(model, recipe, id); const a = structuredClone(arrangementOf(model, recipe)); const r = fn(a.groups, a); recipe.skillArrangement = a; return r; };
const groupAt = (groups, gid) => { const i = groups.findIndex(g => g.id === gid); if (i < 0) throw new Error(`no skill group ${gid}`); return i; };
// the skills as typed: separated by commas or line breaks
export const parseItems = text => String(text).split(/[,\n]/).map(x => x.trim()).filter(Boolean);
// What was written in a group: the first line is its name, the rest its skills; one line only is its skills. No skills left: the group goes.
export const readGroup = text => { const lines = String(text).split('\n'), named = lines.length > 1; return { name: named ? lines[0].trim() : null, items: parseItems(named ? lines.slice(1).join('\n') : text) }; };
export function writeGroup(model, recipe, gid, text){
  const { name, items } = readGroup(text);
  arrange(model, recipe, groups => {
    const i = groupAt(groups, gid);
    if (!items.length) groups.splice(i, 1);
    else {
      const was = groups[i].label, label = name !== null && name !== (was ?? groupLabel(model, recipe, gid)) ? name : was;
      groups[i] = { ...groups[i], items, lang: recipe.lang ?? DEFAULT_LANG, ...(label !== undefined ? { label } : {}) };      // typed here: in this language
    }
  }, gid);
}
// A group as the page writes it: its name, a line break, its skills
export function groupText(model, recipe, gid){
  const g = arrangementOf(model, recipe).groups.find(x => x.id === gid);
  return g ? `${g.label ?? groupLabel(model, recipe, gid)}\n${g.items.join(', ')}` : '';
}
// A new empty group after `afterId` (null: first); the page writes in it at once, and it goes if it is left empty.
export function addSkillGroup(model, recipe, afterId = null){
  return arrange(model, recipe, groups => {
    let n = 1; while (groups.some(g => g.id === `~sg-${n}`)) n++;
    const id = `~sg-${n}`, at = afterId == null ? 0 : groupAt(groups, afterId) + 1;
    groups.splice(at, 0, { id, items: [], label: '' });
    return id;
  });
}
export function moveSkillGroup(model, recipe, gid, beforeId = null){
  arrange(model, recipe, groups => {
    const [g] = groups.splice(groupAt(groups, gid), 1);
    groups.splice(beforeId == null ? groups.length : groupAt(groups, beforeId), 0, g);
  }, gid);
}
// One skill from a group to a place in another (or the same): `j` is its index there once it has left; a group left with no skills goes
export function moveSkill(model, recipe, from, i, to, j){
  arrange(model, recipe, groups => {
    const src = groups[groupAt(groups, from)], dst = groups[groupAt(groups, to)];
    if (i < 0 || i >= src.items.length) throw new Error(`no skill ${i} in ${from}`);
    const [item] = src.items.splice(i, 1);
    dst.items.splice(Math.max(0, Math.min(j, dst.items.length)), 0, item);
    if (!src.items.length && src !== dst) groups.splice(groups.indexOf(src), 1);
  }, from, to);
}

// The resume's photo switch (recipe.photo) and the record's photo (basics.image).
export function setPhoto(model, recipe, patch){ guard(model, recipe, 'photo'); recipe.photo = { show: false, shape: 'rect', ...(recipe.photo ?? {}), ...patch }; }
// `src` null removes the picture. `recipe`: the open resume; a locked header that shows the picture is not changed under it.
export function setRecordPhoto(model, src, recipe = null){
  if (recipe?.photo?.show) guard(model, recipe, 'photo');
  if (src) model.basics.image = src; else delete model.basics.image;
}

// Sections
// Fixed header and summary first, then printed sections in order, then the record's others, off.
export function sectionList(model, recipe){
  const ix = factIx(model);
  const omitted = id => entryOf(recipe, id)?.weight === 0 && hasBudgetIn(model, id);
  const fixed = (model.sections ?? []).filter(s => isFixed(model, s.id)).map(s => ({ id: s.id, on: true, fixed: true }));
  let printed;
  if (Array.isArray(recipe.pages)) printed = [...new Set(recipe.pages.flat().map(refId))];
  else printed = (recipe.sections ?? []).map(refId);
  const listed = [...new Set(printed)].filter(id => ix.sections.has(id) && !isFixed(model, id));
  // named but not placed by a hand layout: off, in their place
  const named = (recipe.sections ?? []).map(refId).filter(id => ix.sections.has(id) && !isFixed(model, id) && !listed.includes(id));
  const rest = (model.sections ?? []).map(s => s.id).filter(id => !isFixed(model, id) && !listed.includes(id) && !named.includes(id));
  return [
    ...fixed,
    ...listed.map(id => ({ id, on: !omitted(id), fixed: false })),
    ...[...named, ...rest].map(id => ({ id, on: false, fixed: false })),
  ];
}

// Hand layout to automatic pages. A slot's style becomes its section's; QR codes are lost.
export function toAuto(model, recipe){
  if (!Array.isArray(recipe.pages)) return false;
  if (recipe.locked?.length) throw new LockedError(null, 'ux6c.layoutLocked');      // the hand-made layout is part of what the lock holds
  const ix = factIx(model);
  const sids = entriesIds(model);
  const order = [...new Set(recipe.pages.flat().map(refId))].filter(id => ix.sections.has(id) && !isFixed(model, id));
  const old = new Map((recipe.sections ?? []).filter(x => x && typeof x === 'object').map(x => [x.id, x]));
  // one ref per job, highlights merged across slots
  const merged = new Map(sids.map(sid => [sid, new Map()]));
  for (const s of recipe.pages.flat()) if (typeof s === 'object' && merged.has(s.id)) for (const r of s.work ?? []){
    const w = ix.work.get(refId(r));
    if (!w) continue;
    const m = merged.get(s.id);
    const hs = new Set([...(m.get(w.id) ?? []), ...highlightsOfRef(w, r)]);
    m.set(w.id, w.highlights.filter(h => hs.has(h)));
  }
  const sections = order.map(id => {
    const e = structuredClone(old.get(id) ?? { id });
    const style = recipe.pages.flat().find(s => s?.id === id && s.style !== undefined)?.style;
    if (style !== undefined && e.style === undefined) e.style = style;      // '' too: a slot that was ungrouped stays so under a two-level style
    if (merged.has(id)) e.work = [...merged.get(id)].map(([id2, hs]) => tidyRef(ix.work.get(id2), { id: id2, highlights: hs }));
    return e;
  });
  for (const [id, e] of old) if (!order.includes(id) && ix.sections.has(id) && !isFixed(model, id)) sections.push({ ...structuredClone(e), weight: 0 });
  recipe.pageLimit = recipe.pages.length <= 2 ? recipe.pages.length : 0;
  delete recipe.pages;
  recipe.sections = sections;
  return true;
}

// Off is weight 0. Turning on a section a hand layout can't place switches to automatic pages.
export function setSectionOn(model, recipe, id, on){
  if (!hasBudgetIn(model, id)) throw keyed('error.alwaysOn', { id });
  if (on) guardUp(model, recipe, id); else guardOff(model, recipe, id);
  let auto = false;
  recipe.sections ??= [];
  let e = entryOf(recipe, id);
  const placed = Array.isArray(recipe.pages) ? recipe.pages.flat().some(s => refId(s) === id) : !!e;
  if (!on){
    if (!e){ if (!placed) return { auto }; e = { id }; recipe.sections.push(e); }
    e.weight = 0;
    return { auto };
  }
  if (!placed && Array.isArray(recipe.pages)){ auto = toAuto(model, recipe); e = entryOf(recipe, id); }
  if (!e){
    const lib = (model.sections ?? []).map(s => s.id);
    const at = recipe.sections.findIndex(x => lib.indexOf(refId(x)) > lib.indexOf(id));
    e = { id };
    recipe.sections.splice(at < 0 ? recipe.sections.length : at, 0, e);
  }
  if (e.weight === 0){
    if (factIx(model).sections.get(id)?.kind === 'entries') e.weight = 5; else delete e.weight;
  }
  return { auto };
}

// "Group under the section above": the section prints a quiet label under that tab, not a tab of its own, where a section
// with a tab sits above it on the same page (src/render.js). The section entry's `style: 'sub'`; a hand layout's slot style is read
// too, and cleared when the switch is set, so the switch has the last word. A locked section is held.
// A two-level section style groups the related topics by itself unless the section has a style of its own, '' being "not grouped".
const byStyle = (recipe, id) => RELATED.includes(id) && PRESETS[designOf(recipe, lookOf(recipe))?.preset]?.rank === 'two';
export function groupedOf(recipe, id){
  const own = [entryOf(recipe, id)?.style, ...(recipe.pages ?? []).flat().filter(s => s?.id === id).map(s => s.style)].filter(s => s !== undefined);
  return own.length ? own.includes('sub') : byStyle(recipe, id);
}
export function setSectionGrouped(model, recipe, id, on){
  if (!hasBudgetIn(model, id)) throw keyed('error.alwaysOn', { id });
  guard(model, recipe, id);
  for (const s of (recipe.pages ?? []).flat()) if (s?.id === id) delete s.style;
  let e = entryOf(recipe, id);
  // in automatic pages a section with no entry is off: this must not turn it on
  const ungroup = byStyle(recipe, id) ? '' : undefined;      // the style would group it again: the entry has to say "not grouped"
  if (!e){ if ((!on && ungroup === undefined) || !Array.isArray(recipe.pages)) return; e = { id }; (recipe.sections ??= []).push(e); }
  if (on) e.style = 'sub'; else if (ungroup === undefined) delete e.style; else e.style = ungroup;
}

// beforeId null means last. A hand layout switches to automatic pages.
export function moveSection(model, recipe, id, beforeId = null){
  if (isFixed(model, id)) throw keyed('error.fixedTop');
  guard(model, recipe, id);
  const auto = toAuto(model, recipe);
  recipe.sections ??= [];
  // everything the list shows becomes explicit, so the order is the list's
  const shown = sectionList(model, recipe).filter(s => !s.fixed);
  for (const s of shown) if (!entryOf(recipe, s.id)) recipe.sections.push(s.on ? { id: s.id } : { id: s.id, weight: 0 });
  const from = recipe.sections.findIndex(x => refId(x) === id);
  const [e] = recipe.sections.splice(from, 1);
  const to = beforeId == null ? recipe.sections.length : recipe.sections.findIndex(x => refId(x) === beforeId);
  recipe.sections.splice(to < 0 ? recipe.sections.length : to, 0, e);
  return { auto };
}

export function stepSection(model, recipe, id, dir){
  const ids = sectionList(model, recipe).filter(s => !s.fixed).map(s => s.id);
  const i = ids.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return { auto: false, moved: false };
  return { ...moveSection(model, recipe, id, dir < 0 ? ids[j] : ids[j + 1] ?? null), moved: true };
}

// The items of a list section (skill groups, language pairs, run lines), in the record's order. null for any
// other kind: an entries section has bullets, the rest print as one item and are switched as a section.
const LIST_KEY = { grid: 'groups', pairs: 'pairs', runs: 'items' };
export function itemsOf(model, sid){
  const sec = factIx(model).sections.get(sid);
  const key = sec && LIST_KEY[sec.kind];
  return key ? (sec.content[key] ?? []).filter(x => typeof x === 'string') : null;
}
// …in this resume's order, with the ones it leaves out marked
export function itemList(model, recipe, sid){
  const all = itemsOf(model, sid);
  if (!all) return null;
  const order = entryOf(recipe, sid)?.order;
  const ids = Array.isArray(order) && order.length ? [...order.filter(x => all.includes(x)), ...all.filter(x => !order.includes(x))] : all;
  const off = new Set(offOf(recipe));
  return ids.map(id => ({ id, on: !off.has(id) }));
}
export const sectionOfItem = (model, id) => (model.sections ?? []).find(s => (itemsOf(model, s.id) ?? []).includes(id))?.id ?? null;

// Switch one item of a list section. The last one off takes the section off, and one turned on brings it back,
// so a printed section is never an empty tab.
// The order a job's bullets print in on this resume. beforeId null puts it last. A bullet that is off has no place.
export function moveBullet(model, recipe, factId, beforeId = null){
  const w = jobOfFact(model, factId, recipe);
  if (!w) throw new Error(`${factId} is not a bullet of any job`);
  guard(model, recipe, factId);
  const sid = sectionOfEntry(model, w.id);
  const rest = fullOrder(model, recipe, w.id).filter(h => h !== factId);
  const at = beforeId == null ? rest.length : rest.indexOf(beforeId);
  const order = [...rest.slice(0, at < 0 ? rest.length : at), factId, ...rest.slice(at < 0 ? rest.length : at)];
  let done = false;
  if (isLocal(recipe, factId)) done = listedBullets(model, recipe, w.id).includes(factId);
  else {
    // the stored list holds the record's bullets only: the one that follows it
    const next = order.slice(order.indexOf(factId) + 1).find(h => !isLocal(recipe, h)) ?? null;
    for (const l of workLists(model, recipe, true, sid)) l.forEach((r, i) => {
      if (done || refId(r) !== w.id) return;
      const hs = highlightsOfRef(w, r);
      if (!hs.includes(factId)) return;
      const rest = hs.filter(h => h !== factId);
      const at = next == null ? rest.length : rest.indexOf(next);
      rest.splice(at < 0 ? rest.length : at, 0, factId);
      l[i] = tidyRef(w, { ...(typeof r === 'object' ? r : {}), id: w.id, highlights: rest });
      done = true;
    });
  }
  if (!done) throw keyed('ux2.errBulletOff');
  if (localOf(recipe, w.id).length) reanchor(recipe, w.id, order);
  keepLineOrder(model, recipe, w.id, lineOrder(model, recipe, w.id));      // an off line stays after the line it followed
}
export function stepBullet(model, recipe, factId, dir){
  const w = jobOfFact(model, factId, recipe);
  const ids = w ? listedBullets(model, recipe, w.id) : [];
  const i = ids.indexOf(factId), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return false;
  moveBullet(model, recipe, factId, dir < 0 ? ids[j] : ids[j + 1] ?? null);
  return true;
}

// The order the jobs of a section print in on this resume: the section's `order`, dropped when it is the record's. beforeId null puts
// the job last. A job that is off or archived has no place. A hand layout switches to automatic pages, as moving a section does.
export function moveEntry(model, recipe, id, beforeId = null){
  if (entryKey(model, id) !== 'work') throw new Error(`${id} is not a job`);
  guard(model, recipe, id);
  const sid = sectionOfEntry(model, id);
  if (archivedEntryIds(model).has(id) || !jobRefs(model, recipe, sid).some(r => refId(r) === id)) throw new Error(`${id} is not on this resume`);
  const auto = toAuto(model, recipe);
  const e = entryOf(recipe, sid);
  const hidden = archivedEntryIds(model);
  const ids = jobOrder(model, recipe, sid).filter(x => x !== id && !hidden.has(x));      // the off jobs keep their places in the order
  const on = new Set(jobRefs(model, recipe, sid).map(refId)), lastOn = ids.findLastIndex(x => on.has(x));
  const at = beforeId == null ? lastOn + 1 : ids.indexOf(beforeId);      // last: after the last job that prints, the off ones after it stay
  ids.splice(at < 0 ? ids.length : at, 0, id);
  // the jobs that print in the order the key would leave them in anyway drop it (the off ones then stand in the record's places again). That is the record's
  // order when the section's own list is in it; a list kept in another order (a resume made by hand or by a script) needs the key to get back to the record's
  const printing = ids.filter(x => x === id || on.has(x)), listed = e.work?.map(refId) ?? factIx(model).sections.get(sid)?.content?.work ?? [], natural = listed.filter(x => printing.includes(x));
  if (printing.length === natural.length && printing.every((x, i) => x === natural[i])) delete e.order; else e.order = ids;
  return { auto };
}
export function stepEntry(model, recipe, id, dir){
  const sid = sectionOfEntry(model, id);
  const hidden = archivedEntryIds(model);
  const ids = jobRefs(model, recipe, sid).map(refId).filter(x => !hidden.has(x) && entryKey(model, x) === 'work');
  const i = ids.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return { auto: false, moved: false };
  return { ...moveEntry(model, recipe, id, dir < 0 ? ids[j] : ids[j + 1] ?? null), moved: true };
}

export function setItemOn(model, recipe, id, on){
  const sid = sectionOfItem(model, id);
  if (!sid) throw new Error(`${id} is not an item of any list section`);
  if (on) guardUp(model, recipe, id); else guardOff(model, recipe, id);
  const secOn = sectionList(model, recipe).find(x => x.id === sid)?.on;
  // the rows of a section that is off show unticked, so ticking one brings back that one alone (a locked row is left as it is)
  if (on && !secOn) for (const x of itemsOf(model, sid)) if (x !== id && !isLocked(model, recipe, x)) setList(recipe, 'off', x, true);
  if (!on && secOn && itemList(model, recipe, sid).every(x => x.id === id || !x.on)) guardOff(model, recipe, sid);      // before anything is written
  setList(recipe, 'off', id, !on);
  const list = itemList(model, recipe, sid);
  if (!on && list.every(x => !x.on) && secOn) setSectionOn(model, recipe, sid, false);
  if (on && !secOn) setSectionOn(model, recipe, sid, true);
  return { section: sid };
}

// Put an item before another of its section (null: last), in this resume only.
export function moveItem(model, recipe, sid, id, beforeId = null){
  const list = itemList(model, recipe, sid);
  if (!list || !list.some(x => x.id === id)) throw new Error(`${id} is not an item of ${sid}`);
  guard(model, recipe, id);
  const ids = list.map(x => x.id).filter(x => x !== id);
  const at = beforeId == null ? ids.length : ids.indexOf(beforeId);
  ids.splice(at < 0 ? ids.length : at, 0, id);
  recipe.sections ??= [];
  let e = entryOf(recipe, sid);
  if (!e){
    // an entry for a section that is off would turn it on
    if (!Array.isArray(recipe.pages) && !sectionList(model, recipe).find(x => x.id === sid)?.on) throw keyed('ux2.errItemSectionOff');
    e = { id: sid }; recipe.sections.push(e);
  }
  const natural = itemsOf(model, sid);
  if (ids.every((x, i) => x === natural[i])) delete e.order; else e.order = ids;
}
export function stepItem(model, recipe, sid, id, dir){
  const ids = itemList(model, recipe, sid)?.map(x => x.id) ?? [];
  const i = ids.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return false;
  moveItem(model, recipe, sid, id, dir < 0 ? ids[j] : ids[j + 1] ?? null);
  return true;
}

// A heading on this resume, per language. null or '' resets it.
export function setSectionLabel(model, recipe, id, lang, text){
  if (isFixed(model, id) && factIx(model).sections.get(id)?.kind === 'header') throw keyed('error.headerNoHeading');
  guard(model, recipe, `~h:${id}`);
  recipe.sections ??= [];
  let e = entryOf(recipe, id);
  const t = String(text ?? '').trim();
  if (!e){ if (!t) return; e = { id }; recipe.sections.push(e); }
  const label = typeof e.label === 'string' ? { [DEFAULT_LANG]: e.label } : { ...(e.label ?? {}) };
  if (t) label[lang] = t; else delete label[lang];
  if (Object.keys(label).length) e.label = label; else delete e.label;
}
export function labelOf(model, recipe, id, lang){
  const own = entryOf(recipe, id)?.label;
  return (typeof own === 'string' ? own : own?.[lang]) ?? null;
}
// The name of a language row on this resume, per language. '' resets it to the record's.
export function setTerm(model, recipe, fid, lang, text){
  guard(model, recipe, `~t:${fid}`);
  const t = String(text ?? '').replace(/\s+/g, ' ').trim(), mine = { ...recipe.terms?.[fid] };
  if (t) mine[lang] = t; else delete mine[lang];
  const terms = { ...recipe.terms, [fid]: mine };
  if (!Object.keys(mine).length) delete terms[fid];
  if (Object.keys(terms).length) recipe.terms = terms; else delete recipe.terms;
}
// …as the record has it (the resume's own is not looked at)
export const recordTerm = (model, fid, lang) =>
  model.i18n?.[lang]?.terms?.[fid] ?? (model.facts ?? []).find(f => f.id === fid)?.term ?? fid;

// A heading or a language's name, by the page's key (`~h:<section>`, `~t:<fact>`), written on this resume in `lang`; the record's own
// words reset it. `labelNow` is what the resume prints.
export function setLabel(model, recipe, key, lang, text){
  const id = key.slice(3), heading = key.startsWith('~h:'), t = String(text ?? '').replace(/\s+/g, ' ').trim();
  const reset = !t || t === (heading ? recordTitle(model, id, lang) : recordTerm(model, id, lang));
  if (heading) setSectionLabel(model, recipe, id, lang, reset ? null : t); else setTerm(model, recipe, id, lang, reset ? '' : t);
}
export const labelNow = (model, recipe, key, lang) => {
  const id = key.slice(3);
  return key.startsWith('~h:') ? labelOf(model, recipe, id, lang) ?? recordTitle(model, id, lang) : termOf(recipe, id) ?? recordTerm(model, id, lang);
};

// ignores this resume's own label
export const recordTitle = (model, id, lang) =>
  (lang !== DEFAULT_LANG ? model.i18n?.[lang]?.sections?.[id] : undefined) ?? factIx(model).sections.get(id)?.title ?? id;

// Moves this resume's label into the record (title or translation) and drops it here.
export function useLabelEverywhere(model, recipe, id, lang){
  const t = labelOf(model, recipe, id, lang);
  if (!t || isLocked(model, recipe, `~h:${id}`)) return false;      // a locked heading stays as typed
  const s = (model.sections ?? []).find(x => x.id === id);
  if (!s) return false;
  if (lang === DEFAULT_LANG) s.title = t;
  else { model.i18n ??= {}; model.i18n[lang] ??= {}; model.i18n[lang].sections ??= {}; model.i18n[lang].sections[id] = t; }
  setSectionLabel(model, recipe, id, lang, null);
  return true;
}

// Facts a section would print with no version in `lang`. The app prints them in English (render's
// `fallback`); scripts/render.mjs refuses them.
export function sectionMissing(model, id, lang = DEFAULT_LANG){
  const s = (model.sections ?? []).find(x => x.id === id);
  if (!s || lang === DEFAULT_LANG) return [];
  const c = s.content ?? {};
  const ids = s.kind === 'entries'
    ? (c.work ?? []).flatMap(wid => { const w = entriesOf(model).find(x => x.id === wid); return w ? [w.display?.position, w.display?.meta, ...(w.highlights ?? [])] : []; })
    : s.kind === 'header' ? [] : Object.values(c).flat().filter(x => typeof x === 'string');
  const facts = new Map((model.facts ?? []).map(f => [f.id, f]));
  const vs = new Map((model.variants ?? []).map(v => [v.id, v]));
  return ids.filter(fid => facts.has(fid) && !facts.get(fid).variants.some(v => langOf(vs.get(v)) === lang));
}
