#!/usr/bin/env node
// node checks/measurement-check.mjs [library.json]
// The page-fill arithmetic, the data-section marker and the probe's coverage, without a browser. With a
// library, the probe rules run against it too and only counts are printed, never text.
// Layout itself is checked by checks/measure-pages-parity.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDocument, serialize } from '../scripts/lib/dom.mjs';
import { renderPages, pageFill, measurePages, probeCount, probeRecipe } from '../src/render.js';
import { readLibrary, readRecipe } from '../scripts/lib/library.mjs';
import { LANGS } from '../src/model/schema.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const data = readLibrary(path.join(REPO, 'checks/fixtures/example-0.4.json')).model;
const base = read(path.join(REPO, 'checks/fixtures/example-0.4-recipe.json'));

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`);
  if (!cond) failed++;
};
const html = (d, recipe, opts = {}) =>
  renderPages(d, recipe, createDocument(), opts).pages.map(p => serialize(p, 1)).join('\n');
const variantIds = s => new Set([...s.matchAll(/data-variant="([^"]+)"/g)].map(m => m[1]));

{
  const raw = { pageTop: 0, pageHeight: 1056, padTop: 56, padBottom: 44, scrollHeight: 1056, clientHeight: 1056,
    kids: [{ top: 56, bottom: 300 }, { top: 300, bottom: 989 }], lineH: 18.41,
    bands: [{ section: 'header', top: 56, bottom: 300 }, { section: 'skills', top: 300, bottom: 989 }] };
  const f = pageFill(raw);
  ok('usable height is the page minus its padding', f.usable === 956, String(f.usable));
  ok('fill is used over usable (933 / 956 = 97.6%)', Math.abs(f.fill - 97.59) < 0.01 && f.used === 933, `${f.fill} ${f.used}`);
  ok('slack is in px and in body lines', f.slack === 23 && Math.abs(f.slackLines - 23 / 18.41) < 1e-9);
  ok('no overflow, no section named', f.overflow === 0 && f.overflowSection === null);

  const over = pageFill({ ...raw, scrollHeight: 1090, kids: [{ top: 56, bottom: 1046 }],
    bands: [{ section: 'header', top: 56, bottom: 300 }, { section: 'experience', top: 300, bottom: 1010 },
            { section: 'skills', top: 1010, bottom: 1046 }] });
  ok('overflow is the scroll excess, and the first band past the content box is named',
     over.overflow === 34 && over.overflowSection === 'skills', JSON.stringify([over.overflow, over.overflowSection]));
  ok('a band ending exactly at the content box is not past it',
     pageFill({ ...raw, bands: [{ section: 'a', top: 0, bottom: 1012 }] }).overflowSection === null);
  ok('overflow with no band names says so rather than guessing',
     pageFill({ ...raw, scrollHeight: 1100, bands: [] }).overflowSection === null);
  ok('an empty page is 0% and does not divide by zero', pageFill({ ...raw, kids: [], bands: [] }).fill === 0);
  ok('without a line height the slack in lines is null', pageFill({ ...raw, lineH: null }).slackLines === null);
}

{
  const rect = (top, bottom) => ({ top, bottom, height: bottom - top });
  const node = (o = {}) => ({ children: [], attrs: {}, style: {}, rect: rect(0, 0),
    getBoundingClientRect() { return this.rect; }, getAttribute(k) { return this.attrs[k] ?? null; }, ...o });
  const head = node({ rect: rect(56, 200) });
  const body = node({ rect: rect(200, 900), attrs: { 'data-section': 'experience' } });
  const tail = node({ rect: rect(900, 960), attrs: { 'aria-label': 'Skills' } });
  const furniture = node({ rect: rect(1000, 1012), style: { position: 'absolute' } });
  const pg = node({ children: [head, body, tail, furniture], rect: rect(0, 1056), scrollHeight: 1056, clientHeight: 1056,
    style: { paddingTop: '56px', paddingBottom: '44px' },
    querySelectorAll: s => (s === '.band' ? [body, tail] : []) });
  const li = node({ style: { lineHeight: '18.41px', fontSize: '12.7px' } });
  const root = { querySelectorAll: s => (s === '.page' ? [pg] : []), querySelector: s => (s === '.bullets li' ? li : null),
    ownerDocument: { defaultView: { getComputedStyle: n => n.style } } };
  const [m] = measurePages(root);
  ok('the absolutely positioned page-mark is left out of the used height', m.used === 904 && m.page === 1, JSON.stringify(m));
  ok('the body line height is read from a bullet', m.lineH === 18.41);
  ok('bands are named from data-section, else the aria-label',
     m.bands.map(b => b.section).join() === 'experience,Skills');
  li.style = { lineHeight: 'normal', fontSize: '10px' };
  ok('a "normal" line-height falls back to 1.2 x the font size', measurePages(root)[0].lineH === 12);
  ok('no bullets, no line height', measurePages({ ...root, querySelector: () => null })[0].lineH === null);
}

{
  const plain = html(data, base), annotated = html(data, base, { annotate: true });
  const bands = s => [...s.matchAll(/<(?:section|header) class="band [^"]*"[^>]*>/g)].map(m => m[0]);
  ok('a document that gets sent carries no data-section', !/data-section/.test(plain) && bands(plain).length > 0);
  ok('an annotated one carries it on every band', bands(annotated).length === bands(plain).length
     && bands(annotated).every(b => /data-section="[a-z-]+"/.test(b)));
  const names = bands(annotated).map(b => b.match(/data-section="([^"]+)"/)[1]);
  ok('the names are section ids, in page order', names.join() === 'header,summary,experience,experience,skills,patent,education',
     names.join());
  ok('annotating changes nothing but the attributes',
     annotated.replace(/ data-(variant|section|label)="[^"]*"/g, '') === plain);
}

function probeCoverage(label, d, recipe, { quiet = false } = {}){
  const lang = recipe.lang ?? 'en';
  const K = probeCount(d, recipe);
  const pr = probeRecipe(d, recipe);
  const seen = new Set();
  const per = [];
  for (let k = 0; k < K; k++){
    const out = html(d, pr, { annotate: true, probe: k });
    per.push(out);
    variantIds(out).forEach(id => seen.add(id));
  }
  const byId = new Map(d.variants.map(v => [v.id, v]));
  const inLang = d.variants.filter(v => (v.lang ?? 'en') === lang);
  const missing = inLang.filter(v => !seen.has(v.id));
  const foreign = [...seen].filter(id => (byId.get(id)?.lang ?? 'en') !== lang);
  return { label, K, seen, per, missing, foreign, total: inLang.length };
}
{
  const c = probeCoverage('example', data, base);
  const longest = Math.max(...data.facts.map(f => f.variants.length));
  ok('K is the most phrasings any one fact has', c.K === longest, `${c.K} vs ${longest}`);
  ok(`every phrasing in the example is laid out at least once (${c.total - c.missing.length}/${c.total})`,
     c.missing.length === 0, c.missing.map(v => v.id).join(', '));
  ok('a merged phrasing and the fact it covers both print in the probe',
     c.seen.has('hydra-testing-merged') && c.seen.has('hydra-suppliers-base'));

  const noisy = structuredClone(base);
  noisy.picks = { 'hydra-inhaler': 'hydra-inhaler-full', 'hydra-testing': 'hydra-testing-merged' };
  noisy.overrides = { 'poly-shop': 'one-off text' };
  noisy.pins = { include: ['hydra-inhaler'], phrasing: ['hydra-testing'] };
  noisy.sections[3].weight = 0;
  const same = [...Array(c.K).keys()].every(k =>
    html(data, probeRecipe(data, noisy), { annotate: true, probe: k }) === c.per[k]);
  ok('the probe ignores picks, overrides, pins and weights', same);
  ok('probeRecipe keeps format, theme, overlays', (r => r.format === base.format && r.theme === base.theme && Array.isArray(r.overlays))(probeRecipe(data, base)));
  ok('probe passes are annotation-only: without annotate they carry no data-variant',
     !/data-variant/.test(html(data, probeRecipe(data, base), { probe: 0 })));
}

const LIB = process.argv[2];
if (LIB){
  const lib = readLibrary(LIB).model;
  for (const lang of LANGS){
    if (!lib.variants.some(v => (v.lang ?? 'en') === lang)) continue;
    const c = probeCoverage(lang, lib, { format: 'a4', theme: 'b2-marker', lang });
    ok(`library · ${lang}: the probe never prints a phrasing in another language (${c.seen.size} printed)`, c.foreign.length === 0,
       `${c.foreign.length} foreign`);
    // the rest are phrasings no section prints, e.g. an alternate summary; the CLI names them
    console.log(`      ${lang}: ${c.total - c.missing.length} of ${c.total} phrasings laid out over ${c.K} passes; ${c.missing.length} printed by no section`);
  }
}

console.log(failed ? `\n${failed} FAILED` : '\nall measurement checks passed');
process.exit(failed ? 1 : 0);
