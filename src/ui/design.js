// The Design view: pages, paper, template, accent, theme import and export, and the photo.
// All per resume, except the photo and imported themes, which live once in the record.
// An imported theme (`recipe.look`) and the accent become one CSS block that the sheet
// and the exports add after the base theme. Neither touches the renderer.

import * as K from '../model/tokens.js';
import { toAuto, setPhoto as setResumePhoto, setRecordPhoto } from '../model/resume.js';
import { t, h, errText, keyed } from '../i18n/index.js';
import { LANG_INFO } from '../model/lang.js';

let C = null;
export function initDesign(ctx){ C = ctx; return api; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const st = () => C.store.state;
export const SWATCHES = ['#ffd900', '#7fd1ae', '#9cc3ff', '#ffb08a', '#d6b4ff', '#f4a6c0'];
export const TEMPLATES = [
  { id: 'b2', name: 'B2 Marker', overlays: [], note: 'The signature look: marker tabs and highlights.' },
  { id: 'tint', name: 'Tinted tabs', overlays: ['tint-tabs'], note: 'Quieter tabs; the highlights stay strong.' },
  { id: 'aa', name: 'High-contrast metadata', overlays: ['contrast-aa'], note: 'Dates and places darker, for WCAG AA.' },
  { id: 'mono', name: 'Mono print', overlays: ['print-mono'], note: 'For a black-and-white printer: outlined tabs, no colour.' },
];
const BASE_TOKENS = { tab: '{color.accent}', 'tab-ink': '#1a1a1a', ink: '#1a1a1a' };
const templateOf = r => TEMPLATES.find(x => JSON.stringify(x.overlays) === JSON.stringify(r.overlays ?? [])) ?? null;
const tplName = x => t(`design.tpl.${x.id}`);
const tplNote = x => t(`design.tplNote.${x.id}`);

// The tokens a resume adds on top of its base theme.
export function tokensOf(record, recipe){
  const t = { ...((record.themes ?? []).find(x => x.id === recipe.look)?.tokens ?? {}) };
  if (recipe.accent){ t.accent = recipe.accent; t.highlight = recipe.accent; }
  return t;
}
export const extraCss = (record, recipe) => K.toCss(tokensOf(record, recipe));

// An image file → a 35 × 45 mm passport crop, a 472 × 600 JPEG data URL of at most 300 KB.
export async function cropPhoto(file){
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(keyed('error.imageUnreadable')); i.src = url; });
    const W = 472, H = 600, ratio = W / H;
    let sw = img.naturalWidth, sh = img.naturalHeight;
    if (sw / sh > ratio) sw = sh * ratio; else sh = sw / ratio;
    const sx = (img.naturalWidth - sw) / 2;
    const sy = (img.naturalHeight - sh) * 0.35;                   // a little above centre: heads, not chins
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
    for (const q of [0.86, 0.78, 0.7, 0.6, 0.5]){
      const d = cv.toDataURL('image/jpeg', q);
      if (d.length * 0.75 <= 300 * 1024) return d;
    }
    throw keyed('error.photoTooBig');
  } finally { URL.revokeObjectURL(url); }
}

