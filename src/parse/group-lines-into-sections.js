// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/group-lines-into-sections.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped; title words from the lexicon; Unicode capitals; an item a reader marked as a title; 2026-11-03: a bold heading, or one set 1.5 pt above the body text, with a section word is a title in the first two lines too, and the contact block of a sidebar read after the main column is the profile's; 2026-11-01: the fallback needs a title word at the end of the line and no job-title word, and a short line set apart by its look is a title, and bold capitals with a digit ("CAD & 3D") are not
// Types stripped. Changed: the title keywords come from the lexicon, a capital letter is any Unicode capital, and an item with `title: true`
// (a heading a reader found: a Heading style, #, h1 to h3) is a title whatever its words, unless it is in the first two lines (the name).
// Also new: a short line alone on its row that is set apart from the body text by its look is a title (see `byLook`).
import { hasLetterAndIsAllUpperCase, hasNumber, hasOnlyLettersSpacesAmpersands, isBold } from './extract-resume-from-sections/lib/common-features.js';

export const PROFILE_SECTION = 'profile';

/**
 * Step 3. Group lines into sections
 *
 * Every section (except the profile section) starts with a section title that
 * takes up the entire line. This is a common pattern not just in resumes but
 * also in books and blogs. The resume parser uses this pattern to group lines
 * into the closest section title above these lines.
 */
// A heading set by hand (no heading style): a short line of letters (four words at most, no digits or marks) alone on its row whose look is the titles' look. The look is
// how far a line is set apart from the body text: its size clearly above the body's most common size (1.5 pt, and the more the higher), underlined, coloured or bold unlike the
// body, in that order of weight. The titles' look is that of the lines the rules below already take for titles (a known word, bold capitals); then a line with that look is a
// title too if it ends in a title word ("Professional Work Experience", "Skills" but not "Workday" or "Art History Museum") and holds no job-title word ("Project Manager").
// With no such title the most emphasised look that two lines or more have is the titles' look, whatever the words. A link, a profile-site word and the contact block (down to the last
// line in the first eight that has an @, an address or a phone number) never set the look.
// shortcut: used only when no reader marked a heading, and only when that look is on ten lines or fewer. A resume that sets its company names like its section titles (bold on a
// line of their own) and has no title the rules below know gets titles that are companies; a heading in the body's own look is not seen; a document with one heading in its look
// is not found; a title word ends a line as the lexicon has it, or as its plural with s or es (Skills, Courses; not "Works"), so an inflected heading in another language (Hungarian "Tapasztalatok") is not seen. Tune the numbers on real files.
const SHORT = /^[\p{L}\s&'/-]{2,40}:?$/u;
const SITE = /\b(?:linkedin|github|gitlab|twitter|facebook|instagram|behance|dribbble|xing|orcid|skype|telegram|whatsapp|website|portfolio)\b/i;
const CONTACT = /@|https?:|www\.|\.(?:com|org|net|io|dev|edu)\b|\d{3}\D{0,2}\d{3}/i;
const high = a => a.reduce((m, r) => (r > m ? r : m), 0);
const byLook = (lines, known, lex) => {
  const items = lines.flat();
  if (!items.length || items.some(i => i.title)) return [];
  const most = f => { const n = new Map(); for (const i of items) n.set(f(i), (n.get(f(i)) ?? 0) + i.text.length); return [...n].sort((a, b) => b[1] - a[1])[0][0]; };
  const body = { height: most(i => i.height), color: most(i => i.color ?? ''), bold: most(isBold) };
  const jobs = new Set(lex.jobTitles.map(j => j.toLowerCase())), words = [...lex.titleWords, ...Object.values(lex.sections).flat()];
  let contact = -1;
  lines.slice(0, 8).forEach((l, i) => { if (CONTACT.test(l.map(x => x.text).join(' '))) contact = i; });
  const text = l => l[0]?.text.trim() ?? '', list = l => text(l).toLowerCase().replace(/:$/, '').split(/\s+/);
  const short = lines.map(l => SHORT.test(text(l)) && list(l).length <= 4 && !list(l).some(w => jobs.has(w)));
  const ranks = lines.map((l, i) => {
    if (i < 2 || i <= contact || l.length !== 1 || l[0].link || SITE.test(l[0].text)) return 0;
    const up = l[0].height - body.height;
    return (up >= 1.5 ? Math.round(up) * 100 : 0) + (l[0].underline ? 4 : 0) + ((l[0].color ?? '') !== body.color ? 2 : 0) + (isBold(l[0]) && !body.bold ? 1 : 0);
  });
  const count = new Map();
  for (const r of ranks.filter((r, i) => r && short[i])) count.set(r, (count.get(r) ?? 0) + 1);
  const top = known.some(Boolean) ? high(ranks.filter((r, i) => known[i])) : high([...count].filter(([, n]) => n >= 2).map(([r]) => r));
  const word = l => words.some(k => list(l).at(-1) === k || (k !== 'work' && [`${k}s`, `${k}es`].includes(list(l).at(-1))));      // "Hudson Works" is a company, "Skills" a title
  const set = ranks.map((r, i) => !!top && r === top && short[i] && (!known.some(Boolean) || word(lines[i])));
  return set.filter(Boolean).length <= 10 ? set : [];
};

// the size of most of the text
const bodyHeight = lines => {
  const n = new Map();
  for (const i of lines.flat()) n.set(i.height, (n.get(i.height) ?? 0) + i.text.length);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
};

export const groupLinesIntoSections = (lines, lex) => {
  const sections = {};
  const body = bodyHeight(lines), known = lines.map((line, i) => isSectionTitle(line, i, lex, body)), look = byLook(lines, known, lex);
  let sectionName = PROFILE_SECTION;
  let sectionLines = [];
  // The profile is what comes before the first title. A column cut in two reads the main column first, so the contact block (a name, an address) at the top of a sidebar comes after its sections: the lines
  // around an address, in the column it is in, up to the titles on both sides, are the profile's.
  // shortcut: only when the profile holds no address already, and for a line of four words or fewer holding an @; a phone with no address is not looked for
  const moved = new Set(), cut = lines.map((l, i) => !!(known[i] || look[i]));
  const at = lines.findIndex((l, i) => i > 0 && !cut[i] && /@/.test(l[0]?.text ?? '') && l[0].text.trim().split(/\s+/).length <= 4);
  const profileEnd = cut.indexOf(true) < 0 ? lines.length : cut.indexOf(true);
  if (at >= profileEnd && !lines.slice(0, profileEnd).some(l => l.some(x => /@/.test(x.text)))){
    const same = j => !cut[j] && Math.abs(lines[j][0].x - lines[at][0].x) <= 12;
    let from = at, to = at;
    while (from > 0 && same(from - 1)) from--;
    while (to + 1 < lines.length && same(to + 1)) to++;
    for (let j = from; j <= to; j++) moved.add(j);
  }
  const extra = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line[0]?.text.trim();
    if (moved.has(i)) { extra.push(line); continue; }
    if (known[i] || look[i]) {
      sections[sectionName] = [...sectionLines];
      sectionName = text;
      sectionLines = [];
    } else {
      sectionLines.push(line);
    }
  }
  if (sectionLines.length > 0) {
    sections[sectionName] = [...sectionLines];
  }
  if (extra.length) sections[PROFILE_SECTION] = [...(sections[PROFILE_SECTION] ?? []), ...extra];
  return sections;
};

