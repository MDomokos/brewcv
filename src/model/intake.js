// A dropped file, read and joined to the career: everything behind the import screens (src/ui/files.js) that is not a screen. No DOM, no storage.
//   readFile     bytes to the lines, text and JSON Resume the parser found (src/parse/); a file it cannot read throws an error with a `code`
//   classify     what each file of a drop is: new, merged before, another format of one, a cover letter, a file kept unread
//   plan         what joining the new ones to the career would do: ticks, choices for the person, and lines with no home
//   applyPlan    does it, inside the one commit the caller makes
// A claim of the file is matched to the career's by its words (60% shared is a new wording of that claim), never by its id. Nothing here rewrites a
// word, deletes or overwrites: a different value is a choice for the person, a new wording is a new version that is never the default.

import { identify } from '../parse/identify.js';
import { parseResume } from '../parse/index.js';
import { splitColumns } from '../parse/split-columns.js';
import { groupTextItemsIntoLines } from '../parse/group-text-items-into-lines.js';
import { groupLinesIntoSections } from '../parse/group-lines-into-sections.js';
import { withEnglish } from '../parse/lexicon.js';
import { readDocx } from '../parse/docx.js';
import { readOdt } from '../parse/odt.js';
import { readHtml } from '../parse/html.js';
import { readMd } from '../parse/md.js';
import { readTxt } from '../parse/txt.js';
import { readPages } from '../parse/pages.js';
import { readLinkedin } from '../parse/linkedin.js';
import { readPdf } from '../parse/pdf.js';
import { t, UI_LANGS, catalogue, loadCatalogue } from '../i18n/index.js';
import { fromJsonResume, lexiconFor } from './import.js';
import { diffRecords, applyItems, matchJob, sim, org } from './diff.js';
import { entriesOf } from './entries.js';
import { addEntryClaim, addProject, addLanguage, addCertificate, addInterest, addPublication, addKindEntry, kindsOf } from './career.js';
import { addVersion, suggestNumber, normText, wordDiff } from './record.js';
import { newResume } from './resume.js';
import { resumeLabel } from './resumes.js';
import * as B from './build.js';
import * as DOC from './documents.js';
import { fnv } from '../store/store.js';

const clone = x => structuredClone(x);
const clip = (s, n = 60) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const strs = (o, out = []) => { if (typeof o === 'string') out.push(o); else if (o && typeof o === 'object') for (const v of Object.values(o)) strs(v, out); return out; };
const get = (o, path) => path.split('.').reduce((x, k) => x?.[k], o);
const coded = (code, message) => Object.assign(new Error(message), { code });

// ---- reading ----

export const MAX_FILE = 64 * 1024 * 1024;      // the readers' own limits (unzip: 64 MB inflated; pdf: 30 pages) come on top of this
const READ = { docx: readDocx, odt: readOdt, html: readHtml, md: readMd, txt: readTxt };
const TYPES = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', odt: 'application/vnd.oasis.opendocument.text',
  html: 'text/html', md: 'text/markdown', txt: 'text/plain', pages: 'application/vnd.apple.pages', linkedin: 'application/zip' };

// The words the parser may hyphenate-join with: the career's own.
export const wordsOf = record => [...new Set((record?.variants ?? []).flatMap(v => String(v.text).toLowerCase().match(/\p{L}+/gu) ?? []))];

// Lines, sections as boxes on their page ({ page, label, x0, y0, x1, y1 } in the page's points, y up), and the parser's answer, for the items under `layout`.
export function analyse(items, lexicon, layout){
  const got = parseResume(items, lexicon, layout);
  const rows = groupTextItemsIntoLines(splitColumns(items.some(i => i.side) ? items.filter(i => !i.side) : items, got.layout));
  const lines = rows.map(l => ({ text: l.map(i => i.text).join(' ').trim(), page: l[0].page ?? 1 }));
  const boxes = [];
  for (const [label, ls] of Object.entries(groupLinesIntoSections(rows, withEnglish(lexicon)))){
    const byPage = new Map();
    for (const l of ls) for (const i of l){ const b = byPage.get(i.page ?? 1) ?? { page: i.page ?? 1, label, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }; byPage.set(b.page, b); b.x0 = Math.min(b.x0, i.x); b.y0 = Math.min(b.y0, i.y); b.x1 = Math.max(b.x1, i.x + i.width); b.y1 = Math.max(b.y1, i.y + i.height); }
    boxes.push(...byPage.values());
  }
  return { ...got, lines, text: lines.map(l => l.text).join('\n'), boxes, pages: items.reduce((n, i) => Math.max(n, i.page ?? 1), 1) };
}

