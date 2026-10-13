# Developing BrewCV

Everything behind the app: how it's built, how it's checked, how it ships, and how private data is kept out of the repo. For what the app does and how to use it, see the [README](../README.md).

## Principles

Vanilla HTML, CSS and JavaScript: no build step, no bundler, no framework, no runtime dependency. What is in this repo is what the browser runs, and it has to still run in 2029 without `npm install` resolving.

Every file it writes is a valid [JSON Resume](https://jsonresume.org/schema). The record's summary and highlights are each claim's default version; versions, languages and tags live under `meta.resumeBuilder`. A saved resume is its own file: the resume as printed (any JSON Resume community theme can render it), with its selection under `meta.resumeBuilder.resume`.

A **format** owns the page and a **theme** owns the appearance. Neither references the other, which is what lets one theme render at both sizes.

## Layout

```
index.html                 the app (the Workbench) and the homepage when deployed
manifest.webmanifest, sw.js   installable, offline (bump VERSION in sw.js with any shell change)
templates/                 the page templates: holes the renderer fills
formats/                   page box, margins, horizontal grid (Letter, A4, Hungarian A4)
themes/                    type and colour (b2-marker + overlays) and their *.tokens.json
fonts/                     Hanken Grotesk 400/700/800 · Fira Code 400, self-hosted
figma/README.md            the theme round trip through Figma Variables
src/render.js              library + recipe → pages (the same module in the app and in Node)
src/fit.js, paginate.js    Fit, and block pagination
src/recipe.js, data.js     what a recipe's keys mean; file helpers for the CLI
src/export.js              the HTML page, plain text, JSON Resume, pre-flight
src/model/                 pure, tested in Node:
  schema.js                  resume-data/4: detect, load, save, migrate, saved-resume files
  resume.js                  the selection rule, resolve(), the tailoring edits
  record.js                  version numbers, save over / as, delete, the word diff, and the word move (which words of one version are the words of another)
  resumes.js                 saved resumes: autosave (settle), snapshots and sends, open, frozen text, compare, new, duplicate
  focus.js                   tags and job-type focus
  lang.js                    languages: the ten, their paper, missing texts, switching, languages in use
  entries.js                 work, projects and custom kinds as one list of printable entries
  build.js, import.js        a record from fields; the one import door; JSON Resume in
  diff.js                    the merge engine (also History and Compare with a file)
  tokens.js                  theme tokens: CSS, simple JSON and DTCG in, DTCG out
  career.js                  the record: the timeline, the lists, every add / edit / delete, custom kinds
  checklist.js               the record as a checklist: the groups, the rows, what is on this resume, the group a selection is in, the groups a section prints
src/store/                 store.js (state + undo) · persist.js (autosave, folder, backup, checkpoints)
src/i18n/                  index.js (t, plurals, fallback to English) · en.js · nine machine-written
                           catalogues, each marked NEEDS A NATIVE REVIEW
src/ui/                    the Workbench: shell, sheet (the iframe), layout, select, edit,
                           resumes, switcher, files, export, design, onboarding, settings,
                           langmenu, actual size; dock (the panel that folds to a rail, the zoom bar,
                           hover hints), checklist (the record's groups, drawn by record.js and, at the job level,
                           beside the job), record (the Record tab: the way in and the way round), career (the
                           record's forms and the timeline), help (the shortcut sheet), icons, drink (Tea or
                           Coffee, light or dark: the two settings, the corner that asks, Shift+F),
                           drink-boot (the same two settings on <html> before the first paint);
                           motion (the rules every animation follows: durations and easings read from :root, off under
                           prefers-reduced-motion and the Reduce motion setting, a new animation replaces the last), pagemotion
                           (Fit, a version under the pointer, a lens, a tick and a resume switch, shown on the page with
                           clones in the frame that leave nothing behind), arrive (the start screen and the quiet
                           onboarding turning into the editor), matroll (the logo as the Tea and Coffee switch: the mat
                           rolls up and unrolls), exportfx (an export's picture, one for each drink);
                           workbench.css (the tokens: one block per drink and theme, and every rule that uses
                           them) and drinks.css (the shapes and surfaces that make each drink itself);
                           parts.js, the pure string parts (crumb, rows, version list, editor,
                           write-in, and the on-page breadcrumb, tools and version badge) the panels share;
                           camera (the pure maths of the page canvas: both pages or one, soft limits, the
                           magnet, which page is bright, the spring), canvas (moves the sheet with the camera
                           and reads the wheel, the hand and the pinch), onpage (the three levels drawn over
                           the page, a line written where it is printed, its tools in the margin), plain (the
                           text of a line being written, read back from the page), start (the start screen:
                           its header, inspector and footer areas, and the picture of how it works) with
                           start.css (every colour a token, like the other two stylesheets)
scripts/                   render, fit, export-pdf, tokens, theme-check, i18n-review, build-example, to-jsonresume,
                           claims and new-resume (what a coding agent uses; see AGENTS.md), onefile (a folder ↔ the one file)
checks/                    the Node checks, the Chromium smoke test, the guards
data/example.json          the fictional sample record, and data/example-resumes/ its fourteen
                           resumes (one or more per language; all but English and Hungarian need
                           a native review)
docs/                      this guide, THEMES.md (making a theme), PRIVACY.md (checking what the app sends)
```

## Translations

Every catalogue but English is **machine-written and needs a native review**; the app says so where you choose one. Corrections go in `src/i18n/<lang>.js`, and `checks/i18n-check.mjs` keeps them honest (keys, placeholders, plurals, markup, the review marker).

## Checks

The Node ones need nothing installed:

```
node checks/model-check.mjs [lib]     schema v4, migration, saved-resume files; with your library,
                                      every recipe renders byte-identical to before 0.5.1
node checks/store-check.mjs           undo, autosave, folder mirror, backup, checkpoints
node checks/paginate-check.mjs [lib]  block pagination, Fit on the last page, labels, photo, fields
node checks/shell-check.mjs           layout maths (the panel, and Record's wider one), click targets, Esc, folder read back
node checks/camera-check.mjs          the canvas camera: both pages or one, soft limits, the magnet, which page is bright, the spring
node checks/edit-check.mjs            version numbers, edits, off/keep, sections, 300 random edits
node checks/resumes-check.mjs         autosave, snapshots and sends, frozen text and newer wording, new, duplicate, compare, folder
node checks/focus-check.mjs           tags, plan = apply, Keep untouched, no job emptied
node checks/lang-check.mjs            the ten languages, missing texts, switching, A4 formats
node checks/i18n-check.mjs            every catalogue: keys, placeholders, plurals, markup, the review marker
node checks/diff-check.mjs            the merge engine on an edited copy of the example
node checks/import-check.mjs          every kind of file, JSON Resume round trip, outside edits
node checks/savefile-check.mjs        Save to file: the format and its record id, the four ways a file meets this browser,
                                      outside edits in a backup, conflict copies, the folder overwrite guard, onefile.mjs
node checks/export-check.mjs          the HTML page, plain text, JSON Resume, pre-flight
node checks/tokens-check.mjs          theme tokens: forms, refusals, DTCG round trip, contrast
node checks/drink-check.mjs [--table] the app's own tokens: every role in Tea and Coffee, text at AA and edges at 3:1 in all four
                                      light and dark combinations, no colour written outside a token block, the setting
node checks/motion-check.mjs          the rules motion follows: tokens of 150 to 400 ms, one reduced-motion rule, nothing blocks or queues, no library,
                                      the printed page never imported, each of the thirteen moments wired, both logo tiles, the ux4. strings
                                      (what each moment starts, and that reduced motion starts none, is in smoke-shell's "motion:" section)
node checks/garden-check.mjs          the tea garden in Chromium (slow, about two minutes; ONLY=flow,rain runs some): a clean start, waves, sweeping, the way back,
                                      rain, creatures, the pause, coffee, the setting, the print gate, axe (AXE_CORE=...)
node checks/csp-check.mjs             the Content-Security-Policy in index.html and the templates: same-origin only,
                                      no inline script; no outside address in any fetch
node checks/preload-check.mjs         index.html preloads exactly the modules shell.js imports (or loads on demand), and sw.js caches them
node checks/i18n-review-check.mjs     the translation review sheets: the CSV, and --apply on a temporary copy
node checks/career-check.mjs          the record's model (timeline, lists, add / edit / delete, projects, kinds), its forms (a field commits when
                                      you leave it, Esc puts it back), the checklist's archived folds, job types, the Highlight lens, and
                                      the ledger of what Career's old actions became
node checks/parts-check.mjs           the panels' markup unchanged by the shared parts; a claim opened from the page or from the
                                      checklist is the same panel and writes the same record; 🗑, + Add, the
                                      Details fold of a job, the keys
node checks/recipe-check.mjs          weight, off / keep, weight-0 omit
node checks/preflight-check.mjs       preflight refuses embedded image metadata and a prototypes/ folder
node checks/history-scan-check.mjs    history-scan reads commit messages, authors and committers
node checks/agent-check.mjs           the agent workflow on the example: claims, new-resume and every refusal,
                                      fit on the line model, JSON Resume, the keyword gap
node checks/fit-check.mjs [lib]       Fit's invariants on a modelled page
node checks/validate-data.mjs <file>  the schema guard
node scripts/tokens.mjs --check       the built-in themes' token files are up to date
node checks/version-check.mjs         package.json, sw.js and CHANGELOG.md name the same version
node checks/name-check.mjs [dir]      the old product name only in released changelog entries and kept identifiers
```

The browser ones need `playwright` and a Chromium on the machine (dev only; the app needs neither):

```
node checks/smoke-shell.mjs                   the app end to end: every view, at three window
                                              sizes and on a phone, offline, from a subpath; both drinks in light and dark
                                              (the switch, the cup and the shot glass, Fit's one filled button, axe in all four)
ONLY=import,export node checks/smoke-shell.mjs  just the sections whose name has one of those
node checks/tokens-check.mjs --browser        the built-in themes as tokens measure 0.00px
node checks/paginate-check.mjs [lib] --browser
node checks/fit-check.mjs [lib] --browser
node checks/label-fit.mjs                     every language's resume headings fit the gutter, and the app's own new labels fit
                                              the panel (the modes on one row, the header, zoom bar, lens, checklist, switcher)
AXE_CORE=/path/to/axe.min.js node checks/smoke-shell.mjs
                                              also runs axe-core on every main view (axe-core is a dev tool, not a dependency)
node checks/measure.mjs <rendered> <reference>    geometry diff, 0.00px expected
node checks/render-diff.mjs <rendered> <reference>   markup diff, tag by tag
```

A library path makes a check read that library's recipes and print counts only, never text, and never write to it.

## The command line

```
node scripts/render.mjs <data.json> <recipe.json> <out.html>        a record + a resume → a document
node scripts/fit.mjs    <data.json> <recipe.json> --fit [--add]     Fit, measured in Chromium
node scripts/fit.mjs    <data.json> <recipe.json> --fit --model 6.7 a labelled dry plan, no browser
node scripts/export-pdf.mjs out/resume.html out/resume.pdf          optional; a Chrome, Chromium, Brave or Edge, no packages
node scripts/to-jsonresume.mjs <data.json> [recipe.json]           flat JSON Resume, the ATS path
node scripts/claims.mjs <data.json> [--lang en] [--tag t] [--job id] [--json]
                                                                   every claim and its versions; writes nothing
node scripts/new-resume.mjs <data.json> <picks.json> <out-dir> [--force]
                                                                   a saved resume from a list of picks; takes no text
node scripts/onefile.mjs pack <data-dir> <out.json> [--force]       a data folder → the one file (brewcv.json)
node scripts/onefile.mjs unpack <file.json> <data-dir> [--force]    the one file → a data folder
node checks/keyword-gap.mjs <data.json> <ad.txt>                   ad words the record can't say
node scripts/build-example.mjs data/example.json                   regenerate the fictional sample
node scripts/tokens.mjs                                            the built-in themes as DTCG
node scripts/theme-check.mjs <theme.tokens.json|.css>              what the app makes of a theme file
node scripts/i18n-review.mjs <lang|all> [--out <dir>]              a review sheet (CSV) per language
node scripts/i18n-review.mjs --apply <sheet.csv>                   write a sheet's corrections into src/i18n/
```

Every script that takes `<data.json>` except `checks/validate-data.mjs` reads either a record file or the one file (the app's backup, `resumeBuilderBackup: 1`; its record is used). Every script reads a record through `src/model/schema.js`, so `resume-data/3` and `/4` both work everywhere; anything that writes one writes v4, and keeps a v3 original once as `<name>.v3.json`. Fit never rewrites prose: it chooses among the versions that exist, drops whole bullets, and reports what it couldn't do.

**Comparing against a reference.** `checks/measure.mjs` (layout, to 0.00px) and `checks/render-diff.mjs` (markup) compare a rendered document with a hand-written one you pass in. New renderer features sit behind recipe keys, so an old recipe renders exactly as it did.

## Desktop build (macOS, preview)

An experimental [Tauri 2](https://tauri.app) wrapper in `src-tauri/`. The app itself is unchanged: `scripts/desktop-stage.mjs` copies the files it loads into the gitignored `_desktop/` (names normalised to Unicode NFC; the staged `index.html` alone also allows Tauri's IPC in `connect-src`, so the web build's policy stays `'self'`), and Tauri bundles that folder. `checks/desktop-check.mjs` keeps the copy list whole. The stage script leaves out what the website's deploy leaves out (`*.local.json`, `resume-data.json`, `data/recipes/`): `data/identity.local.json` is ignored by git but sits in the working tree, and the app would embed it in its binary. `beforeBuildCommand` then runs `checks/preflight-deploy.mjs _desktop --app`, the deploy's privacy gate without its web-only requirements (`sw.js`, `.nojekyll`), and the build stops on a finding. In the desktop app, Export > PDF asks for a file name and writes the PDF directly (macOS only; elsewhere it falls back to the print dialog). Link a folder works too (below); updates are not in this build.

Prerequisites: Rust (`brew install rustup`, then `rustup default stable`) and the Tauri CLI, which is not a dependency of this repo. Run it with `npx @tauri-apps/cli@2.12.2 ...` (or `cargo install tauri-cli --version '~2.12'` and `cargo tauri ...`). The `tauri` crate is pinned to a minor version because the raw WKWebView types behind the PDF export can change between minors.

```
node scripts/desktop-stage.mjs                              # only the staging
node checks/preflight-deploy.mjs _desktop --app              # the deploy's gate on the staged copy (the build runs it too)
npx @tauri-apps/cli@2.12.2 build --debug --no-bundle         # stages, then builds src-tauri/target/debug/brewcv
npx @tauri-apps/cli@2.12.2 icon icons/icon.svg -o src-tauri/icons   # after the icon changes (then delete android/ and ios/)
```

### Folder linking in the desktop app

WKWebView has no `showDirectoryPicker`, so `src/store/persist.js` has a third folder object beside `fsaFolder` and `memoryFolder`: `tauriFolder(path)`, with the same methods, on the fs plugin's `readTextFile`, `writeTextFile`, `readDir`, `mkdir`, `remove` and `exists`. `tauriApi()` detects `window.__TAURI__.fs` and `.dialog`; without them (every browser) nothing changes. Link a folder then uses `dialog.open({ directory: true, recursive: true })`, and the rest of the flow (`adoptFolder`, the "use the folder's resumes?" question) is the same.

- **What is kept across restarts is the folder's path** (a string), stored where the browser keeps its handle (`handle/folder`); `folderOf(h)` turns either kind back into a folder. The permission is kept by `tauri-plugin-persisted-scope`, which saves the scope the dialog added and restores it at launch. It must be registered after `tauri-plugin-fs`, and needs Rust 1.90 or newer.
- **No prompt on reconnect.** `permission()` is `granted` while `exists(path)` works and `prompt` when it throws or says no (folder moved, deleted, scope lost). The reconnect row's button then opens the folder dialog, starting beside the old folder, so a folder that has moved can be found; a path has no permission to ask for, unlike a browser handle.
- **Questions use Tauri's own dialog (`src/ui/ask.js`).** The desktop web view does not show a blocking `confirm()`: the code carried on as if the answer were yes, and a typed draft was discarded without a word. `askOk()` uses `dialog.ask` there and `confirm()` in browsers. The folder question (`adoptFolder`) and "discard what you typed?" (`cancelEdit`, `leaving`) go through it; because the native dialog is asynchronous, `leaving()` stays where you are, asks, and on yes drops the draft and goes where you were going. `prompt()` is not available there either: in the desktop app, History has a name field on the page (`inDesktop()` in `src/ui/ask.js`), and browsers keep `prompt()`.
- **What the capability allows.** `capabilities/default.json` lists `dialog:allow-open` and the fs commands the code uses (`read-text-file`, `write-text-file`, `read-dir`, `mkdir`, `remove`, `exists`), and no fs scope. Those permissions carry no pre-configured scope, so every fs call is refused until the person picks a folder in the dialog; then the app can reach that folder and below, nothing else. Only the `main` window has them (`capabilities/default.json`); the hidden `print*` windows have `capabilities/print.json`: events and closing themselves. They call `print_pdf`, a command of the app's own, and nothing else.
- Not run on a second Mac, Windows or Linux, or in a sandboxed or notarized build. `checks/tauri-folder-check.mjs` drives the folder object against a fake `window.__TAURI__` (an in-memory disk with a scope).
- **Still disabled for lack of the File System Access API:** nothing else is gated by it. Open and Save to file in `src/data.js` use `showOpenFilePicker` / `showSaveFilePicker` when present and fall back to a file input and an anchor download. The file input is standard; whether WKWebView in Tauri saves the anchor download was not tested (the PDF has its own save path).

### Rules the desktop PDF export depends on

Each of these was learned from a failure on a Mac; the checks and comments name them where they can.

- **Only the modal print call.** `print_pdf` (`src-tauri/src/lib.rs`) uses `runOperationModalForWindow`. Plain `runOperation` blocks the main thread, freezes the app and wrote a PDF that grew past 600 MB. When testing a change to it, keep a guard that kills the app and deletes any test PDF over 50 MB.
- **The print window needs the app's CSP rules for styles, fonts and images.** The export is one page with inline `<style>` and `data:` fonts. `desktop/print.html` must allow them or the PDF is unstyled serif text; `checks/desktop-check.mjs` asserts it. Scripts there stay limited to the app's own files.
- **Paper follows the format.** The page size in CSS px (`pageSize()` in `src/ui/layout.js`) times 0.75 is the paper in points, so Letter prints on Letter. WebKit still takes the sheet size from the stylesheet's `@page`, which is why `.page` is one pixel shorter in print (`themes/b2-marker.css`): A4 is 1122.5 px, the page box 1123 px, and the sliver made a blank page after every page.
- **Print CSS stays plain.** macOS's PDF engine drew dark fringes round a gradient with hard `transparent` edges (the highlighter); it is one solid band now. Avoid transparent gradient stops, masks, blend modes and blurred shadows in anything the print path loads.
- **No ligatures** (`font-variant-ligatures: none` on `html, body`). The macOS engine wrote the "ff" glyph as "!" in the text layer, which breaks copy-paste and ATS parsers. Off everywhere so the screen, Fit and every export wrap the same.
- **File names are NFC.** macOS can hold names with decomposed accents, and Tauri then serves its own page instead of the file (the example resumes failed to load). The stage script normalises names, and `loadExample` skips an example that comes back as a page.

Not in the desktop build yet: the updater, a Windows or Linux PDF save (they fall back to the print dialog), a release build with signing and notarization. The Version line in Settings shows a dash, because `sw.js` is not staged.

## The one package.json

`{"type": "module"}`, three lines, no dependencies and no scripts. Node needs it to read `src/render.js` as an ES module when `scripts/render.mjs` imports it; without it, older Node treats a `.js` file as CommonJS and the import fails. It is not a build step and nothing installs from it. `playwright` stays confined to `checks/`; `scripts/export-pdf.mjs` drives an installed Chrome, Chromium, Brave or Edge over the DevTools protocol (set `CHROME_PATH` to choose one), and the app runs without any of it.

## Deploying

`.github/workflows/pages.yml` publishes to GitHub Pages on push to `main`. No build step: it copies the repo to `_site` minus `.git`, `.github`, `node_modules`, `out` and anything private, runs the guards against that assembled tree, and uploads it. The tree the browser fetches is the tree in the repo, so the same relative paths work whether you serve the folder locally or land on `https://<user>.github.io/brewcv/`.

Pages serves a project site from a subpath, so **every path here is relative**: `start_url` and `scope` in the manifest are `"."`, never `"/"`. The preflight fails on any root-absolute `href` or `src`.

The service worker (`sw.js`) is cache-first on a deployed copy and network-first on localhost. Its cache is the app's version; the deploy appends the commit (`0.8.0+1a2b3c4`), so every deploy replaces installed copies' caches and there is nothing to bump by hand.

## Real data is not in this repo

Contact details live in `data/identity.local.json`, which is gitignored. The frozen 0.1.0 documents carry `{{email}}`, `{{phone}}` and `{{city}}`, and `scripts/lib/identity.mjs` fills them in for the checks that measure those documents (`measure.mjs`, `render-diff.mjs`). The one-off script that extracted the first library from them, and its data, live outside the repo. Without that file everything runs on placeholders.

Nothing in `templates/` carries any of it any more: the content is a hole, the library lives outside the repo, and a rendered document goes to `out/`, which is gitignored.

`checks/preflight-deploy.mjs` enforces it. It runs against the tree about to ship and does not need the real values to catch them: in a repo whose only person is fictional, any contactable email address or real-looking phone number is a finding. It also refuses a `resume-data.json`, a `*.local.json`, a recipe, a PDF, an image outside `icons/`, a root-absolute path, and a service worker whose precache list points at a file that is not there.

```
node checks/preflight-deploy.mjs          # exit 1 means do not publish
```

### `.gitignore` covers the tree. `history-scan.mjs` covers the past.

`preflight-deploy.mjs` reads the tree about to ship. It says nothing about the commits behind it: a file added and deleted again is still in every clone, and preflight will report **clean, safe to publish** regardless.

```
node checks/history-scan.mjs              # run this BEFORE adding a remote
```

It scans every revision for contactable addresses, phone numbers, embedded images, and filenames that should never have existed, deleted or not.

**While the repo is local and unpushed, a bad history costs one command to fix:**

```
git checkout --orphan clean && git add -A && git commit -m "…"
git branch -D main && git branch -m clean main
```

After a push it costs a force-push that rewrites every clone, and the old objects stay reachable on GitHub's side for a while regardless. Commit freely now, run `history-scan` before the first `git remote add`, reset the history then if it finds anything.

### The ignore rules are not anchored

Every rule matches at **any depth**: `resume-data.json`, not `/data/resume-data.json`. An anchored rule covers one directory, and a private file usually reaches a commit by being copied somewhere else first: a library dropped at the repo root to test something, a portrait left beside a template. Images are ignored wholesale with `!icons/*.png` carved back out.

**It passes as of 0.3.0**, which replaced the content in `templates/` with holes. Before the first `git init` there is no git to ask what is ignored, so the check reads `.gitignore` itself and says which way it answered. Two gitignored files extend the check for values that must never ship but must also not be written down in a public repo:

```
data/identity.local.json    { "email": "…", "phone": "…", "city": "…" }
checks/deny.local.json      { "deny": ["a retired address", "an old figure"] }
```

`resume-data.json` itself lives outside the repo, and `.gitignore`, written before any other file here, keeps it and the rendered PDFs out. Check `.gitignore` before the first `git add`, not after.

## Status

0.1.0–0.4.0 built the documents, the fact library, the renderer and Fit. 0.5.1–0.5.13 built the app, 0.6.1–0.6.10 added the ten languages, Settings, the Career redesign and scrolled pages, and 0.7.1–0.7.4 gave Career and Resume one editing menu. 0.8.0 is the first public release. The nine non-English catalogues and eight of the example resumes still need a native speaker's review. What each version changed is in [CHANGELOG.md](../CHANGELOG.md).

## Versioning and releases

The app's version is in `package.json` and nowhere else by hand. It follows [Semantic Versioning](https://semver.org/), read for an app whose public interface is its files.

**Three different things are called versions here. Keep them apart:**
- the **app version**, `0.8.0`, tagged `v0.8.0`;
- the **file format**, `resume-data/4` (`SCHEMA` in `src/model/schema.js`), which changes only when saved files change shape, and always with a migration from the one before;
- a claim's **wording versions**, `v1`, `v2.1`, which are the user's content.

**Which number goes up.** While the app is 0.x:
- **minor** (0.8.0 → 0.9.0) for new features, and for anything that breaks: a new `resume-data/N`, a removed feature, a file an earlier version saved that no longer opens the same way;
- **patch** (0.8.0 → 0.8.1) for fixes, translation corrections and docs, with nothing new to learn.

From 1.0.0 on, breaking changes take the major number instead, and features the minor. Moving to 1.0.0 is a decision, not a count: when the format and the interface are ones you will keep supporting (for example, once the translations have had their native review).

**Day to day.**
- Every user-visible change gets a line under `## Unreleased` in `CHANGELOG.md`, in the same change, under *Added*, *Changed*, *Deprecated*, *Removed*, *Fixed* or *Security*, in that order. Describe the result, not the steps: if an unreleased entry is revised before the release, edit it rather than adding another. Internal refactors and check-only changes need no entry.
- No milestone or stage numbers in code, check names, comments or commit messages. Name the feature, or the version when history matters (`before 0.5.1`, `the 0.4.0 pins`).
- `package.json` keeps the last released version until the next release; `sw.js` needs nothing, because the deploy stamps the commit into its cache name.

**Releasing.**
1. Decide the number from what is under `## Unreleased`.
2. In `CHANGELOG.md`, rename `## Unreleased` to `## X.Y.Z - YYYY-MM-DD` (today), and open a new, empty `## Unreleased` above it.
3. Set `"version"` in `package.json` and `VERSION = 'X.Y.Z'` in `sw.js`.
4. `node checks/version-check.mjs` and the other checks pass.
5. Commit as `Release X.Y.Z`, tag it `vX.Y.Z` (annotated: `git tag -a vX.Y.Z -m "X.Y.Z"`), and push the commit and the tag. Optionally, make a GitHub release from the tag with that version's changelog section as its notes.

Pushing to `main` deploys whether or not it is a release, so the live site can be ahead of the last tag. The changelog's *Unreleased* says by how much.

## The interface, in detail

The README lists the features; this is the full tour as it stood at 0.7.4, kept for reference.

- **First visit.** *Start from scratch* asks a few questions (about you; where you'll send it; your most recent job, one claim per line; education; skills; a photo where one is expected) and fills the page as you type. Or *Open or import a file*, or *Try it with an example*.
- **Click anything on the page** to work on it. A **bullet** shows its versions, the one in use first and in full.
- **Tags and focus.** Tag the version in use (type, Enter). Click a job type or tag to see which bullets have a matching version, then *Select bullets for X*: one undo step, never touching *Keep*.
- **Languages:** English, German, French, Spanish, Italian, Portuguese, Dutch, Polish, Czech and Hungarian. Switching moves an A4 resume to that language's A4 format. A text with no version in the resume's language prints in English, outlined, and is listed in the card; click it to write it, or mark it *same in every language*.
- **Design:** one page, two, or as many as needed; Letter or A4; four templates; an accent with a live contrast check; themes (import CSS, JSON or DTCG design tokens, export DTCG); the photo (cropped to 35 × 45 mm, with a note on where photos are expected).
- **Export:** pre-flight checks, then **PDF** (print, with the page size set), a self-contained **HTML page**, **plain text / ATS**, **JSON Resume**, and a **backup** of everything.
- **Files.** *⋯ › Open or import* (or drop a file anywhere, or paste JSON) reads a JSON Resume, a BrewCV record or backup, a saved resume, a theme or a photo. With a record already open it shows a **merge preview** (*Will add*, *Different values*, *Only in yours*) before anything changes. A record edited in another tool has those edits turned into versions.
- **History.** Every change is undoable (Ctrl+Z, 200 steps). Checkpoints are saved before every import, merge, replace and restore, and on each first save; *⋯ › History* compares one with now, restores it or downloads it, and compares any file with the open record.
- **Storage.** Your work is saved in this browser on every change. *⋯ › Link a folder* (Chrome, Edge) also mirrors the record to `resume-data.json` and each saved resume to `recipes/` on disk. *Back up* downloads everything in one file.
- **Actual size** draws the page at its printed size after a one-time bank-card calibration.
- **On a phone** the page fills the width and a bottom sheet lets you view a resume and pick versions. Editing is for larger screens.

## Prior art, and what was taken from it

The render half of this problem is solved several times over in the open. The library half (tagged variants of one fact, a recipe per application, a fitter that picks phrasing lengths to hit a page-fill target) has no working open-source implementation, which is why this repo exists.

**No code from any project below is vendored, copied or derived here.** Two things were taken: a published schema vocabulary, and one idea. Everything else is listed because it was read and deliberately not used, which is worth recording.

### Taken

| project | licence | what was taken |
|---|---|---|
| [JSON Resume](https://jsonresume.org) | MIT (schema) | **The field vocabulary.** `basics · work · education · publications · skills · certificates · languages · interests`, with JSON Resume's own key names: `name`, `label`, `position`, `startDate`, `institution`, `studyType`, `keywords`, `fluency` — and its `YYYY-MM` dates. The variant layer sits above it; `scripts/to-jsonresume.mjs` collapses a recipe down to flat JSON Resume, which makes every MIT-licensed JSON Resume theme an extra output and the ATS-plain path an export rather than a stylesheet. No JSON Resume code is used, and the local schema adds `facts`, `variants`, `sections` and `display` refs that JSON Resume does not have. |
| [Resume Matcher](https://github.com/srbhr/Resume-Matcher) | Apache-2.0 | **One idea, reimplemented from scratch: report the ad keywords that match nothing.** `checks/keyword-gap.mjs` is ~140 original lines with no network call and no LLM. Resume Matcher's own approach (having a model rewrite bullets to close the gap) is deliberately *not* taken: rewriting prose is exactly what this tool avoids, so this only ever reports, and a human decides whether a gap is a real one or a phrasing one. |

### Read, and deliberately not used

| project | licence | why not |
|---|---|---|
| [RenderCV](https://github.com/rendercv/rendercv) | MIT | YAML → Typst → PDF, and good at it. Confirms structured-data-to-typeset-document is a solved problem, which is this repo's 0.1.0 + 0.3.0. Has no notion of a variant, so it cannot do the part that matters here. |
| [YAMLResume](https://github.com/yamlresume/yamlresume) | MIT | Same conclusion as RenderCV, via LaTeX/HTML. One fact, one phrasing, one file per application. |
| [Reactive Resume](https://github.com/AmruthPillai/Reactive-Resume) | MIT | Its editor is better than an evening of vanilla JS will produce, but its architecture is the opposite of every constraint here: Next.js, Postgres, Drizzle, Docker against *no build step, opens from disk in 2029*. Read its theme CSS for reference for the 0.4.0 picker. Took nothing. |
| [OpenResume](https://github.com/xitanggg/open-resume) | **AGPL-3.0** | Its PDF→structured-data parser is the interesting part and would have been useful for importing old PDF resumes. Not vendored: AGPL-3.0 in a public repo needs a deliberate choice. The 0.2.1 extraction used an original parser over the project's own HTML instead (`scripts/lib/html.mjs`; the script itself is kept outside the repo). |
| [ResumeForge](https://github.com/ZenzerJs/ResumeForge) | private | Independently arrived at an "Evidence Bank" where every bullet traces to a verified item, the same idea as this repo's `source:` field. Useful as validation that the idea is right. Unusable: licence is listed as private. |
| [Typst](https://typst.app) | Apache-2.0 | An option for a PDF backend if headless Chrome proves fragile. RenderCV and ResumeForge both compile it in-browser via WASM. Not a reason to change the documents: the design is CSS and stays CSS. |

## Fonts

Hanken Grotesk and Fira Code, both SIL Open Font License, self-hosted and redistributed here. Licences in `fonts/`.
