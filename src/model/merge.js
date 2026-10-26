// Object clocks, and the merge of two copies of one record that both have them. Pure: no DOM, no I/O.
// The state is a set of objects, each under a key: fact:<id>, variant:<id>, section:<id>, <store>:<id> for a job, a school, a skill group and the other
// entries, resume:<id> (with its frozen text), basics.<field> and settings (the rest of the record). A clock is { key: [stamp, prev, hash] }: the hash
// of the object when it was last stamped, the stamp it got then, and the stamp it had before. A deleted object stays a key (its tombstone in
// record.removed), so a delete is an edit like any other.

import { fnv } from '../store/store.js';
import { t } from '../i18n/index.js';
import { BODY_KEYS } from './schema.js';
import { canon, resumeLabel, openSaved, groupOf, mirror } from './resumes.js';
import { tombstone, nextMajor, normText, compareN, versionsIn } from './record.js';
import { deleteClaim } from './career.js';
import { newResume } from './resume.js';

const STORES = BODY_KEYS.filter(k => k !== 'basics');
const NAMES = { fact: 'facts', variant: 'variants', section: 'sections' };      // the record's list of each kind; a store is its own name
const KINDS = [...Object.keys(NAMES), ...STORES, 'resume'];
const listName = kind => NAMES[kind] ?? kind;
const NOT_SETTINGS = new Set([...Object.values(NAMES), ...STORES, 'basics', 'removed', 'recordId', 'schema', 'meta']);
const kindOf = k => k.split(':')[0];
const idOf = k => k.slice(k.indexOf(':') + 1);
// shortcut: a section or a job deleted in a way that leaves no tombstone (the six delete functions do) comes back from a copy that still has it; upgrade by marking those deletes too.
// shortcut: a saved resume renamed is a new key, so a copy that still has the old name brings it back; upgrade by marking a rename.
// shortcut: an item with no string id (an imported entry the app never numbered) rides along from the newer copy, unmerged.

// What a deleted key holds in the map of a state.
class Gone { constructor(mark){ this.removed = mark; } }

export function keysOf({ record: r, resumes = [], frozen = {} } = {}){
  const m = new Map();
  for (const kind of KINDS) for (const x of (kind === 'resume' ? resumes : r?.[listName(kind)]) ?? []) if (typeof x?.id === 'string')
    m.set(`${kind}:${x.id}`, kind === 'resume' && frozen?.[x.id] ? { ...x, frozen: frozen[x.id] } : x);
  if (!r) return m;
  for (const [f, v] of Object.entries(r.basics ?? {})) m.set(`basics.${f}`, v);
  m.set('settings', Object.fromEntries(Object.entries(r).filter(([k]) => !NOT_SETTINGS.has(k))));
  for (const [k, mark] of Object.entries(r.removed ?? {})) if (!m.has(k)) m.set(k, new Gone(mark));
  return m;
}

// A version's metrics are a cache each device measures for itself, a resume's frozen text is what it printed when it was last saved here, and a
// claim's list of versions is merged as a list: none of them is an edit.
const SKIP = { variant: 'metrics', fact: 'variants', resume: 'frozen' };
const hashOf = (k, o) => { const s = SKIP[kindOf(k)]; return fnv(JSON.stringify(canon(s ? { ...o, [s]: undefined } : o))); };
const topOf = clock => Object.values(clock ?? {}).reduce((m, e) => (e?.[0] > m ? e[0] : m), '');

// A stamp after every one this clock has seen, then the device: stamps order as strings, and two devices never make the same one.
function hlc(clock, dev, now){
  const top = topOf(clock);
  return `${new Date(Math.max(now, top ? Date.parse(top.split('~')[0]) + 1 : 0)).toISOString()}~${dev}`;
}

