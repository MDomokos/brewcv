// First-run onboarding: a step card asks questions while the sheet fills in live. Back keeps
// what was typed. Records are built with src/model/build.js, as in the JSON Resume import.
// A record started in another language has every text as v1 there and on the English
// spine, so its first resume prints with nothing outlined.

import * as B from '../model/build.js';
import { newResume } from '../model/resume.js';
import * as RS from '../model/resumes.js';
import { LANG_INFO, a4FormatOf, langName } from '../model/lang.js';
import { t, h, setUiLang, setUiLangNow, loadCatalogue, uiLang } from '../i18n/index.js';
import { langChecks, uiChoice, browserLang, writePref } from './settings.js';

let C = null;
export function initOnboarding(ctx){ C = ctx; return api; }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = s => document.querySelector(s);
// [id, paper, photo expected]; the names are onb.market.<id>
const MARKETS = [
  ['us', 'us-letter', false], ['uk', 'a4', false], ['dach', 'a4', true],
  ['hu', 'a4', true], ['eu', 'a4', false], ['mixed', 'a4', false],
];
const STEPS = ['welcome', 'about', 'market', 'job', 'education', 'skills', 'photo', 'finish'];
const MARKET_OF = { en: 'us', de: 'dach', hu: 'hu', pl: 'hu', cs: 'hu', fr: 'eu', es: 'eu', it: 'eu', pt: 'eu', nl: 'eu' };
const O = { step: 'welcome', after: null, about: {}, market: null, job: {}, jobs: 0, education: {}, skills: '', tip: null, langs: null, start: null, ui: { mode: 'follow' } };
export const TIPS = [['onb.tip1h', 'onb.tip1'], ['onb.tip2h', 'onb.tip2'], ['onb.tip3h', 'onb.tip3']];

const photoStep = () => MARKETS.find(m => m[0] === O.market)?.[2] ?? false;
const startLang = () => (O.langs?.includes(O.start) ? O.start : O.langs?.[0] ?? 'en');
const formatFor = market => { const f = MARKETS.find(m => m[0] === market)?.[1] ?? LANG_INFO[startLang()]?.paper ?? 'a4'; return f === 'a4' ? a4FormatOf(startLang()) : f; };
const next = () => { let i = STEPS.indexOf(O.step) + 1; if (STEPS[i] === 'photo' && !photoStep()) i++; return STEPS[i]; };
const prev = () => { let i = STEPS.indexOf(O.step) - 1; if (STEPS[i] === 'photo' && !photoStep()) i--; return STEPS[Math.max(1, i)]; };
const dots = () => `<div class="obdots">${STEPS.slice(1, -1).filter(s => s !== 'photo' || photoStep()).map(s => `<i class="${s === O.step ? 'on' : ''}"></i>`).join('')}</div>`;
const field = (id, label, value, attrs = '') => `<label class="field"><span class="lbl inline">${label}</span><input id="${id}" value="${esc(value ?? '')}" autocomplete="off" ${attrs}></label>`;
const nav = (skip = true, nextLabel = t('onb.next')) => `<div class="btns obnav"><button class="ghost" data-act="ob-back">${h('onb.back')}</button><span class="grow"></span>${skip ? `<button class="ghost" data-act="ob-skip">${h('onb.skip')}</button>` : ''}<button class="primary" data-act="ob-next">${esc(nextLabel)}</button></div>`;


// "JSON Resume" (also spelled JSON-Resume) links to the schema wherever it is named
const jr = html => html.replace(/JSON[- ]Resume/, m => `<a class="oblink" href="https://jsonresume.org/schema" target="_blank" rel="noopener noreferrer">${m}</a>`);

function whyJson(){
  return `<details class="obwhy"><summary data-h="onb.whyJson">${h('onb.whyJson')}</summary>
    <ul>${['onb.why1', 'onb.why2', 'onb.why3', 'onb.why4'].map(k => `<li data-h="${k}"${k === 'onb.why3' ? ' data-jr' : ''}>${k === 'onb.why3' ? jr(h(k)) : h(k)}</li>`).join('')}</ul>
    <a href="https://stephango.com/file-over-app" target="_blank" rel="noopener noreferrer"><span data-h="onb.whyLink">${h('onb.whyLink')}</span> ↗</a></details>`;
}

