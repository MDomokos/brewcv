// resume-data/4: every file is a valid JSON Resume. Pure: no DOM, no I/O.
// meta.resumeBuilder is the source of truth; body text edited elsewhere is reported on load, not imported.

import { resolve, defaultVariant, DEFAULT_LANG, migratePins } from './resume.js';

export const SCHEMA = 'resume-data/4';
export const RESUME_SCHEMA = 'resume-recipe/4';
export const JSON_RESUME_SCHEMA = 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json';
export const JSON_RESUME_VERSION = 'v1.0.0';
export const LANGS = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu'];

// Any other root key goes under meta.resumeBuilder.
export const BODY_KEYS = ['basics', 'work', 'volunteer', 'education', 'awards', 'certificates',
  'publications', 'skills', 'languages', 'interests', 'references', 'projects'];
// meta.resumeBuilder keys that are not copies of a root key.
const RESERVED = new Set(['schema', 'info', 'summary', 'highlights', 'nulls', 'image', 'projectHighlights', 'volunteerHighlights']);
// projects and volunteering made into entries keep their claim ids, like work
const MORE_ENTRIES = [['projects', 'projectHighlights'], ['volunteer', 'volunteerHighlights']];
const isEntryShape = x => !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.display?.position === 'string' && Array.isArray(x.highlights);

const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);

export function detect(json){
  if (!isObj(json)) return 'unknown';
  // Old name, kept: renaming it would orphan saved data.
  if (json.resumeBuilderBackup) return 'backup';
  // Old name, kept: renaming it would orphan saved data.
  const rb = json.meta?.resumeBuilder;
  if (isObj(rb) && rb.resume) return 'resume';
  if (isObj(rb) && typeof rb.schema === 'string' && rb.schema.startsWith('resume-data/')) return 'library';
  if (/^resume-data\/[23]$/.test(json.schema ?? '') && Array.isArray(json.facts)) return 'library-v3';
  if (isObj(json.picks) || (typeof json.format === 'string' && typeof json.theme === 'string')) return 'recipe-v3';
  if (isObj(json.tokens)) return 'theme';
  if (isObj(json.basics) && (json.work || json.education || json.skills)) return 'jsonresume';
  return 'unknown';
}

// resume-data/2 or /3 → /4. Idempotent.
export function migrate(v3){
  const m = clone(v3);
  m.schema = SCHEMA;
  const byId = new Map((m.variants ?? []).map(v => [v.id, v]));
  for (const v of m.variants ?? []) if (v.lang === undefined) v.lang = DEFAULT_LANG;

  for (const f of m.facts ?? []){
    const groups = new Map();
    for (const id of f.variants ?? []){
      const v = byId.get(id);
      if (!v) continue;
      (groups.get(v.lang) ?? groups.set(v.lang, []).get(v.lang)).push(v);
    }
    for (const vs of groups.values()){
      let next = 1 + Math.max(0, ...vs.filter(v => typeof v.n === 'string').map(v => parseInt(v.n, 10) || 0));
      for (const v of vs) if (typeof v.n !== 'string') v.n = String(next++);
    }
    const def = {};
    for (const [lang, vs] of groups){
      const kept = f.default?.[lang];
      def[lang] = vs.some(v => v.id === kept) ? kept : (vs.find(v => v.id.endsWith('-base')) ?? vs[0]).id;
    }
    f.default = def;
  }
  m.same ??= [];
  m.jobTypes ??= [];
  m.themes ??= [];
  // v3 required a source on everything; a migrated record keeps that rule
  m.requireSource ??= true;
  toJsonResumeNames(m);
  return m;
}

