// Build a video from its spec, or re-build it after a change, re-doing only what changed.
//
//   node engine/revoice.mjs videos/<id> [--only s4,s5] [--speed 0.9] [--force] [--retime] [--no-render] [--formats landscape]
//   node engine/revoice.mjs takes "<sentence>" <word> <alt1> <alt2> ...          -> takes/<word>-takes.wav  (pick by ear)
//   node engine/revoice.mjs speeds videos/<id> <scene[:n]> 0.85 0.9 0.95          -> takes/<id>-<scene>-speeds.wav
//
// What to change (see vo-directed.py): video.json "voice": { speed, pronounce, gaps }, a scene's "speed" / "pace" /
// "pronounce" / "vo", or engine/lexicon.json for a respelling every video should use.
//
// Steps: 1 narration for the changed scenes only (Kokoro, in the voice shell)   2 resample to 48 kHz
//        3 timing: scene times are kept when the new voice still fits; otherwise the video is re-timed and the music re-made
//        4 frames: only the changed scenes when times were kept, the whole video when re-timed   5 mux
// On the first run nothing exists yet, so every scene counts as changed and the whole video is built.
// The MP4s from before a change are copied to out/before/ so the two can be compared.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { ENGINE, ROOT, OUT, config, sh, venv, shEnv, shPath, q } from './config.mjs';
const argv = process.argv.slice(2);
function node(args, allowFail) { const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 26 }); if (r.status !== 0 && !allowFail) { process.stdout.write((r.stdout || '') + (r.stderr || '')); process.exit(1); } return r; }
const nodeAsync = (args) => new Promise((res) => { const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d); p.on('close', code => res({ code, out })); });
const py = (script) => `python ${q(shPath(resolve(ENGINE, script)))}`;

// ---- takes: pick a pronunciation or a speed by ear
if (argv[0] === 'takes' || argv[0] === 'speeds') {
  const dir = resolve(ROOT, 'takes'); mkdirSync(dir, { recursive: true }); let out, cmd;
  if (argv[0] === 'takes') { const [sentence, word, ...alts] = argv.slice(1); if (!alts.length) { console.error('usage: revoice.mjs takes "<sentence>" <word> <alt1> <alt2> ...'); process.exit(1); }
    out = resolve(dir, word.replace(/[^A-Za-z0-9]+/g, '-') + '-takes.wav'); cmd = `${py('vo-takes.py')} word ${q(shPath(out))} ${q(sentence)} ${q(word)} ${alts.map(q).join(' ')}`; }
  else { const [vdir, ref, ...speeds] = argv.slice(1); if (!speeds.length) { console.error('usage: revoice.mjs speeds videos/<id> <scene[:n]> 0.85 0.9 0.95'); process.exit(1); }
    out = resolve(dir, `${basename(resolve(vdir))}-${ref.replace(':', '-')}-speeds.wav`); cmd = `${py('vo-takes.py')} speed ${q(shPath(out))} ${q(shPath(vdir))} ${q(ref)} ${speeds.map(q).join(' ')}`; }
  sh(venv() + `export KOKORO_VOICE=${q(config.voice)}; ` + cmd); console.log('listen: ' + out); process.exit(0);
}

// ---- (re-)voice
const flag = (k) => argv.includes(k), opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const VALUED = ['--only', '--speed', '--formats'];
const DIR = resolve(argv.find((a, i) => !a.startsWith('--') && !(i && VALUED.includes(argv[i - 1]))) || '');
if (!existsSync(resolve(DIR, 'video.json'))) { console.error('usage: node engine/revoice.mjs videos/<id> [--only s4,s5] [--speed 0.9] [--force] [--retime] [--no-render] [--formats landscape,square]'); process.exit(1); }
const video = JSON.parse(readFileSync(resolve(DIR, 'video.json'), 'utf8')), ID = basename(DIR), PREFIX = video.prefix || config.prefix;
const timingFile = resolve(DIR, 'timing.json'), readTiming = () => existsSync(timingFile) ? JSON.parse(readFileSync(timingFile, 'utf8')) : null;
const before = readTiming();
// base speed: --speed, else video.json voice.speed, else 0.9 (a calm ~140 words per minute with af_heart)
const speed = opt('--speed') || (video.voice && video.voice.speed != null ? null : '0.9');

console.log(`1/5 narration (${ID})`);
const voOut = sh(venv() + `${py('vo-directed.py')} ${q(shPath(DIR))} ${q(config.voice)}` + (speed ? ` --speed ${q(speed)}` : '') + (opt('--only') ? ` --only ${q(opt('--only'))}` : '') + (flag('--force') ? ' --force' : ''));
const changed = ((voOut.match(/^CHANGED: (.*)$/m) || [])[1] || '').split(',').filter(Boolean);
const missing = video.scenes.filter(s => s.vo && !existsSync(resolve(DIR, 'vo', s.id + '.wav'))).map(s => s.id);
for (const id of missing) if (!changed.includes(id)) changed.push(id);
if (!changed.length && before) { console.log('Nothing changed: the narration already matches video.json. (--force re-does it anyway.)'); process.exit(0); }

