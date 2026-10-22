// The Design view's look settings: section style, fonts, text size, density, colour and key words. Pure: no DOM.
// The tables here are general. What each look offers, and its defaults, live in its entry in src/themes.js (`design`);
// this file never names a look. `designOf` checks a resume's `recipe.design` against that entry, and `designCss` turns the
// result into the one CSS string the app, the thumbnails, the export and the scripts add after the look's stylesheets.
// Only what differs from the look's own defaults is written, so a resume with no `design` renders as it always did.
//
// recipe.design = { preset, fonts, size, density, colour, words }, every key optional.
// `lookCss` is the one function for a resume's whole extra CSS (these settings, then the accent and an imported theme's tokens): the
// app's sheet, thumbnails and exports and the Node scripts all call it.

import { lookOf } from '../themes.js';
import { toCss } from './tokens.js';

// rank: one level, or two (the related topics go under the main section above: the renderer's job, not CSS's).
// main and minor: how a label is drawn; lines: a hairline above the main sections.
export const PRESETS = {
  quiet: { rank: 'one', main: 'bold', lines: 'main' },
  bare: { rank: 'one', main: 'bold', lines: 'none' },
  marker: { rank: 'two', main: 'highlight', minor: 'plain', lines: 'none' },
  markerLines: { rank: 'two', main: 'highlight', minor: 'plain', lines: 'main' },
  soft: { rank: 'two', main: 'light', minor: 'plain', lines: 'none' },
  underlined: { rank: 'two', main: 'underline', minor: 'plain', lines: 'none' },
  markerTint: { rank: 'two', main: 'highlight', minor: 'light', lines: 'none' },
};

// The related topics a two-level style groups under the main section above (the renderer does it; labelCss draws the minor label).
export const RELATED = ['certified', 'patent', 'languages', 'interests'];

// name and short: what the Design view calls the pairing, in full and on its button (font names, so not translated); head: the name and the headings; body: the text;
// mono: the dates line and the contact. `faces`: [family, file, weight, style].
export const FONTS = {
  hanken: { name: 'Hanken Grotesk + Fira Code', short: 'Hanken', head: '"Hanken Grotesk", "Helvetica Neue", Helvetica, Arial, sans-serif', body: '"Hanken Grotesk", "Helvetica Neue", Helvetica, Arial, sans-serif', mono: '"Fira Code", ui-monospace, Menlo, monospace', faces: [] },   // b2-marker.css carries its files
  source: { name: 'Source Serif 4 + Source Sans 3', short: 'Source Serif', head: '"Source Serif 4", Georgia, serif', body: '"Source Serif 4", Georgia, serif', mono: '"Source Sans 3", "Hanken Grotesk", sans-serif',
    faces: [['Source Serif 4', 'SourceSerif4-Regular', 400, 'normal'], ['Source Serif 4', 'SourceSerif4-Italic', 400, 'italic'], ['Source Serif 4', 'SourceSerif4-Bold', 700, 'normal'],
      ['Source Sans 3', 'SourceSans3-Regular', 400, 'normal'], ['Source Sans 3', 'SourceSans3-Bold', 700, 'normal']] },
  plex: { name: 'IBM Plex Sans + Plex Mono', short: 'IBM Plex', head: '"IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif', body: '"IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif', mono: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
    faces: [['IBM Plex Sans', 'IBMPlexSans-Regular', 400, 'normal'], ['IBM Plex Sans', 'IBMPlexSans-Italic', 400, 'italic'], ['IBM Plex Sans', 'IBMPlexSans-Bold', 700, 'normal'],
      ['IBM Plex Mono', 'IBMPlexMono-Regular', 400, 'normal']] },
};
// each file in two subsets; a page loads the latin-ext one only when it has those letters (as classic.css does)
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF';
// the page templates live in templates/, so ../fonts/ is the same folder the stylesheets in themes/ reach
const faceCss = ([family, file, weight, style]) => [['latin', LATIN], ['latin-ext', LATIN_EXT]].map(([sub, range]) =>
  `@font-face{font-family:"${family}";src:url("../fonts/${file}-${sub}.woff2") format("woff2");font-weight:${weight};font-style:${style};font-display:block;unicode-range:${range}}`).join('\n');

// the body size in px; the look's own size (its fs-bullet) is Medium, and a look can set its own sizes (`design.sizes`)
export const SIZES = { small: 12.3, medium: 12.7, large: 13.3 };
// space: the gaps' scale (--space-scale); lh: the line spacing, null for the look's own; langs: languages in a row; header: a smaller name
export const DENSITIES = {
  roomy: { space: 1.25, lh: 1.5 },
  balanced: { space: 1, lh: null },
  compact: { space: 0.75, lh: 1.38, langs: true, header: true },
};
// screen shade, then the highlighter ink it prints as
export const COLOURS = {
  yellow: ['#ffd900', '#fff04d'], green: ['#7fd1ae', '#a3f07a'], blue: ['#9cc3ff', '#7ad3f7'],
  orange: ['#ffb08a', '#ffb347'], violet: ['#d6b4ff', '#c8a2f2'], pink: ['#f4a6c0', '#ff8ccf'],
};
export const WORDS = ['colour', 'bold'];
export const MEDIA = ['screen', 'print', 'pen'];
const DEFAULT_COLOUR = 'yellow';

