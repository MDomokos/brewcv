// Career, the place that holds the whole record, drawn left of the sidebar: the profile and the lists on top as cards, the timeline under them,
// newest first; the selected entry sits in the inspector (the sidebar's body) with its facts to edit and its lines to tick for the open resume.
// Both scopes are named there: a change to a fact or a line's words reaches every resume that prints it, a tick only the open one. The groups
// are checklist.js's; this module moves the selected one into the inspector after each draw. Search finds entries and lines (a match on a line
// selects its entry and marks the line). The tab, the page's job chip and Edit's "n of m on" links all arrive here and name the entry to show.
// A phone has no inspector: Career is the whole screen, every group open, and the entry asked for is scrolled to and marked for a moment.
// Pure view state; nothing here is undone or saved.

import { reduced } from './motion.js';
import { checklist as model } from '../model/checklist.js';
import { t, h } from '../i18n/index.js';

let C = null;
const FLASH_MS = 1600;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const phone = () => document.body.dataset.phone === 'true';

// sel: the entry in the inspector (undefined: the newest, null: none); q: the search; typing: the search keeps the caret over a redraw;
// goto and mark: the phone's entry to scroll to, and the ones to mark
const R = { q: '', sel: undefined, typing: false, goto: null, mark: [], timer: 0 };

