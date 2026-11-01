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

// What a file is, by its bytes and not its name: a PDF (%PDF- in the first 1024 bytes), or a ZIP that holds a Word, an OpenDocument text, or a PDF, DOCX or ODT inside it. A file renamed (docs/real.bin,
// docs/resume, a .zip) is still one, and is allowed only as the manifest allows a fixture.
import { unzip } from '../../src/parse/unzip.js';
export function sniff(buf){
  if (buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) return 'pdf';
  if (buf.length > 21 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5)){
    try { if (unzip(new Uint8Array(buf)).names.some(n => n === 'word/document.xml' || n === 'content.xml' || DOCUMENT.test(n))) return 'zip'; } catch { /* not a ZIP anything can list */ }
  }
  return null;
}
