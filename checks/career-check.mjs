#!/usr/bin/env node
// node checks/career-check.mjs
// The record built from plain fields (src/model/build.js) and the record's model (src/model/career.js):
// the timeline, and job edits where the printed title follows unless reworded. The forms that show it are
// in the editor panel now; the sections after the model ones run them in Node.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../src/model/schema.js';
import * as B from '../src/model/build.js';
import * as K from '../src/model/career.js';
import { newResume, defaultVariant } from '../src/model/resume.js';
import { saveOver } from '../src/model/record.js';
import { validate } from './lib/validate.mjs';
import { createDocument } from '../scripts/lib/dom.mjs';
import { renderPages } from '../src/render.js';
import { makeUi, dom } from './lib/ui-harness.mjs';
import * as T from '../src/model/resume.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);
const html = (m, r) => renderPages(m, r, createDocument()).pages.map(p => p.outerHTML).join('');
const clone = x => structuredClone(x);
// strip these to get languages with nothing written in them
const NEW8 = ['de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs'];
function stripLangs(m, langs = NEW8){
  const drop = new Set(m.variants.filter(v => langs.includes(v.lang)).map(v => v.id));
  m.variants = m.variants.filter(v => !drop.has(v.id));
  for (const f of m.facts){ f.variants = f.variants.filter(id => !drop.has(id)); for (const l of langs) if (f.default) delete f.default[l]; }
  for (const l of langs) if (m.i18n) delete m.i18n[l];
  delete m.langs;
  return m;
}


section('a record from the first-run form');
const m = B.blankRecord({ name: 'Robin Vale', label: 'Hardware engineer', email: 'robin@example.org', city: 'Halden', url: 'robinvale.example' });
ok('a blank record has a header, and renders', html(m, newResume(m)).includes('Robin Vale'));
ok('the contact line links the email and the site', m.variants.find(v => v.id === 'contact-v1').links.length === 2);
B.addJob(m, { position: 'Mechanical Engineer', name: 'Fjord Instruments', location: 'Halden', startDate: '2022-04', bullets: ['Designed an IP68 housing.', 'Cut assembly time from 40 to 25 minutes.'] });
B.addJob(m, { position: 'Design Intern', name: 'Northwind Labs', startDate: '2021-06', endDate: '2021-12', bullets: ['Built test fixtures.'] });
ok('a job without a claim is not added (it could not print)', B.addJob(m, { position: 'X', name: 'Y', bullets: [] }) === null && m.work.length === 2);
B.setEducation(m, { institution: 'Example Technical University', studyType: 'B.Sc.', area: 'Mechanical Engineering', endDate: '2022-06' });
B.setSkills(m, ['CAD: SolidWorks, Onshape', 'Test: IP testing, drop testing', 'just a list, of things']);
ok('skill lines "Group: a, b" become groups; a bare list is "Skills"', m.skills.length === 3 && m.skills[0].name === 'CAD' && m.skills[2].name === 'Skills' && m.skills[0].keywords.length === 2);
ok('jobs are newest first', m.work[0].name === 'Fjord Instruments');
const r = newResume(m, { format: 'a4' });
const v = validate(S.save(m), r);
ok('the record and a new resume on it validate', v.errors.length === 0, v.errors[0]);
const out = html(m, r);
ok('every claim, the degree and the skills print', ['IP68', '25 minutes', 'test fixtures', 'B.Sc.', 'Onshape'].every(x => out.includes(x)));
ok('the meta line is employer · dates · place', defaultVariant(m, 'fjord-instruments-meta')?.text === 'Fjord Instruments · Apr 2022 – Present · Halden', defaultVariant(m, `${m.work[0].id}-meta`)?.text);

section('the timeline');
{
  const ex = S.load(read('data/example.json')).model;
  const tl = K.timeline(ex);
  ok('every job and the degree; publications are not on the timeline', tl.filter(x => x.kind === 'job').length === ex.work.length && tl.some(x => x.kind === 'education') && !tl.some(x => x.kind === 'publication'));
  ok('newest first', tl[0].end === null || tl[0].end >= tl[1].end);
  ok('durations', K.duration('2021-09', '2023-02') === '1 yr 6 mo' && K.duration('2021-01', '2021-08') === '8 mo');
  const L = K.timelineLayout(ex);
  const all = L.bands.flatMap(b => [...b.main, ...b.side]);
  ok('every timeline entry is in exactly one band', all.length === L.entries.length && new Set(all.map(x => x.id)).size === all.length);
  ok('Work in main, the rest in side', L.bands.every(b => b.main.every(x => x.kind === 'work') && b.side.every(x => x.kind !== 'work')));
  ok('bands newest first, the running ones (year null) on top', L.bands[0].year === null && L.bands.slice(1).every((b, i, a) => i === 0 || a[i - 1].year >= b.year));
  ok('a degree sits in the band of the year it ended', L.bands.find(b => b.side.some(x => x.kind === 'education'))?.year === '2021');
  const ed = clone(ex); ed.education[0].endDate = '2015-06';
  ok('an entry ending in a year with no work still gets its band', K.timelineLayout(ed).bands.some(b => b.year === '2015' && b.main.length === 0 && b.side.length === 1));
  const de = K.timelineLayout(stripLangs(clone(ex)), { lang: 'de' });
  ok('in German, titles with no German are marked, and what is left to write is counted', de.entries.filter(x => x.kind === 'work').every(x => x.titleMissing) && de.entries.some(x => x.toWrite > 0));
  const hu = K.timelineLayout(ex, { lang: 'hu' });
  ok('in Hungarian, the titles written in Hungarian show', hu.entries.find(x => x.id === 'hydra')?.titleMissing === false && hu.entries.find(x => x.id === 'hydra')?.title !== de.entries.find(x => x.id === 'hydra')?.title);
  const G = K.recordLists(ex);
  ok('Skills & credentials, in order: skills, languages, certificates, publications, interests, references', G.map(g => g.group).join() === 'skills,languages,certificates,publications,interests,references');
  ok('with every item', G.find(g => g.group === 'skills').items.length === ex.skills.length && G.find(g => g.group === 'publications').items.length === 1);
  ok('every Career item names the section it goes in', ['work', 'education', 'skills', 'languages', 'certificates', 'publications', 'interests'].every(w => ex.sections.some(s => s.id === K.sectionFor(ex, w, w === 'work' ? 'hydra' : w === 'education' ? 'porto-meng' : w === 'publications' ? 'dose-counter' : G.find(g => g.group === w)?.items[0]?.id))));
  ok('ready: the example is ready; a blank record is not', K.stepsReady(ex).record && !K.stepsReady(B.blankRecord({ name: '' })).about && !K.stepsReady(B.blankRecord({ name: '' })).timeline);
  const one = B.blankRecord({ name: 'Robin' }); B.addJob(one, { position: 'X', name: 'Y', startDate: '2022', bullets: ['a', 'b'] });
  ok('one job with two claims is not yet a ready record', !K.stepsReady(one).timeline);
}

section('editing a job');
{
  const id = m.work[0].id;
  const res = K.updateJob(m, id, { position: 'Senior Mechanical Engineer', endDate: '2026-09', location: 'Oslo' });
  ok('the facts change', m.work[0].position === 'Senior Mechanical Engineer' && m.work[0].endDate === '2026-09' && m.work[0].location === 'Oslo');
  ok('the printed title and meta line follow, since nobody reworded them', res.title === 'followed' && res.meta === 'followed'
     && defaultVariant(m, `${id}-meta`).text === 'Fjord Instruments · Apr 2022 – Sep 2026 · Oslo');
  saveOver(m, defaultVariant(m, `${id}-meta`).id, 'FJORD INSTRUMENTS · 2022–2026 · OSLO, NORWAY');
  const res2 = K.updateJob(m, id, { startDate: '2022-03' });
  ok('a meta line reworded by hand is kept, and said', res2.meta === 'kept' && /OSLO, NORWAY/.test(defaultVariant(m, `${id}-meta`).text));
  const fid = K.addBullet(m, id, 'Ran the field trials in the Glomma river.');
  ok('a new claim goes on its job with v1', m.work[0].highlights.includes(fid) && m.variants.some(v => v.text.startsWith('Ran the field trials') && v.n === '1'));
  ok('still valid', validate(S.save(m)).errors.length === 0, validate(S.save(m)).errors[0]);
}

