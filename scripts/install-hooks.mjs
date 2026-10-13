#!/usr/bin/env node
// node scripts/install-hooks.mjs [--force]
// Installs the pre-push hook (scripts/pre-push.mjs) into this clone. Hooks live in .git/hooks, which is not part of the repo, so every
// clone (and every machine) runs this once. It adds ONLY a pre-push file and leaves every other hook alone; a pre-push hook that is
// already there and is not ours is not overwritten unless you pass --force, which keeps it as pre-push.local and runs it after ours.
// Worktrees share one hooks folder, so one install covers them all.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MARK = '# installed by scripts/install-hooks.mjs';
const SHIM = `#!/bin/sh
${MARK}: the logic is in scripts/pre-push.mjs, so it updates with the repo.
input=$(cat)
dir=$(dirname "$0")
printf '%s\\n' "$input" | node "$(git rev-parse --show-toplevel)/scripts/pre-push.mjs" "$@" || exit 1
if [ -x "$dir/pre-push.local" ]; then printf '%s\\n' "$input" | "$dir/pre-push.local" "$@" || exit 1; fi
`;

const hooks = path.resolve(execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { encoding: 'utf8' }).trim());
const target = path.join(hooks, 'pre-push');
fs.mkdirSync(hooks, { recursive: true });
if (fs.existsSync(target)){
  const old = fs.readFileSync(target, 'utf8');
  if (!old.includes(MARK)){
    if (!process.argv.includes('--force')){
      console.error(`A pre-push hook that is not ours is already in ${hooks}.\nKeep it and add ours after it: node scripts/install-hooks.mjs --force (it becomes pre-push.local).`);
      process.exit(1);
    }
    fs.renameSync(target, path.join(hooks, 'pre-push.local'));
    console.log('kept the existing pre-push hook as pre-push.local; it runs after ours');
  }
}
fs.writeFileSync(target, SHIM, { mode: 0o755 });
fs.chmodSync(target, 0o755);
console.log(`installed ${target}`);
