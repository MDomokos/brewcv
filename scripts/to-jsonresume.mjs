#!/usr/bin/env node
// node scripts/to-jsonresume.mjs <resume-data.json> [recipe.json] [-o out.json]
// Flattens the library to JSON Resume for ATS uploads; selection is resolve() in
// src/model/resume.js. Exits 1 on any export problem (a ⬜, a draft, wrong language).

import fs from 'node:fs';
import { resolve } from '../src/model/resume.js';
import { JSON_RESUME_SCHEMA } from '../src/model/schema.js';
import { readLibrary, readRecipe } from './lib/library.mjs';

const args = process.argv.slice(2);
const out = args.includes('-o') ? args[args.indexOf('-o') + 1] : null;
const files = args.filter((a, n) => a !== '-o' && args[n - 1] !== '-o');
const [dataFile, recipeFile] = files;
if (!dataFile){ console.error('usage: node scripts/to-jsonresume.mjs <resume-data.json> [recipe.json] [-o out.json]'); process.exit(2); }

const data = readLibrary(dataFile).model;
const recipe = recipeFile ? readRecipe(recipeFile, data).recipe : null;

const { body, problems } = resolve(data, recipe, { local: false });

const jr = {
  $schema: JSON_RESUME_SCHEMA,
  ...body,
  meta: {
    canonical: data.meta?.truth,
    version: data.schema,
    lastModified: new Date().toISOString().slice(0, 10),
    generator: 'brewcv scripts/to-jsonresume.mjs',
    ...(recipe ? { recipe: recipe.application, format: recipe.format, theme: recipe.theme } : {}),
  },
};

if (problems.length){
  console.error(`\nrefusing to export, ${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

const json = JSON.stringify(jr, null, 2) + '\n';
if (out){ fs.writeFileSync(out, json); console.error(`wrote ${out}`); }
else process.stdout.write(json);
