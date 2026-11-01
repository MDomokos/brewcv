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
import { identify } from '../src/parse/identify.js';
import { unzip } from '../src/parse/unzip.js';
import { readDocx } from '../src/parse/docx.js';
import { readOdt } from '../src/parse/odt.js';
import { readHtml } from '../src/parse/html.js';
import { readMd } from '../src/parse/md.js';
import { readTxt } from '../src/parse/txt.js';
import { readPages } from '../src/parse/pages.js';
import { readLinkedin } from '../src/parse/linkedin.js';
import { readPdf } from '../src/parse/pdf.js';
import { parseCsv } from '../src/parse/csv.js';
import { clean, itemsOf } from '../src/parse/lines.js';
import { groupLinesIntoSections } from '../src/parse/group-lines-into-sections.js';
import { withEnglish } from '../src/parse/lexicon.js';
import { lexiconFor, fromJsonResume } from '../src/model/import.js';
import { normText } from '../src/model/record.js';
import { sameDocument } from '../src/model/documents.js';
import { resolve } from '../src/model/resume.js';
import { readLibrary, readRecipe } from '../scripts/lib/library.mjs';
import { loadCatalogue } from '../src/i18n/index.js';
import * as F from './lib/parse-fixtures.mjs';
import * as R from './lib/reader-fixtures.mjs';
import { pdf } from './lib/pdf.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const J = x => JSON.stringify(x);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);
// a document's text as the Library will keep it: the lines of the items, an item's text joined by a space, one line per row
const textOf = items => { const out = []; let line = []; for (const i of items){ line.push(i.text); if (i.hasEOL){ out.push(line.join(' ')); line = []; } } return out.join('\n'); };
await Promise.all(['hu', 'de', 'it'].map(loadCatalogue));

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

section('what a file is: by its bytes, whatever its name');
{
  const enc = s => new TextEncoder().encode(s);
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10), jpg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 16), gif = enc('GIF89a'), webp = enc('RIFF\0\0\0\0WEBPVP8 ');
  const ole = Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0);      // an old .doc
  const cases = [
    ['a PDF named .docx', enc('%PDF-1.7\n1 0 obj\n'), 'a.docx', 'pdf'], ['a PDF with some bytes before its header', enc('junk\n%PDF-1.4\n'), 'a.txt', 'pdf'],
    ['a Word file named .pdf', R.word(), 'a.pdf', 'docx'], ['a Google Docs file named .txt', R.google(), 'a.txt', 'docx'],
    ['an ODT named .docx', R.odt(), 'a.docx', 'odt'],
    ['a Pages file named .pdf, though its first entry is a stored PDF', R.pages(), 'a.pdf', 'pages'],
    ['a LinkedIn export named .docx', R.linkedin(), 'a.docx', 'linkedin'], ['a LinkedIn export with other names for its files', R.linkedin(true), 'x.zip', 'linkedin'],
    ['an HTML page named .md', enc(R.html()), 'a.md', 'html'], ['an HTML fragment named .txt', enc('<h1>Jane</h1><p>Engineer</p>'), 'a.txt', 'html'],
    ['Markdown named .txt', enc(R.md()), 'a.txt', 'md'], ['text with no Markdown named .md: the name breaks the tie', enc('Jane\nEngineer\n'), 'a.md', 'md'],
    ['the same text named .txt', enc('Jane\nEngineer\n'), 'a.txt', 'txt'], ['text with no name', enc('Jane\nEngineer\n'), undefined, 'txt'],
    ['JSON named .txt', enc('{"basics":{"name":"Jane"}}'), 'a.txt', 'json'], ['text that opens with a bracket but is not JSON', enc('[Jane] is an engineer'), 'a.json', 'txt'],
    ['UTF-16 text', Uint8Array.of(0xff, 0xfe, 74, 0, 97, 0, 110, 0, 101, 0), 'a.pdf', 'txt'],
    ['a PNG named .pdf', png, 'a.pdf', 'image'], ['a JPEG', jpg, 'a.txt', 'image'], ['a GIF', gif, 'a.txt', 'image'], ['a WebP', webp, 'a.txt', 'image'],
    ['an old .doc: an OLE file with the stream name WordDocument', Uint8Array.of(...ole, ...new TextEncoder().encode('W\0o\0r\0d\0D\0o\0c\0u\0m\0e\0n\0t\0')), 'a.docx', 'doc'], ['an OLE file with no Word stream (an old .xls)', ole, 'a.xls', 'other'],
    ['a Numbers file reads as Pages (it holds the same parts, and gets the advice to save a PDF)', R.zip({ 'Index/Document.iwa': 'x', 'Index/CalculationEngine.iwa': 'x', 'Index/Tables/Tile.iwa': 'x' }), 'a.numbers', 'pages'], ['a Keynote file', R.zip({ 'Index/Document.iwa': 'x', 'Index/Slide.iwa': 'x', 'QuickLook/Preview.jpg': 'x' }), 'a.key', 'other'], ['a modern Pages file: its preview is a picture, but it is a Pages file', R.zip({ 'QuickLook/Preview.jpg': 'x', 'Index/Document.iwa': 'x' }), 'a.pages', 'pages'], ['a real one-column Pages file, as Pages 15 writes it: it holds CalculationEngine.iwa', R.zip(Object.fromEntries(['Data/PresetImageFill0-24.jpg', 'Data/bullet_gbutton_gray-30.png', 'Index/Document.iwa', 'Index/ViewState.iwa', 'Index/CalculationEngine.iwa', 'Index/DocumentStylesheet.iwa', 'Index/AnnotationAuthorStorage.iwa', 'Index/DocumentMetadata.iwa', 'Index/Metadata.iwa', 'Metadata/Properties.plist', 'Metadata/DocumentIdentifier', 'Metadata/BuildVersionHistory.plist', 'preview.jpg', 'preview-micro.jpg', 'preview-web.jpg'].map(n => [n, 'x']))), 'cv.pages', 'pages'],
    ['a real two-column Pages file: a layout table adds Index/Tables/', R.zip(Object.fromEntries(['Index/Document.iwa', 'Index/ViewState.iwa', 'Index/CalculationEngine.iwa', 'Index/Tables/Tile.iwa', 'Index/Tables/DataList.iwa', 'Index/Tables/DataList-1732801-2.iwa', 'Index/Tables/HeaderStorageBucket.iwa', 'Index/DocumentStylesheet.iwa', 'Metadata/Properties.plist', 'preview.jpg'].map(n => [n, 'x']))), 'cv2.pages', 'pages'],
    ['a ZIP with nothing we read', R.zip({ 'a.bin': 'x' }), 'a.docx', 'other'], ['bytes that are not text', Uint8Array.of(1, 2, 0, 3, 0, 0), 'a.txt', 'other'],
  ];
  for (const [what, bytes, name, want] of cases){ const got = identify(bytes, name); ok(`${what}: ${want}`, got === want, got); }
}

section('unzip: stored and deflated entries, and what it refuses');
{
  const text = 'six words in one line\n'.repeat(5000);      // 110 KB
  const file = R.zip({ 'a.txt': 'stored', 'dir/b.txt': await R.deflated(text) });
  const z = unzip(file);
  ok('the central directory lists both entries', J(z.names) === J(['a.txt', 'dir/b.txt']));
  ok('a stored entry (method 0) is read as it is', new TextDecoder().decode(await z.read('a.txt')) === 'stored');
  ok('a deflated entry (method 8, made here with CompressionStream) inflates to the text', new TextDecoder().decode(await z.read('dir/b.txt')) === text);
  ok('an entry that is not there is null', await z.read('c.txt') === null);
  const inside = new Uint8Array(file.length + 20); inside.set(file, 7);
  ok('a file that starts in the middle of a buffer (as Node reads small files) is read the same', new TextDecoder().decode(await unzip(inside.subarray(7, 7 + file.length)).read('a.txt')) === 'stored');
  const code = async f => { try { await f(); return 'none'; } catch (e){ return e.code; } };
  const patched = (at, bytes) => { const f = R.zip({ 'a.txt': 'x' }); const end = f.length - 22; f.set(bytes, end + at); return f; };
  ok('ZIP64 is refused with a clear error', await code(() => unzip(patched(10, [0xff, 0xff]))) === 'zip64');
  const small = R.zip({ 'a.txt': 'x' }), loc = new Uint8Array(20); loc.set([0x50, 0x4b, 0x06, 0x07]);
  const withLocator = new Uint8Array(small.length + 20); withLocator.set(small.subarray(0, small.length - 22)); withLocator.set(loc, small.length - 22); withLocator.set(small.subarray(small.length - 22), small.length - 2);
  ok('a ZIP64 end-of-directory locator in front of the end record is refused too', await code(() => unzip(withLocator)) === 'zip64' && unzip(small).names.length === 1);
  ok('an encrypted entry is refused when it is read, with a clear error', await code(async () => unzip(R.zip({ 'a.txt': 'x' }, { flags: 1 })).read('a.txt')) === 'encrypted');
  ok('a compression method it does not read is refused', await code(async () => unzip(R.zip({ 'a.txt': { method: 12, data: Uint8Array.of(1), size: 1 } })).read('a.txt')) === 'method');
  ok('bytes that are not a ZIP are refused', await code(() => unzip(new TextEncoder().encode('not a zip file at all, no end record here'))) === 'zip');
  ok('deflate data that is damaged is refused', await code(async () => unzip(R.zip({ 'a.txt': { method: 8, data: Uint8Array.of(7, 7, 7, 7), size: 9 } })).read('a.txt')) === 'zip');
  ok('an entry that inflates to more than 64 MB is cut off', await code(async () => unzip(R.zip({ 'a.txt': await R.deflated(new Uint8Array(70 * 1024 * 1024)) })).read('a.txt')) === 'big');
}

section('text with no page positions: whole lines, one column, and the same resume from every format');
{
  const enc = s => new TextEncoder().encode(s);
  const readers = {
    'Word': () => readDocx(R.word()), 'Google Docs': () => readDocx(R.google()), 'ODT': () => readOdt(R.odt()),
    'HTML': () => readHtml(enc(R.html())), 'Markdown': () => readMd(enc(R.md())), 'plain text': () => readTxt(enc(R.txt())),
  };
  const items = {}, texts = {};
  for (const [name, read] of Object.entries(readers)){
    items[name] = await read();
    const got = parseResume(items[name]);
    ok(`${name}: the one-column resume of the parser check comes out as the same JSON Resume`, eq(got.jsonResume, F.oneColumnExpected), J(got.jsonResume));
    ok(`${name}: no leftovers, no doubt, and no column guessed`, got.leftovers.length === 0 && got.doubts.length === 0 && got.layout.every(l => l.split === undefined), J(got.doubts) + J(got.leftovers));
    texts[name] = textOf(items[name]);
  }
  const m = items['Markdown'];
  ok('the items are in reading order, one line each: y falls by one a line, a line starts at x 0, no page', m.every((i, k) => !k || i.y <= m[k - 1].y) && m.filter((i, k) => !k || m[k - 1].hasEOL).every(i => i.x === 0) && m.every(i => i.page === undefined && i.height === 10));
  const ys = [...new Set(items['HTML'].map(i => i.y))];
  ok('HTML: the line breaks between tags leave no blank lines (y falls by one a line), while the other formats keep the blank line between jobs', ys.every((y, k) => y === -k) && new Set(items['Markdown'].map(i => i.y)).size === items['Markdown'].filter(i => i.hasEOL).length && Math.min(...items['Markdown'].map(i => i.y)) < -items['Markdown'].filter(i => i.hasEOL).length);
  ok('a list item opens with a bullet glyph, in every format', Object.values(texts).every(t => t.split('\n').filter(l => l.startsWith('• ')).length === 5));
  const titles = n => items[n].filter(i => i.title).map(i => i.text).join();
  ok('a heading is a section title in Word, Google Docs, ODT, HTML and Markdown (the # of the name is not, it is on the first line), and nothing is in plain text', ['Word', 'Google Docs', 'ODT', 'HTML'].every(n => titles(n) === 'Work Experience,Education,Skills') && titles('Markdown') === 'Work Experience,Education,Skills' && titles('plain text') === '');
  // whole lines: the formats agree on every line, so another format of one resume is found by its lines (sameDocument, 90% both ways)
  const state = { documents: [{ id: 'doc-w', text: texts['Word'] }] };
  for (const [name, text] of Object.entries(texts)) ok(`${name}: its lines are the Word file's lines, so sameDocument links it to it`, sameDocument(state, text)?.id === 'doc-w', name);
  ok('another resume is not linked', sameDocument(state, textOf(F.hungarian)) === null);
}

section('Word and Google Docs write headings and lists their own way');
{
  const title = items => items.filter(i => i.title).map(i => i.text);
  const word = await readDocx(R.word()), google = await readDocx(R.google());
  ok('Word: a Heading 1 (a style, not bold in the file) is a bold section title; a bold run is bold; a list number is a bullet', J(title(word)) === J(['Work Experience', 'Education', 'Skills']) && word.filter(i => i.title).every(i => i.fontName === 'Sans-Bold') && word.find(i => i.text === 'Northgate Dosing Systems').fontName === 'Sans-Bold' && word.find(i => i.text.startsWith('• Led')));
  ok('Word: a word cut into two runs by the proofing marker, a hyperlink and a right tab stop (which is no tab) read as the text they are', word.find(i => i.text === 'Northgate Dosing Systems') && word.some(i => i.text === 'jane.sample@example.com') && word.find(i => i.text === 'Mar 2021 – Present'));
  ok('Google Docs: a style named "normal", a heading whose runs say bold off, runs that say <w:b w:val="0"/> and <w:bCs w:val="0"/>, list items with a list number', J(title(google)) === J(['Work Experience', 'Education', 'Skills']) && google.filter(i => i.title).every(i => i.fontName === 'Sans-Bold') && google.find(i => i.text === 'Mechanical Design Engineer').fontName === 'Sans' && google.find(i => i.text === 'Northgate Dosing Systems').fontName === 'Sans-Bold' && google.filter(i => i.text.startsWith('• ')).length === 5);
  ok('Google Docs: the dates are items of their own after the tab', google.find(i => i.text === '2018 – 2021') && google.find(i => i.text === '2018 – 2021').x > 100);
  const de = title(await readDocx(R.word(undefined, { heading: 'berschrift1' })));
  ok('a heading is found by the style\'s name in styles.xml ("heading 1"), though Word gave its id in German', J(de) === J(['Work Experience', 'Education', 'Skills']), J(de));
  const none = title(await readDocx(R.word(undefined, { styles: false })));
  ok('with no styles.xml, an id that says Heading is still a heading', J(none) === J(['Work Experience', 'Education', 'Skills']), J(none));
  const mini = body => R.zip({ 'word/document.xml': `<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`, 'word/styles.xml': '<w:styles xmlns:w="w"><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="3"/></w:numPr></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Company"><w:name w:val="Company"/><w:rPr><w:b/></w:rPr></w:style></w:styles>' });
  const run = t => `<w:r><w:t>${t}</w:t></w:r>`;
  const lines = async body => textOf(await readDocx(mini(body)));
  ok('a style that carries the list number (List Bullet) makes a bullet, and numId 0 takes it away', await lines(`<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr>${run('One')}</w:p><w:p><w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr>${run('Two')}</w:p>`) === '• One\nTwo');
  ok('a style that is bold makes its runs bold, and <w:b w:val="0"/> turns it off', J((await readDocx(mini(`<w:p><w:pPr><w:pStyle w:val="Company"/></w:pPr>${run('Acme')}</w:p><w:p><w:pPr><w:pStyle w:val="Company"/></w:pPr><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>Plain</w:t></w:r></w:p>`))).map(i => i.fontName)) === J(['Sans-Bold', 'Sans']));
  ok('a line break inside a paragraph starts a new line, and a tab starts a new item on the same line', J((await readDocx(mini(`<w:p><w:r><w:t>Acme</w:t><w:br/><w:t>Engineer</w:t><w:tab/><w:t>2020</w:t></w:r></w:p>`))).map(i => [i.text, i.y, i.hasEOL])) === J([['Acme', 0, true], ['Engineer', -1, false], ['2020', -1, true]]));
  ok('a text box is in the file twice (Choice and Fallback) and is read once; entities are read', await lines(`<w:p><w:r><mc:AlternateContent xmlns:mc="m"><mc:Choice><w:t>Boxed &amp; boxed</w:t></mc:Choice><mc:Fallback><w:t>Boxed &amp; boxed</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>`) === 'Boxed & boxed');
  ok('an empty paragraph, <w:p/>, is a blank line', J((await readDocx(mini(`<w:p>${run('A')}</w:p><w:p/><w:p w:rsidR="1"/><w:p>${run('B')}</w:p>`))).map(i => i.y)) === J([0, -3]));
  let err; try { await readDocx(R.zip({ 'readme.txt': 'x' })); } catch (e){ err = e; }
  ok('a ZIP with no word/document.xml is refused with a clear error', err?.code === 'zip', String(err));
  const extra = [...R.RESUME, { kind: 'blank', segs: [] }, { kind: 'h', segs: [['Interests', true]] }, { kind: 'p', segs: [['Chess, hiking']] }];
  const interests = parseResume(await readDocx(R.word(extra))).leftovers;
  ok('a Heading is a section title whatever its words: "Interests" (no title word) opens a section of its own, and its line is left over under it', J(interests) === J([{ text: 'Chess, hiking', section: 'Interests', line: 25 }]), J(interests));
  const top = parseResume(readMd(new TextEncoder().encode('# Jane Q. Sample\n## Contact\njane.sample@example.com\n'))).jsonResume.basics;
  ok('a heading in the first two lines is not a section, so the contact details under it are still the profile', top.name === 'Jane Q. Sample' && top.email === 'jane.sample@example.com', J(top));
  const oo = await readOdt(R.odt());
  ok('ODT: a heading is a bold section title, a list item a bullet, a span styled bold is bold, text:tab and <text:s text:c="3"/> start a new item', J(title(oo)) === J(['Work Experience', 'Education', 'Skills']) && oo.filter(i => i.text.startsWith('• ')).length === 5 && oo.find(i => i.text === 'Northgate Dosing Systems').fontName === 'Sans-Bold' && oo.find(i => i.text === 'Mar 2021 – Present').fontName === 'Sans');
}

