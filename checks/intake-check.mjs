#!/usr/bin/env node
// node checks/intake-check.mjs
// src/model/intake.js: a dropped file read and joined to the career (the model behind the import screens). What each file of a drop is, what joining it would do
// (new wording, new line, a choice for the person, lines with no home, page clutter dropped), and what applying it does: every new version gets its source, the tag
// `imported` and its document and is never the default, nothing unticked is applied, a document and a log entry are made, every saved resume prints byte for byte as before.
// Real files are the committed fixtures (checks/fixtures/import/); the rest is made here from the example's own text.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as S from '../src/model/schema.js';
import * as X from '../src/model/intake.js';
import * as DOC from '../src/model/documents.js';
import { lexiconFor } from '../src/model/import.js';
import { normText, tombstone } from '../src/model/record.js';
import { fnv } from '../src/store/store.js';
import { loadCatalogue } from '../src/i18n/index.js';
import { createDocument } from '../scripts/lib/dom.mjs';
import { renderPages } from '../src/render.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const FIX = path.join(REPO, 'checks/fixtures/import');
const clone = x => structuredClone(x);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  — ' + extra : ''}`); if (!cond) failed++; };
const section = t => console.log(`\n— ${t}`);
await loadCatalogue('hu');

const base = S.load(read('data/example.json')).model;
S.ensureRecordId(base);
const names = read('data/example-resumes/index.json');
const resumes = names.map(n => ({ ...S.loadResume(read(`data/example-resumes/${n}`), base).recipe, id: n }));
const printed = (record, list) => list.map(r => crypto.createHash('sha256').update(renderPages(record, r, createDocument(), { fallback: true }).pages.map(p => p.outerHTML).join('\n')).digest('hex'));
const state = () => ({ record: clone(base), resumes: clone(resumes), frozen: {}, cur: null, openId: null });
const lexicon = lexiconFor('en');

// a file as the screens hold it: its bytes read, its sha, its date
async function entry(name, bytes, modified = 1000){
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(fs.readFileSync(path.join(FIX, name)));
  return { name, size: bytes.length, modified, bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), read: await X.readFile(bytes, name, { lexicon }) };
}
// a file whose reading is made here: the JSON Resume the parser would give, and the text
function made(name, { work = [], basics = { name: 'Dana Okonkwo' }, extra = {}, leftovers = [], trace = [], lines = [], modified = 1000, status = 'resume' } = {}){
  const text = lines.map(l => l.text).join('\n') || `${name}\n${work.flatMap(w => w.highlights ?? []).join('\n')}`;
  return { name, size: text.length, modified, bytes: new TextEncoder().encode(text), sha256: crypto.createHash('sha256').update(name + text).digest('hex'), status,
    read: { kind: 'md', jsonResume: { basics, work, ...extra }, trace, leftovers, lines: lines.length ? lines : text.split('\n').map(t => ({ text: t, page: 1 })), text, doubts: [], layout: [], boxes: [] } };
}
const job = (over = {}) => ({ name: 'Hydra Medical', position: 'Design Engineer', startDate: '2023-03', highlights: [HYDRA_KEEP], ...over });
const planOf = (st, entries, o = {}) => { X.classify(st, entries); return X.plan(st, entries, { lexicon, ...o }); };
const applied = (st, p, at = '2026-11-01T10:00:00.000Z') => { const d = clone(st); const docs = X.applyPlan(d, p, { at }); return { d, docs }; };
const fact = (rec, id) => rec.facts.find(f => f.id === id);
const textOf = (rec, id) => rec.variants.find(v => v.id === id).text;
const OTHER_PHONE = ['+44', '20', '0000', '0000'].join(' ');      // made here: the privacy scan reads a written-out number as a real one
const HYDRA_KEEP = textOf(base, 'hydra-tolerance-v1');      // a line the career has, so a file's job has a line and is not dropped
const HYDRA = { toler: textOf(base, 'hydra-tolerance-v1'), testing: textOf(base, 'hydra-testing-v1-1'), dfm: textOf(base, 'hydra-dfm-v1-1') };

