// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createApp, nextTick, type App as VueApp } from "vue";
import App from "./App.vue";
import RangeControl from "./components/RangeControl.vue";
import { fixtureData, type LauncherData, type Profile } from "./launcher-data";
import { launchLabel } from "./launcher-view-model";

let application: VueApp | undefined;
afterEach(() => {
  application?.unmount();
  application = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});
async function settle() {
  await nextTick();
  await nextTick();
  await nextTick();
}
async function mount(data = fixtureData()) {
  data.rotateNews(false);
  const container = document.createElement("div");
  document.body.append(container);
  application = createApp(App, { data });
  application.mount(container);
  await settle();
  return data;
}
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (element) => (element.getAttribute("aria-label") ?? element.textContent?.trim()) === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label: string) {
  button(label).click();
  await settle();
}
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
async function appearance() {
  await click("Settings");
  await click("Appearance");
}

test("account picker Escape restores focus rather than leaving keyboard users in a removed panel", async () => {
  await mount();
  const trigger = button("Choose accounts, Main account");
  trigger.click();
  await settle();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Play Main account");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  expect(document.querySelector("#profile-picker")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test("moving focus or clicking outside closes the picker instead of leaving it over another view", async () => {
  await mount();
  await click("Choose accounts, Main account");
  button("Settings").focus();
  await settle();
  expect(document.querySelector("#profile-picker")).toBeNull();
  await click("Choose accounts, Main account");
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await settle();
  expect(document.querySelector("#profile-picker")).toBeNull();
});

test("the last selected account cannot be removed and mixed open selections launch only closed accounts", async () => {
  const data = await mount();
  await click("Accounts");
  expect(input("Select Main account").disabled).toBe(true);
  data.toggle("main");
  expect(data.state.value.selectedProfileIds).toEqual(["main"]);
  input("Select Storage account").click();
  await settle();
  expect(data.state.value.selectedProfileIds).toEqual(["main", "storage"]);
  expect(button("Play").disabled).toBe(false);
  await click("Play");
  expect(data.state.value.profiles.map((profile) => profile.state)).toEqual(["running", "running"]);
  expect(button("Accounts are open").disabled).toBe(true);
});

test("picker Show opens the existing account without selecting it for a second launch", async () => {
  const data = await mount();
  await click("Choose accounts, Main account");
  await click("Show Storage account");
  expect(data.state.value.selectedProfileIds).toEqual(["main"]);
  expect(data.state.value.profiles[1]?.state).toBe("running");
});

test.each([
  ["ready", "Play", false],
  ["opening", "Opening account…", true],
  ["checking", "Checking game window…", true],
  ["queued", "Cancel waiting", false],
  ["failed", "Play", false],
  ["running", "Show", false],
] as const)(
  "a %s account cannot receive an inappropriate duplicate launch",
  async (state, label, disabled) => {
    const data = fixtureData();
    data.state.value = {
      ...data.state.value,
      profiles: data.state.value.profiles.map((profile) =>
        profile.id === "main" ? { ...profile, state } : profile,
      ),
    };
    await mount(data);
    expect(button(label).disabled).toBe(disabled);
    if (state === "queued") {
      await click(label);
      expect(data.state.value.profiles[0]?.state).toBe("ready");
    }
  },
);

test("repair remains reachable with multiple open accounts and removes the duplicate action in Game files", async () => {
  const data = fixtureData("?fixture=repair");
  data.state.value = {
    ...data.state.value,
    selectedProfileIds: ["main", "storage"],
    profiles: data.state.value.profiles.map((profile) => ({ ...profile, state: "running" })),
  };
  await mount(data);
  expect(button("Open Game Files").disabled).toBe(false);
  await click("Open Game Files");
  expect(document.querySelector("h1")?.textContent).toBe("Game files");
  expect(
    [...document.querySelectorAll("button")].some(
      (element) => element.textContent?.trim() === "Open Game Files",
    ),
  ).toBe(false);
  await click("Repair game files");
  expect(data.state.value.readiness).toEqual({ state: "playable", backgroundDownload: null });
});

