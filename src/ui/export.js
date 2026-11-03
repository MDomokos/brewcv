// The Export place: the pages large on the left, the final step on the right (pre-flight checks, the medium, the downloads, Mark as sent,
// the backup). The open resume alone is the editor's own page; any other set of saved resumes is drawn here, each as it prints, and their
// files come as one ZIP. The string work is in src/export.js; this module fetches, downloads and prints.

import { pageSize } from './layout.js';
import * as X from '../export.js';
import { renderPages } from '../render.js';
import { MEDIA, onPaper } from '../model/design.js';
import { missingList } from '../model/lang.js';
import { factOf } from '../model/record.js';
import * as RS from '../model/resumes.js';
import { t, h, errText, docChrome, loadCatalogue, uiLang } from '../i18n/index.js';
import { zip, uniqueNames } from '../zip.js';
import { dayFieldHtml, initMonthPick } from './monthpick.js';
import { G } from './layout.js';
import { fitFilled } from './dock.js';
import { icon as drawn, withArrows } from './icons.js';
import { exportFx } from './exportfx.js';
import { drink } from './drink.js';
import { SAVE_FILE_NAME } from '../store/persist.js';
import { libraryName, ensureDirs } from '../store/space.js';

let C = null;
export function initExport(ctx){ C = ctx; initMonthPick({ name: 'export', lang: () => uiLang(), change: input => { if (C.ui.xp && input.id === 'xp-date') C.ui.xp.date = input.value; } }); return api; }

const esc = X.escapeHtml;
const mediumOf = r => (MEDIA.includes(r?.exportMedium) ? r.exportMedium : 'screen');
const st = () => C.store.state;

async function text(url){ const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.text(); }
async function dataUrl(url){
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const b = await r.blob();
  return new Promise((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = bad; fr.readAsDataURL(b); });
}

// The resume as one self-contained HTML document (a string).
export async function buildHtml(recipe = C.cur(), laid = C.ui.laid){
  const r = laid && !recipe.pages ? { ...recipe, pages: laid.pages } : recipe;
  const tpl = await text(`templates/${r.format}.html`);
  const hrefs = [...tpl.matchAll(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*href=["']([^"']+)["']/gi)].map(m => m[1]);
  for (const o of r.overlays ?? []) hrefs.push(`../themes/${o}.css`);
  const css = [];
  const fonts = new Map();
  const embed = async (t, path) => {
    const map = new Map();
    for (const u of X.cssUrls(t, path)){
      if (!fonts.has(u.url)) fonts.set(u.url, await dataUrl(u.url).catch(() => null));
      if (fonts.get(u.url)) map.set(u.match, fonts.get(u.url));
    }
    return X.replaceUrls(t, map);
  };
  for (const href of hrefs){
    const path = X.normalisePath(`templates/${href}`);
    css.push({ href, text: await embed(await text(path), path) });
  }
  // the look settings' fonts (src/model/design.js) are named relative to the page template, like the stylesheets' own
  const medium = mediumOf(r);
  const extra = C.extraCss?.(r, medium) ?? '';
  if (extra) css.push({ href: 'tokens', text: await embed(extra, `templates/${r.format}.html`) });
  await loadCatalogue(r.lang ?? 'en');
  const pages = renderPages(C.work(), r, document, { fallback: true, chrome: docChrome(r.lang ?? 'en') }).pages;
  const documentHtml = X.cleanMarkup(pages.map(p => p.outerHTML).join('\n'));
  const name = st().record.basics?.name ?? 'Resume';
  return X.assembleHtml({ templateHtml: tpl, css, documentHtml, title: `${name}${recipe.company ? ` — ${recipe.company}` : ''}`,
    lang: recipe.lang ?? 'en', htmlClass: onPaper(medium) ? 'medium-print' : '' });
}

