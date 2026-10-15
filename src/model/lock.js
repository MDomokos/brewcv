// The lock: recipe.locked is a list of ids (a fact, a local line, a heading `~h:<section>`, a language name `~t:<fact>`, a job, a
// section, a skill group, or PAGE for the whole page). A lock holds everything inside the locked element, so the answer is
// derived by walking up the ancestors, never stored per child. It is written only when something is locked; an older app ignores
// the key and allows the edit. Nothing printed or exported differs for a lock.

import { keyed } from '../i18n/index.js';
import { entriesOf } from './entries.js';
import { localJob } from '../recipe.js';

export const PAGE = '~page';

export class LockedError extends Error {
  constructor(id){ const k = keyed('ux6c.locked'); super(k.message); this.name = 'LockedError'; this.key = k.key; this.id = id; }
}

const sectionsOf = model => model?.sections ?? [];
export const skillsSection = model => sectionsOf(model).find(s => s.kind === 'grid')?.id ?? 'skills';

// The element an id sits in, one step up (PAGE for a section, null for PAGE).
export function parentOfId(model, recipe, id){
  if (id === PAGE) return null;
  if (id.startsWith('~h:')) return id.slice(3);
  if (id.startsWith('~t:')) return id.slice(3);
  const own = localJob(recipe, id);
  if (own) return own;
  const jobs = entriesOf(model);
  if (jobs.some(w => w.id === id)) return sectionsOf(model).find(s => s.kind === 'entries' && (s.content?.work ?? []).includes(id))?.id ?? sectionsOf(model).find(s => s.kind === 'entries')?.id ?? PAGE;
  const job = jobs.find(w => (w.highlights ?? []).includes(id) || w.display?.position === id || w.display?.meta === id);
  if (job) return job.id;
  if (sectionsOf(model).some(s => s.id === id)) return PAGE;
  if (id.startsWith('~sg-')) return skillsSection(model);
  const sec = sectionsOf(model).find(s => Object.values(s.content ?? {}).flat().includes(id));
  if (sec) return sec.id;
  if (id === 'photo' || Object.values(model?.basics?.display ?? {}).includes(id)) return sectionsOf(model).find(s => s.kind === 'header')?.id ?? 'header';
  return PAGE;
}

// The id of the lock that holds `id` (its own, or the nearest ancestor's), or null.
export function lockedBy(model, recipe, id){
  const locked = recipe?.locked;
  if (!Array.isArray(locked) || !locked.length) return null;
  const set = new Set(locked);
  for (let at = id, n = 0; at != null && n < 20; at = parentOfId(model ?? {}, recipe, at), n++) if (set.has(at)) return at;
  return null;
}
export const isLocked = (model, recipe, id) => lockedBy(model, recipe, id) !== null;
export function guard(model, recipe, id){ if (isLocked(model, recipe, id)) throw new LockedError(id); }

// Lock or unlock the element itself (a lock inherited from an ancestor is lifted there). No key is left when nothing is locked.
export function setLocked(recipe, id, on){
  const rest = (recipe.locked ?? []).filter(x => x !== id);
  const next = on ? [...rest, id] : rest;
  if (next.length) recipe.locked = next; else delete recipe.locked;
}
