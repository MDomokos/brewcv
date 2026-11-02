// Ported from OpenResume by Xitang Zhao (AGPL-3.0), src/app/lib/parse-resume-from-pdf/extract-resume-from-sections/extract-work-experience.ts, commit 4f8255a2c763479837f69f1dccf2a3338730cd79; modified for BrewCV 2026-10-26: types stripped; section, job-title and date words from the lexicon; 2026-11-02: a block with no job line above its text is no job; 2026-11-01: the company, the title and the place are told apart on a line with a date; 2026-11-03: a job starts at a line in the title's look or at a dated line, never at plain text, and a date line beside a title belongs to it
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
// An organisation word in a part marks it as the company ("Northgate University", "Instituto Superior Técnico", "Lisbon Hospital"), unless it also holds a job-title word ("School Teacher").
// shortcut: the words of the ten catalogue languages that are cheap (a school, a university, a hospital, an institute, a law firm, a group), without their inflections; add more as real files show them
const ORG = new RegExp(`(?<!\\p{L})(?:${['University', 'College', 'Institute', 'School', 'Academy', 'Hospital', 'Clinic', 'Foundation', 'Association', 'Museum', 'Law', 'Group', 'Partners', 'Laboratory', 'Laboratories',
  'Universität', 'Hochschule', 'Institut', 'Schule', 'Klinikum', 'Krankenhaus', 'Stiftung', 'Université', 'École', 'Ecole', 'Hôpital', 'Cabinet', 'Groupe', 'Universidad', 'Universidade', 'Instituto', 'Escuela', 'Escola', 'Grupo', 'Fundación', 'Fundação',
  'Università', 'Istituto', 'Scuola', 'Ospedale', 'Gruppo', 'Egyetem', 'Főiskola', 'Intézet', 'Iskola', 'Kórház', 'Csoport', 'Alapítvány', 'Uniwersytet', 'Instytut', 'Szkoła', 'Szpital', 'Grupa', 'Fundacja',
  'Univerzita', 'Ústav', 'Škola', 'Nemocnice', 'Skupina', 'Nadace', 'Universiteit', 'Hogeschool', 'Instituut', 'School', 'Ziekenhuis', 'Groep', 'Stichting'].join('|')})(?!\\p{L})`, 'iu');
