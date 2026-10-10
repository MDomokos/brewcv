#!/usr/bin/env node
// node checks/recipe-check.mjs
// The recipe's `weight` and `pins`: the validator, the renderer's weight-0 rule, the fitter's costing and
// the recipe file helpers in src/data.js. No browser; fixtures are built from checks/fixtures/example-0.4.json.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validate } from './lib/validate.mjs';
import { cost } from '../src/fit.js';
import { weightOf, isOmitted, pinsOf, offOf, keepOf, migratePins, DEFAULT_WEIGHT } from '../src/recipe.js';
import { recipeFileName, wrapRecipe } from '../src/data.js';
import { load } from '../src/model/schema.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const data = load(read('checks/fixtures/example-0.4.json')).model;
const base = read('checks/fixtures/example-0.4-recipe.json');
const clone = x => structuredClone(x);

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`);
  if (!cond) failed++;
};
const check = (recipe) => validate(data, recipe);
const has = (list, re) => list.some(m => re.test(m));
const withRecipe = fn => { const r = clone(base); fn(r); return r; };

{
  const { errors, warnings } = check(base);
  ok('the example recipe validates with no errors and no warnings', !errors.length && !warnings.length,
     JSON.stringify({ errors, warnings }));
  ok('weights 5/3/2/2 already in the recipe are accepted', !has(errors, /weight/));
}

{
  const bad = v => check(withRecipe(r => { r.sections[1].weight = v; }));
  for (const v of [6, -1, 2.5, '3', null])
    ok(`weight ${JSON.stringify(v)} is an error`, has(bad(v).errors, /recipe\.sections\[1\].*weight/), JSON.stringify(bad(v).errors));
  for (const v of [0, 1, 5])
    ok(`weight ${v} is accepted`, !bad(v).errors.length);
  const hdr = check(withRecipe(r => { r.sections.push({ id: 'summary', weight: 4 }); }));
  ok('a weight on the summary warns that it is ignored', has(hdr.warnings, /summary.*weight|no budget/) && !hdr.errors.length,
     JSON.stringify(hdr));
  ok('an absent weight reads as 3', weightOf(base, 'certified') === DEFAULT_WEIGHT && weightOf(base, 'experience') === 5);
}

{
  const pinned = pins => check(withRecipe(r => { r.pins = pins; }));
  const good = pinned({ include: ['hydra-inhaler'], exclude: ['poly-teaching'], phrasing: ['hydra-testing'] });
  ok('a well-formed pins block validates clean except for the exclude it contradicts',
     !good.errors.length, JSON.stringify(good.errors));
  ok('excluding a fact the recipe still prints warns', has(good.warnings, /poly-teaching.*still prints/), JSON.stringify(good.warnings));

  ok('pins that are not an object are an error', has(pinned([]).errors, /recipe\.pins/) && has(pinned('x').errors, /recipe\.pins/));
  ok('a list that is not an array is an error', has(pinned({ include: 'hydra-inhaler' }).errors, /pins\.include.*array/));
  ok('an unknown fact is an error in every list',
     ['include', 'exclude', 'phrasing'].every(k => has(pinned({ [k]: ['nope'] }).errors, new RegExp(`pins\\.${k}.*not a fact`))));
  ok('a fact pinned both in and out is an error',
     has(pinned({ include: ['hydra-inhaler'], exclude: ['hydra-inhaler'] }).errors, /both in and out/));
  ok('an unknown pin kind warns and is ignored', has(pinned({ lock: ['hydra-inhaler'] }).warnings, /pins\.lock.*not a pin kind/)
     && !pinned({ lock: ['hydra-inhaler'] }).errors.length);
  ok('a duplicate in a list warns', has(pinned({ include: ['hydra-inhaler', 'hydra-inhaler'] }).warnings, /listed twice/));
  ok('pinning in a fact no job reaches warns (free-work is not in this recipe)',
     has(pinned({ include: ['free-work'] }).warnings, /free-work.*no job or section/));

  // hydra-testing-merged covers hydra-suppliers: pinning suppliers out while the merge prints is a contradiction
  const merged = check(withRecipe(r => {
    r.picks['hydra-testing'] = 'hydra-testing-merged';
    r.pins = { exclude: ['hydra-suppliers'] };
  }));
  ok('excluding a fact a printing merged phrasing still says warns',
     has(merged.warnings, /hydra-suppliers.*merged phrasing/), JSON.stringify(merged.warnings));

  ok('a recipe still carrying pins warns that it is the 0.4.0 name', has(good.warnings, /recipe\.pins.*0\.4\.0 name/));

  const pj = pinsOf(withRecipe(r => { r.pins = { include: ['a', 'b'] }; }));
  ok('pinsOf returns three Sets, derived from off and keep', pj.include.size === 2 && pj.exclude.size === 0 && pj.phrasing.size === 2
     && pinsOf({}).include instanceof Set && pinsOf({}).phrasing.size === 0);
}

{
  const legacy = { pins: { include: ['a'], exclude: ['b'], phrasing: ['c', 'a'] } };
  ok('offOf / keepOf read the 0.4.0 pins', JSON.stringify(offOf(legacy)) === '["b"]' && JSON.stringify(keepOf(legacy)) === '["a","c"]');
  const m = migratePins(legacy);
  ok('migratePins writes off and keep and drops pins', !('pins' in m) && JSON.stringify(m.off) === '["b"]' && JSON.stringify(m.keep) === '["a","c"]');
  ok('and is idempotent', JSON.stringify(migratePins(m)) === JSON.stringify(m));
  ok('and leaves the original alone', !!legacy.pins);
  ok('empty pins migrate to nothing', JSON.stringify(migratePins({ pins: {} })) === '{}');
  ok('off / keep win over pins when both are there', JSON.stringify(offOf({ off: ['x'], pins: { exclude: ['y'] } })) === '["x"]');
  const p = pinsOf({ off: ['b', 'k'], keep: ['a', 'k'] });
  ok('pinsOf: exclude = off, include = keep − off, phrasing = keep',
     [...p.exclude].join() === 'b,k' && [...p.include].join() === 'a' && [...p.phrasing].join() === 'a,k');

  const kv = (k, list) => check(withRecipe(r => { r[k] = list; }));
  const good = check(withRecipe(r => { r.off = ['poly-teaching']; r.keep = ['hydra-inhaler', 'hydra-testing']; }));
  ok('a well-formed off / keep validates clean', !good.errors.length, JSON.stringify(good.errors));
  ok('off on a bullet the recipe still prints warns', has(good.warnings, /recipe\.off.*poly-teaching.*still prints/), JSON.stringify(good.warnings));
  ok('off / keep that are not arrays are errors', has(kv('off', 'x').errors, /recipe\.off.*array/) && has(kv('keep', {}).errors, /recipe\.keep.*array/));
  ok('an unknown fact is an error', has(kv('off', ['nope']).errors, /recipe\.off.*not a fact/) && has(kv('keep', ['nope']).errors, /recipe\.keep.*not a fact/));
  ok('a duplicate warns', has(kv('keep', ['hydra-inhaler', 'hydra-inhaler']).warnings, /recipe\.keep.*listed twice/));
  ok('keeping on a fact no job reaches warns', has(kv('keep', ['free-work']).warnings, /recipe\.keep.*free-work.*no job or section/));
  ok('a fact both off and kept is fine: it stays off', !kv('keep', ['poly-teaching']).errors.length
     && !check(withRecipe(r => { r.off = ['free-work']; r.keep = ['free-work']; })).warnings.some(w => /free-work.*no job/.test(w)));
}

{
  const zero = withRecipe(r => { r.sections.find(s => s.id === 'education').weight = 0; });
  ok('isOmitted: only an explicit 0, never an absent weight, never the header or summary',
     isOmitted(data, zero, 'education') && !isOmitted(data, base, 'education')
     && !isOmitted(data, zero, 'skills') && !isOmitted(data, withRecipe(r => { r.sections.push({ id: 'summary', weight: 0 }); }), 'summary'));

  const before = cost(data, base), after = cost(data, zero);
  ok('the fitter does not cost an omitted section',
     !after.pages.flatMap(p => p.rows).some(r => r.section === 'education')
     && before.pages.flatMap(p => p.rows).some(r => r.section === 'education')
     && after.lines < before.lines, `${before.lines} -> ${after.lines}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-check-'));
  const render = (recipe, name) => {
    const rf = path.join(tmp, `${name}.json`), out = path.join(tmp, `${name}.html`);
    fs.writeFileSync(rf, JSON.stringify(recipe));
    execFileSync(process.execPath, [path.join(REPO, 'scripts/render.mjs'), path.join(REPO, 'checks/fixtures/example-0.4.json'), rf, out],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    return fs.readFileSync(out, 'utf8');
  };
  const full = render(base, 'full'), cut = render(zero, 'cut');
  ok('the rendered document carries Education when weighted', /aria-label="Education"/.test(full));
  ok('and leaves it out at weight 0', !/aria-label="Education"/.test(cut) && /aria-label="Skills"/.test(cut));
  ok('the example now prints each job once, on its own page',
     (full.match(/class="entry"/g) ?? []).length === 2 && (full.match(/class="page"/g) ?? []).length === 2);
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  ok('the suggested name is "<application> - fit.json"', recipeFileName(base) === 'Example Instruments - Design Engineer - fit.json',
     recipeFileName(base));
  ok('it never carries a path character',
     !/[\\/:*?"<>|]/.test(recipeFileName({ application: 'Leica / Geo: "Survey" <Role>' })));
  ok('an em dash becomes a hyphen', recipeFileName({ application: 'A — B' }) === 'A - B - fit.json');
  ok('it never suggests the name of the recipe it was opened from',
     recipeFileName(base, 'example instruments - design engineer - fit.json') !== 'Example Instruments - Design Engineer - fit.json');
  ok('an application already ending "fit" is not doubled', recipeFileName({ application: 'X - fit' }) === 'X - fit.json');
  ok('an empty application still gets a name', recipeFileName({}) === 'Recipe - fit.json');
  const w = wrapRecipe(withRecipe(r => { r.sections[0].weight = 9; }), data, 'x.json');
  ok('wrapRecipe reports errors and ok:false', w.ok === false && w.errors.length === 1 && w.origin === 'x.json');
  ok('wrapRecipe passes a good recipe', wrapRecipe(base, data, 'example-recipe.json').ok === true);
}

console.log(failed ? `\n${failed} FAILED` : '\nall recipe checks passed');
process.exit(failed ? 1 : 0);
