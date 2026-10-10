/* node scripts/export-pdf.mjs [input.html] [output.pdf] [--css <file>]
   Deterministic PDF, independent of print-dialog settings. Requires playwright. */
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

// Use a Chromium already on the machine rather than downloading one.
const CANDIDATES = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = CANDIDATES.find(p => { try { return fs.existsSync(p); } catch { return false; } });

const argv   = process.argv.slice(2);
const cssIdx = argv.indexOf('--css');
const extraCss = cssIdx !== -1 ? path.resolve(argv[cssIdx + 1]) : null;
const positional = argv.filter((a, i) => cssIdx === -1 || (i !== cssIdx && i !== cssIdx + 1));
const input  = path.resolve(positional[0] ?? 'templates/us-letter.html');
const output = path.resolve(positional[1] ?? 'out/resume.pdf');

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();
await page.goto(pathToFileURL(input).href, { waitUntil: 'networkidle' });
// --css layers a token override on top of the theme.
if (extraCss) await page.addStyleTag({ content: fs.readFileSync(extraCss, 'utf8') });
await page.evaluate(() => document.fonts.ready);
await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: output,
  // Use the format's @page size, so the page box maps to the PDF with no scaling.
  preferCSSPageSize: true,
  printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});
await browser.close();
console.log('wrote', output);
