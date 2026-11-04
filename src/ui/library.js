// The Library's documents: a card for each group of files (the formats of one resume, its languages, its letter), the inspector of one (a preview, where the original is kept and
// whether it is safe to delete, what was taken from it, Place lines, Rebuild, Download, Remove), and the removing of a round's resumes and documents. screens.js draws the Library
// and its rounds around these; the model is src/model/documents.js, resumes.js (docGroups, rebuildFrom, dropDuplicates) and intake.js (placeLines).
// A document's text and name are always written as text (esc), and a PDF original reaches the page only as pictures of its pages drawn by PDF.js (no frame, no plugin).
// shortcut: "Show in folder" and the tick that deletes the file in the folder as well are not here yet (a document with a path is removed from the Library, its file left in the folder), and Remove takes the document with its embedded original.

import * as RS from '../model/resumes.js';
import * as DOC from '../model/documents.js';
import * as X from '../model/intake.js';
import { entriesOf } from '../model/entries.js';
import { isAssetRef } from '../store/store.js';
import { t, h, errText } from '../i18n/index.js';
import { langName } from '../model/lang.js';
import { placeMenu, kb } from './files.js';
import { icon } from './icons.js';
import { pdfPages, copyCanvas } from '../parse/pdf.js';
import { snippet } from './find.js';

let C = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// sel: the group shown in the inspector; member: the file of it that is looked at; panel: 'place', 'remove', 'keeptext' or 'dups'; picks: where each unplaced line goes (by its place in `taken.lines`);
// keep: the copies ticked to stay; ok: the tick that lets a removal go; rm: the round whose "Remove these…" is open, with its ticks; pages: the pages of the PDF shown, drawn once ({ sha, urls })
const L = { sel: null, member: null, panel: null, picks: new Map(), keep: new Set(), ok: false, rm: null, rmTicks: new Set(), pages: null };
const st = () => C.store.state;

export function initLibrary(ctx){ C = ctx; return api; }

// ---- what a document is, in short ----
const bytesUrl = ref => (isAssetRef(ref) ? C.store.asset(ref) ?? null : ref ?? null);      // an original or a picture: a data: URL
const typeOf = d => (/\.([A-Za-z0-9]{1,5})$/.exec(d.name)?.[1] ?? d.type?.split(/[/.+]/).pop() ?? '').toUpperCase().slice(0, 5);
const isLetter = d => (d.meta?.kind ?? d.kind) === 'cover-letter';
const dateOf = d => d.meta?.date || String(d.addedAt ?? '').slice(0, 10);
const first = d => String(d.text ?? '').split('\n').find(l => l.trim())?.trim() ?? '';
const company = d => (d.meta?.company && d.meta?.role ? `${d.meta.company} — ${d.meta.role}` : d.meta?.company || d.meta?.role || '');
const groups = () => RS.docGroups(st());
const ctx = () => ({ checked: C.files.checked(), protect: C.files.receipt() });      // what the guard of every removal asks: the file checked, the receipt on the screen
const groupOf = id => groups().find(g => g.id === id) ?? null;
// the card's one state line: lines not placed, a file kept unread, or all in the career
const stateOf = g => {
  const un = g.members.reduce((n, m) => n + (m.taken?.unplaced ?? 0), 0), gone = g.members.map(m => C.space.docStatus(m.id));
  return gone.includes('cloud') ? ['cloud', t('i8.inCloud')] : gone.includes('missing') ? ['missing', t('i8.missing')] : un ? ['unplaced', t('i7.stUnplaced', { n: un })] : g.members.every(m => !String(m.text ?? '').trim()) ? ['file', t('i7.stFile')] : ['record', t('i7.stRecord')];
};

// ---- search: a group is found by its names and by the words in any of its files' text ----
const hits = (g, q) => {
  const n = String(q ?? '').trim().toLowerCase();
  return n ? g.members.flatMap(m => String(m.text ?? '').split('\n')).filter(l => l.toLowerCase().includes(n)) : [];
};
export const matches = (g, q) => {
  const n = String(q ?? '').trim().toLowerCase();
  return !n || g.members.some(m => [m.name, m.meta?.company, m.meta?.role, m.meta?.lang].some(x => String(x ?? '').toLowerCase().includes(n))) || hits(g, q).length > 0;
};

