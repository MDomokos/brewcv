// The record as a checklist: the body of the Record tab (record.js), and one compact group at the job level of Edit. One group
// for About you, one for each job and project, Education, Skills and credentials, and the custom kinds. In Record every group is
// open and the carets fold a long record. Every claim is listed, ticked or not; ticking puts the line on the page and unticking
// takes it off (edit.js setBullet, one undo step each). Nothing about the claims that are off is drawn on the page. The list is a
// plain run of checkboxes in tab order.

import { checklist, groupOf } from '../model/checklist.js';
import { addClaimHtml } from './parts.js';
import { t, h } from '../i18n/index.js';
import { icon } from './icons.js';
import { ghost, fly, reduced } from './motion.js';

let C = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// What a tick does is shown once, on a line of the person's own resume (a line travels from its row to its place on the page), where a
// one-line hint used to say it (UX-2)
const HINT_KEY = 'rb-cl-hint';
const hintDone = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; } };
const setHintDone = () => { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* shown again next time */ } };

const S = { shut: new Set(), pop: null, travel: null };

export function initChecklist(ctx){ C = ctx; return api; }

const selAttr = sel => esc(JSON.stringify(sel));
const nOfM = (n, m) => t('ux2.nOfM', { n, m });

function caret(g, open, label, count){
  return `<button class="clcaret" data-act="cl-toggle" data-g="${esc(g.id)}" aria-expanded="${open}" aria-controls="clg-${esc(g.id)}"><span class="clc" aria-hidden="true">${icon('caret', { size: 14 })}</span><span class="clname">${label}</span><span class="clcount">${count}</span></button>`;
}
function rowHtml(r, g){
  const label = t('ux2.tickLine', { text: r.text.slice(0, 80) });
  const box = r.noTick ? '<span class="cbnone" aria-hidden="true"></span>'
    : r.item ? `<input type="checkbox" class="cb" data-item="${esc(r.item)}" ${r.on ? 'checked' : ''} aria-label="${esc(label)}">`
    : r.kind === 'claim' && !r.fixed ? `<input type="checkbox" class="cb" data-on="${esc(r.id)}" ${r.on ? 'checked' : ''} aria-label="${esc(label)}">`
    : r.fixed ? `<input type="checkbox" class="cb" checked disabled aria-label="${esc(t('ux2.alwaysOn', { text: r.text.slice(0, 60) }))}">`
    : `<input type="checkbox" class="cb" ${r.on ? 'checked' : ''} disabled aria-label="${esc(t('ux2.printsWithSection', { text: r.text.slice(0, 60) }))}">`;
  const text = r.id === 'about:photo' ? t('career.about.photo') : r.text || t('ux2.empty');
  return `<li class="clrow ${r.on ? '' : 'is-off'} ${r.archived ? 'is-archived' : ''}" data-fact="${esc(r.kind === 'claim' ? r.id : '')}" ${r.item ? `data-item="${esc(r.item)}" data-sec="${esc(r.section)}" draggable="true" title="${esc(t('ux2.dragItem'))}"` : r.kind === 'claim' && r.on && !r.archived && !r.fixed && g?.kind === 'entry' ? `data-bullet="${esc(r.id)}" data-bjob="${esc(g.id)}" draggable="true" title="${esc(t('ux2.dragItem'))}"` : ''}>
      ${box}<button class="clt" data-act="cl-open" data-sel="${selAttr(r.sel)}">${esc(text.replace(/\n/g, ' · '))}</button>
      ${r.nv ? `<span class="clv${r.nv > 1 ? ' many' : ''}" title="${esc(t('ux2.versionsN', { n: r.nv }))}">${esc(t('ux2.nv', { n: r.nv })).replace(/\s+/, '<span class="sp"> </span>')}</span>` : ''}
      ${r.archived ? `<span class="pill arch" title="${esc(t('arch.badgeTitle'))}">${h('arch.badge')}</span><button class="ghost sm" data-act="unarchive-claim" data-id="${esc(r.id)}">${h('arch.unarchive')}</button>` : ''}</li>`;
}

