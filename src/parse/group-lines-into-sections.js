// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/group-lines-into-sections.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped; title words from the lexicon; Unicode capitals; an item a reader marked as a title; 2026-11-01: a short line set apart by its look is a title
// Types stripped. Changed: the title keywords come from the lexicon, a capital letter is any Unicode capital, and an item with `title: true`
// (a heading a reader found: a Heading style, #, h1 to h3) is a title whatever its words, unless it is in the first two lines (the name).
// Also new: a short line alone on its row that is set apart from the body text by its look is a title (see `byLook`).
import { hasLetterAndIsAllUpperCase, hasOnlyLettersSpacesAmpersands, isBold } from './extract-resume-from-sections/lib/common-features.js';

export const PROFILE_SECTION = 'profile';

/**
 * Step 3. Group lines into sections
 *
 * Every section (except the profile section) starts with a section title that
 * takes up the entire line. This is a common pattern not just in resumes but
 * also in books and blogs. The resume parser uses this pattern to group lines
 * into the closest section title above these lines.
 */
// A heading set by hand (no heading style): a short line of letters (four words at most, no digits or marks) alone on its row whose look is the titles' look. The look is
// how far a line is set apart from the body text: its size clearly above the body's most common size (1.5 pt), underlined, coloured or bold unlike the body, in that order of weight.
// The titles' look is that of the lines the rules below already take for titles (a known word, bold capitals); then a line with that look and a title word in it is a title too
// ("Professional Work Experience" is more than two words). With no such title the most emphasised look among the short lines alone is the titles' look, whatever the words.
// shortcut: used only when no reader marked a heading, and only when that look is on ten lines or fewer. A resume that sets its company names like its section titles (bold on a
// line of their own) and has no title the rules below know gets titles that are companies; a heading in the body's own look is not seen. Tune the numbers on real files.
const SHORT = /^[\p{L}\s&'/-]{2,40}:?$/u;
const high = a => a.reduce((m, r) => (r > m ? r : m), 0);
const byLook = (lines, known, words) => {
  const items = lines.flat();
  if (!items.length || items.some(i => i.title)) return [];
  const most = f => { const n = new Map(); for (const i of items) n.set(f(i), (n.get(f(i)) ?? 0) + i.text.length); return [...n].sort((a, b) => b[1] - a[1])[0][0]; };
  const body = { height: most(i => i.height), color: most(i => i.color ?? ''), bold: most(isBold) };
  const ranks = lines.map((l, i) => (i < 2 || l.length !== 1 ? 0
    : (l[0].height >= body.height + 1.5 ? 8 : 0) + (l[0].underline ? 4 : 0) + ((l[0].color ?? '') !== body.color ? 2 : 0) + (isBold(l[0]) && !body.bold ? 1 : 0)));
  const short = lines.map(l => SHORT.test(l[0]?.text.trim() ?? '') && l[0].text.trim().split(/\s+/).length <= 4);
  const top = known.some(Boolean) ? high(ranks.filter((r, i) => known[i])) : high(ranks.filter((r, i) => short[i]));
  const set = ranks.map((r, i) => !!top && r === top && short[i] && !known[i] && (!known.some(Boolean) || words.some(w => lines[i][0].text.toLowerCase().includes(w))));
  return set.filter(Boolean).length <= 10 ? set : [];
};

export const groupLinesIntoSections = (lines, lex) => {
  const sections = {};
  const known = lines.map((line, i) => isSectionTitle(line, i, lex.titleWords)), look = byLook(lines, known, [...lex.titleWords, ...Object.values(lex.sections).flat()]);
  let sectionName = PROFILE_SECTION;
  let sectionLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line[0]?.text.trim();
    if (known[i] || look[i]) {
      sections[sectionName] = [...sectionLines];
      sectionName = text;
      sectionLines = [];
    } else {
      sectionLines.push(line);
    }
  }
  if (sectionLines.length > 0) {
    sections[sectionName] = [...sectionLines];
  }
  return sections;
};

const isSectionTitle = (line, lineNumber, titleWords) => {
  const isFirstTwoLines = lineNumber < 2;
  const hasMoreThanOneItemInLine = line.length > 1;
  const hasNoItemInLine = line.length === 0;
  if (isFirstTwoLines || hasMoreThanOneItemInLine || hasNoItemInLine) {
    return false;
  }

  const textItem = line[0];
  if (textItem.title) return true;

  // The main heuristic to determine a section title is to check if the text is double emphasized
  // to be both bold and all uppercase, which is generally true for a well formatted resume
  if (isBold(textItem) && hasLetterAndIsAllUpperCase(textItem)) {
    return true;
  }

  // The following is a fallback heuristic to detect section title if it includes a keyword match
  // (This heuristics is not well tested and may not work well)
  const text = textItem.text.trim();
  const textHasAtMost2Words = text.split(' ').filter(s => s !== '&').length <= 2;
  const startsWithCapitalLetter = /\p{Lu}/u.test(text.slice(0, 1));

  if (
    textHasAtMost2Words &&
    hasOnlyLettersSpacesAmpersands(textItem) &&
    startsWithCapitalLetter &&
    titleWords.some(keyword => text.toLowerCase().includes(keyword))
  ) {
    return true;
  }

  return false;
};
