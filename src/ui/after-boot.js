// Runs after the app's module. These are scripts of their own, not inline, so the page's
// Content-Security-Policy can refuse inline script.

// A module that never booted: almost always file://.
setTimeout(() => { if (!window.__booted) document.getElementById('no-origin').hidden = false; }, 1500);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
