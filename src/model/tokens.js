// Theme tokens. Pure: no DOM. Reads CSS, simple JSON and DTCG; writes DTCG.
// A theme sets values for a fixed token list, never layout or markup, so an imported one is safe to apply.

export const TOKENS = [
  // name            DTCG path                type          CSS properties
  ['accent',         'color.accent',          'color',      ['--accent']],
  ['tab',            'color.tab',             'color',      ['--tab-fill']],
  ['highlight',      'color.highlight',       'color',      ['--highlight']],
  ['ink',            'color.ink',             'color',      ['--ink']],
  ['ink-body',       'color.ink-body',        'color',      ['--ink-body', '--ink-summary']],
  ['muted',          'color.muted',           'color',      ['--muted']],
  ['meta',           'color.meta',            'color',      ['--meta']],
  ['tab-ink',        'color.tab-ink',         'color',      ['--tab-ink']],
  ['page',           'color.page',            'color',      ['--paper']],
  ['font-body',      'font.body.family',      'fontFamily', ['--font-sans']],
  ['font-mono',      'font.mono.family',      'fontFamily', ['--font-mono']],
  ['font-name',      'font.name.family',      'fontFamily', ['--font-name']],
  ['font-heading',   'font.heading.family',   'fontFamily', ['--font-heading']],
  ['weight-name',    'font.name.weight',      'fontWeight', ['--weight-name']],
  ['weight-heading', 'font.heading.weight',   'fontWeight', ['--weight-heading']],
  ['size-name',      'size.name',             'dimension',  ['--fs-name']],
  ['size-heading',   'size.heading',          'dimension',  ['--fs-role']],
  ['size-body',      'size.body',             'dimension',  ['--fs-bullet']],
  ['size-meta',      'size.meta',             'dimension',  ['--fs-meta']],
  ['line-height-body', 'line-height.body',    'number',     ['--lh-bullet']],
  ['tracking-label', 'tracking.label',        'dimension',  ['--ls-tab']],
  ['section-gap',    'space.section',         'dimension',  ['--band-gap']],
  ['bullet-gap',     'space.bullet',          'dimension',  ['--bullet-gap']],
  ['gutter',         'space.gutter',          'dimension',  ['--gutter-gap']],
  ['margin',         'space.margin',          'dimension',  ['--page-pad-t', '--page-pad-r', '--page-pad-b', '--page-pad-l']],
  ['tab-radius',     'radius.tab',            'dimension',  ['--tab-radius']],
  ['tab-style',      'style.tab',             'string',     []],
  ['highlight-style', 'style.highlight',      'string',     []],
].map(([name, path, type, css]) => ({ name, path, type, css }));

export const BY_NAME = new Map(TOKENS.map(t => [t.name, t]));
const BY_PATH = new Map(TOKENS.map(t => [t.path, t]));
// other names people write for a token
const ALIASES = { font: 'font-body', 'name-size': 'size-name', 'font-family': 'font-body', 'tab-fill': 'tab', paper: 'page', background: 'page', text: 'ink' };
const SWITCHES = { 'tab-style': ['solid', 'underline', 'outline', 'none'], 'highlight-style': ['marker', 'bold', 'none'] };

// Families this app has files for, or that every machine has.
export const KNOWN_FONTS = ['Hanken Grotesk', 'Fira Code', 'Source Serif 4', 'Source Sans 3', 'Helvetica Neue', 'Helvetica', 'Arial', 'Georgia', 'Times New Roman', 'Times',
  'Verdana', 'Courier New', 'Menlo', 'Monaco', 'Consolas', 'Segoe UI', 'Calibri', 'Cambria', 'Garamond',
  'serif', 'sans-serif', 'monospace', 'system-ui', 'ui-monospace', 'ui-sans-serif', 'ui-serif', '-apple-system', 'BlinkMacSystemFont'];

