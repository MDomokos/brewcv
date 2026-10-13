// The record as a checklist: every claim the record holds, grouped by where it comes from, each with its
// "on this resume" state. Pure: no DOM. src/ui/checklist.js draws it; the ticks are edit.js's setBullet.
//
// Groups, in order: About you, the jobs (newest first), the projects, Education, Skills and credentials,
// then the custom kinds. A job, a project and a custom entry are one group each; its rows are its claims.
// Rows that can be ticked are claims of an entry (setBulletOn). The rest print with their section, so
// those rows show the section's state and the section carries the switch.

import * as T from './resume.js';
import * as K from './career.js';
import { versionsIn } from './record.js';
import { offOf } from '../recipe.js';
import { entriesOf, isArchived } from './entries.js';

const DEFAULT_LANG = T.DEFAULT_LANG;
const CREDENTIALS = ['skills', 'languages', 'certificates', 'publications', 'interests', 'references'];

export const textOf = (model, recipe, id) => (id && recipe?.overrides?.[id]) ?? (id ? T.chooseVariant(model, id, recipe).v?.text ?? '' : '');
const nvOf = (model, id, lang) => (id ? versionsIn(model, id, lang).length : 0);
const shortOf = (model, id, text) => String(text || (model.facts ?? []).find(f => f.id === id)?.summary || id).replace(/\n/g, ' · ');

// the selection that opens a claim of an entry in the inspector
export const claimSel = (id, job) => (job ? { kind: 'bullet', id, job, section: 'experience' } : { kind: 'bullet', id, section: 'summary' });

// This resume's order differs from the record's: a job's bullets, a list section's items, the sections on the page. Nothing is stored
// when nothing was moved (a bullet list in the record's order is the bare id, an item order equal to the record's is dropped), so the
// order is compared, not looked up.
const differs = (now, record) => now.some((x, i) => x !== record[i]);
const itemsCustom = (model, recipe, sid) => { const l = T.itemList(model, recipe, sid); return !!l && differs(l.map(x => x.id), T.itemsOf(model, sid)); };
export function sectionsCustom(model, recipe){
  const on = T.sectionList(model, recipe).filter(s => s.on && !s.fixed).map(s => s.id);
  return differs(on, (model.sections ?? []).map(s => s.id).filter(id => on.includes(id)));
}

