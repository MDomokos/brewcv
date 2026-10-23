// The depth chip's level lists (UX-6f 4c), on the page and in the card alike (parts.js depthHtml): a level with deeper ones lists its children,
// the version tag's way (onpage.js openVers). It opens on hover, on focus, with Alt+↓ (or ↓) from the level, and on a long press by touch (a tap goes
// up, as the word does); it opens on the child the selection came through. ↑ ↓ Home End move, Enter chooses (dp-open, the Outline's row act: it selects
// that block), Esc closes and gives the focus back to the level, Tab and leaving close it. The chip never grows: the list is a popover under its
// level (over it where the window has no room below), never wider than the sidebar's column. Only the card's chip has lists; on the page a word
// goes up.
const HOLD = 500;      // a long press, ms
let open = null, quiet = false, held = 0, pressT = 0;      // open: { wrap, list, btn, how }

const wrapOf = el => el?.closest?.('.depth .dpwrap');
const opts = l => [...l.querySelectorAll('.dpopt')];
function mark(o){
  if (!open || !o) return;
  for (const x of open.list.querySelectorAll('.dpopt.act')) x.classList.remove('act');
  o.classList.add('act'); open.list.setAttribute('aria-activedescendant', o.id);
  o.scrollIntoView({ block: 'nearest' });
}
function show(wrap, how){
  const focus = how === 'key' || how === 'touch';
  if (open?.wrap === wrap){ if (focus){ open.how = how; open.list.focus({ preventScroll: true }); } return; }      // already open: a key or a long press only takes it over
  hide();
  const list = wrap.querySelector('.dplist'), btn = wrap.querySelector('.dp-l');
  if (!list || !btn) return;
  open = { wrap, list, btn, how };
  list.hidden = false; btn.setAttribute('aria-expanded', 'true');
  list.classList.remove('up'); list.style.left = ''; list.style.maxWidth = '';
  const col = wrap.closest('.col')?.getBoundingClientRect(), lo = col ? col.left + 8 : 8, hi = Math.min(innerWidth, col ? col.right : innerWidth) - 8;      // the card's list stays in the sidebar's column
  list.style.maxWidth = `${Math.min(300, hi - lo)}px`;
  const r = list.getBoundingClientRect();
  if (r.bottom > innerHeight - 8 && r.top - r.height - btn.offsetHeight > 8) list.classList.add('up');      // no room below: over the level
  if (r.right > hi || r.left < lo) list.style.left = `${Math.max(lo - r.left, Math.min(0, hi - r.right))}px`;
  mark(list.querySelector('.dpopt.cur') ?? opts(list)[0]);
  if (focus) list.focus({ preventScroll: true });
}
function hide({ back = false } = {}){
  if (!open) return;
  const { list, btn } = open;
  open = null;
  if (list.isConnected){ list.hidden = true; list.removeAttribute('aria-activedescendant'); }
  btn.setAttribute('aria-expanded', 'false');
  if (back && btn.isConnected){ quiet = true; btn.focus({ preventScroll: true }); quiet = false; }      // the focus coming back does not open it again
}

export function bindDepthMenu(){
  document.addEventListener('pointermove', e => { const w = e.pointerType === 'mouse' && wrapOf(e.target); if (w && !held && open?.wrap !== w) show(w, 'hover'); });      // the pointer moved onto it (a chip drawn under a resting pointer opens nothing)
  document.addEventListener('mouseout', e => { if (open && open.how === 'hover' && !open.wrap.contains(e.relatedTarget)) hide(); });
  document.addEventListener('focusin', e => {
    if (open && !open.wrap.contains(e.target)) hide();
    const w = !quiet && e.target.matches?.('.dp-l[aria-haspopup]:focus-visible') && wrapOf(e.target);      // the keyboard's focus (a click on the word goes up, and opens nothing)
    if (w) show(w, 'focus');
  });
  document.addEventListener('keydown', e => {
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.altKey && e.key === 'ArrowDown' && e.target.matches?.('.depth .dp-l[aria-haspopup]')){ stop(); show(wrapOf(e.target), 'key'); return; }
    if (!open) return;
    const { list } = open, os = opts(list), at = Math.max(0, os.findIndex(o => o.classList.contains('act')));
    if (e.key === 'Escape' && (e.target === list || e.target === open.btn)){ stop(); hide({ back: true }); return; }
    if (e.target !== list) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ stop(); mark(os[Math.min(os.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))]); }
    else if (e.key === 'Home' || e.key === 'End'){ stop(); mark(os[e.key === 'Home' ? 0 : os.length - 1]); }
    else if (e.key === 'Enter' || e.key === ' '){ stop(); const o = os[at]; hide(); o?.click(); }
    else if (e.key === 'Tab') hide();
  }, true);
  // touch: a long press on a level with a list opens it (and the tap it ends in does not go up); a tap elsewhere closes it
  document.addEventListener('pointerdown', e => {
    if (open && !open.wrap.contains(e.target)) hide();
    const w = e.pointerType === 'touch' && e.target.closest?.('.dp-l[aria-haspopup]') && wrapOf(e.target);
    clearTimeout(pressT);
    if (w) pressT = setTimeout(() => { held = performance.now(); show(w, 'touch'); }, HOLD);
  });
  for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => clearTimeout(pressT));
  document.addEventListener('click', e => { if (held && performance.now() - held < 1500 && e.target.closest?.('.dp-l')){ e.preventDefault(); e.stopPropagation(); } held = 0; }, true);
  document.addEventListener('contextmenu', e => { if (e.target.closest?.('.dp-l[aria-haspopup]')) e.preventDefault(); });      // the long press is the list's, not the browser's menu
}
