#!/usr/bin/env node
// node scripts/render.mjs <data.json> <recipe.json> <out.html> [--medium screen|print|pen] [--annotate] [--probe <k>] [--repo <dir>]
// Renders a library plus recipe into a template via src/render.js and scripts/lib/dom.mjs, with the resume's look settings
// (src/model/design.js lookCss). --medium: for a screen, for printing or for a highlighter pen; the recipe's exportMedium by default.
// --annotate and --probe <k> are measuring passes for checks/measure-variants.mjs, never for sending.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDocument, serialize } from './lib/dom.mjs';
import { renderPages, probeRecipe } from '../src/render.js';
import { validate } from '../checks/lib/validate.mjs';
import { exportBlockers } from '../src/data.js';
import { readLibrary, readRecipe } from './lib/library.mjs';
import { mediumOf, lookFor } from './lib/look.mjs';

const HOLE = '<!-- {{document}} -->';

const argv = process.argv.slice(2);
const annotate = argv.includes('--annotate');
const flagged = new Set();
for (const f of ['--repo', '--probe', '--medium']){ const i = argv.indexOf(f); if (i >= 0){ flagged.add(i); flagged.add(i + 1); } }
const arg = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const REPO = arg('--repo') ? path.resolve(arg('--repo'))
  : path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const probe = arg('--probe') === undefined ? undefined : Number(arg('--probe'));
const rest = argv.filter((a, n) => a !== '--annotate' && !flagged.has(n));
const [DATA, RECIPE, OUT] = rest;

if (!DATA || !RECIPE || !OUT){
  console.error('usage: node scripts/render.mjs <data.json> <recipe.json> <out.html> [--medium screen|print|pen] [--annotate] [--probe <k>] [--repo <dir>]');
  process.exit(2);
}

const data = readLibrary(DATA).model;
if (probe !== undefined && !Number.isInteger(probe)){ console.error('--probe takes a whole number'); process.exit(2); }
const opened = readRecipe(RECIPE).recipe;
// a measuring pass is the app's own measurement, which is made on a screen: unless a medium is asked for, it measures that
const medium = mediumOf(arg('--medium') ?? (annotate || probe !== undefined ? 'screen' : undefined), opened);
const recipe = probe === undefined ? opened : probeRecipe(data, opened);

const { errors } = validate(data);
if (errors.length){
  console.error(`${DATA}: ${errors.length} schema error(s); run checks/validate-data.mjs`);
  for (const e of errors.slice(0, 5)) console.error(`  ✗ ${e}`);
  process.exit(1);
}

const template = path.join(REPO, 'templates', `${recipe.format}.html`);
if (!fs.existsSync(template)){
  console.error(`no template for format ${JSON.stringify(recipe.format)}: expected ${path.relative(REPO, template)}`);
  process.exit(1);
}
let html = fs.readFileSync(template, 'utf8');
if (!html.includes(HOLE)){
  console.error(`${path.relative(REPO, template)} has no ${HOLE}, so it is not a template`);
  process.exit(1);
}

const doc = createDocument();
const { pages, ctx } = renderPages(data, recipe, doc, { annotate, ...(probe === undefined ? {} : { probe }) });
const body = pages.map(p => serialize(p, 1)).join('\n');

// recipe.overlays load after the theme, in the order given.
for (const o of [...(recipe.overlays ?? [])].reverse()){
  if (!fs.existsSync(path.join(REPO, 'themes', `${o}.css`))){
    console.error(`overlay ${JSON.stringify(o)} has no themes/${o}.css`); process.exit(1);
  }
  const theme = `<link rel="stylesheet" href="../themes/${recipe.theme}.css">`;
  if (!html.includes(theme)){ console.error(`template has no ${theme} to load overlay ${o} after`); process.exit(1); }
  html = html.replace(theme, `${theme}\n<link rel="stylesheet" href="../themes/${o}.css">`);
}

// a function, so $& and $' in a title are text; escaped, so a title is never markup
const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
if (recipe.title) html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(recipe.title)}</title>`);
html = html.replace(HOLE, body.replace(/^\s+/, ''));

// Template links are relative to templates/; rewrite them for the output location.
const outDir = path.dirname(path.resolve(OUT));
const toRepo = path.relative(outDir, REPO).split(path.sep).join('/') || '.';
if (toRepo !== '..')
  html = html.replace(/\b(href|src)="\.\.\/([^"]*)"/g, (m, a, rest) => `${a}="${toRepo}/${rest}"`);
const outside = toRepo.startsWith('..') && toRepo !== '..';

// the look settings, the accent and an imported theme's tokens: after every stylesheet, as the app adds them
const look = lookFor(data, recipe, medium, outDir, REPO);
if (look.css) html = html.replace('</head>', () => `<style id="look-css">\n${look.css}\n</style>\n</head>`);
if (look.paper) html = html.replace(/<html\b([^>]*)>/, (m, a) => `<html${a} class="medium-print">`);

fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, html);

const blockers = exportBlockers(data).filter(b =>
  [...ctx.chosen.values()].some(v => b.startsWith(v.id + ' ')));
const gaps = [...ctx.chosen.values()].filter(v => (v.text ?? '').includes('⬜'));
const overrides = [...ctx.chosen.values()].filter(v => v.override);

console.log(`${recipe.application ?? OUT}`);
console.log(`  ${recipe.format}@${recipe.theme} · ${pages.length} page${pages.length === 1 ? '' : 's'}`
  + ` · ${ctx.chosen.size} phrasings${medium === 'screen' ? '' : ` · for ${medium === 'pen' ? 'a highlighter pen' : 'printing'}`}${annotate ? ' · annotated' : ''}`);
for (const [fact, v] of ctx.chosen)
  if (v.id !== `${fact}-base`) console.log(`    ${fact} → ${v.id}`);
if (overrides.length) console.log(`  ${overrides.length} recipe override(s): ${overrides.map(v => v.id).join(', ')}`);
if (gaps.length) console.log(`  ⚠  ${gaps.length} phrasing(s) carry a ⬜ and print red: ${gaps.map(v => v.id).join(', ')}`);
if (blockers.length) console.log(`  ⚠  will not export: ${blockers.join('; ')}`);
if (outside)
  console.log(`  note: written outside the repo, so its stylesheets and fonts are linked as`
    + `\n        ${toRepo}/… and it opens only while both stay put. Export a PDF to send it.`);
console.log(`wrote ${OUT}`);
