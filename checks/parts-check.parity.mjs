// The parity sections of checks/parts-check.mjs: the same claim opened in Career and in the Resume.

import * as K from '../src/model/career.js';

export default async function parity({ ok, section, makeUi, dom, R, T }){
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const strip = html => String(html)
    .replace(/<button class="sm" data-act="ed-only"[\s\S]*?<\/button>/g, '')                   // the Resume's "this resume only" button
    .replace(/(<div class="stats" id="ed-stats">)([\s\S]*?)(<\/div>)/g, (_, a, b, c) => a + (b.match(/<span>[^<]*<\/span>/)?.[0] ?? '') + c);   // characters only: lines and fill need a page
  const between = (html, from, to) => { const i = html.indexOf(from); if (i < 0) return ''; const j = html.indexOf(to, i); return html.slice(i, j < 0 ? undefined : j + to.length); };
  const editor = html => between(strip(html), '<div class="editor"', '</div>\n  </div>');
  const writein = html => between(html, '<div class="writein">', '</div>\n  </div>');
  const rows = html => [...String(html).matchAll(/<div class="vrow[^"]*"[^>]*data-v="([^"]+)"/g)].map(m => m[1]);
  const nums = html => [...String(html).matchAll(/<span class="n">v([\d.]+)/g)].map(m => m[1]);

  const pick = u => {
    const w = u.work();
    const job = w.work[0];
    const id = job.highlights.find(h => R.versionsIn(w, h, 'en').length >= 2) ?? job.highlights[0];
    return { job: job.id, id };
  };
  const openResume = (u, c) => { u.select({ kind: 'bullet', id: c.id, job: c.job, section: 'experience' }); return u.edit.bulletView(u.ui.sel); };
  const openCareer = async (u, c) => { await u.career.act('c-claim', { dataset: { key: 'work', entry: c.job, id: c.id } }); return u.career.views.career(); };

  section('the same claim, the same panel');
  {
    const r = await makeUi({ resume: 0 }), c = await makeUi({ resume: 0, ws: 'career' });
    const fact = pick(r);
    // every minor open in the Resume, so both lists show every version
    for (const m of new Set(R.versionsIn(r.work(), fact.id, 'en').map(v => R.major(v.n)))) await r.click('unfold', { m });
    const rh = openResume(r, fact), ch = await openCareer(c, fact);
    ok('Career opens the claim panel (a version list, its heading, + Write a new version)', ch.includes('class="vlist flat"') && ch.includes('data-act="new-version"') && ch.includes(`<h2 class="title"`));
    ok('the same versions, in the same order', eq(rows(rh), rows(ch)) && rows(ch).length >= 2, `${rows(rh)} vs ${rows(ch)}`);
    ok('with the same numbers', eq(nums(rh), nums(ch)), `${nums(rh)} vs ${nums(ch)}`);
    ok('both lists put ✎ and the tag box on a version', ch.includes('data-act="edit"') && rh.includes('data-act="edit"') && ch.includes('class="tag-in"') && rh.includes('class="tag-in"'));

    // the Resume edits the version in use, Career the one it is pointed at: point both at the same one
    const dv = T.defaultVariant(r.work(), fact.id, 'en').id;
    r.store.commit(d => { d.cur.picks = { ...(d.cur.picks ?? {}), [fact.id]: dv }; }, 'seed');
    await r.click('edit'); await c.click('edit', { v: dv });
    const same = r.edit.editing?.vid === c.edit.editing?.vid;
    ok('the editor opens on the same version', same, `${r.edit.editing?.vid} vs ${c.edit.editing?.vid}`);
    const re = editor(openResume(r, fact)), ce = editor(await openCareer(c, fact));
    ok('the editor is the same markup (the Resume\'s "this resume only" and line counts aside)', re.length > 200 && re === ce, re === ce ? '' : `\n${re}\n${ce}`);
    await r.click('ed-cancel'); await c.click('ed-cancel');
    ok('Cancel closes it in both', !r.edit.editing && !c.edit.editing);

    for (const lang of ['de']){
      const r2 = await makeUi({ resume: 0, lang }), c2 = await makeUi({ resume: 0, ws: 'career' });
      const w = r2.work();
      const gone = w.facts.find(f => !R.versionsIn(w, f.id, lang).length && T.jobOfFact(w, f.id));
      const g = { job: T.jobOfFact(w, gone.id).id, id: gone.id };
      await c2.career.act('lang', { dataset: { lang, for: 'career' } });
      const rw = writein(openResume(r2, g)), cw = writein(await openCareer(c2, g));
      ok(`a missing ${lang.toUpperCase()} text: the write-in box is the same markup in both`, rw.length > 200 && rw === cw, rw === cw ? '' : `\n${rw}\n${cw}`);
    }
  }

  section('the same clicks make the same record');
  const record = u => JSON.stringify(u.store.state.record);
  const base = await makeUi({ resume: 0 });
  const baseMax = Math.max(...R.versionsIn(base.work(), pick(base).id, 'en').map(v => Number(R.major(v.n))));
  {
    const run = async (ws, steps) => {
      const u = await makeUi({ resume: 0, ws });
      const fact = pick(u);
      // both act on the record's default version
      const dv = T.defaultVariant(u.work(), fact.id, 'en').id;
      u.store.commit(d => { d.cur.picks = { ...(d.cur.picks ?? {}), [fact.id]: dv }; }, 'seed');
      if (ws === 'career') await openCareer(u, fact); else openResume(u, fact);
      await steps(u, fact, ws);
      return u;
    };
    const first = (u, fact) => T.defaultVariant(u.work(), fact.id, 'en').id;
    const edit = async (u, fact, ws) => { await u.click('edit', ws === 'career' ? { v: first(u, fact) } : {}); };

    const A = async (u, fact, ws) => { await edit(u, fact, ws); u.type('ed', 'A tighter way of saying it.'); await u.click('ed-saveas'); };
    const ua = await run('resume', A), ub = await run('career', A);
    ok('✎ then Save as vN.1 writes the same record', record(ua) === record(ub));
    ok('…and a new version, numbered the same', R.versionsIn(ub.work(), pick(ub).id, 'en').some(v => /\./.test(v.n)));

    const S = async (u, fact, ws) => { await edit(u, fact, ws); u.type('ed', 'Reworded in place.'); await u.click('ed-save'); };
    ok('✎ then Save vN writes the same record', record(await run('resume', S)) === record(await run('career', S)));

    const N = async (u, fact, ws) => { await u.click('new-version'); u.type('ed', 'A different take, for another kind of job.'); await u.click('ed-new'); };
    const na = await run('resume', N), nb = await run('career', N);
    ok('+ Write a new version writes the same record', record(na) === record(nb));
    ok('…as the next whole number', R.versionsIn(nb.work(), pick(nb).id, 'en').at(-1).n === String(baseMax + 1));

    const D = async (u, fact) => { await u.click('delete-version', { v: R.versionsIn(u.work(), fact.id, 'en').at(-1).id }); };
    ok('🗑 on a version writes the same record', record(await run('resume', D)) === record(await run('career', D)));

    const mk = async ws => {
      const u = await makeUi({ resume: 0, lang: ws === 'resume' ? 'de' : null, ws });
      const w = u.work();
      const gone = w.facts.filter(f => !R.versionsIn(w, f.id, 'de').length && T.jobOfFact(w, f.id));
      return { u, a: { job: T.jobOfFact(w, gone[0].id).id, id: gone[0].id }, b: { job: T.jobOfFact(w, gone[1].id).id, id: gone[1].id } };
    };
    const W = async ws => {
      const { u, a, b } = await mk(ws);
      if (ws === 'career') await u.career.act('lang', { dataset: { lang: 'de', for: 'career' } });
      const open = async f => (ws === 'career' ? openCareer(u, f) : openResume(u, f));
      await open(a);
      dom.set('ed-new', { value: 'Leitete eine Prototypenwerkstatt.', dataset: { from: '' } });
      await u.click('write-in');
      await open(b);
      u.tick({ same: `fact:${b.id}` }, true);
      return u;
    };
    const wr = await W('resume'), wc = await W('career');
    ok('writing a missing German text, and "same in every language", write the same record', record(wr) === record(wc));
    ok('…the text is there as v1 in German', R.versionsIn(wc.work(), (await mk('career')).a.id, 'de').length === 1);
    ok('…and the Resume picks the German text it just wrote; Career picks nothing', Object.keys(wr.cur().picks ?? {}).length > Object.keys(wc.cur().picks ?? {}).length && !Object.values(wc.cur().picks ?? {}).some(v => /-de$/.test(v)));

    const cn = await run('career', N);
    const dvId = T.defaultVariant(base.work(), pick(base).id, 'en').id;
    ok('a version written in Career is not picked by the open resume', cn.cur().picks[pick(cn).id] === dvId);
    const rn = await run('resume', N);
    ok('…one written in the Resume is', Object.values(rn.cur().picks).includes(R.versionsIn(rn.work(), pick(rn).id, 'en').at(-1).id));
  }

  section('Career\'s list is flat: no ◉, nothing in use, no "use"');
  {
    const r = await makeUi({ resume: 0 }), c = await makeUi({ resume: 0, ws: 'career' });
    const fact = pick(r);
    const rh = openResume(r, fact), ch = await openCareer(c, fact);
    ok('the Resume\'s list has ◉, a version in use and a "use" action', rh.includes('class="rad"') && rh.includes('vrow cur') && rh.includes('data-act="use-version"'));
    ok('Career\'s list has none of them', !ch.includes('class="rad"') && !/vrow cur/.test(ch) && !ch.includes('use-version') && !ch.includes('data-act="keep"') && !ch.includes('id="b-on"'));
    ok('every Career version has ✎ ⇄ 🗑', R.versionsIn(c.work(), fact.id, 'en').every(v => ['edit', 'compare', 'delete-version'].every(a => ch.includes(`data-act="${a}" data-v="${v.id}"`))));
    ok('Career\'s claim panel never offers the Resume\'s "This resume only"', !ch.includes('ed-only'));
    await c.click('edit', { v: R.versionsIn(c.work(), fact.id, 'en')[0].id });
    const ce = await openCareer(c, fact);
    ok('…not in the editor either', !ce.includes('ed-only') && !ce.includes('This resume only'));
    await c.click('ed-cancel');
    const vs = R.versionsIn(c.work(), fact.id, 'en');
    await c.click('compare', { v: vs[1].id });
    const cc = await openCareer(c, fact);
    ok('⇄ in Career compares a version with the one above it', cc.includes(`<del>v${vs[0].n}</del> → <ins>v${vs[1].n}</ins>`));
    await c.click('compare-close');
    ok('the stripe: the Resume keeps its radio on the version in use only', (rh.match(/class="rad"/g) ?? []).length === R.versionsIn(r.work(), fact.id, 'en').length && (rh.match(/vrow cur/g) ?? []).length === 1);
    ok('every Career view of a claim renders a panel (entry claim, About summary, headline)', await (async () => {
      const u = await makeUi({ resume: 0, ws: 'career' });
      const b = u.work().basics;
      await u.career.act('c-sel', { dataset: { what: 'about', id: 'summary' } });
      const s1 = u.career.views.career();
      await u.career.act('c-sel', { dataset: { what: 'about', id: 'name' } });
      await u.career.act('c-sel-fact', { dataset: { fact: b.display.label, title: 'Headline' } });
      const s2 = u.career.views.career();
      return s1.includes('class="vlist flat"') && s2.includes('class="vlist flat"') && !s1.includes('delete-claim') && !s2.includes('delete-claim');
    })());
  }

  section('🗑 in the claim\'s header, in both workspaces');
  {
    const run = async ws => {
      const u = await makeUi({ resume: 0, ws });
      const fact = pick(u);
      const before = u.work().work[0].highlights.length;
      const h = ws === 'career' ? await openCareer(u, fact) : openResume(u, fact);
      const hasBtn = h.includes('data-act="delete-claim"') && h.indexOf('data-act="delete-claim"') < h.indexOf('<span class="lbl">');
      await u.click('delete-claim');
      return { u, fact, before, hasBtn };
    };
    const a = await run('resume'), b = await run('career');
    ok('🗑 is in the header (above the versions), in both', a.hasBtn && b.hasBtn);
    ok('it deletes the claim and every version, writing the same record', record(a.u) === record(b.u) && a.u.work().work[0].highlights.length === a.before - 1 && !a.u.work().facts.some(f => f.id === a.fact.id));
    ok('it asks nothing (Ctrl+Z brings it back)', a.u.store.history.undo > 0 && a.u.store.undo() === 'Delete claim' && a.u.work().facts.some(f => f.id === a.fact.id));
    ok('the Resume goes back to the job, Career to the entry', a.u.ui.sel.kind === 'job' && b.u.career.sel?.what === 'entry');
    const u = await makeUi({ resume: 0 });
    const job = u.work().work[0];
    for (const id of [...job.highlights.slice(1)]){ openResume(u, { job: job.id, id }); await u.click('delete-claim'); }
    openResume(u, { job: job.id, id: u.work().work[0].highlights[0] });
    const left = u.work().work[0].highlights.length;
    await u.click('delete-claim');
    ok('a job keeps its last claim (the same message as before)', left === 1 && u.work().work[0].highlights.length === 1 && u.toasts.at(-1)?.tone === 'bad');
  }

  section('+ Add something you did: the same in both');
  {
    const run = async ws => {
      const u = await makeUi({ resume: 0, ws });
      const w = u.work();
      const job = w.work[1] ?? w.work[0];
      const before = new Set(job.highlights);
      if (ws === 'career'){ await u.career.act('c-sel', { dataset: { what: 'entry', key: 'work', id: job.id } }); }
      const h = ws === 'career' ? u.career.views.career() : u.edit.jobView({ kind: 'job', id: job.id });
      dom.set('new-claim', { value: 'Wrote the fixture drawings and the test procedure.' });
      await u.click('add-claim', { id: job.id, key: 'work' });
      const made = u.work().work.find(x => x.id === job.id).highlights.find(x => !before.has(x));
      return { u, h, made, job };
    };
    const a = await run('resume'), b = await run('career');
    ok('both panels have the same + Add something you did', a.h.includes('data-act="add-claim"') && b.h.includes('data-act="add-claim"') && a.h.includes('id="new-claim"') && b.h.includes('id="new-claim"'));
    ok('both add the claim to the record the same way', !!a.made && !!b.made && record(a.u) === record(b.u));
    ok('in the Resume the claim is on (its job is)', T.listedBullets(a.u.record(), a.u.cur(), a.job.id).includes(a.made));
    ok('in Career the open resume is not touched', eq(b.u.cur(), base.cur()));
  }

  section('one set of keys');
  {
    const u = await makeUi({ resume: 0, ws: 'career' });
    const w = u.work();
    const job = w.work[0];
    await u.career.act('c-sel', { dataset: { what: 'entry', key: 'work', id: job.id } });
    const ev = key => { let stop = false; const e = { key, ctrlKey: false, metaKey: false, altKey: false, preventDefault(){ stop = true; } }; const r = u.career.key(e); return { r, stop }; };
    ok('↓ in an entry opens its first claim', ev('ArrowDown').r && u.career.sel.what === 'claim' && u.career.sel.claim === job.highlights[0]);
    ok('↓ again walks to the next claim', ev('ArrowDown').r && u.career.sel.claim === job.highlights[1]);
    ok('↑ walks back', ev('ArrowUp').r && u.career.sel.claim === job.highlights[0]);
    ok('↑ at the first claim stays (it does not leave the entry)', !ev('ArrowUp').r && u.career.sel.claim === job.highlights[0]);
    const vs = R.versionsIn(u.work(), job.highlights[0], 'en');
    u.career.views.career();
    ok('→ steps to the next version (marked), ← back', ev('ArrowRight').r && /is-pick/.test(u.career.views.career()) && ev('ArrowLeft').r);
    ev('ArrowRight');
    ok('Enter edits the version stepped to', ev('Enter').r && u.edit.editing?.vid === vs[Math.min(1, vs.length - 1)].id, `${u.edit.editing?.vid}`);
    ok('Esc closes the editor first', u.career.escape() && !u.edit.editing && u.career.sel.what === 'claim');
    ok('then goes up to the entry', u.career.escape() && u.career.sel.what === 'entry');
    ok('then leaves the panel', u.career.escape() && u.career.sel === null);
    ok('and then goes back to the Resume', u.career.escape() === false);
    const r = await makeUi({ resume: 0 });
    r.select({ kind: 'bullet', id: job.highlights[0], job: job.id, section: 'experience' });
    ok('in the Resume Enter edits the version in use', r.edit.key({ key: 'Enter', ctrlKey: false, metaKey: false, preventDefault(){} }) && r.edit.editing?.mode === 'edit');
  }
}