export function checklist(model, recipe, lang = recipe?.lang ?? DEFAULT_LANG){
  const sections = new Map(T.sectionList(model, recipe).map(s => [s.id, s]));
  const sectionOn = sid => !!sections.get(sid)?.on;
  const groups = [];
  const claimRow = (id, w, listed, jobOn) => {
    const arch = isArchived(model, id);
    return { id, kind: 'claim', text: shortOf(model, id, textOf(model, recipe, id)), nv: nvOf(model, id, lang), on: jobOn && listed.has(id), archived: arch, sel: claimSel(id, w.id) };
  };

  // About you: always printed
  const b = model.basics ?? {}, d = b.display ?? {};
  const about = [
    { id: 'about:name', kind: 'about', text: [b.name, textOf(model, recipe, d.label)].filter(Boolean).join(' · '), nv: nvOf(model, d.label, lang), on: true, fixed: true, sel: { kind: 'header', id: 'name' } },
    { id: 'about:contact', kind: 'about', text: textOf(model, recipe, d.contact) || [b.email, b.phone].filter(Boolean).join(' · '), nv: nvOf(model, d.contact, lang), on: true, fixed: true, sel: { kind: 'header', id: 'contact' } },
    { id: 'about:photo', kind: 'about', text: '', nv: 0, on: !!recipe?.photo?.show, fixed: true, noTick: true, sel: { kind: 'header', id: 'photo' } },
  ];
  if (b.summary) about.push({ id: b.summary, kind: 'claim', text: shortOf(model, b.summary, textOf(model, recipe, b.summary)), nv: nvOf(model, b.summary, lang), on: true, fixed: true, sel: claimSel(b.summary, null) });
  groups.push({ id: 'about', kind: 'about', rows: about.filter(r => r.noTick || r.text || r.kind === 'claim'), archived: [] });

  // the entries: jobs, then projects, then the custom kinds with bullets; each in the timeline's order
  const order = K.timelineLayout(model, { lang }).entries.filter(x => x.key !== 'education');
  const byId = new Map(entriesOf(model).map(w => [w.id, w]));
  const entryGroups = order.map(v => {
    const w = byId.get(v.id);
    if (!w) return null;
    const jobOn = T.jobRefs(model, recipe).some(r => (typeof r === 'string' ? r : r.id) === w.id);
    const lb = T.listedBullets(model, recipe, w.id), listed = new Set(lb);
    const rows = (w.highlights ?? []).map(id => claimRow(id, w, listed, jobOn));
    return { id: w.id, kind: 'entry', entryKind: v.kind, key: v.key, title: v.title, org: v.org, archived: !!w.archived, jobOn, custom: differs(lb, (w.highlights ?? []).filter(h => listed.has(h))),
      // an archived claim that this resume still prints stays in the list, badged; the others fold away
      sel: { kind: 'job', id: w.id }, rows: rows.filter(r => !r.archived || r.on), archivedRows: rows.filter(r => r.archived && !r.on) };
  }).filter(Boolean);
  const rank = g => (g.entryKind === 'work' ? 0 : g.entryKind === 'project' ? 1 : 2);
  entryGroups.sort((a, c) => rank(a) - rank(c));        // stable: newest first inside each kind
  for (const g of entryGroups.filter(g => rank(g) < 2)) groups.push(g);

  // education: one group, its entries as rows; the section carries the switch
  const eduOn = sectionOn('education');
  const edu = (model.education ?? []).map((e, i) => ({ ...e, id: e.id ?? `edu-${i}` })).filter(e => e.institution || e.studyType).map(e => {
    const v = K.entryView(model, 'education', e, lang);
    return { id: e.id, kind: 'item', text: [v.title, v.org].filter(Boolean).join(' · '), nv: nvOf(model, e.display?.studyType, lang), on: eduOn, sel: { kind: 'record', what: 'entry', key: 'education', id: e.id } };
  });
  groups.push({ id: 'education', kind: 'education', section: 'education', sectionOn: eduOn, rows: edu, archived: [] });

  // skills and credentials: the lists, each under its section. Items of a list section tick one by one and
  // print in this resume's order; a publication or an education line prints with its section.
  const lists = K.recordLists(model, { lang });
  const offSet = new Set(offOf(recipe));
  const listRows = (group, sid, sectionOnNow, items) => {
    const order = T.itemList(model, recipe, sid);
    const rank = new Map((order ?? []).map((x, i) => [x.id, i]));
    const rows = items.map(x => {
      const itemId = order && rank.has(x.id) ? x.id : null;
      return { id: `${group}:${x.id}`, kind: 'item', item: itemId, section: sid, text: x.title + (x.sub && group !== 'skills' ? ` · ${x.sub}` : ''),
        nv: nvOf(model, ['skills', 'languages', 'interests', 'references'].includes(group) ? x.id : null, lang), on: sectionOnNow && !(itemId && offSet.has(itemId)),
        sel: { kind: 'record', what: 'item', group, id: x.id } };
    });
    return order ? rows.sort((a, c) => (rank.get(a.item) ?? 1e9) - (rank.get(c.item) ?? 1e9)) : rows;
  };
  const sub = lists.filter(g => CREDENTIALS.includes(g.group)).map(g => {
    const sid = K.sectionFor(model, g.group, g.items[0]?.id ?? null);
    const on = sectionOn(sid);
    return { id: g.group, section: sid, sectionOn: on, custom: itemsCustom(model, recipe, sid), rows: listRows(g.group, sid, on, g.items) };
  });
  groups.push({ id: 'credentials', kind: 'credentials', subs: sub, rows: sub.flatMap(s => s.rows), archived: [] });

  // custom kinds: their entries (like jobs), then the list kinds
  for (const g of entryGroups.filter(g => rank(g) >= 2)) groups.push(g);
  for (const g of lists.filter(g => g.kind)){
    const k = K.kindOf(model, g.kind);
    const on = sectionOn(k?.section);
    groups.push({ id: g.kind, kind: 'list', title: K.kindName(model, g.kind, lang), section: k?.section, sectionOn: on, custom: itemsCustom(model, recipe, k?.section),
      rows: listRows(g.kind, k?.section, on, g.items), archived: [] });
  }

  for (const g of groups){
    const rows = g.rows.filter(r => !r.noTick);
    g.on = rows.filter(r => r.on).length;
    g.total = rows.length;
  }
  const live = groups.filter(g => !g.archived || g.kind !== 'entry');
  return { groups, on: live.reduce((n, g) => n + g.on, 0), total: live.reduce((n, g) => n + g.total, 0) };
}

