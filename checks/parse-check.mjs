#!/usr/bin/env node
// node checks/parse-check.mjs
// src/parse/: text items in, JSON Resume out (a port of OpenResume's parser). One column, two columns, headings and dates in
// Hungarian and German given a lexicon built from the catalogue, a line that fits nowhere is left over, every text is traced
// to a page and a line, and nothing in src/parse/ imports from the rest of src/.
// The items are written by hand for invented people (checks/lib/parse-fixtures.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import { parseResume } from '../src/parse/index.js';
import { splitColumns, layoutOf } from '../src/parse/split-columns.js';
import { lexiconFor, fromJsonResume } from '../src/model/import.js';
import { loadCatalogue } from '../src/i18n/index.js';
import * as F from './lib/parse-fixtures.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const J = x => JSON.stringify(x);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);
await Promise.all(['hu', 'de'].map(loadCatalogue));

section('one column');
{
  const input = structuredClone(F.oneColumn);
  const got = parseResume(F.oneColumn);
  ok('the name, contact, summary, three jobs with dates and bullets, education and skills come out as JSON Resume', eq(got.jsonResume, F.oneColumnExpected), J(got.jsonResume));
  ok('the input items are left as they were', eq(F.oneColumn, input));
  ok('a line that fits nowhere is left over, with its section, page and line', eq(got.leftovers, [{ text: 'Available on request from the director', section: 'REFERENCES', page: 1, line: 25 }]), J(got.leftovers));
  const at = p => got.trace.find(x => x.path === p);
  ok('the name is traced to page 1, line 1, and the second bullet of the first job to line 9', eq(at('basics.name'), { path: 'basics.name', page: 1, line: 1 }) && eq(at('work.0.highlights.1'), { path: 'work.0.highlights.1', page: 1, line: 9 }), J(at('work.0.highlights.1')));
  ok('both dates of a job are traced to the line they were on', at('work.2.startDate')?.line === 13 && at('work.2.endDate')?.line === 13);
  const words = [...F.oneColumnExpected.work.flatMap(w => w.highlights.map((_, k) => `work.${F.oneColumnExpected.work.indexOf(w)}.highlights.${k}`)), 'education.0.institution', 'basics.summary'];
  ok('every bullet, the school and the summary have a trace', words.every(p => at(p)), words.filter(p => !at(p)).join(', '));
  ok('no items give an empty resume and a doubt about the name, not an error', eq(parseResume([]), { jsonResume: { basics: {} }, trace: [], leftovers: [], layout: [], doubts: [{ kind: 'name' }] }));
  const back = fromJsonResume(got.jsonResume);
  ok('the output goes through fromJsonResume: three jobs, five bullets, the name', back.model.work.length === 3 && back.model.work.flatMap(w => w.highlights).length === 5 && back.model.basics.name === 'Jane Q. Sample', J(back.review.rows));
  const en = parseResume(F.oneColumn, lexiconFor('en'));
  ok('the English lexicon built from the catalogue gives the same result as none', eq(en, got));
}

