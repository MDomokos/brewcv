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
import { fromJsonResume, lexiconFor } from '../src/model/import.js';
import * as B from '../src/model/build.js';
import { t } from '../src/i18n/index.js';
import { normText, tombstone } from '../src/model/record.js';
import { fnv } from '../src/store/store.js';
import { loadCatalogue } from '../src/i18n/index.js';
import { createDocument } from '../scripts/lib/dom.mjs';
import { renderPages } from '../src/render.js';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const FIX = path.join(REPO, 'checks/fixtures/import');
const clone = x => structuredClone(x);
const J = x => JSON.stringify(x);
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

// a file as the screens hold it: its bytes read, its sha, its date
async function entry(name, bytes, modified = 1000){
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(fs.readFileSync(path.join(FIX, name)));
  return { name, size: bytes.length, modified, bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), read: await X.readFile(bytes, name, {}) };
}
// a file whose reading is made here: the JSON Resume the parser would give, and the text
function made(name, { work = [], basics = { name: 'Dana Okonkwo' }, extra = {}, leftovers = [], trace = [], lines = [], modified = 1000, status = 'resume', lang = 'en' } = {}){
  const text = lines.map(l => l.text).join('\n') || `${name}\n${work.flatMap(w => w.highlights ?? []).join('\n')}`;
  return { name, size: text.length, modified, bytes: new TextEncoder().encode(text), sha256: crypto.createHash('sha256').update(name + text).digest('hex'), status,
    read: { kind: 'md', jsonResume: { basics, work, ...extra }, trace, leftovers, lines: lines.length ? lines : text.split('\n').map(t => ({ text: t, page: 1 })), text, doubts: [], layout: [], boxes: [], lang } };
}
const job = (over = {}) => ({ name: 'Hydra Medical', position: 'Design Engineer', startDate: '2023-03', highlights: [HYDRA_KEEP], ...over });
const planOf = (st, entries, o = {}) => { X.classify(st, entries); return X.plan(st, entries, o); };
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
    try { await X.readFile(b, n, {}); codes.push('none'); } catch (e) { codes.push(e.code); }
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
  ok('a text the person deleted is listed apart (kept, unticked, with a way to bring it back); it is never added ticked', back && back.kind === 'keep' && back.on === false && typeof back.apply === 'function' && p.files[0].items.filter(x => x.on).length === 1, JSON.stringify(p.files[0].items.map(x => [x.kind, x.on, x.what])));
}

