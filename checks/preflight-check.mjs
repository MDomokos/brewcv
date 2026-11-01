#!/usr/bin/env node
// node checks/preflight-check.mjs
// preflight-deploy has to refuse an image that carries embedded provenance metadata and a prototypes/ folder,
// and has to accept the same tree without them. Images are built here from bytes, since *.png is gitignored. The import fixtures (PDF, DOCX, ODT) may be in the tree only with their metadata stripped.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { zip } from './lib/zip.mjs';

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
expect('a minified vendor file is not read for phone numbers and addresses, only for private values and images', !run('vendor', d => { fs.mkdirSync(path.join(d, 'vendor/lib'), { recursive: true }); fs.writeFileSync(path.join(d, 'vendor/lib/a.min.mjs'), 'x=+386' + '4292196,y="jm@kbswfq' + '.pkbgltMlwbaof"'); }).match(/phone number|email address/)
  && run('vendor2', d => { fs.mkdirSync(path.join(d, 'src'), { recursive: true }); fs.writeFileSync(path.join(d, 'src/a.js'), 'y="jm@kbswfq' + '.pkbgltMlwbaof"'); }).includes('email address'));
expect('a phone number still is', run('phone', d => fs.writeFileSync(path.join(d, 'a.md'), 'Call +44' + ' 7700 900123 today')).includes('phone number'));

// The import fixtures (checks/fixtures/import/) are the one place PDF, DOCX and ODT files may be, and only with their metadata stripped
const pdfWith = info => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Outlines /Title (Dana Okonkwo) >>\nendobj\n2 0 obj\n<< ${info} >>\nendobj\ntrailer\n<< /Root 1 0 R /Info 2 0 R >>\n%%EOF\n`, 'latin1');
const fixture = (name, bytes) => d => { fs.mkdirSync(path.join(d, 'checks/fixtures/import'), { recursive: true }); fs.writeFileSync(path.join(d, 'checks/fixtures/import', name), bytes); };
const STAY = 'rendered documents stay outside the repo', LEFT = 'fixture metadata';
expect('a PDF anywhere else is refused', run('pdf', d => { fs.mkdirSync(path.join(d, 'docs'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/a.pdf'), pdfWith('/Title ( )')); }).includes(STAY));
const okPdf = run('fx', fixture('helix-1col-word.pdf', pdfWith('/Title ( ) /Producer ( ) /CreationDate (   )')));
expect('a fixture PDF with its Info strings blanked is accepted (a bookmark\'s title is text, not metadata)', !okPdf.includes(STAY) && !okPdf.includes(LEFT));
expect('a fixture PDF whose Info names a producer is refused', run('fx2', fixture('helix-1col-word.pdf', pdfWith('/Producer (Some Writer 1.0)'))).includes(LEFT));
expect('a fixture PDF whose Info names an author, in hex, is refused', run('fx3', fixture('helix-1col-word.pdf', pdfWith('/Author <FEFF0041>'))).includes(LEFT));
expect('a fixture PDF with an XMP packet that holds anything is refused, an empty one is accepted',
  run('fx4', fixture('helix-1col-word.pdf', Buffer.concat([pdfWith('/Title ( )'), Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>')]))).includes(LEFT)
  && !run('fx5', fixture('helix-1col-word.pdf', Buffer.concat([pdfWith('/Title ( )'), Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>')]))).includes(LEFT));
const zipOf = parts => Buffer.from(zip(parts));
const core = text => `<?xml version="1.0"?><cp:coreProperties xmlns:cp="c" xmlns:dc="d">${text}</cp:coreProperties>`;
expect('a fixture DOCX whose docProps hold a creator is refused, one with them empty is accepted',
  run('fx6', fixture('helix-1col-word.docx', zipOf({ 'word/document.xml': '<w:document/>', 'docProps/core.xml': core('<dc:creator>Someone</dc:creator>') }))).includes(LEFT)
  && !run('fx7', fixture('helix-1col-word.docx', zipOf({ 'word/document.xml': '<w:document/>', 'docProps/core.xml': core('') }))).includes(LEFT));
expect('a fixture ODT whose meta.xml names a creator is refused', run('fx8', fixture('helix-1col-word.odt', zipOf({ 'content.xml': '<office:document-content/>', 'meta.xml': '<office:document-meta><office:meta><dc:creator>Someone</dc:creator></office:meta></office:document-meta>' }))).includes(LEFT));

// Windows builds failed on icons\icon-192.png: every rule tests a path with forward slashes
const src = fs.readFileSync(script, 'utf8');
expect('paths are made only by relOf, so they have forward slashes on Windows too', (src.match(/path\.relative\(ROOT/g) ?? []).length === 1 && src.includes('.split(path.sep).join'));

process.exit(bad ? 1 : 0);
