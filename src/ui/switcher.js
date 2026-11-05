// The resume switcher. On a desktop it is the name window: one shape that rolls down from the name card. Its top layer is the card's own
// face: Position, Workplace and the custom word (a warning offers Duplicate as new when the name changes), where the resume was copied
// from, Duplicate, Close resume and Delete, then the resume's languages, each with what is left to write and its own paper. Its lower layer,
// a deeper surface that scrolls, holds the search and the other resumes (hover to compare). The card names the open resume (cardName) and
// its language code opens a list of the resume's languages. On a phone it is the menu under the head, as it was. It lives outside #head,
// which is redrawn on every save, so the search box keeps its caret.

import * as RS from '../model/resumes.js';
import { t, h } from '../i18n/index.js';
import { icon } from './icons.js';
import { play, reduced } from './motion.js';
import { LANGS } from '../model/schema.js';
import { langName, langsInUse, resumeLangs, langDiffs, langPaper, setLangPaper, dropResumeLang } from '../model/lang.js';

let C = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = { open: false, q: '', hover: null, word: false, adding: false, warnOff: false };
let el = null;

const RECENT_KEY = 'rb-recent', RECENT_N = 4, WINDOW_RECENT = 3;
function recentIds(){ try { const a = JSON.parse(localStorage.getItem(RECENT_KEY)); return Array.isArray(a) ? [...new Set(a.filter(x => typeof x === 'string'))] : []; } catch { return []; } }
function noteOpen(id){ try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentIds().filter(x => x !== id)].slice(0, 12))); } catch { /* this session only */ } }
function noteRename(from, to){ try { localStorage.setItem(RECENT_KEY, JSON.stringify([...new Set(recentIds().map(x => (x === from ? to : x)))])); } catch { /* ignore */ } }

const st = () => C.store.state;
const phone = () => !!C.ui.layout?.phone;

function snapLines(r){
  return RS.snapshotsOf(r).slice().reverse().map(s => {
    const first = s.sends.find(x => RS.sendLabel(x)) ?? s.sends[0];
    const more = s.sends.length > 1 ? ` +${s.sends.length - 1}` : '';
    const label = first && RS.sendLabel(first) ? t('ux1.sentTo2', { to: RS.sendLabel(first) }) : t('ux1.snapshotWord');
    return `<button class="snapline" data-act="sw-snap" data-id="${esc(r.id)}" data-sid="${esc(s.id)}">${icon('right', { role: 'inline' })} ${esc(label)} · ${esc(first?.date || s.at.slice(0, 10))}${more}</button>`;
  }).join('');
}
// A resume's name reads "Company - Role": when it does, the company is set above the role. Nothing is cut: a long name wraps.
const SPLIT = /^(.*?)\s+[-–—]\s+(.+)$/;
export function nameHtml(label){
  const m = SPLIT.exec(label);
  return m ? `<span class="swco">${esc(m[1])}</span><span class="sr"> — </span><span class="swrole">${esc(m[2])}</span>` : `<span class="swco">${esc(label)}</span>`;
}
// language and pages, as a small tag
const tagOf = r => [(r.lang ?? 'en').toUpperCase(), r.pageLimit === 0 ? t('head.anyLength') : r.pageLimit ? t('resumes.pShort', { n: r.pageLimit }) : null].filter(Boolean).join(' · ');
function rowHtml(r, where){
  const cur = r.id === st().openId;
  const out = r.forKind === 'outreach' ? `<span class="pill">${h('ux1.outreach')}</span>` : '';
  return `<div class="swrow ${cur ? 'is-cur' : ''}" role="presentation" data-rid="${esc(r.id)}">
    ${C.resumes.renamingHere(r.id, where) ? C.resumes.renameInput(r)
      : `<button class="sopt" ${cur ? 'aria-current="true"' : ''} data-act="sw-open" data-id="${esc(r.id)}"><span class="sn">${nameHtml(RS.resumeLabel(r))}</span>${out}<span class="swtag">${esc(tagOf(r))}</span></button>`}
    ${C.resumes.moreButton(r.id, where)}
    ${C.resumes.rowMenuHtml(r.id, where)}
    ${snapLines(r)}
  </div>`;
}

