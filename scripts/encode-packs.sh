#!/bin/bash
# Build web-friendly encodes from the 1024px master alpha WebMs.
O=${SRC:-$(dirname "$0")/../masters}
P=$(cd "$(dirname "$0")/.." && pwd)/assets/packs
enc(){ src=$1; dst=$2
  ffmpeg -y -v error -c:v libvpx-vp9 -i "$src" -vf "scale=384:384:flags=lanczos,fps=30" -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 38 -row-mt 1 -deadline good -cpu-used 2 -auto-alt-ref 0 -an "$dst.webm"
  ffmpeg -y -v error -c:v libvpx-vp9 -i "$src" -vf "scale=256:256:flags=lanczos,fps=15" -c:v libwebp_anim -lossless 0 -q:v 60 -loop 0 -an "$dst.webp"
  ffmpeg -y -v error -c:v libvpx-vp9 -i "$src" -vf "scale=256:256" -frames:v 1 -update 1 "$dst.png"
}
# usage: encode-packs.sh [pack masterdir prefix]   (default: dafeiyu fish fish)
PK=${1:-dafeiyu}; MD=${2:-fish}; PF=${3:-fish}; mkdir -p $P/$PK
for s in reading coding editing cmd search thinking planning waiting subagents done error; do enc $O/$MD/$PF-${s}_alpha.webm $P/$PK/$s & done; wait
# v2 states (大肥鱼 only): masters at $V2/<state>.webm
V2S="web download git test install create delete mcp memory media diff retry worried busy subtask denied interrupted sweat tired cheer coding_b reading_b cmd_b search_b thinking_b editing_b"
if [ -n "$V2" ]; then for s in $V2S; do ffmpeg -y -v error -c:v libvpx-vp9 -i $V2/$s.webm -vf "scale=384:384:flags=lanczos,fps=30" -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 38 -row-mt 1 -deadline good -cpu-used 2 -auto-alt-ref 0 -an $P/$PK/$s.webm & done; wait
  python3 "$(dirname "$0")/v2-webp.py" "${V2KEYS:?set V2KEYS to the keyframe folder}" $P/$PK $V2S; fi
echo ALLDONE