// ---- the story: one record, four steps ------------------------------------------------------
// Old files drop into ONE RECORD (the column on the left); a portrait page drawn as grey lines is
// made from it. Every fact in the record has several wordings you wrote yourself (v1, v2, v3) and
// you pick one. Another kind of job takes other FACTS and other wordings, another region, a photo,
// one page or two; each resume goes out as HTML, text or PDF. It plays once; the steps can be clicked.
// Everything on it is a control: hover previews, a click keeps. The page is painted in place.
let introAt = null;                                 // when the introduction first drew, for its entrance
let baseLang = null;                                // the language the page opened in, until one is clicked
const demoLang = () => C.ui.introLang ?? (baseLang ??= uiLang());
const REDUCED = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const STEP_MS = [0, 4600, 5000, 10800, 4200];
// what a region sets: its language tag, whether a photo is expected, how many pages
const REGIONS = { us: { tag: 'EN', photo: false, pages: 1 }, de: { tag: 'DE', photo: true, pages: 2 }, hu: { tag: 'HU', photo: true, pages: 1 } };
// six facts (the first three from one job, the last three from another), each with three wordings;
// a wording is the line lengths of the bullet
const FACTS = 6;
const IDX = [0, 1, 2, 3, 4, 5];
const ROW_BARS = [[86, 52], [72, 60], [90, 44], [80, 56], [66, 70], [92, 48]];
const LINES = [
  [[92, 66], [80, 90, 38], [100, 56]], [[88, 50], [96, 76], [68, 92, 34]], [[78, 58], [90, 44], [72, 86]],
  [[94, 60], [70, 84], [86, 48, 30]], [[82, 46], [98, 72], [60, 88]], [[90, 70, 36], [76, 52], [96, 64]],
];
const SVG = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON_PHOTO = SVG('<circle cx="12" cy="9" r="3.5"/><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5"/>');
const ICON_P1 = SVG('<path d="M7 3h8l3 3v15H7z"/>');
const ICON_P2 = SVG('<path d="M9 3h7l3 3v13H9z"/><path d="M6 6v15h10"/>');
const ICON_TICK = SVG('<path d="M5 12.5l4.5 4.5L19 7.5"/>');
const ICON_PEN = SVG('<path d="M4 20l1.2-4.2L16.5 4.5a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L8.2 18.8z"/><path d="M14.5 6.5l3 3"/>');
const ICON_REC = SVG('<path d="M8 4C5 4 5 6 5 8v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 0 4 3 4M16 4c3 0 3 2 3 4v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2 0 4-3 4"/>');
// a kind of job: which facts it takes (f), which wording of each (w)
const TYPES = {
  start: { k: 'onb.jobStart', f: [1, 0, 1, 0, 1, 0], w: [1, 0, 2, 0, 0, 0], icon: SVG('<path d="M12 3c3.5 2.5 5 6 4 11l-4 2-4-2c-1-5 .5-8.5 4-11z"/><circle cx="12" cy="9.5" r="1.5"/><path d="M8 15l-3 3 3 .5M16 15l3 3-3 .5M12 17.5V21"/>') },
  corp: { k: 'onb.jobCorp', f: [1, 1, 0, 1, 0, 1], w: [0, 2, 0, 1, 0, 1], icon: SVG('<path d="M5 21V4h9v17M14 9h5v12M3 21h18M8 8h2M8 12h2M8 16h2"/>') },
  pub: { k: 'onb.jobPub', f: [0, 1, 1, 1, 0, 0], w: [0, 1, 1, 2, 0, 0], icon: SVG('<path d="M3 9l9-5 9 5M5 9v9M9.7 9v9M14.3 9v9M19 9v9M3 21h18"/>') },
};
const fresh = () => {
  const p = TYPES.start, o = { type: 'start', region: 'us', photo: false, pages: 1 };
  IDX.forEach(i => { o[`f${i}`] = !!p.f[i]; o[`w${i}`] = p.w[i]; });
  return o;
};
const kept = fresh();                                                    // what a click kept
let look = {};                                                           // what a hover shows
const story = { step: 0, auto: true, started: false, mounted: false, timers: [], pilot: false };
const val = k => (k in look ? look[k] : kept[k]);
const later = (ms, fn) => { const id = setTimeout(fn, ms); story.timers.push(id); return id; };
const stopTimers = () => { story.timers.forEach(clearTimeout); story.timers = []; };

const bars = ws => ws.map(w => `<i style="--w:${w}%"></i>`).join('');
const regionName = r => { try { return new Intl.DisplayNames([uiLang()], { type: 'region' }).of(r.toUpperCase()); } catch { return r.toUpperCase(); } };

function bullet(i){
  const k = val(`w${i}`), on = !!val(`f${i}`);
  const chips = [0, 1, 2].map(j => `<button class="obv${j === kept[`w${i}`] ? ' on' : ''}${look[`w${i}`] === j ? ' pk' : ''}" data-act="ob-pin" data-key="w${i}" data-val="${j}" aria-pressed="${j === kept[`w${i}`]}" aria-label="v${j + 1}">v${j + 1}</button>`).join('');
  return `<div class="obb${on ? '' : ' off'}${story.step >= 2 ? ' chips' : ''}" data-f="${i}" data-k="${k}"><span class="obls">${bars(LINES[i][k])}</span><span class="obvs">${chips}<i class="obplus" aria-hidden="true">+</i></span></div>`;
}
function row(i, delay){
  const on = !!val(`f${i}`), pk = `f${i}` in look && look[`f${i}`] !== kept[`f${i}`];
  return `<button class="obrow${on ? ' on' : ''}${pk ? ' pk' : ''}" style="--d:${delay}s" data-f="${i}" data-act="ob-pin" data-key="f${i}" data-val="${kept[`f${i}`] ? 0 : 1}" aria-pressed="${kept[`f${i}`]}" data-tt="onb.useFact" title="${esc(t('onb.useFact'))}" aria-label="${esc(t('onb.useFact'))}"><i class="obtick">${ICON_TICK}</i><span class="obls">${bars(ROW_BARS[i])}</span></button>`;
}
function tabsHtml(){
  return `<div class="obtabs" role="group">${Object.entries(TYPES).map(([id, p]) => `<button class="obtab${id === kept.type ? ' on' : ''}${look.type === id ? ' pk' : ''}" data-act="ob-pin" data-key="type" data-val="${id}" aria-pressed="${id === kept.type}"><i class="obti">${p.icon}</i><span data-h="${p.k}">${h(p.k)}</span></button>`).join('')}</div>`;
}
function ctlHtml(){
  const regions = Object.keys(REGIONS).map(k => `<button class="obc${k === kept.region ? ' on' : ''}${look.region === k ? ' pk' : ''}" data-act="ob-pin" data-key="region" data-val="${k}" aria-pressed="${k === kept.region}" data-rg="${k}" title="${esc(regionName(k))}">${k.toUpperCase()}</button>`).join('');
  const ph = t('onb.optPhoto'), byRegion = 'region' in look;
  const photo = `<button class="obc ico${kept.photo ? ' on' : ''}${'photo' in look && !byRegion ? ' pk' : ''}" data-act="ob-pin" data-key="photo" data-val="${kept.photo ? 0 : 1}" aria-pressed="${kept.photo}" data-tt="onb.optPhoto" title="${esc(ph)}" aria-label="${esc(ph)}">${ICON_PHOTO}</button>`;
  const pages = [1, 2].map(n => { const l = t(n === 1 ? 'onb.pg1' : 'onb.pg2'); return `<button class="obc ico${kept.pages === n ? ' on' : ''}${look.pages === n && !byRegion ? ' pk' : ''}" data-act="ob-pin" data-key="pages" data-val="${n}" aria-pressed="${kept.pages === n}" data-tt="${n === 1 ? 'onb.pg1' : 'onb.pg2'}" title="${esc(l)}" aria-label="${esc(l)}">${n === 1 ? ICON_P1 : ICON_P2}</button>`; }).join('');
  return `<div class="obbar" role="group"><span class="obgrp">${regions}</span><span class="obgrp">${photo}${pages}</span></div>`;
}
const miniPage = (n = 5, icon = '') => `<div class="obmini"><u></u>${bars([80, 60, 90, 70, 50].slice(0, n))}${icon ? `<em>${icon}</em>` : ''}</div>`;
const FLOW = '<svg class="obflow" viewBox="0 0 28 14" aria-hidden="true"><path class="fl" d="M1 7h21"/><path d="M18 2.5L24 7l-6 4.5"/></svg>';
const PEN = `<div class="obpen" aria-hidden="true">${ICON_PEN}<em data-h="onb.penTag">${h('onb.penTag')}</em></div>`;
const CURSOR = '<svg class="obcursor" viewBox="0 0 20 24" aria-hidden="true"><path d="M2 2l15 9-6.5 1.6L14 20l-3 1.4-3.4-7.3L3 18z"/></svg>';

