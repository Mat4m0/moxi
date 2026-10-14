#!/usr/bin/env bash
# Runs each PB14 launch in a fresh Electron process under xvfb. Plan items are
# <arm>:<first account>[:hidden], for example "partitioned:a shared:b partitioned:a:hidden".
set -u
OUT_DIR="${PB14_OUT_DIR:-pb14-out}"
PLAN="${PB14_PLAN:-partitioned:a shared:b partitioned:b shared:a partitioned:a}"
mkdir -p "$OUT_DIR"
i=0
for item in $PLAN; do
  i=$((i + 1))
  IFS=: read -r arm first mode <<<"$item"
  show=1
  [ "${mode:-}" = "hidden" ] && show=0
  tag="$i-$arm-$first${mode:+-$mode}"
  echo "=== PB14 launch $tag ==="
  start=$(date +%s)
  sampler=""
  if [ "$(uname -s)" = "Linux" ]; then
    # Absolute node path: sudo resets PATH.
    sudo -n "$(command -v node)" probes/PB14/sampler.mjs "$OUT_DIR/mem-$tag.jsonl" &
    sampler=$!
  fi
  PB14_ARM="$arm" PB14_FIRST="$first" PB14_SHOW="$show" PB14_LAUNCH="$i" \
    PB14_OUT="$OUT_DIR/launch-$tag.jsonl" PB14_WORK="$(mktemp -d)" \
    timeout 900 xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24" \
    pnpm exec electron probes/PB14 >"$OUT_DIR/electron-$tag.log" 2>&1
  code=$?
  if [ -n "$sampler" ]; then
    sudo -n pkill -TERM -f probes/PB14/sampler.mjs || true
    wait "$sampler" 2>/dev/null || true
  fi
  echo "PB14 exit launch=$tag code=$code wallS=$(($(date +%s) - start))"
  # Keep logs small even if Chromium floods stderr.
  if [ "$(wc -c <"$OUT_DIR/electron-$tag.log")" -gt 1500000 ]; then
    tail -c 700000 "$OUT_DIR/electron-$tag.log" >"$OUT_DIR/electron-$tag.log.tail"
    rm -f "$OUT_DIR/electron-$tag.log"
  fi
  grep -E '"kind":"(summary|fatal|error|renderer-gone)"' "$OUT_DIR/launch-$tag.jsonl" | cut -c1-700 || true
  sleep 3
done
exit 0
