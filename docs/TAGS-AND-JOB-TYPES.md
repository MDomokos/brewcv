# Tags, job types and archiving

This page explains how to sort your career record by kind of job, tailor a resume to a job description in one step, and put old material out of the way without deleting it.

## The idea

You found a job description for, say, a CAD designer. You want your next resume to lead with the lines of yours that belong to that kind of work. BrewCV does this with **tags** and **job types**.

- A **tag** is a short label on one version of a line, such as `cad` or `fabrication`. It says what area of work that wording is about.
- A **job type** is a short list of tags that together describe one kind of job. "CAD designer" might be `cad`, `fabrication` and `hardware`.
- **Focus** applies a job type to the resume you are working on. Every line that has a version tagged with any of the job type's tags is switched on, and each of those lines prints the version that carries the most of the job type's tags.

Nothing is rewritten. Focus only chooses among wordings you already wrote.

## Keep the tag list short

A tag is a way to sort, not a list of everything you can do. Five to ten tags is plenty. Name them after the areas of work you apply for, not after every tool or task. A version can carry more than one tag.

A good test: if a tag would never appear in a job type, you probably don't need it.

If you already have many tags, merge near-duplicates. Open a line in Career, remove the tag you don't want from each version (the × on the chip) and add the one you keep.

## Set up job types

1. Open **Career** and go to step 3, **Skills & credentials**. At the bottom is **Job types**.
2. Type a name, for example `CAD designer`, and choose **Add job type**.
3. In the new row, type a tag and press Enter. The box suggests tags you already use. Add as many as the kind of job needs. Remove one with its ×.
4. Rename a job type by editing its name. Delete one with the bin; resumes you saved with that job type keep its name as written.

Job types can share tags. `hardware` can be in both "CAD designer" and "Rugged field hardware". That is the point: a line can serve several kinds of job.

## Tailor a resume to a job type

1. Open the **Resume** workspace and choose the resume you are working on, or start a new one.
2. On the home view, under **Focus on a job type or tag**, job types are listed first. Click one. Its tags show when you hover it.
3. The panel says how many bullets would be switched on, off, or changed to another version. Choose **Select bullets for …** to apply it. One undo (Ctrl+Z) reverses all of it.

What Focus does and does not do:

- It never touches a bullet you marked **Keep**, and never empties a job: a job with no matching bullet keeps its first one.
- It works in the resume's language. A version in another language is not a match.
- It leaves archived claims and archived jobs exactly as the resume has them.
- Click a plain tag instead of a job type to focus on that one tag.

A resume can have a job type. The resume switcher (the resume's name in the header) groups resumes by job type, and **+ New resume** asks for one. Under **Start from**, **The last … resume** copies the newest resume with that job type, and **Bullets for …** starts fresh and applies the job type.

## Archive what you no longer use

Old material that saved resumes still print can't be deleted without changing them. Archive it instead.

- **A claim.** Open it in Career and choose **Archive** beside the bin. Career hides it; each job shows a muted "n archived" button that reveals archived claims, dimmed, each with **Unarchive**. A job keeps at least one claim that is not archived.
- **A whole job.** Open the job in Career and choose **Archive job**. The timeline hides it behind an "n archived" button.
- **What archiving changes.** New resumes, Focus and Fit never switch on an archived claim or job. Tag counts leave them out.
- **What it does not change.** Saved resumes keep printing an archived claim or job exactly as before, including the text they saved. In the Resume workspace an archived claim that a resume prints shows an "archived" badge, and you can turn it off. To switch an archived claim on, unarchive it first.
- Archiving can be undone with Ctrl+Z, and merging two records shows archiving and unarchiving as changes you can tick.

## In your file

Job types are stored in your career record under `jobTypes`. An entry is either a plain string (an older form, read as one tag) or an object:

```json
{ "id": "cad-designer", "label": "CAD designer", "tags": ["cad", "fabrication", "hardware"] }
```

A saved resume stores only the `id`. A claim or job that is archived carries `"archived": true`. Both are ordinary data in the one file, so an AI model or a script can read and edit them; keep the shapes above and BrewCV will accept the file.