function stageHtml(){
  const s = story.step, r = val('region');
  const page = (cls, inner) => `<div class="obpage ${cls}">${inner}</div>`;
  const plain = ws => `<div class="obb plain"><span class="obls">${bars(ws)}</span></div>`;
  const jrow = '<div class="objr"><i class="t"></i><i class="d"></i></div>';
  const sec = '<div class="obsec"><i></i></div>';
  const front = `<header><span class="obhd"><i class="n"></i><i class="s"></i></span><span class="obphoto">${ICON_PHOTO}</span></header>
    ${sec}${jrow}${[0, 1, 2].map(bullet).join('')}${jrow}${[3, 4, 5].map(bullet).join('')}
    ${sec}${plain([70, 44])}${sec}${plain([88])}
    <em class="oblangtag">${REGIONS[r].tag}</em>`;
  const back = `${sec}${jrow}${plain([90, 62])}${plain([84, 70])}${plain([76, 50])}`;
  const rec = `<section class="obrec" aria-label="${esc(t('onb.record'))}">
      <header class="obrechd"><i class="obri">${ICON_REC}</i><b data-h="onb.record">${h('onb.record')}</b></header>
      <p class="obby"><i>${ICON_PEN}</i><span data-h="onb.byYou">${h('onb.byYou')}</span></p>
      <div class="obrg"><div class="objr" style="--d:.3s"><i class="t"></i><i class="d"></i></div>${[0, 1, 2].map(i => row(i, .45 + i * .22)).join('')}</div>
      <div class="obrg"><div class="objr" style="--d:1.1s"><i class="t"></i><i class="d"></i></div>${[3, 4, 5].map(i => row(i, 1.25 + (i - 3) * .22)).join('')}</div>
      <div class="obrg more" style="--d:1.9s"><div class="objr"><i class="t"></i><i class="d"></i></div><div class="objr"><i class="t"></i><i class="d"></i></div></div>
      <div class="obzone old" aria-hidden="true">${['PDF', 'DOC', 'PDF'].map((f, i) => `<div class="obfile" style="--i:${i}">${miniPage()}<span>${f}</span></div>`).join('')}</div>
    </section>`;
  const outs = Object.values(TYPES).map((p, i) => `<div class="obfile" style="--i:${i}">${miniPage(4, p.icon)}<span>${['HTML', 'TXT', 'PDF'][i]}</span></div>`).join('');
  return `<div class="obstage${story.mounted && story.step > 0 ? ' still' : ''}${story.auto ? ' auto' : ''}" data-step="${s}" role="group" aria-label="${esc(t('onb.hdHow'))}">
    <div class="obstagecol">
      <div class="obscene">
        ${tabsHtml()}
        ${rec}
        ${FLOW}
        <div class="obpages" data-photo="${val('photo') ? 1 : 0}" data-pages="${val('pages')}" data-region="${r}">${page('back', back)}${page('front', front)}</div>
        <div class="obzone out" aria-hidden="true">${outs}</div>
      </div>
      ${ctlHtml()}
      <p class="obhint"><span data-h="onb.hover">${h('onb.hover')}</span> · <span data-h="onb.click">${h('onb.click')}</span></p>
      ${PEN}${CURSOR}
    </div>
  </div>`;
}

