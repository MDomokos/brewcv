// Object clocks, and the merge of two copies of one record that both have them. Pure: no DOM, no I/O.
// The state is a set of objects, each under a key: fact:<id>, variant:<id>, section:<id>, <store>:<id> for a job, a school, a skill group and the other
// entries, resume:<id> (with its frozen text), document:<id>, round:<id>, basics.<field> and settings (the rest of the record). The import log is no object: two logs are joined as a union. A deleted object stays a key (its tombstone in
// record.removed), so a delete is an edit like any other.
// A clock is { keys: { <key>: { v: { <actor>: <counter> }, at, hash } }, seen: { <actor>: <counter> } }: a version vector for each object (for each device,
// the last of its saves this object has seen), the time of its last edit, and its hash; `seen` is the highest save of each device this copy has merged.

import { fnv } from '../store/store.js';
import { t, keyed } from '../i18n/index.js';
import { BODY_KEYS, dropProto } from './schema.js';
import { canon, resumeLabel, openSaved, groupOf, mirror } from './resumes.js';
import { tombstone, nextMajor, normText, compareN, versionsIn } from './record.js';
import { deleteClaim, deleteItem } from './career.js';
import { newResume } from './resume.js';

const STORES = BODY_KEYS.filter(k => k !== 'basics');
const NAMES = { fact: 'facts', variant: 'variants', section: 'sections' };      // the record's list of each kind; a store is its own name
const OWN = { resume: 'resumes', document: 'documents', round: 'rounds' };      // the lists that sit in the state beside the record
const KINDS = [...Object.keys(NAMES), ...STORES, ...Object.keys(OWN)];
const listName = kind => NAMES[kind] ?? kind;
const listOf = (s, kind) => (OWN[kind] ? s[OWN[kind]] : s.record?.[listName(kind)]);
const NOT_SETTINGS = new Set([...Object.values(NAMES), ...STORES, 'basics', 'removed', 'recordId', 'schema', 'meta']);
const kindOf = k => k.split(':')[0];
const idOf = k => k.slice(k.indexOf(':') + 1);
// shortcut: a section or a job deleted in a way that leaves no tombstone (the six delete functions do) comes back from a copy that still has it; upgrade by marking those deletes too.
// shortcut: a saved resume renamed is a new key, so a copy that still has the old name brings it back; upgrade by marking a rename.
// shortcut: an item with no string id (an imported entry the app never numbered) rides along from the newer copy, unmerged.

// What a deleted key holds in the map of a state.
class Gone { constructor(mark){ this.removed = mark; } }

export function keysOf(state = {}){
  const { record: r, frozen } = state, m = new Map();
  for (const kind of KINDS) for (const x of listOf(state, kind) ?? []) if (typeof x?.id === 'string')
    m.set(`${kind}:${x.id}`, kind === 'resume' && frozen?.[x.id] ? { ...x, frozen: frozen[x.id] } : x);
  if (!r) return m;
  for (const [f, v] of Object.entries(r.basics ?? {})) m.set(`basics.${f}`, v);
  m.set('settings', Object.fromEntries(Object.entries(r).filter(([k]) => !NOT_SETTINGS.has(k))));
  for (const [k, mark] of Object.entries(r.removed ?? {})) if (!m.has(k)) m.set(k, new Gone(mark));
  return m;
}

// A version's metrics are a cache each device measures for itself, a resume's frozen text is what it printed when it was last saved here, and a
// claim's list of versions is merged as a list: none of them is an edit. A document's original (its bytes) is not hashed, only whether it has one.
const SKIP = { variant: 'metrics', fact: 'variants', resume: 'frozen', document: 'embedded' };
// A document's addedAt is not hashed either: a merge gives the earliest, and that must not change which copy is the newer.
const hashOf = (k, o) => { const s = SKIP[kindOf(k)]; return fnv(JSON.stringify(canon(s ? { ...o, [s]: s === 'embedded' && o[s] ? 1 : undefined, ...(s === 'embedded' && { addedAt: undefined }) } : o))); };
// the document that a merge keeps has the earliest addedAt of the copies
const earliest = (o, a, b) => (o instanceof Gone || !('addedAt' in o) ? o : { ...o, addedAt: [a.addedAt, b.addedAt].sort()[0] });
const J = x => JSON.stringify(x);
const FROM_FILE = o => J(canon({ ...o, addedAt: 0, name: 0, path: 0, size: 0, type: 0, embedded: o.embedded ? 1 : 0 }));      // a document without what the file itself says
const EPOCH = '1970-01-01T00:00:00.000Z';

