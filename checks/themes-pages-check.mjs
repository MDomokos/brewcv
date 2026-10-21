#!/usr/bin/env node
// node checks/themes-pages-check.mjs
// Every built-in look (src/themes.js) on a one-page and a two-page resume, in A4 and Letter, paginated from Chromium's own
// measurements, and held to the rules in docs/THEME-DESIGN-RULES.md that a machine can read:
//   1 a look never changes the paper: B2 Marker's page size, margins of at least MIN_MARGIN, nothing painted within PRINT_EDGE
//     of the paper's edge, no page overflows, no more pages than B2 needs
//   2 a grouped section's label is quieter than its section's: plain text, or a tint lighter than the main tabs, never an outline
//     or underline, and its text reads on what is behind it (4.5:1)
//   3 a label is never louder than a job title
//   4 a page carries at most four marked section labels once the small sections are grouped
// Needs playwright and a Chromium (CHROME_PATH). Writes only under out/, which the measurer cleans up.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import { load, loadResume } from '../src/model/schema.js';
import { setSectionGrouped } from '../src/model/resume.js';
import { contrast, luminance } from '../src/model/tokens.js';
import { THEMES } from '../src/themes.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const clone = x => structuredClone(x);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);

const MAX_MARKED = 4;
const MIN_MARGIN = 36;       // px, about 9.5 mm: the text's margin, clear of any office printer's unprintable edge
const PRINT_EDGE = 24;       // px, ¼ in or 6.35 mm: no ink nearer the edge (most printers lose the outer 3 to 6 mm, some more)
const SMALL = ['certified', 'patent', 'languages', 'interests'];      // the sections the Design view's grouping is for
const { model } = load(read('data/example.json'));
const resumes = read('data/example-resumes/index.json').map(n => loadResume(read(`data/example-resumes/${n}`), model).recipe);
const pick = (limit, format) => clone(resumes.find(r => r.pageLimit === limit && r.format === format && (r.lang ?? 'en') === 'en' && r.sections.some(s => s.id === 'patent')));
const group = r => { for (const id of SMALL) if (r.sections.some(s => s.id === id && s.weight !== 0)) setSectionGrouped(model, r, id, true); return r; };
const letter = r => ({ ...r, format: 'us-letter', photo: { ...(r.photo ?? {}), show: false } });

