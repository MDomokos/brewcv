#!/usr/bin/env node
// node checks/icon-check.mjs        (ONLY=sizes,concepts,outline runs only those sections; PORT=... picks the port)
// The icon design language (docs: Icon Design Language), in Chromium through Playwright (CHROME_PATH, or PW_BUNDLED=1); writes nothing.
//  sizes:    in Tea and Coffee, light and dark, on every screen (Editor with a line, a section and a job open, Design, Export, the Library and its
//            inspector, Settings, Career and a Career form, the name window, the head menu, the language menu, the help card) and on a phone,
//            every rendered icon is one of the four role sizes (12, 16, 24, 44), its tokens are the drink's (Tea 1.75 / 1.75 / 2.25 / 3 px, Coffee
//            1.5 / 1.5 / 2 / 2.5 px) and the stroke it draws is its role's token, in screen pixels (non-scaling).
//  concepts: every control of a registered concept (delete, close, edit, revert, lock, add, more, pin, focus, help, zoom) renders the icon the
//            registry (CONCEPT in src/ui/icons.js) names, on every screen it appears on; delete is the X, never a bin; no registered icon serves
//            two concepts (delete and close share the X and differ by the control's tier); the places and modes draw the drink's own tab drawing.
//  outline:  the Outline's sections each have an icon of their own (Name and contact is not Summary), at most six hues, Skills and Patent not one.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8641);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen({ port: PORT, backlog: 512 }, r));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const want = t => !process.env.ONLY || process.env.ONLY.split(',').some(o => t.includes(o));
const exe = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch(exe && !process.env.PW_BUNDLED ? { executablePath: exe } : {});
const LOOKS = [['tea', 'light'], ['tea', 'dark'], ['coffee', 'light'], ['coffee', 'dark']];
const SIZES = { 12: 'inline', 16: 'control', 24: 'header', 44: 'display' };
const WEIGHTS = { tea: { inline: 1.75, control: 1.75, header: 2.25, display: 3 }, coffee: { inline: 1.5, control: 1.5, header: 2, display: 2.5 } };

// the controls of each registered concept: a selector for the control, the concepts it means (the registry names the icon)
const CONTROLS = [
  ['delete', 'button.del, .dp-fix.del'], ['close', '.crumb > .x, [data-act=help-close], [data-act=find-close]'],
  ['edit', '[data-act=edit]'], ['revert', '[data-act=only-remove]'], ['lock', '[data-act=row-lock], [data-act=lock-toggle], .obsoft'],
  ['add', '.obplus'], ['more', '.smore, [data-act=menu]'], ['pin', '[data-act=keep]'], ['focus', '.star'], ['help', '[data-act=corner]'],
  ['zoomIn', '[data-act=zoom-in]'], ['zoomOut', '[data-act=zoom-out]'],
];
const LOCKS = ['lock', 'unlock'];

