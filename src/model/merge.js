// Object clocks, and the merge of two copies of one record that both have them. Pure: no DOM, no I/O.
// The state is a set of objects, each under a key: fact:<id>, variant:<id>, section:<id>, <store>:<id> for a job, a school, a skill group and the other
// entries, resume:<id> (with its frozen text), basics.<field> and settings (the rest of the record). A clock is { key: [stamp, prev, hash] }: the hash
// of the object when it was last stamped, the stamp it got then, and the stamp it had before. A deleted object stays a key (its tombstone in
// record.removed), so a delete is an edit like any other.

import { fnv } from '../store/store.js';
import { t } from '../i18n/index.js';
import { BODY_KEYS } from './schema.js';
import { canon, resumeLabel, openSaved, groupOf, mirror } from './resumes.js';
import { tombstone, nextMajor, normText } from './record.js';
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

// The clock for `state` now: an object whose hash changed gets a new stamp (prev: its old one), a new object gets one with no prev. One stamp per call.
// An entry marked 1 is an edit no other copy has seen. Edited again it stays one event, so its prev is still the stamp the others know (a prev nobody
// has would make the next copy to meet it think the key was changed on both sides). share() takes the marks off when a copy leaves.
export function tick(clock, state, dev, now = Date.now()){
  const out = {};
  let stamp = null;
  for (const [k, o] of keysOf(state)){
    const h = hashOf(k, o), e = clock?.[k];
    out[k] = e?.[2] === h ? e : [stamp ??= hlc(clock, dev, now), e ? (e[3] ? e[1] : e[0]) : null, h, 1];
  }
  return out;
}
export const share = clock => Object.fromEntries(Object.entries(clock).map(([k, e]) => [k, e.slice(0, 3)]));
// A state taken from something with no clock: everything in it is the common start, older than any stamp, so the first edit on either side is the later one.
export const baseline = state => Object.fromEntries([...keysOf(state)].map(([k, o]) => [k, ['', '', hashOf(k, o)]]));

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

