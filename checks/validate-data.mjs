#!/usr/bin/env node
// node checks/validate-data.mjs <resume-data.json> [recipe.json]
// A resume-data/2 or /3 file is migrated in memory and says so. A v4 file is also checked against the
// JSON Resume v1.0.0 types. With a recipe, the language completeness and purity rules run too.
// Exit 1 on any error. Warnings never fail the run. Rules live in lib/validate.mjs.

import fs from 'node:fs';
import { validate } from './lib/validate.mjs';
import { load, detect } from '../src/model/schema.js';

const file = process.argv[2];
if (!file){ console.error('usage: node checks/validate-data.mjs <resume-data.json> [recipe.json]'); process.exit(2); }

const read = f => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e){ console.error(`${f}: not readable as JSON: ${e.message}`); process.exit(2); }
};
const json   = read(file);
const recipe = process.argv[3] ? read(process.argv[3]) : null;

const { errors, warnings } = validate(json, recipe);
const label = file.replace(/^.*\//, '');

if (warnings.length){
  console.log(`\n${warnings.length} warning${warnings.length === 1 ? '' : 's'}:`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (errors.length){
  console.log(`\n${errors.length} error${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  console.log(`\n${label}: FAILED`);
  process.exit(1);
}
const kind = detect(json);
const data = load(json).model;
const langs = [...new Set(data.variants.map(v => v.lang ?? 'en'))].sort();
console.log(`\n${label}: ok, ${kind === 'library' ? 'resume-data/4' : `${json.schema} (migrated in memory)`}, ` +
  `${data.facts.length} facts, ${data.variants.length} variants, ` +
  `${langs.join('/')}, ` +
  `${data.variants.reduce((n, v) => n + (v.marks?.length ?? 0), 0)} marks, ` +
  `${data.variants.reduce((n, v) => n + (v.links?.length ?? 0), 0)} links, ` +
  `${data.sections.length} sections, ${(data.work ?? []).length} work entries` +
  `${data.requireSource === false ? '' : ', vault mode'}`);