// The `archive` tag and the `archived` flag were two ways to say one thing. The tag becomes the flag: on the claim
// when every wording of it was tagged and the job keeps another live claim, else on the wording. In place and
// idempotent; returns how many wordings it changed.
export function mergeArchiveTag(m){
  const isTag = t => String(t).toLowerCase() === 'archive';
  const byId = new Map((m?.variants ?? []).map(v => [v.id, v]));
  let n = 0;
  for (const v of m?.variants ?? []){
    if (!Array.isArray(v.tags) || !v.tags.some(isTag)) continue;
    const keep = v.tags.filter(t => !isTag(t));
    if (keep.length) v.tags = keep; else delete v.tags;
    v.archived = true;
    n++;
  }
  for (const f of m?.facts ?? []){
    const vs = (f.variants ?? []).map(id => byId.get(id)).filter(Boolean);
    if (f.archived || !vs.length || !vs.every(v => v.archived === true)) continue;
    const job = (m.work ?? []).find(w => (w.highlights ?? []).includes(f.id));
    const live = job && (job.highlights ?? []).some(h => h !== f.id && !(m.facts ?? []).find(x => x.id === h)?.archived);
    if (job && !live) continue;
    f.archived = true;
    for (const v of vs) delete v.archived;
  }
  return n;
}

// Fields this app once named differently take JSON Resume's name (education `honours` → `score`).
// In place and idempotent; returns how many it renamed.
export const RENAMED = [['education', 'honours', 'score']];
export function toJsonResumeNames(m){
  let n = 0;
  for (const [key, from, to] of RENAMED) for (const x of m?.[key] ?? []){
    if (!isObj(x) || !(from in x)) continue;
    if (x[to] === undefined || x[to] === '') x[to] = x[from];
    delete x[from];
    n++;
  }
  return n;
}
// meta keys JSON Resume defines that the app writes itself
const OWN_META = new Set(['version', 'lastModified', 'resumeBuilder']);

function stripNulls(node, path, out){
  if (Array.isArray(node)) node.forEach((x, i) => stripNulls(x, [...path, i], out));
  else if (isObj(node)) for (const k of Object.keys(node)){
    if (node[k] === null){ out.push([...path, k]); delete node[k]; }
    else stripNulls(node[k], [...path, k], out);
  }
}
function setAt(root, path, value){
  let o = root;
  for (const k of path.slice(0, -1)){ if (o == null) return; o = o[k]; }
  if (o != null && typeof o === 'object') o[path.at(-1)] = value;
}
const workKey = (w, i) => (typeof w?.id === 'string' && w.id ? w.id : `@${i}`);
const defaultText = (model, id) => (id ? defaultVariant(model, id, DEFAULT_LANG)?.text ?? '' : '');

// Deterministic: the same model always gives the same bytes.
export function save(model, { lastModified = model.meta?.updated } = {}){
  for (const k of Object.keys(model)) if (RESERVED.has(k) && k !== 'schema')
    throw new Error(`the record has a root key "${k}", which resume-data/4 reserves`);
  const rb = { schema: SCHEMA };
  const body = { $schema: JSON_RESUME_SCHEMA };
  for (const [k, v] of Object.entries(model)){
    if (k === 'schema' || k === '$schema' || k === 'jsonMeta') continue;
    if (BODY_KEYS.includes(k)) body[k] = clone(v);
    else if (k === 'meta') rb.info = clone(v);
    else rb[k] = clone(v);
  }

  const b = body.basics;
  if (b && typeof model.basics.summary === 'string'){
    rb.summary = model.basics.summary;
    b.summary = defaultText(model, model.basics.summary);
  }
  if (Array.isArray(body.work)){
    rb.highlights = {};
    body.work.forEach((w, i) => {
      if (!Array.isArray(w.highlights)) return;
      rb.highlights[workKey(w, i)] = w.highlights;
      w.highlights = w.highlights.map(id => defaultText(model, id));
    });
  }
  for (const [k, hk] of MORE_ENTRIES){
    if (!Array.isArray(body[k])) continue;
    const map = {};
    body[k].forEach((x, i) => {
      if (!isEntryShape(model[k][i])) return;
      map[x.id] = x.highlights;
      x.highlights = x.highlights.map(id => defaultText(model, id));
    });
    if (Object.keys(map).length) rb[hk] = map;
  }
  // a reference's text is a fact with versions; the body says its default
  if (Array.isArray(body.references)) for (const r of body.references)
    if (r && typeof r.id === 'string' && (model.facts ?? []).some(f => f.id === r.id)) r.reference = defaultText(model, r.id) || r.reference;
  // The portrait is stored once, as JSON Resume's basics.image.
  if (b?.portrait?.src && b.image === undefined){
    b.image = b.portrait.src;
    delete b.portrait.src;
    rb.image = 'portrait';
  }
  const nulls = [];
  for (const k of BODY_KEYS) if (body[k] !== undefined) stripNulls(body[k], [k], nulls);
  if (nulls.length) rb.nulls = nulls;

  // the file's own JSON Resume meta (canonical and anything else a tool put
  // there) is written back as it came; version and lastModified are the app's
  const extra = Object.fromEntries(Object.entries(model.jsonMeta ?? {}).filter(([k]) => !OWN_META.has(k)));
  body.meta = { ...clone(extra), version: JSON_RESUME_VERSION, ...(lastModified ? { lastModified } : {}), resumeBuilder: rb }; // Old name, kept: renaming it would orphan saved data.
  return body;
}

