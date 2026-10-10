# How to tailor a CV with BrewCV

For a coding agent that has been asked to turn a job ad into a resume. You choose among wordings that already exist. You never write one.

## What you are working with

BrewCV keeps a **record**: every claim the person can make, each in one or more worded **versions**, in one or more languages. A **saved resume** is a small file that says which versions to print, plus the page settings. See the [README](README.md). In the commands below, `<data>` is the record, or the **one file** the app saves (its backup, which holds the record and every saved resume). Either works everywhere. The examples use `data/example.json`, a fictional person.

## The workflow

Run everything from the repository root.

1. **Read the ad** and the record's claims:
   `node scripts/claims.mjs <data> --json` (add `--lang hu`, `--tag <tag>` or `--job <id>` to narrow it; leave `--json` off to read it yourself).
   Each claim lists its versions with id, number, length, tags and text. Versions that can't be picked are marked. A version marked machine-translated (`needs-review`) has not had a native speaker's review: prefer another one if there is one. The listing also gives the formats and themes `picks.json` may use. The summary and the bullets under the jobs are what you pick. Skills, certifications and the other sections print as the record has them.
2. **Choose** one version per claim you want on the page, for this ad: the summary, and the bullets under each job. A bullet is only on the page if you pick it. Prefer the version whose tags and words meet the ad, and keep the total near what the page limit holds.
3. **Write `picks.json`**:
   ```json
   { "company": "Northgate Dosing Systems", "role": "Mechanical Design Engineer", "lang": "en", "format": "a4",
     "pageLimit": 1, "theme": "b2-marker", "jobType": "Medical devices", "summary": "summary-v1",
     "bullets": ["hydra-inhaler-v2-1", "hydra-testing-v1-1", "hydra-dfm-v1"] }
   ```
   `company`, `role` and `jobType` are plain names (at most 80 characters, no `<`, `>` or `$`, no line breaks) and the only text it takes. Everything else is a version id, a number or a setting: `format` and `theme` come from the lists `claims.mjs` prints. `bullets` can't be empty.
4. **Write the saved resume**:
   `node scripts/new-resume.mjs <data> picks.json <out-dir>`
   It refuses, and writes nothing, if an id doesn't exist, a version is in another language, a draft, tagged `archive`, or has no source where the record asks for one, two versions of one claim are listed (or one says another bullet that is also picked), or `picks.json` has any other text. It won't replace a file unless you pass `--force`. Read what it says and fix the picks.
   Jobs with no picked bullet are left off the page. If you leave out `summary`, or anything else the renderer would take from a draft or an archive version, it chooses the record's own safe version instead and says so. Put those lines in your report.
5. **Fit** (a dry plan with no browser: `--model` gives the furniture lines, e.g. `6.7`; leave it off to measure in Chromium):
   `node scripts/fit.mjs <data> "<out-dir>/<Company> - <Role>.json" --fit --model 6.7 --out "<out-dir>/fitted.json"`
   Fit chooses among existing versions: it swaps one version for a shorter one and drops whole bullets. It never rewrites text and never moves to a draft or an archive version. Its report is advice, not a verdict. Render both the saved resume from step 4 and the fitted one, and compare them. If Fit dropped a bullet you picked for this ad, or swapped in a version you wouldn't have chosen, prefer the unfitted resume, or change the picks and go back to step 4. Name every bullet Fit dropped and every version it swapped in your report.
6. **Render and export the PDF** (needs a browser):
   `node scripts/render.mjs <data> <out-dir>/fitted.json <out-dir>/resume.html` (or the step 4 file, if you prefer the unfitted resume)
   `node scripts/export-pdf.mjs <out-dir>/resume.html <out-dir>/resume.pdf`
7. **Check the keywords**:
   `node checks/keyword-gap.mjs <data> ad.txt`
   `node scripts/to-jsonresume.mjs <data> <out-dir>/fitted.json -o /dev/null` also tells you if the file can be exported as plain JSON Resume for an ATS upload.

## The hard rules

- **Never write or edit a version's text.** Not in `picks.json`, not in the record, not in a saved resume.
- **Never edit the record file** (or the one file). Everything you make goes in a new saved-resume file.
- **Never pick a `-draft-` version or one tagged `archive`.** Those are unreviewed, or copies of old documents whose wording was not verified.
- **New wording goes in a list, not on the page.** If a different wording would help, put it under **Proposed wording** in your report, and say which claim it belongs to. The person adds the ones they approve through the app.
- Don't invent a fact. If the ad asks for something no claim covers, say so; don't stretch a claim to cover it.

## How the person opens the result

In the app: **Open** the saved-resume file. It is added to their saved resumes and nothing else changes. Don't assume the person has linked a folder to the app: many browsers can't, and they may not want to give a page access to their files.

## What to report

Keep it short.

- **Picks and why**: each pick, with the one thing in the ad it meets.
- **Fit's result**: in the band or not, what it changed, which of your picks it dropped or swapped, and which resume you recommend (fitted or unfitted) and why.
- **Keyword gaps**, in two lists: *not claimed anywhere* (the record has nothing for it), and *claimed in other words* (a claim exists under a different name; say which).
- **Proposed wording**: only if some would help, each tied to its claim.
