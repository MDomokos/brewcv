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
import { makeUi, dom, REPO, setPhone } from './lib/ui-harness.mjs';
import * as R from '../src/model/record.js';
import * as T from '../src/model/resume.js';
import { toolsHtml, statsCompactHtml } from '../src/ui/parts.js';

// The snapshot is a phone's sheet: it keeps the short form of a version (where it starts to differ), as it always did. The desktop
// panel shows every version in full (the section at the end).
setPhone(true);
const SNAP = path.join(REPO, 'checks/fixtures/edit-markup.snapshot.json');
const WRITE = process.argv.includes('--write');
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);
const vals = x => x;

// Added to, or taken out of, the Resume on purpose since the snapshot, so left out before comparing: 🗑 in a
// claim's header, "+ Add something you did" under a job's claims, "Esc goes back" in the keys line, Archive
// beside 🗑, the Keep button; and, in the one-screen rework (UX-2), the hint paragraphs (keys, drag, versions), the "From
// Career …" lines and the sort-of-duplicate "Title and meta line" rows.
const M10_ADDS = html => String(html)
  .replace(/<button class="ghost sm" data-act="delete-claim"[^>]*>(?:🗑|<svg class="ico"[^>]*>.*?<\/svg>)<\/button>/g, '')
  .replace(/<button class="ghost sm" data-act="(?:un)?archive-claim"[^>]*>[^<]*<\/button>/g, '')
  .replace(/<button class="keep sm"[^>]*>.*?<\/button>/g, '')      // Keep is an icon since UX-6b: its name is in aria-label
  .replace(', <kbd>Esc</kbd> goes back', '')
  .replace(/<span class="dp-tools">.*?<\/span><\/nav>/gs, '</nav>')      // the padlock and the switch on the depth row (UX-6c-iii-b)
  .replace(/\s*<p class="lockbar">[\s\S]*?<\/p>/g, '')       // the page's padlock
  .replace(/<button type="button" class="sm ghost pagelock[^"]*"[^>]*>.*?<\/button>/gs, '')
  .replace(/\n\s*<label class="field addclaim">[\s\S]*?<\/label>/g, '')
  .replace(/\s*<p class="note">[^<]*(?:<kbd>[^<]*<\/kbd>[^<]*)*<\/p>/g, '')
  .replace(/\s*<div class="from">[\s\S]*?<\/div>/g, '')
  .replace(/\+351(?: ?\d+)+/g, '<phone>');     // the example person's number, whole or cut by an aria-label, stays out of the fixture

