// The Review list (UX-6d): a dialog that turns the edits on this resume into versions, sends headings and names to the record, adds a line
// only here to the record as a claim, and decides the newer wording of the other resumes. The rows are read from the model every time
// the store changes; the dialog keeps only what was typed and what was done (to show the result and its Undo). Nothing here writes to the
// record except through src/model/review.js, inside one store.commit per choice, so each choice is one undo step.

import { t, h, errText } from '../i18n/index.js';
import { escapeHtml as esc } from '../export.js';
import { wordDiff, nextMajor, nextMinor, major } from '../model/record.js';
import { recordTitle, recordTerm } from '../model/resume.js';
import { acceptNewer, keepOlder, resumeLabel } from '../model/resumes.js';
import { reviewList, reviewCount, editRow, applyEdit, printersOf, majorsOf, needsSource, cleanSource, SOURCE_MAX, keepLabel, useEverywhere } from '../model/review.js';

let C = null, el = null, S = null;
const st = () => C.store.state;
const model = () => C.work();
const jobName = id => (model().work ?? []).find(w => w.id === id)?.name ?? id;

export function initReview(ctx){
  C = ctx;
  el = document.createElement('dialog');
  el.id = 'review'; el.className = 'card rvdlg';
  el.setAttribute('aria-labelledby', 'rv-h'); el.setAttribute('aria-describedby', 'rv-help');
  document.body.append(el);
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('input', onInput);
  el.addEventListener('keydown', onKey);
  el.addEventListener('close', onClose);
  return api;
}

const diffHtml = (a, b) => wordDiff(a, b).map(d => (d.op === '=' ? esc(d.text) : d.op === '-' ? `<del>${esc(d.text)}</del>` : `<ins>${esc(d.text)}</ins>`)).join('');
const vOf = (row, vid) => row.versions?.find(v => v.id === vid) ?? null;

// ---- what a row would do ----
// The choice a row's primary button makes: the one picked in the select, else the suggestion.
const choiceOf = (row, id) => S.mode.get(id) ?? (row.local ? { do: 'claim' } : { do: row.as, from: row.near?.id });
const needs = (model, row, c) => needsSource(model) && (c.do === 'claim' || c.do === 'major' || (c.do === 'minor' && !vOf(row, c.from)?.source));
const sourceOf = id => cleanSource(S.source.get(id));
const numberOf = (row, c) => (c.do === 'minor' ? nextMinor(model(), row.id, vOf(row, c.from)?.n, row.lang) : c.do === 'major' ? nextMajor(model(), row.id, row.lang) : vOf(row, c.vid)?.n);
function primary(row, id){
  const c = choiceOf(row, id), blocked = needs(model(), row, c) && !sourceOf(id);
  const text = blocked ? t(row.local ? 'ux6d.addNeeds' : 'ux6d.approveNeeds')
    : c.do === 'claim' ? t('ux6d.addClaim', { job: jobName(row.job) })
    : c.do === 'keep' ? t('ux6d.optKeep') : c.do === 'over' ? t('ux6d.optReplace', { v: numberOf(row, c) }) : t('ux6d.approve', { v: numberOf(row, c) });
  return { text, blocked, c };
}

// ---- rendering ----
const whereOf = (id, label = false) => C.fieldName(label ? { fact: id, label: true } : { fact: id });
const li = (kind, id, inner, cls = '') => `<li class="rvrow ${cls}" data-kind="${kind}" data-id="${esc(id)}">${inner}</li>`;
const btn = (rv, text, cls = '', extra = '') => `<button class="${cls}" data-rv="${rv}" ${extra}>${esc(text)}</button>`;

function rowHtml(kind, id, L){
  if (kind === 'e' && L.edits.includes(id)) return editHtml(id);
  if (kind === 'l' && L.labels.some(l => l.key === id)) return labelHtml(L.labels.find(l => l.key === id));
  if (kind === 'n' && L.newer.some(x => x.fact === id)) return newerHtml(L.newer.find(x => x.fact === id));
  const done = S.done.get(`${kind}:${id}`);
  return done ? doneHtml(kind, id, done) : '';
}

