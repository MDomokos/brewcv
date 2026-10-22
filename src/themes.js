// The built-in looks, in the order the Design view lists them: the one place a look is registered.
// `layers`: stylesheets in themes/, the first the base and the rest overlays loaded after it. `id` names the look in the
// picker and in the catalogues (design.tpl.<id>, design.tplNote.<id>); `file` names its tokens file (themes/<file>.tokens.json);
// `name` and `note` are the English of those two strings; `tokenName` is the name written into the tokens file; `extra` are
// tokens a stylesheet can't say (the two switches).
// `design`: what the Design view's settings offer on this look (src/model/design.js reads it; a look without one offers none).
// `presets` and `fonts` list the section styles and font pairings offered, and leave out the key when every one is; `preset` and
// `font` are the defaults (`preset: null`: the look's labels are no section style's); `sizes` are the body sizes in px where the look's own differ (medium is its own size, small is left
// out); `centred` is a header centred over the page, `ownRule` a look that draws its own rule under each heading, `inkRule` one
// whose rule is ink. The renderer (centred) and designCss (the rest) are the only readers.
// Add one with `node scripts/new-theme.mjs`, which makes the stylesheet, the line below, the strings and the service worker's
// entries; checks/themes-check.mjs fails until all of them agree.
const B2_DESIGN = { preset: 'quiet', font: 'hanken' };
const OLD_DESIGN = { ...B2_DESIGN, preset: null };      // Tinted tabs and Mono print draw labels no section style does: none is the default
const CLASSIC_DESIGN = { presets: ['quiet', 'markerLines'], preset: 'quiet', fonts: ['source'], font: 'source', centred: true };
export const THEMES = [
  { id: 'b2', file: 'b2-marker', layers: ['b2-marker'], name: 'B2 Marker', note: 'The signature look: plain labels with a hairline, the marker on your name and the highlights.', tokenName: 'B2 Marker', extra: { 'tab-style': 'none' }, design: B2_DESIGN },
  { id: 'marker', file: 'marker-tabs', layers: ['b2-marker', 'marker-tabs'], name: 'Marker tabs', note: 'Every section label on a marker tab in the accent.', tokenName: 'B2 Marker, marker tabs' },
  { id: 'tint', file: 'tint-tabs', layers: ['b2-marker', 'tint-tabs'], name: 'Tinted tabs', note: 'Quieter tabs; the highlights stay strong.', tokenName: 'B2 Marker, tinted tabs', design: OLD_DESIGN },
  { id: 'aa', file: 'contrast-aa', layers: ['b2-marker', 'contrast-aa'], name: 'High-contrast metadata', note: 'Dates and places darker, for WCAG AA.', tokenName: 'B2 Marker, AA metadata', design: B2_DESIGN },
  { id: 'mono', file: 'print-mono', layers: ['b2-marker', 'print-mono'], name: 'Mono print', note: 'For a black-and-white printer: outlined tabs, no colour.', tokenName: 'B2 Marker, mono print', extra: { 'tab-style': 'outline', 'highlight-style': 'none' }, design: OLD_DESIGN },
  { id: 'classic', file: 'classic', layers: ['b2-marker', 'classic'], name: 'Classic', note: 'Centred serif header, labels above a thin rule.', tokenName: 'B2 Marker, Classic', design: { ...CLASSIC_DESIGN, inkRule: true } },
  { id: 'dots', file: 'dots', layers: ['b2-marker', 'dots'], name: 'Timeline', note: 'Labels in the margin, a line and a dot for each job.', tokenName: 'B2 Marker, Timeline', design: { preset: 'bare', font: 'hanken' } },
  { id: 'banner', file: 'banner', layers: ['b2-marker', 'banner'], name: 'Banner', note: 'Your name on a band of colour to the edges on a screen; printed, it stops short of the edge.', tokenName: 'B2 Marker, Banner', design: { preset: 'underlined', font: 'hanken' } },
  { id: 'compact', file: 'compact', layers: ['b2-marker', 'compact'], name: 'Compact', note: 'Smaller type and tighter spacing, for a full page.', tokenName: 'B2 Marker, Compact' },
  { id: 'classic-full', file: 'classic-full', layers: ['b2-marker', 'classic', 'classic-full'], name: 'Classic full width', note: 'Classic with the headings above the text, across the full width.', tokenName: 'B2 Marker, Classic full width', design: { ...CLASSIC_DESIGN, sizes: { medium: 13, large: 13.6 }, ownRule: true } },
  // new looks above this line (scripts/new-theme.mjs)
];

// Stylesheets of looks folded into another, kept (empty) so a resume saved with one still opens and exports.
export const RETIRED = ['quiet-tabs'];

// The look a resume has: the entry whose overlays are the resume's, a retired one (an empty stylesheet now) left out so a resume saved
// with Quiet tabs shows as B2 Marker. B2 Marker when none match.
export const lookOf = r => THEMES.find(x => JSON.stringify(x.layers.slice(1)) === JSON.stringify((r?.overlays ?? []).filter(o => !RETIRED.includes(o)))) ?? THEMES[0];
