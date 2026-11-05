// Career, drawn as the whole career in one scroll: About you, the timeline on a spine (work in the left lane, the rest in the right, in the
// app's year bands), then Skills & credentials as cards. Everything is edited where it is: a card opens its lines, a line fans out its
// wordings, a pencil opens an entry's own fields, a section's pencil turns its rows into fields. One editor is open at a time. Career reads
// in a language of its own (ui.careerLang): a text not written in it shows the English, marked, with a way to write it. With a resume open
// and its picks shown, the lines it prints are ticked and the rest are soft. The sidebar follows what is open: an entry, a line, a section,
// About you, or, with nothing open, the languages and what is left to write in each. Every change is one store commit, one undo step.

import * as K from '../model/career.js';
import * as R from '../model/record.js';
import * as T from '../model/resume.js';
import * as RS from '../model/resumes.js';
import { guard } from '../model/lock.js';
import { isArchived } from '../model/entries.js';
import { langsInUse, langName, setSame, sameKey } from '../model/lang.js';
import { fmtMonth, presentIn, setEducation, setSummary, slug } from '../model/build.js';
import { save, serialize } from '../model/schema.js';
import { t, h, errText } from '../i18n/index.js';
import { icon } from './icons.js';
import { kindChip, kindHue, SWATCH_HUES } from './career.js';
import { monthFieldHtml, initMonthPick } from './monthpick.js';
import { reduced } from './motion.js';

let C = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const one = s => String(s ?? '').replace(/\s*\n\s*/g, ' ').trim();
const st = () => C.store.state;
const rec = () => st().record;
const L = () => C.lang();
const U = l => l.toUpperCase();
const lname = l => langName(l);

// view state; none of it is undone or saved
const S = {
  open: new Set(),        // entries whose lines are shown
  all: false,             // Expand all: every entry open, read only
  fan: new Map(),         // fact id → 'words' (its wordings) or 'write' (the English over an empty box)
  editing: null,          // the one wording editor: { kind: 'edit' | 'new' | 'line', fact | entry, vid }
  drafts: new Map(),      // an editor's typed text, kept over a redraw
  adding: null,           // the kind of entry whose add card is open in the page
  inl: null,              // the one-line add open in its card: skills, languages, interests, references, summary
  secEdit: null,          // the section whose rows are fields
  detail: null,           // the entry whose own fields are open
  about: false,           // About you's own fields are open
  skWrite: null, skAdd: null, iwrite: null, iadd: false,      // a skill word or an interest being written, a group or the interests getting a word
  ctx: null,              // what the sidebar speaks of: { card } | { line } | { sec } | null
  kind: null,             // the kind editor: { id | null, draft, del }
  focus: null,            // a selector to focus after the next draw
  reveal: false,          // scroll what gets the focus into view (an add, a kind, a jump from the sidebar); nothing else scrolls
  drag: null,
};
const anyOpen = () => !!(S.fan.size || S.open.size || S.all || S.editing || S.adding || S.inl || S.secEdit || S.detail || S.about || S.skWrite || S.skAdd || S.iwrite || S.iadd || S.ctx || S.kind);
// one editor at a time: opening any editor closes the others; `card` is the entry that stays open
function solo(card = null){
  Object.assign(S, { editing: null, adding: null, kind: null, inl: null, secEdit: null, detail: null, about: false, skWrite: null, skAdd: null, iwrite: null, iadd: false, all: false, ctx: card ? { card } : null });
  S.fan.clear(); S.open.clear(); S.drafts.clear();
  if (card) S.open.add(card);
  closePop();
  C.record.release?.();      // the inspector gives the sidebar back
}
const draw = () => C.renderBody();

// ---- reading the record in one language: a pure document, cached for each record state and language ----
const sameFact = (m, id) => (m.same ?? []).includes(sameKey(id));
const versionsIn = (m, id, lang) => { const f = m.facts.find(x => x.id === id); return (f?.variants ?? []).map(v => m.variants.find(x => x.id === v)).filter(v => v && (v.lang ?? 'en') === lang); };
function wording(m, id, lang){
  if (!id) return null;
  const f = m.facts.find(x => x.id === id); if (!f) return null;
  const v = T.defaultVariant(m, id, lang);
  if (v && (v.lang ?? 'en') === lang) return { text: v.text, ok: true, nv: versionsIn(m, id, lang).length, review: (v.tags ?? []).includes('needs-review') };
  const e = T.defaultVariant(m, id, 'en') ?? m.variants.find(x => x.id === f.variants[0]);
  return e ? { text: e.text, ok: sameFact(m, id), nv: f.variants.length, review: false, fallback: !sameFact(m, id) } : null;
}
const need = w => !!w && !w.ok;
const LISTS = ['languages', 'certificates', 'publications', 'interests'];
const cache = new WeakMap();
function doc(m, lang){
  let byLang = cache.get(m);
  if (!byLang) cache.set(m, byLang = new Map());
  if (!byLang.has(lang)) byLang.set(lang, build(m, lang));
  return byLang.get(lang);
}
function build(m, lang){
  const b = m.basics ?? {}, d = b.display ?? {};
  const about = { name: wording(m, d.name, lang) ?? { text: b.name ?? '', ok: true }, tagline: wording(m, d.label, lang), contact: wording(m, d.contact, lang), summary: wording(m, b.summary, lang) };
  const entries = K.timelineLayout(m, { lang }).entries.filter(v => !v.archived).map(v => {
    const lines = (v.claimIds ?? []).filter(id => !isArchived(m, id)).map(id => ({ id, ...wording(m, id, lang) })).filter(x => x.text != null);
    return { ...v, grp: v.id, lines, hay: [v.title, v.org, v.place, ...lines.map(x => x.text)].join(' ').toLowerCase(),
      toWrite: lines.filter(need).length + (v.titleMissing && lang !== 'en' ? 1 : 0) };
  });
  const labels = m.i18n?.[lang]?.labels ?? {}, bank = m.skillBank?.words ?? [];
  const skills = (m.skills ?? []).map(g => {
    const name = lang === 'en' ? g.name : labels[g.id] ?? '';
    const words = (g.keywords ?? []).map(k => { const w = bank.find(x => x.name === k); const tx = lang === 'en' || w?.same ? k : labels[w?.id] ?? ''; return { text: tx || k, miss: !tx && !!w }; });
    return { id: g.id, name: name || g.name, miss: !name, words };
  });
  const lists = new Map(K.recordLists(m, { lang }).map(g => [g.group, g]));
  const secs = [{ id: 'skills', kind: 'skills', label: t('cv.sec.skills'), groupsOf: skills, count: skills.length, toWrite: skills.reduce((n, g) => n + g.miss + g.words.filter(w => w.miss).length, 0) }];
  for (const k of LISTS){ const items = lists.get(k)?.items ?? []; secs.push({ id: k, kind: k, label: t(`cv.sec.${k}`), items, count: items.length, toWrite: items.filter(x => x.titleMissing).length }); }
  for (const g of lists.values()) if ((g.kind || g.group === 'references') && g.items.length)
    secs.push({ id: g.kind ?? 'references', kind: g.kind ?? 'references', label: g.kind ? K.kindName(m, g.kind, lang) : t('cv.sec.references'), items: g.items, count: g.items.length, toWrite: 0 });
  const aboutToWrite = [about.tagline, about.contact, about.summary].filter(need).length;
  return { lang, about, entries, secs, toWrite: aboutToWrite + entries.reduce((n, e) => n + e.toWrite, 0) + secs.reduce((n, s) => n + s.toWrite, 0) };
}
const languages = (m = rec()) => langsInUse(m);
const toWriteIn = l => doc(rec(), l).toWrite;

// ---- the resume open in Career, and its picks ----
const cur = () => (st().closed ? null : st().cur);
const lensOn = () => !!cur() && !!RS.savedOf(st(), st().openId) && !C.ui.careerWhole;
const refId = r => (typeof r === 'string' ? r : r?.id);
function printed(e){
  const c = cur(); if (!c || !e.lines.length) return null;
  try {
    if (!T.jobOfFact(rec(), e.lines[0].id)) return null;
    return T.jobRefs(rec(), c).some(r => refId(r) === e.id) ? new Set(T.listedBullets(rec(), c, e.id)) : new Set();
  } catch { return null; }
}
const cbx = (attrs, on, label) => `<input type="checkbox" class="cb press" data-tier="tertiary" ${attrs} ${on ? 'checked' : ''} aria-label="${esc(label)}">`;

// ---- the one write path: a store commit is one undo step; a refusal (a lock, a missing source) is a toast and what was typed stays ----
function commit(fn, label, done){
  const a = document.activeElement;
  if (a?.closest?.('.ce-doc') && a.matches('input, textarea')) a.blur();      // a field with the focus would hold the redraw
  try { const ok = C.store.commit(d => { fn(d); }, label); if (ok && done) C.toast(done); return true; }
  catch (e){ C.toast(errText(e), 'bad'); return false; }
}
const pick = (d, f, vid) => { if (d.cur && !st().closed && (d.cur.lang ?? 'en') === L()){ guard(d.record, d.cur, f); T.pickVersion(d.record, d.cur, f, vid); } };

// ---- a line's wordings, fanned out under it ----
const ekey = e => `${e.kind}:${e.fact ?? e.entry}:${e.vid ?? ''}`;
const isEd = e => !!S.editing && ekey(S.editing) === ekey(e);
const ta = (e, seed, ph) => `<textarea id="ce-ta" class="ce-ed" data-ce-ta="${esc(ekey(e))}" placeholder="${esc(ph)}" spellcheck="false" aria-label="${esc(ph || t('cv.wording'))}">${esc(S.drafts.get(ekey(e)) ?? seed)}</textarea>`;
const btn = (act, label, extra = '', cls = '') => `<button type="button" class="ce-b ${cls === 'pri' ? 'primary' : cls}" data-act="cv-${act}" ${extra}>${label}</button>`;
const num = (n, sub = '') => `<span class="ce-vnc"><span class="ce-vn">${esc(n)}</span>${sub}</span>`;
// the words of `text` that the first wording lacks, marked
const diff = (text, base) => { const have = new Set(one(base).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []); return esc(one(text)).replace(/[\p{L}\p{N}]+/gu, w => (have.has(w.toLowerCase()) ? w : `<mark class="ce-d">${w}</mark>`)); };
function fanHtml(id, text, lang, mode){
  const m = rec(), f = m.facts.find(x => x.id === id), c = cur();
  const vs = versionsIn(m, id, lang), en = versionsIn(m, id, 'en')[0];
  const canUse = !!c && lensOn() && (c.lang ?? 'en') === lang, thisId = canUse ? T.chooseVariant(m, id, c).v?.id : null;
  let out = '';
  if (mode === 'write' || !vs.length){
    out += `<div class="ce-v ce-en">${num(`EN v${en?.n ?? ''}`)}<div class="cvb"><div class="cvt">${esc(one(en?.text ?? text))}</div></div></div>
      <div class="ce-v is-edit">${num(`${U(lang)} v${en?.n ?? ''}`)}<div class="cvb">${ta({ kind: 'write', fact: id }, '', t('cv.writeAs', { lang: lname(lang), n: en?.n ?? '' }))}<div class="cva">${btn('save', h('cv.save'), `data-m="write" data-f="${esc(id)}"`, 'pri')}${btn('cancel', h('btn.cancel'), `data-f="${esc(id)}"`, 'ghost')}</div></div></div>`;
  } else {
    out += `<div class="ce-cmp">${h('cv.wordingsIn', { n: vs.length, lang: lname(lang) })}</div>`;
    out += vs.map((v, i) => {
      const e = { kind: 'edit', fact: id, vid: v.id }, ed = isEd(e), mine = v.id === thisId;
      const sub = `${f?.default?.[lang] === v.id ? `<span class="ce-vd">${h('cv.default')}</span>` : ''}${(v.tags ?? []).includes('needs-review') ? `<span class="ce-vd">${h('cv.review')}</span><button type="button" class="ce-tb ce-read" data-act="cv-read" data-v="${esc(v.id)}" title="${esc(t('cv.markReadTip'))}">${h('cv.markRead')}</button>` : ''}`;
      const body = ed ? `${ta(e, one(v.text), '')}<div class="cva">${btn('save', h('cv.save'), 'data-m="over"', 'pri')}${btn('save', h('cv.saveAsNew'), 'data-m="as"')}${btn('cancel', h('btn.cancel'), '', 'ghost')}</div>`
        : `<div class="cvt">${i ? diff(v.text, vs[0].text) : esc(one(v.text))}</div>`;
      const act = ed ? '' : `<div class="cvact">${canUse ? `<label class="ce-use" title="${esc(t(mine ? 'cv.usePrinted' : 'cv.useTip'))}"><input type="radio" class="cb press" data-tier="tertiary" name="ce-use-${esc(id)}" data-act="cv-use" data-f="${esc(id)}" data-v="${esc(v.id)}"${mine ? ' checked' : ''}>${h('cv.use')}</label>` : ''}<button type="button" class="ce-tb" data-act="cv-edit" data-f="${esc(id)}" data-v="${esc(v.id)}">${h('cv.edit')}</button></div>`;
      return `<div class="ce-v${mine ? ' is-this' : ''}${ed ? ' is-edit' : ''}">${num(`v${v.n}`, sub)}<div class="cvb">${body}</div>${act}</div>`;
    }).join('');
    const ne = { kind: 'new', fact: id };
    out += isEd(ne) ? `<div class="ce-v is-edit">${num(t('cv.new'))}<div class="cvb">${ta(ne, '', t('cv.newIn', { lang: lname(lang) }))}<div class="cva">${btn('save', h('cv.save'), 'data-m="new"', 'pri')}${btn('cancel', h('btn.cancel'), '', 'ghost')}</div></div></div>`
      : `<button type="button" class="ce-new" data-act="cv-newv" data-f="${esc(id)}">${h('cv.newWording')}</button>`;
  }
  return `<div class="ce-fan">${out}</div>`;
}
// a stack: one thin edge behind the row for each wording past the first (four at most)
const stack = n => (n > 0 ? ` data-nv="${Math.min(4, n)}"` : '');
const marks = (w, lang, id) => `${need(w) ? `<span class="mark" data-act="cv-writeln" data-f="${esc(id)}">${h('cv.writeIn', { lang: U(lang) })}</span>` : ''}${w.review ? `<span class="mark rev">${h('cv.review')}</span>` : ''}`;
function lineHtml(l, lang, lit){
  const mode = S.fan.get(l.id), lens = !!lit && lensOn(), on = lens && lit.has(l.id);
  let pn = '';
  if (on){ const v = T.chooseVariant(rec(), l.id, cur()).v; if (v) pn = `<span class="pn" title="${esc(t('cv.prints'))}">v${esc(v.n)}</span>`; }
  const tick = lens ? cbx(`data-act="cv-tick" data-f="${esc(l.id)}"`, on, t('cv.tickLine')) : '';
  return `<div class="ce-ln${mode ? ' is-open' : ''}${l.fallback ? ' is-miss' : ''}${lens ? (on ? ' is-lit' : ' is-unlit') : ''}" data-ce-fact="${esc(l.id)}">
    <div class="ce-row">${tick}<div class="ce-sk"${stack(mode || l.fallback ? 0 : (l.nv ?? 1) - 1)}><button type="button" class="ce-line" data-act="cv-line" data-f="${esc(l.id)}" aria-expanded="${!!mode}"><span class="tx">${esc(one(l.text))}</span>${marks(l, lang, l.id)}${pn}${!l.fallback && l.nv > 1 ? `<span class="nv" title="${esc(t('cv.nWordings', { n: l.nv }))}">${l.nv}</span>` : ''}</button></div></div>
    ${mode ? fanHtml(l.id, l.text, lang, mode) : ''}</div>`;
}

