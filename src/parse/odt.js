// Not from OpenResume. An OpenDocument text (.odt) as text items, read tag by tag (scan, in lines.js) from content.xml: one line per paragraph (text:p)
// and heading (text:h, a bold heading, a section title at the document's top level); a text:p inside a text:list-item is a bullet; a text:tab starts
// a new item; a table used for layout is read column by column (inColumns in lines.js). A text box or frame is read as its own lines after the paragraph it sits in; footnotes, comments and tracked deletions are not read.
// A file with no paragraph in it is refused with the code 'empty'.
// The look of text (bold, size in points, colour, underline, upper case) is the paragraph's style with the innermost span's over it.
// shortcut: the look is read from the styles in content.xml (what an editor writes for text set by hand), not from named styles in styles.xml, and not through a parent style.
import { unzip } from './unzip.js';
import { attr, inColumns, itemsOf, paragraphs, scan, skipping, tabled, unescape } from './lines.js';

const SKIP = new Set(['text:tracked-changes', 'text:note', 'office:annotation']);      // an element left open ends where its parent does (skipping, in lines.js)

// what a style's text properties set: bold, size (pt), colour (hex, '' for the text colour), underline and upper case; a property it names as off is off
function look(tag){
  const a = n => attr(tag, n), size = /^([\d.]+)pt$/.exec(a('fo:font-size') ?? ''), color = /^#?([0-9a-f]{6})$/i.exec(a('fo:color') ?? '');
  const weight = a('fo:font-weight'), under = a('style:text-underline-style'), upper = a('fo:text-transform');
  return {
    ...(weight ? { bold: /^(bold|[789]00)$/.test(weight) } : {}), ...(size ? { size: +size[1] } : {}), ...(color ? { color: /^0+$/.test(color[1]) ? '' : color[1].toLowerCase() } : {}),
    ...(under ? { underline: under !== 'none' } : {}), ...(upper ? { caps: upper === 'uppercase' } : {}),
  };
}

export async function readOdt(bytes){
  const raw = await unzip(bytes).read('content.xml');
  if (!raw) throw Object.assign(new Error('This file has no text to read'), { code: 'zip' });
  const looks = new Map(), out = paragraphs(), tb = tabled('table:table', 'table:table-row', ['table:table-cell', 'table:covered-table-cell']);
  let style = null, list = 0;
  const skip = skipping(n => SKIP.has(n));
  for (const e of scan(new TextDecoder().decode(raw))){
    if (skip(e)) continue;
    const p = out.cur;
    if (e.text !== undefined){ if (p) p.runs.push({ text: e.raw ? e.text : unescape(e.text), ...(p.spans.at(-1) ?? p.base) }); continue; }
    if (e.name === 'table:table-cell' && !e.close && +attr(e.tag, 'table:number-columns-spanned') > 1) tb.merge();
    if (tb.event(e)) continue;
    if (e.name === 'style:style') style = e.close ? null : attr(e.tag, 'style:name');
    else if (e.name === 'style:text-properties'){
      if (style) looks.set(style, look(e.tag));
    }
    else if (e.name === 'text:list-item') list = Math.max(0, list + (e.close ? -1 : 1));
    else if (e.name === 'text:p' || e.name === 'text:h'){
      if (e.close){ if (p) out.close(); continue; }
      tb.tag(out.open({ runs: [], spans: [], base: looks.get(attr(e.tag, 'text:style-name')) ?? {}, level: e.name === 'text:h' ? +(attr(e.tag, 'text:outline-level') ?? 1) : undefined, bullet: e.name === 'text:p' && list > 0 }));
      if (e.self) out.close();
    } else if (!p) continue;
    else if (e.name === 'text:span' || e.name === 'text:a'){      // each open span (or link) holds the look it gives: its own over the one around it
      if (e.close) p.spans.pop(); else if (!e.self) p.spans.push({ ...(p.spans.at(-1) ?? p.base), ...looks.get(attr(e.tag, 'text:style-name')), ...(e.name === 'text:a' ? { link: true } : {}) });
    }
    else if (e.close) continue;
    else if (e.name === 'text:tab') p.runs.push({ text: '\t' });
    else if (e.name === 'text:line-break') p.runs.push({ text: '\n' });
    else if (e.name === 'text:s') p.runs.push({ text: ' '.repeat(+attr(e.tag, 'text:c') || 1) });
  }
  if (!out.end().length) throw Object.assign(new Error('No paragraph was found in this file'), { code: 'empty' });      // a renamed prefix, or not a text
  return itemsOf(inColumns(out.out));
}
