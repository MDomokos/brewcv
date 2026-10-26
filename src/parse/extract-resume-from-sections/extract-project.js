// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/extract-resume-from-sections/extract-project.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped; section and date words from the lexicon
// Types stripped. Changed: the section keywords and the date words come from the lexicon.
import { getSectionLinesByKeywords } from './lib/get-section-lines.js';
import { dateFeatureSets, getHasText, isBold } from './lib/common-features.js';
import { divideSectionIntoSubsections } from './lib/subsections.js';
import { getTextWithHighestFeatureScore } from './lib/feature-scoring-system.js';
import { getBulletPointsFromLines, getDescriptionsLineIdx } from './lib/bullet-points.js';

export const extractProject = (sections, lex) => {
  const projects = [];
  const projectsScores = [];
  const lines = getSectionLinesByKeywords(sections, lex.sections.project);
  const subsections = divideSectionIntoSubsections(lines);

  for (const subsectionLines of subsections) {
    const descriptionsLineIdx = getDescriptionsLineIdx(subsectionLines) ?? 1;

    const subsectionInfoTextItems = subsectionLines.slice(0, descriptionsLineIdx).flat();
    const [date, dateScores] = getTextWithHighestFeatureScore(subsectionInfoTextItems, dateFeatureSets(lex));
    const PROJECT_FEATURE_SET = [
      [isBold, 2],
      [getHasText(date), -4],
    ];
    const [project, projectScores] = getTextWithHighestFeatureScore(subsectionInfoTextItems, PROJECT_FEATURE_SET, false);

    const descriptionsLines = subsectionLines.slice(descriptionsLineIdx);
    const descriptions = getBulletPointsFromLines(descriptionsLines);

    projects.push({ project, date, descriptions });
    projectsScores.push({ projectScores, dateScores });
  }
  return { projects, projectsScores };
};
