// The fitter: what a recipe costs, what could be traded, and Fit. It plans in lines
// and never measures itself: `measure(recipe)` is injected. It only picks existing
// phrasings and drops whole bullets, never across `lang`, never overruling Off or Keep.

import { entriesOf } from './model/entries.js';
import { isOmitted, hasBudget, weightOf, pinsOf } from './recipe.js';

const LINE_CHARS = { 'us-letter': 84, a4: 73.5 };   // chars per line, measured

export const FILL_BAND = [88, 96];     // % of usable height
export const FILL_TARGET = 92;

export const key = recipe => `${recipe.format}@${recipe.theme}`;

// Holds the variant objects themselves, so a later measurement is seen without a rebuild.
const memo = new WeakMap();
const index = data => {
  let m = memo.get(data);
  if (!m){
    m = {
      variants: new Map((data.variants ?? []).map(v => [v.id, v])),
      facts: new Map((data.facts ?? []).map(f => [f.id, f])),
      work: new Map(entriesOf(data).map(w => [w.id, w])),
      sections: new Map((data.sections ?? []).map(s => [s.id, s])),
    };
    memo.set(data, m);
  }
  return m;
};

// A cached entry measured at another column width is ignored.
export function lines(v, k, colWidth){
  const m = v?.metrics?.measured?.[k];
  if (m && (!colWidth || !m.colWidth || m.colWidth === colWidth))
    return { lines: m.lines, measured: true };
  const per = LINE_CHARS[k?.split('@')[0]] ?? 80;
  return { lines: Math.max(1, Math.ceil((v?.metrics?.chars ?? [...(v?.text ?? '')].length) / per)),
           measured: false };
}

export function chosen(data, recipe, factId){
  const { variants, facts } = index(data);
  const f = facts.get(factId);
  if (!f) return null;
  if (recipe.overrides?.[factId] !== undefined) return null;   // not in the library
  const want = recipe.picks?.[factId];
  if (want) return variants.get(want) ?? null;
  // Same language filter as src/render.js, so Fit never costs a phrasing that won't print.
  const lang = recipe.lang ?? 'en';
  const vs = f.variants.map(id => variants.get(id)).filter(Boolean).filter(v => (v.lang ?? 'en') === lang);
  const v = vs.find(v => (v.seenIn ?? []).includes(recipe.format))
      ?? vs.find(v => v.id.endsWith('-base')) ?? vs[0] ?? null;
  if (v || lang === 'en') return v;
  // what prints in English (same in every language, or no version yet)
  const ens = f.variants.map(id => variants.get(id)).filter(Boolean).filter(x => (x.lang ?? 'en') === 'en');
  return ens.find(x => (x.seenIn ?? []).includes(recipe.format)) ?? ens.find(x => x.id.endsWith('-base')) ?? ens[0] ?? null;
}

// As src/render.js plans pages, but weight-0 sections stay in: they are intent.
export function pagePlan(data, recipe){
  if (recipe.pages) return recipe.pages.map(p => p.map(x => typeof x === 'string' ? { id: x } : x));
  const have = new Set((data.sections ?? []).map(s => s.id));
  const ids = ['header', 'summary', ...(recipe.sections ?? []).map(s => s.id)];
  return [[...new Set(ids)].filter(id => have.has(id)).map(id => ({ id }))];
}

// A claim is a fact the page says: a listed highlight, printed alone or inside a
// merged phrasing, plus anything such a phrasing covers.
function costPage(data, recipe, slots, colWidth){
  const ix = index(data);
  const k = key(recipe);
  const rows = [];
  const claims = new Set();
  for (const [si, slot] of slots.entries()){
    const s = ix.sections.get(slot.id);
    if (!s || isOmitted(data, recipe, slot.id)) continue;
    const add = (id, extra = {}) => {
      const v = chosen(data, recipe, id);
      if (!v) return;
      claims.add(id);
      rows.push({ section: s.id, slot: si, fact: id, variant: v.id, ...lines(v, k, colWidth), ...extra });
    };
    if (s.kind === 'header'){ ['name', 'label', 'contact'].forEach(x => add(data.basics.display?.[x])); }
    else if (s.kind === 'prose') add((s.id === 'summary' && recipe.summary) || s.content.fact);
    else if (s.kind === 'entries'){
      const list = slot.work ?? recipe.sections?.find(x => x.id === s.id)?.work ?? s.content.work;
      for (const ref of list ?? []){
        const w = ix.work.get(typeof ref === 'string' ? ref : ref.id);
        if (!w) continue;
        add(w.display.position, { job: w.id }); add(w.display.meta, { job: w.id });
        const only = typeof ref === 'string' ? w.highlights : (ref.highlights ?? w.highlights);
        const covered = new Set();
        for (const id of only) for (const c of chosen(data, recipe, id)?.covers ?? []) covered.add(c);
        only.forEach(id => claims.add(id));
        covered.forEach(c => claims.add(c));
        for (const id of only) if (!covered.has(id)) add(id, { job: w.id, hl: true });
      }
    }
    else if (s.kind === 'item'){ add(s.content.title); add(s.content.meta); }
    else if (s.kind === 'grid') (s.content.groups ?? []).forEach(id => add(id));
    else if (s.kind === 'pairs') (s.content.pairs ?? []).forEach(id => add(id));
    else if (s.kind === 'runs') (s.content.items ?? []).forEach(id => add(id));
  }
  return { rows, claims, lines: rows.reduce((n, r) => n + r.lines, 0),
           unmeasured: rows.filter(r => !r.measured).map(r => r.variant) };
}

