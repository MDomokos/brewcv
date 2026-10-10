// Actual size: the sheet alone, at its printed size.
// CSS pixels are not physical, so each screen size is calibrated once against a bank card (85.6 mm).
// A page that does not fit scrolls at true scale; it never shrinks.

import { createSheet } from './sheet.js';
import { CARD_MM, NOMINAL_PX_PER_MM, actualScale, calibrationKey, pageSize, PAGE_GAP } from './layout.js';
import { t, h as th } from '../i18n/index.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const store = {
  get(k){ try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: ask again next time */ } },
};

export function openActualSize({ work, recipe, laid, onClose }){
  const key = calibrationKey();
  let pxPerMm = store.get(key)?.pxPerMm ?? null;
  let turn = 0;

  const el = document.createElement('div');
  el.className = 'actual';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('head.actual'));
  el.innerHTML = `
    <div class="actual__bar card">
      <b>${th('head.actual')}</b>
      <span class="muted small" data-k="scale"></span>
      <button class="tool" data-k="ccw" title="${esc(t('actual.rotateLeft'))}" aria-label="${esc(t('actual.rotateLeft'))}">⟲</button>
      <button class="tool" data-k="cw" title="${esc(t('actual.rotateRight'))}" aria-label="${esc(t('actual.rotateRight'))}">⟳</button>
      <button class="tool" data-k="cal">${th('actual.calibrate')}</button>
      <button data-k="close">${th('body.close')} <kbd>Esc</kbd></button>
    </div>
    <div class="actual__scroll"><div class="actual__turn"><div class="actual__host"></div></div></div>
    <div class="actual__cal card" hidden>
      <p>${th('actual.holdCard')}</p>
      <div class="actual__card"></div>
      <input type="range" min="200" max="700" step="0.5" data-k="slider" aria-label="${esc(t('actual.cardWidth'))}">
      <div class="actual__calrow"><span class="muted small" data-k="calnote"></span><button class="primary" data-k="done">${th('actual.matches')}</button></div>
    </div>`;
  document.body.append(el);
  const $ = s => el.querySelector(s);
  const sheet = createSheet($('.actual__host'), {});
  const { w, h } = pageSize(recipe.format);
  const n = laid?.pages?.length ?? 1;

  function place(){
    const s = actualScale(pxPerMm ?? NOMINAL_PX_PER_MM);
    const W = (n * w + (n - 1) * PAGE_GAP) * s, H = h * s;
    const host = $('.actual__host'), tn = $('.actual__turn');
    host.style.transform = `scale(${s})`;
    host.style.width = `${n * w + (n - 1) * PAGE_GAP}px`;
    const sideways = turn % 2 !== 0;
    tn.style.width = `${sideways ? H : W}px`;
    tn.style.height = `${sideways ? W : H}px`;
    host.style.transformOrigin = '0 0';
    tn.style.setProperty('--turn', `${turn * 90}deg`);
    tn.dataset.turn = String(((turn % 4) + 4) % 4);
    const mm = pageSize(recipe.format).mm;
    $('[data-k=scale]').textContent = pxPerMm
      ? t('actual.scale', { w: mm[0], h: mm[1], pct: (s * 100).toFixed(0) })
      : t('actual.notCalibrated');
  }

  function calibrate(open){
    $('.actual__cal').hidden = !open;
    if (!open) return;
    const sl = $('[data-k=slider]');
    sl.value = String((pxPerMm ?? NOMINAL_PX_PER_MM) * CARD_MM);
    const show = () => {
      const px = Number(sl.value);
      $('.actual__card').style.width = `${px}px`;
      $('.actual__card').style.height = `${px * 53.98 / CARD_MM}px`;
      $('[data-k=calnote]').textContent = t('actual.pxPerMm', { n: (px / CARD_MM).toFixed(2) });
    };
    sl.oninput = show; show();
  }

  function close(){
    document.removeEventListener('keydown', onKey, true);
    el.remove();
    onClose?.();
  }
  const onKey = e => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  el.addEventListener('click', e => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k === 'close') close();
    if (k === 'cw'){ turn++; place(); }
    if (k === 'ccw'){ turn--; place(); }
    if (k === 'cal') calibrate(true);
    if (k === 'done'){
      pxPerMm = Number($('[data-k=slider]').value) / CARD_MM;
      store.set(key, { pxPerMm, at: new Date().toISOString().slice(0, 10) });
      calibrate(false); place();
    }
  });

  place();
  if (!pxPerMm) calibrate(true);
  sheet.show(work, laid ?? recipe).then(() => { sheet.setView({ mode: 'spread' }); place(); });
  return { close };
}
