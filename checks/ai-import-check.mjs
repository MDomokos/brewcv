#!/usr/bin/env node
// node checks/ai-import-check.mjs
// The word check for a JSON Resume an AI assistant made from an old resume (spec, "With an AI assistant, optional"): every text of it is looked for in the document it
// names (src/model/documents.js: checkWords, sourceOf), and the merge items that carry a missing text start unticked, with the document's nearest line (src/model/intake.js: checkItems).
// The JSON Resume and the document text are made here from the example's own words.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../src/model/schema.js';
import * as DOC from '../src/model/documents.js';
import * as X from '../src/model/intake.js';
import { fromJsonResume } from '../src/model/import.js';
import { diffRecords } from '../src/model/diff.js';
import { normText } from '../src/model/record.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ex = JSON.parse(fs.readFileSync(path.join(REPO, 'data/example.json'), 'utf8'));
const clone = x => structuredClone(x);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);

// the example as an assistant would write it from a Word file: standard JSON Resume fields only, the source named
const jobs = ex.work.slice(0, 2).map(w => ({ name: w.name, position: w.position, location: w.location, startDate: w.startDate, ...(w.endDate ? { endDate: w.endDate } : {}), highlights: w.highlights.slice(0, 4) }));
const jr = { basics: { name: ex.basics.name, label: ex.basics.label, email: ex.basics.email, phone: ex.basics.phone, summary: ex.basics.summary, location: { city: ex.basics.location.city, countryCode: 'PT' } },
  work: jobs, education: [{ institution: ex.education[0].institution, studyType: ex.education[0].studyType, area: ex.education[0].area, startDate: ex.education[0].startDate, endDate: ex.education[0].endDate }],
  skills: [{ name: ex.skills[0].name, keywords: ex.skills[0].keywords }], meta: { source: 'Old CV 2023.pdf' } };
// ...and the document it was read from: the same words as lines, dates as a page prints them
const MONTH = d => (d ? `${new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(Date.UTC(2000, +d.slice(5, 7) - 1, 15))} ${d.slice(0, 4)}` : 'Present');
const docLines = [jr.basics.name, jr.basics.label, `${jr.basics.email} | ${jr.basics.phone} | ${jr.basics.location.city}`, 'Summary', jr.basics.summary, 'Experience',
  ...jobs.flatMap(w => [`${w.position}, ${w.name}`, w.location, `${MONTH(w.startDate)} – ${MONTH(w.endDate)}`, ...w.highlights.map(h => `• ${h}`)]),
  'Education', `${jr.education[0].studyType} ${jr.education[0].area}, ${jr.education[0].institution}`, `${MONTH(jr.education[0].startDate)} – ${MONTH(jr.education[0].endDate)}`,
  'Skills', `${jr.skills[0].name}: ${jr.skills[0].keywords.join(', ')}`];
const docText = docLines.join('\n');
const check = (json, text = docText) => DOC.checkWords(json, text);
const missing = (json, text) => check(json, text).filter(r => !r.found);
const edit = (fn) => { const j = clone(jr); fn(j); return j; };

section('a JSON Resume made word for word: every text is found');
{
  const all = check(jr);
  ok('every text of the file is found in its document', all.length > 25 && all.every(r => r.found), JSON.stringify(all.filter(r => !r.found).map(r => r.path)));
  ok('the file\'s meta and a country code are not compared', !all.some(r => r.path.startsWith('meta') || r.path.endsWith('countryCode')));
  ok('a text found has no nearest line', all.every(r => r.near === null));
}

section('what an assistant changes is reported missing, with the nearest line');
{
  const bullet = jobs[0].highlights[0];
  const para = missing(edit(j => { j.work[0].highlights[0] = 'Led the redesign of the dose counter on an inhaler made at 400,000 units a year; cut the part count from nine to five.'; }));
  ok('a paraphrased bullet: that text only, and the document\'s own bullet is the nearest line', para.length === 1 && para[0].path === 'work.0.highlights.0' && para[0].near === `• ${bullet}`, JSON.stringify(para));

  const typo = docText.replace('suppliers', 'supliers');
  const fixed = missing(jr, typo);
  ok('a corrected typo: that text only, with the document\'s line as written', fixed.length === 1 && fixed[0].near.includes('supliers') && fixed[0].text.includes('suppliers'), JSON.stringify(fixed));

  const date = missing(edit(j => { j.work[0].startDate = '2031-03'; }));
  ok('an invented year: that date only', date.length === 1 && date[0].path === 'work.0.startDate', JSON.stringify(date));
  const dates = (json, text) => missing({ work: [{ startDate: json }] }, text).length;
  ok('a month: found as a name in any interface language or as a number with its year, missing when the document has no such month',
    dates('2019-03', 'March 2019 – June 2021') === 0 && dates('2019-03', '2019. március – 2021. június') === 0 && dates('2019-03', '03/2019 – 06/2021') === 0 && dates('2019-03', '3.2019') === 0
    && dates('2019-04', 'March 2019 – June 2021') === 1 && dates('2019-04', '03/2019 – 06/2021') === 1 && dates('2018-03', 'March 2019') === 1 && dates('2019', 'since 2019') === 0 && dates('2019', 'since 2020') === 1);

  const [a, b] = jobs[0].highlights.slice(1, 3);
  const merged = missing(edit(j => { j.work[0].highlights.splice(1, 2, `${a} ${b}`); }));
  ok('two bullets run into one: that text only, and it is no line of the document', merged.length === 1 && merged[0].path === 'work.0.highlights.1' && merged[0].near !== null, JSON.stringify(merged));
  ok('...even with the two joined as they stand, one after the other', missing(edit(j => { j.work[0].highlights.splice(1, 2, `${a.replace(/\.$/, '')}. ${b}`); })).length === 1);
  ok('a text from nowhere has no nearest line', (r => r.length === 1 && r[0].near === null)(missing(edit(j => { j.basics.label = 'Zzqx'; }))));
}