const UNSAFE = /url\s*\(|expression|javascript:|@import|[;{}<>\\]/i;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^(rgb|rgba|hsl|hsla)\(\s*[-\d.%\s,/]+\)$/i;

// "{color.accent}" stays a link and becomes var() in CSS, so changing the accent moves what follows it.
const ALIAS = /^\{([\w.-]+)\}$/;
export const aliasOf = v => (typeof v === 'string' ? (v.match(ALIAS)?.[1] ?? null) : null);

// null when the value is unsafe or not of that type.
export function cssValue(type, v){
  if (v === null || v === undefined) return null;
  const al = aliasOf(v);
  if (al){ const t = BY_PATH.get(al); return t && t.type === type && t.css.length ? `var(${t.css[0]})` : null; }
  if (typeof v === 'string' && UNSAFE.test(v)) return null;
  switch (type){
    case 'color': {
      if (typeof v === 'object' && !Array.isArray(v)){
        if (v.alpha === 0) return 'transparent';
        if (typeof v.hex === 'string' && HEX.test(v.hex) && !(typeof v.alpha === 'number' && v.alpha < 1)) return v.hex.toLowerCase();
        if (Array.isArray(v.components) && v.components.length === 3 && v.components.every(n => typeof n === 'number' && n >= 0 && n <= 1)){
          const hex = '#' + v.components.map(n => Math.round(n * 255).toString(16).padStart(2, '0')).join('');
          return typeof v.alpha === 'number' && v.alpha < 1 ? `${hex}${Math.round(v.alpha * 255).toString(16).padStart(2, '0')}` : hex;
        }
        return null;
      }
      const s = String(v).trim();
      if (HEX.test(s)) return s.toLowerCase();
      if (FUNC.test(s) || s === 'transparent') return s;
      return null;
    }
    case 'fontFamily': {
      const list = Array.isArray(v) ? v : String(v).split(',');
      const out = list.map(x => String(x).trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      if (!out.length || out.some(x => !/^[\p{L}\p{N} _-]+$/u.test(x))) return null;
      return out.map(x => (/\s/.test(x) || /^\d/.test(x) ? `"${x}"` : x)).join(', ');
    }
    case 'fontWeight': {
      const names = { thin: 100, hairline: 100, 'extra-light': 200, light: 300, normal: 400, regular: 400, medium: 500, 'semi-bold': 600, bold: 700, 'extra-bold': 800, black: 900, heavy: 900 };
      const n = typeof v === 'number' ? v : names[String(v).toLowerCase()] ?? Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 1000 ? String(n) : null;
    }
    case 'dimension': {
      if (typeof v === 'object' && v && typeof v.value === 'number' && /^(px|rem|em)$/.test(v.unit ?? '')) return v.value >= -200 && v.value <= 400 ? `${+v.value.toFixed(4)}${v.unit}` : null;
      const m = String(v).trim().match(/^(-?\d+(?:\.\d+)?)(px|rem|em|pt|mm)$/);
      if (!m) return v === 0 || v === '0' ? '0px' : null;
      return Math.abs(Number(m[1])) <= 400 ? `${m[1]}${m[2]}` : null;
    }
    case 'number': {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      return Number.isFinite(n) && n > 0 && n <= 10 ? String(n) : null;
    }
    case 'string': return typeof v === 'string' && /^[a-z-]+$/.test(v) ? v : null;
  }
  return null;
}

function accept(name, raw){
  const t = BY_NAME.get(name);
  if (!t) return { error: 'not a theme token' };
  if (SWITCHES[name]) return SWITCHES[name].includes(String(raw)) ? { value: String(raw) } : { error: `expected ${SWITCHES[name].join(' / ')}` };
  const v = cssValue(t.type, raw);
  if (v === null) return { error: `not a safe ${t.type} value` };
  return { value: aliasOf(raw) ? raw : v };
}

export function parseTheme(input, { fileName = '' } = {}){
  let obj = input;
  if (typeof input === 'string'){
    const s = input.trim();
    if (s.startsWith('{')){
      try { obj = JSON.parse(s); } catch (e){ return { name: '', tokens: {}, ignored: [{ key: fileName || 'file', why: `not valid JSON: ${e.message}` }], form: 'error' }; }
    } else return parseCss(s, fileName);
  }
  if (obj && typeof obj === 'object' && obj.tokens && typeof obj.tokens === 'object') return parseSimple(obj, fileName);
  return parseDtcg(obj, fileName);
}

function nameFrom(fileName){ return String(fileName).replace(/\.(tokens\.)?(json|css)$/i, '').replace(/[-_]+/g, ' ').trim(); }

function parseCss(text, fileName){
  const tokens = {}, ignored = [];
  const named = text.match(/\/\*\s*theme:\s*([^*]+?)\s*\*\//i);
  const roots = [...text.matchAll(/:root\s*\{([^}]*)\}/g)];
  const rest = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:root\s*\{[^}]*\}/g, '').trim();
  if (rest) ignored.push({ key: rest.slice(0, 40), why: 'only --doc-* tokens in :root are read; other rules are ignored' });
  for (const [, body] of roots){
    for (const decl of body.split(';')){
      const m = decl.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/);
      if (!m){ if (decl.trim()) ignored.push({ key: decl.trim().slice(0, 40), why: 'not a custom property' }); continue; }
      const key = m[1];
      if (!key.startsWith('--doc-')){ ignored.push({ key, why: 'not a --doc-* token' }); continue; }
      const name = ALIASES[key.slice(6)] ?? key.slice(6);
      // var(--doc-accent) is the CSS way of writing an alias
      const link = m[2].trim().match(/^var\(--doc-([\w-]+)\)$/);
      const val = link && BY_NAME.has(ALIASES[link[1]] ?? link[1]) ? `{${BY_NAME.get(ALIASES[link[1]] ?? link[1]).path}}` : m[2];
      const got = accept(name, val);
      if (got.error) ignored.push({ key, why: got.error }); else tokens[name] = got.value;
    }
  }
  return { name: named?.[1] ?? nameFrom(fileName), tokens, ignored, form: 'css' };
}