// { kind } for what is not read here (image, json, other); else { kind, items, lines, text, jsonResume, trace, leftovers, layout, doubts, boxes, pages, pdf? }.
// Throws an error with a `code` (zip, zip64, encrypted, method, big, empty, pdf, pages-preview, doc) when the file cannot be read.
// `lang`: the language to read it in (its catalogue's section words, month names and "present", beside English). `fixed` reads it in that language only; else, when that reading
// has lines it could not place or no job, every interface language is tried and the reading with the most jobs, then the fewest leftovers, is kept.
export async function readFile(bytes, name, { lang = 'en', words = [], fixed = false } = {}){
  if (bytes.length > MAX_FILE) throw coded('big', 'This file is too large to read');
  const kind = identify(bytes, name);
  if (kind === 'doc') throw coded('doc', 'This is an old Word file');
  if (['image', 'json', 'other'].includes(kind)) return { kind };
  if (kind === 'linkedin'){
    const got = await readLinkedin(bytes);
    const lines = strs(got.jsonResume).map(text => ({ text, page: 1 }));
    return { kind, items: [], lines, text: lines.map(l => l.text).join('\n'), boxes: [], pages: 1, layout: [], lang, ...got };
  }
  const pdf = kind === 'pages' ? await readPages(bytes) : kind === 'pdf' ? bytes : null;
  const items = pdf ? await readPdf(pdf, words) : await READ[kind](bytes);
  return { kind, items, ...(pdf ? { pdf } : {}), ...(fixed ? readIn(items, lang) : await bestRead(items, lang)) };
}
export const readIn = (items, lang, layout) => ({ lang, ...analyse(items, lexiconFor(lang), layout) });
async function bestRead(items, first){
  let r = readIn(items, first);
  if (!r.doubts.some(d => d.kind === 'leftovers' || d.kind === 'jobs')) return r;
  await Promise.all(UI_LANGS.map(loadCatalogue));
  const jobs = x => x.jsonResume.work?.length ?? 0;
  for (const l of UI_LANGS) if (l !== first && catalogue(l)){ const x = readIn(items, l); if (jobs(x) > jobs(r) || (jobs(x) === jobs(r) && x.leftovers.length < r.leftovers.length)) r = x; }
  return r;
}

// "2024-03-12 Acme - Product Designer (hu).pdf": the date, company and role a file's name carries (the folder layout's names); else the file's own date.
const NAME = /^(\d{4}-\d\d-\d\d)[ _]+(.+?)(?: - (.+?))?(?: \([^)]*\))?\.[A-Za-z0-9]+$/;
function metaOf(name, modified){
  const m = NAME.exec(name);
  return { company: m?.[2] ?? '', role: m?.[3] ?? '', date: m?.[1] ?? (modified ? new Date(modified).toISOString().slice(0, 10) : ''), lang: '', jobType: '', kind: 'resume' };
}

function dataUrl(bytes, type = 'application/octet-stream'){
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(s)}`;
}

// ---- lines with no home ----

// Page clutter is dropped without asking: page numbers, "Page 1 of 2", the name or contact details repeated in a header or footer, "References available on request".
// shortcut: the page and reference words are those of the ten interface languages as written here, not read from the catalogues; add a language's words when a real file shows one missing.
const PAGE = /^(?:(?:page|oldal|seite|pagina|página|strona|strana|side|pg\.?|p\.)\s*)?\d{1,3}(?:\s*(?:\/|of|de|von|di|z|ze|sur|van|från)\s*\d{1,3})?$/iu;
const REFS = /^(?:references?|referenc\w*|referenz\w*|référence\w*|hivatkoz\w*)\b[^.]{0,40}\b(?:request|demand\w*|solicit\w*|anfrage|richiest\w*|pedido|aanvraag|życzenie|vyžádání|kérésre|available|disponib\w*|verfügbar|beschikbaar|dostępn\w*|rendelkezésre)/iu;
function isClutter(text, basics = {}){
  const x = normText(text);
  if (!x || PAGE.test(x) || REFS.test(x)) return true;
  const mine = [basics.name, basics.email, basics.phone, basics.url, basics.location?.city, basics.label].map(normText).filter(Boolean);
  return !mine.reduce((rest, v) => rest.split(v).join(' '), x).replace(/[^\p{L}\p{N}]+/gu, '');      // nothing left once the person's own details are taken out
}

// the career's words, to tell whether a text is already in it (whole words, case and punctuation aside)
const corpusOf = record => normText(strs({ ...record, removed: undefined, vocabulary: undefined }).join('\n'));
const inCorpus = (corpus, text) => {
  const x = normText(text);
  return x.length < 2 || new RegExp(`(?<![\\p{L}\\p{N}])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(corpus);
};
// Paths of the file's JSON Resume that no diff item carries to the career: the work lines are matched by their words, the person's details by value.
const SKIPPED = /^(?:work\.|basics\.(?:name|label|email|phone|url|location)\b)|Date$/;

