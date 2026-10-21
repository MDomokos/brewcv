#!/usr/bin/env node
// node checks/themes-check.mjs
// The registry of built-in looks (src/themes.js) and everything that has to agree with it: the stylesheets, the tokens files, the
// two strings in each of the ten catalogues, and the service worker's cache list. A look nobody registered, or one half
// registered, fails here, not as a missing picker entry or an offline page that has lost its colours. Then scripts/new-theme.mjs
// runs on a copy of the files and must leave all of it agreeing, and the check must notice each thing taken away.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scaffold, LANGS } from '../scripts/new-theme.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);
let stamp = 0;
const load = async f => (await import(`${pathToFileURL(f).href}?${++stamp}`)).default ?? {};
const ID = /^[a-z][a-z0-9-]*$/;
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

// What is wrong with the looks under `root`, as sentences. Empty when every place agrees.
export async function problems(root = REPO){
  const at = (...p) => path.join(root, ...p), out = [];
  const { THEMES } = await import(`${pathToFileURL(at('src/themes.js')).href}?${++stamp}`);
  const ids = THEMES.map(x => x.id), files = THEMES.map(x => x.file);
  const layers = [...new Set(THEMES.flatMap(x => x.layers))];
  const sw = fs.readFileSync(at('sw.js'), 'utf8');
  const en = await load(at('src/i18n/en.js'));

  for (const x of THEMES){
    if (!ID.test(x.id) || !ID.test(x.file)) out.push(`${x.id}: the id and the file are lower-case words with hyphens`);
    if (ids.indexOf(x.id) !== ids.lastIndexOf(x.id) || files.indexOf(x.file) !== files.lastIndexOf(x.file)) out.push(`${x.id}: the id or the file is listed twice`);
    if (!x.layers?.length || x.layers.at(-1) !== x.file && x.layers.length > 1) out.push(`${x.id}: layers are the base stylesheet, then overlays ending in the look's own`);
    if (![x.name, x.note, x.tokenName].every(s => typeof s === 'string' && s.trim())) out.push(`${x.id}: name, note and tokenName are words`);
    for (const l of x.layers) if (!fs.existsSync(at('themes', `${l}.css`))) out.push(`${x.id}: themes/${l}.css does not exist`);
    if (!fs.existsSync(at('themes', `${x.file}.tokens.json`))) out.push(`${x.id}: themes/${x.file}.tokens.json does not exist (node scripts/tokens.mjs)`);
    for (const f of [...x.layers.map(l => `themes/${l}.css`), `themes/${x.file}.tokens.json`])
      if (!sw.includes(`'./${f}'`)) out.push(`${x.id}: sw.js does not cache ${f}, so the look is gone offline`);
    if (en[`design.tpl.${x.id}`] !== x.name) out.push(`${x.id}: en.js design.tpl.${x.id} is not the registry's name`);
    if (en[`design.tplNote.${x.id}`] !== x.note) out.push(`${x.id}: en.js design.tplNote.${x.id} is not the registry's note`);
  }
  for (const l of LANGS){
    const c = await load(at('src/i18n', `${l}.js`));
    for (const x of THEMES) for (const k of [`design.tpl.${x.id}`, `design.tplNote.${x.id}`])
      if (typeof c[k] !== 'string' || !c[k]) out.push(`${l}.js has no ${k}`);
    for (const k of Object.keys(c)) {
      const m = /^design\.tpl(?:Note)?\.(.+)$/.exec(k);
      if (m && !ids.includes(m[1])) out.push(`${l}.js ${k} names no registered look`);
    }
  }
  for (const f of fs.readdirSync(at('themes'))){
    const css = /^(.+)\.css$/.exec(f)?.[1], tok = /^(.+)\.tokens\.json$/.exec(f)?.[1];
    if (css && !layers.includes(css)) out.push(`themes/${f} is in no look: register it in src/themes.js (node scripts/new-theme.mjs)`);
    if (tok && !files.includes(tok)) out.push(`themes/${f} belongs to no look`);
  }
  // nothing else lists a look: that is how it was once spread over five places
  const own = [at('scripts/tokens.mjs'), ...walk(at('src')).filter(f => f.endsWith('.js') && !f.includes(`${path.sep}i18n${path.sep}`) && !f.endsWith('themes.js'))];
  for (const f of own){
    const src = fs.readFileSync(f, 'utf8');
    for (const l of layers.filter(l => l !== 'b2-marker')) if (src.includes(`'${l}'`)) out.push(`${path.relative(root, f)} names ${l}: a look belongs in src/themes.js only`);
  }
  return out;
}

