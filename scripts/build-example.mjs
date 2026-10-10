#!/usr/bin/env node
// node scripts/build-example.mjs [data/example.json]
// Builds the fictional example career (resume-data/4) and its saved resumes into
// data/. Every name, number, link and company in it is invented.
// Hungarian is incomplete on purpose: the missing-translation features are tested on it.

import fs from 'node:fs';
import path from 'node:path';
import { author, cps } from './lib/authoring.mjs';
import { migrate, save, serialize, saveResume, resumeFileName } from '../src/model/schema.js';
import { validate } from '../checks/lib/validate.mjs';
import { fmtMonth } from '../src/model/build.js';
import { LANGS } from '../src/model/schema.js';

const OUT = process.argv[2] ?? 'data/example.json';
const DIR = path.dirname(OUT);
const RESUMES = path.join(DIR, 'example-resumes');

const SEP = '  ·  ', RUN_SEP = ' · ', TITLE_SEP = '  ';
const ALL = ['us-letter', 'a4', 'a4-hu'];

// builder. A version is [n, text, tags, lang?, extra?]; ids are <fact>-v<n>[-lang].
const facts = [], variants = [];
const vid = (fact, n, lang) => `${fact}-v${n.replace('.', '-')}${lang && lang !== 'en' ? `-${lang}` : ''}`;
function fact(id, def, versions){
  const made = [];
  const order = v => [(v[3] ?? 'en') === 'en' ? 0 : 1, ...v[0].split('.').map(Number)];
  const sorted = [...versions].sort((a, b) => {
    const x = order(a), y = order(b);
    for (let i = 0; i < 3; i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
    return 0;
  });
  for (const [n, src, own = [], lang = 'en', extra = {}] of sorted){
    const tags = own.length ? own : def.tags ?? [];
    const { text, marks, links } = author(src);
    const v = { id: vid(id, n, lang), n, lang, text, marks, links, tags,
      seenIn: extra.seenIn ?? [], metrics: { chars: cps(text), measured: {} } };
    if (extra.separator) v.separator = extra.separator;
    if (extra.note) v.note = extra.note;
    variants.push(v);
    made.push(v.id);
  }
  facts.push({ id, ...(def.work ? { work: def.work } : {}), axis: def.axis ?? 'density',
    ...(def.term ? { term: def.term } : {}), ...(def.label ? { label: def.label } : {}),
    summary: def.summary, variants: made });
}
// Written once in English, listed in record.same, printed in every language.
const same = (text, tags = [], extra = {}) => [['1', text, tags, 'en', extra]];

// header
fact('name', { summary: 'Full name' }, same('Dana Okonkwo', ['identity']));
fact('tagline', { summary: 'Discipline line for the gutter' }, [
  ['1', 'Mechanical &\nDesign Engineer', ['identity']],
  ['1', 'Gépész- és\ntervezőmérnök', ['identity'], 'hu'],
]);
const EMAIL = '{{dana@example.org|mailto:dana@example.org}}', PHONE = '+351 900 000 000', SITE = '{{danaokonkwo.example|https://danaokonkwo.example}}';
fact('contact', { summary: 'Contact block and work-rights line', axis: 'market' }, [
  ['1', `Lisbon, Portugal${SEP}${EMAIL}${SEP}${PHONE}\n${SITE}${SEP}EU citizen, no sponsorship`, ['identity', 'work-rights'], 'en', { separator: SEP, seenIn: ['us-letter'] }],
  ['2', `Lisbon, Portugal${SEP}${EMAIL}${SEP}${PHONE}\n${SITE}${SEP}Portuguese citizen, no permit needed in the EU`, ['identity', 'work-rights'], 'en', { separator: SEP, seenIn: ['a4'] }],
  ['1', `Lisszabon, Portugália${SEP}${EMAIL}${SEP}${PHONE}\n${SITE}${SEP}EU-állampolgár, munkavállalási engedély nem kell`, ['identity', 'work-rights'], 'hu', { separator: SEP }],
]);

// summary
fact('summary', { summary: 'Positioning line' }, [
  ['1', 'Mechanical engineer working on single-use medical devices from first sketch to tooling release; [[EU patent holder]]. Spent three years on the clean-room side of a contract manufacturer before moving into design.', ['Medical devices']],
  ['2', 'Mechanical engineer on single-use medical devices, from sketch to tooling release; [[EU patent holder]].', ['Hardware design']],
  ['2.1', 'Mechanical engineer on single-use medical devices, sketch to tooling; co-inventor on an EU patent.', ['hardware']],
  ['3', 'Design engineer who started on the factory floor: three years running clean-room lines, then five designing the parts that run on them.', ['Manufacturing engineering']],
  ['4', 'Engineer who builds things to test them: ran a seven-machine prototyping lab, now designs and verifies medical hardware.', ['Prototyping']],
  ['1', 'Gépészmérnök: egyszer használatos orvostechnikai eszközök az első vázlattól a szerszámkiadásig; [[EU-szabadalom társfeltalálója]].', ['Hardware design'], 'hu'],
  ['2', 'Gyártásból jött tervezőmérnök: három év tisztatéri gyártósoron, utána öt év az ott gyártott alkatrészek tervezésével.', ['Manufacturing engineering'], 'hu'],
]);

// jobs
const JOBS = [
  { id: 'hydra', position: ['Design Engineer', 'Tervezőmérnök'], name: 'Hydra Medical', location: ['Lisbon, Portugal', 'Lisszabon'],
    start: '2023-03', end: null, meta: ['Hydra Medical · Mar 2023 – Present · Lisbon', 'Hydra Medical · 2023. márc. – jelenleg · Lisszabon'] },
  { id: 'poly', position: ['Prototyping Technician', 'Prototípus-technikus'], name: 'Polytechnic Prototyping Lab', location: ['Porto, Portugal', 'Porto'],
    start: '2021-09', end: '2023-02', meta: ['Polytechnic Prototyping Lab · Sep 2021 – Feb 2023 · Porto', 'Polytechnic Prototyping Lab · 2021. szept. – 2023. febr. · Porto'] },
  { id: 'free', position: ['Freelance CAD Designer', 'Szabadúszó CAD-tervező'], name: 'Self-employed', location: ['Remote', 'Távmunka'],
    start: '2021-01', end: '2021-08', meta: ['Self-employed · Jan 2021 – Aug 2021 · Remote', 'Egyéni vállalkozó · 2021. jan. – 2021. aug. · Távmunka'] },
  { id: 'medisure', position: ['Clean-room Technician', 'Tisztatéri technikus'], name: 'Medisure Contract Manufacturing', location: ['Porto, Portugal', 'Porto'],
    start: '2018-06', end: '2020-12', meta: ['Medisure Contract Manufacturing · Jun 2018 – Dec 2020 · Porto', 'Medisure Contract Manufacturing · 2018. jún. – 2020. dec. · Porto'] },
  { id: 'atelier', position: ['Design Intern', 'Tervezőgyakornok'], name: 'Atelier Norte', location: ['Porto, Portugal', 'Porto'],
    start: '2017-06', end: '2017-09', meta: ['Atelier Norte · Jun 2017 – Sep 2017 · Porto', 'Atelier Norte · 2017. jún. – 2017. szept. · Porto'] },
];
for (const j of JOBS){
  fact(`${j.id}-position`, { work: j.id, summary: 'Job title', tags: ['work-history'] }, [['1', j.position[0]], ['1', j.position[1], [], 'hu']]);
  fact(`${j.id}-meta`, { work: j.id, summary: 'Employer, dates and location', tags: ['work-history'] }, [['1', j.meta[0]], ['1', j.meta[1], [], 'hu']]);
}

const BULLETS = {
  hydra: [
    ['hydra-inhaler', 'Led the dose-counter redesign, 400,000 units a year', [
      ['1', 'Led the dose-counter redesign on an inhaler running [[400,000 units a year]]; cut the part count from nine to five.', ['hardware', 'cad']],
      ['2', 'Led the dose-counter redesign on an inhaler running [[400,000 units a year]], cutting the part count from nine to five and taking two weeks out of the tooling schedule.', ['Hardware design', 'manufacturing', 'leadership']],
      ['2.1', 'Led the dose-counter redesign on a [[400,000-unit-a-year]] inhaler: nine parts down to five, two weeks off the tooling schedule.', ['hardware']],
      ['2.2', 'Led the dose-counter redesign on an inhaler running [[400,000 units a year]], cutting nine parts to five and two weeks from tooling.', ['Manufacturing engineering']],
      ['3', 'Redesigned the dose counter of a high-volume inhaler ([[400,000 units a year]]) with five parts instead of nine.', ['Medical devices']],
      ['1', 'Vezettem egy [[évi 400 000 darabos]] inhalátor adagszámlálójának újratervezését; az alkatrészek számát kilencről ötre csökkentettem.', ['Hardware design'], 'hu'],
      ['2', '[[Évi 400 000 darabos]] inhalátor adagszámlálójának újratervezése: kilenc helyett öt alkatrész, két héttel rövidebb szerszámozás.', ['Manufacturing engineering'], 'hu'],
    ]],
    ['hydra-testing', 'Built the drop and cycle testing rig', [
      ['1', 'Built the drop and cycle test rig the team now uses for design verification, and wrote the test protocols that go with it.', ['prototyping', 'Medical devices', 'Prototyping']],
      ['1.1', 'Built the team’s drop and cycle test rig and wrote its verification protocols.', ['Hardware design']],
      ['2', 'Built the drop and cycle test rig used for design verification, wrote the test protocols, and qualified the moulding suppliers behind them.', ['prototyping', 'manufacturing']],
      ['1', 'Megépítettem az ejtő- és ciklusvizsgáló berendezést, amelyet a csapat a tervezés verifikálására használ, és megírtam a vizsgálati protokollokat.', ['Hardware design'], 'hu'],
    ]],
    ['hydra-suppliers', 'Qualified suppliers in two countries', [
      ['1', 'Qualified two moulding suppliers, one in Portugal and one in Poland, and ran the first-article inspections.', ['manufacturing', 'Hardware design', 'Manufacturing engineering']],
      ['2', 'Qualified moulding suppliers in Portugal and Poland, including first-article inspection and the PPAP paperwork.', ['Medical devices']],
      ['1', 'Két fröccsöntő beszállítót minősítettem (Portugália, Lengyelország), és lefolytattam az első darabos ellenőrzéseket.', ['Manufacturing engineering'], 'hu'],
    ]],
    ['hydra-dfm', 'Ran DFM reviews with the toolmaker', [
      ['1', 'Ran the weekly DFM reviews with the toolmaker through three rounds of T1 samples, closing 41 of 44 issues before tooling release.', ['manufacturing', 'Hardware design', 'Manufacturing engineering']],
      ['1.1', 'Ran DFM reviews with the toolmaker through three T1 rounds; 41 of 44 issues closed.', ['manufacturing']],
      ['1', 'Heti DFM-egyeztetéseket vezettem a szerszámkészítővel három T1-mintakörön át; 44 hibából 41-et zártunk le szerszámkiadás előtt.', ['Manufacturing engineering'], 'hu'],
    ]],
    ['hydra-tolerance', 'Built the tolerance stack for the counter', [
      ['1', 'Built the tolerance stack for the counter mechanism and caught a 0.3 mm interference before the first tool was cut.', ['cad', 'Hardware design', 'Medical devices']],
    ]],
    ['hydra-dhf', 'Kept the design history file', [
      ['1', 'Kept the design history file for the counter: 140 controlled documents through two design reviews.', ['documentation', 'Medical devices']],
    ]],
    ['hydra-human', 'Ran formative usability studies with patients', [
      ['1', 'Ran three rounds of formative usability testing with 14 asthma patients and changed the counter window after the second.', ['Medical devices', 'ux']],
      ['2', 'Planned and ran formative usability studies (14 patients, three rounds) under IEC 62366, and fed the findings into the design history file.', ['Medical devices', 'documentation']],
      ['1', 'Három kör formatív használhatósági vizsgálatot végeztem 14 asztmás beteggel; a második után átterveztük a számlálóablakot.', ['Medical devices'], 'hu'],
    ]],
  ],
  poly: [
    ['poly-shop', 'Ran a seven-machine prototyping shop', [
      ['1', 'Ran a [[seven-machine prototyping shop]]: four FDM printers, a resin printer, a benchtop mill and a laser cutter.', ['fabrication', 'Prototyping']],
      ['2', 'Ran a [[seven-machine prototyping shop]] — four FDM printers, a resin printer, a benchtop mill and a laser cutter — including the calibration and the repair log.', ['fabrication', 'Hardware design']],
      ['1', '[[Hét gépes prototípus-műhelyt]] vezettem: négy FDM-nyomtató, egy gyantanyomtató, egy asztali maró és egy lézervágó.', ['fabrication'], 'hu'],
    ]],
    ['poly-teaching', 'Taught the machine-safety induction', [
      ['1', 'Taught the machine-safety induction to about 120 students a year and wrote the handbook for it.', ['teaching', 'Prototyping']],
      ['2', 'Trained about 120 students a year on the lab machines and wrote the safety handbook still in use.', ['teaching']],
      ['1', 'Évente mintegy 120 hallgatónak tartottam gépbiztonsági oktatást, és megírtam hozzá a kézikönyvet.', ['teaching'], 'hu'],
    ]],
    ['poly-jigs', 'Designed fixtures for student projects', [
      ['1', 'Designed and printed over 60 jigs and fixtures for student capstone projects, from drill guides to a vacuum-forming frame.', ['fabrication', 'cad', 'Prototyping']],
      ['2', 'Designed over 60 jigs and fixtures, including a vacuum-forming frame now used across three departments.', ['Manufacturing engineering']],
      ['1', 'Több mint 60 készüléket és befogót terveztem és nyomtattam hallgatói projektekhez, a fúrósablontól a vákuumformázó keretig.', ['fabrication'], 'hu'],
    ]],
    ['poly-repairs', 'Kept the shop’s machines running', [
      ['1', 'Kept the shop’s machines running: logged and fixed about 300 faults a year, most of them within a day.', ['fabrication', 'Prototyping', 'Manufacturing engineering']],
    ]],
    ['poly-grant', 'Wrote the equipment grant for a five-axis mill', [
      ['1', 'Wrote the lab’s equipment grant application: €48,000 for a five-axis mill, approved on first submission.', ['Prototyping', 'leadership']],
      ['2', 'Secured €48,000 in equipment funding for a five-axis mill.', ['leadership']],
    ]],
  ],
  free: [
    ['free-work', 'CAD and rendering for two furniture studios', [
      ['1', 'CAD and rendering for two small furniture studios, including the assembly drawings they shipped with the product.', ['cad']],
      ['2', 'Modelled, rendered and detailed two furniture ranges, through to the flat-pack assembly drawings.', ['cad', 'Hardware design']],
    ]],
    ['free-proto', 'Printed prototypes for test assemblies', [
      ['1', 'Printed and finished 25 hinge and joint prototypes for the studios’ test assemblies.', ['Prototyping', 'fabrication']],
    ]],
    ['free-site', 'Built a parts-library website', [
      ['1', 'Built a searchable parts library for one studio so their joiners could find hardware by fixing type and load.', ['web']],
    ]],
  ],
  medisure: [
    ['med-lines', 'Ran ISO 7 clean-room assembly lines', [
      ['1', 'Ran ISO 7 clean-room assembly for three catheter products, about 9,000 units a week across two shifts.', ['manufacturing', 'Manufacturing engineering', 'Medical devices']],
      ['2', 'Ran clean-room assembly for three catheter products, about 9,000 units a week.', ['manufacturing']],
      ['1', 'ISO 7-es tisztatéri összeszerelést vezettem három katéterterméknél, heti mintegy 9000 darabbal, két műszakban.', ['Manufacturing engineering'], 'hu'],
    ]],
    ['med-scrap', 'Cut scrap on the balloon-bonding line', [
      ['1', 'Cut scrap on the balloon-bonding line from 6% to 2.5% by redesigning the bonding fixture.', ['Manufacturing engineering', 'manufacturing', 'Hardware design']],
      ['2', 'Redesigned a bonding fixture that brought line scrap down from 6% to 2.5%.', ['Medical devices']],
      ['1', 'A ballonragasztó sor selejtarányát 6%-ról 2,5%-ra csökkentettem a ragasztókészülék áttervezésével.', ['Manufacturing engineering'], 'hu'],
    ]],
    ['med-spc', 'Set up SPC on the highest-scrap stations', [
      ['1', 'Set up SPC charts on the two highest-scrap stations and trained the line leads to read them.', ['manufacturing', 'Manufacturing engineering']],
    ]],
    ['med-trial', 'Ran the validation build for a new line', [
      ['1', 'Ran the validation build for a new catheter line: installation, operational and performance qualification on 11 stations.', ['manufacturing', 'Medical devices', 'verification']],
    ]],
    ['med-wi', 'Wrote work instructions', [
      ['1', 'Wrote or rewrote 22 work instructions after a customer audit, all accepted without findings at the follow-up.', ['documentation', 'Medical devices']],
    ]],
  ],
  atelier: [
    ['atl-range', 'Modelled an outdoor furniture range', [
      ['1', 'Modelled and rendered an eight-piece outdoor furniture range for the studio’s trade-fair catalogue.', ['cad']],
    ]],
  ],
};
for (const [job, list] of Object.entries(BULLETS))
  for (const [id, summary, versions] of list) fact(id, { work: job, summary, tags: ['experience'] }, versions);

// the rest
const SKILLS = [
  ['skills-cad', 'CAD & 3D', 'CAD és 3D', 'SolidWorks (CSWP), Creo, Fusion 360, KeyShot', null],
  ['skills-fabrication', 'Fabrication', 'Gyártás', '3D printing FDM/SLA, CNC milling, laser cutting, silicone tooling, injection-moulding DFM',
    '3D-nyomtatás FDM/SLA, CNC-marás, lézervágás, szilikonszerszám, fröccsöntési DFM'],
  ['skills-testing', 'Test & QA', 'Vizsgálat és QA', 'ISO 13485, IEC 62366, design verification, first-article inspection, PPAP', null],
  ['skills-software', 'Software', 'Szoftver', 'Python, MATLAB, Git, Excel', null],
];
for (const [id, label, , en, hu] of SKILLS)
  fact(id, { label, summary: `${label} skills` }, hu ? [['1', en, ['cad']], ['1', hu, ['cad'], 'hu']] : same(en, ['cad']));

fact('cert-solidworks', { summary: 'SolidWorks certification' }, same('SolidWorks CSWP', ['cad', 'certification']));
fact('cert-gdt', { summary: 'GD&T certification' }, same('GD&T ASME Y14.5', ['cad', 'certification']));
fact('cert-iso', { summary: 'ISO 13485 internal auditor' }, [
  ['1', 'ISO 13485 internal auditor', ['certification', 'documentation']],
  ['1', 'ISO 13485 belső auditor', ['certification', 'documentation'], 'hu'],
]);

fact('patent-title', { summary: 'Patent title' }, [
  ['1', 'Dose-counting mechanism for a metered inhaler', ['patent']],
  ['1', 'Adagszámláló mechanizmus adagolós inhalátorhoz', ['patent'], 'hu'],
]);
fact('patent-meta', { summary: 'Patent metadata line' }, [
  ['1', 'CO-INVENTOR · [[EP 3 000 000 B1]] · 2025', ['patent']],
  ['1', 'TÁRSFELTALÁLÓ · [[EP 3 000 000 B1]] · 2025', ['patent'], 'hu'],
]);

fact('edu-degree', { summary: 'Degree' }, [['1', 'M.Eng. Mechanical Engineering', ['education']], ['1', 'Gépészmérnök MSc', ['education'], 'hu']]);
fact('edu-school', { summary: 'Institution' }, [['1', 'Universidade do Porto', ['education']], ['1', 'Portói Egyetem', ['education'], 'hu']]);
fact('edu-meta', { summary: 'Conferral date and honours' }, [['1', 'JUL 2021 · DISTINCTION', ['education']], ['1', '2021. JÚL. · KITÜNTETÉSSEL', ['education'], 'hu']]);

const LANG_ROWS = [['lang-portuguese', 'Portuguese', 'Portugál', 'Native', 'anyanyelv'],
  ['lang-english', 'English', 'Angol', 'C2', 'C2'], ['lang-hungarian', 'Hungarian', 'Magyar', 'B1', 'B1']];
for (const [id, term, , en, hu] of LANG_ROWS)
  fact(id, { term, summary: `${term}, ${en}` }, [['1', en, ['languages']], ['1', hu, ['languages'], 'hu']]);

// No Hungarian on purpose: the missing-translation case.
const INTERESTS = [['interest-sailing', 'Dinghy sailing'], ['interest-bookbinding', 'Bookbinding'], ['interest-watches', 'Restoring mechanical watches']];
for (const [id, text] of INTERESTS) fact(id, { summary: text }, [['1', text, ['interests']]]);

// eight more languages. NEEDS A NATIVE REVIEW: machine-written, tagged `needs-review`.
// Bullets left off each one-pager stay untranslated on purpose.
const NEW = ['de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs'];
const T = Object.fromEntries(NEW.map(l => [l, JSON.parse(fs.readFileSync(new URL(`./lib/example-i18n/${l}.json`, import.meta.url), 'utf8'))]));
const CAT = Object.fromEntries(await Promise.all(NEW.map(async l => [l, (await import(`../src/i18n/${l}.js`)).default])));
const REVIEW = 'needs-review';
function addIn(factId, lang, text, tags = [], extra = {}){
  const f = facts.find(x => x.id === factId);
  if (!f) throw new Error(`no fact ${factId}`);
  const { text: t, marks, links } = author(text);
  const v = { id: vid(factId, '1', lang), n: '1', lang, text: t, marks, links, tags: [...new Set([...tags, REVIEW])],
    seenIn: [], metrics: { chars: cps(t), measured: {} } };
  if (extra.separator) v.separator = extra.separator;
  variants.push(v); f.variants.push(v.id);
}
const BULLETS_IN = ['hydra-inhaler', 'hydra-testing', 'hydra-suppliers', 'hydra-dfm', 'hydra-tolerance', 'poly-shop', 'poly-teaching', 'poly-jigs', 'med-lines', 'med-scrap'];
const meta = (j, L, x) => [j.id === 'free' ? x['employer.free'] : j.name, `${fmtMonth(j.start, L)} – ${j.end ? fmtMonth(j.end, L) : CAT[L]['doc.present']}`,
  x[`loc.${j.id === 'hydra' ? 'lisbon' : j.id === 'free' ? 'remote' : 'porto'}`]].join(' · ');
for (const L of NEW){
  const x = T[L];
  addIn('tagline', L, x.tagline, ['identity']);
  addIn('contact', L, `${x.city}${SEP}${EMAIL}${SEP}${PHONE}\n${SITE}${SEP}${x.rights}`, ['identity', 'work-rights'], { separator: SEP });
  addIn('summary', L, x.summary, ['Hardware design']);
  for (const j of JOBS){ addIn(`${j.id}-position`, L, x[`pos.${j.id}`]); addIn(`${j.id}-meta`, L, meta(j, L, x)); }
  for (const b of BULLETS_IN) addIn(b, L, x[`b.${b}`], variants.find(v => v.id === vid(b, '1', 'en'))?.tags ?? []);
  addIn('skills-fabrication', L, x['skills.fabrication'], ['cad']);
  addIn('skills-testing', L, x['skills.testing'], ['cad']);
  addIn('cert-iso', L, x['cert.iso'], ['certification']);
  addIn('patent-title', L, x['patent.title'], ['patent']);
  addIn('patent-meta', L, `${x['patent.role'].toUpperCase()} · [[EP 3 000 000 B1]] · 2025`, ['patent']);
  addIn('edu-degree', L, x['edu.degree'], ['education']);
  addIn('edu-school', L, 'Universidade do Porto', ['education']);
  addIn('edu-meta', L, `${fmtMonth('2021-07', L).toUpperCase()} · ${x.honours.toUpperCase()}`, ['education']);
  addIn('lang-portuguese', L, x['lang.native'], ['languages']);
  addIn('lang-english', L, 'C2', ['languages']);
  addIn('lang-hungarian', L, 'B1', ['languages']);
}
const i18nFor = L => {
  const x = T[L], C = CAT[L];
  return {
    sections: Object.fromEntries(['summary', 'experience', 'skills', 'certified', 'patent', 'education', 'languages', 'interests'].map(id => [id, C[`doc.section.${id}`]])),
    labels: { 'skills-cad': x['skill.cad'], 'skills-fabrication': x['skill.fabrication'], 'skills-testing': x['skill.testing'], 'skills-software': x['skill.software'] },
    terms: { 'lang-portuguese': x['lang.portuguese'], 'lang-english': x['lang.english'], 'lang-hungarian': x['lang.hungarian'] },
    continued: C['doc.continued'],
    fields: Object.fromEntries(JOBS.flatMap(j => [[`work/${j.id}/position`, x[`pos.${j.id}`]], [`work/${j.id}/location`, x[`loc.${j.id === 'hydra' ? 'lisbon' : j.id === 'free' ? 'remote' : 'porto'}`]]])),
  };
};

// projects: their section is off on every saved resume
fact('caliper-stand-position', { summary: 'Project', tags: ['projects'] }, [['1', 'Open-source caliper stand']]);
fact('caliper-stand-meta', { summary: 'With whom and when', tags: ['projects'] }, [['1', 'Independent · Apr 2022 – Sep 2022']]);
fact('caliper-stand-files', { summary: 'Published a printable caliper stand', tags: ['projects'] }, [['1', 'Designed a printable caliper stand and published the files; about 3,000 downloads in its first year.', ['fabrication', 'Prototyping']]]);
fact('chassis-jig-position', { summary: 'Project', tags: ['projects'] }, [['1', 'Formula Student chassis jig']]);
fact('chassis-jig-meta', { summary: 'With whom and when', tags: ['projects'] }, [['1', 'FEUP Formula Student team · Oct 2019 – Jun 2020 · Porto']]);
fact('chassis-jig-welding', { summary: 'Designed the chassis welding jig', tags: ['projects'] }, [
  ['1', 'Designed the welding jig for the team’s steel spaceframe chassis; it held tolerance through two builds.', ['fabrication', 'cad']],
  ['2', 'Designed the chassis welding jig.', ['fabrication']]]);
const PROJECTS = [
  { id: 'caliper-stand', name: 'Open-source caliper stand', entity: 'Independent', startDate: '2022-04', endDate: '2022-09',
    display: { position: 'caliper-stand-position', meta: 'caliper-stand-meta' }, highlights: ['caliper-stand-files'] },
  { id: 'chassis-jig', name: 'Formula Student chassis jig', entity: 'FEUP Formula Student team', startDate: '2019-10', endDate: '2020-06', location: 'Porto, Portugal',
    during: 'porto-meng', display: { position: 'chassis-jig-position', meta: 'chassis-jig-meta' }, highlights: ['chassis-jig-welding'] },
];

// the record
const tags = [...new Set(variants.flatMap(v => v.tags))].sort((a, b) => a.localeCompare(b));
const record = migrate({
  schema: 'resume-data/3',
  meta: {
    owner: 'Dana Okonkwo (fictional)', updated: '2026-10-06', appVersion: '0.5.1',
    note: 'Fictional: every name, number, link, employer, company and patent number is invented. '
      + 'Written by scripts/build-example.mjs; edit that, not this. metrics.measured is written by the renderer.',
  },
  vocabulary: { slots: ['primary'], axes: ['density', 'market'], tags },
  basics: {
    name: 'Dana Okonkwo', label: 'Mechanical & Design Engineer',
    email: 'dana@example.org', phone: PHONE, url: 'https://danaokonkwo.example',
    location: { city: 'Lisbon', countryCode: 'PT' },
    profiles: [{ network: 'Portfolio', username: 'danaokonkwo.example', url: 'https://danaokonkwo.example' }],
    summary: 'summary',
    display: { name: 'name', label: 'tagline', contact: 'contact' },
    // No photo ships (the deploy refuses embedded images); the ⬜ placeholder
    // is what the export guard and the gap chip are tested on.
    portrait: { state: 'missing', placeholder: '⬜', label: 'PHOTO', formats: ['a4', 'a4-hu'] },
  },
  work: JOBS.map(j => ({
    id: j.id, position: j.position[0], name: j.name, location: j.location[0],
    startDate: j.start, endDate: j.end,
    display: { position: `${j.id}-position`, meta: `${j.id}-meta` },
    highlights: BULLETS[j.id].map(([id]) => id),
  })),
  education: [{ id: 'porto-meng', institution: 'Universidade do Porto', studyType: 'M.Eng.', area: 'Mechanical Engineering',
    startDate: '2016-09', endDate: '2021-07', score: 'Distinction',
    display: { studyType: 'edu-degree', institution: 'edu-school', meta: 'edu-meta' } }],
  publications: [{ id: 'dose-counter', name: 'Dose-counting mechanism for a metered inhaler', publisher: 'EPO',
    releaseDate: '2025', identifier: 'EP 3 000 000 B1', role: 'Co-inventor',
    display: { name: 'patent-title', meta: 'patent-meta' } }],
  skills: SKILLS.map(([id, name, , en]) => ({ id, name, keywords: en.split(', ') })),
  certificates: [
    { id: 'cert-solidworks', name: 'SolidWorks CSWP', issuer: 'Example Systems' },
    { id: 'cert-gdt', name: 'GD&T ASME Y14.5', issuer: 'Example Institute' },
    { id: 'cert-iso', name: 'ISO 13485 internal auditor', issuer: 'Example Certification Body' },
  ],
  languages: LANG_ROWS.map(([id, language, , fluency]) => ({ id, language, fluency })),
  projects: PROJECTS,
  interests: INTERESTS.map(([id, name]) => ({ id, name })),
  sections: [
    { id: 'header',     title: null,         kind: 'header',  content: { basics: true } },
    { id: 'summary',    title: 'Summary',    kind: 'prose',   content: { fact: 'summary' } },
    { id: 'experience', title: 'Experience', kind: 'entries', content: { work: JOBS.map(j => j.id) } },
    { id: 'skills',     title: 'Skills',     kind: 'grid',    content: { groups: SKILLS.map(([id]) => id) } },
    { id: 'certified',  title: 'Certified',  kind: 'runs',    content: { items: ['cert-solidworks', 'cert-gdt', 'cert-iso'], separator: RUN_SEP } },
    { id: 'patent',     title: 'Patent',     kind: 'item',    content: { title: 'patent-title', meta: 'patent-meta' } },
    { id: 'education',  title: 'Education',  kind: 'item',    content: { title: 'edu-degree', subtitle: 'edu-school', meta: 'edu-meta', titleSeparator: TITLE_SEP } },
    { id: 'languages',  title: 'Languages',  kind: 'pairs',   content: { pairs: LANG_ROWS.map(([id]) => id) } },
    { id: 'interests',  title: 'Interests',  kind: 'runs',    content: { items: INTERESTS.map(([id]) => id), separator: RUN_SEP } },
    { id: 'projects',   title: 'Projects',   kind: 'entries', off: true, content: { work: PROJECTS.map(p => p.id) } },
  ],
  facts,
  variants,
  // Labels measured to fit the 112px a4-hu gutter; longer ones do not.
  i18n: { hu: {
    sections: { summary: 'Profil', experience: 'Tapasztalat', skills: 'Készségek', certified: 'Képesítés',
      patent: 'Szabadalom', education: 'Végzettség', languages: 'Nyelvtudás', interests: 'Érdeklődés' },
    labels: Object.fromEntries(SKILLS.map(([id, , hu]) => [id, hu])),
    terms: Object.fromEntries(LANG_ROWS.map(([id, , hu]) => [id, hu])),
    continued: 'FOLYTATÁS',
    fields: Object.fromEntries(JOBS.map(j => [`work/${j.id}/location`, j.location[1]])),
  }, ...Object.fromEntries(NEW.map(L => [L, i18nFor(L)])) },
});
record.langs = [...LANGS];
record.same = ['fact:name', 'fact:skills-cad', 'fact:skills-testing', 'fact:skills-software', 'fact:cert-solidworks', 'fact:cert-gdt'];
record.jobTypes = ['Hardware design', 'Medical devices', 'Prototyping', 'Manufacturing engineering'];
record.requireSource = false;

// saved resumes. Off bullets are written twice: as the printed `highlights`
// subset and as `off`, the intent, which Fit never adds back.
const SECTION_IDS = record.sections.map(s => s.id).filter(id => id !== 'header');
const byN = (factId, n, lang) => {
  const v = variants.find(x => x.id === vid(factId, n, lang));
  if (!v) throw new Error(`no v${n} (${lang}) on ${factId}`);
  return v.id;
};
function resume(o){
  const lang = o.lang ?? 'en';
  const off = new Set(o.off ?? []);
  const work = JOBS.map(j => {
    const hs = BULLETS[j.id].map(([id]) => id);
    const on = hs.filter(id => !off.has(id));
    return on.length === 0 ? null : on.length === hs.length ? j.id : { id: j.id, highlights: on };
  }).filter(Boolean);
  const sections = SECTION_IDS.filter(id => id !== 'summary' && !(o.sectionsOff ?? []).includes(id))
    .map(id => (id === 'experience' ? { id, weight: 5, work } : id === 'projects' ? { id, weight: 0, work: PROJECTS.map(p => p.id) } : { id }));
  const picks = Object.fromEntries(Object.entries(o.picks ?? {}).map(([f, n]) => [f, byN(f, n, lang)]));
  const r = {
    application: `${o.company} - ${o.role}`,
    title: `${o.company} — ${o.role}`,
    company: o.company, role: o.role, jobType: o.jobType, tags: o.tags ?? [],
    date: o.savedAt, savedAt: o.savedAt,
    format: o.format, theme: 'b2-marker', overlays: o.overlays ?? [],
    ...(lang !== 'en' ? { lang } : {}),
    summary: 'summary',
    sections, picks, overrides: {},
    ...(off.size ? { off: [...off] } : {}),
    pageLimit: o.pages,
    photo: o.photo ?? { show: false, shape: 'rect' },
  };
  // No `pages`: paginated by measurement (src/paginate.js) within pageLimit.
  return r;
}
const OLD = ['free-site', 'atl-range', 'med-wi', 'poly-grant'];
// what each new language's one-pager leaves off (tuned in Chromium to 88-96% fill)
const ALL_BULLETS = Object.values(BULLETS).flat().map(([id]) => id);
const KEEP_ON = { de: [], fr: [], es: [], it: [], pt: [], nl: [], pl: [], cs: [] };
const DROP = { de: ['hydra-tolerance', 'poly-jigs', 'poly-teaching', 'hydra-suppliers'], fr: ['hydra-tolerance', 'poly-jigs', 'poly-teaching', 'hydra-suppliers'], es: ['hydra-tolerance', 'poly-jigs', 'poly-teaching', 'hydra-suppliers'], it: ['hydra-tolerance', 'poly-jigs', 'poly-teaching', 'hydra-suppliers'],
  pt: ['hydra-tolerance', 'poly-jigs', 'poly-teaching', 'hydra-suppliers'], nl: ['hydra-tolerance', 'poly-jigs', 'poly-teaching', 'hydra-suppliers'], pl: ['hydra-tolerance', 'poly-jigs', 'poly-teaching', 'hydra-dfm', 'hydra-suppliers'], cs: ['hydra-tolerance', 'poly-jigs', 'poly-teaching', 'hydra-dfm', 'hydra-suppliers'] };
const SECTIONS_OFF = {};
const OFF_IN = L => ALL_BULLETS.filter(id => !BULLETS_IN.includes(id) || DROP[L].includes(id));
const SAVED = [
  resume({ company: 'Example Instruments', role: 'Design Engineer', jobType: 'Hardware design', tags: ['hardware'],
    format: 'us-letter', pages: 1, sectionsOff: ['interests', 'certified', 'languages'], savedAt: '2026-09-28',
    picks: { summary: '2', 'hydra-inhaler': '2.1', 'hydra-testing': '1.1', 'poly-shop': '1', 'med-scrap': '1' },
    off: [...OLD, 'hydra-human', 'poly-teaching', 'med-lines', 'free-work', 'hydra-dfm', 'poly-jigs', 'hydra-dhf', 'free-proto'] }),
  resume({ company: 'Medtech Lisboa', role: 'Mechanical Engineer', jobType: 'Medical devices', tags: ['medical'],
    format: 'a4', pages: 2, savedAt: '2026-09-12',
    picks: { summary: '1', 'hydra-inhaler': '3', 'hydra-human': '2', 'hydra-suppliers': '2', 'med-scrap': '1', 'hydra-testing': '2', 'poly-shop': '2', 'free-work': '1', 'poly-teaching': '1', 'hydra-dfm': '1' },
    off: [] }),
  resume({ company: 'Dunamenti Műszer Kft.', role: 'Terméktervező', jobType: 'Hardware design', tags: ['hardware'], lang: 'hu',
    format: 'a4-hu', pages: 1, sectionsOff: ['interests', 'certified'], savedAt: '2026-10-01',
    photo: { show: true, shape: 'rect' },     // expected in Hungary
    picks: { summary: '1', 'hydra-inhaler': '1', 'poly-shop': '1' },
    // bullets with no Hungarian version stay off
    off: [...OLD, 'free-work', 'hydra-human', 'poly-teaching', 'med-lines', 'hydra-dfm', 'poly-jigs',
      'hydra-tolerance', 'hydra-dhf', 'poly-repairs', 'free-proto', 'med-spc', 'med-trial'] }),
  resume({ company: 'Oficina Aberta', role: 'Workshop Lead', jobType: 'Prototyping', tags: ['fabrication', 'teaching'],
    format: 'a4', pages: 1, sectionsOff: ['certified', 'patent', 'interests'], savedAt: '2026-08-30',
    picks: { summary: '4', 'hydra-inhaler': '1', 'poly-shop': '2', 'poly-teaching': '2' },
    off: ['hydra-dfm', 'hydra-suppliers', 'hydra-human', 'med-wi', 'med-lines', 'free-site', 'atl-range', 'free-work', 'poly-grant', 'med-scrap',
      'hydra-tolerance', 'hydra-dhf', 'med-trial'] }),
  resume({ company: 'Helix Diagnostics', role: 'Product Development Engineer', jobType: 'Medical devices', tags: ['medical', 'verification'],
    format: 'a4', pages: 1, overlays: ['tint-tabs'], sectionsOff: ['interests', 'certified'], savedAt: '2026-09-20',
    picks: { summary: '1', 'hydra-inhaler': '2', 'hydra-testing': '2', 'hydra-human': '2', 'med-lines': '1' },
    off: [...OLD, 'poly-teaching', 'poly-jigs', 'poly-repairs', 'free-work', 'free-proto', 'med-spc', 'hydra-dfm', 'hydra-suppliers',
      'med-trial', 'hydra-dhf', 'hydra-tolerance'] }),
  resume({ company: 'Ferro Tools', role: 'Manufacturing Engineer', jobType: 'Manufacturing engineering', tags: ['manufacturing'],
    format: 'a4', pages: 1, sectionsOff: ['interests', 'patent', 'languages'], savedAt: '2026-08-15',
    picks: { summary: '3', 'hydra-inhaler': '2.2', 'poly-jigs': '2', 'med-lines': '1', 'med-scrap': '1' },
    off: ['hydra-human', 'poly-teaching', 'poly-grant', 'free-site', 'free-work', 'atl-range', 'med-wi', 'hydra-testing', 'hydra-suppliers', 'poly-shop',
      'hydra-dhf', 'free-proto'] }),
  // one A4 one-pager per new language
  ...NEW.map(L => resume({ company: T[L].company, role: T[L].role, jobType: 'Hardware design', tags: ['hardware'], lang: L,
    format: 'a4', pages: 1, savedAt: '2026-10-06', sectionsOff: SECTIONS_OFF[L] ?? ['interests', 'certified'],
    photo: { show: ['de', 'pl', 'cs'].includes(L), shape: 'rect' },
    picks: { summary: '1', 'hydra-inhaler': '1' },
    off: OFF_IN(L) })),
];

// write it out
let bad = 0;
const r0 = validate(record);
for (const e of r0.errors){ console.error(`  ✗ ${e}`); bad++; }
for (const r of SAVED){
  const { errors } = validate(record, r);
  for (const e of errors){ console.error(`  ✗ ${r.application}: ${e}`); bad++; }
}
if (bad){ console.error(`\nnot written: ${bad} error(s)`); process.exit(1); }

fs.writeFileSync(OUT, serialize(save(record)));
fs.mkdirSync(RESUMES, { recursive: true });
// remove only stale files; compare names in NFC since macOS may decompose "ő"
const NAMES = new Set([...SAVED.map(resumeFileName), 'index.json'].map(n => n.normalize('NFC')));
for (const f of fs.readdirSync(RESUMES)) if (f.endsWith('.json') && !NAMES.has(f.normalize('NFC'))) fs.rmSync(path.join(RESUMES, f));
for (const r of SAVED) fs.writeFileSync(path.join(RESUMES, resumeFileName(r)), serialize(saveResume(record, r).file));
fs.writeFileSync(path.join(DIR, 'example-recipe.json'), serialize(saveResume(record, SAVED[0]).file));
// The browser cannot list a folder, so the app reads this to find the saved resumes.
fs.writeFileSync(path.join(RESUMES, 'index.json'), JSON.stringify(SAVED.map(resumeFileName), null, 2) + '\n');

const hu = variants.filter(v => v.lang === 'hu').length;
console.log(`${path.relative('.', OUT)}: ${JOBS.length} jobs, ${facts.length} facts, ${variants.length} versions (${hu} hu), `
  + `${record.jobTypes.length} job types, ${SAVED.length} saved resumes in ${path.relative('.', RESUMES)}/`);
