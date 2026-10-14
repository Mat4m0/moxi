#!/usr/bin/env bash
# PB10 case sequence (CI only). The order matters: each block changes system state.
set -u
R="${PB10_RESULTS:?}"
mkdir -p "$R"
DEB=$(ls out/legacy/*.deb | head -1)
AI_LEGACY=$(ls out/legacy/*.AppImage | head -1)
AI_STATIC=$(ls out/static/*.AppImage | head -1)
chmod +x "$AI_LEGACY" "$AI_STATIC"
run() { node probes/PB10/run.mjs "$@" || echo "PB10 driver failed for $1"; }

echo "::group::system"
uname -a
lsb_release -ds || true
sysctl -a 2>/dev/null | grep -i userns
ls -l "$DEB" "$AI_LEGACY" "$AI_STATIC"
echo "::endgroup::"

# The .desktop Exec line and the AppRun sandbox check each AppImage toolset generates (no app start).
for pair in "legacy:$AI_LEGACY" "static:$AI_STATIC"; do
  label=${pair%%:*}
  file=${pair#*:}
  dir=$(mktemp -d)
  (cd "$dir" && "$file" --appimage-extract >/dev/null 2>&1) || echo "extract failed for $label"
  exec_line=$(grep -h '^Exec=' "$dir"/squashfs-root/*.desktop 2>/dev/null | head -1)
  unshare_checks=$(grep -c 'unshare -Ur true' "$dir"/squashfs-root/AppRun 2>/dev/null || true)
  EXEC_LINE="$exec_line" LABEL="$label" CHECKS="$unshare_checks" node -e '
    const line = { probe: "PB10", case: `desktop-exec-${process.env.LABEL}`, exec: process.env.EXEC_LINE, appRunUnshareChecks: Number(process.env.CHECKS) };
    require("fs").writeFileSync(`${process.env.PB10_RESULTS}/desktop-exec-${process.env.LABEL}.json`, JSON.stringify(line));
    console.log(`PB10 ${JSON.stringify(line)}`);'
  rm -rf "$dir"
done

echo "::group::install deb"
sudo apt-get install -y "./$DEB"
ls -l /opt/Moxi/chrome-sandbox /etc/apparmor.d/moxi
cat /etc/apparmor.d/moxi
sudo aa-status | grep -n -B2 -A2 moxi || echo "moxi profile not listed"
echo "::endgroup::"

# 1. Default AppArmor (restrict_unprivileged_userns=1).
run deb-default -- /opt/Moxi/moxi
run deb-usr-bin-link -- /usr/bin/moxi
run deb-flag-no-sandbox -- /opt/Moxi/moxi --no-sandbox
run appimage-legacy-default -- "$AI_LEGACY"
run appimage-static-default -- "$AI_STATIC"

# 2. .deb with its profile removed.
sudo apparmor_parser -R /etc/apparmor.d/moxi
run deb-no-profile -- /opt/Moxi/moxi

# 3. Unprivileged user namespaces allowed system-wide (profile still removed).
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
run deb-no-profile-userns0 -- /opt/Moxi/moxi
run appimage-legacy-userns0 -- "$AI_LEGACY"
run appimage-static-userns0 -- "$AI_STATIC"

# 4. Explicit --no-sandbox where the sandbox would work.
run appimage-legacy-flag-no-sandbox-userns0 -- "$AI_LEGACY" --no-sandbox

sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1
