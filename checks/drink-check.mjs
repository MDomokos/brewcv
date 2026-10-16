#!/usr/bin/env node
// node checks/drink-check.mjs [--table]
// The two drinks (Tea, Coffee) and the two themes (light, dark): one set of tokens each, in src/ui/workbench.css.
//  - every role has a value in the light block of each drink, and the four combinations resolve the way the cascade does;
//  - text passes AA (4.5:1) on the surfaces it is drawn on; the edge of a control, the focus ring and the drawn marks pass 3:1;
//  - no colour is written anywhere but a token block (workbench.css, drinks.css), and the page's marks in sheet.js use tokens;
//  - the setting: src/ui/drink-boot.js (before the first paint) and src/ui/drink.js (the app) read the same two keys and
//    set the same two attributes, and the default is tea, following the system;
//  - the resume is never touched: nothing in drinks.css or the marks reaches the printed content.
// --table prints every pair with its ratio (the contrast table the M11a report lists).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const TABLE = process.argv.includes('--table');
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };

const wb = read('src/ui/workbench.css'), dk = read('src/ui/drinks.css'), st = read('src/ui/start.css'), fl = read('src/ui/flow.css');
const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

// ---- the token blocks ----
function block(selector){
  const css = strip(wb);
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return null;
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('\n}', at));
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const B = {
  root: block(':root'),
  teaLight: block(':root, html[data-drink="tea"]'),
  teaDark: block('html[data-drink="tea"][data-theme="dark"]'),
  coffeeLight: block('html[data-drink="coffee"]'),
  coffeeDark: block('html[data-drink="coffee"][data-theme="dark"]'),
};
ok('the five token blocks exist (:root, tea light, tea dark, coffee light, coffee dark)', Object.values(B).every(Boolean));

// what a role is: every drink's light block gives each of these a value
const ROLES = ['canvas', 'canvas-ink', 'canvas-ink-soft', 'canvas-line', 'canvas-label', 'surface', 'raised', 'input', 'pop', 'hover', 'hover-strong', 'fill', 'fill-strong', 'wash', 'seg-bg',
  'ink', 'ink-soft', 'label', 'faint', 'on-ink', 'line', 'line-strong', 'accent', 'on-accent', 'accent-soft', 'accent-line', 'mark', 'on-mark', 'mark-soft', 'focus',
  'ok', 'bad', 'warn', 'ok-bg', 'warn-bg', 'ok-line', 'warn-line', 'ins-bg', 'del-bg', 'del-ink', 'toast-bg', 'toast-ink', 'tag-bg', 'tag-line', 'tag-ink', 'tag-hole',
  'stage', 'stage-mark', 'stage-on-mark', 'band-bg', 'band-ink', 'band-ink-soft', 'band-line', 'shadow-panel', 'shadow-lift', 'shadow-chip', 'shadow-toast', 'page-shadow', 'page-shadow-soft', 'page-edge', 'page-edge-soft', 'drop-sm',
  'sel-mark', 'sel-mark-soft', 'prev-mark', 'prev-mark-soft', 'page-warn', 'liq', 'cup-band', 'tab-bg', 'tab-ink', 'tab-line'];
