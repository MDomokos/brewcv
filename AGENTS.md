# How to tailor a CV with BrewCV

For a coding agent that has been asked to turn a job ad into a resume. You choose among wordings that already exist. You never write one, unless the person asks you to: then follow [When the person asks for more](#when-the-person-asks-for-more). To bring old resumes into the record instead, see [Import old resumes with an AI assistant](#import-old-resumes-with-an-ai-assistant).

## What you are working with

BrewCV keeps a **record**: every claim the person can make, each in one or more worded **versions**, in one or more languages. A **saved resume** is a small file that says which versions to print, plus the page settings. See the [README](README.md). In the commands below, `<data>` is the record, or the **one file** the app saves (its backup, which holds the record and every saved resume). Either works everywhere. The examples use `data/example.json`, a fictional person.

## The workflow

Run everything from the repository root.

1. **Read the ad** and the record's claims:
   `node scripts/claims.mjs <data> --json` (add `--lang hu`, `--tag <tag>` or `--job <id>` to narrow it; leave `--json` off to read it yourself).
   Each claim lists its versions with id, number, length, tags and text. The number is the version's `n` field, which matches the same text in another language; the id is only a name and can say another number. Versions that can't be picked are marked. A version marked machine-translated (`needs-review`) has not had a native speaker's review: prefer another one if there is one. The listing also gives the formats, the looks (with the settings each offers) and the export media `picks.json` may use. The summary and the bullets under the jobs are what you pick, and the skill words (below). Certifications and the other sections print as the record has them. Job titles, date lines, the tagline and the contact line have versions too, but `claims.mjs` doesn't list them and `picks.json` doesn't take them: their claims are in the record's `facts`, with ids ending `-position` and `-meta`, and `tagline` and `contact`.
   The listing ends with the **skill wordbank** in that language (`bank` in `--json`): every skill word once, with its id, what it prints in that language (`text`), whether it is the same in every language (a product name), whether it can be printed there (`printable`: a word with no wording in that language can't), and the groups a resume's skills may use (`groups`: the record's skill groups, whose headings are the record's, and the bank's shelves, whose names are the heading).
   If the person keeps writing rules (a style guide, words to avoid), read them first. They decide which version you prefer, and they apply to every wording you propose.
2. **Choose** one version per claim you want on the page, for this ad: the summary, and the bullets under each job. A bullet is only on the page if you pick it. Prefer the version whose tags and words meet the ad, and keep the total to what the page holds. The order you list `bullets` in is the print order within a job (`jobOrder` is the order of jobs): put a job's most relevant bullet first, since Fit cuts from the bottom. As a guide, about six to eight bullets, one to three a job over two or three jobs, fill one A4 page with the usual header, skills and education. Leave room: a page filled to the edge can print as two pages in another browser. Text in another language usually runs longer than the English, so measure each language on its own: it may need fewer picks. `jobType` is a short label for the kind of job, such as `CAD`. For the skills, pick the words the ad asks for, in groups, the most relevant first; left out, the record's own skill groups print as they are.
3. **Write `picks.json`**:
   ```json
   { "company": "Northgate Dosing Systems", "role": "Mechanical Design Engineer", "lang": "en", "format": "a4",
     "pageLimit": 1, "look": "b2", "design": { "size": "large", "colour": "green" }, "exportMedium": "print",
     "jobType": "Medical devices", "summary": "summary-v1",
     "bullets": ["hydra-inhaler-v2-1", "hydra-testing-v1-1", "hydra-dfm-v1"], "jobOrder": ["hydra"],
     "skills": [{ "group": "skills-cad", "words": ["sw-solidworks-cswp", "sw-creo"] }, { "group": "skills-testing", "words": ["sw-iso-13485"] }] }
   ```
   `company`, `role` and `jobType` are plain names (at most 80 characters, no `<`, `>` or `$`, no line breaks) and the only text it takes. Everything else is a version id, a number or a setting: `format`, `look`, `design` and `exportMedium` come from the lists `claims.mjs` prints. `look` is a look's id (`b2` when left out). `design` is optional: `{ preset, fonts, size, density, colour, words }`, each key one of what that look offers (the Look view's section style, fonts, text size, density, colour and key words); a key the look doesn't offer is refused, with what it does offer, and one left out is the look's own default. `exportMedium` is `screen` (the default), `print` (the highlighter shade of the colour, nothing within ¼ in of the paper's edge) or `pen` (black and white with dotted guides to go over with a highlighter pen); the PDF and the HTML are made for it. An old `theme` (a stylesheet name) still works, but name the look with `look`. `bullets` can't be empty, and its order is the print order within each job. `jobOrder` is optional: job ids (the ones `claims.mjs` prints for `--job`), in print order, for some or all of the jobs that have a picked bullet; the rest follow in the record's order. Use it when the ad's most relevant job should print first. Fit cuts from the bottom, so a job's place is its priority. An order that is the record's own is not stored. `skills` is optional: the resume's own skill groups, in print order, each `{ group, words }`: `group` one of the bank's `groups` (a record group or a shelf; a group takes no text of its own), `words` the bank's word ids in print order. A word prints in the resume's language, once. Fit never changes them.
4. **Write the saved resume**:
   `node scripts/new-resume.mjs <data> picks.json <out-dir>`
   It refuses, and writes nothing, if an id doesn't exist, a version is in another language, a draft, archived (or still tagged `archive`), in an archived claim or job, or has no source where the record asks for one, two versions of one claim are listed (or one says another bullet that is also picked), a skills group is not one of the bank's groups or is listed twice, a word is not in the bank, is listed twice or has no wording in the resume's language, or `picks.json` has any other text. It won't replace a file unless you pass `--force`. Read what it says and fix the picks.
   A claim or version with no source, in a record that asks for one, makes `new-resume.mjs`, `render.mjs` and the exports refuse the whole record, even if you don't pick it. Versions added in the app can lack one. List those ids in your report. Add a source only if the person asks you to, and only one that names where the fact is confirmed.
   Jobs with no picked bullet are left off the page. If you leave out `summary`, or anything else the renderer would take from a draft or an archive version, it chooses the record's own safe version instead and says so. Put those lines in your report.
5. **Fit** (without `--model` it measures in Chromium through Playwright; `--model 6.7` is a dry plan with no browser, where the number is the page furniture in lines):
   `node scripts/fit.mjs <data> "<out-dir>/<Company> - <Role>.json" --fit --model 6.7 --out "<out-dir>/fitted.json"`
   Fit aims to fill the last page to 88 to 96 percent, so it leaves the page some room. To get there it chooses among existing versions: it swaps a version for a shorter or a longer one, on bullets and on the skills and patent lines, and drops whole bullets. It never rewrites text and never moves to a draft or an archive version. Its report is advice, not a verdict. Render both the saved resume from step 4 and the fitted one, and compare them. If Fit dropped a bullet you picked for this ad, or swapped in a version you wouldn't have chosen (a skills line about something the ad doesn't mention, say), change the picks to fewer or shorter ones and go back to step 4, so the unfitted resume lands in Fit's band by itself. Prefer the unfitted resume only if its PDF has the page count you want with some room to spare. Hold every version Fit swaps in to the person's writing rules too: a vague version isn't worth the line it fills. If nothing true and relevant is left to add, a last page under the band beats filler; say so in your report. Name every bullet Fit dropped and every version it swapped in your report.
6. **Render and export the PDF** (needs Chrome, Chromium, Brave or Edge; `CHROME_PATH` names one):
   `node scripts/render.mjs <data> <out-dir>/fitted.json <out-dir>/resume.html` (or the step 4 file, if you prefer the unfitted resume). It adds the resume's look settings, as the app does. `--medium screen|print|pen` overrides its `exportMedium`; Fit always measures on a screen, as the app does.
   `node scripts/export-pdf.mjs <out-dir>/resume.html <out-dir>/resume.pdf` (to change the medium at this step: add `--data <data> --recipe <out-dir>/fitted.json --medium pen`)
   `render.mjs` and `new-resume.mjs` print a page count, but it is a plan. The count `export-pdf.mjs` prints for the PDF is the real one. If it is more than `pageLimit`, go back to step 4 with fewer picks. `node checks/pagefit.mjs <out-dir>/resume.html` (needs Playwright) says how full each page is. Then look at the PDF itself: no count shows a date line that wraps onto a second line, or a highlight that stops inside a word. The HTML links the repo's stylesheets and fonts, so it opens only while they stay put: the PDF and the saved-resume file are what you hand over.
7. **Check the keywords**:
   `node checks/keyword-gap.mjs <data> ad.txt` (`ad.txt` is plain text. Strip a page's own furniture, such as a site's dates and buttons, or it shows up as gaps.)
   `node scripts/to-jsonresume.mjs <data> <out-dir>/fitted.json -o /dev/null` also tells you if the file can be exported as plain JSON Resume for an ATS upload.

## The hard rules

- **Never write or edit a version's text.** Not in `picks.json`, not in the record, not in a saved resume. The one exception: the person asks you for new wording (see below), and even then you add versions, never edit one.
- **Never edit the record file** (or the one file), unless the person asks you to. Everything you make goes in a new saved-resume file.
- **Never pick a `-draft-` version, one archived (or still tagged `archive`), or one in an archived claim or job.** Those are unreviewed, or copies of old documents whose wording was not verified.
- **New wording goes in a list, not on the page.** If a different wording would help, put it under **Proposed wording** in your report, and say which claim it belongs to. The person adds the ones they approve through the app.
- Don't invent a fact. If the ad asks for something no claim covers, say so; don't stretch a claim to cover it.

## When the person asks for more

Only when the person says so in as many words, and only for the file and the resumes they name.

**New wording.** The hard rules on facts still hold: a new wording says a fact the record or the person's own sources already confirm.
- Add it as a new version of the claim it restates, with `addVersion` in `src/model/record.js`. Never change an existing version.
- Give it a `source` that names where the fact is confirmed.
- Don't make it the record's default, so no other saved resume changes.
- Name it `<claim>-<tag>`, or `<claim>-<tag>-<lang>` in another language, the way the record's own ids run.
- If it restates a merged version, copy that version's `covers`, so the bullets it covers don't print twice.
- Write it the way the person writes. Their own newest versions show how (compare with an older copy of the file to find them), and their writing rules apply. Highlights (`marks`) cover whole words, endings included.
- Tag every version you write in a language other than the record's default (`en`) `needs-review`, and add the tag to `vocabulary.tags`, so it shows as machine-written until a native speaker has read it.

**A skill word's translation.** A word of the bank has one wording per language, never versions. Write a missing one with `renameWord` in `src/model/resumes.js` (it keeps the record's skill groups in step), never over a wording a person wrote, and add the language to the word's `needsReview` so the app marks it until a native speaker has read it. A product name or a standard that reads the same everywhere is marked `same` instead.

**Changing a saved resume.** When the person asks you to change one already in the one file (one they haven't sent, say) rather than make a new one:
- Keep the original. Copy it under another name before the new file takes its place.
- Use the app's own code: `readBackup` and `makeBackup` in `src/store/persist.js`.
- Change only that resume's `picks`, `sections` and, if it has them, `pages`, and keep the last two in step. A section can continue on the next page: list it there again with the jobs that remain.
- Remove the picks of claims it no longer prints, and don't print one claim twice (under a job, and again under a project).
- Respect `recipe.locked`: a locked line, job, section or the page is held, so do not change its picks, text, switches or place.
- Delete its entry in `frozen`, the text it printed when last saved, so it is made again from the record.
- Before you write, check that every other saved resume renders byte-identical (`renderPages` in `src/render.js`). After, check that the new file reads back with no warnings and that every saved resume opens with no differences (`openSaved` in `src/model/resumes.js`).

## How the person opens the result

In the app: **Open** the saved-resume file. It is added to their saved resumes and nothing else changes. A changed one file is opened the same way, choosing **Replace**. Don't assume the person has linked a folder to the app: many browsers can't, and they may not want to give a page access to their files.

## What to report

Keep it short.

- **Picks and why**: each pick, with the one thing in the ad it meets.
- **Fit's result**: in the band or not, what it changed, which of your picks it dropped or swapped, and which resume you recommend (fitted or unfitted) and why.
- **Keyword gaps**, in two lists: *not claimed anywhere* (the record has nothing for it), and *claimed in other words* (a claim exists under a different name; say which).
- **Proposed wording**: only if some would help, each tied to its claim.
- **Changes to the record**, if the person asked for any: every version, source and tag you added, by id, and which ones need the person's read.

## Import old resumes with an AI assistant

Optional. BrewCV's own import (**Open or import** in the app) reads PDF, Word and other files on the person's device, offline, and stays the default. An assistant can read hard layouts and group rewordings by meaning, but it may paraphrase, fix a typo or invent a date. So the assistant proposes the structure and BrewCV checks the words.

**Privacy.** The files go to the assistant's service. The built-in import keeps them on the device.

### With a chat assistant

A chat never writes BrewCV's own file, whose rules (sources, numbers, ids) are easy to break. It writes one JSON Resume per old resume, and BrewCV opens each through the usual import screens.

1. In BrewCV, drop the old files on the import door first. They are read and kept in the Library with their text, and you may leave every line unticked. The check below needs that text; a scan has none.
2. Give the files to the assistant with this prompt:

   > For each attached resume, give me one JSON Resume (the jsonresume.org schema) in its own code block. Copy every text word for word from the file. Do not correct, shorten, merge, reorder or invent anything, dates included. Keep each bullet as one separate string in `work[].highlights`. Write dates as YYYY-MM, or YYYY if the file gives only a year. Set `meta.source` to the file's exact name. Leave out anything that does not fit a field.

3. Save each block as a `.json` file, or paste it, at **Open or import**.
4. BrewCV looks for every text in the document that `meta.source` names (or the one chosen under **Check the words against**), word by word, ignoring case, quotes, dashes and line-end hyphens. A bullet or summary must be a whole line of the document; a skill, title or contact item must be whole words inside a line, so "Java" is not found in "JavaScript". A text that is not there is listed under **Not in <document>**, unticked, with the document's nearest line beside it. With no document it says it was not checked against an original, and every line starts unticked. Tick only what is right.

### With a coding agent

Only when the person asks, and only on the file they name. The rules under [When the person asks for more](#when-the-person-asks-for-more) apply.

- Read each document's text from the Library (`documents[].text` in the one file) or from the file itself.
- Group the lines of several documents into claims and versions with the app's own code (`addVersion` in `src/model/record.js`), never by editing the record's JSON. Copy the wording exactly.
- Give every new version a `source` that names its document and day (`Imported from <file>, <date>`), the tag `imported` (also in `vocabulary.tags`) and `origin: { doc: <first 12 characters of the document's sha256> }`. Never make one the default, so no saved resume changes.
- Look for every text in its document with `checkWords(jsonResume, docText)` in `src/model/documents.js` (put the texts in a JSON Resume). Add none that is not found, and list it in your report with the nearest line.
- Then run `node checks/validate-data.mjs <data>` and say what it printed.