const duringName = id => { const m = rec(); return m.work?.find(w => w.id === id)?.name ?? m.education?.find(x => x.id === id)?.institution ?? id; };
const kindLabel = (k, lang) => (['work', 'education', 'project'].includes(k) ? t(`career.kind.${k}`) : K.kindName(rec(), k, lang));

// ---- the timeline: the app's year bands, newest first, "Now" on top; work in the left lane, the rest in the right ----
const pencil = (act, label, on, extra = '', cls = '') => `<button type="button" class="ce-dt${cls}${on ? ' is-on' : ''}" data-act="${act}" ${extra} title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="${on}">${icon('edit', { role: 'inline' })}</button>`;
// an entry's own fields: a job's or a project's Details, opened; an education entry's form, without its panel's heading
function fieldsOfEntry(e){
  const own = C.career.detailsHtml(e.grp);
  if (own) return own.replace('<details ', '<details open ');
  const tp = document.createElement('template'); tp.innerHTML = C.career.panel({ kind: 'record', what: 'entry', key: e.key, id: e.id });
  return tp.content.querySelector('.detbox')?.outerHTML ?? '';
}
function card(e, lang, q, lane){
  const dates = [e.start && fmtMonth(e.start, lang), e.start && (e.end ? fmtMonth(e.end, lang) : presentIn(lang))].filter(Boolean).join(' – ');
  const sub = [e.kind === 'work' ? '' : kindLabel(e.kind, lang), e.org, e.place, e.during ? t('career.during', { org: duringName(e.during) }) : ''].filter(Boolean).join(' · ');
  const lit = printed(e), lens = !!lit && lensOn(), claimable = e.kind === 'work' || e.kind === 'project' || K.kindOf(rec(), e.kind)?.place === 'timeline';
  const canOpen = !!(e.lines.length || claimable), isOpen = canOpen && (S.open.has(e.grp) || !!q), miss = e.lines.filter(l => l.fallback).length;
  const sum = !canOpen ? '' : [t('cv.nLines', { n: e.lines.length }), lens ? t('cv.nHere', { n: lit.size }) : '', miss ? t('cv.nToWrite', { n: miss }) : ''].filter(Boolean).join(' · ');
  const ne = { kind: 'line', entry: e.grp };
  const nl = !claimable ? '' : isEd(ne)
    ? `<div class="ce-v is-edit ce-nl">${num(t('cv.new'))}<div class="cvb">${ta(ne, '', t('cv.newLinePh'))}<div class="cva">${btn('save', h('cv.save'), 'data-m="line"', 'pri')}${btn('cancel', h('btn.cancel'), '', 'ghost')}</div></div></div>`
    : `<button type="button" class="ce-new ce-nline" data-act="cv-newline" data-g="${esc(e.grp)}">${h('cv.newLine')}</button>`;
  const det = S.detail === e.grp ? `<div class="ce-det">${fieldsOfEntry(e)}<div class="ce-detf">${btn('details', h('cv.done'), `data-g="${esc(e.grp)}"`)}</div></div>` : '';
  const edit = pencil('cv-details', t('cv.editDetails', { name: e.title }), S.detail === e.grp, `data-g="${esc(e.grp)}"`);
  const head = `<span class="node">${kindChip(e.kind)}</span><span class="t"><span class="tt"><b class="${e.titleMissing ? 'is-miss' : ''}">${esc(e.title)}</b>${edit}</span><small>${esc(sub)}</small>${sum ? `<em class="ce-sum">${esc(sum)}</em>` : ''}</span><span class="d">${esc(dates)}</span>`;
  return `<div class="ce-card k${lane}${isOpen ? ' is-open' : ''}" data-ce-card="${esc(e.grp)}" data-key="${esc(e.key)}" style="--hk:${kindHue(e.kind)}">
    <div class="ce-ch${canOpen ? ' is-tog' : ''}" ${canOpen ? `data-act="cv-tog" data-g="${esc(e.grp)}" role="button" tabindex="0" aria-expanded="${isOpen}"` : ''}>${head}${claimable ? `<button type="button" class="ce-hadd ce-cline" data-act="cv-newline" data-g="${esc(e.grp)}">${h('cv.addLine')}</button>` : ''}</div>${det}
    ${isOpen ? `<div class="ce-lines">${e.lines.map(l => lineHtml(l, lang, lit)).join('')}${nl}</div>` : ''}</div>`;
}
function timeline(d, lang, q){
  const by = new Map(d.entries.filter(e => !q || e.hay.includes(q)).map(e => [e.id, e]));
  const lane = (xs, k) => xs.filter(x => by.has(x.id)).map(x => card(by.get(x.id), lang, q, k)).join('');
  const bands = K.timelineLayout(rec(), { lang, hideArchived: true }).bands.map(b => ({ y: b.year, main: lane(b.main, 1), side: lane(b.side, 2) })).filter(b => b.main || b.side);
  const rows = bands.map(b => `<div class="ce-yr">${esc(b.y ?? t('career.nowBand'))}</div><div class="ce-yrow"><div class="ce-lane">${b.main}</div><div class="ce-lane">${b.side}</div></div>`).join('');
  const top = kindPlace() === 'timeline' ? kindEditor() : S.adding && !['certificates', 'publications'].includes(S.adding) && !isListKind(S.adding) ? addCard(S.adding) : '';
  const plus = (label, attrs) => `<button type="button" class="ce-hadd" ${attrs} title="${esc(label)}" aria-label="${esc(label)}">${icon('plus', { role: 'inline' })}</button>`;
  const heads = `<div class="ce-lhs"><span class="ce-lh"><span>${h('career.colMain')}</span>${plus(t('cv.addJob'), 'data-act="cv-add" data-what="work"')}</span>
    <span class="ce-lh"><span>${h('career.colSide')}</span>${plus(t('cv.addSide'), 'data-act="cv-menu" data-menu="side" aria-haspopup="menu" aria-expanded="false"')}</span></div>`;
  return `<div class="ce-tg">${heads}${top}<div class="ce-bands">${rows}</div></div>${bands.length ? '' : `<p class="ce-none">${h(q ? 'cv.noMatch' : 'cv.nothingYet')}</p>`}`;
}

// ---- About you: the name and contact | the summary; the headline, contact line and summary fan out their wordings ----
const aboutIds = () => { const b = rec().basics ?? {}; return { tagline: b.display?.label, contact: b.display?.contact, summary: b.summary }; };
function aboutForm(){
  const tp = document.createElement('template'); tp.innerHTML = C.career.panel({ kind: 'header' });
  const boxes = [...tp.content.querySelectorAll('.detbox[data-form=about]')], pr = tp.content.querySelector('.photo-row');
  const grp = (lab, html) => (html ? `<div class="ce-fg"><span class="ce-fl">${lab}</span>${html}</div>` : '');
  const profs = (rec().basics?.profiles ?? []).map((x, i) => `<div class="ce-prof" data-ce-prof="${i}">${['network', 'username', 'url'].map(k => `<input class="ce-fi ce-ed" data-ce-pk="${k}" value="${esc(x?.[k] ?? '')}" placeholder="${esc(t(`cv.prof.${k}`))}" aria-label="${esc(t(`cv.prof.${k}`))}" autocomplete="off" spellcheck="false">`).join('')}${xBtn(`data-act="cv-profdel" data-i="${i}"`, x?.network || t('cv.profile'))}</div>`).join('');
  return `<div class="ce-det ce-aboutform">${grp(h('cv.photo'), pr?.outerHTML)}${grp(h('cv.nameHeadline'), boxes[0]?.outerHTML)}${grp(h('cv.contactRights'), boxes[1]?.outerHTML)}
    ${grp(h('cv.profiles'), `<div class="ce-profs">${profs}<div class="ce-sfoot"><button type="button" class="ce-add" data-act="cv-profadd">${h('cv.addProfile')}</button></div></div>`)}<div class="ce-detf">${btn('about', h('cv.done'))}</div></div>`;
}
function about(d, lang, q){
  const a = d.about, ids = aboutIds();
  if (q && ![a.name, a.tagline, a.contact, a.summary].some(w => w?.text?.toLowerCase().includes(q))) return '';
  const part = (cls, w, id) => {
    if (!w || !id) return '';
    const mode = S.fan.get(id);
    let pn = '';
    if (lensOn() && w.ok){ try { const v = T.chooseVariant(rec(), id, cur()).v; if (v) pn = `<span class="pn" title="${esc(t('cv.prints'))}">v${esc(v.n)}</span>`; } catch { /* not printed */ } }
    return `<button type="button" class="ce-ap ${cls}${mode ? ' is-open' : ''}${need(w) ? ' is-miss' : ''}" data-act="cv-line" data-f="${esc(id)}" aria-expanded="${!!mode}"><span class="tx">${esc(one(w.text))}</span>${marks(w, lang, id)}${pn}${w.ok && w.nv > 1 ? `<span class="nv" title="${esc(t('cv.nWordings', { n: w.nv }))}">${w.nv}</span>` : ''}</button>`;
  };
  const fans = [['cv.headline', 'tagline'], ['cv.contactLine', 'contact'], ['cv.summary', 'summary']].map(([lab, k]) => {
    const id = ids[k], w = a[k]; if (!id || !w || !S.fan.get(id)) return '';
    return `<div class="ce-abfan" data-ce-fact="${esc(id)}"><div class="ce-fl">${h(lab)}</div>${fanHtml(id, w.text, lang, S.fan.get(id))}</div>`;
  }).join('');
  return `<section class="ce-about" id="ce-about"><div class="ce-ab">
    <div class="id"><span class="nmw"><span class="nm">${esc(a.name.text)}</span>${pencil('cv-about', t('cv.editAbout'), S.about)}</span>${part('tg', a.tagline, ids.tagline)}${part('ct', a.contact, ids.contact)}</div>${a.summary ? `<div class="ce-smc">${part('sm', a.summary, ids.summary)}</div>` : ''}
    ${S.about ? aboutForm() : ''}${fans}</div>${S.inl === 'summary' ? inlineAdd('summary') : ''}</section>`;
}

