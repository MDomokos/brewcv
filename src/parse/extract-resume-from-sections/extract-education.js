// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/extract-resume-from-sections/extract-education.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped; school, degree, section and date words from the lexicon
// Types stripped. Changed: the school and degree words, the section keywords and the date words come from the lexicon.
import { getSectionLinesByKeywords } from './lib/get-section-lines.js';
import { divideSectionIntoSubsections } from './lib/subsections.js';
import { dateFeatureSets, hasComma, hasLetter, hasNumber } from './lib/common-features.js';
import { getTextWithHighestFeatureScore } from './lib/feature-scoring-system.js';
import { getBulletPointsFromLines, getDescriptionsLineIdx } from './lib/bullet-points.js';

/**
 *              Unique Attribute
 * School       Has school
 * Degree       Has degree
 * GPA          Has number
 */

const matchGPA = item => item.text.match(/[0-4]\.\d{1,2}/);
const matchGrade = item => {
  const grade = parseFloat(item.text);
  if (Number.isFinite(grade) && grade <= 110) {
    return [String(grade)];
  }
  return null;
};

export const extractEducation = (sections, lex) => {
  const hasSchool = item => lex.schools.some(school => item.text.includes(school));
  const hasDegree = item =>
    lex.degrees.some(degree => item.text.includes(degree)) ||
    /[ABM][A-Z\.]/.test(item.text); // Match AA, B.S., MBA, etc.
  const SCHOOL_FEATURE_SETS = [
    [hasSchool, 4],
    [hasDegree, -4],
    [hasNumber, -4],
  ];
  const DEGREE_FEATURE_SETS = [
    [hasDegree, 4],
    [hasSchool, -4],
    [hasNumber, -3],
  ];
  const GPA_FEATURE_SETS = [
    [matchGPA, 4, true],
    [matchGrade, 3, true],
    [hasComma, -3],
    [hasLetter, -4],
  ];

  const educations = [];
  const educationsScores = [];
  const lines = getSectionLinesByKeywords(sections, lex.sections.education);
  const subsections = divideSectionIntoSubsections(lines);
  for (const subsectionLines of subsections) {
    const textItems = subsectionLines.flat();
    const [school, schoolScores] = getTextWithHighestFeatureScore(textItems, SCHOOL_FEATURE_SETS);
    const [degree, degreeScores] = getTextWithHighestFeatureScore(textItems, DEGREE_FEATURE_SETS);
    const [gpa, gpaScores] = getTextWithHighestFeatureScore(textItems, GPA_FEATURE_SETS);
    const [date, dateScores] = getTextWithHighestFeatureScore(textItems, dateFeatureSets(lex));

    let descriptions = [];
    const descriptionsLineIdx = getDescriptionsLineIdx(subsectionLines);
    if (descriptionsLineIdx !== undefined) {
      const descriptionsLines = subsectionLines.slice(descriptionsLineIdx);
      descriptions = getBulletPointsFromLines(descriptionsLines);
    }

    educations.push({ school, degree, gpa, date, descriptions });
    educationsScores.push({ schoolScores, degreeScores, gpaScores, dateScores });
  }

  if (educations.length !== 0) {
    const coursesLines = getSectionLinesByKeywords(sections, lex.sections.courses);
    if (coursesLines.length !== 0) {
      educations[0].descriptions.push(
        'Courses: ' +
          coursesLines
            .flat()
            .map(item => item.text)
            .join(' ')
      );
    }
  }

  return {
    educations,
    educationsScores,
  };
};
