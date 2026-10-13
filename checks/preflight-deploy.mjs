#!/usr/bin/env node
// node checks/preflight-deploy.mjs [dir]   (exit 1 means do not publish)
// Checks the tree about to ship (CI runs it on _site). The only person in this repo is fictional,
// so any contactable address is a finding, without needing the real values.
// Two private files add values that must not ship and must not be written here either. They live OUTSIDE the repo
// ($BREWCV_PRIVATE_DIR, else ~/.config/brewcv, ~/Library/Application Support/BrewCV or %APPDATA%\BrewCV; see scripts/lib/private-files.mjs):
//   identity.local.json   { "email": "...", "phone": "...", "city": "..." }
//   deny.local.json       { "deny": ["a retired address", "an old figure"] }
// The old in-tree paths (data/identity.local.json, checks/deny.local.json) are still read, with a warning. CI has neither file.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findPrivate, REPO } from '../scripts/lib/private-files.mjs';

const ROOT = path.resolve(process.argv[2] ?? '.');
// --app: a desktop build's staged copy (scripts/desktop-stage.mjs). Nothing private may be in it either, but a service worker and
// .nojekyll belong to the website, so they are not required.
const APP = process.argv.includes('--app');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', '.github']);
const TEXT = /\.(html|css|js|mjs|json|webmanifest|md|txt|svg|yml|yaml)$/i;
const RASTER = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|avif)$/i;

// Everything else of the same shape is a finding. Keep this short.
const ALLOWED_EMAILS = [
  'dana@example.org',            // data/example.json, the fictional person
];
const ALLOWED_PHONES = [
  '+351 900 000 000',            // data/example.json, the fictional person
  '+00 000 000 000',             // scripts/lib/identity.mjs, the placeholder
];

const IMAGE = /\.(png|svg|jpe?g|webp|gif)$/i;

// Embedded provenance (C2PA / JUMBF) or XMP metadata. Returns what was found, or null.
// Chunks and segments are walked rather than the whole file searched, so compressed pixel data cannot match by chance.
function provenance(name, buf){
  const has = (b, s) => b.includes(s);
  const text = b => b.toString('latin1');
  const ext = name.toLowerCase().match(/\.([a-z]+)$/)?.[1];
  if (ext === 'svg'){
    const t = buf.toString('utf8');
    if (/c2pa/i.test(t)) return 'a c2pa manifest is embedded in the SVG';
    if (t.includes('<x:xmpmeta')) return 'an XMP packet is embedded in the SVG';
    return null;
  }
  if (ext === 'png' && buf.length > 8 && buf.subarray(1, 4).toString() === 'PNG'){
    for (let i = 8; i + 12 <= buf.length;){
      const len = buf.readUInt32BE(i), type = buf.toString('latin1', i + 4, i + 8);
      if (type === 'IDAT') { i += 12 + len; continue; }
      if (type === 'caBX') return 'a caBX chunk is embedded';
      const body = buf.subarray(i + 8, i + 8 + len);
      if (has(body, 'jumb') || has(body, 'c2pa')) return `a provenance box is embedded in a ${type} chunk`;
      if (has(body, '<x:xmpmeta')) return `an XMP packet is embedded in a ${type} chunk`;
      i += 12 + len;
    }
    return null;
  }
  if (ext === 'jpg' || ext === 'jpeg'){
    for (let i = 2; i + 4 <= buf.length && buf[i] === 0xFF;){
      const marker = buf[i + 1];
      if (marker === 0xDA) break;
      const len = buf.readUInt16BE(i + 2), body = buf.subarray(i + 4, i + 2 + len);
      if (has(body, 'jumb') || has(body, 'c2pa')) return 'a provenance box is embedded in a JPEG segment';
      if (has(body, '<x:xmpmeta')) return 'an XMP packet is embedded in a JPEG segment';
      i += 2 + len;
    }
    return null;
  }
  if (ext === 'webp' && text(buf.subarray(0, 4)) === 'RIFF'){
    for (let i = 12; i + 8 <= buf.length;){
      const type = text(buf.subarray(i, i + 4)), len = buf.readUInt32LE(i + 4);
      if (type === 'XMP ' || type === 'C2PA') return `a ${type.trim()} chunk is embedded`;
      i += 8 + len + (len & 1);
    }
    return null;
  }
  if (ext === 'gif' && has(buf, 'XMP DataXMP')) return 'an XMP packet is embedded in the GIF';
  return null;
}

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE = /\+\d[\d  ().-]{7,}\d/g;
const EXAMPLE_DOMAIN = /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost)$|^\d+x\.(png|jpe?g|webp|gif)$/i; // the last: icon@2x.png

