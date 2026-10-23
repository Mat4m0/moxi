export type AccountRuntime = { state: "closed" | "running" | "failed"; failure?: "renderer-crash" };
export type PlayStep = { accountId: string; do: "open" | "show" };

/**
 * Which game window each account has. Electron-free: the shell opens the windows this decides
 * on and reports back when one opens or ends.
 */
export function createGameWindows() {
  const runtime = new Map<string, AccountRuntime>();
  return {
    /** One step per account that may be played: a running account is shown, any other is opened. */
    play(ids: readonly string[], playable: ReadonlySet<string>): PlayStep[] {
      const steps: PlayStep[] = [];
      for (const accountId of new Set(ids))
        if (playable.has(accountId))
          steps.push({
            accountId,
            do: runtime.get(accountId)?.state === "running" ? "show" : "open",
          });
      return steps;
    },
    opened(accountId: string) {
      runtime.set(accountId, { state: "running" });
    },
    /** A crash is kept so the launcher can say so until the account is opened again. */
    ended(accountId: string, crashed: boolean) {
      runtime.set(
        accountId,
        crashed ? { state: "failed", failure: "renderer-crash" } : { state: "closed" },
      );
    },
    state(accountId: string): AccountRuntime {
      return runtime.get(accountId) ?? { state: "closed" };
    },
    running(accountId: string) {
      return runtime.get(accountId)?.state === "running";
    },
    forget(accountId: string) {
      runtime.delete(accountId);
    },
  };
}
