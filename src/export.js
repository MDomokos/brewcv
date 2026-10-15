// Export as pure string work, so Node can check it. src/ui/export.js fetches,
// downloads and prints. The HTML page is self-contained: no scripts, inlined CSS and fonts.

import { resolve } from './model/resume.js';
import { JSON_RESUME_SCHEMA, JSON_RESUME_VERSION } from './model/schema.js';
import { langName } from './model/lang.js';
import { t } from './i18n/index.js';

// css: [{ href, text }] in template order, with url()s already inlined.
export function assembleHtml({ templateHtml, css = [], documentHtml, title = 'Resume', lang = 'en', rootVars = {} }){
  let h = String(templateHtml);
  h = h.replace(/<!--[\s\S]*?-->/g, '');
  h = h.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  h = h.replace(/<link\b[^>]*rel=["']?preload["']?[^>]*>\s*/gi, '');
  let i = 0;
  h = h.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, tag => {
    const href = (tag.match(/href=["']([^"']+)["']/) ?? [])[1];
    const c = css.find(x => x.href === href) ?? css[i];
    i++;
    return c ? `<style>\n${c.text.replace(/<\/style/gi, '<\\/style')}\n</style>` : '';
  });
  // stylesheets the app adds on top of the template's own
  const extra = css.filter(x => !String(templateHtml).includes(`href="${x.href}"`));
  const vars = Object.entries(rootVars).filter(([k, v]) => /^--[a-z0-9-]+$/.test(k) && /^[#\w\s.,()%-]+$/.test(String(v)) && !/url\(|expression|javascript/i.test(String(v)));
  const tail = [...extra.map(c => `<style>\n${c.text}\n</style>`), vars.length ? `<style>:root { ${vars.map(([k, v]) => `${k}: ${v};`).join(' ')} }</style>` : ''].join('\n');
  h = h.replace(/<\/head>/i, `${tail}\n</head>`);
  h = h.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  h = h.replace(/<html\b[^>]*>/i, `<html lang="${escapeHtml(lang)}">`);
  h = h.replace(/(<div class="document">)[\s\S]*?(<\/div>\s*<\/body>)/i, (_, a, b) => `${a}\n${documentHtml}\n${b}`);
  return h.replace(/\n{3,}/g, '\n\n');
}

export const escapeHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Strip the app's own attributes and rb- classes.
export function cleanMarkup(html){
  // the app's attributes, and what makes a line editable on the page (never in an export)
  return String(html).replace(/\s(data-variant|data-section|data-label|data-missing|contenteditable|spellcheck|aria-multiline)="[^"]*"/g, '').replace(/\srole="textbox"/g, '')
    .replace(/\sclass="([^"]*)"/g, (m, c) => { const k = c.split(/\s+/).filter(x => x && !x.startsWith('rb-')).join(' '); return k ? ` class="${k}"` : ''; });
}

// url()s resolve against the stylesheet's own href.
export function cssUrls(text, href){
  const base = String(href).replace(/[^/]*$/, '');
  const out = [];
  for (const m of String(text).matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)){
    if (/^(data:|https?:|#)/.test(m[2])) continue;
    out.push({ match: m[0], url: normalisePath(base + m[2]) });
  }
  return out;
}
export function normalisePath(p){
  const parts = [];
  for (const seg of String(p).split('/')){
    if (seg === '..'){ if (parts.length && parts.at(-1) !== '..') parts.pop(); else parts.push('..'); }
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}
export const replaceUrls = (text, map) => String(text).replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, q, u) => (map.has(m) ? `url("${map.get(m)}")` : m));

export function jsonResumeFile(model, recipe, { now = new Date().toISOString().slice(0, 10) } = {}){
  const { body, problems } = resolve(model, recipe, { local: false });
  return { file: { $schema: JSON_RESUME_SCHEMA, ...body, meta: { version: JSON_RESUME_VERSION, lastModified: now } }, problems };
}

const LABELS = {
  en: { summary: 'Summary', work: 'Experience', education: 'Education', skills: 'Skills', publications: 'Publications', certificates: 'Certifications', languages: 'Languages', interests: 'Interests', projects: 'Projects', volunteer: 'Volunteering', awards: 'Awards', references: 'References', present: 'Present' },
};
// `chrome` (src/i18n docChrome) gives a non-English resume its headings.
export function plainText(body, { lang = 'en', sections = null, chrome = null } = {}){
  const L = { ...LABELS.en, ...(LABELS[lang] ?? {}), ...(chrome?.plain ?? {}), ...(chrome?.present ? { present: chrome.present } : {}) };
  const b = body.basics ?? {};
  const out = [];
  const head = (t) => { out.push('', t.toUpperCase(), '-'.repeat(Math.min(40, t.length))); };
  out.push(b.name ?? '');
  if (b.label) out.push(b.label);
  out.push([[b.location?.city, b.location?.countryCode].filter(Boolean).join(', '), b.email, b.phone, b.url].filter(Boolean).join(' | '));
  if (b.summary){ head(L.summary); out.push(b.summary); }
  const want = k => !sections || sections.includes(k);
  if ((body.work ?? []).length && want('work')){
    head(L.work);
    for (const w of body.work){
      out.push('', [w.position, w.name].filter(Boolean).join(', '));
      const when = [w.startDate, w.endDate ?? L.present].filter(Boolean).join(' – ');
      out.push([when, w.location].filter(Boolean).join(' | '));
      for (const h of w.highlights ?? []) out.push(`- ${h}`);
    }
  }
  if ((body.education ?? []).length && want('education')){
    head(L.education);
    for (const e of body.education) out.push([[e.studyType, e.area].filter(Boolean).join(' '), e.institution, e.endDate].filter(Boolean).join(', '));
  }
  if ((body.skills ?? []).length && want('skills')){ head(L.skills); for (const s of body.skills) out.push(`${s.name}: ${(s.keywords ?? []).join(', ')}`); }
  if ((body.publications ?? []).length && want('publications')){ head(L.publications); for (const p of body.publications) out.push([p.name, p.summary, p.releaseDate].filter(Boolean).join(', ')); }
  if ((body.certificates ?? []).length && want('certificates')){ head(L.certificates); for (const c of body.certificates) out.push([c.name, c.issuer].filter(Boolean).join(', ')); }
  if ((body.languages ?? []).length && want('languages')){ head(L.languages); out.push(body.languages.map(l => [l.language, l.fluency].filter(Boolean).join(' – ')).join('; ')); }
  if ((body.interests ?? []).length && want('interests')){ head(L.interests); out.push(body.interests.map(i => i.name).join(', ')); }
  if ((body.projects ?? []).length && want('projects')){ head(L.projects); for (const p of body.projects) out.push(`${p.name}${p.description ? `: ${p.description}` : ''}`); }
  if ((body.references ?? []).length && want('references')){ head(L.references); for (const r of body.references) out.push([r.name, r.reference].filter(Boolean).join(': ')); }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function preflight({ model, recipe, fills = [], missing = 0, newer = 0, vault = false }){
  const out = [];
  const add = (level, key, text) => out.push({ level, key, text });
  const over = fills.find(p => p.overflow > 0);
  const last = fills.at(-1);
  const pct = last ? 100 * last.used / last.usable : 0;
  if (over) add('bad', 'overflow', t('preflight.overflow', { page: over.page }));
  else if (last && recipe.pageLimit !== 0 && pct > 96) add('warn', 'tight', t('preflight.tight', { pct: pct.toFixed(0) }));
  else add('ok', 'fits', t('preflight.fits', { n: fills.length || 1 }));
  const b = model.basics ?? {};
  const emptyContact = ['email', 'phone'].filter(k => !String(b[k] ?? '').trim());
  if (emptyContact.length) add('warn', 'contact', t(emptyContact.length === 2 ? 'preflight.noEmailPhone' : emptyContact[0] === 'email' ? 'preflight.noEmail' : 'preflight.noPhone'));
  if (missing) add('warn', 'language', t('preflight.language', { n: missing, lang: langName(recipe.lang ?? 'en') }));
  if (newer) add('warn', 'newer', t('preflight.newer', { n: newer }));
  if (recipe.photo?.show && !b.image && b.portrait?.state !== 'present') add('bad', 'photo-missing', t('preflight.photoMissing'));
  if (recipe.photo?.show && recipe.format === 'us-letter') add('warn', 'photo', t('preflight.photoLetter'));
  const { problems } = resolve(model, recipe);
  const placeholders = problems.filter(p => /⬜/.test(p));
  if (placeholders.length) add('bad', 'placeholder', t('preflight.placeholder', { n: placeholders.length }));
  if (vault){
    const drafts = problems.filter(p => /unreviewed draft/.test(p)).length;
    const nosrc = problems.filter(p => /no source/.test(p)).length;
    if (drafts) add('bad', 'draft', t('preflight.drafts', { n: drafts }));
    if (nosrc) add('warn', 'source', t('preflight.noSource', { n: nosrc }));
  }
  return out;
}

export function exportName(recipe, model, ext){
  const parts = [recipe.company, recipe.role, model.basics?.name].filter(Boolean);
  const base = (parts.length ? parts.join(' - ') : 'Resume').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${base}.${ext}`;
}
