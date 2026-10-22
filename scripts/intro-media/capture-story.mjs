// node scripts/intro-media/capture-story.mjs <out-dir> [steps, default 1234] [--url http://localhost:8123/]
// Records the start screen's story (src/ui/story.js) as transparent PNG frames, one folder per step (<out-dir>/g1 ... g4), named <n>_<ms>.png.
// Only the stage's graphics are kept: the board, frame, step control, caption and the list of old documents are hidden, so what is left is
// the career file, the page, the other wordings, the look card and the stack of resumes. Step 4 also hides the file and the look card, so only
// the resumes show (lines still fly in from where the file would be). Assemble the frames with assemble.py.
// Run it with a quiet machine: a busy one makes frames stall for a second or more (look at the gaps the script prints, and run again).
import fs from 'node:fs';
import { chromium } from 'playwright';
import { findBrowser } from '../export-pdf.mjs';

const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args.splice(i, 2)[1]; };
const url = flag('--url', 'http://localhost:8123/');
const [out, steps = '1234'] = args;
if (!out) { console.error('usage: capture-story.mjs <out-dir> [steps] [--url ...]'); process.exit(1); }

// how long each step plays (its moments in story.js plus a hold), and the stage region (page px; the stage sits at 17,17 and is 1004 x 866 in a 1440 x 900 window)
const STAGE = { x: 17, y: 17, width: 1004, height: 866 };
const STEP = { 1: { ms: 11000, clip: STAGE }, 2: { ms: 15500, clip: { x: 46, y: 114, width: 968, height: 700 } },
  3: { ms: 6000, clip: STAGE }, 4: { ms: 9500, clip: { x: 43, y: 94, width: 990, height: 789 }, hideFile: true } };
const SCALE = 0.7;       // the frames come out at this fraction of the window's pixels: smaller frames are captured faster

const CSS = `
html,body{background:transparent!important}
body::before,body::after{display:none!important}
body *{visibility:hidden!important}
.sst,.sst *{visibility:visible!important}
.ss,.sst{background:none!important;box-shadow:none!important;border:0!important}
.frame,.rimshade,.obreplay,.nav,.s-lcol,.s-manifest,.s-job,.sh,.sghost,.flabel{display:none!important}
.s-slips > p{display:none!important}`;
const HIDE_FILE = '.s-file,.s-file *,.s-tools,.s-tools *{visibility:hidden!important}';

const browser = await chromium.launch({ executablePath: findBrowser() });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.goto(url); await page.waitForTimeout(2500);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });   // omit the page's background
const hideStyle = await page.addStyleTag({ content: CSS });
let fileStyle = null;

for (const n of steps.split('').map(Number)) {
  const { ms, clip, hideFile } = STEP[n], dir = `${out}/g${n}`;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  await fileStyle?.evaluate(e => e.remove()); fileStyle = hideFile ? await page.addStyleTag({ content: HIDE_FILE }) : null;
  // A step only plays when it is entered from the one before it, settled: going back (key to a lower step) draws the settled state with no
  // motion. So: jump to 4, go back to n-1 (settled), then enter n. Step 1 has no step before it: the replay button plays it from the top.
  await page.keyboard.press('4'); await page.waitForTimeout(500);
  if (n > 1) { await page.keyboard.press(String(n - 1)); await page.waitForTimeout(2500); }
  const t0 = Date.now(), got = [];
  if (n === 1) await page.evaluate(() => document.querySelector('.obreplay').click()); else await page.keyboard.press(String(n));
  while (Date.now() - t0 < ms) {
    // optimizeForSpeed + a clip scale is what gets ~30 fps; page.screenshot() manages about 13
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, fromSurface: true, clip: { ...clip, scale: SCALE } });
    got.push([Date.now() - t0, r.data]);
  }
  got.forEach(([t, d], i) => fs.writeFileSync(`${dir}/${String(i).padStart(4, '0')}_${t}.png`, Buffer.from(d, 'base64')));   // write after, so disk time is not in the loop
  const gaps = got.slice(1).map((g, i) => g[0] - got[i][0]);
  console.log(`step ${n}: ${got.length} frames, ${(got.length / ms * 1000).toFixed(1)} fps, longest gap ${Math.max(...gaps)} ms${Math.max(...gaps) > 150 ? '  <- stalled, run it again' : ''}`);
}
await browser.close();
