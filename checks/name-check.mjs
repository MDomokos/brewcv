#!/usr/bin/env node
// node checks/name-check.mjs [dir]   (CI runs it on the assembled _site)
// The app is called BrewCV. The old name may stay in two places only:
//   - CHANGELOG sections for 0.8.0 and earlier, which describe releases that went out under it;
//   - the identifiers that are kept on purpose, because renaming them would orphan saved data
//     (the browser storage name and the theme extension key): the hyphenated name in quotes.
// The camelCase format keys (meta.resumeBuilder, resumeBuilderBackup) are not the product's name and are not matched.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] ?? '.');
const OLD = /resume[ -]builder/i;
const QUOTED = /(['"])resume-builder\1/g;
const TEXT = /\.(html|css|js|mjs|json|webmanifest|md|txt|svg|yml|yaml)$/i;
const SKIP = new Set(['.git', 'node_modules', 'out', '_site']);

const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const released = v => cmp(v, [0, 8, 0]) <= 0;

function walk(dir, out = []){
  for (const e of fs.readdirSync(dir, { withFileTypes: true })){
    if (SKIP.has(e.name)) continue;
    // other dot-folders (a tool's own folder, with copies of this repo in it) are not the repo; .github is
    if (e.isDirectory() && e.name.startsWith('.') && e.name !== '.github') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (TEXT.test(e.name)) out.push(p);
  }
  return out;
}

const found = [];
for (const f of walk(ROOT)){
  const rel = path.relative(ROOT, f);
  if (rel === 'checks/name-check.mjs') continue; // it has to spell the name it looks for
  let section = null; // the version of the CHANGELOG section the line is in, or 'other'
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (rel === 'CHANGELOG.md'){
      const h = line.match(/^## (\d+)\.(\d+)\.(\d+)\b/);
      if (h) section = [+h[1], +h[2], +h[3]];
      else if (/^## /.test(line)) section = 'other';
    }
    if (!OLD.test(line.replace(QUOTED, ''))) return;
    if (rel === 'CHANGELOG.md' && Array.isArray(section) && released(section)) return;
    found.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
  });
}

if (found.length){
  console.error(`name-check: ${found.length} place${found.length === 1 ? '' : 's'} still use the old name\n`);
  for (const l of found.slice(0, 30)) console.error('  ' + l);
  process.exit(1);
}
console.log('name-check: clean, the old name appears only in released changelog entries and the kept identifiers');
