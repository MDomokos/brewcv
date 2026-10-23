// Enter and Space press a .press control (workbench.css) the way the pointer does: the browser gives :active to Space on a button, not to Enter,
// and a row that is not a button gets neither. The look is the class's; this only holds it down while the key is.
//
// The sidebar's buttons take their tier from their role (UX-6 sidebar, audit (b)), said once here rather than on every button: .primary is the
// primary (one a view at most), a delete (.del, parts.js delBtn) is destructive, a ghost, an icon or a chip is tertiary, any other button secondary.
// A button that already names its tier keeps it. A tertiary with no words is an icon tool (data-icon): a quiet frame, where a tertiary with words is a link.
// OWN are the controls with a look of their own that says what they are (segments, templates, swatches, the rows and their parts, the tabs, the
// crumb and its tools, menu and list rows); checks/sidebar-check.mjs (tiers) names every control's tier or look, and its layer.
export const OWN = '.seg button, .menu button, .sopt, .tpl, .swatch, .item, .dp-l, .dp-t, .rowlock, .clcaret, .osecaret, .clt, .clname, .ptab, .rtabs .tab, .logo, .meter, .ihpage, .vrow, .ddopt, .hedit, .snapline, .swnew, .row, .srow, [role=option], [role=tab], [role^=menuitem]';
const TERTIARY = '.ghost, .ib, .clv, .keep, .smore, .docname, .x, .kset, .tool';
export const tierOf = b => (b.classList.contains('primary') ? 'primary' : b.classList.contains('del') ? 'destructive' : b.matches(TERTIARY) ? 'tertiary' : 'secondary');
export function tierAll(root){
  for (const b of root.querySelectorAll('button:not(.press), button[data-autotier]')){
    if (b.matches(OWN)) continue;
    const tier = tierOf(b);
    if (b.dataset.tier !== tier){ b.classList.add('press'); b.dataset.autotier = ''; b.dataset.tier = tier; }      // re-read when a class changes (Fit turns primary in place)
  }
  for (const b of root.querySelectorAll('button.press[data-tier=tertiary]')) b.toggleAttribute('data-icon', !b.textContent.trim());
}
// the sidebar, the Library and Career (#scr), the search bar, the toast, and what is added to the page's end (the dialogs, the shortcut sheet)
function watch(root){ tierAll(root); new MutationObserver(() => tierAll(root)).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); }

export function initPress(){
  const el = e => e.target.closest?.('.press');
  document.addEventListener('keydown', e => { if ((e.key === ' ' || (e.key === 'Enter' && !e.target.matches?.('input'))) && !e.repeat) el(e)?.classList.add('is-down'); });      // Enter does not tick a box
  const up = e => el(e)?.classList.remove('is-down');
  document.addEventListener('keyup', up);
  document.addEventListener('focusout', up);
  for (const r of [...['col', 'scr', 'find', 'toast', 'help'].map(id => document.getElementById(id)), ...document.querySelectorAll('dialog')]) if (r) watch(r);
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeName === 'DIALOG' || n.id === 'help') watch(n); }).observe(document.body, { childList: true });
}
