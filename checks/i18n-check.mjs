#!/usr/bin/env node
// node checks/i18n-check.mjs
// The app's own words: every catalogue against en.js, and every t('…') / h('…') key used in src/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };

const I = await import(pathToFileURL(path.join(ROOT, 'src/i18n/index.js')));
const en = (await import(pathToFileURL(path.join(ROOT, 'src/i18n/en.js')))).default;
const keys = Object.keys(en);
// shortcut: removed in UX-6f, which translates them (the keys of UX-6b to UX-6e may be missing from the nine other catalogues until then)
const LATER = k => /^ux6[b-e]\./.test(k);
const holes = v => [...new Set((typeof v === 'string' ? [v] : Object.values(v)).flatMap(s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1])))].sort().join(',');

ok('only the keys of UX-6b to UX-6e may be missing from the other catalogues', LATER('ux6b.rail') && LATER('ux6e.x') && !LATER('ux6a.x') && !LATER('ux6f.x') && !LATER('ux5c.line') && !LATER('head.save'));
for (const lang of I.UI_LANGS){
  const file = path.join(ROOT, `src/i18n/${lang}.js`);
  if (!fs.existsSync(file)){ ok(`${lang}: a catalogue exists`, false); continue; }
  const mod = await import(pathToFileURL(file));
  const cat = mod.default;
  const missing = keys.filter(k => !(k in cat) && !LATER(k));
  const extra = Object.keys(cat).filter(k => !(k in en));
  ok(`${lang}: every English key is there`, missing.length === 0, missing.slice(0, 5).join(', '));
  ok(`${lang}: no key English lacks`, extra.length === 0, extra.slice(0, 5).join(', '));
  const badHoles = keys.filter(k => k in cat && holes(cat[k]) !== holes(en[k]));
  ok(`${lang}: placeholders match per key`, badHoles.length === 0, badHoles.slice(0, 5).map(k => `${k}: ${holes(cat[k])} vs ${holes(en[k])}`).join('; '));
  const cats = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
  const badPl = keys.filter(k => k in cat && typeof en[k] === 'object').filter(k => {
    const e = cat[k];
    if (typeof e !== 'object') return true;
    return cats.some(c => c !== 'zero' && !(c in e) && !('other' in e)) || !('other' in e) || !cats.filter(c => c !== 'zero').every(c => c in e);
  });
  ok(`${lang}: plurals have the categories ${cats.join('/')} reports`, badPl.length === 0, badPl.slice(0, 5).join(', '));
  const nonPlural = keys.filter(k => k in cat && typeof en[k] === 'string' && typeof cat[k] !== 'string');
  ok(`${lang}: plain strings stay plain`, nonPlural.length === 0, nonPlural.slice(0, 5).join(', '));
  if (lang !== 'en'){
    const src = fs.readFileSync(file, 'utf8');
    ok(`${lang}: marked for a native review`, mod.review === 'machine' && /NEEDS A NATIVE REVIEW/.test(src.split('\n')[0]));
    ok(`${lang}: the app lists it as machine-translated`, I.MACHINE.has(lang) === (mod.review === 'machine'));
    const empty = keys.filter(k => typeof cat[k] === 'string' && !cat[k].trim() && en[k].trim());
    ok(`${lang}: no empty strings`, empty.length === 0, empty.slice(0, 5).join(', '));
    const tags = s => (typeof s === 'string' ? [s] : Object.values(s)).flatMap(x => String(x).match(/<\/?(b|kbd|code|i)>/g) ?? []).length;
    const badTags = keys.filter(k => k in cat && Math.sign(tags(cat[k])) !== Math.sign(tags(en[k])));
    ok(`${lang}: markup kept where English has it`, badTags.length === 0, badTags.slice(0, 5).join(', '));
  }
}

const used = new Map();
const walk = dir => { for (const f of fs.readdirSync(dir, { withFileTypes: true })){ const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.js$/.test(f.name)) scan(p); } };
function scan(file){
  const s = fs.readFileSync(file, 'utf8');
  for (const m of s.matchAll(/\b(?:t|h|tr|keyed)\(\s*'([a-zA-Z][\w.-]*)'/g)) if (m[1].includes('.')) used.set(m[1], path.relative(ROOT, file));
  for (const m of s.matchAll(/\btIn\([^,()]+,\s*'([a-zA-Z][\w.-]*)'/g)) used.set(m[1], path.relative(ROOT, file));
  // a key chosen at run time from a short list: t(x ? 'a.b' : 'a.c')
  for (const m of s.matchAll(/\b(?:t|h|tr)\(\s*[^'()]{1,60}\?\s*'([a-zA-Z][\w.-]*)'\s*:\s*'([a-zA-Z][\w.-]*)'/g)) for (const k of [m[1], m[2]]) used.set(k, path.relative(ROOT, file));
}
walk(path.join(ROOT, 'src'));
const unknown = [...used].filter(([k]) => !(k in en));
ok(`every key used in src/ is in en.js (${used.size} used)`, unknown.length === 0, unknown.slice(0, 8).map(([k, f]) => `${k} (${f})`).join(', '));
const unused = keys.filter(k => !used.has(k) && !/^(doc\.|lang\.|kind\.|level\.)/.test(k));
console.log(`      ${unused.length} keys not found by the static scan (built at run time): ${unused.slice(0, 12).join(', ')}${unused.length > 12 ? '…' : ''}`);

ok('t() fills placeholders', I.t('toast.linked', { name: 'Docs' }) === 'Linked to Docs.');
ok('t() picks the English plural', I.t('head.pages', { n: 1 }) === '1 page' && I.t('head.pages', { n: 2 }) === '2 pages' && I.t('head.pages', { n: 0 }) === '0 pages');
ok('a key missing everywhere gives the key itself', I.t('no.such.key') === 'no.such.key');
ok('h() keeps the catalogue’s markup and escapes parameters', I.h('head.reconnectNote', { name: '<x>' }) === 'The folder <b>&lt;x&gt;</b> needs permission again.');
ok('a thrown error with a key reads in the interface language', I.errText(I.keyed('error.lastClaim')) === en['error.lastClaim']);
I.useCatalogue('xx', { 'head.save': 'Mentés', 'head.pages': { one: '{n} oldal', other: '{n} oldal' } });
ok('a catalogue’s own string wins', I.t('head.save') === 'Mentés');
ok('a key missing from a catalogue gives the English', I.t('head.saving') === en['head.saving']);
await I.setUiLang('en');
ok('setUiLang back to English', I.uiLang() === 'en' && I.t('head.save') === 'Save');
ok('a language with no catalogue falls back to English', (await I.setUiLang('tlh')) === 'en');

console.log(failed ? `\n${failed} i18n check(s) FAILED` : '\nall i18n checks passed');
process.exit(failed ? 1 : 0);
