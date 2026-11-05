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

section('switching language: one resume, the same lines in every language');
{
  const r = clone(en);
  T.pickVersion(model, r, 'summary', 'summary-v2');
  const other = Object.keys(r.picks).find(f => f !== 'summary') ?? 'tagline';
  T.setOverride(model, r, other, 'Only here.');
  const ov = clone(r.overrides), lines = L.printedFactIds(model, r).map(p => p.fact);
  L.switchLang(r, 'hu', model);
  ok('English → Hungarian: lang and the Hungarian A4', r.lang === 'hu' && (r.format === 'a4-hu' || r.format === 'us-letter'));
  ok('the same lines, in the same order', eq(L.printedFactIds(model, r).map(p => p.fact), lines));
  ok('a line prints the version with the same number', r.picks.summary === 'summary-v2-hu' && !r.inLine?.summary);
  ok('one-off texts are put aside, picks are not', eq(r.byLang.en.overrides, ov) && !r.byLang.en.picks && eq(r.overrides, {}));
  ok('it validates and renders', validate(S.save(model), r).errors.length === 0 && !!html(model, r, { fallback: true }), validate(S.save(model), r).errors[0]);
  T.pickVersion(model, r, 'summary', 'summary-v1-hu');
  L.switchLang(r, 'en', model);
  ok('an in-line pick follows a number change', r.picks.summary === 'summary-v1' && eq(r.overrides, ov) && !('lang' in r));
  const gap = L.langDiffs(model, r).hu, plus = x => [...new Set(['summary', ...gap, ...x])].sort(), sorted = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v].sort()]));      // gap: lines Hungarian has no version at that number for
  L.pickOnly(model, r, 'summary', 'summary-v3');
  ok('a version for English only keeps the number the others print', r.picks.summary === 'summary-v3' && r.inLine?.summary === '1');
  ok('langDiffs names the line for Hungarian', eq(sorted(L.langDiffs(model, r)), { hu: plus([]) }), JSON.stringify(L.langDiffs(model, r)));
  L.switchLang(r, 'hu', model);
  ok('Hungarian prints the in-line number; English keeps its own choice aside', r.picks.summary === 'summary-v1-hu' && r.byLang.en.picks.summary === 'summary-v3' && !r.inLine?.summary);
  ok('…and the line says which number English uses', eq(L.lineState(model, r, 'summary').others, [{ lang: 'en', n: '3' }]) && eq(sorted(L.langDiffs(model, r)), { en: plus([]) }));
  L.switchLang(r, 'en', model);
  ok('the divergence survives switching away and back', r.picks.summary === 'summary-v3' && r.inLine?.summary === '1' && L.lineState(model, r, 'summary').own);
  L.backInLine(model, r, 'summary');
  ok('back in line clears it', r.picks.summary === 'summary-v1' && !r.inLine?.summary && eq(sorted(L.langDiffs(model, r)), { hu: [...gap].sort() }) && !gap.includes('summary'));
  L.switchLang(r, 'hu', model);
  L.pickOnly(model, r, 'summary', 'summary-v2-hu');
  L.switchLang(r, 'en', model);
  T.pickVersion(model, r, 'summary', 'summary-v4');
  ok('a pick changes the line for every in-line language, not for one with its own', L.versionIn(model, r, 'summary', 'hu')?.id === 'summary-v2-hu' && L.versionIn(model, r, 'tagline', 'hu')?.id === 'tagline-v1-hu');
  ok('switching to the language it is in does nothing', L.switchLang(r, 'en', model) === false);
  ok('the old way (a copy in another language) puts the whole pick set aside', (() => { const c = clone(en), p = clone(c.picks ?? {}); L.switchLang(c, 'hu', model, { whole: true }); return eq(c.byLang?.en?.picks ?? {}, p) && eq(c.picks, {}); })());
  const m2 = clone(model);
  L.switchLang(r, 'hu', model);
  R.deleteVersion(m2, 'summary-v2-hu', [r]);
  ok('deleting a version drops a pick of it', r.picks.summary === undefined);
}