// ---- the card, and the list's row ----
const langs = g => [...new Set(g.members.map(m => m.meta?.lang).filter(Boolean))].map(l => l.toUpperCase()).join('/');
const docHooks = (g, state) => `data-did="${esc(g.id)}" data-kind="${esc(g.lead.meta?.kind ?? '')}" data-formats="${g.members.length}" data-state="${state[0]}" ${g.resume ? `data-from="${esc(g.resume)}"` : ''} ${g.members.every(m => m.archived) ? 'data-archived="1"' : ''}`;
const pills = g => g.members.map(m => `<span class="pill" data-member="${esc(m.id)}">${esc(isLetter(m) ? t('i7.letter') : typeOf(m))}</span>`).join('');
export function card(g, q = ''){
  const d = g.lead, resume = g.resume && RS.savedOf(st(), g.resume), pic = bytesUrl(d.thumb), state = stateOf(g), hit = hits(g, q)[0], sel = L.sel === g.id;
  const meta = [company(d), dateOf(d), langs(g)].filter(Boolean).join(' · ');
  return `<article class="rcard rdoc ${sel ? 'sel' : ''}" ${docHooks(g, state)}>
    <span class="thumbwrap"><span class="rthumb dthumb" style="aspect-ratio:210 / 297">${pic ? `<img src="${esc(pic)}" alt="">` : `<span class="dbadge">${esc(typeOf(d))}</span><span class="dline">${esc(first(d))}</span>`}</span></span>
    <h4 class="rname"><button class="rsel" data-act="doc-sel" data-id="${esc(g.id)}" aria-pressed="${sel}">${esc(d.name)}</button></h4>
    <p class="rmeta">${esc(meta)}</p>
    ${resume ? `<p class="rfrom">${esc(t('i7.exportedFrom', { name: RS.resumeLabel(resume) }))}</p>` : ''}
    ${hit ? `<p class="rhit">${snippet(hit, q)}</p>` : ''}
    <p class="rbadges">${pills(g)}</p>
    <p class="rstate" data-state="${state[0]}">${esc(state[1])}</p>
  </article>`;
}
// the list's columns after the tick (screens.js names them): every one a cell, blank where there is nothing; `name` is ready HTML
export const COLS = ['name', 'role', 'company', 'paper', 'lang', 'pages', 'sent', 'changed'];
export const cells = o => COLS.map(k => `<td class="c-${k}">${k === 'name' ? (o.name ?? '') : esc(o[k] ?? '')}</td>`).join('');
// a document group's row: on its own, or under the resume it was exported from (parent), hidden while that resume is folded
export function row(g, q = '', parent = null, hidden = false){
  const d = g.lead, state = stateOf(g), hit = hits(g, q)[0], sel = L.sel === g.id;
  return `<tr class="rline rdoc ${parent ? 'rsub' : ''} ${sel ? 'sel' : ''}" ${docHooks(g, state)} ${parent ? `data-parent="${esc(parent)}"` : ''} ${hidden ? 'hidden' : ''}><td class="c-tick"></td>
    ${cells({ name: `<span class="cname"><span class="ficon">${icon('fileout', { role: 'inline' })}</span><button class="rsel" data-act="doc-sel" data-id="${esc(g.id)}" aria-pressed="${sel}">${esc(d.name)}</button>${pills(g)}<span class="rstate" data-state="${state[0]}">${esc(state[1])}</span></span>${hit ? `<span class="rhit">${snippet(hit, q)}</span>` : ''}`, company: d.meta?.company, role: d.meta?.role, lang: langs(g), changed: dateOf(d) })}</tr>`;
}

