// The text of a line being written on the page, and back. A version's text is plain: what the old text box held, with
// its line breaks and every space as typed. The line on the page is an editable element, which a browser fills in its own
// way (a text node with a newline in it, or a <br>, or a <div> per line), so this reads any of them as the same text.
// Pure and DOM-free: it walks anything with nodeType, data, nodeName and childNodes (checks/edit-check.mjs does, in Node).

const BLOCK = new Set(['DIV', 'P', 'LI']);

// The plain text under `root`, as lines joined by newlines. A <br> ends a line, except the one a browser leaves alone in an
// empty element to hold it open; a block starts a new line (the first thing in the element does not); nothing is trimmed
// (the model cleans trailing blanks when it saves, exactly as it did for the text box).
export function plainOf(root){
  const lines = [''];
  let started = false;
  const newLine = () => lines.push('');
  const walk = (n, top) => {
    if (n.nodeType === 3){
      started = true;
      const parts = String(n.data).split('\n');
      lines[lines.length - 1] += parts[0];
      for (const p of parts.slice(1)){ newLine(); lines[lines.length - 1] += p; }
      return;
    }
    if (n.nodeType !== 1) return;
    const name = String(n.nodeName).toUpperCase();
    const kids = n.childNodes ?? [];
    if (name === 'BR') return;                      // handled by the parent, which knows whether it is a break or a placeholder
    if (!top && BLOCK.has(name)){ if (started) newLine(); started = true; }
    kids.forEach((c, i) => {
      if (c.nodeType === 1 && String(c.nodeName).toUpperCase() === 'BR'){
        if (kids.length === 1) return;              // alone in its element: it only holds the line open
        started = true; newLine();
      } else walk(c, false);
    });
  };
  walk(root, true);
  return lines.join('\n');
}

// Where the caret is in the text: offsets into plainOf(el), for a redraw that replaces the element.
export function caretOf(el){
  const doc = el.ownerDocument, sel = doc.defaultView?.getSelection?.();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
  const at = (node, off) => { const p = doc.createRange(); p.selectNodeContents(el); p.setEnd(node, off); const box = doc.createElement('div'); box.append(p.cloneContents()); return plainOf(box).length; };
  return { start: at(r.startContainer, r.startOffset), end: at(r.endContainer, r.endOffset) };
}
// The node and offset where the text offset `off` is, counting a <br> as one character
function locate(el, off){
  const doc = el.ownerDocument;
  let left = off;
  const w = doc.createTreeWalker(el, 4 /* text */ | 1 /* element, for <br> */);
  let n;
  while ((n = w.nextNode())){
    if (n.nodeType === 3){ if (left <= n.data.length) return [n, left]; left -= n.data.length; }
    else if (String(n.nodeName).toUpperCase() === 'BR'){ if (left === 0) return [n.parentNode, [...n.parentNode.childNodes].indexOf(n)]; left -= 1; }
  }
  return [el, el.childNodes.length];
}
// A range over the plain text from `start` to `end` (what the highlights are painted on while a line is written)
export function rangeOf(el, start, end){
  const r = el.ownerDocument.createRange();
  r.setStart(...locate(el, start)); r.setEnd(...locate(el, end));
  return r;
}
// Put the caret back (after the text was set as one text node, or as lines).
export function setCaret(el, { start, end }){
  const doc = el.ownerDocument, sel = doc.defaultView?.getSelection?.();
  if (!sel) return;
  const r = rangeOf(el, start, end);
  sel.removeAllRanges(); sel.addRange(r);
}
