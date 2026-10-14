#!/usr/bin/env bash
# Runs a command inside the xvfb display with a window manager (openbox), so that minimize,
# restore and focus work. Usage: xvfb-run -a -s "-screen 0 1920x1080x24" bash session.sh <command...>
# If PB_DONE_FILE is set and appears, the command gets 15 s to exit and is then killed: Electron
# sometimes hangs at teardown after the result is written.
set -u
openbox >/tmp/openbox.log 2>&1 &
wm=$!
sleep 2
echo "display=$DISPLAY wm_pid=$wm $(xdotool getdisplaygeometry 2>/dev/null)"
"$@" &
cmd=$!
while kill -0 "$cmd" 2>/dev/null; do
  if [ -n "${PB_DONE_FILE:-}" ] && [ -e "$PB_DONE_FILE" ]; then
    sleep 15
    if kill -0 "$cmd" 2>/dev/null; then
      echo "session.sh: command still alive after the result was written, killing it"
      pkill -9 -f "/node_modules/electron/dist/" || true
      kill -9 "$cmd" 2>/dev/null || true
    fi
    break
  fi
  sleep 2
done
wait "$cmd" 2>/dev/null
code=$?
kill "$wm" 2>/dev/null || true
if [ -n "${PB_DONE_FILE:-}" ] && [ -e "$PB_DONE_FILE" ]; then code=0; fi
exit "$code"
