// Resume languages. Pure: no DOM, no I/O. `recipe.lang` absent means English.
// A text with no version in the language prints in English unless `record.same` lists it.

import { addVersion, versionsIn, major, compareN, wordDiff, takenNumber } from './record.js';
import { t, docChrome, keyed } from '../i18n/index.js';
import { LANGS } from './schema.js';
import { entriesOf } from './entries.js';
import { localEntry, isLocal } from '../recipe.js';
import { isLocked } from './lock.js';
import { listedBullets, jobRefs, sectionList, chooseVariant, printedLabel, ownLabels, labelIn, isDraft, isArchive } from './resume.js';
import { staleI18n } from './labels.js';

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

// The version of `lang` that is older than `want` under the same major (HU v3 while the line prints v3.1), if any.
const behindOf = (model, factId, want, lang) => want && versionsIn(model, factId, lang).filter(x => major(x.n) === major(want.n) && compareN(x.n, want.n) < 0).at(-1);

// Texts and headings with no version in the resume's language. Empty in English.
// A section the app has a default heading for in `chrome` is not missing.
// `inGroup` (the resume is in a group of language copies, see groupOf in resumes.js): a text is missing when the language has no version at
// the number the line prints (`want`), and English is checked too. Behind (kind 'behind'): it has an older one under the same major (`have`).
// `others`: the other resumes of the group. Also listed in a group: a heading, a language's name or a skill group's name written against text that
// has changed since (kind 'heading-changed', `from` the language it changed in, `was` and `now` its words), and a line another resume edited as a
// one-off text that is not a version yet (kind 'edited-elsewhere', `from` its language).
export function missingList(model, recipe, { chrome = docChrome(recipe?.lang ?? DEFAULT_LANG), inGroup = false, others = [] } = {}){
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
  const printed = printedFactIds(model, recipe);
  for (const p of printed){
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
      const have = behindOf(model, p.fact, want, lang);
      out.push({ key: sameKey(p.fact), kind: have ? 'behind' : 'fact', id: p.fact, label, where: p, want: want?.n, ...(want ? { from: langOf(want) } : {}), ...(have ? { have: have.n } : {}) });
      continue;
    }
    if (hasVersionIn(model, p.fact, lang)) continue;
    out.push({ key: sameKey(p.fact), kind: 'fact', id: p.fact, label, where: p });
  }
  if (inGroup) out.push(...changedLabels(model, recipe, others, printed), ...editedElsewhere(model, recipe, others, printed, new Set(out.map(m => m.id))));
  return out;
}

// Labels written against another language's words that have changed since. A resume's own `labelFrom` is checked against that language's resume
// in the group; a label it takes from the record is checked against `i18n.<lang>.from` (the English it was written against).
function changedLabels(model, recipe, others, printed){
  const lang = recipe.lang ?? DEFAULT_LANG, out = [], own = ownLabels(recipe);
  const heads = new Set(sectionList(model, recipe).filter(s => s.on && !s.fixed).map(s => s.id));
  const facts = new Set(printed.map(p => p.fact)), owners = new Set(printed.map(p => p.owner).filter(Boolean));
  const groups = new Set((recipe.skillArrangement?.groups ?? []).map(g => g.id));
  const whereOf = key => {
    const id = key.slice(3);
    if (key.startsWith('~h:')) return heads.has(id) ? { kind: 'section', id } : null;
    if (key.startsWith('~g:')) return groups.has(id) || facts.has(id) ? { fact: id, kind: 'item', section: 'skills' } : null;
    if (key.startsWith('~t:')) return printed.find(p => p.fact === id) ?? null;
    const [k, eid] = id.split('/');      // a field of an entry: the job it is printed in, or the section of that kind
    return owners.has(eid) ? { kind: 'job', id: eid } : heads.has(k) ? { kind: 'section', id: k } : null;
  };
  const add = (key, from, was, now) => {
    const where = whereOf(key);
    if (!where) return;
    out.push({ key: `changed:${key}`, kind: 'heading-changed', id: key.slice(3), labelKey: key, label: key.startsWith('~f:') ? model.i18n?.[lang]?.fields?.[key.slice(3)] ?? now : printedLabel(model, recipe, key), where, from, was, now });
  };
  for (const [key, byLang] of Object.entries(recipe.labelFrom ?? {})) for (const [from, was] of Object.entries(byLang)){
    const now = from === lang ? undefined : labelIn(model, others, key, from);
    if (typeof now === 'string' && now !== was){ add(key, from, was, now); break; }
  }
  for (const x of staleI18n(model, lang)){
    const key = `~${{ sections: 'h', labels: 'g', terms: 't', fields: 'f' }[x.kind]}:${x.id}`;
    if (!recipe.labelFrom?.[key] && !own[key]) add(key, DEFAULT_LANG, x.was, x.now);
  }
  return out;
}

