// Not from OpenResume. A Word or Google Docs .docx as text items: one line per paragraph, read tag by tag (scan, in lines.js) from word/document.xml.
// The header and footer the last section uses (its default ones, or its first-page ones when it has only those) come first and last, marked `side`, so the parser
// leaves their lines over for the person to place instead of reading them; page numbers, and a line that the body has too, are dropped. A bold run is bold, a paragraph with a list number (w:numPr) is a
// bullet, a Heading style is a bold heading (a section title at the document's top level), a tab starts a new item. Hidden text, deleted or moved-away
// text, the old formatting of a tracked change and the second copy of a text box (mc:Fallback) are not read; a text box is read as its own lines after
// the paragraph it sits in. The look of a run (size, colour, underline, caps) is the run's own, else its character style's, else its paragraph style's (and the styles
// they are based on), else the document's default; a symbol (w:sym) is its character, and a table used for layout is read column by column (inColumns). A style is looked up in word/styles.xml by its English name ("heading 1"), because Word names the style's id in the document's language.
// A file with no paragraph in it (a renamed prefix) is refused with the code 'empty'.
// shortcut: bold set by a style other than a heading's is read from that style alone (not from the style it is based on), though size, colour, underline and
// caps follow the chain; a theme colour is not a colour; the prefix must be w:; the headers of other sections and of even pages are not read; "Page 1 of 2" is told by its shape,
// in a few languages. Read the based-on chain and the table's rows when a real file needs it.
import { unzip } from './unzip.js';
import { HEAVY } from './extract-resume-from-sections/lib/common-features.js';
import { attr, inColumns, itemsOf, paragraphs, scan, skipping, tabled, unescape } from './lines.js';

// <w:b/> or <w:vanish/> is on unless w:val says off
const on = tag => !['0', 'false', 'off'].includes(attr(tag, 'w:val'));
// the old formatting of a tracked change, text moved away (the moved copy is kept), and the second copy of a text box
const SKIP = name => name === 'mc:fallback' || name === 'w:movefrom' || /^w:\w*prchange$/.test(name);
// A run's size in points, colour (hex, '' for the text colour), underline and caps, from one property tag (a run's, a style's or the document defaults')
const props = e => {
  const v = attr(e.tag, 'w:val');
  if (e.name === 'w:sz') return { size: +v / 2 || undefined };
  if (e.name === 'w:color') return { color: !v || v === 'auto' || /^0+$/.test(v) ? '' : v.toLowerCase() };
  if (e.name === 'w:u') return { underline: v !== 'none' };
  if (e.name === 'w:caps') return { caps: on(e.tag) };
};
// A page number: a bare number, "1 / 2", or one with the word for page in the ten interface languages ("Page 1 of 2", "Seite 1 von 2", "Page 1 sur 2", "Página 1 de 2",
// "Pagina 1 di 2", "Strona 1 z 2", "Stránka 1 z 2", "1. oldal"). "Zip 90210", "Born 1985" and "Version 2" are text.
const WORD = '(?:page|seite|p[aá]gina|pagina|strona|str[aá]nka|strana|oldal|(?:p|p[aá]g|s|str)\\.)';
const PAGE = new RegExp(`^(?:${WORD}\\s*)?\\d+(?:\\s*(?:of|von|sur|de|di|van|z|ze|\\/)\\s*\\d+)?(?:\\.?\\s*${WORD})?$`, 'iu');
const textOf = p => p.runs.map(r => r.text).join('').replace(/\s+/g, ' ').trim().toLowerCase();

