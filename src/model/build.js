// Builds a career record from plain fields, for the import and the first-run form.
// Pure: changes the model in place. Never leave a section empty: the validator refuses it.

import { emptyModel } from './schema.js';
import { t, tIn } from '../i18n/index.js';
import { setI18n } from './labels.js';

export const SEP = '  ·  ';
const RUN_SEP = ' · ', TITLE_SEP = '  ';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const cps = s => [...s].length;

// "Mar 2023", or the language's own short month ("März 2023", "2023. márc.").
export const fmtMonth = (d, lang = 'en') => {
  const m = String(d ?? '').match(/^(\d{4})(?:-(\d{2}))?/);
  if (!m) return '';
  if (!m[2]) return m[1];
  if (lang && lang !== 'en'){
    try { return new Intl.DateTimeFormat(lang, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15))); }
    catch { /* an unknown locale: the English below */ }
  }
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
};
export const presentIn = lang => (lang && lang !== 'en' ? tIn(lang, 'doc.present') : 'Present');
// "Employer · Mar 2023 – Present · Place"
export const metaLineOf = ({ name, startDate, endDate, location }, lang = 'en') =>
  [name, `${fmtMonth(startDate, lang)} – ${endDate ? fmtMonth(endDate, lang) : presentIn(lang)}`, location].filter(x => x && String(x).trim() !== '–').join(' · ');
export const ym = d => (String(d ?? '').match(/^\d{4}(-\d{2})?/) ?? [''])[0];

export function slug(s, taken = new Set(), fallback = 'item'){
  const base = String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || fallback;
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}
const ids = model => new Set([...(model.facts ?? []).map(f => f.id), ...(model.work ?? []).map(w => w.id),
  ...(model.sections ?? []).map(s => s.id)]);

// First clause, at most 70 characters.
export function claimOf(text){
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  const first = t.split(/(?<=[.;:])\s/)[0];
  return first.length <= 70 ? first.replace(/[.;:]$/, '') : `${first.slice(0, 67).trimEnd()}…`;
}

// One fact with an English v1. `also: { lang, text }` adds a v1 in that language as well.
export function addFact(model, id, { text, summary, tags = [], links = [], separator, term, label, work, also = null } = {}){
  const t = String(text ?? '').trim();
  const v = { id: `${id}-v1`, n: '1', lang: 'en', text: t, marks: [], links: [], tags: [...tags], seenIn: [], metrics: { chars: cps(t), measured: {} } };
  let floor = 0;
  for (const l of links){
    const at = [...t].join('').indexOf(l.text, floor);
    if (!l.text || at < 0) continue;
    const start = cps(t.slice(0, at));
    v.links.push({ start, end: start + cps(l.text), href: l.href });
    floor = at + l.text.length;
  }
  if (separator) v.separator = separator;
  model.variants.push(v);
  const fact = { id, axis: 'density', ...(work ? { work } : {}), ...(term ? { term } : {}), ...(label ? { label } : {}),
    summary: summary ?? claimOf(t), variants: [v.id], default: { en: v.id } };
  model.facts.push(fact);
  const at = String(also?.text ?? '').trim();
  // empty in every language (e.g. a contact line), so mark it the same everywhere
  if (also?.lang && also.lang !== 'en' && !at && !t.trim()) model.same = [...new Set([...(model.same ?? []), `fact:${id}`])];
  if (also?.lang && also.lang !== 'en' && at){
    const w = { ...structuredClone(v), id: `${id}-v1-${also.lang}`, lang: also.lang, text: at, metrics: { chars: cps(at), measured: {} } };
    if (at !== t){ w.links = []; w.marks = []; }
    model.variants.push(w);
    fact.variants.push(w.id);
    fact.default[also.lang] = w.id;
  }
  return v;
}
const alsoIn = (lang, text) => (lang && lang !== 'en' ? { lang, text } : null);