// ---- the name card (shell.js draws it): the position, the workplace and the custom word under it; the language code and the chevron
// follow the last word as one unit and wrap with it ----
const tail = (txt, end) => { const m = /^(.*?)(\S+)$/s.exec(txt); return m ? `${esc(m[1])}<span class="nw-tail">${esc(m[2])}<span class="nw-end">${end}</span></span>` : esc(txt) + end; };
export function cardName(r, { cue = false, code = false } = {}){
  const L = r?.lang ?? 'en';
  const end = (code ? `<span class="nw-code" role="button" tabindex="0" data-act="nw-langs" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(`${t('head.langGroup')}: ${langName(L)}`)}" title="${esc(t('head.langGroup'))}">${esc(L.toUpperCase())}</span>` : '')
    + (cue ? `<span class="nw-cue" aria-hidden="true">${icon('caret', { role: 'inline' })}</span>` : '');
  if (!r?.role) return `<span class="nw-role">${tail(RS.resumeLabel(r), end)}</span>`;
  const word = RS.wordOf(r), company = r.company ?? '';
  const sub = word ? `${company ? `${esc(company)} · ` : ''}<span class="nw-tail nw-flex"><i title="${esc(word)}">${esc(word)}</i><span class="nw-end">${end}</span></span>` : company ? tail(company, end) : '';
  return `<span class="nw-role">${sub ? esc(r.role) : tail(r.role, end)}</span>${sub ? `<span class="nw-sub">${sub}</span>` : ''}`;
}

// the card's language list: the resume's languages (a click switches), then + Language, which opens the window ready to add one
const closeList = () => { document.querySelector('.nw-lpop')?.remove(); document.querySelector('#head .nw-code')?.setAttribute('aria-expanded', 'false'); };
function openList(code){
  closeList();
  const r = st().cur, L = r?.lang ?? 'en', rc = code.getBoundingClientRect(), pop = document.createElement('div');
  pop.className = 'nw-lpop'; pop.setAttribute('role', 'menu'); pop.setAttribute('aria-label', t('head.langGroup'));
  pop.style.cssText = `left:${Math.round(rc.left - 8)}px;top:${Math.round(rc.bottom + 6)}px`;
  pop.innerHTML = resumeLangs(r).map(l => `<button role="menuitemradio" aria-checked="${l === L}" data-act="nw-lang" data-l="${l}" lang="${l}">${esc(langName(l))}<small>${l.toUpperCase()}</small></button>`).join('')
    + `<button role="menuitem" class="nw-lpop-add" data-act="nw-addlang">${h('nw.cardLang')}</button>`;
  document.body.append(pop);
  code.setAttribute('aria-expanded', 'true');
  (pop.querySelector('[aria-checked=true]') ?? pop.querySelector('button')).focus();
}

function html(){
  const all = st().resumes ?? [];
  const q = S.q.trim();
  const list = all.filter(r => RS.matches(st().record, r, q));
  const search = `<input id="sw-q" class="sw-q" type="search" aria-controls="sw-list" aria-label="${esc(t('ux1.search'))}" placeholder="${esc(t('ux1.search'))}" value="${esc(S.q)}" autocomplete="off">`;
  if (!phone()) return windowHtml(all, q, list, search);
  const groups = RS.grouped(list);
  const recent = q ? [] : recentIds().map(id => all.find(r => r.id === id)).filter(Boolean).slice(0, RECENT_N);
  return `<span class="lbl">${h('edit.thisResume')}</span>
  <div class="swacts"><button class="sm" data-act="rm-dup" data-id="${esc(st().openId ?? '')}" ${st().openId ? '' : 'disabled'}>${h('ux1.dup')}</button><button class="sm" data-act="sw-close" ${st().openId ? '' : 'disabled'}>${h('close.item')}</button>${C.resumes.delHtml(st().openId, !st().openId)}</div>${C.resumes.askHtml(st().openId)}
  ${search}
  <div id="sw-list" class="swlist" role="group" aria-label="${esc(t('ux1.switcherTitle'))}">
    <button class="swnew" data-act="sw-new">${h('ux1.newResume')}</button>
    ${recent.length ? `<span class="lbl">${h('ux1.recent')}</span>${recent.map(r => rowHtml(r, 'recent')).join('')}` : ''}
    ${groups.map(g => `<span class="lbl">${esc(g.key ? g.label : t('resumes.noRole'))}</span>${g.resumes.map(r => rowHtml(r, 'group')).join('')}`).join('')}
    ${list.length ? '' : `<p class="muted small swnone">${h(all.length ? 'ux1.noMatch' : 'ux1.noneYet')}</p>`}
  </div>
  <div class="swfoot"><button class="sm swmanage" data-act="sw-manage"><span>${h('ux1.manageAll', { n: all.length })}</span>${icon('right', { role: 'control' })}</button></div>`;
}

