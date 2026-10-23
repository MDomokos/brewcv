// The plate (UX-6f 4b): a block's own outline. The look is in the tokens (`--plate-*`, workbench.css) and in the frame's stylesheet (sheet.js);
// this is what the code that places things by it needs: how far each level's plate stands off its block.
// Hover is intent, not a reflex (UX-6f 1b): the page reacts to where the pointer settles, not to everything it passes.
//   HOVER_SPEED: above this (px/s, screen pixels, over the last HOVER_WINDOW ms) nothing starts: no plate, no tab, no "+".
//   HOVER_DWELL: after a fast move the first plate waits until the pointer has been slow this long (ms); a slow approach waits for nothing.
//   HOVER_IN, HOVER_OUT: how long a hovered plate takes to fade in and out (ms): the frame's transition reads these. Reduced motion: no fades, the gate stays.
export const HOVER_SPEED = 600, HOVER_WINDOW = 80, HOVER_DWELL = 40, HOVER_IN = 160, HOVER_OUT = 120;
// One plate that moves (UX-6f 4c): hover and selection are shapes that glide from block to block in --plate-glide (180ms, workbench.css), and so do the grip and the "+" on
// them. GLIDE_KEEP: a plate (or a hand) let go less than this long ago (ms) glides from where it was to where the pointer settles; after that it appears where it goes.
export const GLIDE_KEEP = 400;
export const GLIDE = () => (cache.glide ??= tok('--plate-glide') || 180);
const cache = {}, tok = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
export const off = level => (cache[level] ??= tok(`--plate-off-${level}`) || 4);
// the plate's outer radius at a level: the block's own (`--plate-r`) and the stand-off, which is how far the outline's corner is turned
export const radius = level => off(level) + (cache.r ??= tok('--plate-r') || 2);
// A drag (UX-6f 4b): how a lifted block moves, in one mutable object so a check can set a value (window.__wb.hands.feel).
//   LAND_MIN..LAND_MAX: the landing's time (ms), the longer way the longer, ease-out and no spring (LAND_FAR: the distance, in page px, that takes the longest); the lift's rise is the shortest.
//   POP: a neighbouring place's slide across when the lifted block takes its slot (ms).
//   PULL, REACH, SQUASH: past the edge of the places it may take, a lifted block follows the pointer at PULL of the distance, at most REACH page px beyond (in a one-axis list,
//   lines, jobs, sections, the same give across its axis: it follows the pointer along the list only), and is squashed by
//   SQUASH (a fraction of its size) at that most, restoring when it is let go. None of that under reduced motion: it stops at the edge.
//   FOLD: a block taller than this fraction of its page (a section such as Experience) is carried as a card while its home folds to its heading, so it does not cover the others.
//   SWAP: a neighbour takes the slot when the lifted block has crossed this fraction of its height (or width) in the direction of travel, not its midpoint.
export const FEEL = { SWAP: .3, LAND_MIN: 120, LAND_MAX: 180, LAND_FAR: 400, POP: 80, PULL: 1 / 3, REACH: 12, SQUASH: .04, FOLD: 1 / 3 };
