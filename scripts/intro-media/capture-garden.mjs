// node scripts/intro-media/capture-garden.mjs <out-dir> [--url http://localhost:8123/]
// The README's tea and coffee pictures: the upper-left corner of the example resume beside the mat, 640 x 400 at 2x (<out-dir>/tea-garden.png and
// coffee-focus.png; shrink them to 1000 px wide and save as WebP into docs/intro/, as Pillow's Image.resize + save(quality=88)).
// The garden is shown through its test hooks (?garden-check=600 puts them on window.__wb.garden, with an idle time that never comes): waiting
// for a real ladybug takes minutes and leaves land on the page. The window is 600 px tall on purpose: the ladybug's height is random between
// 120 px and the window's height minus 220, so a short window keeps it inside the crop.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { findBrowser } from '../export-pdf.mjs';

const args = process.argv.slice(2), i = args.indexOf('--url'), url = i < 0 ? 'http://localhost:8123/' : args.splice(i, 2)[1];
const out = args[0]; if (!out) { console.error('usage: capture-garden.mjs <out-dir>'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const CLIP = { x: 0, y: 0, width: 640, height: 400 };
const browser = await chromium.launch({ executablePath: findBrowser() });
const open = async q => {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 600 }, colorScheme: 'light', deviceScaleFactor: 2 })).newPage();
  await page.goto(url + q); await page.waitForTimeout(2500);
  await page.getByText('Try it with an example').click(); await page.waitForTimeout(3500);
  return page;
};

// tea: rest, drop leaves one by one until three have settled on the mat and at most one on the page, then send the ladybug and take a frame
// every half second for a look (pick one: the ladybug walks in from the left edge)
const tea = await open('?garden-check=600');
await tea.mouse.move(5, 5);
await tea.evaluate(() => window.__wb.garden.rest());
const landed = () => tea.evaluate(() => [...document.querySelectorAll('#garden .landed')].map(e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
for (let k = 0; k < 120; k++) {
  await tea.evaluate(() => window.__wb.garden.lone()); await tea.waitForTimeout(1500);
  const L = await landed();
  if (L.filter(([x, y]) => x < 235 && y < 400).length >= 3 && L.filter(([x, y]) => x >= 235 && x < 700 && y < 400).length <= 1) break;
}
await tea.evaluate(() => window.__wb.garden.bug());
for (let k = 0; k < 24; k++) { await tea.waitForTimeout(500); await tea.screenshot({ path: `${out}/tea-garden-${String(k).padStart(2, '0')}.png`, clip: CLIP }); }
console.log('tea: 24 candidates, pick one and copy it to tea-garden.png');

// coffee: Shift+F switches in place
const coffee = await open('');
await coffee.mouse.move(800, 300); await coffee.keyboard.press('Shift+F'); await coffee.waitForTimeout(3000);
await coffee.mouse.move(5, 5); await coffee.waitForTimeout(800);
await coffee.screenshot({ path: `${out}/coffee-focus.png`, clip: CLIP });
await browser.close();
