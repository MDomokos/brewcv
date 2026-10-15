#!/usr/bin/env node
// node checks/run.mjs                    every Node check (they are independent: run side by side), one summary
// node checks/run.mjs --changed          only the checks the map (checks/check-map.json) names for the files changed since HEAD, plus untracked
// node checks/run.mjs --since <ref>      the same against another ref
// node checks/run.mjs --changed --list   the plan only
// The browser checks and smoke sections a plan names run after the Node ones (smoke through checks/smoke-parallel.mjs).
// The last line is ALL CHECKS PASSED or N CHECKS FAILED: names. Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readSections } from './smoke-parallel.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'check-map.json'), 'utf8'));

export const glob = g => new RegExp('^' + g.split(/(\*\*\/?|\*)/).map(x => x === '**/' ? '(.*/)?' : x === '**' ? '.*' : x === '*' ? '[^/]*' : x.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('') + '$');

// Files → { checks, browser, smoke } as sets of names. The first rule that matches a file decides for it; a file no rule matches
// runs everything; a changed check also runs itself.
export function plan(files, map = MAP, titles = []){
  const node = Object.keys(map.checks), out = { checks: new Set(), browser: new Set(), smoke: new Set() };
  const everything = () => { node.forEach(c => out.checks.add(c)); Object.keys(map.browser).forEach(c => out.browser.add(c)); titles.forEach(t => out.smoke.add(t)); out.smoke.add('*'); };
  for (const f of files){
    const rule = map.rules.find(r => r.match.some(g => glob(g).test(f)));
    if (!rule){ everything(); continue; }
    for (const c of rule.checks) c === '*' ? node.forEach(n => out.checks.add(n)) : out.checks.add(c);
    for (const b of rule.browser ?? []) out.browser.add(b);
    for (const s of rule.smoke) out.smoke.add(s);
    for (const [n, c] of Object.entries({ ...map.checks, ...map.browser })) if (c.run.split(' ').includes(f)) (map.checks[n] ? out.checks : out.browser).add(n);
  }
  const hits = [...out.smoke].flatMap(s => s === '*' ? titles : titles.filter(t => t.includes(s)));
  return { checks: [...out.checks].filter(c => map.checks[c]), browser: [...out.browser], smoke: out.smoke.has('*') ? ['*'] : [...new Set(hits)] };
}

const changedFiles = ref => {
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  return [...new Set([...git('diff', '--name-only', ref), ...git('ls-files', '--others', '--exclude-standard')])];
};

const { ONLY: _, ...ENV } = process.env;       // ONLY is the smoke and head-check filter: no child should inherit it
const run = (args, env = {}) => new Promise(resolve => {
  const t0 = Date.now();
  const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...ENV, ...env } });
  let out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  p.on('error', e => { out += String(e); });
  p.on('close', code => resolve({ code, out, s: (Date.now() - t0) / 1000 }));
});

const detail = out => {
  const lines = out.split('\n').filter(Boolean), bad = lines.filter(l => /^FAIL|Error|FAILED/.test(l));
  return (bad.length ? bad : lines.slice(-8)).slice(0, 20).map(l => '    ' + l).join('\n');
};

async function main(){
  const a = process.argv.slice(2), since = a.includes('--since') ? a[a.indexOf('--since') + 1] : a.includes('--changed') ? 'HEAD' : null;
  let names = Object.keys(MAP.checks), browser = [], smoke = [];
  if (since){
    const files = changedFiles(since), p = plan(files, MAP, readSections(fs.readFileSync(path.join(ROOT, 'checks', 'smoke-shell.mjs'), 'utf8')).map(s => s.title));
    console.log(`${files.length} changed file(s)\nchecks:  ${p.checks.length === names.length ? 'all ' + names.length : p.checks.join(' ') || 'none'}\nbrowser: ${p.browser.join(' ') || 'none'}\nsmoke:   ${p.smoke[0] === '*' ? 'all sections' : p.smoke.length + ' section(s)'}${p.smoke[0] === '*' ? '' : p.smoke.map(t => '\n  ' + t).join('')}`);
    if (a.includes('--list')) return;
    ({ checks: names, browser, smoke } = p);
  }
  const failed = [], results = [];
  const queue = names.map(n => [n, MAP.checks[n].run.split(' ').slice(1)]);
  await Promise.all(Array.from({ length: Math.min(os.availableParallelism(), queue.length) }, async () => {
    for (let q; (q = queue.shift());){
      const r = await run(q[1]); results.push({ name: q[0], ...r });
    }
  }));
  const line = (name, ok, s) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(18)} ${s.toFixed(1)}s`);
  const show = r => { line(r.name, r.code === 0, r.s); if (r.code !== 0){ failed.push(r.name); console.log(detail(r.out)); } };
  names.forEach(n => show(results.find(r => r.name === n)));
  const env = process.env.CHROME_PATH ? {} : { PW_BUNDLED: '1' };
  let port = 8281;
  for (const b of browser){ const r = await run(MAP.browser[b].run.split(' ').slice(1), { ...env, PORT: String(port) }); port += 2; show({ name: b, ...r }); }
  if (smoke.length){
    const r = await run(['checks/smoke-parallel.mjs', ...(smoke[0] === '*' ? [] : smoke.flatMap(s => ['--only', s]))]);
    line('smoke', r.code === 0, r.s); if (r.code !== 0){ failed.push('smoke'); console.log(r.out.split('\n').filter(l => /FAIL|PROBLEM|worker/.test(l)).map(l => '    ' + l).join('\n')); }
  }
  console.log(failed.length ? `${failed.length} CHECKS FAILED: ${failed.join(' ')}` : 'ALL CHECKS PASSED');
  process.exit(failed.length ? 1 : 0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