test("paused background downloads stay visible and can resume without disabling Play", async () => {
  const data = await mount();
  await click("View download");
  await click("Pause");
  expect(document.querySelector(".readiness")?.textContent).toContain("Game file download paused");
  expect(button("Play").disabled).toBe(false);
  await click("Resume");
  expect(document.querySelector(".readiness progress")?.getAttribute("value")).toBe("92");
  expect(data.state.value.readiness.state).toBe("playable");
});

test("appearance style changes preserve custom colors and invalid opacity cannot overwrite the saved value", async () => {
  const data = await mount();
  await appearance();
  const selects = document.querySelectorAll("select");
  const style = selects[0];
  if (!style) throw new Error("Missing style");
  await change(style, "custom");
  await change(input("Accent hex"), "ABCDEF");
  expect(data.state.value.settings.uiCustomTheme.accent).toBe("#abcdef");
  await change(style, "classic");
  await change(style, "custom");
  expect(input("Accent hex").value).toBe("#abcdef");
  await change(input("Panel opacity value"), "64");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Enter a whole number from 65 to 100.",
  );
  expect(data.state.value.settings.uiPanelOpacity).toBe(94);
  await change(input("Panel opacity value"), "80");
  expect(data.state.value.settings.uiPanelOpacity).toBe(80);
});

test("invalid theme imports leave saved colors intact and valid v1 share text restores the whole palette", async () => {
  const data = await mount();
  await appearance();
  const select = document.querySelector("select");
  if (!select) throw new Error("Missing style");
  await change(select, "custom");
  const textarea = document.querySelector('textarea[placeholder="Paste theme text"]');
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("Missing theme import");
  textarea.value = "invalid theme";
  textarea.dispatchEvent(new Event("input"));
  await settle();
  await click("Import theme");
  expect(data.state.value.settings.uiCustomTheme.accent).toBe("#E6C882");
  expect(document.querySelector(".inline-message")?.textContent).toBe(
    "That theme text is not valid.",
  );
  textarea.value =
    "gwonmac-theme-v1:modern:#1B1A18:#22211F:#2B2926:#11100F:#3C3832:#D5B86E:#F4EFE5:#BDB5A8:#5F5A52:0";
  textarea.dispatchEvent(new Event("input"));
  await settle();
  await click("Import theme");
  expect(data.state.value.settings.uiCustomTheme).toEqual({
    material: "modern",
    window: "#1B1A18",
    titlebar: "#22211F",
    surface: "#2B2926",
    recessed: "#11100F",
    selected: "#3C3832",
    accent: "#D5B86E",
    text: "#F4EFE5",
    mutedText: "#BDB5A8",
    border: "#5F5A52",
    windowGradient: false,
  });
  expect(textarea.value).toBe("");
});

test("invalid hex colors leave the previous palette unchanged", async () => {
  const data = await mount();
  await appearance();
  const select = document.querySelector("select");
  if (!select) throw new Error("Missing style");
  await change(select, "custom");
  await change(input("Accent hex"), "bad-color");
  expect(data.state.value.settings.uiCustomTheme.accent).toBe("#E6C882");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Enter six hex digits, for example #e8b75c.",
  );
});

test("slider dragging previews the value but commits only on release", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const saved: number[] = [];
  application = createApp(RangeControl, {
    label: "Panel opacity",
    value: 94,
    min: 65,
    max: 100,
    unit: "%",
    onChange: (value: number) => saved.push(value),
  });
  application.mount(container);
  const slider = input("Panel opacity");
  slider.value = "75";
  slider.dispatchEvent(new Event("input"));
  await settle();
  expect(input("Panel opacity value").value).toBe("75");
  expect(saved).toEqual([]);
  slider.dispatchEvent(new Event("change"));
  await settle();
  expect(saved).toEqual([75]);
});