section('two columns');
{
  const got = parseResume(F.twoColumns);
  const want = structuredClone(F.oneColumnExpected);
  want.education = [{ institution: 'Lakeside State University', studyType: 'Bachelor of Science', score: '3.8', startDate: '2010', endDate: '2014' }];
  want.skills = [{ name: 'CAD', keywords: ['SolidWorks', 'Fusion 360'] }, { name: 'Fabrication', keywords: ['3D printing'] }];
  ok('a header over a sidebar of skills and education beside the experience comes out as the same resume', eq(got.jsonResume, want), J(got.jsonResume));
  ok('and leaves nothing over', got.leftovers.length === 0, J(got.leftovers));
  const order = splitColumns(F.twoColumns).filter(i => i.hasEOL).map(i => i.text);
  ok('the left column is read first, top to bottom, then the right', order.indexOf('GPA: 3.8') < order.indexOf('WORK EXPERIENCE') && order.indexOf('SKILLS') < order.indexOf('EDUCATION') && order.indexOf('Mar 2021 – Present') < order.indexOf('2018 – 2021'), order.join(' | '));
  ok('a column is made only of whole lines: each ends with an end-of-line item', splitColumns(F.twoColumns).filter(i => i.hasEOL).length === 24);
  ok('one column is not split (the very same items come back)', splitColumns(F.oneColumn) === F.oneColumn);
  const centred = F.oneColumn.map(i => (i.y >= 732 ? { ...i, x: i.x + 150 } : i));
  ok('a centred header over one column does not make a column', splitColumns(centred) === centred && eq(parseResume(centred).jsonResume.work, F.oneColumnExpected.work));
  const dates = parseResume(F.datesAlone).jsonResume;
  ok('dates alone on right-aligned lines, with short bullets, are not a column: every job keeps its dates', eq(dates.work, F.datesAloneWork) && splitColumns(F.datesAlone) === F.datesAlone, J(dates.work));
  const short = parseResume(F.shortColumns).jsonResume;
  ok('a full-width header over two short columns is still a header: the columns are split', eq(short.work, F.shortColumnsWork) && eq(short.skills, F.shortColumnsSkills) && short.basics.name === 'Jane Q. Sample', J(short));
  const centredOver = parseResume(F.centredOverColumns).jsonResume;
  ok('a centred header over two columns stays first, though its first item is inside the right column', centredOver.basics.name === 'Jane Q. Sample' && centredOver.basics.email === 'jane.sample@example.com' && eq(centredOver.work, F.shortColumnsWork) && eq(centredOver.skills, F.shortColumnsSkills), J(centredOver));
  const places = parseResume(F.placesAlone);
  ok('places alone on right-aligned lines, with short bullets, are not a column: every job keeps its title', eq(places.jsonResume.work, F.placesAloneWork) && splitColumns(F.placesAlone) === F.placesAlone, J(places.jsonResume.work));
  ok('and the places themselves are the lines left over', eq(places.leftovers.map(x => x.text), ['Springfield, IL', 'Dayton, OH', 'Austin, TX']), J(places.leftovers));
  const varied = parseResume(F.variedStarts).jsonResume;
  ok('columns whose lines start at slightly different x are still two columns', eq(varied.work, F.variedStartsWork) && eq(varied.skills, F.shortColumnsSkills), J(varied));
  const over = parseResume(F.headerOverShort).jsonResume;
  ok('a left-aligned header of wide lines over a short sidebar does not stop the split', eq(over.work, [{ name: 'Northgate Dosing Systems', position: 'Mechanical Design Engineer', startDate: '2021-03' }]) && eq(over.skills, [{ name: 'CAD', keywords: ['SolidWorks'] }]) && over.basics.name === 'Jane Q. Sample', J(over));
}