export function initRecord(ctx){
  C = ctx;
  document.addEventListener('input', e => { if (e.target.id === 'rec-q'){ R.q = e.target.value; R.typing = true; C.renderBody(); } });
  document.addEventListener('keydown', e => {
    if (e.target.id !== 'rec-q' || e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    if (R.q){ R.q = ''; R.typing = true; C.renderBody(); } else e.target.blur();
  });
  return api;
}

const search = () => `<input id="rec-q" type="search" class="sw-q" autocomplete="off" aria-label="${esc(t('ux6h.searchCareer'))}" placeholder="${esc(t('ux6h.searchCareer'))}" value="${esc(R.q)}">`;
// the screen's back button is a phone's: on a desktop the place tabs are the way out
const view = () => `${phone() ? `<div class="scrbar"><button class="sm scrback" data-act="scr-back">${h('ux1.backToResume')}</button></div>` : ''}${C.checklist.html()}`;

// an entry matches by its own words or by any of its lines
function filter(cl, textOf){
  const q = R.q.trim().toLowerCase();
  const btns = [...cl.querySelectorAll('.rectl [data-grp]')];
  for (const b of btns) b.style.display = !q || b.textContent.toLowerCase().includes(q) || textOf.get(b.dataset.grp)?.includes(q) ? '' : 'none';
  for (const y of cl.querySelectorAll('.rectl .yr')){ const row = y.nextElementSibling; y.style.display = !q || (row && [...row.querySelectorAll('[data-grp]')].some(b => b.style.display !== 'none')) ? '' : 'none'; }
  const sel = btns.find(b => b.dataset.grp === R.sel);
  if (q && (!sel || sel.style.display === 'none')){ const first = btns.find(b => b.style.display !== 'none'); if (first) R.sel = first.dataset.grp; }
}

// Draw the place again: the toolbar and the cards, then the selected entry in the inspector
function afterRender(){
  C.checklist.afterRender();
  if (phone()) return goTo();
  const cl = document.getElementById('checklist'), bd = document.getElementById('body');
  if (!cl || !bd) return;
  const groups = [...cl.querySelectorAll('.clg')], rows = [...cl.querySelectorAll('.rectl [data-grp]')];
  const textOf = new Map(groups.map(g => [g.dataset.g, g.textContent.toLowerCase()]));
  const has = id => groups.some(x => x.dataset.g === id);
  if (R.sel !== null && !has(R.sel)) R.sel = rows.map(r => r.dataset.grp).find(has) ?? groups[0]?.dataset.g;
  // the toolbar: the search, the count and + Add; the place card has the name
  const head = cl.querySelector('.clhead');
  head?.classList.add('tbar');
  head?.querySelector('h2')?.classList.add('sr');
  head?.insertAdjacentHTML('afterbegin', search());
  // the parts the timeline does not list (About you, skills, languages ...) are cards on top, never under the timeline
  const listed = new Set(rows.map(r => r.dataset.grp));
  const more = groups.filter(g => !listed.has(g.dataset.g));
  const tl = cl.querySelector('.rectl');
  tl?.insertAdjacentHTML('afterbegin', `<div class="recmore">${more.map(g => `<button class="srow" data-act="rec-job" data-grp="${esc(g.dataset.g)}"><span class="t">${esc((g.querySelector('.clname')?.textContent ?? g.dataset.g).trim().replace(/\s+/g, ' '))}</span></button>`).join('')}</div>`);
  filter(cl, textOf);
  for (const r of cl.querySelectorAll('.rectl [data-grp]')) r.classList.toggle('is-sel', r.dataset.grp === R.sel);
  // the inspector: the selected entry's facts and lines, with the two scopes named
  const sel = groups.find(g => g.dataset.g === R.sel);
  if (!sel){ bd.innerHTML = `<section class="insp"><span class="lbl">${h('ux6h.career')}</span><p class="small muted">${h('ux6h.recPick', { name: C.openName() })}</p></section>`; return; }
  const facts = C.ui.ix?.work.get(R.sel) ? C.career.detailsHtml(R.sel) : '';
  const opens = sel.querySelector('[data-act=cl-open]')?.dataset.sel;      // the entry's own heading opens it in the editor
  bd.innerHTML = `<section class="insp insp-rec"><span class="lbl">${h('ux6h.entry')}</span>
    <h3 class="oi-name">${esc((sel.querySelector('.clname')?.textContent ?? '').trim().replace(/\s+/g, ' '))} <small class="muted">${esc((sel.querySelector('.clcount [aria-hidden]') ?? sel.querySelector('.clcount'))?.textContent ?? '')}</small></h3>
    ${opens ? `<button class="sm ghost insp-open" data-act="cl-open" data-sel="${esc(opens)}">${h('ux6h.openInEditor')}</button>` : ''}
    ${facts ? `<p class="scope">${h('ux6h.scopeAll')}</p><div class="recfacts">${facts}</div>` : ''}
    <p class="scope tickscope">${h('ux6h.scopeTick', { name: C.openName() })}</p></section>`;
  sel.classList.add('is-sel');
  bd.querySelector('.insp').append(sel);
  sel.querySelector('.clbody')?.removeAttribute('hidden');      // its fold is not offered here: the lines are always shown
  const q = R.q.trim().toLowerCase();
  if (q) for (const row of sel.querySelectorAll('.clrow')) row.classList.toggle('qhit', row.textContent.toLowerCase().includes(q));
}
// the search keeps the caret over a redraw (the shell calls this after it has put the focus back)
function refocus(){
  if (!R.typing) return;
  R.typing = false;
  const i = document.getElementById('rec-q'); if (!i) return;
  i.focus(); i.setSelectionRange(i.value.length, i.value.length);
}
// a phone: bring the entry asked for into view
function goTo(){
  if (!R.goto) return;
  const id = R.goto, mark = R.mark;
  R.goto = null; R.mark = [];
  const body = document.getElementById('body');
  const el = [...document.querySelectorAll('#checklist .clg')].find(x => x.dataset.g === id);
  if (!body || !el) return;
  const caret = el.querySelector('.clcaret[aria-expanded=false]');
  if (caret) caret.click();
  const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8;
  body.scrollTo({ top: Math.max(0, top), behavior: reduced() ? 'auto' : 'smooth' });
  for (const g of mark) [...document.querySelectorAll('#checklist .clg')].find(x => x.dataset.g === g)?.classList.add('is-asked');
  clearTimeout(R.timer);
  R.timer = setTimeout(() => document.querySelectorAll('#checklist .clg.is-asked').forEach(n => n.classList.remove('is-asked')), FLASH_MS);
}

// Show these entries of the record (the first is the one in the inspector). Opens Career if it is not open.
function open(groups = []){
  const ids = groups.filter(Boolean);
  if (ids[0]) R.sel = ids[0];
  R.goto = phone() ? ids[0] ?? null : null; R.mark = ids;
  if (C.ui.view === 'record'){ C.renderBody(); return; }
  C.setMode('record');
}
// Esc in Career: the search, then the selection (an open form closes first: its own Esc handler, before this one)
function clearSel(){ if (R.q){ R.q = ''; C.renderBody(); return; } if (R.sel !== null){ R.sel = null; C.renderBody(); } }

// the place card's second line: how many entries, and how many of the lines are on the open resume
function summary(){
  const cl = model(C.work(), C.cur(), C.lang());
  return t('ux6h.recSub', { n: cl.groups.filter(g => g.kind === 'entry' && !g.archived).length, on: cl.on, of: cl.total });
}

async function act(a, tg){
  switch (a){
    // a click on the timeline or a card: the entry opens in the inspector
    case 'rec-job': open([tg.dataset.grp || tg.dataset.id]); return true;
    // the page's job chip, and a section's "n of m on" in Edit: the groups are named in data-g, separated by commas
    case 'open-record': open((tg.dataset.g ?? '').split(',').map(x => x.trim())); return true;
  }
  return false;
}

const api = { view, afterRender, open, act, clearSel, summary, refocus, label: () => t('ux6h.placeCareer') };