// ---- what each file is ----

// Sets `status` on each entry ({ name, sha256, read | error }): error (could not be read), skip (a picture or a data file: opened on its own), unread (kept as a file),
// seen (merged before; `seen` is when), format (another format of a document: `of`), letter, resume. A PDF is judged after the formats whose text is exact.
export function classify(state, entries){
  const docs = [...(state.documents ?? [])], shas = new Map();
  for (const e of [...entries].sort((a, b) => (a.read?.kind === 'pdf') - (b.read?.kind === 'pdf'))){
    delete e.of; delete e.seen;
    const r = e.read;
    if (e.error) e.status = 'error';
    else if (['image', 'json'].includes(r.kind)) e.status = 'skip';
    else if (r.kind === 'other' || !r.lines?.length) e.status = 'unread';
    else {
      const was = DOC.alreadyImported(state, e.sha256)?.at ?? DOC.findBySha(state, e.sha256)?.addedAt ?? shas.get(e.sha256);
      if (was){ e.status = 'seen'; e.seen = was; }
      else {
        const same = DOC.sameDocument({ documents: docs }, r.text);
        if (same){ e.status = 'format'; e.of = same; }
        else { e.status = r.doubts.some(d => d.kind === 'letter') ? 'letter' : 'resume'; docs.push({ id: DOC.docId(e.sha256), name: e.name, text: r.text, kind: e.status === 'letter' ? 'cover-letter' : 'resume' }); }
      }
    }
    shas.set(e.sha256, new Date().toISOString());
  }
  return entries;
}

// ---- the plan ----

const kindOfDoc = d => d.kind ?? d.meta?.kind ?? 'resume';
// An empty career has no name, summary, skills, entries or saved resumes: only that, or the example, starts from a file. Any other is joined.
export const isEmpty = ({ record: r, resumes }) => !String(r?.basics?.name ?? '').trim() && !r?.basics?.summary && !(r?.skills ?? []).length && !entriesOf(r).length && !(r?.education ?? []).length && !(resumes ?? []).length;

const versionsOf = (record, factId) => { const f = record.facts.find(x => x.id === factId); return (f?.variants ?? []).map(id => record.variants.find(v => v.id === id)).filter(Boolean); };
const textOfFact = (model, id) => versionsOf(model, id)[0]?.text ?? '';
// a text some version the person deleted had (the marks a delete leaves, matched by the hash of the words)
const deletedBefore = (record, text) => Object.entries(record.removed ?? {}).find(([k, m]) => k.startsWith('variant:') && m?.hash === fnv(normText(text)))?.[1] ?? null;

// The lines of one job of the file against the claims of the job it matches. Exact words add nothing; 60% of the words of one claim is a new wording of it;
// of two claims, a choice for the person; of none, a new line. The matched job is left with no lines in `model`, so diffRecords only looks at the details.
// A wording takes the language of the version it matched; a new line, the file's.
const SRC = 'Imported';      // stamped over with the file's name and day once the import is applied
function linesOfEntry(record, model, tj, fj, items, needs, lang){
  const claims = (fj.highlights ?? []).map(id => ({ id, vs: versionsOf(record, id) }));
  const entry = fj.name ?? fj.organization;
  for (const th of tj.highlights ?? []){
    const text = textOfFact(model, th), x = normText(text);
    if (!x || claims.some(c => c.vs.some(v => normText(v.text) === x))) continue;
    const near = claims.map(c => ({ c, best: c.vs.map(v => ({ v, s: sim(v.text, text) })).sort((a, b) => b.s - a.s)[0] })).filter(n => n.best && n.best.s >= 0.6).sort((a, b) => b.best.s - a.best.s);
    const wording = n => d => { const L = n.best.v.lang ?? 'en'; if (d.record.facts.some(f => f.id === n.c.id)) addVersion(d.record, n.c.id, { text, lang: L, n: suggestNumber(d.record, n.c.id, text, L).n }); };
    const line = d => { if (entriesOf(d.record).some(y => y.id === fj.id)) addEntryClaim(d.record, fj.id, text, lang, SRC); };
    const label = n => t('i6.newWording', { claim: clip(n.best.v.text, 48) });
    const gone = deletedBefore(record, text);      // what the person deleted is never added again by itself: it is listed, unticked
    const back = x => (gone ? { ...x, kind: 'keep', on: false, what: `${t('i0.deletedOn', { date: String(gone.at ?? '').slice(0, 10) })} · ${x.what}` } : x);
    if (near.length > 1){
      needs.push({ entry, what: t('i6.twoFit'), b: text, chosen: null, options: [...near.slice(0, 3).map(n => ({ text: label(n), apply: wording(n) })), { text: t('i6.newLine'), apply: line }] });
    } else if (near.length){
      items.push(back({ kind: 'add', as: 'wording', entry, what: label(near[0]), diff: wordDiff(near[0].best.v.text, text), on: true, apply: wording(near[0]) }));
    } else items.push(back({ kind: 'add', as: 'line', entry, what: t('i6.newLine'), b: text, on: true, apply: line }));
  }
  tj.highlights = [];
}