// ---- painting in place ----
function paint(){
  const pg = $('.obpages'); if (!pg) return;
  const r = val('region'), byType = 'type' in look;
  pg.dataset.photo = val('photo') ? 1 : 0; pg.dataset.pages = val('pages'); pg.dataset.region = r;
  const tag = pg.querySelector('.oblangtag'); if (tag && tag.textContent !== REGIONS[r].tag) tag.textContent = REGIONS[r].tag;
  for (const i of IDX){
    const k = val(`w${i}`), on = !!val(`f${i}`);
    const b = pg.querySelector(`.obb[data-f="${i}"]`);
    if (b){
      b.classList.toggle('off', !on);
      b.classList.toggle('lk', `f${i}` in look && !byType);
      if (b.dataset.k !== String(k)){
        b.dataset.k = k;
        b.querySelector('.obls').innerHTML = bars(LINES[i][k]);
        b.classList.remove('obsw'); void b.offsetWidth; b.classList.add('obsw');
      }
      b.querySelectorAll('.obv').forEach(c => { const j = +c.dataset.val; c.classList.toggle('on', j === kept[`w${i}`]); c.classList.toggle('pk', look[`w${i}`] === j && kept[`w${i}`] !== j); c.setAttribute('aria-pressed', String(j === kept[`w${i}`])); });
    }
    const rw = document.querySelector(`.obrow[data-f="${i}"]`);
    if (rw){
      rw.classList.toggle('on', on); rw.classList.toggle('pk', `f${i}` in look && look[`f${i}`] !== kept[`f${i}`]);
      rw.dataset.val = kept[`f${i}`] ? 0 : 1; rw.setAttribute('aria-pressed', String(kept[`f${i}`]));
    }
  }
  document.querySelectorAll('.obtab').forEach(c => { c.classList.toggle('on', c.dataset.val === kept.type); c.classList.toggle('pk', look.type === c.dataset.val && kept.type !== c.dataset.val); c.setAttribute('aria-pressed', String(c.dataset.val === kept.type)); });
  const bar = $('.obbar'); if (!bar) return;
  const byRegion = 'region' in look;
  bar.querySelectorAll('[data-key="region"]').forEach(c => { c.classList.toggle('on', c.dataset.val === kept.region); c.classList.toggle('pk', look.region === c.dataset.val); c.setAttribute('aria-pressed', String(c.dataset.val === kept.region)); });
  const ph = bar.querySelector('[data-key="photo"]'); if (ph){ ph.classList.toggle('on', kept.photo); ph.classList.toggle('pk', 'photo' in look && !byRegion); ph.dataset.val = kept.photo ? 0 : 1; ph.setAttribute('aria-pressed', String(kept.photo)); }
  bar.querySelectorAll('[data-key="pages"]').forEach(c => { const n = +c.dataset.val; c.classList.toggle('on', kept.pages === n); c.classList.toggle('pk', look.pages === n && !byRegion); c.setAttribute('aria-pressed', String(kept.pages === n)); });
}
// what hovering a control would show
function lookOf(key, v){
  if (key === 'region'){ const r = REGIONS[v]; return { region: v, photo: r.photo, pages: r.pages }; }
  if (key === 'photo') return { photo: !!+v };
  if (key === 'pages') return { pages: +v };
  if (key === 'type'){ const p = TYPES[v], o = { type: v }; IDX.forEach(i => { o[`f${i}`] = !!p.f[i]; o[`w${i}`] = p.w[i]; }); return o; }
  if (key[0] === 'f') return { [key]: !!+v };
  return { [key]: +v };
}
const preview = (key, v) => { look = lookOf(key, v); paint(); };
const unpreview = () => { if (Object.keys(look).length){ look = {}; paint(); } };
function keep(key, v){
  if (key === 'region') Object.assign(kept, { region: v, photo: REGIONS[v].photo, pages: REGIONS[v].pages });
  else if (key === 'photo') kept.photo = !!+v;
  else if (key === 'pages') kept.pages = +v;
  else if (key === 'type') Object.assign(kept, lookOf('type', v));
  else if (key[0] === 'f'){ kept[key] = !!+v; kept.type = ''; }
  else { kept[key] = +v; kept.type = ''; }
  look = {}; paint();
  const c = document.querySelector(`.obstage [data-key="${key}"][data-val="${v}"]`) ?? document.querySelector(`.obstage [data-key="${key}"]`);
  if (c){ c.classList.remove('ping'); void c.offsetWidth; c.classList.add('ping'); }
}

// ---- the four steps ----
const setChips = on => document.querySelectorAll('.obstage .obb[data-f]').forEach(b => b.classList.toggle('chips', on));
function markSteps(n){
  document.querySelectorAll('.obstep').forEach(b => {
    const s = +b.dataset.s;
    b.classList.toggle('on', s === n); b.classList.toggle('done', s < n);
    b.setAttribute('aria-pressed', String(s === n));
  });
}
function setStep(n, { user = false, pilot = true } = {}){
  const st = $('.obstage'); if (!st) return;
  stopTimers(); endPilot();
  if (user){
    story.auto = false;
    // stacked layouts: the page can be off screen when a step further down is tapped
    const r = st.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) st.scrollIntoView({ block: 'nearest', behavior: REDUCED() ? 'auto' : 'smooth' });
  }
  story.step = n;
  st.classList.remove('still'); st.classList.toggle('auto', story.auto);
  st.dataset.step = n;
  if (user && n > 2){ st.classList.add('snap'); later(80, () => st.classList.remove('snap')); }   // a jump shows everything at once
  setChips(n >= 3 || (n === 2 && REDUCED()));
  markSteps(n);
  document.querySelectorAll('.obprog').forEach(p => { p.style.setProperty('--dur', `${STEP_MS[+p.dataset.s] ?? 0}ms`); p.classList.remove('run'); void p.offsetWidth; if (+p.dataset.s === n && story.auto) p.classList.add('run'); });
  if (n === 2 && pilot && !REDUCED()) later(250, penRun);
  if (n === 3 && pilot && !REDUCED()) later(900, pilotRun);
  if (story.auto && n < 4) later(STEP_MS[n], () => setStep(n + 1));
  else if (story.auto && n === 4) later(STEP_MS[4], () => { story.auto = false; $('.obstage')?.classList.remove('auto'); });
}
function replay(){
  const st = $('.obstage'); if (!st) return;
  stopTimers(); endPilot();
  Object.assign(kept, fresh()); look = {}; paint(); setChips(false);
  story.auto = !REDUCED();
  st.classList.add('reset'); st.dataset.step = 0; story.step = 0; void st.offsetWidth; st.classList.remove('reset');
  document.querySelectorAll('.obstep').forEach(b => b.classList.remove('on', 'done'));
  later(450, () => setStep(1));
}