// A desktop's window. Top layer: the name, this resume's actions, its languages and paper. Lower layer: the other resumes.
function windowHtml(all, q, list, search){
  const id = st().openId ?? '', open = RS.savedOf(st(), st().openId), parent = open ? RS.parentOf(st(), open) : null, r = st().cur, dis = open ? '' : 'disabled';
  const others = all.filter(x => x.id !== id);
  const recent = q ? [] : [...new Set([...recentIds(), ...others.map(x => x.id)])].map(x => others.find(o => o.id === x)).filter(Boolean).slice(0, WINDOW_RECENT);
  const groups = q ? RS.grouped(list.filter(x => x.id !== id)) : [];
  const field = (fid, k, hint, val, ph) => `<div class="nw-f"><label for="${fid}">${h(k)}<span class="nw-h"> · ${h(hint)}</span></label><input id="${fid}" class="sw-q" value="${esc(val)}" placeholder="${esc(t(ph))}" autocomplete="off" ${dis}></div>`;
  const word = RS.wordOf(r);
  const name = `<section class="nw-sec"><span class="swrenbox nw-ren" id="sw-rnbox" data-rid="${esc(id)}">
    ${field('sw-rn', 'resumes.role', 'nw.roleHint', r?.role ?? '', 'nw.rolePh')}
    ${field('sw-rn-co', 'resumes.company', 'nw.companyHint', r?.company ?? '', 'nw.companyPh')}
    ${word || S.word ? field('sw-rn-word', 'nw.word', 'nw.wordHint', word, 'nw.wordPh') : `<input id="sw-rn-word" type="hidden" value=""><button class="ghost nw-addword" data-act="nw-word" ${dis}>${h('nw.addWord')}</button>`}
    <div class="nw-warn" hidden role="alert">${icon('warn', { role: 'inline' })}<span><b>${h('nw.warnHead')}</b> ${h('nw.warnBody')}</span><button class="nw-wx" data-act="nw-wx" aria-label="${esc(t('nw.warnDismiss'))}">${icon('close', { role: 'inline' })}</button></div>
  </span></section>`;
  const mine = `<section class="nw-sec nw-this">${parent ? `<p class="nw-facts swfrom">${h('ux6b.duplicatedFrom', { name: RS.resumeLabel(parent) })}</p>` : ''}
    <div class="swacts"><button class="sm nw-dup" data-act="rm-dup" data-id="${esc(id)}" ${dis}>${h('ux1.dup')}</button><button class="ghost sm nw-quiet" data-act="sw-close" ${dis}>${h('close.item')}</button>${C.resumes.delHtml(id, !open)}</div>${C.resumes.askHtml(id)}</section>`;
  const L = r?.lang ?? 'en', langs = r ? resumeLangs(r) : [], diffs = langs.length > 1 ? langDiffs(C.work(), r) : {};
  const seg = l => `<span class="nw-seg nw-pp" role="group" aria-label="${esc(t('nw.paperOf', { lang: langName(l) }))}">${[['a4', 'paper.a4'], ['us-letter', 'paper.letter']].map(([v, k]) => `<button data-act="nw-paper" data-l="${l}" data-v="${v}" aria-pressed="${(langPaper(r, l) === 'us-letter') === (v === 'us-letter')}" ${dis}>${h(k)}</button>`).join('')}</span>`;
  const rows = langs.map(l => {
    const n = C.ui.langCounts?.[l], d = diffs[l]?.length ?? 0;
    return `<li><span class="nw-nm"><button class="nw-ln" data-act="nw-lang" data-l="${l}" lang="${l}" ${l === L ? 'aria-current="true"' : ''}>${esc(langName(l))}</button>${d ? `<span class="nw-alt" title="${esc(t('nw.otherWording', { n: d }))}">${h('nw.otherWording', { n: d })}</span>` : ''}</span><span class="nw-st ${n ? 'is-todo' : ''}" data-l="${l}">${esc(statusOf(n))}</span>${seg(l)}<button class="nw-x" data-act="nw-rm" data-l="${l}" aria-label="${esc(t('nw.removeLang', { lang: langName(l) }))}" ${l === L || !open ? 'disabled' : ''}>${icon('close', { role: 'inline' })}</button></li>`;
  }).join('');
  const rest = LANGS.filter(l => !langs.includes(l));
  const lang = `<section class="nw-sec nw-langs"><h3>${h('nw.langsHead')}</h3><ul class="nw-stat">${rows}</ul>
    ${rest.length ? `<div class="nw-addrow"><button class="ghost nw-add" data-act="nw-addl" aria-expanded="${S.adding}" ${dis}>${h('nw.addLang')}</button></div>
    ${S.adding ? `<div class="nw-tog" role="group" aria-label="${esc(t('nw.addLang'))}">${rest.map(l => `<button data-act="nw-tog" data-l="${l}" lang="${l}" title="${esc(langName(l))}" aria-label="${esc(langName(l))}">${l.toUpperCase()}</button>`).join('')}</div>` : ''}` : ''}</section>`;
  const lower = `<section class="nw-sec nw-others"><h3>${h('nw.others')}<span class="nw-h"> · ${h('nw.othersHint')}</span></h3>
    ${search}
    <div id="sw-list" class="swlist" role="group" aria-label="${esc(t('ux1.switcherTitle'))}">
      ${recent.map(x => rowHtml(x, 'recent')).join('')}
      ${groups.map(g => `<span class="lbl">${esc(g.key ? g.label : t('resumes.noRole'))}</span>${g.resumes.map(x => rowHtml(x, 'group')).join('')}`).join('')}
      ${(q ? !groups.length : !recent.length) ? `<p class="muted small swnone">${h(q ? 'ux1.noMatch' : 'nw.noOthers')}</p>` : ''}
    </div></section>`;
  return `<div class="nw-top">${name}${mine}${lang}</div><div class="nw-low">${lower}</div>`;
}
const statusOf = n => (n == null ? '' : n ? t('lang.toWrite', { n }) : t('lang.complete'));
// the counts come in after the window has opened (shell.js loads each language's words): only the status is written, so a field keeps its caret
function counts(){
  if (!el || el.hidden) return;
  for (const s of el.querySelectorAll('.nw-st[data-l]')){ const n = C.ui.langCounts?.[s.dataset.l]; s.textContent = statusOf(n); s.classList.toggle('is-todo', !!n); }
}