section('lines with no home');
{
  const st = state();
  const lines = ['Dana Okonkwo', 'Hydra Medical', 'Page 1 of 2', 'Dana Okonkwo · dana@example.org', 'References available on request', 'Referenzen auf Anfrage', '3', 'Fixture design for the line, a thing nobody wrote down', 'Skills: Welding fixtures'].map((text, i) => ({ text, page: 1, line: i + 1 }));
  const f = made('left.md', { basics: { name: 'Dana Okonkwo', email: 'dana@example.org' }, lines, work: [job()],
    extra: { skills: [{ name: 'Skills', keywords: ['Welding fixtures'] }] },
    trace: [{ path: 'work.0.name', line: 2 }, { path: 'skills.0.keywords.0', line: 9 }],
    leftovers: [...lines.slice(2, 8).map(l => ({ text: l.text, section: 'EXPERIENCE', line: l.line }))] });
  const p = planOf(st, [f]);
  const left = p.files[0].unplaced.map(u => u.text);
  ok('page numbers, "Page 1 of 2", the name and contact repeated, and "references available on request" (in two languages) are dropped without asking', !left.some(t => /^(?:Page|3$|Dana|Referenzen|References)/.test(t)) && left.includes('Fixture design for the line, a thing nobody wrote down'), left.join(' | '));
  ok('a text of the file that is in no part of the career (a skill) is listed too, as the line it was on', left.includes('Skills: Welding fixtures'));
  ok('every other line is listed under the lines to place, none chosen, the job above it offered first when it sits in the work section', p.files[0].unplaced.every(u => u.choice === '') && p.files[0].unplaced.find(u => u.text.startsWith('Fixture'))?.above === 'hydra', JSON.stringify(p.files[0].unplaced.map(u => [u.section, u.above])));
  const o = X.placeOptions(p, p.files[0].unplaced.find(u => u.text.startsWith('Fixture')));
  ok('the menu offers the jobs (the one above first), the closest claims and the skills lines', o.jobs[0].value === 'job:hydra' && o.jobs.length >= base.work.length && o.skills.length >= 1 && ['list:languages', 'list:certificates', 'list:interests', 'list:publications', 'list:education'].every(v => o.sections.some(x => x.value === v)));

  const u0 = p.files[0].unplaced.find(u => u.text.startsWith('Fixture')), u1 = p.files[0].unplaced.find(u => u.text.startsWith('Skills:'));
  u0.choice = 'job:hydra'; u1.choice = 'skip';
  const a = applied(st, p);
  ok('a line put under a job is a new claim there, stamped; one skipped adds nothing; both leave nothing unplaced', a.d.record.work[0].highlights.length === base.work[0].highlights.length + 1 && a.d.record.variants.length === base.variants.length + 1 + 0 && a.docs[0].taken.unplaced === 0 && a.docs[0].taken.skipped.includes('Skills: Welding fixtures'), JSON.stringify(a.docs[0].taken));
  u0.choice = 'claim:hydra-dfm'; u1.choice = 'skills:skills-cad';
  const c = applied(st, p); 
  ok('a line put as a wording of a claim, or in a skills line, is a new version of it, never the default', c.d.record.variants.length === base.variants.length + 2 && JSON.stringify(fact(c.d.record, 'hydra-dfm').default) === JSON.stringify(fact(base, 'hydra-dfm').default) && JSON.stringify(fact(c.d.record, 'skills-cad').default) === JSON.stringify(fact(base, 'skills-cad').default)
    && c.d.record.variants.some(v => /^skills-cad/.test(v.id) && /, Skills: Welding fixtures$/.test(v.text)));
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
  const lib = { ...st, ...read('data/example-library.json') }, one = made('one.md', { modified: 1000, basics: { name: 'Pat Example' }, work: [job({ name: 'Old Works', highlights: ['Cut scrap on the balloon line by a third'] })] });
  const g = applied(lib, planOf(lib, [one], { fresh: true }));
  ok('…and the example’s own documents, rounds and import log go with it: the Library holds only the new file', lib.documents.length > 1 && lib.rounds.length && g.d.documents.length === 1 && g.d.documents[0].name === 'one.md' && !g.d.rounds && g.d.imports.length === 1 && !g.d.documents[0].round);
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
  const re = X.analyse(pdfb2.read.items, lexiconFor('en'), given);
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


section('the Library: the current round, the lines left to place, the nearest resume for a letter');
{
  const st = state();
  const docx = await entry('helix-1col-word.docx'), pdf = await entry('helix-1col-word.pdf');
  const p0 = planOf(st, [docx, pdf]);
  const none = applied(st, p0);
  ok('with no round started an import has no round (a file is as it always was)', none.docs.every(d => !('round' in d)));
  const withR = { ...st, rounds: [{ id: 'r-old', name: 'Spring', from: '2027-01-01', to: '2027-06-01' }, { id: 'r-now', name: 'Autumn', from: '2027-06-01' }] };
  const p1 = planOf(withR, [docx, pdf]);
  const a = applied(withR, p1);
  ok('with rounds, every file of an import goes into the current round (the newest not archived)', a.docs.length === 2 && a.docs.every(d => d.round === 'r-now') && applied({ ...withR, rounds: [...withR.rounds.slice(0, 1), { ...withR.rounds[1], archived: true }] }, planOf(withR, [docx, pdf])).docs.every(d => d.round === 'r-old'));
  const left = p1.files[0].unplaced.map(u => u.text);
  ok('the lines left with no home are kept on the document, in the order of the file, as many as it says are unplaced', left.length > 2 && J(a.docs[0].taken.lines) === J(left) && a.docs[0].taken.unplaced === left.length);
  p1.files[0].unplaced[0].choice = 'skip';
  const b = applied(withR, p1);
  ok('a line the person put away is no longer listed as unplaced, and is told as skipped', b.docs[0].taken.lines.length === left.length - 1 && !b.docs[0].taken.lines.includes(left[0]) && b.docs[0].taken.skipped.some(x => left[0].startsWith(x.replace(/…$/, ''))));

  // a letter named for a company and role that two saved resumes share: the nearest in date is offered it
  const text = ['Dear hiring team at Northgate,', '', 'I am writing to apply for the Product Designer role because I enjoy turning rough ideas into tested products that people use.', 'In my last role I led a small team that rebuilt a dose counter and shipped it on schedule to a new manufacturing partner.', 'I would welcome a conversation about how my experience with medical devices could help your design group this year.', '', 'Kind regards,', 'Dana Okonkwo'].join('\n');
  const letter = await entry('2026-03-12 Northgate - Product Designer (letter).txt', new TextEncoder().encode(text));
  const two = state();
  for (const [i, d] of [[0, '2025-01-10'], [1, '2026-03-01'], [2, '2026-12-01']]) { two.resumes[i].company = 'Northgate'; two.resumes[i].role = 'Product Designer'; two.resumes[i].savedAt = d; }
  const pl = planOf(two, [letter]);
  ok('a letter goes with the saved resume of that company and role that is nearest to its date', pl.files[0].resume === two.resumes[1].id);
}

section('a removed document, and the first page’s picture');
{
  const st = state();
  const docx = await entry('helix-1col-word.docx');
  docx.thumb = `${['data:image', '/png;base64,'].join('')}${'B'.repeat(2000)}`;      // built here: the privacy scan reads a written-out image as a portrait
  const first = applied(st, planOf(st, [docx]));
  ok('the picture of a first page the screen drew is kept with the document', first.docs[0].thumb === docx.thumb);
  const gone = clone(first.d);
  DOC.removeDocuments(gone, [first.docs[0].id]);
  ok('a document the person removed was imported before (the log has it), but is not "merged before"', DOC.alreadyImported(gone, docx.sha256) && !DOC.findBySha(gone, docx.sha256));
  const again = await entry('helix-1col-word.docx');
  X.classify(gone, [again]);
  ok('dropped again it is read, not "merged before", and says when it was deleted', again.status !== 'seen' && again.deleted === gone.record.removed[`document:${first.docs[0].id}`].at && /^\d{4}-\d\d-\d\d$/.test(again.deleted));
  const back = applied(gone, planOf(gone, [again]));
  ok('importing it brings it back: the document is there again with its original and the mark is gone', back.d.documents.some(d => d.id === first.docs[0].id && d.embedded) && !back.d.record.removed?.[`document:${first.docs[0].id}`]);
  const fresh2 = await entry('helix-1col-word.docx'); X.classify(first.d, [fresh2]);
  ok('a document that was never removed is still "merged before"', fresh2.status === 'seen' && !('deleted' in fresh2));
}

section('only an empty career, or the example, starts from a file');
{
  const blank = { record: B.blankRecord({}), resumes: [], frozen: {} };
  ok('a career with no name, summary, skills, entries or saved resumes is empty', X.isEmpty(blank));
  const named = clone(blank); named.record.basics.name = 'Pat Example';
  ok('one with only a name is not empty', !X.isEmpty(named));
  const sums = clone(blank); B.setSummary(sums.record, 'A summary in a few words');
  ok('…nor one with only a summary, only a skill, only a saved resume or only a school', !X.isEmpty(sums) && !X.isEmpty({ ...blank, record: (() => { const r = clone(blank.record); B.setSkills(r, [{ name: 'Tools', keywords: ['a'] }]); return r; })() })
    && !X.isEmpty({ ...blank, resumes: [{ id: 'r.json' }] }) && !X.isEmpty({ ...blank, record: (() => { const r = clone(blank.record); B.setEducation(r, { institution: 'Somewhere' }); return r; })() }));
  const nojobs = state(); nojobs.record.work = []; nojobs.record.sections = nojobs.record.sections.filter(s => s.id !== 'experience');
  ok('a career with no jobs but a name, skills and saved resumes is not empty, and the example is not', !X.isEmpty(nojobs) && !X.isEmpty(state()));
  const f = made('start.md', { modified: 5000, work: [job()] });
  const p = planOf(nojobs, [f], { fresh: X.isEmpty(nojobs) });
  const a = applied(nojobs, p);
  ok('so a file is joined to it: its name, skills and saved resumes are still there', !p.start && a.d.resumes.length === nojobs.resumes.length && a.d.record.skills.length === nojobs.record.skills.length && a.d.record.basics.name === base.basics.name);
}

section('the language of a file and of what it adds');
{
  const st = state();
  const hu = textOf(base, 'hydra-testing-v1-hu');
  const word = made('hu-word.md', { lang: 'hu', work: [job({ highlights: [HYDRA_KEEP, hu.replace(/^\S+/, 'Összeállítottam')] })] });
  const line = made('hu-line.md', { lang: 'hu', work: [job({ highlights: [HYDRA_KEEP, 'Szerszámkészítő műhely vezetése három évig a gyárban'] })] });
  let p = planOf(st, [word]);
  const w = p.files[0].items.find(x => x.as === 'wording');
  ok('a new wording matched to a Hungarian version is a Hungarian version, whatever the file’s language', !!w && applied(st, p).d.record.variants.some(v => !base.variants.some(b => b.id === v.id) && v.lang === 'hu' && v.id.startsWith('hydra-testing')), JSON.stringify(p.files[0].items.map(x => x.what)));
  p = planOf(st, [made('en-word.md', { lang: 'en', work: [job({ highlights: [HYDRA_KEEP, HYDRA.toler.replace('Built', 'Calculated')] })] })]);
  ok('and an English one is English', applied(st, p).d.record.variants.filter(v => !base.variants.some(b => b.id === v.id)).every(v => v.lang === 'en'));
  p = planOf(st, [line]);
  const d = applied(st, p).d, fresh = d.record.variants.filter(v => !base.variants.some(b => b.id === v.id));
  ok('a new line takes the language of the file: a Hungarian version beside the English base the career needs', fresh.some(v => v.lang === 'hu' && /Szerszámkészítő/.test(v.text)) && fresh.some(v => v.lang === 'en' && /Szerszámkészítő/.test(v.text)) && !fresh.some(v => v.lang === 'en' && /Design Engineer/.test(v.text)));
  u: {
    const u = made('hu-place.md', { lang: 'hu', work: [job()], leftovers: [{ text: 'Egy sor, amit nem tudtunk elhelyezni sehova', section: 'EXPERIENCE', line: 3 }] });
    const q = planOf(st, [u]); q.files[0].unplaced[0].choice = 'job:hydra';
    ok('a line placed by hand takes the file’s language too', applied(st, q).d.record.variants.some(v => v.lang === 'hu' && /Egy sor, amit/.test(v.text)));
  }
  const bytes = new Uint8Array(fs.readFileSync(path.join(FIX, 'example-b2-hu-a4.pdf')));
  const en = await X.readFile(bytes, 'hu.pdf', { lang: 'en', fixed: true }), auto = await X.readFile(bytes, 'hu.pdf', { lang: 'en' });
  ok('a Hungarian PDF read in English has no jobs; read with every language it is found to be Hungarian, with its jobs', (en.jsonResume.work ?? []).length === 0 && auto.lang === 'hu' && (auto.jsonResume.work ?? []).length >= 3, `${en.lang} ${(auto.jsonResume.work ?? []).length} ${auto.lang}`);
  const pt = await X.readFile(new Uint8Array(fs.readFileSync(path.join(FIX, 'example-b2-pt-a4.pdf'))), 'pt.pdf', { lang: 'en' });
  ok('and a Portuguese one Portuguese', pt.lang === 'pt' && (pt.jsonResume.work ?? []).length >= 3);
  const clean = await X.readFile(new Uint8Array(fs.readFileSync(path.join(FIX, 'helix-1col-word.docx'))), 'w.docx', { lang: 'en' });
  ok('a file that reads cleanly in the language asked for is left in it', clean.lang === 'en');
  const again = X.readIn(auto.items, 'en');
  ok('the person can read it again in another language', again.lang === 'en' && (again.jsonResume.work ?? []).length === 0 && X.readIn(auto.items, 'hu').lang === 'hu');
  const fj = fromJsonResume({ basics: { name: 'Pat' }, work: [{ name: 'Műhely Kft.', position: 'Vezető', startDate: '2020-01', highlights: ['Három évig vezettem a műhelyt'] }] }, 'hu').model;
  ok('a job of a Hungarian file has Hungarian versions', fj.variants.some(v => v.lang === 'hu' && /vezettem/.test(v.text)));
}

section('a revised resume is not swallowed as another format');
{
  const st = state();
  const lines = base.variants.filter(v => v.lang === 'en').map(v => v.text).slice(0, 30).map(text => ({ text, page: 1 }));
  st.documents = [{ id: 'doc-aaaaaaaaaaaa', name: 'old.docx', sha256: 'a'.repeat(64), size: 1, type: 'x', addedAt: '2026-01-01T00:00:00.000Z', meta: { kind: 'resume' }, text: lines.map(l => l.text).join('\n'), taken: {} }];
  const same = made('copy.pdf', { lines, work: [job()] });
  const revised = made('revised.pdf', { lines: lines.map((l, i) => (i === 3 ? { ...l, text: HYDRA.toler.replace('Built', 'Calculated') } : l)), work: [job({ highlights: [HYDRA_KEEP, HYDRA.toler.replace('Built', 'Calculated')] })] });
  X.classify(st, [same]); X.classify(st, [revised]);
  ok('a copy and a revision of a document in the Library are both linked to it (another format of it)', same.status === 'format' && revised.status === 'format' && revised.of.id === 'doc-aaaaaaaaaaaa');
  let p = X.plan(st, [same], {});
  ok('an exact copy has nothing new: the screens may say so', same.news === false && p.files[0].items.length === 0 && p.files[0].unplaced.length === 0);
  p = X.plan(st, [revised], {});
  ok('a revised copy still has its changed line planned as a new wording, and is not "nothing new"', revised.news === true && p.files[0].items.some(x => x.as === 'wording' && x.on), JSON.stringify(p.files[0].items.map(x => x.what)));
  const a = applied(st, p);
  ok('applied, the new wording is in the career and the file is a document linked to the old one', a.d.record.variants.length === base.variants.length + 1 && a.docs[0].of === 'doc-aaaaaaaaaaaa');
  const letterDoc = { ...st.documents[0], id: 'doc-bbbbbbbbbbbb', name: 'letter.docx', sha256: 'b'.repeat(64), meta: { kind: 'cover-letter' }, text: lines.map(l => `x ${l.text}`).join('\n') };
  const stl = { ...state(), documents: [letterDoc] };
  const pdfOfLetter = made('letter.pdf', { lines: lines.map(l => ({ ...l, text: `x ${l.text}` })), work: [job()] });
  X.classify(stl, [pdfOfLetter]);
  const b = applied(stl, X.plan(stl, [pdfOfLetter], {}));
  ok('a PDF copy of a cover letter is a cover letter, and puts nothing in the career', pdfOfLetter.status === 'format' && b.docs[0].meta.kind === 'cover-letter' && b.d.record.variants.length === base.variants.length);
}

section('education and projects are entries, and another section can take a line');
{
  const st = state();
  const fileOf = (extra, more = {}) => made('entries.md', { work: [job()], extra, ...more });
  let p = planOf(st, [fileOf({ education: [{ institution: 'universidade do porto', studyType: 'M.Eng.', area: 'Mechanical Engineering', startDate: '2016-09', endDate: '2022-07' }] })]);
  const it = p.files[0].items.filter(x => x.entry === 'Universidade do Porto');
  ok('a school of the career is matched by its name, whatever the case: the one different value (an end date) is a change, unticked, and nothing new is added', it.length === 1 && it[0].kind === 'change' && it[0].on === false && it[0].a === '2021-07' && it[0].b === '2022-07' && !p.files[0].items.some(x => x.what === t('i6.newSchool')), JSON.stringify(it.map(x => [x.what, x.kind, x.a, x.b])));
  const un = applied(st, p); ok('…left unticked, the career keeps its own date', un.d.record.education[0].endDate === '2021-07');
  it[0].on = true; ok('…ticked, the file’s is used', applied(st, p).d.record.education[0].endDate === '2022-07');
  p = planOf(st, [fileOf({ education: [{ institution: 'Politehnica Timisoara', studyType: 'BSc', area: 'Physics', endDate: '2014-07' }] })]);
  const ns = p.files[0].items.find(x => x.entry === 'Politehnica Timisoara');
  ok('a school the career lacks is a new entry, ticked', ns?.kind === 'add' && ns.on === true && ns.as === 'job');
  const ad = applied(st, p).d;
  ok('applied, it is one more education entry, and the first is as it was', ad.record.education.length === 2 && ad.record.education[0].institution === st.record.education[0].institution && ad.record.education[1].institution === 'Politehnica Timisoara');
  const proj = base.projects[0];
  p = planOf(st, [fileOf({ projects: [{ name: proj.name, highlights: ['Machined the base from one billet of aluminium and anodised it black for the shop'] }, { name: 'A wholly new side project', startDate: '2023-01', highlights: ['Wrote the firmware for a small tide clock'] }] })]);
  const pi = p.files[0].items;
  ok('a project of the career is matched by its name and its new line is offered under it; a project the career lacks is a new entry', pi.some(x => x.as === 'line' && x.entry === proj.name && x.on) && pi.some(x => x.as === 'job' && x.entry === 'A wholly new side project'), JSON.stringify(pi.map(x => [x.as, x.entry])));
  const pd = applied(st, p).d, pp = pd.record.projects;
  ok('applied, the line is a claim of that project and the new project has its own line, both stamped', pp.find(x => x.id === proj.id).highlights.length === proj.highlights.length + 1 && pp.some(x => x.name === 'A wholly new side project' && x.highlights.length === 1)
    && pd.record.variants.filter(v => !base.variants.some(b => b.id === v.id)).every(v => v.source && v.tags.includes('imported')));
  const f2 = made('lists.md', { work: [job()], leftovers: ['Hungarian: B2', 'Safety Officer Certificate 2022', 'Collecting old tools'].map((text, i) => ({ text, section: 'Other', line: 5 + i })) });
  p = planOf(st, [f2]);
  const o = X.placeOptions(p, p.files[0].unplaced[0]);
  ok('the menu offers another section: languages, certificates, interests, publications, education', ['languages', 'certificates', 'interests', 'publications', 'education'].every(k => o.sections.some(x => x.value === `list:${k}`)));
  p.files[0].unplaced[0].choice = 'list:languages'; p.files[0].unplaced[1].choice = 'list:certificates'; p.files[0].unplaced[2].choice = 'list:interests';
  const ls = applied(st, p);
  ok('a line put there is an item of that list, with its parts (a language and its level), stamped, and nothing is left unplaced', ls.d.record.languages.some(l => l.language === 'Hungarian' && l.fluency === 'B2') && ls.d.record.certificates.some(c => /Safety Officer/.test(c.name)) && ls.d.record.interests.some(c => /old tools/.test(c.name)) && ls.docs[0].taken.unplaced === 0
    && ls.d.record.variants.filter(v => !base.variants.some(b => b.id === v.id)).every(v => v.source && v.tags.includes('imported')));
}

section('what the first reading cannot tell: a file read in another way gives the same plan once its language is set');
{
  const bytes = new Uint8Array(fs.readFileSync(path.join(FIX, 'example-b2-hu-a4.pdf')));
  const e = await entry('hu.pdf', bytes);
  const st = state();
  X.classify(st, [e]);
  ok('a Hungarian file read with the interface in English is planned as Hungarian: its jobs found, its new lines Hungarian', e.read.lang === 'hu' && X.plan(st, [e], {}).files[0].items.some(x => x.as === 'job'));
}

process.exit(failed ? 1 : 0);
