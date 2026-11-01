#!/usr/bin/env node
// node checks/history-scan-check.mjs
// history-scan has to read commit messages, authors and committers, not only file contents.
// Each case builds a throwaway repository with its own overlay and runs the scan inside it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
  // hermetic: the owner's real private files (outside the tree, see scripts/lib/private-files.mjs) must not be read here, so the
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

// the import fixtures and the vendored PDF.js are the two places the rules relax
expect('a PDF anywhere else fails, and one in checks/fixtures/import/ passes', run([{ message: 'Add', file: 'docs/a.pdf' }]).status === 1 && run([{ message: 'Add', file: 'checks/fixtures/import/helix-1col-word.pdf' }]).status === 0);
expect('a number and an address in vendor/pdfjs/ pass, elsewhere they fail', run([{ message: 'Add', file: 'vendor/pdfjs/a.min.mjs', content: 'x=+386' + '4292196,y="jm@kbswfq' + '.pkbgltMlwbaof"' }]).status === 0 && run([{ message: 'Add', file: 'vendor/other/a.js', content: 'y="jm@kbswfq' + '.pkbgltMlwbaof"' }]).status === 1);

process.exit(bad ? 1 : 0);