export function cost(data, recipe, colWidth){
  const k = key(recipe);
  const pages = pagePlan(data, recipe).map(slots => costPage(data, recipe, slots, colWidth));
  const claims = new Set(pages.flatMap(p => [...p.claims]));
  return { key: k,
           pages: pages.map(({ rows, lines, unmeasured }) => ({ rows, lines, unmeasured })),
           lines: pages.reduce((n, p) => n + p.lines, 0),
           claims: [...claims],
           unmeasured: [...new Set(pages.flatMap(p => p.unmeasured))] };
}

// The highlight ceiling is reported, never enforced: the right number is still open.
export function highlights(data, recipe, ceiling = 7){
  const c = cost(data, recipe);
  const marks = [];
  const ix = index(data);
  for (const p of c.pages) for (const r of p.rows){
    const v = ix.variants.get(r.variant);
    for (const m of v?.marks ?? []) marks.push({ fact: r.fact, variant: v.id, text: m.expect, section: r.section });
  }
  return { marks, ceiling, over: Math.max(0, marks.length - ceiling) };
}

export function candidates(data, recipe, colWidth){
  const ix = index(data);
  const k = key(recipe);
  const out = [];
  for (const p of cost(data, recipe, colWidth).pages) for (const r of p.rows){
    const f = ix.facts.get(r.fact);
    const now = ix.variants.get(r.variant);
    if (!f || !now) continue;
    for (const id of f.variants){
      const alt = ix.variants.get(id);
      if (!alt || alt.id === now.id) continue;
      if ((alt.lang ?? 'en') !== (recipe.lang ?? 'en')) continue;
      const saved = r.lines - lines(alt, k, colWidth).lines;
      // Leaving a -merged phrasing for one that covers less drops a claim, not
      // just words. Say which, so a trim never loses a bullet silently.
      const drops = (now.covers ?? []).filter(c => !(alt.covers ?? []).includes(c));
      if (saved > 0) out.push({ fact: f.id, from: now.id, to: alt.id, saves: saved,
                                chars: [...now.text].length - [...alt.text].length,
                                ...(drops.length ? { drops } : {}) });
    }
  }
  return out.sort((a, b) => b.saves - a.saves || b.chars - a.chars);
}

export function apply(recipe, swaps){
  const next = structuredClone(recipe);
  next.picks = { ...next.picks };
  for (const s of swaps) next.picks[s.fact] = s.to;
  return next;
}

export function trim(data, recipe, over, colWidth){
  const taken = [];
  let left = over, next = recipe;
  while (left > 0){
    const best = candidates(data, next, colWidth).find(c => !taken.some(t => t.fact === c.fact));
    if (!best) break;
    taken.push(best);
    left -= best.saves;
    next = apply(next, [best]);
  }
  return { recipe: next, swaps: taken, saved: over - Math.max(0, left), short: Math.max(0, left) };
}

// Fit: plan, measure, replan until every page is in the band, a plan repeats, or
// `rounds` runs out. measure(recipe) answers like src/render.js measurePages().

export function normalise(data, recipe){
  const ix = index(data);
  const R = structuredClone(recipe);
  R.pages = pagePlan(data, R);
  for (const slots of R.pages) for (const slot of slots){
    const s = ix.sections.get(slot.id);
    if (s?.kind !== 'entries') continue;
    const list = slot.work ?? R.sections?.find(x => x?.id === s.id)?.work ?? s.content.work ?? [];
    slot.work = list.map(ref => {
      const id = typeof ref === 'string' ? ref : ref.id;
      const w = ix.work.get(id);
      return { id, highlights: [...((typeof ref === 'string' ? null : ref.highlights) ?? w?.highlights ?? [])] };
    });
  }
  return R;
}

export function finalise(data, R){
  const ix = index(data);
  const out = structuredClone(R);
  const bySection = new Map();
  for (const slots of out.pages) for (const slot of slots){
    if (ix.sections.get(slot.id)?.kind !== 'entries') continue;
    slot.work = slot.work.map(ref => {
      const w = ix.work.get(ref.id);
      return w && ref.highlights.length === w.highlights.length && ref.highlights.every((h, i) => h === w.highlights[i])
        ? ref.id : ref;
    });
    bySection.set(slot.id, [...(bySection.get(slot.id) ?? []), ...slot.work]);
  }
  for (const x of out.sections ?? [])
    if (x && typeof x === 'object' && bySection.has(x.id)) x.work = structuredClone(bySection.get(x.id));
  return out;
}

