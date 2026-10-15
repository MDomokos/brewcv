// The record as a checklist: the body of the Record tab (record.js), and the Outline of this resume (outlineHtml). One group
// for About you, one for each job and project, Education, Skills and credentials, and the custom kinds. In Record every group is
// open and the carets fold a long record. Every claim is listed, ticked or not; ticking puts the line on the page and unticking
// takes it off (edit.js setBullet, one undo step each). Nothing about the claims that are off is drawn on the page. The list is a
// plain run of checkboxes in tab order.

import { checklist, groupOf, groupsOfSection, sectionCounts, sectionsCustom, jobsCustom } from '../model/checklist.js';
import * as T from '../model/resume.js';
import { addClaimHtml, orderMarkHtml, moveButtonsHtml, sw } from './parts.js';
import { t, h } from '../i18n/index.js';
import { icon } from './icons.js';
import { ghost, fly, reduced, play } from './motion.js';

let C = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// What a tick does is shown once, on a line of the person's own resume (a line travels from its row to its place on the page), where a
// one-line hint used to say it (UX-2)
const HINT_KEY = 'rb-cl-hint';
const hintDone = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; } };
const setHintDone = () => { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* shown again next time */ } };

// shut: the Record's groups folded by hand. fold: the Outline's, by hand ('open' or 'shut'; the job in focus opens by itself).
// more: jobs whose lines that are off are shown. adding: the job whose "+ line" box is open.
const S = { shut: new Set(), fold: new Map(), more: new Set(), adding: null, pop: null, travel: null, moved: null };

export function initChecklist(ctx){ C = ctx; return api; }

const selAttr = sel => esc(JSON.stringify(sel));
const nOfM = (n, m) => t('ux2.nOfM', { n, m });

function caret(g, open, label, count){
  return `<button class="clcaret" data-act="cl-toggle" data-g="${esc(g.id)}" aria-expanded="${open}" aria-controls="clg-${esc(g.id)}"><span class="clc" aria-hidden="true">${icon('caret', { size: 14 })}</span><span class="clname">${label}</span><span class="clcount">${count}</span></button>`;
}
// A row that can be dragged, and so moved with ↑ ↓: a ticked bullet of a job, or an item of a list section. `move` says where it stands
// among those: { first, last }. A row that cannot move has no grip.
const bulletMovable = (r, g) => r.kind === 'claim' && r.on && !r.archived && !r.fixed && g?.kind === 'entry';
const moveKey = (r, g) => (r.item ? `i:${r.section}` : bulletMovable(r, g) ? `b:${g.id}` : null);
const rowsHtml = (rows, g) => {
  const keys = rows.map(r => moveKey(r, g));
  return rows.map((r, i) => rowHtml(r, g, { first: keys.indexOf(keys[i]) === i, last: keys.lastIndexOf(keys[i]) === i })).join('');
};
const isSel = r => { const s = C.ui.sel; return s.kind === r.sel.kind && s.id === r.sel.id && s.what === r.sel.what; };
function rowHtml(r, g, move){
  const label = t('ux2.tickLine', { text: r.text.slice(0, 80) });
  const box = r.noTick ? '<span class="cbnone" aria-hidden="true"></span>'
    : r.item ? `<input type="checkbox" class="cb" data-item="${esc(r.item)}" ${r.on ? 'checked' : ''} aria-label="${esc(label)}">`
    : r.kind === 'claim' && !r.fixed ? `<input type="checkbox" class="cb" data-on="${esc(r.id)}" ${r.on ? 'checked' : ''} aria-label="${esc(label)}">`
    : r.fixed ? `<input type="checkbox" class="cb" checked disabled aria-label="${esc(t('ux2.alwaysOn', { text: r.text.slice(0, 60) }))}">`
    : `<input type="checkbox" class="cb" ${r.on ? 'checked' : ''} disabled aria-label="${esc(t('ux2.printsWithSection', { text: r.text.slice(0, 60) }))}">`;
  const text = r.id === 'about:photo' ? t('career.about.photo') : r.text || t('ux2.empty');
  const drag = r.item ? `data-item="${esc(r.item)}" data-sec="${esc(r.section)}"` : bulletMovable(r, g) ? `data-bullet="${esc(r.id)}" data-bjob="${esc(g.id)}"` : '';
  const grip = drag ? `<span class="clgrip" aria-hidden="true">${icon('grip')}</span>${moveButtonsHtml('cl-up', 'cl-down', r.item ?? r.id, text, move)}` : '';
  return `<li class="clrow ${r.on ? '' : 'is-off'} ${r.archived ? 'is-archived' : ''} ${isSel(r) ? 'is-sel' : ''}" data-fact="${esc(r.kind === 'claim' ? r.id : '')}" ${drag ? `${drag} draggable="true" title="${esc(t('ux2.dragItem'))}"` : ''}>
      ${box}<button class="clt" data-act="cl-open" data-sel="${selAttr(r.sel)}">${esc(text.replace(/\n/g, ' · '))}</button>
      ${r.nv ? `<button class="clv${r.nv > 1 ? ' many' : ''}" data-act="cl-edit" data-sel="${selAttr(r.vsel ?? r.sel)}" title="${esc(t('ux2.versionsN', { n: r.nv }))}">${esc(t('ux2.nv', { n: r.nv })).replace(/\s+/, '<span class="sp"> </span>')}</button>` : ''}
      ${r.archived ? `<span class="pill arch" title="${esc(t('arch.badgeTitle'))}">${h('arch.badge')}</span><button class="ghost sm" data-act="unarchive-claim" data-id="${esc(r.id)}">${h('arch.unarchive')}</button>` : ''}${grip}</li>`;
}