const isPlace = t => !hasForm(t) && (/,/.test(t) ? /^\p{Lu}[\p{L}.' -]{1,30}, \p{Lu}[\p{L}.' -]{1,30}$/u.test(t.trim()) : /^\p{Lu}[\p{L}.'-]{1,30}$/u.test(t.trim()));
const YEAR = /(?:19|20)\d{2}/;

export const extractWorkExperience = (sections, lex) => {
  const hasJobTitle = item => lex.jobTitles.some(jobTitle => item.text.split(/\s/).some(word => word === jobTitle));
  const JOB_TITLE_FEATURE_SET = [
    [hasJobTitle, 4],
    [hasNumber, -4],
    [hasMoreThan5Words, -2],
    [item => org(item.text), -6],      // a company with a title word in it ("Engineering Director Ltd") is not the title
  ];
  const org = t => hasForm(t) || (ORG.test(t) && !hasJobTitle({ text: t }));
  const isDate = t => dateFeatureSets(lex).reduce((n, [has, score]) => n + (has({ text: t }) ? score : 0), 0) > 0;
  const isDateWord = w => /^[–—-]$/.test(w) || isDate(w);

  const workExperiences = [];
  const workExperiencesScores = [];
  const lines = getSectionLinesByKeywords(sections, lex.sections.work);
  const isDateItem = it => YEAR.test(it.text) && isDate(it.text), isDated = l => l.some(isDateItem);
  const look = it => `${Math.round(it.height)}|${isBold(it)}`;
  const commonest = (f, items) => { const n = new Map(); for (const it of items) n.set(f(it), (n.get(f(it)) ?? 0) + it.text.length); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0]; };
  // A job starts at a line in the title's look (the look of the line beside a date line: 12 pt bold, say) or at a date line that has no title yet, never at plain text: a sentence's short tail after a gap goes on
  // with the job above, and a date line straight above the title (its baseline a point or two higher) is that title's. The date line must be short and end in no full stop (a description that holds a date is not one).
  // shortcut: the title's look is the commonest look next to a date line (the line before it, else the one after), and counts only when it is not the look of most of the text; a design whose jobs start with plain print is split by gaps alone
  const bodyLook = commonest(look, lines.flat()), bodyFont = commonest(it => it.fontName, lines.flat());
  const header = l => isDated(l) && l.map(it => it.text).join(' ').length <= 45 && !/[.!?]$/.test(l.at(-1).text);
  const beside = lines.flatMap((l, i) => (header(l) ? [l.find(it => !isDateItem(it)) ?? [lines[i - 1], lines[i + 1]].filter(x => x && !isDated(x) && look(x[0]) !== bodyLook)[0]?.[0]].filter(Boolean) : []));
  const titleLook = commonest(look, beside), styled = titleLook !== bodyLook ? titleLook : undefined;
  const st = l => look(l[0]) === styled;
  let subsections = divideSectionIntoSubsections(lines);
  if (styled) subsections = lines.reduce((groups, l) => {
    const g = groups.at(-1), last = g?.at(-1);
    const opens = !g || (st(l) ? !(st(last) && !isDated(last)) && !header(last) : header(l) && !st(l) && !(st(last) && !isDated(last)) && g.some(x => header(x)));      // a title straight after a date line is that line's (a date set above its title, or a second role), a title after text a new job
    if (opens) groups.push([l]); else g.push(l);
    return groups;
  }, []);

  // One entry from the lines above its descriptions. `inherit` is the company of the entry above, for a second dated line in one job (a later role at the same company).
  const read = (infoLines, descriptionsLines, inherit) => {
    // a line of company and title with no dates ("Hydra Medical · Design Engineer") is two items
    const items = infoLines.flat().flatMap(i => (!isDate(i.text) && /\s[·|•]\s/.test(i.text) ? i.text.split(/\s*[·|•]\s*/).filter(Boolean).map(text => ({ ...i, text })) : [i]));
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
    if (!jobTitle) jobTitle = rest.find(t => hasJobTitle({ text: t }) && !org(t)) ?? '';
    const COMPANY_FEATURE_SET = [
      [isBold, 2],
      [item => org(item.text), 4],
      [getHasText(date), -4],
      [getHasText(jobTitle), -4],
    ];
    let [company, companyScores] = getTextWithHighestFeatureScore(items, COMPANY_FEATURE_SET, false);
    if (!company || company === jobTitle || company === date) company = rest.find(org) ?? rest.find(t => t !== jobTitle && !hasJobTitle({ text: t })) ?? '';
    // a part with an organisation word on the dated line is the company, and a first line without one is then the position
    const orgPart = rest.find(org);
    if (orgPart && !jobTitle && company && company !== orgPart && !org(company)){ jobTitle = company; company = orgPart; }
    // a line in the title's look is the title, though no title word is in it, and the company is then the first line that is no date and no place ("Prototype Tester" over "Polytechnic Prototyping Lab" over "Porto, Portugal")
    const titled = styled && items.find(i => look(i) === styled && !isDate(i.text) && i.text !== date);
    const next = titled && items.map(i => i.text).find(t => t !== titled.text && t !== date && !isDate(t) && (org(t) || !isPlace(t)));
    if (next && !jobTitle && !rest.length && company === titled.text){ jobTitle = company; company = next; }
    let doubt = false;
    // no job-title word anywhere: the first line is a title when it is set larger than the dated line (a heading over small print), else the company ("Northgate Law" over "Partner · Mar 2020 – Present");
    // with no way to tell, both are kept, one as the company and one as the position, and the company doubt is raised
    if (!jobTitle && company && company !== date && !org(company) && rest.length === 1 && rest[0] !== company){
      const h = x => items.find(i => i.text === x)?.height ?? 0;
      if (h(company) >= 1.15 * h(date)){ jobTitle = company; company = rest[0]; }
      else { jobTitle = rest[0]; const it = items.find(i => i.text === company); doubt = !(it && isBold(it)); }
    }
    // no job-title word and nothing on the dated line but the dates: the line above them is the title and the one below the company ("Head Wrangler" / "Mar 2020 – Present" / "Hydra Medical")
    const at = infoLines.findIndex(l => l.some(i => i.text === date));
    if (!jobTitle && !rest.length && at > 0 && at < infoLines.length - 1 && date && segments.length === 1){
      const text = l => l.map(i => i.text).join(' ').trim();
      if (!isDate(text(infoLines[at - 1])) && !isDate(text(infoLines[at + 1]))){ jobTitle = text(infoLines[at - 1]); company = text(infoLines[at + 1]); }
    }
    // a title with no job-title word is what the dated line holds besides the company and the place
    const left = rest.filter(t => t !== company && t !== jobTitle);
    if (!jobTitle && left.length) jobTitle = left.shift();
    if (!company && inherit) company = inherit;
    // a line of its own under the company, at its left edge ("Porto, Portugal"), that is a place is the place
    const edge = items.find(i => i.text === company)?.x;
    for (const i of items) if (edge !== undefined && Math.abs(i.x - edge) <= 12 && i.text !== company && i.text !== jobTitle && i.text !== date && isPlace(i.text) && !isDate(i.text) && !places.includes(i.text)) places.push(i.text);

    return { entry: { company, jobTitle, date, descriptions: getBulletPointsFromLines(descriptionsLines), ...(places.length ? { location: places[0] } : {}), ...(left.length || places.length > 1 ? { left: [...left, ...places.slice(1)] } : {}), ...(doubt ? { unsure: true } : {}) }, scores: { companyScores, jobTitleScores, dateScores } };
  };

  // A dated line found under the descriptions starts the next job (plain print, even spacing: "Company · dates", the title, the bullets, and again), with the title above it when that is a short line of its own. A line that
  // holds a date and is no description (no bullet, under eight words, no full stop at the end) counts; a sentence that mentions a year does not.
  // shortcut: the job is cut at the first such line after text; one more dated line before any text is a second role of the job, and a design that sets dates inside its descriptions in a line of their own is cut there
  const text = l => l.map(i => i.text).join(' ').trim(), prose = l => getDescriptionsLineIdx([l]) !== undefined;
  const dateLine = l => isDated(l) && !prose(l) && !/[.!?]$/.test(text(l));
  subsections = subsections.flatMap(sub => {
    const first = getDescriptionsLineIdx(sub);
    if (first === undefined) return [sub];
    const out = [];
    let from = 0, seen = true;
    for (let i = first + 1; i < sub.length; i++){
      if (prose(sub[i])) seen = true;
      else if (seen && dateLine(sub[i])){
        const above = sub[i - 1], start = i - 1 > first && above.length === 1 && !prose(above) && !isDated(above) && !/[.!?]$/.test(text(above)) ? i - 1 : i;
        out.push(sub.slice(from, start)); from = start; seen = false;
      }
    }
    return [...out, sub.slice(from)];
  });

  for (const subsectionLines of subsections) {
    let descriptionsLineIdx = getDescriptionsLineIdx(subsectionLines) ?? 2;
    if (descriptionsLineIdx === 0) continue;
    // a header set in its own font in smaller print (mono print over the text) goes on with the lines in the date line's font: the text starts where the font changes, so a short first line of text is not a company
    const firstDated = subsectionLines.findIndex(l => l.some(it => YEAR.test(it.text) && isDate(it.text)));
    if (firstDated >= 0 && firstDated < descriptionsLineIdx){
      const font = l => `${l[0].fontName}|${l[0].height}`, change = subsectionLines.findIndex((l, i) => i > firstDated && font(l) !== font(subsectionLines[firstDated]));
      if (change > firstDated && change < descriptionsLineIdx && change <= firstDated + 3 && (subsectionLines[change][0].height > subsectionLines[firstDated][0].height + 0.5 || /mono|code|courier|consolas/i.test(subsectionLines[firstDated][0].fontName))) descriptionsLineIdx = change;      // and the text is larger than the header's print, or the header is in a monospace font
    }
    // with a title look and the dates in a font of their own (mono print), the header is the title, the dated line and the lines in that font after them, whatever the text under it says (a short first sentence is text)
    const dateFont = styled && subsectionLines.find(isDated)?.find(isDateItem)?.fontName;
    if (dateFont && dateFont !== bodyFont){
      let k = 0;
      while (k < subsectionLines.length && (st(subsectionLines[k]) || isDated(subsectionLines[k]) || subsectionLines[k][0].fontName === dateFont)) k++;
      if (k > 0 && k < subsectionLines.length) descriptionsLineIdx = k;
    }
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
