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
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
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
ok('a version carries id, number, characters, tags and text', Object.keys(first.claims[0].versions[0]).join() === 'id,n,chars,tags,text,default,needsReview,refused');
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
const withChars = v => ({ ...v, marks: [], metrics: { chars: [...v.text].length, measured: {} } });
const mk = (id, n, extra) => withChars({ ...rb.variants.find(v => v.id === 'hydra-inhaler-v1'), id, n, ...extra });
// the archive copy is the shortest, so Fit would take it
rb.variants.push(mk('hydra-inhaler-draft-1', '9', {}), mk('hydra-inhaler-old', '10', { tags: ['Archive'], text: 'Led the redesign.' }),
  mk('hydra-inhaler-shelved', '11', { archived: true, text: 'Redesigned it.' }));
fact.variants.push('hydra-inhaler-draft-1', 'hydra-inhaler-old', 'hydra-inhaler-shelved');
// a version that already says another bullet
const cov = JSON.parse(JSON.stringify(rec)), crb = cov.meta.resumeBuilder;
crb.variants.push(mk('hydra-inhaler-merged', '11', { covers: ['hydra-testing'] }));
crb.facts.find(f => f.id === 'hydra-inhaler').variants.push('hydra-inhaler-merged');
const covFile = w('cov.json', cov);
// an archive summary and a draft job title that the renderer's own rule would reach first
const front = JSON.parse(JSON.stringify(rec)), frb = front.meta.resumeBuilder;
frb.variants.push(withChars({ ...frb.variants.find(v => v.id === 'summary-v1'), id: 'summary-arch', n: '9', tags: ['archive'], text: 'ARCHIVED SUMMARY' }),
  withChars({ ...frb.variants.find(v => v.id === 'hydra-position-v1'), id: 'hydra-position-draft-1', n: '9', text: 'DRAFT TITLE' }));