section('a heading is a section title only at the top level the document uses');
{
  const enc = s => new TextEncoder().encode(s);
  const jobs = R.JOBS_AS_HEADINGS;
  const read = { 'Word': () => readDocx(R.word(jobs)), 'Google Docs': () => readDocx(R.google(jobs)), 'ODT': () => readOdt(R.odt(jobs)), 'HTML': () => readHtml(enc(R.html(jobs))), 'Markdown': () => readMd(enc(R.md(jobs))) };
  for (const [name, f] of Object.entries(read)){
    const items = await f(), got = parseResume(items).jsonResume;
    ok(`${name}: Heading 1 sections with Heading 2 job lines: only the sections are titles, and the three jobs, the school and the skills are read as before`,
      items.filter(i => i.title).map(i => i.text).join() === 'Work Experience,Education,Skills' && items.find(i => i.text === 'Northgate Dosing Systems').fontName === 'Sans-Bold' && eq(got.work, F.oneColumnExpected.work) && eq(got.education, F.oneColumnExpected.education) && eq(got.skills, F.oneColumnExpected.skills), J(got.work));
  }
  const titles = md => readMd(enc(md)).filter(i => i.title).map(i => i.text).join();
  ok('the name on the first line is left out when the level is worked out: # Name over ## sections makes the sections titles', titles('# Jane\n\njane.sample@example.com\n## Work Experience\nx\n## Education\ny\n') === 'Work Experience,Education');
  ok('the top level is the smallest number present: sections at ### over #### lines, and a document with one level has titles at that level', titles('Jane\nx\n### Work Experience\n#### Acme\n### Education\n') === 'Work Experience,Education' && titles('Jane\nx\n#### Acme\n') === 'Acme');
  ok('a Title style is no heading', !(await readDocx(R.zip({ 'word/document.xml': '<w:document xmlns:w="w"><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Jane</w:t></w:r></w:p></w:body></w:document>', 'word/styles.xml': '<w:styles xmlns:w="w"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style></w:styles>' }))).some(i => i.title || i.fontName === 'Sans-Bold'));
}

section('HTML, Markdown and text: the marks each one has');
{
  const enc = s => new TextEncoder().encode(s);
  const out = (read, s) => textOf(read(enc(s)));
  ok('HTML: head, style, script and comments are not text; entities are read; br starts a line; a table cell starts an item', out(readHtml, '<html><head><title>T</title></head><body><!-- c --><script>x()</script><p>A &amp; B<br>C &ndash; D</p><table><tr><td>Acme</td><td>2020</td></tr></table></body></html>') === 'A & B\nC – D\nAcme 2020');
  const h = readHtml(enc('<ul><li><p>One</p></li><li>Two <b>bold</b> <i>no</i></li></ul><h3>Three</h3><p><b>Acme</b>&nbsp;&nbsp;&nbsp;2020</p>'));
  ok('HTML: li is a bullet even with a p inside, h3 is a title, b is bold, and three no-break spaces keep two items apart', J(h.map(i => [i.text, !!i.title, i.fontName === 'Sans-Bold'])) === J([['• One', false, false], ['• Two bold no', false, false], ['Three', true, true], ['Acme', false, true], ['2020', false, false]]), J(h.map(i => i.text)));
  const md = '---\ntitle: note\n---\n# Jane\n\n* one\n+ two\n3. three\n---\n![photo](me.png)\n[site](https://example.com) and `code` and *it* and snake_case_name\r\n**Acme**   *2020*\n';
  ok('Markdown: front matter, an image and a rule are dropped; * + and 3. are bullets; a link keeps its words; code marks and italics go but snake_case stays; **bold** is bold; CRLF is read', out(readMd, md) === 'Jane\n• one\n• two\n• three\nsite and code and it and snake_case_name\nAcme 2020', out(readMd, md));
  const bm = readMd(enc(md));
  ok('Markdown: **Acme** is a bold item and *2020* a plain one after it', J(bm.slice(-2).map(i => [i.text, i.fontName])) === J([['Acme', 'Sans-Bold'], ['2020', 'Sans']]));
  ok('text: - * and a bullet glyph start a bullet; a year with a full stop ("2019. március") does not', out(readTxt, '- one\n* two\n• three\n2019. március – jelenleg\n') === '• one\n• two\n• three\n2019. március – jelenleg');
  ok('text: three spaces or a tab keep two items apart', J(readTxt(enc('Acme   2020\nBeta\t2021')).map(i => [i.text, i.hasEOL])) === J([['Acme', false], ['2020', true], ['Beta', false], ['2021', true]]));
  ok('text: Windows-1252 and UTF-16 are decoded, not shown as broken characters', textOf(readTxt(Uint8Array.of(0x4b, 0x6f, 0x76, 0xe1, 0x63, 0x73))) === 'Kovács' && textOf(readTxt(Uint8Array.of(0xff, 0xfe, 0xe1, 0))) === 'á');
}

section('the text of every item is cleaned');
{
  const enc = s => new TextEncoder().encode(s);
  const t = readTxt(enc('ﬁnal co\u00adoperation, “quoted” and ‘single’\nNorth\u00a0gate \u2009– 2019— 2020 ,x. A\u200bB\n3 × 4 and a full stop. 2019- 2021\n')).map(i => i.text);
  ok('extraction damage is mended (ligature, soft and zero-width characters, odd spaces); quotes, dashes, ×, capitals, the full stop and the spacing around punctuation stay as the person typed them', J(t) === J(['final cooperation, “quoted” and ‘single’', 'North gate – 2019— 2020 ,x. AB', '3 × 4 and a full stop. 2019- 2021']), J(t));
  const typed = ['C# and .NET', 'Node .js and Vue .js', 'Compétences : Python', 'Industrie- und Handelskammer', 'Front- and back-end', 'Hello , world ;'];
  ok('what a person types is not rewritten: "C# and .NET", "Compétences : Python" (French), "Industrie- und Handelskammer" (German), "Front- and back-end"', J(readTxt(enc(typed.join('\n'))).map(i => i.text)) === J(typed) && typed.every(s => clean(s) === s));
  const samples = ['ﬁnal co\u00adoperation', '“Quoted” – and ‘this’', 'North\u00a0gate 2019- 2021 ,x.', '3 × 4 ', 'Ends with a stop.', '  Spaced   out  ', 'Főmérnök, CAD…', ...typed];
  ok('matching is not touched: normText of the cleaned text is normText of the text (so the person\'s typography never stops a line being found)', samples.every(s => normText(clean(s)) === normText(s)), samples.filter(s => normText(clean(s)) !== normText(s)).join(' | '));
  ok('the one thing clean removes that normText keeps is the zero-width space (normText is the app\'s matching and is left as it is in this step), so a zero-width sample matches once it is removed', normText(clean('A\u200bB')) === normText('AB') && normText('A\u200bB') !== normText('AB'));
}

section('LinkedIn: the CSV files straight to JSON Resume');
{
  const read = await readLinkedin(R.linkedin()), got = read.jsonResume;
  ok('it answers in the parser\'s shape, with an empty trace, leftovers and doubts, so a caller treats every reader alike', J(Object.keys(read)) === J(['jsonResume', 'trace', 'leftovers', 'doubts']) && Object.entries(read).filter(([k]) => k !== 'jsonResume').every(([, v]) => Array.isArray(v) && !v.length));
  ok('Profile, Positions, Education, Skills and Email Addresses become JSON Resume (a description is split into lines, a bullet taken off, an open job has no end date)', eq(got, R.linkedinExpected), J(got));
  const { education, skills, ...rest } = R.linkedinExpected;
  const renamed = (await readLinkedin(R.linkedin(true))).jsonResume;
  ok('headers in other case or under other names (Company, Job Title, Start Date, EMAIL ADDRESS, geo location) and files named profile.CSV give the same', eq(renamed, rest), J(renamed));
  ok('the primary address wins over the first one', renamed.basics.email === 'jane.sample@example.com');
  const dates = (await readLinkedin(R.zip({ 'Positions.csv': 'Company Name,Started On,Finished On\nA,Jan 2020,\nB,03/2019,2020\nC,2017-05-01,\nD,Sept 2016,garbage\nE,,\n' }))).jsonResume.work.map(w => [w.startDate, w.endDate]);
  ok('a date may be "Jan 2020", "03/2019", "2017-05-01", "Sept 2016" or empty', J(dates) === J([['2020-01', undefined], ['2019-03', '2020'], ['2017-05', undefined], ['2016-09', undefined], [undefined, undefined]]), J(dates));
  const back = fromJsonResume(got);
  ok('it goes through fromJsonResume: the two bullets, the name, a skills group', back.model.work.flatMap(w => w.highlights).length === 2 && back.model.basics.name === 'Jane Sample' && back.model.skills.length === 1, J(back.review.rows));
  ok('a Pages file gives the PDF it holds, and one with none (a modern one, a picture of its first page) gives the code pages-preview', new TextDecoder().decode(await readPages(R.pages())).startsWith('%PDF-') && (await readPages(R.zip({ 'Index/Document.iwa': 'x' })).catch(e => e.code)) === 'pages-preview');
}

section('parseCsv, moved to src/parse/csv.js');
{
  const rows = parseCsv('\ufeffa,"b,1","say ""hi"""\r\nx,"two\nlines",\r\n');
  ok('quoted cells, "" for a quote, line breaks inside quotes, CRLF, an empty last cell and a byte order mark', J(rows) === J([['a', 'b,1', 'say "hi"'], ['x', 'two\nlines', '']]), J(rows));
  const script = fs.readFileSync(path.join(REPO, 'scripts/i18n-review.mjs'), 'utf8');
  ok('scripts/i18n-review.mjs imports it from there and no longer defines it', /import \{ parseCsv \} from '\.\.\/src\/parse\/csv\.js'/.test(script) && !/function parseCsv/.test(script));
}

