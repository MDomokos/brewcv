// Not from OpenResume. An HTML page as text items, read tag by tag (scan, in lines.js), no DOM: a block (p, div, li, a table row, ...) is a line, h1 to h3 are
// bold headings (section titles at the document's top level), b and strong are bold, li is a bullet, br starts a line, and a table cell or a gap of
// two no-break spaces (&nbsp;&nbsp;, &emsp;, not after . ! or ?) starts a new item. Scripts, styles, comments, titles, svg, noscript, iframes and buttons are not text; <pre> keeps its line breaks. A page with no text in it is refused with the code 'empty'.
// shortcut: styling in CSS (a bold class, a flex row of spans) is not seen; only the tags say what is bold and where an item ends. Add a rule when a real page needs one.
import { decode, itemsOf, scan, skipping, unescape } from './lines.js';

const BLOCK = new Set('p div li ul ol h1 h2 h3 h4 h5 h6 tr table section article header footer main nav aside blockquote pre dl dt dd'.split(' '));
const SKIP = new Set(['title', 'svg', 'noscript', 'iframe']);

export function readHtml(bytes){
  const paras = [];
  let runs = [], strong = 0, items = 0, head = 0, pre = 0, button = false;
  const skip = skipping(n => SKIP.has(n));      // an element left open (a stray <button>) ends where its parent does
  const flush = () => { if (runs.some(r => r.text.trim())) paras.push({ runs, level: head || undefined, bullet: items > 0 && !head }); runs = []; };
  for (const e of scan(decode(bytes))){
    if (skip(e)) continue;
    if (e.name === 'button'){ button = !e.close && !e.self; continue; }      // a button holds no block or cell: one left open ends at the next one
    if (button){ if (e.text !== undefined) continue; if (BLOCK.has(e.name) || e.name === 'td' || e.name === 'th') button = false; }
    if (e.text !== undefined){
      const text = e.raw ? e.text : unescape(pre ? e.text : e.text.replace(/[ \t\n\r\f]+/g, ' '));      // <pre> keeps its line breaks
      if (text.trim() || runs.length) runs.push({ text, bold: strong > 0 });      // a space between two tags is kept, one between two blocks is not
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
