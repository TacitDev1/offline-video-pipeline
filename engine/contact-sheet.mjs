// Layout check: one still per scene (at 60 % of the scene), tiled into one JPEG per video.
//   node engine/contact-sheet.mjs videos/<id> [videos/<id2> ...] [--format landscape|square] [--cols 4] [--out out/sheets]
// Needs timing.json (run the voice + timing stages first, e.g. revoice.mjs --no-render). Writes <out>/<id>-<format>.jpg.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { ENGINE, OUT, sh, shEnv, shPath, q } from './config.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const VALUED = ['--format', '--cols', '--out'];
const FORMAT = opt('--format', 'landscape'), COLS = parseInt(opt('--cols', '4')), OUTDIR = resolve(opt('--out', resolve(OUT, 'sheets')));
const dirs = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1])).map(d => resolve(d));
if (!dirs.length) { console.error('usage: node engine/contact-sheet.mjs videos/<id> ... [--format landscape|square] [--cols 4] [--out dir]'); process.exit(1); }
mkdirSync(OUTDIR, { recursive: true });
const run = (a) => new Promise((res) => { const p = spawn(process.execPath, a, { stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d); p.on('close', code => res({ code, o })); });
let failed = 0;
await Promise.all(dirs.map(async (d) => {
  const tf = resolve(d, 'timing.json'); if (!existsSync(tf)) { console.error(`${basename(d)}: no timing.json`); failed++; return; }
  const t = JSON.parse(readFileSync(tf, 'utf8')); const ts = t.scenes.map(s => (s.start + 0.6 * (s.end - s.start)).toFixed(2));
  const tmp = 'sheet-' + FORMAT; rmSync(resolve(d, tmp), { recursive: true, force: true });
  const r = await run([resolve(ENGINE, 'render.mjs'), d, '--format', FORMAT, '--stills', ts.join(','), '--out', tmp]);
  if (r.code !== 0) { console.error(`${basename(d)}: render failed\n${r.o}`); failed++; return; }
  const n = ts.length, cols = Math.min(COLS, n), rows = Math.ceil(n / cols), out = resolve(OUTDIR, `${basename(d)}-${FORMAT}.jpg`);
  sh(shEnv() + `"$FFMPEG" -y -loglevel error -pattern_type glob -i ${q(shPath(resolve(d, tmp)) + '/*.png')} -vf "scale=${FORMAT === 'square' ? 480 : 640}:-1,tile=${cols}x${rows}:padding=8:color=0x0B1210" -q:v 3 ${q(shPath(out))}`, { quiet: true });
  rmSync(resolve(d, tmp), { recursive: true, force: true });
  console.log(`${basename(d)}: ${n} scenes -> ${out}`);
}));
process.exit(failed ? 1 : 0);