// a pen writes the wordings (step 2); a cursor then tailors the resume (step 3)
const cursor = () => document.querySelector('.obcursor');
const pen = () => document.querySelector('.obpen');
function moveTo(el, dx = .5, dy = .55, who = cursor()){
  const col = document.querySelector('.obstagecol');
  if (!who || !col || !el) return;
  const r = el.getBoundingClientRect(), q = col.getBoundingClientRect();
  who.style.transform = `translate(${r.left - q.left + r.width * dx}px, ${r.top - q.top + r.height * dy}px)`;
  who.classList.add('on');
}
const ctl = (key, v) => document.querySelector(`.obstage [data-key="${key}"][data-val="${v}"]`);
function penRun(){
  story.pilot = true;
  const bs = [...document.querySelectorAll('.obpages .obb[data-f]:not(.off)')].slice(0, 3);
  const go = fn => () => { if (story.pilot) fn(); };
  bs.forEach((b, i) => {
    const at = 300 + i * 1400, l = b.querySelector('.obls');
    later(at, go(() => moveTo(l, .02, .5, pen())));
    later(at + 550, go(() => { l.classList.add('wr'); void l.offsetWidth; l.classList.remove('wr'); moveTo(l, .98, .5, pen()); }));
    later(at + 1250, go(() => b.classList.add('chips')));
  });
  later(300 + bs.length * 1400 + 400, go(() => pen()?.classList.remove('on')));
}
function pilotRun(){
  story.pilot = true;
  const hover = (el, on) => el?.classList.toggle('fh', on);
  const steps = [];
  const pick = (key, v, at, hold = 900, dx = .5) => {
    const el = () => (v === 'toggle' ? document.querySelector(`.obstage [data-key="${key}"]`) : ctl(key, v));
    const value = () => (v === 'toggle' ? (kept[key] ? 0 : 1) : v);
    steps.push([at, () => moveTo(el(), dx)], [at + 600, () => { hover(el(), true); preview(key, value()); }],
      [at + 600 + hold, () => cursor()?.classList.add('click')], [at + 750 + hold, () => { cursor()?.classList.remove('click'); hover(el(), false); keep(key, value()); }]);
  };
  pick('type', 'corp', 200); pick('type', 'pub', 2000);
  pick('f0', 'toggle', 3800, 800, .2);
  pick('w2', 0, 5500, 800);
  pick('region', 'hu', 7200, 600); pick('region', 'de', 8700, 700);
  steps.forEach(([at, fn]) => later(at, () => { if (story.pilot) fn(); }));
}
function endPilot(){
  if (!story.pilot && !cursor()?.classList.contains('on') && !pen()?.classList.contains('on')) return;
  story.pilot = false;
  cursor()?.classList.remove('on', 'click'); pen()?.classList.remove('on');
  document.querySelectorAll('.fh').forEach(e => e.classList.remove('fh'));
  unpreview();
}
// the person took over: no more autoplay, and what they see is their own choice
function takeOver(){
  if (!story.pilot && !story.auto) return;
  stopTimers(); endPilot();
  story.auto = false;
  $('.obstage')?.classList.remove('auto');
  document.querySelectorAll('.obprog.run').forEach(p => p.classList.remove('run'));
  if (story.step < 3){ story.step = 3; const st = $('.obstage'); if (st) st.dataset.step = 3; markSteps(3); setChips(true); }
}
function mount(){
  if (!$('.obstage')) return;
  story.mounted = true;
  if (!story.started){ story.started = true; if (REDUCED()) story.auto = false; else later(800, () => setStep(1)); }
}

// ---- the page's own words change language in place: on hover to preview, on click to keep ----
let langTok = 0, langTimer = null;
function retext(){
  const lg = uiLang();
  document.querySelectorAll('.obwelcome [data-h]').forEach(e => {
    if (e.dataset.lg === lg) return;
    e.dataset.lg = lg;
    const v = h(e.dataset.h);
    e.innerHTML = 'jr' in e.dataset ? jr(v) : v;
  });
  document.querySelectorAll('.obwelcome [data-tt]').forEach(e => { const v = t(e.dataset.tt); e.title = v; e.setAttribute('aria-label', v); });
  document.querySelectorAll('.obwelcome [data-rg]').forEach(e => { e.title = regionName(e.dataset.rg); });
  const rec = $('.obrec'); if (rec) rec.setAttribute('aria-label', t('onb.record'));
  const st = $('.obstage'); if (st) st.setAttribute('aria-label', t('onb.hdHow'));
}
function markLangs(hover = null){
  document.querySelectorAll('.oblang').forEach(c => {
    const l = c.dataset.l, on = l === demoLang();
    c.classList.toggle('on', on); c.classList.toggle('pk', !on && l === hover); c.setAttribute('aria-pressed', String(on));
  });
}
async function showLang(l, hover = null){
  const tok = ++langTok;
  await loadCatalogue(l);
  if (tok !== langTok || !setUiLangNow(l)) return;
  document.documentElement.lang = uiLang();
  retext(); markLangs(hover);
}
// while a language is previewed the page keeps its height and place, so the chips stay under the pointer
function lockStart(on){
  const c = $('.obstart'), col = document.querySelector('.col'); if (!c) return;
  c.style.height = on ? `${c.getBoundingClientRect().height}px` : '';
  c.classList.toggle('locked', on);
  if (!col) return;
  if (on){ col.style.setProperty('height', `${col.getBoundingClientRect().height}px`, 'important'); col.style.setProperty('overflow-y', 'hidden', 'important'); }
  else { col.style.removeProperty('height'); col.style.removeProperty('overflow-y'); }
}

