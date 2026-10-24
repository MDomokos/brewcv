// Schema guard for resume-data/4 (/3 and /2 are migrated in memory first). Pure: returns
// { errors, warnings }. The CLI and the app both call it, so they cannot disagree about what is valid.

import { isOmitted, hasBudget, MAX_WEIGHT, PIN_KINDS, offOf, keepOf } from '../../src/recipe.js';
import { detect, load, loadResume, migrate, checkJsonResume, SCHEMA } from '../../src/model/schema.js';
import { BY_NAME as TOKEN, cssValue } from '../../src/model/tokens.js';

const KINDS = new Set(['header', 'prose', 'entries', 'item', 'grid', 'pairs', 'runs']);
const AXES  = new Set(['density', 'market']);
// An unknown language code errors rather than producing a document nobody can read.
const LANGS = new Set(['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu']);   // same list as src/model/schema.js
const DEFAULT_LANG = 'en';
const langOf = x => x?.lang ?? DEFAULT_LANG;
const SLOT_RE = /^[a-z][a-z0-9-]*$/;
const DATE_RE = /^\d{4}(-\d{2})?$/;

const VERSION_N = /^\d+(\.\d+)?$/;
const HEX = /^#[0-9a-f]{6}$/i;
const PHOTO_MAX = 300 * 1024;
const SHAPES = new Set(['rect', 'soft', 'round']);
const dataUrlBytes = u => { const b64 = String(u).split(',')[1] ?? ''; return Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0); };