section('quotes, dashes and line-end hyphens are not changes (normText)');
{
  const doc = ['He said "it\'s a 2-3 day test" - and left.', 'Cut the weight of the inha-', 'ler body by a third.', 'Built the two-', 'stage tool.', 'Ten ﬁne parts', 'Café   worker'].join('\n');
  const found = t => check({ work: [{ highlights: [t] }] }, doc)[0].found;
  ok('curly quotes against straight ones', found('He said “it’s a 2-3 day test” - and left.'));
  ok('en and em dashes against hyphens, a final full stop and spaces', found('He said “it’s a 2–3 day test” — and left') && found('Café worker.'));
  ok('a word split at a line end, joined or with its hyphen', found('Cut the weight of the inhaler body by a third.') && found('Built the two-stage tool.') && found('Built the twostage tool.'));
  ok('a ligature', found('Ten fine parts'));
  ok('a word changed is still missing, and so is a text over two lines with no hyphen', !found('Cut the weight of the inhaler body by a half.') && !found('Ten fine parts Café worker'));
}

section('the merge items: a missing text starts unticked, with the nearest line');
{
  const doc = { id: 'doc-1', name: 'Old CV 2023.pdf', text: docText };
  const mine = clone(jr); mine.work.forEach(w => w.highlights.pop()); delete mine.basics.phone;      // a career that lacks the last bullet of each job, and the phone
  const mineModel = fromJsonResume(mine).model;
  const items = json => diffRecords(mineModel, fromJsonResume(json).model);
  const lines = its => its.filter(x => x.kind === 'add' && x.as === 'line');
  ok('the fixture: one new line per job, and the phone', lines(items(jr)).length === 2 && items(jr).length === 4);

  const clean = items(jr); X.checkItems(clean, jr, doc, mineModel);
  ok('a file word for word: nothing flagged, the new lines stay ticked', clean.every(x => !x.notIn) && lines(clean).every(x => x.on));

  const bad = edit(j => { j.work[0].highlights[3] = 'Ran the weekly design reviews with the toolmaker, which cut the number of tooling changes by half.'; });
  const flagged = items(bad); X.checkItems(flagged, bad, doc, mineModel);
  const [one] = flagged.filter(x => x.notIn);
  ok('a paraphrased line: that item only is unticked and names the document', flagged.filter(x => x.notIn).length === 1 && one.on === false && one.notIn === doc.name && lines(flagged).filter(x => x.on).length === 1);
  const orig = `• ${jobs[0].highlights[3]}`;
  ok('...shown as a word diff against the document\'s nearest line', one.diff?.some(r => r.op === '-') && one.diff.some(r => r.op === '+') && one.diff.filter(r => r.op !== '+').map(r => r.text).join('') === orig, JSON.stringify(one.diff));
  ok('...and the other items keep their ticks', flagged.filter(x => !x.notIn).every(x => x.on));

  const phone = edit(j => { j.basics.phone = j.basics.phone.replace(/0$/, '7'); }), byPhone = items(phone); X.checkItems(byPhone, phone, doc, mineModel);
  ok('a plain value too: an invented phone number unticks the items that would add it (the value and the contact block), the lines found stay ticked', byPhone.filter(x => x.notIn).length === 2 && byPhone.some(x => x.notIn && !x.as) && lines(byPhone).every(x => x.on));

  const typo = items(jr); X.checkItems(typo, jr, { ...doc, text: docText.replace(jobs[1].highlights[3], jobs[1].highlights[3].replace(/\b(\w{6,})\b/, '$1x')) }, mineModel);
  ok('a corrected typo flags its line', typo.filter(x => x.notIn).length === 1);

  const none = items(jr); X.checkItems(none, jr, null, mineModel);
  ok('with no document: nothing starts ticked', none.length > 2 && none.every(x => x.on === false));
  const both = items(jr); X.checkItems(both, jr, doc, mineModel);
  ok('with a document and every text found, the items keep their own ticks (the check is what unticks)', both.some(x => x.on));
}

section('which document: meta.source names it');
{
  const st = { documents: [{ id: 'doc-1', name: 'Old CV 2023.pdf', text: 'x' }, { id: 'doc-2', name: 'Other.pdf', text: 'y' }, { id: 'doc-3', name: 'Scan.pdf', text: '' }] };
  const src = name => ({ meta: { source: name } });
  ok('by its file name, whatever the case or the folder', DOC.sourceOf(st, src('old cv 2023.PDF'))?.id === 'doc-1' && DOC.sourceOf(st, src('C:\\Users\\x\\Old CV 2023.pdf'))?.id === 'doc-1' && DOC.sourceOf(st, src('~/cv/Old CV 2023.pdf'))?.id === 'doc-1');
  ok('a name the Library does not hold, none, or a document with no text: no document', !DOC.sourceOf(st, src('Nope.pdf')) && !DOC.sourceOf(st, {}) && !DOC.sourceOf(st, src('')) && !DOC.sourceOf(st, src('Scan.pdf')) && !DOC.sourceOf({}, src('Other.pdf')));
}

process.exit(failed ? 1 : 0);
