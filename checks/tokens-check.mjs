#!/usr/bin/env node
// node checks/tokens-check.mjs [--browser]
// Theme tokens (src/model/tokens.js). Node: the accepted forms (CSS, simple JSON, DTCG 2025.10), the
// whitelist, round trips, the built-in token files, and contrast with every accent swatch.
// --browser is the gate: every example resume and theme layer must measure the same to 0.00px with
// b2-marker.css without its token hooks, as it is, and with its own tokens applied on top.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import * as K from '../src/model/tokens.js';
import { BUILT_INS, builtInTokens } from '../scripts/tokens.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const raw = f => fs.readFileSync(path.join(REPO, f), 'utf8');
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);
export const SWATCHES = ['#ffd900', '#7fd1ae', '#9cc3ff', '#ffb08a', '#d6b4ff', '#f4a6c0'];

section('the three forms');
{
  const css = K.parseTheme(`/* theme: Slate */
:root {
  --doc-accent: #9CC3FF;
  --doc-ink: #1b2430;
  --doc-font: Georgia, serif;
  --doc-name-size: 32px;
  --doc-tab-ink: #16150f;
  --doc-evil: url(http://x/y.png);
  --doc-muted: url(http://x/y.png);
  --other: red;
  color: red;
}
.tab { display: none; }
@import "x.css";`);
  ok('CSS: the --doc-* tokens are read, and the name from its comment', css.name === 'Slate' && css.tokens.accent === '#9cc3ff' && css.tokens['font-body'] === 'Georgia, serif' && css.tokens['size-name'] === '32px');
  ok('CSS: everything else is ignored and named', ['--doc-evil', '--doc-muted', '--other'].every(k => css.ignored.some(i => i.key === k)) && css.ignored.some(i => /other rules/.test(i.why)));
  ok('CSS: a url() never gets through', !JSON.stringify(css.tokens).includes('url'));
  const simple = K.parseTheme({ name: 'Slate', tokens: { accent: '#9cc3ff', ink: '#1b2430', font: 'Georgia, serif', bogus: 1, 'size-body': '12px; color: red' } });
  ok('simple JSON: read, with "font" meaning the body font', simple.tokens['font-body'] === 'Georgia, serif' && simple.tokens.ink === '#1b2430');
  ok('simple JSON: unknown and unsafe ones named', simple.ignored.some(i => i.key === 'bogus') && simple.ignored.some(i => i.key === 'size-body'));
  const dtcg = K.parseTheme({
    color: { $type: 'color', accent: { $value: { colorSpace: 'srgb', components: [0.5, 0.8, 0.6], hex: '#80cc99' } }, tab: { $value: '{color.accent}' }, ink: { $value: '#222' }, muted: { $value: '{palette.grey}' } },
    palette: { grey: { $type: 'color', $value: '#555555' }, loop: { $type: 'color', $value: '{palette.loop2}' }, loop2: { $type: 'color', $value: '{palette.loop}' } },
    font: { body: { family: { $type: 'fontFamily', $value: ['Inter', 'sans-serif'] } }, name: { weight: { $type: 'fontWeight', $value: 'black' } } },
    size: { $type: 'dimension', body: { $value: { value: 12.5, unit: 'px' } }, name: { $value: '9999px' } },
    style: { tab: { $type: 'string', $value: 'underline' }, highlight: { $type: 'string', $value: 'glitter' } },
    'line-height': { body: { $type: 'number', $value: 1.5 } },
  }, { fileName: 'Leaf.tokens.json' });
  ok('DTCG: groups, inherited $type, the 2025.10 colour object', dtcg.tokens.accent === '#80cc99' && dtcg.tokens.ink === '#222');
  ok('DTCG: an alias to another token stays a link', dtcg.tokens.tab === '{color.accent}');
  ok('DTCG: an alias to a palette resolves', dtcg.tokens.muted === '#555555');
  ok('DTCG: font family lists, weight keywords, dimensions, numbers', dtcg.tokens['font-body'] === 'Inter, sans-serif' && dtcg.tokens['weight-name'] === '900' && dtcg.tokens['size-body'] === '12.5px' && dtcg.tokens['line-height-body'] === '1.5');
  ok('DTCG: a switch, and a bad switch value named', dtcg.tokens['tab-style'] === 'underline' && dtcg.ignored.some(i => i.key === 'style.highlight'));
  ok('DTCG: absurd sizes and palette entries are not tokens', !dtcg.tokens['size-name'] && dtcg.ignored.some(i => i.key === 'size.name') && dtcg.ignored.some(i => i.key === 'palette.grey'));
  ok('DTCG: the name comes from the file when it has none', dtcg.name === 'Leaf');
  ok('broken JSON is reported, not thrown', K.parseTheme('{ "tokens": ').form === 'error');
}

