#!/usr/bin/env node
// node scripts/artifact-scan.mjs <file.zip|file> ...   (run it on every file you are about to publish)
// A binary built on your own machine carries that machine's paths: the Rust compiler embeds source locations, so a macOS build made
// on a laptop holds /Users/<your name>/.cargo/... hundreds of times. This finds what ties a file to a person or a device: home-folder
// paths other than a CI runner's, your user name, your host name, the owner's private values (the same private folder the privacy gate
// reads: scripts/lib/private-files.mjs), and private-key markers or key files. A zip is read entry by entry. Exit 1 on any finding.
// Publish what CI built (generic runner paths), not a local build, unless this says clean. It cannot read inside a Flatpak bundle (compressed).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findPrivate } from './lib/private-files.mjs';

const user = os.userInfo().username, host = os.hostname().split('.')[0];
const values = [];
for (const name of ['identity.local.json', 'deny.local.json']){
  const f = findPrivate(name, { warn: () => {} });
  if (!f) continue;
  // 6 or more characters: a shorter token turns up by chance in any compiled program and means nothing there
  const walk = x => { if (typeof x === 'string' && x.trim().length >= 6) values.push(x.trim()); else if (x && typeof x === 'object') Object.values(x).forEach(walk); };
  try { walk(JSON.parse(fs.readFileSync(f.path, 'utf8'))); } catch { /* not valid JSON: ignored here, the gate reports it */ }
}
const HOME = /(\/Users\/|\/home\/|C:\\Users\\)([A-Za-z0-9._-]+)/g;
const GENERIC = new Set(['runner', 'builder', 'build', 'user', 'vagrant', 'x', '<name>']);   // a CI runner's or a placeholder's name
const KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const KEYFILE = /\.(pem|p12|pfx|key|asc|gpg|keystore|jks)$/i;

let bad = 0;
const say = (file, kind, n) => { console.error(`  ${file}: ${kind}${n > 1 ? ` (${n} times)` : ''}`); bad++; };
function scan(label, buf){
  const text = buf.toString('latin1');
  const homes = new Map();
  // a generic name is harmless in a path, unless it is this machine's own user: /Users/user/ on a laptop whose user is "user" is that person's path
  for (const m of text.matchAll(HOME)) if (!GENERIC.has(m[2]) || m[2] === user) homes.set(m[2], (homes.get(m[2]) ?? 0) + 1);
  for (const [who, n] of homes) say(label, `a home-folder path of a user (${who === user ? 'this machine\'s user' : `"${who.slice(0, 1)}…"`})`, n);
  const count = s => s && (text.split(s).length - 1);
  // as plain text only when the name is distinctive: a short common word ("user") is all over any program, and its paths are caught above
  if (user.length >= 6 && count(user) && !homes.has(user)) say(label, 'this machine\'s user name', count(user));
  if (host.length > 3 && count(host)) say(label, 'this machine\'s host name', count(host));
  for (const v of values) if (count(v)) say(label, 'one of the owner\'s private values (not shown)', count(v));
  if (KEY.test(text)) say(label, 'a private-key marker');
  if (KEYFILE.test(label)) say(label, 'a key or certificate file');
}
for (const file of process.argv.slice(2)){
  if (/\.zip$/i.test(file)){
    const names = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean);
    for (const n of names.filter(n => !n.endsWith('/'))) scan(`${path.basename(file)}!${n}`, execFileSync('unzip', ['-p', file, n], { maxBuffer: 1 << 30 }));
  } else scan(path.basename(file), fs.readFileSync(file));
}
if (bad){ console.error(`artifact-scan: ${bad} finding(s): do not publish these files`); process.exit(1); }
console.log(`artifact-scan: clean (${process.argv.length - 2} file(s))`);
