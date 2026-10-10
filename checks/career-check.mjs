#!/usr/bin/env node
// node checks/career-check.mjs
// The record built from plain fields (src/model/build.js) and the Career workspace model
// (src/model/career.js): the timeline, and job edits where the printed title follows unless reworded.

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

section('Career hides archived claims, and reveals them');
{
  const u = await makeUi({ ws: 'career' });
  const gone = u.record().facts.find(f => f.archived).id;
  const job = u.record().work.find(w => w.highlights.includes(gone)).id;
  const rows = () => String(u.career.views.career());
  await u.click('c-sel', { what: 'entry', key: 'work', id: job });
  let h = rows();
  ok('an archived claim is not in the list by default', !h.includes(`data-id="${gone}"`));
  ok('…the job shows a muted “1 archived” control', /class="sm ghost archmore"[^>]*aria-expanded="false">1 archived/.test(h));
  await u.click('c-arch-show', { id: job });
  h = rows();
  ok('the control reveals it, dimmed, with an Unarchive button', h.includes(`data-id="${gone}"`) && /is-archived/.test(h) && new RegExp(`data-act="unarchive-claim" data-id="${gone}"`).test(h));
  ok('…and the same control hides it again', /Hide archived/.test(h) && (await u.click('c-arch-show', { id: job }), !rows().includes(`data-id="${gone}"`)));
  ok('a job with none archived shows no control', (await u.click('c-sel', { what: 'entry', key: 'work', id: u.record().work.find(w => w.id !== job).id }), !/archmore/.test(rows())));

  await u.click('c-sel', { what: 'entry', key: 'work', id: job });
  const before = JSON.stringify(u.record());
  const other = u.record().work.find(w => w.id === job).highlights.find(h2 => h2 !== gone);
  await u.click('c-claim', { key: 'work', entry: job, id: other });
  const panel = rows();
  ok('a claim’s panel has Archive beside 🗑', /data-act="archive-claim"[^>]*>Archive<\/button>/.test(panel) && panel.indexOf('archive-claim') < panel.indexOf('delete-claim'));
  await u.click('archive-claim');
  ok('Archive sets the flag, says Ctrl+Z undoes it, and goes back up', u.record().facts.find(f => f.id === other).archived === true && u.toasts.at(-1).m === 'Archived. Ctrl+Z undoes it.');
  ok('…the list no longer shows it', !rows().includes(`data-id="${other}"`));
  u.store.undo();
  ok('Ctrl+Z undoes it', JSON.stringify(u.record()) === before);
  await u.click('c-arch-show', { id: job });
  await u.click('unarchive-claim', { id: gone });
  ok('Unarchive brings it back', !u.record().facts.find(f => f.id === gone).archived && u.toasts.at(-1).m === 'Unarchived.');
  u.store.undo();
  ok('…and Ctrl+Z archives it again', u.record().facts.find(f => f.id === gone).archived === true);
}

