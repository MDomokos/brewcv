// Not from OpenResume. Reads CSV text into rows of cells (quoted cells, "" for a quote, line breaks inside quotes, a leading byte order mark).
// Moved here from scripts/i18n-review.mjs, which imports it from here.
export function parseCsv(text){
  const rows = []; let row = [], cur = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++){
    const c = s[i];
    if (q){ if (c === '"'){ if (s[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ','){ row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r'){ if (c === '\r' && s[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length){ row.push(cur); rows.push(row); }
  return rows;
}
