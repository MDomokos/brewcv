// Resume languages. Pure: no DOM, no I/O. `recipe.lang` absent means English.
// A text with no version in the language prints in English unless `record.same` lists it.

import { addVersion, versionsIn, major, compareN } from './record.js';
import { t, docChrome, keyed } from '../i18n/index.js';
import { LANGS } from './schema.js';
import { entriesOf } from './entries.js';
import { localEntry, isLocal } from '../recipe.js';
import { isLocked } from './lock.js';
import { listedBullets, jobRefs, sectionList, chooseVariant } from './resume.js';

export const DEFAULT_LANG = 'en';
export const LANG_NAMES = { en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano', pt: 'Português', nl: 'Nederlands', pl: 'Polski', cs: 'Čeština', hu: 'Magyar' };
// photo: whether a photo is usual on a resume there. Hungarian A4 has a wider gutter.
export const LANG_INFO = {
  en: { paper: 'us-letter', a4Format: 'a4', photo: false },
  de: { paper: 'a4', a4Format: 'a4', photo: true },
  fr: { paper: 'a4', a4Format: 'a4', photo: false },
  es: { paper: 'a4', a4Format: 'a4', photo: false },
  it: { paper: 'a4', a4Format: 'a4', photo: false },
  pt: { paper: 'a4', a4Format: 'a4', photo: false },
  nl: { paper: 'a4', a4Format: 'a4', photo: false },
  pl: { paper: 'a4', a4Format: 'a4', photo: true },
  cs: { paper: 'a4', a4Format: 'a4', photo: true },
  hu: { paper: 'a4', a4Format: 'a4-hu', photo: true },
};
export const a4FormatOf = lang => LANG_INFO[lang]?.a4Format ?? 'a4';
export const isA4 = format => format === 'a4' || format === 'a4-hu';
export const langName = l => LANG_NAMES[l] ?? l;
const langOf = v => v?.lang ?? DEFAULT_LANG;
const refId = r => (typeof r === 'string' ? r : r?.id);

export const sameKey = factId => `fact:${factId}`;
export const isSame = (model, key) => (model.same ?? []).includes(key);
export function setSame(model, key, on){
  const s = new Set(model.same ?? []);
  if (on) s.add(key); else s.delete(key);
  model.same = [...s];
}

export function hasVersionIn(model, factId, lang){
  const f = (model.facts ?? []).find(x => x.id === factId);
  if (!f) return false;
  const vs = new Map((model.variants ?? []).map(v => [v.id, v]));
  return f.variants.some(id => langOf(vs.get(id)) === lang);
}

// kind 'title' covers a job's title and its meta line.
export function printedFactIds(model, recipe){
  const out = [];
  const sec = new Map((model.sections ?? []).map(s => [s.id, s]));
  const b = model.basics ?? {};
  for (const k of ['name', 'label', 'contact']) if (b.display?.[k]) out.push({ fact: b.display[k], kind: 'header', section: 'header' });
  const covered = new Set();
  for (const s of sectionList(model, recipe).filter(x => x.on)){
    const S = sec.get(s.id);
    if (!S) continue;
    const c = S.content ?? {};
    if (S.kind === 'header') continue;
    if (S.kind === 'prose'){ out.push({ fact: (s.id === 'summary' && recipe.summary) || c.fact, kind: 'summary', section: s.id }); continue; }
    if (S.kind === 'entries'){
      for (const ref of jobRefs(model, recipe, s.id)){
        const w = entriesOf(model).find(x => x.id === refId(ref));
        if (!w) continue;
        for (const k of ['position', 'meta']) if (w.display?.[k]) out.push({ fact: w.display[k], kind: 'title', owner: w.id, section: s.id });
        const listed = listedBullets(model, recipe, w.id);
        for (const id of listed) for (const cv of chooseVariant(model, id, recipe).v?.covers ?? []) covered.add(cv);
        for (const id of listed) if (!covered.has(id)) out.push({ fact: id, kind: 'bullet', owner: w.id, section: s.id });
      }
      continue;
    }
    for (const v of Object.values(c).flat()) if (typeof v === 'string' && (model.facts ?? []).some(f => f.id === v)) out.push({ fact: v, kind: 'item', section: s.id });
  }
  return out;
}

// Texts and headings with no version in the resume's language. Empty in English.
// A section the app has a default heading for in `chrome` is not missing.
// `inGroup` (the resume is in a group of language copies, see groupOf in resumes.js): a text is missing when the language has no version at
// the number the line prints (`want`), and English is checked too. Behind (kind 'behind'): it has an older one under the same major (`have`).
export function missingList(model, recipe, { chrome = docChrome(recipe?.lang ?? DEFAULT_LANG), inGroup = false } = {}){
  const lang = recipe?.lang ?? DEFAULT_LANG;
  if (lang === DEFAULT_LANG && !inGroup) return [];
  const out = [];
  const facts = new Map((model.facts ?? []).map(f => [f.id, f]));
  const seen = new Set();
  const app = chrome?.lang === lang ? { ...(chrome.sections ?? {}), ...(chrome.kinds ?? {}) } : {};
  for (const s of lang === DEFAULT_LANG ? [] : sectionList(model, recipe).filter(x => x.on && !x.fixed)){      // the record's section titles are English
    const own = (recipe.sections ?? []).find(x => x?.id === s.id)?.label;
    const has = (typeof own === 'string') || own?.[lang] || model.i18n?.[lang]?.sections?.[s.id] || app[s.id];
    if (!has && !isSame(model, `section:${s.id}`)){
      const title = (model.sections ?? []).find(x => x.id === s.id)?.title ?? s.id;
      out.push({ key: `section:${s.id}`, kind: 'heading', id: s.id, label: t('lang.heading', { title }), where: { kind: 'section', id: s.id } });
    }
  }
  // a skill arrangement replaces the groups' texts: its groups are untranslated only when they came from another language's set
  const arr = recipe.skillArrangement, arranged = new Set((arr?.groups ?? []).map(g => g.id));
  for (const g of arr?.groups ?? []) if ((g.lang ?? arr.lang) && (g.lang ?? arr.lang) !== lang && facts.has(g.id) && !isSame(model, sameKey(g.id))){ seen.add(g.id); out.push({ key: sameKey(g.id), kind: 'fact', id: g.id, label: g.label ?? facts.get(g.id).label ?? g.id, where: { fact: g.id, kind: 'item', section: 'skills' } }); }
  for (const p of printedFactIds(model, recipe)){
    if (seen.has(p.fact) || (arranged.has(p.fact) && p.kind === 'item')) continue;
    seen.add(p.fact);
    // a line only on this resume has one language, the one it was typed in: in another it stays as typed and is listed
    const own = localEntry(recipe, p.fact), text = String(recipe.overrides?.[p.fact] ?? '').trim();
    if (own){ if ((own.lang ?? DEFAULT_LANG) !== lang && text) out.push({ key: `local:${p.fact}`, kind: 'fact', id: p.fact, label: text.slice(0, 80), where: p }); continue; }
    if (recipe.overrides?.[p.fact] !== undefined) continue;
    if (isSame(model, sameKey(p.fact))) continue;
    const f = facts.get(p.fact), label = f?.summary ?? f?.label ?? p.fact;
    if (inGroup){
      const want = chooseVariant(model, p.fact, recipe).v;
      if (want && langOf(want) === lang) continue;
      const have = want && versionsIn(model, p.fact, lang).filter(x => major(x.n) === major(want.n) && compareN(x.n, want.n) < 0).at(-1);
      out.push({ key: sameKey(p.fact), kind: have ? 'behind' : 'fact', id: p.fact, label, where: p, want: want?.n, ...(have ? { have: have.n } : {}) });
      continue;
    }
    if (hasVersionIn(model, p.fact, lang)) continue;
    out.push({ key: sameKey(p.fact), kind: 'fact', id: p.fact, label, where: p });
  }
  return out;
}

// What a resume keeps for its language while it shows another: picks, one-off texts and holds. `own` is the part that stays in every language.
function keepOf(recipe, model){
  const keep = {};
  for (const k of ['picks', 'overrides', 'held']) if (recipe[k] !== undefined && (Array.isArray(recipe[k]) ? recipe[k].length : Object.keys(recipe[k]).length)) keep[k] = recipe[k];
  // the lines only on this resume have no other language: their text stays where it is
  // …and so is a locked line's: it stays as typed
  const own = Object.fromEntries(Object.entries(recipe.overrides ?? {}).filter(([k]) => isLocal(recipe, k) || isLocked(model, recipe, k)));
  if (keep.overrides) keep.overrides = Object.fromEntries(Object.entries(keep.overrides).filter(([k]) => !(k in own)));
  if (keep.overrides && !Object.keys(keep.overrides).length) delete keep.overrides;
  const metaOf = (o, f) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => f(k)));
  const ownMeta = metaOf(recipe.overrideMeta, k => k in own);
  if (keep.overrides) keep.overrideMeta = metaOf(recipe.overrideMeta, k => k in keep.overrides);
  if (keep.overrideMeta && !Object.keys(keep.overrideMeta).length) delete keep.overrideMeta;
  return { keep, own, ownMeta };
}

