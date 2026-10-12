// The start screen (UX-3), built from the editor's own layout.
//   - the header area: the logo, the name, the tagline; the inspector area: the three ways in, the interface language, "Why JSON?"
//     opening in place; the footer area: the four "Yours to keep" points; and the page area, where the page is drawn as grey
//     skeleton lines and the story of how it works plays around it.
//   - the story is a picture, left to right: old resumes into one record (the editor panel's own "On this resume" checklist),
//     the page made from it, the resumes that come out. Four steps, named as headers above the zones. Under the page sit a
//     progress bar, one instruction line and a replay button.
//   - step 2 plays the layers you edit on, as the editor draws them: a click opens the job (frame, breadcrumb), a second click
//     writes the line (outline, dashed frame, version badge), Esc, Esc.
//   - the page ends by shrinking into the front resume of the stack: that is the resting view. Pointing at a label row there
//     brings that resume forward and shows its ticks in the record.
// Everything is drawn from tokens (src/ui/start.css) and moves only while the picture plays; with reduced motion it opens on the
// resting view. The three ways in change state rather than screens: the grey lines become the real page (shell.js).

import { t, h, uiLang } from '../i18n/index.js';
import { icon } from './icons.js';
import { logoBtn } from './drink.js';
import { reduced as REDUCED } from './motion.js';