test.each(["", "64", "101", "80.5"])(
  "opacity %s cannot be committed as a valid setting",
  async (value) => {
    const data = await mount();
    await appearance();
    await change(input("Panel opacity value"), value);
    expect(data.state.value.settings.uiPanelOpacity).toBe(94);
    expect(input("Panel opacity value").getAttribute("aria-invalid")).toBe("true");
  },
);

test("account edits reject duplicate names and archived selection falls back to the primary account", async () => {
  const data = fixtureData();
  expect(() =>
    data.saveProfile({
      id: "main",
      name: " storage account ",
      appearance: { icon: "swords", color: "#9a6638" },
    }),
  ).toThrow("Another account already uses this name.");
  data.saveProfile({ id: "third", name: "Third", appearance: { icon: "star", color: "#9a6638" } });
  data.toggle("third");
  data.toggle("main");
  data.archive("third", true);
  expect(data.state.value.selectedProfileIds).toEqual(["main"]);
  data.archive("main", true);
  expect(data.state.value.profiles[0]?.archived).toBe(false);
  data.remove("main");
  expect(data.state.value.profiles[0]?.name).toBe("Main account");
});

test("Add account is a real fixture edit and Escape restores focus to its trigger", async () => {
  const data = await mount();
  await click("Accounts");
  const add = button("Add account");
  add.focus();
  await click("Add account");
  const name = document.querySelector(".modal input");
  if (!(name instanceof HTMLInputElement)) throw new Error("Missing name");
  name.value = "Second";
  name.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  document
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  expect(data.state.value.profiles.map((profile) => profile.name)).toEqual([
    "Main account",
    "Storage account",
    "Second",
  ]);
  expect(document.activeElement).toBe(add);
  await click("Add account");
  document
    .querySelector('[role="dialog"]')
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(add);
});

