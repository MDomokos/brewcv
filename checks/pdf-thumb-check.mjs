#!/usr/bin/env node
// node checks/pdf-thumb-check.mjs        (PORT=... picks the port)
// The PDF reader in a browser, on the app's own address and under its Content-Security-Policy (index.html's): PDF.js loads from vendor/pdfjs/ and its worker runs, no request leaves the address and no
// policy is broken; readPdf gives the same items there as in Node (the parse check reads every fixture in Node); pdfThumb draws page 1 as a PNG data URL of the width asked for, with ink on it.
// In Chromium through Playwright (CHROME_PATH, or PW_BUNDLED=1); writes nothing.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPdf } from '../src/parse/pdf.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8651);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen({ port: PORT, backlog: 512 }, r));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const outside = [], errors = [];
page.on('request', r => { if (!r.url().startsWith(`http://localhost:${PORT}/`) && !/^(data|blob):/.test(r.url())) outside.push(r.url()); });
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });

const FILE = 'checks/fixtures/import/helix-1col-word.pdf';
const got = await page.evaluate(async file => {
  const { readPdf, pdfThumb } = await import('/src/parse/pdf.js');
  const bytes = new Uint8Array(await (await fetch(`/${file}`)).arrayBuffer());
  const items = (await readPdf(bytes, [])).map(i => [i.text, i.page, i.hasEOL, i.fontName]);
  const url = await pdfThumb(bytes, 240);
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] < 200) ink++;      // not white: the text, a little grey at this size
  return { items, head: url.slice(0, url.indexOf(',') + 1), w: img.width, h: img.height, ink };
}, FILE);

const here = (await readPdf(new Uint8Array(fs.readFileSync(path.join(ROOT, FILE))), [])).map(i => [i.text, i.page, i.hasEOL, i.fontName]);
const diff = here.findIndex((x, k) => JSON.stringify(x) !== JSON.stringify(got.items[k]));
ok('the browser reads the Word PDF to the same items as Node: text, page, end of line and font', diff < 0 && got.items.length === here.length, `${got.items.length} items in the browser, ${here.length} in Node; first difference ${diff}: ${JSON.stringify(got.items[diff])} / ${JSON.stringify(here[diff])}`);
ok('pdfThumb gives a PNG data URL 240 px wide and as tall as an A4 page', got.head.replace(/^data:/, '') === 'image/png;base64,' && got.w === 240 && Math.abs(got.h - 240 * 842 / 595) <= 2, `${got.head} ${got.w}x${got.h}`);
ok('and the page is drawn: dark text on it, and not mostly dark', got.ink > 1000 && got.ink < 0.3 * got.w * got.h, `${got.ink} dark pixels`);
const csp = await page.evaluate(() => window.__csp);
ok('no Content-Security-Policy violation (the worker and the library load from the app\'s own address), no request to another address and no page error', csp.length === 0 && outside.length === 0 && errors.length === 0, JSON.stringify({ csp, outside, errors }));

await browser.close();
server.close();
console.log(failed ? `\n${failed} FAILED` : '\nPDF in the browser: all checks pass.');
process.exit(failed ? 1 : 0);
