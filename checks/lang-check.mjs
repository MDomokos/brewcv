#!/usr/bin/env node
// node checks/lang-check.mjs
// Languages in Node: "same in every language", a missing text printing in English in the app (the CLI
// renderer still refuses it), the missing list, switching a resume's language. Fictional data only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import * as S from '../src/model/schema.js';
import * as L from '../src/model/lang.js';
import * as T from '../src/model/resume.js';
import * as R from '../src/model/record.js';
import { chosen } from '../src/fit.js';
import { validate } from './lib/validate.mjs';
import { createDocument } from '../scripts/lib/dom.mjs';
import { renderPages, RenderError } from '../src/render.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const clone = x => structuredClone(x);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);
// strip these to get languages with nothing written in them
const NEW8 = ['de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs'];
function stripLangs(m, langs = NEW8){
  const drop = new Set(m.variants.filter(v => langs.includes(v.lang)).map(v => v.id));
  m.variants = m.variants.filter(v => !drop.has(v.id));
  for (const f of m.facts){ f.variants = f.variants.filter(id => !drop.has(id)); for (const l of langs) if (f.default) delete f.default[l]; }
  for (const l of langs) if (m.i18n) delete m.i18n[l];
  delete m.langs;
  return m;
}
const html = (m, r, opts = {}) => renderPages(m, r, createDocument(), opts).pages.map(p => p.outerHTML).join('');

const model = S.load(read('data/example.json')).model;
const names = read('data/example-resumes/index.json');
const resumes = names.map(n => S.loadResume(read(`data/example-resumes/${n}`), model).recipe);
const hu = resumes.find(r => r.lang === 'hu');
const en = resumes.find(r => (r.lang ?? 'en') === 'en');

section('same in every language');
{
  ok('the example writes "same" texts once, in English', model.same.every(k => !L.hasVersionIn(model, k.slice(5), 'hu')));
  const out = html(model, hu);
  ok('the Hungarian resume renders, and prints them', out.includes('Dana Okonkwo') && out.includes('SolidWorks'));
  ok('the model reads them without a problem', !T.resolve(model, hu).problems.some(p => /prints in English/.test(p)));
  ok('the validator is clean', validate(S.save(model), hu).errors.length === 0, validate(S.save(model), hu).errors[0]);
  ok('Fit costs the English version', chosen(model, hu, 'name')?.lang === 'en');
}

section('a text with no version in the language');
{
  const r = clone(hu);
  T.setSectionOn(model, r, 'interests', true);
  const miss = L.missingList(model, r);
  ok('the missing list names the interests', miss.filter(m => m.kind === 'fact').some(m => /interest/.test(m.id)));
  ok('every item says where it is', miss.every(m => m.where));
  let threw = false;
  try { html(model, r); } catch (e){ threw = e instanceof RenderError && /no "hu" phrasing/.test(e.message); }
  ok('the CLI renderer still refuses it', threw);
  const out = html(model, r, { fallback: true });
  ok('the app renders it in English', out.includes(model.variants.find(v => v.id.startsWith('interest-sailing') && v.lang === 'en').text));
  const b = model.work.flatMap(w => w.highlights).find(h => !L.hasVersionIn(model, h, 'hu'));
  T.setBulletOn(model, r, b, true);
  ok(`a bullet with no Hungarian (${b}) prints in English, and the model says so`, T.resolve(model, r).problems.some(p => new RegExp(`${b}.*prints in English`).test(p))
     && T.resolve(model, r).body.work.some(w => w.highlights.includes(T.chooseVariant(model, b, r).v.text)));
  ok('the validator warns, not errors', validate(S.save(model), r).errors.length === 0 && validate(S.save(model), r).warnings.some(w => /prints in English/.test(w)));
  const m2 = clone(model);
  L.setSame(m2, L.sameKey('interest-sailing'), true);
  ok('marking it the same takes it off the list', !L.missingList(m2, r).some(m => m.id === 'interest-sailing'));
  ok('…and the renderer prints it without the fallback option', (() => { L.setSame(m2, L.sameKey('interest-bookbinding'), true); L.setSame(m2, L.sameKey('interest-watches'), true); L.setSame(m2, L.sameKey(b), true); try { html(m2, r); return true; } catch { return false; } })());
  const v = L.writeIn(m2, 'interest-sailing', 'hu', 'Vitorlázás');
  ok('writing it in place makes Hungarian v1', v.n === '1' && v.lang === 'hu' && L.hasVersionIn(m2, 'interest-sailing', 'hu'));
  ok('a heading with no translation is listed', (() => { const m3 = clone(model); delete m3.i18n.hu.sections.interests; return L.missingList(m3, r).some(m => m.kind === 'heading' && m.id === 'interests'); })());
  ok('an English resume has nothing missing', L.missingList(model, en).length === 0);
}