// The copy's own picks, texts and holds go into `byLang` under its language, as switching away would, before it takes the group's.
export function stashOwn(recipe, model = null){
  const { keep } = keepOf(recipe, model);
  if (!Object.keys(keep).length) return;
  recipe.byLang = { ...(recipe.byLang ?? {}), [recipe.lang ?? DEFAULT_LANG]: structuredClone(keep) };
}

// In place. Picks, one-off texts and holds are kept per language in `byLang`.
export function switchLang(recipe, to, model = null){
  const from = recipe.lang ?? DEFAULT_LANG;
  if (from === to) return false;
  recipe.byLang = { ...(recipe.byLang ?? {}) };
  const { keep, own, ownMeta } = keepOf(recipe, model);
  if (Object.keys(keep).length) recipe.byLang[from] = keep; else delete recipe.byLang[from];
  const back = recipe.byLang[to] ?? {};
  recipe.picks = back.picks ?? {};
  recipe.overrides = { ...(back.overrides ?? {}), ...own };
  const meta = { ...back.overrideMeta, ...ownMeta };
  if (Object.keys(meta).length) recipe.overrideMeta = meta; else delete recipe.overrideMeta;
  if (back.held) recipe.held = back.held; else delete recipe.held;
  delete recipe.byLang[to];
  if (!Object.keys(recipe.byLang).length) delete recipe.byLang;
  if (to === DEFAULT_LANG) delete recipe.lang; else recipe.lang = to;
  if (isA4(recipe.format)) recipe.format = a4FormatOf(to);
  return true;
}

