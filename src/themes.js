// The built-in looks, in the order the Design view lists them: the one place a look is registered.
// `layers`: stylesheets in themes/, the first the base and the rest overlays loaded after it. `id` names the look in the
// picker and in the catalogues (design.tpl.<id>, design.tplNote.<id>); `file` names its tokens file (themes/<file>.tokens.json);
// `name` and `note` are the English of those two strings; `tokenName` is the name written into the tokens file; `extra` are
// tokens a stylesheet can't say (the two switches).
// Add one with `node scripts/new-theme.mjs`, which makes the stylesheet, the line below, the strings and the service worker's
// entries; checks/themes-check.mjs fails until all of them agree.
export const THEMES = [
  { id: 'b2', file: 'b2-marker', layers: ['b2-marker'], name: 'B2 Marker', note: 'The signature look: marker tabs and highlights.', tokenName: 'B2 Marker' },
  { id: 'tint', file: 'tint-tabs', layers: ['b2-marker', 'tint-tabs'], name: 'Tinted tabs', note: 'Quieter tabs; the highlights stay strong.', tokenName: 'B2 Marker, tinted tabs' },
  { id: 'aa', file: 'contrast-aa', layers: ['b2-marker', 'contrast-aa'], name: 'High-contrast metadata', note: 'Dates and places darker, for WCAG AA.', tokenName: 'B2 Marker, AA metadata' },
  { id: 'mono', file: 'print-mono', layers: ['b2-marker', 'print-mono'], name: 'Mono print', note: 'For a black-and-white printer: outlined tabs, no colour.', tokenName: 'B2 Marker, mono print', extra: { 'tab-style': 'outline', 'highlight-style': 'none' } },
  // new looks above this line (scripts/new-theme.mjs)
];
