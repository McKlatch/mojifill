#!/usr/bin/env bash
# 1.3.2-lab: encode the recorded demo frames (record-demo.mjs) into lab/demo/:
#   mojifill-demo-{desktop,mobile}.webp (animated, looping), .gif (fallback / README), .png (still for reduced motion)
set -euo pipefail
REC="${1:-/tmp/mf-demo}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/lab/demo"
mkdir -p "$OUT"
for kind in desktop mobile; do
  D="$REC/$kind"
  if [ "$kind" = desktop ]; then SCALE="crop=1280:640:0:0,scale=960:-2:flags=lanczos"; else SCALE="scale=360:-2:flags=lanczos"; fi
  # concat list with per-frame durations (last frame repeated so its duration counts)
  LIST="$D/list.txt"; : > "$LIST"
  last=""
  while read -r f ms; do
    printf "file '%s'\nduration %s\n" "$D/$f" "$(awk "BEGIN{print $ms/1000}")" >> "$LIST"; last="$f"
  done < "$D/timings.txt"
  printf "file '%s'\n" "$D/$last" >> "$LIST"
  ffmpeg -v error -y -f concat -safe 0 -i "$LIST" -vf "$SCALE,fps=10" -c:v libwebp_anim -lossless 0 -quality 72 -compression_level 6 -loop 0 -an "$OUT/mojifill-demo-$kind.webp"
  ffmpeg -v error -y -f concat -safe 0 -i "$LIST" -vf "$SCALE,fps=10,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 "$OUT/mojifill-demo-$kind.gif"
  # still: the "fixed + copied" frame
  STILL="$(sed -n '4p' "$D/timings.txt" | cut -d' ' -f1)"
  ffmpeg -v error -y -i "$D/$STILL" -vf "$SCALE" -c:v libwebp -quality 80 "$OUT/mojifill-demo-$kind-still.webp"
done
cp "$OUT/mojifill-demo-desktop.gif" "$OUT/mojifill-demo.gif"  # README / store-listing copy
ls -la "$OUT"
