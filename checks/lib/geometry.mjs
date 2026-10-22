// The page and the body line, read from formats/ and themes/ rather than written down here. A format
// named "a4-hu" is a4.css with a4-hu.css loaded after it, so later declarations win.

import fs from 'node:fs';
import path from 'node:path';
import { lookCss } from '../../src/model/design.js';

const grab = (css, name) => {
  // a size may be written calc(<n>px * var(--type-scale)): the scale is 1 in the stylesheets
  const m = [...css.matchAll(new RegExp(`${name}\\s*:\\s*(?:calc\\(\\s*)?([\\d.]+)(?:px)?\\s*(?:\\*\\s*var\\(--[\\w-]+\\)\\s*\\))?\\s*[;}]`, 'g'))].pop();
  return m ? Number(m[1]) : null;
};

// `model`: the record, to read the resume's own text size and line spacing (its look settings) as the app measures them.
export function geometryFor(repo, recipe, model = null){
  const formats = [...new Set([recipe.format.replace(/-[a-z]+$/, ''), recipe.format])];
  let css = '';
  for (const f of formats){
    const file = path.join(repo, 'formats', `${f}.css`);
    if (fs.existsSync(file)) css += fs.readFileSync(file, 'utf8') + '\n';
  }
  const theme = fs.readFileSync(path.join(repo, 'themes', `${recipe.theme}.css`), 'utf8');
  const h = grab(css, '--page-h'), t = grab(css, '--page-pad-t'), b = grab(css, '--page-pad-b');
  const fs_ = grab(theme, '--fs-bullet'), lh = grab(theme, '--lh-bullet');
  if ([h, t, b, fs_, lh].some(x => x === null))
    throw new Error(`cannot read the page or the body line for ${recipe.format}@${recipe.theme} from formats/ and themes/`);
  const look = model ? lookCss(model, recipe) : '';
  const scale = Number(/--type-scale:([\d.]+)/.exec(look)?.[1] ?? 1), own = Number(/--lh-bullet:([\d.]+)/.exec(look)?.[1] ?? lh);
  return { usable: h - t - b, lineH: fs_ * scale * own };
}
