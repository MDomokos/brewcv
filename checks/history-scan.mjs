#!/usr/bin/env node
// node checks/history-scan.mjs   (run it before adding a remote)
// Private values come from deny.local.json, kept outside the repo ($BREWCV_PRIVATE_DIR or the platform default; see
// scripts/lib/private-files.mjs). It does NOT read identity.local.json: add the owner's email, phone and city to "deny" to have
// them searched for in commit messages. File contents are only checked for shapes.
// .gitignore covers the working tree; this covers the commits. A file added and deleted again is still in
// every clone, and preflight-deploy.mjs only reads the tree about to ship.
// While the repo is unpushed, a bad history costs one `git checkout --orphan`.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { findPrivate } from '../scripts/lib/private-files.mjs';

const git = (...args) => {
  try { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 }); }
  catch (e){ return e.stdout ?? ''; }
};

if (!fs.existsSync('.git')){
  console.log('history-scan: no .git here, so nothing is committed and there is nothing to scan');
  process.exit(0);
}

const revs = git('rev-list', '--all').trim().split('\n').filter(Boolean);
if (!revs.length){
  console.log('history-scan: no commits yet, nothing to scan');
  process.exit(0);
}
console.log(`history-scan: ${revs.length} commit${revs.length === 1 ? '' : 's'}`);

const findings = [];

const NEVER = [
  [/(^|\/)resume-data\.json$/,      'the real library'],
  [/\.local\.json$/,                'a private overlay'],
  [/(^|\/)portrait\.\w+$/,          'the portrait'],
  [/(^|\/)recipes\//,               'a recipe (names a real application)'],
  [/\.(afpub|psd|docx|pages)$/i,    'a resume source file'],
  [/\.pdf$/i,                       'a rendered document'],
  [/\.jsonresume\.json$/,           'a JSON Resume export'],
  [/^\.env/,                        'an env file'],
  [/\.(png|jpe?g|webp|gif|avif|heic)$/i, 'an image outside icons/ and docs/'],
];
const everSeen = new Set(
  git('log', '--all', '--pretty=format:', '--name-only', '--diff-filter=AM')
    .split('\n').map(s => s.trim()).filter(Boolean));
for (const f of everSeen){
  if (/^(src-tauri\/)?icons\//.test(f) || /^docs\/[^/]+\.(png|gif)$/i.test(f)) continue;
  for (const [re, what] of NEVER)
    if (re.test(f)){ findings.push({ kind: 'file', detail: `${f}: ${what}` }); break; }
}

// content, in every revision
const PATTERNS = [
  ['email address', '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'],
  ['phone number',  '\\+[0-9][0-9 ().-]{7,}[0-9]'],
  ['embedded image', 'data:image/(png|jpeg|webp);base64,'],
];
const ALLOW = /@[0-9]x\.(png|jpe?g|webp)|example\.(org|com|net)|@example|noreply@|dana@|\+351 900|\+1 555|\+00 000/;

if (revs.length > 400)
  console.log(`  (${revs.length} commits; the content scan may take a moment)`);

for (const [what, pattern] of PATTERNS){
  const out = git('grep', '-I', '-n', '-E', pattern, ...revs);
  const hits = new Map();
  for (const line of out.split('\n')){
    if (!line.trim() || ALLOW.test(line)) continue;
    // rev:path:lineno:text
    const m = line.match(/^([0-9a-f]{7,40}):([^:]+):(\d+):(.*)$/);
    if (!m) continue;
    const [, rev, file, , text] = m;
    const key = `${file}`;
    if (!hits.has(key)) hits.set(key, { file, rev, sample: text.trim().slice(0, 90), n: 0 });
    hits.get(key).n++;
  }
  for (const h of hits.values())
    findings.push({ kind: what, detail: `${h.file} (${h.n} occurrence${h.n === 1 ? '' : 's'}, first seen ${h.rev.slice(0, 8)})\n      ${h.sample}` });
}

// commit metadata: messages, authors and committers, against the private overlay
// deny.local.json lives outside the repo (scripts/lib/private-files.mjs); the old checks/deny.local.json is read with a warning.
let overlay = {};
const priv = findPrivate('deny.local.json', { roots: [process.cwd()] });
if (priv) try { overlay = JSON.parse(fs.readFileSync(priv.path, 'utf8')); } catch { console.warn('history-scan: the deny file is not valid JSON, so it was not used'); }
else console.log('history-scan: no deny file found (not set up, or CI): commit messages and author emails are not checked against private values');
const deny = (overlay.deny ?? []).filter(v => typeof v === 'string' && v.trim().length >= 4).map(v => v.trim());
const emails = (overlay.commitEmails ?? []).map(e => e.toLowerCase());
const log = git('log', '--all', '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e');
for (const rec of log.split('\x1e')){
  if (!rec.trim()) continue;
  const [hash, , aEmail, , cEmail, message = ''] = rec.trim().split('\x1f');
  const short = hash.slice(0, 8);
  // Names are not checked: a name chosen as the public author is allowed to match a denied value.
  for (const [role, email] of [['author', aEmail], ['committer', cEmail]]){
    if (emails.length && !emails.includes(email.toLowerCase()))
      findings.push({ kind: 'commit identity', detail: `${short}: ${role} email is not one of commitEmails` });
    if (deny.some(d => email.includes(d)))
      findings.push({ kind: 'commit identity', detail: `${short}: ${role} email matches a denied value` });
  }
  if (deny.some(d => message.includes(d)))
    findings.push({ kind: 'commit message', detail: `${short}: the message matches a denied value (from a local overlay)` });
}

if (!findings.length){
  console.log('history-scan: clean, safe to add a remote');
  process.exit(0);
}
const byKind = new Map();
for (const f of findings) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
console.error(`\nhistory-scan: ${findings.length} finding${findings.length === 1 ? '' : 's'} in the history\n`);
for (const [kind, list] of byKind){
  console.error(`${kind} (${list.length})`);
  for (const f of list.slice(0, 15)) console.error(`  ${f.detail}`);
  if (list.length > 15) console.error(`  … and ${list.length - 15} more`);
  console.error('');
}
console.error(`Deleting these from the working tree does not remove them from the history.`);
console.error(`While this repo has no remote, the cheap fix is to start the history over:`);
console.error(``);
console.error(`  git checkout --orphan clean && git add -A && git commit -m "…"`);
console.error(`  git branch -D main && git branch -m main`);
console.error(``);
console.error(`Do that before adding a remote, not after.`);
process.exit(1);
