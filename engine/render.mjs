// Stage 03, render: drives headless Chrome over the DevTools protocol and screenshots comp.html frame by frame.
//   node engine/render.mjs videos/<id> --format landscape|square --frames            all frames -> videos/<id>/frames-<format>/0000.png ...
//   node engine/render.mjs videos/<id> --format landscape --frames --range 4.2,9.0   re-render only those seconds into the existing frames
//   node engine/render.mjs videos/<id> --stills 1.5,6,12 [--out stills]              a few stills (layout checks)
// Every frame is a pure function of time: the page exposes window.seek(t), so frames can be rendered in any order.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, basename, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE, WORK, config } from './config.mjs';
const args = process.argv.slice(2);
const DIR = resolve(args[0] || '');
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FORMAT = opt('--format', 'landscape');
const FRAMES = args.includes('--frames');
const OUT = resolve(DIR, opt('--out', FRAMES ? 'frames-' + FORMAT : 'stills'));
const STILLS = opt('--stills', null);
const RANGE = opt('--range', null); // a,b seconds: re-render only those frames into an existing frames dir
const FPS = 30, W = FORMAT === 'square' ? 1080 : 1920, H = 1080;
if (!existsSync(resolve(DIR, 'timing.json'))) { console.error(`no timing.json in ${DIR}: run the voice and timing stages first`); process.exit(1); }
if (!config.chrome) { console.error('No Chrome/Chromium/Edge found: set CHROME_PATH or "chrome" in pipeline.config.json'); process.exit(1); }
if (FRAMES && !RANGE && existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const PORT = 9333 + Math.floor(Math.random() * 2000);
// a fresh, throwaway browser profile per job, inside the git-ignored work/ folder
const profile = resolve(WORK, 'chrome-profile-' + basename(DIR) + '-' + FORMAT + '-' + process.pid);
mkdirSync(WORK, { recursive: true });
const chrome = spawn(config.chrome, ['--headless=new', `--remote-debugging-port=${PORT}`, `--window-size=${W},${H}`, '--hide-scrollbars', '--force-device-scale-factor=1', '--disable-gpu',
  '--no-first-run', '--no-default-browser-check', '--mute-audio', '--allow-file-access-from-files', '--disable-background-timer-throttling', '--disable-extensions',
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
chrome.stderr.on('data', () => {});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// wait for Chrome to exit before deleting its profile (it holds files open until then)
const exited = new Promise(r => chrome.once('exit', r));
const cleanup = async () => { try { chrome.kill(); } catch { } await Promise.race([exited, sleep(5000)]); try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { } };
async function targets() { try { return await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { return null; } }
let list = null; for (let i = 0; i < 150 && !(list && list.find(t => t.type === 'page')); i++) { await sleep(150); list = await targets(); }
if (!list) { console.error('chrome did not start: ' + config.chrome); await cleanup(); process.exit(1); }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception)); return r.result.value; };
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
// comp.html loads the spec relative to itself, e.g. ../videos/<id>/
const rel = relative(ENGINE, DIR).split(/[\\/]/).map(encodeURIComponent).join('/') + '/';
await send('Page.navigate', { url: pathToFileURL(resolve(ENGINE, 'comp.html')).href + `?format=${FORMAT}&dir=${encodeURIComponent(rel)}` });
await sleep(300);
let ready = null; for (let i = 0; i < 200; i++) { try { ready = await evaluate('window.ready'); if (ready === 'ready' || (ready && ready.startsWith && ready.startsWith('error'))) break; } catch { } await sleep(100); }
if (ready !== 'ready') { console.error('comp not ready:', ready); await cleanup(); process.exit(1); }
const DUR = await evaluate('window.DUR');
async function shot(t, file) { await evaluate(`window.seek(${t})`); const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } }); writeFileSync(file, Buffer.from(r.data, 'base64')); }
const t0 = Date.now();
if (STILLS) for (const s of STILLS.split(',')) { const t = parseFloat(s); await shot(t, resolve(OUT, `${FORMAT}-t${t.toFixed(2).padStart(6, '0').replace('.', '_')}.png`)); }
if (FRAMES) { const n = Math.round(DUR * FPS); const [ra, rb] = RANGE ? RANGE.split(',').map(x => Math.round(parseFloat(x) * FPS)) : [0, n]; for (let i = Math.max(0, ra); i < Math.min(n, rb); i++) { await shot(i / FPS, resolve(OUT, String(i).padStart(4, '0') + '.png')); if (i % 300 === 0) console.log(`${basename(DIR)} ${FORMAT} frame ${i}/${n} ${((Date.now() - t0) / 1000).toFixed(0)}s`); } console.log(`${basename(DIR)} ${FORMAT}: ${n} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
ws.close(); await cleanup();
process.exit(0);
