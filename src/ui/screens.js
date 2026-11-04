// The Library place and its Compare mode. The Library holds every resume as a card with a picture of its first page
// (thumbs.js) and the information beside it; a click selects a card (the open resume at first), and Enter, a double click or the inspector's
// Open opens it; tick any number and compare them in a table with a column for each. Drawn left of the sidebar (a phone: the whole screen); Esc goes
// up one level (Compare to the grid, then the selection), never to another place. The model is src/model/resumes.js; the row menu, rename,
// Duplicate and Delete are resumes.js's, and the resume list's search and views are here.

import * as RS from '../model/resumes.js';
import * as DOC from '../model/documents.js';
import { pendingEdits } from '../model/resume.js';
import { langName } from '../model/lang.js';
import { t, h, errText } from '../i18n/index.js';
import { pageSize } from './layout.js';
import { play, reduced } from './motion.js';
import { nameHtml } from './switcher.js';
import { icon, withArrows } from './icons.js';
import { F, snippet, careerHtml } from './find.js';
import { initLibrary, cells, COLS } from './library.js';

let C = null, T = null, LIB = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const VIEW_KEY = 'rb-manage-view', VIEWS = ['role', 'date', 'company'];
const savedView = () => { try { const v = localStorage.getItem(VIEW_KEY); return VIEWS.includes(v) ? v : 'date'; } catch { return 'date'; } };      // newest first unless chosen; an older 'type' is read as date
const LIST_KEY = 'rb-manage-list', savedList = () => { try { return localStorage.getItem(LIST_KEY) === '1'; } catch { return false; } };
// ticked: resumes ("id") and sent copies ("id|snapshot"); cmp: what Compare shows, and focus the row in the inspector;
// sel: the selected card (null: the open resume's); nj: the resume whose "Use for a new job" form is open; draft: what was typed in
// that form, per resume, kept until the copy is made
// showArchived: archived resumes, documents and rounds are in the views; fold: the rounds the person opened or shut; roundForm: the form of "Start a new round" is open, with what was typed
// list: the Library as a table (remembered; a phone keeps the cards); open: the resumes whose sent copies and files are unfolded in it
// fam: each item's resume and its language copies, by the item's id (as drawn); lang: the language picked on an item's chips; gs: the document groups drawn
const V = { hits: new Map(), view: savedView(), ticked: new Set(), cmp: [], sel: null, nj: null, draft: new Map(), sentOnly: false, rows: [], focus: -1, showArchived: false, fold: new Map(), det: new Set(), roundForm: false, roundDraft: '', list: savedList(), open: new Set(), fam: new Map(), lang: new Map(), gs: [] };
const phone = () => document.body.dataset.phone === 'true';
const listing = () => V.list && !phone();
// what hides items: Sent only, the claim and the search (files just added are shown)
export function showAll(){ V.sentOnly = false; F.claim = null; F.q = ''; }
const selId = () => (V.sel && RS.savedOf(st(), V.sel) ? V.sel : st().openId);