function makeCtx(data, R, opts){
  const ix = index(data);
  return { data, ix, k: key(R), lang: R.lang ?? 'en', pins: pinsOf(R), add: !!opts.add,
           pool: new Map(), floorJobs: new Set(), reach: new Set(), others: new Map(), trace: opts.trace ?? null };
}

const slotKey = (pi, si, job) => `${pi}.${si}.${job}`;
const isEntries = (ctx, slot) => ctx.ix.sections.get(slot.id)?.kind === 'entries';
const lineSum = (rows, si) => rows.reduce((n, r) => n + (r.slot === si ? r.lines : 0), 0);

// None that says a pinned-out claim, and only the current one if its phrasing is
// locked. An overridden fact is not in the library.
function eligible(ctx, R, id){
  const f = ctx.ix.facts.get(id);
  if (!f || R.overrides?.[id] !== undefined) return [];
  if (ctx.pins.phrasing.has(id)){ const cur = chosen(ctx.data, R, id); return cur ? [cur] : []; }
  return f.variants.map(v => ctx.ix.variants.get(v)).filter(Boolean)
    .filter(v => (v.lang ?? 'en') === ctx.lang)
    .filter(v => !(v.covers ?? []).some(c => ctx.pins.exclude.has(c)));
}

const shortest = (ctx, R, id) => eligible(ctx, R, id)
  .map(v => ({ v, n: lines(v, ctx.k).lines }))
  .sort((a, b) => a.n - b.n || [...a.v.text].length - [...b.v.text].length)[0]?.v ?? null;

function evalPage(ctx, R, pi){
  const c = costPage(ctx.data, R, R.pages[pi]);
  const claims = new Set([...c.claims, ...(ctx.others.get(pi) ?? [])]);
  let ok = true;
  for (const id of ctx.pins.include) if (ctx.reach.has(id) && !claims.has(id)) ok = false;
  for (const id of ctx.pins.exclude) if (claims.has(id)) ok = false;
  if (ok && ctx.floorJobs.size){
    const printed = new Map();
    for (const r of c.rows) if (r.hl) printed.set(slotKey(pi, r.slot, r.job), (printed.get(slotKey(pi, r.slot, r.job)) ?? 0) + 1);
    for (const key of ctx.floorJobs)
      if (key.startsWith(`${pi}.`) && !(printed.get(key) >= 1)) ok = false;
  }
  return { c, claims, ok };
}

const withPick = (R, fact, vid) => { const R2 = structuredClone(R); R2.picks = { ...R2.picks, [fact]: vid }; return R2; };
const jobRef = (R, pi, si, job) => R.pages[pi][si].work.find(x => x.id === job);

function withoutHighlight(R, pi, si, job, h){
  const R2 = structuredClone(R);
  const ref = jobRef(R2, pi, si, job);
  ref.highlights = ref.highlights.filter(x => x !== h);
  return R2;
}

function withHighlight(ctx, R, pi, si, job, h, vid){
  const R2 = structuredClone(R);
  const ref = jobRef(R2, pi, si, job);
  const order = ctx.ix.work.get(job).highlights;
  const set = new Set([...ref.highlights, h]);
  ref.highlights = order.filter(x => set.has(x));
  if (vid) R2.picks = { ...R2.picks, [h]: vid };
  return R2;
}

function* swaps(ctx, R, ev, si){
  for (const [order, row] of ev.c.rows.entries()){
    if (row.slot !== si) continue;
    for (const v of eligible(ctx, R, row.fact))
      if (v.id !== row.variant) yield { kind: 'swap', fact: row.fact, order, R2: null, vid: v.id };
  }
}
function* drops(ctx, R, ev, pi, si){
  for (const [order, row] of ev.c.rows.entries())
    if (row.slot === si && row.hl) yield { kind: 'drop', fact: row.fact, order, R2: withoutHighlight(R, pi, si, row.job, row.fact) };
}
function* adds(ctx, R, ev, pi, si){
  const slot = R.pages[pi][si];
  if (!isEntries(ctx, slot)) return;
  for (const [order, ref] of slot.work.entries()){
    const w = ctx.ix.work.get(ref.id);
    if (!w) continue;
    const listed = new Set(ref.highlights);
    const pool = ctx.add ? null : ctx.pool.get(slotKey(pi, si, ref.id));
    const next = w.highlights.find(h => !listed.has(h) && !ctx.pins.exclude.has(h) && !ev.claims.has(h) && (!pool || pool.has(h)));
    if (!next) continue;
    const v = shortest(ctx, R, next);
    if (v) yield { kind: 'add', fact: next, order, R2: withHighlight(ctx, R, pi, si, ref.id, next, R.picks?.[next] && ctx.pins.phrasing.has(next) ? null : v.id) };
  }
}

const keeps = (a, b) => [...a].every(x => b.has(x));    // b still says everything a did

