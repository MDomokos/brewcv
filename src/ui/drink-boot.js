// Runs before the first paint, as a plain script in the head (not deferred, not a module): puts html[data-drink] and
// html[data-theme] on the page so it never flashes the wrong drink. The same two settings are read and written by
// src/ui/drink.js once the app is up; checks/drink-check.mjs keeps the two in step.
//   rb-drink  tea (the default) | coffee
//   rb-theme  system (the default) | light | dark; data-theme is always the resolved light or dark
(function () {
  var root = document.documentElement, drink = 'tea', pref = 'system';
  try {
    var d = localStorage.getItem('rb-drink'); if (d === 'tea' || d === 'coffee') drink = d;
    var t = localStorage.getItem('rb-theme'); if (t === 'light' || t === 'dark' || t === 'system') pref = t;
  } catch (e) { /* blocked storage: tea, following the system */ }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  root.setAttribute('data-drink', drink);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
