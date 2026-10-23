#!/usr/bin/env node
// node checks/overlap-check.mjs
// Nothing the app draws over the page overlaps another of its marks, or printed text it is not about (UX-6f 4c): the plate and its ring trail, the grip, the "+",
// the version tools, the depth chip, the socket, the drop line, the rail, the card, the search, preview and missing-text marks, the zoom bar and the photo slot. The
// shapes and the allowed pairs are checks/lib/overlap.mjs. Run over a line (the first, a middle and the last of a job), a skill group, a job, a section and a header line,
// at rest, hovered, selected (and with the chip's list open), written and lifted, and in the middle of a glide; in Tea and Coffee, light and dark; at the page's fit and at 130%; in a narrow window and at
// phone width; in English and in German (the longer words). PARTS=main,looks,narrow,phone and MAIN=en-reduced,de-motion narrow it; ALLFAILS=1 lists every failure.
// Chromium through Playwright (PW_BUNDLED=1, or CHROME_PATH); writes nothing.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shapes, overlaps, ALLOWED } from './lib/overlap.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8167);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
server.listen(PORT, 511);
await new Promise(r => server.once('listening', r));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const part = k => !process.env.PARTS || process.env.PARTS.split(',').includes(k);
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});

async function open({ drink = 'tea', theme = 'light', motion = false, w = 1470, h = 832, lang = 'en' } = {}){
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: motion ? 'no-preference' : 'reduce' });
  await ctx.addInitScript(([d, t]) => { try { localStorage.setItem('rb-help-seen', '1'); localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); } catch { /* none */ } }, [drink, theme]);
  const page = await ctx.newPage(), bad = [];
  page.on('console', m => { if (m.type() === 'error') bad.push(m.text()); });
  page.on('pageerror', e => bad.push(String(e)));
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.evaluate(() => { window.__wb.edit.setGuard?.(false); window.__wb.edit.setAutoFold?.(false); window.__wb.hands.gate?.(false); });
  if (!(await page.isVisible('#switcher'))) await page.click('#docname-btn');
  await page.waitForSelector('#switcher .sopt'); await page.fill('#switcher #sw-q', 'Medtech');
  await page.click('#switcher .sopt:has-text("Medtech")'); await page.waitForTimeout(900);
  if (lang !== 'en'){ await page.evaluate(async l => { const I = await import('/src/i18n/index.js'); await I.loadCatalogue(l); window.__wb.ui.pref = { mode: 'fixed', lang: l }; window.__wb.store.commit(d => { d.cur.name = `${d.cur.name} `; }, 'name'); }, lang); await page.waitForTimeout(700); }
  return { ctx, page, bad };
}
const rest = async page => { await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await page.evaluate(() => { window.__wb.ui.sel = { kind: 'none' }; window.__wb.setView(null); window.__wb.canvas.reset({ page: 0 }); }); await page.waitForTimeout(700); };
// the block's page brought into view, the camera at `z` about the block, the block inside the pages' room, and its box on the screen
async function bring(page, T, z){
  const at = await page.evaluate(([sel, n]) => { const d = document.querySelector('#sheet iframe').contentDocument, els = [...d.querySelectorAll(sel)], el = n < 0 ? els.at(n) : els[n]; return el ? [...d.querySelectorAll('.document > .page')].indexOf(el.closest('.page')) : -1; }, [T.sel, T.n]);
  if (at < 0) return null;
  if (at !== (await page.evaluate(() => window.__wb.ui.page ?? 0))){ await page.evaluate(i => window.__wb.canvas.goToPage(i), at); await page.waitForTimeout(500); }
  const loc = () => page.frameLocator('#sheet iframe').locator(T.sel).nth(T.n);
  if (z !== 1){ const b = await loc().boundingBox(); await page.evaluate(([z, x, y]) => window.__wb.canvas.zoomTo(z, { x, y }, { animate: false }), [z, b.x + b.width / 2, b.y + b.height / 2]); await page.waitForTimeout(300); }
  await page.evaluate(([sel, n]) => { const d = document.querySelector('#sheet iframe').contentDocument, els = [...d.querySelectorAll(sel)], el = n < 0 ? els.at(n) : els[n]; if (window.__wb.canvas.view) window.__wb.canvas.ensureVisible(window.__wb.sheet.rectOfEl(el)); else el.scrollIntoView({ block: 'center' }); }, [T.sel, T.n]); await page.waitForTimeout(500);      // in the pages' room (a phone scrolls its page, and its bars cover the foot of the window)
  return loc().boundingBox();
}
const glideTo = async (page, x, y) => { await page.mouse.move(x - 30, y); for (let k = 1; k <= 6; k++){ await page.mouse.move(x - 30 + 5 * k, y); await page.waitForTimeout(25); } await page.waitForTimeout(400); };

