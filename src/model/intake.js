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
import { t } from '../i18n/index.js';
import { fromJsonResume } from './import.js';
import { diffRecords, applyItems, matchJob, sim } from './diff.js';
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
export const TYPES = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', odt: 'application/vnd.oasis.opendocument.text',
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
export async function readFile(bytes, name, { lexicon, words = [] } = {}){
  if (bytes.length > MAX_FILE) throw coded('big', 'This file is too large to read');
  const kind = identify(bytes, name);
  if (kind === 'doc') throw coded('doc', 'This is an old Word file');
  if (['image', 'json', 'other'].includes(kind)) return { kind };
  if (kind === 'linkedin'){
    const got = await readLinkedin(bytes);
    const lines = strs(got.jsonResume).map(text => ({ text, page: 1 }));
    return { kind, items: [], lines, text: lines.map(l => l.text).join('\n'), boxes: [], pages: 1, layout: [], ...got };
  }
  const pdf = kind === 'pages' ? await readPages(bytes) : kind === 'pdf' ? bytes : null;
  const items = pdf ? await readPdf(pdf, words) : await READ[kind](bytes);
  return { kind, items, ...(pdf ? { pdf } : {}), ...analyse(items, lexicon) };
}

// "2024-03-12 Acme - Product Designer (hu).pdf": the date, company and role a file's name carries (the folder layout's names); else the file's own date.
const NAME = /^(\d{4}-\d\d-\d\d)[ _]+(.+?)(?: - (.+?))?(?: \([^)]*\))?\.[A-Za-z0-9]+$/;
export function metaOf(name, modified){
  const m = NAME.exec(name);
  return { company: m?.[2] ?? '', role: m?.[3] ?? '', date: m?.[1] ?? (modified ? new Date(modified).toISOString().slice(0, 10) : ''), lang: '', jobType: '', kind: 'resume' };
}