// An entry is [stamp, prev, hash, older, mark]: older is the stamps before prev, newest first, so a copy that skipped a file still finds its stamp in the chain.
// shortcut: older keeps the last 8, so a copy that skipped more than 8 stamps of one key (each a save of a file or a merge) is read as having changed it too; upgrade with a version vector per key.
const CAP = 8;
const chainOf = e => [e?.[1], ...(e?.[3] ?? [])].filter(x => x != null);
const ancestor = (x, y) => x[0] !== y[0] && chainOf(x).includes(y[0]);      // y's stamp is one x came from
// The clock for `state` now: an object whose hash changed gets a new stamp (prev: its old one), a new object gets one with no prev. One stamp per call.
// An entry marked 1 is an edit no file has carried yet. Edited again it stays one event, so its chain is still what the others know (a prev nobody
// has would make the next copy to meet it think the key was changed on both sides). markShared() takes the mark off once the file is written.
export function tick(clock, state, dev, now = Date.now()){
  const out = {};
  let stamp = null;
  for (const [k, o] of keysOf(state)){
    const h = hashOf(k, o), e = clock?.[k];
    if (e?.[2] === h){ out[k] = e; continue; }
    const chain = e ? [...new Set(e[4] ? chainOf(e) : [e[0], ...chainOf(e)])] : [];
    out[k] = [stamp ??= hlc(clock, dev, now), chain[0] ?? null, h, chain.slice(1, CAP + 1), 1];
  }
  return out;
}
// A stamp just after `s` (or after the start of time), for what a merge writes itself: the same whichever copy merges, and a date like any other.
const bump = s => `${new Date((s ? Date.parse(s.split('~')[0]) : 0) + 1).toISOString()}~m`;
const unmark = e => (e[3]?.length ? e.slice(0, 4) : e.slice(0, 3));
export const share = clock => Object.fromEntries(Object.entries(clock).map(([k, e]) => [k, unmark(e)]));
// Marks off the entries that went into a file (`sent`, as share() made it) and are still what they were
export const markShared = (clock, sent) => Object.fromEntries(Object.entries(clock).map(([k, e]) => [k, e[4] && sent?.[k]?.[0] === e[0] && sent[k][2] === e[2] ? unmark(e) : e]));
// A state taken from something with no clock: everything in it is the common start, older than any stamp, so the first edit on either side is the later one.
export const baseline = state => Object.fromEntries([...keysOf(state)].map(([k, o]) => [k, ['', '', hashOf(k, o)]]));

// A clock read from a file or storage: only entries that are what tick() makes (a real date and a device on each stamp). A garbled stamp would stop every later tick.
const okStamp = s => s === '' || (typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z~[\w-]{1,16}~?$/.test(s) && Number.isFinite(Date.parse(s.split('~')[0])));
const okEntry = e => Array.isArray(e) && typeof e[2] === 'string' && okStamp(e[0]) && (e[1] === null || okStamp(e[1])) && (e[3] === undefined || (Array.isArray(e[3]) && e[3].length <= CAP && e[3].every(okStamp)));
export const cleanClock = c => (c && typeof c === 'object' && !Array.isArray(c) ? Object.fromEntries(Object.entries(c).filter(([, e]) => okEntry(e))) : null);
// Does the clock say what is in the state? A file with a changed object under its old clock was edited outside, and is not merged by clock.
export const clockFits = (state, clock) => !!clock && [...keysOf(state)].every(([k, o]) => clock[k]?.[2] === hashOf(k, o));

