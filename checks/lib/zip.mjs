// A ZIP writer for the checks: files held as they are (method 0), or as the caller made them ({ method, data, size, crc }, see `deflated`).
// It builds the DOCX, ODT, Pages and LinkedIn files the reader checks open, from XML and CSV strings, so no binary is committed.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = ~0; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const bytes = x => (typeof x === 'string' ? new TextEncoder().encode(x) : x);

// files: { name: string | Uint8Array | { method, data (as stored in the file), size, crc } }; flags: set on every entry (1 = encrypted)
export function zip(files, { flags = 0 } = {}){
  const out = [], central = [];
  let at = 0;
  const put = (...parts) => { for (const p of parts){ out.push(p); at += p.length; } };
  const u16 = n => Uint8Array.of(n & 255, n >> 8), u32 = n => Uint8Array.of(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255);
  for (const [name, v] of Object.entries(files)){
    const e = v?.method !== undefined ? v : { method: 0, data: bytes(v), size: bytes(v).length, crc: crc32(bytes(v)) }, n = bytes(name);
    if (e.crc === undefined) e.crc = 0;
    central.push([at, e, n]);
    put(u32(0x04034b50), u16(20), u16(flags), u16(e.method), u32(0), u32(e.crc), u32(e.data.length), u32(e.size), u16(n.length), u16(0), n, e.data);
  }
  const from = at;
  for (const [off, e, n] of central) put(u32(0x02014b50), u16(20), u16(20), u16(flags), u16(e.method), u32(0), u32(e.crc), u32(e.data.length), u32(e.size), u16(n.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), n);
  put(u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(at - from), u32(from), u16(0));
  const res = new Uint8Array(at);
  let p = 0;
  for (const x of out){ res.set(x, p); p += x.length; }
  return res;
}

// a deflated entry, made with the platform's own CompressionStream
export async function deflated(text){
  const raw = bytes(text), data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  return { method: 8, data, size: raw.length, crc: crc32(raw) };
}
