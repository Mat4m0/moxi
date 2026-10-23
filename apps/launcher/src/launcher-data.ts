import type { Account, Readiness } from "@moxi/contracts";
import { accountNameProblem } from "@moxi/contracts/account-name";
import { shallowRef, type ShallowRef } from "vue";
import type { AppearanceSettings, CustomUiTheme } from "@moxi/ui";
import { defaultCustomUiTheme } from "@moxi/ui";

export type LauncherRoute = "home" | "accounts" | "settings";
export type SettingsRoute = "general" | "appearance" | "game-files" | "shortcuts";
export type ProfileIcon =
  | "swords"
  | "archive"
  | "map"
  | "scroll"
  | "shield"
  | "star"
  | "crown"
  | "flame";
export interface Profile {
  id: string;
  name: string;
  archived: boolean;
  state: "ready" | "running" | "queued" | "opening" | "checking" | "failed";
  failure?: "profile-preparation" | "window-startup" | "client-validation" | "renderer-crash";
  appearance: { icon: ProfileIcon; color: string };
}
export type { Download, Readiness } from "@moxi/contracts";
export interface NewsStory {
  id: string;
  source: "game" | "event" | "launcher";
  channel: "all" | "stable" | "beta";
  title: string;
  summary: string;
  publishedAt: string;
  featured: boolean;
  action: "external" | "article";
  body: (
    | { type: "paragraph"; text: string }
    | { type: "heading"; text: string }
    | { type: "list"; items: string[] }
  )[];
}
export interface LauncherSettings extends AppearanceSettings {
  uiCustomTheme: CustomUiTheme;
  autoCheckUpdates: boolean;
  updateTrack: "stable" | "beta";
}
export interface LauncherState {
  productName: string;
  version: string;
  profiles: Profile[];
  selectedProfileIds: string[];
  readiness: Readiness;
  appUpdate:
    | { phase: "idle" | "up-to-date"; currentVersion: string }
    | { phase: "ready"; currentVersion: string; latestVersion: string };
  gameFilesInfo: { bytes: number; totalBytes: number };
  settings: LauncherSettings;
  preferences: { content: { autoRotateNews: boolean } };
  news: { status: "ready" | "offline"; stories: NewsStory[] };
  shortcuts: { hub: string | null };
}
export interface LauncherData {
  state: ShallowRef<LauncherState>;
  initialize(): Promise<void>;
  play(ids: readonly string[]): Promise<void>;
  toggle(id: string): void;
  cancel(id: string): void;
  saveProfile(profile: Pick<Profile, "id" | "name" | "appearance">): void;
  archive(id: string, archived: boolean): void;
  remove(id: string): void;
  /** Removes an account that is not the last one, archived or not. */
  deleteAccount(id: string): void;
  saveSettings(patch: Partial<LauncherSettings>): Promise<void>;
  rotateNews(enabled: boolean): void;
  checkUpdate(): void;
  installUpdate(): void;
  download(action: "pause" | "resume" | "repair" | "reset"): void;
  saveShortcut(binding: string | null): void;
}

