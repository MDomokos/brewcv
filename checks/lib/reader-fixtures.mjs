// Files for the reader checks, built from strings: one invented resume (the one-column resume of parse-fixtures.mjs, without its References
// section) written the way Word, Google Docs, LibreOffice, an HTML page, Markdown and a text editor write it, and a LinkedIn export.
// Nothing here is a real person. The XML follows what each program writes, from the OOXML and ODF formats as those programs use them
// (Word names a heading style "heading 1" and gives it an id in the document's language; Google Docs writes every run's properties out,
// bold off as <w:b w:val="0"/>, and a style named "normal"); no real file from either program is in the repo.
import { zip, deflated } from './zip.mjs';

// a paragraph: kind p (text), h (heading), h2 (a heading one level down), li (list item) or blank; segs are the parts a tab (or a gap) keeps apart, [text, bold]
const P = (kind, ...segs) => ({ kind, segs });
const H = text => P('h', [text, true]);
const LI = text => P('li', [text]);
const B = P('blank');
export const RESUME = [
  P('p', ['Jane Q. Sample', true]),
  P('p', ['jane.sample@example.com'], ['(555) 010-0100'], ['Springfield, IL']),
  P('p', ['www.example.com/janesample']),
  P('p', ['Mechanical engineer who builds dosing devices for clinical teams.']),
  B, H('Work Experience'),
  P('p', ['Northgate Dosing Systems', true], ['Mar 2021 – Present']),
  P('p', ['Mechanical Design Engineer']),
  LI('Led the redesign of the inhaler dose counter from sketch to production.'),
  LI('Cut the part count of the dosing pump by a third.'),
  B,
  P('p', ['Helix Diagnostics', true], ['2018 – 2021']),
  P('p', ['Product Development Engineer']),
  LI('Ran the tolerance study for a disposable cartridge across three suppliers.'),
  B,
  P('p', ['Atelier Lumen', true], ['Jun 2015 – Aug 2018']),
  P('p', ['Test Technician']),
  LI('Built the fixtures for the flow tests.'),
  LI('Wrote the work instructions for the bench.'),
  B, H('Education'),
  P('p', ['Lakeside State University', true], ['2010 – 2014']),
  P('p', ['Bachelor of Science in Mechanical Engineering']),
  P('p', ['GPA: 3.8']),
  B, H('Skills'),
  P('p', ['CAD: SolidWorks, Fusion 360']),
  P('p', ['Fabrication: 3D printing, CNC machining']),
];
// the same resume with each job's company line as a Heading 2 under the Heading 1 sections, its dates moved to the title line
export const JOBS_AS_HEADINGS = RESUME.flatMap((p, k) => {
  const next = RESUME[k + 1];
  if (p.kind === 'p' && p.segs.length === 2 && p.segs[0][1] && next?.kind === 'p') return [{ kind: 'h2', segs: [[p.segs[0][0], true]] }];
  if (p.kind === 'p' && RESUME[k - 1]?.kind === 'p' && RESUME[k - 1].segs.length === 2 && RESUME[k - 1].segs[0][1] && /Engineer|Technician/.test(p.segs[0][0])) return [{ kind: 'p', segs: [p.segs[0], RESUME[k - 1].segs[1]] }];
  return [p];
});
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- Word ----
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
const wRun = (text, bold, extra = '') => `<w:r>${bold ? '<w:rPr><w:b/><w:bCs/></w:rPr>' : ''}${extra}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
// Word splits a run where its proofing tools stopped: the first word and the rest are two runs with a marker between
const wRuns = (text, bold) => { const i = text.indexOf(' '); return i < 0 ? wRun(text, bold) : `${wRun(text.slice(0, i), bold)}<w:proofErr w:type="spellStart"/>${wRun(text.slice(i), bold)}<w:proofErr w:type="spellEnd"/>`; };
export function word(paras = RESUME, { heading = 'Heading1', headingName = 'heading 1', styles: withStyles = true, header, footer } = {}){
  const body = paras.map((p, n) => {
    const id = `w:rsidR="00${n.toString(16).padStart(4, '0')}" w:rsidRDefault="00A1"`;
    if (p.kind === 'blank') return `<w:p ${id}/>`;
    const ppr = p.kind === 'h' ? `<w:pPr><w:pStyle w:val="${heading}"/></w:pPr>` : p.kind === 'h2' ? '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>'
      : p.kind === 'li' ? '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
      : p.segs.length > 1 ? '<w:pPr><w:tabs><w:tab w:val="right" w:pos="9350"/></w:tabs></w:pPr>' : '';      // a right tab stop is not a tab
    const runs = p.segs.map(([t, b], i) => (i ? (t.startsWith('Jun') ? '<w:r><w:ptab w:relativeTo="margin" w:alignment="right" w:leader="none"/></w:r>' : '<w:r><w:tab/></w:r>') : '') + (t.startsWith('jane.') ? `<w:hyperlink r:id="rId5" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>${t}</w:t></w:r></w:hyperlink>` : wRuns(t, b))).join('');
    return `<w:p ${id}>${ppr}${runs}</w:p>`;
  }).join('');
  // a running header or footer: lines of text, or the XML of a paragraph
  const part = (kind, lines) => (lines ? { [`word/${kind}1.xml`]: `<w:${kind === 'header' ? 'hdr' : 'ftr'} ${W}>${lines.map(t => (t.startsWith('<') ? t : `<w:p><w:r><w:t>${esc(t)}</w:t></w:r></w:p>`)).join('')}</w:${kind === 'header' ? 'hdr' : 'ftr'}>` } : {});
  const sect = `<w:sectPr>${header ? '<w:headerReference w:type="default" r:id="rId8"/>' : ''}${footer ? '<w:footerReference w:type="default" r:id="rId9"/>' : ''}</w:sectPr>`;
  const styles = `<w:styles ${W}><w:docDefaults/><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>`
    + `<w:style w:type="paragraph" w:styleId="${heading}"><w:name w:val="${headingName}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr></w:style>`
    + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:sz w:val="26"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style></w:styles>';
  return zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}${sect}</w:body></w:document>`, ...part('header', header), ...part('footer', footer), ...(header || footer ? { 'word/_rels/document.xml.rels': `<Relationships>${header ? '<Relationship Id="rId8" Type="x/header" Target="header1.xml"/>' : ''}${footer ? '<Relationship Id="rId9" Type="x/footer" Target="footer1.xml"/>' : ''}</Relationships>` } : {}), ...(withStyles ? { 'word/styles.xml': styles } : {}) });
}

// ---- Google Docs ----
const RPR = (bold, sz = 22) => `<w:rPr><w:rFonts w:ascii="Arial" w:cs="Arial" w:eastAsia="Arial" w:hAnsi="Arial"/><w:b w:val="${bold ? 1 : 0}"/><w:bCs w:val="${bold ? 1 : 0}"/><w:i w:val="0"/><w:color w:val="000000"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
export function google(paras = RESUME){
  const body = paras.map((p, n) => {
    const style = p.kind === 'h' ? 'Heading1' : p.kind === 'h2' ? 'Heading2' : 'normal', num = p.kind === 'li' ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:ind w:left="720" w:hanging="360"/><w:contextualSpacing/>' : '';
    const tabs = p.segs.length > 1 ? '<w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs>' : '';
    const runs = p.kind === 'blank' ? `<w:r>${RPR(false)}</w:r>`
      : p.segs.map(([t, b], i) => `<w:r>${RPR(p.kind[0] === 'h' ? false : b)}${i ? '<w:tab/>' : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`).join('');      // a heading's runs say bold off: the style carries it
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${tabs}${num}</w:pPr><w:bookmarkStart w:id="${n}" w:name="h.${n}"/><w:bookmarkEnd w:id="${n}"/>${runs}</w:p>`;
  }).join('');
  const styles = `<w:styles ${W}><w:style w:type="paragraph" w:default="1" w:styleId="normal"><w:name w:val="normal"/></w:style>`
    + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="normal"/><w:next w:val="normal"/><w:pPr><w:keepNext/><w:keepLines/></w:pPr><w:rPr><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:style></w:styles>';
  return zip({ 'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`, 'word/styles.xml': styles });
}

