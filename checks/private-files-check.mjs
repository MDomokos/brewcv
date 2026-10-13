#!/usr/bin/env node
// node checks/private-files-check.mjs
// The owner's private check files (identity.local.json, deny.local.json) live outside the repo. This runs the gate against a
// temp tree with a FAKE file planted in the new location, in the old in-tree location, and with none, and checks where
// scripts/lib/private-files.mjs looks on each platform. HOME, XDG_CONFIG_HOME and APPDATA point into the temp dir, so
// the real files on this machine are never read for the planted cases.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { privateDirs, findPrivate, REPO, LEGACY } from '../scripts/lib/private-files.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const FAKE = 'jane.doe@example.invalid';   // a safe-looking shape: only the deny list can catch it

let bad = 0;
const expect = (label, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) bad++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'private-files-'));
const env = extra => ({ ...process.env, HOME: tmp, USERPROFILE: tmp, XDG_CONFIG_HOME: path.join(tmp, 'xdg'), APPDATA: path.join(tmp, 'appdata'), BREWCV_PRIVATE_DIR: '', ...extra });

// ---- where it looks
const d = (e, p) => privateDirs(e, p, '/h');
expect('BREWCV_PRIVATE_DIR comes first', d({ BREWCV_PRIVATE_DIR: '/p' }, 'linux')[0] === path.resolve('/p') && d({ BREWCV_PRIVATE_DIR: '/p' }, 'linux').length === 2);
expect('Linux: XDG_CONFIG_HOME/brewcv', d({ XDG_CONFIG_HOME: '/x' }, 'linux')[0] === path.join('/x', 'brewcv'));
expect('Linux: ~/.config/brewcv without XDG', d({}, 'linux')[0] === path.join('/h', '.config', 'brewcv'));
expect('macOS: ~/Library/Application Support/BrewCV', d({}, 'darwin')[0] === path.join('/h', 'Library', 'Application Support', 'BrewCV'));
expect('Windows: %APPDATA%/BrewCV', d({ APPDATA: 'C:\\A' }, 'win32')[0] === path.join('C:\\A', 'BrewCV'));

const warned = [];
const out = path.join(tmp, 'out'), root = path.join(tmp, 'root');
fs.mkdirSync(out); fs.mkdirSync(path.join(root, 'checks'), { recursive: true });
fs.writeFileSync(path.join(root, LEGACY['deny.local.json']), '{}');
const f = e => findPrivate('deny.local.json', { roots: [root], env: e, platform: 'linux', home: '/h', warn: m => warned.push(m) });
expect('old in-tree path is found, with a warning', f({})?.legacy === true && /inside the working tree/.test(warned[0] ?? ''));
fs.writeFileSync(path.join(out, 'deny.local.json'), '{}');
warned.length = 0;
expect('the new location wins and does not warn', f({ BREWCV_PRIVATE_DIR: out })?.legacy === false && !warned.length);
expect('nothing anywhere is null', findPrivate('identity.local.json', { roots: [root], env: {}, platform: 'linux', home: '/h' }) === null);

// ---- the gate against a temp tree that mentions the fake address
const tree = (...extra) => {
  const dir = fs.mkdtempSync(path.join(tmp, 'tree-'));
  fs.mkdirSync(path.join(dir, 'icons'));
  fs.writeFileSync(path.join(dir, 'notes.md'), `reach me at ${FAKE}\n`);
  for (const [p, body] of extra){ fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), body); }
  return dir;
};
const gate = (dir, e) => { const r = spawnSync('node', [path.join(here, 'preflight-deploy.mjs'), dir], { encoding: 'utf8', env: env(e) }); return { code: r.status, text: r.stdout + r.stderr }; };

fs.mkdirSync(path.join(tmp, 'priv'));
fs.writeFileSync(path.join(tmp, 'priv', 'identity.local.json'), JSON.stringify({ email: FAKE, countryCode: 'ZZ' }));
let r = gate(tree(), { BREWCV_PRIVATE_DIR: path.join(tmp, 'priv') });
expect('new location: the planted address is refused', r.code === 1 && /denied value/.test(r.text) && !/WARNING/.test(r.text));
expect('the finding does not print the value', !r.text.includes(FAKE));

fs.mkdirSync(path.join(tmp, 'xdg', 'brewcv'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'xdg', 'brewcv', 'deny.local.json'), JSON.stringify({ deny: [FAKE] }));
if (process.platform !== 'darwin' && process.platform !== 'win32'){
  r = gate(tree(), {});
  expect('platform default (XDG) is read', r.code === 1 && /denied value/.test(r.text));
}

r = gate(tree(['data/identity.local.json', JSON.stringify({ email: FAKE })]), {});
expect('old location: still refused, with a loud warning', r.code === 1 && /denied value/.test(r.text) && /WARNING.*inside the working tree/s.test(r.text));

const repoHasLegacy = Object.values(LEGACY).some(p => fs.existsSync(path.join(REPO, p)));
r = gate(tree(), { XDG_CONFIG_HOME: path.join(tmp, 'nowhere') });
if (repoHasLegacy) console.log('skip no-file case: this checkout holds a private file in the old in-tree place');
else expect('no file at all: shapes only, says so, does not match the address', /checking shapes only/.test(r.text) && !/denied value/.test(r.text));

// ---- history-scan reads the new location
const repo = fs.mkdtempSync(path.join(tmp, 'repo-'));
const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8', env: { ...env(), GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@example.org', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@example.org' } });
git('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'f.txt'), '1'); git('add', 'f.txt'); git('commit', '-q', '-m', `mentions ${FAKE}`);
const scan = e => spawnSync('node', [path.join(here, 'history-scan.mjs')], { cwd: repo, encoding: 'utf8', env: env(e) });
expect('history-scan: a denied value in a message fails, deny file in the new location', scan({ BREWCV_PRIVATE_DIR: path.join(tmp, 'xdg', 'brewcv') }).status === 1);
expect('history-scan: without the deny file it passes and says so', scan({ BREWCV_PRIVATE_DIR: path.join(tmp, 'nowhere'), XDG_CONFIG_HOME: path.join(tmp, 'nowhere') }).stdout.includes('no deny file found') || repoHasLegacy);

// ---- identity.mjs
const ident = e => spawnSync('node', ['--input-type=module', '-e', `import { IDENTITY, hasIdentity } from ${JSON.stringify(path.join(REPO, 'scripts/lib/identity.mjs'))}; console.log(hasIdentity, IDENTITY.email)`], { encoding: 'utf8', env: env(e) });
expect('identity.mjs reads the new location', ident({ BREWCV_PRIVATE_DIR: path.join(tmp, 'priv') }).stdout.trim() === `true ${FAKE}`);

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
