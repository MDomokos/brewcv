#!/usr/bin/env node
// node checks/prepush-check.mjs
// scripts/pre-push.mjs has to stop a push that would publish something private, and only look at what is being pushed.
// Each case builds a throwaway repository and gives the script the lines git gives a pre-push hook. The machine's own private
// files are never read: HOME and BREWCV_PRIVATE_DIR point at empty folders (or at a fake deny file the case writes).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = path.resolve(fileURLToPath(new URL('../scripts/pre-push.mjs', import.meta.url)));
const ZERO = '0'.repeat(40);
let bad = 0;
const expect = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && extra ? `  — ${extra}` : ''}`); if (!ok) bad++; };

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
function repo(){
  const dir = tmp('prepush-repo-');
  const env = { ...process.env, HOME: tmp('prepush-home-'), BREWCV_PRIVATE_DIR: tmp('prepush-priv-'), XDG_CONFIG_HOME: '', APPDATA: '',
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.org', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.org' };
  const sh = (cmd, args, e = {}) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', env: { ...env, ...e } });
  sh('git', ['init', '-q', '-b', 'main']);
  const commit = (files, message = 'Add things') => {
    for (const [f, text] of Object.entries(files)){ fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); }
    sh('git', ['add', '-A']); sh('git', ['commit', '-q', '-m', message]);
    return sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  };
  const push = (lines, e = {}) => spawnSync(process.execPath, [HOOK, 'origin', 'x'], { cwd: dir, encoding: 'utf8', env: { ...env, ...e }, input: lines.join('\n') + '\n' });
  return { dir, env, commit, push };
}

{
  const r = repo(); const a = r.commit({ 'a.txt': '1' });
  const res = r.push([`refs/heads/work ${a} refs/heads/work ${ZERO}`]);
  expect('a clean commit may be pushed', res.status === 0, res.stderr);
}
{
  const r = repo(); r.commit({ 'a.txt': '1' }); const b = r.commit({ 'identity.json': '{}' });
  const res = r.push([`refs/heads/work ${b} refs/heads/work ${ZERO}`]);
  expect('a renamed identity file is refused', res.status === 1 && /identity or deny file/.test(res.stderr), res.stderr);
}
{
  const r = repo(); r.commit({ 'old.zip': 'x' }); const b = r.commit({ 'a.txt': '1' });
  const first = r.push([`refs/heads/work ${b} refs/heads/work ${ZERO}`]);
  const a = spawnSync('git', ['rev-parse', 'HEAD~1'], { cwd: r.dir, encoding: 'utf8' }).stdout.trim();
  const second = r.push([`refs/heads/work ${b} refs/heads/work ${a}`]);
  expect('an archive is refused when it is part of what is pushed', first.status === 1 && /archive or backup/.test(first.stderr), first.stderr);
  expect('…but commits the remote already has are not looked at again (only the range is scanned)', second.status === 0, second.stderr);
}
{
  const r = repo(); const priv = tmp('prepush-deny-'); fs.writeFileSync(path.join(priv, 'deny.local.json'), JSON.stringify({ deny: ['forbidden-word'] }));
  const a = r.commit({ 'a.txt': '1' }, 'Mention a forbidden-word here');
  const res = r.push([`refs/heads/work ${a} refs/heads/work ${ZERO}`], { BREWCV_PRIVATE_DIR: priv });
  expect('a private value in a commit message is refused (from the private deny file)', res.status === 1 && /commit message/.test(res.stderr), res.stderr);
}
{
  const r = repo(); const a = r.commit({ 'a.txt': '1' });
  const res = r.push([`(delete) ${ZERO} refs/heads/work ${a}`]);
  expect('deleting a branch publishes nothing and passes', res.status === 0, res.stderr);
}
{
  const r = repo(); const a = r.commit({ 'a.txt': '1' });
  const res = r.push([`refs/heads/main ${a} refs/heads/main ${ZERO}`]);
  expect('a push to main in a repo with no pages.yml says the dry run was skipped, and passes', res.status === 0 && /dry run skipped/.test(res.stderr), res.stderr);
}
{
  const r = repo(); const a = r.commit({ 'a.txt': '1' }, 'Add a thing');
  const res = r.push([`refs/heads/main ${a} refs/heads/main ${ZERO}`]);
  // history-scan allows example.* addresses; the site gate allows only the fictional person's, so only the gate refuses this one
  const bad2 = r.commit({ '.github/workflows/pages.yml': "run: rsync -a ./ _site/ --exclude '.git'\n", 'notes.md': 'write to someone@example.net\n' });
  const res2 = r.push([`refs/heads/main ${bad2} refs/heads/main ${a}`]);
  expect('a push to main assembles the site and refuses it when the privacy gate finds a contact address', res2.status === 1 && /privacy gate|email address/i.test(res2.stderr) && res.status === 0, res2.stderr.slice(0, 400));
}
console.log(bad ? `\n${bad} pre-push check(s) FAILED` : '\nall pre-push checks passed');
process.exit(bad ? 1 : 0);
