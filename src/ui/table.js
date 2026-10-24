// The table the mat lies on (prototype): what shows when the view is zoomed out. A top-down drawing in millimetres, so a teapot is the size
// of a teapot beside the A4 sheet (src/ui/canvas.js scales one millimetre to what the page's is on screen): a wooden table around the mat,
// and things on it. Tea has the tea things; Coffee has a mug and a pen, and its mat is a cutting mat with a ruler printed on two edges.
// The shapes are drawn at a convenient size and each is put at its real one by the `f` of `at`. The things are separate groups so one
// drink's can leave and the other's arrive one by one (canvas.swapTable) instead of the whole table changing at once.

const shade = (inner, dx = 7, dy = 9) => `<g transform="translate(${dx} ${dy})" fill="#000" opacity=".2">${inner}</g>`;

// ---- Tea ----
const HANDLE = 'M92 -50 q70 0 70 50 q0 50 -70 50 v-24 q34 0 34 -26 q0 -26 -34 -26z';
const teapot = `${shade(`<circle r="96"/><rect x="-150" y="-18" width="70" height="36" rx="14"/><path d="${HANDLE}"/>`)}
  <path d="${HANDLE}" fill="#2e4636"/><rect x="-150" y="-18" width="70" height="36" rx="14" fill="#2e4636"/>
  <circle r="96" fill="#3d5a46"/><circle r="96" fill="none" stroke="#2e4636" stroke-width="6"/>
  <circle r="48" fill="#4a6b54"/><circle r="48" fill="none" stroke="#2e4636" stroke-width="4"/><circle r="12" fill="#D9A65A"/>`;
const cup = `${shade('<circle r="86"/><rect x="70" y="-16" width="52" height="32" rx="16"/>')}
  <rect x="70" y="-16" width="52" height="32" rx="16" fill="#f4efe6" stroke="#c9bfa8" stroke-width="3"/>
  <circle r="86" fill="#f4efe6"/><circle r="86" fill="none" stroke="#c9bfa8" stroke-width="3"/><circle r="56" fill="#fbf8f1"/>
  <circle r="56" fill="none" stroke="#4f6b3c" stroke-width="5"/><circle r="44" fill="#a8742c"/><circle r="44" fill="#D9A65A" opacity=".55"/>
  <ellipse cx="-14" cy="-14" rx="16" ry="8" fill="#fff" opacity=".35" transform="rotate(-30 -14 -14)"/>`;
const tin = `${shade('<rect x="-80" y="-110" width="160" height="220" rx="22"/>')}<rect x="-80" y="-110" width="160" height="220" rx="22" fill="#D9A65A"/>
  <rect x="-80" y="-110" width="160" height="220" rx="22" fill="none" stroke="#8a6416" stroke-width="5"/><rect x="-62" y="-92" width="124" height="184" rx="14" fill="#e6bb70"/>
  <circle r="46" fill="#2e4636"/><path d="M-24 14 q24 -50 52 -34 q-6 40 -52 34z" fill="#8fae5a"/><path d="M-24 14 q22 -22 44 -34" stroke="#2e4636" stroke-width="3" fill="none"/>`;