// What the page says about itself, read in Chromium (no closures: it is sent there).
function probe(){
  const cs = el => getComputedStyle(el), px = v => Math.round(parseFloat(v) * 100) / 100;
  document.documentElement.classList.add('medium-print');      // the printer edge is about paper: a look may bleed on a screen
  return [...document.querySelectorAll('.page')].map(pg => {
    const r = pg.getBoundingClientRect(), p = cs(pg), title = pg.querySelector('.role-title');
    const bands = [...pg.querySelectorAll(':scope > .band')];
    return {
      box: [r.width, r.height, ...['Top', 'Right', 'Bottom', 'Left'].map(s => px(p[`padding${s}`]))].map(px),
      over: px(Math.max(0, ...bands.map(b => b.getBoundingClientRect().bottom)) - (r.bottom - px(p.paddingBottom))),
      paper: p.backgroundColor,
      // the nearest an element with a fill, a border or a shadow comes to the paper's edge (pseudo-elements are not seen)
      ink: Math.min(Infinity, ...[...pg.querySelectorAll('*')].filter(el => { const c = cs(el);
        return !/rgba\(.*, 0\)$|transparent/.test(c.backgroundColor) || c.backgroundImage !== 'none' || c.boxShadow !== 'none'
          || ['Top', 'Right', 'Bottom', 'Left'].some(s => parseFloat(c[`border${s}Width`]) > 0 && c[`border${s}Style`] !== 'none'); })
        .map(el => { const e = el.getBoundingClientRect(); return e.width && e.height ? Math.min(e.left - r.left, r.right - e.right, e.top - r.top, r.bottom - e.bottom) : Infinity; })),
      title: title ? px(cs(title).fontSize) : null,
      tabs: [...pg.querySelectorAll('.band .tab')].map(t => { const c = cs(t); return { sub: !!t.closest('.band--sub'), bg: c.backgroundColor, shadow: c.boxShadow, color: c.color, size: px(c.fontSize) }; }),
    };
  });
}
// rgb(255, 236, 128), or color(srgb 1 0.92 0.5) as Chromium writes a color-mix()
const hex = c => '#' + (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(n => Math.round(+n * (c.startsWith('color(') ? 255 : 1)).toString(16).padStart(2, '0')).join('');
const clear = c => /^rgba\(.*, 0\)$/.test(c) || c === 'transparent';
const marked = t => !t.sub && (!clear(t.bg) || t.shadow !== 'none');

let open;
try { await import('playwright'); ({ openMeasurer: open } = await import('./lib/browser-measure.mjs')); }
catch { console.log('NOT RUN  this check needs playwright and a Chromium on this machine.'); process.exit(1); }

const cases = [
  { name: 'one page, A4', recipe: pick(1, 'a4') },
  { name: 'two pages, A4', recipe: pick(2, 'a4') },
  { name: 'two pages, A4, small sections grouped', recipe: group(pick(2, 'a4')), grouped: true },
  { name: 'two pages, Letter', recipe: letter(pick(2, 'a4')) },
  { name: 'two pages, Letter, small sections grouped', recipe: group(letter(pick(2, 'a4'))), grouped: true },
];
ok('the example has the resumes this needs', cases.every(c => c.recipe) && cases[1].recipe.pageLimit === 2);

const m = await open({ repo: REPO, data: path.join(REPO, 'data/example.json'), port: 8097 });
try {
  const seen = new Map();            // case name → what the first look (B2 Marker) drew
  for (const look of THEMES){
    section(`${look.name} (${look.id})`);
    for (const c of cases){
      const recipe = { ...clone(c.recipe), overlays: look.layers.slice(1) };
      const laid = await m.layout(recipe);
      const pages = await m.inspect(laid, probe);
      const base = seen.get(c.name) ?? (seen.set(c.name, { count: pages.length, pages }), seen.get(c.name));
      const tag = `${c.name}: ${pages.length} page${pages.length === 1 ? '' : 's'}`;
      ok(`${tag}, nothing overflows`, pages.every(p => p.over <= 0.5), pages.map(p => p.over).join(' · '));
      ok(`  no more pages than B2 Marker's ${base.count}`, pages.length <= base.count);
      ok(`  nothing printed within ${PRINT_EDGE}px of the paper's edge`, pages.every(p => p.ink >= PRINT_EDGE - 0.5), pages.map(p => p.ink).join(' · '));
      ok(`  B2 Marker's page size, margins of ${MIN_MARGIN}px or more`, pages.every((p, i) => (!base.pages[i] || eq(p.box.slice(0, 2), base.pages[i].box.slice(0, 2))) && p.box.slice(2).every(m => m >= MIN_MARGIN)), JSON.stringify(pages.map(p => p.box)));
      const tabs = pages.flatMap(p => p.tabs.map(t => ({ ...t, paper: p.paper, title: p.title })));
      const louder = tabs.filter(t => t.title && t.size > t.title);
      ok('  no label is louder than a job title', !louder.length, louder.map(t => `${t.size}px > ${t.title}px`).join(', '));
      const subs = tabs.filter(t => t.sub);
      if (c.grouped){
        // the palest main tab on the pages: a grouped label may be a tint only where the main ones are filled, and paler still
        const main = Math.max(...tabs.filter(t => !t.sub && !clear(t.bg)).map(t => luminance(hex(t.bg))));
        const behind = t => hex(clear(t.bg) ? t.paper : t.bg);
        const quiet = t => t.shadow === 'none' && (clear(t.bg) || luminance(hex(t.bg)) > main + 0.03) && contrast(hex(t.color), behind(t)) >= 4.5;
        ok(`  ${subs.length} grouped labels are quieter than the main ones and read on what is behind them`, subs.length > 0 && subs.every(quiet),
          subs.map(t => `${t.bg} ${t.shadow} ${contrast(hex(t.color), behind(t))?.toFixed(2)}`).join(', '));
        const per = pages.map(p => p.tabs.filter(marked).length);
        ok(`  at most ${MAX_MARKED} marked labels on a page [${per.join(' · ')}]`, per.every(n => n <= MAX_MARKED));
      } else if (look.id === 'marker' && c.name === 'two pages, A4')
        console.log(`      ungrouped, the same pages carry ${pages.map(p => p.tabs.filter(marked).length).join(' · ')} marked labels: what Group under the section above is for`);
    }
  }
} finally { await m.close(); }

console.log(failed ? `\n${failed} themes-pages check(s) FAILED` : '\nall themes-pages checks passed');
process.exit(failed ? 1 : 0);