function groupHtml(g, open, ctx){
  const id = `clg-${esc(g.id)}`;
  const body = (inner, extra = '') => `<div class="clbody" id="${id}" ${open ? '' : 'hidden'}>${inner}${extra}</div>`;
  if (g.kind === 'about'){
    return `<section class="clg ${open ? 'open' : ''}" data-g="${esc(g.id)}"><h3 class="clgh">${caret(g, open, h('career.step1'), nOfM(g.on, g.total))}</h3>
      ${body(`<ul class="clrows">${rowsHtml(g.rows, g)}</ul>`)}</section>`;
  }
  if (g.kind === 'entry'){
    const title = `${esc(g.title)}${g.org ? `<span class="muted"> · ${esc(g.org)}</span>` : ''}`;
    const arch = g.archivedRows.length;
    const archOpen = ctx.shown.has(g.id);
    const head = `<h3 class="clgh">${caret(g, open, title, nOfM(g.on, g.total))}${orderMarkHtml(g.custom, 'job', g.id, g.title)}
        ${g.archived ? `<button class="ghost sm" data-act="c-unarch-entry" data-id="${esc(g.id)}">${h('arch.unarchiveJob')}</button>` : ''}</h3>`;
    return `<section class="clg ${open ? 'open' : ''} ${g.archived ? 'is-archived' : ''}" data-g="${esc(g.id)}">${head}
      ${body(`<ul class="clrows">${rowsHtml(g.rows, g)}</ul>
        <div class="clopen"><button class="sm ghost" data-act="cl-open" data-sel="${selAttr(g.sel)}">${h('ux2.openEntry')}</button></div>
        ${arch ? `<button class="sm ghost archmore" data-act="c-arch-show" data-id="${esc(g.id)}" aria-expanded="${archOpen}">${archOpen ? h('arch.hide') : h('arch.nArchived', { n: arch })}</button>${archOpen ? `<ul class="clrows">${g.archivedRows.map(r => rowHtml(r, g)).join('')}</ul>` : ''}` : ''}
        ${g.archived ? '' : addLineHtml(g)}`)}</section>`;
  }
  const sectionSwitch = (sid, on, name) => (sid ? `<label class="swl clsec"><input type="checkbox" class="sw" data-secon="${esc(sid)}" ${on ? 'checked' : ''} aria-label="${esc(t('edit.showX', { name }))}"><span class="tiny muted">${h('ux2.onResume')}</span></label>` : '');
  if (g.kind === 'education' || g.kind === 'list'){
    const name = g.kind === 'education' ? t('career.kind.education') : g.title;
    return `<section class="clg ${open ? 'open' : ''}" data-g="${esc(g.id)}"><h3 class="clgh">${caret(g, open, esc(name), nOfM(g.on, g.total))}${orderMarkHtml(g.custom, 'items', g.section, name)}</h3>
      ${body(`${sectionSwitch(g.section, g.sectionOn, name)}<ul class="clrows">${rowsHtml(g.rows, g)}</ul>`)}</section>`;
  }
  // skills and credentials: each list under the section that prints it
  return `<section class="clg ${open ? 'open' : ''}" data-g="${esc(g.id)}"><h3 class="clgh">${caret(g, open, h('ux2.groupCredentials'), nOfM(g.on, g.total))}</h3>
    ${body(g.subs.filter(s => s.rows.length).map(s => `<div class="clsub"><div class="clsubh"><b>${esc(t(`career.group.${s.id}`))}</b>${orderMarkHtml(s.custom, 'items', s.section, t(`career.group.${s.id}`))}${sectionSwitch(s.section, s.sectionOn, t(`career.group.${s.id}`))}</div>
        <ul class="clrows">${rowsHtml(s.rows, g)}</ul></div>`).join('')
      + `<div class="clopen"><button class="sm ghost" data-act="cl-open" data-sel="${selAttr({ kind: 'record', what: 'jobtypes' })}">${h('ux2.jobTypes')}</button></div>`)}</section>`;
}


