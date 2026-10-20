// The story on the start screen (Intro Lab v17, concept A): one career file, a page pulled from it line by line, the same words in any
// look, and a stack with a resume for every job. Four steps, played once and then scrubbed with the step line under the picture.
//   - src/ui/start.js builds the right-hand column (the ways in, the languages, Why JSON?, Yours to keep) and hands the picture to this file.
//   - the picture is a fixed 1240 x 680 stage scaled to fit. State is a plain object per moment (stateAt); show() draws it and flip()
//     animates the difference (FLIP): a line flies from the file to the page, a sheet slides in and out of the stack.
//   - the career in the picture is a made-up café manager (English and German); the labels around it are the app's words (story.*).
// Every colour is a token (src/ui/start.css); with reduced motion the picture opens on the last step and nothing plays.

import { t, h } from '../i18n/index.js';
import { icon } from './icons.js';
import { reduced } from './motion.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- the career in the picture ----------
const L = {
  // the fourth wording of h1 is the one written on the page in step 2 (it exists once s.added)
  h1: { job: 'lumen', en: ['Ran a team of six baristas.', 'Ran a team of six and cut wait times in half.', 'Led six baristas through the morning rush.', 'Led a team of six and halved the morning wait.'],
        de: ['Leitete ein Team von sechs Baristas.', 'Leitete ein Team von sechs und halbierte die Wartezeit.', 'Führte sechs Baristas durch den Morgenansturm.', 'Führte ein Team von sechs und halbierte die Wartezeit am Morgen.'] },
  h2: { job: 'lumen', en: ['Opened the café’s second shop.'], de: ['Eröffnete die zweite Filiale des Cafés.'] },
  h3: { job: 'lumen', en: ['Trained every new hire on the espresso bar.'], de: ['Schulte jede neue Kraft an der Espressobar.'] },
  h4: { job: 'leaf', en: ['Grew the tea menu from 12 blends to 40.', 'Built a menu of 40 teas, up from 12.'], de: ['Erweiterte die Teekarte von 12 auf 40 Sorten.', 'Baute eine Karte mit 40 Tees auf, statt 12.'] },
  h5: { job: 'leaf', en: ['Ran a tasting every Saturday.'], de: ['Leitete jeden Samstag eine Verkostung.'] },
};
const JOB = {
  lumen: { name: 'Café Lumen', pos: { en: 'Café manager', de: 'Café-Leitung' }, d: { en: '2021 to now', de: '2021 bis heute' } },
  leaf: { name: 'Green Leaf Tea House', pos: { en: 'Shift lead', de: 'Schichtleitung' }, d: { en: '2018 to 2021', de: '2018 bis 2021' } },
};
const TL = { cafe: { en: 'Café manager', de: 'Café-Leitung' }, tea: { en: 'Tea shop lead', de: 'Teeladen-Leitung' }, trainer: { en: 'Barista trainer', de: 'Barista-Training' } };
const SKILLS = { en: 'Scheduling, stock, latte art', de: 'Dienstpläne, Lager, Latte Art' };
const SEC = { en: ['Experience', 'Skills'], de: ['Berufserfahrung', 'Kenntnisse'] };
const LOOKS = { marker: 'Marker', mono: 'Mono', serif: 'Serif' };
const PAPERS = { letter: 'Letter', a4: 'A4' };

// ---------- the moments ----------
const BASE = { ver: { h1: 0, h4: 0 }, page: 'blank', picks: [], jobOrder: ['lumen', 'leaf'], lang: 'en', look: 'marker', paper: 'letter', tl: 'cafe',
  lift: null, style: false, added: false, edit: null, id: 'cafe', job: null, tags: null, cards: [], exports: false, slips: null };
// the first resume, as it is kept at the end of step 3: it uses the wording written on its page (v4)
const CAFE_A = { id: 'cafe', page: 'on', tl: 'cafe', look: 'serif', lang: 'de', paper: 'a4', picks: ['h1', 'h3', 'h2', 'h4'], jobOrder: ['lumen', 'leaf'], ver: { h1: 3, h4: 0 }, added: true };
const TEA_END = { id: 'tea', page: 'on', tl: 'tea', look: 'marker', lang: 'en', paper: 'letter', picks: ['h4', 'h5', 'h1'], jobOrder: ['leaf', 'lumen'], ver: { h1: 2, h4: 1 }, added: true };
const TRAINER = { id: 'trainer', page: 'on', tl: 'trainer', look: 'mono', lang: 'en', paper: 'letter', picks: ['h3', 'h1', 'h5'], jobOrder: ['lumen', 'leaf'], ver: { h1: 0, h4: 0 }, added: true };
// the second resume starts empty: another job, the same file
const TEA0 = { id: 'tea', tl: 'tea', look: 'marker', lang: 'en', paper: 'letter', picks: [], jobOrder: ['leaf', 'lumen'], ver: { h1: 2, h4: 1 }, lift: null };
const PICK1 = [{ picks: ['h1'] }, { picks: ['h1', 'h2'] }, { picks: ['h1', 'h2', 'h3'] }, { picks: ['h1', 'h2', 'h3', 'h4'] }];
const PICK2 = [{ picks: ['h4'] }, { picks: ['h4', 'h5'] }, { picks: ['h4', 'h5', 'h1'] }];
const LOOK = [{ look: 'mono' }, { lang: 'de' }, { paper: 'a4' }, { look: 'serif' }];

