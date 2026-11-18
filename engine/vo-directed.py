"""Stage 01, voice: directed narration with Kokoro-82M. One clip per sentence, joined with deliberate pauses.
Usage (inside the Kokoro venv):
  python vo-directed.py <videoDir> [voice] [speed] [--speed 0.9] [--lang en-gb] [--only s1,s3] [--force] [--sample out.wav]
Normally run through `node engine/revoice.mjs videos/<id>`, which also times, renders and muxes what changed.
The model files are read from $KOKORO_DIR (default ~/kokoro): kokoro-v1.0.onnx and voices-v1.0.bin. Default voice: af_heart.

Direction it applies (what Kokoro can be told; stress and intonation within a sentence it cannot):
- full stop: a full beat; question: a thinking pause; exclamation treated as a full stop
- a sentence listed in the scene's "key" array: ~1 s pause before it and spoken slower
- sentences with numbers: slightly slower; list sentences (3+ commas): slightly quicker
- pronunciation: acronyms respelt (vo-prep.py), plus engine/lexicon.json and the spec's own "pronounce" tables

Voice settings in video.json (all optional):
  "voice": { "speed": 0.9,                                   base speed for the whole video (a speed on the command line wins)
             "pronounce": { "BRW": "B R W" },                word -> respelling, whole words, case-sensitive
             "gaps": { "stop": 0.45, "question": 0.85, "key": 1.0 } }   pauses in seconds
  per scene:  "speed": 0.95                                  multiplier on the base speed for that scene
              "pace": { "Three checks": 0.92 }               multiplier for the sentence that starts with / contains this text
              "pronounce": { ... }, "gaps": { ... }          the same as above, for that scene only
engine/lexicon.json holds respellings shared by every video. Order: scene > video > lexicon > the built-in list in vo-prep.py.

Writes vo/<id>.txt (spoken form), vo/<id>.sents.json, vo/<id>.raw.wav and vo/<id>.meta.json (what it was made from), or one joined
sample file. A scene whose text, speed, pauses and pronunciation are unchanged is skipped; the last line printed is "CHANGED: s4,s7"."""
import sys, os, re, json, hashlib, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from importlib import import_module
_prep = import_module('vo-prep')
spoken_of, BAD = _prep.spoken_of, _prep.BAD

GAPS = {'stop': 0.45, 'question': 0.85, 'key': 1.0}
SLOW_KEY, SLOW_NUM, FAST_LIST = 0.90, 0.95, 1.04
NEEDS = {'sənt': 'ST'}   # this bad pattern also occurs in ordinary words ("recent"): only flag it when the term is in the sentence

LANG = 'en-us'

def lexicon():
    p = os.path.join(HERE, 'lexicon.json')
    return json.load(open(p, encoding='utf-8')).get('pronounce', {}) if os.path.exists(p) else {}

def respell(s, table):
    for w in sorted(table, key=len, reverse=True):   # longest first, so "S/4HANA Cloud" wins over "S/4HANA"
        s = re.sub(r'(?<!\w)' + re.escape(w) + r'(?!\w)', lambda m, r=table[w]: r, s)
    return s

def gb(s, table=None):
    if table: s = respell(s, table)
    s = spoken_of(s)
    if LANG == 'en-gb': s = re.sub(r'\bSAP\b', 'S.A.P.', s)   # en-gb reads bare SAP as "sap"; en-us already spells it
    s = re.sub(r'\bABAP\b', 'ah-bap', s)   # 'AH-bap' was read as A-H-bap; 'ah-bap' chosen by ear
    return s

def sentences(text):
    return [x.strip() for x in re.findall(r"[^.!?]+[.!?]+['\")]*|[^.!?]+$", text) if x.strip()]

def trim(a, sr):
    th = 10 ** (-48 / 20); idx = np.where(np.abs(a) > th)[0]
    if not len(idx): return a
    return a[max(0, idx[0] - int(0.03 * sr)): idx[-1] + int(0.06 * sr)]

def settings(v, sc, base):
    """Merged voice settings for one scene: (base speed, pronunciation table, gaps)."""
    vv = v.get('voice', {}) if v else {}
    table = {**lexicon(), **vv.get('pronounce', {}), **sc.get('pronounce', {})}
    gaps = {**GAPS, **vv.get('gaps', {}), **sc.get('gaps', {})}
    return base * float(sc.get('speed', 1.0)), table, gaps

def plan(sc, base, table=None, gaps=None):
    """What will be spoken: one entry per sentence with its spoken text, speed and the pauses around it."""
    gaps = gaps or GAPS; keys = {x.strip() for x in sc.get('key', [])}; pace = sc.get('pace', {}); out = []
    for i, s in enumerate(sentences(sc['vo'])):
        speed = base
        if s in keys: speed *= SLOW_KEY
        elif re.search(r'\d', s): speed *= SLOW_NUM
        elif s.count(',') >= 3: speed *= FAST_LIST
        for frag, m in pace.items():
            if frag in s: speed *= float(m)
        out.append({'s': s, 'spoken': gb(s, table), 'speed': round(speed, 4), 'pre': gaps['key'] if (i and s in keys) else 0,
                    'post': gaps['question'] if s.endswith('?') else gaps['stop']})
    return out

