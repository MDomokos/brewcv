// Differences between two career records, as items a person can tick. Pure: no DOM, no I/O.
// 'add' is ticked by default, 'change' is not, 'keep' is only in yours. A reworded version is an add.

import { t } from '../i18n/index.js';
import { wordDiff, addVersion, versionsIn } from './record.js';
import { resumeLabel, uniqueId } from './resumes.js';
import { slug } from './build.js';

const clone = x => structuredClone(x);
export const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const wset = s => new Set(norm(s).split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2));
export function sim(a, b){
  const A = wset(a), B = wset(b);
  let i = 0;
  for (const w of A) if (B.has(w)) i++;
  return i / Math.max(1, Math.min(A.size, B.size));
}
const clip = (s, n = 40) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

function ixOf(m){
  return {
    facts: new Map((m.facts ?? []).map(f => [f.id, f])),
    vars: new Map((m.variants ?? []).map(v => [v.id, v])),
    work: m.work ?? [],
  };
}
const versionsOf = (ix, factId) => (ix.facts.get(factId)?.variants ?? []).map(id => ix.vars.get(id)).filter(Boolean);
const claimText = (ix, factId) => ix.facts.get(factId)?.summary ?? versionsOf(ix, factId)[0]?.text ?? factId;

export const matchJob = (j, list) => list.find(x => x.id === j.id)
  ?? list.find(x => norm(x.name) === norm(j.name) && x.startDate === j.startDate)
  ?? list.find(x => norm(x.name) === norm(j.name));

// By id, then 60% of claim words shared, then any identical version text.
export function matchClaim(toIx, factId, fromIx, candidates){
  if (candidates.includes(factId) && fromIx.facts.has(factId)) return factId;
  const c = claimText(toIx, factId);
  const bySim = candidates.find(id => sim(claimText(fromIx, id), c) >= 0.6);
  if (bySim) return bySim;
  const texts = new Set(versionsOf(toIx, factId).map(v => norm(v.text)));
  return candidates.find(id => versionsOf(fromIx, id).some(v => texts.has(norm(v.text)))) ?? null;
}

// Copies under a free id and returns that id.
export function copyFact(dst, src, factId, prefer = factId){
  const sx = ixOf(src);
  const f = sx.facts.get(factId);
  if (!f) return null;
  const taken = new Set([...(dst.facts ?? []).map(x => x.id), ...(dst.work ?? []).map(x => x.id)]);
  const id = taken.has(prefer) ? slug(prefer, taken, 'claim') : prefer;
  const vtaken = new Set((dst.variants ?? []).map(v => v.id));
  const map = {};
  for (const v of versionsOf(sx, factId)){
    let vid = v.id.startsWith(`${factId}-`) ? `${id}-${v.id.slice(factId.length + 1)}` : `${id}-${v.id}`;
    let n = 2;
    while (vtaken.has(vid)) vid = `${vid}-${n++}`;
    vtaken.add(vid);
    map[v.id] = vid;
    dst.variants.push({ ...clone(v), id: vid });
  }
  const nf = { ...clone(f), id, variants: f.variants.filter(x => map[x]).map(x => map[x]) };
  if (nf.default) for (const [l, v] of Object.entries(nf.default)) if (map[v]) nf.default[l] = map[v]; else delete nf.default[l];
  if (nf.work) delete nf.work;
  dst.facts.push(nf);
  return id;
}

function copyVersion(dst, factId, v){
  if (versionsOf(ixOf(dst), factId).some(w => norm(w.text) === norm(v.text) && (w.lang ?? 'en') === (v.lang ?? 'en'))) return null;
  const nv = addVersion(dst, factId, { text: v.text, lang: v.lang ?? 'en', as: 'major' });
  nv.tags = [...new Set([...(nv.tags ?? []), ...(v.tags ?? [])])];
  if (nv.text === v.text){ nv.marks = clone(v.marks ?? []); nv.links = clone(v.links ?? []); }
  if (v.separator) nv.separator = v.separator;
  return nv;
}

