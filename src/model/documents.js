// The files a person imported or exported, kept in the state with their text and details, and (with no linked folder) their bytes.
// Pure: each function changes the state it is given (a draft inside commit()) and returns what it made. No DOM, no I/O.
// A document is { id, name, type, size, sha256, addedAt, path?, embedded?, meta, from, taken, text, layout?, of?, with?, resume?, round?, archived? }. `embedded` is the original
// as a data: URL, which the store keeps outside its undo steps; `taken` is { claims, versions, skipped, unplaced }, what the record took from it; `layout` is a PDF's [{ page, headerBottom, split }] as the person left it; a cover letter has `with` (the document of the resume it was dropped with) and `resume` (the saved resume it went out with, by company and role) beside its `round`.

import { t, keyed, UI_LANGS } from '../i18n/index.js';
import { normText, wordMoves } from './record.js';

export const MAX_EMBED = 10 * 1024 * 1024;      // an original is embedded up to this many bytes
export const docId = sha => `doc-${sha.slice(0, 12)}`;      // one file is one document, on every device
const linesOf = text => new Set(String(text ?? '').split('\n').map(normText).filter(Boolean));
const find = (state, id) => (state.documents ?? []).find(d => d.id === id) ?? null;

export const findBySha = (state, sha) => (state.documents ?? []).find(d => d.sha256 === sha) ?? null;

// The same file again is the document it already is. `of`: the id sameDocument found, when this is another format of one; `round`: the current round.
// Embedded only when `path` (a file in the linked folder) is not given; the caller decides, and I-8 adds the reference.
export function addDocument(state, { name, type, bytesDataUrl, path, sha256, size, meta = {}, text = '', from = 'imported', layout, of, round, taken, addedAt = new Date().toISOString() }){
  if (!/^[0-9a-f]{64}$/.test(sha256 ?? '')) throw new Error('a document needs the sha256 of its file');
  const had = findBySha(state, sha256);
  if (had) return had;
  if (bytesDataUrl && !/^data:/.test(bytesDataUrl)) throw new Error('an original is embedded as a data: URL');
  const bytes = bytesDataUrl ? Math.floor((bytesDataUrl.length - bytesDataUrl.indexOf(',') - 1) * 3 / 4) : 0;      // measured here, not taken from the caller (base64 is 4 characters for 3 bytes)
  if (!path && bytes > MAX_EMBED) throw keyed('i2.tooBig', { mb: Math.ceil(bytes / 1e6), max: MAX_EMBED / 1024 / 1024 });
  const doc = { id: docId(sha256), name, type, size, sha256, addedAt, ...(path ? { path } : bytesDataUrl ? { embedded: bytesDataUrl } : {}), meta, from,
    taken: taken ?? { claims: [], versions: [], skipped: [], unplaced: 0 }, text, ...(layout ? { layout } : {}), ...(of ? { of } : {}), ...(round ? { round } : {}) };
  (state.documents ??= []).push(doc);
  return doc;
}

// Drops the original and keeps the text. The store's asset goes with the last reference.
// shortcut: nothing calls store.gcAssets() yet, so the bytes stay in memory until the page reloads (the browser copy is removed at the next save); upgrade when the Library calls it.
export function keepTextOnly(state, id){
  const d = find(state, id);
  if (d) delete d.embedded;
  return d;
}

export const alreadyImported = (state, sha) => (state.imports ?? []).find(e => e.sha256 === sha) ?? null;
// entry: { sha256, name, kind, at, result, recordId, saved }. The log is only ever added to, so a merge joins two of them as a union.
export function logImport(state, entry){ (state.imports ??= []).push(entry); return entry; }

// The document whose lines are at least 90% the same lines as `text`'s, both ways, after normText: another format of it. Null if none.
// shortcut: lines are compared as stored. DOCX, ODT, HTML, Markdown and text give whole lines (src/parse/), and the PDF reader joins the lines its page wrapped, so a PDF links to them; a PDF whose wrapped lines it cannot tell from separate ones (a tight list with no bullet mark) or whose columns it reads in another order is not linked.
export function sameDocument(state, text){
  const mine = linesOf(text);
  if (!mine.size) return null;
  return (state.documents ?? []).find(d => {
    const theirs = linesOf(d.text);
    let n = 0;
    for (const l of mine) if (theirs.has(l)) n++;
    return theirs.size > 0 && n / mine.size >= 0.9 && n / theirs.size >= 0.9;
  }) ?? null;
}

// The document a JSON Resume says it was read from (`meta.source`, a file name), if the Library holds it with a text.
export const sourceOf = (state, json) => {
  const name = normText(String(json?.meta?.source ?? '').split(/[\\/]/).pop());
  return name ? (state.documents ?? []).find(d => d.text && normText(d.name) === name) ?? null : null;
};