export const serialize = file => JSON.stringify(file, null, 2) + '\n';

export function load(file){
  const kind = detect(file);
  if (kind === 'library-v3'){
    const model = migrate(file);
    mergeArchiveTag(model);
    return { model, warnings: [`${file.schema} was read and migrated in memory; saving writes ${SCHEMA}`] };
  }
  if (kind !== 'library')
    throw new Error(kind === 'unknown' ? 'that is not a BrewCV library' : `that is a ${kind} file, not a library`);

  const rb = file.meta.resumeBuilder;
  const warnings = [];
  if (rb.schema !== SCHEMA) warnings.push(`meta.resumeBuilder.schema is ${JSON.stringify(rb.schema)}, expected "${SCHEMA}"`);

  const model = { schema: SCHEMA };
  if (rb.info !== undefined) model.meta = clone(rb.info);
  for (const [k, v] of Object.entries(file)) if (BODY_KEYS.includes(k)) model[k] = clone(v);
  for (const [k, v] of Object.entries(rb)) if (!RESERVED.has(k)) model[k] = clone(v);
  for (const p of rb.nulls ?? []) setAt(model, p, null);
  const extraMeta = Object.fromEntries(Object.entries(file.meta).filter(([k]) => !OWN_META.has(k)));
  if (Object.keys(extraMeta).length) model.jsonMeta = clone(extraMeta);
  toJsonResumeNames(model);
  mergeArchiveTag(model);

  const b = model.basics;
  if (b && rb.image === 'portrait' && b.portrait){
    b.portrait.src = b.image;
    delete b.image;
  }
  // The body is a projection: read the ids back and report outside edits.
  if (b && rb.summary !== undefined){
    const want = defaultText(model, rb.summary);
    if ((b.summary ?? '') !== want) warnings.push('basics.summary was edited outside BrewCV; the edit is ignored here; Open or import turns it into a version');
    b.summary = rb.summary;
  }
  (model.work ?? []).forEach((w, i) => {
    const ids = rb.highlights?.[workKey(w, i)];
    if (!ids){
      if (Array.isArray(w.highlights) && w.highlights.length){
        warnings.push(`work ${workKey(w, i)} has ${w.highlights.length} highlight(s) with no claims behind them; they are ignored here; Open or import turns them into claims`);
        w.highlights = [];
      }
      return;
    }
    const texts = Array.isArray(w.highlights) ? w.highlights : [];
    const want = ids.map(id => defaultText(model, id));
    if (texts.length !== want.length || texts.some((t, n) => t !== want[n]))
      warnings.push(`work ${workKey(w, i)} highlights were edited outside BrewCV; the edits are ignored here; Open or import turns them into versions`);
    w.highlights = clone(ids);
  });
  for (const [k, hk] of MORE_ENTRIES) for (const x of model[k] ?? []){
    const ids = x && rb[hk]?.[x.id];
    if (Array.isArray(ids)) x.highlights = clone(ids);
  }
  return { model, warnings };
}

