// Helpers for hand-written library data: inline [[marked]] and {{text|href}}
// become code-point offsets, so the offsets cannot drift from the text.

export const cps = s => [...s].length;

export function author(src){
  let text = '';
  const marks = [], links = [];
  const parts = src.split(/(\[\[|\]\]|\{\{[^|{}]*\|[^{}]*\}\})/);
  let open = null;
  for (const p of parts){
    if (p === '[['){ open = cps(text); continue; }
    if (p === ']]'){ marks.push({ start: open, end: cps(text), slot: 'primary' }); open = null; continue; }
    const link = p.match(/^\{\{([^|{}]*)\|([^{}]*)\}\}$/);
    if (link){
      const start = cps(text);
      text += link[1];
      links.push({ start, end: cps(text), href: link[2] });
      continue;
    }
    text += p;
  }
  for (const m of marks) m.expect = [...text].slice(m.start, m.end).join('');
  marks.sort((a, b) => a.start - b.start);
  links.sort((a, b) => a.start - b.start);
  return { text, marks, links };
}

export function library(){
  const variants = [], facts = [];
  function fact(id, def, phrasings){
    const made = [];
    for (const [suffix, src, extra = {}] of phrasings){
      const { text, marks, links } = author(src);
      const v = { id: `${id}-${suffix}`, lang: 'en', text, marks, links,
        tags: def.tags, source: def.source,
        seenIn: extra.seenIn ?? ['us-letter', 'a4'],
        metrics: { chars: cps(text), measured: {} } };
      if (extra.separator) v.separator = extra.separator;
      if (extra.note)   v.note = extra.note;
      if (extra.covers) v.covers = extra.covers;
      variants.push(v);
      made.push(v.id);
    }
    facts.push({ id, ...(def.work ? { work: def.work } : {}), axis: def.axis ?? 'density',
      ...(def.term ? { term: def.term } : {}), ...(def.label ? { label: def.label } : {}),
      summary: def.summary, source: def.source, variants: made });
  }
  return { variants, facts, fact };
}
