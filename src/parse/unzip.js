// Not from OpenResume. Reads a ZIP held in memory (a DOCX, an ODT, a Pages file, a LinkedIn export) with the platform's own inflate:
//   const z = unzip(bytes);  z.names  (every entry, from the central directory)  and  await z.read(name)  (its bytes, or null)
// An error carries a `code` for the caller to turn into words: 'zip' (not a ZIP, or broken), 'zip64', 'encrypted', 'method', 'big' (more than 64 MB read from one file).
// shortcut: the CRC is not checked, and the declared sizes are trusted for stored entries; add both if a damaged file ever reads as text.
const MAX = 64 * 1024 * 1024;      // the reads of one file may inflate to this much in all; more is refused rather than filling the memory

const fail = (code, message) => Object.assign(new Error(message), { code });

export function unzip(bytes){
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;      // the end-of-central-directory record: the last PK\5\6 with room for a comment after it
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50){ end = i; break; }
  if (end < 0) throw fail('zip', 'This is not a ZIP file');
  const count = v.getUint16(end + 10, true), size = v.getUint32(end + 12, true), start = v.getUint32(end + 16, true);
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff || (end >= 20 && v.getUint32(end - 20, true) === 0x07064b50)) throw fail('zip64', 'ZIP64 files are not read');
  const entries = new Map();
  for (let i = 0, p = start; i < count; i++){
    if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50) throw fail('zip', 'The ZIP file is damaged');
    const n = v.getUint16(p + 28, true), m = v.getUint16(p + 30, true), k = v.getUint16(p + 32, true);
    const e = { flags: v.getUint16(p + 8, true), method: v.getUint16(p + 10, true), csize: v.getUint32(p + 20, true), size: v.getUint32(p + 24, true), at: v.getUint32(p + 42, true) };
    if (e.csize === 0xffffffff || e.size === 0xffffffff || e.at === 0xffffffff) throw fail('zip64', 'ZIP64 files are not read');
    entries.set(new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + n)), e);
    p += 46 + n + m + k;
  }
  // the bytes of an entry as the file holds them, after the checks that make them worth reading
  const slice = e => {
    if (e.flags & 1) throw fail('encrypted', 'This file is password protected');
    if (e.method !== 0 && e.method !== 8) throw fail('method', 'This ZIP file uses a compression that is not read');
    if (e.at + 30 > bytes.length || v.getUint32(e.at, true) !== 0x04034b50) throw fail('zip', 'The ZIP file is damaged');
    const from = e.at + 30 + v.getUint16(e.at + 26, true) + v.getUint16(e.at + 28, true), data = bytes.subarray(from, from + e.csize);
    if (data.length < e.csize) throw fail('zip', 'The ZIP file is damaged');
    return data;
  };
  let left = MAX;      // what all the reads of this file together may still inflate to
  return {
    names: [...entries.keys()],
    // a stored entry (method 0) at once, for a small one such as an ODT's mimetype; null if it is not there or is deflated
    stored(name){ const e = entries.get(name); return e?.method === 0 ? slice(e) : null; },
    async read(name){
      const e = entries.get(name);
      if (!e) return null;
      const data = slice(e);
      if (data.length > left) throw fail('big', 'This file is too large to read');
      if (e.method === 0){ left -= data.length; return data; }
      const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), parts = [];
      let n = 0;
      try {
        for (;;){
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          if ((n += value.length) > left){ reader.cancel(); break; }
        }
      } catch { throw fail('zip', 'The ZIP file is damaged'); }
      if (n > left) throw fail('big', 'This file is too large to read');
      left -= n;
      return new Uint8Array(await new Blob(parts).arrayBuffer());
    },
  };
}
