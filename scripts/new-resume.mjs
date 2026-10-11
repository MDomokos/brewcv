#!/usr/bin/env node
// node scripts/new-resume.mjs <resume-data.json> <picks.json> <out-dir> [--force]
// Writes a saved resume from a list of picks: which version of which claim to print. It chooses among the
// versions that exist and never takes text, so an agent can tailor a resume without writing a bullet.
//
// picks.json: { company, role, lang, format, pageLimit, theme, jobType?, summary?: versionId, bullets: [versionId, ...] }
// Writes nothing, and says why, if anything in it is wrong. Never overwrites a file without --force.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newResume, setBulletOn, setJobOn, chooseVariant, refusal } from '../src/model/resume.js';
import { entriesOf } from '../src/model/entries.js';
import { LANGS, resumeFileName, migrateRecipe, saveResume } from '../src/model/schema.js';
import { today } from '../src/model/resumes.js';
import { readLibrary, readJson, writeResume } from './lib/library.mjs';
import { indexOf, langOf, versionsOf, factIdsOfSection, optionsOf } from './lib/claims.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const [DATA, PICKS, OUT] = argv.filter(a => !a.startsWith('--'));
if (!DATA || !PICKS || !OUT){
  console.error('usage: node scripts/new-resume.mjs <resume-data.json> <picks.json> <out-dir> [--force]');
  process.exit(2);
}

const stop = e => { console.error(e.message); process.exit(1); };
let model, picks;
try {
  const lib = readLibrary(DATA);
  model = lib.model;
  for (const w of lib.warnings ?? []) console.error(`warning: ${DATA}: ${w}`);
  picks = readJson(PICKS);
} catch (e){ stop(e); }
const ix = indexOf(model);
const errors = [];
const bad = m => errors.push(m);

const ALLOWED = ['company', 'role', 'lang', 'format', 'pageLimit', 'theme', 'jobType', 'summary', 'bullets'];
if (!picks || typeof picks !== 'object' || Array.isArray(picks)){ console.error(`${PICKS}: not an object`); process.exit(1); }
for (const k of Object.keys(picks))
  if (!ALLOWED.includes(k)) bad(`${k}: not allowed in picks.json. The only text it takes is company and role; wording comes from the record's versions, by id.`);

const str = (k, req) => {
  const v = picks[k];
  if (v === undefined){ if (req) bad(`${k}: missing`); return null; }
  if (typeof v !== 'string' || !v.trim()){ bad(`${k}: must be a non-empty string`); return null; }
  return v.trim().normalize('NFC');   // a decomposed accent would otherwise drop out of the file name
};
// company, role and jobType are names, not wording: no markup, no line breaks, short
const plain = k => {
  const v = str(k, k !== 'jobType');
  if (v !== null && (v.length > 80 || /[<>$\u0000-\u001f]/.test(v))) bad(`${k}: must be a plain name of at most 80 characters, with no <, > or $ and no line breaks`);
  return v;
};
const company = plain('company'), role = plain('role');
const lang = str('lang', true), format = str('format', true), theme = str('theme', true);
const jobType = picks.jobType === undefined ? '' : plain('jobType');
if (!Number.isInteger(picks.pageLimit) || picks.pageLimit < 0) bad('pageLimit: must be a whole number, 0 for as many pages as needed');
if (lang && !LANGS.includes(lang)) bad(`lang: ${lang} is not one of ${LANGS.join(', ')}`);
const { formats, themes } = optionsOf(model);
if (format && !formats.includes(format)) bad(`format: ${format} is not one of ${formats.join(', ')}`);
if (theme && !themes.includes(theme)) bad(`theme: ${theme} is not one of ${themes.join(', ')}`);
if (!Array.isArray(picks.bullets) || picks.bullets.some(b => typeof b !== 'string')) bad('bullets: must be a list of version ids');
else if (!picks.bullets.length) bad('bullets: empty. A resume with no bullets is not a tailored resume');

// version id → the claim, checked the same way for the summary and every bullet
const bullets = new Map();     // fact id → version id, in the order given
const jobOf = new Map(entriesOf(model).flatMap(j => (j.highlights ?? []).map(h => [h, j])));
function check(what, id){
  const v = ix.version.get(id), f = ix.factOf.get(id);
  if (!v || !f){ bad(`${what}: ${id} is not a version in the record`); return null; }
  if (lang && langOf(v) !== lang) bad(`${what}: ${id} is in ${langOf(v)}, and this resume is ${lang}`);
  const why = refusal(f, v);
  if (why) bad(`${what}: ${id} can't be picked (${why})`);
  if (!v.source && model.requireSource !== false) bad(`${what}: ${id} has no source, so it can't be exported. Wording added to the record by hand looks like this`);
  if ((v.text ?? '').includes('⬜')) bad(`${what}: ${id} carries a ⬜ placeholder`);
  return { v, f };
}

