#!/usr/bin/env node
// node checks/design-check.mjs
// The Design view's look settings (src/model/design.js, each look's `design` in src/themes.js): every combination a look offers
// gives CSS, nothing a look does not offer survives designOf, an empty design is the look's defaults and adds nothing to the page,
// Small is refused on Letter, and pen and print differ from screen; then what the renderer does with them (two-level ranking, the job
// title beside the name, Fit's key). Node only: how the pages draw is checks/themes-pages-check.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES, lookOf } from '../src/themes.js';
import { load } from '../src/model/schema.js';
import { createDocument } from '../scripts/lib/dom.mjs';
import { renderPages, defaultRecipe, measureKey } from '../src/render.js';
import { key as fitKey } from '../src/fit.js';
import { PRESETS, FONTS, SIZES, DENSITIES, COLOURS, WORDS, MEDIA, designOf, designCss, setDesign, lookCss, tokensOf, onPaper, offersOf, designProblems } from '../src/model/design.js';
import en from '../src/i18n/en.js';
import { groupedOf, setSectionGrouped } from '../src/model/resume.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);
const css = (look, design, o) => designCss(look, designOf({ design }, look), o);
const looks = THEMES.filter(x => x.design), L = id => THEMES.find(x => x.id === id);
const NONE = { id: 'none', layers: ['b2-marker'] };      // a look with no `design`: every built-in one has one now
const offered = (look, key, all) => look.design[key] ?? Object.keys(all);