section('the layout: guessed when sure, given by hand, and doubts');
{
  const colDoubts = items => layoutOf(items).doubts;
  const two = parseResume(F.twoColumns);
  ok('a header over two columns is split by the guess, and the layout used is returned: the header band and the cut', two.layout.length === 1 && two.layout[0].page === 1 && two.layout[0].split === 200 && two.layout[0].headerBottom > 700 && two.layout[0].headerBottom < 720, J(two.layout));
  ok('a page that is split and read right has no doubt', eq(two.doubts, []), J(two.doubts));
  const right = parseResume(F.rightSidebar);
  ok('a sidebar at the right, under a header, is split too', right.layout[0].split === 420 && eq(right.jsonResume.work, F.shortColumnsWork) && eq(right.jsonResume.skills, F.shortColumnsSkills) && eq(right.doubts, []), J(right.layout) + J(right.jsonResume.work));
  for (const [name, items] of [['one column with the indented lines of a list', F.indented], ['one column with places alone on right-aligned lines', F.placesAlone]]){
    const got = parseResume(items);
    ok(`${name}: read as one column, and the column that was seen is a doubt`, splitColumns(items) === items && got.layout[0].split === undefined && got.doubts.some(d => d.kind === 'columns' && d.page === 1), J(got.layout) + J(got.doubts));
  }
  const ind = parseResume(F.indented).jsonResume.work;
  ok('and the jobs are read with their titles and dates', eq(ind.map(w => [w.name, w.position, w.startDate]), [['Northgate Dosing Systems', 'Mechanical Design Engineer', '2021-03'], ['Helix Diagnostics', 'Product Development Engineer', '2018']]), J(ind));
  const unpaired = parseResume(F.unpairedColumns);
  ok('columns whose rows never meet are not trusted: one column and a doubt', unpaired.layout[0].split === undefined && unpaired.doubts.some(d => d.kind === 'columns'), J(unpaired.layout));
  const byHand = parseResume(F.unpairedColumns, undefined, F.unpairedLayout);
  ok('a layout given by hand splits that page: a full-width header, then the columns', eq(byHand.layout, F.unpairedLayout) && eq(byHand.jsonResume.work, F.shortColumnsWork) && eq(byHand.jsonResume.skills, F.shortColumnsSkills) && byHand.jsonResume.basics.name === 'Jane Q. Sample' && !byHand.doubts.some(d => d.kind === 'columns'), J(byHand.jsonResume));
  const one = parseResume(F.twoColumns, undefined, [{ page: 1 }]);
  ok('one column given by hand overrides a guessed split', eq(one.layout, [{ page: 1 }]) && splitColumns(F.twoColumns, one.layout) === F.twoColumns && !eq(one.jsonResume.work, two.jsonResume.work), J(one.layout));
  ok('a page the layout does not name is still guessed', eq(parseResume(F.twoColumns, undefined, [{ page: 2 }]).layout.map(l => l.page), [1]) && parseResume(F.twoColumns, undefined, [{ page: 2 }]).layout[0].split === 200);
  ok('a header that starts where the columns do is split, with a doubt, not silently', layoutOf(F.headerAtColumn).doubts.length === 1, J(layoutOf(F.headerAtColumn)));
  // a header of H wide lines over a sidebar of S lines and a main column of M lines: a split is read right, and anything else is a doubt
  const long = 'A long full width header line that runs across both columns of the sheet to the right edge';
  let wrong = [], cells = 0;
  for (const M of [6, 25]) for (let H = 1; H <= 7; H++) for (let S = 1; S <= 8; S++){
    const head = F.flow(36, 760, [[[0, 'Jane Q. Sample', true]], ...Array.from({ length: H }, () => [[0, long]])]);
    const side = F.flow(36, 600, Array.from({ length: S }, (_, i) => [[0, 'Side item ' + i]]));
    const main = F.flow(200, 600, Array.from({ length: M }, (_, i) => [[0, 'Main text line number ' + i]]));
    const all = [...head, ...side, ...main].sort((a, b) => b[0].y - a[0].y || a[0].x - b[0].x).flat();
    const out = splitColumns(all), texts = out.filter(i => i.hasEOL).map(i => i.text);
    const want = [...head, ...side, ...main].map(l => l[0].text);
    cells++;
    if (out !== all ? J(texts) !== J(want) : colDoubts(all).length === 0) wrong.push(`H${H} S${S} M${M}`);
  }
  ok(`${cells} headers over short and long columns: each is split into header, left, right, or read as one column with a doubt`, wrong.length === 0, wrong.join(' '));
}

