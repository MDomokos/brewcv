// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/extract-resume-from-sections/lib/common-features.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped; word lists from the lexicon; Unicode letters; months, seasons and "present" matched by a boundary rule; 2026-11-01: an item set in capitals by its style counts as upper case; a month is also its three-letter form; a font named Black, Heavy or Demi is bold
// Types stripped. Changed: the word lists come from the lexicon (see lexicon.js); a letter is any Unicode
// letter, so Hungarian or German headings and names count; a month, season or "present" is found in any case,
// from a letter boundary on, and as a whole word where it is short (see `found`). An item a reader marked `caps` (all capitals by its style, typed in
// lower case) is upper case.

// a weight a font's name says: Bold, SemiBold, ExtraBold, Black, Heavy, Demi ("HankenGrotesk-Black" is bold, with no "Bold" in it)
export const HEAVY = /bold|black|heavy|demi/i;
const isTextItemBold = fontName => HEAVY.test(fontName);
export const isBold = item => isTextItemBold(item.fontName);
export const hasLetter = item => /\p{L}/u.test(item.text);
export const hasNumber = item => /[0-9]/.test(item.text);
export const hasComma = item => item.text.includes(',');
export const getHasText = text => item => item.text.includes(text);
export const hasOnlyLettersSpacesAmpersands = item => /^[\p{L}\s&]+$/u.test(item.text);
export const hasLetterAndIsAllUpperCase = item => hasLetter(item) && (!!item.caps || item.text.toUpperCase() === item.text);

// Date Features
const hasYear = item => /(?:19|20)\d{2}/.test(item.text);
// A word is found from a letter boundary on ("Representative" is not "present", "Doctor" is not "octo"), and as a
// whole word when it is four letters or fewer ("Mai" is not "Maier"). A season or "present" is always a whole word,
// and a month may be a longer word that starts with its name or its first four letters (Hungarian "márciusban").
const found = (text, words, whole) => words.some(w =>
  new RegExp(`(?<!\\p{L})${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${whole || w.length <= 4 ? '(?!\\p{L})' : ''}`, 'iu').test(text));
export const dateFeatureSets = lex => {
  const hasMonth = item => lex.months.some(month => found(item.text, [month, month.slice(0, 4), month.slice(0, 3)]));      // and the three-letter form a design sets (SET, GIU, DIC, MAR)
  const hasSeason = item => found(item.text, lex.seasons, true);
  const hasPresent = item => found(item.text, lex.present, true);
  return [
    [hasYear, 1],
    [hasMonth, 1],
    [hasSeason, 1],
    [hasPresent, 1],
    [hasComma, -1],
  ];
};
