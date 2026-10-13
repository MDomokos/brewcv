// Runs after the app's module. These are scripts of their own, not inline, so the page's
// Content-Security-Policy can refuse inline script.

// A module that never booted: almost always file://.
setTimeout(() => { if (!window.__booted) document.getElementById('no-origin').hidden = false; }, 1500);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

// The macOS desktop app has no title bar (tauri.conf.json: titleBarStyle Overlay): the page runs to the top edge and the window
// buttons float over its top left. This strip along the top gutter is what drags the window (the rule is at the end of workbench.css).
if (window.__TAURI__ && /Macintosh/.test(navigator.userAgent)){
  document.documentElement.dataset.titlebar = '';
  document.body.insertAdjacentHTML('beforeend', '<div id="tbdrag" data-tauri-drag-region aria-hidden="true"></div>');
}
