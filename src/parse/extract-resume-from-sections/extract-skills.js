// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/extract-resume-from-sections/extract-skills.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped; section word from the lexicon; featured skills are plain texts
// Types stripped. Changed: the section keyword comes from the lexicon, and the featured skills are the first
// six texts as they are (OpenResume's redux state gave each a rating, which JSON Resume has no use for).
import { getSectionLinesByKeywords } from './lib/get-section-lines.js';
import { getBulletPointsFromLines, getDescriptionsLineIdx } from './lib/bullet-points.js';

export const extractSkills = (sections, lex) => {
  const lines = getSectionLinesByKeywords(sections, lex.sections.skills);
  const descriptionsLineIdx = getDescriptionsLineIdx(lines) ?? 0;
  const descriptionsLines = lines.slice(descriptionsLineIdx);
  const descriptions = getBulletPointsFromLines(descriptionsLines);

  let featuredSkills = [];
  if (descriptionsLineIdx !== 0) {
    const featuredSkillsLines = lines.slice(0, descriptionsLineIdx);
    featuredSkills = featuredSkillsLines
      .flat()
      .filter(item => item.text.trim())
      .slice(0, 6)
      .map(item => item.text);
  }

  return { skills: { featuredSkills, descriptions } };
};