section('values');
{
  const bad = ['url(x)', 'red; background: url(x)', 'expression(alert(1))', '<script>', 'javascript:alert(1)', '#ggg', '{x}'];
  ok('unsafe colours are refused', bad.every(v => K.cssValue('color', v) === null));
  ok('unsafe font families are refused', ['Arial; } body { display:none', 'url(x)', '<b>'].every(v => K.cssValue('fontFamily', v) === null));
  ok('a font name with a space is quoted', K.cssValue('fontFamily', 'Source Serif 4, serif') === '"Source Serif 4", serif');
  ok('a font this app has no files for is flagged', K.unknownFonts('"Source Serif 4", serif').length === 1 && K.unknownFonts('Georgia, serif').length === 0);
  ok('…and falls back to the default family, visibly', /"Source Serif 4", serif, "Hanken Grotesk"/.test(K.toCss({ 'font-body': '"Source Serif 4", serif' })));
  const css = K.toCss({ accent: '#7fd1ae', tab: '{color.accent}', margin: '40px', 'tab-style': 'none', 'highlight-style': 'bold' });
  ok('toCss: one :root block, aliases as var()', /^:root \{ --accent: #7fd1ae; --tab-fill: var\(--accent\); --page-pad-t: 40px;/.test(css));
  ok('toCss: the switches add their rules', /\.tab \{ background: none/.test(css) && /\.mark \{ background: none !important; font-weight/.test(css));
  ok('toCss: nothing for no tokens', K.toCss({}) === '');
}

section('DTCG round trip');
{
  const t = { accent: '#7fd1ae', tab: '{color.accent}', ink: '#1b2430', 'font-body': '"Source Serif 4", serif', 'weight-name': '800', 'size-body': '12.5px', 'tracking-label': '0.1em', 'line-height-body': '1.5', 'tab-style': 'outline', 'highlight-style': 'marker' };
  const d = K.serialize('Round', t);
  const back = K.parseTheme(JSON.parse(JSON.stringify(d)));
  ok('serialize → parse gives the same tokens back', eq(back.tokens, t), JSON.stringify(back.tokens));
  ok('every token has its $type', JSON.stringify(d).match(/"\$value"/g).length === JSON.stringify(d).match(/"\$type"/g).length);
  ok('colours are 2025.10 objects with hex', d.color.accent.$value.colorSpace === 'srgb' && d.color.accent.$value.hex === '#7fd1ae');
  const asCss = v => (K.aliasOf(v) ? `var(--doc-${K.TOKENS.find(x => x.path === K.aliasOf(v)).name})` : v);
  const viaCss = K.parseTheme(`:root { ${Object.entries(t).filter(([k]) => !k.endsWith('style')).map(([k, v]) => `--doc-${k}: ${asCss(v)};`).join(' ')} }`);
  ok('CSS ↔ DTCG parity: the same theme written as CSS reads the same', eq(viaCss.tokens, Object.fromEntries(Object.entries(t).filter(([k]) => !k.endsWith('style')))));
}

section('the built-in themes as tokens');
for (const b of BUILT_INS){
  const file = `themes/${b.id}.tokens.json`;
  ok(`${file} exists and is up to date`, fs.existsSync(path.join(REPO, file)) && raw(file) === JSON.stringify(K.serialize(b.name, builtInTokens(b)), null, 2) + '\n');
  const p = K.parseTheme(JSON.parse(raw(file)));
  ok(`${b.id}: reads back with nothing ignored`, p.ignored.length === 0 && eq(p.tokens, builtInTokens(b)), JSON.stringify(p.ignored));
}
ok('b2-marker: tabs follow the accent (an alias, not a copy)', builtInTokens(BUILT_INS[0]).tab === '{color.accent}');

section('contrast: every built-in theme with every accent swatch');
{
  const rows = [];
  for (const b of BUILT_INS){
    const t = builtInTokens(b);
    const ink = t['tab-ink'] ?? t.ink;
    for (const a of SWATCHES){
      const tab = K.aliasOf(t.tab) ? a : t.tab;
      if (tab === 'transparent') continue;                  // print-mono: tabs are outlines, ink on paper
      const c = K.contrast(tab, ink);
      rows.push([b.id, a, c]);
    }
    const meta = K.contrast(t.meta, t.page);
    if (b.id === 'contrast-aa') ok('contrast-aa: metadata on paper is AA', meta >= 4.5, meta.toFixed(2));
  }
  const fails = rows.filter(r => r[2] < 4.5);
  ok(`tab text on every accent is AA (${rows.length} pairs)`, !fails.length, fails.map(f => `${f[0]} ${f[1]} ${f[2].toFixed(2)}`).join(', '));
  ok('accentCheck says when an accent would fail', !K.accentCheck('#333333').ok && K.accentCheck('#ffd900').ok);
}

// b2-marker.css with its token hooks taken out
export function revertHooks(css){
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\n  font-family: var\(--font-(?:name|heading), var\(--font-sans\)\);/g, '')
    .replace(/\n  border-radius: var\(--tab-radius, 0\);/g, '')
    .replace(/var\(--weight-name, (var\(--fw-black\))\)/g, '$1')
    .replace(/var\(--weight-heading, (var\(--fw-bold\))\)/g, '$1')
    .replace(/var\(--tab-ink, (var\(--ink\))\)/g, '$1');
}
ok('taking the hooks out of b2-marker.css gives back what it was', !/--font-name|--font-heading|--weight-name|--weight-heading|--tab-ink|--tab-radius/.test(revertHooks(raw('themes/b2-marker.css'))));

if (process.argv.includes('--browser')){
  section('the gate: 0.00px (Chromium)');
  const { chromium } = await import('playwright');
  const S = await import('../src/model/schema.js');
  const { renderPages } = await import('../src/render.js');
  const { createDocument } = await import('../scripts/lib/dom.mjs');
  const { flowRecipe } = await import('../src/paginate.js');
  const browser = await chromium.launch();
  const model = S.load(JSON.parse(raw('data/example.json'))).model;
  const names = JSON.parse(raw('data/example-resumes/index.json'));
  const b2now = raw('themes/b2-marker.css');
  const b2before = revertHooks(b2now);
  const formats = { 'us-letter': raw('formats/us-letter.css'), a4: raw('formats/a4.css'), 'a4-hu': raw('formats/a4.css') + raw('formats/a4-hu.css') };
  const fontFace = css => css.replace(/url\("\.\.\/fonts\/([^"]+)"\)/g, (_, f) => `url("data:font/woff2;base64,${fs.readFileSync(path.join(REPO, 'fonts', f)).toString('base64')}")`);
  const page = await browser.newPage({ viewport: { width: 900, height: 1300 } });
  const measure = async (html, css) => {
    await page.setContent(`<!doctype html><html><head><style>${fontFace(css)}</style></head><body><div class="document">${html}</div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    return page.evaluate(() => [...document.querySelectorAll('.document *')].map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(n => +n.toFixed(2)).join(','); }));
  };
  let worst = 0, runs = 0;
  for (const n of names){
    const r = S.loadResume(JSON.parse(raw(`data/example-resumes/${n}`)), model).recipe;
    const html = renderPages(model, flowRecipe(model, r), createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('');
    for (const b of BUILT_INS){
      const layers = b.layers.slice(1).map(l => raw(`themes/${l}.css`)).join('\n');
      const base = formats[r.format] ?? formats.a4;
      const before = await measure(html, base + b2before + layers);
      const now = await measure(html, base + b2now + layers);
      const asTokens = await measure(html, base + b2now + layers + K.toCss(builtInTokens(b)));
      runs++;
      const diff = (a, c) => a.length !== c.length ? Infinity : Math.max(0, ...a.map((x, i) => Math.max(...x.split(',').map((v, j) => Math.abs(v - c[i].split(',')[j])))));
      const d = Math.max(diff(before, now), diff(now, asTokens));
      worst = Math.max(worst, d);
      if (d > 0) ok(`${n} · ${b.id}`, false, `${d.toFixed(2)}px`);
    }
  }
  ok(`${runs} resume × theme pairs: before theme tokens, now, and now as tokens measure the same`, worst === 0, `${worst.toFixed(2)}px`);
  await browser.close();
}

console.log(failed ? `\n${failed} token check(s) FAILED` : '\nall token checks passed');
process.exit(failed ? 1 : 0);
