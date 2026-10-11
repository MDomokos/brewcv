// One state object: every change goes through commit() and is undoable.
// Undo keeps whole-state snapshots. Commits with the same label within 800 ms
// coalesce, so typing a sentence is one step.
// data:image/ strings over 1 KB become "asset:<id>" refs kept outside the snapshots
// (a ~60 KB photo over 200 steps would be 12 MB). materialize() puts them back.

const ASSET_MIN = 1024;
const ASSET_RE = /^data:image\//;
export const isAssetRef = s => typeof s === 'string' && s.startsWith('asset:');

function fnv(s){
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export const assetId = dataUrl => `asset:${fnv(dataUrl)}-${dataUrl.length.toString(36)}`;

function deepFreeze(o){
  if (o && typeof o === 'object' && !Object.isFrozen(o)){
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

function internalize(node, assets){
  if (Array.isArray(node)){
    node.forEach((x, i) => {
      if (typeof x === 'string' && x.length > ASSET_MIN && ASSET_RE.test(x)){ const id = assetId(x); assets.set(id, x); node[i] = id; }
      else internalize(x, assets);
    });
  } else if (node && typeof node === 'object'){
    for (const k of Object.keys(node)){
      const x = node[k];
      if (typeof x === 'string' && x.length > ASSET_MIN && ASSET_RE.test(x)){ const id = assetId(x); assets.set(id, x); node[k] = id; }
      else internalize(x, assets);
    }
  }
  return node;
}

export function assetRefs(node, out = new Set()){
  if (isAssetRef(node)) out.add(node);
  else if (node && typeof node === 'object') for (const v of Object.values(node)) assetRefs(v, out);
  return out;
}

export function createStore(initial = {}, opts = {}){
  const steps = opts.steps ?? 200;
  const maxBytes = opts.maxBytes ?? 32e6;
  const coalesceMs = opts.coalesceMs ?? 800;
  const now = opts.now ?? (() => Date.now());
  const settle = opts.settle ?? null;       // runs on the draft inside every commit, so its writes are part of the same undo step

  const assets = new Map(opts.assets ?? []);
  const subs = new Set();
  let undoS = [], redoS = [], undoBytes = 0;
  let last, state;

  const snap = (obj, label) => {
    const json = JSON.stringify(obj);
    return { json, label, at: now(), bytes: json.length * 2 };
  };
  const setLast = (s) => { last = s; state = deepFreeze(JSON.parse(s.json)); };
  const emit = (kind, label) => { for (const fn of subs) fn({ kind, label, state }); };
  const trim = () => {
    while (undoS.length > steps || (undoBytes > maxBytes && undoS.length)){
      undoBytes -= undoS.shift().bytes;
    }
  };

  setLast(snap(internalize(JSON.parse(JSON.stringify(initial)), assets), 'open'));

  const store = {
    get state(){ return state; },

    // fn(draft) mutates a deep copy. Returns true if anything changed.
    commit(fn, label = 'Edit'){
      const draft = JSON.parse(last.json);
      const ret = fn(draft);
      const out = ret !== undefined && ret !== draft && typeof ret === 'object' ? ret : draft;
      settle?.(out);
      const next = internalize(out, assets);
      const s = snap(next, label);
      if (s.json === last.json) return false;
      const coalesce = label === last.label && s.at - last.at < coalesceMs && !redoS.length && undoS.length > 0 && last.label !== 'open';
      if (!coalesce){ undoS.push(last); undoBytes += last.bytes; }
      redoS = [];
      setLast(s);
      trim();
      emit('commit', label);
      return true;
    },

    replace(next, label = 'Replace'){
      return store.commit(() => JSON.parse(JSON.stringify(next)), label);
    },

    undo(){
      if (!undoS.length) return null;
      const label = last.label;
      redoS.push(last);
      const prev = undoS.pop(); undoBytes -= prev.bytes;
      setLast({ ...prev, at: 0 });             // at 0: the next commit never coalesces into it
      emit('undo', label);
      return label;
    },
    redo(){
      if (!redoS.length) return null;
      const next = redoS.pop();
      undoS.push({ ...last }); undoBytes += last.bytes;
      setLast({ ...next, at: 0 });
      trim();
      emit('redo', next.label);
      return next.label;
    },

    get history(){
      return { undo: undoS.length, redo: redoS.length,
        next: undoS.length ? last.label : null,
        nextRedo: redoS.length ? redoS.at(-1).label : null,
        bytes: undoBytes };
    },

    // A new baseline (open a record, restore a session). Clears undo.
    reset(next, label = 'open'){
      undoS = []; redoS = []; undoBytes = 0;
      setLast({ ...snap(internalize(JSON.parse(JSON.stringify(next)), assets), label), label: 'open' });
      emit('reset', label);
    },

    subscribe(fn){ subs.add(fn); return () => subs.delete(fn); },

    addAsset(dataUrl){ const id = assetId(dataUrl); assets.set(id, dataUrl); return id; },
    asset(ref){ return assets.get(ref); },
    get assets(){ return new Map(assets); },
    loadAssets(entries){ for (const [k, v] of entries) assets.set(k, v); },

    materialize(value = state){
      const out = JSON.parse(JSON.stringify(value ?? null));
      const put = node => {
        if (Array.isArray(node)) node.forEach((x, i) => { if (isAssetRef(x) && assets.has(x)) node[i] = assets.get(x); else put(x); });
        else if (node && typeof node === 'object') for (const k of Object.keys(node)){
          const x = node[k];
          if (isAssetRef(x) && assets.has(x)) node[k] = assets.get(x); else put(x);
        }
      };
      if (isAssetRef(out)) return assets.get(out) ?? out;
      put(out);
      return out;
    },

    // Drop assets nothing references, counting undo and redo too.
    gcAssets(){
      const live = assetRefs(state);
      for (const s of [...undoS, ...redoS]) for (const m of s.json.matchAll(/"(asset:[0-9a-f]{8}-[0-9a-z]+)"/g)) live.add(m[1]);
      for (const k of [...assets.keys()]) if (!live.has(k)) assets.delete(k);
    },
  };
  return store;
}
