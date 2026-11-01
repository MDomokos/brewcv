// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/extract-resume-from-sections/extract-work-experience.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped; section, job-title and date words from the lexicon; 2026-11-02: a block with no job line above its text is no job; 2026-11-01: the company and the title are told apart on a line with a date
// Types stripped. Changed: the section keywords, the job-title words and the date words come from the lexicon, and a block of text that starts with its descriptions (a
// paragraph or a bullet, no company, title or date line above it) is not a job: its lines are left for the person to place, not made into a job with no name. The lines of a job are often a title (bold) and then
// a line of company, dates and place ("Hydra Medical · Mar 2023 – Present · Lisbon"), or the reverse: the score takes the title line for the company, so a line that holds the date is cut at its separators, and the
// part with no date and no job-title word is the company, the part with a job-title word the title.
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
    if (descriptionsLineIdx === 0) continue;

    const subsectionInfoTextItems = subsectionLines.slice(0, descriptionsLineIdx).flat();
    const [date, dateScores] = getTextWithHighestFeatureScore(subsectionInfoTextItems, dateFeatureSets(lex));
    let [jobTitle, jobTitleScores] = getTextWithHighestFeatureScore(subsectionInfoTextItems, JOB_TITLE_FEATURE_SET);
    // the date line may hold the company, the title or both
    const isDate = t => dateFeatureSets(lex).reduce((n, [has, score]) => n + (has({ text: t }) ? score : 0), 0) > 0;
    const parts = date.split(/\s*[·|•]\s*/).filter(t => t && !isDate(t));
    if (!jobTitle) jobTitle = parts.find(t => hasJobTitle({ text: t })) ?? '';
    const COMPANY_FEATURE_SET = [
      [isBold, 2],
      [getHasText(date), -4],
      [getHasText(jobTitle), -4],
    ];
    let [company, companyScores] = getTextWithHighestFeatureScore(subsectionInfoTextItems, COMPANY_FEATURE_SET, false);
    if (!company || company === jobTitle) company = parts.find(t => t !== jobTitle && !hasJobTitle({ text: t })) ?? company;

    const subsectionDescriptionsLines = subsectionLines.slice(descriptionsLineIdx);
    const descriptions = getBulletPointsFromLines(subsectionDescriptionsLines);

    workExperiences.push({ company, jobTitle, date, descriptions });
    workExperiencesScores.push({ companyScores, jobTitleScores, dateScores });
  }
  return { workExperiences, workExperiencesScores };
};
