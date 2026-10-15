// The renderer: library plus recipe in, DOM out, in the browser and in Node alike.
// Class names are the contract with themes/: nothing here sets a colour, size or position.

import { render as renderInline, encode } from '../scripts/lib/html.mjs';
import { isOmitted, offOf, inOrder, isLocal, withLocal } from './recipe.js';
import { entriesOf } from './model/entries.js';

const GAP = '⬜';
const RUN_SEP = ' · ';
const RUN_NOTE = ' — ';

export class RenderError extends Error {}

// ⬜ is a missing value. It prints red so it can't be sent unnoticed.
function gapSpans(text){
  const out = [];
  [...text].forEach((c, i) => {
    if (c === GAP) out.push({ start: i, end: i + 1, open: '<span class="gap">', close: '</span>' });
  });
  return out;
}

const markOpen = slot =>
  `<span class="${slot && slot !== 'primary' ? `mark mark--${slot}` : 'mark'}">`;

function spansFor(v, extra = []){
  return [
    ...(v.marks ?? []).map(m => ({ start: m.start, end: m.end, open: markOpen(m.slot), close: '</span>' })),
    ...(v.links ?? []).map(l => ({ start: l.start, end: l.end, open: `<a href="${l.href}">`, close: '</a>' })),
    ...extra,
    ...gapSpans(v.text ?? ''),
  ].sort((a, b) => a.start - b.start || b.end - a.end);
}

export function inlineOf(v, extra){ return renderInline(v.text, spansFor(v, extra)); }

function separatorSpans(text, sep){
  if (!sep) return [];
  const chars = [...text], want = [...sep], out = [];
  for (let i = 0; i + want.length <= chars.length; i++){
    if (want.every((c, k) => chars[i + k] === c)){
      out.push({ start: i, end: i + want.length, open: '<span class="contact__sep">', close: '</span>' });
      i += want.length - 1;
    }
  }
  return out;
}

function h(doc, tag, cls, opts = {}){
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(opts.attrs ?? {})) n.setAttribute(k, v);
  if (opts.html !== undefined) n.innerHTML = opts.html;
  if (opts.kids) n.append(...opts.kids);
  return n;
}

// Data attributes don't affect layout, so an annotated document lays out like a sent one.
const mark = (ctx, v) => ctx.annotate ? { 'data-variant': v.id } : {};
const markAttr = (ctx, v) => ctx.annotate ? ` data-variant="${v.id}"` : '';

function band(ctx, { tag = 'section', mod, label, section, gutter = [], content = [] }){
  const b = h(ctx.doc, tag, `band ${mod}`, { attrs: {
    ...(label ? { 'aria-label': label } : {}),
    ...(ctx.annotate && section ? { 'data-section': section } : {}),
  } });
  b.append(h(ctx.doc, 'div', 'band__gutter', { kids: gutter }),
           h(ctx.doc, 'div', 'band__content', { kids: content }));
  return b;
}

const tabs = (ctx, title, cont) => cont
  ? [h(ctx.doc, 'h2', 'tab tab--cont', { html: encode(title) }),
     h(ctx.doc, 'p', 'tab-note', { html: encode(ctx.data.i18n?.[ctx.lang]?.continued ?? ctx.chrome?.continued ?? 'CONTINUED') })]
  : [h(ctx.doc, 'h2', 'tab', { html: encode(title) })];

// The optical nudge goes where the content beside a tab opens with small type
// rather than a 15px role title. Experience does not get it.
function sectionBand(ctx, s, content, cont = false){
  return band(ctx, {
    mod: `band--section${s.kind === 'entries' ? '' : ' band--nudged'}`,
    section: s.id,
    label: cont ? (ctx.chrome?.continued ? `${s.title} · ${ctx.chrome.continued}` : `${s.title} continued`) : s.title,
    gutter: tabs(ctx, s.title, cont),
    content,
  });
}

// sections