// ---- the inspector ----
const bytesOf = data => { const bin = atob(data.slice(data.indexOf(',') + 1)); return Uint8Array.from(bin, c => c.charCodeAt(0)); };
// The pages of a PDF original, drawn by PDF.js after the inspector is on the screen (up to 8, as the layout view); the picture of the first page stands in until they are there.
// shortcut: one document's pages are kept (the last shown), so going back to it draws them again; a PDF PDF.js cannot draw keeps its first-page picture.
async function drawPages(){
  const host = document.querySelector('#body .dpages'), d = host && members().find(m => m.id === host.dataset.id);
  if (!d?.embedded || d.type !== 'application/pdf') return;
  try {
    if (L.pages?.sha !== d.sha256) L.pages = { sha: d.sha256, cvs: (await pdfPages(bytesOf(bytesUrl(d.embedded)), 420)).map(p => p.canvas) };
  } catch { return; }
  if (host.isConnected && L.pages?.sha === d.sha256) host.replaceChildren(...L.pages.cvs.map(c => Object.assign(copyCanvas(c), { className: 'dpage' })));
}
const claimLinks = (d, n = 6) => {
  const rec = st().record, ids = d.taken?.claims ?? [];
  return ids.slice(0, n).map(id => {
    const f = rec.facts.find(x => x.id === id), w = entriesOf(rec).find(e => (e.highlights ?? []).includes(id));
    const v = f && rec.variants.find(x => x.id === f.variants[0]);
    return `<li><button class="sm" data-act="rec-job" data-id="${esc(w?.id ?? id)}">${esc((v?.text ?? id).slice(0, 80))}</button></li>`;
  }).join('') + (ids.length > n ? `<li class="small muted">+${ids.length - n}</li>` : '');
};
const ticks = sf => `<ul class="small ticks" data-safe="${sf.safe}">${[sf.read, sf.record, sf.kept].map(x => `<li data-ok="${x.ok}" data-state="${x.state}">${x.ok ? '✓' : '○'} ${esc(x.text)}</li>`).join('')}</ul><p><b>${esc(sf.text)}</b></p>`;

function placePanel(d){
  const lines = d.taken?.lines ?? [], rec = { sim: { record: st().record } };
  return `<div class="dpanel" data-panel="place"><p class="note">${h('i6.unplacedNote')}</p><div class="mlist">${lines.map((text, i) =>
    `<div class="mi ro" data-line="${i}"><span class="sym keep">?</span><span><span class="mx">${esc(text)}</span>${placeMenu(X.placeOptions(rec, { text }), { choice: L.picks.get(i) ?? '' }, `data-lplace="${i}"`)}</span></div>`).join('')}</div>
    <div class="btns"><button class="primary" data-act="doc-place-do" ${[...L.picks.values()].some(Boolean) ? '' : 'disabled'}>${h('i7.placeDo')}</button><button data-act="doc-panel-close">${h('ux6h.cancel')}</button></div></div>`;
}
// a tick that lets Remove from Library, or Keep text only, go ahead (nothing is dropped without it)
function confirmPanel(kind, d){
  return `<div class="dpanel" data-panel="${kind}"><label class="check"><input type="checkbox" data-lok ${L.ok ? 'checked' : ''}> ${h(kind === 'remove' ? 'i7.removeTick' : 'i7.keepTextTick', { name: d.name })}</label>
    <div class="btns"><button class="del" data-act="doc-${kind}-do" ${L.ok ? '' : 'disabled'}>${h(kind === 'remove' ? 'i7.removeDo' : 'i7.keepText')}</button><button data-act="doc-panel-close">${h('ux6h.cancel')}</button></div></div>`;
}
function dupsPanel(g, d){
  const ids = RS.copiesOf(st(), d.id), keep = [...L.keep], gone = RS.dropDuplicates(st(), ids, keep, ctx(), true);
  return `<div class="dpanel" data-panel="dups"><p class="note">${h('i7.dupsNote')}</p><div class="mlist">${ids.map(id => {
    const m = g.members.find(x => x.id === id) ?? d, forced = !gone.includes(id) && !L.keep.has(id) && L.keep.size > 0;
    return `<label class="mi"><input type="checkbox" data-lkeep="${esc(id)}" ${L.keep.has(id) || forced ? 'checked' : ''} ${forced ? 'disabled' : ''}><span><span class="mw">${esc(m.name)}</span><span class="mx">${esc(`${typeOf(m)} · ${kb(m.size)}`)}${forced ? ` · ${esc(t('i7.dupsForced'))}` : ''}</span></span></label>`;
  }).join('')}</div>
    <div class="btns"><button class="del" data-act="doc-dups-do" ${gone.length ? '' : 'disabled'}>${h('i7.dupsDo', { n: gone.length })}</button><button data-act="doc-panel-close">${h('ux6h.cancel')}</button></div></div>`;
}

