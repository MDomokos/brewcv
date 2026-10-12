// The few line icons the app uses, drawn on a 16px grid with one stroke. Pure strings. The tea pictograms (leaf, teapot,
// served cup) are the rail's modes while the drink is tea; the two cups are the drink corner's.
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
  caret: '<path d="M5 6.4l3 3 3-3"/>',
  help: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.4M8 11.3v.1"/>',
  timeline: '<path d="M5 2.6v10.8M5 4.4h7M5 8h5M5 11.6h6.5"/><circle cx="5" cy="4.4" r=".9"/><circle cx="5" cy="8" r=".9"/><circle cx="5" cy="11.6" r=".9"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  trash: '<path d="M3 4.6h10M6.4 4.6V3h3.2v1.6M4.4 4.6l.6 8.4h6l.6-8.4M6.9 7v3.8M9.1 7v3.8"/>',
  compare: '<path d="M3 5.4h9.6M10 3l2.6 2.4L10 7.8M13 10.6H3.4M6 8.2l-2.6 2.4L6 13"/>',
  pin: '<path d="M9.4 2.6l4 4-1.5.8-2 2 .2 2.1-.9.9-2.5-2.5L3.4 13M6.1 6l.9-.9"/>',
  external: '<path d="M6.6 3.5H3.5v9h9V9.4M9.4 3.5h3.1v3.1M12.5 3.5 7.4 8.6"/>',
  replay: '<path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.6v2.7h-2.7"/>',
  more: '<circle cx="3.6" cy="8" r=".9"/><circle cx="8" cy="8" r=".9"/><circle cx="12.4" cy="8" r=".9"/>',
  warn: '<path d="M8 2.8l5.6 9.8H2.4z"/><path d="M8 6.8v2.8M8 11.3v.1"/>',
  check: '<path d="M3.4 8.4 6.6 11.4l6-6.6"/>',
  leaf: '<path d="M3 13C3 7.5 6.5 3 13 3c0 6.5-4.5 10-10 10z"/><path d="M3 13l6.5-6.5"/>',
  teapot: '<path d="M3.5 7.5h8v2.2a3.8 3.8 0 0 1-3.8 3.8h-.4a3.8 3.8 0 0 1-3.8-3.8z"/><path d="M11.5 8.6c1.4-.6 2.6.2 2.4 1.6-.2 1.2-1.3 1.8-2.6 1.6"/><path d="M3.5 9 1.6 7.2"/><path d="M5.8 7.5V6h3.4v1.5M7.5 6V4.8"/>',
  cupserved: '<path d="M3 7.5h8.5v2.6a3.4 3.4 0 0 1-3.4 3.4H6.4A3.4 3.4 0 0 1 3 10.1z"/><path d="M11.5 8.4h.7a1.5 1.5 0 0 1 0 3h-.9"/><path d="M6 2.4c-.6.8.6 1.5 0 2.5M8.6 2.4c-.6.8.6 1.5 0 2.5"/>',
  teacup: '<path d="M2.5 6.5h9v2.8a3.6 3.6 0 0 1-3.6 3.6H6.1a3.6 3.6 0 0 1-3.6-3.6z"/><path d="M11.5 7.4h.8a1.6 1.6 0 0 1 0 3.2h-1"/><path d="M5.5 2.2c-.6.8.6 1.4 0 2.4M8.2 2.2c-.6.8.6 1.4 0 2.4"/>',
  update: '<path d="M3.4 8.4 6.6 11.4l6-6.6"/>',
  copyplus: '<rect x="2.6" y="5.4" width="7.6" height="8" rx="1.2"/><path d="M5.8 3.2h6.4a1.2 1.2 0 0 1 1.2 1.2v6.4M6.4 9.4h3.2M8 7.8V11"/>',
  onlyhere: '<rect x="4.2" y="2.4" width="7.6" height="11.2" rx="1.4"/><circle cx="8" cy="8" r="1.7"/>',
  record: '<path d="M3.4 3.6h9.2M3.4 8h9.2M3.4 12.4h9.2"/><circle cx="1.9" cy="3.6" r=".5"/><circle cx="1.9" cy="8" r=".5"/><circle cx="1.9" cy="12.4" r=".5"/>',
  espresso: '<path d="M4 6.5h6.5l-.6 5.2a1.4 1.4 0 0 1-1.4 1.3H6a1.4 1.4 0 0 1-1.4-1.3z"/><path d="M10.4 7.6h.9a1.4 1.4 0 0 1 0 2.8h-1.2"/><path d="M3 14.5h9"/>',
};

export const icon = (name, { size = 16 } = {}) =>
  `<svg class="ico" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" focusable="false">${P[name] ?? ''}</svg>`;
export const ICON_NAMES = Object.keys(P);