// Education and projects are entries too: matched by id (a project), then by organisation with overlapping dates, then by name alone; a detail the file has and mine lacks is added,
// another value is a change, a school or project mine lacks is added. A project's lines go through the same matching as a job's.
const overlap = (a, b) => { const [s1, e1] = [a.startDate ?? '', a.endDate ?? '9999'], [s2, e2] = [b.startDate ?? '', b.endDate ?? '9999']; return !s1 || !s2 || (s1 <= e2 && s2 <= e1); };
const matchEntry = (x, list, name, byId = true) => (byId && x.id && list.find(y => y.id === x.id)) || list.find(y => org(name(y)) === org(name(x)) && overlap(x, y)) || list.find(y => org(name(y)) === org(name(x))) || null;
// the file's value agrees with mine when one holds the other ("Lisbon" in "Lisbon, Portugal", "2019" in "2019-03")
const agree = (a, b) => { const x = normText(a), y = normText(b); return x === y || (!!x && !!y && (x.includes(y) || y.includes(x))); };
function fieldItems(mine, theirs, fields, entry, set){
  const out = [];
  for (const [k, label] of fields){
    const b = theirs[k], a = mine[k] ?? '';
    if (!b || b === '—' || agree(a, b)) continue;      // "—" is what a missing part is written as
    out.push({ kind: a ? 'change' : 'add', as: 'other', entry, what: `${entry} · ${label}`, a, b, on: !a, apply: d => set(d, k, b) });
  }
  return out;
}
const dateFields = [['startDate', () => t('diff.start')], ['endDate', () => t('diff.end')]];
// a school, as one more entry of the career (the first also makes the education section)
function addSchool(record, e){
  const f = { institution: e.institution || '—', studyType: e.studyType || '—', area: e.area || '—', ...(e.startDate ? { startDate: e.startDate } : {}), ...(e.endDate ? { endDate: e.endDate } : {}), ...(e.score ? { score: e.score } : {}) };
  if (!(record.education ?? []).length) B.setEducation(record, f);
  else record.education.push({ id: B.slug(f.institution, new Set(record.education.map(x => x.id)), 'edu'), ...f });
}
const eduAt = (d, x) => (d.record.education ?? []).find(y => y.id === x.id && y.institution === x.institution);