function groupHtml(g, open, ctx, { compact = false } = {}){
  const id = `clg-${esc(g.id)}`;
  const body = (inner, extra = '') => `<div class="clbody" id="${id}" ${open ? '' : 'hidden'}>${inner}${extra}</div>`;
  if (g.kind === 'about'){
    return `<section class="clg ${open ? 'open' : ''}" data-g="${esc(g.id)}"><h3 class="clgh">${caret(g, open, h('career.step1'), nOfM(g.on, g.total))}</h3>
      ${body(`<ul class="clrows">${g.rows.map(r => rowHtml(r, g)).join('')}</ul>`)}</section>`;
  }
  if (g.kind === 'entry'){
    const title = `${esc(g.title)}${g.org ? `<span class="muted"> · ${esc(g.org)}</span>` : ''}`;
    const arch = g.archivedRows.length;
    const archOpen = ctx.shown.has(g.id);
    // at the job level the group is the job's own lines, always open, headed with the count
    const head = compact ? `<h3 class="clgh clcompact"><span class="clname">${h('ux3b.thisJob')}</span><span class="clcount">${nOfM(g.on, g.total)}</span></h3>`
      : `<h3 class="clgh">${caret(g, open, title, nOfM(g.on, g.total))}
        ${g.archived ? `<button class="ghost sm" data-act="c-unarch-entry" data-id="${esc(g.id)}">${h('arch.unarchiveJob')}</button>` : ''}</h3>`;
    return `<section class="clg ${open ? 'open' : ''} ${g.archived ? 'is-archived' : ''}" data-g="${esc(g.id)}">${head}
      ${body(`<ul class="clrows">${g.rows.map(r => rowHtml(r, g)).join('')}</ul>
        ${compact ? '' : `<div class="clopen"><button class="sm ghost" data-act="cl-open" data-sel="${selAttr(g.sel)}">${h('ux2.openEntry')}</button></div>`}
        ${arch ? `<button class="sm ghost archmore" data-act="c-arch-show" data-id="${esc(g.id)}" aria-expanded="${archOpen}">${archOpen ? h('arch.hide') : h('arch.nArchived', { n: arch })}</button>${archOpen ? `<ul class="clrows">${g.archivedRows.map(r => rowHtml(r, g)).join('')}</ul>` : ''}` : ''}
        ${g.archived ? '' : addClaimHtml({ id: g.id, key: g.key, draft: C.edit.claimDraftOf(g.id) })}`)}</section>`;
  }
  const sectionSwitch = (sid, on, name) => (sid ? `<label class="swl clsec"><input type="checkbox" class="sw" data-secon="${esc(sid)}" ${on ? 'checked' : ''} aria-label="${esc(t('edit.showX', { name }))}"><span class="tiny muted">${h('ux2.onResume')}</span></label>` : '');
  if (g.kind === 'education' || g.kind === 'list'){
    const name = g.kind === 'education' ? t('career.kind.education') : g.title;
    return `<section class="clg ${open ? 'open' : ''}" data-g="${esc(g.id)}"><h3 class="clgh">${caret(g, open, esc(name), nOfM(g.on, g.total))}</h3>
      ${body(`${sectionSwitch(g.section, g.sectionOn, name)}<ul class="clrows">${g.rows.map(r => rowHtml(r, g)).join('')}</ul>`)}</section>`;
  }
  // skills and credentials: each list under the section that prints it
  return `<section class="clg ${open ? 'open' : ''}" data-g="${esc(g.id)}"><h3 class="clgh">${caret(g, open, h('ux2.groupCredentials'), nOfM(g.on, g.total))}</h3>
    ${body(g.subs.filter(s => s.rows.length).map(s => `<div class="clsub"><div class="clsubh"><b>${esc(t(`career.group.${s.id}`))}</b>${sectionSwitch(s.section, s.sectionOn, t(`career.group.${s.id}`))}</div>
        <ul class="clrows">${s.rows.map(r => rowHtml(r, g)).join('')}</ul></div>`).join('')
      + `<div class="clopen"><button class="sm ghost" data-act="cl-open" data-sel="${selAttr({ kind: 'record', what: 'jobtypes' })}">${h('ux2.jobTypes')}</button></div>`)}</section>`;
}