async function open({ w = 1280, h = 800, drink = 'tea', theme = 'light' } = {}){
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  await ctx.addInitScript(([d, t]) => { try { (localStorage.setItem('rb-help-seen', '1'), localStorage.setItem('rb-esc-fold', 'off')); localStorage.setItem('rb-drink', d); localStorage.setItem('rb-theme', t); } catch {} }, [drink, theme]);
  const page = await ctx.newPage();
  const bad = []; page.on('pageerror', e => bad.push(String(e)));
  await page.goto(`http://localhost:${PORT}/?memory#resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready') && (window.__wb?.ui?.fills?.length ?? 0) > 0, null, { timeout: 20000 });
  await page.evaluate(() => { window.__wb.edit.setGuard?.(false); window.__wb.hands.gate?.(false); window.__wb.edit.setAutoFold?.(false); });
  await page.waitForTimeout(300);
  return { ctx, page, bad };
}
const settle = page => page.waitForTimeout(300);
const rest = async page => { await page.mouse.move(4, 4); for (let k = 0; k < 3; k++) await page.keyboard.press('Escape'); await page.evaluate(() => window.__wb.setView(null)); await page.click('#ptabs [data-p=editor]').catch(() => {}); await settle(page); };
const click = (page, sel) => page.click(sel, { timeout: 2500 }).catch(() => {});
const SCREENS = {
  outline: async () => {},
  line: async page => { await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page); },
  section: async page => { await click(page, '#body [data-act=select-section][data-id=experience]'); },
  job: async page => { await click(page, '#body [data-act=select-job][data-id=free]'); },
  design: async page => { await click(page, '#tab-design'); },
  export: async page => { await click(page, '#tab-export'); },
  library: async page => { await page.evaluate(() => window.__wb.setView('resumes')); await settle(page); },
  inspector: async page => { await page.evaluate(() => window.__wb.setView('resumes')); await settle(page); await click(page, '#scr .rcard >> nth=1'); },
  settings: async page => { await page.evaluate(() => window.__wb.setView('settings')); },
  career: async page => { await click(page, '#ptabs [data-p=career]'); },
  'career form': async page => { await click(page, '#ptabs [data-p=career]'); await settle(page); await click(page, '[data-act=rec-job] >> nth=0'); await settle(page); await click(page, '[data-act=cl-open]'); },
  'one-off line': async page => {      // a line written on this resume only: its list row has the revert control
    await page.frameLocator('#sheet iframe').locator('.bullets li').first().click(); await settle(page);
    await page.evaluate(() => window.__wb.edit.startEdit()); await settle(page);
    const ed = page.frameLocator('#sheet iframe').locator('[contenteditable]'); await ed.focus(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText('Only on this resume.'); await settle(page);
    await page.keyboard.press('Escape'); await settle(page);
  },
  'name window': async page => { await click(page, '[data-act=switcher]'); },
  'head menu': async page => { await click(page, '[data-act=menu]'); },
  help: async page => { await page.keyboard.press('?'); },
};

// In the page: every rendered icon, with the control it sits in
async function inspect(page, controls){
  return page.evaluate(async controls => {
    const mod = await import('/src/ui/icons.js');
    const by = {};
    for (const k of Object.keys(mod.ICONS ?? {})){ const d = document.createElement('div'); d.innerHTML = mod.icon(k); by[d.firstChild.innerHTML] = k; }
    const cs = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries(['inline', 'control', 'header', 'display'].map(r => [r, parseFloat(cs.getPropertyValue('--ic-sw-' + r))]));
    const icons = [];
    for (const s of document.querySelectorAll('svg.ico, svg.ci')){
      const r = s.getBoundingClientRect();
      if (!r.width || s.closest('[hidden]') || getComputedStyle(s).visibility === 'hidden') continue;
      const g = s.querySelector('path, circle, rect'), gs = g && getComputedStyle(g);
      let concept = '';
      for (const [c, sel] of controls) if (s.closest(sel)) { concept = c; break; }
      const ctrl = s.closest('button, a, [data-act], span');
      icons.push({ d: g?.getAttribute('d') ?? '', w: Math.round(r.width), sw: gs ? parseFloat(gs.strokeWidth) : 0, ve: gs?.vectorEffect ?? '', name: by[s.innerHTML] ?? '?', concept, where: `${ctrl?.tagName.toLowerCase()}.${[...(ctrl?.classList ?? [])].slice(0, 2).join('.')}[${ctrl?.dataset?.act ?? ''}]` });
    }
    const reg = mod.CONCEPT ?? null;
    return { icons, tokens, reg, names: Object.keys(mod.ICONS ?? {}), places: [...document.querySelectorAll('#ptabs .ptab, #rtabs .tab')].map(b => [b.dataset.p ?? b.dataset.m, b.querySelector('svg') && by[b.querySelector('svg').innerHTML]]) };
  }, controls);
}

for (const [drink, theme] of LOOKS){
  if (!want('sizes') && !want('concepts')) break;
  const { ctx, page, bad } = await open({ drink, theme });
  const tag = `${drink} ${theme}`, all = [];
  let tokens = null, reg = null, names = [], places = [];
  for (const [screen, go] of Object.entries(SCREENS)){
    try { await rest(page); await go(page); await page.mouse.move(4, 4); await settle(page); } catch (e){ ok(`${tag}: ${screen} opens`, false, String(e.message ?? e).split('\n')[0].slice(0, 100)); continue; }
    const r = await inspect(page, CONTROLS);
    tokens = r.tokens; reg = r.reg; names = r.names; if (screen === 'outline') places = r.places;
    for (const i of r.icons) all.push({ ...i, screen });
  }
  if (want('sizes')){
    const odd = all.filter(i => !SIZES[i.w]);
    ok(`${tag}: every rendered icon is a role size (12, 16, 24 or 44 px)`, all.length > 40 && !odd.length, `${all.length} icons; ${[...new Set(odd.map(i => `${i.name} ${i.w} ${i.where} @${i.screen}`))].slice(0, 5).join(' | ')}`);
    const want_ = WEIGHTS[drink];
    ok(`${tag}: the stroke tokens are the drink's (${Object.values(want_).join(' / ')} px)`, tokens && Object.entries(want_).every(([k, v]) => tokens[k] === v), JSON.stringify(tokens));
    const off = all.filter(i => SIZES[i.w] && Math.abs(i.sw - want_[SIZES[i.w]]) > 0.01);
    ok(`${tag}: every icon draws its role's stroke token`, all.length > 40 && !off.length, [...new Set(off.map(i => `${i.name} ${i.w}px draws ${i.sw}, wants ${want_[SIZES[i.w]]} ${i.where} @${i.screen}`))].slice(0, 4).join(' | '));
    const scaling = all.filter(i => i.ve !== 'non-scaling-stroke');
    ok(`${tag}: strokes are non-scaling (screen pixels), so a 12 and a 24 px icon read as one family`, all.length > 40 && !scaling.length, [...new Set(scaling.map(i => `${i.name} ${i.w} ${i.where}`))].slice(0, 4).join(' | '));
  }
  if (want('concepts')){
    ok(`${tag}: icons.js has a concept registry (CONCEPT) and each concept has a drawing`, !!reg && Object.keys(reg).length >= 12 && Object.values(reg).every(n => names.includes(n)), reg ? Object.values(reg).filter(n => !names.includes(n)).join(', ') : 'no CONCEPT export');
    const found = {};
    for (const c of CONTROLS.map(x => x[0])){
      const mine = all.filter(i => i.concept === c);
      const wantIcon = reg?.[c];
      const wrong = mine.filter(i => (c === 'lock' ? !LOCKS.includes(i.name) : i.name !== wantIcon));
      found[c] = [...new Set(mine.map(i => i.screen))];
      ok(`${tag}: every ${c} control draws the registered icon (${c === 'lock' ? 'lock or unlock' : wantIcon ?? 'none registered'}) (${mine.length} on ${found[c].length} screens)`, !!reg && (mine.length > 0 || ['edit', 'focus'].includes(c)) && !wrong.length, [...new Set(wrong.map(i => `${i.name} ${i.w}px ${i.where} @${i.screen}`))].slice(0, 4).join(' | ') || (mine.length ? '' : 'none found'));
    }
    ok(`${tag}: delete is on at least four screens and it is the X, never a bin`, (found.delete?.length ?? 0) >= 4 && all.filter(i => i.concept === 'delete').every(i => i.d === 'M4 4l8 8M12 4l-8 8'), `${found.delete?.join(', ')}`);
    // no registered icon serves two concepts (delete and close share the X on purpose: they differ by the control's tier)
    const byIcon = {};
    for (const [c, n] of Object.entries(reg ?? {})) (byIcon[n] ??= []).push(c);
    const dup = Object.entries(byIcon).filter(([, cs]) => cs.length > 1 && !(cs.length === 2 && cs.includes('delete') && cs.includes('close')));
    ok(`${tag}: no registered icon serves two concepts (the registry)`, !!reg && !dup.length, dup.map(([n, cs]) => `${n}: ${cs.join('+')}`).join(' | ') || (reg ? '' : 'no CONCEPT export'));
    const used = {};
    for (const i of all) if (i.concept && SIZES[i.w]) (used[i.name] ??= new Set()).add(i.concept === 'delete' ? 'close' : i.concept === 'lock' ? 'lock' : i.concept);
    const two = Object.entries(used).filter(([, cs]) => cs.size > 1);
    ok(`${tag}: no icon is on the controls of two concepts on screen`, !two.length && all.some(i => i.concept), two.map(([n, cs]) => `${n}: ${[...cs].join('+')}`).join(' | '));
    const tea = drink === 'tea', P = Object.fromEntries(places);
    ok(`${tag}: the places and modes draw this drink's own tabs (Library list; Editor and Edit ${tea ? 'steep' : 'edit'}; Career ${tea ? 'recordbook' : 'timeline'}; Design ${tea ? 'latte' : 'design'}; Export ${tea ? 'cupout' : 'export'})`,
      P.library === 'list' && P.editor === (tea ? 'steep' : 'edit') && P.career === (tea ? 'recordbook' : 'timeline') && P.edit === (tea ? 'steep' : 'edit') && P.design === (tea ? 'latte' : 'design') && P.export === (tea ? 'cupout' : 'export'), JSON.stringify(P));
    ok(`${tag}: no page errors`, !bad.length, bad.slice(0, 2).join(' | '));
  }
  await ctx.close();
}