export function header(ctx){
  const { doc, data, recipe } = ctx;
  const b = data.basics;
  const gutter = [];

  let p = b.portrait;
  if (recipe.portrait){
    p = (b.altPortraits ?? []).find(x => x.id === recipe.portrait);
    if (!p) throw new RenderError(`the recipe asks for portrait ${recipe.portrait}, which basics.altPortraits does not have`);
  }
  // Without `recipe.photo`, the portrait's own `formats` decide.
  if (recipe.photo && typeof recipe.photo === 'object' && !recipe.portrait){
    if (recipe.photo.show){
      const src = b.image ?? (b.portrait?.state === 'present' ? b.portrait.src : null);
      const shape = ['soft', 'round'].includes(recipe.photo.shape) ? ` portrait--${recipe.photo.shape}` : '';
      if (src && !String(src).startsWith('asset:')) gutter.push(h(doc, 'img', `portrait${shape}`, { attrs: { src, alt: '' } }));
      else gutter.push(h(doc, 'div', `portrait portrait--missing${shape}`, { html: encode(b.portrait?.label ?? 'PHOTO') }));
    }
  } else if (p && (p.formats ?? ['a4']).includes(recipe.format)){
    if (p.state === 'present') gutter.push(h(doc, 'img', 'portrait', { attrs: { src: p.src, alt: '' } }));
    else gutter.push(h(doc, 'div', 'portrait portrait--missing', { html: encode(p.label ?? 'PHOTO') }));
  }
  const tagline = ctx.pick(b.display.label);
  gutter.push(h(doc, 'p', 'tagline', { html: inlineOf(tagline), attrs: mark(ctx, tagline) }));

  // The name sits in the content column, not at the page margin, so it shares a
  // left edge with everything below it.
  const name = ctx.pick(b.display.name);
  const contact = ctx.pick(b.display.contact);
  const content = [
    h(doc, 'div', 'namemark', {
      kids: [h(doc, 'h1', 'name', { html: inlineOf(name), attrs: mark(ctx, name) })] }),
    h(doc, 'p', 'contact', { attrs: mark(ctx, contact),
      html: inlineOf(contact, separatorSpans(contact.text, contact.separator)) }),
  ];
  // Photo off frees the space a4.css reserves for it. Photo on makes the header tall
  // enough that a short contact block can't let the gutter run into the next tab.
  const switched = recipe.photo && typeof recipe.photo === 'object' && !recipe.portrait;
  const photoMod = !switched ? '' : recipe.photo.show ? ' band--photo' : ' band--no-photo';
  // With the photo on, the summary runs beside it in the header. Its own band stays,
  // empty and zero-high, so pagination still finds one band per slot.
  const summary = switched && recipe.photo.show ? (ctx.data.sections ?? []).find(x => x.kind === 'prose' && x.id === 'summary') : null;
  if (summary && ctx.plansSummary){
    const v = ctx.pick(ctx.proseFact(summary));
    content.push(h(doc, 'p', 'summary summary--in-header', { html: inlineOf(v), attrs: mark(ctx, v) }));
    ctx.summaryInHeader = true;
  }
  return band(ctx, { tag: 'header', mod: `band--header${photoMod}`, section: 'header', gutter, content });
}

export function prose(ctx, s){
  if (s.id === 'summary' && ctx.summaryInHeader)
    return band(ctx, { mod: 'band--summary band--absorbed', label: s.title, section: s.id });
  const v = ctx.pick(ctx.proseFact(s));
  return band(ctx, { mod: 'band--summary', label: s.title, section: s.id,
    content: [h(ctx.doc, 'p', 'summary', { html: inlineOf(v), attrs: mark(ctx, v) })] });
}

export function entries(ctx, s, plan = {}){
  const { doc } = ctx;
  const list = h(doc, 'div', 'entries');
  for (const ref of plan.work ?? ctx.workOrder(s)){
    const w = ctx.workEntry(typeof ref === 'string' ? ref : ref.id);
    const only = typeof ref === 'string' ? null : ref.highlights;
    const position = ctx.pick(w.display.position);
    const meta = ctx.pick(w.display.meta);
    const e = h(doc, 'article', 'entry');
    e.append(h(doc, 'h3', 'role-title', { html: inlineOf(position), attrs: mark(ctx, position) }),
             h(doc, 'p', 'meta', { html: inlineOf(meta), attrs: mark(ctx, meta) }));
    const ul = h(doc, 'ul', 'bullets');
    for (const v of ctx.highlights(w, only))
      ul.append(h(doc, 'li', null, { html: inlineOf(v), attrs: mark(ctx, v) }));
    e.append(ul);
    list.append(e);
  }
  return sectionBand(ctx, s, [list], plan.cont);
}

