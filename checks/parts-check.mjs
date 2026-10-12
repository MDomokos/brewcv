#!/usr/bin/env node
// node checks/parts-check.mjs            compare
// node checks/parts-check.mjs --write    record the snapshot (only when the markup is meant to change)
// One panel for a claim, opened from the page or from the record checklist.
// The panel's views are pure strings. checks/fixtures/edit-markup.snapshot.json holds every view in
// every editor state, so code moved into src/ui/parts.js must leave them byte-identical.
// The parity sections (checks/parts-check.parity.mjs) open the same claim both ways and check the Details fold.
// Fictional data only; nothing is written but, with --write, the snapshot.

import fs from 'node:fs';
import path from 'node:path';
import { makeUi, dom, REPO } from './lib/ui-harness.mjs';
import * as R from '../src/model/record.js';
import * as T from '../src/model/resume.js';

const SNAP = path.join(REPO, 'checks/fixtures/edit-markup.snapshot.json');
const WRITE = process.argv.includes('--write');
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);
const vals = x => x;

// Added to, or taken out of, the Resume on purpose since the snapshot, so left out before comparing: 🗑 in a
// claim's header, "+ Add something you did" under a job's claims, "Esc goes back" in the keys line, Archive
// beside 🗑; and, in the one-screen rework (UX-2), the hint paragraphs (keys, drag, versions), the "From
// Career …" lines and the sort-of-duplicate "Title and meta line" rows.
const M10_ADDS = html => String(html)
  .replace(/<button class="ghost sm" data-act="delete-claim"[^>]*>(?:🗑|<svg class="ico"[^>]*>.*?<\/svg>)<\/button>/g, '')
  .replace(/<button class="ghost sm" data-act="(?:un)?archive-claim"[^>]*>[^<]*<\/button>/g, '')
  .replace(', <kbd>Esc</kbd> goes back', '')
  .replace(/\n\s*<label class="field addclaim">[\s\S]*?<\/label>/g, '')
  .replace(/\s*<p class="note">[^<]*(?:<kbd>[^<]*<\/kbd>[^<]*)*<\/p>/g, '')
  .replace(/\s*<div class="from">[\s\S]*?<\/div>/g, '');

async function resumeSnapshot(){
  const out = {};
  const put = (name, html) => { out[name] = html; };

  for (const [tag, opts] of [['en', { resume: 0 }], ['hu', { resume: 2 }], ['de', { resume: 6 }], ['pl', { resume: 0, lang: 'pl' }]]){
    const u = await makeUi(opts);
    const w = u.work();
    const ix = u.ctx.ix();
    const job = w.work[0];
    const bullets = job.highlights;
    const view = (sel, name) => put(`${tag}/${name}`, sel.kind === 'bullet' ? u.edit.bulletView(sel) : sel.kind === 'job' ? u.edit.jobView(sel) : sel.kind === 'section' ? u.edit.sectionView(sel) : u.edit.homeView());

    view({ kind: 'none' }, 'home');
    for (const sid of ['experience', 'summary', 'skills', 'education', 'languages', 'interests', 'projects', 'certified']) if (ix.sections.has(sid)) view({ kind: 'section', id: sid }, `section-${sid}`);
    view({ kind: 'job', id: job.id }, 'job');
    if (w.work[1]) view({ kind: 'job', id: w.work[1].id }, 'job-2');

    bullets.forEach((id, i) => view({ kind: 'bullet', id, job: job.id, section: 'experience' }, `bullet-${i}`));
    const b0 = { kind: 'bullet', id: bullets[0], job: job.id, section: 'experience' };

    if (w.basics?.summary) view({ kind: 'bullet', id: w.basics.summary, section: 'summary' }, 'summary-bullet');
    if (w.basics?.display?.label) view({ kind: 'bullet', id: w.basics.display.label, section: 'header' }, 'header-fact');
    if (w.work[0].display?.position) view({ kind: 'bullet', id: w.work[0].display.position, owner: job.id, section: 'experience' }, 'job-title-fact');
    const skill = (ix.sections.get('skills')?.content ? Object.values(ix.sections.get('skills').content).flat().find(x => typeof x === 'string' && ix.facts.has(x)) : null);
    if (skill) view({ kind: 'bullet', id: skill, section: 'skills' }, 'skills-fact');

    if (tag === 'hu' || tag === 'de'){
      const gone = w.facts.find(f => !R.versionsIn(w, f.id, tag).length && T.jobOfFact(w, f.id));
      if (gone){
        const j = T.jobOfFact(w, gone.id);
        view({ kind: 'bullet', id: gone.id, job: j.id, section: 'experience' }, 'missing-writein');
        view({ kind: 'job', id: j.id }, 'missing-job');
        u.store.commit(d => { d.record.same = [...(d.record.same ?? []), `fact:${gone.id}`]; }, 'seed');
        view({ kind: 'bullet', id: gone.id, job: j.id, section: 'experience' }, 'missing-same');
      }
    }

    if (tag !== 'en') continue;

    const many = bullets.find(id => R.versionsIn(w, id, 'en').length >= 2) ?? bullets[0];
    const sel = { kind: 'bullet', id: many, job: job.id, section: 'experience' };
    u.select(sel);
    view(sel, 'many');
    const vs = R.versionsIn(w, many, 'en');
    // a minor version, so the fold has something to fold
    u.store.commit(d => { R.addVersion(d.record, many, { text: 'A minor rewording of the first version.', from: vs[0].id, as: 'minor' }); }, 'seed');
    view(sel, 'many-minor-folded');
    await u.click('unfold', { m: R.major(vs[0].n) });
    view(sel, 'many-minor-open');
    const cmp = R.versionsIn(u.work(), many, 'en').find(v => v.id !== u.ctx.chooseVariant(u.work(), many, u.cur()).v?.id);
    await u.click('compare', { v: cmp.id });
    view(sel, 'many-compare');
    await u.click('compare-close');
    u.edit.startEdit('edit');   view(sel, 'many-editor-edit');   u.edit.cancelEdit();
    u.edit.startEdit('new');    view(sel, 'many-editor-new');    u.edit.cancelEdit();
    u.edit.startEdit('edit');
    u.store.commit(d => T.setOverride(d.cur, many, 'Written for this resume only.'), 'seed');
    u.edit.cancelEdit();
    view(sel, 'many-override');
    u.edit.startEdit();         view(sel, 'many-override-editor'); u.edit.cancelEdit();
    u.store.commit(d => T.setOverride(d.cur, many, null), 'seed');
    u.store.commit(d => T.setKeep(d.record, d.cur, many, true), 'seed');
    view(sel, 'many-kept');
    const using = u.ctx.chooseVariant(u.work(), many, u.cur()).v;
    u.store.commit(d => { const v = d.record.variants.find(x => x.id === using.id); v.tags = ['hardware', 'survey']; }, 'seed');
    view(sel, 'many-tagged');
    await u.click('focus', { tag: 'hardware' });
    view(sel, 'many-focus'); view({ kind: 'none' }, 'home-focus');
    await u.click('focus-clear');
    u.store.commit(d => T.setJobOn(d.record, d.cur, job.id, false), 'seed');
    view({ kind: 'job', id: job.id }, 'job-off'); view(sel, 'many-job-off');
  }
  return out;
}

