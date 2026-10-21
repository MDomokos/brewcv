// The built-in looks, in the order the Design view lists them: the one place a look is registered.
// `layers`: stylesheets in themes/, the first the base and the rest overlays loaded after it. `id` names the look in the
// picker and in the catalogues (design.tpl.<id>, design.tplNote.<id>); `file` names its tokens file (themes/<file>.tokens.json);
// `name` and `note` are the English of those two strings; `tokenName` is the name written into the tokens file; `extra` are
// tokens a stylesheet can't say (the two switches).
// Add one with `node scripts/new-theme.mjs`, which makes the stylesheet, the line below, the strings and the service worker's
// entries; checks/themes-check.mjs fails until all of them agree.
export const THEMES = [
  { id: 'b2', file: 'b2-marker', layers: ['b2-marker'], name: 'B2 Marker', note: 'The signature look: plain labels with a hairline, the marker on your name and the highlights.', tokenName: 'B2 Marker', extra: { 'tab-style': 'none' } },
  { id: 'marker', file: 'marker-tabs', layers: ['b2-marker', 'marker-tabs'], name: 'Marker tabs', note: 'Every section label on a marker tab in the accent.', tokenName: 'B2 Marker, marker tabs' },
  { id: 'tint', file: 'tint-tabs', layers: ['b2-marker', 'tint-tabs'], name: 'Tinted tabs', note: 'Quieter tabs; the highlights stay strong.', tokenName: 'B2 Marker, tinted tabs' },
  { id: 'aa', file: 'contrast-aa', layers: ['b2-marker', 'contrast-aa'], name: 'High-contrast metadata', note: 'Dates and places darker, for WCAG AA.', tokenName: 'B2 Marker, AA metadata' },
  { id: 'mono', file: 'print-mono', layers: ['b2-marker', 'print-mono'], name: 'Mono print', note: 'For a black-and-white printer: outlined tabs, no colour.', tokenName: 'B2 Marker, mono print', extra: { 'tab-style': 'outline', 'highlight-style': 'none' } },
  { id: 'classic', file: 'classic', layers: ['b2-marker', 'classic'], name: 'Classic', note: 'Centred serif header, labels above a thin rule.', tokenName: 'B2 Marker, Classic' },
  { id: 'dots', file: 'dots', layers: ['b2-marker', 'dots'], name: 'Timeline', note: 'Labels in the margin, a line and a dot for each job.', tokenName: 'B2 Marker, Timeline' },
  { id: 'banner', file: 'banner', layers: ['b2-marker', 'banner'], name: 'Banner', note: 'Your name on a band of colour to the edges on a screen; printed, it stops short of the edge.', tokenName: 'B2 Marker, Banner' },
  { id: 'compact', file: 'compact', layers: ['b2-marker', 'compact'], name: 'Compact', note: 'Smaller type and tighter spacing, for a full page.', tokenName: 'B2 Marker, Compact' },
  { id: 'classic-full', file: 'classic-full', layers: ['b2-marker', 'classic', 'classic-full'], name: 'Classic full width', note: 'Classic with the headings above the text, across the full width.', tokenName: 'B2 Marker, Classic full width' },
  // new looks above this line (scripts/new-theme.mjs)
];

// Stylesheets of looks folded into another, kept (empty) so a resume saved with one still opens and exports.
export const RETIRED = ['quiet-tabs'];
