#!/usr/bin/env node
// node checks/agent-check.mjs
// The agent workflow end to end on the fictional example: claims → new-resume → fit (the dry line model,
// no browser) → to-jsonresume → keyword-gap, and every case new-resume refuses. Fictional data only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as S from '../src/model/schema.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);
const run = (script, ...args) => {
  const r = spawnSync(process.execPath, [path.join(REPO, script), ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brewcv-agent-'));
const w = (name, json) => { const f = path.join(tmp, name); fs.writeFileSync(f, typeof json === 'string' ? json : JSON.stringify(json)); return f; };
const EX = 'data/example.json';
const AD = 'checks/fixtures/ad-example.txt';

section('keyword-gap: stop words');
{
  const src = fs.readFileSync(path.join(REPO, 'checks/keyword-gap.mjs'), 'utf8');
  const stop = src.slice(src.indexOf('new Set(`') , src.indexOf('`.split'));
  ok('the stop-word list is plain ASCII', !/[^\x00-\x7f]/.test(stop), JSON.stringify(stop.match(/\S*[^\x00-\x7f]\S*/g)));
  const ad = w('join.txt', 'Join the team. Join the team.\n');
  const r = run('checks/keyword-gap.mjs', path.join(REPO, EX), ad);
  ok('"join" and "team" are stop words', /0 terms/.test(r.out), r.out.split('\n').slice(0, 5).join(' | '));
}

section('claims');
const model = S.load(read(EX)).model;
const cl = run('scripts/claims.mjs', EX, '--json');
const claims = cl.code === 0 ? JSON.parse(cl.out) : null;
ok('claims.mjs --json reads the example', !!claims, cl.err);
const allBullets = claims.jobs.flatMap(j => j.claims);
const first = claims.jobs.find(j => j.id === 'hydra');
ok('every job lists its claims, each with versions in English', claims.jobs.length === (model.work.length + model.projects.length) && allBullets.every(c => c.versions.length > 0));
ok('a version carries id, number, characters, tags and text', Object.keys(first.claims[0].versions[0]).join() === 'id,n,chars,tags,text,default,refused');
ok('the summary, skills and other sections are listed', claims.summary?.versions.length > 1 && claims.skills.length > 0 && claims.sections.some(s => s.id === 'education'));
const textOut = run('scripts/claims.mjs', EX, '--job', 'hydra');
ok('the text output is for reading', textOut.code === 0 && textOut.out.includes('hydra-inhaler-v1') && !textOut.out.includes('poly'));
ok('--job narrows to one job', JSON.parse(run('scripts/claims.mjs', EX, '--job', 'hydra', '--json').out).jobs.length === 1);
ok('--tag keeps claims with a version carrying it', JSON.parse(run('scripts/claims.mjs', EX, '--tag', 'cad', '--json').out).jobs.flatMap(j => j.claims).length < allBullets.length);
ok('an unknown job is refused', run('scripts/claims.mjs', EX, '--job', 'nope').code === 1);

// a copy of the example with a draft and an archive version, and the same record as the one file
const rec = read(EX);
const rb = rec.meta.resumeBuilder;
const fact = rb.facts.find(f => f.id === 'hydra-inhaler');
const mk = (id, extra) => ({ ...rb.variants.find(v => v.id === 'hydra-inhaler-v1'), id, n: '9', ...extra });
rb.variants.push(mk('hydra-inhaler-draft-1', {}), mk('hydra-inhaler-old', { tags: ['Archive'] }));
fact.variants.push('hydra-inhaler-draft-1', 'hydra-inhaler-old');
const traps = w('traps.json', rec);
const oneFile = w('one.json', { resumeBuilderBackup: 1, saved: '2026-01-02T03:04:05Z', record: rec, resumes: [] });
{
  const j = JSON.parse(run('scripts/claims.mjs', traps, '--json').out);
  const vs = j.jobs.find(x => x.id === 'hydra').claims.find(c => c.id === 'hydra-inhaler').versions;
  ok('a draft and an archive version are marked, not hidden',
    vs.find(v => v.id === 'hydra-inhaler-draft-1')?.refused === 'draft' && vs.find(v => v.id === 'hydra-inhaler-old')?.refused === 'archive'
    && vs.filter(v => v.refused).length === 2);
  ok('the text output says why', /hydra-inhaler-draft-1[^\n]*can't pick: draft/.test(run('scripts/claims.mjs', traps).out));
  const o = JSON.parse(run('scripts/claims.mjs', oneFile, '--json').out);
  ok('the one file reads like the record, and says when it was saved', o.saved === '2026-01-02T03:04:05Z' && JSON.stringify(o.jobs) === JSON.stringify(j.jobs));
  const before = fs.readFileSync(traps, 'utf8');
  ok('claims writes nothing', before === fs.readFileSync(traps, 'utf8'));
}

{
  // a listing longer than a pipe's buffer must arrive whole
  const big = JSON.parse(JSON.stringify(rec));
  big.meta.resumeBuilder.variants.find(v => v.id === 'hydra-inhaler-v1').text = 'x'.repeat(300000);
  const r = run('scripts/claims.mjs', w('big.json', big), '--json');
  ok('a long --json listing is not cut short', r.code === 0 && (() => { try { return JSON.parse(r.out).jobs.length > 0; } catch { return false; } })(), r.out.length);
}

section('new-resume');
const out = path.join(tmp, 'out');
const picks = (extra = {}) => ({ company: 'Northgate Dosing Systems', role: 'Mechanical Design Engineer', lang: 'en', format: 'a4', pageLimit: 1,
  theme: 'b2-marker', jobType: 'Medical devices', summary: 'summary-v1',
  bullets: ['hydra-inhaler-v2-1', 'hydra-testing-v1-1', 'hydra-suppliers-v2', 'hydra-dfm-v1', 'hydra-tolerance-v1'], ...extra });
const mkPicks = (name, p) => w(name, p);
const empty = d => !fs.existsSync(d) || fs.readdirSync(d).length === 0;
const refuse = (what, file, data = EX, pattern) => {
  const r = run('scripts/new-resume.mjs', data, file, path.join(tmp, 'refused'));
  ok(`refuses ${what}, and writes nothing`, r.code === 1 && empty(path.join(tmp, 'refused')) && (!pattern || pattern.test(r.err)), `${r.code} ${r.err.trim()}`);
};
const ids = model.variants.map(v => v.id);
ok('the picks used below exist', picks().bullets.concat('summary-v1').every(i => ids.includes(i)));

const good = run('scripts/new-resume.mjs', EX, mkPicks('good.json', picks()), out);
const file = path.join(out, 'Northgate Dosing Systems - Mechanical Design Engineer.json');
ok('writes <Company> - <Role>.json', good.code === 0 && fs.existsSync(file), good.err);
ok('the file name is NFC', fs.readdirSync(out).every(f => f === f.normalize('NFC')));
{
  const accent = run('scripts/new-resume.mjs', EX, mkPicks('acc.json', picks({ company: 'Café Nord' })), out);
  ok('a decomposed accent in the name is written composed', accent.code === 0 && fs.readdirSync(out).includes('Café Nord - Mechanical Design Engineer.json'), accent.err);
}
const loaded = S.loadResume(JSON.parse(fs.readFileSync(file, 'utf8')), model);
ok('it is a saved resume the app opens, with no warnings', S.detect(JSON.parse(fs.readFileSync(file, 'utf8'))) === 'resume' && loaded.warnings.length === 0, loaded.warnings.join('; '));
ok('it records the company, role and picks', loaded.recipe.company === 'Northgate Dosing Systems' && loaded.recipe.picks['hydra-inhaler'] === 'hydra-inhaler-v2-1' && loaded.recipe.picks.summary === 'summary-v1');
ok('it has no one-off wording', Object.keys(loaded.recipe.overrides ?? {}).length === 0);
{
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  const texts = new Set(model.variants.map(v => v.text));
  const printed = body.work.flatMap(x => x.highlights);
  ok('exactly the listed bullets print, in the job, and each is a version of the record', printed.length === 5 && printed.every(t => texts.has(t))
    && body.work.length === 1 && printed.includes(model.variants.find(v => v.id === 'hydra-testing-v1-1').text), printed.length);
  ok('the summary is the picked version', body.basics.summary === model.variants.find(v => v.id === 'summary-v1').text);
}
ok('an existing file is not overwritten', run('scripts/new-resume.mjs', EX, mkPicks('good.json', picks()), out).code === 1);
ok('--force replaces it', run('scripts/new-resume.mjs', EX, mkPicks('good.json', picks()), out, '--force').code === 0);
ok('it takes the one file too', run('scripts/new-resume.mjs', oneFile, mkPicks('good.json', picks()), path.join(tmp, 'out1')).code === 0);

refuse('an id that does not exist', mkPicks('a.json', picks({ bullets: ['hydra-inhaler-v99'] })), EX, /not a version in the record/);
refuse('a summary that does not exist', mkPicks('a.json', picks({ summary: 'nope' })));
refuse('a version in another language', mkPicks('a.json', picks({ bullets: ['hydra-inhaler-v1-hu'] })), EX, /is in hu, and this resume is en/);
refuse('a draft', mkPicks('a.json', picks({ bullets: ['hydra-inhaler-draft-1'] })), traps, /draft/);
refuse('an archive version', mkPicks('a.json', picks({ bullets: ['hydra-inhaler-old'] })), traps, /archive/);
refuse('two versions of one claim', mkPicks('a.json', picks({ bullets: ['hydra-inhaler-v1', 'hydra-inhaler-v2'] })), EX, /two versions/);
refuse('a version that is not a bullet', mkPicks('a.json', picks({ bullets: ['hydra-position-v1'] })), EX, /not a bullet/);
refuse('a summary id that belongs to another claim', mkPicks('a.json', picks({ summary: 'hydra-inhaler-v1' })), EX, /not of the summary/);
refuse('a text field', mkPicks('a.json', picks({ text: 'Led everything.' })), EX, /text: not allowed/);
refuse('an overrides field', mkPicks('a.json', picks({ overrides: { 'hydra-inhaler': 'Led everything.' } })), EX, /overrides: not allowed/);
refuse('a headline', mkPicks('a.json', picks({ headline: 'Rockstar' })), EX, /headline: not allowed/);
refuse('an unknown theme or format', mkPicks('a.json', picks({ theme: 'nope' })), EX, /theme/);
refuse('a missing company', mkPicks('a.json', (({ company, ...p }) => p)(picks())), EX, /company: missing/);
// the real archived flag, if the record has it
{
  const r2 = JSON.parse(JSON.stringify(rec));
  r2.meta.resumeBuilder.facts.find(f => f.id === 'hydra-inhaler').archived = true;
  refuse('a claim marked archived', mkPicks('a.json', picks({ bullets: ['hydra-inhaler-v1'] })), w('arch.json', r2), /archived claim/);
}

section('fit, JSON Resume and the keyword gap');
{
  const f = run('scripts/fit.mjs', EX, file, '--fit', '--model', '6.7');
  ok('fit runs on the dry line model, with no browser', f.code === 0 && /MODEL ONLY/.test(f.out), f.err + f.out);
  const fitOut = path.join(tmp, 'fitted.json');
  const f2 = run('scripts/fit.mjs', EX, file, '--fit', '--model', '6.7', '--out', fitOut);
  ok('fit writes a new saved resume, never over the input', f2.code === 0 && S.detect(JSON.parse(fs.readFileSync(fitOut, 'utf8'))) === 'resume');
  const j = run('scripts/to-jsonresume.mjs', EX, file);
  const jr = j.code === 0 ? JSON.parse(j.out) : null;
  ok('to-jsonresume exports it with no problems', !!jr && jr.work[0].highlights.length >= 5, j.err);
  const jo = run('scripts/to-jsonresume.mjs', oneFile, file);
  ok('and from the one file', jo.code === 0 && JSON.parse(jo.out).work[0].highlights.length >= 5, jo.err);
  const flat = path.join(tmp, 'resume.json'); fs.writeFileSync(flat, j.out);
  const g = run('checks/keyword-gap.mjs', EX, AD);
  ok('keyword-gap reports gaps and matches for the ad', g.code === 0 && /gaps \(nothing/.test(g.out) && /\bkanban\b/.test(g.out) && /\bmoulding\b/.test(g.out), g.err);
  ok('"join" and "team" in the ad are no longer gaps', !/×\s+(join|team)\s*$/m.test(g.out));
  ok('keyword-gap takes the one file', run('checks/keyword-gap.mjs', oneFile, AD).code === 0);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