// The desktop app (Tauri): one Save dialog, then a hidden window prints the page straight to that file (desktop/print.js).
// Returns true when it handled the export; false means "use the print dialog instead" (not macOS or Linux, or the export failed to start).
// With a folder linked the Save dialog opens in the document's search and company folder (Documents/<search>/<company>/) under the standard name: the date, company and role, and the language when it is not English.
// The folders are made for the dialog; `undo` takes the ones this call made away again when nothing was saved in them.
async function libraryPdfPath(r){
  const root = C.persist.folder?.root;
  if (typeof root?.handle !== 'string') return {};      // only the desktop app's folder is a path
  const date = new Date().toISOString().slice(0, 10), rel = await C.space.dirFor(date, r.company), base = root.handle.replace(/[\\/]+$/, '');
  let undo;
  try { undo = await ensureDirs(window.__TAURI__.fs, base, rel); } catch { return {}; }
  const dir = `${base}/${rel}`;
  return { undo, dir, file: `${dir}/${libraryName({ date, company: r.company, role: r.role, lang: r.lang, stem: st().record.basics?.name || 'Resume', ext: '.pdf' })}` };
}
async function savePdfFile(html, r){
  const T = window.__TAURI__, lib = await libraryPdfPath(r);
  const path = await T.dialog.save({ defaultPath: lib.file ?? X.exportName(r, st().record, 'pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!path || !path.startsWith(`${lib.dir}/`)) await lib.undo?.();      // cancelled, or saved somewhere else: the folders made for the dialog go again
  if (!path) return true;
  const w = new T.webviewWindow.WebviewWindow('print' + Date.now(), { url: 'desktop/print.html', visible: false, width: 900, height: 1100 });
  await new Promise((ok, no) => { w.once('tauri://created', ok); w.once('tauri://error', e => no(new Error(String(e.payload)))); });
  const done = new Promise(ok => T.event.once('pdf-done', e => ok(e.payload)));
  await new Promise(ok => setTimeout(ok, 600)); // the page's listener is set up a moment after the window exists
  const { w: pw, h: ph } = pageSize(r.format);   // the page box in CSS px; the paper is the same size in points, so nothing spills onto a blank page
  await w.emit('html', { html, path, width: pw * 0.75, height: ph * 0.75 });
  const res = await done;
  if (res.unsupported) return false;
  C.toast(res.ok ? t('toast.pdfSaved', { path }) : t('toast.pdfFailed', { msg: res.msg }), res.ok ? '' : 'bad');
  return true;
}

// Print from a hidden frame. @page sets the paper size; the user saves as PDF from the dialog.
async function printPdf(r = C.cur(), laid = C.ui.laid){
  const html = await buildHtml(r, laid);
  if (window.__TAURI__){
    try { if (await savePdfFile(html, r)) return; } catch (e){ console.error(e); }
    C.toast(t('toast.printDialog'));
  }
  const fr = document.createElement('iframe');
  fr.className = 'print-frame';
  fr.setAttribute('aria-hidden', 'true');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.append(fr);
  await new Promise(ok => { fr.onload = ok; fr.srcdoc = html; });
  try { await fr.contentDocument.fonts?.ready; } catch {}
  fr.contentDocument.title = X.exportName(r, st().record, 'pdf').replace(/\.pdf$/, '');
  fr.contentWindow.focus();
  fr.contentWindow.print();
  setTimeout(() => fr.remove(), 60_000);
}

function checks(){
  const s = st(), r = C.cur();
  return X.preflight({ model: C.work(), recipe: r, fills: C.ui.fills ?? [], missing: missingList(C.work(), r, RS.groupOpts(st(), r)).length,
    newer: C.ui.snap ? 0 : RS.newerOf(C.work(), r).length, vault: s.record.requireSource !== false });
}

// ---- the place: C.ui.xp = { ids, from, medium, date, sending } while it is open (shell.js setView clears it on the way out) ----
const xp = () => C.ui.xp;
export const inPlace = () => !!C?.ui.xp && (C.ui.view === 'export' || C.ui.view === 'sent');
// what the editor's page is drawn for: its medium in the place, a screen everywhere else
export const shownMedium = r => (inPlace() ? mediumOf(r) : 'screen');
// the open resume alone is the editor's own page; any other set is drawn here
const listed = () => { const x = xp(); return !!x && !(x.ids.length === 1 && x.ids[0] === st().openId); };

// The way in: `ids` are saved resumes (one or several; the open one by default), `from` the view to come back to (null is the editor).
export function openExport(ids = [st().openId], from = C.ui.view){
  const known = [...new Set(ids)].filter(id => RS.savedOf(st(), id));
  C.ui.xp = { ids: known.length ? known : [st().openId], from: inPlace() ? xp().from : from, medium: null, date: RS.today(), sending: false };
  C.setView('export');
  document.querySelector('#body [data-act=xp-back]')?.focus({ preventScroll: true });
}
// ← Back and Esc: the place it was opened from, as it was (the Sent form first goes back to Export)
function back(){ C.setView(C.ui.view === 'sent' ? 'export' : xp()?.from ?? null); }
const backKey = v => (v === 'resumes' || v === 'compare' ? 'xp.backLibrary' : v === 'record' ? 'xp.backCareer' : 'xp.backEditor');

// the listed resumes, each as it prints (its sent wording held) in the medium chosen here, else its own
function items(){
  const m = xp()?.medium;
  return (xp()?.ids ?? []).map(id => {
    const r = C.held(id);
    if (!r) return null;
    if (m === 'screen') delete r.exportMedium; else if (m) r.exportMedium = m;
    return { id, r };
  }).filter(Boolean);
}
// a listed resume's pages and layout (thumbs.js), once drawn; null until then (the panel and the row are drawn again when it arrives)
const laidBy = new WeakMap();      // the working model → Map(key → entry)
const keyOf = it => `${mediumOf(it.r)}|${JSON.stringify(it.r)}`;
function laidOf(it){
  const work = C.work(), m = laidBy.get(work) ?? laidBy.set(work, new Map()).get(work), k = keyOf(it);
  if (!m.has(k)){
    m.set(k, null);
    C.thumb(it.r, mediumOf(it.r)).then(e => { m.set(k, e); if (inPlace() && C.ui.view === 'export'){ C.renderBody(); drawPages(); } });
  }
  return m.get(k);
}
const checksOf = (r, fills) => X.preflight({ model: C.work(), recipe: r, fills, missing: missingList(C.work(), r, RS.groupOpts(st(), r)).length,
  newer: RS.newerOf(C.work(), r).length, vault: st().record.requireSource !== false });

function exportView(){
  const many = listed(), its = many ? items() : [], n = many ? its.length : 1;
  const r = C.cur(), list = many ? [] : checks();
  // one filled button on the screen: Fit when it would change something, else PDF
  const fitFirst = !many && fitFilled(C.ui.fills, r?.pageLimit);
  const file = C.fileLine();
  const media = many ? [...new Set(its.map(it => mediumOf(it.r)))] : [mediumOf(r)];
  const medium = media.length === 1 ? media[0] : null;      // several resumes made for different media: no button is pressed until one is chosen
  const look = many ? false : list.some(c => c.level !== 'ok');
  const name = x => `<span class="xpco">${esc(x.company || RS.resumeLabel(x) || st().record.basics?.name || '')}</span>${x.company && x.role ? `<span class="xprole">${esc(x.role)}</span>` : ''}`;
  // the status row is the first item of the pre-flight list (the page result); a problem is a row under it, with Review or Fix at its end
  const row = (c, i) => `<li class="${c.level}"><span class="exst hic" aria-hidden="true">${i ? '' : drawn_(look ? 'warn' : 'check')}</span><span class="ct">${esc(c.text)}${['unexported', 'newer'].includes(c.key) && C.reviewCount?.() ? ` <button class="sm press" data-tier="secondary" data-act="review-open">${h('newer.review')}</button>` : c.fix ? ` <button class="sm press" data-tier="secondary" data-act="ex-fix" data-i="${i}">${h('ux6f.exFix')}</button>` : ''}</span></li>`;
  // several: one line for each resume, its page result or its problems
  const line = it => {
    const e = laidOf(it), cs = e ? checksOf(it.r, e.fills ?? []) : null, bad = cs?.filter(c => c.level !== 'ok') ?? [];
    return `<li class="${cs ? (bad.length ? bad.some(c => c.level === 'bad') ? 'bad' : 'warn' : 'ok') : 'wait'}" data-id="${esc(it.id)}"><span class="exst hic" aria-hidden="true">${cs ? drawn_(bad.length ? 'warn' : 'check') : ''}</span><span class="ct"><b>${esc(it.r.company || RS.resumeLabel(it.r))}</b>${it.r.company && it.r.role ? ` — ${esc(it.r.role)}` : ''} · <span class="muted">${esc(cs ? (bad.length ? bad : cs).map(c => c.text).join(' · ') : t('body.loading'))}</span></span></li>`;
  };
  const files = n > 1 ? ` · ${esc(t('xp.files', { n }))}` : '';
  const card = (act, title, note, primary = false) => `<button class="${primary ? 'primary' : ''}" data-act="${act}"><b>${title}${files}</b><small>${h(note)}</small></button>`;
  const x = xp();
  const sent = many
    ? (x?.sending ? `<div class="xpsend" data-form="xp-send"><label class="field"><span class="lbl inline">${h('ux1.kind')}</span><select id="xp-kind"><option value="company">${h('ux1.kindCompany')}</option><option value="outreach">${h('ux1.kindOutreach')}</option></select></label>
        ${dayFieldHtml('xp-date', h('ux1.date'), x.date, { lang: uiLang(), host: 'export' })}
        <div class="btns"><button class="press primary" data-tier="primary" data-act="xp-send-do">${h('ux3b.markSentDo')}</button><button class="ghost" data-act="xp-send-cancel">${h('btn.cancel')}</button></div></div>`
      : `<div class="dl"><button data-act="xp-send"><b>${h(n > 1 ? 'xp.markEach' : 'ux3b.markSent')}</b></button></div>`)
    : `<div class="dl"><button data-act="mark-sent" ${C.ui.snap ? 'disabled' : ''}><b>${h('ux3b.markSent')}</b></button></div>`;
  return `<div class="xptop"><button class="press xpback" data-tier="secondary" data-act="xp-back">${withArrows(h(backKey(x?.from)))}</button><span class="xpstep">${h('xp.step')}</span></div>
    <div class="xpwhat"><span class="xptag">${h('xp.exporting')}</span><h2 class="title">${many && n > 1 ? `<span class="xpco">${esc(t('xp.n', { n }))}</span>` : name(many ? its[0]?.r ?? r : r)}</h2></div>
    <div class="xpgrid${many ? ' is-many' : ''}">
    <section class="xpb${many ? '' : ' exstat'}${look ? ' is-warn' : ''}" data-k="ready" style="--hk:var(--hue-1)"><h3 class="xph">${h('xp.ready')}</h3><ul class="checks">${many ? its.map(line).join('') : list.map(row).filter((_, i) => !i || list[i].level !== 'ok').join('')}</ul></section>
    <section class="xpb" data-k="medium"><h3 class="xph" title="${esc(t('export.mediumTitle'))}">${h('export.medium')}</h3>
      <div class="seg fill" role="group" aria-label="${esc(t('export.medium'))}">${MEDIA.map(m => `<button data-act="ex-medium" data-v="${m}" aria-pressed="${medium === m}"${C.ui.snap && !many ? ' disabled' : ''}>${h(`export.medium.${m}`)}</button>`).join('')}</div>
      ${medium ? `<p class="note">${h(`export.mediumNote.${medium}`)}</p>` : ''}</section>
    <section class="xpb xpwide exg" data-k="file"><h3 class="xph">${h(n > 1 ? 'xp.downloadAll' : 'export.download')}</h3>
      <div class="dl">${card('ex-pdf', 'PDF', 'export.pdfNote', !fitFirst)}${card('ex-html', h('export.html'), 'export.htmlNote')}${card('ex-txt', h('export.txt'), 'export.txtNote')}${card('ex-json', 'JSON Resume', 'export.jsonNote')}</div>
      <p class="note">${h(n > 1 ? 'xp.zipNote' : 'export.note')}</p></section>
    <section class="xpb exg" data-k="sent"><h3 class="xph">${h('ux3b.sentRow')}</h3>${sent}</section>
    ${C.ui.layout?.phone ? '' : `<section class="xpb exkeep" data-k="keep"><h3 class="xph">${h('ux6b.backup')} · ${esc(t('uxs.everyResume'))}</h3><p class="small muted" id="fileline">${esc(file.text)}</p><button class="filebtn sm ${file.stale ? 'stale' : ''}" data-act="save-file" id="filestate" title="${esc(t('save.title', { name: SAVE_FILE_NAME }))}">${h('ux3b.saveFile')}</button></section>`}
    </div>`;
}
const drawn_ = ic => drawn(ic, { role: 'header' });

// ---- the pages of a listed set, left of the panel (a phone: above the sheet): every resume's pages in a row at the height of the room,
// one resume at a time when they do not all fit, with ‹ › (and the arrows, the scroll) to travel between them ----
let row = null;
function drawPages(){
  const on = inPlace() && C.ui.view === 'export' && listed() && !!C.ui.layout;
  document.body.classList.toggle('xp-list', on);
  if (!on){ row?.remove(); row = null; return; }
  const L = C.ui.layout;
  if (!row){
    row = Object.assign(document.createElement('div'), { id: 'xpages', className: 'xpages' });
    row.setAttribute('role', 'region'); row.setAttribute('aria-label', t('xp.pages'));
    row.innerHTML = `<div class="xptrack" tabindex="0"></div><button class="press xptravel" data-tier="secondary" data-d="-1" aria-label="${esc(t('xp.prev'))}">${drawn('left', { role: 'control' })}</button><button class="press xptravel" data-tier="secondary" data-d="1" aria-label="${esc(t('xp.next'))}">${drawn('right', { role: 'control' })}</button>`;
    row.addEventListener('click', e => { const b = e.target.closest('.xptravel'), tr = row.querySelector('.xptrack'); if (b) tr.scrollBy({ left: Math.sign(+b.dataset.d) * (tr.querySelector('.xpfig')?.offsetWidth ?? tr.clientWidth), behavior: 'smooth' }); });
    row.querySelector('.xptrack').addEventListener('scroll', () => travel());
    document.getElementById('col').before(row);
  }
  Object.assign(row.style, { left: '0px', top: '0px', width: `${Math.max(0, L.phone ? innerWidth : L.col.left - G)}px`, height: `${Math.max(0, L.phone ? L.col.top : innerHeight)}px` });
  const its = items(), tr = row.querySelector('.xptrack'), key = its.map(keyOf).join('\n');
  if (tr.dataset.key !== key){
    tr.dataset.key = key;
    tr.innerHTML = its.map(it => `<figure class="xpfig" data-id="${esc(it.id)}"><div class="xpstrip"></div>${its.length > 1 ? `<figcaption>${esc([it.r.company || RS.resumeLabel(it.r), it.r.company && it.r.role].filter(Boolean).join(' — '))}</figcaption>` : ''}</figure>`).join('');
  }
  for (const [i, it] of its.entries()){
    const e = laidOf(it), strip = tr.children[i]?.querySelector('.xpstrip');
    if (!e || !strip || strip.childElementCount) continue;
    const { w, h } = pageSize(e.format);
    strip.innerHTML = e.srcs.map(() => `<span class="xpslot" data-w="${w}" data-h="${h}"></span>`).join('');
    strip.querySelectorAll('.xpslot').forEach((slot, p) => { const f = document.createElement('iframe'); f.title = t('ux6e.thumb'); f.tabIndex = -1; f.setAttribute('scrolling', 'no'); f.srcdoc = e.srcs[p]; f.style.cssText = `width:${w}px;height:${h}px`; slot.append(f); });
  }
  // one scale for every page: the room's height (less a caption under several), and never wider than the room
  const cap = its.length > 1 ? 28 : 0;
  const W = parseFloat(row.style.width) - 2 * G, H = parseFloat(row.style.height) - 2 * G - cap, P = pageSize(its[0]?.r.format);
  const k = Math.max(0.05, Math.min(H / P.h, W / P.w));
  tr.querySelectorAll('.xpslot').forEach(slot => { const w = +slot.dataset.w, h = +slot.dataset.h; slot.style.width = `${w * k}px`; slot.style.height = `${h * k}px`; slot.firstChild.style.transform = `scale(${k})`; });
  tr.querySelectorAll('.xpstrip:empty').forEach(s => { s.style.width = `${P.w * k}px`; s.style.height = `${P.h * k}px`; });
  travel();
}
// the travel buttons only when the row is wider than its room, each only while there is somewhere to go
function travel(){
  const tr = row?.querySelector('.xptrack');
  if (!tr) return;
  const [prev, next] = row.querySelectorAll('.xptravel'), over = tr.scrollWidth > tr.clientWidth + 1;
  prev.hidden = !over || tr.scrollLeft <= 1; next.hidden = !over || tr.scrollLeft + tr.clientWidth >= tr.scrollWidth - 1;
}

// ---- the listed set's downloads: one file each, several as one ZIP named for the format ----
const TYPES = { html: 'text/html', txt: 'text/plain', json: 'application/json' };
async function plainOf(r){ const lang = r.lang ?? 'en'; await loadCatalogue(lang); return X.plainText(X.jsonResumeFile(C.work(), r).file, { lang, chrome: docChrome(lang) }); }
async function downloadListed(fmt){
  const its = items(), rec = st().record, laid = await Promise.all(its.map(it => C.thumb(it.r, mediumOf(it.r))));
  if (fmt === 'pdf'){
    if (its.length > 1) C.toast(t('xp.pdfEach', { n: its.length }));
    for (const [i, it] of its.entries()) await printPdf(it.r, laid[i]?.laid ?? null);      // one print dialog after another: the browser makes a PDF only there
    return;
  }
  const files = [];
  for (const [i, it] of its.entries()) files.push({ name: X.exportName(it.r, rec, fmt), data: fmt === 'html' ? await buildHtml(it.r, laid[i]?.laid ?? null) : fmt === 'txt' ? await plainOf(it.r) : JSON.stringify(X.jsonResumeFile(C.work(), it.r).file, null, 2) + '\n' });
  if (files.length === 1){ C.download(files[0].data, files[0].name, TYPES[fmt]); C.toast(t({ html: 'toast.htmlDone', txt: 'toast.txtDone', json: 'toast.jsonDone' }[fmt]), '', false, true); return; }
  const names = uniqueNames(files.map(f => f.name));
  C.download(zip(files.map((f, i) => ({ name: names[i], data: f.data }))), X.exportName({ company: t('xp.n', { n: files.length }), role: fmt.toUpperCase() }, rec, 'zip'), 'application/zip');
  C.toast(t('xp.zipDone', { n: files.length }), '', false, true);
}

// Mark each as sent: one undo step; each resume's send names its own company and role. The open resume is open again after it.
function markListed(){
  const x = xp(), kind = document.getElementById('xp-kind')?.value === 'outreach' ? 'outreach' : 'company', open = st().openId;
  let n = 0;
  C.store.commit(d => {
    RS.settle(d);
    for (const id of x.ids){ RS.openSaved(d, id); if (!RS.takeSnapshot(d, { kind, company: d.cur.company ?? '', role: d.cur.role ?? '', date: x.date }).repeated) n++; }
    if (open) RS.openSaved(d, open);
  }, t('ux1.undoSnapshot'));
  x.sending = false;
  C.toast(t('xp.sentN', { n }));
  C.renderBody();
}

// A major warning (level 'bad' in the pre-flight list) holds an export back: the dialog names it and offers Fix (go to it) or Dismiss (export as it is).
let dlg = null;
function blocked(a, tg){
  const major = checks().filter(c => c.level === 'bad');
  if (!major.length) return false;
  dlg?.remove();
  dlg = Object.assign(document.createElement('dialog'), { id: 'exblock', className: 'card rvdlg exdlg' });
  dlg.setAttribute('aria-labelledby', 'exb-h');
  const many = major.length > 1;      // one: Fix and Dismiss in the foot; several: each row has its own Fix, the foot has "Export anyway" and no primary press button
  const row = (c, i) => `<li class="bad"><span class="cmk">${drawn('warn', { role: 'inline' })}</span><span class="ct">${esc(c.text)}</span>${many ? `<button class="sm press" data-tier="secondary" data-exb="fix" data-i="${i}"${i ? '' : ' autofocus'}>${h('ux6f.exFix')}</button>` : ''}</li>`;
  dlg.innerHTML = `<div class="rvwrap"><div class="rvhead"><h2 id="exb-h">${h(many ? 'ux6f.exTitleMany' : 'ux6f.exTitle')}</h2></div>
    <div class="rvbody"><ul class="checks">${major.map(row).join('')}</ul><p class="note">${h(many ? 'ux6f.exNoteMany' : 'ux6f.exNote')}</p></div>
    <div class="rvfoot"><span></span><div class="rvfoot-btns">${many ? '' : `<button class="primary press" data-tier="primary" data-exb="fix" data-i="0" autofocus>${h('ux6f.exFix')}</button>`}<button class="press" data-tier="secondary" data-exb="dismiss">${h(many ? 'ux6f.exAnyway' : 'ux6f.exDismiss')}</button></div></div></div>`;
  document.body.append(dlg);
  const d = dlg, opener = tg;
  d.addEventListener('keydown', e => e.stopPropagation());      // the page's shortcuts must not act behind it
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-exb]');
    if (b) d.close(b.dataset.exb === 'fix' ? `fix:${b.dataset.i}` : b.dataset.exb);
  });
  d.addEventListener('close', () => {
    d.remove(); dlg = null;
    if (d.returnValue.startsWith('fix:')){ const f = major[+d.returnValue.slice(4)].fix ?? {}; C.goFix?.(f.vid ? { fact: factOf(C.work(), f.vid)?.id } : f); }
    else if (d.returnValue === 'dismiss') act(a, tg, true);
    else if (opener?.isConnected) opener.focus?.();
  });
  d.showModal();
  return true;
}

