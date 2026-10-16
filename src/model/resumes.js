// Saved resumes. Pure: changes the store state draft in place.
//
// How saving works. Everything autosaves; there is no unsaved draft.
//  - `resumes` holds every saved resume (a recipe plus its `id`, which is its file name).
//  - `cur` is the open resume's working copy and `openId` says which saved resume it is. After every commit
//    settle() (the store runs it inside the commit, so it is one undo step) writes `cur` into `resumes`, so the
//    two are equal and `snapshots` are the only thing the saved copy has that `cur` has not.
//  - A `cur` with no `openId` (a fresh start, an import) is saved at once under a default name.
//  - `frozen[id]` is the body the saved resume prints. settle() refreshes it for the open resume only: editing a
//    version never rewrites another resume's frozen text. On open, bullets whose live text differs from the
//    frozen one are held at it (`held`) and offered as newer wording.
//  - A snapshot is the open resume as it printed when Save was pressed, plus the sends (where and when it went).

import { t, keyed } from '../i18n/index.js';
import { resolve, printedFacts, frozenDiffs, newResume, chooseVariant, isLocal, jobRefs, arrangementOf, groupLabel } from './resume.js';
import { resumeFileName, nameKey } from './schema.js';
import { switchLang } from './lang.js';
import { LockedError, guard, isLocked } from './lock.js';
import { applyTag, jobTypesOf, jobTypeById, jobTypeLabel, tagsOf } from './focus.js';

const clone = x => structuredClone(x);
export const today = () => new Date().toISOString().slice(0, 10);
export const resumeLabel = r => (!r ? t('resumes.noResume') : r.name || (r.company && r.role ? `${r.company} — ${r.role}` : r.company || r.title || r.application || t('resumes.untitled')));
// "<Company or sector> - <Role>"; the job type's label stands in for a missing company
export const nameFrom = ({ company = '', role = '', jobLabel = '' } = {}) => [String(company).trim() || String(jobLabel).trim(), String(role).trim()].filter(Boolean).join(' - ');

// unique case-insensitively
export function uniqueId(resumes, recipe, except = null){
  const taken = new Set((resumes ?? []).filter(r => r.id !== except).map(r => nameKey(r.id)));
  const base = resumeFileName(recipe);
  let id = base, n = 2;
  while (taken.has(nameKey(id))) id = base.replace(/\.json$/, ` ${n++}.json`);
  return id;
}

export const savedOf = (state, id = state.openId) => (state.resumes ?? []).find(r => r.id === id) ?? null;

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

// Key order and bookkeeping don't change what a resume prints.
const canon = x => (Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x);
const NOT_PRINTED = ['id', 'savedAt', 'date', 'application', 'title', 'name', 'company', 'role', 'forKind', 'jobType', 'tags', 'snapshots', 'held', 'byLang', 'parent', 'parked', 'locked'];
export const printedKey = (recipe, body) => {
  const r = clone(recipe);
  for (const k of NOT_PRINTED) delete r[k];
  return JSON.stringify(canon([r, body]));
};
const bodyOf = (state, recipe, fallback = null) => { try { return resolve(state.record, recipe).body; } catch { return fallback; } };

const kindOf = (r, forKind) => {
  const k = forKind ?? r.forKind;
  if (r.company || r.role || k === 'outreach') r.forKind = k === 'outreach' ? 'outreach' : 'company'; else delete r.forKind;
};

