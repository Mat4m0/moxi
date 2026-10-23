import type { Account } from "@moxi/contracts";

// Which launcher and game windows are shown or hidden, and the native Accounts menu. Electron-free:
// the shell applies what these decide.

/** After Play, the launcher steps aside only when a game window is now in front of the player. */
export function afterPlay(shown: number): "hide-launcher" | "keep-launcher" {
  return shown > 0 ? "hide-launcher" : "keep-launcher";
}

/** Closing the launcher hides it while a game is open; quitting always lets it close. */
export function onLauncherClose(state: {
  gameWindows: number;
  quitting: boolean;
}): "hide" | "close" {
  return state.gameWindows > 0 && !state.quitting ? "hide" : "close";
}

/** The launcher comes back when the last game closes, so the player is never left with no window. */
export function onGameClosed(state: {
  gameWindows: number;
  quitting: boolean;
}): "reveal-launcher" | "nothing" {
  return state.gameWindows === 0 && !state.quitting ? "reveal-launcher" : "nothing";
}

export type AccountMenuEntry = { id: string; label: string; enabled: boolean };

const SUFFIX = { closed: "", running: " — Open", failed: " — Try again" } as const;

/** One entry per account that is not archived: a running account is shown, any other is opened. */
export function accountMenuModel(accounts: readonly Account[]): AccountMenuEntry[] {
  return accounts
    .filter((account) => !account.archived)
    .map((account) => ({
      id: account.id,
      label: `${account.name}${SUFFIX[account.state]}`,
      enabled: true,
    }));
}

/** The menu is rebuilt only when this says it changed, so open menus are not disturbed. */
export function sameMenuModel(a: readonly AccountMenuEntry[], b: readonly AccountMenuEntry[]) {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.id === b[index]?.id &&
        entry.label === b[index]?.label &&
        entry.enabled === b[index]?.enabled,
    )
  );
}
