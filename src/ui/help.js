// The shortcut sheet: every key the editor answers to, in one place instead of a hint under every panel.
// It opens from the ? key or the first row of the bar's "?" menu (src/ui/shell.js, appMenuHtml; a phone's "?" corner).

import { t, h } from '../i18n/index.js';
import { icon } from './icons.js';

let C = null, el = null, opener = null;

// Ctrl is ⌘ on a Mac, Alt is ⌥ and Shift ⇧ (the keys are the same; the names are not)
export const isMac = () => /Mac|iPhone|iPad|iPod/.test(globalThis.navigator?.platform ?? '');
const MAC = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧' };
// A key named by its character is the key that types it, so Ctrl+Z is the key printed Z on QWERTZ and AZERTY. Where that key types
// none of the app's letters or symbols (0 is à on AZERTY and é on Czech, − is ß on German, a letter Cyrillic), the key in the
// character's US place stands in. A key that writes a character is never a shortcut: Option or Alt, AltGr (Ctrl+Alt on Windows; ś, @
// and \ on Polish and German), a dead key.
export const writes = e => e.altKey || e.key === 'Dead' || !!e.getModifierState?.('AltGraph');
const PLACE = { '-': ['Minus', 'NumpadSubtract'], '+': ['Equal', 'NumpadAdd'], '\\': ['Backslash', 'IntlBackslash'] };
const SAID = ['-', '_', '+', '=', '0', '?', '/', '\\'];
const placeOf = c => PLACE[c] ?? (/^\d$/.test(c) ? [`Digit${c}`, `Numpad${c}`] : /^[a-z]$/.test(c) ? [`Key${c.toUpperCase()}`] : []);
export function isKey(e, ...cs){
  if (writes(e)) return false;
  const k = e.key?.length === 1 ? e.key.toLowerCase() : e.key;
  if (cs.includes(k)) return true;
  if (/^[a-z]$/.test(k) || SAID.includes(k)) return false;
  return cs.some(c => placeOf(c).includes(e.code));
}
// The keys that stand for a place, not a character (W E R in a row, the one by Enter), named as this keyboard prints them where the
// browser tells it (Chromium); elsewhere the US key
const PRINTED = { W: 'KeyW', E: 'KeyE', R: 'KeyR', '\\': 'Backslash' };
let layout = null;
try { globalThis.navigator?.keyboard?.getLayoutMap?.().then(m => { layout = m; }, () => {}); } catch { /* none */ }
const name = k => (isMac() && MAC[k]) || layout?.get(PRINTED[k])?.toUpperCase() || k;
// the same keys as plain text, for a tooltip: ⌥↑ on a Mac, Alt+↑ elsewhere
export const keyText = (...keys) => keys.map(name).join(isMac() ? '' : '+');
const K = (...keys) => keys.map(k => `<kbd>${name(k)}</kbd>`).join(' ');
// [keys, i18n key]
const groups = () => [
  ['ux2.helpPage', [[K('↑', '↓'), 'ux2.k.walk'], [K('←', '→'), 'ux2.k.versions'], [K('Enter'), 'ux2.k.edit'], [K('Enter'), 'ux6c.k.nextLine'], [K('Shift', 'Enter'), 'ux6c.k.lineBreak'], [K('Alt'), 'hl.k.drag'], [K('Ctrl', 'Shift', 'H'), 'hl.k.key'], [K('↑', '↓'), 'ux6f.k.grip'], [K('Esc'), 'ux2.k.esc']]],
  ['ux2.helpPanel', [[K('W'), 'ux6h.k.library'], [K('E'), 'ux6h.k.editor'], [K('R'), 'ux3b.k.record'], [K('Alt', '↑') + ' ' + K('Alt', '↓'), 'ux2.k.moveSection'], [K('Ctrl', 'O'), 'ux2.k.switcher'], [K('Ctrl', 'F') + ' ' + K('/'), 'ux6f.k.find'], [K('?'), 'ux2.k.help']]],
  ['ux2.helpView', [[K('-') + ' ' + K('+'), 'ux2.k.zoom'], [K('0'), 'ux2.k.fit'], [K('F11'), 'ux2.k.full'], [K('Shift', 'F'), 'm11.k.drink'], [K('Ctrl', '\\'), 'uxs.k.side']]],
  ['ux2.helpFile', [[K('Ctrl', 'Z') + ' ' + K('Ctrl', 'Shift', 'Z'), 'ux2.k.undo'], [K('Ctrl', 'S'), 'ux2.k.save']]],
];

function html(){
  return `<div class="helphead"><h2 id="help-h">${h('ux2.helpTitle')}</h2><button class="ghost sm" data-act="help-close" aria-label="${t('body.close')}">${icon('close')}</button></div>
    ${groups().map(([g, rows]) => `<h3 class="lbl">${h(g)}</h3><dl class="keys">${rows.map(([k, key]) => `<div><dt>${k}</dt><dd>${h(key)}</dd></div>`).join('')}</dl>`).join('')}`;
}

function open(from = null){
  if (!el) return;
  opener = from ?? document.activeElement;
  el.innerHTML = html();
  el.hidden = false;
  el.querySelector('[data-act=help-close]')?.focus();
}
function close(){
  if (!el || el.hidden) return false;
  el.hidden = true; el.innerHTML = '';
  (opener?.isConnected ? opener : document.querySelector('#rail [data-act=menu], [data-act=corner]'))?.focus?.();
  return true;
}

export function initHelp(ctx){
  C = ctx;
  el = document.createElement('div');
  el.id = 'help'; el.className = 'card help'; el.hidden = true;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false'); el.setAttribute('aria-labelledby', 'help-h');
  document.body.append(el);
  el.addEventListener('click', e => { if (e.target.closest('[data-act=help-close]')) close(); });
  el.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); } });
  return {
    open, close, toggle: () => (el.hidden ? open() : close()), get isOpen(){ return !el.hidden; },
  };
}