// ---- Skills & credentials: a card for each; behind a card's pencil its rows are fields; with the picks shown, a tick for each ----
const WORDED = ['certificates', 'interests', 'references'];      // written once for each language, no versions
const KEYED = ['certificates', 'languages', 'interests', 'publications', 'references'];      // kept in a plain list, so they reorder
function wordIn(id, lang){
  const m = rec(), vs = versionsIn(m, id, lang), f = m.facts.find(y => y.id === id), v = vs.find(x => x.id === f?.default?.[lang]) ?? vs[0], en = versionsIn(m, id, 'en')[0];
  return { text: v ? v.text : en?.text ?? '', en: en?.text ?? '', own: !!v, ok: !!v || lang === 'en' || sameFact(m, id), same: sameFact(m, id) };
}
function setWording(d, id, lang, text){
  text = String(text ?? '').trim(); if (!text) return;
  const vs = versionsIn(d.record, id, lang), f = d.record.facts.find(y => y.id === id), v = vs.find(x => x.id === f?.default?.[lang]) ?? vs[0], en = versionsIn(d.record, id, 'en')[0];
  if (v) R.saveOver(d.record, v.id, text, d.cur);
  else R.addVersion(d.record, id, { text, lang, as: 'major', tagsFrom: en?.id ?? null, n: en?.n ?? null, source: en?.source ?? null });
}
// languages spoken: the name from its code, in the language read; the level from the fixed list
const CODES = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'sv', 'da', 'no', 'fi', 'pl', 'cs', 'sk', 'hu', 'ro', 'bg', 'hr', 'sr', 'sl', 'el', 'tr', 'ru', 'uk', 'ar', 'he', 'hi', 'zh', 'ja', 'ko', 'th', 'vi', 'id'];
const DN = new Map();
const dn = l => { if (!DN.has(l)) { try { DN.set(l, new Intl.DisplayNames([l], { type: 'language' })); } catch { DN.set(l, null); } } return DN.get(l); };
const nameIn = (code, l) => dn(l)?.of(code) ?? code;
const codeOf = name => { const n = String(name ?? '').trim().toLowerCase(); return CODES.find(c => nameIn(c, 'en').toLowerCase() === n || nameIn(c, c).toLowerCase() === n) ?? null; };
const langShown = (name, l) => { const c = codeOf(name); return c ? nameIn(c, l) : name; };
// the level is stored in English; a native speaker's level is shown in the language read
const NATIVE = { de: 'Muttersprache', fr: 'Langue maternelle', es: 'Lengua materna', it: 'Madrelingua', pt: 'Língua materna', nl: 'Moedertaal', pl: 'Język ojczysty', cs: 'Rodilý mluvčí', hu: 'Anyanyelv' };
const levelShown = (v, l) => (v === 'Native' ? NATIVE[l] ?? v : v);
const isListKind = k => K.kindOf(rec(), k)?.place === 'list';
const secId = s => { try { return K.sectionFor(rec(), s.kind, s.kind === 'skills' ? rec().skills?.[0]?.id ?? null : s.items?.[0]?.id ?? null); } catch { return null; } };
function secLens(s){
  if (!lensOn()) return null;
  const sid = secId(s); if (!sid) return null;
  const sl = T.sectionList(rec(), cur()).find(x => x.id === sid); if (!sl || sl.fixed) return null;
  let list = null; try { list = T.itemList(rec(), cur(), sid); } catch { /* a section with no items of its own */ }
  return { sid, on: sl.on, items: list ? new Map(list.map(x => [x.id, x.on])) : null };
}
const litOf = (lens, id) => (!lens ? '' : lens.on && lens.items?.get(id) !== false ? ' is-lit' : ' is-unlit');
const itick = (lens, id, what) => (lens?.items?.has(id) ? cbx(`data-act="cv-itick" data-id="${esc(id)}"`, litOf(lens, id) === ' is-lit', t('cv.tickItem', { what })) : '');
function itemRow(s, x, lang, lens){
  const g = s.kind, raw = (rec()[g] ?? []).find(r => r.id === x.id) ?? {};
  let ti = x.title, sub = x.sub, right = x.right, miss = false;
  if (g === 'languages'){ ti = langShown(raw.language, lang) || ti; sub = ''; right = levelShown(raw.fluency, lang) || right; }
  else if (g === 'publications') ti = raw.name || ti;
  else if (g === 'certificates'){ const w = wordIn(x.id, lang); ti = w.ok && w.text ? w.text : w.en || ti; miss = !w.ok; }
  else if (g === 'references'){ const w = wordIn(x.id, lang); ti = raw.name || ti; sub = w.ok ? w.text : w.en; miss = !w.ok; }
  const inner = `<span class="ti">${esc(ti)}</span>${sub ? `<span class="sub">${esc(one(sub))}</span>` : ''}${right ? `<span class="r">${esc(right)}</span>` : ''}${miss ? `<span class="ce-lm">${h('cv.writeLang', { lang: U(lang) })}</span>` : ''}`;
  return `<div class="ce-iw${litOf(lens, x.id)}"><div class="ce-row">${itick(lens, x.id, ti)}<button type="button" class="ce-it${miss ? ' is-miss' : ''}" data-act="cv-secopen" data-k="${esc(g)}" data-id="${esc(x.id)}" title="${esc(t('cv.edit'))}">${inner}</button></div></div>`;
}
const grip = `<span class="ce-grip" draggable="true" data-ce-grip title="${esc(t('cv.drag'))}">${icon('grip', { role: 'inline' })}</span>`;
const xBtn = (attrs, what) => `<button type="button" class="ce-x" ${attrs} title="${esc(t('cv.delete', { what }))}" aria-label="${esc(t('cv.delete', { what }))}">${icon('close', { role: 'inline' })}</button>`;
// a section's editor: one row anatomy, [grip] [main] [secondary…] [language] [×], the column heads once at the top
const ROWS = {
  certificates: { cols: '20px minmax(0,1.6fr) minmax(0,1.2fr) 64px 200px 24px', heads: ['cv.colCert', 'career.f.issuer', 'cv.colYear', 'cv.colLang'] },
  languages: { cols: '20px minmax(0,1.4fr) minmax(0,1fr) 24px', heads: ['career.f.language', 'career.f.level'] },
  publications: { cols: '20px minmax(0,1.6fr) minmax(0,1.2fr) 64px 24px', heads: ['career.f.title', 'career.f.publisher', 'cv.colYear'] },
  references: { cols: '20px minmax(0,1fr) minmax(0,2fr) 110px 24px', heads: ['career.f.refName', 'cv.colSays', 'cv.colLang'] },
  _: { cols: '20px minmax(0,1.6fr) minmax(0,1.2fr) 64px 24px', heads: ['career.f.title', 'career.f.org', 'cv.colYear'] },
};
function itemEdit(s, x, lang){
  const g = s.kind, raw = (rec()[g] ?? []).find(r => r.id === x.id) ?? {};
  const fi = (k, v, ph, cls = '') => `<input class="ce-fi ce-ed ${cls}" data-ce-fi="${k}" value="${esc(v ?? '')}" placeholder="${esc(ph)}" aria-label="${esc(ph)}" autocomplete="off" spellcheck="false">`;
  const w = WORDED.includes(g) ? wordIn(x.id, lang) : null;
  const status = (extra = '') => `<span class="ce-ls">${lang === 'en' ? '' : `<span class="${w.ok ? 'ok' : 'todo'}">${w.ok ? `${U(lang)} ✓` : h('cv.writeLang', { lang: U(lang) })}</span>`}${extra}</span>`;
  let f;
  if (g === 'certificates') f = fi('name', w.own || lang === 'en' || w.same ? w.text || w.en : '', w.en || t('career.f.name')) + fi('issuer', raw.issuer, t('career.f.issuer')) + fi('date', raw.date, t('cv.colYear'), 'ce-yrf')
    + status(`<label class="ce-same">${cbx(`data-act="cv-same" data-id="${esc(x.id)}"`, w.same, t('cv.same'))}${h('cv.same')}</label>`);
  else if (g === 'languages'){
    const c = codeOf(raw.language), names = [...new Set([...CODES, ...languages()])].map(k => [nameIn(k, 'en'), nameIn(k, lang)]).sort((a, b) => a[1].localeCompare(b[1], lang));
    if (!c && raw.language) names.unshift([raw.language, raw.language]);
    f = `<select class="ce-fi" data-ce-fi="name" aria-label="${esc(t('career.f.language'))}">${names.map(([en, nm]) => `<option value="${esc(en)}"${en.toLowerCase() === String(c ? nameIn(c, 'en') : raw.language).toLowerCase() ? ' selected' : ''}>${esc(nm)}</option>`).join('')}</select>`
      + `<select class="ce-fi" data-ce-fi="level" aria-label="${esc(t('career.f.level'))}">${raw.fluency ? '' : '<option selected></option>'}${[...new Set([...K.LEVELS, raw.fluency].filter(Boolean))].map(v => `<option value="${esc(v)}"${v === raw.fluency ? ' selected' : ''}>${esc(levelShown(v, lang))}</option>`).join('')}</select>`;
  }
  else if (g === 'publications') f = fi('name', raw.name, t('career.f.title')) + fi('publisher', raw.publisher, t('career.f.publisher')) + fi('date', raw.releaseDate, t('cv.colYear'), 'ce-yrf');
  else if (g === 'references') f = fi('name', raw.name, t('career.f.refName')) + fi('text', w.own || lang === 'en' ? w.text : '', w.en || t('cv.colSays')) + status();
  else f = fi('name', x.title, t('career.f.title')) + fi('org', x.sub ?? '', t('career.f.org')) + fi('date', x.right, t('cv.colYear'), 'ce-yrf');
  return `<div class="ce-er" data-ce-er="${esc(x.id)}">${KEYED.includes(g) || isListKind(g) ? grip : '<span></span>'}<span class="ce-ef">${f}</span>${xBtn(`data-act="cv-del" data-id="${esc(x.id)}"`, x.title)}</div>`;
}
const pillOf = (k, lang) => { const m = rec(), w = (m.skillBank?.words ?? []).find(x => x.name === k), tx = lang === 'en' || w?.same ? k : m.i18n?.[lang]?.labels?.[w?.id] ?? ''; return { w, text: tx || k, miss: !tx && !!w }; };
// Interests: a word bank like Skills, one wording for each language
function interests(s, lang, ed, lens){
  const pills = s.items.map(x => {
    const w = wordIn(x.id, lang), id = esc(x.id);
    if (S.iwrite === x.id) return `<span class="ce-pill ce-pe is-write"><input class="ce-fi ce-ed" data-ce-iwin="${id}" value="${esc(w.own || lang === 'en' ? w.text : '')}" placeholder="${esc(t('cv.wordFor', { lang: lname(lang), word: w.en }))}" aria-label="${esc(t('cv.wordFor', { lang: lname(lang), word: w.en }))}" autocomplete="off"></span>`;
    const text = w.ok && w.text ? w.text : w.en || x.title;
    return `<span class="ce-pill${ed ? ' ce-pe' : ''}${w.ok ? '' : ' is-miss'}${litOf(lens, x.id)}">${itick(lens, x.id, text)}${ed ? `<button type="button" class="ce-ptx" data-act="cv-iwrite" data-id="${id}">${esc(text)}</button>` : esc(text)}${w.ok ? '' : `<button type="button" class="ce-pwr" data-act="cv-iwrite" data-id="${id}">${h('cv.writeLang', { lang: U(lang) })}</button>`}${ed ? `<button type="button" class="ce-px" data-act="cv-del" data-id="${id}" title="${esc(t('cv.delete', { what: text }))}" aria-label="${esc(t('cv.delete', { what: text }))}">${icon('close', { role: 'inline' })}</button>` : ''}</span>`;
  }).join('');
  const add = !ed ? '' : S.iadd ? `<input class="ce-fi ce-ed ce-wain" data-ce-iain placeholder="${esc(t('cv.anInterest'))}" aria-label="${esc(t('cv.anInterest'))}" autocomplete="off">` : `<button type="button" class="ce-pp" data-act="cv-iadd">${h('cv.addInterest')}</button>`;
  return `<div class="ce-sg ce-ibank"><span class="ws">${pills}${add}</span></div>`;
}
function skillsEdit(lang){
  const m = rec(), labels = m.i18n?.[lang]?.labels ?? {};
  const rows = (m.skills ?? []).map(g => {
    const pills = (g.keywords ?? []).map(k => {
      const p = pillOf(k, lang);
      if (p.w && S.skWrite === p.w.id) return `<span class="ce-pill ce-pe is-write"><input class="ce-fi ce-ed" data-ce-pwin="${esc(p.w.id)}" data-k="${esc(k)}" placeholder="${esc(t('cv.wordFor', { lang: lname(lang), word: k }))}" aria-label="${esc(t('cv.wordFor', { lang: lname(lang), word: k }))}" autocomplete="off"></span>`;
      return `<span class="ce-pill ce-pe${p.miss ? ' is-miss' : ''}" draggable="true" data-ce-pw data-g="${esc(g.id)}" data-k="${esc(k)}">${esc(p.text)}${p.miss ? `<button type="button" class="ce-pwr" data-act="cv-pwrite" data-id="${esc(p.w.id)}">${h('cv.writeIn', { lang: U(lang) })}</button>` : ''}<button type="button" class="ce-px" data-act="cv-pdel" data-g="${esc(g.id)}" data-k="${esc(k)}" title="${esc(t('cv.takeOut', { word: k, group: g.name }))}" aria-label="${esc(t('cv.takeOut', { word: k, group: g.name }))}">${icon('close', { role: 'inline' })}</button></span>`;
    }).join('');
    const nm = lang === 'en' ? g.name : labels[g.id] ?? '';
    const addw = S.skAdd === g.id ? `<input class="ce-fi ce-ed ce-wain" data-ce-wain="${esc(g.id)}" placeholder="${esc(t('cv.aWord'))}" aria-label="${esc(t('cv.addWordTo', { group: g.name }))}" autocomplete="off">` : `<button type="button" class="ce-pp" data-act="cv-wadd" data-g="${esc(g.id)}">${h('cv.addWord')}</button>`;
    return `<div class="ce-sg ce-sge" data-gid="${esc(g.id)}"><input class="ce-fi ce-ed gname" data-ce-gname="${esc(g.id)}" value="${esc(nm)}" placeholder="${esc(g.name)}" aria-label="${esc(t('career.f.group'))}"><span class="ws" data-ce-ws="${esc(g.id)}">${pills}${addw}</span>${xBtn(`data-act="cv-gdel" data-g="${esc(g.id)}"`, g.name)}</div>`;
  }).join('');
  return `${rows}<div class="ce-sfoot"><button type="button" class="ce-add" data-act="cv-gnew">${h('cv.addGroup')}</button><button type="button" class="ce-add" data-act="rec-job" data-grp="~bank">${h('career.bankCard')}</button></div>`;      // every word with its shelf and wordings: the bank, in the sidebar
}
const THING = { skills: 'cv.thing.skills', languages: 'cv.thing.languages', certificates: 'cv.thing.certificates', publications: 'cv.thing.publications', interests: 'cv.thing.interests', references: 'cv.thing.references' };
function secCard(s, lang, q){
  const hit = x => !q || x.toLowerCase().includes(q), lens = secLens(s), ed = S.secEdit === s.kind;
  const RW = ROWS[s.kind] ?? ROWS._, done = `<div class="ce-detf">${btn('secedit', h('cv.done'), `data-k="${esc(s.kind)}"`)}</div>`;
  let body;
  if (ed && s.kind === 'interests') body = `<div class="ce-se">${interests(s, lang, true, lens)}${done}</div>`;
  else if (ed) body = `<div class="ce-se" style="--cols:${RW.cols}">${s.groupsOf ? skillsEdit(lang) : `<div class="ce-eh"><span></span>${RW.heads.map(k => `<span>${h(k)}</span>`).join('')}<span></span></div>${s.items.map(x => itemEdit(s, x, lang)).join('')}<div class="ce-sfoot"><button type="button" class="ce-add" data-act="cv-secadd" data-k="${esc(s.kind)}">${h('cv.addThing', { thing: thingOf(s.kind) })}</button></div>`}${done}</div>`;
  else if (s.kind === 'interests') body = s.items.some(x => hit(`${x.title}`)) ? interests(s, lang, false, lens) : '';
  else if (s.groupsOf) body = s.groupsOf.filter(g => hit(g.name + ' ' + g.words.map(w => w.text).join(' '))).map(g => `<div class="ce-sg${litOf(lens, g.id)}">${itick(lens, g.id, g.name)}<button type="button" class="gn${g.miss ? ' is-miss' : ''}" data-act="cv-secopen" data-k="skills">${esc(g.name)}</button><span class="ws">${g.words.map(w => `<span class="ce-pill${w.miss ? ' is-miss' : ''}">${esc(w.text)}</span>`).join('')}</span></div>`).join('');
  else body = s.items.filter(x => hit(`${x.title} ${x.sub ?? ''}`)).map(x => itemRow(s, x, lang, lens)).join('');
  if (q && !body) return '';
  const sw = lens ? `<label class="ce-sw">${cbx(`data-act="cv-secon" data-id="${esc(lens.sid)}"`, lens.on, t('cv.showOn', { what: s.label }))}<span>${h('cv.onResume')}</span></label>` : '';
  const kset = K.kindOf(rec(), s.kind) ? `<button type="button" class="ce-dt ce-ks" data-act="cv-kind-edit" data-id="${esc(s.kind)}" title="${esc(t('career.kindSettings', { name: s.label }))}" aria-label="${esc(t('career.kindSettings', { name: s.label }))}">⚙</button>` : '';
  const hadd = ed ? '' : `<button type="button" class="ce-hadd" data-act="cv-add" data-what="${esc(s.kind)}" aria-label="${esc(t('cv.addThing', { thing: thingOf(s.kind) }))}" title="${esc(t('cv.addThing', { thing: thingOf(s.kind) }))}">${icon('plus', { role: 'inline' })}<span class="w">${h('cv.addThing', { thing: thingOf(s.kind) })}</span></button>`;
  return `<section class="ce-box${ed ? ' is-editing' : ''}${lens && !lens.on ? ' is-off' : ''}" id="ce-${esc(s.id)}" data-ce-sec="${esc(s.kind)}" style="--hk:${kindHue(s.kind)}">
    <h3><span class="chip">${kindChip(s.kind)}</span><span class="nm">${esc(s.label)}</span><span class="n">${s.count}</span><span class="ce-tools">${pencil('cv-secedit', t('cv.editThing', { what: s.label }), ed, `data-k="${esc(s.kind)}"`, ' ce-sp')}${kset}</span>${s.toWrite ? `<span class="tw" title="${esc(t('cv.toWriteIn', { n: s.toWrite, lang: U(lang) }))}"><span class="w">${h('cv.toWriteIn', { n: s.toWrite, lang: U(lang) })}</span><span class="nn" aria-hidden="true">${s.toWrite}</span></span>` : ''}${sw}${hadd}</h3>
    ${S.adding === s.kind ? addCard(s.kind) : ''}${body || `<p class="ce-none">${h('cv.nothingYet')}</p>`}${!q && !ed && S.inl === s.kind ? inlineAdd(s.kind) : ''}</section>`;
}
const thingOf = k => (THING[k] ? t(THING[k]) : (K.kindName(rec(), k, L()) ?? k).toLowerCase());
function lists(d, lang, q){
  const secs = d.secs.filter(s => s.count || ['skills', ...LISTS].includes(s.kind) || S.adding === s.kind || S.inl === s.kind);
  const skills = secs.filter(s => s.groupsOf).map(s => secCard(s, lang, q)).join('');
  const rest = secs.filter(s => !s.groupsOf).map(s => secCard(s, lang, q)).join('');
  // a list the record has none of yet: its card appears with the add in it
  const want = [S.inl, S.adding].find(k => k && (k === 'references' || isListKind(k)) && !secs.some(s => s.kind === k));
  const stub = want ? `<section class="ce-box is-editing" data-ce-sec="${esc(want)}" style="--hk:${kindHue(want)}"><h3><span class="chip">${kindChip(want)}</span><span class="nm">${esc(want === 'references' ? t('cv.sec.references') : K.kindName(rec(), want, lang))}</span><span class="n">0</span></h3>${S.adding === want ? addCard(want) : inlineAdd(want)}</section>` : '';
  return `${kindPlace() === 'list' ? kindEditor() : ''}${skills}<div class="ce-cols">${rest}${stub}</div>`;
}

