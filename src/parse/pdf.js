// Not from OpenResume's parser; the adapter is after its read-pdf.ts (commit 4f8255a2c763479837f69f1dccf2a3338730cd79): a PDF as text items, read with the vendored PDF.js (vendor/pdfjs/, the one runtime dependency).
// PDF.js is loaded by a dynamic import() the first time a PDF is read. Each item is { text, x, y, width, height, fontName, hasEOL, page } with x and y from the item's transform (y grows upward, in the page's
// own points: `page` tells the pages apart and y starts again on each), height the font size, and fontName the font's real name from commonObjs (`fontExtraProperties` keeps it: in a browser the font object has only a made-up name
// without it; "-Bold" is added when the font is bold and its name does not say so, since the parser tells bold by the name). Pages follow each other; what the producer wrote is kept in the order it wrote it, with these repairs of what a PDF
// does to a page: a space PDF.js made from a gap is part of the text again (and is dropped before , . ; : ! or ?, which is glyph positioning); a bullet of any shape is "•"; letter-spaced capitals are one
// word; a page written in a jumbled order is put top to bottom; a short label in the left margin beside a line is a line of its own; and the lines of one paragraph or bullet that the page wrapped are one
// line again, so a PDF and the DOCX of the same resume give the same lines (`sameDocument`).
// shortcut: no cmaps, standard-font data or wasm are vendored, so text in a font the PDF does not embed (a CJK one) may be missing and a JPEG 2000 picture does not draw; add the folders and cMapUrl,
// standardFontDataUrl and wasmUrl when a real file needs them. A scan has no text and comes back as no items; the caller says so.
// shortcut: at most 30 pages (a resume is not longer); more is refused with the code 'big', as unzip does. Other codes: 'encrypted' (a password), 'pdf' (not a PDF that can be read), 'browser' (too old for PDF.js 6).
import { BULLET_POINTS } from './extract-resume-from-sections/lib/bullet-points.js';
import { shouldAddSpaceBetweenText } from './group-text-items-into-lines.js';

const DIR = new URL('../../vendor/pdfjs/', import.meta.url).href;
const MAX_PAGES = 30;
let lib;
async function load(){
  if (!lib){
    // PDF.js 6 uses built-ins that only a recent browser has (Map.prototype.getOrInsertComputed, Uint8Array.prototype.toHex). Node runs its worker on this thread, so Node gets plain versions; a browser runs the worker
    // in a realm of its own, which no polyfill here reaches: an older browser is told so, and every other format still reads.
    // shortcut: the non-legacy build is vendored (the smaller one, 6.x); vendor the legacy build, which brings its own, when an older browser has to read PDFs.
    if (typeof Worker === 'undefined'){
      Uint8Array.prototype.toHex ??= function(){ return Array.from(this, b => b.toString(16).padStart(2, '0')).join(''); };
      for (const M of [Map, WeakMap]){
        M.prototype.getOrInsert ??= function(k, v){ if (!this.has(k)) this.set(k, v); return this.get(k); };
        M.prototype.getOrInsertComputed ??= function(k, f){ if (!this.has(k)) this.set(k, f(k)); return this.get(k); };
      }
    } else if (!Map.prototype.getOrInsertComputed || !Uint8Array.prototype.toHex) throw Object.assign(new Error('This browser is too old to read a PDF'), { code: 'browser' });
    const mod = await import(DIR + 'pdf.min.mjs');
    mod.GlobalWorkerOptions.workerSrc = DIR + 'pdf.worker.min.mjs';
    lib = mod;
  }
  return lib;
}
const open = async bytes => {
  const pdfjs = await load();
  try { return await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, disableFontFace: true, isEvalSupported: false, fontExtraProperties: true }).promise; }
  catch (e){ throw Object.assign(new Error(e.name === 'PasswordException' ? 'This file is password protected' : 'This is not a PDF that can be read'), { code: e.name === 'PasswordException' ? 'encrypted' : 'pdf' }); }
};

const PUA_BULLET = /^[\uf0b7\uf0a7\uf0d8\uf0fc\uf076]/;      // the symbol-font bullets Word and LibreOffice leave, as in lines.js
// a bullet of any shape is "•", as the DOCX reader writes it, so one resume in PDF and in DOCX has the same lines
const bullet = t => (PUA_BULLET.test(t) ? t.replace(PUA_BULLET, '•') : BULLET_POINTS.includes(t.trim()) ? t.replace(t.trim(), '•') : t);
const isBullet = t => BULLET_POINTS.includes(t[0]) || /^[-–]\s/.test(t);
const PUNCT = /^[,.;:!?]/;
// a line of single capitals apart ("E X P E R I E N C E", "PAT E N T": a pair the font kerned stays together): four parts or more, most of them a single letter
const despace = t => {
  const w = t.trim().split(' ');
  return w.length >= 4 && w.every(p => /^(?:\p{Lu}{1,3}|&)$/u.test(p)) && w.filter(p => p.length === 1).length * 10 >= w.length * 6 ? t.trim().replace(/(?<=\p{Lu}) (?=\p{Lu})/gu, '') : t;
};

