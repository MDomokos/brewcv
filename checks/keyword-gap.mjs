#!/usr/bin/env node
// node checks/keyword-gap.mjs <resume-data.json> <ad.txt|->
// Lists the words in a job ad that match nothing in the library. It does not score or rewrite: a gap is
// either something not done or something the library calls by another name, and only a person can tell.

import fs from 'node:fs';
import { readLibrary } from '../scripts/lib/library.mjs';

const [dataFile, adFile] = process.argv.slice(2);
if (!dataFile || !adFile){
  console.error('usage: node checks/keyword-gap.mjs <resume-data.json> <ad.txt|->');
  process.exit(2);
}
const data = readLibrary(dataFile).model;
const ad = fs.readFileSync(adFile === '-' ? 0 : adFile, 'utf8');

const STOP = new Set(`a about above after again against all also am an and any are as at be because been
before being below between both but by can cannot could did do does doing down during each few for from
further had has have having he her here hers him his how i if in into is it its itself just me more most
my no nor not of off on once only or other our ours out over own same she should so some such than that
the their theirs them then there these they this those through to too under until up very was we were
what when where which while who whom why will with you your yours
ability able across added addition additional applicant applicants application apply are as asked
benefits candidate candidates career closely collaborate collaborative company culture day depending
deliver desirable desired detail development diverse drive employer employment ensure environment equal
essential etc excellent experience expertise familiar fast full get global good great group grow growth
help high hire including individual join知 knowledge level like look looking love make many may meet
minimum must need needs new offer office one opportunity opportunities other paced part passion people
per please plus position preferred proven provide qualifications quality relevant report require required
requirements responsibilities responsible role salary skills solutions someone strong successful support
team teams技 their think time together top track using various want we well what why within work working
world year years you`.split(/\s+/));

const bag = [];
for (const v of data.variants) bag.push(v.text, ...(v.tags ?? []));
for (const f of data.facts) bag.push(f.summary ?? '', f.label ?? '', f.term ?? '');
for (const w of data.work ?? []) bag.push(w.position, w.name, w.location ?? '');
for (const s of data.skills ?? []) bag.push(s.name, ...(s.keywords ?? []));
for (const e of data.education ?? []) bag.push(e.institution, e.studyType, e.area, e.score ?? e.honours ?? '');
for (const p of data.publications ?? []) bag.push(p.name, p.publisher ?? '', p.role ?? '', p.identifier ?? '');
for (const c of data.certificates ?? []) bag.push(c.name, c.issuer ?? '');
for (const l of data.languages ?? []) bag.push(l.language, l.fluency);
for (const i of data.interests ?? []) bag.push(i.name);
bag.push(data.basics?.label ?? '');

const norm = s => s.toLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/[^a-z0-9+#&./-]+/g, ' ');
const trim = w => w.replace(/^[.\-/]+/, '').replace(/[.\-/]+$/, '');
const stem = w => w.replace(/(?:ies)$/, 'y').replace(/(?:es|s)$/, '').replace(/(?:ing|ed)$/, '');

// index with hyphens and slashes opened out too, so "injection-moulding-ready" answers "injection moulding"
const flat = bag.map(norm).join(' ');
const haystack = ' ' + (flat + ' ' + flat.replace(/[-/]/g, ' ')).replace(/\s+/g, ' ') + ' ';
const haystemmed = new Set(haystack.trim().split(' ').map(trim).map(stem));

const has = term => {
  if (haystack.includes(` ${term} `)) return true;
  const words = term.split(' ');
  return words.every(w => haystemmed.has(stem(w)));
};

const words = norm(ad).split(/\s+/).map(trim).filter(w => w.length > 1 && !/^[0-9.+#&/-]+$/.test(w));
const freq = new Map();
const bump = t => freq.set(t, (freq.get(t) ?? 0) + 1);
words.forEach((w, n) => {
  if (!STOP.has(w)) bump(w);
  const next = words[n + 1];
  if (next && !STOP.has(w) && !STOP.has(next)) bump(`${w} ${next}`);
});

const terms = [...freq.entries()]
  .filter(([t, n]) => t.includes(' ') ? n > 1 : true)   // bigrams only if repeated
  .map(([term, n]) => ({ term, n, hit: has(term) }));

const gaps = terms.filter(t => !t.hit)
  .filter(t => !terms.some(o => o.hit && o.term !== t.term && o.term.includes(t.term)))
  .sort((a, b) => b.n - a.n || a.term.localeCompare(b.term));
const hits = terms.filter(t => t.hit).sort((a, b) => b.n - a.n || a.term.localeCompare(b.term));

// library tags the ad touches: a hint at the angle to lead with
const tagHits = new Map();
for (const v of data.variants) for (const t of v.tags ?? [])
  if (terms.some(x => x.hit && (x.term === t || t.includes(x.term)))) tagHits.set(t, (tagHits.get(t) ?? 0) + 1);

const pct = terms.length ? Math.round(100 * hits.length / terms.length) : 0;
console.log(`\n${adFile === '-' ? 'stdin' : adFile}: ${terms.length} terms, ${hits.length} matched (${pct}%), ${gaps.length} gaps\n`);

console.log(`gaps (nothing in the library uses these words):`);
for (const g of gaps.slice(0, 40)) console.log(`  ${String(g.n).padStart(2)}×  ${g.term}`);
if (gaps.length > 40) console.log(`  … and ${gaps.length - 40} more`);

console.log(`\nmatched, most-repeated first:`);
for (const h of hits.slice(0, 20)) console.log(`  ${String(h.n).padStart(2)}×  ${h.term}`);

if (tagHits.size){
  console.log(`\nlibrary tags the ad touches:`);
  for (const [t, n] of [...tagHits].sort((a, b) => b[1] - a[1]).slice(0, 10))
    console.log(`  ${String(n).padStart(2)} variants  ${t}`);
}
console.log(`\nA gap is either something he hasn't done, or something the library calls`);
console.log(`by another name. Only the second one is worth writing a variant for.`);
