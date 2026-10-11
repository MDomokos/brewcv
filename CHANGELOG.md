# Changelog

Every notable change to BrewCV, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers follow [Semantic Versioning](https://semver.org/). How versions are chosen and released is in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#versioning-and-releases).

0.8.0 is the first public release. Versions before it were never deployed or tagged. Each minor version up to 0.7 was a milestone, and each patch version a step within it. Their entries are grouped by feature, not by type of change.

## Unreleased

### Added
- **Job types are bundles of tags.** A job type such as "CAD designer" is a short list of tags. Under Focus it appears first, and one click selects every bullet that has a version with any of those tags, each printing the version that carries the most of them. One undo reverses it. Job types are edited in Career, under Skills & credentials. A job type that is just one tag still works.
- **Archive a claim or a whole job.** Archived claims and jobs are hidden in Career behind an "n archived" button and are never switched on by a new resume, Focus or Fit. Saved resumes keep printing them exactly as before. Archiving can be undone, and a merge shows it as a change.
- **A guide to tags, job types and archiving** in docs/TAGS-AND-JOB-TYPES.md.

### Changed
- **New facts are no longer tagged with their section's name.** Nothing read those tags; they only added clutter to the Focus list.
- **Exporting a PDF from the command line needs no packages.** `scripts/export-pdf.mjs` now prints through the Chrome, Chromium, Brave or Edge already on the machine (set `CHROME_PATH` to choose one) instead of through Playwright, and the PDFs come out identical. It is optional: the app's own PDF export needs no extra software.
- **The logo is on the start screen and in the header.** The welcome card opens with the icon and the name at full size, and the header carries the icon beside the name on every working screen.
- **A reload goes back to the start screen if only the example is open.** Once any of your own records is open, a reload keeps you where you were.
- **The app is now called BrewCV.** The name, the tab title, the installed app's name and the start screen all say BrewCV, in every language, and the installed app's toolbar takes the icon's green. The address changes with it: the app lives at `/brewcv/` on GitHub Pages. Your saved data and your backups carry over untouched, because the file formats and the browser's storage name keep their old identifiers on purpose.
- **New app icon.** A teacup drawn from the letters C and V: the V is the cup, the C its handle, and a tea bag string runs over the rim to a tag marked `{ }`. It replaces the dark tile with the yellow bar, in the tab, the installed app and on the home screen, and is the icon for the coming rename to BrewCV.
- **The start screen shows one record turning into a resume.** Your old files sink into a *Your record* column, and a portrait page drawn in grey lines (no text, no example marking) is made from it. A pen writes the wordings under a *Written by you* tag, so it reads as your own words and nothing the app or an AI wrote. The four steps sit beside it in one *How it works* card, as buttons that jump to that moment, with *Replay*. *Why JSON?* sits under them.
- **Tailoring picks facts, not only wordings.** Each fact in the record has a tick: a different kind of job (startup, big company, public sector) takes other facts and other wordings, and so do you, by ticking a fact on or off. Wordings (v1, v2, v3), region (US, DE, HU), photo and one page or two are in the same tool row. Everything on it previews on hover and stays on click, and a hover stops the demo cursor.
- **The language chips change the page on hover.** Hovering a language shows the whole start screen in it, leaving goes back, and a click keeps it. The words change in place: nothing is redrawn, and the page keeps its size and position while you move across the chips.
- **The start card is a section of its own.** The three start buttons and the language codes (EN, DE…) are quiet; the *Yours to keep* row below is plain text with its sentence always visible, not a banner you hover.
- **The start screen fits without scrolling** on a laptop or a large monitor, in every language. On a tablet or phone the start card sits on top, the steps stack under the page, and tapping a step scrolls the page into view. None of the motion plays when the system asks for reduced motion.

### Fixed
- **It starts offline again.** The example resumes a first start loads were not in the offline copy, so reloading without a connection stopped before anything was drawn. They are now. Also, offline on localhost the sheet's template was answered with the app page, which left an empty sheet; it is answered from the offline copy now.

## 0.8.0 - 2026-10-09

### Added
- **An introduction on the first start.** A first start opens on a page of its own (no resume behind it, no header), not on an example resume. It has three windows on the backdrop:
  - *How it works* walks through four numbered steps (write each job once, keep several wordings, pick one per resume, export), each with its picture where it has one. One picture puts ten near-identical Word/PDF files beside one JSON record. Another is a grid of one job's wordings and languages, with two resumes each picking one cell. A *Why JSON?* fold-out covers portable plain text, editing by an AI, a standard (JSON Resume, linked to its schema) and file over app, with a link to Steph Ango's essay. "JSON file" links to json.org.
  - *Get started* holds *Start from scratch*, *Open or import a file* and *Try it with an example*. Its language chips are buttons: clicking one switches the page and the app to that language.
  - *Yours to keep* is a dark banner below: standard files, private, nothing to install, no lock-in.

  On a phone the windows sit flat on one screen. The language step comes after the choice (not for an import, which brings its own languages) and has a Back button. *Start over* returns to the introduction. All of its text (`onb.*`) is in all ten catalogues, machine-written like the rest.
- **References.** Skills & credentials has a References group: a name, and what they'd say, which has versions and translations like a claim. They print in a References section (a name and its text, like Languages) that is off on every resume until you turn it on, with the same switch as Skills or Languages. References in an imported JSON Resume become these. The plain-text export lists them when the section is on.
- **JSON Resume's other fields in Career**, under a *More fields (JSON Resume)* fold-out: a job's website, a line about the company and a summary of the role; a degree's courses and website; a skill group's level; a publication's link and summary; a project's (or volunteering's, or an award's) description; the street address, postcode and region. The resume design doesn't print them; the JSON Resume export and community themes do. They are the same in every language.
- **Career › delete a claim.** 🗑 beside each claim deletes it and all its versions, from the record and from every resume that mentions it. There is no confirmation; the message says Ctrl+Z brings it back. A job keeps at least one claim, because a job with none can't print.
- **The deploy workflow checks that the examples ship:** all six saved resumes, the Hungarian one included, must be in the published tree.
- **Version numbers.** `package.json` holds the app's version. The service worker's cache is named after it (`0.8.0`) instead of a date and a counter, and the deploy adds the commit (`0.8.0+1a2b3c4`), so every deploy refreshes installed copies without a hand-made bump. `checks/version-check.mjs` makes sure `package.json`, `sw.js` and this changelog agree, and the deploy runs it.

### Changed
- **In Career, the interface follows Career's Language menu.** Switching Career to Hungarian puts the buttons and messages in Hungarian too (when Settings has them following, the default). Back in Resume they follow the open resume again. Leaving the interface on the resume's language read as the switch not working. Settings now says so: *In the language you're working in (the open resume's, or Career's)*, in all ten catalogues.
- **The README is written for people using the app.** It covers what the app does, its main features, privacy and file formats, and how to start from the GitHub Pages site (installed, it runs offline). Running it locally is a secondary option. It names the licence (AGPL-3.0) and credits JSON Resume and Resume Matcher. Everything for developers moved, word for word, to the new `docs/DEVELOPMENT.md`: the file layout, the checks, the command line, the reference checks, deploying, the private-data guards, the project status, the full prior-art tables, and the old interface walkthrough. The live URL is still a `<user>` placeholder, and the screenshot slots are commented out until the images can ship.
- **The grade is `score`, JSON Resume's name for it, not `honours`.** A record that says `honours` is renamed when it is opened (resume-data/3 included), and `setEducation` and `updateEducation` still accept the old name. The record's other non-standard keys (`id`, `display`, `source`, the portrait, a patent's `identifier` and `role`, a project's `during` and `location`, `rights`) have no JSON Resume equivalent and stay as they are; JSON Resume allows extra keys on its entries.
- **A JSON Resume opened in the app comes back out with every field it had.** Import now carries what the app doesn't model: the street address, postcode and region (no longer folded into the city), a job's `url`, `description` and `summary`, a degree's `url` and `courses`, a skill's `level`, an interest's `keywords`, a publication's `url` and `summary`, and the file's own `meta` (`canonical`). It no longer fills in `basics.url` from the first profile. `checks/fixtures/jsonresume-full.json` uses every JSON Resume v1.0.0 field and must come back unchanged.
- **The printed resume's JSON Resume** (saved resumes, *Export › JSON Resume*, the ATS path) keeps those standard fields instead of a short list per section, and a degree's start date.
- **The home-screen icon on iPhone and iPad** is `icons/icon-180.png`, which was in the repo but never linked. It is precached.
- **No real name, and no reference to documents outside the repo.** The name-order example is "Kovács Anna". Code comments are cut to the short ones that explain something the code can't.
- **`preflight-deploy` no longer denies the country code** from `data/identity.local.json`, nor any private value under four characters. A two-letter code ("HU", "US") identifies no one and is the ISO standard the app itself uses for languages and places. Denying it refused ordinary code, comments and docs. Skipped values are counted in the output.
- **Milestone and stage numbers are gone from the code.** Checks, comments and the example's metadata name versions (`0.4.0`, `before 0.5.1`) or the feature itself. `smoke-shell`'s sections are named by feature, so `ONLY=import,export` replaces `ONLY=8.9,8.10`. The 0.4.0 fixtures are `checks/fixtures/example-0.4*.json`.

### Removed
- **`workbench.html`**, the redirect from the address the app had in 0.5.4. Nothing was ever deployed, so no old links point at it. Its `smoke-shell` test went with it.
- **The one-off scripts for the original documents:** `scripts/extract-m1.mjs` with its data (`scripts/lib/m1-map.mjs`, `m1-facts.mjs`) and its helper `scripts/lib/imagesize.mjs`, and the measurements `checks/cost.mjs`, `audit.mjs`, `contrast.mjs` and `cpl.mjs`. They extracted and measured the hand-written 0.1.0 documents, which hold a real person's career, and nothing in the app or the deploy ran them. They are kept outside the repo with those documents.
- `data/.gitkeep`: the folder has files.
- An empty `if` block left in the Edit view's section switch.

### Fixed
- **The JSON Resume export wrote a degree's grade as `courses`**, JSON Resume's list of courses. It is `score` now. A resume saved before this still opens with nothing reported as newer wording.
- **The name is written per language.** In Career › About you, in a language other than the default, the Name field sets that language's own text ("Kovács Anna", accents and all) and leaves the default one alone. Writing it differently clears "same in every language" for the name; writing it the same sets it. The sheet and the page footer already followed the language.
- **The language menu is as wide as its list.** A rule for the whole column zeroed the menu's `min-width`, so it shrank to its button and clipped the names. Menus are now at least 240px.
- **A failed draw no longer breaks the whole window.** The column was only placed after a good draw, so one render error left it unplaced and the sheet unsized.
- **A saved session that can't be drawn starts over at the welcome card.** It is kept first as a checkpoint ("Before loading the example").
- **On localhost the service worker goes to the network first.** Cache-first served an old `data/example.json` beside newer saved resumes ("the recipe asks hydra for hydra-tolerance"). A deployed copy is still cache-first.
- **The deploy workflow parses.** The step name `Preflight: refuse to publish anything private` was unquoted YAML with a colon in it, which GitHub would have rejected.

## 0.7.4 - 2026-10-06

**Checks for one way of editing.**

- `checks/parts-check.mjs` (and `checks/lib/ui-harness.mjs`, which runs `edit.js` and `career.js` in Node): the markup snapshot, the same claim in both workspaces, the same clicks giving the same record, Career's flat list, deleting, adding, the keys and Esc. `smoke-shell` has a section for the same in Chromium and the Career selectors it used moved with the panel.

## 0.7.3 - 2026-10-06

**What differs is only what tailors.**

- Career's list is flat: every version an equal row with ✎ ⇄ 🗑 and its tags, no ◉, nothing in use, no *use* action, no line counts, no *This resume only*; a version written there is not picked by the open resume.
- 🗑 on a claim moved into the panel's header and is in the Resume too. *+ Add something you did* is under a job's claims in the Resume as well (it adds the claim and turns it on when the job is on).
- Keys: **↑ ↓** walk the claims in Career, **← →** step through the versions, **Enter** edits the one stepped to, and **Esc** goes up one level (the editor, the claim, the entry's panel) before going back to Resume. Both workspaces show the same keys line, and `edit.keys` gains *Esc goes back*, in all ten catalogues.

## 0.7.2 - 2026-10-06

**Career opens the Resume's claim panel.**

- The version list, the editor and the write-in box are the Resume's, not a second copy: same markup, same actions, same record. A version is edited with ✎ and saved as *Save vN* or *Save as vN.1*; *+ Write a new version*, a missing translation and *Same in every language* work the same way.
- Career's own fold-open copy (`c-ed`, `c-cmp`, `c-del-v`, `c-write-in`, `c-new-v` and its own editor) is gone.

## 0.7.1 - 2026-10-06

**Shared parts.** The start of 0.7, one way of editing: Career and Resume open the same panel for a claim.

- The breadcrumb, the switch, the item rows, the version list, the editor, the write-in box and the missing-texts bar are pure string functions in one module, `src/ui/parts.js`, used by `edit.js`, `career.js` and the shell.
- The Resume's markup is unchanged: 108 views in the states the editor has (versions, folds, compare, every editor mode, *this resume only*, focus, a missing language) are compared byte for byte with a snapshot (`checks/parts-check.mjs`).
- The service worker precaches `src/ui/parts.js`; its cache is `rb-2026-10-06-10`.

## 0.6.10 - 2026-10-06

**Scrollbars.**

- **Thin, quiet scrollbars** on every scrolling panel (the card, menus, Career, the pages), tinted to the panel.

## 0.6.9 - 2026-10-06

**Scrolled pages.**

- **A longer resume scrolls** when its pages don't fit side by side, or always, by setting. The footer shows the fill of the page in view, with previous and next. Selecting something on a later page scrolls to it.

## 0.6.8 - 2026-10-06

**Kinds of your own.**

- **Up to six custom kinds**, timeline (volunteering, a residency) or list (exhibitions, talks), each with a name per language, a colour, an icon and its own resume section. Deleting a kind moves its entries to another kind or deletes them with it.

## 0.6.7 - 2026-10-06

**Projects.**

- **Projects print like jobs**: a title, a meta line and bullets with versions, chosen per resume. Fit, pagination, tailoring, languages and validation all handle more than one section of entries. The example has two projects in a Projects section, off by default.

## 0.6.6 - 2026-10-06

**Career, rebuilt.**

- **Three steps and a way out:** *About you*, *Timeline*, *Skills & credentials*, then *Tailor a resume →*. First-visit tips, which *⋯ › Show the tips again* brings back.
- **The timeline in two columns:** work on the left, education beside it. Click an entry for what you did (every version of each claim, side by side, all equal) and its details form.
- **+ Add** for every part of the record: work, education, projects, skill groups, languages, certificates, publications, interests, another summary. Every add, edit and delete is one undo step; deleting says Ctrl+Z brings it back.
- **In Resume**, the card shows where a text comes from (*From Career › …*) and links to it.
- **The resume becomes a thumbnail** beside Career and grows back when clicked. The switch is animated by transform only, and not at all with reduced motion.

## 0.6.5 - 2026-10-06

**Examples in every language.**

- **Fourteen example resumes**: at least one per language, one-pagers filled 90.8–95.8%. The German to Czech ones are machine-written and tagged as needing a native review. The person and every employer, number and patent in them are invented.
- **The deploy workflow** checks that all fourteen ship, one per language at least, and runs `i18n-check`.

## 0.6.4 - 2026-10-06

**Choosing languages.**

- **A language step on the first start-up**: the languages you write resumes in (ticked from the browser's language) and the one to start with.
- **Languages you use** are stored in the record and limit every language menu. Unticking hides a language; nothing written in it is deleted.
- **Settings** (*⋯ › Settings*): the app's language follows the open resume or stays fixed; how longer resumes are paged; show the language step again. Kept in this browser.

## 0.6.3 - 2026-10-06

**Nine catalogues.**

- **German, French, Spanish, Italian, Portuguese, Dutch, Polish, Czech and Hungarian**, every key. All nine are **machine-written and need a native review**: each file says so in its first line and exports `review = 'machine'`, and the app marks them *(machine-translated)*.

## 0.6.2 - 2026-10-06

**Ten languages.**

- **English, German, French, Spanish, Italian, Portuguese, Dutch, Polish, Czech, Hungarian** in the record, the renderer and the language button. Each language knows its paper and A4 format; switching an A4 resume moves it to the new language's format.
- **The resume's own words** (headings, "continued", "present", month names via `Intl`) print in the resume's language. English output is unchanged: the four library resumes still render byte-identical and measure 0.00px.
- **`checks/label-fit.mjs`** measures every language's headings against the gutter in Chromium.
- Not changed: the example's credentials heading stays *Certified*. *Certificates* is 104px and would cut into the A4 margin.

## 0.6.1 - 2026-10-06

**The interface catalogue.** The start of 0.6, languages: ten of them, the app in each, and Career rebuilt around the whole record.

- **Every word the app shows comes from `src/i18n/en.js`** (913 keys), through `t()` for text and `h()` for text with `<b>`, `<kbd>` or `<code>`. Plurals use `Intl.PluralRules`. A missing key falls back to English, then to the key itself.
- **`checks/i18n-check.mjs`**: every catalogue has every key and no other, the same placeholders, the plural forms its language needs, the same markup, and the review marker.

## 0.5.13 - 2026-10-06

**Phone, accessibility and offline.**

- **Phone layout:** below 720px the page fills the width and a bottom sheet lets you view a resume and pick versions; editing stays on larger screens.
- **Accessibility pass:**
  - axe-core clean on every main view;
  - the logo is the page's heading and the sheet a labelled region;
  - acting links are keyboard buttons, and version rows answer Enter and Space;
  - the task card no longer announces every redraw.
- **Service worker** precaches every module and theme file; checked both ways. It runs offline from a project subpath.
- **Fuller example resumes:** six new fictional claims. The one-pagers measure 90–95%, and Helix Diagnostics became a one-pager.
- **README rewritten** for the app, with two guides under *Other ways out*: *Open in Figma* (HTML page → html.to.design, one way) and *Community themes* (JSON Resume → `resumed`).
- **Removed: the 0.4.0 picker** (`picker.html`, `src/app.js`, `src/picker.js`, `src/picker-model.js`, `src/app.css`), with `picker-check` and `smoke-app`. Their subpath and offline tests moved into `smoke-shell`.

## 0.5.12 - 2026-10-06

**Onboarding and Career.**

- **First visit:** a welcome card with *Start from scratch*, *Open or import a file* or *Try it with an example*.
  - The guided setup asks: about you; where you'll send it (paper and photo); jobs, one claim per line; education; skills; a photo where expected.
  - The page fills in as you type. Three tips follow, and *⋯ › Start over* reruns it.
- **Career workspace** (header switch, or C / R):
  - the record as a timeline where the sheet was, with the sheet as a thumbnail;
  - edit a job's facts; the printed title and meta line follow unless they were reworded by hand;
  - every claim with all its versions; add claims and jobs; open any claim in the resume editor.
- `src/model/build.js` builds a record from plain fields, shared with the JSON Resume import.

## 0.5.11 - 2026-10-06

**Design and theme tokens.**

- **Design view:** one page, two, or as many as needed; Letter or A4 (the Hungarian A4 on a Hungarian resume); four templates (B2 Marker, tinted tabs, high-contrast metadata, mono print); an accent colour with a live contrast check.
- **The photo:** cropped to 35 × 45 mm (472 × 600 JPEG, under 300 KB), with passport, rounded and circle shapes, and a note on where photos are expected. It is kept out of undo snapshots.
- **Theme tokens** (`src/model/tokens.js`), 28 of them:
  - **Read** from CSS (`--doc-*`), simple JSON or DTCG 2025.10 (groups, `$type`, aliases); everything else is refused and named.
  - **Written** as DTCG.
  - The built-in themes ship as `themes/*.tokens.json` (`scripts/tokens.mjs`).
  - Gate: the built-ins as tokens measure 0.00px.
- `figma/README.md`: the theme round trip through Figma Variables.
- **The A4 header hole beside the photo is gone:** with the photo on, the summary runs beside it.

## 0.5.10 - 2026-10-06

**Export.**

- **Pre-flight checks:** overflow, a tight last page, empty contact fields, texts printing in English, newer wording, a photo on Letter, a missing photo, placeholders, unchecked versions, unsaved changes.
- **Downloads:**
  - **PDF**, through the print dialog with `@page` set;
  - a self-contained **HTML page** (styles and fonts inlined, no scripts);
  - **plain text / ATS**;
  - **JSON Resume**, as printed;
  - a **backup**.

## 0.5.9 - 2026-10-06

**Import, merge, history.**

- **One import door:** ⋯ › Open or import, a drop anywhere, or pasted JSON. Files are known by their contents.
- **JSON Resume import:** each highlight becomes a claim. Sections the app doesn't draw ride along and are written back out, so the round trip loses nothing. A linked photo is never fetched.
- **Merge preview** (`src/model/diff.js`): *Will add*, *Different values*, *Only in yours*. Jobs, claims and versions are matched by id, then by wording.
- **History:** checkpoints with what changed since, restore, download, and *Compare with a file*.
- **Edits made to a record's JSON Resume body in another tool** become versions.

## 0.5.8 - 2026-10-06

**Languages.**

- An English / Hungarian switch per resume, with a count of what's missing. Picks are kept per language.
- **Missing texts print in English**, outlined on the page and listed in the card; write them in place.
- **"Same in every language"** in the renderer. The example no longer duplicates such texts.

## 0.5.7 - 2026-10-06

**Tags and focus.**

- Tag the version in use; job types are tags shown in teal.
- **Focus:** a job type or tag fades the bullets without a matching version and stars the ones with it. *Select bullets for X* is one undo step, never touches Keep, and never empties a job.

## 0.5.6 - 2026-10-06

**Saved resumes.**

- **Save** (Ctrl+S): company, role, job type and tags, with an option to tag the versions used. The header shows unsaved changes.
- **Resumes** (Ctrl+O): grouped by job type, hover to preview, Open, Re-use, compare two, delete, and + New resume three ways.
- **Frozen text:** a saved resume keeps the words it was saved with, and *newer wording* is offered on open.
- Saved resumes are written to `recipes/` when a folder is linked.

## 0.5.5 - 2026-10-06

**The Edit view.**

- **`index.html` became the Workbench.**
- **A bullet, versions first:** ✎ edits in place with the page redrawing live (*Save vN*, *Save as vN.x*, *This resume only*, *Cancel*), plus compare, delete and *+ Write a new version*.
- **Version numbers** have at most one dot and are never reused.
- **On / off and Keep** per bullet: `pins` was renamed `off` / `keep`, with a migration.
- **Panels:** a job panel and a section panel. Rename a heading in the panel or by double-click on the page; drag sections to reorder.

## 0.5.4 - 2026-10-06

**The shell.**

- **`workbench.html`:**
  - the page at full window height on a canvas, beside one column of three cards;
  - click anything on the page to select it; hover a version to preview it;
  - undo and redo, keyboard steps, Fit;
  - actual size after a bank-card calibration;
  - browser autosave and an optional linked folder.

## 0.5.3 - 2026-10-06

**Renderer additions.**

- **Block pagination** when a resume has no hand layout, with `pageLimit` (1, 2 or as many as needed). Fit aims the last page.
- Per-resume section labels, the photo switch, and static fields per language.

## 0.5.2 - 2026-10-06

**Store and persistence.**

- **The store:** 200 undo steps, with photos kept as assets outside the snapshots.
- **Persistence:** IndexedDB autosave, an optional linked folder, backup and restore, checkpoints.

## 0.5.1 - 2026-10-06

**Schema v4.** The start of 0.5, the Workbench: one career record, tailored resumes chosen from it, all in the browser.

- **`resume-data/4`:** every file is a valid JSON Resume, with versions, languages and tags under `meta.resumeBuilder`. Saved resumes are their own files. v3 files migrate in memory.
- **The fictional example career** replaced the old example.

## 0.4.0 - 2026-10-05

**The picker and Fit.**

- **A picker beside the preview:** bullets on and off, pins, phrasing choice, section weights.
- **Fit:** chooses among existing phrasings and drops whole bullets to bring each page into 88–96%. It never rewrites prose and reports what it couldn't do. It works from measured line counts (the probe).

## 0.3.0 - 2026-09-15

**The renderer.**

- **`src/render.js`** fills the templates from a library and a recipe, in the browser and in Node.
- The generated one-pager is **identical to the hand-written 0.1.0 document**: markup tag for tag, and 0.00px in both axes. That has been the gate for every renderer change since.
- **`preflight-deploy`:** the templates are holes, so the repo can be public.

## 0.2.2 - 2026-09-15

**Earlier resumes and languages.**

- An extraction pass over the earlier submitted resumes.
- `resume-data/3`.
- The language axis (`lang` on every phrasing), which later became the Hungarian resumes.

## 0.2.1 - 2026-09-15

**The fact library.**

- The content extracted into a library of facts with tagged phrasings.
- Code-point mark offsets.
- A spine in JSON Resume field names.

## 0.1.0 - 2026-09-15

**The documents.**

- **A US Letter one-pager and a European A4 CV**, hand-written in HTML. Every visual decision is a token in `themes/b2-marker.css`, and page geometry lives in `formats/`.
- Self-hosted fonts (Hanken Grotesk, Fira Code). It runs as a static site and an offline PWA, with no build step.