def scene_audio(k, sc, voice, base, table=None, gaps=None, pl=None):
    pl = pl or plan(sc, base, table, gaps)
    parts, sr, spoken, spans = [], 24000, [], []   # spans: [start, end, sentence] in seconds within the clip
    pos = lambda: sum(len(p) for p in parts) / sr
    for p in pl:
        if p['pre']: parts.append(np.zeros(int(p['pre'] * sr)))
        spoken.append(p['spoken'])
        a, sr = k.create(p['spoken'], voice=voice, speed=p['speed'], lang=LANG)
        t0 = pos(); parts.append(trim(a, sr)); spans.append([round(t0, 3), round(pos(), 3), p['s']])
        parts.append(np.zeros(int(p['post'] * sr)))
    return np.concatenate(parts[:-1]) if parts else np.zeros(1), sr, ' '.join(spoken), spans

def kokoro():
    home = os.path.expanduser(os.environ.get('KOKORO_DIR') or '~/kokoro')
    model, voices = os.path.join(home, os.environ.get('KOKORO_MODEL', 'kokoro-v1.0.onnx')), os.path.join(home, os.environ.get('KOKORO_VOICES', 'voices-v1.0.bin'))
    for f in (model, voices):
        if not os.path.exists(f): sys.exit(f'missing {f}: download the Kokoro model files into $KOKORO_DIR (see README, Requirements)')
    return Kokoro(model, voices)

def pcm16(a): return (np.clip(a, -1, 1) * 32767).astype(np.int16)

def main():
    global LANG
    a = sys.argv[1:]; VAL = ('--lang', '--only', '--sample', '--speed'); opt = {}; pos = []; i = 0
    while i < len(a):
        if a[i] in VAL: opt[a[i]] = a[i + 1]; i += 2
        elif a[i].startswith('--'): opt[a[i]] = True; i += 1
        else: pos.append(a[i]); i += 1
    d = pos[0]; voice = pos[1] if len(pos) > 1 else os.environ.get('KOKORO_VOICE', 'af_heart')
    LANG = opt.get('--lang', LANG); only = opt['--only'].split(',') if '--only' in opt else None
    sample = opt.get('--sample'); force = '--force' in opt
    v = json.load(open(os.path.join(d, 'video.json'), encoding='utf-8')); os.makedirs(os.path.join(d, 'vo'), exist_ok=True)
    base0 = float(opt['--speed']) if '--speed' in opt else float(pos[2]) if len(pos) > 2 else float(v.get('voice', {}).get('speed', 1.0))
    k = None; tok = None; joined, words, secs, changed = [], 0, 0.0, []
    for sc in v['scenes']:
        if not sc.get('vo') or (only and sc['id'] not in only): continue
        base, table, gaps = settings(v, sc, base0); pl = plan(sc, base, table, gaps)
        f = lambda ext: os.path.join(d, 'vo', sc['id'] + ext)
        digest = hashlib.sha1(json.dumps([voice, LANG, pl], ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()
        old = json.load(open(f('.meta.json'), encoding='utf-8')).get('hash') if os.path.exists(f('.meta.json')) else None
        if not sample and not force and old == digest and os.path.exists(f('.raw.wav')):
            n = sf.info(f('.raw.wav')); words += len(sc['vo'].split()); secs += n.frames / n.samplerate; print(sc['id'], 'unchanged'); continue
        if tok is None:
            from kokoro_onnx.tokenizer import Tokenizer; tok = Tokenizer()
        for p in pl:   # the same check as vo-prep.py: warn when a sentence still phonemises to a known-bad pattern
            ph = ' ' + tok.phonemize(p['spoken'], lang=LANG) + ' '; flags = [m for b, m in BAD.items() if b in ph and NEEDS.get(b, '') in p['s']]
            if flags: print(f"!! {sc['id']}: {', '.join(flags)}\n   {p['spoken']}\n   ->{ph}")
        k = k or kokoro(); audio, sr, sp, spans = scene_audio(k, sc, voice, base, pl=pl)
        words += len(sc['vo'].split()); secs += len(audio) / sr
        if sample: joined += [audio, np.zeros(int(1.2 * sr))]; continue
        new = pcm16(audio); same = False
        if os.path.exists(f('.raw.wav')) and not force:   # made before meta files existed: adopt it if the audio comes out identical
            prev, psr = sf.read(f('.raw.wav'), dtype='int16'); same = psr == sr and len(prev) == len(new) and int(np.abs(prev.astype(np.int32) - new).max()) <= 1
        open(f('.txt'), 'w', encoding='utf-8').write(sp + '\n')
        json.dump(spans, open(f('.sents.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        json.dump({'hash': digest, 'voice': voice, 'lang': LANG, 'plan': pl}, open(f('.meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        if same: print(sc['id'], 'same audio'); continue
        sf.write(f('.raw.wav'), new, sr); changed.append(sc['id'])
        print(sc['id'], round(len(audio) / sr, 2), 's')
    if sample: sf.write(sample, pcm16(np.concatenate(joined)), 24000)
    if secs: print(f'{voice}: {words} words in {secs:.1f} s = {words / secs * 60:.0f} wpm (pauses included)')
    if not sample: print('CHANGED: ' + ','.join(changed))

if __name__ == '__main__': main()
