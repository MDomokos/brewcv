// Saved resumes. Pure: changes the store state draft in place. `frozen[id]` is the body as last saved;
// record edits never change it: on open, differing bullets are held at it and offered as newer wording.

import { t, keyed } from '../i18n/index.js';
import { resolve, printedFacts, frozenDiffs, newResume, chooseVariant } from './resume.js';
import { resumeFileName } from './schema.js';
import { applyTag, jobTypesOf, jobTypeById, jobTypeLabel, tagsOf } from './focus.js';

const clone = x => structuredClone(x);
export const today = () => new Date().toISOString().slice(0, 10);
export const resumeLabel = r => (!r ? t('resumes.noResume') : r.company && r.role ? `${r.company} — ${r.role}` : r.company || r.title || r.application || t('resumes.untitled'));

// unique case-insensitively
export function uniqueId(resumes, recipe, except = null){
  const taken = new Set((resumes ?? []).filter(r => r.id !== except).map(r => String(r.id).toLowerCase()));
  const base = resumeFileName(recipe);
  let id = base, n = 2;
  while (taken.has(id.toLowerCase())) id = base.replace(/\.json$/, ` ${n++}.json`);
  return id;
}

export const savedOf = (state, id = state.openId) => (state.resumes ?? []).find(r => r.id === id) ?? null;

export function isDirty(state){
  if (!state.cur) return false;
  const saved = savedOf(state);
  if (!saved) return true;
  return JSON.stringify(state.cur) !== JSON.stringify(saved);
}

// One-off texts excluded.
export function usedVersions(model, recipe){
  const p = printedFacts(model, recipe);
  const out = [];
  const add = slot => {
    if (!slot || recipe.overrides?.[slot.fact] !== undefined) return;
    const v = chooseVariant(model, slot.fact, recipe).v;
    if (v) out.push({ fact: slot.fact, variant: v.id });
  };
  add(p.summary);
  for (const w of p.work){ for (const h of w.highlights) add(h); }
  return out;
}

// Only a job type that is a single tag (the old form) teaches the record: a bundle's tags are yours to set.
export function tagVersions(model, recipe, T){
  let n = 0;
  if (jobTypeById(model, T) && jobTypeById(model, T).tags.length !== 1) return 0;
  T = tagsOf(model, T)[0];
  for (const { variant } of usedVersions(model, recipe)){
    const v = model.variants.find(x => x.id === variant);
    if (v && !(v.tags ?? []).includes(T)){ v.tags = [...(v.tags ?? []), T]; n++; }
  }
  return n;
}

// Tagging versions with the job type lets the record learn which wording suits which job.
export function saveNew(state, { company, role = '', jobType = '', tags = [], tagVersions: tagThem = true, date = today() } = {}){
  if (!String(company ?? '').trim()) throw keyed('error.needCompany');
  const r = clone(state.cur);
  r.company = String(company).trim();
  r.role = String(role).trim();
  r.jobType = String(jobType).trim();
  r.tags = [...new Set((tags ?? []).map(t => String(t).trim()).filter(Boolean))];
  r.application = r.role ? `${r.company} - ${r.role}` : r.company;
  r.title = r.role ? `${r.company} — ${r.role}` : r.company;
  r.savedAt = date;
  r.date = date;
  delete r.id;
  r.id = uniqueId(state.resumes, r);
  let tagged = 0;
  // what was typed may be a job type's label
  const known = jobTypesOf(state.record).find(j => j.id === r.jobType) ?? jobTypesOf(state.record).find(j => j.label.toLowerCase() === r.jobType.toLowerCase());
  if (known) r.jobType = known.id;
  if (r.jobType){
    state.record.jobTypes ??= [];
    if (!known) state.record.jobTypes.push(r.jobType);
    if (tagThem) tagged = tagVersions(state.record, r, r.jobType);
  }
  delete r.held;
  state.resumes = [...(state.resumes ?? []), r];
  state.cur = clone(r);
  state.openId = r.id;
  state.frozen = { ...(state.frozen ?? {}), [r.id]: resolve(state.record, r).body };
  return { id: r.id, tagged };
}

export function saveOpen(state, { date = today() } = {}){
  const i = (state.resumes ?? []).findIndex(r => r.id === state.openId);
  if (i < 0) throw new Error('this resume has not been saved yet');
  const r = clone(state.cur);
  r.id = state.openId;
  r.savedAt = date;
  delete r.held;
  state.resumes[i] = r;
  state.cur = clone(r);
  state.frozen = { ...(state.frozen ?? {}), [r.id]: resolve(state.record, r).body };
  return { id: r.id };
}

// A held bullet is a one-off override listed in `held`.
export function holdFrozen(model, recipe, frozen){
  const free = clone(recipe);
  for (const id of free.held ?? []) delete free.overrides?.[id];
  const diffs = frozenDiffs(model, free, frozen);
  const held = new Set(recipe.held ?? []);
  for (const d of diffs){
    if (recipe.overrides?.[d.fact] !== undefined && !held.has(d.fact)) continue;    // the user's own one-off wins
    recipe.overrides = { ...(recipe.overrides ?? {}), [d.fact]: d.frozen };
    held.add(d.fact);
  }
  if (held.size) recipe.held = [...held]; else delete recipe.held;
  return diffs;
}