frb.facts.find(f => f.id === 'summary').variants.unshift('summary-arch');
frb.facts.find(f => f.id === 'hydra-position').variants.unshift('hydra-position-draft-1');
const frontFile = w('front.json', front);
// a record that wants a source, with one version missing it
const sourced = JSON.parse(JSON.stringify(read(EX)));
sourced.meta.resumeBuilder.requireSource = true;
for (const v of sourced.meta.resumeBuilder.variants) v.source = 'Career Facts';
delete sourced.meta.resumeBuilder.variants.find(v => v.id === 'hydra-testing-v1-1').source;
const sourcedFile = w('sourced.json', sourced);
const traps = w('traps.json', rec);
const oneFile = w('one.json', { resumeBuilderBackup: 1, saved: '2026-01-02T03:04:05Z', record: rec, resumes: [] });
{
  const j = JSON.parse(run('scripts/claims.mjs', traps, '--json').out);
  const vs = j.jobs.find(x => x.id === 'hydra').claims.find(c => c.id === 'hydra-inhaler').versions;
  ok('a draft and an archive version are marked, not hidden',
    vs.find(v => v.id === 'hydra-inhaler-draft-1')?.refused === 'draft' && vs.find(v => v.id === 'hydra-inhaler-old')?.refused === 'archive'
    && vs.find(v => v.id === 'hydra-inhaler-shelved')?.refused === 'archive'     // the archived flag is the archive; the old tag is still read
    && vs.filter(v => v.refused).length === 3);
  ok('the text output says why', /hydra-inhaler-draft-1[^\n]*can't pick: draft/.test(run('scripts/claims.mjs', traps).out));
  const o = JSON.parse(run('scripts/claims.mjs', oneFile, '--json').out);
  ok('the one file reads like the record, and says when it was saved', o.saved === '2026-01-02T03:04:05Z' && JSON.stringify(o.jobs) === JSON.stringify(j.jobs));
  const listing = () => fs.readdirSync(tmp).sort().map(f => [f, fs.readFileSync(path.join(tmp, f), 'utf8')]);
  const before = JSON.stringify(listing());
  run('scripts/claims.mjs', traps); run('scripts/claims.mjs', oneFile, '--json');
  ok('claims writes nothing', before === JSON.stringify(listing()));
  const none = JSON.parse(run('scripts/claims.mjs', EX, '--tag', 'no-such-tag', '--json').out);
  ok('--tag filters the summary too', none.summary === null && none.jobs.every(x => x.claims.length === 0));
  ok('the summary is not listed twice, and other sections say they are not picked', !none.sections.some(s => s.id === 'summary') && JSON.parse(run('scripts/claims.mjs', EX, '--json').out).sections.every(s => s.pickable === false));
  const hu = JSON.parse(run('scripts/claims.mjs', EX, '--lang', 'hu', '--json').out);
  ok('a job title with no version in the language falls back, never "undefined"', hu.jobs.every(x => x.position && !/undefined/.test(x.position)));
  ok('the formats, the looks with what each offers, and the export media picks.json may name are listed', cl.out.includes('"formats"') && claims.options.formats.includes('a4') && claims.options.looks.some(l => l.id === 'classic' && l.design.fonts.join() === 'source' && l.design.size.includes('small')) && !('themes' in claims.options) && claims.options.exportMedia.join() === 'screen,print,pen');
  ok('a missing file is one line, not a stack trace', (r => r.code === 1 && !/\n\s+at /.test(r.err))(run('scripts/claims.mjs', path.join(tmp, 'nope.json'))));
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
const refuse = (what, file, data, pattern) => {
  const r = run('scripts/new-resume.mjs', data, file, path.join(tmp, 'refused'));
  ok(`refuses ${what}, and writes nothing`, r.code === 1 && empty(path.join(tmp, 'refused')) && pattern.test(r.err) && !/\n\s+at /.test(r.err), `${r.code} ${r.err.trim().slice(0, 200)}`);
};
const ids = model.variants.map(v => v.id);
ok('the picks used below exist', picks().bullets.concat('summary-v1').every(i => ids.includes(i)));

const good = run('scripts/new-resume.mjs', EX, mkPicks('good.json', picks()), out);
const file = path.join(out, 'Northgate Dosing Systems - Mechanical Design Engineer.json');
ok('writes <Company> - <Role>.json', good.code === 0 && fs.existsSync(file), good.err);
ok('the file name is NFC', fs.readdirSync(out).every(f => f === f.normalize('NFC')));
{
  const accent = run('scripts/new-resume.mjs', EX, mkPicks('acc.json', picks({ company: 'Cafe\u0301 Nord' })), out);
  ok('a decomposed accent in the name is written composed', accent.code === 0 && fs.readdirSync(out).includes('Caf\u00e9 Nord - Mechanical Design Engineer.json'), accent.err);
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

// jobOrder: the print order of the jobs
{
  const two = picks({ bullets: [...picks().bullets, 'poly-jigs-v1'] });
  const d = path.join(tmp, 'jobs');
  const jobsOf = f => JSON.parse(fs.readFileSync(f, 'utf8')).work.map(x => x.name);
  const r0 = run('scripts/new-resume.mjs', EX, mkPicks('two.json', two), d);
  const f0 = path.join(d, fs.readdirSync(d)[0] ?? 'none');
  const r1 = run('scripts/new-resume.mjs', EX, mkPicks('two-order.json', { ...two, jobOrder: ['poly'] }), path.join(tmp, 'jobs1'));
  const f1 = path.join(tmp, 'jobs1', fs.readdirSync(path.join(tmp, 'jobs1'))[0] ?? 'none');
  const saved1 = JSON.parse(fs.readFileSync(f1, 'utf8'));
  const rec1 = S.loadResume(saved1, model);
  ok('jobOrder puts the job first on the page, and the saved resume holds it as the experience order', r0.code === 0 && r1.code === 0
    && jobsOf(f0)[0] !== jobsOf(f1)[0] && jobsOf(f1)[0] === 'Polytechnic Prototyping Lab' && rec1.recipe.sections.find(x => x.id === 'experience').order?.[0] === 'poly' && rec1.warnings.length === 0, r1.err);
  ok('a jobOrder equal to the record\'s order stores nothing', run('scripts/new-resume.mjs', EX, mkPicks('two-same.json', { ...two, jobOrder: ['hydra', 'poly'] }), path.join(tmp, 'jobs2')).code === 0
    && S.loadResume(JSON.parse(fs.readFileSync(path.join(tmp, 'jobs2', fs.readdirSync(path.join(tmp, 'jobs2'))[0]), 'utf8')), model).recipe.sections.find(x => x.id === 'experience').order === undefined);
  refuse('a jobOrder that is not a list', mkPicks('a.json', picks({ jobOrder: 'poly' })), EX, /jobOrder: must be a list/);
  refuse('a jobOrder with an unknown job', mkPicks('a.json', { ...two, jobOrder: ['nope'] }), EX, /jobOrder: nope is not a job/);
  refuse('a jobOrder with a job twice', mkPicks('a.json', { ...two, jobOrder: ['poly', 'poly'] }), EX, /poly is listed twice/);
  refuse('a jobOrder with a job that has no picked bullet', mkPicks('a.json', { ...two, jobOrder: ['free'] }), EX, /free has no picked bullet/);
  refuse('a jobOrder with an archived job', mkPicks('a.json', { ...two, jobOrder: ['poly'] }), (() => { const r = JSON.parse(JSON.stringify(rec)); r.work.find(x => x.id === 'poly').archived = true; return w('archpoly.json', r); })(), /poly can't be placed \(archived job\)/);
}

// the order of bullets is the print order within a job
{
  const hy = ['hydra-inhaler-v2-1', 'hydra-testing-v1-1', 'hydra-dfm-v1'];      // the record's order
  const build = (name, bullets, extra = {}) => {
    const d = path.join(tmp, name);
    const r = run('scripts/new-resume.mjs', EX, mkPicks(name + '.json', picks({ bullets, ...extra })), d);
    const f = path.join(d, fs.readdirSync(d)[0] ?? 'none');
    const saved = r.code === 0 ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    const html = path.join(tmp, name + '.html');
    const rr = r.code === 0 ? run('scripts/render.mjs', EX, f, html) : r;
    return { r, saved, text: rr.code === 0 ? fs.readFileSync(html, 'utf8') : '', refs: saved?.meta.resumeBuilder.resume.sections.find(x => x.id === 'experience').work };
  };
  const at = (t, i) => t.indexOf(model.variants.find(v => v.id === i).text.slice(0, 30));
  const fwd = build('bo-fwd', hy), rev = build('bo-rev', [...hy].reverse());
  ok('bullets in the record\'s order store no highlight order beyond the picked list', fwd.r.code === 0
    && JSON.stringify(fwd.refs[0].highlights) === JSON.stringify(['hydra-inhaler', 'hydra-testing', 'hydra-dfm']), fwd.r.err);
  ok('reversed bullets are reversed in the saved resume\'s highlights, the JSON Resume work and the printed page', rev.r.code === 0
    && JSON.stringify(rev.refs[0].highlights) === JSON.stringify(['hydra-dfm', 'hydra-testing', 'hydra-inhaler'])
    && rev.saved.work[0].highlights[0].startsWith('Ran the weekly DFM') && fwd.saved.work[0].highlights[0].startsWith('Led the dose-counter')
    && at(fwd.text, 'hydra-inhaler-v2-1') >= 0 && at(fwd.text, 'hydra-inhaler-v2-1') < at(fwd.text, 'hydra-dfm-v1')
    && at(rev.text, 'hydra-dfm-v1') >= 0 && at(rev.text, 'hydra-dfm-v1') < at(rev.text, 'hydra-inhaler-v2-1'), rev.r.err);
  const mix = build('bo-mix', ['poly-jigs-v1', 'hydra-dfm-v1', 'poly-shop-v1', 'hydra-inhaler-v2-1'], { jobOrder: ['hydra', 'poly'] });
  const ord = mix.refs?.map(r => [r.id ?? r, r.highlights]);
  ok('two jobs interleaved keep each job\'s own order, and jobOrder decides the jobs', mix.r.code === 0
    && mix.refs.map(r => r.id).join() === 'hydra,poly' && mix.refs[0].highlights.join() === 'hydra-dfm,hydra-inhaler'
    && mix.refs[1].highlights.join() === 'poly-jigs,poly-shop', JSON.stringify(ord) + mix.r.err);
}

// look settings: `look`, `design` and `exportMedium`, written as the Design and Export views write them, and the scripts that apply them
{
  const lk = (name, extra) => { const d = path.join(tmp, name); const r = run('scripts/new-resume.mjs', EX, mkPicks(name + '.json', picks({ theme: undefined, ...extra })), d); const f = path.join(d, fs.existsSync(d) ? (fs.readdirSync(d)[0] ?? 'none') : 'none'); return { r, f, saved: r.code === 0 ? S.loadResume(JSON.parse(fs.readFileSync(f, 'utf8')), model) : null }; };
  const a = lk('look-a', { look: 'classic', design: { size: 'large', density: 'compact', colour: 'green', preset: 'quiet' }, exportMedium: 'print' });
  ok('a look, its settings and an export medium are written as the app writes them (a default is no key)', a.r.code === 0 && a.saved.warnings.length === 0 && a.saved.recipe.overlays.join() === 'classic'
    && JSON.stringify(a.saved.recipe.design) === '{"size":"large","density":"compact","colour":"green"}' && a.saved.recipe.exportMedium === 'print' && a.saved.recipe.theme === 'b2-marker', a.r.err);
  const d = lk('look-d', { look: 'b2', design: { preset: 'quiet', size: 'medium' }, exportMedium: 'screen' });
  ok('the look\'s own defaults and a screen write no overlays, no design and no exportMedium', d.r.code === 0 && d.saved.recipe.overlays.length === 0 && !('design' in d.saved.recipe) && !('exportMedium' in d.saved.recipe), d.r.err);
  ok('an old picks.json with a theme and no look still works', good.code === 0 && loaded.recipe.overlays.length === 0 && loaded.recipe.theme === 'b2-marker');
  const bad = (what, extra, re, p) => refuse(what, mkPicks('a.json', { ...picks({ theme: undefined, ...extra }), ...(p ?? {}) }), EX, re);
  bad('a look that does not exist', { look: 'nope' }, /look: nope is not one of/);
  bad('an earlier look, which only renders', { look: 'mono' }, /look: mono is not one of/);
  bad('a theme and a look together', { look: 'dots', theme: 'dots' }, /theme and look both name the look/);
  bad('a setting the look does not offer', { look: 'classic', design: { fonts: 'plex' } }, /design\.fonts: "plex" is not offered on classic \(it offers source\)/);
  bad('Small on Letter', { format: 'us-letter', design: { size: 'small' } }, /design\.size: "small" is not offered on b2 for Letter/);
  bad('a size Classic full width does not have', { look: 'classic-full', design: { size: 'small' } }, /design\.size: "small" is not offered on classic-full/);
  bad('a setting that is not one', { design: { shade: 'red' } }, /design\.shade: not a setting/);
  bad('a design that is not an object', { design: 'soft' }, /design: must be an object/);
  bad('an export medium that does not exist', { exportMedium: 'sepia' }, /exportMedium: "sepia" is not one of screen, print, pen/);

  // render.mjs applies them, for the recipe's medium or the one asked for
  const html = (m, name = 'look-' + (m ?? 'own')) => { const f = path.join(tmp, name + '.html'); const r = run('scripts/render.mjs', EX, a.f, f, ...(m ? ['--medium', m] : [])); return { r, text: r.code === 0 ? fs.readFileSync(f, 'utf8') : '' }; };
  const own = html(), scr = html('screen'), pen = html('pen');
  ok('render.mjs adds the resume\'s look settings after the stylesheets, for its own medium: the highlighter shade, the paper class', own.r.code === 0 && /<style id="look-css">[^]*--accent:#a3f07a[^]*--type-scale:[\d.]+[^]*<\/style>\s*<\/head>/.test(own.text) && /<html lang="en" class="medium-print">/.test(own.text), own.r.err);
  ok('--medium screen: the screen shade and no paper class', scr.r.code === 0 && /--accent:#7fd1ae/.test(scr.text) && !/--accent:#a3f07a/.test(scr.text) && /<html lang="en">/.test(scr.text));
  ok('--medium pen: transparent highlights and dotted guides, last, and the paper class', pen.r.code === 0 && /--accent:transparent/.test(pen.text) && /dotted/.test(pen.text) && /class="medium-print"/.test(pen.text) && !/--accent:#a3f07a|--accent:#7fd1ae/.test(pen.text));
  const fnt = lk('look-f', { design: { fonts: 'plex' } }), fh = path.join(tmp, 'look-f.html');
  run('scripts/render.mjs', EX, fnt.f, fh);
  ok('the font urls of a pairing the look brings point at the repo from where the page is', /url\("[^"]*\/IBMPlexSans-Bold-latin\.woff2"\)/.test(fs.readFileSync(fh, 'utf8')) && !/url\("\.\.\/fonts/.test(fs.readFileSync(fh, 'utf8').split('look-css')[1] ?? ''));
  ok('a medium that does not exist is refused', run('scripts/render.mjs', EX, a.f, path.join(tmp, 'x.html'), '--medium', 'sepia').code === 2);
  const plain = path.join(tmp, 'plain.html');
  run('scripts/render.mjs', EX, file, plain);
  ok('a resume with no look settings renders with no look block and no class', !/look-css|medium-print/.test(fs.readFileSync(plain, 'utf8')));
  // the measuring passes are on a screen, as the app measures, unless asked
  const ann = path.join(tmp, 'ann.html');
  run('scripts/render.mjs', EX, a.f, ann, '--annotate');
  ok('--annotate measures on a screen, whatever the resume\'s medium', /--accent:#7fd1ae/.test(fs.readFileSync(ann, 'utf8')) && !/medium-print/.test(fs.readFileSync(ann, 'utf8')));
  // export-pdf needs a resume to add the look to; the browser part is checks/export-check.mjs's
  const e = run('scripts/export-pdf.mjs', path.join(tmp, 'x.html'), path.join(tmp, 'x.pdf'), '--medium', 'print');
  ok('export-pdf --medium without --data and --recipe says so', e.code === 1 && /--data and --recipe go together/.test(e.err), e.err);
  // Fit's dry model reads the resume's text size and line spacing
  const line = f => /body line ([\d.]+)px/.exec(run('scripts/fit.mjs', EX, f, '--fit', '--model', '6.7').out)?.[1];
  ok('Fit\'s dry model measures the body line the settings give (Large and Compact), not the look\'s own', line(a.f) && line(file) && line(a.f) !== line(file), `${line(a.f)} vs ${line(file)}`);
}

refuse('an id that does not exist', mkPicks('a.json', picks({ bullets: ['hydra-inhaler-v99'] })), EX, /not a version in the record/);
refuse('a summary that does not exist', mkPicks('a.json', picks({ summary: 'nope' })), EX, /not a version in the record/);
refuse('a version in another language', mkPicks('a.json', picks({ bullets: ['hydra-inhaler-v1-hu'] })), EX, /is in hu, and this resume is en/);
refuse('a draft', mkPicks('a.json', picks({ bullets: ['hydra-inhaler-draft-1'] })), traps, /can't be picked \(draft\)/);
refuse('an archive version', mkPicks('a.json', picks({ bullets: ['hydra-inhaler-old'] })), traps, /can't be picked \(archive\)/);
refuse('two versions of one claim', mkPicks('a.json', picks({ bullets: ['hydra-inhaler-v1', 'hydra-inhaler-v2'] })), EX, /two versions/);
refuse('a version that is not a bullet', mkPicks('a.json', picks({ bullets: ['hydra-position-v1'] })), EX, /not a bullet/);
refuse('a summary id that belongs to another claim', mkPicks('a.json', picks({ summary: 'hydra-inhaler-v1' })), EX, /not of the summary/);
refuse('a text field', mkPicks('a.json', picks({ text: 'Led everything.' })), EX, /text: not allowed/);
refuse('an overrides field', mkPicks('a.json', picks({ overrides: { 'hydra-inhaler': 'Led everything.' } })), EX, /overrides: not allowed/);
refuse('a headline', mkPicks('a.json', picks({ headline: 'Rockstar' })), EX, /headline: not allowed/);
refuse('an unknown theme or format', mkPicks('a.json', picks({ theme: 'nope' })), EX, /theme/);
refuse('a missing company', mkPicks('a.json', (({ company, ...p }) => p)(picks())), EX, /company: missing/);
refuse('markup in the company', mkPicks('a.json', picks({ company: 'X</title><h1 id="inj">Ten years at NASA</h1><title>' })), EX, /company: must be a plain name/);
refuse('a $ in the role', mkPicks('a.json', picks({ role: "Eng $& $'" })), EX, /role: must be a plain name/);
refuse('a line break in the role', mkPicks('a.json', picks({ role: 'Eng\nSenior' })), EX, /role: must be a plain name/);
refuse('markup in the job type', mkPicks('a.json', picks({ jobType: '<b>' })), EX, /jobType: must be a plain name/);
refuse('a very long company', mkPicks('a.json', picks({ company: 'A'.repeat(81) })), EX, /company: must be a plain name/);
refuse('a format that is a path', mkPicks('a.json', picks({ format: '../templates/a4' })), EX, /format: .* is not one of/);
refuse('no bullets', mkPicks('a.json', picks({ bullets: [] })), EX, /bullets: empty/);
refuse('a version with no source, where the record wants one', mkPicks('a.json', picks({ bullets: ['hydra-testing-v1-1'], summary: 'summary-v1' })), sourcedFile, /has no source/);
refuse('a version that says another bullet that is also picked', mkPicks('a.json', picks({ bullets: ['hydra-inhaler-merged', 'hydra-testing-v1-1'] })), covFile, /already says hydra-testing/);
refuse('a missing record file', mkPicks('a.json', picks()), path.join(tmp, 'nope.json'), /not readable|ENOENT/);
// the real archived flag, if the record has it
{
  const r2 = JSON.parse(JSON.stringify(rec));
  r2.meta.resumeBuilder.facts.find(f => f.id === 'hydra-inhaler').archived = true;
  {
  const r3 = JSON.parse(JSON.stringify(rec));
  r3.work.find(x => x.id === 'hydra').archived = true;
  const f3 = w('archjob.json', r3);
  refuse('a bullet of an archived job', mkPicks('a.json', picks({ bullets: ['hydra-inhaler-v1'] })), f3, /archived job: hydra/);
  const c3 = JSON.parse(run('scripts/claims.mjs', f3, '--json').out);
  const h3 = c3.jobs.find(x => x.id === 'hydra');
  ok('claims marks an archived job and its versions', h3.archived === true && h3.claims.every(c => c.versions.every(v => v.refused)));
}
refuse('a claim marked archived', mkPicks('a.json', picks({ bullets: ['hydra-inhaler-v1'] })), w('arch.json', r2), /archived claim/);
}

section('what the agent did not pick');
{
  const d = path.join(tmp, 'auto');
  const r = run('scripts/new-resume.mjs', frontFile, mkPicks('nosummary.json', (({ summary, ...p }) => p)(picks())), d);
  const f = path.join(d, fs.existsSync(d) ? (fs.readdirSync(d)[0] ?? 'none') : 'none');
  const body = r.code === 0 ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  const text = JSON.stringify(body);
  ok('an unpicked summary and job title that the default would take from an archive or draft are replaced by safe versions',
    r.code === 0 && !/ARCHIVED SUMMARY|DRAFT TITLE/.test(text) && body.basics.summary.length > 0, r.err);
  ok('and it says what it chose', /chose, because the default would print a refused version: summary → /.test(r.out) && /hydra-position → /.test(r.out), r.out);
  ok('the saved resume records those picks', r.code === 0 && body.meta.resumeBuilder.resume.picks.summary && body.meta.resumeBuilder.resume.picks['hydra-position']);
}
{
  // Fit never moves a pick to a draft or an archive copy, even when that is the shortest version
  const d = path.join(tmp, 'fitguard');
  const r = run('scripts/new-resume.mjs', traps, mkPicks('fg.json', picks({ bullets: ['hydra-inhaler-v2', 'hydra-testing-v2', 'hydra-suppliers-v2', 'hydra-dfm-v1', 'hydra-tolerance-v1', 'hydra-dhf-v1', 'hydra-human-v2'] })), d);
  ok('the trap record takes a normal pick', r.code === 0, r.err);
  const src = path.join(d, fs.readdirSync(d)[0] ?? 'none');
  let swapped = false, tried = 0;
  for (const lines of ['13', '10', '8', '6.7']){   // the same page, tighter and tighter
    const o = path.join(tmp, `fg-${lines}.json`);
    const f = run('scripts/fit.mjs', traps, src, '--fit', '--model', lines, '--out', o);
    if (f.code !== 0 || !fs.existsSync(o)){ ok(`fit runs on the trap record at ${lines}`, false, (f.err + f.out).slice(0, 200)); continue; }
    if (/\n  swap /.test(f.out)) tried++;
    const picked = Object.values(JSON.parse(fs.readFileSync(o, 'utf8')).meta.resumeBuilder.resume.picks);
    if (picked.some(id => /-draft-|hydra-inhaler-old/.test(id)) || /→ hydra-inhaler-(old|draft)/.test(f.out)) swapped = true;
  }
  ok('Fit swaps something on this page, so the guard below is tested', tried > 0);
  ok('Fit never swaps to a draft or an archive version', !swapped);
  const t = run('scripts/fit.mjs', traps, src, '--trim', '3');
  ok('and trim never suggests one', !/hydra-inhaler-(old|draft)/.test(t.out), t.out.slice(0, 200));
}
{
  // a company that tried to be markup is refused above; a name with &, quotes and $ in a title is only text
  const d = path.join(tmp, 'render');
  const r = run('scripts/new-resume.mjs', EX, mkPicks('amp.json', picks({ company: 'Smith & Sons', role: "Design Engineer (R&D)" })), d);
  const saved = path.join(d, fs.readdirSync(d)[0] ?? 'none');
  const html = path.join(d, 'out.html');
  const rr = run('scripts/render.mjs', EX, saved, html);
  const doc = rr.code === 0 ? fs.readFileSync(html, 'utf8') : '';
  ok('a title with & renders as text', r.code === 0 && /<title>Smith &amp; Sons \u2014 Design Engineer \(R&amp;D\)<\/title>/.test(doc), rr.err + rr.out.slice(0, 100));
  // and the renderer itself is safe if a saved resume carries markup or $ patterns in its title
  const hostile = JSON.parse(fs.readFileSync(saved, 'utf8'));
  hostile.meta.resumeBuilder.resume.title = `x</title><h1 id="inj">NASA</h1><title>$& $'`;
  const hf = w('hostile.json', hostile);
  const hr = run('scripts/render.mjs', EX, hf, path.join(d, 'h.html'));
  const hd = hr.code === 0 ? fs.readFileSync(path.join(d, 'h.html'), 'utf8') : 'FAILED';
  ok('markup or $ patterns in a saved resume title never reach the page as markup', hd !== 'FAILED' && !hd.includes('<h1 id="inj">'), hr.err);
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

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
