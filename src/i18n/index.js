// The app's own words in ten languages. No DOM, so model modules and Node checks
// use it too (always English there). English is bundled; the rest load on demand.
// h() is t() for HTML: it keeps the catalogue's own markup and escapes every
// parameter. Use it for text inside markup and esc(t(…)) for attributes.

import en from './en.js';

export const UI_LANGS = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu'];
const CATS = { en };
let cur = 'en';

const fill = (s, params, escape) => String(s).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] !== undefined ? (escape ? escape(params[k]) : String(params[k])) : m));
const escHtml = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pick(cat, lang, key, params){
  let e = cat?.[key];
  if (e === undefined && cat !== en) e = en[key];
  if (e === undefined) return null;
  if (e && typeof e === 'object'){
    const n = Number(params?.n ?? 0);
    let k = 'other';
    try { k = new Intl.PluralRules(e === en[key] ? 'en' : lang).select(n); } catch { /* an unknown locale: other */ }
    e = e[k] ?? e.other;
  }
  return e;
}

export function t(key, params){
  const e = pick(CATS[cur], cur, key, params);
  return e == null ? key : fill(e, params);
}
export function h(key, params){
  const e = pick(CATS[cur], cur, key, params);
  return e == null ? escHtml(key) : fill(e, params, escHtml);
}
// The catalogue for `lang` must already be loaded.
export function tIn(lang, key, params){
  const e = pick(CATS[lang] ?? en, lang, key, params);
  return e == null ? key : fill(e, params);
}
export const has = (key, lang = cur) => (CATS[lang] ?? {})[key] !== undefined;

export async function loadCatalogue(lang){
  if (!UI_LANGS.includes(lang)) return null;
  if (!CATS[lang]){
    try { CATS[lang] = (await import(`./${lang}.js`)).default; }
    catch { return null; }
  }
  return CATS[lang];
}
export const catalogue = lang => CATS[lang] ?? null;

export async function setUiLang(lang){
  const c = await loadCatalogue(lang);
  cur = c ? lang : 'en';
  return cur;
}
export const uiLang = () => cur;
// Synchronous, so a toast right after a commit is already in the new language.
export function setUiLangNow(lang){ if (!CATS[lang]) return false; cur = lang; return true; }
// Catalogues no native speaker has read yet (review: 'machine' in each file).
export const MACHINE = new Set(['de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu']);
export function useCatalogue(lang, cat){ CATS[lang] = cat; cur = lang; }

// A thrown error carries a key when a person can see it.
export function errText(e){ return e?.key ? t(e.key, e.params) : e?.message ?? String(e); }
export function keyed(key, params, english){ return Object.assign(new Error(english ?? fill(en[key] ?? key, params)), { key, params }); }

// The resume's own static text in `lang`. English gets null: its headings come
// from the record.
export const DOC_SECTIONS = ['summary', 'experience', 'education', 'skills', 'languages', 'certified', 'certificates', 'patent', 'publication', 'publications', 'projects', 'interests', 'awards', 'volunteer', 'references'];
export const PLAIN_KEYS = ['summary', 'work', 'education', 'skills', 'publications', 'certificates', 'languages', 'interests', 'projects', 'volunteer', 'awards', 'references'];
export function docChrome(lang){
  const cat = CATS[lang];
  if (!cat || lang === 'en') return null;
  const get = k => (cat[k] !== undefined ? cat[k] : null);
  const sections = {};
  for (const id of DOC_SECTIONS){ const v = get(`doc.section.${id}`); if (v) sections[id] = v; }
  const plain = {};
  for (const k of PLAIN_KEYS){ const v = get(`doc.plain.${k}`); if (v) plain[k] = v; }
  return { lang, sections, continued: get('doc.continued'), present: get('doc.present'), plain };
}