// Saves state.cur as a new resume and opens it. Nothing is required: the name falls back to the For fields, then
// the job type, then what the resume was called. Tagging versions with the job type lets the record learn which
// wording suits which job.
export function saveNew(state, { name, company, role, forKind, jobType, tags, tagVersions: tagThem = true, date = today() } = {}){
  const r = clone(state.cur);
  delete r.snapshots;
  r.company = String(company ?? r.company ?? '').trim();
  r.role = String(role ?? r.role ?? '').trim();
  kindOf(r, forKind);
  r.jobType = String(jobType ?? r.jobType ?? '').trim();
  r.tags = [...new Set((tags ?? r.tags ?? []).map(t => String(t).trim()).filter(Boolean))];
  let tagged = 0;
  // what was typed may be a job type's label
  const known = jobTypesOf(state.record).find(j => j.id === r.jobType) ?? jobTypesOf(state.record).find(j => j.label.toLowerCase() === r.jobType.toLowerCase());
  if (known) r.jobType = known.id;
  const label = r.jobType ? jobTypeLabel(state.record, r.jobType) : '';
  r.name = String(name ?? '').trim() || nameFrom({ company: r.company, role: r.role, jobLabel: label }) || r.name || r.application || r.title || t('resumes.untitled');
  r.application = r.title = r.name;
  r.savedAt = date;
  r.date = date;
  delete r.id;
  r.id = uniqueId(state.resumes, r);
  if (r.jobType){
    state.record.jobTypes ??= [];
    if (!known) state.record.jobTypes.push(r.jobType);
    if (tagThem) tagged = tagVersions(state.record, r, r.jobType);
  }
  state.resumes = [...(state.resumes ?? []), r];
  state.cur = clone(r);
  state.openId = r.id;
  state.frozen = { ...(state.frozen ?? {}), [r.id]: bodyOf(state, r) };
  return { id: r.id, tagged };
}

// Runs inside every commit (src/store/store.js): the open resume is written into `resumes` and its frozen text
// refreshed, so what is on the page is always what is saved. A resume that was never saved is saved now.
export function settle(state){
  if (!state?.record || !state.cur) return;
  const i = state.openId ? (state.resumes ?? []).findIndex(r => r.id === state.openId) : -1;
  if (i < 0){ saveNew(state, { tagVersions: false }); return; }
  const prev = state.resumes[i];
  const next = { ...clone(state.cur), id: state.openId };
  delete next.snapshots;
  const bare = ({ savedAt, snapshots, ...r }) => JSON.stringify(canon(r));
  next.savedAt = bare(prev) === bare(next) ? prev.savedAt : today();
  state.cur = clone(next);
  state.resumes[i] = prev.snapshots?.length ? { ...next, snapshots: prev.snapshots } : next;
  const body = bodyOf(state, next, state.frozen?.[next.id] ?? null);
  if (body) state.frozen = { ...(state.frozen ?? {}), [next.id]: body };
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
    if (isLocked(model, recipe, id)) continue;      // a locked line is not offered newer wording
    const text = recipe.overrides?.[id];
    const free = clone(recipe);
    delete free.overrides[id];
    const live = chooseVariant(model, id, free).v?.text ?? null;
    if (text !== undefined && live !== null && live !== text) out.push({ fact: id, frozen: text, live });
  }
  return out;
}
// keepOlder leaves the saved text as this resume's own one-off.
export function acceptNewer(recipe, factId, model = null){
  guard(model, recipe, factId);
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
  const snaps = state.resumes[i].snapshots;
  const r = clone(state.resumes[i]);
  delete r.snapshots;
  const diffs = holdFrozen(state.record, r, state.frozen?.[id] ?? null);
  state.resumes[i] = snaps?.length ? { ...clone(r), snapshots: snaps } : clone(r);
  state.cur = r;
  state.openId = id;
  return { held: newerOf(state.record, r), diffs };
}

// A copy of a saved resume's recipe to start something else from: no name, no snapshots, no For.
function copyOf(src){
  const r = clone(src);
  for (const k of ['id', 'savedAt', 'date', 'held', 'snapshots', 'forKind', 'parent']) delete r[k];
  r.company = ''; r.role = '';
  return r;
}

