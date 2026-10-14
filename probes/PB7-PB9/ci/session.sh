#!/usr/bin/env bash
# Runs a command inside the xvfb display with a window manager (openbox), so that minimize,
# restore and focus work. Usage: xvfb-run -a -s "-screen 0 1920x1080x24" bash session.sh <command...>
set -u
openbox >/tmp/openbox.log 2>&1 &
wm=$!
sleep 2
echo "display=$DISPLAY wm_pid=$wm $(xdotool getdisplaygeometry 2>/dev/null)"
"$@"
code=$?
kill "$wm" 2>/dev/null || true
exit "$code"
