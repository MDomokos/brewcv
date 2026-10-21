#!/usr/bin/env node
// node scripts/new-theme.mjs <id> "<Name>" "<note>" [--root <dir>]
// Registers a new built-in look in one go: themes/<id>.css (an overlay on b2-marker.css, for you to fill in), its line in
// src/themes.js, its two strings in every catalogue (English until someone translates them: a missing string would show as a key),
// the service worker's two entries, and its tokens file. `id` is also the stylesheet's name. checks/themes-check.mjs says what
// is still missing; docs/THEME-DESIGN-RULES.md says what a look may do.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serialize } from '../src/model/tokens.js';
import { builtInTokens } from './tokens.mjs';

const HERE = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const LANGS = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu'];
const quote = s => s.replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
const STUB = (id, note) => `/* ${id}.css: ${note} Load after b2-marker.css.
   A look sets custom properties and styles the page's classes; it never changes the layout (docs/THEMES.md).
   Its rules are in docs/THEME-DESIGN-RULES.md, and checks/themes-pages-check.mjs holds it to them. */
:root {
  /* --accent: #7fd1ae; */
}
`;

function put(file, anchor, line, { before = false, last = false } = {}){
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const at = last ? lines.map(l => l.startsWith(anchor)).lastIndexOf(true) : lines.findIndex(l => l.startsWith(anchor));
  if (at < 0) throw new Error(`${path.relative(HERE, file)}: no line starts with ${JSON.stringify(anchor)}`);
  lines.splice(before ? at : at + 1, 0, line);
  fs.writeFileSync(file, lines.join('\n'));
}

export async function scaffold(root, { id, name, note }){
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`id ${JSON.stringify(id)}: lower-case letters, digits and hyphens, starting with a letter`);
  if (!name || !note) throw new Error('a name and a note are needed: the picker shows both');
  const at = f => path.join(root, f);
  const themes = at('src/themes.js');
  const { THEMES } = await import(`${new URL(`file://${themes}`).href}?${Date.now()}`);
  if (THEMES.some(x => x.id === id || x.file === id) || fs.existsSync(at(`themes/${id}.css`))) throw new Error(`${id} is already a look`);

  fs.writeFileSync(at(`themes/${id}.css`), STUB(id, note));
  const entry = { id, file: id, layers: ['b2-marker', id], name, note, tokenName: `B2 Marker, ${name}` };
  put(themes, '  // new looks above this line', `  { id: '${id}', file: '${id}', layers: ['b2-marker', '${id}'], name: '${quote(name)}', note: '${quote(note)}', tokenName: '${quote(entry.tokenName)}' },`, { before: true });
  for (const l of LANGS){
    const f = at(`src/i18n/${l}.js`);
    put(f, "  'design.tpl.", `  'design.tpl.${id}': '${quote(name)}',`, { last: true });
    put(f, "  'design.tplNote.", `  'design.tplNote.${id}': '${quote(note)}',`, { last: true });
  }
  put(at('sw.js'), "  './themes/b2-marker.css',", `  './themes/${id}.css',`);
  put(at('sw.js'), "  './themes/b2-marker.tokens.json',", `  './themes/${id}.tokens.json',`);
  fs.writeFileSync(at(`themes/${id}.tokens.json`), JSON.stringify(serialize(entry.tokenName, builtInTokens(entry, root)), null, 2) + '\n');
  return entry;
}

if (process.argv[1] === fileURLToPath(import.meta.url)){
  const args = process.argv.slice(2), r = args.indexOf('--root');
  const root = r >= 0 ? path.resolve(args.splice(r, 2)[1]) : HERE;
  const [id, name, note] = args;
  if (!id){ console.error('usage: node scripts/new-theme.mjs <id> "<Name>" "<note>" [--root <dir>]'); process.exit(2); }
  try { await scaffold(root, { id, name, note }); }
  catch (e){ console.error(e.message); process.exit(1); }
  console.log(`themes/${id}.css, src/themes.js, ten catalogues (English: translate the nine), sw.js and themes/${id}.tokens.json`
    + `\nNext: write themes/${id}.css, then node scripts/tokens.mjs, node checks/themes-check.mjs and node checks/themes-pages-check.mjs`);
}
