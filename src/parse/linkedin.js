// Not from OpenResume. A LinkedIn data export (the ZIP) as JSON Resume, straight from its CSV files, with no parser; it answers in the parser's shape
// ({ jsonResume, trace, leftovers, doubts }, the last three empty) so a caller treats every reader alike.
// It reads Profile, Positions, Education, Skills and Email Addresses. A header is matched in lower case, by any name it has had.
// shortcut: months are English ("Jan 2020"), the place is "city, region" from the first two parts of Geo Location, and the other files
// (Languages, Certifications, Projects, ...) are not read. Add them when a real export has what the person wants.
import { unzip } from './unzip.js';
import { parseCsv } from './csv.js';
import { decode } from './lines.js';

const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
// "Jan 2020", "2020", "01/2020", "2020-01-15" as YYYY-MM or YYYY
const date = s => {
  const year = /(?:19|20)\d{2}/.exec(s)?.[0];
  if (!year) return undefined;
  const month = MONTHS.indexOf(s.trim().slice(0, 3).toLowerCase()) + 1 || +(/^(\d{1,2})\//.exec(s)?.[1] ?? /^\d{4}-(\d{2})/.exec(s)?.[1] ?? 0);
  return month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, '0')}` : year;
};

export async function readLinkedin(bytes){
  const z = unzip(bytes);
  // the rows of a file as { header in lower case: cell }, with a pick by any of the names a column has had
  const table = async re => {
    const name = z.names.find(n => re.test(n));
    const [head = [], ...rows] = name ? parseCsv(decode(await z.read(name))) : [];
    return rows.filter(r => r.some(c => c.trim())).map(r => {
      const row = Object.fromEntries(head.map((h, i) => [h.trim().toLowerCase(), (r[i] ?? '').trim()]));
      return (...names) => names.map(n => row[n]).find(Boolean) ?? '';
    });
  };
  const [[profile], positions, education, skills, emails] = await Promise.all([table(/(^|\/)profile\.csv$/i), table(/(^|\/)positions\.csv$/i), table(/(^|\/)education\.csv$/i), table(/(^|\/)skills\.csv$/i), table(/(^|\/)email addresses\.csv$/i)]);
  const out = { basics: {} }, put = (o, k, v) => { if (v) o[k] = v; };
  if (profile){
    put(out.basics, 'name', [profile('first name'), profile('last name')].filter(Boolean).join(' '));
    put(out.basics, 'label', profile('headline'));
    put(out.basics, 'summary', profile('summary'));
    const [city, region] = profile('geo location', 'location').split(',').map(s => s.trim());
    if (city) out.basics.location = { city, ...(region ? { region } : {}) };
    put(out.basics, 'url', /https?:\/\/[^\s\],]+/.exec(profile('websites'))?.[0]);
  }
  put(out.basics, 'email', (emails.find(e => /^yes$/i.test(e('primary'))) ?? emails[0])?.('email address', 'email'));
  const list = (key, rows, build) => { const got = rows.map(build).filter(o => Object.keys(o).length); if (got.length) out[key] = got; };
  list('work', positions, r => {
    const o = {}, end = r('finished on', 'end date', 'end');
    put(o, 'name', r('company name', 'company', 'organization')); put(o, 'position', r('title', 'job title', 'position'));
    put(o, 'startDate', date(r('started on', 'start date', 'start'))); put(o, 'endDate', date(end));
    put(o, 'location', r('location'));
    const highlights = r('description').split(/\r?\n/).map(l => l.replace(/^\s*[-*+•·▪●◦○■–]\s*/, '').trim()).filter(Boolean);
    if (highlights.length) o.highlights = highlights;
    return o;
  });
  list('education', education, r => {
    const o = {};
    put(o, 'institution', r('school name', 'school')); put(o, 'studyType', r('degree name', 'degree'));
    put(o, 'startDate', date(r('start date', 'started on'))); put(o, 'endDate', date(r('end date', 'finished on')));
    return o;
  });
  if (skills.length) out.skills = [{ keywords: skills.map(r => r('name', 'skill')).filter(Boolean) }];
  return { jsonResume: out, trace: [], leftovers: [], doubts: [] };
}