// Deliberately not entries-with-no-bullets: it carries a different type size,
// and that difference is a section-level decision the theme owns.
export function item(ctx, s){
  const { doc } = ctx;
  const c = s.content;
  const t = ctx.pick(c.title);
  let title = inlineOf(t);
  if (c.subtitle){
    const sub = ctx.pick(c.subtitle);
    title += encode(c.titleSeparator ?? ' ')
      + `<span class="item__title-secondary"${markAttr(ctx, sub)}>${inlineOf(sub)}</span>`;
  }
  const meta = ctx.pick(c.meta);
  // The whole title line is annotated, not the title alone: a subtitle shares
  // the line, and the pair's line count is the number the fitter needs.
  return sectionBand(ctx, s, [
    h(doc, 'h3', 'item__title', { html: title, attrs: mark(ctx, t) }),
    h(doc, 'p', 'meta meta--flat', { html: inlineOf(meta), attrs: mark(ctx, meta) }),
  ]);
}

export function grid(ctx, s){
  const { doc } = ctx;
  const g = h(doc, 'div', 'skills');
  // This resume's own arrangement of the skills (recipe.skillArrangement): each group is its skills joined, under its own name or the
  // claim's. The page's copy marks each group and skill so they can be written and moved there; one with no skills prints only there.
  const own = s.id === 'skills' ? ctx.recipe.skillArrangement?.groups : null;
  if (own){
    for (const a of own){
      if (!a.items.length && !ctx.annotate) continue;
      const items = ctx.annotate ? a.items.map(x => `<span data-skill>${encode(x)}</span>`).join(', ') : encode(a.items.join(', '));
      g.append(h(doc, 'p', 'skills__group', { attrs: ctx.annotate ? { 'data-variant': `${a.id}-override`, 'data-group': a.id } : {}, html:
        `<span class="skills__label">${encode(a.label ?? ctx.label(a.id))}</span><br><span class="skills__items">${items}</span>` }));
    }
    return sectionBand(ctx, s, [g]);
  }
  for (const fid of s.content.groups){
    const v = ctx.pick(fid);
    g.append(h(doc, 'p', 'skills__group', { html:
      `<span class="skills__label">${encode(ctx.label(fid))}</span><br>`
      + `<span class="skills__items"${markAttr(ctx, v)}>${inlineOf(v)}</span>` }));
  }
  return sectionBand(ctx, s, [g]);
}

export function pairs(ctx, s){
  const { doc } = ctx;
  const dl = h(doc, 'dl', 'pairs');
  for (const fid of s.content.pairs){
    const v = ctx.pick(fid);
    dl.append(h(doc, 'dt', null, { html: encode(ctx.term(fid)) }),
              h(doc, 'dd', null, { html: inlineOf(v), attrs: mark(ctx, v) }));
  }
  return sectionBand(ctx, s, [dl]);
}

export function runs(ctx, s){
  const sep = s.content.separator ?? RUN_SEP;
  let text = '';
  const strongs = [];
  let note = null;
  for (const [n, fid] of s.content.items.entries()){
    const v = ctx.pick(fid);
    if (n) text += sep;
    const start = [...text].length;
    text += v.text;
    strongs.push({ start, end: [...text].length,
      open: `<strong${markAttr(ctx, v)}>`, close: '</strong>' });
    if (v.note) note = v.note;
  }
  if (note) text += (s.content.noteSeparator ?? RUN_NOTE) + note;
  const html = renderInline(text, [...strongs, ...gapSpans(text)].sort((a, b) => a.start - b.start));
  return sectionBand(ctx, s, [h(ctx.doc, 'p', 'runs', { html })]);
}

const KINDS = { header, prose, entries, item, grid, pairs, runs };