// ---- the roll: one shape grows from the card's exact box downward, and back. The card's own outline is off while the window is out (the
// window's is the only one), and the window carries the card's lift. Under it every place keeps its resting layout: it fades under the roll on
// the way out, is only out of sight (visibility) while the window is open, and the rolling edge uncovers it on the way back. ----
const ROLL = 280, ROLL_EASE = 'cubic-bezier(.3, .7, .2, 1)';
let rollEnd = null, rolling = null;
// the card's box, as variables on #col: the window is drawn from them (a ResizeObserver on the card keeps them, so it follows a resize live)
function geo(){
  const hd = document.getElementById('head'), col = document.getElementById('col');
  if (!hd || !col || phone()) return;
  const cs = col.style;
  cs.setProperty('--nw-ht', `${hd.offsetTop}px`); cs.setProperty('--nw-hl', `${hd.offsetLeft}px`); cs.setProperty('--nw-hw', `${hd.offsetWidth}px`);
  cs.setProperty('--nw-hh', `${hd.offsetHeight}px`); cs.setProperty('--nw-hr', getComputedStyle(hd).borderTopLeftRadius);
}
function roll(dir, done){
  rollEnd?.();      // one under way ends where it was going
  const col = document.getElementById('col'), under = ['body', 'bankcard'].map(x => document.getElementById(x)).filter(e => e && !e.hidden);
  if (dir === 'open') document.body.classList.add('nw-win');
  geo();
  const hh = parseFloat(col.style.getPropertyValue('--nw-hh')) || 0, full = el.getBoundingClientRect().height;
  let over = false;
  const end = () => {
    if (over) return; over = true; rollEnd = rolling = null;
    col.classList.remove('nw-rolling'); col.classList.toggle('nw-open', dir === 'open');
    under.forEach(e => e.getAnimations().forEach(a => { if (a.id === 'nw-under') a.cancel(); }));
    done?.();
    if (dir === 'close') document.body.classList.remove('nw-win');
  };
  rollEnd = end; rolling = dir;
  const a = reduced() || !full ? null : play(el, [{ height: `${(dir === 'open' ? hh : full)}px` }, { height: `${(dir === 'open' ? full : hh)}px` }], { key: 'namewin', ms: ROLL, kind: ROLL_EASE, fill: dir === 'close' ? 'forwards' : 'none', name: `namewin:${dir}` });
  if (!a){ end(); return; }
  col.classList.add('nw-rolling'); col.classList.remove('nw-open');
  for (const e of under) e.animate(dir === 'open' ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0.7 }, { opacity: 1 }], { duration: ROLL, easing: ROLL_EASE, fill: dir === 'open' ? 'forwards' : 'none', id: 'nw-under' });
  a.finished.then(() => { end(); if (dir === 'close') a.cancel(); }, end);
}

