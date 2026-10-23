// @vitest-environment happy-dom
import { afterEach, expect, test } from "vite-plus/test";
import { bridgeData } from "./launcher-data";
import { account, connectMain, disconnectMain, flush } from "./launcher-test-kit";

afterEach(disconnectMain);
async function open(...accounts: ReturnType<typeof account>[]) {
  const main = connectMain(accounts);
  const data = bridgeData();
  await data.initialize();
  return { main, data };
}

test("shows the accounts Main has, and nothing as open before a launch", async () => {
  const { data } = await open(account("a1", "Main account"), account("a2", "Heroes"));
  expect(data.state.value.accounts.map(({ name, state }) => [name, state])).toEqual([
    ["Main account", "closed"],
    ["Heroes", "closed"],
  ]);
});

test("a window opening or crashing in Main changes that account only", async () => {
  const { main, data } = await open(account("a1", "Main account"), account("a2", "Heroes"));
  main.changed([
    account("a1", "Main account", { state: "running" }),
    account("a2", "Heroes", { state: "failed", failure: "renderer-crash" }),
  ]);
  expect(data.state.value.accounts.map(({ state, failure }) => [state, failure])).toEqual([
    ["running", undefined],
    ["failed", "renderer-crash"],
  ]);
});

test("Play sends the chosen accounts to Main in the order given", async () => {
  const { main, data } = await open(account("a1", "Main account"), account("a2", "Heroes"));
  await data.play(["a2", "a1"]);
  expect(main.calls).toContainEqual(["accounts.play", { ids: ["a2", "a1"] }]);
});

test("a name Main would refuse is refused in the form, and Main is not asked", async () => {
  const { main, data } = await open(account("a1", "Main account"));
  expect(() => data.saveAccount({ id: "a3", name: "  " })).toThrow("Enter a name");
  expect(() => data.saveAccount({ id: "a3", name: "main ACCOUNT" })).toThrow("already uses");
  expect(main.names()).not.toContain("accounts.save");
});

test("a saved account shows Main's answer, with the name trimmed", async () => {
  const { main, data } = await open(account("a1", "Main account"));
  main.accounts = [account("a1", "Main account"), account("a3", "Mule")];
  data.saveAccount({ id: "a3", name: " Mule " });
  await flush();
  expect(main.calls).toContainEqual(["accounts.save", { id: "a3", name: "Mule" }]);
  expect(data.state.value.accounts.map(({ name }) => name)).toEqual(["Main account", "Mule"]);
});

test("when Main refuses a change the list is read again instead of keeping a guess", async () => {
  const { main, data } = await open(account("a1", "Main account"), account("a2", "Heroes"));
  main.refuse.add("accounts.archive");
  main.accounts = [account("a1", "Main account", { state: "running" }), account("a2", "Heroes")];
  data.archive("a1", true);
  await flush();
  expect(data.state.value.accounts.map(({ state }) => state)).toEqual(["running", "closed"]);
});

test("deleting an account archives it first and then removes it", async () => {
  const { main, data } = await open(account("a1", "Main account"), account("a2", "Heroes"));
  main.accounts = [account("a1", "Main account")];
  data.deleteAccount("a2");
  await flush();
  expect(
    main
      .names()
      .filter((name) => name !== "accounts.list")
      .slice(-2),
  ).toEqual(["accounts.archive", "accounts.remove"]);
  expect(data.state.value.accounts.map(({ name }) => name)).toEqual(["Main account"]);
});
