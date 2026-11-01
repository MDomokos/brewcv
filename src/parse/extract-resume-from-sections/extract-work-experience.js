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
const YEAR = /(?:19|20)\d{2}/;

export const extractWorkExperience = (sections, lex) => {
  const hasJobTitle = item => lex.jobTitles.some(jobTitle => item.text.split(/\s/).some(word => word === jobTitle));
  const JOB_TITLE_FEATURE_SET = [
    [hasJobTitle, 4],
    [hasNumber, -4],
    [hasMoreThan5Words, -2],
    [item => hasForm(item.text), -6],      // a company with a title word in it ("Engineering Director Ltd") is not the title
  ];
  const isDate = t => dateFeatureSets(lex).reduce((n, [has, score]) => n + (has({ text: t }) ? score : 0), 0) > 0;
  const isDateWord = w => /^[–—-]$/.test(w) || isDate(w);

  const workExperiences = [];
  const workExperiencesScores = [];
  const lines = getSectionLinesByKeywords(sections, lex.sections.work);
  const subsections = divideSectionIntoSubsections(lines);

  // One entry from the lines above its descriptions. `inherit` is the company of the entry above, for a second dated line in one job (a later role at the same company).
  const read = (infoLines, descriptionsLines, inherit) => {
    const items = infoLines.flat();
    const [date, dateScores] = getTextWithHighestFeatureScore(items, dateFeatureSets(lex));
    let [jobTitle, jobTitleScores] = getTextWithHighestFeatureScore(items, JOB_TITLE_FEATURE_SET);
    // The line with the date may hold the company, the title and the place ("Hydra Medical · Mar 2023 – Present · Lisbon", "Hydra Law, Mar 2020 – Present"): it is cut at its separators and at the dates, and the parts
    // are told apart. A part with a legal form is the company, one with a job-title word the title, one after the dates that is a place the place; no part is dropped: one nothing claims is a leftover.
    const segments = date.split(/\s*[·|•]\s*/).filter(Boolean), k = segments.findIndex(isDate);
    let before = segments.slice(0, Math.max(k, 0)), after = k < 0 ? [] : segments.slice(k + 1);
    if (k >= 0){      // the words of the date's own segment before and after the dates ("Hydra Law, Mar 2020 – Present")
      const w = segments[k].split(/\s+/), first = w.findIndex(isDateWord), last = w.length - 1 - [...w].reverse().findIndex(isDateWord);
      const trim = x => x.join(' ').replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '');
      before = [...before, trim(w.slice(0, first))].filter(Boolean); after = [trim(w.slice(last + 1)), ...after].filter(Boolean);
    }
    const places = after.filter(isPlace), rest = [...before, ...after.filter(t => !isPlace(t))];
    if (!jobTitle) jobTitle = rest.find(t => hasJobTitle({ text: t }) && !hasForm(t)) ?? '';
    const COMPANY_FEATURE_SET = [
      [isBold, 2],
      [item => hasForm(item.text), 4],
      [getHasText(date), -4],
      [getHasText(jobTitle), -4],
    ];
    let [company, companyScores] = getTextWithHighestFeatureScore(items, COMPANY_FEATURE_SET, false);
    if (!company || company === jobTitle || company === date) company = rest.find(hasForm) ?? rest.find(t => t !== jobTitle && !hasJobTitle({ text: t })) ?? '';
    let doubt = false;
    // no job-title word anywhere: the first line is a title when it is set larger than the dated line (a heading over small print), else the company ("Northgate Law" over "Partner · Mar 2020 – Present");
    // with no way to tell, both are kept, one as the company and one as the position, and the company doubt is raised
    if (!jobTitle && company && company !== date && !hasForm(company) && rest.length === 1 && rest[0] !== company){
      const h = x => items.find(i => i.text === x)?.height ?? 0;
      if (h(company) >= 1.15 * h(date)){ jobTitle = company; company = rest[0]; }
      else { jobTitle = rest[0]; const it = items.find(i => i.text === company); doubt = !(it && isBold(it)); }
    }
    // a title with no job-title word is what the dated line holds besides the company and the place
    const left = rest.filter(t => t !== company && t !== jobTitle);
    if (!jobTitle && left.length) jobTitle = left.shift();
    if (!company && inherit) company = inherit;

    return { entry: { company, jobTitle, date, descriptions: getBulletPointsFromLines(descriptionsLines), ...(places.length ? { location: places[0] } : {}), ...(left.length || places.length > 1 ? { left: [...left, ...places.slice(1)] } : {}), ...(doubt ? { unsure: true } : {}) }, scores: { companyScores, jobTitleScores, dateScores } };
  };

  for (const subsectionLines of subsections) {
    const descriptionsLineIdx = getDescriptionsLineIdx(subsectionLines) ?? 2;
    if (descriptionsLineIdx === 0) continue;
    const info = subsectionLines.slice(0, descriptionsLineIdx), descLines = subsectionLines.slice(descriptionsLineIdx);
    // two dated lines in one job are two roles at one company: the second starts at the line above its dates (its title), and takes the descriptions; none is glued into another's title
    const dated = info.map((l, i) => (l.some(it => YEAR.test(it.text) && isDate(it.text)) ? i : -1)).filter(i => i >= 0);
    const starts = dated.slice(1).map((d, n) => (d - 1 > dated[n] ? d - 1 : d));
    const groups = [0, ...starts].map((from, n, all) => info.slice(from, all[n + 1] ?? info.length));
    let company;
    groups.forEach((g, n) => {
      const { entry, scores } = read(g, n === groups.length - 1 ? descLines : [], company);
      company ??= entry.company || undefined;
      workExperiences.push(entry);
      workExperiencesScores.push(scores);
    });
  }
  return { workExperiences, workExperiencesScores };
};
