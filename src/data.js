// Load, validate and save the library and recipes in the browser. Nothing is uploaded.
// Older library files are migrated on load; save always writes resume-data/4.

import { validate } from '../checks/lib/validate.mjs';
import { load, save as toFile, serialize, loadResume, saveResume } from './model/schema.js';
import { openDb } from './store/persist.js';

const STORE = 'handles', KEY = 'library';

export const canOpenInPlace = typeof window !== 'undefined'
  && typeof window.showOpenFilePicker === 'function';

// IndexedDB holds only a file handle, for reopening, never the data.
// The database is shared with src/store/persist.js, which owns its version.
const idb = () => openDb();
async function put(key, value){
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch { /* blocked storage: no reopen, not fatal */ }
}
async function get(key){
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  } catch { return undefined; }
}

function wrap(json, origin, handle = null){
  let data, read;
  try { ({ model: data, warnings: read } = load(json)); }
  catch (e){ return { data: null, origin, handle, errors: [e.message], warnings: [], ok: false }; }
  const { errors, warnings } = validate(data);
  return { data, origin, handle, errors, warnings: [...read, ...warnings], ok: errors.length === 0 };
}

export async function loadExample(){
  const res = await fetch('./data/example.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`example.json: ${res.status}`);
  return wrap(await res.json(), 'data/example.json');
}

export async function openFromDisk(){
  const [handle] = await window.showOpenFilePicker({
    id: 'resume-library',
    types: [{ description: 'Resume library', accept: { 'application/json': ['.json'] } }],
    multiple: false,
  });
  const file = await handle.getFile();
  const loaded = wrap(JSON.parse(await file.text()), file.name, handle);
  await put(KEY, handle);
  return loaded;
}

export async function openFromInput(file){
  return wrap(JSON.parse(await file.text()), file.name);
}

// Reopening needs a user gesture, so the caller offers a button.
export async function rememberedHandle(){
  const handle = await get(KEY);
  if (!handle) return null;
  const perm = await handle.queryPermission?.({ mode: 'readwrite' });
  return { handle, name: handle.name, granted: perm === 'granted' };
}

export async function reopen(handle){
  const perm = await handle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') throw new Error('permission declined');
  const file = await handle.getFile();
  return wrap(JSON.parse(await file.text()), file.name, handle);
}

export async function save(loaded){
  const json = serialize(toFile(loaded.data));
  if (loaded.handle){
    const perm = await loaded.handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('permission declined');
    const w = await loaded.handle.createWritable();
    await w.write(json);
    await w.close();
    return { wrote: 'in place', name: loaded.handle.name };
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = loaded.origin.replace(/^.*\//, '') || 'resume-data.json';
  a.click();
  URL.revokeObjectURL(url);
  return { wrote: 'download', name: a.download };
}

// An opened recipe's handle is never kept and Save is always "save as", so a
// fit can't overwrite the recipe it started from.
export const canSaveAs = typeof window !== 'undefined'
  && typeof window.showSaveFilePicker === 'function';

export function wrapRecipe(recipe, data, origin){
  const { errors, warnings } = validate(data, recipe);
  return { recipe, origin, errors, warnings, ok: errors.length === 0 };
}

function parseRecipe(text){
  let j;
  try { j = JSON.parse(text); }
  catch (e){ throw new Error(`not readable as JSON: ${e.message}`); }
  let r;
  try { r = loadResume(j).recipe; }
  catch { throw new Error('that is not a recipe: it needs a "format" and a "theme"'); }
  if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.format !== 'string' || typeof r.theme !== 'string')
    throw new Error('that is not a recipe: it needs a "format" and a "theme"');
  return r;
}

export async function openRecipeFromDisk(data){
  const [handle] = await window.showOpenFilePicker({
    id: 'resume-recipe',
    types: [{ description: 'Resume recipe', accept: { 'application/json': ['.json'] } }],
    multiple: false,
  });
  const file = await handle.getFile();
  return wrapRecipe(parseRecipe(await file.text()), data, file.name);
}

export async function openRecipeFromInput(file, data){
  return wrapRecipe(parseRecipe(await file.text()), data, file.name);
}

// Never the name of the recipe it was opened from.
export function recipeFileName(recipe, openedName = ''){
  const clean = String(recipe?.application ?? 'Recipe')
    .replace(/[–—]/g, '-')
    .replace(/[^\p{L}\p{N} _.-]+/gu, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 80).trim() || 'Recipe';
  let name = `${/ fit$/i.test(clean) ? clean : `${clean} - fit`}.json`;
  if (name.toLowerCase() === String(openedName).toLowerCase()) name = name.replace(/\.json$/, ' - 2.json');
  return name;
}

export async function saveRecipe(recipe, data, suggestedName = recipeFileName(recipe)){
  const { errors } = validate(data, recipe);
  if (errors.length)
    throw new Error(`the recipe has ${errors.length} error${errors.length === 1 ? '' : 's'}, not saved: ${errors[0]}`);
  const json = serialize(saveResume(data, recipe).file);
  if (canSaveAs){
    const handle = await window.showSaveFilePicker({
      id: 'resume-recipe', suggestedName,
      types: [{ description: 'Resume recipe', accept: { 'application/json': ['.json'] } }],
    });
    const w = await handle.createWritable();
    await w.write(json);
    await w.close();
    return { wrote: 'file', name: handle.name };
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return { wrote: 'download', name: suggestedName };
}

// Not schema validity: the rules about what may leave.
export function exportBlockers(data){
  const out = [];
  for (const v of data.variants ?? []){
    if (!v.source && data.requireSource !== false) out.push(`${v.id} has no source`);
    if (typeof v.text === 'string' && v.text.includes('⬜')) out.push(`${v.id} carries a ⬜`);
  }
  const p = data.basics?.portrait;
  if (p && p.state === 'missing') out.push(`the portrait is ⬜ on ${(p.formats ?? ['a4']).join(', ')}`);
  return out;
}

export function summarise(data){
  const tags = new Map();
  for (const v of data.variants ?? []) for (const t of v.tags ?? []) tags.set(t, (tags.get(t) ?? 0) + 1);
  return {
    owner: data.meta?.owner ?? '—',
    schema: data.schema ?? '—',
    requireSource: data.requireSource !== false,
    facts: (data.facts ?? []).length,
    variants: (data.variants ?? []).length,
    marks: (data.variants ?? []).reduce((n, v) => n + (v.marks?.length ?? 0), 0),
    links: (data.variants ?? []).reduce((n, v) => n + (v.links?.length ?? 0), 0),
    sections: (data.sections ?? []).length,
    work: (data.work ?? []).length,
    tags: [...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}