async function resumeSnapshot(){
  const out = {};
  const put = (name, html) => { out[name] = html; };

  for (const [tag, opts] of [['en', { resume: 0 }], ['hu', { resume: 2 }], ['de', { resume: 6 }], ['pl', { resume: 0, lang: 'pl' }]]){
    const u = await makeUi(opts);
    const w = u.work();
    const ix = u.ctx.ix();
    const job = w.work[0];
    const bullets = job.highlights;
    const view = (sel, name) => put(`${tag}/${name}`, sel.kind === 'bullet' ? u.edit.bulletView(sel) : sel.kind === 'job' ? u.edit.jobView(sel) : sel.kind === 'section' ? u.edit.sectionView(sel) : u.edit.outlineView());

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
    u.store.commit(d => T.setOverride(d.record, d.cur, many, 'Written for this resume only.'), 'seed');
    u.edit.cancelEdit();
    view(sel, 'many-override');
    u.edit.startEdit();         view(sel, 'many-override-editor'); u.edit.cancelEdit();
    u.store.commit(d => T.setOverride(d.record, d.cur, many, null), 'seed');
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

    // on the page (UX-3, UX-6c): the tools in the line's margin (the version number, ↑ and ↓, the counts; nothing to save, since leaving
    // the line keeps it), and the panel while a line is written there (the versions and a note: no text box, no "Write a new version")
    {
      const now = u.ctx.chooseVariant(u.work(), many, u.cur()).v;
      const e = { fact: many, mode: 'edit', vid: now.id, base: now.text, draft: `${now.text} and more`, lines0: 2, lines: 3 };
      put('en/onpage-tools', toolsHtml({ vn: now.n, canMove: true, ends: { first: true }, counts: statsCompactHtml(e) }));
      u.ctx.onpage = { begin: () => true, end(){}, setText(){}, refresh(){} };
      u.edit.startEdit('edit');   view(sel, 'many-written-on-page');   u.edit.cancelEdit();
      delete u.ctx.onpage;
    }
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

section('the desktop panel shows every version in full, with the words that differ from the one in use marked');
{
  setPhone(false);
  const u = await makeUi({ resume: 0 });
  const sel = { kind: 'bullet', id: 'hydra-inhaler', job: 'hydra', section: 'experience' };
  const html = String(u.edit.bulletView(sel));
  const vs = R.versionsIn(u.work(), 'hydra-inhaler', 'en');
  const text = html.replace(/<mark class="dw">|<\/mark>/g, '').replace(/&amp;/g, '&');
  ok('the list is the full one, and no version is cut to a gist or an ellipsis', html.includes('class="vlist full"') && !/…/.test(html.slice(html.indexOf('class="vlist'))) && vs.every(v => text.includes(v.text.replace(/&/g, '&'))));
  const cur = T.chooseVariant(u.work(), 'hydra-inhaler', u.cur()).v;
  const others = vs.filter(v => v.id !== cur.id);
  ok('the words that are not in the version in use are marked (<mark class="dw">), the version in use is not marked', others.every(v => html.includes(`data-v="${v.id}"`)) && (html.match(/<mark class="dw">/g) ?? []).length >= others.length && !/class="vrow cur[^>]*>[^]*?<mark/.test(html.slice(html.indexOf('vrow cur'), html.indexOf('vrow cur') + 400).split('</div>')[0]));
  setPhone(true);
  const phone = String(u.edit.bulletView(sel));
  ok('a phone keeps the gist: no full list, no marks', !phone.includes('vlist full') && !phone.includes('class="dw"'));
  setPhone(false);
}

section('leaving a line keeps it on this resume (UX-6c): an edit with its base and highlights, the base’s words drop it, nothing asks');
{
  const u = await makeUi({ resume: 0 });
  const id = u.work().work[0].highlights.find(f => (T.chooseVariant(u.work(), f, u.cur()).v?.marks ?? []).length) ?? u.work().work[0].highlights[0];
  u.select({ kind: 'bullet', id, job: u.work().work[0].id, section: 'experience' });
  const base = T.chooseVariant(u.work(), id, u.cur()).v, undo0 = u.store.history.undo;
  u.edit.startEdit(); await u.edit.cancelEdit();
  ok('leaving a line where nothing was typed changes nothing', u.store.history.undo === undo0 && !T.overrideOf(u.cur(), id));
  u.edit.startEdit(); u.edit.draftChanged(`${base.text} More.`);
  ok('leaving is always allowed, and asks nothing (there is no question to ask in Node)', u.edit.leaving({ kind: 'none' }) === true);
  const o = T.overrideOf(u.cur(), id);
  ok('…what was typed is this resume’s edit, as one undo step, with the version it came from and that version’s highlights', o?.on && o.text === `${base.text} More.` && o.base === base.id && JSON.stringify(o.marks) === JSON.stringify(base.marks ?? []) && (base.marks ?? []).length > 0 && u.store.history.undo === undo0 + 1, JSON.stringify(o));
  u.edit.startEdit(); u.edit.draftChanged(`${base.text} More, and more.`); await u.edit.cancelEdit();
  ok('an edit written again keeps its base', T.overrideOf(u.cur(), id)?.text === `${base.text} More, and more.` && T.overrideOf(u.cur(), id)?.base === base.id);
  u.edit.startEdit(); u.edit.draftChanged(base.text); await u.edit.cancelEdit();
  ok('the base version’s own words again drop the edit: nothing is stored', !T.overrideOf(u.cur(), id) && !(id in (u.cur().overrides ?? {})) && !(id in (u.cur().overrideMeta ?? {})));
  u.edit.startEdit(); u.edit.draftChanged('Kept, then set aside.'); await u.edit.cancelEdit();
  const other = R.versionsIn(u.work(), id, 'en').find(v => v.id !== base.id);
  u.store.commit(d => T.pickVersion(d.record, d.cur, id, other.id), 'pick');
  ok('a version picked over the edit sets it aside (parked), and the versions list offers it back', T.overrideOf(u.cur(), id)?.on === false && String(u.edit.bulletView(u.ui.sel)).includes('data-act="use-edit"'));
  await u.click('use-edit');
  ok('…picking the edit puts it back', T.overrideOf(u.cur(), id)?.on === true && T.overrideOf(u.cur(), id)?.text === 'Kept, then set aside.');
  u.edit.startEdit(); u.edit.draftChanged('Thrown away.'); await u.click('ed-cancel');
  ok('only the panel’s own Cancel button drops what was typed', T.overrideOf(u.cur(), id)?.text === 'Kept, then set aside.');
}

section('one depth indicator: the sidebar’s row is parts.js depthHtml, the chip’s markup');
{
  const u = await makeUi({ resume: 0 });
  const job = u.work().work[0], id = job.highlights[0];
  const row = String(u.edit.bulletView({ kind: 'bullet', id, job: job.id, section: 'experience' }));
  const sel = { kind: 'bullet', id, job: job.id, section: 'experience' };
  const chip = u.edit.depthHtml(sel, { page: true });
  const shape = h => (h.slice(0, h.indexOf('</nav>')).match(/class="[^"]*"/g) ?? []).filter(c => c !== 'class="dp-n"').map(c => c.replace(/ sm\b/, '')).join(',');
  ok('the editor card opens with the same <nav class="depth"> the chip draws (the chip’s one is the small size), and no old crumb', shape(row.slice(0, row.indexOf('</nav>'))) === shape(chip.slice(0, chip.indexOf('</nav>'))) && chip.startsWith('<nav class="depth sm"') && row.startsWith('<nav class="depth"') && !row.includes('class="crumb"'));
  ok('the chip has no Esc and no level below', !chip.includes('dp-esc') && !chip.includes('dp-l next'));
  ok('Page › Experience › Hydra on the page: single words, the job current, no line level and no names', (chip.match(/class="dp-l/g) ?? []).length === 3 && /class="dp-l cur"[^>]*aria-current="location"><span class="dp-w">Hydra<\/span><\/button>/.test(chip) && chip.includes('<span class="dp-w">Experience</span>') && !chip.includes('dp-n'));
  ok('the sidebar’s row: Page › Job › Line, the line current, the job’s name and the line’s name inside their levels', (row.match(/class="dp-l/g) ?? []).length === 3 && /class="dp-l cur"[^>]*aria-current="location"><span class="dp-w">Line<\/span><span class="dp-n">/.test(row) && row.includes(`<span class="dp-n">${job.name}</span>`));
  const sk = u.edit.depthHtml({ kind: 'section', id: 'skills' }, { page: true });
  ok('a section on the page: Page › Skills, a custom heading’s first word, long words cut with an ellipsis', /<span class="dp-w">Skills<\/span>/.test(sk) && !/dp-n/.test(sk));
  ok('a section: Page › Section; the header: Page › Header', /<span class="dp-w">Section<\/span>/.test(u.edit.depthHtml({ kind: 'section', id: 'experience' })) && /<span class="dp-w">Header<\/span>/.test(u.edit.depthHtml({ kind: 'header' })));
}

section('the padlock and the switch on the depth row (UX-6c-iii-b): one component, a name each, aria-pressed');
{
  const u = await makeUi({ resume: 0 });
  const job = u.work().work[0], id = job.highlights[0], sel = { kind: 'bullet', id, job: job.id, section: 'experience' };
  const chip = u.edit.depthHtml(sel, { page: true }), row = String(u.edit.bulletView(sel));
  const btn = (h, cls) => (h.match(new RegExp(`<button[^>]*class="dp-t ${cls}[^"]*"[^>]*>`)) ?? [])[0] ?? '';
  ok('the chip and the sidebar’s row both end with a padlock and a switch, in that order, inside the nav', [chip, row].every(h => /<span class="dp-tools"><button[^>]*dp-lock[^>]*>.*<\/button><button[^>]*dp-show[^>]*>.*<\/button><\/span><\/nav>/s.test(h)));
  ok('the padlock is a button named for what the chip names, not pressed, and says Lock; the switch is the pill, says Hide and has no aria-pressed (its label says what it will do)', /aria-pressed="false" aria-label="Lock the line in /.test(btn(chip, 'dp-lock')) && /aria-label="Hide the line in [^"]* from this resume"/.test(btn(chip, 'dp-show')) && !/aria-pressed/.test(btn(chip, 'dp-show')) && /class="pillsw on"/.test(chip) && /data-act="lock-toggle" data-id="/.test(btn(chip, 'dp-lock')));
  ok('the header, a heading and the page have a padlock and no switch', [{ kind: 'header', id: 'name' }, { kind: 'section', id: 'experience', heading: true }].every(x => { const h = u.edit.depthHtml(x, { page: true }); return /dp-lock/.test(h) && !/dp-show/.test(h); }));
  u.store.commit(d => { d.cur.locked = [id]; }, 'lock');
  const locked = u.edit.depthHtml(sel, { page: true });
  ok('a locked line: the padlock is pressed and says Unlock, and the switch is aria-disabled', /is-locked[^>]*aria-pressed="true" aria-label="Unlock the line in /.test(btn(locked, 'dp-lock')) && /aria-disabled="true"/.test(btn(locked, 'dp-show')));
  u.store.commit(d => { delete d.cur.locked; }, 'unlock');
}

// PARTS_STAGE=10.1 runs the snapshot alone
if (process.env.PARTS_STAGE !== '10.1') await (await import('./parts-check.parity.mjs')).default({ ok, section, makeUi, dom, R, T, vals }).catch(e => { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; });

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