test("news filtering and release notes keep the selected story and close with Escape", async () => {
  await mount();
  await click("GWonMac");
  expect(document.querySelectorAll(".news-row").length).toBe(1);
  const story = document.querySelector(".news-row");
  if (!(story instanceof HTMLButtonElement)) throw new Error("Missing release");
  story.click();
  await settle();
  expect(document.querySelector("#news-article-title")?.textContent).toBe(
    "GWonMac 2026.8.10 is ready",
  );
  document
    .querySelector('[role="dialog"]')
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test("featured news waits twelve seconds, pauses on hover, and stops its clock when leaving Home", async () => {
  vi.useFakeTimers();
  const data = await mount();
  data.rotateNews(true);
  await settle();
  await vi.advanceTimersByTimeAsync(11_999);
  expect(document.querySelector(".hero-copy h1")?.textContent).toBe(
    "Seven skill fixes in the latest update",
  );
  await vi.advanceTimersByTimeAsync(1);
  await vi.advanceTimersByTimeAsync(1000);
  await settle();
  expect(document.querySelector(".hero-copy h1")?.textContent).toBe(
    "Pirate Week begins September 13",
  );
  document.querySelector(".news-hero")?.dispatchEvent(new Event("mouseenter"));
  await settle();
  await vi.advanceTimersByTimeAsync(24_000);
  expect(document.querySelector(".hero-copy h1")?.textContent).toBe(
    "Pirate Week begins September 13",
  );
  await click("Accounts");
  expect(vi.getTimerCount()).toBe(0);
});

test("shortcut capture can cancel without losing the saved binding and clears only on Delete", async () => {
  const data = await mount();
  await click("Settings");
  await click("Shortcuts");
  await click("Change Hub shortcut");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  expect(data.state.value.shortcuts.hub).toBe("⌘R");
  await click("Change Hub shortcut");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", metaKey: true, bubbles: true }));
  await settle();
  expect(data.state.value.shortcuts.hub).toBe("⌘J");
  for (const [key, altKey, expected] of [
    ["j", true, "⌥J"],
    ["F24", false, "F24"],
  ] as const) {
    await click("Change Hub shortcut");
    window.dispatchEvent(new KeyboardEvent("keydown", { key, altKey, bubbles: true }));
    await settle();
    expect(data.state.value.shortcuts.hub).toBe(expected);
  }

  await click("Change Hub shortcut");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  await settle();
  expect(data.state.value.shortcuts.hub).toBeNull();
  await click("Restore Hub default shortcut");
  expect(data.state.value.shortcuts.hub).toBe("⌘R");
});

test("a ready launcher update can be deferred while Play stays available, then installed from Updates", async () => {
  const data = await mount(fixtureData("?fixture=update"));
  expect(document.querySelector(".readiness")?.textContent).toContain("Launcher update ready");
  expect(button("Play").disabled).toBe(false);
  await click("Later");
  expect(document.querySelector(".readiness")?.textContent).toContain("Ready to play");
  await click("Settings");
  await click("Restart and update");
  expect(data.state.value.appUpdate).toEqual({ phase: "up-to-date", currentVersion: "2026.8.11" });
});

test.each([
  [["running", "ready"], "Play"],
  [["ready", "ready"], "Open 2 accounts"],
  [["running", "running"], "Accounts are open"],
  [["queued", "ready"], "Cancel waiting"],
] as const)("launch labels count the closed accounts in %j", (states, expected) => {
  const data: LauncherData = fixtureData();
  const profiles: Profile[] = data.state.value.profiles.map((profile, index) => ({
    ...profile,
    state: states[index]!,
  }));
  expect(launchLabel(profiles, data.state.value.readiness)).toBe(expected);
});

test("does not let Play launch while client artifacts are preparing", async () => {
  const data = fixtureData("?fixture=preparing");
  data.state.value = {
    ...data.state.value,
    readiness: {
      state: "preparing",
      progress: {
        status: "running",
        received: 0,
        total: 0,
        bytesPerSecond: null,
        secondsRemaining: null,
      },
    },
  };
  await mount(data);
  expect(document.body.textContent).toContain("Preparing Guild Wars · 0%");
  expect(button("Play").disabled).toBe(true);
  await click("Choose accounts, Main account");
  expect(button("Play Main account").disabled).toBe(true);
});

test("deleting an account removes it only after the confirmation", async () => {
  const data = await mount();
  await click("Accounts");
  await click("Edit Main account");
  await click("Delete");
  expect(document.querySelector("#account-delete-title")?.textContent).toBe("Delete Main account?");

  // The editor has its own Cancel; this one belongs to the confirmation.
  document.querySelector<HTMLButtonElement>(".confirm-delete .secondary")?.click();
  await settle();
  expect(data.state.value.profiles.map((profile) => profile.name)).toContain("Main account");

  await click("Delete");
  await click("Delete account");
  expect(data.state.value.profiles.map((profile) => profile.name)).toEqual(["Storage account"]);
  expect(data.state.value.selectedProfileIds).toEqual(["storage"]);
});

test("an account that is open cannot be deleted", () => {
  const data = fixtureData();
  data.deleteAccount("storage");
  expect(data.state.value.profiles.map((profile) => profile.id)).toEqual(["main", "storage"]);
});

test("an archived account is deleted from the archived list after the confirmation", async () => {
  const data = fixtureData();
  data.saveProfile({ id: "third", name: "Third", appearance: { icon: "star", color: "#9a6638" } });
  data.archive("third", true);
  await mount(data);
  await click("Accounts");
  document.querySelector("details.archived-accounts")?.setAttribute("open", "");
  await click("Delete permanently");
  expect(data.state.value.profiles.map((profile) => profile.id)).toContain("third");
  await click("Delete account");
  expect(data.state.value.profiles.map((profile) => profile.id)).not.toContain("third");
});

test("the launcher opens Accounts when Main asks for it", async () => {
  // The Accounts menu falls back to this when it cannot open an account (for example the game
  // files are not ready), and the player must land on the page that explains it.
  const data = fixtureData();
  let navigate: (destination: "accounts") => void = () => undefined;
  data.onNavigate = (listener) => {
    navigate = listener;
  };
  await mount(data);
  expect(document.querySelector(".accounts-page")).toBeNull();
  navigate("accounts");
  await settle();
  expect(document.querySelector(".accounts-page")).not.toBeNull();
});
