// The few line icons the app uses, drawn on a 16px grid with one stroke. Pure strings. The tea pictograms (steep, latte, cupout,
// recordbook) are the tabs' icons while the drink is tea; the plain set (list, edit, design, export, timeline) is Coffee's.
// Every use sits in a button that has its own name, so the drawing itself is hidden from a screen reader.
// Icon design language (docs: Icon Design Language): one grid, one set, monochrome (currentColor); four roles by job (inline 12, control 16,
// header 24, display 44), a stroke drawn in screen pixels per drink and role (drinks.css --ic-sw-*); one concept, one icon, everywhere (CONCEPT).

export const ICONS = {
  edit: '<path d="M3 13l.7-3L11 2.7a1.4 1.4 0 0 1 2 0l.3.3a1.4 1.4 0 0 1 0 2L6 12.3z"/><path d="M9.6 4.2l2.2 2.2"/>',
  design: '<circle cx="8" cy="8" r="5.6"/><circle cx="5.4" cy="7" r=".8"/><circle cx="8" cy="4.8" r=".8"/><circle cx="10.6" cy="7" r=".8"/><path d="M6 11.4c.6.8 3.6.8 4-.2.4-1.2-1-1.4-1.6-1.4"/>',
  export: '<path d="M8 2.4v7.4M5 7l3 3 3-3M3 13h10"/>',
  left: '<path d="M10 3 5 8l5 5"/>',
  right: '<path d="M6 3l5 5-5 5"/>',
  minus: '<path d="M3.4 8h9.2"/>',
  plus: '<path d="M3.4 8h9.2M8 3.4v9.2"/>',
  full: '<path d="M2.6 6V2.6H6M10 2.6h3.4V6M13.4 10v3.4H10M6 13.4H2.6V10"/>',
  fitpage: '<rect x="4.2" y="2.4" width="7.6" height="11.2" rx="1.4"/>',
  undo: '<path d="M5.6 3.4 2.6 6.4l3 3"/><path d="M3 6.4h6a3.6 3.6 0 0 1 0 7.2H6.4"/>',
  redo: '<path d="M10.4 3.4l3 3-3 3"/><path d="M13 6.4H7a3.6 3.6 0 0 0 0 7.2h2.6"/>',
  caret: '<path d="M5 6.4l3 3 3-3"/>',
  up: '<path d="M5 9.6l3-3 3 3"/>',
  grip: '<circle cx="6" cy="4" r=".9"/><circle cx="10" cy="4" r=".9"/><circle cx="6" cy="8" r=".9"/><circle cx="10" cy="8" r=".9"/><circle cx="6" cy="12" r=".9"/><circle cx="10" cy="12" r=".9"/>',
  photo: '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="m3.5 11.5 3-3.5 2.5 2.5 1.5-1.5 2 2.5"/><circle cx="10.5" cy="5.5" r="1"/>',
  help: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.4M8 11.3v.1"/>',
  timeline: '<path d="M5 2.6v10.8M5 4.4h7M5 8h5M5 11.6h6.5"/><circle cx="5" cy="4.4" r=".9"/><circle cx="5" cy="8" r=".9"/><circle cx="5" cy="11.6" r=".9"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  compare: '<path d="M3 5.4h9.6M10 3l2.6 2.4L10 7.8M13 10.6H3.4M6 8.2l-2.6 2.4L6 13"/>',
  pin: '<path d="M9.4 2.6l4 4-1.5.8-2 2 .2 2.1-.9.9-2.5-2.5L3.4 13M6.1 6l.9-.9"/>',
  external: '<path d="M6.6 3.5H3.5v9h9V9.4M9.4 3.5h3.1v3.1M12.5 3.5 7.4 8.6"/>',
  replay: '<path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.6v2.7h-2.7"/>',
  more: '<circle cx="3.6" cy="8" r=".9"/><circle cx="8" cy="8" r=".9"/><circle cx="12.4" cy="8" r=".9"/>',
  warn: '<path d="M8 2.8l5.6 9.8H2.4z"/><path d="M8 6.8v2.8M8 11.3v.1"/>',
  lock: '<rect x="3.6" y="7" width="8.8" height="6.4" rx="1.2"/><path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7"/>',
  unlock: '<rect x="3.6" y="7" width="8.8" height="6.4" rx="1.2"/><path d="M5.4 7V5.2a2.6 2.6 0 0 1 4.9-1.2"/>',
  check: '<path d="M3.4 8.4 6.6 11.4l6-6.6"/>',
  teacup: '<path d="M2.5 6.5h9v2.8a3.6 3.6 0 0 1-3.6 3.6H6.1a3.6 3.6 0 0 1-3.6-3.6z"/><path d="M11.5 7.4h.8a1.6 1.6 0 0 1 0 3.2h-1"/><path d="M5.5 2.2c-.6.8.6 1.4 0 2.4M8.2 2.2c-.6.8.6 1.4 0 2.4"/>',
  list: '<path d="M5.4 3.6h8M5.4 8h8M5.4 12.4h8"/><circle cx="2.6" cy="3.6" r=".6"/><circle cx="2.6" cy="8" r=".6"/><circle cx="2.6" cy="12.4" r=".6"/>',
  steep: '<path d="M2.6 8.4h9.2v2.2a3.4 3.4 0 0 1-3.4 3.4H6a3.4 3.4 0 0 1-3.4-3.4z"/><path d="M11.8 9.2h.7a1.4 1.4 0 0 1 0 2.8h-1"/><path d="M7.2 1.6v2.8"/><path d="M5.4 4.4h3.6l-.5 4H5.9z"/>',
  latte: '<circle cx="8" cy="8" r="5.8"/><path d="M8 11.4c-2.6-1.5-3.4-2.6-3.4-3.7 0-1 .8-1.7 1.7-1.7.8 0 1.4.5 1.7 1 .3-.5.9-1 1.7-1 .9 0 1.7.7 1.7 1.7 0 1.1-.8 2.2-3.4 3.7z"/>',
  cupout: '<path d="M2.6 3.4h7.4v1.6H2.6z"/><path d="M3.2 5l.7 8.4h4.8L9.4 5"/><path d="M10.8 9.2h3.4M12.8 7.4l1.8 1.8-1.8 1.8"/>',
  recordbook: '<path d="M3.2 2.6h8.2a1 1 0 0 1 1 1v9.8H4.2a1 1 0 0 1-1-1z"/><path d="M3.2 12.4a1 1 0 0 1 1-1h8.2"/><path d="M6 9.4c0-2.6 1.6-4 4.4-4 0 2.6-1.6 4-4.4 4z"/><path d="M6 9.4l2.4-2.4"/>',
  checkcircle: '<circle cx="8" cy="8" r="6"/><path d="M5.2 8.2l2 2 3.6-4"/>',
  document: '<path d="M4 2.2h5l3 3v8.6H4z"/><path d="M9 2.2v3h3M6 8.4h4M6 10.8h4"/>',
  plane: '<path d="M13.6 2.4 2.4 7l4 1.8 1.8 4.8z"/><path d="M6.4 8.8l7.2-6.4"/>',
  archive: '<rect x="2.4" y="3" width="11.2" height="3.2" rx=".8"/><path d="M3.4 6.2v6.4h9.2V6.2M6.4 9h3.2"/>',
  brewed: '<path d="M3 7.4h8.6v2.4a3.8 3.8 0 0 1-3.8 3.8H6.8A3.8 3.8 0 0 1 3 9.8z"/><path d="M11.6 8.2h.9a1.7 1.7 0 0 1 0 3.4h-1.3M2 14.6h11.6"/><path class="steam" d="M5.2 2.4c-.7.9.7 1.5 0 2.7"/><path class="steam" d="M7.4 1.6c-.7 1 .7 1.7 0 3.1"/><path class="steam" d="M9.6 2.4c-.7.9.7 1.5 0 2.7"/>',
  espresso: '<path d="M4 6.5h6.5l-.6 5.2a1.4 1.4 0 0 1-1.4 1.3H6a1.4 1.4 0 0 1-1.4-1.3z"/><path d="M10.4 7.6h.9a1.4 1.4 0 0 1 0 2.8h-1.2"/><path d="M3 14.5h9"/>',
  revert: '<path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.6v2.7h2.7"/>',
  saving: '<path d="M13 8a5 5 0 1 1-5-5"/>',
  search: '<circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4 14 14"/>',
  zoomin: '<circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4 14 14M5 7h4M7 5v4"/>',
  zoomout: '<circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4 14 14M5 7h4"/>',
  lines: '<path d="M3 4h10M3 8h10M3 12h6.5"/>',
  star: '<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>',
  // Career's kinds (src/ui/career.js): one icon per kind, shared with the Outline's sections
  work: '<path d="M2 5h12v8.5H2z"/><path d="M6 5V3.3h4V5M2 8.5h12"/>',
  education: '<path d="M1 6.2 8 3l7 3.2-7 3.2z"/><path d="M4 7.6v3.2c2.2 1.6 5.8 1.6 8 0V7.6M15 6.2v4"/>',
  project: '<path d="M8 1.6l5.6 3v6.8L8 14.4l-5.6-3V4.6z"/><path d="M2.4 4.6 8 7.6l5.6-3M8 7.6v6.8"/>',
  publications: '<path d="M4 1.6h5.4L12 4.2v10.2H4z"/><path d="M9.4 1.6v2.6H12M6 8h4M6 10.6h4"/>',
  skills: '<path d="M10.2 2.2a3.4 3.4 0 0 0-3.9 4.5L2 11l3 3 4.3-4.3a3.4 3.4 0 0 0 4.5-3.9l-2 2-2.3-.6-.6-2.3z"/>',
  languages: '<path d="M2.5 3h11v7.5H8L4.8 13v-2.5H2.5z"/><path d="M5.3 6.6h5.4M5.3 8.4h3.4"/>',
  certificates: '<circle cx="8" cy="6.2" r="3.8"/><path d="M5.6 9.2 4.6 14.4 8 12.6l3.4 1.8-1-5.2"/><path d="m6.6 6.2 1 1 1.9-2"/>',
  awards: '<path d="M5 2.2h6v3.6a3 3 0 0 1-6 0zM5 3.4H2.6v1a2.4 2.4 0 0 0 2.6 2.4M11 3.4h2.4v1A2.4 2.4 0 0 1 10.8 6.8M8 8.8v2.8M5.4 14h5.2M6.4 11.6h3.2v2.4H6.4z"/>',
  interests: '<circle cx="8" cy="8" r="6"/><path d="m10.6 5.4-1.6 3.6-3.6 1.6 1.6-3.6z"/>',
  references: '<path d="M2.6 3.4h4.2v4.2c0 2.4-1.2 4-3.4 5"/><path d="M9.2 3.4h4.2v4.2c0 2.4-1.2 4-3.4 5"/>',
  about: '<circle cx="8" cy="5.6" r="2.8"/><path d="M2.6 14c.6-3 2.8-4.6 5.4-4.6s4.8 1.6 5.4 4.6"/>',
  heart: '<path d="M8 13.6S2 10 2 5.9A3 3 0 0 1 8 4.6a3 3 0 0 1 6 1.3C14 10 8 13.6 8 13.6z"/>',
  flag: '<path d="M3.5 14.5V2M3.5 2.5h8.5l-2 3 2 3H3.5"/>',
  mic: '<rect x="5.8" y="1.6" width="4.4" height="7.6" rx="2.2"/><path d="M3.4 7.6a4.6 4.6 0 0 0 9.2 0M8 12.2v2.2"/>',
  dot: '<circle cx="8" cy="8" r="4.2"/>',
};
ICONS.frame = ICONS.photo;      // the old name of the picture frame: a saved custom kind may still hold it

