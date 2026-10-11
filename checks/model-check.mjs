#!/usr/bin/env node
// node checks/model-check.mjs [resume-data.json]
// src/model/schema.js and src/model/resume.js, in Node. With a real library (resume-data/3 or /4) it also
// migrates and round-trips it, and renders each recipe beside it from the library as given and from
// saved v4 files: the two must be byte-identical. Scratch files go to the system temp folder.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual as eq } from 'node:util';
import * as S from '../src/model/schema.js';
import { DB_NAME, makeBackup, readBackup } from '../src/store/persist.js';
import { resolve, offOf, keepOf, chooseVariant } from '../src/model/resume.js';
import { validate } from './lib/validate.mjs';
import { createDocument, serialize as serializeDom } from '../scripts/lib/dom.mjs';
import { renderPages } from '../src/render.js';
import { autoLayout } from '../src/paginate.js';
import { modelFlow } from '../src/fit.js';
import { geometryFor } from './lib/geometry.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.isAbsolute(f) ? f : path.join(REPO, f), 'utf8'));
const clone = x => structuredClone(x);

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`);
  if (!cond) failed++;
};
const section = t => console.log(`\n— ${t}`);
const has = (list, re) => list.some(m => re.test(m));
// split, so the deploy preflight does not read these as embedded photos
const PNG = 'data:image/' + 'png;base64,', JPEG = 'data:image/' + 'jpeg;base64,';
const noMeta = m => { const c = clone(m); delete c.meta; return c; };

const v3 = read('checks/fixtures/example-0.4.v3.json');
const v4file = read('checks/fixtures/example-0.4.json');
const recipe3 = read('checks/fixtures/example-0.4-recipe.json');
const example = read('data/example.json');

section('detect: a file is known by its contents');
{
  const rf = S.saveResume(S.load(v3).model, recipe3).file;
  const cases = [[v3, 'library-v3'], [v4file, 'library'], [example, 'library'], [recipe3, 'recipe-v3'], [rf, 'resume'],
    [{ resumeBuilderBackup: 1 }, 'backup'], [{ name: 'Slate', tokens: { accent: '#000000' } }, 'theme'],
    [{ basics: { name: 'x' }, work: [] }, 'jsonresume'], [{ hello: 1 }, 'unknown'], [[], 'unknown'], [null, 'unknown']];
  for (const [j, want] of cases) ok(`${want}`, S.detect(j) === want, S.detect(j));
}

section('migrate: resume-data/3 → 4');
{
  const m = S.migrate(v3);
  ok('schema is resume-data/4', m.schema === S.SCHEMA);
  ok('migration is idempotent', eq(S.migrate(m), m));
  ok('every version has a number', m.variants.every(v => /^\d+(\.\d+)?$/.test(v.n)));
  const f = m.facts.find(x => x.id === 'hydra-inhaler');
  ok('numbers follow library order: -short is v1, -full is v2',
    m.variants.find(v => v.id === 'hydra-inhaler-short').n === '1' && m.variants.find(v => v.id === 'hydra-inhaler-full').n === '2');
  ok('the default is -base where there is one', m.facts.find(x => x.id === 'hydra-testing').default.en === 'hydra-testing-base');
  ok('else the first version', f.default.en === 'hydra-inhaler-short');
  ok('the v4 keys are added empty', eq(m.same, []) && eq(m.jobTypes, []) && eq(m.themes, []));
  ok('a migrated v3 record is in vault mode', m.requireSource === true);
  const strip = clone(m);
  for (const k of ['same', 'jobTypes', 'themes', 'requireSource']) delete strip[k];
  strip.schema = v3.schema;
  strip.facts.forEach(x => delete x.default); strip.variants.forEach(x => delete x.n);
  // migration renames honours to score; rename back to compare
  for (const [key, from, to] of S.RENAMED) for (const x of strip[key] ?? []) if (to in x){ x[from] = x[to]; delete x[to]; }
  ok('migration renames honours to JSON Resume\'s score', m.education[0].score === 'Distinction' && !('honours' in m.education[0]));
  ok('nothing else changes: minus the additions and that rename it is the v3 file', eq(strip, v3));

  const g = clone(m);
  g.variants.find(v => v.id === 'hydra-inhaler-full').n = '5';
  delete g.variants.find(v => v.id === 'hydra-inhaler-short').n;
  const gm = S.migrate(g);
  ok('existing numbers are kept and new ones come after them',
    gm.variants.find(v => v.id === 'hydra-inhaler-full').n === '5' && gm.variants.find(v => v.id === 'hydra-inhaler-short').n === '6');
  const h = clone(m); h.facts.find(x => x.id === 'hydra-inhaler').default.en = 'poly-shop-short';
  ok('a default that is not one of its versions is repaired', S.migrate(h).facts.find(x => x.id === 'hydra-inhaler').default.en === 'hydra-inhaler-short');
  const v2 = clone(v3); v2.schema = 'resume-data/2'; v2.variants.forEach(v => delete v.lang);
  ok('resume-data/2 migrates too, with lang made explicit', S.migrate(v2).variants.every(v => v.lang === 'en'));
}

section('save/load: the file is a JSON Resume, and nothing is lost');
function roundTrip(label, file){
  const { model } = S.load(file);
  const saved = S.save(model);
  const back = S.load(saved);
  ok(`${label}: load(save(m)) is m`, eq(back.model, model));
  ok(`${label}: saving is deterministic`, S.serialize(S.save(back.model)) === S.serialize(saved));
  ok(`${label}: the file passes the JSON Resume v1.0.0 types`, S.checkJsonResume(saved).length === 0, S.checkJsonResume(saved)[0]);
  ok(`${label}: and loads with no warnings`, back.warnings.length === 0, back.warnings[0]);
  return { model, saved };
}
{
  const a = roundTrip('0.4.0 example from v3', v3);
  const b = roundTrip('0.4.0 example fixture (v4)', v4file);
  ok('the v4 fixture is the v3 example migrated', eq(noMeta(a.model), noMeta(b.model)));
  roundTrip('the shipped example', example);
  ok('the shipped example on disk is exactly what save() writes', S.serialize(S.save(S.load(example).model)) === fs.readFileSync(path.join(REPO, 'data/example.json'), 'utf8'));

  const { saved, model } = a;
  ok('the body has JSON Resume text, not fact ids',
    saved.basics.summary.startsWith('Mechanical engineer') && saved.work[0].highlights[0].startsWith('Led the dose-counter'));
  ok('the ids are kept under meta.resumeBuilder', saved.meta.resumeBuilder.summary === 'summary'
    && eq(saved.meta.resumeBuilder.highlights.hydra, model.work[0].highlights));
  ok('a null endDate is left out of the body, and comes back', saved.work[0].endDate === undefined && S.load(saved).model.work[0].endDate === null);
  ok('$schema names JSON Resume', saved.$schema === S.JSON_RESUME_SCHEMA && saved.meta.version === 'v1.0.0');

  const withPhoto = clone(model);
  withPhoto.basics.portrait = { state: 'present', src: PNG + 'AAAA', width: 300, height: 300, bytes: 3, source: 'x' };
  const pf = S.save(withPhoto);
  ok('a portrait is written as basics.image, once', pf.basics.image === PNG + 'AAAA' && pf.basics.portrait.src === undefined);
  ok('and read back into the portrait', eq(S.load(pf).model, withPhoto));

  let threw = false; try { S.save({ ...model, highlights: 1 }); } catch { threw = true; }
  ok('a root key the file format reserves is refused', threw);
}

section('load: edits made in another tool are reported, not imported (the import makes them versions)');
{
  const saved = S.save(S.load(v3).model);
  const e1 = clone(saved); e1.basics.summary = 'Edited in another tool.';
  const r1 = S.load(e1);
  ok('an edited summary warns', has(r1.warnings, /summary was edited outside/));
  ok('and the claim id is what the model keeps', r1.model.basics.summary === 'summary');
  const e2 = clone(saved); e2.work[0].highlights[1] = 'Something else.';
  ok('an edited highlight warns, naming the job', has(S.load(e2).warnings, /work hydra highlights were edited/));
  const e3 = clone(saved); e3.work.push({ name: 'New Co', position: 'Engineer', startDate: '2026-01', highlights: ['Did a thing.'] });
  const r3 = S.load(e3);
  ok('a job added elsewhere, with highlights and no claims, warns', has(r3.warnings, /no claims behind them/));
  const e4 = clone(saved); e4.work[0].name = 'Hydra Medical SA';
  const r4 = S.load(e4);
  ok('a spine field edited elsewhere is simply read (the body owns it)', r4.warnings.length === 0 && r4.model.work[0].name === 'Hydra Medical SA');
  ok('a v3 file loads with one warning', S.load(v3).warnings.length === 1);
  let threw = false; try { S.load(recipe3); } catch (e){ threw = /recipe-v3/.test(e.message); }
  ok('a recipe is not a library', threw);
}

section('checkJsonResume: the JSON Resume types');
{
  const base = S.save(S.load(v3).model);
  const bad = (fn, re, name) => { const f = clone(base); fn(f); ok(name, has(S.checkJsonResume(f), re), S.checkJsonResume(f).join('; ')); };
  bad(f => { f.work[0].endDate = null; }, /work\[0\]\.endDate/, 'null date');
  bad(f => { f.work[0].startDate = 'March 2023'; }, /not a JSON Resume date/, 'a date that is not YYYY, YYYY-MM or YYYY-MM-DD');
  bad(f => { f.basics.summary = 3; }, /basics\.summary: must be a string/, 'a number where a string goes');
  bad(f => { f.work[0].highlights = ['ok', { id: 'x' }]; }, /highlights: must be an array of strings/, 'a highlight that is not a string');
  bad(f => { f.skills = {}; }, /skills: must be an array/, 'a section that is not an array');
}

section('resolve: one selection rule');
{
  const m = S.load(v3).model;
  const { body, problems } = resolve(m, recipe3);
  const gold = read('checks/fixtures/example-0.4.jsonresume-golden.json');
  delete gold.$schema; delete gold.meta;
  // the golden file has the grade as a one-item `courses`; it is `score` now
  for (const e of gold.education ?? []) if (Array.isArray(e.courses) && e.courses.length === 1){ e.score = e.courses[0]; delete e.courses; }
  ok('the body is what to-jsonresume wrote before 0.5.1, field for field, but for the grade (score, not courses)', eq(body, gold));
  ok('the grade goes out as score', body.education[0].score === 'Distinction' && body.education[0].courses === undefined);
  ok('with no problems', problems.length === 0, problems[0]);
  const lib = resolve(m);
  ok('with no recipe, every job prints', lib.body.work.length === m.work.length);
  const hu = clone(recipe3); hu.lang = 'hu';
  ok('a language with no versions prints in English, and says so', has(resolve(m, hu).problems, /no "hu" version, so it prints in English/)
     && resolve(m, hu).body.work.length === resolve(m, recipe3).body.work.length);
  const r = { pins: { exclude: ['a'], include: ['b'], phrasing: ['b', 'c'] } };
  ok('off and keep read the 0.4.0 pins', eq(offOf(r), ['a']) && eq(keepOf(r), ['b', 'c']));
  const draft = clone(m); draft.variants.find(v => v.id === 'summary-base').id = 'summary-draft-x';
  draft.facts.find(f => f.id === 'summary').variants = ['summary-draft-x'];
  ok('a draft is a problem', has(resolve(draft, recipe3).problems, /unreviewed draft/));
  const nosrc = clone(m); delete nosrc.variants[0].source;
  ok('no source is a problem in vault mode', chooseVariant(nosrc, nosrc.facts.find(f => f.variants.includes(nosrc.variants[0].id)).id).probs.some(p => /no source/.test(p)));
  nosrc.requireSource = false;
  ok('and not outside it', !chooseVariant(nosrc, nosrc.facts.find(f => f.variants.includes(nosrc.variants[0].id)).id).probs.some(p => /no source/.test(p)));
}

section('saved resumes: one JSON Resume file each');
{
  const m = S.load(v3).model;
  const { file, problems } = S.saveResume(m, recipe3);
  ok('a saved resume is a valid JSON Resume', S.checkJsonResume(file).length === 0);
  ok('its body is the printed text, frozen', eq({ basics: file.basics, work: file.work }, (({ basics, work }) => ({ basics, work }))(resolve(m, recipe3).body)));
  ok('no ATS problems for the example', problems.length === 0);
  const back = S.loadResume(file, m);
  ok('loadResume gives back the recipe, migrated', eq(back.recipe, S.migrateRecipe(recipe3)));
  ok('migration of a recipe only adds keys', Object.entries(recipe3).every(([k, v]) => eq(back.recipe[k], v)));
  ok('company and role are split from the application', back.recipe.company === 'Example Instruments' && back.recipe.role === 'Design Engineer');
  ok('pageLimit comes from the manual layout', back.recipe.pageLimit === recipe3.pages.length);
  ok('migrateRecipe is idempotent', eq(S.migrateRecipe(back.recipe), back.recipe));
  ok('nothing newer to report straight after saving', S.newerWording(m, back.frozen, back.recipe).length === 0);
  const later = clone(m);
  const v = later.variants.find(x => x.id === recipe3.picks['hydra-inhaler']);   // the version this resume prints
  v.text = v.text.replace('Led', 'Ran');
  const newer = S.newerWording(later, back.frozen, back.recipe);
  ok('a reworded version shows as newer wording, with its path', newer.length === 1 && /^work\.\d+\.highlights\.\d+$/.test(newer[0].path), JSON.stringify(newer));
  const other = clone(m); other.facts.push({ id: 'extra', variants: [] });
  ok('opening against a different record warns', has(S.loadResume(file, other).warnings, /different record/));
  ok('a v3 recipe opens unchanged, with nothing frozen', eq(S.loadResume(recipe3).recipe, recipe3) && S.loadResume(recipe3).frozen === null);
  ok('file name: Company - Role', S.resumeFileName({ company: 'A&B Ltd', role: 'Engineer / Designer' }) === 'A and B Ltd - Engineer Designer.json');
  ok('file name: falls back to the application', S.resumeFileName({ application: 'US One-Pager' }) === 'US One-Pager.json');
}

section('validate: the v4 rules');
{
  const m = S.load(v3).model;
  const errs = (fn, recipe = null) => { const d = clone(m); fn(d); return validate(d, recipe).errors; };
  const warns = (fn, recipe = null) => { const d = clone(m); fn(d); return validate(d, recipe).warnings; };
  const vv = (d, id) => d.variants.find(v => v.id === id);
  ok('the migrated example validates clean', validate(m).errors.length === 0 && validate(m).warnings.length === 0, validate(m).warnings[0]);
  ok('a v3 file validates, with one migration warning', validate(v3).errors.length === 0 && has(validate(v3).warnings, /migrated in memory/));
  ok('a v4 file validates clean', validate(v4file).errors.length === 0 && validate(v4file).warnings.length === 0);
  ok('two dots is not a version number', has(errs(d => { vv(d, 'hydra-inhaler-full').n = '2.2.5'; }), /at most one dot/));
  ok('a duplicate number in one fact and language', has(errs(d => { vv(d, 'hydra-inhaler-full').n = '1'; }), /is also hydra-inhaler-short/));
  ok('the same number in two languages is fine', !errs(d => {
    const v = clone(vv(d, 'hydra-inhaler-short')); v.id = 'hydra-inhaler-short-hu'; v.lang = 'hu'; d.variants.push(v);
    d.facts.find(f => f.id === 'hydra-inhaler').variants.push(v.id);
  }).length);
  ok('a default from another fact', has(errs(d => { d.facts.find(f => f.id === 'hydra-inhaler').default.en = 'poly-shop-short'; }), /not one of its versions/));
  ok('a photo over 300 KB', has(errs(d => { d.basics.image = JPEG + 'A'.repeat(420_000); }), /capped at 300 KB/));
  ok('vault mode: no source is an error', has(errs(d => { delete d.variants[0].source; }), /no source/));
  ok('outside it, not', !has(errs(d => { delete d.variants[0].source; d.requireSource = false; }), /no source/));
  ok('jobTypes must be strings', has(errs(d => { d.jobTypes = ['ok', 3]; }), /jobTypes/));
  const r = extra => ({ ...clone(recipe3), ...extra });
  ok('pageLimit is 0, 1 or 2', has(errs(() => {}, r({ pageLimit: 3 })), /pageLimit/));
  ok('pageLimit against a manual layout of another length warns', has(warns(() => {}, r({ pageLimit: 1 })), /`pages` wins/));
  ok('pageLimit 0 with a manual layout does not', !has(warns(() => {}, r({ pageLimit: 0 })), /pageLimit/));
  const withLabel = (id, label) => r({ sections: [...recipe3.sections, { id, label }] });
  ok('a label on the header is refused', has(errs(() => {}, withLabel('header', 'Me')), /header has no heading/));
  ok('an empty label is refused', has(errs(() => {}, withLabel('skills', ' ')), /non-empty/));
  ok('a per-language label is accepted', !errs(() => {}, withLabel('skills', { en: 'Tools', hu: 'Eszközök' })).length);
  ok('accent is #rrggbb', has(errs(() => {}, r({ accent: 'yellow' })), /accent/));
  ok('photo shape is checked', has(errs(() => {}, r({ photo: { show: true, shape: 'oval' } })), /photo\.shape/));
  ok('a saved resume file validates as a recipe', validate(m, S.saveResume(m, recipe3).file).errors.length === 0);
}

section('the shipped example: data/example.json and data/example-resumes/');
{
  const { model } = S.load(example);
  ok('validates clean', validate(model).errors.length === 0, validate(model).errors[0]);
  ok('is not in vault mode', model.requireSource === false);
  ok('has four job types, and Hungarian', model.jobTypes.length === 4 && model.variants.some(v => v.lang === 'hu'));
  ok('leaves some Hungarian missing on purpose', model.facts.some(f => !f.variants.some(id => model.variants.find(v => v.id === id).lang === 'hu')));
  const dir = path.join(REPO, 'data/example-resumes');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json').sort();
  ok('fourteen saved resumes: the six of 0.5.13 and one per new language (0.6.5)', files.length === 14, files.join(', '));
  // index.json spells names in NFC, but a Mac may hand a decomposed name back from disk: accept either
  const listed = read('data/example-resumes/index.json');
  ok('index.json lists every saved resume, spelled NFC', listed.length === files.length && listed.every(n => n === n.normalize('NFC') && files.some(f => f.normalize('NFC') === n)));
  for (const f of files){
    const json = read(path.join(dir, f));
    const { recipe, frozen } = S.loadResume(json, model);
    const v = validate(model, json);
    ok(`${f}: validates`, v.errors.length === 0, v.errors[0]);
    ok(`${f}: is a JSON Resume, named Company - Role`, S.checkJsonResume(json).length === 0 && S.resumeFileName(recipe).normalize('NFC') === f.normalize('NFC'));
    ok(`${f}: its frozen text is current`, S.newerWording(model, frozen, recipe).length === 0);
    // the older form (grade in a one-item courses, no degree start date) is not news
    const old = structuredClone(frozen);
    for (const e of old.education ?? []){ if (e.score !== undefined){ e.courses = [e.score]; delete e.score; } delete e.startDate; }
    ok(`${f}: saved before the score rename, its frozen text is still current`, S.newerWording(model, old, recipe).length === 0, JSON.stringify(S.newerWording(model, old, recipe)[0]));
    // paginated on the line model here; checks/paginate-check.mjs --browser does it for real
    let pages = 0, err = '';
    try {
      const laid = await autoLayout(model, recipe, modelFlow(model, geometryFor(REPO, recipe)));
      pages = renderPages(model, laid, createDocument()).pages.length;
    } catch (e){ err = e.message; }
    ok(`${f}: paginates and renders within ${recipe.pageLimit} page${recipe.pageLimit === 1 ? '' : 's'}`, pages >= 1 && pages <= recipe.pageLimit, err || `${pages} pages`);
  }
  const def = read('data/example-recipe.json');
  ok('data/example-recipe.json is the first saved resume', eq(def, read(path.join(dir, 'Example Instruments - Design Engineer.json'))));
}

const LIB = process.argv[2];
if (LIB){
  section(`the library you passed: ${path.basename(LIB)}`);
  const json = read(LIB);
  const before = fs.readFileSync(LIB);
  const { model, warnings } = S.load(json);
  ok(`it loads (${S.detect(json)})`, !!model, warnings.join('; '));
  const saved = S.save(model);
  ok('migrated, it round-trips', eq(S.load(saved).model, model));
  ok('the v4 file is a valid JSON Resume', S.checkJsonResume(saved).length === 0, S.checkJsonResume(saved)[0]);
  ok('it validates as it did', validate(saved).errors.length === validate(json).errors.length);

  const dir = path.join(path.dirname(LIB), 'recipes');
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'model-check-'));
  try {
    const lib4 = path.join(scratch, 'resume-data.json');
    fs.writeFileSync(lib4, S.serialize(saved));
    const render = (lib, rec, out) => {
      execFileSync(process.execPath, [path.join(REPO, 'scripts/render.mjs'), lib, rec, out], { stdio: ['ignore', 'ignore', 'pipe'] });
      return fs.readFileSync(out);
    };
    for (const n of names){
      const rec = path.join(dir, n);
      const recipe = S.loadResume(read(rec), model).recipe;
      const rf = path.join(scratch, `r-${n}`);
      fs.writeFileSync(rf, S.serialize(S.saveResume(model, recipe).file));
      const a = render(LIB, rec, path.join(scratch, 'a.html'));
      const b = render(lib4, rf, path.join(scratch, 'b.html'));
      ok(`${n}: renders byte-identical from the v4 library and its v4 resume file`, a.equals(b));
      ok(`${n}: the saved resume is a valid JSON Resume`, S.checkJsonResume(S.saveResume(model, recipe).file).length === 0);
    }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  ok('the library file on disk was not touched', fs.readFileSync(LIB).equals(before));
}

section('snapshots and For: kept by the saved-resume file, a backup, a folder and the JSON Resume export');
{
  const RS = await import('../src/model/resumes.js');
  const X = await import('../src/export.js');
  const { filesOf, readFolder, memoryFolder } = await import('../src/store/persist.js');
  const model = S.load(read('data/example.json')).model;
  const names = read('data/example-resumes/index.json');
  const resumes = [], frozen = {};
  for (const n of names){ const got = S.loadResume(read(`data/example-resumes/${n}`), model); resumes.push({ ...got.recipe, id: n }); frozen[n] = got.frozen; }
  const st = { record: clone(model), resumes, frozen, cur: null, openId: null };
  RS.openSaved(st, names[0]);
  ok('an old file has no snapshots and no For kind, and loads as it did', !('snapshots' in resumes[0]) && !('forKind' in resumes[0]) && S.saveResume(model, resumes[0], frozen[names[0]]).file.meta.resumeBuilder.snapshots === undefined);
  st.cur.forKind = 'outreach'; st.cur.name = 'Geospatial - GIS Solutions Engineer';
  RS.settle(st);
  RS.takeSnapshot(st, { kind: 'outreach', company: 'Geospatial', role: 'GIS Engineer', date: '2026-10-02' }, { at: '2026-10-02T09:00:00.000Z' });
  RS.takeSnapshot(st, { kind: 'company', company: 'Leica Geosystems', role: 'GIS Engineer', date: '2026-10-03' });
  const saved = RS.savedOf(st);
  const { id: savedId, ...bareSaved } = saved;
  const { file } = S.saveResume(st.record, { ...bareSaved }, st.frozen[savedId]);
  const rb = file.meta.resumeBuilder;
  ok('the file keeps snapshots beside the recipe, not inside it', Array.isArray(rb.snapshots) && rb.snapshots.length === 1 && !('snapshots' in rb.resume) && rb.resume.forKind === 'outreach');
  ok('…each with an id, a time, its sends, the recipe and the body that printed', rb.snapshots[0].id && rb.snapshots[0].at && rb.snapshots[0].sends.length === 2 && rb.snapshots[0].recipe.format && rb.snapshots[0].body.basics);
  ok('…the file is still valid JSON Resume with the same body', validate(S.save(st.record), file).errors.length === 0 && eq(S.checkJsonResume(file), []));
  const back = S.loadResume(JSON.parse(JSON.stringify(file)), st.record);
  ok('load → save is lossless for snapshots and For', eq(back.recipe.snapshots, saved.snapshots) && back.recipe.forKind === 'outreach' && back.recipe.name === saved.name && !back.warnings.length);
  ok('a second round trip gives the same file', eq(JSON.parse(S.serialize(S.saveResume(st.record, back.recipe, back.frozen).file)), JSON.parse(S.serialize(file))));
  const bk = readBackup(JSON.parse(JSON.stringify(makeBackup(st))));
  const inBk = bk.state.resumes.find(r => r.name === saved.name);
  ok('a backup keeps them', eq(inBk.snapshots, saved.snapshots) && inBk.forKind === 'outreach' && !('snapshots' in bk.state.cur));
  const folder = memoryFolder();
  for (const [p, text] of filesOf(st)) await folder.write(p, text);
  const fr = await readFolder(folder);
  ok('a folder keeps them', eq(fr.state.resumes.find(r => r.name === saved.name).snapshots, saved.snapshots));
  const jr = X.jsonResumeFile(model, RS.snapshotRecipe(st.record, saved.snapshots[0])).file;
  ok('the JSON Resume export of a snapshot is the body that was sent, valid and without app keys', eq(S.checkJsonResume(jr), []) && !JSON.stringify(jr).includes('snapshots') && JSON.stringify(jr.work) === JSON.stringify(saved.snapshots[0].body.work));
  const bad = JSON.parse(JSON.stringify(file));
  bad.meta.resumeBuilder.snapshots.push({ id: 's9' }, 'junk', { id: 's1', recipe: {}, body: {} });
  const got = S.loadResume(bad, st.record);
  ok('a damaged snapshot is dropped with a warning, the rest load', got.recipe.snapshots.length === 1 && got.warnings.length === 3);
  const odd = JSON.parse(JSON.stringify(file)); odd.meta.resumeBuilder.snapshots[0].sends = [{ kind: 'weird', company: 5 }];
  ok('an unknown send kind reads as a company', S.loadResume(odd, st.record).recipe.snapshots[0].sends[0].kind === 'company');
}

section('names that are kept on purpose: renaming any of them orphans saved data');
{
  ok("the IndexedDB name is still 'resume-builder'", DB_NAME === 'resume-builder');
  ok("a backup is still marked resumeBuilderBackup: 1", makeBackup({ record: S.load(read('data/example.json')).model, resumes: [] }).resumeBuilderBackup === 1);
  ok("a file with resumeBuilderBackup is still read as a backup", S.detect({ resumeBuilderBackup: 1 }) === 'backup');
  const saved = S.save(S.load(read('data/example.json')).model);
  ok("a saved library still carries meta.resumeBuilder, with schema resume-data/4", saved.meta.resumeBuilder?.schema === 'resume-data/4' && S.SCHEMA === 'resume-data/4');
  ok("the resume schema id is still resume-recipe/4", S.RESUME_SCHEMA === 'resume-recipe/4');
}

section('archived claims survive every way the record is written');
{
  const m = S.load(read('data/example.json')).model;
  const archived = m.facts.filter(f => f.archived).map(f => f.id);
  ok('the example has an archived claim', archived.length >= 1, JSON.stringify(archived));
  const again = S.load(S.save(m)).model;
  ok('save then load keeps it', eq(again.facts.filter(f => f.archived).map(f => f.id), archived));
  ok('…and a second save writes the same bytes', S.serialize(S.save(again)) === S.serialize(S.save(m)));
  const back = readBackup(JSON.parse(JSON.stringify(makeBackup({ record: m, resumes: [], frozen: {} }))));
  ok('a backup round trip keeps it', eq(back.state.record.facts.filter(f => f.archived).map(f => f.id), archived));
  const v3 = S.migrate({ ...JSON.parse(JSON.stringify(m)), schema: 'resume-data/3', facts: m.facts.map(({ archived: _a, ...f }) => f) });
  ok('a migrated v3 record has none', !v3.facts.some(f => f.archived));
  ok('the validator accepts the example', validate(S.save(m), null).errors.length === 0);
}

section('job types: a string or { id, label, tags }');
{
  const m = S.load(read('data/example.json')).model;
  const back = S.load(S.save(m)).model;
  ok('both forms survive save and load, byte for byte', eq(back.jobTypes, m.jobTypes) && m.jobTypes.some(j => typeof j === 'object'));
  const e = d => validate(S.save(d), null).errors.map(x => x.msg ?? String(x));
  const bad = fn => { const d = clone(m); fn(d); return e(d).some(x => /jobTypes/.test(x)); };
  ok('the validator accepts the example', e(m).length === 0, e(m)[0]);
  ok('a job type needs an id', bad(d => { d.jobTypes = [{ label: 'x', tags: [] }]; }));
  ok('its tags must be strings', bad(d => { d.jobTypes = [{ id: 'x', tags: [1] }]; }));
  ok('a number is still not a job type', bad(d => { d.jobTypes = ['ok', 3]; }));
}

console.log(failed ? `\n${failed} model check(s) FAILED` : '\nall model checks passed');
process.exit(failed ? 1 : 0);