function designView(){
  const r = C.cur(), rec = st().record;
  const tpl = templateOf(r);
  const accent = r.accent ?? '#ffd900';
  const chk = K.accentCheck(accent, '#1a1a1a');
  const themes = rec.themes ?? [];
  const look = themes.find(t => t.id === r.look);
  const fontWarn = look ? Object.entries(look.tokens).filter(([k]) => k.startsWith('font-')).flatMap(([, v]) => K.unknownFonts(v)) : [];
  const hasPhoto = !!(rec.basics?.image || rec.basics?.portrait?.state === 'present');
  const a4 = r.format !== 'us-letter';
  const manual = Array.isArray(r.pages);
  return `<h2 class="title">${h('head.design')}</h2>
    <div class="drow">
      <div><span class="lbl">${h('design.pages')}</span>
        <div class="seg" role="group" aria-label="${esc(t('design.pages'))}">${[[1, t('design.onePage')], [2, t('design.twoPages')], [0, t('design.anyPages')]].map(([n, l]) => `<button data-act="d-pages" data-n="${n}" aria-pressed="${!manual && (r.pageLimit ?? 1) === n}">${esc(l)}</button>`).join('')}</div></div>
      <div><span class="lbl">${h('design.paper')}</span>
        <div class="seg" role="group" aria-label="${esc(t('design.paper'))}"><button data-act="d-paper" data-f="us-letter" aria-pressed="${!a4}">${h('paper.letter')}</button><button data-act="d-paper" data-f="a4" aria-pressed="${a4}">${h('paper.a4')}</button></div></div>
    </div>
    <p class="note">${manual ? h('design.manualNote', { n: r.pages.length }) : r.pageLimit === 0 ? h('design.flowNote') : h(r.pageLimit === 2 ? 'design.fitTwo' : 'design.fitOne')}</p>
    <span class="lbl">${h('design.template')}</span>
    <div class="tpls">${TEMPLATES.map(x => `<button class="tpl" data-act="d-tpl" data-t="${x.id}" aria-pressed="${tpl?.id === x.id}" title="${esc(tplNote(x))}"><i class="tpl-${x.id}"></i>${esc(tplName(x))}</button>`).join('')}</div>
    <div class="drow two">
      <div><span class="lbl">${h('design.accent')}</span>
        <div class="sws">${SWATCHES.map(c => `<button class="swatch" style="background:${c}" data-act="d-accent" data-c="${c}" aria-pressed="${accent === c}" aria-label="${esc(t('design.accentX', { c }))}"></button>`).join('')}
          <label class="swatch custom" title="${esc(t('design.anyColour'))}"><input type="color" id="d-color" value="${esc(accent)}" aria-label="${esc(t('design.pickColour'))}"></label>
          ${r.accent ? `<button class="sm ghost" data-act="d-accent" data-c="">${h('design.themesOwn')}</button>` : ''}</div>
        <p class="note ${chk.ok ? '' : 'bad'}">${chk.ok ? h('design.contrastOk', { r: chk.ratio.toFixed(1) }) : h('design.contrastBad', { r: chk.ratio?.toFixed(1) })}</p></div>
      <div><span class="lbl">${h('design.theme')}</span>
        <div class="list">${['', ...themes.map(x => x.id)].map(id => { const th = themes.find(x => x.id === id);
          return `<button class="item ${(r.look ?? '') === id ? 'is-cur' : ''}" data-act="d-look" data-id="${esc(id)}"><span>${esc(th ? th.name : t('design.templatesOwn'))}</span><span class="muted small">${th ? h('design.tokensImported', { n: Object.keys(th.tokens).length }) : h('design.builtIn')}</span></button>`; }).join('')}</div>
        ${fontWarn.length ? `<p class="note bad">${h('design.fontWarn', { fonts: fontWarn.join(', '), n: fontWarn.length })}</p>` : ''}
        <div class="btns"><button class="sm" data-act="d-import">${h('design.import')}</button><button class="sm ghost" data-act="d-export">${h('design.export')}</button>${look ? `<button class="sm ghost" data-act="d-drop" data-id="${esc(look.id)}">${h('design.removeX', { name: look.name })}</button>` : ''}</div></div>
    </div>
    <span class="lbl">${h('design.photo')}</span>
    <div class="photo-row">${hasPhoto && rec.basics?.image ? `<img class="thumb" src="${esc(C.photoUrl())}" alt="">` : `<span class="thumb empty">${hasPhoto ? h('design.photoWord') : h('design.none')}</span>`}
      <div class="photo-ctl">
        <div class="btns"><button class="sm" data-act="d-photo">${hasPhoto ? h('design.replacePhoto') : h('design.addPhoto')}</button>${rec.basics?.image ? `<button class="sm ghost" data-act="d-photo-rm">${h('design.remove')}</button>` : ''}
          <label class="swl"><input type="checkbox" class="sw" id="d-photo-on" ${r.photo?.show ? 'checked' : ''}><span>${h('design.showPhoto')}</span></label></div>
        <div class="seg" role="group" aria-label="${esc(t('design.shape'))}">${[['rect', t('design.passport')], ['soft', t('design.rounded')], ['round', t('design.circle')]].map(([s, l]) => `<button data-act="d-shape" data-s="${s}" aria-pressed="${(r.photo?.shape ?? 'rect') === s}">${esc(l)}</button>`).join('')}</div>
        <p class="note" data-tip="${esc(t('design.photoNote') + ' ' + t('design.photoCrop'))}" aria-description="${esc(t('design.photoNote') + ' ' + t('design.photoCrop'))}" tabindex="0">${h('ux6b.photoHint')}${r.photo?.show && !a4 ? ' ' + h('design.letterPhoto') : ''}</p></div></div>`;
}

