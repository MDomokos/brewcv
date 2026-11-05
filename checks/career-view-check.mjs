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
//   - + Add glides Career to what it opens, then the form grows open there (a hover add grows open in place), focused; the menu has no "line" (a line is added from its job);
//   - a click on the bare ground (around the column, between the cards) closes what is open, an unsaved edit excepted;
//   - a card or a section opening or closing in place leaves the mat exactly still; the wheel still scrolls the content and the mat;
//   - "Something else" is one step: the kind's setup and its first entry together, where it will live, one Create, one undo step; Cancel
//     leaves nothing; a kind's settings, colour and delete in Career too;
//   - the lanes keep their own time: a tall open card on the left does not move the right lane; with every card open each lane is in order;
//   - the top fade's strength follows the scroll (none at the top, full past the toolbar's height and 16px), and runs from the toolbar's top edge, through its corners, to just under its foot;
//   - every kind of field reads at 4.5:1 on its surface in Career and the Editor's About you; the month picker's months and field too, in Career and in Mark as sent, Tea dark and Coffee light;
//   - Mark as read takes a machine-made wording's review flag off, one undo step, and Ctrl+Z puts it back;
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

async function open(w, h, { motion = false, look = ['tea', 'light'] } = {}){
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([m, d, t]) => { try { localStorage.setItem('rb-help-seen', '1'); localStorage.setItem('rb-esc-fold', 'off'); localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); if (!m) localStorage.setItem('rb-reduce-motion', '1'); } catch { /* none */ } }, [motion, ...look]);
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
  ok('+ Add opens one grouped menu', await page.evaluate(() => document.querySelectorAll('#ce-pop [data-act=cv-add]').length >= 9 && document.querySelectorAll('#ce-pop .ce-mg').length >= 2));
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

  // + Add brings what it opens into view; nothing else scrolls
  const sc = () => page.evaluate(() => document.getElementById('scr').scrollTop);
  await page.evaluate(() => document.getElementById('scr').scrollTo(0, 0)); await settle(page);
  await page.click('#ce-add'); await settle(page);
  ok('+ Add has no “line”: a line is added from its own job', await page.evaluate(() => !document.querySelector('#ce-pop [data-what=line]') && !!document.querySelector('#ce-pop [data-what=work]')));
  await page.click('#ce-pop [data-act=cv-add][data-what=languages]'); await settle(page);
  const shown = await page.evaluate(() => { const b = document.querySelector('#scr .ce-box[data-ce-sec=languages]'), r = b.getBoundingClientRect(), f = document.activeElement; return { top: Math.round(r.top), bottom: Math.round(r.bottom), focus: !!f?.closest('.ce-box[data-ce-sec=languages] .ce-inl'), scrolled: document.getElementById('scr').scrollTop }; });
  ok('+ Add, a language: Career scrolls the Languages card into view, its row open and focused, clear of the toolbar', shown.focus && shown.scrolled > 0 && shown.top >= 60 && shown.bottom <= 860, JSON.stringify(shown));
  await page.keyboard.press('Escape'); await settle(page);
  // a click on the bare ground closes what is open
  await page.evaluate(() => document.getElementById('scr').scrollTo(0, 0)); await settle(page);
  await page.click('#scr .ce-card[data-ce-card=hydra] .ce-ch'); await settle(page);
  await page.mouse.click(8, 600); await settle(page);      // left of the column, on the mat
  ok('a click on the mat beside the column closes the open card', await page.evaluate(() => !document.querySelector('#scr .ce-card.is-open')));
  await page.click('#scr .ce-card[data-ce-card=hydra] .ce-ch'); await settle(page);
  const gap = await page.evaluate(() => { const l = document.querySelector('#scr .ce-yrow .ce-lane:last-child'), r = l.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + 10)]; });
  await page.mouse.click(...gap); await settle(page);
  ok('…and a click between the cards (an empty lane) does too', await page.evaluate(() => !document.querySelector('#scr .ce-card.is-open')));
  await page.hover('#scr .ce-box[data-ce-sec=certificates] h3'); await page.click('#scr .ce-box[data-ce-sec=certificates] [data-act=cv-secedit]'); await settle(page);
  const u2 = await undo();
  await page.fill('#scr .ce-box[data-ce-sec=certificates] [data-ce-fi=issuer] >> nth=0', 'Example Board');
  await page.mouse.click(8, 600); await settle(page);
  ok('a section\u2019s field left by a click on the mat is saved, as leaving a field always is, and the section closes', (await undo()) === u2 + 1 && await page.evaluate(() => window.__wb.store.state.record.certificates.some(c => c.issuer === 'Example Board') && !document.querySelector('#scr .ce-box.is-editing')));
  await page.keyboard.press('Control+z'); await settle(page);
  // a card or a section opening in place leaves the mat exactly as it was: no layer is sized to, or drawn from the foot of, the content
  const matAt = () => page.screenshot({ clip: { x: 2, y: 300, width: 12, height: 200 } }).then(b => b.toString('base64'));      // the gutter left of the column: mat only
  const still = async (what, click) => {
    const t0 = await sc(), m0 = await matAt(); await click(); const mid = await matAt(); await settle(page); const m1 = await matAt(), t1 = await sc();
    ok(`${what}: the mat stays exactly where it was, during and after, at the same scroll`, t1 === t0 && mid === m0 && m1 === m0, JSON.stringify({ t0, t1, during: mid === m0, after: m1 === m0 }));
  };
  await page.evaluate(() => document.getElementById('scr').scrollTo(0, 200)); await settle(page);
  await still('a card opening in place', () => page.click('#scr .ce-card[data-ce-card=hydra] .ce-ch'));
  await still('and closing', () => page.click('#scr .ce-card[data-ce-card=hydra] .ce-ch'));
  await page.evaluate(() => { const s = document.getElementById('scr'), b = document.querySelector('#scr .ce-box[data-ce-sec=publications]'); s.scrollTop += b.getBoundingClientRect().top - 300; }); await settle(page);
  await page.hover('#scr .ce-box[data-ce-sec=publications] h3');
  await still('a section\u2019s fields opening', () => page.click('#scr .ce-box[data-ce-sec=publications] [data-act=cv-secedit]'));
  const w0 = await sc(), mw = await matAt(); await page.mouse.move(400, 500); await page.mouse.wheel(0, -240); await settle(page);
  ok('…and the wheel still scrolls Career afterwards, the mat with it', (await sc()) < w0 && (await matAt()) !== mw);
  await page.keyboard.press('Escape'); await settle(page);

  // the top fade's strength follows the scroll: none at the top, half at half the ramp (the toolbar's height and 16px), all past it, and back
  const fadeAt = y => page.evaluate(async y => { const s = document.getElementById('scr'); s.scrollTop = y; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return { f: +getComputedStyle(s).getPropertyValue('--ce-f'), ramp: parseFloat(s.style.getPropertyValue('--ce-ramp')) }; }, y);
  const f0 = await fadeAt(0), fm = await fadeAt(Math.round(f0.ramp / 2)), f1 = await fadeAt(Math.round(f0.ramp * 2)), fb = await fadeAt(0);
  ok('the top fade grows with the scroll: none at the top, about half at half the toolbar\u2019s height and 16px, full past it, none again back at the top', f0.f === 0 && Math.abs(fm.f - 0.5) < 0.05 && f1.f === 1 && fb.f === 0 && f0.ramp > 40, JSON.stringify({ f0, fm, f1, fb }));
  // scrolled, nothing shows beside the toolbar's rounded corners: the fade takes the whole width at its height, its corners included
  await page.evaluate(() => { const s = document.getElementById('scr'), c = document.querySelector('#scr .ce-card[data-ce-card=hydra]'), bar = document.querySelector('#scr .ce-bar'); s.scrollTop += c.getBoundingClientRect().top - bar.getBoundingClientRect().top + 10; }); await settle(page);      // the card's top just above the toolbar
  const corner = await page.evaluate(() => { const r = document.querySelector('#scr .ce-bar').getBoundingClientRect(); return { x: Math.floor(r.right) - 3, y: Math.ceil(r.top) + 1, top: Math.floor(r.top) - 3, below: Math.ceil(r.bottom) + 2, r: parseFloat(getComputedStyle(document.querySelector('#scr .ce-bar')).borderTopRightRadius) }; });
  const spot = y => page.screenshot({ clip: { x: corner.x, y, width: 2, height: 2 } }).then(b => b.toString('base64'));
  const withContent = [await spot(corner.top), await spot(corner.y), await spot(corner.below)];
  await page.addStyleTag({ content: '#scr .ce-doc { visibility: hidden !important; }' }); await settle(page);
  const without = [await spot(corner.top), await spot(corner.y), await spot(corner.below)];
  await page.evaluate(() => document.querySelector('style:last-of-type').remove()); await settle(page);
  ok('scrolled, the fade runs from the toolbar\u2019s top edge (nothing above it) through its corners to just under its foot (content faint there, not gone)', corner.r > 4 && withContent[0] === without[0] && withContent[2] !== without[2], JSON.stringify({ ...corner, same: withContent.map((x, i) => x === without[i]) }));

  // your own kind, in Career, in one step: the kind's setup and its first entry together, where it will live; Cancel leaves nothing
  const u1 = await undo();
  await page.click('#ce-add'); await settle(page); await page.click('#ce-pop [data-act=cv-kind-new]:not([data-p])'); await settle(page);
  ok('“Something else” opens Career\u2019s own kind card, with the first entry\u2019s fields, in the timeline, the name focused; the editor never opens', await page.evaluate(() => window.__wb.ui.view === 'record' && !!document.querySelector('#scr .ce-tg #ce-kindcard [data-ce-e=pos]') && document.activeElement?.dataset.ceK === 'name'));
  await page.click('#ce-kindcard [data-act=cv-kcancel]'); await settle(page);
  ok('Cancel leaves nothing behind', (await undo()) === u1 && !(await page.$('#ce-kindcard')));
  await page.click('#ce-add'); await settle(page); await page.click('#ce-pop [data-act=cv-kind-new]:not([data-p])'); await settle(page);
  await page.click('#ce-kindcard [data-act=cv-kpreset][data-p=awards]'); await settle(page);
  ok('a list preset (Awards) moves the card to Skills & credentials, “Awarded by” and one date for its first entry', await page.evaluate(() => document.querySelector('#ce-kindcard [data-ce-k=name]').value === 'Awards' && !!document.querySelector('#scr .ce-boxes #ce-kindcard') && !document.querySelector('#ce-kindcard #ce-ke-end')));
  await page.fill('#ce-kindcard [data-ce-e=pos]', 'Best student design'); await page.fill('#ce-kindcard [data-ce-e=org]', 'Example Society');
  await page.click('#ce-kindcard [data-act=cv-kcreate]'); await settle(page);
  const kd = await page.evaluate(() => { const k = window.__wb.store.state.record.kinds?.find(x => x.store === 'awards'); return { k: k?.id, entry: window.__wb.store.state.record.awards?.[0]?.title, shown: !!document.querySelector(`#scr .ce-box[data-ce-sec="${k?.id}"]`), view: window.__wb.ui.view }; });
  ok('one Create makes the kind and its first entry, one undo step, shown in its card in Skills & credentials', !!kd.k && kd.entry === 'Best student design' && kd.shown && kd.view === 'record' && (await undo()) === u1 + 1, JSON.stringify(kd));
  await page.hover(`#scr .ce-box[data-ce-sec="${kd.k}"] h3`); await page.click(`#scr .ce-box[data-ce-sec="${kd.k}"] [data-act=cv-kind-edit]`); await settle(page);
  await page.click('#ce-kindcard [data-act=cv-kcolour][data-i="4"]'); await settle(page);
  ok('a kind\u2019s settings open in Career too, and its colour changes at once', await page.evaluate(k => window.__wb.store.state.record.kinds.find(x => x.id === k)?.colour === 4 && !!document.querySelector('#ce-kindcard'), kd.k));
  await page.click('#ce-kindcard [data-act=cv-kdel]'); await settle(page); await page.click('#ce-kindcard [data-act=cv-kdelall]'); await settle(page);
  ok('deleting it asks first, then takes its entries with it', await page.evaluate(() => !window.__wb.store.state.record.kinds?.some(x => x.store === 'awards') && !document.querySelector('#ce-kindcard')));
  await page.keyboard.press('Control+z'); await settle(page);
  ok('one Ctrl+Z brings it back, with its entry', await page.evaluate(() => window.__wb.store.state.record.kinds?.some(x => x.store === 'awards') && window.__wb.store.state.record.awards?.[0]?.title === 'Best student design'));
  await page.click('#ce-add'); await settle(page); await page.click('#ce-pop [data-act=cv-kind-new][data-p=volunteering]'); await settle(page);
  await page.fill('#ce-kindcard [data-ce-e=pos]', 'Coach'); await page.fill('#ce-kindcard [data-ce-e=org]', 'Harbour Sailing Club');
  await page.click('#ce-kindcard [data-act=cv-kcreate]'); await settle(page);
  ok('a timeline kind (Volunteering) made the same way: its first entry\u2019s card is open in the timeline', await page.evaluate(() => { const v = window.__wb.store.state.record.volunteer?.[0]; return !!v && v.position === 'Coach' && !!document.querySelector(`#scr .ce-tg .ce-card.is-open[data-ce-card="${v.id}"]`); }));

  // the lanes keep their own time: a tall open card on the left does not move the right lane's cards
  await page.keyboard.press('Escape'); await page.evaluate(() => document.getElementById('scr').scrollTo(0, 0)); await settle(page);
  const right = () => page.evaluate(() => [...document.querySelectorAll('#scr .ce-card.k2')].map(c => Math.round(c.getBoundingClientRect().top + document.getElementById('scr').scrollTop)));
  const r0 = await right();
  await page.click('#scr .ce-card[data-ce-card=hydra] .ce-ch'); await settle(page);
  const r1 = await right(), tall = await page.evaluate(() => document.querySelector('#scr .ce-card[data-ce-card=hydra]').offsetHeight);
  ok('a tall open card in the left lane leaves the right lane\u2019s cards where they were', tall > 300 && JSON.stringify(r0) === JSON.stringify(r1), JSON.stringify({ tall, r0, r1 }));
  await page.click('[data-act=cv-all]'); await settle(page);
  const lanesOk = await page.evaluate(() => { const lane = k => [...document.querySelectorAll(`#scr .ce-card.k${k}`)].map(c => c.getBoundingClientRect()); const ok = rs => rs.every((r, i) => !i || r.top >= rs[i - 1].bottom - 1); return ok(lane(1)) && ok(lane(2)); });
  ok('with every card open, each lane keeps its cards in time order, none over another', lanesOk);
  await page.keyboard.press('Escape'); await settle(page);

  // a machine-made wording can be marked as read, in Career, as one undo step
  await page.evaluate(() => document.getElementById('scr').scrollTo(0, 0)); await page.click('#body .ce-chip[data-l=de]'); await settle(page);
  await page.click('#scr .ce-about .ce-ap.tg'); await settle(page);
  const flagged = () => page.evaluate(() => (window.__wb.store.state.record.variants.find(v => v.id === 'tagline-v1-de')?.tags ?? []).includes('needs-review'));
  const rf0 = await flagged(), u3 = await undo();
  await page.click('#scr .ce-abfan [data-act=cv-read][data-v=tagline-v1-de]'); await settle(page);
  ok('Mark as read takes a machine-made wording\u2019s review flag off, one undo step, and the mark goes', rf0 && !(await flagged()) && (await undo()) === u3 + 1 && !(await page.$('#scr .ce-abfan [data-act=cv-read][data-v=tagline-v1-de]')));
  await page.keyboard.press('Control+z'); await settle(page);
  ok('…and Ctrl+Z puts it back', await flagged());
  await page.keyboard.press('Escape'); await page.click('#body .ce-chip[data-l=en]'); await settle(page);

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

