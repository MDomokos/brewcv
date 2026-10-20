// The start screen (UX-3), built from the editor's own layout.
//   - the header area: the logo, the name, the tagline; the inspector area: the three ways in, the interface language, "Why JSON?"
//     opening in place; the footer area: the four "Yours to keep" points; and the page area, where the story of how it works plays
//     (src/ui/story.js, from Intro Lab v17): one career file, a page pulled from it, any look, a resume for every job.
// Everything is drawn from tokens (src/ui/start.css). The three ways in change state rather than screens: the grey lines become the
// real page (shell.js).

import { t, h, uiLang } from '../i18n/index.js';
import { icon } from './icons.js';
import { logoBtn } from './drink.js';
import * as story from './story.js';

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
export const headHtml = () => `<div class="obhead"><span class="oblogo">${logoBtn(40, { base: 'oblogobtn' })}<span>BrewCV</span></span>
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
  <div class="obkeep__grid">${TILES.map(([ic, hk, tk]) => `<div class="obtile">${ic}<div><b data-h="${hk}">${h(hk)}</b><p data-h="${tk}"${hk === 'onb.t1h' ? ' data-jr' : ''}>${hk === 'onb.t1h' ? jr(h(tk)) : h(tk)}</p></div></div>`).join('')}</div></section>`;

// ---- the picture: the story (src/ui/story.js) ----
export const { stageHtml, mount, unmount, begin, setStep, replay, act } = story;

// the words change language in place (nothing is drawn again, so the chips stay under the pointer)
export function retext(){
  const lg = uiLang();
  document.querySelectorAll('#head [data-h], #body [data-h], #foot [data-h]').forEach(e => {
    if (e.dataset.lg === lg) return;
    e.dataset.lg = lg;
    const v = h(e.dataset.h);
    e.innerHTML = 'jr' in e.dataset ? jr(v) : v;
  });
  story.retext();
}

const api = { headHtml, bodyHtml, footHtml, stageHtml, mount, unmount, begin, retext, setStep, replay, act, whyJson, jr };