const whisk = (() => {
  const tines = Array.from({ length: 32 }, (_, i) => { const a = i / 32 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); return `<path d="M${(c * 14).toFixed(1)} ${(s * 14).toFixed(1)} Q${(c * 50).toFixed(1)} ${(s * 50).toFixed(1)} ${(c * 66).toFixed(1)} ${(s * 66).toFixed(1)}" stroke="#c9a864" stroke-width="3.4" fill="none" stroke-linecap="round"/>`; }).join('');
  return `${shade('<circle r="70"/>', 5, 6)}<circle r="70" fill="#e5cf9a" opacity=".5"/>${tines}<circle r="16" fill="#b78a43"/><circle r="9" fill="#d9bd7e"/>`;
})();
const leaves = '<g fill="#6f8f4e"><path d="M0 0 q30 -34 66 -16 q-12 38 -66 16z"/><path d="M-40 30 q10 -40 52 -34 q-2 36 -52 34z" fill="#5d7d43"/><path d="M26 44 q34 -6 52 22 q-34 14 -52 -22z" fill="#a9a43a"/></g>';
const dish = `${shade('<circle r="78"/>')}<circle r="78" fill="#efe6d2"/><circle r="78" fill="none" stroke="#c9bfa8" stroke-width="4"/><circle r="62" fill="#d8cdb2"/><g transform="scale(.8)">${leaves}</g>`;
const notebook = `${shade('<rect x="-120" y="-160" width="240" height="320" rx="10"/>')}<rect x="-120" y="-160" width="240" height="320" rx="10" fill="#2e4636"/>
  <rect x="-104" y="-144" width="214" height="288" rx="6" fill="#f1ead8"/><g stroke="#c9bfa8" stroke-width="2">${Array.from({ length: 12 }, (_, i) => `<path d="M-90 ${-110 + i * 22} H96"/>`).join('')}</g>
  <rect x="-120" y="-160" width="22" height="320" rx="6" fill="#1f3326"/>`;
const pencil = `${shade('<rect x="-150" y="-10" width="300" height="20" rx="3"/>', 5, 7)}<rect x="-150" y="-10" width="270" height="20" fill="#D9A65A"/><rect x="-150" y="-10" width="270" height="6" fill="#e6bb70"/>
  <path d="M120 -10 L150 0 L120 10z" fill="#e9d3a3"/><path d="M140 -3 L150 0 L140 3z" fill="#2b2b2b"/><rect x="-150" y="-10" width="26" height="20" fill="#d98c8c"/><rect x="-124" y="-10" width="8" height="20" fill="#b8b8b8"/>`;
const scoop = `${shade('<ellipse cx="-70" cy="0" rx="46" ry="30"/><rect x="-30" y="-8" width="150" height="16" rx="8"/>', 4, 6)}<ellipse cx="-70" cy="0" rx="46" ry="30" fill="#d9bd7e"/><ellipse cx="-70" cy="0" rx="34" ry="20" fill="#c9a864"/><rect x="-30" y="-8" width="150" height="16" rx="8" fill="#d9bd7e"/>`;

// ---- Coffee ----
const mug = `${shade('<circle r="74"/><rect x="62" y="-14" width="44" height="28" rx="14"/>', 5, 6)}<rect x="62" y="-14" width="44" height="28" rx="14" fill="#1c1410"/><circle r="74" fill="#1c1410"/><circle r="62" fill="#3b2a20"/><circle r="52" fill="#2a1d15"/>`;
const pen = `${shade('<rect x="-130" y="-8" width="260" height="16" rx="8"/>', 4, 6)}<rect x="-130" y="-8" width="260" height="16" rx="8" fill="#1c1410"/><rect x="60" y="-8" width="10" height="16" fill="#a8693a"/><rect x="-130" y="-8" width="40" height="16" rx="8" fill="#a8693a"/>`;
const notepad = `${shade('<rect x="-110" y="-150" width="220" height="300" rx="4"/>', 5, 7)}<rect x="-110" y="-150" width="220" height="300" rx="4" fill="#f3ece2" stroke="#1c1410" stroke-width="3"/><rect x="-110" y="-150" width="220" height="34" fill="#a8693a"/>
  <g stroke="#1c1410" stroke-width="1.5" opacity=".35">${Array.from({ length: 9 }, (_, i) => `<path d="M-92 ${-90 + i * 26} H92"/>`).join('')}</g>`;