// + Add with motion: Career glides to where the entry goes, then its form grows open there; a hover add grows open in place
{
  const { ctx, page, errors } = await open(1440, 860, { motion: true });
  const track = sel => page.evaluate(sel => new Promise(r => { const s = document.getElementById('scr'), out = [], t0 = performance.now(); const f = () => { const el = document.querySelector(sel); out.push([Math.round(s.scrollTop), el ? Math.round(el.getBoundingClientRect().height) : -1]); if (performance.now() - t0 < 2200) requestAnimationFrame(f); else r(out); }; requestAnimationFrame(f); }), sel);
  await page.click('#ce-add'); await settle(page);
  const seen = track('#scr .ce-box[data-ce-sec=languages] .ce-inl');
  await page.click('#ce-pop [data-act=cv-add][data-what=languages]');
  const frames = await seen;
  const tops = [...new Set(frames.map(f => f[0]))], stop = frames.findIndex((f, i) => i && f[0] === frames.at(-1)[0] && frames.slice(i).every(g => g[0] === f[0]));
  const before = frames.slice(0, stop).map(f => f[1]), after_ = frames.slice(stop).map(f => f[1]), full = frames.at(-1)[1];
  ok('+ Add, a language: Career glides there (many steps, not a jump), and only then the row grows open from nothing to its height', tops.length > 4 && before.every(hh => hh <= 1) && after_.some(hh => hh > 1 && hh < full) && full > 20, JSON.stringify({ steps: tops.length, before: [...new Set(before)], grow: [...new Set(after_)].slice(0, 8), full }));
  await page.keyboard.press('Escape'); await settle(page);
  const y0 = await page.evaluate(() => document.getElementById('scr').scrollTop);
  await page.hover('#scr .ce-box[data-ce-sec=certificates] h3');
  const seen2 = track('#scr .ce-box[data-ce-sec=certificates] #ce-addcard');
  await page.click('#scr .ce-box[data-ce-sec=certificates] [data-act=cv-add]');
  const f2 = await seen2;
  ok('a hover add grows its form open in place, from nothing', f2.some(f => f[1] > 1 && f[1] < f2.at(-1)[1]) && f2[0][0] === y0, JSON.stringify({ y0, first: f2.slice(0, 3), last: f2.at(-1) }));
  ok('no errors', errors.length === 0, errors[0] ?? '');
  await ctx.close();
}