section('the Resume\'s markup is what it was');
{
  const now = await resumeSnapshot();
  if (WRITE){
    fs.writeFileSync(SNAP, JSON.stringify(Object.fromEntries(Object.entries(now).map(([k, v]) => [k, M10_ADDS(v)])), null, 1) + '\n');     // the later additions stay out, as they are when comparing
    console.log(`wrote ${Object.keys(now).length} views to checks/fixtures/edit-markup.snapshot.json`);
  } else {
    const was = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
    const keys = new Set([...Object.keys(was), ...Object.keys(now)]);
    let bad = 0;
    for (const k of keys){
      if ((was[k] === undefined ? undefined : M10_ADDS(was[k])) === (now[k] === undefined ? undefined : M10_ADDS(now[k]))) continue;
      bad++;
      const a = String(was[k] === undefined ? '(missing)' : M10_ADDS(was[k])), b = String(now[k] === undefined ? '(missing)' : M10_ADDS(now[k]));
      let i = 0; while (i < a.length && a[i] === b[i]) i++;
      console.log(`FAIL  ${k} differs at ${i}:\n   was  …${a.slice(Math.max(0, i - 40), i + 80)}\n   now  …${b.slice(Math.max(0, i - 40), i + 80)}`);
    }
    ok(`${keys.size} Resume views, byte for byte (but for the three 0.7.3 additions)`, bad === 0, `${bad} differ`);
    ok('a claim of a job has 🗑 in its header; a job panel has a Details fold, and the + Add something you did box moved to the checklist',
      now['en/bullet-0'].includes('data-act="delete-claim"') && now['en/job'].includes('<details class="jr details"') && !now['en/job'].includes('data-act="add-claim"'));
    ok('a title, a summary and a header text have no 🗑 (they are not claims)', ['en/summary-bullet', 'en/header-fact', 'en/job-title-fact'].every(k => !now[k].includes('delete-claim')));
    ok('the snapshot covers the editor in every mode, compare, folds, focus and a missing language',
      ['en/many-editor-edit', 'en/many-editor-new', 'en/many-override-editor', 'en/many-override', 'en/many-compare', 'en/many-minor-folded', 'en/many-minor-open', 'en/many-focus', 'hu/bullet-0', 'de/bullet-0', 'hu/missing-writein', 'de/missing-same', 'pl/home'].every(k => k in now));
    ok('the missing-language page has the write-in box and the home page the missing list', now['hu/missing-writein'].includes('id="ed-new"') && now['pl/home'].includes('missbar') && now['pl/home'].includes('miss-go'));
  }
}

// PARTS_STAGE=10.1 runs the snapshot alone
if (process.env.PARTS_STAGE !== '10.1') await (await import('./parts-check.parity.mjs')).default({ ok, section, makeUi, dom, R, T, vals }).catch(e => { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; });

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
