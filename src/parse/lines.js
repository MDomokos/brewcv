// Not from OpenResume. What every reader of a format with no page positions shares: the text cleaned, and the paragraphs turned into text items.
//
// A reader hands over paragraphs, { runs: [{ text, bold }], bullet?, level? }, in reading order. A tab or a gap of two spaces inside a
// run starts a new item on the same line (a date at the right of a company), "\n" starts a new line. A paragraph that is a list item
// gets a bullet glyph in front. `side` ('header' or 'footer') marks a paragraph that is not part of the page's text: it is kept in the reading order for the document's text and left out of the heading count. A heading has a `level` (a Heading style's number, the # count, h1 to h3): it is bold, and it is a section title
// only at the top level the document uses after its first two lines (the name), so Heading 2 job lines under Heading 1 sections stay jobs.
// An empty paragraph is a blank line: it leaves a gap in `y`, which is how the parser tells one job from the next. `y` is minus the line
// number (it grows upward, as in a PDF). The parser is never given positions to guess columns from: every line starts at x = 0, so a page of
// these is one column and no doubt.

// Mends what extraction breaks in any file and leaves what the person typed: ligatures, soft and zero-width characters, odd spaces. Quotes, dashes,
// capitals, "C# and .NET", "Compétences : Python" and "Industrie- und Handelskammer" stay as written; normText (src/model/record.js) smooths them for
// matching only. The rules that mend only a PDF (a space before punctuation, a word split at a line end) belong to the PDF reader.
export const clean = s => String(s ?? '').replace(/[ﬀ-ﬆ]/g, c => c.normalize('NFKC')).replace(/[\u00ad\u200b]/g, '').replace(/\s+/g, ' ').trim();

// shortcut: a gap of two spaces is found inside one run of text, not across two runs (a Word run cut between the spaces), and not after . ! or ?
// (sentence spacing, so "Inc.  2020" is not split); join the runs first or look at the next word when a real file needs it
const GAP = /\t|\u2003|(?<![.!?\s])[ \u00a0]{2,}/;
export const BULLET = /^\s*(?:[-*+•·▪●◦○■–]|\d{1,2}[.)])\s+/;      // shortcut: "12. March" at the start of a line reads as a list item

// UTF-8, or UTF-16 with a byte order mark, or (when the bytes are not UTF-8) Windows-1252, the way a Windows editor saves a text file
// shortcut: Central European single-byte text (Windows-1250, ISO-8859-2) is read as Windows-1252 and shows wrong letters (ő, ű, ř); add a guess or ask the person when a real file needs it
export function decode(bytes){
  const [a, b] = bytes;
  if (a === 0xff && b === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (a === 0xfe && b === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}

// shortcut: the entities below and a letter with a mark (&eacute; &scaron; &odblac; &aogon;); any other is left as written
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', shy: '\u00ad', copy: '©', reg: '®', trade: '™', deg: '°', euro: '€', times: '×', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', bull: '•', hellip: '…', middot: '·', emsp: '\u2003', ensp: '\u2002', thinsp: '\u2009', szlig: 'ß', aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø', lstrok: 'ł', Lstrok: 'Ł', rarr: '→', larr: '←' };
const MARKS = { acute: '\u0301', grave: '\u0300', circ: '\u0302', uml: '\u0308', tilde: '\u0303', cedil: '\u0327', ring: '\u030a', caron: '\u030c', ogon: '\u0328', dblac: '\u030b' };
// a number that is no character (zero, a surrogate, past U+10FFFF, a control) is dropped; 128 to 159 are Windows-1252, as a browser reads them
const char = c => {
  if (c >= 128 && c < 160) c = new TextDecoder('windows-1252').decode(Uint8Array.of(c)).codePointAt(0);
  const bad = !(c > 0 && c <= 0x10ffff) || (c >= 0xd800 && c < 0xe000) || (c < 32 && c !== 9 && c !== 10 && c !== 13) || (c >= 127 && c < 160);
  return bad ? '\0' : String.fromCodePoint(c);      // \0 marks a dropped one, so the space it leaves can go
};
export const unescape = s => s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (m, d, h, n) => {
  if (d || h) return char(d ? +d : parseInt(h, 16));
  const k = /^([a-z])(acute|grave|circ|uml|tilde|cedil|ring|caron|ogon|dblac)$/i.exec(n);
  return k ? (k[1] + MARKS[k[2].toLowerCase()]).normalize('NFC') : NAMED[n] ?? m;
}).replace(/( ?)\0( ?)/g, (m, a, b) => (a && b ? ' ' : a + b));      // "a &#0; b" is "a b", not "a  b" (two spaces would be a gap)

// The tags and the text of an XML or HTML source, in one pass that cannot go back over what it has read: yields { text, depth } or { name (lower case), close, self, tag, depth },
// depth being how many elements are open (counting this one on an open tag, not on a close). A close tag closes the nearest open element of its name, and so any that were left open inside it
// (one with no open element of that name closes nothing). Comments, <!...> and <?...> are skipped; <![CDATA[...]]> is text with `raw`; a tag runs to the first > outside quotes;
// the content of script and style is skipped; a < that starts no tag is text.
export function* scan(s){
  let i = 0;
  const open = [], count = new Map();      // the open elements, and how many of each name
  while (i < s.length){
    const lt = s.indexOf('<', i);
    if (lt !== i){ yield { text: s.slice(i, lt < 0 ? s.length : lt), depth: open.length }; if (lt < 0) return; i = lt; }
    if (s.startsWith('<!--', i)){ const e = s.indexOf('-->', i + 4); i = e < 0 ? s.length : e + 3; continue; }
    if (s.startsWith('<![CDATA[', i)){ const e = s.indexOf(']]>', i + 9); yield { text: s.slice(i + 9, e < 0 ? s.length : e), raw: true, depth: open.length }; i = e < 0 ? s.length : e + 3; continue; }
    if (!/[a-z/!?]/i.test(s[i + 1] ?? '')){ yield { text: '<', depth: open.length }; i++; continue; }
    let j = i + 1, q = '';
    for (; j < s.length && (q || s[j] !== '>'); j++) if (q ? s[j] === q : s[j] === '"' || s[j] === "'") q = q ? '' : s[j];
    const tag = s.slice(i, j + 1), m = /^<(\/?)([a-z][\w:.-]*)/i.exec(tag);
    i = j + 1;
    if (!m) continue;
    const name = m[2].toLowerCase(), close = !!m[1], self = tag.endsWith('/>');
    if (close){
      if (count.get(name) > 0){ const k = open.lastIndexOf(name); for (let x = open.length - 1; x >= k; x--) count.set(open[x], count.get(open[x]) - 1); open.length = k; }      // cost: the elements it closes
    } else if (!self){ open.push(name); count.set(name, (count.get(name) ?? 0) + 1); }
    yield { name, close, self, tag, depth: open.length };
    if (!close && !self && (name === 'script' || name === 'style')){ const re = new RegExp(`</${name}`, 'gi'); re.lastIndex = i; i = re.exec(s)?.index ?? s.length; }
  }
}
// Skipping the elements `is(name)` picks: call it with every event and skip the event when it says true. An element left open ends where the element
// that holds it ends (its parent's close tag), so a stray <button> or <mc:Fallback> does not take the rest of the file.
export function skipping(is){
  let at = 0;
  return e => {
    if (at && e.depth >= at) return true;      // inside it; its own close tag, or its parent's, has a smaller depth
    at = e.name && !e.close && !e.self && is(e.name) ? e.depth : 0;
    return at > 0;
  };
}
export const attr = (tag, name) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag)?.slice(1).find(x => x !== undefined);

