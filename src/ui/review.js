// The Review list (UX-6d): a dialog that turns the edits on this resume into versions, sends headings and names to the record, adds a line
// only here to the record as a claim, and decides the newer wording of the other resumes. The rows are read from the model every time
// the store changes; the dialog keeps only what was typed and what was done (to show the result and its Undo). Nothing here writes to the
// record except through src/model/review.js, inside one store.commit per choice, so each choice is one undo step.

import { t, h, errText } from '../i18n/index.js';
import { escapeHtml as esc } from '../export.js';
import { wordDiff, nextMajor, nextMinor, major } from '../model/record.js';
import { recordTitle, recordTerm } from '../model/resume.js';
import { acceptNewer, keepOlder, resumeLabel } from '../model/resumes.js';
import { reviewList, reviewCount, editRow, applyEdit, printersOf, majorsOf, needsSource, cleanSource, SOURCE_MAX, keepLabel, useEverywhere, everywhereOf } from '../model/review.js';

let C = null, el = null, box = null, live = null, S = null;
const P = { mode: new Map(), source: new Map() };      // the choices of the rows in the versions list (UX-6g): the same rows, drawn there
const st = () => C.store.state;
const model = () => C.work();
const jobName = id => (model().work ?? []).find(w => w.id === id)?.name ?? id;

export function initReview(ctx){
  C = ctx;
  el = document.createElement('dialog');
  el.id = 'review'; el.className = 'card rvdlg';
  el.setAttribute('aria-labelledby', 'rv-h'); el.setAttribute('aria-describedby', 'rv-help');
  // the rows are redrawn on every change; the live region stays, so a screen reader hears what a choice did
  box = Object.assign(document.createElement('div'), { className: 'rvwrap' });
  live = Object.assign(document.createElement('div'), { className: 'sr' });
  live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  el.append(box, live);
  document.body.append(el);
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('input', onInput);
  el.addEventListener('keydown', onKey);
  el.addEventListener('close', onClose);
  document.addEventListener('click', e => { const b = e.target.closest?.('.pend [data-rv]'); if (b) inlineClick(b); });
  document.addEventListener('change', e => { const sel = e.target.closest?.('.pend [data-rv-pick]'); if (sel) inlineChange(sel); });
  document.addEventListener('input', e => { if (e.target.closest?.('.pend [data-rv-src]')) withP(() => onInput(e)); });
  return api;
}

const diffHtml = (a, b) => wordDiff(a, b).map(d => (d.op === '=' ? esc(d.text) : d.op === '-' ? `<del>${esc(d.text)}</del>` : `<ins>${esc(d.text)}</ins>`)).join('');
const vOf = (row, vid) => row.versions?.find(v => v.id === vid) ?? null;

// ---- what a row would do ----
// The primary button makes the suggestion at once. A choice in the select is only pending (S.mode) until its own Apply button is used.
const suggestion = row => (row.local ? { do: 'claim' } : { do: row.as, from: row.near?.id });
const choiceOf = (row, id) => S.mode.get(id) ?? suggestion(row);      // approve all follows a pending choice
const needs = (model, row, c) => needsSource(model) && (c.do === 'claim' || c.do === 'major' || (c.do === 'minor' && !vOf(row, c.from)?.source));
const sourceOf = id => cleanSource(S.source.get(id));
const numberOf = (row, c) => (c.do === 'minor' ? nextMinor(model(), row.id, vOf(row, c.from)?.n, row.lang) : c.do === 'major' ? nextMajor(model(), row.id, row.lang) : vOf(row, c.vid)?.n);
const doText = (row, c) => (c.do === 'claim' ? t('ux6d.addClaim', { job: jobName(row.job) })
  : c.do === 'keep' ? t('ux6d.optKeep') : c.do === 'over' ? t('ux6d.optReplace', { v: numberOf(row, c) }) : t(S === P ? 'ux6g.saveAs' : 'ux6d.approve', { v: numberOf(row, c) }));      // in the versions list the primary says what it does to the list
function primary(row, id, c = suggestion(row)){
  const blocked = needs(model(), row, c) && !sourceOf(id);
  return { text: blocked ? t(row.local ? 'ux6d.addNeeds' : S === P ? 'ux6g.saveNeeds' : 'ux6d.approveNeeds') : doText(row, c), blocked, c };
}