function makeCtx(data, recipe, doc, opts){
  const variants = new Map((data.variants ?? []).map(v => [v.id, v]));
  const facts    = new Map((data.facts ?? []).map(f => [f.id, f]));
  const works    = new Map(entriesOf(data).map(w => [w.id, w]));
  const sections = new Map((data.sections ?? []).map(s => [s.id, s]));
  const chosen   = new Map();

  // Language is filtered before any selection: a phrasing in another language is
  // never a substitute in the same document. That is why language is not a variant axis.
  const lang = recipe.lang ?? 'en';
  const inLang = v => (v?.lang ?? 'en') === lang;

  const probing = Number.isInteger(opts.probe);

  // Explicit pick wins; then a phrasing written for this format; then the
  // single -base phrasing; then the first. Anything cleverer is fit.js's job.
  const pick = ref => {
    if (!ref) throw new RenderError('a section asked for a phrasing and named none');
    const f = facts.get(ref);
    if (!f && !isLocal(recipe, ref)){
      if (variants.has(ref)) return variants.get(ref);
      throw new RenderError(`no such fact: ${ref}`);
    }
    if (chosen.has(ref)) return chosen.get(ref);

    let v;
    const over = probing && f ? undefined : recipe.overrides?.[ref] ?? (f ? undefined : '');   // a line only on this resume has no versions
    const want = probing ? undefined : recipe.picks?.[ref];
    if (over !== undefined){
      const sep = f?.variants.map(id => variants.get(id)?.separator).find(Boolean);      // the contact line keeps the look of its separators
      v = { id: `${ref}-override`, text: over, marks: recipe.overrideMeta?.[ref]?.marks ?? [], links: [], override: true, ...(sep ? { separator: sep } : {}),      // an edit keeps its highlights
            source: `recipe override — ${recipe.application ?? 'this application'}`,
            metrics: { chars: [...over].length, measured: {} } };
    } else if (want){
      if (!variants.has(want)) throw new RenderError(`the recipe picks ${want} for ${ref}, which does not exist`);
      if (!f.variants.includes(want)) throw new RenderError(`the recipe picks ${want} for ${ref}, which is not one of its phrasings`);
      v = variants.get(want);
      // A mixed-language document looks fine until a recruiter reads it.
      if (!inLang(v))
        throw new RenderError(`the recipe picks ${want} for ${ref}, which is lang "${v.lang ?? 'en'}", in a lang "${lang}" document`);
    } else {
      const vs = f.variants.map(id => variants.get(id)).filter(Boolean).filter(inLang);
      v = probing
        ? vs[Math.min(opts.probe, vs.length - 1)]
        : vs.find(x => (x.seenIn ?? []).includes(recipe.format))
          ?? vs.find(x => x.id.endsWith('-base'))
          ?? vs[0];
      // A fact in data.same prints its English phrasing in any language. With
      // opts.fallback (the app, which outlines it) so does any fact; the CLI throws.
      if (!v && (data.same?.includes(`fact:${ref}`) || opts.fallback)){
        const ens = f.variants.map(id => variants.get(id)).filter(Boolean).filter(x => (x.lang ?? 'en') === 'en');
        v = probing ? ens[Math.min(opts.probe, ens.length - 1)]
          : ens.find(x => (x.seenIn ?? []).includes(recipe.format)) ?? ens.find(x => x.id.endsWith('-base')) ?? ens[0];
      }
      if (!v){
        const had = f.variants.map(id => variants.get(id)?.lang ?? 'en');
        const e = new RenderError(`fact ${ref} has no "${lang}" phrasing to render` +
          (had.length ? ` — it has ${[...new Set(had)].join(', ')}` : ''));
        e.missingLang = true;
        throw e;
      }
    }
    chosen.set(ref, v);
    return v;
  };

  // A resume can leave single items out of a list section (its `off` names them, as it does a bullet) and print
  // them in its own order (the section's `order` in the recipe). With neither, the section is exactly the record's.
  const LIST = { grid: 'groups', pairs: 'pairs', runs: 'items' };
  const off = new Set(offOf(recipe));
  const shaped = s => {
    const key = s && LIST[s.kind];
    if (!key) return s;
    const was = s.content[key] ?? [];
    const order = recipe.sections?.find(x => x && typeof x === 'object' && x.id === s.id)?.order;
    let list = was;
    if (Array.isArray(order) && order.length) list = [...order.filter(x => was.includes(x)), ...was.filter(x => !order.includes(x))];
    if (off.size) list = list.filter(x => !off.has(x));
    return list.length === was.length && list.every((x, i) => x === was[i]) ? s : { ...s, content: { ...s.content, [key]: list } };
  };

  const slotsOf = new Map(), slotAt = new Map();   // a job's slots in the plan, and how many of them are drawn
  return {
    slotsOf,
    doc, data, recipe, pick, chosen, annotate: !!opts.annotate,
    // src/i18n docChrome, for a non-English resume in the app only.
    chrome: lang !== 'en' && opts.chrome?.lang === lang ? opts.chrome : null,
    fact: id => facts.get(id) ?? {},
    workEntry: id => {
      const w = works.get(id);
      if (!w) throw new RenderError(`no such work entry: ${id}`);
      return w;
    },
    section: id => {
      const s = shaped(sections.get(id));
      if (!s) throw new RenderError(`no such section: ${id}`);
      // A recipe's label (a string, or { lang: string }) wins. A missing translation
      // falls back to English rather than failing: one English tab is fixable, a
      // document that won't render is not.
      const own = recipe.sections?.find(x => x && typeof x === 'object' && x.id === id)?.label;
      const label = typeof own === 'string' ? own : own?.[lang];
      if (label && s.kind !== 'header') return { ...s, title: label };
      const t = data.i18n?.[lang]?.sections?.[id]
        ?? (lang !== 'en' && opts.chrome?.lang === lang ? opts.chrome.kinds?.[id] ?? opts.chrome.sections?.[id] : undefined);
      return t ? { ...s, title: t } : s;
    },
    lang,
    term: fid => data.i18n?.[lang]?.terms?.[fid] ?? facts.get(fid)?.term ?? fid,
    label: fid => data.i18n?.[lang]?.labels?.[fid] ?? facts.get(fid)?.label ?? '',
    proseFact: s => (s.id === 'summary' && recipe.summary) || s.content.fact,
    workOrder: s => { const e = recipe.sections?.find(x => x.id === s.id); return inOrder(e?.work ?? s.content.work, e?.order); },
    // A merged phrasing drops the facts it covers, so nothing prints twice.
    highlights: (w, only) => {
      const base = only ?? w.highlights;
      for (const id of base)
        if (!w.highlights.includes(id))
          throw new RenderError(`the recipe asks ${w.id} for ${id}, which is not one of its highlights`);
      const mine = slotsOf.get(w.id) ?? [], n = slotAt.get(w.id) ?? 0;
      slotAt.set(w.id, n + 1);
      const ids = withLocal(recipe, w.id, base, { blank: !!opts.annotate, full: w.highlights,
        slots: mine.length > 1 ? { union: mine.flatMap(x => x ?? w.highlights), first: n === 0 } : null });
      // A covered fact never prints, so it needs no phrasing in this language.
      const picked = ids.map(id => {
        try { return [id, pick(id), null]; }
        catch (e){ if (e instanceof RenderError && e.missingLang) return [id, null, e]; throw e; }
      });
      const covered = new Set();
      if (!probing) for (const [, v] of picked) for (const c of v?.covers ?? []) covered.add(c);
      // A probe ignores `covers`, so a fact with no phrasing in this language is skipped.
      for (const [id, v, e] of picked) if (!v && !covered.has(id) && !probing) throw e;
      return picked.filter(([id, v]) => v && !covered.has(id)).map(([, v]) => v);
    },
  };
}

