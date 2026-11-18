#!/usr/bin/env bash
# Stage 04, mux: frames + narration + music -> MP4, plus a poster JPEG.
#   bash engine/mux.sh videos/<id> [landscape|square|all]
# Runs in the voice shell (WSL on Windows). Normally called by queue.mjs / revoice.mjs, which export:
#   FFMPEG         ffmpeg binary (default: ffmpeg on PATH)
#   OUT_DIR        where MP4s go (default: <repo>/out)
#   OUTPUT_PREFIX  file name prefix (default: larkwell); a video.json "prefix" wins
# Output: $OUT_DIR/<prefix>-<id>-<size>.mp4 and <prefix>-<id>-<size>-poster.jpg
set -euo pipefail
E=$(cd "$(dirname "$0")" && pwd); D=$(cd "$1" && pwd); want=${2:-all}; FF=${FFMPEG:-ffmpeg}
OUTDIR=${OUT_DIR:-$E/../out}; mkdir -p "$OUTDIR"
ID=$(basename "$D")
PREFIX=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf-8')).get('prefix') or sys.argv[2])" "$D/video.json" "${OUTPUT_PREFIX:-larkwell}")
# poster: a frame 4.2 s into the last scene (the end card), or the last frame for a short end card
POSTER=$(python3 -c "import json,sys;t=json.load(open(sys.argv[1]));n=round(t['dur']*30)-1;print('%04d'%min(n,round((t['scenes'][-1]['start']+4.2)*30)))" "$D/timing.json")
for fmt in landscape:1920x1080 square:1080x1080; do
  name=${fmt%%:*}; size=${fmt##*:}; [ "$want" = all ] || [ "$want" = "$name" ] || continue
  dir=$D/frames-$name; [ -d "$dir" ] || { echo "no frames for $name"; continue; }
  out=$OUTDIR/$PREFIX-$ID-$size.mp4
  # frame zero is the poster, so players and feeds that show the first frame show the end card
  cp "$dir/$POSTER.png" "$dir/0000.png"
  "$FF" -y -loglevel error -framerate 30 -i "$dir/%04d.png" -i "$D/vo.wav" -i "$D/music.wav" \
    -filter_complex "[1:a]aformat=channel_layouts=stereo[v];[2:a]volume=-15dB[m];[v][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89[a]" \
    -map 0:v -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r 30 -c:a aac -b:a 192k -shortest -movflags +faststart "$out"
  "$FF" -y -loglevel error -i "$dir/$POSTER.png" -q:v 2 "$OUTDIR/$PREFIX-$ID-$size-poster.jpg"
  echo "== $out $( ("$FF" -i "$out" 2>&1 || true) | grep -o 'Duration: [0-9:.]*')"
done