// The recipe a new resume would start as, without saving anything (the form previews it).
// start: 'latest' (copy fromId, or the newest saved resume of jobType), 'tagged' (bullets tagged jobType),
// 'all' (everything in the record) or 'empty'.
export function startRecipe(state, { start = 'all', fromId = null, jobType = '', format, lang } = {}){
  const f = format ?? state.cur?.format ?? 'a4';
  const L = lang ?? state.cur?.lang ?? 'en';
  let r;
  if (start === 'latest'){
    const src = fromId ? savedOf(state, fromId) : byNewest(state.resumes ?? []).find(x => x.jobType === jobType);
    if (!src) throw new Error(`no saved resume of type ${jobType}`);
    r = copyOf(src);
    holdFrozen(state.record, r, state.frozen?.[src.id] ?? null);
    switchLang(r, L, state.record);
    if (format) r.format = format;
  } else {
    r = newResume(state.record, { format: f, lang: L, pageLimit: state.cur?.pageLimit ?? 1 });
    if (start === 'tagged') applyTag(state.record, r, jobType);
    if (start === 'empty') r.sections = r.sections.map(s => ({ ...s, weight: 0, ...(s.work ? { work: [] } : {}) }));
  }
  r.jobType = jobType;
  return r;
}

// The result is saved and open.
export function newFrom(state, { name, company, role, forKind, tags, jobType = '', ...start } = {}){
  const r = startRecipe(state, { ...start, jobType });
  state.cur = r;
  state.openId = null;
  return saveNew(state, { name, company, role, forKind, jobType, tags: tags ?? [], tagVersions: false });
}

// Saves a copy of a resume (in another language, if asked) and opens it. Holds come along.
export function duplicate(state, id, { lang = null, name = null } = {}){
  const src = savedOf(state, id);
  if (!src) throw new Error(`no saved resume ${id}`);
  const r = copyOf(src);
  r.company = src.company ?? ''; r.role = src.role ?? '';
  r.parent = src.id;
  if (src.forKind) r.forKind = src.forKind;
  holdFrozen(state.record, r, state.frozen?.[id] ?? null);
  const base = resumeLabel(src);
  const to = lang && lang !== (r.lang ?? 'en') ? lang : null;
  if (to) switchLang(r, to, state.record);
  state.cur = r;
  state.openId = null;
  return saveNew(state, { name: name ?? (to ? t('ux1.langCopy', { name: base, lang: to.toUpperCase() }) : t('ux1.copyOf', { name: base })), tagVersions: false });
}

export function renameSaved(state, id, name){
  const i = (state.resumes ?? []).findIndex(r => r.id === id);
  if (i < 0) throw new Error(`no saved resume ${id}`);
  const r = state.resumes[i];
  r.name = String(name ?? '').trim() || nameFrom({ company: r.company, role: r.role, jobLabel: r.jobType ? jobTypeLabel(state.record, r.jobType) : '' }) || t('resumes.untitled');
  r.application = r.title = r.name;
  const nid = uniqueId(state.resumes, r, id);
  if (nid !== id){
    r.id = nid;
    if (state.frozen?.[id] !== undefined){ state.frozen = { ...state.frozen, [nid]: state.frozen[id] }; delete state.frozen[id]; }
  }
  if (nid !== id) for (const o of [...state.resumes, state.cur]) if (o?.parent === id) o.parent = nid;    // a parent link is an id, and a rename changes the id
  if (state.openId === id){
    state.openId = nid;
    state.cur = { ...state.cur, id: nid, name: r.name, application: r.name, title: r.name };
  }
  return { id: nid };
}

// Deleting the open resume opens the newest one left, or a fresh one.
export function deleteSaved(state, id){
  const was = state.openId === id;
  const gone = state.cur;
  state.resumes = (state.resumes ?? []).filter(r => r.id !== id);
  if (state.frozen) delete state.frozen[id];
  if (!was) return;
  state.openId = null;
  const next = byNewest(state.resumes)[0];
  if (next) openSaved(state, next.id);
  else if (gone && state.record) state.cur = newResume(state.record, { format: gone.format, lang: gone.lang ?? 'en', pageLimit: gone.pageLimit ?? 1 });
}

