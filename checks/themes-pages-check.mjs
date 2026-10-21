#!/usr/bin/env node
// node checks/themes-pages-check.mjs
// Every built-in look (src/themes.js) on a one-page and a two-page resume, in A4 and Letter, paginated from Chromium's own
// measurements, and held to the rules in docs/THEME-DESIGN-RULES.md that a machine can read:
//   1 a look never changes the page: same box, margins and gutter as B2 Marker, no page overflows, no more pages than B2 needs
//   2 a grouped section's label is quiet text (no fill, no outline, no underline) that reads on the paper (4.5:1)
//   3 a label is never louder than a job title
//   4 a page carries at most four marked section labels once the small sections are grouped
// Needs playwright and a Chromium (CHROME_PATH). Writes only under out/, which the measurer cleans up.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as eq } from 'node:util';
import { load, loadResume } from '../src/model/schema.js';
import { setSectionGrouped } from '../src/model/resume.js';
import { contrast } from '../src/model/tokens.js';
import { THEMES } from '../src/themes.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const clone = x => structuredClone(x);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);

const MAX_MARKED = 4;
const SMALL = ['certified', 'patent', 'languages', 'interests'];      // the sections the Design view's grouping is for
const { model } = load(read('data/example.json'));
const resumes = read('data/example-resumes/index.json').map(n => loadResume(read(`data/example-resumes/${n}`), model).recipe);
const pick = (limit, format) => clone(resumes.find(r => r.pageLimit === limit && r.format === format && (r.lang ?? 'en') === 'en' && r.sections.some(s => s.id === 'patent')));
const group = r => { for (const id of SMALL) if (r.sections.some(s => s.id === id && s.weight !== 0)) setSectionGrouped(model, r, id, true); return r; };
const letter = r => ({ ...r, format: 'us-letter', photo: { ...(r.photo ?? {}), show: false } });

// What the page says about itself, read in Chromium (no closures: it is sent there).
function probe(){
  const cs = el => getComputedStyle(el), px = v => Math.round(parseFloat(v) * 100) / 100;
  return [...document.querySelectorAll('.page')].map(pg => {
    const r = pg.getBoundingClientRect(), p = cs(pg), title = pg.querySelector('.role-title');
    const bands = [...pg.querySelectorAll(':scope > .band')];
    return {
      box: [r.width, r.height, ...['Top', 'Right', 'Bottom', 'Left'].map(s => px(p[`padding${s}`]))].map(px),
      gutter: px(cs(pg.querySelector('.band__gutter')).width),
      over: px(Math.max(0, ...bands.map(b => b.getBoundingClientRect().bottom)) - (r.bottom - px(p.paddingBottom))),
      paper: p.backgroundColor,
      title: title ? px(cs(title).fontSize) : null,
      tabs: [...pg.querySelectorAll('.band .tab')].map(t => { const c = cs(t); return { sub: !!t.closest('.band--sub'), bg: c.backgroundColor, shadow: c.boxShadow, color: c.color, size: px(c.fontSize) }; }),
    };
  });
}
const hex = c => '#' + (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(n => Math.round(+n).toString(16).padStart(2, '0')).join('');
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
      ok('  the page box, margins and gutter are B2 Marker\'s', pages.every((p, i) => !base.pages[i] || eq([p.box, p.gutter], [base.pages[i].box, base.pages[i].gutter])), JSON.stringify(pages.map(p => [p.box, p.gutter])));
      const tabs = pages.flatMap(p => p.tabs.map(t => ({ ...t, paper: p.paper, title: p.title })));
      const louder = tabs.filter(t => t.title && t.size > t.title);
      ok('  no label is louder than a job title', !louder.length, louder.map(t => `${t.size}px > ${t.title}px`).join(', '));
      const subs = tabs.filter(t => t.sub);
      if (c.grouped){
        ok(`  ${subs.length} grouped labels are quiet text that reads on the paper`, subs.length > 0 && subs.every(t => clear(t.bg) && t.shadow === 'none' && contrast(hex(t.color), hex(t.paper)) >= 4.5),
          subs.map(t => `${t.bg} ${t.shadow} ${contrast(hex(t.color), hex(t.paper))?.toFixed(2)}`).join(', '));
        const per = pages.map(p => p.tabs.filter(marked).length);
        ok(`  at most ${MAX_MARKED} marked labels on a page [${per.join(' · ')}]`, per.every(n => n <= MAX_MARKED));
      } else if (look.id === 'b2' && c.name === 'two pages, A4')
        console.log(`      ungrouped, the same pages carry ${pages.map(p => p.tabs.filter(marked).length).join(' · ')} marked labels: what Group under the section above is for`);
    }
  }
} finally { await m.close(); }

console.log(failed ? `\n${failed} themes-pages check(s) FAILED` : '\nall themes-pages checks passed');
process.exit(failed ? 1 : 0);
