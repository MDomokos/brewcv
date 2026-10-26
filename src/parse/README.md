# src/parse

Turns the text of a resume file into JSON Resume. The readers below turn each format into the text items the parser takes; a LinkedIn export skips the parser. It is a port of the parser in [OpenResume](https://github.com/xitanggg/open-resume) (`src/app/lib/parse-resume-from-pdf/`, commit `4f8255a2c763479837f69f1dccf2a3338730cd79`), plain JavaScript, types stripped, by Xitang Zhao in the original. Each ported file says where it came from. It imports nothing from the rest of `src/`, so it can be split out with `git subtree split --prefix=src/parse`.

```js
import { parseResume } from './index.js';
const { jsonResume, trace, leftovers, layout, doubts } = parseResume(textItems, lexicon, layout?);
```

**In: text items**, in the order a reader found them, one line ended by `hasEOL`:
`{ text, x, y, width, height, fontName, hasEOL, page?, title?, side? }`. A bold item has `Bold` in its `fontName`. `y` grows upward, as in a PDF. `title: true` is a heading the reader found (a Heading style, `#`, `h1` to `h3`) at the top level the document uses after its first two lines: a section title whatever its words, unless it is in the first two lines.

**In: a lexicon** (optional): the words to look for, in `lexicon.js` form. Leave it out for English. The words you give are added to the English ones, except `months`, which replaces them (twelve names, January first). `lexiconFor(lang)` in `src/model/import.js` builds one from the app's catalogues.

**In: a layout** (optional), one entry per page, `[{ page, headerBottom?, split? }]`: lines whose top (`y + height`) is above `headerBottom` are a full-width header, read first; the rest are cut at x = `split`, left column first. No `split` is one column. A page you name is used as it is; a page you leave out is guessed, and the guess splits only when sure (a gap of 30 pt or more between line starts, three lines on each side, rows that meet, few lines across the cut) and otherwise reads one column.

**Out**
- `jsonResume`: `basics`, `work`, `education`, `projects`, `skills`, with dates as `YYYY-MM` or `YYYY`. Education bullets go in `courses`. A skills line `Group: a, b` is a group named Group.
- `trace`: `[{ path, page?, line }]`, for each text in `jsonResume`, the page and the line (counted from 1, after the lines are grouped) of the first line that holds it.
- `layout`: what was used for every page, with the guessed `headerBottom` and `split`, so a screen can draw it and the person can move it.
- `doubts`: what to check by eye: `{ kind: 'columns', page }` (a column was seen but not trusted, or trusted with a question), `{ kind: 'leftovers', n }`, `{ kind: 'dates', n }` (jobs with no dates), `{ kind: 'name' }`.
- `leftovers`: `[{ text, section, page?, line }]`, the lines that fall in a section but that no extractor used, and the lines of items marked `side: 'header'` or `'footer'` (a Word file's running header and footer; they are not read, they have no `line`, and the header's come first, the footer's last). The title of a section is not a leftover; the lines under a section nothing reads are.

**What changed from OpenResume**: a column split before the lines are grouped (`split-columns.js`); the word lists are a lexicon; any Unicode letter counts as a letter; the output is JSON Resume with a trace and leftovers (`to-json-resume.js`). `read-pdf.ts` is not ported (the readers make the items) and `types.ts` is types only.

**Readers** (all but `identify` and `unzip` give text items; each takes the file's bytes; `identify` throws unzip's coded error for a ZIP it cannot list):
- `identify(bytes, name)`: `pdf | docx | odt | pages | linkedin | html | md | txt | json | image | other`, from the bytes; the name only breaks the tie between `md` and `txt`. `unzip(bytes)`: `{ names, read(name) }` over the platform's own inflate; refuses ZIP64, encrypted files and more than 64 MB read from one file in all, with an error that has a `code`. The readers scan tags in one pass (`scan` in `lines.js`), so broken markup cannot make them slow; a text box, frame or footnote inside a paragraph never splits it (boxes are read as lines after it). A DOCX's header and footer (the ones its last section uses: default, or first-page when that is all there is) come back as `side` items, minus page numbers and lines the body has too, so the parser leaves them as leftovers; a DOCX, ODT or page with no paragraph in it is refused with the code `empty`.
- `readDocx`, `readOdt`, `readHtml`, `readMd`, `readTxt`: one item per part of a line, one line per paragraph, list item or heading, so the same resume in any of them gives the same lines. They have no page positions: every line starts at x = 0 and `y` is minus the line number, so the parser never guesses columns for them and reports no column doubt. A tab or two spaces start a new item on the line (a date at the right), but a gap right after `.`, `!` or `?` never does (sentence spacing), so "Acme Inc.  2019 – 2021" stays one item; an empty paragraph is a gap in `y`, which is how the parser tells one job from the next.
- `readPages(bytes)` gives the PDF a Pages file holds, for the PDF reader. `readLinkedin(bytes)` gives `{ jsonResume, trace, leftovers, doubts }` from the CSV files of a LinkedIn export (the last three empty). `parseCsv` is in `csv.js`.
- The text of every item is mended, not rewritten (`lines.js`): ligatures, soft and zero-width characters, odd spaces. Quotes, dashes, capitals and the spacing around punctuation stay as the person typed them (a PDF's own damage, such as a word split at a line end, is for the PDF reader); `normText` smooths them for matching only.
- A heading is bold, and a section title only at the top heading level the document uses (the smallest number, after the first two lines), so Heading 2 job lines under Heading 1 sections stay jobs.

**Licence**: the files ported from OpenResume are AGPL-3.0 (version 3, as OpenResume's LICENSE says, not "or later"). Each says who wrote the original, which file and commit, and what BrewCV changed, on 2026-10-26.
