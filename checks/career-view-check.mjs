#!/usr/bin/env node
// node checks/career-view-check.mjs
// Career as one scroll, in Chromium on the fictional example:
//   - the mat moves with Career's scroll in the same frame: #scr carries it (background-attachment: local) and nothing sets an offset from a
//     script; a picture taken in the middle of a smooth scroll shows the mat moved by exactly what the content moved, behind the sidebar too,
//   - one editor is open at a time: a card's lines, a line's wordings, an entry's fields, a section's rows, an add,
//   - Esc closes a menu first, then cancels an unsaved edit (and only that), then closes what is open; a click on the bare ground and the
//     mouse's back button keep an unsaved edit, and close what is open when nothing is typed,
//   - a skill word moved to another group keeps the scroll where it was,
//   - in a narrow card the hover "+ Add" and "On this resume" both show, side by side,
//   - under 860px the timeline is one column.
// Chromium through Playwright (PW_BUNDLED=1, or CHROME_PATH); writes nothing.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8317);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
server.listen(PORT);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});

async function open(w, h, { motion = false } = {}){
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(m => { try { localStorage.setItem('rb-help-seen', '1'); localStorage.setItem('rb-esc-fold', 'off'); localStorage.setItem('rb-drink', 'tea'); localStorage.setItem('rb-theme', 'light'); if (!m) localStorage.setItem('rb-reduce-motion', '1'); } catch { /* none */ } }, motion);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/?memory#record`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && !!document.querySelector('#scr .ce-doc'), null, { timeout: 20000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const settle = page => page.waitForTimeout(250);
const editors = page => page.evaluate(() => document.querySelectorAll('#scr :is(.ce-det, .ce-v.is-edit, .ce-addcard, .ce-inl, .ce-se, .ce-fan)').length);
// a picture's pixels, read back through a canvas in a blank page
async function pixels(ctx, png){
  const p = await ctx.newPage();
  const data = await p.evaluate(async b64 => {
    const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))], { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, d: [...g.getImageData(0, 0, c.width, c.height).data] };
  }, png.toString('base64'));
  await p.close();
  return data;
}

{
  const { ctx, page, errors } = await open(1440, 860, { motion: true });
  ok('Career opens as one scroll: About you, the timeline with its cards, Skills & credentials', await page.evaluate(() => !!document.querySelector('#scr .ce-about') && document.querySelectorAll('#scr .ce-card').length >= 8 && document.querySelectorAll('#scr .ce-box').length >= 4));
  ok('the mat is the scroller\'s own background and scrolls with it; no script offsets it', await page.evaluate(() => getComputedStyle(document.getElementById('scr')).backgroundAttachment.split(',').every(x => x.trim() === 'local') && !document.documentElement.style.getPropertyValue('--mat-y')));

  // the reference: the mat alone at the top, then a marker in the content and a smooth scroll, caught in the middle
  await page.addStyleTag({ content: '#scr .ce-doc, #scr .ce-bar, #col, #rail, .ptabs, #ptabs { visibility: hidden !important; } #scr { -webkit-mask: none !important; mask: none !important; }' });
  await page.evaluate(() => { const m = document.createElement('div'); m.id = 'ce-marker'; m.style.cssText = 'position:absolute;left:30px;top:420px;width:24px;height:6px;background:#ff00ff;z-index:99;visibility:visible'; document.getElementById('scr').append(m); });
  await page.waitForTimeout(200);
  const before = await pixels(ctx, await page.screenshot());
  await page.mouse.move(700, 500); await page.mouse.wheel(0, 400);      // the wheel scrolls on the compositor's own time; the picture is taken at once
  const mid = await pixels(ctx, await page.screenshot());
  const at = (img, x, y) => { const i = (y * img.w + x) * 4; return [img.d[i], img.d[i + 1], img.d[i + 2]]; };
  const markY = img => { for (let y = 0; y < img.h; y++){ const [r, g, b] = at(img, 40, y); if (r > 240 && g < 30 && b > 240) return y; } return null; };
  const moved = markY(before) - markY(mid);
  // the mat's shift: the one that lines the middle picture up with the reference across the whole width (under the sidebar's place too)
  const cols = [8, 300, 700, 1100, 1300, 1430], rows = []; for (let y = 200; y < 380; y += 3) rows.push(y);
  let best = null;
  for (let s = 0; s <= 160; s++){
    let d = 0;
    for (const y of rows) for (const x of cols){ const a = at(mid, x, y), b = at(before, x, y + s); d += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); }
    if (!best || d < best.d) best = { s, d };
  }
  const period = 145;      // Tea's mat repeats every 145px: the content's move is compared modulo it
  ok('in one picture taken while the wheel scrolls, the mat has moved exactly as far as the content, in the same picture', moved > 0 && moved <= 400 && best.d <= rows.length * cols.length * 3 && ((moved - best.s) % period + period) % period === 0, `content ${moved}px, mat ${best.s}px (mod ${period}), colour difference ${best.d} over ${rows.length * cols.length} points`);
  await page.waitForTimeout(800);
  const end = await pixels(ctx, await page.screenshot()), top = await page.evaluate(() => document.getElementById('scr').scrollTop);
  ok('at rest, the content has moved by scrollTop', markY(before) - markY(end) === Math.round(top), `${markY(before) - markY(end)} vs ${top}`);
  ok('no errors', errors.length === 0, errors[0] ?? '');
  await ctx.close();
}

