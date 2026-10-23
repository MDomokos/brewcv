// A month and year picker, and a day picker, in the app's own menu (UX-6f), because the browser's own month and date popups cannot be themed. A
// field is a button that shows the date; the value lives in a hidden input with the field's id, so the forms read it as they read any field. The
// month menu is a year with ‹ ›, twelve months, and Present (an open end) or No date; the day menu is a month with ‹ ›, its days, and Today. The
// value is written as YYYY-MM or YYYY-MM-DD and checked against the JSON Resume date pattern (isIsoDate); an empty value is an open end or no date.
// Each place that has fields registers itself (initMonthPick): { name, lang(): the language the dates are shown in, change(input): it saved }; a
// field says which with its host (the default is Career's).

import { isIsoDate } from '../model/schema.js';
import { t, h } from '../i18n/index.js';
import { escapeHtml as esc } from '../export.js';
import { icon } from './icons.js';

const YEARS = [1950, 2100];
const hosts = {};      // the registered places: name -> { lang(), change(input) }
let open = null;      // { id, year, month (a day menu), host, btn, el }
const C = () => hosts[open.host] ?? hosts.career;
// the field is looked up again each time: a form drawn again while the menu is open (a field saved) has new elements
const fieldOf = () => document.querySelector(`[data-mp="${open.id}"]`);
const pad = n => String(n).padStart(2, '0');
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// the month's short name and "Mar 2023" in a language
const monthName = (m, lang) => { try { return new Intl.DateTimeFormat(lang, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, m - 1, 15))); } catch { return String(m); } };
export function monthText(value, lang, { present = false } = {}){
  if (!isIsoDate(value)) return present ? t('doc.present') : t('ux6f.noDate');
  const [y, m] = value.split('-');
  return m ? `${monthName(Number(m), lang)} ${y}` : y;
}

// html: the field. `present`: it may be an open end ("Present"); `lang`: the language the month names are shown in.
export function monthFieldHtml(id, label, value, { right = '', lang = 'en', present = false, disabled = false, host = 'career' } = {}){
  const v = isIsoDate(value) ? String(value).slice(0, 7) : '';
  return `<div class="field mpf" data-mp="${esc(id)}"${host === 'career' ? '' : ` data-mph="${esc(host)}"`} ${present ? 'data-present="1"' : ''}><span class="lbl inline"><span class="lt" id="${esc(id)}-l">${label}</span>${right ? `<span class="lr">${right}</span>` : ''}</span>
    <input type="hidden" id="${esc(id)}" class="mpval" value="${esc(v)}" ${disabled ? 'disabled' : ''}>
    <button type="button" class="mpbtn press" data-tier="secondary" data-act="mp-open" aria-haspopup="dialog" aria-expanded="false" aria-labelledby="${esc(id)}-l ${esc(id)}-b" id="${esc(id)}-b" ${disabled ? 'disabled' : ''}><span class="mpt">${esc(monthText(v, lang, { present }))}</span>${icon('caret', { role: 'inline' })}</button></div>`;
}

const menuHtml = (year, value, present, lang) => {
  const now = new Date(), cur = isIsoDate(value) ? value.slice(0, 7) : '';
  return `<div class="pop card mppop" role="dialog" aria-label="${esc(t('ux6f.pickMonth'))}" id="mp-menu">
    <div class="mpyear"><button type="button" class="press" data-tier="tertiary" data-act="mp-year" data-d="-1" aria-label="${esc(t('ux6f.prevYear'))}" ${year <= YEARS[0] ? 'disabled' : ''}>${icon('left', { role: 'control' })}</button><output aria-live="polite">${year}</output><button type="button" class="press" data-tier="tertiary" data-act="mp-year" data-d="1" aria-label="${esc(t('ux6f.nextYear'))}" ${year >= YEARS[1] ? 'disabled' : ''}>${icon('right', { role: 'control' })}</button></div>
    <div class="mpgrid" role="group" aria-label="${year}">${Array.from({ length: 12 }, (_, i) => { const k = `${year}-${String(i + 1).padStart(2, '0')}`; return `<button type="button" class="press${k === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` ? ' today' : ''}" data-tier="tertiary" data-act="mp-pick" data-v="${k}" aria-pressed="${k === cur}">${esc(monthName(i + 1, lang))}</button>`; }).join('')}</div>
    <div class="mpfoot">${present ? `<button type="button" class="press" data-tier="secondary" data-act="mp-clear" data-present="1" aria-pressed="${!cur}">${h('doc.present')}</button>` : ''}<button type="button" class="press" data-tier="secondary" data-act="mp-clear">${h('ux6f.noDate')}</button></div>
  </div>`;
};

