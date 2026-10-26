// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/extract-resume-from-sections/index.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped; the lexicon passed on; no `custom` part
// Types stripped. Changed: the lexicon is passed to every extractor, and the result has no `custom` part (the
// redux state's own field, nothing to read it from).
import { extractProfile } from './extract-profile.js';
import { extractEducation } from './extract-education.js';
import { extractWorkExperience } from './extract-work-experience.js';
import { extractProject } from './extract-project.js';
import { extractSkills } from './extract-skills.js';

/**
 * Step 4. Extract resume from sections.
 *
 * This is the core of the resume parser to resume information from the sections.
 *
 * The gist of the extraction engine is a feature scoring system. Each resume attribute
 * to be extracted has a custom feature sets, where each feature set consists of a
 * feature matching function and a feature matching score if matched (feature matching
 * score can be a positive or negative number). To compute the final feature score of
 * a text item for a particular resume attribute, it would run the text item through
 * all its feature sets and sum up the matching feature scores. This process is carried
 * out for all text items within the section, and the text item with the highest computed
 * feature score is identified as the extracted resume attribute.
 */
export const extractResumeFromSections = (sections, lex) => {
  const { profile } = extractProfile(sections, lex);
  const { educations } = extractEducation(sections, lex);
  const { workExperiences } = extractWorkExperience(sections, lex);
  const { projects } = extractProject(sections, lex);
  const { skills } = extractSkills(sections, lex);

  return { profile, educations, workExperiences, projects, skills };
};
