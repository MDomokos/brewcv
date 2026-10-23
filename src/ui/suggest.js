// Suggestions under a text field, in the app's own card (UX-6f): a <datalist>'s popup cannot take the drink's tokens. An input with
// data-suggest='["a","b"]' offers the entries that contain what is typed (at most eight, not the one already typed); a pick fills the field and
// presses Enter in it, which is what its form does with a typed value. Nothing is offered until something is typed; ↓ asks for the whole list and moves into it, ↑ ↓ move, Esc closes. The list never takes the
// focus from the field when it is clicked.

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let open = null;      // { input, el }
const words = input => { try { return JSON.parse(input.dataset.suggest); } catch { return []; } };

function close(){ open?.el.remove(); open = null; }
function show(input, all = false){
  const q = input.value.trim().toLowerCase();
  if (!q && !all) return close();      // nothing typed: nothing offered (↓ asks for the whole list)
  const list = words(input).filter(w => w.toLowerCase().includes(q) && w.toLowerCase() !== q).slice(0, 8);
  if (!list.length || !input.isConnected) return close();
  if (open?.input !== input){ close(); open = { input, el: Object.assign(document.createElement('div'), { className: 'pop card ddpop sgpop' }) }; open.el.setAttribute('role', 'listbox'); open.el.setAttribute('aria-label', input.getAttribute('aria-label') ?? ''); document.body.append(open.el); }
  open.el.innerHTML = list.map(w => `<button type="button" role="option" class="press ddopt" data-tier="tertiary" data-v="${esc(w)}" tabindex="-1"><span>${esc(w)}</span></button>`).join('');
  const r = input.getBoundingClientRect();
  Object.assign(open.el.style, { minWidth: `${Math.round(r.width)}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - open.el.offsetWidth - 8))}px`, top: `${r.bottom + 4 + open.el.offsetHeight > innerHeight ? Math.max(8, r.top - 4 - open.el.offsetHeight) : r.bottom + 4}px` });
}

export function initSuggest(){
  document.addEventListener('input', e => { const i = e.target.closest?.('[data-suggest]'); if (i) show(i); });
  document.addEventListener('focusin', e => { if (open && !e.target.closest?.('.sgpop') && e.target !== open.input) close(); });
  document.addEventListener('mousedown', e => { if (e.target.closest?.('.sgpop')) e.preventDefault(); else if (open && !e.target.closest?.('[data-suggest]')) close(); });
  document.addEventListener('click', e => {
    const b = e.target.closest?.('.sgpop .ddopt');
    if (!b || !open) return;
    const { input } = open;
    input.value = b.dataset.v;
    close();
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  document.addEventListener('keydown', e => {
    if (!open){
      const i = e.target.closest?.('[data-suggest]');
      if (i && e.key === 'ArrowDown' && !e.isComposing){ e.preventDefault(); show(i, true); if (open) open.el.querySelector('.ddopt')?.focus(); }
      return;
    }
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); const i = open.input; close(); i.focus(); return; }
    const items = [...open.el.querySelectorAll('.ddopt')], at = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault(); e.stopPropagation();
      const to = at + (e.key === 'ArrowDown' ? 1 : -1);
      if (to < 0) open.input.focus(); else items[Math.min(items.length - 1, to)].focus();
    } else if (at >= 0 && e.key === 'Tab'){ const i = open.input; close(); i.focus(); }      // Tab goes on from the field
  }, true);
  new MutationObserver(() => { if (open && !open.input.isConnected) close(); }).observe(document.body, { childList: true, subtree: true });      // the form was drawn again: the field the list belongs to is gone
  globalThis.addEventListener?.('resize', close);
  document.addEventListener('scroll', e => { if (open && !e.target.closest?.('.sgpop')) close(); }, true);
  return { close };
}