section('doubts after the reading');
{
  const names = items => parseResume(items).doubts.map(d => d.kind);
  ok('a resume that reads well has none', eq(parseResume(F.oneColumn).doubts, []));
  ok('jobs with no date are a doubt, counted', eq(parseResume(F.undated).doubts.filter(d => d.kind === 'dates'), [{ kind: 'dates', n: 2 }]), J(parseResume(F.undated).doubts));
  ok('no name is a doubt', names(F.noName).includes('name'));
  ok('many lines that went nowhere are a doubt', names(F.manyLeftovers).includes('leftovers'), J(parseResume(F.manyLeftovers).doubts));
}

section('another language');
{
  const hu = parseResume(F.hungarian, lexiconFor('hu')).jsonResume;
  ok('Hungarian headings, months and "present" read with a lexicon built from the Hungarian catalogue',
    eq(hu.work, [
      { name: 'Dunai Műszer Kft.', position: 'Senior Engineer', startDate: '2019-03', highlights: ['Vezette az inhalátor adagolószámlálójának átalakítását.', 'Harmadával csökkentette az adagolószivattyú alkatrészeinek számát.'] },
      { name: 'Tisza Diagnosztika Zrt.', position: 'Product Technician', startDate: '2016-09', endDate: '2019-02', highlights: ['Elvégezte a tűréselemzést három beszállítóval.'] },
    ]) && eq(hu.skills, [{ name: 'CAD', keywords: ['SolidWorks', 'Fusion 360'] }]) && eq(hu.education?.[0], { studyType: 'Gépészmérnök BSc', startDate: '2010', endDate: '2014' }), J(hu));
  ok('a name with accents is a name, and the profile is not taken for a summary', hu.basics.name === 'Kovács Éva' && hu.basics.summary === undefined, J(hu.basics));
  const plain = parseResume(F.hungarian).jsonResume;
  ok('without the lexicon the same file has no work (the English words do not fit)', plain.work === undefined, J(plain.work));
  const de = parseResume(F.german, lexiconFor('de')).jsonResume;
  ok('German: "Werdegang" is the experience, "März 2020 – heute" is an open date from 2020-03', eq(de.work, [{ name: 'Rheinwerk Messtechnik GmbH', position: 'Design Engineer', startDate: '2020-03', highlights: ['Entwarf die Messkammer für das neue Dosiergerät.'] }]), J(de.work));
  const lex = lexiconFor('hu');
  ok('the lexicon holds twelve months, January first, and the catalogue’s own word for "present"', lex.months.length === 12 && lex.months[0] === 'január' && lex.present.includes('jelenleg'));
}

section('words that only look like dates, and bullets that open alike');
{
  const got = parseResume(F.lookalikes);
  ok('"Springfield", "Sales Representative" and "Doctor of Philosophy" are not a season, "present" or a month: the dates are the dates', eq(got.jsonResume, F.lookalikesExpected), J(got.jsonResume));
  const lines = [0, 1, 2].map(k => got.trace.find(x => x.path === `work.0.highlights.${k}`)?.line);
  ok('three bullets that open with the same words are traced to three lines', eq(lines, [7, 8, 9]), J(lines));
  ok('a line that only holds a text an extractor took is left over, and so is one it could not read', eq(got.leftovers.map(x => x.text), ['Doctor of Philosophy', 'Ask Jane about Lakeside State University']), J(got.leftovers));
  const de = parseResume(F.maier, lexiconFor('de')).jsonResume.work[0];
  ok('German "Mai" is a month only as a whole word: "Maier Messtechnik GmbH" is a company, not the date', de.name === 'Maier Messtechnik GmbH' && de.startDate === '2020' && de.endDate === '2022', J(de));
  const hu = parseResume(F.capitals, lexiconFor('hu')).jsonResume.work[0];
  ok('a capitalised Hungarian "Március" and "Jelenleg" are still found', hu.startDate === '2019-03' && hu.endDate === undefined, J(hu));
}