// Carries the tags of the version it translates.
export function writeIn(model, factId, lang, text, from = null){
  return addVersion(model, factId, { text, lang, from: null, as: 'major', tagsFrom: from });
}

// Languages the menus show. Stored in the record so it travels with backups and is undoable.
// Without a stored list: English plus every language that has a version.
export function langsInUse(model){
  const own = Array.isArray(model?.langs) ? [...new Set(model.langs.filter(l => LANGS.includes(l)))] : [];
  if (own.length) return own;
  const has = new Set((model?.variants ?? []).map(v => v.lang ?? DEFAULT_LANG));
  return LANGS.filter(l => l === DEFAULT_LANG || has.has(l));
}
// Unticking a language hides it; nothing in it is deleted.
export function setLangsInUse(model, langs){
  const list = [...new Set((langs ?? []).filter(l => LANGS.includes(l)))];
  if (!list.length) throw keyed('error.oneLang');
  model.langs = list;
  return list;
}
export function addLangInUse(model, lang){
  const now = langsInUse(model);
  if (!LANGS.includes(lang) || now.includes(lang)) return now;
  return setLangsInUse(model, [...now, lang]);
}
export function removeLangInUse(model, lang){
  return setLangsInUse(model, langsInUse(model).filter(l => l !== lang));
}
// What keeps a language in the record: a resume (or a sent copy of one) that prints in it, or a version written in it. The key of the
// reason, or null when nothing does.
export function langUse(state, lang){
  // the open resume is `cur` (its saved copy may still be in the language it was before the last change)
  const rs = [state.cur, ...(state.resumes ?? []).filter(r => r.id !== state.openId), ...(state.resumes ?? []).flatMap(r => (r.snapshots ?? []).map(x => x.recipe))];
  if (rs.some(r => r && ((r.lang ?? DEFAULT_LANG) === lang || r.byLang?.[lang]))) return 'ux6c.langUsedResume';
  return (state.record?.variants ?? []).some(v => (v.lang ?? DEFAULT_LANG) === lang) ? 'ux6c.langUsedVersion' : null;
}
// The inverse of adding a language: refused, with the reason, while a resume or a version uses it (`state`: record, cur, resumes)
export function removeLang(state, lang){
  const why = langUse(state, lang);
  if (why) throw keyed('ux6c.langStays', { lang: langName(lang), why: t(why) });
  return removeLangInUse(state.record, lang);
}
// the languages of the list besides English, each with what keeps it ([{ lang, why }]; why null: it can go)
export const removableLangs = state => langsInUse(state.record).filter(l => l !== DEFAULT_LANG).map(lang => ({ lang, why: langUse(state, lang) }));
