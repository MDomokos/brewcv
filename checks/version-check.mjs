#!/usr/bin/env node
// node checks/version-check.mjs [root]
// One version number: package.json's. The service worker's cache and the changelog's newest
// release must agree with it. The deploy runs this on _site, where the cache name also carries
// the commit (0.8.0+1a2b3c4).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

const version = JSON.parse(read('package.json')).version;
ok('package.json has a version, MAJOR.MINOR.PATCH', SEMVER.test(version ?? ''), String(version));

const sw = read('sw.js').match(/const VERSION = '([^']+)'/)?.[1];
ok(`the service worker's cache is ${version}, plus the commit when deployed`,
  sw === version || new RegExp(`^${version.replaceAll('.', '\\.')}\\+[0-9a-f]{7,40}$`).test(sw ?? ''), String(sw));

const heads = [...read('CHANGELOG.md').matchAll(/^## (.+)$/gm)].map(m => m[1].trim());
const bad = heads.filter(h => h !== 'Unreleased' && !/^\d+\.\d+\.\d+ - \d{4}-\d{2}-\d{2}$/.test(h));
ok('every changelog heading is "Unreleased" or "X.Y.Z - YYYY-MM-DD"', bad.length === 0, bad.join('; '));
ok('Unreleased, if there, is the first', !heads.slice(1).includes('Unreleased'));
const released = heads.filter(h => h !== 'Unreleased').map(h => h.split(' - ')[0]);
ok(`the newest release in the changelog is ${version}`, released[0] === version, String(released[0]));
ok('releases are newest first, each once', released.every((v, i) => i === 0 || cmp(released[i - 1], v) > 0), released.join(', '));
const dates = heads.filter(h => h !== 'Unreleased').map(h => h.split(' - ')[1]);
ok('and their dates never go forward', dates.every((d, i) => i === 0 || dates[i - 1] >= d));

console.log(failed ? `\n${failed} version check(s) FAILED` : '\nall version checks passed');
process.exit(failed ? 1 : 0);
