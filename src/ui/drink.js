// "What are you drinking today?" Two settings, both per browser, both in localStorage like the app's other settings:
//   rb-drink  tea (the default) | coffee: which look the app wears
//   rb-theme  system (the default) | light | dark: html[data-theme] is always the resolved light or dark
// src/ui/drink-boot.js has already put both on <html> before the first paint; this module keeps them, draws the corner that
// asks the question, and switches in place (no reload, nothing redrawn but the marks inside the page's frame).
// The resume is never touched: it prints the same in every drink and theme.

import { t, h } from '../i18n/index.js';
import { icon } from './icons.js';
import { reduced, dur } from './motion.js';

export const DRINKS = ['tea', 'coffee'];
export const THEMES = ['system', 'light', 'dark'];
const DRINK_KEY = 'rb-drink', THEME_KEY = 'rb-theme';
const root = globalThis.document?.documentElement;      // none in Node: checks import dock.js, which imports this
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const get = (k, ok, def) => { try { const v = localStorage.getItem(k); return ok(v) ? v : def; } catch { return def; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* this session only */ } };

export const readDrink = () => get(DRINK_KEY, v => DRINKS.includes(v), 'tea');
export const readThemePref = () => get(THEME_KEY, v => THEMES.includes(v), 'system');
const prefersDark = () => !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;
export const resolveTheme = pref => (pref === 'dark' || (pref === 'system' && prefersDark()) ? 'dark' : 'light');

let state = { drink: readDrink(), pref: readThemePref() };
const listeners = new Set();
export const drink = () => state.drink;
export const themePref = () => state.pref;
export const onDrinkChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
// told (from, to) just before the attribute changes, so a layer can take what the old drink looks like (src/ui/matroll.js)
const beforeListeners = new Set();
export const onDrinkBefore = fn => { beforeListeners.add(fn); return () => beforeListeners.delete(fn); };
// the logo is the drink's own: the tea tile or the coffee tile
export const logoSrc = () => `icons/${state.drink === 'coffee' ? 'icon-coffee' : 'icon'}.svg`;

let applied = false, switchT = 0;
function apply(){
  // a switch after the first: while it settles, colours fade and shapes (corners, edges, shadows) morph (src/ui/drinks.css, html.is-switching)
  if (applied && root && !reduced()){
    clearTimeout(switchT);
    root.classList.add('is-switching'); void root.offsetWidth;
    switchT = setTimeout(() => root.classList.remove('is-switching'), dur('slow') + 80);
  }
  applied = true;
  root?.setAttribute('data-drink', state.drink);
  root?.setAttribute('data-theme', resolveTheme(state.pref));
  paint();
  for (const fn of listeners) fn(state);
}
export function setDrink(d){
  if (!DRINKS.includes(d) || d === state.drink) return false;
  for (const fn of beforeListeners) fn(state.drink, d);
  state = { ...state, drink: d }; set(DRINK_KEY, d); apply();
  return true;
}
export function setThemePref(p){
  if (!THEMES.includes(p) || p === state.pref) return false;
  state = { ...state, pref: p }; set(THEME_KEY, p); apply();
  return true;
}
export const toggleDrink = () => setDrink(state.drink === 'tea' ? 'coffee' : 'tea');

// The logo is the switch: a button that says what it will do (its hint), and src/ui/matroll.js shows the mat starting to go. `base` is
// the class that sizes it where it sits (the header, the rail, the start screen's own).
export function logoBtn(size = 28, { base = 'logo', pos = 'b' } = {}){
  const to = state.drink === 'tea' ? 'coffee' : 'tea', k = to === 'coffee' ? 'ux4.logoToCoffee' : 'ux4.logoToTea';
  return `<button type="button" class="${base} logoswitch" data-act="drink-switch" data-to="${to}" data-tip="${esc(t(k))}|${esc(t(`${k}Tip`))}" data-tip-pos="${pos}" aria-label="${esc(t(k))}"><img src="${logoSrc()}" alt="" width="${size}" height="${size}"></button>`;
}

// ---- the corner ----
let corner = null;
function paint(){
  if (!corner) return;
  for (const b of corner.querySelectorAll('button[data-drink]')) b.setAttribute('aria-pressed', String(b.dataset.drink === state.drink));
}
export function renderCorner(){
  if (!corner){
    corner = document.createElement('aside');                       // a landmark of its own: the question
    corner.id = 'brewmode'; corner.className = 'brewmode';
    corner.setAttribute('aria-labelledby', 'bm-q');
    corner.addEventListener('click', e => { const b = e.target.closest('button[data-drink]'); if (b) setDrink(b.dataset.drink); });
    document.body.append(corner);
  }
  const q = t('m11.question');
  const cup = (d, ic, name, hint) => `<button data-drink="${d}" aria-pressed="${state.drink === d}" aria-label="${esc(`${q} ${name}`)}" data-tip="${esc(name)}|${esc(hint)}" data-tip-pos="r">${icon(ic, { size: 20 })}<span>${esc(name)}</span></button>`;
  corner.innerHTML = `<p class="bm-q" id="bm-q">${h('m11.question')}</p>
    <div class="bm-row">${cup('tea', 'teacup', t('m11.tea'), t('m11.teaHint'))}${cup('coffee', 'espresso', t('m11.coffee'), t('m11.coffeeHint'))}</div>
    <kbd aria-hidden="true">⇧F</kbd>`;
}

// Shift+F, unless a field or an editable line has the keyboard
export function isDrinkKey(e){
  if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || String(e.key).toLowerCase() !== 'f') return false;
  return !e.target?.closest?.('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, [contenteditable=""], [contenteditable=true]');
}

export function initDrink(){
  // the system's light or dark, followed while the choice is System
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (state.pref === 'system') apply(); });
  // another tab changed it
  addEventListener('storage', e => {
    if (e.key !== DRINK_KEY && e.key !== THEME_KEY) return;
    state = { drink: readDrink(), pref: readThemePref() }; apply();
  });
  // the tea bag dunks when the drink becomes tea (a tea moment: not in coffee)
  onDrinkChange(st => {
    if (st.drink !== 'tea') return;
    requestAnimationFrame(() => {        // after the logos have been drawn again in the tea tile
      for (const img of document.querySelectorAll('.logoswitch img')){ img.classList.remove('dunk'); void img.offsetWidth; img.classList.add('dunk'); img.addEventListener('animationend', () => img.classList.remove('dunk'), { once: true }); }
    });
  });
  renderCorner();
  apply();
}