for (const [name, blk] of [['tea', B.teaLight], ['coffee', B.coffeeLight]]){
  const missing = ROLES.filter(r => !(`--${r}` in blk));
  ok(`${name}: every role has a value in its light block`, !missing.length, missing.join(', '));
}
const shared = ['--r-xs', '--r-s', '--r-m', '--r-l', '--r-pill', '--r-round', '--r-panel'];
ok('tea: the panel is 24px', B.root['--r-panel'] === '24px');
ok('coffee: 2px corners on everything', shared.every(k => B.coffeeLight[k] === '2px'));
ok('coffee: no shadows', ['--shadow-panel', '--shadow-lift', '--shadow-chip', '--shadow-toast', '--page-shadow', '--drop-sm'].every(k => B.coffeeLight[k] === 'none'));
ok('tea: shadows are flat and offset (no blur)', ['--shadow-panel', '--shadow-lift', '--shadow-chip', '--shadow-toast', '--page-shadow', '--drop-sm'].every(k => /\b\d+px \d+px 0 rgba|drop-shadow\(\d+px \d+px 0 rgba/.test(B.teaLight[k] + B.teaDark[k] ?? '')));
ok('coffee: one accent, crema #BE7F4A', B.coffeeLight['--accent'].toLowerCase() === '#be7f4a' && B.coffeeLight['--crema'].toLowerCase() === '#be7f4a');
ok('tea: amber #D9A65A, the icon\'s green tile #2E4636', B.teaLight['--accent'].toLowerCase() === '#d9a65a' && B.teaLight['--surface'].toLowerCase() === '#2e4636');
ok('motion tokens on :root: three durations and the easings', ['--dur-1', '--dur-2', '--dur-3', '--ease', '--ease-in-out'].every(k => k in B.root));

// ---- resolving a combination, the way the cascade does ----
const order = (drink, dark) => (drink === 'tea' ? [B.root, B.teaLight, ...(dark ? [B.teaDark] : [])] : [B.root, B.teaLight, B.coffeeLight, ...(dark ? [B.coffeeDark] : [])]);
function tokens(drink, dark){ return Object.assign({}, ...order(drink, dark)); }
const hex = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
function colour(v, T, depth = 0){
  v = String(v).trim();
  if (v === 'transparent') return [0, 0, 0, 0];
  let m;
  if ((m = v.match(/^var\((--[\w-]+)\)$/))) return depth < 8 ? colour(T[m[1]], T, depth + 1) : null;
  if (v.startsWith('#')) return [...hex(v), 1];
  if ((m = v.match(/^rgba?\(([^)]+)\)$/))){ const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  return null;
}
const over = (fg, bg) => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
function ratio(fgName, bgName, T){
  const bg = colour(`var(--${bgName})`, T), fg = colour(`var(--${fgName})`, T);
  if (!bg || !fg) return null;
  const solidBg = bg[3] < 1 ? over(bg, [255, 255, 255, 1]) : bg;
  const f = fg[3] < 1 ? over(fg, solidBg) : fg;
  const a = lum(f), b = lum(solidBg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// [what, fg, [backgrounds], minimum]
const TEXT = 4.5, EDGE = 3;
const PAIRS = [
  ['text', 'ink', ['surface', 'raised', 'input', 'pop'], TEXT], ['text', 'ink-soft', ['surface', 'raised', 'input', 'pop'], TEXT],
  ['label', 'label', ['surface', 'pop', 'input', 'raised'], TEXT], ['text', 'faint', ['surface', 'raised', 'pop'], TEXT],
  ['status', 'ok', ['surface', 'raised'], TEXT], ['status', 'warn', ['surface', 'raised'], TEXT], ['status', 'bad', ['surface', 'raised'], TEXT],
  ['on a filled button', 'on-accent', ['accent'], TEXT], ['on a selected item', 'on-mark', ['mark'], TEXT],
  ['on a status disc', 'on-ink', ['ok', 'warn', 'bad'], TEXT],
  ['toast', 'toast-ink', ['toast-bg'], TEXT], ['tag', 'tag-ink', ['tag-bg'], TEXT],
  ['on the canvas', 'canvas-ink', ['canvas'], TEXT], ['on the canvas', 'canvas-ink-soft', ['canvas'], TEXT], ['on the canvas', 'canvas-label', ['canvas'], TEXT],
  ['the head', 'band-ink', ['band-bg'], TEXT], ['the head', 'band-ink-soft', ['band-bg'], TEXT],
  ['the start screen\'s stage', 'stage-on-mark', ['stage-mark'], TEXT],
  ['the page\'s own paper', 'paper-ink', ['paper'], TEXT], ['the page\'s own paper', 'paper-soft', ['paper'], TEXT],
  ['a tab\'s word', 'tab-ink', ['tab-bg'], TEXT], ['a tab\'s hairline', 'tab-line', ['canvas'], 1.1],
  ['edge of a control', 'line-strong', ['surface', 'input'], EDGE], ['focus ring on a surface', 'focus', ['surface', 'raised', 'pop', 'input'], EDGE], ['focus ring on the canvas', 'canvas-ink', ['canvas'], EDGE], ['focus ring on the page', 'paper-ink', ['paper'], EDGE],
  ['selected mark', 'mark', ['surface'], EDGE], ['the cup / glass outline', 'ink-soft', ['surface'], EDGE],
  ['mark on the page', 'sel-mark', ['paper'], EDGE], ['mark on the page', 'prev-mark', ['paper'], EDGE], ['mark on the page', 'page-warn', ['paper'], EDGE],
];
// the head in coffee is an espresso band: its own edge colour
const EXTRA = { coffee: [['edge of a control in the head', 'foam-soft', ['band-bg'], EDGE], ['focus ring in the head', 'crema', ['band-bg'], EDGE]], tea: [['the cup\'s tea', 'liq', ['surface'], EDGE], ['the cup\'s outline', 'cup-stroke', ['surface'], EDGE], ['tea too full', 'liq-strong', ['surface'], EDGE]] };
const rows = [];
for (const drink of ['tea', 'coffee']) for (const mode of ['light', 'dark']){
  const T = tokens(drink, mode === 'dark');
  const hits = [];
  for (const [what, fg, bgs, min] of [...PAIRS, ...EXTRA[drink]]) for (const bg of bgs){
    // a token that does not exist in this drink (tea has no foam) is skipped
    if (!(`--${fg}` in T) || !(`--${bg}` in T)) continue;
    const r = ratio(fg, bg, T);
    if (r == null){ hits.push({ what, fg, bg, min, r: NaN }); continue; }
    rows.push({ drink, mode, what, fg, bg, min, r });
    hits.push({ what, fg, bg, min, r });
  }
  const bad = hits.filter(x => !(x.r >= x.min));
  ok(`${drink} ${mode}: ${hits.length} pairs, text at 4.5:1 and edges, focus and marks at 3:1`, !bad.length, bad.map(x => `${x.fg} on ${x.bg} ${Number.isNaN(x.r) ? '?' : x.r.toFixed(2)} (< ${x.min})`).join('; '));
}
// ---- UX-5c: the four other teas (Edit is --surface, today's matcha), light and dark: cream ink on every one, the amber labels on the sheet,
// the edge of a control, and each tea's icon on the cream of a closed tab ----
for (const mode of ['light', 'dark']){
  const T = tokens('tea', mode === 'dark');
  const hits = [];
  for (const n of ['outline', 'design', 'export', 'record']){
    const on = [`tea-${n}`, `tea-${n}-raised`, `tea-${n}-input`, `tea-${n}-pop`];
    const pairs = [['ink', on, TEXT], ['ink-soft', on, TEXT], ['faint', [`tea-${n}`, `tea-${n}-raised`, `tea-${n}-pop`], TEXT], ['label', on, TEXT], ['label', [`tea-${n}`], 6], [`tea-${n}-edge`, [`tea-${n}`, `tea-${n}-input`], EDGE],
      ['accent', [`tea-${n}`], EDGE], ['on-accent', ['accent'], TEXT], [`tea-${n}`, ['tab-bg'], EDGE], ['mark', [`tea-${n}`], EDGE], ['focus', [`tea-${n}`, `tea-${n}-raised`], EDGE]];
    for (const [fg, bgs, min] of pairs) for (const bg of bgs){
      const r = ratio(fg, bg, T);
      rows.push({ drink: 'tea', mode, what: `the ${n} tea`, fg, bg, min, r: r ?? NaN });
      hits.push({ n, fg, bg, min, r });
    }
  }
  const bad = hits.filter(x => !(x.r >= x.min));
  ok(`tea ${mode}: the five teas, ${hits.length} pairs: cream ink at 4.5:1, amber labels at 6:1 on the sheet, edges and icons at 3:1${mode === 'dark' ? ' (darkened to 82 percent)' : ''}`, !bad.length, bad.map(x => `${x.n}: ${x.fg} on ${x.bg} ${Number.isNaN(x.r) ? '?' : x.r.toFixed(2)} (< ${x.min})`).join('; '));
}
{
  const dk = (h, k) => hex(h).map(v => Math.round(v * k));
  const L = tokens('tea', false), D = tokens('tea', true);
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1);
  ok('the dark teas are the light ones darkened to 82 percent (the way the matcha is: #2E4636 → #26392d)', ['outline', 'design', 'export', 'record'].every(n => near(hex(D[`--tea-${n}`]), dk(L[`--tea-${n}`], 0.82))) && near(hex(D['--surface']), dk(L['--surface'], 0.82)));
  ok('the teas are the plan\'s: oolong #4d3d1e, rooibos #5c2b22, earl grey #2c3a4f, pu-erh #3b2723, and Edit\'s matcha #2E4636', L['--tea-outline'] === '#4d3d1e' && L['--tea-design'] === '#5c2b22' && L['--tea-export'] === '#2c3a4f' && L['--tea-record'] === '#3b2723' && L['--surface'].toLowerCase() === '#2e4636');
  ok('coffee has no per-tab colours: its tab cards are its own surface, ink and hairline', ['coffeeLight', 'coffeeDark'].every(b => B[b]['--tab-bg'] === 'var(--surface)' && B[b]['--tab-ink'] === 'var(--ink)'));
}

// ---- the page against the canvas: the sharper look is the default and edges the page at 3:1 in all four combinations
// (a light canvas by the page's edge, a dark one by the paper itself); the softer look is the old one and only has to be softer ----
{
  const against = (T, edgeName) => {
    const canvases = ['canvas', ...(('--mat-b' in T && colour('var(--mat-b)', T)?.[3] === 1) ? ['mat-b'] : [])];
    const per = canvases.map(c => Math.max(ratio(edgeName, c, T) ?? 0, ratio('paper', c, T) ?? 0));
    return Math.min(...per);
  };
  for (const drink of ['tea', 'coffee']) for (const mode of ['light', 'dark']){
    const T = tokens(drink, mode === 'dark');
    const sharp = against(T, 'page-edge'), soft = against(T, 'page-edge-soft');
    rows.push({ drink, mode, what: 'the page against the canvas, sharper', fg: 'page-edge or paper', bg: 'canvas', min: EDGE, r: sharp });
    rows.push({ drink, mode, what: 'the page against the canvas, softer', fg: 'page-edge-soft or paper', bg: 'canvas', min: 1, r: soft });
    ok(`${drink} ${mode}: the sharper look separates the page from the canvas at 3:1 (${sharp.toFixed(2)})`, sharp >= EDGE, sharp.toFixed(2));
    ok(`${drink} ${mode}: …and the softer look is never sharper (${soft.toFixed(2)})`, soft <= sharp + 1e-9);
  }
}
if (TABLE){
  // one line per pair, the four combinations side by side
  const by = new Map();
  for (const r of rows){ const k = `${r.fg} on ${r.bg}|${r.min}|${r.what}`; if (!by.has(k)) by.set(k, {}); by.get(k)[`${r.drink} ${r.mode}`] = r.r.toFixed(2); }
  const cols = ['tea light', 'tea dark', 'coffee light', 'coffee dark'];
  console.log(`\n${'pair'.padEnd(34)} ${'needs'.padEnd(5)} ${cols.map(c => c.padStart(12)).join('')}  what`);
  for (const [k, v] of by){ const [pair, min, what] = k.split('|'); console.log(`${pair.padEnd(34)} ${min.padEnd(5)} ${cols.map(c => (v[c] ?? '-').padStart(12)).join('')}  ${what}`); }
}

// ---- no colour written anywhere but a token block ----
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;
function outside(css, label){
  let s = strip(css);
  // the token blocks are the only place a colour may be written (the :root block and the four drink blocks)
  for (const sel of [':root {', ':root, html[data-drink="tea"] {', 'html[data-drink="tea"][data-theme="dark"] {', 'html[data-drink="coffee"] {', 'html[data-drink="coffee"][data-theme="dark"] {']){
    const at = s.indexOf(sel); if (at < 0) continue;
    const end = s.indexOf('\n}', at) + 2;
    s = s.slice(0, at) + s.slice(end);
  }
  // data URIs for masks name no colour; a colour in one would show here
  const found = [...s.matchAll(COLOUR)].map(m => s.slice(Math.max(0, m.index - 40), m.index + 20).replace(/\s+/g, ' '));
  ok(`${label}: no colour outside the token blocks`, !found.length, found.slice(0, 3).join(' | '));
}
outside(wb, 'workbench.css'); outside(dk, 'drinks.css'); outside(st, 'start.css'); outside(fl, 'flow.css');
const sheet = read('src/ui/sheet.js');
ok('sheet.js: the page\'s marks take their colours from tokens (no colour written in the marks)', !COLOUR.test(sheet.slice(sheet.indexOf('const VIEW_CSS'), sheet.indexOf('`;', sheet.indexOf('const VIEW_CSS')))));
ok('no yellow resume accent #ffd900 in the app\'s own styles', !/#ffd900/i.test(strip(wb).replace(/--sample-1:[^;]*;/, '')) && !/#ffd900/i.test(dk));
ok('no system blue and no colour-key stripes on the panel', !/#2563eb|#0f766e|#7c3aed|#6d28d9|#ea580c/i.test(wb + dk) && !/\.body\[data-mode=[^\n]*::before/.test(wb));
ok('the bar meter is gone', !/\.mbar \{[^}]*overflow: hidden/.test(wb) && !/\.mp\b/.test(wb));

// ---- the setting ----
const boot = read('src/ui/drink-boot.js'), drinkJs = read('src/ui/drink.js');
const keysOf = s => [...s.matchAll(/'(rb-(?:drink|theme))'/g)].map(m => m[1]);
ok('drink-boot.js and drink.js read the same two keys, rb-drink and rb-theme', JSON.stringify([...new Set(keysOf(boot))].sort()) === '["rb-drink","rb-theme"]' && JSON.stringify([...new Set(keysOf(drinkJs))].sort()) === '["rb-drink","rb-theme"]');
ok('both set html[data-drink] and html[data-theme]', /data-drink/.test(boot) && /data-theme/.test(boot) && /data-drink/.test(drinkJs) && /data-theme/.test(drinkJs));
ok('the default is tea, following the system', /drink = 'tea'/.test(boot) && /pref = 'system'/.test(boot) && /'tea'\)/.test(drinkJs) && /'system'\)/.test(drinkJs));
const html = read('index.html');
ok('index.html runs drink-boot.js before the first paint: a plain script in the head, before the styles are painted and not deferred', /<script src="src\/ui\/drink-boot\.js"><\/script>/.test(html) && html.indexOf('drink-boot.js') < html.indexOf('</head>'));
ok('index.html loads drinks.css after workbench.css, start.css after both and flow.css last; sw.js caches the new files', html.indexOf('workbench.css') < html.indexOf('drinks.css') && html.indexOf('drinks.css') < html.indexOf('start.css') && html.indexOf('start.css') < html.indexOf('flow.css') && ['drinks.css', 'start.css', 'flow.css', 'drink.js', 'drink-boot.js'].every(f => read('sw.js').includes(f)));
ok('Shift+F switches the drink and is ignored in a field (shell.js asks drink.js)', /isDrinkKey\(e\)/.test(read('src/ui/shell.js')) && /contenteditable/.test(drinkJs));

// ---- the resume is not touched ----
ok('drinks.css and the marks never name the resume\'s own classes (the printed page is drawn in its frame)', !/\.band\b|\.bullets\b|\.entry\b|\.document\b|\.page\b/.test(strip(dk)));

// ---- Fit is filled only when it would change something ----
const dock = read('src/ui/dock.js'), exp = read('src/ui/export.js');
ok('Fit is filled from the pages\' fill in dock.js, and PDF in export.js from the same function, never a :has() rule on the meters', /fitFilled/.test(dock) && /fitFilled/.test(exp) && !/:has\([^)]*\.(?:meter|rmeter)/.test(strip(wb + dk)));
ok('the page meters are drawn by dock.js with the level as --p, and no script copies a width into a variable', /--p:\$\{level\(/.test(dock) && !/style="width:/.test(dock));

process.exit(failed ? 1 : 0);
