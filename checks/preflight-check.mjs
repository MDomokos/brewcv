#!/usr/bin/env node
// node checks/preflight-check.mjs
// preflight-deploy has to refuse an image that carries embedded provenance metadata and a prototypes/ folder,
// and has to accept the same tree without them. Images are built here from bytes, since *.png is gitignored. The import fixtures (PDF, DOCX, ODT) may be in the tree only with their metadata stripped.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { zip } from './lib/zip.mjs';
import { pdf } from './lib/pdf.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const script = path.join(here, 'preflight-deploy.mjs');

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => {
  const t = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); t.copy(out, 4); out.writeUInt32BE(crc(t), 8 + data.length);
  return out;
};
const png = (...extra) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra,
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
};

function run(name, setup){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
  fs.mkdirSync(path.join(dir, 'icons'));
  setup(dir);
  const r = spawnSync('node', [script, dir], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return r.stdout + r.stderr;
}

let bad = 0;
const expect = (label, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) bad++; };
const META = 'provenance metadata';

expect('a clean PNG is accepted', !run('clean', d => fs.writeFileSync(path.join(d, 'icons/icon-192.png'), png())).includes(META));
expect('a PNG with a caBX chunk is refused', run('cabx', d => fs.writeFileSync(path.join(d, 'icons/icon-192.png'), png(chunk('caBX', Buffer.from('jumb'))))).includes(META));
expect('a PNG with an XMP packet is refused', run('xmp', d => fs.writeFileSync(path.join(d, 'icons/icon-192.png'), png(chunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta></x:xmpmeta>'))))).includes(META));
expect('a clean SVG is accepted', !run('svg', d => fs.writeFileSync(path.join(d, 'icons/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')).includes(META));
expect('an SVG with a c2pa manifest is refused', run('svg2', d => fs.writeFileSync(path.join(d, 'icons/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><metadata>c2pa.manifest</metadata></svg>')).includes(META));
expect('a prototypes/ folder is refused', run('proto', d => { fs.mkdirSync(path.join(d, 'prototypes')); fs.writeFileSync(path.join(d, 'prototypes/a.html'), '<p>x</p>'); }).includes('prototypes live outside the repo'));

const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP')]);
const SHIPS = 'the only images that ship';
expect('a README picture in docs/intro is accepted', !run('webp', d => { fs.mkdirSync(path.join(d, 'docs/intro'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/intro/a.webp'), webp); }).includes(SHIPS));
expect('a picture anywhere else is refused', run('webp2', d => { fs.mkdirSync(path.join(d, 'docs'), { recursive: true }); fs.writeFileSync(path.join(d, 'docs/a.webp'), webp); }).includes(SHIPS));
expect('a font unicode-range is not a phone number', !run('range', d => fs.writeFileSync(path.join(d, 'a.css'), '@font-face { unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC; }')).includes('phone number'));
expect('the two minified PDF.js files (exactly) are not read for phone numbers and addresses (only for private values and images), any other file is', !run('vendor', d => { fs.mkdirSync(path.join(d, 'vendor/pdfjs'), { recursive: true }); fs.writeFileSync(path.join(d, 'vendor/pdfjs/pdf.min.mjs'), 'x=+386' + '4292196,y="jm@kbswfq' + '.pkbgltMlwbaof"'); }).match(/phone number|email address/)
  && run('vendor2', d => { fs.mkdirSync(path.join(d, 'vendor/pdfjs'), { recursive: true }); fs.writeFileSync(path.join(d, 'vendor/pdfjs/other.mjs'), 'y="jm@kbswfq' + '.pkbgltMlwbaof"'); }).includes('email address'));
expect('a phone number still is', run('phone', d => fs.writeFileSync(path.join(d, 'a.md'), 'Call +44' + ' 7700 900123 today')).includes('phone number'));

// The import fixtures (checks/fixtures/import/) are the one place PDF, DOCX and ODT files may be: by name and sha256 in MANIFEST.json, and their text is read too
const STAY = 'rendered documents and resume files stay outside the repo', CONTENT = 'fixture content', FIXMETA = 'fixture metadata';
const hex256 = b => crypto.createHash('sha256').update(b).digest('hex');
const doc = (T, y = 700) => ({ x: 57, y, text: T });
const clean = () => Buffer.from(pdf([[doc('Jane Q. Sample'), doc('dana@example.org', 680), doc('+351 900 000 000', 660)]], { flate: true }));
// a tree with the files at the paths given; `listed` are the ones the manifest names, by the hash of the bytes the manifest was made from
const tree = (files, listed = Object.keys(files).filter(f => f.startsWith('checks/fixtures/import/')), made = {}) => d => {
  for (const [f, b] of Object.entries(files)){ fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), b); }
  fs.mkdirSync(path.join(d, 'checks/fixtures/import'), { recursive: true });
  fs.writeFileSync(path.join(d, 'checks/fixtures/import/MANIFEST.json'), JSON.stringify({ files: Object.fromEntries(listed.map(f => [f.replace('checks/fixtures/import/', ''), hex256(made[f] ?? files[f])])) }));
};
const F = 'checks/fixtures/import/helix-1col-word.pdf';
const refused = (name, files, listed, made) => { const out = run(name, tree(files, listed, made)); return out.includes(STAY) || out.includes(CONTENT) || out.includes(FIXMETA); };
expect('a listed fixture PDF, with only the fictional person\'s address and number in its (deflated) text, is accepted', !refused('fx', { [F]: clean() }));
expect('a PDF anywhere else is refused, listed or not by name', refused('fx1', { 'docs/a.pdf': clean() }) && refused('fx1b', { 'docs/a.pdf': clean() }, ['docs/a.pdf']));
expect('a PDF in a dot folder, and one in a folder .gitignore names, is refused (the deploy tree carries the .gitignore)', refused('fx2', { '.cache/a.pdf': clean() }) && run('fx2b', d => { tree({ 'checks/fixtures/import/b.pdf': clean() }, [])(d); fs.writeFileSync(path.join(d, '.gitignore'), '*.pdf\n'); }).includes(STAY));
expect('a fixture that is not listed, or listed under another name, is refused', refused('fx3', { [F]: clean() }, []) && refused('fx3b', { 'checks/fixtures/import/other.pdf': clean() }, [], {}));
const changed = Buffer.concat([clean(), Buffer.from('\n% one more byte')]);
expect('a changed byte is refused until the manifest is updated: the same file, listed by its old hash', refused('fx4', { [F]: changed }, [F], { [F]: clean() }) && !refused('fx4b', { [F]: changed }, [F]));
expect('an incremental update that adds /Author, an Info key outside the usual ones and an indirect value is refused: the bytes are not the listed ones', refused('fx5', { [F]: Buffer.concat([clean(), Buffer.from('\n7 0 obj\n(Someone)\nendobj\n8 0 obj\n<< /Author 7 0 R /Company (X) >>\nendobj\ntrailer\n<< /Info 8 0 R >>\n%%EOF\n')]) }, [F], { [F]: clean() }));
expect('a listed PDF with an address that is not the fictional person\'s, in its compressed text or in a hex string, is refused', run('fx6', tree({ [F]: Buffer.from(pdf([[doc('Write to ' + 'someone@gmail.' + 'com')]], { flate: true })) })).includes(CONTENT) && run('fx6b', tree({ [F]: Buffer.concat([clean(), Buffer.from('\n/Author <' + Buffer.from('a@real' + 'mail.com').toString('hex') + '>\n')]) })).includes(CONTENT));
expect('a listed PDF with a phone number that is not the fictional person\'s is refused', run('fx7', tree({ [F]: Buffer.from(pdf([[doc('Call +44' + ' 7700 900123')]], { flate: true })) })).includes(CONTENT));
expect('a listed PDF that no reader can open is refused', run('fx8', tree({ [F]: Buffer.from('%PDF-1.4 not really') })).includes(CONTENT));
const odt = x => Buffer.from(zip({ 'content.xml': '<office:document-content>' + x + '</office:document-content>', 'meta.xml': '<office:meta/>' }));
const G = 'checks/fixtures/import/helix-1col-word.odt', DX = 'checks/fixtures/import/helix-1col-word.docx';
expect('a listed ODT or DOCX is accepted, one with an address in any part (comments, a tracked change\'s author, customXml, meta) is refused, and an ODT or DOCX not listed is refused',
  !refused('fx9', { [G]: odt('<text:p>Dana</text:p>') }) && refused('fx9b', { [G]: odt('<text:p>Dana</text:p>') }, []) && refused('fx9c', { [DX]: Buffer.from(zip({ 'word/document.xml': '<w:p/>' })) }, [])
  && run('fx9d', tree({ [DX]: Buffer.from(zip({ 'word/document.xml': '<w:p/>', 'word/comments.xml': '<w:comment w:author="x@someone.' + 'org"/>' })) })).includes(FIXMETA)
  && run('fx9e', tree({ [DX]: Buffer.from(zip({ 'word/document.xml': '<w:p/>', 'customXml/item1.xml': '<a>+44' + ' 7700 900123</a>' })) })).includes(FIXMETA));
// renamed files are told by their bytes
const PDFB = clean(), real = 'docs/real.bin', docxZip = Buffer.from(zip({ 'word/document.xml': '<w:p/>' })), odtZip = Buffer.from(zip({ 'content.xml': '<a/>', 'mimetype': 'application/vnd.oasis.opendocument.text' })), nested = Buffer.from(zip({ 'cv.pdf': PDFB }));
expect('a PDF renamed docs/real.bin, docs/resume (no extension), or checks/fixtures/import/real.bin is refused, listed or not', ['docs/real.bin', 'docs/resume', 'checks/fixtures/import/real.bin', '.cache/x'].every(f => refused('rn' + f, { [f]: PDFB }, []) && refused('rn2' + f, { [f]: PDFB })));
expect('a Word or ODT file renamed, and a ZIP holding a PDF, or Word files, is refused too (a .zip, a gitignored one)', [docxZip, odtZip, nested].every((b, k) => refused('rz' + k, { 'docs/a.zip': b }, []) && refused('rz2' + k, { 'docs/archive': b }, []))
  && run('rz3', d => { tree({ 'docs/a.zip': nested }, [])(d); fs.writeFileSync(path.join(d, '.gitignore'), '*.zip\n'); }).includes(STAY));
expect('a ZIP with nothing of the kind, and a text that mentions %PDF- far into it, are not documents', !refused('rz4', { 'docs/a.zip': Buffer.from(zip({ 'a.txt': 'hello' })), 'docs/note.txt': Buffer.from('x'.repeat(2000) + '%PDF-1.4') }, []));
const deep = Buffer.from(zip({ 'a/b/nested.bin': docxZip })), deeper = Buffer.from(zip({ 'x.dat': deep })), gz = zlib.gzipSync(Buffer.from('anything'));
expect('a ZIP is read entry by entry, by the bytes: a Word file stored as nested.bin, or a ZIP inside a ZIP inside a ZIP of one, is refused under any name', [deep, deeper, Buffer.from(zip({ 'n.bin': PDFB }))].every((b, k) => refused('rd' + k, { 'docs/a.dat': b }, [])));
expect('a ZIP with an encrypted entry cannot be read to the end, and is refused as what it might hold', refused('rd3', { 'docs/a.dat': Buffer.from(zip({ 'n.bin': 'x' }, { flags: 1 })) }, []));
expect('gzip, tar, 7z, rar, bzip2 and xz are refused by their names whatever is in them, and gzip, 7z, rar, bzip2, xz and tar by their bytes under a name that says nothing', ['a.gz', 'a.tgz', 'a.tar', 'a.7z', 'a.rar', 'a.bz2', 'a.xz'].every(f => refused('ra' + f, { ['docs/' + f]: Buffer.from('plain text') }, []))
  && [gz, Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]), Buffer.from('Rar!\x1a\x07\0'), Buffer.from('BZh9' + 'x'.repeat(20)), Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0, 0]), Buffer.concat([Buffer.alloc(257), Buffer.from('ustar')])].every((b, k) => refused('rb' + k, { 'docs/blob.dat': b }, []))
  && !refused('rb9', { 'docs/note.txt': Buffer.from('BZh is a word') }, []));
expect('the refusal for a file in out/ says that out/ is read, and node_modules is not', run('rz5', tree({ 'out/x.pdf': PDFB }, [])).includes('out/ are looked at too') && !refused('rz6', { 'node_modules/p/x.pdf': PDFB }, []));
// a listed fixture still may not carry metadata: the bytes are the manifest's, the content is not allowed
const upd = extra => Buffer.concat([PDFB, Buffer.from(extra, 'latin1')]);
const infoUpdate = obj => upd(`\n9 0 obj\n${obj}\nendobj\ntrailer\n<< /Root 1 0 R /Info 9 0 R >>\n%%EOF\n`);
expect('a listed PDF with an Info update that holds /Author, any other key (/Company, /Subject), a hex string, a UTF-16BE string or an indirect value is refused as metadata',
  ['<< /Author (Someone) >>', '<< /Company (Acme) >>', '<< /Subject (hello) >>', '<< /Title <' + Buffer.from('Someone').toString('hex') + '> >>', '<< /Author <FEFF00530061> >>', '<< /Author 10 0 R >>\nendobj\n10 0 obj\n(Someone)'].every((o, k) => run('mi' + k, tree({ [F]: infoUpdate(o) })).includes(FIXMETA)));
expect('a listed PDF whose Info was set and then blanked again by an update is refused (the old object is read too), and one with blank strings of every shape is accepted',
  run('mi6', tree({ [F]: upd('\n9 0 obj\n<< /Author (Someone) >>\nendobj\n9 0 obj\n<< /Author (       ) >>\nendobj\ntrailer\n<< /Root 1 0 R /Info 9 0 R >>\n%%EOF\n') })).includes(FIXMETA)
  && !run('mi7', tree({ [F]: infoUpdate('<< /Author (   ) /Title <FEFF00200020> /Producer <2020> >>') })).includes(FIXMETA));
const inflate = t => zlib.deflateSync(Buffer.from(t, 'latin1')).toString('latin1');
const objstm = body => { const t = `9 0 ${body}`, z = inflate(t); return upd(`\n11 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${z.length} >>\nstream\n${z}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Info 9 0 R >>\n%%EOF\n`); };
expect('a listed PDF whose Info is in an object stream, with an author, is refused', run('mi8', tree({ [F]: objstm('<< /Author (Someone) >>') })).includes(FIXMETA) && !run('mi9', tree({ [F]: objstm('<< /Author (   ) >>') })).includes(FIXMETA));
const xmp = (inner, deflate) => upd('\n12 0 obj\n<< /Type /Metadata /Subtype /XML' + (deflate ? ' /Filter /FlateDecode' : '') + ' >>\nstream\n' + (deflate ? inflate(inner) : inner) + '\nendstream\nendobj\n');
expect('a listed PDF with an XMP packet that holds anything is refused, compressed or not, with the x: prefix or without; an empty packet is accepted',
  [['<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description dc:creator="x"/></rdf:RDF></x:xmpmeta>', false], ['<xmpmeta xmlns="adobe:ns:meta/"><RDF/></xmpmeta>', false], ['<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>', true], ['<?xpacket begin="x" id="W"?><meta xmlns:dc="d"><dc:creator>Someone</dc:creator></meta><?xpacket end="w"?>', true]].every(([x, z], k) => run('mx' + k, tree({ [F]: xmp(x, z) })).includes(FIXMETA))
  && !run('mx9', tree({ [F]: xmp('<?xpacket begin="x" id="W"?><x:xmpmeta xmlns:x="adobe:ns:meta/"/><?xpacket end="w"?>', true) })).includes(FIXMETA));
const core = text => `<?xml version="1.0"?><cp:coreProperties xmlns:cp="c" xmlns:dc="d">${text}</cp:coreProperties>`;
const withParts = parts => Buffer.from(zip({ 'word/document.xml': '<w:p/>', ...parts }));
expect('a listed DOCX or ODT with text in core, app, custom or meta, or an author on a comment or a tracked change, is refused as metadata; empty parts are accepted',
  [{ 'docProps/core.xml': core('<dc:creator>Someone</dc:creator>') }, { 'docProps/app.xml': '<Properties><Company>Acme</Company></Properties>' }, { 'docProps/custom.xml': '<Properties><property name="a"><vt:lpwstr>text</vt:lpwstr></property></Properties>' },
    { 'word/document.xml': '<w:p><w:ins w:id="1" w:author="Someone"><w:r/></w:ins></w:p>' }, { 'word/comments.xml': '<w:comments><w:comment w:author="Someone"/></w:comments>' }, { 'meta.xml': '<office:meta><meta:initial-creator>Someone</meta:initial-creator></office:meta>' }].every((p, k) => run('mz' + k, tree({ [DX]: withParts(p) })).includes(FIXMETA))
  && !run('mz9', tree({ [DX]: withParts({ 'docProps/core.xml': core(''), 'docProps/app.xml': '<Properties/>', 'docProps/custom.xml': '<Properties/>' }) })).includes(FIXMETA));
expect('a listed PDF with an Info value written as a name (/Author /JaneReal, any key) is refused; /Trapped /False, the one name Info may hold, is accepted',
  ['<< /Author /JaneReal >>', '<< /Title/Resume /Producer /Acme >>'].every((o, k) => run('mn' + k, tree({ [F]: infoUpdate(o) })).includes(FIXMETA)) && !run('mn9', tree({ [F]: infoUpdate('<< /Trapped /False /Author () >>') })).includes(FIXMETA));
const utf16 = t => Buffer.from('\ufeff' + t, 'utf16le').toString('latin1');
expect('a listed PDF with an XMP packet written in UTF-16 (a zero byte beside every letter), plain or compressed, is refused', [false, true].every(d => run('mu' + d, tree({ [F]: xmp(utf16('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description dc:creator="x"/></rdf:RDF></x:xmpmeta>'), d) })).includes(FIXMETA)));
expect('a listed PDF with an annotation or a form field that has a /T (its author), as a string or a hex string, is refused; an empty one is accepted',
  ['<< /Type /Annot /Subtype /Text /T (Jane Real) /Contents (hi) >>', '<< /Type /Annot /Subtype /Text /T <4A616E65> >>'].every((o, k) => run('ma' + k, tree({ [F]: upd(`\n13 0 obj\n${o}\nendobj\n`) })).includes(FIXMETA))
  && !run('ma9', tree({ [F]: upd('\n13 0 obj\n<< /Type /Annot /Subtype /Text /T () >>\nendobj\n') })).includes(FIXMETA));
expect('a listed DOCX with word/people.xml that names someone, a customXml part with a text or an attribute, docVars in the settings, or a relationship that points at file://, C:\\ or /Users/ is refused; the empty forms are accepted',
  [{ 'word/people.xml': '<w15:people xmlns:w15="x"><w15:person w15:author="Jane Real"><w15:presenceInfo w15:userId="jane" w15:providerId="None"/></w15:person></w15:people>' }, { 'customXml/item1.xml': '<root>Jane Real</root>' }, { 'customXml/item2.xml': '<root name="Jane Real"/>' },
    { 'word/settings.xml': '<w:settings><w:docVars><w:docVar w:name="who" w:val="Jane"/></w:docVars></w:settings>' }, { 'word/_rels/document.xml.rels': '<Relationships><Relationship Id="r1" Type="t" Target="file:///Users/jane/Desktop/cv.docx" TargetMode="External"/></Relationships>' },
    { 'word/_rels/document.xml.rels': '<Relationships><Relationship Id="r1" Type="t" Target="C:\\Users\\jane\\cv.dotx" TargetMode="External"/></Relationships>' }, { '_rels/.rels': '<Relationships><Relationship Id="r1" Type="t" Target="/Users/jane/cv.docx"/></Relationships>' }]
    .every((parts, k) => run('mp' + k, tree({ [DX]: withParts(parts) })).includes(FIXMETA))
  && !run('mp9', tree({ [DX]: withParts({ 'word/people.xml': '<w15:people xmlns:w15="x"/>', 'customXml/item1.xml': '<root xmlns="urn:x"/>', 'word/settings.xml': '<w:settings/>', 'word/_rels/document.xml.rels': '<Relationships><Relationship Id="r1" Type="t" Target="styles.xml"/><Relationship Id="r2" Type="h" Target="https://example.org/" TargetMode="External"/></Relationships>' }) })).includes(FIXMETA));
expect('the real fixtures, as listed, pass: names, hashes and text', (() => {
  const real = path.join(path.dirname(script), 'fixtures/import');
  const out = run('fxr', d => { fs.mkdirSync(path.join(d, 'checks/fixtures'), { recursive: true }); fs.cpSync(real, path.join(d, 'checks/fixtures/import'), { recursive: true }); });
  return !out.includes(STAY) && !out.includes(CONTENT) && fs.readdirSync(real).filter(f => /\.(pdf|docx|odt)$/.test(f)).length === 25;
})());

// Windows builds failed on icons\icon-192.png: every rule tests a path with forward slashes
const src = fs.readFileSync(script, 'utf8');
expect('paths are made only by relOf, so they have forward slashes on Windows too', (src.match(/path\.relative\(ROOT/g) ?? []).length === 1 && src.includes('.split(path.sep).join'));

process.exit(bad ? 1 : 0);