if (changed.length) { console.log(`2/5 resample ${changed.join(', ')}`);
  sh(shEnv() + `cd ${q(shPath(resolve(DIR, 'vo')))} && for id in ${changed.map(q).join(' ')}; do "$FFMPEG" -y -loglevel error -i "$id.raw.wav" -ar 48000 -ac 1 -sample_fmt s16 "$id.wav"; done`); }

console.log('3/5 timing');
let kept = false;
if (before && !flag('--retime')) {
  const r = node([resolve(ENGINE, 'timing.mjs'), DIR, '--keep'], true);
  if (r.status === 0) { const t = readTiming(); // kept times are only good if the new voice does not leave a hole at the end of a scene
    const slack = changed.map(id => { const s = t.scenes.find(x => x.id === id); return [id, s.end - s.voAt - s.voDur]; }).filter(([, x]) => x > 3.0);
    if (slack.length) console.log('   new voice is much shorter in ' + slack.map(([id, x]) => `${id} (${x.toFixed(1)} s of silence)`).join(', ') + ': re-timing'); else kept = true; }
  else console.log('   new voice no longer fits the old scene times: re-timing');
}
if (!kept) { process.stdout.write(node([resolve(ENGINE, 'timing.mjs'), DIR]).stdout); const t = readTiming();
  if (!before || before.dur !== t.dur || !existsSync(resolve(DIR, 'music.wav'))) process.stdout.write(node([resolve(ENGINE, 'synth-upbeat.mjs'), '--timing', timingFile, '--out', resolve(DIR, 'music.wav')]).stdout); }
const after = readTiming();
console.log(kept ? `   scene times kept (${after.dur} s)` : `   re-timed: ${before ? before.dur + ' s -> ' : ''}${after.dur} s`);

const formats = (opt('--formats') || video.formats?.join(',') || 'landscape,square').split(','), SIZE = { landscape: '1920x1080', square: '1080x1080' };
const have = formats.filter(f => existsSync(resolve(DIR, 'frames-' + f)) && readdirSync(resolve(DIR, 'frames-' + f)).length >= Math.round((before || after).dur * 30));
const full = !kept || !have.length, todo = full ? formats : have;
const ranges = changed.map(id => after.scenes.find(x => x.id === id)).map(s => [Math.max(0, s.start - 0.1), s.end + 0.1]);
const rel = `videos/${ID}`;
if (flag('--no-render')) { console.log('4/5 frames: skipped (--no-render). To finish:');
  console.log(full ? `   node engine/queue.mjs ${rel} --jobs 2 --formats ${todo.join(',')}` : ranges.map(([a, b]) => todo.map(f => `   node engine/render.mjs ${rel} --format ${f} --frames --range ${a.toFixed(2)},${b.toFixed(2)}`).join('\n')).join('\n') + `\n   bash engine/mux.sh ${rel} all   (in the voice shell)`); process.exit(0); }

// keep the MP4s from before the change, to compare
const bdir = resolve(OUT, 'before'); mkdirSync(bdir, { recursive: true });
for (const f of formats) { const n = `${PREFIX}-${ID}-${SIZE[f]}.mp4`; if (existsSync(resolve(OUT, n))) copyFileSync(resolve(OUT, n), resolve(bdir, n)); }

const t0 = Date.now();
if (full) { console.log(`4/5 frames: whole video, ${todo.join(' + ')} (about 10 min of rendering per minute of video and format)`);
  const r = await nodeAsync([resolve(ENGINE, 'queue.mjs'), DIR, '--jobs', '2', '--formats', todo.join(',')]); process.stdout.write(r.out.split('\n').filter(l => /done|FAILED|finished/.test(l)).join('\n') + '\n'); if (r.code !== 0 || /FAILED/.test(r.out)) process.exit(1);
  console.log('5/5 mux: done by the queue'); }
else { console.log(`4/5 frames: ${changed.join(', ')} only, ${todo.join(' + ')}`);
  const jobs = []; for (const f of todo) jobs.push((async () => { for (const [a, b] of ranges) { const r = await nodeAsync([resolve(ENGINE, 'render.mjs'), DIR, '--format', f, '--frames', '--range', `${a.toFixed(2)},${b.toFixed(2)}`]); if (r.code !== 0) { console.error(r.out); process.exit(1); } } })());
  await Promise.all(jobs);
  console.log('5/5 mux'); for (const f of todo) sh(shEnv() + `bash ${q(shPath(resolve(ENGINE, 'mux.sh')))} ${q(shPath(DIR))} ${f}`); }
console.log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min. New: out/${PREFIX}-${ID}-*.mp4   Before: out/before/`);
