// The few line icons the rail and the zoom bar use, drawn on a 16px grid with one stroke. Pure strings.
// Every use sits in a button that has its own name, so the drawing itself is hidden from a screen reader.

const P = {
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
  pages1: '<rect x="4.4" y="2.4" width="7.2" height="11.2" rx="1.2"/>',
  pages2: '<rect x="1.8" y="3.4" width="5.6" height="9.2" rx="1"/><rect x="8.6" y="3.4" width="5.6" height="9.2" rx="1"/>',
  caret: '<path d="M5 6.4l3 3 3-3"/>',
  help: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.4M8 11.3v.1"/>',
  timeline: '<path d="M5 2.6v10.8M5 4.4h7M5 8h5M5 11.6h6.5"/><circle cx="5" cy="4.4" r=".9"/><circle cx="5" cy="8" r=".9"/><circle cx="5" cy="11.6" r=".9"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
};

export const icon = (name, { size = 16 } = {}) =>
  `<svg class="ico" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" focusable="false">${P[name] ?? ''}</svg>`;
export const ICON_NAMES = Object.keys(P);
