#!/usr/bin/env node
// node checks/design-check.mjs
// The Design view's look settings (src/model/design.js, each look's `design` in src/themes.js): every combination a look offers
// gives CSS, nothing a look does not offer survives designOf, an empty design is the look's defaults and adds nothing to the page,
// Small is refused on Letter, and pen and print differ from screen. Node only: how the pages draw is checks/themes-pages-check.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES } from '../src/themes.js';
import { PRESETS, FONTS, SIZES, DENSITIES, COLOURS, WORDS, MEDIA, designOf, designCss } from '../src/model/design.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);
const css = (look, design, o) => designCss(look, designOf({ design }, look), o);
const looks = THEMES.filter(x => x.design), L = id => THEMES.find(x => x.id === id);
const offered = (look, key, all) => look.design[key] ?? Object.keys(all);

section('what a look offers');
{
  ok('the looks that offer settings are the five new ones, the three kept ones and B2 Marker', ['b2', 'dots', 'classic', 'classic-full', 'banner', 'aa', 'tint', 'mono'].every(id => L(id).design));
  ok('a look with no `design` offers nothing', designOf({ design: { preset: 'soft' } }, L('compact')) === null && css(L('compact'), { preset: 'soft' }) === '');
  for (const x of looks){
    const d = x.design;
    ok(`${x.id}: its defaults are among what it offers`, (d.preset === null || offered(x, 'presets', PRESETS).includes(d.preset)) && offered(x, 'fonts', FONTS).includes(d.font), JSON.stringify(d));
    ok(`${x.id}: only known section styles, fonts and sizes`, (d.presets ?? []).every(p => p in PRESETS) && (d.fonts ?? []).every(f => f in FONTS) && Object.keys(d.sizes ?? {}).every(s => s in SIZES) && (!d.sizes || 'medium' in d.sizes));
  }
  ok('Classic offers Quiet and Marker with lines, and Source Serif only', ['classic', 'classic-full'].every(id => L(id).design.presets.join() === 'quiet,markerLines' && L(id).design.fonts.join() === 'source'));
  ok('Classic full width starts at 13px and has no Small', L('classic-full').design.sizes.medium === 13 && L('classic-full').design.sizes.large === 13.6 && !('small' in L('classic-full').design.sizes));
  ok('every table entry is whole', Object.values(PRESETS).every(p => p.rank && p.main && p.lines) && Object.values(FONTS).every(f => f.head && f.body && f.mono) && Object.keys(COLOURS).length === 6 && Object.values(COLOURS).every(c => c.every(h => /^#[0-9a-f]{6}$/.test(h))));
}

section('every combination gives CSS');
{
  let n = 0, empty = [], unbalanced = [];
  for (const x of looks) for (const preset of offered(x, 'presets', PRESETS)) for (const fonts of offered(x, 'fonts', FONTS))
    for (const size of Object.keys(x.design.sizes ?? SIZES)) for (const density of Object.keys(DENSITIES)) for (const words of WORDS) for (const colour of Object.keys(COLOURS)) for (const medium of MEDIA){
      const design = { preset, fonts, size, density, colour, words };
      const out = css(x, design, { medium });
      n++;
      const plain = preset === x.design.preset && fonts === x.design.font && size === 'medium' && density === 'balanced' && words === 'colour' && colour === 'yellow' && medium === 'screen';
      if (plain ? out !== '' : !out) empty.push(JSON.stringify([x.id, design, medium]));
      if ((out.match(/{/g) ?? []).length !== (out.match(/}/g) ?? []).length) unbalanced.push(x.id);
      if (/undefined|NaN|null/.test(out)) empty.push(`${x.id} ${JSON.stringify(design)}: ${out.match(/.{0,30}(undefined|NaN|null).{0,30}/)[0]}`);
    }
  ok(`${n} combinations: anything but a look's defaults on a screen has CSS, those have none, no undefined or NaN`, !empty.length, empty.slice(0, 3).join('; '));
  ok('every block of CSS is balanced', !unbalanced.length, [...new Set(unbalanced)].join(', '));
}

section('designOf');
{
  const b2 = L('b2'), cf = L('classic-full');
  const dflt = designOf({}, b2);
  ok('an empty design is the look\'s defaults', JSON.stringify(dflt) === JSON.stringify({ preset: 'quiet', fonts: 'hanken', size: 'medium', density: 'balanced', colour: 'yellow', words: 'colour' }), JSON.stringify(dflt));
  ok('the defaults differ by look', designOf({}, L('dots')).preset === 'bare' && designOf({}, L('banner')).preset === 'underlined' && designOf({}, L('classic')).fonts === 'source' && designOf({}, cf).preset === 'quiet');
  ok('Tinted tabs and Mono print have no section style until one is chosen', designOf({}, L('tint')).preset === null && designOf({}, L('mono')).preset === null && designOf({ design: { preset: 'soft' } }, L('mono')).preset === 'soft');
  const all = { preset: 'soft', fonts: 'plex', size: 'large', density: 'roomy', colour: 'blue', words: 'bold' };
  ok('what a look offers is kept', JSON.stringify(designOf({ design: all }, b2)) === JSON.stringify(all));
  const cl = designOf({ design: all }, L('classic'));
  ok('what it does not offer becomes the look\'s default, the rest is kept', cl.preset === 'quiet' && cl.fonts === 'source' && cl.size === 'large' && cl.density === 'roomy' && cl.colour === 'blue' && cl.words === 'bold', JSON.stringify(cl));
  ok('junk is dropped', JSON.stringify(designOf({ design: { preset: 'constructor', fonts: 7, size: null, density: ['roomy'], colour: '#fff', words: {} } }, b2)) === JSON.stringify(dflt)
    && JSON.stringify(designOf({ design: 'soft' }, b2)) === JSON.stringify(dflt) && JSON.stringify(designOf({ design: null }, b2)) === JSON.stringify(dflt) && designOf(undefined, b2) !== null);
  ok('Small is offered on A4 and refused on Letter', designOf({ design: { size: 'small' }, format: 'a4' }, b2).size === 'small' && designOf({ design: { size: 'small' }, format: 'us-letter' }, b2).size === 'medium' && designOf({ design: { size: 'small' }, format: 'a4-hu' }, b2).size === 'small');
  ok('Classic full width refuses Small on any paper', designOf({ design: { size: 'small' }, format: 'a4' }, cf).size === 'medium');
}

section('designCss');
{
  const b2 = L('b2'), cl = L('classic'), cf = L('classic-full');
  ok('a look\'s defaults, with no design, add nothing to the page', looks.every(x => css(x, undefined) === '' && css(x, {}) === ''));
  ok('so do its defaults written out', looks.every(x => css(x, { preset: x.design.preset, fonts: x.design.font, size: 'medium', density: 'balanced', colour: 'yellow', words: 'colour' }) === ''));
  ok('a recipe\'s own accent adds nothing on a screen (the accent token already does it)', designCss(b2, designOf({}, b2), { accent: '#123456' }) === '');
  const scale = x => +(/--type-scale:([\d.]+)/.exec(x)?.[1] ?? 1);
  ok('text size is a scale on the look\'s own size', scale(css(b2, { size: 'small' })) === +(12.3 / 12.7).toFixed(4) && scale(css(b2, { size: 'large' })) === +(13.3 / 12.7).toFixed(4) && scale(css(b2, { size: 'medium' })) === 1);
  ok('Classic full width: Large is 13.6 over its own 13, Medium is as it is', scale(css(cf, { size: 'large' })) === +(13.6 / 13).toFixed(4) && css(cf, { size: 'medium' }) === '');
  ok('density sets the gaps and the line spacing', /--space-scale:1.25;--lh-bullet:1.5;--lh-summary:1.5/.test(css(b2, { density: 'roomy' })) && /--space-scale:0.75;--lh-bullet:1.38/.test(css(b2, { density: 'compact' })) && !/space-scale/.test(css(b2, { density: 'balanced', size: 'large' })));
  ok('Compact density puts the languages in a row and shrinks the name', /data-section="languages"/.test(css(b2, { density: 'compact' })) && /\.85/.test(css(b2, { density: 'compact' })) && !/languages/.test(css(b2, { density: 'roomy' })));
  ok('a pairing\'s font faces come with it, with the unicode ranges and the template-relative paths', (() => {
    const p = css(b2, { fonts: 'plex' }), s = css(b2, { fonts: 'source' });
    return (p.match(/@font-face/g) ?? []).length === 8 && (s.match(/@font-face/g) ?? []).length === 10 && /url\("\.\.\/fonts\/IBMPlexSans-Bold-latin-ext\.woff2"\)/.test(p) && (p.match(/unicode-range/g) ?? []).length === 8 && /--font-sans:"IBM Plex Sans"/.test(p) && /--font-mono:"IBM Plex Mono"/.test(p);
  })());
  ok('every font file a pairing names exists', Object.values(FONTS).every(f => f.faces.every(([, file]) => ['latin', 'latin-ext'].every(s => fs.existsSync(path.join(REPO, 'fonts', `${file}-${s}.woff2`))))));
  ok('the look\'s own pairing brings no faces (its stylesheet has them)', !/@font-face/.test(css(cl, { fonts: 'source', density: 'roomy' })) && !/@font-face/.test(css(b2, { fonts: 'hanken', density: 'roomy' })));
  ok('Classic full width draws no lines of its own, Classic does', !/::before\{content/.test(css(cf, { preset: 'markerLines' })) && /::before\{content/.test(css(cl, { preset: 'markerLines' })) && /::before\{content/.test(css(b2, { preset: 'quiet', colour: 'blue' }) + css(L('dots'), { preset: 'quiet' })));
  ok('the section style draws the labels', /background:var\(--accent\)/.test(css(b2, { preset: 'marker' })) && /color-mix/.test(css(b2, { preset: 'soft' })) && /inset 0 -2\.5px 0 var\(--accent\)/.test(css(b2, { preset: 'underlined' })) && /band--sub > \.band__gutter > \.tab\{background:color-mix/.test(css(b2, { preset: 'markerTint' })));
  ok('key words in bold turn the highlight off and bold the words', /\.mark\{background:none!important;font-weight:700\}/.test(css(b2, { words: 'bold' })) && !/\.mark\{/.test(css(b2, { words: 'colour', size: 'large' })));
  const green = css(b2, { colour: 'green' }), print = css(b2, { colour: 'green' }, { medium: 'print' }), pen = css(b2, { colour: 'green' }, { medium: 'pen' });
  ok('colour: the screen shade, the highlighter shade in print, transparent for a pen', /--accent:#7fd1ae/.test(green) && /--accent:#a3f07a/.test(print) && /--accent:transparent/.test(pen) && !/#7fd1ae|#a3f07a/.test(pen));
  ok('print with the default colour still turns the colour to its print shade', /--accent:#fff04d/.test(css(b2, {}, { medium: 'print' })));
  ok('the resume\'s own accent is the colour on screen and in print', /--accent:#336699/.test(designCss(b2, designOf({ design: { colour: 'green' } }, b2), { accent: '#336699' })) && /--accent:#336699/.test(designCss(b2, designOf({}, b2), { medium: 'print', accent: '#336699' }))
    && !/#336699/.test(designCss(b2, designOf({}, b2), { medium: 'pen', accent: '#336699' })) && !/url|expression/.test(designCss(b2, designOf({}, b2), { medium: 'print', accent: 'red;}body{background:url(x)' })));
  ok('a pen draws dotted guides on the marks, the name and the filled labels, even on the look\'s defaults', /dotted/.test(css(b2, {}, { medium: 'pen' })) && /dotted/.test(css(b2, { preset: 'marker' }, { medium: 'pen' })) && /outline:1\.2px dotted/.test(css(b2, { preset: 'marker' }, { medium: 'pen' })) && /border-bottom:1\.4px dotted/.test(css(L('banner'), {}, { medium: 'pen' })) && !/color-mix\(in srgb,var\(--accent\)/.test(css(b2, { preset: 'soft' }, { medium: 'pen' })));
  ok('screen, print and pen differ', new Set(['screen', 'print', 'pen'].map(medium => css(b2, { preset: 'marker' }, { medium }))).size === 3);
  ok('a legacy look gets its labels from the section style only when one is chosen', css(L('mono'), {}) === '' && /background:var\(--accent\)/.test(css(L('mono'), { preset: 'marker' })));
}

console.log(failed ? `\n${failed} design check(s) FAILED` : '\nall design checks passed');
process.exit(failed ? 1 : 0);
