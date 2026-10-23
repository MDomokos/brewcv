# Changelog

Every notable change to BrewCV, newest first, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format with [Semantic Versioning](https://semver.org/) ([how versions are chosen](docs/DEVELOPMENT.md#versioning-and-releases)). 0.8.0 is the first public release; the versions before it were never deployed.

## Unreleased

### Changed
- **On a short window the start screen's column is smaller and no longer scrolls:** Yours to keep shrinks to four icons that open the same notes.

### Fixed
- **The Tea and Coffee switch, the light and dark switch and Why JSON? are flat,** with no shadow that clipped oddly in a small window.

## 1.5.2 - 2026-10-22

### Fixed
- **The start screen's story fits short, tall and ultrawide windows,** instead of being cut off or blown up.

## 1.5.1 - 2026-10-22

### Fixed
- **Linux: dragging and zooming the page is smoother,** with no shadow trails left behind.
- **The bright page is the one you are looking at,** as soon as more of it is in view, and no page is faded when you zoom out to see them all.

## 1.5.0 - 2026-10-22

New looks and settings in the Design view. The new looks are a work in progress: their details may still change, and a resume that uses one may reflow when they do.

### Added
- **Four new looks:** Classic, Classic full width, Timeline and Banner.
- **Settings for each resume's look:** section style, fonts, text size, density, colour and key words. Each look offers only what it can hold, and a resume that changes nothing looks as before.
- **Small sections can be grouped under the one above,** so the colour stays on the main sections.
- **The job title can sit beside your name** in Compact density, to save a line.
- **Export for a screen, for printing or for a highlighter pen.** The pen version prints in black and white with guides to colour in by hand.
- **New built-in fonts:** IBM Plex, Source Serif 4 and Source Sans 3. They work offline.
- **The command-line scripts apply a resume's look,** so a PDF made by an agent matches the app.

### Changed
- **B2 Marker's section labels are plain bold text with a thin line above.** The yellow tabs are now the Marker section style.
- **Tinted tabs and Mono print leave the list of looks.** Resumes that use them look the same, with one button to move to B2 Marker.
- **B2 Marker has fewer type sizes and a narrower left margin.** Saved resumes reflow.
- **A shorter README** that leads with pictures of the start screen.

### Fixed
- **A job moved with the keyboard onto the next page keeps its focus.**
- **The editing chip no longer covers text.**

## 1.4.3 - 2026-10-21

Quiet labels for small sections.

### Added
- **A section can be grouped under the one above it.** It prints a quiet grey label instead of another yellow tab. No existing resume changes.
- **One command adds a built-in look,** and a check keeps looks in step.
- **Every built-in look is checked on one and two pages in A4 and Letter** against written design rules.

## 1.4.2 - 2026-10-21

A Windows build of the desktop app.

### Added
- **A Windows build of the desktop app can be made on GitHub.** It is not code-signed and has not been run on a Windows PC yet.

## 1.4.1 - 2026-10-21

The page appears sooner.

### Fixed
- **The page appears before the app's scripts arrive,** so a slow connection no longer shows a blank page for long.

## 1.4.0 - 2026-10-21

The start screen tells its story on a framed board.

### Changed
- **The start screen's story is a framed board with a big picture for each step.** It plays by itself, and a control moves between the four steps. The words are in all ten languages; the nine besides English are machine-written and marked for review.
- **The Tea and Coffee cups come alive when pointed at.**
- **The start screen's buttons lean toward the pointer, and the Tea tag hangs on a string.** They stay still with reduced motion.
- **"Yours to keep" is four short lines, and "Why JSON?" is a pill.** Each opens its sentence in a small popover.
- **The three ways in are one small line each,** told apart by their shape.
- **The start screen's header has Tea, Coffee, light and dark switches.**
- **The career file starts level with the ways-in card.**

### Fixed
- **The language question has a gap above and below its card.**
- **The stack of resumes is no longer cut off by an invisible line.**
- **The stack no longer blinks** when a resume joins or two swap places.

## 1.3.0 - 2026-10-17

Edit on the page, locks, the Review list, and three places.

### Added
- **Every text on the page is written where it is printed.** Click a heading, title, date line, item or header text and type. Some edits print on the page and in the PDF only, for now.
- **Writing on the page is one click,** and what you type stays on this resume. Picking another version sets your edit aside; picking it again brings it back.
- **The version number beside a line lists its versions,** previews them as you point and chooses on a click.
- **A line that exists only on one resume.** Add it with Enter at a job's last line or "+ line". It stays out of the JSON Resume file, and an older app leaves it out.
- **Skills are arranged on the page.** Write group names, drag skills between groups and start from a set per job type or tag. Exports follow, and a resume that uses none of this prints as before.
- **Things on the page move by their grips,** with a preview of where they will land. Esc cancels. Sidebar rows drag too.
- **Lock a line, job, section, heading, skill group or the whole page.** Locked content cannot be edited, moved, switched off, replaced or dropped by Fit. An older BrewCV ignores locks.
- **The Review list.** Save to file first shows your edits. Each can become a version, stay on this resume or go to the record, and newer wording from your other resumes is offered too. Locked lines are never offered and sent copies never change.
- **Every action has its inverse where it was done.** Tools put an edit back or remove a line or skill group that is only on this resume. Delete sits beside Duplicate, and delete toasts have Undo.
- **The Library holds every resume and sent copy** as cards, with search and grouping. An inspector shows where a resume came from, what differs from it and its sent copies.
- **Compare any number of resumes or sent copies** in a table, and step through the differences.
- **Career has profile cards, a timeline and the selected entry beside it,** with search.

### Changed
- **One sidebar replaces the tabs, the fold and the two sheets.** The page stays centred beside it.
- **The app has three places: Library, Editor and Career.** Career is what the app called the record. With two or more saved resumes, the app opens on the Library.
- **Undo, redo and Saved are one card at the top of the strip,** the same in every place. Fit and the page fill are at the top of Export.
- **The panel's width follows the window.**
- **Show and hide is one pill switch with one wording.**
- **An undo step is one change.** Quick ticks, switches and moves no longer merge.
- **The page moves flat in Tea,** and a zoomed page stays sharp.
- **Scrollbars match the theme.**

### Fixed
- **Esc during a drag of a sidebar row ends the drag.**
- **A block lifted while dragging no longer paints over the neighbouring page.**
- **Dragging a line in the Record list moves it on the page too.**
- **The "n v" tag on the headline and contact lines opens their versions.**
- **The drink switch's roll and the folded Tea tags move more smoothly.**

## 1.2.0 - 2026-10-14

### Changed
- **In Tea, a page you move lifts off the mat.** The resume, print and exports are unchanged. Coffee stays flat.
- **A page you move goes above the garden,** and the leaves and petals on it are cleared.
- **The page no longer slides off to the side when there is room.**
- **The zoom bar shows only over the white page.**
- **Fit and the page fill are in the Export view,** not on the page.
- **The folded Tea tags follow the pointer, on strings.** Coffee has none.
- **The macOS desktop app has no grey title bar.** Drag the window by the strip along the top.

### Fixed
- **No white bar between two pages** in Tea and dark Coffee.

## 1.1.0 - 2026-10-13

### Added
- **An experimental macOS desktop build.** Export > PDF saves a file without a print dialog. Private files are kept out of the app.
- **An experimental Linux Flatpak build,** untested on a real Linux system yet.
- **Link a folder in the desktop app.** It reconnects when you reopen the app.
- **A floating panel with five tabs:** Outline, Edit, Design, Export and Record. The page never moves when you change tab.
- **The Outline shows this resume in print order,** with ticks, grips and up and down buttons.
- **The zoom bar shows over the page.**
- **Re-ordering is visible.** Anything that can move has a grip and up and down buttons, and "custom" with Reset shows when the order differs.
- **Jobs can be put in a different order on one resume.** The page, Fit and the JSON Resume export follow. Agents' picks files take a job order and a bullet order too.
- **Folded Tea tags hang on a thread** and swing when brushed.

### Changed
- **E folds the panel, and the tabs stay** as cream tags.
- **Edit shows only the selection,** with every version in full and the differing words marked.
- **The header is one row.**
- **On narrow windows the page shrinks** so the panel keeps its width.
- **Nothing floats over the printed text.**
- **Quieter header and menus.**
- **The page stays in view while you write.**
- **Shorter tab labels** in German, French, Italian, Dutch, Polish, Portuguese and Hungarian.

### Fixed
- **Naming a checkpoint works in the desktop app.**
- **Leaving a bullet you have typed in asks before discarding,** in the desktop app.
- **Linking a folder that already holds the same files writes nothing,** so sync tools see no changes.
- **In the desktop app, Reconnect opens the folder dialog.**
- **A resume named with accents keeps its name,** however the accents were typed.
- **The highlighter prints clean in a PDF from a Mac's own print engine.**
- **A4 resumes no longer get a blank page after every page** from a Mac's own print engine.
- **Text copied from a PDF keeps "ff".** Four of the fourteen examples gain a line of wrapping and still fit.
- **One example resume that cannot be read no longer stops the app from starting.**

## 1.0.0 - 2026-10-13

### Added
- **Tea and Coffee looks for the app.** Pick one with a question in the corner, Shift+F or the logo. The resume prints the same in both.
- **Light, dark or system** in Settings, for both drinks.
- **Motion that shows what changed,** such as Fit's swaps and drops with an Undo chip, and a version's words sliding into place.
- **Reduce motion.** Everything is off under your system's setting, or with its own switch in Settings. The printed resume never changes.
- **A tea garden** of leaves, rain and small visitors appears in Tea while you rest. It stops when you work, and a Settings switch turns it off.
- **Both pages side by side on one canvas,** or one at a time in a narrow window, with panning and pinch zoom. Each page has a meter and an overflow line.
- **Edit on the page.** Click a bullet to open its job, click again to write the line where it is printed.
- **A start screen in the editor's layout,** with a picture of old resumes becoming one record.
- **A Record tab** shows the whole record, with every line ticked or not. Ticking a line changes the open resume beside it.
- **Ways into the record** from the job chip's "n of m on" and each section's count.
- **Tick any list item on or off,** such as a skill group, language or certificate, and the last one off takes the section off.
- **Print items in an order of your own** by dragging or with Alt+Up and Alt+Down. The order belongs to that resume.
- **One tagging system** for bullets, skills, languages and certificates, kept as a list of at most 12 tags you manage in the Job types panel.
- **AGENTS.md covers what you may ask a coding agent for beyond picking,** such as new wording as new versions with a source, or changing a saved resume in place.

### Changed
- **One screen replaces Career and Resume.** The page and the editor panel sit side by side, and the record is a checklist you tick to put lines on the resume.
- **A job's fields are in a Details fold, and every form saves as you go.** There are no Save buttons, and each change is one undo step.
- **The editor panel folds to a rail,** automatically or by choice, and is a drawer on narrow windows.
- **Edit with nothing selected is "This resume",** with the sections and a Highlight row. Choosing a job type or tag only highlights, and Select these... applies it in one undo.
- **The header is two rows,** with the file on top and Edit, Record, Design and Export below.
- **One meaning of save.** The header shows autosave and Save to file, and the snapshot is Mark as sent in Export.
- **Zoom controls and a meter for each page share one line.**
- **The switcher grows into a Resumes list** with search, views by job type, date or company, and Compare.
- **New resume asks for the job type and starting point first.**
- **Toasts never cover the page.**
- **Keys are on a "?" sheet,** shown once the first time you select something.
- **Try the example opens at once,** and starting from scratch happens in a quiet editor.
- **Esc goes up one level:** line, job, page, then everything away.
- **One filled button.** Fit is filled only when it would change something, and otherwise Export's PDF is.
- **Full screen is now F.**
- **Better contrast** in all four combinations of drink and theme, with a sharper page edge by default.

### Removed
- **The Career workspace** and its separate controls. The record's language is the open resume's.

### Fixed
- **A control keeps its focus** when the screen redraws, so keyboard ticking and zooming no longer jump you to the top.
- **Clicking a bullet opens the panel at its top.**
- **The shortcut sheet's keys** no longer run into their labels and show the right symbols on a Mac.
- **Panning past the page edge** no longer jitters.

## 0.9.1 - 2026-10-12

### Added
- **Save to file.** One button saves the record and every saved resume as one file, and opening it anywhere brings everything back. Ctrl+S or Cmd+S saves from any view.
- **Safer opening of a file.** The app warns if you would lose unsaved changes or open an older file, and offers Save them first, Merge or Replace.
- **A script packs a data folder into the one file and back,** so agents can work on a folder while you keep one file.

### Changed
- **Back up is now Save to file.**
- **Text edited outside BrewCV in the one file** is offered as versions, as in a record file.
- **A linked folder is never written over a file changed outside the app.** The header offers Compare or Overwrite.
- **Copies a sync tool leaves after a conflict** are skipped and named.

## 0.9.0 - 2026-10-11

### Added
- **Settings shows the app's version,** also offline.
- **Job types are bundles of tags.** One click selects every bullet with any of those tags, and one undo reverses it.
- **Archive a claim or a whole job.** Archived items are hidden and never switched on by a new resume, Focus or Fit. Saved resumes print them as before.
- **A guide to tags, job types and archiving.**
- **A coding agent can tailor a resume from a job ad without writing a bullet,** using two scripts to list claims and write a saved resume. Open the file in the app to add it.
- **The command-line tools read the one file** the app saves.

### Changed
- **The page appears at once, in its place,** instead of three empty boxes.
- **New facts are no longer tagged with their section's name.**
- **Exporting a PDF from the command line needs no packages,** only an installed Chrome, Chromium, Brave or Edge.
- **The command-line PDF export says how many pages the PDF has.**
- **The logo is on the start screen and in the header.**
- **A reload returns to the start screen if only the example is open.**
- **The app is now called BrewCV,** at a new address. Your saved data and backups carry over.
- **A new app icon:** a teacup drawn from the letters C and V.
- **The start screen shows one record turning into a resume,** with four steps you can jump to and replay.
- **Tailoring picks facts, not only wordings.** Tick a fact on or off, or change wording, region, photo and page count, with a preview on hover.
- **Language chips change the start screen on hover,** and a click keeps the language.
- **The start card is quieter,** with the Yours to keep row as plain text.
- **The start screen fits without scrolling** on a laptop, and stacks on a tablet or phone.

### Fixed
- **It starts offline again.**
- **Fit never swaps a version for a draft or an archive copy.**
- **The keyword-gap report no longer lists "join" and "team"** as missing words.

## 0.8.0 - 2026-10-09

### Added
- **An introduction on the first start,** on a page of its own with a four-step walkthrough, a Why JSON? fold-out, the start choices and a Yours to keep banner. Its language chips switch the app, and the text is in all ten languages.
- **References.** A References group in Skills & credentials prints in its own section, off until you turn it on.
- **More JSON Resume fields in Career,** such as a job's website and a skill's level. They are not printed but appear in the JSON Resume export.
- **Delete a claim** with the bin beside it, from the record and every resume. Ctrl+Z brings it back.
- **Version numbers** that keep installed copies up to date on each deploy.

### Changed
- **In Career, the interface follows Career's language.**
- **The README is written for people using the app,** and developer details moved to a separate document.
- **The grade is `score`, JSON Resume's name for it,** and older records are renamed when opened.
- **A JSON Resume opened in the app comes back out with every field it had.**
- **The printed resume's JSON Resume keeps all standard fields.**
- **The iPhone and iPad home-screen icon works.**
- **No real name appears in the repo.**
- **A private-data guard no longer refuses a two-letter country code.**

### Removed
- **The old `workbench.html` redirect.**
- **One-off scripts and measurements for the original documents.**

### Fixed
- **The JSON Resume export wrote a degree's grade as `courses`.**
- **The name is written per language** in Career.
- **The language menu is as wide as its list.**
- **A failed draw no longer breaks the whole window.**
- **A saved session that can't be drawn starts over at the welcome card,** after keeping a checkpoint.
- **On localhost the app no longer shows an out-of-date example.**
- **The deploy workflow parses.**

## 0.7.4 - 2026-10-06

**Checks for one way of editing.** Internal checks only.

## 0.7.3 - 2026-10-06

**What differs is only what tailors.**

- **Career's list is flat:** every version is an equal row. A version written there is not picked by the open resume.
- **Arrow keys walk the claims and versions in Career,** Enter edits and Esc goes up one level.

## 0.7.2 - 2026-10-06

**Career opens the Resume's claim panel.** Both use the same version list, editor and write-in box.

## 0.7.1 - 2026-10-06

**Shared parts.** Career and Resume open the same panel for a claim. The Resume looks the same.

## 0.6.10 - 2026-10-06

**Scrollbars.** Thin, quiet scrollbars on every scrolling panel.

## 0.6.9 - 2026-10-06

**Scrolled pages.** A longer resume scrolls, and the footer shows how full the page in view is.

## 0.6.8 - 2026-10-06

**Kinds of your own.** Up to six custom kinds of entry, such as volunteering or talks, each with its own name, colour, icon and resume section.

## 0.6.7 - 2026-10-06

**Projects.** Projects print like jobs, with bullets in several versions chosen per resume.

## 0.6.6 - 2026-10-06

**Career, rebuilt.**

- **Three steps:** About you, Timeline, Skills and credentials, then on to tailoring a resume. Work and education sit side by side, and you can add any part of the record.
- **The resume shrinks to a thumbnail** beside Career. Every add, edit and delete is one undo step.

## 0.6.5 - 2026-10-06

**Examples in every language.** Fourteen invented example resumes, at least one per language. The German to Czech ones are machine-written and need a native review.

## 0.6.4 - 2026-10-06

**Choosing languages.**

- **A language step at first start-up,** and a list of the languages you use that limits every language menu.
- **Settings:** whether the app's language follows the open resume, and how longer resumes are paged.

## 0.6.3 - 2026-10-06

**Nine more interface languages:** German, French, Spanish, Italian, Portuguese, Dutch, Polish, Czech and Hungarian. All are machine-written and marked as needing a native review.

## 0.6.2 - 2026-10-06

**Ten languages for resumes.** English plus nine more, with each language's own headings, month names and paper size. English resumes are unchanged.

## 0.6.1 - 2026-10-06

**The interface catalogue.** Every word the app shows now comes from one catalogue per language, so the app can be translated.

## 0.5.13 - 2026-10-06

**Phone, accessibility and offline.**

- **A phone layout:** view a resume and pick versions from a bottom sheet. Editing stays on larger screens.
- **Accessibility pass** on every main view, and the app works offline.
- **Fuller example resumes,** and a rewritten README.
- **The old picker is removed.**

## 0.5.12 - 2026-10-06

**Onboarding and Career.**

- **A welcome card on first visit,** with a guided setup, or open a file, or try an example.
- **The Career workspace:** the record as a timeline, with every claim and its versions.

## 0.5.11 - 2026-10-06

**Design and theme tokens.**

- **Design view:** page count, Letter or A4, four templates and an accent colour.
- **The photo is cropped to a standard size,** with a choice of shape.
- **Themes can be read and written as design tokens.**
- **The gap beside the photo on A4 is gone.**

## 0.5.10 - 2026-10-06

**Export.** Pre-flight checks, then PDF, a self-contained HTML page, plain text for applicant-tracking systems, JSON Resume and a backup.

## 0.5.9 - 2026-10-06

**Import, merge, history.**

- **One way to import:** open a file, drop it anywhere or paste JSON. JSON Resume files import without losing sections the app doesn't draw.
- **A merge preview** before anything is added.
- **History:** checkpoints you can restore, download or compare with a file.

## 0.5.8 - 2026-10-06

**Languages.** An English or Hungarian switch per resume. Missing texts print in English, outlined, to write in place.

## 0.5.7 - 2026-10-06

**Tags and focus.** Tag a version, and fade or star the bullets that match a job type or tag.

## 0.5.6 - 2026-10-06

**Saved resumes.** Save a resume with company, role and tags, then open, reuse, compare or delete it. A saved resume keeps its words, and newer wording is offered on open.

## 0.5.5 - 2026-10-06

**The Edit view.** The Workbench has an editor for each bullet's versions. Bullets can be switched on and off and kept, and sections reordered by dragging.

## 0.5.4 - 2026-10-06

**The shell.** The page sits beside a column of cards. Click anything on it to select it, with undo, redo, Fit and autosave.

## 0.5.3 - 2026-10-06

**Renderer additions.** Resumes paginate into one, two or as many pages as needed, with per-resume section labels and a photo switch.

## 0.5.2 - 2026-10-06

**Store and persistence.** 200 undo steps, browser autosave, an optional linked folder, backup and restore.

## 0.5.1 - 2026-10-06

**A new file format.** One career record holds every version and language, and saved resumes are separate files. A fictional example career replaces the old one.

## 0.4.0 - 2026-10-05

**The picker and Fit.** Fit chooses among existing wordings and drops whole bullets to fill each page to 88 to 96 percent. It never rewrites text.

## 0.3.0 - 2026-09-15

**The renderer.** Resumes are now drawn from a library of wordings and a saved resume. The result is identical to the hand-written one-pager.

## 0.2.2 - 2026-09-15

**Earlier resumes and languages.** Wordings from earlier submitted resumes were added, and each wording has a language.

## 0.2.1 - 2026-09-15

**The fact library.** The content became a library of facts, each with tagged wordings.

## 0.1.0 - 2026-09-15

**The documents.** A US Letter one-pager and a European A4 CV, hand-written in HTML. It runs as an offline site with self-hosted fonts.