// Tiers, each exhausted first: a shorter phrasing that loses no claim, then one that
// says less, then a whole bullet. The bottom of the page goes first. Each move is
// judged by re-costing the page, so claims gained or lost through `covers` count.
function shrinkSlot(ctx, R, pi, si, target){
  let ev = evalPage(ctx, R, pi);
  for (;;){
    const now = lineSum(ev.c.rows, si);
    if (now <= target) break;
    const excess = now - target;
    const cands = [];
    for (const c of [...swaps(ctx, R, ev, si), ...drops(ctx, R, ev, pi, si)]){
      const R2 = c.R2 ?? withPick(R, c.fact, c.vid);
      const e2 = evalPage(ctx, R2, pi);
      if (!e2.ok) continue;
      const saving = now - lineSum(e2.c.rows, si);
      if (saving <= 0) continue;
      const lost = !keeps(ev.claims, e2.claims);
      cands.push({ ...c, R2, e2, saving, tier: c.kind === 'drop' ? 3 : lost ? 2 : 1 });
    }
    if (!cands.length) break;
    const tier = Math.min(...cands.map(c => c.tier));
    // lowest row first; then the move that saves just enough, else the most
    const fit = c => c.saving >= excess ? c.saving - excess : 1000 + (excess - c.saving);
    const best = cands.filter(c => c.tier === tier).sort((a, b) => b.order - a.order || fit(a) - fit(b))[0];
    ctx.trace?.push({ phase: 'shrink', page: pi + 1, slot: si, tier, kind: best.kind, fact: best.fact, to: best.vid ?? null, saving: best.saving, excess });
    R = best.R2; ev = best.e2;
  }
  return R;
}

// Left-out bullets first (top job first, at their shortest), then longer phrasings,
// top of the page first. Never loses a claim.
function growSlot(ctx, R, pi, si, target){
  let ev = evalPage(ctx, R, pi);
  for (;;){
    let took = false;
    for (const c of adds(ctx, R, ev, pi, si)){
      const e2 = evalPage(ctx, c.R2, pi);
      if (!e2.ok || lineSum(e2.c.rows, si) > target || !keeps(ev.claims, e2.claims)) continue;
      ctx.trace?.push({ phase: 'grow', page: pi + 1, slot: si, kind: 'add', fact: c.fact, target });
      R = c.R2; ev = e2; took = true; break;
    }
    if (!took) break;
  }
  for (;;){
    const now = lineSum(ev.c.rows, si);
    let best = null;
    for (const c of swaps(ctx, R, ev, si)){
      const R2 = withPick(R, c.fact, c.vid);
      const e2 = evalPage(ctx, R2, pi);
      if (!e2.ok) continue;
      const after = lineSum(e2.c.rows, si);
      if (after <= now || after > target || !keeps(ev.claims, e2.claims)) continue;
      if (!best || c.order < best.order || (c.order === best.order && after > best.after)) best = { ...c, R2, e2, after };
    }
    if (!best) break;
    ctx.trace?.push({ phase: 'grow', page: pi + 1, slot: si, kind: 'swap', fact: best.fact, to: best.vid, from: now, after: best.after, target });
    R = best.R2; ev = best.e2;
  }
  return R;
}

function enforcePins(ctx, R){
  const notes = [];
  const ex = ctx.pins.exclude;
  for (const slots of R.pages) for (const slot of slots)
    for (const ref of slot.work ?? [])
      for (const h of ref.highlights.filter(x => ex.has(x)))
        { ref.highlights = ref.highlights.filter(x => x !== h); notes.push({ kind: 'dropped', fact: h, why: 'pinned out' }); }

  const claimsNow = () => new Set(cost(ctx.data, R).claims);
  for (const id of ex){
    if (!claimsNow().has(id)) continue;
    let fixed = false;
    for (const p of cost(ctx.data, R).pages) for (const r of p.rows){
      const v = ctx.ix.variants.get(r.variant);
      if (!(v?.covers ?? []).includes(id)) continue;
      const alt = shortest(ctx, R, r.fact);
      if (alt && !(alt.covers ?? []).includes(id)){ R.picks = { ...R.picks, [r.fact]: alt.id }; fixed = true;
        notes.push({ kind: 'swap', fact: r.fact, to: alt.id, why: `no longer says ${id}, which is pinned out` }); }
    }
    if (!fixed && claimsNow().has(id)) notes.push({ kind: 'conflict', fact: id, why: 'pinned out, but a phrasing locked by a pin still says it' });
  }

  for (const id of ctx.pins.include){
    if (claimsNow().has(id)) continue;
    let placed = false;
    for (const [pi, slots] of R.pages.entries()) for (const [si, slot] of slots.entries()){
      if (placed || !isEntries(ctx, slot) || isOmitted(ctx.data, R, slot.id)) continue;
      const ref = slot.work.find(x => ctx.ix.work.get(x.id)?.highlights.includes(id));
      if (!ref) continue;
      const v = shortest(ctx, R, id);
      const R2 = withHighlight(ctx, R, pi, si, ref.id, id, ctx.pins.phrasing.has(id) ? null : v?.id);
      R.pages = R2.pages; R.picks = R2.picks; placed = true;
      notes.push({ kind: 'added', fact: id, why: 'pinned in' });
    }
    if (!placed) notes.push({ kind: 'unplaceable', fact: id, why: 'pinned in, but no job in this recipe has it' });
  }
  return notes;
}

