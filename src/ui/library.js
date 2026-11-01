// The Library's documents (I-7): a card for each group of files (the formats of one resume, its languages, its letter), the inspector of one (a preview, where the original is kept and
// whether it is safe to delete, what was taken from it, Place lines, Rebuild, Download, Remove), and the removing of a round's resumes and documents. screens.js draws the Library
// and its rounds around these; the model is src/model/documents.js, resumes.js (docGroups, rebuildFrom, dropDuplicates) and intake.js (placeLines).
// A document's text and name are always written as text (esc), and its original only ever reaches the page as a sandboxed frame of a blob: URL.
// shortcut: there is no linked folder yet (I-8), so no document has a path: "Show in folder" and the tick that deletes the file in the folder as well are not here, and Remove takes the document with its embedded original.

import * as RS from '../model/resumes.js';
import * as DOC from '../model/documents.js';
import * as X from '../model/intake.js';
import { entriesOf } from '../model/entries.js';
import { isAssetRef } from '../store/store.js';
import { t, h, errText } from '../i18n/index.js';
import { langName } from '../model/lang.js';
import { placeMenu } from './files.js';
import { snippet } from './find.js';

let C = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// sel: the group shown in the inspector; member: the file of it that is looked at; panel: 'place', 'remove' or 'dups'; picks: where each unplaced line goes (by its place in `taken.lines`);
// keep: the copies ticked to stay; ok: the tick that lets a removal go; rm: the round whose "Remove these…" is open, with its ticks; url: the blob: address of the preview
const L = { sel: null, member: null, panel: null, picks: new Map(), keep: new Set(), ok: false, rm: null, rmTicks: new Set(), url: null };
const st = () => C.store.state;

export function initLibrary(ctx){ C = ctx; return api; }

// ---- what a document is, in short ----
const bytesUrl = ref => (isAssetRef(ref) ? C.store.asset(ref) ?? null : ref ?? null);      // an original or a picture: a data: URL
const typeOf = d => (/\.([A-Za-z0-9]{1,5})$/.exec(d.name)?.[1] ?? d.type?.split(/[/.+]/).pop() ?? '').toUpperCase().slice(0, 5);
const isLetter = d => (d.meta?.kind ?? d.kind) === 'cover-letter';
const dateOf = d => d.meta?.date || String(d.addedAt ?? '').slice(0, 10);
const kb = n => (n < 1024 * 100 ? `${(n / 1024).toFixed(1)} KB` : `${Math.round(n / 1024)} KB`);
const first = d => String(d.text ?? '').split('\n').find(l => l.trim())?.trim() ?? '';
const company = d => (d.meta?.company && d.meta?.role ? `${d.meta.company} — ${d.meta.role}` : d.meta?.company || d.meta?.role || '');
const groups = () => RS.docGroups(st());
const groupOf = id => groups().find(g => g.id === id) ?? null;
// the card's one state line: lines not placed, a file kept unread, or all in the career
const stateOf = g => {
  const un = g.members.reduce((n, m) => n + (m.taken?.unplaced ?? 0), 0);
  return un ? ['unplaced', t('i7.stUnplaced', { n: un })] : g.members.every(m => !String(m.text ?? '').trim()) ? ['file', t('i7.stFile')] : ['record', t('i7.stRecord')];
};

// ---- search: a group is found by its names and by the words in any of its files' text ----
export const hits = (g, q) => {
  const n = String(q ?? '').trim().toLowerCase();
  return n ? g.members.flatMap(m => String(m.text ?? '').split('\n')).filter(l => l.toLowerCase().includes(n)) : [];
};
export const matches = (g, q) => {
  const n = String(q ?? '').trim().toLowerCase();
  return !n || g.members.some(m => [m.name, m.meta?.company, m.meta?.role, m.meta?.lang].some(x => String(x ?? '').toLowerCase().includes(n))) || hits(g, q).length > 0;
};