export function fixtureData(search = ""): LauncherData {
  const main: Profile = {
    id: "main",
    name: "Main account",
    archived: false,
    state: "ready",
    appearance: { icon: "swords", color: "#8a5a32" },
  };
  const storage: Profile = {
    id: "storage",
    name: "Storage account",
    archived: false,
    state: "running",
    appearance: { icon: "archive", color: "#496b58" },
  };
  const state = shallowRef<LauncherState>({
    productName: "Guild Wars Reforged",
    version: "2026.8.10",
    // fixture until accounts slice
    profiles: [main, storage],
    // fixture until accounts slice
    selectedProfileIds: ["main"],
    readiness: {
      state: "playable",
      backgroundDownload: {
        status: "running",
        received: 8_400_000_000,
        total: 9_100_000_000,
        bytesPerSecond: 12_500_000,
        secondsRemaining: 56,
      },
    },
    // fixture until updates slice
    appUpdate: { phase: "idle", currentVersion: "2026.8.10" },
    gameFilesInfo: { bytes: 8_400_000_000, totalBytes: 9_100_000_000 },
    // fixture until appearance and updates slices
    settings: {
      uiStyle: "classic",
      uiFont: "guild-wars",
      uiPanelOpacity: 94,
      uiCustomTheme: { ...defaultCustomUiTheme("classic") },
      autoCheckUpdates: true,
      updateTrack: "stable",
    },
    // fixture until news slice
    preferences: { content: { autoRotateNews: true } },
    // fixture until news slice
    news: {
      status: "ready",
      stories: [
        {
          id: "guild-wars-update-2026-09-01",
          source: "game",
          channel: "all",
          title: "Seven skill fixes in the latest update",
          summary:
            "Mirage Cloak, Focused Shot, Soul Twisting, and four more skills were corrected.",
          publishedAt: "2026-09-01T12:00:00Z",
          featured: true,
          action: "external",
          body: [],
        },
        {
          id: "guild-wars-pirate-week-2026",
          source: "event",
          channel: "all",
          title: "Pirate Week begins September 13",
          summary: "Pirate NPCs and Bottle of Grog drops return for one week.",
          publishedAt: "2026-09-01T11:00:00Z",
          featured: true,
          action: "external",
          body: [],
        },
        {
          id: "gwonmac-2026-8-10",
          source: "launcher",
          channel: "stable",
          title: "GWonMac 2026.8.10 is ready",
          summary: "Compatibility with the latest Guild Wars client and restored Tools overlays.",
          publishedAt: "2026-08-27T12:00:00Z",
          featured: true,
          action: "article",
          body: [
            {
              type: "paragraph",
              text: "This maintenance release keeps GWonMac compatible with the latest Guild Wars client.",
            },
            { type: "heading", text: "What changed" },
            {
              type: "list",
              items: [
                "Restored the GWonMac Tools overlays.",
                "Improved client compatibility diagnostics.",
              ],
            },
          ],
        },
      ],
    },
    // fixture until shortcuts slice
    shortcuts: { hub: "⌘R" },
  });
  const scenario = new URLSearchParams(search).get("fixture");
  if (scenario === "accounts") {
    state.value = {
      ...state.value,
      readiness: { state: "playable", backgroundDownload: null },
      selectedProfileIds: ["storage"],
      profiles: [
        { ...main, name: "Main", state: "running" },
        { ...storage, name: "Heroes", state: "ready" },
        ...["Reforged", "Storage A", "Storage B", "Storage C", "Trading"].map(
          (name, index): Profile => ({ ...main, id: `account-${index}`, name }),
        ),
      ],
    };
  } else if (scenario === "repair")
    state.value = { ...state.value, readiness: { state: "repair-required" } };
  else if (scenario === "offline")
    state.value = { ...state.value, readiness: { state: "offline-playable" } };
  else if (scenario === "preparing")
    state.value = {
      ...state.value,
      readiness: {
        state: "preparing",
        progress: {
          status: "running",
          received: 620_000_000,
          total: 1_100_000_000,
          bytesPerSecond: 12_500_000,
          secondsRemaining: 38,
        },
      },
    };
  else if (scenario === "update")
    state.value = {
      ...state.value,
      readiness: { state: "playable", backgroundDownload: null },
      appUpdate: { phase: "ready", currentVersion: "2026.8.10", latestVersion: "2026.8.11" },
    };
  else if (scenario === "production")
    state.value = {
      ...state.value,
      readiness: { state: "playable", backgroundDownload: null },
      news: { ...state.value.news, status: "offline" },
    };
  else if (scenario === "failed")
    state.value = {
      ...state.value,
      profiles: [{ ...main, state: "failed", failure: "renderer-crash" }, storage],
    };

  function profiles(update: (profile: Profile) => Profile) {
    state.value = { ...state.value, profiles: state.value.profiles.map(update) };
  }
  return {
    state,
    async initialize() {},
    async play(ids) {
      profiles((profile) =>
        ids.includes(profile.id) ? { ...profile, state: "running" } : profile,
      );
    },
    toggle(id) {
      if (!state.value.profiles.some((profile) => profile.id === id && !profile.archived)) return;
      const selected = state.value.selectedProfileIds;
      const next = selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id];
      if (next.length) state.value = { ...state.value, selectedProfileIds: next };
    },
    cancel(id) {
      profiles((profile) =>
        profile.id === id && profile.state === "queued" ? { ...profile, state: "ready" } : profile,
      );
    },
    saveProfile(edit) {
      const name = edit.name.trim();
      const problem = accountNameProblem(name);
      if (problem) throw new Error(problem);
      if (
        state.value.profiles.some(
          (profile) =>
            profile.id !== edit.id && profile.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      )
        throw new Error("Another account already uses this name.");
      if (state.value.profiles.some((profile) => profile.id === edit.id))
        profiles((profile) =>
          profile.id === edit.id ? { ...profile, name, appearance: edit.appearance } : profile,
        );
      else
        state.value = {
          ...state.value,
          profiles: [...state.value.profiles, { ...edit, name, archived: false, state: "ready" }],
        };
    },
    archive(id, archived) {
      const visible = state.value.profiles.filter((profile) => !profile.archived);
      const profile = state.value.profiles.find((candidate) => candidate.id === id);
      if (
        !profile ||
        (archived && (visible[0]?.id === id || !["ready", "failed"].includes(profile.state)))
      )
        return;
      profiles((candidate) => (candidate.id === id ? { ...candidate, archived } : candidate));
      const selected = state.value.selectedProfileIds.filter((value) => value !== id || !archived);
      state.value = {
        ...state.value,
        selectedProfileIds: selected.length ? selected : [visible[0]!.id],
      };
    },
    remove(id) {
      state.value = {
        ...state.value,
        profiles: state.value.profiles.filter((profile) => profile.id !== id || !profile.archived),
      };
    },
    deleteAccount(id) {
      const profile = state.value.profiles.find((candidate) => candidate.id === id);
      const active = state.value.profiles.filter((candidate) => !candidate.archived);
      if (!profile || (!profile.archived && (active.length < 2 || profile.state === "running")))
        return;
      const remaining = state.value.profiles.filter((candidate) => candidate.id !== id);
      const selected = state.value.selectedProfileIds.filter((value) => value !== id);
      state.value = {
        ...state.value,
        profiles: remaining,
        selectedProfileIds: selected.length
          ? selected
          : [remaining.find((candidate) => !candidate.archived)!.id],
      };
    },
    async saveSettings(patch) {
      state.value = { ...state.value, settings: { ...state.value.settings, ...patch } };
    },
    rotateNews(autoRotateNews) {
      state.value = { ...state.value, preferences: { content: { autoRotateNews } } };
    },
    checkUpdate() {
      state.value = {
        ...state.value,
        appUpdate: { ...state.value.appUpdate, phase: "up-to-date" },
      };
    },
    installUpdate() {
      const update = state.value.appUpdate;
      if (update.phase === "ready")
        state.value = {
          ...state.value,
          version: update.latestVersion,
          appUpdate: { phase: "up-to-date", currentVersion: update.latestVersion },
        };
    },
    download(action) {
      if (action === "repair" || action === "reset")
        state.value = {
          ...state.value,
          readiness: { state: "playable", backgroundDownload: null },
        };
      else if (
        state.value.readiness.state === "playable" &&
        state.value.readiness.backgroundDownload
      )
        state.value = {
          ...state.value,
          readiness: {
            state: "playable",
            backgroundDownload: {
              ...state.value.readiness.backgroundDownload,
              status: action === "pause" ? "paused" : "running",
            },
          },
        };
    },
    saveShortcut(hub) {
      state.value = { ...state.value, shortcuts: { hub } };
    },
  };
}

