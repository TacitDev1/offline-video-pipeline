"""Stage 01, voice check: narration text -> spoken form (acronym respellings), then verify each scene's pronunciation
with the same phonemiser Kokoro uses. Writes vo/<scene>.txt. Usage (inside the Kokoro venv): python vo-prep.py <videoDir>
Exit code 1 if any line still phonemises to a known-bad pattern. vo-directed.py imports spoken_of() and BAD from here."""
import sys, json, re, os
from kokoro_onnx.tokenizer import Tokenizer

# Respellings verified with the phonemiser (see phon-check.py) and picked by ear (revoice.mjs takes).
# Plain forms that already read well are NOT listed. Add your own terms to engine/lexicon.json instead of here.
RESPELL = [
    (r'\bST22\b', 'S T 22'), (r'\bATC\b', 'A-T-C'), (r'\bQA\b', 'Q A'), (r'\bPII\b', 'P I I'), (r'\bECC\b', 'E C C'),
    (r'\bERP\b', 'E R P'), (r'\bEDI\b', 'E D I'), (r'\bDEV\b', 'dev'), (r'\bPRD\b', 'production'), (r'S/4HANA', 'S4HANA'),
    (r'\bS/4\b', 'S4'), (r'\bG/L\b', 'GL'), (r'\bSE09\b', 'S E zero nine'), (r'\bSE38\b', 'S E thirty eight'),
    (r'\bSM37\b', 'S M thirty seven'), (r'\bSM21\b', 'S M twenty one'), (r'\bJWT\b', 'token'),
    (r'\bMPL\b', 'message processing log'), (r'\bSRVB\b', 'service binding'),
    (r'\bBDEF\b', 'behaviour definition'), (r'\bSRVD\b', 'service definition'), (r'\bDDIC\b', 'dictionary'), (r'\bGxP\b', 'G x P'),
    (r'\bMCP\b', 'M C P'), (r'\bUI5\b', 'UI five'), (r'\bFLP\b', 'launchpad'), (r'\bBSP\b', 'B S P'), (r'\bSOX\b', 'socks'),
    (r'\bOData\b', 'oh-data'), (r'\bIDocs\b', 'eye-docks'), (r'\bIDoc\b', 'eye-dock'), (r'\bEKBE\b', 'E K B E'), (r'\bCTS\b', 'C T S'),
    (r'\bdatabase\b', 'data base'),
    (r'\bcash flow\b', 'cash-flow'),   # as two words the voice put a pause between them
    (r'\bBTP\b', 'B T P'),   # bare IT already reads as I-T; respelling it 'I.T.' made Kokoro stop mid-sentence
]
BAD = {'sˈæp': 'SAP read as "sap"', 'sənt': 'ST read as "saint"', 'ˈætk': 'ATC read as "atk"', ' kˈɑː ': 'QA read as "kah"', 'pˈɪaɪ': 'PII',
       ' ˈɛk ': 'ECC', 'ˈɜːp': 'ERP', ' ˈɛdi ': 'EDI', 'slˈæʃ': 'slash spoken', 'dˌiːˌiːvˈiː': 'DEV spelled',
       'ɐ aɪ': 'A I broken', 'ɐ pˈiː': 'S A P broken', 'ɐ tˈiː': 'A T broken'}

def spoken_of(text):
    s = text
    for pat, rep in RESPELL: s = re.sub(pat, rep, s)
    return s

def main(d):
    t = Tokenizer()
    v = json.load(open(os.path.join(d, 'video.json'), encoding='utf-8'))
    os.makedirs(os.path.join(d, 'vo'), exist_ok=True)
    bad = 0
    for sc in v['scenes']:
        if not sc.get('vo'): continue
        s = sc.get('spoken') or spoken_of(sc['vo'])
        ph = t.phonemize(s, lang='en-us')
        flags = [m for k, m in BAD.items() if k in (' ' + ph + ' ')]
        # SAP as a word: fall back to dotted form for that line
        if 'sˈæp' in ph:
            s2 = re.sub(r'\bSAP\b', 'S.A.P.', s); ph2 = t.phonemize(s2, lang='en-us')
            if 'sˈæp' not in ph2: s, ph, flags = s2, ph2, [m for k, m in BAD.items() if k in (' ' + ph2 + ' ')]
        open(os.path.join(d, 'vo', sc['id'] + '.txt'), 'w', encoding='utf-8').write(s + '\n')
        if flags:
            bad += 1; print(f"!! {sc['id']}: {', '.join(flags)}\n   {s}\n   -> {ph}")
        else: print(f"ok {sc['id']}")
    sys.exit(1 if bad else 0)

if __name__ == '__main__': main(sys.argv[1])