let C = null;
export function initStart(ctx){ C = ctx; return api; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (s, r = document) => r.querySelector(s);

// "JSON Resume" (also spelled JSON-Resume) links to the schema wherever it is named
export const jr = html => html.replace(/JSON[- ]Resume/, m => `<a class="oblink" href="https://jsonresume.org/schema" target="_blank" rel="noopener noreferrer">${m}</a>`);

// ---- the words ----
const STORY = [['onb.s1h', 'onb.c1'], ['onb.s2h', 'onb.c2'], ['onb.s3h', 'onb.c3'], ['onb.s4h', 'onb.c4']];
const ICON = d => `<svg class="obico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const TILES = [
  [ICON('<path d="M8 4C5 4 5 6 5 8v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 0 4 3 4M16 4c3 0 3 2 3 4v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2 0 4-3 4"/>'), 'onb.t1h', 'onb.t1'],
  [ICON('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'), 'onb.t2h', 'onb.t2'],
  [ICON('<path d="M4 9a12 12 0 0 1 16 0M7 12.5a8 8 0 0 1 10 0M10 16a4 4 0 0 1 4 0"/><circle cx="12" cy="19" r="1"/><path d="M4 4l16 16"/>'), 'onb.t3h', 'onb.t3'],
  [ICON('<path d="M12 4v10m0 0-4-4m4 4 4-4M5 19h14"/>'), 'onb.t4h', 'onb.t4'],
];

export function whyJson(){
  return `<details class="obwhy"><summary data-h="onb.whyJson">${h('onb.whyJson')}</summary>
    <ul>${['onb.why1', 'onb.why2', 'onb.why3', 'onb.why4'].map(k => `<li data-h="${k}"${k === 'onb.why3' ? ' data-jr' : ''}>${k === 'onb.why3' ? jr(h(k)) : h(k)}</li>`).join('')}</ul>
    <a href="https://stephango.com/file-over-app" target="_blank" rel="noopener noreferrer"><span data-h="onb.whyLink">${h('onb.whyLink')}</span> ${icon('external', { size: 12 })}</a></details>`;
}

// ---- the header area, the inspector area, the footer area ----
export const headHtml = () => `<div class="obhead"><span class="oblogo">${logoBtn(40, { base: 'oblogobtn' })}<span>BrewCV</span></span>
  <h2 class="obhero" data-h="onb.hero">${h('onb.hero')}</h2><p class="obsub" data-h="onb.intro">${h('onb.intro')}</p></div>`;

export function bodyHtml({ langs, current }){
  return `<div class="obstart">
    <div class="obchoices">
      <button class="primary" data-act="ob-scratch"><b data-h="onb.scratch">${h('onb.scratch')}</b><small data-h="onb.scratchNote">${h('onb.scratchNote')}</small></button>
      <button data-act="ob-import"><b data-h="onb.import">${h('onb.import')}</b><small data-h="onb.importNote">${h('onb.importNote')}</small></button>
      <button data-act="ob-example"><b data-h="onb.example">${h('onb.example')}</b><small data-h="onb.exampleNote">${h('onb.exampleNote')}</small></button>
    </div>
    <ul class="oblangs" aria-label="${esc(t('ux3.startLangs'))}">${langs.map(([l, name]) => `<li><button lang="${l}" class="oblang${l === current ? ' on' : ''}" data-act="ob-intro-lang" data-l="${l}" aria-pressed="${l === current}" aria-label="${esc(name)}" title="${esc(name)}">${l.toUpperCase()}</button></li>`).join('')}</ul>
    ${whyJson()}</div>`;
}

export const footHtml = () => `<section class="obkeep"><h3 class="obeye" data-h="onb.keepHead">${h('onb.keepHead')}</h3>
  <div class="obkeep__grid">${TILES.map(([ic, hk, tk]) => `<div class="obtile">${ic}<div><b data-h="${hk}">${h(hk)}</b><p data-h="${tk}"${hk === 'onb.t1h' ? ' data-jr' : ''}>${hk === 'onb.t1h' ? jr(h(tk)) : h(tk)}</p></div></div>`).join('')}</div></section>`;

// ---- the story's data: which lines each kind of job takes ----
const TYPES = {
  start: { k: 'onb.jobStart', on: [1, 0, 1, 1, 1, 0, 1], nv: [3, 2, 2, 1, 2, 1, 3] },
  corp: { k: 'onb.jobCorp', on: [1, 1, 1, 1, 0, 1, 1], nv: [3, 2, 2, 1, 2, 1, 3] },
  pub: { k: 'onb.jobPub', on: [0, 1, 1, 0, 1, 1, 1], nv: [3, 2, 2, 1, 2, 1, 3] },
};
const KINDS = Object.keys(TYPES);
// the resumes that come out: a kind of job, a language, a paper, pages, a file
const OUTS = [
  { type: 'start', lang: 'EN', paper: 'paper.letter', pages: 1, file: 'HTML' },
  { type: 'corp', lang: 'DE', paper: 'paper.a4', pages: 2, file: 'TXT' },
  { type: 'pub', lang: 'HU', paper: 'paper.a4', pages: 1, file: 'PDF' },
];
const BARS = [[86, 52], [72, 60], [90, 44], [80, 56], [66, 70], [92, 48], [78, 62]];
const bars = ws => ws.map(w => `<i style="--w:${w}%"></i>`).join('');
const FILES = ['PDF', 'DOC', 'PDF'];
const STEP_MS = [0, 4300, 6200, 6400, 3200];

// the groups of the record: two jobs open, the rest folded
const GROUPS = [{ rows: [0, 1, 2, 3], open: true }, { rows: [4, 5, 6], open: true }];
const FOLDED = [[5, 8], [3, 4], [2, 6]];
const count = (type, rows) => rows.filter(i => TYPES[type].on[i]).length;

function recHtml(){
  const rowHtml = i => `<li class="ssr" data-i="${i}"><span class="cb"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 8.4 6.6 11.4l6-6.6"/></svg></span><span class="ssl">${bars([BARS[i][0]])}</span><span class="clv ssv">${esc(t('ux2.nv', { n: TYPES.start.nv[i] }))}</span></li>`;
  return `<section class="ss-rec" aria-hidden="true">
    <header class="ssrh"><span class="ssri">${icon('timeline', { size: 15 })}</span><b data-h="onb.record">${h('onb.record')}</b></header>
    <p class="ssrs"><span data-h="ux2.onThisResume">${h('ux2.onThisResume')}</span></p>
    ${GROUPS.map((g, gi) => `<div class="ssg open" data-g="${gi}"><div class="ssgh"><span class="ssc">${icon('caret', { size: 12 })}</span><span class="ssn">${bars([gi ? 62 : 70])}</span><span class="ssk" data-k="${gi}"></span></div><ul>${g.rows.map(rowHtml).join('')}</ul></div>`).join('')}
    ${FOLDED.map(([n, m]) => `<div class="ssg shut"><div class="ssgh"><span class="ssc">${icon('right', { size: 12 })}</span><span class="ssn">${bars([54 + n * 3])}</span><span class="ssk">${esc(t('ux2.nOfM', { n, m }))}</span></div></div>`).join('')}
  </section>`;
}

const miniPage = (seed = 0, n = 6) => `<div class="ssmp">${bars([60 + (seed * 7) % 30, 40, 88, 72 - seed * 4, 54, 90, 66, 48].slice(0, n))}</div>`;

