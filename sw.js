// Offline for the app shell: cache-first over a versioned cache. VERSION is the app's
// version (package.json); the deploy appends the commit, so every deploy is a new
// cache and installed copies never keep serving old files.
// Files opened through File System Access never pass through here.

const VERSION = '1.2.0';
const SHELL = [
  './',
  './index.html',
  './sw.js',
  './manifest.webmanifest',
  './src/data.js',
  './src/render.js',
  './src/fit.js',
  './src/recipe.js',
  './src/model/schema.js',
  './src/model/resume.js',
  './src/model/review.js',
  './src/store/store.js',
  './src/store/persist.js',
  './src/paginate.js',
  './src/ui/drink-boot.js',
  './src/ui/boot.js',
  './src/ui/after-boot.js',
  './src/ui/shell.js',
  './src/ui/ask.js',
  './src/ui/edit.js',
  './src/ui/resumes.js',
  './src/ui/switcher.js',
  './src/model/record.js',
  './src/model/resumes.js',
  './src/model/focus.js',
  './src/model/lang.js',
  './src/model/lock.js',
  './src/model/build.js',
  './src/model/import.js',
  './src/model/diff.js',
  './src/ui/files.js',
  './src/ui/export.js',
  './src/export.js',
  './src/model/tokens.js',
  './src/ui/design.js',
  './src/ui/onboarding.js',
  './src/ui/career.js',
  './src/model/checklist.js',
  './src/ui/dock.js',
  './src/ui/icons.js',
  './src/ui/checklist.js',
  './src/ui/record.js',
  './src/ui/screens.js',
  './src/ui/thumbs.js',
  './src/ui/help.js',
  './src/ui/review.js',
  './src/ui/drink.js',
  './src/ui/garden.js',
  './src/ui/motion.js',
  './src/ui/buttonfx.js',
  './src/ui/pagemotion.js',
  './src/ui/arrive.js',
  './src/ui/matroll.js',
  './src/ui/exportfx.js',
  './src/ui/parts.js',
  './src/model/career.js',
  './src/model/entries.js',
  './src/ui/langmenu.js',
  './src/ui/settings.js',
  './src/i18n/index.js',
  './src/i18n/en.js',
  './src/i18n/de.js',
  './src/i18n/fr.js',
  './src/i18n/es.js',
  './src/i18n/it.js',
  './src/i18n/pt.js',
  './src/i18n/nl.js',
  './src/i18n/pl.js',
  './src/i18n/cs.js',
  './src/i18n/hu.js',
  './themes/print-mono.css',
  './themes/b2-marker.tokens.json',
  './themes/tint-tabs.tokens.json',
  './themes/contrast-aa.tokens.json',
  './themes/print-mono.tokens.json',
  './src/ui/sheet.js',
  './src/ui/layout.js',
  './src/ui/canvas.js',
  './src/ui/onpage.js',
  './src/ui/hands.js',
  './src/ui/start.js',
  './src/ui/story.js',
  './src/ui/story-old.js',
  './src/ui/plain.js',
  './src/ui/camera.js',
  './src/ui/select.js',
  './src/ui/actual.js',
  './src/ui/workbench.css',
  './src/ui/drinks.css',
  './src/ui/garden.css',
  './src/ui/start.css',
  './src/ui/intro-side.css',
  './src/ui/flow.css',
  './data/example-resumes/index.json',
  './data/example-resumes/Atelier Mécanique Lumen - Ingénieure conception.json',
  './data/example-resumes/Dunamenti Műszer Kft. - Terméktervező.json',
  './data/example-resumes/Example Instruments - Design Engineer.json',
  './data/example-resumes/Feinmess Instrumente GmbH - Konstrukteur.json',
  './data/example-resumes/Ferro Tools - Manufacturing Engineer.json',
  './data/example-resumes/Helix Diagnostics - Product Development Engineer.json',
  './data/example-resumes/Ingeniería Brava - Ingeniera de diseño.json',
  './data/example-resumes/Medtech Lisboa - Mechanical Engineer.json',
  './data/example-resumes/Meetlab Delta - Ontwerper werktuigbouw.json',
  './data/example-resumes/Officina Riva - Progettista meccanica.json',
  './data/example-resumes/Oficina Aberta - Workshop Lead.json',
  './data/example-resumes/Oficina do Norte - Engenheira de produto.json',
  './data/example-resumes/Precyzja Wisła - Konstruktor.json',
  './data/example-resumes/Vltava Přístroje - Konstruktérka.json',
  './scripts/lib/html.mjs',
  './checks/lib/validate.mjs',
  './data/example.json',
  './data/example-recipe.json',
  './templates/us-letter.html',
  './templates/a4.html',
  './templates/a4-hu.html',
  './formats/us-letter.css',
  './formats/a4.css',
  './formats/a4-hu.css',
  './themes/b2-marker.css',
  './themes/tint-tabs.css',
  './themes/contrast-aa.css',
  './fonts/HankenGrotesk-Regular.woff2',
  './fonts/HankenGrotesk-Bold.woff2',
  './fonts/HankenGrotesk-ExtraBold.woff2',
  './fonts/FiraCode-Regular.woff2',
  './icons/icon.svg',
  './icons/icon-coffee.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // addAll is all-or-nothing, so let each entry fail on its own.
    await Promise.all(SHELL.map(url => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // On localhost the files change under you, and cache-first served a stale
  // data/example.json. So dev goes network-first and uses the cache only offline.
  const dev = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);
  e.respondWith((async () => {
    if (!dev){
      const hit = await caches.match(request, { ignoreSearch: true });
      if (hit) return hit;
    }
    try {
      const res = await fetch(request, dev ? { cache: 'no-cache' } : undefined);
      if (res.ok && res.type === 'basic'){
        const cache = await caches.open(VERSION);
        cache.put(request, res.clone());
      }
      return res;
    } catch {
      // The file's own copy first: the sheet's iframe opens a template as a navigation too,
      // and handing it index.html leaves a sheet with no .document.
      if (dev){
        const hit = await caches.match(request, { ignoreSearch: true });
        if (hit) return hit;
      }
      if (request.mode === 'navigate'){
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw new Error('offline and not cached');
    }
  })());
});
