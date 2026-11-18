// Where the tools live. One place for every path the engine needs.
//
// Each setting is read, in this order, from:
//   1. an environment variable
//   2. pipeline.config.json at the repo root (copy pipeline.config.example.json; the real file is git-ignored)
//   3. auto-detection / a sensible default
//
//   setting      env var          default
//   chrome       CHROME_PATH      first Chrome / Chromium / Edge found in the usual install places or on PATH
//   shell        PIPELINE_SHELL   "wsl" on Windows (voice + mux run inside WSL), "bash" elsewhere
//   kokoroDir    KOKORO_DIR       ~/kokoro   (holds kokoro-v1.0.onnx, voices-v1.0.bin and the .venv), as seen by that shell
//   kokoroVenv   KOKORO_VENV      <kokoroDir>/.venv
//   ffmpeg       FFMPEG           ffmpeg     (on PATH inside that shell; ~/.local/bin is added to PATH)
//   prefix       OUTPUT_PREFIX    larkwell   (MP4 names: <prefix>-<video id>-<size>.mp4)
//   voice        KOKORO_VOICE     af_heart
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const ENGINE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(ENGINE, '..');
export const WORK = resolve(ROOT, 'work');
export const OUT = resolve(ROOT, 'out');

const file = resolve(ROOT, 'pipeline.config.json');
const json = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const pick = (env, key, dflt) => process.env[env] || json[key] || dflt;

function onPath(names) {
  const which = process.platform === 'win32' ? 'where' : 'which';
  for (const n of names) {
    const r = spawnSync(which, [n], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}
function findChrome() {
  const local = process.env.LOCALAPPDATA || '';
  const win = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    local && join(local, 'Google/Chrome/Application/chrome.exe'), 'C:/Program Files/Chromium/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
  const mac = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  const list = process.platform === 'win32' ? win : process.platform === 'darwin' ? mac : [];
  return list.filter(Boolean).find(existsSync)
    || onPath(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'chrome']);
}

export const config = {
  chrome: pick('CHROME_PATH', 'chrome', null) || findChrome(),
  shell: pick('PIPELINE_SHELL', 'shell', process.platform === 'win32' ? 'wsl' : 'bash'),
  kokoroDir: pick('KOKORO_DIR', 'kokoroDir', '~/kokoro'),
  kokoroVenv: pick('KOKORO_VENV', 'kokoroVenv', null),
  ffmpeg: pick('FFMPEG', 'ffmpeg', 'ffmpeg'),
  prefix: pick('OUTPUT_PREFIX', 'prefix', 'larkwell'),
  voice: pick('KOKORO_VOICE', 'voice', 'af_heart'),
};

/** A path as the voice/mux shell sees it (C:\x -> /mnt/c/x under WSL). */
export function shPath(p) {
  const abs = resolve(p);
  if (config.shell !== 'wsl') return abs.replace(/\\/g, '/');
  return abs.replace(/^([A-Za-z]):[\\/]/, (m, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
}
/** Single-quote for bash. */
export const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
/** Quote a path that may start with ~/ so the shell still expands the home directory. */
const qHome = (s) => s.startsWith('~/') ? `"$HOME"/${q(s.slice(2))}` : q(s);

/** Exports every voice/mux script needs, as a bash prefix. */
export function shEnv() {
  const venv = config.kokoroVenv ? qHome(config.kokoroVenv) : `${qHome(config.kokoroDir)}/.venv`;
  return `export PATH="$HOME/.local/bin:$PATH"; export KOKORO_DIR=${qHome(config.kokoroDir)}; export KOKORO_VENV=${venv}; ` +
    `export FFMPEG=${q(config.ffmpeg)}; export OUTPUT_PREFIX=${q(config.prefix)}; export OUT_DIR=${q(shPath(OUT))}; `;
}
/** Prefix that activates the Kokoro venv. */
export const venv = () => `${shEnv()}. "$KOKORO_VENV/bin/activate" && `;

/** Arguments to spawn a bash command in the configured shell. */
export function shArgs(cmd) {
  return config.shell === 'wsl' ? ['wsl', ['-e', 'bash', '-c', cmd]] : ['bash', ['-c', cmd]];
}
/** Run a bash command synchronously; exits the process on failure. */
export function sh(cmd, { quiet = false } = {}) {
  const [bin, args] = shArgs(cmd);
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = (r.stdout || '') + (r.stderr || '');
  if (!quiet) process.stdout.write(out);
  if (r.status !== 0) { if (quiet) process.stdout.write(out); console.error('FAILED: ' + cmd + (r.error ? '\n' + r.error.message : '')); process.exit(1); }
  return out;
}

// `node engine/config.mjs` prints what was resolved, to check a setup.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ ...config, configFile: existsSync(file) ? file : null }, null, 2));
  if (!config.chrome) { console.error('No Chrome/Chromium/Edge found: set CHROME_PATH or "chrome" in pipeline.config.json'); process.exit(1); }
}
