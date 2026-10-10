// A stand-in for the shell's context, so src/ui/edit.js and src/ui/career.js run in Node. Nothing draws:
// the views return strings, and the checks compare those. Fictional data only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../../src/model/schema.js';
import * as T from '../../src/model/resume.js';
import { createStore } from '../../src/store/store.js';
import { indexModel, NONE } from '../../src/ui/select.js';

export const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));

// a tiny document: elements are looked up by "#id" and hold a value
const els = new Map();
export const dom = {
  set(id, props = {}){ const el = { id, value: '', dataset: {}, focus(){}, select(){}, setSelectionRange(){}, style: {}, scrollHeight: 0, ...props }; els.set(`#${id}`, el); return el; },
  clear(){ els.clear(); },
};
globalThis.document = globalThis.document ?? {
  getElementById: () => null,
  querySelector: s => els.get(s) ?? null,
  querySelectorAll: () => [],
  addEventListener(){}, activeElement: null, body: { dataset: {} },
};
globalThis.confirm = globalThis.confirm ?? (() => true);
globalThis.CSS = globalThis.CSS ?? { escape: s => s };
globalThis.localStorage = globalThis.localStorage ?? { getItem: () => 'done', setItem(){}, removeItem(){} };

// edit.js and career.js each keep one context and one set of view state at module level, so every
// stand-in gets its own copy of them (a query string makes Node load a module again)
let instances = 0;
export async function makeUi({ resume = 0, lang = null, ws = 'resume' } = {}){
  const n = ++instances;
  const { initEdit } = await import(`../../src/ui/edit.js?i=${n}`);
  const { initCareer } = await import(`../../src/ui/career.js?i=${n}`);
  const example = S.load(read('data/example.json')).model;
  const names = read('data/example-resumes/index.json');
  const recipe = S.loadResume(read(`data/example-resumes/${names[resume]}`), example).recipe;
  if (lang) recipe.lang = lang;
  const store = createStore({ record: example, resumes: [], cur: recipe, openId: null });
  const ui = { sel: NONE, ws, previewing: false, view: ws === 'career' ? 'career' : null, work: null, workKey: null, ix: null };
  const toasts = [], calls = { renderBody: 0, renderCareer: 0 };
  const record = () => store.state.record;
  const cur = () => store.state.cur;
  const langOf = () => cur()?.lang ?? 'en';
  const work = () => {
    const k = JSON.stringify(record());
    if (k !== ui.workKey){ ui.work = store.materialize(record()); ui.workKey = k; ui.ix = indexModel(ui.work); }
    return ui.work;
  };
  const sectionTitle = id => {
    const s = ui.ix.sections.get(id);
    const own = cur().sections?.find(x => x?.id === id)?.label;
    return (typeof own === 'string' ? own : own?.[langOf()]) ?? record().i18n?.[langOf()]?.sections?.[id] ?? s?.title ?? (id === 'header' ? 'Header' : id);
  };
  const textOfFact = id => (id && cur().overrides?.[id]) ?? T.chooseVariant(ui.work, id, cur()).v?.text ?? '';
  const ctx = {
    store, ui, record, cur, lang: langOf, work,
    ix: () => (work(), ui.ix),
    chooseVariant: T.chooseVariant, sectionTitle, textOfFact,
    resumeName: r => r?.title ?? r?.role ?? 'resume',
    fillText: () => '', newerBanner: () => '', setFocus(){},
    sheet: { linesOf: () => 2 },
    toast: (m, tone) => toasts.push({ m, tone }),
    select: s => { ui.sel = s; }, renderBody: () => { calls.renderBody++; }, renderCareer: () => { calls.renderCareer++; }, renderHead(){},
    flash(){}, endHover(){}, endPreview: async () => {}, previewRecipe: async () => {}, indexOf: m => indexModel(m),
    syncUi(){},                   // the shell's: the interface follows the working language
    photoUrl: () => '', setView(){}, setWorkspace(w){ ui.ws = w; ui.view = w === 'career' ? 'career' : null; },
  };
  work();
  let career = null;
  const edit = initEdit({ ...ctx, careerLang: () => career.lang, careerFact: () => career.fact(), careerUp: () => career.up(), careerReveal: () => career.reveal() });
  career = initCareer({ ...ctx, edit });
  // the handlers edit.bind() puts on #body, to be fired by hand
  const handlers = {};
  edit.bind({ addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); }, querySelector: () => null, querySelectorAll: () => [] });
  career.bind({ addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); }, querySelector: () => null, querySelectorAll: () => [] });
  const api = {
    ctx, store, ui, edit, career, toasts, calls, record, cur, work,
    select(sel){ ui.sel = sel; },
    fire(type, target, extra = {}){ for (const fn of handlers[type] ?? []) fn({ target, key: '', ctrlKey: false, metaKey: false, preventDefault(){}, stopPropagation(){}, ...extra }); },
    type(id, value){ const el = dom.set(id, { value, style: {}, classList: { contains: () => false } }); this.fire('input', el); return el; },
    tick(dataset, checked){ this.fire('change', { dataset, id: '', checked, classList: { contains: () => false } }); },
    // what the shell's click handler does with a data-act: career first, then edit
    async click(act, dataset = {}){
      const tg = { dataset: { act, ...dataset } };
      if (await career.act(act, tg)) return true;
      return edit.act(act, tg);
    },
  };
  return api;
}

export { NONE };
