// The Career workspace: the record, and only the record, with every version of every text.
// Nothing here tailors a resume (on/off, which version, Keep, sections); that is the Resume
// workspace. A claim opens the Resume's own panel (edit.js claimPanel) minus what tailors.

import * as K from '../model/career.js';
import { versionsIn } from '../model/record.js';
import { langName, langsInUse, addLangInUse, isSame, sameKey } from '../model/lang.js';
import { DEFAULT_LANG, defaultVariant } from '../model/resume.js';
import { entryKey } from '../model/entries.js';
import { t, h, tIn, errText, loadCatalogue } from '../i18n/index.js';
import { langMenuHtml, focusMenu } from './langmenu.js';
import { crumb, claimRow as partClaimRow, addClaimHtml, clip } from './parts.js';

let C = null;
export function initCareer(ctx){ C = ctx; return api; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = s => document.querySelector(s);
const st = () => C.store.state;
const rec = () => C.work();

// view state; none of it is undone or saved
const W = {
  area: 'timeline',          // 'about' | 'timeline' | 'more'
  sel: null,                 // { what, id, key?, group?, claim? }
  details: false,
  adding: null,              // { what } the new-entry form in the column
  pop: null,
  more: false,
  lang: null,
  kind: null,                // the kind editor: { id | null, draft }
  delKind: null,
  tip: null,
  shown: new Set(),          // entries whose archived claims are revealed
  jobs: false,               // archived jobs are revealed in the timeline
};
const TIP_KEY = 'rb-career-tips';
const tipsDone = () => { try { return localStorage.getItem(TIP_KEY) === 'done'; } catch { return true; } };
const setTipsDone = v => { try { if (v) localStorage.setItem(TIP_KEY, 'done'); else localStorage.removeItem(TIP_KEY); } catch { /* this session only */ } };
const TIPS = [['career.tip1h', 'career.tip1'], ['career.tip2h', 'career.tip2'], ['career.tip3h', 'career.tip3']];

export const L = () => W.lang ?? st().cur?.lang ?? DEFAULT_LANG;

const SVG = {
  work: '<path d="M2 5h12v8.5H2z"/><path d="M6 5V3.3h4V5M2 8.5h12"/>',
  education: '<path d="M1 6.2 8 3l7 3.2-7 3.2z"/><path d="M4 7.6v3.2c2.2 1.6 5.8 1.6 8 0V7.6M15 6.2v4"/>',
  project: '<path d="M8 1.6l5.6 3v6.8L8 14.4l-5.6-3V4.6z"/><path d="M2.4 4.6 8 7.6l5.6-3M8 7.6v6.8"/>',
  publications: '<path d="M4 1.6h5.4L12 4.2v10.2H4z"/><path d="M9.4 1.6v2.6H12M6 8h4M6 10.6h4"/>',
  skills: '<path d="M10.2 2.2a3.4 3.4 0 0 0-3.9 4.5L2 11l3 3 4.3-4.3a3.4 3.4 0 0 0 4.5-3.9l-2 2-2.3-.6-.6-2.3z"/>',
  languages: '<path d="M2.5 3h11v7.5H8L4.8 13v-2.5H2.5z"/><path d="M5.3 6.6h5.4M5.3 8.4h3.4"/>',
  certificates: '<circle cx="8" cy="6.2" r="3.8"/><path d="M5.6 9.2 4.6 14.4 8 12.6l3.4 1.8-1-5.2"/><path d="m6.6 6.2 1 1 1.9-2"/>',
  awards: '<path d="M5 2.2h6v3.6a3 3 0 0 1-6 0zM5 3.4H2.6v1a2.4 2.4 0 0 0 2.6 2.4M11 3.4h2.4v1A2.4 2.4 0 0 1 10.8 6.8M8 8.8v2.8M5.4 14h5.2M6.4 11.6h3.2v2.4H6.4z"/>',
  interests: '<circle cx="8" cy="8" r="6"/><path d="m10.6 5.4-1.6 3.6-3.6 1.6 1.6-3.6z"/>',
  references: '<path d="M2.6 3.4h4.2v4.2c0 2.4-1.2 4-3.4 5"/><path d="M9.2 3.4h4.2v4.2c0 2.4-1.2 4-3.4 5"/>',
  about: '<circle cx="8" cy="5.6" r="2.8"/><path d="M2.6 14c.6-3 2.8-4.6 5.4-4.6s4.8 1.6 5.4 4.6"/>',
  heart: '<path d="M8 13.6S2 10 2 5.9A3 3 0 0 1 8 4.6a3 3 0 0 1 6 1.3C14 10 8 13.6 8 13.6z"/>',
  frame: '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="m3.5 11.5 3-3.5 2.5 2.5 1.5-1.5 2 2.5"/><circle cx="10.5" cy="5.5" r="1"/>',
  star: '<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>',
  flag: '<path d="M3.5 14.5V2M3.5 2.5h8.5l-2 3 2 3H3.5"/>',
  mic: '<rect x="5.8" y="1.6" width="4.4" height="7.6" rx="2.2"/><path d="M3.4 7.6a4.6 4.6 0 0 0 9.2 0M8 12.2v2.2"/>',
  pin: '<path d="M8 14.5s4.6-4.4 4.6-8A4.6 4.6 0 0 0 3.4 6.5c0 3.6 4.6 8 4.6 8z"/><circle cx="8" cy="6.4" r="1.6"/>',
  dot: '<circle cx="8" cy="8" r="4.2"/>',
};
const icon = name => `<svg class="ci" viewBox="0 0 16 16" aria-hidden="true">${SVG[name] ?? SVG.dot}</svg>`;
// one colour per kind and group; custom kinds pick from these six
export const PALETTE = ['#be185d', '#0369a1', '#4d7c0f', '#9a3412', '#0e7490', '#57534e'];
const BUILT = {
  work: { colour: '#334155', icon: 'work' }, education: { colour: '#0f766e', icon: 'education' }, project: { colour: '#b45309', icon: 'project' },
  skills: { colour: '#4338ca', icon: 'skills' }, languages: { colour: '#0891b2', icon: 'languages' }, certificates: { colour: '#15803d', icon: 'certificates' },
  publications: { colour: '#7c3aed', icon: 'publications' }, awards: { colour: '#a16207', icon: 'awards' }, interests: { colour: '#78716c', icon: 'interests' },
  references: { colour: '#9f1239', icon: 'references' },
  about: { colour: '#475569', icon: 'about' },
};
function look(kind){
  if (BUILT[kind]) return BUILT[kind];
  const k = K.kindOf(rec(), kind);
  if (k?.store === 'awards') return { colour: BUILT.awards.colour, icon: k.icon || 'star' };
  return k ? { colour: PALETTE[k.colour % 6], icon: k.icon } : { colour: '#475569', icon: 'dot' };
}
const kc = kind => `style="--k:${look(kind).colour}"`;
const kindLabel = kind => (BUILT[kind] || ['work', 'education', 'project'].includes(kind) ? t(`career.kind.${kind}`) : K.kindName(rec(), kind, L()));
const groupLabel = g => (BUILT[g] && !['work', 'education', 'project'].includes(g) ? t(`career.group.${g}`) : K.kindName(rec(), g, L()));
const isList = kind => K.placeOf(rec(), kind) === 'list' && !['skills', 'languages', 'certificates', 'publications', 'interests', 'references'].includes(kind);

const ym = d => String(d ?? '').slice(0, 7);
const year = d => String(d ?? '').slice(0, 4);
const years = x => { const a = year(x.start), b = x.end ? year(x.end) : t('career.now'); return !x.end || a !== b ? `${a}–${b}` : a; };
function fmt(d){
  if (!d) return tIn(L(), 'doc.present');
  const m = String(d).match(/^(\d{4})(?:-(\d{2}))?/);
  if (!m) return String(d);
  if (!m[2]) return m[1];
  try { return new Intl.DateTimeFormat(L(), { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(+m[1], +m[2] - 1, 15))); } catch { return d; }
}
const sameLang = () => L() === DEFAULT_LANG;
const field = (id, label, value, { right = '', miss = false, ph = '', type = 'text', attrs = '' } = {}) =>
  `<label class="field"><span class="lbl inline"><span class="lt">${label}</span>${right ? `<span class="lr">${right}</span>` : ''}</span><input id="${id}" type="${type}" class="${miss ? 'miss' : ''}" value="${esc(value ?? '')}" placeholder="${esc(ph)}" autocomplete="off" ${attrs}></label>`;
// a few lines of text (JSON Resume descriptions and summaries)
const area = (id, label, value, { right = '', ph = '', rows = 2 } = {}) =>
  `<label class="field"><span class="lbl inline"><span class="lt">${label}</span>${right ? `<span class="lr">${right}</span>` : ''}</span><textarea id="${id}" rows="${rows}" placeholder="${esc(ph)}">${esc(value ?? '')}</textarea></label>`;
// a field's value when the form has the field, so a form without it leaves it alone
const opt = (key, id) => ($(`#${id}`) ? { [key]: val(id) } : {});
// fields JSON Resume has that this app's resume design doesn't print
const jsonOnly = inner => `<details class="jr"><summary>${h('career.moreFields')}</summary>${inner}<p class="note">${h('career.notPrinted')}</p></details>`;
const trLabel = () => (sameLang() ? '' : esc(langName(L())));
const shared = () => h('career.shared');
const goesIn = sid => {
  const s = (rec().sections ?? []).find(x => x.id === sid);
  const title = s ? (L() !== DEFAULT_LANG ? rec().i18n?.[L()]?.sections?.[sid] : null) ?? s.title ?? sid : sid;
  return `<p class="goesin">${h('career.goesIn', { section: title })}</p>`;
};
function commit(fn, label, done){
  try { const ok = C.store.commit(d => { fn(d); }, label); if (ok && done) C.toast(done); return ok; }
  catch (e){ C.toast(errText(e), 'bad'); return false; }
}
const recipes = d => [d.cur, ...(d.resumes ?? [])];
const textIn = (id, lang = L()) => { const v = id ? defaultVariant(rec(), id, lang) : null; return v && (v.lang ?? DEFAULT_LANG) === lang ? v.text : ''; };
const textEn = id => (id ? defaultVariant(rec(), id, DEFAULT_LANG)?.text ?? '' : '');

export function timelineHtml(){
  const m = rec();
  const ready = K.stepsReady(m);
  return `<div class="cwrap">
    <div class="tl-head"><div class="tl-titles"><h2>${h('career.title')}</h2><p class="muted small">${h('career.sub')}</p></div><span class="grow"></span>
      <span class="lang-menu addw"><button class="primary addb" id="c-add" data-act="c-pop" data-pop="add" aria-haspopup="menu" aria-expanded="${W.pop === 'add'}">${h('career.add')}</button>${W.pop === 'add' ? addMenu() : ''}</span></div>
    ${stepsHtml(ready)}${tipHtml()}
    ${W.area === 'about' ? aboutHtml() : W.area === 'more' ? listsHtml() : timelineCols()}
  </div>`;
}

function stepsHtml(ready){
  const steps = [['about', '1', 'career.step1', 'career.step1sub', ready.about], ['timeline', '2', 'career.step2', 'career.step2sub', ready.timeline], ['more', '3', 'career.step3', 'career.step3sub', ready.more]];
  const m = rec();
  const firstJob = (m.work ?? [])[0];
  const next = !ready.about ? t('career.nextAbout')
    : !ready.timeline ? (firstJob ? t('career.nextJob', { org: firstJob.name, n: firstJob.highlights.length }) : t('career.nextTimeline'))
    : t('career.nextReady');
  return `<nav class="steps" aria-label="${esc(t('career.stepsLabel'))}">${steps.map(([id, n, k, sub, ok]) => `<button class="step ${W.area === id ? 'here' : ''} ${ok ? 'ok' : ''}" data-act="c-area" data-area="${id}" aria-current="${W.area === id ? 'step' : 'false'}">
      <span class="sn">${ok ? '✓' : n}</span><span class="sl"><b>${h(k)}</b><small>${h(sub)}</small></span></button><span class="sa" aria-hidden="true">›</span>`).join('')}
    <button class="step out ${ready.record ? 'next' : ''}" data-act="ws" data-ws="resume" title="${esc(t('career.step4title'))}"><span class="sn">4</span><span class="sl"><b>${h('career.step4')}</b><small>${h('career.step4sub')}</small></span></button></nav>
    <p class="nextline">${esc(next)}</p>`;
}

function tipHtml(){
  if (W.tip == null) return '';
  const [hk, tk] = TIPS[W.tip];
  return `<div class="tipbox" role="note"><b>${h(hk)}</b> <span class="muted">${h('career.tipOf', { i: W.tip + 1, n: TIPS.length })}</span><br>${h(tk)}
    <div class="btns"><button class="sm primary" data-act="c-tip-next">${W.tip < TIPS.length - 1 ? h('onb.next') : h('onb.gotIt')}</button><button class="sm ghost" data-act="c-tip-skip">${h('onb.skipTips')}</button></div></div>`;
}

function addMenu(){
  const m = rec();
  const row = (act, kind, title, sub, extra = '') => `<div class="addrowk"><button role="menuitem" data-act="${act}" data-what="${esc(kind)}"><span class="ai" ${kc(kind)}>${icon(look(kind).icon)}</span><span><b>${esc(title)}</b><small>${esc(sub)}</small></span></button>${extra}</div>`;
  const cog = k => `<button class="kset" data-act="c-kind-edit" data-id="${esc(k.id)}" title="${esc(t('career.kindSettings', { name: K.kindName(m, k.id, L()) }))}" aria-label="${esc(t('career.kindSettings', { name: K.kindName(m, k.id, L()) }))}">⚙</button>`;
  let items = '';
  if (W.area === 'about'){
    items = row('c-add', 'summary', t('career.addSummary'), t('career.addSummarySub'));
  } else if (W.area === 'more'){
    items = ['skills', 'languages', 'certificates', 'publications'].map(g => row('c-add', g, t(`career.addItem.${g}`), t(`career.addItemSub.${g}`))).join('')
      + K.kindsOf(m).filter(k => k.place === 'list').map(k => row('c-add', k.id, K.kindName(m, k.id, L()), t('career.oneDate'), cog(k))).join('')
      + row('c-add', 'interests', t('career.addItem.interests'), t('career.addItemSub.interests'))
      + row('c-add', 'references', t('career.addItem.references'), t('career.addItemSub.references'));
  } else {
    items = ['work', 'education', 'project'].map(k => row('c-add', k, t(`career.kind.${k}`), t(`career.kindSub.${k}`))).join('')
      + K.kindsOf(m).filter(k => k.place === 'timeline').map(k => row('c-add', k.id, K.kindName(m, k.id, L()), t('career.period'), cog(k))).join('');
  }
  const canKind = W.area !== 'about' && K.kindsOf(m).length < K.MAX_KINDS;
  return `<div class="pop card addm" role="menu" aria-label="${esc(t('career.add'))}">${items}
    ${canKind ? `<hr><button role="menuitem" data-act="c-kind-new"><span class="ai">+</span><span><b>${h('career.somethingElse')}</b><small>${h(W.area === 'more' ? 'career.somethingElseList' : 'career.somethingElseTl')}</small></span></button>` : ''}</div>`;
}

function timelineCols(){
  const all = K.timelineLayout(rec(), { lang: L() });
  const nArch = all.entries.filter(x => x.archived).length;
  const { bands, entries } = nArch && !W.jobs ? K.timelineLayout(rec(), { lang: L(), hideArchived: true }) : all;
  const archBtn = nArch ? `<button class="sm ghost archmore" data-act="c-arch-jobs" aria-expanded="${W.jobs}">${W.jobs ? h('arch.hideJobs') : h('arch.nJobs', { n: nArch })}</button>` : '';
  if (!entries.length) return `<div class="empty card-ish">
      <p><b>${h('career.emptyWork')}</b></p><div class="btns"><button class="primary sm" data-act="c-add" data-what="work">${h('career.addWork')}</button></div>
      <p class="muted small">${h('career.emptyEdu')}</p><div class="btns"><button class="sm" data-act="c-add" data-what="education">${h('career.addEducation')}</button></div></div>`;
  const sel = W.sel?.what === 'entry' ? W.sel.id : null;
  const mark = x => (!sameLang() && x.toWrite ? x.toWrite : 0);
  const main = x => `<button class="row" ${kc(x.kind)} data-act="c-sel" data-what="entry" data-key="${x.key}" data-id="${esc(x.id)}" aria-pressed="${sel === x.id}">
      <span class="ic">${icon(look(x.kind).icon)}</span><span class="t ${x.titleMissing ? 'missing' : ''}">${esc(x.title)}</span><span class="w">${esc(years(x))}</span>
      <span class="o"><span class="kw">${esc(kindLabel(x.kind))}</span>${x.org ? ` · ${esc(x.org)}` : ''}${x.archived ? ` · <span class="pill arch">${h('arch.badge')}</span>` : ''}</span>
      ${mark(x) ? `<span class="marks"><span class="mk">${h('career.toWriteIn', { n: mark(x), lang: langName(L()) })}</span></span>` : ''}</button>`;
  const side = x => `<button class="srow" ${kc(x.kind)} data-act="c-sel" data-what="entry" data-key="${x.key}" data-id="${esc(x.id)}" aria-pressed="${sel === x.id}" title="${esc(kindLabel(x.kind))}">
      <span class="si">${icon(look(x.kind).icon)}</span><span class="t ${x.titleMissing ? 'missing' : ''}">${esc(x.title)}</span><span class="w">${esc(years(x))}</span>
      <span class="o"><span class="kw">${esc(kindLabel(x.kind))}</span>${x.org ? ` · ${esc(x.org)}` : ''}${x.during ? ` · ${h('career.during', { org: duringName(x.during) })}` : ''}${mark(x) ? ` · <span class="mkt">${h('career.toWrite', { n: mark(x) })}</span>` : ''}</span></button>`;
  let rows = `<div class="colhead"><span ${kc('work')}>${icon('work')} ${h('career.colMain')}</span><span>${h('career.colSide')}</span></div>`;
  for (const b of bands) rows += `<div class="yr">${esc(b.year ?? t('career.nowBand'))}</div><div class="yrow"><div class="main">${b.main.map(main).join('')}</div><div class="side">${b.side.map(side).join('')}</div></div>`;
  return `<div class="tl2">${rows}</div>${archBtn}`;
}
const duringName = id => { const m = rec(); return m.work?.find(w => w.id === id)?.name ?? m.education?.find(e => e.id === id)?.institution ?? id; };

function aboutItems(){
  const m = rec(), b = m.basics ?? {}, d = b.display ?? {};
  const headline = textIn(d.label) || textEn(d.label);
  const contact = [b.location?.city, b.email, b.phone].filter(Boolean).join(' · ');
  const summary = textIn(b.summary) || textEn(b.summary);
  const nv = id => (id ? versionsIn(m, id, L()).length : 0);
  return [
    { id: 'name', title: t('career.about.name'), value: [sameLang() ? b.name : (textIn(d.name) || b.name), headline.replace(/\n/g, ' ')].filter(Boolean).join(' · '), miss: !sameLang() && ((d.label && !textIn(d.label)) || (d.name && !textIn(d.name) && !isSame(m, sameKey(d.name)))), n: nv(d.label) },
    { id: 'contact', title: t('career.about.contact'), value: contact || t('career.about.noContact'), miss: !sameLang() && d.contact && !textIn(d.contact) && !isSame(m, sameKey(d.contact)), n: nv(d.contact) },
    { id: 'photo', title: t('career.about.photo'), value: b.image ? t('career.about.hasPhoto') : t('career.about.noPhoto'), n: 0 },
    { id: 'summary', title: t('career.about.summary'), value: summary || t('career.about.noSummary'), miss: !sameLang() && b.summary && !textIn(b.summary), n: nv(b.summary) },
  ];
}
function aboutHtml(){
  const sel = W.sel?.what === 'about' ? W.sel.id : null;
  return `<p class="intro">${h('career.aboutIntro')}</p><div class="cards">${aboutItems().map(a => `<button class="crd" ${kc('about')} data-act="c-sel" data-what="about" data-id="${a.id}" aria-pressed="${sel === a.id}">
    <b>${esc(a.title)}</b><span class="w">${a.n > 1 ? h('career.nVersions', { n: a.n }) : ''}</span><span class="o ${a.miss ? 'missing' : ''}">${esc(a.value)}</span></button>`).join('')}</div>`;
}

function listsHtml(){
  const groups = K.recordLists(rec(), { lang: L() });
  const sel = W.sel?.what === 'item' ? W.sel.id : null;
  const crd = (g, x) => `<button class="crd" data-act="c-sel" data-what="item" data-group="${esc(g)}" data-id="${esc(x.id)}" aria-pressed="${sel === x.id}">
      <b class="${x.titleMissing ? 'missing' : ''}">${esc(x.title)}</b><span class="w">${esc(x.right ?? '')}</span>${x.sub ? `<span class="o">${esc(x.sub)}</span>` : ''}</button>`;
  return `<p class="intro">${h('career.moreIntro')}</p>${groups.map(g => {
    const sid = K.sectionFor(rec(), g.group, g.items[0]?.id ?? null);
    const s = (rec().sections ?? []).find(x => x.id === sid);
    return `<section class="grp" ${kc(g.group)} aria-label="${esc(groupLabel(g.group))}"><div class="grp-h"><span class="gi">${icon(look(g.group).icon)}</span><b>${esc(groupLabel(g.group))}</b>${s ? `<span class="muted tiny">${h('career.goesInShort', { section: s.title })}</span>` : ''}
      ${g.kind ? `<button class="kset sm ghost" data-act="c-kind-edit" data-id="${esc(g.kind)}" aria-label="${esc(t('career.kindSettings', { name: groupLabel(g.group) }))}" title="${esc(t('career.kindSettings', { name: groupLabel(g.group) }))}">⚙</button>` : ''}</div>
      <div class="cards">${g.items.map(x => crd(g.group, x)).join('') || `<p class="muted small empty-line">${h(`career.emptyGroup.${['skills', 'languages', 'certificates', 'publications', 'interests', 'references'].includes(g.group) ? g.group : 'kind'}`)}</p>`}</div></section>`;
  }).join('')}`;
}

function careerView(){
  if (W.kind) return kindView();
  if (W.adding) return addView();
  const s = W.sel;
  if (!s) return `<p class="muted">${h('career.pick')}</p>`;
  if (s.what === 'claim') return claimView(s.claim, { entry: s.id, key: s.key });
  if (s.what === 'entry') return entryView(s.key, s.id);
  if (s.what === 'about') return aboutView(s.id);
  if (s.what === 'item') return itemView(s.group, s.id);
  return `<p class="muted">${h('career.pick')}</p>`;
}

function entryOf(key, id){
  const m = rec();
  if (key === 'education') return (m.education ?? []).find((e, i) => (e.id ?? `edu-${i}`) === id);
  return (m[key] ?? []).find(x => x?.id === id);
}
function entryView(key, id){
  const m = rec();
  const x = entryOf(key, id);
  if (!x) { W.sel = null; return `<p class="muted">${h('career.pick')}</p>`; }
  const v = K.entryView(m, key, { ...x, id }, L());
  const same = K.timelineLayout(m, { lang: L() }).entries.filter(e => e.kind === v.kind);
  const i = same.findIndex(e => e.id === id);
  const place = v.place;
  const dates = K.placeOf(m, v.kind) === 'list' ? fmt(v.start) : `${fmt(v.start)} – ${fmt(v.end)}`;
  let out = `<div class="where" ${kc(v.kind)}><span class="kb">${icon(look(v.kind).icon)}${esc(kindLabel(v.kind))} · ${h('career.iOfN', { i: i + 1, n: same.length })} · ${esc(years(v))}</span>
      <span><button class="ghost sm" data-act="c-step" data-d="-1" ${i <= 0 ? 'disabled' : ''} aria-label="${esc(t('career.newer'))}" title="${esc(t('career.newer'))}">↑</button><button class="ghost sm" data-act="c-step" data-d="1" ${i >= same.length - 1 ? 'disabled' : ''} aria-label="${esc(t('career.older'))}" title="${esc(t('career.older'))}">↓</button></span></div>
    <h2 class="title ${v.titleMissing ? 'missing' : ''}">${esc(v.title)}</h2>
    <p class="sumline">${[v.org, dates, place].filter(Boolean).map(esc).join(' · ')}${v.during ? ` · ${h('career.during', { org: duringName(v.during) })}` : ''}</p>`;
  out += W.details ? `<div class="detbox">${detailsForm(key, x, v)}<div class="btns"><button class="primary sm" data-act="c-save" data-key="${key}" data-id="${esc(id)}">${h('head.save')}</button><button class="sm ghost" data-act="c-details" data-open="0">${h('btn.cancel')}</button>
      ${key !== 'work' && key !== 'education' ? `<span class="grow"></span><button class="sm ghost" data-act="c-del-entry" data-id="${esc(id)}" title="${esc(t('career.ctrlZ'))}">🗑 ${h('career.deleteEntry')}</button>` : ''}</div></div>`
    : `<button class="sm" data-act="c-details" data-open="1">${h('career.editDetails')}</button>`
      + (key === 'education' ? '' : ` <button class="sm ghost" data-act="${x.archived ? 'c-unarch-entry' : 'c-arch-entry'}" data-id="${esc(id)}" title="${esc(t(x.archived ? 'arch.unarchiveJobTitle' : 'arch.archiveJobTitle'))}">${h(x.archived ? 'arch.unarchiveJob' : 'arch.archiveJob')}</button>`);
  const withClaims = key === 'work' || key === 'projects' || key === 'volunteer';
  if (withClaims){
    const arch = K.archivedOf(m, id), open = W.shown.has(id);
    out += `<span class="lbl">${h('career.whatYouDid')}</span><div class="list">${(x.highlights ?? []).filter(c => open || !arch.includes(c)).map(c => claimRow(c, key, id)).join('')}</div>
      ${arch.length ? `<button class="sm ghost archmore" data-act="c-arch-show" data-id="${esc(id)}" aria-expanded="${open}">${open ? h('arch.hide') : h('arch.nArchived', { n: arch.length })}</button>` : ''}
      ${addClaimHtml({ id, key, draft: C.edit.claimDraft })}
      <p class="note">${h('career.claimsNote')}</p>`;
  }
  if (key === 'education') out += `<p class="note">${h('career.eduNote')}</p>`;
  return out + goesIn(K.sectionFor(m, key === 'work' ? 'work' : key === 'education' ? 'education' : v.kind, id));
}

function detailsForm(key, x, v){
  const m = rec(), Lg = L(), tr = trLabel();
  const f = K.fieldPath;
  const enOr = (path, en) => (Lg === DEFAULT_LANG ? en : K.fieldIn(m, Lg, path) || (v.titleMissing ? '' : v.title));
  if (key === 'work') return `${field('c-pos', h('career.f.title'), Lg === DEFAULT_LANG ? x.position : (K.fieldIn(m, Lg, f('work', x.id, 'position')) || textIn(x.display?.position)), { right: tr, miss: !sameLang() && v.titleMissing, ph: x.position })}
      ${field('c-org', h('career.f.employer'), x.name, { right: shared() })}
      <div class="grid2">${field('c-start', h('career.f.started'), ym(x.startDate), { type: 'month' })}${field('c-end', h('career.f.ended'), ym(x.endDate), { type: 'month', attrs: x.endDate ? '' : 'disabled' })}</div>
      <label class="check"><input type="checkbox" id="c-current" ${x.endDate ? '' : 'checked'}> ${h('career.f.current')}</label>
      ${field('c-loc', h('career.f.where'), Lg === DEFAULT_LANG ? x.location : K.fieldIn(m, Lg, f('work', x.id, 'location')), { right: tr, ph: x.location ?? '' })}
      ${jsonOnly(`${field('c-wurl', h('career.f.website'), x.url ?? '', { right: shared(), ph: 'https://…' })}
      ${area('c-wdesc', h('career.f.companyAbout'), x.description ?? '', { right: shared() })}
      ${area('c-wsum', h('career.f.roleSummary'), x.summary ?? '', { right: shared(), rows: 3 })}`)}`;
  if (key === 'education') return `${field('c-pos', h('career.f.degree'), Lg === DEFAULT_LANG ? [x.studyType, x.area].filter(y => y && y !== '—').join(' ') : (K.fieldIn(m, Lg, f('education', v.id, 'studyType')) || textIn(x.display?.studyType)), { right: tr, miss: !sameLang() && v.titleMissing, ph: [x.studyType, x.area].filter(Boolean).join(' ') })}
      ${field('c-org', h('career.f.institution'), x.institution, { right: shared() })}
      <div class="grid2">${field('c-start', h('career.f.started'), ym(x.startDate), { type: 'month' })}${field('c-end', h('career.f.finished'), ym(x.endDate), { type: 'month' })}</div>
      ${field('c-hon', h('career.f.honours'), x.score ?? '')}
      ${jsonOnly(`${field('c-courses', h('career.f.courses'), (x.courses ?? []).join(', '), { right: shared(), ph: t('career.f.coursesPh') })}
      ${field('c-eurl', h('career.f.website'), x.url ?? '', { right: shared(), ph: 'https://…' })}`)}`;
  const k = K.kindOf(m, v.kind);
  const nameKey = key === 'volunteer' ? 'position' : key === 'awards' ? 'title' : 'name';
  const orgLabel = key === 'projects' && !k ? h('career.f.with') : esc(k?.org ?? t('career.f.org'));
  const during = key === 'projects' && !k ? `<label class="field"><span class="lbl inline"><span class="lt">${h('career.f.during')}</span></span><select id="c-during"><option value="">${h('career.f.independent')}</option>
      ${[...(m.work ?? []).map(w => [w.id, `${t('career.kind.work')}: ${w.name}`]), ...(m.education ?? []).map((e, i) => [e.id ?? `edu-${i}`, `${t('career.kind.education')}: ${e.institution}`])].map(([id, l]) => `<option value="${esc(id)}" ${x.during === id ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : '';
  const oneDate = K.placeOf(m, v.kind) === 'list';
  return `${field('c-pos', key === 'projects' && !k ? h('career.f.project') : h('career.f.title'), Lg === DEFAULT_LANG ? x[nameKey] : K.fieldIn(m, Lg, f(key, x.id, nameKey)), { right: tr, miss: !sameLang() && v.titleMissing, ph: x[nameKey] ?? '' })}
    ${field('c-org', orgLabel, x[key === 'volunteer' ? 'organization' : key === 'awards' ? 'awarder' : 'entity'] ?? '', { right: shared(), ph: key === 'projects' && !k ? t('career.f.withPh') : '' })}
    ${during}
    ${oneDate ? field('c-start', h('career.f.date'), ym(x.startDate ?? x.date), { type: 'month' })
      : `<div class="grid2">${field('c-start', h('career.f.started'), ym(x.startDate), { type: 'month' })}${field('c-end', h('career.f.ended'), ym(x.endDate), { type: 'month' })}</div>`}
    ${oneDate ? '' : field('c-loc', h('career.f.where'), Lg === DEFAULT_LANG ? x.location : K.fieldIn(m, Lg, f(key, x.id, 'location')), { right: tr, ph: x.location ?? '' })}
    ${key === 'projects' ? field('c-url', h('career.f.link'), x.url ?? '', { ph: 'https://…' }) : ''}
    ${jsonOnly(area('c-desc', h('career.f.description'), x[key === 'projects' ? 'description' : 'summary'] ?? '', { right: shared() }))}`;
}

function claimRow(id, key, entry){
  const m = rec(), Lg = L();
  const vs = versionsIn(m, id, Lg);
  const same = isSame(m, sameKey(id));
  const miss = !vs.length && !sameLang() && !same;
  const text = vs.length ? (defaultVariant(m, id, Lg)?.text ?? vs[0].text) : textEn(id);
  const pill = miss ? t('career.notInYet', { lang: langName(Lg) }) : vs.length > 1 ? t('career.nVersions', { n: vs.length }) : '';
  const archived = !!(m.facts ?? []).find(f => f.id === id)?.archived;
  return partClaimRow({ id, act: 'c-claim', text: clip(text, 110), pill, pillMiss: miss, attrs: `data-key="${esc(key)}" data-entry="${esc(entry)}"`, archived, unarchive: archived });
}

// The versions of one text, all equal. The panel is edit.js's; this adds the way back.
function claimView(fid, { entry = null, key = null, title = null, crumbs = null, deletable = true } = {}){
  const m = rec(), Lg = L();
  const f = (m.facts ?? []).find(x => x.id === fid);
  if (!f){ W.sel = entry ? { what: 'entry', key, id: entry } : null; return careerView(); }
  const parent = entry ? entryOf(key, entry) : null;
  const crumbHtml = crumbs ?? crumb([{ t: parent ? K.entryView(m, key, parent, Lg).title : t('career.title'), act: 'c-up' }, { t: (f.summary ?? fid).slice(0, 40) }], { close: 'c-up' });
  return C.edit.claimPanel(fid, { crumbHtml, title: title ?? f.summary ?? fid, deletable: deletable && !!parent });
}

function aboutView(id){
  const m = rec(), b = m.basics ?? {}, d = b.display ?? {}, Lg = L(), tr = trLabel();
  const where = `<div class="where" ${kc('about')}><span class="kb">${icon('about')}${h('career.step1')}</span></div>`;
  if (id === 'name') return `${where}<h2 class="title">${h('career.about.name')}</h2>
    ${field('c-name', h('career.f.name'), sameLang() ? b.name : (textIn(d.name) || b.name), { right: tr, ph: sameLang() ? '' : b.name })}
    <label class="field"><span class="lbl inline"><span class="lt">${h('career.f.headline')}</span>${tr ? `<span class="lr">${tr}</span>` : ''}</span><textarea id="c-label" rows="2" class="${!sameLang() && d.label && !textIn(d.label) ? 'miss' : ''}" placeholder="${esc(textEn(d.label))}">${esc(sameLang() ? b.label ?? textEn(d.label) : textIn(d.label))}</textarea></label>
    <div class="btns"><button class="primary sm" data-act="c-save-about" data-part="name">${h('head.save')}</button><span class="grow"></span>${d.label ? `<a class="newv inline" data-act="c-sel-fact" data-fact="${esc(d.label)}" data-title="${esc(t('career.f.headline'))}">${h('career.headlineVersions')}</a>` : ''}</div>
    ${goesIn('header')}`;
  if (id === 'contact') return `${where}<h2 class="title">${h('career.about.contact')}</h2>
    ${field('c-email', h('onb.email'), b.email, { type: 'email' })}${field('c-phone', h('onb.phone'), b.phone, { type: 'tel' })}
    ${field('c-city', h('onb.city'), b.location?.city)}${field('c-url', h('onb.website'), String(b.url ?? '').replace(/^https?:\/\//, ''))}
    ${jsonOnly(`${field('c-addr', h('career.f.address'), b.location?.address ?? '')}<div class="grid2">${field('c-postal', h('career.f.postalCode'), b.location?.postalCode ?? '')}${field('c-region', h('career.f.region'), b.location?.region ?? '')}</div>`)}
    ${field('c-rights', h('career.f.rights'), b.rights ?? '', { ph: t('career.f.rightsPh') })}
    <div class="btns"><button class="primary sm" data-act="c-save-about" data-part="contact">${h('head.save')}</button><span class="grow"></span>${d.contact ? `<a class="newv inline" data-act="c-sel-fact" data-fact="${esc(d.contact)}" data-title="${esc(t('career.about.contact'))}">${h('career.contactVersions')}</a>` : ''}</div>
    <p class="note">${h('career.contactNote')}</p>${goesIn('header')}`;
  if (id === 'photo') return `${where}<h2 class="title">${h('career.about.photo')}</h2>
    <div class="photo-row">${b.image ? `<img class="thumb" src="${esc(C.photoUrl())}" alt="">` : `<span class="thumb empty">${h('design.none')}</span>`}
      <div class="btns"><button class="sm" data-act="d-photo">${b.image ? h('design.replacePhoto') : h('design.addPhoto')}</button>${b.image ? `<button class="sm ghost" data-act="d-photo-rm">${h('design.remove')}</button>` : ''}</div></div>
    <p class="note">${h('design.photoNote')} ${h('design.photoCrop')}</p>${goesIn('header')}`;
  if (id === 'summary'){
    if (!b.summary) return `${where}<h2 class="title">${h('career.about.summary')}</h2>
      <label class="field"><span class="lbl inline">${h('career.about.summary')}</span><textarea id="c-summary" rows="4" placeholder="${esc(t('career.summaryPh'))}"></textarea></label>
      <div class="btns"><button class="primary sm" data-act="c-add-summary">${h('head.save')}</button></div>${goesIn('summary')}`;
    return claimView(b.summary, { title: t('career.about.summary'), deletable: false,
      crumbs: crumb([{ t: t('career.step1'), act: 'c-up' }, { t: t('career.about.summary') }], { close: 'c-up' }) }) + goesIn('summary');
  }
  return '';
}

function itemView(group, id){
  const m = rec(), Lg = L(), tr = trLabel();
  const k = K.kindOf(m, group);
  if (k) return entryView(k.store === 'awards' ? 'awards' : 'projects', id);
  const head = (what, n = null) => `<div class="where" ${kc(group)}><span class="kb">${icon(look(group).icon)}${esc(t(`career.item.${group}`))}${n ? ` · ${esc(n)}` : ''}</span></div>`;
  const save = `<div class="btns"><button class="primary sm" data-act="c-save-item" data-group="${group}" data-id="${esc(id)}">${h('head.save')}</button><span class="grow"></span><button class="sm ghost" data-act="c-del-item" data-group="${group}" data-id="${esc(id)}" title="${esc(t('career.ctrlZ'))}">🗑 ${h('career.delete')}</button></div>`;
  const sid = K.sectionFor(m, group, id);
  if (group === 'skills'){
    const s = (m.skills ?? []).find(x => x.id === id); if (!s) return '';
    const name = sameLang() ? s.name : m.i18n?.[Lg]?.labels?.[id] ?? '';
    const i = (m.skills ?? []).indexOf(s);
    return `${head(group, t('career.iOfN', { i: i + 1, n: m.skills.length }))}<h2 class="title ${name ? '' : 'missing'}">${esc(name || s.name)}</h2>
      ${field('c-gname', h('career.f.group'), name, { right: tr, miss: !name, ph: s.name })}
      <span class="lbl inline">${h('career.f.skills')}</span><div class="tags" id="c-kw">${(s.keywords ?? []).map((w, n) => `<span class="tag">${esc(w)}<button class="rm" data-act="c-kw-rm" data-n="${n}" aria-label="${esc(t('edit.removeTag', { tag: w }))}">×</button></span>`).join('')}<input id="c-kw-in" placeholder="${esc(t('career.f.skillPh'))}" aria-label="${esc(t('career.f.skillPh'))}"></div>
      <p class="note">${h('career.printsAs', { text: textIn(id) || textEn(id) })}</p>
      ${jsonOnly(field('c-slevel', h('career.f.skillLevel'), s.level ?? '', { right: shared(), ph: t('career.f.skillLevelPh') }))}${save}${goesIn(sid)}`;
  }
  if (group === 'languages'){
    const l = (m.languages ?? []).find(x => x.id === id); if (!l) return '';
    const name = sameLang() ? l.language : m.i18n?.[Lg]?.terms?.[id] ?? '';
    return `${head(group)}<h2 class="title ${name ? '' : 'missing'}">${esc(name || l.language)}</h2>
      ${field('c-lname', h('career.f.language'), name, { right: tr, miss: !name, ph: l.language })}
      <label class="field"><span class="lbl inline"><span class="lt">${h('career.f.level')}</span></span><select id="c-level">${[...new Set([...K.LEVELS, l.fluency].filter(Boolean))].map(v => `<option ${v === l.fluency ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <p class="note">${h('career.spokenNote')}</p>${save}${goesIn(sid)}`;
  }
  if (group === 'certificates'){
    const c = (m.certificates ?? []).find(x => x.id === id); if (!c) return '';
    return `${head(group)}<h2 class="title">${esc(c.name)}</h2>
      ${field('c-cname', h('career.f.name'), c.name)}${field('c-issuer', h('career.f.issuer'), c.issuer ?? '')}
      <div class="grid2">${field('c-date', h('career.f.date'), ym(c.date), { type: 'month' })}${field('c-expires', h('career.f.expires'), ym(c.expires), { type: 'month' })}</div>
      ${field('c-url', h('career.f.link'), c.url ?? '', { ph: 'https://…' })}${save}${goesIn(sid)}`;
  }
  if (group === 'publications'){
    const p = (m.publications ?? []).find(x => x.id === id); if (!p) return '';
    const name = sameLang() ? p.name : K.fieldIn(m, Lg, K.fieldPath('publications', id, 'name')) || textIn(p.display?.name);
    return `${head(group)}<h2 class="title ${name ? '' : 'missing'}">${esc(name || p.name)}</h2>
      ${field('c-pname', h('career.f.title'), name, { right: tr, miss: !name, ph: p.name })}${field('c-publisher', h('career.f.publisher'), p.publisher ?? '', { right: shared() })}
      ${field('c-date', h('career.f.date'), ym(p.releaseDate), { type: 'month' })}
      ${jsonOnly(`${field('c-url', h('career.f.link'), p.url ?? '', { right: shared(), ph: 'https://…' })}${area('c-psum', h('career.f.description'), p.summary ?? '', { right: shared() })}`)}${save}${goesIn(sid)}`;
  }
  if (group === 'interests'){
    const i = (m.interests ?? []).find(x => x.id === id); if (!i) return '';
    const name = sameLang() ? i.name : textIn(id);
    return `${head(group)}<h2 class="title ${name ? '' : 'missing'}">${esc(name || i.name)}</h2>${field('c-iname', h('career.f.interest'), name, { right: tr, miss: !name, ph: i.name })}${save}${goesIn(sid)}`;
  }
  if (group === 'references'){
    const r = (m.references ?? []).find(x => x.id === id); if (!r) return '';
    const text = textIn(id);
    return `${head(group)}<h2 class="title">${esc(r.name)}</h2>
      ${field('c-rname', h('career.f.refName'), r.name, { right: shared() })}
      ${area('c-rtext', h('career.f.refText'), text, { right: tr, ph: sameLang() ? t('career.f.refPh') : textEn(id), rows: 3 })}
      <p class="note">${h('career.refNote')}</p>${save}${goesIn(sid)}`;
  }
  return '';
}

function addView(){
  const { what } = W.adding;
  const m = rec();
  const k = K.kindOf(m, what);
  const tr = trLabel();
  const cancel = `<button class="ghost sm" data-act="c-add-cancel">${h('btn.cancel')}</button>`;
  const head = title => `<div class="where" ${kc(k ? k.id : what)}><span class="kb">${icon(look(k ? k.id : what).icon)}${esc(title)}</span></div><h2 class="title">${esc(title)}</h2>`;
  const claims = `<label class="field"><span class="lbl inline"><span class="lt">${h('onb.claims')}</span></span><textarea id="c-claims" rows="4" placeholder="${esc(t('onb.claimsPh'))}"></textarea></label><p class="note">${h('onb.claimsNote')}</p>`;
  const go = label => `<div class="btns"><button class="primary sm" data-act="c-create" data-what="${esc(what)}">${esc(label)}</button>${cancel}</div>`;
  if (what === 'work') return `${head(t('career.newWork'))}
    ${field('c-pos', h('career.f.title'), '', { right: tr })}${field('c-org', h('career.f.employer'), '')}
    <div class="grid2">${field('c-start', h('career.f.started'), '', { type: 'month' })}${field('c-end', h('career.f.ended'), '', { type: 'month' })}</div>
    <label class="check"><input type="checkbox" id="c-current"> ${h('career.f.current')}</label>${field('c-loc', h('career.f.where'), '', { right: tr })}${claims}${go(t('career.addTheJob'))}`;
  if (what === 'education') return `${head(t('career.newEducation'))}
    ${field('c-org', h('career.f.institution'), '')}<div class="grid2">${field('c-type', h('onb.degree'), '', { ph: t('onb.degreePh') })}${field('c-area', h('onb.subject'), '')}</div>
    <div class="grid2">${field('c-start', h('career.f.started'), '', { type: 'month' })}${field('c-end', h('career.f.finished'), '', { type: 'month' })}</div>${field('c-hon', h('career.f.honours'), '')}${go(t('career.addIt'))}`;
  if (what === 'project' || (k && k.place === 'timeline')) return `${head(k ? t('career.newKindEntry', { kind: K.kindName(m, k.id, L()) }) : t('career.newProject'))}
    ${field('c-pos', k ? h('career.f.title') : h('career.f.project'), '', { right: tr })}${field('c-org', k ? esc(k.org) : h('career.f.with'), '', { ph: k ? '' : t('career.f.withPh') })}
    <div class="grid2">${field('c-start', h('career.f.started'), '', { type: 'month' })}${field('c-end', h('career.f.ended'), '', { type: 'month' })}</div>
    ${!k ? `<label class="field"><span class="lbl inline"><span class="lt">${h('career.f.during')}</span></span><select id="c-during"><option value="">${h('career.f.independent')}</option>${[...(m.work ?? []).map(w => [w.id, `${t('career.kind.work')}: ${w.name}`]), ...(m.education ?? []).map((e, i) => [e.id ?? `edu-${i}`, `${t('career.kind.education')}: ${e.institution}`])].map(([id, l]) => `<option value="${esc(id)}">${esc(l)}</option>`).join('')}</select></label>` : ''}
    ${claims}${go(t('career.addIt'))}`;
  if (k) return `${head(t('career.newKindEntry', { kind: K.kindName(m, k.id, L()) }))}${field('c-pos', h('career.f.title'), '', { right: tr })}${field('c-org', esc(k.org), '')}${field('c-start', h('career.f.date'), '', { type: 'month' })}${go(t('career.addIt'))}`;
  if (what === 'skills') return `${head(t('career.addItem.skills'))}${field('c-gname', h('career.f.group'), '', { right: tr, ph: 'CAD' })}${field('c-kw', h('career.f.skills'), '', { ph: 'SolidWorks, Fusion 360' })}${go(t('career.addIt'))}`;
  if (what === 'languages') return `${head(t('career.addItem.languages'))}${field('c-lname', h('career.f.language'), '', { right: tr })}
    <label class="field"><span class="lbl inline"><span class="lt">${h('career.f.level')}</span></span><select id="c-level">${K.LEVELS.map(v => `<option>${esc(v)}</option>`).join('')}</select></label><p class="note">${h('career.spokenNote')}</p>${go(t('career.addIt'))}`;
  if (what === 'certificates') return `${head(t('career.addItem.certificates'))}${field('c-cname', h('career.f.name'), '')}${field('c-issuer', h('career.f.issuer'), '')}${field('c-date', h('career.f.date'), '', { type: 'month' })}${go(t('career.addIt'))}`;
  if (what === 'publications') return `${head(t('career.addItem.publications'))}${field('c-pname', h('career.f.title'), '', { right: tr })}${field('c-publisher', h('career.f.publisher'), '')}
    <div class="grid2">${field('c-ident', h('career.f.identifier'), '')}${field('c-role', h('career.f.role'), '')}</div>${field('c-date', h('career.f.date'), '', { type: 'month' })}<p class="note">${h('career.pubNote')}</p>${go(t('career.addIt'))}`;
  if (what === 'interests') return `${head(t('career.addItem.interests'))}${field('c-iname', h('career.f.interest'), '', { right: tr })}${go(t('career.addIt'))}`;
  if (what === 'references') return `${head(t('career.addItem.references'))}${field('c-rname', h('career.f.refName'), '')}${area('c-rtext', h('career.f.refText'), '', { right: tr, ph: t('career.f.refPh'), rows: 3 })}<p class="note">${h('career.refNote')}</p>${go(t('career.addIt'))}`;
  return '';
}

function kindView(){
  const m = rec();
  const id = W.kind.id;
  const base = id ? K.kindOf(m, id) : null;
  const d = W.kind.draft ??= base ? structuredClone(base) : { name: { en: '' }, colour: 2, icon: 'star', place: W.area === 'more' ? 'list' : 'timeline', org: t('career.f.org'), store: 'projects' };
  const Lg = L();
  const n = id ? K.entriesOfKind(m, id).length : 0;
  let out = `<div class="crumb"><a data-act="c-kind-cancel">${h('career.title')}</a><span>›</span><span>${id ? h('career.editKind') : h('career.newKind')}</span><button class="x ghost sm" data-act="c-kind-cancel" title="Esc" aria-label="${esc(t('body.close'))}">✕</button></div>
    <h2 class="title">${esc(id ? K.kindName(m, id, Lg) : t('career.newKind'))}</h2>
    <p class="muted small">${h('career.kindIntro')}</p>`;
  if (!id) out += `<span class="lbl">${h('career.startFrom')}</span><div class="btns">${['volunteering', 'awards', 'talks', 'blank'].map(p => `<button class="sm" data-act="c-kind-preset" data-p="${p}" ${['volunteering', 'awards'].includes(p) && K.kindsOf(m).some(k => k.store === K.KIND_PRESETS[p].store) ? 'disabled' : ''}>${icon(K.KIND_PRESETS[p].icon)} ${h(`career.preset.${p}`)}</button>`).join('')}</div>`;
  out += `${field('kn-name', h('career.f.name'), d.name[Lg] ?? '', { right: trLabel(), ph: d.name.en || t('career.kindNamePh') })}
    <span class="lbl inline">${h('career.colour')}</span><div class="sws">${PALETTE.map((c, i) => `<button class="swatch" data-act="c-kind-colour" data-i="${i}" style="background:${c}" aria-pressed="${d.colour === i}" aria-label="${esc(t('career.colourN', { n: i + 1 }))}"></button>`).join('')}</div>
    <span class="lbl inline">${h('career.icon')}</span><div class="sws">${K.KIND_ICONS.map(ic => `<button class="iconb" data-act="c-kind-icon" data-i="${ic}" style="color:${PALETTE[d.colour % 6]}" aria-pressed="${d.icon === ic}" aria-label="${esc(t(`career.iconName.${ic}`))}">${icon(ic)}</button>`).join('')}</div>`;
  out += id ? `<p class="note">${h(d.place === 'list' ? 'career.placeList' : 'career.placeTimeline')}</p>`
    : `<span class="lbl inline">${h('career.writeBullets')}</span>
    <label class="opt"><input type="radio" name="kplace" data-kplace="timeline" ${d.place === 'timeline' ? 'checked' : ''} ${d.store !== 'projects' ? 'disabled' : ''}> ${h('career.placeYes')}</label>
    <label class="opt"><input type="radio" name="kplace" data-kplace="list" ${d.place === 'list' ? 'checked' : ''} ${d.store !== 'projects' ? 'disabled' : ''}> ${h('career.placeNo')}</label>`;
  out += `${field('kn-org', h('career.orgCalled'), d.org, { ph: t('career.orgPh') })}
    <p class="note">${h('career.kindSection')}</p>
    <div class="btns"><button class="primary sm" data-act="c-kind-save">${id ? h('head.save') : h('career.createKind')}</button>
      ${id ? `<span class="grow"></span><button class="sm ghost" data-act="c-kind-del">🗑 ${h('career.deleteKind')}</button>` : ''}</div>`;
  if (id && W.delKind){
    const others = [...(d.place === 'timeline' ? [['project', t('career.kind.project')]] : []), ...K.kindsOf(m).filter(k => k.id !== id && k.place === d.place).map(k => [k.id, K.kindName(m, k.id, Lg)])];
    out += `<div class="missbar">${h('career.deleteKindAsk', { n })}
      <div class="btns">${others.length ? `<select id="kn-move">${others.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select><button class="sm" data-act="c-kind-del-move">${h('career.moveThem')}</button>` : ''}
      <button class="sm" data-act="c-kind-del-all">${h('career.deleteThem', { n })}</button></div></div>`;
  }
  out += d.store === 'volunteer' ? `<p class="note">${h('career.storeVolunteer')}</p>` : d.store === 'awards' ? `<p class="note">${h('career.storeAwards')}</p>` : id ? `<p class="note">${h('career.storeProjects')}</p>` : '';
  return out;
}

export function langControl(){
  const m = rec(), Lg = L();
  const inUse = langsInUse(m);
  const missing = Lg === DEFAULT_LANG ? 0 : missingCount(Lg);
  return `<span class="muted small">${h('career.language')}</span><span class="lang-menu"><button class="sm langbtn" id="c-langbtn" data-act="c-lang-menu" aria-haspopup="menu" aria-expanded="${W.pop === 'lang'}">${esc(langName(Lg))} ▾${missing ? `<span class="badge" title="${esc(t('lang.toWrite', { n: missing }))}">${missing}</span>` : ''}</button>
    ${W.pop === 'lang' ? langMenuHtml({ for: 'career', current: Lg, inUse, more: W.more, label: t('career.language'), count: l => (l === DEFAULT_LANG ? 0 : W.counts?.[l] ?? null) }) : ''}</span>`;
}
function missingCount(lang){
  const m = rec();
  const tl = K.timelineLayout(m, { lang }).entries.reduce((n, x) => n + x.toWrite, 0);
  const lists = K.recordLists(m, { lang }).flatMap(g => g.items).filter(x => x.titleMissing).length;
  return tl + lists;
}

const val = id => $(`#${id}`)?.value ?? '';
const say = (res, what) => {
  const kept = [res?.title === 'kept' && t('career.theTitle'), res?.meta === 'kept' && t('career.theLine'), res?.printed === 'kept' && t('career.theLine')].filter(Boolean);
  C.toast(kept.length ? t('career.keptNote', { what: kept.join(t('career.and')) }) : t('career.savedFollows'));
};
// leaving a claim with a typed draft asks first, as the Resume does
const leave = next => C.edit.leaving(next ?? { kind: 'none' });
const select = s => { if (!leave()) return; C.edit.resetPick(); W.sel = s; W.details = false; W.adding = null; W.kind = null; W.delKind = null; C.renderCareer(); };

async function act(a, tg){
  if (!a.startsWith('c-') && !(a === 'lang' || a === 'lang-add' || a === 'lang-more')) return false;
  if ((a === 'lang' || a === 'lang-add' || a === 'lang-more') && tg.dataset.for !== 'career') return false;
  const m = rec(), Lg = L();
  switch (a){
    case 'c-area': if (!leave()) return true; W.area = tg.dataset.area; W.pop = null; W.adding = null; W.kind = null; W.sel = firstOf(W.area); W.details = false; C.renderCareer(); return true;
    case 'c-pop': W.pop = W.pop === tg.dataset.pop ? null : tg.dataset.pop; W.more = false; C.renderCareer(); if (W.pop) focusMenu('.addm'); return true;
    case 'c-sel': select({ what: tg.dataset.what, key: tg.dataset.key, id: tg.dataset.id, group: tg.dataset.group }); return true;
    case 'c-sel-fact': W.sel = { ...W.sel, what: 'aboutfact', fact: tg.dataset.fact, title: tg.dataset.title }; C.renderBody(true); return true;
    case 'c-claim': { const next = { what: 'claim', key: tg.dataset.key, id: tg.dataset.entry, claim: tg.dataset.id }; if (!leave({ kind: 'bullet', id: next.claim })) return true; C.edit.resetPick(); W.sel = next; C.renderBody(true); return true; }
    case 'c-up': up(); return true;
    case 'c-arch-jobs': W.jobs = !W.jobs; C.renderCareer(); return true;
    case 'c-arch-entry': case 'c-unarch-entry': {
      const id = tg.dataset.id, on = a === 'c-arch-entry';
      let res;
      commit(d => { res = on ? K.archiveEntry(d.record, id) : K.unarchiveEntry(d.record, id); }, t(on ? 'arch.undoArchiveJob' : 'arch.undoUnarchiveJob'));
      if (res?.changed){ C.toast(t(on ? 'arch.jobArchived' : 'arch.jobUnarchived')); if (on && !W.jobs) W.sel = null; C.renderCareer(); }
      return true;
    }
    case 'c-arch-show': { const id = tg.dataset.id; if (W.shown.has(id)) W.shown.delete(id); else W.shown.add(id); C.renderBody(true); return true; }
    case 'c-details': W.details = tg.dataset.open === '1'; C.renderBody(true); if (W.details) setTimeout(() => $('#c-pos, #c-gname')?.focus(), 30); return true;
    case 'c-step': {
      const x = K.timelineLayout(m, { lang: Lg }).entries;
      const cur = x.find(e => e.id === W.sel?.id);
      const same = x.filter(e => e.kind === cur?.kind);
      const n = same[same.indexOf(cur) + Number(tg.dataset.d)];
      if (n) select({ what: 'entry', key: n.key, id: n.id });
      return true;
    }
    case 'c-save': {
      const key = tg.dataset.key, id = tg.dataset.id;
      let res;
      const end = $('#c-current')?.checked ? '' : val('c-end');
      if (key === 'work') commit(d => { res = K.updateJob(d.record, id, { position: val('c-pos'), name: val('c-org'), startDate: val('c-start'), endDate: end, location: val('c-loc'), ...opt('url', 'c-wurl'), ...opt('description', 'c-wdesc'), ...opt('summary', 'c-wsum') }, Lg); }, t('undo.editJob'));
      else if (key === 'education') commit(d => { res = K.updateEducation(d.record, id, { ...(Lg === DEFAULT_LANG ? splitDegree(val('c-pos'), entryOf('education', id)) : { studyType: val('c-pos') }), institution: val('c-org'), startDate: val('c-start'), endDate: val('c-end'), score: val('c-hon'), ...opt('url', 'c-eurl'), ...opt('courses', 'c-courses') }, Lg); }, t('undo.editEntry'));
      else commit(d => { res = K.updateProject(d.record, id, { name: val('c-pos'), org: val('c-org'), startDate: val('c-start'), ...($('#c-end') ? { endDate: val('c-end') } : {}), ...($('#c-loc') ? { location: val('c-loc') } : {}), ...($('#c-url') ? { url: val('c-url') } : {}), ...($('#c-during') ? { during: val('c-during') } : {}), ...opt('description', 'c-desc') }, Lg); }, t('undo.editEntry'));
      if (res){ say(res); W.details = false; C.renderCareer(); }
      return true;
    }
    case 'c-del-entry': {
      const id = tg.dataset.id;
      let res;
      commit(d => { res = K.deleteEntry(d.record, id, recipes(d)); }, t('undo.deleteEntry'));
      if (res){ C.toast(t('career.deletedEntry')); W.sel = null; C.renderCareer(); }
      return true;
    }
    case 'c-save-about': {
      let res;
      const part = tg.dataset.part;
      const fields = part === 'name' ? { name: val('c-name'), label: val('c-label') } : { email: val('c-email'), phone: val('c-phone'), city: val('c-city'), url: val('c-url'), rights: val('c-rights'), ...opt('address', 'c-addr'), ...opt('postalCode', 'c-postal'), ...opt('region', 'c-region') };
      commit(d => { res = K.updateAbout(d.record, fields, Lg); }, t('undo.editAbout'));
      if (res) say({ title: res.label, meta: res.contact });
      C.renderCareer();
      return true;
    }
    case 'c-add-summary': {
      const text = val('c-summary').trim();
      if (!text) return true;
      const B = await import('../model/build.js');
      commit(d => { B.setSummary(d.record, text); }, t('undo.addSummary'));
      C.renderCareer();
      return true;
    }
    case 'c-save-item': {
      const g = tg.dataset.group, id = tg.dataset.id;
      let res;
      if (g === 'skills') commit(d => { res = K.updateSkill(d.record, id, { name: val('c-gname'), keywords: keywordsNow(id), ...opt('level', 'c-slevel') }, Lg); }, t('undo.editItem'));
      if (g === 'languages') commit(d => { res = K.updateLanguage(d.record, id, { language: val('c-lname'), fluency: val('c-level') }, Lg); }, t('undo.editItem'));
      if (g === 'certificates') commit(d => { res = K.updateCertificate(d.record, id, { name: val('c-cname'), issuer: val('c-issuer'), date: val('c-date'), expires: val('c-expires'), url: val('c-url') }); }, t('undo.editItem'));
      if (g === 'publications') commit(d => { res = K.updatePublication(d.record, id, { name: val('c-pname'), publisher: val('c-publisher'), releaseDate: val('c-date'), ...opt('url', 'c-url'), ...opt('summary', 'c-psum') }, Lg); }, t('undo.editItem'));
      if (g === 'references') commit(d => { res = K.updateReference(d.record, id, { name: val('c-rname'), reference: val('c-rtext') }, Lg); }, t('undo.editItem'));
      if (g === 'interests') commit(d => { res = K.updateInterest(d.record, id, { name: val('c-iname') }, Lg); }, t('undo.editItem'));
      if (res) say(res);
      W.kwDraft = null;
      C.renderCareer();
      return true;
    }
    case 'c-kw-rm': { const id = W.sel.id; const kw = keywordsNow(id); kw.splice(Number(tg.dataset.n), 1); W.kwDraft = kw; redrawKw(); return true; }
    case 'c-del-item': {
      const g = tg.dataset.group, id = tg.dataset.id;
      let res;
      commit(d => { res = K.deleteItem(d.record, g, id, recipes(d)); }, t('undo.deleteItem'));
      if (res){ C.toast(t('career.deletedItem')); W.sel = null; C.renderCareer(); }
      return true;
    }
    case 'c-add': {
      const what = tg.dataset.what;
      W.pop = null;
      if (what === 'summary'){ W.area = 'about'; select({ what: 'about', id: 'summary' }); const b = rec().basics; if (b?.summary) C.edit.startEdit('new'); return true; }
      W.adding = { what }; W.sel = null; W.kind = null;
      if (['work', 'education', 'project'].includes(what) || K.kindOf(m, what)?.place === 'timeline') W.area = 'timeline';
      else if (what !== 'summary') W.area = 'more';
      C.renderCareer();
      setTimeout(() => $('#body input, #body textarea')?.focus(), 30);
      return true;
    }
    case 'c-add-cancel': W.adding = null; C.renderCareer(); return true;
    case 'c-create': return create(tg.dataset.what);
    case 'c-kind-new': W.pop = null; W.adding = null; W.kind = { id: null, draft: null }; C.renderCareer(); return true;
    case 'c-kind-edit': W.pop = null; W.adding = null; W.kind = { id: tg.dataset.id, draft: null }; W.delKind = null; C.renderCareer(); return true;
    case 'c-kind-cancel': W.kind = null; W.delKind = null; C.renderCareer(); return true;
    case 'c-kind-preset': { const p = K.KIND_PRESETS[tg.dataset.p]; readKind(); W.kind.draft = { ...structuredClone(p), name: { ...W.kind.draft.name, en: p.name.en ? t(`career.preset.${tg.dataset.p}`) : W.kind.draft.name.en ?? '' }, org: p.org ? t(`career.presetOrg.${tg.dataset.p}`) : W.kind.draft.org }; if (L() !== DEFAULT_LANG && p.name.en) W.kind.draft.name[L()] = t(`career.preset.${tg.dataset.p}`); C.renderBody(); return true; }
    case 'c-kind-colour': readKind(); W.kind.draft.colour = Number(tg.dataset.i); C.renderBody(); return true;
    case 'c-kind-icon': readKind(); W.kind.draft.icon = tg.dataset.i; C.renderBody(); return true;
    case 'c-kind-save': return saveKind();
    case 'c-kind-del': W.delKind = true; C.renderBody(); return true;
    case 'c-kind-del-move': case 'c-kind-del-all': {
      const id = W.kind.id, to = a === 'c-kind-del-move' ? val('kn-move') : null;
      let res;
      commit(d => { res = K.deleteKind(d.record, id, { moveTo: to, recipes: recipes(d) }); }, t('undo.deleteKind'));
      if (res){ C.toast(to ? t('career.kindMoved', { n: res.moved }) : t('career.kindDeleted', { n: res.deleted })); W.kind = null; W.delKind = null; W.sel = null; C.renderCareer(); }
      return true;
    }
    case 'c-tip-next': W.tip = W.tip < TIPS.length - 1 ? W.tip + 1 : null; if (W.tip == null) setTipsDone(true); C.renderCareer(); return true;
    case 'c-tip-skip': W.tip = null; setTipsDone(true); C.renderCareer(); return true;
    case 'c-tips-again': setTipsDone(false); W.tip = 0; C.ui.menu = false; C.renderHead(); C.renderCareer(); return true;
    case 'c-lang-menu': {
      if (W.pop === 'lang'){ W.pop = null; C.renderHead(); return true; }
      W.pop = 'lang'; W.more = false;
      const inUse = langsInUse(m);
      W.counts = Object.fromEntries(inUse.map(l => [l, l === DEFAULT_LANG ? 0 : missingCount(l)]));
      C.renderHead(); focusMenu('.langpop');
      return true;
    }
    case 'lang-more': W.more = true; C.renderHead(); focusMenu('.langpop [data-act=lang-add]'); return true;
    case 'lang': case 'lang-add': {
      const l = tg.dataset.lang;
      if (a === 'lang-add') commit(d => { addLangInUse(d.record, l); }, t('undo.addLanguage', { lang: langName(l) }));
      if (!leave()) return true;
      W.lang = l; W.pop = null; W.details = false;
      await loadCatalogue(l);
      C.syncUi(true);             // the interface follows Career's language too (it redraws everything)
      return true;
    }
  }
  return false;
}
const splitDegree = (text, e) => { const t0 = String(text ?? '').trim(); if (!e) return { studyType: t0 }; const st0 = e.studyType && t0.startsWith(e.studyType) ? e.studyType : t0.split(' ')[0]; return { studyType: st0, area: t0.slice(st0.length).trim() || e.area }; };
const firstOf = area => {
  const m = rec();
  if (area === 'about') return { what: 'about', id: 'name' };
  if (area === 'more'){ const g = K.recordLists(m, { lang: L() }).find(x => x.items.length); return g ? { what: 'item', group: g.group, id: g.items[0].id } : null; }
  const x = K.timelineLayout(m, { lang: L() }).entries[0];
  return x ? { what: 'entry', key: x.key, id: x.id } : null;
};
function walk(d){
  const s = W.sel;
  if (!s || (s.what !== 'claim' && s.what !== 'entry')) return null;
  const x = entryOf(s.key, s.id);
  const list = x?.highlights ?? [];
  if (!list.length) return null;
  const at = s.what === 'claim' ? list.indexOf(s.claim) : (d > 0 ? -1 : list.length);
  const to = list[Math.max(0, Math.min(list.length - 1, at + d))];
  return to && to !== s.claim ? { key: s.key, entry: s.id, claim: to } : null;
}
function openClaim({ key, entry, claim }){
  if (!leave({ kind: 'bullet', id: claim })) return;
  C.edit.resetPick();
  W.sel = { what: 'claim', key, id: entry, claim };
  C.renderBody(true);
}
function up(){
  if (C.edit.editing){ C.edit.cancelEdit({ ask: true }); return; }
  if (W.sel?.what === 'claim'){ W.sel = { what: 'entry', key: W.sel.key, id: W.sel.id }; C.renderBody(true); return; }
  if (W.sel?.what === 'aboutfact'){ W.sel = { what: 'about', id: W.sel.id }; C.renderBody(true); return; }
  if (W.kind){ W.kind = null; W.delKind = null; C.renderBody(true); return; }
  if (W.adding){ W.adding = null; C.renderBody(true); return; }
  if (W.details){ W.details = false; C.renderBody(true); return; }
}
const keywordsNow = id => W.kwDraft ?? [...((rec().skills ?? []).find(s => s.id === id)?.keywords ?? [])];
function redrawKw(){
  const el = $('#c-kw'); if (!el) return;
  const kw = W.kwDraft ?? [];
  el.innerHTML = `${kw.map((w, n) => `<span class="tag">${esc(w)}<button class="rm" data-act="c-kw-rm" data-n="${n}" aria-label="${esc(t('edit.removeTag', { tag: w }))}">×</button></span>`).join('')}<input id="c-kw-in" placeholder="${esc(t('career.f.skillPh'))}" aria-label="${esc(t('career.f.skillPh'))}">`;
  $('#c-kw-in')?.focus();
}
function readKind(){
  const d = W.kind.draft;
  if (!d) return;
  const n = $('#kn-name')?.value; if (n !== undefined) d.name[L()] = n;
  const o = $('#kn-org')?.value; if (o !== undefined) d.org = o;
}
function saveKind(){
  readKind();
  const d = W.kind.draft, id = W.kind.id;
  if (!String(d.name.en ?? '').trim() && L() !== DEFAULT_LANG) d.name.en = d.name[L()];
  if (!String(d.name.en ?? '').trim()){ C.toast(t('error.kindName'), 'warn'); $('#kn-name')?.focus(); return true; }
  let made;
  if (id) commit(x => { K.updateKind(x.record, id, d, recipes(x)); }, t('undo.editKind'), t('career.kindSaved'));
  else commit(x => { made = K.createKind(x.record, d); }, t('undo.newKind'), t('career.kindCreated', { name: d.name[L()] || d.name.en }));
  W.kind = null;
  if (made){ W.adding = { what: made }; W.area = d.place === 'list' ? 'more' : 'timeline'; }
  C.renderCareer();
  return true;
}
function create(what){
  const m = rec(), Lg = L();
  const k = K.kindOf(m, what);
  const lines = () => val('c-claims').split('\n').map(x => x.trim()).filter(Boolean);
  let id = null, sel = null;
  if (what === 'work'){
    const bullets = lines();
    if (!bullets.length){ C.toast(t('career.needClaim'), 'warn'); $('#c-claims')?.focus(); return true; }
    commit(d => { id = K.addJob(d.record, { position: val('c-pos'), name: val('c-org'), startDate: val('c-start'), endDate: $('#c-current')?.checked ? '' : val('c-end'), location: val('c-loc'), bullets, lang: Lg }); }, t('undo.addJob'), t('career.jobAdded'));
    sel = id && { what: 'entry', key: 'work', id };
  } else if (what === 'education'){
    const B = import('../model/build.js');
    B.then(B => {
      let eid;
      commit(d => {
        if (!(d.record.education ?? []).length){ B.setEducation(d.record, { institution: val('c-org'), studyType: val('c-type'), area: val('c-area'), startDate: val('c-start'), endDate: val('c-end'), score: val('c-hon'), lang: Lg }); eid = d.record.education[0].id; }
        else { const e = { id: B.slug(`edu-${val('c-org')}`, new Set((d.record.education ?? []).map(x => x.id)), 'edu'), institution: val('c-org') || '—', studyType: val('c-type') || '—', area: val('c-area') || '—', ...(val('c-start') ? { startDate: val('c-start') } : {}), ...(val('c-end') ? { endDate: val('c-end') } : {}), ...(val('c-hon') ? { score: val('c-hon') } : {}) }; d.record.education.push(e); eid = e.id; }
      }, t('undo.addEducation'), t('career.educationAdded'));
      W.adding = null; if (eid) W.sel = { what: 'entry', key: 'education', id: eid }; C.renderCareer();
    });
    return true;
  } else if (what === 'project' || (k && k.place === 'timeline')){
    const bullets = lines();
    if (k) commit(d => { id = K.addKindEntry(d.record, what, { name: val('c-pos'), org: val('c-org'), startDate: val('c-start'), endDate: val('c-end'), bullets, lang: Lg }); }, t('undo.addEntry'), t('career.entryAdded'));
    else commit(d => { id = K.addProject(d.record, { name: val('c-pos'), entity: val('c-org'), startDate: val('c-start'), endDate: val('c-end'), during: val('c-during') || null, bullets, lang: Lg }); }, t('undo.addEntry'), t('career.entryAdded'));
    sel = id && { what: 'entry', key: entryKey(rec(), id), id };
  } else if (k){
    commit(d => { id = K.addKindEntry(d.record, what, { name: val('c-pos'), org: val('c-org'), startDate: val('c-start'), lang: Lg }); }, t('undo.addEntry'), t('career.entryAdded'));
    sel = id && { what: 'item', group: what, id };
  } else if (what === 'skills'){
    commit(d => { id = K.addSkill(d.record, { name: val('c-gname'), keywords: val('c-kw') }, Lg); }, t('undo.addItem'), t('career.itemAdded'));
    sel = id && { what: 'item', group: 'skills', id };
  } else if (what === 'languages'){
    commit(d => { id = K.addLanguage(d.record, { language: val('c-lname'), fluency: val('c-level') }, Lg); }, t('undo.addItem'), t('career.itemAdded'));
    sel = id && { what: 'item', group: 'languages', id };
  } else if (what === 'certificates'){
    commit(d => { id = K.addCertificate(d.record, { name: val('c-cname'), issuer: val('c-issuer'), date: val('c-date') }); }, t('undo.addItem'), t('career.itemAdded'));
    sel = id && { what: 'item', group: 'certificates', id };
  } else if (what === 'publications'){
    commit(d => { id = K.addPublication(d.record, { name: val('c-pname'), publisher: val('c-publisher'), identifier: val('c-ident'), role: val('c-role'), releaseDate: val('c-date') }, Lg); }, t('undo.addItem'), t('career.itemAdded'));
    sel = id && { what: 'item', group: 'publications', id };
  } else if (what === 'interests'){
    commit(d => { id = K.addInterest(d.record, { name: val('c-iname') }, Lg); }, t('undo.addItem'), t('career.itemAdded'));
    sel = id && { what: 'item', group: 'interests', id };
  } else if (what === 'references'){
    if (!val('c-rname').trim()){ $('#c-rname')?.focus(); return true; }
    commit(d => { id = K.addReference(d.record, { name: val('c-rname'), reference: val('c-rtext') }, Lg); }, t('undo.addItem'), t('career.itemAdded'));
    sel = id && { what: 'item', group: 'references', id };
  }
  W.adding = null;
  if (sel) W.sel = sel;
  C.renderCareer();
  return true;
}

function bind(body){
  body.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'c-current'){ const end = $('#c-end'); if (end) end.disabled = el.checked; }
    if (el.dataset.kplace && W.kind?.draft){ readKind(); W.kind.draft.place = el.dataset.kplace; C.renderBody(); }
  });
  body.addEventListener('keydown', e => {
    const el = e.target;
    if (el.id === 'c-kw-in' && (e.key === 'Enter' || e.key === ',')){
      e.preventDefault();
      const v = el.value.trim(); if (!v) return;
      W.kwDraft = [...keywordsNow(W.sel.id), v]; redrawKw();
    }
  });
}
const viewWrap = () => {
  const html = panel();
  const keyed = W.sel && !W.kind && !W.adding && ['entry', 'claim', 'aboutfact'].includes(W.sel.what);
  return keyed ? `${html}<p class="note keys">${h('edit.keys')}</p>` : html;
};
const panel = () => {
  if (W.sel?.what === 'aboutfact') return claimView(W.sel.fact, { title: W.sel.title, deletable: false,
    crumbs: crumb([{ t: t('career.step1'), act: 'c-up' }, { t: W.sel.title }], { close: 'c-up' }) });
  return careerView();
};

const api = {
  views: { career: viewWrap }, act, bind, timelineHtml, langControl,
  get lang(){ return L(); },
  // entering Career: the content language starts as the open resume's; a first visit gets the tips
  reset(){
    W.adding = null; W.pop = null; W.kind = null; W.delKind = null; W.details = false; W.lang = null;
    if (!W.sel) W.sel = firstOf(W.area);
    if (W.tip == null && !tipsDone()) W.tip = 0;
  },
  closeMenus(){ if (W.pop){ W.pop = null; C.renderHead(); C.renderCareer(); return true; } return false; },
  // Esc in Career goes up one level (the editor, then the claim, then the
  // entry's panel), and only then back to the Resume: false means go back.
  escape(){
    if (W.pop){ W.pop = null; C.renderHead(); C.renderCareer(); return true; }
    if (C.edit.editing || W.sel?.what === 'claim' || W.sel?.what === 'aboutfact' || W.kind || W.adding || W.details){ up(); return true; }
    if (W.sel){ if (!leave()) return true; W.sel = null; C.renderCareer(); return true; }
    return false;
  },
  // ↑ ↓ walk the claims of the open entry; the rest is the editor's (← → Enter)
  key(e){
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      const to = walk(e.key === 'ArrowDown' ? 1 : -1);
      if (to){ e.preventDefault(); openClaim(to); }
      return !!to;
    }
    return C.edit.key(e);
  },
  up, 
  reveal(){ return W.shown.size > 0; },
  fact(){
    const s = W.sel;
    if (s?.what === 'claim') return s.claim;
    if (s?.what === 'aboutfact') return s.fact;
    if (s?.what === 'about' && s.id === 'summary') return rec().basics?.summary ?? null;
    return null;
  },
  showTips(){ setTipsDone(false); W.tip = 0; C.renderCareer(); },
  focus({ area, sel }){ W.area = area ?? W.area; W.sel = sel ?? firstOf(W.area); W.details = false; W.adding = null; W.kind = null; },
  kindColour: kind => look(kind).colour,
  stripe(){
    const s = W.sel;
    if (W.kind) return PALETTE[(W.kind.draft?.colour ?? 2) % 6];
    if (W.adding) return look(W.adding.what === 'summary' ? 'about' : W.adding.what).colour;
    if (!s) return '#475569';
    if (s.what === 'about' || s.what === 'aboutfact') return look('about').colour;
    if (s.what === 'item') return look(s.group).colour;
    const x = entryOf(s.key, s.id);
    return x ? look(K.entryView(rec(), s.key, { ...x, id: s.id }).kind).colour : '#475569';
  },
  get sel(){ return W.sel; },
};
