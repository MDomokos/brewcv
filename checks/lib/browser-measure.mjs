// A measure(recipe) for src/fit.js: renders the recipe annotated, loads it in headless Chromium and returns
// src/render.js measurePages(). playwright is imported only when this is opened, and nothing is downloaded.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { autoLayout } from '../../src/paginate.js';
import { readLibrary } from '../../scripts/lib/library.mjs';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };

export async function openMeasurer({ repo, data, port = 8096 }){
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { throw new Error('no browser measurement here: playwright is not installed'); }

  const rel = 'out/.fit-measure.html';
  const recipeFile = path.join(repo, 'out/.fit-measure.recipe.json');
  fs.mkdirSync(path.join(repo, 'out'), { recursive: true });

  const server = http.createServer((req, res) => {
    const f = path.join(repo, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(repo) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise(r => server.listen(port, r));

  const exe = process.env.CHROME_PATH
    ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  // the page templates carry a CSP with no script source; measuring imports the app's modules into the page
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 }, bypassCSP: true });
  let n = 0;

  const model = readLibrary(data).model;
  const load = async recipe => {
    fs.writeFileSync(recipeFile, JSON.stringify(recipe));
    execFileSync(process.execPath, [path.join(repo, 'scripts/render.mjs'), data, recipeFile,
      path.join(repo, rel), '--annotate'], { stdio: ['ignore', 'ignore', 'inherit'] });
    await page.goto(`http://localhost:${port}/${rel}?n=${++n}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
  };
  const measureFlow = async flow => {
    await load(flow);
    return page.evaluate(async () =>
      (await import('/src/paginate.js')).measureBlocks(document.querySelector('.document')));
  };

  return {
    async measure(recipe){
      await load(recipe);
      return page.evaluate(async () =>
        (await import('/src/render.js')).measurePages(document.querySelector('.document')));
    },
    // one flowed page measured as blocks, and the layout it cuts into
    measureFlow,
    // the recipe drawn as it prints, then `fn(arg)` run in the page (it is sent to Chromium, so it closes over nothing)
    async inspect(recipe, fn, arg){ await load(recipe); return page.evaluate(fn, arg); },
    layout: recipe => autoLayout(model, recipe, measureFlow),
    async close(){
      await browser.close();
      server.close();
      fs.rmSync(path.join(repo, rel), { force: true });
      fs.rmSync(recipeFile, { force: true });
    },
  };
}
