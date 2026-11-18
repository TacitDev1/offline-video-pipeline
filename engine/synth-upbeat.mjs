// Stage 02, music: an upbeat soundtrack synthesised to the video's exact length. Pure Node, no packages, no samples.
//   node engine/synth-upbeat.mjs --timing <dir>/timing.json --out <dir>/music.wav [--bpm 100]
// F major, I–V–vi–IV. Drums enter after the first bar (the logo open), drop out for the end card.
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DUR = JSON.parse(readFileSync(opt('--timing'), 'utf8')).dur;
const BPM = parseFloat(opt('--bpm', '100')), SR = 48000, BEAT = 60 / BPM, BAR = 4 * BEAT;
const N = Math.round(SR * DUR), L = new Float32Array(N), R = new Float32Array(N), TAU = Math.PI * 2;
const note = (n) => 440 * Math.pow(2, (n - 69) / 12), db = (x) => Math.pow(10, x / 20), clamp01 = (x) => Math.max(0, Math.min(1, x));
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
const DRUM_IN = BAR, DRUM_OUT = DUR - 2 * BAR;           // drums: bar 2 → end card
const drumsOn = (t) => t >= DRUM_IN && t < DRUM_OUT;

// chords, 2 bars each: Fmaj7  C  Dm7  Bb(add9)  (midi)
const CHORDS = [[53, 57, 60, 64], [48, 52, 55, 60], [50, 53, 57, 60], [46, 50, 53, 60]];
const ROOTS = [41, 36, 38, 34]; // bass roots (F2 C2 D2 Bb1)
const ci = (t) => t > DUR - 2 * BAR ? 0 : Math.floor(t / (2 * BAR)) % CHORDS.length;

