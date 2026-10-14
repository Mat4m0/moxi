#!/usr/bin/env bash
# Runs each PB2 case in a fresh Electron process and collects JSON lines in $PB2_OUT.
set -u
OUT="${PB2_OUT:-pb2-out/pb2.jsonl}"
CASES="${PB2_CASES:-baseline crash A B C-honest A-hold C-lying B A A B}"
mkdir -p "$(dirname "$OUT")"
: > "$OUT"

sidecar_pid=""
if [ "$(uname -s)" = "Linux" ]; then
  # Chromium renderers are not dumpable, so only root can read their smaps_rollup.
  SMAPS="$(dirname "$OUT")/smaps-linux.jsonl"
  : > "$SMAPS"
  (
    while :; do
      ts=$(date +%s%3N)
      for p in $(pgrep -f 'electron' || true); do
        v=$(sudo awk '/^Pss:/{a=$2} /^Private_Clean:/{b=$2} /^Private_Dirty:/{c=$2} END{printf "%d,%d,%d", a, b, c}' "/proc/$p/smaps_rollup" 2>/dev/null) || continue
        echo "{\"kind\":\"smaps\",\"ts\":$ts,\"pid\":$p,\"pssKb_privCleanKb_privDirtyKb\":\"$v\"}"
      done >> "$SMAPS"
      sleep 0.5
    done
  ) &
  sidecar_pid=$!
fi

i=0
for c in $CASES; do
  i=$((i + 1))
  echo "=== PB2 case $c (run $i) ==="
  start=$(date +%s)
  if [ "$(uname -s)" = "Linux" ]; then
    xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24" pnpm exec electron probes/PB2 "--pb2-case=$c" "--pb2-rep=$i" "--pb2-out=$OUT"
  else
    pnpm exec electron probes/PB2 "--pb2-case=$c" "--pb2-rep=$i" "--pb2-out=$OUT"
  fi
  code=$?
  line="{\"probe\":\"PB2\",\"kind\":\"exit\",\"case\":\"$c\",\"rep\":$i,\"code\":$code,\"wallS\":$(($(date +%s) - start))}"
  echo "$line"
  echo "$line" >> "$OUT"
  sleep 3
done

if [ -n "$sidecar_pid" ]; then
  kill "$sidecar_pid" 2>/dev/null || true
  echo "=== kernel OOM messages ==="
  sudo dmesg 2>/dev/null | grep -i -E "out of memory|oom|killed process" | tail -20 || true
fi
exit 0
