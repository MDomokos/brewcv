// The shortcut sheet: every key the editor answers to, in one place instead of a hint under every panel.
// It opens from the ? button or the ? key, and once by itself the first time something on the page is selected.

import { t, h } from '../i18n/index.js';
import { icon } from './icons.js';

let C = null, el = null, opener = null;
const SEEN_KEY = 'rb-help-seen';
const seen = () => { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* shown again next time */ } };

const K = (...keys) => keys.map(k => `<kbd>${k}</kbd>`).join(' ');
// [keys, i18n key]
const GROUPS = [
  ['ux2.helpPage', [[K('↑', '↓'), 'ux2.k.walk'], [K('←', '→'), 'ux2.k.versions'], [K('Enter'), 'ux2.k.edit'], [K('Ctrl', 'Enter'), 'ux2.k.saveEdit'], [K('Esc'), 'ux2.k.esc']]],
  ['ux2.helpPanel', [[K('E'), 'ux2.k.panel'], [K('Alt', '↑') + ' ' + K('Alt', '↓'), 'ux2.k.moveSection'], [K('Ctrl', 'O'), 'ux2.k.switcher'], [K('?'), 'ux2.k.help']]],
  ['ux2.helpView', [[K('-') + ' ' + K('='), 'ux2.k.zoom'], [K('0'), 'ux2.k.fit'], [K('F'), 'ux2.k.full'], [K('Shift', 'F'), 'm11.k.drink']]],
  ['ux2.helpFile', [[K('Ctrl', 'Z') + ' ' + K('Ctrl', 'Shift', 'Z'), 'ux2.k.undo'], [K('Ctrl', 'S'), 'ux2.k.save']]],
];

function html(){
  return `<div class="helphead"><h2 id="help-h">${h('ux2.helpTitle')}</h2><button class="ghost sm" data-act="help-close" aria-label="${t('body.close')}">${icon('close')}</button></div>
    ${GROUPS.map(([g, rows]) => `<h3 class="lbl">${h(g)}</h3><dl class="keys">${rows.map(([k, key]) => `<div><dt>${k}</dt><dd>${h(key)}</dd></div>`).join('')}</dl>`).join('')}`;
}

function open(from = null){
  if (!el) return;
  opener = from ?? document.activeElement;
  el.innerHTML = html();
  el.hidden = false;
  markSeen();
  el.querySelector('[data-act=help-close]')?.focus();
}
function close(){
  if (!el || el.hidden) return false;
  el.hidden = true; el.innerHTML = '';
  (opener?.isConnected ? opener : document.querySelector('[data-act=help]'))?.focus?.();
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
    // the first time something on the page is selected
    firstTime(){ if (!seen()) open(null); },
  };
}
