// @vitest-environment happy-dom
import { afterEach, expect, test } from "vite-plus/test";
import { createApp, nextTick, type App as VueApp } from "vue";
import type { Readiness, Tool } from "@moxi/contracts";
import App from "./App.vue";
import { bridgeData } from "./launcher-data";
import { account, connectMain, disconnectMain, flush, tool } from "./launcher-test-kit";

let application: VueApp | undefined;
afterEach(() => {
  application?.unmount();
  application = undefined;
  document.body.replaceChildren();
  disconnectMain();
});
async function settle() {
  await flush();
  await nextTick();
  await nextTick();
}
async function mount(
  accounts = [account("main", "Main account"), account("storage", "Storage account")],
  readiness?: Readiness,
  tools: Tool[] = [],
) {
  const main = connectMain(accounts, readiness, tools);
  const container = document.createElement("div");
  document.body.append(container);
  application = createApp(App, { data: bridgeData() });
  application.mount(container);
  await settle();
  return main;
}
function button(label: string, within: ParentNode = document): HTMLButtonElement {
  const found = [...within.querySelectorAll("button")].find(
    (element) => (element.getAttribute("aria-label") ?? element.textContent?.trim()) === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label: string, within: ParentNode = document) {
  button(label, within).click();
  await settle();
}
const confirmation = () => document.querySelector(".confirm-delete") ?? document;
function input(label: string): HTMLInputElement {
  const element = document.querySelector(`input[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input: ${label}`);
  return element;
}
async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}
const names = () => [...document.querySelectorAll(".account-card h2")].map((h) => h.textContent);

test("the launcher names itself and lists the accounts Main has", async () => {
  await mount();
  expect(document.querySelector(".brand")?.textContent).toBe("MoxiVersion 0.1.0");
  expect(names()).toEqual(["Main account", "Storage account"]);
});

test.each([
  ["closed", "Play Main account"],
  ["failed", "Try again for Main account"],
  ["running", "Show Main account"],
] as const)("a %s account offers %s", async (state, label) => {
  await mount([account("main", "Main account", { state })]);
  expect(button(label).disabled).toBe(false);
});

test("Play and Show send only the account whose button was pressed", async () => {
  const main = await mount();
  await click("Play Storage account");
  expect(main.calls).toContainEqual(["accounts.play", { ids: ["storage"] }]);
});

test("nothing can be opened while the game client is still preparing", async () => {
  const main = await mount(undefined, {
    state: "preparing",
    progress: {
      status: "running",
      received: 620,
      total: 1100,
      bytesPerSecond: null,
      secondsRemaining: null,
    },
  });
  expect(button("Play Main account").disabled).toBe(true);
  expect(document.body.textContent).toContain("Preparing Guild Wars · 56%");
  expect(main.names()).not.toContain("accounts.play");
});

test("when the game files need repair, Play opens Game files instead of the game", async () => {
  const main = await mount(undefined, { state: "repair-required" });
  await click("Repair game files for Main account");
  expect(document.querySelector("h1")?.textContent).toBe("Game files");
  expect(main.names()).not.toContain("accounts.play");
});

test("Add account sends a trimmed name, and a refused name is explained in the form", async () => {
  const main = await mount();
  await click("Add account");
  const name = document.querySelector<HTMLInputElement>(".modal input");
  if (!name) throw new Error("Missing name");
  await change(name, "storage ACCOUNT");
  document.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Another account already uses this name.",
  );
  expect(main.names()).not.toContain("accounts.save");

  await change(name, "  Mule ");
  document.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
  expect(main.calls).toContainEqual([
    "accounts.save",
    {
      id: expect.any(String),
      name: "Mule",
    },
  ]);
  expect(document.querySelector(".modal")).toBeNull();
});

test("Escape closes the editor and gives focus back to where it opened", async () => {
  await mount();
  const add = button("Add account");
  add.focus();
  await click("Add account");
  document
    .querySelector('[role="dialog"]')
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(add);
});