// ---------- 1. pad: 6-harmonic saw-ish voices, detuned, one-pole LP with slow LFO
{
  const amp = db(-23), ph = new Map(); let lpL = 0, lpR = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR, c = ci(t), x = clamp01((t - Math.floor(t / (2 * BAR)) * 2 * BAR) / 1.2);
    const prev = (c + CHORDS.length - 1) % CHORDS.length; let sl = 0, sr = 0;
    const play = (chord, g, tag) => { for (let k = 0; k < chord.length; k++) { const f = note(chord[k]);
      for (let d = -1; d <= 1; d += 2) { const key = tag + k + d; let p = ph.get(key) || 0; p += TAU * f * (1 + d * 0.003) / SR; ph.set(key, p);
        let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(p * h) / h; v *= g * 0.35; if (d < 0) sl += v; else sr += v; } } };
    play(CHORDS[c], x, 'c' + c); if (x < 1 && t > 2 * BAR) play(CHORDS[prev], 1 - x, 'c' + prev);
    const cutoff = 0.06 + 0.04 * Math.sin(TAU * t / (8 * BAR));
    lpL += cutoff * (sl - lpL); lpR += cutoff * (sr - lpR);
    const swell = clamp01(t / 1.2);
    L[i] += lpL * amp * swell; R[i] += lpR * amp * swell;
  }
}
// ---------- 2. kick: every beat, accents on 1 and 3
for (let b = 0; b * BEAT < DUR; b++) {
  const t0 = b * BEAT; if (!drumsOn(t0)) continue;
  const amp = db(b % 2 === 0 ? -13 : -17), start = Math.round(t0 * SR), len = Math.round(0.3 * SR); let p = 0;
  for (let i = 0; i < len && start + i < N; i++) { const t = i / SR; const f = 48 + 70 * Math.exp(-t / 0.03); p += TAU * f / SR;
    const v = Math.sin(p) * Math.exp(-t / 0.11) * clamp01(t / 0.003) * amp; L[start + i] += v; R[start + i] += v; }
}
// ---------- 3. hats: off-beat 8ths (open-ish) + quiet on-beat ticks
for (let e = 0; e * BEAT / 2 < DUR; e++) {
  const t0 = e * BEAT / 2; if (!drumsOn(t0)) continue;
  const off = e % 2 === 1, amp = db(off ? -27 : -35), start = Math.round(t0 * SR), len = Math.round((off ? 0.07 : 0.03) * SR);
  let hp = 0, pn = 0;
  for (let i = 0; i < len && start + i < N; i++) { const n = rnd(); hp = 0.7 * (hp + n - pn); pn = n; const v = hp * Math.exp(-i / ((off ? 0.025 : 0.008) * SR)) * amp;
    L[start + i] += v * 0.85; R[start + i] += v; }
}
// ---------- 4. bass: 8th-note bounce root / octave, plucked
for (let e = 0; e * BEAT / 2 < DUR; e++) {
  const t0 = e * BEAT / 2; if (!drumsOn(t0)) continue;
  const m = ROOTS[ci(t0)] + (e % 2 === 1 ? 12 : 0), f = note(m), amp = db(e % 2 === 1 ? -21 : -18);
  const start = Math.round(t0 * SR), len = Math.round(0.28 * SR); let lp = 0;
  for (let i = 0; i < len && start + i < N; i++) { const t = i / SR; const raw = Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * 2 * f * t) + 0.2 * Math.sin(TAU * 3 * f * t);
    lp += 0.25 * (raw - lp); const v = lp * Math.exp(-t / 0.12) * clamp01(t / 0.002) * amp; L[start + i] += v; R[start + i] += v; }
}
// ---------- 5. arpeggio: 8ths cycling chord tones over two octaves, ping-pong
for (let e = 0; e * BEAT / 2 < DUR; e++) {
  const t0 = e * BEAT / 2; if (t0 < DRUM_IN || t0 >= DRUM_OUT) continue;
  const chord = CHORDS[ci(t0)], k = e % 8, m = chord[k % 4] + 12 * (k < 4 ? 1 : 2), f = note(m);
  const amp = db(-26), start = Math.round(t0 * SR), len = Math.round(0.4 * SR), pan = e % 2 ? 0.7 : 0.3;
  for (let i = 0; i < len && start + i < N; i++) { const t = i / SR; const v = (Math.sin(TAU * f * t) + 0.12 * Math.sin(TAU * 3 * f * t)) * Math.exp(-t / 0.16) * clamp01(t / 0.002) * amp;
    L[start + i] += v * (1 - pan); R[start + i] += v * pan; }
}
// ---------- 6. motif: bright 3-note phrase every 4 bars (bars 3, 7, 11 …)
{
  const PH = [[0, 81], [0.5, 84], [1.0, 88]]; // A5 C6 E6 on the F chord region
  for (let bar = 2; bar * BAR < DRUM_OUT; bar += 4) for (const [off, m] of PH) {
    const t0 = bar * BAR + off * BEAT, f = note(m), amp = db(-22), start = Math.round(t0 * SR), len = Math.round(1.2 * SR);
    for (let i = 0; i < len && start + i < N; i++) { const t = i / SR; const v = (Math.sin(TAU * f * t) + 0.15 * Math.sin(TAU * 2 * f * t)) * Math.exp(-t / 0.35) * clamp01(t / 0.003) * amp;
      L[start + i] += v * 0.6; R[start + i] += v * 0.4; if (start + i + Math.round(0.3 * SR) < N) { L[start + i + Math.round(0.3 * SR)] += v * 0.2; R[start + i + Math.round(0.3 * SR)] += v * 0.3; } }
  }
}
// ---------- master
const fadeIn = 0.3, fadeOut = 2.4; let peak = 0;
for (let i = 0; i < N; i++) { const t = i / SR, g = clamp01(t / fadeIn) * clamp01((DUR - t) / fadeOut);
  L[i] = Math.tanh(L[i] * 1.15) * g; R[i] = Math.tanh(R[i] * 1.15) * g; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const norm = db(-1) / peak; let rms = 0; for (let i = 0; i < N; i++) rms += (L[i] * L[i] + R[i] * R[i]) / 2; rms = Math.sqrt(rms / N) * norm;
const b = Buffer.alloc(44 + N * 4);
b.write('RIFF', 0); b.writeUInt32LE(36 + N * 4, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), 44 + i * 4); b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), 46 + i * 4); }
writeFileSync(opt('--out'), b);
console.log(`wrote ${opt('--out')}  ${DUR}s  ${BPM} BPM  rms ${(20 * Math.log10(rms)).toFixed(1)} dBFS`);
