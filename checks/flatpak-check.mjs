#!/usr/bin/env node
// node checks/flatpak-check.mjs
// The Linux Flatpak (flatpak/) is files nobody can build on the author's machine, so this reads them as text: one app id
// everywhere, one version, every installed file present, the sandbox without network or broad file access, the offline
// crate list in step with Cargo.lock, and a workflow that cannot run on a push to main.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const noComments = s => s.replace(/^\s*#.*$/gm, '').replace(/\s#.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');

const files = fs.readdirSync(path.join(ROOT, 'flatpak'));
const manifestName = files.find(f => /^[\w.-]+\.yml$/.test(f));
const manifest = noComments(read(`flatpak/${manifestName}`));
const ID = manifest.match(/^app-id:\s*(\S+)/m)?.[1] ?? '';
ok('the manifest has a reverse-DNS app id', /^[A-Za-z][\w-]*(\.[A-Za-z][\w-]*){2,}$/.test(ID), ID);
ok('the manifest is named after the app id', manifestName === `${ID}.yml`, manifestName);

const meta = noComments(read(`flatpak/${ID}.metainfo.xml`));
const desktop = read(`flatpak/${ID}.desktop`);
const linux = JSON.parse(read('src-tauri/tauri.linux.conf.json'));
ok('metainfo <id> is the app id', meta.match(/<id>([^<]+)<\/id>/)?.[1] === ID);
ok('metainfo launches the desktop file of that name', meta.match(/<launchable[^>]*>([^<]+)</)?.[1] === `${ID}.desktop`);
ok('the desktop file\'s Icon= is the app id', desktop.match(/^Icon=(.+)$/m)?.[1] === ID);
ok('the Linux Tauri config sets the identifier to the app id, and only that', linux.identifier === ID && Object.keys(linux).filter(k => k !== '$schema').join() === 'identifier', JSON.stringify(linux));
const icons = [...manifest.matchAll(/\/app\/share\/icons\/\S+\/([^/\s]+)\.(?:svg|png)\b/g)].map(m => m[1]);
ok('every installed icon is named after the app id', icons.length >= 1 && icons.every(i => i === ID), icons.join(', '));
ok('the manifest installs the desktop file and metainfo under the app id', manifest.includes(`/app/share/applications/${ID}.desktop`) && manifest.includes(`/app/share/metainfo/${ID}.metainfo.xml`));

