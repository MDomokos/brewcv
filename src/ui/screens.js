// The Library place and its Compare mode (UX-6e, UX-6h). The Library holds every resume as a card with a picture of its first page
// (thumbs.js) and the information beside it; one card is selected (the open resume at first: Enter on it opens it, as a second click on it
// does); tick any number and compare them in a table with a column for each. Drawn left of the sidebar (a phone: the whole screen); Esc goes
// up one level (Compare to the grid, then the selection), never to another place. The model is src/model/resumes.js; the row menu, rename,
// Duplicate and Delete are resumes.js's, and the resume list's search and views are here.

import * as RS from '../model/resumes.js';
import { jobTypeLabel } from '../model/focus.js';
import { pendingEdits } from '../model/resume.js';
import { t, h } from '../i18n/index.js';
import { pageSize, computeLayout } from './layout.js';
import { play, reduced } from './motion.js';
import { nameHtml } from './switcher.js';

let C = null, T = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const VIEW_KEY = 'rb-manage-view', VIEWS = ['type', 'date', 'company'];
const savedView = () => { try { const v = localStorage.getItem(VIEW_KEY); return VIEWS.includes(v) ? v : 'type'; } catch { return 'type'; } };
// ticked: resumes ("id") and sent copies ("id|snapshot"); cmp: what Compare shows, and focus the row in the inspector;
// sel: the selected card (null: the open resume's); nj: the resume whose "Use for a new job" form is open; draft: what was typed in
// that form, per resume, kept until the copy is made
const V = { q: '', view: savedView(), ticked: new Set(), cmp: [], sel: null, nj: null, draft: new Map(), sentOnly: false, rows: [], focus: -1 };
const phone = () => document.body.dataset.phone === 'true';
const selId = () => (V.sel && RS.savedOf(st(), V.sel) ? V.sel : st().openId);

