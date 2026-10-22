// The Design view: pages, paper, template, accent, theme import and export, and the photo.
// All per resume, except the photo and imported themes, which live once in the record.
// The look settings (`recipe.design`), an imported theme (`recipe.look`) and the accent become one CSS block that the sheet
// and the exports add after the base theme. None touches the renderer.

import * as K from '../model/tokens.js';
import { designOf, designCss, setDesign, PRESETS, FONTS, SIZES, DENSITIES, COLOURS, WORDS } from '../model/design.js';
import { THEMES, lookOf } from '../themes.js';
import { toAuto, setPhoto as setResumePhoto, setRecordPhoto } from '../model/resume.js';
import { t, h, errText, keyed } from '../i18n/index.js';
import { showSw } from './parts.js';
import { askPhotoLocked } from './ask.js';
import { LANG_INFO } from '../model/lang.js';

let C = null;
export function initDesign(ctx){ C = ctx; return api; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const st = () => C.store.state;
// The picker lists the looks a resume can be given; an earlier one (src/themes.js `earlier`) only renders.
export const TEMPLATES = THEMES.filter(x => !x.earlier).map(x => ({ id: x.id, name: x.name, overlays: x.layers.slice(1), note: x.note }));
const BASE_TOKENS = { tab: '{color.accent}', 'tab-ink': '#1a1a1a', ink: '#1a1a1a' };
const tplName = x => t(`design.tpl.${x.id}`);
const tplNote = x => t(`design.tplNote.${x.id}`);

// The tokens a resume adds on top of its base theme.
export function tokensOf(record, recipe){
  const t = { ...((record.themes ?? []).find(x => x.id === recipe.look)?.tokens ?? {}) };
  if (recipe.accent){ t.accent = recipe.accent; t.highlight = recipe.accent; }
  return t;
}
// The look settings first, then the accent and an imported theme's tokens, so an imported theme still wins.
export const extraCss = (record, recipe) => {
  const look = lookOf(recipe);
  return designCss(look, designOf(recipe, look), { accent: recipe.accent }) + K.toCss(tokensOf(record, recipe));
};

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

// The look's settings, compact: the section styles and the fonts as buttons (the chosen one's note below), size, density, colour and
// key words as rows of a label and its control. All of them come from designOf, so only what the look offers is drawn and the
// look's default is marked.
function settingsHtml(r, look){
  const L = look.design, D = designOf(r, look);
  const letter = r.format === 'us-letter';
  const set = (k, v) => `data-act="d-set" data-k="${k}" data-v="${v}"`;
  // a label may carry a second line (the size's px) and a title
  const seg = (k, items, on, off = () => false) => `<div class="seg fill" role="group" aria-label="${esc(t(`look.set.${k}`))}">${items.map(([v, l, sub, title]) => `<button ${set(k, v)} aria-pressed="${on === v}"${off(v) ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${esc(l)}${sub ? `<small>${esc(sub)}</small>` : ''}</button>`).join('')}</div>`;
  const row = (k, ctl, note = '', title = '') => `<span class="lbl"${title ? ` title="${esc(title)}"` : ''}>${h(`look.set.${k}`)}</span><div>${ctl}</div>${note ? `<p class="note">${note}</p>` : ''}`;
  const sizeOf = id => (L.sizes ?? SIZES)[id] ?? SIZES[id];
  const colourOn = !r.accent && D.colour;
  const shade = r.accent ?? COLOURS[D.colour][0];
  const chk = K.accentCheck(shade, '#1a1a1a');
  const dflt = esc(t('look.default'));
  const sizeWhy = letter ? h('look.sizeLetter') : L.sizes ? h('look.sizeFull', { px: Math.min(...Object.values(L.sizes)) }) : '';
  const presets = L.presets ?? Object.keys(PRESETS), fonts = L.fonts ?? Object.keys(FONTS);
  return (look.earlier ? '' : `<span class="lbl">${h('look.set.preset')}</span><div class="opts" role="group" aria-label="${esc(t('look.set.preset'))}">${presets.map(id =>
      `<button ${set('preset', id)} aria-pressed="${D.preset === id}" title="${esc(t(`look.presetNote.${id}`))}"${id === L.preset ? ` aria-label="${esc(t(`look.preset.${id}`))}, ${dflt}"` : ''}>${h(`look.preset.${id}`)}${id === L.preset ? '<i class="dflt" aria-hidden="true"></i>' : ''}</button>`).join('')}</div>
      <p class="note">${h(`look.presetNote.${D.preset}`)}</p>`)
    + `<span class="lbl">${h('look.set.fonts')}</span><div class="opts three" role="group" aria-label="${esc(t('look.set.fonts'))}">${fonts.map(id =>
      `<button ${set('fonts', id)} aria-pressed="${D.fonts === id}" title="${esc(FONTS[id].name)}"><span class="sample" style="font-family:${esc(FONTS[id].head)}">${esc(FONTS[id].short)}</span></button>`).join('')}</div>
      <p class="note">${esc(FONTS[D.fonts].name)}${D.fonts === L.font ? ` · ${dflt}` : ''}</p>`
    + `<div class="kv">`
    + row('size', seg('size', Object.keys(SIZES).map(id => [id, t(`look.size.${id}`), `${sizeOf(id)}px`, id === 'small' && sizeWhy ? sizeWhy.replace(/<[^>]*>/g, '') : '']), D.size, id => (id === 'small' && letter) || (L.sizes && !(id in L.sizes))), sizeWhy)
    + row('density', seg('density', Object.keys(DENSITIES).map(id => [id, t(`look.density.${id}`)]), D.density), h(`look.densityNote.${D.density}`))
    + row('colour', `<div class="sws">${Object.entries(COLOURS).map(([id, [screen, print]]) => { const title = t('look.colourTitle', { name: t(`look.colour.${id}`), screen, print });
        return `<button class="swatch split" style="background:linear-gradient(90deg,${screen} 50%,${print} 50%)" ${set('colour', id)} aria-pressed="${colourOn === id}" aria-label="${esc(title)}" title="${esc(title)}"></button>`; }).join('')}
        <label class="swatch custom" title="${esc(t('design.anyColour'))}"><input type="color" id="d-color" value="${esc(shade)}" aria-label="${esc(t('design.pickColour'))}"></label>
        ${r.accent ? `<button class="sm ghost" data-act="d-accent" data-c="">${h('design.themesOwn')}</button>` : ''}</div>`,
      `<span class="${chk.ok ? '' : 'bad'}">${chk.ok ? h('design.contrastOk', { r: chk.ratio.toFixed(1) }) : h('design.contrastBad', { r: chk.ratio?.toFixed(1) })}</span>`, t('look.colourNote'))
    + row('words', seg('words', WORDS.map(id => [id, t(`look.words.${id}`)]), D.words))
    + '</div>';
}

function designView(){
  const r = C.cur(), rec = st().record;
  const tpl = lookOf(r);
  const themes = rec.themes ?? [];
  const look = themes.find(t => t.id === r.look);
  const fontWarn = look ? Object.entries(look.tokens).filter(([k]) => k.startsWith('font-')).flatMap(([, v]) => K.unknownFonts(v)) : [];
  const a4 = r.format !== 'us-letter';
  const manual = Array.isArray(r.pages);
  // the usual case (Fit keeps it to the limit) is the tooltip; a note shows only when something is out of the ordinary
  const fitNote = t(manual ? 'design.manualNote' : r.pageLimit === 0 ? 'design.flowNote' : r.pageLimit === 2 ? 'design.fitTwo' : 'design.fitOne', { n: r.pages?.length });
  return `<h2 class="title">${h('head.design')}</h2>
    <div class="kv">
      <span class="lbl">${h('design.pages')}</span><div class="seg fill" role="group" aria-label="${esc(t('design.pages'))}" title="${esc(fitNote)}">${[[1, t('design.onePage')], [2, t('design.twoPages')], [0, t('design.anyPages')]].map(([n, l]) => `<button data-act="d-pages" data-n="${n}" aria-pressed="${!manual && (r.pageLimit ?? 1) === n}">${esc(l)}</button>`).join('')}</div>
      <span class="lbl">${h('design.paper')}</span><div class="seg fill" role="group" aria-label="${esc(t('design.paper'))}"><button data-act="d-paper" data-f="us-letter" aria-pressed="${!a4}">${h('paper.letter')}</button><button data-act="d-paper" data-f="a4" aria-pressed="${a4}">${h('paper.a4')}</button></div>
    </div>
    ${manual || r.pageLimit === 0 ? `<p class="note">${manual ? h('design.manualNote', { n: r.pages.length }) : h('design.flowNote')}</p>` : ''}
    <span class="lbl">${h('design.template')}</span>
    <div class="tpls">${TEMPLATES.map(x => `<button class="tpl" data-act="d-tpl" data-t="${x.id}" aria-pressed="${tpl?.id === x.id}" title="${esc(tplNote(x))}"><i class="tpl-${x.id}"></i>${esc(tplName(x))}</button>`).join('')}</div>
    ${tpl.earlier ? `<p class="note">${h('look.earlier', { name: tplName(tpl) })}</p><div class="btns"><button class="sm" data-act="d-earlier">${h('look.earlierBtn', { name: tplName(THEMES[0]) })}</button></div>`
      : `<p class="note">${esc(tplNote(tpl))}</p>`}
    ${tpl.design ? settingsHtml(r, tpl) : ''}
    <span class="lbl">${h('design.theme')}</span>
    <div class="list">${['', ...themes.map(x => x.id)].map(id => { const th = themes.find(x => x.id === id);
      return `<button class="item ${(r.look ?? '') === id ? 'is-cur' : ''}" data-act="d-look" data-id="${esc(id)}"><span>${esc(th ? th.name : t('design.templatesOwn'))}</span><span class="muted small">${th ? h('design.tokensImported', { n: Object.keys(th.tokens).length }) : h('design.builtIn')}</span></button>`; }).join('')}</div>
    ${fontWarn.length ? `<p class="note bad">${h('design.fontWarn', { fonts: fontWarn.join(', '), n: fontWarn.length })}</p>` : ''}
    <div class="btns"><button class="sm" data-act="d-import">${h('design.import')}</button><button class="sm ghost" data-act="d-export">${h('design.export')}</button>${look ? `<button class="sm ghost" data-act="d-drop" data-id="${esc(look.id)}">${h('design.removeX', { name: look.name })}</button>` : ''}</div>
    <div class="kv"><span class="lbl">${h('design.photo')}</span><span class="note">${h('ux6g.photoMoved')} <button class="sm ghost" data-act="select-header">${h('career.step1')}</button></span></div>`;
}

function commit(fn, label, done, undo = false, merge = null){
  try { const ok = C.store.commit(d => { fn(d); }, label, merge); if (ok && done) C.toast(done, '', undo); return ok; }
  catch (e){ C.toast(errText(e), 'bad'); return false; }
}

// The picture goes in the record (basics.image); `show`: and on this resume
export async function setPhoto(file, { show = true } = {}){
  try {
    const data = await cropPhoto(file);
    if (!await askPhotoLocked(C.store.state)) return;
    commit(d => { setRecordPhoto(d.record, data, d.cur); if (show) setResumePhoto(d.record, d.cur, { show: true }); }, t('design.photo'), show ? t('toast.photoAdded') : t('ux6c.photoKept'));
  } catch (e){ C.toast(errText(e), 'bad'); }
}
// The photo slot by the name on the page: the photo is printed on this resume, or not
export function togglePhoto(){
  const on = !C.cur().photo?.show;
  commit(d => setResumePhoto(d.record, d.cur, { show: on }), on ? t('undo.showPhoto') : t('undo.hidePhoto'));
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
    case 'd-set': {
      const { k, v } = tg.dataset;       // a named colour replaces the resume's own, which would hide it
      commit(d => { setDesign(d.cur, lookOf(d.cur), k, v); if (k === 'colour') delete d.cur.accent; }, t(`look.set.${k}`));
      return true;
    }
    case 'd-earlier': {      // an earlier look → B2 Marker with the settings that draw its labels
      const to = THEMES[0], was = lookOf(r);
      if (!was.earlier) return true;
      commit(d => { d.cur.overlays = []; d.cur.theme = 'b2-marker'; for (const [k, v] of Object.entries(was.earlier)) setDesign(d.cur, to, k, v); }, t('undo.template', { name: tplName(to) }));
      return true;
    }
    case 'd-accent': { const c = tg.dataset.c; commit(d => { if (c) d.cur.accent = c; else delete d.cur.accent; }, t('design.accent')); return true; }
    case 'd-look': { const id = tg.dataset.id; commit(d => { if (id) d.cur.look = id; else delete d.cur.look; }, t('design.theme')); return true; }
    case 'd-drop': { const id = tg.dataset.id; commit(d => { d.record.themes = (d.record.themes ?? []).filter(x => x.id !== id); for (const x of [d.cur, ...(d.resumes ?? [])]) if (x.look === id) delete x.look; }, t('undo.removeTheme'), t('toast.themeRemoved'), true); return true; }
    case 'd-import': C.pickFile('theme'); return true;
    case 'd-export': {
      const file = lookOf(r).file;
      const built = await fetch(`themes/${file}.tokens.json`).then(x => x.json()).then(j => K.parseTheme(j).tokens).catch(() => ({}));
      const base = { ...BASE_TOKENS, ...built };
      const tokens = { ...base, ...tokensOf(st().record, r) };
      const name = (st().record.themes ?? []).find(x => x.id === r.look)?.name ?? `${lookOf(r).name}${r.accent ? ` ${r.accent}` : ''}`;   // English name on purpose: it becomes a file name
      C.download(JSON.stringify(K.serialize(name, tokens), null, 2) + '\n', `${name.replace(/[^\p{L}\p{N} _.-]+/gu, ' ').trim()}.tokens.json`);
      C.toast(t('toast.themeExported'));
      return true;
    }
    case 'd-photo': C.pickFile('photo'); return true;
    case 'd-photo-rm': {
      if (!await askPhotoLocked(C.store.state)) return true;
      commit(d => { setRecordPhoto(d.record, null, d.cur); if (d.cur.photo) setResumePhoto(d.record, d.cur, { show: false }); }, t('undo.removePhoto'), t('toast.photoRemoved'), true);
      return true;
    }
    case 'd-shape': { const s = tg.dataset.s; commit(d => setResumePhoto(d.record, d.cur, { shape: s, ...(d.cur.photo ? {} : { show: true }) }), t('design.shape')); return true; }
  }
  return false;
}

function bind(body){
  body.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'd-photo-on'){ const on = el.checked; commit(d => setResumePhoto(d.record, d.cur, { show: on }), on ? t('undo.showPhoto') : t('undo.hidePhoto')); }
    if (el.id === 'd-color'){ const c = el.value; if (/^#[0-9a-f]{6}$/i.test(c)) commit(d => { d.cur.accent = c.toLowerCase(); }, t('design.accent'), null, false, 'accent'); }
  });
}

const api = { views: { design: designView }, act, bind, setPhoto, togglePhoto, askPhoto, importTheme, extraCss: (rec, r) => extraCss(rec, r), tokensOf };
