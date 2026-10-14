#!/usr/bin/env node
// node checks/motion-check.mjs
// UX-4, motion that explains: the rules every moment follows, checked in Node. The moments themselves (what each one starts, that
// nothing starts under reduced motion, that the page that prints is the same) are in checks/smoke-shell.mjs, the "motion:" section.
//   - the tokens: 150 to 400 ms, an ease-out for arriving and an ease-in for leaving, on :root, tuned in one place
//   - one rule for reduced motion (the system's, and the Reduce motion setting), and nothing else asks the system on its own
//   - never blocks: a new animation under the same key replaces the last; with motion off, play() starts nothing
//   - no animation library, no hard-coded durations in the moments; the page's render never imported by the moments
//   - the thirteen moments are each wired, the logo has its two tiles, and every string is in the catalogues

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);

const css = read('src/ui/workbench.css');
const UI = fs.readdirSync(path.join(ROOT, 'src/ui')).filter(f => f.endsWith('.js'));
const src = Object.fromEntries(UI.map(f => [f, read(`src/ui/${f}`)]));
const MOMENTS = ['motion.js', 'pagemotion.js', 'arrive.js', 'matroll.js', 'exportfx.js'];

section('the tokens');
{
  const tok = n => { const m = css.match(new RegExp(`--${n}:\\s*([^;]+);`)); return m ? m[1].trim() : null; };
  const ms = n => parseFloat(tok(n));
  ok('--m-fast, --m-base, --m-slow and --m-travel are on :root, each 150 to 400 ms', ['m-fast', 'm-base', 'm-slow', 'm-travel'].every(n => /ms$/.test(tok(n) ?? '') && ms(n) >= 150 && ms(n) <= 400), ['m-fast', 'm-base', 'm-slow', 'm-travel'].map(tok).join());
  ok('they rise: fast < base < slow', ms('m-fast') < ms('m-base') && ms('m-base') < ms('m-slow'));
  ok('--m-out (arriving) and --m-in (leaving) are different curves: out decelerates, in accelerates', /cubic-bezier\(\.2, \.8, \.2, 1\)/.test(tok('m-out') ?? '') && /cubic-bezier\(\.4, 0, 1, 1\)/.test(tok('m-in') ?? ''));
  ok('the tokens are in the first :root block, so one edit tunes them all', css.indexOf('--m-fast') > 0 && css.indexOf('--m-fast') < css.indexOf('/* ---- Tea, light'));
  ok('the Fit stagger fits its budget: under 600 ms in all', Number(src['pagemotion.js'].match(/FIT_BUDGET = (\d+)/)?.[1]) <= 600);
}

