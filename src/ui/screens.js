// The Library place and its Compare mode (UX-6e, UX-6h). The Library holds every resume and every sent copy as a card with a picture of its
// first page (thumbs.js); one card is selected (the open resume at first: Enter on it opens it); tick any number and compare them in a table
// with a column for each. A card says where the resume came from ("under <parent>", or the closest one as a guess, for resumes made before
// parents were kept) and opens "What differs from <parent>". Both are drawn left of the sidebar (a phone: the whole screen); Esc goes up one
// level (Compare to the grid, then the selection), never to another place. The model is src/model/resumes.js; the row menu, rename, Duplicate
// and Delete are resumes.js's, and the resume list's search and views are here.

import * as RS from '../model/resumes.js';
import { jobTypeLabel } from '../model/focus.js';
import { pendingEdits } from '../model/resume.js';
import { t, h } from '../i18n/index.js';
import { pageSize } from './layout.js';
import { nameHtml } from './switcher.js';

let C = null, T = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const VIEW_KEY = 'rb-manage-view', VIEWS = ['type', 'date', 'company'];
const savedView = () => { try { const v = localStorage.getItem(VIEW_KEY); return VIEWS.includes(v) ? v : 'type'; } catch { return 'type'; } };
// ticked: resumes ("id") and sent copies ("id|snapshot"); cmp: what the compare screen shows, and the parent when it is "What differs";
// sel: the selected card (null: the open resume's)
const V = { q: '', view: savedView(), ticked: new Set(), cmp: [], parent: null, sel: null };
const phone = () => document.body.dataset.phone === 'true';
const selId = () => (V.sel && RS.savedOf(st(), V.sel) ? V.sel : st().openId);

export function initScreens(ctx, thumbs){ C = ctx; T = thumbs; return api; }
const st = () => C.store.state;
const label = RS.resumeLabel;

// ---- what a key names: a resume, or a sent copy of one ----
function itemOf(key){
  const [rid, sid] = key.split('|'), r = RS.savedOf(st(), rid);
  if (!r) return null;
  if (!sid) return { key, recipe: C.resumes.heldRecipe(rid), label: label(r) };
  const s = RS.snapshotsOf(r).find(x => x.id === sid);
  return s && { key, recipe: RS.snapshotRecipe(C.work(), s), label: t('ux6e.sentCopy', { name: label(r), date: sentDate(s) }) };
}
const sentDate = s => s.sends.at(-1)?.date || s.at.slice(0, 10);
const recipeOf = key => itemOf(key)?.recipe ?? null;
const ratio = format => { const { w, h: ph } = pageSize(format); return `${w} / ${ph}`; };
const thumb = (key, format) => `<span class="rthumb" data-thumb="${esc(key)}" style="aspect-ratio:${ratio(format)}"></span>`;

// ---- the Resumes screen ----
const metaOf = r => [r.jobType ? jobTypeLabel(st().record, r.jobType) : '', r.format === 'us-letter' ? t('paper.letter') : t('paper.a4'), (r.lang ?? 'en').toUpperCase(),
  r.pageLimit === 0 ? t('head.anyLength') : r.pageLimit ? t('resumes.pShort', { n: r.pageLimit }) : ''].filter(Boolean).join(' · ');
const tick = (key, name) => `<input type="checkbox" class="rtick" data-cmp="${esc(key)}" ${V.ticked.has(key) ? 'checked' : ''} aria-label="${esc(name)}">`;

