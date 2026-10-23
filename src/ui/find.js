// Search (UX-6f). Ctrl+F (Cmd+F on a Mac) opens the app's search in every place and puts the caret in its field; the "/" key does the same where
// a browser or a window keeps Ctrl+F for itself. The Library, Career and Compare have their field first in their toolbar (screens.js, record.js); the Editor
// has this bar, over the page, in the same spot: the top left of the work area, the toolbars' own place. While one of the app's fields has the focus the next press is left to the browser (its own find still works).
// Full screen is F11 (a plain F is a letter) and Ctrl+Shift+F is not touched. Pure view state; nothing here is written or undone.

import { t } from '../i18n/index.js';
import { icon } from './icons.js';
import { isMac } from './help.js';
import * as RS from '../model/resumes.js';
import { checklist, careerHits, langGroups } from '../model/checklist.js';
import { langName } from '../model/lang.js';
import { uiLang } from '../i18n/index.js';

export const FIELD = '#scr-q, #rec-q, #cmp-q, #find-q';
export const hasFocus = () => !!document.activeElement?.matches?.(FIELD);
// Ctrl+F, or Cmd+F on a Mac (Ctrl+F there is the text box's "forward one character")
export const isFindKey = e => !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f' && (isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// A text as safe HTML with every place of the word marked (the drink's highlight token, see mark.fnd). shortcut: the match is on the lower-cased text, so a letter
// whose lower case is longer (a dotted capital I) can shift a mark by one; upgrade to a locale-free fold if a language shows it.
export function mark(text, q){
  const s = String(text ?? ''), n = String(q ?? '').trim().toLowerCase(), low = s.toLowerCase();
  let out = '', at = 0;
  for (let i; n && (i = low.indexOf(n, at)) >= 0; at = i + n.length) out += `${esc(s.slice(at, i))}<mark class="fnd">${esc(s.slice(i, i + n.length))}</mark>`;
  return out + esc(s.slice(at));
}
// …the part around the first place, for a line too long for a card
export function snippet(text, q, width = 90){
  const s = String(text ?? '').replace(/\s+/g, ' '), i = s.toLowerCase().indexOf(String(q ?? '').trim().toLowerCase());
  if (s.length <= width || i < 0) return mark(s.slice(0, width * 2), q);
  const from = Math.max(0, Math.min(i - 30, s.length - width));
  return `${from ? '…' : ''}${mark(s.slice(from, from + width), q)}${from + width < s.length ? '…' : ''}`;
}

// the one query every field of the app shares: the Library's, Career's and the Editor's bar
// claim: the Library shows only the resumes that print this claim, { facts, vid, label } (from "Resumes that print this" in Career)
export const F = { q: '', claim: null, open: { q: '', keys: new Set() } };
// the folds a result list has open: for this search only (a new query folds them all again)
const isOpen = k => { if (F.open.q !== F.q) F.open = { q: F.q, keys: new Set() }; return F.open.keys.has(k); };
// a fold: a secondary-tier button that opens a list in place (the list is in the page, hidden, so a click redraws nothing)
const fold = (key, label, inner) => `<div class="ffoldw"><button class="sm press fmore" data-tier="secondary" data-act="find-fold" data-key="${esc(key)}" data-label="${esc(label)}" aria-expanded="${isOpen(key)}">${esc(isOpen(key) ? t('ux6f.fewer') : label)}</button><div class="ffold" ${isOpen(key) ? '' : 'hidden'}>${inner}</div></div>`;

let C = null, bar = null, from = null, at = -1;      // at: the line the last Enter went to

