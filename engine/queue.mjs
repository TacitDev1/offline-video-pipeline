// Stage 05, queue: node engine/queue.mjs videos/a videos/b ... [--jobs 4] [--formats landscape,square] [--no-mux]
// Renders each (video, format) pair in parallel child processes, then muxes each finished one (stage 04).
// A log of every run is appended to work/queue.log.
import { spawn } from 'node:child_process';
import { resolve, basename } from 'node:path';
import { appendFileSync, mkdirSync } from 'node:fs';
import { ENGINE, WORK, shArgs, shEnv, shPath, q } from './config.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const JOBS = parseInt(opt('--jobs', '4')), FORMATS = opt('--formats', 'landscape,square').split(','), MUX = !args.includes('--no-mux');
const VALUED = ['--jobs', '--formats'];
const dirs = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
if (!dirs.length) { console.error('usage: node engine/queue.mjs videos/<id> [videos/<id2> ...] [--jobs 4] [--formats landscape,square] [--no-mux]'); process.exit(1); }
const tasks = []; for (const d of dirs) for (const f of FORMATS) tasks.push({ dir: resolve(d), fmt: f });
mkdirSync(WORK, { recursive: true });
const log = (s) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`; console.log(line); appendFileSync(resolve(WORK, 'queue.log'), line + '\n'); };
function run(cmd, cargs) { return new Promise((res) => { const p = spawn(cmd, cargs, { stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d); p.on('close', code => res({ code, out })); }); }
let failed = 0, i = 0; const t0 = Date.now();
async function next() {
  if (i >= tasks.length) return; const task = tasks[i++];
  const id = basename(task.dir); log(`render ${id} ${task.fmt} start`);
  const r = await run(process.execPath, [resolve(ENGINE, 'render.mjs'), task.dir, '--format', task.fmt, '--frames']);
  log(`render ${id} ${task.fmt} ${r.code === 0 ? 'done' : 'FAILED'} ${r.out.trim().split('\n').pop()}`); if (r.code !== 0) failed++;
  if (r.code === 0 && MUX) {
    const [bin, a] = shArgs(`${shEnv()}bash ${q(shPath(resolve(ENGINE, 'mux.sh')))} ${q(shPath(task.dir))} ${task.fmt}`);
    const m = await run(bin, a); log(`mux ${id} ${task.fmt} ${m.code === 0 ? 'done' : 'FAILED'} ${m.out.trim().split('\n').pop()}`); if (m.code !== 0) failed++;
  }
  await next();
}
await Promise.all(Array.from({ length: Math.min(JOBS, tasks.length) }, next));
log(`queue finished: ${tasks.length} tasks in ${((Date.now() - t0) / 60000).toFixed(1)} min${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
