// Not from OpenResume, which reads one column. Puts the lines of a page with side-by-side columns in reading order:
// a full-width header first, then the left column, then the right, so the lines of one column are never joined with the next one's.
//
// A page's layout is { page, headerBottom, split }: lines whose top (y + height, y grows upward) is above headerBottom are the header,
// read first; the rest are cut at x = split, left first. A missing split is one column, a missing headerBottom is no header.
// A layout given by the caller is used as it is. Without one the page is guessed, and only when sure.
//
// Sure means all of: after the header (the leading lines that no other line starts beside) the line starts fall into two
// groups more than 30 pt apart; each side holds at least three lines; both sides have two lines in a row that sit on the
// same row as a line of the other side (they overlap by half a line: side by side, not one flow); at least half of the right side's lines start at the cut; and few lines run across the cut. A page with a
// gap like that which fails a test is read as one column, and reported as a doubt.
const GAP = 30;
const MIN_LINES = 3;
const NEAR = 12;

// shortcut: a column's lines are taken as the reader ended them (hasEOL) and in the order it gave them, so a PDF that
// writes two columns row by row is not split. Sort by y and rebuild the lines when one does.
// Three header lines that start at one x with the columns' lines read as body, and more than two columns are cut once.
// Tune the numbers on real files.
function rowsOf(items){
  const lines = [];
  let line = [];
  for (const it of items){ line.push(it); if (it.hasEOL){ lines.push(line); line = []; } }
  if (line.length) lines.push(line);
  return lines.filter(l => l.some(i => i.text.trim()))
    .map(l => ({ l, x0: Math.round(l[0].x), x1: Math.max(...l.map(i => i.right ?? i.x + i.width)), y: l[0].y, h: l[0].height || 10, page: l[0].page ?? 1 }));
}

// one page's guess: { headerBottom, split?, doubt? } (with a split, the header ends where the right column starts); doubt is true when a column was seen but not trusted, or trusted with a question
function guess(rows){
  if (rows.some(r => !Number.isFinite(r.y))) return {};
  const top = [...rows].sort((a, b) => b.y - a.y);
  const lead = top.findIndex(r => rows.filter(o => o !== r && Math.abs(o.x0 - r.x0) <= NEAR).length >= MIN_LINES - 1);
  if (lead < 0) return {};
  const body = top.slice(lead);
  const headerBottom = body[0].y + body[0].h + 1;
  const xs = [...new Set(body.map(r => r.x0))].sort((a, b) => a - b);
  const cuts = xs.filter((x, i) => i > 0 && x - xs[i - 1] > GAP);
  let doubt = false;
  for (const s of cuts){
    const left = body.filter(r => r.x0 < s), right = body.filter(r => r.x0 >= s);
    if (left.length < MIN_LINES || right.length < MIN_LINES) continue;
    if (right.filter(r => r.x0 - s <= NEAR).length * 2 < right.length) continue;      // a column's rows start together: a few lines set right within another column (dates) do not make one
    const paired = (a, b) => a.map(r => b.some(o => Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y) >= 0.5 * Math.min(r.h, o.h)));      // side by side: the rows overlap by half a line (a design need not share a baseline)
    const run = p => p.some((v, i) => v && p[i + 1]);
    const crossing = left.filter(r => r.y < right[0].y && r.x1 > s + 1);
    // a right column that starts above the left one may be a header that starts where the columns do: split, but say so
    if (run(paired(left, right)) && run(paired(right, left)) && crossing.length <= Math.min(left.length, right.length) / 2) return { headerBottom: right[0].y + right[0].h + 1, split: s, doubt: right[0].y > left[0].y + 1 };
    doubt = true;
  }
  return { headerBottom, doubt };
}

// the layout of every page: the ones given, and a guess for the rest. { layout, doubts: [page, ...] }
export function layoutOf(items, given = []){
  const rows = rowsOf(items);
  const layout = [], doubts = [];
  for (const page of [...new Set(rows.map(r => r.page))].sort((a, b) => a - b)){
    const own = given.find(g => g.page === page);
    if (own){ layout.push(own); continue; }
    const { doubt, ...g } = guess(rows.filter(r => r.page === page));
    layout.push({ page, ...g });
    if (doubt) doubts.push(page);
  }
  return { layout, doubts };
}

// the items in reading order for a layout (guessed when none is given); the very same array when nothing moves
export function splitColumns(items, layout = layoutOf(items).layout){
  const rows = rowsOf(items);
  const place = r => {
    const g = layout.find(x => x.page === r.page) ?? {};
    if (g.headerBottom != null && r.y + r.h > g.headerBottom) return 0;
    return g.split != null && r.x0 >= g.split ? 2 : 1;
  };
  const order = rows.map((r, i) => ({ r, i, c: place(r) })).sort((a, b) => a.r.page - b.r.page || a.c - b.c || a.i - b.i);
  if (order.every(({ i }, k) => i === k)) return items;
  return order.flatMap(({ r }) => r.l.map((it, k) => (k === r.l.length - 1 ? { ...it, hasEOL: true } : it)));
}
