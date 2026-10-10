// Cuts a recipe without `pages` into pages at block boundaries (the header, a
// section, or one job), so a bullet never breaks across pages. A hand-written
// `pages` is left alone. Past `pageLimit` the rest stays on the last page and
// overflows, which is what Fit trims.

import { isOmitted } from './recipe.js';

const TOLERANCE = 0.5;      // px, the same slack pageFill() gives a band

export function flowSlots(data, recipe){
  const sections = new Map((data.sections ?? []).map(s => [s.id, s]));
  const ids = [...new Set(['header', 'summary', ...(recipe.sections ?? []).map(s => (typeof s === 'string' ? s : s?.id))])]
    .filter(id => sections.has(id) && !isOmitted(data, recipe, id));
  return ids.map(id => {
    const s = sections.get(id);
    if (s.kind !== 'entries') return { id };
    const work = recipe.sections?.find(x => x?.id === id)?.work ?? s.content.work ?? [];
    return { id, work: structuredClone(work) };
  });
}

export const flowRecipe = (data, recipe) => ({ ...structuredClone(recipe), pages: [flowSlots(data, recipe)] });

export const isAuto = recipe => !Array.isArray(recipe?.pages);

// Needs a page mounted with { annotate: true } so each band has data-section.
// Returns plain numbers so paginate() can be tested without a browser.
export function measureBlocks(root){
  const doc = root.ownerDocument ?? globalThis.document;
  const view = doc.defaultView ?? globalThis;
  const pg = root.querySelector('.page');
  if (!pg) throw new Error('measureBlocks: nothing is mounted');
  const cs = view.getComputedStyle(pg);
  const r = pg.getBoundingClientRect();
  const top = r.top + parseFloat(cs.paddingTop);
  const usable = r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const bands = [...pg.querySelectorAll(':scope > .band')].map(el => {
    const b = el.getBoundingClientRect();
    return {
      section: el.getAttribute('data-section'),
      top: b.top - top, bottom: b.bottom - top,
      entries: [...el.querySelectorAll('.entry')].map(e => {
        const x = e.getBoundingClientRect();
        return { top: x.top - top, bottom: x.bottom - top };
      }),
    };
  });
  return { usable, bands };
}

// A job block's `head` is its band's top padding, paid again when the section
// continues on a new page.
export function blocksOf(measured, slots){
  const blocks = [];
  const bands = measured.bands ?? [];
  if (bands.length !== slots.length)
    throw new Error(`paginate: ${bands.length} measured bands for ${slots.length} slots; measure the flowRecipe() of the same recipe`);
  bands.forEach((b, i) => {
    const slot = slots[i];
    if (b.section && b.section !== slot.id)
      throw new Error(`paginate: band ${i} is ${b.section}, expected ${slot.id}`);
    const nextTop = bands[i + 1]?.top ?? b.bottom;
    const gap = Math.max(0, nextTop - b.bottom);
    if (!Array.isArray(slot.work) || !b.entries.length){
      blocks.push({ slot, h: b.bottom - b.top, gap });
      return;
    }
    if (b.entries.length !== slot.work.length)
      throw new Error(`paginate: ${slot.id} measured ${b.entries.length} jobs for ${slot.work.length} listed`);
    const head = b.entries[0].top - b.top;
    b.entries.forEach((e, j) => {
      const last = j === b.entries.length - 1;
      const own = last ? b.bottom - e.top : e.bottom - e.top + (b.bottom - b.entries.at(-1).bottom);
      const step = last ? own : b.entries[j + 1].top - e.top;
      blocks.push({ slot, job: slot.work[j], head, h: own, step, gap: last ? gap : 0, last });
    });
  });
  return blocks;
}

export function paginate(measured, slots, { pageLimit = 0 } = {}){
  const usable = measured.usable;
  const blocks = blocksOf(measured, slots);
  const pages = [[]];
  let y = 0;
  let openJobs = null;             // the entries slot being filled on this page
  const limitReached = () => pageLimit > 0 && pages.length >= pageLimit;

  for (const b of blocks){
    const page = pages.at(-1);
    // The first job of a section on a page also pays the band's top padding.
    const continuing = b.job !== undefined && openJobs?.id === b.slot.id;
    const need = (continuing ? 0 : b.job !== undefined ? b.head : 0) + b.h;
    const fits = y + need <= usable + TOLERANCE;
    if (!fits && page.length && !limitReached()){
      pages.push([]);
      y = 0;
      openJobs = null;
    }
    place(b);
  }
  // the hand-written shape: a plain id, or { id, work }
  return pages.map(p => p.map(s => (s.work ? s : s.id)));

  function place(b){
    const page = pages.at(-1);
    if (b.job === undefined){
      page.push({ id: b.slot.id });
      y += b.h + b.gap;
      openJobs = null;
      return;
    }
    if (openJobs?.id !== b.slot.id){
      openJobs = { id: b.slot.id, work: [] };
      page.push(openJobs);
      y += b.head;
    }
    openJobs.work.push(structuredClone(b.job));
    y += b.last ? b.h + b.gap : b.step;
    if (b.last) openJobs = null;
  }
}

export async function autoLayout(data, recipe, measureFlow){
  if (!isAuto(recipe)) return recipe;
  const slots = flowSlots(data, recipe);
  const measured = await measureFlow({ ...structuredClone(recipe), pages: [slots] });
  return { ...structuredClone(recipe), pages: paginate(measured, slots, { pageLimit: recipe.pageLimit ?? 0 }) };
}
