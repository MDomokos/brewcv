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

// A claim (fact) marked `archived` is hidden in Career and never switched on by a new resume, Focus or Fit.
// Saved resumes keep printing it: printing reads the lists a resume holds, not this flag.
export const isArchived = (model, factId) => !!(model?.facts ?? []).find(f => f.id === factId)?.archived;
export const archivedIds = model => new Set((model?.facts ?? []).filter(f => f.archived).map(f => f.id));
// An entry (a job, project or volunteering) marked `archived` is hidden in Career and left out of new resumes and Focus.
export const archivedEntryIds = model => new Set(entriesOf(model).filter(w => w.archived).map(w => w.id));