// the things of a drink, each { x, y } in mm from the table's middle (so a thing can leave outward) and the group; w and h are the window in mm
export function tableObjects(drink, w, h){
  const f = n => +n.toFixed(1);
  const at = (fx, fy, rot, k, inner) => {
    const x = f(fx * w), y = f(fy * h), out = Math.hypot(x - w / 2, y - h / 2) || 1;
    return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${k})"><g class="tobj" data-dx="${f((x - w / 2) / out * 140)}" data-dy="${f((y - h / 2) / out * 140)}">${inner}</g></g>`;
  };
  // Laid out as a workspace along the strips above and below the mat that the 40% view shows (the sidebar covers the right; the strip at the
  // left is a sliver): the writing at the top (a notebook with the pencil across it, the dish and the tin), the tea service at the bottom
  // (pot, cup, whisk, spoon, leaves). Half of a thing may hang off the screen: it is for those who zoom all the way out.
  if (drink === 'coffee') return [at(.1, -.6, -12, .57, mug), at(.5, -.62, 8, .54, pen), at(.3, 1.6, 8, .5, notepad)];
  return [
    at(-.2, -.6, -12, .5, tin), at(.22, -.6, 83, .63, notebook), at(.3, -.57, -12, .58, pencil), at(.78, -.58, 0, .7, dish),
    at(.1, 1.6, -6, .73, teapot), at(.5, 1.6, 0, .81, cup), at(.86, 1.6, 0, .57, whisk), at(-.3, 1.62, -70, .62, scoop), at(1.05, 1.56, 20, .6, leaves), at(1.1, 1.64, -40, .42, leaves),
  ];
}

// the SVG of the table for a window of w by h mm; the table runs from -1.1 to 2.1 times that, the mat from -.4 to 1.4 (src/ui/canvas.js lays both out)
export function tableSvg(w, h){
  const x0 = -1.1 * w, y0 = -1.1 * h, tw = 3.2 * w, th = 3.2 * h;
  const grain = Array.from({ length: 46 }, (_, i) => `<path d="M${x0.toFixed(1)} ${(y0 + i * th / 46 + 4).toFixed(1)} H${(x0 + tw).toFixed(1)}" stroke="var(--tbl-grain)" stroke-width="${i % 3 ? 1 : 2}" opacity="${i % 4 ? .5 : .9}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${tw} ${th}" preserveAspectRatio="none" aria-hidden="true">
    <rect class="tfloor" x="${x0}" y="${y0}" width="${tw}" height="${th}"/><g class="tgrain">${grain}</g><g id="tobjs"></g></svg>`;
}

// The cutting mat's rulers: printed along its top and left edges in real millimetres, from its corner. `w` and `h` are the mat in mm, `ppm` how
// many screen px one mm is now (the ticks are only drawn as fine as they can be told apart), `label` the mm between the numbers.
export function rulerSvg(w, h, ppm){
  const ink = 'var(--ruler-ink)', band = 'var(--ruler-band)', B = 11;
  const fine = ppm >= 2.2, label = ppm < 1.2 ? 100 : ppm < 2.6 ? 50 : 10, fs = 4;
  const tick = (v, long) => {
    const len = v % 10 === 0 ? 7 : v % 5 === 0 ? 4.5 : 2.5;
    return long ? `<path d="M${v} 0 v${len}"/>` : `<path d="M0 ${v} h${len}"/>`;
  };
  const marks = (n, long) => {
    let t = '', txt = '';
    for (let v = 0; v <= n; v += fine ? 1 : 5){ if (v % (fine ? 1 : 5) === 0) t += tick(v, long); }
    for (let v = label; v <= n - 6; v += label){
      const num = v / 10;
      txt += long ? `<text x="${v + 1.2}" y="${B - 1.6}">${num}</text>` : `<text x="1.2" y="${v + 4.6}">${num}</text>`;
    }
    return `<g stroke="${ink}" stroke-width="${fine ? .35 : .5}" fill="none">${t}</g><g fill="${ink}" font-family="var(--font-mono)" font-size="${fs}">${txt}</g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <rect x="0" y="0" width="${w}" height="${B}" fill="${band}"/><rect x="0" y="0" width="${B}" height="${h}" fill="${band}"/>
    ${marks(w, true)}${marks(h, false)}</svg>`;
}