// What joining the entries with status 'resume' (and the letters, formats and unread files) to `state` would do. `fresh`: an empty or example career, which starts from the newest file.
// Returns { entries, start, sim, files: [{ entry, items, needs, unplaced, link }] }; the caller shows them and makes the ticks, picks and placements in place.
// shortcut: dates that agree to the year ("2019" and "2019-03") are a choice, not a suggestion of the more precise one; a second stay at one organisation is not offered, the file's job is the same job by name; two lines of the file that fit one claim are two new wordings.
export function plan(state, entries, { fresh = false } = {}){
  const rec = clone(state.record), world = { record: rec, resumes: clone(state.resumes ?? []), frozen: {} };
  const langOf = e => e.read?.lang ?? 'en';
  // a copy of a document (another format of it, or a revised one) is planned like any resume: its lines that are not in the career are offered; a copy of a letter is not
  const todo = entries.filter(e => e.status === 'resume' || (e.status === 'format' && kindOfDoc(e.of) !== 'cover-letter')).sort((a, b) => (a.modified ?? 0) - (b.modified ?? 0) || a.name.localeCompare(b.name));
  const si = fresh ? todo.map(e => e.status).lastIndexOf('resume') : -1;
  const start = si >= 0 ? todo.splice(si, 1)[0] : null;
  if (start){ world.record = fromJsonResume(start.read.jsonResume, langOf(start)).model; world.resumes = []; }
  const files = [];
  const unplacedOf = (e, extra = []) => {
    const r = e.read, basics = r.jsonResume?.basics ?? {}, workWords = withEnglish(lexiconFor(langOf(e))).sections.work;
    const corpus = corpusOf(world.record), seen = new Set();
    // a copy's lines that its original already had were offered then
    const had = e.of ? { has: x => ` ${normText(e.of.text).replace(/\n+/g, ' ')} `.includes(` ${normText(x)} `) } : null;
    const out = [];
    const add = (text, section, line, page) => { if (line != null && seen.has(line)) return; if (line != null) seen.add(line); if (had?.has(normText(text))) return; out.push({ text, section, line, page, choice: '' }); };
    for (const l of r.leftovers ?? []) if (!isClutter(l.text, basics)) add(l.text, l.section, l.line, l.page);
    // a text of the file that is in no part of the career, and that no item above carries (a language, a patent, a skill)
    for (const { path } of r.trace ?? []){
      if (SKIPPED.test(path)) continue;
      const v = get(r.jsonResume, path), n = Number((r.trace.find(x => x.path === path) ?? {}).line);
      if (path.startsWith('education.') && (world.record.education ?? []).some(y => y.institution && normText(r.lines[n - 1]?.text).includes(normText(y.institution)))) continue;      // a school the career has
      if (typeof v === 'string' && !inCorpus(corpus, v) && r.lines[n - 1]) add(r.lines[n - 1].text, path.split('.')[0], n, r.lines[n - 1].page);
    }
    for (const x of extra) add(x, 'letter', null);
    // the entry printed above each line in the file, for the menu to offer first
    const starts = (r.jsonResume?.work ?? []).map((w, i) => ({ w, line: Math.min(...r.trace.filter(x => x.path.startsWith(`work.${i}.`)).map(x => x.line)) })).filter(s => Number.isFinite(s.line));
    for (const u of out){
      const above = starts.filter(s => s.line <= u.line).sort((a, b) => b.line - a.line)[0];
      if (above && workWords.some(w => String(u.section).toLowerCase().includes(w))) u.above = matchJob({ id: null, name: above.w.name, startDate: above.w.startDate }, world.record.work)?.id ?? null;
    }
    return out;
  };
  const done = (e, items, needs, extra = {}) => { const f = { entry: e, lang: langOf(e), items, needs, unplaced: unplacedOf(e), ...extra }; e.news = !!(items.length || needs.length || f.unplaced.length); return f; };

  if (start) files.push(done(start, [], [], { base: true }));
  for (const e of todo){
    const lang = langOf(e), model = fromJsonResume(e.read.jsonResume, lang).model, items = [], needs = [];
    // projects first: their lines are looked for by their words, so their facts are not compared by id
    for (const tp of model.projects ?? []){
      const fp = matchEntry(tp, world.record.projects ?? [], x => x.name);
      if (fp){
        linesOfEntry(world.record, model, tp, fp, items, needs, lang);
        items.push(...fieldItems(fp, tp, [['entity', t('i6.fWith')], ...dateFields.map(([k, l]) => [k, l()]), ['location', t('diff.place')]], fp.name, (d, k, v) => { const x = (d.record.projects ?? []).find(y => y.id === fp.id); if (x) x[k] = v; }));
      } else {
        const bullets = (tp.highlights ?? []).map(id => textOfFact(model, id)).filter(Boolean);
        items.push({ kind: 'add', as: 'job', entry: tp.name, what: t('i6.newProject'), b: `${tp.name}${bullets.length ? ` · ${t('diff.claims', { n: bullets.length })}` : ''}`, on: true,
          apply: d => { if (!matchEntry(tp, d.record.projects ?? [], x => x.name)) addProject(d.record, { name: tp.name, entity: tp.entity, startDate: tp.startDate, endDate: tp.endDate, location: tp.location, bullets, lang, source: SRC }); } });
      }
    }
    // schools
    for (const te0 of model.education ?? []){
      const te = te0.startDate && !te0.endDate ? { ...te0, startDate: undefined, endDate: te0.startDate } : te0;      // one date on a school is the year it ended
      const fe = matchEntry(te, world.record.education ?? [], x => x.institution, false)
        ?? (world.record.education ?? []).find(y => y.institution && normText(`${te.studyType} ${te.area} ${te.institution}`).includes(normText(y.institution)));      // a line of degree and school in one is read as the degree
      if (fe) items.push(...fieldItems(fe, te, [['studyType', t('i6.fStudy')], ['area', t('i6.fArea')], ...dateFields.map(([k, l]) => [k, l()]), ['score', t('i6.fScore')]], fe.institution, (d, k, v) => { const x = eduAt(d, fe); if (x) x[k] = v; }));
      else if (te.institution) items.push({ kind: 'add', as: 'job', entry: te.institution, what: t('i6.newSchool'), b: [te.studyType, te.area, te.endDate].filter(Boolean).join(' · '), on: true, apply: d => { if (!matchEntry(te, d.record.education ?? [], x => x.institution, false)) addSchool(d.record, te); } });
    }
    // the lines worth comparing by their id: the summary, the skills lines and a job's own; the person's details are values below
    const keep = new Set(['summary', ...(model.skills ?? []).map(x => x.id)]);
    model.facts = model.facts.filter(f => keep.has(f.id) || f.work);
    for (const tj of model.work ?? []){
      const fj = matchJob(tj, world.record.work);
      if (fj){ linesOfEntry(world.record, model, tj, fj, items, needs, lang); delete tj.display?.meta; }      // a job's date line is compared as its dates
    }
    const diff = diffRecords(world.record, model).filter(x => x.kind !== 'keep' || x.apply);
    items.push(...diff);
    // a choice a copy of the same document already put to the person is put once
    const key = x => `${x.what}|${x.a}|${x.b}`;
    for (let i = items.length; i--;) if (items[i].kind === 'change' && files.some(f => f.items.some(y => y.kind === 'change' && key(y) === key(items[i])))) items.splice(i, 1);
    // the default ticks, so the next file (and the lines with no home) see the career as it will be
    applyItems(world, items);
    files.push(done(e, items, needs));
  }
  for (const e of entries.filter(x => x.status === 'letter')){
    const mate = entries.find(x => ['resume', 'format'].includes(x.status));
    const covered = s => versionsOfAll(world.record).some(v => sim(v, s) >= 0.6);
    const sentences = e.read.text.split(/\n+/).flatMap(l => l.split(/(?<=[.!?])\s+/)).map(s => s.trim()).filter(s => s.split(/\s+/).length >= 6 && !covered(s));
    // the saved resume it went out with (its company and role are in the file's name), and a saved resume for that role that has no company yet is offered it, unticked
    const meta = metaOf(e.name, e.modified), mine = state.resumes ?? [];
    const apart = r => Math.abs(Date.parse(r.savedAt || r.date) - Date.parse(meta.date)) || 0;      // the nearest in date when several went to that company and role
    const sent = meta.company ? mine.filter(r => normText(r.company) === normText(meta.company) && (!meta.role || normText(r.role) === normText(meta.role))).sort((a, b) => apart(a) - apart(b))[0] : null;
    const offers = meta.company && meta.role ? mine.filter(r => !r.company && normText(r.role) === normText(meta.role)).map(r => ({ kind: 'add', as: 'other', entry: '', what: t('i6.setCompany', { resume: resumeLabel(r) }), b: meta.company, on: false,
      apply: d => { const x = (d.resumes ?? []).find(y => y.id === r.id); if (x) x.company = meta.company; } })) : [];
    files.push({ entry: e, lang: langOf(e), items: offers, needs: [], unplaced: unplacedOf({ ...e, read: { ...e.read, leftovers: [], trace: [] } }, sentences), link: mate?.sha256 ?? null, resume: sent?.id ?? null });
  }
  for (const e of entries.filter(x => x.status === 'unread' || (x.status === 'format' && kindOfDoc(x.of) === 'cover-letter'))) files.push({ entry: e, lang: 'en', items: [], needs: [], unplaced: [] });
  return { entries, start, sim: world, files, saved: world.resumes };
}
const versionsOfAll = record => record.facts.filter(f => !/-(position|meta)$/.test(f.id)).flatMap(f => versionsOf(record, f.id).map(v => v.text));