// The order of two lists as one: the newer copy's order, and what only the other has goes after the item before it there.
const weave = (base, other) => {
  const out = [...base];
  other.forEach((x, i) => { if (!out.includes(x)) out.splice(i ? out.indexOf(other[i - 1]) + 1 : 0, 0, x); });
  return out;
};
// The lists of ids in two versions of one entry or section as one, the first one's order first.
function joined(w, l, live){
  const o = structuredClone(w);
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

// An entry of the clock that agrees with the object, else the start: "I don't know when this changed".
const side = ({ state, clock }) => {
  const m = keysOf(state);
  return { state, m, c: new Map([...m].map(([k, o]) => { const h = hashOf(k, o), e = clock?.[k]; return [k, Array.isArray(e) && e[2] === h ? e : ['', '', h]]; })), l: idLists(state), top: topOf(clock) };
};
const aNewer = (x, y) => (x[0] !== y[0] ? x[0] > y[0] : x[2] >= y[2]);

// mine, theirs: { state: { record, resumes, frozen }, clock }. Whichever way round, the same state comes out. summary: one line for each thing both
// copies changed, { key, what, kept, other, undo }, where undo(d) puts the other back in a state d the way a diffRecords item's apply does.
export function merge(mine, theirs){
  const A = side(mine), B = side(theirs);
  const [N, O] = A.top >= B.top ? [A, B] : [B, A];      // the copy with the later stamp sets the order and what is not a key
  const out = new Map(), clock = {}, summary = [], copies = [], joins = [];
  const set = (k, o, e) => { out.set(k, o); clock[k] = e; };
  const line = (k, what, lab, kept, other, undo) => summary.push({ key: k, what: t(what, { what: label(k, lab) }), kept: show(k, kept), other: show(k, other), undo });

  for (const k of [...new Set([...A.m.keys(), ...B.m.keys()])].sort()){
    const a = A.m.get(k), b = B.m.get(k), ea = A.c.get(k), eb = B.c.get(k);
    if (!ea || !eb) set(k, ea ? a : b, ea ?? eb);
    else if (ea[2] === eb[2]) aNewer(ea, eb) ? set(k, a, ea) : set(k, b, eb);
    else if (eb[1] === ea[0] && eb[0] !== ea[0]) set(k, b, eb);      // theirs is a later edit of mine
    else if (ea[1] === eb[0] && ea[0] !== eb[0]) set(k, a, ea);
    else {
      // both changed it: the newer stamp keeps the key
      const aw = aNewer(ea, eb), [w, l, ew, el] = aw ? [a, b, ea, eb] : [b, a, eb, ea], loser = aw ? B : A, kind = kindOf(k), id = idOf(k);
      set(k, w, ew);
      const gw = w instanceof Gone, gl = l instanceof Gone;
      if (gw && gl) continue;
      if (gw || gl){      // a delete against an edit: whichever is newer wins
        const live = gw ? l : w;
        const home = kind === 'variant' ? [...A.l, ...B.l].find(([n, ids]) => n[0] === '@' && ids.includes(id))?.[0].slice(1) : null;      // the claim a version belongs to
        line(k, gw ? 'i1.deleted' : 'i1.revived', live, w, l, gw
          ? d => { put(d, k, l); const f = d.record.facts?.find(x => x.id === home); if (f && !f.variants.includes(id)) f.variants.push(id); if (d.record.removed) { delete d.record.removed[k]; if (!Object.keys(d.record.removed).length) delete d.record.removed; } }
          : d => { drop(d, k); tombstone(d.record, kind, id, w); });
        // shortcut: undoing a delete puts a version back in its claim and a saved resume back, but a claim, job or other entry only as the object, not its place in a job or section; upgrade by keeping the place.
        continue;
      }
      const fresh = ea[1] === null && eb[1] === null;      // made on both sides, not edited on both
      const wording = kind === 'variant' && normText(a.text) !== normText(b.text);
      if (wording || (fresh && !['variant', 'fact'].includes(kind) && k.includes(':'))){
        // keep both: the other becomes a copy under an id every device makes the same
        const h6 = el[2].slice(0, 6), nid = kind === 'resume' ? id.replace(/(\.json)?$/, `-${h6}$1`) : `${id}${wording && !fresh ? '-alt' : ''}-${h6}`, nk = `${kind}:${nid}`;
        if (A.m.has(nk) || B.m.has(nk)) continue;      // merged before
        out.set(nk, { ...l, id: nid });
        copies.push({ k: nk, id: nid, stamp: el[0], fix: kind === 'variant' });
        if (wording && !fresh) for (const s of [A, B]) relist(s, kind, id, ids => ids.flatMap(x => (x === id ? [x, nid] : [x])));      // beside the one it is another text of
        else relist(loser, kind, id, ids => ids.map(x => (x === id ? nid : x)));      // it keeps its place in the copy it came from
        line(nk, wording && !fresh ? 'i1.alt' : 'i1.both', l, w, l, d => drop(d, nk));
        continue;
      }
      // a plain value (or two claims made under one name: one claim, its versions told apart by their ids)
      // shortcut: any other field changed on both sides of a job, claim or section keeps the newer one whole, and the line lists the other; upgrade by merging field by field.
      if (STORES.includes(kind) || kind === 'section') joins.push({ k, w, l, ew });
      line(k, 'i1.newer', w, w, l, d => put(d, k, l));
    }
  }
  // a bullet only one side added to a job (a job to the experience section) is kept with the newer whole; the stamp is after both, with the newer as its prev
  const live = new Set([...out].filter(([, o]) => !(o instanceof Gone)).map(([k]) => idOf(k)));
  for (const { k, w, l, ew } of joins){
    const o = joined(w, l, live);
    if (JSON.stringify(o) !== JSON.stringify(w)){ out.set(k, o); clock[k] = [`${ew[0]}~`, ew[0], hashOf(k, o)]; }
  }

  // the state: the newer copy's, with what the other side decided put in, in the woven order
  const st = structuredClone({ record: N.state.record, resumes: N.state.resumes ?? [], frozen: N.state.frozen ?? {} });
  for (const [k, o] of out) if (!N.c.has(k) || clock[k][2] !== N.c.get(k)[2]) (o instanceof Gone ? drop : put)(st, k, o);      // the newer copy's own object stays, even when the other's has the same hash
  const alive = (kind, id) => out.has(`${kind}:${id}`) && !(out.get(`${kind}:${id}`) instanceof Gone);
  const order = (name, kind) => weave(N.l.get(name) ?? [], O.l.get(name) ?? []).filter(id => alive(kind, id));
  for (const kind of KINDS){
    const arr = kind === 'resume' ? st.resumes : st.record[listName(kind)];
    const rank = new Map(order(kind, kind).map((id, i) => [id, i]));
    arr?.sort((x, y) => (rank.get(x.id) ?? 1e9) - (rank.get(y.id) ?? 1e9));
  }
  for (const f of st.record.facts ?? []) f.variants = order(`@${f.id}`, 'variant');
  // a copy of a version takes the next number its claim has free: numbers are unique in a claim and language
  for (const c of copies.filter(c => c.fix)){
    const v = st.record.variants.find(x => x.id === c.id), f = st.record.facts.find(x => x.variants.includes(c.id));
    if (v && f) v.n = nextMajor(st.record, f.id, v.lang ?? 'en');
  }
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
    for (const k of differ) if (S.m.has(k)){ put(st, k, S.m.get(k)); clock[k] = S.c.get(k); }
    const src = by(S).sort((x, y) => (S.c.get(y)[0] > S.c.get(x)[0] ? 1 : -1))[0];
    mirror(st, idOf(src));
    const fin0 = keysOf(st);
    for (const k of g) if (fin0.has(k) && hashOf(k, fin0.get(k)) !== clock[k]?.[2]) clock[k] = [`${clock[k]?.[0] ?? ''}~`, clock[k]?.[0] ?? '', hashOf(k, fin0.get(k))];
    line(src, 'i1.group', S.m.get(src), S.m.get(src), L.m.get(src) ?? lost[0]?.[1], d => { for (const [k, o] of lost) put(d, k, o); });
  }
  const gone = [...out].filter(([, o]) => o instanceof Gone);
  if (gone.length) st.record.removed = Object.fromEntries(gone.map(([k, o]) => [k, o.removed])); else delete st.record.removed;
  // an edit only this copy has seen stays marked; one that came from, or is also in, the other copy is known to both
  for (const k of Object.keys(clock)) if (clock[k][3] && !(clock[k] === A.c.get(k) && B.c.get(k)?.[0] !== clock[k][0])) clock[k] = clock[k].slice(0, 3);
  const fin = keysOf(st);
  for (const c of copies) clock[c.k] = [c.stamp, null, hashOf(c.k, fin.get(c.k))];
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