// One "+ line" under a job: it opens the box that adds a claim (Enter or Add), where the six always-open boxes used to be.
const addLineHtml = g => (S.adding === g.id ? addClaimHtml({ id: g.id, key: g.key, draft: C.edit.claimDraftOf(g.id) })
  : `<button class="sm ghost addline" data-act="ol-addline" data-id="${esc(g.id)}">${h('ux5c.line')}</button>`);

// ---- the Outline: this resume in print order ----
// The sections as they print, each with its count; a job folds to its count and opens when the selected line is in it (or by hand,
// and then it stays); under an open job its lines that are on, "+ n more" for the ones that are off, and "+ line". Skills, Patent
// and the other lists fold to one row until opened. Every row has its tick, its grip and ↑ ↓ (checklist rows), and "n v" to open
// Edit at the line.
const folded = (key, forced) => { const f = S.fold.get(key); return f === 'open' || (f !== 'shut' && forced) ? false : true; };
const ocaret = (key, open, label, count = '') =>
  `<button class="clcaret ocaret" data-act="ol-toggle" data-g="${esc(key)}" aria-expanded="${open}" aria-controls="ol-${esc(key)}"><span class="clc" aria-hidden="true">${icon('caret', { size: 14 })}</span><span class="clname">${label}</span>${count ? `<span class="clcount">${count}</span>` : ''}</button>`;
// In a section's own view the job's name is the button that opens the job; the caret beside it only folds
const nameCaret = (g, open, count) =>
  `<button class="clcaret ocaret nameless" data-act="ol-toggle" data-g="${esc(g.id)}" aria-expanded="${open}" aria-controls="ol-${esc(g.id)}" aria-label="${esc(t('ux6c.fold', { name: g.title }))}"><span class="clc" aria-hidden="true">${icon('caret', { size: 14 })}</span></button>
   <button class="clname jobname" data-act="select-job" data-id="${esc(g.id)}">${esc(g.title)}${g.org ? `<span class="muted"> · ${esc(g.org)}</span>` : ''}</button><span class="clcount">${count}</span>`;

