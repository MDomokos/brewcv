#!/usr/bin/env node
// node scripts/tokens.mjs [--check]
// Writes each built-in theme (overlays layered on b2-marker.css) as
// themes/<name>.tokens.json in DTCG 2025.10. --check writes nothing and exits 1 if stale.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokensFromCss, serialize } from '../src/model/tokens.js';
import { THEMES } from '../src/themes.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const css = (n, root) => fs.readFileSync(path.join(root, 'themes', `${n}.css`), 'utf8');
export const BUILT_INS = THEMES.map(x => ({ id: x.file, name: x.tokenName, layers: x.layers, ...(x.extra ? { extra: x.extra } : {}) }));

export function builtInTokens(t, root = REPO){
  let vars = {};
  for (const l of t.layers) vars = tokensFromCss(css(l, root), vars).vars;
  const { tokens } = tokensFromCss('', vars);
  return { ...tokens, ...(t.extra ?? {}) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)){
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const t of BUILT_INS){
    const file = path.join(REPO, 'themes', `${t.id}.tokens.json`);
    const text = JSON.stringify(serialize(t.name, builtInTokens(t)), null, 2) + '\n';
    const was = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (check){ if (was !== text){ console.log(`stale: themes/${t.id}.tokens.json`); stale++; } continue; }
    if (was !== text) fs.writeFileSync(file, text);
    console.log(`themes/${t.id}.tokens.json: ${Object.keys(builtInTokens(t)).length} tokens`);
  }
  if (check){ console.log(stale ? `${stale} token file(s) out of date: run node scripts/tokens.mjs` : 'token files up to date'); process.exit(stale ? 1 : 0); }
}
