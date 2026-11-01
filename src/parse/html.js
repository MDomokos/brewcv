// Not from OpenResume. An HTML page as text items, read tag by tag (scan, in lines.js), no DOM: a block (p, div, li, a table row, ...) is a line, h1 to h3 are
// bold headings (section titles at the document's top level), b and strong are bold, li is a bullet, br starts a line, and a table cell or a gap of
// two no-break spaces (&nbsp;&nbsp;, &emsp;, not after . ! or ?) starts a new item. Scripts, styles, comments, titles, svg, noscript, iframes and buttons are not text; <pre> keeps its line breaks. A page with no text in it is refused with the code 'empty'.
// An inline style="" on an element sets the look of its text: font-size (pt or px), font-weight, color, text-decoration (underline) and text-transform (uppercase); u underlines.
// shortcut: styling in a stylesheet or a class (a bold class, a flex row of spans), a size in em or %, and a layout table are not seen; only the tags and inline styles say what is bold,
// how big the text is and where an item ends (a table is read row by row). Add a rule when a real page needs one.
import { attr, decode, itemsOf, scan, skipping, unescape } from './lines.js';

const BLOCK = new Set('p div li ul ol h1 h2 h3 h4 h5 h6 tr table section article header footer main nav aside blockquote pre dl dt dd'.split(' '));
const SKIP = new Set(['title', 'svg', 'noscript', 'iframe']);

// the look an element's style="" sets: size (pt), bold, colour (hex or as written, '' for black), underline, caps
function look(tag){
  const s = attr(tag, 'style') ?? '', get = k => new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([^;]+)`, 'i').exec(s)?.[1].trim().toLowerCase();
  const size = /^([\d.]+)(pt|px)$/.exec(get('font-size') ?? ''), weight = get('font-weight'), color = get('color')?.replace(/^#/, ''), under = get('text-decoration(?:-line)?');
  return {
    ...(size ? { size: +size[1] * (size[2] === 'px' ? 0.75 : 1) } : {}), ...(weight ? { bold: /^(bold|[6-9]00)$/.test(weight) } : {}),
    ...(color ? { color: /^(0+|black|rgb\(0,\s*0,\s*0\))$/.test(color) ? '' : color } : {}), ...(under ? { underline: under.includes('underline') } : {}), ...(get('text-transform') ? { caps: get('text-transform') === 'uppercase' } : {}),
  };
}

export function readHtml(bytes){
  const paras = [];
  let runs = [], strong = 0, items = 0, head = 0, pre = 0, button = false;
  const skip = skipping(n => SKIP.has(n));      // an element left open (a stray <button>) ends where its parent does
  const looks = [];      // looks[depth - 1]: the look of the element open at that depth, with the ones around it
  const flush = () => { if (runs.some(r => r.text.trim())) paras.push({ runs, level: head || undefined, bullet: items > 0 && !head }); runs = []; };
  for (const e of scan(decode(bytes))){
    if (skip(e)) continue;
    if (e.name && !e.close && !e.self) looks[e.depth - 1] = { ...looks[e.depth - 2], ...look(e.tag), ...(e.name === 'u' ? { underline: true } : {}) };
    if (e.name === 'button'){ button = !e.close && !e.self; continue; }      // a button holds no block or cell: one left open ends at the next one
    if (button){ if (e.text !== undefined) continue; if (BLOCK.has(e.name) || e.name === 'td' || e.name === 'th') button = false; }
    if (e.text !== undefined){
      const text = e.raw ? e.text : unescape(pre ? e.text : e.text.replace(/[ \t\n\r\f]+/g, ' '));      // <pre> keeps its line breaks
      const l = looks[e.depth - 1] ?? {};
      if (text.trim() || runs.length) runs.push({ text, bold: strong > 0 || !!l.bold, size: l.size, color: l.color, underline: l.underline, caps: l.caps });      // a space between two tags is kept, one between two blocks is not
      continue;
    }
    const open = !e.close;
    if (e.name === 'b' || e.name === 'strong') strong = Math.max(0, strong + (open ? 1 : -1));
    else if (e.name === 'br') runs.push({ text: '\n' });
    else if (e.name === 'td' || e.name === 'th'){ if (open) runs.push({ text: '\t' }); }
    else if (BLOCK.has(e.name)){
      flush();
      if (e.name === 'pre') pre = Math.max(0, pre + (open ? 1 : -1));
      if (e.name === 'li') items = open ? 1 : 0;      // an <li> left open ends with the next <li> or the list
      else if (e.name === 'ul' || e.name === 'ol') items = 0;
      else if (/^h[1-3]$/.test(e.name)) head = open ? +e.name[1] : 0;
    }
  }
  flush();
  if (!paras.length) throw Object.assign(new Error('Nothing in this page is text'), { code: 'empty' });
  return itemsOf(paras);
}