function pageHtml(){
  const bullet = i => `<div class="ssb" data-i="${i}">${bars(BARS[i])}</div>`;
  return `<div class="ss-pagew"><div class="ss-page" aria-hidden="true">
      <header class="ssph"><span class="ssnm"><i class="n"></i><i class="s"></i></span></header>
      <div class="ssp">${bars([94, 82, 60])}</div>
      <div class="sst"><u></u></div>
      <div class="ssj" data-j="0"><div class="ssjr"><i class="t"></i><i class="d"></i></div>${[0, 1, 2, 3].map(bullet).join('')}</div>
      <div class="ssj" data-j="1"><div class="ssjr"><i class="t"></i><i class="d"></i></div>${[4, 5, 6].map(bullet).join('')}</div>
      <div class="sst"><u></u></div>
      <div class="ssp">${bars([70, 44])}</div>
    </div>
    <div class="ss-lay" aria-hidden="true">
      <i class="ssveil"></i><i class="ssjf"></i><i class="sslf"></i>
      <nav class="sscrumb"><span>${h('ux3.crumbPage')}</span><i>›</i><span class="cj">${h('ux3.crumbJob')}</span><i>›</i><span class="cl">${h('ux3.crumbLine')}</span><kbd>Esc</kbd></nav>
      <div class="sstools"><b>v2 ${icon('caret', { size: 10 })}</b><u></u><u></u><u></u></div>
    </div></div>`;
}

function outHtml(){
  return `<div class="ss-out"><div class="sstack">${OUTS.map((o, i) => `<div class="ssx" data-i="${i}" style="--r:${i}">${miniPage(i)}</div>`).join('')}</div>
    <ul class="sslabels">${OUTS.map((o, i) => `<li><button class="sslab" data-i="${i}" data-act="ob-front" aria-pressed="${i === 0}"><b data-h="${TYPES[o.type].k}">${h(TYPES[o.type].k)}</b><span>${o.lang} · ${esc(t(o.paper))} · ${esc(t('head.pages', { n: o.pages }))}</span><em>${o.file}</em></button></li>`).join('')}</ul></div>`;
}

const ARROW = c => `<svg class="ssa ${c}" viewBox="0 0 28 14" aria-hidden="true"><path d="M1 7h21"/><path d="M18 2.5L24 7l-6 4.5"/></svg>`;
const CURSOR = '<svg class="sscur" viewBox="0 0 20 24" aria-hidden="true"><path d="M2 2l15 9-6.5 1.6L14 20l-3 1.4-3.4-7.3L3 18z"/></svg>';

export function stageHtml(){
  return `<div class="ss" id="ss" data-step="0" data-ly="page" data-type="start" data-front="0" role="group" aria-label="${esc(t('onb.hdHow'))}"><div class="ss-frame">
    <ol class="ss-heads">${STORY.map(([hk], i) => `<li class="ssh" data-s="${i + 1}"><button data-act="ob-story" data-s="${i + 1}" aria-pressed="false"><span class="n">${i + 1}</span><b data-h="${hk}">${h(hk)}</b></button></li>`).join('')}</ol>
    <div class="ss-fit"><div class="ss-scene">
      <div class="ss-old" aria-hidden="true">${FILES.map((f, i) => `<div class="ssf" style="--i:${i}">${miniPage(i + 3, 5)}<span>${f}</span></div>`).join('')}</div>
      ${ARROW('a1')}${recHtml()}${ARROW('a2')}${pageHtml()}${ARROW('a3')}${outHtml()}${CURSOR}
    </div></div>
    <div class="ss-bar"><div class="ssprog" aria-hidden="true"><i></i></div>
      <div class="sscaprow"><p class="sscap" id="sscap" aria-live="polite"></p><button class="obreplay" data-act="ob-replay">${icon('replay', { size: 12 })} <span data-h="onb.replay">${h('onb.replay')}</span></button></div></div>
  </div></div>`;
}

// ---- playing it ----
const S = { step: 0, auto: true, started: false, timers: [], ro: null };
const later = (ms, fn) => { const id = setTimeout(fn, ms); S.timers.push(id); return id; };
const stop = () => { S.timers.forEach(clearTimeout); S.timers = []; };
const el = () => $('#ss');