export function initFind(ctx){
  C = ctx;
  bar = document.createElement('div');
  bar.id = 'find'; bar.className = 'card find'; bar.hidden = true; bar.setAttribute('role', 'search');
  bar.innerHTML = `<input id="find-q" type="search" class="sw-q" autocomplete="off" aria-label="${t('ux6f.search')}" placeholder="${t('ux6f.search')}">
    <span class="fcount" id="find-n" role="status"></span>
    <button class="sm press fnav" data-tier="secondary" data-act="find-prev" aria-label="${t('ux6f.prev')}">${icon('up', { role: 'control' })}</button><button class="sm press fnav fdn" data-tier="secondary" data-act="find-next" aria-label="${t('ux6f.next')}">${icon('up', { role: 'control' })}</button>
    <button class="ib press" data-tier="tertiary" data-act="find-close" aria-label="${t('ux6f.close')}">${icon('close', { role: 'control' })}</button>`;
  document.body.append(bar);
  bar.querySelector('input').addEventListener('input', e => { F.q = e.target.value; at = -1; C.setFind(F.q); paint(); });
  bar.addEventListener('keydown', e => {
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && !e.isComposing && e.target.id === 'find-q'){ e.preventDefault(); step(e.shiftKey ? -1 : 1); }
  });
  return { open, close, sync, act, hasFocus, refresh: paint };
}

// the bar belongs to the editor: another place has its own field, in its toolbar, at the same spot
const FIELDS = { resumes: '#scr-q', record: '#rec-q', compare: '#cmp-q' };
function sync(){ if (bar && !bar.hidden && FIELDS[C.view()]){ bar.hidden = true; C.setFind(''); } }
// "3 on this resume", and Enter and Shift+Enter step through the lines: the page shows the line, as a walk with the arrow keys does
function paint(){
  const n = F.q.trim() && bar && !bar.hidden ? C.finds().length : -1;
  bar?.querySelector('#find-n') && (bar.querySelector('#find-n').textContent = n < 0 ? '' : t('ux6f.onResume', { n }));
  for (const b of bar?.querySelectorAll('.fnav') ?? []) b.disabled = n <= 0;
}
function step(d){
  const facts = C.finds();
  if (!facts.length) return;
  at = at < 0 ? (d > 0 ? 0 : facts.length - 1) : (at + d + facts.length) % facts.length;
  C.selectFact(facts[at]);
  bar.querySelector('#find-q').focus({ preventScroll: true });
}
function close(){
  if (!bar || bar.hidden) return;
  bar.hidden = true; F.q = ''; bar.querySelector('input').value = ''; at = -1; C.setFind(''); paint();
  if (from?.isConnected) from.focus({ preventScroll: true });
  from = null;
}
async function open(){
  if (C.view() === 'welcome') return;
  if (!hasFocus()) from = document.activeElement;
  if (!(await C.leaveWriting())) return;      // a line being written is left first, as for any other place
  const n = document.querySelector(FIELDS[C.view()] ?? '#find-q');
  if (!FIELDS[C.view()]) bar.hidden = false;
  if (n && n.id === 'find-q'){ n.value = F.q; C.setFind(F.q); paint(); }
  n?.focus(); n?.select();
}
async function act(a, tg){
  if (a === 'find-close'){ close(); return true; }
  if (a === 'find-prev' || a === 'find-next'){ step(a === 'find-next' ? 1 : -1); return true; }
  if (a === 'find-resume'){ C.pickResume(tg.dataset.id); return true; }
  if (a === 'find-prints'){ F.claim = { facts: tg.dataset.facts.split(' '), vid: tg.dataset.vid || null, label: tg.dataset.label }; F.q = ''; C.goLibrary(); return true; }
  if (a === 'find-fold'){
    const on = tg.getAttribute('aria-expanded') !== 'true';
    if (F.open.q !== F.q) F.open = { q: F.q, keys: new Set() };
    F.open.keys[on ? 'add' : 'delete'](tg.dataset.key);
    tg.setAttribute('aria-expanded', String(on)); tg.nextElementSibling.hidden = !on; tg.textContent = on ? t('ux6f.fewer') : tg.dataset.label;
    return true;
  }
  if (a === 'find-claim-clear'){ F.claim = null; C.renderBody(); return true; }
  return false;
}

// "Resumes that print this": the Library with the search set to one claim, or to the claims of one entry
export const printsButton = (facts, label, { vid = '', tier = 'secondary', cls = '' } = {}) => `<button class="sm press ${cls}" data-tier="${tier}" data-act="find-prints" data-facts="${esc(facts.join(' '))}" data-vid="${esc(vid)}" data-label="${esc(label)}">${t('ux6f.prints')}</button>`;

