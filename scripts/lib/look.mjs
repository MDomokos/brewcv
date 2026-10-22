// A resume's look settings as the scripts add them to a page: the same lookCss the app calls (src/model/design.js), the same
// `medium-print` class, so a PDF from the agent workflow matches the app's. Shared by render.mjs and export-pdf.mjs.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookCss, onPaper, MEDIA } from '../../src/model/design.js';

const HERE = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

// --medium wins, else the resume's own choice, else a screen. Exits with a usage error on a medium that does not exist.
export function mediumOf(flag, recipe){
  if (flag !== undefined && !MEDIA.includes(flag)){ console.error(`--medium ${flag}: not one of ${MEDIA.join(', ')}`); process.exit(2); }
  return flag ?? (MEDIA.includes(recipe?.exportMedium) ? recipe.exportMedium : 'screen');
}

// { css, paper }: css is '' when the settings add nothing. Its font urls are named relative to templates/, like the stylesheets', so
// they are pointed at the repo from `dir`, the folder of the page that will carry them.
export function lookFor(model, recipe, medium, dir, repo = HERE){
  const rel = path.relative(path.resolve(dir), repo).split(path.sep).join('/') || '.';
  const css = lookCss(model, recipe, { medium }).replace(/url\("\.\.\//g, `url("${rel}/`).replace(/<\/style/gi, '<\\/style');
  return { css, paper: onPaper(medium) };
}
