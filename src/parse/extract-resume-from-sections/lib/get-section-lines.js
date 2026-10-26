// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/extract-resume-from-sections/lib/get-section-lines.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped; the profile is never a match
// Types stripped. Changed: the profile (the lines before the first title) is never a match, since a lexicon
// may hold "profil" for a summary and "profile" is the name it is kept under.
import { PROFILE_SECTION } from '../../group-lines-into-sections.js';

/**
 * Return section lines that contain any of the keywords.
 */
export const getSectionLinesByKeywords = (sections, keywords) => {
  for (const sectionName in sections) {
    if (sectionName === PROFILE_SECTION) continue;
    const hasKeyWord = keywords.some(keyword => sectionName.toLowerCase().includes(keyword));
    if (hasKeyWord) {
      return sections[sectionName];
    }
  }
  return [];
};
