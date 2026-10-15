#!/usr/bin/env node
// node checks/run-check.mjs
// The check map and the parallel smoke runner: glob matching, the plan (unknown paths run everything), that every check file is in
// the map, the smoke section list against smoke-shell.mjs, the shards (every section once), and the merge of canned worker output.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob, plan } from './run.mjs';
import { readSections, units, shard, merge } from './smoke-parallel.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'check-map.json'), 'utf8'));
const src = fs.readFileSync(path.join(ROOT, 'checks', 'smoke-shell.mjs'), 'utf8');
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);

section('globs');
ok('** crosses folders, * stays in one', glob('src/**').test('src/ui/a.js') && glob('src/*.js').test('src/a.js') && !glob('src/*.js').test('src/ui/a.js'));
ok('a dot is a dot', !glob('a.js').test('abjs') && glob('src/ui/drink*.js').test('src/ui/drink-boot.js'));
ok('** alone is every path', glob('**').test('anything/at/all.x') && glob('**').test('x'));

section('the map');
const titles = readSections(src).map(s => s.title);
const names = Object.keys(map.checks);
const files = fs.readdirSync(path.join(ROOT, 'checks')).filter(f => /-check\.mjs$/.test(f) || f === 'label-fit.mjs');
const known = [...Object.values(map.checks), ...Object.values(map.browser)].map(c => c.run);
ok('every check file is in the map (a new one must be added)', files.every(f => known.some(r => r.includes('checks/' + f))), files.filter(f => !known.some(r => r.includes('checks/' + f))).join(' '));
ok('every command in the map names a file that exists', known.every(r => r.split(' ').filter(w => /\.(mjs|json)$/.test(w)).every(w => w === '/dev/null' || fs.existsSync(path.join(ROOT, w)))));
ok('every rule names checks and smoke pieces that exist', map.rules.every(r => r.checks.every(c => c === '*' || map.checks[c]) && (r.browser ?? []).every(b => map.browser[b]) && r.smoke.every(s => s === '*' || titles.some(t => t.includes(s)))), 'a typo in check-map.json');
ok('the last rule is the catch-all with everything', map.rules.at(-1).match[0] === '**' && map.rules.at(-1).smoke[0] === '*' && map.rules.at(-1).checks[0] === '*');

section('the plan');
const all = plan(['something/new.xyz'], map, titles);
ok('an unknown path runs every check, every browser check and every section', all.checks.length === names.length && all.browser.length === Object.keys(map.browser).length && all.smoke[0] === '*');
ok('only docs: nothing runs', (p => !p.checks.length && !p.browser.length && !p.smoke.length)(plan(['docs/DEVELOPMENT.md', 'README.md'], map, titles)));
const model = plan(['src/model/career.js'], map, titles);
ok('the model: every Node check, no browser check, some sections', model.checks.length === names.length && !model.browser.length && model.smoke.length > 0 && model.smoke.length < titles.length);
const onpage = plan(['src/ui/onpage.js'], map, titles);
ok('onpage.js: room-check and the on-the-page sections', onpage.browser.includes('room-check') && onpage.smoke.some(t => t.startsWith('on the page:')));
ok('a changed check runs itself', plan(['checks/room-check.mjs'], map, titles).browser.join() === 'room-check' && plan(['checks/edit-check.mjs'], map, titles).checks.join() === 'edit');
ok('one unknown file among known ones still runs everything', plan(['docs/a.md', 'mystery.bin'], map, titles).smoke[0] === '*');

section('the smoke runner');
ok('it finds every section the smoke file asks for', titles.length === (src.match(/\bwant\('/g) ?? []).length - 0 && titles.length > 40, `${titles.length} found`);
const us = units(readSections(src));
for (const n of [1, 3, 4, 7]){
  const sh = shard(us, n), got = sh.flatMap(s => s.titles).sort();
  ok(`${n} worker(s): every section exactly once`, got.join('|') === [...titles].sort().join('|'));
  const only = sh.map(s => s.tokens);
  ok(`${n} worker(s): a shard's ONLY filter matches its own sections and no other`, sh.every((s, i) => titles.filter(t => only[i].some(o => t.includes(o))).sort().join('|') === [...s.titles].sort().join('|')));
}
const sh4 = shard(us, 4);
ok('four shards are balanced to within 15 percent', Math.max(...sh4.map(s => s.weight)) < Math.min(...sh4.map(s => s.weight)) * 1.15);

section('the merge');
const canned = '\n— one\nPASS  a\nPASS  b\n\n— two\nPASS  c\nFAIL  d  — why\n\n1 shell check(s) FAILED\n';
const m = merge(canned, { code: 1 }, ['one', 'two']);
ok('counts PASS and puts the section on each FAIL line', m.pass === 3 && m.fails.length === 1 && m.fails[0] === 'two => FAIL  d  — why' && !m.problems.length);
ok('a crash with no FAIL line is a problem', merge('— one\nPASS  a\nError: x\nNode.js v24.0.0\n', { code: 1 }, ['one']).problems.length === 2);
ok('a timeout is a problem', merge('— one\nPASS  a\n', { code: null, signal: 'SIGKILL', timedOut: true }, ['one']).problems[0] === 'timed out');
ok('a section that never printed is a problem even at exit 0', merge('— one\nPASS  a\n', { code: 0 }, ['one', 'two']).problems[0] === 'never ran: two');
ok('a clean worker has none', merge('— one\nPASS  a\n', { code: 0 }, ['one']).problems.length === 0);

console.log(failed ? `\n${failed} runner check(s) FAILED` : '\nall runner checks passed');
process.exit(failed ? 1 : 0);