// ---- adding: a big entry opens a card in the page, a small one a row where it belongs ----
const SMALL = new Set(['skills', 'languages', 'interests', 'references', 'summary']);
const withLine = w => w === 'work' || w === 'project' || K.kindOf(rec(), w)?.place === 'timeline';
function fieldsOf(w){
  const k = K.kindOf(rec(), w);
  if (w === 'work') return [['pos', 'career.f.title'], ['org', 'career.f.employer'], ['loc', 'career.f.where'], ['start', 'career.f.started', 'month'], ['end', 'career.f.ended', 'month']];
  if (w === 'education') return [['org', 'career.f.institution'], ['type', 'onb.degree'], ['area', 'onb.subject'], ['start', 'career.f.started', 'month'], ['end', 'career.f.finished', 'month']];
  if (w === 'certificates') return [['pos', 'career.f.name'], ['org', 'career.f.issuer'], ['start', 'career.f.date', 'month']];
  if (w === 'publications') return [['pos', 'career.f.title'], ['org', 'career.f.publisher'], ['start', 'career.f.date', 'month']];
  return [['pos', k ? 'career.f.title' : 'career.f.project'], ['org', k ? null : 'career.f.with', null, k?.org], ['start', 'career.f.started', 'month'], ...(k?.place === 'list' ? [] : [['end', 'career.f.ended', 'month']])];
}
const addTitle = w => ({ work: t('career.newWork'), education: t('career.newEducation'), project: t('career.newProject'), certificates: t('career.addItem.certificates'), publications: t('career.addItem.publications') }[w] ?? t('career.newKindEntry', { kind: K.kindName(rec(), w, L()) }));
function addCard(w){
  const k = K.kindOf(rec(), w);
  const fs = fieldsOf(w).map(([key, lab, ty, own]) => ty === 'month' ? monthFieldHtml(`ce-f-${key}`, h(lab), '', { lang: L(), host: 'ce', present: key === 'end' && w !== 'education' })
    : `<label class="ce-f"><span>${lab ? h(lab) : esc(own)}</span><input class="ce-ed" data-ce-f="${key}" type="text" autocomplete="off"></label>`).join('');
  return `<div class="ce-addcard" id="ce-addcard" style="--hk:${kindHue(k ? w : w)}"><div class="ce-addh"><span class="node">${kindChip(w)}</span><b>${esc(addTitle(w))}</b></div>
    <div class="ce-addf">${fs}${withLine(w) ? `<label class="ce-f wide"><span>${h(w === 'work' ? 'cv.whatDid' : 'cv.whatDidOpt')}</span><input class="ce-ed" data-ce-f="line" placeholder="${esc(t('cv.whatDidPh'))}" autocomplete="off"></label>` : ''}</div>
    <div class="ce-detf">${btn('addsave', h('cv.save'), '', 'pri')}${btn('addcancel', h('btn.cancel'), '', 'ghost')}</div></div>`;
}
function inlineAdd(w){
  const f = (k, ph) => `<input class="ce-ed" data-ce-inlin="${k}" placeholder="${esc(ph)}" aria-label="${esc(ph)}" autocomplete="off" spellcheck="false">`;
  const body = {
    skills: f('text', t('cv.inlSkills')),
    languages: f('name', t('cv.inlLanguage')) + `<select data-ce-inlin="level" aria-label="${esc(t('career.f.level'))}"><option value="">${h('career.f.level')}</option>${K.LEVELS.map(v => `<option>${esc(v)}</option>`).join('')}</select>`,
    interests: f('text', t('cv.anInterest')),
    references: f('name', t('career.f.refName')) + f('text', t('cv.colSays')),
    summary: `<textarea class="ce-ed" data-ce-inlin="text" rows="3" placeholder="${esc(t('cv.inlSummary'))}" aria-label="${esc(t('cv.summary'))}" spellcheck="false"></textarea>`,
  }[w] ?? '';
  return `<div class="ce-inl is-${esc(w)}">${body}${btn('inlsave', h('cv.add'), '', 'pri')}${btn('inlcancel', h('btn.cancel'), '', 'ghost')}</div>`;
}
// ---- a kind of your own, made and changed in Career: a preset to start from, the name, colour, icon, shape and what its organisation is called;
// an existing kind changes as you go, and deleting it takes its entries with it or moves them to another kind of its shape ----
const recipesOf = x => [x.cur, ...(x.resumes ?? [])].filter(Boolean);
function newKind(p = null){
  const d = { name: { en: '' }, colour: 2, icon: 'star', place: 'timeline', org: t('career.f.org'), store: 'projects' };
  return p ? applyPreset(d, p) : d;
}
function applyPreset(d, p){
  const x = K.KIND_PRESETS[p], lang = L();
  const out = { ...structuredClone(x), name: { ...d.name, en: x.name.en ? t(`career.preset.${p}`) : d.name.en ?? '' }, org: x.org ? t(`career.presetOrg.${p}`) : d.org };
  if (lang !== 'en' && x.name.en) out.name[lang] = t(`career.preset.${p}`);
  return out;
}
function readKind(){
  const d = S.kind?.draft, card = document.getElementById('ce-kindcard'); if (!d || !card) return;
  const n = card.querySelector('[data-ce-k=name]')?.value; if (n !== undefined) d.name[L()] = n;
  const o = card.querySelector('[data-ce-k=org]')?.value; if (o !== undefined) d.org = o;
  if (!S.kind.id) S.kind.first = Object.fromEntries(['pos', 'org', 'line', 'start', 'end'].map(k => [k, card.querySelector(`[data-ce-e=${k}], #ce-ke-${k}`)?.value ?? '']));      // the first entry's fields survive a redraw
}
function kindName(d){
  if (!String(d.name.en ?? '').trim() && L() !== 'en') d.name.en = d.name[L()];
  return String(d.name.en ?? '').trim();
}
// an existing kind: what changed is saved at once, one undo step each
function saveKindNow(){
  readKind();
  const { id, draft: d } = S.kind ?? {};
  if (!id || !d) return;
  if (!kindName(d)) return C.toast(t('error.kindName'), 'warn');
  commit(x => { K.updateKind(x.record, id, d, recipesOf(x), x.cur); }, t('undo.editKind'));
}
// a new kind and its first entry are made together: one Create, one undo step; the entry is then open where it lives
function createKind(){
  readKind();
  const d = S.kind.draft, v = k => (document.querySelector(`#ce-kindcard [data-ce-e=${k}], #ce-kindcard #ce-ke-${k}`)?.value ?? '').trim(), lang = L();
  if (!kindName(d)){ C.toast(t('error.kindName'), 'warn'); S.focus = '#ce-kindcard [data-ce-k=name]'; draw(); return; }
  if (!v('pos')){ C.toast(t('cv.fillFirst'), 'warn'); S.focus = '#ce-kindcard [data-ce-e=pos]'; draw(); return; }
  let kind, entry;
  if (!commit(x => { kind = K.createKind(x.record, d); entry = K.addKindEntry(x.record, kind, { name: v('pos'), org: v('org'), startDate: v('start'), endDate: d.place === 'list' ? '' : v('end'), bullets: v('line') && d.place !== 'list' ? [v('line')] : [], lang }); }, t('undo.newKind'), t('career.kindCreated', { name: d.name[lang] || d.name.en }))) return;
  S.kind = null; S.reveal = 'jump';
  if (d.place === 'list') S.focus = `[data-ce-sec="${CSS.escape(kind)}"] h3`;
  else { S.open.add(entry); S.ctx = { card: entry }; S.focus = `[data-ce-card="${CSS.escape(entry)}"] .ce-ch`; }
  draw();
}
// the first entry's own fields, under the kind's: a timeline kind has a period and a first line, a list kind one date
function entryFields(d){
  const lang = L(), list = d.place === 'list', was = S.kind.first ?? {};
  const f = (k, label) => `<label class="ce-f"><span>${esc(label)}</span><input class="ce-ed" data-ce-e="${k}" type="text" value="${esc(was[k] ?? '')}" autocomplete="off"></label>`;
  return `<div class="ce-f wide ce-kfirst"><span>${h('cv.firstEntry')}</span></div>${f('pos', t('career.f.title'))}${f('org', d.org || t('career.f.org'))}
    ${monthFieldHtml('ce-ke-start', h(list ? 'career.f.date' : 'career.f.started'), was.start ?? '', { lang, host: 'ce' })}${list ? '' : monthFieldHtml('ce-ke-end', h('career.f.ended'), was.end ?? '', { lang, host: 'ce', present: true })}
    ${list ? '' : `<label class="ce-f wide"><span>${h('cv.whatDidOpt')}</span><input class="ce-ed" data-ce-e="line" value="${esc(was.line ?? '')}" placeholder="${esc(t('cv.whatDidPh'))}" autocomplete="off"></label>`}`;
}
// where the kind editor sits: with the timeline's entries, or with Skills & credentials
const kindPlace = () => (S.kind ? (S.kind.id ? K.kindOf(rec(), S.kind.id)?.place : S.kind.draft.place) === 'list' ? 'list' : 'timeline' : null);
function kindEditor(){
  const m = rec(), { id, draft: d, del } = S.kind, lang = L(), hue = SWATCH_HUES[(d.colour ?? 0) % 6];
  const presets = id ? '' : `<div class="ce-f wide"><span>${h('career.startFrom')}</span><div class="ce-kps">${['volunteering', 'awards', 'talks', 'blank'].map(p => `<button type="button" class="ce-kp" data-act="cv-kpreset" data-p="${p}" ${['volunteering', 'awards'].includes(p) && K.kindsOf(m).some(k => k.store === K.KIND_PRESETS[p].store) ? 'disabled' : ''}>${icon(K.KIND_PRESETS[p].icon, { role: 'control' })}${h(`career.preset.${p}`)}</button>`).join('')}</div></div>`;
  const swatches = SWATCH_HUES.map((c, i) => `<button type="button" class="ce-sw6" data-act="cv-kcolour" data-i="${i}" style="--sw:var(--hue-${c})" aria-pressed="${(d.colour ?? 0) % 6 === i}" aria-label="${esc(t('career.colourN', { n: i + 1 }))}"></button>`).join('');
  const icons = K.KIND_ICONS.map(ic => `<button type="button" class="ce-ki" data-act="cv-kicon" data-i="${ic}" aria-pressed="${d.icon === ic}" aria-label="${esc(t(`career.iconName.${ic}`))}" title="${esc(t(`career.iconName.${ic}`))}">${icon(ic, { role: 'control' })}</button>`).join('');
  const radio = (v, label) => `<label class="ce-kpl"><input type="radio" name="ce-kplace" value="${v}"${d.place === v ? ' checked' : ''}${d.store !== 'projects' ? ' disabled' : ''}>${h(label)}</label>`;
  const place = id ? `<p class="ce-note">${h(d.place === 'list' ? 'career.placeList' : 'career.placeTimeline')}</p>` : `<div class="ce-f wide"><span>${h('career.writeBullets')}</span><div class="ce-kpls">${radio('timeline', 'career.placeYes')}${radio('list', 'career.placeNo')}</div></div>`;
  const store = d.store === 'volunteer' ? 'career.storeVolunteer' : d.store === 'awards' ? 'career.storeAwards' : id ? 'career.storeProjects' : null;
  const others = !del ? [] : [...(d.place === 'timeline' ? [['project', t('career.kind.project')]] : []), ...K.kindsOf(m).filter(k => k.id !== id && k.place === d.place).map(k => [k.id, K.kindName(m, k.id, lang)])];
  const ask = !del ? '' : `<div class="ce-kdel" role="alert"><p>${h('career.deleteKindAsk', { n: K.entriesOfKind(m, id).length })}</p><div class="ce-detf">${others.length ? `<select data-ce-k="move" aria-label="${esc(t('career.moveThem'))}">${others.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>${btn('kdelmove', h('career.moveThem'))}` : ''}${btn('kdelall', h('career.deleteThem', { n: K.entriesOfKind(m, id).length }), '', 'del')}${btn('kdelno', h('btn.cancel'), '', 'ghost')}</div></div>`;
  const foot = id ? `${btn('kdone', h('cv.done'))}<span class="grow"></span>${btn('kdel', h('career.deleteKind'), '', 'del')}` : `${btn('kcreate', h('career.createKind'), '', 'pri')}${btn('kcancel', h('btn.cancel'), '', 'ghost')}`;
  return `<div class="ce-addcard ce-kindcard" id="ce-kindcard" style="--hk:var(--hue-${hue})"><div class="ce-addh"><span class="node">${icon(d.icon, { role: 'header' })}</span><b>${esc(id ? K.kindName(m, id, lang) : t('career.newKind'))}</b><small>${h('career.kindIntro')}</small></div>
    <div class="ce-addf">${presets}<label class="ce-f"><span>${h('career.f.name')}</span><input class="ce-ed" data-ce-k="name" value="${esc(d.name[lang] ?? '')}" placeholder="${esc(d.name.en || t('career.kindNamePh'))}" autocomplete="off"></label>
    <label class="ce-f"><span>${h('career.orgCalled')}</span><input class="ce-ed" data-ce-k="org" value="${esc(d.org ?? '')}" placeholder="${esc(t('career.orgPh'))}" autocomplete="off"></label>
    <div class="ce-f wide"><span>${h('career.colour')}</span><div class="ce-sws">${swatches}</div></div>
    <div class="ce-f wide"><span>${h('career.icon')}</span><div class="ce-kis">${icons}</div></div>${place}${id ? '' : entryFields(d)}</div>
    ${store ? `<p class="ce-note">${h(store)}</p>` : ''}<p class="ce-note">${h('career.kindSection')}</p>${ask}<div class="ce-detf">${del ? '' : foot}</div></div>`;
}
function startAdd(w, how = 'menu'){
  solo(null);
  if (SMALL.has(w)){ S.inl = w; S.focus = '.ce-inl [data-ce-inlin]'; }
  else { S.adding = w; S.focus = '#ce-addcard input'; }
  S.reveal = how;
  draw();
}
function saveAdd(){
  const w = S.adding, v = k => (document.querySelector(`#ce-addcard [data-ce-f=${k}], #ce-addcard #ce-f-${k}`)?.value ?? '').trim(), lang = L(), k = K.kindOf(rec(), w);
  if (!v('pos') && !v('org')) return C.toast(t('cv.fillFirst'), 'warn');
  if (w === 'work' && !v('line')) return C.toast(t('cv.oneLine'), 'warn');
  const bullets = v('line') ? [v('line')] : [];
  let ok;
  if (w === 'work') ok = commit(d => { K.addJob(d.record, { position: v('pos'), name: v('org'), startDate: v('start'), endDate: v('end'), location: v('loc'), bullets, lang }); }, t('undo.addJob'), t('cv.added'));
  else if (w === 'education') ok = commit(d => {
    const ed = d.record.education ??= [];
    if (!ed.length) setEducation(d.record, { institution: v('org'), studyType: v('type'), area: v('area'), startDate: v('start'), endDate: v('end'), lang });
    else ed.push({ id: slug(`edu-${v('org')}`, new Set(ed.map(x => x.id)), 'edu'), institution: v('org') || '—', studyType: v('type') || '—', area: v('area') || '—', ...(v('start') ? { startDate: v('start') } : {}), ...(v('end') ? { endDate: v('end') } : {}) });
  }, t('undo.addEntry'), t('cv.added'));
  else if (w === 'certificates') ok = commit(d => { K.addCertificate(d.record, { name: v('pos'), issuer: v('org'), date: v('start') }); }, t('undo.addItem'), t('cv.added'));
  else if (w === 'publications') ok = commit(d => { K.addPublication(d.record, { name: v('pos'), publisher: v('org'), releaseDate: v('start') }, lang); }, t('undo.addItem'), t('cv.added'));
  else if (k) ok = commit(d => { K.addKindEntry(d.record, w, { name: v('pos'), org: v('org'), startDate: v('start'), endDate: v('end'), bullets, lang }); }, t('undo.addEntry'), t('cv.added'));
  else ok = commit(d => { K.addProject(d.record, { name: v('pos'), entity: v('org'), startDate: v('start'), endDate: v('end'), bullets, lang }); }, t('undo.addEntry'), t('cv.added'));
  if (ok){ S.adding = null; draw(); }
}
function saveInl(){
  const w = S.inl, g = k => (document.querySelector(`.ce-inl [data-ce-inlin=${k}]`)?.value ?? '').trim(), text = g('text') || g('name'), lang = L();
  if (!text) return C.toast(t('cv.writeFirst'), 'warn');
  let ok;
  if (w === 'skills'){ const [n, ...r] = text.split(':'); ok = commit(d => { K.addSkill(d.record, { name: n.trim(), keywords: r.join(':').trim() }, lang); }, t('undo.addItem'), t('cv.added')); }
  else if (w === 'languages') ok = commit(d => { K.addLanguage(d.record, { language: g('name'), fluency: g('level') }, lang); }, t('undo.addItem'), t('cv.added'));
  else if (w === 'interests') ok = commit(d => { K.addInterest(d.record, { name: text }, lang); }, t('undo.addItem'), t('cv.added'));
  else if (w === 'references') ok = commit(d => { K.addReference(d.record, { name: g('name'), reference: g('text') }, lang); }, t('undo.addItem'), t('cv.added'));
  else if (w === 'summary') ok = commit(d => { setSummary(d.record, text); }, t('undo.addSummary'), t('cv.added'));
  if (ok){ S.inl = null; draw(); }
}

// ---- saving a wording ----
function saveWording(b){
  const mode = b.dataset.m, ed = mode === 'write' ? { kind: 'write', fact: b.dataset.f } : S.editing; if (!ed) return;
  const text = (document.getElementById('ce-ta')?.value ?? S.drafts.get(ekey(ed)) ?? '').trim();
  if (!text) return C.toast(t('cv.writeFirst'), 'warn');
  const lang = L(), m = rec(), all = (m.facts.find(x => x.id === ed.fact)?.variants ?? []).map(id => m.variants.find(v => v.id === id)).filter(Boolean);
  const en = ed.fact ? versionsIn(m, ed.fact, 'en')[0] : null, src = all.find(v => v.source)?.source ?? null;      // a new wording keeps the claim's own source
  let ok = false, made = null;
  if (mode === 'over') ok = commit(d => { R.saveOver(d.record, ed.vid, text, d.cur); }, t('cv.undoSave'), t('cv.saved'));
  else if (mode === 'as') ok = commit(d => { const nv = R.addVersion(d.record, ed.fact, { text, from: ed.vid, as: 'minor', lang }); pick(d, ed.fact, nv.id); }, t('cv.undoSave'), t('cv.saved'));
  else if (mode === 'new') ok = commit(d => { const nv = R.addVersion(d.record, ed.fact, { text, as: 'major', lang, source: src }); pick(d, ed.fact, nv.id); }, t('cv.undoSave'), t('cv.saved'));
  else if (mode === 'write') ok = commit(d => { if (d.cur) guard(d.record, d.cur, ed.fact); const nv = R.addVersion(d.record, ed.fact, { text, lang, as: 'major', tagsFrom: en?.id ?? null, n: en?.n ?? null, source: en?.source ?? src }); pick(d, ed.fact, nv.id); }, t('cv.undoWriteIn', { lang: lname(lang) }), t('cv.savedIn', { lang: lname(lang) }));
  else if (mode === 'line') ok = commit(d => { made = K.addEntryClaim(d.record, ed.entry, text, lang, null); if (made && d.cur && T.jobRefs(d.record, d.cur).some(r => refId(r) === ed.entry)) T.setBulletOn(d.record, d.cur, made, true); }, t('undo.addClaim'), t('cv.added'));
  if (!ok) return;
  S.drafts.delete(ekey(ed)); S.editing = null;
  if (made) S.fan.set(made, 'words'); else if (mode === 'write') S.fan.set(ed.fact, 'words');
  draw();
}

// ---- section edits ----
const keepScroll = fn => { const sc = document.getElementById('scr'), top = sc?.scrollTop; const r = fn(); if (sc && top != null && sc.scrollTop !== top) sc.scrollTop = top; return r; };
function setGroupWords(r, gid, words){
  K.setSkillWords(r, gid, words, 'en');
  const lang = L();
  if (lang !== 'en') K.setSkillWords(r, gid, words.map(k => pillOf(k, lang).text), lang);
}
function moveItem(r, group, id, beforeId){
  const mv = (list, key) => { const i = list.findIndex(y => key(y) === id); if (i < 0) return; const [y] = list.splice(i, 1); const at = beforeId ? list.findIndex(z => key(z) === beforeId) : -1; list.splice(at < 0 ? list.length : at, 0, y); };
  mv(r[group], y => y.id);
  for (const s of r.sections ?? []) for (const k of ['groups', 'pairs', 'items']) if (Array.isArray(s.content?.[k]) && s.content[k].includes(id)) mv(s.content[k], y => y);
}
function saveRow(row){
  const k = row.closest('[data-ce-sec]').dataset.ceSec, id = row.dataset.ceEr, lang = L(), v = f => row.querySelector(`[data-ce-fi=${f}]`)?.value ?? undefined;
  const fns = {
    certificates: d => { K.updateCertificate(d.record, id, { ...(lang === 'en' ? { name: v('name') } : {}), issuer: v('issuer'), date: v('date') }); if (lang !== 'en') setWording(d, id, lang, v('name')); },
    languages: d => K.updateLanguage(d.record, id, { language: v('name'), fluency: v('level') }, 'en'),
    publications: d => K.updatePublication(d.record, id, { name: v('name'), publisher: v('publisher'), releaseDate: v('date') }, 'en'),
    references: d => { K.updateReference(d.record, id, lang === 'en' ? { name: v('name'), reference: v('text') } : { name: v('name') }, 'en'); if (lang !== 'en') setWording(d, id, lang, v('text')); },
  };
  commit(fns[k] ?? (d => K.updateProject(d.record, id, { name: v('name'), org: v('org'), startDate: v('date') }, lang)), t('undo.editItem'));
}
const findWord = text => { const m = rec(), x = text.toLowerCase(); return (m.skillBank?.words ?? []).find(w => w.name.toLowerCase() === x || m.i18n?.[L()]?.labels?.[w.id]?.toLowerCase() === x); };
function addWordTo(gid, text){
  text = text.trim(); S.skAdd = null;
  if (!text){ draw(); return; }
  const name = findWord(text)?.name ?? text;
  commit(d => { const g = d.record.skills.find(s => s.id === gid); if (g && !(g.keywords ?? []).includes(name)) setGroupWords(d.record, gid, [...(g.keywords ?? []), name]); }, t('undo.editItem'));
  S.skAdd = gid; S.focus = '.ce-wain'; draw();      // the next word goes in the same box
}
function writeWord(wid, k, text){
  if (S.skWrite !== wid) return;
  S.skWrite = null; text = text.trim();
  const lang = L();
  if (text) commit(d => { RS.renameWord(d.record, wid, lang, text); for (const g of d.record.skills ?? []) if ((g.keywords ?? []).includes(k)) setGroupWords(d.record, g.id, g.keywords); }, t('cv.undoWriteIn', { lang: lname(lang) }));
  draw();
}

// ---- the sidebar: what is open, or the map of the career in the language read ----
const resumeRows = () => (st().resumes ?? []).map(r => (cur() && r.id === cur().id ? cur() : r));
const rname = r => RS.resumeLabel(r);
const listedOf = (r, jid) => { try { return T.jobRefs(rec(), r).some(x => refId(x) === jid) ? T.listedBullets(rec(), r, jid) : []; } catch { return []; } };
const CAP = 5;
const sec = (label, inner) => `<section><h3>${label}</h3>${inner}</section>`;
const hdr = (label, name, sub = '') => `<section><h3>${label}</h3><p class="ce-ct"><b title="${esc(name)}">${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</p></section>`;
// a resume that prints it: a link that opens that resume at the line or section, as the editor's own does
function rlink(r, label, sel){
  const nm = rname(r);
  if (cur() && r.id === st().openId) return `<div class="ce-r is-this"><span title="${esc(nm)}">${esc(nm)}</span><b>${esc(label)} · ${h('cv.open')}</b></div>`;
  return `<button type="button" class="ce-r" data-act="cv-ropen" data-rid="${esc(r.id)}" data-sel="${esc(JSON.stringify(sel))}" title="${esc(t('ux6e.open', { name: nm }))}"><span>${esc(nm)}</span><b>${esc(label)}</b></button>`;
}
const rlist = (rows, empty) => `<div class="ce-cx">${rows.slice(0, CAP).join('') || `<p class="ce-note">${empty}</p>`}${rows.length > CAP ? `<small>${h('edit.andMore', { n: rows.length - CAP })}</small>` : ''}</div>`;
const jobIdOf = f => { try { const j = T.jobOfFact(rec(), f); return typeof j === 'string' ? j : j?.id ?? null; } catch { return null; } };
function ctxKind(){
  if (S.detail) return 'form';
  const ids = Object.values(aboutIds());
  if (S.about || [...S.fan.keys()].some(id => ids.includes(id))) return 'about';
  if (S.ctx?.sec) return 'sec';
  if (S.ctx?.line && S.fan.has(S.ctx.line)) return 'line';
  if (S.ctx?.card && S.open.has(S.ctx.card)) return 'card';
  return null;
}
function ctxHtml(k){
  const lang = L(), m = rec();
  if (k === 'form') return sec(h('cv.details'), `<div class="ce-help">${h('cv.detailsHelp')}</div>`);
  if (k === 'about'){
    const ids = aboutIds(), sel = { kind: 'bullet', id: ids.tagline ?? ids.summary, section: ids.tagline ? 'header' : 'summary' };
    const rows = resumeRows().map(r => rlink(r, t(r.photo?.show ? 'cv.photoOn' : 'cv.photoOff'), sel));
    return `${hdr(h('cv.aboutYou'), m.basics?.name ?? '')}${sec(h('cv.printedBy'), rlist(rows, h('cv.noResume')))}`;
  }
  if (k === 'sec'){
    const sd = doc(m, lang).secs.find(x => x.kind === S.ctx.sec); if (!sd) return '';
    const sid = secId(sd), total = sd.groupsOf ? sd.groupsOf.length : sd.items.length;
    const rl = resumeRows().map(r => { let on = false, n = 0; try { on = !!T.sectionList(m, r).find(x => x.id === sid)?.on; const li = T.itemList(m, r, sid); n = li ? li.filter(x => x.on).length : on ? total : 0; } catch { /* not in this resume */ } return [r, on, n]; });
    const pr = rlist(rl.filter(x => x[1]).map(([r, , n]) => rlink(r, t('cv.nOf', { n, total }), { kind: 'section', id: sid })), h('cv.noResumeShows'));
    return `${hdr(h('cv.thisSection'), sd.label, t('cv.nItems', { n: total }))}${sec(h('cv.shownBy'), pr)}${!sd.groupsOf && !WORDED.includes(sd.kind) ? `<p class="ce-note">${h('cv.sameEverywhere')}</p>` : ''}`;
  }
  if (k === 'card'){
    const g = S.ctx.card, e = doc(m, lang).entries.find(x => x.grp === g); if (!e) return '';
    const claim = e.kind === 'work' || e.kind === 'project', ids = new Set(e.lines.map(x => x.id));
    const pr = !claim ? [] : resumeRows().map(r => [r, listedOf(r, e.id).filter(x => ids.has(x)).length]).filter(x => x[1]);
    const rs = !claim ? `<p class="ce-note">${h('cv.printsWhole')}</p>` : rlist(pr.map(([r, n]) => rlink(r, t('cv.nOfLines', { n, total: e.lines.length }), { kind: 'job', id: e.id })), h('cv.noResumePrints'));
    const arch = e.kind === 'education' ? '' : `<section><button type="button" class="ce-b" data-act="c-arch-entry" data-id="${esc(g)}">${h(e.kind === 'work' ? 'cv.archiveJob' : 'cv.archiveEntry')}</button></section>`;
    return `${hdr(h('cv.thisEntry'), e.title, [e.org, e.place].filter(Boolean).join(' · '))}${sec(h('cv.printedBy'), rs)}${arch}`;
  }
  if (k === 'line'){
    const id = S.ctx.line, f = m.facts.find(x => x.id === id), vs = (f?.variants ?? []).map(v => m.variants.find(x => x.id === v)).filter(Boolean), jid = jobIdOf(id);
    const sel = jid ? { kind: 'bullet', id, job: jid, section: 'experience' } : { kind: 'bullet', id, section: 'summary' };
    const rl = resumeRows().map(r => { let label = null; try { if (!jid || listedOf(r, jid).includes(id)){ const v = T.chooseVariant(m, id, r).v; if (v) label = t('cv.printsN', { n: v.n }); } } catch { /* not printed */ } return [r, label]; }).filter(x => x[1]);
    const src = vs.find(v => v.source)?.source, cv = vs.find(v => (v.lang ?? 'en') === lang) ?? vs[0];
    return `${hdr(h('cv.thisLine'), one(cv?.text ?? '').slice(0, 80))}${sec(h('cv.printedBy'), rlist(rl.map(([r, label]) => rlink(r, label, sel)), h('cv.noResumePrints')))}${src ? sec(h('cv.source'), `<p class="ce-note">${esc(src)}</p>`) : ''}`;
  }
  return '';
}
// the language read: the app's segmented switch with what is left to write in each, or, from five languages, its list; none for one language
function langSwitch(){
  const ls = languages(), lang = L();
  if (ls.length < 2) return '';
  const n = l => toWriteIn(l);
  if (ls.length > 4) return `<div class="ce-lsw"><select data-ce-lang aria-label="${esc(t('cv.language'))}">${ls.map(l => `<option value="${l}"${l === lang ? ' selected' : ''}>${esc(lname(l))} · ${n(l) ? esc(t('cv.nToWrite', { n: n(l) })) : '✓'}</option>`).join('')}</select></div>`;
  return `<div class="ce-lsw"><div class="seg fill lswitch" role="group" aria-label="${esc(t('cv.language'))}">${ls.map(l => `<button type="button" data-act="cv-lang" data-l="${l}" aria-pressed="${l === lang}" title="${esc(n(l) ? t('cv.toWriteTip', { lang: lname(l), n: n(l) }) : t('cv.allWritten', { lang: lname(l) }))}">${U(l)} <small>${n(l) || '✓'}</small></button>`).join('')}</div></div>`;
}
// The map: every entry and section of the career, with a mark for each of its wordings in the language read: written (a soft dot), to write
// (a ring in the accent), to review (half a dot). A name goes to its card, a mark to that wording's editor.
const MARKS = 12;
function mapHtml(){
  const lang = L(), d = doc(rec(), lang), ids = aboutIds(), by = new Map(d.entries.map(e => [e.id, e]));
  let nw = 0, nr = 0;
  const meaning = st => (st === 'write' ? t('cv.mapWrite', { lang: lname(lang) }) : st === 'review' ? t('cv.mapReview') : t('cv.mapWritten'));
  const mark = (attrs, text, st, count = 0) => { if (st === 'write') nw += count || 1; else if (st === 'review') nr += 1;
    return `<button type="button" class="mk ${st}" data-act="cv-map" ${attrs} data-st="${st}" data-tip="${esc(meaning(st))}|${esc(one(text).slice(0, 160))}" aria-label="${esc(`${meaning(st)}: ${one(text).slice(0, 80)}`)}">${count ? `<em>${count}</em>` : ''}</button>`; };
  const lineMark = (g, id, w) => mark(`data-g="${esc(g ?? '')}" data-f="${esc(id)}" data-mode="${need(w) ? 'write' : 'words'}"`, w.text, need(w) ? 'write' : w.review ? 'review' : 'done');
  const row = (key, kind, title, attrs, marks) => {
    const ms = marks.match(/<button[\s\S]*?<\/button>/g) ?? [], gap = / (write|review)"/.test(marks);
    return `<div class="mprow${gap ? '' : ' ok'}" data-ol="${esc(key)}" style="--hk:${kindHue(kind)}"><button type="button" class="mt" data-act="cv-map" ${attrs}><span class="oc">${kindChip(kind, 'control')}</span><b>${esc(title)}</b></button><span class="mks">${ms.length > MARKS ? `${ms.slice(0, MARKS).join('')}<span class="mmore">+${ms.length - MARKS}</span>` : marks}</span></div>`;
  };
  const a = d.about;
  const about = row('ce-about', 'about', a.name.text, 'data-about="1"', ['tagline', 'contact', 'summary'].filter(k => a[k] && ids[k]).map(k => lineMark(null, ids[k], a[k])).join(''));
  const main = [], side = [];
  for (const b of K.timelineLayout(rec(), { lang, hideArchived: true }).bands){
    const mk = x => { const e = by.get(x.id); if (!e) return null;
      const tm = mark(`data-g="${esc(e.grp)}" data-f="" data-title="1"`, e.title, e.titleMissing && lang !== 'en' ? 'write' : 'done');
      return row(e.grp, e.kind, e.title, `data-g="${esc(e.grp)}"`, tm + e.lines.map(l => lineMark(e.grp, l.id, l)).join('')); };
    main.push(...b.main.map(mk).filter(Boolean)); side.push(...b.side.map(mk).filter(Boolean));
  }
  const secs = d.secs.filter(x => x.count || x.kind === 'skills').map(x => {
    const miss = x.groupsOf ? x.groupsOf.reduce((n, g) => n + (g.miss ? 1 : 0) + g.words.filter(w => w.miss).length, 0) : x.items.filter(i => i.titleMissing).length;
    return row(`ce-${x.id}`, x.kind, x.label, `data-k="${esc(x.kind)}"`, mark(`data-k="${esc(x.kind)}"`, x.label, miss ? 'write' : 'done', miss));
  }).join('');
  const grp = (label, rows) => `<section class="mg"><h4 class="oh">${label}</h4>${rows}</section>`;
  const parts = [nw && t('cv.nToWrite', { n: nw }), nr && t('cv.nToReview', { n: nr })].filter(Boolean).join(' · ');
  const many = languages().length > 1;
  const status = !parts ? (many ? t('cv.everythingWritten', { lang: lname(lang) }) : '') : many ? `${lname(lang)}: ${parts}` : parts;
  return `${status ? `<p class="ce-status">${esc(status)}</p>` : ''}<nav class="ce-map" aria-label="${esc(t('cv.mapLabel'))}">${grp(h('cv.aboutYou'), about)}${main.length ? grp(h('career.colMain'), main.join('')) : ''}${side.length ? grp(h('career.colSide'), side.join('')) : ''}${grp(h('cv.skillsCreds'), secs)}</nav>`;
}
// the career file, at the foot: what it holds, when it was saved, and its two ways out
function fileStats(){
  const d = doc(rec(), L()), jobs = d.entries.filter(e => e.kind === 'work').length, lines = d.entries.reduce((n, e) => n + e.lines.length, 0), at = C.savedAt?.();
  const when = at ? at.toLocaleTimeString([], { timeStyle: 'short' }) : '';
  return [t('cv.nJobs', { n: jobs }), t('cv.nLines', { n: lines }), t('cv.nLangs', { n: languages().length }), when && t('cv.savedAt', { time: when })].filter(Boolean).map(esc).join(' · ');
}
const fileCard = () => `<div class="ce-file"><div class="ce-fh"><b>career.json</b><span class="ce-fb"><button type="button" class="sm press" data-tier="secondary" data-act="cv-filemenu" aria-haspopup="menu" aria-expanded="false">${h('ux2.modeExport')}</button><button type="button" class="sm press" data-tier="secondary" data-act="cv-file" data-v="copy">${h('cv.copyAiShort')}</button></span></div><small>${fileStats()}</small></div>`;
// a save since the last draw: the stats line says when
function saved(){ const n = document.querySelector('#body .ce-file small'); if (n && C.ui.view === 'record') n.innerHTML = fileStats(); }
function sideHtml(){
  const k = ctxKind();
  if (k) return `<section class="insp ce-side">${langSwitch()}<button type="button" class="ce-ctxback" data-act="cv-ctxoff">${h('cv.back')}</button>${ctxHtml(k)}</section>`;
  return `<section class="insp ce-side ce-mapside">${langSwitch()}${mapHtml()}${fileCard()}</section>`;
}

// ---- menus: the toolbar's + Add, the right lane's head, the language list, the career file's Export ----
let pop = null;
function closePop(){ if (!pop) return false; pop.el.remove(); pop.anchor?.setAttribute('aria-expanded', 'false'); pop = null; return true; }
function openPop(anchor, kind, html){
  closePop();
  const el = document.createElement('div'), r = anchor.getBoundingClientRect();
  el.id = 'ce-pop'; el.className = `ce-pop is-${kind}`; el.innerHTML = html;
  document.body.append(el);
  const w = el.offsetWidth, left = kind === 'file' || anchor.id === 'ce-add' ? r.right - w : r.left;
  Object.assign(el.style, { left: `${Math.max(8, Math.min(left, innerWidth - w - 8))}px`, top: `${r.bottom + 6}px`, maxHeight: `${innerHeight - r.bottom - 18}px` });
  anchor.setAttribute('aria-expanded', 'true');
  pop = { el, anchor, kind };
  el.querySelector('button')?.focus({ preventScroll: true });
}
function addGroups(scope){
  const m = rec(), ks = K.kindsOf(m), name = k => K.kindName(m, k.id, L());
  const kt = ks.filter(k => k.place !== 'list').map(k => [k.id, name(k), k.id]), kl = ks.filter(k => k.place === 'list').map(k => [k.id, name(k), k.id]);
  if (scope === 'side') return [['', [['education', t('career.kind.education'), 'education'], ['project', t('career.kind.project'), 'project'], ...kt]]];
  const preset = p => (ks.some(k => k.store === K.KIND_PRESETS[p].store) ? [] : [[`~p:${p}`, t(`career.preset.${p}`), '']]);      // JSON Resume's volunteer and awards are kinds made from a preset
  return [[t('cv.mTimeline'), [['work', t('career.kind.work'), 'work'], ['education', t('career.kind.education'), 'education'], ['project', t('career.kind.project'), 'project'], ...kt, ...preset('volunteering')]],
    [t('cv.mLists'), [...['skills', 'languages', 'certificates', 'publications', 'interests', 'references'].map(k => [k, t(`cv.sec.${k}`), k]), ...kl, ...preset('awards')]],
    ...(m.basics?.summary ? [] : [[t('cv.aboutYou'), [['summary', t('cv.summary'), 'summary']]]]),
    ['', ks.length < K.MAX_KINDS ? [['~kind', t('career.somethingElse'), '']] : []]].filter(g => g[1].length);
}
const cog = k => (K.kindOf(rec(), k) ? `<button type="button" class="kset" data-act="cv-kind-edit" data-id="${esc(k)}" title="${esc(t('career.kindSettings', { name: K.kindName(rec(), k, L()) }))}" aria-label="${esc(t('career.kindSettings', { name: K.kindName(rec(), k, L()) }))}">⚙</button>` : '');
const presetIcon = p => { const x = K.KIND_PRESETS[p]; return `<span class="ai" style="--hk:var(--hue-${SWATCH_HUES[x.colour % 6]})">${icon(x.icon, { role: 'header' })}</span>`; };
const addItem = ([k, ti, hk]) => (k === '~kind' ? `<button type="button" role="menuitem" data-act="cv-kind-new"><span class="ai">${icon('plus', { role: 'header' })}</span><b>${esc(ti)}</b></button>`
  : k.startsWith('~p:') ? `<button type="button" role="menuitem" data-act="cv-kind-new" data-p="${esc(k.slice(3))}">${presetIcon(k.slice(3))}<b>${esc(ti)}</b></button>`
  : `<div class="addrowk"><button type="button" role="menuitem" data-act="cv-add" data-what="${esc(k)}"><span class="ai" style="--hk:${kindHue(hk)}">${kindChip(hk)}</span><b>${esc(ti)}</b></button>${cog(k)}</div>`);
const addMenu = scope => `<div class="addm inline-menu" role="menu" aria-label="${esc(t('career.add'))}">${addGroups(scope).map(([g, xs]) => `${g ? `<div class="ce-mg">${esc(g)}</div>` : xs.length && scope !== 'side' ? '<hr>' : ''}${xs.map(addItem).join('')}`).join('')}</div>`;
const fileMenu = () => `<div class="inline-menu" role="menu" aria-label="${esc(t('cv.exportFile'))}">
  <button type="button" role="menuitem" data-act="cv-file" data-v="career"><b>${h('cv.dlCareer')}</b><small>${h('cv.dlCareerSub')}</small></button>
  <button type="button" role="menuitem" data-act="cv-file" data-v="jsonresume"><b>${h('cv.dlJson')}</b><small>${h('cv.dlJsonSub')}</small></button>
  <button type="button" role="menuitem" data-act="cv-file" data-v="copy"><b>${h('cv.copyAi')}</b><small>${h('cv.copyAiSub')}</small></button></div>`;

// ---- the career file: BrewCV's own, JSON Resume in the language read, and the career as text for an AI chat ----
function jsonResume(m, lang){
  const d = doc(m, lang), b = m.basics ?? {}, a = d.about, ents = k => d.entries.filter(e => e.kind === k);
  const sk = d.secs.find(s => s.kind === 'skills')?.groupsOf ?? [], items = k => d.secs.find(s => s.kind === k)?.items ?? [];
  const entry = (e, f) => ({ ...f, startDate: e.start || undefined, endDate: e.end || undefined, highlights: e.lines.map(l => one(l.text)) });
  const store = k => K.kindOf(m, k)?.store, kinds = (st, place) => K.kindsOf(m).filter(k => k.store === st && (place ? k.place === place : true)).map(k => k.id);
  return { $schema: 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json',
    basics: { name: a.name.text, label: one(a.tagline?.text) || undefined, email: b.email, phone: b.phone, url: b.url, summary: a.summary?.text, location: b.location, profiles: b.profiles },
    work: ents('work').map(e => entry(e, { name: e.org, position: e.title, location: e.place })),
    education: ents('education').map(e => ({ institution: e.org, studyType: e.title, startDate: e.start || undefined, endDate: e.end || undefined })),
    volunteer: d.entries.filter(e => store(e.kind) === 'volunteer').map(e => entry(e, { organization: e.org, position: e.title })),
    projects: [...d.entries.filter(e => e.kind === 'project' || store(e.kind) === 'projects').map(e => entry(e, { name: e.title, entity: e.org, ...(K.kindOf(m, e.kind) ? { type: e.kind } : {}) })),
      ...kinds('projects', 'list').flatMap(k => items(k).map(x => ({ name: x.title, entity: x.sub, startDate: x.right, type: k })))],
    awards: kinds('awards').flatMap(items).map(x => ({ title: x.title, awarder: x.sub, date: x.right })),
    skills: sk.map(g => ({ name: g.name, keywords: g.words.map(w => w.text) })),
    languages: items('languages').map(x => ({ language: x.title, fluency: x.right })),
    certificates: items('certificates').map(x => ({ name: x.title, issuer: x.sub })),
    publications: items('publications').map(x => ({ name: x.title, publisher: x.sub })),
    interests: items('interests').map(x => ({ name: x.title })),
    references: (m.references ?? []).map(r => ({ name: r.name, reference: wordIn(r.id, lang).text || r.reference })),
    meta: { language: lang } };
}
function asText(m, lang){
  const d = doc(m, lang), a = d.about, o = [t('cv.aiIntro', { lang: lname(lang) }), '', `# ${a.name.text}`];
  if (a.tagline) o.push(one(a.tagline.text));
  if (a.contact) o.push('', one(a.contact.text));
  if (a.summary) o.push('', one(a.summary.text));
  for (const k of ['work', 'education', 'project', ...new Set(d.entries.map(e => e.kind))].filter((x, i, xs) => xs.indexOf(x) === i)){
    const es = d.entries.filter(e => e.kind === k); if (!es.length) continue;
    o.push('', `## ${k === 'work' ? t('career.colMain') : kindLabel(k, lang)}`);
    for (const e of es) o.push('', `### ${e.title}${e.org ? `, ${e.org}` : ''}${e.place ? ` (${e.place})` : ''}`, [e.start, e.end || presentIn(lang)].filter(Boolean).join(' – '), ...e.lines.map(l => `- ${one(l.text)}`));
  }
  for (const s of d.secs){
    if (!s.count) continue;
    o.push('', `## ${s.label}`);
    for (const g of s.groupsOf ?? []) o.push(`- **${g.name}**: ${g.words.map(w => w.text).join(', ')}`);
    for (const x of s.items ?? []) o.push(`- ${x.title}${x.right ? ` (${x.right})` : ''}${x.sub ? `, ${one(x.sub)}` : ''}`);
  }
  return o.join('\n');
}
async function file(kind){
  const m = C.work(), lang = L();
  if (kind === 'career') return C.download(serialize(save(m)), 'career.json');
  if (kind === 'jsonresume') return C.download(JSON.stringify(jsonResume(m, lang), null, 2) + '\n', `career-${lang}.json`);
  const text = asText(m, lang);
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* no clipboard: nothing copied */ }
  C.toast(t(ok ? 'cv.copied' : 'cv.copyFailed'), ok ? '' : 'bad');
}
const fileCounts = () => { const d = doc(rec(), L()); return { jobs: d.entries.filter(e => e.kind === 'work').length, langs: languages().length }; };

