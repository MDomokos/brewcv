// "On this resume": the record as a checklist at the bottom of the Edit panel. One group for About you, one for
// each job and project, Education, Skills and credentials, and the custom kinds. A group opens when it holds the
// selection; the others stay folded until you open them. Every claim is listed, ticked or not; ticking puts the
// line on the page and unticking takes it off (edit.js setBullet, one undo step each). Nothing about the
// claims that are off is drawn on the page. The list is a plain run of checkboxes in tab order.

import { checklist, groupOf } from '../model/checklist.js';
import { addClaimHtml } from './parts.js';
import { t, h } from '../i18n/index.js';
import { icon } from './icons.js';

let C = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const HINT_KEY = 'rb-cl-hint';
const hintDone = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; } };
const setHintDone = () => { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* shown again next time */ } };

const S = { open: new Set(), shut: null, scrollTo: false, hint: !hintDone() };

export function initChecklist(ctx){ C = ctx; return api; }

const selAttr = sel => esc(JSON.stringify(sel));
const nOfM = (n, m) => t('ux2.nOfM', { n, m });

function caret(g, open, label, count){
  return `<button class="clcaret" data-act="cl-toggle" data-g="${esc(g.id)}" aria-expanded="${open}" aria-controls="clg-${esc(g.id)}"><span class="clc" aria-hidden="true">${icon('caret', { size: 14 })}</span><span class="clname">${label}</span><span class="clcount">${count}</span></button>`;
}
function rowHtml(r, g){
  const label = t('ux2.tickLine', { text: r.text.slice(0, 80) });
  const box = r.noTick ? '<span class="cbnone" aria-hidden="true"></span>'
    : r.kind === 'claim' && !r.fixed ? `<input type="checkbox" class="cb" data-on="${esc(r.id)}" ${r.on ? 'checked' : ''} aria-label="${esc(label)}">`
    : r.fixed ? `<input type="checkbox" class="cb" checked disabled aria-label="${esc(t('ux2.alwaysOn', { text: r.text.slice(0, 60) }))}">`
    : `<input type="checkbox" class="cb" ${r.on ? 'checked' : ''} disabled aria-label="${esc(t('ux2.printsWithSection', { text: r.text.slice(0, 60) }))}">`;
  const text = r.id === 'about:photo' ? t('career.about.photo') : r.text || t('ux2.empty');
  return `<li class="clrow ${r.on ? '' : 'is-off'} ${r.archived ? 'is-archived' : ''}" data-fact="${esc(r.kind === 'claim' ? r.id : '')}">
      ${box}<button class="clt" data-act="cl-open" data-sel="${selAttr(r.sel)}">${esc(text.replace(/\n/g, ' · '))}</button>
      ${r.nv ? `<span class="clv" title="${esc(t('ux2.versionsN', { n: r.nv }))}">${esc(t('ux2.nv', { n: r.nv }))}</span>` : ''}
      ${r.archived ? `<span class="pill arch" title="${esc(t('arch.badgeTitle'))}">${h('arch.badge')}</span><button class="ghost sm" data-act="unarchive-claim" data-id="${esc(r.id)}">${h('arch.unarchive')}</button>` : ''}</li>`;
}