export function diffRecords(from, to, { fromResumes = [], toResumes = [] } = {}){
  const items = [];
  const F = ixOf(from), T = ixOf(to);

  const value = (what, a, b, apply) => {
    if (norm(a) === norm(b) || b === undefined || b === null || b === '') return;
    items.push({ kind: a ? 'change' : 'add', what, a: a ?? '', b, on: !a, apply });
  };
  const fb = from.basics ?? {}, tb = to.basics ?? {};
  value(t('diff.name'), fb.name, tb.name, d => { d.record.basics.name = tb.name; });
  value(t('diff.label'), fb.label, tb.label, d => { d.record.basics.label = tb.label; });
  for (const k of ['email', 'phone', 'url']) value(t(`diff.${k}`), fb[k], tb[k], d => { d.record.basics[k] = tb[k]; });
  value(t('diff.city'), fb.location?.city, tb.location?.city, d => { d.record.basics.location = { ...(d.record.basics.location ?? {}), city: tb.location.city }; });
  if (tb.image && tb.image !== fb.image)
    items.push({ kind: fb.image ? 'change' : 'add', what: t('diff.photo'), a: fb.image ? t('diff.aPhoto') : '', b: fb.image ? t('diff.otherPhoto') : t('diff.aPhoto'), on: !fb.image, apply: d => { d.record.basics.image = tb.image; } });

  const claimItems = (fromId, toId, where) => {
    const fvs = versionsOf(F, fromId);
    const was = !!F.facts.get(fromId)?.archived, now = !!T.facts.get(toId)?.archived;
    if (was !== now) items.push({ kind: 'change', what: `${where} · ${clip(claimText(F, fromId))}`, a: was ? t('arch.diffArchived') : t('arch.diffNot'), b: now ? t('arch.diffArchived') : t('arch.diffNot'), on: false,
      apply: d => { const f = d.record.facts.find(x => x.id === fromId); if (f){ if (now) f.archived = true; else delete f.archived; } } });
    for (const v of versionsOf(T, toId)){
      const same = fvs.find(w => norm(w.text) === norm(v.text) && (w.lang ?? 'en') === (v.lang ?? 'en'));
      if (!same){
        const near = fvs.filter(w => (w.lang ?? 'en') === (v.lang ?? 'en')).sort((a, b) => sim(b.text, v.text) - sim(a.text, v.text))[0];
        const what = [...new Set([t('diff.newVersion'), where, clip(claimText(F, fromId))])].join(' · ') + ((v.lang ?? 'en') !== 'en' ? ` · ${v.lang}` : '');
        items.push({ kind: 'add', what,
          diff: near ? wordDiff(near.text, v.text) : [{ op: '+', text: v.text }], on: true,
          apply: d => { if (d.record.facts.some(f => f.id === fromId)) copyVersion(d.record, fromId, v); } });
      } else {
        const nt = (v.tags ?? []).filter(x => !(same.tags ?? []).includes(x));
        if (nt.length) items.push({ kind: 'add', what: t('diff.tags', { claim: clip(claimText(F, fromId)), v: same.n }), b: nt.join(', '), on: true,
          apply: d => { const w = d.record.variants.find(x => x.id === same.id); if (w) w.tags = [...new Set([...(w.tags ?? []), ...nt])]; } });
      }
    }
  };

  const jobFacts = m => new Set((m.work ?? []).flatMap(w => [w.display?.position, w.display?.meta, ...(w.highlights ?? [])]).filter(Boolean));
  const fJob = jobFacts(from), tJob = jobFacts(to);
  for (const f of to.facts ?? []){
    if (tJob.has(f.id)) continue;
    if (F.facts.has(f.id) && !fJob.has(f.id)) claimItems(f.id, f.id, f.id === to.basics?.summary ? t('diff.summary') : (f.summary ?? f.id));
  }

  for (const tj of to.work ?? []){
    const fj = matchJob(tj, from.work ?? []);
    if (!fj){
      items.push({ kind: 'add', what: t('diff.newJob'), b: `${tj.position} · ${tj.name} · ${tj.startDate ?? ''} – ${tj.endDate ?? t('diff.present')} · ${t('diff.claims', { n: (tj.highlights ?? []).length })}`, on: true,
        apply: d => {
          if (matchJob(tj, d.record.work)) return;
          const taken = new Set([...d.record.work.map(w => w.id), ...d.record.facts.map(f => f.id)]);
          const wid = taken.has(tj.id) ? slug(tj.id, taken, 'job') : tj.id;
          const w = { ...clone(tj), id: wid, display: {}, highlights: [] };
          for (const k of ['position', 'meta']) if (tj.display?.[k]) w.display[k] = copyFact(d.record, to, tj.display[k], `${wid}-${k}`);
          for (const h of tj.highlights ?? []){ const id = copyFact(d.record, to, h); if (id) w.highlights.push(id); }
          d.record.work.push(w);
          d.record.work.sort((a, b) => String(b.endDate ?? '9999').localeCompare(String(a.endDate ?? '9999')) || String(b.startDate).localeCompare(String(a.startDate)));
          const s = d.record.sections.find(x => x.kind === 'entries');
          if (s){ s.content.work = d.record.work.filter(x => s.content.work.includes(x.id) || x.id === wid).map(x => x.id); }
        } });
      continue;
    }
    const at = name => d => d.record.work.find(w => w.id === fj.id);
    for (const [k, label] of [['position', t('diff.title')], ['startDate', t('diff.start')], ['endDate', t('diff.end')], ['location', t('diff.place')]]){
      const a = fj[k] ?? (k === 'endDate' ? 'present' : ''), b = tj[k] ?? (k === 'endDate' ? 'present' : '');
      if (norm(a) !== norm(b)) items.push({ kind: 'change', what: `${fj.name} · ${label}`, a, b, on: false,
        apply: d => { const w = at()(d); if (w) w[k] = tj[k] ?? null; } });
    }
    for (const k of ['position', 'meta']) if (fj.display?.[k] && tj.display?.[k]) claimItems(fj.display[k], tj.display[k], `${fj.name} · ${k === 'position' ? 'title' : 'meta line'}`);
    const fcands = fj.highlights ?? [];
    const matched = new Set();
    for (const th of tj.highlights ?? []){
      const fh = matchClaim(T, th, F, fcands);
      if (!fh){
        items.push({ kind: 'add', what: t('diff.newClaim', { job: fj.name }), b: `${claimText(T, th)} · ${t('diff.versions', { n: versionsOf(T, th).length })}`, on: true,
          apply: d => { const w = at()(d); if (!w) return; const id = copyFact(d.record, to, th); if (id) w.highlights.push(id); } });
        continue;
      }
      matched.add(fh);
      claimItems(fh, th, fj.name);
    }
    for (const fh of fcands) if (!matched.has(fh) && !matchClaim(F, fh, T, tj.highlights ?? []))
      items.push({ kind: 'keep', what: t('diff.onlyYoursIn', { job: fj.name }), b: claimText(F, fh) });
  }
  for (const fj of from.work ?? []) if (!matchJob(fj, to.work ?? [])) items.push({ kind: 'keep', what: t('diff.onlyYours'), b: `${fj.position} · ${fj.name}` });

  for (const jt of to.jobTypes ?? []) if (!(from.jobTypes ?? []).includes(jt))
    items.push({ kind: 'add', what: t('diff.jobType'), b: jt, on: true, apply: d => { d.record.jobTypes ??= []; if (!d.record.jobTypes.includes(jt)) d.record.jobTypes.push(jt); } });
  for (const k of to.same ?? []) if (!(from.same ?? []).includes(k) && F.facts.has(k.replace(/^fact:/, '')))
    items.push({ kind: 'add', what: t('diff.same'), b: k.replace(/^\w+:/, ''), on: true, apply: d => { d.record.same = [...new Set([...(d.record.same ?? []), k])]; } });
  for (const r of toResumes){
    if (fromResumes.some(x => resumeLabel(x) === resumeLabel(r))) continue;
    items.push({ kind: 'add', what: t('diff.savedResume'), b: `${resumeLabel(r)}${r.jobType ? ` · ${r.jobType}` : ''}`, on: true,
      apply: (d, frozen) => {
        if ((d.resumes ?? []).some(x => resumeLabel(x) === resumeLabel(r))) return;
        const c = clone(r); c.id = uniqueId(d.resumes, c);
        d.resumes = [...(d.resumes ?? []), c];
        if (frozen?.[r.id]) d.frozen = { ...(d.frozen ?? {}), [c.id]: clone(frozen[r.id]) };
      } });
  }
  for (const r of fromResumes) if (!toResumes.some(x => resumeLabel(x) === resumeLabel(r)) && toResumes.length)
    items.push({ kind: 'keep', what: t('diff.savedOnlyYours'), b: resumeLabel(r) });
  return items;
}

export function applyItems(d, items, frozen = null){
  let n = 0;
  for (const x of items) if (x.on && x.kind !== 'keep' && x.apply){ x.apply(d, frozen); n++; }
  return n;
}

export const counts = items => ({ add: items.filter(x => x.kind === 'add').length, change: items.filter(x => x.kind === 'change').length, keep: items.filter(x => x.kind === 'keep').length });
export { versionsIn };