// ---- snapshots: what was sent, and to whom ----

const SEND_KINDS = ['company', 'outreach'];
export const normalSend = (s = {}, date = today()) => ({
  kind: SEND_KINDS.includes(s.kind) ? s.kind : 'company',
  company: String(s.company ?? '').trim(), role: String(s.role ?? '').trim(), date: String(s.date || date),
});
export const sameSend = (a, b) => a.kind === b.kind && a.company === b.company && a.role === b.role && a.date === b.date;
export const snapshotsOf = r => r?.snapshots ?? [];
export const sendLabel = s => [s.company || (s.kind === 'outreach' ? t('ux1.outreach') : ''), s.role].filter(Boolean).join(' - ');

// What the open resume prints now, in the shape a snapshot keeps it.
function printOf(state){
  const body = resolve(state.record, state.cur).body;
  const recipe = clone(state.cur);
  delete recipe.id; delete recipe.snapshots;
  return { recipe, body, key: printedKey(recipe, body) };
}
// Would Save add a send to the latest snapshot rather than make a new one?
export function sameAsLatest(state){
  const latest = snapshotsOf(savedOf(state)).at(-1);
  return !!latest && !!state.cur && printedKey(latest.recipe, latest.body) === printOf(state).key;
}

// Save: freeze the open resume as it prints. If nothing printed has changed since the latest snapshot, the send
// goes onto that snapshot instead of a new one.
export function takeSnapshot(state, send = {}, { at = new Date().toISOString(), date = today() } = {}){
  if (!savedOf(state) || !state.cur) throw new Error('no resume is open');
  settle(state);
  const saved = savedOf(state);
  const { recipe, body, key } = printOf(state);
  const snaps = [...(saved.snapshots ?? [])];
  const s = normalSend(send, date);
  const latest = snaps.at(-1);
  let snap, added = false, repeated = false;
  if (latest && printedKey(latest.recipe, latest.body) === key){
    snap = { ...latest, sends: [...latest.sends] };
    if (snap.sends.some(x => sameSend(x, s))) repeated = true; else snap.sends.push(s);
    snaps[snaps.length - 1] = snap;
  } else {
    const n = 1 + Math.max(0, ...snaps.map(x => parseInt(String(x.id).replace(/^\D+/, ''), 10) || 0));
    snap = { id: `s${n}`, at, sends: [s], recipe, body };
    snaps.push(snap);
    added = true;
  }
  saved.snapshots = snaps;
  const tagged = state.cur.jobType ? tagVersions(state.record, state.cur, state.cur.jobType) : 0;
  return { id: snap.id, added, repeated, tagged };
}

export function findSnapshot(state, sid, rid = state.openId){
  return snapshotsOf(savedOf(state, rid)).find(x => x.id === sid) ?? null;
}

// The recipe a snapshot shows: the sent wording is held over the record's present one.
export function snapshotRecipe(model, snap){
  const r = clone(snap.recipe);
  holdFrozen(model, r, snap.body);
  return r;
}

export function deleteSnapshot(state, sid){
  const saved = savedOf(state);
  if (saved) saved.snapshots = snapshotsOf(saved).filter(x => x.id !== sid);
  if (saved && !saved.snapshots.length) delete saved.snapshots;
}

const KEEP_ON_RESTORE = ['id', 'name', 'application', 'title', 'company', 'role', 'forKind', 'jobType', 'tags', 'savedAt', 'date'];
// Restore as current: the open resume prints as the snapshot did; its name and For stay.
export function restoreSnapshot(state, sid){
  const snap = findSnapshot(state, sid);
  if (!snap) throw new Error(`no snapshot ${sid}`);
  if (state.cur?.locked?.length) throw new LockedError(null, 'ux6c.restoreLocked');      // a restore would replace the locked text and drop the lock
  const r = snapshotRecipe(state.record, snap);
  for (const k of KEEP_ON_RESTORE){ if (state.cur[k] === undefined) delete r[k]; else r[k] = state.cur[k]; }
  state.cur = r;
  settle(state);
}

