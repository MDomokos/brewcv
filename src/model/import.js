// Opens any file the app knows, identified by its contents, never its name. Pure: no DOM, no I/O.
// outsideEdits() finds JSON Resume body text edited in another tool; schema.js load() ignores those.

import { t } from '../i18n/index.js';
import { detect, load, loadResume, BODY_KEYS } from './schema.js';
import { defaultVariant, DEFAULT_LANG } from './resume.js';
import { addVersion, setDefault } from './record.js';
import * as B from './build.js';
import { adoptImported } from './career.js';

const clone = x => structuredClone(x);

const KEEP = ['projects', 'volunteer', 'awards', 'certificates', 'references'];

// Copies every field `to` lacks from `from`, so what the app doesn't model survives the round
// trip. `skip`: fields the builder already read under another name.
function carry(to, from, skip = []){
  if (!to || !from || typeof from !== 'object') return to;
  for (const [k, v] of Object.entries(from)) if (to[k] === undefined && !skip.includes(k) && v !== undefined && v !== null) to[k] = clone(v);
  return to;
}

export function fromJsonResume(json){
  const b = json.basics ?? {};
  // the printed contact line reads "City, Region" and shows a profile when
  // there's no website; the record keeps the fields as they came
  const city = [b.location?.city, b.location?.region].filter(Boolean).join(', ');
  const m = B.blankRecord({ name: b.name ?? '', label: b.label ?? '', email: b.email ?? '', phone: b.phone ?? '',
    url: b.url ?? (b.profiles ?? [])[0]?.url ?? '', city, countryCode: b.location?.countryCode ?? '' });
  if (Array.isArray(b.profiles)) m.basics.profiles = clone(b.profiles);
  if (b.location && typeof b.location === 'object') m.basics.location = clone(b.location);
  else delete m.basics.location;
  if (b.url === undefined) delete m.basics.url;
  for (const k of ['email', 'phone', 'label']) if (b[k] === undefined && m.basics[k] === '') delete m.basics[k];
  carry(m.basics, b, ['summary', 'image']);
  let photo = 'none';
  if (typeof b.image === 'string' && b.image){
    if (/^data:image\//.test(b.image)){ m.basics.image = b.image; photo = 'embedded'; }
    else photo = 'linked';                               // never fetched: nothing leaves the browser
  }
  B.setSummary(m, b.summary);
  let claims = 0;
  for (const w of json.work ?? []){
    const id = B.addJob(m, { position: w.position ?? '', name: w.name ?? w.company ?? '', location: w.location ?? '',
      startDate: w.startDate ?? '', endDate: w.endDate ?? '', bullets: [...(w.highlights ?? []), ...(!(w.highlights ?? []).length && w.summary ? [w.summary] : [])] });
    if (id){ const x = m.work.find(y => y.id === id); carry(x, w, ['company', 'highlights', 'id']); claims += x.highlights.length; }
  }
  const edu = (json.education ?? [])[0];
  if (edu){
    B.setEducation(m, { institution: edu.institution ?? '', studyType: edu.studyType ?? '', area: edu.area ?? '',
      startDate: edu.startDate, endDate: edu.endDate, score: edu.score ?? '' });
    carry(m.education?.[0], edu, ['id', 'display']);
  }
  B.setSkills(m, (json.skills ?? []).map(s => ({ name: s.name ?? 'Skills', keywords: s.keywords ?? [] })));
  (m.skills ?? []).forEach((s, i) => carry(s, (json.skills ?? []).filter(x => (x?.keywords ?? []).length)[i], ['id']));
  B.setLanguages(m, (json.languages ?? []).map(l => ({ language: l.language, fluency: l.fluency })));
  (m.languages ?? []).forEach((l, i) => carry(l, (json.languages ?? []).filter(x => x?.language)[i], ['id']));
  B.setInterests(m, json.interests ?? []);
  const pub = (json.publications ?? [])[0];
  if (pub){ B.setPublication(m, pub); carry(m.publications?.[0], pub, ['id', 'display']); }
  if (json.meta && typeof json.meta === 'object'){ const { version, lastModified, resumeBuilder, ...rest } = json.meta; if (Object.keys(rest).length) m.jsonMeta = clone(rest); }
  // sections the app doesn't draw ride along so the round trip to JSON Resume loses nothing
  for (const k of KEEP) if (Array.isArray(json[k]) && json[k].length) m[k] = clone(json[k]);
  adoptImported(m);
  if ((json.education ?? []).length > 1) m.education.push(...clone(json.education.slice(1)));
  if ((json.publications ?? []).length > 1) m.publications.push(...clone(json.publications.slice(1)));
  const versions = m.variants.length;
  return {
    model: m,
    review: {
      rows: [[t('imp.name'), m.basics.name || '—'], [t('imp.jobs'), String(m.work.length)], [t('imp.claims'), String(claims)],
        [t('imp.versions'), String(versions)], [t('imp.education'), String((json.education ?? []).length)], [t('imp.skillGroups'), String((m.skills ?? []).length)],
        [t('imp.photo'), photo === 'embedded' ? t('imp.embedded') : photo === 'linked' ? t('imp.linked') : t('imp.none')]],
      notShown: [...KEEP.filter(k => k !== 'references' && (json[k] ?? []).length).map(k => t('imp.keptForExport', { k, n: json[k].length })),
        ...((json.education ?? []).length > 1 ? [t('imp.moreEducation', { n: json.education.length - 1 })] : []),
        ...((json.work ?? []).filter(w => !(w.highlights ?? []).length && !w.summary).map(w => t('imp.noHighlights', { name: w.name ?? t('imp.aJob') })))],
    },
  };
}

const workKey = (w, i) => (typeof w?.id === 'string' && w.id ? w.id : `@${i}`);
const text = (model, id) => defaultVariant(model, id, DEFAULT_LANG)?.text ?? '';

export function outsideEdits(file){
  if (detect(file) !== 'library') return [];
  const rb = file.meta.resumeBuilder;
  const { model } = load(file);
  const out = [];
  const bs = file.basics?.summary;
  if (rb.summary && typeof bs === 'string' && bs !== text(model, rb.summary)) out.push({ kind: 'version', fact: rb.summary, text: bs, was: text(model, rb.summary), where: 'Summary' });
  (file.work ?? []).forEach((w, i) => {
    const ids = rb.highlights?.[workKey(w, i)] ?? [];
    const texts = Array.isArray(w.highlights) ? w.highlights : [];
    const job = model.work?.[i];
    texts.forEach((t, j) => {
      if (typeof t !== 'string' || !t.trim()) return;
      const id = ids[j];
      if (id && t !== text(model, id)){
        // a reorder is not an edit: only count it if no other claim of the job says it
        if (ids.some(x => text(model, x) === t)) return;
        out.push({ kind: 'version', fact: id, text: t, was: text(model, id), where: w.name ?? workKey(w, i) });
      } else if (!id && job) out.push({ kind: 'claim', work: job.id, text: t, where: w.name ?? job.id });
    });
  });
  return out;
}

export function applyOutsideEdits(model, edits){
  let n = 0;
  for (const e of edits){
    if (e.kind === 'version'){
      const from = defaultVariant(model, e.fact, DEFAULT_LANG);
      if (!from || from.text === e.text) continue;
      const v = addVersion(model, e.fact, { text: e.text, lang: DEFAULT_LANG, from: from.id, as: 'major' });
      setDefault(model, v.id);              // the body showed it as the record's text
      n++;
    } else if (e.kind === 'claim'){
      if (B.addBullet(model, e.work, e.text)) n++;
    }
  }
  return n;
}

export function readImport(text, name = 'file'){
  let json;
  try { json = JSON.parse(text); }
  catch (e){ return { kind: 'error', file: name, message: t('imp.notJson', { msg: e.message }) }; }
  const kind = detect(json);
  if (kind === 'library' || kind === 'library-v3'){
    const { model, warnings } = load(json);
    const outside = kind === 'library' ? outsideEdits(json) : [];
    const langs = [...new Set((model.variants ?? []).map(v => v.lang ?? 'en'))];
    return { kind: 'library', file: name, json, model, warnings, outside,
      review: { rows: [[t('imp.name'), model.basics?.name || '—'], [t('imp.jobs'), String((model.work ?? []).length)],
        ['Claims', String((model.facts ?? []).length)], ['Versions', String((model.variants ?? []).length)], ['Languages', langs.join(', ')],
        ...(kind === 'library-v3' ? [['Format', `${json.schema}, migrated on open`]] : []),
        ...(outside.length ? [['Edited outside Resume Builder', `${outside.length} text${outside.length === 1 ? '' : 's'}`]] : [])],
        notShown: [] } };
  }
  if (kind === 'backup'){
    const { model } = load(json.record);
    return { kind: 'backup', file: name, json, model,
      review: { rows: [[t('imp.name'), model.basics?.name || '—'], [t('imp.savedResumes'), String((json.resumes ?? []).length)],
        [t('imp.checkpoints'), String((json.checkpoints ?? []).length)], [t('imp.saved'), String(json.saved ?? '').slice(0, 10)]], notShown: [] } };
  }
  if (kind === 'resume' || kind === 'recipe-v3'){
    const got = loadResume(json);
    return { kind: 'resume', file: name, json, recipe: got.recipe, frozen: got.frozen,
      review: { rows: [[t('imp.resume'), [got.recipe.company, got.recipe.role].filter(Boolean).join(' — ') || got.recipe.title || got.recipe.application || name],
        [t('imp.picks'), String(Object.keys(got.recipe.picks ?? {}).length)]], notShown: [] } };
  }
  if (kind === 'theme') return { kind: 'theme', file: name, json, review: { rows: [[t('imp.theme'), json.name ?? name]], notShown: [] } };
  if (kind === 'jsonresume'){
    const got = fromJsonResume(json);
    return { kind: 'jsonresume', file: name, json, ...got };
  }
  return { kind: 'error', file: name, message: t('imp.unknown') };
}

export function picksMatched(model, recipe){
  const vs = new Set((model.variants ?? []).map(v => v.id));
  const all = Object.values(recipe.picks ?? {});
  return { matched: all.filter(v => vs.has(v)).length, total: all.length };
}

export { BODY_KEYS };
