// Language menu: the languages in use, each with how many texts it lacks, then "+ Add a language…".

import { LANGS } from '../model/schema.js';
import { langName } from '../model/lang.js';
import { t, h } from '../i18n/index.js';
import { icon } from './icons.js';
import { delBtn } from './parts.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// count(l): texts missing in l, or null to show nothing.
export function langMenuHtml({ for: who, current, inUse, count = () => null, more = false, label = t('lang.menu'), removable = [] }){
  const others = LANGS.filter(l => !inUse.includes(l));
  const row = l => {
    const n = count(l);
    const note = n == null ? '' : n ? h('lang.toWrite', { n }) : h('lang.complete');
    return `<button role="menuitemradio" aria-checked="${l === current}" data-act="lang" data-for="${who}" data-lang="${l}" lang="${l}"><span>${l === current ? `${icon('check', { role: 'inline' })} ` : ''}${esc(langName(l))}</span><small>${note}</small></button>`;
  };
  return `<div class="pop card langpop" role="menu" aria-label="${esc(label)}" data-menu="${who}">
    ${inUse.map(row).join('')}
    ${current && !inUse.includes(current) ? `<button role="menuitemradio" aria-checked="true" data-act="lang" data-for="${who}" data-lang="${current}" class="off"><span>${icon('check', { role: 'inline' })} ${esc(langName(current))}</span><small>${h('lang.notInList')}</small></button>` : ''}
    ${others.length ? `<hr>${more
      ? `<div class="pop__sub">${h('lang.addHead')}</div>${others.map(l => `<button role="menuitem" data-act="lang-add" data-for="${who}" data-lang="${l}" lang="${l}"><span>+ ${esc(langName(l))}</span></button>`).join('')}`
      : `<button role="menuitem" data-act="lang-more" data-for="${who}"><span>${h('lang.add')}</span><small>${h('lang.more', { n: others.length })}</small></button>`}` : ''}
    ${removable.length ? `<hr><div class="pop__sub">${h('ux6c.removeLangHead')}</div>${removable.map(({ lang: l, why }) => delBtn(`data-act="lang-remove" data-for="${who}" data-lang="${l}" lang="${l}" ${why ? `aria-disabled="true" title="${esc(t(why))}"` : ''}`, langName(l), { row: true }).replace('</button>', `${why ? `<small>${esc(t(why))}</small>` : ''}</button>`)).join('')}` : ''}
  </div>`;
}

// Arrow keys, Home and End inside a menu. Returns true when it handled the key.
export function menuKey(e){
  const menu = e.target.closest?.('[role=menu]');
  if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return false;
  const items = [...menu.querySelectorAll('[role^=menuitem]:not([disabled])')];
  if (!items.length) return false;
  const at = items.indexOf(e.target);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  e.preventDefault();
  items[next].focus();
  return true;
}
export const focusMenu = sel => setTimeout(() => document.querySelector(`${sel} [role^=menuitem][aria-checked=true], ${sel} [role^=menuitem]`)?.focus(), 0);
