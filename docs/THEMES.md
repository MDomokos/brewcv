# Making a theme for BrewCV

You can change how a BrewCV resume looks without touching the app's code. There are four ways in, from the easy one to the one that needs a pull request. Pick by what you already use.

A theme changes colour, type, sizes, spacing and two switches (the tab style and the highlight style). It never changes the layout: which section sits where, the page size, the gutter. That's on purpose. Fit and the page breaks measure the real page, so a theme can't break them.

What makes a theme good, and which of it a check holds you to, is in [THEME-DESIGN-RULES.md](THEME-DESIGN-RULES.md).

| You use | Start with |
|---|---|
| A text editor | [Route 1](#route-1-a-tokens-file) |
| Figma | [Route 2](#route-2-figma) |
| CSS | [Route 3](#route-3-css) |
| An AI model | [Route 4](#route-4-an-ai-model) |
| Illustrator | Illustrator has no direct route. Make the colours and type in Figma, or write them into a tokens file. |

## Route 1: a tokens file

A theme is a [DTCG](https://www.designtokens.org/) tokens file: JSON with colours, fonts and sizes in named groups. The five built-in themes are in `themes/*.tokens.json`, so you can start from one.

1. Copy one.

   ```
   cp themes/b2-marker.tokens.json my-theme.tokens.json
   ```

2. Open `my-theme.tokens.json` and change values. A colour looks like this, and a plain `"#7fd1ae"` works too:

   ```json
   "accent": { "$type": "color", "$value": { "colorSpace": "srgb", "components": [0.498, 0.82, 0.682], "hex": "#7fd1ae" } }
   ```

   Fonts are a list (`["Georgia", "serif"]`), sizes are `{ "value": 10.5, "unit": "px" }`. [`figma/README.md`](../figma/README.md) lists every token and what it sets. Anything not on that list is ignored.

3. See what the app makes of it, before you open the app:

   ```
   node scripts/theme-check.mjs my-theme.tokens.json
   ```

   It says how many tokens it read, names everything it ignored and why, flags a font the app has no files for, and checks the accent against the tab text (4.5:1 or better). It also prints the CSS it would apply. Fix what it names and run it again.

4. Open BrewCV, then **Design › + Import a theme** and choose the file. (You can also drop it on the page.) It's applied to the resume you have open, and it shows under *Design › Theme*. The theme is saved in your record, so it comes with your backups.

5. To share a theme, send the file. Whoever receives it imports it the same way. **Design › Export this theme** writes your current look back out as a tokens file.

**What tokens can't change:** layout. You can't move the photo, add a column, reorder what's in the header or change the page size. They also can't add a font the app doesn't have. A font that isn't installed on the reader's machine falls back to Hanken Grotesk, and the import says so. The app ships Hanken Grotesk and Fira Code; Georgia, Helvetica, Arial and the other common system fonts work where the machine has them.

`node scripts/tokens.mjs` goes the other way: it writes the five built-in themes' tokens files *from* their stylesheets in `themes/`. You only need it if you edit one of those stylesheets. `node scripts/tokens.mjs --check` tells you if the files are out of date.

## Route 2: Figma

Tokens go into Figma as Variables, you restyle them there, and they come back as a tokens file. The steps, the Variable names and the plugins to try are in [`figma/README.md`](../figma/README.md).

The Figma Theme Kit, a file with a Letter page and an A4 page already wired to those Variables, isn't made yet. Until it is, you work from the Variables alone and judge the result by importing the file back into BrewCV and looking at your own resume. Importing is quick, and it's the real test anyway.

If you only want one finished resume to look different, and don't need a reusable theme, the README's *Open in Figma* route is simpler. It's one way: nothing comes back into BrewCV.

## Route 3: CSS

Two kinds of CSS file shape the page, and they have different jobs.

- **`formats/*.css`** is the page: its size (`@page`), margins, and the widths of the gutter and the column. `a4.css`, `a4-hu.css` and `us-letter.css`.
- **`themes/*.css`** is the look. `b2-marker.css` is the base: every colour, font, size and gap is a custom property at the top of it (`--accent`, `--ink`, `--font-sans`, `--fs-bullet`, `--band-gap` and so on). The other three files are **overlays** a few lines long. They load after the base and change a few of those properties or add a rule.

The page is a plain set of classes, and a theme styles those and nothing else: `.document`, `.page`, `.band` (a section) with `.band__gutter` and `.band__content`, `.tab` (the section label; in a `.band--sub`, a section grouped under the one above, it is the quiet grey label), `.entry`, `.role-title`, `.item__title`, `.meta`, `.bullets`, `.skills` with `.skills__label` and `.skills__items`, `.name`, `.namemark`, `.tagline`, `.contact`, `.summary` and `.mark` (the highlighted run in a sentence). Look at `themes/print-mono.css` for a complete overlay in 18 lines.

**Two ways to use CSS:**

- **In the app, today.** Import a CSS file whose `:root` sets `--doc-<token>` properties, such as `--doc-accent: #7fd1ae;` (the token names are in the third column of the table in `figma/README.md`). Add `/* theme: My Theme */` at the top to name it. Everything else in the file is ignored and named. `node scripts/theme-check.mjs my-theme.css` shows what gets through. This is Route 1 in another spelling.
- **As a new overlay in the picker.** A full stylesheet isn't something the importer accepts, because it could change anything. To add one, make a pull request, and let `node scripts/new-theme.mjs <id> "<Name>" "<note>"` do the registering: it makes `themes/<id>.css`, adds the look to `src/themes.js` (the one list of built-in looks), its two picker strings to all ten `src/i18n/` catalogues (in English: translate the nine), the file to `sw.js`'s cache list and its tokens file. Then write the stylesheet and run the checks below.

**What must not change:**

- The `@page` rules in `formats/*.css`, and `.page` keeping its size. A4 is 794 × 1123 px and Letter is 816 × 1056 px, and the page box, margins, gutter and column widths add up to exactly the page width.
- `print-color-adjust: exact` and `.page + .page { break-before: page; }` in the print rules of `b2-marker.css`. Without the first, the browser drops your background colours when it prints. Without the second, two pages run together.
- The gutter has to stay wider than the widest section label (about 94px). `node checks/label-fit.mjs` measures that in all ten languages.

## Route 4: an AI model

A model can write a tokens file well, because it's short and the rules are written down. Give it three things:

- a tokens file to start from (`themes/b2-marker.tokens.json`),
- the token list in `figma/README.md`, so it knows the names,
- this guide.

Then tell it what you want, in your words. For example:

> Here's a BrewCV theme tokens file and the list of tokens. Make a theme called "Harbour": deep navy ink, a soft sea-green accent, Georgia for the body text, and underlined section labels instead of filled ones. Change only values that are on the list, keep the file in the same format, and don't add layout. Tell me the accent and the tab text contrast ratio.

What to run afterwards:

- `node scripts/theme-check.mjs <file>` on what it wrote. This is the check that matters for a new file. If it names ignored tokens or a font the app doesn't have, paste that back to the model and ask for a fix.
- Import the file and look at your own resume at the sizes you print.
- If the model touched a stylesheet, or you added an overlay under Route 3: `node checks/tokens-check.mjs` and `node scripts/tokens.mjs --check`, and `node checks/label-fit.mjs`. They cover the built-in themes and the page, not a file of your own.

Models make confident mistakes with colour. Read the contrast ratio yourself, and look at the page.

## Before you send a theme

- `node scripts/theme-check.mjs <file>` names nothing as ignored, and the accent reads against the tab text.
- It looks right on a one-page resume and on a two-page one, and in a language with long section headings (German, Hungarian). For a built-in overlay, `node checks/themes-pages-check.mjs` draws it on both, in A4 and Letter, and holds it to the rules in [THEME-DESIGN-RULES.md](THEME-DESIGN-RULES.md); `node checks/themes-check.mjs` says if anything it needs is missing.
- Print it. A pale colour that looks good on screen can disappear on paper.
