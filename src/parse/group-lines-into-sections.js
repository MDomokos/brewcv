// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/group-lines-into-sections.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped; title words from the lexicon; Unicode capitals; an item a reader marked as a title
// Types stripped. Changed: the title keywords come from the lexicon, a capital letter is any Unicode capital, and an item with `title: true`
// (a heading a reader found: a Heading style, #, h1 to h3) is a title whatever its words, unless it is in the first two lines (the name).
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
export const groupLinesIntoSections = (lines, lex) => {
  const sections = {};
  let sectionName = PROFILE_SECTION;
  let sectionLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line[0]?.text.trim();
    if (isSectionTitle(line, i, lex.titleWords)) {
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
