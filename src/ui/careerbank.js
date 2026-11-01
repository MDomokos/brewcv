// The skill wordbank in Career (src/model/skillbank.js), in the look of the Editor's bank (src/ui/wordbank.js). Career's card "Skill words" docks the
// bank in the inspector: Find or add with the Editor's duplicate check ("=" the word itself, "≈" words like it, the first Enter warns), then every
// word by shelf in the bank's order, the words on no shelf first and every shelf shown. That order is the one the Editor's tray shows on every
// resume. Words and shelves move by a pointer drag, or Alt+arrows; a click on a shelf's name writes it. Under the box, "New shelf" and (while it
// would change something) "Sort by skill groups": a shelf from each record skill group, the words on no shelf onto their group's. The well under
// them takes the rest of the panel's height and scrolls inside (flow.css). A record skill group's form (career.js) shows
// its words as the bank's chips, with the same Find or add, and the record's groups by name: both move the same way. Translations stay in the
// Editor's words view (the pencil). Pure view state; every change is one undo step.

import * as SB from '../model/skillbank.js';
import * as RS from '../model/resumes.js';
import * as K from '../model/career.js';
import { DEFAULT_LANG } from '../model/resume.js';
import { langName } from '../model/lang.js';
import { t, h, errText } from '../i18n/index.js';
import { esc, delBtn, delAskHtml } from './parts.js';
import { icon } from './icons.js';
import { reduced } from './motion.js';
import { tierAll } from './press.js';

const HUES = [5, 4, 1, 3, 2, 6];      // the app's swatch hues, one per group in order, as the Editor's group names have them
const MOVE = 5;
const PAGE_ICON = '<svg class="ico" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><rect x="4.2" y="2.4" width="7.6" height="11.2" rx="1.4"/></svg>';
// what a drag holds (data-drag on the handle): a bank word, a shelf (its row), a word of a record group, a record group (its name)
const UNIT = { w: '[data-drag=w]', s: '.wbsec[data-sec]:not(.wbloose)', k: '[data-drag=k]', g: '[data-drag=g]' };
const SCOPE = { w: '.cwbtray', s: '.cwbtray', k: '.cwbkws', g: '.cwbgroups' };
// a unit's own id, safe in a selector: a redraw puts the focus back by it (shell.js, dock.js), so Alt+arrows keep it on what moved
const uid = (kind, x) => `cwb-${kind}-${String(x).replace(/[^A-Za-z0-9-]/g, c => `_${c.charCodeAt(0).toString(16)}_`)}`;