function card(r, parentOfClosest){
  const open = r.id === st().openId, p = RS.parentOf(st(), r), guess = !p && parentOfClosest.get(r.id);
  const under = p ? t('ux6e.under', { name: label(p) }) : guess ? t('ux6e.closest', { name: label(guess.r) }) : '';
  const pend = pendingEdits(r).length;
  return `<article class="rcard ${open ? 'open' : ''} ${selId() === r.id ? 'sel' : ''} ${V.ticked.has(r.id) ? 'ticked' : ''}" data-rid="${esc(r.id)}">
    ${tick(r.id, t('ux6e.tick', { name: label(r) }))}
    <button class="thumbwrap" tabindex="-1" data-act="sw-open" data-id="${esc(r.id)}" aria-label="${esc(t('ux6e.open', { name: label(r) }))}" ${open ? 'aria-current="true"' : ''}>${thumb(r.id, r.format)}</button>
    <h4 class="rname">${C.resumes.renamingHere(r.id, 'screen') ? C.resumes.renameInput(r) : `<button class="rsel" data-act="scr-sel" data-id="${esc(r.id)}" aria-pressed="${selId() === r.id}">${nameHtml(label(r))}</button>`}${open ? ` <small class="muted">· ${h('ux6e.isOpen')}</small>` : ''}</h4>
    <p class="rmeta">${esc(metaOf(r))}</p>
    ${under ? `<p class="rmeta rfrom">${esc(under)}</p>` : ''}
    ${pend ? `<p class="rmeta rpend">${h('ux6e.pending', { n: pend })}</p>` : ''}
    ${RS.snapshotsOf(r).slice().reverse().map(s => `<div class="rsent">${tick(`${r.id}|${s.id}`, t('ux6e.tickSent', { name: label(r), date: sentDate(s) }))}<button class="snapline" data-act="sw-snap" data-id="${esc(r.id)}" data-sid="${esc(s.id)}">${esc(t('ux6e.sent', { to: RS.sendLabel(s.sends[0]) || t('ux1.noRecipient'), date: sentDate(s) }))}${s.sends.length > 1 ? ` +${s.sends.length - 1}` : ''}</button></div>`).join('')}
    <div class="racts"><button class="sm" data-act="sw-open" data-id="${esc(r.id)}">${h('ux6e.openBtn')}</button><button class="sm" data-act="rm-dup" data-id="${esc(r.id)}">${h('ux1.dup')}</button>${p || guess ? `<button class="sm" data-act="scr-differs" data-id="${esc(r.id)}">${h('ux6e.differs')}</button>` : ''}
      <span class="rcmore">${C.resumes.moreButton(r.id, 'screen')}${C.resumes.rowMenuHtml(r.id, 'screen')}</span></div>
  </article>`;
}
// a sent copy as a card of its own (the Date view)
function sentCard(e){
  const r = e.resume, key = `${r.id}|${e.snap.id}`, to = RS.sendLabel(e.send);
  return `<article class="rcard ${V.ticked.has(key) ? 'ticked' : ''}" data-rid="${esc(r.id)}">
    ${tick(key, t('ux6e.tickSent', { name: label(r), date: e.date }))}
    <button class="thumbwrap" tabindex="-1" data-act="sw-snap" data-id="${esc(r.id)}" data-sid="${esc(e.snap.id)}" aria-label="${esc(t('ux6e.open', { name: to || label(r) }))}">${thumb(key, e.snap.recipe.format)}</button>
    <h4 class="rname">${esc(to || t('ux1.noRecipient'))}${e.send.kind === 'outreach' ? ` <span class="pill">${h('ux1.outreach')}</span>` : ''}</h4>
    <p class="rmeta">${esc(e.date)} · ${esc(label(r))}</p>
  </article>`;
}

function listHtml(){
  const all = st().resumes ?? [], q = V.q.trim().toLowerCase();
  const list = all.filter(r => RS.matches(st().record, r, V.q) || (V.view === 'company' && q && RS.snapshotsOf(r).some(s => s.sends.some(x => String(x.company).toLowerCase().includes(q)))));
  if (!list.length) return `<p class="muted small swnone">${h(all.length ? 'ux1.noMatch' : 'ux1.noneYet')}</p>`;
  const model = C.work(), guess = new Map();
  for (const r of list) if (!RS.parentOf(st(), r)){ const c = RS.closestTo(st(), r, x => RS.printedIds(model, x)); if (c) guess.set(r.id, c); }
  const group = (name, cards) => `<h3 class="lbl">${esc(name)}</h3><div class="rgrid">${cards.join('')}</div>`;
  if (V.view === 'date') return RS.sendBands(RS.sendEvents(list)).map(b => `<h3 class="lbl">${esc(b.year || t('ux2.noDate'))}</h3><div class="rgrid">${b.events.map(e => (e.kind === 'saved' ? card(e.resume, guess) : sentCard(e))).join('')}</div>`).join('');
  if (V.view === 'company') return RS.byCompany(list).map(g => group(g.key ? g.label : t('ux2.noCompany'), g.rows.map(x => card(x.resume, guess)))).join('');
  return RS.grouped(st().record, list).map(g => group(g.type ? g.label : t('resumes.noType'), g.resumes.map(r => card(r, guess)))).join('');
}

