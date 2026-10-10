/* node scripts/export-pdf.mjs [input.html] [output.pdf] [--css <file>]
   Deterministic PDF, independent of print-dialog settings. Needs Node 22+ and a Chrome, Chromium,
   Brave or Edge on the machine (CHROME_PATH names one). No packages: it speaks the Chrome DevTools
   Protocol over Node's built-in WebSocket. Optional: the app's own export (print, in the browser)
   is the main way to a PDF. */
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const MAC = ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser']
  .map(n => `/Applications/${n}.app/Contents/MacOS/${n}`);
const LINUX = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

// The first browser that exists: CHROME_PATH, the macOS and Linux locations, then PATH.
export function findBrowser(env = process.env, exists = fs.existsSync, which = onPath) {
  const known = [env.CHROME_PATH, ...MAC, ...LINUX].filter(Boolean).find(p => exists(p));
  return known ?? ['google-chrome', 'chromium'].map(which).find(Boolean) ?? null;
}
function onPath(name) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split('\n')[0].trim() : null;
}

export async function exportPdf(input, output, extraCss) {
  const exe = findBrowser();
  if (!exe) throw new Error('no Chrome, Chromium, Brave or Edge found; set CHROME_PATH to the browser executable (the app\'s own PDF export, in the browser, needs none of this)');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brewcv-pdf-'));
  const chrome = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  let ws, timer;
  const deadline = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out after 30 s')), 30000); });
  const work = async () => {
    // Chrome writes the port it picked, then the browser's socket path, to this file.
    let active;
    for (let i = 0; i < 100 && !active; i++) {
      try { active = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n'); }
      catch { await new Promise(r => setTimeout(r, 100)); }
    }
    if (!active) throw new Error(`${exe} did not start (no DevToolsActivePort)`);
    ws = new WebSocket(`ws://127.0.0.1:${active[0]}${active[1]}`);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('could not connect to the browser')); });

    // send() resolves with the reply that carries the same id; events go to whoever waits for them.
    let id = 0, session;
    const pending = new Map(), waiting = new Map();
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
      else waiting.get(m.method)?.(m.params);
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
      pending.set(++id, { res, rej });
      ws.send(JSON.stringify({ id, method, params, ...(session && { sessionId: session }) }));
    });
    const event = method => new Promise(res => waiting.set(method, res));

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }));
    await send('Page.enable');
    const loaded = event('Page.loadEventFired');
    await send('Page.navigate', { url: pathToFileURL(input).href });
    await loaded;
    // --css layers a token override on top of the theme, before the fonts are awaited.
    if (extraCss) await send('Runtime.evaluate', { expression:
      `document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(fs.readFileSync(extraCss, 'utf8'))} }))` });
    await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    const { data } = await send('Page.printToPDF', {
      // Use the format's @page size, so the page box maps to the PDF with no scaling.
      preferCSSPageSize: true, printBackground: true,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    });
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, Buffer.from(data, 'base64'));
  };
  try { await Promise.race([work(), deadline]); }
  finally {
    clearTimeout(timer);
    try { ws?.close(); } catch {}
    const gone = new Promise(r => chrome.once('exit', r));
    if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill(); await gone; }
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  const cssIdx = argv.indexOf('--css');
  const extraCss = cssIdx !== -1 ? path.resolve(argv[cssIdx + 1]) : null;
  const positional = argv.filter((a, i) => cssIdx === -1 || (i !== cssIdx && i !== cssIdx + 1));
  const input = path.resolve(positional[0] ?? 'templates/us-letter.html');
  const output = path.resolve(positional[1] ?? 'out/resume.pdf');
  try { await exportPdf(input, output, extraCss); console.log('wrote', output); }
  catch (e) { console.error('export-pdf:', e.message); process.exitCode = 1; }
}