// html: a day field (the date a resume was sent): a button with the day and a hidden value in YYYY-MM-DD
export const dayText = (value, lang) => { try { return isIsoDate(value) && value.length === 10 ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : t('ux6f.noDate'); } catch { return value; } };
export function dayFieldHtml(id, label, value, { lang = 'en', host = 'career' } = {}){
  const v = isIsoDate(value) && String(value).length === 10 ? String(value) : '';
  return `<div class="field mpf" data-mp="${esc(id)}" data-mph="${esc(host)}" data-day="1"><span class="lbl inline"><span class="lt" id="${esc(id)}-l">${label}</span></span>
    <input type="hidden" id="${esc(id)}" class="mpval" value="${esc(v)}">
    <button type="button" class="mpbtn press" data-tier="secondary" data-act="mp-open" aria-haspopup="dialog" aria-expanded="false" aria-labelledby="${esc(id)}-l ${esc(id)}-b" id="${esc(id)}-b"><span class="mpt">${esc(dayText(v, lang))}</span>${icon('caret', { role: 'inline' })}</button></div>`;
}
// the day menu: a month with ‹ ›, the weekdays (the language's first day first), the days, and Today
const firstDay = lang => { try { return new Intl.Locale(lang).weekInfo?.firstDay ?? new Intl.Locale(lang).getWeekInfo?.().firstDay ?? 1; } catch { return 1; } };      // 1 Monday … 7 Sunday
const dayMenuHtml = (year, month, value, lang) => {
  const first = firstDay(lang), today = isoToday();
  const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7 - (first - 1);      // blanks before the 1st
  const blanks = (lead + 7) % 7, n = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const names = Array.from({ length: 7 }, (_, i) => { try { return new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + ((first - 1 + i) % 7)))); } catch { return ''; } });
  let title; try { title = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, 15))); } catch { title = `${year}-${pad(month + 1)}`; }
  const days = Array.from({ length: n }, (_, i) => { const k = `${year}-${pad(month + 1)}-${pad(i + 1)}`; return `<button type="button" class="press${k === today ? ' today' : ''}" data-tier="tertiary" data-act="mp-pick" data-v="${k}" aria-pressed="${k === value}" ${i === 0 && blanks ? `style="grid-column-start:${blanks + 1}"` : ''}>${i + 1}</button>`; }).join('');
  return `<div class="pop card mppop mpday" role="dialog" aria-label="${esc(t('ux6f.pickDay'))}" id="mp-menu">
    <div class="mpyear"><button type="button" class="press" data-tier="tertiary" data-act="mp-month" data-d="-1" aria-label="${esc(t('ux6f.prevMonth'))}" ${year <= YEARS[0] && month === 0 ? 'disabled' : ''}>${icon('left', { role: 'control' })}</button><output aria-live="polite">${esc(title)}</output><button type="button" class="press" data-tier="tertiary" data-act="mp-month" data-d="1" aria-label="${esc(t('ux6f.nextMonth'))}" ${year >= YEARS[1] && month === 11 ? 'disabled' : ''}>${icon('right', { role: 'control' })}</button></div>
    <div class="mpdow" aria-hidden="true">${names.map(x => `<span>${esc(x)}</span>`).join('')}</div>
    <div class="mpgrid mpdays" role="group" aria-label="${esc(title)}">${days}</div>
    <div class="mpfoot"><button type="button" class="press" data-tier="secondary" data-act="mp-pick" data-v="${today}">${h('ux6f.today')}</button></div>
  </div>`;
};