const ICON = d => `<svg class="obico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const STORY = [['onb.s1h', 'onb.c1'], ['onb.s2h', 'onb.c2'], ['onb.s3h', 'onb.c3'], ['onb.s4h', 'onb.c4']];
const TILES = [
  [ICON('<path d="M8 4C5 4 5 6 5 8v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 0 4 3 4M16 4c3 0 3 2 3 4v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2 0 4-3 4"/>'), 'onb.t1h', 'onb.t1'],
  [ICON('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'), 'onb.t2h', 'onb.t2'],
  [ICON('<path d="M4 9a12 12 0 0 1 16 0M7 12.5a8 8 0 0 1 10 0M10 16a4 4 0 0 1 4 0"/><circle cx="12" cy="19" r="1"/><path d="M4 4l16 16"/>'), 'onb.t3h', 'onb.t3'],
  [ICON('<path d="M12 4v10m0 0-4-4m4 4 4-4M5 19h14"/>'), 'onb.t4h', 'onb.t4'],
];

function langStep(){
  O.langs ??= [C.ui.introLang ?? browserLang()];
  const L = O.langs;
  return `<h2 class="title big">${h('onb.langTitle')}</h2>
    <p class="small muted">${h('onb.langNote')}</p>
    ${langChecks(L, { id: 'ob-langs' })}
    ${L.length > 1 ? `<label class="field"><span class="lbl inline">${h('onb.startIn')}</span><select id="ob-start">${L.map(l => `<option value="${l}" ${startLang() === l ? 'selected' : ''}>${esc(langName(l))}</option>`).join('')}</select></label>` : ''}
    <span class="lbl">${h('set.uiHead')}</span>
    ${uiChoice(O.ui, L, { name: 'ob-ui' })}
    <p class="note">${h('set.machineNote')}</p>
    <div class="btns obnav"><button class="ghost" data-act="ob-back">${h('onb.back')}</button><span class="grow"></span><button class="primary" data-act="ob-lang-go">${h('onb.continue')}</button></div>`;
}

function view(){
  const s = O.step;
  if (s === 'lang') return langStep();
  if (s === 'welcome'){
    // the entrance plays for the first moment on the page, not again when a language chip redraws it
    introAt ??= performance.now();
    const enter = performance.now() - introAt < 1000;
    if (!story.started && REDUCED()){ story.step = 3; story.auto = false; }
    setTimeout(mount, 0);
    const cur = demoLang();
    return `<div class="obwelcome${enter ? ' enter' : ''}">
      <section class="obcard obstart"><div class="oblogo"><img src="icons/icon.svg" alt="" width="64" height="64"><span>BrewCV</span></div><h2 class="title big obhero" data-h="onb.hero">${h('onb.hero')}</h2><p class="obsub" data-h="onb.intro">${h('onb.intro')}</p>
        <div class="obchoices">
          <button class="primary" data-act="ob-scratch"><b data-h="onb.scratch">${h('onb.scratch')}</b><small data-h="onb.scratchNote">${h('onb.scratchNote')}</small></button>
          <button data-act="ob-import"><b data-h="onb.import">${h('onb.import')}</b><small data-h="onb.importNote">${h('onb.importNote')}</small></button>
          <button data-act="ob-example"><b data-h="onb.example">${h('onb.example')}</b><small data-h="onb.exampleNote">${h('onb.exampleNote')}</small></button>
        </div>
        <ul class="oblangs">${Object.keys(LANG_INFO).map(l => `<li><button lang="${l}" class="oblang${l === cur ? ' on' : ''}" data-act="ob-intro-lang" data-l="${l}" aria-pressed="${l === cur}" aria-label="${esc(langName(l))}" title="${esc(langName(l))}">${l.toUpperCase()}</button></li>`).join('')}</ul></section>
      <section class="obcard obhow"><div class="obhowhead"><h3 class="obeye" data-h="onb.hdHow">${h('onb.hdHow')}</h3><button class="obreplay" data-act="ob-replay">↻ <span data-h="onb.replay">${h('onb.replay')}</span></button></div>
        <div class="obhowbody">
          ${stageHtml()}
          <div class="obsidecol">
            <ol class="obsteplist">${STORY.map(([hk, ck], i) => `<li><button class="obstep${story.step === i + 1 ? ' on' : story.step > i + 1 ? ' done' : ''}" data-act="ob-story" data-s="${i + 1}" aria-pressed="${story.step === i + 1}"><span class="obn">${i + 1}</span><span class="obst"><b data-h="${hk}">${h(hk)}</b><span data-h="${ck}">${h(ck)}</span></span><i class="obprog" data-s="${i + 1}"></i></button></li>`).join('')}</ol>
            ${whyJson()}
          </div>
        </div></section>
      <section class="obkeep"><h3 class="obeye" data-h="onb.keepHead">${h('onb.keepHead')}</h3>
        <div class="obkeep__grid">${TILES.map(([icon, hk, tk]) => `<div class="obtile">${icon}<div><b data-h="${hk}">${h(hk)}</b><p data-h="${tk}"${hk === 'onb.t1h' ? ' data-jr' : ''}>${hk === 'onb.t1h' ? jr(h(tk)) : h(tk)}</p></div></div>`).join('')}</div></section>
    </div>`;
  }
  if (s === 'about') return `${dots()}<h2 class="title">${h('onb.about')}</h2>
    ${field('ob-name', h('onb.name'), O.about.name, 'required')}${field('ob-label', h('onb.label'), O.about.label, `placeholder="${esc(t('onb.labelPh'))}"`)}
    ${field('ob-email', h('onb.email'), O.about.email, 'type="email"')}${field('ob-phone', h('onb.phone'), O.about.phone, 'type="tel"')}
    ${field('ob-city', h('onb.city'), O.about.city)}${field('ob-url', h('onb.website'), O.about.url, `placeholder="${esc(t('onb.websitePh'))}"`)}
    ${nav(false)}`;
  if (s === 'market') return `${dots()}<h2 class="title">${h('onb.market')}</h2>
    <div class="list">${MARKETS.map(([id]) => `<button class="item ${O.market === id ? 'is-cur' : ''}" data-act="ob-market" data-m="${id}"><span>${h(`onb.market.${id}`)}</span></button>`).join('')}</div>
    <p class="note">${h('onb.marketNote')}</p>${nav()}`;
  if (s === 'job') return `${dots()}<h2 class="title">${O.jobs ? h('onb.anotherJob') : h('onb.recentJob')}</h2>
    ${field('ob-pos', h('onb.jobTitle'), O.job.position)}${field('ob-emp', h('onb.employer'), O.job.name)}
    <div class="grid2">${field('ob-start', h('onb.started'), O.job.startDate, 'type="month"')}${field('ob-end', h('onb.ended'), O.job.endDate, `type="month" ${O.job.current ? 'disabled' : ''}`)}</div>
    <label class="check"><input type="checkbox" id="ob-current" ${O.job.current ? 'checked' : ''}> ${h('onb.current')}</label>
    ${field('ob-loc', h('onb.where'), O.job.location)}
    <label class="field"><span class="lbl inline">${h('onb.claims')}</span><textarea id="ob-claims" rows="5" placeholder="${esc(t('onb.claimsPh'))}">${esc(O.job.claims ?? '')}</textarea></label>
    <p class="note">${h('onb.claimsNote')}</p>
    <div class="btns"><button class="sm" data-act="ob-another">${h('onb.another')}</button></div>${nav()}`;
  if (s === 'education') return `${dots()}<h2 class="title">${h('onb.education')}</h2>
    ${field('ob-inst', h('onb.school'), O.education.institution)}
    <div class="grid2">${field('ob-type', h('onb.degree'), O.education.studyType, `placeholder="${esc(t('onb.degreePh'))}"`)}${field('ob-area', h('onb.subject'), O.education.area)}</div>
    <div class="grid2">${field('ob-eend', h('onb.finished'), O.education.endDate, 'type="month"')}${field('ob-hon', h('onb.honours'), O.education.score)}</div>
    <p class="note">${h('onb.educationNote')}</p>${nav()}`;
  if (s === 'skills') return `${dots()}<h2 class="title">${h('onb.skills')}</h2>
    <label class="field"><span class="lbl inline">${h('onb.skillsHow')}</span><textarea id="ob-skills" rows="5" placeholder="${esc(t('onb.skillsPh'))}">${esc(O.skills)}</textarea></label>${nav()}`;
  if (s === 'photo') return `${dots()}<h2 class="title">${h('onb.photo')}</h2>
    <p class="small">${h(O.market === 'dach' ? 'onb.photoDach' : 'onb.photoCee')}</p>
    <div class="btns"><button data-act="d-photo">${h('onb.choosePhoto')}</button></div>${nav()}`;
  return `<h2 class="title">${h('onb.done')}</h2>
    <p class="small">${h('onb.doneNote')}</p>
    <div class="btns"><button class="primary" data-act="ob-finish">${h('onb.startEditing')}</button></div>`;
}

function read(){
  const v = id => $(`#${id}`)?.value ?? '';
  if (O.step === 'about') O.about = { name: v('ob-name').trim(), label: v('ob-label').trim(), email: v('ob-email').trim(), phone: v('ob-phone').trim(), city: v('ob-city').trim(), url: v('ob-url').trim() };
  if (O.step === 'job') O.job = { position: v('ob-pos').trim(), name: v('ob-emp').trim(), startDate: v('ob-start'), endDate: v('ob-end'), current: !!$('#ob-current')?.checked, location: v('ob-loc').trim(), claims: v('ob-claims') };
  if (O.step === 'education') O.education = { institution: v('ob-inst').trim(), studyType: v('ob-type').trim(), area: v('ob-area').trim(), endDate: v('ob-eend'), score: v('ob-hon').trim() };
  if (O.step === 'skills') O.skills = v('ob-skills');
  if (O.step === 'lang'){ const st = $('#ob-start'); if (st) O.start = st.value; }
}