// `only`: a job's id, for the sidebar when that job is selected: just its lines (its own title and switch are above them)
export function outlineHtml(only = null, section = null){
  const m = C.work(), cur = C.cur();
  const cl = checklist(m, cur, C.lang());
  const list = T.sectionList(m, cur);
  const on = list.filter(s => s.on), off = list.filter(s => !s.on);
  const movable = on.filter(s => !s.fixed);
  const sel = C.ui.sel, focus = groupOf(m, sel);
  const focusSec = !focus ? null : T.sectionOfEntry(m, focus) ?? (focus === 'education' ? 'education' : sel.kind === 'record' && sel.what === 'item' ? T.sectionOfItem(m, sel.id) : cl.groups.find(g => g.id === focus)?.section ?? null);
  const about = cl.groups.find(g => g.id === 'about')?.rows ?? [];

  // a job's lines that print, "+ n more" for the ones that are off, and "+ line"
  const jobBody = g => {
    const byId = new Map(g.rows.map(r => [r.id, r]));
    const printed = g.printed.map(id => byId.get(id)).filter(Boolean), more = g.rows.filter(r => !r.on);
    const showMore = S.more.has(g.id);
    return `<ul class="clrows">${rowsHtml(printed, g)}</ul>
        ${more.length ? `<button class="sm ghost archmore" data-act="ol-more" data-id="${esc(g.id)}" aria-expanded="${showMore}">${h('ux5c.more', { n: more.length })}</button>${showMore ? `<ul class="clrows">${rowsHtml(more, g)}</ul>` : ''}` : ''}
        <button class="sm ghost addline" data-act="ol-newline" data-id="${esc(g.id)}">${h('ux5c.line')}</button>`;
  };
  const jobHtml = (g, isOn, move = null) => {
    if (!isOn) return `<div class="item row is-off ojob"><label class="swl"><input type="checkbox" class="sw" data-jobon="${esc(g.id)}" aria-label="${esc(t('edit.showX', { name: g.title }))}"></label><a class="t" data-act="select-job" data-id="${esc(g.id)}">${esc(g.title)}${g.org ? `<span class="muted"> · ${esc(g.org)}</span>` : ''}</a></div>`;
    const open = !folded(g.id, focus === g.id);
    // in a section's own view the job also has its tick; its name (nameCaret) opens it
    const pickJob = section ? sw(`data-jobon="${esc(g.id)}" aria-label="${esc(t('edit.showX', { name: g.title }))}"`, true) : '';
    const grip = move ? `<span class="clgrip" aria-hidden="true">${icon('grip')}</span>${moveButtonsHtml('job-up', 'job-down', g.id, g.title, move)}` : '';
    return `<section class="clg ${open ? 'open' : ''}" data-g="${esc(g.id)}"><h3 class="clgh" ${move ? `data-job="${esc(g.id)}" draggable="true" title="${esc(t('ux2.dragItem'))}"` : ''}>${section ? nameCaret(g, open, nOfM(g.on, g.total)) : ocaret(g.id, open, `${esc(g.title)}${g.org ? `<span class="muted"> · ${esc(g.org)}</span>` : ''}`, nOfM(g.on, g.total))}${orderMarkHtml(g.custom, 'job', g.id, g.title)}${pickJob}${grip}</h3>
      <div class="clbody" id="ol-${esc(g.id)}" ${open ? '' : 'hidden'}>${jobBody(g)}</div></section>`;
  };

  const bodyOf = s => {
    if (s.id === 'header') return `<ul class="clrows">${rowsHtml(about.filter(r => r.kind !== 'claim'), null)}</ul>`;
    if (s.id === 'summary') return `<ul class="clrows">${rowsHtml(about.filter(r => r.kind === 'claim'), null)}</ul>`;
    const gs = groupsOfSection(m, cl, s.id);
    if (gs[0]?.kind === 'entry'){
      const refs = T.jobRefs(m, cur, s.id).map(r => (typeof r === 'string' ? r : r.id));
      // the jobs of the record that print can be re-arranged; a project or an archived job that still prints keeps its place
      const on = refs.map(id => gs.find(g => g.id === id)).filter(Boolean), free = on.filter(g => m.work.some(w => w.id === g.id && !w.archived)).map(g => g.id);
      const head = jobsCustom(m, cur, s.id) ? `<div class="ordhead">${orderMarkHtml(true, 'jobs', s.id, C.sectionTitle(s.id))}</div>` : '';
      return head + on.map(g => jobHtml(g, true, free.includes(g.id) ? { first: g.id === free[0], last: g.id === free.at(-1) } : null)).join('') + gs.filter(g => !refs.includes(g.id)).map(g => jobHtml(g, false)).join('');
    }
    const rows = gs.flatMap(g => (g.kind === 'credentials' ? g.subs.filter(x => x.section === s.id).flatMap(x => x.rows) : g.rows));
    return rows.length ? `<ul class="clrows">${rowsHtml(rows, gs[0])}</ul>` : '';
  };

  const secHtml = s => {
    const counts = sectionCounts(m, cl, s.id);
    const isEntries = groupsOfSection(m, cl, s.id)[0]?.kind === 'entry';
    const foldable = s.id !== 'summary' && !isEntries;
    const open = !foldable || !folded(`sec:${s.id}`, focusSec === s.id);
    const title = esc(C.sectionTitle(s.id));
    const info = s.fixed ? h('edit.alwaysFirst') : counts ? esc(nOfM(counts.on, counts.total)) : '';
    const chosen = sel.kind === 'section' && sel.id === s.id;
    return `<div class="osec ${open ? 'open' : ''}" data-sid="${esc(s.id)}">
      <div class="item srow ${s.fixed ? 'fixed' : ''} ${chosen ? 'is-sel' : ''}" data-sid="${esc(s.id)}" ${s.fixed ? '' : 'draggable="true"'}>
        <span class="grip" aria-hidden="true">${s.fixed ? '' : icon('grip')}</span>
        ${foldable ? `<button class="osecaret" data-act="ol-toggle" data-g="sec:${esc(s.id)}" aria-expanded="${open}" aria-controls="ol-sec-${esc(s.id)}" aria-label="${title}"><span class="clc" aria-hidden="true">${icon('caret', { size: 14 })}</span></button>` : '<span class="osecaret"></span>'}
        <span class="stext"><a class="t" data-act="select-section" data-id="${esc(s.id)}">${title}</a><span class="muted tiny">${info}</span></span>
        ${s.fixed ? '' : moveButtonsHtml('sec-up', 'sec-down', s.id, C.sectionTitle(s.id), { first: s.id === movable[0].id, last: s.id === movable.at(-1).id })
          + sw(`data-secon="${esc(s.id)}" aria-label="${esc(t('edit.showX', { name: C.sectionTitle(s.id) }))}"`, true)}
      </div>
      <div class="obody" id="ol-sec-${esc(s.id)}" ${open ? '' : 'hidden'}>${bodyOf(s)}</div></div>`;
  };

  const onlyG = only && cl.groups.find(g => g.id === only && g.kind === 'entry');
  if (onlyG) return `<section class="outline only" id="outline" aria-label="${esc(t('ux5c.tabOutline'))}"><div class="clg open" data-g="${esc(only)}">${onlyG.custom ? `<div class="ordhead">${orderMarkHtml(true, 'job', only, onlyG.title)}</div>` : ''}<div class="clbody" id="ol-${esc(only)}">${jobBody(onlyG)}</div></div></section>`;
  // `section`: a section's id, for the sidebar when that section is selected: its jobs or items, with tick, grip and ↑ ↓
  if (section) return `<section class="outline only" id="outline" aria-label="${esc(t('ux5c.tabOutline'))}">${bodyOf({ id: section })}</section>`;
  const manual = Array.isArray(cur.pages);
  return `<section class="outline" id="outline" aria-label="${esc(t('ux5c.tabOutline'))}"><h2 class="sr">${h('ux5c.tabOutline')}</h2>
    ${orderMarkHtml(sectionsCustom(m, cur), 'sections', 'sections', t('edit.sectionsHere')) ? `<div class="ordhead">${orderMarkHtml(sectionsCustom(m, cur), 'sections', 'sections', t('edit.sectionsHere'))}</div>` : ''}
    <div class="list" id="seclist">${on.map(secHtml).join('')}</div>
    ${off.length ? `<p class="notonline" id="offline"><span class="muted small">${h('ux2.notOn')}</span> ${off.map(s => `<button class="tag offchip" data-act="section-on" data-id="${esc(s.id)}" draggable="true" data-sid="${esc(s.id)}" title="${esc(t('ux2.turnOnTitle'))}">${esc(C.sectionTitle(s.id))}</button>`).join(' ')}</p>` : ''}
    ${manual ? `<p class="note">${h('edit.dragManual')}</p>` : ''}</section>`;
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
    <div class="clcols">${live.map(g => groupHtml(g, isOpen(g), { shown: shownEntries })).join('')}</div>
    ${archived.length || C.career.jobsArchived ? `<button class="sm ghost archmore" data-act="c-arch-jobs" aria-expanded="${C.career.jobsArchived}">${C.career.jobsArchived ? h('arch.hideJobs') : h('arch.nJobs', { n: archived.length })}</button>${C.career.jobsArchived ? archived.map(g => groupHtml(g, isOpen(g), { shown: shownEntries })).join('') : ''}` : ''}
  </section>`;
}

function afterRender(){
  // the tick just made pops once, on its own line (the panel is redrawn on every tick, so the line is found again by what it is)
  if (S.pop && performance.now() < S.pop.until){
    const cb = document.querySelector(`#body .cb[${S.pop.attr}="${CSS.escape(S.pop.val)}"]:checked`);
    if (cb){ cb.classList.add('pop'); cb.addEventListener('animationend', () => cb.classList.remove('pop'), { once: true }); }
  }
  S.pop = null;
  // a row just moved flashes where it landed
  if (S.moved){
    const row = document.querySelector(`#body .clrow[data-bullet="${CSS.escape(S.moved)}"], #body .clrow[data-item="${CSS.escape(S.moved)}"], #body .clgh[data-job="${CSS.escape(S.moved)}"]`);
    S.moved = null;
    if (row) play(row, [{ backgroundColor: 'var(--mark-soft)' }, { backgroundColor: 'transparent' }], { name: 'row:moved', key: 'row-moved', ms: 'slow' });
  }
  const tr = S.travel;
  if (tr && tr.on === false && performance.now() < tr.until) arriveRow(tr);
  if (!hintDone() && document.querySelector('#body .clrow') && !C.ui.snap) sample();
}

