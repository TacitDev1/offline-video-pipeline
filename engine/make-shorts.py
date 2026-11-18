"""Generate a series of 20-second "one question" shorts from a list of questions and answers.
  python -I engine/make-shorts.py [shorts/questions.json]  ->  videos/short-NN/video.json

Each entry in the input file:
  { "question": "...", "lead": "the answer's first line", "chip": "diagnose", "tools": "read_report",
    "table": { "columns": [...], "rows": [[...], ...] }   or   "bullets": ["...", ...],   "next": "optional follow-up line" }
Then build them all: node engine/queue.mjs videos/short-* after voicing each (node engine/revoice.mjs videos/short-01 ...)."""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'shorts', 'questions.json')
OUT = os.path.join(HERE, '..', 'videos')
plain = lambda s: re.sub(r'`', '', s)
data = json.load(open(SRC, encoding='utf-8'))
for n, c in enumerate(data['questions'], 1):
    vid = f'short-{n:02d}'
    ai = {'type': 'ai', 'chips': [c.get('chip', 'query'), '◈ analysis'], 'tools': c.get('tools', 'read_report'), 'lead': c['lead']}
    if c.get('table'):
        tb = c['table']; ai['cols'] = tb['columns']; ai['rows'] = tb['rows'][:5]
        ai['num'] = [j for j in range(len(tb['columns'])) if any(re.fullmatch(r'[\d,.\- %]+', str(r[j])) for r in tb['rows'][:1])]
        ai['mono'] = [0]
    elif c.get('bullets'): ai['bullets'] = c['bullets'][:3]
    if c.get('next'): ai['next'] = c['next']
    vo2 = f"You ask: {plain(c['question']).rstrip('?.')}? It answers: {plain(c['lead'])}"
    video = {'id': vid, 'title': plain(c['question']), 'series': data.get('series', 'One question, twenty seconds'), 'captions': True,
             'scenes': [
                 {'id': 's1', 'type': 'open', 'min': 3.0, 'tail': 0.4, 'vo': 'One question.'},
                 {'id': 's2', 'type': 'chat', 'layout': 'full', 'session': 'New chat', 'clock': '10:12:00', 'lead': 0.6, 'tail': 1.2,
                  'blocks': [{'type': 'user', 'text': plain(c['question'])}, ai], 'vo': vo2},
                 {'id': 's3', 'type': 'end', 'quick': True, 'min': 5.4, 'tail': 1.6, 'vo': data.get('endLine', 'Ask your system. Get the answer.'),
                  'h1': data.get('endLine', 'Ask your system. Get the answer.')}]}
    os.makedirs(os.path.join(OUT, vid), exist_ok=True)
    json.dump(video, open(os.path.join(OUT, vid, 'video.json'), 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
    print(vid, '|', plain(c['question'])[:70])