// ---- rendering ----
const whereOf = (id, label = false) => C.fieldName(label ? { fact: id, label: true } : { fact: id });
const li = (kind, id, inner, cls = '') => { const tag = S === P ? 'div' : 'li'; return `<${tag} class="rvrow ${cls}" data-kind="${kind}" data-id="${esc(id)}">${inner}</${tag}>`; };
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

function sourceHtml(row, id, c, pend = null){
  if (!needs(model(), row, c) && !(pend && needs(model(), row, pend))) return '';
  return `<label class="rvsrc"><span>${h('ux6d.source')}</span>
    <input type="text" class="rv-src" data-rv-src maxlength="${SOURCE_MAX}" required aria-required="true" aria-describedby="rv-sh-${esc(id)}" value="${esc(S.source.get(id) ?? '')}" autocomplete="off">
    <small id="rv-sh-${esc(id)}" class="muted">${h('ux6d.sourceHint', { n: SOURCE_MAX })}</small></label>`;
}

function editHtml(id){
  const row = editRow(model(), st().cur, id), sug = suggestion(row), pend = row.local ? null : S.mode.get(id) ?? null, p = primary(row, id), pp = pend && primary(row, id, pend);
  const where = whereOf(id), main = btn('approve', p.text, 'primary', p.blocked ? 'aria-disabled="true"' : '');
  if (row.local){
    return li('e', id, `<p class="rvwhere">${esc(where)} <span class="rvtag">${h('ux6d.local')}</span></p>
      <p class="rvtext" lang="${esc(row.lang)}">${esc(row.text)}</p>
      <p class="rvwhy">${h('ux6d.localWhy')}</p>
      ${sourceHtml(row, id, sug)}
      <div class="rvbtns">${main}${btn('keep', t('ux6d.optKeep'))}</div>`);
  }
  const inline = S === P;      // in the versions list the row itself says where and shows the words
  const pct = Math.round(row.shared * 100);
  const why = !row.near ? t('ux6d.whyFirst') : row.as === 'minor' ? t('ux6d.whyMinor', { pct, v: row.near.n, next: row.n }) : t('ux6d.whyMajor', { pct, v: row.near.n });
  const cMajor = sug.do === 'minor' ? major(vOf(row, sug.from)?.n) : null;
  const opts = [
    ...majorsOf(model(), id, row.lang).filter(v => major(v.n) !== cMajor).map(v => [`minor:${v.id}`, t('ux6d.optSub', { v: major(v.n) })]),
    ...(sug.do === 'major' ? [] : [['major', t('ux6d.optMajor', { v: nextMajor(model(), id, row.lang) })]]),
    ...(row.near && !row.tiny ? [[`over:${row.near.id}`, t('ux6d.optReplace', { v: row.near.n })]] : []),
    ['keep', t('ux6d.optKeep')],
  ];
  const mine = pend && (pend.do === 'minor' ? `minor:${pend.from}` : pend.do === 'over' ? `over:${pend.vid}` : pend.do);
  // an update (or a replace) changes a version other resumes print: who is offered the change
  const target = pend?.do === 'over' ? vOf(row, pend.vid) : row.tiny && !pend ? row.near : null;
  const users = target ? printersOf(st(), target.id) : [];
  const names = users.slice(0, 3).map(resumeLabel).join(', ') + (users.length > 3 ? '…' : '');
  const note = target ? `<p class="rvnote muted">${esc(users.length ? t('ux6d.updateNote', { n: users.length, v: target.n, names }) : t('ux6d.updateNone', { v: target.n }))}${row.tiny && !pend ? ` ${h('ux6d.smallNote')}` : ''}</p>` : '';
  return li('e', id, `${inline ? '' : `<p class="rvwhere">${esc(where)}</p>
    <p class="rvtext" lang="${esc(row.lang)}">${row.near ? diffHtml(row.near.text, row.text) : esc(row.text)}</p>`}
    <p class="rvwhy">${esc(why)}</p>
    ${sourceHtml(row, id, sug, pend)}
    <div class="rvbtns">${main}${row.tiny ? btn('update', t('ux6d.update', { v: row.near.n })) : ''}
      <select data-rv-pick aria-label="${esc(t('ux6d.another'))}"><option value="">${h('ux6d.another')}</option>${opts.map(([v, tx]) => `<option value="${esc(v)}" ${v === mine ? 'selected' : ''}>${esc(tx)}</option>`).join('')}</select>
      ${pend ? btn('apply', t('ux6d.apply'), '', pp.blocked ? 'aria-disabled="true"' : '') : ''}</div>
    ${pend ? `<p class="rvwill small" id="rv-w-${esc(id)}">${esc(t('ux6d.willDo', { what: doText(row, pend) }))}</p>` : ''}
    ${note}`);
}