function groupHtml(g, open, ctx){
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
    return `<section class="clg ${open ? 'open' : ''} ${g.archived ? 'is-archived' : ''}" data-g="${esc(g.id)}"><h3 class="clgh">${caret(g, open, title, nOfM(g.on, g.total))}
        ${g.archived ? `<button class="ghost sm" data-act="c-unarch-entry" data-id="${esc(g.id)}">${h('arch.unarchiveJob')}</button>` : ''}</h3>
      ${body(`<ul class="clrows">${g.rows.map(r => rowHtml(r, g)).join('')}</ul>
        <div class="clopen"><button class="sm ghost" data-act="cl-open" data-sel="${selAttr(g.sel)}">${h('ux2.openEntry')}</button></div>
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

function html(){
  const cl = checklist(C.work(), C.cur(), C.lang());
  const sel = groupOf(C.work(), C.ui.sel);
  const shownEntries = C.career.shownArchived;
  const live = cl.groups.filter(g => !(g.kind === 'entry' && g.archived));
  const archived = cl.groups.filter(g => g.kind === 'entry' && g.archived);
  const isOpen = g => S.open.has(g.id) || (g.id === sel && S.shut !== g.id);
  return `<section class="checklist" id="checklist" aria-labelledby="cl-h">
    <div class="clhead"><h2 id="cl-h">${h('ux2.onThisResume')}</h2><span class="clall" id="cl-all">${nOfM(cl.on, cl.total)}</span><span class="grow"></span>
      <button class="sm" data-act="c-tl" aria-haspopup="dialog" aria-expanded="${C.career.tlOpen}">${icon('timeline', { size: 14 })} ${h('ux2.timeline')}</button>
      <button class="sm" data-act="c-pop" aria-haspopup="menu" aria-expanded="${C.career.popOpen}" id="c-add">${h('ux2.add')}</button></div>
    ${S.hint ? `<p class="clhint" role="note"><span>${h('ux2.hint')}</span><button class="ghost sm" data-act="cl-hint-ok" aria-label="${esc(t('ux2.hintOk'))}">✕</button></p>` : ''}
    ${C.career.popOpen ? C.career.addMenuHtml() : ''}
    ${live.map(g => groupHtml(g, isOpen(g), { shown: shownEntries })).join('')}
    ${archived.length || C.career.jobsArchived ? `<button class="sm ghost archmore" data-act="c-arch-jobs" aria-expanded="${C.career.jobsArchived}">${C.career.jobsArchived ? h('arch.hideJobs') : h('arch.nJobs', { n: archived.length })}</button>${C.career.jobsArchived ? archived.map(g => groupHtml(g, isOpen(g), { shown: shownEntries })).join('') : ''}` : ''}
  </section>`;
}

// the selection changed: its group opens, the others fold
function onSelect(sel, { scroll = false } = {}){
  const g = groupOf(C.work(), sel);
  S.open = new Set(g ? [g] : []);
  S.shut = null;
  S.scrollTo = scroll && !!g;
}
function afterRender(){
  if (S.scrollTo){
    S.scrollTo = false;
    document.querySelector('#checklist .clg.open')?.scrollIntoView({ block: 'nearest' });
  }
}

async function act(a, tg){
  switch (a){
    case 'cl-toggle': {
      const g = tg.dataset.g;
      const open = tg.getAttribute('aria-expanded') === 'true';
      if (open) S.open.delete(g); else S.open.add(g);
      // folding the group the selection is in has to stick: remember it as shut
      const body = document.getElementById(`clg-${g}`);
      if (body){ body.hidden = open; tg.setAttribute('aria-expanded', String(!open)); tg.closest('.clg')?.classList.toggle('open', !open); }
      if (open && groupOf(C.work(), C.ui.sel) === g) S.shut = g;
      return true;
    }
    case 'cl-open': {
      C.select(JSON.parse(tg.dataset.sel));
      // the panel's heading takes the focus, so the keyboard carries on in the inspector and Esc goes back out
      const title = document.querySelector('#body .title');
      if (title){ title.tabIndex = -1; title.focus({ preventScroll: true }); }
      return true;
    }
    case 'cl-hint-ok': S.hint = false; setHintDone(); C.renderBody(); return true;
  }
  return false;
}

function bind(body){
  body.addEventListener('change', e => { if (e.target.matches?.('#checklist .cb[data-on]') && S.hint){ S.hint = false; setHintDone(); } });
  const hover = id => C.hoverFact(id || null);
  body.addEventListener('mouseover', e => { const r = e.target.closest?.('#checklist .clrow[data-fact]'); if (r) hover(r.dataset.fact); });
  body.addEventListener('mouseout', e => { const r = e.target.closest?.('#checklist .clrow[data-fact]'); if (r && !r.contains(e.relatedTarget)) hover(null); });
  body.addEventListener('focusin', e => { const r = e.target.closest?.('#checklist .clrow[data-fact]'); if (r) hover(r.dataset.fact); });
  body.addEventListener('focusout', e => { const r = e.target.closest?.('#checklist .clrow[data-fact]'); if (r && !r.contains(e.relatedTarget)) hover(null); });
}

const api = { html, act, bind, onSelect, afterRender, get open(){ return S.open; } };
