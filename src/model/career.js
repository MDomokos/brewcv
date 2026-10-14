// The Career workspace's model: About you, the Timeline, Skills & credentials. Pure: no DOM.
// Non-English facts go in i18n.<lang> fields, labels and terms. Employers, institutions and dates are shared.

import { keyed } from '../i18n/index.js';
import { defaultVariant, DEFAULT_LANG, sectionOfEntry } from './resume.js';
import { saveOver, addVersion, RecordError } from './record.js';
import { fmtMonth, ym, addJob, addBullet, addFact, slug, metaLineOf, presentIn, contactText, SEP } from './build.js';
import { entriesOf, isEntry, entryKey, isArchived } from './entries.js';
import { jobTypesOf, normaliseJobType, tagVocab, TAG_CAP } from './focus.js';

const now = () => new Date().toISOString().slice(0, 7);
const months = (a, b) => {
  const [y1, m1] = String(a).split('-').map(Number), [y2, m2] = String(b).split('-').map(Number);
  if (!y1 || !y2) return 0;
  return (y2 - y1) * 12 + ((m2 || 12) - (m1 || 1)) + 1;
};
export function duration(start, end){
  const n = months(start, end ?? now());
  if (n <= 0) return '';
  const y = Math.floor(n / 12), m = n % 12;
  return [y ? `${y} yr${y === 1 ? '' : 's'}` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ');
}

const textIn = (model, id, lang) => (id ? defaultVariant(model, id, lang)?.text ?? '' : '');
const hasIn = (model, id, lang) => { const v = id ? defaultVariant(model, id, lang) : null; return !!v && (v.lang ?? DEFAULT_LANG) === lang; };
const isSame = (model, factId) => (model.same ?? []).includes(`fact:${factId}`);
function setSameFact(model, factId, on){
  const s = new Set(model.same ?? []);
  if (on) s.add(`fact:${factId}`); else s.delete(`fact:${factId}`);
  model.same = [...s];
}
const factIds = model => new Set([...(model.facts ?? []).map(f => f.id), ...(model.work ?? []).map(w => w.id), ...(model.sections ?? []).map(s => s.id)]);
export const fieldPath = (key, id, field) => `${key}/${id}/${field}`;
export function fieldIn(model, lang, path, fallback = ''){
  if (lang === DEFAULT_LANG) return fallback;
  return model.i18n?.[lang]?.fields?.[path] ?? '';
}
function setField(model, lang, path, value){
  model.i18n ??= {}; model.i18n[lang] ??= {};
  const f = (model.i18n[lang].fields ??= {});
  const v = String(value ?? '').trim();
  if (v) f[path] = v; else delete f[path];
}
// A printed text follows a fact edit unless reworded by hand. No version in the language yet: v1.
function follow(model, factId, lang, oldText, newText){
  if (!factId || newText === oldText || !String(newText ?? '').trim()) return null;
  if (!(model.facts ?? []).some(f => f.id === factId)) return null;
  const v = defaultVariant(model, factId, lang);
  if (!v || (v.lang ?? DEFAULT_LANG) !== lang){ addVersion(model, factId, { text: newText, lang, as: 'major' }); return 'created'; }
  if (v.text === oldText){ saveOver(model, v.id, newText); return 'followed'; }
  return 'kept';
}

// The timeline is only what you'd write bullets under.
export const TIMELINE_KINDS = ['work', 'education', 'project'];
// in display order
export const LIST_GROUPS = ['skills', 'languages', 'certificates', 'publications', 'interests', 'references'];
export const LEVELS = ['Native', 'C2', 'C1', 'B2', 'B1', 'A2', 'A1'];
export const MAX_KINDS = 6;
export const KIND_ICONS = ['heart', 'frame', 'star', 'flag', 'mic', 'pin', 'dot'];
export const KIND_PRESETS = {
  volunteering: { name: { en: 'Volunteering' }, icon: 'heart', colour: 0, place: 'timeline', org: 'Organisation', claims: true, store: 'volunteer' },
  awards: { name: { en: 'Awards' }, icon: 'star', colour: 3, place: 'list', org: 'Awarded by', claims: false, store: 'awards' },
  talks: { name: { en: 'Talks' }, icon: 'mic', colour: 4, place: 'list', org: 'Event', claims: false, store: 'projects' },
  blank: { name: { en: '' }, icon: 'dot', colour: 5, place: 'timeline', org: 'Organisation', claims: true, store: 'projects' },
};
export const kindsOf = model => model?.kinds ?? [];
export const kindOf = (model, id) => kindsOf(model).find(k => k.id === id) ?? null;
export const kindName = (model, id, lang) => { const k = kindOf(model, id); return k ? (k.name?.[lang] || k.name?.en || id) : id; };
const storeOf = k => (k.store === 'volunteer' ? 'volunteer' : k.store === 'awards' ? 'awards' : 'projects');

function kindOfEntry(model, key, x){
  if (key === 'work' || key === 'education') return key;
  if (key === 'volunteer') return kindsOf(model).find(k => k.store === 'volunteer')?.id ?? 'volunteering';
  if (key === 'awards') return kindsOf(model).find(k => k.store === 'awards')?.id ?? 'awards';
  if (key === 'projects') return x.type && kindOf(model, x.type) ? x.type : 'project';
  return key;
}
export const placeOf = (model, kind) => (TIMELINE_KINDS.includes(kind) ? 'timeline' : kindOf(model, kind)?.place ?? 'list');

export function entryView(model, key, x, lang = DEFAULT_LANG){
  const kind = kindOfEntry(model, key, x);
  const L = lang;
  let title = '', titleEn = '', org = '', place = '', start = '', end = null, posFact = null;
  if (key === 'work'){
    posFact = x.display?.position; titleEn = textIn(model, posFact, DEFAULT_LANG) || x.position;
    title = L === DEFAULT_LANG ? titleEn : (hasIn(model, posFact, L) ? textIn(model, posFact, L) : '') || fieldIn(model, L, fieldPath('work', x.id, 'position'));
    org = x.name ?? ''; place = (L !== DEFAULT_LANG && fieldIn(model, L, fieldPath('work', x.id, 'location'))) || x.location || '';
    start = x.startDate ?? ''; end = x.endDate ?? null;
  } else if (key === 'education'){
    posFact = x.display?.studyType;
    titleEn = (posFact && textIn(model, posFact, DEFAULT_LANG)) || [x.studyType, x.area].filter(v => v && v !== '—').join(' ');
    title = L === DEFAULT_LANG ? titleEn : (hasIn(model, posFact, L) ? textIn(model, posFact, L) : '') || fieldIn(model, L, fieldPath('education', x.id, 'studyType'));
    org = x.institution ?? ''; place = x.location ?? '';
    start = x.startDate ?? x.endDate ?? ''; end = x.endDate ?? null;
  } else {
    posFact = x.display?.position ?? x.display?.run ?? null;
    const nameKey = key === 'volunteer' ? 'position' : key === 'awards' ? 'title' : 'name';
    titleEn = x[nameKey] || (posFact && textIn(model, posFact, DEFAULT_LANG)) || '';
    title = L === DEFAULT_LANG ? titleEn : fieldIn(model, L, fieldPath(key, x.id, nameKey)) || (x.display?.position && hasIn(model, posFact, L) ? textIn(model, posFact, L) : '');
    org = (key === 'volunteer' ? x.organization : key === 'awards' ? x.awarder : x.entity) ?? '';
    place = x.location ?? '';
    start = x.startDate ?? x.date ?? ''; end = key === 'awards' ? (x.date ?? null) : x.endDate ?? null;
  }
  const claims = Array.isArray(x.highlights) ? x.highlights.filter(h => typeof h === 'string' && (model.facts ?? []).some(f => f.id === h)) : [];
  const toWrite = L === DEFAULT_LANG ? 0
    : claims.filter(h => !hasIn(model, h, L) && !isSame(model, h)).length + (title ? 0 : 1);
  return { kind, key, id: x.id, archived: !!x.archived, title: title || titleEn, titleMissing: !title, org, place, start, end, claims: claims.length, claimIds: claims, toWrite, during: x.during ?? null, posFact };
}

// Timeline
// Work in `main`, the rest in `side`, newest first. A band is the year an entry ended; still running is year null.
export function timelineLayout(model, { lang = DEFAULT_LANG, hideArchived = false } = {}){
  const out = [];
  for (const w of model.work ?? []) if (!(hideArchived && w.archived)) out.push(entryView(model, 'work', w, lang));
  (model.education ?? []).forEach((e, i) => { if (e?.institution || e?.studyType) out.push(entryView(model, 'education', { ...e, id: e.id ?? `edu-${i}` }, lang)); });
  for (const k of ['projects', 'volunteer']) for (const x of model[k] ?? []){
    if (!x?.id || (hideArchived && x.archived)) continue;
    const v = entryView(model, k, x, lang);
    if (placeOf(model, v.kind) === 'timeline') out.push(v);
  }
  const key = x => (x.end ? String(x.end).slice(0, 7) : '9999');
  out.sort((a, b) => key(b).localeCompare(key(a)) || String(b.start).localeCompare(String(a.start)));
  const bands = [];
  for (const x of out){
    const year = x.end ? String(x.end).slice(0, 4) : null;
    let b = bands.at(-1);
    if (!b || b.year !== year){ b = { year, main: [], side: [] }; bands.push(b); }
    (x.kind === 'work' ? b.main : b.side).push(x);
  }
  return { bands, entries: out };
}

export function timeline(model){
  return timelineLayout(model).entries.map(x => ({ ...x, kind: x.kind === 'work' ? 'job' : x.kind }));
}

export function recordLists(model, { lang = DEFAULT_LANG } = {}){
  const L = lang;
  const groups = [];
  groups.push({ group: 'skills', items: (model.skills ?? []).map(s => {
    const name = L === DEFAULT_LANG ? s.name : model.i18n?.[L]?.labels?.[s.id] ?? '';
    return { id: s.id, title: name || s.name, titleMissing: !name, sub: (s.keywords ?? []).join(', ') };
  }) });
  groups.push({ group: 'languages', items: (model.languages ?? []).map(l => {
    const name = L === DEFAULT_LANG ? l.language : model.i18n?.[L]?.terms?.[l.id] ?? '';
    return { id: l.id, title: name || l.language, titleMissing: !name, right: l.fluency ?? '' };
  }) });
  groups.push({ group: 'certificates', items: (model.certificates ?? []).map(c => ({ id: c.id, title: c.name, sub: c.issuer ?? '', right: String(c.date ?? '').slice(0, 4) })) });
  groups.push({ group: 'publications', items: (model.publications ?? []).map(p => {
    const t = hasIn(model, p.display?.name, L) ? textIn(model, p.display?.name, L) : '';
    return { id: p.id, title: t || p.name, titleMissing: L !== DEFAULT_LANG && !!p.display?.name && !t, sub: [p.publisher, p.identifier].filter(Boolean).join(' · '), right: String(p.releaseDate ?? '').slice(0, 4) };
  }) });
  for (const k of kindsOf(model).filter(k => k.place === 'list')){
    const store = storeOf(k);
    const items = (model[store] ?? []).filter(x => x?.id && (store === 'awards' || x.type === k.id)).map(x => {
      const v = entryView(model, store, x, L);
      return { id: x.id, title: v.title, titleMissing: v.titleMissing, sub: v.org, right: String(v.start ?? '').slice(0, 4) };
    });
    groups.push({ group: k.id, kind: k.id, items });
  }
  groups.push({ group: 'interests', items: (model.interests ?? []).map(i => {
    const t = hasIn(model, i.id, L) ? textIn(model, i.id, L) : '';
    return { id: i.id, title: t || i.name, titleMissing: L !== DEFAULT_LANG && !t && !isSame(model, i.id) };
  }) });
  // a reference: the person's name, and what they'd say as a text with versions
  groups.push({ group: 'references', items: (model.references ?? []).filter(r => r?.id).map(r => {
    const t = hasIn(model, r.id, L) ? textIn(model, r.id, L) : '';
    return { id: r.id, title: r.name || '—', sub: t || r.reference || '', titleMissing: false };
  }) });
  return groups;
}

export function sectionFor(model, what, id = null){
  if (what === 'work' || what === 'project' || kindOf(model, what)?.place === 'timeline') return id ? sectionOfEntry(model, id) : what === 'work' ? 'experience' : 'projects';
  const facts = id ? factsOfItem(model, what, id) : [];
  const s = facts.length ? (model.sections ?? []).find(x => JSON.stringify(x.content ?? {}).includes(`"${facts[0]}"`)) : null;
  if (s) return s.id;
  const k = kindOf(model, what);
  if (k) return k.section;
  return { education: 'education', skills: 'skills', languages: 'languages', certificates: 'certified', publications: 'patent', interests: 'interests', references: 'references', about: 'header', summary: 'summary' }[what] ?? what;
}
function factsOfItem(model, what, id){
  if (what === 'education'){ const e = (model.education ?? []).find(x => x.id === id); return Object.values(e?.display ?? {}); }
  if (what === 'publications'){ const p = (model.publications ?? []).find(x => x.id === id); return Object.values(p?.display ?? {}); }
  return [id];
}

// Skills and the rest never block readiness.
export function stepsReady(model){
  const b = model.basics ?? {};
  const head = id => String(textIn(model, b.display?.[id], DEFAULT_LANG) ?? '').trim();
  const about = !!(String(b.name ?? '').trim() && head('label') && (b.email || b.phone) && b.summary && textIn(model, b.summary, DEFAULT_LANG).trim());
  const timeline = (model.work ?? []).some(w => (w.highlights ?? []).length >= 3) && ((model.education ?? []).length > 0 || !!model.noEducation);
  const more = (model.skills ?? []).length > 0;
  return { about, timeline, more, record: about && timeline };
}

// Editing
export const metaLine = (fields, lang = DEFAULT_LANG) => metaLineOf(fields, lang);

// Returns what happened to the printed title and meta line: 'followed', 'kept', 'created' or null.
export function updateJob(model, id, fields, lang = DEFAULT_LANG){
  const w = (model.work ?? []).find(x => x.id === id);
  if (!w) throw new Error(`no such job: ${id}`);
  const L = lang;
  const before = { ...w };
  const placeIn = (x, l) => (l === DEFAULT_LANG ? x.location ?? '' : fieldIn(model, l, fieldPath('work', id, 'location')));
  const beforePlace = {};
  for (const l of new Set([DEFAULT_LANG, L, ...Object.keys(model.i18n ?? {})])) beforePlace[l] = placeIn(before, l);
  const res = { title: null, meta: null };
  // the same in every language: employer and dates
  if (fields.name !== undefined) w.name = String(fields.name).trim() || w.name;
  // JSON Resume job fields, the same in every language; only JSON Resume themes print them
  setPlain(w, fields, ['url', 'description', 'summary']);
  if (fields.startDate !== undefined && ym(fields.startDate)) w.startDate = ym(fields.startDate);
  if (fields.endDate !== undefined) w.endDate = ym(fields.endDate) || null;
  if (L === DEFAULT_LANG){
    if (fields.position !== undefined) w.position = String(fields.position).trim() || w.position;
    if (fields.location !== undefined){ const l = String(fields.location).trim(); if (l) w.location = l; else delete w.location; }
    if (w.position !== before.position && w.display?.position){
      const v = defaultVariant(model, w.display.position, DEFAULT_LANG);
      if (v && v.text === before.position){ saveOver(model, v.id, w.position); res.title = 'followed'; } else res.title = 'kept';
    }
  } else {
    const oldTitle = fieldIn(model, L, fieldPath('work', id, 'position')) || (hasIn(model, w.display?.position, L) ? textIn(model, w.display?.position, L) : '');
    if (fields.position !== undefined && String(fields.position).trim()){
      setField(model, L, fieldPath('work', id, 'position'), fields.position);
      res.title = follow(model, w.display?.position, L, oldTitle, String(fields.position).trim());
    }
    if (fields.location !== undefined) setField(model, L, fieldPath('work', id, 'location'), fields.location);
  }
  // meta lines in every language, since employer and dates are shared
  const metaFact = w.display?.meta;
  if (metaFact){
    const f = (model.facts ?? []).find(x => x.id === metaFact);
    const has = new Set((model.variants ?? []).filter(v => f?.variants.includes(v.id)).map(v => v.lang ?? DEFAULT_LANG));
    for (const l of new Set([...has, L])){
      const b = { name: before.name, startDate: before.startDate, endDate: before.endDate, location: beforePlace[l] ?? '' };
      const a = { name: w.name, startDate: w.startDate, endDate: w.endDate, location: placeIn(w, l) };
      const oldText = metaLineOf(b, l), newText = metaLineOf(a, l);
      let r = null;
      if (!has.has(l)){ if (l === L && L !== DEFAULT_LANG){ addVersion(model, metaFact, { text: newText, lang: l, as: 'major' }); r = 'created'; } }
      else if (oldText !== newText){
        const v = defaultVariant(model, metaFact, l);
        if (v && v.text === oldText){ saveOver(model, v.id, newText); r = 'followed'; } else r = 'kept';
      }
      if (l === L) res.meta = r;
    }
  }
  return res;
}

// Only the degree translates.
export function updateEducation(model, id, fields, lang = DEFAULT_LANG){
  const e = (model.education ?? []).find((x, i) => (x.id ?? `edu-${i}`) === id);
  if (!e) throw new Error(`no such education: ${id}`);
  const before = { ...e };
  const res = { title: null, meta: null };
  if (fields.score === undefined && fields.honours !== undefined) fields = { ...fields, score: fields.honours };   // the old name
  for (const k of ['institution', 'score']) if (fields[k] !== undefined){ const v = String(fields[k]).trim(); if (v) e[k] = v; else if (k === 'score') delete e[k]; }
  setPlain(e, fields, ['url']);
  if (fields.courses !== undefined){ const c = listOf(fields.courses); if (c.length) e.courses = c; else delete e.courses; }
  for (const k of ['startDate', 'endDate']) if (fields[k] !== undefined){ const v = ym(fields[k]); if (v) e[k] = v; else delete e[k]; }
  const degree = x => [x.studyType, x.area].filter(v => v && v !== '—').join(' ');
  if (lang === DEFAULT_LANG){
    if (fields.studyType !== undefined) e.studyType = String(fields.studyType).trim() || e.studyType;
    if (fields.area !== undefined) e.area = String(fields.area).trim() || e.area;
    res.title = follow(model, e.display?.studyType, DEFAULT_LANG, degree(before), degree(e));
    follow(model, e.display?.institution, DEFAULT_LANG, before.institution, e.institution);
  } else if (fields.studyType !== undefined && String(fields.studyType).trim()){
    const old = fieldIn(model, lang, fieldPath('education', id, 'studyType')) || (hasIn(model, e.display?.studyType, lang) ? textIn(model, e.display?.studyType, lang) : '');
    setField(model, lang, fieldPath('education', id, 'studyType'), fields.studyType);
    res.title = follow(model, e.display?.studyType, lang, old, String(fields.studyType).trim());
  }
  if (e.display?.meta){
    const meta = (x, l) => [fmtMonth(x.endDate, l).toUpperCase(), String(x.score ?? x.honours ?? '').toUpperCase()].filter(Boolean).join(' · ');
    if (meta(before, lang) !== meta(e, lang)) res.meta = follow(model, e.display.meta, lang, meta(before, lang), meta(e, lang));
  }
  return res;
}

// Plain fields, the same in every language: set when given, removed when empty.
function setPlain(x, fields, keys){
  for (const k of keys) if (fields[k] !== undefined){ const v = String(fields[k] ?? '').trim(); if (v) x[k] = v; else delete x[k]; }
}
// a list typed as "a, b, c" (or already an array)
export const listOf = v => (Array.isArray(v) ? v : String(v ?? '').split(',')).map(x => String(x).trim()).filter(Boolean);

// Projects
// Time-bound work that isn't a job. `during` is a job or degree it ran alongside. Its section starts off.
function ensureEntriesSection(model, id, title, off = true){
  model.sections ??= [];
  let s = model.sections.find(x => x.id === id);
  if (!s){
    s = { id, title, kind: 'entries', ...(off ? { off: true } : {}), content: { work: [] } };
    const at = model.sections.findIndex(x => ['education', 'languages', 'interests'].includes(x.id));
    model.sections.splice(at < 0 ? model.sections.length : at, 0, s);
  }
  return s;
}
// only entries with a claim can print
function syncEntriesSection(model, key, sid, filter = () => true){
  const s = (model.sections ?? []).find(x => x.id === sid);
  if (!s) return;
  const list = (model[key] ?? []).filter(x => isEntry(x) && x.highlights.length && filter(x));
  list.sort((a, b) => String(b.endDate ?? '9999').localeCompare(String(a.endDate ?? '9999')) || String(b.startDate).localeCompare(String(a.startDate)));
  s.content.work = list.map(x => x.id);
}
const syncEntry = (model, x) => {
  const key = entryKey(model, x.id);
  if (key === 'projects'){
    const k = x.type ? kindOf(model, x.type) : null;
    syncEntriesSection(model, 'projects', k ? k.section : 'projects', e => (e.type ?? null) === (x.type ?? null) && (!x.type || !!k));
  } else if (key === 'volunteer'){
    const k = kindsOf(model).find(y => y.store === 'volunteer');
    if (k) syncEntriesSection(model, 'volunteer', k.section);
  }
};
export const projectMeta = ({ entity, startDate, endDate, location }, lang = DEFAULT_LANG) =>
  [entity, startDate ? `${fmtMonth(startDate, lang)} – ${endDate ? fmtMonth(endDate, lang) : presentIn(lang)}` : '', location].filter(x => x && String(x).trim() && String(x).trim() !== '–').join(' · ');
const takenIds = model => { const t = factIds(model); for (const k of ['projects', 'volunteer', 'awards', 'references']) for (const x of model[k] ?? []) if (x?.id) t.add(x.id); return t; };
const alsoIn = (lang, t) => (lang !== DEFAULT_LANG && String(t ?? '').trim() ? { lang, text: t } : null);

export function addProject(model, { name = '', entity = '', startDate = '', endDate = '', url = '', during = null, location = '', bullets = [], type = null, lang = DEFAULT_LANG } = {}){
  const id = slug(name || 'project', takenIds(model), 'project');
  const p = { id, name: String(name).trim() || 'Project', ...(entity ? { entity } : {}), ...(ym(startDate) ? { startDate: ym(startDate) } : {}),
    ...(ym(endDate) ? { endDate: ym(endDate) } : {}), ...(url ? { url } : {}), ...(location ? { location } : {}), ...(type ? { type } : {}),
    ...(during ? { during } : {}), display: { position: `${id}-position`, meta: `${id}-meta` }, highlights: [] };
  addFact(model, `${id}-position`, { text: p.name, summary: 'Project', tags: [], also: alsoIn(lang, name) });
  addFact(model, `${id}-meta`, { text: projectMeta(p) || ' ', summary: 'With whom and when', tags: [], also: alsoIn(lang, projectMeta(p, lang)) });
  (model.projects ??= []).push(p);
  if (!type) ensureEntriesSection(model, 'projects', 'Projects');
  for (const b of (bullets ?? []).map(x => String(x ?? '').trim()).filter(Boolean)) addEntryClaim(model, id, b, lang);
  syncEntry(model, p);
  return id;
}

// Also volunteering and custom-kind entries.
export function updateProject(model, id, fields, lang = DEFAULT_LANG){
  const key = entryKey(model, id) ?? ((model.awards ?? []).some(x => x?.id === id) ? 'awards' : null);
  const p = (model[key] ?? []).find(x => x?.id === id);
  if (!p || key === 'work') throw new Error(`no such entry: ${id}`);
  const before = { ...p };
  const nameKey = key === 'volunteer' ? 'position' : key === 'awards' ? 'title' : 'name';
  const orgKey = key === 'volunteer' ? 'organization' : key === 'awards' ? 'awarder' : 'entity';
  const res = { title: null, meta: null };
  if (fields.org !== undefined){ const v = String(fields.org).trim(); if (v) p[orgKey] = v; else delete p[orgKey]; }
  if (fields.startDate !== undefined){ const v = ym(fields.startDate); const k = key === 'awards' ? 'date' : 'startDate'; if (v) p[k] = v; else delete p[k]; }
  if (fields.endDate !== undefined && key !== 'awards'){ const v = ym(fields.endDate); if (v) p.endDate = v; else delete p.endDate; }
  if (fields.url !== undefined){ const v = String(fields.url).trim(); if (v) p.url = v; else delete p.url; }
  if (fields.during !== undefined){ if (fields.during) p.during = fields.during; else delete p.during; }
  // a few words about it: JSON Resume calls it `description` on a project and
  // `summary` on volunteering and an award
  if (fields.description !== undefined) setPlain(p, { [key === 'projects' ? 'description' : 'summary']: fields.description }, [key === 'projects' ? 'description' : 'summary']);
  if (fields.name !== undefined && String(fields.name).trim()){
    const v = String(fields.name).trim();
    if (lang === DEFAULT_LANG){ p[nameKey] = v; res.title = follow(model, p.display?.position, DEFAULT_LANG, before[nameKey], v); }
    else {
      const old = fieldIn(model, lang, fieldPath(key, id, nameKey)) || (hasIn(model, p.display?.position, lang) ? textIn(model, p.display?.position, lang) : '');
      setField(model, lang, fieldPath(key, id, nameKey), v);
      res.title = follow(model, p.display?.position, lang, old, v);
    }
  }
  if (fields.location !== undefined){
    if (lang === DEFAULT_LANG){ const v = String(fields.location).trim(); if (v) p.location = v; else delete p.location; }
    else setField(model, lang, fieldPath(key, id, 'location'), fields.location);
  }
  const view = (x, l) => ({ entity: x[orgKey], startDate: x.startDate ?? x.date, endDate: key === 'awards' ? null : x.endDate,
    location: l === DEFAULT_LANG ? x.location : fieldIn(model, l, fieldPath(key, id, 'location')) });
  if (p.display?.meta){
    const o = projectMeta(view(before, lang), lang), n = projectMeta(view(p, lang), lang);
    if (o !== n || !hasIn(model, p.display.meta, lang)) res.meta = follow(model, p.display.meta, lang, hasIn(model, p.display.meta, lang) ? o : '', n);
  }
  if (p.display?.run){
    const run = (x, l) => [l === DEFAULT_LANG ? x[nameKey] : (fieldIn(model, l, fieldPath(key, id, nameKey)) || x[nameKey]), x[orgKey], String(x.startDate ?? x.date ?? '').slice(0, 4)].filter(Boolean).join(' · ');
    const o = run(before, lang), n = run(p, lang);
    if (o !== n || !hasIn(model, p.display.run, lang)) res.title = follow(model, p.display.run, lang, hasIn(model, p.display.run, lang) ? o : '', n) ?? res.title;
  }
  syncEntry(model, p);
  return res;
}

// A record that requires sources refuses a claim without one; the source goes on every wording the claim starts with.
export function addEntryClaim(model, entryId, text, lang = DEFAULT_LANG, source = null){
  const key = entryKey(model, entryId);
  const t = String(text ?? '').trim();
  if (!key || !t) return null;
  if (!source && model.requireSource !== false) throw new RecordError('a new claim needs a source');
  const sourced = fid => { if (source) for (const id of model.facts.find(f => f.id === fid).variants) model.variants.find(v => v.id === id).source = source; return fid; };
  if (key === 'work'){
    const fid = addBullet(model, entryId, t);
    if (fid && lang !== DEFAULT_LANG) addVersion(model, fid, { text: t, lang, as: 'major' });
    return fid && sourced(fid);
  }
  const x = model[key].find(e => e.id === entryId);
  const fid = slug(`${entryId}-${t.split(' ').slice(0, 3).join(' ')}`, takenIds(model), `${entryId}-claim`);
  addFact(model, fid, { text: t, tags: [], also: alsoIn(lang, t) });
  x.highlights.push(fid);
  syncEntry(model, x);
  return sourced(fid);
}

// Also removes it from `recipes`. A job keeps one claim at least: with none it can't print.
export function deleteClaim(model, factId, recipes = []){
  const w = entriesOf(model).find(x => (x.highlights ?? []).includes(factId));
  const f = (model.facts ?? []).find(x => x.id === factId);
  if (!f) throw new Error(`no such claim: ${factId}`);
  if (w && entryKey(model, w.id) === 'work' && w.highlights.length < 2) throw keyed('error.lastClaim');
  const res = dropFacts(model, [factId], recipes);
  if (w) w.highlights = w.highlights.filter(h => h !== factId);
  if (w && entryKey(model, w.id) !== 'work') syncEntry(model, w);
  return { job: w?.id ?? null, versions: res.versions };
}

// Job types: { id, label, tags }. The old string form is read as one tag and becomes an object when edited.
function jobTypeAt(model, id){
  model.jobTypes ??= [];
  const i = model.jobTypes.findIndex(j => normaliseJobType(j)?.id === id);
  if (i < 0) throw new Error(`no such job type: ${id}`);
  model.jobTypes[i] = normaliseJobType(model.jobTypes[i]);
  return model.jobTypes[i];
}
export function addJobType(model, label, tags = []){
  const text = String(label ?? '').trim();
  if (!text) throw keyed('jt.needName');
  const taken = new Set(jobTypesOf(model).flatMap(j => [j.id, j.label.toLowerCase()]));
  if (taken.has(text.toLowerCase())) throw keyed('jt.exists', { name: text });
  const id = slug(text, new Set(jobTypesOf(model).map(j => j.id)), 'job-type');
  (model.jobTypes ??= []).push({ id, label: text, tags: [...new Set(tags.map(x => String(x).trim()).filter(Boolean))] });
  return id;
}
export function renameJobType(model, id, label){
  const text = String(label ?? '').trim();
  if (!text) throw keyed('jt.needName');
  if (jobTypesOf(model).some(j => j.id !== id && j.label.toLowerCase() === text.toLowerCase())) throw keyed('jt.exists', { name: text });
  jobTypeAt(model, id).label = text;
}
export function addJobTypeTag(model, id, tag){
  const t = knownTag(model, tag);
  const j = jobTypeAt(model, id);
  if (!j.tags.includes(t)) j.tags.push(t);
}

// ---- tags: one closed list ----
// A wording or a job type takes a tag from the list only. Making, renaming, merging and deleting happen here,
// each across every wording and job type at once, and the list stops at TAG_CAP: to add one, merge two.
const tagKey = x => String(x ?? '').trim().toLowerCase();
function cleanTag(name){
  const text = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw keyed('ux2.errTagName');
  if (text.length > 30 || /[<>$]/.test(text) || tagKey(text) === 'archive') throw keyed('ux2.errTagBad', { name: text });
  return text;
}
// The list's own spelling of a tag (an exact match first, since the list may hold Cad and cad), or a keyed error if the list has none like it.
function knownTag(model, name){
  const k = tagKey(name), list = tagVocab(model);
  const hit = list.find(x => x === String(name ?? '').trim()) ?? list.find(x => tagKey(x) === k);
  if (!hit) throw keyed('ux2.errTagUnknown', { name: String(name ?? '').trim() });
  return hit;
}
const swapTag = (model, from, to) => {
  const put = list => [...new Set((list ?? []).map(x => (x === from ? to : x)))];
  for (const v of model.variants ?? []) if ((v.tags ?? []).includes(from)) v.tags = put(v.tags);
  model.jobTypes = (model.jobTypes ?? []).map(j => { const n = normaliseJobType(j); if (!n || !n.tags.includes(from)) return j; return { ...n, tags: put(n.tags) }; });
  if (model.vocabulary?.tags) model.vocabulary.tags = put(model.vocabulary.tags);
};
export function addTag(model, name){
  const text = cleanTag(name);
  if (tagVocab(model).some(x => tagKey(x) === tagKey(text))) throw keyed('ux2.errTagExists', { name: text });
  if (tagVocab(model).length >= TAG_CAP) throw keyed('ux2.errTagCap', { n: TAG_CAP });
  ((model.vocabulary ??= {}).tags ??= []).push(text);
  return text;
}
export function renameTag(model, from, to){
  const was = knownTag(model, from), text = cleanTag(to);
  if (text === was) return;
  if (tagVocab(model).some(x => x !== was && tagKey(x) === tagKey(text))) throw keyed('ux2.errTagExists', { name: text });
  swapTag(model, was, text);
}
export function mergeTag(model, from, into){
  const a = knownTag(model, from), b = knownTag(model, into);
  if (a === b) throw keyed('ux2.errTagSame');
  swapTag(model, a, b);
}
export function deleteTag(model, name){
  const a = knownTag(model, name);
  const drop = list => (list ?? []).filter(x => x !== a);
  for (const v of model.variants ?? []) if ((v.tags ?? []).includes(a)){ v.tags = drop(v.tags); if (!v.tags.length) delete v.tags; }
  model.jobTypes = (model.jobTypes ?? []).map(j => { const n = normaliseJobType(j); return n && n.tags.includes(a) ? { ...n, tags: drop(n.tags) } : j; });
  if (model.vocabulary?.tags) model.vocabulary.tags = drop(model.vocabulary.tags);
}
// Puts a tag from the list on one wording.
export function tagVersion(model, vid, name){
  const a = knownTag(model, name), v = (model.variants ?? []).find(x => x.id === vid);
  if (v && !(v.tags ?? []).includes(a)) v.tags = [...(v.tags ?? []), a];
}
export function removeJobTypeTag(model, id, tag){
  const j = jobTypeAt(model, id);
  j.tags = j.tags.filter(x => x !== tag);
}
// Saved resumes keep the id they were saved with; it shows as typed.
export function deleteJobType(model, id){
  jobTypeAt(model, id);
  model.jobTypes = model.jobTypes.filter(j => normaliseJobType(j)?.id !== id);
}

// Hides a claim without deleting it. Saved resumes keep printing it. A job keeps one unarchived claim at least.
export function archiveClaim(model, factId){
  const f = (model.facts ?? []).find(x => x.id === factId);
  if (!f) throw new Error(`no such claim: ${factId}`);
  const w = entriesOf(model).find(x => (x.highlights ?? []).includes(factId));
  if (!w) throw new Error(`${factId} is not a claim of any entry`);
  if (f.archived) return { job: w.id, changed: false };
  if (entryKey(model, w.id) === 'work' && !w.highlights.some(h => h !== factId && !isArchived(model, h))) throw keyed('arch.lastClaim');
  f.archived = true;
  return { job: w.id, changed: true };
}
export function unarchiveClaim(model, factId){
  const f = (model.facts ?? []).find(x => x.id === factId);
  if (!f) throw new Error(`no such claim: ${factId}`);
  const was = !!f.archived;
  delete f.archived;
  return { changed: was };
}
// Hides a whole job (or project, or volunteering) without deleting it. Saved resumes keep printing it.
export function archiveEntry(model, id){
  const w = entriesOf(model).find(x => x.id === id);
  if (!w) throw new Error(`no such entry: ${id}`);
  const was = !!w.archived;
  w.archived = true;
  return { changed: !was };
}
export function unarchiveEntry(model, id){
  const w = entriesOf(model).find(x => x.id === id);
  if (!w) throw new Error(`no such entry: ${id}`);
  const was = !!w.archived;
  delete w.archived;
  return { changed: was };
}
export const archivedOf = (model, entryId) => (entriesOf(model).find(x => x.id === entryId)?.highlights ?? []).filter(h => isArchived(model, h));

function dropFacts(model, ids, recipes = []){
  let versions = 0;
  const drop = new Set(ids.filter(Boolean));
  for (const id of drop){
    const f = (model.facts ?? []).find(x => x.id === id);
    if (!f) continue;
    const vs = new Set(f.variants);
    versions += vs.size;
    model.variants = model.variants.filter(v => !vs.has(v.id));
    model.facts = model.facts.filter(x => x !== f);
  }
  for (const v of model.variants ?? []) if (v.covers) v.covers = v.covers.filter(c => !drop.has(c));
  model.same = (model.same ?? []).filter(k => !drop.has(k.replace(/^fact:/, '')));
  const scrub = list => (list ?? []).map(r => (typeof r === 'object' && r.highlights ? { ...r, highlights: r.highlights.filter(h => !drop.has(h)) } : r));
  for (const r of recipes){
    if (!r) continue;
    for (const s of r.sections ?? []) if (s && typeof s === 'object' && s.work) s.work = scrub(s.work);
    for (const page of r.pages ?? []) for (const s of page) if (s && typeof s === 'object' && s.work) s.work = scrub(s.work);
    for (const o of [r, ...Object.values(r.byLang ?? {})]){
      for (const id of drop){ if (o.picks) delete o.picks[id]; if (o.overrides) delete o.overrides[id]; }
      if (o.held) o.held = o.held.filter(x => !drop.has(x));
    }
    for (const k of ['off', 'keep', 'held']) if (Array.isArray(r[k])){ r[k] = r[k].filter(x => !drop.has(x)); if (!r[k].length) delete r[k]; }
  }
  return { versions };
}

export function deleteEntry(model, id, recipes = []){
  const key = entryKey(model, id) ?? ((model.awards ?? []).some(x => x?.id === id) ? 'awards' : null)
    ?? ((model.projects ?? []).some(x => x?.id === id) ? 'projects' : null);
  if (!key || key === 'work') throw new Error(`no such entry: ${id}`);
  const x = model[key].find(e => e?.id === id);
  const facts = [...Object.values(x.display ?? {}), ...(x.highlights ?? []).filter(h => (model.facts ?? []).some(f => f.id === h))];
  dropFacts(model, facts, recipes);
  model[key] = model[key].filter(e => e !== x);
  if (!model[key].length) delete model[key];
  for (const s of model.sections ?? []){
    if (s.content?.work) s.content.work = s.content.work.filter(w => w !== id);
    if (s.content?.items) s.content.items = s.content.items.filter(f => !facts.includes(f));
  }
  for (const r of recipes){
    if (!r) continue;
    const drop = list => list.filter(w => (typeof w === 'string' ? w : w.id) !== id);
    for (const s of r.sections ?? []) if (s && typeof s === 'object' && s.work) s.work = drop(s.work);
    for (const page of r.pages ?? []) for (const s of page) if (s && typeof s === 'object' && s.work) s.work = drop(s.work);
  }
  return { facts: facts.length };
}

// Skills & credentials
const skillText = s => (s.keywords ?? []).join(', ');
const langsOfFact = (model, id) => { const f = (model.facts ?? []).find(x => x.id === id); return new Set((model.variants ?? []).filter(v => f?.variants.includes(v.id)).map(v => v.lang ?? DEFAULT_LANG)); };
export function updateSkill(model, id, { name, keywords, level } = {}, lang = DEFAULT_LANG){
  const s = (model.skills ?? []).find(x => x.id === id);
  if (!s) throw new Error(`no such skill group: ${id}`);
  setPlain(s, { level }, ['level']);
  const f = (model.facts ?? []).find(x => x.id === id);
  const before = skillText(s);
  const res = { printed: null };
  if (name !== undefined){
    const v = String(name).trim();
    if (lang === DEFAULT_LANG){ if (v){ s.name = v; if (f){ f.label = v; f.summary = `${v} skills`; } } }
    else { model.i18n ??= {}; model.i18n[lang] ??= {}; const l = (model.i18n[lang].labels ??= {}); if (v) l[id] = v; else delete l[id]; }
  }
  if (keywords !== undefined){
    s.keywords = (Array.isArray(keywords) ? keywords : String(keywords).split(',')).map(x => String(x).trim()).filter(Boolean);
    for (const l of langsOfFact(model, id)){ const r = follow(model, id, l, before, skillText(s)); if (l === lang) res.printed = r; }
  }
  return res;
}
function ensureListSection(model, kind, id, title, key, after = null){
  model.sections ??= [];
  let s = model.sections.find(x => x.id === id) ?? model.sections.find(x => x.kind === kind && kind !== 'runs');
  if (!s){
    s = { id, title, kind, content: kind === 'runs' ? { items: [], separator: ' · ' } : { [key]: [] } };
    const at = after ? model.sections.findIndex(x => after.includes(x.id)) : -1;
    model.sections.splice(at < 0 ? model.sections.length : at, 0, s);
  }
  return s;
}
export function addSkill(model, { name = '', keywords = [] } = {}, lang = DEFAULT_LANG){
  const kw = (Array.isArray(keywords) ? keywords : String(keywords).split(',')).map(x => String(x).trim()).filter(Boolean);
  const n = String(name).trim() || 'Skills';
  const id = slug(`skills-${n}`, factIds(model), 'skills');
  (model.skills ??= []).push({ id, name: n, keywords: kw });
  addFact(model, id, { text: kw.join(', ') || ' ', label: n, summary: `${n} skills`, tags: [], also: kw.length ? alsoIn(lang, kw.join(', ')) : null });
  if (lang !== DEFAULT_LANG){ model.i18n ??= {}; model.i18n[lang] ??= {}; (model.i18n[lang].labels ??= {})[id] = n; }
  const s = ensureListSection(model, 'grid', 'skills', 'Skills', 'groups', ['certified', 'patent', 'education', 'languages', 'interests']);
  s.content.groups = [...(s.content.groups ?? []), id];
  return id;
}

export function updateLanguage(model, id, { language, fluency } = {}, lang = DEFAULT_LANG){
  const l = (model.languages ?? []).find(x => x.id === id);
  if (!l) throw new Error(`no such language: ${id}`);
  const f = (model.facts ?? []).find(x => x.id === id);
  const res = { printed: null };
  if (language !== undefined){
    const v = String(language).trim();
    if (lang === DEFAULT_LANG){ if (v){ l.language = v; if (f){ f.term = v; f.summary = `${v}${l.fluency ? `, ${l.fluency}` : ''}`; } } }
    else { model.i18n ??= {}; model.i18n[lang] ??= {}; const terms = (model.i18n[lang].terms ??= {}); if (v) terms[id] = v; else delete terms[id]; }
  }
  if (fluency !== undefined){
    const before = l.fluency ?? '';
    l.fluency = String(fluency).trim();
    for (const x of langsOfFact(model, id)){ const r = follow(model, id, x, before, l.fluency); if (x === lang) res.printed = r; }
  }
  return res;
}
export function addLanguage(model, { language = '', fluency = '' } = {}, lang = DEFAULT_LANG){
  const id = slug(`lang-${language || 'language'}`, factIds(model), 'lang');
  (model.languages ??= []).push({ id, language: String(language).trim(), fluency: String(fluency).trim() });
  addFact(model, id, { text: fluency || ' ', term: language, summary: `${language}${fluency ? `, ${fluency}` : ''}`, tags: [] });
  if (lang !== DEFAULT_LANG){ model.i18n ??= {}; model.i18n[lang] ??= {}; (model.i18n[lang].terms ??= {})[id] = String(language).trim(); }
  const s = ensureListSection(model, 'pairs', 'languages', 'Languages', 'pairs', ['interests']);
  s.content.pairs = [...(s.content.pairs ?? []), id];
  return id;
}

export function updateCertificate(model, id, { name, issuer, date, expires, url } = {}){
  const c = (model.certificates ?? []).find(x => x.id === id);
  if (!c) throw new Error(`no such certificate: ${id}`);
  const before = c.name;
  const res = { printed: null };
  if (name !== undefined && String(name).trim()) c.name = String(name).trim();
  for (const [k, v] of Object.entries({ issuer, url })) if (v !== undefined){ const t = String(v).trim(); if (t) c[k] = t; else delete c[k]; }
  for (const [k, v] of Object.entries({ date, expires })) if (v !== undefined){ const t = ym(v); if (t) c[k] = t; else delete c[k]; }
  if (c.name !== before) res.printed = follow(model, id, DEFAULT_LANG, before, c.name);
  return res;
}
export function addCertificate(model, { name = '', issuer = '', date = '' } = {}){
  const n = String(name).trim() || 'Certificate';
  const id = slug(`cert-${n}`, factIds(model), 'cert');
  (model.certificates ??= []).push({ id, name: n, ...(issuer ? { issuer } : {}), ...(ym(date) ? { date: ym(date) } : {}) });
  addFact(model, id, { text: n, summary: `${n} certification`, tags: [] });
  const s = (model.sections ?? []).find(x => x.kind === 'runs' && (x.content?.items ?? []).some(i => (model.certificates ?? []).some(c => c.id === i)))
    ?? ensureListSection(model, 'runs', 'certified', 'Certified', 'items', ['patent', 'education', 'languages', 'interests']);
  s.content.items = [...(s.content.items ?? []), id];
  return id;
}

export function updateInterest(model, id, { name } = {}, lang = DEFAULT_LANG){
  const i = (model.interests ?? []).find(x => x.id === id);
  if (!i) throw new Error(`no such interest: ${id}`);
  const v = String(name ?? '').trim();
  if (!v) return { printed: null };
  if (lang === DEFAULT_LANG){
    const before = i.name; i.name = v;
    const f = (model.facts ?? []).find(x => x.id === id); if (f) f.summary = v;
    return { printed: follow(model, id, DEFAULT_LANG, before, v) };
  }
  // in another language the interest's name is its version there
  return { printed: follow(model, id, lang, hasIn(model, id, lang) ? textIn(model, id, lang) : '', v) };
}
export function addInterest(model, { name = '' } = {}, lang = DEFAULT_LANG){
  const n = String(name).trim() || 'Interest';
  const id = slug(`interest-${n}`, factIds(model), 'interest');
  (model.interests ??= []).push({ id, name: n });
  addFact(model, id, { text: n, summary: n, tags: [], also: alsoIn(lang, n) });
  const s = ensureListSection(model, 'runs', 'interests', 'Interests', 'items');
  s.content.items = [...(s.content.items ?? []), id];
  return id;
}

export function updatePublication(model, id, { name, publisher, releaseDate, url, summary } = {}, lang = DEFAULT_LANG){
  const p = (model.publications ?? []).find(x => x.id === id);
  if (!p) throw new Error(`no such publication: ${id}`);
  const res = { printed: null };
  setPlain(p, { url, summary }, ['url', 'summary']);
  if (name !== undefined && String(name).trim()){
    const v = String(name).trim();
    if (lang === DEFAULT_LANG){ const before = p.name; p.name = v; res.printed = follow(model, p.display?.name, DEFAULT_LANG, before, v); }
    else {
      const old = fieldIn(model, lang, fieldPath('publications', id, 'name')) || (hasIn(model, p.display?.name, lang) ? textIn(model, p.display?.name, lang) : '');
      setField(model, lang, fieldPath('publications', id, 'name'), v);
      res.printed = follow(model, p.display?.name, lang, old, v);
    }
  }
  if (publisher !== undefined && String(publisher).trim()) p.publisher = String(publisher).trim();
  if (releaseDate !== undefined && ym(releaseDate)) p.releaseDate = ym(releaseDate);
  return res;
}

// A resume prints only the first publication.
export function addPublication(model, { name = '', publisher = '', releaseDate = '', identifier = '', role = '' } = {}, lang = DEFAULT_LANG){
  const n = String(name).trim() || 'Publication';
  const id = slug(`pub-${n}`, takenIds(model), 'pub');
  const yr = String(ym(releaseDate) || new Date().getFullYear()).slice(0, 4);
  const p = { id, name: n, publisher: String(publisher).trim() || '—', releaseDate: ym(releaseDate) || yr, ...(identifier ? { identifier } : {}), ...(role ? { role } : {}),
    display: { name: `${id}-title`, meta: `${id}-meta` } };
  addFact(model, `${id}-title`, { text: n, summary: 'Publication title', tags: [], also: alsoIn(lang, n) });
  addFact(model, `${id}-meta`, { text: [role, identifier, publisher, yr].filter(Boolean).join(' · ').toUpperCase(), summary: 'Publication line', tags: [] });
  (model.publications ??= []).push(p);
  const prints = (model.sections ?? []).some(s => s.kind === 'item' && (model.publications ?? []).some(x => x.display?.name === s.content?.title));
  if (!prints){
    model.sections ??= [];
    const at = model.sections.findIndex(x => ['education', 'languages', 'interests'].includes(x.id));
    model.sections.splice(at < 0 ? model.sections.length : at, 0, { id: 'publications', title: 'Publications', kind: 'item', content: { title: `${id}-title`, meta: `${id}-meta` } });
  }
  return id;
}

export function deleteItem(model, group, id, recipes = []){
  const key = { skills: 'skills', languages: 'languages', certificates: 'certificates', interests: 'interests', publications: 'publications', references: 'references' }[group];
  if (!key) return deleteEntry(model, id, recipes);
  const x = (model[key] ?? []).find(e => e.id === id);
  if (!x) throw new Error(`no such item: ${id}`);
  const facts = key === 'publications' ? Object.values(x.display ?? {}) : [id];
  dropFacts(model, facts, recipes);
  model[key] = model[key].filter(e => e !== x);
  if (!model[key].length && key === 'references') delete model[key];
  for (const s of model.sections ?? []) for (const k of ['groups', 'pairs', 'items']) if (s.content?.[k]) s.content[k] = s.content[k].filter(f => !facts.includes(f));
  for (const l of Object.values(model.i18n ?? {})) for (const k of ['labels', 'terms']) if (l?.[k]) delete l[k][id];
  return { facts: facts.length };
}

// About you
export function updateAbout(model, fields, lang = DEFAULT_LANG){
  const b = model.basics ??= {};
  const before = { name: b.name ?? '', label: b.label ?? '', email: b.email ?? '', phone: b.phone ?? '', url: b.url ?? '', city: b.location?.city ?? '', rights: b.rights ?? '' };
  const after = { ...before };
  for (const k of Object.keys(before)) if (fields[k] !== undefined) after[k] = String(fields[k]).trim();
  // Names differ by language ("Kovács Anna" in Hungarian), so another language sets its own text, not b.name.
  const nameHere = lang !== DEFAULT_LANG && fields.name !== undefined;
  if (nameHere) after.name = before.name;
  b.name = after.name; b.email = after.email; b.phone = after.phone;
  b.url = after.url && !/^https?:/.test(after.url) ? `https://${after.url}` : after.url;
  b.location = { ...(b.location ?? {}), city: after.city };
  if (after.rights) b.rights = after.rights; else delete b.rights;
  // the rest of the address is kept; the contact line prints city, email and phone only
  setPlain(b.location, fields, ['address', 'postalCode', 'region']);
  if (lang === DEFAULT_LANG) b.label = after.label;
  const res = {};
  const d = b.display ?? {};
  if (after.name !== before.name) res.name = follow(model, d.name, lang, hasIn(model, d.name, lang) ? textIn(model, d.name, lang) : (lang === DEFAULT_LANG ? before.name : ''), after.name);
  if (nameHere && d.name){
    const typed = String(fields.name).trim();
    const had = hasIn(model, d.name, lang) ? textIn(model, d.name, lang) : '';
    if (typed && typed === before.name && !had) setSameFact(model, d.name, true);
    else if (typed && typed !== had){
      res.name = follow(model, d.name, lang, had, typed);
      if (typed !== before.name) setSameFact(model, d.name, false);
    }
  }
  if (fields.label !== undefined){
    const old = lang === DEFAULT_LANG ? before.label : (hasIn(model, d.label, lang) ? textIn(model, d.label, lang) : '');
    res.label = follow(model, d.label, lang, old, String(fields.label).trim());
  }
  const c0 = contactText(before).text, c1 = contactText(after).text;
  if (c0 !== c1 && d.contact) for (const l of new Set([lang, ...langsOfFact(model, d.contact)])){
    const r = follow(model, d.contact, l, hasIn(model, d.contact, l) ? c0 : '', c1);
    if (l === lang) res.contact = r;
  }
  if (model.meta) model.meta.owner = after.name;
  return res;
}
export { SEP };

// References
// JSON Resume references[]: { name, reference }. The name is shared by every language; the
// reference is a text with versions. The section is off on a resume until turned on.
function ensureReferences(model){
  model.sections ??= [];
  let s = model.sections.find(x => x.id === 'references');
  if (!s){
    s = { id: 'references', title: 'References', kind: 'pairs', off: true, content: { pairs: [] } };
    const at = model.sections.findIndex(x => x.id === 'interests');
    model.sections.splice(at < 0 ? model.sections.length : at + 1, 0, s);
  }
  return s;
}
function referenceFact(model, r, lang = DEFAULT_LANG, text = r.reference){
  addFact(model, r.id, { text: String(text ?? '').trim() || ' ', term: r.name, summary: `Reference: ${r.name}`, tags: ['references'], also: alsoIn(lang, text) });
  const s = ensureReferences(model);
  s.content.pairs = [...(s.content.pairs ?? []).filter(x => x !== r.id), r.id];
}
export function addReference(model, { name = '', reference = '' } = {}, lang = DEFAULT_LANG){
  const n = String(name).trim() || 'Reference';
  const id = slug(`ref-${n}`, takenIds(model), 'ref');
  const r = { id, name: n, reference: String(reference).trim() };
  (model.references ??= []).push(r);
  referenceFact(model, r, lang);
  return id;
}
export function updateReference(model, id, { name, reference } = {}, lang = DEFAULT_LANG){
  const r = (model.references ?? []).find(x => x?.id === id);
  if (!r) throw new Error(`no such reference: ${id}`);
  const f = (model.facts ?? []).find(x => x.id === id);
  const res = { printed: null };
  if (name !== undefined && String(name).trim()){ r.name = String(name).trim(); if (f){ f.term = r.name; f.summary = `Reference: ${r.name}`; } }
  if (reference !== undefined && String(reference).trim()){
    const v = String(reference).trim();
    res.printed = follow(model, id, lang, hasIn(model, id, lang) ? textIn(model, id, lang) : '', v);
    if (lang === DEFAULT_LANG) r.reference = v;
  }
  return res;
}
// references a JSON Resume brought in, made into the app's (an id and a text)
export function adoptReferences(model){
  const raw = (model.references ?? []).filter(x => x && typeof x === 'object' && !x.id);
  const taken = takenIds(model);
  for (const r of raw){
    r.id = slug(`ref-${r.name || 'reference'}`, taken, 'ref');
    taken.add(r.id);
    r.name ??= '';
    referenceFact(model, r);
  }
  return raw.length;
}

// Custom kinds
export function createKind(model, def){
  if (kindsOf(model).length >= MAX_KINDS) throw keyed('error.maxKinds', { n: MAX_KINDS });
  const name = { ...(def.name ?? {}) };
  if (!String(name.en ?? '').trim()) throw keyed('error.kindName');
  const store = def.store ?? 'projects';
  if (store !== 'projects' && kindsOf(model).some(k => k.store === store)) throw keyed('error.kindTaken');
  const taken = new Set([...kindsOf(model).map(k => k.id), ...TIMELINE_KINDS, ...LIST_GROUPS]);
  const id = def.id && !taken.has(def.id) ? def.id : slug(name.en, taken, 'kind');
  const place = store === 'volunteer' ? 'timeline' : store === 'awards' ? 'list' : def.place === 'list' ? 'list' : 'timeline';
  const k = { id, name, colour: Number(def.colour ?? 0) % 6, icon: KIND_ICONS.includes(def.icon) ? def.icon : 'dot', place,
    org: String(def.org ?? 'Organisation'), claims: place === 'timeline', store };
  k.section = store === 'volunteer' ? 'volunteer' : store === 'awards' ? 'awards' : `kind-${id}`;
  model.sections ??= [];
  if (!model.sections.some(s => s.id === k.section)){
    const s = place === 'timeline' ? { id: k.section, title: name.en, kind: 'entries', off: true, content: { work: [] } }
      : { id: k.section, title: name.en, kind: 'runs', off: true, content: { items: [], separator: ' · ' } };
    const at = model.sections.findIndex(x => ['languages', 'interests'].includes(x.id));
    model.sections.splice(at < 0 ? model.sections.length : at, 0, s);
  }
  (model.kinds ??= []).push(k);
  return k.id;
}
// A rename changes every heading, record or resume, that still says the old name.
export function updateKind(model, id, patch, recipes = []){
  const k = kindOf(model, id);
  if (!k) throw new Error(`no such kind: ${id}`);
  const s = (model.sections ?? []).find(x => x.id === k.section);
  for (const [lang, v] of Object.entries(patch.name ?? {})){
    const old = k.name[lang] ?? '';
    const nv = String(v ?? '').trim();
    if (!nv || nv === old) continue;
    k.name[lang] = nv;
    if (s && lang === DEFAULT_LANG && s.title === old) s.title = nv;
    if (s && lang !== DEFAULT_LANG && model.i18n?.[lang]?.sections?.[s.id] === old) model.i18n[lang].sections[s.id] = nv;
    for (const r of recipes) for (const e of r?.sections ?? []) if (e && typeof e === 'object' && e.id === k.section && e.label){
      if (typeof e.label === 'string' && lang === DEFAULT_LANG && e.label === old) e.label = nv;
      else if (typeof e.label === 'object' && e.label[lang] === old) e.label[lang] = nv;
    }
  }
  for (const key of ['colour', 'icon', 'org']) if (patch[key] !== undefined) k[key] = key === 'colour' ? Number(patch[key]) % 6 : patch[key];
  return k;
}
export function entriesOfKind(model, id){
  const k = kindOf(model, id);
  if (!k) return [];
  const store = storeOf(k);
  return (model[store] ?? []).filter(x => x?.id && (store !== 'projects' || x.type === id));
}
// Entries move to `moveTo` (a kind id or 'project') or are deleted with the kind.
export function deleteKind(model, id, { moveTo = null, recipes = [] } = {}){
  const k = kindOf(model, id);
  if (!k) throw new Error(`no such kind: ${id}`);
  const store = storeOf(k);
  const mine = entriesOfKind(model, id);
  if (moveTo){
    const to = moveTo === 'project' ? null : kindOf(model, moveTo);
    if (moveTo !== 'project' && !to) throw new Error(`no such kind: ${moveTo}`);
    const toStore = to ? storeOf(to) : 'projects';
    // each store names the same things its own way
    const NAMES = { projects: ['name', 'entity', 'startDate'], volunteer: ['position', 'organization', 'startDate'], awards: ['title', 'awarder', 'date'] };
    for (const x of mine){
      if (store !== toStore) NAMES[store].forEach((k, i) => { const nk = NAMES[toStore][i]; if (x[k] !== undefined && k !== nk){ x[nk] = x[k]; delete x[k]; } });
      if (toStore === 'projects'){ if (to) x.type = to.id; else delete x.type; } else delete x.type;
      if (toStore !== store){ model[store] = model[store].filter(e => e !== x); (model[toStore] ??= []).push(x); }
    }
    if (!to) ensureEntriesSection(model, 'projects', 'Projects');
    for (const x of mine) syncEntry(model, x);
    if (to?.place === 'list'){ const s = (model.sections ?? []).find(e => e.id === to.section); if (s) s.content.items = [...(s.content.items ?? []), ...mine.map(x => x.display?.run).filter(Boolean)]; }
  } else for (const x of mine) deleteEntry(model, x.id, recipes);
  model.kinds = kindsOf(model).filter(x => x !== k);
  if (!model.kinds.length) delete model.kinds;
  if (model[store] && !model[store].length) delete model[store];
  model.sections = (model.sections ?? []).filter(s => s.id !== k.section);
  for (const r of recipes){
    if (!r) continue;
    if (r.sections) r.sections = r.sections.filter(e => (typeof e === 'string' ? e : e?.id) !== k.section);
    if (r.pages) r.pages = r.pages.map(p => p.filter(e => (typeof e === 'string' ? e : e?.id) !== k.section));
  }
  return { moved: moveTo ? mine.length : 0, deleted: moveTo ? 0 : mine.length };
}
// A list kind's entry is one run text: "Name · Organisation · Year".
export function addKindEntry(model, kindId, { name = '', org = '', startDate = '', endDate = '', location = '', bullets = [], lang = DEFAULT_LANG } = {}){
  const k = kindOf(model, kindId);
  if (!k) throw new Error(`no such kind: ${kindId}`);
  if (k.store === 'projects' && k.place === 'timeline') return addProject(model, { name: name || k.name.en, entity: org, startDate, endDate, location, bullets, type: k.id, lang });
  const id = slug(name || k.name.en, takenIds(model), k.id);
  if (k.store === 'volunteer'){
    const x = { id, organization: org, position: String(name).trim() || k.name.en, ...(ym(startDate) ? { startDate: ym(startDate) } : {}), ...(ym(endDate) ? { endDate: ym(endDate) } : {}),
      ...(location ? { location } : {}), display: { position: `${id}-position`, meta: `${id}-meta` }, highlights: [] };
    const meta = l => projectMeta({ entity: org, startDate, endDate, location }, l);
    addFact(model, `${id}-position`, { text: x.position, summary: k.name.en, tags: [], also: alsoIn(lang, name) });
    addFact(model, `${id}-meta`, { text: meta(DEFAULT_LANG) || ' ', summary: 'Where and when', tags: [], also: alsoIn(lang, meta(lang)) });
    (model.volunteer ??= []).push(x);
    for (const b of (bullets ?? []).map(t => String(t ?? '').trim()).filter(Boolean)) addEntryClaim(model, id, b, lang);
    syncEntry(model, x);
    return id;
  }
  const year = String(ym(startDate) || '').slice(0, 4);
  const nm = String(name).trim() || k.name.en;
  const run = [nm, org, year].filter(Boolean).join(' · ');
  const x = k.store === 'awards'
    ? { id, title: nm, ...(org ? { awarder: org } : {}), ...(ym(startDate) ? { date: ym(startDate) } : {}), display: { run: id } }
    : { id, name: nm, type: k.id, ...(org ? { entity: org } : {}), ...(ym(startDate) ? { startDate: ym(startDate) } : {}), display: { run: id } };
  addFact(model, id, { text: run, summary: nm, tags: [], also: alsoIn(lang, run) });
  (model[k.store === 'awards' ? 'awards' : 'projects'] ??= []).push(x);
  const s = (model.sections ?? []).find(e => e.id === k.section);
  if (s) s.content.items = [...(s.content.items ?? []), id];
  return id;
}

// Imported items keep every field, so the round trip to JSON Resume loses nothing.
// An unknown project `type` makes a kind named after it.
export function adoptImported(model){
  const raw = {
    projects: (model.projects ?? []).filter(x => x && typeof x === 'object' && !x.display),
    volunteer: (model.volunteer ?? []).filter(x => x && typeof x === 'object' && !x.display),
    awards: (model.awards ?? []).filter(x => x && typeof x === 'object' && !x.display),
  };
  if (raw.volunteer.length && !kindsOf(model).some(k => k.store === 'volunteer')) createKind(model, { ...KIND_PRESETS.volunteering, name: { en: 'Volunteering' }, id: 'volunteering' });
  if (raw.awards.length && !kindsOf(model).some(k => k.store === 'awards')) createKind(model, { ...KIND_PRESETS.awards, name: { en: 'Awards' }, id: 'awards' });
  const typeId = t => slug(t, new Set(), 'kind');
  for (const t of [...new Set(raw.projects.map(p => p.type).filter(Boolean))])
    if (!kindOf(model, typeId(t)) && kindsOf(model).length < MAX_KINDS) createKind(model, { id: typeId(t), name: { en: t }, place: 'timeline', store: 'projects', colour: kindsOf(model).length, icon: 'dot' });
  const taken = takenIds(model);
  const asEntry = (x, key, title, org) => {
    const id = slug(x.id ?? title ?? key, taken, key === 'volunteer' ? 'volunteer' : 'project');
    x.id = id;
    x.display = { position: `${id}-position`, meta: `${id}-meta` };
    addFact(model, `${id}-position`, { text: title || ' ', summary: key === 'volunteer' ? 'Volunteering' : 'Project', tags: [] });
    addFact(model, `${id}-meta`, { text: projectMeta({ entity: org, startDate: x.startDate, endDate: x.endDate }) || ' ', summary: 'With whom and when', tags: [] });
    const hs = (x.highlights ?? []).map(h => String(h ?? '').trim()).filter(Boolean);
    if (!hs.length && x.description) hs.push(String(x.description).trim());
    x.highlights = [];
    for (const h of hs){ const fid = slug(`${id}-${h.split(' ').slice(0, 3).join(' ')}`, taken, `${id}-claim`); addFact(model, fid, { text: h, tags: [] }); x.highlights.push(fid); }
  };
  for (const x of raw.volunteer) asEntry(x, 'volunteer', x.position ?? x.organization, x.organization);
  for (const x of raw.projects){
    if (x.type && kindOf(model, typeId(x.type))) x.type = typeId(x.type);
    asEntry(x, 'projects', x.name, x.entity);
  }
  for (const x of raw.awards){
    const id = slug(x.id ?? x.title ?? 'award', taken, 'award');
    x.id = id; x.display = { run: id };
    addFact(model, id, { text: [x.title, x.awarder, String(x.date ?? '').slice(0, 4)].filter(Boolean).join(' · ') || ' ', summary: x.title ?? 'Award', tags: [] });
    const s = (model.sections ?? []).find(e => e.id === 'awards');
    if (s) s.content.items = [...(s.content.items ?? []), id];
  }
  if (raw.projects.some(p => !p.type)) ensureEntriesSection(model, 'projects', 'Projects');
  for (const x of [...raw.projects, ...raw.volunteer]) syncEntry(model, x);
  const references = adoptReferences(model);
  return { volunteer: raw.volunteer.length, projects: raw.projects.length, awards: raw.awards.length, references };
}

export { addJob, addBullet };
