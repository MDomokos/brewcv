// Career, the place that holds the whole record, drawn left of the sidebar: its toolbar (the search, the language read, Expand all, + Add)
// and the career itself (careerview.js), whose sidebar follows what is open there. An entry asked for from elsewhere (the page's job chip,
// Edit's "n of m on" links) sits in the inspector instead, with its facts to edit and its lines to tick for the open resume, both scopes
// named, until Back. The groups are checklist.js's; this module moves the asked one into the inspector after each draw.
// A phone has no inspector: Career is the whole screen, every group open, and the entry asked for is scrolled to and marked for a moment.
// Pure view state; nothing here is undone or saved.

import { reduced } from './motion.js';
import { withArrows } from './icons.js';
import { t, h } from '../i18n/index.js';
import { F, careerHtml, resumesHtml, printsButton } from './find.js';
import { careerHits } from '../model/checklist.js';

let C = null;
const FLASH_MS = 1600;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const phone = () => document.body.dataset.phone === 'true';

// sel: the entry in the inspector (undefined: the newest, null: none); q: the search; typing: the search keeps the caret over a redraw;
// goto and mark: the phone's entry to scroll to, and the ones to mark
const R = { sel: null, typing: false, goto: null, mark: [], timer: 0 };
const BANK = '~bank';      // the card of the skill words: the bank, not a group of the checklist (careerbank.js)

export function initRecord(ctx){
  C = ctx;
  document.addEventListener('input', e => { if (e.target.id === 'rec-q'){ F.q = e.target.value; R.typing = true; C.renderBody(); } });
  document.addEventListener('keydown', e => {
    if (e.target.id !== 'rec-q' || e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    if (F.q){ F.q = ''; R.typing = true; C.renderBody(); } else e.target.blur();
  });
  return api;
}

const search = () => `<input id="rec-q" type="search" class="sw-q" autocomplete="off" aria-label="${esc(t('ux6h.searchCareer'))}" placeholder="${esc(t('ux6h.searchCareer'))}" value="${esc(F.q)}">`;
// the screen's back button is a phone's: on a desktop the place tabs are the way out. The checklist's groups are drawn (hidden) only while an
// entry is asked for, to be moved into the inspector.
const view = () => (phone() ? `<div class="scrbar"><button class="sm scrback" data-act="scr-back">${withArrows(h('ux1.backToResume'))}</button></div>${C.checklist.html()}`
  : `${C.view.toolbarHtml(search())}${careerHtml()}${resumesHtml()}${C.view.html(F.q)}${R.sel ? `<div hidden>${C.checklist.html()}</div>` : ''}`);

// Draw the place again: the toolbar and the cards, then the selected entry in the inspector
function afterRender(){
  if (phone()){ C.checklist.afterRender(); return goTo(); }
  place();
  C.checklist.afterRender();      // once the entry is in the inspector: a tick's pop and the line's travel find it there
}
function place(){
  const cl = document.getElementById('checklist'), bd = document.getElementById('body');
  if (!bd) return;
  if (R.sel === BANK){ bd.innerHTML = C.career.bankHtml(); return; }
  const groups = [...(cl?.querySelectorAll('.clg') ?? [])], has = id => groups.some(g => g.dataset.g === id);
  if (R.sel && !has(R.sel)) R.sel = [...(cl?.querySelectorAll('.rectl [data-grp]') ?? [])].map(r => r.dataset.grp).find(has) ?? groups[0]?.dataset.g ?? null;      // a group that is not an entry (a section's name): the newest entry
  const sel = R.sel && groups.find(g => g.dataset.g === R.sel);
  if (!sel){ R.sel = null; bd.innerHTML = C.view.sideHtml(); return; }
  // the inspector: the entry asked for, its facts and lines, with the two scopes named
  const found = F.q.trim() ? careerHits(C.work(), F.q) : [];      // a word in a version the entry does not print now still finds the entry
  const entry = C.ui.ix?.work.get(R.sel), facts = entry ? C.career.detailsHtml(R.sel) : '';
  const opens = sel.querySelector('[data-act=cl-open]')?.dataset.sel;      // the entry's own heading opens it in the editor
  bd.innerHTML = `<section class="insp insp-rec">${C.view.langSwitch()}<button type="button" class="ce-ctxback" data-act="rec-back">${h('cv.back')}</button><span class="lbl">${h('ux6h.entry')}</span>
    <h2 class="oi-name">${esc((sel.querySelector('.clname')?.textContent ?? '').trim().replace(/\s+/g, ' '))} <small class="muted">${esc((sel.querySelector('.clcount [aria-hidden]') ?? sel.querySelector('.clcount'))?.textContent ?? '')}</small></h2>
    ${opens ? `<button class="sm ghost insp-open" data-act="cl-open" data-sel="${esc(opens)}">${h('ux6h.openInEditor')}</button>` : ''}
    ${entry ? printsButton([...(entry.highlights ?? []), ...Object.values(entry.display ?? {})], (sel.querySelector('.clname')?.textContent ?? '').trim().replace(/\s+/g, ' '), { cls: 'insp-prints' }) : ''}
    ${facts ? `<p class="scope">${h('ux6h.scopeAll')}</p><div class="recfacts">${facts}</div>` : ''}</section>`;
  sel.classList.add('is-sel');
  const gh = sel.querySelector(':scope > .clgh');      // its heading is the title above: gone, unless it still has an order mark or Unarchive
  if (gh && !gh.querySelector(':scope > :not(.clcaret, .clname, .clcount, .clmid), :scope > .clmid > :not(.clcaret, .clname, .clcount)')) gh.remove();
  bd.querySelector('.insp').append(sel);
  sel.querySelector('.clbody')?.removeAttribute('hidden');      // its fold is not offered here: the lines are always shown
  const q = F.q.trim().toLowerCase();
  if (q) for (const row of sel.querySelectorAll('.clrow')) row.classList.toggle('qhit', row.textContent.toLowerCase().includes(q) || found.some(x => x.fact === row.dataset.fact));
}
// after the shell has put the scroll and the focus back: Career's own (the card clicked stays put, an add is brought into view), then the
// search keeps its caret over a redraw
function refocus(){
  if (!phone()) C.view.after();
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
  if (ids[0]){ C.view.solo(); R.sel = ids[0]; }
  R.goto = phone() ? ids[0] ?? null : null; R.mark = ids;
  if (C.ui.view === 'record'){ C.renderBody(); return; }
  C.setMode('record');
}
// Esc in Career: what is open there (careerview.js, before this), then the search, then the entry in the inspector
function clearSel(){ if (F.q){ F.q = ''; C.renderBody(); return; } if (R.sel !== null){ R.sel = null; C.renderBody(); } }

async function act(a, tg){
  if (a.startsWith('cv-')) return C.view.act(a, tg);
  switch (a){
    case 'rec-back': R.sel = null; C.renderBody(); return true;
    // a click on the timeline or a card: the entry opens in the inspector
    case 'rec-job': open([tg.dataset.grp || tg.dataset.id]); return true;
    // the page's job chip, and a section's "n of m on" in Edit: the groups are named in data-g, separated by commas
    case 'open-record': open((tg.dataset.g ?? '').split(',').map(x => x.trim())); return true;
  }
  return false;
}

const api = { view, afterRender, open, act, clearSel, refocus, release: () => { R.sel = null; }, label: () => t('ux6h.placeCareer') };