function fitPage(ctx, R, pi, T, alloc){
  const budget = [];
  for (const [si, slot] of R.pages[pi].entries())
    if (hasBudget(ctx.data, slot.id) && !isOmitted(ctx.data, R, slot.id)) budget.push(si);
  const ev = evalPage(ctx, R, pi);
  const fixed = ev.c.rows.reduce((n, r) => n + (budget.includes(r.slot) ? 0 : r.lines), 0);
  const V = T - fixed;

  const traced = ctx.trace;
  ctx.trace = null;                                        // the probing below is not a decision
  const info = budget.map(si => {
    const w = weightOf(R, R.pages[pi][si].id);
    const lo = lineSum(evalPage(ctx, shrinkSlot(ctx, structuredClone(R), pi, si, 0), pi).c.rows, si);
    const hi = lineSum(evalPage(ctx, growSlot(ctx, structuredClone(R), pi, si, Infinity), pi).c.rows, si);
    return { si, w, floor: Math.min(lo, hi), cap: Math.max(lo, hi) };
  });
  ctx.trace = traced;
  const share = new Map();
  let free = new Set(info), left = V;
  while (free.size){
    const wsum = [...free].reduce((n, x) => n + x.w, 0);
    const tent = x => left * x.w / wsum;
    // Caps first: what they give back can lift another slot over its floor.
    const high = [...free].filter(x => x.cap < tent(x) - 1e-9);
    const low = high.length ? [] : [...free].filter(x => x.floor > tent(x) + 1e-9);
    const fixedNow = high.length ? high : low;
    if (!fixedNow.length){ for (const x of free) share.set(x.si, tent(x)); break; }
    for (const x of fixedNow){ share.set(x.si, high.length ? x.cap : x.floor); left -= share.get(x.si); free.delete(x); }
  }

  // Shrunk or grown, not both: shrinking then adding a bullet back just swaps claims.
  const shrunk = new Set();
  for (const x of info){
    const n = lineSum(evalPage(ctx, R, pi).c.rows, x.si);
    if (n > share.get(x.si) + 1e-9){ R = shrinkSlot(ctx, R, pi, x.si, share.get(x.si)); shrunk.add(x.si); }
    else R = growSlot(ctx, R, pi, x.si, share.get(x.si));
  }
  for (const x of [...info].filter(x => !shrunk.has(x.si)).sort((a, b) => b.w - a.w || a.si - b.si)){
    const e = evalPage(ctx, R, pi);
    const spare = T - e.c.lines;
    if (spare < 1) break;
    R = growSlot(ctx, R, pi, x.si, lineSum(e.c.rows, x.si) + spare);
  }
  alloc.push(...info.map(x => ({ page: pi + 1, section: R.pages[pi][x.si].id, weight: x.w,
    share: +share.get(x.si).toFixed(1), floor: x.floor, cap: x.cap,
    lines: lineSum(evalPage(ctx, R, pi).c.rows, x.si) })));
  return R;
}

// `furniture`: lines of header, tabs, titles and gaps that cost() does not count.
function plan(data, input, geom, furniture, aims, opts){
  const ctx = makeCtx(data, input, opts);
  const R = structuredClone(input);
  const notes = enforcePins(ctx, R);

  for (const [pi, slots] of R.pages.entries())
    for (const [si, slot] of slots.entries()){
      if (!isEntries(ctx, slot)) continue;
      for (const ref of slot.work ?? []) ctx.pool.set(slotKey(pi, si, ref.id), new Set(ref.highlights));
    }
  // a pinned-in highlight can only be honoured if some job on a page lists it
  for (const id of ctx.pins.include)
    for (const slots of R.pages) for (const slot of slots)
      if (isEntries(ctx, slot)) for (const ref of slot.work) if (ctx.ix.work.get(ref.id)?.highlights.includes(id)) ctx.reach.add(id);
  R.pages.forEach((slots, pi) => costPage(data, R, slots).rows.forEach(r => { if (r.hl) ctx.floorJobs.add(slotKey(pi, r.slot, r.job)); }));

  const alloc = [];
  for (let pi = 0; pi < R.pages.length; pi++){
    const g = geom[pi];
    const claimsOf = i => new Set(costPage(data, R, R.pages[i]).claims);
    ctx.others = new Map(R.pages.map((_, i) => [i, new Set(R.pages.flatMap((__, j) => j === i ? [] : [...claimsOf(j)]))]));
    const T = aims[pi] / 100 * g.usable / g.lineH - furniture[pi];
    const next = fitPage(ctx, R, pi, T, alloc);
    R.pages = next.pages; R.picks = next.picks;
  }
  return { R, notes, alloc };
}

