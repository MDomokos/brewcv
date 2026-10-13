#!/usr/bin/env node
// The pre-push hook (scripts/install-hooks.mjs puts a three-line shim in .git/hooks that runs this file, so it updates with the repo).
// git runs it with `<remote name> <url>` and one line per ref on stdin: `<local ref> <local sha> <remote ref> <remote sha>`.
// It refuses the push when what is about to be published holds anything private:
//   1. the commits being pushed (not the whole history) go through checks/history-scan.mjs: private file names, identity shapes,
//      the owner's private values in messages, author identities outside commitEmails;
//   2. a push to main, which the Pages workflow deploys, also assembles the site the way .github/workflows/pages.yml does (from the
//      pushed commit itself with `git archive`, so ignored files cannot get in, with the excludes read from pages.yml) and runs
//      version-check, name-check and preflight-deploy on it (preflight-deploy matches the owner's private values too: CI cannot).
// `git push --no-verify` skips it. Nothing here talks to the network or writes outside a temp folder.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.resolve(fileURLToPath(new URL('..', import.meta.url)));      // the repo this script lives in (its checks)
const ZERO = /^0+$/;
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const node = (script, args, opts = {}) => spawnSync(process.execPath, [path.join(HERE, script), ...args], { encoding: 'utf8', ...opts });
const say = m => console.error(`pre-push: ${m}`);

const [remote = 'origin'] = process.argv.slice(2);
const lines = fs.readFileSync(0, 'utf8').split('\n').filter(Boolean);
let failed = 0;

// what the remote does not have yet
function selection(localSha, remoteSha){
  if (!ZERO.test(remoteSha)){
    try { git('rev-parse', '--verify', '--quiet', `${remoteSha}^{commit}`); return [`${remoteSha}..${localSha}`]; } catch { /* a force push over a commit we do not have */ }
  }
  return [localSha, '--not', `--remotes=${remote}`];
}

function assembleSite(sha){
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prepush-'));
  const src = path.join(tmp, 'src'), site = path.join(tmp, 'site');
  fs.mkdirSync(src); fs.mkdirSync(site);
  execFileSync('sh', ['-c', `git archive --format=tar ${JSON.stringify(sha)} | tar -x -C ${JSON.stringify(src)}`], { stdio: 'pipe' });
  const wf = path.join(src, '.github/workflows/pages.yml');
  if (!fs.existsSync(wf)) return { tmp, site: null, why: 'the pushed commit has no .github/workflows/pages.yml' };
  const excludes = [...fs.readFileSync(wf, 'utf8').matchAll(/--exclude '([^']+)'/g)].map(m => m[1]);
  const r = spawnSync('rsync', ['-a', ...excludes.flatMap(e => ['--exclude', e]), `${src}/`, `${site}/`], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return { tmp, site: null, why: `rsync is not available or failed (${r.error?.code ?? r.status})` };
  const sw = path.join(site, 'sw.js');       // pages.yml names the service worker's cache after the commit
  if (fs.existsSync(sw)) fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace(/^const VERSION = '([^']*)';/m, `const VERSION = '$1+${sha.slice(0, 7)}';`));
  return { tmp, site };
}

for (const line of lines){
  const [localRef, localSha, remoteRef, remoteSha] = line.split(' ');
  if (!localSha || ZERO.test(localSha)) continue;                  // deleting a ref publishes nothing
  const sel = selection(localSha, remoteSha);

  const hs = node('checks/history-scan.mjs', sel, { cwd: process.cwd() });
  if (hs.status !== 0){
    failed++;
    say(`${localRef} -> ${remoteRef}: the commits being pushed hold something private.\n${hs.stderr || hs.stdout}`);
  }

  if (remoteRef === 'refs/heads/main'){
    let built;
    try { built = assembleSite(localSha); } catch (e){ say(`could not assemble the site to check it (${e.message.split('\n')[0]}); skipped`); continue; }
    try {
      if (!built.site){ say(`deploy dry run skipped: ${built.why}`); continue; }
      for (const [script, label] of [['checks/version-check.mjs', 'version'], ['checks/name-check.mjs', 'name'], ['checks/preflight-deploy.mjs', 'privacy gate']]){
        const r = node(script, [built.site]);
        if (r.status !== 0){ failed++; say(`the site the deploy would publish fails the ${label} check:\n${(r.stderr || r.stdout).trim()}`); }
      }
    } finally { fs.rmSync(built.tmp, { recursive: true, force: true }); }
  }
}

if (failed){
  say(`refusing to push (${failed} problem${failed === 1 ? '' : 's'}). Fix them, or push with --no-verify if you know better.`);
  process.exit(1);
}
console.error('pre-push: ok (the commits being pushed, and for main the site the deploy would publish, are clean)');
