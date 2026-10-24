// Highlights written by hand on a line: pure functions of the text and its marks. Offsets are code points, as in a version's `marks`
// ({ start, end, slot?, expect }, `expect` being the words covered). A highlight always covers whole words, endings included.

const cps = s => [...s];
const WORD = /[\p{L}\p{N}\p{M}]/u, JOIN = /['’\-‑]/;
// a letter or digit, or an apostrophe or hyphen with letters on both sides ("LiDAR-felmérésért", "don't")
const isWord = (c, i) => i >= 0 && i < c.length && (WORD.test(c[i]) || (JOIN.test(c[i]) && i > 0 && i < c.length - 1 && WORD.test(c[i - 1]) && WORD.test(c[i + 1])));

// The whole words a drag from a to b touches, or null: blanks and punctuation at the ends of the drag are not part of it, and a word
// the drag starts or ends inside is taken whole.
export function wordsOf(text, a, b){
  const c = cps(text);
  let s = Math.max(0, Math.min(a, b)), e = Math.min(c.length, Math.max(a, b));
  while (s < e && !isWord(c, s)) s++;
  while (e > s && !isWord(c, e - 1)) e--;
  if (s >= e) return null;
  while (s > 0 && isWord(c, s - 1)) s--;
  while (e < c.length && isWord(c, e)) e++;
  return [s, e];
}

const shape = (text, m, start, end) => ({ ...m, start, end, expect: cps(text).slice(start, end).join('') });
// a piece left over from a highlight: moved in from blanks and punctuation, and dropped if no word is left
const trim = (text, m, start, end) => {
  const c = cps(text);
  while (start < end && !isWord(c, start)) start++;
  while (end > start && !isWord(c, end - 1)) end--;
  return start < end ? shape(text, m, start, end) : null;
};

// The highlights after the words of a drag from a to b are toggled: all of them highlighted already, they are cleared (a highlight that
// runs on is cut); otherwise they are highlighted, joined to any highlight they overlap or touch.
export function toggleMarks(marks, text, a, b, slot = 'primary'){
  const w = wordsOf(text, a, b);
  const list = [...(marks ?? [])].sort((x, y) => x.start - y.start);
  if (!w) return list;
  const [s, e] = w, c = cps(text);
  const covered = i => list.some(m => i >= m.start && i < m.end);
  let all = true;
  for (let i = s; i < e; i++) if (isWord(c, i) && !covered(i)){ all = false; break; }
  if (all){
    return list.flatMap(m => (m.end <= s || m.start >= e ? [m] : [trim(text, m, m.start, s), trim(text, m, e, m.end)])).filter(Boolean);
  }
  const touch = list.filter(m => m.end >= s && m.start <= e);
  const start = Math.min(s, ...touch.map(m => m.start)), end = Math.max(e, ...touch.map(m => m.end));
  return [...list.filter(m => !touch.includes(m)), shape(text, { slot: touch[0]?.slot ?? slot }, start, end)].sort((x, y) => x.start - y.start);
}

// The highlight a point of the text is in, or at the end of
export const markAt = (marks, at) => (marks ?? []).find(m => at >= m.start && at <= m.end) ?? null;

// Offsets in the text as the browser counts them (UTF-16) and as a mark does (code points)
export const cpOf = (text, u16) => cps(text.slice(0, u16)).length;
export const u16Of = (text, cp) => cps(text).slice(0, cp).join('').length;
