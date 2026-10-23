// The select, in the app's own menu (UX-6f). A native <select>'s open list cannot take the drink's tokens (the browser, or on a Mac the system,
// draws it), so every select in the app is shown as a button that opens a listbox in the app's own card, in Tea and Coffee, light and dark.
// The <select> stays in the page, hidden, and is still the field: forms read its value, the app listens for its `change`, a test can read its
// options. A pick sets the select and fires `input` and `change` on it, so nothing that used a select needed to change. A select added to the
// page later (a form drawn again) is dressed by the observer; one that goes takes its button with it.
// Keys: the button opens on Enter, Space, ↓ or ↑; in the list ↑ ↓ Home End move, a letter jumps to the next option that starts with it, Enter or
// Space picks, Esc closes and returns to the button, Tab closes and moves on.

import { icon } from './icons.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let seq = 0, open = null;      // open: { sel, btn, el }

// the field's name: its aria-label, or the text of its label without the select's own words
function nameOf(sel){
  if (sel.getAttribute('aria-label')) return sel.getAttribute('aria-label');
  const lab = sel.labels?.[0];
  if (!lab) return '';
  const c = lab.cloneNode(true);
  for (const x of c.querySelectorAll('select, .ddbtn')) x.remove();
  return c.textContent.replace(/\s+/g, ' ').trim();
}
const rows = sel => [...sel.options];

function paint(sel){
  const btn = sel._dd;
  if (!btn) return;
  const o = sel.selectedOptions[0], text = o?.textContent.trim() ?? '', name = nameOf(sel);
  btn.innerHTML = `<span class="ddt">${esc(text)}</span><span class="ddc" aria-hidden="true">${icon('caret', { role: 'inline' })}</span>`;
  btn.setAttribute('aria-label', name ? `${name}: ${text}` : text);
  btn.disabled = sel.disabled;
  if (o?.lang) btn.lang = o.lang; else btn.removeAttribute('lang');
}