// The clock for `state` now. A save that changed something is the next save of this device: each object whose hash changed (a new one too) gets that
// counter for this device in its vector and the time of the edit. Edits between two saves are one edit.
export function tick(clock, state, actor, now = Date.now()){
  const keys = {};
  let n = null;
  for (const [k, o] of keysOf(state)){
    const h = hashOf(k, o), e = clock?.keys?.[k];
    if (e?.hash === h){ keys[k] = e; continue; }
    n ??= (clock?.seen?.[actor] ?? 0) + 1;
    keys[k] = { v: { ...e?.v, [actor]: n }, at: new Date(now).toISOString(), hash: h };
  }
  return { keys, seen: n === null ? { ...clock?.seen } : { ...clock?.seen, [actor]: n } };
}
// A state taken from something with no clock: everything in it is the common start, which no device's edit is older than.
export const baseline = state => ({ keys: Object.fromEntries([...keysOf(state)].map(([k, o]) => [k, { v: { base: 1 }, at: EPOCH, hash: hashOf(k, o) }])), seen: {} });
// A copy opened in place of this one: its clock is this copy's now, with this device's own count kept so no save is counted twice, and what it changed
// here counts as an edit that has seen both (the later, over a copy that still has the text it replaced).
// shortcut: an object this copy had and the opened one lacks is not counted as deleted (a copy that still has it brings it back); upgrade by marking it.
export function opened(file, prev, state, actor, now = Date.now()){
  const c = { keys: { ...file.keys }, seen: { ...file.seen, [actor]: Math.max(prev?.seen?.[actor] ?? 0, file.seen?.[actor] ?? 0) } };
  for (const [k, e] of Object.entries(c.keys)){ const p = prev?.keys?.[k]; if (p && p.hash !== e.hash) c.keys[k] = { v: join(p.v, e.v), at: e.at, hash: p.hash }; }
  return tick(c, state, actor, now);
}
// This device's own count is at least every count of it in its clock (a clock that lost its `seen` must not start over).
export const floored = (clock, actor) => ({ keys: clock.keys, seen: { ...clock.seen, [actor]: Math.max(clock.seen?.[actor] ?? 0, ...Object.values(clock.keys).map(e => e.v[actor] ?? 0)) } });
// Does the other clock hold saves of this device's own actor that this copy never made (two browsers on one actor, a rolled-back storage)? Then this copy needs another
// actor id before they meet, so the two lines of edits are told apart.
// Only keys this copy already has count: an object a split renamed carries the original's vector, and is no sign of another browser.
export const foreign = (mine, theirs, actor) => !!theirs && ((theirs.seen[actor] ?? 0) > (mine.seen[actor] ?? 0) || Object.entries(theirs.keys).some(([k, e]) => mine.keys[k] && (e.v[actor] ?? 0) > (mine.keys[k].v[actor] ?? 0)));
// A clock with one actor called another everywhere: this copy's earlier edits, made under the old name, are then not ones the other copy's saves of it have seen.
export const renameActor = (clock, from, to) => {
  const re = v => Object.fromEntries(Object.entries(v).map(([a, n]) => [a === from ? to : a, n]));
  return { keys: Object.fromEntries(Object.entries(clock.keys).map(([k, e]) => [k, { ...e, v: re(e.v) }])), seen: re(clock.seen) };
};

// A clock read from a file or storage: only entries that are what tick() makes (devices, whole counters, a real date). A garbled one would stop every later tick.
const MAXN = 2 ** 40;      // no device saves that often; a count near the top of what a number holds would stop every later save
const okActor = a => /^[\w-]{1,16}$/.test(a);
const okAt = s => typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) && Number.isFinite(Date.parse(s));
const isMap = x => !!x && typeof x === 'object' && !Array.isArray(x);
const okEntry = e => isMap(e) && isMap(e.v) && Object.entries(e.v).every(([a, n]) => okActor(a) && Number.isSafeInteger(n) && n >= 1 && n <= MAXN) && okAt(e.at) && typeof e.hash === 'string';
export const cleanClock = c => (isMap(c) && isMap(c.keys)
  ? { keys: Object.fromEntries(Object.entries(c.keys).filter(([, e]) => okEntry(e))), seen: Object.fromEntries(Object.entries(isMap(c.seen) ? c.seen : {}).filter(([a, n]) => okActor(a) && Number.isSafeInteger(n) && n >= 0 && n <= MAXN)) }
  : null);
// Does the clock say what is in the state? A file with a changed object under its old clock was edited outside, and is not merged by clock.
export const clockFits = (state, clock) => !!clock?.keys && [...keysOf(state)].every(([k, o]) => clock.keys[k]?.hash === hashOf(k, o));