test("deleting an account asks first and only then archives and removes it", async () => {
  const main = await mount();
  await click("Edit Main account");
  await click("Delete");
  expect(document.querySelector("#account-delete-title")?.textContent).toBe("Delete Main account?");

  await click("Cancel", confirmation());
  expect(main.names()).not.toContain("accounts.remove");

  await click("Delete");
  await click("Delete account", confirmation());
  expect(main.calls).toContainEqual(["accounts.archive", { id: "main", archived: true }]);
  expect(main.calls).toContainEqual(["accounts.remove", { id: "main" }]);
});

test.each([
  ["an open account", [account("a", "Open", { state: "running" }), account("b", "Other")]],
  ["the only account", [account("a", "Open")]],
] as const)("%s cannot be archived or deleted from the editor", async (_case, accounts) => {
  await mount([...accounts]);
  await click("Edit Open");
  expect(document.querySelector(".archive-account-row")).toBeNull();
});

test("an archived account is restored, or deleted after the confirmation", async () => {
  const main = await mount([
    account("main", "Main account"),
    account("old", "Old", { archived: true }),
  ]);
  document.querySelector("details.archived-accounts")?.setAttribute("open", "");
  await click("Restore");
  expect(main.calls).toContainEqual(["accounts.archive", { id: "old", archived: false }]);

  await click("Delete permanently");
  expect(main.names()).not.toContain("accounts.remove");
  await click("Delete account", confirmation());
  expect(main.calls).toContainEqual(["accounts.remove", { id: "old" }]);
});

test("Main can bring the launcher back to the accounts from Settings", async () => {
  const main = await mount();
  await click("Settings");
  expect(document.querySelector(".settings-page")).not.toBeNull();
  main.navigate("accounts");
  await settle();
  expect(document.querySelector(".settings-page")).toBeNull();
  expect(names()).toHaveLength(2);
});

test("Tools lists every bundled plugin with its switch, and a switch asks Main to save it", async () => {
  const main = await mount(undefined, undefined, [
    tool("moxi.builds", "Builds"),
    tool("moxi.calculator", "Calculator", false),
  ]);
  await click("Settings");
  expect(document.querySelector("h1")?.textContent).toBe("Tools");
  expect(input("Builds").checked).toBe(true);
  expect(input("Calculator").checked).toBe(false);

  input("Calculator").click();
  await settle();
  expect(main.calls).toContainEqual(["tools.set", { id: "moxi.calculator", enabled: true }]);
  expect(input("Calculator").checked).toBe(true);
});

test("a switch Main refuses goes back to what Main has", async () => {
  const main = await mount(undefined, undefined, [tool("moxi.builds", "Builds")]);
  await click("Settings");
  main.refuse.add("tools.set");
  input("Builds").click();
  await settle();
  expect(main.names()).toContain("tools.set");
  expect(input("Builds").checked).toBe(true);
});

test("Game files pauses and resumes the background download", async () => {
  const main = await mount(undefined, {
    state: "playable",
    backgroundDownload: {
      status: "running",
      received: 840,
      total: 910,
      bytesPerSecond: 12,
      secondsRemaining: 56,
    },
  });
  await click("View download");
  await click("Pause");
  expect(main.calls).toContainEqual(["download.pause", undefined]);
  main.readinessChanged({
    state: "playable",
    backgroundDownload: {
      status: "paused",
      received: 840,
      total: 910,
      bytesPerSecond: null,
      secondsRemaining: null,
    },
  });
  await settle();
  await click("Resume");
  expect(main.calls).toContainEqual(["download.resume", undefined]);
});

