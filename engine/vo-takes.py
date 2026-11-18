"""Numbered takes to pick by ear ("Take one ... Take two ..."), in the configured voice ($KOKORO_VOICE, default af_heart).
Inside the Kokoro venv:

  python vo-takes.py word  <out.wav> "<sentence>" <word> <alt1> <alt2> ...     the sentence, with <word> said each way
  python vo-takes.py speed <out.wav> <videoDir> <scene[:n]> 0.85 0.9 0.95      a scene (or its n-th sentence) at each base speed

Normally run through `node engine/revoice.mjs takes ...` / `node engine/revoice.mjs speeds ...`.
In word mode, give the word itself as one of the alternatives to hear the current reading."""
import sys, os, json, re, numpy as np, soundfile as sf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
D = import_module('vo-directed')
NUM = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
SR = 24000
VOICE = os.environ.get('KOKORO_VOICE', 'af_heart')
gap = lambda s: np.zeros(int(s * SR))

def main():
    mode, out = sys.argv[1], sys.argv[2]; a = sys.argv[3:]; k = D.kokoro(); parts = []; notes = []
    def label(i):
        x, _ = k.create(f'Take {NUM[i]}.', voice=VOICE, speed=1.0, lang='en-us'); return [D.trim(x, SR), gap(0.45)]
    if mode == 'word':
        sentence, word, alts = a[0], a[1], a[2:]
        if not re.search(r'(?<!\w)' + re.escape(word) + r'(?!\w)', sentence): sys.exit(f'"{word}" is not in the sentence')
        for i, alt in enumerate(alts):
            sc = {'vo': sentence}; table = {} if alt == word else {word: alt}
            audio, _, sp, _ = D.scene_audio(k, sc, VOICE, 0.9, table)
            parts += label(i) + [audio, gap(0.9)]; notes.append(f'Take {i + 1}: {alt}' + ('  (current)' if alt == word else '') + f'\n         {sp}')
    elif mode == 'speed':
        d, ref, speeds = a[0], a[1], [float(x) for x in a[2:]]
        v = json.load(open(os.path.join(d, 'video.json'), encoding='utf-8')); sid, _, n = ref.partition(':')
        sc = dict(next(s for s in v['scenes'] if s['id'] == sid))
        if n: sc['vo'] = D.sentences(sc['vo'])[int(n) - 1]
        for i, sp in enumerate(speeds):
            base, table, gaps = D.settings(v, sc, sp); audio, _, _, _ = D.scene_audio(k, sc, VOICE, base, table, gaps)
            parts += label(i) + [audio, gap(0.9)]; notes.append(f'Take {i + 1}: speed {sp}  ({len(audio) / SR:.1f} s)')
    else: sys.exit('mode must be word or speed')
    sf.write(out, D.pcm16(np.concatenate(parts)), SR)
    print('\n'.join(notes)); print('wrote', out)

if __name__ == '__main__': main()