// One vector covers another when it is at least as high for every device: that copy has seen every edit the other made.
const covers = (x, y) => Object.entries(y.v).every(([a, n]) => (x.v[a] ?? 0) >= n);
const join = (x, y) => Object.fromEntries([...new Set([...Object.keys(x), ...Object.keys(y)])].sort().map(a => [a, Math.max(x[a] ?? 0, y[a] ?? 0)]));
// Newer, for a conflict only: the later edit, then the higher hash (what was written, not who has met whom), so every device picks the same one
const newer = (x, y) => (x.at !== y.at ? x.at > y.at : x.hash !== y.hash ? x.hash > y.hash : J(x.v) >= J(y.v));
// two objects made on two devices that never met: no device is in both vectors
const fresh = (x, y) => Object.keys(x.v).length > 0 && Object.keys(y.v).length > 0 && !Object.keys(x.v).some(a => a in y.v);

const clip = (s, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
function label(k, o){
  if (k === 'settings') return t('set.title');
  if (k.startsWith('basics.')) return k.slice(7);
  if (kindOf(k) === 'resume') return resumeLabel(o);
  if (kindOf(k) === 'document') return clip(String(o?.name ?? idOf(k)));      // its `text` is the whole file's
  return clip(String(o?.text ?? o?.summary ?? o?.name ?? o?.position ?? o?.title ?? o?.institution ?? o?.language ?? idOf(k)));
}
const show = (k, o) => (o instanceof Gone ? t('i1.gone') : o && typeof o === 'object' ? clip(String((kindOf(k) === 'document' ? null : o.text) ?? label(k, o)), 90) : String(o ?? ''));

// ---- putting and taking an object in a state { record, resumes, frozen, documents, rounds }; the undo of a summary line is one of these ----
const into = (list, x) => { const i = list.findIndex(y => y?.id === x.id); if (i < 0) list.push(x); else { if (x.variants && list[i].variants) x.variants = list[i].variants; list[i] = x; } };
function put(d, k, o){
  const x = structuredClone(o);
  if (k === 'settings'){ for (const f of Object.keys(d.record)) if (!NOT_SETTINGS.has(f)) delete d.record[f]; Object.assign(d.record, x); }
  else if (!k.includes(':')) (d.record.basics ??= {})[k.slice(7)] = x;
  else if (kindOf(k) === 'resume'){
    const { frozen, ...r } = x;
    into(d.resumes ??= [], r);
    if (frozen) (d.frozen ??= {})[idOf(k)] = frozen; else delete d.frozen?.[idOf(k)];
  } else if (OWN[kindOf(k)]) into(d[OWN[kindOf(k)]] ??= [], x);
  else into(d.record[listName(kindOf(k))] ??= [], x);
}
function drop(d, k){
  const kind = kindOf(k), id = idOf(k);
  if (!KINDS.includes(kind)) return;      // a mark for something that is not an object here (a sent copy)
  if (OWN[kind]){ d[OWN[kind]] = (d[OWN[kind]] ?? []).filter(r => r.id !== id); if (kind === 'resume') delete d.frozen?.[id]; return; }
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
const union = (a, b) => { const seen = new Set(a.map(J)); return [...a, ...b.filter(x => !seen.has(J(x)))]; };
// The two versions of one entry, section or the settings as one where that loses nothing: the lists of ids (a bullet only one side added to a job, a
// job or a certificate to a section) and the lists of tags, job types and languages. The first one's order and other fields.
function joined(k, w, l, live){
  const o = structuredClone(w);
  if (k === 'settings'){
    for (const [at, other, key] of [[o.vocabulary, l.vocabulary, 'tags'], [o, l, 'jobTypes'], [o, l, 'langs']])
      if (Array.isArray(at?.[key]) && Array.isArray(other?.[key])) at[key] = union(at[key], other[key]);
    return o;
  }
  for (const [at, other, key] of [[o, l, 'highlights'], ...['work', 'items', 'groups', 'pairs'].map(f => [o.content, l.content, f])])
    if (Array.isArray(at?.[key]) && Array.isArray(other?.[key])) at[key] = weave(at[key], other[key]).filter(id => live.has(id));
  return o;
}
const idLists = state => {
  const m = new Map();
  for (const kind of KINDS) m.set(kind, (listOf(state, kind) ?? []).map(x => x?.id).filter(i => typeof i === 'string'));
  for (const f of state.record?.facts ?? []) m.set(`@${f.id}`, [...(f.variants ?? [])]);      // a claim's versions
  return m;
};
// The ids a list holds, edited by `fn`, wherever `id` is a version or an item of that kind
const relist = (s, kind, id, fn) => {
  for (const [name, ids] of s.l) if ((name === kind || (kind === 'variant' && name[0] === '@')) && ids.includes(id)) s.l.set(name, fn(ids));
};

// A copy of the state with its entries: an entry that agrees with the object, else "no device's edit is known" (an empty vector).
const mkSide = (state, m, c, seen) => ({ state, m, c, seen, l: idLists(state), top: [...c.values()].reduce((x, e) => (e.at > x ? e.at : x), '') });
const side = ({ state, clock }) => {
  const m = keysOf(state), k = cleanClock(clock);
  return mkSide(state, m, new Map([...m].map(([key, o]) => { const h = hashOf(key, o), e = k?.keys[key]; return [key, e?.hash === h ? e : { v: {}, at: EPOCH, hash: h }]; })), k?.seen ?? {});
};
// a copy of a version made by a merge: the id ends in a hash
const COPY = /-v[\d-]+(?:-[a-z]{2})?(?:-alt)?-[0-9a-f]{6}$/;
const KEYS = { alt: 'i1.alt', both: 'i1.both', newer: 'i1.newer', revived: 'i1.revived', group: 'i1.group' };

// Every id (and key of an object) in a copy that the map names, renamed: the references to an object that was given another id
function renamed(S, ren){
  const rn = (x, top = false) => (Array.isArray(x) ? x.map(y => rn(y)) : isMap(x) ? Object.fromEntries(Object.entries(x).map(([k, v]) => [top ? k : ren.get(k) ?? k, rn(v)])) : typeof x === 'string' ? ren.get(x) ?? x : x);
  const state = { ...S.state, record: rn(S.state.record, true), resumes: rn(S.state.resumes ?? []), frozen: rn(S.state.frozen ?? {}), ...(S.state.documents && { documents: rn(S.state.documents) }) };      // a document points at its resume
  const m = keysOf(state), back = new Map([...ren].map(([a, b]) => [b, a]));
  const c = new Map([...m].map(([k, o]) => {
    const old = k.includes(':') ? `${kindOf(k)}:${back.get(idOf(k)) ?? idOf(k)}` : k;
    return [k, { ...S.c.get(old), hash: hashOf(k, o) }];
  }));
  return mkSide(state, m, c, S.seen);
}
// The raw delete of what a split made, when the model's own delete does not know the kind
function forget(d, ids){
  for (const id of ids){
    const store = STORES.find(s => (d.record[s] ?? []).some(x => x.id === id));
    try {
      if (store && store !== 'work') deleteItem(d.record, store, id, d.resumes ?? []);
      else if (!store && d.record.facts?.some(f => f.id === id)) deleteClaim(d.record, id, d.resumes ?? []);
      else throw new Error('raw');
    } catch {
      for (const kind of KINDS){
        const list = listOf(d, kind), x = (list ?? []).find(y => y.id === id);
        if (!x) continue;
        if (kind === 'fact') for (const v of x.variants ?? []) forget(d, [v]);
        drop(d, `${kind}:${id}`);
        if (!OWN[kind]) tombstone(d.record, kind, id, x);
      }
    }
  }
}

// mine, theirs: { state: { record, resumes, frozen, documents?, rounds?, imports? }, clock }. Whichever way round, the same state comes out. summary: one line for each thing both
// copies changed, { key, kind, what, kept, other, undo }, where undo(d) puts the other back in a state d the way a diffRecords item's apply does.
// A copy that loaded but is damaged inside (a field that holds a string where an object goes) is the model's "not a backup", not a TypeError.
export function merge(mine, theirs){
  try { return mergeOf(mine, theirs); }
  catch (e){ throw e?.key ? e : keyed('error.notBackup'); }
}
function mergeOf(mine, theirs){
  dropProto(theirs);      // the other copy comes from a file
  let A = side(mine), B = side(theirs);
  const summary = [], pending = [];      // pending: the splits, whose lines come once the copies are renamed

  // two new objects with one id but different content: the newer keeps the id, the other copy's gets <id>-<6 of its hash> and everything of that copy that
  // points at it follows. A claim, and the versions it lists, go together.
  // shortcut: three or more copies that each made a job (and its claims) under one id can end in different states by the order they meet, because the new id comes from the hash of what the object is by then, and a job's changes with the ids of its claims; two copies, and any number that made a certificate or a version, converge. Upgrade by naming a split from the object's first vector entry.
  const splits = new Map();
  for (const k of [...A.m.keys()].filter(k => B.m.has(k)).sort()){
    const kind = kindOf(k), a = A.m.get(k), b = B.m.get(k), ea = A.c.get(k), eb = B.c.get(k), id = idOf(k);
    if (!k.includes(':') || kind === 'section' || kind === 'document' || kind === 'round' || a instanceof Gone || b instanceof Gone || ea.hash === eb.hash || !fresh(ea, eb) || splits.has(id) || (kind === 'variant' && normText(a.text) === normText(b.text))) continue;
    const lose = newer(ea, eb) ? B : A, h6 = (lose === A ? ea : eb).hash.slice(0, 6);
    splits.set(id, { lose, h6, key: k });
  }
  // a document or a round with one id on both sides is the same one (one file is one document everywhere): not a split. A document's details join silently, a round's are a plain value.
  // shortcut: nothing deletes a document or a round yet, so neither has a mark; upgrade with the Library's remove (I-7).
  // shortcut: a section made on both sides (the certified list, each device's first certificate) is one section, its lists joined, not two; upgrade if sections ever need to be kept apart.
  if (splits.size){
    const A0 = A, B0 = B, maps = new Map([[A0, new Map()], [B0, new Map()]]);
    const newId = (id, h6) => (id.endsWith('.json') ? id.replace(/\.json$/, `-${h6}.json`) : `${id}-${h6}`);
    for (const [id, { lose, h6 }] of splits){ maps.get(lose).set(id, newId(id, h6)) }
    for (const [id, { lose, h6 }] of splits){      // a job or project takes its title and meta claims with it, and a claim its versions
      const ren = maps.get(lose);
      for (const d of Object.values(STORES.flatMap(s => lose.state.record?.[s] ?? []).find(x => x.id === id)?.display ?? {})) if (typeof d === 'string' && !ren.has(d)) ren.set(d, `${d}-${h6}`);
      for (const from of [...ren.keys()]) for (const vid of lose.state.record?.facts?.find(f => f.id === from)?.variants ?? []) if (!ren.has(vid)) ren.set(vid, `${vid}-${h6}`);
    }
    for (const [s, ren] of maps) if (ren.size){ if (s === A0) A = renamed(s, ren); else B = renamed(s, ren); }
    for (const [id, { lose, h6, key }] of splits){
      const nk = `${kindOf(key)}:${newId(id, h6)}`, loser = lose === A0 ? A : B, win = lose === A0 ? B : A;
      if (!win.m.has(nk)) pending.push({ id, key, nk, ren: maps.get(lose), win, lose: loser });      // else it was split before
    }
  }
  const [N, O] = (A.top !== B.top ? A.top > B.top : J(A.state) >= J(B.state)) ? [A, B] : [B, A];      // the copy with the later edit (else the later text) sets the order and what is not a key
  const out = new Map(), clock = {}, joins = [], from = new Map();      // from: which copy an object came from
  const set = (k, o, e, s = null) => { out.set(k, o); clock[k] = e; from.set(k, s); };
  const line = (k, kind, lab, kept, other, undo, texts = null) => summary.push({ key: k, kind, what: t(KEYS[kind], { what: label(k, lab) }), kept: texts?.[0] ?? show(k, kept), other: texts?.[1] ?? show(k, other), undo });
  const unDelete = (k, o) => d => (kindOf(k) === 'fact' ? deleteClaim(d.record, idOf(k), d.resumes ?? []) : (drop(d, k), tombstone(d.record, kindOf(k), idOf(k), o)));
  for (const { key, nk, ren, win, lose } of pending){
    const o = lose.m.get(nk), ids = [...ren.values()];
    line(nk, 'both', o, win.m.get(key), o, d => forget(d, ids));
  }

  for (const k of [...new Set([...A.m.keys(), ...B.m.keys()])].sort()){
    const a = A.m.get(k), b = B.m.get(k), ea = A.c.get(k), eb = B.c.get(k);
    if (!ea || !eb){ set(k, ea ? a : b, ea ?? eb, ea ? A : B); continue; }
    const v = join(ea.v, eb.v), x = covers(ea, eb), y = covers(eb, ea);
    if (ea.hash === eb.hash){ set(k, kindOf(k) === 'document' ? earliest(newer(ea, eb) ? a : b, a, b) : newer(ea, eb) ? a : b, { v, at: ea.at > eb.at ? ea.at : eb.at, hash: ea.hash }, newer(ea, eb) ? A : B); continue; }
    if (x !== y){ const w = x ? [a, ea, A] : [b, eb, B]; set(k, w[0], { v, at: w[1].at, hash: w[1].hash }, w[2]); continue; }      // one has seen every edit of the other: it is the later
    // both changed it
    const kind = kindOf(k), id = idOf(k), gone = [a instanceof Gone, b instanceof Gone];
    // a delete against an edit that has not seen it: the edit wins, and it brings the object back
    const aw = gone[0] !== gone[1] ? gone[1] : newer(ea, eb), [w, l, ew, S] = aw ? [a, b, ea, A] : [b, a, eb, B];
    set(k, w, { v, at: ew.at, hash: ew.hash }, S);
    if (gone[0] && gone[1]) continue;
    if (gone[0] !== gone[1]){ line(k, 'revived', w, w, l, unDelete(k, w)); continue; }
    // one file is one document: the winner has the earliest addedAt, and when only what the file itself says differs (its name, where it is) there is no line
    if (kind === 'document'){
      set(k, earliest(w, a, b), { v, at: ew.at, hash: ew.hash }, S);
      if (FROM_FILE(a) === FROM_FILE(b)) continue;
    }
    const wording = kind === 'variant' && normText(a.text) !== normText(b.text);
    if (wording){
      // keep both: the other text becomes a version under an id every device makes the same
      const nid = `${id}-alt-${(aw ? eb : ea).hash.slice(0, 6)}`, nk = `variant:${nid}`;
      if (A.m.has(nk) || B.m.has(nk)) continue;      // merged before
      const copy = { ...l, id: nid };
      set(nk, copy, { v: { base: 1 }, at: (aw ? eb : ea).at, hash: '' }, aw ? B : A);      // the common start (the same whichever order the copies met in); its hash once it is in the state
      for (const s of [A, B]) relist(s, kind, id, ids => ids.flatMap(y => (y === id ? [y, nid] : [y])));      // beside the one it is another text of
      line(nk, 'alt', l, w, l, d => { drop(d, nk); tombstone(d.record, kind, nid, copy); });      // the mark keeps the next merge from bringing it back
      continue;
    }
    // a plain value
    // shortcut: any other field changed on both sides of a job, claim or section keeps the newer one whole, and the line lists the other; upgrade by merging field by field.
    // shortcut: a tag, job type or language deleted on one side comes back when the settings were changed on both; upgrade with marks for those.
    if (STORES.includes(kind) || kind === 'section' || k === 'settings') joins.push({ k, l });
    const keys = k === 'settings' ? [...new Set([...Object.keys(w), ...Object.keys(l)])].filter(f => J(w[f]) !== J(l[f])) : null;
    line(k, 'newer', w, w, l, d => put(d, k, l), keys && [keys.map(f => `${f}: ${clip(J(w[f]), 40)}`).join('; '), keys.map(f => `${f}: ${clip(J(l[f]), 40)}`).join('; ')]);
  }

  // a deleted claim or version the other copy built on later comes back: the later edit wins, and a claim needs its versions
  const aliveOut = k => out.has(k) && !(out.get(k) instanceof Gone);
  const revive = k => {
    const s = [A, B].find(s => s.m.has(k) && !(s.m.get(k) instanceof Gone)), o = s?.m.get(k);
    if (!o) return false;
    const e = s.c.get(k), z = (s === A ? B : A).c.get(k);
    set(k, o, { v: join(e.v, z?.v ?? {}), at: e.at, hash: e.hash }, s);
    line(k, 'revived', o, o, new Gone(null), unDelete(k, o));
    if (kindOf(k) === 'fact') backInJob(k);
    return true;
  };
  const backInJob = k => {      // a claim that is back is back in the job that had it
    for (const [k2, cur] of [...out]){
      if (cur instanceof Gone || !Array.isArray(cur.highlights) || cur.highlights.includes(idOf(k))) continue;
      const src = [A, B].map(x => x.m.get(k2)).find(x => x && !(x instanceof Gone) && x.highlights?.includes(idOf(k)));
      if (src) out.set(k2, { ...cur, highlights: weave(cur.highlights, src.highlights).filter(x => x === idOf(k) || cur.highlights.includes(x)) });
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
  const listed = fid => weave(N.l.get(`@${fid}`) ?? [], O.l.get(`@${fid}`) ?? []), lang = id => [A, B].map(x => x.m.get(`variant:${id}`)).find(x => x && !(x instanceof Gone))?.lang ?? 'en';
  const hasEn = fid => listed(fid).some(id => aliveOut(`variant:${id}`) && lang(id) === 'en');
  // shortcut: the repairs that keep a claim whole (a claim with no version left is deleted, or one of its deleted versions is brought back) decide from the copies met so far, so four or more copies deleting versions and claims at once can end in different states by order (2 in 600 random runs); upgrade by deciding them from the vectors of all the copies at once.
  // a claim one copy deleted that the other only touched (a version deleted, say) and that has no version left is deleted: there is nothing to bring back
  for (const k of [...out.keys()].filter(k => kindOf(k) === 'fact' && aliveOut(k) && [A, B].some(x => x.m.get(k) instanceof Gone) && !hasEn(idOf(k)))){
    const gs = [A, B].find(x => x.m.get(k) instanceof Gone), ge = gs.c.get(k), other = (gs === A ? B : A).c.get(k);
    set(k, gs.m.get(k), { v: join(ge.v, other?.v ?? {}), at: ge.at, hash: ge.hash }, gs);
    for (let i = summary.length; i--;) if (summary[i].key === k) summary.splice(i, 1);
    for (const id of listed(idOf(k))){      // and so are the versions it has left, in other languages
      const vk = `variant:${id}`, o = out.get(vk);
      if (!aliveOut(vk)) continue;
      const mark = new Gone({ at: String(ge.at).slice(0, 10), hash: fnv(normText(o.text)) });
      set(vk, mark, { v: join(clock[vk].v, ge.v), at: ge.at, hash: hashOf(vk, mark) }, gs);
      for (let i = summary.length; i--;) if (summary[i].key === vk) summary.splice(i, 1);
    }
  }
  for (const k of [...out.keys()].filter(k => kindOf(k) === 'fact' && aliveOut(k))){
    const ids = listed(idOf(k));
    if (ids.length && !hasEn(idOf(k))){      // two copies each deleted a different version: one of them stays
      const back = ids.filter(id => out.get(`variant:${id}`) instanceof Gone && lang(id) === 'en').sort((x, y) => (clock[`variant:${y}`]?.at ?? '').localeCompare(clock[`variant:${x}`]?.at ?? '') || x.localeCompare(y))[0];
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
  const st = structuredClone({ record: N.state.record, resumes: N.state.resumes ?? [], frozen: N.state.frozen ?? {}, ...(N.state.documents?.length && { documents: N.state.documents }), ...(N.state.rounds?.length && { rounds: N.state.rounds }) });
  for (const [k, o] of out) if (!N.c.has(k) || (o !== N.m.get(k) && (hashOf(k, o) !== N.c.get(k).hash || o.addedAt !== N.m.get(k).addedAt))) (o instanceof Gone ? drop : put)(st, k, o);      // the newer copy's own object stays, even when the other's has the same hash
  // a resume's frozen text is no edit, so when both copies hold the same resume it comes from the later edit (else the longer text), not from whichever copy sets the order
  for (const k of out.keys()){
    const a = A.m.get(k), b = B.m.get(k), ea = A.c.get(k), eb = B.c.get(k);
    if (kindOf(k) !== 'resume' || !ea || !eb || ea.hash !== eb.hash || a instanceof Gone || b instanceof Gone) continue;
    const src = ea.at !== eb.at ? (ea.at > eb.at ? a : b) : (J(a.frozen ?? null) >= J(b.frozen ?? null) ? a : b);
    if (src.frozen) (st.frozen ??= {})[idOf(k)] = structuredClone(src.frozen); else delete st.frozen?.[idOf(k)];
  }
  // a bullet whose claim was deleted is not in a job, whichever copy's job won
  for (const store of ['work', 'projects', 'volunteer']) for (const w of st.record[store] ?? [])
    if (Array.isArray(w.highlights)) w.highlights = w.highlights.filter(h => !(out.get(`fact:${h}`) instanceof Gone));
  const alive = (kind, id) => aliveOut(`${kind}:${id}`);
  const order = (name, kind) => weave(N.l.get(name) ?? [], O.l.get(name) ?? []).filter(id => alive(kind, id));
  for (const kind of KINDS){
    const arr = listOf(st, kind);
    const rank = new Map(order(kind, kind).map((id, i) => [id, i]));
    arr?.sort((x, y) => (rank.get(x.id) ?? 1e9) - (rank.get(y.id) ?? 1e9));
  }
  for (const f of st.record.facts ?? []) f.variants = order(`@${f.id}`, 'variant');
  st.documents?.sort((x, y) => (x.id < y.id ? -1 : 1));      // one order whichever copies met first
  // jobs go by their dates, as addJob puts them, and by id where the dates are the same
  st.record.work?.sort((x, y) => String(y.endDate ?? '9999').localeCompare(String(x.endDate ?? '9999')) || String(y.startDate).localeCompare(String(x.startDate)) || (x.id < y.id ? -1 : 1));

  // a language group is one unit: when each copy changed a different member, the copy with the later edit gives all of it, mirror() brings the
  // members in step, and what the other copy changed is one line with its Undo
  const seen = new Set();
  for (const r of st.resumes){
    if (seen.has(r.id)) continue;
    const g = groupOf(st, r).map(x => `resume:${x.id}`);
    g.forEach(k => seen.add(idOf(k)));
    const differ = g.filter(k => A.c.has(k) && B.c.has(k) && A.c.get(k).hash !== B.c.get(k).hash);
    const by = s => differ.filter(k => from.get(k) === s);
    const top = s => by(s).reduce((m, k) => (s.c.get(k).at > m ? s.c.get(k).at : m), '');
    if (g.length < 2 || !by(A).length || !by(B).length) continue;
    const [S, L] = top(A) > top(B) ? [A, B] : top(A) < top(B) ? [B, A] : [N, O];
    const lost = g.filter(k => L.m.has(k)).map(k => [k, L.m.get(k)]);
    for (let i = summary.length; i--;) if (differ.includes(summary[i].key)) summary.splice(i, 1);      // the group's one line says it
    for (const k of differ) if (S.m.has(k)){ put(st, k, S.m.get(k)); const e = S.c.get(k); clock[k] = { v: join(e.v, L.c.get(k)?.v ?? {}), at: e.at, hash: e.hash }; }
    const src = by(S).sort((x, y) => (S.c.get(y).at > S.c.get(x).at ? 1 : -1))[0];
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
    // a language that had a default in either copy and has a version again has one (a version that comes back later must not stay without)
    for (const lang of new Set([...Object.keys(f.default ?? {}), ...[A, B].flatMap(x => Object.keys(x.m.get(`fact:${f.id}`)?.default ?? {}))])){
      const left = !f.default?.[lang] && versionsIn(st.record, f.id, lang);
      if (left?.length) (f.default ??= {})[lang] = left[0].id;
    }
    const byN = new Map();
    for (const v of vs) if (v.n !== undefined) (byN.get(`${v.lang ?? 'en'} ${v.n}`) ?? byN.set(`${v.lang ?? 'en'} ${v.n}`, []).get(`${v.lang ?? 'en'} ${v.n}`)).push(v);
    for (const dup of byN.values()) if (dup.length > 1){      // the oldest edit keeps it, a copy of a merge last
      const at = v => clock[`variant:${v.id}`]?.at ?? '';
      dup.sort((x, y) => COPY.test(x.id) - COPY.test(y.id) || (at(x) < at(y) ? -1 : at(x) > at(y) ? 1 : 0) || (x.id < y.id ? -1 : 1));
      for (const v of dup.slice(1)) v.n = nextMajor(st.record, f.id, v.lang ?? 'en');
    }
    // a claim's versions in one order whichever copies met first (the number, then the language and id): the page sorts them by number anyway
    const lg = id => byId.get(id)?.lang ?? 'en';
    f.variants.sort((x, y) => compareN(byId.get(x)?.n, byId.get(y)?.n) || (lg(x) < lg(y) ? -1 : lg(x) > lg(y) ? 1 : 0) || (x < y ? -1 : 1));
  }

  const gone = [...out].filter(([, o]) => o instanceof Gone).sort(([x], [y]) => (x < y ? -1 : 1));
  if (gone.length) st.record.removed = Object.fromEntries(gone.map(([k, o]) => [k, o.removed])); else delete st.record.removed;
  // what the merge itself wrote (a copy, a joined list, a mirrored resume, a renumbered version) counts as no edit: the vector stays, the hash is what is there
  for (const [k, o] of keysOf(st)){
    const h = hashOf(k, o), e = clock[k];
    if (e && e.hash !== h) clock[k] = { ...e, hash: h };
  }
  const seenAll = join(A.seen, B.seen);
  // the import log only grows: both logs, each entry once, in one order (a log that is new to this copy counts as a change, so it is committed)
  const log = [...new Map([...(A.state.imports ?? []), ...(B.state.imports ?? [])].map(e => [J(e), e])).values()].sort((x, y) => (String(x.at) < String(y.at) ? -1 : String(x.at) > String(y.at) ? 1 : 0) || (J(x) < J(y) ? -1 : 1));
  if (log.length) st.imports = log;
  const logged = J(log) !== J(A.state.imports ?? []);      // `changed` counts it, so it is committed; `logged` lets a screen leave it out of what it tells
  const changed = [...out.keys()].filter(k => clock[k]?.hash !== A.c.get(k)?.hash).length + (logged ? 1 : 0);
  return { state: st, clock: { keys: clock, seen: seenAll }, summary, changed, logged };
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
