#!/usr/bin/env node
// node scripts/fit.mjs <data.json> <recipe.json> [--trim <lines>] [--ceiling <n>]
// node scripts/fit.mjs <data.json> <recipe.json> --fit [--add] [--target <pct>]
//                      [--out <new-recipe.json>] [--force]
//                      [--model <furniture lines>[,<page 2>]]
// Without --fit: a recipe's line cost from metrics.measured; writes nothing.
// With --fit: runs src/fit.js, measuring in Chromium (needs playwright), or with
// --model, a dry line-model plan where furniture is given in body lines.
// Writes only to --out, never over the input, never over a file without --force.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cost, highlights, candidates, trim, fit, modelMeasure, modelFlow, formatReport } from '../src/fit.js';
import { autoLayout } from '../src/paginate.js';
import { validate } from '../checks/lib/validate.mjs';
import { geometryFor } from '../checks/lib/geometry.mjs';
import { readLibrary, readRecipe, writeResume } from './lib/library.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const argv = process.argv.slice(2);
const VALUED = new Set(['--trim', '--ceiling', '--target', '--out', '--model']);
const valued = new Set(argv.flatMap((a, i) => VALUED.has(a) ? [i, i + 1] : []));
const num = (flag, dflt) => { const i = argv.indexOf(flag); return i < 0 ? dflt : Number(argv[i + 1]); };
const str = flag => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1]; };
const TRIM = num('--trim', 0);
const CEILING = num('--ceiling', 7);
const [DATA, RECIPE] = argv.filter((a, i) => !a.startsWith('--') && !valued.has(i));
if (!DATA || !RECIPE){
  console.error('usage: node scripts/fit.mjs <data.json> <recipe.json> [--trim <lines>] [--ceiling <n>]\n'
    + '       node scripts/fit.mjs <data.json> <recipe.json> --fit [--add] [--target <pct>] [--out <file>] [--force] [--model <lines>[,<lines>]]');
  process.exit(2);
}
const data = readLibrary(DATA).model;
const { recipe, kind: recipeKind } = readRecipe(RECIPE);

if (argv.includes('--fit')){
  const OUT = str('--out');
  if (OUT && path.resolve(OUT) === path.resolve(RECIPE)){
    console.error('refusing: --out is the recipe being read. Fit writes a new recipe, never over its input.');
    process.exit(1);
  }
  if (OUT && fs.existsSync(OUT) && !argv.includes('--force')){
    console.error(`refusing: ${OUT} exists. Pass --force to replace it.`);
    process.exit(1);
  }

  let measurer = null, measure, layout, how;
  const model = str('--model');
  if (model !== undefined){
    const furniture = model.split(',').map(Number);
    if (furniture.some(x => !Number.isFinite(x))){ console.error('--model takes furniture lines, e.g. --model 6.7 or --model 7.6,2.8'); process.exit(2); }
    const g = geometryFor(REPO, recipe);
    measure = modelMeasure(data, { ...g, furniture });
    layout = r => autoLayout(data, r, modelFlow(data, { ...g, furniture: furniture[0] ?? furniture }));
    how = `MODEL ONLY, not a measurement (page ${g.usable}px, body line ${g.lineH.toFixed(2)}px, furniture ${furniture.join(', ')} lines)`;
  } else {
    try {
      const { openMeasurer } = await import('../checks/lib/browser-measure.mjs');
      measurer = await openMeasurer({ repo: REPO, data: path.resolve(DATA) });
      measure = r => measurer.measure(r);
      layout = r => measurer.layout(r);
      how = 'measured in Chromium';
    } catch (e){
      console.error(`${e.message}\nRun this where playwright and Chromium are installed, or add --model <furniture lines> for a dry plan.`);
      process.exit(1);
    }
  }

  let result;
  try {
    result = await fit(data, recipe, { measure, layout, add: argv.includes('--add'), ceiling: CEILING, target: num('--target', undefined) ?? undefined });
  } finally { await measurer?.close(); }

  console.log(`\nFit · ${how}`);
  for (const line of formatReport(result.report ?? result)) console.log(line);
  if (result.error) process.exit(1);

  const { errors } = validate(data, result.recipe);
  if (errors.length){ console.error(`\nthe fitted recipe does not validate, not written:\n  ${errors.slice(0, 5).join('\n  ')}`); process.exit(1); }
  if (OUT){
    // a saved resume in, a saved resume out; a bare recipe stays bare
    if (recipeKind === 'resume') writeResume(OUT, data, result.recipe);
    else fs.writeFileSync(OUT, JSON.stringify(result.recipe, null, 2) + '\n');
    console.log(`\nwrote ${OUT}`);
  } else console.log('\nnot written: pass --out <new-recipe.json> to keep it.');
  process.exit(0);
}


const c = cost(data, recipe);
console.log(`${recipe.application ?? RECIPE}\n  ${c.key} · ${c.lines} lines over ${c.pages.length} page(s)`);
c.pages.forEach((p, n) => {
  console.log(`\n  page ${n + 1}: ${p.lines} lines`);
  let section = null;
  for (const r of p.rows){
    if (r.section !== section){ console.log(`    ${r.section}`); section = r.section; }
    console.log(`      ${String(r.lines).padStart(2)}  ${r.variant}${r.measured ? '' : '   (estimated, not measured at this width)'}`);
  }
});

if (c.unmeasured.length)
  console.log(`\n  ${c.unmeasured.length} phrasing(s) have no measurement at ${c.key}. The numbers`
    + `\n  above are estimates until checks/measure-variants.mjs --write has run.`);

const hl = highlights(data, recipe, CEILING);
console.log(`\nhighlights: ${hl.marks.length} against a ceiling of ${hl.ceiling}`);
for (const m of hl.marks) console.log(`  ${m.section.padEnd(12)} ${JSON.stringify(m.text)}`);
if (hl.over)
  console.log(`  ${hl.over} over the ceiling. The 0.1.0 documents set five, the agreed mockup carries seven, and which`
    + `\n  ${hl.over} come off has been open since 0.1.0. Nothing here decides it.`);

if (TRIM > 0){
  const t = trim(data, recipe, TRIM);
  console.log(`\ntrim ${TRIM} line(s): ${t.saved} found${t.short ? `, ${t.short} short` : ''}`);
  const chars = n => n >= 0 ? `${n} chars shorter` : `${-n} chars longer, and still a line cheaper`;
  for (const s of t.swaps) console.log(`  ${s.fact}: ${s.from} → ${s.to}  (−${s.saves} line${s.saves === 1 ? '' : 's'}, ${chars(s.chars)}` + (s.drops ? `; drops ${s.drops.join(', ')}` : '') + ')');
  if (t.short)
    console.log(`  ${t.short} line(s) short: the library has no shorter phrasing left. What remains is`
      + `\n  cutting a bullet or writing a new phrasing, and neither happens in this script.`);
  if (t.swaps.length){
    console.log('\n  as picks:');
    console.log('  ' + JSON.stringify(Object.fromEntries(t.swaps.map(s => [s.fact, s.to])), null, 2).replace(/\n/g, '\n  '));
  }
} else {
  const alt = candidates(data, recipe).slice(0, 5);
  if (alt.length){
    console.log('\nshorter phrasings available, best first:');
    for (const a of alt) console.log(`  −${a.saves} line  ${a.fact}: ${a.from} → ${a.to}` + (a.drops ? `  (drops ${a.drops.join(", ")})` : ""));
  }
}