export async function readDocx(bytes){
  const z = unzip(bytes), text = async n => { const u8 = await z.read(n); return u8 ? new TextDecoder().decode(u8) : ''; };
  if (!z.names.includes('word/document.xml')) throw Object.assign(new Error('This file has no text to read'), { code: 'zip' });
  const styles = new Map(), defaults = {};
  let style = null, plain = null;      // plain: the paragraph style a paragraph with no style has
  for (const e of scan(await text('word/styles.xml'))){
    if (e.name === 'w:style'){
      style = e.close ? null : { level: 0, bold: false, list: false };
      if (style){ styles.set(attr(e.tag, 'w:styleId'), style); if (attr(e.tag, 'w:default') === '1' && attr(e.tag, 'w:type') === 'paragraph') plain = style; }
    } else if (e.name === 'w:rprdefault') style = e.close ? null : defaults;
    else if (style && !e.close){
      if (e.name === 'w:name') style.level = +(/^heading (\d)/i.exec(attr(e.tag, 'w:val') ?? '')?.[1] ?? 0);
      else if (e.name === 'w:b') style.bold = on(e.tag);
      else if (e.name === 'w:numid') style.list = +attr(e.tag, 'w:val') > 0;
      else if (e.name === 'w:basedon') style.based = attr(e.tag, 'w:val');
      else Object.assign(style, props(e));
    }
  }
  const chain = (s, k) => { for (let n = 0; s && n < 9; n++, s = styles.get(s.based)) if (s[k] !== undefined) return s[k]; };      // a style's own value, else its base's
  // one part of the file: its paragraphs, and the header and footer references of the section properties that stand in the body itself (the last one is the last section's)
  const walk = async part => {
    const out = paragraphs(), skip = skipping(SKIP), tb = tabled('w:tbl', 'w:tr', ['w:tc']);
    let sect = null, inSect = false;
    const endRun = p => {
      const r = p.run, of = k => r[k] ?? chain(r.style, k) ?? chain(p.style ?? plain, k) ?? defaults[k];
      if (r && !r.vanish) p.runs.push({ text: r.text, bold: r.bold ?? (r.strong || !!r.heavy || !!p.style?.bold), size: of('size') ?? 10, color: of('color'), underline: of('underline'), caps: of('caps'), link: p.link > 0 });
      p.run = null;
    };
    const endPara = () => { const p = out.cur; endRun(p); p.level = p.style?.level; p.bullet = p.numId !== undefined ? p.numId !== '0' : !!p.style?.list; out.close(); };
    for (const e of scan(await text(part))){
      if (skip(e)) continue;
      const p = out.cur, run = p?.run;
      if (e.text !== undefined){ if (p?.inT && run) run.text += e.raw ? e.text : unescape(e.text); continue; }
      if (tb.event(e)) continue;
      if (e.name === 'w:gridspan' && +attr(e.tag, 'w:val') > 1){ tb.merge(); continue; }
      if (e.name === 'w:hyperlink' && p){ p.link = Math.max(0, (p.link ?? 0) + (e.close ? -1 : e.self ? 0 : 1)); continue; }
      if (e.name === 'w:p'){
        if (e.close){ if (p) endPara(); } else { tb.tag(out.open({ runs: [], run: null, inPr: false, inT: false })); if (e.self) endPara(); }
      } else if (e.name === 'w:sectpr'){ inSect = !e.close && !e.self; if (!e.close) sect = { refs: [], titlePg: false }; }
      else if (inSect){      // each section's properties replace the one before, so the last one, the body's own, is what is left
        if (e.name === 'w:headerreference' || e.name === 'w:footerreference') sect.refs.push({ kind: e.name.slice(2, 8), type: attr(e.tag, 'w:type') ?? 'default', id: attr(e.tag, 'r:id') });
        else if (e.name === 'w:titlepg') sect.titlePg = on(e.tag);
      } else if (!p) continue;
      else if (e.name === 'w:ppr') p.inPr = !e.close;
      else if (e.close) { if (e.name === 'w:r') endRun(p); else if (e.name === 'w:t') p.inT = false; }
      else if (e.name === 'w:r') p.run = { text: '', bold: null, strong: false, vanish: false };
      else if (p.inPr){
        if (e.name === 'w:pstyle'){ const id = attr(e.tag, 'w:val'); p.style = styles.get(id) ?? (/^heading(\d)/i.test(id ?? '') ? { level: +/(\d)/.exec(id)[1] } : undefined); }      // no styles.xml: the id says it
        else if (e.name === 'w:numid') p.numId = attr(e.tag, 'w:val');
        else if (e.name === 'w:del') p.deleted = true;
      } else if (run){
        if (e.name === 'w:t') p.inT = !e.self;
        else if (e.name === 'w:b') run.bold = on(e.tag);
        else if (e.name === 'w:rfonts'){ if (HEAVY.test(attr(e.tag, 'w:ascii') ?? attr(e.tag, 'w:hansi') ?? '')) run.heavy = true; }      // a font named Arial Black is bold
        else if (e.name === 'w:vanish') run.vanish = on(e.tag);
        else if (e.name === 'w:rstyle'){ run.strong = attr(e.tag, 'w:val') === 'Strong'; run.style = styles.get(attr(e.tag, 'w:val')); }
        else if (e.name === 'w:tab' || e.name === 'w:ptab') run.text += '\t';
        else if (e.name === 'w:br') run.text += '\n';
        else if (e.name === 'w:nobreakhyphen') run.text += '-';
        else if (e.name === 'w:sym') run.text += String.fromCharCode(parseInt(attr(e.tag, 'w:char'), 16) || 32);      // a symbol-font bullet is U+F0B7, which a line's start takes for a bullet
        else Object.assign(run, props(e));
      }
    }
    while (out.cur) endPara();      // a file cut short
    const flow = inColumns(out.out);
    return { all: flow, paras: flow.filter(p => !(p.deleted && !p.runs.some(r => r.text.trim()))), sect };
  };
  const body = await walk('word/document.xml');
  if (!body.all.length) throw Object.assign(new Error('No paragraph was found in this file'), { code: 'empty' });

  // the parts the last section's header and footer point to, by relationship id
  const rels = new Map();
  for (const e of scan(await text('word/_rels/document.xml.rels'))) if (e.name === 'relationship') rels.set(attr(e.tag, 'Id'), attr(e.tag, 'Target'));
  const mine = new Set(body.paras.map(textOf));
  const side = async kind => {
    const refs = (body.sect?.refs ?? []).filter(r => r.kind === kind), ref = refs.find(r => r.type === 'default') ?? (body.sect?.titlePg ? refs.find(r => r.type === 'first') : undefined);
    const target = rels.get(ref?.id);
    if (!target) return [];
    const path = (target.startsWith('/') ? target.slice(1) : `word/${target}`).replace(/[^/]+\/\.\.\//g, '');      // "../word/header1.xml" too
    return (await walk(path)).paras.filter(p => { const t = textOf(p); return t && !PAGE.test(t) && !mine.has(t); }).map(p => ({ ...p, side: kind }));
  };
  return itemsOf([...await side('header'), ...body.paras, ...await side('footer')]);
}
