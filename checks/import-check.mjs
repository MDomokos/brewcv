#!/usr/bin/env node
// node checks/import-check.mjs
// src/model/import.js: every kind of file is known by its contents, and a JSON Resume edited in
// another tool comes back with its edits turned into versions. Fictional data only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import * as S from '../src/model/schema.js';
import * as I from '../src/model/import.js';
import { resolve, newResume } from '../src/model/resume.js';
import { makeBackup } from '../src/store/persist.js';
import { validate } from './lib/validate.mjs';
import { createDocument } from '../scripts/lib/dom.mjs';
import { renderPages } from '../src/render.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const raw = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const read = f => JSON.parse(raw(f));
const clone = x => structuredClone(x);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);
const row = (got, label) => got.review.rows.find(r => r[0].startsWith(label))?.[1];

section('JSON Resume');
{
  const json = read('checks/fixtures/jsonresume-sample.json');
  const got = I.readImport(JSON.stringify(json), 'robin.json');
  ok('known by its contents', got.kind === 'jsonresume');
  ok('each highlight becomes a claim with v1', row(got, 'Claims') === '3' && got.model.facts.filter(f => got.model.work.some(w => w.highlights.includes(f.id))).every(f => f.variants.length === 1));
  ok('a job with no highlights is named in what is not shown', got.review.notShown.some(x => /Quiet Studio/.test(x)));
  ok('a linked photo is "linked, not embedded", and not fetched', /linked, not embedded/.test(row(got, 'Photo')) && !got.model.basics.image);
  const v = validate(S.save(got.model), newResume(got.model));
  ok('the record validates, and a new resume on it', v.errors.length === 0, v.errors[0]);
  ok('it renders', renderPages(got.model, newResume(got.model, { format: 'us-letter' }), createDocument()).pages.length >= 1);
  const back = resolve(got.model).body;
  ok('round trip: every highlight comes back, in order', eq(back.work.map(w => w.highlights), json.work.filter(w => (w.highlights ?? []).length).map(w => w.highlights)));
  ok('round trip: projects and awards are written back as they came', eq(back.projects, json.projects) && eq(back.awards, json.awards));
  ok('round trip: the summary, the skills and the languages', back.basics.summary === json.basics.summary && eq(back.skills.map(s => s.keywords), json.skills.map(s => s.keywords))
     && eq(back.languages.map(l => l.language), json.languages.map(l => l.language)));
  ok('the saved file is a JSON Resume', S.checkJsonResume(S.save(got.model)).length === 0);
  const emb = clone(json); emb.basics.image = 'data:image/' + 'png;base64,iVBORw0KGgo=';
  ok('an embedded photo is kept', I.readImport(JSON.stringify(emb)).model.basics.image === emb.basics.image);
}

