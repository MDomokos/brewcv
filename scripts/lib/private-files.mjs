// Where the owner's private check files live: outside the working tree, so no copy of the tree (a deploy, a
// Flatpak source dir, a zip, an agent that reads the repo) can carry them.
//   identity.local.json   { "email": "...", "phone": "...", "city": "..." }
//   deny.local.json       { "deny": ["a retired address"], "commitEmails": ["the address commits may use"] }
// Looked up in this order: $BREWCV_PRIVATE_DIR, then the platform default
//   $XDG_CONFIG_HOME/brewcv or ~/.config/brewcv (Linux), ~/Library/Application Support/BrewCV (macOS), %APPDATA%\BrewCV (Windows),
// then the old in-tree path, which still works but prints a deprecation warning.
// No file anywhere (CI, a new contributor) is fine: the gate then checks shapes only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

// the old in-tree locations, relative to a root
export const LEGACY = { 'identity.local.json': 'data/identity.local.json', 'deny.local.json': 'checks/deny.local.json' };

export function privateDirs(env = process.env, platform = process.platform, home = os.homedir()){
  const dirs = [];
  if (env.BREWCV_PRIVATE_DIR) dirs.push(path.resolve(env.BREWCV_PRIVATE_DIR));
  if (platform === 'win32') dirs.push(path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'BrewCV'));
  else if (platform === 'darwin') dirs.push(path.join(home, 'Library', 'Application Support', 'BrewCV'));
  else dirs.push(path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'brewcv'));
  return dirs;
}

// -> { path, legacy } or null. `roots` are the trees to try the old in-tree path in.
export function findPrivate(name, { roots = [REPO], env, platform, home, warn = m => console.warn(m) } = {}){
  const dirs = privateDirs(env, platform, home);
  for (const d of dirs){
    const p = path.join(d, name);
    if (fs.existsSync(p)) return { path: p, legacy: false };
  }
  for (const r of roots){
    const p = path.join(r, LEGACY[name]);
    if (!fs.existsSync(p)) continue;
    warn(`\nWARNING: ${LEGACY[name]} is inside the working tree. Anything that copies the tree can carry it out (it once reached an app binary).`
      + `\n  Move it:  mkdir -p "${dirs.at(-1)}" && mv "${p}" "${path.join(dirs.at(-1), name)}"`
      + `\n  (or point BREWCV_PRIVATE_DIR at another folder). The in-tree path is deprecated and will stop being read.\n`);
    return { path: p, legacy: true };
  }
  return null;
}