// each step: its words, the wait before its first moment (dt), the hold after its last (hold), and the moments (seq, each with its own _dt)
const STEPS = [
  { t: 'story.s1', s: 'story.s1d', dt: 700, hold: 2400, seq: [{ page: 'none' }] },
  { t: 'story.s2', s: 'story.s2d', dt: 760,
    seq: [{ page: 'on', job: 'cafe', tags: 'cafe' }, ...PICK1.slice(0, 4), { lift: 'h3', _dt: 760 }, { picks: ['h1', 'h3', 'h2', 'h4'], _dt: 700 }, { lift: null, _dt: 900 },
      { slips: 'h1', _dt: 800 }, { ver: { h1: 1, h4: 0 }, _dt: 1100 }, { ver: { h1: 2, h4: 0 }, _dt: 1150 }, { edit: 'h1', _dt: 1150 }, { edit: null, added: true, ver: { h1: 3, h4: 0 }, _dt: 1300 }] },
  { t: 'story.s3', s: 'story.s3d', dt: 1000, seq: [{ slips: null, job: null, tags: null, style: true }, ...LOOK] },
  { t: 'story.s4', s: 'story.s4d', dt: 820,
    seq: [{ cards: [CAFE_A], ...TEA0, job: 'tea', tags: 'tea' }, { ...PICK2[0], _dt: 1100 }, ...PICK2.slice(1), { cards: [CAFE_A, TRAINER], _dt: 1100 }, { exports: true, _dt: 1200 }, { ...CAFE_A, job: null, tags: null, cards: [TEA_END, TRAINER], _dt: 1100 }] },
];

// ---------- drawing ----------
function wordsHtml(text, prev){
  if (!prev || prev === text) return esc(text);
  const had = new Set(prev.toLowerCase().split(/\s+/));
  return text.split(/(\s+)/).map(w => /^\s*$/.test(w) || had.has(w.toLowerCase()) ? esc(w) : `<span class="nw">${esc(w)}</span>`).join('');
}
const kv = (k, v) => `<span class="k">"${k}"</span><span class="p">:</span> ${v}`;
const str = v => `"${esc(v)}"`;
const vers = (s, id, lang = 'en') => id === 'h1' && !s.added ? L.h1[lang].slice(0, 3) : L[id][lang];

// the career file: its words never change; a row glows when this resume picks or writes one of its wordings
function fileHtml(s, P){
  const rows = [];
  const R = (code, i = 0) => rows.push(`<div class="fln"><span class="cd" style="--i:${i}">${code}</span></div>`);
  const H = (id, last) => {
    const vs = vers(s, id), vi = s.ver[id] ?? 0, used = s.picks.includes(id);
    const off = s.page === 'on' && !used ? ' off' : '';
    const flash = P && ((P.ver[id] ?? 0) !== vi || (id === 'h1' && P.added !== s.added)) ? ' flash' : '';
    const tg = L[id].job === 'leaf' ? 'tea' : 'cafe';
    const tag = `<i class="ftag${s.tags === tg ? ' lit' : ''}">#${tg === 'tea' ? 'tea' : 'café'}</i>`;
    // a wording written on the page arrives in the file as a new chip
    const chips = vs.length > 1 ? `<span class="vch">${vs.map((_, n) => `<i class="${used && n === vi ? 'on' : ''}"${id === 'h1' && n === 3 ? ` data-k="fc-h1-3"${P && !P.added ? ' data-new' : ''}` : ''}>v${n + 1}</i>`).join('')}</span>` : '';
    rows.push(`<div class="fln hl${used ? ' used' : ''}${off}${flash}${s.edit === id ? ' editing' : ''}" data-k="f-${id}"><span class="fmk"></span><span class="cd" style="--i:4">"${esc(vs[0])}"${last ? '' : '<span class="p">,</span>'}</span>${chips}${tag}</div>`);
  };
  R('<span class="p">{</span>');
  R(kv('basics', `<span class="p">{</span> ${kv('name', str('Sam Rivera'))}<span class="p">,</span> ${kv('city', str('Lisbon'))} <span class="p">},</span>`), 1);
  R(kv('work', '<span class="p">[</span>'), 1);
  R(`<span class="p">{</span> ${kv('name', str('Café Lumen'))}<span class="p">,</span>`, 2);
  R(kv('highlights', '<span class="p">[</span>'), 3);
  H('h1'); H('h2'); H('h3', true);
  R('<span class="p">] },</span>', 3);
  R(`<span class="p">{</span> ${kv('name', str('Green Leaf Tea House'))}<span class="p">,</span>`, 2);
  R(kv('highlights', '<span class="p">[</span>'), 3);
  H('h4'); H('h5', true);
  R('<span class="p">] }</span>', 3);
  R('<span class="p">],</span>', 1);
  R(kv('skills', `<span class="p">[</span>${str('Scheduling')}<span class="p">,</span> ${str('Stock')}<span class="p">,</span> ${str('Latte art')}<span class="p">]</span>`), 1);
  R('<span class="p">}</span>');
  return `<div class="fcard"><div class="fh"><b>career.json</b></div>${rows.join('')}</div>`;
}