// the blocks: which element (in the page's frame) to point at for its hover, and how far in
const LI = '.band[data-section=experience] .entry:first-of-type .bullets li';
const TARGETS = {
  'first line': { sel: LI, n: 0, dx: 60 },
  'middle line': { sel: LI, n: 2, dx: 60 },
  'last line': { sel: LI, n: -1, dx: 60 },
  'skill group': { sel: '.skills__items', n: 0, dx: 30 },
  'job': { sel: '.band[data-section=experience] .role-title', n: 0, dx: 30 },
  'section': { sel: '.band[data-section=experience] .tab', n: 0, dx: 10 },
  'header line': { sel: '.band--header .contact [data-variant], .band--header [data-variant]:not(.name)', n: 0, dx: 10 },
};
const WRITES = new Set(['first line', 'middle line', 'last line', 'skill group', 'header line']);
const LIFTS = new Set(['middle line', 'job', 'section', 'skill group']);

// one look: every target in every state; returns the failures as text
async function sweep(page, tag, { states = ['rest', 'hover', 'glide', 'selected', 'list', 'writing', 'lifted'], zooms = [1, 1.3], glide = false } = {}){      // glide: with motion, some look must catch a plate on its way
  const fails = [];
  let glides = 0;
  // `need`: the shape the state is about must be there (a hover's plate, a lifted block), so a look that missed its state is a failure, not a pass
  const look = async (what, need) => { const sh = await shapes(page), o = overlaps(sh); if (sh.shapes.some(q => q.moving)) glides++; if (need && !sh.shapes.some(q => need.includes(q.kind))) fails.push(`${what}: no ${need.join(' or ')} drawn`); if (o.pairs.length || o.text.length) fails.push(`${what}: ${[...o.pairs.map(p => `${p.a} × ${p.b} ${p.px}px`), ...o.text.map(t => `${t.a} over text ${t.px}px`)].slice(0, 4).join(', ')}`); };
  for (const z of zooms) for (const [name, T] of Object.entries(TARGETS)){
    const w = `${tag} ${Math.round(z * 100)}% ${name}`;
    await rest(page);
    const b = await bring(page, T, z); if (!b){ fails.push(`${w}: not on the page`); continue; }
    const pt = { x: b.x + Math.min(T.dx, b.width / 2), y: b.y + Math.min(6, b.height / 2) };
    if (states.includes('rest')) await look(`${w} at rest`);
    if (states.includes('hover')){ await glideTo(page, pt.x, pt.y); await look(`${w} hovered`, ['plate']); }
    if (states.includes('glide')){      // the middle of a glide from the line above (the plate and its grip on their way)
      await page.evaluate(() => document.documentElement.style.setProperty('--plate-glide', '600ms'));
      await page.evaluate(() => { const d = document.querySelector('#sheet iframe').contentDocument; d.documentElement.style.setProperty('--plate-glide', '600ms'); });
      await page.mouse.move(pt.x, pt.y - 40, { steps: 4 }); await page.waitForTimeout(450); await page.mouse.move(pt.x, pt.y, { steps: 4 }); await page.waitForTimeout(250);
      await look(`${w} mid-glide`);
      await page.evaluate(() => { document.documentElement.style.removeProperty('--plate-glide'); document.querySelector('#sheet iframe').contentDocument.documentElement.style.setProperty('--plate-glide', getComputedStyle(document.documentElement).getPropertyValue('--plate-glide')); });
      await page.waitForTimeout(500);
    }
    if (states.includes('selected')){ await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(500); if (await page.evaluate(() => window.__wb.ui.writing)) await page.keyboard.press('Escape'); await page.mouse.move(4, 4); await page.waitForTimeout(500); await look(`${w} selected`, ['plate']);
      const lv = page.locator('#editlay .depth .dp-l[aria-haspopup]').last();      // the chip's deepest list open (item 10)
      if (states.includes('list') && await lv.isVisible()){ await lv.hover(); await page.waitForTimeout(300); await look(`${w} selected, its chip's list open`, ['list']); await page.mouse.move(4, 4); await page.waitForTimeout(300); }
      // a line under a selected job hovered: its "+" (hands.js) and the job's chip (placed before it, onpage.js placeChip) stand clear of each other; the second job is where they met
      if (name === 'job' && states.includes('hover')) for (const j of [0, 1]){
        const fr = page.frameLocator('#sheet iframe'), tb = await fr.locator('.band[data-section=experience] .role-title').nth(j).boundingBox(), vh = page.viewportSize().height;
        if (!tb || tb.y < 0 || tb.y > vh - 120) continue;
        await page.mouse.click(tb.x + 30, tb.y + 4); await page.waitForTimeout(500); if (await page.evaluate(() => window.__wb.ui.writing)) await page.keyboard.press('Escape');
        const lb = await fr.locator('.band[data-section=experience] .entry').nth(j).locator('.bullets li').first().boundingBox();
        if (lb && lb.y + lb.height < vh - 80){ await glideTo(page, lb.x + Math.min(60, lb.width / 2), lb.y + Math.min(6, lb.height / 2)); await look(`${w} job ${j} selected, its first line hovered`, ['plus']); await page.mouse.move(4, 4); await page.waitForTimeout(300); }
      }
    }
    if (states.includes('writing') && WRITES.has(name)){
      await rest(page); const b2 = await bring(page, T, z);
      if (b2){ await page.mouse.click(b2.x + Math.min(T.dx, b2.width / 2), b2.y + Math.min(6, b2.height / 2)); await page.waitForTimeout(500); if (!(await page.evaluate(() => window.__wb.ui.writing))) await page.mouse.click(b2.x + Math.min(T.dx, b2.width / 2), b2.y + Math.min(6, b2.height / 2)); await page.waitForTimeout(900); }
      if (await page.evaluate(() => window.__wb.ui.writing)) await look(`${w} written`, ['plate']); else fails.push(`${w}: not written`);
    }
    if (states.includes('lifted') && LIFTS.has(name)){
      await rest(page); const b3 = await bring(page, T, z);
      if (b3){
        const g = { x: b3.x + Math.min(T.dx, b3.width / 2), y: b3.y + Math.min(6, b3.height / 2) };
        await glideTo(page, g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x + 6, g.y + 20, { steps: 5 }); await page.mouse.move(g.x + 8, g.y + 46, { steps: 6 }); await page.waitForTimeout(450);
        await look(`${w} lifted`, ['lift', 'card']);
        await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(500);
      }
    }
  }
  if (glide && states.includes('glide') && !glides) fails.push(`${tag}: no plate was seen on its way (the mid-glide looks missed the glide)`);
  if (process.env.ALLFAILS) for (const f of fails) console.log(`  · ${f}`);
  return fails;
}

