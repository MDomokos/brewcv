// The Review list's model: what the edits on a resume can become, each change as one call. Pure: it changes the draft it is given.
// Every call checks the lock and the source first and writes after, so a refusal leaves the edit as it was.

import { DEFAULT_LANG, RecordError, addVersion, saveOver, suggestNumber, versionsIn, major } from './record.js';
import { addEntryClaim, updateLanguage } from './career.js';
import { guard, isLocked } from './lock.js';
import { localJob } from '../recipe.js';
import { pendingEdits, reviewableEdits, overrideOf, dropOverride, pickVersion, keepHere, removeLocalLine, setBulletOn, moveBullet, listedBullets, isLocal, localOf, termOf, labelOf, setSectionLabel, setTerm, labelNow } from './resume.js';
import { newerOf, usedVersions } from './resumes.js';

export const SOURCE_MAX = 300;
export const cleanSource = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, SOURCE_MAX);
export const needsSource = model => model.requireSource !== false;
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const langOf = recipe => recipe.lang ?? DEFAULT_LANG;

// A heading or a language's name typed on this resume, not yet kept or sent to the record: [{ key: '~h:id' | '~t:id', text }].
const labelsHere = (model, recipe) => {
  const lang = langOf(recipe), out = [];
  for (const s of recipe.sections ?? []) if (isObj(s)){ const text = labelOf(model, recipe, s.id, lang); if (text) out.push({ key: `~h:${s.id}`, text }); }
  for (const id of Object.keys(isObj(recipe.terms) ? recipe.terms : {})){ const text = termOf(recipe, id); if (text) out.push({ key: `~t:${id}`, text }); }
  return out;
};
const keptText = (recipe, key) => (isObj(recipe.keptLabels) && isObj(recipe.keptLabels[key]) ? recipe.keptLabels[key][langOf(recipe)] : undefined);

// What there is to review: `edits` (ids; a line only on this resume is one), `labels` ([{ key, text }]), `newer` (newerOf's rows), and how many
// held lines were left out because they are locked. A held line is the saved wording of a resume, not an edit.
export function reviewList(model, recipe){
  const free = new Set(reviewableEdits(model, recipe)), held = new Set(recipe.held ?? []);
  const row = id => isLocal(recipe, id) || (model.facts ?? []).some(f => f.id === id);
  const edits = pendingEdits(recipe).filter(id => free.has(id) && !held.has(id) && row(id) && String(recipe.overrides[id]).trim());
  const mine = labelsHere(model, recipe).filter(l => keptText(recipe, l.key) !== l.text);
  const labels = mine.filter(l => !isLocked(model, recipe, l.key));
  const locked = pendingEdits(recipe).filter(id => !free.has(id) && !held.has(id)).length + mine.length - labels.length;
  return { edits, labels, newer: newerOf(model, recipe), locked };
}
export const reviewCount = (model, recipe) => { const r = reviewList(model, recipe); return r.edits.length + r.labels.length + r.newer.length; };

// The edit of `id` and what to suggest for it.
export function editRow(model, recipe, id){
  const o = overrideOf(recipe, id), local = isLocal(recipe, id);
  const lang = local ? localOf(recipe, localJob(recipe, id)).find(l => l.id === id)?.lang ?? DEFAULT_LANG : langOf(recipe);
  const row = { id, local, text: o.text, marks: o.marks ?? [], lang };
  if (local) return { ...row, job: localJob(recipe, id) };
  const s = suggestNumber(model, id, o.text, lang);
  return { ...row, ...s, versions: versionsIn(model, id, lang) };
}

// The saved resumes (not the open one) that print version `vid`: an update of it is offered to them as newer wording.
export const printersOf = (state, vid) => (state.resumes ?? []).filter(r => r.id !== state.openId && usedVersions(state.record, r).some(u => u.variant === vid));

const edit = (recipe, id) => { const o = overrideOf(recipe, id); if (!o?.on) throw new RecordError('there is no edit to review'); return o; };