// ---- drawing ----
const pane = () => document.getElementById('scr');
function toolbarHtml(search){
  return `<div class="tbar ce-bar">${search}<button type="button" class="sm ce-tgl" data-act="cv-all" aria-pressed="${S.all}">${h(S.all ? 'cv.collapseAll' : 'cv.expandAll')}</button><button type="button" class="sm" id="ce-add" data-act="cv-menu" data-menu="add" aria-haspopup="menu" aria-expanded="false">${h('ux2.add')}</button></div>`;
}
function html(q){
  if (S.adding && !['work', 'education', 'project', 'certificates', 'publications'].includes(S.adding) && !K.kindOf(rec(), S.adding)) S.adding = null;      // the kind was undone
  const lang = L(), d = doc(rec(), lang);
  q = q.trim().toLowerCase();
  return `<div class="ce-doc">${about(d, lang, q)}<div class="ce-bh" id="ce-timeline">${h('cv.timeline')}</div>${timeline(d, lang, q)}<div class="ce-bh" id="ce-skills">${h('cv.skillsCreds')}</div><div class="ce-boxes">${lists(d, lang, q)}</div></div>`;
}
// after a draw: the timeline's lanes laid out, the focus asked for, then what an add opened brought into view, and the fades. Opening or
// closing a card or a section never scrolls Career.
function after(){
  const sc = pane(); if (!sc) return;
  flowLanes(); watchFlow();
  const how = S.reveal === true ? 'jump' : S.reveal; S.reveal = false;
  let f = null;
  if (S.focus){
    f = sc.querySelector(S.focus); S.focus = null;
    if (f){ f.focus({ preventScroll: true }); if (f.tagName === 'TEXTAREA') f.setSelectionRange(f.value.length, f.value.length); else f.select?.(); }
  }
  if (f && how) reveal(sc, f, how);
  marks2(); dim();
}
// + Add: Career scrolls smoothly to where the new entry goes, and once it is there the entry's form grows open in place, what is below
// sliding down. A hover add (on a section or a lane) grows open where it is, and scrolls only as far as the form needs to be seen. A jump
// (from the sidebar, a kind just made) only scrolls. Under reduced motion: no glide, no growing, the same end.
const GROW_MS = 240;
function grow(el, then){
  el.style.removeProperty('height'); el.style.removeProperty('overflow');
  const hh = el.offsetHeight;
  const a = el.animate([{ height: '0px', opacity: 0, overflow: 'hidden' }, { height: `${hh}px`, opacity: 1, overflow: 'hidden' }], { duration: GROW_MS, easing: 'cubic-bezier(.3, .7, .2, 1)' });
  a.finished.then(() => then?.(), () => {});
}
function whenStill(sc, fn){
  let done = false;
  const end = () => { if (done) return; done = true; sc.removeEventListener('scrollend', end); fn(); };
  sc.addEventListener('scrollend', end, { once: true });
  setTimeout(end, 1500);      // a browser with no scrollend: the glide is over by then
}
function reveal(sc, f, how){
  const slow = !reduced(), TOP = 84, FOOT = 24;
  const form = how === 'jump' ? null : f.closest('#ce-addcard, #ce-kindcard, .ce-inl');
  if (how === 'here'){
    const show = () => { const r = (form ?? f).getBoundingClientRect(); const dy = r.bottom > innerHeight - FOOT ? Math.min(r.bottom - innerHeight + FOOT, r.top - TOP) : r.top < TOP ? r.top - TOP : 0; if (dy) sc.scrollBy({ top: dy, behavior: slow ? 'smooth' : 'auto' }); };
    if (form && slow) grow(form, show); else show();
    return;
  }
  const box = f.closest('.ce-box, .ce-kindcard, .ce-addcard, .ce-card, .ce-about') ?? f;
  if (form && slow){ form.style.height = '0px'; form.style.overflow = 'hidden'; }      // not shown at its full size before the glide arrives
  const to = Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, sc.scrollTop + box.getBoundingClientRect().top - TOP));
  const open = () => { if (form && slow) grow(form); };
  if (Math.abs(to - sc.scrollTop) < 1){ open(); return; }
  if (!slow){ sc.scrollTop = to; return; }
  sc.scrollTo({ top: to, behavior: 'smooth' });
  whenStill(sc, open);
}
// Two lanes, each in its own time: a card sits at its year's place (where the year's band would start with every card closed) unless an
// earlier card of its own lane is still in the way; an open card pushes only the cards of its lane. The year labels follow the left lane, on
// the spine. One column (a narrow pane) is drawn as it is.
function flowLanes(){
  const box = pane()?.querySelector('.ce-doc .ce-bands'); if (!box) return;
  const rows = [...box.querySelectorAll(':scope > .ce-yrow')], yrs = [...box.querySelectorAll(':scope > .ce-yr')];
  const flat = () => { box.classList.remove('ce-flow'); box.style.removeProperty('height'); for (const n of box.querySelectorAll(':scope > .ce-yr, .ce-card')) for (const k of ['top', 'width']) n.style.removeProperty(k); };
  if (!rows.length || rows.length !== yrs.length || getComputedStyle(rows[0]).gridTemplateColumns.trim().split(/\s+/).length < 2){ flat(); return; }
  // measured in place, never by drawing the lanes as they were first: the yearly rows keep their columns, only their height is gone
  const B = box.getBoundingClientRect(), px = v => parseFloat(v) || 0, cz = px(getComputedStyle(box).getPropertyValue('--cz')) || 1;
  const lanes = [...rows[0].children].map(l => { const r = l.getBoundingClientRect(), c = getComputedStyle(l); return { left: r.left - B.left + px(c.paddingLeft) + px(c.borderLeftWidth), width: r.width - px(c.paddingLeft) - px(c.borderLeftWidth) - px(c.paddingRight) }; });
  const gap = px(getComputedStyle(rows[0].children[0]).rowGap), mt = 12 * cz, mb = 4 * cz;      // the year label's own margins (flow.css .ce-yr)
  const at = [];
  let yC = 0, curL = 0, curR = 0;
  yrs.forEach((yr, k) => {
    const band = mt + yr.offsetHeight + mb;
    const [L, R] = [...rows[k].children].map(l => [...l.children].filter(c => c.matches('.ce-card')));
    const tb = yC, ly = Math.max(tb, curL);
    at.push([yr, ly + mt, null]);
    let y = ly + band;
    for (const c of L){ at.push([c, y, lanes[0].width]); c.style.width = `${lanes[0].width}px`; y += c.offsetHeight + gap; }
    curL = y;
    y = Math.max(tb + band, curR);
    for (const c of R){ at.push([c, y, lanes[1].width]); c.style.width = `${lanes[1].width}px`; y += c.offsetHeight + gap; }
    curR = y;
    const shut = cs => cs.reduce((n, c) => n + (c.querySelector(':scope > .ce-ch')?.offsetHeight ?? c.offsetHeight) + 2 + gap, 0);
    yC = tb + band + Math.max(shut(L), shut(R));
  });
  box.style.setProperty('--ce-l0', `${lanes[0].left}px`);
  box.style.setProperty('--ce-l1', `${lanes[1].left}px`);
  box.style.setProperty('--ce-rx', `${lanes[1].left - 14}px`);
  for (const [n, top] of at) n.style.top = `${top}px`;
  box.style.height = `${Math.max(curL, curR, yC)}px`;
  box.classList.add('ce-flow');
}
// laid out again when a card or the column changes size without a redraw (the zoom, a font arriving, the window)
let flowQueued = 0;
const flowRO = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (!flowQueued) flowQueued = requestAnimationFrame(() => { flowQueued = 0; flowLanes(); }); }) : null;
function watchFlow(){
  if (!flowRO) return;
  flowRO.disconnect();
  const doc = pane()?.querySelector('.ce-doc'); if (!doc) return;
  flowRO.observe(doc);
  for (const n of doc.querySelectorAll('.ce-bands .ce-ch')) flowRO.observe(n);
}
// Its picks: an entry none of whose facts the open resume prints (its page, as drawn) is dimmed in place; the page may be drawn after Career
function dim(){
  const on = lensOn(), shown = on ? C.printed() : null, w = on ? C.work() : null;
  for (const c of pane()?.querySelectorAll('.ce-doc .ce-card[data-ce-card]') ?? []){
    c.classList.toggle('is-sel', S.ctx?.card === c.dataset.ceCard && c.classList.contains('is-open'));      // the open entry wears the app's selection ring
    const x = on && (w[c.dataset.key] ?? []).find(e => e.id === c.dataset.ceCard);
    c.classList.toggle('is-off', !!on && !(x && [...Object.values(x.display ?? {}), ...(x.highlights ?? [])].some(f => shown.has(f))));
  }
}
// the top fade shows once Career is scrolled, the foot's while there is more below; the toolbar's box stays clear of it
function marks2(){
  const sc = pane(); if (!sc || C.ui.view !== 'record') return;
  const bar = sc.querySelector('.ce-bar');
  sc.classList.toggle('ce-more', sc.scrollTop + sc.clientHeight < sc.scrollHeight - 2);
  if (bar){
    const r = bar.getBoundingClientRect(), ramp = r.height + 16;
    sc.style.setProperty('--ce-ramp', `${ramp}px`);
    if (!SCROLL_TIMELINE) sc.style.setProperty('--ce-f', String(Math.min(1, sc.scrollTop / ramp)));      // a browser with no scroll timeline: the same strength, set from the scroll
    sc.style.setProperty('--ce-bx', `${r.left}px`); sc.style.setProperty('--ce-bw', `${r.width}px`); sc.style.setProperty('--ce-bt', `${r.top}px`); sc.style.setProperty('--ce-br', getComputedStyle(bar).borderTopLeftRadius); sc.style.setProperty('--ce-bh', `${r.height}px`); sc.style.setProperty('--ce-bb', `${r.bottom}px`);
  }
}
const SCROLL_TIMELINE = globalThis.CSS?.supports?.('animation-timeline: scroll()') ?? false;
const dirtyFields = () => [...(pane()?.querySelectorAll('.ce-doc .ce-ed') ?? [])].filter(f => f.value !== f.defaultValue);
const dirty = () => dirtyFields().length > 0 || [...S.drafts.values()].some(v => String(v).trim());
// Esc (and Cmd/Ctrl+.): a menu first, then an edit in progress is cancelled (only that), then what is open closes.
// A click on the bare ground and the mouse's back button do the same, except that they never cancel an edit: it stays.
function escape(soft = false){
  if (C.ui.view !== 'record') return false;
  if (closePop()) return true;
  if (dirty()){
    if (soft) return false;
    for (const f of dirtyFields()) f.value = f.defaultValue;
    S.drafts.clear(); S.editing = null; document.activeElement?.blur?.(); draw(); return true;
  }
  if (anyOpen()){ solo(null); document.activeElement?.blur?.(); draw(); return true; }
  return false;
}
const closeMenus = () => closePop();