function close(refocus = true){
  if (!open) return;
  open.el.remove();
  const b = fieldOf()?.querySelector('.mpbtn') ?? open.btn;
  b.setAttribute('aria-expanded', 'false');
  if (refocus) b.focus();
  open = null;
}
function place(){
  if (!open) return;
  const r = open.btn.getBoundingClientRect(), el = open.el;
  el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8))}px`;
  el.style.top = `${r.bottom + 4 + el.offsetHeight > innerHeight ? Math.max(8, r.top - 4 - el.offsetHeight) : r.bottom + 4}px`;
}
function draw(){
  const f = fieldOf();
  if (!f){ open.el.remove(); open = null; return; }
  const input = f.querySelector('.mpval');
  open.btn = f.querySelector('.mpbtn');
  open.el.remove();
  const tmp = document.createElement('div');
  tmp.innerHTML = f.dataset.day ? dayMenuHtml(open.year, open.month, input.value, C().lang()) : menuHtml(open.year, input.value, !!f.dataset.present, C().lang());
  open.el = tmp.firstElementChild;
  (open.btn.closest('dialog') ?? document.body).append(open.el);
  place();
}
function set(value){
  const f = fieldOf();
  if (!f) return close(false);
  const input = f.querySelector('.mpval'), day = !!f.dataset.day;
  if (value !== '' && !isIsoDate(value)) return;      // never a value JSON Resume would not take
  open.btn = f.querySelector('.mpbtn');
  input.value = value;
  f.querySelector('.mpt').textContent = day ? dayText(value, C().lang()) : monthText(value, C().lang(), { present: !!f.dataset.present });
  const host = C();
  close();
  host.change?.(input);
}
// a field that may be switched off (the end of a job that is the current one): its value and its button together
export function monthDisable(id, off){
  const f = document.querySelector(`[data-mp="${id}"]`);
  if (!f) return;
  if (open?.id === id) close(false);
  f.querySelector('.mpval').disabled = off;
  f.querySelector('.mpbtn').disabled = off;
}

let bound = false;
export function initMonthPick(ctx){
  hosts[ctx.name ?? 'career'] = ctx;
  if (bound) return api;
  bound = true;
  document.addEventListener('click', e => {
    const b = e.target.closest?.('[data-act^=mp-]');
    if (!b){ if (open && !e.target.closest?.('#mp-menu')) close(false); return; }
    const a = b.dataset.act;
    if (a === 'mp-open'){
      if (open){ const same = open.btn === b; close(false); if (same) return; }
      const f = b.closest('[data-mp]'), input = f.querySelector('.mpval'), v = isIsoDate(input.value) ? input.value : '';
      const now = new Date(), y = v ? Number(v.slice(0, 4)) : now.getFullYear(), m = v.length >= 7 ? Number(v.slice(5, 7)) - 1 : now.getMonth();
      open = { id: f.dataset.mp, host: f.dataset.mph ?? 'career', btn: b, year: y, month: m, el: document.createElement('div') };
      b.setAttribute('aria-expanded', 'true');
      draw();
      open.el.querySelector('[aria-pressed=true], .today, [data-act=mp-pick]')?.focus();
    } else if (open && a === 'mp-year'){ open.year = Math.max(YEARS[0], Math.min(YEARS[1], open.year + Number(b.dataset.d))); draw(); open.el.querySelector(`[data-act=mp-year][data-d="${b.dataset.d}"]`)?.focus(); }
    else if (open && a === 'mp-month'){
      const k = open.year * 12 + open.month + Number(b.dataset.d);
      open.year = Math.max(YEARS[0], Math.min(YEARS[1], Math.floor(k / 12))); open.month = k - Math.floor(k / 12) * 12;
      draw(); open.el.querySelector(`[data-act=mp-month][data-d="${b.dataset.d}"]`)?.focus();
    }
    else if (open && a === 'mp-pick') set(b.dataset.v);
    else if (open && a === 'mp-clear') set('');
  });
  document.addEventListener('keydown', e => {
    if (!open) return;
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); return; }
    const g = [...open.el.querySelectorAll('.mpgrid [data-act=mp-pick]')], at = g.indexOf(document.activeElement), days = !!open.el.querySelector('.mpdays');
    const step = days ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key] : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key];
    if (at >= 0 && step){ e.preventDefault(); const n = at + step; if (n >= 0 && n < g.length) g[n].focus(); }
    if (e.key === 'Tab' && !e.target.closest?.('#mp-menu') && !e.target.closest?.('.mpbtn')) close(false);
  }, true);
  globalThis.addEventListener?.('resize', () => close(false));
  document.addEventListener('scroll', e => { if (open && !e.target.closest?.('#mp-menu')) close(false); }, true);
  return api;
}
const api = { close, get isOpen(){ return !!open; } };
