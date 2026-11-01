// The skill wordbank in the Editor (src/model/skillbank.js). While Skills or one of its groups is selected, the bank is a window of its own
// under the sidebar card (#bankcard): Find or add, the words not on this resume by shelf, Start from a resume, and the words view (every word,
// its wordings, every resume). The sidebar card lists the page's groups by name (namesHtml): the picked group (the selection) takes the words.
// Words move by a pointer drag: on the page, between the page and the bank, and in the bank. The page is a frame, so a drag is the app's own
// pointer drag, never HTML5's: one carried copy above everything (the page's type over the page, a chip past it), the words making room as it
// goes (a dead band in the middle of a word, a little hold after a move, resistance between groups), and the place it is let go is where it lands.
// Whole groups move with the page's own grips (src/ui/hands.js), which also take one dropped on the bank off the resume.

import * as T from '../model/resume.js';
import * as SB from '../model/skillbank.js';
import * as RS from '../model/resumes.js';
import { langName, DEFAULT_LANG } from '../model/lang.js';
import { t, h, errText } from '../i18n/index.js';
import { esc, delBtn } from './parts.js';
import { icon } from './icons.js';
import { reduced } from './motion.js';
import { tierAll } from './press.js';

const $ = s => document.querySelector(s);
const HUES = [5, 4, 1, 3, 2, 6];      // the app's swatch hues (src/ui/career.js SWATCH_HUES), one per group in page order
const RESIST = 28, DWELL = 450, BAND = 0.2, HOLD_PX = 10, MOVE = 5, SLIDE_MS = 170;
const PAGE_ICON = '<svg class="ico" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><rect x="4.2" y="2.4" width="7.6" height="11.2" rx="1.4"/></svg>';