function pageHtml(s, P, o = {}){
  const k = (key, from) => o.mini ? '' : ` data-k="${key}"${from ? ` data-from="${from}"` : ''}`;
  const cls = `pg ${s.look} ${s.paper}`;
  if (s.page === 'blank') return `<div class="${cls} blank"${k('pg')}><span class="ph">${h('story.blank')}</span></div>`;
  const lang = s.lang;
  const jobs = s.jobOrder.filter(j => s.picks.some(id => L[id].job === j)).map(j => {
    const lis = s.picks.filter(id => L[id].job === j).map(id => {
      const vs = vers(s, id, lang), vi = Math.min(s.ver[id] ?? 0, vs.length - 1);
      const prev = P && !o.mini && P.page === 'on' && P.lang === lang && P.picks.includes(id) && (P.ver[id] ?? 0) !== vi && !P.edit ? L[id][lang][P.ver[id] ?? 0] : null;
      const tag = o.vtag && vs.length > 1 && !s.edit ? `<i class="vtag">v${vi + 1}</i>` : '';
      if (s.edit === id && !o.mini) return `<li class="edit"${k('p-' + id)}><span class="typed">${esc(L[id][lang][3])}</span></li>`;
      return `<li class="${s.lift === id ? 'lift' : ''}${o.hot === id ? ' hot' : ''}"${k('p-' + id, o.fly ? 'f-' + id : '')}>${wordsHtml(vs[vi], prev)}${tag}</li>`;
    }).join('');
    return `<div class="job"${k('j-' + j)}><div class="jt"><b>${JOB[j].name}</b><span>${JOB[j].d[lang]}</span></div><div class="jp">${JOB[j].pos[lang]}</div><ul>${lis}</ul></div>`;
  }).join('');
  return `<div class="${cls}"${k('pg')}${o.mini ? '' : ' data-clone'}>
    <header${k('ph')}><b class="nm">Sam Rivera</b><span class="tg">${TL[s.tl][lang]}</span><span class="ct">sam@example.com · ${lang === 'de' ? 'Lissabon' : 'Lisbon'}</span></header>
    ${jobs ? `<h4 class="sec"${k('sx')}>${SEC[lang][0]}</h4>${jobs}<h4 class="sec"${k('ss')}>${SEC[lang][1]}</h4><p${k('sk')}>${SKILLS[lang]}</p>` : ''}
    <span class="pf">${PAPERS[s.paper]} · ${lang.toUpperCase()}</span></div>`;
}
const seg = (opts, val, prev) => `<span class="sgm">${Object.entries(opts).map(([k, n]) => `<i class="${k === val ? 'on' : ''}${k === val && prev && prev !== val ? ' chg' : ''}">${n}</i>`).join('')}</span>`;
const lookSegs = (s, P) => `${seg(LOOKS, s.look, P?.look)}${seg({ en: 'EN', de: 'DE' }, s.lang, P?.lang)}${seg(PAPERS, s.paper, P?.paper)}`;
const exportsHtml = () => `<div class="float"><span class="stlbl">${h('story.sendAs')}</span>${['PDF', h('story.web'), h('story.text'), 'JSON Resume'].map(x => `<i class="xchip">${x}</i>`).join('')}</div>`;
const jobCard = kind => `<div class="jobcard"><span class="stlbl">${h(kind === 'cafe' ? 'story.thisJob' : 'story.nextJob')}</span><b>${kind === 'cafe' ? 'Café manager' : 'Tea shop lead'}</b><span>${h(kind === 'cafe' ? 'story.jobCafe' : 'story.jobTea')}</span></div>`;
// the stack: the page on top, the kept resumes fanned out behind it from their bottom-left corner; each resume's tab sticks out of its own right edge
const TABS = { cafe: ['Café manager', 'Serif · DE · A4', 100], tea: ['Tea shop lead', 'Marker · EN', 30], trainer: ['Trainer', 'Mono · EN', 170] };
const POS = [{ x: 0, y: 0, r: 0 }, { x: 28, y: -30, r: 4 }, { x: 52, y: -40, r: 8 }];
const PZ = 1.1, PAGE_AT = [440, 48];
const pageH = c => c.paper === 'a4' ? 566 : 518;
const fanT = (p, H, k = 1) => `translate(${p.x}px, ${p.y}px) translate(0px, ${H}px) rotate(${p.r}deg) translate(0px, ${-H}px) scale(${k})`;
const tabHtml = id => `<button class="itab" data-res="${id}" style="top:${TABS[id][2]}px" tabindex="-1"><b>${TABS[id][0]}</b><span>${TABS[id][1]}</span></button>`;
const sheetHtml = (c, p, d) => `<div class="sheet d${d}" data-id="${c.id}" style="transform:${fanT(p, pageH(c))}"><div class="sin">${pageHtml(c, null, { mini: true })}${tabHtml(c.id)}</div></div>`;
const snapOf = s => ({ id: s.id, page: 'on', tl: s.tl, look: s.look, lang: s.lang, paper: s.paper, picks: [...s.picks], jobOrder: [...s.jobOrder], ver: { ...s.ver }, added: s.added });
const stackOf = s => { const m = new Map(); if (s.page === 'on') m.set(s.id, 0); s.cards.forEach((c, i) => m.set(c.id, i + 1)); return m; };