// The word check (spec, "With an AI assistant, optional"): every text of a JSON Resume an assistant made from a document, looked for in that document's text.
// Returns [{ path, text, found, near }]; `near` is the document's closest line to a text that is not in it, else null. Pure.
// Texts are compared word by word after normText (case, quotes, dashes, spaces and a final full stop do not count; a number, an email or a word with + or # keeps its own marks, so
// "C" is not "C++", "Java" not "JavaScript", "$15M" not "$1.5M"). A prose text (a highlight, a summary, a description) must be a whole line of the document; a short field (a name,
// a title, a skill, a contact item) must be whole words inside one line. A word split at a line end is joined first, with and without its hyphen.
// A date is in the document when its year is and, if it has a month, the month sits next to that year in one line, as a number or as a name in any interface language.
// shortcut: a bullet the document wrapped over two lines is two lines here (the readers give whole lines, a hard-wrapped text file does not), so it is listed; a link, a country code, a network
// name and `meta` are not compared; upgrade when a real file shows one of these wrongly listed.
const TOKEN = /[$€£¥]?[\p{L}\p{N}]+(?:[.,@/_'-][\p{L}\p{N}]+)*[+#%]*/gu;
const wordsOf = s => normText(s).match(TOKEN) ?? [];
const PROSE = /(?:^|\.)(?:highlights\.\d+|summary|description)$/;
const SKIP = /^(?:meta|\$schema)$|(?:^|\.)(?:url|image|countryCode|network)$/;
const DATE = /^(\d{4})(?:-(\d\d))?(?:-\d\d)?$/;
const monthNames = n => [...new Set(UI_LANGS.flatMap(l => ['long', 'short'].map(w => normText(new Intl.DateTimeFormat(l, { month: w, timeZone: 'UTC' }).format(Date.UTC(2000, n - 1, 15))))))].join('|');
function textsOf(o, path = '', out = []){
  if (typeof o === 'string'){ if (o.trim()) out.push({ path, text: o }); }
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)){ const p = path ? `${path}.${k}` : k; if (!SKIP.test(p)) textsOf(v, p, out); }
  return out;
}
const within = (w, l) => { for (let i = 0; i + w.length <= l.length; i++) if (w.every((x, k) => l[i + k] === x)) return true; return false; };
export function checkWords(json, docText){
  const doc = String(docText ?? '');
  const lines = [...new Set(['$1', '$1-'].flatMap(j => doc.replace(/(\p{L})[-\u00ad\u2010]\n(?=\p{L})/gu, j).split('\n')).map(s => s.trim()).filter(Boolean))];
  const toks = lines.map(wordsOf), whole = new Set(toks.map(w => w.join(' '))), flat = lines.map(normText);
  const inDate = (y, m) => {
    const name = m && `(?<!\\p{L})(?:${monthNames(+m)})(?!\\p{L})`;
    const re = !m ? new RegExp(`(?<!\\d)${y}(?!\\d)`, 'u')
      : new RegExp(`${name}[\\s.,]*(?:\\d{1,2}[\\s.,]*)?(?<!\\d)${y}(?!\\d)|(?<!\\d)${y}[\\s.,]*${name}|(?<!\\d)0?${+m}\\s*[./-]\\s*${y}(?!\\d)|(?<!\\d)${y}\\s*[./-]\\s*0?${+m}(?!\\d)`, 'u');
    return flat.some(l => re.test(l));
  };
  return textsOf(json).map(({ path, text }) => {
    const d = DATE.exec(text.trim()), w = wordsOf(text);
    const found = d ? inDate(d[1], d[2]) : !w.length || (PROSE.test(path) ? whole.has(w.join(' ')) : toks.some(l => within(w, l)));
    let near = null, best = 0;
    if (!found) for (const l of lines){ const s = wordMoves(normText(l), normText(text)).shared; if (s > best){ best = s; near = l; } }
    return { path, text, found, near };
  });
}

// The ids of this state's documents that a saved backup (the parsed brewcv.json) holds, original included, with the same sha256.
// shortcut: the file's bytes are not hashed again, its sha256 is taken as it says; upgrade with a check at the Check-a-saved-file step.
export function inFile(state, backup){
  const held = new Set((backup?.documents ?? []).filter(d => typeof d?.embedded === 'string' && d.embedded.startsWith('data:')).map(d => d.sha256));      // a dangling asset: ref holds nothing
  return (state.documents ?? []).filter(d => held.has(d.sha256)).map(d => d.id);
}

const at = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
// The receipt's three ticks and the verdict (spec, "Is my old file safe to delete?"), each worked out from what is stored:
//   read, record, kept: { ok, state, text }; safe: all three; text: the verdict.
// folderVerified: the file was read back from the linked folder and its hash checked. lastFileSave: { at } of the last Save to file here.
// checked: { at, ids } where ids is inFile()'s answer for a brewcv.json the person picked after the import: a download alone proves nothing.
export function safety(doc, { folderVerified = false, lastFileSave = null, checked = null } = {}){
  const n = linesOf(doc.text).size, un = doc.taken?.unplaced ?? 0;
  const read = n ? { ok: true, state: 'read', text: t('i2.read', { n }) } : { ok: false, state: 'unread', text: t('i2.notRead') };
  const record = !n ? { ok: false, state: 'none', text: t('i2.noneInRecord') }
    : un ? { ok: false, state: 'unplaced', text: t('i2.unplaced', { n: un }) } : { ok: true, state: 'in', text: t('i2.inRecord') };
  const kept = doc.path && folderVerified ? { ok: true, state: 'folder', text: t('i2.keptFolder', { path: doc.path }) }
    : doc.embedded && checked?.ids?.includes(doc.id) ? { ok: true, state: 'file', text: t('i2.keptFile', { time: at(checked.at) }) }
    : doc.embedded && lastFileSave?.at >= doc.addedAt ? { ok: false, state: 'saved', text: t('i2.keptSaved', { time: at(lastFileSave.at) }) }
    : doc.embedded ? { ok: false, state: 'browser', text: t('i2.keptBrowser') }
    : { ok: false, state: 'none', text: t('i2.keptNone') };
  const safe = read.ok && record.ok && kept.ok;
  return { read, record, kept, safe, text: t(safe ? 'i2.safe' : 'i2.notSafe') };
}