// JSON Resume v1.0.0 types, checked by hand to avoid a dependency. [] means valid.
const ISO = /^([1-2][0-9]{3}-[0-1][0-9]-[0-3][0-9]|[1-2][0-9]{3}-[0-1][0-9]|[1-2][0-9]{3})$/;
// A JSON Resume date: YYYY, YYYY-MM or YYYY-MM-DD (the month picker writes YYYY-MM and checks it here).
export const isIsoDate = s => typeof s === 'string' && ISO.test(s);
const SHAPE = {
  basics: { str: ['name', 'label', 'image', 'email', 'phone', 'url', 'summary'], obj: { location: ['address', 'postalCode', 'city', 'countryCode', 'region'] }, arr: { profiles: ['network', 'username', 'url'] } },
  work: { str: ['name', 'location', 'description', 'position', 'url', 'summary'], date: ['startDate', 'endDate'], strs: ['highlights'] },
  volunteer: { str: ['organization', 'position', 'url', 'summary'], date: ['startDate', 'endDate'], strs: ['highlights'] },
  education: { str: ['institution', 'url', 'area', 'studyType', 'score'], date: ['startDate', 'endDate'], strs: ['courses'] },
  awards: { str: ['title', 'awarder', 'summary'], date: ['date'] },
  certificates: { str: ['name', 'url', 'issuer'], date: ['date'] },
  publications: { str: ['name', 'publisher', 'url', 'summary'], date: ['releaseDate'] },
  skills: { str: ['name', 'level'], strs: ['keywords'] },
  languages: { str: ['language', 'fluency'] },
  interests: { str: ['name'], strs: ['keywords'] },
  references: { str: ['name', 'reference'] },
  projects: { str: ['name', 'description', 'url', 'entity', 'type'], date: ['startDate', 'endDate'], strs: ['highlights', 'keywords', 'roles'] },
};
export function checkJsonResume(file){
  const errs = [];
  if (!isObj(file)) return ['not an object'];
  const strs = (o, keys, where) => { for (const k of keys ?? []) if (o[k] !== undefined && typeof o[k] !== 'string') errs.push(`${where}.${k}: must be a string, is ${o[k] === null ? 'null' : typeof o[k]}`); };
  const dates = (o, keys, where) => { for (const k of keys ?? []) if (o[k] !== undefined && (typeof o[k] !== 'string' || !ISO.test(o[k]))) errs.push(`${where}.${k}: ${JSON.stringify(o[k])} is not a JSON Resume date`); };
  const lists = (o, keys, where) => { for (const k of keys ?? []) if (o[k] !== undefined && (!Array.isArray(o[k]) || o[k].some(x => typeof x !== 'string'))) errs.push(`${where}.${k}: must be an array of strings`); };
  for (const [key, s] of Object.entries(SHAPE)){
    const v = file[key];
    if (v === undefined) continue;
    if (key === 'basics'){
      if (!isObj(v)){ errs.push('basics: must be an object'); continue; }
      strs(v, s.str, 'basics');
      if (v.location !== undefined){ if (!isObj(v.location)) errs.push('basics.location: must be an object'); else strs(v.location, s.obj.location, 'basics.location'); }
      if (v.profiles !== undefined){
        if (!Array.isArray(v.profiles)) errs.push('basics.profiles: must be an array');
        else v.profiles.forEach((p, n) => isObj(p) ? strs(p, s.arr.profiles, `basics.profiles[${n}]`) : errs.push(`basics.profiles[${n}]: must be an object`));
      }
      continue;
    }
    if (!Array.isArray(v)){ errs.push(`${key}: must be an array`); continue; }
    v.forEach((x, n) => {
      const where = `${key}[${n}]`;
      if (!isObj(x)){ errs.push(`${where}: must be an object`); return; }
      strs(x, s.str, where); dates(x, s.date, where); lists(x, s.strs, where);
    });
  }
  if (file.meta !== undefined && !isObj(file.meta)) errs.push('meta: must be an object');
  else if (file.meta) strs(file.meta, ['canonical', 'version', 'lastModified'], 'meta');
  return errs;
}