// aimLast: a paginated resume. Only its last page is aimed; the others must just not overflow.
const pageOk = (p, band, aimed) => !(p.overflow > 0)
  && (!aimed || (p.used / p.usable * 100 >= band[0] - 1e-9 && p.used / p.usable * 100 <= band[1] + 1e-9));
const inBand = (m, band, aimLast = false) => m.every((p, i) => pageOk(p, band, !aimLast || i === m.length - 1));
const distance = (m, target, aimLast = false) => m.reduce((n, p, i) => n + (p.overflow > 0 ? 1e6 : 0)
  + (!aimLast || i === m.length - 1 ? Math.abs(p.used / p.usable * 100 - target) : 0), 0);
const sig = R => JSON.stringify([R.pages, R.picks]);

// A recipe with no `pages` is laid out by opts.layout, fitted, and returned without
// `pages`. If trimming keeps moving the breaks, the third layout is kept as manual `pages`.
export async function fit(data, recipe, opts = {}){
  const auto = !Array.isArray(recipe.pages);
  if (auto && recipe.pageLimit === 0)
    return { error: 'Fit is off: this resume is set to as many pages as it needs, so nothing is shortened', errorKey: 'fit.off', recipe, rounds: 0 };
  if (auto && typeof opts.layout === 'function') return fitAuto(data, recipe, opts);
  return fitFixed(data, recipe, opts, false);
}

async function fitAuto(data, recipe, opts){
  const same = (a, b) => JSON.stringify(normalise(data, a).pages) === JSON.stringify(normalise(data, b).pages);
  let r = recipe, res = null;
  for (let pass = 1; pass <= 3; pass++){
    const laid = await opts.layout(r);
    res = await fitFixed(data, laid, opts, true);
    if (res.error) return res;
    const out = structuredClone(res.recipe);
    delete out.pages;
    if (same(await opts.layout(out), res.recipe)) return { ...res, recipe: out, paginated: true, passes: pass };
    r = out;
  }
  res.report.shortfall.push({ page: null, direction: 'pages', lines: 0,
    text: 'the page breaks kept moving as bullets were trimmed, so this layout is kept as a manual one (`pages`).' });
  return { ...res, paginated: false, passes: 3 };
}

async function fitFixed(data, recipe, opts, aimLast){
  const o = { target: FILL_TARGET, band: FILL_BAND, add: false, ceiling: 7, rounds: 4,
              ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) };
  if (typeof o.measure !== 'function') throw new Error('fit needs a measure(recipe) function');
  const ix = index(data);
  const input = normalise(data, recipe);
  const seen = new Set();
  const tried = [];

  let m = await o.measure(input);
  let state = input;
  let notes = [], alloc = [];
  for (let round = 1; round <= o.rounds; round++){
    const geom = m.map(p => ({ usable: p.usable, lineH: p.lineH }));
    if (geom.some(g => !(g.lineH > 0) || !(g.usable > 0)))
      return { error: 'the measurement has no body line height: a page with no bullets cannot be fitted', errorKey: 'fit.noBullets', recipe, rounds: round - 1 };
    const cur = costPlanLines(data, state);
    const furniture = m.map((p, i) => p.used / p.lineH - cur[i]);
    // Over the band: just inside its top edge, so the fewest lines are lost. In it:
    // where it is, so only the weights move lines between sections.
    const aims = m.map((p, i) => {
      const fill = 100 * p.used / p.usable;
      if (aimLast && i < m.length - 1) return p.overflow > 0 || fill > 100 ? o.band[1] - 1 : fill;
      return p.overflow > 0 || fill > o.band[1] ? o.band[1] - 1 : fill < o.band[0] ? o.target : fill;
    });
    const p = plan(data, input, geom, furniture, aims, o);
    const s = sig(p.R);
    if (seen.has(s)) break;
    seen.add(s);
    const after = await o.measure(p.R);
    tried.push({ R: p.R, m: after, notes: p.notes, alloc: p.alloc, round });
    if (inBand(after, o.band, aimLast)) break;
    state = p.R; m = after;
  }
  if (!tried.length) return { recipe, report: report(data, input, input, [], [], await o.measure(input), o, 0), rounds: 0 };

  // the best round: no overflow first, then closest to the middle of the band
  const best = tried.reduce((a, b) => distance(b.m, o.target, aimLast) < distance(a.m, o.target, aimLast) ? b : a);
  const out = finalise(data, best.R);
  return { recipe: out, report: report(data, input, best.R, best.notes, best.alloc, best.m, { ...o, aimLast }, tried.length), rounds: tried.length };
}

const costPlanLines = (data, R) => pagePlan(data, R).map(slots => costPage(data, R, slots).lines);

