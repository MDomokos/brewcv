// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/extract-resume-from-sections/extract-work-experience.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped; section, job-title and date words from the lexicon; 2026-11-02: a block with no job line above its text is no job; 2026-11-01: the company, the title and the place are told apart on a line with a date
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

// A legal form ends a company's name; a place is "City" (one capitalised word) or "City, Country".
// shortcut: the forms are the common European ones and Inc, LLC, Corp; a one-word company with no form ("Acme") on the dated line reads as a place, and the job is left with no company (a doubt says so)
const SUFFIX = /(?:^|[\s,])(?:Ltd|Limited|GmbH|AG|KG|Kft|Zrt|Bt|Nyrt|Inc|LLC|LLP|Corp|Co|SAS|SARL|SA|S\.A|SL|S\.L|BV|B\.V|NV|N\.V|Lda|SpA|S\.p\.A|Srl|S\.r\.l|sp\. ?z o\.o|s\.r\.o|a\.s|plc|PLC|Oy|AB|A\/S)\.?$/;
const hasForm = t => SUFFIX.test(t.trim());
const isPlace = t => !hasForm(t) && (/,/.test(t) ? /^\p{Lu}[\p{L}.' -]{1,30}, \p{Lu}[\p{L}.' -]{1,30}$/u.test(t.trim()) : /^\p{Lu}[\p{L}.'-]{1,30}$/u.test(t.trim()));

export const extractWorkExperience = (sections, lex) => {
  const hasJobTitle = item => lex.jobTitles.some(jobTitle => item.text.split(/\s/).some(word => word === jobTitle));
  const JOB_TITLE_FEATURE_SET = [
    [hasJobTitle, 4],
    [hasNumber, -4],
    [hasMoreThan5Words, -2],
    [item => hasForm(item.text), -6],      // a company with a title word in it ("Engineering Director Ltd") is not the title
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
    // The line with the date may hold the company, the title and the place ("Hydra Medical · Mar 2023 – Present · Lisbon"): it is cut at its separators and the parts with no date are told apart.
    // A part with a legal form is the company, one with a job-title word the title, one that is a place the place; no part is dropped: one nothing claims is a leftover.
    const isDate = t => dateFeatureSets(lex).reduce((n, [has, score]) => n + (has({ text: t }) ? score : 0), 0) > 0;
    const parts = date.split(/\s*[·|•]\s*/).filter(t => t && !isDate(t));
    const places = parts.filter(isPlace), rest = parts.filter(t => !isPlace(t));
    if (!jobTitle) jobTitle = rest.find(t => hasJobTitle({ text: t }) && !hasForm(t)) ?? '';
    const COMPANY_FEATURE_SET = [
      [isBold, 2],
      [item => hasForm(item.text), 4],
      [getHasText(date), -4],
      [getHasText(jobTitle), -4],
    ];
    let [company, companyScores] = getTextWithHighestFeatureScore(subsectionInfoTextItems, COMPANY_FEATURE_SET, false);
    if (!company || company === jobTitle || company === date) company = rest.find(hasForm) ?? rest.find(t => t !== jobTitle && !hasJobTitle({ text: t })) ?? '';
    // a title with no job-title word is what the dated line holds besides the company and the place
    const left = rest.filter(t => t !== company && t !== jobTitle);
    if (!jobTitle && left.length) jobTitle = left.shift();

    const subsectionDescriptionsLines = subsectionLines.slice(descriptionsLineIdx);
    const descriptions = getBulletPointsFromLines(subsectionDescriptionsLines);

    workExperiences.push({ company, jobTitle, date, descriptions, ...(places.length ? { location: places[0] } : {}), ...(left.length || places.length > 1 ? { left: [...left, ...places.slice(1)] } : {}) });
    workExperiencesScores.push({ companyScores, jobTitleScores, dateScores });
  }
  return { workExperiences, workExperiencesScores };
};