function commit(fn, label = t('undo.onboarding')){
  C.store.commit(d => {
    fn(d.record);
    const format = formatFor(O.market);
    const photo = d.cur?.photo;
    d.cur = newResume(d.record, { format, pageLimit: 1, lang: startLang() });
    if (photo?.show) d.cur.photo = photo;
    else if (photoStep() && d.record.basics?.image) d.cur.photo = { show: true, shape: 'rect' };
  }, label);
}
const header = () => commit(m => B.setHeader(m, { ...O.about, rights: '', lang: startLang() }));
function saveJob(){
  if (!O.job.position && !O.job.name) return true;
  const bullets = String(O.job.claims ?? '').split('\n').map(x => x.trim()).filter(Boolean);
  if (!bullets.length){ C.toast(t('toast.oneLine'), 'warn'); return false; }
  commit(m => B.addJob(m, { ...O.job, endDate: O.job.current ? '' : O.job.endDate, bullets, lang: startLang() }));
  O.jobs++;
  O.job = {};
  return true;
}

async function act(a, tg){
  switch (a){
    case 'ob-pin': { takeOver(); keep(tg.dataset.key, tg.dataset.val); return true; }
    case 'ob-story': { setStep(+tg.dataset.s, { user: true }); return true; }
    case 'ob-replay': { replay(); return true; }
    case 'ob-intro-lang': {
      const l = tg?.dataset.l; if (!l) return true;
      clearTimeout(langTimer);
      C.ui.introLang = l;                      // kept; the words change in place, nothing is redrawn
      await showLang(l);
      return true;
    }
    case 'ob-lang-go': {
      read();
      const L = startLang();
      const ui = O.ui.mode === 'fixed' ? { mode: 'fixed', lang: O.ui.lang ?? 'en' } : { mode: 'follow' };
      C.ui.pref = ui;
      if (!writePref(ui)) C.ui.prefVolatile = true;
      C.ui.askLang = false;
      C.ui.startLang = L;
      await setUiLang(ui.mode === 'fixed' ? ui.lang : L);
      await Promise.all(O.langs.map(loadCatalogue));
      O.step = 'welcome';
      C.restyle();
      const go = O.after; O.after = null;
      return go ? act(go) : true;     // carry on with what was chosen on the introduction
    }
    case 'ob-scratch': {
      if (C.ui.askLang){ O.after = 'ob-scratch'; O.step = 'lang'; C.renderBody(true); return true; }
      const L = startLang();
      await C.persist.checkpoint(t('checkpoint.beforeScratch'), 'replace').catch(() => {});
      const rec = B.blankRecord({ name: '' });
      if (O.langs) rec.langs = [...O.langs];
      C.store.replace({ record: rec, resumes: [], frozen: {}, cur: null, openId: null }, t('onb.scratch'));
      O.market = MARKET_OF[L] ?? null;
      C.store.commit(d => { d.cur = newResume(d.record, { format: formatFor(O.market), pageLimit: 1, lang: L }); }, t('onb.scratch'));
      O.step = 'about'; C.renderBody(true); setTimeout(() => $('#ob-name')?.focus(), 250);
      return true;
    }
    case 'ob-import': C.ui.askLang = false; C.setView('import'); return true;   // a file brings its own languages
    case 'ob-example': {
      if (C.ui.askLang){ O.after = 'ob-example'; O.step = 'lang'; C.renderBody(true); return true; }
      if (O.langs){
        const st = structuredClone(C.store.materialize());
        st.record.langs = [...O.langs];
        const r = (st.resumes ?? []).find(x => (x.lang ?? 'en') === startLang());
        if (r) RS.openSaved(st, r.id);
        C.store.reset(st, 'example');
      }
      C.setView(null); C.toast(t('toast.thisIsExample')); return true;
    }
    case 'ob-market': O.market = tg.dataset.m; commit(() => {}, t('undo.market')); C.renderBody(); return true;
    case 'ob-back': read(); if (O.step === 'lang'){ O.step = 'welcome'; O.after = null; } else O.step = prev(); C.renderBody(true); return true;
    case 'ob-skip': if (O.step === 'job') O.job = {}; O.step = next(); C.renderBody(true); return true;
    case 'ob-another': read(); if (saveJob()){ C.renderBody(true); C.toast(t('toast.jobBefore')); } return true;
    case 'ob-next': {
      read();
      if (O.step === 'about'){ if (!O.about.name){ C.toast(t('toast.nameAtLeast'), 'warn'); $('#ob-name')?.focus(); return true; } header(); }
      if (O.step === 'market' && !O.market) O.market = 'mixed';
      if (O.step === 'job' && !saveJob()) return true;
      if (O.step === 'education') commit(m => B.setEducation(m, { ...O.education, lang: startLang() }));
      if (O.step === 'skills') commit(m => B.setSkills(m, O.skills.split('\n').map(x => x.trim()).filter(Boolean), { lang: startLang() }));
      O.step = next();
      C.renderBody(true);
      return true;
    }
    case 'ob-finish':
      O.step = 'welcome';
      O.tip = 0;
      C.setView(null);
      return true;
    case 'tip-next': O.tip = O.tip < TIPS.length - 1 ? O.tip + 1 : null; C.renderBody(true); return true;
    case 'tip-skip': O.tip = null; C.renderBody(true); return true;
    case 'start-over': O.step = 'welcome'; O.after = null; C.setView('welcome'); return true;
  }
  return false;
}

