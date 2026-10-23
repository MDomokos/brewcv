// The shortcut sheet: every key the editor answers to, in one place instead of a hint under every panel.
// It opens from the ? key or the first row of the sidebar's "?" corner (src/ui/shell.js, cornerHtml).

import { t, h } from '../i18n/index.js';
import { icon } from './icons.js';

let C = null, el = null, opener = null;

// Ctrl is ⌘ on a Mac, and Alt is ⌥ (the keys are the same; the names are not)
export const isMac = () => /Mac|iPhone|iPad|iPod/.test(globalThis.navigator?.platform ?? '');
const MAC = { Ctrl: '⌘', Alt: '⌥' };
// the same keys as plain text, for a tooltip: ⌥↑ on a Mac, Alt+↑ elsewhere
export const keyText = (...keys) => keys.map(k => (isMac() ? (MAC[k] ?? k) : k)).join(isMac() ? '' : '+');
const K = (...keys) => keys.map(k => `<kbd>${isMac() ? (MAC[k] ?? k) : k}</kbd>`).join(' ');
// [keys, i18n key]
const groups = () => [
  ['ux2.helpPage', [[K('↑', '↓'), 'ux2.k.walk'], [K('←', '→'), 'ux2.k.versions'], [K('Enter'), 'ux2.k.edit'], [K('Enter'), 'ux6c.k.nextLine'], [K('Shift', 'Enter'), 'ux6c.k.lineBreak'], [K('↑', '↓'), 'ux6f.k.grip'], [K('Esc'), 'ux2.k.esc']]],
  ['ux2.helpPanel', [[K('W'), 'ux6h.k.library'], [K('E'), 'ux6h.k.editor'], [K('R'), 'ux3b.k.record'], [K('Alt', '↑') + ' ' + K('Alt', '↓'), 'ux2.k.moveSection'], [K('Ctrl', 'O'), 'ux2.k.switcher'], [K('Ctrl', 'F') + ' ' + K('/'), 'ux6f.k.find'], [K('?'), 'ux2.k.help']]],
  ['ux2.helpView', [[K('-') + ' ' + K('='), 'ux2.k.zoom'], [K('0'), 'ux2.k.fit'], [K('F11'), 'ux2.k.full'], [K('Shift', 'F'), 'm11.k.drink'], [K('Ctrl', '\\'), 'uxs.k.side']]],
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
  (opener?.isConnected ? opener : document.querySelector('[data-act=corner]'))?.focus?.();
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