// The groups of the checklist that a section of the resume prints: the jobs of Experience, About you for the header and the
// summary, Education, the credentials, a custom kind. `cl` is checklist()'s result. Edit's section rows show "n of m on" from
// this, and the link on one opens Record at the first of these groups.
export function groupsOfSection(model, cl, sid){
  if (sid === 'header' || sid === 'summary') return cl.groups.filter(g => g.id === 'about');
  return cl.groups.filter(g => {
    if (g.kind === 'entry') return !g.archived && T.sectionOfEntry(model, g.id) === sid;
    if (g.kind === 'credentials') return g.subs.some(s => s.section === sid);
    return g.section === sid;
  });
}
export function sectionCounts(model, cl, sid){
  const gs = groupsOfSection(model, cl, sid);
  if (!gs.length) return null;
  if (gs[0].kind === 'credentials'){
    const rows = gs[0].subs.filter(s => s.section === sid).flatMap(s => s.rows);
    return { on: rows.filter(r => r.on).length, total: rows.length, groups: [gs[0].id] };
  }
  return { on: gs.reduce((n, g) => n + g.on, 0), total: gs.reduce((n, g) => n + g.total, 0), groups: gs.map(g => g.id) };
}

// The group a selection belongs to, so that group is the one open.
export function groupOf(model, sel){
  if (!sel || sel.kind === 'none') return null;
  if (sel.kind === 'job') return sel.id;
  if (sel.kind === 'header') return 'about';
  if (sel.kind === 'bullet'){
    const w = T.jobOfFact(model, sel.id);
    if (w) return w.id;
    if (sel.job) return sel.job;
    if (sel.owner) return sel.owner;
    return (sel.section ?? 'summary') === 'summary' ? 'about' : null;
  }
  if (sel.kind === 'record'){
    if (sel.what === 'entry') return sel.key === 'education' ? 'education' : sel.id;
    if (sel.what === 'item') return CREDENTIALS.includes(sel.group) ? 'credentials' : sel.group;
  }
  return null;
}

// A fact that is a record item (a skill group, a language, a certificate, an interest, a reference, a
// publication's title, an education line) → the selection that opens that item's form. null for any other fact.
export function recordSelOfFact(model, id){
  if (!id) return null;
  const item = (group, list) => ((model[list] ?? []).some(x => x?.id === id) ? { kind: 'record', what: 'item', group, id } : null);
  const hit = item('skills', 'skills') ?? item('languages', 'languages') ?? item('interests', 'interests') ?? item('references', 'references') ?? item('certificates', 'certificates');
  if (hit) return hit;
  const pub = (model.publications ?? []).find(p => Object.values(p.display ?? {}).includes(id));
  if (pub) return { kind: 'record', what: 'item', group: 'publications', id: pub.id };
  const edu = (model.education ?? []).map((e, i) => ({ ...e, id: e.id ?? `edu-${i}` })).find(e => Object.values(e.display ?? {}).includes(id));
  if (edu) return { kind: 'record', what: 'entry', key: 'education', id: edu.id };
  return null;
}
// …and back: the fact whose versions an item's form shows (null when it shows none)
export function factOfRecordSel(model, sel){
  if (sel?.kind !== 'record' || sel.what !== 'item') return null;
  if (['skills', 'languages', 'interests', 'references'].includes(sel.group)) return (model.facts ?? []).some(f => f.id === sel.id) ? sel.id : null;
  if (sel.group === 'publications') return (model.publications ?? []).find(p => p.id === sel.id)?.display?.name ?? null;
  return null;
}
