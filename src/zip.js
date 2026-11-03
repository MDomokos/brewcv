// A ZIP of stored entries (no compression), for several downloads in one file: zip([{ name, data }]) → Uint8Array.
// `data` is text (written as UTF-8) or bytes; names are UTF-8 (flag bit 11). src/parse/unzip.js reads it back (checks/export-check.mjs).

const TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(bytes){
  let c = 0xffffffff;
  for (const b of bytes) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files, date = new Date()){
  const enc = new TextEncoder(), local = [], central = [];
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  let at = 0;
  for (const f of files){
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    // the fields a local header and a central record share, from "version needed" to the name's length
    const common = (v, o) => { v.setUint16(o, 20, true); v.setUint16(o + 2, 0x0800, true); v.setUint16(o + 4, 0, true); v.setUint16(o + 6, time, true); v.setUint16(o + 8, day, true);
      v.setUint32(o + 10, crc, true); v.setUint32(o + 14, data.length, true); v.setUint32(o + 18, data.length, true); v.setUint16(o + 22, name.length, true); };
    const head = new Uint8Array(30 + name.length), hv = new DataView(head.buffer);
    hv.setUint32(0, 0x04034b50, true); common(hv, 4); head.set(name, 30);
    const rec = new Uint8Array(46 + name.length), rv = new DataView(rec.buffer);
    rv.setUint32(0, 0x02014b50, true); rv.setUint16(4, 20, true); common(rv, 6); rv.setUint32(42, at, true); rec.set(name, 46);
    local.push(head, data); central.push(rec);
    at += head.length + data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, size, true); ev.setUint32(16, at, true);
  const out = new Uint8Array(at + size + 22);
  let p = 0;
  for (const part of [...local, ...central, end]){ out.set(part, p); p += part.length; }
  return out;
}

// Names unique within one ZIP: a second "X.html" becomes "X (2).html".
export function uniqueNames(names){
  const seen = new Set();
  return names.map(n => {
    let k = n, i = 1;
    const dot = n.lastIndexOf('.'), stem = dot > 0 ? n.slice(0, dot) : n, ext = dot > 0 ? n.slice(dot) : '';
    while (seen.has(k.toLowerCase())) k = `${stem} (${++i})${ext}`;
    seen.add(k.toLowerCase());
    return k;
  });
}
