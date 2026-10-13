// Contact details from identity.local.json, kept outside the repo (scripts/lib/private-files.mjs says where).
// Without the file everything runs on obvious placeholders.

import fs from 'node:fs';
import path from 'node:path';
import { findPrivate, privateDirs } from './private-files.mjs';

const found = findPrivate('identity.local.json');
const FILE = found?.path ?? path.join(privateDirs()[0], 'identity.local.json');

const PLACEHOLDER = {
  email: 'you@example.org',
  phone: '+00 000 000 000',
  city: 'Your City, Country',
  locationCity: 'Your City',
  countryCode: 'ZZ',
};

export const hasIdentity = !!found;
export const IDENTITY = hasIdentity
  ? { ...PLACEHOLDER, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }
  : PLACEHOLDER;

export const IDENTITY_FILE = FILE;

export function fillIdentity(html){
  return html.replace(/\{\{(email|phone|city)\}\}/g, (m, key) => IDENTITY[key] ?? m);
}

// Fill the placeholders into a temp file beside the original, so measuring
// sees real strings and relative links still resolve. Removed afterwards.
export async function withIdentity(file, fn){
  const src = fs.readFileSync(file, 'utf8');
  if (!/\{\{(email|phone|city)\}\}/.test(src)) return fn(file);
  const tmp = path.join(path.dirname(file), `.filled-${process.pid}-${path.basename(file)}`);
  fs.writeFileSync(tmp, fillIdentity(src));
  try { return await fn(tmp); } finally { fs.rmSync(tmp, { force: true }); }
}