// Record's body: "Your record", the count for the open resume, + Add; then every group, all open. `timeline` is career's, drawn above.
function html(){
  const cl = checklist(C.work(), C.cur(), C.lang());
  const shownEntries = C.career.shownArchived;
  const live = cl.groups.filter(g => !(g.kind === 'entry' && g.archived));
  const archived = cl.groups.filter(g => g.kind === 'entry' && g.archived);
  const isOpen = g => !S.shut.has(g.id);
  return `<section class="checklist" id="checklist" aria-labelledby="cl-h">
    <div class="clhead"><h2 id="cl-h">${h('ux3b.recordTitle')}</h2><span class="clall" id="cl-all">${nOfM(cl.on, cl.total)}</span><span class="grow"></span>
      <button class="sm" data-act="c-pop" aria-haspopup="menu" aria-expanded="${C.career.popOpen}" id="c-add">${h('ux2.add')}</button></div>
    ${C.career.popOpen ? C.career.addMenuHtml() : ''}
    ${C.timelineHtml ? `<div class="rectl">${C.timelineHtml()}</div>` : ''}
    ${live.map(g => groupHtml(g, isOpen(g), { shown: shownEntries })).join('')}
    ${archived.length || C.career.jobsArchived ? `<button class="sm ghost archmore" data-act="c-arch-jobs" aria-expanded="${C.career.jobsArchived}">${C.career.jobsArchived ? h('arch.hideJobs') : h('arch.nJobs', { n: archived.length })}</button>${C.career.jobsArchived ? archived.map(g => groupHtml(g, isOpen(g), { shown: shownEntries })).join('') : ''}` : ''}
  </section>`;
}

// At the job level of Edit: the job's own lines as one compact group, open, so a line can still be switched on or off beside the
// job. '' when the selection is not in a job.
function jobGroupHtml(){
  const id = groupOf(C.work(), C.ui.sel);
  if (!id) return '';
  const g = checklist(C.work(), C.cur(), C.lang()).groups.find(x => x.id === id && x.kind === 'entry');
  if (!g) return '';
  return `<section class="checklist compact" id="checklist" aria-label="${esc(t('ux3b.thisJob'))}">${groupHtml(g, true, { shown: C.career.shownArchived }, { compact: true })}</section>`;
}

function afterRender(){
  // the tick just made pops once, on its own line (the panel is redrawn on every tick, so the line is found again by what it is)
  if (S.pop && performance.now() < S.pop.until){
    const cb = document.querySelector(`#checklist .cb[${S.pop.attr}="${CSS.escape(S.pop.val)}"]:checked`);
    if (cb){ cb.classList.add('pop'); cb.addEventListener('animationend', () => cb.classList.remove('pop'), { once: true }); }
  }
  S.pop = null;
  const tr = S.travel;
  if (tr && tr.on === false && performance.now() < tr.until) arriveRow(tr);
  if (!hintDone() && document.getElementById('checklist') && !C.ui.snap) sample();
}