section('what was changed from OpenResume, one case each');
{
  let blank; try { blank = parseResume(F.withBlankLines).jsonResume; } catch (e){ blank = e.message; }
  ok('an empty line inside a section is dropped, not read (it has no first item to throw on)', eq(blank, F.oneColumnExpected), J(blank));
  ok('two bullets in one item are both extracted, so the line is not left over', eq(parseResume(F.twoBullets).leftovers, []) && eq(parseResume(F.twoBullets).jsonResume.work[0].highlights, ['Ran the study', 'Wrote the report']), J(parseResume(F.twoBullets)));
  const mixed = parseResume(F.bulletsMixed);
  ok('a bullet of its own, a wrapped one, two in one item and an unknown glyph: every line was used', eq(mixed.leftovers, []) && mixed.jsonResume.work[0].highlights.includes('Ran the study'), J(mixed.leftovers));
  ok('a name with accents, not bold, is a name', parseResume(F.accentedName).jsonResume.basics.name === 'Éva Kovács');
  const own = { sections: { work: ['önéletrajz'] }, titleWords: ['önéletrajz'] };
  const w = parseResume(F.capitalHeading, own).jsonResume.work;
  ok('a heading that starts with a capital that is not ASCII, not bold, is a section title', w?.length === 1 && w[0].name === 'Northgate Dosing Systems', J(w));
}

section('src/parse/ stands alone');
{
  const files = [];
  (function walk(d){ for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name)); })(path.join(REPO, 'src/parse'));
  const js = files.filter(f => f.endsWith('.js'));
  const outside = js.flatMap(f => [...fs.readFileSync(f, 'utf8').matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|^import\s+)['"]([^'"]+)['"]/gm)]
    .map(m => m[1]).filter(s => !s.startsWith('.') || !path.resolve(path.dirname(f), s).startsWith(path.join(REPO, 'src/parse') + path.sep)).map(s => `${path.relative(REPO, f)} imports ${s}`));
  ok('no file in src/parse/ imports anything from outside it', outside.length === 0, outside.join('; '));
  const names = js.map(f => path.relative(path.join(REPO, 'src/parse'), f)).sort();
  const ported = ['index.js', 'group-text-items-into-lines.js', 'group-lines-into-sections.js', ...['index', 'extract-education', 'extract-profile', 'extract-project', 'extract-skills', 'extract-work-experience'].map(n => `extract-resume-from-sections/${n}.js`),
    ...['bullet-points', 'common-features', 'feature-scoring-system', 'get-section-lines', 'subsections'].map(n => `extract-resume-from-sections/lib/${n}.js`)];
  ok('every OpenResume file is ported under its own name (read-pdf and types are not)', ported.every(n => names.includes(n)), ported.filter(n => !names.includes(n)).join(', '));
  const head = f => fs.readFileSync(f, 'utf8').split('\n')[0];
  const bad = js.filter(f => !/^\/\/ (Ported from OpenResume by Xitang Zhao \(AGPL-3\.0\), src\/app\/lib\/parse-resume-from-pdf\/\S+, commit [0-9a-f]{40}; modified for BrewCV \d{4}-\d{2}-\d{2}: \S.*$|Not from OpenResume)/.test(head(f)));
  ok('each file names its OpenResume author, source and commit, and what BrewCV changed, or says it is not from OpenResume', bad.length === 0, bad.map(f => path.relative(REPO, f)).join(', '));
  ok('the files that are not from OpenResume are the column split and the JSON Resume mapping', J(names.filter(n => head(path.join(REPO, 'src/parse', n)).startsWith('// Not from'))) === J(['split-columns.js', 'to-json-resume.js']), names.join(', '));
  ok('the README credits OpenResume and names where the port is', /OpenResume[^\n]*src\/parse/.test(fs.readFileSync(path.join(REPO, 'README.md'), 'utf8')) && fs.existsSync(path.join(REPO, 'src/parse/README.md')));
}

console.log(failed ? `\n${failed} parse check(s) FAILED` : '\nall parse checks passed');
process.exit(failed ? 1 : 0);