export function initScreens(ctx, thumbs){
  C = ctx; T = thumbs;
  LIB = initLibrary({ ...ctx, repaint: () => paintInspector() });
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
const thumb = (key, format, page = 0) => `<span class="rthumb" data-thumb="${esc(key)}" ${page ? `data-page="${page}"` : ''} style="aspect-ratio:${ratio(format)}"></span>`;

// ---- the Library ----
const metaParts = r => [r.format === 'us-letter' ? t('paper.letter') : t('paper.a4'), (r.lang ?? 'en').toUpperCase(),
  r.pageLimit === 0 ? t('head.anyLength') : r.pageLimit ? t('resumes.pShort', { n: r.pageLimit }) : ''];
const metaOf = r => metaParts(r).filter(Boolean).join(' · ');
const tick = (key, name) => `<input type="checkbox" class="rtick" data-cmp="${esc(key)}" ${V.ticked.has(key) ? 'checked' : ''} aria-label="${esc(name)}">`;
// newest first; the open resume counts as the newest, since opening it is its latest use; an item is as new as the newest of its languages
const recency = r => famOf(r).reduce((m, x) => { const v = x.id === st().openId ? '9999' : x.savedAt || ''; return v > m ? v : m; }, '');
const newest = (a, b) => recency(b).localeCompare(recency(a));
const famOf = r => V.fam.get(r.id) ?? [...V.fam.values()].find(f => f.some(x => x.id === r.id)) ?? [r];
// the language an item shows: while searching, one the search found (the selected one first); else the selected one, the one picked on its chips, the open one, the original
const shownOf = (fam, found) => { const f = F.q.trim() ? fam.filter(x => found.has(x.id)) : []; return f.find(x => x.id === selId()) ?? f[0] ?? fam.find(x => x.id === selId()) ?? fam.find(x => x.id === V.lang.get(fam[0].id)) ?? fam.find(x => x.id === st().openId) ?? fam[0]; };
// an item's files: the sent copies of each of its languages (newest first) and the document groups exported from them, as the list's fold holds them; the chip counts every file of a group
const filesOf = fam => [fam.flatMap(x => RS.snapshotsOf(x).slice().reverse().map(s => [x, s])), V.gs.filter(g => fam.some(x => x.id === g.resume))];
const LC = x => (x.lang ?? 'en').toUpperCase();
const langChips = (fam, r) => (fam.length > 1 ? `<span class="rlangs" role="group" aria-label="${esc(t('ux6f.ovLang'))}">${fam.map(x => `<button type="button" class="rlang press ${V.ticked.has(x.id) ? 'ticked' : ''}" data-tier="tertiary" data-act="scr-lang" data-id="${esc(x.id)}" data-item="${esc(fam[0].id)}" aria-pressed="${x.id === r.id}" ${x.id === st().openId ? 'aria-current="true"' : ''} title="${esc(langName(x.lang ?? 'en'))}">${esc(LC(x))}</button>`).join('<span aria-hidden="true">·</span>')}</span>` : '');
// while searching, the chip is marked when the words were found in its documents (they are reached through it, never cards of their own)
const filesChip = (fam, r) => { const [s, d] = filesOf(fam), n = s.length + d.reduce((k, g) => k + g.members.length, 0); return n ? `<button type="button" class="rfiles press ${F.q.trim() && d.length ? 'is-hit' : ''}" data-tier="tertiary" data-act="scr-files" data-id="${esc(r.id)}" data-item="${esc(fam[0].id)}" title="${esc(t('i7.foldFiles', { name: label(r) }))}">${h('i7.nFiles', { n })}</button>` : ''; };

// a sent copy: its tick, and the line that opens it
const sentTick = (r, s) => tick(`${r.id}|${s.id}`, t('ux6e.tickSent', { name: label(r), date: sentDate(s) }));
const snapLine = (r, s) => `<button class="snapline" data-act="sw-snap" data-id="${esc(r.id)}" data-sid="${esc(s.id)}">${esc(t('ux6e.sent', { to: RS.sendLabel(s.sends[0]) || t('ux1.noRecipient'), date: sentDate(s) }))}${s.sends.length > 1 ? ` +${s.sends.length - 1}` : ''}</button>`;
// a phone has no inspector: its card keeps the sent copies and the actions
function phoneExtras(r){
  const p = RS.parentOf(st(), r), guess = !p && RS.closestTo(st(), r, x => RS.printedIds(C.work(), x));
  return `${RS.snapshotsOf(r).slice().reverse().map(s => `<div class="rsent">${sentTick(r, s)}${snapLine(r, s)}</div>`).join('')}
    <div class="racts"><button class="sm" data-act="sw-open" data-id="${esc(r.id)}">${h('ux6e.openBtn')}</button><button class="sm" data-act="rm-dup" data-id="${esc(r.id)}">${h('ux1.dup')}</button>${p || guess ? `<button class="sm" data-act="scr-differs" data-id="${esc(r.id)}">${h('ux6e.differs')}</button>` : ''}
      <span class="rcmore">${C.resumes.moreButton(r.id, 'screen')}${C.resumes.rowMenuHtml(r.id, 'screen')}</span></div>`;
}
const hooks = r => `data-rid="${esc(r.id)}" ${r.round ? `data-round="${esc(r.round)}"` : ''} ${r.archived ? 'data-archived="1"' : ''}`;      // a card's and a row's: what selecting, ticking and carrying read
const nameBtn = (r, html, aria = '') => (C.resumes.renamingHere(r.id, 'screen') ? C.resumes.renameInput(r) : `<button class="rsel" data-act="scr-sel" data-id="${esc(r.id)}" aria-pressed="${r.id === selId()}" ${aria ? `aria-label="${esc(aria)}"` : ''} ${r.id === st().openId ? 'aria-current="true"' : ''}>${html}</button>`);
// a resume's card; with language copies (fam), the one shown of them, its language chips and no "from" line for its original
function card(r, fam = [r]){
  const open = r.id === st().openId, n = RS.snapshotsOf(r).length, role = r.role || '', company = r.company || '', p = RS.parentOf(st(), r);
  return `<article class="rcard ${open ? 'open' : ''} ${r.id === selId() && !LIB.sel() ? 'sel' : ''} ${V.ticked.has(r.id) ? 'ticked' : ''}" ${hooks(r)}>
    ${tick(r.id, t('ux6e.tick', { name: label(r) }))}
    <span class="thumbwrap">${thumb(r.id, r.format)}</span>
    <h4 class="rname">${nameBtn(r, nameHtml(company && role ? company : label(r)))}</h4>
    ${company && role ? `<p class="rrole">${esc(role)}</p>` : ''}
    <p class="rmeta">${esc(metaParts(r).filter((x, i) => x && !(fam.length > 1 && i === 1)).join(' · '))}</p>
    ${p && !fam.includes(p) ? `<p class="rfrom">${esc(t('ux6f.from', { name: label(p) }))}</p>` : ''}
    ${V.hits.has(r.id) ? `<p class="rhit">${snippet(V.hits.get(r.id)[0].text, F.q)}${V.hits.get(r.id).length > 1 ? ` <small class="muted">+${V.hits.get(r.id).length - 1}</small>` : ''}</p>` : ''}
    <p class="rbadges">${langChips(fam, r)}${open ? `<span class="pill is-open">${h('ux6h.openNow')}</span>` : ''}${n ? `<span class="pill">${h('ux6h.sentN', { n })}</span>` : ''}${filesChip(fam, r)}</p>
    ${phone() ? phoneExtras(r) : ''}
  </article>`;
}
// the list's row of a resume; under it, folded, its sent copies (newest first, each with its tick) and the files exported from it
const HEADS = { name: 'ux1.name', company: 'ux6h.company', role: 'ux6h.role', paper: 'design.paper', lang: 'ux6f.ovLang', pages: 'ux6f.ovPages', sent: 'ux6f.ovSent', changed: 'ux6f.ovChanged' };
const HEAD = () => `<th class="c-tick" scope="col"><span class="sr">${h('ux6h.compare')}</span></th>${COLS.map(k => `<th class="c-${k}" scope="col">${h(HEADS[k])}</th>`).join('')}`;
// With language copies (fam): the row is the one shown, its Language cell the chips, and the fold holds a row for each language before the files of all of them;
// with files, its Sent cell is the files chip (the sent copies are among them)
function row(r, fam = [r]){
  const open = r.id === st().openId, [snaps, docs] = filesOf(fam), [paper, lang, pages] = metaParts(r), many = fam.length > 1, id = fam[0].id;
  const unfold = V.open.has(id) || !!F.q.trim() || docs.some(g => g.id === LIB.sel());
  const fold = many || snaps.length || docs.length ? `<button class="rfold" data-act="scr-fold" data-id="${esc(id)}" aria-expanded="${unfold}" aria-label="${esc(t('i7.foldFiles', { name: label(r) }))}">${icon('caret', { role: 'inline' })}</button>` : '';
  const hit = V.hits.get(r.id), sub = `class="rsub" data-parent="${esc(id)}" ${unfold ? '' : 'hidden'}`, sentN = x => (RS.snapshotsOf(x).length ? t('ux6h.sentN', { n: RS.snapshotsOf(x).length }) : '');
  return `<tr class="rline ${open ? 'open' : ''} ${r.id === selId() && !LIB.sel() ? 'sel' : ''} ${V.ticked.has(r.id) ? 'ticked' : ''}" ${hooks(r)}>
    <td class="c-tick">${fold}${tick(r.id, t('ux6e.tick', { name: label(r) }))}</td>
    ${cells({ name: `<span class="cname"><span class="ficon">${icon('document', { role: 'inline' })}</span>${nameBtn(r, esc(RS.wordOf(r)) || esc(label(r)), label(r))}${open ? `<span class="pill is-open">${h('ux6h.openNow')}</span>` : ''}</span>${hit ? `<span class="rhit">${snippet(hit[0].text, F.q)}</span>` : ''}`, company: r.company, role: r.role, paper, lang: many ? '' : lang, pages, sent: filesChip(fam, r) ? '' : sentN(r), changed: r.savedAt }).replace('<td class="c-lang"></td>', `<td class="c-lang">${langChips(fam, r)}</td>`).replace('<td class="c-sent"></td>', `<td class="c-sent">${filesChip(fam, r)}</td>`)}</tr>`
    + (many ? fam.map(x => `<tr ${sub} data-lid="${esc(x.id)}"><td class="c-tick"></td>${cells({ name: `<span class="cname"><button class="rsel" data-act="scr-lang" data-id="${esc(x.id)}" data-item="${esc(id)}" aria-pressed="${x.id === r.id}">${esc(langName(x.lang ?? 'en'))}</button>${x.id === st().openId ? `<span class="pill is-open">${h('ux6h.openNow')}</span>` : ''}</span>`, lang: LC(x), pages: metaParts(x)[3], sent: sentN(x), changed: x.savedAt })}</tr>`).join('') : '')
    + snaps.map(([x, s]) => `<tr ${sub}><td class="c-tick">${sentTick(x, s)}</td>${cells({ name: snapLine(x, s), company: s.sends[0]?.company, role: s.sends[0]?.role, lang: many ? LC(x) : '', changed: sentDate(s) })}</tr>`).join('')
    + docs.map(g => LIB.row(g, F.q, id, !unfold)).join('');
}

// A document group on its own (not exported from a saved resume) is listed beside the resumes: it has what the views group by (role, company, date, round)
const pseudo = g => ({ id: `doc:${g.id}`, name: g.lead.name, company: g.lead.meta?.company ?? '', role: g.lead.meta?.role ?? '', savedAt: g.lead.meta?.date || String(g.lead.addedAt ?? '').slice(0, 10), lang: g.lead.meta?.lang, round: g.lead.round, g });

function listHtml(){
  if (!anyArchived()) V.showArchived = false;      // nothing left to show: the switch is off
  const all = st().resumes ?? [], q = F.q.trim().toLowerCase(), rounds = st().rounds ?? [], show = V.showArchived || !!q;      // archived items stay searchable
  // a resume is found by its name, its sent-to or the words of the lines it prints; the one selected and the ones ticked for Compare stay in the results
  V.hits = new Map(all.map(r => [r.id, RS.hits(C.work(), recipeOf(r.id), q)]).filter(([, h]) => h.length));
  const claim = r => !F.claim || RS.prints(C.work(), recipeOf(r.id), F.claim.facts, F.claim.vid);
  // the documents: a group is found by its names and the words of its files; one exported from a saved resume sits under it, any other is listed on its own
  const gs = V.gs = F.claim || V.sentOnly ? [] : RS.docGroups(st()).filter(g => (show || !g.members.every(m => DOC.hidden(st(), m))) && LIB.matches(g, q));
  const attached = id => gs.filter(g => g.resume === id);
  const seen = r => RS.matches(st().record, r, F.q) || V.hits.has(r.id) || (q && (attached(r.id).length || RS.snapshotsOf(r).some(s => s.sends.some(x => String(x.company).toLowerCase().includes(q)))));
  const list = all.filter(r => claim(r) && (show || !DOC.hidden(st(), r) || r.id === V.sel || V.ticked.has(r.id)) && (seen(r) || r.id === V.sel || V.ticked.has(r.id)) && (!V.sentOnly || RS.snapshotsOf(r).length));
  // a resume found brings its whole item: the original and its language copies, those the views hide left out
  const inList = new Set(list.map(r => r.id)), matched = new Set(list.filter(seen).map(r => r.id)), byRoot = new Map();
  for (const r of list){ const root = RS.langRoot(st(), r); if (!byRoot.has(root.id)) byRoot.set(root.id, RS.langFamily(st(), root).filter(x => inList.has(x.id) || show || !DOC.hidden(st(), x))); }
  V.fam = new Map([...byRoot.values()].map(f => [f[0].id, f]));
  const items = [...[...V.fam.values()].map(f => f[0]), ...gs.filter(g => !g.resume).map(pseudo)];
  const found = careerHtml();      // …and the Career entries that hold the word, under the cards
  if (!items.length) return `<p class="muted small swnone">${h(F.claim ? 'ux6f.noPrint' : all.length || (st().documents ?? []).length ? 'ux1.noMatch' : 'ux1.noneYet')}</p>${found}`;
  const cardOf = r => (r.g ? LIB.card(r.g, F.q) : card(shownOf(V.fam.get(r.id), matched), V.fam.get(r.id)));
  const rowOf = r => (r.g ? LIB.row(r.g, F.q) : row(shownOf(V.fam.get(r.id), matched), V.fam.get(r.id)));
  // the list is one table: a group is a header row and its rows (a tbody, inside its round's while that round is open)
  let inRound = '';
  const group = (name, rs) => (listing() ? `<tbody class="rgroup" ${inRound}><tr class="rghead"><th colspan="9" scope="colgroup">${esc(name)} · ${rs.length}</th></tr>${rs.map(rowOf).join('')}</tbody>`
    : `<h3 class="lbl">${esc(name)} · ${rs.length}</h3><div class="rgrid">${rs.map(cardOf).join('')}</div>`);
  const table = body => (listing() ? `<table class="rtable"><caption class="sr">${h('ux6h.allResumes')}</caption><thead><tr>${HEAD()}</tr></thead>${body}</table>` : body);
  const byNewest = gs => gs.map(g => ({ ...g, rs: g.rs.slice().sort(newest) })).sort((a, b) => newest(a.rs[0], b.rs[0]));
  const view = list => {
    if (V.view === 'date'){
      const years = new Map();
      for (const r of list.slice().sort(newest)){ const y = recency(r) === '9999' ? t('ux6h.now') : recency(r).slice(0, 4) || t('ux2.noDate'); years.set(y, [...(years.get(y) ?? []), r]); }
      return [...years].map(([y, rs]) => group(y, rs)).join('');
    }
    if (V.view === 'company') return byNewest(RS.byCompany(list).map(g => ({ name: g.key ? g.label : t('ux2.noCompany'), rs: g.rows.map(x => x.resume) }))).map(g => group(g.name, g.rs)).join('');
    return byNewest(RS.grouped(list).map(g => ({ name: g.key ? g.label : t('resumes.noRole'), rs: g.resumes }))).map(g => group(g.name, g.rs)).join('');
  };
  if (!rounds.length) return table(view(items)) + found;
  // rounds: the current one first and open, the older ones folded under their names (each with the same views), then "Earlier" for what has none
  const cur = DOC.currentRound(st())?.id, known = new Set(rounds.map(r => r.id));
  const sorted = [...rounds].sort((a, b) => (b.id === cur) - (a.id === cur) || String(b.from).localeCompare(String(a.from)) || (a.id < b.id ? -1 : 1));
  const bucket = (key, name, round) => {
    const its = items.filter(x => (known.has(x.round) ? x.round : '') === key);
    if (round?.archived && !show) return '';
    if (!round && !its.length) return '';
    const open = V.fold.has(key || 'earlier') ? V.fold.get(key || 'earlier') : true;      // every round is open until the person folds it
    const acts = round ? `<div class="btns racts"><button class="sm ghost rarch" data-act="round-archive" data-id="${esc(key)}" data-on="${round.archived ? '0' : '1'}" title="${esc(t(round.archived ? 'i7.unarchiveRound' : 'i7.archiveRound'))}" aria-label="${esc(t(round.archived ? 'i7.unarchiveRound' : 'i7.archiveRound'))}">${icon('archive', { role: 'inline' })}</button>${round.archived ? `<button class="sm del" data-act="rm-round-open" data-id="${esc(key)}">${h('i7.rmThese')}</button>` : ''}</div>` : '';
    const attrs = `data-round="${esc(key)}" data-n="${its.length}" ${round?.archived ? 'data-archived="1"' : ''} ${key === cur ? 'data-current="1"' : ''}`, panel = round && LIB.rm() === key ? LIB.roundPanel(round) : '';
    if (listing()){      // a round is a header row with its fold and its actions; its groups follow, hidden while it is folded
      inRound = `data-in="${esc(key)}" ${open ? '' : 'hidden'}`;
      return `<tbody class="rrhead" ${attrs}><tr><th colspan="9" scope="colgroup"><button class="rfold" data-act="scr-rfold" data-round="${esc(key)}" aria-expanded="${open}" aria-label="${esc(name)}">${icon('caret', { role: 'inline' })}</button> <span class="ficon">${icon('flag', { role: 'inline' })}</span>${roundName(key, name, round)} · ${its.length}${acts}${panel}</th></tr></tbody>`
        + (its.length ? view(its) : `<tbody ${inRound}><tr><td colspan="9" class="muted small">${h('i7.roundEmpty')}</td></tr></tbody>`);
    }
    return `<details class="rround" ${attrs} ${open ? 'open' : ''}><summary>${roundName(key, name, round)} · ${its.length}</summary>${acts}${panel}${its.length ? view(its) : `<p class="muted small">${h('i7.roundEmpty')}</p>`}</details>`;
  };
  return table(sorted.map(r => bucket(r.id, r.name, r)).join('') + bucket('', t('i7.earlier'), null)) + found;
}

// a round's name is written in place, as a job's title is (Enter or leaving keeps it, Esc does not, one undo step); Earlier is no round and has none
const roundName = (key, name, round) => (round ? `<button type="button" class="hedit rrname" data-act="round-rename" data-id="${esc(key)}" aria-label="${esc(t('i7.renameRound', { name }))}"><span>${esc(name)}</span><span class="pen" aria-hidden="true">${icon('edit', { role: 'inline' })}</span></button>` : esc(name));
function renameRound(i, keep){
  if (i.dataset.done) return;
  i.dataset.done = '1';
  const n = i.value.trim().slice(0, 60), r = (st().rounds ?? []).find(x => x.id === i.dataset.id);
  if (keep && n && r && n !== r.name) C.store.commit(d => { DOC.mark(d, 'rounds', r.id, { name: n }); }, t('i7.undoRound'));
  C.renderBody();
}
// "Use for a new job" is a secondary while two or more are ticked (the ticked set is what is being worked on then)
const prim = () => (V.ticked.size >= 2 ? { c: '', t: 'secondary' } : { c: 'primary', t: 'primary' });
const pressOf = () => `class="press ${prim().c}" data-tier="${prim().t}"`;
// the list bar's hint while nothing is ticked
const hintHtml = () => (V.ticked.size ? '' : `<span class="muted small" id="scr-tickinfo">${h('ux6h.tickHint')}</span>`);
// what is done with the ticked set floats at the list's foot, only while something is ticked: how many, Compare (two or more), Move to round… (with rounds) and Clear
function ticksHtml(){
  const n = V.ticked.size;
  if (!n) return '';
  return `<span class="small" id="scr-nticked">${h('i7.nTicked', { n })}</span>${n >= 2 ? `<button class="sm press" data-tier="secondary" id="scr-cmp" data-act="scr-compare">${h('ux6e.compareN', { n })}</button>` : ''}`
    + `${(st().rounds ?? []).length ? `<select data-move-round aria-label="${esc(t('i7.moveTo'))}"><option value="-" selected disabled>${h('i7.moveTo')}</option>${roundOpts(null)}</select>` : ''}<button class="sm press" data-tier="tertiary" data-act="scr-clear">${h('ux6e.clear')}</button>`;
}
// What the sidebar's card names and Export takes: any ticked resume makes the ticked set the export (in the order they were ticked);
// else the selected resume; else the open one. A sent copy's tick is not a resume of its own.
const tickedResumes = () => [...new Set([...V.ticked].filter(k => !k.includes('|') && RS.savedOf(st(), k)))];
function target(){
  const open = st().openId, ids = tickedResumes();
  if (ids.length) return { ids, kind: ids.length === 1 && ids[0] === open ? 'open' : 'ticked' };
  return selId() !== open && !LIB.sel() ? { ids: [selId()], kind: 'selected' } : { ids: [open], kind: 'open' };
}
// the inspector's strip, while something is ticked: whether the resume it shows is in the export
function stripHtml(id){
  const tk = tickedResumes(), at = tk.indexOf(id);
  if (!tk.length) return '<div class="istrip" id="istrip" hidden></div>';
  return `<div class="istrip ${at >= 0 ? 'is-in' : 'is-out'}" id="istrip"><span>${h(at >= 0 ? 'hc.inExport' : 'hc.notInExport', { i: at + 1, n: tk.length })}</span>`
    + `<button class="sm press" data-tier="tertiary" data-act="scr-tick" data-id="${esc(id)}">${h(at >= 0 ? 'hc.takeOut' : 'hc.addToExport')}</button></div>`;
}
// shortcut: the resume switcher still lists an archived resume (the Library's views leave it out), and a phone has no inspector, so a document card there has none of its actions; upgrade when archiving is asked for in those places.
const anyArchived = () => (st().resumes ?? []).some(r => r.archived) || (st().documents ?? []).some(d => d.archived) || (st().rounds ?? []).some(r => r.archived);
const roundOpts = at => `<option value="">${h('i7.earlier')}</option>${(st().rounds ?? []).map(x => `<option value="${esc(x.id)}" ${x.id === at ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}`;
// resumes (their ids, each with its language copies) and document groups ("doc:" and the group's id: every file of it) into a round ('' for none), as one undo step
function moveTo(round, keys){
  const gs = RS.docGroups(st()), all = keys.flatMap(k => (k.startsWith('doc:') ? [k] : RS.langFamily(st(), RS.savedOf(st(), k)).map(x => x.id)));
  C.store.commit(d => {
    for (const k of new Set(all)){
      if (!k.startsWith('doc:')){ DOC.mark(d, 'resumes', k, { round }); continue; }
      for (const m of gs.find(g => g.id === k.slice(4))?.members ?? []) DOC.mark(d, 'documents', m.id, { round });
    }
  }, t('i7.undoRound'));
  C.renderBody();
}
const tickedIds = () => [...V.ticked].map(k => k.split('|')[0]);      // a sent copy moves with its resume
// the header floats at the top of the content (flow.css): never a bar across the window. The search, then (after a divider) New round, Add files
// and New resume, the list's one filled accent; under them the list's own bar (Group, Show, the hint and the cards/list switch)
const dd = (id, key, at, opts) => `<select id="${id}" data-named aria-label="${esc(t(key))}">${opts.map(([v, k]) => `<option value="${v}" ${v === at ? 'selected' : ''}>${h(k)}</option>`).join('')}</select>`;
const showOf = () => (V.sentOnly ? 'sent' : V.showArchived && anyArchived() ? 'archived' : 'all');
const sw = (a, ic, key, on) => `<button type="button" data-act="${a}" aria-pressed="${on}" title="${esc(t(key))}" aria-label="${esc(t(key))}">${icon(ic)}</button>`;
function resumesView(){
  hidePreview();
  return `<section class="scrn" id="resumes" aria-label="${esc(t('ux6h.allResumes'))}">
    <div class="scrhead tbar">${phone() ? `<button class="sm scrback" data-act="scr-back">${withArrows(h('ux1.backToResume'))}</button>` : ''}
      <input id="scr-q" type="search" class="sw-q" aria-label="${esc(t('ux6h.search'))}" placeholder="${esc(t('ux6h.search'))}" value="${esc(F.q)}" autocomplete="off">
      <div class="tgrp"><button class="sm ghost" data-act="round-new" aria-expanded="${V.roundForm}">${icon('flag')} <span>${h('i7.newRoundShort')}</span></button>
        <button class="sm" data-act="goto" data-v="import">${icon('add')} <span>${h('i7.addFiles')}</span></button>
        <button class="press primary newres" data-tier="primary" data-act="sw-new">${icon('newdoc')} <span>${h('hc.newResume')}</span></button></div>
      <div class="lbar" id="scr-lbar"><div class="lctl">${dd('scr-group', 'i7.group', V.view, VIEWS.map(v => [v, `ux2.view.${v}`]))}
        ${dd('scr-show', 'i7.show', showOf(), [['all', 'i7.showAll'], ['sent', 'ux6h.sentOnly'], ...(anyArchived() ? [['archived', 'i7.archivedChip']] : [])])}
        ${F.claim ? `<button class="sm press" data-tier="secondary" data-act="find-claim-clear" aria-label="${esc(t('ux6f.clearClaim'))}">${esc(t('ux6f.printsChip', { name: F.claim.label }))} \u00d7</button>` : ''}</div>
        <span class="tickhint" id="scr-hint">${hintHtml()}</span>
        ${phone() ? '' : `<div class="seg lswitch" role="group" aria-label="${esc(t('ux2.viewBar'))}">${sw('scr-cards', 'cards', 'i7.cardView', !V.list)}${sw('scr-list', 'list', 'i7.listView', V.list)}</div>`}</div></div>
    ${V.roundForm ? `<div class="njform" id="round-form" role="group" aria-label="${esc(t('i7.newRound'))}"><label>${h('i7.roundName')}<input id="rd-name" type="text" autocomplete="off" maxlength="60" value="${esc(V.roundDraft)}"></label><p class="small muted">${h('i7.roundNote')}</p>
      <div class="btns"><button class="primary" data-act="round-create">${h('i7.roundStart')}</button><button class="ghost" data-act="round-cancel">${h('ux6h.cancel')}</button></div></div>` : ''}
    <div id="scr-list">${listHtml()}</div>
    <div class="scrticks selbar" id="scr-ticks" role="status" aria-label="${esc(t('i7.nTicked', { n: V.ticked.size }))}" ${V.ticked.size ? '' : 'hidden'}>${ticksHtml()}</div></section>`;
}
function afterResumes(){
  // coming back: the new-job form is closed (what was typed is kept), and a selection made before another resume was opened is dropped
  if (V.seen !== st().openId){ V.sel = null; V.nj = null; V.seen = st().openId; }
  T.fill(document.getElementById('scr-list'), recipeOf);
  paintInspector();
  const tb = document.querySelector('#scr #resumes .tbar');      // the list's column header stays under the toolbar, however many rows it wraps to
  RO ??= new ResizeObserver(([e]) => document.getElementById('scr')?.style.setProperty('--tbar-h', `${e.target.offsetHeight}px`));
  RO.disconnect(); if (tb) RO.observe(tb);
}
let RO = null;
// a tick changes the toolbar and the card, not the pictures
function refreshTicks(){
  const bar = document.getElementById('scr-ticks'), hint = document.getElementById('scr-hint');
  if (bar){ bar.innerHTML = ticksHtml(); bar.hidden = !V.ticked.size; bar.setAttribute('aria-label', t('i7.nTicked', { n: V.ticked.size })); }
  if (hint) hint.innerHTML = hintHtml();
  const strip = document.getElementById('istrip'); if (strip) strip.outerHTML = stripHtml(selId());
  C.renderHead();
  for (const b of document.querySelectorAll('#body .iopen, #body [data-act=nj-create]')){ b.dataset.tier = prim().t; b.classList.toggle('primary', !!prim().c); }
  for (const c of document.querySelectorAll('#scr-list :is(.rcard, .rline)')) c.classList.toggle('ticked', V.ticked.has(c.dataset.rid));      // a document has no tick
  for (const c of document.querySelectorAll('#scr-list .rlang')) c.classList.toggle('ticked', V.ticked.has(c.dataset.id));
}
// the selection moves without redrawing the pictures
function paintSel(){
  for (const c of document.querySelectorAll('#scr-list :is(.rcard, .rline)')){
    const b = c.querySelector('.rsel'), on = c.dataset.did ? c.dataset.did === LIB.sel() : c.dataset.rid === selId() && !LIB.sel();
    c.classList.toggle('sel', on); b?.setAttribute('aria-pressed', String(on));
  }
}
// Esc in the Library: the new-job form closes (what was typed is kept); then the selection goes back to the open resume; then the ticks are cleared
function clearSel(){
  if (LIB.sel()){ LIB.clear(); paintInspector(); return; }
  if (V.nj){ V.nj = null; paintInspector(); return; }
  if (V.sel && V.sel !== st().openId){ V.sel = null; paintInspector(); return; }
  if (V.ticked.size){ V.ticked.clear(); document.querySelectorAll('#scr-list .rtick').forEach(x => { x.checked = false; }); refreshTicks(); }
}

// ---- the inspector: the selected resume, or the open one, in the editor panel's place ----
function resumeInspector(){
  const r = RS.savedOf(st(), selId()); if (!r) return `<p class="muted">${h('ux1.noneYet')}</p>`;
  const open = r.id === st().openId, p = RS.parentOf(st(), r);
  const guess = !p && RS.closestTo(st(), r, x => RS.printedIds(C.work(), x))?.r;
  const pend = pendingEdits(r).length;
  // its files: the sent copies and the documents of every language of its item, each copy named by its language when there are several
  const fam = famOf(r), many = fam.length > 1, [fsnaps, fdocs] = filesOf(fam);
  const sent = fsnaps.map(([x, s]) => `<li>${sentTick(x, s)}${many ? `<span class="pill">${esc(LC(x))}</span>` : ''}${snapLine(x, s)}</li>`).join('');
  const newest = fsnaps.map(([, s]) => s).sort((a, b) => sentDate(b).localeCompare(sentDate(a)))[0];      // the latest send of any of its languages
  const docs = fdocs.flatMap(g => g.members.map(m => `<li><button class="sm" data-act="doc-sel" data-id="${esc(g.id)}">${esc(m.name)}</button></li>`)).join('');
  const d = V.draft.get(r.id) ?? {};
  const nj = V.nj === r.id ? `<div class="njform" role="group" aria-label="${esc(t('ux6h.newJob'))}">
      <label>${h('ux6h.company')}<input id="nj-company" type="text" autocomplete="off" value="${esc(d.company ?? '')}"></label>
      <label>${h('ux6h.role')}<input id="nj-role" type="text" autocomplete="off" value="${esc(d.role ?? r.role ?? '')}"></label>
      <p class="small muted">${h('ux6h.njNote', { name: label(r) })}</p>
      <div class="btns"><button ${pressOf()} data-act="nj-create" data-id="${esc(r.id)}">${h('ux6h.njCreate')}</button><button class="ghost" data-act="nj-cancel">${h('ux6h.cancel')}</button></div></div>` : '';
  const openBtn = `class="iopen press ${prim().c}" data-tier="${prim().t}" ${open ? 'data-act="place" data-p="editor"' : `data-act="sw-open" data-id="${esc(r.id)}"`}`;
  // its pages, every one, scrolled in place, as tall as they are or what the rest leaves (resting on them shows them large; looking is not opening: Open, Enter
  // or a double click on its card is); then Open and Use for a new job, the most used, on their own line; then what its card does not say:
  // its language (a switch between its language copies), when it last changed, where it came from, its round, and its sent copies and files folded
  return `<section class="insp insp-res" aria-label="${esc(label(r))}">
    ${stripHtml(r.id)}
    <div class="ihero" data-id="${esc(r.id)}"><div class="ihpage">${thumb(r.id, r.format)}</div><div class="ihpage ihmore"></div></div>
    ${nj || `<div class="btns iacts"><button ${openBtn}>${h(open ? 'ux6h.keepEditing' : 'ux6e.openBtn')}</button><button data-act="nj-open" data-id="${esc(r.id)}">${h('ux6h.newJob')}</button><span class="rcmore">${C.resumes.moreButton(r.id, 'screen')}${C.resumes.rowMenuHtml(r.id, 'screen')}</span>${r.archived ? `<button class="sm" data-act="rm-archive" data-id="${esc(r.id)}" data-on="0">${h('i7.unarchive')}</button>` : ''}</div>`}
    <dl class="ovw" aria-label="${esc(t('ux6f.overview'))}">
      <dt>${h('ux6f.ovLang')}</dt><dd>${many ? `<span class="ilangs" role="group" aria-label="${esc(t('ux6f.ovLang'))}">${fam.map(x => `<button type="button" class="sm" data-act="scr-lang" data-id="${esc(x.id)}" data-item="${esc(fam[0].id)}" aria-pressed="${x.id === r.id}" lang="${esc(x.lang ?? 'en')}">${esc(langName(x.lang ?? 'en'))}</button>`).join('')}</span>` : esc(langName(r.lang ?? 'en'))}</dd>
      <dt>${h('ux6f.ovChanged')}</dt><dd>${esc(r.savedAt || '\u2014')}${pend ? ` · ${h('ux6e.pending', { n: pend })}` : ''}</dd>
      ${p || guess ? `<dt>${h('ux6f.ovFrom')}</dt><dd>${esc(p ? label(p) : t('ux6e.closest', { name: label(guess) }))} <button class="sm" data-act="scr-differs" data-id="${esc(r.id)}">${h('ux6h.compareParent')}</button></dd>` : ''}
      ${(st().rounds ?? []).length ? `<dt><label for="ir-round">${h('i7.round')}</label></dt><dd><select id="ir-round" data-res-round="${esc(r.id)}">${roundOpts(r.round)}</select></dd>` : ''}
    </dl>
    ${sent ? `<details class="idet" data-k="sent" ${V.det.has('sent') ? 'open' : ''}><summary><span class="pill">${h('ux6h.sentN', { n: fsnaps.length })}</span><span class="small">${esc([RS.sendLabel(newest.sends.at(-1)) || t('ux1.noRecipient'), sentDate(newest)].join(' \u00b7 '))}</span></summary><ul class="oi-sent">${sent}</ul></details>` : ''}
    ${docs ? `<details class="idet" data-k="files" ${V.det.has('files') ? 'open' : ''}><summary><span class="lbl">${h('i7.files')}</span><span class="pill">${fdocs.reduce((n, g) => n + g.members.length, 0)}</span></summary><ul class="oi-files">${docs}</ul></details>` : ''}
  </section>`;
}
// the inspector's later pages, once its first is drawn
function morePages(key, e){
  const box = document.querySelector(`#body .ihero[data-id="${CSS.escape(key)}"] .ihmore`);
  if (!box || box.childElementCount || !(e.srcs?.length > 1)) return;
  box.innerHTML = e.srcs.slice(1).map((_, i) => thumb(key, e.format, i + 1)).join('');
  T.fill(box, recipeOf);
}
// the inspector is drawn again when the selection or the form changes; the cards keep their pictures. A phone has none (its card has the actions).
function paintInspector(){
  paintSel();
  C.renderHead();      // the sidebar's card follows the selection
  const bd = document.getElementById('body');
  if (phone() || !bd) return;
  const ae = document.activeElement, kept = bd.contains(ae) && ae.id ? { id: ae.id, a: ae.selectionStart, b: ae.selectionEnd } : null;
  bd.innerHTML = C.view() === 'compare' ? cmpInspector() : LIB.sel() ? LIB.inspector() : resumeInspector(); T.fill(bd, recipeOf, morePages); LIB.after();
  const n = kept && document.getElementById(kept.id);
  if (n){ n.focus({ preventScroll: true }); try { n.setSelectionRange(kept.a, kept.b); } catch { /* not a text box */ } }
}

