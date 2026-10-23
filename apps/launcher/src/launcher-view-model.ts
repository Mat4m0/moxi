import type { Account, Download } from "./launcher-data";

export function accountStatus(account: Account): string {
  if (account.state === "closed") return "Ready";
  if (account.state === "running") return "Open";
  return account.failure === "renderer-crash"
    ? "Game window closed unexpectedly"
    : "Could not open this account";
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
  const speed =
    download.bytesPerSecond !== null && download.bytesPerSecond > 0
      ? ` · ${formatBytes(download.bytesPerSecond)}/s`
      : "";
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