// ---- the card ----
export function card(g, q = ''){
  const d = g.lead, resume = g.resume && RS.savedOf(st(), g.resume), pic = bytesUrl(d.thumb), state = stateOf(g), hit = hits(g, q)[0], sel = L.sel === g.id;
  const meta = [company(d), dateOf(d), [...new Set(g.members.map(m => m.meta?.lang).filter(Boolean))].map(l => l.toUpperCase()).join('/')].filter(Boolean).join(' · ');
  return `<article class="rcard rdoc ${sel ? 'sel' : ''}" data-did="${esc(g.id)}" data-kind="${esc(d.meta?.kind ?? '')}" data-formats="${g.members.length}" data-state="${state[0]}" ${g.resume ? `data-from="${esc(g.resume)}"` : ''} ${g.members.every(m => m.archived) ? 'data-archived="1"' : ''}>
    <span class="thumbwrap"><span class="rthumb dthumb" style="aspect-ratio:210 / 297">${pic ? `<img src="${esc(pic)}" alt="">` : `<span class="dbadge">${esc(typeOf(d))}</span><span class="dline">${esc(first(d))}</span>`}</span></span>
    <h4 class="rname"><button class="rsel" data-act="doc-sel" data-id="${esc(g.id)}" aria-pressed="${sel}">${esc(d.name)}</button></h4>
    <p class="rmeta">${esc(meta)}</p>
    ${resume ? `<p class="rfrom">${esc(t('i7.exportedFrom', { name: RS.resumeLabel(resume) }))}</p>` : ''}
    ${hit ? `<p class="rhit">${snippet(hit, q)}</p>` : ''}
    <p class="rbadges">${g.members.map(m => `<span class="pill" data-member="${esc(m.id)}">${esc(isLetter(m) ? t('i7.letter') : typeOf(m))}</span>`).join('')}</p>
    <p class="rstate" data-state="${state[0]}">${esc(state[1])}</p>
  </article>`;
}

