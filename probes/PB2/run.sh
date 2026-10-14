#!/usr/bin/env bash
# Runs each PB2 case in a fresh Electron process and collects JSON lines in $PB2_OUT.
set -u
OUT="${PB2_OUT:-pb2-out/pb2.jsonl}"
CASES="${PB2_CASES:-baseline crash A B C-honest A-hold C-lying B A A B}"
DIR="$(dirname "$OUT")"
mkdir -p "$DIR"
: > "$OUT"
LINUX=0
[ "$(uname -s)" = "Linux" ] && LINUX=1

disk_report() {
  echo "--- disk: $(df -h / | tail -1)"
  if [ "$LINUX" = 1 ]; then
    sudo du -xsh /tmp /var/crash /var/lib/apport /var/lib/systemd/coredump "$HOME/.config" "$DIR" 2>/dev/null | tr '\n' ' '
    echo
  fi
}

sidecar_pid=""
if [ "$LINUX" = 1 ]; then
  # Chromium renderers are not dumpable, so only root can read their smaps_rollup.
  SMAPS="$DIR/smaps-linux.jsonl"
  : > "$SMAPS"
  (
    while :; do
      ts=$(date +%s%3N)
      for p in $(pgrep -f 'electron/dist/electron' || true); do
        v=$(sudo awk '/^Pss:/{a=$2} /^Private_Clean:/{b=$2} /^Private_Dirty:/{c=$2} END{printf "%d,%d,%d", a, b, c}' "/proc/$p/smaps_rollup" 2>/dev/null) || continue
        echo "{\"kind\":\"smaps\",\"ts\":$ts,\"pid\":$p,\"pssKb_privCleanKb_privDirtyKb\":\"$v\"}"
      done >> "$SMAPS"
      # Disk guard: run 2 lost the runner to a full disk. Kill Electron before that happens again.
      avail=$(df --output=avail -k / | tail -1)
      if [ "$avail" -lt 3000000 ]; then
        echo "{\"probe\":\"PB2\",\"kind\":\"disk-guard\",\"ts\":$ts,\"availKb\":$avail}" >> "$OUT"
        pkill -9 -f 'electron/dist/electron' || true
        sudo du -xsh /tmp /var/crash /var/lib/apport /var/lib/systemd/coredump "$HOME/.config" "$DIR" 2>/dev/null >> "$DIR/disk-guard.txt"
        sudo find / -xdev -size +500M -newer "$OUT" 2>/dev/null >> "$DIR/disk-guard.txt"
      fi
      sleep 0.5
    done
  ) &
  sidecar_pid=$!
fi

disk_report
i=0
for c in $CASES; do
  i=$((i + 1))
  echo "=== PB2 case $c (run $i) ==="
  LOG="$DIR/electron-$i-$c.log"
  start=$(date +%s)
  if [ "$LINUX" = 1 ]; then
    xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24" pnpm exec electron probes/PB2 "--pb2-case=$c" "--pb2-rep=$i" "--pb2-out=$OUT" > "$LOG" 2>&1
  else
    pnpm exec electron probes/PB2 "--pb2-case=$c" "--pb2-rep=$i" "--pb2-out=$OUT" > "$LOG" 2>&1
  fi
  code=$?
  # Keep logs small even if Chromium floods stderr.
  if [ "$(wc -c < "$LOG")" -gt 2000000 ]; then
    head -c 1000000 "$LOG" > "$LOG.head"
    tail -c 1000000 "$LOG" > "$LOG.tail"
    rm -f "$LOG"
    LOG="$LOG.tail"
  fi
  grep -E '"kind":"(event|fatal)"' "$LOG" | cut -c1-600 || true
  grep -v '"probe":"PB2"' "$LOG" | tail -n 15 | cut -c1-300 || true
  line="{\"probe\":\"PB2\",\"kind\":\"exit\",\"case\":\"$c\",\"rep\":$i,\"code\":$code,\"wallS\":$(($(date +%s) - start))}"
  echo "$line"
  echo "$line" >> "$OUT"
  disk_report
  sleep 3
done

if [ -n "$sidecar_pid" ]; then
  kill "$sidecar_pid" 2>/dev/null || true
  echo "=== kernel OOM messages ==="
  sudo dmesg 2>/dev/null | grep -i -E "out of memory|oom|killed process" | tail -30 || true
fi
exit 0
