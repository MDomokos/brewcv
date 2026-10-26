// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/extract-resume-from-sections/lib/bullet-points.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped
// Types stripped, logic unchanged.

/**
 * List of bullet points
 * Reference: https://stackoverflow.com/questions/56540160/why-isnt-there-a-medium-small-black-circle-in-unicode
 * U+22C5   DOT OPERATOR (⋅)
 * U+2219   BULLET OPERATOR (∙)
 * U+1F784  BLACK SLIGHTLY SMALL CIRCLE (🞄)
 * U+2022   BULLET (•) -------- most common
 * U+2981   Z NOTATION SPOT (⦁)
 * U+26AB   MEDIUM BLACK CIRCLE (⚫︎)
 * U+25CF   BLACK CIRCLE (●)
 * U+2B24   BLACK LARGE CIRCLE (⬤)
 * U+26AC   MEDIUM SMALL WHITE CIRCLE ⚬
 * U+25CB   WHITE CIRCLE ○
 */
export const BULLET_POINTS = ['⋅', '∙', '🞄', '•', '⦁', '⚫︎', '●', '⬤', '⚬', '○'];

/**
 * Convert bullet point lines into a string array aka descriptions.
 */
export const getBulletPointsFromLines = lines => {
  // Simply return all lines with text item joined together if there is no bullet point
  const firstBulletPointLineIndex = getFirstBulletPointLineIdx(lines);
  if (firstBulletPointLineIndex === undefined) {
    return lines.map(line => line.map(item => item.text).join(' '));
  }

  // Otherwise, process and remove bullet points

  // Combine all lines into a single string
  let lineStr = '';
  for (const item of lines.flat()) {
    const text = item.text;
    // Make sure a space is added between 2 words
    if (!lineStr.endsWith(' ') && !text.startsWith(' ')) {
      lineStr += ' ';
    }
    lineStr += text;
  }

  // Get the most common bullet point
  const commonBulletPoint = getMostCommonBulletPoint(lineStr);

  // Start line string from the beginning of the first bullet point
  const firstBulletPointIndex = lineStr.indexOf(commonBulletPoint);
  if (firstBulletPointIndex !== -1) {
    lineStr = lineStr.slice(firstBulletPointIndex);
  }

  // Divide the single string using bullet point as divider
  return lineStr
    .split(commonBulletPoint)
    .map(text => text.trim())
    .filter(text => !!text);
};

const getMostCommonBulletPoint = str => {
  const bulletToCount = BULLET_POINTS.reduce((acc, cur) => {
    acc[cur] = 0;
    return acc;
  }, {});
  let bulletWithMostCount = BULLET_POINTS[0];
  let bulletMaxCount = 0;
  for (const char of str) {
    if (bulletToCount.hasOwnProperty(char)) {
      bulletToCount[char]++;
      if (bulletToCount[char] > bulletMaxCount) {
        bulletWithMostCount = char;
      }
    }
  }
  return bulletWithMostCount;
};

const getFirstBulletPointLineIdx = lines => {
  for (let i = 0; i < lines.length; i++) {
    for (const item of lines[i]) {
      if (BULLET_POINTS.some(bullet => item.text.includes(bullet))) {
        return i;
      }
    }
  }
  return undefined;
};

// Only consider words that don't contain numbers
const isWord = str => /^[^0-9]+$/.test(str);
const hasAtLeast8Words = item => item.text.split(/\s/).filter(isWord).length >= 8;

export const getDescriptionsLineIdx = lines => {
  // The main heuristic to determine descriptions is to check if has bullet point
  let idx = getFirstBulletPointLineIdx(lines);

  // Fallback heuristic if the main heuristic doesn't apply (e.g. LinkedIn resume) to
  // check if the line has at least 8 words
  if (idx === undefined) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length === 1 && hasAtLeast8Words(line[0])) {
        idx = i;
        break;
      }
    }
  }

  return idx;
};