function commit(fn, label, done){
  try { const ok = C.store.commit(d => { fn(d); }, label); if (ok && done) C.toast(done); return ok; }
  catch (e){ C.toast(errText(e), 'bad'); return false; }
}

// The picture goes in the record (basics.image); `show`: and on this resume
export async function setPhoto(file, { show = true } = {}){
  try {
    const data = await cropPhoto(file);
    commit(d => { setRecordPhoto(d.record, data); if (show) setResumePhoto(d.cur, { show: true }); }, t('design.photo'), show ? t('toast.photoAdded') : t('ux6c.photoKept'));
  } catch (e){ C.toast(errText(e), 'bad'); }
}
// The photo slot by the name on the page: the photo is printed on this resume, or not
export function togglePhoto(){
  const on = !C.cur().photo?.show;
  commit(d => setResumePhoto(d.cur, { show: on }), on ? t('undo.showPhoto') : t('undo.hidePhoto'));
}
// A picture dropped on the page asks what it is for: this resume's photo, or only the record's
export function askPhoto(file){
  document.querySelector('.photoask')?.remove();
  const box = document.createElement('div');
  box.className = 'photoask';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', t('ux6c.imgFor'));
  box.innerHTML = `<p class="pa-q">${esc(t('ux6c.imgFor'))}</p><p class="pa-f muted small">${esc(file.name)}</p>
    <div class="pa-btns"><button class="primary sm" data-pa="resume">${esc(t('ux6c.imgResume'))}</button><button class="sm" data-pa="record">${esc(t('ux6c.imgRecord'))}</button><button class="sm ghost" data-pa="cancel">${esc(t('btn.cancel'))}</button></div>`;
  document.getElementById('body').prepend(box);        // an inline notice at the top of the editor card: it covers no printed text
  const done = a => {
    box.remove(); document.removeEventListener('keydown', onKey, true);
    if (a === 'resume') setPhoto(file); else if (a === 'record') setPhoto(file, { show: false });
  };
  const onKey = e => { if (!box.isConnected) return document.removeEventListener('keydown', onKey, true); if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); done('cancel'); } };
  document.addEventListener('keydown', onKey, true);
  box.addEventListener('click', e => { const a = e.target.closest('[data-pa]')?.dataset.pa; if (a) done(a); });
  box.querySelector('button').focus();
}

export function importTheme(input, fileName){
  const p = K.parseTheme(input, { fileName });
  if (!Object.keys(p.tokens).length){ C.toast(t('toast.noTokens', { file: fileName }) + (p.ignored[0] ? ` ${p.ignored[0].key}: ${p.ignored[0].why}` : ''), 'bad'); return; }
  const id = `theme-${(p.name || 'imported').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'imported'}`;
  commit(d => {
    d.record.themes = [...(d.record.themes ?? []).filter(x => x.id !== id), { id, name: p.name || t('design.importedTheme'), tokens: p.tokens }];
    d.cur.look = id;
  }, t('undo.importTheme'));
  const fonts = Object.entries(p.tokens).filter(([k]) => k.startsWith('font-')).flatMap(([, v]) => K.unknownFonts(v));
  const n = Object.keys(p.tokens).length;
  C.toast(t('toast.themeApplied', { name: p.name || t('design.importedTheme'), n })
    + (p.ignored.length ? t('toast.themeIgnored', { n: p.ignored.length, keys: `${p.ignored.slice(0, 3).map(i => i.key).join(', ')}${p.ignored.length > 3 ? '…' : ''}` }) : '')
    + (fonts.length ? t('toast.themeFonts', { fonts: fonts.join(', ') }) : '') + t('toast.themeEnd'), p.ignored.length || fonts.length ? 'warn' : '');
  C.setView('design');
}

