# src/parse

Turns the text of a resume file into JSON Resume. It is a port of the parser in [OpenResume](https://github.com/xitanggg/open-resume) (`src/app/lib/parse-resume-from-pdf/`, commit `4f8255a2c763479837f69f1dccf2a3338730cd79`), plain JavaScript, types stripped, by Xitang Zhao in the original. Each ported file says where it came from. It imports nothing from the rest of `src/`, so it can be split out with `git subtree split --prefix=src/parse`.

```js
import { parseResume } from './index.js';
const { jsonResume, trace, leftovers, layout, doubts } = parseResume(textItems, lexicon, layout?);
```

**In: text items**, in the order a reader found them, one line ended by `hasEOL`:
`{ text, x, y, width, height, fontName, hasEOL, page? }`. A bold item has `Bold` in its `fontName`. `y` grows upward, as in a PDF.

**In: a lexicon** (optional): the words to look for, in `lexicon.js` form. Leave it out for English. The words you give are added to the English ones, except `months`, which replaces them (twelve names, January first). `lexiconFor(lang)` in `src/model/import.js` builds one from the app's catalogues.

**In: a layout** (optional), one entry per page, `[{ page, headerBottom?, split? }]`: lines whose top (`y + height`) is above `headerBottom` are a full-width header, read first; the rest are cut at x = `split`, left column first. No `split` is one column. A page you name is used as it is; a page you leave out is guessed, and the guess splits only when sure (a gap of 30 pt or more between line starts, three lines on each side, rows that meet, few lines across the cut) and otherwise reads one column.

**Out**
- `jsonResume`: `basics`, `work`, `education`, `projects`, `skills`, with dates as `YYYY-MM` or `YYYY`. Education bullets go in `courses`. A skills line `Group: a, b` is a group named Group.
- `trace`: `[{ path, page?, line }]`, for each text in `jsonResume`, the page and the line (counted from 1, after the lines are grouped) of the first line that holds it.
- `layout`: what was used for every page, with the guessed `headerBottom` and `split`, so a screen can draw it and the person can move it.
- `doubts`: what to check by eye: `{ kind: 'columns', page }` (a column was seen but not trusted, or trusted with a question), `{ kind: 'leftovers', n }`, `{ kind: 'dates', n }` (jobs with no dates), `{ kind: 'name' }`.
- `leftovers`: `[{ text, section, page?, line }]`, the lines that fall in a section but that no extractor used. The title of a section is not a leftover; the lines under a section nothing reads are.

**What changed from OpenResume**: a column split before the lines are grouped (`split-columns.js`); the word lists are a lexicon; any Unicode letter counts as a letter; the output is JSON Resume with a trace and leftovers (`to-json-resume.js`). `read-pdf.ts` is not ported (the readers make the items) and `types.ts` is types only.

**Licence**: the files ported from OpenResume are AGPL-3.0 (version 3, as OpenResume's LICENSE says, not "or later"). Each says who wrote the original, which file and commit, and what BrewCV changed, on 2026-10-26.
