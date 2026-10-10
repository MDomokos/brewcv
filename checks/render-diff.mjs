#!/usr/bin/env node
// node checks/render-diff.mjs <generated.html> <reference.html>
// Compares the rendered document with a hand-written reference as parsed trees and names the node that
// differs. Only whitespace the browser collapses is forgiven. {{email}}, {{phone}} and {{city}} in the
// reference are filled from data/identity.local.json.

import fs from 'node:fs';
import { parse } from '../scripts/lib/html.mjs';
import { fillIdentity } from '../scripts/lib/identity.mjs';

const [GEN, REF] = process.argv.slice(2);
if (!GEN || !REF){
  console.error('usage: node checks/render-diff.mjs <generated.html> <reference.html>');
  process.exit(2);
}

const INLINE = new Set(['a', 'span', 'strong', 'em', 'b', 'i', 'br', 'code', 'img']);

// Drop indentation whitespace. A whitespace-only text node is invisible between blocks and after a <br>;
// between two other inline elements it prints as a space, so dropping one there is reported.
const suspect = [];
function clean(node, path = ''){
  const kids = (node.children ?? []).filter((c, n, all) => {
    if (c.tag !== '#text' || !/^\s*$/.test(c.raw)) return true;
    const near = [all[n - 1], all[n + 1]].filter(Boolean);
    // at the start or the end of its parent it is stripped either way
    if (near.length === 2 && near.every(s => s.tag !== 'br' && (INLINE.has(s.tag) || (s.tag === '#text' && !/^\s*$/.test(s.raw)))))
      suspect.push(`${path} > ${node.tag}: dropped ${JSON.stringify(c.raw)} between inline content`);
    return false;
  });
  // the browser removes collapsible space at the start and end of a block
  if (!INLINE.has(node.tag) && kids.length){
    const first = kids[0], last = kids[kids.length - 1];
    if (first.tag === '#text') first.raw = first.raw.replace(/^\s+/, '');
    if (last.tag === '#text') last.raw = last.raw.replace(/\s+$/, '');
  }
  return { tag: node.tag, attrs: node.attrs ?? {}, raw: node.raw,
           children: kids.filter(c => c.tag !== '#text' || c.raw !== '')
                          .map(c => clean(c, `${path} > ${node.tag}`)) };
}

const load = (f, fill) => clean(parse(fill ? fillIdentity(fs.readFileSync(f, 'utf8')) : fs.readFileSync(f, 'utf8')));

// from .document down: the <head> belongs to the template, not the renderer
function documentRoot(node){
  if (node.attrs?.class?.split(/\s+/).includes('document')) return node;
  for (const c of node.children ?? []){ const f = documentRoot(c); if (f) return f; }
  return null;
}

const a = documentRoot(load(GEN, false));
const b = documentRoot(load(REF, true));
if (!a || !b){ console.error('no .document in ' + (a ? REF : GEN)); process.exit(2); }

const diffs = [];
const where = (p, n) => `${p} > ${n.tag}${n.attrs?.class ? `.${n.attrs.class.split(/\s+/).join('.')}` : ''}`;

function walk(x, y, path){
  if (diffs.length > 20) return;
  if (x.tag !== y.tag) return diffs.push([path, `tag ${x.tag} vs ${y.tag}`]);
  if (x.tag === '#text'){
    if (x.raw !== y.raw) diffs.push([path, `text\n    generated: ${JSON.stringify(x.raw)}\n    reference: ${JSON.stringify(y.raw)}`]);
    return;
  }
  const ka = Object.keys(x.attrs), kb = Object.keys(y.attrs);
  for (const k of new Set([...ka, ...kb]))
    if (x.attrs[k] !== y.attrs[k])
      diffs.push([where(path, x), `@${k}\n    generated: ${JSON.stringify(x.attrs[k] ?? null)}\n    reference: ${JSON.stringify(y.attrs[k] ?? null)}`]);
  if (x.children.length !== y.children.length){
    diffs.push([where(path, x), `${x.children.length} children vs ${y.children.length}`
      + `\n    generated: ${x.children.map(c => c.tag).join(' ')}`
      + `\n    reference: ${y.children.map(c => c.tag).join(' ')}`]);
    return;
  }
  x.children.forEach((c, n) => walk(c, y.children[n], where(path, x)));
}
walk(a, b, '');

const label = f => f.replace(/^.*\//, '');
if (suspect.length){
  console.error(`\nrender-diff: ${suspect.length} whitespace node(s) dropped where a space would have been visible:`);
  for (const s of suspect) console.error(`  ${s}`);
  process.exit(1);
}
if (!diffs.length){
  console.log(`render-diff: ${label(GEN)} is identical to ${label(REF)}: every tag, attribute and character.`);
  process.exit(0);
}
console.error(`\nrender-diff: ${diffs.length} difference${diffs.length === 1 ? '' : 's'}: ${label(GEN)} vs ${label(REF)}\n`);
for (const [p, d] of diffs.slice(0, 20)) console.error(`  ${p}\n    ${d}\n`);
process.exit(1);
