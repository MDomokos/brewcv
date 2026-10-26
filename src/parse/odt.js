// Not from OpenResume. An OpenDocument text (.odt) as text items, read tag by tag (scan, in lines.js) from content.xml: one line per paragraph (text:p)
// and heading (text:h, a bold heading, a section title at the document's top level); a text:p inside a text:list-item is a bullet; a text:tab starts
// a new item. A text box or frame is read as its own lines after the paragraph it sits in; footnotes, comments and tracked deletions are not read.
// A file with no paragraph in it is refused with the code 'empty'.
// shortcut: bold is read from the styles in content.xml (what an editor writes for text made bold by hand), not from named styles in styles.xml.
import { unzip } from './unzip.js';
import { attr, itemsOf, paragraphs, scan, skipping, unescape } from './lines.js';

const SKIP = new Set(['text:tracked-changes', 'text:note', 'office:annotation']);      // an element left open ends where its parent does (skipping, in lines.js)

export async function readOdt(bytes){
  const raw = await unzip(bytes).read('content.xml');
  if (!raw) throw Object.assign(new Error('This file has no text to read'), { code: 'zip' });
  const bold = new Set(), out = paragraphs();
  let style = null, list = 0;
  const skip = skipping(n => SKIP.has(n));
  for (const e of scan(new TextDecoder().decode(raw))){
    if (skip(e)) continue;
    const p = out.cur;
    if (e.text !== undefined){ if (p) p.runs.push({ text: e.raw ? e.text : unescape(e.text), bold: p.base || p.bolds > 0 }); continue; }
    if (e.name === 'style:style') style = e.close ? null : attr(e.tag, 'style:name');
    else if (e.name === 'style:text-properties'){ if (style && /^(bold|[789]00)$/.test(attr(e.tag, 'fo:font-weight') ?? '')) bold.add(style); }
    else if (e.name === 'text:list-item') list = Math.max(0, list + (e.close ? -1 : 1));
    else if (e.name === 'text:p' || e.name === 'text:h'){
      if (e.close){ if (p) out.close(); continue; }
      out.open({ runs: [], spans: [], bolds: 0, base: bold.has(attr(e.tag, 'text:style-name')), level: e.name === 'text:h' ? +(attr(e.tag, 'text:outline-level') ?? 1) : undefined, bullet: e.name === 'text:p' && list > 0 });
      if (e.self) out.close();
    } else if (!p) continue;
    else if (e.name === 'text:span'){      // bolds counts the spans open that are bold
      if (e.close){ if (p.spans.pop()) p.bolds--; } else if (!e.self){ const b = bold.has(attr(e.tag, 'text:style-name')); p.spans.push(b); if (b) p.bolds++; }
    }
    else if (e.close) continue;
    else if (e.name === 'text:tab') p.runs.push({ text: '\t' });
    else if (e.name === 'text:line-break') p.runs.push({ text: '\n' });
    else if (e.name === 'text:s') p.runs.push({ text: ' '.repeat(+attr(e.tag, 'text:c') || 1) });
  }
  if (!out.end().length) throw Object.assign(new Error('No paragraph was found in this file'), { code: 'empty' });      // a renamed prefix, or not a text
  return itemsOf(out.out);
}