const isHexColor = (value: string): value is `#${string}` => /^#[0-9a-fA-F]{6}$/.test(value);

function profileOf(account: Account): Profile {
  return {
    id: account.id,
    name: account.name,
    archived: account.archived,
    appearance: account.appearance,
    state: account.state === "closed" ? "ready" : account.state,
    ...(account.failure ? { failure: account.failure } : {}),
  };
}

export function bridgeData(): LauncherData {
  const data = fixtureData();
  data.state.value = {
    ...data.state.value,
    // The accounts come from Main; none of the fixture accounts is shown.
    profiles: [],
    selectedProfileIds: [],
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
    gameFilesInfo: { bytes: 0, totalBytes: 0 },
  };
  function applyReadiness(readiness: Readiness) {
    const progress = readiness.state === "playable" ? readiness.backgroundDownload : null;
    data.state.value = {
      ...data.state.value,
      readiness,
      gameFilesInfo: progress
        ? { bytes: progress.received, totalBytes: progress.total }
        : readiness.state === "offline-playable" && readiness.gameFilesInfo
          ? readiness.gameFilesInfo
          : data.state.value.gameFilesInfo,
    };
  }
  function applyAccounts(accounts: Account[]) {
    const profiles = accounts.map(profileOf);
    const open = profiles.filter((profile) => !profile.archived);
    const kept = data.state.value.selectedProfileIds.filter((id) =>
      open.some((profile) => profile.id === id),
    );
    const first = open[0];
    data.state.value = {
      ...data.state.value,
      profiles,
      selectedProfileIds: kept.length || !first ? kept : [first.id],
    };
  }
  const refreshAccounts = () =>
    window.moxi.invoke("accounts.list", undefined).then(applyAccounts, () => undefined);
  return {
    ...data,
    async initialize() {
      window.moxi.onAccountsChanged(applyAccounts);
      applyAccounts(await window.moxi.invoke("accounts.list", undefined));
      let changed = false;
      window.moxi.onReadinessChanged((readiness) => {
        changed = true;
        applyReadiness(readiness);
      });
      const readiness = await window.moxi.invoke("client.readiness", undefined);
      if (!changed) applyReadiness(readiness);
      const info = await window.moxi.invoke("app.info", undefined);
      const appearance = await window.moxi.invoke("appearance.get", undefined);
      data.state.value = {
        ...data.state.value,
        settings: { ...data.state.value.settings, ...appearance },
        productName: info.productName,
        version: info.version,
        appUpdate: { phase: "idle", currentVersion: info.version },
      };
    },
    async saveSettings(patch) {
      const settings = { ...data.state.value.settings, ...patch };
      const { uiStyle, uiFont, uiPanelOpacity, uiCustomTheme } = settings;
      await window.moxi.invoke("appearance.set", {
        uiStyle,
        uiFont,
        uiPanelOpacity,
        uiCustomTheme,
      });
      data.state.value = { ...data.state.value, settings };
    },
    download(action) {
      if (action === "pause" || action === "resume")
        void window.moxi.invoke(
          action === "pause" ? "download.pause" : "download.resume",
          undefined,
        );
      if (action === "repair" || action === "reset")
        void window.moxi.invoke("client.retry", undefined);
    },
    async play(ids) {
      await window.moxi.invoke("accounts.play", { ids: [...ids] });
    },
    // The fixture operations update the list at once; Main then confirms or corrects it.
    saveProfile(edit) {
      const { color } = edit.appearance;
      if (!isHexColor(color)) throw new Error("Pick a valid color.");
      data.saveProfile(edit);
      void window.moxi
        .invoke("accounts.save", {
          id: edit.id,
          name: edit.name.trim(),
          appearance: { icon: edit.appearance.icon, color },
        })
        .then(applyAccounts, refreshAccounts);
    },
    archive(id, archived) {
      data.archive(id, archived);
      if (data.state.value.profiles.find((profile) => profile.id === id)?.archived === archived)
        void window.moxi
          .invoke("accounts.archive", { id, archived })
          .then(applyAccounts, refreshAccounts);
    },
    remove(id) {
      data.remove(id);
      void window.moxi.invoke("accounts.remove", { id }).then(applyAccounts, refreshAccounts);
    },
    // Main only deletes an archived account, so an active one is archived first. Main checks
    // both steps, and a refusal puts the list back as Main has it.
    deleteAccount(id) {
      const before = data.state.value.profiles.length;
      data.deleteAccount(id);
      if (data.state.value.profiles.length === before) return;
      void window.moxi
        .invoke("accounts.archive", { id, archived: true })
        .then(() => window.moxi.invoke("accounts.remove", { id }))
        .then(applyAccounts, refreshAccounts);
    },
  };
}
