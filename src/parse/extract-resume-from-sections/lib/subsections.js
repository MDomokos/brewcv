// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/extract-resume-from-sections/lib/subsections.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped; 2026-11-01: gaps from the bottom of a joined line, and across a page break
// Types stripped. Changed: a line that wraps over several lines (a PDF paragraph the reader joined) is measured from its `bottom`, and a new page starts a new subsection (unless it goes on with a bullet or a lower-case word); the gaps inside a line the PDF reader joined count as line gaps (joining must not change what is measured); a subsection that opens with a description is the rest of the one above, and a title of one or two lines with no year in it belongs to the entry below when that opens with a dated line (a job's list or date line set apart from its title by a wide gap is not another job).
import { BULLET_POINTS, getDescriptionsLineIdx } from './bullet-points.js';
import { isBold } from './common-features.js';

/**
 * Divide lines into subsections based on difference in line gap or bold text.
 *
 * For profile section, we can directly pass all the text items to the feature
 * scoring systems. But for other sections, such as education and work experience,
 * we have to first divide the section into subsections since there can be multiple
 * schools or work experiences in the section. The feature scoring system then
 * process each subsection to retrieve each's resume attributes and append the results.
 */
const page = line => line[0].page ?? 1;
const bottom = line => line[0].bottom ?? line[0].y;

export const divideSectionIntoSubsections = lines => {
  // The main heuristic to determine a subsection is to check if its vertical line gap
  // is larger than the typical line gap * 1.4
  const isLineNewSubsectionByLineGap = createIsLineNewSubsectionByLineGap(lines);

  let subsections = createSubsections(lines, isLineNewSubsectionByLineGap);

  // Fallback heuristic if the main heuristic doesn't apply to check if the text item is bolded
  if (subsections.length === 1) {
    const isLineNewSubsectionByBold = (line, prevLine) => {
      if (
        !isBold(prevLine[0]) &&
        isBold(line[0]) &&
        // Ignore bullet points that sometimes being marked as bolded
        !BULLET_POINTS.includes(line[0].text)
      ) {
        return true;
      }
      return false;
    };

    subsections = createSubsections(lines, isLineNewSubsectionByBold);
  }

  // a description (a bullet, or a long line of text) never opens an entry
  const kept = subsections.reduce((out, s) => (out.length && getDescriptionsLineIdx(s) === 0 ? (out.at(-1).push(...s), out) : [...out, s]), []);
  // a title with no year, one or two lines, is the head of the entry below when that opens with a line with a year in it
  const year = line => /(?:19|20)\d{2}/.test(line.map(item => item.text).join(' '));
  return kept.reduce((out, s) => (out.length && out.at(-1).length <= 2 && !out.at(-1).some(year) && year(s[0]) ? [...out.slice(0, -1), [...out.at(-1), ...s]] : [...out, s]), []);
};

const createIsLineNewSubsectionByLineGap = lines => {
  // Extract the common typical line gap
  const lineGapToCount = {};
  let lineGapWithMostCount = 0;
  let maxCount = 0;
  const count = lineGap => {
    if (!lineGapToCount[lineGap]) lineGapToCount[lineGap] = 0;
    lineGapToCount[lineGap] += 1;
    if (lineGapToCount[lineGap] > maxCount) {
      lineGapWithMostCount = lineGap;
      maxCount = lineGapToCount[lineGap];
    }
  };
  for (let i = 1; i < lines.length; i++) {
    for (const g of lines[i][0].wrap ?? []) count(Math.round(g));
    if (page(lines[i]) !== page(lines[i - 1])) continue;
    count(Math.round(bottom(lines[i - 1]) - lines[i][0].y));
  }
  // Use common line gap to set a sub section threshold
  const subsectionLineGapThreshold = lineGapWithMostCount * 1.4;

  const isLineNewSubsection = (line, prevLine) => {
    if (page(line) !== page(prevLine)) return !/^(?:\p{Ll}|[-–]\s)/u.test(line[0].text) && !BULLET_POINTS.includes(line[0].text[0]);
    return Math.round(bottom(prevLine) - line[0].y) > subsectionLineGapThreshold;
  };

  return isLineNewSubsection;
};

const createSubsections = (lines, isLineNewSubsection) => {
  const subsections = [];
  let subsection = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0) {
      subsection.push(line);
      continue;
    }
    if (isLineNewSubsection(line, lines[i - 1])) {
      subsections.push(subsection);
      subsection = [];
    }
    subsection.push(line);
  }
  if (subsection.length > 0) {
    subsections.push(subsection);
  }
  return subsections;
};