// The registry: an idea -> its one icon. A call site that means the idea asks for it by name (icon('delete')); a bare icon name is for decoration.
// Delete and close share the X and differ by the control's tier (destructive or not). checks/icon-check.mjs reads this table.
export const CONCEPT = {
  delete: 'close', close: 'close', edit: 'edit', revert: 'revert', undo: 'undo', redo: 'redo', lock: 'lock', unlock: 'unlock', add: 'plus', more: 'more',
  pin: 'pin', focus: 'star', search: 'search', help: 'help', zoomIn: 'zoomin', zoomOut: 'zoomout', compare: 'compare', warn: 'warn', ok: 'check',
  saving: 'saving', replay: 'replay', photo: 'photo', summary: 'lines', person: 'about',
};

// The four roles, by job: inline 12 (carets, locks, marks in rows), control 16 (toolbar, menus, tags), header 24 (rail tabs, band headers), display 44.
export const ROLE = { inline: 12, control: 16, header: 24, display: 44 };
// The old { size: N } maps to the nearest role: 10-12 inline, 13-18 control, 19-34 header, above that display.
const roleOf = n => (n <= 12 ? 'inline' : n <= 18 ? 'control' : n <= 34 ? 'header' : 'display');

export const icon = (name, { role, size } = {}) => {
  const px = ROLE[role ?? (size ? roleOf(size) : 'control')];
  return `<svg class="ico" viewBox="0 0 16 16" width="${px}" height="${px}" aria-hidden="true" focusable="false">${ICONS[CONCEPT[name] ?? name] ?? ''}</svg>`;
};

// A button's words that begin with ← or end with → (the catalogues keep the glyphs): the glyph is drawn as the `left` / `right` icon instead.
export const withArrows = html => html.replace(/^← /, `${icon('left', { role: 'inline' })} `).replace(/ →$/, ` ${icon('right', { role: 'inline' })}`);
