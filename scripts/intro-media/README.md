# README pictures

How the pictures in `docs/intro/` were made, so they can be made again when the start screen or a look changes. The repo holds only these
scripts; the frames they write are throwaway (put them in a scratchpad or `out/`).

| File in `docs/intro/` | What it is | Made by |
|---|---|---|
| `one-file.webp`, `looks.webp` | stills of start-screen steps 1 and 3 | `capture-story.mjs` + `assemble.py` (STILL steps) |
| `versions.webp`, `many-resumes.webp` | transparent animations of steps 2 and 4 | `capture-story.mjs` + `assemble.py` |
| `tea-garden.webp`, `coffee-focus.webp` | the upper-left corner of the example resume on the tea mat (leaves, a ladybug) and the coffee mat | `capture-garden.mjs` |

```
node scripts/intro-media/serve.mjs . 8123 &                       # the app, with a long listen queue
CHROME_PATH=... node scripts/intro-media/capture-story.mjs OUT     # frames in OUT/g1 ... g4 (Playwright and a Chromium)
python3 scripts/intro-media/assemble.py OUT docs/intro             # needs Pillow; steps as a third argument, default 24
CHROME_PATH=... node scripts/intro-media/capture-garden.mjs OUT    # candidates; pick one, resize to 1000 px wide, save as WebP (quality 88)
```

## Things that cost time

- **Why not video or GIF.** The pictures need a transparent background so they sit on a light or a dark README. A GIF has only on/off
  transparency and Playwright's video has none; an animated WebP has an alpha channel and GitHub shows it in `<img>`. Frames are PNGs
  with `Emulation.setDefaultBackgroundColorOverride` set to transparent, and CSS that hides everything outside the stage
  (see `CSS` in `capture-story.mjs`: no board, step control, caption or list of old documents, only the graphics).
- **A step only plays going forward from the step before it.** `go(n)` in `src/ui/story.js` draws the settled state with no motion when
  moving back. So the script presses 4, then n-1, then n. Step 1 has no step before it: the replay button (`.obreplay`) plays it from the top.
  Step 1 auto-advances into step 2 after about 10 s: `END` in `assemble.py` cuts it before step 2's page arrives.
- **Frame rate.** `page.screenshot()` gives about 13 fps. `Page.captureScreenshot` over CDP with `optimizeForSpeed` and a clip `scale` gives about
  30. Frames are held in memory and written after the loop. A busy machine causes stalls of 1 to 2 seconds (the script flags any gap over
  150 ms): run again.
- **The first picture matters.** A preview that does not play, and the first frame before a loop starts, show frame 0. `assemble.py` puts the
  moment the step is about first (`REP`): lines picked and a wording swapped for step 2, the resumes fanned out for step 4.
- **Step 4 shows only resumes.** The file and the look card are hidden with `visibility`, not `display`: the lines still fly in from the
  file's place, and `display: none` would send them from the corner. The stack runs under the board's rim, so its bottom edge is faded (`FADE`).
- **The garden is seen through hooks.** `?garden-check=600` (see `src/ui/shell.js`, `checks/garden-check.mjs`) puts `rest`, `lone`, `bug`, `snail`,
  `butterfly`, `rain`, `petals`... on `window.__wb.garden`. Without them a ladybug can take minutes to come, and leaves land on the page.
- **Allowed paths.** `.gitignore` and `checks/history-scan.mjs` allow `docs/intro/*.webp` (the example data is a fictional person; look at every
  frame before adding one). Another image type or folder needs the same two lines.
- **Browser and Playwright.** Set `CHROME_PATH` if no Chrome, Chromium, Brave or Edge is found. `playwright` is not a dependency of the repo: install it in a parent folder or globally so `import 'playwright'` resolves.
