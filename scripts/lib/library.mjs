// Library and resume file I/O through src/model/schema.js, so scripts see the
// same records as the app. Every write is resume-data/4.

import fs from 'node:fs';
import path from 'node:path';
import { load, save, serialize, loadResume, saveResume, detect } from '../../src/model/schema.js';

export const readJson = f => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e){ throw new Error(`${f}: not readable as JSON: ${e.message}`); }
};

// A record file, or the one file (the app's backup, resumeBuilderBackup: 1), whose record is read.
// kind is the file's kind before loading; saved is the one file's date.
export function readLibrary(file){
  const json = readJson(file);
  const kind = detect(json);
  if (kind === 'backup') return { ...load(json.record ?? {}), kind, saved: json.saved ?? null };
  return { ...load(json), kind };
}

export function readRecipe(file, model = null){
  const json = readJson(file);
  return { ...loadResume(json, model), kind: detect(json) };
}

// The first time a v3 file is overwritten, it is kept as <name>.v3.json.
export function writeLibrary(file, model){
  if (fs.existsSync(file)){
    let kind = 'unknown';
    try { kind = detect(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch {}
    const keep = file.replace(/\.json$/, '') + '.v3.json';
    if (kind === 'library-v3' && !fs.existsSync(keep)){
      fs.copyFileSync(file, keep);
      console.error(`kept the resume-data/3 original as ${path.basename(keep)}`);
    }
  }
  fs.writeFileSync(file, serialize(save(model)));
}

// Returns the ATS-export problems.
export function writeResume(file, model, recipe){
  const { file: json, problems } = saveResume(model, recipe);
  fs.writeFileSync(file, serialize(json));
  return problems;
}