if (want('concepts')){
  // the controls that need a long walk to reach (the pencil on a phone, the star of a focused tag) are read from the code: no glyph stands for an action
  const src = fs.readFileSync(path.join(ROOT, 'src/ui/parts.js'), 'utf8');
  ok('the pencil, the revert control and the focus star are icons of the registry, not glyphs', /data-act="edit"[^`]*\$\{icon\('edit'\)\}/.test(src) && /data-act="only-remove"[^`]*\$\{icon\('revert'\)\}/.test(src) && /class="star"[^`]*\$\{icon\('focus'/.test(src) && !/>[↺★]</.test(src));
  const { ctx, page } = await open({ w: 390, h: 800 });
  await rest(page);
  const r = await inspect(page, CONTROLS);
  const odd = r.icons.filter(i => !SIZES[i.w]);
  const off = r.icons.filter(i => SIZES[i.w] && Math.abs(i.sw - WEIGHTS.tea[SIZES[i.w]]) > 0.01);
  ok('a phone: every rendered icon is a role size drawing the stroke token', r.icons.length >= 3 && !odd.length && !off.length, `${r.icons.length} icons; ` + [...odd, ...off].map(i => `${i.name} ${i.w}px ${i.sw} ${i.where}`).slice(0, 4).join(' | '));
  await ctx.close();
}

if (want('outline')){
  for (const [drink, theme] of [['tea', 'light'], ['coffee', 'dark']]){
    const { ctx, page } = await open({ drink, theme });
    const rows = await page.evaluate(async () => {
      const mod = await import('/src/ui/icons.js'); const by = {};
      for (const k of Object.keys(mod.ICONS ?? {})){ const d = document.createElement('div'); d.innerHTML = mod.icon(k); by[d.firstChild.innerHTML] = k; }
      return [...document.querySelectorAll('.outline .osec')].map(o => ({ sid: o.dataset.sid, icon: by[o.querySelector(':scope > .srow .si svg')?.innerHTML] ?? '?', hk: o.style.getPropertyValue('--hk') }));
    });
    const dupIcons = Object.entries(rows.reduce((m, r) => ((m[r.icon] ??= []).push(r.sid), m), {})).filter(([, s]) => s.length > 1);
    ok(`${drink} ${theme}: each Outline section has an icon of its own (Name and contact is not Summary)`, rows.length >= 8 && !dupIcons.length, dupIcons.map(([n, s]) => `${n}: ${s.join('+')}`).join(' | '));
    const hue = sid => rows.find(r => r.sid === sid)?.hk;
    ok(`${drink} ${theme}: at most six hues, and Skills and Patent do not share one`, new Set(rows.map(r => r.hk)).size <= 6 && hue('skills') && hue('skills') !== hue('patent'), `skills ${hue('skills')} patent ${hue('patent')}`);
    await ctx.close();
  }
}

await browser.close(); server.close();
console.log(failed ? `\n${failed} icon check(s) FAILED` : '\nall icon checks passed');
process.exit(failed ? 1 : 0);