// FNV-1a over sorted fact ids, so a resume opened against the wrong record can say so.
export function libraryRef(model){
  let h = 0x811c9dc5;
  for (const ch of (model.facts ?? []).map(f => f.id).sort().join('\n')){
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return { owner: model.meta?.owner ?? model.basics?.name ?? '', facts: h.toString(16).padStart(8, '0') };
}

// v3 recipe → v4 resume. Keys the renderer reads keep their names. Idempotent.
export function migrateRecipe(recipe){
  const r = migratePins(clone(recipe));
  if (r.company === undefined || r.role === undefined){
    const m = String(r.application ?? '').match(/^(.+?) - (.+)$/);
    r.company ??= m ? m[1].trim() : '';
    r.role ??= m ? m[2].trim() : '';
  }
  r.jobType ??= '';
  r.tags ??= [];
  if (r.pageLimit === undefined && Array.isArray(r.pages)) r.pageLimit = r.pages.length <= 2 ? r.pages.length : 0;
  if (r.savedAt === undefined) r.savedAt = r.date ?? null;
  return r;
}

// `frozen` is written as is, so a later record edit never rewrites a saved resume's text.
// ATS-export `problems` are returned, but the file is written regardless.
// Snapshots (what was sent, and to whom) sit beside the recipe under meta.resumeBuilder, not in it.
export function saveResume(model, recipe, frozen = null){
  const { snapshots, ...bare } = recipe ?? {};
  const r = migrateRecipe(bare);
  const res = resolve(model, r);
  const problems = res.problems;
  const body = frozen ? clone(frozen) : res.body;
  const file = {
    $schema: JSON_RESUME_SCHEMA,
    ...body,
    meta: {
      version: JSON_RESUME_VERSION,
      ...(r.savedAt ? { lastModified: r.savedAt } : {}),
      // Old name, kept: renaming it would orphan saved data.
      resumeBuilder: { schema: RESUME_SCHEMA, library: libraryRef(model), resume: r, ...(Array.isArray(snapshots) && snapshots.length ? { snapshots: clone(snapshots) } : {}) },
    },
  };
  return { file, problems };
}

// A bare v3 recipe comes back unchanged with frozen null, so it renders byte-identical.
export function loadResume(file, model = null){
  const kind = detect(file);
  if (kind === 'recipe-v3') return { recipe: migratePins(clone(file)), frozen: null, warnings: [] };
  if (kind !== 'resume') throw new Error(`that is a ${kind} file, not a saved resume`);
  const rb = file.meta.resumeBuilder;
  const warnings = [];
  if (rb.schema !== RESUME_SCHEMA) warnings.push(`meta.resumeBuilder.schema is ${JSON.stringify(rb.schema)}, expected "${RESUME_SCHEMA}"`);
  if (model && rb.library?.facts && rb.library.facts !== libraryRef(model).facts)
    warnings.push(`this resume was saved against a different record (${rb.library.owner || 'unnamed'}); picks that no longer match are reported when it is applied`);
  const frozen = {};
  for (const k of BODY_KEYS) if (file[k] !== undefined) frozen[k] = clone(file[k]);
  const recipe = migratePins(clone(rb.resume));
  cleanLocal(recipe, model, warnings);
  cleanArrangement(recipe, warnings);
  cleanTerms(recipe, warnings);
  cleanLocked(recipe, warnings);
  cleanInStep(recipe, warnings);
  cleanLabelFrom(recipe, warnings);
  const snaps = readSnapshots(rb.snapshots, warnings);
  if (snaps.length) recipe.snapshots = snaps;
  return { recipe, frozen, warnings };
}

// recipe.localLines = { jobId: [{ id, after }] } is read from a file anyone can edit: a malformed entry, an id used twice or one
// that is a record fact is dropped, and an `after` that follows nothing in the job becomes null (the job's first line).
function cleanLocal(recipe, model, warnings){
  if (recipe.localLines === undefined) return;
  const facts = new Set((model?.facts ?? []).map(f => f.id)), seen = new Set(), out = {};
  const lines = isObj(recipe.localLines) ? recipe.localLines : (warnings.push('localLines is not an object; it is ignored'), {});
  for (const [job, list] of Object.entries(lines)){
    if (!Array.isArray(list)){ warnings.push(`localLines.${job} is not a list; it is ignored`); continue; }
    const w = model?.work?.find(x => x.id === job), mine = list.filter(l => isObj(l) && typeof l.id === 'string' && l.id && !facts.has(l.id) && !seen.has(l.id) && seen.add(l.id));
    if (mine.length !== list.length) warnings.push(`localLines.${job} had a line without an id of its own; it was dropped`);
    const keep = mine.map(l => ({ ...l, after: typeof l.after === 'string' && (!w || w.highlights.includes(l.after) || mine.some(x => x.id === l.after)) ? l.after : null }));
    if (keep.some((l, i) => l.after !== (mine[i].after ?? null))) warnings.push(`localLines.${job} had a line that follows nothing in the job; it is now the first`);
    if (keep.length) out[job] = keep;
  }
  if (Object.keys(out).length) recipe.localLines = out; else delete recipe.localLines;
}

// recipe.skillArrangement = { from, groups: [{ id, items, label? }] } is read from a file anyone can edit: a group that is not that, or
// whose id repeats, is dropped, and the whole key goes when it is not an arrangement at all.
function cleanArrangement(recipe, warnings){
  const a = recipe.skillArrangement;
  if (a === undefined) return;
  if (!isObj(a) || !Array.isArray(a.groups)){ warnings.push('skillArrangement is not { from, groups }; it is ignored'); delete recipe.skillArrangement; return; }
  const seen = new Set();
  const groups = a.groups.filter(g => isObj(g) && typeof g.id === 'string' && g.id && Array.isArray(g.items) && g.items.every(x => typeof x === 'string') && !seen.has(g.id) && seen.add(g.id))
    .map(({ label, ...g }) => (typeof label === 'string' ? { ...g, label } : g));
  if (groups.length !== a.groups.length) warnings.push('skillArrangement had a group without an id of its own or a list of skills; it was dropped');
  recipe.skillArrangement = { ...a, groups };
}

// recipe.locked is a list of ids; an id that matches nothing is harmless, anything that is not a string is dropped.
function cleanLocked(recipe, warnings){
  if (recipe.locked === undefined) return;
  const ids = Array.isArray(recipe.locked) ? [...new Set(recipe.locked.filter(x => typeof x === 'string' && x))] : [];
  if (!Array.isArray(recipe.locked) || ids.length !== recipe.locked.length) warnings.push('locked had something that is not an id; it was dropped');
  if (ids.length) recipe.locked = ids; else delete recipe.locked;
}

// recipe.inStep puts a language copy in its original's group: only `true` counts.
function cleanInStep(recipe, warnings){
  if (recipe.inStep === undefined || recipe.inStep === true) return;
  warnings.push('inStep is not true; it was dropped');
  delete recipe.inStep;
}

// recipe.labelFrom = { labelKey: { lang: text } } is the text of the other languages a label was written against. It is its own key, since
// `terms` and the labels keep only { lang: name } strings. Anything that is not a string is dropped.
function cleanLabelFrom(recipe, warnings){
  const a = recipe.labelFrom;
  if (a === undefined) return;
  const out = {};
  if (isObj(a)) for (const [key, v] of Object.entries(a)){
    const mine = isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) : {};
    if (Object.keys(mine).length) out[key] = mine;
  }
  if (!isObj(a) || JSON.stringify(out) !== JSON.stringify(a)) warnings.push('labelFrom had something that is not text, or is not a list of texts by language; it was dropped');
  if (Object.keys(out).length) recipe.labelFrom = out; else delete recipe.labelFrom;
}