section('switching language');
{
  const r = clone(en);
  const picks = clone(r.picks);
  T.setOverride(model, r, Object.keys(picks)[0] ?? 'summary', 'Only here.');
  const ov = clone(r.overrides);
  L.switchLang(r, 'hu', model);
  ok('English → Hungarian: lang and the Hungarian A4', r.lang === 'hu' && (r.format === 'a4-hu' || r.format === 'us-letter'));
  ok('English picks and one-off texts are put aside', eq(r.byLang.en.picks, picks) && eq(r.byLang.en.overrides, ov) && eq(r.picks, {}) && eq(r.overrides, {}));
  ok('it validates and renders', validate(S.save(model), r).errors.length === 0 && !!html(model, r, { fallback: true }), validate(S.save(model), r).errors[0]);
  const huv = model.variants.find(v => v.lang === 'hu' && model.facts.find(f => f.id === 'summary').variants.includes(v.id));
  r.picks.summary = huv.id;
  L.switchLang(r, 'en', model);
  ok('Hungarian → English brings them back', eq(r.picks, picks) && eq(r.overrides, ov) && !('lang' in r));
  ok('and keeps the Hungarian ones aside', r.byLang.hu.picks.summary === huv.id);
  L.switchLang(r, 'hu', model);
  ok('so switching again restores the Hungarian pick', r.picks.summary === huv.id && !r.byLang?.hu);
  ok('switching to the language it is in does nothing', L.switchLang(r, 'hu', model) === false);
  const m2 = clone(model);
  R.deleteVersion(m2, huv.id, [r]);
  ok('deleting a version drops a pick of it put aside too', r.picks.summary === undefined);
}