// pages

// A section named on more than one page continues across the break.
function planPages(data, recipe){
  const kept = slot => !isOmitted(data, recipe, slot.id);
  if (recipe.pages)
    return recipe.pages.map(p => p.map(x => typeof x === 'string' ? { id: x } : x).filter(kept));
  const have = new Set((data.sections ?? []).map(s => s.id));
  const ids = ['header', 'summary', ...(recipe.sections ?? []).map(s => s.id)];
  return [[...new Set(ids)].filter(id => have.has(id)).map(id => ({ id })).filter(kept)];
}

export function renderPages(data, recipe, doc = globalThis.document, opts = {}){
  const ctx = makeCtx(data, recipe, doc, opts);
  const plan = planPages(data, recipe);
  ctx.plansSummary = plan.some(slots => slots.some(x => x.id === 'summary'));
  for (const r of plan.flat().flatMap(s => s.work ?? [])){
    const id = typeof r === 'string' ? r : r.id;
    ctx.slotsOf.set(id, [...(ctx.slotsOf.get(id) ?? []), typeof r === 'string' ? null : r.highlights]);
  }
  const seen = new Map();
  const pages = [];

  plan.forEach((slots, n) => {
    const page = h(doc, 'article', 'page');
    for (const slot of slots){
      const s = ctx.section(slot.id);
      const fn = KINDS[s.kind];
      if (!fn) throw new RenderError(`section ${s.id}: unknown kind ${JSON.stringify(s.kind)}`);
      const cont = (seen.get(s.id) ?? 0) > 0;
      seen.set(s.id, (seen.get(s.id) ?? 0) + 1);
      const el = s.kind === 'entries' ? fn(ctx, s, { work: slot.work, cont }) : fn(ctx, s);
      // Opt-in slot keys. `style` adds a band modifier (a4-hu.css "sub": a section
      // grouped under the one above, with a quiet label). `qr` names a basics.codes image.
      if (slot.style) el.className += ` band--${slot.style}`;
      if (slot.qr){
        const code = (data.basics?.codes ?? []).find(c => c.id === slot.qr);
        if (!code) throw new RenderError(`the recipe asks for code ${slot.qr}, which basics.codes does not have`);
        // Not in the gutter, where it hangs below its text. No caption: the link is on the first row.
        const c = el.querySelector?.('.band__content') ?? el.children?.[1];
        c.append(h(doc, 'img', 'qr', { attrs: { src: code.src, alt: `QR: ${code.label}` } }));
      }
      page.append(el);
    }
    // A two-page CV whose sheets get separated needs the name on both.
    if (plan.length > 1 && recipe.pageMark)
      page.append(h(doc, 'p', 'page-mark', { html:
        // The `name` phrasing, not basics.name: a Hungarian CV puts the surname first.
        encode(`${ctx.pick(data.basics.display?.name ?? 'name').text} · ${recipe.pageMark} · ${n + 1} / ${plan.length}`) }));
    pages.push(page);
  });

  return { pages, ctx };
}