// What `look` offers for each setting on `format`, as lists (the first of presets and fonts is not the default: `design.preset` and `font` are).
// Small is not offered on Letter: its wider column runs over 95 characters a line. null for a look with no `design`.
export function offersOf(look, format){
  const L = look?.design;
  if (!L) return null;
  return {
    preset: L.presets ?? Object.keys(PRESETS),
    fonts: L.fonts ?? Object.keys(FONTS),
    size: Object.keys(L.sizes ?? SIZES).filter(s => !(s === 'small' && format === 'us-letter')),
    density: Object.keys(DENSITIES),
    colour: Object.keys(COLOURS),
    words: WORDS,
  };
}

// The settings a resume gets on `look` (a src/themes.js entry): what it asked for in recipe.design if the look offers it, else the
// look's default. null for a look with no `design`.
export function designOf(recipe, look){
  const O = offersOf(look, recipe?.format);
  if (!O) return null;
  const L = look.design;
  const want = recipe?.design && typeof recipe.design === 'object' ? recipe.design : {};
  const pick = (v, offered, dflt) => (offered.includes(v) ? v : dflt);
  return {
    preset: pick(want.preset, O.preset, L.preset ?? null),
    fonts: pick(want.fonts, O.fonts, L.font),
    size: pick(want.size, O.size, 'medium'),
    density: pick(want.density, O.density, 'balanced'),
    colour: pick(want.colour, O.colour, DEFAULT_COLOUR),
    words: pick(want.words, O.words, 'colour'),
  };
}

// Why a `design` (as an agent writes it in picks.json) is not one `look` offers on `format`: one line per key, [] when it all is.
// designOf quietly falls back to the default; a file someone wrote should be told.
export function designProblems(design, look, format){
  const O = offersOf(look, format);
  if (!O) return [`${look?.id ?? 'this look'} offers no settings`];
  if (!design || typeof design !== 'object' || Array.isArray(design)) return ['design: must be an object'];
  return Object.entries(design).map(([k, v]) => !(k in O) ? `design.${k}: not a setting (${Object.keys(O).join(', ')})`
    : O[k].includes(v) ? '' : `design.${k}: ${JSON.stringify(v)} is not offered on ${look.id}${k === 'size' && format === 'us-letter' ? ' for Letter' : ''} (it offers ${O[k].join(', ')})`).filter(Boolean);
}

// Chooses one setting on a resume: the look's own default is no key at all, and a resume at its defaults has no `design`.
export function setDesign(recipe, look, key, value){
  const d = { ...(recipe.design ?? {}) };
  if (value === designOf({}, look)?.[key]) delete d[key]; else d[key] = value;
  if (Object.keys(d).length) recipe.design = d; else delete recipe.design;
}

// The label rules of a section style. pen: a fill or an underline would vanish under a highlighter, so it is a dotted guide.
// ink: a thin ink underline (a look whose rule is ink); a look that draws its own rule under each heading asks for no lines.
function labelCss(p, pen, ink){
  const M = '.page .band:not(.band--sub) > .band__gutter > .tab', m = '.page .band--sub > .band__gutter > .tab', out = [];
  const mix = n => `color-mix(in srgb,var(--accent) ${n}%,var(--paper))`;
  const fill = (sel, c, pad) => pen ? `${sel}{background:none;box-shadow:none;outline:1.2px dotted #8a8a8a;outline-offset:-1px;color:var(--ink);padding:${pad};font-weight:var(--fw-black)}`
    : `${sel}{background:${c};box-shadow:none;color:var(--tab-ink,var(--ink));padding:${pad};font-weight:var(--fw-black);flex:none}`;
  const ul = (sel, w) => pen ? `${sel}{background:none;box-shadow:none;border-bottom:1.4px dotted #8a8a8a;font-weight:var(--fw-bold)}`
    : `${sel}{background:none;box-shadow:inset 0 -${ink ? '1px' : w} 0 ${ink ? 'var(--ink)' : 'var(--accent)'};font-weight:var(--fw-bold)}`;
  out.push('.page .tab-note{box-shadow:none}');
  if (p.main === 'highlight') out.push(fill(M, 'var(--accent)', '4px 9px 4px 11px'), pen ? '' : `${M}.tab--cont{background:${mix(50)}}`);
  if (p.main === 'light') out.push(fill(M, mix(40), '4px 9px 4px 11px'), pen ? '' : `${M}.tab--cont{background:${mix(22)}}`);
  if (p.main === 'underline') out.push(ul(M, '2.5px'), pen ? '' : `${M}.tab--cont{box-shadow:inset 0 -${ink ? '1px' : '2.5px'} 0 ${ink ? '#b4b4b4' : mix(45)}}`);
  if (p.main === 'bold') out.push(`${M}{background:none;box-shadow:none;font-weight:var(--fw-bold);color:var(--ink)}`, `${M}.tab--cont{color:var(--muted-label)}`);
  if (p.minor === 'light') out.push(fill(m, mix(35), '3px 7px 3px 8px'));
  else out.push(`${m}{background:none;box-shadow:none;font-weight:var(--fw-bold);color:var(--muted-label)}`);
  out.push('.page .band--section::before{border-top:0}');
  if (p.lines === 'main') out.push('.page .band--section:not(.band--sub) > .band__gutter::before{content:"";position:absolute;left:0;right:0;top:calc(var(--rule-above) * -1);border-top:1px solid var(--rule-quiet)}',
    '.page > .band--section:first-child > .band__gutter::before{display:none}');
  return out.filter(Boolean).join('\n');
}

