// The Export view: pre-flight checks, then the downloads. The string work is in
// src/export.js; this module fetches, downloads and prints.

import { pageSize } from './layout.js';
import * as X from '../export.js';
import { renderPages } from '../render.js';
import { missingList } from '../model/lang.js';
import * as RS from '../model/resumes.js';
import { t, h, errText, docChrome, loadCatalogue } from '../i18n/index.js';
import { fitFilled, exFitHtml } from './dock.js';
import { icon as drawn } from './icons.js';
import { exportFx } from './exportfx.js';
import { drink } from './drink.js';

let C = null;
export function initExport(ctx){ C = ctx; return api; }

const esc = X.escapeHtml;
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
  for (const href of hrefs){
    const path = X.normalisePath(`templates/${href}`);
    let t = await text(path);
    const map = new Map();
    for (const u of X.cssUrls(t, path)){
      if (!fonts.has(u.url)) fonts.set(u.url, await dataUrl(u.url).catch(() => null));
      if (fonts.get(u.url)) map.set(u.match, fonts.get(u.url));
    }
    t = X.replaceUrls(t, map);
    css.push({ href, text: t });
  }
  const extra = C.extraCss?.(r) ?? '';
  if (extra) css.push({ href: 'tokens', text: extra });
  await loadCatalogue(r.lang ?? 'en');
  const pages = renderPages(C.work(), r, document, { fallback: true, chrome: docChrome(r.lang ?? 'en') }).pages;
  const documentHtml = X.cleanMarkup(pages.map(p => p.outerHTML).join('\n'));
  const name = st().record.basics?.name ?? 'Resume';
  return X.assembleHtml({ templateHtml: tpl, css, documentHtml, title: `${name}${recipe.company ? ` — ${recipe.company}` : ''}`,
    lang: recipe.lang ?? 'en' });
}

// The desktop app (Tauri): one Save dialog, then a hidden window prints the page straight to that file (desktop/print.js).
// Returns true when it handled the export; false means "use the print dialog instead" (not macOS, or the export failed to start).
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
  return X.preflight({ model: C.work(), recipe: r, fills: C.ui.fills ?? [], missing: missingList(C.work(), r).length,
    newer: C.ui.snap ? 0 : RS.newerOf(C.work(), r).length, vault: s.record.requireSource !== false });
}

function exportView(){
  const list = checks();
  const icon = { ok: drawn('check', { size: 12 }), warn: drawn('warn', { size: 12 }), bad: drawn('close', { size: 12 }) };
  // one filled button on the screen: Fit when it would change something, else PDF
  const fitFirst = fitFilled(C.ui.fills, C.cur()?.pageLimit);
  return `<h2 class="title">${h('head.export')}</h2>
    <ul class="checks">${list.map(c => `<li class="${c.level}"><span class="ci">${icon[c.level]}</span>${esc(c.text)}</li>`).join('')}</ul>
    ${exFitHtml()}
    <span class="lbl">${h('export.download')}</span>
    <div class="dl">
      <button class="${fitFirst ? '' : 'primary'}" data-act="ex-pdf"><b>PDF</b><small>${h('export.pdfNote')}</small></button>
      <button data-act="ex-html"><b>${h('export.html')}</b><small>${h('export.htmlNote')}</small></button>
      <button data-act="ex-txt"><b>${h('export.txt')}</b><small>${h('export.txtNote')}</small></button>
      <button data-act="ex-json"><b>JSON Resume</b><small>${h('export.jsonNote')}</small></button>
    </div>
    <p class="note">${h('export.note')}</p>
    <hr class="sentrule">
    <div class="sentrow"><span class="lbl inline">${h('ux3b.sentRow')}</span><button data-act="mark-sent" ${C.ui.snap ? 'disabled' : ''}>${h('ux3b.markSent')}</button></div>`;
}

async function act(a, tg){
  const s = st();
  // after the download has started: the drink's own picture of it, from the page to the button that was pressed
  const fx = fmt => exportFx({ drink: drink(), from: C.pageBox?.() ?? null, to: tg?.getBoundingClientRect?.() ?? null, fmt, pages: C.ui.fills?.length ?? 1 });
  try {
    switch (a){
      case 'ex-pdf': if (!window.__TAURI__) C.toast(t('toast.printDialog')); fx('PDF'); await printPdf(); return true;
      case 'ex-html': C.download(await buildHtml(), X.exportName(C.cur(), s.record, 'html'), 'text/html'); C.toast(t('toast.htmlDone')); fx('HTML'); return true;
      case 'ex-txt': { const r = C.cur(), lang = r.lang ?? 'en'; await loadCatalogue(lang); C.download(X.plainText(X.jsonResumeFile(C.work(), r).file, { lang, chrome: docChrome(lang) }), X.exportName(r, s.record, 'txt'), 'text/plain'); C.toast(t('toast.txtDone')); fx('TXT'); return true; }
      case 'ex-json': { const { file, problems } = X.jsonResumeFile(C.work(), C.cur()); C.download(JSON.stringify(file, null, 2) + '\n', X.exportName(C.cur(), s.record, 'json')); C.toast(problems.length ? t('toast.jsonNotes', { n: problems.length, first: problems[0] }) : t('toast.jsonDone'), problems.length ? 'warn' : ''); fx('JSON'); return true; }
    }
  } catch (e){ console.error(e); C.toast(t('toast.exportFailed', { msg: errText(e) }), 'bad'); return true; }
  return false;
}

const api = { views: { export: exportView }, act, buildHtml, checks };
