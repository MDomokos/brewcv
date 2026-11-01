#!/usr/bin/env node
// node checks/folder-sync-check.mjs
// The linked folder as the resume space (src/store/space.js, and the device file in src/store/persist.js): two devices, each a store and a backend of its own, share one folder
// (two memoryFolders on one file map). Each edits alone and they meet; a conflict copy, a file edited, moved, renamed or deleted outside, a half-written file, an older folder,
// Organise, the Inbox, the sweep of Deleted/ and two windows are played in turn (checks/lib/space-scenarios.mjs, which checks/tauri-folder-check.mjs plays on the desktop folder too).
// Fictional data only (data/example.json, its example resumes and the committed import fixtures).

import { memoryFolder, safe, ignored, conflictCopy } from '../src/store/persist.js';
import { libraryName } from '../src/store/space.js';
import { scenarios } from './lib/space-scenarios.mjs';

let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);

section('what the folder ignores, and the names it makes');
{
  ok('the temp and lock files of sync tools and office programs are ignored', ['.syncthing.x.json.tmp', '~$Resume.docx', '.~lock.Resume.odt#', 'a.tmp', '.DS_Store', '@eaDir', '#recycle', '.stfolder', '.stversions'].every(ignored) && !ignored('Resume.docx') && !ignored('recipes/Acme.json'));
  ok('Synology Drive’s conflict copy is recognised beside the others', conflictCopy('resume-data_MacBook_Oct-13-1423-2026_FileConflict.json') === 'Synology Drive' && conflictCopy('x.sync-conflict-20261001-120000-ABCDEFG.json') === 'Syncthing' && conflictCopy('a (conflicted copy).json') === 'Dropbox' && conflictCopy('resume-data 2.json') === 'iCloud' && conflictCopy('Acme.json') === null);
  const bad = 'a\\b/c:d*e?f"g<h>i|j#k^l[m]n';
  ok('a safe name has none of \\ / : * ? " < > | # ^ [ ]', !/[\\/:*?"<>|#^[\]]/.test(safe(bad)), safe(bad));
  ok('…is NFC, at most 120 characters, with no trailing dot or space', safe('é'.repeat(200)) === safe('é'.repeat(200)).normalize('NFC') && safe('x'.repeat(300)).length === 120 && !/[. ]$/.test(safe('name. . ')) && safe('...') === 'checkpoint' && safe('', 'device') === 'device');
  ok('the standard name of a library file: date, company, role, a language that is not English', libraryName({ date: '2024-03-12', company: 'Acme', role: 'Product Designer', ext: '.pdf' }) === '2024-03-12 Acme - Product Designer.pdf' && libraryName({ date: '2024-03-12', company: 'Acme', role: 'Product Designer', lang: 'hu', ext: '.pdf' }) === '2024-03-12 Acme - Product Designer (hu).pdf' && libraryName({ stem: '2020-01-01 Old name', ext: '.pdf', date: '2024-01-01' }) === '2020-01-01 Old name.pdf');
}


// one storage, a folder object for each device
const make = () => { const fx = new Map(); return { fx, root: () => memoryFolder(fx) }; };
await scenarios({ ok, section, make });

console.log(failed ? `\n${failed} folder-sync check(s) FAILED` : '\nall folder-sync checks passed');
process.exit(failed ? 1 : 0);