// ---- resting on a card's picture shows its first page large enough to read, beside the card; scrolling over the picture turns the pages ----
const HV = { t: 0, el: null, card: null, at: 0, n: 1, acc: 0 };
const railLeft = () => document.getElementById('rail')?.getBoundingClientRect().left ?? innerWidth;
function hidePreview(){ clearTimeout(HV.t); HV.el?.remove(); HV.el = null; HV.card = null; }
function showPreview(card){
  const r = RS.savedOf(st(), card.dataset.rid ?? card.dataset.id); if (!r) return;
  hidePreview(); HV.card = card;
  const { w, h } = pageSize(r.format), H = Math.min(innerHeight - 32, 1120), W = H * w / h, c = card.getBoundingClientRect(), rl = railLeft();
  let left = c.left + c.width / 2 < rl / 2 ? c.right + 12 : c.left - 12 - W;
  left = Math.max(12, Math.min(rl - 12 - W, left));
  const el = document.createElement('div'); el.className = 'hoverprev'; el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, { left: `${left}px`, top: '16px', width: `${W}px`, height: `${H}px` });
  el.innerHTML = `<div class="hpstrip">${thumb(r.id, r.format)}</div>`;
  document.body.append(el); HV.el = el; HV.at = 0; HV.n = 1; HV.acc = 0; T.fill(el, recipeOf);
  if (card.classList.contains('ihero')){ el.style.transformOrigin = '0 0'; play(el, [{ transform: `translate(${c.left - left}px, ${c.top - 16}px) scale(${c.width / W})`, opacity: .6 }, { transform: 'none', opacity: 1 }], { ms: 'slow', name: 'preview:grow' }); }      // the inspector's pages grow into it
  else play(el, [{ transform: 'scale(.97)' }, { transform: 'none' }], { ms: 'fast', name: 'preview:in' });
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
  if (!HV.el || HV.n < 2 || !e.target.closest?.('.rcard .thumbwrap, .insp-res .ihero')) return;
  e.preventDefault();
  HV.acc += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
  if (Math.abs(HV.acc) < 40) return;
  HV.at = Math.max(0, Math.min(HV.n - 1, HV.at + Math.sign(HV.acc))); HV.acc = 0;
  HV.el.querySelector('.hpstrip').style.transform = `translateY(${-HV.at * HV.el.offsetHeight}px)`;
  HV.el.querySelector('.hppage').textContent = `${HV.at + 1} / ${HV.n}`;
}