// Duplicate as new resume: a resume of its own that starts as the snapshot printed.
export function duplicateSnapshot(state, sid, { name = null } = {}){
  const src = savedOf(state);
  const snap = findSnapshot(state, sid);
  if (!snap) throw new Error(`no snapshot ${sid}`);
  const r = snapshotRecipe(state.record, snap);
  for (const k of ['id', 'savedAt', 'date']) delete r[k];
  const when = snap.sends[0]?.date || snap.at.slice(0, 10);
  state.cur = r;
  state.openId = null;
  return saveNew(state, { name: name ?? t('ux1.copyOfSnap', { name: resumeLabel(src), date: when }), company: src.company, role: src.role, forKind: src.forKind, tagVersions: false });
}

// The resume this one was copied from, if it is still saved.
export const parentOf = (state, r) => (r?.parent ? savedOf(state, r.parent) : null);
// For resumes made before parents were recorded: the other resume in the same language that prints most of the same lines.
// printedOf(r) lists what r prints.
export function closestTo(state, r, printedOf){
  const mine = new Set(printedOf(r));   // no common line: no guess; a tie goes to the newest
  let best = null;
  for (const o of state.resumes ?? []){
    if (o === r || (o.lang ?? 'en') !== (r.lang ?? 'en')) continue;
    const theirs = new Set(printedOf(o));
    let n = 0;
    for (const x of mine) if (theirs.has(x)) n++;
    const s = n / Math.max(mine.size, theirs.size, 1);
    if (s > 0 && (!best || s > best.s || (s === best.s && String(o.savedAt ?? '') > String(best.r.savedAt ?? '')))) best = { r: o, s };
  }
  return best;
}
// Other resumes for the same company.
export const sameCompany = (state, r) => (state.resumes ?? []).filter(o => o !== r && o.company && r.company && o.company.trim().toLowerCase() === r.company.trim().toLowerCase());

