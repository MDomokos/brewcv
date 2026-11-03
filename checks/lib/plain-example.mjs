// For the browser checks written for the example's fourteen resumes with no rounds, files or sends (they make their own): run in the page with
// page.evaluate(plainExample) after the example has loaded, it takes the example's Library off (its rounds, documents, import log, sends and language
// copies) as a new baseline, with no undo step. Anything that is not the example is left as it is.
export const plainExample = () => {
  const st = window.__wb.store.state;
  if (!/\(fictional\)/.test(st.record?.meta?.owner ?? '') || !(st.rounds || st.documents || st.resumes.some(r => r.parent || r.snapshots))) return;
  const s = structuredClone(window.__wb.store.materialize()), copies = s.resumes.filter(r => r.parent).map(r => r.id);
  for (const k of ['rounds', 'documents', 'imports']) delete s[k];
  s.resumes = s.resumes.filter(r => !r.parent).map(({ round, snapshots, ...r }) => r);
  for (const id of copies) delete s.frozen[id];
  if (s.cur) delete s.cur.round;
  window.__wb.store.reset(s, 'example');
};