function labelHtml(l){
  const lang = st().cur.lang ?? 'en', id = l.key.slice(3);
  const record = l.key.startsWith('~h:') ? recordTitle(model(), id, lang) : recordTerm(model(), id, lang), ev = everywhereOf(st(), l.key);
  return li('l', l.key, `<p class="rvwhere">${esc(whereOf(l.key, true))}</p>
    <p class="rvtext" lang="${esc(lang)}">${diffHtml(record, l.text)}</p>
    <p class="rvwhy">${h('ux6d.labelWhy')}</p>
    <div class="rvbtns">${btn('keep', t('ux6d.optKeep'), 'primary')}${ev.locked ? '' : btn('every', t('ux6d.every'))}</div>
    ${ev.locked ? `<p class="rvnote muted">${esc(t('ux6d.everyLocked', { n: ev.locked }))}</p>` : ev.n ? `<p class="rvnote muted">${esc(t('ux6d.everyNote', { n: ev.n }))}</p>` : ''}`);
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
  const group = (kinds, key, help, extra = '') => {
    const rows = S.rows.filter(r => kinds.includes(r.kind)).map(r => rowHtml(r.kind, r.id, L)).filter(Boolean);
    return rows.length ? `<section aria-labelledby="rv-${key}"><h3 id="rv-${key}" class="lbl">${h(`ux6d.${key}`)}</h3>${extra}${help ? `<p class="small muted">${h(help)}</p>` : ''}<ul class="rvrows">${rows.join('')}</ul></section>` : '';
  };
  const body = group(['e', 'l'], 'g1') + group(['n'], 'g2', 'ux6d.g2help', L.newer.length > 1 ? `<p class="rvgall">${btn('newerAll', t('ux6d.newerAll', { n: L.newer.length }), 'sm')}</p>` : '');
  const undo = S.last?.batch && S.last.at === C.store.history.undo ? ` ${btn('undo', t('foot.undo'), 'sm')}` : '';
  const keep = focusKey();
  box.innerHTML = `<div class="rvhead"><h2 id="rv-h">${h('ux6d.title')}</h2><p id="rv-help" class="small muted">${h('ux6d.help')}</p></div>
    <div class="rvbody">${body || `<p class="muted">${h('ux6d.none')}</p>`}${L.locked ? `<p class="note">${h('ux6d.locked', { n: L.locked })}</p>` : ''}</div>
    <div class="rvfoot"><span id="rv-status">${esc(S.status)}${undo}</span>
      <span class="rvfoot-btns">${L.edits.length > 1 ? btn('all', t('ux6d.approveAll', { n: L.edits.length }), 'sm') : ''}${btn('cancel', t('btn.cancel'))}${btn('save', t('ux3b.saveFile'), 'primary')}</span></div>`;
  restoreFocus(keep);
}

// Focus survives a redraw: the same control of the same row, else the row's first control, else the first control
function focusKey(){
  if (S.focus){ const f = S.focus; S.focus = null; return f; }
  const a = document.activeElement;
  if (!a || !box.contains(a)) return null;
  const row = a.closest('.rvrow');
  return { id: row?.dataset.id ?? null, kind: row?.dataset.kind ?? null, rv: a.dataset.rv ?? (a.matches('[data-rv-src]') ? 'src' : a.matches('[data-rv-pick]') ? 'pick' : null) };
}
function restoreFocus(f){
  const sel = !f?.rv ? '' : f.rv === 'src' ? '[data-rv-src]' : f.rv === 'pick' ? '[data-rv-pick]' : `[data-rv="${f.rv}"]`;
  const row = f?.id != null ? [...box.querySelectorAll('.rvrow')].find(r => r.dataset.id === f.id && r.dataset.kind === f.kind) : null;
  (sel && row?.querySelector(sel) || row?.querySelector('button, input, select') || box.querySelector('.rvbody button, .rvbody input, .rvbody select') || box.querySelector('[data-rv=save]'))?.focus();
}