// ---- LibreOffice / OpenDocument ----
export function odt(paras = RESUME){
  const body = [];
  let open = false;
  for (const p of paras){
    if (open && p.kind !== 'li'){ body.push('</text:list>'); open = false; }
    const inline = p.segs.map(([t, b], i) => (i ? (i === 1 && t.startsWith('Mar') ? '<text:s text:c="3"/>' : '<text:tab/>') : '') + (b ? `<text:span text:style-name="T1">${esc(t)}</text:span>` : esc(t))).join('');
    if (p.kind === 'blank') body.push('<text:p text:style-name="Standard"/>');
    else if (p.kind[0] === 'h') body.push(`<text:h text:style-name="Heading_20_${p.kind === 'h' ? 1 : 2}" text:outline-level="${p.kind === 'h' ? 1 : 2}">${inline}</text:h>`);
    else if (p.kind === 'li'){ if (!open){ body.push('<text:list text:style-name="L1">'); open = true; } body.push(`<text:list-item><text:p text:style-name="P1">${inline}</text:p></text:list-item>`); }
    else body.push(`<text:p text:style-name="Standard">${inline}</text:p>`);
  }
  if (open) body.push('</text:list>');
  return zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"><office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold" style:font-weight-asian="bold"/></style:style><style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic"/></style:style></office:automatic-styles><office:body><office:text>${body.join('')}</office:text></office:body></office:document-content>` });
}