// Paragraphs in reading order. One opened inside another (a text box, a frame) is read as its own lines after the one it sits in, so the host stays whole.
// shortcut: boxes nest at most four deep; a deeper paragraph starts beside the one above it, which keeps hostile files linear
export function paragraphs(){
  const out = [], stack = [];
  return {
    out, get cur(){ return stack.at(-1)?.p; },
    open(p){ if (stack.length >= 4) this.close(); stack.push({ p, after: [] }); return p; },
    close(){ const e = stack.pop(); if (e){ const to = stack.at(-1)?.after ?? out; to.push(e.p); for (const x of e.after) to.push(x); } },
    end(){ while (stack.length) this.close(); return out; },
  };
}

export function itemsOf(paras){
  const items = [];
  let y = 0, seen = 0;
  let top = Infinity;      // the top heading level: the smallest, not counting the first two lines
  for (const p of paras) if (!p.side && p.runs.some(r => r.text.trim()) && seen++ >= 2 && p.level && p.level < top) top = p.level;
  for (const p of paras){
    const lines = [[]];
    for (const r of p.runs) r.text.split('\n').forEach((text, k) => { if (k) lines.push([]); lines.at(-1).push({ text, bold: r.bold }); });
    lines.forEach((runs, k) => {
      const parts = [{ text: '', bold: true, any: false }];
      for (const r of runs) r.text.split(GAP).forEach((text, j) => {
        if (j) parts.push({ text: '', bold: true, any: false });
        const part = parts.at(-1);
        part.text += text;
        if (text.trim()){ part.any = true; if (!r.bold) part.bold = false; }
      });
      const line = parts.map(s => ({ text: clean(s.text), bold: !!p.level || (s.any && s.bold) })).filter(s => s.text);
      let x = 0;
      line.forEach((s, j) => {
        const text = p.bullet && !k && !j ? `• ${s.text}` : s.text, width = text.length * 5;
        items.push({ text, x, y, width, height: 10, fontName: s.bold ? 'Sans-Bold' : 'Sans', hasEOL: j === line.length - 1, ...(p.level === top ? { title: true } : {}), ...(p.side ? { side: p.side } : {}) });
        x += width + 20;      // a gap wider than the parser's typical letter, so the parts stay apart
      });
      y--;
    });
  }
  return items;
}