// the month picker takes the surface its field sits on: its months readable (4.5:1 at least) in Career and in Mark as sent, Tea dark, Coffee light and Tea light (where Career's paper and the sidebar differ)
const CONTRAST = () => {
  const parse = c => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const bgOf = el => { const layers = []; for (let n = el; n; n = n.parentElement){ const c = parse(getComputedStyle(n).backgroundColor); if (c.a > 0){ layers.push(c); if (c.a >= 1) break; } } let o = { r: 255, g: 255, b: 255 }; for (const c of layers.reverse()) o = { r: c.r * c.a + o.r * (1 - c.a), g: c.g * c.a + o.g * (1 - c.a), b: c.b * c.a + o.b * (1 - c.a) }; return o; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const m = document.getElementById('mp-menu'), f = document.querySelector('.mpbtn[aria-expanded=true]');
  if (!m || !f) return null;
  return { months: Math.min(...[...m.querySelectorAll('.mpgrid button:not(:disabled), .mpyear output')].map(b => ratio(parse(getComputedStyle(b).color), bgOf(b)))), field: ratio(parse(getComputedStyle(f).color), bgOf(f)) };
};
// every kind of field reads on its surface (4.5:1): text, e-mail, phone, a few lines, a month, a list; in Career and in the Editor's About you
const FIELDS = root => {
  const parse = c => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const bgOf = el => { const layers = []; for (let n = el; n; n = n.parentElement){ const c = parse(getComputedStyle(n).backgroundColor); if (c.a > 0){ layers.push(c); if (c.a >= 1) break; } } let o = { r: 255, g: 255, b: 255 }; for (const c of layers.reverse()) o = { r: c.r * c.a + o.r * (1 - c.a), g: c.g * c.a + o.g * (1 - c.a), b: c.b * c.a + o.b * (1 - c.a) }; return o; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const kind = e => (e.matches('.mpbtn') ? 'month' : e.matches('.ddbtn') ? 'select' : e.tagName === 'TEXTAREA' ? 'textarea' : e.type || 'text');
  const out = {};
  for (const e of document.querySelectorAll(`${root} :is(input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, .mpbtn, .ddbtn)`)){
    if (!e.offsetParent) continue;
    const r = ratio(parse(getComputedStyle(e).color), bgOf(e)), k = kind(e);
    out[k] = Math.min(out[k] ?? 99, Math.round(r * 100) / 100);
  }
  return out;
};
for (const look of [['tea', 'dark'], ['coffee', 'light'], ['tea', 'light'], ['coffee', 'dark']]){
  const { ctx, page } = await open(1440, 860, { look });
  await page.hover('#ce-about .ce-ab'); await page.click('#ce-about [data-act=cv-about]'); await settle(page);
  const about = await page.evaluate(FIELDS, '#scr .ce-aboutform');
  await page.keyboard.press('Escape'); await page.click('#ce-add'); await page.click('#ce-pop [data-act=cv-add][data-what=work]'); await settle(page);
  const add = await page.evaluate(FIELDS, '#scr #ce-addcard');
  await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('#scr .ce-box[data-ce-sec=languages]').scrollIntoView()); await page.hover('#scr .ce-box[data-ce-sec=languages] h3'); await page.click('#scr .ce-box[data-ce-sec=languages] [data-act=cv-secedit]'); await settle(page);
  const langs = await page.evaluate(FIELDS, '#scr .ce-box[data-ce-sec=languages]');
  await page.evaluate(() => { window.__wb.ui.sel = { kind: 'header' }; window.__wb.setView(null); }); await settle(page);
  const editor = await page.evaluate(FIELDS, '#body');
  const all = { ...about, ...add, ...langs }, kinds = ['text', 'email', 'tel', 'textarea', 'month', 'select'];
  ok(`${look.join(' ')}: every kind of field reads on its surface at 4.5:1 (text, e-mail, phone, a few lines, a month, a list), in Career and in the Editor's About you`, kinds.every(k => all[k] >= 4.5) && Object.values(editor).length > 2 && Object.values(editor).every(v => v >= 4.5), JSON.stringify({ career: all, editor }));
  await ctx.close();
}
for (const look of [['tea', 'dark'], ['coffee', 'light'], ['tea', 'light']]){
  const { ctx, page } = await open(1440, 860, { look });
  await page.click('#ce-add'); await page.click('#ce-pop [data-act=cv-add][data-what=work]'); await settle(page);
  await page.click('#ce-f-start-b'); await settle(page);
  const career = await page.evaluate(CONTRAST);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  await page.evaluate(() => window.__wb.resumes.markSent()); await settle(page);
  await page.click('[id$=-date-b]'); await settle(page);
  const sent = await page.evaluate(CONTRAST);
  ok(`${look.join(' ')}: the month picker reads on its own surface: its months and its field at 4.5:1 at least, in Career and in Mark as sent`, [career, sent].every(c => c && c.months >= 4.5 && c.field >= 4.5), JSON.stringify({ career, sent }));
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
