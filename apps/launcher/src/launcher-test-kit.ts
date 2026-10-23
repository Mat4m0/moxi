import type { Account, Readiness } from "@moxi/contracts";

export const account = (id: string, name: string, extra: Partial<Account> = {}): Account => ({
  id,
  name,
  archived: false,
  selected: false,
  state: "closed",
  ...extra,
});

/** A stand-in for Main: answers the launcher's channels and records what it was asked. */
export function connectMain(
  initial: Account[],
  readiness: Readiness = { state: "playable", backgroundDownload: null },
) {
  const main = {
    accounts: initial,
    refuse: new Set<string>(),
    navigate: (_destination: "accounts") => {},
    changed: (_accounts: Account[]) => {},
    readinessChanged: (_readiness: Readiness) => {},
    calls: [] as [string, unknown][],
    /** The channels the launcher has used, in order. */
    names: () => main.calls.map(([name]) => name),
    invoke: async (name: string, request: unknown) => {
      main.calls.push([name, request]);
      if (main.refuse.has(name)) throw new Error("refused");
      if (name === "client.readiness") return readiness;
      if (name === "app.info") return { productName: "Moxi", version: "0.1.0", channel: "dev" };
      if (name === "appearance.get")
        return { uiStyle: "classic", uiPanelOpacity: 94, uiFont: "guild-wars" };
      if (name === "accounts.select") {
        const marked = new Set((request as { ids: string[] }).ids);
        main.accounts = main.accounts.map((entry) => ({
          ...entry,
          selected: marked.has(entry.id),
        }));
        return main.accounts;
      }
      if (name.startsWith("accounts.") && name !== "accounts.play") return main.accounts;
      return undefined;
    },
  };
  Object.assign(window, {
    moxi: {
      invoke: main.invoke,
      onReadinessChanged: (listener: (readiness: Readiness) => void) => {
        main.readinessChanged = listener;
        return () => undefined;
      },
      onNavigate: (listener: (destination: "accounts") => void) => {
        main.navigate = listener;
        return () => undefined;
      },
      onAccountsChanged: (listener: (accounts: Account[]) => void) => {
        main.changed = listener;
        return () => undefined;
      },
    },
  });
  return main;
}
export const disconnectMain = () => Reflect.deleteProperty(window, "moxi");
/** Lets every promise that is already settled run its continuations; no timers involved. */
export async function flush() {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}