export function mount(root, data, recipe, opts = {}){
  const doc = opts.doc ?? root.ownerDocument ?? globalThis.document;
  const { pages, ctx } = renderPages(data, recipe, doc, opts);
  if (root.replaceChildren) root.replaceChildren(...pages);
  else for (const p of pages) root.append(p);
  return ctx;
}

// measuring

// Cached per {format}@{theme} (one line in the 528px Letter column can be two in
// the 466px A4 one), with the column width so a stale entry is detectable.
export function countLines(el){
  const range = (el.ownerDocument ?? globalThis.document).createRange();
  range.selectNodeContents(el);
  const tops = new Set();
  for (const r of range.getClientRects())
    if (r.width > 0 && r.height > 0) tops.add(Math.round(r.top * 4) / 4);
  range.detach?.();
  return tops.size;
}

export function measureVariants(root){
  const col = root.querySelector('.band__content');
  const lines = {};
  for (const el of root.querySelectorAll('[data-variant]')){
    const n = countLines(el);
    if (n) lines[el.getAttribute('data-variant')] = n;
  }
  return { colWidth: col ? Math.round(col.getBoundingClientRect().width) : null, lines };
}

// Only the fitter reads `measured`, so it can be deleted; it regenerates on render.
export function applyMeasured(data, key, measurement, at = new Date().toISOString().slice(0, 10)){
  const byId = new Map((data.variants ?? []).map(v => [v.id, v]));
  const written = [];
  for (const [id, lines] of Object.entries(measurement.lines ?? {})){
    const v = byId.get(id);
    if (!v) continue;                       // a recipe override has no home in the library
    v.metrics ??= { chars: [...v.text].length };
    v.metrics.measured ??= {};
    v.metrics.measured[key] = { lines, colWidth: measurement.colWidth, at };
    written.push(id);
  }
  return written;
}

export const measureKey = recipe => `${recipe.format}@${recipe.theme}`;