section('what a look offers');
{
  ok('the looks that offer settings are the five new ones, the three kept ones and B2 Marker', ['b2', 'dots', 'classic', 'classic-full', 'banner', 'aa', 'tint', 'mono'].every(id => L(id).design));
  ok('a look with no `design` offers nothing', designOf({ design: { preset: 'soft' } }, NONE) === null && css(NONE, { preset: 'soft' }) === '');
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

section('lookCss');
{
  const rec = { themes: [{ id: 'theme-x', name: 'X', tokens: { accent: '#d6b4ff', ink: '#202040' } }] };
  const own = { design: { preset: 'marker', size: 'large' }, accent: '#336699', look: 'theme-x', format: 'a4' };
  const screen = lookCss(rec, own), print = lookCss(rec, own, { medium: 'print' }), pen = lookCss(rec, own, { medium: 'pen' });
  ok('a resume at its defaults adds nothing, on a screen and on paper', lookCss({}, {}) === '' && lookCss({}, { format: 'a4' }, { medium: 'screen' }) === '');
  ok('the design settings come first, then the accent and an imported theme\'s tokens (the resume\'s own accent wins over the theme\'s)', screen.indexOf('--type-scale') < screen.indexOf('--accent: #336699') && /--accent: #336699/.test(screen) && !/#d6b4ff/.test(screen) && /--ink: #202040/.test(screen));
  ok('on a screen and in print the accent token is the colour, and the settings\' own colour does not cover it', /--accent: #336699/.test(print) && print.lastIndexOf('--accent') > print.indexOf('--type-scale'));
  ok('a pen\'s rules come last, after the accent and the theme\'s tokens, so the highlights stay transparent', pen.lastIndexOf('--accent: #336699') < pen.lastIndexOf('--accent:transparent') && pen.lastIndexOf('--ink: #202040') < pen.indexOf('--accent:transparent') && pen.lastIndexOf('dotted') > pen.lastIndexOf('--accent: #336699'));
  ok('the pen\'s guides are in it, and print is not the pen', /dotted/.test(pen) && !/dotted/.test(print) && !/dotted/.test(screen));
  ok('the colour in print is the highlighter shade, and an accent of the resume\'s own is its colour either way', /--accent:#fff04d/.test(lookCss({}, { design: { preset: 'marker' } }, { medium: 'print' })) && !/--accent:#fff04d/.test(print));
  ok('designCss is the same without the tokens', designCss(THEMES[0], designOf({ design: { size: 'large' } }, THEMES[0]), { medium: 'pen' }).includes('--accent:transparent'));
  ok('tokensOf: an imported theme\'s tokens, then the resume\'s accent for the accent and the highlight', JSON.stringify(tokensOf(rec, own)) === JSON.stringify({ accent: '#336699', ink: '#202040', highlight: '#336699' }));
  ok('print and pen are for paper (the page gets medium-print), a screen is not, an unknown one is not', onPaper('print') && onPaper('pen') && !onPaper('screen') && !onPaper('x') && !onPaper());
  ok('an unknown medium is a screen', lookCss(rec, own, { medium: 'x' }) === screen);
  const b2 = L('b2');
  ok('offersOf: what the look offers, Small not on Letter, nothing for a look with no design', offersOf(b2, 'a4').size.join() === 'small,medium,large' && offersOf(b2, 'us-letter').size.join() === 'medium,large' && offersOf(NONE, 'a4') === null && offersOf(L('classic'), 'a4').fonts.join() === 'source');
  ok('designProblems: an offered setting is none, one the look does not offer is named with what it offers', designProblems({ size: 'large', fonts: 'plex' }, b2, 'a4').length === 0
    && /design\.fonts: "plex" is not offered on classic \(it offers source\)/.test(designProblems({ fonts: 'plex' }, L('classic'), 'a4')[0])
    && /design\.size: "small" is not offered on b2 for Letter/.test(designProblems({ size: 'small' }, b2, 'us-letter')[0])
    && /design\.shade: not a setting/.test(designProblems({ shade: 'x' }, b2, 'a4')[0]) && designProblems('soft', b2, 'a4').length === 1 && designProblems({}, b2, 'a4').length === 0 && designProblems({ preset: null }, b2, 'a4').length === 1);
}

section('the renderer');
{
  const { model } = load(JSON.parse(fs.readFileSync(path.join(REPO, 'data/example.json'), 'utf8')));
  const rec = (o = {}) => ({ ...defaultRecipe(model, 'a4'), photo: { show: false }, ...o });
  const html = (r, m = model) => renderPages(m, r, createDocument(), { annotate: true }).pages.map(p => p.outerHTML).join('');
  const cls = (h, id) => h.match(new RegExp(`class="([^"]*)"[^>]*data-section="${id}"`))?.[1] ?? '';
  const RELATED = ['certified', 'patent', 'languages', 'interests'];
  const subs = h => RELATED.filter(id => /band--sub/.test(cls(h, id)));
  ok('a two-level section style groups the four related topics', ['marker', 'markerLines', 'soft', 'underlined', 'markerTint'].every(preset => subs(html(rec({ design: { preset } }))).length === 4));
  ok('a one-level style, and a look\'s own one-level default, group none', subs(html(rec({ design: { preset: 'bare' } }))).length === 0 && subs(html(rec())).length === 0 && subs(html(rec({ design: { preset: 'quiet' } }))).length === 0);
  ok('a look whose default is two-level groups them with no design', subs(html(rec({ overlays: ['banner'] }))).length === 4);
  const own = html(rec({ design: { preset: 'marker' }, sections: [{ id: 'patent', style: '' }, { id: 'languages', style: 'sub' }] }));
  ok('a section\'s own style wins: one set to none stays ungrouped, the rest are grouped', !/band--sub/.test(cls(own, 'patent')) && subs(own).join() === 'certified,languages,interests', subs(own).join());
  ok('a hand layout\'s slot style wins too', !/band--sub/.test(cls(html(rec({ design: { preset: 'marker' }, pages: [['header', 'summary', 'skills', 'certified', { id: 'patent', style: '' }]] })), 'patent')));
  ok('a related topic with no tab above it on its page is not grouped', !/band--sub/.test(cls(html(rec({ design: { preset: 'marker' }, pages: [['header', 'summary', 'patent', 'skills']] })), 'patent')));

  const tagIn = h => { const head = h.match(/<header[\s\S]*?<\/header>/)[0]; const [gut, content] = head.split('band__content'); return { gut: /class="tagline"/.test(gut), content: /class="tagline"/.test(content), beside: /band--title-beside/.test(head), br: /class="tagline"[^>]*>[^<]*<br>/.test(head), head }; };
  const plain = tagIn(html(rec()));
  ok('without a photo, in Balanced density, the title stays in the label column with its line break', plain.gut && !plain.content && !plain.beside && plain.br);
  const photo = tagIn(html(rec({ photo: { show: true } })));
  ok('with a photo, in Balanced density, the title stays under it in the label column, with its line break', photo.gut && !photo.content && !photo.beside && photo.br, photo.head.slice(0, 400));
  const compact = tagIn(html(rec({ design: { density: 'compact' } })));
  ok('in Compact density the title goes beside the name, its line break a space', compact.content && !compact.gut && compact.beside && !compact.br && /Mechanical (&amp;|&) Design Engineer/.test(compact.head));
  const compactPhoto = tagIn(html(rec({ photo: { show: true }, design: { density: 'compact' } })));
  ok('with a photo in Compact density it is beside the name too', compactPhoto.content && compactPhoto.beside && !compactPhoto.br);
  const cc = tagIn(html(rec({ overlays: ['classic'], design: { density: 'compact' } })));
  ok('a centred look keeps the title where it is in Compact density, on one line', cc.gut && !cc.beside && !cc.br && /Mechanical (&amp;|&) Design Engineer/.test(cc.head));
  const cb = tagIn(html(rec({ overlays: ['classic'] })));
  ok('a centred header without a photo has the title on one line in any density', cb.gut && !cb.beside && !cb.br);
  const cp = tagIn(html(rec({ overlays: ['classic'], photo: { show: true } })));
  ok('Classic with a photo keeps the title on one line in the label column', cp.gut && !cp.content && !cp.beside && !cp.br);

  const m = structuredClone(model);
  const tv = m.variants.find(v => v.id === 'tagline-v1');
  tv.marks = [{ start: 13, end: 19 }];       // "Design", after the line break
  ok('the highlight stays on its word when the line break becomes a space', [{ design: { density: 'compact' } }, { overlays: ['classic'] }, {}].every((o, i) => {
    const h = html(rec(o), m).match(/class="tagline"[^>]*>([\s\S]*?)<\/p>/)[1];
    return i === 2 ? /<span class="mark">Design<\/span>/.test(h) && /<br>/.test(h) : /(&amp;|&) <span class="mark">Design<\/span> Engineer/.test(h);
  }));

  const r0 = rec();
  const base = measureKey(r0);
  ok('the key of a resume with no overlays, design or imported look is as it was', base === `${r0.format}@${r0.theme}` && fitKey(r0) === base && measureKey({ ...r0, design: {} }) === base && measureKey({ ...r0, design: { size: 'medium', fonts: 'hanken' } }) === base);
  const k = o => measureKey({ ...r0, ...o });
  const changed = [{ size: 'large' }, { density: 'compact' }, { fonts: 'plex' }, { preset: 'marker' }, { words: 'bold' }].map(design => k({ design }));
  ok('size, density, fonts, section style and key words change the key', new Set([base, ...changed]).size === 6, changed.join(' '));
  ok('colour does not', k({ design: { colour: 'green' } }) === base && k({ design: { size: 'large', colour: 'pink' } }) === k({ design: { size: 'large' } }) && k({ accent: '#336699' }) === base);
  ok('the overlays and an imported look change it', k({ overlays: ['classic'] }) !== base && k({ overlays: ['classic'] }) !== k({ overlays: ['dots'] }) && k({ look: 'theme-x' }) !== base && k({ look: 'theme-x' }) !== k({ look: 'theme-y' }));
  ok('the paper still leads, so Fit can read it', k({ design: { size: 'large' }, format: 'us-letter' }).startsWith('us-letter@') && k({ design: { size: 'large' } }).split('@')[0] === 'a4');
  ok('Small on Letter is not a setting, so it is not in the key', k({ design: { size: 'small' }, format: 'us-letter' }) === measureKey({ ...r0, format: 'us-letter' }));
  ok('a retired overlay is the plain look, as the Design view shows it', lookOf({ overlays: ['quiet-tabs'] }).id === 'b2' && lookOf({ overlays: ['no-such'] }).id === 'b2' && lookOf({ overlays: ['b2-marker'] }).id === 'b2');
}

section('what the Design view needs');
{
  const b2 = L('b2'), r = {};
  setDesign(r, b2, 'size', 'large'); setDesign(r, b2, 'preset', 'marker');
  ok('a setting that is not the look\'s default is written', r.design?.size === 'large' && r.design.preset === 'marker', JSON.stringify(r.design));
  setDesign(r, b2, 'size', 'medium'); setDesign(r, b2, 'preset', 'quiet');
  ok('choosing the default removes the key, and a resume at its defaults has no design', !('design' in r), JSON.stringify(r.design));
  const r2 = { design: { preset: 'bare' } };
  setDesign(r2, L('dots'), 'preset', 'bare');
  ok('the default is the look\'s own: Bare is Timeline\'s', !('design' in r2));
  ok('every section style, font, size, density, colour and key-word choice has its words', Object.keys(PRESETS).every(k => en[`look.preset.${k}`] && en[`look.presetNote.${k}`])
    && Object.keys(SIZES).every(k => en[`look.size.${k}`]) && Object.keys(DENSITIES).every(k => en[`look.density.${k}`] && en[`look.densityNote.${k}`])
    && Object.keys(COLOURS).every(k => en[`look.colour.${k}`]) && WORDS.every(k => en[`look.words.${k}`]) && Object.values(FONTS).every(f => f.name));
  ok('an earlier look says what it becomes on B2 Marker, and the picker has the others', THEMES.filter(x => x.earlier).map(x => x.id).join() === 'tint,mono' && L('tint').earlier.preset === 'soft' && !('preset' in L('mono').earlier));

  const { model } = load(JSON.parse(fs.readFileSync(path.join(REPO, 'data/example.json'), 'utf8')));
  const rec = (o = {}) => ({ ...defaultRecipe(model, 'a4'), ...o });
  const marker = rec({ design: { preset: 'marker' } });
  ok('under a two-level style the switch shows what is drawn: on for a related topic, off for another', groupedOf(marker, 'languages') && !groupedOf(marker, 'skills') && !groupedOf(rec(), 'languages'));
  setSectionGrouped(model, marker, 'languages', false);
  ok('turned off under a two-level style it writes "" (not grouped), and is off', marker.sections.find(x => x.id === 'languages').style === '' && !groupedOf(marker, 'languages'));
  setSectionGrouped(model, marker, 'languages', true);
  ok('turned on again it is grouped', groupedOf(marker, 'languages') && marker.sections.find(x => x.id === 'languages').style === 'sub');
  const one = rec();
  setSectionGrouped(model, one, 'languages', true); setSectionGrouped(model, one, 'languages', false);
  ok('under a one-level style, off still removes the key', one.sections.find(x => x.id === 'languages')?.style === undefined && !groupedOf(one, 'languages'));
}

console.log(failed ? `\n${failed} design check(s) FAILED` : '\nall design checks passed');
process.exit(failed ? 1 : 0);