export function dataUrl(bytes, type = 'application/octet-stream'){
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(s)}`;
}

// ---- lines with no home ----

// Page clutter is dropped without asking: page numbers, "Page 1 of 2", the name or contact details repeated in a header or footer, "References available on request".
// shortcut: the page and reference words are those of the ten interface languages as written here, not read from the catalogues; add a language's words when a real file shows one missing.
const PAGE = /^(?:(?:page|oldal|seite|pagina|página|strona|strana|side|pg\.?|p\.)\s*)?\d{1,3}(?:\s*(?:\/|of|de|von|di|z|ze|sur|van|från)\s*\d{1,3})?$/iu;
const REFS = /^(?:references?|referenc\w*|referenz\w*|référence\w*|hivatkoz\w*)\b[^.]{0,40}\b(?:request|demand\w*|solicit\w*|anfrage|richiest\w*|pedido|aanvraag|życzenie|vyžádání|kérésre|available|disponib\w*|verfügbar|beschikbaar|dostępn\w*|rendelkezésre)/iu;
export function isClutter(text, basics = {}){
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
        else { e.status = r.doubts.some(d => d.kind === 'letter') ? 'letter' : 'resume'; docs.push({ id: DOC.docId(e.sha256), name: e.name, text: r.text }); }
      }
    }
    shas.set(e.sha256, new Date().toISOString());
  }
  return entries;
}

// ---- the plan ----

const versionsOf = (record, factId) => { const f = record.facts.find(x => x.id === factId); return (f?.variants ?? []).map(id => record.variants.find(v => v.id === id)).filter(Boolean); };
const textOfFact = (model, id) => versionsOf(model, id)[0]?.text ?? '';
// a text some version the person deleted had (the marks a delete leaves, matched by the hash of the words)
const deletedBefore = (record, text) => Object.entries(record.removed ?? {}).find(([k, m]) => k.startsWith('variant:') && m?.hash === fnv(normText(text)))?.[1] ?? null;

// The lines of one job of the file against the claims of the job it matches. Exact words add nothing; 60% of the words of one claim is a new wording of it;
// of two claims, a choice for the person; of none, a new line. The matched job is left with no lines in `model`, so diffRecords only looks at the details.
function linesOfJob(record, model, tj, fj, items, needs){
  const claims = (fj.highlights ?? []).map(id => ({ id, vs: versionsOf(record, id) }));
  const entry = fj.name;
  for (const th of tj.highlights ?? []){
    const text = textOfFact(model, th), x = normText(text);
    if (!x || claims.some(c => c.vs.some(v => normText(v.text) === x))) continue;
    const near = claims.map(c => ({ c, best: c.vs.map(v => ({ v, s: sim(v.text, text) })).sort((a, b) => b.s - a.s)[0] })).filter(n => n.best && n.best.s >= 0.6).sort((a, b) => b.best.s - a.best.s);
    const wording = n => d => { if (d.record.facts.some(f => f.id === n.c.id)) addVersion(d.record, n.c.id, { text, lang: 'en', n: suggestNumber(d.record, n.c.id, text).n }); };
    const line = d => { const w = d.record.work.find(y => y.id === fj.id); if (w) B.addBullet(d.record, w.id, text); };
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

// What joining the entries with status 'resume' (and the letters, formats and unread files) to `state` would do. `fresh`: an empty or example career, which starts from the newest file.
// Returns { entries, start, sim, files: [{ entry, items, needs, unplaced, link }] }; the caller shows them and makes the ticks, picks and placements in place.
// shortcut: dates that agree to the year ("2019" and "2019-03") are a choice, not a suggestion of the more precise one; a second stay at one organisation is not offered, the file's job is the same job by name; two lines of the file that fit one claim are two new wordings.
export function plan(state, entries, { fresh = false, lexicon = {} } = {}){
  const rec = clone(state.record), world = { record: rec, resumes: clone(state.resumes ?? []), frozen: {} };
  const todo = entries.filter(e => e.status === 'resume').sort((a, b) => (a.modified ?? 0) - (b.modified ?? 0) || a.name.localeCompare(b.name));
  const start = fresh && todo.length ? todo.pop() : null;
  if (start){ world.record = fromJsonResume(start.read.jsonResume).model; world.resumes = []; }
  const workWords = withEnglish(lexicon).sections.work;
  const files = [];
  const unplacedOf = (e, extra = []) => {
    const r = e.read, basics = r.jsonResume?.basics ?? {};
    const corpus = corpusOf(world.record), seen = new Set();
    const out = [];
    const add = (text, section, line, page) => { if (line != null && seen.has(line)) return; if (line != null) seen.add(line); out.push({ text, section, line, page, choice: '' }); };
    for (const l of r.leftovers ?? []) if (!isClutter(l.text, basics)) add(l.text, l.section, l.line, l.page);
    // a text of the file that is in no part of the career, and that no item above carries (a school, a skill, a project)
    for (const { path } of r.trace ?? []){
      if (SKIPPED.test(path)) continue;
      const v = get(r.jsonResume, path), n = Number((r.trace.find(x => x.path === path) ?? {}).line);
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

  if (start) files.push({ entry: start, items: [], needs: [], unplaced: unplacedOf(start), base: true });
  for (const e of todo){
    const model = fromJsonResume(e.read.jsonResume).model, items = [], needs = [];
    // the lines worth comparing by their id: the summary, the skills lines and a job's own; the person's details are values below, and a school or a language is looked for in the career's words
    const keep = new Set(['summary', ...(model.skills ?? []).map(x => x.id)]);
    model.facts = model.facts.filter(f => keep.has(f.id) || f.work);
    for (const tj of model.work ?? []){
      const fj = matchJob(tj, world.record.work);
      if (fj){ linesOfJob(world.record, model, tj, fj, items, needs); delete tj.display?.meta; }      // a job's date line is compared as its dates
    }
    const diff = diffRecords(world.record, model).filter(x => x.kind !== 'keep' || x.apply);
    items.push(...diff);
    // the default ticks, so the next file (and the lines with no home) see the career as it will be
    applyItems(world, items);
    files.push({ entry: e, items, needs, unplaced: unplacedOf(e) });
  }
  for (const e of entries.filter(x => x.status === 'letter')){
    const mate = entries.find(x => ['resume', 'format'].includes(x.status));
    const covered = s => versionsOfAll(world.record).some(v => sim(v, s) >= 0.6);
    const sentences = e.read.text.split(/\n+/).flatMap(l => l.split(/(?<=[.!?])\s+/)).map(s => s.trim()).filter(s => s.split(/\s+/).length >= 6 && !covered(s));
    // the saved resume it went out with (its company and role are in the file's name), and a saved resume for that role that has no company yet is offered it, unticked
    const meta = metaOf(e.name, e.modified), mine = state.resumes ?? [];
    const sent = meta.company ? mine.find(r => normText(r.company) === normText(meta.company) && (!meta.role || normText(r.role) === normText(meta.role))) : null;
    const offers = meta.company && meta.role ? mine.filter(r => !r.company && normText(r.role) === normText(meta.role)).map(r => ({ kind: 'add', as: 'other', entry: '', what: t('i6.setCompany', { resume: resumeLabel(r) }), b: meta.company, on: false,
      apply: d => { const x = (d.resumes ?? []).find(y => y.id === r.id); if (x) x.company = meta.company; } })) : [];
    files.push({ entry: e, items: offers, needs: [], unplaced: unplacedOf({ ...e, read: { ...e.read, leftovers: [], trace: [] } }, sentences), link: mate?.sha256 ?? null, resume: sent?.id ?? null });
  }
  for (const e of entries.filter(x => ['format', 'unread'].includes(x.status))) files.push({ entry: e, items: [], needs: [], unplaced: [] });
  return { entries, start, sim: world, files, saved: world.resumes };
}
const versionsOfAll = record => record.facts.filter(f => !/-(position|meta)$/.test(f.id)).flatMap(f => versionsOf(record, f.id).map(v => v.text));

// The menu for a line with no home: the jobs (the one printed above it first), the claims it is closest to, and the skills groups.
export function placeOptions(p, u){
  const rec = p.sim.record, years = w => `${String(w.startDate ?? '').slice(0, 4)}–${w.endDate ? String(w.endDate).slice(0, 4) : t('diff.present')}`;
  const jobs = (rec.work ?? []).map(w => ({ value: `job:${w.id}`, label: `${w.name} · ${years(w)}`, above: w.id === u.above })).sort((a, b) => b.above - a.above);
  const claims = (rec.work ?? []).flatMap(w => w.highlights ?? []).map(id => ({ id, best: Math.max(0, ...versionsOf(rec, id).map(v => sim(v.text, u.text))), text: versionsOf(rec, id)[0]?.text ?? id }))
    .filter(c => c.best >= 0.25).sort((a, b) => b.best - a.best).slice(0, 3).map(c => ({ value: `claim:${c.id}`, label: clip(c.text, 70) }));
  return { jobs, claims, skills: (rec.skills ?? []).map(s => ({ value: `skills:${s.id}`, label: s.name })) };
}

// ---- applying ----

const stampOf = (name, at) => `Imported from ${name}, ${String(at).slice(0, 10)}`;
// Every version a file added gets its source, the tag `imported` (in the career's list of tags) and the document it came from; none is made the default of a claim that had one.
function stamp(d, before, e, at){
  const fresh = d.record.variants.filter(v => !before.v.has(v.id));
  if (fresh.length){
    const tags = ((d.record.vocabulary ??= {}).tags ??= []);
    if (!tags.includes('imported')) tags.push('imported');
    for (const v of fresh){ v.source ??= stampOf(e.name, at); v.tags = [...new Set([...(v.tags ?? []), 'imported'])]; v.origin = { doc: e.sha256.slice(0, 12) }; }
  }
  return { claims: d.record.facts.filter(f => !before.f.has(f.id)).map(f => f.id), versions: fresh.map(v => v.id) };
}
const place = (d, u) => {
  const [kind, id] = String(u.choice).split(/:(.*)/s);
  if (kind === 'job') B.addBullet(d.record, id, u.text);
  else if (kind === 'claim' || kind === 'skills'){
    const f = d.record.facts.find(x => x.id === id);
    if (!f) return;
    const text = kind === 'skills' ? `${versionsOf(d.record, id).find(v => v.id === f.default?.en)?.text ?? ''}, ${u.text}`.replace(/^, /, '') : u.text;
    addVersion(d.record, id, { text, lang: 'en', n: suggestNumber(d.record, id, text).n });
  }
};

// Joins the plan to the draft state `d` (inside store.commit): the career, a document for every file, the import log. Returns the documents made.
// An original is embedded when it is 10 MB or less; with a linked folder it is a file in Library/ instead (I-8), until then it is embedded here as well.
export function applyPlan(d, p, { at = new Date().toISOString() } = {}){
  if (p.start){
    d.record = fromJsonResume(p.start.read.jsonResume).model;
    d.resumes = []; d.frozen = {}; d.cur = newResume(d.record, { format: 'a4' }); d.openId = null;
  }
  const made = [];
  for (const f of p.files){
    const e = f.entry, r = e.read ?? {};
    const before = p.start === e ? { f: new Set(), v: new Set() } : { f: new Set(d.record.facts.map(x => x.id)), v: new Set(d.record.variants.map(x => x.id)) };
    applyItems(d, f.items);
    for (const n of f.needs) if (n.chosen != null) n.options[n.chosen].apply(d);
    const skipped = [...f.items.filter(x => x.kind === 'add' && !x.on).map(x => x.b ?? x.what), ...f.needs.filter(n => n.chosen == null).map(n => n.b), ...f.unplaced.filter(u => u.choice === 'skip').map(u => u.text)].map(s => clip(s, 80));
    for (const u of f.unplaced) place(d, u);
    const taken = { ...stamp(d, before, e, at), skipped, unplaced: f.unplaced.filter(u => !u.choice).length };
    if (['resume', 'letter', 'format', 'unread'].includes(e.status)){
      const type = e.type || TYPES[r.kind] || 'application/octet-stream';
      const round = (d.resumes ?? []).find(r => r.id === f.resume)?.round;
      const link = e.status === 'letter' ? { ...(f.link ? { with: DOC.docId(f.link) } : {}), ...(f.resume ? { resume: f.resume } : {}), ...(round ? { round } : {}) } : {};
      const doc = DOC.addDocument(d, { name: e.name, type, sha256: e.sha256, size: e.size, addedAt: at,
        bytesDataUrl: e.size <= DOC.MAX_EMBED && e.bytes ? dataUrl(e.bytes, type) : undefined,
        meta: { ...metaOf(e.name, e.modified), kind: e.status === 'letter' ? 'cover-letter' : e.status === 'unread' ? 'other' : 'resume' },
        text: r.text ?? '', from: 'imported', layout: r.pdf ? (e.layout ?? r.layout) : undefined, of: e.of?.id, taken });
      Object.assign(doc, link);
      made.push(doc);
    }
    DOC.logImport(d, { sha256: e.sha256, name: e.name, kind: r.kind ?? 'other', at, result: e.status, recordId: d.record.recordId ?? null, saved: e.modified ? new Date(e.modified).toISOString() : null });
  }
  return made;
}