const groupOfFact = id => doc(rec(), L()).entries.find(e => e.lines.some(l => l.id === id))?.grp ?? null;
const setLang = l => { C.setLang(l); };
async function act(a, tg){
  const d = tg.dataset;
  switch (a){
    case 'cv-lang': closePop(); if (d.l !== L()) setLang(d.l); return true;
    case 'cv-all': { const on = !S.all; solo(null); S.all = on; if (on) for (const e of doc(rec(), L()).entries) if (e.lines.length || e.kind === 'work' || e.kind === 'project') S.open.add(e.grp); draw(); return true; }
    case 'cv-menu': {
      if (pop?.anchor === tg){ closePop(); return true; }
      openPop(tg, d.menu, addMenu(d.menu === 'side' ? 'side' : 'all')); return true;
    }
    case 'cv-add': { const how = tg.closest('#ce-pop') ? 'menu' : 'here'; closePop(); startAdd(d.what, how); return true; }
    case 'cv-file': closePop(); await file(d.v); return true;
    case 'cv-filemenu': if (pop?.kind === 'file') closePop(); else openPop(tg, 'file', fileMenu()); return true;
    case 'cv-tog': { const g = d.g; if (S.open.has(g) && !S.all){ S.open.delete(g); if (S.ctx?.card === g) S.ctx = null; } else solo(g); draw(); return true; }
    case 'cv-details': { const on = S.detail !== d.g; solo(null); if (on){ S.detail = d.g; S.ctx = { card: d.g }; S.focus = '.ce-det input'; } draw(); return true; }
    case 'cv-about': { const on = !S.about; solo(null); S.about = on; draw(); return true; }
    case 'cv-line': case 'cv-writeln': {      // a line's wordings fan out; its "write in" mark opens the English over an empty box
      const id = d.f, write = a === 'cv-writeln', now = S.fan.get(id);
      if (now && (!write || now === 'write')){ S.fan.delete(id); if (S.ctx?.line === id) S.ctx = { card: S.ctx.card }; if (S.editing?.fact === id) S.editing = null; }
      else { const g = groupOfFact(id); solo(g); S.fan.set(id, write ? 'write' : 'words'); S.ctx = { card: g, line: id }; if (write) S.focus = '#ce-ta'; }
      draw(); return true;
    }
    case 'cv-edit': S.editing = { kind: 'edit', fact: d.f, vid: d.v }; S.focus = '#ce-ta'; draw(); return true;
    case 'cv-newv': S.editing = { kind: 'new', fact: d.f }; S.focus = '#ce-ta'; draw(); return true;
    case 'cv-newline': solo(d.g); S.editing = { kind: 'line', entry: d.g }; S.focus = '#ce-ta'; draw(); return true;
    case 'cv-save': saveWording(tg); return true;
    case 'cv-cancel': if (S.editing){ S.drafts.delete(ekey(S.editing)); S.editing = null; } else if (d.f){ S.drafts.delete(`write:${d.f}:`); S.fan.delete(d.f); } draw(); return true;
    case 'cv-read': commit(x => { R.clearFlag(x.record, d.v, 'needs-review'); }, t('cv.undoMarkRead')); draw(); return true;
    case 'cv-use': commit(x => T.pickVersion(x.record, x.cur, d.f, d.v), t('undo.useVersion', { n: rec().variants.find(v => v.id === d.v)?.n ?? '?' }), t('cv.nowPrints')); draw(); return true;
    case 'cv-tick': keepScroll(() => commit(x => T.setBulletOn(x.record, x.cur, d.f, tg.checked), t(tg.checked ? 'cv.undoLineOn' : 'cv.undoLineOff'))); draw(); return true;
    case 'cv-itick': keepScroll(() => commit(x => T.setItemOn(x.record, x.cur, d.id, tg.checked), t(tg.checked ? 'cv.undoItemOn' : 'cv.undoItemOff'))); draw(); return true;
    case 'cv-secon': S.ctx = { sec: tg.closest('[data-ce-sec]')?.dataset.ceSec }; keepScroll(() => commit(x => T.setSectionOn(x.record, x.cur, d.id, tg.checked), t(tg.checked ? 'cv.undoSecOn' : 'cv.undoSecOff'))); draw(); return true;
    case 'cv-same': commit(x => setSame(x.record, sameKey(d.id), tg.checked), t(tg.checked ? 'cv.undoSame' : 'cv.undoPerLang')); draw(); return true;
    case 'cv-secedit': case 'cv-secopen': {
      const k = d.k, was = S.secEdit === k;
      if (a === 'cv-secedit' && was){ S.secEdit = null; S.ctx = null; S.skWrite = S.skAdd = S.iwrite = null; S.iadd = false; draw(); return true; }
      if (!was){ solo(null); S.secEdit = k; S.ctx = { sec: k }; S.focus = d.id ? `[data-ce-er="${CSS.escape(d.id)}"] .ce-fi` : `[data-ce-sec="${CSS.escape(k)}"] .ce-fi`; }
      draw(); return true;
    }
    case 'cv-secadd': {
      const k = d.k, lang = L(); let id;
      const mk = { certificates: x => K.addCertificate(x.record, { name: t('cv.newCert') }), languages: x => K.addLanguage(x.record, { language: t('cv.newLanguage') }, lang), publications: x => K.addPublication(x.record, { name: t('cv.newPub') }, lang),
        interests: x => K.addInterest(x.record, { name: t('cv.newInterest') }, lang), references: x => K.addReference(x.record, { name: t('cv.newRef') }, lang) }[k] ?? (x => K.addKindEntry(x.record, k, { name: t('cv.newEntry'), lang }));
      if (commit(x => { id = mk(x); }, t('undo.addItem')) && id) S.focus = `[data-ce-er="${CSS.escape(id)}"] .ce-fi`;
      draw(); return true;
    }
    case 'cv-del': { const k = tg.closest('[data-ce-sec]').dataset.ceSec; S.fan.delete(d.id); commit(x => { K.deleteItem(x.record, k, d.id, [x.cur, ...(x.resumes ?? [])].filter(Boolean)); }, t('undo.deleteItem')); draw(); return true; }
    case 'cv-gnew': { let id; if (commit(x => { id = K.addSkill(x.record, { name: t('cv.newGroup'), keywords: [] }, L()); }, t('undo.addItem')) && id) S.focus = `[data-gid="${CSS.escape(id)}"] .gname`; draw(); return true; }
    case 'cv-gdel': commit(x => { K.deleteItem(x.record, 'skills', d.g, [x.cur, ...(x.resumes ?? [])].filter(Boolean)); }, t('undo.deleteItem')); draw(); return true;
    case 'cv-wadd': S.skAdd = d.g; S.skWrite = null; S.focus = '.ce-wain'; draw(); return true;
    case 'cv-pdel': commit(x => setGroupWords(x.record, d.g, (x.record.skills.find(s => s.id === d.g)?.keywords ?? []).filter(w => w !== d.k)), t('undo.editItem')); draw(); return true;
    case 'cv-pwrite': S.skWrite = d.id; S.skAdd = null; S.focus = '[data-ce-pwin]'; draw(); return true;
    case 'cv-iwrite': { const keep = S.secEdit; solo(null); S.secEdit = keep; S.ctx = keep ? { sec: keep } : null; S.iwrite = d.id; S.focus = '[data-ce-iwin]'; draw(); return true; }
    case 'cv-iadd': S.iadd = true; S.focus = '[data-ce-iain]'; draw(); return true;
    case 'cv-kind-new': closePop(); solo(null); S.kind = { id: null, draft: newKind(d.p ?? null), del: false }; S.focus = '#ce-kindcard [data-ce-k=name]'; S.reveal = tg.closest('#ce-pop') ? 'menu' : 'here'; draw(); return true;
    case 'cv-kind-edit': { closePop(); solo(null); const k = K.kindOf(rec(), d.id); if (!k) return true; S.kind = { id: d.id, draft: structuredClone(k), del: false }; S.focus = '#ce-kindcard [data-ce-k=name]'; S.reveal = tg.closest('#ce-pop') ? 'menu' : 'here'; draw(); return true; }
    case 'cv-kpreset': readKind(); S.kind.draft = applyPreset(S.kind.draft, d.p); draw(); return true;
    case 'cv-kcolour': readKind(); S.kind.draft.colour = Number(d.i); if (S.kind.id) saveKindNow(); draw(); return true;
    case 'cv-kicon': readKind(); S.kind.draft.icon = d.i; if (S.kind.id) saveKindNow(); draw(); return true;
    case 'cv-kcreate': createKind(); return true;
    case 'cv-kcancel': case 'cv-kdone': S.kind = null; draw(); return true;
    case 'cv-kdel': S.kind.del = true; draw(); return true;
    case 'cv-kdelno': S.kind.del = false; draw(); return true;
    case 'cv-kdelmove': case 'cv-kdelall': {
      const id = S.kind.id, to = a === 'cv-kdelmove' ? document.querySelector('#ce-kindcard [data-ce-k=move]')?.value ?? null : null;
      let res;
      if (commit(x => { res = K.deleteKind(x.record, id, { moveTo: to, recipes: recipesOf(x) }); }, t('undo.deleteKind')) && res){ C.toast(to ? t('career.kindMoved', { n: res.moved }) : t('career.kindDeleted', { n: res.deleted }), '', true); S.kind = null; }
      draw(); return true;
    }
    case 'cv-profadd': commit(x => { (x.record.basics ??= {}).profiles = [...(x.record.basics.profiles ?? []), { network: '', username: '', url: '' }]; }, t('cv.undoProfile')); S.focus = '.ce-prof:last-of-type input'; draw(); return true;
    case 'cv-profdel': commit(x => { x.record.basics.profiles = (x.record.basics.profiles ?? []).filter((_, i) => i !== Number(d.i)); }, t('cv.undoProfile')); draw(); return true;
    case 'cv-addsave': saveAdd(); return true;
    case 'cv-addcancel': S.adding = null; draw(); return true;
    case 'cv-inlsave': saveInl(); return true;
    case 'cv-inlcancel': S.inl = null; draw(); return true;
    case 'cv-ctxoff': solo(null); draw(); return true;
    case 'cv-map': {      // the map: a name goes to its card and opens it, a mark to that wording's editor in the language read
      const f = d.f, g = d.g || null;
      if (f){ solo(g); S.fan.set(f, d.mode); S.ctx = { ...(S.ctx ?? {}), line: f }; S.focus = d.mode === 'write' ? '#ce-ta' : '.ce-doc .ce-fan'; S.reveal = 'here'; }
      else if (d.k){ solo(null); S.secEdit = d.k; S.ctx = { sec: d.k }; S.focus = `.ce-doc [data-ce-sec="${CSS.escape(d.k)}"]`; S.reveal = 'jump'; }
      else if (g){ solo(g); S.focus = `[data-ce-card="${CSS.escape(g)}"]`; S.reveal = 'jump'; }
      else { solo(null); S.focus = '#ce-about'; S.reveal = 'jump'; }
      draw(); return true;
    }
    case 'cv-ropen': return C.openAt(d.rid, JSON.parse(d.sel));
  }
  return false;
}