function ensureSection(model, def, after = null){
  let s = model.sections.find(x => x.id === def.id);
  if (s) return s;
  s = structuredClone(def);
  const order = ['header', 'summary', 'experience', 'skills', 'certified', 'patent', 'publication', 'education', 'languages', 'interests'];
  const rank = id => { const i = order.indexOf(id); return i < 0 ? 99 : i; };
  const at = model.sections.findIndex(x => rank(x.id) > rank(def.id));
  model.sections.splice(at < 0 ? model.sections.length : at, 0, s);
  return s;
}

export function contactText({ city = '', email = '', phone = '', url = '', rights = '' } = {}){
  const site = String(url).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const line1 = [city, email, phone].filter(Boolean).join(SEP);
  const line2 = [site, rights].filter(Boolean).join(SEP);
  return { text: [line1, line2].filter(Boolean).join('\n'),
    links: [email && { text: email, href: `mailto:${email}` }, site && { text: site, href: /^https?:/.test(url) ? url : `https://${site}` }].filter(Boolean) };
}

export function setHeader(model, { name = '', label = '', email = '', phone = '', url = '', city = '', countryCode = '', rights = '', lang = 'en' } = {}){
  const b = model.basics ??= {};
  Object.assign(b, { name, label, email, phone, url: url && !/^https?:/.test(url) ? `https://${url}` : url });
  b.location = { ...(b.location ?? {}), city, ...(countryCode ? { countryCode } : {}) };
  b.display ??= {};
  for (const id of ['name', 'tagline', 'contact']) dropFact(model, id);
  addFact(model, 'name', { text: name || t('fact.yourName'), summary: t('fact.fullName'), tags: [], also: alsoIn(lang, name) });
  addFact(model, 'tagline', { text: label || ' ', summary: t('fact.tagline'), tags: [], also: alsoIn(lang, label) });
  const c = contactText({ city, email, phone, url, rights });
  addFact(model, 'contact', { text: c.text || ' ', summary: t('fact.contact'), tags: [], links: c.links, separator: SEP, also: alsoIn(lang, c.text) });
  b.display = { name: 'name', label: 'tagline', contact: 'contact' };
  model.meta = { ...(model.meta ?? {}), owner: name };
  ensureSection(model, { id: 'header', title: null, kind: 'header', content: { basics: true } });
}

function dropFact(model, id){
  const f = model.facts.find(x => x.id === id);
  if (!f) return;
  model.variants = model.variants.filter(v => !f.variants.includes(v.id));
  model.facts = model.facts.filter(x => x !== f);
}

export function setSummary(model, text){
  if (!String(text ?? '').trim()) return null;
  dropFact(model, 'summary');
  addFact(model, 'summary', { text, summary: t('fact.summary') });
  model.basics.summary = 'summary';
  ensureSection(model, { id: 'summary', title: 'Summary', kind: 'prose', content: { fact: 'summary' } });
  return 'summary';
}

// A job with no bullet is not added (the validator refuses it): returns null.
export function addJob(model, { position = '', name = '', location = '', startDate = '', endDate = '', bullets = [], id = null, lang = 'en' } = {}){
  if (!(bullets ?? []).some(b => String(b ?? '').trim())) return null;
  const taken = ids(model);
  const wid = id && !taken.has(id) ? id : slug(name || position, taken, 'job');
  const meta = metaLineOf({ name, startDate, endDate, location });
  addFact(model, `${wid}-position`, { text: position || name || t('fact.jobTitle'), summary: t('fact.jobTitle'), tags: [], work: wid, also: alsoIn(lang, position || name) });
  addFact(model, `${wid}-meta`, { text: meta, summary: t('fact.jobMeta'), tags: [], work: wid, also: alsoIn(lang, metaLineOf({ name, startDate, endDate, location }, lang)) });
  const hs = [];
  for (const b of bullets.map(x => String(x ?? '').trim()).filter(Boolean)){
    const fid = slug(`${wid}-${claimOf(b).split(' ').slice(0, 3).join(' ')}`, ids(model), `${wid}-claim`);
    addFact(model, fid, { text: b, work: wid, tags: [], also: alsoIn(lang, b) });
    hs.push(fid);
  }
  const w = { id: wid, position: position || name, name: name || position, ...(location ? { location } : {}),
    startDate: ym(startDate) || String(new Date().getFullYear()), ...(ym(endDate) ? { endDate: ym(endDate) } : { endDate: null }),
    display: { position: `${wid}-position`, meta: `${wid}-meta` }, highlights: hs };
  model.work.push(w);
  model.work.sort((a, b) => String(b.endDate ?? '9999').localeCompare(String(a.endDate ?? '9999')) || String(b.startDate).localeCompare(String(a.startDate)));
  const s = ensureSection(model, { id: 'experience', title: 'Experience', kind: 'entries', content: { work: [] } });
  s.content.work = model.work.filter(x => x.highlights?.length).map(x => x.id);
  return wid;
}