// `input`: an in-memory record, or a resume-data/2-4 file read through src/model/schema.js first.
// `recipe`: a v3 recipe, an in-memory v4 resume, or a saved resume file.
export function validate(input, recipe = null){
  const errors = [], warnings = [];
  const err  = (where, msg) => errors.push(`${where}: ${msg}`);
  const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
  const cps = s => [...s];
  const isStr = v => typeof v === 'string' && v.length > 0;

  let data = input;
  const kind = detect(input);
  if (kind === 'library'){
    for (const e of checkJsonResume(input)) err('JSON Resume', e);
    try {
      const got = load(input);
      data = got.model;
      for (const w of got.warnings) warn('file', w);
    } catch (e){ err('file', e.message); return { errors, warnings }; }
  } else if (kind === 'library-v3'){
    if (input.schema === 'resume-data/2')
      warn('schema', 'resume-data/2 predates the language axis: it reads with lang defaulting to "en"; saving writes resume-data/4');
    else warn('schema', `${input.schema}: migrated in memory; saving writes ${SCHEMA}`);
    data = migrate(input);
  } else if (data?.schema !== SCHEMA){
    warn('schema', `expected "${SCHEMA}", found ${JSON.stringify(data?.schema)}`);
  }
  if (recipe && detect(recipe) === 'resume'){
    try { recipe = loadResume(recipe).recipe; }
    catch (e){ err('recipe', e.message); recipe = null; }
  }
// A record migrated from v3 keeps the source rule; a new record does not.
  const needSource = data.requireSource !== false;
  if (data.requireSource !== undefined && typeof data.requireSource !== 'boolean')
    err('requireSource', 'must be true or false');

  function ranges(where, list, chars, kind, extra){
    if (!Array.isArray(list)){ err(where, `${kind} is not an array`); return; }
    let prevEnd = -1;
    for (const [n, r] of list.entries()){
      const w = `${where}.${kind}[${n}]`;
      if (!Number.isInteger(r.start) || !Number.isInteger(r.end)){ err(w, 'start/end must be integers'); continue; }
      if (r.start < 0 || r.end > chars.length)
        err(w, `out of bounds: [${r.start}, ${r.end}) against a ${chars.length}-code-point string`);
      if (r.end <= r.start) err(w, `empty or inverted range [${r.start}, ${r.end})`);
      if (r.start < prevEnd) err(w, `overlaps or is out of order: starts at ${r.start}, previous ${kind.slice(0,-1)} ended at ${prevEnd}`);
      prevEnd = Math.max(prevEnd, r.end);
      extra(w, r, chars);
    }
  }

  const variants = Array.isArray(data.variants) ? data.variants : [];
  if (!variants.length) err('variants', 'no variants in the file');

  const byId = new Map();
  for (const [n, v] of variants.entries()){
    const where = `variants[${n}]${v && v.id ? ` (${v.id})` : ''}`;
    if (!isStr(v.id)){ err(where, 'missing id'); continue; }
    if (byId.has(v.id)) err(where, `duplicate variant id: also at variants[${byId.get(v.id).n}]`);
    else byId.set(v.id, { v, n });

    if (typeof v.text !== 'string'){ err(where, 'missing text'); continue; }
    if (needSource && !isStr(v.source)) err(where, 'no source: a variant with no source cannot be exported');
    if (!Array.isArray(v.tags) || !v.tags.length) warn(where, 'no tags');

    const chars = cps(v.text);

    ranges(where, v.marks ?? [], chars, 'marks', (w, m, ch) => {
      if (!isStr(m.slot)) err(w, 'missing slot');
      else if (!SLOT_RE.test(m.slot)) err(w, `slot ${JSON.stringify(m.slot)} is not a slot name: data picks a name, never a colour`);
      if (typeof m.expect !== 'string'){ err(w, 'missing expect: it is the guard, never drop it'); return; }
      const actual = ch.slice(m.start, m.end).join('');
      if (actual !== m.expect)
        err(w, `expect mismatch\n      expect: ${JSON.stringify(m.expect)}\n      actual: ${JSON.stringify(actual)}`);
    });

    ranges(where, v.links ?? [], chars, 'links', (w, l) => {
      if (!isStr(l.href)) err(w, 'missing href');
      else if (!/^(https?:|mailto:|tel:)/.test(l.href)) warn(w, `unusual href scheme: ${l.href}`);
    });

    const m = v.metrics ?? {};
    if (m.chars === undefined) warn(where, 'metrics.chars missing');
    else if (m.chars !== chars.length) err(where, `metrics.chars is ${m.chars}, text is ${chars.length} code points`);
    // `measured` is a render cache only the fitter's planning reads, so a bad entry warns and can be regenerated.
    for (const [k, e] of Object.entries(m.measured ?? {})){
      const w = `${where}.metrics.measured[${JSON.stringify(k)}]`;
      if (!/^[a-z0-9-]+@[a-z0-9-]+$/.test(k)) warn(w, 'key should be {format}@{theme}');
      if (!Number.isInteger(e?.lines) || e.lines < 1) warn(w, 'lines should be a positive integer');
      if (e?.colWidth !== null && !Number.isFinite(e?.colWidth))
        warn(w, 'no colWidth: a stale entry cannot be detected without it');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e?.at ?? '')) warn(w, 'no `at` date');
    }

    // A machine-drafted phrasing must be rewritten before it is sent. The marker is the id, never `note`:
    // `note` is rendered content, and a draft warning kept there printed itself onto the CV.
    if (/-draft(-[a-z0-9]+)*$/.test(v.id) || /-draft-/.test(v.id))
      warn(where, 'is an unreviewed DRAFT phrasing and must not be sent until rewritten');

    if (v.lang === undefined) warn(where, 'no lang: defaulting to "en"; resume-data/3 writes it explicitly');
    else if (typeof v.lang !== 'string' || !LANGS.has(v.lang))
      err(where, `lang ${JSON.stringify(v.lang)} is not one of ${[...LANGS].join(', ')}`);

    if (v.text.includes('⬜')) warn(where, 'text carries a ⬜ placeholder');
  }

  const facts = Array.isArray(data.facts) ? data.facts : [];
  if (!facts.length) err('facts', 'no facts in the file');

  const factIds = new Set(facts.map(f => f?.id).filter(isStr));
  const owner = new Map();
  for (const [n, f] of facts.entries()){
    const where = `facts[${n}]${f && f.id ? ` (${f.id})` : ''}`;
    if (!isStr(f.id)){ err(where, 'missing id'); continue; }
    if (facts.filter(x => x.id === f.id).length > 1) err(where, 'duplicate fact id');
    if (needSource && !isStr(f.source)) err(where, 'no source');
    const axis = f.axis ?? 'density';
    if (!AXES.has(axis)) err(where, `axis ${JSON.stringify(axis)} is not one of ${[...AXES].join(', ')}`);
    if (!Array.isArray(f.variants) || !f.variants.length){ err(where, 'no variants'); continue; }

    for (const vid of f.variants){
      if (!byId.has(vid)) err(where, `references a variant that does not exist: ${vid}`);
      else if (owner.has(vid)) err(where, `variant ${vid} is already claimed by fact ${owner.get(vid)}`);
      else owner.set(vid, f.id);
    }

    // -short must not be longer than -full. Compare inside one language only: a fact with an en
    // and a hu pair has four variants, not two.
    if (axis === 'density'){
      const groups = new Map();
      for (const vid of f.variants){
        const v = byId.get(vid)?.v;
        if (v) (groups.get(langOf(v)) ?? groups.set(langOf(v), []).get(langOf(v))).push(vid);
      }
      for (const [lang, ids] of groups){
        // checked whenever both poles exist, since most facts have more than two phrasings
        const short = ids.find(x => /-short(-[a-z]{2})?$/.test(x));
        const full  = ids.find(x => /-full(-[a-z]{2})?$/.test(x));
        if (!short || !full) continue;
        const sc = byId.get(short).v.metrics?.chars ?? cps(byId.get(short).v.text).length;
        const fc = byId.get(full).v.metrics?.chars ?? cps(byId.get(full).v.text).length;
        if (sc > fc) err(where, `${short} (${sc} chars) is longer than ${full} (${fc}) in ${lang}: a density pair must be named by measured length`);
      }
    }
  }
  for (const vid of byId.keys()) if (!owner.has(vid)) err(`variants (${vid})`, 'belongs to no fact');

  for (const v of variants){
    if (!v.covers){
      if (/-merged(-[a-z0-9-]+)?$/.test(v.id ?? ''))
        warn(`variants (${v.id})`, 'is named -merged but carries no covers: the fitter would print it alongside the facts it silently swallows');
      continue;
    }
    const where = `variants (${v.id}).covers`;
    for (const c of v.covers){
      if (!factIds.has(c)) err(where, `covers a fact that does not exist: ${c}`);
      if (c === owner.get(v.id)) err(where, `covers its own fact ${c}`);
    }
    if (!/-merged(-[a-z0-9-]+)?$/.test(v.id))
      warn(where, `carries covers but its id does not end -merged: a pick should read as a merge without a lookup`);
  }

  const refFact = (where, id) => {
    if (!isStr(id)) err(where, 'expected a fact id');
    else if (!factIds.has(id)) err(where, `references a fact that does not exist: ${id}`);
  };
  const refDate = (where, d, optional = false) => {
    if (d === null || d === undefined){ if (!optional) err(where, 'missing date'); return; }
    if (!DATE_RE.test(d)) err(where, `date ${JSON.stringify(d)} is not YYYY or YYYY-MM`);
  };

  const b = data.basics ?? {};
  for (const k of ['name', 'label']) if (!isStr(b[k])) err(`basics.${k}`, 'missing');
  if (b.display) for (const k of ['name', 'label', 'contact']) refFact(`basics.display.${k}`, b.display[k]);
  if (b.summary) refFact('basics.summary', b.summary);
  for (const [n, p] of (b.profiles ?? []).entries()){
    if (!isStr(p.network)) err(`basics.profiles[${n}].network`, 'missing');
    if (!isStr(p.url)) err(`basics.profiles[${n}].url`, 'missing');
    if (p.fact) refFact(`basics.profiles[${n}].fact`, p.fact);
  }
  const port = b.portrait;
  if (port){
    if (port.state === 'missing'){
      if (port.placeholder !== '\u2B1C')
        warn('basics.portrait', 'a missing portrait should carry the \u2B1C marker so the renderer prints it red');
    } else if (port.state === 'present'){
      if (!isStr(port.src) || !/^data:image\/(png|jpeg|webp);base64,/.test(port.src))
        err('basics.portrait.src', 'a present portrait must be an embedded data: URI: a path would not resolve in the app');
      const { width: pw, height: ph } = port;
      if (!Number.isInteger(pw) || !Number.isInteger(ph)) err('basics.portrait', 'missing width/height');
      else {
        if (Math.abs(pw - ph) > Math.max(2, pw * 0.02))
          warn('basics.portrait', `${pw}\u00D7${ph} is not square: the slot is square and will crop it`);
        if (Math.min(pw, ph) < 264)
          warn('basics.portrait', `${pw}\u00D7${ph} is under 264px; the slot is the gutter (106px on A4, 132px on Letter), so this prints soft at 2x`);
      }
      if (port.bytes > 400000)
        warn('basics.portrait', `${Math.round(port.bytes / 1024)} KB: large for an embedded image, consider re-exporting smaller`);
      if (needSource && !isStr(port.source)) err('basics.portrait.source', 'no source');
      if (isStr(port.src) && dataUrlBytes(port.src) > PHOTO_MAX)
        err('basics.portrait.src', `${Math.round(dataUrlBytes(port.src) / 1024)} KB: a photo is capped at 300 KB`);
    } else {
      err('basics.portrait.state', `unknown state ${JSON.stringify(port.state)}: expected "present" or "missing"`);
    }
  }

  const contactFact = facts.find(f => f.id === b.display?.contact);
  if (contactFact){
    const texts = contactFact.variants.map(x => byId.get(x)?.v.text ?? '');
    for (const [k, hard] of [['email', true], ['phone', true]]){
      if (isStr(b[k]) && !texts.some(t => t.includes(b[k])))
        (hard ? err : warn)(`basics.${k}`, `${JSON.stringify(b[k])} appears in no ${contactFact.id} phrasing`);
    }
    for (const v of contactFact.variants)
      if (!isStr(byId.get(v)?.v.separator)) err(`variants (${v})`, 'a contact phrasing needs a separator so lines can be split back into items');
  }

  const workIds = new Set();
  for (const [n, w] of (data.work ?? []).entries()){
    const where = `work[${n}]${w && w.id ? ` (${w.id})` : ''}`;
    if (!isStr(w.id)){ err(where, 'missing id'); continue; }
    workIds.add(w.id);
    for (const k of ['position', 'name']) if (!isStr(w[k])) err(`${where}.${k}`, 'missing');
    if (needSource && !isStr(w.source)) err(where, 'no source');
    refDate(`${where}.startDate`, w.startDate);
    refDate(`${where}.endDate`, w.endDate, true);
    if (w.startDate && w.endDate && w.endDate < w.startDate)
      err(where, `endDate ${w.endDate} is before startDate ${w.startDate}`);
    for (const k of ['position', 'meta']) refFact(`${where}.display.${k}`, w.display?.[k]);
    if (!Array.isArray(w.highlights) || !w.highlights.length) err(where, 'no highlights');
    for (const h of w.highlights ?? []) refFact(`${where}.highlights`, h);
  }
  // projects and volunteering made into entries print like jobs
  for (const key of ['projects', 'volunteer']) for (const [n, x] of (data[key] ?? []).entries()){
    if (!x || typeof x !== 'object' || !x.display?.position) continue;
    const where = `${key}[${n}]${x.id ? ` (${x.id})` : ''}`;
    if (!isStr(x.id)){ err(where, 'missing id'); continue; }
    if (workIds.has(x.id)) err(where, 'an entry id already used');
    workIds.add(x.id);
    for (const k of ['position', 'meta']) refFact(`${where}.display.${k}`, x.display?.[k]);
    if (!Array.isArray(x.highlights)) err(where, 'highlights must be an array of claim ids');
    for (const h of x.highlights ?? []) refFact(`${where}.highlights`, h);
  }
  if (data.kinds !== undefined){
    if (!Array.isArray(data.kinds) || data.kinds.length > 6) err('kinds', 'expected at most six custom kinds');
    else data.kinds.forEach((k, n) => { if (!isStr(k?.id) || !isStr(k?.name?.en) || !['timeline', 'list'].includes(k?.place)) err(`kinds[${n}]`, 'expected { id, name: { en }, place }'); });
  }

  for (const [n, e] of (data.education ?? []).entries()){
    const where = `education[${n}]`;
    for (const k of ['institution', 'studyType', 'area']) if (!isStr(e[k])) err(`${where}.${k}`, 'missing');
    refDate(`${where}.endDate`, e.endDate, true);
    for (const k of Object.keys(e.display ?? {})) refFact(`${where}.display.${k}`, e.display[k]);
  }
  for (const [n, p] of (data.publications ?? []).entries()){
    const where = `publications[${n}]`;
    if (!isStr(p.name)) err(`${where}.name`, 'missing');
    refDate(`${where}.releaseDate`, p.releaseDate, true);
    for (const k of Object.keys(p.display ?? {})) refFact(`${where}.display.${k}`, p.display[k]);
  }
  for (const [n, s] of (data.skills ?? []).entries()){
    const where = `skills[${n}]${s && s.id ? ` (${s.id})` : ''}`;
    refFact(where, s.id);
    if (!isStr(s.name)) err(`${where}.name`, 'missing');
    if (!Array.isArray(s.keywords) || !s.keywords.length) err(`${where}.keywords`, 'empty: the JSON Resume export needs them');
  }
  for (const [key, field] of [['certificates', 'name'], ['languages', 'language'], ['interests', 'name']])
    for (const [n, x] of (data[key] ?? []).entries()){
      const where = `${key}[${n}]${x && x.id ? ` (${x.id})` : ''}`;
      refFact(where, x.id);
      if (!isStr(x[field])) err(`${where}.${field}`, 'missing');
    }

  // version numbers: at most one dot, unique per fact per language
  for (const f of facts){
    if (!isStr(f?.id) || !Array.isArray(f.variants)) continue;
    const seenN = new Map();
    for (const vid of f.variants){
      const v = byId.get(vid)?.v;
      if (!v) continue;
      const where = `variants (${vid}).n`;
      if (v.n === undefined){ warn(where, 'no version number: migrate() numbers it'); continue; }
      if (typeof v.n !== 'string' || !VERSION_N.test(v.n)){ err(where, `${JSON.stringify(v.n)} is not a version number (2 or 2.5, at most one dot)`); continue; }
      const key = `${langOf(v)} ${v.n}`;
      if (seenN.has(key)) err(where, `v${v.n} (${langOf(v)}) is also ${seenN.get(key)} in fact ${f.id}`);
      else seenN.set(key, vid);
    }
    // numbers a delete retired are never reused
    if (f.retired !== undefined){
      if (!f.retired || typeof f.retired !== 'object' || Array.isArray(f.retired)) err(`facts (${f.id}).retired`, 'expected { lang: ["2.1", …] }');
      else for (const [lang, list] of Object.entries(f.retired)){
        if (!LANGS.has(lang)) err(`facts (${f.id}).retired`, `lang ${JSON.stringify(lang)} is not one of ${[...LANGS].join(', ')}`);
        else if (!Array.isArray(list) || list.some(n => typeof n !== 'string' || !VERSION_N.test(n))) err(`facts (${f.id}).retired.${lang}`, 'expected version numbers');
        else for (const n of list) if (seenN.has(`${lang} ${n}`)) err(`facts (${f.id}).retired.${lang}`, `v${n} is retired but ${seenN.get(`${lang} ${n}`)} still has it`);
      }
    }
    if (f.default !== undefined){
      if (!f.default || typeof f.default !== 'object' || Array.isArray(f.default)){ err(`facts (${f.id}).default`, 'expected { lang: variantId }'); continue; }
      for (const [lang, vid] of Object.entries(f.default)){
        const v = byId.get(vid)?.v;
        if (!LANGS.has(lang)) err(`facts (${f.id}).default`, `lang ${JSON.stringify(lang)} is not one of ${[...LANGS].join(', ')}`);
        else if (!v || !f.variants.includes(vid)) err(`facts (${f.id}).default.${lang}`, `${JSON.stringify(vid)} is not one of its versions`);
        else if (langOf(v) !== lang) err(`facts (${f.id}).default.${lang}`, `${vid} is lang "${langOf(v)}"`);
      }
    }
  }
  if (data.jobTypes !== undefined){
    // a string (the old form: one tag) or { id, label, tags }
    if (!Array.isArray(data.jobTypes)) err('jobTypes', 'expected an array');
    else {
      const ids = [];
      data.jobTypes.forEach((j, n) => {
        if (isStr(j)){ ids.push(j); return; }
        if (!j || typeof j !== 'object' || Array.isArray(j) || !isStr(j.id)){ err(`jobTypes[${n}]`, 'expected a non-empty string or { id, label, tags }'); return; }
        ids.push(j.id);
        if (j.label !== undefined && !isStr(j.label)) err(`jobTypes[${n}].label`, 'expected a non-empty string');
        if (!Array.isArray(j.tags) || j.tags.some(x => !isStr(x))) err(`jobTypes[${n}].tags`, 'expected an array of non-empty strings');
      });
      if (new Set(ids).size !== ids.length) warn('jobTypes', 'has duplicates');
    }
  }
  for (const k of ['same']){
    const list = data[k];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.some(x => !isStr(x))) err(k, 'expected an array of non-empty strings');
    else if (new Set(list).size !== list.length) warn(k, 'has duplicates');
  }
  if (data.langs !== undefined){
    if (!Array.isArray(data.langs) || !data.langs.length) err('langs', 'expected a non-empty array of languages');
    else data.langs.forEach((l, n) => { if (!LANGS.has(l)) err(`langs[${n}]`, `lang ${JSON.stringify(l)} is not one of ${[...LANGS].join(', ')}`); });
  }
  if (data.themes !== undefined){
    if (!Array.isArray(data.themes)) err('themes', 'expected an array');
    else data.themes.forEach((t, n) => {
      if (!isStr(t?.id) || !isStr(t?.name) || !t.tokens || typeof t.tokens !== 'object'){ err(`themes[${n}]`, 'expected { id, name, tokens }'); return; }
      // the token whitelist holds on load as well as on import
      for (const [k, v] of Object.entries(t.tokens)){
        const tok = TOKEN.get(k);
        if (!tok) err(`themes[${n}].tokens.${k}`, 'not a theme token');
        else if (tok.css.length && cssValue(tok.type, v) === null) err(`themes[${n}].tokens.${k}`, `${JSON.stringify(v)} is not a safe ${tok.type} value`);
      }
    });
  }
  for (const [lang, block] of Object.entries(data.i18n ?? {}))
    if (!LANGS.has(lang)) err(`i18n.${lang}`, `lang is not one of ${[...LANGS].join(', ')}`);
    else if (block?.fields !== undefined && (typeof block.fields !== 'object' || Object.values(block.fields).some(x => typeof x !== 'string')))
      err(`i18n.${lang}.fields`, 'expected { "path": "text" }');
  if (b.image !== undefined){
    if (!isStr(b.image)) err('basics.image', 'must be a string');
    else if (/^data:/.test(b.image) && dataUrlBytes(b.image) > PHOTO_MAX)
      err('basics.image', `${Math.round(dataUrlBytes(b.image) / 1024)} KB: a photo is capped at 300 KB`);
  }
  for (const [n, p] of (b.altPortraits ?? []).entries())
    if (isStr(p?.src) && dataUrlBytes(p.src) > PHOTO_MAX)
      err(`basics.altPortraits[${n}].src`, `${Math.round(dataUrlBytes(p.src) / 1024)} KB: a photo is capped at 300 KB`);

  const sections = Array.isArray(data.sections) ? data.sections : [];
  if (!sections.length) err('sections', 'no sections in the file');
  const seen = new Set();
  for (const [n, s] of sections.entries()){
    const where = `sections[${n}]${s && s.id ? ` (${s.id})` : ''}`;
    if (!isStr(s.id)){ err(where, 'missing id'); continue; }
    if (seen.has(s.id)) err(where, 'duplicate section id');
    seen.add(s.id);
    if (!KINDS.has(s.kind)){ err(where, `kind ${JSON.stringify(s.kind)} is not one of ${[...KINDS].join(', ')}`); continue; }
    if (s.kind !== 'header' && !isStr(s.title)) err(where, 'missing title: it is the tab label');
    const c = s.content ?? {};
    switch (s.kind){
      case 'header': if (!data.basics) err(where, 'a header section needs a basics block'); break;
      case 'prose':  refFact(`${where}.content.fact`, c.fact); break;
      case 'entries':
        if (!(c.work ?? []).length && !s.off) err(`${where}.content.work`, 'expected a non-empty array of work ids');
        for (const w of c.work ?? []) if (!workIds.has(w)) err(`${where}.content.work`, `no such work entry: ${w}`);
        break;
      case 'grid':
        if (!(c.groups ?? []).length) err(`${where}.content.groups`, 'expected a non-empty array');
        for (const g of c.groups ?? []) refFact(`${where}.content.groups`, g);
        break;
      case 'item':
        refFact(`${where}.content.title`, c.title);
        refFact(`${where}.content.meta`, c.meta);
        if (c.subtitle !== undefined) refFact(`${where}.content.subtitle`, c.subtitle);
        break;
      case 'pairs':
        if (!(c.pairs ?? []).length) err(`${where}.content.pairs`, 'expected a non-empty array');
        for (const p of c.pairs ?? []) refFact(`${where}.content.pairs`, p);
        break;
      case 'runs':
        if (!(c.items ?? []).length && !s.off) err(`${where}.content.items`, 'expected a non-empty array');
        for (const it of c.items ?? []) refFact(`${where}.content.items`, it);
        break;
    }
  }

  const reached = new Set([b.summary, b.display?.name, b.display?.label, b.display?.contact].filter(Boolean));
  for (const w of [...(data.work ?? []), ...(data.projects ?? []), ...(data.volunteer ?? []), ...(data.awards ?? [])]){ if (!w || typeof w !== 'object') continue; Object.values(w.display ?? {}).forEach(v => reached.add(v)); (Array.isArray(w.highlights) ? w.highlights : []).forEach(h => reached.add(h)); }
  for (const key of ['education', 'publications']) for (const x of data[key] ?? []) Object.values(x.display ?? {}).forEach(v => reached.add(v));
  for (const key of ['skills', 'certificates', 'languages', 'interests']) for (const x of data[key] ?? []) reached.add(x.id);
  for (const s of sections) for (const v of Object.values(s.content ?? {})) (Array.isArray(v) ? v : [v]).forEach(x => isStr(x) && factIds.has(x) && reached.add(x));
  for (const id of factIds) if (!reached.has(id)) warn(`facts (${id})`, 'is not referenced by any section, work entry or structured entry: nothing can print it');

  // The language rules need a recipe: a language is chosen once per application, not once per bullet.
  if (recipe){
    const rlang = langOf(recipe);
    if (!LANGS.has(rlang)) err('recipe.lang', `lang ${JSON.stringify(recipe.lang)} is not one of ${[...LANGS].join(', ')}`);

    const byFact = new Map(facts.map(f => [f.id, f]));
    const bySection = new Map(sections.map(s => [s.id, s]));
    const want = new Set();
    const add = id => { if (isStr(id) && byFact.has(id)) want.add(id); };

    add(recipe.summary ?? b.summary);
    add(b.display?.name); add(b.display?.label); add(b.display?.contact);

    // `pages` may re-list sections with a narrower work list; anything listed can print, so take the union.
    const listed = [
      ...(recipe.sections ?? []).map(x => (typeof x === 'string' ? { id: x } : x)),
      ...(recipe.pages ?? []).flat().map(x => (typeof x === 'string' ? { id: x } : x)),
    ];
    const chosen = listed.length ? listed : sections.map(s => ({ id: s.id }));
    const workById = new Map([...(data.work ?? []), ...['projects', 'volunteer'].flatMap(k => (data[k] ?? []).filter(x => x?.display?.position))].map(w => [w.id, w]));

    for (const [n, x] of (recipe.sections ?? []).entries()){
      if (!x || typeof x !== 'object' || x.weight === undefined) continue;
      const w = `recipe.sections[${n}]${x.id ? ` (${x.id})` : ''}.weight`;
      if (!Number.isInteger(x.weight) || x.weight < 0 || x.weight > MAX_WEIGHT)
        err(w, `${JSON.stringify(x.weight)} is not an integer from 0 to ${MAX_WEIGHT}`);
      else if (bySection.has(x.id) && !hasBudget(data, x.id))
        warn(w, 'the header and the summary have no budget, so this weight is ignored');
    }

    const listedFacts = new Set(), coveredFacts = new Set();

    // Same rule as src/render.js: explicit pick, else in the recipe's language a phrasing
    // written for this format, else -base, else the first.
    const chosenIn = fid => {
      if (recipe.overrides?.[fid] !== undefined) return null;
      const want = recipe.picks?.[fid];
      if (want) return byId.get(want)?.v ?? null;
      const vs = (byFact.get(fid)?.variants ?? []).map(x => byId.get(x)?.v).filter(v => v && langOf(v) === rlang);
      return vs.find(v => (v.seenIn ?? []).includes(recipe.format)) ?? vs.find(v => v.id.endsWith('-base')) ?? vs[0] ?? null;
    };

    for (const entry of chosen){
      const sec = bySection.get(entry.id);
      if (!sec) continue;
      if (isOmitted(data, recipe, entry.id)) continue;
      const c = sec.content ?? {};
      if (sec.kind === 'entries'){
        for (const ref of (entry.work ?? c.work ?? [])){
          const wid = typeof ref === 'string' ? ref : ref?.id;
          const w = workById.get(wid);
          if (!w){ err(`recipe work ${JSON.stringify(wid)}`, 'no such work entry'); continue; }
          add(w.display?.position); add(w.display?.meta);
          const ids = (typeof ref === 'string' ? null : ref.highlights) ?? w.highlights ?? [];
          for (const h of ids) if (!(w.highlights ?? []).includes(h))
            err(`recipe work ${wid}`, `asks for ${h}, which is not one of its highlights`);
          // a fact covered by a printing -merged phrasing never prints itself
          const covered = new Set();
          for (const h of ids) for (const cv of chosenIn(h)?.covers ?? []) covered.add(cv);
          for (const h of ids) if (!covered.has(h)) add(h);
          ids.forEach(h => listedFacts.add(h));
          covered.forEach(c => coveredFacts.add(c));
        }
      } else {
        for (const v of Object.values(c)) (Array.isArray(v) ? v : [v]).forEach(add);
      }
    }

    // the resume's own fields: all optional, so a v3 recipe still validates
    if (recipe.pageLimit !== undefined){
      if (![0, 1, 2].includes(recipe.pageLimit)) err('recipe.pageLimit', `${JSON.stringify(recipe.pageLimit)} is not 0, 1 or 2 (0 = as many as needed)`);
      else if (Array.isArray(recipe.pages) && recipe.pageLimit !== 0 && recipe.pageLimit !== recipe.pages.length)
        warn('recipe.pageLimit', `is ${recipe.pageLimit}, but the manual layout in \`pages\` has ${recipe.pages.length}: \`pages\` wins while it is there`);
    }
    for (const [n, x] of (recipe.sections ?? []).entries()){
      if (!x || typeof x !== 'object' || x.label === undefined) continue;
      const w = `recipe.sections[${n}]${x.id ? ` (${x.id})` : ''}.label`;
      const sec = bySection.get(x.id);
      if (sec?.kind === 'header') err(w, 'the header has no heading to rename');
      const labels = typeof x.label === 'string' ? [x.label] : (x.label && typeof x.label === 'object' ? Object.values(x.label) : [null]);
      if (labels.some(l => typeof l !== 'string' || !l.trim())) err(w, 'must be a non-empty string, or { lang: non-empty string }');
    }
    for (const k of ['name', 'company', 'role', 'jobType'])
      if (recipe[k] !== undefined && typeof recipe[k] !== 'string') err(`recipe.${k}`, 'must be a string');
    if (recipe.forKind !== undefined && !['company', 'outreach'].includes(recipe.forKind)) err('recipe.forKind', 'must be "company" or "outreach"');
    if (recipe.tags !== undefined && (!Array.isArray(recipe.tags) || recipe.tags.some(t => !isStr(t)))) err('recipe.tags', 'expected an array of strings');
    if (recipe.accent !== undefined && !HEX.test(recipe.accent ?? '')) err('recipe.accent', `${JSON.stringify(recipe.accent)} is not a #rrggbb colour`);
    if (recipe.photo !== undefined){
      const ph = recipe.photo;
      if (!ph || typeof ph !== 'object' || typeof ph.show !== 'boolean') err('recipe.photo', 'expected { show: true|false, shape }');
      else if (ph.shape !== undefined && !SHAPES.has(ph.shape)) err('recipe.photo.shape', `${JSON.stringify(ph.shape)} is not one of ${[...SHAPES].join(', ')}`);
      else if (ph.show && !b.image && b.portrait?.state !== 'present') warn('recipe.photo', 'shows a photo, but the record has none');
    }
    if (recipe.savedAt != null && !/^\d{4}-\d{2}-\d{2}/.test(recipe.savedAt)) err('recipe.savedAt', 'expected an ISO date');

    for (const [factId, vid] of Object.entries(recipe.picks ?? {})){
      const where = `recipe.picks[${JSON.stringify(factId)}]`;
      const v = byId.get(vid)?.v;
      if (!v){ err(where, `picks ${vid}, which does not exist`); continue; }
      const vlang = langOf(v);
      // a language copy kept in step (inStep) keeps the original's version where its language has none at that number: the line is missing there
      const missingHere = recipe.inStep === true && !(byFact.get(factId)?.variants ?? []).some(x => { const w = byId.get(x)?.v; return langOf(w) === rlang && String(w.n) === String(v.n); });
      if (vlang !== rlang && !missingHere)
        err(where, `picks ${vid}, which is lang "${vlang}", in a lang "${rlang}" recipe: language is chosen once per application, not once per bullet`);
    }

    for (const id of want){
      const f = byFact.get(id);
      const has = (f.variants ?? []).some(vid => langOf(byId.get(vid)?.v) === rlang);
      // A missing phrasing prints in English, so it warns. Facts marked "same in every language" are exempt.
      if (!has && !(data.same ?? []).includes(`fact:${id}`)){
        const got = [...new Set((f.variants ?? []).map(vid => langOf(byId.get(vid)?.v)))].join(', ');
        warn(`facts (${id})`, `no "${rlang}" phrasing, but a lang "${rlang}" recipe reaches it: it prints in English (has ${got || 'none'})`);
      }
    }

    // `pins` is the older form of `off` and `keep` (src/recipe.js): shape-checked here, read through
    // offOf / keepOf like any other, and rewritten by migrateRecipe().
    const pins = recipe.pins;
    if (pins !== undefined){
      if (pins === null || typeof pins !== 'object' || Array.isArray(pins))
        err('recipe.pins', `expected an object with ${PIN_KINDS.join(' / ')} lists`);
      else {
        warn('recipe.pins', 'is the 0.4.0 name; it reads as off (exclude) and keep (include, phrasing), and saving writes those');
        for (const k of Object.keys(pins))
          if (!PIN_KINDS.includes(k)) warn(`recipe.pins.${k}`, `not a pin kind (${PIN_KINDS.join(', ')}): ignored`);
        for (const kind of PIN_KINDS){
          const list = pins[kind];
          if (list === undefined) continue;
          if (!Array.isArray(list)){ err(`recipe.pins.${kind}`, 'expected an array of fact ids'); continue; }
          const dup = new Set();
          for (const id of list){
            if (!isStr(id) || !byFact.has(id)) err(`recipe.pins.${kind}`, `${JSON.stringify(id)} is not a fact`);
            else if (dup.has(id)) warn(`recipe.pins.${kind}`, `${id} is listed twice`);
            dup.add(id);
          }
        }
        const inc = new Set(Array.isArray(pins.include) ? pins.include : []);
        for (const id of Array.isArray(pins.exclude) ? pins.exclude : [])
          if (inc.has(id)) err('recipe.pins', `${id} is pinned both in and out`);
      }
    }
    // localLines: lines that exist only on this resume, { jobId: [{ id, after }] }; their text is in overrides
    const local = new Set();
    if (recipe.localLines !== undefined){
      if (!recipe.localLines || typeof recipe.localLines !== 'object' || Array.isArray(recipe.localLines)) err('recipe.localLines', 'expected an object of job ids');
      else for (const [job, lines] of Object.entries(recipe.localLines)){
        if (!workIds.has(job)) err(`recipe.localLines.${job}`, 'no such work entry');
        if (!Array.isArray(lines)){ err(`recipe.localLines.${job}`, 'expected an array of { id, after }'); continue; }
        for (const l of lines){
          if (!isStr(l?.id) || byFact.has(l.id) || local.has(l.id)) err(`recipe.localLines.${job}`, `${JSON.stringify(l?.id)} is not a new id`);
          else local.add(l.id);
          if (l?.after != null && !isStr(l.after)) err(`recipe.localLines.${job}`, 'after must be an id or null');
          else if (l?.after != null && !((data.work ?? []).find(w => w?.id === job)?.highlights ?? []).includes(l.after) && !lines.some(x => x?.id === l.after)) err(`recipe.localLines.${job}`, `${l.id} follows ${l.after}, which is not a line of the job`);
        }
      }
    }
    for (const k of ['off', 'keep']){
      const list = recipe[k];
      if (list === undefined) continue;
      if (pins !== undefined) warn(`recipe.${k}`, 'is set beside the old `pins`; `' + k + '` wins');
      if (!Array.isArray(list)){ err(`recipe.${k}`, 'expected an array of fact ids'); continue; }
      const dup = new Set();
      for (const id of list){
        if (!isStr(id) || !(byFact.has(id) || (k === 'off' && local.has(id)))) err(`recipe.${k}`, `${JSON.stringify(id)} is not a fact`);
        else if (dup.has(id)) warn(`recipe.${k}`, `${id} is listed twice`);
        dup.add(id);
      }
    }
    if (pins === undefined || (pins && typeof pins === 'object' && !Array.isArray(pins))){
      const off = new Set(offOf(recipe).filter(id => byFact.has(id)));
      const keepIn = keepOf(recipe).filter(id => byFact.has(id) && !off.has(id));
      const prints = new Set([...want, ...listedFacts]);
      for (const id of keepIn)
        if (!prints.has(id) && !coveredFacts.has(id))
          warn(recipe.keep ? 'recipe.keep' : 'recipe.pins.include', `${id} is kept on, but no job or section in this recipe reaches it`);
      for (const id of off){
        const where = recipe.off ? 'recipe.off' : 'recipe.pins.exclude';
        if (coveredFacts.has(id)) warn(where, `${id} is off, but a merged phrasing this recipe prints still says it`);
        else if (want.has(id)) warn(where, `${id} is off, but this recipe still prints it`);
      }
    }

    if (recipe.look !== undefined && !(data.themes ?? []).some(t => t.id === recipe.look)) err('recipe.look', `${JSON.stringify(recipe.look)} is not one of this record’s themes`);

    // byLang: picks, one-off texts and holds put aside for other languages
    if (recipe.byLang !== undefined){
      if (!recipe.byLang || typeof recipe.byLang !== 'object' || Array.isArray(recipe.byLang)) err('recipe.byLang', 'expected { lang: { picks, overrides, held } }');
      else for (const [l, o] of Object.entries(recipe.byLang)){
        if (!LANGS.has(l)) err(`recipe.byLang.${l}`, `lang is not one of ${[...LANGS].join(', ')}`);
        else if (l === rlang) warn(`recipe.byLang.${l}`, 'is the resume’s own language; it is ignored');
        for (const [fid, vid] of Object.entries(o?.picks ?? {})){
          const v = byId.get(vid)?.v;
          if (!v || !byFact.get(fid)?.variants.includes(vid)) warn(`recipe.byLang.${l}.picks`, `${fid} → ${vid} is not one of its versions any more`);
          else if (langOf(v) !== l) err(`recipe.byLang.${l}.picks`, `${vid} is lang "${langOf(v)}"`);
        }
      }
    }

    // held: one-off texts that hold a saved resume's frozen wording
    if (recipe.held !== undefined){
      if (!Array.isArray(recipe.held) || recipe.held.some(id => !isStr(id))) err('recipe.held', 'expected an array of fact ids');
      else for (const id of recipe.held) if (recipe.overrides?.[id] === undefined) warn('recipe.held', `${id} is held, but has no text in overrides`);
    }

    for (const [factId, text] of Object.entries(recipe.overrides ?? {}))
      if (!byFact.has(factId) && !local.has(factId)) err(`recipe.overrides[${JSON.stringify(factId)}]`, 'overrides a fact that does not exist');
      else if (typeof text !== 'string' || (!text && !local.has(factId))) err(`recipe.overrides[${JSON.stringify(factId)}]`, 'empty override');
  }

  return { errors, warnings };
}