section('reduced motion: one rule');
{
  ok('html[data-motion="reduce"] stops every animation and transition in the app', /html\[data-motion="reduce"\] \*[^{]*\{[^}]*animation: none !important; transition: none !important/.test(css));
  ok('motion.js sets it from the system’s wish and from the setting', /prefers-reduced-motion: reduce/.test(src['motion.js']) && /rb-reduce-motion/.test(src['motion.js']) && /setAttribute\('data-motion'/.test(src['motion.js']));
  const own = UI.filter(f => f !== 'motion.js' && /matchMedia\(['"]\(prefers-reduced-motion/.test(src[f]));
  ok('nothing else in src/ui asks the system on its own (the canvas, the Record tab, the start screen and the garden all ask motion.js)', !own.length, own.join());
  ok('the canvas takes its ease from --m-travel and the shared rule (write mode zoom in and out, UX-3)', /dur\('travel'\)/.test(src['canvas.js']) && /from '\.\/motion\.js'/.test(src['canvas.js']) && !/EASE_MS/.test(src['canvas.js']));
  ok('the page’s frame follows it too (sheet.js copies the tokens and the rule across)', /rb-still/.test(src['sheet.js']) && /--rb-m-base/.test(src['sheet.js']));
  ok('the Reduce motion setting is in Settings, per browser', /data-reduce-motion/.test(src['settings.js']) && /setReduce/.test(src['settings.js']));
  const cssFiles = ['workbench.css', 'drinks.css', 'start.css'].map(f => read(`src/ui/${f}`)).join('\n');
  ok('the CSS animations of UX-4 (the overflow edge, the roll, the logo) are inside the blanket rule, none opts out of it', !/data-motion="full"/.test(cssFiles) && /ovIn/.test(cssFiles));
}

section('never blocks, nothing left behind');
{
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const M = await import('../src/ui/motion.js');
  const el = () => { const log = []; return { log, animate: (kf, o) => { const a = { kf, o, cancelled: false, cancel(){ this.cancelled = true; }, addEventListener(){}, finished: Promise.resolve() }; log.push(a); return a; } }; };
  const e = el();
  const a1 = M.play(e, [{ opacity: 0 }, { opacity: 1 }], { key: 'k', name: 'one' });
  const a2 = M.play(e, [{ opacity: 0 }, { opacity: 1 }], { key: 'k', name: 'two' });
  ok('motion on: play() starts the animation, with the token’s duration and no fill', !!a1 && a1.o.duration === 240 && a1.o.fill === 'none');
  ok('a new action under the same key cancels the one under way (it retargets; nothing queues)', a1.cancelled === true && a2.cancelled === false);
  ok('a different key runs alongside', (() => { const b = M.play(e, [{ opacity: 0 }], { key: 'other' }); return b && !a2.cancelled; })());
  M.setReduce(true);
  const before = e.log.length;
  ok('the setting on: play() starts nothing and says so (null), whatever the system says', M.reduced() && M.play(e, [{ opacity: 0 }], { name: 'x' }) === null && e.log.length === before);
  ok('…and turning it on cancelled what was running', a2.cancelled === true);
  ok('…the setting is remembered', store.get('rb-reduce-motion') === '1');
  M.setReduce(false);
  ok('turned off again, motion is back', !M.reduced() && !!M.play(e, [{ opacity: 0 }]));
  ok('dur() and ease() read the tokens, with the same values as fallback in Node', M.dur('fast') === 150 && M.dur('slow') === 400 && M.dur('travel') === 300 && /cubic-bezier/.test(M.ease('arrive')) && /cubic-bezier/.test(M.ease('leave')));
}

section('no library, no hard-coded times, the page untouched');
{
  const pkg = JSON.parse(read('package.json'));
  ok('no animation library: no dependency of any kind, and no import of one', !Object.keys(pkg.dependencies ?? {}).length && !UI.some(f => /from ['"](gsap|animejs?|motion|framer-motion|velocity|popmotion|@react-spring)/.test(src[f])));
  const literal = MOMENTS.filter(f => /\b(?:ms|duration):\s*\d/.test(src[f]));
  ok('the moments take their times from the tokens: no ms: 300 or duration: 200 in the new modules', !literal.length, literal.join());
  const bad = MOMENTS.filter(f => /import[^;]*\b(?:render|store|persist|schema|resume)\.js/.test(src[f].replace(/import[^;]*record\.js[^;]*;/g, '')));
  ok('what animates never imports the renderer, the store or the record’s edits: it cannot change what prints', !bad.length, bad.join());
  const pm = src['pagemotion.js'];
  ok('pagemotion.js touches the page only with Web Animations, one data attribute it takes away again, and clones in #rb-ghosts (the only text it writes is into a clone or an overlay word)', /rb-ghosts/.test(pm) && /removeAttribute\('data-rb-hid'\)/.test(pm) && (pm.match(/\.textContent\s*=/g) ?? []).length === 1 && (pm.match(/\.innerHTML\s*=/g) ?? []).length === 2 && /s\.textContent = w\.text/.test(pm) && /g\.innerHTML = b\.html/.test(pm) && /old\.innerHTML = snap\.html/.test(pm));
  ok('the layers (the motion layer, the mat) take no pointer events', /\.motionlay \{[^}]*pointer-events: none/.test(css) && /\.matroll \{[^}]*pointer-events: none/.test(read('src/ui/drinks.css')));
}

section('the thirteen moments are wired');
{
  const has = (f, re) => re.test(src[f]);
  const all = Object.values(src).join('\n');
  const rows = [
    [1, 'Fit: swapped lines crossfade in turn, dropped ones fold, the meter fills, a chip with Undo', has('pagemotion.js', /kind === 'fit'/) && has('shell.js', /ux4\.chipShorter/) && has('shell.js', /chip-undo/) && has('dock.js', /name: 'meter'/)],
    [2, 'Hovering a version: the words move (one word diff in src/model, the one the inspector underlines)', has('pagemotion.js', /wordMoves/) && has('shell.js', /words: factId/) && /export function wordMoves/.test(read('src/model/record.js')) && /R\.wordDiff/.test(read('src/ui/parts.js'))],
    [3, 'The lens brightens its lines; Apply slides joining lines in and folds leaving ones away', has('sheet.js', /lens:hit/) && has('edit.js', /kind: 'apply'/) && has('pagemotion.js', /:join|\$\{kind\}:join/)],
    [4, 'A tick in the checklist: the line travels to the page and back; the one-line hint is gone', has('checklist.js', /tick:land/) && has('checklist.js', /tick:back/) && has('checklist.js', /tick:sample/) && !/clhint/.test(css) && !has('checklist.js', /ux2\.hint/)],
    [5, 'Write mode: the zoom uses the shared tokens and the reduced-motion rule', has('canvas.js', /dur\('travel'\)/) && has('canvas.js', /reduced/)],
    [6, 'A snapshot drops a small page into the name, and "Sent to" appears under it', has('shell.js', /snapshot:drop/) && has('shell.js', /snapshot:line/) && has('shell.js', /ux1\.sentTo2/) && has('resumes.js', /snapshotTaken/)],
    [7, 'Save as new version: the row slides into the list', has('edit.js', /version:in/)],
    [8, 'Overflow: the dashed edge fades in', /\.ov \{[^}]*animation: ovIn/.test(css)],
    [9, 'Switching resume: the page crossfades, the name slides', has('pagemotion.js', /export function crossfade/) && has('shell.js', /switch:name/) && has('resumes.js', /kind: 'switch'/)],
    [10, 'Start screen to editor: lines are written in, the controls come in', has('arrive.js', /fromStart/) && has('pagemotion.js', /export function reveal/) && has('shell.js', /arrive\.fromStart/)],
    [11, 'Onboarding to Start editing: the header, footer, rail and zoom bar slide in', has('arrive.js', /fromQuiet/) && has('shell.js', /arrive\.fromQuiet/) && !has('onboarding.js', /fade-in/)],
    [12, 'Tea and Coffee by the logo: its own tile, a hint, the mat rolls up and unrolls', has('drink.js', /export function logoBtn/) && has('matroll.js', /mat:\$\{el\.dataset\.kind\}/) && has('shell.js', /drink-switch/) && /\.roller/.test(read('src/ui/drinks.css'))],
    [13, 'An export has a picture in each drink', has('exportfx.js', /async function tea/) && has('exportfx.js', /async function coffee/) && has('export.js', /exportFx/)],
  ];
  for (const [n, name, pass] of rows) ok(`${n}. ${name}`, !!pass);
  ok('no moment starts a loop: an animation is played once (iterations are never set)', !/iterations|infinite/.test(MOMENTS.map(f => src[f]).join('\n') + css.slice(css.indexOf('UX-4'))));
  ok('the new modules are preloaded and cached', MOMENTS.every(f => read('index.html').includes(`src/ui/${f}`) && read('sw.js').includes(`./src/ui/${f}`)));
  void all;
}

section('the logo has two tiles');
{
  const tea = read('icons/icon.svg'), cof = read('icons/icon-coffee.svg');
  ok('icon-coffee.svg is the same shape as the tea tile: same size, same corner, the same C and V', /viewBox="0 0 512 512"/.test(cof) && /rx="114"/.test(cof) && cof.includes('M168 168 L268 392 L368 168') && tea.includes('M168 168 L268 392 L368 168'));
  ok('…in the coffee palette (espresso and crema), and clean: no metadata, no script, no link', /#3A2618/i.test(cof) && /#BE7F4A/i.test(cof) && !/<metadata|c2pa|jumbf|xmp|<script|href=/i.test(cof));
  ok('drink.js picks the tile by the drink; the service worker caches both', /icon-coffee/.test(src['drink.js']) && read('sw.js').includes('./icons/icon-coffee.svg') && read('sw.js').includes('./icons/icon.svg'));
  ok('the head and the start screen draw the logo through logoBtn, never a bare img of their own', ['shell.js', 'start.js'].every(f => /logoBtn\(/.test(src[f]) && !/<img src="icons\/icon\.svg"/.test(src[f])));
}

section('switching Tea and Coffee');
{
  ok('colours fade and corners, edges and shadows morph while a switch settles (html.is-switching, dur(slow), not under reduced motion)', /html\.is-switching[^{]*\{[^}]*background-color[^}]*border-radius[^}]*box-shadow/.test(read('src/ui/drinks.css')) && /is-switching/.test(src['drink.js']) && /!reduced\(\)/.test(src['drink.js']));
}

section('every string is in the catalogues');
{
  const used = new Set();
  for (const f of UI) for (const m of src[f].matchAll(/['"`](ux4\.[A-Za-z0-9.]+)['"`]/g)) used.add(m[1]);
  for (const m of src['drink.js'].matchAll(/`\$\{k\}Tip`/g)) void m;
  const keys = [...used, 'ux4.logoToCoffeeTip', 'ux4.logoToTeaTip'];
  const langs = ['en', 'de', 'es', 'fr', 'hu', 'it', 'nl', 'pl', 'pt', 'cs'];
  const miss = [];
  for (const l of langs){ const text = read(`src/i18n/${l}.js`); for (const k of new Set(keys)) if (!text.includes(`'${k}'`)) miss.push(`${l}:${k}`); }
  ok('the ux4. block (the Fit chip, the setting, the logo hints, the export ticket) is in all ten', !miss.length, miss.join());
  const en = read('src/i18n/en.js');
  ok('English has no leftover from the retired hint (ux2.hint, ux2.hintOk)', !/'ux2\.hint(Ok)?'/.test(en));
  ok('the ux4. keys are one contiguous block in each catalogue (a later block may follow it)', langs.every(l => { const lines = read(`src/i18n/${l}.js`).trimEnd().split('\n'); const at = lines.findIndex(x => x.includes("'ux4."), 0); let end = at; while (lines[end]?.includes("'ux4.")) end++; return at > 0 && !lines.slice(end).some(x => x.includes("'ux4.")) && lines.at(-1) === '};'; }));
}

console.log(failed ? `\n${failed} motion check(s) FAILED` : '\nall motion checks passed');
process.exit(failed ? 1 : 0);