section('an older file: whole pick sets in byLang');
{
  const r = clone(en);
  T.pickVersion(model, r, 'summary', 'summary-v1');
  const unprinted = model.facts.find(f => !L.printedFactIds(model, r).some(p => p.fact === f.id) && L.hasVersionIn(model, f.id, 'hu'))?.id;
  const huOf = f => model.variants.find(v => v.lang === 'hu' && model.facts.find(x => x.id === f).variants.includes(v.id))?.id;
  const gap = (() => { const x = clone(r); x.byLang = { hu: {} }; return L.langDiffs(model, x).hu; })();
  r.byLang = { hu: { picks: { summary: 'summary-v2-hu', tagline: 'tagline-v1-hu', ...(unprinted ? { [unprinted]: huOf(unprinted) } : {}) } } };
  const back = S.loadResume(S.saveResume(model, r).file, model);
  ok('it loads with no warning, its picks kept as they are', back.warnings.length === 0 && eq(back.recipe.byLang, r.byLang), back.warnings[0]);
  ok('it validates', validate(S.save(model), back.recipe).errors.length === 0, validate(S.save(model), back.recipe).errors[0]);
  ok('a stored pick at another number is that language\'s own choice', eq([...L.langDiffs(model, back.recipe).hu].sort(), [...new Set(['summary', ...gap])].sort()), JSON.stringify(L.langDiffs(model, back.recipe)));
  L.switchLang(back.recipe, 'hu', model);
  ok('switching: the divergence prints; the in-line pick and the line not printed are ignored', back.recipe.picks.summary === 'summary-v2-hu' && back.recipe.inLine?.summary === '1'
    && back.recipe.picks.tagline === undefined && (!unprinted || back.recipe.picks[unprinted] === undefined), `${unprinted} ${JSON.stringify(back.recipe.picks)}`);
  ok('a malformed inLine is dropped on load', (() => { const x = clone(en); x.inLine = { summary: 3, tagline: '1' }; const g = S.loadResume(S.saveResume(model, x).file, model); return eq(g.recipe.inLine, { tagline: '1' }) && g.warnings.some(w => /inLine/.test(w)); })());
}

section('the languages of one resume: added, taken off, a paper each');
{
  const r = clone(en); r.format = 'a4';
  ok('a resume starts in its own language only', eq(L.resumeLangs(r), ['en']));
  ok('adding a language is an empty entry; adding it again does nothing', L.addResumeLang(r, 'de') && eq(r.byLang.de, {}) && !L.addResumeLang(r, 'de') && !L.addResumeLang(r, 'en') && eq(L.resumeLangs(r), ['en', 'de']));
  ok('…and it stays in the career while the resume has it', L.langUse({ record: model, cur: r, resumes: [] }, 'de') === 'ux6c.langUsedResume');
  L.setLangPaper(r, 'de', true);
  ok('a paper for another language is kept with it; the current one\'s is the format', r.byLang.de.format === 'us-letter' && r.format === 'a4' && L.langPaper(r, 'de') === 'us-letter' && L.langPaper(r, 'en') === 'a4');
  ok('Hungarian with no paper of its own takes the Hungarian A4', L.langPaper(r, 'hu') === 'a4-hu');
  L.switchLang(r, 'de', model);
  ok('switching restores the language\'s paper and keeps the one it left', r.format === 'us-letter' && r.byLang.en.format === 'a4');
  L.switchLang(r, 'en', model);
  ok('…and back', r.format === 'a4' && r.byLang.de.format === 'us-letter');
  ok('the current language cannot be taken off', !L.dropResumeLang(r, 'en') && eq(L.resumeLangs(r), ['en', 'de']));
  ok('taking a language off drops its entry: its choices, texts, holds and paper', L.dropResumeLang(r, 'de') && !r.byLang && eq(L.resumeLangs(r), ['en']));
  ok('it saves and loads with no warning', (() => { const x = clone(en); L.addResumeLang(x, 'fr'); L.setLangPaper(x, 'fr', true); const g = S.loadResume(S.saveResume(model, x).file, model); return g.warnings.length === 0 && eq(g.recipe.byLang, { fr: { format: 'us-letter' } }) && validate(S.save(model), g.recipe).errors.length === 0; })());
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
  // removing a language: refused while a resume, a sent copy or a version uses it, with the reason; allowed when nothing does
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

section('the version menu says which version each language prints');
{
  const { topHtml } = await import('../src/ui/parts.js');
  const r = clone(en);
  T.pickVersion(model, r, 'summary', 'summary-v1');
  L.switchLang(r, 'hu', model); L.switchLang(r, 'en', model);
  L.pickOnly(model, r, 'summary', 'summary-v3');
  const menu = rr => topHtml({ vers: { fact: 'summary', n: '3', lang: rr.lang ?? 'en', line: L.lineState(model, rr, 'summary'), items: R.versionsIn(model, 'summary', rr.lang ?? 'en').map(v => ({ id: v.id, n: v.n, cur: v.id === rr.picks.summary, gist: '' })) } });
  const out = menu(r), row = id => out.split('class="cvrow"').find(x => x.includes(`data-v="${id}"`)) ?? out.split('<button').find(x => x.includes(`data-v="${id}"`)) ?? '';
  ok('the version Hungarian prints carries HU', /data-v="summary-v1"[^]*?class="cvlt"[^>]*>HU</.test(row('summary-v1')) && !/cvlt/.test(row('summary-v4')));
  ok('"Only in EN" beside a version the others do not print, none beside theirs', /data-act="use-only" data-v="summary-v4"/.test(out) && !/data-act="use-only" data-v="summary-v1"/.test(out));
  ok('"Back in line" beside the one in use, this language\'s own', /data-act="back-in-line"/.test(out));
  ok('a resume in one language shows none of it', !/cvlt|use-only|back-in-line/.test(menu(clone(en))));
}

console.log(failed ? `\n${failed} language check(s) FAILED` : '\nall language checks passed');
process.exit(failed ? 1 : 0);