// "+ Language" on the card opens the window with the picker out: it takes the app's "just here" wash (CSS .is-just) for 3 s once the roll is over;
// a redraw inside the 3 s carries the fade on where it was (the animation delay), as the Outline's does
const LIT_MS = 3000;
function litPicker(){
  const l = S.lit; if (!l) return;
  l.until ??= performance.now() + LIT_MS;
  const left = l.until - performance.now(), p = el.querySelector('.nw-tog');
  if (left <= 0 || !p){ if (left <= 0) S.lit = null; return; }
  p.classList.add('is-just'); p.style.animationDelay = `${Math.round(left - LIT_MS)}ms`;
  p.addEventListener('animationend', () => { if (S.lit === l) S.lit = null; });
}
function render({ keepFocus = true } = {}){
  if (!el) return;
  if (!S.open && !el.hidden && !phone()){ if (rolling !== 'close') roll('close', () => { el.hidden = true; el.innerHTML = ''; }); return; }      // it rolls up before it is emptied
  if (rolling === 'close') rollEnd();      // opened again while it rolls up: it is put away, then rolls down
  const was = el.hidden;
  draw({ keepFocus });
  if (was && S.open && !phone()) roll('open', litPicker); else litPicker();
}
function draw({ keepFocus = true } = {}){
  el.hidden = !S.open;
  el.setAttribute('aria-label', t('ux1.switcherTitle'));
  document.getElementById('docname-btn')?.setAttribute('aria-expanded', String(S.open));
  if (!S.open){ el.innerHTML = ''; S.lit = null; return; }
  const q = el.querySelector('#sw-q');
  const hadFocus = keepFocus && q && document.activeElement === q;
  const pos = q?.selectionStart ?? null;
  const scroll = el.querySelector('.nw-low, .swlist')?.scrollTop ?? 0;
  el.innerHTML = html();
  if (S.lit?.until) litPicker();
  // on a phone the menu hangs below the header row
  const hd = document.getElementById('head');
  if (hd && phone()){
    const top = hd.offsetHeight + 6, col = document.getElementById('col').getBoundingClientRect();
    el.style.setProperty('--sw-top', `${top}px`);
    el.style.setProperty('--sw-max', `${Math.max(240, Math.round(col.height - top - 8))}px`);      // it ends at the panel's foot
  }
  const list = el.querySelector('.nw-low, .swlist');
  if (list) list.scrollTop = scroll;
  if (hadFocus){ const n = el.querySelector('#sw-q'); n.focus(); if (pos != null) n.setSelectionRange(pos, pos); }
}

