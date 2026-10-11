#!/usr/bin/env node
// node scripts/onefile.mjs pack   <data-dir> <out.json> [--force]
// node scripts/onefile.mjs unpack <file.json> <data-dir> [--force]
// Turns a data folder (resume-data.json and recipes/) into the one file the app saves (brewcv.json), and back,
// so the command-line tools work on a folder while the person keeps one file. Same code as the app's
// Save to file and Open (src/store/persist.js). Checkpoints are not packed: they stay in the browser.
// Never overwrites a file, or writes into a folder that has anything in it, without --force.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFolder, readBackup, makeBackup, filesOf } from '../src/store/persist.js';
import { ensureRecordId } from '../src/model/schema.js';

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const [CMD, A, B] = argv.filter(a => !a.startsWith('--'));
const usage = () => {
  console.error('usage: node scripts/onefile.mjs pack <data-dir> <out.json> [--force]\n       node scripts/onefile.mjs unpack <file.json> <data-dir> [--force]');
  process.exit(2);
};
if (!['pack', 'unpack'].includes(CMD) || !A || !B) usage();
const stop = m => { console.error(m); process.exit(1); };

// the same small interface as persist.js's memoryFolder, over a directory
export function nodeFolder(dir){
  const abs = p => path.join(dir, ...p.split('/'));
  return {
    name: path.basename(path.resolve(dir)),
    async read(p){ try { return fs.readFileSync(abs(p), 'utf8'); } catch { return null; } },
    async list(sub){
      try { return fs.readdirSync(abs(sub), { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name).sort(); } catch { return []; }
    },
    async write(p, text){ fs.mkdirSync(path.dirname(abs(p)), { recursive: true }); fs.writeFileSync(abs(p), text); },
    async permission(){ return 'granted'; },
    async remove(p){ try { fs.rmSync(abs(p)); } catch { /* already gone */ } },
  };
}

export async function pack(dataDir, out, { force = false, saved = new Date().toISOString() } = {}){
  if (fs.existsSync(out) && !force) throw new Error(`${out} exists; pass --force to replace it`);
  const got = await readFolder(nodeFolder(dataDir));
  if (!got) throw new Error(`${dataDir} has no resume-data.json`);
  for (const w of got.warnings) console.error(`warning: ${w}`);
  for (const n of got.skipped) console.error(`skipped recipes/${n}: it is a copy a sync tool made after a conflict`);
  ensureRecordId(got.state.record);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(makeBackup(got.state, { saved }), null, 2) + '\n');
  return { resumes: got.state.resumes.length, skipped: got.skipped };
}

export async function unpack(file, dataDir, { force = false } = {}){
  const { state, warnings } = readBackup(JSON.parse(fs.readFileSync(file, 'utf8')));
  for (const w of warnings) console.error(`warning: ${w}`);
  if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length && !force) throw new Error(`${dataDir} is not empty; pass --force to write into it`);
  const files = filesOf(state);
  const folder = nodeFolder(dataDir);
  for (const [p, text] of files){
    if (!force && fs.existsSync(path.join(dataDir, ...p.split('/')))) throw new Error(`${p} exists; pass --force to replace it`);
    await folder.write(p, text);
  }
  return { files: [...files.keys()] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  try {
    if (CMD === 'pack'){
      const r = await pack(A, B, { force: FORCE });
      console.log(`packed ${A} into ${B}: the record and ${r.resumes} saved resume${r.resumes === 1 ? '' : 's'}${r.skipped.length ? `; skipped ${r.skipped.length} conflict cop${r.skipped.length === 1 ? 'y' : 'ies'}` : ''}`);
    } else {
      const r = await unpack(A, B, { force: FORCE });
      console.log(`unpacked ${A} into ${B}: ${r.files.length} files`);
    }
  } catch (e){ stop(e.message); }
}
