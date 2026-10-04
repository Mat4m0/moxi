import type { Download, Profile, Readiness } from "./launcher-data";

export function profileStatus(profile: Profile): string {
  const states = {
    ready: "Ready",
    queued: "Waiting for game files",
    opening: "Opening",
    checking: "Checking the game window",
    running: "Open",
  };
  if (profile.state !== "failed") return states[profile.state];
  switch (profile.failure) {
    case "profile-preparation":
      return "Account files could not be prepared";
    case "window-startup":
      return "Game window did not open";
    case "client-validation":
      return "Game client check failed";
    case "renderer-crash":
      return "Game window closed unexpectedly";
    default:
      return "Could not open this account";
  }
}
export function launchLabel(profiles: readonly Profile[], readiness: Readiness): string {
  if (readiness.state === "repair-required") return "Open Game Files";
  if (profiles.some((profile) => profile.state === "queued")) return "Cancel waiting";
  if (profiles.some((profile) => profile.state === "checking"))
    return profiles.length === 1 ? "Checking game window…" : "Checking game windows…";
  if (profiles.some((profile) => profile.state === "opening"))
    return profiles.length === 1 ? "Opening account…" : "Opening accounts…";
  const closed = profiles.filter((profile) => profile.state !== "running").length;
  if (!closed) return profiles.length === 1 ? "Show" : "Accounts are open";
  return closed === 1 ? "Play" : `Open ${closed} accounts`;
}
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  const value = bytes / 1024 ** unit;
  return `${value.toFixed(value >= 10 || unit < 2 ? 0 : 1)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}
export function formatProgress(download: Download): string {
  const amount =
    download.total > 0
      ? `${formatBytes(download.received)} of ${formatBytes(download.total)}`
      : formatBytes(download.received);
  const speed = download.bytesPerSecond > 0 ? ` · ${formatBytes(download.bytesPerSecond)}/s` : "";
  const seconds = download.secondsRemaining;
  let remaining = "";
  if (seconds !== null) {
    const minutes = Math.ceil(seconds / 60);
    const duration =
      seconds < 60
        ? "less than a minute"
        : minutes < 60
          ? `${minutes} min`
          : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
    remaining = ` · ${duration} left`;
  }
  return amount + speed + remaining;
}