// Opening closes everything that floats over the editor: its card's menus (with the version preview), the app menu, row menus, dropdowns
// and the card's language list. Here, not in the roll, so every way in does it.
function closePops(){
  C.closeMenus(); C.resumes.closeMenus?.(); closeList();
  document.dispatchEvent(new Event('scroll'));      // an open dropdown closes on a scroll
  for (const pop of document.querySelectorAll('#body .cpop:not([hidden])')){ pop.hidden = true; pop.previousElementSibling?.setAttribute('aria-expanded', 'false'); C.endPreview(); }
}

// `name`: the name is to be typed over (a copy was just made): the window opens, or is drawn again, with the name field selected
function open({ name = false } = {}){
  if (S.open){ if (name){ render({ keepFocus: false }); nameField(); } return; }
  closePops();
  S.open = true; S.q = '';
  C.relayout();
  render({ keepFocus: false });
  C.opened?.();
  // a desktop's name window keeps the focus on the name (Tab walks into the window); the others go to the search
  if (name && !phone()) nameField();
  else if (phone()) el.querySelector('#sw-q')?.focus();
  // the open resume, in view
  el.querySelector('.swrow.is-cur')?.scrollIntoView({ block: 'nearest' });
}
const nameField = () => { const n = el.querySelector('#sw-rn'); n?.focus(); n?.select(); };
function close({ focusBack = false } = {}){
  if (!S.open) return;
  const rn = el.querySelector('#sw-rnbox');
  if (rn && rn.dataset.rid === st().openId) rename(rn);                  // a name typed and not confirmed is kept (not on another resume: it was opened)
  Object.assign(S, { open: false, q: '', word: false, adding: false, warnOff: false });
  C.relayout();
  render();
  C.resumes.reset();
  C.endPreview();
  if (focusBack) document.getElementById('docname-btn')?.focus();
}
const toggle = () => (S.open ? close({ focusBack: true }) : open());
// Ctrl+O: open it, or if it is open already, back to the search box
const openOrFocus = () => { if (!S.open) open(); el.querySelector('#sw-q')?.focus(); };

function navItems(){ return [...el.querySelectorAll('#sw-rn, #sw-rn-co, #sw-rn-word:not([type=hidden]), .nw-addword, .nw-wx, .swacts button:not(:disabled), .delask button, .nw-ln, .nw-pp button:not(:disabled), .nw-x:not(:disabled), .nw-add, .nw-tog button, #sw-q, .ddbtn, .swnew, .sopt, .smore, .snapline, .swfoot button:not(:disabled)')].filter(x => !x.closest('.rowmenu') && !x.closest('[hidden]')); }

// the rename warning: shown while Position or Workplace differs from the saved name (until dismissed); the Duplicate button then makes the copy
function warnCheck(){
  const box = el.querySelector('#sw-rnbox'), r = RS.savedOf(st(), st().openId);
  if (!box) return;
  let any = false;
  for (const [k, was] of [['#sw-rn', r?.role ?? ''], ['#sw-rn-co', r?.company ?? '']]){ const f = box.querySelector(k), ch = !!r && !S.warnOff && f.value.trim() !== was; f.classList.toggle('is-changed', ch); any ||= ch; }
  const w = box.querySelector('.nw-warn'), b = el.querySelector('.nw-dup');
  if (w) w.hidden = !any;
  if (b){ b.classList.toggle('is-warn', any); b.textContent = t(any ? 'nw.dupAsNew' : 'ux1.dup'); }
}
const warnOn = () => el.querySelector('.nw-warn')?.hidden === false;
// the window's own controls, drawn again after a change, with the focus back where it was
const redraw = sel => { render({ keepFocus: false }); if (sel) el.querySelector(sel)?.focus(); };