function ticksHtml(){
  const n = V.ticked.size;
  return `<span class="muted small" id="scr-tickinfo" role="status">${h(n ? 'ux6e.ticked' : 'ux6e.tickHint', { n })}</span>
    <button class="sm primary" id="scr-cmp" data-act="scr-compare" ${n < 2 ? 'disabled' : ''}>${h('ux6e.compareN', { n })}</button>
    <button class="sm" data-act="scr-clear" ${n ? '' : 'disabled'}>${h('ux6e.clear')}</button>`;
}
function resumesView(){
  const n = (st().resumes ?? []).length;
  return `<section class="scrn" id="resumes" aria-labelledby="scr-h">
    <div class="scrhead">${phone() ? `<button class="sm scrback" data-act="scr-back">${h('ux1.backToResume')}</button>` : ''}<h2 id="scr-h" class="${phone() ? '' : 'sr'}">${h('ux1.manageTitle', { n })}</h2>
      <input id="scr-q" type="search" class="sw-q" aria-label="${esc(t('ux1.search'))}" placeholder="${esc(t('ux1.search'))}" value="${esc(V.q)}" autocomplete="off">
      <div class="seg" role="group" aria-label="${esc(t('ux2.manageViews'))}">${VIEWS.map(v => `<button data-act="scr-view" data-v="${v}" aria-pressed="${V.view === v}">${h(`ux2.view.${v}`)}</button>`).join('')}</div>
      <button class="sm swnew" data-act="sw-new">${h('ux1.newResume')}</button><span class="grow"></span><span class="scrticks" id="scr-ticks">${ticksHtml()}</span></div>
    <div id="scr-list">${listHtml()}</div></section>`;
}
function afterResumes(){ T.fill(document.getElementById('scr-list'), recipeOf); }
// a tick changes the header and the card, not the pictures
function refreshTicks(){
  document.getElementById('scr-ticks').innerHTML = ticksHtml();
  for (const c of document.querySelectorAll('#scr-list .rcard')) c.classList.toggle('ticked', V.ticked.has(c.querySelector('.rtick').dataset.cmp));
}
// the selection moves without redrawing the pictures
function paintSel(){
  for (const c of document.querySelectorAll('#scr-list .rcard')){
    const b = c.querySelector('.rsel'), on = !!b && b.dataset.id === selId();
    c.classList.toggle('sel', on); b?.setAttribute('aria-pressed', String(on));
  }
}
// Esc in the Library: the selection goes back to the open resume; then the ticks are cleared
function clearSel(){
  if (V.sel && V.sel !== st().openId){ V.sel = null; paintSel(); return; }
  if (V.ticked.size){ V.ticked.clear(); document.querySelectorAll('#scr-list .rtick').forEach(x => { x.checked = false; }); refreshTicks(); }
}

