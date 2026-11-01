// Not from OpenResume. Turns what its extractors found into JSON Resume, and says where each text came from
// (`trace`: the page and line of the first line that holds it) and which lines no extractor used (`leftovers`).
import { BULLET_POINTS } from './extract-resume-from-sections/lib/bullet-points.js';

const squash = s => s.replace(/\s+/g, ' ').trim().toLowerCase();
const plain = s => squash(BULLET_POINTS.reduce((t, b) => t.replaceAll(b, ' '), s));

const shared = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };

// "Mar 2019 – Present", "2019. március – 2021. június", "2018 - 2020" into JSON Resume's dates.
// shortcut: a dash always splits, so an ISO "2019-03" is read as two dates; a part without a year is kept as written in startDate;
// Czech červen and červenec (June, July) are told apart only when the whole name is there. Read the numbers around a month when a real resume needs them.
function dates(raw, lex){
  const [from, to] = raw.split(/\s*[-–—]\s*/);
  const one = s => {
    const year = s?.match(/(?:19|20)\d{2}/)?.[0];
    if (!year) return undefined;
    // the month whose name shares the most letters with a word, so "Mar", "március" and "března" all find theirs
    let m = -1, best = 0;
    for (const w of s.toLowerCase().match(/\p{L}{3,}/gu) ?? []) lex.months.forEach((name, i) => {
      const n = shared(w, name.toLowerCase());
      if (n > best && n >= w.length - 3){ best = n; m = i; }
    });
    return m < 0 ? year : `${year}-${String(m + 1).padStart(2, '0')}`;
  };
  const startDate = one(from);
  if (!startDate) return raw ? { startDate: raw } : {};
  const open = lex.present.some(p => to?.toLowerCase().includes(p.toLowerCase()));
  const endDate = open ? undefined : one(to);
  return { startDate, ...(endDate ? { endDate } : {}) };
}

// "CAD: SolidWorks, Fusion 360" is a group named CAD; a line with no colon is a group with no name.
const skillGroup = d => {
  const m = d.match(/^([^:]{1,40}):\s*(.+)$/);
  return { ...(m ? { name: m[1].trim() } : {}), keywords: (m ? m[2] : d).split(/\s*[,;]\s*/).filter(Boolean) };
};