async function act(a, tg){
  switch (a){
    case 'switcher': toggle(); return true;
    case 'sw-close': if (C.resumes.closeResume()) close(); return true;
    case 'sw-open': if (C.resumes.open(tg.dataset.id)) close(); return true;
    case 'sw-snap': C.resumes.openSnapshot(tg.dataset.id, tg.dataset.sid); close(); return true;
    case 'sw-new': close(); C.setView('new'); return true;
    case 'sw-manage': close(); C.setView('resumes'); return true;
    case 'rm-dup': {
      // Duplicate as new: this resume keeps the name it was sent with, the copy takes the typed one
      if (!tg.closest('#switcher') || !warnOn()) return false;
      const box = el.querySelector('#sw-rnbox'), v = k => box.querySelector(k).value.trim(), r = RS.savedOf(st(), st().openId), typed = [v('#sw-rn-co'), v('#sw-rn'), v('#sw-rn-word')];
      box.querySelector('#sw-rn').value = r?.role ?? ''; box.querySelector('#sw-rn-co').value = r?.company ?? ''; box.querySelector('#sw-rn-word').value = RS.wordOf(r);
      warnCheck();
      if (C.resumes.newJob(tg.dataset.id, ...typed)) redraw('#sw-rn');
      return true;
    }
    case 'nw-langs': if (document.querySelector('.nw-lpop')) closeList(); else openList(tg); return true;
    case 'nw-lang': {
      closeList();
      const l = tg.dataset.l;
      if (l !== (st().cur?.lang ?? 'en')) C.chooseLang(langsInUse(st().record).includes(l) ? l : `+${l}`);
      return true;
    }
    case 'nw-addlang': closeList(); S.adding = true; S.lit = {}; if (S.open){ redraw(); litPicker(); } else open(); el.querySelector('.nw-add')?.focus(); return true;
    case 'nw-word': S.word = true; redraw('#sw-rn-word'); return true;
    case 'nw-wx': S.warnOff = true; warnCheck(); el.querySelector('#sw-rn-co')?.focus(); return true;
    case 'nw-addl': S.adding = !S.adding; redraw(S.adding ? '.nw-tog button' : '.nw-add'); return true;
    case 'nw-tog': {
      const l = tg.dataset.l;
      S.adding = false;
      C.store.commit(d => { C.addLang(d, l); }, t('undo.addLanguage', { lang: langName(l) }));
      redraw(`.nw-ln[data-l="${l}"]`); C.opened?.();
      return true;
    }
    case 'nw-rm': {
      const l = tg.dataset.l;
      C.store.commit(d => { dropResumeLang(d.cur, l); }, t('nw.removeLang', { lang: langName(l) }));
      redraw('.nw-add'); C.opened?.();
      return true;
    }
    case 'nw-paper': {
      const l = tg.dataset.l, letter = tg.dataset.v === 'us-letter';
      if (l === (st().cur?.lang ?? 'en')) C.choosePaper(tg.dataset.v);      // the resume's own paper, as Look sets it
      else C.store.commit(d => { setLangPaper(d.cur, l, letter); }, t('design.paper'));
      redraw(`.nw-pp [data-l="${l}"][data-v="${tg.dataset.v}"]`);
      return true;
    }
  }
  return false;
}

// the open resume's name, from the rename field (on Enter or when the field is left)
function rename(box){
  const id = st().openId, r = RS.savedOf(st(), id), v = k => box.querySelector(k).value.trim(), role = v('#sw-rn'), company = v('#sw-rn-co'), word = v('#sw-rn-word');
  if (!r || !(company || role) || (company === (r.company ?? '') && role === (r.role ?? '') && word === RS.wordOf(r))){ box.querySelector('#sw-rn').value = r?.role ?? ''; box.querySelector('#sw-rn-co').value = r?.company ?? ''; box.querySelector('#sw-rn-word').value = RS.wordOf(r); return; }
  let res;
  try { C.store.commit(d => { res = RS.renameSaved(d, id, RS.nameFrom({ company, role, word }), { company, role }); }, t('ux1.undoRename')); } catch (e){ C.toast(e.message, 'bad'); return; }
  if (res) noteRename(id, res.id);
}