section('what each file of a drop is');
{
  const st = state();
  const docx = await entry('helix-1col-word.docx'), pdf = await entry('helix-1col-word.pdf');
  X.classify(st, [pdf, docx]);
  ok('a Word file and the PDF of the same resume in one drop: the Word file is read, the PDF is another format of it, whatever the order', docx.status === 'resume' && pdf.status === 'format' && pdf.of.id === DOC.docId(docx.sha256), `${docx.status} ${pdf.status}`);
  const gdocs = await entry('helix-1col-gdocs.pdf');
  X.classify(st, [gdocs]);
  ok('a PDF from another producer, alone, is a resume', gdocs.status === 'resume');
  const letter = await entry('2026-03-12 Northgate - Product Designer (letter).txt', new TextEncoder().encode(['Dear hiring team at Northgate,', '', 'I am writing to apply for the Product Designer role because I enjoy turning rough ideas into tested products that people use.', 'In my last role I led a small team that rebuilt a dose counter and shipped it on schedule to a new manufacturing partner.', 'I would welcome a conversation about how my experience with medical devices could help your design group this year.', '', 'Kind regards,', 'Dana Okonkwo'].join('\n')));
  X.classify(st, [letter]);
  ok('a letter (the parser’s letter doubt) is a cover letter', letter.status === 'letter', letter.read.doubts.map(d => d.kind).join());
  const png = await entry('pic.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])), blob = await entry('x.bin', new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])), json = await entry('a.json', new TextEncoder().encode('{"basics":{"name":"x"}}'));
  X.classify(st, [png, blob, json]);
  ok('a picture and a data file are for their own screens; any other type is kept unread', png.status === 'skip' && json.status === 'skip' && blob.status === 'unread', [png, json, blob].map(e => e.status).join());
  const codes = [];
  for (const [n, b] of [['old.doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new TextEncoder().encode('W\0o\0r\0d\0D\0o\0c\0u\0m\0e\0n\0t')])], ['cut.docx', new Uint8Array(fs.readFileSync(path.join(FIX, 'helix-1col-word.docx'))).subarray(0, 300)], ['nothing.pdf', new TextEncoder().encode('%PDF-1.4\nnot a pdf at all')]])
    try { await X.readFile(b, n, { lexicon }); codes.push('none'); } catch (e) { codes.push(e.code); }
  ok('an old Word file, a cut-short ZIP and a PDF that is none each fail with a code the screen turns into words', codes.join() === 'doc,zip,pdf', codes.join());
  const big = await X.readFile(new Uint8Array(8), 'x.txt', {}).then(() => 'read', e => e.code);
  ok('a file over the size limit is refused with the code big before it is read', await X.readFile({ length: X.MAX_FILE + 1 }, 'x.pdf', {}).then(() => 'read', e => e.code) === 'big' && big === 'read');
  // merged before / again
  const p = planOf(st, [docx, pdf]);
  const { d } = applied(st, p);
  const again = [await entry('helix-1col-word.docx'), await entry('helix-1col-word.pdf'), await entry('helix-1col-word.docx')];
  X.classify(d, again);
  ok('the same files dropped again are merged before: nothing new, and the date is the log’s', again.every(e => e.status === 'seen') && /^2026-11-01/.test(again[0].seen), again.map(e => e.status).join());
  const dup = [await entry('helix-1col-gdocs.pdf'), await entry('helix-1col-gdocs.pdf')];
  X.classify(st, dup);
  ok('a file twice in one drop counts once', dup.filter(e => e.status === 'resume').length === 1 && dup.filter(e => e.status === 'seen').length === 1);
}

section('what joining would do');
{
  const st = state();
  const exact = made('exact.md', { work: [job({ highlights: [HYDRA.toler.replace(/\.$/, '')] })] });      // the same words, but for the full stop
  let p = planOf(st, [exact]);
  ok('a line with the same words (after normText) adds nothing', p.files[0].items.length === 0 && p.files[0].needs.length === 0);

  const near = made('near.md', { work: [job({ highlights: [HYDRA.toler.replace('Built', 'Calculated').replace('caught', 'found')] })] });
  p = planOf(st, [near]);
  const w = p.files[0].items;
  ok('a line with most of a claim’s words is a new wording of that claim: ticked, under its job', w.length === 1 && w[0].as === 'wording' && w[0].kind === 'add' && w[0].on === true && w[0].entry === 'Hydra Medical' && w[0].diff.some(r => r.op === '+'), JSON.stringify(w.map(x => [x.as, x.what])));
  const a = applied(st, p);
  const nv = a.d.record.variants.filter(v => !base.variants.some(b => b.id === v.id));
  ok('it is a new version of that claim, numbered as a sub-version (v1.1 or v1.2), and the claim’s default stays what it was', nv.length === 1 && nv[0].id.startsWith('hydra-tolerance-') && /^1\.\d$/.test(nv[0].n) && JSON.stringify(fact(a.d.record, 'hydra-tolerance').default) === JSON.stringify(fact(base, 'hydra-tolerance').default), JSON.stringify(nv.map(v => [v.id, v.n])));
  ok('the version has a source naming the file and the day, the tag imported (and the career lists the tag) and the document it came from', nv[0].source === 'Imported from near.md, 2026-11-01' && nv[0].tags.includes('imported') && a.d.record.vocabulary.tags.includes('imported') && nv[0].origin?.doc === near.sha256.slice(0, 12), JSON.stringify([nv[0].source, nv[0].tags, nv[0].origin]));

  const line = made('line.md', { work: [job({ highlights: [HYDRA_KEEP, 'Taught the new hires how to read a drawing in a single afternoon'] })] });
  p = planOf(st, [line]);
  ok('a line like none of the job’s is a new line, ticked', p.files[0].items.length === 1 && p.files[0].items[0].as === 'line' && p.files[0].items[0].on === true);
  const b = applied(st, p);
  const added = b.d.record.facts.filter(f => !fact(base, f.id));
  ok('applying it adds a claim to that job, with the same stamps', added.length === 1 && b.d.record.work[0].highlights.includes(added[0].id) && b.d.record.variants.filter(v => !base.variants.some(x => x.id === v.id)).every(v => v.source && v.tags.includes('imported') && v.origin));

  const two = made('two.md', { work: [job({ highlights: [HYDRA_KEEP, `${HYDRA.testing.replace(/\.$/, '')}; ${HYDRA.dfm}`] })] });
  p = planOf(st, [two]);
  ok('a line that fits two claims is a choice for the person, with an option for each and for a new line, and nothing is added until one is picked', p.files[0].needs.length === 1 && p.files[0].needs[0].options.length >= 3 && p.files[0].items.length === 0 && p.files[0].needs[0].chosen === null);
  ok('…left alone it adds nothing and is told as skipped', (() => { const x = applied(st, p); return x.d.record.variants.length === base.variants.length && x.docs[0].taken.skipped.length === 1; })());
  p.files[0].needs[0].chosen = 0;
  ok('…picked, it is a new wording of the claim picked', (() => { const x = applied(st, p); return x.d.record.variants.length === base.variants.length + 1; })());

  p = planOf(st, [made('legal.md', { work: [job({ name: 'HYDRA MEDICAL, Inc.' })] })]);
  ok('the same organisation is told by its name, whatever the case, punctuation or legal form (Inc, Ltd, GmbH, Kft, Zrt): no new job', !p.files[0].items.some(x => x.as === 'job'), JSON.stringify(p.files[0].items.map(x => x.what)));
  ok('…and another organisation is a new job, under its own name', planOf(st, [made('other.md', { work: [job({ name: 'Hydra Systems Ltd' })] })]).files[0].items.some(x => x.as === 'job' && x.entry === 'Hydra Systems Ltd'));

  const moved = made('moved.md', { basics: { name: 'Dana Okonkwo', phone: OTHER_PHONE }, work: [job({ startDate: '2023-04', location: 'Lisbon, Portugal' })] });
  p = planOf(st, [moved]);
  const ch = p.files[0].items.filter(x => x.kind === 'change');
  ok('another value for a detail (a start date, a phone number) is a change, unticked, with both values', ch.length >= 2 && ch.every(x => x.on === false && x.a && x.b) && ch.some(x => x.b === '2023-04'), ch.map(x => `${x.what}: ${x.a} → ${x.b}`).join(' | '));
  const un = applied(st, p);
  ok('…unticked, the career keeps its own', un.d.record.work[0].startDate === '2023-03' && un.d.record.basics.phone === base.basics.phone);
  for (const x of ch) x.on = true;
  ok('…ticked, the file’s value is used', (() => { const x = applied(st, p); return x.d.record.work[0].startDate === '2023-04' && x.d.record.basics.phone === OTHER_PHONE; })());

  const lacking = state(); delete lacking.record.basics.email; lacking.record.work[0].location = '';
  p = planOf(lacking, [made('lacks.md', { basics: { name: 'Dana Okonkwo', email: 'dana@example.org' }, work: [job({ location: 'Lisbon' })] })]);
  ok('a detail the career lacks is added, ticked', p.files[0].items.some(x => x.kind === 'add' && x.b === 'dana@example.org' && x.on) && p.files[0].items.some(x => x.kind === 'add' && x.b === 'Lisbon' && x.on));

  const gone = state();
  const v = gone.record.variants.find(x => x.id === 'hydra-testing-v1-1');
  tombstone(gone.record, 'variant', v.id, v);
  gone.record.variants = gone.record.variants.filter(x => x !== v); fact(gone.record, 'hydra-testing').variants = fact(gone.record, 'hydra-testing').variants.filter(x => x !== v.id);
  p = planOf(gone, [made('back.md', { work: [job({ highlights: [v.text, 'Something else entirely about welding fixtures and jigs'] })] })]);
  const back = p.files[0].items.find(x => x.kind === 'keep');
  ok('a text the person deleted is listed as deleted, unticked, and can be brought back; it is never added ticked', back && back.on === false && /deleted/i.test(back.what) && p.files[0].items.filter(x => x.on).length === 1, JSON.stringify(p.files[0].items.map(x => [x.kind, x.on, x.what])));
}

section('lines with no home');
{
  const st = state();
  const lines = ['Dana Okonkwo', 'Hydra Medical', 'Page 1 of 2', 'Dana Okonkwo · dana@example.org', 'References available on request', 'Referenzen auf Anfrage', '3', 'Fixture design for the line, a thing nobody wrote down', 'Nowhere University, BSc Welding'].map((text, i) => ({ text, page: 1, line: i + 1 }));
  const f = made('left.md', { basics: { name: 'Dana Okonkwo', email: 'dana@example.org' }, lines, work: [job()],
    extra: { education: [{ institution: 'Nowhere University', studyType: 'BSc', area: 'Welding' }] },
    trace: [{ path: 'work.0.name', line: 2 }, { path: 'education.0.institution', line: 9 }],
    leftovers: [...lines.slice(2, 8).map(l => ({ text: l.text, section: 'EXPERIENCE', line: l.line }))] });
  const p = planOf(st, [f]);
  const left = p.files[0].unplaced.map(u => u.text);
  ok('page numbers, "Page 1 of 2", the name and contact repeated, and "references available on request" (in two languages) are dropped without asking', !left.some(t => /^(?:Page|3$|Dana|Referenzen|References)/.test(t)) && left.includes('Fixture design for the line, a thing nobody wrote down'), left.join(' | '));
  ok('a text of the file that is in no part of the career (a school) is listed too, as the line it was on', left.includes('Nowhere University, BSc Welding'));
  ok('every other line is listed under the lines to place, none chosen, the job above it offered first when it sits in the work section', p.files[0].unplaced.every(u => u.choice === '') && p.files[0].unplaced.find(u => u.text.startsWith('Fixture'))?.above === 'hydra', JSON.stringify(p.files[0].unplaced.map(u => [u.section, u.above])));
  const o = X.placeOptions(p, p.files[0].unplaced.find(u => u.text.startsWith('Fixture')));
  ok('the menu offers the jobs (the one above first), the closest claims and the skills lines', o.jobs[0].value === 'job:hydra' && o.jobs.length === base.work.length && o.skills.length >= 1);

  const u0 = p.files[0].unplaced.find(u => u.text.startsWith('Fixture')), u1 = p.files[0].unplaced.find(u => u.text.startsWith('Nowhere'));
  u0.choice = 'job:hydra'; u1.choice = 'skip';
  const a = applied(st, p);
  ok('a line put under a job is a new claim there, stamped; one skipped adds nothing; both leave nothing unplaced', a.d.record.work[0].highlights.length === base.work[0].highlights.length + 1 && a.d.record.variants.length === base.variants.length + 1 + 0 && a.docs[0].taken.unplaced === 0 && a.docs[0].taken.skipped.includes('Nowhere University, BSc Welding'), JSON.stringify(a.docs[0].taken));
  u0.choice = 'claim:hydra-dfm'; u1.choice = 'skills:skills-cad';
  const c = applied(st, p);
  ok('a line put as a wording of a claim, or in a skills line, is a new version of it, never the default', c.d.record.variants.length === base.variants.length + 2 && JSON.stringify(fact(c.d.record, 'hydra-dfm').default) === JSON.stringify(fact(base, 'hydra-dfm').default) && JSON.stringify(fact(c.d.record, 'skills-cad').default) === JSON.stringify(fact(base, 'skills-cad').default)
    && c.d.record.variants.some(v => /^skills-cad/.test(v.id) && /, Nowhere University, BSc Welding$/.test(v.text)));
  u0.choice = ''; u1.choice = '';
  ok('lines left alone stay in the document’s text and are counted as not placed', applied(st, p).docs[0].taken.unplaced === p.files[0].unplaced.length);
}

section('order, and an empty or example career');
{
  const st = state();
  const A = made('older.md', { modified: 1000, work: [job({ highlights: [HYDRA_KEEP, 'Wrote the weekly supplier scorecard for the plant'] })] });
  const B = made('newer.md', { modified: 2000, work: [job({ highlights: [HYDRA_KEEP, 'Wrote the weekly supplier scorecard for the plant'] })] });
  const p = planOf(st, [B, A]);
  ok('several files are merged oldest first: the line both have is added once, by the older', p.files.length === 2 && p.files[0].entry === A && p.files[0].items.length === 1 && p.files[1].items.length === 0);

  const fresh = planOf(st, [made('one.md', { modified: 1000, basics: { name: 'Pat Example' }, work: [job({ name: 'Old Works', highlights: ['Cut scrap on the balloon line by a third'] })] }), made('two.md', { modified: 2000, basics: { name: 'Pat Example' }, work: [job({ name: 'New Works', highlights: ['Led the supplier audits for two plants'] })] })], { fresh: true });
  ok('an empty or example career starts from the newest file, and the older ones are added to it', fresh.start.name === 'two.md' && fresh.files[0].entry === fresh.start && fresh.files[0].base && fresh.files[1].items.some(x => x.kind === 'add' && x.as === 'job'));
  const f = applied(st, fresh);
  ok('applied, the career is the newest file’s with the older one joined, every version stamped, and the saved resumes are the new career’s own', f.d.record.basics.name === 'Pat Example' && f.d.record.work.map(w => w.name).sort().join() === 'New Works,Old Works' && f.d.record.variants.every(v => v.source && v.tags.includes('imported')) && f.d.resumes.length === 0);
}

section('applying: documents, the log, and what must not change');
{
  const st = state(), before = printed(st.record, st.resumes);
  const docx = await entry('helix-1col-word.docx'), pdf = await entry('helix-1col-word.pdf');
  const p = planOf(st, [docx, pdf]);
  for (const u of p.files[0].unplaced) u.choice = 'skip';
  const { d, docs } = applied(st, p);
  ok('every saved resume prints byte for byte the same after the import', JSON.stringify(printed(d.record, d.resumes)) === JSON.stringify(before));
  ok('each file made a document with the id from its sha256, its bytes embedded, its text, its meta and what was taken; the other format links to the first', docs.length === 2 && docs[0].id === DOC.docId(docx.sha256) && docs[0].embedded.startsWith('data:') && docs[0].text.includes('Hydra Medical') && docs[1].of === docs[0].id && docs[0].taken.unplaced === 0 && docs[0].meta.kind === 'resume', JSON.stringify(docs.map(x => [x.id, x.of, x.taken])));
  ok('and each file is in the import log, once', d.imports.length === 2 && d.imports.every(e => /^[0-9a-f]{64}$/.test(e.sha256) && e.at === '2026-11-01T10:00:00.000Z') && DOC.alreadyImported(d, docx.sha256));
  ok('with every line placed or skipped, the receipt’s three ticks are read, in the career and (once the file is checked) kept: safe to delete', (() => {
    const s1 = DOC.safety(docs[0], { lastFileSave: { at: '2026-11-01T11:00:00.000Z' } }), s2 = DOC.safety(docs[0], { checked: { at: '2026-11-01T11:05:00.000Z', ids: [docs[0].id] } });
    return !s1.safe && s1.kept.state === 'saved' && s2.safe && s2.read.ok && s2.record.ok;
  })());
  const un = made('unticked.md', { work: [job({ highlights: ['Taught the new hires how to read a drawing in a single afternoon'] })] });
  const p2 = planOf(st, [un]); p2.files[0].items[0].on = false;
  const x = applied(st, p2);
  ok('nothing unticked is applied, and the file is still kept, with the line told as skipped', x.d.record.variants.length === base.variants.length && x.docs[0].taken.skipped.length === 1 && x.d.imports.length === 1);

  const pdfb2 = await entry('example-b2-en-letter-2pages.pdf');
  X.classify(st, [pdfb2]);
  ok('a PDF with a column the parser does not trust says so', pdfb2.read.doubts.some(d => d.kind === 'columns' && d.page === 2));
  const given = pdfb2.read.layout.map(l => (l.page === 2 ? { ...l, split: 275 } : l));
  const re = X.analyse(pdfb2.read.items, lexicon, given);
  ok('a layout given for the page is used as it is: the page is read again (other lines, other sections as boxes), and the doubt about its columns is gone', fnv(re.text) !== fnv(pdfb2.read.text) && !re.doubts.some(d => d.kind === 'columns') && re.layout.find(l => l.page === 2).split === 275 && re.boxes.some(b => b.page === 2));
  pdfb2.layout = given; pdfb2.read = { ...pdfb2.read, ...re };
  const pb = planOf(st, [pdfb2]);
  ok('the layout the person left is kept with the document', applied(st, pb).docs[0].layout.find(l => l.page === 2).split === 275);
}

section('a cover letter');
{
  const st = state();
  st.resumes[0].company = ''; st.resumes[0].role = 'Product Designer';
  st.resumes[1].company = 'Northgate'; st.resumes[1].role = 'Product Designer'; st.resumes[1].round = 'r-spring';
  const text = ['Dear hiring team at Northgate,', '', 'I am writing to apply for the Product Designer role because I enjoy turning rough ideas into tested products that people use.', 'In my last role I led a small team that rebuilt a dose counter and shipped it on schedule to a new manufacturing partner.', 'I would welcome a conversation about how my experience with medical devices could help your design group this year.', '', 'Kind regards,', 'Dana Okonkwo'].join('\n');
  const letter = await entry('2026-03-12 Northgate - Product Designer (letter).txt', new TextEncoder().encode(text));
  const docx = await entry('helix-1col-word.docx');
  const p = planOf(st, [letter, docx]);
  const l = p.files.find(f => f.entry === letter);
  ok('the letter is listed with the sentences none of the career’s lines covers, unticked (nothing placed), and the saved resume for that role with no company is offered the letter’s company, unticked', l.unplaced.length === 3 && l.unplaced.every(u => u.choice === '' && u.section === 'letter') && l.items.length === 1 && l.items[0].on === false && l.items[0].b === 'Northgate', JSON.stringify([l.unplaced.length, l.items.map(x => [x.what, x.on])]));
  const a = applied(st, p);
  const doc = a.docs.find(x => x.meta.kind === 'cover-letter');
  ok('it goes to the Library as a cover letter and its wording is not in the career: no claim, no version, no job of its own', doc && a.d.record.work.length === base.work.length && !a.d.record.variants.some(v => v.origin?.doc === letter.sha256.slice(0, 12)) && !a.d.record.facts.some(f => f.id !== 'summary' && fact(base, f.id) === undefined && /Northgate/.test(textOf(a.d.record, f.variants[0]))));
  ok('dropped with a resume it is linked to it; it joins the saved resume with the same company and role, and that resume’s round; the company and role are the file name’s', doc.with === DOC.docId(docx.sha256) && doc.resume === st.resumes[1].id && doc.round === 'r-spring' && doc.meta.company === 'Northgate' && doc.meta.role === 'Product Designer' && doc.meta.date === '2026-03-12');
  ok('the offer left unticked changes nothing', a.d.resumes[0].company === '');
  l.items[0].on = true;
  ok('ticked, the saved resume gets the company', applied(st, p).d.resumes[0].company === 'Northgate');
  ok('and the same letter again is merged before', (() => { X.classify(a.d, [letter]); return letter.status === 'seen'; })());
}

process.exit(failed ? 1 : 0);