function parseSimple(obj, fileName){
  const tokens = {}, ignored = [];
  for (const [k, raw] of Object.entries(obj.tokens)){
    const name = ALIASES[k] ?? k;
    const got = accept(name, raw);
    if (got.error) ignored.push({ key: k, why: got.error }); else tokens[name] = got.value;
  }
  for (const k of Object.keys(obj)) if (!['name', 'tokens', '$schema', 'description'].includes(k)) ignored.push({ key: k, why: 'not part of a theme' });
  return { name: typeof obj.name === 'string' ? obj.name : nameFrom(fileName), tokens, ignored, form: 'json' };
}

function parseDtcg(obj, fileName){
  const tokens = {}, ignored = [];
  if (!obj || typeof obj !== 'object') return { name: nameFrom(fileName), tokens, ignored: [{ key: 'file', why: 'not a theme' }], form: 'error' };
  const flat = new Map();
  const walk = (node, path, type) => {
    if (!node || typeof node !== 'object') return;
    const t = node.$type ?? type;
    if ('$value' in node){ flat.set(path.join('.'), { value: node.$value, type: t }); return; }
    for (const [k, v] of Object.entries(node)) if (!k.startsWith('$')) walk(v, [...path, k], t);
  };
  walk(obj, [], undefined);
  const resolveAlias = (v, seen = new Set()) => {
    if (typeof v !== 'string') return v;
    const m = v.match(/^\{([^{}]+)\}$/);
    if (!m) return v;
    if (seen.has(m[1]) || !flat.has(m[1])) return undefined;
    seen.add(m[1]);
    return resolveAlias(flat.get(m[1]).value, seen);
  };
  for (const [path, { value }] of flat){
    const t = BY_PATH.get(path) ?? BY_PATH.get(path.replace(/\.(value|default)$/, ''));
    if (!t){ ignored.push({ key: path, why: 'not a theme token' }); continue; }
    const v = aliasOf(value) && BY_PATH.has(aliasOf(value)) ? value : resolveAlias(value);
    if (v === undefined){ ignored.push({ key: path, why: 'an alias that resolves to nothing (or loops)' }); continue; }
    const got = accept(t.name, v);
    if (got.error) ignored.push({ key: path, why: got.error }); else tokens[t.name] = got.value;
  }
  // The 'resume-builder' extension key is an old name, kept: renaming it would orphan saved themes.
  const name = obj.$description ?? obj.$extensions?.['resume-builder']?.name ?? nameFrom(fileName);
  return { name: typeof name === 'string' ? name : nameFrom(fileName), tokens, ignored, form: 'dtcg' };
}