section('JSON Resume, every field (2026-10-09)');
{
  // a file using every JSON Resume v1.0.0 field: what the app doesn't model must come back unchanged
  const json = read('checks/fixtures/jsonresume-full.json');
  const got = I.readImport(JSON.stringify(json), 'kai.json');
  const saved = S.save(got.model);
  const missing = [];
  const has = (a, b, p) => {
    if (Array.isArray(a)){ if (!Array.isArray(b)) return missing.push(p); a.forEach((x, i) => has(x, b[i], `${p}[${i}]`)); return; }
    if (a && typeof a === 'object'){ if (!b || typeof b !== 'object') return missing.push(p); for (const k of Object.keys(a)) has(a[k], b[k], `${p}.${k}`); return; }
    if (a !== b) missing.push(`${p}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  };
  const { meta: _meta, ...body } = json;
  has(body, saved, '');
  ok('every field comes back in the record\'s file, unchanged', missing.length === 0, missing.slice(0, 4).join('; '));
  ok('the file\'s meta.canonical is kept', saved.meta.canonical === json.meta.canonical);
  ok('the region stays the region, not part of the city', saved.basics.location.city === 'Exampleton' && saved.basics.location.region === 'Example Region');
  ok('the grade is score, never honours', saved.education[0].score === '3.8' && !('honours' in saved.education[0]));
  ok('the file is a JSON Resume', S.checkJsonResume(saved).length === 0, S.checkJsonResume(saved)[0]);
  const back = S.load(saved);
  ok('it loads with no warnings, and saves to the same bytes', back.warnings.length === 0 && S.serialize(S.save(back.model)) === S.serialize(saved), back.warnings[0]);
  // the resume as printed (JSON Resume export, ATS path) carries them too
  const pr = resolve(got.model).body;
  missing.length = 0;
  for (const [k, keys] of Object.entries({ work: ['url', 'description', 'summary'], education: ['url', 'score', 'courses', 'startDate'], certificates: ['date', 'url'], skills: ['level'], interests: ['keywords'], publications: ['url', 'summary'] }))
    for (const f of keys) if (JSON.stringify(pr[k]?.[0]?.[f]) !== JSON.stringify(json[k][0][f])) missing.push(`${k}.${f}`);
  for (const f of ['address', 'postalCode', 'region']) if (pr.basics.location[f] !== json.basics.location[f]) missing.push(`basics.location.${f}`);
  ok('the printed resume\'s JSON Resume has them too', missing.length === 0, missing.join(', '));
  ok('and the reference, with no resume to say otherwise', pr.references?.[0]?.name === 'Robin Example' && pr.references[0].reference === json.references[0].reference);
  ok('a reference is a text with versions, in a References section that is off', got.model.facts.some(f => f.id === got.model.references[0].id && f.term === 'Robin Example')
     && got.model.sections.find(s => s.id === 'references')?.off === true);
  const r = newResume(got.model);
  ok('so a new resume has it off, and its JSON Resume leaves it out', r.sections.find(s => s.id === 'references')?.weight === 0 && resolve(got.model, r).body.references === undefined);
}

section('records, backups, saved resumes, themes');
{
  const v3 = I.readImport(raw('checks/fixtures/example-0.4.v3.json'), 'old.json');
  ok('a resume-data/3 record', v3.kind === 'library' && /migrated/.test(row(v3, 'Format')));
  const v4 = I.readImport(raw('data/example.json'), 'example.json');
  ok('a v4 record, with its counts', v4.kind === 'library' && row(v4, 'Versions') === String(v4.model.variants.length) && /hu/.test(row(v4, 'Languages')));
  ok('with nothing edited outside', v4.outside.length === 0);
  const m = v4.model;
  const backup = makeBackup({ record: m, resumes: [newResume(m)] });
  const b = I.readImport(JSON.stringify(backup), 'backup.json');
  ok('a backup', b.kind === 'backup' && row(b, 'Saved resumes') === '1');
  const r = I.readImport(raw(`data/example-resumes/${read('data/example-resumes/index.json')[0]}`), 'r.json');
  ok('a saved resume, with its frozen text', r.kind === 'resume' && !!r.frozen && !!r.recipe.format);
  ok('a 0.4.0 recipe', I.readImport(raw('checks/fixtures/example-0.4-recipe.json')).kind === 'resume');
  ok('how many picks a resume matches on a record', I.picksMatched(m, r.recipe).matched === I.picksMatched(m, r.recipe).total);
  ok('a theme', I.readImport('{"name":"Slate","tokens":{"accent":"#9cc3ff"}}').kind === 'theme');
  const bad = I.readImport('{"hello":1}', 'x.json');
  ok('anything else says what was expected', bad.kind === 'error' && /Expected a JSON Resume/.test(bad.message));
  const broken = I.readImport('{"basics": ', 'x.json');
  ok('broken JSON shows the parser message', broken.kind === 'error' && /valid JSON\. .+/.test(broken.message));
}

section('a record edited outside Resume Builder');
{
  const file = read('data/example.json');
  const edited = clone(file);
  edited.basics.summary = 'Edited in another tool: a shorter summary.';
  const job = edited.work[0];
  const changed = job.highlights[1];
  job.highlights[1] = 'Rewritten elsewhere: built the test rig.';
  job.highlights.push('A brand new highlight added in a text editor.');
  const swapped = clone(file);
  [swapped.work[0].highlights[0], swapped.work[0].highlights[1]] = [swapped.work[0].highlights[1], swapped.work[0].highlights[0]];
  ok('load() still ignores them, with warnings', S.load(edited).warnings.length >= 2);
  const out = I.outsideEdits(edited);
  ok('three edits found: the summary, a highlight, a new highlight', out.length === 3 && out.filter(e => e.kind === 'version').length === 2 && out.filter(e => e.kind === 'claim').length === 1, JSON.stringify(out.map(e => e.kind)));
  ok('a reorder is not an edit', I.outsideEdits(swapped).length === 0);
  const got = I.readImport(JSON.stringify(edited), 'edited.json');
  ok('the review says so', /3 texts/.test(row(got, 'Edited outside') ?? ''));
  const model = got.model;
  const n = I.applyOutsideEdits(model, got.outside);
  ok('applying turns them into versions and a claim', n === 3);
  const saved = S.save(model);
  ok('the record now says what the file said', saved.basics.summary === edited.basics.summary && saved.work[0].highlights.includes('Rewritten elsewhere: built the test rig.')
     && saved.work[0].highlights.includes('A brand new highlight added in a text editor.'));
  ok('and nothing is left to report', I.outsideEdits(saved).length === 0 && S.load(saved).warnings.length === 0, JSON.stringify(S.load(saved).warnings));
  ok('the old wording is still a version', model.variants.some(v => v.text === changed));
  ok('it validates', validate(saved).errors.length === 0, validate(saved).errors[0]);
}

console.log(failed ? `\n${failed} import check(s) FAILED` : '\nall import checks passed');
process.exit(failed ? 1 : 0);