export function toJsonResume(resume, lines, sections, lex){
  const texts = lines.map(l => squash(l.map(i => i.text).join(' ')));
  const pageOf = n => lines[n].find(i => i.page != null)?.page;
  const trace = [];
  // the first line from `from` on that holds the text (a bullet that wraps is found by its first words)
  const locate = (raw, from = 0) => {
    const key = squash(raw).slice(0, 20);
    return key ? texts.findIndex((t, i) => i >= from && t.includes(key)) : -1;
  };
  const at = (path, raw, from) => {
    const n = locate(raw, from);
    if (n >= 0) trace.push({ path, ...(pageOf(n) != null ? { page: pageOf(n) } : {}), line: n + 1 });
    return n;
  };
  const put = (obj, key, value, path, raw, from) => { if (!value) return -1; obj[key] = value; return at(`${path}.${key}`, raw ?? value, from); };

  const p = resume.profile;
  const basics = {};
  for (const k of ['name', 'email', 'phone', 'url', 'summary']) put(basics, k, p[k], `basics`);
  if (p.location){
    const [city, ...rest] = p.location.split(',');
    basics.location = { city: city.trim(), region: rest.join(',').trim() };
    at('basics.location', p.location);
  }
  const out = { basics };

  // each list keeps its entries in the page's order, so a text is looked for from where the last entry was found
  const list = (key, entries, build) => {
    const got = [];
    let cursor = 0;
    for (const e of entries){
      const entry = {}, found = build(entry, `${key}.${got.length}`, cursor, e);
      if (Object.keys(entry).length){ got.push(entry); cursor = Math.max(cursor, ...found.filter(n => n >= 0)); }
    }
    if (got.length) out[key] = got;
  };
  // each text is looked for after the one before it, so bullets that start with the same words get their own lines
  const many = (entry, field, path, cursor, items) => {
    if (items.length) entry[field] = items;
    let from = cursor;
    return items.map((d, k) => { const n = at(`${path}.${field}.${k}`, d, from); if (n >= 0) from = n + 1; return n; });
  };
  const dated = (entry, path, cursor, raw) => Object.entries(dates(raw, lex)).map(([k, v]) => put(entry, k, v, path, raw, cursor));

  list('work', resume.workExperiences, (w, path, c, e) => [
    put(w, 'name', e.company, path, e.company, c), put(w, 'position', e.jobTitle, path, e.jobTitle, c),
    ...dated(w, path, c, e.date), ...many(w, 'highlights', path, c, e.descriptions)]);
  list('education', resume.educations, (w, path, c, e) => [
    put(w, 'institution', e.school, path, e.school, c), put(w, 'studyType', e.degree, path, e.degree, c),
    put(w, 'score', e.gpa, path, e.gpa, c), ...dated(w, path, c, e.date), ...many(w, 'courses', path, c, e.descriptions)]);
  list('projects', resume.projects, (w, path, c, e) => [
    put(w, 'name', e.project, path, e.project, c), ...dated(w, path, c, e.date), ...many(w, 'highlights', path, c, e.descriptions)]);
  const { featuredSkills, descriptions } = resume.skills;
  const groups = [...(featuredSkills.length ? [{ keywords: featuredSkills }] : []), ...descriptions.map(skillGroup)];
  if (groups.length) out.skills = groups;

  // a line is used when every piece of an item (cut at its bullets) is a text an extractor took or lies inside one (a bullet
  // that wraps), so two bullets in one item count; a line that merely holds such a text is not, except for the few fields an
  // extractor matches inside an item ("GPA: 3.8")
  const taken = [];
  (function walk(v){ if (typeof v === 'string'){ if (plain(v)) taken.push(plain(v)); } else if (v && typeof v === 'object') Object.values(v).forEach(walk); })(resume);
  const matched = [p.email, p.phone, p.url, p.location, ...resume.educations.map(e => e.gpa)].filter(Boolean).map(plain);
  // shortcut: a line that lies inside a taken text is looked for in the first 200,000 characters of the texts of 2,000 characters or less, so a hostile file of 40,000 lines is read in a second
  // and not in a minute; a line past that is a leftover. Raise the limit, or index the texts, when a real file needs it.
  const exact = new Set(taken), blob = taken.filter(s => s.length <= 2000).join('\n').slice(0, 200000);
  const inside = t => exact.has(t) || (t.length >= 3 && blob.includes(t));
  const used = i => {
    const pieces = i.text.split(new RegExp(`[${BULLET_POINTS.join('')}]`, 'u')).map(plain).filter(Boolean);
    return pieces.every(inside) || matched.some(m => pieces.some(t => t.includes(m)));
  };
  const where = new Map(lines.map((l, i) => [l, i]));      // a line's number, found at once (indexOf made a long file quadratic)
  const leftovers = [];
  // a paragraph that wraps over lines is one leftover: a line joins the one before it when that was a leftover too, of six words or more, in the same section, one line gap above
  // shortcut: "one line gap" is the commonest gap between lines, times 1.4; a paragraph cut by a column or a page is two leftovers
  const gaps = new Map();
  for (let i = 1; i < lines.length; i++){ const g = Math.round(lines[i - 1][0].y - lines[i][0].y); if (g > 0) gaps.set(g, (gaps.get(g) ?? 0) + 1); }
  const gap = [...gaps].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 0;
  let last = null;
  for (const [section, ls] of Object.entries(sections)) for (const l of ls){
    if (l.some(used) || !plain(l.map(i => i.text).join(' '))) continue;
    const n = where.get(l), text = l.map(i => i.text).join(' ').trim(), above = n > 0 ? lines[n - 1][0].y - l[0].y : 0;
    if (last && last.n === n - 1 && last.section === section && last.words >= 6 && above > 0 && above <= gap * 1.4){ last.at.text += ' ' + text; last.n = n; last.words = text.split(/\s+/).length; continue; }
    const at = { text, section, ...(pageOf(n) != null ? { page: pageOf(n) } : {}), line: n + 1 };
    leftovers.push(at);
    last = { at, n, section, words: text.split(/\s+/).length };
  }
  return { jsonResume: out, trace, leftovers };
}