// ---- HTML ----
export function html(paras = RESUME){
  const out = [];
  let open = false;
  for (const p of paras){
    if (open && p.kind !== 'li'){ out.push('</ul>'); open = false; }
    const inline = p.segs.map(([t, b], i) => (i ? '&nbsp;&nbsp;&nbsp;' : '') + (b ? `<strong>${esc(t)}</strong>` : esc(t).replace(/ – /g, ' &ndash; '))).join('');
    if (p.kind === 'blank') continue;
    if (p.kind === 'h') out.push(`<h2>${inline}</h2>`);
    else if (p.kind === 'h2') out.push(`<h3>${inline}</h3>`);
    else if (p.kind === 'li'){ if (!open){ out.push('<ul>'); open = true; } out.push(`  <li>${inline}</li>`); }
    else out.push(`<p>${inline}</p>`);
  }
  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>Jane Q. Sample, résumé</title><style>h2 { color: #333 }</style><script>var note = "<p>not a line</p>";</script></head>\n<body>\n${out.join('\n')}\n</body></html>\n`;
}

// ---- Markdown and text ----
export function md(paras = RESUME, gap = '   '){
  return paras.map((p, n) => {
    const t = p.segs.map(([x, b], i) => (x.startsWith('www.') ? `[${x}](https://${x})` : x.startsWith('jane.') ? `<${x}>` : i && /(19|20)\d\d/.test(x) ? `*${x}*` : b ? `**${x}**` : x)).join(gap);
    return p.kind === 'blank' ? '' : p.kind === 'h' ? `## ${p.segs[0][0]}` : p.kind === 'h2' ? `### ${p.segs[0][0]}` : p.kind === 'li' ? `- ${t}` : n === 0 ? `# ${p.segs[0][0]}` : t;
  }).join('\n') + '\n';
}
export const txt = (paras = RESUME, gap = '   ') => paras.map(p => (p.kind === 'blank' ? '' : p.kind === 'li' ? `- ${p.segs[0][0]}` : p.kind === 'h' ? p.segs[0][0].toUpperCase() : p.segs.map(s => s[0]).join(gap))).join('\n') + '\n';

// ---- other zips ----
export const pages = () => zip({ 'QuickLook/Preview.pdf': '%PDF-1.4\n% a stored picture of the pages\n', 'Index/Document.iwa': 'x' });      // the PDF is the first entry, inside the first 1024 bytes
export const linkedin = (renamed = false) => {
  const csv = (...rows) => rows.map(r => r.map(c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n') + '\r\n';
  const files = renamed ? {
    'profile.CSV': csv(['first name', 'LAST NAME', 'headline', 'summary', 'geo location', 'websites'], ['Jane', 'Sample', 'Mechanical engineer', 'Builds dosing devices.', 'Springfield, Illinois, United States', '[PERSONAL:https://www.example.com/janesample]']),
    'POSITIONS.csv': csv(['Company', 'Job Title', 'Description', 'Location', 'Start Date', 'End Date'],
      ['Northgate Dosing Systems', 'Mechanical Design Engineer', 'Led the redesign of the inhaler dose counter.\n• Cut the part count of the dosing pump by a third, saving cost.', 'Springfield, IL', 'Mar 2021', ''],
      ['Helix Diagnostics', 'Product Development Engineer', '', '', '2018', 'Mar 2021']),
    'Email Addresses.csv': csv(['EMAIL ADDRESS', 'Confirmed', 'Primary'], ['old.jane@example.com', 'Yes', 'No'], ['jane.sample@example.com', 'Yes', 'Yes']),
  } : {
    'Profile.csv': csv(['First Name', 'Last Name', 'Maiden Name', 'Address', 'Birth Date', 'Headline', 'Summary', 'Industry', 'Zip Code', 'Geo Location', 'Twitter Handles', 'Websites', 'Instant Messengers'],
      ['Jane', 'Sample', '', '', '', 'Mechanical engineer', 'Builds dosing devices.', 'Medical Devices', '', 'Springfield, Illinois, United States', '', '[PERSONAL:https://www.example.com/janesample]', '']),
    'Positions.csv': csv(['Company Name', 'Title', 'Description', 'Location', 'Started On', 'Finished On'],
      ['Northgate Dosing Systems', 'Mechanical Design Engineer', 'Led the redesign of the inhaler dose counter.\n• Cut the part count of the dosing pump by a third, saving cost.', 'Springfield, IL', 'Mar 2021', ''],
      ['Helix Diagnostics', 'Product Development Engineer', '', '', '2018', 'Mar 2021']),
    'Education.csv': csv(['School Name', 'Start Date', 'End Date', 'Notes', 'Degree Name', 'Activities'], ['Lakeside State University', '2010', '2014', '', 'Bachelor of Science', '']),
    'Skills.csv': csv(['Name'], ['SolidWorks'], ['Fusion 360']),
    'Email Addresses.csv': csv(['Email Address', 'Confirmed', 'Primary', 'Updated On'], ['jane.sample@example.com', 'Yes', 'Yes', '']),
  };
  return zip(files);
};
export const linkedinExpected = {
  basics: { name: 'Jane Sample', label: 'Mechanical engineer', summary: 'Builds dosing devices.', location: { city: 'Springfield', region: 'Illinois' }, url: 'https://www.example.com/janesample', email: 'jane.sample@example.com' },
  work: [
    { name: 'Northgate Dosing Systems', position: 'Mechanical Design Engineer', startDate: '2021-03', location: 'Springfield, IL', highlights: ['Led the redesign of the inhaler dose counter.', 'Cut the part count of the dosing pump by a third, saving cost.'] },
    { name: 'Helix Diagnostics', position: 'Product Development Engineer', startDate: '2018', endDate: '2021-03' },
  ],
  education: [{ institution: 'Lakeside State University', studyType: 'Bachelor of Science', startDate: '2010', endDate: '2014' }],
  skills: [{ keywords: ['SolidWorks', 'Fusion 360'] }],
};
export { zip, deflated };