if (part('main')){
  for (const lang of ['en', 'de']) for (const motion of [false, true]){
    if (process.env.MAIN && !process.env.MAIN.split(',').includes(`${lang}-${motion ? 'motion' : 'reduced'}`)) continue;      // MAIN=en-reduced,de-motion narrows it
    const { ctx, page, bad } = await open({ lang, motion });
    const fails = await sweep(page, `tea light ${lang}${motion ? ' motion' : ''}`, motion ? { zooms: [1], glide: true } : {});
    ok(`overlap: Tea light, ${lang}, ${motion ? 'with motion (the writing camera at 130%)' : 'reduced motion, at fit and 130%'}: no mark overlaps another or text it is not about, in every state`, fails.length === 0, fails.slice(0, 6).join(' | '));
    ok(`overlap: Tea light, ${lang}, ${motion ? 'motion' : 'reduced'}: no console errors`, bad.length === 0, bad[0] ?? '');
    await ctx.close();
  }
}
if (part('looks')) for (const [drink, theme] of [['tea', 'dark'], ['coffee', 'light'], ['coffee', 'dark']]){
  const { ctx, page, bad } = await open({ drink, theme });
  const fails = await sweep(page, `${drink} ${theme}`, { zooms: [1] });
  ok(`overlap: ${drink} ${theme}: no mark overlaps another or text it is not about, in every state`, fails.length === 0, fails.slice(0, 6).join(' | '));
  ok(`overlap: ${drink} ${theme}: no console errors`, bad.length === 0, bad[0] ?? '');
  await ctx.close();
}
if (part('narrow')) for (const lang of ['en', 'de']){
  const { ctx, page, bad } = await open({ w: 1100, h: 720, lang });
  const fails = await sweep(page, `narrow ${lang}`, { zooms: [1, 1.3] });
  ok(`overlap: a narrow window (1100 × 720), ${lang}: no mark overlaps another or text it is not about, in every state`, fails.length === 0, fails.slice(0, 6).join(' | '));
  ok(`overlap: narrow ${lang}: no console errors`, bad.length === 0, bad[0] ?? '');
  await ctx.close();
}
if (part('phone')){
  const { ctx, page, bad } = await open({ w: 390, h: 844 });
  const fails = await sweep(page, 'phone', { states: ['rest', 'selected'], zooms: [1] });      // a phone writes in the sheet, not on the page, and has no hover: the page shows the selection only
  ok('overlap: phone width (390 × 844): the selection on the page overlaps nothing', fails.length === 0, fails.slice(0, 6).join(' | '));
  ok('overlap: phone: no console errors', bad.length === 0, bad[0] ?? '');
  await ctx.close();
}
console.log(`\nallowed pairs:\n${ALLOWED.map(p => `  ${p.a} × ${p.b}${p.touch < 1e9 ? ` (up to ${p.touch}px)` : ''}: ${p.why}`).join('\n')}`);
await browser.close(); server.close();
console.log(failed ? `\n${failed} FAILED` : '\nall overlap checks passed');
process.exit(failed ? 1 : 0);
