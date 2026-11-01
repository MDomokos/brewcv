// What a listed fixture may not hold even though its bytes are listed (checks/lib/manifest.mjs): a PDF's Info dictionary with any text (any key, a hex or UTF-16 string, an indirect value, an incremental update,
// an object stream), an XMP packet with anything in it (compressed or not, with the x: prefix or without), a DOCX or ODT part of document properties (core, app, custom, meta) with a text, and an author on a comment
// or a tracked change. Returns a reason, or null.
// shortcut: an Info dictionary is found by its /Info reference in the file or its decoded streams and read as text (PDF strings, hex strings and the objects they point at); every version of the object is read,
// the old ones too, so an update that blanks it again does not hide the first.
import zlib from 'node:zlib';
import { unzip } from '../../src/parse/unzip.js';

const STRING = /\((?:\\[\s\S]|[^\\()])*\)|<[0-9A-Fa-f\s]*>/g;
const blank = v => {
  const h = v.slice(1, -1).replace(/\s/g, ''), text = v[0] === '(' ? v.slice(1, -1) : Buffer.from(h.length % 2 ? h + '0' : h, 'hex').toString('latin1');
  return !text.replace(/[\0\s\u00fe\u00ff]/g, '');      // spaces, zero bytes and a UTF-16 byte order mark
};

export function pdfMetadata(buf){
  const raw = buf.toString('latin1'), texts = [raw], objects = new Map();
  const define = (n, body) => objects.set(n, [...(objects.get(n) ?? []), body]);
  for (const m of raw.matchAll(/(?:^|[\s>])(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g)) define(+m[1], m[2]);
  for (const m of raw.matchAll(/stream\r?\n/g)){
    let t;
    try { t = zlib.inflateSync(buf.subarray(m.index + m[0].length, raw.indexOf('endstream', m.index))).toString('latin1'); } catch { continue; }
    texts.push(t);
    const dict = raw.slice(Math.max(0, m.index - 400), m.index), n = /\/N\s+(\d+)/.exec(dict)?.[1], first = /\/First\s+(\d+)/.exec(dict)?.[1];
    if (/\/ObjStm/.test(dict) && n && first){      // an object stream: "num offset num offset ..." and then the objects
      const head = t.slice(0, +first).trim().split(/\s+/).map(Number);
      for (let i = 0; i + 1 < head.length && i < 2 * +n; i += 2) define(head[i], t.slice(+first + head[i + 1], head[i + 3] !== undefined ? +first + head[i + 3] : undefined));
    }
  }
  const strings = n => (objects.get(n) ?? []).flatMap(b => [...b.matchAll(STRING)].map(x => x[0]).concat([...b.matchAll(/(\d+)\s+0\s+R/g)].flatMap(r => (objects.get(+r[1]) ?? []).flatMap(c => c.match(STRING) ?? []))));
  for (const t of texts) for (const m of t.matchAll(/\/Info\s+(\d+)\s+0\s+R/g)) if (strings(+m[1]).some(v => !blank(v))) return 'its Info dictionary holds a text (the title, who made it, with what, or when)';
  for (const t of texts){
    if (/<(?:\w+:)?xmpmeta\b(?![^>]*\/>)|<rdf:|<\w+:Description\b/.test(t)) return 'an XMP packet holds metadata';
    if (/<\?xpacket begin/.test(t) && !/<(?:\w+:)?xmpmeta\b[^>]*\/>/.test(t)) return 'an XMP packet holds metadata';
  }
  return null;
}

export async function zipMetadata(buf){
  const z = unzip(new Uint8Array(buf));
  for (const n of z.names){
    if (!/\.(xml|rels|rdf)$/i.test(n)) continue;
    const text = Buffer.from(await z.read(n)).toString('utf8');
    if (/(?:^|\/)(?:docProps\/(?:core|app|custom)|meta)\.xml$/.test(n) && text.replace(/<[^>]*>/g, '').trim()) return `${n} holds a text (who made it, with what, when, or its title)`;
    if (/\bw:(?:author|initials)\s*=\s*"[^"]*\S/.test(text) || /<(?:dc:creator|meta:initial-creator|cp:lastModifiedBy|dc:contributor)\b[^>]*>\s*[^<\s]/.test(text)) return `${n} names an author (of a comment, a tracked change or the document)`;
  }
  return null;
}