// ---- doing ----
// One choice = one commit = one undo step. A refusal is said in the status line and the edit is as it was (a commit that throws changes nothing).
function commit(label, fn){
  let out = null;
  try { if (!C.store.commit(d => { out = fn(d); }, label)) return null; }
  catch (e){ S.status = errText(e); say(S.status); render(); return null; }
  return out;
}
const say = text => { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); };
const finish = (keys, batch = false) => { say(S.status || keys.map(k => `${S.done.get(k).where}: ${S.done.get(k).text}`).join(' ')); S.last = { keys, batch, at: C.store.history.undo }; S.focus = keys.length === 1 && !batch ? { kind: keys[0][0], id: keys[0].slice(2), rv: 'undo' } : null; render(); };

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
function newerAll(){
  const items = reviewList(model(), st().cur).newer;      // a locked line is not in it
  if (!commit(t('undo.useNewer'), d => { for (const x of items) acceptNewer(d.cur, x.fact, d.record); return true; })) return;
  for (const x of items) S.done.set(`n:${x.fact}`, { where: whereOf(x.fact), text: t('ux6d.r.newer') });
  S.status = t('ux6d.newerAllDone', { n: items.length });
  finish(items.map(x => `n:${x.fact}`), true);
}
function keepEdit(id){
  const where = whereOf(id);
  if (!commit(t('ux6d.undoLabel', { what: where }), d => applyEdit(d.record, d.cur, id, { do: 'keep' }) && true)) return;
  S.done.set(`e:${id}`, { where, text: t('ux6d.r.keep') }); S.status = ''; S.mode.delete(id);
  finish([`e:${id}`]);
}
function labelRow(key, everywhere){
  const where = whereOf(key, true);
  if (everywhere && everywhereOf(st(), key).locked) return;      // another resume locks the heading: the row says so and offers no button
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
  if (rv === 'save') return saveNow();
  if (rv === 'all') return approveAll();
  if (rv === 'newerAll') return newerAll();
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
  if (rv === 'apply'){
    const row = editRow(model(), st().cur, id), p = primary(row, id, S.mode.get(id));
    if (p.blocked){ r.querySelector('[data-rv-src]')?.focus(); return; }
    return p.c.do === 'keep' ? keepEdit(id) : approveRow(id, p.c);
  }
  if (rv === 'update') return approveRow(id, { do: 'over', vid: editRow(model(), st().cur, id).near.id });
  if (rv === 'keep') return r.dataset.kind === 'l' ? labelRow(id, false) : keepEdit(id);
  if (rv === 'every') return labelRow(id, true);
  if (rv === 'newer') return newerRow(id, true);
  if (rv === 'mine') return newerRow(id, false);
}
// The select only chooses (keyboard browsing fires change on every option): the choice waits for its Apply button, and asks for a source first
function onChange(e){
  const sel = e.target.closest('[data-rv-pick]');
  if (!sel) return;
  const id = rowOf(e).dataset.id, [d, arg] = sel.value.split(':');
  if (!sel.value) S.mode.delete(id);
  else S.mode.set(id, d === 'minor' ? { do: 'minor', from: arg } : d === 'over' ? { do: 'over', vid: arg } : { do: d });
  S.focus = { kind: 'e', id, rv: 'pick' };
  render();
}
// Typing a source changes the button's words and state, not the row (the input keeps its caret)
function onInput(e){
  const inp = e.target.closest('[data-rv-src]');
  if (!inp) return;
  const r = rowOf(e), id = r.dataset.id;
  S.source.set(id, inp.value.slice(0, SOURCE_MAX));
  const row = editRow(model(), st().cur, id);
  for (const [rv, p] of [['approve', primary(row, id)], ['apply', S.mode.has(id) ? primary(row, id, S.mode.get(id)) : null]]){
    const b = p && r.querySelector(`[data-rv=${rv}]`);
    if (!b) continue;
    if (rv === 'approve') b.textContent = p.text;
    if (p.blocked) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
  }
}
// Keys stay in the dialog (the page's shortcuts must not act behind it). Ctrl+Z works as everywhere, except in a text box with its own undo.
function onKey(e){
  e.stopPropagation();
  if (e.key === 'Tab'){      // Tab turns round at the ends instead of leaving for the browser's own controls
    const all = [...box.querySelectorAll('button:not([disabled]), input, select')], at = all.indexOf(document.activeElement);
    if (all.length && (e.shiftKey ? at <= 0 : at === all.length - 1)){ e.preventDefault(); all[e.shiftKey ? all.length - 1 : 0].focus(); }
    return;
  }
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && !e.altKey && ['s', 'o', 'p'].includes(k)){      // the browser's own Save, Open and Print must not open over the dialog
    e.preventDefault();
    if (k === 's' && !e.isComposing && e.keyCode !== 229) saveNow();
    return;
  }
  if (mod && !e.altKey && ['z', 'y'].includes(k) && !e.target.closest('input')){
    e.preventDefault();
    if (k === 'y' || e.shiftKey) C.store.redo(); else C.store.undo();
  }
}
// The dialog stays open until the file is saved: a cancelled or failed save leaves the list as it was, with the toast
async function saveNow(){
  if (!S || S.saving) return;
  S.saving = true;
  const s = S, done = await C.saveToFile();
  s.saving = false;
  if (done && S === s) el.close();
}
function onClose(){
  const s = S; S = null; s?.unsub?.();
  (s?.opener?.isConnected ? s.opener : document.querySelector('#filestate'))?.focus?.();
}