// ---- a line travels between its row and its place on the page ----
// The tick has already changed the resume. Switched on: the line leaves its row and lands where the page now prints it (once the page
// has been drawn again: shell.js calls landed()). Switched off: it leaves where it was printed and lands on its row. A line that
// is not on the page, or no motion, travels nowhere.
const pill = (text, box) => ghost(box, `<span>${esc(text)}</span>`, 'mo-ghost mo-pill');
const rowBox = id => { const r = document.querySelector(`#body .clrow[data-fact="${CSS.escape(id)}"] .clt`)?.getBoundingClientRect(); return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null; };
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
  const row = [...document.querySelectorAll('#body .clrow:not(.is-off)[data-fact]')].find(r => r.dataset.fact && C.lineBox?.(r.dataset.fact));
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
    case 'cl-up': case 'cl-down': {
      if (tg.getAttribute('aria-disabled') === 'true') return true;
      const row = tg.closest('.clrow');
      S.moved = row.dataset.bullet ?? row.dataset.item;
      if (!C.edit.stepRow(row, a === 'cl-up' ? -1 : 1)) S.moved = null;
      return true;
    }
    case 'job-up': case 'job-down': {
      if (tg.getAttribute('aria-disabled') === 'true') return true;
      S.moved = tg.dataset.id;
      if (!C.edit.stepJob(tg.dataset.id, a === 'job-up' ? -1 : 1)) S.moved = null;
      return true;
    }
    // a click on a row: in the Outline it selects the line and the Outline stays; in the Record it opens Edit at the line
    case 'cl-open': {
      C.select(JSON.parse(tg.dataset.sel));
      // the panel's heading takes the focus, so the keyboard carries on in the inspector and Esc goes back out
      const title = document.querySelector('#body .title');
      if (title){ title.tabIndex = -1; title.focus({ preventScroll: true }); }
      return true;
    }
    // "n v": Edit at that line
    case 'cl-edit': C.select(JSON.parse(tg.dataset.sel), { pane: 'edit' }); return true;
    case 'ol-toggle': {
      const g = tg.dataset.g, open = tg.getAttribute('aria-expanded') === 'true';
      S.fold.set(g, open ? 'shut' : 'open');
      const body = document.getElementById(g.startsWith('sec:') ? `ol-sec-${g.slice(4)}` : `ol-${g}`);
      if (body){ body.hidden = open; tg.setAttribute('aria-expanded', String(!open)); tg.closest?.('.clg, .osec')?.classList.toggle('open', !open); }
      return true;
    }
    case 'ol-more': { const id = tg.dataset.id; if (S.more.has(id)) S.more.delete(id); else S.more.add(id); C.renderBody(); return true; }
    // a new empty line only on this resume, written at once
    case 'ol-newline': C.edit.addLine(tg.dataset.id); return true;
    case 'ol-addline': {
      S.adding = tg.dataset.id; C.renderBody();
      document.querySelector(`.new-claim[data-entry="${CSS.escape(S.adding)}"]`)?.focus();
      return true;
    }
  }
  return false;
}