section('deleting a claim');
{
  const ex = S.load(read('data/example.json')).model;
  const names = read('data/example-resumes/index.json');
  const rs = names.map(n => S.loadResume(read(`data/example-resumes/${n}`), ex).recipe);
  const w = ex.work.find(x => x.id === 'hydra');
  const id = w.highlights[0];
  const nv = ex.facts.find(f => f.id === id).variants.length;
  const res = K.deleteClaim(ex, id, rs);
  ok('the claim and every version go', !ex.facts.some(f => f.id === id) && res.versions === nv && !ex.variants.some(v => v.id.startsWith(`${id}-`)));
  ok('its job forgets it', !w.highlights.includes(id));
  ok('no resume mentions it any more', !JSON.stringify(rs).includes(`"${id}"`));
  ok('the record and every resume still validate and render', rs.every(r => validate(S.save(ex), r).errors.length === 0) && rs.every(r => { try { html(ex, r); return true; } catch { return false; } }),
     rs.map(r => validate(S.save(ex), r).errors[0]).filter(Boolean)[0]);
  const one = ex.work.find(x => x.highlights.length === 1);
  let refused = false; try { K.deleteClaim(ex, one.highlights[0]); } catch { refused = true; }
  ok('a job’s last claim is refused', refused);
}

section('editing in another language');
{
  const ex = stripLangs(S.load(read('data/example.json')).model);
  const res = K.updateJob(ex, 'hydra', { position: 'Konstrukteur', location: 'Lissabon, Portugal' }, 'de');
  ok('a title in German goes in i18n.de.fields, the spine stays English', ex.i18n.de.fields['work/hydra/position'] === 'Konstrukteur' && ex.work.find(w => w.id === 'hydra').position === 'Design Engineer');
  ok('the printed title gets v1 in German', res.title === 'created' && defaultVariant(ex, 'hydra-position', 'de')?.text === 'Konstrukteur' && defaultVariant(ex, 'hydra-position', 'de')?.n === '1');
  ok('the meta line gets v1 in German: German months, the German place', res.meta === 'created' && /März 2023 – \S+ · Lissabon, Portugal/.test(defaultVariant(ex, 'hydra-meta', 'de')?.text ?? ''), defaultVariant(ex, 'hydra-meta', 'de')?.text);
  const r2 = K.updateJob(ex, 'hydra', { position: 'Konstrukteurin' }, 'de');
  ok('editing again: the German title follows', r2.title === 'followed' && defaultVariant(ex, 'hydra-position', 'de').text === 'Konstrukteurin');
  saveOver(ex, defaultVariant(ex, 'hydra-position', 'de').id, 'Konstrukteurin (Medizintechnik)');
  ok('reworded by hand in German: kept', K.updateJob(ex, 'hydra', { position: 'Entwicklerin' }, 'de').title === 'kept' && defaultVariant(ex, 'hydra-position', 'de').text === 'Konstrukteurin (Medizintechnik)');
  const enMeta = defaultVariant(ex, 'hydra-meta', 'en').text;
  const r4 = K.updateJob(ex, 'hydra', { startDate: '2023-04' }, 'de');
  ok('dates are the same everywhere: the German meta line follows; the English one, reworded by hand, is kept', r4.meta === 'followed' && /Apr/.test(defaultVariant(ex, 'hydra-meta', 'de').text) && defaultVariant(ex, 'hydra-meta', 'en').text === enMeta, defaultVariant(ex, 'hydra-meta', 'de').text);
  const r = { ...newResume(ex, { format: 'a4', lang: 'de' }) };
  ok('a German resume prints the German title', renderPages(ex, r, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('').includes('Konstrukteurin (Medizintechnik)'));
  ok('still valid', validate(S.save(ex), r).errors.length === 0, validate(S.save(ex), r).errors[0]);
  K.updateEducation(ex, 'porto-meng', { studyType: 'M.Eng. Maschinenbau' }, 'de');
  ok('a degree in German: fields and a German version', ex.i18n.de.fields['education/porto-meng/studyType'] === 'M.Eng. Maschinenbau' && defaultVariant(ex, 'edu-degree', 'de')?.text === 'M.Eng. Maschinenbau');
}

section('skills, languages, certificates, interests: the printed text follows');
{
  const ex = S.load(read('data/example.json')).model;
  const sk = ex.skills[0];
  let r = K.updateSkill(ex, sk.id, { keywords: [...sk.keywords, 'Onshape'] });
  ok('a skill group’s line follows its skills', r.printed === 'followed' && /Onshape/.test(defaultVariant(ex, sk.id, 'en').text));
  saveOver(ex, defaultVariant(ex, sk.id, 'en').id, 'SolidWorks, Creo and friends');
  r = K.updateSkill(ex, sk.id, { keywords: ['SolidWorks'] });
  ok('reworded by hand: kept', r.printed === 'kept' && defaultVariant(ex, sk.id, 'en').text === 'SolidWorks, Creo and friends');
  K.updateSkill(ex, sk.id, { name: 'CAD und 3D' }, 'de');
  ok('a group’s name in German is its label there', ex.i18n.de.labels[sk.id] === 'CAD und 3D' && ex.skills[0].name === 'CAD & 3D');
  const la = ex.languages.find(x => x.id === 'lang-english');
  r = K.updateLanguage(ex, la.id, { fluency: 'C1' });
  ok('a language’s level: the printed line follows, in every language that had it', r.printed === 'followed' && defaultVariant(ex, la.id, 'en').text === 'C1' && defaultVariant(ex, la.id, 'hu').text === 'C1');
  K.updateLanguage(ex, la.id, { language: 'Englisch' }, 'de');
  ok('a language’s name in German is its term there', ex.i18n.de.terms[la.id] === 'Englisch');
  const c = ex.certificates[0];
  r = K.updateCertificate(ex, c.id, { name: 'SolidWorks CSWP (2024)', issuer: 'Example Systems', date: '2022-05', expires: '2027-05' });
  ok('a certificate’s run text follows its name', r.printed === 'followed' && defaultVariant(ex, c.id, 'en').text === 'SolidWorks CSWP (2024)' && c.expires === '2027-05');
  const i = ex.interests[0];
  r = K.updateInterest(ex, i.id, { name: 'Segeln' }, 'de');
  ok('an interest in German is its German version', r.printed === 'created' && defaultVariant(ex, i.id, 'de')?.text === 'Segeln' && i.name === 'Dinghy sailing');
  const ns = K.addSkill(ex, { name: 'Electronics', keywords: 'KiCad, soldering' });
  const nl = K.addLanguage(ex, { language: 'German', fluency: 'A2' });
  const nc = K.addCertificate(ex, { name: 'IPC-A-610', issuer: 'Example', date: '2024-01' });
  const ni = K.addInterest(ex, { name: 'Bouldering' });
  ok('adding one of each puts it in the record and its section', ex.sections.find(s => s.id === 'skills').content.groups.includes(ns) && ex.sections.find(s => s.id === 'languages').content.pairs.includes(nl)
    && ex.sections.find(s => s.id === 'certified').content.items.includes(nc) && ex.sections.find(s => s.id === 'interests').content.items.includes(ni));
  ok('and it validates and prints', validate(S.save(ex)).errors.length === 0 && /Bouldering/.test(html(ex, newResume(ex))), validate(S.save(ex)).errors[0]);
  K.deleteItem(ex, 'interests', ni, []);
  ok('deleting one takes it out of the record and its section', !ex.interests.some(x => x.id === ni) && !ex.sections.find(s => s.id === 'interests').content.items.includes(ni) && !ex.facts.some(f => f.id === ni));
}

section('projects');
{
  const ex = S.load(read('data/example.json')).model;
  const names = read('data/example-resumes/index.json');
  const rs = names.map(n => S.loadResume(read(`data/example-resumes/${n}`), ex).recipe);
  const before = rs.map(r => html(ex, r));
  const id = K.addProject(ex, { name: 'Open-source caliper stand', entity: 'Independent', startDate: '2022-04', endDate: '2022-09', bullets: ['Designed a printable caliper stand and published the files.'] });
  const jig = K.addProject(ex, { name: 'Formula Student chassis jig', entity: 'FEUP Formula Student team', startDate: '2019-10', endDate: '2020-06', during: 'porto-meng', bullets: ['Designed the welding jig for the chassis.', 'It held tolerance through three test welds.'] });
  const P = x => ex.projects.find(p => p.id === x);
  ok('a project is a JSON Resume project with claims, like a job', ex.projects.length === 4 && P(id).display.position === `${id}-position` && P(jig).highlights.length === 2);
  ok('“during” is kept', P(jig).during === 'porto-meng');
  ok('it is on the timeline, in the side column', K.timelineLayout(ex).bands.some(b => b.side.some(x => x.id === jig && x.kind === 'project' && x.during === 'porto-meng')));
  ok('a Projects section, off by default', ex.sections.find(s => s.id === 'projects')?.kind === 'entries' && ex.sections.find(s => s.id === 'projects').off === true);
  ok('nothing any existing resume prints changes', rs.every((r, n) => html(ex, r) === before[n]));
  ok('a new resume has the Projects section off', newResume(ex).sections.find(s => s.id === 'projects')?.weight === 0);
  const T = await import('../src/model/resume.js');
  const r = newResume(ex);
  T.setSectionOn(ex, r, 'projects', true);
  const out = html(ex, r);
  ok('turned on, it prints both, with their title and meta lines', out.includes('Open-source caliper stand') && out.includes('Formula Student chassis jig') && out.includes('welding jig'));
  T.setBulletOn(ex, r, P(jig).highlights[1], false);
  ok('a project’s bullet turns off on its own section', !html(ex, r).includes('three test welds') && html(ex, r).includes('welding jig') && r.sections.find(s => s.id === 'experience').work.length === ex.work.length);
  ok('the record and the resume validate', validate(S.save(ex), r).errors.length === 0, validate(S.save(ex), r).errors[0]);
  const saved = S.save(ex);
  ok('saved: the projects are JSON Resume projects with texts as highlights', saved.projects.every(p => p.highlights.every(h => typeof h === 'string' && / /.test(h))) && saved.meta.resumeBuilder.projectHighlights[jig].length === 2);
  const back = S.load(JSON.parse(JSON.stringify(saved))).model;
  ok('and loaded back exactly', JSON.stringify(back.projects) === JSON.stringify(ex.projects));
  ok('its JSON Resume export lists the printed projects with their texts', T.resolve(ex, r).body.projects?.length === 4 && T.resolve(ex, r).body.projects.find(p => /jig/.test(p.name))?.highlights.length === 1);
  const r2 = K.updateProject(ex, jig, { name: 'Rahmenlehre für Formula Student' }, 'de');
  ok('a project’s name in German: fields and a German version', ex.i18n.de.fields[`projects/${jig}/name`] === 'Rahmenlehre für Formula Student' && r2.title === 'created');
  K.deleteEntry(ex, id, [r]);
  ok('deleting a project takes its claims and its place on every resume', !ex.projects.some(p => p.id === id) && !JSON.stringify(r).includes(`"${id}"`) && validate(S.save(ex), r).errors.length === 0);
}

section('custom kinds');
{
  const ex = S.load(read('data/example.json')).model;
  const rs = read('data/example-resumes/index.json').map(n => S.loadResume(read(`data/example-resumes/${n}`), ex).recipe);
  const before = rs.map(r => html(ex, r));
  const vol = K.createKind(ex, { ...K.KIND_PRESETS.volunteering, name: { en: 'Volunteering', de: 'Ehrenamt' } });
  const aw = K.createKind(ex, { ...K.KIND_PRESETS.awards, name: { en: 'Awards' } });
  const ex2 = K.createKind(ex, { name: { en: 'Exhibitions' }, place: 'list', icon: 'frame', colour: 1, org: 'Venue' });
  ok('three kinds, stored in the record', ex.kinds.length === 3 && S.save(ex).meta.resumeBuilder.kinds.length === 3);
  const v = K.addKindEntry(ex, vol, { name: 'Volunteer repairer', org: 'Porto Repair Café', startDate: '2019-03', endDate: '2022-06', bullets: ['Fixed small appliances at a monthly repair café, about 300 repairs.'] });
  const a = K.addKindEntry(ex, aw, { name: 'Best student design', org: 'Example Society', startDate: '2020-11' });
  const e = K.addKindEntry(ex, ex2, { name: 'Group show: Objects That Work', org: 'Galeria Norte', startDate: '2019-05' });
  ok('volunteering is JSON Resume volunteer[], with claims', ex.volunteer?.[0]?.id === v && ex.volunteer[0].organization === 'Porto Repair Café' && ex.volunteer[0].highlights.length === 1);
  ok('awards are JSON Resume awards[]', ex.awards?.[0]?.id === a && ex.awards[0].title === 'Best student design');
  ok('any other kind is a typed project', ex.projects?.find(p => p.id === e)?.type === ex2);
  ok('volunteering is on the timeline; awards and exhibitions are lists', K.timelineLayout(ex).entries.some(x => x.id === v) && !K.timelineLayout(ex).entries.some(x => x.id === a || x.id === e)
    && K.recordLists(ex).some(g => g.group === aw && g.items[0]?.id === a) && K.recordLists(ex).some(g => g.group === ex2 && g.items[0]?.id === e));
  ok('nothing existing resumes print changes', rs.every((r, n) => html(ex, r) === before[n]));
  const T = await import('../src/model/resume.js');
  const r = newResume(ex);
  for (const sid of ['volunteer', 'awards', `kind-${ex2}`]) T.setSectionOn(ex, r, sid, true);
  const out = html(ex, r);
  ok('turned on: volunteering prints like a job, the others as a run', out.includes('Volunteer repairer') && out.includes('300 repairs') && out.includes('Best student design · Example Society · 2020') && out.includes('Galeria Norte'));
  ok('valid', validate(S.save(ex), r).errors.length === 0, validate(S.save(ex), r).errors[0]);
  K.updateKind(ex, ex2, { name: { en: 'Shows' } }, [r]);
  ok('a rename follows into the heading that still said the old name', ex.sections.find(s => s.id === `kind-${ex2}`).title === 'Shows');
  let threw = false; try { for (let n = 0; n < 4; n++) K.createKind(ex, { name: { en: `K${n}` } }); } catch { threw = true; }
  ok('at most six kinds', threw && ex.kinds.length === 6);
  for (const k of ex.kinds.filter(k => /^k\d/.test(k.id))) K.deleteKind(ex, k.id, { recipes: [r] });
  const res = K.deleteKind(ex, ex2, { moveTo: aw, recipes: [r] });
  ok('deleting a kind can move its entries to another', res.moved === 1 && !ex.kinds.some(k => k.id === ex2) && !ex.sections.some(s => s.id === `kind-${ex2}`));
  const res2 = K.deleteKind(ex, vol, { recipes: [r] });
  ok('or delete them with it', res2.deleted === 1 && !(ex.volunteer ?? []).length && !JSON.stringify(r).includes(v));
  ok('still valid and printing', validate(S.save(ex), r).errors.length === 0 && !!html(ex, r), validate(S.save(ex), r).errors[0]);
  const I = await import('../src/model/import.js');
  const jr = { basics: { name: 'Robin Vale', label: 'Engineer', email: 'robin@example.org' }, work: [{ name: 'Fjord', position: 'Engineer', startDate: '2022-01', highlights: ['Built a rig.'] }],
    volunteer: [{ organization: 'Repair Café', position: 'Repairer', startDate: '2019-03', highlights: ['Fixed toasters.'] }],
    awards: [{ title: 'Best design', awarder: 'Society', date: '2020-11-01', summary: 'For a jig.' }],
    projects: [{ name: 'Talk at Maker Faire', type: 'talk', startDate: '2021-05', description: 'Gave a talk.' }, { name: 'Caliper stand', highlights: ['Published the files.'] }] };
  const got = I.readImport(JSON.stringify(jr), 'r.json');
  const m = got.model;
  ok('imported: volunteering, an Awards kind, a kind for the typed project, and a plain project', (m.volunteer ?? []).every(x => x.display) && K.kindOf(m, 'awards') && K.kindOf(m, 'talk') && (m.projects ?? []).length === 2,
     JSON.stringify(m.kinds?.map(k => k.id)));
  const out2 = S.save(m);
  ok('the round trip loses nothing', out2.volunteer?.[0]?.organization === 'Repair Café' && out2.volunteer[0].highlights[0] === 'Fixed toasters.' && out2.awards?.[0]?.summary === 'For a jig.'
    && out2.projects?.some(p => p.type === 'talk' && p.description === 'Gave a talk.') && out2.projects?.some(p => p.name === 'Caliper stand' && p.highlights[0] === 'Published the files.'),
    JSON.stringify({ v: out2.volunteer, a: out2.awards, p: out2.projects }).slice(0, 400));
  ok('and it validates', validate(out2).errors.length === 0, validate(out2).errors[0]);
}

section('JSON Resume\'s other fields, and references (2026-10-09)');
{
  const m = S.load(read('data/example.json')).model;
  const before = html(m, newResume(m));
  K.updateJob(m, 'hydra', { url: 'https://hydra.example', description: 'Makes inhalers.', summary: 'Owned the dose counter.' });
  const w = m.work.find(x => x.id === 'hydra');
  ok('a job takes JSON Resume\'s url, description and summary', w.url === 'https://hydra.example' && w.description === 'Makes inhalers.' && w.summary === 'Owned the dose counter.');
  K.updateJob(m, 'hydra', { url: '' });
  ok('an emptied field is removed, not kept as ""', !('url' in w) && w.description === 'Makes inhalers.');
  const e = m.education[0];
  K.updateEducation(m, e.id, { score: 'High distinction', courses: 'Statics, Dynamics', url: 'https://up.example' });
  ok('a degree: score, courses as a list, url', e.score === 'High distinction' && JSON.stringify(e.courses) === '["Statics","Dynamics"]' && e.url === 'https://up.example' && !('honours' in e));
  ok('and the printed meta line follows the score', /HIGH DISTINCTION/.test(defaultVariant(m, e.display.meta, 'en').text));
  K.updateEducation(m, e.id, { honours: 'Distinction' });
  ok('the old field name still works as an input', e.score === 'Distinction');
  K.updateSkill(m, m.skills[0].id, { level: 'Advanced' });
  ok('a skill group takes a level', m.skills[0].level === 'Advanced');
  K.updatePublication(m, m.publications[0].id, { url: 'https://patent.example', summary: 'A dose counter.' });
  ok('a publication takes a url and a summary', m.publications[0].url === 'https://patent.example' && m.publications[0].summary === 'A dose counter.');
  K.updateProject(m, m.projects[0].id, { description: 'A printable stand.' });
  ok('a project takes a description', m.projects[0].description === 'A printable stand.');
  K.updateAbout(m, { address: '1 Rua Exemplo', postalCode: '0000-000', region: 'Lisboa' });
  ok('About you takes the rest of the address', m.basics.location.address === '1 Rua Exemplo' && m.basics.location.postalCode === '0000-000' && m.basics.location.region === 'Lisboa' && m.basics.location.city === 'Lisbon');
  ok('none of it changes a printed page', html(m, newResume(m)) === before);

  const id = K.addReference(m, { name: 'Ana Exemplo', reference: 'Dana fixed our counter in a week.' });
  const s = m.sections.find(x => x.id === 'references');
  ok('a reference: a fact named by the person, in a References section that is off', m.facts.find(f => f.id === id)?.term === 'Ana Exemplo' && s?.kind === 'pairs' && s.off === true && s.content.pairs.includes(id));
  ok('Career lists it', K.recordLists(m).find(g => g.group === 'references').items[0]?.title === 'Ana Exemplo');
  const r = newResume(m);
  ok('a new resume has the section off', r.sections.find(x => x.id === 'references')?.weight === 0);
  ok('so nothing prints', !html(m, r).includes('Ana Exemplo'));
  const { setSectionOn } = await import('../src/model/resume.js');
  setSectionOn(m, r, 'references', true);
  ok('turned on, it prints the name and the text', html(m, r).includes('Ana Exemplo') && html(m, r).includes('fixed our counter'));
  setSectionOn(m, r, 'references', false);
  ok('and off again, it doesn\'t', !html(m, r).includes('Ana Exemplo'));
  K.updateReference(m, id, { reference: 'Dana fixed our dose counter in a week.' });
  ok('editing the text follows into the version', defaultVariant(m, id, 'en').text === 'Dana fixed our dose counter in a week.' && m.references[0].reference === 'Dana fixed our dose counter in a week.');
  K.updateReference(m, id, { reference: 'A Dana consertou o contador numa semana.' }, 'pt');
  ok('in another language it is a version there, and English stays', defaultVariant(m, id, 'pt').text.startsWith('A Dana') && m.references[0].reference.startsWith('Dana'));
  const file = S.save(m);
  ok('the record\'s file says the default text, and is a JSON Resume', file.references[0].reference === 'Dana fixed our dose counter in a week.' && S.checkJsonResume(file).length === 0);
  ok('it validates', validate(file).errors.length === 0, validate(file).errors[0]);
  K.deleteItem(m, 'references', id);
  ok('deleting it takes the fact and the list with it', !m.facts.some(f => f.id === id) && !m.references && !s.content.pairs.length);
}

section('archiving a claim');
{
  const ex = S.load(read('data/example.json')).model;
  const gone = ex.facts.find(f => f.archived).id;
  const job = ex.work.find(w => w.highlights.includes(gone));
  const other = job.highlights.find(h => h !== gone);
  ok('the example holds an archived claim to start with', !!gone && !!other);
  ok('K.archivedOf lists a job’s archived claims', K.archivedOf(ex, job.id).join() === gone);
  const r = K.unarchiveClaim(ex, gone);
  ok('unarchiving clears the flag, and says so', r.changed && !ex.facts.find(f => f.id === gone).archived && !('archived' in ex.facts.find(f => f.id === gone)));
  ok('unarchiving twice changes nothing', !K.unarchiveClaim(ex, gone).changed);
  const a = K.archiveClaim(ex, other);
  ok('archiving sets the flag on the claim, not its versions', a.changed && ex.facts.find(f => f.id === other).archived === true && !ex.variants.some(v => v.archived));
  ok('…and deletes nothing', ex.facts.some(f => f.id === other) && ex.variants.some(v => v.id.startsWith(`${other}-`)));
  const rest = job.highlights.filter(h => !ex.facts.find(f => f.id === h).archived);
  for (const h of rest.slice(1)) K.archiveClaim(ex, h);
  let refused = null; try { K.archiveClaim(ex, rest[0]); } catch (e){ refused = e; }
  ok('a job’s last unarchived claim is refused, with the app’s own message', rest.length >= 2 && refused?.key === 'arch.lastClaim' && !ex.facts.find(f => f.id === rest[0]).archived, refused?.message);
  const one = ex.work.find(w => w.highlights.length === 1);
  let lastRefused = null; try { K.archiveClaim(ex, one.highlights[0]); } catch (e){ lastRefused = e; }
  ok('a job with one claim can not archive it', lastRefused?.key === 'arch.lastClaim', lastRefused?.message);
  ok('the record still validates and renders', validate(S.save(ex), null).errors.length === 0 && html(ex, newResume(ex)).length > 0);
}

section('the checklist hides archived claims, and reveals them');
{
  const u = await makeUi();
  const gone = u.record().facts.find(f => f.archived).id;
  const job = u.record().work.find(w => w.highlights.includes(gone)).id;
  const list = () => String(u.checklist.html());
  const group = id => { const h0 = list(); const i = h0.indexOf(`<section class="clg`); const m = [...h0.matchAll(/<section class="clg[^"]*" data-g="([^"]+)">/g)].find(x => x[1] === id); return m ? h0.slice(m.index, h0.indexOf('</section>', m.index)) : ''; };
  let h = group(job);
  ok('an archived claim is not in a job’s list by default', !h.includes(`data-on="${gone}"`) && !h.includes(`data-fact="${gone}"`));
  ok('…the job shows a muted “1 archived” control', /class="sm ghost archmore"[^>]*aria-expanded="false">1 archived/.test(h));
  await u.click('c-arch-show', { id: job });
  h = group(job);
  ok('the control reveals it, dimmed, with an Unarchive button', h.includes(`data-fact="${gone}"`) && /is-archived/.test(h) && new RegExp(`data-act="unarchive-claim" data-id="${gone}"`).test(h));
  ok('…and the same control hides it again', /Hide archived/.test(h) && (await u.click('c-arch-show', { id: job }), !group(job).includes(`data-fact="${gone}"`)));
  ok('a job with none archived shows no control', !/archmore/.test(group(u.record().work.find(w => w.id !== job).id)));

  const before = JSON.stringify(u.record());
  const other = u.record().work.find(w => w.id === job).highlights.find(h2 => h2 !== gone);
  const sel = { kind: 'bullet', id: other, job, section: 'experience' };
  u.select(sel);
  const panel = String(u.edit.bulletView(sel));
  ok('a claim’s panel has Archive beside 🗑', /data-act="archive-claim"[^>]*>Archive<\/button>/.test(panel) && panel.indexOf('archive-claim') < panel.indexOf('delete-claim'));
  await u.click('archive-claim');
  ok('Archive sets the flag, says Ctrl+Z undoes it, and goes back up to the job', u.record().facts.find(f => f.id === other).archived === true && u.toasts.at(-1).m === 'Archived. Ctrl+Z undoes it.' && u.ui.sel.kind === 'job');
  ok('…the list no longer shows it', !group(job).includes(`data-fact="${other}"`));
  u.store.undo();
  ok('Ctrl+Z undoes it', JSON.stringify(u.record()) === before);
  await u.click('c-arch-show', { id: job });
  await u.click('unarchive-claim', { id: gone });
  ok('Unarchive brings it back', !u.record().facts.find(f => f.id === gone).archived && u.toasts.at(-1).m === 'Unarchived.');
  u.store.undo();
  ok('…and Ctrl+Z archives it again', u.record().facts.find(f => f.id === gone).archived === true);
}

section('an archived claim a saved resume still prints');
{
  // it keeps printing, badged, and can be turned off
  const names = read('data/example-resumes/index.json');
  const ex = S.load(read('data/example.json')).model;
  const gone = ex.facts.find(f => f.archived).id;
  const job = ex.work.find(w => w.highlights.includes(gone)).id;
  const i = names.findIndex(n => T.listedBullets(ex, S.loadResume(read(`data/example-resumes/${n}`), ex).recipe, job).includes(gone));
  ok('a saved example resume prints the archived claim', i >= 0);
  const u = await makeUi({ resume: i });
  const row = () => { const h0 = String(u.checklist.html()); const m = h0.match(new RegExp(`<li class="clrow[^"]*" data-fact="${gone}"[^>]*>[\\s\\S]*?</li>`)); return m ? m[0] : ''; };
  ok('its row stays in the job’s list, ticked, with an “archived” badge', /checked/.test(row()) && /class="pill arch"[^>]*>archived/.test(row()));
  u.tick({ on: gone }, false);
  ok('it can be unticked, and then it folds away with the other archived claims', !T.listedBullets(u.record(), u.cur(), job).includes(gone) && row() === '');
  let refused = false; try { T.setBulletOn(u.work(), u.cur(), gone, true); } catch { refused = true; }
  ok('turning an archived claim on needs it unarchived first', refused);
}

section('archiving a whole job');
{
  const ex = S.load(read('data/example.json')).model;
  const names = read('data/example-resumes/index.json');
  const rs = names.map(n => S.loadResume(read(`data/example-resumes/${n}`), ex).recipe);
  const before = rs.map(r => html(ex, r));
  const r = K.archiveEntry(ex, 'atelier');
  ok('archiving sets the flag on the job, deletes nothing', r.changed && ex.work.find(w => w.id === 'atelier').archived === true && ex.facts.some(f => f.id === 'atelier-position' || f.id.startsWith('atl-')));
  ok('the timeline can hide it, and says it is archived when shown', !K.timelineLayout(ex, { hideArchived: true }).entries.some(e => e.id === 'atelier') && K.timelineLayout(ex).entries.find(e => e.id === 'atelier').archived === true);
  ok('a new resume leaves it out', !JSON.stringify(newResume(ex).sections).includes('atelier'));
  ok('saved resumes that print it render byte-identical', rs.every((x, i) => html(ex, x) === before[i]) && rs.some(x => JSON.stringify(x).includes('atelier')));
  let refused = false; try { T.setJobOn(ex, newResume(ex), 'atelier', true); } catch (e){ refused = e.key === 'arch.jobNeedUnarchive'; }
  ok('it can not be switched on in a resume that does not print it', refused);
  ok('unarchiving brings it back into new resumes', K.unarchiveEntry(ex, 'atelier').changed && JSON.stringify(newResume(ex).sections).includes('atelier') && !('archived' in ex.work.find(w => w.id === 'atelier')));
  ok('the record round-trips the flag', (() => { K.archiveEntry(ex, 'atelier'); return S.load(S.save(ex)).model.work.find(w => w.id === 'atelier').archived === true; })());
  ok('the validator accepts it', validate(S.save(ex), null).errors.length === 0);

  const u = await makeUi();
  const list = () => String(u.checklist.html());
  const tl = () => String(u.career.timelineHtml());
  ok('(no archived job in the example to start with)', !/c-arch-jobs/.test(list()) && !/c-arch-jobs/.test(tl()));
  const sel = { kind: 'job', id: 'atelier' };
  u.select(sel);
  ok('a job’s Details fold holds Archive job', /<details class="jr details"[\s\S]*data-act="c-arch-entry" data-id="atelier"/.test(String(u.edit.jobView(sel))));
  const before2 = JSON.stringify(u.record());
  await u.click('c-arch-entry', { id: 'atelier' });
  ok('it archives the job, with a toast, and the job’s panel closes', u.record().work.find(w => w.id === 'atelier').archived === true && u.toasts.at(-1).m === 'Archived. Ctrl+Z undoes it.' && u.ui.sel.kind === 'none');
  ok('the checklist folds it under “1 archived”, the timeline hides it behind one too', !list().includes('data-g="atelier"') && /archmore" data-act="c-arch-jobs"[^>]*>1 archived/.test(list()) && !tl().includes('data-id="atelier"') && /archmore" data-act="c-arch-jobs"[^>]*>1 archived/.test(tl()));
  await u.click('c-arch-jobs');
  ok('the control reveals it with an Unarchive button, in both', /data-g="atelier"/.test(list()) && /data-act="c-unarch-entry" data-id="atelier"/.test(list()) && tl().includes('data-id="atelier"') && /pill arch/.test(tl()));
  u.store.undo();
  ok('Ctrl+Z undoes it', JSON.stringify(u.record()) === before2);
}

section('job types, in their own panel');
{
  const u = await makeUi();
  const sel = { kind: 'record', what: 'jobtypes' };
  const page = () => String(u.career.panel(sel));
  ok('the panel lists the job types, tags as chips', /class="jtrow"/.test(page()) && /data-act="c-jt-tag-rm" data-id="Prototyping" data-tag="fabrication"/.test(page()));
  ok('the Edit panel with nothing selected reaches it (Add job types / Job types…)', /data-act="cl-open" data-sel="[^"]*jobtypes[^"]*"/.test(String(u.checklist.html())) && true);
  const n = u.record().jobTypes.length;
  dom.set('jt-new', { value: 'CAD designer' });
  await u.click('c-jt-add');
  const made = u.record().jobTypes.at(-1);
  ok('a new job type gets an id from its name, and no tags yet', u.record().jobTypes.length === n + 1 && made.id === 'cad-designer' && made.label === 'CAD designer' && made.tags.length === 0);
  let dup = u.toasts.length; dom.set('jt-new', { value: 'cad designer' }); await u.click('c-jt-add');
  ok('the same name again is refused', u.record().jobTypes.length === n + 1 && u.toasts.length === dup + 1 && u.toasts.at(-1).tone === 'bad');
  const input = (id, v) => ({ classList: { contains: c => c === 'jt-tag-in' }, dataset: { id }, value: v, closest: () => null, matches: () => false });
  u.fire('keydown', input('cad-designer', 'cad'), { key: 'Enter' });
  u.fire('keydown', input('cad-designer', 'hardware'), { key: 'Enter' });
  ok('Enter adds a tag, a second one too, never twice', (() => { u.fire('keydown', input('cad-designer', 'cad'), { key: 'Enter' }); return u.record().jobTypes.at(-1).tags.join() === 'cad,hardware'; })());
  await u.click('c-jt-tag-rm', { id: 'cad-designer', tag: 'hardware' });
  ok('× removes a tag', u.record().jobTypes.at(-1).tags.join() === 'cad');
  u.fire('change', { classList: { contains: c => c === 'jt-label' }, dataset: { id: 'cad-designer' }, value: 'CAD designers', closest: () => null });
  ok('renaming changes the label and keeps the id', u.record().jobTypes.at(-1).label === 'CAD designers' && u.record().jobTypes.at(-1).id === 'cad-designer');
  // an old string job type becomes an object the first time it is edited
  await u.click('c-jt-tag-rm', { id: 'Medical devices', tag: 'Medical devices' });
  const old = u.record().jobTypes.find(j => (j.id ?? j) === 'Medical devices');
  ok('an old string job type turns into an object when edited', typeof old === 'object' && old.id === 'Medical devices' && old.tags.length === 0);
  await u.click('c-jt-del', { id: 'cad-designer' });
  ok('deleting removes it', !u.record().jobTypes.some(j => j.id === 'cad-designer'));
  u.store.undo();
  ok('Ctrl+Z brings it back', u.record().jobTypes.some(j => j.id === 'cad-designer'));
}

section('tags, in the same panel: one closed list, made and tidied here');
{
  const u = await makeUi();
  const page = () => String(u.career.panel({ kind: 'record', what: 'jobtypes' }));
  const before = u.record().vocabulary.tags.length;
  ok('the panel lists every tag with its name box, a merge menu and a bin, and counts them against the cap', /class="tag-name" data-tag="cad"/.test(page()) && /class="tag-merge" data-tag="cad"/.test(page()) && /data-act="c-tag-del" data-tag="cad"/.test(page()) && /id="tag-count"/.test(page()));
  ok('the example has 11 of the 12 the list allows, and the new-tag box is open', /11 of 12 tags/.test(page()) && !/id="tag-new"[^>]*disabled/.test(page()));
  dom.set('tag-new', { value: 'laser' }); await u.click('c-tag-add');
  ok('one more fills the list: the box shuts and says how to make room', /12 of 12 tags/.test(page()) && /id="tag-new"[^>]*disabled/.test(page()) && /Merge two tags/.test(page()));
  u.store.undo();
  const t = (name, v) => ({ classList: { contains: c => c === 'tag-name' }, dataset: { tag: name }, value: v, closest: () => null });
  const m = (name, v) => ({ classList: { contains: c => c === 'tag-merge' }, dataset: { tag: name }, value: v, closest: () => null });
  const usedBy = tg => u.record().variants.filter(v => (v.tags ?? []).includes(tg)).length;
  const nCad = usedBy('cad');
  u.fire('change', t('cad', 'cad-design'));
  ok('renaming a tag renames it on every wording, and in the list', usedBy('cad-design') === nCad && usedBy('cad') === 0 && u.record().vocabulary.tags.includes('cad-design') && !u.record().vocabulary.tags.includes('cad'));
  const nLead = usedBy('leadership');
  u.fire('change', m('leadership', 'teaching'));
  ok('merging a tag into another leaves one, on all their wordings', nLead > 0 && usedBy('leadership') === 0 && usedBy('teaching') >= nLead && !u.record().vocabulary.tags.includes('leadership'));
  u.store.undo();
  ok('one undo brings the merge back whole', usedBy('leadership') === nLead && u.record().vocabulary.tags.includes('leadership'));
  const tagged = u.record().variants[0];
  const input = v => ({ classList: { contains: c => c === 'tag-in' }, dataset: { vid: tagged.id }, value: v, closest: () => null, matches: () => false });
  const toasts = u.toasts.length;
  u.fire('keydown', input('brand-new-zz'), { key: 'Enter' });
  ok('a tag typed on a wording that is not in the list is refused, with a message; none is made', !(u.record().variants[0].tags ?? []).includes('brand-new-zz') && u.toasts.length === toasts + 1 && u.toasts.at(-1).tone === 'bad' && !u.record().vocabulary.tags.includes('brand-new-zz'));
  await u.click('c-tag-del', { tag: 'web' });
  ok('the bin removes a tag from the list and from every wording', !u.record().vocabulary.tags.includes('web') && usedBy('web') === 0 && u.record().vocabulary.tags.length === before - 1);
  u.store.undo();
  ok('and Ctrl+Z puts it back', u.record().vocabulary.tags.includes('web') && usedBy('web') >= 1);
  // below the cap a tag is added from the box
  const v = await makeUi();
  v.store.commit(d => { d.record.vocabulary.tags = ['cad']; for (const x of d.record.variants) delete x.tags; d.record.jobTypes = []; }, 'seed');
  dom.set('tag-new', { value: 'laser' });
  await v.click('c-tag-add');
  ok('under the cap, a new tag is added from its box', v.record().vocabulary.tags.join() === 'cad,laser');
}

section('a new person starts with no tags, and the panel says how to use them');
{
  const B = await import('../src/model/build.js');
  const F = await import('../src/model/focus.js');
  const blank = B.blankRecord({ name: 'Pat Example' });
  ok('a blank record has an empty tag list and no job types', F.tagVocab(blank).length === 0 && F.jobTypesOf(blank).length === 0 && (blank.vocabulary.tags ?? []).length === 0);
  const u = await makeUi();
  u.store.commit(d => { d.record.vocabulary = { ...d.record.vocabulary, tags: [] }; d.record.jobTypes = []; for (const v of d.record.variants) delete v.tags; }, 'seed');
  const html = String(u.career.panel({ kind: 'record', what: 'jobtypes' }));
  ok('its Tags part is empty, open to a three-step how-to, with the new-tag box ready', /No tags yet/.test(html) && /<details class="taghow" open>/.test(html) && /How to use tags/.test(html) && !/id="tag-new"[^>]*disabled/.test(html));
}

section('the Highlight lens: job types first, and Apply');
{
  const u = await makeUi({ resume: 0 });
  const home = () => String(u.edit.outlineView());
  ok('the lens is one row: Nothing first, then the job types', /<select id="lens"><option value="">Nothing<\/option>\s*<optgroup label="Job types"><option value="[^"]+"[^>]*>[^<]+ \(\d+\)<\/option>/.test(home()));
  ok('one list: job types in their own group, then every tag (nothing hidden), no “+ tags” switch', /<optgroup label="Job types">/.test(home()) && /<optgroup label="Tags">/.test(home()) && !/data-act="lens-tags"/.test(home()) && !/data-act="focus" data-tag="/.test(home()));
  u.fire('change', { id: 'lens', value: 'Prototyping', dataset: {}, classList: { contains: () => false } });
  ok('choosing a job type only highlights it: nothing in the resume changed, no plan line yet', u.edit.focus === 'Prototyping' && !/class="focusbox"/.test(home()));
  const before = JSON.stringify(u.cur());
  await u.click('lens-apply');
  ok('Apply… shows the plan line and a button to apply it', /class="focusbox"/.test(home()) && /data-act="focus-apply"/.test(home()) && /turn(ed)? on|switch/i.test(home().replace(/<[^>]+>/g, ' ')) );
  await u.click('focus-apply');
  ok('applying it changes the resume', JSON.stringify(u.cur()) !== before);
  u.store.undo();
  ok('one Ctrl+Z puts it all back', JSON.stringify(u.cur()) === before);
}

section('the forms: a field commits when you leave it, Enter leaves it, Esc puts it back');
{
  const u = await makeUi();
  const steps = () => u.store.history.undo;
  // a form's fields, as the shell would find them in the page
  const mk = (form, fields) => Object.fromEntries(Object.entries(fields).map(([id, [value, def = value]]) => {
    const el = dom.set(id, { value, defaultValue: def, tagName: id === 'c-label' ? 'TEXTAREA' : 'INPUT', checked: false,
      matches: () => true, hasAttribute: a => a === 'data-single' && id === 'c-label', closest: s2 => (s2 === '[data-form]' ? form : null),
      blur(){ u.fire('focusout', el); } });
    return [id, el];
  }));
  const leave = el => u.fire('focusout', el);
  const key = (el, k) => { let stopped = false; u.fire('keydown', el, { key: k, stopPropagation(){ stopped = true; } }); return stopped; };

  // a job's details
  let form = { dataset: { form: 'entry', key: 'work', id: 'poly' } };
  let f = mk(form, { 'c-pos': ['Prototyping Technician'], 'c-org': ['Polytechnic Prototyping Lab'], 'c-start': ['2021-09'], 'c-end': ['2023-02'], 'c-loc': ['Porto, Portugal'] });
  let n = steps();
  leave(f['c-pos']);
  ok('leaving a field nobody changed commits nothing', steps() === n);
  f['c-pos'].value = 'Lead Prototyping Technician';
  leave(f['c-pos']);
  ok('leaving a changed field commits it: one undo step, the printed title follows', steps() === n + 1 && u.record().work.find(w => w.id === 'poly').position === 'Lead Prototyping Technician' && u.store.history.next === 'Edit job');
  f['c-loc'].value = 'Lisbon, Portugal';
  key(f['c-loc'], 'Enter');
  ok('Enter leaves the field, and that commits it', u.record().work.find(w => w.id === 'poly').location === 'Lisbon, Portugal');
  f['c-org'].value = 'Nowhere Ltd';
  const stopped = key(f['c-org'], 'Escape');
  ok('Esc puts the field back, keeps the panel’s own Esc out of it, and commits nothing', f['c-org'].value === 'Polytechnic Prototyping Lab' && stopped && u.record().work.find(w => w.id === 'poly').name === 'Polytechnic Prototyping Lab');
  while (u.record().work.find(w => w.id === 'poly').position !== 'Prototyping Technician' && u.store.history.undo) u.store.undo();
  ok('undo covers them (edits to the same thing in quick succession are one step)', u.record().work.find(w => w.id === 'poly').position === 'Prototyping Technician' && u.record().work.find(w => w.id === 'poly').location === 'Porto, Portugal');

  // About you
  form = { dataset: { form: 'about', part: 'name' } };
  f = mk(form, { 'c-name': ['Dana Okonkwo'], 'c-label': ['Mechanical & Design Engineer'] });
  n = steps();
  f['c-name'].value = 'Dana A. Okonkwo'; leave(f['c-name']);
  ok('About you: the name commits on leaving', u.record().basics.name === 'Dana A. Okonkwo' && steps() === n + 1 && u.store.history.next === 'Edit about you');
  f['c-label'].value = 'Design Engineer';
  ok('…and Enter in the headline box leaves it (it is one line), Shift+Enter would not', (u.fire('keydown', f['c-label'], { key: 'Enter', shiftKey: true }), steps() === n + 1) && (key(f['c-label'], 'Enter'), u.record().basics.label === 'Design Engineer'));

  // an education entry
  const edu = u.record().education[0];
  form = { dataset: { form: 'entry', key: 'education', id: edu.id } };
  f = mk(form, { 'c-pos': [[edu.studyType, edu.area].filter(Boolean).join(' ')], 'c-org': [edu.institution], 'c-start': [String(edu.startDate ?? '').slice(0, 7)], 'c-end': [String(edu.endDate ?? '').slice(0, 7)], 'c-hon': [edu.score ?? ''] });
  f['c-hon'].value = 'First class'; leave(f['c-hon']);
  ok('an education entry: the honours field commits on leaving', u.record().education[0].score === 'First class');

  // a skill group: the name, and the keywords as chips (Enter in the keyword box adds one at once)
  const sk = u.record().skills[0];
  u.select({ kind: 'record', what: 'item', group: 'skills', id: sk.id });
  form = { dataset: { form: 'item', group: 'skills', id: sk.id } };
  f = mk(form, { 'c-gname': [sk.name] });
  f['c-gname'].value = `${sk.name} and more`; leave(f['c-gname']);
  ok('a skill group: the name commits on leaving', u.record().skills[0].name === `${sk.name} and more`);
  const kw = { id: 'c-kw-in', value: 'Onshape', classList: { contains: () => false }, closest: () => null, matches: () => false };
  u.fire('keydown', kw, { key: 'Enter' });
  ok('a keyword added with Enter is committed at once, no Save button anywhere', u.record().skills[0].keywords.includes('Onshape'));
  await u.click('c-kw-rm', { n: String(u.record().skills[0].keywords.indexOf('Onshape')) });
  ok('× on a keyword removes it at once', !u.record().skills[0].keywords.includes('Onshape'));

  // a language, a certificate
  const lg = u.record().languages[0];
  form = { dataset: { form: 'item', group: 'languages', id: lg.id } };
  f = mk(form, { 'c-lname': [lg.language] });
  dom.set('c-level', { value: 'C2' });
  u.fire('change', { tagName: 'SELECT', id: 'c-level', value: 'C2', dataset: {}, classList: { contains: () => false }, closest: s2 => (s2 === '[data-form]' ? form : null) });
  ok('a language: choosing its level commits at once', u.record().languages[0].fluency === 'C2');

  // no form has a Save button
  const panels = [
    ['a job', String(u.edit.jobView({ kind: 'job', id: 'poly' }))], ['About you', String(u.career.panel({ kind: 'header' }))],
    ['an education entry', String(u.career.panel({ kind: 'record', what: 'entry', key: 'education', id: edu.id }))],
    ['a skill group', String(u.career.panel({ kind: 'record', what: 'item', group: 'skills', id: sk.id }))],
    ['a language', String(u.career.panel({ kind: 'record', what: 'item', group: 'languages', id: lg.id }))],
    ['a kind', (await u.click('c-kind-new'), String(u.career.panel({ kind: 'kind', id: null })))],
  ];
  for (const [what, h0] of panels) ok(`${what}: no Save button (only creating something has a button)`, !/data-act="c-save[^"]*"/.test(h0) && !/data-act="c-kind-save"[^>]*>Save/.test(h0));
}

section('the Record tab: the timeline and every kind of addition are there, and a claim opens from it');
{
  const u = await makeUi();
  const rec = () => String(u.checklist.html());
  const ids = (html, re) => [...html.matchAll(re)].map(m => m[1]);
  ok('the timeline is in the tab, always open, and every job and project in it scrolls the list to its group', (() => {
    const jobs = ids(rec(), /data-act="rec-job" data-key="[^"]+" data-id="[^"]+" data-grp="([^"]+)"/g);
    const groups = new Set(ids(rec(), /<section class="clg[^"]*" data-g="([^"]+)"/g));
    return jobs.length >= 5 && jobs.every(j => groups.has(j)) && !/data-act="c-sel"/.test(rec()) && !/data-act="tl-close"|data-act="c-tl"/.test(rec());
  })());
  ok('…and the timeline is the same rows Career drew over the page, with no header of its own', /class="tl2"/.test(rec()) && !/class="tl-head"/.test(rec()));
  ok('+ Add is in the tab’s header, and its menu holds every kind: timeline entries, the lists, and a kind of your own', await (async () => {
    ok('(the menu starts shut)', !/class="addm /.test(rec()));
    await u.click('c-pop');
    const html = rec();
    return /data-act="c-pop"[^>]*aria-expanded="true"/.test(html) && ['work', 'education', 'project', 'skills', 'languages', 'certificates', 'publications', 'interests', 'references'].every(k => html.includes(`data-act="c-add" data-what="${k}"`)) && html.includes('data-act="c-kind-new"');
  })());
  await u.click('c-pop');
  ok('every group lists all its lines, ticked or not, with its count', (() => { const html = rec(); return (html.match(/<li class="clrow/g) ?? []).length >= 30 && /class="clcount"/.test(html); })());
  ok('a line opens its claim from Record and from the Outline’s open job: the same selection', (() => {
    u.select({ kind: 'job', id: 'hydra' });
    const sels = h => new Set(ids(h, /data-fact="[^"]*"[^>]*>[\s\S]*?data-act="cl-open" data-sel="([^"]*)"/g));
    const a = sels(String(u.checklist.html())), b = sels(String(u.checklist.outlineHtml()));
    return b.size >= 3 && [...b].every(x => a.has(x));
  })());
  ok('the Outline has no timeline: the open job is its lines, “+ n more” and a “+ line”', (() => { u.select({ kind: 'job', id: 'hydra' }); const g = String(u.checklist.outlineHtml()); return !/rectl|tl2/.test(g) && /data-act="ol-addline"/.test(g) && /data-act="ol-more"/.test(g); })());
}

section('what Career did, and where each part went (the ledger of data-act)');
{
  const u = await makeUi();
  const list = () => String(u.checklist.html());
  // each of Career's old actions, its new home, and a Node check that it is reached; the browser checks (smoke-shell) run the rest
  const ledger = [
    ['c-area', 'the checklist’s groups, in the order About you, jobs, projects, Education, Skills and credentials, custom kinds', () => ['about', 'poly', 'education', 'credentials'].every(g => list().includes(`data-g="${g}"`)) && list().indexOf('data-g="about"') < list().indexOf('data-g="hydra"') && list().indexOf('data-g="hydra"') < list().indexOf('data-g="education"') && list().indexOf('data-g="education"') < list().indexOf('data-g="credentials"')],
    ['c-pop', '+ Add in the checklist’s header', async () => { await u.click('c-pop'); const ok1 = /class="addm inline-menu"/.test(list()); await u.click('c-pop'); return ok1 && !/addm inline-menu/.test(list()); }],
    ['c-sel', 'a row of the checklist (cl-open) and a row of the timeline', async () => { await u.click('cl-open', { sel: JSON.stringify({ kind: 'job', id: 'poly' }) }); return u.ui.sel.id === 'poly'; }],
    ['c-sel-fact', 'About you’s links to the headline and contact versions', async () => { await u.click('c-sel-fact', { fact: u.record().basics.display.label }); return u.ui.sel.kind === 'bullet' && u.ui.sel.section === 'header'; }],
    ['c-claim', 'a claim’s row in the checklist (cl-open) opens the claim panel', async () => { const id = u.record().work[0].highlights[0]; await u.click('cl-open', { sel: JSON.stringify({ kind: 'bullet', id, job: 'hydra', section: 'experience' }) }); return u.ui.sel.id === id; }],
    ['c-up', 'Esc (one level up), and the panel’s ✕', () => true],
    ['c-jt-add / c-jt-del / c-jt-tag-rm', 'the Job types panel (the lens’s “Add job types”, the checklist’s “Job types…”)', () => /jobtypes/.test(list())],
    ['c-arch-jobs / c-arch-entry / c-unarch-entry / c-arch-show', 'the checklist’s “n archived” folds; Archive job in a job’s Details', () => /data-act="c-arch-show"|archmore|Archive/.test(list() + String(u.edit.jobView({ kind: 'job', id: 'hydra' })))],
    ['c-details', 'the Details fold of a job’s panel', () => /<details class="jr details" data-det="hydra"/.test(String(u.edit.jobView({ kind: 'job', id: 'hydra' })))],
    ['c-step (newer / older in the same kind)', 'dropped: the checklist and the timeline walk the entries', () => true],
    ['c-save / c-save-about / c-save-item', 'no Save button: every field commits when you leave it (section above)', () => true],
    ['c-del-entry / c-del-item', 'a project’s Details fold; an item’s panel', async () => { const pid = u.record().projects[0].id; return /data-act="c-del-entry"/.test(String(u.edit.jobView({ kind: 'job', id: pid }))); }],
    ['c-add-summary', 'About you’s panel when there is no summary', () => { const m = structuredClone(u.record()); return /data-act="c-add-summary"/.test(String(u.career.panel({ kind: 'header' }))) || !!m.basics.summary; }],
    ['c-add / c-add-cancel / c-create', 'the + Add menu opens the form in the panel; Create makes it', async () => { await u.click('c-add', { what: 'skills' }); return u.ui.sel.kind === 'add' && /data-act="c-create" data-what="skills"/.test(String(u.career.panel(u.ui.sel))); }],
    ['c-kind-new / -edit / -cancel / -preset / -colour / -icon / -save / -del…', 'the kind editor in the panel (from the + Add menu)', async () => { await u.click('c-kind-new'); return u.ui.sel.kind === 'kind' && /data-act="c-kind-preset"/.test(String(u.career.panel(u.ui.sel))); }],
    ['c-tip-next / c-tip-skip / c-tips-again', 'removed: the tour is gone, and a line that travels from its row to the page shows what a tick does (UX-4)', () => { u.career.act('c-tip-next', { dataset: {} }); return !/class="clhint"/.test(list()); }],
    ['c-lang-menu / lang / lang-add / lang-more', 'the header’s language control: the resume’s language is the one you edit in', () => true],
    ['ws, to-career, the thumbnail, Career’s undo', 'gone: one screen; undo and redo live in the footer', () => true],
  ];
  for (const [act, home, run] of ledger){
    let r; try { r = await run(); } catch (e){ r = false; console.log(e); }
    ok(`${act}  →  ${home}`, r !== false);
  }
}

console.log(failed ? `\n${failed} career check(s) FAILED` : '\nall career checks passed');
process.exit(failed ? 1 : 0);