section('what real files do: more types, a ZIP that is damaged, one budget for all the reads');
{
  const enc = s => new TextEncoder().encode(s);
  const kind = (bytes, name) => { try { return identify(bytes, name); } catch (e){ return 'throws ' + e.code; } };
  for (const [what, text, want] of [
    ['an HTML fragment that opens with <span>', '<span>Jane</span>', 'html'], ['an <a>', '<a href="x">Jane</a>', 'html'], ['an <li>', '<li>One</li>', 'html'], ['a <br>', '<br>Jane', 'html'],
    ['a <meta>', '<meta charset="utf-8"><p>x', 'html'], ['a <title>', '<title>T</title>', 'html'], ['a "saved from url" comment', '<!-- saved from url=(0014)about:internet -->\n<html><body>x</body></html>', 'html'],
    ['XHTML with an XML declaration', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>x</body></html>', 'html'],
    ['an SVG', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'image'], ['an SVG with an XML declaration', '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>', 'image'],
    ['other XML', '<?xml version="1.0"?><note><to>x</to></note>', 'other'],
    ['Markdown that opens with an autolink', '<https://example.com>\n# Jane\n', 'md'], ['a PDF header deep inside a text', 'A line of resume text, then %PDF- in the middle of it', 'txt'],
    ['empty bytes', '', 'other'], ['text that starts with BM', 'BMW Group\nEngineer\nand more lines of text', 'txt'],
  ]) ok(`${what}: ${want}`, kind(enc(text), 'a.txt') === want, kind(enc(text), 'a.txt'));
  const bmp = new Uint8Array(30), heic = new Uint8Array(16), avif = new Uint8Array(16); bmp.set(enc('BM')); heic.set(enc('ftypheic'), 4); avif.set(enc('ftypavif'), 4);
  ok('a BMP, a HEIC and an AVIF are images', [bmp, heic, avif].every(b => identify(b, 'a.txt') === 'image'));
  const ods = R.zip({ mimetype: 'application/vnd.oasis.opendocument.spreadsheet', 'content.xml': '<x/>' }), noMime = R.zip({ 'content.xml': '<x/>' });
  ok('a spreadsheet (.ods) has a content.xml too: its mimetype says it is no document; an ODT without a mimetype entry is still an ODT', identify(ods, 'a.odt') === 'other' && identify(noMime, 'a.ods') === 'odt' && identify(R.odt(), 'a.ods') === 'odt');
  const word = R.word(), cut = word.subarray(0, word.length - 30), z64 = (() => { const f = R.zip({ 'word/document.xml': 'x' }); f.set([0xff, 0xff], f.length - 22 + 10); return f; })();
  ok('a DOCX cut short, a ZIP64 DOCX and a cut LinkedIn export give unzip\'s error code, not "other"', kind(cut, 'a.docx') === 'throws zip' && kind(z64, 'a.docx') === 'throws zip64' && kind(R.linkedin().subarray(0, 200), 'a.zip') === 'throws zip');

  // the ZIP64 marks, one at a time: the end record (directory size, start) and an entry (sizes, offset)
  const f0 = R.zip({ 'a.txt': 'x' }), eocd = f0.length - 22, cd = new DataView(f0.buffer, f0.byteOffset).getUint32(eocd + 16, true);
  for (const [what, at] of [['the directory size', eocd + 12], ['where the directory starts', eocd + 16], ['an entry\'s compressed size', cd + 20], ['an entry\'s size', cd + 24], ['an entry\'s offset', cd + 42]]){
    const f = f0.slice(); f.set([0xff, 0xff, 0xff, 0xff], at);
    let code; try { unzip(f); code = 'none'; } catch (e){ code = e.code; }
    ok(`ZIP64 is refused when ${what} says 0xFFFFFFFF`, code === 'zip64', code);
  }

  // one budget for every read of a file (64 MB), and an entry that lies about its size is cut off all the same
  const code = async f => { try { await f(); return 'none'; } catch (e){ return e.code; } };
  const e30 = await R.deflated(new Uint8Array(30 * 1024 * 1024)), three = unzip(R.zip({ a: e30, b: e30, c: e30 }));
  ok('three entries of 30 MB: two are read, the third is over the 64 MB the file may inflate to in all', (await three.read('a')).length === 30 * 1024 * 1024 && (await three.read('b')).length === 30 * 1024 * 1024 && await code(() => three.read('c')) === 'big');
  const e60 = await R.deflated(new Uint8Array(60 * 1024 * 1024)), five = unzip(R.zip({ a: e60, b: e60, c: e60, d: e60, e: e60 })), t0 = Date.now();
  ok('five entries of 60 MB (a small ZIP): the first is read, every other is refused at once, without inflating it', (await five.read('a')).length === 60 * 1024 * 1024 && (await Promise.all(['b', 'c', 'd', 'e'].map(n => code(() => five.read(n))))).every(x => x === 'big') && Date.now() - t0 < 5000, String(Date.now() - t0));
  const big2 = unzip(R.zip({ a: new Uint8Array(40 * 1024 * 1024), b: new Uint8Array(40 * 1024 * 1024) }));
  ok('stored entries count against the same budget: two of 40 MB, the second is refused', (await big2.read('a')).length === 40 * 1024 * 1024 && await code(() => big2.read('b')) === 'big');
  const liar = unzip(R.zip({ a: { ...(await R.deflated(new Uint8Array(70 * 1024 * 1024))), size: 10 } }));
  ok('an entry that says it is 10 bytes and inflates to 70 MB is cut off in the read', await code(() => liar.read('a')) === 'big');
  const stored = unzip(R.zip({ mimetype: 'application/x', d: await R.deflated('x') }));
  ok('stored() gives a stored entry at once, and null for a deflated one or one that is not there', new TextDecoder().decode(stored.stored('mimetype')) === 'application/x' && stored.stored('d') === null && stored.stored('nope') === null);
}

section('Word files as they are: text boxes, hidden text, deleted paragraphs, headers and footers');
{
  const mini = (body, more = {}) => R.zip({ 'word/document.xml': `<w:document xmlns:w="w" xmlns:mc="m" xmlns:wps="p"><w:body>${body}</w:body></w:document>`, ...more });
  const lines = async (body, more) => textOf(await readDocx(mini(body, more)));
  const run = t => `<w:r><w:t>${t}</w:t></w:r>`, para = t => `<w:p>${run(t)}</w:p>`;
  const box = name => `<w:txbxContent><w:p>${run(name)}</w:p></w:txbxContent>`;
  ok('a text box is lifted out of its paragraph: the paragraph stays whole ("Before after"), the box is read as its own line after it, once', await lines(`<w:p>${run('Before ')}<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx>${box('Jane Q. Sample')}</wps:txbx></w:drawing></mc:Choice><mc:Fallback><w:pict>${box('Jane Q. Sample')}</w:pict></mc:Fallback></mc:AlternateContent></w:r>${run('after')}</w:p>`) === 'Before after\nJane Q. Sample');
  ok('a paragraph that holds only a text box with the name: the name is not lost', await lines(`<w:p><w:r><w:drawing><wps:txbx>${box('Jane Q. Sample')}</wps:txbx></w:drawing></w:r></w:p>${para('Engineer')}`) === 'Jane Q. Sample\nEngineer');
  ok('a file cut short still gives its last paragraph: <w:p> and <w:r> never closed', await lines(`${para('One')}<w:p><w:r><w:t>Open`) === 'One\nOpen');
  ok('a no-break hyphen is a hyphen', await lines('<w:p><w:r><w:t>Co</w:t><w:noBreakHyphen/><w:t>op</w:t></w:r></w:p>') === 'Co-op');
  ok('hidden text (w:vanish) is not read, and w:vanish w:val="0" is not hidden', await lines('<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden</w:t></w:r><w:r><w:rPr><w:vanish w:val="0"/></w:rPr><w:t>shown</w:t></w:r></w:p>') === 'shown');
  const ys = async body => (await readDocx(mini(body))).map(i => i.y);
  const gone = '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="a" w:date="d"/></w:rPr></w:pPr><w:del w:id="2"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>';
  ok('a paragraph deleted with a tracked change (its mark deleted, nothing left) leaves no blank line; one that still has text is read; <w:p/> is still a blank line', J(await ys(para('A') + gone + para('B'))) === J([0, -1]) && await lines(gone.replace('<w:del w:id="2"><w:r><w:delText>gone</w:delText></w:r></w:del>', run('kept'))) === 'kept' && J(await ys(para('A') + '<w:p/>' + para('B'))) === J([0, -2]));
}

section('Word headers and footers: only the ones the last section uses, without page numbers or repeats');
{
  const hdr = t => `<w:hdr xmlns:w="w"><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:hdr>`;
  // a document with its section properties, its relationships and its header and footer parts
  const withParts = (body, sect, rels, parts) => R.zip({
    'word/document.xml': `<w:document xmlns:w="w" xmlns:r="r"><w:body>${body}${sect}</w:body></w:document>`,
    'word/_rels/document.xml.rels': `<Relationships>${rels.map(([id, to]) => `<Relationship Id="${id}" Type="x" Target="${to}"/>`).join('')}</Relationships>`,
    ...Object.fromEntries(Object.entries(parts).map(([n, t]) => [`word/${n}`, hdr(t)])),
  });
  const para = t => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`, ref = (kind, type, id) => `<w:${kind}Reference w:type="${type}" r:id="${id}"/>`;
  const lines = async (...a) => textOf(await readDocx(withParts(...a)));
  const page = '<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> of </w:t></w:r><w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>2</w:t></w:r></w:fldSimple></w:p>';
  const plain = await readDocx(R.word()), running = await readDocx(R.word(undefined, { header: ['Jane Q. Sample'], footer: [page] }));
  ok('the repo\'s Word fixture with a running header of its name and a footer of "Page 1 of 2" (fields) reads exactly as without them, and parses to the same JSON Resume', eq(running, plain) && eq(parseResume(running).jsonResume, F.oneColumnExpected));
  const kept = await readDocx(R.word(undefined, { header: ['jane.sample@example.com   (555) 010-0100'], footer: ['Page 2', 'References on request'] }));
  ok('a header line the body does not have is kept in the order of the text, first, and a footer line last', textOf(kept).split('\n')[0] === 'jane.sample@example.com (555) 010-0100' && textOf(kept).endsWith('References on request') && !textOf(kept).includes('Page 2'));
  const sect = (...refs) => `<w:sectPr>${refs.join('')}</w:sectPr>`;
  ok('a header reference with no w:type is the default one, and a target written from the root (/word/header1.xml) is found', await lines(para('Body'), sect('<w:headerReference r:id="rId1"/>'), [['rId1', '/word/header1.xml']], { 'header1.xml': 'Plain' }) === 'Plain\nBody');
  ok('an earlier section\'s header is not used when the last section has none', await lines(`<w:p><w:pPr>${sect(ref('header', 'default', 'rId1'))}</w:pPr><w:r><w:t>One</w:t></w:r></w:p>` + para('Two'), sect(), [['rId1', 'a.xml']], { 'a.xml': 'Old' }) === 'One\nTwo');
  ok('the part a relationship points to is read, not the one that sorts first: header10.xml is used and header2.xml is not', await lines(para('Body'), sect(ref('header', 'default', 'rId1')), [['rId1', 'header10.xml'], ['rId2', 'header2.xml']], { 'header10.xml': 'Ten', 'header2.xml': 'Two' }) === 'Ten\nBody');
  ok('the first-page and even-page headers are not read when a default one exists', await lines(para('Body'), sect(ref('header', 'first', 'rId1'), ref('header', 'even', 'rId2'), ref('header', 'default', 'rId3'), '<w:titlePg/>'), [['rId1', 'h1.xml'], ['rId2', 'h2.xml'], ['rId3', 'h3.xml']], { 'h1.xml': 'First', 'h2.xml': 'Even', 'h3.xml': 'Default' }) === 'Default\nBody');
  ok('with no default header, the first-page one is read when titlePg is set, and none when it is not', await lines(para('Body'), sect(ref('header', 'first', 'rId1'), '<w:titlePg/>'), [['rId1', 'h1.xml']], { 'h1.xml': 'First' }) === 'First\nBody' && await lines(para('Body'), sect(ref('header', 'first', 'rId1')), [['rId1', 'h1.xml']], { 'h1.xml': 'First' }) === 'Body');
  ok('only the last section\'s header counts: the section properties inside a paragraph belong to a section before it', await lines(`<w:p><w:pPr>${sect(ref('header', 'default', 'rId1'))}</w:pPr><w:r><w:t>One</w:t></w:r></w:p>` + para('Two'), sect(ref('header', 'default', 'rId2')), [['rId1', 'a.xml'], ['rId2', 'b.xml']], { 'a.xml': 'Old', 'b.xml': 'Last' }) === 'Last\nOne\nTwo');
  ok('a header or footer part with no relationship, or a file without relationships, is not read', await lines(para('Body'), sect(), [], { 'header1.xml': 'Stray' }) === 'Body' && textOf(await readDocx(R.zip({ 'word/document.xml': '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>', 'word/header1.xml': hdr('Stray') }))) === 'Body');
  const side = await readDocx(R.word(undefined, { header: ['Jane Q. Sample | Mechanical Engineer'], footer: ['Confidential', 'Springfield, IL 62701'] })), got = parseResume(side);
  ok('a header and footer with lines of their own are not read: the JSON Resume and the body\'s leftovers are as without them, and the three lines come back as leftovers of the section "header" and "footer"', eq(got.jsonResume, F.oneColumnExpected) && J(got.leftovers) === J([{ text: 'Jane Q. Sample | Mechanical Engineer', section: 'header' }, { text: 'Confidential', section: 'footer' }, { text: 'Springfield, IL 62701', section: 'footer' }]) && eq(got.doubts, []), J(got.leftovers));
  ok('a header line of two items comes back as one leftover', J(parseResume(await readDocx(R.word(undefined, { header: ['Left\tRight'] }))).leftovers) === J([{ text: 'Left Right', section: 'header' }]));
  ok('they stay in the reading order for the document\'s text (the header first, the footer last), marked side', textOf(side).startsWith('Jane Q. Sample | Mechanical Engineer\nJane Q. Sample\n') && textOf(side).endsWith('Confidential\nSpringfield, IL 62701') && side.filter(i => i.side).map(i => i.side).join() === 'header,footer,footer');
  const heads = itemsOf([{ side: 'header', runs: [{ text: 'H1' }] }, { side: 'header', runs: [{ text: 'H2' }] }, { runs: [{ text: 'Name' }], level: 1 }, { runs: [{ text: 'A' }], level: 2 }, { runs: [{ text: 'B' }], level: 2 }]);
  ok('header lines do not count as the first two lines when the top heading level is found', heads.filter(i => i.title).map(i => i.text).join() === 'A,B');
  const keep = ['Lakeside 40210', 'Zip 90210', 'Tel 5550100', 'Born 1970', 'Version 2', 'Resume 2024'];
  ok('"Lakeside 40210", "Zip 90210", "Tel 5550100", "Born 1970", "Version 2" and "Resume 2024" are not page numbers: they stay, as footer lines', J((await readDocx(R.word(undefined, { footer: keep }))).filter(i => i.side).map(i => i.text)) === J(keep));
  const pages = ['Page 1 of 2', 'Seite 1 von 2', 'Page 1 sur 2', 'Página 1 de 2', 'Pagina 1 di 2', 'Pagina 1 van 2', 'Strona 1 z 2', 'Stránka 1 z 2', '1. oldal', '1/2. oldal', '1 / 2', '7', 'p. 3', 'S. 2', 'PAGE 4'];
  ok('a page number is a bare number, "n / m" or one with the word for page in the ten interface languages, in any case', (await readDocx(R.word(undefined, { footer: pages }))).filter(i => i.side).length === 0);
  ok('a target written as ../word/header1.xml is found', await lines(para('Body'), sect(ref('header', 'default', 'rId1')), [['rId1', '../word/header1.xml']], { 'header1.xml': 'Up' }) === 'Up\nBody');
  const furniture = ['Page 1 of 2', 'Seite 1 von 2', '1 / 2', 'Page 2', '3. oldal', '7'];
  ok('page numbers typed out ("Page 1 of 2", "Seite 1 von 2", "1 / 2", "Page 2", "3. oldal", "7") are dropped from a footer', textOf(await readDocx(R.word(undefined, { footer: furniture }))) === textOf(plain));
  ok('a header line with a name in it is not taken for a page number', textOf(await readDocx(R.word(undefined, { header: ['Jane Q. Sample, CV 2026'] }))).startsWith('Jane Q. Sample, CV 2026\n'));
}

section('ODT files as they are: links, notes, frames, comments, deleted text');
{
  const mini = body => R.zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': `<office:document-content xmlns:office="o" xmlns:text="t" xmlns:xlink="x" xmlns:draw="d"><office:body><office:text>${body}</office:text></office:body></office:document-content>` });
  const got = textOf(await readOdt(mini('<text:tracked-changes><text:changed-region><text:deletion><text:p>deleted text</text:p></text:deletion></text:changed-region></text:tracked-changes>'
    + '<text:p text:style-name="P1">Mail <text:a xlink:href="mailto:jane.sample@example.com" xlink:type="simple">jane.sample@example.com</text:a><text:bookmark-start text:name="b"/>.<text:bookmark-end text:name="b"/>'
    + '<text:note text:id="n1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>Footnote</text:p></text:note-body></text:note> end<text:change-start text:change-id="c"/>!'
    + '<office:annotation><dc:creator xmlns:dc="c">me</dc:creator><text:p>comment</text:p></office:annotation><draw:frame draw:name="f"><draw:text-box><text:p>Boxed</text:p></draw:text-box></draw:frame>tail<text:tab />2020</text:p><text:p>Next</text:p>')));
  ok('a link, a bookmark, a note, a change mark and <text:tab /> do not leak; a footnote, a comment and a tracked deletion are not read; a frame is its own line after the paragraph, which stays whole', got === 'Mail jane.sample@example.com. end!tail 2020\nBoxed\nNext', got);
  ok('CDATA in an ODT paragraph is text as it stands', textOf(await readOdt(mini('<text:p><![CDATA[a <b> & &amp; c]]></text:p>'))) === 'a <b> & &amp; c');
  ok('a paragraph never closed is still read', textOf(await readOdt(mini('<text:p>One</text:p><text:p>Open'))) === 'One\nOpen');
}

section('lines are not cut at a double space, and what a hostile file cannot do');
{
  const enc = s => new TextEncoder().encode(s);
  const one = readTxt(enc('Shipped the devices.  She likes it.'));
  ok('two spaces inside a sentence do not start a new item: the second sentence is not lost', one.length === 1 && one[0].text === 'Shipped the devices. She likes it.', J(one.map(i => i.text)));
  ok('three spaces still do', readTxt(enc('Acme   2020')).length === 2);
  const slow = [];
  const time = async (what, f) => { const t = Date.now(); try { await f(); } catch (e){ if (e.code !== 'empty') throw e; } const ms = Date.now() - t; if (ms > 1000) slow.push(`${what} ${ms} ms`); };
  const N = 30000, docx = (doc, styles = '') => readDocx(R.zip({ 'word/document.xml': doc, 'word/styles.xml': styles })), odt = body => readOdt(R.zip({ 'content.xml': body }));
  await time('an unclosed w:style', () => docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>', '<w:style w:styleId="a">'.repeat(N)));
  await time('an unclosed w:p', () => docx('<w:p><w:r><w:t>x'.repeat(N)));
  await time('an unclosed w:r', () => docx('<w:p>' + '<w:r><w:t>x</w:t>'.repeat(N)));
  await time('a tag with no end', () => docx('<w:p '.repeat(N)));
  await time('an unclosed quote', () => docx('<w:p w:a="'.repeat(N)));
  await time('an unclosed fallback', () => docx('<mc:Fallback>'.repeat(N) + '<w:p/>'));
  await time('an unclosed text:p', () => odt('<text:p>a'.repeat(N)));
  await time('an unclosed text:span', () => odt('<text:p>' + '<text:span text:style-name="a">b'.repeat(N)));
  await time('an unclosed style', () => odt('<style:style style:name="a">'.repeat(N) + '<text:p>x</text:p>'));
  await time('HTML <a "', () => readHtml(enc('<a "'.repeat(N))));
  await time('HTML <!--', () => readHtml(enc('<!--'.repeat(N))));
  await time('HTML <li>', () => readHtml(enc('<li>x'.repeat(N))));
  await time('HTML <script>', () => readHtml(enc('<script>x'.repeat(N))));
  await time('HTML <', () => readHtml(enc('<'.repeat(N * 3))));
  await time('HTML closing tags that close nothing', () => readHtml(enc('<p>x'.repeat(N) + '</b>'.repeat(N))));
  await time('Markdown ![', () => readMd(enc('![a](b'.repeat(N))));
  await time('Markdown [', () => readMd(enc('['.repeat(N * 3))));
  await time('Markdown *', () => readMd(enc('*a'.repeat(N))));
  await time('Markdown **', () => readMd(enc('**'.repeat(N))));
  ok('30,000 repeats of a broken tag, quote, comment or markup finish in well under a second each', slow.length === 0, slow.join('; '));
}

section('HTML as it is written: open items, entities, hidden parts, comments');
{
  const enc = s => new TextEncoder().encode(s);
  const out = s => textOf(readHtml(enc(s)));
  ok('an <li> that is never closed ends with the next <li> and with the list: what follows is no bullet', out('<ul><li>One<li>Two</ul><p>After</p>') === '• One\n• Two\nAfter', out('<ul><li>One<li>Two</ul><p>After</p>'));
  ok('a number that is no character is dropped, not an error: &#99999999; &#0; &#55296; &#7; and 128 to 159 are Windows-1252 (&#150; is a dash, &#129; is nothing)', out('<p>a&#99999999;b&#0;c&#55296;d&#7;e&#150;f&#129;g&#x1F600;</p>') === 'abcde–fg😀', out('<p>a&#99999999;b&#0;c&#55296;d&#7;e&#150;f&#129;g&#x1F600;</p>'));
  ok('the common named entities are read: letters with accents, quotes, dashes, &nbsp;, &shy;, &copy;', out('<p>&eacute;&Eacute;&ouml;&Uuml;&ccedil;&aring;&szlig;&copy;&shy;&lsquo;&rsquo;&ldquo;&rdquo;&ndash;&mdash;&nbsp;x&bogus;</p>') === 'éÉöÜçåß©‘’“”–— x&bogus;', out('<p>&eacute;&Eacute;&ouml;&Uuml;&ccedil;&aring;&szlig;&copy;&shy;&lsquo;&rsquo;&ldquo;&rdquo;&ndash;&mdash;&nbsp;x&bogus;</p>'));
  ok('noscript, iframe and button are not text', out('<noscript>nope</noscript><iframe>no</iframe><button>Click</button><p>yes</p>') === 'yes');
  ok('a <head> that is never closed does not let its <title> into the text', out('<html><head><title>Leak</title><meta charset=utf-8><body><p>Hi</p>') === 'Hi');
  ok('a skipped element with forty unclosed children still finds its close: <iframe> holding 40 <li>, then </iframe><p>AFTER</p>', out('<iframe>' + '<li>x'.repeat(40) + '</iframe><p>AFTER</p>') === 'AFTER' && out('<noscript>' + '<li>x'.repeat(40) + '</noscript><title>' + '<li>'.repeat(40) + '</title><p>AFTER</p>') === 'AFTER');
  ok('a <button> never closed ends at the next cell as well: <td><button>Go</td><td>Important</td> keeps "Important"', out('<table><tr><td><button>Go</td><td>Important</td></tr></table>') === 'Important');
  ok('a close tag for an element already closed closes nothing: <b>x</b></b>y', out('<p><b>x</b></b>y</p>') === 'xy');
  ok('a dropped entity leaves no gap: "a &#99999999; b" is one item "a b", and "a&#0;b" is "ab"', J(readHtml(enc('<p>a &#99999999; b</p>')).map(i => i.text)) === J(['a b']) && out('<p>a&#0;b</p>') === 'ab' && out('<p>a &#0;b &#7;</p>') === 'a b');
  ok('an <li> closed with </li> and never reopened ends there: what follows is no bullet', out('<li>One<li>Two</li><p>After</p>') === '• One\n• Two\nAfter', out('<li>One<li>Two</li><p>After</p>'));
  ok('an <li> closed with </li> and never reopened ends there: what follows is no bullet', out('<li>One<li>Two</li><p>After</p>') === '• One\n• Two\nAfter', out('<li>One<li>Two</li><p>After</p>'));
  ok('an attribute that holds a > does not leak: <a title="a > b">Link</a> text', out('<p><a title="a > b" href=\'x>y\'>Link</a> text</p>') === 'Link text');
  ok('empty table cells and rows leave no blank line', J(readHtml(enc('<table><tr><td>A</td></tr><tr><td></td></tr><tr><td> </td><td></td></tr><tr><td>B</td></tr></table>')).map(i => i.y)) === J([0, -1]));
  ok('a comment with markup inside is not text, and one that never ends takes the rest', out('<p>a</p><!-- <p>hidden</p> <b>x --><p>b</p>') === 'a\nb' && out('<p>a</p><!-- <p>rest</p>') === 'a');
  ok('a < that starts no tag is text', out('<p>1 < 2 and 3 <4</p>') === '1 < 2 and 3 <4');
}

section('Markdown and text as they are written: setext headings, front matter, reference links, underlines');
{
  const enc = s => new TextEncoder().encode(s);
  const titles = md => readMd(enc(md)).filter(i => i.title).map(i => i.text).join();
  const body = under => `Jane\njane.sample@example.com\n\nExperience\n${under.repeat(10)}\nAcme\n\nEducation\n${under.repeat(10)}\nLakeside\n`;
  ok('a line underlined with === or --- is a heading, and the underline is not a line', titles(body('=')) === 'Experience,Education' && titles(body('-')) === 'Experience,Education' && textOf(readMd(enc(body('=')))) === 'Jane\njane.sample@example.com\nExperience\nAcme\nEducation\nLakeside' && textOf(readMd(enc(body('-')))) === textOf(readMd(enc(body('=')))));
  ok('a rule of === with no text above it is a blank line, and an underline shorter than three characters is no underline', textOf(readMd(enc('a\n\n====\nb\n'))) === 'a\nb' && titles('Jane\nx\n\nExperience\n==\nAcme\n') === '');
  ok('a bullet followed by --- is no heading, and a rule with no text above it is a blank line', textOf(readMd(enc('- item\n---\n\n***\ntext\n'))) === '• item\ntext');
  ok('front matter is dropped only when it holds key: value lines', textOf(readMd(enc('---\ntitle: Resume\ntags: [a]\n---\n# Jane\n'))) === 'Jane' && textOf(readMd(enc('---\nJane Q. Sample\nEngineer\n---\nrest\n'))).startsWith('Jane Q. Sample'), textOf(readMd(enc('---\nJane Q. Sample\nEngineer\n---\nrest\n'))));
  ok('a reference link reads as its text and its definition is not a line', textOf(readMd(enc('See [my site][1] and [other][] and [plain](https://x.org).\n\n[1]: https://example.com "Title"\n[other]: <https://y.org>\n'))) === 'See my site and other and plain.');
  ok('plain text drops a line of ==== or ---- (an underline or a rule) and keeps the lines around it', textOf(readTxt(enc('Jane\nEngineer\n\nExperience\n==========\nAcme\n--------\n***\nDone\n'))) === 'Jane\nEngineer\nExperience\nAcme\nDone');
}

section('two spaces split a line, except after a full stop; tracked changes; very many headings');
{
  const enc = s => new TextEncoder().encode(s);
  ok('two spaces keep a company and its dates apart in text, Markdown and HTML (two no-break spaces), and a tab does too', J(readTxt(enc('Northgate Dosing Systems  Mar 2021 – Present')).map(i => i.text)) === J(['Northgate Dosing Systems', 'Mar 2021 – Present']) && readMd(enc('**Acme**  *2020*')).length === 2 && readHtml(enc('<p>Acme&nbsp;&nbsp;2020</p>')).length === 2);
  ok('but not after . ! or ?: sentence spacing is no gap, in text, Markdown and HTML', readTxt(enc('Shipped it.  She likes it!  Does he?  Yes')).length === 1 && readTxt(enc('Shipped it.   She likes it.')).length === 1 && readMd(enc('Shipped it.  She likes it.')).length === 1 && readHtml(enc('<p>Shipped it.&nbsp;&nbsp;She likes it.</p>')).length === 1);
  const two = R.txt(undefined, '  '), twoMd = R.md(undefined, '  ');
  ok('the one-column resume written with two spaces as the gap parses to the same JSON Resume, in text and in Markdown (the school keeps its institution)', eq(parseResume(readTxt(enc(two))).jsonResume, F.oneColumnExpected) && eq(parseResume(readMd(enc(twoMd))).jsonResume, F.oneColumnExpected));

  const doc = (body, styles = '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="3"/></w:numPr></w:pPr></w:style>') =>
    readDocx(R.zip({ 'word/document.xml': `<w:document xmlns:w="w" xmlns:mc="m"><w:body>${body}</w:body></w:document>`, 'word/styles.xml': `<w:styles xmlns:w="w">${styles}</w:styles>` }));
  const run = t => `<w:r><w:t>${t}</w:t></w:r>`, para = t => `<w:p>${run(t)}</w:p>`;
  const kept = await doc(para('a') + para('b') + `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:pPrChange w:id="1"><w:pPr><w:pStyle w:val="Normal"/><w:numPr><w:numId w:val="5"/></w:numPr></w:pPr></w:pPrChange></w:pPr>${run('Experience')}</w:p>`);
  ok('the old properties of a tracked change (w:pPrChange) do not replace the current ones: a heading stays a heading and is no bullet', kept.at(-1).title === true && kept.at(-1).text === 'Experience' && kept.at(-1).fontName === 'Sans-Bold');
  const plainText = await doc(`<w:p><w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:numId w:val="0"/><w:ilvl w:val="0"/></w:numPr><w:pPrChange w:id="2"><w:pPr><w:numPr><w:numId w:val="5"/></w:numPr></w:pPr></w:pPrChange></w:pPr><w:r><w:rPr><w:rPrChange w:id="3"><w:rPr><w:b/><w:vanish/></w:rPr></w:rPrChange></w:rPr><w:t>plain</w:t></w:r></w:p>`);
  ok('nor do a run\'s old properties (w:rPrChange): plain text is not bold or hidden, and a numId of 0 is still no list', plainText.length === 1 && plainText[0].text === 'plain' && plainText[0].fontName === 'Sans');
  ok('text moved away (w:moveFrom) is not read, the moved copy (w:moveTo) is', textOf(await doc(`<w:p><w:moveFrom w:id="1">${run('moved away')}</w:moveFrom><w:moveTo w:id="2">${run('moved here')}</w:moveTo></w:p>`)) === 'moved here');

  const many = itemsOf(Array.from({ length: 300000 }, (_, k) => ({ runs: [{ text: 'h' + k }], level: 2 })));
  ok('300,000 headings do not break the top level (no argument list that long)', many.length === 300000 && many[5].title === true);
}

section('what an open or odd element, a CDATA, a pre and an unreadable file do');
{
  const enc = s => new TextEncoder().encode(s);
  const doc = body => readDocx(R.zip({ 'word/document.xml': `<w:document xmlns:w="w" xmlns:mc="m"><w:body>${body}</w:body></w:document>` }));
  const run = t => `<w:r><w:t>${t}</w:t></w:r>`;
  ok('an mc:Fallback never closed ends where its run ends: the text after it is not lost', textOf(await doc(`<w:p><w:r><mc:Fallback><w:t>dup</w:r><w:r><w:t>kept</w:t></w:r></w:p><w:p>${run('After')}</w:p>`)) === 'kept\nAfter');
  const out = s => textOf(readHtml(enc(s)));
  ok('elements without an end (<br>, <hr>, <img>) are not left open: an <iframe> with forty <br> in it still ends at its parent\'s end', out('<div><iframe>' + '<br>'.repeat(40) + '</div><p>After</p>') === 'After');
  ok('a <button> never closed ends at the next block, an <iframe> or <noscript> at its parent\'s end; none of them takes the rest of the page', out('<p>One <button>Click</p><p>Two</p>') === 'One\nTwo' && out('<div><iframe src="x">fallback<p>inside</div><p>Three</p>') === 'Three' && out('<div><noscript>js<p>x</div><p>Four</p>') === 'Four');
  ok('CDATA in a w:t is text as it stands (no entities read in it)', textOf(await doc(`<w:p><w:r><w:t><![CDATA[a <b> & &amp; c]]></w:t></w:r></w:p>`)) === 'a <b> & &amp; c');
  const pre = readHtml(enc('<pre>line one\n  line two\nline three</pre><p>after\nthis</p>'));
  ok('<pre> keeps its line breaks, a paragraph does not', J(pre.map(i => i.text)) === J(['line one', 'line two', 'line three', 'after this']) && J([...new Set(pre.map(i => i.y))]) === J([0, -1, -2, -3]));
  const code = async f => { try { await f(); return 'none'; } catch (e){ return e.code; } };
  const odt = body => readOdt(R.zip({ 'content.xml': body }));
  ok('a DOCX, an ODT or a page with no paragraph in it (a renamed prefix, a default namespace, only script) is refused with the code "empty"; one with blank paragraphs is read as no lines',
    await code(() => doc('<x:p><x:r><x:t>Hi</x:t></x:r></x:p>')) === 'empty' && await code(() => readDocx(R.zip({ 'word/document.xml': '<document xmlns="w"><body><p><r><t>Hi</t></r></p></body></document>' }))) === 'empty'
    && await code(() => odt('<o:p>Hi</o:p>')) === 'empty' && await code(() => readHtml(enc('<html><body><script>x()</script></body></html>'))) === 'empty'
    && (await doc('<w:p/><w:p/>')).length === 0 && (await odt('<text:p/>')).length === 0);
}

section('the README says what a gap is');
{
  const readme = fs.readFileSync(path.join(REPO, 'src/parse/README.md'), 'utf8');
  ok('src/parse/README.md says a gap right after . ! or ? never splits an item, with the "Acme Inc." example', /after `\.`, `!` or `\?` never does/.test(readme) && readme.includes('Acme Inc.  2019'));
}

section('named entities of Hungarian, Czech and Polish pages, and a PDF header that starts a line');
{
  const enc = s => new TextEncoder().encode(s);
  const got = textOf(readHtml(enc('<p>&odblac;&Odblac;&udblac;&Udblac;&scaron;&Scaron;&ccaron;&Ccaron;&zcaron;&Zcaron;&rcaron;&ecaron;&lstrok;&Lstrok;&nacute;&sacute;&zacute;&aogon;&eogon;&rarr;&larr;&hellip;&bull;&middot;</p>')));
  ok('ő Ő ű Ű š Š č Č ž Ž ř ě ł Ł ń ś ź ą ę → ← … • · are read', got === 'őŐűŰšŠčČžŽřěłŁńśźąę→←…•·', got);
  const kind = s => identify(enc(s), 'a.txt');
  ok('%PDF- at the start of a line in the first 1024 bytes is a PDF (after some lines, or a carriage return), text that mentions it mid-line is text', kind(`${'x'.repeat(500)}\n%PDF-1.4\n`) === 'pdf' && kind('junk\r%PDF-1.7') === 'pdf' && kind('See %PDF- here\nand more') === 'txt' && kind(`${'x'.repeat(2000)}\n%PDF-1.4`) === 'txt');
}

section('documents formatted by hand: no heading styles, the look set on each run');
{
  const enc = s => new TextEncoder().encode(s);
  const big = { sz: 14, b: true };
  // each look is read from Word, ODT and an HTML page (inline styles) as the same resume; the headings ("Professional Work Experience") are in no known words, so only their look finds them
  const looks = {
    'headings 14 pt bold over 11 pt text, the name larger, bullets typed "•" and a tab': {},
    'headings 14 pt, not bold': { head: { sz: 14 } },
    'headings in a colour, bullets typed "-" and a space': { head: { color: '2F5496' }, bullet: 'hyphen' },
    'headings underlined, bullets typed "–"': { head: { u: true }, bullet: 'dash' },
    'headings bold with Word\'s caps setting (typed in mixed case), bullets typed "o" and a tab': { head: { b: true, caps: true }, bullet: 'o' },
    'a job line, its dates and its title in one paragraph (Shift+Enter), bullets "▪"': { br: true, bullet: 'square' },
    'bullets from Word\'s symbol font (w:sym F0B7)': { bullet: 'sym' },
    'bullets typed as U+F0B7 in a Symbol run': { bullet: 'pua' },
    'headings typed with spaced letters ("E X P E R I E N C E"), bullets "*"': { spaced: true, head: { b: true }, bullet: 'star' },
    'no empty paragraph between the jobs': { blanks: false },
    'the sections in a two-row layout table (education and skills left, the jobs right)': { table: true, bullet: 'star' },
  };
  for (const [what, look] of Object.entries(looks)){
    const parts = R.handParts(look);
    const readers = { Word: () => readDocx(R.handWord(parts)), ODT: () => readOdt(R.handOdt(parts)), ...(look.table ? {} : { HTML: () => readHtml(enc(R.handHtml(parts))) }) };
    for (const [name, read] of Object.entries(readers)){
      const got = parseResume(await read());
      ok(`${name}, ${what}: the same JSON Resume as the one-column resume, no leftovers, no doubt`, eq(got.jsonResume, F.oneColumnExpected) && got.leftovers.length === 0 && got.doubts.length === 0, J(got.doubts) + J(got.leftovers) + J(got.jsonResume.work?.map(w => w.name)));
    }
  }

  // the look of the text, item by item
  const body = x => `<w:document xmlns:w="w"><w:body>${x}</w:body></w:document>`;
  const doc = (x, styles = '') => R.zip({ 'word/document.xml': body(x), ...(styles ? { 'word/styles.xml': `<w:styles xmlns:w="w">${styles}</w:styles>` } : {}) });
  const run = (t, pr = '') => `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t>${t}</w:t></w:r>`, para = (t, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${t}</w:p>`;
  const sty = '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Bare"><w:name w:val="Bare"/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Base"><w:name w:val="Base"/><w:rPr><w:sz w:val="28"/><w:color w:val="2F5496"/><w:u w:val="single"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Kid"><w:name w:val="Kid"/><w:basedOn w:val="Base"/><w:rPr><w:caps/><w:color w:val="auto"/></w:rPr></w:style>'
    + '<w:style w:type="character" w:styleId="Link"><w:name w:val="Link"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>';
  const looked = (await readDocx(doc(
    para(run('default')) + para(run('base'), '<w:pStyle w:val="Base"/>') + para(run('kid'), '<w:pStyle w:val="Kid"/>') + para(run('own', '<w:sz w:val="40"/><w:color w:val="FF0000"/><w:u w:val="none"/>'), '<w:pStyle w:val="Base"/>')
    + para(run('link', '<w:rStyle w:val="Link"/>')) + para(run('caps', '<w:caps/>')) + para(run('nocaps', '<w:caps w:val="0"/>'), '<w:pStyle w:val="Kid"/>') + para(run('bare'), '<w:pStyle w:val="Bare"/>'), sty))).map(i => [i.text, i.height, i.color, !!i.underline, !!i.caps]);
  ok('Word: the size of a run is its own, its character style\'s, its paragraph style\'s (and the style that is based on), the default style\'s, then the document\'s default; colour, underline and caps the same ("auto" is no colour)',
    J(looked) === J([['default', 13, undefined, false, false], ['base', 14, '2f5496', true, false], ['kid', 14, undefined, true, true], ['own', 20, 'ff0000', false, false], ['link', 13, '0563c1', true, false], ['caps', 13, undefined, false, true], ['nocaps', 14, undefined, true, false], ['bare', 12, undefined, false, false]]), J(looked));
  ok('Word: with no styles.xml a run is 10 pt, and a size with no value is no size', J((await readDocx(doc(para(run('a')) + para(run('b', '<w:sz/>'))))).map(i => i.height)) === J([10, 10]));
  const odtLook = (await readOdt(R.zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<o xmlns:text="t" xmlns:style="s" xmlns:fo="f"><style:style style:name="H"><style:text-properties fo:font-size="16pt" fo:color="#2F5496" style:text-underline-style="solid" fo:text-transform="uppercase" fo:font-weight="bold"/></style:style><style:style style:name="N"><style:text-properties style:text-underline-style="none" fo:color="#000000" fo:font-size="120%" fo:font-weight="normal"/></style:style><text:p text:style-name="H">Head<text:tab/><text:span text:style-name="N">inner</text:span></text:p><text:p>plain</text:p></o>' }))).map(i => [i.text, i.height, i.color, !!i.underline, !!i.caps, i.fontName]);
  ok('ODT: size (pt), colour, underline and upper case come from the paragraph\'s style with the span\'s over it (black is no colour, a percentage is no size, "none" and "normal" turn off)',
    J(odtLook) === J([['Head', 16, '2f5496', true, true, 'Sans-Bold'], ['inner', 16, undefined, false, true, 'Sans'], ['plain', 10, undefined, false, false, 'Sans']]), J(odtLook));
  const sp = '&nbsp;&nbsp;&nbsp;';
  const htmlLook = readHtml(enc(`<body style="font-size:12pt"><p style="font-size:24px;color:#2F5496;text-decoration: underline">A${sp}<span style="font-size:20pt;text-transform:uppercase;color:black">B</span></p><p><u>C</u>${sp}c</p><div style="font-weight:700"><p style="font-weight:normal">D</p><p>E</p></div><p style="background-color:red">F</p></body>`)).map(i => [i.text, i.height, i.color, !!i.underline, !!i.caps, i.fontName]);
  ok('HTML: an inline style sets size (pt or px), weight, colour, underline and upper case, an element takes its parent\'s, <u> underlines, and background-color is no colour',
    J(htmlLook) === J([['A', 18, '2f5496', true, false, 'Sans'], ['B', 20, undefined, true, true, 'Sans'], ['C', 12, undefined, true, false, 'Sans'], ['c', 12, undefined, false, false, 'Sans'], ['D', 12, undefined, false, false, 'Sans'], ['E', 12, undefined, false, false, 'Sans-Bold'], ['F', 12, undefined, false, false, 'Sans']]), J(htmlLook));

  // typed bullets and symbols, and a line break inside a paragraph
  const tab = '<w:r><w:tab/></w:r>', lines = async xml => textOf(await readDocx(doc(xml)));
  const sym = c => `<w:r><w:sym w:font="Symbol" w:char="${c}"/></w:r>`;
  ok('typed bullets ("•" and a tab, "- ", "▪", "*", "o" and a tab) are list items and the glyph is not text; the symbol-font bullets (w:sym or the character, F0B7, F0A7, F0D8, F0FC, F076) are bullets too',
    await lines(para(run('•') + tab + run('One')) + para(run('- Two')) + para(run('▪ Four')) + para(run('* Five')) + para(run('o') + tab + run('Six'))
      + para(sym('F0B7') + tab + run('Seven')) + para(run('\uf0b7') + tab + run('Eight')) + para(sym('F0A7') + tab + run('Nine')) + para(sym('F0D8') + run(' Ten')) + para(run('\uf0fc Eleven')) + para(sym('F076') + tab + run('Twelve')))
    === '• One\n• Two\n• Four\n• Five\n• Six\n• Seven\n• Eight\n• Nine\n• Ten\n• Eleven\n• Twelve');
  ok('any other symbol (a phone, an envelope, a colon in Wingdings) is no bullet: alone in front of a line\'s text it is dropped, and in the middle of text it stays, as does private-use text of any other script',
    await lines(para(sym('F028') + tab + run('555 0100')) + para(sym('F02A') + run(' jane@example.com')) + para(run('\uf03a Site')) + para(run('Call \uf028 555')) + para(run('a\ue000b'))) === '555 0100\njane@example.com\nSite\nCall \uf028 555\na\ue000b');
  ok('an en dash opens a bullet only when three lines of the document do ("– 2019" once is a dash); a line of only "-" or "•" between text stays as a line',
    await lines(para(run('– 2019 to date')) + para(run('Text'))) === '– 2019 to date\nText' && await lines(para(run('– One')) + para(run('– Two')) + para(run('– Three'))) === '• One\n• Two\n• Three'
    && await lines(para(run('A')) + para(run('- ')) + para(run('B')) + para(run('•') + tab) + para(run('C'))) === 'A\n-\nB\n•\nC');
  ok('text that only starts like a bullet stays text: "o Python" (one space), "-5 degrees", "*Note", "2019 – 2021"', await lines(para(run('o Python')) + para(run('-5 degrees')) + para(run('*Note')) + para(run('2019 – 2021'))) === 'o Python\n-5 degrees\n*Note\n2019 – 2021');
  ok('a line break (Shift+Enter) starts a new line, and a typed bullet after it is a bullet', await lines('<w:p><w:r><w:t>Title</w:t><w:br/><w:t>- Nine</w:t></w:r></w:p>') === 'Title\n• Nine');
  const spaced = textOf(readTxt(enc('E X P E R I E N C E\nW O R K   E X P E R I E N C E\nA B\nA B C\nJ O B S\nJ R R Tolkien\nE X P E R I E N C E 2019\nE x p e r i e n c e\n')));
  ok('spaced capitals of five letters or more are read as their word, spaced words as words; "A B C", "J O B S", initials before a name, lower case and a line with more are text', spaced === 'EXPERIENCE\nWORK EXPERIENCE\nA B\nA B C\nJ O B S\nJ R R Tolkien\nE X P E R I E N C E 2019\nE x p e r i e n c e', spaced);

  // a table: a layout (two rows or fewer, a cell of four lines or more) is read column by column, a data table row by row
  const cells = r => `<w:tr>${r.map(c => `<w:tc>${c.map(t => para(run(t))).join('')}</w:tc>`).join('')}</w:tr>`, tbl = rows => `<w:tbl>${rows.map(cells).join('')}</w:tbl>`;
  const cols = { layout: [[['L1', 'L2'], ['R1', 'R2', 'R3', 'R4']], [['L3'], ['R5']]], rows3: [[['A1'], ['B1']], [['A2'], ['B2']], [['A3'], ['B3']]], short: [[['Skill'], ['Level']], [['Python'], ['Expert']]], long3: [[['A1'], ['B1', 'B2', 'B3', 'B4']], [['A2'], ['B5']], [['A3'], ['B6']]] };
  ok('Word: a layout table is read column by column (L1 L2 L3, then R1 to R5), the paragraphs around it stay where they are', await lines(para(run('Before')) + tbl(cols.layout) + para(run('After'))) === 'Before\nL1\nL2\nL3\nR1\nR2\nR3\nR4\nR5\nAfter');
  ok('Word: a table of three rows, or of two rows with short cells, is data and stays row by row', await lines(tbl(cols.rows3)) === 'A1\nB1\nA2\nB2\nA3\nB3' && await lines(tbl(cols.short)) === 'Skill\nLevel\nPython\nExpert' && await lines(tbl(cols.long3)) === 'A1\nB1\nB2\nB3\nB4\nA2\nB5\nA3\nB6');
  ok('Word: a table inside a cell is part of that cell, and two tables are two', await lines(tbl([[['L1', 'L2'], ['R1', 'R2', 'R3', 'R4']], [['L3'], ['R5']]]).replace('<w:tc><w:p><w:r><w:t>L1', `<w:tc>${tbl([[['in']]])}<w:p><w:r><w:t>L1`) + tbl(cols.short)) === 'in\nL1\nL2\nL3\nR1\nR2\nR3\nR4\nR5\nSkill\nLevel\nPython\nExpert');
  const span = `<w:tbl>${cells([['Jane Q. Sample'], ['jane@example.com', '(555) 010-0100', 'Springfield, IL', 'www.example.com/jane']])}<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${['Experience', 'Acme', 'Engineer', 'Built a bench.'].map(t => para(run(t))).join('')}</w:tc></w:tr></w:tbl>`;
  ok('Word: a header row over a body row that spans both columns (gridSpan) is not a layout: it is read row by row', await lines(span) === 'Jane Q. Sample\njane@example.com\n(555) 010-0100\nSpringfield, IL\nwww.example.com/jane\nExperience\nAcme\nEngineer\nBuilt a bench.');
  const odtTable = rows => `<table:table>${rows.map(r => `<table:table-row>${r.map(c => (c ? `<table:table-cell>${c.map(t => `<text:p>${t}</text:p>`).join('')}</table:table-cell>` : '<table:covered-table-cell/>')).join('')}</table:table-row>`).join('')}</table:table>`;
  const odtLines = async x => textOf(await readOdt(R.zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': `<o xmlns:text="t" xmlns:table="b">${x}</o>` })));
  ok('ODT: a layout table is read column by column (a covered cell is a cell), a data table row by row', await odtLines(odtTable(cols.layout)) === 'L1\nL2\nL3\nR1\nR2\nR3\nR4\nR5' && await odtLines(odtTable(cols.rows3)) === 'A1\nB1\nA2\nB2\nA3\nB3'
    && await odtLines(odtTable([[['A1', 'A2', 'A3', 'A4'], ['B1']], [null, ['B2']]])) === 'A1\nA2\nA3\nA4\nB1\nB2');

  ok('ODT: the same header row over a body cell with table:number-columns-spanned is read row by row',
    await odtLines('<table:table><table:table-row><table:table-cell><text:p>Name</text:p></table:table-cell><table:table-cell><text:p>c1</text:p><text:p>c2</text:p><text:p>c3</text:p><text:p>c4</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell table:number-columns-spanned="2"><text:p>Experience</text:p></table:table-cell><table:covered-table-cell/></table:table-row></table:table>') === 'Name\nc1\nc2\nc3\nc4\nExperience');

  // the parser: a short line alone that is set apart from the body is a section title, with care
  const L = (text, o = {}) => [{ text, x: 0, y: 0, width: 50, height: 10, fontName: 'Sans', hasEOL: true, ...o }];
  const B = o => ({ height: 14, fontName: 'Sans-Bold', ...o });
  const keys = rows => Object.keys(groupLinesIntoSections(rows, withEnglish()));
  const text = [L('Built a bench.'), L('Wrote the plan.'), L('Ran the tests.')];
  const head = [L('Jane', B({ height: 20 })), L('jane.sample@example.com')];
  ok('a short line alone, 14 pt bold over 10 pt text, is a title whatever its words; the name, larger, on the first line is not', J(keys([...head, L('Career Highlights', B()), ...text, L('Open Source', B()), ...text])) === J(['profile', 'Career Highlights', 'Open Source']));
  ok('so is one that is only underlined, or only coloured, unlike the body', J(keys([...head, L('Career Highlights', { underline: true }), ...text, L('Open Source', { underline: true }), ...text])) === J(['profile', 'Career Highlights', 'Open Source']) && J(keys([...head, L('Career Highlights', { color: '2f5496' }), ...text, L('Open Source', { color: '2f5496' }), ...text])) === J(['profile', 'Career Highlights', 'Open Source']));
  ok('only the most emphasised look that two lines have counts, and a line with a dot, a digit or more than four words is no title (an underlined address does not outrank the headings)', J(keys([...head, L('www.example.com/jane', { underline: true, color: '2f5496' }), L('Career Highlights', { underline: true }), ...text, L('A heading that runs to five words', { underline: true }), L('Page 2', { underline: true }), L('Open Source', { underline: true }), ...text])) === J(['profile', 'Career Highlights', 'Open Source']));
  ok('where the rules already find a title ("Experience"), another line with its look is a title only if it has a title word: "Professional Work Experience" is, "Career Highlights" is not', J(keys([...head, L('Experience', B()), ...text, L('Professional Work Experience', B()), ...text, L('Career Highlights', B()), ...text])) === J(['profile', 'Experience', 'Professional Work Experience']));
  ok('a heading a reader marked (title) is trusted alone: no line is a title by its look then', J(keys([...head, L('Education', B({ title: true })), ...text, L('Professional Work Experience', B()), ...text])) === J(['profile', 'Education']));
  ok('the look of the titles the rules already find is the look to match: a plain "Experience" means an underlined line is no title', J(keys([...head, L('Experience'), ...text, L('Professional Work Experience', { underline: true }), ...text])) === J(['profile', 'Experience']));
  ok('a bold line set in capitals by its style (typed in mixed case) is a title by the old rule, caps or not, and so is a typed one', J(keys([...head, L('Experience', B({ title: true, height: 10 })), ...text, L('Career Highlights', { fontName: 'Sans-Bold', caps: true }), ...text, L('SOFTWARE', { fontName: 'Sans-Bold' }), ...text, L('Software', { fontName: 'Sans-Bold' }), ...text])) === J(['profile', 'Experience', 'Career Highlights', 'SOFTWARE']));
  ok('more than ten lines with the same look are not section titles', keys([...head, ...Array.from({ length: 11 }, (_, k) => [L(`Company ${'ABCDEFGHIJK'[k]}`, B()), ...text]).flat()]).length === 1);
  ok('a line with two items (a company and its date) is no title, and neither is one in the body\'s own look', J(keys([...head, [...L('Acme', B({ hasEOL: false })), ...L('2020', { x: 300 })], ...text, L('Open Source'), ...text])) === J(['profile']));
  // bold capital headings at body size: a bold company or job title alone on its line, with a title word inside it, is no section (the work history was lost to it)
  const rows = (...r) => r.flatMap((x, k) => (x ? [{ text: x.t ?? x, x: 0, y: -k, width: 50, height: x.h ?? 10, fontName: x.b ? 'Sans-Bold' : 'Sans', hasEOL: true }] : []));
  const cap = t => ({ t, b: 1 });
  const jobsOf = (a, b) => parseResume(rows('Jane Q. Sample', 'jane.sample@example.com', cap('WORK EXPERIENCE'), a, 'Mar 2021 – Present', '• Led the redesign of the dose counter.', null, b, '2018 – 2021', '• Ran the tolerance study.', null, cap('EDUCATION'), 'Lakeside State University', '2010 – 2014')).jsonResume.work?.map(w => w.name).join(' | ');
  for (const [a, b] of [['Workday', 'Network Rail'], ['Framework Labs', 'Teamwork Inc'], ['Art History Museum', 'Honor Society Group']])
    ok(`bold companies "${a}" and "${b}" next to bold capital headings are companies, not sections`, jobsOf(cap(a), cap(b)) === `${a} | ${b}`, jobsOf(cap(a), cap(b)));
  const pm = parseResume(rows('Jane Q. Sample', 'jane.sample@example.com', cap('WORK EXPERIENCE'), cap('Head of Projects'), 'Acme Corp', 'Mar 2021 – Present', '• Led the redesign.', null, cap('Team Lead Projects'), 'Beta Works', '2018 – 2021', '• Ran the shop.')).jsonResume.work;
  ok('and so are a bold "Head of Projects" and "Team Lead Projects" (they hold a job-title word): both jobs are found', pm?.length === 2, J(pm));
  const exp = [...head, L('EXPERIENCE', B())];
  ok('"Hudson Works" and "Iron Works" (bold companies, "Works" is no title word) next to a bold capital heading are companies: both jobs are found', jobsOf(cap('Hudson Works'), cap('Iron Works')) === 'Hudson Works | Iron Works', jobsOf(cap('Hudson Works'), cap('Iron Works')));
  ok('"Technical Skills", "Short Courses", "Key Projects" and "Honors and Awards" are still titles beside a known one, by their plural', J(keys([...exp, ...text, L('Technical Skills', B()), ...text, L('Short Courses', B()), ...text, L('Key Projects', B()), ...text, L('Honors and Awards', B()), ...text])) === J(['profile', 'EXPERIENCE', 'Technical Skills', 'Short Courses', 'Key Projects', 'Honors and Awards']));
  const itKeys = keys => Object.keys(groupLinesIntoSections(keys, withEnglish(lexiconFor('it'))));
  ok('Italian: a bold company of three words that ends in "Premier" is no title though the catalogue has "premi" (awards); "Premi" is one', lexiconFor('it').titleWords.includes('premi') && J(itKeys([...head, L('ESPERIENZA', B()), ...text, L('Rossi Foods Premier', B()), ...text, L('Premi', B()), ...text])) === J(['profile', 'ESPERIENZA', 'Premi']), J(itKeys([...head, L('ESPERIENZA', B()), ...text, L('Rossi Foods Premier', B()), ...text, L('Premi', B()), ...text])));
  const sized = [...head, L('Career Highlights', B({ height: 16 })), L('Acme Corp', B({ height: 12 })), ...text, L('Open Source', B({ height: 16 })), L('Beta Corp', B({ height: 12 })), ...text];
  ok('the size ranks by how much larger it is: 16 pt headings over 12 pt bold companies over 10 pt text, the companies are no titles', J(keys(sized)) === J(['profile', 'Career Highlights', 'Open Source']), J(keys(sized)));
  ok('headings that are only bold at the body\'s size (words unknown) are titles', J(keys([...head, L('Career Highlights', B({ height: 10 })), ...text, L('Open Source', B({ height: 10 })), ...text])) === J(['profile', 'Career Highlights', 'Open Source']));
  const tag = L('Quality and Craft', { height: 14 }), lnk = { underline: true, color: '0563c1' };
  ok('a tagline set larger on its own, or one lone link, does not set the look: the look must be on two lines', J(keys([...head, tag, ...text, L('Career Highlights', B({ height: 10 })), ...text, L('Open Source', B({ height: 10 })), ...text, L('LinkedIn', lnk)])) === J(['profile', 'Career Highlights', 'Open Source']));
  ok('links never set the look: two hyperlinks (a flag, or a profile-site word) in blue and underlined, among bold headings', J(keys([...head, L('Resume Online', { ...lnk, link: true }), L('Case Studies', { ...lnk, link: true }), L('LinkedIn', lnk), L('GitHub', lnk), L('Career Highlights', B({ height: 10 })), ...text, L('Open Source', B({ height: 10 })), ...text])) === J(['profile', 'Career Highlights', 'Open Source']));
  ok('the contact block never sets the look: two larger lines above the e-mail line are not titles', J(keys([L('Jane', B({ height: 20 })), L('Writer'), L('Springfield Illinois', { height: 14 }), L('Open Studio', { height: 14 }), L('jane@example.com'), L('Career Highlights', B({ height: 10 })), ...text, L('Open Source', B({ height: 10 })), ...text])) === J(['profile', 'Career Highlights', 'Open Source']));

  const link = [...(await readDocx(doc(para(`<w:hyperlink r:id="x" xmlns:r="r">${run('Site')}</w:hyperlink>`) + para(run('Plain'))))), ...(await readOdt(R.zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<o xmlns:text="t" xmlns:xlink="x"><text:p><text:a xlink:href="u">Site</text:a></text:p><text:p>Plain</text:p></o>' }))), ...readHtml(enc('<p><a href="u">Site</a></p><p>Plain</p>'))].map(i => !!i.link);
  ok('Word (w:hyperlink), ODT (text:a) and HTML (a) mark the item of a link', J(link) === J([true, false, true, false, true, false]), J(link));

  // a hostile file does not freeze the page: one line of 100,000 runs, many items on a line, and very many lines
  const timed = async f => { const t0 = Date.now(); await f(); return Date.now() - t0; };
  const longRuns = R.zip({ 'word/document.xml': `<w:document xmlns:w="w"><w:body><w:p>${Array.from({ length: 100000 }, (_, k) => `<w:r><w:t>w${k}</w:t></w:r>`).join('')}</w:p></w:body></w:document>` });
  const t1 = await timed(async () => { const it = await readDocx(longRuns); ok('one line of 100,000 runs is one item of 600 KB', it.length === 1 && it[0].text.length > 500000); parseResume(it); });
  const t2 = await timed(() => parseResume(readTxt(enc(Array.from({ length: 40000 }, (_, k) => `line ${k} Mar 2020`).join('\n')))));
  const t3 = await timed(() => parseResume(readTxt(enc('@'.repeat(100000) + ' ' + 'http://'.repeat(20000) + ' ' + 'a.'.repeat(50000) + ' ' + 'Ab'.repeat(50000)))));
  ok('and it is read in a few seconds, not minutes: 100,000 runs on a line, 40,000 lines, and e-mail, url and city look-alikes of 100,000 characters', t1 < 3000 && t2 < 3000 && t3 < 3000, `${t1} ${t2} ${t3} ms`);

  // styles that point at each other, or at nothing
  const loop = (await readDocx(doc(para(run('a'), '<w:pStyle w:val="A"/>') + para(run('b'), '<w:pStyle w:val="Nope"/>'), '<w:style w:type="paragraph" w:styleId="A"><w:name w:val="A"/><w:basedOn w:val="B"/></w:style><w:style w:type="paragraph" w:styleId="B"><w:name w:val="B"/><w:basedOn w:val="A"/><w:rPr><w:sz w:val="30"/></w:rPr></w:style>'))).map(i => i.height);
  ok('a style based on itself through another, and a style that is not there, end: the first takes the size of the one it is based on, the second the default', J(loop) === J([15, 10]), J(loop));
  // prose: a cover letter is a letter, and paragraphs in a resume are left over whole
  const letterEn = `Jane Q. Sample\n12 Elm Street, Springfield, IL\n\n1 November 2026\n\nHiring Manager\nNorthgate Dosing Systems\n\nDear Hiring Manager,\n\nI am writing to apply for the post of mechanical design engineer that you advertised last week. My work so far has been the design of dosing devices, from the first sketch to the production line.\n\nAt my last employer I led the redesign of an inhaler dose counter. The project taught me to work closely with clinical teams and with suppliers who have to make the parts at a fair price.\n\nI would bring the same care to your team, and I would enjoy learning from your engineers. I am used to writing clear work instructions and to teaching others how to use them.\n\nThank you for your time and for considering my application. I would be glad to talk about it at an interview.\n\nSincerely,\nJane Q. Sample\n`;
  const letterDe = `Anna Beispiel\nMusterweg 4, 80331 München\n\n1. November 2026\n\nFeinmess Instrumente GmbH\nPersonalabteilung\n\nSehr geehrte Damen und Herren,\n\nmit großem Interesse habe ich Ihre Stellenanzeige für einen Konstrukteur gelesen und bewerbe mich hiermit um die ausgeschriebene Position in Ihrem Haus.\n\nIn meiner bisherigen Tätigkeit habe ich Dosiergeräte entwickelt, von der ersten Skizze bis zur Serienfertigung. Dabei habe ich eng mit Kliniken und mit Zulieferern zusammengearbeitet.\n\nGerne bringe ich diese Erfahrung auch bei Ihnen ein. Ich bin es gewohnt, klare Arbeitsanweisungen zu schreiben und Kollegen in neue Verfahren einzuarbeiten.\n\nÜber eine Einladung zu einem persönlichen Gespräch freue ich mich sehr und stehe Ihnen jederzeit gern für Rückfragen zur Verfügung.\n\nMit freundlichen Grüßen\nAnna Beispiel\n`;
  const kinds = r => r.doubts.map(d => d.kind);
  for (const [what, letter] of [['English', letterEn], ['German', letterDe]]){
    const got = kinds(parseResume(readTxt(enc(letter)), lexiconFor(what === 'German' ? 'de' : 'en')));
    ok(`an invented ${what} cover letter (salutation, four paragraphs, sign-off) gives the letter doubt and no jobs doubt`, got.includes('letter') && !got.includes('jobs'), J(got));
  }
  const noLetter = r => !kinds(r).includes('letter');
  const longSummary = F.oneColumn.map(i => (i.text.startsWith('Mechanical engineer who') ? { ...i, text: 'Mechanical engineer who builds dosing devices for clinical teams, from the first sketch to the production line, and who enjoys teaching others how to read a drawing.', width: 600 } : i));
  ok('a resume with a long summary paragraph is no letter, and a file of one prose paragraph and no headings is none either', noLetter(parseResume(longSummary)) && noLetter(parseResume(readTxt(enc(`Jane Q. Sample\njane.sample@example.com\n(555) 010-0100\nSpringfield, IL\n${letterEn.split("\n\n")[4]}\nAcme\nTechnician\nRepairs\nBench\nTools\nParts\n`)))));
  const paras = letterEn.split("\n\n").slice(4, 8);
  ok('fewer than three prose paragraphs (one, or two) is no letter, and neither is a file of three whose text is mostly short lines', noLetter(parseResume(readTxt(enc(`Jane Q. Sample\n\n${paras[0]}\n`)))) && noLetter(parseResume(readTxt(enc(`Jane Q. Sample\n\n${paras.slice(0, 2).join('\n\n')}\n`))))
    && noLetter(parseResume(readTxt(enc(`Jane Q. Sample\n${paras.slice(0, 3).join('\n')}\n${Array.from({ length: 150 }, (_, k) => `Item ${k}`).join('\n')}\n`)))));
  ok('a file with prose paragraphs and no headings but a dated job line (a date range) is no letter: it gets the jobs doubt', (r => noLetter(r) && kinds(r).includes('jobs'))(parseResume(readTxt(enc(letterEn.replace('Sincerely,', 'Acme Corp   2018 – 2021\nSincerely,'))))));
  ok('a letter with two section titles in it ("EXPERIENCE" and "EDUCATION") is a resume, not a letter', noLetter(parseResume(readTxt(enc(letterEn.replace('Dear Hiring Manager,', 'EXPERIENCE\nDear Hiring Manager,').replace('Sincerely,', 'EDUCATION\nSincerely,'))), lexiconFor('en'))));
  const dateds = { 'numeric months (03/2019 – 05/2021)': ['03/2019 – 05/2021'], 'Hungarian months (2019. március – 2021. június)': ['2019. március – 2021. június'], 'years joined by a dash (2018-2021)': ['2018-2021'] };
  for (const [what, [d1]] of Object.entries(dateds)){
    const cv = `Jane Q. Sample\njane.sample@example.com\n${d1}\nLed the redesign of the inhaler dose counter from the first sketch to the production line at a maker of dosing devices.\nRan the tolerance study for a disposable cartridge across three suppliers and cut the rejects on the line by a third.\nBerlin\nBuilt the fixtures for the flow tests and wrote the work instructions for the bench, teaching the technicians to read a drawing.\nWorked with clinical teams and two suppliers on every release and kept the records for each audit.\nSpringfield\nIllinois\nOne\nTwo\n`;
    const got = kinds(parseResume(readTxt(enc(cv))));
    ok(`a headingless resume of long unbulleted lines with dates in ${what} is no letter, and gets the jobs doubt`, !got.includes('letter') && got.includes('jobs'), J(got));
  }
  ok('two lines with a year are dated (a letter\'s own date line is one, a year in a paragraph makes two)', noLetter(parseResume(readTxt(enc(letterEn.replace('I am writing', 'In 2019 I joined a team of engineers and I am writing'))))));
  const subject = parseResume(readMd(enc(letterEn.replace('Dear Hiring Manager,', '**APPLICATION**\n\nDear Hiring Manager,')))), subjectKinds = kinds(subject);
  ok('a letter with one bold subject line in capitals ("APPLICATION") is still a letter, with no jobs doubt', subjectKinds.includes('letter') && !subjectKinds.includes('jobs'), J(subjectKinds));
  ok('the letter with its date in the first lines ("Lakeside, 9 May 2025") is still a letter', kinds(parseResume(readTxt(enc(letterEn.replace('1 November 2026', 'Lakeside, 9 May 2025'))))).includes('letter') && kinds(parseResume(readTxt(enc(letterEn)))).includes('letter'));
  const pc = parseResume(F.proseColumns);
  const words = t => t.toLowerCase().match(/\p{L}+/gu) ?? [];
  const wanted = F.proseColumns.filter(i => i.x >= 200 && i.y < 700).map(i => i.text).join(' ');
  ok('a two-column CV whose experience is three wrapped paragraphs with one year in them: no job is made of them, each paragraph is one leftover with its section and first line, the jobs doubt is raised (not the letter doubt)',
    !pc.jsonResume.work && pc.leftovers.length === 3 && pc.leftovers.every(l => l.section === 'WORK EXPERIENCE') && J(pc.leftovers.map(l => l.line)) === J([11, 14, 17]) && kinds(pc).includes('jobs') && noLetter(pc) && !kinds(pc).includes('dates'), J(pc.leftovers.map(l => l.line)) + J(kinds(pc)));
  ok('and nothing is lost: every word of the three paragraphs is in the leftovers', J(words(pc.leftovers.map(l => l.text).join(' '))) === J(words(wanted)));
  const pj = parseResume(F.proseUnderJob);
  ok('a paragraph under a dated job line is that job\'s text: the job is found, with the paragraph in its highlights and no leftover for it, and no jobs doubt', pj.jsonResume.work?.length === 1 && pj.jsonResume.work[0].name === 'Northgate Dosing Systems' && pj.jsonResume.work[0].startDate === '2021-03' && words(pj.jsonResume.work[0].highlights.join(' ')).includes('suppliers') && pj.leftovers.length === 0 && !kinds(pj).includes('jobs'), J(pj.jsonResume.work) + J(pj.leftovers));
  const flat = n => readTxt(enc(Array.from({ length: n }, (_, k) => `Line ${'abcdefghijklmnop'[k]}`).join('\n'))), noJobs = n => parseResume(flat(n)).doubts.map(d => d.kind);
  ok('a file of more than ten lines with no job found raises the doubt "jobs"; a short one, or one with jobs, does not', noJobs(12).includes('jobs') && !noJobs(10).includes('jobs') && !parseResume(F.oneColumn).doubts.some(d => d.kind === 'jobs'), J(noJobs(12)));
}

// ———— I-5: PDF ————
// The fixtures in checks/fixtures/import/ are one resume (data/example.json with the Helix saved resume) set by each producer: Word, Google Docs, LibreOffice, Pages, Affinity, BrewCV's own
// export (the B2 look: its section names in the left margin) and Chrome (the Classic looks, through scripts/export-pdf.mjs), in one column and in two; and the Word, Google Docs and
// LibreOffice DOCX and ODT of the same text. Their metadata is stripped (Info, XMP, docProps, meta.xml): nothing in them but the fictional text. The Pages and Affinity files are the PDFs those apps
// export (a modern .pages file holds a picture of page 1, not a PDF: see "what a file is").
const FIX = path.join(REPO, 'checks/fixtures/import');
const fixture = f => new Uint8Array(fs.readFileSync(path.join(FIX, f)));
const record = readLibrary(path.join(REPO, 'data/example.json')).model;
const helix = readRecipe(path.join(REPO, 'data/example-resumes/Helix Diagnostics - Product Development Engineer.json'), record).recipe;
const want = resolve(record, helix, { local: false }).body;
const wantBullets = want.work.flatMap(w => w.highlights ?? []);
const recordWords = [...new Set(JSON.stringify(record).toLowerCase().match(/\p{L}+/gu))];      // what the app passes to readPdf: the record's own words
// what a reading got of the example: the bullets word for word (after normText), each job's dates, the name and the email; `short` lists what falls short
function score(jr){
  const got = (jr.work ?? []).flatMap(w => w.highlights ?? []).map(normText);
  const bullets = wantBullets.filter(b => got.includes(normText(b)));
  const dates = want.work.filter(w => (jr.work ?? []).some(g => g.startDate === w.startDate && g.endDate === w.endDate));
  // the company and the position of each job, with its dates: the right entry, not a title read as a company
  const jobs = want.work.filter(w => (jr.work ?? []).some(g => g.startDate === w.startDate && normText(g.name) === normText(w.name) && normText(g.position) === normText(w.position)));
  const bs = jr.basics ?? {}, name = bs.name === want.basics.name, email = bs.email === want.basics.email;
  const contact = bs.phone === want.basics.phone && String(bs.url ?? '').replace(/^https?:\/\//, '') === want.basics.url.replace(/^https?:\/\//, '') && bs.location?.city === want.basics.location.city;
  const short = [...wantBullets.filter(b => !bullets.includes(b)).map(b => `bullet "${b.slice(0, 40)}…"`), ...want.work.filter(w => !dates.includes(w)).map(w => `dates of "${w.position}"`), ...want.work.filter(w => !jobs.includes(w)).map(w => `company or position of "${w.position}"`),
    ...(name ? [] : ['the name']), ...(email ? [] : ['the email']), ...(contact ? [] : ['the phone, url or city'])];
  return { bullets: bullets.length, dates: dates.length, jobs: jobs.length, name, email, contact, short, pass: bullets.length >= 0.95 * wantBullets.length && dates.length === want.work.length && jobs.length === want.work.length && name && email && contact };
}
const board = [];      // the score of every file, for the table at the end

section('PDF: every producer reads, in Node, with the vendored PDF.js');
{
  const pdfs = fs.readdirSync(FIX).filter(f => f.endsWith('.pdf')).sort();
  ok('the fixtures are the eleven PDFs: Word, Google Docs, LibreOffice, Pages and BrewCV in one column, Chrome too, and Affinity, LibreOffice, Pages, Word and Chrome in two', J(pdfs.map(f => f.replace(/^helix-|\.pdf$/g, ''))) === J(['1col-brewcv', '1col-chrome', '1col-gdocs', '1col-libreoffice', '1col-pages', '1col-word', '2col-affinity', '2col-chrome', '2col-libreoffice', '2col-pages', '2col-word']), pdfs.join(', '));
  for (const f of pdfs){
    const items = await readPdf(fixture(f), recordWords), got = parseResume(items), s = score(got.jsonResume);
    board.push([f.replace(/^helix-|\.pdf$/g, ''), s]);
    ok(`${f}: ${s.bullets} of ${wantBullets.length} bullets word for word, ${s.dates} of ${want.work.length} jobs with their dates, ${s.jobs} with company and position, the name, email, phone, url and city`, s.pass, `falls short: ${s.short.join('; ')}`);
    if (!s.pass) console.log(`      falls short: ${s.short.join('; ')}`);
  }
  const paged = await readPdf(fixture('helix-1col-word.pdf'));
  ok('an item carries its page, and y starts again on each: Word puts the last language on page 2, at the top', paged.some(i => i.page === 1) && paged.some(i => i.page === 2 && i.text === 'Hungarian: B1' && i.y > 700), J(paged.filter(i => i.page === 2)));
  const word = paged;
  ok('the font name is the real one, and bold is told from it: the name in Word is TimesNewRomanPS-Bold at 20 pt', word.some(i => i.text === 'Dana Okonkwo' && /Bold/.test(i.fontName) && i.height === 20), J(word.slice(0, 2)));
  // the hyphen at a line end: the Pages files hyphenate "suppliers" as "sup-" and "pliers"
  const pagesWith = parseResume(await readPdf(fixture('helix-1col-pages.pdf'), recordWords)).jsonResume.work[0].highlights, pagesWithout = parseResume(await readPdf(fixture('helix-1col-pages.pdf'))).jsonResume.work[0].highlights;
  ok('a word split at a line end is joined when the record knows it ("suppliers"), and the hyphen stays when nothing says it is a split word', pagesWith.some(h => h.includes('moulding suppliers behind')) && pagesWithout.some(h => h.includes('moulding sup-pliers behind')), J([pagesWith[1], pagesWithout[1]]));
  const lone = await readPdf(fixture('helix-1col-chrome.pdf'));
  ok('a browser\'s own hyphen at a line end (a lone "-" item: "quali" and "fied") is a split word', textOf(lone).includes('and qualified the moulding'), '');
}

section('PDF: DOCX and ODT files as Word, Google Docs and LibreOffice write them');
{
  const files = fs.readdirSync(FIX).filter(f => /\.(docx|odt)$/.test(f)).sort();
  ok('the fixtures are four DOCX (Word for the web, Google Docs, LibreOffice twice) and four ODT (Word and LibreOffice, one column and two)', files.length === 8, files.join(', '));
  for (const f of files){
    const items = await (f.endsWith('.docx') ? readDocx : readOdt)(fixture(f)), got = parseResume(items), s = score(got.jsonResume);
    board.push([f.replace(/^helix-/, ''), s]);
    ok(`${f}: ${s.bullets} of ${wantBullets.length} bullets, ${s.dates} of ${want.work.length} jobs dated, ${s.jobs} with company and position, the name, email, phone, url and city; ${(got.jsonResume.work ?? []).length} jobs, ${got.leftovers.length} leftovers`, s.pass, `falls short: ${s.short.join('; ')}`);
    if (s.short.length) console.log(`      falls short: ${s.short.join('; ')}`);
  }
}

section('PDF: one resume in a PDF and in a DOCX or an ODT is one document');
{
  const as = async f => textOf(await (f.endsWith('.pdf') ? readPdf(fixture(f), recordWords) : f.endsWith('.docx') ? readDocx(fixture(f)) : readOdt(fixture(f))));
  for (const [a, b] of [['helix-1col-word.pdf', 'helix-1col-word.docx'], ['helix-1col-gdocs.pdf', 'helix-1col-gdocs.docx'], ['helix-1col-libreoffice.pdf', 'helix-1col-libreoffice.docx'], ['helix-2col-libreoffice.pdf', 'helix-2col-libreoffice.docx'],
    ['helix-1col-word.pdf', 'helix-1col-word.odt'], ['helix-2col-word.pdf', 'helix-2col-word.odt'], ['helix-1col-libreoffice.pdf', 'helix-1col-libreoffice.odt'], ['helix-2col-libreoffice.pdf', 'helix-2col-libreoffice.odt']]){
    const ta = await as(a), tb = await as(b), mine = new Set(ta.split('\n').map(normText).filter(Boolean)), theirs = new Set(tb.split('\n').map(normText).filter(Boolean));
    const shared = [...mine].filter(l => theirs.has(l)).length;
    ok(`${a} and ${b}: ${shared} of ${mine.size} lines are the same, and sameDocument links them`, sameDocument({ documents: [{ text: tb }] }, ta) !== null, `${shared}/${mine.size} vs ${theirs.size}: ${[...mine].filter(l => !theirs.has(l)).slice(0, 3).join(' | ')}`);
  }
  ok('and a PDF of another text is not linked to it', sameDocument({ documents: [{ text: await as('helix-1col-word.docx') }] }, textOf(F.oneColumn)) === null);
}

section('PDF: what the reader repairs, on small PDFs written here (checks/lib/pdf.mjs)');
{
  const T = (x, y, text, o = {}) => ({ x, y, text, ...o });
  const rows = async (items, words) => textOf(await readPdf(pdf([items]), words)).split('\n');
  // three lines of one bullet, wrapped at the right edge, then a second bullet, a heading and a short line
  const l1 = 'Led the dose-counter redesign on an inhaler running four hundred thousand units a year and', l2 = 'cut the part count from nine to five, taking two weeks out of the tooling schedule for the';
  const bulleted = [T(57, 700, '\x95'), T(78, 700, l1), T(78, 687, l2), T(78, 674, 'whole team.'), T(57, 648, '\x95'), T(78, 648, 'Built the rig.'), T(57, 600, 'Skills', { bold: true }), T(57, 587, 'Python, MATLAB'), T(57, 574, 'Git, Excel')];
  const got = await rows(bulleted);
  ok('the lines a page wrapped are one line: a bullet of three lines is one, and the next bullet, a heading and two short lines are not joined to it', J(got) === J([`• ${l1} ${l2} whole team.`, '• Built the rig.', 'Skills', 'Python, MATLAB', 'Git, Excel']), J(got));
  const para = await rows([T(57, 700, l1), T(57, 687, l2), T(57, 674, 'whole team.'), T(57, 640, l1), T(57, 627, 'second paragraph.')]);
  ok('a paragraph with no bullet joins the same way, and a gap wider than a line starts the next paragraph', J(para) === J([`${l1} ${l2} whole team.`, `${l1} second paragraph.`]), J(para));
  const longA = 'Worked with the supply team on the new dose counter for the clinic in the north, and the co-';
  const hyA = await rows([T(57, 700, longA), T(57, 687, 'operation of the whole group.')], ['cooperation']);
  const hyB = await rows([T(57, 700, longA), T(57, 687, 'operation of the whole group.')]);
  ok('a hyphen at a line end goes when the joined word is known ("cooperation"), and stays when nothing says so, as a compound does', hyA.length === 1 && hyA[0].includes('the cooperation of the whole') && hyB.length === 1 && hyB[0].includes('the co-operation of the whole'), J([hyA, hyB]));
  const self = await rows([T(57, 700, 'Worked with the supply team on the new dose counter for the clinic in the north, as a self-'), T(57, 687, 'managed group of three engineers.')]);
  ok('a compound split at its hyphen ("self-managed") keeps it', self.length === 1 && self[0].includes('a self-managed group'), J(self));
  const glue = a => readPdf(pdf([[T(57, 700, 'EU patent holder', { bold: true }), T(57 + 80.01 + 3, 700, a)]]));
  const withPunct = await glue('. Spent'), withWord = await glue('Spent');
  ok('a space PDF.js made from a gap (a word in another font, 3 pt on) is part of the text, except before a full stop, a comma, a semicolon or a colon', J(withPunct.map(i => i.text)) === J(['EU patent holder. Spent']) && J(withWord.map(i => i.text)) === J(['EU patent holder Spent']), J([withPunct.map(i => i.text), withWord.map(i => i.text)]));
  const spaced = await rows([T(57, 700, 'E X P E R I E N C E', { bold: true }), T(57, 680, 'P A T E N T', { bold: true }), T(57, 660, 'CAD & 3D'), T(57, 640, 'A B C')]);
  ok('letter-spaced capitals are one word ("E X P E R I E N C E"), but "CAD & 3D" and "A B C" are not', J(spaced) === J(['EXPERIENCE', 'PATENT', 'CAD & 3D', 'A B C']), J(spaced));
  // a label in the margin, beside the first line of its section, and the lines of the text at x = 130
  const labels = await rows([T(130, 700, 'Design Engineer', { bold: true }), T(130, 686, 'Hydra Medical, Mar 2023'), T(130, 660, 'Planned the formative usability studies and wrote the design history file for the whole team'), T(40, 620, 'SKILLS', { size: 8, bold: true }), T(130, 620, 'CAD and 3D', { bold: true }), T(130, 606, 'SolidWorks, Creo, Fusion 360 and the rest of the tools the team used on the line every day')]);
  ok('a label in the left margin beside a line is a line of its own, before it (and the text stays one column for the parser)', labels.indexOf('SKILLS') === labels.indexOf('CAD and 3D') - 1 && labels.includes('SKILLS'), J(labels));
  const layout = layoutOf(await readPdf(pdf([[T(130, 700, 'Design Engineer', { bold: true }), T(130, 686, 'Hydra Medical, Mar 2023'), T(130, 672, 'Planned the formative usability studies and wrote the design history file for the whole team'), T(40, 620, 'SKILLS', { size: 8, bold: true }), T(130, 620, 'CAD and 3D', { bold: true }), T(40, 560, 'PATENT', { size: 8, bold: true }), T(130, 560, 'Dose counter'), T(130, 546, 'Co-inventor'), T(40, 500, 'EDUCATION', { size: 8, bold: true }), T(130, 500, 'M.Eng. Porto')]])));
  ok('margin labels sit at the text\'s edge, so the parser guesses no column for them', layout.layout.every(g => g.split === undefined) && layout.doubts.length === 0, J(layout));
  // a page written in a jumbled order is put top to bottom; two columns written one after the other are left as they are
  const jumbled = await rows([T(57, 500, 'Fourth line'), T(57, 600, 'Third line'), T(57, 400, 'Sixth line'), T(57, 700, 'First line'), T(57, 450, 'Fifth line'), T(57, 650, 'Second line')]);
  ok('a page written in a jumbled order is put top to bottom', J(jumbled) === J(['First line', 'Second line', 'Third line', 'Fourth line', 'Fifth line', 'Sixth line']), J(jumbled));
  const cols = await rows([T(57, 700, 'Left one'), T(57, 686, 'Left two'), T(57, 672, 'Left three'), T(300, 700, 'Right one'), T(300, 686, 'Right two'), T(300, 672, 'Right three')]);
  ok('two columns written one after the other are not re-sorted', J(cols) === J(['Left one', 'Left two', 'Left three', 'Right one', 'Right two', 'Right three']), J(cols));
  // lines that are not wrapped ones: a heading in another font under a full line, and a short line of a list before a long capitalised word
  const head1 = await rows([T(57, 700, l1), T(57, 687, 'Skills', { bold: true }), T(57, 674, 'Python and MATLAB')]);
  ok('a bold heading of the same size under a full line is not joined to it, nor the line under it to the heading', J(head1) === J([l1, 'Skills', 'Python and MATLAB']), J(head1));
  const col = await rows([T(57, 720, 'Portuguese citizen with a work permit'), T(57, 660, 'Mechanical design'), T(57, 647, 'Internationalisation of products')]);
  ok('a short line of a column (under 60 percent of it) followed by a capitalised word too long for what is left is not joined to it', col.length === 3, J(col));
  // pages
  const two = await readPdf(pdf([[T(57, 700, 'Page one text')], [T(57, 700, 'Page two text')]]));
  ok('pages follow each other, each item with its page, and y starts again on each', J(two.map(i => [i.page, i.y, i.text])) === J([[1, 700, 'Page one text'], [2, 700, 'Page two text']]), J(two));
  // codes
  const code = async b => { try { await readPdf(b); return 'read'; } catch (e){ return e.code; } };
  ok('a file that is not a PDF is refused with the code pdf, and more than 30 pages with big', await code(new TextEncoder().encode('not a pdf at all')) === 'pdf' && await code(pdf(Array.from({ length: 31 }, () => []))) === 'big');
  ok('a password-protected PDF is refused with the code encrypted', await code(pdf([[T(57, 700, 'x')]], { encrypt: true })) === 'encrypted');
  ok('a page PDF.js cannot get (a page tree that points at nothing) is the code pdf, not a bare error', await code(Uint8Array.from(Buffer.from(Buffer.from(pdf([[T(57, 700, 'x')]])).toString('latin1').replace(/\/Kids \[\d+ 0 R\]/, '/Kids [99 0 R]'), 'latin1'))) === 'pdf');
  const t0 = Date.now(), flood = await code(pdf([Array.from({ length: 100000 }, (_, k) => T(57 + (k % 400), 10 + (k % 800), 'a')), [T(57, 700, 'two')]]));
  ok('a PDF with 100,000 text items on a page is refused with the code big, quickly (the cap is 10,000 a page and 30,000 in all)', flood === 'big' && Date.now() - t0 < 15000, `${flood} in ${Date.now() - t0} ms`);
  ok('a PDF with 31 pages of 1,000 items is refused too (pages first), and 12 pages of 2,900 items by the total', await code(pdf(Array.from({ length: 31 }, () => []))) === 'big' && await code(pdf(Array.from({ length: 12 }, () => Array.from({ length: 2900 }, (_, k) => T(57 + (k % 400), 10 + (k % 800), 'a'))))) === 'big');
}

section('PDF: the parser on what a PDF gives it (page breaks, headings with wide gaps, no bullet marks)');
{
  const I = (text, y, o = {}) => ({ text, x: 57, y, width: text.length * 5, height: 10, fontName: o.bold ? 'Arial-Bold' : 'Arial', hasEOL: true, page: 1, ...o });
  const head = [I('Jane Q. Sample', 780, { bold: true }), I('jane.sample@example.com', 766), I('EXPERIENCE', 740, { bold: true })];
  const two = parseResume([...head, I('Design Engineer', 716, { bold: true }), I('Northgate Dosing Systems · Mar 2021 – Present', 690), I('• Led the redesign of the dose counter on an inhaler that runs four hundred thousand units a year', 663), I('• Built the test rig the team now uses for verification of every new part that comes in', 650),
    I('• Wrote the protocols for the rig and trained the team to run them on every shift that is planned', 637), I('Prototyping Technician', 599, { bold: true }), I('Polytechnic Lab · Sep 2019 – Feb 2021', 573), I('• Ran a seven-machine prototyping shop with four FDM printers, a resin printer and a mill', 546)]).jsonResume.work;
  ok('a title, a date line and a list set apart by wide gaps (as Affinity and Word set them) are one job each, with the dates and the bullets', two?.length === 2 && two[0].highlights?.length === 3 && two[0].startDate === '2021-03' && two[1].highlights?.length === 1 && two[1].startDate === '2019-09', J(two));
  const flat = parseResume([...head, I('Design Engineer', 716, { bold: true }), I('NORTHGATE DOSING SYSTEMS · MAR 2021 – PRESENT · LISBON', 704, { height: 7 }), I('Led the redesign of the dose counter on an inhaler that runs four hundred thousand units a year.', 688), I('Built the test rig the team now uses for verification of every new part that comes in.', 674),
    I('Prototyping Technician', 646, { bold: true }), I('POLYTECHNIC LAB · SEP 2019 – FEB 2021 · PORTO', 634, { height: 7 }), I('Ran a seven-machine prototyping shop with four FDM printers, a resin printer and a mill.', 618)]).jsonResume.work;
  ok('with no bullet marks, a line of a company, dates and a place is not a description, and the long lines under it are', flat?.length === 2 && flat[0].highlights?.length === 2 && flat[0].startDate === '2021-03' && flat[1].highlights?.length === 1 && flat[1].startDate === '2019-09', J(flat));
  // a job that goes on over a page break keeps its bullets; a new page that starts with a job title starts a job
  const pg = (items, page) => items.map(i => ({ ...i, page }));
  const broken = parseResume([...pg([...head, I('Design Engineer', 716, { bold: true }), I('Northgate Dosing Systems · Mar 2021 – Present', 702), I('• Led the redesign of the dose counter on an inhaler that runs four hundred thousand units a year', 688)], 1),
    ...pg([I('• Built the test rig the team now uses for verification of every new part that comes in', 800), I('Prototyping Technician', 770, { bold: true }), I('Polytechnic Lab · Sep 2019 – Feb 2021', 756), I('• Ran a seven-machine prototyping shop with four FDM printers, a resin printer and a mill', 742)], 2)]).jsonResume.work;
  ok('a job that goes on over a page break keeps its bullet, and a title at the top of the next page is a job of its own', broken?.length === 2 && broken[0].highlights?.length === 2 && broken[1].position === 'Prototyping Technician' && broken[1].highlights?.length === 1, J(broken));
  const top = parseResume([...pg([...head, I('Design Engineer', 716), I('Northgate Dosing Systems · Mar 2021 – Present', 702), I('• Led the redesign of the dose counter on an inhaler that runs four hundred thousand units a year', 688), I('• Built the test rig the team now uses for verification of every new part that comes in', 675)], 1),
    ...pg([I('Prototyping Technician', 780), I('Polytechnic Lab · Sep 2019 – Feb 2021', 766), I('Ran a seven-machine prototyping shop with four FDM printers, a resin printer and a mill, week after week', 752), I('Built the fixtures for the flow tests and wrote the bench instructions for the technicians who ran them', 738)], 2)]).jsonResume.work;
  ok('a title that is the first line of a page, where y is higher than the line before it, still starts a job (the gap is not measured across pages, and the title is not bold, which the parser would otherwise go by)', top?.length === 2 && top[0].highlights?.length === 2 && top[1].position === 'Prototyping Technician', J(top));
  // a company name the page wrapped over two lines is joined by the reader, which says where its last line sat: the gap to the title under it is a line's, not two
  const wrapped = parseResume([...head, I('Northgate Dosing Systems and Partners Limited', 716, { bottom: 703 }), I('Design Engineer', 690), I('Mar 2021 – Present', 677), I('• Led the redesign of the dose counter on an inhaler that runs four hundred thousand units a year', 664),
    I('• Built the test rig the team now uses for verification of every new part that comes in', 651), I('• Wrote the protocols for the rig and trained the team to run them on every shift that is planned', 638)]).jsonResume.work;
  ok('a line the reader joined from two is measured from its last line: a long company name over two lines is not cut off from the title under it (the title is not bold, which the parser would otherwise go by)', wrapped?.length === 1 && wrapped[0].highlights?.length === 3 && wrapped[0].startDate === '2021-03', J(wrapped));
  // the lines of a job: a title and then a line of company, dates and place, or the reverse; a sidebar's contact lines; a skill group in bold capitals; a patent
  const work = items => parseResume([...head, ...items]).jsonResume.work;
  const bul = [I('• Led the redesign of the dose counter on an inhaler that runs four hundred thousand units a year', 664), I('• Built the test rig the team now uses for verification of every new part that comes in', 651)];
  const above = work([I('Design Engineer', 716, { bold: true }), I('Northgate Dosing Systems · Mar 2021 – Present · Lisbon', 690), ...bul]);
  ok('a title above a line of company, dates and place gives the company from that line and the title from the first', above?.length === 1 && above[0].name === 'Northgate Dosing Systems' && above[0].position === 'Design Engineer' && above[0].startDate === '2021-03', J(above));
  const reverse = work([I('Northgate Dosing Systems', 716, { bold: true }), I('Design Engineer · Mar 2021 – Present', 690), ...bul]);
  ok('and a company above a line of title and dates gives the title from the line with the date', reverse?.length === 1 && reverse[0].name === 'Northgate Dosing Systems' && reverse[0].position === 'Design Engineer' && reverse[0].startDate === '2021-03', J(reverse));
  // the company, the title and the place on the dated line: a legal form marks the company, a place is no company, nothing is dropped
  const jobOf = (first, dated, bold = true) => { const r = parseResume([...head, I(first, 716, { bold }), I(dated, 690), ...bul]); return { job: r.jsonResume.work?.[0], r }; };
  const ltd = jobOf('Engineering Director Ltd', 'Mar 2020 – Present · Senior Engineer · Lisbon').job;
  ok('a company with a title word and a legal form ("Engineering Director Ltd") above "dates · Senior Engineer · Lisbon" is the company, Senior Engineer the title, Lisbon the place', ltd?.name === 'Engineering Director Ltd' && ltd.position === 'Senior Engineer' && ltd.location === 'Lisbon', J(ltd));
  const none = jobOf('Senior Engineer', 'Mar 2020 – Present · Lisbon'), nameless = none.job;
  ok('a job with no company line has no company: the city is its place, not its company, and a doubt says so', nameless?.position === 'Senior Engineer' && !nameless.name && nameless.location === 'Lisbon' && none.r.doubts.some(d => d.kind === 'company' && d.n === 1), J([nameless, none.r.doubts]));
  const country = jobOf('Senior Engineer', 'Mar 2020 – Present · Lisbon, Portugal').job;
  ok('"City, Country" is a place too', !country?.name && country.location === 'Lisbon, Portugal', J(country));
  const forms = ['Feinmess Instrumente GmbH', 'Dunamenti Műszer Kft.', 'Lumen SA', 'Oficina Aberta Lda', 'Acme Inc.', 'Riva S.p.A.'].map(c => jobOf('Design Engineer', `${c} · Mar 2020 – Present · Munich`).job?.name);
  ok('a legal form (GmbH, Kft., SA, Lda, Inc., S.p.A.) marks the company on the dated line', J(forms) === J(['Feinmess Instrumente GmbH', 'Dunamenti Műszer Kft.', 'Lumen SA', 'Oficina Aberta Lda', 'Acme Inc.', 'Riva S.p.A.']), J(forms));
  const odd = jobOf('Acme Holdings Ltd', 'Staff Wrangler · Mar 2020 – Present · Night Shift · Porto');
  ok('a title with no job-title word is the title, and a part nothing claims ("Night Shift") is a leftover, not dropped', odd.job?.name === 'Acme Holdings Ltd' && odd.job.position === 'Staff Wrangler' && odd.job.location === 'Porto' && odd.r.leftovers.some(l => l.text === 'Night Shift'), J([odd.job, odd.r.leftovers]));
  const sidebar = (heading, lex) => parseResume([I('Jane Q. Sample', 780, { bold: true }), I('Mechanical engineer', 760), I(heading, 740, { bold: true, title: true }), I('Lisbon, Portugal', 720), I('jane.sample@example.com', 700), I('+351 900 000 000', 680), I('janesample.example', 660), I('EXPERIENCE', 620, { bold: true }), I('Design Engineer', 596, { bold: true }), I('Northgate Dosing Systems · Mar 2021 – Present', 570), ...bul.map(b => ({ ...b, y: b.y - 94 }))], lex).jsonResume.basics;
  const side = sidebar('Contact');
  ok('the lines under a Contact heading are the profile\'s: the email, the phone (with a plus), the url (a bare domain) and the place (city, country)', side.email === 'jane.sample@example.com' && side.phone === '+351 900 000 000' && side.url === 'janesample.example' && side.location?.city === 'Lisbon', J(side));
  const kontakt = sidebar('Kontakt', lexiconFor('de'));
  ok('and under the word for it in another language, from the catalogue (German Kontakt, a heading the reader marked)', kontakt.email === 'jane.sample@example.com' && kontakt.phone === '+351 900 000 000', J(kontakt));
  const group = parseResume([...head.slice(0, 2), I('SKILLS', 740, { bold: true }), I('CAD & 3D', 716, { bold: true }), I('SolidWorks, Creo, Fusion 360', 703), I('Test & QA', 680, { bold: true }), I('ISO 13485, IEC 62366', 667)]);
  ok('a skill group in bold capitals with a digit ("CAD & 3D") is not a section: the skills are read', group.jsonResume.skills?.some(g => g.keywords.includes('Fusion 360') || /Fusion 360/.test(g.name ?? '')) && group.leftovers.every(l => l.section !== 'CAD & 3D'), J(group.jsonResume.skills) + J(group.leftovers));
  // a job title or company that has a title word in it is not a section: "Patent Attorney", "Language Teacher", "Volunteer Coordinator", "Reference Librarian", "Contact Centre", "Certification Officer", "Interest Analyst", "Project Manager"
  for (const t of ['Patent Attorney', 'Language Teacher', 'Volunteer Coordinator', 'Reference Librarian', 'Contact Centre', 'Certification Officer', 'Interest Analyst', 'Project Manager']){
    const jobs = work([I(t, 716), I('Northgate Dosing Systems · Mar 2021 – Present', 690), ...bul]);
    ok(`"${t}" as a job line keeps the work section: the job is read with its bullets`, jobs?.length === 1 && jobs[0].highlights?.length === 2 && jobs[0].startDate === '2021-03', J(jobs));
  }
  const plural = parseResume([...head, I('Design Engineer', 716, { bold: true }), I('Northgate Dosing Systems · Mar 2021 – Present', 690), ...bul, I('Languages', 612), I('English: C2', 598), I('Skills', 560), I('Python, MATLAB', 546)]);
  ok('while a title word that ends a line (Languages, Skills, Work Experience) is still a section title, and its lines are not a bullet\'s', plural.jsonResume.work?.[0].highlights?.length === 2 && plural.jsonResume.work[0].highlights[1].endsWith('every new part that comes in') && plural.jsonResume.skills?.length > 0, J(plural.jsonResume));
  const de = parseResume([...head, I('Konstrukteur', 716, { bold: true }), I('Northgate Dosing Systems · Mar 2021 – Present', 690), ...bul, I('Sprachen', 612), I('Deutsch: C2', 598)], lexiconFor('de')).jsonResume.work;
  ok('the catalogue\'s title words are used: the German "Sprachen" under the last job is a section, not a job or text of its last bullet', de?.length === 1 && de[0].highlights?.length === 2 && de[0].highlights[1].endsWith('every new part that comes in'), J(de));
  const patent = work([I('Design Engineer', 716, { bold: true }), I('Northgate Dosing Systems · Mar 2021 – Present', 690), ...bul, I('Patent', 612, { bold: true }), I('Dose-counting mechanism for a metered inhaler', 588, { bold: true }), I('Co-inventor · EP 3 000 000 B1 · 2025', 574)]);
  ok('a Patent heading opens its own section: the patent is not a job', patent?.length === 1 && patent[0].highlights?.length === 2, J(patent));
}

section('vendor/pdfjs and its reader');
{
  const pdfjs = path.join(REPO, 'vendor/pdfjs'), version = fs.readFileSync(path.join(pdfjs, 'VERSION'), 'utf8').split('\n')[0].trim();
  ok('vendor/pdfjs holds the library, its worker, the Apache licence and the version, and nothing else', J(fs.readdirSync(pdfjs).sort()) === J(['LICENSE', 'VERSION', 'pdf.min.mjs', 'pdf.worker.min.mjs']) && /Apache License/.test(fs.readFileSync(path.join(pdfjs, 'LICENSE'), 'utf8')), fs.readdirSync(pdfjs).join(', '));
  ok('VERSION is a 6.x release, the legacy build (which runs on an older web view and in Node with no flag and no polyfill), and the one the library says it is', /^6\.\d+\.\d+$/.test(version) && /legacy build/.test(fs.readFileSync(path.join(pdfjs, 'VERSION'), 'utf8')) && ['pdf.min.mjs', 'pdf.worker.min.mjs'].every(f => fs.readFileSync(path.join(pdfjs, f), 'utf8').includes(`"${version}"`)), version);
  const sw = fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8');
  ok('the service worker caches the library and its worker', ["'./vendor/pdfjs/pdf.min.mjs'", "'./vendor/pdfjs/pdf.worker.min.mjs'"].every(f => sw.includes(f)));
  const src = fs.readFileSync(path.join(REPO, 'src/parse/pdf.js'), 'utf8');
  ok('src/parse/pdf.js loads PDF.js by a dynamic import() of vendor/pdfjs, never a static one, and from nowhere else', /await import\(DIR \+ 'pdf\.min\.mjs'\)/.test(src) && !/^import .*pdfjs/m.test(src) && src.includes("new URL('../../vendor/pdfjs/', import.meta.url)") && !/https?:\/\//.test(src.replace(/\/\/.*$/gm, '')));
  ok('and nothing else in src/ or the page names it: it is loaded when a PDF is read', fs.readdirSync(path.join(REPO, 'src'), { recursive: true }).filter(f => f.endsWith('.js') && !f.startsWith('parse')).every(f => !fs.readFileSync(path.join(REPO, 'src', f), 'utf8').includes('vendor/pdfjs')) && !fs.readFileSync(path.join(REPO, 'index.html'), 'utf8').includes('pdfjs'));
}

section('the table: the score of every file (what a PDF, a DOCX and an ODT give of the example)');
for (const [name, s] of board) console.log(`      ${name.padEnd(24)} bullets ${s.bullets}/${wantBullets.length}  dates ${s.dates}/${want.work.length}  company+position ${s.jobs}/${want.work.length}  name ${s.name ? 'yes' : 'NO'}  email ${s.email ? 'yes' : 'no'}  contact ${s.contact ? 'yes' : 'no'}`);
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
  ok('the files that are not from OpenResume are the column split, the JSON Resume mapping, the CSV reader, the ZIP reader, the text cleaning and the readers', J(names.filter(n => head(path.join(REPO, 'src/parse', n)).startsWith('// Not from'))) === J(['csv.js', 'docx.js', 'html.js', 'identify.js', 'lines.js', 'linkedin.js', 'md.js', 'odt.js', 'pages.js', 'pdf.js', 'split-columns.js', 'to-json-resume.js', 'txt.js', 'unzip.js']), names.join(', '));
  ok('the README credits OpenResume and names where the port is', /OpenResume[^\n]*src\/parse/.test(fs.readFileSync(path.join(REPO, 'README.md'), 'utf8')) && fs.existsSync(path.join(REPO, 'src/parse/README.md')));
}

console.log(failed ? `\n${failed} parse check(s) FAILED` : '\nall parse checks passed');
process.exit(failed ? 1 : 0);