export function addBullet(model, workId, text){
  const w = model.work.find(x => x.id === workId);
  if (!w || !String(text ?? '').trim()) return null;
  const fid = slug(`${workId}-${claimOf(text).split(' ').slice(0, 3).join(' ')}`, ids(model), `${workId}-claim`);
  addFact(model, fid, { text, work: workId });
  w.highlights.push(fid);
  const s = ensureSection(model, { id: 'experience', title: 'Experience', kind: 'entries', content: { work: [] } });
  s.content.work = model.work.filter(x => x.highlights?.length).map(x => x.id);
  return fid;
}

// `score` is JSON Resume's grade or honours ("Distinction", "3.8 GPA"); `honours` is still accepted.
export function setEducation(model, { institution = '', studyType = '', area = '', startDate = '', endDate = '', score = '', honours = '', lang = 'en' } = {}){
  if (!institution && !studyType && !area) return null;
  score = String(score || honours || '');
  for (const id of ['edu-degree', 'edu-school', 'edu-meta']) dropFact(model, id);
  model.education = [{ id: 'edu', institution: institution || '—', studyType: studyType || '—', area: area || '—',
    ...(ym(startDate) ? { startDate: ym(startDate) } : {}), ...(ym(endDate) ? { endDate: ym(endDate) } : {}), ...(score ? { score } : {}),
    display: { studyType: 'edu-degree', institution: 'edu-school', meta: 'edu-meta' } }];
  const degree = [studyType, area].filter(Boolean).join(' ') || institution;
  const eduMeta = L => [fmtMonth(endDate, L).toUpperCase(), score.toUpperCase()].filter(Boolean).join(' · ');
  addFact(model, 'edu-degree', { text: degree, summary: t('fact.degree'), tags: [], also: alsoIn(lang, degree) });
  addFact(model, 'edu-school', { text: institution || ' ', summary: t('fact.institution'), tags: [], also: alsoIn(lang, institution) });
  addFact(model, 'edu-meta', { text: eduMeta('en') || ' ', summary: t('fact.eduMeta'), tags: [], also: alsoIn(lang, eduMeta(lang)) });
  ensureSection(model, { id: 'education', title: 'Education', kind: 'item', content: { title: 'edu-degree', subtitle: 'edu-school', meta: 'edu-meta', titleSeparator: TITLE_SEP } });
  return 'edu';
}

