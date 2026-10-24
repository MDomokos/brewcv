// The record's labels per language (model.i18n[lang].sections / labels / terms / fields) and the English text each was written against
// (model.i18n[lang].from[<kind>/<id>]). Pure: no DOM, no I/O.
// When the English moves on, a label whose `from` differs is listed as changed (missingList in lang.js, kind 'heading-changed').

// The English text a label translates: a section's title, a skill group's name, a language's name, or an entry's field (id "work/<job>/location").
export function englishOf(model, kind, id){
  if (kind === 'sections') return (model.sections ?? []).find(s => s.id === id)?.title;
  if (kind === 'labels') return (model.skills ?? []).find(s => s.id === id)?.name;
  if (kind === 'terms') return (model.languages ?? []).find(l => l.id === id)?.language;
  const [key, eid, field] = String(id).split('/');
  return Array.isArray(model[key]) ? model[key].find(x => x?.id === eid)?.[field] : undefined;
}

// Writes (or, with no text, removes) one label of a language, and the English text it was written against.
export function setI18n(model, lang, kind, id, text){
  model.i18n ??= {};
  const l = (model.i18n[lang] ??= {}), box = (l[kind] ??= {}), path = `${kind}/${id}`, v = String(text ?? '').trim(), en = englishOf(model, kind, id);
  if (v) box[id] = v; else delete box[id];
  if (v && typeof en === 'string' && en) (l.from ??= {})[path] = en; else if (l.from) delete l.from[path];
  if (l.from && !Object.keys(l.from).length) delete l.from;
}

// A label gone from the record (its skill group or language deleted) takes its `from` with it.
export function dropI18n(model, kind, id){
  for (const l of Object.values(model.i18n ?? {})){ if (l?.[kind]) delete l[kind][id]; if (l?.from) delete l.from[`${kind}/${id}`]; }
}

// The labels of `lang` whose English text has changed since they were written: [{ kind, id, path, was, now }]
export function staleI18n(model, lang){
  const out = [];
  for (const [path, was] of Object.entries(model.i18n?.[lang]?.from ?? {})){
    const at = path.indexOf('/'), kind = path.slice(0, at), id = path.slice(at + 1), now = englishOf(model, kind, id);
    if (typeof was === 'string' && typeof now === 'string' && now !== was) out.push({ kind, id, path, was, now });
  }
  return out;
}
