# Archiving

This page explains how to put old material out of the way without deleting it.

There is one archive: the archived flag on a claim, a job or a single wording. An old `archive` tag is turned into the flag when a file is opened (see below).

Old material that saved resumes still print can't be deleted without changing them. Archive it instead.

- **A claim.** Open it and choose **Archive** beside the bin. The checklist hides it; each job's group shows a muted "n archived" button that reveals archived claims, dimmed, each with **Unarchive**. A job keeps at least one claim that is not archived.
- **A whole job.** Open the job, open its **Details** and choose **Archive job**. The checklist and the timeline hide it behind an "n archived" button.
- **What archiving changes.** New resumes and Fit never switch on an archived claim or job.
- **What it does not change.** Saved resumes keep printing an archived claim or job exactly as before, including the text they saved. In the checklist an archived claim that a resume prints stays in its job's list with an "archived" badge, and you can untick it. To switch an archived claim on, unarchive it first.
- **Order.** A resume prints a job's ticked bullets in the order that resume sets. Drag a ticked row in Career or in a job's own lines (grab it anywhere, or by its grip), or focus it (or select it on the page) and press Alt+↑ or Alt+↓. Ticking a line off and on again leaves the order of the rest alone.
- Archiving can be undone with Ctrl+Z, and merging two records shows archiving and unarchiving as changes you can tick.

## In your file

A claim or job that is archived carries `"archived": true`; a single wording of a claim that has others can carry it too. A file from before that still has the `archive` tag on versions: opening it removes the tag and sets the flag, on the claim when every wording of it was tagged and its job keeps another live claim, else on the wording. It is ordinary data in the one file, so an AI model or a script can read and edit it; keep the shapes above and BrewCV will accept the file.

### Flags, and tags from older files

A version's `tags` can hold two flags the app shows: `needs-review` (machine-translated, not yet read by a native speaker) and `imported` (taken from an imported document; its `source` names the file). Older files may also hold tags, a list of them in `vocabulary.tags`, job types in `jobTypes` and a `jobType` and `tags` on saved resumes. BrewCV no longer shows or asks for them, and keeps them in the file exactly as they were.
