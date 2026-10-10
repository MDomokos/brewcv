# BrewCV

**A resume tailored to each job, without rewriting it every time.**

Keep one career record. Make as many tailored resumes from it as you need, in ten languages.
It runs in your browser, works offline, and never uploads your data.

**[Open BrewCV →](https://MDomokos.github.io/brewcv/)**

<!-- Screenshot slots. Capture these with the example data (Try it with an example).
     Note: checks/preflight-deploy.mjs refuses images outside icons/, and .gitignore ignores
     *.png outside icons/. Before adding docs/*.png, add `!docs/*.png` to .gitignore and
     exclude docs/ from the rsync in .github/workflows/pages.yml.

![The introduction screen](docs/screenshot-intro.png)
![Editing a tailored resume](docs/screenshot-editor.png)
-->

## Why

Most people end up with ten near-identical Word and PDF files, one per application, each a
little out of date. BrewCV keeps **everything you've done in one JSON file**. Each
resume is a **selection** from that file: which lines are in, and which wording each one uses.

1. **Write each job once.** Every claim is stated once in your career record.
2. **Keep several wordings.** A line can have several versions (v1, v2, v2.1…), each in as
   many languages as you need.
3. **Pick one per resume.** Each tailored resume picks a version of each line. If you edit a
   wording once, every resume that uses it is offered the update.
4. **Export.** Print to PDF, or save as an HTML page, plain text, or JSON Resume, in the
   language you choose.

## Features

- **One career record, many tailored resumes.** A tailored resume holds which bullets are on,
  which version each one prints, the section order and headings, the paper and the design.
- **Fit.** It picks shorter versions and leaves out bullets until the last page is 88–96% full.
  Fit never rewrites your prose: it only chooses among versions you wrote, and tells you what
  it couldn't fit.
- **Tags and job-type focus.** Tag versions, then select every bullet that matches a job type
  or tag in one step. One undo reverses it, and bullets marked *Keep* are never touched.
- **Ten languages**, in the app and in every line: English, German, French, Spanish, Italian,
  Portuguese, Dutch, Polish, Czech and Hungarian. Switching language also switches an A4 resume
  to that country's A4 format. A line with no translation yet prints in English, outlined, so
  you can spot it.
- **Design.** One page, two, or as many as needed. Letter or A4, four templates, an accent
  colour with a live contrast check, and importable themes (CSS, JSON or DTCG design tokens).
  Photos are cropped to 35 × 45 mm, with a note on which countries expect one.
- **Export.** Pre-flight checks run first. Then you get a **PDF** (print, with the page size
  set), a self-contained **HTML page**, **plain text for ATS**, **JSON Resume**, or a full
  **backup**.
- **Import and merge.** Open a JSON Resume, a BrewCV record or backup, a saved resume,
  a theme or a photo. You can drop or paste it too. If a record is already open, a **merge
  preview** shows what would change before anything does. Edits made to the file in another
  tool, including an AI, come back as new versions.
- **Undo and history.** Every change can be undone (200 steps). A checkpoint is saved before
  every import, merge or restore. You can compare a checkpoint with now, restore it, or
  download it.
- **Actual size.** After a one-time calibration with a bank card, the page is drawn at its
  printed size.
- **On a phone** you can view resumes and pick versions. Editing needs a larger screen.

## Your data stays yours

- **Private.** Everything stays in your browser. There is no account, no server and no upload.
- **Standard files.** Every file it writes is valid [JSON Resume](https://jsonresume.org/schema).
  Versions, languages and tags live under `meta.resumeBuilder`. A saved resume is a JSON Resume
  file of the resume as printed, so any JSON Resume community theme can render it.
- **Why JSON?** It's plain text that any device, editor or tool can open, now and in twenty
  years. An AI can read and rewrite it directly: tighten wording, translate, spot gaps. And it
  follows the idea of [file over app](https://stephango.com/file-over-app): your content is a
  file you own, not data locked inside an app.
- **No lock-in. Back up!** Your work is saved in the browser on every change, but browser
  storage can be cleared. Use *⋯ › Back up* to download everything in one file, or
  *⋯ › Link a folder* (Chrome, Edge) to mirror your record to `resume-data.json`, and each saved
  resume to `recipes/`, on your disk.

## Getting started

1. Open **[the app](https://MDomokos.github.io/brewcv/)**.
2. Choose how to start:
   - **Start from scratch.** It asks a few questions (about five minutes) and fills the page as
     you type.
   - **Open or import a file.** A JSON Resume, a backup, or a BrewCV record.
   - **Try it with an example.** A finished, fictional record with fourteen tailored resumes
     across all ten languages.
3. **Install it** (optional): use your browser's *Install app* / *Add to Home Screen*. Once
   installed it works offline.

Click anything on the page to edit it.

## Other ways out

These happen outside the app and don't need anything installed in it.

<details>
<summary><b>Open in Figma</b> (one way)</summary>

1. *Export › HTML page*.
2. In Figma, run the **html.to.design** plugin and paste the file's contents into its code tab.
   The page becomes editable layers.
3. Finish the design there, and export a PDF from Figma.

Changes made in Figma don't come back into the editor. Make wording changes in the editor
first, then export again. To change only colours and type and keep them in the app, use the
theme route in [`figma/README.md`](figma/README.md) instead: tokens go to Figma Variables and
come back.

</details>

<details>
<summary><b>JSON Resume community themes</b></summary>

1. *Export › JSON Resume*. This is the resume as printed, with one version per bullet. (A saved
   resume's file in `recipes/` is already one.)
2. Install the CLI and a theme:
   ```
   npm install -g resumed
   npm install jsonresume-theme-even
   ```
3. Render it, then print the HTML to PDF:
   ```
   resumed render resume.json --theme jsonresume-theme-even
   ```

What you lose on the way:

- **Fit and page control.** The theme lays the page out its own way.
- **The photo and language support**, which vary by theme.
- **Other languages.** Only the resume's own language is exported.

Each theme has its own licence. Check it before you publish what it renders.

</details>

## Translations need native speakers

English is the original. The other nine interface translations, and eight of the example
resumes, were machine-written and **need a native speaker's review**. The app tells you this
when you choose a language. Corrections go in `src/i18n/<lang>.js`. See
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the check that keeps the translation files
consistent.

## Running it yourself

There's nothing to build: it's plain HTML, CSS and JavaScript, with no framework and no
dependencies. Serve the folder over HTTP:

```
python3 -m http.server 8000     # then open http://localhost:8000/
npx serve                       # if Node is closer to hand
```

Browsers won't load ES modules from `file://`, so opening `index.html` straight from disk shows
a note saying so. An exported HTML resume has no script, so it opens from disk anywhere.

To host your own copy, fork the repo and enable GitHub Pages with *GitHub Actions* as the
source. `.github/workflows/pages.yml` publishes on every push to `main`.

## Contributing

The code layout, the Node and browser checks, the command-line scripts, the deploy guards and
the project's history are in **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**. Changes are listed
in [CHANGELOG.md](CHANGELOG.md).

## Acknowledgements

- [JSON Resume](https://jsonresume.org) (MIT): the schema's field vocabulary and date format.
- [Resume Matcher](https://github.com/srbhr/Resume-Matcher) (Apache-2.0): the idea of reporting
  job-ad keywords your resume doesn't cover. It was reimplemented from scratch, with no network
  calls and no LLM.

No code from any other project is vendored or copied. Projects that were looked at and
deliberately not used are listed in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#prior-art-and-what-was-taken-from-it).

## License

[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html). Fonts: Hanken Grotesk and Fira Code,
both under the SIL Open Font License; their licences are in `fonts/`.