// ---- compare ----
function compareView(){
  const items = V.cmp.map(itemOf).filter(Boolean);
  const rows = RS.compareMany(C.work(), items.map(x => x.recipe));
  const cell = c => (typeof c === 'string' ? esc(c) : `<span title="${esc(c.text)}">${esc(c.label)}</span>`);
  const sum = V.parent ? (() => { const p = itemOf(V.parent.parent), c = itemOf(V.parent.child); return p && c ? { p, c, list: RS.differences(C.work(), p.recipe, c.recipe) } : null; })() : null;
  return `<section class="scrn" id="compare" aria-labelledby="scr-h">
    <div class="scrhead"><button class="sm scrback" data-act="scr-back">← ${h('ux6h.allResumes')}</button><h2 id="scr-h">${sum ? h('ux6e.differsTitle', { parent: label(RS.savedOf(st(), V.parent.parent)) }) : h('ux6e.cmpTitle', { n: items.length })}</h2></div>
    ${sum ? `<div class="diffsum">${sum.list.length ? `<ul>${sum.list.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : `<p>${h('ux6e.nothing')}</p>`}</div>` : ''}
    <div class="cmpscroll"><table class="cmp"><caption class="sr">${h('ux6e.cmpTitle', { n: items.length })}</caption>
      <thead><tr><th scope="col">${h('ux6e.cmpRow')}</th>${items.map(x => `<th scope="col"><span class="cname">${esc(x.label)}</span>${thumb(x.key, x.recipe.format)}
        <span class="racts">${x.key.includes('|') ? `<button class="sm" data-act="sw-snap" data-id="${esc(x.key.split('|')[0])}" data-sid="${esc(x.key.split('|')[1])}">${h('ux6e.openBtn')}</button>`
          : `<button class="sm" data-act="sw-open" data-id="${esc(x.key)}">${h('ux6e.openBtn')}</button><button class="sm" data-act="rm-dup" data-id="${esc(x.key)}">${h('ux1.dup')}</button>`}</span></th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.differs ? 'diff-row' : ''} ${r.kind}"><th scope="row" title="${esc(r.label)}">${esc(r.label.length > 46 ? r.label.slice(0, 45) + '…' : r.label)}</th>${r.cells.map(c => `<td>${cell(c)}</td>`).join('')}</tr>`).join('')}
      <tr class="setting"><th scope="row">${h('ux6e.rowPrinted')}</th>${items.map(x => `<td data-pagesof="${esc(x.key)}">…</td>`).join('')}</tr></tbody></table></div></section>`;
}
function afterCompare(){
  const sc = document.getElementById('compare');
  T.fill(sc, recipeOf, (key, e) => { const c = sc.querySelector(`[data-pagesof="${CSS.escape(key)}"]`); if (c) c.textContent = String(e.pages); });
}

// ---- acts ----
function compare(keys, parent = null){ V.cmp = keys; V.parent = parent; C.setView('compare'); }
async function act(a, tg){
  switch (a){
    case 'scr-view': V.view = tg.dataset.v; try { localStorage.setItem(VIEW_KEY, V.view); } catch { /* this session only */ } C.renderBody(); return true;
    case 'scr-sel': {
      const id = tg.dataset.id;
      if (selId() === id){ C.resumes.open(id); return true; }      // a second click, or Enter, on the selected card opens it
      V.sel = id; paintSel(); return true;
    }
    case 'scr-clear': V.ticked.clear(); document.querySelectorAll('#scr-list .rtick').forEach(x => { x.checked = false; }); refreshTicks(); return true;
    case 'scr-compare': if (V.ticked.size >= 2) compare([...V.ticked]); return true;
    case 'scr-differs': {
      const r = RS.savedOf(st(), tg.dataset.id);
      const p = RS.parentOf(st(), r) ?? RS.closestTo(st(), r, x => RS.printedIds(C.work(), x))?.r;
      if (p) compare([p.id, r.id], { parent: p.id, child: r.id });
      return true;
    }
  }
  return false;
}

function bind(body){
  body.addEventListener('change', e => {
    const key = e.target.dataset?.cmp;
    if (key === undefined) return;
    e.target.checked ? V.ticked.add(key) : V.ticked.delete(key);
    refreshTicks();
  });
  body.addEventListener('input', e => {
    if (e.target.id !== 'scr-q') return;
    V.q = e.target.value;
    document.getElementById('scr-list').innerHTML = listHtml(); afterResumes();
  });
  body.addEventListener('keydown', e => {
    if (e.target.id === 'scr-q' && e.key === 'Escape' && V.q){ e.preventDefault(); e.stopPropagation(); V.q = ''; e.target.value = ''; e.target.dispatchEvent(new Event('input', { bubbles: true })); }
    else if (e.target.id === 'scr-q' && e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); C.leave(); }
  });
}

// ---- the place card: the counts and the action of the place (its tab names it) ----
function placeCard(v, recSummary){
  const rs = st().resumes ?? [], sends = rs.reduce((n, r) => n + RS.snapshotsOf(r).length, 0);
  if (v === 'record') return `<p class="psub">${esc(recSummary)}</p>`;
  if (v === 'compare'){
    const d = RS.compareMany(C.work(), V.cmp.map(itemOf).filter(Boolean).map(x => x.recipe)).filter(r => r.differs).length;
    return `<div class="ptitle"><h2 id="pl-h">${h('ux6h.compare')}</h2></div><p class="psub">${h('ux6h.cmpSub', { n: V.cmp.length, d })}</p>`;
  }
  return `<p class="psub">${h('ux6h.counts', { n: rs.length, s: sends })}</p><div class="pacts"><button class="sm" data-act="sw-new">${h('ux1.newResume')}</button></div>`;
}

const api = { act, bind, compare, placeCard, clearSel, canCompare: () => V.cmp.length >= 2, focusSel: () => document.querySelector('#scr-list .rcard.sel .rsel'),
  views: { resumes: resumesView, compare: compareView }, after: { resumes: afterResumes, compare: afterCompare } };
