// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/index.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: no PDF reading, a column split first (a layout in, the layout and doubts out), a lexicon, JSON Resume out; 2026-11-01: a doubt when no job is found, and when the file reads like a letter
// Resume text items in, JSON Resume out. Imports nothing from the rest of src/ (checks/parse-check.mjs greps for it).
// Not ported: read-pdf.ts (the readers make the items), types.ts (types only).
import { withEnglish } from './lexicon.js';
import { layoutOf, splitColumns } from './split-columns.js';
import { groupTextItemsIntoLines } from './group-text-items-into-lines.js';
import { groupLinesIntoSections, PROFILE_SECTION } from './group-lines-into-sections.js';
import { extractResumeFromSections } from './extract-resume-from-sections/index.js';
import { toJsonResume } from './to-json-resume.js';

/**
 * Resume parser util that parses a resume from the text items of a file.
 * items: [{ text, x, y, width, height, fontName, hasEOL, page?, side? }]; an item with `side` ('header' or 'footer') is not read: its line comes back in `leftovers`. lexicon: see lexicon.js; leave it out for English.
 * layout: [{ page, headerBottom?, split? }], what to do with a page (see split-columns.js); a page it does not name is guessed.
 * Returns { jsonResume, trace, leftovers, layout, doubts }: the layout used for every page, and what to check by eye
 * ([{ kind: 'columns', page } | { kind: 'leftovers', n } | { kind: 'dates', n } | { kind: 'company', n } | { kind: 'name' } | { kind: 'jobs' } | { kind: 'letter' }]); 'jobs' is no job found in a file of more than ten lines, unless it reads like a letter; 'letter' is mostly prose paragraphs,
 * no section title and no dated line (a cover letter: the caller keeps it beside a resume, not in the career).
 */
export const parseResume = (all, lexicon, given) => {
  const lex = withEnglish(lexicon);
  const textItems = all.some(i => i.side) ? all.filter(i => !i.side) : all;      // a running header or footer is for the person to place, not to read

  // Step 1. (new) Put the items of a page with two columns in reading order
  const { layout, doubts } = layoutOf(textItems, given);
  // Step 2. Group text items into lines
  const lines = groupTextItemsIntoLines(splitColumns(textItems, layout));

  // Step 3. Group lines into sections
  const sections = groupLinesIntoSections(lines, lex);

  // Step 4. Extract resume from sections
  const resume = extractResumeFromSections(sections, lex);

  // Step 5. (new) Map it to JSON Resume, with where each text came from and what was left over
  const got = toJsonResume(resume, lines, sections, lex);
  const { jsonResume, leftovers } = got;
  // A letter: no section title found, at least three prose lines (eight words or more, not a bullet) holding most of the text, and no date range ("Mar 2021 – Present").
  // shortcut: a line is prose by its words alone, in any language, so a list of long bullet-less lines with no headings reads as a letter too; the salutation and the sign-off are not asked for
  const prose = l => !l[0].text.startsWith('•') && l.map(i => i.text).join(' ').split(/\s+/).length >= 8, size = ls => ls.reduce((n, l) => n + l.map(i => i.text).join(' ').length, 0);
  const proseLines = lines.filter(prose);
  // A dated file is never a letter: a date range with a year near its dash on either side ("03/2019 – 05/2021", "2019. március – 2021. június", "2018-2021"), or two lines with a year (one is the letter's own date).
  // One section title is a subject line in bold capitals ("APPLICATION"), not a resume's structure.
  const text = l => l.map(i => i.text).join(' '), year = /\b(?:19|20)\d{2}\b/;
  const dated = lines.some(l => /(?:19|20)\d{2}\D{0,12}\s[-–—]\s|\s[-–—]\s\D{0,12}(?:19|20)\d{2}|\b(?:19|20)\d{2}[-–—](?:19|20)\d{2}\b/.test(text(l))) || lines.filter(l => year.test(text(l))).length >= 2;
  const letter = Object.keys(sections).filter(k => k !== PROFILE_SECTION).length <= 1 && proseLines.length >= 3 && size(proseLines) * 10 >= size(lines) * 6 && !dated;
  const undated = (jsonResume.work ?? []).filter(w => !w.startDate).length, unnamed = (jsonResume.work ?? []).filter(w => !w.name).length + (resume?.workExperiences ?? []).filter(w => w.unsure).length;
  const sides = [];      // the lines of the header and the footer, each as a leftover of its own section
  let cur = [];
  for (const i of all) if (i.side){ cur.push(i.text); if (i.hasEOL){ sides.push({ text: cur.join(' '), section: i.side }); cur = []; } }
  return {
    ...got, layout, leftovers: [...sides.filter(s => s.section === 'header'), ...leftovers, ...sides.filter(s => s.section === 'footer')],
    doubts: [
      ...doubts.map(page => ({ kind: 'columns', page })),
      ...(leftovers.length >= 4 && leftovers.length * 4 > lines.length ? [{ kind: 'leftovers', n: leftovers.length }] : []),
      ...(undated ? [{ kind: 'dates', n: undated }] : []),
      ...(unnamed ? [{ kind: 'company', n: unnamed }] : []),
      ...(jsonResume.basics.name ? [] : [{ kind: 'name' }]),
      ...(letter ? [{ kind: 'letter' }] : !jsonResume.work?.length && lines.length > 10 ? [{ kind: 'jobs' }] : []),
    ],
  };
};
