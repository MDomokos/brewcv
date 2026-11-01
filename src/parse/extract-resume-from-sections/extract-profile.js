// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/extract-resume-from-sections/extract-profile.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped; section words from the lexicon; Unicode letters in a name; comments reworded; 2026-11-02: email, url and city patterns bounded; 2026-11-01: the lines under a contact heading are read too, an international phone number with a plus, a place and a country, and a bare domain
// Types stripped. Changed: the email, url and city patterns are bounded (a hostile line of 100,000 characters took seconds in the unbounded ones: a match longer than the bound is cut), the section keywords come from the lexicon, and a name may hold any Unicode letter
// (`[\p{L}\s.]` for `[a-zA-Z\s\.]`). Comments reworded: the email pattern's and the email feature set's, and the name's example.
import { getSectionLinesByKeywords } from './lib/get-section-lines.js';
import { isBold, hasNumber, hasComma, hasLetter, hasLetterAndIsAllUpperCase } from './lib/common-features.js';
import { getTextWithHighestFeatureScore } from './lib/feature-scoring-system.js';

// Name
export const matchOnlyLetterSpaceOrPeriod = item => item.text.match(/^[\p{L}\s.]+$/u);

// Email
// Simple email regex: text, an at sign, text, a dot, text (no spaces)
export const matchEmail = item => item.text.match(/[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{1,100}/);
const hasAt = item => item.text.includes('@');

// Phone
// Simple phone regex that matches (xxx)-xxx-xxxx where () and - are optional, - can also be space
// shortcut: besides (xxx)-xxx-xxxx, a number with a plus (+351 900 000 000) is a phone; a number of another shape and no plus is not found
export const matchPhone = item => item.text.match(/\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/) ?? item.text.match(/\+\d[\d ().-]{7,}\d/);
const hasParenthesis = item => /\([0-9]+\)/.test(item.text);

// Location
// Simple location regex that matches "<City>, <ST>"
// shortcut: only "City, ST"; a Hungarian or German address is left over. Add patterns per country when a real resume needs one.
// shortcut: and "City, Country" at the start of an item, ending the item or before a separator ("Lisbon, Portugal · …"); a place on its own line with no comma is a leftover
export const matchCityAndState = item => item.text.match(/[A-Z][a-zA-Z\s]{1,40}, [A-Z]{2}/) ?? item.text.match(/^\p{Lu}[\p{L}.' -]{1,30}, \p{Lu}[\p{L}.' -]{1,30}(?=\s*(?:$|[·|•]))/u);

// Url
// Simple url regex that matches "xxx.xxx/xxx" (xxx = anything not space)
export const matchUrl = item => item.text.match(/\S{1,100}\.[a-z]{1,30}\/\S{1,200}/);
// Match https://xxx.xxx where s is optional
const matchUrlHttpFallback = item => item.text.match(/https?:\/\/\S{1,100}\.\S{1,200}/);
// Match www.xxx.xxx
const matchUrlWwwFallback = item => item.text.match(/www\.\S{1,100}\.\S{1,200}/);
// a bare domain (danaokonkwo.example) at the start of an item or after a separator, ending it or before a separator
const matchUrlBareFallback = item => item.text.match(/(?<=^|[·|•]\s{1,3})[\w-]{1,60}(?:\.[\w-]{1,60}){0,3}\.[a-z]{2,20}(?=\s*(?:$|[·|•]))/i);
const hasSlash = item => item.text.includes('/');

// Summary
const has4OrMoreWords = item => item.text.split(' ').length >= 4;

/**
 *              Unique Attribute
 * Name         Bold or Has all uppercase letter
 * Email        Has @
 * Phone        Has ()
 * Location     Has ,    (overlap with summary)
 * Url          Has slash
 * Summary      Has 4 or more words
 */

/**
 * Name -> contains only letters/space/period, e.g. Jane Q. Sample
 *         (it isn't common to include middle initial in resume)
 *      -> is bolded or has all letters as uppercase
 */
const NAME_FEATURE_SETS = [
  [matchOnlyLetterSpaceOrPeriod, 3, true],
  [isBold, 2],
  [hasLetterAndIsAllUpperCase, 2],
  // Match against other unique attributes
  [hasAt, -4], // Email
  [hasNumber, -4], // Phone
  [hasParenthesis, -4], // Phone
  [hasComma, -4], // Location
  [hasSlash, -4], // Url
  [has4OrMoreWords, -2], // Summary
];

// Email -> match the email regex above
const EMAIL_FEATURE_SETS = [
  [matchEmail, 4, true],
  [isBold, -1], // Name
  [hasLetterAndIsAllUpperCase, -1], // Name
  [hasParenthesis, -4], // Phone
  [hasComma, -4], // Location
  [hasSlash, -4], // Url
  [has4OrMoreWords, -4], // Summary
];

// Phone -> match phone regex (xxx)-xxx-xxxx
const PHONE_FEATURE_SETS = [
  [matchPhone, 4, true],
  [hasLetter, -4], // Name, Email, Location, Url, Summary
];

// Location -> match location regex <City>, <ST>
const LOCATION_FEATURE_SETS = [
  [matchCityAndState, 4, true],
  [isBold, -1], // Name
  [hasAt, -4], // Email
  [hasParenthesis, -3], // Phone
  [hasSlash, -4], // Url
];

// URL -> match url regex xxx.xxx/xxx
const URL_FEATURE_SETS = [
  [matchUrl, 4, true],
  [matchUrlHttpFallback, 3, true],
  [matchUrlWwwFallback, 3, true],
  [matchUrlBareFallback, 3, true],
  [isBold, -1], // Name
  [hasAt, -4], // Email
  [hasParenthesis, -3], // Phone
  [hasComma, -4], // Location
  [has4OrMoreWords, -4], // Summary
];

// Summary -> has 4 or more words
const SUMMARY_FEATURE_SETS = [
  [has4OrMoreWords, 4],
  [isBold, -1], // Name
  [hasAt, -4], // Email
  [hasParenthesis, -3], // Phone
  [matchCityAndState, -4, false], // Location
];

export const extractProfile = (sections, lex) => {
  // the lines under a contact heading (a sidebar's) are the profile's too
  const lines = [...(sections.profile || []), ...getSectionLinesByKeywords(sections, lex.sections.contact)];
  const textItems = lines.flat();

  const [name, nameScores] = getTextWithHighestFeatureScore(textItems, NAME_FEATURE_SETS);
  const [email, emailScores] = getTextWithHighestFeatureScore(textItems, EMAIL_FEATURE_SETS);
  const [phone, phoneScores] = getTextWithHighestFeatureScore(textItems, PHONE_FEATURE_SETS);
  const [location, locationScores] = getTextWithHighestFeatureScore(textItems, LOCATION_FEATURE_SETS);
  const [url, urlScores] = getTextWithHighestFeatureScore(textItems, URL_FEATURE_SETS);
  const [summary, summaryScores] = getTextWithHighestFeatureScore(textItems, SUMMARY_FEATURE_SETS, undefined, true);

  const summaryLines = getSectionLinesByKeywords(sections, lex.sections.summary);
  const summarySection = summaryLines
    .flat()
    .map(textItem => textItem.text)
    .join(' ');
  const objectiveLines = getSectionLinesByKeywords(sections, lex.sections.objective);
  const objectiveSection = objectiveLines
    .flat()
    .map(textItem => textItem.text)
    .join(' ');

  return {
    profile: {
      name,
      email,
      phone,
      location,
      url,
      // Dedicated section takes higher precedence over profile summary
      summary: summarySection || objectiveSection || summary,
    },
    // For debugging
    profileScores: {
      name: nameScores,
      email: emailScores,
      phone: phoneScores,
      location: locationScores,
      url: urlScores,
      summary: summaryScores,
    },
  };
};