// choice: { do: 'minor', from } | { do: 'major', from?, source } | { do: 'over', vid } | { do: 'keep' } | { do: 'claim', source }
// Returns what was made: { vid, n } for a version, { fact } for a claim.
export function applyEdit(model, recipe, id, choice){
  const o = edit(recipe, id);
  if (choice.do === 'keep'){ keepHere(recipe, id); return {}; }
  guard(model, recipe, id);
  const source = cleanSource(choice.source) || null;
  if (choice.do === 'claim'){
    const job = localJob(recipe, id);
    if (!job) throw new RecordError('only a line on this resume only can become a claim');
    if (!source && needsSource(model)) throw new RecordError('a new claim needs a source');
    const lang = localOf(recipe, job).find(l => l.id === id)?.lang ?? DEFAULT_LANG;
    const ids = listedBullets(model, recipe, job), at = ids.indexOf(id);
    const fact = addEntryClaim(model, job, o.text, lang, source);
    if (!fact) throw new RecordError('a line needs some text');
    for (const v of versionsIn(model, fact, lang)) if (v.text === String(o.text).trim()) v.marks = structuredClone(o.marks ?? []);
    removeLocalLine(model, recipe, id);
    setBulletOn(model, recipe, fact, true);
    if (at >= 0) moveBullet(model, recipe, fact, ids[at + 1] ?? null);
    return { fact };
  }
  const lang = langOf(recipe), vs = versionsIn(model, id, lang), pick = vid => vs.find(v => v.id === vid) ?? null;
  let v;
  if (choice.do === 'over'){
    v = pick(choice.vid);
    if (!v) throw new RecordError(`${choice.vid} is not a version of ${id}`);
    saveOver(model, v.id, o.text, recipe);
    v.marks = structuredClone(o.marks ?? []);
  } else {
    const from = pick(choice.from ?? suggestNumber(model, id, o.text, lang).near?.id);
    if (choice.do === 'minor' && !from) throw new RecordError('a sub-version needs a version of this language to follow');
    if (needsSource(model) && !source && !(choice.do === 'minor' && from?.source)) throw new RecordError('a new version needs a source');
    v = addVersion(model, id, { text: o.text, lang, from: from?.id ?? null, as: choice.do === 'minor' ? 'minor' : 'major', marks: structuredClone(o.marks ?? []), source: choice.do === 'minor' && from?.source ? null : source });
  }
  dropOverride(model, recipe, id);
  pickVersion(model, recipe, id, v.id);
  return { vid: v.id, n: v.n };
}

// The sub-versions on offer: one per major that has a version in `lang`.
export const majorsOf = (model, id, lang) => [...new Set(versionsIn(model, id, lang).map(v => major(v.n)))]
  .map(m => versionsIn(model, id, lang).find(v => major(v.n) === m && v.n === m) ?? versionsIn(model, id, lang).find(v => major(v.n) === m));

// ---- headings and language names ----
export function keepLabel(model, recipe, key){
  recipe.keptLabels = { ...(isObj(recipe.keptLabels) ? recipe.keptLabels : {}), [key]: { ...(isObj(recipe.keptLabels?.[key]) ? recipe.keptLabels[key] : {}), [langOf(recipe)]: labelNow(model, recipe, key, langOf(recipe)) } };
}
// Moves the heading or the name into the record and drops it here.
export function useEverywhere(model, recipe, key){
  const id = key.slice(3), lang = langOf(recipe), text = key.startsWith('~t:') ? termOf(recipe, id) : labelOf(model, recipe, id, lang);
  if (!text) return false;
  guard(model, recipe, key);
  if (key.startsWith('~h:')){
    const s = (model.sections ?? []).find(x => x.id === id);
    if (!s) return false;
    if (lang === DEFAULT_LANG) s.title = text;
    else { model.i18n ??= {}; model.i18n[lang] ??= {}; model.i18n[lang].sections ??= {}; model.i18n[lang].sections[id] = text; }
    setSectionLabel(model, recipe, id, lang, null);
  } else {
    if (!(model.languages ?? []).some(x => x.id === id)) return false;
    updateLanguage(model, id, { language: text }, lang);
    setTerm(model, recipe, id, lang, '');
  }
  return true;
}
