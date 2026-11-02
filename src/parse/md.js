// Not from OpenResume. Markdown as text items: # (or a line underlined with === or ---) is a bold heading (a section title at the document's top level),
// - * + and 1. start a bullet, **bold** is bold, two spaces (not after . ! or ?) or a tab start a new item. Links keep their words (the address is dropped), and images,
// link definitions, code marks, italics, rules and a front matter block (--- key: value ... ---) are removed.
// shortcut: a table is read as its lines, and a paragraph wrapped over several lines is several lines; add both when a real file needs them.
import { BULLET, decode, itemsOf } from './lines.js';

export function readMd(bytes){
  const text = decode(bytes).replace(/^---\r?\n(?=[\w-]+:)[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
  const lines = text.split(/\r?\n/).map(l => (/^\s{0,3}\[[^\]]+\]:\s*\S/.test(l) ? '' : l));
  return itemsOf(lines.map((line, i) => {
    let h = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line), level = h?.[1].length, body = h?.[2];
    const under = /^\s{0,3}(={3,}|-{3,})\s*$/.exec(lines[i + 1] ?? '');
    if (!h && under && line.trim() && !BULLET.test(line) && !/^\s*([-*_=])(\s*\1){2,}\s*$/.test(line)){ level = under[1][0] === '=' ? 1 : 2; body = line.trim(); }      // setext: the underline is dropped as a rule, when its turn comes
    if (/^\s*([-*_=])(\s*\1){2,}\s*$/.test(line)) line = '';      // a rule
    const bullet = level === undefined && BULLET.exec(line);
    body = level !== undefined ? body : bullet ? line.slice(bullet[0].length) : line;
    // every pattern is bounded (a link text of 200 characters, an address of 500), so a hostile line cannot make them slow
    const runs = body.replace(/!\[[^\]]{0,200}\]\([^)]{0,500}\)/g, '').replace(/\[([^\]]{0,200})\](?:\([^)]{0,500}\)|\[[^\]]{0,100}\])/g, '$1').replace(/<(https?:[^>\s]{1,500}|[^>\s@]{1,100}@[^>\s]{1,200})>/g, '$1').replace(/`/g, '')
      .split(/\*\*|__/).map((t, k) => ({ bold: k % 2 === 1, text: t.replace(/(?<![\w*])([*_])(?=\S)(.{1,200}?)(?<=\S)\1(?![\w*])/g, '$2') }));
    return { runs, level, bullet: !!bullet };
  }));
}
