// The hidden window of the desktop app's PDF export (see savePdfFile in src/ui/export.js).
// It receives the finished HTML, shows it, and has Rust print this window to the chosen file.
const T = window.__TAURI__;
const me = T.window.getCurrentWindow();

T.event.listen('html', async ({ payload: { html, path } }) => {
  document.open(); document.write(html); document.close();
  try { await document.fonts.ready; } catch {}
  await new Promise(ok => setTimeout(ok, 300)); // let layout settle after the fonts
  let result;
  try {
    await T.core.invoke('print_pdf', { path }); // returns once the file is written
    result = { ok: true };
  } catch (e) {
    result = e === 'unsupported' ? { ok: false, unsupported: true } : { ok: false, msg: String(e) };
  }
  await T.event.emit('pdf-done', result);
  me.close();
});
