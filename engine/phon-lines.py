"""Phonemise whole sentences (context matters for espeak) and flag known-bad readings.
Usage (inside the Kokoro venv):
  python phon-lines.py videos/<id>/video.json ...     every scene's narration, after the built-in respellings
  python phon-lines.py -s 'a sentence' 'another'      ad-hoc sentences"""
import sys, os, json
from kokoro_onnx.tokenizer import Tokenizer
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
_prep = import_module('vo-prep')
t = Tokenizer()
BAD = {**_prep.BAD, 'zˈɛd': 'zed'}
def check(line):
    ph = t.phonemize(line, lang='en-us'); flags = [v for k, v in BAD.items() if k in ' ' + ph + ' ']
    return ph, flags
args = sys.argv[1:]
if args and args[0] == '-s':
    for s in args[1:]: ph, fl = check(s); print(f"{s}\n   -> {ph}\n   {'!! ' + ', '.join(fl) if fl else 'ok'}")
else:
    for f in args:
        d = json.load(open(f, encoding='utf-8'))
        print('==', f)
        for sc in d['scenes']:
            if not sc.get('vo'): continue
            s = _prep.spoken_of(sc['vo']); ph, fl = check(s)
            print(f"{sc['id']}: {'!! ' + ', '.join(fl) if fl else 'ok'}")
            if fl: print('   ', s); print('   ->', ph)