// A line another resume of the group has a one-off text for, while this one has none: the text is not a version, so the number rule does not reach it.
function editedElsewhere(model, recipe, others, printed, skip){
  const out = [], facts = new Map((model.facts ?? []).map(f => [f.id, f]));
  const prints = new Map(others.map(o => [o, new Set(printedFactIds(model, o).map(p => p.fact))]));
  for (const p of printed){
    if (skip.has(p.fact) || recipe.overrides?.[p.fact] !== undefined) continue;
    const o = others.find(r => r.overrides?.[p.fact] !== undefined && !isLocal(r, p.fact) && !(r.held ?? []).includes(p.fact) && prints.get(r).has(p.fact));
    if (!o) continue;
    const f = facts.get(p.fact);
    out.push({ key: `edited:${p.fact}`, kind: 'edited-elsewhere', id: p.fact, label: f?.summary ?? f?.label ?? p.fact, where: p, from: langOf(o), text: String(o.overrides[p.fact]) });
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

// Carries the tags of the version it translates. `n`: the number to save it at (a group's line prints one number in every language).
export function writeIn(model, factId, lang, text, from = null, n = null){
  return addVersion(model, factId, { text, lang, from: null, as: 'major', tagsFrom: from, n });
}

// What the write-in box shows for a line that prints another language's version in a group: that version (`ref`) and its number, what changed
// in it since this language's older one (`diff`, a line that is behind) and the text the box starts with (`seed`: that older one with the
// numbers of the new one carried in). Null when the line prints this language's own version.
export function writeInPlan(model, recipe, factId){
  const lang = recipe?.lang ?? DEFAULT_LANG, want = chooseVariant(model, factId, recipe).v;
  if (!want || langOf(want) === lang) return null;
  const have = behindOf(model, factId, want, lang);
  const old = have && versionsIn(model, factId, langOf(want)).find(x => String(x.n) === String(have.n));
  return { ref: want, n: want.n, from: langOf(want), have: have ?? null, diff: old ? wordDiff(old.text, want.text) : null, seed: have ? carryNumbers(old?.text ?? '', want.text, have.text, lang) : '' };
}

// Which version of the resume's language translates what the line prints in another language? The clues, best first:
//  1. the copy's memory: `duplicate` left the original's picks in byLang.<its language>, and setInStep the copy's own in byLang.<the copy's>; the two picks
//     of one claim are a pair (sure)
//  2. the tags: writeIn gives a translation the tags of the text it translates
//  3. the same numbers in the text
// Versions carry no dates, so none is used. { vid, n, why: 'pick' | 'tags' | 'numbers', sure } or null. `n` is the number the version would get.
const tagKey = v => [...new Set((v?.tags ?? []).filter(x => x !== 'needs-review'))].sort().join('\n');
const numKey = text => (String(text ?? '').match(NUM) ?? []).map(x => readNumber(x).value).sort((a, b) => a - b).join(' ');
export function guessMatch(state, resume, factId){
  const model = state.record, lang = resume?.lang ?? DEFAULT_LANG, by = new Map((model.variants ?? []).map(v => [v.id, v]));
  const mine = versionsIn(model, factId, lang).filter(v => !isDraft(v) && !isArchive(v));
  const own = by.get(resume?.byLang?.[lang]?.picks?.[factId]);
  for (const [other, kept] of Object.entries(resume?.byLang ?? {})){
    const o = other === lang ? null : by.get(kept?.picks?.[factId]);
    if (o && own && langOf(o) === other && mine.includes(own) && String(o.n) !== String(own.n)) return { vid: own.id, n: String(o.n), why: 'pick', sure: true };
  }
  const want = chooseVariant(model, factId, resume).v;
  if (!want || langOf(want) === lang) return null;
  for (const [why, key] of [['tags', tagKey], ['numbers', v => numKey(v.text)]]){
    const k = key(want), hits = k ? mine.filter(v => key(v) === k) : [];
    if (hits.length === 1) return { vid: hits[0].id, n: String(want.n), why, sure: false };
  }
  return null;
}

// What the write-in box offers for "This language already has it" on a line that is missing at the other language's v{n}: the versions of this
// language (not drafts or archives) that could be it, each with the number it would get (`n`), whether that number is free (`free`), and whether
// the other language has a version at the version's own number now (`twin`). The guess first (`probably`). Null when nothing needs matching:
// no version of this language, or every one already matches the other language's and no clue says otherwise.
export function matchPlan(state, resume, factId){
  const model = state.record, lang = resume?.lang ?? DEFAULT_LANG, want = chooseVariant(model, factId, resume).v;
  if (!want || langOf(want) === lang) return null;
  const guess = guessMatch(state, resume, factId), from = langOf(want), theirs = new Set(versionsIn(model, factId, from).map(v => String(v.n)));
  const rows = versionsIn(model, factId, lang).filter(v => !isDraft(v) && !isArchive(v)).map(v => {
    const probably = guess?.vid === v.id, n = probably ? guess.n : String(want.n);
    return { v, n, probably, twin: theirs.has(String(v.n)), free: !takenNumber(model, factId, lang, n) };
  }).filter(r => String(r.v.n) !== r.n).sort((a, b) => b.probably - a.probably || a.twin - b.twin || compareN(a.v.n, b.v.n));
  return rows.length && (guess || rows.some(r => !r.twin)) ? { rows, n: String(want.n), from } : null;
}

// Numbers in a text: 1,200  1 200  12.5  1.2  30  (the % and the currency stay outside, as written)
const NUM = /\d{1,3}(?:[,. \u00a0\u202f]\d{3})+(?!\d)(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;
function readNumber(tok){
  const spaced = /[\u00a0\u202f ]/.test(tok), s = tok.replace(/[\u00a0\u202f ]/g, ''), seps = s.match(/[.,]/g) ?? [];
  let at = -1;       // where the decimals start
  if (seps.length){
    const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(',')), mixed = s.includes('.') && s.includes(',');
    // one separator with three digits after it is a thousands mark (1,200) unless it follows 0 or four digits (0,125; 1234,567)
    const lone = seps.length === 1 && !spaced && s.length - last - 1 === 3 && last <= 3 && s[0] !== '0';
    if (mixed || (seps.length === 1 && !lone)) at = last;
  }
  const dec = at < 0 ? 0 : s.length - at - 1, whole = (at < 0 ? s : s.slice(0, at)).replace(/[.,]/g, '');
  return { value: Number(at < 0 ? whole : `${whole}.${s.slice(at + 1)}`), dec, group: spaced || (at < 0 ? seps.length > 0 : /[.,]/.test(s.slice(0, at))) };
}
// `mine` is `oldOther` translated. `newOther` is `oldOther` after a change. When the two others and `mine` have the same count of numbers,
// the numbers that changed are replaced in `mine` by position, written the way `lang` writes them (1.4 → 1,4; 1,200 → 1 200). Currency
// signs and units stay where `mine` has them and nothing is converted. Otherwise `mine` is returned as it is.
export function carryNumbers(oldOther, newOther, mine, lang){
  const a = String(oldOther ?? '').match(NUM) ?? [], b = String(newOther ?? '').match(NUM) ?? [], m = [...String(mine ?? '').matchAll(NUM)];
  if (!a.length || a.length !== b.length || a.length !== m.length) return mine;
  try {
    let i = 0;
    return String(mine).replace(NUM, tok => {
      const at = i++;
      if (a[at] === b[at]) return tok;
      const n = readNumber(b[at]);
      return new Intl.NumberFormat(lang, { minimumFractionDigits: n.dec, maximumFractionDigits: n.dec, useGrouping: n.group }).format(n.value);
    });
  } catch { return mine; }
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
