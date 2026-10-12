# Tags, job types and archiving

This page explains how to sort your career record by kind of job, tailor a resume to a job description in one step, and put old material out of the way without deleting it.

## The idea

You found a job description for, say, a CAD designer. You want your next resume to lead with the lines of yours that belong to that kind of work. BrewCV does this with **tags** and **job types**.

- A **tag** is a short label on one version of a line, such as `cad` or `fabrication`. It says what area of work that wording is about.
- A **job type** is a short list of tags that together describe one kind of job. "CAD designer" might be `cad`, `fabrication` and `hardware`.
- **Focus** applies a job type to the resume you are working on. Every line that has a version tagged with any of the job type's tags is switched on, and each of those lines prints the version that carries the most of the job type's tags.

Nothing is rewritten. Focus only chooses among wordings you already wrote.

## Keep the tag list short

A tag is a way to sort, not a list of everything you can do. Name tags after the areas of work you apply for, not after every tool or task. A version can carry more than one tag.

The list is closed, so it cannot grow by accident:

- A wording takes only a tag that is on the list. Typing a new name on a wording is refused with a message; you do not get a new tag by a typo.
- Tags are made, renamed, merged and deleted in one place: the **Tags** part of the Job types panel (**Job types…**, under Skills and credentials in the Record tab).
- The list holds at most 12 tags. When it is full the new-tag box is shut, and the way out is to merge two tags that mean the same, or delete one you don't use. A record that already has more keeps them; it only cannot add more.
- **Rename** changes the tag on every wording and in every job type at once. **Merge into…** puts one tag in place of another everywhere, once. The bin removes a tag from every wording and job type. Each is one undo step.

A good test: if a tag would never appear in a job type, you probably don't need it.

## Set up job types

1. In the Edit panel with nothing selected, choose **Add job types** beside the Highlight row (or open **Skills and credentials** in the Record tab and choose **Job types…**). The panel lists them.
2. Type a name, for example `CAD designer`, and choose **Add job type**.
3. In the new row, type a tag and press Enter. The box takes only a tag from the list (it suggests them); to make a new one, add it under **Tags** first. Add as many as the kind of job needs. Remove one with its ×.
4. Rename a job type by editing its name. Delete one with the bin; resumes you saved with that job type keep its name as written.

Job types can share tags. `hardware` can be in both "CAD designer" and "Rugged field hardware". That is the point: a line can serve several kinds of job.

## Tailor a resume to a job type

1. Choose the resume you are working on, or start a new one. Click nothing on the page, so the Edit panel shows its home view (press **E** if the panel is folded).
2. In the **Highlight** row, choose from the one list: the job types first (named bundles of tags), then every tag. Choosing one only highlights: the lines that match stay bright and the rest dim on the page.
3. Choose **Apply…**. The panel says how many bullets would be switched on, off, or changed to another version. Choose **Select bullets for …** to apply it. One undo (Ctrl+Z) reverses all of it.

What Focus does and does not do:

- It never touches a bullet you marked **Keep**, and never empties a job: a job with no matching bullet keeps its first one.
- It works in the resume's language. A version in another language is not a match.
- It leaves archived claims and archived jobs exactly as the resume has them.
- There is one tagging system, and it applies to everything: a tag on a skill group, a language or a certificate is found, highlighted and applied like a tag on a bullet. Apply turns a tagged item on and picks its tagged version; an item with no tag is left as it is.

A resume can have a job type. The resume switcher (the resume's name in the header) groups resumes by job type, and **+ New resume** asks for one. Under **Start from**, **The last … resume** copies the newest resume with that job type, and **Bullets for …** starts fresh and applies the job type.

## Archive what you no longer use

There is one archive. It is not a tag: an old `archive` tag is turned into the archived flag when a file is opened (see below).

Old material that saved resumes still print can't be deleted without changing them. Archive it instead.

- **A claim.** Open it and choose **Archive** beside the bin. The checklist hides it; each job's group shows a muted "n archived" button that reveals archived claims, dimmed, each with **Unarchive**. A job keeps at least one claim that is not archived.
- **A whole job.** Open the job, open its **Details** and choose **Archive job**. The checklist and the timeline hide it behind an "n archived" button.
- **What archiving changes.** New resumes, Focus and Fit never switch on an archived claim or job. Tag counts leave them out.
- **What it does not change.** Saved resumes keep printing an archived claim or job exactly as before, including the text they saved. In the checklist an archived claim that a resume prints stays in its job's list with an "archived" badge, and you can untick it. To switch an archived claim on, unarchive it first.
- **Order.** A resume prints a job's ticked bullets in the order that resume sets. Drag a ticked row in the Record tab or in a job's own lines, or focus it (or select it on the page) and press Alt+↑ or Alt+↓. Ticking a line off and on again leaves the order of the rest alone.
- Archiving can be undone with Ctrl+Z, and merging two records shows archiving and unarchiving as changes you can tick.

## In your file

Job types are stored in your career record under `jobTypes`. An entry is either a plain string (an older form, read as one tag) or an object:

```json
{ "id": "cad-designer", "label": "CAD designer", "tags": ["cad", "fabrication", "hardware"] }
```

The list of tags is `vocabulary.tags`, next to the tags on the versions. A saved resume stores only the `id`. A claim or job that is archived carries `"archived": true`; a single wording of a claim that has others can carry it too. A file from before that still has the `archive` tag on versions: opening it removes the tag and sets the flag, on the claim when every wording of it was tagged and its job keeps another live claim, else on the wording. Both are ordinary data in the one file, so an AI model or a script can read and edit them; keep the shapes above and BrewCV will accept the file.
