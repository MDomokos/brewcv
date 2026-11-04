// "What are you drinking today?" Two settings, both per browser, both in localStorage like the app's other settings:
//   rb-drink  tea (the default) | coffee: which look the app wears
//   rb-theme  system (the default) | light | dark: html[data-theme] is always the resolved light or dark
// src/ui/drink-boot.js has already put both on <html> before the first paint; this module keeps them and switches in place (no reload, nothing redrawn but the marks inside the page's frame).
// The resume is never touched: it prints the same in every drink and theme.

import { t } from '../i18n/index.js';
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
  if (applied && root && !reduced() && !document.querySelector('.matroll')){   // the mat's roll already carries a drink switch; fading every element too made it hitch
    clearTimeout(switchT);
    root.classList.add('is-switching'); void root.offsetWidth;
    switchT = setTimeout(() => root.classList.remove('is-switching'), dur('slow') + 80);
  }
  applied = true;
  root?.setAttribute('data-drink', state.drink);
  root?.setAttribute('data-theme', resolveTheme(state.pref));
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

// The bare mark (the logo without its tile), its cream in the ink of where it sits: the brand in the app's bar, which goes home
const MARK = {
  tea: '<path d="M302.2 223.3 L333.8 152.7 A37.5 37.5 0 0 1 405.5 168.0 L405.5 236" fill="none" stroke="#D9A65A" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><rect x="374.5" y="236" width="62" height="68" rx="12" fill="#D9A65A"/><path d="M398.5 252 C390.5 252 391.5 262 391.5 266 C391.5 269 388.5 270 384.5 270 C388.5 270 391.5 271 391.5 275 C391.5 279 390.5 288 398.5 288 M412.5 252 C420.5 252 419.5 262 419.5 266 C419.5 269 422.5 270 426.5 270 C422.5 270 419.5 271 419.5 275 C419.5 279 420.5 288 412.5 288" fill="none" stroke="#2E4636" stroke-width="6" stroke-linecap="round"/>',
  coffee: '<path d="M318 148 C304 134 332 124 318 108 C306 94 324 84 318 70 M356 148 C342 134 370 124 356 108 C344 94 362 84 356 70" fill="none" stroke="#BE7F4A" stroke-width="9" stroke-linecap="round"/><ellipse cx="405.5" cy="270" rx="29" ry="38" transform="rotate(-24 405.5 270)" fill="#BE7F4A"/><path d="M395 238 C410 256 399 276 416 302" fill="none" stroke="#3A2618" stroke-width="7" stroke-linecap="round"/>',
};
const VEE = '<path d="M168 168 L268 392 L368 168" fill="none" stroke="currentColor" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"/><path d="M132.4 215.8 A48 48 0 1 0 162.4 283.0" fill="none" stroke="currentColor" stroke-width="30" stroke-linecap="round"/><path d="M140 446 L396 446" fill="none" stroke="currentColor" stroke-width="20" stroke-linecap="round" opacity="0.55"/>';
export const markHtml = () => `<svg class="mark" viewBox="80 15 380 400" width="24" height="24" aria-hidden="true" focusable="false"><g transform="translate(9.5 -41.0)">${MARK[state.drink] ?? MARK.tea}${VEE}</g></svg>`;

// The logo is the switch: a button that says what it will do (its hint), and src/ui/matroll.js shows the mat starting to go. `base` is
// the class that sizes it where it sits (the header, the start screen's own).
export function logoBtn(size = 28, { base = 'logo', pos = 'b' } = {}){
  const to = state.drink === 'tea' ? 'coffee' : 'tea', k = to === 'coffee' ? 'ux4.logoToCoffee' : 'ux4.logoToTea';
  return `<button type="button" class="${base} logoswitch" data-act="drink-switch" data-to="${to}" data-tip="${esc(t(k))}|${esc(t(`${k}Tip`))}" data-tip-pos="${pos}" aria-label="${esc(t(k))}"><img src="${logoSrc()}" alt="" width="${size}" height="${size}"></button>`;
}

// Shift+F, unless a field or an editable line has the keyboard
export function isDrinkKey(e){
  if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.getModifierState?.('AltGraph') || String(e.key).toLowerCase() !== 'f') return false;
  return !e.target?.closest?.('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, .ddbtn, [contenteditable=""], [contenteditable=true]');
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
    requestAnimationFrame(() => {        // after the logos (and the bar's mark) have been drawn again in tea
      for (const img of document.querySelectorAll('.logoswitch img, #rail .brand .mark')){ img.classList.remove('dunk'); void img.offsetWidth; img.classList.add('dunk'); img.addEventListener('animationend', () => img.classList.remove('dunk'), { once: true }); }
    });
  });
  apply();
}