function doneHtml(kind, id, done){
  const undo = S.last && !S.last.batch && S.last.keys.includes(`${kind}:${id}`) && S.last.at === C.store.history.undo;
  return li(kind, id, `<p class="rvwhere">${esc(done.where)}</p>
    <p class="rvres"><span>${esc(done.text)}</span> ${undo ? btn('undo', t('foot.undo'), 'sm', `aria-label="${esc(`${t('foot.undo')}: ${done.where}`)}"`) : ''}</p>`, 'done');
}

function sourceHtml(row, id, c){
  if (!needs(model(), row, c)) return '';
  return `<label class="rvsrc"><span>${h('ux6d.source')}</span>
    <input type="text" class="rv-src" data-rv-src maxlength="${SOURCE_MAX}" required aria-required="true" aria-describedby="rv-sh-${esc(id)}" value="${esc(S.source.get(id) ?? '')}" autocomplete="off">
    <small id="rv-sh-${esc(id)}" class="muted">${h('ux6d.sourceHint', { n: SOURCE_MAX })}</small></label>`;
}

function editHtml(id){
  const row = editRow(model(), st().cur, id), c = choiceOf(row, id), p = primary(row, id);
  const where = whereOf(id), main = btn('approve', p.text, 'primary', p.blocked ? 'aria-disabled="true"' : '');
  if (row.local){
    return li('e', id, `<p class="rvwhere">${esc(where)} <span class="rvtag">${h('ux6d.local')}</span></p>
      <p class="rvtext" lang="${esc(row.lang)}">${esc(row.text)}</p>
      <p class="rvwhy">${h('ux6d.localWhy')}</p>
      ${sourceHtml(row, id, c)}
      <div class="rvbtns">${main}${btn('keep', t('ux6d.optKeep'))}</div>`);
  }
  const pct = Math.round(row.shared * 100);
  const why = !row.near ? t('ux6d.whyFirst') : row.as === 'minor' ? t('ux6d.whyMinor', { pct, v: row.near.n, next: row.n }) : t('ux6d.whyMajor', { pct, v: row.near.n });
  const cMajor = c.do === 'minor' ? major(vOf(row, c.from)?.n) : null;
  const opts = [
    ...majorsOf(model(), id, row.lang).filter(v => major(v.n) !== cMajor).map(v => [`minor:${v.id}`, t('ux6d.optSub', { v: major(v.n) })]),
    ...(c.do === 'major' ? [] : [['major', t('ux6d.optMajor', { v: nextMajor(model(), id, row.lang) })]]),
    ...(row.near && !row.tiny && c.do !== 'over' ? [[`over:${row.near.id}`, t('ux6d.optReplace', { v: row.near.n })]] : []),
    ...(c.do === 'keep' ? [] : [['keep', t('ux6d.optKeep')]]),
  ];
  const users = row.tiny ? printersOf(st(), row.near.id) : [];
  const names = users.slice(0, 3).map(resumeLabel).join(', ') + (users.length > 3 ? '…' : '');
  const note = row.tiny ? `<p class="rvnote muted">${users.length ? t('ux6d.updateNote', { n: users.length, v: row.near.n, names }) : t('ux6d.updateNone', { v: row.near.n })}</p>` : '';
  return li('e', id, `<p class="rvwhere">${esc(where)}</p>
    <p class="rvtext" lang="${esc(row.lang)}">${row.near ? diffHtml(row.near.text, row.text) : esc(row.text)}</p>
    <p class="rvwhy">${esc(why)}</p>
    ${sourceHtml(row, id, c)}
    <div class="rvbtns">${main}${row.tiny ? btn('update', t('ux6d.update', { v: row.near.n })) : ''}
      <select data-rv-pick aria-label="${esc(t('ux6d.another'))}"><option value="">${h('ux6d.another')}</option>${opts.map(([v, tx]) => `<option value="${esc(v)}">${esc(tx)}</option>`).join('')}</select></div>
    ${note}`);
}

