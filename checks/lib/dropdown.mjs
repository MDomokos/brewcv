// A select is shown as a button that opens the app's own list (src/ui/dropdown.js); the <select> stays in the page, hidden, as the field. A browser check
// makes a choice through the button, as a person does. `sel`: the select's selector or locator; `v`: the option's value, { label } (its text) or { index }.
export async function pickOption(page, sel, v){
  if (sel === '#lens' && !(await page.$('#lens'))) await page.click('[data-act=tailor-toggle]');      // the Outline's Tailor row is shut until it is opened
  const loc = (typeof sel === 'string' ? page.locator(sel) : sel).first();
  const i = await loc.evaluate((s, v) => { const o = [...s.options]; return typeof v === 'string' ? o.findIndex(x => x.value === v) : v.index ?? o.findIndex(x => x.textContent.trim() === v.label); }, v);
  if (i < 0) throw new Error(`no option ${JSON.stringify(v)} in ${sel}`);
  // a form that commits another field on this click draws itself again and takes the list with it: open it again (a person would click twice)
  for (let k = 0; ; k++){
    await loc.locator('xpath=preceding-sibling::button[contains(@class, "ddbtn")][1]').click();
    try { await page.click(`.ddpop [data-i="${i}"]`, { timeout: 4000 }); return; } catch (e){ if (k >= 2) throw e; }
  }
}