{
  const { ctx, page, errors } = await open(1440, 860);
  const undo = () => page.evaluate(() => window.__wb.store.history.undo);
  // one editor at a time
  await page.click('#scr .ce-card[data-ce-card=hydra] .ce-ch'); await settle(page);
  ok('a card opens its lines', await page.evaluate(() => document.querySelectorAll('#scr .ce-card.is-open').length === 1 && document.querySelectorAll('#scr .ce-card[data-ce-card=hydra] .ce-ln').length === 7));
  await page.hover('#scr .ce-card[data-ce-card=poly] .ce-ch'); await page.click('#scr .ce-card[data-ce-card=poly] [data-act=cv-details]'); await settle(page);
  ok('an entry\'s fields open in place and the other card closes: one editor', await page.evaluate(() => document.querySelectorAll('#scr .ce-card.is-open').length === 0 && document.querySelectorAll('#scr .ce-det').length === 1 && !!document.querySelector('#scr .ce-card[data-ce-card=poly] .ce-det [data-form]')));
  ok('the sidebar speaks of the entry\'s fields', /Details/.test(await page.textContent('#body .ce-side')));
  await page.click('#scr .ce-card[data-ce-card=hydra] .ce-ch'); await settle(page);
  await page.click('#scr .ce-card[data-ce-card=hydra] .ce-ln >> nth=0 >> .ce-line'); await settle(page);
  ok('a line fans out its wordings; the fields close', (await editors(page)) === 1 && await page.evaluate(() => !!document.querySelector('#scr .ce-fan .ce-v') && !document.querySelector('#scr .ce-det')));
  ok('the sidebar follows: This line, printed by, its languages', /This line/.test(await page.textContent('#body .ce-side')));
  await page.click('#scr .ce-fan [data-act=cv-edit] >> nth=0'); await settle(page);
  ok('Edit opens one box, with the focus in it', await page.evaluate(() => document.querySelectorAll('#scr textarea.ce-ed').length === 1 && document.activeElement?.id === 'ce-ta'));
  // an unsaved edit survives everything but Esc
  const u0 = await undo();
  await page.keyboard.type(' (edited)');
  await page.mouse.click(1000, 840); await settle(page);      // the bare ground, under the timeline
  ok('a click on the bare ground keeps an unsaved edit', await page.evaluate(() => /\(edited\)/.test(document.getElementById('ce-ta')?.value ?? '')));
  await page.mouse.click(1000, 840, { button: 'back' }).catch(() => {}); await settle(page);
  ok('the mouse\'s back button keeps it too, and Career stays', await page.evaluate(() => window.__wb.ui.view === 'record' && /\(edited\)/.test(document.getElementById('ce-ta')?.value ?? '')));
  await page.focus('#ce-ta'); await page.keyboard.press('Escape'); await settle(page);
  ok('Esc cancels the edit, and only the edit: nothing saved, the wordings still shown', !(await page.$('#ce-ta')) && (await undo()) === u0 && await page.evaluate(() => !!document.querySelector('#scr .ce-fan')));
  await page.keyboard.press('Escape'); await settle(page);
  ok('the next Esc closes what is open, in Career', (await editors(page)) === 0 && await page.evaluate(() => !document.querySelector('#scr .ce-card.is-open') && window.__wb.ui.view === 'record'));
  await page.click('#ce-add'); await settle(page);
  ok('+ Add opens one grouped menu', await page.evaluate(() => document.querySelectorAll('#ce-pop [data-act=cv-add]').length >= 10 && document.querySelectorAll('#ce-pop .ce-mg').length >= 2));
  await page.click('#scr .ce-card[data-ce-card=hydra] .ce-ch', { force: true }).catch(() => {}); await settle(page);
  await page.keyboard.press('Escape'); await settle(page);
  ok('Esc closes a menu first', !(await page.$('#ce-pop')));
  // adds: a job's card in the page; cancel makes nothing
  await page.click('#ce-add'); await page.click('#ce-pop [data-what=work]'); await settle(page);
  ok('+ Add, Job opens a card in the page with the focus in it', await page.evaluate(() => !!document.querySelector('#scr #ce-addcard') && document.activeElement?.closest('#ce-addcard') !== null));
  await page.keyboard.press('Escape'); await settle(page);
  ok('…and Esc there makes nothing', !(await page.$('#scr #ce-addcard')) && (await undo()) === u0);

  // a skill word moved to another group: the scroll stays
  await page.evaluate(() => document.getElementById('ce-skills').scrollIntoView({ block: 'start' })); await settle(page);
  await page.hover('#scr .ce-box[data-ce-sec=skills] h3'); await page.click('#scr .ce-box[data-ce-sec=skills] [data-act=cv-secedit]'); await settle(page);
  const groups = await page.$$eval('#scr [data-ce-ws]', ws => ws.map(w => w.dataset.ceWs));
  const word = await page.$eval(`#scr [data-ce-ws="${groups[0]}"] [data-ce-pw]`, p => p.dataset.k);
  const top0 = await page.evaluate(() => document.getElementById('scr').scrollTop);
  await page.dragAndDrop(`#scr [data-ce-pw][data-k="${word}"]`, `#scr [data-ce-ws="${groups[1]}"]`); await settle(page);
  const after = await page.evaluate(([g, k]) => ({ top: document.getElementById('scr').scrollTop, there: !!document.querySelector(`#scr [data-ce-ws="${g}"] [data-ce-pw][data-k="${CSS.escape(k)}"]`), editing: !!document.querySelector('#scr .ce-box.is-editing') }), [groups[1], word]);
  ok('a skill word dragged to another group moves there, the editor stays open, and the scroll stays where it was', after.there && after.editing && Math.abs(after.top - top0) < 1, JSON.stringify({ top0, ...after }));
  ok('one undo step undoes the move', (await undo()) === u0 + 1);
  await page.keyboard.press('Escape'); await settle(page);

  // a narrow card under the open resume's picks: the hover "+ Add" and "On this resume" both show
  await page.evaluate(() => document.querySelector('#scr .ce-box[data-ce-sec=languages]').scrollIntoView({ block: 'center' }));
  await page.hover('#scr .ce-box[data-ce-sec=languages] h3'); await page.waitForTimeout(150);
  const narrow = await page.evaluate(() => {
    const h = document.querySelector('#scr .ce-box[data-ce-sec=languages] h3'), sw = h.querySelector('.ce-sw span'), add = h.querySelector('.ce-hadd'), r = e => e.getBoundingClientRect();
    const a = r(sw), b = r(add);
    return { label: a.width > 40 && getComputedStyle(sw).fontSize !== '0px', add: getComputedStyle(add).opacity === '1' && b.width > 0, apart: a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, w: Math.round(r(h).width) };
  });
  ok('in a narrow card the hover add and "On this resume" both show, apart', narrow.label && narrow.add && narrow.apart, JSON.stringify(narrow));
  ok('no errors', errors.length === 0, errors[0] ?? '');
  await ctx.close();
}

{
  const { ctx, page, errors } = await open(800, 860);
  const one = await page.evaluate(() => { const r = document.querySelector('#scr .ce-yrow'); return getComputedStyle(r).gridTemplateColumns.trim().split(/\s+/).length; });
  ok('under 860px the timeline is one column', one === 1, String(one));
  ok('no errors', errors.length === 0, errors[0] ?? '');
  await ctx.close();
}

await browser.close();
server.close();
console.log(failed ? `\n${failed} career view check(s) FAILED` : '\nall career view checks passed');
process.exit(failed ? 1 : 0);
