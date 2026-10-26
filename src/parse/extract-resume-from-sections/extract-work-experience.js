// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/extract-resume-from-sections/extract-work-experience.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped; section, job-title and date words from the lexicon
// Types stripped. Changed: the section keywords, the job-title words and the date words come from the lexicon.
import { getSectionLinesByKeywords } from './lib/get-section-lines.js';
import { dateFeatureSets, hasNumber, getHasText, isBold } from './lib/common-features.js';
import { divideSectionIntoSubsections } from './lib/subsections.js';
import { getTextWithHighestFeatureScore } from './lib/feature-scoring-system.js';
import { getBulletPointsFromLines, getDescriptionsLineIdx } from './lib/bullet-points.js';

const hasMoreThan5Words = item => item.text.split(/\s/).length > 5;

export const extractWorkExperience = (sections, lex) => {
  const hasJobTitle = item => lex.jobTitles.some(jobTitle => item.text.split(/\s/).some(word => word === jobTitle));
  const JOB_TITLE_FEATURE_SET = [
    [hasJobTitle, 4],
    [hasNumber, -4],
    [hasMoreThan5Words, -2],
  ];

  const workExperiences = [];
  const workExperiencesScores = [];
  const lines = getSectionLinesByKeywords(sections, lex.sections.work);
  const subsections = divideSectionIntoSubsections(lines);

  for (const subsectionLines of subsections) {
    const descriptionsLineIdx = getDescriptionsLineIdx(subsectionLines) ?? 2;

    const subsectionInfoTextItems = subsectionLines.slice(0, descriptionsLineIdx).flat();
    const [date, dateScores] = getTextWithHighestFeatureScore(subsectionInfoTextItems, dateFeatureSets(lex));
    const [jobTitle, jobTitleScores] = getTextWithHighestFeatureScore(subsectionInfoTextItems, JOB_TITLE_FEATURE_SET);
    const COMPANY_FEATURE_SET = [
      [isBold, 2],
      [getHasText(date), -4],
      [getHasText(jobTitle), -4],
    ];
    const [company, companyScores] = getTextWithHighestFeatureScore(subsectionInfoTextItems, COMPANY_FEATURE_SET, false);

    const subsectionDescriptionsLines = subsectionLines.slice(descriptionsLineIdx);
    const descriptions = getBulletPointsFromLines(subsectionDescriptionsLines);

    workExperiences.push({ company, jobTitle, date, descriptions });
    workExperiencesScores.push({ companyScores, jobTitleScores, dateScores });
  }
  return { workExperiences, workExperiencesScores };
};