function bind(){
  el = document.createElement('div');
  el.id = 'switcher';
  el.className = 'pop card switcher';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('ux1.switcherTitle'));
  document.getElementById('head').after(el);        // under the name card: with it, one card while the window is open
  new ResizeObserver(geo).observe(document.getElementById('head'));
  el.addEventListener('input', e => {
    if (e.target.id === 'sw-q'){ S.q = e.target.value; render(); }
    else if (e.target.id === 'sw-rn' || e.target.id === 'sw-rn-co') warnCheck();
  });
  el.addEventListener('mouseover', e => {
    const row = e.target.closest?.('.sopt, .snapline');
    const key = row ? `${row.dataset.id ?? row.closest('.swrow')?.dataset.rid}:${row.dataset.sid ?? ''}` : null;
    if (!row || S.hover === key || C.resumes.rowOpen) return;
    S.hover = key;
    if (row.classList.contains('snapline')){
      const r = RS.savedOf(st(), row.dataset.id), snap = r && RS.snapshotsOf(r).find(x => x.id === row.dataset.sid);
      if (snap) C.previewRecipe(RS.snapshotRecipe(C.work(), snap), null);
    } else C.resumes.previewSaved(row.dataset.id);
  });
  el.addEventListener('mouseout', e => {
    if (e.relatedTarget && el.contains(e.relatedTarget) && e.relatedTarget.closest?.('.sopt, .snapline')) return;
    if (S.hover === null) return;
    S.hover = null;
    C.endPreview();
  });
  el.addEventListener('focusin', e => {
    const row = e.target.closest?.('.sopt');
    if (row && S.hover !== `${row.dataset.id}:`){ S.hover = `${row.dataset.id}:`; C.resumes.previewSaved(row.dataset.id); }
  });
  // a name is saved when its fields are left; not while the warning shows and the focus goes to Duplicate as new, which makes the copy instead
  el.addEventListener('focusout', e => {
    const box = e.target.closest?.('#sw-rnbox');
    if (!box || box.dataset.rid !== st().openId || e.relatedTarget?.closest?.('#sw-rnbox') || (warnOn() && e.relatedTarget?.closest?.('.nw-dup'))) return;      // not a field drawn for another resume
    rename(box); warnCheck();
  });
  // a press on Duplicate as new keeps the focus in the field, so leaving it does not save the typed name first
  el.addEventListener('mousedown', e => { if (warnOn() && e.target.closest?.('.nw-dup')) e.preventDefault(); });
  el.addEventListener('focusout', e => { if (e.target.classList?.contains('swren') && !e.relatedTarget?.closest?.('.swrenbox')) C.resumes.renameDone(e.target, true); });
  el.addEventListener('keydown', e => {
    if (e.target.classList?.contains('swren')){
      if (e.key === 'Enter'){ e.preventDefault(); C.resumes.renameDone(e.target, true); }
      if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); C.resumes.renameDone(e.target, false); }
      return;
    }
    if (e.target.closest('.rowmenu')){ if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); C.resumes.closeMenus(); } return; }
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); if (!C.resumes.askOff()) close({ focusBack: true }); return; }
    if (e.target.closest('#sw-rnbox') && e.key === 'Enter' && e.target.tagName === 'INPUT'){ e.preventDefault(); close({ focusBack: true }); return; }      // Enter confirms the name
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      if (e.target.tagName === 'SELECT') return;
      const items = navItems();
      const at = items.indexOf(document.activeElement);
      const next = items[Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next){ e.preventDefault(); next.focus(); }
      return;
    }
    // typing anywhere goes to the search box
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest('input, select, textarea, .ddbtn')) el.querySelector('#sw-q')?.focus();
  });
  document.addEventListener('mousedown', e => {
    if (!e.target.closest('.nw-lpop, .nw-code')) closeList();
    if (S.open && !e.target.closest('#switcher, #docname-btn, #foot, .nw-lpop')) close();
  });
  // the card's language code is a button inside the name's button: Enter, Space and the down arrow open its list; the list walks with the arrows
  document.addEventListener('keydown', e => {
    if (e.target.classList?.contains('nw-code') && ['Enter', ' ', 'ArrowDown'].includes(e.key)){ e.preventDefault(); e.stopPropagation(); openList(e.target); return; }
    const pop = e.target.closest?.('.nw-lpop');
    if (!pop) return;
    const items = [...pop.querySelectorAll('button')], at = items.indexOf(e.target);
    if (e.key === 'Escape' || e.key === 'Tab'){ e.preventDefault(); e.stopPropagation(); closeList(); document.querySelector('#head .nw-code')?.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
  }, true);
  addEventListener('resize', closeList);
}

export function initSwitcher(ctx){
  C = ctx;
  return { bind, act, open, close, toggle, openOrFocus, render, counts, noteOpen, noteRename, get isOpen(){ return S.open; } };
}
