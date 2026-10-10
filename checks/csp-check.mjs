#!/usr/bin/env node
// node checks/csp-check.mjs
// The browser-enforced half of "nothing is uploaded": the app and the templates carry a
// Content-Security-Policy that keeps every request on the app's own address.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? `  — ${extra}` : ''}`); if (!cond) failed++; };
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const policyOf = html => {
  const m = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*>/i.exec(html);
  if (!m) return null;
  return Object.fromEntries(m[1].split(';').map(d => d.trim()).filter(Boolean).map(d => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));
};
const only = v => v && v.length === 1 && v[0] === "'self'";
const remote = v => (v ?? []).filter(x => /^(https?:|\*|wss?:)/.test(x) || x === "'unsafe-eval'");

const html = read('index.html');
const p = policyOf(html);
ok('index.html has a Content-Security-Policy meta tag', !!p);
if (p){
  ok("connect-src is 'self' only", only(p['connect-src']));
  ok("default-src is 'self'", only(p['default-src']));
  ok("form-action is 'none'", (p['form-action'] ?? []).join() === "'none'");
  ok("base-uri is 'self' and object-src is 'none'", only(p['base-uri']) && (p['object-src'] ?? []).join() === "'none'");
  ok('no directive names another host, a wildcard or eval', Object.values(p).every(v => remote(v).length === 0));
  ok("script-src is 'self' only (no inline script, no eval)", only(p['script-src']));
  const head = html.slice(0, html.indexOf('</head>'));
  const firstScript = head.search(/<script\b|<link\b/i);
  ok('the tag comes before any script or stylesheet', html.indexOf('Content-Security-Policy') < firstScript);
}

const noInline = html.replace(/<!--[\s\S]*?-->/g, '').match(/<script\b(?![^>]*\bsrc=)[^>]*>/g) ?? [];
ok('index.html has no inline script, which the policy would refuse', noInline.length === 0, `${noInline.length} found`);

for (const f of fs.readdirSync(path.join(ROOT, 'templates')).filter(x => x.endsWith('.html'))){
  const q = policyOf(read(`templates/${f}`));
  ok(`templates/${f}: has a policy that allows no connections and no scripts`, !!q && (q['default-src'] ?? []).join() === "'none'" && !q['connect-src'] && !q['script-src']);
  ok(`templates/${f}: nothing but its own files and data: URLs`, !!q && Object.entries(q).every(([k, v]) => k === 'default-src' || v.every(x => /^('self'|'none'|'unsafe-inline'|data:)$/.test(x))));
}

// What the code does with the network: same-origin fetches only.
const walk = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const js = [...walk('src'), 'sw.js'].filter(f => f.endsWith('.js') && !f.startsWith('src/i18n'));
const offenders = js.flatMap(f => [...read(f).matchAll(/\bfetch\(\s*([^)]*)\)/g)].map(m => [f, m[1]]))
  .filter(([, a]) => /https?:\/\//.test(a));
ok('no fetch() in the app names an outside address', offenders.length === 0, offenders.map(o => o.join(': ')).join('; '));
ok('nothing in the app uses sendBeacon, WebSocket, EventSource or XMLHttpRequest', !js.some(f => /\b(sendBeacon|WebSocket|EventSource|XMLHttpRequest)\b/.test(read(f))));

const shell = read('src/ui/shell.js');
ok("the menu links to docs/PRIVACY.md under priv.link, opening in a new tab without the opener", /href="\$\{SOURCE_URL\}\/blob\/main\/docs\/PRIVACY\.md" target="_blank" rel="noopener">\$\{h\('priv\.link'\)\}/.test(shell));
ok('every catalogue has priv.link', ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'hu'].every(l => /^  'priv\.link': '[^']+',$/m.test(read(`src/i18n/${l}.js`))));
ok('docs/PRIVACY.md exists', fs.existsSync(path.join(ROOT, 'docs/PRIVACY.md')));

console.log(failed ? `\n${failed} FAILED` : '\nAll CSP checks pass.');
process.exit(failed ? 1 : 0);
