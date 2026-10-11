#!/usr/bin/env node
// node scripts/theme-check.mjs <theme.tokens.json | theme.css>
// What the app would make of a theme file: the form it's in, the tokens it reads, what it ignores
// and why, a font the app has no files for, the accent against the tab text, and the CSS that
// would be applied. Exit 1 if nothing in the file could be read. Writes nothing.

import fs from 'node:fs';
import path from 'node:path';
import { parseTheme, toCss, unknownFonts, accentCheck } from '../src/model/tokens.js';

const file = process.argv[2];
if (!file){ console.error('Usage: node scripts/theme-check.mjs <theme.tokens.json | theme.css>'); process.exit(2); }
const t = parseTheme(fs.readFileSync(file, 'utf8'), { fileName: path.basename(file) });
const n = Object.keys(t.tokens).length;
console.log(`${path.basename(file)}: ${t.form}, "${t.name}", ${n} token${n === 1 ? '' : 's'} read`);
for (const i of t.ignored) console.log(`  ignored ${i.key}: ${i.why}`);
for (const [k, v] of Object.entries(t.tokens)) if (k.startsWith('font-') && !/^\{/.test(v) && unknownFonts(v).length)
  console.log(`  font ${unknownFonts(v)[0]} (${k}) has no files in the app: the page shows Hanken Grotesk instead`);
if (t.tokens.accent){
  const c = accentCheck(t.tokens.accent, t.tokens['tab-ink']);
  console.log(`  accent against the tab text: ${c.ratio?.toFixed(2)}:1 (${c.ok ? 'readable' : 'below 4.5:1, tab text will be hard to read'})`);
}
console.log('\n' + (toCss(t.tokens).trim() || '(no CSS)'));
process.exit(n ? 0 : 1);