function fit(){
  const ss = el(); if (!ss) return;
  const box = ss.parentElement;
  const flow = getComputedStyle(box).position === 'static';        // a phone: the picture is as tall as it needs to be
  const W = box.clientWidth, H = flow ? Infinity : box.clientHeight;
  const heads = ss.querySelector('.ss-heads').offsetHeight, bar = ss.querySelector('.ss-bar').offsetHeight;
  const k = Math.max(0.3, Math.min(W / 880, (H - heads - bar - 24) / 430, 1.15));
  ss.style.setProperty('--k', k.toFixed(4));
}

// the record's ticks and counts for a kind of job
function ticks(type){
  const ss = el(); if (!ss) return;
  const on = TYPES[type].on;
  ss.dataset.type = type;
  ss.querySelectorAll('.ssr').forEach(r => r.classList.toggle('off', !on[+r.dataset.i]));
  ss.querySelectorAll('.ssb').forEach(b => b.classList.toggle('off', !on[+b.dataset.i]));
  GROUPS.forEach((g, gi) => { const k = ss.querySelector(`.ssk[data-k="${gi}"]`); if (k) k.textContent = t('ux2.nOfM', { n: count(type, g.rows), m: g.rows.length }); });
}
function front(i){
  const ss = el(); if (!ss) return;
  ss.dataset.front = i;
  ss.querySelectorAll('.ssx').forEach(x => x.style.setProperty('--r', (+x.dataset.i - i + 3) % 3));
  ss.querySelectorAll('.sslab').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.i === i)));
  ticks(OUTS[i].type);
}

// where the layers go, read from the drawing itself (design pixels): the open job, the line being written
function place(){
  const ss = el(); if (!ss) return;
  const lay = ss.querySelector('.ss-lay'), pg = ss.querySelector('.ss-page');
  const job = pg.querySelector('.ssj[data-j="0"]'), line = pg.querySelector('.ssb[data-i="2"]');
  const jr = r => ({ top: r.offsetTop, left: r.offsetLeft, w: r.offsetWidth, h: r.offsetHeight });
  const a = jr(job), b = jr(line), pw = ss.querySelector('.ss-pagew');
  lay.style.setProperty('--jt', `${a.top - 6}px`); lay.style.setProperty('--jh', `${a.h + 12}px`);
  lay.style.setProperty('--lt', `${b.top - 3}px`); lay.style.setProperty('--lh', `${b.h + 6}px`);
  // the pointer, in the picture's own pixels: on the line's bars, a little in
  ss.style.setProperty('--lx', `${pw.offsetLeft + 90}px`); ss.style.setProperty('--ly', `${pw.offsetTop + b.top + b.h / 2 + 2}px`);
}

function cursorTo(on){
  const c = $('.sscur'); if (!c) return;
  c.classList.toggle('on', on);
}
function click(){ const c = $('.sscur'); if (!c) return; c.classList.add('click'); setTimeout(() => c.classList.remove('click'), 220); }
const esc1 = () => { const k = $('.ss .sscrumb kbd'); if (k){ k.classList.remove('hit'); void k.offsetWidth; k.classList.add('hit'); } };

// step 2: the layers, as the editor draws them
function layers(){
  const ss = el(); if (!ss) return;
  place();
  const go = (ms, fn) => later(ms, () => { if (S.step === 2) fn(); });
  go(300, () => cursorTo(true));
  go(1100, () => { click(); });
  go(1250, () => { ss.dataset.ly = 'job'; });
  go(2500, () => { click(); });
  go(2650, () => { ss.dataset.ly = 'line'; });
  go(4300, () => { cursorTo(false); esc1(); });
  go(4400, () => { ss.dataset.ly = 'job'; });
  go(5200, () => esc1());
  go(5300, () => { ss.dataset.ly = 'page'; });
}
// step 3: other lines for another kind of job
function tailor(){
  const go = (ms, fn) => later(ms, () => { if (S.step === 3) fn(); });
  go(500, () => front(1));
  go(2700, () => front(2));
  go(4900, () => front(0));
}