const findings = [];
const flag = (file, line, what, detail) =>
  findings.push({ file: path.relative(ROOT, file) || '.', line, what, detail });

function walk(dir, out = []){
  for (const e of fs.readdirSync(dir, { withFileTypes: true })){
    if (e.name.startsWith('.') && e.name !== '.nojekyll' && e.name !== '.gitignore') continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
let files = walk(ROOT);

// A gitignored file is not part of what ships (_site has no .gitignore, so CI checks every file).
// Without git, the rules are read from .gitignore: unanchored, last match wins, the subset this repo uses.
function gitIgnored(rel){
  try {
    const out = execFileSync('git', ['-C', ROOT, 'check-ignore', '--stdin'],
      { input: rel.join('\n'), encoding: 'utf8' });
    return new Set(out.split('\n').map(s => s.trim()).filter(Boolean));
  } catch (e){
    // exit 1 just means nothing matched
    return new Set((e.stdout ?? '').split('\n').map(s => s.trim()).filter(Boolean));
  }
}

function fileIgnored(rel){
  const rules = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => ({ negate: l.startsWith('!'), pat: l.replace(/^!/, '') }));
  const glob = p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
  const out = new Set();
  for (const r of rel){
    let hit = false;
    for (const { negate, pat } of rules){
      const dirRule = pat.endsWith('/');
      const p = dirRule ? pat.slice(0, -1) : pat;
      const segs = r.split('/');
      const matched = p.includes('/')
        ? glob(p).test(r) || segs.some((_, i) => glob(p).test(segs.slice(0, i + 1).join('/')))
        : (dirRule ? segs.slice(0, -1).some(sg => glob(p).test(sg))
                   : segs.some(sg => glob(p).test(sg)));
      if (matched) hit = !negate;
    }
    if (hit) out.add(r);
  }
  return out;
}

{
  const rel = files.map(f => path.relative(ROOT, f));
  const hasGit = fs.existsSync(path.join(ROOT, '.git'));
  const hasRules = fs.existsSync(path.join(ROOT, '.gitignore'));
  const ignored = hasGit ? gitIgnored(rel) : hasRules ? fileIgnored(rel) : new Set();
  if (ignored.size){
    files = files.filter(f => !ignored.has(path.relative(ROOT, f)));
    console.log(`preflight: ${ignored.size} ignored file${ignored.size === 1 ? '' : 's'} skipped`
      + ` (${hasGit ? 'git check-ignore' : '.gitignore, read directly: no repository yet'})`);
  }
}

for (const f of files){
  const rel = path.relative(ROOT, f);
  if (rel === 'data/resume-data.json') flag(f, 0, 'real library', 'data/resume-data.json is present. It is gitignored, but it must not be in a deploy tree either');
  if (/\.local\.json$/.test(rel))      flag(f, 0, 'local file', `${rel} is a private overlay and must not be published`);
  if (/^out\//.test(rel))              flag(f, 0, 'rendered output', rel);
  if (/\.pdf$/i.test(rel))             flag(f, 0, 'PDF', `${rel}: rendered documents stay outside the repo`);
  if (/^data\/recipes\//.test(rel))    flag(f, 0, 'recipe', `${rel}: recipes name real applications`);
  // The only images that ship are the app's own icons.
  if (RASTER.test(rel) && !/^(src-tauri\/)?icons\//.test(rel))
    flag(f, 0, 'image', `${rel}: the only images that ship are icons/`);
  if (rel.split('/').includes('prototypes'))
    flag(f, 0, 'prototype', `${rel}: prototypes live outside the repo`);
  if (IMAGE.test(rel)){
    const why = provenance(rel, fs.readFileSync(f));
    if (why) flag(f, 0, 'provenance metadata', `${rel}: ${why}. Strip it and leave the image data untouched`);
  }
}

const deny = [];
let shortSkipped = 0;
// The private files live outside the tree (scripts/lib/private-files.mjs). The old in-tree path is read from the scanned
// tree and from this repo, with a warning: a staged copy (_desktop) never holds them, so the repo's own are the ones that count.
for (const [name, keys] of [['identity.local.json', null], ['deny.local.json', 'deny']]){
  const hit = findPrivate(name, { roots: [ROOT, REPO] });
  if (!hit) continue;
  try {
    const j = JSON.parse(fs.readFileSync(hit.path, 'utf8'));
    // A country code ("HU") or any value under four characters would match ordinary code,
    // so those are skipped and counted.
    const vals = keys ? (j[keys] ?? []) : Object.entries(j).filter(([k]) => k !== 'countryCode').map(([, v]) => v);
    for (const v of vals){
      if (typeof v !== 'string' || !v.trim()) continue;
      if (v.trim().length < 4){ shortSkipped++; continue; }
      deny.push(v.trim());
    }
  } catch { flag(hit.path, 0, 'unreadable overlay', name); }
}
console.log(deny.length ? `preflight: ${deny.length} private value${deny.length === 1 ? '' : 's'} loaded, checked as well as the shapes`
  : 'preflight: no private identity or deny file found (CI, or not set up): checking shapes only. See docs/DEVELOPMENT.md, "Real data is not in this repo"');

for (const f of files){
  if (!TEXT.test(f)) continue;
  const rel = path.relative(ROOT, f);
  const lines = fs.readFileSync(f, 'utf8').split('\n');

  lines.forEach((line, n) => {
    for (const m of line.matchAll(EMAIL)){
      const addr = m[0];
      if (ALLOWED_EMAILS.includes(addr)) continue;
      const domain = addr.split('@')[1];
      if (EXAMPLE_DOMAIN.test(domain)) continue;
      flag(f, n + 1, 'email address', addr);
    }
    for (const m of line.matchAll(PHONE)){
      const num = m[0].replace(/[  ().-]+/g, ' ').trim();
      if (ALLOWED_PHONES.some(a => a.replace(/\s+/g, '') === num.replace(/\s+/g, ''))) continue;
      flag(f, n + 1, 'phone number', num);
    }
    for (const d of deny) if (line.includes(d)) flag(f, n + 1, 'denied value', '(from a local overlay)');
    if (/data:image\/(png|jpeg|webp);base64,/.test(line))
      flag(f, n + 1, 'embedded image', 'a base64 image in a committed file: the portrait must stay outside the repo');
  });

  // GitHub Pages serves this repo from /<repo>/, so a root-absolute path 404s.
  if (/\.(html|webmanifest|css)$/i.test(rel)){
    lines.forEach((line, n) => {
      for (const m of line.matchAll(/\b(?:href|src|action|start_url|scope)\s*[=:]\s*"\/(?!\/)/g))
        flag(f, n + 1, 'root-absolute path', `${m[0].trim()}…: Pages serves this site from a subpath, so use a relative path`);
    });
  }
}

const need = ['index.html', 'manifest.webmanifest', ...(APP ? [] : ['sw.js', '.nojekyll']),
              'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
              'icons/icon-maskable-512.png', 'data/example.json'];
for (const n of need)
  if (!fs.existsSync(path.join(ROOT, n))) flag(path.join(ROOT, n), 0, 'missing', `${n} is required for the deployed app`);

const swPath = path.join(ROOT, 'sw.js');
if (fs.existsSync(swPath)){
  const sw = fs.readFileSync(swPath, 'utf8');
  const version = sw.match(/const VERSION\s*=\s*'([^']+)'/)?.[1];
  if (!version) flag(swPath, 0, 'service worker', 'no VERSION constant: installed copies would never update');
  for (const m of sw.matchAll(/'(\.\/[^']+)'/g)){
    const rel = m[1].replace(/^\.\//, '');
    if (rel === '' || rel.endsWith('/')) continue;
    // the example names have accents, and a checkout may keep them decomposed (NFD)
    const dir = path.join(ROOT, path.dirname(rel));
    const there = fs.existsSync(path.join(ROOT, rel)) || (fs.existsSync(dir)
      && fs.readdirSync(dir).some(f => f.normalize('NFC') === path.basename(rel).normalize('NFC')));
    if (!there)
      flag(swPath, 0, 'precache 404', `${rel} is in the shell list but not in the tree`);
  }
}

if (!findings.length){
  if (shortSkipped) console.log(`preflight: ${shortSkipped} overlay value${shortSkipped === 1 ? '' : 's'} under four characters not checked (too short to identify anyone)`);
  console.log(`preflight: clean, ${files.length} files, safe to publish`);
  process.exit(0);
}
const byKind = new Map();
for (const f of findings) byKind.set(f.what, [...(byKind.get(f.what) ?? []), f]);
console.error(`\npreflight: ${findings.length} finding${findings.length === 1 ? '' : 's'}. DO NOT PUBLISH\n`);
for (const [what, list] of byKind){
  console.error(`${what} (${list.length})`);
  for (const f of list.slice(0, 12)) console.error(`  ${f.file}${f.line ? `:${f.line}` : ''}  ${f.detail}`);
  if (list.length > 12) console.error(`  … and ${list.length - 12} more`);
  console.error('');
}
console.error('Nothing was published. Resolve these, or keep the repository private.\n');
process.exit(1);