// [{ name, keywords }] or lines "Group: a, b, c"
export function setSkills(model, groups, { lang = 'en' } = {}){
  const list = (groups ?? []).map(g => (typeof g === 'string' ? (([n, k]) => ({ name: (k === undefined ? 'Skills' : n).trim(), keywords: (k ?? n).split(',').map(x => x.trim()).filter(Boolean) }))(g.split(/:(.*)/s)) : g))
    .filter(g => g?.name && (g.keywords ?? []).length);
  if (!list.length) return [];
  for (const s of model.skills ?? []) dropFact(model, s.id);
  const taken = ids(model);
  model.skills = list.map(g => ({ id: slug(`skills-${g.name}`, taken, 'skills'), name: g.name, keywords: [...g.keywords] }));
  for (const s of model.skills) addFact(model, s.id, { text: s.keywords.join(', '), label: s.name, summary: `${s.name} skills`, tags: [], also: alsoIn(lang, s.keywords.join(', ')) });
  if (lang && lang !== 'en') for (const s of model.skills) setI18n(model, lang, 'labels', s.id, s.name);
  const sec = ensureSection(model, { id: 'skills', title: 'Skills', kind: 'grid', content: { groups: [] } });
  sec.content.groups = model.skills.map(s => s.id);
  return model.skills.map(s => s.id);
}

export function setLanguages(model, rows){
  const list = (rows ?? []).filter(r => r?.language);
  if (!list.length) return [];
  for (const l of model.languages ?? []) dropFact(model, l.id);
  const taken = ids(model);
  model.languages = list.map(r => ({ id: slug(`lang-${r.language}`, taken, 'lang'), language: r.language, fluency: r.fluency ?? '' }));
  for (const l of model.languages) addFact(model, l.id, { text: l.fluency || ' ', term: l.language, summary: `${l.language}${l.fluency ? `, ${l.fluency}` : ''}`, tags: [] });
  const sec = ensureSection(model, { id: 'languages', title: 'Languages', kind: 'pairs', content: { pairs: [] } });
  sec.content.pairs = model.languages.map(l => l.id);
  return model.languages.map(l => l.id);
}

export function setInterests(model, names){
  // a name, or a JSON Resume interest ({ name, keywords, … }): its other fields are kept
  const list = (names ?? []).map(x => (x && typeof x === 'object' ? { ...x, name: String(x.name ?? '').trim() } : { name: String(x ?? '').trim() })).filter(x => x.name);
  if (!list.length) return [];
  for (const i of model.interests ?? []) dropFact(model, i.id);
  const taken = ids(model);
  model.interests = list.map(({ id: _id, ...x }) => ({ id: slug(`interest-${x.name}`, taken, 'interest'), ...x }));
  for (const i of model.interests) addFact(model, i.id, { text: i.name, summary: i.name, tags: [] });
  const sec = ensureSection(model, { id: 'interests', title: 'Interests', kind: 'runs', content: { items: [], separator: RUN_SEP } });
  sec.content.items = model.interests.map(i => i.id);
  return model.interests.map(i => i.id);
}

// Only the first publication, printed as an item.
export function setPublication(model, { name = '', publisher = '', releaseDate = '', summary = '', url = '' } = {}){
  if (!name) return null;
  for (const id of ['pub-title', 'pub-meta']) dropFact(model, id);
  model.publications = [{ id: 'pub', name, publisher: publisher || '—', releaseDate: ym(releaseDate) || String(new Date().getFullYear()),
    ...(url ? { url } : {}), ...(summary ? { summary } : {}), display: { name: 'pub-title', meta: 'pub-meta' } }];
  addFact(model, 'pub-title', { text: name, summary: t('fact.pubTitle'), tags: [] });
  addFact(model, 'pub-meta', { text: [publisher, summary, String(releaseDate ?? '').slice(0, 4)].filter(Boolean).join(' · ').toUpperCase() || ' ', summary: t('fact.pubMeta'), tags: [] });
  ensureSection(model, { id: 'publication', title: 'Publication', kind: 'item', content: { title: 'pub-title', meta: 'pub-meta' } });
  return 'pub';
}

export function blankRecord(fields = {}){
  const m = emptyModel(fields.name ?? '');
  m.sections = [];
  m.vocabulary = { slots: ['primary'], axes: ['density', 'market'], tags: [] };
  m.meta = { owner: fields.name ?? '', updated: new Date().toISOString().slice(0, 10) };
  setHeader(m, fields);
  return m;
}