function enhance(sel){
  if (sel._dd || sel.multiple || sel.size > 1 || sel.hasAttribute('data-native')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ddbtn press';
  btn.dataset.tier = 'secondary';
  btn.dataset.ddf = sel.id || `dd${++seq}`;
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  sel._dd = btn;
  sel.focus = o => btn.focus(o);      // code that focuses the select (a row drawn again) lands on its button
  sel.before(btn);       // before the select: a label around both belongs to the button
  sel.hidden = true;
  sel.dataset.dd = '';
  paint(sel);
}
const release = sel => { if (open?.sel === sel) close(false); sel._dd?.remove(); sel._dd = null; };

function close(refocus = true){
  if (!open) return;
  const { btn, el } = open;
  open = null;
  el.remove();
  btn.setAttribute('aria-expanded', 'false');
  if (refocus && btn.isConnected) btn.focus();
}
function place(){
  const { btn, el } = open, r = btn.getBoundingClientRect();
  el.style.minWidth = `${Math.round(r.width)}px`;
  const below = innerHeight - r.bottom - 8, h = el.offsetHeight, up = h > below && r.top - 8 > below;
  el.style.maxHeight = `${Math.max(120, Math.min(innerHeight * .6, up ? r.top - 8 : below))}px`;
  const eh = Math.min(h, parseFloat(el.style.maxHeight));
  el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8))}px`;
  el.style.top = `${up ? Math.max(8, r.top - 4 - eh) : r.bottom + 4}px`;
}
function show(btn){
  const sel = btn.nextElementSibling;
  if (!sel?._dd || sel._dd !== btn) return;
  if (open){ const same = open.btn === btn; close(false); if (same) return; }
  paint(sel);
  const opt = (o, i) => `<button type="button" role="option" class="press ddopt" data-tier="tertiary" data-i="${i}" data-v="${esc(o.value)}" aria-selected="${o.selected}" ${o.disabled ? 'disabled' : ''} ${o.lang ? `lang="${esc(o.lang)}"` : ''}><span>${esc(o.textContent.trim())}</span>${o.selected ? icon('check', { role: 'inline' }) : ''}</button>`;
  let i = 0, html = '';
  for (const c of sel.children){
    if (c.tagName === 'OPTGROUP'){ html += `<div role="group" aria-label="${esc(c.label)}"><div class="pop__sub" aria-hidden="true">${esc(c.label)}</div>${[...c.children].map(o => opt(o, i++)).join('')}</div>`; }
    else html += opt(c, i++);
  }
  const el = Object.assign(document.createElement('div'), { className: 'pop card ddpop', innerHTML: html });
  el.setAttribute('role', 'listbox');
  el.setAttribute('aria-label', nameOf(sel) || btn.textContent.trim());
  (btn.closest('dialog, #switcher') ?? document.body).append(el);      // a modal dialog is above everything else, and a click outside the name window closes it: the list is inside them
  open = { sel, btn, el };
  btn.setAttribute('aria-expanded', 'true');
  place();
  el.querySelector('[aria-selected=true]:not(:disabled), .ddopt:not(:disabled)')?.focus({ preventScroll: true });
  el.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
}
function pick(b){
  const { sel } = open, o = rows(sel)[Number(b.dataset.i)];
  close();
  if (!o || o.disabled) return;
  const changed = sel.selectedIndex !== o.index;
  sel.selectedIndex = o.index;
  paint(sel);
  if (changed){ sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
}

export function initDropdowns(){
  for (const s of document.querySelectorAll('select')) enhance(s);
  new MutationObserver(list => {
    for (const m of list){
      for (const n of m.removedNodes) if (n.nodeType === 1) for (const s of n.matches('select') ? [n] : n.querySelectorAll('select')) if (s._dd && !s.isConnected) release(s);
      for (const n of m.addedNodes) if (n.nodeType === 1) for (const s of n.matches('select') ? [n] : n.querySelectorAll('select')) enhance(s);
      const s = m.target.closest?.('select');      // its options or its disabled changed
      if (s?._dd) paint(s);
    }
    for (const b of document.querySelectorAll('.ddbtn')) if (!b.nextElementSibling?._dd || b.nextElementSibling._dd !== b) b.remove();      // the select went and left its button (an outerHTML swap)
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  document.addEventListener('change', e => { if (e.target._dd) paint(e.target); });
  document.addEventListener('click', e => {
    const b = e.target.closest?.('.ddbtn'), o = e.target.closest?.('.ddopt');
    if (o && open?.el.contains(o)) return pick(o);
    if (b) return show(b);
    if (open && !open.el.contains(e.target)) close(false);
  });
  document.addEventListener('keydown', e => {
    const k = e.key;
    if (!open){
      const b = e.target.closest?.('.ddbtn');
      if (b && !e.isComposing && ['ArrowDown', 'ArrowUp'].includes(k)){ e.preventDefault(); e.stopPropagation(); show(b); }
      return;
    }
    if (k === 'Tab'){ const b = open.btn; close(false); b.focus(); return; }      // Tab goes on from the button, as it does from an open select
    e.stopPropagation();      // while the list is open the page's own keys (letters, Esc) belong to it
    if (k === 'Escape'){ e.preventDefault(); close(); return; }
    const items = [...open.el.querySelectorAll('.ddopt:not(:disabled)')], at = items.indexOf(document.activeElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[k];
    if (to !== undefined && items.length){ e.preventDefault(); items[Math.max(0, Math.min(items.length - 1, to))].focus({ preventScroll: false }); return; }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && k !== ' '){      // type ahead: the next option that starts with the letter
      const n = items.length, next = [...items.slice(at + 1), ...items.slice(0, at + 1)].find(x => x.textContent.trim().toLowerCase().startsWith(k.toLowerCase()));
      if (next){ e.preventDefault(); next.focus(); }
    }
  }, true);
  globalThis.addEventListener?.('resize', () => close(false));
  document.addEventListener('scroll', e => { if (open && !open.el.contains(e.target)) close(false); }, true);
  return { close, get isOpen(){ return !!open; } };
}