// the other wordings of a line, as slips under the page's edge; updated in place so a pick slides rather than jumps
function slipsInto(box, s){
  const id = s.slips, vs = vers(s, id, s.lang), n = vs.length + (s.edit ? 1 : 0);
  if (box.dataset.n !== String(n) || box.dataset.lang !== s.lang){
    box.dataset.n = n; box.dataset.lang = s.lang;
    box.innerHTML = `<p class="sh">${h('story.wordings')}</p>` + Array.from({ length: n }, (_, i) => `<div class="slip" data-k="sl-${id}-${i}"><i class="vt">v${i + 1}</i><span></span></div>`).join('');
  }
  box.querySelectorAll('.slip').forEach((sl, i) => {
    const draft = !!s.edit && i === vs.length;
    sl.classList.toggle('on', !s.edit && i === s.ver[id]); sl.classList.toggle('draft', draft);
    sl.lastChild.textContent = draft ? t('story.writing') : vs[i];
  });
}

let HOT = null;                                  // the line of the career file the pointer is on
const SLOTS = ['file', 'slips', 'behind', 'page', 'look', 'job', 'exp', 'note'];
let EL = {};
function render(s, P, el){
  el.file.innerHTML = fileHtml(s, P);
  el.slips.classList.toggle('hide', !s.slips);
  if (s.slips) slipsInto(el.slips, s);
  el.behind.classList.toggle('hide', !s.cards.length);
  el.behind.innerHTML = s.cards.map((c, i) => sheetHtml(c, POS[i + 1], i + 1)).reverse().join('');
  el.page.classList.toggle('hide', s.page === 'none');
  if (s.page !== 'none') el.page.innerHTML = pageHtml(s, P, { fly: true, vtag: !!s.slips, hot: HOT }) + (s.cards.length ? tabHtml(s.id) : '');
  el.look.classList.toggle('hide', !s.style);
  el.look.innerHTML = `<div class="float"><span class="stlbl">${h('story.look')}</span>${lookSegs(s, P)}</div>`;
  el.job.classList.toggle('hide', !s.job);
  if (s.job) el.job.innerHTML = jobCard(s.job);
  el.exp.classList.toggle('hide', !s.exports); el.exp.innerHTML = exportsHtml();
}