// One page's items, with the spaces PDF.js made from gaps kept in the text and the empty items that only end a line taken in
function pageItems(content, commonObjs, page){
  const out = [], all = content.items.filter(i => i.str !== undefined);
  all.forEach((it, k) => {
    const prev = out.at(-1);
    if (!it.str.trim()){
      if (!prev) return;
      if (it.hasEOL) prev.hasEOL = true;
      else if (!PUNCT.test(all[k + 1]?.str ?? '') && !prev.text.endsWith(' ') && it.width <= 2.5 * prev.height){ prev.text += ' '; prev.width += it.width; }      // a space before , . ; : ! or ? is glyph positioning; a gap of more than two ems is a gap, not a space
      return;
    }
    const f = commonObjs.has(it.fontName) ? commonObjs.get(it.fontName) : {}, name = f.name ?? f.loadedName ?? it.fontName;
    out.push({ text: despace(bullet(it.str)), x: it.transform[4], y: it.transform[5], width: it.width, height: it.height, fontName: f.bold && !/bold/i.test(name) ? `${name}-Bold` : name, hasEOL: it.hasEOL, page });
  });
  return out;
}

// rows: the items up to each end of line, with where the row is: y and size are those of its text (a symbol-font bullet sits a little off the baseline)
const rowAt = r => {
  const t = r.find(i => !isBullet(i.text.trim())) ?? r[0];
  return { r, x: r[0].x, y: t.y, h: t.height || 10, x1: r.reduce((m, i) => Math.max(m, i.x + i.width), 0), page: r[0].page };      // reduce, not a spread: a hostile row may hold 100,000 items
};
const rowsOf = items => {
  const rows = [];
  let row = [];
  for (const i of items){ row.push(i); if (i.hasEOL){ rows.push(row); row = []; } }
  if (row.length) rows.push(row);
  return rows.map(rowAt);
};

// A page the producer wrote in a jumbled order (the header last, say): more than two places where the next row is above the one before it, which two columns written one after the other never need. Put top to bottom, left to right on a row.
// shortcut: a table of cells written row by row is not told from a jumbled page; the parser's own column split sorts by column afterwards when it is sure
const jumbled = rows => rows.filter((r, i) => i && r.y > rows[i - 1].y + 1).length > 2;
const topDown = rows => {
  const sorted = [...rows].sort((a, b) => b.y - a.y), out = [];
  for (let i = 0, j; i < sorted.length; i = j){
    for (j = i + 1; j < sorted.length && sorted[i].y - sorted[j].y < 0.5 * sorted[i].h; j++);
    out.push(...sorted.slice(i, j).sort((a, b) => a.x - b.x));
  }
  return out;
};

// Where the text starts: the leftmost x that holds a fifth of the characters. A row that starts in the margin to the left of that (a section label, a tagline at the side) is cut in two: its
// margin items first, as a row of their own (moved to the text's edge: it is a line of the text, not a column), and what is beside them after. Margin rows one under the other are one item (a tagline set in three lines).
// shortcut: a margin item must end 8 pt or more before the text starts; a column that is the leftmost with a fifth of the text (a sidebar) is the text's start, not a margin
function margins(rows){
  const weight = new Map();
  for (const { r, x } of rows) weight.set(Math.round(x / 4), (weight.get(Math.round(x / 4)) ?? 0) + r.reduce((n, i) => n + i.text.length, 0));
  const total = [...weight.values()].reduce((a, b) => a + b, 0), edge = Math.min(...[...weight].filter(([, n]) => n * 5 >= total).map(([k]) => k * 4));
  if (!Number.isFinite(edge)) return rows;
  const gutter = i => i.x + i.width < edge - 8;
  const out = [];
  let tag;      // the last row of margin items, which the next one joins when it lies just under it, with a row of the text between them or not
  for (const row of rows){
    const k = row.r.findIndex(i => !gutter(i));
    for (const part of k > 0 ? [row.r.slice(0, k), row.r.slice(k)] : [row.r]){
      if (!part.every(gutter)){ out.push(rowAt(part)); continue; }
      const shift = edge - part[0].x, next = rowAt(part.map(i => ({ ...i, x: i.x + shift })));      // a margin item is a line of the text: at the text's edge, so the parser sees no column
      if (tag && tag.page === next.page && tag.y > next.y && tag.y - next.y <= 1.6 * tag.h){
        const one = tag.r[0];
        tag.r = [{ ...one, text: `${one.text} ${part.map(i => i.text).join(' ')}`, width: tag.r.concat(part).reduce((m, i) => Math.max(m, i.x + i.width), 0) - one.x }];
        Object.assign(tag, rowAt(tag.r), { y: next.y });
      } else out.push(tag = next);
    }
  }
  return out;
}

