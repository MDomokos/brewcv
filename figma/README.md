# Figma theme kit

A theme in BrewCV is a set of **design tokens**: colour, type, sizes and a few switches. It never changes layout, so a theme made in Figma can't break the page fit. This folder describes the round trip:

1. **Export.** In the app, *Design › Export this theme*. This downloads `<theme>.tokens.json` in [DTCG](https://www.designtokens.org/) 2025.10 format, every token with its `$type`.
2. **Import into Figma as Variables.**
   - If your Figma plan has native variable import (announced at Schema 2025, rolling out), use *Local variables › Import*. **This path isn't tested here yet.**
   - Otherwise use a free plugin that reads DTCG into Variables, for example [Tokens Studio](https://tokens.studio) or [Variables Import](https://github.com/davo/figma-variables-import). **Neither has been tested here yet.** Record the one that works below.
3. **Edit the Variables.** The kit file shows one Letter page and one A4 page built from components bound to these Variables, filled with the fictional example career. Changing a Variable restyles the kit, so you can judge a theme before exporting it.
4. **Export from Figma as DTCG** with the same plugin, or natively.
5. **Drop the file on the app** (or *Design › Import a theme*). The theme appears under *Design › Theme* as imported, applied to the open resume. Anything that isn't one of the tokens below, or isn't a safe value, is ignored and named in the message. A font the app doesn't have files for is flagged, and the page shows Hanken Grotesk instead until the font files are added.

**The kit file:** *(link here once it's built; it's made by hand in Figma)*

**Plugin tested:** *(not yet)*

## Variable names

The Figma Variable names must match the DTCG paths exactly (a group per dot). This is the whole list; the app ignores anything else.

| DTCG path | $type | token | what it sets |
|---|---|---|---|
| `color.accent` | color | `accent` | `--accent` |
| `color.tab` | color | `tab` | `--tab-fill` |
| `color.highlight` | color | `highlight` | `--highlight` |
| `color.ink` | color | `ink` | `--ink` |
| `color.ink-body` | color | `ink-body` | `--ink-body`, `--ink-summary` |
| `color.muted` | color | `muted` | `--muted` |
| `color.meta` | color | `meta` | `--meta` |
| `color.tab-ink` | color | `tab-ink` | `--tab-ink` |
| `color.page` | color | `page` | `--paper` |
| `font.body.family` | fontFamily | `font-body` | `--font-sans` |
| `font.mono.family` | fontFamily | `font-mono` | `--font-mono` |
| `font.name.family` | fontFamily | `font-name` | `--font-name` |
| `font.heading.family` | fontFamily | `font-heading` | `--font-heading` |
| `font.name.weight` | fontWeight | `weight-name` | `--weight-name` |
| `font.heading.weight` | fontWeight | `weight-heading` | `--weight-heading` |
| `size.name` | dimension | `size-name` | `--fs-name` |
| `size.heading` | dimension | `size-heading` | `--fs-role` |
| `size.body` | dimension | `size-body` | `--fs-bullet` |
| `size.meta` | dimension | `size-meta` | `--fs-meta` |
| `line-height.body` | number | `line-height-body` | `--lh-bullet` |
| `tracking.label` | dimension | `tracking-label` | `--ls-tab` |
| `space.section` | dimension | `section-gap` | `--band-gap` |
| `space.bullet` | dimension | `bullet-gap` | `--bullet-gap` |
| `space.gutter` | dimension | `gutter` | `--gutter-gap` |
| `space.margin` | dimension | `margin` | `--page-pad-t`, `--page-pad-r`, `--page-pad-b`, `--page-pad-l` |
| `radius.tab` | dimension | `tab-radius` | `--tab-radius` |
| `style.tab` | string | `tab-style` | a rule (switch) |
| `style.highlight` | string | `highlight-style` | a rule (switch) |

- **Colours** are written as DTCG 2025.10 colour objects (`colorSpace`, `components`, `hex`). The app also reads a plain `"#rrggbb"`.
- **Aliases** such as `"{color.accent}"` are kept as links: in B2 Marker, `color.tab` follows `color.accent`, so changing the accent moves the tabs too.
- **Switches** are strings:
  - `style.tab`: `solid`, `underline`, `outline` or `none`
  - `style.highlight`: `marker`, `bold` or `none`
- **The four built-in themes** are in `themes/*.tokens.json`, written by `node scripts/tokens.mjs` from their stylesheets. They are working examples of the format.

## Also accepted

A CSS file whose `:root` sets `--doc-<token>` properties, or `{ "name": …, "tokens": { … } }`, with the token names from the third column. See `src/model/tokens.js`.

## Not in scope

Layout changes from Figma (a template plugin) are not built yet. The one-way route into Figma (export the HTML page, then html.to.design) is in the repo README under *Other ways out*.