export function initWordbank(C){
  const B = { q: '', warned: null, view: null, wlang: null, delw: null, wadd: null };
  let D = null, justDragged = 0;
  const card = $('#bankcard');
  const st = () => C.store.state, rec = () => C.record(), cur = () => C.cur(), L = () => cur()?.lang ?? DEFAULT_LANG;
  const groups = () => (cur() ? T.arrangementOf(rec(), cur()).groups : []);
  const head = g => T.groupHeading(rec(), cur(), g) || t('wb.unnamed');
  const hue = i => `var(--hue-${HUES[i % HUES.length]})`;
  const onRes = () => T.wordsOnResume(rec(), cur());
  const wtext = id => SB.wordText(rec(), id, L());
  const sel = () => C.ui.sel;
  // the group picked on the page: the selection (a group, or its heading being written)
  const pick = () => { const s = sel(); if (s.kind !== 'bullet' || s.section !== 'skills') return null; const id = s.id.replace(/^~g:/, ''); return groups().some(g => g.id === id) ? id : null; };
  const active = () => !!cur() && !C.ui.view && !C.ui.snap && !C.ui.layout?.phone && (sel().kind === 'section' ? sel().id === 'skills' : sel().kind === 'bullet' && sel().section === 'skills');
  const commit = (fn, label, done, undo = false) => {
    try { const changed = C.store.commit(d => { fn(d); }, label); if (changed && done) C.toast(done, '', undo); return changed; }
    catch (e){ C.toast(errText(e), 'bad'); return false; }
  };
  const pickGroup = gid => C.select(gid ? { kind: 'bullet', id: gid, section: 'skills' } : { kind: 'section', id: 'skills' });
  const flash = sel => { for (const e of document.querySelectorAll(sel)){ e.classList.remove('wb-flash'); void e.offsetWidth; e.classList.add('wb-flash'); } };
  // a word taken with no group picked goes nowhere: a short message, and the groups to pick from flash (the names, and the page's skills)
  function nudge(){
    C.toast(groups().length ? t('wb.pickFirst') : t('wb.noGroup'), 'warn');
    for (const [e, c] of [[$('.sknames'), 'wb-nudge'], [C.sheet.doc?.querySelector('.skills'), 'rb-sknudge']]) if (e){ e.classList.remove(c); void e.offsetWidth; e.classList.add(c); }
  }
  // a word of the bank into the picked group (from the bank, or from another group): at its end
  function take(wid){
    const g = pick();
    if (!g) return nudge();
    if (onRes().get(wid) === g) return;
    commit(d => T.placeWord(d.record, d.cur, wid, g), t('wb.undoPlace'));
  }

  // ---- the sidebar card: the page's groups by name, under Position ----
  function namesHtml(){
    const gs = groups(), p = pick();
    if (!gs.length) return `<p class="muted small sknone">${h('wb.noGroups')}</p>`;
    return `<div class="sknames" role="group" aria-label="${esc(t('wb.groupsLabel'))}">${gs.map((g, i) => { const on = g.id === p;
      return `<button type="button" class="skname${on ? ' is-pick' : ''}" style="--gh:${hue(i)}" data-act="sk-pick" data-g="${esc(g.id)}" aria-pressed="${on}" title="${esc(on ? t('wb.pickedTip') : t('wb.pickTip'))}"><i aria-hidden="true"></i>${esc(head(g))}</button>`; }).join('')}</div>`;
  }
  const delGroupHtml = () => (pick() ? delBtn('data-act="sk-delgroup"', t('wb.deleteGroup'), { name: t('wb.deleteGroupTip') }) : '');
  function deleteGroup(gid){
    const g = groups().find(x => x.id === gid);
    if (!g) return;
    const name = head(g);
    if (commit(d => T.removeSkillGroup(d.record, d.cur, gid), t('wb.undoDeleteGroup'), t('wb.groupDeleted', { name }), true) && pick() === null) pickGroup(null);
    else if (sel().id.replace(/^~g:/, '') === gid) pickGroup(null);
  }

  // ---- the bank's window ----
  const forms = w => [w.name, ...Object.values(rec().i18n ?? {}).map(l => l?.labels?.[w.id]).filter(Boolean)];
  const matches = (w, q) => !q || forms(w).some(f => SB.norm(f).includes(q));
  const chip = (w, { cls = '', act = 'wb-take' } = {}) => {
    const x = SB.wordText(rec(), w.id, L());
    return `<button type="button" class="skchip wbchip${x.miss ? ' miss' : ''}${cls}" data-act="${act}" data-id="${esc(w.id)}" data-key="${act}:${esc(w.id)}" title="${esc(x.miss ? t('wb.missTip', { lang: langName(L()) }) : pick() ? t('wb.takeTip', { group: head(groups().find(g => g.id === pick())) }) : t('wb.pickFirst'))}">${esc(x.text)}</button>`
      + (x.miss && act === 'wb-take' ? `<button type="button" class="wbfix" data-act="wb-fix" data-id="${esc(w.id)}" title="${esc(t('wb.writeIn', { lang: langName(L()) }))}">${esc(L())}</button>` : '');
  };
  function plusHtml(){
    const q = B.q.trim(), sim = q ? SB.similar(rec(), q) : null, gi = groups().findIndex(g => g.id === pick());
    if (sim?.exact) return '';
    const near = !!sim?.near.length, warned = near && B.warned === q, g = gi >= 0 ? groups()[gi] : null;
    return `<button type="button" class="obplus press is-free wbqplus${q ? ' has-text' : ''}${near ? ' near' : ''}${warned ? ' warned' : ''}" data-tier="tertiary" data-act="wb-add" data-key="wb-add"${q && g ? ` style="--gh:${hue(gi)}"` : ''}
      title="${esc(!q ? t('wb.addEmpty') : warned ? t('wb.addAgain') : near ? t('wb.addNear') : g ? t('wb.addTo', { word: q, group: head(g) }) : t('wb.addBank', { word: q }))}" aria-label="${esc(q ? t('wb.addBank', { word: q }) : t('wb.addEmpty'))}">${icon('add', { role: 'inline' })}${q ? `<span>${h('wb.add')}</span>` : ''}</button>`;
  }
  function findHtml(){
    const q = B.q.trim();
    if (!q) return '';
    const { exact, near } = SB.similar(rec(), q);
    if (exact){ const n = RS.wordUses(st(), exact.id).length;
      return `<div class="wbaddrow dup"><span class="wbmark" title="${esc(t('wb.exactTip'))}">=</span>${chip(exact)}<span class="wbuses" title="${esc(t('wb.usesTip', { n }))}">${PAGE_ICON}${n}</span><span class="grow"></span>${delBtn(`data-act="wb-delw" data-id="${esc(exact.id)}"`, t('wb.delete'), { name: t('wb.deleteWord', { word: exact.name }) })}</div>`; }
    return near.length ? `<div class="wbaddrow near"><span class="wbmark" title="${esc(t('wb.nearTip'))}">≈</span>${near.map(w => chip(w)).join('')}</div>` : '';
  }
  function delwHtml(){
    const w = B.delw && SB.wordOf(rec(), B.delw);
    if (!w) return '';
    const us = RS.wordUses(st(), w.id), n = us.length;
    return `<div class="wbdelw missbar delask" role="alertdialog" aria-label="${esc(t('wb.deleteWord', { word: w.name }))}"><p><b>${esc(t('wb.deleteQ', { word: wtext(w.id).text }))}</b> ${esc(n ? t('wb.deleteOn', { n }) : t('wb.deleteNone'))}</p>
      ${n ? `<ul>${us.map(r => `<li>${esc(C.resumeName(r))}</li>`).join('')}</ul>` : ''}
      <div class="btns"><button type="button" class="ghost sm" data-act="wb-delw-no" data-key="wb-delw-no">${h('btn.cancel')}</button>${delBtn('data-act="wb-delw-yes" data-key="wb-delw-yes"', n ? t('wb.deleteFrom') : t('wb.delete'))}</div></div>`;
  }
  // the words not on this resume: first the ones on no shelf (no name beside them), then each shelf, always shown (an empty one says so quietly)
  function trayHtml(){
    const used = onRes(), q = SB.norm(B.q), words = SB.wordsOf(rec()), shelves = SB.shelvesOf(rec());
    const known = new Set(shelves.map(s => s.id));
    const free = list => list.filter(w => !used.has(w.id) && matches(w, q));
    const loose = free(words.filter(w => !w.shelf || !known.has(w.shelf)));
    const rows = [];
    if (loose.length) rows.push(`<div class="wbsec wbloose" data-sec="">${'<span class="wbclu"></span>'}<div class="wbtiles">${loose.map(w => chip(w)).join('')}</div></div>`);
    for (const s of shelves){
      const all = words.filter(w => w.shelf === s.id), ws = free(all);
      if (q && !ws.length) continue;
      const note = ws.length ? '' : `<span class="wbshelfnote">${h(all.length ? 'wb.allHere' : 'wb.noWords')}</span>`;
      rows.push(`<div class="wbsec" data-sec="${esc(s.id)}" title="${esc(t('wb.shelfTip'))}"><span class="wbclu">${esc(SB.shelfName(rec(), s.id, L()))}</span><div class="wbtiles">${note}${ws.map(w => chip(w)).join('')}</div></div>`);
    }
    if (!rows.length && !q) rows.push(`<p class="muted small wbempty">${h(words.length ? 'wb.allOnResume' : 'wb.bankEmpty')}</p>`);      // (while finding, the row under the box says it)
    return `<div class="wbtray" data-bankdrop>${rows.join('')}</div>`;
  }
  // the languages this resume has copies in (English, the words themselves, first)
  const stripLangs = () => [...new Set([DEFAULT_LANG, ...RS.groupOf(st(), cur()).map(r => r.lang ?? DEFAULT_LANG), L()])];
  // what is missing in a language: shelf names, then words, the words on this resume first (they print outlined)
  const todoOf = l => (l === DEFAULT_LANG ? { shelves: [], words: [] } : { shelves: SB.shelvesOf(rec()).filter(x => !SB.labelIn(rec(), x.id, l)),
    words: SB.wordsOf(rec()).filter(w => SB.wordText(rec(), w.id, l).miss).sort((a, b) => onRes().has(b.id) - onRes().has(a.id)) });
  const missIn = l => { const x = todoOf(l); return x.shelves.length + x.words.length; };
  // the language the globe offers: the resume's own when it lacks something, else the first copy language that does
  const trLang = () => { const ls = stripLangs().filter(l => l !== DEFAULT_LANG); return [L(), ...ls].find(l => l !== DEFAULT_LANG && missIn(l)) ?? (L() !== DEFAULT_LANG ? L() : ls[0]); };
  function trBtnHtml(){
    const ls = stripLangs().filter(l => l !== DEFAULT_LANG);
    if (!ls.length) return '';
    const l = trLang(), n = missIn(l), all = ls.map(x => [x, missIn(x)]).filter(([, k]) => k);
    return `<button type="button" class="ib press wbtr${n ? ' miss' : ''}" data-tier="tertiary" data-act="wb-tr" data-key="wb-tr" aria-pressed="${B.view === 'words' && B.wlang !== DEFAULT_LANG}" title="${esc(all.length ? t('wb.trTodo', { list: all.map(([x, k]) => `${langName(x)} ${k}`).join(', ') }) : t('wb.trDone'))}" aria-label="${esc(t('wb.tr'))}">${icon('globe')}${n ? `<span>${esc(l.toUpperCase())} ${n}</span>` : ''}</button>`;
  }
  // the words view on a language, scrolled to its top; `wid`: that word's line in focus, with a short ring
  function openWords(l, wid = null){
    Object.assign(B, { view: 'words', wlang: l, delw: null });
    render();
    if (card) card.scrollTop = 0;
    const key = wid ? `in:${wid}:${l}` : l === DEFAULT_LANG ? null : (() => { const x = todoOf(l); return x.shelves[0] ? `sl:${x.shelves[0].id}:${l}` : x.words[0] ? `in:${x.words[0].id}:${l}` : null; })();
    const n = key && card?.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (n){ n.focus({ preventScroll: true }); n.scrollIntoView({ block: 'center' }); if (wid) flashEl(n); }
  }
  const flashEl = n => { n.classList.remove('wb-ring'); void n.offsetWidth; n.classList.add('wb-ring'); };
  function lineHtml(w, l, del = true){
    const rev = (w.needsReview ?? []).includes(l), revTag = rev ? `<i class="wbrev" title="${esc(t('wb.reviewTip'))}">${h('wb.review')}</i>` : '';
    const eq = `<button type="button" class="wbeq" data-act="wb-same" data-id="${esc(w.id)}" data-key="eq:${esc(w.id)}" aria-pressed="${!!w.same}" title="${esc(t(w.same ? 'wb.sameOn' : 'wb.sameOff'))}" aria-label="${esc(t('wb.sameLabel', { word: w.name }))}">=</button>`;
    const x = del ? delBtn(`data-act="wb-delw" data-id="${esc(w.id)}"`, t('wb.delete'), { text: false, name: t('wb.deleteWord', { word: w.name }) }) : '';
    if (l === DEFAULT_LANG) return `<div class="wbrow"><span class="wbcell"><input class="wbin${rev ? ' rev' : ''}" data-wl="${esc(w.id)}" data-l="en" data-key="in:${esc(w.id)}:en" value="${esc(w.name)}" aria-label="${esc(t('wb.inLang', { word: w.name, lang: langName('en') }))}" autocomplete="off">${revTag}</span>${eq}${x}</div>`;
    const v = SB.labelIn(rec(), w.id, l) ?? '';
    return `<div class="wbrow"><span class="wben" title="${esc(w.name)}">${esc(w.name)}</span>${w.same ? `<span class="wbsame" title="${esc(t('wb.sameEvery'))}">${esc(w.name)}</span>`
      : `<span class="wbcell"><input class="wbin${v ? '' : ' empty'}${rev ? ' rev' : ''}" data-wl="${esc(w.id)}" data-l="${l}" data-key="in:${esc(w.id)}:${l}" value="${esc(v)}" placeholder="${esc(w.name)}" aria-label="${esc(t('wb.inLang', { word: w.name, lang: langName(l) }))}" autocomplete="off">${revTag}</span>`}${eq}${x}</div>`;
  }
  const shelfLine = (s, l) => `<div class="wbrow wbrowg"><span class="wbcell"><input class="wbin" data-sl="${esc(s.id)}" data-l="${l}" data-key="sl:${esc(s.id)}:${l}" value="${esc(l === DEFAULT_LANG ? s.name : SB.labelIn(rec(), s.id, l) ?? '')}" placeholder="${esc(s.name)}" aria-label="${esc(t('wb.shelfIn', { lang: langName(l) }))}" autocomplete="off"></span><span></span>${delBtn(`data-act="wb-delshelf" data-id="${esc(s.id)}"`, t('wb.deleteShelf'), { text: false, name: t('wb.deleteShelf') })}</div>`;
  const stripHtml = l => `<div class="seg fill wbstrip" role="group" aria-label="${esc(t('wb.writeLang'))}">${stripLangs().map(x => { const n = missIn(x);
    return `<button type="button" data-act="wb-wlang" data-l="${x}" data-key="wl:${x}" aria-pressed="${x === l}" title="${esc(langName(x))}${x === DEFAULT_LANG ? '' : esc(n ? ` · ${t('wb.missing', { n })}` : '')}">${x.toUpperCase()}${x === DEFAULT_LANG ? '' : `<small class="${n ? '' : 'ok'}">${n ? n : '✓'}</small>`}</button>`; }).join('')}</div>`;
  const wlangNow = () => (stripLangs().includes(B.wlang) ? B.wlang : DEFAULT_LANG);
  function wordsHtml(){
    const l = wlangNow(), todo = todoOf(l), n = todo.shelves.length + todo.words.length;
    const skipW = new Set(todo.words.map(w => w.id)), skipS = new Set(todo.shelves.map(x => x.id));
    const words = SB.wordsOf(rec()), known = new Set(SB.shelvesOf(rec()).map(x => x.id));
    const head = x => (skipS.has(x.id) ? `<div class="wbrow wbrowg"><span class="wben">${esc(x.name)}</span></div>` : shelfLine(x, l));
    const first = n ? `<p class="wbtodo">${h('wb.missing', { n })}</p>${todo.shelves.map(x => shelfLine(x, l)).join('')}${todo.words.map(w => lineHtml(w, l)).join('')}<hr class="wbsep">` : '';
    const rows = [...words.filter(w => (!w.shelf || !known.has(w.shelf)) && !skipW.has(w.id)).map(w => lineHtml(w, l)),
      ...SB.shelvesOf(rec()).flatMap(x => [head(x), ...words.filter(w => w.shelf === x.id && !skipW.has(w.id)).map(w => lineHtml(w, l))])];
    return `<div class="wbedit"><div class="wbgrid${l === DEFAULT_LANG ? ' en' : ''}">${first}${rows.join('') || (n ? '' : `<p class="muted small">${h('wb.bankEmpty')}</p>`)}</div>
      <div class="btns"><button type="button" class="sm" data-act="wb-newshelf" data-key="wb-newshelf">${h('wb.newShelf')}</button><span class="grow"></span><button type="button" class="primary sm" data-act="wb-words-done" data-key="wb-done">${h('wb.done')}</button></div></div>`;
  }
  // Start from a resume: the other saved resumes by role, each with its groups as they print
  function fromHtml(){
    const others = (st().resumes ?? []).filter(r => r.id !== st().openId), byRole = new Map();
    for (const r of others){ const k = r.role || t('wb.noRole'); byRole.set(k, [...(byRole.get(k) ?? []), r]); }
    const groupsOf = r => T.arrangementOf(rec(), r).groups.filter(g => g.items.length)
      .map(g => `<p class="wbfromg"><b>${esc(T.groupHeading(rec(), r, g))}</b> ${esc(g.items.map(x => SB.wordText(rec(), x, r.lang ?? DEFAULT_LANG).text).join(', '))}</p>`).join('');
    return `<div class="wbfrom"><div class="wbfixh"><b>${h('wb.from')}</b><span class="grow"></span><button type="button" class="ghost sm" data-act="wb-from" aria-label="${esc(t('wb.close'))}">${icon('close', { role: 'inline' })}</button></div>
      ${others.length ? [...byRole].map(([role, rs]) => `<p class="wbclu wbrole">${esc(role)}</p>${rs.map(r => `<div class="wbfromr"><div class="wbfromt"><b>${esc(C.resumeName(r))}</b><span class="grow"></span><button type="button" class="sm" data-act="wb-use" data-id="${esc(r.id)}">${h('wb.useGroups')}</button></div>${groupsOf(r)}</div>`).join('')}`).join('')
        : `<p class="muted small">${h('wb.noOthers')}</p>`}</div>`;
  }
  function bankHtml(){
    const strip = B.view === 'words' && stripLangs().length > 1 ? `<div class="wbbar2">${stripHtml(wlangNow())}</div>` : '';
    const top = `<div class="wbtop"><div class="wbbar"><span class="wbqwrap"><input type="search" class="wbq" data-key="wb-q" placeholder="${esc(t('wb.find'))}" aria-label="${esc(t('wb.find'))}" value="${esc(B.q)}" autocomplete="off" spellcheck="false">${plusHtml()}</span>
      ${trBtnHtml()}<button type="button" class="ib press wbfromb" data-tier="tertiary" data-act="wb-from" data-key="wb-from" aria-pressed="${B.view === 'from'}" title="${esc(t('wb.from'))}" aria-label="${esc(t('wb.from'))}">${icon('list')}</button>
      <button type="button" class="ib press wbpen" data-tier="tertiary" data-act="wb-words" data-key="wb-pen" aria-pressed="${B.view === 'words' && B.wlang === DEFAULT_LANG}" title="${esc(t('wb.wordsTip'))}" aria-label="${esc(t('wb.wordsTip'))}">${icon('edit')}</button></div>${strip}</div>`;
    const body = B.view === 'words' ? wordsHtml() : B.view === 'from' ? fromHtml() : trayHtml();
    return `${top}${delwHtml()}${B.view === 'words' ? '' : findHtml()}${body}`;
  }
  function render(){
    if (!card) return;
    const on = active();
    card.hidden = !on;
    card.closest('.col')?.classList.toggle('has-bank', on);
    if (!on){ if (card.innerHTML) card.innerHTML = ''; return; }
    const a = document.activeElement, key = card.contains(a) ? a?.dataset?.key : null, ss = a?.selectionStart, se = a?.selectionEnd, top = card.scrollTop;
    if (a?.matches?.('.wbin') && card.contains(a)) return;      // a word being written is not redrawn under the caret (its change redraws when it is left)
    card.innerHTML = bankHtml();
    tierAll(card);
    card.scrollTop = top;
    if (key){ const n = card.querySelector(`[data-key="${CSS.escape(key)}"]`); if (n){ n.focus({ preventScroll: true }); if (ss != null && n.setSelectionRange) try { n.setSelectionRange(ss, se); } catch { /* not a text box */ } } }
  }
  const focusKey = k => card?.querySelector(`[data-key="${CSS.escape(k)}"]`)?.focus();
  const shake = el => { if (!el || reduced()) return; el.classList.remove('wb-shake'); void el.offsetWidth; el.classList.add('wb-shake'); };

  // Find or add: Enter, the "+" (or a word typed with commas, each) adds it to the bank on no shelf, and into the picked group. A word the bank has is
  // taken (with a group picked) or pointed at; with words like it shown, the first press only shakes the "+", the second adds.
  function addFromFind(){
    const text = B.q.trim();
    if (!text){ focusKey('wb-q'); return; }
    const parts = text.split(',').map(SB.cleanWord).filter(Boolean), g = pick();
    if (parts.length === 1){
      const { exact, near } = SB.similar(rec(), parts[0]);
      if (exact){
        B.q = ''; B.warned = null;
        if (g && onRes().get(exact.id) !== g) take(exact.id);
        else { C.toast(t('wb.inBank', { word: wtext(exact.id).text }), ''); render(); }
        focusKey('wb-q'); return;
      }
      if (near.length && B.warned !== parts[0]){ B.warned = parts[0]; render(); shake(card.querySelector('.wbqplus')); focusKey('wb-q'); return; }
    }
    B.q = ''; B.warned = null;
    let added = 0;
    commit(d => { for (const p of parts){ const ex = SB.findWord(d.record, p); const w = ex ?? (added++, SB.addWord(d.record, { name: p, lang: d.cur.lang ?? DEFAULT_LANG })); if (g && T.wordsOnResume(d.record, d.cur).get(w.id) !== g) T.placeWord(d.record, d.cur, w.id, g); } },
      t('wb.undoAdd'), parts.length === 1 ? t(g ? 'wb.addedTo' : 'wb.added', { word: parts[0], group: g ? head(groups().find(x => x.id === g)) : '' }) : null, true);
    focusKey('wb-q');
  }
  function deleteWord(wid){
    const w = SB.wordOf(rec(), wid);
    if (!w) return;
    B.delw = null;
    let n = 0;
    commit(d => { n = RS.dropWordEverywhere(d, wid); }, t('wb.undoDelete'));
    C.toast(t(n ? 'wb.deletedOn' : 'wb.deleted', { word: w.name, n }), '', true);
  }

  if (card){
    card.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || performance.now() - justDragged < 300) return;
      const a = b.dataset.act, id = b.dataset.id;
      if (a === 'wb-take') take(id);
      else if (a === 'wb-add') addFromFind();
      else if (a === 'wb-from'){ B.view = B.view === 'from' ? null : 'from'; render(); }
      else if (a === 'wb-words'){ if (B.view === 'words' && B.wlang === DEFAULT_LANG){ B.view = null; render(); } else openWords(DEFAULT_LANG); }
      else if (a === 'wb-words-done'){ B.view = null; render(); }
      else if (a === 'wb-tr'){ if (B.view === 'words' && B.wlang !== DEFAULT_LANG){ B.view = null; render(); } else openWords(trLang()); }
      else if (a === 'wb-wlang') openWords(b.dataset.l);
      else if (a === 'wb-same'){ const w = SB.wordOf(rec(), id); commit(d => SB.setWordSame(d.record, id, !w.same), t('wb.undoSame')); }
      else if (a === 'wb-delw'){ B.delw = id; render(); focusKey('wb-delw-no'); }
      else if (a === 'wb-delw-no'){ B.delw = null; render(); }
      else if (a === 'wb-delw-yes') deleteWord(B.delw);
      else if (a === 'wb-fix') openWords(L(), id);
      else if (a === 'wb-newshelf'){ let sid; commit(d => { sid = SB.addShelf(d.record, t('wb.newShelf'), DEFAULT_LANG).id; }, t('wb.undoShelf')); B.wlang = DEFAULT_LANG; render(); const n = card.querySelector(`[data-key="sl:${CSS.escape(sid ?? '')}:en"]`); n?.focus(); n?.select(); }
      else if (a === 'wb-delshelf') commit(d => SB.dropShelf(d.record, id), t('wb.undoShelf'), t('wb.shelfDeleted'), true);
      else if (a === 'wb-use'){ const src = (st().resumes ?? []).find(r => r.id === id); if (src && commit(d => T.useGroupsOf(d.record, d.cur, src), t('wb.undoFrom'), t('wb.startedFrom', { name: C.resumeName(src) }), true)){ B.view = null; pickGroup(null); } }
    });
    card.addEventListener('input', e => {
      if (e.target.matches('.wbq')){ B.q = e.target.value; B.warned = null; render(); }
    });
    card.addEventListener('keydown', e => {
      const x = e.target;
      if (x.matches('.wbq') && e.key === 'Enter' && !e.isComposing){ e.preventDefault(); addFromFind(); }
      else if (x.matches('.wbq') && e.key === 'Escape' && B.q){ e.preventDefault(); e.stopPropagation(); B.q = ''; B.warned = null; render(); }
      else if (x.matches('.wbin') && e.key === 'Enter'){      // kept, and on to the next empty line
        e.preventDefault();
        const ins = [...card.querySelectorAll('.wbin')], next = ins.slice(ins.indexOf(x) + 1).find(n => !n.value.trim())?.dataset.key;
        x.blur();
        if (next) setTimeout(() => focusKey(next), 0);
      }
      else if (x.matches('.wbin') && e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); x.value = x.defaultValue; x.blur(); }
      else if (e.key === 'Escape' && (B.delw || B.view)){ e.preventDefault(); e.stopPropagation(); B.delw = null; B.view = null; render(); }
    });
    // a word's or a shelf's wording is kept when the box is left, as one undo step; every resume says it
    card.addEventListener('change', e => {
      const x = e.target;
      if (x.dataset.wl) commit(d => RS.renameWord(d.record, x.dataset.wl, x.dataset.l, x.value), t('wb.undoWord'));
      else if (x.dataset.sl) commit(d => SB.setShelfName(d.record, x.dataset.sl, x.dataset.l, x.value), t('wb.undoShelf'));
      if (x.dataset.wl || x.dataset.sl) setTimeout(render);
    });
    card.addEventListener('pointerdown', e => bankDown(e));
  }

  // ---- moving words: the carried copy, the places it can go, and the drop ----
  const cam = () => C.canvas.cam;
  const toScreen = q => ({ x: cam().x + q.x * cam().k, y: cam().y + q.y * cam().k });
  const toFrame = p => ({ x: (p.x - cam().x) / cam().k, y: (p.y - cam().y) / cam().k });
  const fdoc = () => C.sheet.doc;
  const locked = id => !!id && C.edit().lockedId(id);
  function bankDown(e){
    const c = e.target.closest('.wbtray .wbchip[data-id], .wbaddrow .wbchip[data-id]');
    if (!c || e.button !== 0 || e.pointerType === 'touch') return;
    const r = c.getBoundingClientRect();
    D = { wid: c.dataset.id, from: 'bank', x0: e.clientX, y0: e.clientY, on: false, el: c, fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, home: null, t: null, key: 'null' };
    try { c.setPointerCapture(e.pointerId); } catch { /* the drag still follows the pointer over the bank */ }
    c.addEventListener('pointermove', bankMove);
    c.addEventListener('pointerup', bankUp, { once: true });
    c.addEventListener('pointercancel', () => end(true), { once: true });
  }
  const bankMove = e => { if (D?.from === 'bank') move({ x: e.clientX, y: e.clientY }, e); };
  const bankUp = e => { if (D?.from === 'bank'){ D.el?.removeEventListener('pointermove', bankMove); end(false, { x: e.clientX, y: e.clientY }); } };

  // The page's own events (the frame's pixels): a press on a word may become a drag; the rest is hands.js's. Returns true when taken.
  function pointer(e){
    if (e.type === 'leave'){ hoverGroup(null); hoverSection(false); return false; }
    if (C.ui.view || C.ui.snap || C.ui.layout?.phone) return false;
    const p = toScreen({ x: e.clientX, y: e.clientY });
    if (e.type === 'pointerdown'){
      const w = e.button === 0 && e.pointerType !== 'touch' && !e.target.closest?.('[contenteditable]') && e.target.closest?.('.skills__group [data-word]');
      if (!w) return false;
      const g = w.closest('[data-group]'), r = w.getBoundingClientRect();
      D = { wid: w.dataset.word, from: 'page', x0: p.x, y0: p.y, on: false, fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, home: g?.dataset.group ?? null, gid0: g?.dataset.group, pid: e.pointerId };
      D.t = D.home ? { gid: D.home, before: nextOf(D.home, D.wid) } : null; D.key = JSON.stringify(D.t);
      return true;
    }
    if (e.type === 'pointermove'){
      if (D?.from === 'page'){ move(p, e); return true; }
      if (!D){ hoverGroup(e.target.closest?.('[data-group]')?.dataset.group ?? null); hoverSection(!!e.target.closest?.('.band[data-section="skills"]')); }
      return false;
    }
    if ((e.type === 'pointerup' || e.type === 'pointercancel') && D?.from === 'page'){
      const was = D.on;
      end(e.type === 'pointercancel', p);
      if (!was && e.type === 'pointerup' && e.target.closest?.('[data-word].rb-miss')){ const wid = e.target.closest('[data-word]').dataset.word; setTimeout(() => openWords(L(), wid), 50); }      // a word missing in this language: its line, to write it
      return was;
    }
    return false;
  }
  // the word after `wid` in a group as the page has it now
  const idsIn = gid => SB.idsOf(rec(), groups().find(g => g.id === gid)?.items ?? [], L());
  const nextOf = (gid, wid) => { const ids = idsIn(gid), i = ids.indexOf(wid); return i < 0 ? null : ids[i + 1] ?? null; };

  function startCarry(){
    D.on = true;
    if (locked(D.home) || locked('skills')){ C.toast(t('uxr.locked'), 'warn'); D = null; return false; }
    const g = D.ghost = document.createElement('div');
    g.className = 'skchip wbghost'; g.textContent = wtext(D.wid).text; g.hidden = true;
    document.body.append(g);
    document.documentElement.classList.add('wb-carry');
    fdoc()?.documentElement.classList.add('rb-skcarry');
    if (D.from === 'page') try { fdoc()?.documentElement.setPointerCapture(D.pid); } catch { /* followed over the page */ }
    // the page's words as they are, by group: the preview moves these elements and slides the others
    D.page = new Map([...(fdoc()?.querySelectorAll('.skills__group[data-group]') ?? [])].map(gel => [gel.dataset.group, [...gel.querySelectorAll('[data-word]')]]));
    D.snap = new Map([...(fdoc()?.querySelectorAll('.skills__group[data-group] .skills__items') ?? [])].map(el => [el, el.innerHTML]));      // put back as it was when nothing changes
    fdoc()?.addEventListener('keydown', escape, true);
    D.el0 = fdoc()?.querySelector(`.skills__group [data-word="${CSS.escape(D.wid)}"]`) ?? null;
    D.home0 = D.home;
    if (D.from === 'bank') D.el?.classList.add('socket');
    return true;
  }
  function move(p, e){
    if (!D) return;
    if (!D.on){ if (Math.hypot(p.x - D.x0, p.y - D.y0) < MOVE || !startCarry()) return; }
    if (D.from === 'bank') e?.preventDefault?.();      // the page's own events are passive
    track(p);
  }
  // what is under a screen point: { gid, before } in a group (the page, or a group's name in the card), { off } back to the bank (a word from the page
  // over its own shelf or the window's margins), { shelf } onto a shelf, { bank, after } beside a word of the bank, { same } where it is, or null
  function hit(p){
    const top = document.elementFromPoint(p.x, p.y);
    if (top?.closest?.('#sheet') && fdoc()){
      const q = toFrame(p), el = fdoc().elementFromPoint(q.x, q.y), g = el?.closest?.('[data-group]');
      if (!g) return null;
      const gid = g.dataset.group, ids = shownIn(gid), w = el.closest('[data-word]');
      if (w){
        const id = w.dataset.word;
        if (id === D.wid) return { same: true };
        const r = w.getBoundingClientRect(), f = (q.x - r.left) / r.width;
        if (D.t?.gid === gid && Math.abs(f - 0.5) < BAND) return { same: true };      // the dead band: only where the word is shown already
        return { gid, before: f > 0.5 ? ids[ids.indexOf(id) + 1] ?? null : id };
      }
      if (el.closest('.skills__label')) return { gid, before: ids.find(x => x !== D.wid) ?? null };
      // its end only past the group's last word (right of it on its last line, or below); over the gap between two words it keeps its place
      const last = [...g.querySelectorAll('[data-word]')].filter(x => x.dataset.word !== D.wid).at(-1), rs = last?.getClientRects(), lr = rs?.[rs.length - 1];
      return !lr || q.y > lr.bottom || (q.y >= lr.top && q.x > lr.right) ? { gid, before: null } : { same: true };
    }
    const nm = top?.closest?.('.sknames [data-g]');
    if (nm) return { gid: nm.dataset.g, before: null };
    if (!top?.closest?.('#bankcard')) return null;
    const own = SB.wordOf(rec(), D.wid)?.shelf ?? '', off = D.from === 'page' || !!D.home0;
    const c = top.closest('.wbtray .wbchip[data-id]');
    if (c){
      const id = c.dataset.id;
      if (id === D.wid) return { same: true };
      const shelf = SB.wordOf(rec(), id)?.shelf ?? '';
      if (off && shelf === own) return { off: true };      // a word from the page, over its own shelf: it comes off, to its own place
      const r = c.getBoundingClientRect(), f = (p.x - r.left) / r.width;
      if (!off && shelf === own && Math.abs(f - 0.5) < BAND) return { same: true };
      return { bank: id, after: f > 0.5, off };
    }
    const sec = top.closest('.wbsec[data-sec]');
    if (sec){ const sid = sec.dataset.sec; if (off && sid === own) return { off: true }; if (sid !== own || top.closest('.wbclu, .wbshelfnote')) return { shelf: sid, off }; }
    return off ? { off: true } : null;
  }
  // the word ids a group shows during the drag (the preview's order)
  const shownIn = gid => (D.page.get(gid) ?? []).map(el => el.dataset.word);
  function track(p){
    D.p = p;
    let tg = hit(p);
    if (tg?.same || (tg && tg.before === D.wid)) tg = D.t;
    const top = document.elementFromPoint(p.x, p.y);
    if (!tg && top?.closest?.('#sheet, #bankcard')) tg = D.t;      // between places, over the page or the bank: it keeps its place
    clearTimeout(D.timer); D.strain = null;
    const curG = D.t?.gid ?? null;
    if (curG && tg?.gid && tg.gid !== curG && D.from === 'page'){      // into another group: it holds on a little
      const now = performance.now(), P = D.pend?.gid === tg.gid ? D.pend : (D.pend = { gid: tg.gid, x: p.x, y: p.y, at: now });
      if (Math.hypot(p.x - P.x, p.y - P.y) < RESIST && now - P.at < DWELL){ D.strain = tg.gid; D.timer = setTimeout(() => D && track(D.p), DWELL - (now - P.at) + 20); tg = D.t; }
      else D.pend = null;
    } else D.pend = null;
    const key = JSON.stringify(tg ?? null);
    const held = D.cp && Math.hypot(p.x - D.cp.x, p.y - D.cp.y) < HOLD_PX && tg && !tg.off && D.t && !D.t.off;      // just moved: it holds its place a little
    if (key !== D.key && !held){ D.key = key; D.t = tg; D.cp = p; preview(); }
    feel(p);
  }
  // the page shows the word where it would land (its slot), the others sliding to make room; off the page it leaves its group
  function preview(){
    const doc = fdoc();
    if (!doc) return;
    const was = new Map([...doc.querySelectorAll('.skills__group [data-word]')].map(el => [el, el.getBoundingClientRect()]));
    for (const list of D.page.values()){ const i = list.findIndex(el => el.dataset.word === D.wid); if (i >= 0) list.splice(i, 1); }
    let el = D.el0;
    if (D.t?.gid && D.page.has(D.t.gid)){
      if (!el){ el = D.el0 = doc.createElement('span'); el.setAttribute('data-skill', ''); el.setAttribute('data-word', D.wid); el.textContent = wtext(D.wid).text; }
      const list = D.page.get(D.t.gid), at = D.t.before ? list.findIndex(x => x.dataset.word === D.t.before) : -1;
      list.splice(at < 0 ? list.length : at, 0, el);
      el.classList.add('rb-wsocket');
    }
    for (const [gid, list] of D.page){
      const items = doc.querySelector(`.skills__group[data-group="${CSS.escape(gid)}"] .skills__items`);
      if (!items) continue;
      const kids = []; list.forEach((x, i) => { if (i) kids.push(doc.createTextNode(', ')); kids.push(x); });
      items.replaceChildren(...kids);
    }
    if (el && !D.t?.gid) el.remove();
    if (reduced()) return;
    for (const [x, a] of was){
      if (!x.isConnected || x === el) continue;
      const b = x.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      x.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: SLIDE_MS, easing: 'cubic-bezier(.2, .8, .3, 1)' });
    }
  }
  // The carried copy follows the pointer, held where it was grabbed: in the page's type over the sheet, a chip past its edge
  function feel(p){
    const g = D.ghost, boxes = C.sheet.pageBoxes().map(b => C.canvas.screenRect(b)), pages = $('#pages')?.getBoundingClientRect();
    const overPage = boxes.some(b => p.x >= b.left && p.x <= b.left + b.width && p.y >= b.top && p.y <= b.top + b.height) && (!pages || (p.x <= pages.right && p.y >= pages.top && p.y <= pages.bottom)) && !document.elementFromPoint(p.x, p.y)?.closest?.('.col');
    if (overPage !== D.asPage){
      D.asPage = overPage; g.classList.toggle('is-page', overPage);
      const items = fdoc()?.querySelector('.skills__items'), cs = overPage && items && fdoc().defaultView.getComputedStyle(items);
      Object.assign(g.style, cs ? { fontFamily: cs.fontFamily, fontSize: `${parseFloat(cs.fontSize) * cam().k}px`, fontWeight: cs.fontWeight, color: cs.color } : { fontFamily: '', fontSize: '', fontWeight: '', color: '' });
    }
    g.hidden = false;
    const r = g.getBoundingClientRect();
    g.style.transform = `translate(${p.x - D.fx * r.width}px, ${p.y - D.fy * r.height}px)`;
    fdoc()?.querySelectorAll('.rb-sknear').forEach(x => x.classList.remove('rb-sknear'));
    if (D.strain) fdoc()?.querySelector(`.skills__group[data-group="${CSS.escape(D.strain)}"]`)?.classList.add('rb-sknear');
    card?.classList.toggle('drop-bank', !!D.t?.off);
    document.querySelectorAll('.wbsec.drop-on').forEach(x => x.classList.remove('drop-on'));
    if (D.t?.shelf !== undefined) card?.querySelector(`.wbsec[data-sec="${CSS.escape(D.t.shelf)}"]`)?.classList.add('drop-on');
  }
  // The drop: where it is let go counts (even while the words slide), as one undo step. Esc, or a drop on no place, changes nothing.
  function end(cancel, p){
    const d = D;
    D = null;
    if (!d) return;
    clearTimeout(d.timer);
    if (!d.on) return;
    D = d; if (!cancel && p) track(p); D = null;
    justDragged = performance.now();
    d.ghost?.remove(); d.el?.classList.remove('socket');
    document.documentElement.classList.remove('wb-carry');
    fdoc()?.documentElement.classList.remove('rb-skcarry');
    fdoc()?.querySelectorAll('.rb-sknear, .rb-wsocket').forEach(x => x.classList.remove('rb-sknear', 'rb-wsocket'));
    fdoc()?.removeEventListener('keydown', escape, true);
    card?.classList.remove('drop-bank'); document.querySelectorAll('.wbsec.drop-on').forEach(x => x.classList.remove('drop-on'));
    const tg = d.t, home = d.home0, here = home && tg?.gid === home && tg.before === nextOf(home, d.wid);
    if (cancel || !tg || here){ for (const [el, html] of d.snap ?? []) if (el.isConnected) el.innerHTML = html; return; }
    const bankBefore = x => { const ws = SB.wordsOf(rec()), i = ws.findIndex(w => w.id === x.bank); return x.after ? ws[i + 1]?.id ?? null : x.bank; };
    commit(dr => {
      if (tg.gid){ T.placeWord(dr.record, dr.cur, d.wid, tg.gid, tg.before ?? null); return; }
      if (home) T.takeWord(dr.record, dr.cur, d.wid);
      if (tg.bank) SB.moveWord(dr.record, d.wid, { shelf: SB.wordOf(dr.record, tg.bank)?.shelf ?? null, beforeId: bankBefore(tg) });
      else if (tg.shelf !== undefined) SB.moveWord(dr.record, d.wid, { shelf: tg.shelf || null });
    }, tg.gid ? t('wb.undoPlace') : home ? t('wb.undoPlace') : t('wb.undoMoveWord'));
    if (tg.gid && tg.gid !== home) pickGroup(tg.gid);
  }
  function escape(e){ if (e.key === 'Escape' && D?.on){ e.preventDefault(); e.stopPropagation(); end(true); } }
  window.addEventListener('keydown', escape, true);

  // ---- a new skill from the page: a small round "+" after a group's last word, on hover; it opens the page's own text box there ----
  const lay = $('#handlay');
  const wplus = document.createElement('button');
  wplus.type = 'button'; wplus.className = 'obplus press is-free wbwplus'; wplus.dataset.tier = 'tertiary'; wplus.hidden = true;
  wplus.innerHTML = icon('add', { role: 'inline' });
  lay?.append(wplus);
  const wbox = document.createElement('div');
  wbox.className = 'wbwadd'; wbox.hidden = true;
  document.body.append(wbox);
  let plusOff = 0;
  const lastRect = gel => { const e = [...gel.querySelectorAll('[data-word]')].at(-1) ?? gel.querySelector('.skills__label'), rs = e?.getClientRects(); return rs?.[rs.length - 1] ?? e?.getBoundingClientRect(); };
  function hoverGroup(gid){
    clearTimeout(plusOff);
    const gel = gid && fdoc()?.querySelector(`.skills__group[data-group="${CSS.escape(gid)}"]`);
    if (!gel || D || B.wadd || !active() || locked(gid) || !lay){ plusOff = setTimeout(() => { if (!wplus.matches(':hover')) wplus.hidden = true; }, 250); return; }
    const q = lastRect(gel);
    if (!q) return;
    const a = toScreen({ x: q.right + 5, y: q.top + q.height / 2 }), lr = lay.getBoundingClientRect();
    Object.assign(wplus.style, { left: `${a.x - lr.left}px`, top: `${a.y - lr.top - 9}px` });
    wplus.dataset.g = gid; wplus.title = t('wb.plusTip'); wplus.setAttribute('aria-label', t('wb.plusTip'));
    wplus.hidden = false;
  }
  wplus.addEventListener('mouseleave', () => hoverGroup(null));
  // …and the app's "+" under the whole skills section, on its hover: a new group at the end, its heading written at once
  const splus = document.createElement('button');
  splus.type = 'button'; splus.className = 'obplus press wbsplus'; splus.dataset.tier = 'tertiary'; splus.hidden = true;
  splus.innerHTML = icon('add', { role: 'inline' });
  lay?.append(splus);
  let splusOff = 0;
  function hoverSection(on){
    clearTimeout(splusOff);
    const sk = on && fdoc()?.querySelector('.band[data-section="skills"] .skills');
    if (!sk || D || B.wadd || locked('skills') || !lay){ splusOff = setTimeout(() => { if (!splus.matches(':hover')) splus.hidden = true; }, 250); return; }
    const r = sk.getBoundingClientRect(), a = toScreen({ x: r.left + r.width / 2, y: r.bottom }), lr = lay.getBoundingClientRect();
    Object.assign(splus.style, { left: `${a.x - lr.left - 12}px`, top: `${a.y - lr.top + 4}px` });
    splus.title = t('ux6c.plusGroup'); splus.setAttribute('aria-label', t('ux6c.plusGroup'));
    splus.hidden = false;
  }
  splus.addEventListener('mouseleave', () => hoverSection(false));
  splus.addEventListener('click', () => { splus.hidden = true; C.edit().addGroup(groups().at(-1)?.id ?? null); });
  wplus.addEventListener('click', () => { wplus.hidden = true; openBox(wplus.dataset.g); });
  function openBox(gid){
    const gel = fdoc()?.querySelector(`.skills__group[data-group="${CSS.escape(gid)}"] .skills__items`);
    if (!gel) return;
    if (pick() !== gid) pickGroup(gid);
    const fresh = fdoc().querySelector(`.skills__group[data-group="${CSS.escape(gid)}"] .skills__items`) ?? gel;
    const box = fdoc().createElement('span');
    box.className = 'rb-newword'; box.contentEditable = 'plaintext-only'; box.spellcheck = false; box.setAttribute('role', 'textbox'); box.setAttribute('aria-label', t('wb.plusTip'));
    if (fresh.querySelector('[data-word]')) fresh.append(fdoc().createTextNode(', '));
    fresh.append(box);
    B.wadd = { gid, box, warned: null };
    box.addEventListener('input', boxRow);
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing){ e.preventDefault(); boxCommit(); }
      else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeBox(); }
    });
    box.addEventListener('blur', () => setTimeout(() => { if (B.wadd?.box === box && !wbox.matches(':hover')) closeBox(); }, 150));
    box.focus();
  }
  // under the box, the same marks as Find or add: "=" the word itself (Enter takes it), "≈" words like it; a new word needs no row at all
  function boxRow(){
    const a = B.wadd;
    if (!a) return;
    const text = SB.cleanWord(a.box.textContent), { exact, near } = SB.similar(rec(), text);
    a.box.classList.remove('rb-warned');
    wbox.innerHTML = !text ? '' : exact ? `<div class="wbaddrow dup"><span class="wbmark" title="${esc(t(onRes().get(exact.id) === a.gid ? 'wb.hereTip' : 'wb.exactTakeTip'))}">=</span>${chip(exact, { act: 'wb-boxtake' })}</div>`
      : near.length ? `<div class="wbaddrow near"><span class="wbmark" title="${esc(t('wb.nearTip'))}">≈</span>${near.map(w => chip(w, { act: 'wb-boxtake' })).join('')}</div>` : '';
    wbox.hidden = !wbox.innerHTML;
    const r = a.box.getBoundingClientRect(), s = toScreen({ x: r.left, y: r.bottom });
    Object.assign(wbox.style, { left: `${Math.min(s.x, innerWidth - 280)}px`, top: `${s.y + 6}px` });
  }
  wbox.addEventListener('pointerdown', e => e.preventDefault());      // the box keeps the caret
  wbox.addEventListener('click', e => { const c = e.target.closest('[data-act=wb-boxtake]'); if (c && B.wadd){ const gid = B.wadd.gid; closeBox(true); putIn(c.dataset.id, gid); } });
  const putIn = (wid, gid) => { if (onRes().get(wid) !== gid) commit(d => T.placeWord(d.record, d.cur, wid, gid), t('wb.undoPlace')); };
  function boxCommit(){
    const a = B.wadd, text = SB.cleanWord(a?.box.textContent);
    if (!a || !text) return closeBox();
    const { exact, near } = SB.similar(rec(), text);
    if (exact){ closeBox(true); putIn(exact.id, a.gid); return; }
    if (near.length && a.warned !== text){ a.warned = text; a.box.classList.add('rb-warned'); shake(a.box); return; }
    closeBox(true);
    commit(d => { const w = SB.addWord(d.record, { name: text, lang: d.cur.lang ?? DEFAULT_LANG }); T.placeWord(d.record, d.cur, w.id, a.gid); }, t('wb.undoAdd'));
  }
  function closeBox(quiet = false){
    const a = B.wadd;
    B.wadd = null; wbox.hidden = true; wbox.innerHTML = '';
    if (a && !quiet) C.redrawNow?.();
  }

  return {
    render, namesHtml, delGroupHtml, deleteGroup, pointer, pickGroup, take, openWords,
    // a group dragged by its grip and let go over the bank's window comes off the resume (src/ui/hands.js)
    overBank: (x, y) => !!card && !card.hidden && !!document.elementFromPoint(x, y)?.closest?.('#bankcard'),
    get dragging(){ return !!D?.on; },
    justDragged: () => performance.now() - justDragged < 300,
    get state(){ return { ...B, wadd: !!B.wadd, carry: D ? { on: D.on, from: D.from } : null, active: active() }; },      // for checks
  };
}
