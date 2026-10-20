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
import * as start from './start.js';
import { icon } from './icons.js';

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


// ---- the start screen's language chips: hover shows the page's words in that language, a click keeps it ----
// The words change in place (src/ui/start.js retext), so the chips stay under the pointer.
let baseLang = null;                                // the language the page opened in, until one is clicked
const demoLang = () => C.ui.introLang ?? (baseLang ??= uiLang());
let langTok = 0, langTimer = null;
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
  start.retext(); markLangs(hover);
}

// The picture of how it works lives in the page area (#startstage), outside the panel that is drawn again: it is built once, and
// plays while the start screen is up. On a phone it sits in the column, after the three ways in.
function stage(on){
  const host = document.getElementById('startstage');
  if (!host) return;
  if (!on){ start.unmount(); return; }
  if (!host.firstChild) host.innerHTML = start.stageHtml();
  const phone = document.body.dataset.phone === 'true', col = document.getElementById('col'), pages = document.getElementById('pages');
  if (phone && host.parentElement !== col) col.insertBefore(host, document.getElementById('foot'));
  else if (!phone && host.parentElement !== document.body) document.body.append(host);
  start.mount();
}

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
  if (s === 'welcome') return start.bodyHtml({ langs: Object.keys(LANG_INFO).map(l => [l, langName(l)]), current: demoLang() });
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
    case 'ob-replay': return start.act(a, tg);
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
      // straight away, in the language the start screen is showing; the languages question waits for your own record
      const L = C.ui.introLang ?? uiLang();
      const r0 = (C.store.state.resumes ?? []).find(x => (x.lang ?? 'en') === L);
      if (r0 && r0.id !== C.store.state.openId){
        const st = structuredClone(C.store.materialize());
        RS.openSaved(st, r0.id);
        C.store.reset(st, 'example');
      }
      await loadCatalogue(L);
      C.ui.exampleChip = true;         // "This is the example…" is a chip at the top of the panel, not a toast over the page
      C.setView(null); return true;
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
    case 'ob-finish': {
      // the resume was saved the moment it existed, nameless; now it can carry the person's name
      const r = RS.savedOf(C.store.state), who = C.store.state.record?.basics?.name;
      if (r && who && r.name === t('resumes.newNameless')) C.store.commit(d => { RS.renameSaved(d, d.openId, t('resumes.newName', { name: who })); }, t('ux1.undoRename'));
      O.step = 'welcome';
      O.tip = 0;
      C.setView(null);       // the header, the tabs and the zoom bar come in around the page (src/ui/arrive.js, from shell.js)
      return true;
    }
    case 'tip-next': O.tip = O.tip < TIPS.length - 1 ? O.tip + 1 : null; C.renderBody(true); return true;
    case 'tip-skip': O.tip = null; C.renderBody(true); return true;
    case 'start-over': O.step = 'welcome'; O.after = null; C.setView('welcome'); return true;
  }
  return false;
}

function bind(body){
  let timer = null;
  const on = (ev, fn) => body.addEventListener(ev, e => { if (O.step === 'welcome') fn(e); });
  // hovering (or focusing) a language chip shows the page in that language; leaving goes back to the kept one
  const lc = e => e.target.closest?.('.oblang');
  const lenter = e => { const c = lc(e); if (c){ clearTimeout(langTimer); showLang(c.dataset.l, c.dataset.l); } };
  const lleave = e => { const c = lc(e); if (c && !c.contains(e.relatedTarget)){ clearTimeout(langTimer); langTimer = setTimeout(() => showLang(demoLang()), 90); } };
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

const api = { views: { welcome: view }, act, bind, tipHtml, stage, start, headHtml: start.headHtml, footHtml: start.footHtml, get step(){ return O.step; },
  // a first start-up opens on the introduction; the language step follows the choice
  begin(){ O.step = 'welcome'; O.after = null; baseLang = null; start.begin(); if (C) C.ui.introLang = null; } };