// a title word is the whole line or its end, with at most three letters after it (a plural: "Skills", "Tapasztalatok"): "Work Experience" is a title, "Patent Attorney", "Language Teacher" and "Project Manager" are not.
// A heading of two things with an ampersand ("Education & Training", "Skills & Tools") is a title when either side ends in one.
// shortcut: only the ampersand joins (as before, when a heading was a title by any title word in two words at most); one with the word "and" reads by its last part, or by its look
const AND = /\s&\s/;
const endsWithTitleWord = (text, words) => text.toLowerCase().replace(/:$/, '').split(AND).some(t => words.some(k => { const i = t.lastIndexOf(k); return i >= 0 && /^\p{L}{0,3}$/u.test(t.slice(i + k.length)); }));

const isSectionTitle = (line, lineNumber, lex, body) => {
  const isFirstTwoLines = lineNumber < 2;
  const hasMoreThanOneItemInLine = line.length > 1;
  const hasNoItemInLine = line.length === 0;
  if (hasMoreThanOneItemInLine || hasNoItemInLine) {
    return false;
  }
  // The first two lines are the name, unless one is a heading: a short bold line, or one set 1.5 pt above the body text (a 16 pt "Experience" in a 10 pt text), that ends in a known section word ("Experience") is a title wherever it is (a column that starts with its heading,
  // the name being elsewhere).
  if (isFirstTwoLines) {
    const first = line[0], t = first.text.trim();
    return !!first.title || ((isBold(first) || first.height - body >= 1.5) && t.split(/\s+/).length <= 2 && endsWithTitleWord(t, lex.titleWords) && !t.toLowerCase().split(/\s+/).some(w => lex.jobTitles.some(j => j.toLowerCase() === w)));
  }

  const textItem = line[0];
  if (textItem.title) return true;

  // The main heuristic to determine a section title is to check if the text is double emphasized
  // to be both bold and all uppercase, which is generally true for a well formatted resume
  if (isBold(textItem) && hasLetterAndIsAllUpperCase(textItem) && !hasNumber(textItem)) {      // not "CAD & 3D", a skill group
    return true;
  }

  // The following is a fallback heuristic to detect section title if it includes a keyword match
  // (This heuristics is not well tested and may not work well)
  const text = textItem.text.trim();
  const textHasAtMost2Words = text.split(' ').filter(s => s !== '&').length <= 2;
  const startsWithCapitalLetter = /\p{Lu}/u.test(text.slice(0, 1));

  if (
    textHasAtMost2Words &&
    hasOnlyLettersSpacesAmpersands(textItem) &&
    startsWithCapitalLetter &&
    endsWithTitleWord(text, lex.titleWords) &&
    !text.toLowerCase().split(/\s+/).some(w => lex.jobTitles.some(j => j.toLowerCase() === w))
  ) {
    return true;
  }

  return false;
};
