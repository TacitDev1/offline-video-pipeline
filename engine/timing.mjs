// Stage 02, timing: node engine/timing.mjs videos/<id> [--keep]
// Reads video.json + vo/<scene>.wav, lays scenes on the 100 BPM beat grid (one beat = 0.6 s) so cuts land on the music,
// and writes timing.json + vo.wav (the whole narration track). Chat scenes get at least the time their blocks need
// (schedule.js, shared with the browser). --keep reuses the previous scene times and fails if a new clip no longer fits.
// Per scene, `lead` (silence before the voice), `tail` (after it) and `min` (shortest length) override the defaults below.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SCHED = require('./schedule.js');
const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(process.argv[2]); const KEEP = process.argv.includes('--keep');
const SR = 48000, BEAT = 0.6;
const video = JSON.parse(readFileSync(resolve(dir, 'video.json'), 'utf8'));
const DEF = { open: { lead: 1.0, min: 4.2, tail: 0.6 }, headline: { lead: 0.6, min: 5.4, tail: 0.9 }, chain: { lead: 0.6, min: 10.0, tail: 1.2 }, arch: { lead: 0.6, min: 10.0, tail: 1.2 }, silos: { lead: 0.6, min: 7.0, tail: 1.4 }, contrast: { lead: 0.6, min: 12.0, tail: 1.6 }, origin: { lead: 0.6, min: 12.0, tail: 1.6 },
  chat: { lead: 0.8, min: 6.0, tail: 1.4 }, shot: { lead: 0.7, min: 8.0, tail: 1.2 }, fact: { lead: 0.6, min: 5.4, tail: 1.0 }, form: { lead: 0.6, min: 7.0, tail: 1.2 }, terminal: { lead: 0.6, min: 7.0, tail: 1.2 }, end: { lead: 0.8, min: 7.2, tail: 2.4 } };
function wav(file) {
  const b = readFileSync(file); let p = 12, fmt = null, data = null;
  while (p < b.length) { const id = b.toString('ascii', p, p + 4), n = b.readUInt32LE(p + 4); if (id === 'fmt ') fmt = { ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) }; if (id === 'data') { data = b.subarray(p + 8, p + 8 + n); break; } p += 8 + n + (n & 1); }
  if (fmt.sr !== SR || fmt.bits !== 16) throw new Error(file + ': expected 48 kHz 16-bit');
  const n = data.length / 2 / fmt.ch, mono = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < fmt.ch; c++) s += data.readInt16LE((i * fmt.ch + c) * 2); mono[i] = s / fmt.ch / 32768; }
  const th = Math.pow(10, -50 / 20); let a = 0, z = n - 1; while (a < n && Math.abs(mono[a]) < th) a++; while (z > a && Math.abs(mono[z]) < th) z--;
  a = Math.max(0, a - Math.round(0.08 * SR)); z = Math.min(n - 1, z + Math.round(0.08 * SR)); const out = mono.subarray(a, z + 1); out.lead = a / SR; return out;
}
const prev = KEEP ? JSON.parse(readFileSync(resolve(dir, 'timing.json'), 'utf8')) : null;
let t = 0; const scenes = [], clips = [];
// the first line waits INTRO s so the picture and music settle before anyone speaks (an instant first word felt too sudden)
const INTRO = video.introLead ?? 2.4;
for (const sc of video.scenes) {
  const d = DEF[sc.type] || DEF.fact;
  const lead = sc.lead ?? (sc === video.scenes[0] ? INTRO : d.lead), tail = sc.tail ?? d.tail;
  let min = sc.min ?? d.min;
  if (sc.type === 'chat') min = Math.max(min, SCHED.chatDuration(sc.blocks || []) + 1.0);
  const file = resolve(dir, 'vo', sc.id + '.wav');
  const pcm = sc.vo && existsSync(file) ? wav(file) : null; const voDur = pcm ? pcm.length / SR : 0;
  if (KEEP) { const o = prev.scenes.find(x => x.id === sc.id); if (pcm && o.voAt + voDur > o.end) throw new Error(sc.id + ': new voice does not fit kept scene'); const sfk = resolve(dir, 'vo', sc.id + '.sents.json'); const sk = pcm && existsSync(sfk) ? { sents: JSON.parse(readFileSync(sfk, 'utf8')).map(([a, b]) => [+(a - pcm.lead).toFixed(3), +(b - pcm.lead).toFixed(3)]) } : {}; scenes.push({ ...o, voDur: +voDur.toFixed(3), ...sk }); if (pcm) clips.push({ at: o.voAt, pcm }); t = o.end; continue; }
  const start = t, voAt = start + lead;
  let len = Math.max(min, lead + voDur + tail); len = Math.ceil(len / BEAT - 1e-6) * BEAT;
  // sentence spans from vo-directed.py (seconds within the trimmed clip), used to time captions
  const sf = resolve(dir, 'vo', sc.id + '.sents.json'), sents = pcm && existsSync(sf) ? JSON.parse(readFileSync(sf, 'utf8')).map(([a, b]) => [+(a - pcm.lead).toFixed(3), +(b - pcm.lead).toFixed(3)]) : undefined;
  scenes.push({ id: sc.id, type: sc.type, start: +start.toFixed(3), end: +(start + len).toFixed(3), voAt: +voAt.toFixed(3), voDur: +voDur.toFixed(3), ...(sents ? { sents } : {}) });
  if (pcm) clips.push({ at: voAt, pcm }); t += len;
}
const DUR = KEEP ? prev.dur : +t.toFixed(3);
writeFileSync(resolve(dir, 'timing.json'), JSON.stringify({ bpm: 100, dur: DUR, scenes }, null, 2));
const N = Math.round(DUR * SR), out = new Float32Array(N); let peak = 0;
for (const c of clips) { const o = Math.round(c.at * SR); for (let i = 0; i < c.pcm.length && o + i < N; i++) out[o + i] += c.pcm[i]; }
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(out[i]));
const g = Math.pow(10, -3 / 20) / (peak || 1), buf = Buffer.alloc(44 + N * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i] * g)) * 32767), 44 + i * 2);
writeFileSync(resolve(dir, 'vo.wav'), buf);
console.log(`${video.id || dir}: ${DUR}s`); for (const s of scenes) console.log(`  ${s.id.padEnd(4)} ${String(s.type).padEnd(9)} ${String(s.start).padStart(6)} - ${String(s.end).padStart(6)}  vo ${s.voDur}s`);
