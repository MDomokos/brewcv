#!/usr/bin/env node
// node checks/history-scan-check.mjs
// history-scan has to read commit messages, authors and committers, not only file contents.
// Each case builds a throwaway repository with its own overlay and runs the scan inside it.

import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { zip } from './lib/zip.mjs';

const scan = path.join(path.dirname(new URL(import.meta.url).pathname), 'history-scan.mjs');
const OWN = 'me@example.org';

function run(commits){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-'));
  const sh = (cmd, args, env = {}) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
  sh('git', ['init', '-q', '-b', 'main']);
  fs.mkdirSync(path.join(dir, 'checks'));
  fs.writeFileSync(path.join(dir, 'checks/deny.local.json'), JSON.stringify({ deny: ['forbidden-word'], commitEmails: [OWN] }));
  commits.forEach(({ message, email = OWN, name = 'Someone', content, file = 'f.txt' }, i) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content ?? String(i));
    sh('git', ['add', file]);
    sh('git', ['commit', '-q', '-m', message], { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email });
  });
  // hermetic: the real private files (outside the tree, see scripts/lib/private-files.mjs) must not be read here, so the
  // scan gets an empty home and no private folder, and only the overlay this case wrote
  const r = sh('node', [scan], { HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'home-')), BREWCV_PRIVATE_DIR: '', XDG_CONFIG_HOME: '', APPDATA: '' });
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

let bad = 0;
const expect = (label, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) bad++; };

expect('a clean history passes', run([{ message: 'Add a thing' }]).status === 0);
expect('a denied word in a message fails', run([{ message: 'Add a forbidden-word thing' }]).status === 1);
expect('a denied word in a later commit body fails', run([{ message: 'One' }, { message: 'Two\n\nforbidden-word here' }]).status === 1);
expect('an author email outside commitEmails fails', run([{ message: 'Add', email: 'other@example.org' }]).status === 1);
expect('a denied value in an author name alone passes', run([{ message: 'Add', name: 'forbidden-word' }]).status === 0);
expect('a font unicode-range is not a phone number', run([{ message: 'Add', content: 'unicode-range: U+0000-00FF, U+0131, U+0152-0153;' }]).status === 0);
expect('a phone number in a file still fails', run([{ message: 'Add', content: 'Call +44' + ' 7700 900123' }]).status === 1);

// the import fixtures (by name and sha256 in MANIFEST.json) and the two vendored PDF.js files are the places the rules relax
const sha = c => crypto.createHash('sha256').update(c).digest('hex'), FX = 'checks/fixtures/import/';
const listed = (name, c) => ({ message: 'Add', file: FX + 'MANIFEST.json', content: JSON.stringify({ files: { [name]: sha(c) } }) });
expect('a PDF anywhere else fails, and one in checks/fixtures/import/ passes only when the manifest lists its name and bytes', run([{ message: 'Add', file: 'docs/a.pdf' }]).status === 1 && run([{ message: 'Add', file: FX + 'a.pdf', content: 'x' }]).status === 1
  && run([listed('a.pdf', 'x'), { message: 'Add', file: FX + 'a.pdf', content: 'x' }]).status === 0);
expect('a listed fixture whose bytes changed, in any commit of the history, fails; so does an ODT outside the manifest', run([listed('a.pdf', 'x'), { message: 'Add', file: FX + 'a.pdf', content: 'x' }, { message: 'Change', file: FX + 'a.pdf', content: 'y' }]).status === 1
  && run([{ message: 'Add', file: FX + 'a.odt', content: 'x' }]).status === 1 && run([{ message: 'Add', file: 'a/b.odt', content: 'x' }]).status === 1);
expect('a PDF or a ZIP of Word files under another name (docs/real.bin, no extension, in the fixtures folder, a .zip) fails, listed or not, and a ZIP of text does not', ['docs/real.bin', 'docs/resume', FX + 'real.bin', 'docs/a.zip'].every(f => run([{ message: 'Add', file: f, content: '%PDF-1.4 x' }]).status === 1)
  && run([listed('real.bin', '%PDF-1.4 x'), { message: 'Add', file: FX + 'real.bin', content: '%PDF-1.4 x' }]).status === 1 && run([{ message: 'Add', file: 'docs/b.bin', content: 'just text' }]).status === 0);
const docxIn = Buffer.from(zip({ 'a/nested.bin': Buffer.from(zip({ 'word/document.xml': '<w:p/>' })) }));
expect('a Word file stored as nested.bin inside a ZIP of another name fails, and so do gzip, tar, 7z and rar by their names and gzip by its bytes', run([{ message: 'Add', file: 'docs/a.dat', content: docxIn }]).status === 1
  && ['a.gz', 'a.tgz', 'a.tar', 'a.7z', 'a.rar', 'a.bz2', 'a.xz'].every(f => run([{ message: 'Add', file: 'docs/' + f, content: 'x' }]).status === 1) && run([{ message: 'Add', file: 'docs/blob.dat', content: zlib.gzipSync(Buffer.from('x')) }]).status === 1);
expect('a number and an address in the two vendored PDF.js files pass, elsewhere in vendor/ they fail', run([{ message: 'Add', file: 'vendor/pdfjs/pdf.min.mjs', content: 'x=+386' + '4292196,y="jm@kbswfq' + '.pkbgltMlwbaof"' }]).status === 0 && run([{ message: 'Add', file: 'vendor/pdfjs/other.mjs', content: 'y="jm@kbswfq' + '.pkbgltMlwbaof"' }]).status === 1);

process.exit(bad ? 1 : 0);