// ---- the same rows in the versions list (UX-6g) ----
// An edit on this resume is a pending version there, with the choices the list offers (the primary button, Update, Another option + Apply,
// Keep on this resume only), the same labels and the same required source. The dialog's state S is put aside while they are drawn or used.
const withP = fn => { const was = S; S = P; try { return fn(); } finally { S = was; } };
const pendingHtml = id => withP(() => editHtml(id));
const canPend = id => !C.ui.snap && reviewList(model(), st().cur).edits.includes(id);
function inlineDo(id, c){
  const row = editRow(model(), st().cur, id);
  let out = null;
  try { if (!C.store.commit(d => { out = applyEdit(d.record, d.cur, id, { ...c, source: cleanSource(P.source.get(id)) }); }, t('ux6d.undoLabel', { what: whereOf(id) }))) return; }
  catch (e){ C.toast(errText(e), 'bad'); return; }
  P.mode.delete(id);
  C.toast(resultOf(row, c, out), '', true);
}
function inlineClick(b){
  const rv = b.dataset.rv, r = b.closest('.rvrow'), id = r?.dataset.id;
  if (!id) return;
  const row = editRow(model(), st().cur, id);
  if (rv === 'update') return inlineDo(id, { do: 'over', vid: row.near.id });
  if (rv === 'keep') return inlineDo(id, { do: 'keep' });
  const p = withP(() => primary(row, id, rv === 'apply' ? P.mode.get(id) : undefined));      // approve: the suggestion; apply: the pending choice
  if (p.blocked) return r.querySelector('[data-rv-src]')?.focus();
  inlineDo(id, p.c);
}
function inlineChange(sel){
  const id = sel.closest('.rvrow').dataset.id, [d, arg] = sel.value.split(':');
  if (!sel.value) P.mode.delete(id); else P.mode.set(id, d === 'minor' ? { do: 'minor', from: arg } : d === 'over' ? { do: 'over', vid: arg } : { do: d });
  C.renderBody();
  document.querySelector(`.pend .rvrow[data-id="${CSS.escape(id)}"] [data-rv-pick]`)?.focus();
}

// ---- opening ----
async function open(from = document.activeElement){
  if (el.open || C.ui.snap || !st().cur) return false;
  await C.leaveLine();      // the line being written is kept on this resume first, so it is in the list
  const L = reviewList(model(), st().cur);
  S = { opener: from, done: new Map(), mode: new Map(), source: new Map(), status: '', last: null, focus: null, saving: false,
    rows: [...L.edits.map(id => ({ kind: 'e', id })), ...L.labels.map(l => ({ kind: 'l', id: l.key })), ...L.newer.map(x => ({ kind: 'n', id: x.fact }))] };
  S.unsub = C.store.subscribe(() => render());
  render();
  el.showModal();
  restoreFocus(null);
  return true;
}

// Save to file: with an edit or a heading to review the list opens first (newer wording alone does not: the banner and the pre-flight
// Review button reach it); its Save to file button saves what is left.
async function saveFlow(from){
  await C.leaveLine();
  return pending() ? open(from) : C.saveToFile();
}

// edits and headings still only here (what an export leaves out of the text and JSON Resume file); newer wording is not one
const pending = () => { if (C.ui.snap || !st().cur) return 0; const L = reviewList(model(), st().cur); return L.edits.length + L.labels.length; };
const api = { open, saveFlow, pending, pendingHtml, canPend, count: () => (C.ui.snap || !st().cur ? 0 : reviewCount(model(), st().cur)), get isOpen(){ return !!el?.open; } };