const summaryFact = model.basics?.summary ?? 'summary';
if (picks.summary !== undefined){
  if (typeof picks.summary !== 'string') bad('summary: must be a version id');
  else {
    const got = check('summary', picks.summary);
    if (got && got.f.id !== summaryFact) bad(`summary: ${picks.summary} is a version of ${got.f.id}, not of the summary (${summaryFact})`);
  }
}
for (const id of Array.isArray(picks.bullets) ? picks.bullets.filter(b => typeof b === 'string') : []){
  const got = check('bullets', id);
  if (!got) continue;
  if (!jobOf.has(got.f.id)){ bad(`bullets: ${id} is a version of ${got.f.id}, which is not a bullet of any job`); continue; }
  if (jobOf.get(got.f.id).archived){ bad(`bullets: ${id} can't be picked (archived job: ${jobOf.get(got.f.id).id})`); continue; }
  if (bullets.has(got.f.id)){ bad(`bullets: ${bullets.get(got.f.id)} and ${id} are two versions of ${got.f.id}; pick one`); continue; }
  bullets.set(got.f.id, id);
}

for (const [fact, id] of bullets)
  for (const c of ix.version.get(id).covers ?? [])
    if (bullets.has(c)) bad(`bullets: ${id} already says ${c}, which is also picked; pick one of them`);

if (errors.length){
  console.error(`refusing, ${errors.length} problem${errors.length === 1 ? '' : 's'}; nothing was written:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

const recipe = newResume(model, { format, lang, pageLimit: picks.pageLimit, theme });
// exactly the listed bullets
for (const f of model.facts) if (jobOf.has(f.id)) setBulletOn(model, recipe, f.id, bullets.has(f.id));
// a job with no picked bullet would print as a bare heading
for (const j of entriesOf(model)) if (!(j.highlights ?? []).some(h => bullets.has(h))) setJobOn(model, recipe, j.id, false);
for (const [fact, version] of bullets) recipe.picks[fact] = version;
if (picks.summary !== undefined) recipe.picks[summaryFact] = picks.summary;
Object.assign(recipe, { company, role, jobType });
recipe.application = `${company} - ${role}`;
recipe.title = `${company} — ${role}`;
recipe.savedAt = recipe.date = today();

// Whatever isn't picked prints by the renderer's own rule. Where that rule would land on a draft or an
// archive copy, pick the record's own safe version of that fact instead, or refuse if it has none.
const auto = [];
{
  const jobsOn = entriesOf(model).filter(j => (j.highlights ?? []).some(h => bullets.has(h)));
  const printed = new Set([summaryFact, ...jobsOn.flatMap(j => [j.display?.position, j.display?.meta])]);
  const secs = new Map((model.sections ?? []).map(sec => [sec.id, sec]));
  for (const sec of recipe.sections ?? []){
    const def = secs.get(sec.id);
    if (def && def.kind !== 'entries' && sec.weight !== 0) for (const id of factIdsOfSection(def, ix)) printed.add(id);
  }
  const lost = [];
  for (const id of printed){
    const f = ix.fact.get(id);
    if (!f || recipe.picks[id]) continue;
    const v = chooseVariant(model, id, recipe).v;
    if (!v || !refusal(f, v)) continue;
    const safe = versionsOf(model, ix, f, lang).filter(x => !x.refused)
      .sort((a, b) => (b.default - a.default) || (b.id.endsWith('-base') - a.id.endsWith('-base')))[0];
    if (safe){ recipe.picks[id] = safe.id; auto.push(`${id} → ${safe.id} (it would have printed ${v.id}, a ${refusal(f, v)})`); }
    else lost.push(`${id}: it would print ${v.id} (${refusal(f, v)}) and the record has no other ${lang} version`);
  }
  if (lost.length){
    console.error(`refusing, ${lost.length} problem${lost.length === 1 ? '' : 's'}; nothing was written:`);
    for (const e of lost) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
}

const name = resumeFileName(migrateRecipe(recipe)).normalize('NFC');
const file = path.join(OUT, name);
if (fs.existsSync(file) && !FORCE){
  console.error(`refusing: ${file} exists. Pass --force to replace it.`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const problems = writeResume(file, model, recipe);

const empty = entriesOf(model).filter(j => !(j.highlights ?? []).some(h => bullets.has(h)));
console.log(`wrote ${file}`);
console.log(`  ${bullets.size} bullet${bullets.size === 1 ? '' : 's'}${picks.summary !== undefined ? ' and a summary' : ''} picked, ${lang}, ${format}@${theme}, ${picks.pageLimit === 0 ? 'any number of pages' : `${picks.pageLimit} page${picks.pageLimit === 1 ? '' : 's'}`}`);
if (empty.length) console.log(`  jobs left off, no bullet picked: ${empty.map(j => j.id).join(', ')}`);
for (const a of auto) console.log(`  chose, because the default would print a refused version: ${a}`);
for (const p of problems) console.log(`  ⚠  will not export: ${p}`);