// ---- a line travels between its row and its place on the page ----
// The tick has already changed the resume. Switched on: the line leaves its row and lands where the page now prints it (once the page
// has been drawn again: shell.js calls landed()). Switched off: it leaves where it was printed and lands on its row. A line that
// is not on the page, or no motion, travels nowhere.
const pill = (text, box) => ghost(box, `<span>${esc(text)}</span>`, 'mo-ghost mo-pill');
const rowBox = id => { const r = document.querySelector(`#checklist .clrow[data-fact="${CSS.escape(id)}"] .clt`)?.getBoundingClientRect(); return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null; };
function arriveRow(tr){
  S.travel = null;
  const to = rowBox(tr.id);
  if (to && tr.from) fly(pill(tr.text, tr.from), tr.from, to, { key: 'tick', name: 'tick:back' });
}
function landed(){
  const tr = S.travel;
  if (!tr || tr.on !== true || performance.now() > tr.until) return;
  S.travel = null;
  const to = C.lineBox?.(tr.id);
  if (to && tr.from) fly(pill(tr.text, tr.from), tr.from, { ...to, height: Math.max(to.height, 14) }, { key: 'tick', name: 'tick:land' });
}
// the first time the checklist is on screen: one line of the open resume makes the trip, so the person sees what a tick does
function sample(){
  if (reduced()) return;
  const row = [...document.querySelectorAll('#checklist .clrow:not(.is-off)[data-fact]')].find(r => r.dataset.fact && C.lineBox?.(r.dataset.fact));
  if (!row) return;
  setHintDone();
  const id = row.dataset.fact, from = rowBox(id), to = C.lineBox(id), text = row.querySelector('.clt')?.textContent ?? '';
  if (from && to) fly(pill(text, from), from, { ...to, height: Math.max(to.height, 14) }, { key: 'tick', name: 'tick:sample' });
}

async function act(a, tg){
  switch (a){
    case 'cl-toggle': {
      const g = tg.dataset.g;
      const open = tg.getAttribute('aria-expanded') === 'true';
      if (open) S.shut.add(g); else S.shut.delete(g);
      const body = document.getElementById(`clg-${g}`);
      if (body){ body.hidden = open; tg.setAttribute('aria-expanded', String(!open)); tg.closest('.clg')?.classList.toggle('open', !open); }
      return true;
    }
    case 'cl-open': {
      C.select(JSON.parse(tg.dataset.sel));
      // the panel's heading takes the focus, so the keyboard carries on in the inspector and Esc goes back out
      const title = document.querySelector('#body .title');
      if (title){ title.tabIndex = -1; title.focus({ preventScroll: true }); }
      return true;
    }
  }
  return false;
}

function bind(body){
  body.addEventListener('change', e => {
    const cb = e.target;
    if (cb.matches?.('#checklist .cb') && cb.checked){
      const attr = cb.dataset.on !== undefined ? 'data-on' : cb.dataset.item !== undefined ? 'data-item' : null;
      S.pop = attr ? { attr, val: cb.getAttribute(attr), until: performance.now() + 1500 } : null;
    }
    if (cb.matches?.('#checklist .cb[data-on]')){
      setHintDone();
      const row = cb.closest('.clrow'), id = cb.dataset.on, clt = row?.querySelector('.clt')?.getBoundingClientRect();
      const text = row?.querySelector('.clt')?.textContent ?? '';
      // before the page is drawn again: the row's box going on, the line's box (where it is printed now) going off
      S.travel = { id, on: cb.checked, text, until: performance.now() + 1500, from: cb.checked ? (clt ? { left: clt.left, top: clt.top, width: clt.width, height: clt.height } : null) : C.lineBox?.(id) };
    }
  });
  const hover = id => C.hoverFact(id || null);
  body.addEventListener('mouseover', e => { const r = e.target.closest?.('#checklist .clrow[data-fact]'); if (r) hover(r.dataset.fact); });
  body.addEventListener('mouseout', e => { const r = e.target.closest?.('#checklist .clrow[data-fact]'); if (r && !r.contains(e.relatedTarget)) hover(null); });
  body.addEventListener('focusin', e => { const r = e.target.closest?.('#checklist .clrow[data-fact]'); if (r) hover(r.dataset.fact); });
  body.addEventListener('focusout', e => { const r = e.target.closest?.('#checklist .clrow[data-fact]'); if (r && !r.contains(e.relatedTarget)) hover(null); });
}

const api = { html, jobGroupHtml, act, bind, afterRender, landed };
