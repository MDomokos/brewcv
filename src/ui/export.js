// The Export view: pre-flight checks, then the downloads. The string work is in
// src/export.js; this module fetches, downloads and prints.

import { pageSize } from './layout.js';
import * as X from '../export.js';
import { renderPages } from '../render.js';
import { MEDIA, onPaper } from '../model/design.js';
import { missingList } from '../model/lang.js';
import { factOf } from '../model/record.js';
import * as RS from '../model/resumes.js';
import { t, h, errText, docChrome, loadCatalogue } from '../i18n/index.js';
import { fitFilled } from './dock.js';
import { icon as drawn } from './icons.js';
import { exportFx } from './exportfx.js';
import { drink } from './drink.js';
import { SAVE_FILE_NAME } from '../store/persist.js';

let C = null;
export function initExport(ctx){ C = ctx; return api; }

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
async function savePdfFile(html){
  const T = window.__TAURI__;
  const path = await T.dialog.save({ defaultPath: X.exportName(C.cur(), st().record, 'pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!path) return true;
  const w = new T.webviewWindow.WebviewWindow('print' + Date.now(), { url: 'desktop/print.html', visible: false, width: 900, height: 1100 });
  await new Promise((ok, no) => { w.once('tauri://created', ok); w.once('tauri://error', e => no(new Error(String(e.payload)))); });
  const done = new Promise(ok => T.event.once('pdf-done', e => ok(e.payload)));
  await new Promise(ok => setTimeout(ok, 600)); // the page's listener is set up a moment after the window exists
  const { w: pw, h: ph } = pageSize(C.cur().format);   // the page box in CSS px; the paper is the same size in points, so nothing spills onto a blank page
  await w.emit('html', { html, path, width: pw * 0.75, height: ph * 0.75 });
  const r = await done;
  if (r.unsupported) return false;
  C.toast(r.ok ? t('toast.pdfSaved', { path }) : t('toast.pdfFailed', { msg: r.msg }), r.ok ? '' : 'bad');
  return true;
}

// Print from a hidden frame. @page sets the paper size; the user saves as PDF from the dialog.
async function printPdf(){
  const html = await buildHtml();
  if (window.__TAURI__){
    try { if (await savePdfFile(html)) return; } catch (e){ console.error(e); }
    C.toast(t('toast.printDialog'));
  }
  const fr = document.createElement('iframe');
  fr.className = 'print-frame';
  fr.setAttribute('aria-hidden', 'true');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.append(fr);
  await new Promise(ok => { fr.onload = ok; fr.srcdoc = html; });
  try { await fr.contentDocument.fonts?.ready; } catch {}
  fr.contentDocument.title = X.exportName(C.cur(), st().record, 'pdf').replace(/\.pdf$/, '');
  fr.contentWindow.focus();
  fr.contentWindow.print();
  setTimeout(() => fr.remove(), 60_000);
}

function checks(){
  const s = st(), r = C.cur();
  return X.preflight({ model: C.work(), recipe: r, fills: C.ui.fills ?? [], missing: missingList(C.work(), r, { inGroup: RS.inGroup(st(), r) }).length,
    newer: C.ui.snap ? 0 : RS.newerOf(C.work(), r).length, vault: s.record.requireSource !== false });
}

function exportView(){
  const list = checks();
  // one filled button on the screen: Fit when it would change something, else PDF
  const fitFirst = fitFilled(C.ui.fills, C.cur()?.pageLimit);
  const file = C.fileLine();
  // the finish (round 3): 1 know it is ready (the cup, the status row with Fit and the page bars at its end), 2 get the file, 3 record that it was sent;
  // the backup is housekeeping, a quiet row under the bands. Icons: the cup (44), one status glyph (24), a band's (28): document, paper plane.
  const medium = mediumOf(C.cur());
  const r = C.cur(), look = list.some(c => c.level !== 'ok'), bad = list.some(c => c.level === 'bad');
  const who = [r.company, r.role].filter(Boolean).join(' · ') || st().record.basics?.name || '';
  const band = (ic, title) => `<h3 class="sgh hband"><span class="exic hic" aria-hidden="true">${drawn(ic, { role: 'header' })}</span><span class="exht">${esc(title)}</span></h3>`;
  const grp = (k, hue, ic, title, inner) => `<section class="sgroup exg" data-k="${k}" style="--hk:var(--hue-${hue})">${band(ic, title)}${inner}</section>`;
  // the status row is the first item of the pre-flight list (the page result); a problem is a row under it, with Review or Fix at its end
  const row = (c, i) => `<li class="${c.level}"><span class="exst hic" aria-hidden="true">${i ? '' : drawn(look ? 'warn' : 'check', { role: 'header' })}</span><span class="ct">${esc(c.text)}${['unexported', 'newer'].includes(c.key) && C.reviewCount?.() ? ` <button class="sm press" data-tier="secondary" data-act="review-open">${h('newer.review')}</button>` : c.fix ? ` <button class="sm press" data-tier="secondary" data-act="ex-fix" data-i="${i}">${h('ux6f.exFix')}</button>` : ''}</span></li>`;
  const stat = list.map((c, i) => row(c, i)).filter((_, i) => !i || list[i].level !== 'ok');
  return `<header class="exhero hband" style="--hk:var(--hue-1)"><span class="excup hic" aria-hidden="true">${drawn('brewed', { role: 'display' })}</span>
      <h2 class="title">${h(bad ? 'head.export' : 'ux6g.exReady')}</h2>
      ${who ? `<p class="exwho">${esc(who)}</p>` : ''}</header>
    <div class="exstat${look ? ' is-warn' : ''}" style="--hk:var(--hue-1)"><ul class="checks">${stat.join('')}</ul></div>
    ${grp('file', 2, 'document', t('export.download'), `<div class="kv"><span class="lbl" title="${esc(t('export.mediumTitle'))}">${h('export.medium')}</span>
      <div class="seg fill" role="group" aria-label="${esc(t('export.medium'))}">${MEDIA.map(m => `<button data-act="ex-medium" data-v="${m}" aria-pressed="${medium === m}"${C.ui.snap ? ' disabled' : ''}>${h(`export.medium.${m}`)}</button>`).join('')}</div>
      <p class="note">${h(`export.mediumNote.${medium}`)}</p></div>
    <div class="dl">
      <button class="${fitFirst ? '' : 'primary'}" data-act="ex-pdf"><b>PDF</b><small>${h('export.pdfNote')}</small></button>
      <button data-act="ex-html"><b>${h('export.html')}</b><small>${h('export.htmlNote')}</small></button>
      <button data-act="ex-txt"><b>${h('export.txt')}</b><small>${h('export.txtNote')}</small></button>
      <button data-act="ex-json"><b>JSON Resume</b><small>${h('export.jsonNote')}</small></button>
    </div>
    <p class="note">${h('export.note')}</p>`)}
    ${grp('sent', 3, 'plane', t('ux3b.sentRow'), `<div class="dl"><button data-act="mark-sent" ${C.ui.snap ? 'disabled' : ''}><b>${h('ux3b.markSent')}</b></button></div>`)}
    ${C.ui.layout?.phone ? '' : `<footer class="exkeep"><span class="exkt"><span><b>${h('ux6b.backup')}</b> · ${esc(t('uxs.everyResume'))}</span><span class="small muted" id="fileline">${esc(file.text)}</span></span><button class="filebtn sm ${file.stale ? 'stale' : ''}" data-act="save-file" id="filestate" title="${esc(t('save.title', { name: SAVE_FILE_NAME }))}">${h('ux3b.saveFile')}</button></footer>`}`;
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
  if (!force && ['ex-pdf', 'ex-html', 'ex-txt', 'ex-json'].includes(a) && blocked(a, tg)) return true;
  // after the download has started: the drink's own picture of it, from the page to the button that was pressed
  const fx = fmt => exportFx({ drink: drink(), from: C.pageBox?.() ?? null, to: tg?.getBoundingClientRect?.() ?? null, fmt, pages: C.ui.fills?.length ?? 1 });
  try {
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

const api = { views: { export: exportView }, act, buildHtml, checks };