// ---- a JSON Resume from an AI assistant ----

// Runs the word check (DOC.checkWords) over the merge items of a JSON Resume (diffRecords(record, ...)): an item that would put a text its original does not have into the career
// starts unticked, marked `notIn` with the original's name, and a line or wording is shown against the original's nearest line. With no original, nothing starts ticked.
// shortcut: an item is tied to a missing text by applying it to a copy of the career and seeing the text arrive, so a text the career already has is never tied to an item, and a text of the
// file that no item carries (a school, a skill) is counted on the screen but not listed; upgrade when the plain merge reads those.
export function checkItems(items, json, doc, record){
  if (!doc){ for (const x of items) x.on = false; return; }
  const missing = DOC.checkWords(json, doc.text).filter(r => !r.found), had = corpusOf(record);
  for (const x of items){
    if (x.kind === 'keep' || !x.apply) continue;
    const d = { record: clone(record), resumes: [], frozen: {} };
    try { x.apply(d); } catch { continue; }
    const after = corpusOf(d.record), m = missing.find(r => !inCorpus(had, r.text) && inCorpus(after, r.text));
    if (!m) continue;
    x.on = false; x.notIn = doc.name;
    if (m.near && ['line', 'wording'].includes(x.as)) x.diff = wordDiff(m.near, m.text);
  }
}