// ---- the inspector ----
// the preview is the browser's own PDF viewer, in a frame of a blob: address with no permissions at all (sandbox=""): the file's own scripts never run in the page.
// shortcut: Chromium and Brave refuse to show a PDF in any sandboxed frame (an error page), so it is behind a button and the first page's picture is what shows; upgrade by drawing the pages with PDF.js (pdfPages) here, which needs no frame and no change to the page's policy, if the owner prefers.
function previewUrl(d){
  if (L.url){ URL.revokeObjectURL(L.url); L.url = null; }
  const data = d.type === 'application/pdf' ? bytesUrl(d.embedded) : null;
  if (!data) return null;
  const bin = atob(data.slice(data.indexOf(',') + 1));
  return (L.url = URL.createObjectURL(new Blob([Uint8Array.from(bin, c => c.charCodeAt(0))], { type: 'application/pdf' })));
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
function removePanel(d){
  return `<div class="dpanel" data-panel="remove"><label class="check"><input type="checkbox" data-lok ${L.ok ? 'checked' : ''}> ${h('i7.removeTick', { name: d.name })}</label>
    <div class="btns"><button class="del" data-act="doc-remove-do" ${L.ok ? '' : 'disabled'}>${h('i7.removeDo')}</button><button data-act="doc-panel-close">${h('ux6h.cancel')}</button></div></div>`;
}
function dupsPanel(g){
  const ids = g.members.filter(m => !isLetter(m)).map(m => m.id), keep = [...L.keep], gone = RS.dropDuplicates(st(), ids, keep, C.files.receipt(), true);
  return `<div class="dpanel" data-panel="dups"><p class="note">${h('i7.dupsNote')}</p><div class="mlist">${ids.map(id => {
    const m = g.members.find(x => x.id === id), forced = !gone.includes(id) && !L.keep.has(id) && L.keep.size > 0;
    return `<label class="mi"><input type="checkbox" data-lkeep="${esc(id)}" ${L.keep.has(id) || forced ? 'checked' : ''} ${forced ? 'disabled' : ''}><span><span class="mw">${esc(m.name)}</span><span class="mx">${esc(`${typeOf(m)} · ${kb(m.size)}`)}${forced ? ` · ${esc(t('i7.dupsForced'))}` : ''}</span></span></label>`;
  }).join('')}</div>
    <div class="btns"><button class="del" data-act="doc-dups-do" ${gone.length ? '' : 'disabled'}>${h('i7.dupsDo', { n: gone.length })}</button><button data-act="doc-panel-close">${h('ux6h.cancel')}</button></div></div>`;
}

export function inspector(){
  const g = groupOf(L.sel);
  if (!g) return '';
  const d = g.members.find(m => m.id === L.member) ?? g.lead, rounds = st().rounds ?? [], resume = g.resume && RS.savedOf(st(), g.resume);
  const sf = DOC.safety(d, { lastFileSave: C.persist.fileState.last, checked: C.files.checked() });
  const url = previewUrl(d), pic = bytesUrl(d.thumb), un = d.taken?.lines?.length ?? 0, copies = g.members.filter(m => !isLetter(m)), archived = g.members.every(m => m.archived);
  const says = isLetter(d) ? X.mentions(st().record, d.text) : [];
  return `<section class="insp insp-doc" aria-label="${esc(d.name)}" data-did="${esc(g.id)}" data-member="${esc(d.id)}">
    <div class="ihero">${pic ? `<img class="dpic" src="${esc(pic)}" alt="">` : `<p class="dtext">${esc(String(d.text ?? '').split('\n').slice(0, 12).join('\n'))}</p>`}</div>
    ${url ? `<details class="dview"><summary>${h('i7.viewer')}</summary><iframe class="dprev" sandbox="" src="${esc(url)}" title="${esc(t('i7.preview'))}"></iframe></details>` : ''}
    <div class="ihcap"><span class="lbl">${h('ux6h.selected')}</span><h2 class="oi-name">${esc(d.name)}</h2><p class="small">${esc([company(d), dateOf(d), d.meta?.lang ? langName(d.meta.lang) : '', `${typeOf(d)} · ${kb(d.size)}`].filter(Boolean).join(' · '))}</p></div>
    ${resume ? `<p class="small" data-from="${esc(resume.id)}">${esc(t('i7.exportedFrom', { name: RS.resumeLabel(resume) }))} <button class="sm" data-act="sw-open" data-id="${esc(resume.id)}">${h('ux6e.openBtn')}</button></p>` : ''}
    ${g.members.length > 1 ? `<span class="lbl">${h('i7.formats')}</span><ul class="dformats">${g.members.map(m => `<li><button class="sm" data-act="doc-member" data-id="${esc(m.id)}" aria-pressed="${m.id === d.id}">${esc(`${isLetter(m) ? t('i7.letter') : typeOf(m)} · ${m.name} · ${kb(m.size)}`)}</button></li>`).join('')}</ul>` : ''}
    <div class="btns iacts">
      ${un ? `<button class="sm" data-act="doc-place" data-state="${L.panel === 'place' ? 'open' : ''}">${h('i7.place', { n: un })}</button>` : ''}
      ${String(d.text ?? '').trim() && !isLetter(d) && d.meta?.kind !== 'other' ? `<button class="sm primary" data-act="doc-rebuild" data-id="${esc(d.id)}">${h('i7.rebuild')}</button>` : ''}
      ${d.embedded ? `<button class="sm" data-act="doc-download" data-id="${esc(d.id)}">${h('i7.download')}</button>` : ''}
      <button class="sm" data-act="doc-archive" data-on="${archived ? '0' : '1'}">${h(archived ? 'i7.unarchive' : 'i7.archive')}</button>
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
      ${d.embedded ? `<button class="sm" data-act="doc-keeptext" data-id="${esc(d.id)}">${h('i7.keepText')}</button>` : ''}
      <button class="sm del" data-act="doc-remove">${h('i7.remove')}</button>
    </div>
    ${L.panel === 'dups' ? dupsPanel(g) : ''}${L.panel === 'remove' ? removePanel(d) : ''}
  </section>`;
}

// ---- Remove these…, in an archived round: its resumes and documents with ticks, none ticked ----
export function roundPanel(round){
  const all = st().resumes ?? [], rs = all.filter(r => r.round === round.id), gs = groups().filter(g => g.members.some(m => m.round === round.id));
  const row = (key, name, extra) => `<label class="mi"><input type="checkbox" data-rmk="${esc(key)}" ${L.rmTicks.has(key) ? 'checked' : ''}><span><span class="mw">${esc(name)}</span><span class="mx">${esc(extra)}</span></span></label>`;
  return `<div class="dpanel" data-panel="round" data-round="${esc(round.id)}"><p class="note">${h('i7.rmNote')}</p><div class="mlist">${rs.map(r => row(`r:${r.id}`, RS.resumeLabel(r), t('i7.aResume'))).join('')}${gs.map(g => row(`d:${g.id}`, g.lead.name, `${g.members.map(typeOf).join(', ')}`)).join('')}</div>
    <div class="btns"><button class="del" data-act="rm-round-do" data-id="${esc(round.id)}" ${L.rmTicks.size ? '' : 'disabled'}>${h('i7.rmDo', { n: L.rmTicks.size })}</button><button data-act="rm-round-close">${h('ux6h.cancel')}</button></div></div>`;
}

// ---- acts ----
async function checkpointed(label, fn){
  try { await C.persist.checkpoint(label); } catch (e){ C.toast(errText(e), 'bad'); return false; }      // nothing is removed without a checkpoint
  try { const ok = C.store.commit(d => { fn(d); }, label); C.store.gcAssets(); return ok; } catch (e){ C.toast(errText(e), 'bad'); return false; }
}
const members = () => groupOf(L.sel)?.members ?? [];
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
    case 'doc-remove': L.panel = 'remove'; L.ok = false; C.repaint(); return true;
    case 'doc-dups': L.panel = 'dups'; L.keep = new Set(members().filter(m => !isLetter(m)).slice(0, 1).map(m => m.id)); C.repaint(); return true;
    case 'doc-rebuild': C.resumes.rebuild(id); return true;
    case 'doc-download': {
      const d = members().find(m => m.id === id), data = d && bytesUrl(d.embedded);
      if (data) save(Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), c => c.charCodeAt(0)), d.name, d.type || 'application/octet-stream');
      return true;
    }
    case 'doc-archive': {
      const on = tg.dataset.on === '1';
      C.store.commit(d => { for (const m of members()) DOC.mark(d, 'documents', m.id, { archived: on }); }, t(on ? 'i7.undoArchive' : 'i7.undoUnarchive'));
      C.renderBody(); return true;
    }
    case 'doc-keeptext': {
      const d = members().find(m => m.id === id);
      if (d && C.store.commit(x => { DOC.keepTextOnly(x, id); }, t('i7.undoKeepText'))) C.store.gcAssets();
      C.renderBody(); return true;
    }
    case 'doc-place-do': {
      const d = members().find(m => m.id === L.member) ?? groupOf(L.sel).lead, lines = d.taken?.lines ?? [];
      const picks = lines.map((text, i) => ({ text, choice: L.picks.get(i) ?? '' }));
      await C.persist.checkpoint(t('i7.checkpointPlace', { name: d.name })).catch(() => null);
      C.store.commit(x => { X.placeLines(x, d.id, picks); }, t('i7.undoPlace', { name: d.name }));
      L.panel = null; L.picks.clear(); C.renderBody(); return true;
    }
    case 'doc-remove-do': {
      const d = members().find(m => m.id === L.member) ?? groupOf(L.sel).lead;
      if (!L.ok) return true;
      if (await checkpointed(t('i7.checkpointRemove', { name: d.name }), x => DOC.removeDocuments(x, [d.id]))){ L.sel = null; L.member = null; L.panel = null; C.toast(t('i7.removed', { name: d.name })); }
      C.renderBody(); return true;
    }
    case 'doc-dups-do': {
      const g = groupOf(L.sel); let gone = [];
      if (await checkpointed(t('i7.checkpointDups'), x => { gone = RS.dropDuplicates(x, g.members.filter(m => !isLetter(m)).map(m => m.id), [...L.keep], C.files.receipt()); })){ L.panel = null; L.member = null; C.toast(t('i7.dupsDone', { n: gone.length })); }
      C.renderBody(); return true;
    }
    case 'rm-round-open': L.rm = id; L.rmTicks.clear(); C.renderBody(); return true;
    case 'rm-round-close': L.rm = null; L.rmTicks.clear(); C.renderBody(); return true;
    case 'rm-round-do': {
      const rs = [...L.rmTicks].filter(k => k.startsWith('r:')).map(k => k.slice(2)), gs = [...L.rmTicks].filter(k => k.startsWith('d:')).flatMap(k => groupOf(k.slice(2))?.members.map(m => m.id) ?? []);
      if (!L.rmTicks.size) return true;
      if (await checkpointed(t('i7.checkpointRound'), x => { for (const r of rs) RS.deleteSaved(x, r); if (gs.length) DOC.removeDocuments(x, gs); })){ L.rm = null; L.rmTicks.clear(); C.toast(t('i7.rmDone', { n: rs.length + gs.length })); }
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
    else if (x.dataset?.lok !== undefined){ L.ok = x.checked; const b = body.querySelector('[data-act=doc-remove-do]'); if (b) b.disabled = !L.ok; }
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
  card, inspector, roundPanel, hits, matches, act, bind,
  sel: () => (groupOf(L.sel) ? L.sel : null), rm: () => L.rm,
  select: id => { L.sel = id; L.member = null; L.panel = null; },
  clear(){ const was = L.sel !== null; L.sel = null; L.member = null; L.panel = null; if (L.url){ URL.revokeObjectURL(L.url); L.url = null; } return was; },
};