// A page is full by pixels, not line counts, as checks/pagefit.mjs measures it,
// leaving out absolutely positioned furniture (.page-mark). The fitter checks its plan here.
export function pageFill(raw){
  const usable = raw.pageHeight - raw.padTop - raw.padBottom;
  const kids = raw.kids ?? [];
  const used = kids.length ? kids[kids.length - 1].bottom - kids[0].top : 0;
  const overflow = (raw.scrollHeight ?? 0) - (raw.clientHeight ?? 0);
  // The first band ending below the content box is the one that overflowed.
  const limit = raw.pageTop + raw.pageHeight - raw.padBottom;
  const bands = raw.bands ?? [];
  const past = bands.find(b => b.bottom > limit + 0.5) ?? null;
  const lineH = raw.lineH ?? null;
  return {
    usable, used,
    slack: usable - used,
    slackLines: lineH ? (usable - used) / lineH : null,
    fill: usable > 0 ? 100 * used / usable : 0,
    overflow,
    lineH,
    bands,
    overflowSection: overflow > 0 || past ? (past?.section ?? null) : null,
  };
}

// Read from the document, never assumed, because the theme owns it.
function bodyLineHeight(root, view){
  const li = root.querySelector('.bullets li');
  if (!li) return null;
  const cs = view.getComputedStyle(li);
  const lh = parseFloat(cs.lineHeight);
  if (Number.isFinite(lh)) return lh;                       // "normal" does not parse
  const fs = parseFloat(cs.fontSize);
  return Number.isFinite(fs) ? fs * 1.2 : null;
}

export function measurePages(root){
  const doc = root.ownerDocument ?? globalThis.document;
  const view = doc.defaultView ?? globalThis;
  const lineH = bodyLineHeight(root, view);
  return [...root.querySelectorAll('.page')].map((pg, n) => {
    const cs = view.getComputedStyle(pg);
    const r = pg.getBoundingClientRect();
    const kids = [...pg.children]
      .filter(el => { const p = view.getComputedStyle(el).position; return p !== 'absolute' && p !== 'fixed'; })
      .map(el => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; });
    const bands = [...pg.querySelectorAll('.band')].map(el => {
      const b = el.getBoundingClientRect();
      return { section: el.getAttribute('data-section') ?? el.getAttribute('aria-label') ?? null,
               top: b.top, bottom: b.bottom };
    });
    return { page: n + 1, ...pageFill({
      pageTop: r.top, pageHeight: r.height,
      padTop: parseFloat(cs.paddingTop), padBottom: parseFloat(cs.paddingBottom),
      scrollHeight: pg.scrollHeight, clientHeight: pg.clientHeight,
      kids, bands, lineH,
    }) };
  });
}

// probe

// The fitter swaps to phrasings it has never seen laid out. K passes, pass k printing
// every fact's k-th phrasing (opts.probe = k), give each one a line count.
export function probeCount(data, recipe){
  const lang = recipe.lang ?? 'en';
  const variants = new Map((data.variants ?? []).map(v => [v.id, v]));
  let k = 1;
  for (const f of data.facts ?? [])
    k = Math.max(k, (f.variants ?? []).filter(id => (variants.get(id)?.lang ?? 'en') === lang).length);
  return k;
}

// The recipe's own format and theme, so the column width is the printed one.
export function probeRecipe(data, recipe){
  return {
    application: `${recipe.application ?? 'recipe'} (probe)`,
    format: recipe.format, theme: recipe.theme, overlays: recipe.overlays ?? [],
    ...(recipe.lang ? { lang: recipe.lang } : {}),
    ...(recipe.summary ? { summary: recipe.summary } : {}),
    sections: (data.sections ?? []).filter(s => s.kind === 'entries').map(s => ({ id: s.id, work: s.content.work })),
    picks: {}, overrides: {},
    pages: [(data.sections ?? []).map(s => s.id)],
  };
}

export function defaultRecipe(data, format = 'us-letter', theme = 'b2-marker'){
  const ids = (data.sections ?? []).map(s => s.id);
  return {
    application: `${data.basics?.name ?? 'Untitled'} — ${format}`,
    date: new Date().toISOString().slice(0, 10),
    format, theme, overlays: [],
    sections: (data.sections ?? []).filter(s => s.kind === 'entries')
      .map(s => ({ id: s.id, work: s.content.work })),
    picks: {}, overrides: {},
    pages: [ids],
  };
}