async function act(a, tg, force = false){
  const s = st();
  const many = listed();
  if (!force && !many && ['ex-pdf', 'ex-html', 'ex-txt', 'ex-json'].includes(a) && blocked(a, tg)) return true;
  // after the download has started: the drink's own picture of it, from the page to the button that was pressed
  const fx = fmt => exportFx({ drink: drink(), from: many ? null : C.pageBox?.() ?? null, to: tg?.getBoundingClientRect?.() ?? null, fmt, pages: C.ui.fills?.length ?? 1 });
  try {
    switch (a){
      case 'xp-back': back(); return true;
      case 'xp-send': xp().sending = true; C.renderBody(); document.getElementById('xp-kind')?.focus(); return true;
      case 'xp-send-cancel': xp().sending = false; C.renderBody(); document.querySelector('#body [data-act=xp-send]')?.focus(); return true;
      case 'xp-send-do': markListed(); return true;
    }
    // a listed set: its medium is this export's (nothing saved), its files are made from each resume as it prints
    if (many && a === 'ex-medium'){ if (MEDIA.includes(tg.dataset.v)){ xp().medium = tg.dataset.v; C.renderBody(); drawPages(); } return true; }
    if (many && ['ex-pdf', 'ex-html', 'ex-txt', 'ex-json'].includes(a)){ const fmt = a.slice(3); await downloadListed(fmt); fx(fmt === 'txt' ? 'TXT' : fmt.toUpperCase()); return true; }
    switch (a){
      // per resume, with undo; the default (a screen) is no key at all
      case 'ex-medium': { const v = tg.dataset.v; if (MEDIA.includes(v)) C.store.commit(d => { if (v === 'screen') delete d.cur.exportMedium; else d.cur.exportMedium = v; }, t('export.medium')); return true; }
      case 'ex-fix': { const f = checks()[+tg.dataset.i]?.fix ?? {}; C.goFix?.(f.vid ? { fact: factOf(C.work(), f.vid)?.id } : f); return true; }
      case 'ex-pdf': if (!window.__TAURI__) C.toast(t('toast.printDialog')); fx('PDF'); await printPdf(); C.offerReview?.(); return true;
      case 'ex-html': C.download(await buildHtml(), X.exportName(C.cur(), s.record, 'html'), 'text/html'); C.toast(t('toast.htmlDone'), '', false, true); fx('HTML'); return true;
      case 'ex-txt': { const r = C.cur(), lang = r.lang ?? 'en'; await loadCatalogue(lang); C.download(X.plainText(X.jsonResumeFile(C.work(), r).file, { lang, chrome: docChrome(lang) }), X.exportName(r, s.record, 'txt'), 'text/plain'); const lost = X.unexportedNote(X.unexported(C.work(), r)); C.toast(lost ? `${t('toast.txtDone')} ${lost}` : t('toast.txtDone'), lost ? 'warn' : '', false, true); fx('TXT'); return true; }
      case 'ex-json': { const { file, problems } = X.jsonResumeFile(C.work(), C.cur()); C.download(JSON.stringify(file, null, 2) + '\n', X.exportName(C.cur(), s.record, 'json')); const lost = X.unexportedNote(X.unexported(C.work(), C.cur())); C.toast(lost || (problems.length ? t('toast.jsonNotes', { n: problems.length, first: problems[0] }) : t('toast.jsonDone')), lost || problems.length ? 'warn' : '', false, true); fx('JSON'); return true; }
    }
  } catch (e){ console.error(e); C.toast(t('toast.exportFailed', { msg: errText(e) }), 'bad'); return true; }
  return false;
}

const api = { views: { export: exportView }, act, buildHtml, checks, open: openExport, back, drawPages };