// recipe.terms = { factId: { lang: name } } is read from a file anyone can edit: anything else is dropped, so setTerm never spreads a string into keys.
function cleanTerms(recipe, warnings){
  const a = recipe.terms;
  if (a === undefined) return;
  const out = {};
  if (isObj(a)) for (const [id, v] of Object.entries(a)){
    const mine = isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string' && x.trim())) : {};
    if (Object.keys(mine).length) out[id] = mine;
  }
  if (!isObj(a) || JSON.stringify(out) !== JSON.stringify(a)) warnings.push('terms had a name that is not text, or is not a list of names by language; it was dropped');
  if (Object.keys(out).length) recipe.terms = out; else delete recipe.terms;
}

// A snapshot is `{ id, at, label?, sends: [{ kind, company, role, date }], recipe, body }`: the resume as it printed.
// One that doesn't have that shape is dropped and reported, so an old or hand-edited file still loads.
const SEND_KINDS = ['company', 'outreach'];
export function readSnapshots(list, warnings = []){
  if (list === undefined) return [];
  if (!Array.isArray(list)){ warnings.push('meta.resumeBuilder.snapshots is not a list; it is ignored'); return []; }
  const out = [], seen = new Set();
  for (const s of list){
    if (!isObj(s) || typeof s.id !== 'string' || !s.id || seen.has(s.id) || !isObj(s.recipe) || !isObj(s.body)){
      warnings.push('a snapshot without an id, a recipe or a body was ignored');
      continue;
    }
    seen.add(s.id);
    const sends = (Array.isArray(s.sends) ? s.sends : []).filter(isObj).map(x => ({
      kind: SEND_KINDS.includes(x.kind) ? x.kind : 'company',
      company: String(x.company ?? ''), role: String(x.role ?? ''), date: String(x.date ?? ''),
    }));
    out.push({ id: s.id, at: String(s.at ?? ''), ...(typeof s.label === 'string' && s.label ? { label: s.label } : {}), sends,
      recipe: migratePins(clone(s.recipe)), body: clone(s.body) });
  }
  return out;
}