// ---------- moving between moments (FLIP): measure, change, then animate the difference ----------
// Each move takes its time from its distance (short moves are quick, long ones glide), going back a little quicker.
// Whatever is in flight when the moment changes hands its current place on, so a scrub never jumps.
const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)', EASE_GLIDE = 'cubic-bezier(.45, .05, .15, 1)';
let SC = 1, BACK = false, STAGE = null, WRAP = null;
const dur = d => Math.round(Math.min(760, Math.max(340, 260 + d * .55)) * (BACK ? .8 : 1));
let STACKMOVE = false, stackTimer = 0, moving = false;
const fx = () => $('.fx', STAGE);
// a ghost needs a solid paper to fly on: skip see-through tints and take the card under them
const opaque = c => { const m = c && c.match(/rgba?\(([^)]+)\)/); if (!m) return false; const a = m[1].split(',')[3]; return a === undefined || +a > .9; };
const bgOf = e => { for (; e && e !== STAGE; e = e.parentElement){ const c = getComputedStyle(e).backgroundColor; if (opaque(c)) return c; } return 'transparent'; };
const kOf = (e, r) => (e.offsetWidth ? r.width / e.offsetWidth : SC) / SC;   // the element's scale against the stage
function looks(e, r){ // what a line looks like now, to redraw it in the overlay
  const cs = getComputedStyle(e), k = kOf(e, r);
  return { text: ((e.matches('.fln') && e.querySelector('.cd')) || e).textContent.trim(), font: `${cs.fontStyle} ${cs.fontWeight} ${(parseFloat(cs.fontSize) * k).toFixed(2)}px ${cs.fontFamily}`, color: cs.color, bg: bgOf(e) };
}
const at = (r, sr) => [(r.left - sr.left) / SC, (r.top - sr.top) / SC, r.width / SC, r.height / SC].map(v => +v.toFixed(1));
function travel(from, to, A, B, key){
  // A becomes B on the way: A's words fade as B's arrive, and the slip's paper changes with them
  const sr = STAGE.getBoundingClientRect(), [x0, y0, w0, h0] = at(from, sr), [x1, y1, w1, h1] = at(to, sr);
  const g = document.createElement('div'); g.className = 'stghost'; if (key) g.dataset.for = key;
  g.style.cssText = `left:${x0 - 6}px;top:${y0 - 2}px;width:${w0 + 12}px;height:${h0 + 4}px`;
  const lay = l => { const s = document.createElement('span'); s.textContent = l.text; s.style.cssText = `font:${l.font};color:${l.color}`; return s; };
  const a = lay(A), b = lay(B); g.append(a, b); fx().append(g);
  const ms = dur(Math.hypot(x1 - x0, y1 - y0)) + 260;
  g.animate([{ transform: 'none', width: `${w0 + 12}px`, height: `${h0 + 4}px`, background: A.bg }, { transform: `translate(${(x1 - x0).toFixed(1)}px, ${(y1 - y0).toFixed(1)}px)`, width: `${w1 + 12}px`, height: `${h1 + 4}px`, background: B.bg }], { duration: ms, easing: EASE_GLIDE }).onfinish = () => g.remove();
  // one text at a time: the code leaves in the first third, the resume's words arrive after the middle
  a.animate([{ opacity: 1 }, { opacity: 0, offset: .38 }, { opacity: 0 }], { duration: ms, fill: 'forwards' });
  b.animate([{ opacity: 0 }, { opacity: 0, offset: .46 }, { opacity: 1, offset: .8 }, { opacity: 1 }], { duration: ms, fill: 'forwards' });
  return ms;
}
function sheet(pg, from, to, key, fade){
  // a whole page sliding between the top of the stack and its place behind
  const sr = STAGE.getBoundingClientRect(), [x0, y0, w0] = at(from, sr), [x1, y1, w1] = at(to, sr);
  pg.style.cssText = `position:absolute;margin:0;transform-origin:0 0;left:${x0}px;top:${y0}px`; pg.classList.add('sheetghost'); pg.dataset.for = key;
  fx().append(pg);
  const ms = dur(Math.hypot(x1 - x0, y1 - y0)) + 200;
  pg.animate([{ transform: `scale(${(w0 / 400).toFixed(4)})`, opacity: 1 }, { transform: `translate(${(x1 - x0).toFixed(1)}px, ${(y1 - y0).toFixed(1)}px) scale(${(w1 / 400).toFixed(4)})`, opacity: fade ? .5 : 1 }], { duration: ms, easing: EASE_GLIDE }).onfinish = () => pg.remove();
  return ms;
}
function flip(update){
  if (reduced()){ update(); fx()?.replaceChildren(); return; }
  const inflight = new Map();
  fx().querySelectorAll('[data-for]').forEach(g => inflight.set(g.dataset.for, g.getBoundingClientRect()));
  const before = new Map();
  STAGE.querySelectorAll('[data-k]').forEach(e => {
    if (e.closest('.fx')) return;
    const r = inflight.get(e.dataset.k) || e.getBoundingClientRect();
    const b = { e, r, t: e.textContent, leaf: !e.querySelector('[data-k]'), from: e.dataset.from, exit: e.dataset.exit, hidden: !!e.closest('.slot.hide'), page: !!e.closest('.s-page') };
    if (b.from) b.look = looks(e, r);
    if (e.hasAttribute('data-clone')) b.clone = e.cloneNode(true);
    if (b.exit) b.clone = e.querySelector('.pg').cloneNode(true);
    before.set(e.dataset.k, b);
  });
  fx().replaceChildren();
  update();
  const els = [...STAGE.querySelectorAll('[data-k]')].filter(e => !e.closest('.fx'));
  const after = new Map(els.map(e => [e.dataset.k, e])), now = new Map(els.map(e => [e, e.getBoundingClientRect()]));
  // a page swapping with the stack: the sheet carries the change, the page's own lines just appear under it
  const removed = [...before.values()].filter(b => !after.has(b.e.dataset.k));
  const swap = els.some(e => e.dataset.grow && !before.has(e.dataset.k)) || removed.some(b => b.exit === 'pg' && after.has('pg'));
  const inPage = e => (swap || STACKMOVE) && e.closest('.s-page');
  const delta = new Map();
  els.forEach(e => { const b = before.get(e.dataset.k); if (!b) return; const a = now.get(e), k = kOf(e, a) * SC; delta.set(e, [(b.r.left - a.left) / k, (b.r.top - a.top) / k]); });
  els.forEach(e => {
    const anc = e.parentElement.closest('[data-k]'), ad = (anc && delta.get(anc)) || [0, 0];
    const b = before.get(e.dataset.k), a = now.get(e);
    if (b){
      if (inPage(e)) return;
      const [dx, dy] = delta.get(e), x = dx - ad[0], y = dy - ad[1];
      // a lifted line moves at a hand's pace, not a flick
      const slow = e.classList.contains('lift') || b.e.classList.contains('lift') ? 680 : 0;
      if (Math.abs(x) + Math.abs(y) > .5) e.animate([{ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)` }, { transform: getComputedStyle(e).transform }], { duration: Math.max(slow, dur(Math.hypot(x, y) * kOf(e, a))), easing: slow ? EASE_GLIDE : EASE_OUT });
      else if (b.leaf && b.t !== e.textContent && !e.querySelector('.nw')) e.animate([{ opacity: .2 }, { opacity: 1 }], { duration: 260 });
      return;
    }
    const src = e.dataset.from && !inPage(e) && after.get(e.dataset.from);
    if (src && before.has(e.dataset.from)){
      const from = before.get(e.dataset.from).r;
      const ms = travel(from, a, looks(src, now.get(src)), looks(e, a), e.dataset.k);
      e.animate([{ opacity: 0 }, { opacity: 0, offset: .9 }, { opacity: 1 }], { duration: ms + 40 });
      return;
    }
    const g = e.dataset.grow && before.get(e.dataset.grow);
    if (g && g.clone){
      const ms = sheet(g.clone, g.r, a, e.dataset.k, true);
      e.animate([{ opacity: 0 }, { opacity: 0, offset: .8 }, { opacity: 1 }], { duration: ms + 60 });
      return;
    }
    if (e.querySelector('[data-from]') && !swap) return;      // its lines fly in; the box itself just appears
    e.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: getComputedStyle(e).transform }], { duration: inPage(e) ? 420 : 280, easing: EASE_OUT });
  });
  // in a swap the page's new content fades in once the sheet has started to move, so two pages never sit on top of each other
  if (swap) STAGE.querySelectorAll('.s-page .pg').forEach(pg => pg.animate([{ opacity: 0 }, { opacity: 0, offset: .35 }, { opacity: 1 }], { duration: 620 }));
  // going away: a line flies back to where it came from, a kept sheet comes forward to become the page again
  removed.forEach(b => {
    if (b.exit && after.has(b.exit) && b.clone){ sheet(b.clone, b.r, now.get(after.get(b.exit)), b.exit); return; }
    // nothing flies back from a page that was not showing (step 2 opens on a blank page)
    const back = b.from && after.get(b.from);
    if (back && !swap && b.look && !b.hidden && !(STACKMOVE && b.page)) travel(b.r, now.get(back), b.look, looks(back, now.get(back)));
  });
}

// ---------- the clock: steps, moments, autoplay, scrubbing ----------
let cur = 0, prev = null, timers = [], auto = true, settled = true, started = false, inited = false, ro = null;
const later = (ms, f) => timers.push(setTimeout(f, ms));
const clear = () => { timers.forEach(clearTimeout); timers = []; };
function stateAt(n, k){
  const s = structuredClone(BASE);
  for (let i = 0; i < n - 1; i++) STEPS[i].seq.forEach(p => Object.assign(s, structuredClone(p)));
  if (n) STEPS[n - 1].seq.slice(0, k + 1).forEach(p => Object.assign(s, structuredClone(p)));
  return s;
}
const last = n => STEPS[n - 1].seq.length - 1;
function show(s){
  const P = prev; prev = s;
  clearTimeout(stackTimer); moving = false; EL.page.style.visibility = '';
  const moves = P && !reduced() ? stackMoves(P, s) : null;
  STACKMOVE = !!moves;
  flip(() => render(s, P, EL));
  if (moves) choreograph(moves);
  STACKMOVE = false;
}
// which resumes change place in the stack (0 is the top), and from where to where
function stackMoves(P, s){
  const a = stackOf(P), b = stackOf(s);
  if (!P.cards.length && !s.cards.length) return null;
  const snaps = new Map([[P.id, snapOf(P)], ...P.cards.map(c => [c.id, c]), [s.id, snapOf(s)], ...s.cards.map(c => [c.id, c])]);
  const ids = new Set([...a.keys(), ...b.keys()]), out = [];
  ids.forEach(id => { const f = a.get(id), to = b.get(id); if (f !== to) out.push({ id, f, t: to, snap: (to === 0 ? snapOf(s) : snaps.get(id)) }); });
  return out.length ? out : null;
}
function choreograph(moves){
  // To bring a sheet up from the stack you slide it out past the edge, lift it, and lay it on top;
  // the page it covers settles back into the fan. A new resume is laid down from just above.
  const sh = n => getComputedStyle(document.documentElement).getPropertyValue(`--st-sh-${n}`).trim();
  const SH = ['front', 's1', 's2'].map(sh), LIFT = sh('lift');
  const pull = moves.some(m => m.t === 0 && m.f > 0);
  // only the sheets that move are hidden under their ghosts; the others stay where they are, so nothing blinks out
  EL.page.style.visibility = moves.some(m => m.t === 0 || m.f === 0) ? 'hidden' : '';
  const away = new Set(moves.filter(m => m.t > 0).map(m => m.id));
  EL.behind.querySelectorAll('.sheet').forEach(sh => { sh.style.visibility = away.has(sh.dataset.id) ? 'hidden' : ''; });
  let longest = 0;
  moving = true;
  const order = [...moves].sort((m, n) => (n.t ?? 9) - (m.t ?? 9));      // deepest first, the new top last
  order.forEach(m => {
    const H = pageH(m.snap), g = document.createElement('div');
    g.className = `sheet sg d${m.t ?? m.f}`;
    g.style.cssText = `left:${PAGE_AT[0]}px;top:${PAGE_AT[1]}px`;
    g.innerHTML = pageHtml(m.snap, null, { mini: true }) + tabHtml(m.snap.id);
    fx().append(g);
    const T = (p, k) => `scale(${PZ}) ${fanT(p, H, k)}`, pg = g.querySelector('.pg');
    let frames, shadows, ms;
    if (m.t === 0 && m.f > 0){            // out of the stack, lifted, onto the top
      const p = POS[m.f], out = { x: p.x + 170, y: p.y - 18, r: 1 };
      frames = [{ transform: T(p, 1), zIndex: 1 }, { transform: T(out, 1.025), zIndex: 1, offset: .42 }, { transform: T(out, 1.025), zIndex: 9, offset: .44 }, { transform: T(POS[0], 1), zIndex: 9 }];
      shadows = [{ boxShadow: SH[m.f] }, { boxShadow: LIFT, offset: .44 }, { boxShadow: SH[0] }]; ms = 1150;
    } else if (m.t === 0){                // a new resume laid down on top: it waits until the page it replaces has started into the stack
      frames = [{ transform: T({ x: 0, y: -30, r: 0 }, 1.03), opacity: 0, zIndex: 9 }, { transform: T({ x: 0, y: -30, r: 0 }, 1.03), opacity: 0, zIndex: 9, offset: .38 }, { transform: T({ x: 0, y: -12, r: 0 }, 1.012), opacity: 1, zIndex: 9, offset: .62 }, { transform: T(POS[0], 1), zIndex: 9 }];
      shadows = [{ boxShadow: LIFT }, { boxShadow: LIFT, offset: .62 }, { boxShadow: SH[0] }]; ms = 1000;
    } else if (m.t == null){              // lifted off, or slid back under the sheet above
      const to = m.f === 0 ? { x: 0, y: -28, r: 0 } : POS[m.f - 1];
      frames = [{ transform: T(POS[m.f], 1), opacity: 1, zIndex: 5 - m.f }, { transform: T(to, m.f === 0 ? 1.02 : 1), opacity: 0, zIndex: 5 - m.f }];
      shadows = [{ boxShadow: SH[m.f] }, { boxShadow: m.f === 0 ? LIFT : SH[m.f] }]; ms = 620;
    } else {                              // into the stack, or one place deeper: wait until the sheet above has lifted out
      const from = m.f == null ? POS[m.t - 1] : POS[m.f];
      const wait = pull ? .36 : 0;
      frames = [{ transform: T(from, 1), opacity: m.f == null ? 0 : 1, zIndex: 5 - m.t }, { transform: T(from, 1), opacity: m.f == null ? 0 : 1, zIndex: 5 - m.t, offset: wait }, { transform: T(POS[m.t], 1), opacity: 1, zIndex: 5 - m.t }];
      shadows = [{ boxShadow: SH[m.f ?? m.t] }, { boxShadow: SH[m.t] }]; ms = pull ? 1150 : 900;
    }
    g.animate(frames, { duration: ms, easing: EASE_GLIDE, fill: 'forwards' });
    pg.animate(shadows, { duration: ms, easing: EASE_GLIDE, fill: 'forwards' });
    longest = Math.max(longest, ms);
  });
  stackTimer = setTimeout(() => { moving = false; fx().querySelectorAll('.sg').forEach(g => g.remove()); EL.page.style.visibility = ''; EL.behind.querySelectorAll('.sheet').forEach(sh => { sh.style.visibility = ''; }); }, longest);
}
// pointing at a line of the career file lights it on the top resume; a line only another resume has brings that resume up (after a short rest, never mid-move)
const paintHot = () => STAGE.querySelectorAll('.s-page li').forEach(li => li.classList.toggle('hot', !!HOT && li.dataset.k === 'p-' + HOT));
let hotTimer = 0;
function hover(id){
  clearTimeout(hotTimer);
  if (id === HOT) return;
  HOT = id; paintHot();
  const wait = () => {
    if (HOT !== id || !prev) return;
    if (moving || !settled) { hotTimer = setTimeout(wait, 200); return; }
    const card = !prev.picks.includes(id) && prev.cards.find(c => c.picks.includes(id));
    if (card) bringUp(card.id);
  };
  if (id) hotTimer = setTimeout(wait, 160);
}
// a tab brings its resume to the top
function pullUp(e){
  const el = e.target.closest('[data-res], .sheet[data-id]'); if (el) bringUp(el.dataset.res ?? el.dataset.id);
}
function bringUp(id){
  if (!prev || id === prev.id) return;
  const card = prev.cards.find(c => c.id === id); if (!card) return;
  auto = false; clear();
  const s = structuredClone(prev);
  Object.assign(s, structuredClone(card), { cards: [snapOf(prev), ...prev.cards.filter(c => c.id !== card.id)], job: null, tags: null, slips: null, edit: null, lift: null });
  BACK = false; show(s);
}
function go(n, play = true){
  n = Math.max(1, Math.min(STEPS.length, n));
  clear(); const was = cur; cur = n; bar();
  const st = STEPS[n - 1];
  BACK = n < was;
  // back: undo straight to that step's settled state; forward: settle the step before, then play this one
  if (!play || reduced() || n < was){ show(stateAt(n, last(n))); settled = true; return; }
  // a step left half-played is finished first, so what slides back is what that step ends on
  if (was !== n - 1 || !prev || !settled) show(n > 1 ? stateAt(n - 1, last(n - 1)) : structuredClone(BASE));
  settled = false;
  let ms = 200;
  st.seq.forEach((item, k) => { if (k) ms += item._dt ?? st.dt; later(ms, () => { BACK = false; show(stateAt(n, k)); if (k === last(n)) settled = true; }); });
  if (auto && n < STEPS.length) later(ms + 900 + (st.hold ?? 1200), () => go(n + 1));
}

// ---------- the step line ----------
const stepsEl = () => $('.ss-steps');
function buildBar(){
  const el = stepsEl(), n = STEPS.length;
  el.style.setProperty('--n', n);
  el.setAttribute('aria-valuemax', n);
  $('.stops', el).innerHTML = STEPS.map((s, i) => `<li data-n="${i + 1}"><button tabindex="-1" data-n="${i + 1}"><span class="num">${i + 1}</span><span>${h(s.t)}</span></button></li>`).join('');
  const track = $('.track', el);
  track.querySelectorAll('b').forEach(b => b.remove());
  STEPS.forEach((_, i) => { const b = document.createElement('b'); b.style.left = `${(i / (n - 1) * 100).toFixed(2)}%`; track.prepend(b); });
}
function bar(){
  const el = stepsEl(), n = STEPS.length, st = STEPS[Math.max(1, cur) - 1];
  if (!el) return;
  const ss = $('#ss'); ss.dataset.step = cur; ss.dataset.auto = auto;
  el.style.setProperty('--p', ((Math.max(1, cur) - 1) / (n - 1)).toFixed(4));
  el.setAttribute('aria-valuenow', cur); el.setAttribute('aria-valuetext', `${cur}. ${t(st.t)}. ${t(st.s)}`);
  el.querySelectorAll('.stops li').forEach((li, i) => { li.classList.toggle('on', i + 1 === cur); li.classList.toggle('done', i + 1 < cur); });
  el.querySelectorAll('.track b').forEach(b => b.classList.toggle('done', parseFloat(b.style.left) <= (cur - 1) / (n - 1) * 100 + .01));
  if (cur) $('.ss-say').textContent = t(st.s);      // a phone shows the step's words under the picture, not in it
  if (EL.note && cur){
    EL.note.className = `slot s-note n${cur}`;
    if (EL.note.dataset.n !== String(cur)){ EL.note.dataset.n = cur; EL.note.innerHTML = `<div class="stnote in"><span class="big">${cur}</span><p>${h(st.s)}</p></div>`; }
  }
}
const colAt = x => { const r = stepsEl().getBoundingClientRect(); return Math.max(1, Math.min(STEPS.length, Math.floor((x - r.left) / r.width * STEPS.length) + 1)); };
function listen(){
  const el = stepsEl();
  let dwell = 0, dragging = false;
  el.addEventListener('pointermove', e => {
    const n = colAt(e.clientX); clearTimeout(dwell);
    if (n === cur) return;
    dwell = setTimeout(() => { auto = false; go(n); }, dragging ? 0 : 140);
  });
  el.addEventListener('pointerleave', () => clearTimeout(dwell));
  el.addEventListener('pointerdown', e => { dragging = true; el.setPointerCapture(e.pointerId); auto = false; const n = colAt(e.clientX); if (n !== cur) go(n); });
  el.addEventListener('pointerup', () => { dragging = false; });
  el.addEventListener('keydown', e => {
    const m = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (m){ e.preventDefault(); auto = false; go(cur + m); }
    else if (e.key === 'Home' || e.key === 'End'){ e.preventDefault(); auto = false; go(e.key === 'Home' ? 1 : STEPS.length); }
  });
  STAGE.addEventListener('click', pullUp);
  const row = e => e.target.closest?.('.s-file .fln[data-k^="f-"]');
  STAGE.addEventListener('pointerover', e => { const r = row(e); if (r) hover(r.dataset.k.slice(2)); });
  STAGE.addEventListener('pointerout', e => { if (row(e) && !row({ target: e.relatedTarget })) hover(null); });
}

// ---------- the host ----------
export function stageHtml(){
  return `<div class="ss" id="ss" role="group" aria-label="${esc(t('onb.hdHow'))}">
    <div class="ss-top"><button class="obreplay" data-act="ob-replay">${icon('replay', { size: 12 })} <span>${h('onb.replay')}</span></button></div>
    <div class="ss-wrap" aria-hidden="true"><div class="sst" id="sst">${SLOTS.map(s => `<div class="slot s-${s}"></div>`).join('')}<div class="fx"></div></div></div>
    <div class="ss-steps" role="slider" tabindex="0" aria-label="${esc(t('onb.hdHow'))}" aria-valuemin="1">
      <ol class="stops"></ol>
      <div class="track"><i class="fill"></i><i class="knob"></i></div>
    </div>
    <p class="ss-say" aria-hidden="true"></p>
  </div>`;
}
// the stage is scaled to fit the box the page area gives it; on a phone the box is as tall as it needs to be
function fit(){
  const ss = $('#ss'); if (!ss || !STAGE) return;
  const host = ss.parentElement, flow = getComputedStyle(host).position === 'static';
  const cs = getComputedStyle(ss), padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 2;
  const furniture = ss.offsetHeight - WRAP.offsetHeight;
  SC = Math.max(.3, Math.min((host.clientWidth - padX) / 1240, flow ? Infinity : (host.clientHeight - furniture) / 680, 2.5));
  WRAP.style.width = `${(1240 * SC).toFixed(1)}px`; WRAP.style.height = `${(680 * SC).toFixed(1)}px`;
  STAGE.style.transform = `scale(${SC.toFixed(4)})`;
  ss.style.setProperty('--sc', SC.toFixed(4));
  bar();
}
function init(){
  STAGE = $('#sst'); WRAP = $('.ss-wrap');
  EL = {}; SLOTS.forEach(s => EL[s] = $(`.s-${s}`, STAGE));
  buildBar(); listen(); inited = true;
}
export function mount(){
  if (!$('#ss')) return;
  if (!inited) init();
  fit();
  if (!ro){ ro = new ResizeObserver(fit); ro.observe($('#ss').parentElement); }
  if (started) return;
  started = true;
  // with reduced motion nothing plays: the picture opens on its last step
  if (reduced()){ auto = false; go(STEPS.length); } else { auto = true; later(700, () => go(1)); }
}
export function unmount(){ clear(); clearTimeout(stackTimer); ro?.disconnect(); ro = null; }
// a first start-up (or a return to the start screen) plays from the top again
export function begin(){
  clear(); clearTimeout(stackTimer); cur = 0; prev = null; started = false; auto = true; settled = true;
  if (inited){ show(structuredClone(BASE)); prev = null; bar(); }
}
export function replay(){
  if (!inited) return;
  clear(); cur = 0; prev = null; auto = !reduced(); started = true; settled = true;
  if (reduced()){ auto = false; go(STEPS.length); } else go(1);
}
export function setStep(n, { user = false } = {}){ if (!inited) return; if (user) auto = false; go(n); }
// the words change language in place: the same moment is drawn again in the new words
export function retext(){
  const ss = $('#ss'); if (!ss || !inited) return;
  ss.setAttribute('aria-label', t('onb.hdHow'));
  $('.obreplay span', ss).textContent = t('onb.replay');
  EL.note.dataset.n = ''; EL.look.replaceChildren();
  buildBar();
  if (prev) render(prev, null, EL);
  bar();
}
// the moment on show, for the checks
export const current = () => prev && structuredClone(prev);
export function act(a){
  if (a === 'ob-replay'){ replay(); return true; }
  return false;
}