test("a failed start shows a plain message that can be dismissed", async () => {
  const main = await mount();
  main.refuse.add("accounts.play");
  await click("Play Main account");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not be opened");
  await click("Dismiss error");
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

async function mark(name: string) {
  input(`Select ${name}`).click();
  await settle();
}
const playSelected = (count: number) => button(`Play selected (${count})`);

test("Play selected is disabled until an account is marked", async () => {
  await mount();
  expect(playSelected(0).disabled).toBe(true);
  await mark("Main account");
  expect(playSelected(1).disabled).toBe(false);
});

test("Play selected opens only the marked accounts and leaves them marked", async () => {
  const main = await mount([
    account("main", "Main account"),
    account("storage", "Storage account"),
    account("third", "Third account"),
  ]);
  await mark("Main account");
  await mark("Third account");
  await click("Play selected (2)");
  expect(main.calls).toContainEqual(["accounts.play", { ids: ["main", "third"] }]);
  expect(playSelected(2).disabled).toBe(false);
  expect(input("Select Main account").checked).toBe(true);
  expect(input("Select Storage account").checked).toBe(false);
});

test("ticking asks Main to mark the account, and the box shows what Main answers", async () => {
  const main = await mount([
    account("main", "Main account"),
    account("storage", "Storage account"),
  ]);
  await mark("Main account");
  await mark("Storage account");
  expect(main.calls).toContainEqual(["accounts.select", { ids: ["main"] }]);
  expect(main.calls).toContainEqual(["accounts.select", { ids: ["main", "storage"] }]);
  await mark("Main account");
  expect(main.calls.at(-1)).toEqual(["accounts.select", { ids: ["storage"] }]);
  expect(input("Select Main account").checked).toBe(false);
});

test("the marks Main has saved are shown when the launcher opens", async () => {
  await mount([account("main", "Main account", { selected: true }), account("b", "B account")]);
  expect(input("Select Main account").checked).toBe(true);
  expect(input("Select B account").checked).toBe(false);
  expect(playSelected(1).disabled).toBe(false);
});

test.each([
  ["starts only the closed accounts", ["running", "closed"], ["storage"]],
  ["shows the first marked account when all are open", ["running", "running"], ["main"]],
] as const)("Play selected %s", async (_case, states, ids) => {
  const main = await mount([
    account("main", "Main account", { state: states[0] }),
    account("storage", "Storage account", { state: states[1] }),
  ]);
  await mark("Main account");
  await mark("Storage account");
  await click("Play selected (2)");
  expect(main.calls).toContainEqual(["accounts.play", { ids }]);
});

test("a refused Play selected keeps the marks so it can be tried again", async () => {
  const main = await mount();
  main.refuse.add("accounts.play");
  await mark("Main account");
  await click("Play selected (1)");
  expect(playSelected(1).disabled).toBe(false);
  expect(input("Select Main account").checked).toBe(true);
});

test("an account that Main archives or deletes no longer counts as marked", async () => {
  const main = await mount([
    account("main", "Main account", { selected: true }),
    account("storage", "Storage account", { selected: true }),
  ]);
  expect(playSelected(2).disabled).toBe(false);
  main.changed([
    account("main", "Main account", { selected: true }),
    account("storage", "Storage account", { archived: true, selected: true }),
  ]);
  await settle();
  expect(playSelected(1).disabled).toBe(false);
  main.changed([account("other", "Other account")]);
  await settle();
  expect(playSelected(0).disabled).toBe(true);
});

test("Settings is a tab beside Accounts, the current tab is marked, and the layout is the same", async () => {
  await mount();
  const current = () =>
    [...document.querySelectorAll("nav button[aria-current]")].map((tab) =>
      tab.textContent?.trim(),
    );
  expect(current()).toEqual(["Accounts"]);
  const shell = document.querySelector(".app-shell")?.className;
  await click("Settings");
  expect(current()).toEqual(["Settings"]);
  expect(document.querySelector(".settings-page")).not.toBeNull();
  expect(document.querySelector(".app-shell")?.className).toBe(shell);
  expect(document.querySelectorAll("nav button").length).toBe(2);
  await click("Accounts");
  expect(current()).toEqual(["Accounts"]);
  expect(document.querySelector(".accounts-page")).not.toBeNull();
});
