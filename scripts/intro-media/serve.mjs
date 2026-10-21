// node scripts/intro-media/serve.mjs [root] [port]  Static server for the app with a long listen queue (python3 -m http.server's queue of 5
// resets some of the fifty-odd module requests and the app stays on its loading skeleton). Sends no-store.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] ?? '.'), port = +(process.argv[3] ?? 8123);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.webmanifest': 'application/json' };
http.createServer((q, r) => {
  let p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => {
    if (e) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'content-type': TYPES[path.extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); r.end(d);
  });
}).listen(port, { backlog: 1024 }, () => console.log(`serving ${root} on http://localhost:${port}/`));
