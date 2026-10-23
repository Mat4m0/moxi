// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { Account } from "@moxi/contracts";
import { bridgeData } from "./launcher-data";

const look = { icon: "swords", color: "#9a6638" } as const;
const account = (id: string, name: string, extra: Partial<Account> = {}): Account => ({
  id,
  name,
  archived: false,
  appearance: look,
  state: "closed",
  ...extra,
});

function connect(initial: Account[]) {
  let changed: (accounts: Account[]) => void = () => undefined;
  const invoke = vi.fn(async (name: string, request: unknown) => {
    if (name === "accounts.list") return initial;
    if (name === "client.readiness") return { state: "playable", backgroundDownload: null };
    if (name === "app.info") return { productName: "Moxi", version: "0.1.0", channel: "dev" };
    if (name === "appearance.get")
      return { uiStyle: "classic", uiPanelOpacity: 94, uiFont: "guild-wars" };
    return request === undefined ? undefined : initial;
  });
  Object.assign(window, {
    moxi: {
      invoke,
      onReadinessChanged: () => () => undefined,
      onNavigate: () => () => undefined,
      onAccountsChanged: (listener: (accounts: Account[]) => void) => {
        changed = listener;
        return () => undefined;
      },
    },
  });
  return { invoke, emit: (accounts: Account[]) => changed(accounts) };
}
afterEach(() => {
  Reflect.deleteProperty(window, "moxi");
});

test("shows the accounts Main has, none of the fixture accounts, and nothing as running before launch", async () => {
  connect([account("a1", "Main account"), account("a2", "Heroes")]);
  const data = bridgeData();
  await data.initialize();
  expect(data.state.value.profiles.map(({ name, state }) => [name, state])).toEqual([
    ["Main account", "ready"],
    ["Heroes", "ready"],
  ]);
  expect(data.state.value.selectedProfileIds).toEqual(["a1"]);
});

test("a window opening or crashing in Main changes that account only", async () => {
  const main = connect([account("a1", "Main account"), account("a2", "Heroes")]);
  const data = bridgeData();
  await data.initialize();
  main.emit([
    account("a1", "Main account", { state: "running" }),
    account("a2", "Heroes", { state: "failed", failure: "renderer-crash" }),
  ]);
  expect(data.state.value.profiles.map(({ state, failure }) => [state, failure])).toEqual([
    ["running", undefined],
    ["failed", "renderer-crash"],
  ]);
});

test("the selection survives an update unless its account went away", async () => {
  const main = connect([account("a1", "Main account"), account("a2", "Heroes")]);
  const data = bridgeData();
  await data.initialize();
  data.toggle("a2");
  main.emit([account("a1", "Main account"), account("a2", "Heroes", { state: "running" })]);
  expect(data.state.value.selectedProfileIds).toEqual(["a1", "a2"]);
  main.emit([account("a1", "Main account")]);
  expect(data.state.value.selectedProfileIds).toEqual(["a1"]);
});

test("Play sends the chosen accounts to Main", async () => {
  const main = connect([account("a1", "Main account"), account("a2", "Heroes")]);
  const data = bridgeData();
  await data.initialize();
  await data.play(["a1", "a2"]);
  expect(main.invoke).toHaveBeenCalledWith("accounts.play", { ids: ["a1", "a2"] });
});

test("a name Main would refuse is refused in the form, and Main is not asked", async () => {
  const main = connect([account("a1", "Main account")]);
  const data = bridgeData();
  await data.initialize();
  const edit = { id: "a3", appearance: look };
  expect(() => data.saveProfile({ ...edit, name: "  " })).toThrow("Enter a name");
  expect(() => data.saveProfile({ ...edit, name: "main ACCOUNT" })).toThrow("already uses");
  expect(main.invoke).not.toHaveBeenCalledWith("accounts.save", expect.anything());
});

test("a saved account shows at once, and Main's answer replaces the local guess", async () => {
  const main = connect([account("a1", "Main account")]);
  const data = bridgeData();
  await data.initialize();
  data.saveProfile({ id: "a3", name: " Mule ", appearance: look });
  expect(data.state.value.profiles.map(({ name }) => name)).toEqual(["Main account", "Mule"]);
  expect(main.invoke).toHaveBeenCalledWith("accounts.save", {
    id: "a3",
    name: "Mule",
    appearance: look,
  });
});