async function act(a, tg){
  const r = C.cur();
  switch (a){
    case 'd-pages': {
      const n = Number(tg.dataset.n);
      commit(d => { toAuto(d.record, d.cur); d.cur.pageLimit = n; }, t('design.pages'));
      return true;
    }
    case 'd-paper': {
      const f = tg.dataset.f === 'a4' ? (LANG_INFO[r.lang ?? 'en']?.a4Format ?? 'a4') : 'us-letter';
      commit(d => { d.cur.format = f; }, t('design.paper'), f === 'us-letter' && r.photo?.show ? t('toast.letterPhoto') : null);
      return true;
    }
    case 'd-tpl': { const tp = TEMPLATES.find(x => x.id === tg.dataset.t); commit(d => { d.cur.overlays = [...tp.overlays]; d.cur.theme = 'b2-marker'; }, t('undo.template', { name: tplName(tp) })); return true; }
    case 'd-accent': { const c = tg.dataset.c; commit(d => { if (c) d.cur.accent = c; else delete d.cur.accent; }, t('design.accent')); return true; }
    case 'd-look': { const id = tg.dataset.id; commit(d => { if (id) d.cur.look = id; else delete d.cur.look; }, t('design.theme')); return true; }
    case 'd-drop': { const id = tg.dataset.id; commit(d => { d.record.themes = (d.record.themes ?? []).filter(x => x.id !== id); for (const x of [d.cur, ...(d.resumes ?? [])]) if (x.look === id) delete x.look; }, t('undo.removeTheme'), t('toast.themeRemoved')); return true; }
    case 'd-import': C.pickFile('theme'); return true;
    case 'd-export': {
      const file = { b2: 'b2-marker', tint: 'tint-tabs', aa: 'contrast-aa', mono: 'print-mono' }[templateOf(r)?.id ?? 'b2'];
      const built = await fetch(`themes/${file}.tokens.json`).then(x => x.json()).then(j => K.parseTheme(j).tokens).catch(() => ({}));
      const base = { ...BASE_TOKENS, ...built };
      const tokens = { ...base, ...tokensOf(st().record, r) };
      const name = (st().record.themes ?? []).find(x => x.id === r.look)?.name ?? `${templateOf(r)?.name ?? 'B2 Marker'}${r.accent ? ` ${r.accent}` : ''}`;   // English name on purpose: it becomes a file name
      C.download(JSON.stringify(K.serialize(name, tokens), null, 2) + '\n', `${name.replace(/[^\p{L}\p{N} _.-]+/gu, ' ').trim()}.tokens.json`);
      C.toast(t('toast.themeExported'));
      return true;
    }
    case 'd-photo': C.pickFile('photo'); return true;
    case 'd-photo-rm': commit(d => { delete d.record.basics.image; for (const x of [d.cur]) if (x.photo) x.photo.show = false; }, t('undo.removePhoto'), t('toast.photoRemoved')); return true;
    case 'd-shape': { const s = tg.dataset.s; commit(d => { d.cur.photo = { show: true, ...(d.cur.photo ?? {}), shape: s }; }, t('design.shape')); return true; }
  }
  return false;
}

function bind(body){
  body.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'd-photo-on'){ const on = el.checked; commit(d => { d.cur.photo = { shape: 'rect', ...(d.cur.photo ?? {}), show: on }; }, on ? t('undo.showPhoto') : t('undo.hidePhoto')); }
    if (el.id === 'd-color'){ const c = el.value; if (/^#[0-9a-f]{6}$/i.test(c)) commit(d => { d.cur.accent = c.toLowerCase(); }, t('design.accent')); }
  });
}

const api = { views: { design: designView }, act, bind, setPhoto, togglePhoto, askPhoto, importTheme, extraCss: (rec, r) => extraCss(rec, r), tokensOf };