const clip = (s, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
function label(k, o){
  if (k === 'settings') return t('set.title');
  if (k.startsWith('basics.')) return k.slice(7);
  if (kindOf(k) === 'resume') return resumeLabel(o);
  return clip(String(o?.text ?? o?.summary ?? o?.name ?? o?.position ?? o?.title ?? o?.institution ?? o?.language ?? idOf(k)));
}
const show = (k, o) => (o instanceof Gone ? t('i1.gone') : o && typeof o === 'object' ? clip(String(o.text ?? label(k, o)), 90) : String(o ?? ''));

// ---- putting and taking an object in a state { record, resumes, frozen }; the undo of a summary line is one of these ----
const into = (list, x) => { const i = list.findIndex(y => y?.id === x.id); if (i < 0) list.push(x); else { if (x.variants && list[i].variants) x.variants = list[i].variants; list[i] = x; } };
function put(d, k, o){
  const x = structuredClone(o);
  if (k === 'settings'){ for (const f of Object.keys(d.record)) if (!NOT_SETTINGS.has(f)) delete d.record[f]; Object.assign(d.record, x); }
  else if (!k.includes(':')) (d.record.basics ??= {})[k.slice(7)] = x;
  else if (kindOf(k) === 'resume'){
    const { frozen, ...r } = x;
    into(d.resumes ??= [], r);
    if (frozen) (d.frozen ??= {})[idOf(k)] = frozen; else delete d.frozen?.[idOf(k)];
  } else into(d.record[listName(kindOf(k))] ??= [], x);
}
function drop(d, k){
  const kind = kindOf(k), id = idOf(k);
  if (!KINDS.includes(kind)) return;      // a mark for something that is not an object here (a sent copy)
  if (kind === 'resume'){ d.resumes = (d.resumes ?? []).filter(r => r.id !== id); delete d.frozen?.[id]; return; }
  const name = listName(kind);
  d.record[name] = (d.record[name] ?? []).filter(x => x.id !== id);
  if (!d.record[name].length && STORES.includes(name)) delete d.record[name];
  if (kind === 'variant') for (const f of d.record.facts ?? []) f.variants = f.variants.filter(v => v !== id);
}

// The order of two lists as one, the same whichever is first: an item only one list has goes where it stands there, two such at one place by id, and
// items both have in another order by the preferred list.
function weave(a, b, preferA = true){
  const inA = new Set(a), inB = new Set(b), out = [], seen = new Set();
  let i = 0, j = 0;
  for (;;){
    while (i < a.length && seen.has(a[i])) i++;
    while (j < b.length && seen.has(b[j])) j++;
    if (i >= a.length && j >= b.length) return out;
    const x = a[i], y = b[j], xOnly = i < a.length && !inB.has(x), yOnly = j < b.length && !inA.has(y);
    const pick = i >= a.length ? y : j >= b.length ? x : x === y ? x : xOnly && yOnly ? (String(x) < String(y) ? x : y) : xOnly ? x : yOnly ? y : preferA ? x : y;
    seen.add(pick); out.push(pick);
  }
}
const J = x => JSON.stringify(x);
const union = (a, b) => { const seen = new Set(a.map(J)); return [...a, ...b.filter(x => !seen.has(J(x)))]; };
// The two versions of one entry, section or the settings as one where that loses nothing: the lists of ids (a bullet only one side added to a job, a
// job to the experience section) and the lists of tags, job types and languages. The first one's order and other fields.
function joined(k, w, l, live){
  const o = structuredClone(w);
  if (k === 'settings'){
    for (const [at, other, key] of [[o.vocabulary, l.vocabulary, 'tags'], [o, l, 'jobTypes'], [o, l, 'langs']])
      if (Array.isArray(at?.[key]) && Array.isArray(other?.[key])) at[key] = union(at[key], other[key]);
    return o;
  }
  for (const [at, other, key] of [[o, l, 'highlights'], [o.content, l.content, 'work']])
    if (Array.isArray(at?.[key]) && Array.isArray(other?.[key])) at[key] = weave(at[key], other[key]).filter(id => live.has(id));
  return o;
}
const idLists = ({ record: r, resumes }) => {
  const m = new Map();
  for (const kind of KINDS) m.set(kind, ((kind === 'resume' ? resumes : r?.[listName(kind)]) ?? []).map(x => x?.id).filter(i => typeof i === 'string'));
  for (const f of r?.facts ?? []) m.set(`@${f.id}`, [...(f.variants ?? [])]);      // a claim's versions
  return m;
};
// The ids a list holds, edited by `fn`, wherever `id` is a version or an item of that kind
const relist = (s, kind, id, fn) => {
  for (const [name, ids] of s.l) if ((name === kind || (kind === 'variant' && name[0] === '@')) && ids.includes(id)) s.l.set(name, fn(ids));
};
const factOfVersion = (sides, vid) => sides.flatMap(s => [...s.l]).find(([n, ids]) => n[0] === '@' && ids.includes(vid))?.[0].slice(1);

// An entry of the clock that agrees with the object, else the start: "I don't know when this changed".
const side = ({ state, clock }) => {
  const m = keysOf(state), c = cleanClock(clock) ?? {};
  return { state, m, c: new Map([...m].map(([k, o]) => { const h = hashOf(k, o), e = c[k]; return [k, e?.[2] === h ? e : ['', '', h]]; })), l: idLists(state), top: topOf(c) };
};
const aNewer = (x, y) => (x[0] !== y[0] ? x[0] > y[0] : x[2] >= y[2]);
// a copy of a version made by a merge: the id ends in a hash
const COPY = /-v[\d-]+(?:-[a-z]{2})?(?:-alt)?-[0-9a-f]{6}$/;
const KEYS = { alt: 'i1.alt', both: 'i1.both', newer: 'i1.newer', revived: 'i1.revived', deleted: 'i1.deleted', group: 'i1.group' };

// mine, theirs: { state: { record, resumes, frozen }, clock }. Whichever way round, the same state comes out. summary: one line for each thing both
// copies changed, { key, kind, what, kept, other, undo }, where undo(d) puts the other back in a state d the way a diffRecords item's apply does.
export function merge(mine, theirs){
  const A = side(mine), B = side(theirs);
  const [N, O] = (A.top !== B.top ? A.top > B.top : J(A.state) >= J(B.state)) ? [A, B] : [B, A];      // the copy with the later stamp (else the later text) sets the order and what is not a key
  const out = new Map(), clock = {}, summary = [], joins = [], met = new Map();      // met: the stamp of the other copy's entry, for each key a line was made about
  const set = (k, o, e) => { out.set(k, o); clock[k] = e; };
  const line = (k, kind, lab, kept, other, undo, texts = null) => summary.push({ key: k, kind, what: t(KEYS[kind], { what: label(k, lab) }), kept: texts?.[0] ?? show(k, kept), other: texts?.[1] ?? show(k, other), undo });
  const unDelete = (k, o) => d => (kindOf(k) === 'fact' ? deleteClaim(d.record, idOf(k), d.resumes ?? []) : (drop(d, k), tombstone(d.record, kindOf(k), idOf(k), o)));

  for (const k of [...new Set([...A.m.keys(), ...B.m.keys()])].sort()){
    const a = A.m.get(k), b = B.m.get(k), ea = A.c.get(k), eb = B.c.get(k);
    if (!ea || !eb) set(k, ea ? a : b, ea ?? eb);
    else if (ea[2] === eb[2]) aNewer(ea, eb) ? set(k, a, ea) : set(k, b, eb);
    else if (ancestor(eb, ea)) set(k, b, eb);      // theirs is a later edit of mine
    else if (ancestor(ea, eb)) set(k, a, ea);
    else {
      // both changed it: the newer stamp keeps the key
      const aw = aNewer(ea, eb), [w, l, ew, el] = aw ? [a, b, ea, eb] : [b, a, eb, ea], loser = aw ? B : A, kind = kindOf(k), id = idOf(k);
      set(k, w, ew);
      met.set(k, [el[0]]);
      const gw = w instanceof Gone, gl = l instanceof Gone;
      // shortcut: three copies where one rewords a version, one deletes it and one rewords it differently can end in two states, by the order they meet (a delete against an edit is settled before the second wording is seen); upgrade by merging all of them at once.

      if (gw && gl) continue;
      if (gw || gl){      // a delete against an edit: whichever is newer wins
        const claim = kind === 'variant' ? factOfVersion([A, B], id) : null;      // the claim a version belongs to
        line(k, gw ? 'deleted' : 'revived', gw ? l : w, w, l, gw
          ? d => { put(d, k, l); const f = d.record.facts?.find(x => x.id === claim); if (f && !f.variants.includes(id)) f.variants.push(id); if (d.record.removed) { delete d.record.removed[k]; if (!Object.keys(d.record.removed).length) delete d.record.removed; } }
          : unDelete(k, w));
        // shortcut: undoing a delete puts a version back in its claim and a saved resume back, but a job or other entry only as the object, not its place in a section; upgrade by keeping the place.
        continue;
      }
      const fresh = ea[1] === null && eb[1] === null;      // made on both sides, not edited on both
      const wording = kind === 'variant' && normText(a.text) !== normText(b.text);
      if (wording || (fresh && !['variant', 'fact'].includes(kind) && k.includes(':'))){
        // keep both: the other becomes a copy under an id every device makes the same
        const h6 = el[2].slice(0, 6), nid = kind === 'resume' ? id.replace(/(\.json)?$/, `-${h6}$1`) : `${id}${wording && !fresh ? '-alt' : ''}-${h6}`, nk = `${kind}:${nid}`;
        if (A.m.has(nk) || B.m.has(nk)) continue;      // merged before
        const copy = { ...l, id: nid };
        set(nk, copy, [el[0], null, '']);      // its hash once it is in the state
        if (wording && !fresh) for (const s of [A, B]) relist(s, kind, id, ids => ids.flatMap(x => (x === id ? [x, nid] : [x])));      // beside the one it is another text of
        else relist(loser, kind, id, ids => ids.map(x => (x === id ? nid : x)));      // it keeps its place in the copy it came from
        line(nk, wording && !fresh ? 'alt' : 'both', l, w, l, d => { drop(d, nk); tombstone(d.record, kind, nid, copy); });      // the mark keeps the next merge from bringing it back
        continue;
      }
      // a plain value (or two claims made under one name: one claim, its versions told apart by their ids)
      // shortcut: any other field changed on both sides of a job, claim or section keeps the newer one whole, and the line lists the other; upgrade by merging field by field.
      // shortcut: a tag, job type or language deleted on one side comes back when the settings were changed on both; upgrade with marks for those.
      if (STORES.includes(kind) || kind === 'section' || k === 'settings') joins.push({ k, l });
      const keys = k === 'settings' ? [...new Set([...Object.keys(w), ...Object.keys(l)])].filter(f => J(w[f]) !== J(l[f])) : null;
      line(k, 'newer', w, w, l, d => put(d, k, l), keys && [keys.map(f => `${f}: ${clip(J(w[f]), 40)}`).join('; '), keys.map(f => `${f}: ${clip(J(l[f]), 40)}`).join('; ')]);
    }
  }

  // a deleted claim or version the other copy built on later comes back: the later edit wins, and a claim needs its versions
  const aliveOut = k => out.has(k) && !(out.get(k) instanceof Gone);
  const revive = k => {
    const s = [A, B].find(s => s.m.has(k) && !(s.m.get(k) instanceof Gone)), o = s?.m.get(k);
    if (!o) return false;
    set(k, o, s.c.get(k));
    met.set(k, [[A, B].find(x => x.m.get(k) instanceof Gone)?.c.get(k)[0] ?? '']);
    line(k, 'revived', o, o, new Gone(null), unDelete(k, o));
    if (kindOf(k) === 'fact') backInJob(k);
    return true;
  };
  const backInJob = k => {      // a claim that is back is back in the job that had it
    for (const [k2, cur] of [...out]){
      if (cur instanceof Gone || !Array.isArray(cur.highlights) || cur.highlights.includes(idOf(k))) continue;
      const from = [A, B].map(x => x.m.get(k2)).find(x => x && !(x instanceof Gone) && x.highlights?.includes(idOf(k)));
      if (from) out.set(k2, { ...cur, highlights: weave(cur.highlights, from.highlights).filter(x => x === idOf(k) || cur.highlights.includes(x)) });
    }
  };
  for (const k of out.keys()) if (kindOf(k) === 'fact' && aliveOut(k) && [A, B].some(x => x.m.get(k) instanceof Gone)) backInJob(k);      // also where the later edit won the claim outright
  // shortcut: a revived claim goes back into its job's bullets, not into a skill group, a section or a resume's picks; upgrade by putting back what pointed at it.
  const home = new Map();
  for (const s of [N, O]) for (const [n, ids] of s.l) if (n[0] === '@') for (const id of ids) home.set(id, n.slice(1));
  for (const k of [...out.keys()].filter(k => kindOf(k) === 'variant' && aliveOut(k))){
    const fid = home.get(idOf(k));
    if (fid && out.get(`fact:${fid}`) instanceof Gone) revive(`fact:${fid}`);
  }
  for (const k of [...out.keys()].filter(k => kindOf(k) === 'fact' && aliveOut(k))){
    const ids = weave(N.l.get(`@${idOf(k)}`) ?? [], O.l.get(`@${idOf(k)}`) ?? []), lang = id => [A, B].map(x => x.m.get(`variant:${id}`)).find(x => x && !(x instanceof Gone))?.lang ?? 'en';
    if (ids.length && !ids.some(id => aliveOut(`variant:${id}`) && lang(id) === 'en')){      // two copies each deleted a different version: one of them stays
      const back = ids.filter(id => out.get(`variant:${id}`) instanceof Gone && lang(id) === 'en').sort((x, y) => (clock[`variant:${y}`]?.[0] ?? '').localeCompare(clock[`variant:${x}`]?.[0] ?? '') || x.localeCompare(y))[0];
      if (back) revive(`variant:${back}`);
    }
  }

  // a bullet only one side added to a job (a job to the experience section), and the tags of the settings, are kept with the newer whole
  const live = new Set([...out].filter(([, o]) => !(o instanceof Gone)).map(([k]) => idOf(k)));
  for (const { k, l } of joins){
    const cur = out.get(k), o = joined(k, cur, l, live);
    if (J(o) !== J(cur)) out.set(k, o);
  }

  // the state: the newer copy's, with what the other side decided put in, in the woven order
  const st = structuredClone({ record: N.state.record, resumes: N.state.resumes ?? [], frozen: N.state.frozen ?? {} });
  for (const [k, o] of out) if (!N.c.has(k) || (o !== N.m.get(k) && hashOf(k, o) !== N.c.get(k)[2])) (o instanceof Gone ? drop : put)(st, k, o);      // the newer copy's own object stays, even when the other's has the same hash
  // a resume's frozen text is no edit, so when both copies hold the same resume it comes from the one that stamped it last (else the longer text), not from whichever copy sets the order
  for (const k of out.keys()){
    const a = A.m.get(k), b = B.m.get(k), ea = A.c.get(k), eb = B.c.get(k);
    if (kindOf(k) !== 'resume' || !ea || !eb || ea[2] !== eb[2] || a instanceof Gone || b instanceof Gone) continue;
    const from = ea[0] !== eb[0] ? (ea[0] > eb[0] ? a : b) : (J(a.frozen ?? null) >= J(b.frozen ?? null) ? a : b);
    if (from.frozen) (st.frozen ??= {})[idOf(k)] = structuredClone(from.frozen); else delete st.frozen?.[idOf(k)];
  }
  // a bullet whose claim was deleted is not in a job, whichever copy's job won
  for (const store of ['work', 'projects', 'volunteer']) for (const w of st.record[store] ?? [])
    if (Array.isArray(w.highlights)) w.highlights = w.highlights.filter(h => !(out.get(`fact:${h}`) instanceof Gone));
  const alive = (kind, id) => aliveOut(`${kind}:${id}`);
  const order = (name, kind) => weave(N.l.get(name) ?? [], O.l.get(name) ?? []).filter(id => alive(kind, id));
  for (const kind of KINDS){
    const arr = kind === 'resume' ? st.resumes : st.record[listName(kind)];
    const rank = new Map(order(kind, kind).map((id, i) => [id, i]));
    arr?.sort((x, y) => (rank.get(x.id) ?? 1e9) - (rank.get(y.id) ?? 1e9));
  }
  for (const f of st.record.facts ?? []) f.variants = order(`@${f.id}`, 'variant');

  // a language group is one unit: when each copy changed a different member, the copy with the newer stamp gives all of it, mirror() brings the
  // members in step, and what the other copy changed is one line with its Undo
  const seen = new Set();
  for (const r of st.resumes){
    if (seen.has(r.id)) continue;
    const g = groupOf(st, r).map(x => `resume:${x.id}`);
    g.forEach(k => seen.add(idOf(k)));
    const differ = g.filter(k => A.c.has(k) && B.c.has(k) && A.c.get(k)[2] !== B.c.get(k)[2]);
    const by = s => differ.filter(k => clock[k] === s.c.get(k));
    const top = s => by(s).reduce((m, k) => (s.c.get(k)[0] > m ? s.c.get(k)[0] : m), '');
    if (g.length < 2 || !by(A).length || !by(B).length) continue;
    const [S, L] = top(A) > top(B) ? [A, B] : top(A) < top(B) ? [B, A] : [N, O];
    const lost = g.filter(k => L.m.has(k)).map(k => [k, L.m.get(k)]);
    for (let i = summary.length; i--;) if (differ.includes(summary[i].key)) summary.splice(i, 1);      // the group's one line says it
    for (const k of differ) if (S.m.has(k)){ put(st, k, S.m.get(k)); clock[k] = S.c.get(k); met.set(k, [L.c.get(k)[0]]); }
    const src = by(S).sort((x, y) => (S.c.get(y)[0] > S.c.get(x)[0] ? 1 : -1))[0];
    mirror(st, idOf(src));
    line(src, 'group', S.m.get(src), S.m.get(src), L.m.get(src) ?? lost[0]?.[1], d => { for (const [k, o] of lost) put(d, k, o); });
  }

  // what must hold in the merged claims: a number a delete retired in either copy stays retired unless a live version has it again, a default is a
  // version the claim has, and a number is one version's in its claim and language
  const byId = new Map(st.record.variants.map(v => [v.id, v]));
  for (const f of st.record.facts ?? []){
    const sides = [A.m.get(`fact:${f.id}`), B.m.get(`fact:${f.id}`)].map(x => x?.retired ?? {});
    const vs = f.variants.map(id => byId.get(id)).filter(Boolean);
    for (const lang of new Set([...Object.keys(f.retired ?? {}), ...sides.flatMap(Object.keys)])){
      const have = new Set(vs.filter(v => (v.lang ?? 'en') === lang).map(v => String(v.n)));
      const list = [...new Set([f.retired?.[lang] ?? [], ...sides.map(x => x[lang] ?? [])].flat().map(String))].filter(n => !have.has(n)).sort(compareN);
      if (list.join() === (f.retired?.[lang] ?? []).join()) continue;
      if (list.length) (f.retired ??= {})[lang] = list; else delete f.retired[lang];
      if (!Object.keys(f.retired).length) delete f.retired;
    }
    for (const [lang, vid] of Object.entries(f.default ?? {})) if (!f.variants.includes(vid) || !byId.has(vid)){
      const left = versionsIn(st.record, f.id, lang);
      if (left.length) f.default[lang] = left[0].id; else delete f.default[lang];
    }
    const byN = new Map();
    for (const v of vs) if (v.n !== undefined) (byN.get(`${v.lang ?? 'en'} ${v.n}`) ?? byN.set(`${v.lang ?? 'en'} ${v.n}`, []).get(`${v.lang ?? 'en'} ${v.n}`)).push(v);
    for (const dup of byN.values()) if (dup.length > 1){      // the oldest keeps it, a copy of a merge last
      const at = v => clock[`variant:${v.id}`]?.[0] ?? '';
      dup.sort((x, y) => COPY.test(x.id) - COPY.test(y.id) || (at(x) < at(y) ? -1 : at(x) > at(y) ? 1 : 0) || (x.id < y.id ? -1 : 1));
      for (const v of dup.slice(1)) v.n = nextMajor(st.record, f.id, v.lang ?? 'en');
    }
  }

  const gone = [...out].filter(([, o]) => o instanceof Gone);
  if (gone.length) st.record.removed = Object.fromEntries(gone.map(([k, o]) => [k, o.removed])); else delete st.record.removed;
  // what the merge itself wrote (a copy, a joined list, a mirrored resume, a renumbered version) is an edit after the entry it came from
  for (const [k, o] of keysOf(st)){
    const h = hashOf(k, o), e = clock[k];
    if (!e || e[2] === h) continue;
    const top = [A.c.get(k)?.[0], B.c.get(k)?.[0], e[0]].reduce((m, x) => (x > m ? x : m), '');
    clock[k] = e[2] === '' ? [e[0], null, h] : [bump(top), e[0], h, chainOf(e).slice(0, CAP)];
  }
  // an edit only this copy has seen stays marked; one that came from, or is also in, the other copy is known to both
  for (const k of Object.keys(clock)) if (clock[k][4] && !(clock[k] === A.c.get(k) && B.c.get(k)?.[0] !== clock[k][0])) clock[k] = unmark(clock[k]);
  // the other copy's stamp is now one this entry has seen, so meeting the same file again is a later edit of it and lists nothing
  for (const [k, stamps] of met){
    const e = clock[k];
    if (!e) continue;
    const older = [...(e[3] ?? []), ...stamps.filter(x => x !== e[0] && x !== e[1] && !(e[3] ?? []).includes(x))].slice(0, CAP);
    clock[k] = [e[0], e[1], e[2], older, ...(e[4] ? [e[4]] : [])];
  }
  return { state: st, clock, summary, changed: [...out.keys()].filter(k => clock[k]?.[2] !== A.c.get(k)?.[2]).length };
}

// Runs `change(d)` on the app's state, then opens the open resume again if the change altered it: the next commit would write the old one back.
export function keepOpen(d, change){
  const open = () => JSON.stringify((d.resumes ?? []).find(r => r.id === d.openId));
  const was = open();
  change(d);
  if (!d.openId || open() === was) return;
  if (d.resumes.some(r => r.id === d.openId)) openSaved(d, d.openId);
  else { d.openId = null; d.cur = newResume(d.record, { format: 'a4' }); }
}
