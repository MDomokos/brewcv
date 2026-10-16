// Career, the place that holds the whole record, drawn left of the sidebar. The timeline is open at the top, every group below it with all
// its lines (checklist.js draws them), and ticking a line changes the open resume. This module is the way in and the way round: the tab, the page's job chip and Edit's "n of m on" links all arrive here and name the group to show,
// a click on the timeline scrolls the list to that job, and the group that was asked for is marked for a moment.
// Pure view state; nothing here is undone or saved.

import { reduced } from './motion.js';
import { checklist as model } from '../model/checklist.js';
import { t, h } from '../i18n/index.js';

let C = null;
const FLASH_MS = 1600;

// the group to show once the panel has been drawn, and the groups to mark
const R = { goto: null, mark: [], timer: 0, left: null };

export function initRecord(ctx){ C = ctx; return api; }

// the strip's place is read just before the panel is drawn again; no strip yet means the tab is just being shown.
// Only a phone, where Career is the whole screen, has a way back of its own.
const view = () => { R.left = document.querySelector('#checklist .tl2')?.scrollLeft ?? null; return `${document.body.dataset.phone === 'true' ? `<div class="scrbar"><button class="sm scrback" data-act="scr-back">${h('ux1.backToResume')}</button></div>` : ''}${C.checklist.html()}`; };

// Draw the panel again, and then bring the group asked for into view.
function afterRender(){
  C.checklist.afterRender();
  const tl = document.querySelector('#checklist .tl2');
  if (tl) tl.scrollLeft = R.left ?? tl.scrollWidth;       // the newest year is in view when the tab is shown, else where the user left it
  if (!R.goto) return;
  const id = R.goto, mark = R.mark;
  R.goto = null; R.mark = [];
  const body = document.getElementById('checklist')?.closest('#scr, #body');
  const el = [...document.querySelectorAll('#checklist .clg')].find(x => x.dataset.g === id);
  if (!body || !el) return;
  // an open group is the one asked for; a folded one opens
  const caret = el.querySelector('.clcaret[aria-expanded=false]');
  if (caret) caret.click();
  // the top of the group, just under the top of the panel
  const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8;
  body.scrollTo({ top: Math.max(0, top), behavior: reduced() ? 'auto' : 'smooth' });
  for (const g of mark){
    const n = [...document.querySelectorAll('#checklist .clg')].find(x => x.dataset.g === g);
    n?.classList.add('is-asked');
  }
  clearTimeout(R.timer);
  R.timer = setTimeout(() => document.querySelectorAll('#checklist .clg.is-asked').forEach(n => n.classList.remove('is-asked')), FLASH_MS);
}

// Show these groups of the record (the first is where the panel scrolls to). Opens the tab if it is not open.
function open(groups = []){
  const ids = groups.filter(Boolean);
  R.goto = ids[0] ?? null;
  R.mark = ids;
  if (C.ui.view === 'record'){ afterRender(); return; }
  C.setMode('record');
}

async function act(a, tg){
  switch (a){
    // a click on the timeline: the list scrolls to that job
    case 'rec-job': open([tg.dataset.grp || tg.dataset.id]); return true;
    // the page's job chip, and a section's "n of m on" in Edit: the groups are named in data-g, separated by commas
    case 'open-record': open((tg.dataset.g ?? '').split(',').map(x => x.trim())); return true;
  }
  return false;
}

// Esc in Career: an open form closes first (its own Esc handler, before this); then the focus leaves the list. Career has no other selection yet.
const clearSel = () => { if (document.activeElement?.closest?.('#scr')) document.activeElement.blur(); };

// the place card's second line: how many entries, and how many of the lines are on the open resume
function summary(){
  const cl = model(C.work(), C.cur(), C.lang());
  return t('ux6h.recSub', { n: cl.groups.filter(g => g.kind === 'entry' && !g.archived).length, on: cl.on, of: cl.total });
}

const api = { view, afterRender, open, act, clearSel, summary, label: () => t('ux6h.placeCareer') };
