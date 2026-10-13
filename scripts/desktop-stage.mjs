#!/usr/bin/env node
// node scripts/desktop-stage.mjs
// The app has no build step, so the desktop build (Tauri's frontendDist) is a copy of exactly the files the app
// loads, in the gitignored _desktop/. Every copied name is normalised to Unicode NFC: a Mac can keep a name decomposed
// on disk, and Tauri then cannot find the file the page asks for. checks/desktop-check.mjs keeps the list below whole.
// index.html is the one file changed on the way: the desktop build's Content-Security-Policy also allows Tauri's IPC.
// sw.js is left out: service workers cannot register on tauri://.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const OUT = path.join(ROOT, '_desktop');
export const DIRS = ['src', 'fonts', 'icons', 'themes', 'formats', 'templates', 'data', 'desktop'];
// the one module the app imports from outside src/ (found by walking the import graph; the check re-walks it)
export const FILES = ['index.html', 'manifest.webmanifest', 'scripts/lib/html.mjs'];
// connect-src stays 'self' in the web build; only this staged copy adds the desktop IPC schemes
export const IPC = "connect-src 'self' ipc: http://ipc.localhost";

const nfc = rel => rel.split('/').map(s => s.normalize('NFC')).join('/');

function put(rel, data){
  const to = path.join(OUT, nfc(rel));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, data);
}

function* walk(dir){
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })){
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) yield* walk(rel); else yield rel;
  }
}

export function stage(){
  fs.rmSync(OUT, { recursive: true, force: true });
  const files = [...FILES, ...DIRS.flatMap(d => [...walk(d)])].filter(f => f !== '.DS_Store' && !f.endsWith('/.DS_Store'));
  for (const f of files){
    let data = fs.readFileSync(path.join(ROOT, f));
    if (f === 'index.html'){
      const html = data.toString('utf8');
      if (!html.includes("connect-src 'self'")) throw new Error("index.html: no connect-src 'self' to extend");
      data = html.replace("connect-src 'self'", IPC);
    }
    put(f, data);
  }
  return files.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`staged ${stage()} files in _desktop/`);