// The menu for a line with no home: the jobs and other entries (the one printed above it first), the claims it is closest to, the skills groups, and another section.
const LISTS = ['languages', 'certificates', 'interests', 'publications', 'education'];
export function placeOptions(p, u){
  const rec = p.sim.record, years = w => (w.startDate ? ` · ${String(w.startDate).slice(0, 4)}–${w.endDate ? String(w.endDate).slice(0, 4) : t('diff.present')}` : '');
  const jobs = entriesOf(rec).map(w => ({ value: `job:${w.id}`, label: `${w.name ?? w.organization}${years(w)}`, above: w.id === u.above })).sort((a, b) => b.above - a.above);
  const claims = entriesOf(rec).flatMap(w => w.highlights ?? []).map(id => ({ id, best: Math.max(0, ...versionsOf(rec, id).map(v => sim(v.text, u.text))), text: versionsOf(rec, id)[0]?.text ?? id }))
    .filter(c => c.best >= 0.25).sort((a, b) => b.best - a.best).slice(0, 3).map(c => ({ value: `claim:${c.id}`, label: clip(c.text, 70) }));
  const sections = [...LISTS.map(k => ({ value: `list:${k}`, label: t(`doc.section.${k}`) })), ...kindsOf(rec).map(k => ({ value: `kind:${k.id}`, label: k.name?.[uiName(k)] ?? k.id }))];
  return { jobs, claims, skills: (rec.skills ?? []).map(s => ({ value: `skills:${s.id}`, label: s.name })), sections };
}
const uiName = k => (k.name?.en ? 'en' : Object.keys(k.name ?? {})[0]);

// ---- applying ----

const stampOf = (name, at) => `Imported from ${name}, ${String(at).slice(0, 10)}`;
// Every version a file added gets its source, the tag `imported` (in the career's list of tags) and the document it came from; none is made the default of a claim that had one.
function stamp(d, before, e, at){
  const fresh = d.record.variants.filter(v => !before.v.has(v.id));
  if (fresh.length){
    const tags = ((d.record.vocabulary ??= {}).tags ??= []);
    if (!tags.includes('imported')) tags.push('imported');
    for (const v of fresh){ v.source = stampOf(e.name, at); v.tags = [...new Set([...(v.tags ?? []), 'imported'])]; v.origin = { doc: e.sha256.slice(0, 12) }; }
  }
  return { claims: d.record.facts.filter(f => !before.f.has(f.id)).map(f => f.id), versions: fresh.map(v => v.id) };
}
// A line put in another section becomes an entry of its list: "Portuguese: Native" a language and its level, a school (the text as its name) one more education entry.
const IN_LIST = {
  languages: (m, text, lang) => { const [language, ...rest] = text.split(/\s*[:–—]\s+|:\s*/); addLanguage(m, { language, fluency: rest.join(' ') }, lang); },
  certificates: (m, text) => addCertificate(m, { name: text }),
  interests: (m, text, lang) => addInterest(m, { name: text }, lang),
  publications: (m, text, lang) => addPublication(m, { name: text }, lang),
  education: (m, text) => addSchool(m, { institution: text }),
};
const place = (d, u, lang) => {
  const [kind, id] = String(u.choice).split(/:(.*)/s);
  if (kind === 'job') { if (entriesOf(d.record).some(x => x.id === id)) addEntryClaim(d.record, id, u.text, lang, SRC); }
  else if (kind === 'list') IN_LIST[id]?.(d.record, u.text, lang);
  else if (kind === 'kind'){ if (kindsOf(d.record).some(k => k.id === id)) addKindEntry(d.record, id, { name: u.text, lang, source: SRC }); }
  else if (kind === 'claim' || kind === 'skills'){
    const f = d.record.facts.find(x => x.id === id);
    if (!f) return;
    const text = kind === 'skills' ? `${versionsOf(d.record, id).find(v => v.id === f.default?.en)?.text ?? ''}, ${u.text}`.replace(/^, /, '') : u.text;
    addVersion(d.record, id, { text, lang, n: suggestNumber(d.record, id, text, lang).n });
  }
};