export function inspector(){
  const g = groupOf(L.sel);
  if (!g) return '';
  const d = g.members.find(m => m.id === L.member) ?? g.lead, rounds = st().rounds ?? [], resume = g.resume && RS.savedOf(st(), g.resume);
  const sf = DOC.safety(d, { lastFileSave: C.persist.fileState.last, checked: C.files.checked(), folderVerified: C.space.verified(d) });
  const pic = bytesUrl(d.thumb), un = d.taken?.lines?.length ?? 0, copies = RS.copiesOf(st(), d.id), archived = g.members.every(m => m.archived);
  const says = isLetter(d) ? X.mentions(st().record, d.text) : [];
  return `<section class="insp insp-doc" aria-label="${esc(d.name)}" data-did="${esc(g.id)}" data-member="${esc(d.id)}">
    <div class="ihero">${pic ? `<div class="dpages" data-id="${esc(d.id)}"><img class="dpage" src="${esc(pic)}" alt=""></div>` : `<p class="dtext">${esc(String(d.text ?? '').split('\n').slice(0, 12).join('\n'))}</p>`}</div>
    <div class="ihcap"><span class="lbl">${h('ux6h.selected')}</span><h2 class="oi-name">${esc(d.name)}</h2><p class="small">${esc([company(d), dateOf(d), d.meta?.lang ? langName(d.meta.lang) : '', `${typeOf(d)} · ${kb(d.size)}`].filter(Boolean).join(' · '))}</p></div>
    ${resume ? `<p class="small" data-from="${esc(resume.id)}">${esc(t('i7.exportedFrom', { name: RS.resumeLabel(resume) }))} <button class="sm" data-act="sw-open" data-id="${esc(resume.id)}">${h('ux6e.openBtn')}</button></p>` : ''}
    ${g.members.length > 1 ? `<span class="lbl">${h('i7.formats')}</span><ul class="dformats">${g.members.map(m => `<li><button class="sm" data-act="doc-member" data-id="${esc(m.id)}" aria-pressed="${m.id === d.id}">${esc(`${isLetter(m) ? t('i7.letter') : typeOf(m)} · ${m.name} · ${kb(m.size)}`)}</button></li>`).join('')}</ul>` : ''}
    <div class="btns iacts">
      ${un ? `<button class="sm" data-act="doc-place" data-state="${L.panel === 'place' ? 'open' : ''}">${h('i7.place', { n: un })}</button>` : ''}
      ${String(d.text ?? '').trim() && !isLetter(d) && d.meta?.kind !== 'other' ? `<button class="sm primary" data-act="doc-rebuild" data-id="${esc(d.id)}">${h('i7.rebuild')}</button>` : ''}
      ${d.embedded ? `<button class="sm" data-act="doc-download" data-id="${esc(d.id)}">${h('i7.download')}</button>` : ''}
      ${archived ? `<button class="sm" data-act="doc-archive" data-on="0">${h('i7.unarchive')}</button>` : ''}
    </div>
    ${L.panel === 'place' ? placePanel(d) : ''}
    ${rounds.length ? `<label class="field"><span class="lbl">${h('i7.round')}</span><select data-doc-round aria-label="${esc(t('i7.round'))}"><option value="">${h('i7.earlier')}</option>${rounds.map(r => `<option value="${esc(r.id)}" ${r.id === d.round ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>` : ''}
    <span class="lbl">${h('i7.kept')}</span>${ticks(sf)}
    <div class="btns"><button class="sm" data-act="imp-check">${h('i6.checkFile')}</button></div>
    <span class="lbl">${h('i7.taken')}</span>
    <p class="small" data-taken="${(d.taken?.claims ?? []).length}.${(d.taken?.versions ?? []).length}">${esc(t('i7.takenN', { c: (d.taken?.claims ?? []).length, v: (d.taken?.versions ?? []).length, s: (d.taken?.skipped ?? []).length }))}</p>
    ${(d.taken?.claims ?? []).length ? `<ul class="dtaken">${claimLinks(d)}</ul>` : ''}
    ${says.length ? `<span class="lbl">${h('i7.mentions')}</span><ul class="dmentions" data-mentions="${says.length}">${says.map(x => `<li>${esc(x.text.slice(0, 120))}</li>`).join('')}</ul>` : ''}
    <div class="btns">
      ${copies.length > 1 ? `<button class="sm" data-act="doc-dups">${h('i7.dups')}</button>` : ''}
      ${d.embedded ? `<button class="sm" data-act="doc-keeptext">${h('i7.keepText')}</button>` : ''}
      <button class="sm del" data-act="doc-remove">${h('i7.remove')}</button>
    </div>
    ${L.panel === 'dups' ? dupsPanel(g, d) : ''}${L.panel === 'remove' || L.panel === 'keeptext' ? confirmPanel(L.panel, d) : ''}
  </section>`;
}

// ---- Remove these…, in an archived round: its resumes and documents with ticks, none ticked ----
// the ticks that are still on something in the round (an item moved to another round has lost its tick)
const liveTicks = id => { const { resumes, documents } = DOC.roundItems(st(), id), live = new Set([...resumes.map(r => `r:${r}`), ...documents.map(d => `d:${d}`)]); return [...L.rmTicks].filter(k => live.has(k)); };
export function roundPanel(round){
  L.rmTicks = new Set(liveTicks(round.id));
  const { resumes, documents } = DOC.roundItems(st(), round.id), docs = documents.map(id => st().documents.find(d => d.id === id));
  const row = (key, name, extra) => `<label class="mi"><input type="checkbox" data-rmk="${esc(key)}" ${L.rmTicks.has(key) ? 'checked' : ''}><span><span class="mw">${esc(name)}</span><span class="mx">${esc(extra)}</span></span></label>`;
  return `<div class="dpanel" data-panel="round" data-round="${esc(round.id)}"><p class="note">${h('i7.rmNote')}</p><div class="mlist">${resumes.map(id => row(`r:${id}`, RS.resumeLabel(RS.savedOf(st(), id)), t('i7.aResume'))).join('')}${docs.map(d => row(`d:${d.id}`, d.name, typeOf(d))).join('')}</div>
    <div class="btns"><button class="del" data-act="rm-round-do" data-id="${esc(round.id)}" ${L.rmTicks.size ? '' : 'disabled'}>${h('i7.rmDo', { n: L.rmTicks.size })}</button><button data-act="rm-round-close">${h('ux6h.cancel')}</button></div></div>`;
}

// ---- acts ----
// A checkpoint first, then the change; and nothing that drops an original goes while it is not safe (dropGuard), which is said in one line before anything is made.
function refused(ids){
  if (!RS.dropGuard(st(), ids, ctx()).length) return false;
  C.toast(t('i7.saveFirst'), 'warn'); return true;
}
async function checkpointed(label, fn){
  try { await C.persist.checkpoint(label); } catch (e){ C.toast(errText(e), 'bad'); return false; }      // nothing is removed without a checkpoint
  try { const ok = C.store.commit(d => { fn(d); }, label); C.store.gcAssets(); return ok; } catch (e){ C.toast(errText(e), 'bad'); return false; }
}
const members = () => groupOf(L.sel)?.members ?? [];
const current = () => members().find(m => m.id === L.member) ?? groupOf(L.sel)?.lead;
function save(bytes, name, type){
  const a = document.createElement('a'), url = URL.createObjectURL(new Blob([bytes], { type }));
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function act(a, tg){
  const id = tg.dataset.id;
  switch (a){
    case 'doc-sel': L.sel = id; L.member = null; L.panel = null; L.picks.clear(); L.ok = false; C.repaint(); return true;
    case 'doc-member': L.member = id; L.panel = null; L.picks.clear(); C.repaint(); return true;
    case 'doc-panel-close': L.panel = null; C.repaint(); return true;
    case 'doc-place': L.panel = L.panel === 'place' ? null : 'place'; L.picks.clear(); C.repaint(); return true;
    case 'doc-remove': case 'doc-keeptext': L.panel = a === 'doc-remove' ? 'remove' : 'keeptext'; L.ok = false; C.repaint(); return true;
    case 'doc-dups': L.panel = 'dups'; L.keep = new Set(RS.copiesOf(st(), current().id).slice(0, 1)); C.repaint(); return true;
    case 'doc-rebuild': C.resumes.rebuild(id); return true;
    case 'doc-download': {
      const d = members().find(m => m.id === id), data = d && bytesUrl(d.embedded);
      try { if (data) save(bytesOf(data), d.name, d.type || 'application/octet-stream'); }
      catch { C.toast(t('i7.badOriginal'), 'bad'); }      // a stored original that is not valid base64
      return true;
    }
    case 'doc-archive': {
      const on = tg.dataset.on === '1';
      C.store.commit(d => { for (const m of members()) DOC.mark(d, 'documents', m.id, { archived: on }); }, t(on ? 'i7.undoArchive' : 'i7.undoUnarchive'));
      C.renderBody(); return true;
    }
    case 'doc-keeptext-do': {
      const d = current();
      if (!L.ok || refused([d.id])) return true;
      if (await checkpointed(t('i7.checkpointKeepText', { name: d.name }), x => RS.keepTextGuarded(x, d.id, ctx()))){ L.panel = null; L.ok = false; }
      C.renderBody(); return true;
    }
    case 'doc-place-do': {
      const d = current(), lines = d.taken?.lines ?? [];
      const picks = lines.map((text, i) => ({ text, choice: L.picks.get(i) ?? '' }));
      await C.persist.checkpoint(t('i7.checkpointPlace', { name: d.name })).catch(() => null);
      C.store.commit(x => { X.placeLines(x, d.id, picks); }, t('i7.undoPlace', { name: d.name }));
      L.panel = null; L.picks.clear(); C.renderBody(); return true;
    }
    case 'doc-remove-do': {
      const d = current();
      if (!L.ok || refused([d.id])) return true;
      if (await checkpointed(t('i7.checkpointRemove', { name: d.name }), x => RS.removeGuarded(x, [d.id], ctx()))){ L.sel = null; L.member = null; L.panel = null; C.toast(t('i7.removed', { name: d.name })); }
      C.renderBody(); return true;
    }
    case 'doc-dups-do': {
      const ids = RS.copiesOf(st(), current().id); let gone = [];
      if (!RS.dropDuplicates(st(), ids, [...L.keep], ctx(), true).length) return true;
      if (await checkpointed(t('i7.checkpointDups'), x => { gone = RS.dropDuplicates(x, ids, [...L.keep], ctx()); })){ L.panel = null; L.member = null; C.toast(t('i7.dupsDone', { n: gone.length })); }
      C.renderBody(); return true;
    }
    case 'rm-round-open': L.rm = id; L.rmTicks.clear(); C.renderBody(); return true;
    case 'rm-round-close': L.rm = null; L.rmTicks.clear(); C.renderBody(); return true;
    case 'rm-round-do': {
      const ticks = liveTicks(id), rs = ticks.filter(k => k.startsWith('r:')).map(k => k.slice(2)), ds = ticks.filter(k => k.startsWith('d:')).map(k => k.slice(2));
      if (!ticks.length || refused(ds)) return true;
      if (await checkpointed(t('i7.checkpointRound'), x => { for (const r of rs) RS.deleteSaved(x, r); if (ds.length) RS.removeGuarded(x, ds, ctx()); })){ L.rm = null; L.rmTicks.clear(); C.toast(t('i7.rmDone', { n: rs.length + ds.length })); }
      C.renderBody(); return true;
    }
  }
  return false;
}

// the selects and ticks of the inspector and of Remove these…
function bind(body){
  body.addEventListener('change', e => {
    const x = e.target;
    if (x.dataset?.lplace !== undefined){ L.picks.set(Number(x.dataset.lplace), x.value); const b = body.querySelector('[data-act=doc-place-do]'); if (b) b.disabled = ![...L.picks.values()].some(Boolean); }
    else if (x.dataset?.lok !== undefined){ L.ok = x.checked; const b = body.querySelector('[data-act=doc-remove-do], [data-act=doc-keeptext-do]'); if (b) b.disabled = !L.ok; }
    else if (x.dataset?.lkeep !== undefined){ x.checked ? L.keep.add(x.dataset.lkeep) : L.keep.delete(x.dataset.lkeep); C.repaint(); }
    else if (x.dataset?.rmk !== undefined){
      x.checked ? L.rmTicks.add(x.dataset.rmk) : L.rmTicks.delete(x.dataset.rmk);
      const b = document.querySelector('[data-act=rm-round-do]'); if (b){ b.disabled = !L.rmTicks.size; b.textContent = t('i7.rmDo', { n: L.rmTicks.size }); }
    } else if (x.dataset?.docRound !== undefined){
      C.store.commit(d => { for (const m of members()) DOC.mark(d, 'documents', m.id, { round: x.value }); }, t('i7.undoRound'));
      C.renderBody();
    }
  });
}

const api = {
  card, row, inspector, roundPanel, matches, act, bind, after: drawPages,
  sel: () => (groupOf(L.sel) ? L.sel : null), rm: () => L.rm,
  clear(){ L.sel = null; L.member = null; L.panel = null; L.pages = null; },
};
