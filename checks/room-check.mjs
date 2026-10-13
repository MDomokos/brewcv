#!/usr/bin/env node
// node checks/room-check.mjs
// The panel's room, as a test (UX-5c): on the example, at 1280×720, 1470×832 and 1200×750, how much of the open sheet's content is
// below its visible area (the scroll height beyond the client height, as a share of the scroll height)? A line, a job, Design and
// Export must show whole at every size; the Outline and a line being written may hide 5% at 1280×720 and nothing at the others.
// Then the tabs: each tab's and each foot button's centre is where it was, to 1px, when the panel folds (the tags stand at their
// open heights). Chromium through Playwright (PW_BUNDLED=1, or CHROME_PATH); writes only to out/.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8141);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };

const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});

// the share of the sheet that is hidden: the scroll height beyond the client height, of the scroll height (the fullest sheet, when there are two)
const hidden = page => page.evaluate(() => {
  const sheets = document.querySelector('#body[data-pane=both]') ? [...document.querySelectorAll('#body .pane')] : [document.querySelector('#body')];
  return Math.max(...sheets.map(e => (e.scrollHeight <= e.clientHeight + 2 ? 0 : (e.scrollHeight - e.clientHeight) / e.scrollHeight)));
});
const LIMITS = { line: [0, 0, 0], job: [0, 0, 0], design: [0, 0, 0], export: [0, 0, 0], outline: [5, 0, 0], writing: [5, 0, 0] };
const SIZES = [[1280, 720], [1470, 832], [1200, 750]];

for (const [i, [w, h]] of SIZES.entries()){
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() => { try { localStorage.setItem('rb-help-seen', '1'); } catch { /* none */ } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?memory`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const frame = page.frameLocator('#sheet iframe');
  const rest = async () => { await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await page.waitForTimeout(300); };
  const states = {
    line: async () => { await frame.locator('.bullets li').first().click(); },
    job: async () => { await frame.locator('.role-title').first().click(); },
    design: async () => { await page.click('#tab-design'); },
    export: async () => { await page.click('#tab-export'); },
    outline: async () => { await frame.locator('.bullets li').first().click(); await page.click('#tab-outline'); },
    writing: async () => { await frame.locator('.bullets li').nth(1).dblclick(); await page.waitForTimeout(500); },
  };
  for (const [name, go] of Object.entries(states)){
    let share = null, err = '';
    try { await rest(); await go(); await page.waitForTimeout(600); share = await hidden(page); } catch (e){ err = String(e.message ?? e).split('\n')[0].slice(0, 90); }
    const limit = LIMITS[name][i];
    ok(`${w}×${h}: ${name} hides ${share == null ? 'unknown' : `${(share * 100).toFixed(1)}%`} of the sheet (at most ${limit}%)`, share != null && share * 100 <= limit + 1e-9, err);
  }
  await ctx.close();
}

// ---- the tabs and the foot card: the same centres open and folded ----
{
  const ctx = await browser.newContext({ viewport: { width: 1470, height: 832 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('rb-help-seen', '1'); } catch { /* none */ } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?memory`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const centres = () => page.evaluate(() => [...document.querySelectorAll('#tabs [role=tab], #tabfoot button')].filter(b => !b.matches('.footlogo')).map(b => { const r = b.getBoundingClientRect(); return [b.dataset.m ?? b.dataset.act, Math.round((r.top + r.height / 2) * 10) / 10, Math.round(r.height * 10) / 10]; }));
  try {
    const open = await centres();
    await page.keyboard.press('e'); await page.waitForTimeout(700);
    const folded = await centres();
    ok(`the five tabs and undo, redo, the menu: ${open.length} buttons found open and folded`, open.length === 8 && folded.length === 8, `${open.length} / ${folded.length}`);
    const off = open.map((o, k) => Math.abs(o[1] - folded[k][1])), tall = open.map((o, k) => Math.abs(o[2] - folded[k][2]));
    ok('each tab and each foot button has its centre at the same height folded as open, to 1px', Math.max(...off) <= 1, open.map((o, k) => `${o[0]} ${o[1]}→${folded[k][1]}`).join(', '));
    ok('…and the same height', Math.max(...tall) <= 1);
    await page.keyboard.press('e'); await page.waitForTimeout(700);
    const again = await centres();
    ok('unfolded again, they are where they were', open.every((o, k) => Math.abs(o[1] - again[k][1]) <= 1));
  } catch (e){ ok('the tabs fold and unfold', false, String(e.message ?? e).split('\n')[0]); }
  await ctx.close();
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} room check(s) FAILED` : '\nall room checks passed');
process.exit(failed ? 1 : 0);
