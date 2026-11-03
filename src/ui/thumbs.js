// Thumbnails for the Resumes screen: a small picture of a resume's first page, from the real renderer. One hidden sheet lays each resume
// out and draws it, one after another; its first page is kept as the text of a small frame (the same stylesheets as the sheet's own), keyed
// by the resume's content and the record it was drawn from, so showing it again costs a frame and no layout (`srcs` has every page, one
// document each). Nothing waits on it: the
// screen is drawn first and each picture arrives when it is ready.

import { createSheet } from './sheet.js';
import { pageSize } from './layout.js';
import { play } from './motion.js';
import { t } from '../i18n/index.js';

let C = null, sheet = null;
const MEDIUM = Symbol('medium');      // what a picture is made for (the Export place's screen, print or pen); never part of the recipe as saved
const cache = new WeakMap();      // the working model → Map(content key → Promise of { src, pages, format })
export const stats = { drawn: 0, shown: 0 };

export function initThumbs(ctx){ C = ctx; return { fill, entry, stats }; }

function hidden(){
  if (sheet) return sheet;
  const host = document.createElement('div');
  host.className = 'thumbhost'; host.setAttribute('aria-hidden', 'true'); host.inert = true;
  document.body.append(host);
  return (sheet = createSheet(host, { extraCss: r => C.extraCss(r, r[MEDIUM]), onPaper: r => r[MEDIUM] === 'print' || r[MEDIUM] === 'pen', chrome: r => C.chrome(r) }));
}

async function draw(work, recipe, medium = 'screen'){
  const s = hidden();
  const { laid, pages: fills } = await s.show(work, medium === 'screen' ? recipe : { ...recipe, [MEDIUM]: medium });
  const doc = s.doc, page = doc.querySelector('.document > .page');
  const head = [...doc.head.querySelectorAll('link[rel=stylesheet], style')].map(e => e.outerHTML).join('');
  stats.drawn++;
  const wrap = html => `<!doctype html><html lang="${recipe.lang ?? 'en'}"${doc.documentElement.classList.contains('medium-print') ? ' class="medium-print"' : ''}><head><base href="${new URL('templates/', document.baseURI).href}">${head}</head><body><div class="document">${html}</div></body></html>`;
  // every page is kept too, one document each, for the readable preview that turns its pages
  return { src: wrap(page?.outerHTML ?? ''), srcs: [...doc.querySelectorAll('.document > .page')].map(p => wrap(p.outerHTML)),
    pages: laid.pages?.length ?? 1, format: recipe.format, laid, fills };
}

// the picture of one resume (a recipe as it prints), for a screen or the paper medium named: from the cache, or drawn
export function entry(recipe, medium = 'screen'){
  const work = C.work();
  const maps = cache.get(work) ?? cache.set(work, new Map()).get(work);
  const key = medium === 'screen' ? JSON.stringify(recipe) : `${medium}|${JSON.stringify(recipe)}`;
  if (!maps.has(key)) maps.set(key, draw(work, recipe, medium).catch(() => null));
  return maps.get(key);
}

// Put the pictures in: every `[data-thumb]` under root is a box whose value names a resume (its first page, or the one `data-page` counts from 0); `recipeOf(name)` is what it prints;
// `onShown(name, entry)` hears of each one that arrived (its page count is in the entry).
export function fill(root, recipeOf, onShown = null){
  for (const slot of root.querySelectorAll('[data-thumb]')){
    const recipe = recipeOf(slot.dataset.thumb);
    if (!recipe) continue;
    entry(recipe).then(e => {
      if (!e || !slot.isConnected) return;
      const { w, h } = pageSize(e.format), f = document.createElement('iframe');
      f.title = t('ux6e.thumb'); f.tabIndex = -1; f.setAttribute('scrolling', 'no'); f.srcdoc = e.srcs?.[slot.dataset.page] ?? e.src;      // data-page: a later page
      f.style.cssText = `width:${w}px;height:${h}px;`;
      new ResizeObserver(() => { f.style.transform = `scale(${slot.clientWidth / w})`; }).observe(slot);   // follows the box when the window is resized
      slot.replaceChildren(f); slot.dataset.pages = String(e.pages); stats.shown++;
      play(f, [{ opacity: 0 }, { opacity: 1 }], { ms: 'fast', name: 'thumb:in' });
      onShown?.(slot.dataset.thumb, e);
    });
  }
}