// Compares strings only.
export function newerWording(model, frozen, recipe){
  if (!frozen) return [];
  const live = resolve(model, recipe).body;
  frozen = asToday(frozen);
  const out = [];
  const walk = (a, b, path) => {
    // a field the body didn't carry when this resume was saved is not a change of wording
    if (a === undefined && b !== undefined) return;
    if (typeof a === 'string' || typeof b === 'string'){
      if (a !== b) out.push({ path: path.join('.'), frozen: a ?? null, live: b ?? null });
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object')
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], [...path, k]);
  };
  for (const k of BODY_KEYS) walk(frozen[k], live[k], [k]);
  return out;
}

// Older saved bodies put a degree's grade in a one-item `courses`; read it as `score` so it isn't news.
function asToday(frozen){
  if (!(frozen?.education ?? []).some(e => Array.isArray(e?.courses) && e.courses.length === 1 && e.score === undefined)) return frozen;
  const f = clone(frozen);
  for (const e of f.education) if (Array.isArray(e?.courses) && e.courses.length === 1 && e.score === undefined){ e.score = e.courses[0]; delete e.courses; }
  return f;
}

// "<Name>.json" (an older resume has no name: "<Company> - <Role>.json"), case as typed, no path characters.
// A file name as one key: composed accents, lower case. macOS and some sync tools write a decomposed "é" (e + accent), a
// keyboard types a composed one; on a Mac's disk those are the same file, on Windows and Linux two. Compare through this.
export const nameKey = s => String(s).normalize('NFC').toLowerCase();

export function resumeFileName(recipe){
  const base = recipe?.name ? recipe.name
    : recipe?.company && recipe?.role ? `${recipe.company} - ${recipe.role}`
    : recipe?.application || recipe?.title || 'Resume';
  // composed first: the cleaning below drops a combining mark, which would split "é" typed as e + accent into "e "
  const clean = String(base).normalize('NFC').replace(/[–—]/g, '-').replace(/&/g, ' and ').replace(/[^\p{L}\p{N} _.,()'-]+/gu, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 100).trim() || 'Resume';
  return `${clean}.json`;
}

// One id per record, made once and kept in meta.resumeBuilder, so a saved file can tell whether it is
// this record's or another's. Old records get theirs the first time the app opens or saves them.
export const newRecordId = () => globalThis.crypto?.randomUUID?.() ?? `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export function ensureRecordId(model){
  if (model && typeof model === 'object' && !model.recordId) model.recordId = newRecordId();
  return model?.recordId ?? null;
}

export function emptyModel(name = ''){
  const m = migrate({
    schema: 'resume-data/3', meta: { owner: name },
    basics: { name, label: '' }, work: [], sections: [], facts: [], variants: [],
  });
  m.requireSource = false;    // opt-in; only a migrated v3 record starts with it on
  return m;
}
