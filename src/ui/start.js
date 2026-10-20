// The start screen (UX-3), built from the editor's own layout.
//   - the header area: the logo, the name, the tagline; the inspector area: the three ways in, the interface language, "Why JSON?"
//     opening in place; the footer area: the four "Yours to keep" points; and the page area, where the story of how it works plays
//     (src/ui/story.js, from Intro Lab v17): one career file, a page pulled from it, any look, a resume for every job.
// Everything is drawn from tokens (src/ui/start.css). The three ways in change state rather than screens: the grey lines become the
// real page (shell.js).

import { t, h, uiLang } from '../i18n/index.js';
import { icon } from './icons.js';
import { logoBtn, drink, themePref, resolveTheme } from './drink.js';
import * as story from './story.js';

// ?intro=left puts the column on the left, ?intro=right (the default) on the right
document.body.dataset.introSide = new URLSearchParams(location.search).get('intro') === 'left' ? 'left' : 'right';
let C = null;
export function initStart(ctx){ C = ctx; return api; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// "JSON Resume" (also spelled JSON-Resume) links to the schema wherever it is named
export const jr = html => html.replace(/JSON[- ]Resume/, m => `<a class="oblink" href="https://jsonresume.org/schema" target="_blank" rel="noopener noreferrer">${m}</a>`);

// ---- the words ----
const ICON = d => `<svg class="obico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const TILES = [
  [ICON('<path d="M8 4C5 4 5 6 5 8v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 0 4 3 4M16 4c3 0 3 2 3 4v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2 0 4-3 4"/>'), 'onb.t1h', 'onb.t1'],
  [ICON('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'), 'onb.t2h', 'onb.t2'],
  [ICON('<path d="M4 9a12 12 0 0 1 16 0M7 12.5a8 8 0 0 1 10 0M10 16a4 4 0 0 1 4 0"/><circle cx="12" cy="19" r="1"/><path d="M4 4l16 16"/>'), 'onb.t3h', 'onb.t3'],
  [ICON('<path d="M12 4v10m0 0-4-4m4 4 4-4M5 19h14"/>'), 'onb.t4h', 'onb.t4'],
];

export function whyJson(){
  return `<details class="obwhy"><summary data-h="onb.whyJson">${h('onb.whyJson')}</summary>
    <ul>${['onb.why1', 'onb.why2', 'onb.why3', 'onb.why4'].map(k => `<li data-h="${k}"${k === 'onb.why3' ? ' data-jr' : ''}>${k === 'onb.why3' ? jr(h(k)) : h(k)}</li>`).join('')}</ul>
    <a href="https://stephango.com/file-over-app" target="_blank" rel="noopener noreferrer"><span data-h="onb.whyLink">${h('onb.whyLink')}</span> ${icon('external', { size: 12 })}</a></details>`;
}

// ---- the header area, the inspector area, the footer area ----
// the two cups are the Tea and Coffee switch, the sun and moon the light and dark one; the logo keeps asking about the drink too
const CUPS = {
  tea: '<path d="M3.5 10.5h13v1.5a6.5 6.5 0 0 1-13 0z"/><path d="M16.5 12h1.4a2.4 2.4 0 0 1 0 4.8h-2"/><path d="M2.5 21h15"/><path d="M7 3.2c-.9 1 .9 2 0 3.2M11 3.2c-.9 1 .9 2 0 3.2"/><path class="liq" d="M3.5 10.5h13v1.5H3.5z"/>',
  coffee: '<path d="M4.5 8h11v8.5a3.5 3.5 0 0 1-3.5 3.5H8a3.5 3.5 0 0 1-3.5-3.5z"/><path d="M15.5 10.2h1.2a2.8 2.8 0 0 1 0 5.6h-1.2"/><path d="M7.5 2.5c-.9 1 .9 2 0 3.2M11.5 2.5c-.9 1 .9 2 0 3.2"/><path class="liq" d="M4.5 8h11v3h-11z"/>',
};
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>';
const MOON = '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>';
const glyph = (d, cls = '') => `<svg class="obic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const cup = (d, key) => `<button type="button" class="obcup" data-act="drink-set" data-m="${d}" data-ht="${key}" title="${esc(t(key))}" aria-label="${esc(t(key))}" aria-pressed="${drink() === d}">${glyph(CUPS[d])}</button>`;

export const headHtml = () => `<div class="obhead"><div class="obrow"><span class="oblogo">${logoBtn(42, { base: 'oblogobtn' })}<span>BrewCV</span></span>
  <div class="obswitch"><div class="obcups" role="group" data-hl="intro.drinks" aria-label="${esc(t('intro.drinks'))}">${cup('tea', 'm11.tea')}${cup('coffee', 'm11.coffee')}</div>
    <button type="button" class="obsun" data-act="theme-toggle" data-ht="intro.dark" title="${esc(t('intro.dark'))}" aria-label="${esc(t('intro.dark'))}" aria-pressed="${resolveTheme(themePref()) === 'dark'}">${glyph(SUN, 'sun')}${glyph(MOON, 'moon')}</button></div></div>
  <h2 class="obhero" data-h="onb.hero">${h('onb.hero')}</h2><p class="obsub" data-h="onb.intro">${h('onb.intro')}</p></div>`;

export function bodyHtml({ langs, current }){
  return `<div class="obstart">
    <div class="obchoices">
      <button class="primary" data-act="ob-scratch"><b data-h="onb.scratch">${h('onb.scratch')}</b><small data-h="onb.scratchNote">${h('onb.scratchNote')}</small></button>
      <button data-act="ob-import"><b data-h="onb.import">${h('onb.import')}</b><small data-h="onb.importNote">${h('onb.importNote')}</small></button>
      <button data-act="ob-example"><b data-h="onb.example">${h('onb.example')}</b><small data-h="onb.exampleNote">${h('onb.exampleNote')}</small></button>
    </div>
    <ul class="oblangs" aria-label="${esc(t('ux3.startLangs'))}">${langs.map(([l, name]) => `<li><button lang="${l}" class="oblang${l === current ? ' on' : ''}" data-act="ob-intro-lang" data-l="${l}" aria-pressed="${l === current}" aria-label="${esc(name)}" title="${esc(name)}">${l.toUpperCase()}</button></li>`).join('')}</ul>
    ${whyJson()}</div>`;
}

export const footHtml = () => `<section class="obkeep"><h3 class="obeye" data-h="onb.keepHead">${h('onb.keepHead')}</h3>
  <div class="obkeep__grid">${TILES.map(([ic, hk, tk]) => `<div class="obtile">${ic}<p><b data-h="${hk}">${h(hk)}</b> <span data-h="${tk}"${hk === 'onb.t1h' ? ' data-jr' : ''}>${hk === 'onb.t1h' ? jr(h(tk)) : h(tk)}</span></p></div>`).join('')}</div></section>`;

// ---- the picture: the story (src/ui/story.js) ----
export const { stageHtml, mount, unmount, begin, setStep, replay, act, current } = story;

// the words change language in place (nothing is drawn again, so the chips stay under the pointer)
export function retext(){
  const lg = uiLang();
  document.querySelectorAll('#head [data-h], #body [data-h], #foot [data-h]').forEach(e => {
    if (e.dataset.lg === lg) return;
    e.dataset.lg = lg;
    const v = h(e.dataset.h);
    e.innerHTML = 'jr' in e.dataset ? jr(v) : v;
  });
  // a hint or a name for the screen reader, on a control that has no words of its own
  document.querySelectorAll('#head [data-ht], #body [data-ht], #foot [data-ht], #head [data-hl]').forEach(e => {
    if (e.dataset.lg === lg) return;
    e.dataset.lg = lg;
    const v = t(e.dataset.ht ?? e.dataset.hl);
    if (e.dataset.ht) e.title = v;
    if (e.hasAttribute('aria-label')) e.setAttribute('aria-label', v);
  });
  story.retext();
}

const api = { headHtml, bodyHtml, footHtml, stageHtml, mount, unmount, begin, retext, setStep, replay, act, whyJson, jr };