// ---- the results: one list over Career and the resumes, each result saying which it is in ----
const groupName = g => (g.kind === 'about' ? t('career.step1') : g.kind === 'entry' ? [g.title, g.org].filter(Boolean).join(' \u00b7 ') : g.kind === 'education' ? t('career.kind.education') : g.kind === 'credentials' ? t('ux2.groupCredentials') : g.title);
// a claim's versions, each with its number and language and the word marked: the current language's always shown, every other language that has a
// match in a fold of its own, named by the language and the number of matches
const versionList = (x, q, list) => `<ol class="fvers">${list.map(v => `<li class="${v.hit ? 'hit' : ''}"><span class="fv">v${esc(v.n)} \u00b7 ${esc(String(v.lang).toUpperCase())}</span><span class="ftext">${snippet(v.text, q)}</span>${printsButton([x.fact], x.label, { vid: v.id, tier: 'tertiary', cls: 'fvp' })}</li>`).join('')}</ol>`;
function versionsHtml(x, q, lang){
  const g = langGroups(x.versions, lang);
  return (g.open.length ? versionList(x, q, g.open) : '') + (g.folds.length ? `<div class="ffolds">${g.folds.map(f => fold(`${x.fact}|${f.lang}`, t('ux6f.langFold', { lang: langName(f.lang), n: f.hits }), versionList(x, q, f.versions))).join('')}</div>` : '');
}
// the Career entries and claims that hold the word; the rows go to the entry in Career. A claim the open resume does not print with the word says so.
export function careerHtml(){
  const q = F.q.trim(), hits = q ? careerHits(C.work(), q) : [];
  if (!hits.length) return '';
  const names = new Map(checklist(C.work(), C.cur(), C.lang()).groups.map(g => [g.id, groupName(g)]));
  const here = new Set(RS.hits(C.work(), C.cur(), q).map(x => x.fact)), lang = C.openLang() ?? uiLang();      // the open resume's language, else the interface's
  // every version of a claim is listed, with its number and language; the ones that hold the word have it marked
  return `<section class="found" aria-label="${esc(t('ux6f.inCareer', { n: hits.length }))}"><h3 class="lbl">${t('ux6f.inCareer', { n: hits.length })}</h3><ul>${hits.map(x => `<li>
    <div class="fhead"><button class="frow press" data-tier="tertiary" data-act="rec-job" data-id="${esc(x.group)}"><span class="fwhere">${esc(names.get(x.group) ?? x.group)}${x.fact ? ` \u00b7 ${esc(x.label)}` : ''}</span>${x.fact && !here.has(x.fact) ? `<span class="pill">${t('ux6f.notHere')}</span>` : ''}</button>${x.fact ? printsButton([x.fact], x.label) : ''}</div>
    ${versionsHtml(x, q, lang)}</li>`).join('')}</ul></section>`;
}
// the resumes that print a line with the word (or have it in the name), for Career: the name, the first matching line, a click opens the Library on it
export function resumesHtml(){
  const q = F.q.trim(), rows = [];
  if (q) for (const r of C.resumes()){
    const hit = RS.hits(C.work(), C.held(r.id), q)[0];
    if (hit || RS.matches(C.work(), r, q)) rows.push(`<li><button class="frow press" data-tier="tertiary" data-act="find-resume" data-id="${esc(r.id)}"><span class="fwhere">${esc(RS.resumeLabel(r))}</span>${hit ? `<span class="ftext">${snippet(hit.text, q)}</span>` : ''}</button></li>`);
  }
  // the first two, and the rest in a fold, "n more", shut until it is opened
  const SHOWN = 2, rest = rows.slice(SHOWN);
  return rows.length ? `<section class="found" aria-label="${esc(t('ux6f.inResumes', { n: rows.length }))}"><h3 class="lbl">${t('ux6f.inResumes', { n: rows.length })}</h3><ul>${rows.slice(0, SHOWN).join('')}</ul>${rest.length ? fold('resumes', t('ux6f.more', { n: rest.length }), `<ul>${rest.join('')}</ul>`) : ''}</section>` : '';
}