function caption(n){ const p = $('#sscap'); if (p) p.textContent = t(STORY[Math.max(0, n - 1)][1]); }
function mark(n){
  document.querySelectorAll('#ss .ssh').forEach(li => {
    const s = +li.dataset.s;
    li.classList.toggle('on', s === n); li.classList.toggle('done', s < n);
    li.querySelector('button').setAttribute('aria-pressed', String(s === n));
  });
}
function progress(n, auto){
  const i = $('#ss .ssprog i'); if (!i) return;
  i.style.transition = auto ? `width ${STEP_MS[n] || 0}ms linear` : 'none';
  i.style.width = `${n * 25}%`;
}
export function setStep(n, { user = false } = {}){
  const ss = el(); if (!ss) return;
  stop();
  if (user) S.auto = false;
  S.step = n;
  ss.dataset.step = n;
  ss.dataset.ly = 'page'; cursorTo(false);
  front(0);
  mark(n); caption(n);
  progress(n, S.auto);
  if (!REDUCED()){
    if (n === 2) layers();
    if (n === 3) tailor();
    if (S.auto && n < 4) later(STEP_MS[n], () => setStep(n + 1));
    else if (n === 4) later(STEP_MS[4], () => { S.auto = false; ss.classList.remove('auto'); });
  }
  ss.classList.toggle('auto', S.auto && n < 4);
}
export function replay(){
  const ss = el(); if (!ss) return;
  stop();
  S.auto = !REDUCED();
  ss.classList.add('reset'); ss.dataset.step = 0; S.step = 0; ticks('start'); front(0); void ss.offsetWidth; ss.classList.remove('reset');
  mark(0); caption(1); progress(0, false);
  if (S.auto) later(500, () => setStep(1)); else setStep(4);
}

// the picture is on screen: fit it, and start it (once)
export function mount(){
  const ss = el(); if (!ss) return;
  fit();
  if (!S.ro){ S.ro = new ResizeObserver(fit); S.ro.observe(ss.parentElement); }
  ticks('start'); front(0); caption(1);
  if (!S.started){
    S.started = true;
    if (REDUCED()){ S.auto = false; setStep(4); } else later(700, () => setStep(1));
  }
}
export function unmount(){ stop(); S.ro?.disconnect(); S.ro = null; }
export function begin(){ stop(); Object.assign(S, { step: 0, auto: true, started: false }); const ss = el(); if (ss){ ss.dataset.step = 0; } }

// the words change language in place (nothing is drawn again, so the chips stay under the pointer)
export function retext(){
  const lg = uiLang();
  document.querySelectorAll('#head [data-h], #body [data-h], #foot [data-h], #ss [data-h]').forEach(e => {
    if (e.dataset.lg === lg) return;
    e.dataset.lg = lg;
    const v = h(e.dataset.h);
    e.innerHTML = 'jr' in e.dataset ? jr(v) : v;
  });
  const ss = el();
  if (ss){
    ss.setAttribute('aria-label', t('onb.hdHow'));
    caption(S.step || 1);
    ss.querySelectorAll('.sslab span').forEach((s, i) => { const o = OUTS[i]; s.textContent = `${o.lang} · ${t(o.paper)} · ${t('head.pages', { n: o.pages })}`; });
    ss.querySelectorAll('.ssv').forEach((v, i) => { v.textContent = t('ux2.nv', { n: TYPES.start.nv[+v.closest('.ssr').dataset.i] }); });
    ss.querySelectorAll('.ssg.shut .ssk').forEach((k, i) => { k.textContent = t('ux2.nOfM', { n: FOLDED[i][0], m: FOLDED[i][1] }); });
    ticks(ss.dataset.type);
    ss.querySelector('.sscrumb .cj') && (ss.querySelector('.sscrumb').innerHTML = `<span>${h('ux3.crumbPage')}</span><i>›</i><span class="cj">${h('ux3.crumbJob')}</span><i>›</i><span class="cl">${h('ux3.crumbLine')}</span><kbd>Esc</kbd>`);
  }
}

// ---- the actions and the hover on a label row ----
export function act(a, tg){
  switch (a){
    case 'ob-story': setStep(+tg.dataset.s, { user: true }); return true;
    case 'ob-replay': replay(); return true;
    case 'ob-front': S.auto = false; front(+tg.dataset.i); return true;
  }
  return false;
}
export function bind(){
  // pointing at (or focusing) a label row brings that resume forward, and shows its ticks in the record; leaving goes back
  const near = e => e.target.closest?.('#ss .sslab');
  const enter = e => { const b = near(e); if (b && S.step === 4){ stop(); front(+b.dataset.i); } };
  document.addEventListener('mouseover', enter);
  document.addEventListener('focusin', enter);
}

const api = { headHtml, bodyHtml, footHtml, stageHtml, mount, unmount, begin, retext, setStep, replay, act, bind, whyJson, jr,
  get step(){ return S.step; }, get auto(){ return S.auto; } };
