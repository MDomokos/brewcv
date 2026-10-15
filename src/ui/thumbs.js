// Thumbnails for the Resumes screen: a small picture of a resume's first page, from the real renderer. One hidden sheet lays each resume
// out and draws it, one after another; its first page is kept as the text of a small frame (the same stylesheets as the sheet's own), keyed
// by the resume's content and the record it was drawn from, so showing it again costs a frame and no layout. Nothing waits on it: the
// screen is drawn first and each picture arrives when it is ready.

import { createSheet } from './sheet.js';
import { pageSize } from './layout.js';
import { play } from './motion.js';
import { t } from '../i18n/index.js';

let C = null, sheet = null;
const cache = new WeakMap();      // the working model → Map(content key → Promise of { src, pages, format })
export const stats = { drawn: 0, shown: 0 };

export function initThumbs(ctx){ C = ctx; return { fill, entry, stats }; }

function hidden(){
  if (sheet) return sheet;
  const host = document.createElement('div');
  host.className = 'thumbhost'; host.setAttribute('aria-hidden', 'true'); host.inert = true;
  document.body.append(host);
  return (sheet = createSheet(host, { extraCss: r => C.extraCss(r), chrome: r => C.chrome(r) }));
}

async function draw(work, recipe){
  const s = hidden();
  const { laid } = await s.show(work, recipe);
  const doc = s.doc, page = doc.querySelector('.document > .page');
  const head = [...doc.head.querySelectorAll('link[rel=stylesheet], style')].map(e => e.outerHTML).join('');
  stats.drawn++;
  return { src: `<!doctype html><html lang="${recipe.lang ?? 'en'}"><head><base href="${new URL('templates/', document.baseURI).href}">${head}</head><body><div class="document">${page?.outerHTML ?? ''}</div></body></html>`,
    pages: laid.pages?.length ?? 1, format: recipe.format };
}

// the picture of one resume (a recipe as it prints): from the cache, or drawn
export function entry(recipe){
  const work = C.work();
  const maps = cache.get(work) ?? cache.set(work, new Map()).get(work);
  const key = JSON.stringify(recipe);
  if (!maps.has(key)) maps.set(key, draw(work, recipe).catch(() => null));
  return maps.get(key);
}

// Put the pictures in: every `[data-thumb]` under root is a box whose value names a resume; `recipeOf(name)` is what it prints;
// `onShown(name, entry)` hears of each one that arrived (its page count is in the entry).
export function fill(root, recipeOf, onShown = null){
  for (const slot of root.querySelectorAll('[data-thumb]')){
    const recipe = recipeOf(slot.dataset.thumb);
    if (!recipe) continue;
    entry(recipe).then(e => {
      if (!e || !slot.isConnected) return;
      const { w, h } = pageSize(e.format), f = document.createElement('iframe');
      f.title = t('ux6e.thumb'); f.tabIndex = -1; f.setAttribute('scrolling', 'no'); f.srcdoc = e.src;
      f.style.cssText = `width:${w}px;height:${h}px;`;
      new ResizeObserver(() => { f.style.transform = `scale(${slot.clientWidth / w})`; }).observe(slot);   // follows the box when the window is resized
      slot.replaceChildren(f); slot.dataset.pages = String(e.pages); stats.shown++;
      play(f, [{ opacity: 0 }, { opacity: 1 }], { ms: 'fast', name: 'thumb:in' });
      onShown?.(slot.dataset.thumb, e);
    });
  }
}
