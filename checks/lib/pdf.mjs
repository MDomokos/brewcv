// A PDF writer for the checks: pages of text set in Helvetica, one string at a place. It makes the small PDFs that test the PDF reader's repairs
// (wrapped lines, hyphens, margin labels, a jumbled page), so no binary is committed for them. Standard fonts need no embedding.
// pages: [[{ x, y, text, size = 10, bold = false }]]; a string is written as bytes in WinAnsi (the bullet is \x95, the soft hyphen \xad).
// shortcut: the text of a string is Latin-1 only, and a page is A4; add what a test needs when it needs it.
const esc = s => s.replace(/[\\()]/g, c => '\\' + c);
export function pdf(pages){
  const objs = [];      // object n is objs[n - 1]
  const add = body => objs.push(body) && objs.length;
  const catalog = add(''), tree = add(''), regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = pages.map(items => {
    const body = items.map(i => `BT /${i.bold ? 'F2' : 'F1'} ${i.size ?? 10} Tf ${i.x} ${i.y} Td (${esc(i.text)}) Tj ET`).join('\n');
    const content = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    return add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`);
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objs[tree - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const at = objs.map((o, n) => { const p = out.length; out += `${n + 1} 0 obj\n${o}\nendobj\n`; return p; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map(p => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, c => c.charCodeAt(0));
}