function bind(body){
  let timer = null;
  // hover (or focus) previews a wording, a region, a photo or a page count; a click keeps it
  const on = (ev, fn) => body.addEventListener(ev, e => { if (O.step === 'welcome') fn(e); });
  const near = e => e.target.closest?.('.obstage [data-key]');
  const enter = e => { const c = near(e); if (c){ takeOver(); preview(c.dataset.key, c.dataset.val); } };
  const leave = e => { const c = near(e); if (c && !c.contains(e.relatedTarget)) unpreview(); };
  on('mouseover', enter); on('mouseout', leave); on('focusin', enter); on('focusout', leave);
  // hovering (or focusing) a language chip shows the page in that language; leaving goes back to the kept one
  const lc = e => e.target.closest?.('.oblang');
  const lenter = e => { const c = lc(e); if (c){ clearTimeout(langTimer); lockStart(true); showLang(c.dataset.l, c.dataset.l); } };
  const lleave = e => { const c = lc(e); if (c && !c.contains(e.relatedTarget)){ clearTimeout(langTimer); langTimer = setTimeout(() => { showLang(demoLang()); if (!document.querySelector('.oblang:hover, .oblang:focus-visible')) lockStart(false); }, 90); } };
  on('mouseover', lenter); on('mouseout', lleave); on('focusin', lenter); on('focusout', lleave);
  body.addEventListener('input', e => {
    if (O.step !== 'about' || !e.target.id?.startsWith('ob-')) return;
    clearTimeout(timer);
    timer = setTimeout(() => { read(); if (O.about.name) header(); }, 350);
  });
  body.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'ob-current'){ const end = $('#ob-end'); if (end) end.disabled = el.checked; }
    if (O.step !== 'lang' || !el.closest?.('[data-mode=welcome]')) return;
    if (el.dataset.langtick){
      const l = el.dataset.langtick;
      O.langs = el.checked ? [...new Set([...(O.langs ?? []), l])] : (O.langs ?? []).filter(x => x !== l);
      if (!O.langs.length) O.langs = [l];
      C.renderBody();
    }
    if (el.id === 'ob-start') O.start = el.value;
    if (el.dataset.uimode) O.ui = el.dataset.uimode === 'fixed' ? { mode: 'fixed', lang: $('[data-uilang]')?.value ?? 'en' } : { mode: 'follow' };
    if (el.dataset.uilang !== undefined) O.ui = { mode: 'fixed', lang: el.value };
  });
}

export function tipHtml(){
  if (O.tip == null) return '';
  const [hk, tk] = TIPS[O.tip];
  return `<div class="tipbox"><b>${h('onb.tipN', { i: O.tip + 1, n: TIPS.length, title: t(hk) })}</b><br>${h(tk)}
    <div class="btns"><span class="grow"></span><button class="sm ghost" data-act="tip-skip">${h('onb.skipTips')}</button><button class="sm primary" data-act="tip-next">${O.tip < TIPS.length - 1 ? h('onb.next') : h('onb.gotIt')}</button></div></div>`;
}

const api = { views: { welcome: view }, act, bind, tipHtml, get step(){ return O.step; },
  // a first start-up opens on the introduction; the language step follows the choice
  begin(){ O.step = 'welcome'; O.after = null; introAt = null; baseLang = null; stopTimers(); Object.assign(story, { step: 0, auto: true, started: false, mounted: false, pilot: false }); Object.assign(kept, fresh()); look = {}; if (C) C.ui.introLang = null; } };