function report(data, before, after, notes, alloc, m, o, rounds){
  const ix = index(data);
  const cb = cost(data, before), ca = cost(data, after);
  const rowsOf = c => new Map(c.pages.flatMap(p => p.rows.map(r => [r.fact, r])));
  const rb = rowsOf(cb), ra = rowsOf(ca);
  const claimsB = new Set(cb.claims), claimsA = new Set(ca.claims);

  const swapsOut = [];
  for (const [fact, r] of ra){
    const was = rb.get(fact);
    if (!was || was.variant === r.variant) continue;
    const from = ix.variants.get(was.variant), to = ix.variants.get(r.variant);
    swapsOut.push({ fact, from: was.variant, to: r.variant, lines: [was.lines, r.lines],
      says: (to?.covers ?? []).filter(c => !(from?.covers ?? []).includes(c)),
      stopsSaying: (from?.covers ?? []).filter(c => !(to?.covers ?? []).includes(c)) });
  }
  const listed = R => new Set(R.pages.flatMap(p => p.flatMap(s => (s.work ?? []).flatMap(r => r.highlights))));
  const lb = listed(before), la = listed(after);
  const dropped = [...lb].filter(h => !la.has(h)).map(fact => ({ fact, printed: rb.has(fact) }));
  const restored = [...ra.keys()].filter(f => !rb.has(f) && claimsB.has(f));      // covered before, its own bullet now
  const added = [...la].filter(h => !lb.has(h) && !restored.includes(h)).map(fact => ({ fact }));

  const pages = m.map((p, i) => {
    const fill = 100 * p.used / p.usable;
    const held = o.aimLast && i < m.length - 1;
    const status = p.overflow > 0 ? 'overflow' : held ? 'in-band' : fill > o.band[1] ? 'over' : fill < o.band[0] ? 'under' : 'in-band';
    return { page: i + 1, fill: +fill.toFixed(1), used: p.used, usable: p.usable, lineH: p.lineH, overflow: p.overflow,
             overflowSection: p.overflowSection ?? null, status, planned: ca.pages[i]?.lines ?? 0, ...(held ? { held: true } : {}) };
  });

  const shortfall = [];
  for (const pg of pages){
    if (pg.status === 'in-band') continue;
    const L = pg.lineH, u = pg.usable;
    if (pg.status === 'under'){
      const n = Math.ceil((o.band[0] / 100 * u - pg.used) / L);
      const unlisted = after.pages[pg.page - 1]
        .flatMap(s => (s.work ?? []).flatMap(r => (ix.work.get(r.id)?.highlights ?? []).filter(h => !listed(after).has(h))));
      shortfall.push({ page: pg.page, direction: 'under', lines: n, unlisted: unlisted.length,
        text: `page ${pg.page}: ${n} line${n === 1 ? '' : 's'} under the band. Nothing more can be added`
          + (unlisted.length
              ? (o.add
                  ? `; ${unlisted.length} bullet${unlisted.length === 1 ? ' is' : 's are'} still unlisted, either already said inside a merged phrasing or too long for the space left.`
                  : `; ${unlisted.length} bullet${unlisted.length === 1 ? '' : 's'} of these jobs are not in the pool (allow adds to use them).`)
              : '.') });
    } else {
      const n = Math.max(1, Math.ceil((pg.used - o.band[1] / 100 * u) / L));
      const pins = pinsOf(after);
      const held = [];
      const hold = (cond, msg) => { if (cond) held.push(msg); };
      const printed = new Map();
      for (const r of ca.pages[pg.page - 1].rows) if (r.hl) printed.set(`${r.slot}.${r.job}`, (printed.get(`${r.slot}.${r.job}`) ?? 0) + 1);
      const lastBullets = [...printed.values()].filter(c => c === 1).length;
      const locked = ca.pages[pg.page - 1].rows.filter(r => pins.phrasing.has(r.fact)).length;
      const pinnedIn = ca.pages[pg.page - 1].rows.filter(r => r.hl && pins.include.has(r.fact)).length;
      hold(lastBullets, `${lastBullets} job${lastBullets === 1 ? ' is' : 's are'} down to one bullet`);
      hold(locked, `${locked} phrasing${locked === 1 ? '' : 's'} locked`);
      hold(pinnedIn, `${pinnedIn} bullet${pinnedIn === 1 ? '' : 's'} pinned in`);
      shortfall.push({ page: pg.page, direction: 'over', lines: n, held,
        ...(pg.overflowSection ? { overflowSection: pg.overflowSection } : {}),
        text: `page ${pg.page}: ${n} line${n === 1 ? '' : 's'} over the band${pg.overflow > 0 ? ` and overflowing${pg.overflowSection ? ` in ${pg.overflowSection}` : ''}` : ''}. `
          + `The library has no shorter phrasing left${held.length ? `; held by ${held.join(', ')}` : ''}.` });
    }
  }
  for (const n of notes.filter(x => x.kind === 'conflict' || x.kind === 'unplaceable'))
    shortfall.push({ page: null, direction: 'pin', lines: 0, text: `${n.fact}: ${n.why}.` });

  const drafts = [...ra.values()].filter(r => /-draft(-|$)/.test(r.variant)).map(r => r.variant);
  return {
    converged: pages.every(p => p.status === 'in-band'),
    rounds, target: o.target, band: o.band, pages,
    allocation: alloc, swaps: swapsOut, dropped, added, restored,
    claims: { lost: [...claimsB].filter(c => !claimsA.has(c)), gained: [...claimsA].filter(c => !claimsB.has(c)) },
    enforced: notes, shortfall,
    highlights: (h => ({ count: h.marks.length, ceiling: h.ceiling, over: h.over }))(highlights(data, after, o.ceiling)),
    drafts, estimated: ca.unmeasured.length,
  };
}

