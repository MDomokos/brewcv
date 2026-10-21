# Design rules for a BrewCV look

What a look (a theme, or an overlay on one) has to keep to, and why. [THEMES.md](THEMES.md) says how to make one; this says what makes one good. The rules come from reading real pages: a two-page resume with six yellow labels stacked on its second page, and the audit of an old resume whose section headings were louder than its job titles.

A look that breaks a rule is a bug, not a style. A rule marked **checked** is held by `node checks/themes-pages-check.mjs`, which draws every look in `src/themes.js` on a one-page and a two-page resume, in A4 and Letter, paginated from Chromium's own measurements. To bend one, change the rule here and the check in the same change, so the bend is a decision.

## The rules

1. **A look never changes the paper, and all of it prints.** The paper size belongs to the format (`formats/`). A look may set its own margins and gutter, on `.page` and not in `:root`, so a tokens file still carries only colour, type and spacing. The text keeps at least 36px (9.5 mm) from every edge, and nothing is printed within 24px (¼ in, 6.35 mm) of it: most office printers can't print their outer 3 to 6 mm, so a band of colour stops short of the edge in print. On a screen it may run to the edge: the root's `medium-print` class, set for a print export, is what pulls it in (Banner does this), and the check measures with it on. Fit and the page breaks measure the real page, so they keep working. A look may make a resume fit in fewer lines, never overflow the page or need more pages than B2 Marker does. **Checked** (the edge for elements; a pseudo-element's paint is the look's own care).
2. **The label is a signpost, not content.** A section label is never set larger than a job title. The reader should find the evidence first and the label second. **Checked.**
3. **At most four marked labels a page.** A marked label is a filled, outlined or underlined tab. Past four, the page reads as a row of stickers and the labels outweigh the content. Small sections (certifications, a patent, languages, interests) go under the section above with the *Group under the section above* switch in a section's panel (select the section on the page), which prints them as quieter labels (rule 4), so the colour stays on the main sections. **Checked** on the two-page example with its small sections grouped; in Marker tabs the same page ungrouped carries seven, which is why grouping exists.
4. **Quiet means quieter.** A grouped label is quieter than its section's. Where the main labels are plain text (B2 Marker), it is plain grey text; where they are filled (Marker tabs), it is a smaller tab in a pale tint, so the colour stays on the main sections. Never an outline or an underline, and its text reads on what is behind it at 4.5:1 or better. **Checked.**
5. **Tab text reads on its tab with every accent.** Checked for the six accent swatches by `node checks/tokens-check.mjs`.
6. **The accent has three jobs:** the name's swipe, the section tabs and the highlighted metrics. It is not for body text, bullets, rules or decoration. A second colour needs a reason you can say in a sentence. *Not machine-checked.*
7. **A continued tab is quieter than the section's own tab.** B2 Marker greys a continued label; Marker tabs fills it with `--tab-fill-cont`. A reader who sees "Experience" twice should see one section and one continuation. *Not machine-checked.*
8. **It prints.** Colour survives `print-color-adjust: exact`, and a pale colour that looks good on screen can disappear on paper, so print it. If the look uses colour for meaning, give a black-and-white printer an overlay (`print-mono.css` is 18 lines). *Not machine-checked.*
9. **Every language's heading fits the gutter.** The widest label in the ten languages has to clear the gutter by 3px: `node checks/label-fit.mjs`.

## Making one

```
node scripts/new-theme.mjs harbour "Harbour" "Navy ink, sea-green tabs."
```

registers it everywhere it has to be: `themes/harbour.css` (an overlay to fill in), the line in `src/themes.js`, its two picker strings in all ten catalogues (in English; the nine others need a translation and say so until they have one), the service worker's cache list, and its tokens file. Then:

```
node scripts/tokens.mjs                  after editing the stylesheet: rewrite its tokens file
node checks/themes-check.mjs             everything that has to agree with the registry, and what is still missing
node checks/themes-pages-check.mjs       the rules above, on one and two pages
```

The picker swatch for a new look is the B2 one until you add `.tpl-harbour` rules to `src/ui/workbench.css`; that is optional.