export function newerOf(model, recipe){
  const out = [];
  for (const id of recipe.held ?? []){
    const text = recipe.overrides?.[id];
    const free = clone(recipe);
    delete free.overrides[id];
    const live = chooseVariant(model, id, free).v?.text ?? null;
    if (text !== undefined && live !== null && live !== text) out.push({ fact: id, frozen: text, live });
  }
  return out;
}
// keepOlder leaves the saved text as this resume's own one-off.
export function acceptNewer(recipe, factId){
  if (recipe.overrides) delete recipe.overrides[factId];
  recipe.held = (recipe.held ?? []).filter(x => x !== factId);
  if (!recipe.held.length) delete recipe.held;
}
export function keepOlder(recipe, factId){
  recipe.held = (recipe.held ?? []).filter(x => x !== factId);
  if (!recipe.held.length) delete recipe.held;
}

// The saved copy takes the same holds, so opening doesn't count as a change.
export function openSaved(state, id){
  const i = (state.resumes ?? []).findIndex(r => r.id === id);
  if (i < 0) throw new Error(`no saved resume ${id}`);
  const r = clone(state.resumes[i]);
  const diffs = holdFrozen(state.record, r, state.frozen?.[id] ?? null);
  state.resumes[i] = clone(r);
  state.cur = r;
  state.openId = id;
  return { held: newerOf(state.record, r), diffs };
}

export function reuse(state, id){
  const src = savedOf(state, id);
  if (!src) throw new Error(`no saved resume ${id}`);
  const r = clone(src);
  for (const k of ['id', 'savedAt', 'date', 'held']) delete r[k];
  r.company = ''; r.role = '';
  r.application = t('resumes.copyOf', { name: resumeLabel(src) });
  r.title = r.application;
  state.cur = r;
  state.openId = null;
  return r;
}

// mode: 'all', 'latest' (newest saved of jobType) or 'tagged' (bullets tagged jobType).
export function newFrom(state, { mode = 'all', jobType = '', format, lang } = {}){
  const f = format ?? state.cur?.format ?? 'a4';
  const L = lang ?? state.cur?.lang ?? 'en';
  if (mode === 'latest'){
    const latest = byNewest(state.resumes ?? []).find(r => r.jobType === jobType);
    if (!latest) throw new Error(`no saved resume of type ${jobType}`);
    const r = reuse(state, latest.id);
    r.jobType = jobType;
    return r;
  }
  const r = newResume(state.record, { format: f, lang: L, pageLimit: state.cur?.pageLimit ?? 1 });
  r.jobType = mode === 'tagged' ? jobType : '';
  if (mode === 'tagged') applyTag(state.record, r, jobType);
  state.cur = r;
  state.openId = null;
  return r;
}

export function deleteSaved(state, id){
  state.resumes = (state.resumes ?? []).filter(r => r.id !== id);
  if (state.frozen) delete state.frozen[id];
  if (state.openId === id) state.openId = null;
}

export const byNewest = list => [...list].sort((a, b) => String(b.savedAt ?? '').localeCompare(String(a.savedAt ?? '')) || resumeLabel(a).localeCompare(resumeLabel(b)));

// The record's job types in order, then others, then no job type last.
export function grouped(model, resumes){
  const types = [...new Set([...jobTypesOf(model).map(j => j.id), ...resumes.map(r => r.jobType).filter(Boolean)])];
  const out = types.map(type => ({ type, label: jobTypeLabel(model, type), resumes: byNewest(resumes.filter(r => r.jobType === type)) })).filter(g => g.resumes.length);
  const none = resumes.filter(r => !r.jobType);
  if (none.length) out.push({ type: '', resumes: byNewest(none) });
  return out;
}

export function compareRows(model, a, b){
  const ix = new Map((model.variants ?? []).map(v => [v.id, v]));
  const facts = new Map((model.facts ?? []).map(f => [f.id, f]));
  const pages = r => (r.pageLimit === 0 ? t('cmp.anyPages') : r.pageLimit ? String(r.pageLimit) : Array.isArray(r.pages) ? t('cmp.byHand', { n: r.pages.length }) : '—');
  const nSections = r => (r.sections ?? []).filter(s => s && s.weight !== 0).length;
  const settings = [
    [t('resumes.jobType'), r => (r.jobType ? jobTypeLabel(model, r.jobType) : '—')],
    [t('cmp.language'), r => (r.lang ?? 'en').toUpperCase()],
    [t('design.paper'), r => (r.format === 'us-letter' ? t('paper.letter') : t('paper.a4'))],
    [t('design.pages'), pages],
    [t('design.photo'), r => (r.photo?.show ? r.photo.shape ?? t('cmp.on') : t('cmp.off'))],
    [t('cmp.sections'), r => String(nSections(r))],
  ].map(([label, fn]) => { const x = fn(a), y = fn(b); return { kind: 'setting', label, a: x, b: y, differs: x !== y }; });
  const cell = (r, factId) => {
    if (r.overrides?.[factId] !== undefined) return { label: (r.held ?? []).includes(factId) ? t('cmp.savedText') : t('edit.onlyHere'), text: String(r.overrides[factId]) };
    const v = chooseVariant(model, factId, r).v;
    return v ? { label: `v${v.n}`, text: v.text, variant: v.id } : { label: '—', text: '' };
  };
  const printed = r => { const p = printedFacts(model, r); return [p.summary?.fact, ...p.work.flatMap(w => w.highlights.map(h => h.fact))].filter(Boolean); };
  const pa = printed(a), pb = new Set(printed(b));
  const order = [...new Set([...pa, ...printed(b)])];
  const claims = order.map(f => {
    const x = pa.includes(f) ? cell(a, f) : { label: '—', text: '' };
    const y = pb.has(f) ? cell(b, f) : { label: '—', text: '' };
    return { kind: 'claim', fact: f, label: facts.get(f)?.summary ?? f, a: x, b: y, differs: x.label !== y.label || x.text !== y.text };
  });
  return [...settings, ...claims];
}