section('ten languages');
{
  const model = stripLangs(clone(S.load(read('data/example.json')).model));
  ok('LANGS has the ten, English first', S.LANGS.length === 10 && S.LANGS[0] === 'en' && ['de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu'].every(l => S.LANGS.includes(l)));
  ok('each by its own name', S.LANGS.every(l => L.langName(l) !== l) && L.langName('de') === 'Deutsch' && L.langName('cs') === 'Čeština' && L.langName('hu') === 'Magyar');
  ok('one settings row per language: paper, A4 format, photo', S.LANGS.every(l => L.LANG_INFO[l] && ['us-letter', 'a4'].includes(L.LANG_INFO[l].paper) && typeof L.LANG_INFO[l].photo === 'boolean'));
  ok('Letter for English, A4 for the rest; the Hungarian A4 for Hungarian only', L.LANG_INFO.en.paper === 'us-letter' && S.LANGS.filter(l => l !== 'en').every(l => L.LANG_INFO[l].paper === 'a4')
    && S.LANGS.every(l => L.LANG_INFO[l].a4Format === (l === 'hu' ? 'a4-hu' : 'a4')));
  ok('a photo is usual in German, Polish, Czech and Hungarian', S.LANGS.filter(l => L.LANG_INFO[l].photo).sort().join() === 'cs,de,hu,pl');
  let good = true;
  for (const from of S.LANGS) for (const to of S.LANGS.filter(x => x !== from)){
    for (const fmt of ['a4', 'a4-hu', 'us-letter']){
      const r = clone(en); if (from !== 'en') r.lang = from; else delete r.lang; r.format = fmt;
      L.switchLang(r, to, model);
      const want = fmt === 'us-letter' ? 'us-letter' : L.LANG_INFO[to].a4Format;
      if ((r.lang ?? 'en') !== to || r.format !== want){ good = false; console.log(`      ${from}→${to} ${fmt}: ${r.lang} ${r.format}`); }
    }
  }
  ok('switching between any two of the ten: the A4 format follows the language, Letter stays', good);
  const de = clone(en); L.switchLang(de, 'de', model);
  ok('a German resume validates and renders (text in English, outlined)', validate(S.save(model), de).errors.length === 0 && !!html(model, de, { fallback: true }));
  const chrome = { lang: 'de', sections: { experience: 'Berufserfahrung', skills: 'Kenntnisse', education: 'Ausbildung', languages: 'Sprachen', interests: 'Interessen', summary: 'Profil', certified: 'Zertifikate', patent: 'Patent' }, continued: 'FORTSETZUNG', present: 'heute', plain: {} };
  const without = L.missingList(model, de, { chrome: null }).filter(x => x.kind === 'heading').length;
  const withApp = L.missingList(model, de, { chrome }).filter(x => x.kind === 'heading').length;
  ok('the app’s default headings count as present', without > 0 && withApp === 0, `${without} → ${withApp}`);
  ok('a heading only counts for its own language', L.missingList(model, { ...de, lang: 'fr' }, { chrome }).some(x => x.kind === 'heading'));
  const out = html(model, de, { fallback: true, chrome });
  ok('the renderer prints the app’s heading where the record has none', /Berufserfahrung/.test(out));
  ok('…and never for English (the 0.1.0 gate)', !/Berufserfahrung/.test(html(model, en, { chrome: { ...chrome, lang: 'en' } })) && html(model, en) === html(model, en, { chrome }));
  ok('the record’s own translation wins over the app’s', (() => { const m = clone(model); m.i18n.de = { sections: { experience: 'Werdegang' } }; const o = html(m, de, { fallback: true, chrome }); return /Werdegang/.test(o) && !/Berufserfahrung/.test(o); })());
  const m = clone(model);
  delete m.langs;
  ok('the languages you use, worked out when absent: those with a version, English always', eq(L.langsInUse(m), ['en', 'hu']));
  L.addLangInUse(m, 'de');
  ok('adding one keeps the order', eq(L.langsInUse(m), ['en', 'hu', 'de']));
  L.removeLangInUse(m, 'hu');
  ok('unticking one hides it and deletes nothing', eq(L.langsInUse(m), ['en', 'de']) && m.variants.some(v => v.lang === 'hu'));
  let threw = false; try { L.setLangsInUse(m, []); } catch { threw = true; }
  ok('at least one stays', threw && eq(L.langsInUse(m), ['en', 'de']));
  // removing a language (UX-6c-iv-b): refused while a resume, a sent copy or a version uses it, with the reason; allowed when nothing does
  const r = clone(model); r.langs = ['en', 'hu', 'de'];
  const state = { record: r, cur: { lang: 'en' }, openId: 'a', resumes: [{ id: 'a', lang: 'de' }, { id: 'b', lang: 'fr', snapshots: [{ recipe: { lang: 'de' } }] }] };
  const why = x => { try { L.removeLang(clone(state), x); return null; } catch (e) { return e.key ?? e.message; } };
  ok('removeLang refuses a language with a version, with the reason', why('hu') === 'ux6c.langStays' && L.langUse(state, 'hu') === 'ux6c.langUsedVersion');
  ok('…and one a sent copy is in (the open resume\u2019s saved copy is read through `cur`, so its old language does not hold)', L.langUse(state, 'de') === 'ux6c.langUsedResume' && L.langUse({ ...state, resumes: [{ id: 'a', lang: 'de' }] }, 'de') === null);
  ok('…and allows one nothing uses', (() => { const s2 = clone(state); s2.record.variants = s2.record.variants.filter(v => v.lang !== 'hu'); L.removeLang(s2, 'hu'); return eq(L.langsInUse(s2.record), ['en', 'de']); })());
  ok('removableLangs lists every language but English, each with what holds it', eq(L.removableLangs(state).map(x => [x.lang, x.why]), [['hu', 'ux6c.langUsedVersion'], ['de', 'ux6c.langUsedResume']]));
  ok('the list is saved in the record and validates', S.save(m).meta.resumeBuilder.langs.join() === 'en,de' && validate(S.save(m), en).errors.length === 0);
}

section('dates in the resume’s language');
{
  const B = await import('../src/model/build.js');
  ok('English months stay as they were', B.fmtMonth('2023-03') === 'Mar 2023' && B.fmtMonth('2023-03', 'en') === 'Mar 2023' && B.fmtMonth('2023') === '2023');
  ok('German', B.fmtMonth('2023-03', 'de') === 'März 2023', B.fmtMonth('2023-03', 'de'));
  ok('French', B.fmtMonth('2023-03', 'fr') === 'mars 2023', B.fmtMonth('2023-03', 'fr'));
  ok('Hungarian', B.fmtMonth('2023-03', 'hu') === '2023. márc.', B.fmtMonth('2023-03', 'hu'));
  ok('every one of the ten gives a month and the year', S.LANGS.every(l => /2023/.test(B.fmtMonth('2023-11', l)) && B.fmtMonth('2023-11', l).length > 5));
}

console.log(failed ? `\n${failed} language check(s) FAILED` : '\nall language checks passed');
process.exit(failed ? 1 : 0);