// Joins the plan to the draft state `d` (inside store.commit): the career, a document for every file, the import log. Returns the documents made.
// An original is embedded when it is 10 MB or less; with a linked folder it is a file in Library/ instead (I-8), until then it is embedded here as well.
export function applyPlan(d, p, { at = new Date().toISOString() } = {}){
  if (p.start){
    d.record = fromJsonResume(p.start.read.jsonResume, p.start.read.lang ?? 'en').model;
    d.resumes = []; d.frozen = {}; d.cur = newResume(d.record, { format: 'a4' }); d.openId = null;
  }
  const made = [];
  for (const f of p.files){
    const e = f.entry, r = e.read ?? {};
    const before = p.start === e ? { f: new Set(), v: new Set() } : { f: new Set(d.record.facts.map(x => x.id)), v: new Set(d.record.variants.map(x => x.id)) };
    applyItems(d, f.items);
    for (const n of f.needs) if (n.chosen != null) n.options[n.chosen].apply(d);
    const skipped = [...f.items.filter(x => x.kind === 'add' && !x.on).map(x => x.b ?? x.what), ...f.needs.filter(n => n.chosen == null).map(n => n.b), ...f.unplaced.filter(u => u.choice === 'skip').map(u => u.text)].map(s => clip(s, 80));
    for (const u of f.unplaced) place(d, u, f.lang);
    const left = f.unplaced.filter(u => !u.choice).map(u => u.text);
    const taken = { ...stamp(d, before, e, at), skipped, unplaced: left.length, ...(left.length ? { lines: left } : {}) };
    if (['resume', 'letter', 'format', 'unread'].includes(e.status)){
      const type = e.type || TYPES[r.kind] || 'application/octet-stream';
      const mate = e.status === 'letter' ? (d.resumes ?? []).find(r => r.id === f.resume) : null;
      const round = mate ? mate.round : DOC.currentRound(d)?.id;      // a letter is in its resume's round; any other import, in the current one
      const link = e.status === 'letter' ? { ...(f.link ? { with: DOC.docId(f.link) } : {}), ...(f.resume ? { resume: f.resume } : {}) } : {};
      const doc = DOC.addDocument(d, { name: e.name, type, sha256: e.sha256, size: e.size, addedAt: at,
        bytesDataUrl: e.size <= DOC.MAX_EMBED && e.bytes ? dataUrl(e.bytes, type) : undefined,
        meta: { ...metaOf(e.name, e.modified), kind: e.status === 'letter' ? 'cover-letter' : e.status === 'unread' ? 'other' : e.of ? kindOfDoc(e.of) : 'resume', lang: r.lang ?? '' },
        text: r.text ?? '', from: 'imported', layout: r.pdf ? (e.layout ?? r.layout) : undefined, of: e.of?.id, taken, thumb: e.thumb, round });
      Object.assign(doc, link);
      made.push(doc);
    }
    DOC.logImport(d, { sha256: e.sha256, name: e.name, kind: r.kind ?? 'other', at, result: e.status, recordId: d.record.recordId ?? null, saved: e.modified ? new Date(e.modified).toISOString() : null });
  }
  return made;
}

// Puts lines a document left unplaced where the person says (the same menu as at import, `place`): [{ text, choice }]. The versions made are stamped as at import; the document's
// `taken` follows (a line put away, or marked "not a resume line", is no longer unplaced).
// shortcut: a line is offered with the career's jobs in order, not the entry printed above it in the document (that is not kept); a document imported before its lines were kept lists none.
export function placeLines(d, id, picks, { at = new Date().toISOString() } = {}){
  const doc = (d.documents ?? []).find(x => x.id === id);
  if (!doc) return;
  const before = { f: new Set(d.record.facts.map(x => x.id)), v: new Set(d.record.variants.map(x => x.id)) }, done = picks.filter(u => u.choice);
  for (const u of done) place(d, u, doc.meta?.lang || 'en');
  const got = stamp(d, before, doc, at), put = new Set(done.map(u => u.text)), left = (doc.taken?.lines ?? []).filter(x => !put.has(x));
  const { lines, ...rest } = doc.taken ?? {};
  doc.taken = { ...rest, claims: [...(rest.claims ?? []), ...got.claims], versions: [...(rest.versions ?? []), ...got.versions],
    skipped: [...(rest.skipped ?? []), ...done.filter(u => u.choice === 'skip').map(u => clip(u.text, 80))], unplaced: left.length, ...(left.length ? { lines: left } : {}) };
}

// The claims a cover letter leans on, read only: each sentence of six words or more against the career's versions (`sim`, 60%), the best claim of each, once. [{ fact, text }]
export function mentions(record, text){
  const out = new Map();
  for (const s of String(text ?? '').split(/\n+/).flatMap(l => l.split(/(?<=[.!?])\s+/)).map(x => x.trim()).filter(x => x.split(/\s+/).length >= 6)){
    let best = null;
    for (const f of record.facts.filter(x => !/-(position|meta)$/.test(x.id) && !x.archived)) for (const v of versionsOf(record, f.id)){ const m = sim(v.text, s); if (m >= 0.6 && (!best || m > best.m)) best = { fact: f.id, text: v.text, m }; }
    if (best && !out.has(best.fact)) out.set(best.fact, { fact: best.fact, text: best.text });
  }
  return [...out.values()];
}
