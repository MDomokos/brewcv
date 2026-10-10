// A minimal DOM for running src/render.js in Node; only what render.js uses.
// innerHTML is stored verbatim: render.js has already encoded it through
// scripts/lib/html.mjs, and a second encoder here could disagree with it.

const VOID = new Set(['br', 'img', 'hr', 'input', 'link', 'meta', 'source']);

class El {
  constructor(tag){
    this.tagName = tag.toUpperCase();
    this.tag = tag;
    this.attrs = new Map();
    this.children = [];
    this.html = null;
  }
  set className(v){ this.attrs.set('class', v); }
  get className(){ return this.attrs.get('class') ?? ''; }
  setAttribute(k, v){ this.attrs.set(k, v); }
  getAttribute(k){ return this.attrs.get(k) ?? null; }
  set innerHTML(v){ this.html = v; this.children = []; }
  get innerHTML(){ return this.html ?? this.children.map(c => c.outerHTML).join(''); }
  append(...nodes){ for (const n of nodes) if (n) this.children.push(n); }
  get outerHTML(){ return serialize(this, 0, false); }
}

export function createDocument(){
  return { createElement: tag => new El(tag) };
}

const attrs = el => [...el.attrs].map(([k, v]) => ` ${k}="${v}"`).join('');

// innerHTML content is emitted byte for byte; indentation between block
// elements is only for reading.
export function serialize(el, depth = 0, pretty = true){
  const pad = pretty ? '  '.repeat(depth) : '';
  const open = `${pad}<${el.tag}${attrs(el)}>`;
  if (VOID.has(el.tag)) return open;
  if (el.html !== null) return `${open}${el.html}</${el.tag}>`;
  if (!el.children.length) return `${open}</${el.tag}>`;
  const nl = pretty ? '\n' : '';
  const kids = el.children.map(c => serialize(c, depth + 1, pretty)).join(nl);
  return `${open}${nl}${kids}${nl}${pad}</${el.tag}>`;
}
