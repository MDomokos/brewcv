#!/usr/bin/env node
// node checks/smoke-parallel.mjs [--workers N] [--only text]... [--list] [--log file] [--timeout minutes] [--port first-port]
// checks/smoke-shell.mjs split into shards that run side by side, one process and one port pair each, and one merged result.
// The section titles are read from smoke-shell.mjs itself; each worker gets them through the runner's own ONLY filter.
// --only text (repeatable) keeps the sections whose title has that text. --log writes every worker's raw output to a file.
// Default workers: the cores, at most 4. Ports start at 8201, or at --port N (two each: PORT and PORT+1), and a taken pair is skipped.
// Exit 1 when any check failed, a worker crashed or timed out, or a section never ran.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SMOKE = path.join(ROOT, 'checks', 'smoke-shell.mjs');

// The sections, in file order, each with a weight in seconds: about 0.4 s a line, except a section measured alone (this one waits).
const MEASURED = { 'on the page: the chip on the frame, at four sizes': 300 };
export function readSections(src){
  const found = [...src.matchAll(/\bwant\('((?:[^'\\\n]|\\.)*)'\)/g)].map(m => ({ title: m[1], at: m.index }));
  return found.map((s, i) => ({ title: s.title, weight: MEASURED[s.title] ?? 0.4 * src.slice(s.at, found[i + 1]?.at ?? src.length).split('\n').length }));
}

// ONLY is split at commas and matches by substring, so a title is asked for by its longest piece without a comma. A piece that
// other titles contain brings those titles too ('export' is in a longer title), so they stay in one shard: no section runs twice.
export function units(sections){
  const token = t => t.split(',').map(s => s.trim()).sort((a, b) => b.length - a.length)[0];
  const parent = sections.map((_, i) => i);
  const root = i => parent[i] === i ? i : (parent[i] = root(parent[i]));
  sections.forEach((s, i) => sections.forEach((o, j) => { if (o.title.includes(token(s.title))) parent[root(i)] = root(j); }));
  const by = new Map();
  sections.forEach((s, i) => { const r = root(i); if (!by.has(r)) by.set(r, { tokens: [], titles: [], weight: 0 }); const u = by.get(r); u.tokens.push(token(s.title)); u.titles.push(s.title); u.weight += s.weight; });
  return [...by.values()];
}

// Heaviest unit first, each onto the lightest shard.
export function shard(us, n){
  const shards = Array.from({ length: Math.max(1, Math.min(n, us.length)) }, () => ({ tokens: [], titles: [], weight: 0 }));
  for (const u of [...us].sort((a, b) => b.weight - a.weight)){
    const s = shards.reduce((a, b) => b.weight < a.weight ? b : a);
    s.tokens.push(...u.tokens); s.titles.push(...u.titles); s.weight += u.weight;
  }
  return shards;
}

// One worker's output (and how it ended) → counts, the FAIL lines with their section, and what went wrong besides a FAIL.
export function merge(out, { code, signal, timedOut }, titles){
  let section = '', pass = 0; const fails = [], seen = new Set(), problems = [];
  for (const line of out.split('\n')){
    if (line.startsWith('— ')){ section = line.slice(2); seen.add(section); }
    else if (line.startsWith('PASS')) pass++;
    else if (line.startsWith('FAIL')) fails.push(`${section} => ${line}`);
  }
  if (timedOut) problems.push('timed out');
  else if (signal) problems.push(`killed by ${signal}`);
  else if (code !== 0 && !fails.length) problems.push(`exit ${code} with no FAIL line (a crash)`);
  if (/Node\.js v\d/.test(out)) problems.push('crashed (a Node stack trace)');
  for (const t of titles) if (!seen.has(t)) problems.push(`never ran: ${t}`);
  return { pass, fails, problems };
}

const free = port => new Promise(r => { const s = net.createServer().once('error', () => r(false)).listen(port, () => s.close(() => r(true))); });
async function ports(n, from = 8201){
  const got = [];
  for (let p = from; got.length < n; p += 2) if (await free(p) && await free(p + 1)) got.push(p);
  return got;
}

async function main(){
  const a = process.argv.slice(2), val = f => a.includes(f) ? a[a.indexOf(f) + 1] : undefined;
  const only = a.flatMap((x, i) => x === '--only' ? [a[i + 1]] : []);
  const all = readSections(fs.readFileSync(SMOKE, 'utf8'));
  const sections = only.length ? all.filter(s => only.some(o => s.title.includes(o))) : all;
  if (!sections.length){ console.error('no smoke section matches ' + only.join(', ')); process.exit(1); }
  const n = Number(val('--workers') ?? Math.min(os.availableParallelism(), 4));
  const shards = shard(units(sections), n);
  if (a.includes('--list')){
    shards.forEach((s, i) => console.log(`worker ${i + 1} (weight ${s.weight}):\n  ${s.titles.join('\n  ')}`));
    return;
  }
  const timeout = Number(val('--timeout') ?? 30) * 60000, t0 = Date.now(), ps = await ports(shards.length, Number(val('--port') ?? 8201));
  const runs = shards.map((s, i) => new Promise(resolve => {
    const env = { ...process.env, ONLY: s.tokens.join(','), PORT: String(ps[i]) };
    if (!env.CHROME_PATH) env.PW_BUNDLED = '1';
    const p = spawn(process.execPath, [SMOKE], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', timedOut = false;
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, timeout);
    p.on('error', e => { out += String(e); });
    p.on('close', (code, signal) => { clearTimeout(timer); resolve({ out, ...merge(out, { code, signal, timedOut }, s.titles), code, port: ps[i], s: Math.round((Date.now() - t0) / 1000) }); });
  }));
  const results = await Promise.all(runs);
  if (val('--log')) fs.writeFileSync(val('--log'), results.map((r, i) => `##### worker ${i + 1}\n${r.out}`).join('\n'));
  results.forEach((r, i) => console.log(`worker ${i + 1} (port ${r.port}, ${shards[i].titles.length} sections): exit ${r.code}, ${r.s} s, ${r.pass} PASS, ${r.fails.length} FAIL${r.problems.length ? ', ' + r.problems.join('; ') : ''}`));
  const pass = results.reduce((s, r) => s + r.pass, 0), fails = results.flatMap(r => r.fails), problems = results.flatMap(r => r.problems);
  for (const f of fails) console.log(f);
  for (const p of problems) console.log('PROBLEM ' + p);
  console.log(`\n${pass} PASS, ${fails.length} FAIL, ${problems.length} problem(s), ${Math.round((Date.now() - t0) / 1000)} s on ${shards.length} worker(s)`);
  process.exit(fails.length || problems.length ? 1 : 0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
