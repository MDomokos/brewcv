#!/usr/bin/env node
// node checks/preflight-check.mjs
// preflight-deploy has to refuse an image that carries embedded provenance metadata and a prototypes/ folder,
// and has to accept the same tree without them. Images are built here from bytes, since *.png is gitignored.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
const script = path.join(here, 'preflight-deploy.mjs');

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => {
  const t = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); t.copy(out, 4); out.writeUInt32BE(crc(t), 8 + data.length);
  return out;
};
const png = (...extra) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra,
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
};

function run(name, setup){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
  fs.mkdirSync(path.join(dir, 'icons'));
  setup(dir);
  const r = spawnSync('node', [script, dir], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return r.stdout + r.stderr;
}

let bad = 0;
const expect = (label, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) bad++; };
const META = 'provenance metadata';

expect('a clean PNG is accepted', !run('clean', d => fs.writeFileSync(path.join(d, 'icons/icon-192.png'), png())).includes(META));
expect('a PNG with a caBX chunk is refused', run('cabx', d => fs.writeFileSync(path.join(d, 'icons/icon-192.png'), png(chunk('caBX', Buffer.from('jumb'))))).includes(META));
expect('a PNG with an XMP packet is refused', run('xmp', d => fs.writeFileSync(path.join(d, 'icons/icon-192.png'), png(chunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta></x:xmpmeta>'))))).includes(META));
expect('a clean SVG is accepted', !run('svg', d => fs.writeFileSync(path.join(d, 'icons/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')).includes(META));
expect('an SVG with a c2pa manifest is refused', run('svg2', d => fs.writeFileSync(path.join(d, 'icons/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><metadata>c2pa.manifest</metadata></svg>')).includes(META));
expect('a prototypes/ folder is refused', run('proto', d => { fs.mkdirSync(path.join(d, 'prototypes')); fs.writeFileSync(path.join(d, 'prototypes/a.html'), '<p>x</p>'); }).includes('prototypes live outside the repo'));

const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP')]);
const SHIPS = 'the only images that ship';
expect('a README picture in docs/intro is accepted', !run('webp', d => { fs.mkdirSync(path.join(d, 'docs/intro'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/intro/a.webp'), webp); }).includes(SHIPS));
expect('a picture anywhere else is refused', run('webp2', d => { fs.mkdirSync(path.join(d, 'docs'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/a.webp'), webp); }).includes(SHIPS));
expect('a font unicode-range is not a phone number', !run('range', d => fs.writeFileSync(path.join(d, 'a.css'), '@font-face { unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC; }')).includes('phone number'));
expect('a phone number still is', run('phone', d => fs.writeFileSync(path.join(d, 'a.md'), 'Call +44' + ' 7700 900123 today')).includes('phone number'));

// Windows builds failed on icons\icon-192.png: every rule tests a path with forward slashes
const src = fs.readFileSync(script, 'utf8');
expect('paths are made only by relOf, so they have forward slashes on Windows too', (src.match(/path\.relative\(ROOT/g) ?? []).length === 1 && src.includes('.split(path.sep).join'));

process.exit(bad ? 1 : 0);