export function initCareerBank(C, { lang: L, keywordsOf, setKeywords }){
  const B = { q: '', warned: null, delw: null, shelf: null, kwWarned: null };
  let D = null, spent = false;      // spent: the click that ends a drag is not a click
  const rec = () => C.work(), st = () => C.store.state;
  const $b = s => document.querySelector(`#body ${s}`);
  const commit = (fn, label, done, undo = false) => {
    try { const ok = C.store.commit(d => { fn(d); }, label); if (ok && done) C.toast(done, '', undo); return ok; }
    catch (e){ C.toast(errText(e), 'bad'); return false; }
  };
  const shake = el => { if (!el || reduced()) return; el.classList.remove('wb-shake'); void el.offsetWidth; el.classList.add('wb-shake'); };
  const text = id => SB.wordText(rec(), id, L());

  const chip = (w, act, drag = true) => { const x = text(w.id);
    return `<button type="button" class="skchip wbchip${x.miss ? ' miss' : ''}" data-act="${act}" data-id="${esc(w.id)}"${drag ? ` data-drag="w" id="${uid('w', w.id)}"` : ''} data-key="${act}:${esc(w.id)}" title="${esc(x.miss ? t('wb.missTip', { lang: langName(L()) }) : drag ? t('career.bankChipTip') : t('wb.exactTip'))}">${esc(x.text)}</button>`; };
  // the round "+" at the end of a Find or add box; "+ Add" once something is typed, ringed when words like it are shown (and warned after a first press)
  function plusHtml(q, warned, act, group = null){
    q = q.trim();
    const sim = q ? SB.similar(rec(), q) : null;
    if (sim?.exact) return '';
    const near = !!sim?.near.length, w = near && warned === q;
    return `<button type="button" class="obplus press is-free wbqplus${q ? ' has-text' : ''}${near ? ' near' : ''}${w ? ' warned' : ''}" data-tier="tertiary" data-act="${act}" data-key="${act}"
      title="${esc(!q ? t('wb.addEmpty') : w ? t('wb.addAgain') : near ? t('wb.addNear') : group ? t('wb.addTo', { word: q, group }) : t('wb.addBank', { word: q }))}" aria-label="${esc(q ? t('wb.addBank', { word: q }) : t('wb.addEmpty'))}">${icon('add', { role: 'inline' })}${q ? `<span>${h('wb.add')}</span>` : ''}</button>`;
  }
  // under the box: "=" and the word the bank has (how many saved resumes print it, and its Delete), or "≈" and the words like it
  function rowHtml(q, act, del = false){
    q = q.trim();
    if (!q) return '';
    const { exact, near } = SB.similar(rec(), q);
    if (exact){ const n = RS.wordUses(st(), exact.id).length;
      return `<div class="wbaddrow dup"><span class="wbmark" title="${esc(t('wb.exactTip'))}">=</span>${chip(exact, act, false)}<span class="wbuses" title="${esc(t('wb.usesTip', { n }))}">${PAGE_ICON}${n}</span><span class="grow"></span>${del ? delBtn(`data-act="c-bk-delw" data-id="${esc(exact.id)}"`, t('wb.delete'), { name: t('wb.deleteWord', { word: exact.name }) }) : ''}</div>`; }
    return near.length ? `<div class="wbaddrow near"><span class="wbmark" title="${esc(t('wb.nearTip'))}">≈</span>${near.map(w => chip(w, act, false)).join('')}</div>` : '';
  }

  // ---- the bank ----
  // A word to delete: the saved resumes that print it are named first (the Editor's delete: the model takes it off them all, and Undo brings it back)
  function delwHtml(){
    const w = B.delw && SB.wordOf(rec(), B.delw);
    if (!w) return '';
    const us = RS.wordUses(st(), w.id), n = us.length;
    return delAskHtml(`${t('wb.deleteQ', { word: text(w.id).text })} ${n ? `${t('wb.deleteOn', { n })} ${us.map(r => RS.resumeLabel(r)).join(' · ')}` : t('wb.deleteNone')}`,
      'data-act="c-bk-delw-yes"', n ? t('wb.deleteFrom') : t('wb.delete'), 'data-act="c-bk-delw-no"');
  }
  // every word, by shelf: the ones on no shelf first (no name beside them; while a word is carried their row shows, so a word can go there), then
  // each shelf, always shown; while finding, only what matches
  function trayHtml(){
    const m = rec(), q = SB.norm(B.q), words = SB.wordsOf(m), shelves = SB.shelvesOf(m), known = new Set(shelves.map(s => s.id));
    const hit = w => !q || [w.name, ...Object.values(m.i18n ?? {}).map(l => l?.labels?.[w.id]).filter(Boolean)].some(f => SB.norm(f).includes(q));
    const loose = words.filter(w => (!w.shelf || !known.has(w.shelf)) && hit(w));
    const rows = [`<div class="wbsec wbloose" data-sec=""${loose.length ? '' : ' hidden'}><span class="wbclu"></span><div class="wbtiles">${loose.length ? loose.map(w => chip(w, 'c-bk-chip')).join('') : `<span class="wbshelfnote">${h('career.bankNoShelf')}</span>`}</div></div>`];
    for (const s of shelves){
      const ws = words.filter(w => w.shelf === s.id && hit(w));
      if (q && !ws.length) continue;
      const name = SB.shelfName(m, s.id, L());
      const head = B.shelf === s.id
        ? `<span class="wbclu cwbshelfed" data-form="bank"><input id="cb-shelf" class="wbin" data-sl="${esc(s.id)}" data-key="sl:${esc(s.id)}" value="${esc(name)}" aria-label="${esc(t('wb.shelfIn', { lang: langName(L()) }))}" autocomplete="off">${delBtn(`data-act="c-bk-delshelf" data-id="${esc(s.id)}"`, t('wb.deleteShelf'), { text: false })}</span>`
        : `<button type="button" class="wbclu cwbshelf" data-act="c-bk-shelf" data-drag="s" data-id="${esc(s.id)}" id="${uid('s', s.id)}" title="${esc(t('career.bankShelfTip'))}">${esc(name)}</button>`;
      rows.push(`<div class="wbsec" data-sec="${esc(s.id)}">${head}<div class="wbtiles">${ws.length ? ws.map(w => chip(w, 'c-bk-chip')).join('') : `<span class="wbshelfnote">${h('wb.noWords')}</span>`}</div></div>`);
    }
    if (!words.length && !shelves.length) rows.push(`<p class="muted small wbempty">${h('wb.bankEmpty')}</p>`);
    return `<div class="wbtray cwbtray">${rows.join('')}</div>`;
  }
  const sortHtml = () => { const r = SB.shelvesFromGroups(rec(), { dry: true });      // "Sort by skill groups" is shown while it would change something
    return r.shelves || r.words ? `<button type="button" class="sm ghost" data-act="c-bk-sort" title="${esc(t('career.bankSortTip'))}">${h('career.bankSort')}</button>` : ''; };
  const cardHtml = () => `<div class="cwb cwbbank"><div class="wbbar"><span class="wbqwrap"><i class="wbqico" aria-hidden="true">${icon('search', { role: 'inline' })}</i><input type="search" id="cb-q" class="sw-q wbq" data-key="cb-q" placeholder="${esc(t('wb.find'))}" aria-label="${esc(t('wb.find'))}" value="${esc(B.q)}" autocomplete="off" spellcheck="false">${plusHtml(B.q, B.warned, 'c-bk-add')}</span>
      <button type="button" class="ib press wbpen" data-tier="tertiary" data-act="c-bank" title="${esc(t('wb.wordsTip'))}" aria-label="${esc(t('wb.wordsTip'))}">${icon('edit')}</button></div>
    ${delwHtml()}${rowHtml(B.q, 'c-bk-chip', true)}
    <div class="btns"><button type="button" class="sm ghost" data-act="c-bk-newshelf">${h('wb.newShelf')}</button>${sortHtml()}</div>
    ${trayHtml()}</div>`;
  // the inspector, for Career's card
  const panelHtml = () => `<section class="insp insp-rec insp-bank"><h2 class="oi-name">${h('career.bankCard')} <small class="muted">${SB.wordsOf(rec()).length}</small></h2>
    <p class="scope">${h('career.bankScope')}</p>${cardHtml()}</section>`;
  // the card again, under the caret (what is typed in the box finds as it is typed)
  function redraw(){
    const el = $b('.cwbbank');
    if (!el) return;
    const a = document.activeElement, key = el.contains(a) ? a.dataset.key : null, ss = a?.selectionStart, se = a?.selectionEnd;
    el.outerHTML = cardHtml();
    const card = $b('.cwbbank');
    tierAll(card);
    const n = key && card.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (n){ n.focus({ preventScroll: true }); if (ss != null && n.setSelectionRange) try { n.setSelectionRange(ss, se); } catch { /* not a text box */ } }
  }
  // Enter or the "+" adds what is typed (each word, with commas) to the bank, on no shelf. A word the bank has is only named; with words like it
  // shown, the first press shakes the "+" and the second adds.
  function add(){
    const parts = B.q.split(',').map(SB.cleanWord).filter(Boolean);
    if (!parts.length){ $b('#cb-q')?.focus(); return; }
    if (parts.length === 1){
      const { exact, near } = SB.similar(rec(), parts[0]);
      if (exact){ B.q = ''; B.warned = null; C.toast(t('wb.inBank', { word: text(exact.id).text }), ''); redraw(); return; }
      if (near.length && B.warned !== parts[0]){ B.warned = parts[0]; redraw(); shake($b('.cwbbank .wbqplus')); return; }
    }
    B.q = ''; B.warned = null;
    redraw();
    commit(d => { for (const p of parts) if (!SB.findWord(d.record, p)) SB.addWord(d.record, { name: p, lang: L() }); }, t('wb.undoAdd'), parts.length === 1 ? t('wb.added', { word: parts[0] }) : null, true);
  }
  function deleteWord(wid){
    const w = SB.wordOf(rec(), wid);
    B.delw = null; B.q = '';
    if (!w) return;
    let n = 0;
    commit(d => { n = RS.dropWordEverywhere(d, wid); }, t('wb.undoDelete'));
    C.toast(t(n ? 'wb.deletedOn' : 'wb.deleted', { word: w.name, n }), '', true);
  }
  const editShelf = () => { const n = $b('#cb-shelf'); n?.focus(); n?.select(); };

  // ---- a record skill group's form: its words as the bank's chips, the same Find or add, and the record's groups by name ----
  function groupsHtml(gid){
    const m = rec(), gs = m.skills ?? [];
    if (gs.length < 2) return '';
    return `<div class="sknames cwbgroups" role="group" aria-label="${esc(t('career.bankGroups'))}">${gs.map((s, i) => { const on = s.id === gid, name = (L() === DEFAULT_LANG ? s.name : m.i18n?.[L()]?.labels?.[s.id]) || s.name;
      return `<button type="button" class="skname${on ? ' is-pick' : ''}" style="--gh:var(--hue-${HUES[i % HUES.length]})" data-drag="g" data-act="c-sel-skill" data-id="${esc(s.id)}" id="${uid('g', s.id)}"${on ? ' aria-current="true"' : ''} title="${esc(t('career.bankGroupTip'))}"><i aria-hidden="true"></i>${esc(name)}</button>`; }).join('')}</div>`;
  }
  function wordsHtml(gid, gname){
    const chips = keywordsOf(gid).map((k, n) =>      // each word as the group's line prints it
      `<span class="skchip wbchip cwbkw" data-drag="k" data-n="${n}" data-act="c-kw-chip" data-id="${esc(k)}" id="${uid('k', k)}" tabindex="0" title="${esc(t('career.bankWordTip'))}">${esc(k)}${delBtn(`data-act="c-kw-rm" data-n="${n}"`, t('edit.removeTag', { tag: k }), { text: false })}</span>`).join('');
    return `<div class="cwb cwbgroup" data-g="${esc(gid)}" data-name="${esc(gname)}">${chips ? `<div class="wbtray cwbkwell"><div class="wbtiles cwbkws">${chips}</div></div>` : ''}
      <span class="wbqwrap"><i class="wbqico" aria-hidden="true">${icon('search', { role: 'inline' })}</i><input type="search" id="c-kw-in" class="sw-q wbq" placeholder="${esc(t('wb.find'))}" aria-label="${esc(t('wb.find'))}" autocomplete="off" spellcheck="false"><span class="cwbplus">${plusHtml('', null, 'c-kw-add', gname)}</span></span>
      <div class="cwbrow"></div></div>`;
  }
  function kwRedraw(){
    const box = $b('.cwbgroup'), q = $b('#c-kw-in')?.value ?? '';
    if (!box) return;
    box.querySelector('.cwbrow').innerHTML = rowHtml(q, 'c-kw-take');
    box.querySelector('.cwbplus').innerHTML = plusHtml(q, B.kwWarned, 'c-kw-add', box.dataset.name);
    tierAll(box);
  }
  // Enter or the "+": each word typed becomes the bank's word for it (a new one when the bank has none) at the end of the group
  const groupNow = () => { const s = C.ui.sel; return s.kind === 'record' && s.group === 'skills' ? s.id : null; };      // the group whose form is open
  function kwAdd(gid, names = null, el = $b('#c-kw-in')){
    const parts = names ?? String(el?.value ?? '').split(',').map(SB.cleanWord).filter(Boolean);
    if (!gid || !parts.length){ el?.focus(); return; }
    if (!names && parts.length === 1){
      const { exact, near } = SB.similar(rec(), parts[0]);
      if (!exact && near.length && B.kwWarned !== parts[0]){ B.kwWarned = parts[0]; kwRedraw(); shake($b('.cwbgroup .wbqplus')); return; }
    }
    const kw = keywordsOf(gid), have = new Set(kw.map(SB.norm));
    const fresh = parts.map(p => { const w = SB.findWord(rec(), p, L()); return w ? text(w.id).text : p; }).filter(x => !have.has(SB.norm(x)) && have.add(SB.norm(x)));
    B.kwWarned = null;
    if (el) el.value = '';
    if (!fresh.length){ C.toast(t('wb.hereTip'), ''); kwRedraw(); return; }
    setKeywords(gid, [...kw, ...fresh]);
    C.renderBody();
    $b('#c-kw-in')?.focus();
  }

  // ---- moving: a press that moves carries a copy (the Editor bank's chip), the place it would land is marked, and it lands where it is let go,
  // as one undo step. Esc puts it back. From the keyboard, Alt+arrows move what has the focus one place (a bank word: ↑ ↓ to the shelf above or below).
  function down(e){
    spent = false;
    if (e.target.closest('[data-act=c-bk-delshelf]')){ e.preventDefault(); return; }      // the shelf's name keeps the caret: its Delete is pressed, not left
    const hd = e.button === 0 && e.pointerType !== 'touch' && !e.target.closest('.del, input') ? e.target.closest('[data-drag]') : null;
    const kind = hd?.dataset.drag, unit = kind === 's' ? hd.closest('.wbsec') : hd, scope = hd?.closest(SCOPE[kind]);
    if (!hd || !unit || !scope || D) return;
    const r = hd.getBoundingClientRect(), ctl = new AbortController(), o = { signal: ctl.signal };
    D = { kind, hd, unit, scope, x0: e.clientX, y0: e.clientY, fx: e.clientX - r.left, fy: e.clientY - r.top, on: false, at: null, off: () => ctl.abort() };
    document.addEventListener('pointermove', move, o);
    document.addEventListener('pointerup', u => end(false, u), o);
    document.addEventListener('pointercancel', () => end(true), o);
    document.addEventListener('keydown', k => { if (k.key === 'Escape' && D?.on){ k.preventDefault(); k.stopPropagation(); end(true); } }, { ...o, capture: true });
  }
  function move(e){
    if (!D) return;
    if (!D.on){
      if (Math.hypot(e.clientX - D.x0, e.clientY - D.y0) < MOVE) return;
      D.on = true;
      D.ghost = Object.assign(document.createElement('div'), { className: 'skchip wbghost', textContent: D.hd.textContent.trim() });
      document.body.append(D.ghost);
      document.documentElement.classList.add('wb-carry');
      D.unit.classList.add('socket');
      D.scope.closest('.cwb')?.classList.add('is-carry');
    }
    e.preventDefault();
    D.ghost.style.transform = `translate(${e.clientX - D.fx}px, ${e.clientY - D.fy}px)`;
    mark(D, aim(D, e.clientX, e.clientY));
  }
  // what is under the pointer: a unit of the same kind (before or after it, by the side of its middle), or for a word, a shelf's row (its end)
  function aim(d, x, y){
    const top = document.elementFromPoint(x, y);
    if (!top || !d.scope.contains(top)) return null;
    const u = top.closest(UNIT[d.kind]);
    if (u === d.unit) return null;
    if (u && d.scope.contains(u)){ const r = u.getBoundingClientRect(); return { el: u, after: d.kind === 's' ? y > r.top + r.height / 2 : x > r.left + r.width / 2 }; }
    const z = d.kind === 'w' ? top.closest('.wbsec') : null;
    return z ? { zone: z } : null;
  }
  function mark(d, tg){
    for (const x of d.scope.querySelectorAll('[data-at], .drop-on')){ x.removeAttribute('data-at'); x.classList.remove('drop-on'); }
    d.at = tg;
    if (tg?.el) tg.el.dataset.at = tg.after ? 'after' : 'before';
    else if (tg?.zone) tg.zone.classList.add('drop-on');
  }
  function end(cancel, e){
    const d = D;
    D = null;
    if (!d) return;
    d.off();
    if (!d.on) return;
    if (!cancel && e) mark(d, aim(d, e.clientX, e.clientY));
    const tg = d.at;
    mark(d, null);
    d.ghost.remove();
    document.documentElement.classList.remove('wb-carry');
    d.unit.classList.remove('socket');
    d.scope.closest('.cwb')?.classList.remove('is-carry');
    spent = true; setTimeout(() => { spent = false; }, 300);      // (a drag let go outside the panel has no click here)
    if (!cancel && tg) drop(d, tg);
  }
  function drop(d, tg){
    const units = [...d.scope.querySelectorAll(UNIT[d.kind])].filter(x => x !== d.unit && (!tg.el || x.parentElement === tg.el.parentElement));
    const before = tg.el ? (tg.after ? units[units.indexOf(tg.el) + 1] ?? null : tg.el) : null, id = d.hd.dataset.id;
    if (d.kind === 'w'){ const z = tg.el ? tg.el.closest('.wbsec') : tg.zone; commit(x => SB.moveWord(x.record, id, { shelf: z.dataset.sec || null, beforeId: before?.dataset.id ?? null }), t('wb.undoMoveWord')); }
    else if (d.kind === 's') commit(x => SB.moveShelf(x.record, id, before?.dataset.sec ?? null), t('wb.undoShelf'));
    else if (d.kind === 'g') commit(x => K.moveSkill(x.record, id, before?.dataset.id ?? null), t('career.undoMoveGroup'));
    else {
      const gid = d.scope.closest('.cwbgroup').dataset.g, kw = keywordsOf(gid), [w] = kw.splice(Number(d.hd.dataset.n), 1), at = before ? kw.indexOf(before.dataset.id) : -1;
      kw.splice(at < 0 ? kw.length : at, 0, w);
      setKeywords(gid, kw);
    }
  }
  function nudge(hd, key){
    const kind = hd.dataset.drag, unit = kind === 's' ? hd.closest('.wbsec') : hd, scope = hd.closest(SCOPE[kind]), back = key === 'ArrowLeft' || key === 'ArrowUp';
    if (!unit || !scope) return false;
    const vertical = key === 'ArrowUp' || key === 'ArrowDown';
    if (kind === 'w' && vertical){      // to the end of the shelf above or below (the words on no shelf are the first)
      const rows = [...scope.querySelectorAll('.wbsec')], z = rows[rows.indexOf(unit.closest('.wbsec')) + (back ? -1 : 1)];
      if (z) commit(x => SB.moveWord(x.record, hd.dataset.id, { shelf: z.dataset.sec || null }), t('wb.undoMoveWord'));
      return true;
    }
    if (kind === 's' && !vertical) return false;
    const sibs = [...unit.parentElement.children].filter(x => x.matches(UNIT[kind])), next = sibs[sibs.indexOf(unit) + (back ? -1 : 1)];
    if (next) drop({ kind, hd, unit, scope }, { el: next, after: !back });
    return true;
  }

  function act(a, tg){
    const id = tg.dataset.id;
    switch (a){
      case 'c-bk-add': add(); return true;
      case 'c-bk-chip': B.q = text(id).text; B.warned = null; B.delw = null; redraw(); $b('#cb-q')?.focus(); return true;      // a click finds it: how many resumes print it, and its Delete
      case 'c-bk-delw': B.delw = id; redraw(); $b('[data-act=c-bk-delw-no]')?.focus(); return true;
      case 'c-bk-delw-no': B.delw = null; redraw(); return true;
      case 'c-bk-delw-yes': deleteWord(B.delw); return true;
      case 'c-bk-shelf': B.shelf = id; redraw(); editShelf(); return true;
      case 'c-bk-newshelf': { let sid; if (commit(d => { sid = SB.addShelf(d.record, t('wb.newShelf'), DEFAULT_LANG).id; }, t('wb.undoShelf'))){ B.shelf = sid; C.renderBody(); editShelf(); setTimeout(() => { if (document.activeElement?.id !== 'cb-shelf') editShelf(); }, 30); } return true; }      // (again after the render the change asks for)
      case 'c-bk-sort': { let r; if (commit(d => { r = SB.shelvesFromGroups(d.record); }, t('career.undoSort'))) C.toast(t('career.bankSorted', { words: r.words, shelves: r.shelves }), '', true); return true; }
      case 'c-bk-delshelf': B.shelf = null; commit(d => SB.dropShelf(d.record, id), t('wb.undoShelf'), t('wb.shelfDeleted'), true); return true;
      case 'c-kw-add': kwAdd(groupNow()); return true;
      case 'c-kw-take': { if (SB.wordOf(rec(), id)) kwAdd(groupNow(), [text(id).text]); return true; }
      case 'c-kw-chip': return true;
      case 'c-sel-skill': C.select({ kind: 'record', what: 'item', group: 'skills', id }); return true;
    }
    return false;
  }

  function bind(body){
    body.addEventListener('pointerdown', down);
    body.addEventListener('click', e => { if (spent){ spent = false; e.stopPropagation(); e.preventDefault(); } }, true);
    body.addEventListener('input', e => {
      if (e.target.id === 'cb-q'){ B.q = e.target.value; B.warned = null; B.delw = null; redraw(); }
      else if (e.target.id === 'c-kw-in'){ B.kwWarned = null; kwRedraw(); }
    });
    body.addEventListener('keydown', e => {
      const x = e.target;
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.startsWith('Arrow') && x.matches?.('[data-drag]') && nudge(x, e.key)){ e.preventDefault(); e.stopPropagation(); return; }
      if (x.id === 'cb-q' && e.key === 'Enter' && !e.isComposing){ e.preventDefault(); add(); }
      else if (x.id === 'c-kw-in' && (e.key === 'Enter' || e.key === ',') && !e.isComposing){ e.preventDefault(); kwAdd(groupNow(), null, x); }
      else if (e.key === 'Escape' && (x.id === 'cb-q' || x.id === 'c-kw-in') && x.value){ e.preventDefault(); e.stopPropagation(); x.value = ''; if (x.id === 'cb-q'){ B.q = ''; B.warned = null; redraw(); } else { B.kwWarned = null; kwRedraw(); } }
      else if (e.key === 'Escape' && B.delw && x.closest?.('.cwbbank')){ e.preventDefault(); e.stopPropagation(); B.delw = null; redraw(); }
    });
    // a shelf's name is kept when its box is left (Enter leaves it, Esc puts it back first: the record forms' keys, career.js)
    body.addEventListener('change', e => { const x = e.target; if (x.id === 'cb-shelf'){ B.shelf = null; commit(d => SB.setShelfName(d.record, x.dataset.sl, L(), x.value), t('wb.undoShelf')); } });
    body.addEventListener('focusout', e => { const x = e.target; if (x.id === 'cb-shelf') setTimeout(() => { if (x.isConnected && document.activeElement !== x && x.value === x.defaultValue && B.shelf){ B.shelf = null; redraw(); } }); });      // (a box drawn again is not left)
  }

  return { panelHtml, groupsHtml, wordsHtml, act, bind, get state(){ return { ...B, carry: !!D?.on }; } };
}