// ---- a card (or the list's row) carried onto a round's name moves there (a ticked card takes every ticked one with it): a mouse or a pen, past MOVE px, the
// wordbank's way (a chip follows the pointer, the name under it is lit); Esc or a drop elsewhere changes nothing. None on a phone, none without rounds. ----
const MOVE = 5, RD = { ghost: null, to: null, spent: false };
function carryCard(e){
  RD.spent = false;
  const c = e.button === 0 && e.pointerType !== 'touch' && !phone() && (st().rounds ?? []).length ? e.target.closest?.('#scr-list :is(.rcard, .rline)') : null;
  if (!c || e.target.closest('input, select, a, .rowmenu, button:not(.rsel)')) return;
  const keys = c.dataset.rid ? (V.ticked.has(c.dataset.rid) ? [...new Set(tickedIds())] : [c.dataset.rid]) : [`doc:${c.dataset.did}`];
  const x0 = e.clientX, y0 = e.clientY, ctl = new AbortController(), opt = { signal: ctl.signal, capture: true };
  const lit = p => { RD.to?.classList.remove('drop-on'); RD.to = p && document.elementFromPoint(p.clientX, p.clientY)?.closest('#scr-list :is(.rround > summary, .rrhead)'); RD.to?.classList.add('drop-on'); };
  const end = drop => {
    ctl.abort();
    if (!RD.ghost) return;
    const to = drop ? RD.to?.closest('[data-round]').dataset.round : undefined;      // '' is Earlier
    lit(null); RD.ghost.remove(); RD.ghost = null; RD.spent = true; document.body.classList.remove('is-dragging');
    if (to !== undefined) moveTo(to, keys);
  };
  document.addEventListener('pointermove', m => {
    if (!RD.ghost){
      if (Math.hypot(m.clientX - x0, m.clientY - y0) < MOVE) return;
      hidePreview(); getSelection()?.removeAllRanges();
      RD.ghost = Object.assign(document.createElement('div'), { className: 'skchip wbghost', textContent: `${c.querySelector('.rsel')?.textContent.trim() ?? ''}${keys.length > 1 ? ` +${keys.length - 1}` : ''}` });
      RD.ghost.setAttribute('aria-hidden', 'true');
      document.body.append(RD.ghost); document.body.classList.add('is-dragging');
    }
    RD.ghost.style.transform = `translate(${m.clientX + 12}px, ${m.clientY + 8}px)`;
    lit(m);
  }, opt);
  document.addEventListener('pointerup', m => { lit(m); end(true); }, opt);
  document.addEventListener('pointercancel', () => end(false), opt);
  window.addEventListener('keydown', k => { if (k.key === 'Escape' && RD.ghost){ k.preventDefault(); k.stopPropagation(); end(false); } }, opt);
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
    <div class="scrhead tbar"><input id="cmp-q" type="search" class="sw-q" aria-label="${esc(t('ux6f.searchRows'))}" placeholder="${esc(t('ux6f.searchRows'))}" value="${esc(F.q)}" autocomplete="off"><span class="fcount" id="cmp-n" role="status"></span>
      <button class="sm" data-act="scr-back">${icon('left', { role: 'inline' })} ${h('ux6h.allResumes')}</button>
      <button class="sm" data-act="cmp-prev" title="P">◀ ${h('ux6h.prev')}</button><button class="sm" data-act="cmp-next" title="N">${h('ux6h.next')} ▶</button></div>
    <div class="cmpscroll"><table class="cmp"><caption class="sr">${h('ux6e.cmpTitle', { n: items.length })}</caption>
      <thead><tr><th scope="col">${h('ux6e.cmpRow')}</th>${items.map(x => `<th scope="col"><span class="cname">${esc(x.label)}</span>${thumb(x.key, x.recipe.format)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${r.differs ? 'diff-row' : ''} ${r.kind} ${i === V.focus ? 'is-here' : ''}" data-act="cmp-row" data-i="${i}"><th scope="row" title="${esc(r.label)}">${esc(r.label.length > 46 ? r.label.slice(0, 45) + '…' : r.label)}</th>${r.cells.map(c => `<td class="${gap(c) ? 'gap' : ''}">${cell(c)}</td>`).join('')}</tr>`).join('')}
      <tr class="setting"><th scope="row">${h('ux6e.rowPrinted')}</th>${items.map(x => `<td data-pagesof="${esc(x.key)}">…</td>`).join('')}</tr></tbody></table></div></section>`;
}
// the search in Compare marks the rows that hold the word (their name or any cell) and counts them; Enter and Shift+Enter step through them
const rowHas = r => { const q = F.q.trim().toLowerCase(); return !!q && [r.label, ...r.cells.map(c => (typeof c === 'string' ? c : `${c.text ?? ''} ${c.label ?? ''}`))].some(x => String(x).toLowerCase().includes(q)); };
function markRows(){
  const found = V.rows.map((r, i) => (rowHas(r) ? i : -1)).filter(i => i >= 0);
  document.querySelectorAll('#compare tbody tr[data-i]').forEach(tr => tr.classList.toggle('is-found', found.includes(Number(tr.dataset.i))));
  const n = document.getElementById('cmp-n'); if (n) n.textContent = F.q.trim() ? t('ux6f.rowsFound', { n: found.length }) : '';
  return found;
}
function stepFound(d){
  const found = markRows();
  if (!found.length) return;
  focusRow(d > 0 ? found.find(i => i > V.focus) ?? found[0] : [...found].reverse().find(i => i < V.focus) ?? found.at(-1));
  document.getElementById('cmp-q')?.focus({ preventScroll: true });
}
function afterCompare(){
  markRows();
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
  if (await LIB.act(a, tg)) return true;
  switch (a){
    case 'round-new': V.roundForm = !V.roundForm; C.renderBody(); if (V.roundForm) document.getElementById('rd-name')?.focus(); return true;
    case 'round-rename': {
      const r = (st().rounds ?? []).find(x => x.id === tg.dataset.id); if (!r) return true;
      tg.outerHTML = `<input type="text" class="rrin" id="rr-name" data-id="${esc(r.id)}" maxlength="60" value="${esc(r.name)}" aria-label="${esc(t('i7.roundName'))}" autocomplete="off">`;
      const i = document.getElementById('rr-name'); i.focus(); i.select(); return true;
    }
    case 'round-cancel': V.roundForm = false; V.roundDraft = ''; C.renderBody(); return true;
    case 'round-create': {
      const name = document.getElementById('rd-name')?.value ?? V.roundDraft;
      if (!name.trim()){ document.getElementById('rd-name')?.focus(); return true; }
      let ok = false;
      try { ok = C.store.commit(d => { DOC.startRound(d, name); }, t('i7.undoRound', { name: name.trim() })); } catch (e){ C.toast(errText(e), 'bad'); return true; }
      if (ok){ V.roundForm = false; V.roundDraft = ''; V.fold.clear(); C.renderBody(); }
      return true;
    }
    case 'round-archive': C.store.commit(d => { DOC.mark(d, 'rounds', tg.dataset.id, { archived: tg.dataset.on === '1' }); }, t(tg.dataset.on === '1' ? 'i7.undoArchive' : 'i7.undoUnarchive')); C.renderBody(); return true;
    case 'rm-archive': C.store.commit(d => { DOC.mark(d, 'resumes', tg.dataset.id, { archived: tg.dataset.on === '1' }); }, t(tg.dataset.on === '1' ? 'i7.undoArchive' : 'i7.undoUnarchive')); C.renderBody(); return true;
    case 'scr-list': case 'scr-cards': V.list = a === 'scr-list'; try { localStorage.setItem(LIST_KEY, V.list ? '1' : '0'); } catch { /* this session only */ } C.renderBody(); return true;
    case 'scr-rfold': {      // a round's fold in the list, remembered as its <details> is in the cards
      const key = tg.dataset.round, on = tg.getAttribute('aria-expanded') !== 'true';
      V.fold.set(key || 'earlier', on); tg.setAttribute('aria-expanded', String(on));
      for (const x of document.querySelectorAll(`#scr-list tbody[data-in="${CSS.escape(key)}"]`)) x.hidden = !on;
      return true;
    }
    case 'scr-fold': {
      const id = tg.dataset.id, on = tg.getAttribute('aria-expanded') !== 'true';
      on ? V.open.add(id) : V.open.delete(id); tg.setAttribute('aria-expanded', String(on));
      for (const x of document.querySelectorAll(`#scr-list tr[data-parent="${CSS.escape(id)}"]`)) x.hidden = !on;
      return true;
    }
    case 'scr-sel': {
      const id = tg.dataset.id;
      LIB.clear(); V.sel = id; paintInspector(); return true;
    }
    case 'scr-lang': {      // a language of an item: selected, and the item drawn with it
      const id = tg.dataset.id, kind = tg.matches('.rlang') ? '.rlang' : 'tr[data-lid] .rsel';
      if (selId() === id && !LIB.sel()) return true;      // drawn already: the chip stays, so a double click on it reaches the list
      LIB.clear(); V.sel = id; V.lang.set(tg.dataset.item, id);
      document.getElementById('scr-list').innerHTML = listHtml(); afterResumes();
      document.querySelector(`#scr-list ${kind}[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      return true;
    }
    case 'scr-files': {      // an item's files: the list unfolds its row; the cards select it and bring the inspector to its files
      if (listing()){ const f = document.querySelector(`#scr-list .rfold[data-id="${CSS.escape(tg.dataset.item)}"]`); if (f) act('scr-fold', f); return true; }
      LIB.clear(); V.sel = tg.dataset.id; V.det.add('sent').add('files'); paintInspector();
      return true;
    }
    case 'nj-open': V.nj = V.sel = tg.dataset.id; paintInspector(); document.getElementById('nj-company')?.focus(); return true;
    case 'nj-cancel': V.nj = null; paintInspector(); return true;
    case 'nj-create': {
      const company = document.getElementById('nj-company')?.value.trim() ?? '', role = document.getElementById('nj-role')?.value.trim() ?? '';
      if (!company){ document.getElementById('nj-company')?.focus(); return true; }
      if (C.resumes.newJob(tg.dataset.id, company, role)){ V.draft.delete(tg.dataset.id); V.nj = V.sel = null; }      // the copy is the open resume: it is the selected card when the Library is next shown
      return true;
    }
    case 'cmp-row': focusRow(Number(tg.dataset.i)); return true;
    case 'cmp-next': stepDiff(1); return true;
    case 'cmp-prev': stepDiff(-1); return true;
    case 'scr-tick': {      // the inspector's strip: Add to export / Take out
      const id = tg.dataset.id;
      V.ticked.has(id) ? V.ticked.delete(id) : V.ticked.add(id);
      document.querySelectorAll(`#scr .rtick[data-cmp="${CSS.escape(id)}"]`).forEach(x => { x.checked = V.ticked.has(id); });
      refreshTicks(); document.querySelector('#istrip button')?.focus({ preventScroll: true }); return true;
    }
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
  LIB.bind(body);
  body.addEventListener('toggle', e => { if (e.target.matches?.('.idet')) V.det[e.target.open ? 'add' : 'delete'](e.target.dataset.k); }, true);      // a fold opened stays open from resume to resume
  body.addEventListener('toggle', e => { const d = e.target.closest?.('.rround'); if (d) V.fold.set(d.dataset.round || 'earlier', d.open); }, true);      // the folds of the rounds the person opened or shut
  body.addEventListener('change', e => {
    if (e.target.dataset?.resRound !== undefined) return moveTo(e.target.value, [e.target.dataset.resRound]);
    if (e.target.dataset?.moveRound !== undefined) return moveTo(e.target.value, tickedIds());
    if (e.target.id === 'scr-group'){ V.view = e.target.value; try { localStorage.setItem(VIEW_KEY, V.view); } catch { /* this session only */ } C.renderBody(); return; }
    if (e.target.id === 'scr-show'){ V.sentOnly = e.target.value === 'sent'; V.showArchived = e.target.value === 'archived'; C.renderBody(); return; }
    const key = e.target.dataset?.cmp;
    if (key === undefined) return;
    e.target.checked ? V.ticked.add(key) : V.ticked.delete(key);
    refreshTicks();
  });
  body.addEventListener('input', e => {
    if (e.target.id === 'rd-name'){ V.roundDraft = e.target.value; return; }
    if (e.target.id === 'nj-company' || e.target.id === 'nj-role'){ V.draft.set(V.nj, { ...V.draft.get(V.nj), [e.target.id === 'nj-company' ? 'company' : 'role']: e.target.value }); return; }
    if (e.target.id === 'cmp-q'){ F.q = e.target.value; markRows(); return; }
    if (e.target.id !== 'scr-q') return;
    F.q = e.target.value;
    document.getElementById('scr-list').innerHTML = listHtml(); afterResumes();
  });
  body.addEventListener('wheel', turnPreview, { passive: false });
  body.addEventListener('pointerover', e => {
    if (phone() || RD.ghost) return;
    const w = e.target.closest?.('.rcard .thumbwrap, .insp-res .ihero'); if (!w) return;
    const card = w.closest('.rcard') ?? w; if (HV.card === card || card.dataset.did) return;      // a document has no page to show large
    clearTimeout(HV.t); HV.t = setTimeout(() => showPreview(card), 350);
  });
  body.addEventListener('pointerout', e => { const w = e.target.closest?.('.rcard .thumbwrap, .insp-res .ihero'); if (w && !w.contains(e.relatedTarget)) hidePreview(); });
  body.addEventListener('scroll', () => { if (HV.n < 2) hidePreview(); }, true);
  body.addEventListener('pointerdown', hidePreview);
  body.addEventListener('pointerdown', carryCard);
  body.addEventListener('dragstart', e => { if (e.target.closest?.('#scr-list :is(.rcard, .rline)')) e.preventDefault(); });      // a card's picture is not the browser's to drag
  body.addEventListener('click', e => { if (e.target.closest?.('.rround > summary :is(.rrname, #rr-name)')) e.preventDefault(); });      // the name is written, it does not fold the round
  body.addEventListener('focusout', e => { if (e.target.id === 'rr-name') renameRound(e.target, true); });
  body.addEventListener('keyup', e => { if (e.target.id === 'rr-name' && e.key === ' ') e.preventDefault(); });      // a space typed in the name does not fold the round
  body.addEventListener('click', e => { if (RD.spent){ RD.spent = false; e.stopPropagation(); e.preventDefault(); } }, true);      // the click that ends a carry is not a click
  // a click on a card's picture or its blank space (a row's cells) is a click on the card (its name button takes the rest)
  body.addEventListener('click', e => { const c = e.target.closest?.(':is(.rcard, .rline)'); if (c && !e.target.closest('input, button, select, a, .rowmenu')) c.dataset.did ? act('doc-sel', { dataset: { id: c.dataset.did } }) : act('scr-sel', { dataset: { id: c.dataset.rid } }); });
  // a double click opens it (on a language's chip or row: that language)
  body.addEventListener('dblclick', e => { const c = e.target.closest?.(':is(.rcard, .rline, tr[data-lid])'), id = e.target.closest?.('[data-act=scr-lang]')?.dataset.id ?? c?.dataset.rid ?? c?.dataset.lid; if (id && !e.target.closest('input')) C.resumes.open(id); });
  body.addEventListener('keydown', e => {
    if (e.target.id === 'rr-name' && (e.key === 'Enter' || e.key === 'Escape')){ e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape' || e.target.value.trim()) renameRound(e.target, e.key === 'Enter'); return; }      // an empty name is not kept
    if (e.target.closest?.('#round-form') && e.key === 'Enter'){ e.preventDefault(); document.querySelector('[data-act=round-create]')?.click(); return; }
    if (e.target.closest?.('#round-form') && e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); V.roundForm = false; V.roundDraft = ''; C.renderBody(); return; }
    if (e.target.closest?.('.njform') && e.key === 'Enter'){ e.preventDefault(); document.querySelector('[data-act=nj-create]')?.click(); return; }
    if (e.target.closest?.('.njform') && e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); clearSel(); return; }
    if (e.target.id === 'cmp-q'){
      if (e.key === 'Enter' && !e.isComposing){ e.preventDefault(); stepFound(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); if (F.q){ F.q = ''; e.target.value = ''; markRows(); } else C.leave(); }
      return;
    }
    // Enter on a card's or a row's name opens it (a click only selects)
    if (e.key === 'Enter' && e.target.matches?.('#scr-list .rsel:is([data-act=scr-sel], [data-act=scr-lang])')){ e.preventDefault(); C.resumes.open(e.target.dataset.id); return; }
    // the list: ↑ ↓ go from row to row and select it, → and ← unfold and fold a resume's sent copies and files (not the page's keys)
    if (e.target.matches?.('.rtable .rsel') && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)){
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown'){ const all = [...document.querySelectorAll('#scr-list .rtable tr:not([hidden]) .rsel')].filter(b => b.getClientRects().length), i = all.indexOf(e.target); const to = all[i + (e.key === 'ArrowDown' ? 1 : -1)]; to?.focus(); if (to) act(to.dataset.act, to); return; }
      const f = e.target.closest('tr').querySelector('.rfold');
      if (f && (f.getAttribute('aria-expanded') === 'true') !== (e.key === 'ArrowRight')) f.click();
      return;
    }
    if (e.target.id === 'scr-q' && e.key === 'Escape' && !F.q && F.claim){ e.preventDefault(); e.stopPropagation(); F.claim = null; C.renderBody(); }
    else if (e.target.id === 'scr-q' && e.key === 'Escape' && F.q){ e.preventDefault(); e.stopPropagation(); F.q = ''; e.target.value = ''; e.target.dispatchEvent(new Event('input', { bubbles: true })); }
    else if (e.target.id === 'scr-q' && e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); C.leave(); }
  });
}

// ---- Compare's line in the sidebar's card: how many resumes, how many rows differ ----
const placeCard = () => `<p class="psub">${h('ux6h.compare')} · ${h('ux6h.cmpSub', { n: V.cmp.length, d: rowsNow().filter(r => r.differs).length })}</p>`;

const api = { act, bind, compare, pick: id => { V.sel = id; }, placeCard, target, inspected: () => (LIB.sel() ? null : selId()), clearSel, canCompare: () => V.cmp.length >= 2, focusSel: () => document.querySelector('#scr-list :is(.rcard, .rline).sel .rsel'),
  views: { resumes: resumesView, compare: compareView }, after: { resumes: afterResumes, compare: afterCompare } };