function dtcgValue(t, v){
  if (aliasOf(v)) return v;
  if (t.type === 'color'){
    if (v === 'transparent') return { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0, hex: '#000000' };
    const m = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i) ?? v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
    if (!m) return v;
    const hex = m[0].length === 4 ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : `#${m[1]}`;
    const comps = [1, 3, 5].map(i => +(parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4));
    return { colorSpace: 'srgb', components: comps, ...(m[2] && m[0].length > 7 ? { alpha: +(parseInt(m[2], 16) / 255).toFixed(4) } : {}), hex: hex.toLowerCase() };
  }
  if (t.type === 'fontFamily') return v.split(',').map(x => x.trim().replace(/^"|"$/g, ''));
  if (t.type === 'fontWeight' || t.type === 'number') return Number(v);
  if (t.type === 'dimension'){ const m = v.match(/^(-?[\d.]+)(px|rem|em|pt|mm)$/); return m ? { value: Number(m[1]), unit: m[2] } : v; }
  return v;
}
// DTCG 2025.10, with $type on every token.
export function serialize(name, tokens){
  const out = { $description: name, $extensions: { 'resume-builder': { name, version: 1 } } };
  for (const t of TOKENS){
    if (tokens[t.name] === undefined) continue;
    const parts = t.path.split('.');
    let o = out;
    for (const p of parts.slice(0, -1)) o = o[p] ??= {};
    o[parts.at(-1)] = { $type: t.type, $value: dtcgValue(t, tokens[t.name]) };
  }
  return out;
}

// Appended after the theme. A font the app has no files for gets the default stack after it,
// so a missing font falls back to the default rather than the browser's.
export function toCss(tokens, { fallbackFont = '"Hanken Grotesk", "Helvetica Neue", Helvetica, Arial, sans-serif' } = {}){
  const decl = [];
  for (const [name, v] of Object.entries(tokens ?? {})){
    const t = BY_NAME.get(name);
    if (!t || !t.css.length) continue;
    const checked = SWITCHES[name] ? null : cssValue(t.type, v);
    if (checked === null) continue;
    const val = t.type === 'fontFamily' && !aliasOf(v) && unknownFonts(checked).length ? `${checked}, ${fallbackFont}` : checked;
    for (const p of t.css) decl.push(`${p}: ${val};`);
  }
  let css = decl.length ? `:root { ${decl.join(' ')} }\n` : '';
  const tab = tokens?.['tab-style'];
  if (tab === 'underline') css += '.tab { background: none !important; box-shadow: inset 0 -2px 0 var(--tab-fill); }\n';
  if (tab === 'outline') css += '.tab { background: none !important; box-shadow: inset 0 0 0 1.2px var(--tab-ink, var(--ink)); }\n';
  if (tab === 'none') css += '.tab { background: none !important; }\n';
  const hl = tokens?.['highlight-style'];
  if (hl === 'bold') css += '.mark { background: none !important; font-weight: var(--fw-bold); }\n';
  if (hl === 'none') css += '.mark { background: none !important; }\n.namemark::before { display: none; }\n';
  return css;
}

export function unknownFonts(familyCss){
  return String(familyCss ?? '').split(',').map(x => x.trim().replace(/^"|"$/g, '')).filter(Boolean)
    .filter((f, i, a) => i === 0 && !KNOWN_FONTS.some(k => k.toLowerCase() === f.toLowerCase()));
}

// scripts/tokens.mjs writes these as DTCG.
export function tokensFromCss(cssText, base = {}){
  const vars = { ...base };
  for (const [, body] of String(cssText).matchAll(/:root\s*\{([^}]*)\}/g))
    for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  const resolve = (v, depth = 0) => (depth > 5 ? v : String(v).replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_, k, fb) => resolve(vars[k] ?? fb ?? '', depth + 1)));
  const out = {};
  const byCss = new Map(TOKENS.filter(t => t.css.length).map(t => [t.css[0], t]));
  for (const t of TOKENS){
    if (!t.css.length) continue;
    const raw = vars[t.css[0]];
    if (raw === undefined) continue;
    const link = String(raw).trim().match(/^var\((--[\w-]+)\)$/);
    if (link && byCss.has(link[1]) && byCss.get(link[1]).type === t.type){ out[t.name] = `{${byCss.get(link[1]).path}}`; continue; }
    const v = cssValue(t.type, resolve(raw));
    if (v !== null) out[t.name] = v;
  }
  return { tokens: out, vars };
}

const lin = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function luminance(hex){
  const m = String(hex).match(/^#([0-9a-f]{6})/i) ?? (String(hex).match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i) ? [null, String(hex).slice(1).split('').map(c => c + c).join('')] : null);
  if (!m) return null;
  const h = m[1];
  const [r, g, b] = [0, 2, 4].map(i => lin(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b){
  const x = luminance(a), y = luminance(b);
  if (x === null || y === null) return null;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
// 4.5:1 because tab text is small bold caps.
export function accentCheck(accent, ink = '#1a1a1a'){
  const c = contrast(accent, ink);
  return { ratio: c, ok: c !== null && c >= 4.5 };
}