// ---- keys, the ground, drag and drop, and fields that save when left ----
export function initCareerView(ctx){
  C = ctx;
  initMonthPick({ name: 'ce', lang: () => L() });
  const inCareer = () => C.ui.view === 'record';
  document.addEventListener('keydown', e => {
    if (!inCareer()) return;
    const dot = (e.metaKey || e.ctrlKey) && e.key === '.';
    const tg = e.target;
    if (e.key === 'Escape' || dot){
      if (e.isComposing || tg.closest?.('#rec-q, #mp-menu, .langpop, dialog')) return;
      if (tg.matches?.('[data-ce-wain], [data-ce-iain], [data-ce-iwin], [data-ce-pwin]')){ e.preventDefault(); e.stopImmediatePropagation(); Object.assign(S, { skAdd: null, iadd: false, iwrite: null, skWrite: null }); draw(); return; }
      if (tg.closest?.('.ce-inl')){ e.preventDefault(); e.stopImmediatePropagation(); S.inl = null; draw(); return; }
      if (tg.closest?.('#ce-addcard')){ e.preventDefault(); e.stopImmediatePropagation(); S.adding = null; draw(); return; }
      if (tg.closest?.('#ce-kindcard') && !S.kind?.id){ e.preventDefault(); e.stopImmediatePropagation(); S.kind = null; draw(); return; }
      if (tg.closest?.('[data-form]') && !dot) return;      // a form field's own Esc puts it back (career.js)
      if (escape()){ e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && tg.matches?.('.ce-ch[data-act]') && tg === e.target){ e.preventDefault(); tg.click(); return; }
    if (e.key !== 'Enter' || e.isComposing) return;
    if (tg.matches?.('[data-ce-wain]')){ e.preventDefault(); addWordTo(tg.dataset.ceWain, tg.value); return; }
    if (tg.matches?.('[data-ce-iain]')){ e.preventDefault(); const v = tg.value.trim(); S.iadd = false; if (v) commit(d => { K.addInterest(d.record, { name: v }, L()); }, t('undo.addItem')); S.iadd = true; S.focus = '[data-ce-iain]'; draw(); return; }
    if (tg.matches?.('[data-ce-iwin], [data-ce-pwin], .ce-se input[data-ce-fi], .ce-se input[data-ce-gname]')){ e.preventDefault(); tg.blur(); return; }
    if (tg.matches?.('.ce-inl [data-ce-inlin]') && !(tg.tagName === 'TEXTAREA' && e.shiftKey)){ e.preventDefault(); saveInl(); return; }
    if (tg.closest?.('#ce-addcard') && tg.tagName === 'INPUT'){ e.preventDefault(); saveAdd(); }
    if (tg.closest?.('#ce-kindcard') && tg.matches('[data-ce-k]')){ e.preventDefault(); if (S.kind?.id) tg.blur(); else createKind(); }
  }, true);
  document.addEventListener('mouseup', e => { if (e.button === 3 && inCareer() && escape(true)) e.preventDefault(); }, true);
  // the bare ground: around the column, between the cards, the timeline's own gaps; never a card, a field or a control
  const bare = n => n.id === 'scr' || (!!n.closest?.('#scr .ce-doc') && !n.closest('.ce-card, .ce-box, .ce-about, .ce-addcard, .ce-inl, button, a, input, select, textarea, label, [data-act]'));
  document.addEventListener('click', e => { if (inCareer() && bare(e.target)) escape(true); }, true);
  document.addEventListener('pointerdown', e => { if (pop && !pop.el.contains(e.target) && !pop.anchor.contains(e.target)) closePop(); }, true);
  document.addEventListener('scroll', e => { if (e.target.id === 'scr' && inCareer()){ closePop(); marks2(); } }, { capture: true, passive: true });
  addEventListener('resize', () => { if (inCareer()) marks2(); }, { passive: true });
  document.addEventListener('input', e => { const k = e.target.dataset?.ceTa; if (k != null) S.drafts.set(k, e.target.value); });
  document.addEventListener('change', e => {
    const tg = e.target; if (!inCareer()) return;
    if (tg.matches?.('select[data-ce-lang]')){ if (tg.value !== L()) setLang(tg.value); return; }
    if (!tg.closest?.('.ce-doc')) return;
    if (tg.matches('[data-ce-fi]') && tg.closest('[data-ce-er]')){ saveRow(tg.closest('[data-ce-er]')); draw(); return; }
    if (tg.matches('[data-ce-iwin]')){ const id = tg.dataset.ceIwin; if (S.iwrite !== id) return; S.iwrite = null; const v = tg.value.trim(), lang = L(); if (v) commit(d => { if (lang === 'en') K.updateInterest(d.record, id, { name: v }, 'en'); else setWording(d, id, lang, v); }, t('cv.undoWriteIn', { lang: lname(lang) })); draw(); return; }
    if (tg.matches('[data-ce-gname]')){ commit(d => { K.updateSkill(d.record, tg.dataset.ceGname, { name: tg.value }, L()); }, t('undo.editItem')); draw(); return; }
    if (tg.matches('[data-ce-pwin]')) writeWord(tg.dataset.cePwin, tg.dataset.k, tg.value);
    if (tg.matches('[data-ce-pk]')){ const i = Number(tg.closest('[data-ce-prof]').dataset.ceProf); commit(x => { const ps = [...(x.record.basics.profiles ?? [])]; ps[i] = { ...ps[i], [tg.dataset.cePk]: tg.value.trim() }; x.record.basics.profiles = ps; }, t('cv.undoProfile')); draw(); return; }
    if (tg.matches('#ce-kindcard [data-ce-k=name], #ce-kindcard [data-ce-k=org]')){ readKind(); if (S.kind?.id) saveKindNow(); return; }
    if (tg.matches('#ce-kindcard [name=ce-kplace]') && S.kind){ readKind(); S.kind.draft.place = tg.value; draw(); }
  });
  // native drag and drop: a row by its grip within its list, a skill word between and within groups
  document.addEventListener('dragstart', e => {
    const gp = e.target.closest?.('[data-ce-grip]'), pw = e.target.closest?.('[data-ce-pw]');
    if (gp){ const row = gp.closest('[data-ce-er]'); S.drag = { kind: 'row', id: row.dataset.ceEr, sec: row.closest('[data-ce-sec]').dataset.ceSec }; e.dataTransfer.setData('text/plain', S.drag.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setDragImage(row, 12, 12); row.classList.add('is-drag'); }
    else if (pw){ S.drag = { kind: 'pill', g: pw.dataset.g, k: pw.dataset.k }; e.dataTransfer.setData('text/plain', S.drag.k); e.dataTransfer.effectAllowed = 'move'; pw.classList.add('is-drag'); }
  });
  const target = e => (S.drag?.kind === 'row' ? e.target.closest?.('[data-ce-er]') : S.drag ? e.target.closest?.('[data-ce-ws]') : null);
  document.addEventListener('dragover', e => {
    const tg = target(e);
    for (const n of document.querySelectorAll('.ce-over')) n.classList.remove('ce-over');
    if (!tg || (S.drag.kind === 'row' && tg.closest('[data-ce-sec]')?.dataset.ceSec !== S.drag.sec)) return;
    e.preventDefault(); tg.classList.add('ce-over');
  });
  document.addEventListener('drop', e => {
    const dr = S.drag, tg = target(e); S.drag = null;
    if (!dr) return;
    e.preventDefault();      // a drop of ours is never the browser's (it would open the text as a page)
    if (!tg) return;
    if (dr.kind === 'row'){
      if (tg.closest('[data-ce-sec]')?.dataset.ceSec !== dr.sec) return;
      const r = tg.getBoundingClientRect(), below = e.clientY > r.top + r.height / 2, rows = [...tg.parentElement.querySelectorAll('[data-ce-er]')].filter(x => x.dataset.ceEr !== dr.id);
      const before = below ? rows[rows.indexOf(tg) + 1]?.dataset.ceEr ?? null : tg.dataset.ceEr;
      if (tg.dataset.ceEr !== dr.id) commit(d => moveItem(d.record, dr.sec, dr.id, before), t('cv.undoMove'));
    } else {
      const to = tg.dataset.ceWs, pill = e.target.closest('[data-ce-pw]');
      let beforeK = null;
      if (pill && pill.dataset.k !== dr.k){ const r = pill.getBoundingClientRect(), pills = [...tg.querySelectorAll('[data-ce-pw]')].filter(x => x.dataset.k !== dr.k); beforeK = e.clientX > r.left + r.width / 2 ? pills[pills.indexOf(pill) + 1]?.dataset.k ?? null : pill.dataset.k; }
      commit(d => {
        const from = d.record.skills.find(s => s.id === dr.g), dst = d.record.skills.find(s => s.id === to); if (!from || !dst) return;
        const a = (from.keywords ?? []).filter(w => w !== dr.k), b = dr.g === to ? a : (dst.keywords ?? []).filter(w => w !== dr.k);
        const at = beforeK ? b.indexOf(beforeK) : -1; b.splice(at < 0 ? b.length : at, 0, dr.k);
        if (dr.g !== to) setGroupWords(d.record, dr.g, a);
        setGroupWords(d.record, to, b);
      }, t('cv.undoMoveWord'));
    }
    draw();
  });
  document.addEventListener('dragend', () => { S.drag = null; for (const n of document.querySelectorAll('.ce-over, .is-drag')) n.classList.remove('ce-over', 'is-drag'); });
  return { html, toolbarHtml, sideHtml, langSwitch, saved, after, act, escape, closeMenus, fileCounts, languages, dim, solo: () => { solo(null); } };
}