function labelHtml(l){
  const lang = st().cur.lang ?? 'en', id = l.key.slice(3);
  const record = l.key.startsWith('~h:') ? recordTitle(model(), id, lang) : recordTerm(model(), id, lang);
  return li('l', l.key, `<p class="rvwhere">${esc(whereOf(l.key, true))}</p>
    <p class="rvtext" lang="${esc(lang)}">${diffHtml(record, l.text)}</p>
    <p class="rvwhy">${h('ux6d.labelWhy')}</p>
    <div class="rvbtns">${btn('keep', t('ux6d.optKeep'), 'primary')}${btn('every', t('ux6d.every'))}</div>`);
}

function newerHtml(x){
  return li('n', x.fact, `<p class="rvwhere">${esc(whereOf(x.fact))}</p>
    <p class="rvtext">${diffHtml(x.frozen, x.live)}</p>
    <p class="rvwhy">${h('ux6d.newerWhy')}</p>
    <div class="rvbtns">${btn('newer', t('newer.accept'), 'primary')}${btn('mine', t('ux6d.keepMine'))}</div>`);
}

function render(){
  if (!S) return;
  const L = reviewList(model(), st().cur);
  // rows keep the order they had when the list opened; one that is no longer pending shows its result
  const group = (kinds, key, help) => {
    const rows = S.rows.filter(r => kinds.includes(r.kind)).map(r => rowHtml(r.kind, r.id, L)).filter(Boolean);
    return rows.length ? `<section aria-labelledby="rv-${key}"><h3 id="rv-${key}" class="lbl">${h(`ux6d.${key}`)}</h3>${help ? `<p class="small muted">${h(help)}</p>` : ''}<ul class="rvrows">${rows.join('')}</ul></section>` : '';
  };
  const body = group(['e', 'l'], 'g1') + group(['n'], 'g2', 'ux6d.g2help');
  const undo = S.last?.batch && S.last.at === C.store.history.undo ? ` ${btn('undo', t('foot.undo'), 'sm')}` : '';
  const keep = focusKey();
  el.innerHTML = `<div class="rvhead"><h2 id="rv-h">${h('ux6d.title')}</h2><p id="rv-help" class="small muted">${h('ux6d.help')}</p></div>
    <div class="rvbody">${body || `<p class="muted">${h('ux6d.none')}</p>`}${L.locked ? `<p class="note">${h('ux6d.locked', { n: L.locked })}</p>` : ''}</div>
    <div class="rvfoot"><span id="rv-status" role="status" aria-live="polite">${esc(S.status)}${undo}</span>
      <span class="rvfoot-btns">${L.edits.length > 1 ? btn('all', t('ux6d.approveAll', { n: L.edits.length }), 'sm') : ''}${btn('cancel', t('btn.cancel'))}${btn('save', t('ux3b.saveFile'), 'primary')}</span></div>`;
  restoreFocus(keep);
}

// Focus survives a redraw: the same control of the same row, else the row's first control, else the first control
function focusKey(){
  if (S.focus){ const f = S.focus; S.focus = null; return f; }
  const a = document.activeElement;
  if (!a || !el.contains(a)) return null;
  const row = a.closest('.rvrow');
  return { id: row?.dataset.id ?? null, kind: row?.dataset.kind ?? null, rv: a.dataset.rv ?? (a.matches('[data-rv-src]') ? 'src' : a.matches('[data-rv-pick]') ? 'pick' : null) };
}
function restoreFocus(f){
  const sel = !f?.rv ? '' : f.rv === 'src' ? '[data-rv-src]' : f.rv === 'pick' ? '[data-rv-pick]' : `[data-rv="${f.rv}"]`;
  const row = f?.id != null ? [...el.querySelectorAll('.rvrow')].find(r => r.dataset.id === f.id && r.dataset.kind === f.kind) : null;
  (sel && row?.querySelector(sel) || row?.querySelector('button, input, select') || el.querySelector('.rvbody button, .rvbody input, .rvbody select') || el.querySelector('[data-rv=save]'))?.focus();
}

// ---- doing ----
// One choice = one commit = one undo step. A refusal is said in the status line and the edit is as it was (a commit that throws changes nothing).
function commit(label, fn){
  let out = null;
  try { if (!C.store.commit(d => { out = fn(d); }, label)) return null; }
  catch (e){ S.status = errText(e); render(); return null; }
  return out;
}
const finish = (keys, batch = false) => { S.last = { keys, batch, at: C.store.history.undo }; S.focus = keys.length === 1 && !batch ? { kind: keys[0][0], id: keys[0].slice(2), rv: 'undo' } : null; render(); };