function bind(body){
  body.addEventListener('change', e => {
    const cb = e.target;
    if (cb.matches?.('#body .cb') && cb.checked){
      const attr = cb.dataset.on !== undefined ? 'data-on' : cb.dataset.item !== undefined ? 'data-item' : null;
      S.pop = attr ? { attr, val: cb.getAttribute(attr), until: performance.now() + 1500 } : null;
    }
    if (cb.matches?.('#body .cb[data-on]')){
      setHintDone();
      const row = cb.closest('.clrow'), id = cb.dataset.on, clt = row?.querySelector('.clt')?.getBoundingClientRect();
      const text = row?.querySelector('.clt')?.textContent ?? '';
      // before the page is drawn again: the row's box going on, the line's box (where it is printed now) going off
      S.travel = { id, on: cb.checked, text, until: performance.now() + 1500, from: cb.checked ? (clt ? { left: clt.left, top: clt.top, width: clt.width, height: clt.height } : null) : C.lineBox?.(id) };
    }
  });
  const hover = id => C.hoverFact(id || null);
  body.addEventListener('mouseover', e => { const r = e.target.closest?.('#body .clrow[data-fact]'); if (r) hover(r.dataset.fact); });
  body.addEventListener('mouseout', e => { const r = e.target.closest?.('#body .clrow[data-fact]'); if (r && !r.contains(e.relatedTarget)) hover(null); });
  body.addEventListener('focusin', e => { const r = e.target.closest?.('#body .clrow[data-fact]'); if (r) hover(r.dataset.fact); });
  body.addEventListener('focusout', e => { const r = e.target.closest?.('#body .clrow[data-fact]'); if (r && !r.contains(e.relatedTarget)) hover(null); });
}

const api = { html, outlineHtml, act, bind, afterRender, landed };