// The lines of a paragraph or bullet that the page wrapped, one line again. B goes on A when it starts where A's text starts, with no bullet, one line gap lower (a tenth more than the
// tightest gap in the document at that size), in the same size, and A runs to the right edge of its column but for the word B starts with.
// A word split at the line end is one word again when its hyphen is a soft hyphen or a hyphen PDF.js read as an item of its own (a browser's), or when the whole word is one of `known`
// (the file's own words, and the caller's); any other hyphen is a compound ("self-managed") and stays.
// shortcut: the gap is a tenth over the tightest, so a document that sets its bullets as close as its wrapped lines joins a bullet to the one above it (and a column narrower than nine ems is not a text: its
// short lines are never joined); a typesetter's hyphen in a word nobody knows stays
function joinWrapped(rows, known){
  const text = r => r.r.find(i => !isBullet(i.text.trim()))?.x ?? r.x;      // where the words of a row start: after its bullet
  const edge = new Map(), tight = new Map();
  rows.forEach((r, k) => {
    const key = `${r.page}:${Math.round(text(r) / 4)}`, up = rows[k - 1];
    edge.set(key, Math.max(edge.get(key) ?? 0, r.x1));
    if (up && up.page === r.page && Math.abs(up.h - r.h) < 0.3 && up.y > r.y) tight.set(Math.round(r.h), Math.min(tight.get(Math.round(r.h)) ?? Infinity, up.y - r.y));
  });
  const out = [];
  for (const b of rows){
    const a = out.at(-1), first = b.r[0], word = first.text.trim().split(/\s+/)[0], wordWidth = first.width * word.length / Math.max(first.text.length, 1);
    const right = a && edge.get(`${a.page}:${Math.round(text(a) / 4)}`);      // the longest line of its column: where lines wrap, when it is wide enough to be a text and not a list of short lines
    if (!(a && a.page === b.page && !isBullet(first.text.trim()) && Math.abs(text(a) - b.x) <= 3 && Math.abs(a.h - b.h) < 0.3 && a.y > b.y
      && a.y - b.y <= 1.12 * tight.get(Math.round(b.h)) && right - text(a) >= 9 * b.h && a.x1 + wordWidth + 12 >= right)){ out.push(b); continue; }
    const lone = a.r.length > 1 && a.r.at(-1).text === '-';
    if (lone) a.r.pop();
    const last = a.r.at(-1), tail = last.text.replace(/\s+$/, ''), head = b.r.map(i => i.text).join('');
    const frag = /(\p{L}+)[-\u00ad]$/u.exec(tail)?.[1], rest = /^\p{L}+/u.exec(head)?.[0];
    const split = lone || tail.endsWith('\u00ad') || (frag && /^\p{Ll}/u.test(head) && known.has(`${frag}${rest}`.toLowerCase()));
    last.text = split ? tail.replace(/[-\u00ad]$/, '') + head : /\p{L}-$/u.test(tail) && /^\p{Ll}/u.test(head) ? tail + head : `${tail} ${head}`;
    last.width += b.r.reduce((n, i) => n + i.width, 0);
    a.x1 = b.x1;      // the right end of the last line is what the next one is measured against
    (a.r[0].wrap ??= []).push(a.y - b.y);      // the parser counts it as a line gap, as it would have
    a.y = a.r[0].bottom = b.y;      // the next line is measured from this one, and the parser from its bottom
  }
  return out;
}

// The items of a row that touch (a gap of half an em at most, the parser's own test) are one item, as the parser would make them: here the spaces PDF.js made from gaps are known, and the text stays clean.
const glue = items => items.reduce((out, i) => {
  const p = out.at(-1);
  if (p && i.x - (p.x + p.width) <= 0.5 * p.height){
    p.text += (shouldAddSpaceBetweenText(p.text, i.text) ? ' ' : '') + i.text;
    p.width = i.x + i.width - p.x;
    p.hasEOL = i.hasEOL;
  } else out.push({ ...i });
  return out;
}, []).map(i => ({ ...i, text: i.text.trim() }));

// words: the lowercase words the caller knows (the record's), for the hyphens at line ends; optional
export async function readPdf(bytes, words = []){
  const doc = await open(bytes);
  if (doc.numPages > MAX_PAGES) throw Object.assign(new Error('This file is too large to read'), { code: 'big' });
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++){
    const page = await doc.getPage(n), content = await page.getTextContent();
    await page.getOperatorList();      // loads the fonts into commonObjs
    pages.push(pageItems(content, page.commonObjs, n));
  }
  const known = new Set([...words, ...pages.flat().flatMap(i => i.text.toLowerCase().match(/\p{L}+/gu) ?? [])]);
  return pages.flatMap(items => {
    let rows = rowsOf(items);
    if (jumbled(rows)) rows = topDown(rows);
    rows = joinWrapped(margins(rows), known);
    return rows.flatMap(row => glue(row.r.map((i, k) => ({ ...i, hasEOL: k === row.r.length - 1 }))));
  });
}

// Page 1 as a PNG data URL, `width` pixels wide, for the Library. Browser only: it draws on a canvas.
// shortcut: it needs a canvas, so Node cannot run it; checks/pdf-thumb-check.mjs draws one in a browser
export async function pdfThumb(bytes, width = 240){
  const page = await (await open(bytes)).getPage(1);
  const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas.toDataURL('image/png');
}
