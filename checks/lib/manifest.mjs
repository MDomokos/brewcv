// The import fixtures (checks/fixtures/import/): the only PDF, DOCX and ODT files the repo may hold. MANIFEST.json lists each one's name and sha256, and a file is allowed
// only when its path and its bytes match the list exactly; a changed byte is refused until the manifest is updated by a person who has looked at the file.
// preflight-deploy.mjs (the tree about to ship) and history-scan.mjs (every commit) both read it here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const FIXTURES = 'checks/fixtures/import/';
export const DOCUMENT = /\.(pdf|docx|odt)$/i;
export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
export function manifestIn(root){
  try { return JSON.parse(fs.readFileSync(path.join(root, FIXTURES, 'MANIFEST.json'), 'utf8')).files ?? {}; } catch { return {}; }
}
export const allowed = (manifest, rel, buf) => rel.startsWith(FIXTURES) && !rel.slice(FIXTURES.length).includes('/') && DOCUMENT.test(rel) && manifest[rel.slice(FIXTURES.length)] === sha256(buf);

// What a file is, by its bytes and not its name: a PDF (%PDF- in the first 1024 bytes), a ZIP that holds a Word, an OpenDocument text or a PDF, DOCX or ODT by name, or whose bytes in any entry (named nested.bin, say) are a
// PDF or such a ZIP, to three levels deep; and an archive format this does not unpack (gzip, tar, 7z, rar, bzip2, xz), which is refused as it is, since it can hold anything. A file renamed (docs/real.bin, docs/resume,
// a .zip) is still one, and is allowed only as the manifest allows a fixture. A ZIP that cannot be read to the end (encrypted, ZIP64, damaged inside) cannot be told, and counts as one.
// shortcut: a document encoded as text (base64 inside a JSON, a data: URL) is not found; the scanners look for such an image by its data: prefix only
import { unzip } from '../../src/parse/unzip.js';
const ARCHIVES = [[0, [0x1f, 0x8b]], [0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]], [0, [0x52, 0x61, 0x72, 0x21]], [0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]], [257, [0x75, 0x73, 0x74, 0x61, 0x72]]];
export const ARCHIVE_NAME = /\.(gz|tgz|tar|7z|rar|bz2|xz)$/i;      // an archive by its name, whatever is in it
export async function sniff(buf, depth = 0){
  if (buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) return 'pdf';
  if (ARCHIVES.some(([at, magic]) => magic.every((b, k) => buf[at + k] === b)) || (buf.toString('latin1', 0, 3) === 'BZh' && buf[3] >= 0x31 && buf[3] <= 0x39)) return 'archive';
  if (buf.length > 21 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5)){
    try {
      const z = unzip(new Uint8Array(buf));
      if (z.names.some(n => n === 'word/document.xml' || n === 'content.xml' || DOCUMENT.test(n))) return 'zip';
      if (depth < 3) for (const n of z.names) if (!n.endsWith('/') && await sniff(Buffer.from(await z.read(n)), depth + 1)) return 'zip';
    } catch { return 'zip'; }      // not a ZIP anything can list, or a part nothing can read: it cannot be told
  }
  return null;
}