// The CSS of a resume's settings on `look`, as [the rest, the pen's rules]; `design` is what designOf returned. medium: 'screen',
// 'print' (the highlighter shade of the colour) or 'pen' (black and white with dotted guides to go over with a highlighter). accent:
// the resume's own "any colour", which is the colour on a screen and in print. The pen's rules are a second part because they
// must come last: an accent token written after them would give the highlights their colour back (see lookCss).
function designParts(look, design, { medium = 'screen', accent = null } = {}){
  const L = look?.design;
  if (!L || !design) return ['', ''];
  if (!MEDIA.includes(medium)) medium = 'screen';
  const d = design, D = DENSITIES[d.density], pen = medium === 'pen', out = [], root = [], penOut = [];
  if (d.fonts !== L.font){      // the look's own pair is in its stylesheet already
    const f = FONTS[d.fonts];
    out.push(...f.faces.map(faceCss));
    root.push(`--font-sans:${f.body}`, `--font-name:${f.head}`, `--font-heading:${f.head}`, `--font-mono:${f.mono}`);
  }
  if (pen){
    penOut.push(':root{--accent:transparent;--highlight:transparent;--tab-fill-cont:transparent;--line:#bdbdbd}',
      '.namemark::before{display:none}', '.mark,.name{text-decoration:underline dotted #8a8a8a;text-decoration-thickness:1.4px;text-underline-offset:3px}.name{text-underline-offset:6px}');
  } else if (medium !== 'screen' || d.colour !== DEFAULT_COLOUR){
    const c = /^#[0-9a-f]{6}$/i.test(accent ?? '') ? accent : COLOURS[d.colour][medium === 'print' ? 1 : 0];
    root.push(`--accent:${c}`, `--highlight:${c}`, `--tab-fill-cont:color-mix(in srgb, ${c} 50%, #fff)`);
  }
  const px = (L.sizes ?? SIZES)[d.size], scale = +(px / (L.sizes ?? SIZES).medium).toFixed(4);
  if (scale !== 1) root.push(`--type-scale:${scale}`);
  if (D.space !== 1) root.push(`--space-scale:${D.space}`);
  if (D.lh) root.push(`--lh-bullet:${D.lh}`, `--lh-summary:${D.lh}`);
  if (root.length) out.push(`:root{${root.join(';')}}`);
  if (d.words === 'bold') out.push('.mark{background:none!important;font-weight:700}');
  if (pen || d.preset !== L.preset){
    const p = PRESETS[d.preset ?? 'quiet'];
    (pen ? penOut : out).push(labelCss(L.ownRule ? { ...p, lines: 'none' } : p, pen, !!L.inkRule));
  }
  if (D.langs) out.push('.page .band[data-section="languages"] .pairs{grid-template-columns:repeat(3,max-content minmax(0,1fr));column-gap:10px}');
  if (D.header) out.push('.page .band--header .name{font-size:calc(var(--fs-name) * .85)}');
  return [out.join('\n'), penOut.join('\n')];
}
export const designCss = (look, design, o) => designParts(look, design, o).filter(Boolean).join('\n');

// The tokens a resume adds on top of its base theme: an imported theme's, then its own accent.
export function tokensOf(record, recipe){
  const t = { ...((record?.themes ?? []).find(x => x.id === recipe.look)?.tokens ?? {}) };
  if (recipe.accent){ t.accent = recipe.accent; t.highlight = recipe.accent; }
  return t;
}

// 'print' and 'pen' are for paper: the page also gets the class `medium-print` on its root element (a look may bleed to the edges
// on a screen and keep a margin on paper, as Banner does; the page checks measure with it).
export const onPaper = medium => medium === 'print' || medium === 'pen';

// A resume's whole extra CSS: the look settings, then the accent and an imported theme's tokens (so an imported theme still wins),
// then, for a pen, its rules last, or the resume's own accent would cover the transparent highlights. '' when it adds nothing.
export function lookCss(record, recipe, { medium = 'screen' } = {}){
  const look = lookOf(recipe), [rest, pen] = designParts(look, designOf(recipe, look), { medium, accent: recipe.accent });
  return [rest, toCss(tokensOf(record, recipe)), pen].filter(Boolean).join('\n');
}