const version = JSON.parse(read('package.json')).version;
const tauriVersion = JSON.parse(read('src-tauri/tauri.conf.json')).version;
const cargoVersion = read('src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
const latest = [...meta.matchAll(/<release\s[^>]*version="([^"]+)"/g)].map(m => m[1]).sort(cmp).pop();
ok('package.json, tauri.conf.json, Cargo.toml and the metainfo\'s newest release agree', tauriVersion === version && cargoVersion === version && latest === version,
  `package ${version}, tauri ${tauriVersion}, cargo ${cargoVersion}, metainfo ${latest}`);
ok('the metainfo has a license, a content rating and the project URLs',
  /<project_license>AGPL-3\.0-or-later</.test(meta) && /<content_rating /.test(meta) && meta.includes('https://github.com/MDomokos/brewcv') && meta.includes('https://MDomokos.github.io/brewcv/'));

// every repo file a build command names must exist (build output, and the destination side of install, excluded)
const cmds = manifest.split('\n').filter(l => /^\s*- (install|node|cargo) /.test(l));
const named = [...new Set(cmds.flatMap(l => [...l.matchAll(/(?<![\w/.-])((?:flatpak|src-tauri|icons|scripts)\/[\w@./-]+)/g)].map(m => m[1])))].filter(f => !f.includes('/target/'));
const gone = named.filter(f => !fs.existsSync(path.join(ROOT, f)));
ok('every file the manifest installs or runs exists', named.length >= 6 && !gone.length, gone.join(', '));
const srcFiles = [...manifest.matchAll(/^\s*- ([\w.-]+\.json)\s*$/gm)].map(m => m[1]);
ok('every source file the manifest lists is in flatpak/', srcFiles.length >= 1 && srcFiles.every(f => files.includes(f)), srcFiles.join(', '));

const args = (manifest.match(/^finish-args:\n((?:\s+- .*\n?)+)/m)?.[1] ?? '').split('\n').map(l => l.replace(/^\s*- /, '').trim()).filter(Boolean);
ok('finish-args are there', args.length >= 3, args.join(' '));
ok('no network', !args.some(a => /^--share=network$/.test(a)), args.join(' '));
ok('no broad file access (host, host-os, host-etc, home) and no bus or device wildcards',
  !args.some(a => /^--filesystem=(host|host-os|host-etc|home)(:|$)/.test(a) || /^--socket=(session-bus|system-bus)$/.test(a) || a === '--device=all'), args.join(' '));
ok('the build is offline, embeds the staged frontend, and never calls npx, npm or the Tauri CLI',
  /cargo --offline build --release/.test(manifest) && manifest.includes('--features tauri/custom-protocol') && manifest.includes('node scripts/desktop-stage.mjs') && !/\b(npx|npm|yarn|cargo tauri|tauri build)\b/.test(cmds.join('\n')));

// cargo-sources.json must hold every registry crate of Cargo.lock (same checksum): else Cargo.lock changed since it was made
const sources = read('flatpak/cargo-sources.json');
const lock = read('src-tauri/Cargo.lock').split('[[package]]').slice(1);
const sums = lock.map(p => p.match(/^checksum = "([0-9a-f]{64})"/m)?.[1]).filter(Boolean);
const lost = sums.filter(s => !sources.includes(s));
ok('cargo-sources.json lists every crate in Cargo.lock (else run scripts/flatpak-sources.sh)', sums.length > 100 && !lost.length, `${lost.length} missing`);
ok('Cargo.lock has no git dependencies (the generator would need their sources)', !/source = "git\+/.test(read('src-tauri/Cargo.lock')));

const wf = noComments(read('.github/workflows/flatpak.yml'));
const on = wf.match(/^on:\n((?:[ \t]+.*\n|\n)*)/m)?.[1] ?? '';
ok('the workflow runs only by hand or on a v* tag', /workflow_dispatch:/.test(on) && /tags:\s*\[\s*['"]?v\*['"]?\s*\]/.test(on) && !/branches|pull_request|schedule|paths/.test(on), on.trim());
ok('the workflow has read-only contents and deploys nothing', /^permissions:\n\s+contents: read\s*$/m.test(wf) && !/pages: write|id-token|deploy|publish|gh-release|upload-pages/i.test(wf));
ok('the workflow pins its actions to a full version tag', [...wf.matchAll(/uses:\s*(\S+)/g)].every(m => /@v\d+\.\d+(\.\d+)?$/.test(m[1])), [...wf.matchAll(/uses:\s*(\S+)/g)].map(m => m[1]).join(', '));
ok('the workflow builds the manifest', wf.includes(`manifest-path: flatpak/${ID}.yml`));
const pages = read('.github/workflows/pages.yml');
ok('pages.yml is still the only workflow that deploys the site (it does not build or run the Flatpak)', !/flatpak-github-actions|flatpak-builder|flatpak\.yml/i.test(pages));
// the deploy copies the whole repo and refuses private-looking files and images outside icons/ (src-tauri/icons, and a file name
// like the retina icon's, which reads as an email address): the desktop and Flatpak folders must stay out of the site, or pushing main fails the deploy
ok('pages.yml leaves src-tauri, desktop and flatpak out of the site', ['src-tauri', 'desktop', 'flatpak'].every(d => new RegExp(`--exclude '${d}'`).test(pages)));
const runtime = read(`flatpak/${ID}.yml`).match(/^runtime-version:\s*'?([\w.]+)'?/m)?.[1];
const image = wf.match(/flatpak-github-actions:([\w.-]+)/)?.[1];
ok('the CI image is the one for the manifest\'s runtime', !!runtime && image === `gnome-${runtime}`, `runtime ${runtime}, image ${image}`);
ok('the build runs the deploy\'s privacy gate on the staged copy', /node checks\/preflight-deploy\.mjs _desktop --app/.test(read(`flatpak/${ID}.yml`)));
process.exit(failed ? 1 : 0);