section('the registry and what has to agree with it');
{
  const p = await problems();
  ok('every look has its stylesheets, tokens file, ten pairs of strings and cache entries, and nothing else is listed', !p.length, p.join('; '));
  const { THEMES } = await import('../src/themes.js');
  ok('the four built-in looks are registered, B2 Marker first', THEMES.map(x => x.id).join() === 'b2,tint,aa,mono');
}

section('scripts/new-theme.mjs on a copy');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brewcv-theme-'));
  try {
    for (const f of ['src', 'themes', 'scripts/tokens.mjs', 'sw.js', 'package.json']){
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      fs.cpSync(path.join(REPO, f), path.join(tmp, f), { recursive: true });
    }
    ok('the copy agrees before anything is added', !(await problems(tmp)).length);
    const entry = await scaffold(tmp, { id: 'harbour', name: 'Harbour\'s "blue"', note: 'Navy ink; sea-green tabs.' });
    const p = await problems(tmp);
    ok('a new look is registered in every place with one command', !p.length, p.join('; '));
    ok('its tokens file is valid JSON and carries its name', JSON.stringify(JSON.parse(fs.readFileSync(path.join(tmp, 'themes/harbour.tokens.json'), 'utf8'))).includes(entry.tokenName.replace(/"/g, '\\"')));
    ok('the real files are untouched', !fs.existsSync(path.join(REPO, 'themes/harbour.css')) && !fs.readFileSync(path.join(REPO, 'src/themes.js'), 'utf8').includes('harbour'));
    let again = false; try { await scaffold(tmp, { id: 'harbour', name: 'x', note: 'y' }); } catch { again = true; }
    ok('the same id twice is refused', again);
    let bad = false; try { await scaffold(tmp, { id: 'Bad Id', name: 'x', note: 'y' }); } catch { bad = true; }
    ok('an id that is not a plain word is refused', bad);

    const without = async (f, edit, what) => {
      const was = fs.readFileSync(path.join(tmp, f), 'utf8');
      fs.writeFileSync(path.join(tmp, f), edit(was));
      const q = await problems(tmp);
      fs.writeFileSync(path.join(tmp, f), was);
      ok(`${what} is noticed`, q.length > 0 && q.some(s => /harbour/.test(s)), q.join('; '));
    };
    await without('sw.js', s => s.replace("  './themes/harbour.css',\n", ''), 'a look missing from the service worker');
    await without('src/i18n/hu.js', s => s.replace(/.*'design\.tplNote\.harbour'.*\n/, ''), 'a missing string in one catalogue');
    await without('src/i18n/en.js', s => s.replace('Navy ink; sea-green tabs.', 'Navy ink.'), 'an English string that drifted from the registry');
    await without('src/themes.js', s => s.replace(/.*id: 'harbour'.*\n/, ''), 'a stylesheet no look uses');
    fs.rmSync(path.join(tmp, 'themes/harbour.tokens.json'));
    const q = await problems(tmp);
    ok('a missing tokens file is noticed', q.some(s => /harbour.*tokens\.json/.test(s)), q.join('; '));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

console.log(failed ? `\n${failed} themes check(s) FAILED` : '\nall themes checks passed');
process.exit(failed ? 1 : 0);