const resultOf = (row, c, out) => (c.do === 'keep' ? t('ux6d.r.keep') : c.do === 'over' ? t('ux6d.r.over', { v: out.n }) : c.do === 'claim' ? t('ux6d.r.claim', { job: jobName(row.job) }) : t('ux6d.r.sub', { v: out.n }));
function approveRow(id, c){
  const where = whereOf(id), row = editRow(model(), st().cur, id), full = { ...c, source: sourceOf(id) };
  const out = commit(t('ux6d.undoLabel', { what: where }), d => applyEdit(d.record, d.cur, id, full));
  if (!out) return;
  S.done.set(`e:${id}`, { where, text: resultOf(row, c, out) }); S.status = ''; S.mode.delete(id);
  finish([`e:${id}`]);
}
function approveAll(){
  const ids = reviewList(model(), st().cur).edits, made = [], left = [];
  const out = commit(t('ux6d.undoAll'), d => {
    for (const id of ids){
      const row = editRow(d.record, d.cur, id), c = choiceOf(row, id);
      if (needs(d.record, row, c) && !sourceOf(id)){ left.push(id); continue; }
      try { made.push([id, row, c, applyEdit(d.record, d.cur, id, { ...c, source: sourceOf(id) })]); } catch { left.push(id); }
    }
    return true;
  });
  if (!out) return;
  for (const [id, row, c, o] of made){ S.done.set(`e:${id}`, { where: whereOf(id), text: resultOf(row, c, o) }); S.mode.delete(id); }
  S.status = `${t('ux6d.allDone', { n: made.length })}${left.length ? ` ${t('ux6d.allLeft', { n: left.length })}` : ''}`;
  finish(made.map(m => `e:${m[0]}`), true);
}
function keepEdit(id){
  const where = whereOf(id);
  if (!commit(t('ux6d.undoLabel', { what: where }), d => applyEdit(d.record, d.cur, id, { do: 'keep' }) && true)) return;
  S.done.set(`e:${id}`, { where, text: t('ux6d.r.keep') }); S.status = '';
  finish([`e:${id}`]);
}
function labelRow(key, everywhere){
  const where = whereOf(key, true);
  if (!commit(t('ux6d.undoLabel', { what: where }), d => (everywhere ? useEverywhere(d.record, d.cur, key) : (keepLabel(d.record, d.cur, key), true)))) return;
  S.done.set(`l:${key}`, { where, text: t(everywhere ? 'ux6d.r.every' : 'ux6d.r.keep') }); S.status = '';
  finish([`l:${key}`]);
}
function newerRow(id, accept){
  const where = whereOf(id);
  if (!commit(t(accept ? 'undo.useNewer' : 'undo.keepSaved'), d => (accept ? acceptNewer(d.cur, id, d.record) : keepOlder(d.cur, id), true))) return;
  S.done.set(`n:${id}`, { where, text: t(accept ? 'ux6d.r.newer' : 'ux6d.r.mine') }); S.status = '';
  finish([`n:${id}`]);
}

