// Entries: anything that prints like a job (title, meta line, bullets). Pure: no DOM.
// Imported projects/volunteer items without the app's id and display are not entries and ride along untouched.

export const ENTRY_KEYS = ['work', 'projects', 'volunteer'];
export const isEntry = x => !!x && typeof x === 'object' && typeof x.id === 'string'
  && typeof x.display?.position === 'string' && Array.isArray(x.highlights);

export function entriesOf(model){
  const out = [...(model?.work ?? [])];
  for (const k of ['projects', 'volunteer']) for (const x of model?.[k] ?? []) if (isEntry(x)) out.push(x);
  return out;
}
export function entryKey(model, id){
  for (const k of ENTRY_KEYS) if ((model?.[k] ?? []).some(x => x?.id === id)) return k;
  return null;
}