section('the Resume view');
{
  // a saved resume that prints the archived claim: it keeps printing, badged, and can be turned off
  const names = read('data/example-resumes/index.json');
  const ex = S.load(read('data/example.json')).model;
  const gone = ex.facts.find(f => f.archived).id;
  const job = ex.work.find(w => w.highlights.includes(gone)).id;
  const i = names.findIndex(n => T.listedBullets(ex, S.loadResume(read(`data/example-resumes/${n}`), ex).recipe, job).includes(gone));
  ok('a saved example resume prints the archived claim', i >= 0);
  const u = await makeUi({ resume: i });
  u.select({ kind: 'job', id: job });
  let h = String(u.edit.jobView({ kind: 'job', id: job }));
  ok('its bullet list shows the claim with an “archived” badge', new RegExp(`data-id="${gone}"[\\s\\S]*?class="pill arch"[^>]*>archived`).test(h));
  u.tick({ on: gone }, false);
  h = String(u.edit.jobView({ kind: 'job', id: job }));
  ok('it can be turned off, and then it leaves the list', !T.listedBullets(u.record(), u.cur(), job).includes(gone) && !h.includes(`data-id="${gone}"`));
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

  const u = await makeUi({ ws: 'career' });
  const tl = () => String(u.career.timelineHtml());
  ok('(no archived job in the example to start with)', !/c-arch-jobs/.test(tl()));
  await u.click('c-sel', { what: 'entry', key: 'work', id: 'atelier' });
  const before2 = JSON.stringify(u.record());
  await u.click('c-arch-entry', { id: 'atelier' });
  ok('the job’s panel archives it, with a toast', u.record().work.find(w => w.id === 'atelier').archived === true && u.toasts.at(-1).m === 'Archived. Ctrl+Z undoes it.');
  ok('the timeline hides it behind a “1 archived” control', !tl().includes('data-id="atelier"') && /archmore" data-act="c-arch-jobs"[^>]*>1 archived/.test(tl()));
  await u.click('c-arch-jobs');
  ok('the control reveals it with an archived badge', tl().includes('data-id="atelier"') && /pill arch/.test(tl()));
  u.store.undo();
  ok('Ctrl+Z undoes it', JSON.stringify(u.record()) === before2);
}

section('job types in Career');
{
  const u = await makeUi({ ws: 'career' });
  await u.click('c-area', { area: 'more' });
  const page = () => String(u.career.timelineHtml());
  ok('the More step lists the job types, tags as chips', /class="grp jtypes"/.test(page()) && /data-act="c-jt-tag-rm" data-id="Prototyping" data-tag="fabrication"/.test(page()));
  const n = u.record().jobTypes.length;
  dom.set('jt-new', { value: 'CAD designer' });
  await u.click('c-jt-add');
  const made = u.record().jobTypes.at(-1);
  ok('a new job type gets an id from its name, and no tags yet', u.record().jobTypes.length === n + 1 && made.id === 'cad-designer' && made.label === 'CAD designer' && made.tags.length === 0);
  let dup = u.toasts.length; dom.set('jt-new', { value: 'cad designer' }); await u.click('c-jt-add');
  ok('the same name again is refused', u.record().jobTypes.length === n + 1 && u.toasts.length === dup + 1 && u.toasts.at(-1).tone === 'bad');
  const input = (id, v) => ({ classList: { contains: c => c === 'jt-tag-in' }, dataset: { id }, value: v });
  u.fire('keydown', input('cad-designer', 'cad'), { key: 'Enter' });
  u.fire('keydown', input('cad-designer', 'hardware'), { key: 'Enter' });
  ok('Enter adds a tag, a second one too, never twice', (() => { u.fire('keydown', input('cad-designer', 'cad'), { key: 'Enter' }); return u.record().jobTypes.at(-1).tags.join() === 'cad,hardware'; })());
  await u.click('c-jt-tag-rm', { id: 'cad-designer', tag: 'hardware' });
  ok('× removes a tag', u.record().jobTypes.at(-1).tags.join() === 'cad');
  u.fire('change', { classList: { contains: c => c === 'jt-label' }, dataset: { id: 'cad-designer' }, value: 'CAD designers' });
  ok('renaming changes the label and keeps the id', u.record().jobTypes.at(-1).label === 'CAD designers' && u.record().jobTypes.at(-1).id === 'cad-designer');
  // an old string job type becomes an object the first time it is edited
  await u.click('c-jt-tag-rm', { id: 'Hardware design', tag: 'Hardware design' });
  ok('an old string job type turns into an object when edited', typeof u.record().jobTypes[0] === 'object' && u.record().jobTypes[0].id === 'Hardware design' && u.record().jobTypes[0].tags.length === 0);
  await u.click('c-jt-del', { id: 'cad-designer' });
  ok('deleting removes it', !u.record().jobTypes.some(j => j.id === 'cad-designer'));
  u.store.undo();
  ok('Ctrl+Z brings it back', u.record().jobTypes.some(j => j.id === 'cad-designer'));
}

section('Focus on a job type in the Resume workspace');
{
  const u = await makeUi({ resume: 0 });
  const home = () => String(u.edit.homeView());
  const first = home().match(/data-act="focus" data-tag="([^"]+)"[^>]*title="[^"]*"[^>]*>([^<]+) <span/);
  ok('a bundle appears among the chips with its label, its tags as a title', !!first, home().slice(home().indexOf('chips'), home().indexOf('chips') + 200));
  await u.click('focus', { tag: 'Prototyping' });
  const before = JSON.stringify(u.cur());
  await u.click('focus-apply');
  ok('applying it changes the resume', JSON.stringify(u.cur()) !== before);
  u.store.undo();
  ok('one Ctrl+Z puts it all back', JSON.stringify(u.cur()) === before);
}

console.log(failed ? `\n${failed} career check(s) FAILED` : '\nall career checks passed');
process.exit(failed ? 1 : 0);