export function initScreens(ctx, thumbs){
  C = ctx; T = thumbs;
  // N and P step through the differences wherever the focus is, as long as it is not in a text box
  document.addEventListener('keydown', e => {
    if (C.view() !== 'compare' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, select, textarea') || (e.key !== 'n' && e.key !== 'p')) return;
    e.preventDefault(); stepDiff(e.key === 'n' ? 1 : -1);
  });
  return api;
}
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

// ---- the Library ----
const metaOf = r => [r.jobType ? jobTypeLabel(st().record, r.jobType) : '', r.format === 'us-letter' ? t('paper.letter') : t('paper.a4'), (r.lang ?? 'en').toUpperCase(),
  r.pageLimit === 0 ? t('head.anyLength') : r.pageLimit ? t('resumes.pShort', { n: r.pageLimit }) : ''].filter(Boolean).join(' · ');
const tick = (key, name) => `<input type="checkbox" class="rtick" data-cmp="${esc(key)}" ${V.ticked.has(key) ? 'checked' : ''} aria-label="${esc(name)}">`;
// newest first; the open resume counts as the newest, since opening it is its latest use
const recency = r => (r.id === st().openId ? '9999' : r.savedAt || '');
const newest = (a, b) => recency(b).localeCompare(recency(a));

// a phone has no inspector: its card keeps the sent copies and the actions
function phoneExtras(r){
  const p = RS.parentOf(st(), r), guess = !p && RS.closestTo(st(), r, x => RS.printedIds(C.work(), x));
  return `${RS.snapshotsOf(r).slice().reverse().map(s => `<div class="rsent">${tick(`${r.id}|${s.id}`, t('ux6e.tickSent', { name: label(r), date: sentDate(s) }))}<button class="snapline" data-act="sw-snap" data-id="${esc(r.id)}" data-sid="${esc(s.id)}">${esc(t('ux6e.sent', { to: RS.sendLabel(s.sends[0]) || t('ux1.noRecipient'), date: sentDate(s) }))}${s.sends.length > 1 ? ` +${s.sends.length - 1}` : ''}</button></div>`).join('')}
    <div class="racts"><button class="sm" data-act="sw-open" data-id="${esc(r.id)}">${h('ux6e.openBtn')}</button><button class="sm" data-act="rm-dup" data-id="${esc(r.id)}">${h('ux1.dup')}</button>${p || guess ? `<button class="sm" data-act="scr-differs" data-id="${esc(r.id)}">${h('ux6e.differs')}</button>` : ''}
      <span class="rcmore">${C.resumes.moreButton(r.id, 'screen')}${C.resumes.rowMenuHtml(r.id, 'screen')}</span></div>`;
}
function card(r){
  const open = r.id === st().openId, n = RS.snapshotsOf(r).length, role = r.role || '', company = r.company || '';
  return `<article class="rcard ${open ? 'open' : ''} ${r.id === selId() ? 'sel' : ''} ${V.ticked.has(r.id) ? 'ticked' : ''}" data-rid="${esc(r.id)}">
    ${tick(r.id, t('ux6e.tick', { name: label(r) }))}
    <span class="thumbwrap">${thumb(r.id, r.format)}</span>
    <h4 class="rname">${C.resumes.renamingHere(r.id, 'screen') ? C.resumes.renameInput(r) : `<button class="rsel" data-act="scr-sel" data-id="${esc(r.id)}" aria-pressed="${r.id === selId()}" ${open ? 'aria-current="true"' : ''}>${nameHtml(company && role ? company : label(r))}</button>`}</h4>
    ${company && role ? `<p class="rrole">${esc(role)}</p>` : ''}
    <p class="rmeta">${esc(metaOf(r))}</p>
    <p class="rbadges">${open ? `<span class="pill is-open">${h('ux6h.openNow')}</span>` : ''}${n ? `<span class="pill">${h('ux6h.sentN', { n })}</span>` : ''}</p>
    ${phone() ? phoneExtras(r) : ''}
  </article>`;
}

function listHtml(){
  const all = st().resumes ?? [], q = V.q.trim().toLowerCase();
  const list = all.filter(r => (RS.matches(st().record, r, V.q) || (q && RS.snapshotsOf(r).some(s => s.sends.some(x => String(x.company).toLowerCase().includes(q))))) && (!V.sentOnly || RS.snapshotsOf(r).length));
  if (!list.length) return `<p class="muted small swnone">${h(all.length ? 'ux1.noMatch' : 'ux1.noneYet')}</p>`;
  const group = (name, rs) => `<h3 class="lbl">${esc(name)} · ${rs.length}</h3><div class="rgrid">${rs.map(card).join('')}</div>`;
  const byNewest = gs => gs.map(g => ({ ...g, rs: g.rs.slice().sort(newest) })).sort((a, b) => newest(a.rs[0], b.rs[0]));
  if (V.view === 'date'){
    const years = new Map();
    for (const r of list.slice().sort(newest)){ const y = r.id === st().openId ? t('ux6h.now') : (r.savedAt || '').slice(0, 4) || t('ux2.noDate'); years.set(y, [...(years.get(y) ?? []), r]); }
    return [...years].map(([y, rs]) => group(y, rs)).join('');
  }
  if (V.view === 'company') return byNewest(RS.byCompany(list).map(g => ({ name: g.key ? g.label : t('ux2.noCompany'), rs: g.rows.map(x => x.resume) }))).map(g => group(g.name, g.rs)).join('');
  return byNewest(RS.grouped(st().record, list).map(g => ({ name: g.type ? g.label : t('resumes.noType'), rs: g.resumes }))).map(g => group(g.name, g.rs)).join('');
}

function ticksHtml(){
  const n = V.ticked.size;
  return n ? `<button class="sm primary" id="scr-cmp" data-act="scr-compare" ${n < 2 ? 'disabled' : ''}>${h('ux6e.compareN', { n })}</button><button class="sm" data-act="scr-clear">${h('ux6e.clear')}</button>`
    : `<span class="muted small" id="scr-tickinfo">${h('ux6h.tickHint')}</span>`;
}
// the toolbar floats at the top of the content (flow.css): never a bar across the window
function resumesView(){
  hidePreview(); endGrow();
  return `<section class="scrn" id="resumes" aria-label="${esc(t('ux6h.allResumes'))}">
    <div class="scrhead tbar">${phone() ? `<button class="sm scrback" data-act="scr-back">${h('ux1.backToResume')}</button>` : ''}
      <input id="scr-q" type="search" class="sw-q" aria-label="${esc(t('ux6h.search'))}" placeholder="${esc(t('ux6h.search'))}" value="${esc(V.q)}" autocomplete="off">
      <div class="seg" role="group" aria-label="${esc(t('ux2.manageViews'))}">${VIEWS.map(v => `<button data-act="scr-view" data-v="${v}" aria-pressed="${V.view === v}">${h(`ux2.view.${v}`)}</button>`).join('')}</div>
      <button class="sm" data-act="scr-sent" aria-pressed="${V.sentOnly}">${h('ux6h.sentOnly')}</button>
      <span class="scrticks" id="scr-ticks" role="status">${ticksHtml()}</span></div>
    <div id="scr-list">${listHtml()}</div></section>`;
}
function afterResumes(){
  // coming back: the new-job form is closed (what was typed is kept), and a selection made before another resume was opened is dropped
  if (V.seen !== st().openId){ V.sel = null; V.nj = null; V.seen = st().openId; }
  T.fill(document.getElementById('scr-list'), recipeOf);
  paintInspector();
}
// a tick changes the toolbar and the card, not the pictures
function refreshTicks(){
  document.getElementById('scr-ticks').innerHTML = ticksHtml();
  for (const c of document.querySelectorAll('#scr-list .rcard')) c.classList.toggle('ticked', V.ticked.has(c.querySelector('.rtick').dataset.cmp));
}
// the selection moves without redrawing the pictures
function paintSel(){
  for (const c of document.querySelectorAll('#scr-list .rcard')){
    const b = c.querySelector('.rsel'), on = c.dataset.rid === selId();
    c.classList.toggle('sel', on); b?.setAttribute('aria-pressed', String(on));
  }
}
// Esc in the Library: the new-job form closes (what was typed is kept); then the selection goes back to the open resume; then the ticks are cleared
function clearSel(){
  if (V.nj){ V.nj = null; paintInspector(); return; }
  if (V.sel && V.sel !== st().openId){ V.sel = null; paintInspector(); return; }
  if (V.ticked.size){ V.ticked.clear(); document.querySelectorAll('#scr-list .rtick').forEach(x => { x.checked = false; }); refreshTicks(); }
}

// ---- the inspector: the selected resume, or the open one, in the editor panel's place ----
function resumeInspector(){
  const r = RS.savedOf(st(), selId()); if (!r) return `<p class="muted">${h('ux1.noneYet')}</p>`;
  const open = r.id === st().openId, p = RS.parentOf(st(), r), snaps = RS.snapshotsOf(r);
  const guess = !p && RS.closestTo(st(), r, x => RS.printedIds(C.work(), x))?.r;
  const from = p || guess;
  const diffs = from ? RS.differences(C.work(), itemOf(from.id).recipe, itemOf(r.id).recipe) : [];
  const pend = pendingEdits(r).length;
  const sent = snaps.slice().reverse().map(s => `<li>${tick(`${r.id}|${s.id}`, t('ux6e.tickSent', { name: label(r), date: sentDate(s) }))}<button class="snapline" data-act="sw-snap" data-id="${esc(r.id)}" data-sid="${esc(s.id)}">${esc(t('ux6e.sent', { to: RS.sendLabel(s.sends[0]) || t('ux1.noRecipient'), date: sentDate(s) }))}${s.sends.length > 1 ? ` +${s.sends.length - 1}` : ''}</button></li>`).join('');
  const d = V.draft.get(r.id) ?? {};
  const nj = V.nj === r.id ? `<div class="njform" role="group" aria-label="${esc(t('ux6h.newJob'))}">
      <label>${h('ux6h.company')}<input id="nj-company" autocomplete="off" value="${esc(d.company ?? '')}"></label>
      <label>${h('ux6h.role')}<input id="nj-role" autocomplete="off" value="${esc(d.role ?? r.role ?? '')}"></label>
      <p class="small muted">${h('ux6h.njNote', { name: label(r) })}</p>
      <div class="btns"><button class="primary" data-act="nj-create" data-id="${esc(r.id)}">${h('ux6h.njCreate')}</button><button data-act="nj-cancel">${h('ux6h.cancel')}</button></div></div>` : '';
  const g = RS.glance(C.work(), itemOf(r.id).recipe);
  const more = (list, n) => (list.length > n ? `<details class="imore"><summary>${h('ux6h.more', { n: list.length - n })}</summary><ul>${list.slice(n).map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : '');
  return `<section class="insp insp-res" aria-label="${esc(label(r))}">
    <div class="ihero">
      <button class="ihpage" tabindex="-1" ${open ? 'data-act="place" data-p="editor"' : `data-act="sw-open" data-id="${esc(r.id)}"`} aria-label="${esc(t('ux6e.open', { name: label(r) }))}">${thumb(r.id, r.format)}</button>
    </div>
    <div class="ihcap"><span class="lbl">${h(open ? 'ux6h.openNow' : 'ux6h.selected')}</span><h2 class="oi-name">${esc(label(r))}</h2><p class="small">${esc(metaOf(r))}${pend ? ` · ${h('ux6e.pending', { n: pend })}` : ''}</p></div>
    ${nj || `<div class="btns iacts"><button class="primary" data-act="nj-open" data-id="${esc(r.id)}">${h('ux6h.newJob')}</button>${open ? `<button data-act="place" data-p="editor">${h('ux6h.keepEditing')}</button>` : `<button data-act="sw-open" data-id="${esc(r.id)}">${h('ux6e.openBtn')}</button>`}<span class="rcmore">${C.resumes.moreButton(r.id, 'screen')}${C.resumes.rowMenuHtml(r.id, 'screen')}</span></div>`}
    <span class="lbl">${h('ux6h.glance')}</span>
    <dl class="glance">
      ${g.pitch ? `<dt>${h('ux6h.pitch')}</dt><dd class="gpitch">${esc(g.pitch)}</dd>` : ''}
      ${g.jobs.length ? `<dt>${h('ux6h.jobs')}</dt><dd><ol class="gjobs">${g.jobs.map(j => `<li><span>${esc(j.name)}</span><small>${h('ux6h.lines', { n: j.n })}</small></li>`).join('')}</ol></dd>` : ''}
      ${g.skills ? `<dt>${h('ux6h.skills')}</dt><dd>${esc(g.skills)}</dd>` : ''}
    </dl>
    ${from ? `<span class="lbl">${h('ux6h.comesFrom')}</span><p class="small">${esc(p ? t('ux6e.under', { name: label(p) }) : t('ux6e.closest', { name: label(guess) }))}</p>` : ''}
    ${from ? `<span class="lbl">${h('ux6h.whatDiffers')}</span>${diffs.length ? `<ul class="oi-diff">${diffs.slice(0, 3).map(x => `<li>${esc(x)}</li>`).join('')}</ul>${more(diffs, 3)}` : `<p class="small muted">${h('ux6e.nothing')}</p>`}<button class="sm" data-act="scr-differs" data-id="${esc(r.id)}">${h('ux6h.compareParent')}</button>` : ''}
    <span class="lbl">${h('ux6h.sent')}</span>${snaps.length ? `<ul class="oi-sent">${sent}</ul>` : `<p class="small muted">${h('ux6h.notSent')}</p>`}
  </section>`;
}
// the inspector is drawn again when the selection or the form changes; the cards keep their pictures. A phone has none (its card has the actions).
function paintInspector(){
  paintSel();
  const bd = document.getElementById('body');
  if (phone() || !bd) return;
  const ae = document.activeElement, kept = bd.contains(ae) && ae.id ? { id: ae.id, a: ae.selectionStart, b: ae.selectionEnd } : null;
  bd.innerHTML = C.view() === 'compare' ? cmpInspector() : resumeInspector(); T.fill(bd, recipeOf);
  const n = kept && document.getElementById(kept.id);
  if (n){ n.focus({ preventScroll: true }); try { n.setSelectionRange(kept.a, kept.b); } catch { /* not a text box */ } }
}

// ---- the selected resume grows out of the inspector to where the editor shows its page, as you scroll over it; far enough, and it opens.
// It is drawn at its final size from the start and shrunk, so it stays sharp all the way. Scrolling back (or letting go early) returns it.
// Under reduced motion nothing grows: a click opens. ----
const X = { p: 0, ghost: null, from: null, to: null, id: null, idle: 0, raf: 0 };
const ease = p => p * p * (3 - 2 * p);
// where the editor will draw this resume's first page: its own layout, for this window
function pageRect(r, pages){
  const L = computeLayout({ vw: innerWidth, vh: innerHeight, format: r.format, pages, oneUp: r.pageLimit === 1 }), { w, h } = pageSize(r.format);
  return { left: L.sheet.left, top: L.sheet.top, width: w * L.fit, height: h * L.fit };
}
function drawGrow(){
  const e = ease(X.p), f = X.from, to = X.to, s0 = f.width / to.width, s = s0 + (1 - s0) * e;
  const x = f.left + (to.left - f.left) * e, y = f.top + (to.top - f.top) * e, cut = Math.max(0, to.height - f.visible / s0) * (1 - e);
  X.ghost.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(4)})`;
  X.ghost.style.clipPath = `inset(0 0 ${cut.toFixed(1)}px 0)`;
}
function startGrow(){
  const page = document.querySelector('#body .insp-res .ihpage'), r = RS.savedOf(st(), selId());
  if (!page || !r) return false;
  const b = page.getBoundingClientRect(), box = page.closest('.ihero').getBoundingClientRect();
  X.id = r.id; X.to = pageRect(r, Number(page.querySelector('[data-pages]')?.dataset.pages) || 1); X.from = { left: b.left, top: b.top, width: b.width, visible: Math.min(b.height, box.bottom - b.top) };
  X.ghost = document.createElement('div'); X.ghost.className = 'growpage'; X.ghost.setAttribute('aria-hidden', 'true');
  X.ghost.style.width = `${X.to.width}px`; X.ghost.innerHTML = thumb(r.id, r.format);
  document.body.append(X.ghost); T.fill(X.ghost, recipeOf);
  page.style.visibility = 'hidden';
  return true;
}
function endGrow(){
  cancelAnimationFrame(X.raf); clearTimeout(X.idle);
  X.ghost?.remove(); X.ghost = null; X.p = 0;
  const page = document.querySelector('#body .insp-res .ihpage'); if (page) page.style.visibility = '';
}
function settleGrow(to){
  cancelAnimationFrame(X.raf);
  const from = X.p, t0 = performance.now(), ms = 240;
  const step = now => { const k = Math.min(1, (now - t0) / ms); X.p = from + (to - from) * k; drawGrow(); if (k < 1) X.raf = requestAnimationFrame(step); else if (to) openGrown(); else endGrow(); };
  X.raf = requestAnimationFrame(step);
}
function openGrown(){
  const id = X.id, g = X.ghost;
  X.ghost = null; X.p = 0; cancelAnimationFrame(X.raf); clearTimeout(X.idle);
  if (id === st().openId) C.setView(null); else C.resumes.open(id);
  setTimeout(() => g?.remove(), 450);                 // the editor's page is drawn under it by then, in the same place
}
function wheelGrow(e){
  if (reduced() || C.view() !== 'resumes' || e.ctrlKey || !e.target.closest?.('.insp-res :is(.ihero, .ihcap)')) return;
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
  if (!X.ghost && dy <= 0) return;                 // scrolling up over a page at rest scrolls nothing
  e.preventDefault();
  if (!X.ghost && !startGrow()) return;
  X.p = Math.max(0, Math.min(1, X.p + dy / 700));
  drawGrow();
  clearTimeout(X.idle);
  if (X.p >= 1) return openGrown();
  if (X.p <= 0) return endGrow();
  X.idle = setTimeout(() => settleGrow(X.p > 0.55 ? 1 : 0), 220);
}

// ---- resting on a card's picture shows its first page large enough to read, beside the card; scrolling over the picture turns the pages ----
const HV = { t: 0, el: null, card: null, at: 0, n: 1, acc: 0 };
const railLeft = () => document.getElementById('rail')?.getBoundingClientRect().left ?? innerWidth;
function hidePreview(){ clearTimeout(HV.t); HV.el?.remove(); HV.el = null; HV.card = null; }
function showPreview(card){
  const r = RS.savedOf(st(), card.dataset.rid); if (!r) return;
  hidePreview(); HV.card = card;
  const { w, h } = pageSize(r.format), H = Math.min(innerHeight - 32, 1120), W = H * w / h, c = card.getBoundingClientRect(), rl = railLeft();
  let left = c.left + c.width / 2 < rl / 2 ? c.right + 12 : c.left - 12 - W;
  left = Math.max(12, Math.min(rl - 12 - W, left));
  const el = document.createElement('div'); el.className = 'hoverprev'; el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, { left: `${left}px`, top: '16px', width: `${W}px`, height: `${H}px` });
  el.innerHTML = `<div class="hpstrip">${thumb(r.id, r.format)}</div>`;
  document.body.append(el); HV.el = el; HV.at = 0; HV.n = 1; HV.acc = 0; T.fill(el, recipeOf);
  play(el, [{ transform: 'scale(.97)' }, { transform: 'none' }], { ms: 'fast', name: 'preview:in' });
  // a resume of more than one page: every page, stacked; the wheel over the card's picture turns them
  T.entry(recipeOf(r.id)).then(e => {
    if (!e || HV.el !== el || !(e.srcs?.length > 1)) return;
    HV.n = e.srcs.length;
    el.querySelector('.hpstrip').innerHTML = e.srcs.map(() => `<span class="hpslot" style="height:${H}px"></span>`).join('');
    el.querySelectorAll('.hpslot').forEach((slot, i) => { const f = document.createElement('iframe'); f.tabIndex = -1; f.setAttribute('scrolling', 'no'); f.srcdoc = e.srcs[i]; f.style.cssText = `width:${w}px;height:${h}px;transform:scale(${W / w});transform-origin:0 0;border:0;`; slot.append(f); });
    el.insertAdjacentHTML('beforeend', `<span class="hppage">1 / ${HV.n}</span>`);
  });
}
function turnPreview(e){
  if (!HV.el || HV.n < 2 || !e.target.closest?.('.rcard .thumbwrap')) return;
  e.preventDefault();
  HV.acc += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
  if (Math.abs(HV.acc) < 40) return;
  HV.at = Math.max(0, Math.min(HV.n - 1, HV.at + Math.sign(HV.acc))); HV.acc = 0;
  HV.el.querySelector('.hpstrip').style.transform = `translateY(${-HV.at * HV.el.offsetHeight}px)`;
  HV.el.querySelector('.hppage').textContent = `${HV.at + 1} / ${HV.n}`;
}

// ---- compare ----
// the rows Compare shows; the place card counts them before the table is drawn
const rowsNow = () => RS.compareMany(C.work(), V.cmp.map(itemOf).filter(Boolean).map(x => x.recipe));
function compareView(){
  const items = V.cmp.map(itemOf).filter(Boolean), rows = V.rows = rowsNow();
  // a cell shows what is printed (its words, or the setting), with the version's name small beside it; a line this resume lacks is hatched
  const cell = c => (typeof c === 'string' ? esc(c) : c.text ? `${esc(c.text)} <small class="muted">${esc(c.label)}</small>` : '');
  const gap = c => typeof c !== 'string' && !c.text && c.label === '—';
  return `<section class="scrn" id="compare" aria-label="${esc(t('ux6e.cmpTitle', { n: items.length }))}">
    <div class="scrhead tbar"><button class="sm" data-act="scr-back">← ${h('ux6h.allResumes')}</button>
      <button class="sm" data-act="cmp-prev" title="P">◀ ${h('ux6h.prev')}</button><button class="sm" data-act="cmp-next" title="N">${h('ux6h.next')} ▶</button></div>
    <div class="cmpscroll"><table class="cmp"><caption class="sr">${h('ux6e.cmpTitle', { n: items.length })}</caption>
      <thead><tr><th scope="col">${h('ux6e.cmpRow')}</th>${items.map(x => `<th scope="col"><span class="cname">${esc(x.label)}</span>${thumb(x.key, x.recipe.format)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${r.differs ? 'diff-row' : ''} ${r.kind} ${i === V.focus ? 'is-here' : ''}" data-act="cmp-row" data-i="${i}"><th scope="row" title="${esc(r.label)}">${esc(r.label.length > 46 ? r.label.slice(0, 45) + '…' : r.label)}</th>${r.cells.map(c => `<td class="${gap(c) ? 'gap' : ''}">${cell(c)}</td>`).join('')}</tr>`).join('')}
      <tr class="setting"><th scope="row">${h('ux6e.rowPrinted')}</th>${items.map(x => `<td data-pagesof="${esc(x.key)}">…</td>`).join('')}</tr></tbody></table></div></section>`;
}
function afterCompare(){
  const sc = document.getElementById('compare');
  T.fill(sc, recipeOf, (key, e) => { const c = sc.querySelector(`[data-pagesof="${CSS.escape(key)}"]`); if (c) c.textContent = String(e.pages); });
  paintInspector();
}
// the inspector in Compare: the row in focus, and what each resume prints there
function cmpInspector(){
  const items = V.cmp.map(itemOf).filter(Boolean), row = V.rows[V.focus];
  if (!row) return `<section class="insp"><span class="lbl">${h('ux6e.cmpTitle', { n: items.length })}</span><p class="small muted">${h('ux6h.cmpHint')}</p></section>`;
  const nDiff = V.rows.filter(x => x.differs).length, at = V.rows.filter(x => x.differs).indexOf(row);
  const val = c => (typeof c === 'string' ? c : c.text ? `${c.text}` : t('ux6h.notOnIt'));
  const open = x => { const [id, sid] = x.key.split('|'); return `<button class="sm" ${sid ? `data-act="sw-snap" data-id="${esc(id)}" data-sid="${esc(sid)}"` : `data-act="sw-open" data-id="${esc(id)}"`}>${h('ux6h.openX', { name: x.label })}</button>`; };
  return `<section class="insp"><span class="lbl">${row.differs ? h('ux6h.rowOf', { n: at + 1, of: nDiff }) : h('ux6h.rowSame')}</span><h2 class="oi-name">${esc(row.label)}</h2>
    <dl class="cmpcells">${items.map((x, i) => `<dt>${esc(x.label)}</dt><dd>${esc(val(row.cells[i]))}${typeof row.cells[i] !== 'string' && row.cells[i].text ? ` <small class="muted">${esc(row.cells[i].label)}</small>` : ''}</dd>`).join('')}</dl>
    <div class="btns">${items.map(open).join('')}</div></section>`;
}
// the next or previous row that differs: scrolled into view, marked, and shown in the inspector
function focusRow(i){
  V.focus = i;
  const trs = [...document.querySelectorAll('#compare tbody tr')];
  trs.forEach((r, j) => r.classList.toggle('is-here', j === i));
  trs[i]?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
  paintInspector();
}
function stepDiff(d){
  const idx = V.rows.map((r, i) => (r.differs ? i : -1)).filter(i => i >= 0);
  if (!idx.length) return;
  focusRow(d > 0 ? idx.find(i => i > V.focus) ?? idx.at(-1) : idx.slice().reverse().find(i => i < V.focus) ?? idx[0]);
}

// ---- acts ----
function compare(keys){ V.cmp = keys; V.focus = -1; C.setView('compare'); }
async function act(a, tg){
  switch (a){
    case 'scr-view': V.view = tg.dataset.v; try { localStorage.setItem(VIEW_KEY, V.view); } catch { /* this session only */ } C.renderBody(); return true;
    case 'scr-sent': V.sentOnly = !V.sentOnly; C.renderBody(); return true;
    case 'scr-sel': {
      const id = tg.dataset.id;
      if (selId() === id){ C.resumes.open(id); return true; }      // a second click, or Enter, on the selected card opens it
      V.sel = id; paintInspector(); return true;
    }
    case 'nj-open': V.nj = V.sel = tg.dataset.id; paintInspector(); document.getElementById('nj-company')?.focus(); return true;
    case 'nj-cancel': V.nj = null; paintInspector(); return true;
    case 'nj-create': {
      const company = document.getElementById('nj-company')?.value.trim() ?? '', role = document.getElementById('nj-role')?.value.trim() ?? '';
      if (!company){ document.getElementById('nj-company')?.focus(); return true; }
      if (C.resumes.newJob(tg.dataset.id, company, role)){ V.draft.delete(tg.dataset.id); V.nj = null; }
      return true;
    }
    case 'cmp-row': focusRow(Number(tg.dataset.i)); return true;
    case 'cmp-next': stepDiff(1); return true;
    case 'cmp-prev': stepDiff(-1); return true;
    case 'scr-clear': V.ticked.clear(); document.querySelectorAll('.rtick').forEach(x => { x.checked = false; }); refreshTicks(); return true;
    case 'scr-compare': if (V.ticked.size >= 2) compare([...V.ticked]); return true;
    case 'scr-differs': {
      const r = RS.savedOf(st(), tg.dataset.id);
      const p = RS.parentOf(st(), r) ?? RS.closestTo(st(), r, x => RS.printedIds(C.work(), x))?.r;
      if (p) compare([p.id, r.id]);
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
    if (e.target.id === 'nj-company' || e.target.id === 'nj-role'){ V.draft.set(V.nj, { ...V.draft.get(V.nj), [e.target.id === 'nj-company' ? 'company' : 'role']: e.target.value }); return; }
    if (e.target.id !== 'scr-q') return;
    V.q = e.target.value;
    document.getElementById('scr-list').innerHTML = listHtml(); afterResumes();
  });
  body.addEventListener('wheel', wheelGrow, { passive: false });
  body.addEventListener('wheel', turnPreview, { passive: false });
  body.addEventListener('pointerover', e => {
    if (phone()) return;
    const w = e.target.closest?.('.rcard .thumbwrap'); if (!w) return;
    const card = w.closest('.rcard'); if (HV.card === card) return;
    clearTimeout(HV.t); HV.t = setTimeout(() => showPreview(card), 350);
  });
  body.addEventListener('pointerout', e => { const w = e.target.closest?.('.rcard .thumbwrap'); if (w && !w.contains(e.relatedTarget)) hidePreview(); });
  body.addEventListener('scroll', () => { if (HV.n < 2) hidePreview(); }, true);
  body.addEventListener('pointerdown', hidePreview);
  // a click on a card's picture or its blank space is a click on the card (its name button takes the rest)
  body.addEventListener('click', e => { const c = e.target.closest?.('.rcard'); if (c && !e.target.closest('input, button, select, a, .rowmenu')) act('scr-sel', { dataset: { id: c.dataset.rid } }); });
  body.addEventListener('dblclick', e => { const c = e.target.closest?.('.rcard'); if (c && !e.target.closest('input')) C.resumes.open(c.dataset.rid); });
  body.addEventListener('keydown', e => {
    if (e.target.closest?.('.njform') && e.key === 'Enter'){ e.preventDefault(); document.querySelector('[data-act=nj-create]')?.click(); return; }
    if (e.target.closest?.('.njform') && e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); clearSel(); return; }
    if (e.target.id === 'scr-q' && e.key === 'Escape' && V.q){ e.preventDefault(); e.stopPropagation(); V.q = ''; e.target.value = ''; e.target.dispatchEvent(new Event('input', { bubbles: true })); }
    else if (e.target.id === 'scr-q' && e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); C.leave(); }
  });
}

// ---- the place card: the counts and the action of the place (its tab names it) ----
function placeCard(v, recSummary){
  const rs = st().resumes ?? [], sends = rs.reduce((n, r) => n + RS.snapshotsOf(r).length, 0);
  if (v === 'record') return `<p class="psub">${esc(recSummary)}</p>`;
  if (v === 'compare'){
    return `<div class="ptitle"><h2 id="pl-h">${h('ux6h.compare')}</h2></div><p class="psub">${h('ux6h.cmpSub', { n: V.cmp.length, d: rowsNow().filter(r => r.differs).length })}</p>`;
  }
  return `<p class="psub">${h('ux6h.counts', { n: rs.length, s: sends })}</p><div class="pacts"><button class="sm" data-act="sw-new">${h('ux1.newResume')}</button></div>`;
}

const api = { act, bind, compare, placeCard, clearSel, canCompare: () => V.cmp.length >= 2, focusSel: () => document.querySelector('#scr-list .rcard.sel .rsel'),
  views: { resumes: resumesView, compare: compareView }, after: { resumes: afterResumes, compare: afterCompare } };
