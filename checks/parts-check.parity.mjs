// The parity sections of checks/parts-check.mjs: the one claim panel, opened from the page and from the
// record checklist, and the Details fold that holds a job's fields.

import * as K from '../src/model/career.js';

export default async function parity({ ok, section, makeUi, dom, R, T }){
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const between = (html, from, to) => { const i = html.indexOf(from); if (i < 0) return ''; const j = html.indexOf(to, i); return html.slice(i, j < 0 ? undefined : j + to.length); };
  const editor = html => between(html, '<div class="editor"', '</div>\n  </div>');
  const writein = html => between(html, '<div class="writein">', '</div>\n  </div>');
  const record = u => JSON.stringify(u.store.state.record);

  const pick = u => {
    const w = u.work();
    const job = w.work[0];
    const id = job.highlights.find(h => R.versionsIn(w, h, 'en').length >= 2) ?? job.highlights[0];
    return { job: job.id, id };
  };
  const sel = c => ({ kind: 'bullet', id: c.id, job: c.job, section: 'experience' });
  // the page selects it
  const fromPage = (u, c) => { u.select(sel(c)); return u.edit.bulletView(u.ui.sel); };
  // the checklist's row for it: its button carries the selection; the shell selects exactly that
  const fromList = async (u, c) => {
    const row = String(u.checklist.html()).match(new RegExp(`<li class="clrow[^"]*" data-fact="${c.id}"[^>]*>[\\s\\S]*?data-act="cl-open" data-sel="([^"]*)"`));
    const picked = row ? JSON.parse(row[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')) : null;
    await u.click('cl-open', { sel: JSON.stringify(picked) });
    return { picked, html: u.edit.bulletView(u.ui.sel) };
  };

  section('one claim, one panel: from the page, and from the checklist');
  {
    const a = await makeUi({ resume: 0 }), b = await makeUi({ resume: 0 });
    const fact = pick(a);
    const h1 = fromPage(a, fact);
    const { picked, html: h2 } = await fromList(b, fact);
    ok('the checklist row selects what a click on the page selects', eq(picked, sel(fact)), JSON.stringify(picked));
    ok('so the panel is the same markup', h1 === h2 && h1.length > 500);
    ok('it has a version list with ◉ on the one in use, a "use" action, ✎ and 🗑 on a version, + Write a new version', h1.includes('class="rad"') && h1.includes('vrow cur') && h1.includes('data-act="use-version"') && h1.includes('data-act="delete-version"') && h1.includes('data-act="new-version"'));
    ok('…and nothing of a flat, Career-only list is left', !h1.includes('vlist flat') && !/vrow flat/.test(h1));
    const vs = R.versionsIn(a.work(), fact.id, 'en');
    ok('the radio is on the version in use only', (h1.match(/class="rad"/g) ?? []).length === vs.length && (h1.match(/vrow cur/g) ?? []).length === 1);
    ok('a claim not on this resume opens the same panel from the checklist (its row is listed, unticked)', await (async () => {
      const u = await makeUi({ resume: 0 });
      const w = u.work();
      const off = w.work.flatMap(j => j.highlights.map(id => ({ job: j.id, id }))).find(c => !T.listedBullets(u.record(), u.cur(), c.job).includes(c.id) && !(w.facts.find(f => f.id === c.id)?.archived));
      const row = String(u.checklist.html()).match(new RegExp(`<li class="clrow is-off[^"]*" data-fact="${off.id}"[^>]*>[\\s\\S]*?</li>`));
      const { html: h } = await fromList(u, off);
      return !!off && !!row && !/checked/.test(row[0].match(/<input[^>]*>/)[0]) && h.includes('<h2 class="title"') && h.includes('class="vlist"');
    })());
  }

  section('the same clicks make the same record');
  {
    const base = await makeUi({ resume: 0 });
    const baseMax = Math.max(...R.versionsIn(base.work(), pick(base).id, 'en').map(v => Number(R.major(v.n))));
    // opened on the page or from the checklist: both end in the same record
    const run = async (how, steps) => {
      const u = await makeUi({ resume: 0 });
      const fact = pick(u);
      const dv = T.defaultVariant(u.work(), fact.id, 'en').id;
      u.store.commit(d => { d.cur.picks = { ...(d.cur.picks ?? {}), [fact.id]: dv }; }, 'seed');
      if (how === 'list') await fromList(u, fact); else fromPage(u, fact);
      await steps(u, fact);
      return u;
    };
    const A = async u => { await u.click('edit'); u.type('ed', 'A tighter way of saying it.'); await u.click('ed-saveas'); };
    ok('✎ then Save as vN.1 writes the same record', record(await run('page', A)) === record(await run('list', A)));
    ok('…and a new version, numbered as a minor', R.versionsIn((await run('list', A)).work(), pick(base).id, 'en').some(v => /\./.test(v.n)));
    const S = async u => { await u.click('edit'); u.type('ed', 'Reworded in place.'); await u.click('ed-save'); };
    ok('✎ then Save vN writes the same record', record(await run('page', S)) === record(await run('list', S)));
    const N = async u => { await u.click('new-version'); u.type('ed', 'A different take, for another kind of job.'); await u.click('ed-new'); };
    const nb = await run('list', N);
    ok('+ Write a new version writes the same record, as the next whole number', record(await run('page', N)) === record(nb) && R.versionsIn(nb.work(), pick(nb).id, 'en').at(-1).n === String(baseMax + 1));
    ok('…and the open resume picks the version it just wrote', Object.values(nb.cur().picks).includes(R.versionsIn(nb.work(), pick(nb).id, 'en').at(-1).id));
    const D = async (u, fact) => { await u.click('delete-version', { v: R.versionsIn(u.work(), fact.id, 'en').at(-1).id }); };
    ok('🗑 on a version writes the same record', record(await run('page', D)) === record(await run('list', D)));

    const mk = async () => {
      const u = await makeUi({ resume: 0, lang: 'de' });
      const w = u.work();
      const gone = w.facts.filter(f => !R.versionsIn(w, f.id, 'de').length && T.jobOfFact(w, f.id));
      return { u, a: { job: T.jobOfFact(w, gone[0].id).id, id: gone[0].id }, b: { job: T.jobOfFact(w, gone[1].id).id, id: gone[1].id } };
    };
    const W = async how => {
      const { u, a, b } = await mk();
      const open = async f => (how === 'list' ? fromList(u, f) : fromPage(u, f));
      await open(a);
      dom.set('ed-new', { value: 'Leitete eine Prototypenwerkstatt.', dataset: { from: '' } });
      await u.click('write-in');
      await open(b);
      u.tick({ same: `fact:${b.id}` }, true);
      return u;
    };
    const wp = await W('page'), wl = await W('list');
    ok('writing a missing German text, and "same in every language", write the same record', record(wp) === record(wl));
    ok('…the text is there as v1 in German, and the resume picks it', R.versionsIn(wl.work(), (await mk()).a.id, 'de').length === 1 && Object.values(wl.cur().picks ?? {}).some(v => /-de$|de/.test(v)));
    {
      const { u, a } = await mk();
      const h = fromPage(u, a);
      const wi = writein(h);
      ok('a missing German text: the English for reference and a box to write it', wi.length > 200 && wi.includes('id="ed-new"') && wi.includes('class="ref"'));
    }
  }

  section('🗑 in the claim\'s header');
  {
    const u = await makeUi({ resume: 0 });
    const fact = pick(u);
    const before = u.work().work[0].highlights.length;
    const h = fromPage(u, fact);
    ok('🗑 is in the header, above the versions', h.includes('data-act="delete-claim"') && h.indexOf('data-act="delete-claim"') < h.indexOf('<span class="lbl">'));
    await u.click('delete-claim');
    ok('it deletes the claim and every version', u.work().work[0].highlights.length === before - 1 && !u.work().facts.some(f => f.id === fact.id));
    ok('it asks nothing (Ctrl+Z brings it back), and the panel goes back to the job', u.store.history.undo > 0 && u.ui.sel.kind === 'job' && u.store.undo() === 'Delete claim' && u.work().facts.some(f => f.id === fact.id));
    const v = await makeUi({ resume: 0 });
    const job = v.work().work[0];
    for (const id of [...job.highlights.slice(1)]){ fromPage(v, { job: job.id, id }); await v.click('delete-claim'); }
    fromPage(v, { job: job.id, id: v.work().work[0].highlights[0] });
    const left = v.work().work[0].highlights.length;
    await v.click('delete-claim');
    ok('a job keeps its last claim (the same message as before)', left === 1 && v.work().work[0].highlights.length === 1 && v.toasts.at(-1)?.tone === 'bad');
  }

  section('+ Add something you did: under a job in the checklist');
  {
    const u = await makeUi({ resume: 0 });
    const w = u.work();
    const job = w.work[1] ?? w.work[0];
    const before = new Set(job.highlights);
    u.select({ kind: 'job', id: job.id });
    const list = String(u.checklist.html());
    const gm = list.match(new RegExp(`<section class="clg open[^"]*" data-g="${job.id}">[\\s\\S]*?</section>`));
    const group = gm ? gm[0] : '';
    ok('the job’s group (open, as it holds the selection) has the box; the job’s own panel no longer lists its lines', group.includes('data-act="add-claim"') && group.includes('class="new-claim"') && !String(u.edit.jobView({ kind: 'job', id: job.id })).includes('data-act="add-claim"'));
    ok('the other groups are folded, with their rows still in the page', list.includes('aria-expanded="false"') && (list.match(/<section class="clg open[ "]/g) ?? []).length === 1);
    dom.set('new-claim', { value: 'Wrote the fixture drawings and the test procedure.' });
    await u.click('add-claim', { id: job.id, key: 'work' });
    const made = u.work().work.find(x => x.id === job.id).highlights.find(x => !before.has(x));
    ok('it adds the claim to the record, and it is on (its job is)', !!made && T.listedBullets(u.record(), u.cur(), job.id).includes(made));
  }

  section('the Details fold of a job');
  {
    const u = await makeUi({ resume: 0 });
    const job = u.work().work[0];
    const h = String(u.edit.jobView({ kind: 'job', id: job.id }));
    ok('a job’s panel: its position, its meta line, the switch, and a Details fold that starts shut', /<h2 class="title">/.test(h) && /class="meta"/.test(h) && h.includes(`data-jobon="${job.id}"`) && /<details class="jr details" data-det="[^"]+" >/.test(h));
    ok('the old “Title and meta line” rows and the bullets list are not in it (the checklist lists the lines)', !/Title and meta line/.test(h) && !h.includes('data-act="select-fact"') && !h.includes('data-on='));
    ok('it holds title, employer, dates, “works here now”, place and More fields (JSON Resume)', ['c-pos', 'c-org', 'c-start', 'c-end', 'c-current', 'c-loc'].every(id => h.includes(`id="${id}"`)) && /More fields \(JSON Resume\)/.test(h));
    ok('its fields are one form, committed as you leave them', h.includes(`data-form="entry" data-key="work" data-id="${job.id}"`) && !/data-act="c-save"/.test(h));
    ok('the “From Career” line and the “Edit in Career →” link are gone', !/Edit in Career/.test(h) && !/to-career/.test(h));
    // the fold remembers it was opened
    u.fire('toggle', { dataset: { det: job.id }, open: true });
    ok('opened, it stays open when the panel is drawn again', /<details class="jr details" data-det="[^"]+" open>/.test(String(u.edit.jobView({ kind: 'job', id: job.id }))));
    const p = u.record().projects[0];
    ok('a project’s Details fold also has Delete, which a job’s does not', /c-del-entry/.test(String(u.edit.jobView({ kind: 'job', id: p.id }))) && !/c-del-entry/.test(h));
  }

  section('keys: Enter edits the version in use');
  {
    const w = (await makeUi({ resume: 0 })).work();
    const job = w.work[0];
    const r = await makeUi({ resume: 0 });
    r.select({ kind: 'bullet', id: job.highlights[0], job: job.id, section: 'experience' });
    ok('Enter edits the version in use', r.edit.key({ key: 'Enter', ctrlKey: false, metaKey: false, preventDefault(){} }) && r.edit.editing?.mode === 'edit');
    ok('Alt+↓ moves a selected section, and only a section', (() => { r.select({ kind: 'section', id: 'skills' }); return r.edit.key({ key: 'ArrowDown', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault(){} }); })());
  }
}
