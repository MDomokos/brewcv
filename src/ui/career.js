// The record's forms. There is no Career workspace: the record is a checklist in the editor panel
// (checklist.js), and everything you could do to it opens in the inspector, the one panel edit.js draws.
// This module is what the inspector shows for things that are not a claim: About you, the details of a job,
// an education entry, a skill group or other list item, a job type, a new entry, a custom kind. It also
// draws the timeline at the top of the Record tab. Fields commit when you leave them or press Enter, Esc
// puts the field back, and every commit is one undo step; only creating something has a button.

import * as K from '../model/career.js';
import { jobTypesOf, allTags, tagVocab, TAG_CAP } from '../model/focus.js';
import { langName } from '../model/lang.js';
import { DEFAULT_LANG, defaultVariant, ownWording, useRecordWording } from '../model/resume.js';
import { entryKey } from '../model/entries.js';
import { t, h, tIn, errText } from '../i18n/index.js';
import { crumb, photoHtml, delBtn, delAskHtml } from './parts.js';
import { icon, withArrows } from './icons.js';
import { askIfLocked } from './ask.js';
import { monthFieldHtml, initMonthPick } from './monthpick.js';

let C = null;
export function initCareer(ctx){ C = ctx; initMonthPick({ lang: () => L(), change: input => { const form = input.closest('[data-form]'); if (form) saveForm(form); } }); return api; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = s => document.querySelector(s);
const st = () => C.store.state;
const rec = () => C.work();

// view state; none of it is undone or saved
const W = {
  pop: null,                 // 'add': the + Add menu is open
  kind: null,                // the kind editor: { id | null, draft }
  delKind: null,
  shown: new Set(),          // entries whose archived claims are revealed
  jobs: false,               // archived jobs are revealed
  det: new Map(),            // entry id → its Details fold is open
  kwDraft: null,
};

export const L = () => C.lang();

// A kind's colour is one of the shared six hues (--hue-1..6, sidebar.css 9), shown as the icon on the hue's tint like the Outline's headings. The built-in
// kinds and groups have theirs; a custom kind picks one of six swatches (its saved `colour`, 0-5). A kind saved when the swatches were six hexes keeps the
// nearest hue: pink to plum, sky to slate, lime to matcha, rust to clay, cyan to amber, stone to sage.
export const SWATCH_HUES = [5, 4, 1, 3, 2, 6];
const BUILT = {
  work: ['work', 4], education: ['education', 1], project: ['project', 2], skills: ['skills', 5], languages: ['languages', 4], certificates: ['certificates', 1],
  publications: ['publications', 3], awards: ['awards', 2], interests: ['interests', 6], references: ['references', 3], about: ['about', 6], summary: ['lines', 6],
};
function look(kind){
  const b = BUILT[kind];
  if (b) return { icon: b[0], hue: b[1] };
  const k = K.kindOf(rec(), kind);
  if (k?.store === 'awards') return { icon: k.icon || 'awards', hue: BUILT.awards[1] };
  return k ? { icon: k.icon, hue: SWATCH_HUES[k.colour % 6] } : { icon: 'dot', hue: 6 };
}
// a kind's hue as a colour (for --hk), and its chip: the monochrome icon on the hue (24 px), for the Outline's section headings (checklist.js)
export const kindHue = kind => `var(--hue-${look(kind).hue})`;
const kc = kind => `style="--hk:${kindHue(kind)}"`;
export const kindChip = kind => `<span class="si" aria-hidden="true">${icon(look(kind).icon, { role: 'header' })}</span>`;
const kindLabel = kind => (BUILT[kind] || ['work', 'education', 'project'].includes(kind) ? t(`career.kind.${kind}`) : K.kindName(rec(), kind, L()));

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
const field = (id, label, value, { right = '', miss = false, ph = '', type = 'text', attrs = '', present = false } = {}) => (type === 'month'
  ? monthFieldHtml(id, label, value, { right, lang: L(), present, disabled: /\bdisabled\b/.test(attrs) })
  : `<label class="field"><span class="lbl inline"><span class="lt">${label}</span>${right ? `<span class="lr">${right}</span>` : ''}</span><input id="${id}" type="${type}" class="${miss ? 'miss' : ''}" value="${esc(value ?? '')}" placeholder="${esc(ph)}" autocomplete="off" ${attrs}></label>`);
// a few lines of text (JSON Resume descriptions and summaries): Enter is a new line
const area = (id, label, value, { right = '', ph = '', rows = 2, single = false, miss = false } = {}) =>
  `<label class="field"><span class="lbl inline"><span class="lt">${label}</span>${right ? `<span class="lr">${right}</span>` : ''}</span><textarea id="${id}" rows="${rows}" class="${miss ? 'miss' : ''}" ${single ? 'data-single' : ''} placeholder="${esc(ph)}">${esc(value ?? '')}</textarea></label>`;
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
function commit(fn, label, done, undo = false){
  try { const ok = C.store.commit(d => { fn(d); }, label); if (ok && done) C.toast(done, '', undo); return ok; }
  catch (e){ C.toast(errText(e), 'bad'); return false; }
}
const recipes = d => [d.cur, ...(d.resumes ?? [])];
const textIn = (id, lang = L()) => { const v = id ? defaultVariant(rec(), id, lang) : null; return v && (v.lang ?? DEFAULT_LANG) === lang ? v.text : ''; };
const textEn = id => (id ? defaultVariant(rec(), id, DEFAULT_LANG)?.text ?? '' : '');
const val = id => $(`#${id}`)?.value ?? '';

// ---- the + Add menu (in the checklist's header) ----
export function addMenuHtml(){
  const m = rec();
  const row = (kind, title, sub, extra = '') => `<div class="addrowk"><button role="menuitem" data-act="c-add" data-what="${esc(kind)}"><span class="ai hband hic" ${kc(kind)}>${icon(look(kind).icon)}</span><span><b>${esc(title)}</b><small>${esc(sub)}</small></span></button>${extra}</div>`;
  const cog = k => `<button class="kset" data-act="c-kind-edit" data-id="${esc(k.id)}" title="${esc(t('career.kindSettings', { name: K.kindName(m, k.id, L()) }))}" aria-label="${esc(t('career.kindSettings', { name: K.kindName(m, k.id, L()) }))}">⚙</button>`;
  const timeline = ['work', 'education', 'project'].map(k => row(k, t(`career.kind.${k}`), t(`career.kindSub.${k}`))).join('')
    + K.kindsOf(m).filter(k => k.place === 'timeline').map(k => row(k.id, K.kindName(m, k.id, L()), t('career.period'), cog(k))).join('');
  const lists = ['skills', 'languages', 'certificates', 'publications'].map(g => row(g, t(`career.addItem.${g}`), t(`career.addItemSub.${g}`))).join('')
    + K.kindsOf(m).filter(k => k.place === 'list').map(k => row(k.id, K.kindName(m, k.id, L()), t('career.oneDate'), cog(k))).join('')
    + row('interests', t('career.addItem.interests'), t('career.addItemSub.interests'))
    + row('references', t('career.addItem.references'), t('career.addItemSub.references'));
  const canKind = K.kindsOf(m).length < K.MAX_KINDS;
  return `<div class="addm inline-menu" role="menu" aria-label="${esc(t('career.add'))}">
    ${m.basics?.summary ? '' : row('summary', t('career.addSummary'), t('career.addSummarySub'))}
    ${timeline}<hr>${lists}
    ${canKind ? `<hr><button role="menuitem" data-act="c-kind-new"><span class="ai">+</span><span><b>${h('career.somethingElse')}</b><small>${h('career.somethingElseTl')}</small></span></button>` : ''}</div>`;
}

// ---- the timeline, newest first: a click opens that entry in Career's inspector ----
export function timelineHtml(){ return timelineCols(); }
function timelineCols(){
  const all = K.timelineLayout(rec(), { lang: L() });
  const nArch = all.entries.filter(x => x.archived).length;
  const { bands, entries } = nArch && !W.jobs ? K.timelineLayout(rec(), { lang: L(), hideArchived: true }) : all;
  const archBtn = nArch ? `<button class="sm ghost archmore" data-act="c-arch-jobs" aria-expanded="${W.jobs}">${W.jobs ? h('arch.hideJobs') : h('arch.nJobs', { n: nArch })}</button>` : '';
  if (!entries.length) return `<div class="empty card-ish"><p><b>${h('career.emptyWork')}</b></p><div class="btns"><button class="primary sm" data-act="c-add" data-what="work">${h('career.addWork')}</button></div></div>`;
  const mark = x => (!sameLang() && x.toWrite ? x.toWrite : 0);
  const main = x => `<button class="row" ${kc(x.kind)} data-act="rec-job" data-key="${x.key}" data-id="${esc(x.id)}" data-grp="${esc(x.key === 'education' ? 'education' : x.id)}">
      <span class="ic hband hic">${icon(look(x.kind).icon)}</span><span class="t ${x.titleMissing ? 'missing' : ''}">${esc(x.title)}</span><span class="w">${esc(years(x))}</span>
      <span class="o"><span class="kw">${esc(kindLabel(x.kind))}</span>${x.org ? ` · ${esc(x.org)}` : ''}${x.archived ? ` · <span class="pill arch">${h('arch.badge')}</span>` : ''}</span>
      ${mark(x) ? `<span class="marks"><span class="mk">${h('career.toWriteIn', { n: mark(x), lang: langName(L()) })}</span></span>` : ''}</button>`;
  const side = x => `<button class="srow" ${kc(x.kind)} data-act="rec-job" data-key="${x.key}" data-id="${esc(x.id)}" data-grp="${esc(x.key === 'education' ? 'education' : x.id)}" title="${esc(kindLabel(x.kind))}">
      <span class="si hic">${icon(look(x.kind).icon, { role: 'inline' })}</span><span class="t ${x.titleMissing ? 'missing' : ''}">${esc(x.title)}</span><span class="w">${esc(years(x))}</span>
      <span class="o"><span class="kw">${esc(kindLabel(x.kind))}</span>${x.org ? ` · ${esc(x.org)}` : ''}${x.during ? ` · ${h('career.during', { org: duringName(x.during) })}` : ''}${mark(x) ? ` · <span class="mkt">${h('career.toWrite', { n: mark(x) })}</span>` : ''}</span></button>`;
  let rows = `<div class="colhead"><span ${kc('work')}>${icon('work')} ${h('career.colMain')}</span><span>${h('career.colSide')}</span></div>`;
  for (const b of bands) rows += `<div class="yr">${esc(b.year ?? t('career.nowBand'))}</div><div class="yrow"><div class="main">${b.main.map(main).join('')}</div><div class="side">${b.side.map(side).join('')}</div></div>`;
  return `<div class="tl2">${rows}</div>${archBtn}`;
}
const duringName = id => { const m = rec(); return m.work?.find(w => w.id === id)?.name ?? m.education?.find(e => e.id === id)?.institution ?? id; };

// ---- job types ----
function jobTypesHtml(){
  const jts = jobTypesOf(rec());
  const vocab = tagVocab(rec());
  const counts = new Map(allTags(rec(), null, { archived: true }).filter(x => !x.jobType).map(x => [x.tag, x.n]));
  return `${crumb([{ t: t('jt.title') }])}<h2 class="title">${h('jt.title')}</h2>
    <p class="muted small">${h('jt.intro')}</p>
    ${jts.map(j => `<div class="jtrow" data-jt="${esc(j.id)}">
      <input class="jt-label" data-id="${esc(j.id)}" value="${esc(j.label)}" aria-label="${esc(t('jt.nameOf', { name: j.label }))}" autocomplete="off">
      <span class="chips">${j.tags.map(tg => `<span class="tag jt">${esc(tg)}${delBtn(`data-act="c-jt-tag-rm" data-id="${esc(j.id)}" data-tag="${esc(tg)}"`, t('edit.removeTag', { tag: tg }), { text: false })}</span>`).join('')}
        <input class="tag-in jt-tag-in" data-suggest="${esc(JSON.stringify(vocab))}" data-id="${esc(j.id)}" placeholder="${esc(t('jt.addTagPh'))}" aria-label="${esc(t('jt.addTagTo', { name: j.label }))}"></span>
      ${delBtn(`data-act="c-jt-del" data-id="${esc(j.id)}"`, t('jt.delete'), { text: false })}</div>`).join('') || `<p class="muted small empty-line">${h('jt.none')}</p>`}
    <div class="jtnew"><input id="jt-new" placeholder="${esc(t('jt.newPh'))}" autocomplete="off" aria-label="${esc(t('jt.new'))}"><button class="sm" data-act="c-jt-add">${h('jt.new')}</button></div>
    <h3 class="sub">${h('ux2.tagsTitle')}</h3>
    <p class="muted small">${h('ux2.tagsIntro', { max: TAG_CAP })}</p>
    <p class="small tagcount" id="tag-count">${h('ux2.tagsCount', { n: vocab.length, max: TAG_CAP })}</p>
    ${vocab.map(tg => `<div class="tagrow" data-tag-row="${esc(tg)}">
      <input class="tag-name" data-tag="${esc(tg)}" value="${esc(tg)}" aria-label="${esc(t('ux2.tagName', { tag: tg }))}" autocomplete="off">
      <span class="muted small">${h('ux2.tagUsed', { n: counts.get(tg) ?? 0 })}</span>
      ${vocab.length > 1 ? `<select class="tag-merge" data-tag="${esc(tg)}" aria-label="${esc(t('ux2.tagMergeInto', { tag: tg }))}"><option value="">${h('ux2.tagMerge')}</option>${vocab.filter(x => x !== tg).map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>` : ''}
      ${delBtn(`data-act="c-tag-del" data-tag="${esc(tg)}"`, t('ux2.tagDelete', { tag: tg }), { text: false })}</div>`).join('') || `<p class="muted small empty-line">${h('ux2.tagsNone')}</p>`}
    <div class="jtnew"><input id="tag-new" placeholder="${esc(t('ux2.tagNewPh'))}" autocomplete="off" aria-label="${esc(t('ux2.tagNew'))}" ${vocab.length >= TAG_CAP ? 'disabled' : ''}><button class="sm" data-act="c-tag-add" ${vocab.length >= TAG_CAP ? 'disabled' : ''}>${h('ux2.tagNew')}</button></div>
    ${vocab.length >= TAG_CAP ? `<p class="muted small">${h('ux2.tagsFull')}</p>` : ''}
    <details class="taghow" ${vocab.length ? '' : 'open'}><summary>${h('ux2.tagsHowTitle')}</summary><p class="small">${h('ux2.tagsHow1')}</p><p class="small">${h('ux2.tagsHow2')}</p><p class="small">${h('ux2.tagsHow3')}</p></details>`;
}

// ---- what the inspector shows for a selection that is not a claim ----
function entryOf(key, id){
  const m = rec();
  if (key === 'education') return (m.education ?? []).find((e, i) => (e.id ?? `edu-${i}`) === id);
  return (m[key] ?? []).find(x => x?.id === id);
}

// An education entry: a panel of its own (a job's details are a fold in the job's panel).
function educationView(id){
  const m = rec();
  const x = entryOf('education', id);
  if (!x) return `<p class="muted">${h('edit.lead')}</p>`;
  const v = K.entryView(m, 'education', { ...x, id }, L());
  return `${crumb([{ t: t('career.kind.education') }, { t: v.title }])}
    <div class="where hband" ${kc('education')}><span class="kb">${icon('education')}${esc(kindLabel('education'))} · ${esc(years(v))}</span></div>
    <h2 class="title ${v.titleMissing ? 'missing' : ''}">${esc(v.title)}</h2>
    <p class="sumline">${[v.org, `${fmt(v.start)} – ${fmt(v.end)}`, v.place].filter(Boolean).map(esc).join(' · ')}</p>
    <div class="detbox" data-form="entry" data-key="education" data-id="${esc(id)}">${detailsForm('education', x, v)}</div>
    <p class="note">${h('career.eduNote')}</p>${goesIn(K.sectionFor(m, 'education', id))}`;
}

// The Details fold of a job, a project or any other entry with claims. The job's panel is edit.js's.
export function detailsHtml(id){
  const m = rec();
  const key = entryKey(m, id);
  const x = key && entryOf(key, id);
  if (!x) return '';
  const v = K.entryView(m, key, { ...x, id }, L());
  const open = W.det.get(id) ?? false;
  const arch = key === 'education' ? '' : `<button class="sm ghost" data-act="${x.archived ? 'c-unarch-entry' : 'c-arch-entry'}" data-id="${esc(id)}" title="${esc(t(x.archived ? 'arch.unarchiveJobTitle' : 'arch.archiveJobTitle'))}">${h(x.archived ? 'arch.unarchiveJob' : 'arch.archiveJob')}</button>`;
  const del = key !== 'work' ? delBtn(`data-act="c-del-entry" data-id="${esc(id)}"`, t('career.deleteEntry'), { name: t('career.ctrlZ') }) : '';
  return `<details class="jr details" data-det="${esc(id)}" ${open ? 'open' : ''}><summary>${h('ux2.details')}</summary>
    <div class="detbox" data-form="entry" data-key="${esc(key)}" data-id="${esc(id)}">${detailsForm(key, x, v)}</div>
    <div class="btns detacts">${arch}${del}</div></details>`;
}

function detailsForm(key, x, v){
  const m = rec(), Lg = L(), tr = trLabel();
  const f = K.fieldPath;
  if (key === 'work') return `${field('c-pos', h('career.f.title'), Lg === DEFAULT_LANG ? x.position : (K.fieldIn(m, Lg, f('work', x.id, 'position')) || textIn(x.display?.position)), { right: tr, miss: !sameLang() && v.titleMissing, ph: x.position })}
      ${field('c-org', h('career.f.employer'), x.name, { right: shared() })}
      <div class="grid2">${field('c-start', h('career.f.started'), ym(x.startDate), { type: 'month' })}${field('c-end', h('career.f.ended'), ym(x.endDate), { type: 'month', present: true })}</div>
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
      : `<div class="grid2">${field('c-start', h('career.f.started'), ym(x.startDate), { type: 'month' })}${field('c-end', h('career.f.ended'), ym(x.endDate), { type: 'month', present: true })}</div>`}
    ${oneDate ? '' : field('c-loc', h('career.f.where'), Lg === DEFAULT_LANG ? x.location : K.fieldIn(m, Lg, f(key, x.id, 'location')), { right: tr, ph: x.location ?? '' })}
    ${key === 'projects' ? field('c-url', h('career.f.link'), x.url ?? '', { ph: 'https://…' }) : ''}
    ${jsonOnly(area('c-desc', h('career.f.description'), x[key === 'projects' ? 'description' : 'summary'] ?? '', { right: shared() }))}`;
}

// About you: name and headline, contact, the photo, and a summary if there is none yet
// the header, chosen on the page: it is headed by where you are, as the page's chip says
function aboutView(sel){
  const m = rec(), b = m.basics ?? {}, d = b.display ?? {}, Lg = L(), tr = trLabel();
  const where = `<div class="where hband" ${kc('about')}><span class="kb">${icon('about')}${h('career.step1')}</span></div>`;
  const photo = photoHtml({ rec: m, r: st().cur, a4: st().cur.format !== 'us-letter', url: b.image ? C.photoUrl() : '' });
  // in the page's order: the photo, the name, the headline, the contact
  return `${C.edit.depthHtml(sel)}${where}<span class="lbl">${h('career.about.photo')}</span>${photo}
    <h2 class="title">${h('career.about.name')}</h2>
    <div class="detbox" data-form="about" data-part="name">
      ${field('c-name', h('career.f.name'), sameLang() ? b.name : (textIn(d.name) || b.name), { right: tr, ph: sameLang() ? '' : b.name })}
      ${area('c-label', h('career.f.headline'), sameLang() ? b.label ?? textEn(d.label) : textIn(d.label), { right: tr, single: true, ph: textEn(d.label), miss: !sameLang() && d.label && !textIn(d.label) })}
    </div>
    ${d.label ? `<button type="button" class="newv inline press" data-tier="tertiary" data-act="c-sel-fact" data-fact="${esc(d.label)}">${withArrows(h('career.headlineVersions'))}</button>` : ''}
    <span class="lbl">${h('career.about.contact')}</span>
    <div class="detbox" data-form="about" data-part="contact">
      ${field('c-email', h('onb.email'), b.email, { type: 'email' })}${field('c-phone', h('onb.phone'), b.phone, { type: 'tel' })}
      ${field('c-city', h('onb.city'), b.location?.city)}${field('c-url', h('onb.website'), String(b.url ?? '').replace(/^https?:\/\//, ''))}
      ${jsonOnly(`${field('c-addr', h('career.f.address'), b.location?.address ?? '')}<div class="grid2">${field('c-postal', h('career.f.postalCode'), b.location?.postalCode ?? '')}${field('c-region', h('career.f.region'), b.location?.region ?? '')}</div>`)}
      ${field('c-rights', h('career.f.rights'), b.rights ?? '', { ph: t('career.f.rightsPh') })}
    </div>
    ${d.contact ? `<button type="button" class="newv inline press" data-tier="tertiary" data-act="c-sel-fact" data-fact="${esc(d.contact)}">${withArrows(h('career.contactVersions'))}</button>` : ''}
    <p class="note">${h('career.contactNote')}</p>
    ${b.summary ? '' : `<span class="lbl">${h('career.about.summary')}</span>
      <label class="field"><span class="lbl inline">${h('career.about.summary')}</span><textarea id="c-summary" rows="4" placeholder="${esc(t('career.summaryPh'))}"></textarea></label>
      <div class="btns"><button class="primary sm" data-act="c-add-summary">${h('ux2.addSummary')}</button></div>`}
    ${goesIn('header')}`;
}

// a skill group, a language, a certificate, a publication, an interest, a reference, an entry of a list kind
function itemView(group, id){
  const m = rec(), Lg = L(), tr = trLabel();
  const k = K.kindOf(m, group);
  const shell = (inner, { del = true, title, name, missing = false, n = null, versions = null, sid } = {}) =>
    `${crumb([{ t: t(`career.item.${group}`) }, { t: title }])}<div class="where hband" ${kc(group)}><span class="kb">${icon(look(group).icon)}${esc(t(`career.item.${group}`))}${n ? ` · ${esc(n)}` : ''}</span></div>
      <h2 class="title ${missing ? 'missing' : ''}">${esc(name)}</h2>
      <div class="detbox" data-form="item" data-group="${esc(group)}" data-id="${esc(id)}">${inner}</div>
      ${del ? `<div class="btns detacts"><span class="grow"></span>${delBtn(`data-act="c-del-item" data-group="${esc(group)}" data-id="${esc(id)}"`, t('career.delete'), { name: t('career.ctrlZ') })}</div>` : ''}
      ${versions ? C.edit.factPanel(versions) : ''}${goesIn(sid)}`;
  const sid = K.sectionFor(m, group, id);
  if (k){
    const store = k.store === 'awards' ? 'awards' : 'projects';
    const x = entryOf(store, id);
    if (!x) return '';
    const v = K.entryView(m, store, { ...x, id }, Lg);
    return `${crumb([{ t: K.kindName(m, group, Lg) }, { t: v.title }])}<div class="where hband" ${kc(group)}><span class="kb">${icon(look(group).icon)}${esc(K.kindName(m, group, Lg))}</span></div>
      <h2 class="title ${v.titleMissing ? 'missing' : ''}">${esc(v.title)}</h2>
      <div class="detbox" data-form="entry" data-key="${store}" data-id="${esc(id)}">${detailsForm(store, x, v)}</div>
      <div class="btns detacts"><span class="grow"></span>${delBtn(`data-act="c-del-entry" data-id="${esc(id)}"`, t('career.deleteEntry'), { name: t('career.ctrlZ') })}</div>${goesIn(sid)}`;
  }
  if (group === 'skills'){
    const s = (m.skills ?? []).find(x => x.id === id); if (!s) return '';
    const name = sameLang() ? s.name : m.i18n?.[Lg]?.labels?.[id] ?? '';
    const i = (m.skills ?? []).indexOf(s);
    return shell(`${field('c-gname', h('career.f.group'), name, { right: tr, miss: !name, ph: s.name })}
      <span class="lbl inline">${h('career.f.skills')}</span><div class="tags" id="c-kw">${(s.keywords ?? []).map((w, n) => `<span class="tag">${esc(w)}${delBtn(`data-act="c-kw-rm" data-n="${n}"`, t('edit.removeTag', { tag: w }), { text: false })}</span>`).join('')}<input id="c-kw-in" placeholder="${esc(t('career.f.skillPh'))}" aria-label="${esc(t('career.f.skillPh'))}"></div>
      ${jsonOnly(field('c-slevel', h('career.f.skillLevel'), s.level ?? '', { right: shared(), ph: t('career.f.skillLevelPh') }))}`,
    { title: name || s.name, name: name || s.name, missing: !name, n: t('career.iOfN', { i: i + 1, n: m.skills.length }), versions: id, sid });
  }
  if (group === 'languages'){
    const l = (m.languages ?? []).find(x => x.id === id); if (!l) return '';
    const name = sameLang() ? l.language : m.i18n?.[Lg]?.terms?.[id] ?? '';
    return shell(`${field('c-lname', h('career.f.language'), name, { right: tr, miss: !name, ph: l.language })}
      <label class="field"><span class="lbl inline"><span class="lt">${h('career.f.level')}</span></span><select id="c-level">${[...new Set([...K.LEVELS, l.fluency].filter(Boolean))].map(v => `<option ${v === l.fluency ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`,
    { title: name || l.language, name: name || l.language, missing: !name, versions: id, sid });
  }
  if (group === 'certificates'){
    const c = (m.certificates ?? []).find(x => x.id === id); if (!c) return '';
    return shell(`${field('c-cname', h('career.f.name'), c.name)}${field('c-issuer', h('career.f.issuer'), c.issuer ?? '')}
      <div class="grid2">${field('c-date', h('career.f.date'), ym(c.date), { type: 'month' })}${field('c-expires', h('career.f.expires'), ym(c.expires), { type: 'month' })}</div>
      ${field('c-url', h('career.f.link'), c.url ?? '', { ph: 'https://…' })}`, { title: c.name, name: c.name, sid });
  }
  if (group === 'publications'){
    const p = (m.publications ?? []).find(x => x.id === id); if (!p) return '';
    const name = sameLang() ? p.name : K.fieldIn(m, Lg, K.fieldPath('publications', id, 'name')) || textIn(p.display?.name);
    return shell(`${field('c-pname', h('career.f.title'), name, { right: tr, miss: !name, ph: p.name })}${field('c-publisher', h('career.f.publisher'), p.publisher ?? '', { right: shared() })}
      ${field('c-date', h('career.f.date'), ym(p.releaseDate), { type: 'month' })}
      ${jsonOnly(`${field('c-url', h('career.f.link'), p.url ?? '', { right: shared(), ph: 'https://…' })}${area('c-psum', h('career.f.description'), p.summary ?? '', { right: shared() })}`)}`,
    { title: name || p.name, name: name || p.name, missing: !name, versions: p.display?.name ?? null, sid });
  }
  if (group === 'interests'){
    const i = (m.interests ?? []).find(x => x.id === id); if (!i) return '';
    const name = sameLang() ? i.name : textIn(id);
    return shell(field('c-iname', h('career.f.interest'), name, { right: tr, miss: !name, ph: i.name }), { title: name || i.name, name: name || i.name, missing: !name, sid });
  }
  if (group === 'references'){
    const r = (m.references ?? []).find(x => x.id === id); if (!r) return '';
    const text = textIn(id);
    return shell(`${field('c-rname', h('career.f.refName'), r.name, { right: shared() })}
      ${area('c-rtext', h('career.f.refText'), text, { right: tr, ph: sameLang() ? t('career.f.refPh') : textEn(id), rows: 3 })}<p class="note">${h('career.refNote')}</p>`,
    { title: r.name, name: r.name, sid });
  }
  return '';
}

function addView(what){
  const m = rec();
  const k = K.kindOf(m, what);
  const tr = trLabel();
  const cancel = `<button class="ghost sm" data-act="c-add-cancel">${h('btn.cancel')}</button>`;
  const head = title => `${crumb([{ t: t('career.add') }, { t: title }], { close: 'c-add-cancel' })}<div class="where hband" ${kc(k ? k.id : what)}><span class="kb">${icon(look(k ? k.id : what).icon)}${esc(title)}</span></div><h2 class="title">${esc(title)}</h2>`;
  const claims = `<label class="field"><span class="lbl inline"><span class="lt">${h('onb.claims')}</span></span><textarea id="c-claims" rows="4" placeholder="${esc(t('onb.claimsPh'))}"></textarea></label><p class="note">${h('onb.claimsNote')}</p>`;
  const go = label => `<div class="btns"><button class="primary sm" data-act="c-create" data-what="${esc(what)}">${esc(label)}</button>${cancel}</div>`;
  if (what === 'work') return `${head(t('career.newWork'))}
    ${field('c-pos', h('career.f.title'), '', { right: tr })}${field('c-org', h('career.f.employer'), '')}
    <div class="grid2">${field('c-start', h('career.f.started'), '', { type: 'month' })}${field('c-end', h('career.f.ended'), '', { type: 'month', present: true })}</div>
    ${field('c-loc', h('career.f.where'), '', { right: tr })}${claims}${go(t('career.addTheJob'))}`;
  if (what === 'education') return `${head(t('career.newEducation'))}
    ${field('c-org', h('career.f.institution'), '')}<div class="grid2">${field('c-type', h('onb.degree'), '', { ph: t('onb.degreePh') })}${field('c-area', h('onb.subject'), '')}</div>
    <div class="grid2">${field('c-start', h('career.f.started'), '', { type: 'month' })}${field('c-end', h('career.f.finished'), '', { type: 'month' })}</div>${field('c-hon', h('career.f.honours'), '')}${go(t('career.addIt'))}`;
  if (what === 'project' || (k && k.place === 'timeline')) return `${head(k ? t('career.newKindEntry', { kind: K.kindName(m, k.id, L()) }) : t('career.newProject'))}
    ${field('c-pos', k ? h('career.f.title') : h('career.f.project'), '', { right: tr })}${field('c-org', k ? esc(k.org) : h('career.f.with'), '', { ph: k ? '' : t('career.f.withPh') })}
    <div class="grid2">${field('c-start', h('career.f.started'), '', { type: 'month' })}${field('c-end', h('career.f.ended'), '', { type: 'month', present: true })}</div>
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

// A kind you made yourself. A new one is made with the button; an existing one changes as you go.
function kindState(id){
  if (W.kind?.id !== id || (W.kind.draft == null && id == null)) W.kind = { id, draft: null };
  return W.kind;
}
function kindView(id){
  const m = rec();
  const base = id ? K.kindOf(m, id) : null;
  const kd = kindState(id);
  const d = kd.draft ??= base ? structuredClone(base) : { name: { en: '' }, colour: 2, icon: 'star', place: 'timeline', org: t('career.f.org'), store: 'projects' };
  const Lg = L();
  const n = id ? K.entriesOfKind(m, id).length : 0;
  let out = `${crumb([{ t: t('career.add') }, { t: id ? t('career.editKind') : t('career.newKind') }], { close: 'c-kind-cancel' })}
    <h2 class="title">${esc(id ? K.kindName(m, id, Lg) : t('career.newKind'))}</h2>
    <p class="muted small">${h('career.kindIntro')}</p>`;
  if (!id) out += `<span class="lbl">${h('career.startFrom')}</span><div class="btns">${['volunteering', 'awards', 'talks', 'blank'].map(p => `<button class="sm" data-act="c-kind-preset" data-p="${p}" ${['volunteering', 'awards'].includes(p) && K.kindsOf(m).some(k => k.store === K.KIND_PRESETS[p].store) ? 'disabled' : ''}>${icon(K.KIND_PRESETS[p].icon)} ${h(`career.preset.${p}`)}</button>`).join('')}</div>`;
  out += `<div ${id ? 'data-form="kind"' : ''}>${field('kn-name', h('career.f.name'), d.name[Lg] ?? '', { right: trLabel(), ph: d.name.en || t('career.kindNamePh') })}</div>
    <span class="lbl inline">${h('career.colour')}</span><div class="sws">${SWATCH_HUES.map((c, i) => `<button class="swatch" data-act="c-kind-colour" data-i="${i}" style="background:var(--hue-${SWATCH_HUES[i]})" aria-pressed="${d.colour === i}" aria-label="${esc(t('career.colourN', { n: i + 1 }))}"></button>`).join('')}</div>
    <span class="lbl inline">${h('career.icon')}</span><div class="sws">${K.KIND_ICONS.map(ic => `<button class="iconb hic" data-act="c-kind-icon" data-i="${ic}" style="--hk:var(--hue-${SWATCH_HUES[d.colour % 6]})" aria-pressed="${d.icon === ic}" aria-label="${esc(t(`career.iconName.${ic}`))}">${icon(ic)}</button>`).join('')}</div>`;
  out += id ? `<p class="note">${h(d.place === 'list' ? 'career.placeList' : 'career.placeTimeline')}</p>`
    : `<span class="lbl inline">${h('career.writeBullets')}</span>
    <label class="opt"><input type="radio" name="kplace" data-kplace="timeline" ${d.place === 'timeline' ? 'checked' : ''} ${d.store !== 'projects' ? 'disabled' : ''}> ${h('career.placeYes')}</label>
    <label class="opt"><input type="radio" name="kplace" data-kplace="list" ${d.place === 'list' ? 'checked' : ''} ${d.store !== 'projects' ? 'disabled' : ''}> ${h('career.placeNo')}</label>`;
  out += `<div ${id ? 'data-form="kind"' : ''}>${field('kn-org', h('career.orgCalled'), d.org, { ph: t('career.orgPh') })}</div>
    <p class="note">${h('career.kindSection')}</p>
    <div class="btns">${id ? '' : `<button class="primary sm" data-act="c-kind-save">${h('career.createKind')}</button>`}
      ${id ? `<span class="grow"></span>${delBtn('data-act="c-kind-del"', t('career.deleteKind'))}` : ''}</div>`;
  if (id && W.delKind){      // two steps: a kind takes its entries with it (or they move): Move them, Cancel, Delete them
    const others = [...(d.place === 'timeline' ? [['project', t('career.kind.project')]] : []), ...K.kindsOf(m).filter(k => k.id !== id && k.place === d.place).map(k => [k.id, K.kindName(m, k.id, Lg)])];
    out += delAskHtml(t('career.deleteKindAsk', { n }), 'data-act="c-kind-del-all"', t('career.deleteThem', { n }), 'data-act="c-kind-del-no"',
      others.length ? `<select id="kn-move">${others.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select><button class="sm" data-act="c-kind-del-move">${h('career.moveThem')}</button>` : '');
  }
  out += d.store === 'volunteer' ? `<p class="note">${h('career.storeVolunteer')}</p>` : d.store === 'awards' ? `<p class="note">${h('career.storeAwards')}</p>` : id ? `<p class="note">${h('career.storeProjects')}</p>` : '';
  return out;
}

// the inspector for a selection that is not a claim, a job or a section
function panel(sel){
  if (sel.kind === 'header') return aboutView(sel);
  if (sel.kind === 'add') return addView(sel.what);
  if (sel.kind === 'kind') return kindView(sel.id ?? null);
  if (sel.kind === 'record'){
    if (sel.what === 'entry') return educationView(sel.id);
    if (sel.what === 'item') return itemView(sel.group, sel.id);
    if (sel.what === 'jobtypes') return jobTypesHtml();
  }
  return '';
}

// ---- saving a form: when you leave a field, one undo step each ----
const say = res => {
  const kept = [res?.title === 'kept' && t('career.theTitle'), res?.meta === 'kept' && t('career.theLine'), res?.printed === 'kept' && t('career.theLine')].filter(Boolean);
  if (kept.length) C.toast(t('career.keptNote', { what: kept.join(t('career.and')) }));
};
const splitDegree = (text, e) => { const t0 = String(text ?? '').trim(); if (!e) return { studyType: t0 }; const st0 = e.studyType && t0.startsWith(e.studyType) ? e.studyType : t0.split(' ')[0]; return { studyType: st0, area: t0.slice(st0.length).trim() || e.area }; };
const keywordsNow = id => W.kwDraft ?? [...((rec().skills ?? []).find(s => s.id === id)?.keywords ?? [])];

function saveEntry(key, id){
  const Lg = L();
  let res;
  const end = val('c-end');      // empty is an open end: Present
  if (key === 'work') commit(d => { res = K.updateJob(d.record, id, { position: val('c-pos'), name: val('c-org'), startDate: val('c-start'), endDate: end, location: val('c-loc'), ...opt('url', 'c-wurl'), ...opt('description', 'c-wdesc'), ...opt('summary', 'c-wsum') }, Lg); }, t('undo.editJob'));
  else if (key === 'education') commit(d => { res = K.updateEducation(d.record, id, { ...(Lg === DEFAULT_LANG ? splitDegree(val('c-pos'), entryOf('education', id)) : { studyType: val('c-pos') }), institution: val('c-org'), startDate: val('c-start'), endDate: val('c-end'), score: val('c-hon'), ...opt('url', 'c-eurl'), ...opt('courses', 'c-courses') }, Lg); }, t('undo.editEntry'));
  else commit(d => { res = K.updateProject(d.record, id, { name: val('c-pos'), org: val('c-org'), startDate: val('c-start'), ...($('#c-end') ? { endDate: val('c-end') } : {}), ...($('#c-loc') ? { location: val('c-loc') } : {}), ...($('#c-url') ? { url: val('c-url') } : {}), ...($('#c-during') ? { during: val('c-during') } : {}), ...opt('description', 'c-desc') }, Lg); }, t('undo.editEntry'));
  if (res) say(res);
  if (res?.meta) ownDates(key, id, res);
}
// A changed date reaches every resume that prints the record's date line. One that prints it in its own words keeps them: the toast says
// how many, and "Use the dates" gives them the record's line (one undo step; a locked resume is left as it is).
function ownDates(key, id, res){
  const metaFact = entryOf(key, id)?.display?.meta;
  const others = d => [d.cur, ...(d.resumes ?? []).filter(r => r.id !== d.openId)];
  const n = metaFact ? ownWording(st().record, others(st()), metaFact).length : 0;
  if (!n || res.meta === 'kept') return;
  C.toast(t(n === 1 ? 'ux6f.ownDate' : 'ux6f.ownDates', { n }), '', false, false, { label: t('ux6f.useDates'), run: () => commit(d => { useRecordWording(d.record, others(d), metaFact); }, t('ux6f.undoUseDates'), t('ux6f.datesUsed'), true) });
}
function saveAbout(part){
  let res;
  const fields = part === 'name' ? { name: val('c-name'), label: val('c-label') } : { email: val('c-email'), phone: val('c-phone'), city: val('c-city'), url: val('c-url'), rights: val('c-rights'), ...opt('address', 'c-addr'), ...opt('postalCode', 'c-postal'), ...opt('region', 'c-region') };
  commit(d => { res = K.updateAbout(d.record, fields, L()); }, t('undo.editAbout'));
  if (res) say({ title: res.label, meta: res.contact });
}
function saveItem(group, id){
  const Lg = L();
  let res;
  if (group === 'skills') commit(d => { res = K.updateSkill(d.record, id, { name: val('c-gname'), keywords: keywordsNow(id), ...opt('level', 'c-slevel') }, Lg); }, t('undo.editItem'));
  if (group === 'languages') commit(d => { res = K.updateLanguage(d.record, id, { language: val('c-lname'), fluency: val('c-level') }, Lg); }, t('undo.editItem'));
  if (group === 'certificates') commit(d => { res = K.updateCertificate(d.record, id, { name: val('c-cname'), issuer: val('c-issuer'), date: val('c-date'), expires: val('c-expires'), url: val('c-url') }); }, t('undo.editItem'));
  if (group === 'publications') commit(d => { res = K.updatePublication(d.record, id, { name: val('c-pname'), publisher: val('c-publisher'), releaseDate: val('c-date'), ...opt('url', 'c-url'), ...opt('summary', 'c-psum') }, Lg); }, t('undo.editItem'));
  if (group === 'references') commit(d => { res = K.updateReference(d.record, id, { name: val('c-rname'), reference: val('c-rtext') }, Lg); }, t('undo.editItem'));
  if (group === 'interests') commit(d => { res = K.updateInterest(d.record, id, { name: val('c-iname') }, Lg); }, t('undo.editItem'));
  if (res) say(res);
}
function saveKindNow(){
  readKind();
  const d = W.kind?.draft, id = W.kind?.id;
  if (!id || !d) return;
  if (!String(d.name.en ?? '').trim() && L() !== DEFAULT_LANG) d.name.en = d.name[L()];
  if (!String(d.name.en ?? '').trim()){ C.toast(t('error.kindName'), 'warn'); return; }
  commit(x => { K.updateKind(x.record, id, d, recipes(x), x.cur); }, t('undo.editKind'));
}
function saveForm(form){
  const f = form.dataset;
  if (f.form === 'entry') saveEntry(f.key, f.id);
  else if (f.form === 'about') saveAbout(f.part);
  else if (f.form === 'item') saveItem(f.group, f.id);
  else if (f.form === 'kind') saveKindNow();
}

function readKind(){
  const d = W.kind?.draft;
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
  if (id) commit(x => { K.updateKind(x.record, id, d, recipes(x), x.cur); }, t('undo.editKind'), t('career.kindSaved'));
  else commit(x => { made = K.createKind(x.record, d); }, t('undo.newKind'), t('career.kindCreated', { name: d.name[L()] || d.name.en }));
  W.kind = null;
  if (made) C.select({ kind: 'add', what: made });
  else C.select({ kind: 'none' });
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
    commit(d => { id = K.addJob(d.record, { position: val('c-pos'), name: val('c-org'), startDate: val('c-start'), endDate: val('c-end'), location: val('c-loc'), bullets, lang: Lg }); }, t('undo.addJob'), t('career.jobAdded'));
    sel = id && { kind: 'job', id };
  } else if (what === 'education'){
    return import('../model/build.js').then(B => {
      let eid;
      commit(d => {
        if (!(d.record.education ?? []).length){ B.setEducation(d.record, { institution: val('c-org'), studyType: val('c-type'), area: val('c-area'), startDate: val('c-start'), endDate: val('c-end'), score: val('c-hon'), lang: Lg }); eid = d.record.education[0].id; }
        else { const e = { id: B.slug(`edu-${val('c-org')}`, new Set((d.record.education ?? []).map(x => x.id)), 'edu'), institution: val('c-org') || '—', studyType: val('c-type') || '—', area: val('c-area') || '—', ...(val('c-start') ? { startDate: val('c-start') } : {}), ...(val('c-end') ? { endDate: val('c-end') } : {}), ...(val('c-hon') ? { score: val('c-hon') } : {}) }; d.record.education.push(e); eid = e.id; }
      }, t('undo.addEducation'), t('career.educationAdded'));
      C.select(eid ? { kind: 'record', what: 'entry', key: 'education', id: eid } : { kind: 'none' });
      return true;
    });
  } else if (what === 'project' || (k && k.place === 'timeline')){
    const bullets = lines();
    if (k) commit(d => { id = K.addKindEntry(d.record, what, { name: val('c-pos'), org: val('c-org'), startDate: val('c-start'), endDate: val('c-end'), bullets, lang: Lg }); }, t('undo.addEntry'), t('career.entryAdded'));
    else commit(d => { id = K.addProject(d.record, { name: val('c-pos'), entity: val('c-org'), startDate: val('c-start'), endDate: val('c-end'), during: val('c-during') || null, bullets, lang: Lg }); }, t('undo.addEntry'), t('career.entryAdded'));
    sel = id && { kind: 'job', id };
  } else if (k){
    commit(d => { id = K.addKindEntry(d.record, what, { name: val('c-pos'), org: val('c-org'), startDate: val('c-start'), lang: Lg }); }, t('undo.addEntry'), t('career.entryAdded'));
    sel = id && { kind: 'record', what: 'item', group: what, id };
  } else if (what === 'skills'){
    commit(d => { id = K.addSkill(d.record, { name: val('c-gname'), keywords: val('c-kw') }, Lg); }, t('undo.addItem'), t('career.itemAdded'));
    sel = id && { kind: 'record', what: 'item', group: 'skills', id };
  } else if (what === 'languages'){
    commit(d => { id = K.addLanguage(d.record, { language: val('c-lname'), fluency: val('c-level') }, Lg); }, t('undo.addItem'), t('career.itemAdded'));
    sel = id && { kind: 'record', what: 'item', group: 'languages', id };
  } else if (what === 'certificates'){
    commit(d => { id = K.addCertificate(d.record, { name: val('c-cname'), issuer: val('c-issuer'), date: val('c-date') }); }, t('undo.addItem'), t('career.itemAdded'));
    sel = id && { kind: 'record', what: 'item', group: 'certificates', id };
  } else if (what === 'publications'){
    commit(d => { id = K.addPublication(d.record, { name: val('c-pname'), publisher: val('c-publisher'), identifier: val('c-ident'), role: val('c-role'), releaseDate: val('c-date') }, Lg); }, t('undo.addItem'), t('career.itemAdded'));
    sel = id && { kind: 'record', what: 'item', group: 'publications', id };
  } else if (what === 'interests'){
    commit(d => { id = K.addInterest(d.record, { name: val('c-iname') }, Lg); }, t('undo.addItem'), t('career.itemAdded'));
    sel = id && { kind: 'record', what: 'item', group: 'interests', id };
  } else if (what === 'references'){
    if (!val('c-rname').trim()){ $('#c-rname')?.focus(); return true; }
    commit(d => { id = K.addReference(d.record, { name: val('c-rname'), reference: val('c-rtext') }, Lg); }, t('undo.addItem'), t('career.itemAdded'));
    sel = id && { kind: 'record', what: 'item', group: 'references', id };
  }
  C.select(sel ?? { kind: 'none' });
  return true;
}

async function act(a, tg){
  if (!a.startsWith('c-')) return false;
  const m = rec();
  switch (a){
    case 'c-pop': W.pop = W.pop === 'add' ? null : 'add'; C.renderBody(); if (W.pop) setTimeout(() => document.querySelector('.addm button')?.focus(), 0); return true;
    case 'c-sel': {
      const key = tg.dataset.key, id = tg.dataset.id;
      C.select(key === 'education' ? { kind: 'record', what: 'entry', key, id } : { kind: 'job', id });
      return true;
    }
    case 'c-sel-fact': C.select({ kind: 'bullet', id: tg.dataset.fact, section: 'header' }); return true;
    case 'c-up': return true;
    case 'c-jt-add': {
      const el = $('#jt-new');
      if (commit(d => { K.addJobType(d.record, el?.value ?? ''); }, t('jt.undoNew'), t('jt.added'))){ C.renderBody(); setTimeout(() => $('.jtrow:last-of-type .jt-tag-in')?.focus(), 30); }
      return true;
    }
    case 'c-tag-add': {
      const el = $('#tag-new');
      if (commit(d => { K.addTag(d.record, el?.value ?? ''); }, t('ux2.undoTagNew'), t('ux2.tagAdded'))){ C.renderBody(); setTimeout(() => $('#tag-new')?.focus(), 30); }
      return true;
    }
    case 'c-tag-del': { const tag = tg.dataset.tag; if (commit(d => K.deleteTag(d.record, tag, [d.cur, ...(d.resumes ?? [])]), t('ux2.undoTagDelete'), t('ux2.tagDeleted'))) C.renderBody(); return true; }
    case 'c-jt-del': { const id = tg.dataset.id; if (commit(d => K.deleteJobType(d.record, id), t('jt.undoDelete'), t('jt.deleted'), true)) C.renderBody(); return true; }
    case 'c-jt-tag-rm': { const id = tg.dataset.id, tag = tg.dataset.tag; if (commit(d => K.removeJobTypeTag(d.record, id, tag), t('jt.undoTags'))) C.renderBody(); return true; }
    case 'c-arch-jobs': W.jobs = !W.jobs; C.renderBody(); return true;
    case 'c-arch-entry': case 'c-unarch-entry': {
      const id = tg.dataset.id, on = a === 'c-arch-entry';
      let res;
      commit(d => { res = on ? K.archiveEntry(d.record, id) : K.unarchiveEntry(d.record, id); }, t(on ? 'arch.undoArchiveJob' : 'arch.undoUnarchiveJob'));
      if (res?.changed){ C.toast(t(on ? 'arch.jobArchived' : 'arch.jobUnarchived')); if (on) C.select({ kind: 'none' }); C.renderBody(); }
      return true;
    }
    case 'c-arch-show': { const id = tg.dataset.id; if (W.shown.has(id)) W.shown.delete(id); else W.shown.add(id); C.renderBody(); return true; }
    case 'c-del-entry': {
      const id = tg.dataset.id;
      let res;
      if (!await askIfLocked(C.store.state, (m, rs) => K.deleteEntry(m, id, rs))) return true;
      commit(d => { res = K.deleteEntry(d.record, id, recipes(d)); }, t('undo.deleteEntry'));
      if (res){ C.toast(t('career.deletedEntry'), '', true); C.select({ kind: 'none' }); }
      return true;
    }
    case 'c-add-summary': {
      const text = val('c-summary').trim();
      if (!text) return true;
      const B = await import('../model/build.js');
      commit(d => { B.setSummary(d.record, text); }, t('undo.addSummary'));
      C.renderBody();
      return true;
    }
    case 'c-kw-rm': {
      const s = C.ui.sel; if (s.what !== 'item') return true;
      const kw = keywordsNow(s.id); kw.splice(Number(tg.dataset.n), 1); W.kwDraft = kw; saveItem('skills', s.id); W.kwDraft = null; return true;
    }
    case 'c-del-item': {
      const g = tg.dataset.group, id = tg.dataset.id;
      let res;
      if (!await askIfLocked(C.store.state, (m, rs) => K.deleteItem(m, g, id, rs))) return true;
      commit(d => { res = K.deleteItem(d.record, g, id, recipes(d)); }, t('undo.deleteItem'));
      if (res){ C.toast(t('career.deletedItem'), '', true); C.select({ kind: 'none' }); }
      return true;
    }
    case 'c-add': {
      const what = tg.dataset.what;
      W.pop = null;
      if (what === 'summary'){
        const b = rec().basics;
        if (b?.summary){ C.select({ kind: 'bullet', id: b.summary, section: 'summary' }); C.edit.startEdit('new'); }
        else C.select({ kind: 'header' });
        return true;
      }
      C.select({ kind: 'add', what });
      setTimeout(() => $('#body input, #body textarea')?.focus(), 30);
      return true;
    }
    case 'c-add-cancel': C.select({ kind: 'none' }); return true;
    case 'c-create': return create(tg.dataset.what);
    case 'c-kind-new': W.pop = null; W.kind = { id: null, draft: null }; C.select({ kind: 'kind', id: null }); return true;
    case 'c-kind-edit': W.pop = null; W.kind = { id: tg.dataset.id, draft: null }; W.delKind = null; C.select({ kind: 'kind', id: tg.dataset.id }); return true;
    case 'c-kind-cancel': W.kind = null; W.delKind = null; C.select({ kind: 'none' }); return true;
    case 'c-kind-preset': { const p = K.KIND_PRESETS[tg.dataset.p]; readKind(); W.kind.draft = { ...structuredClone(p), name: { ...W.kind.draft.name, en: p.name.en ? t(`career.preset.${tg.dataset.p}`) : W.kind.draft.name.en ?? '' }, org: p.org ? t(`career.presetOrg.${tg.dataset.p}`) : W.kind.draft.org }; if (L() !== DEFAULT_LANG && p.name.en) W.kind.draft.name[L()] = t(`career.preset.${tg.dataset.p}`); C.renderBody(); return true; }
    case 'c-kind-colour': readKind(); W.kind.draft.colour = Number(tg.dataset.i); if (W.kind.id) saveKindNow(); C.renderBody(); return true;
    case 'c-kind-icon': readKind(); W.kind.draft.icon = tg.dataset.i; if (W.kind.id) saveKindNow(); C.renderBody(); return true;
    case 'c-kind-save': return saveKind();
    case 'c-kind-del': W.delKind = true; C.renderBody(); return true;
    case 'c-kind-del-no': W.delKind = null; C.renderBody(); return true;
    case 'c-kind-del-move': case 'c-kind-del-all': {
      const id = W.kind.id, to = a === 'c-kind-del-move' ? val('kn-move') : null;
      let res;
      if (!await askIfLocked(C.store.state, (m, rs) => K.deleteKind(m, id, { moveTo: to, recipes: rs }))) return true;
      commit(d => { res = K.deleteKind(d.record, id, { moveTo: to, recipes: recipes(d) }); }, t('undo.deleteKind'));
      if (res){ C.toast(to ? t('career.kindMoved', { n: res.moved }) : t('career.kindDeleted', { n: res.deleted }), '', true); W.kind = null; W.delKind = null; C.select({ kind: 'none' }); }
      return true;
    }
  }
  return false;
}

function bind(body){
  body.addEventListener('change', e => {
    const el = e.target;
    const form = el.closest?.('[data-form]');
    if (el.classList?.contains('tag-name')){ const tag = el.dataset.tag; commit(d => K.renameTag(d.record, tag, el.value, [d.cur, ...(d.resumes ?? [])]), t('ux2.undoTagRename')); C.renderBody(); return; }
    if (el.classList?.contains('tag-merge')){ const tag = el.dataset.tag, into = el.value; if (into) commit(d => K.mergeTag(d.record, tag, into, [d.cur, ...(d.resumes ?? [])]), t('ux2.undoTagMerge'), t('ux2.tagMerged', { from: tag, into })); C.renderBody(); return; }
    if (el.classList?.contains('jt-label')){ const id = el.dataset.id; commit(d => K.renameJobType(d.record, id, el.value, [d.cur, ...(d.resumes ?? [])]), t('jt.undoRename')); C.renderBody(); return; }
    if (el.dataset.kplace && W.kind?.draft){ readKind(); W.kind.draft.place = el.dataset.kplace; C.renderBody(); return; }
    // a choice, a month, a tick: no caret to wait for
    if (form && (el.tagName === 'SELECT' || el.type === 'checkbox')) saveForm(form);
  });
  // leaving a field commits it
  body.addEventListener('focusout', e => {
    const el = e.target;
    const form = el.closest?.('[data-form]');
    if (!form || !(el.matches?.('input:not([type=checkbox]):not([type=radio]), textarea'))) return;
    if (el.id === 'c-kw-in') return;
    if (el.value !== el.defaultValue) saveForm(form);
  });
  body.addEventListener('keydown', e => {
    const el = e.target;
    const form = el.closest?.('[data-form]');
    if (form && el.matches?.('input:not([type=checkbox]):not([type=radio]), textarea') && el.id !== 'c-kw-in'){
      if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); el.value = el.defaultValue; el.blur(); return; }
      if (e.key === 'Enter' && !e.isComposing && !e.shiftKey && (el.tagName === 'INPUT' || el.hasAttribute('data-single'))){ e.preventDefault(); el.blur(); return; }
    }
    if (el.classList?.contains('jt-tag-in') && (e.key === 'Enter' || e.key === ',')){
      e.preventDefault();
      const id = el.dataset.id, v = el.value.trim();
      if (v && commit(d => K.addJobTypeTag(d.record, id, v), t('jt.undoTags'))){ C.renderBody(); setTimeout(() => document.querySelector(`.jt-tag-in[data-id="${CSS.escape(id)}"]`)?.focus(), 30); }
    }
    if (el.id === 'tag-new' && e.key === 'Enter'){ e.preventDefault(); $('[data-act=c-tag-add]')?.click(); return; }
    if (el.id === 'c-kw-in' && (e.key === 'Enter' || e.key === ',')){
      e.preventDefault();
      const v = el.value.trim(); if (!v) return;
      const s = C.ui.sel; if (s.what !== 'item') return;
      W.kwDraft = [...keywordsNow(s.id), v]; saveItem('skills', s.id); W.kwDraft = null;
      el.value = ''; C.renderBody();
    }
  });
  body.addEventListener('toggle', e => {
    const d = e.target;
    if (d.dataset?.det) W.det.set(d.dataset.det, d.open);
  }, true);
}

const api = {
  panel, act, bind, timelineHtml, addMenuHtml, detailsHtml,
  get lang(){ return L(); },
  get popOpen(){ return W.pop === 'add'; },
  get shownArchived(){ return W.shown; },
  get jobsArchived(){ return W.jobs; },
  closeMenus(){ if (W.pop){ W.pop = null; C.renderBody(); return true; } return false; },
  icon,
};