// ---- events ----
const rowOf = e => e.target.closest('.rvrow');
function onClick(e){
  const b = e.target.closest('[data-rv]');
  if (!b) return;
  const rv = b.dataset.rv, r = b.closest('.rvrow'), id = r?.dataset.id;
  if (rv === 'cancel') return el.close();
  if (rv === 'save'){ S.then = 'save'; return el.close(); }
  if (rv === 'all') return approveAll();
  if (rv === 'undo'){
    S.done = new Map([...S.done].filter(([k]) => !S.last?.keys.includes(k)));
    S.status = ''; S.last = null; S.focus = r ? { kind: r.dataset.kind, id, rv: 'approve' } : null;
    C.store.undo();
    return render();
  }
  if (rv === 'approve'){
    const p = primary(editRow(model(), st().cur, id), id);
    if (p.blocked){ r.querySelector('[data-rv-src]')?.focus(); return; }
    return p.c.do === 'keep' ? keepEdit(id) : approveRow(id, p.c);
  }
  if (rv === 'update') return approveRow(id, { do: 'over', vid: editRow(model(), st().cur, id).near.id });
  if (rv === 'keep') return r.dataset.kind === 'l' ? labelRow(id, false) : keepEdit(id);
  if (rv === 'every') return labelRow(id, true);
  if (rv === 'newer') return newerRow(id, true);
  if (rv === 'mine') return newerRow(id, false);
}
// The select chooses: a choice that needs a source it does not have asks for it first, else it applies at once
function onChange(e){
  const sel = e.target.closest('[data-rv-pick]');
  if (!sel || !sel.value) return;
  const id = rowOf(e).dataset.id, [d, arg] = sel.value.split(':');
  const row = editRow(model(), st().cur, id), c = d === 'minor' ? { do: 'minor', from: arg } : d === 'over' ? { do: 'over', vid: arg } : { do: d };
  if (c.do === 'keep') return keepEdit(id);
  if (needs(model(), row, c) && !sourceOf(id)){ S.mode.set(id, c); S.focus = { kind: 'e', id, rv: 'src' }; return render(); }
  approveRow(id, c);
}
// Typing a source changes the button's words and state, not the row (the input keeps its caret)
function onInput(e){
  const inp = e.target.closest('[data-rv-src]');
  if (!inp) return;
  const r = rowOf(e), id = r.dataset.id;
  S.source.set(id, inp.value.slice(0, SOURCE_MAX));
  const p = primary(editRow(model(), st().cur, id), id), b = r.querySelector('[data-rv=approve]');
  b.textContent = p.text;
  if (p.blocked) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
}
// Keys stay in the dialog (the page's shortcuts must not act behind it). Ctrl+Z works as everywhere, except in a text box with its own undo.
function onKey(e){
  e.stopPropagation();
  if (e.key === 'Tab'){      // Tab turns round at the ends instead of leaving for the browser's own controls
    const all = [...el.querySelectorAll('button:not([disabled]), input, select')], at = all.indexOf(document.activeElement);
    if (all.length && (e.shiftKey ? at <= 0 : at === all.length - 1)){ e.preventDefault(); all[e.shiftKey ? all.length - 1 : 0].focus(); }
    return;
  }
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && !e.altKey && ['z', 'y'].includes(k) && !e.target.closest('input')){
    e.preventDefault();
    if (k === 'y' || e.shiftKey) C.store.redo(); else C.store.undo();
  }
}
function onClose(){
  const s = S; S = null; s?.unsub?.();
  if (s?.then === 'save') return void C.saveToFile();
  (s?.opener?.isConnected ? s.opener : document.querySelector('#filestate'))?.focus?.();
}

// ---- opening ----
async function open(from = document.activeElement){
  if (el.open || C.ui.snap || !st().cur) return false;
  await C.leaveLine();      // the line being written is kept on this resume first, so it is in the list
  const L = reviewList(model(), st().cur);
  S = { opener: from, done: new Map(), mode: new Map(), source: new Map(), status: '', last: null, focus: null, then: null,
    rows: [...L.edits.map(id => ({ kind: 'e', id })), ...L.labels.map(l => ({ kind: 'l', id: l.key })), ...L.newer.map(x => ({ kind: 'n', id: x.fact }))] };
  S.unsub = C.store.subscribe(() => render());
  render();
  el.showModal();
  restoreFocus(null);
  return true;
}

// Save to file: with something to review the list opens first; its Save to file button saves what is left.
async function saveFlow(from){
  await C.leaveLine();
  return !st().cur || C.ui.snap || !reviewCount(model(), st().cur) ? C.saveToFile() : open(from);
}

// edits and headings still only here (what an export leaves out of the text and JSON Resume file); newer wording is not one
const pending = () => { if (C.ui.snap || !st().cur) return 0; const L = reviewList(model(), st().cur); return L.edits.length + L.labels.length; };
const api = { open, saveFlow, pending, count: () => (C.ui.snap || !st().cur ? 0 : reviewCount(model(), st().cur)), get isOpen(){ return !!el?.open; } };