// line model

// A measure() for tests and `scripts/fit.mjs --model`, never a real measurement.
// `skew` makes the model wrong on purpose so the correction loop has work to do.
export function modelMeasure(data, { usable, lineH, furniture = 0, skew = 1 }){
  const at = (x, i) => Array.isArray(x) ? x[Math.min(i, x.length - 1)] : x;
  return async recipe => {
    const plan = pagePlan(data, recipe);
    return plan.map((slots, i) => {
      const c = costPage(data, recipe, slots);
      const u = at(usable, i), L = at(lineH, i);
      let y = at(furniture, i) * L;
      const bands = [];
      for (const [si, slot] of slots.entries()){
        if (isOmitted(data, recipe, slot.id)) continue;
        y += lineSum(c.rows, si) * skew * L;
        bands.push({ section: slot.id, bottom: y });
      }
      const used = y;
      const over = bands.find(b => b.bottom > u + 0.5);
      return { page: i + 1, usable: u, used, lineH: L, overflow: Math.max(0, Math.round(used - u)),
               overflowSection: used > u ? (over?.section ?? null) : null, bands };
    });
  };
}

// Stands in for src/paginate.js measureBlocks(). Matches modelMeasure() at gap 0,
// so a check can paginate and fit without a browser.
export function modelFlow(data, { usable, lineH, gap = 0, furniture = 0 }){
  return async flow => {
    const slots = flow.pages[0];
    const c = costPage(data, flow, slots);
    let y = furniture * lineH;
    const bands = [];
    for (const [si, slot] of slots.entries()){
      const top = y;
      const entries = [];
      if (Array.isArray(slot.work)){
        for (const ref of slot.work){
          const id = typeof ref === 'string' ? ref : ref.id;
          const n = c.rows.reduce((k, r) => k + (r.slot === si && r.job === id ? r.lines : 0), 0);
          entries.push({ top: y, bottom: y + n * lineH });
          y += n * lineH;
        }
      } else y += lineSum(c.rows, si) * lineH;
      bands.push({ section: slot.id, top, bottom: y, entries });
      y += gap * lineH;
    }
    return { usable: Array.isArray(usable) ? usable[0] : usable, bands };
  };
}

export function formatReport(r){
  if (r.error) return [`Fit stopped: ${r.error}`];
  const out = [];
  const p = r.pages.map(x => `page ${x.page} ${x.fill}%${x.held ? ' (held)' : ''}`).join(' · ');
  out.push(`${r.converged ? 'In band' : 'Not in band'} after ${r.rounds} round${r.rounds === 1 ? '' : 's'}: ${p} (band ${r.band[0]}–${r.band[1]}%).`);
  for (const s of r.swaps)
    out.push(`  swap ${s.fact}: ${s.from} → ${s.to} (${s.lines[0]}→${s.lines[1]} ln)`
      + (s.says.length ? `; now also says ${s.says.join(', ')}` : '')
      + (s.stopsSaying.length ? `; no longer says ${s.stopsSaying.join(', ')}` : ''));
  for (const d of r.dropped) out.push(`  dropped ${d.fact}${d.printed ? '' : ' (was covered by a merged phrasing)'}`);
  for (const a of r.added) out.push(`  added ${a.fact}`);
  for (const f of r.restored) out.push(`  restored ${f} as its own bullet`);
  if (r.claims.lost.length) out.push(`  claims no longer on the page: ${r.claims.lost.join(', ')}`);
  if (r.claims.gained.length) out.push(`  claims now on the page: ${r.claims.gained.join(', ')}`);
  for (const n of r.enforced) out.push(`  pin: ${n.kind} ${n.fact} (${n.why})`);
  for (const s of r.shortfall) out.push(`  ${s.text}`);
  out.push(`  highlights: ${r.highlights.count} / ceiling ${r.highlights.ceiling} (report only)`);
  if (r.drafts.length) out.push(`  uses ${r.drafts.length} unreviewed draft phrasing${r.drafts.length === 1 ? '' : 's'}`
    + (r.drafts.length <= 5 ? `: ${r.drafts.join(', ')}` : `, e.g. ${r.drafts.slice(0, 3).join(', ')}`));
  if (r.estimated) out.push(`  ${r.estimated} printed row${r.estimated === 1 ? ' is' : 's are'} still estimated, not measured`);
  return out;
}
