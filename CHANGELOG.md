# Changelog

Every notable change to BrewCV, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers follow [Semantic Versioning](https://semver.org/). How versions are chosen and released is in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#versioning-and-releases).

0.8.0 is the first public release. Versions before it were never deployed or tagged. Each minor version up to 0.7 was a milestone, and each patch version a step within it. Their entries are grouped by feature, not by type of change.

## 1.0.0 - 2026-10-13

### Added
- **Tea and Coffee.** The app has two looks, chosen by a question in a corner of its own, "What are you drinking today?", with Shift+F, or with the logo, and the choice is kept in this browser. Tea (the default) is the icon's green tile on a bamboo mat: the modes hang as tags from a string, Fit is a luggage tag, a page's fill is the logo's cup that steams for a moment when it reaches the band, and the toast hangs on its string. Coffee is monospace with 2px corners and no shadows: an espresso band for a head, a cutting mat for a canvas, a measuring shot glass for the fill, one crema accent. The resume prints the same in both.
- **Light, dark or system.** Settings has a choice for each; both drinks have both. System, the default, follows your device.
- **The logo switches Tea and Coffee.** It has a tile for each drink and says what a click will do. Hovering rolls the bamboo mat up a little from the bottom (or unrolls it, going back to Tea); a click carries it across the canvas, slat by slat. Colours fade and corners, edges and shadows morph as the look changes.
- **Motion that explains what changed.** Fit crossfades its swapped lines, folds the dropped ones, fills the page meters and leaves a chip, "3 shorter · 2 left out", with Undo. A version under the pointer moves its words: shared words slide to their new place, removed words fade out and new ones fade in. The lens brightens its lines and Apply slides lines in and folds them away. A tick sends the line from its row to the page and back. A snapshot drops a small page into the resume's name, and a "Sent to" line appears under it. A saved version slides into the list, a page that overflows fades its dashed edge in, switching resume crossfades the page, and the start screen and the quiet onboarding turn into the editor. Each drink has its own picture of an export: the page wrapped in the bamboo mat in Tea, a till receipt in Coffee.
- **Reduce motion.** All of it is off under your system's reduced-motion setting, and a new switch in Settings turns it off on its own. The printed resume never changes.
- **The tea garden.** In Tea, while you rest, leaves, petals, rain and a few small visitors (a ladybug, a snail, a butterfly by day, fireflies at night) come to the mat. Nothing moves while you work: a click into the resume or a key press clears the page with a gentle breeze, and the rain stops. It is off in Coffee, on a phone, with reduced motion, and on the start screen, and a switch in Settings, "Garden while you rest", turns it off. Nothing from the garden reaches the page or any export.
- **Pages side by side on one canvas.** Both pages show at once and equal when the window is wide enough, otherwise one at a time with a magnetic wheel. Space and drag, the middle button or a drag on the bare canvas pan, a pinch zooms the page and not the site, and Esc at the page level puts everything away. Each page has a meter, an overflow line at its bottom margin, and the page you are not on fades but stays clickable. The pages are centred on the free space beside the open panel, or on the window when it is folded, and panning keeps most of them in view.
- **Edit on the page.** One click on a bullet opens its job, a second writes the line where it is printed, with the job framed, the rest dimmed and a breadcrumb that says where you are. The version badge, Update, Save as new version and Only on this resume sit beside the line. Tab and the arrows go to the next line without zooming out.
- **A start screen in the editor's layout.** The three ways in, the language, Why JSON? and Yours to keep are the editor's own areas, and a picture shows how old resumes become one record and then a resume for each job.
- **A Record tab.** The panel has a fourth mode, Edit, Record, Design and Export (R opens it, and the rail has an icon for it). It shows the whole record: the timeline is open at the top and every job, project, Education, Skills and credentials group below it is open with all its lines, ticked or not. Ticking a line changes the open resume with the page beside it: the panel widens to 640 to 720 px and the page slides left and shrinks (under 1280 px it is a drawer of 90% of the width, and on a phone the whole screen). Esc goes back to where it was opened from.
- **Ways into the record.** The job chip's "n of m on" on the page, and each section's "n of m on" in Edit, open Record at that job or section, and its group is marked for a moment. At the job level, "All of your record" does the same.

### Changed
- **One screen instead of Career and Resume.** The page and the editor panel sit side by side, and the record is a checklist: a group for About you, for each job and project, Education, Skills and credentials and any kind you made, each claim listed with its tick and how many versions it has. Ticking a line puts it on the resume and unticking takes it off, and the claims that are off stay in the list. Hovering a row lights its line on the page, and a Timeline button opens the two-column timeline over the page. The job you are working on wears a chip on the page with how many of its lines are on.
- **A job's fields are a Details fold in its panel, and every form saves as you go.** Title, employer, dates, place and More fields open under Details; About you, skill groups, languages, certificates, publications, interests, references, job types and the kinds you made open in the same panel. A field is saved when you leave it or press Enter, Esc puts it back, and each one is an undo step. There are no Save buttons in these forms.
- **The editor panel folds to a rail.** Auto (the default) folds it while nothing is selected and opens it when something is; Open and Closed keep it as it is. E opens and folds it, and Esc all the way out puts everything away: the panel folds, the selection clears and the page zooms back out. The rail keeps Edit, Record, Design and Export as icons, a meter for each page and a button to open the panel. Under 1280px wide the panel is a drawer over the right edge of the page.
- **Edit with nothing selected is "This resume".** It holds the sections, each showing how much it holds, and Highlight: choosing a job type or tag only highlights, and Select these… shows what it would change and applies it in one undo. At the job level the panel opens at its top with the line's versions first, then "This job, n of m on", the job's Details, and a way to the rest of the record.
- **The header is two rows,** the file on the first (name with its summary line, language, whether it is saved, Save to file, fold, the menu), and Edit, Record, Design and Export as one control on the second.
- **One meaning of save.** The header shows the autosave state and Save to file, and no button that says only Save. The snapshot is Mark as sent, at the end of Export: the same form (kind, company, role, date), the same snapshot and send.
- **The zoom controls and a meter for each page share one line** under the panel: full screen, zoom out, the percentage, zoom in, fit, then "p1 90% · p2 74%". The percentage opens the zoom settings: how big the page is when you write, the panel mode, sharper contrast and Actual size. Fit, undo and redo sit under them.
- **The switcher grows into the Resumes list.** "Manage all…" makes the same menu up to about 560px wide, with a search box and three views: by job type, by date (a timeline of what was sent) and by company, with outreach marked, tick boxes for Compare and a Compare button at the bottom. Rows give up the company before the role and carry a small language and pages tag.
- **New resume** asks for the job type and what to start from first, then the name, who it is for, the language and the paper.
- **Toasts never cover the page.** They hang under the panel's header, or in the gutter beside the rail. The note that opens with the example is a one-line chip at the top of the panel.
- **The keys are on a "?" sheet,** opened by the button or the ? key, and shown by itself once the first time you select something on the page. The hint paragraphs under the panels are gone, and a line that travels from the checklist to the page shows once what a tick does.
- **Try the example opens it at once,** in the language the start screen is showing; the languages question waits until you start your own record. Onboarding from scratch happens in a quiet editor with only the page and the questions, and Start editing brings the rest in.
- **Esc goes up one level:** line, job, page, then everything away. A line in a job is the job level.
- **One filled button.** Fit is filled only when it would change something (outside 88 to 96 percent, or overflowing); then Export's PDF is the filled one. The yellow accent, the blue toggles and the coloured stripes on the panel are gone from the app, and so are the emoji and arrow glyphs that were left: every icon is drawn.
- **Full screen is F**, since Shift+F switches the drink.
- **Contrast.** Text in the app passes AA and the edge of every control and the focus ring pass 3:1, in all four combinations of drink and theme. A sharper page edge is the default, and Settings keeps the softer one.
- **Tick any item of a resume on or off, one by one.** Skill groups, languages, certificates, interests and the other list lines each have their own tick in the record checklist, not only the bullets under a job. Turning the last one off takes the section off, and ticking one brings it back.
- **Print items in an order of your own.** Drag an item in the checklist, or press Alt+↑ or Alt+↓ on it (or with it open in the panel), and the page follows. The order belongs to that resume; the record keeps its own.
- **One tagging system for everything.** The Highlight row is one list, the job types first and then every tag. A tag on a skill group, a language or a certificate is found, highlighted and applied like a tag on a bullet. Tags are one closed list of at most 12, kept in the file and managed (add, rename, merge, delete) in the Job types panel; the archive tag is merged into the archived flag when a file is opened. The example's tags were merged from 25 to 11.
- **AGENTS.md covers what a person may ask a coding agent for beyond picking.** New wording goes into the record as new versions, each with a source, never as the default, and tagged `needs-review` in any language but English. A saved resume already in the one file can be changed in place, with every other saved resume checked to print exactly as before. It also says how to measure page fill, what to look for in the PDF, and why a claim without a source makes the tools refuse the whole record.

### Removed
- **The Career workspace,** its switch, its small page in the corner, its own language control and header, the Resumes view and the C and R keys. The record's language is the open resume's. The stack and side-by-side choice in Settings is gone with it.

### Fixed
- **A control keeps its focus** when the header, the bottom line, the rail or the panel is redrawn, so ticking a line or pressing a zoom button with the keyboard no longer drops you at the top of the page.
- **The panel scrolled past a line's versions** when a bullet was clicked; it now opens at its top.
- **The shortcut sheet's keys** no longer run into their labels, show ⌘ and ⌥ on a Mac, and list R.
- **Panning past the edge of the page** no longer jitters.

## 0.9.1 - 2026-10-12

### Added
- **Save to file.** One button saves the record and every saved resume as one file, `brewcv.json`, and opening that file anywhere brings everything back. The page never asks for file access: on a computer the browser downloads it (turn on "Ask where to save each file before downloading" in its download settings to save over the same file each time, which the app says once), and on a phone it opens the share sheet. The header says how many changes are not in a file yet, or how long ago you saved one. Ctrl+S or Cmd+S saves it from any view. The file is the same format as the old backup, so old backups still open, and it now carries an id for your record and the app version.
- **Opening a file is safe.** If this browser has changes that are not in any file, or the file is older than the one you saved last, the app says so and offers Save them first, Merge or Replace anyway. A file from a different record offers Merge or Replace. A file you just saved says it is already up to date.
- **`scripts/onefile.mjs`** packs a data folder into the one file and unpacks it, so the command-line tools and coding agents can work on a folder while you keep one file. It never overwrites without `--force`.

### Changed
- **Back up is now Save to file**, in the menu. Ctrl+S saves the file; the Save button, which takes a snapshot of the resume, is unchanged.
- **Text edited outside BrewCV in the one file** is offered as versions, the same as in a record file.
- **A linked folder is never written over a file that changed outside the app.** The header says so and offers Compare or Overwrite.
- **Copies a sync tool leaves after a conflict** (Syncthing, Dropbox, iCloud) are skipped when a linked folder is read, and named.

## 0.9.0 - 2026-10-11

### Added
- **Settings shows the app's version.** It is the version in the service worker (`sw.js`), which matches the newest release in this changelog, and a deployed copy adds the commit it was built from. `sw.js` is now in the offline copy, so the version also shows offline.
- **Job types are bundles of tags.** A job type such as "CAD designer" is a short list of tags. Under Focus it appears first, and one click selects every bullet that has a version with any of those tags, each printing the version that carries the most of them. One undo reverses it. Job types are edited in Career, under Skills & credentials. A job type that is just one tag still works.
- **Archive a claim or a whole job.** Archived claims and jobs are hidden in Career behind an "n archived" button and are never switched on by a new resume, Focus or Fit. Saved resumes keep printing them exactly as before. Archiving can be undone, and a merge shows it as a change.
- **A guide to tags, job types and archiving** in docs/TAGS-AND-JOB-TYPES.md.
- **A coding agent can tailor a resume from a job ad without writing a bullet.** `AGENTS.md` describes the steps and the rules. `scripts/claims.mjs` lists every claim and its versions, and `scripts/new-resume.mjs` writes a saved resume from a list of picks. It refuses a draft, an archive version, a version in an archived claim or job, a version in another language, or any wording of its own. Open the file in the app to add it to your saved resumes.
- **The command-line tools read the one file** the app saves, as well as a record file.

### Changed
- **The page appears at once, in its place.** Before, the first thing a visitor saw was three small empty boxes in the top-left corner until everything had loaded. Now a blank page and the column's frame, with the BrewCV name, are drawn in their final places as soon as the page arrives. The app's scripts are fetched in parallel instead of one after another, the example's resumes load together, and the resume is shown as soon as it is laid out instead of after the line-count measuring that follows.
- **New facts are no longer tagged with their section's name.** Nothing read those tags; they only added clutter to the Focus list.
- **Exporting a PDF from the command line needs no packages.** `scripts/export-pdf.mjs` now prints through the Chrome, Chromium, Brave or Edge already on the machine (set `CHROME_PATH` to choose one) instead of through Playwright, and the PDFs come out identical. It is optional: the app's own PDF export needs no extra software.
- **The command-line PDF export says how many pages the PDF has.** A resume that fits on one page in a plan can still print as two in a given browser.
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
- **Fit never swaps a version for a draft or an archive copy.** It could pick one when it was the shortest way to save a line.
- **The keyword-gap report no longer lists "join" and "team"** as words your record is missing.

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
