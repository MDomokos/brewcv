// Dependency-free HTML parser and inline extractor. Every offset is a
// code-point index; never slice document text by UTF-16 unit.

const VOID = new Set(['br','meta','link','img','hr','input','source']);
const ENTS = { amp:'&', nbsp:' ', times:'×', ndash:'–', mdash:'—',
               lt:'<', gt:'>', quot:'"', apos:"'", middot:'·' };

export function decode(s){
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#'){
      const cp = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTS, body) ? ENTS[body] : m;
  });
}

// Re-encode the entities the documents use.
export function encode(s){
  let out = '';
  for (const ch of s){
    if (ch === '&') out += '&amp;';
    else if (ch === ' ') out += '&nbsp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else out += ch;
  }
  return out;
}

export function parse(html){
  const root = { tag:'#root', attrs:{}, children:[] };
  const stack = [root];
  let i = 0;
  const push = n => stack[stack.length-1].children.push(n);
  while (i < html.length){
    const lt = html.indexOf('<', i);
    if (lt < 0){ if (i < html.length) push({ tag:'#text', raw: html.slice(i) }); break; }
    if (lt > i) push({ tag:'#text', raw: html.slice(i, lt) });
    if (html.startsWith('<!--', lt)){ i = html.indexOf('-->', lt) + 3; continue; }
    if (html.startsWith('<!', lt)){ i = html.indexOf('>', lt) + 1; continue; }
    const gt = html.indexOf('>', lt);
    let raw = html.slice(lt + 1, gt);
    if (raw.startsWith('/')){ if (stack.length > 1) stack.pop(); i = gt + 1; continue; }
    const selfClose = raw.endsWith('/');
    if (selfClose) raw = raw.slice(0, -1);
    const tag = raw.match(/^([a-zA-Z0-9-]+)/)[1].toLowerCase();
    const attrs = {};
    const rest = raw.slice(tag.length);
    const ar = /([a-zA-Z_:-]+)\s*=\s*"([^"]*)"|([a-zA-Z_:-]+)/g;
    let am;
    while ((am = ar.exec(rest))) attrs[(am[1] || am[3]).toLowerCase()] = am[2] ?? '';
    const node = { tag, attrs, children: [] };
    push(node);
    if (!VOID.has(tag) && !selfClose) stack.push(node);
    i = gt + 1;
  }
  return root;
}

export function walk(node, fn){
  for (const c of node.children || []){ fn(c); walk(c, fn); }
}
export function hasClass(n, cls){
  return n.attrs && typeof n.attrs.class === 'string'
    && n.attrs.class.split(/\s+/).includes(cls);
}
export function all(root, pred){ const o=[]; walk(root, n => { if (pred(n)) o.push(n); }); return o; }
export function first(root, pred){ return all(root, pred)[0]; }
export function byClass(root, cls){ return all(root, n => hasClass(n, cls)); }

// Children to text plus half-open code-point offsets.
export function inline(node){
  let text = '', cp = 0;
  const marks = [], links = [], strongs = [], seps = [], secondary = [];
  const add = s => { text += s; cp += [...s].length; };
  const rec = n => {
    for (const c of n.children){
      if (c.tag === '#text'){ add(decode(c.raw)); continue; }
      if (c.tag === 'br'){ add('\n'); continue; }
      const start = cp;
      rec(c);
      const end = cp;
      if (c.tag === 'span' && hasClass(c, 'mark')) marks.push({ start, end, slot:'primary' });
      else if (c.tag === 'span' && hasClass(c, 'contact__sep')) seps.push({ start, end });
      else if (c.tag === 'span' && hasClass(c, 'item__title-secondary')) secondary.push({ start, end });
      else if (c.tag === 'a') links.push({ start, end, href: c.attrs.href });
      else if (c.tag === 'strong') strongs.push({ start, end });
    }
  };
  rec(node);
  for (const m of marks) m.expect = [...text].slice(m.start, m.end).join('');
  marks.sort((a,b) => a.start - b.start);
  return { text, marks, links, strongs, seps, secondary };
}

export function render(text, spans){
  const chars = [...text];
  const open = new Map(), close = new Map();
  for (const s of spans){
    (open.get(s.start) ?? open.set(s.start, []).get(s.start)).push(s);
    (close.get(s.end) ?? close.set(s.end, []).get(s.end)).push(s);
  }
  let out = '';
  for (let i = 0; i <= chars.length; i++){
    // close the last-opened span first
    for (const s of (close.get(i) || []).slice().reverse()) out += s.close;
    for (const s of (open.get(i) || [])) out += s.open;
    if (i < chars.length) out += chars[i] === '\n' ? '<br>' : encode(chars[i]);
  }
  return out;
}

// For the round-trip comparison.
export function innerHTML(node){
  let out = '';
  for (const c of node.children){
    if (c.tag === '#text'){ out += c.raw; continue; }
    const attrs = Object.entries(c.attrs).map(([k,v]) => ` ${k}="${v}"`).join('');
    out += `<${c.tag}${attrs}>`;
    if (!VOID.has(c.tag)) out += innerHTML(c) + `</${c.tag}>`;
  }
  return out;
}