// The search box in the switcher.
export function matches(model, r, q){
  const needle = String(q ?? '').trim().toLowerCase();
  if (!needle) return true;
  return [resumeLabel(r), r.company, r.role, r.jobType ? jobTypeLabel(model, r.jobType) : '', r.lang].some(x => String(x ?? '').toLowerCase().includes(needle));
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

// ---- the grown switcher's other two views ----

// The Date view: every send, newest first; a resume that was never sent comes in at the day it was last saved.
export function sendEvents(resumes){
  const out = [];
  for (const r of resumes){
    const snaps = snapshotsOf(r);
    for (const s of snaps) for (const x of s.sends) out.push({ date: String(x.date || s.at.slice(0, 10)), kind: 'send', resume: r, snap: s, send: x });
    if (!snaps.length) out.push({ date: String(r.savedAt ?? '').slice(0, 10), kind: 'saved', resume: r, snap: null, send: null });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || resumeLabel(a.resume).localeCompare(resumeLabel(b.resume)));
}
// …in bands of a year, the way the Career timeline was
export function sendBands(events){
  const bands = [];
  for (const e of events){
    const year = e.date.slice(0, 4) || '';
    let b = bands.at(-1);
    if (!b || b.year !== year){ b = { year, events: [] }; bands.push(b); }
    b.events.push(e);
  }
  return bands;
}
// The Company view: the company of a resume's For line and of each send, with the resumes that went there.
// Outreach is marked, since a sector or a made-up name is not a place you applied. A resume with no company at all
// comes last, ungrouped. Searching matches the company too.
export function byCompany(resumes){
  const groups = new Map();
  const add = (name, outreach, r, send = null) => {
    const label = String(name ?? '').trim();
    const key = label.toLowerCase();
    const g = groups.get(key) ?? groups.set(key, { key, label, rows: new Map() }).get(key);
    const row = g.rows.get(r.id) ?? g.rows.set(r.id, { resume: r, outreach, sends: [] }).get(r.id);
    row.outreach = row.outreach && outreach;
    if (send) row.sends.push(send);
  };
  for (const r of resumes){
    let any = false;
    if (String(r.company ?? '').trim()){ add(r.company, r.forKind === 'outreach', r); any = true; }
    for (const s of snapshotsOf(r)) for (const x of s.sends) if (String(x.company ?? '').trim()){ add(x.company, x.kind === 'outreach', r, { ...x, snapId: s.id }); any = true; }
    if (!any) add('', false, r);
  }
  const list = [...groups.values()].map(g => ({ key: g.key, label: g.label, rows: byNewest([...g.rows.values()].map(x => x.resume)).map(res => g.rows.get(res.id)) }));
  return list.sort((a, b) => (a.key === '') - (b.key === '') || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

// ---- compare: any number of resumes side by side ----

// what a resume prints for a claim: an edit on this resume, or the version it picks
function cellOf(model, r, factId){
  if (r.overrides?.[factId] !== undefined){ const held = (r.held ?? []).includes(factId); return { label: held ? t('cmp.savedText') : t('edit.onlyHere'), text: String(r.overrides[factId]), edit: !held }; }
  const v = chooseVariant(model, factId, r).v;
  return v ? { label: `v${v.n}`, text: v.text, variant: v.id } : { label: '—', text: '' };
}
// the claims a resume prints, header lines first: a line only on one resume has an id of its own on each, so it is keyed by its job and
// words, and is one claim when those are the same
function claimsOf(model, r){
  const p = printedFacts(model, r), header = Object.values(model.basics?.display ?? {}).filter(f => (model.facts ?? []).some(x => x.id === f));
  return new Map([...header.map(f => [f, f]), p.summary && [p.summary.fact, p.summary.fact], ...p.work.flatMap(w => w.highlights.map(h => [isLocal(r, h.fact) ? `local:${w.job}:${h.text}` : h.fact, h.fact]))].filter(Boolean));
}
// kept by the record and the resume's content, so a search keystroke or a redraw does not lay every resume out again
const idsKept = new WeakMap();
export const printedIds = (model, r) => {
  const kept = idsKept.get(model) ?? idsKept.set(model, new Map()).get(model), key = JSON.stringify(r);
  return kept.get(key) ?? kept.set(key, [...claimsOf(model, r).keys()]).get(key);
};
// the jobs that print: a job with no picked bullet is left off the page, so its place in the order is not a difference
const jobIdsOf = (model, r) => {
  const on = new Set(printedFacts(model, r).work.map(w => w.job)), isJob = new Set((model.work ?? []).map(w => w.id));
  return jobRefs(model, r).map(x => (typeof x === 'string' ? x : x.id)).filter(id => !isJob.has(id) || on.has(id));
};
const jobName = (model, id) => [...(model.work ?? []), ...(model.projects ?? [])].find(w => w.id === id)?.name ?? id;
const skillNames = (model, r) => arrangementOf(model, r).groups.map(g => g.label ?? groupLabel(model, r, g.id)).join(', ');
const claimLabel = (model, key, f, cells) => (model.facts ?? []).find(x => x.id === f)?.summary ?? (key.startsWith('local:') ? (cells.find(c => c.text)?.text ?? '').slice(0, 60) : f);

// Rows for a table with a column per resume: the settings, then every claim any of them prints. `cells` has one entry per resume.
export function compareMany(model, list){
  const pages = r => (r.pageLimit === 0 ? t('cmp.anyPages') : r.pageLimit ? String(r.pageLimit) : Array.isArray(r.pages) ? t('cmp.byHand', { n: r.pages.length }) : '—');
  const nSections = r => (r.sections ?? []).filter(s => s && s.weight !== 0).length;
  const settings = [
    [t('resumes.jobType'), r => (r.jobType ? jobTypeLabel(model, r.jobType) : '—')],
    [t('cmp.language'), r => (r.lang ?? 'en').toUpperCase()],
    [t('design.paper'), r => (r.format === 'us-letter' ? t('paper.letter') : t('paper.a4'))],
    [t('design.pages'), pages],
    [t('design.photo'), r => (r.photo?.show ? r.photo.shape ?? t('cmp.on') : t('cmp.off'))],
    [t('cmp.sections'), r => String(nSections(r))],
    [t('ux6e.rowJobs'), r => jobIdsOf(model, r).map(id => jobName(model, id)).join(' › ') || '—'],
    [t('ux6e.rowSkills'), r => skillNames(model, r) || '—'],
  ].map(([label, fn]) => { const cells = list.map(fn); return { kind: 'setting', label, cells, differs: cells.some(c => c !== cells[0]) }; });
  const maps = list.map(r => claimsOf(model, r)), none = { label: '—', text: '' };
  const claims = [...new Set(maps.flatMap(m => [...m.keys()]))].map(k => {
    const f = maps.find(m => m.has(k)).get(k);
    const cells = list.map((r, i) => (maps[i].has(k) ? cellOf(model, r, maps[i].get(k)) : none));
    return { kind: 'claim', fact: f, label: claimLabel(model, k, f, cells), cells, differs: cells.some(c => c.label !== cells[0].label || c.text !== cells[0].text) };
  });
  return [...settings, ...claims];
}
// Two resumes, as the first compare was: a and b on each row
export const compareRows = (model, a, b) => compareMany(model, [a, b]).map(r => ({ ...r, a: r.cells[0], b: r.cells[1] }));

// "What differs from <parent>": a short list in plain words of what the child has that the parent has not
export function differences(model, p, c){
  const out = [], A = claimsOf(model, p), B = claimsOf(model, c);
  if (resumeLabel(p) !== resumeLabel(c)) out.push(t('ux6e.sum.name', { name: resumeLabel(c) }));
  for (const k of new Set([...A.keys(), ...B.keys()])){
    const x = A.has(k) ? cellOf(model, p, A.get(k)) : null, y = B.has(k) ? cellOf(model, c, B.get(k)) : null;
    const what = claimLabel(model, k, (B.get(k) ?? A.get(k)), [y ?? x]);
    if (!x) out.push(t(k.startsWith('local:') ? 'ux6e.sum.local' : 'ux6e.sum.added', { what }));
    else if (!y) out.push(t('ux6e.sum.removed', { what }));
    else if (x.label !== y.label || x.text !== y.text) out.push(t(y.edit ? 'ux6e.sum.edited' : 'ux6e.sum.version', { what, a: x.label, b: y.label }));
  }
  const ja = jobIdsOf(model, p), jb = jobIdsOf(model, c);
  if (ja.join() !== jb.join() && ja.length === jb.length) out.push(t('ux6e.sum.jobs', { order: jb.map(id => jobName(model, id)).join(' › ') }));
  if (!!p.photo?.show !== !!c.photo?.show) out.push(t('ux6e.sum.photo', { a: t(p.photo?.show ? 'cmp.on' : 'cmp.off'), b: t(c.photo?.show ? 'cmp.on' : 'cmp.off') }));
  if (p.format !== c.format) out.push(t('ux6e.sum.paper', { a: t(p.format === 'us-letter' ? 'paper.letter' : 'paper.a4'), b: t(c.format === 'us-letter' ? 'paper.letter' : 'paper.a4') }));
  if (skillNames(model, p) !== skillNames(model, c) || JSON.stringify(arrangementOf(model, p).groups) !== JSON.stringify(arrangementOf(model, c).groups)) out.push(t('ux6e.sum.skills', { order: skillNames(model, c) }));
  return out;
}
