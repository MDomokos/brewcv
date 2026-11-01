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
export const allowed = (manifest, rel, buf) => rel.startsWith(FIXTURES) && !rel.slice(FIXTURES.length).includes('/') && manifest[rel.slice(FIXTURES.length)] === sha256(buf);
