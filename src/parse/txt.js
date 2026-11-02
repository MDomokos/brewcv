// Not from OpenResume. Plain text as text items: one line each, a line that opens with a bullet glyph, - or * is a bullet, a tab or two spaces (not after . ! or ?) start a new item,
// and a line of only ==== or ---- (an underline or a rule) is dropped.
// shortcut: nothing is bold and no line is marked a title, so the parser finds sections by their words alone; a paragraph wrapped over several lines is several lines.
import { BULLET, decode, itemsOf } from './lines.js';

export const readTxt = bytes => itemsOf(decode(bytes).split(/\r?\n/).map(line => {
  const bullet = BULLET.exec(line);
  return { runs: [{ text: /^\s*[=\-_*~]{3,}\s*$/.test(line) ? '' : bullet ? line.slice(bullet[0].length) : line }], bullet: !!bullet };
}));
