#!/usr/bin/env node
// node scripts/claims.mjs <resume-data.json> [--lang en] [--tag <t>] [--job <id>] [--json]
// Reads the record (a record file or the one file) and lists every claim with each of its versions in
// one language, so an agent can choose among them. Versions that can't be picked are marked. Writes nothing.

import { readLibrary } from './lib/library.mjs';
import { LANGS } from '../src/model/schema.js';
import { indexOf, versionsOf, jobsOf, factIdsOfSection, optionsOf } from './lib/claims.mjs';

const argv = process.argv.slice(2);
const VALUED = new Set(['--lang', '--tag', '--job']);
const arg = f => { const i = argv.indexOf(f); return i < 0 ? undefined : argv[i + 1]; };
const skip = new Set(argv.flatMap((a, i) => VALUED.has(a) ? [i, i + 1] : []));
const [FILE] = argv.filter((a, i) => !a.startsWith('--') && !skip.has(i));
const LANG = arg('--lang') ?? 'en', TAG = arg('--tag'), JOB = arg('--job'), JSON_OUT = argv.includes('--json');
if (!FILE || [...VALUED].some(f => argv.includes(f) && arg(f) === undefined)){
  console.error('usage: node scripts/claims.mjs <resume-data.json> [--lang en] [--tag <t>] [--job <id>] [--json]');
  process.exit(2);
}
if (!LANGS.includes(LANG)){ console.error(`--lang ${LANG}: not one of ${LANGS.join(', ')}`); process.exit(2); }

let lib;
try { lib = readLibrary(FILE); } catch (e){ console.error(e.message); process.exit(1); }
const { model, saved } = lib;
for (const w of lib.warnings ?? []) console.error(`warning: ${FILE}: ${w}`);
const ix = indexOf(model);
const jobs = jobsOf(model);
if (JOB && !jobs.some(j => j.id === JOB)){
  console.error(`--job ${JOB}: no such job. Jobs: ${jobs.map(j => j.id).join(', ')}`);
  process.exit(1);
}

// a claim of an archived job can't be picked either
const claim = (id, job = null) => {
  const f = ix.fact.get(id);
  const versions = versionsOf(model, ix, f, LANG).map(v => (job?.archived && !v.refused ? { ...v, refused: 'archived job' } : v));
  return { id, summary: f.summary ?? '', archived: !!f.archived, versions };
};
const keep = c => !TAG || c.versions.some(v => v.tags.some(t => String(t).toLowerCase() === TAG.toLowerCase()));

// as the page does: this language's title, else the English one, else the record's own
const positionOf = j => {
  const f = ix.fact.get(j.display?.position);
  return ix.version.get(f?.default?.[LANG])?.text ?? ix.version.get(f?.default?.en)?.text ?? j.position ?? j.name ?? '';
};

const out = {
  file: FILE, ...(saved ? { saved } : {}), lang: LANG, options: { ...optionsOf(), langs: LANGS },
  jobs: jobs.filter(j => !JOB || j.id === JOB).map(j => ({
    id: j.id, position: positionOf(j),
    employer: j.name ?? j.entity ?? '', archived: !!j.archived, claims: (j.highlights ?? []).filter(id => ix.fact.has(id)).map(id => claim(id, j)).filter(keep),
  })),
};
if (!JOB){
  const sumId = model.basics?.summary ?? 'summary';
  out.summary = ix.fact.has(sumId) && keep(claim(sumId)) ? claim(sumId) : null;
  out.skills = (model.skills ?? []).map(s => ({ id: s.id, name: s.name, keywords: s.keywords ?? [] }));
  const inJobs = new Set(jobs.flatMap(j => j.highlights ?? []));
  out.sections = (model.sections ?? []).filter(s => !['header', 'summary'].includes(s.kind) && s.id !== sumId)
    .map(s => ({ id: s.id, title: s.title, pickable: false, claims: factIdsOfSection(s, ix).filter(id => !inJobs.has(id)).map(claim).filter(keep) }))
    .filter(s => s.claims.length);
}

// no process.exit after a write: a long listing piped to another program would be cut short
if (JSON_OUT) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
else {
  const mark = v => (v.refused ? `  [can't pick: ${v.refused}]` : '') + (v.default ? '  (the app shows this one)' : '') + (v.needsReview ? '  [machine-translated, needs review]' : '');
  const printClaim = (c, pad) => {
    console.log(`${pad}${c.id}  ${c.summary}${c.archived ? '  [archived claim]' : ''}`);
    for (const v of c.versions)
      console.log(`${pad}  ${v.id}  v${v.n}  ${v.chars} chars  [${v.tags.join(', ')}]${mark(v)}\n${pad}    ${v.text.replace(/\n/g, ' / ')}`);
    if (!c.versions.length) console.log(`${pad}  (no ${LANG} version)`);
  };
  console.log(`${FILE}${saved ? ` (saved ${saved})` : ''} · language ${LANG}${TAG ? ` · tag ${TAG}` : ''}`);
  const O = out.options;
  console.log(`picks.json may use: format ${O.formats.join(', ')} · look ${O.looks.map(l => l.id).join(', ')} (b2 when left out) · exportMedium ${O.exportMedia.join(', ')} (screen when left out)`);
  console.log('  "design" takes what the look offers (its own default is marked *; left out, a setting is the look\'s default):');
  for (const l of O.looks){
    const mark = (k, d) => l.design[k].map(v => (v === d ? `${v}*` : v)).join(' ');
    console.log(`    ${l.id}  ${l.name}: preset ${mark('preset', l.defaults.preset)} · fonts ${mark('fonts', l.defaults.fonts)} · size ${mark('size', 'medium')}`);
  }
  const l0 = O.looks[0].design;
  console.log(`    every look: density ${l0.density.join(' ')} · colour ${l0.colour.join(' ')} · words ${l0.words.join(' ')} (size small is not offered on us-letter)`);
  for (const j of out.jobs){
    console.log(`\n${j.id}: ${j.position}, ${j.employer}${j.archived ? '  [archived job]' : ''}`);
    for (const c of j.claims) printClaim(c, '  ');
  }
  if (out.summary){ console.log('\nsummary'); printClaim(out.summary, '  '); }
  if (out.skills?.length){
    console.log('\nskills (printed as they are in the record)');
    for (const s of out.skills) console.log(`  ${s.id}  ${s.name}: ${s.keywords.join(', ')}`);
  }
  for (const s of out.sections ?? []){ console.log(`\n${s.id}${s.title ? ` (${s.title})` : ''}: printed as the record has it, not picked`); for (const c of s.claims) printClaim(c, '  '); }
}
