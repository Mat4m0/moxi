import type { Account, AppearanceSettings, Readiness } from "@moxi/contracts";
import { accountNameProblem } from "@moxi/contracts/account-name";
import { shallowRef, type ShallowRef } from "vue";

export type { Account, AppearanceSettings, Download, Readiness } from "@moxi/contracts";
export type LauncherRoute = "accounts" | "settings";
export type SettingsRoute = "appearance" | "game-files";
export interface LauncherState {
  productName: string;
  version: string;
  accounts: Account[];
  readiness: Readiness;
  gameFilesInfo: { bytes: number; totalBytes: number };
  settings: AppearanceSettings;
}
export interface LauncherData {
  state: ShallowRef<LauncherState>;
  initialize(): Promise<void>;
  /** Main asks the launcher to open a page, for example Accounts from the Accounts menu. */
  onNavigate(listener: (destination: "accounts") => void): void;
  play(ids: readonly string[]): Promise<void>;
  /** Marks or unmarks an account for "Play selected". Main keeps the marks. */
  select(id: string, marked: boolean): void;
  /** Adds an account or renames one. Throws the reason when the name would be refused. */
  saveAccount(edit: { id: string; name: string }): void;
  archive(id: string, archived: boolean): void;
  remove(id: string): void;
  /** Removes an account that is not the last one, archived or not. */
  deleteAccount(id: string): void;
  saveSettings(patch: Partial<AppearanceSettings>): Promise<void>;
  download(action: "pause" | "resume" | "repair" | "reset"): void;
}

// The launcher shows what Main says. Every change asks Main and shows Main's answer; when Main
// refuses, the list is read again so the screen never keeps a guess.
export function bridgeData(): LauncherData {
  const state = shallowRef<LauncherState>({
    productName: "",
    version: "",
    accounts: [],
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
    settings: { uiStyle: "classic", uiPanelOpacity: 94, uiFont: "guild-wars" },
  });
  function applyReadiness(readiness: Readiness) {
    const progress = readiness.state === "playable" ? readiness.backgroundDownload : null;
    state.value = {
      ...state.value,
      readiness,
      gameFilesInfo: progress
        ? { bytes: progress.received, totalBytes: progress.total }
        : readiness.state === "offline-playable" && readiness.gameFilesInfo
          ? readiness.gameFilesInfo
          : state.value.gameFilesInfo,
    };
  }
  function applyAccounts(accounts: Account[]) {
    state.value = { ...state.value, accounts };
  }
  const refresh = () =>
    window.moxi.invoke("accounts.list", undefined).then(applyAccounts, () => undefined);
  const change = (request: Promise<Account[]>) => void request.then(applyAccounts, refresh);
  return {
    state,
    onNavigate(listener) {
      window.moxi.onNavigate(listener);
    },
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
      const settings = await window.moxi.invoke("appearance.get", undefined);
      state.value = {
        ...state.value,
        settings,
        productName: info.productName,
        version: info.version,
      };
    },
    async play(ids) {
      await window.moxi.invoke("accounts.play", { ids: [...ids] });
    },
    select(id, marked) {
      const others = state.value.accounts
        .filter((account) => account.selected && account.id !== id)
        .map((account) => account.id);
      change(window.moxi.invoke("accounts.select", { ids: marked ? [...others, id] : others }));
    },
    saveAccount({ id, name }) {
      const trimmed = name.trim();
      const problem = accountNameProblem(trimmed);
      if (problem) throw new Error(problem);
      const taken = state.value.accounts.some(
        (account) =>
          account.id !== id && account.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
      );
      if (taken) throw new Error("Another account already uses this name.");
      change(window.moxi.invoke("accounts.save", { id, name: trimmed }));
    },
    archive(id, archived) {
      change(window.moxi.invoke("accounts.archive", { id, archived }));
    },
    remove(id) {
      change(window.moxi.invoke("accounts.remove", { id }));
    },
    // Main only deletes an archived account, so an active one is archived first. Main checks
    // both steps.
    deleteAccount(id) {
      change(
        window.moxi
          .invoke("accounts.archive", { id, archived: true })
          .then(() => window.moxi.invoke("accounts.remove", { id })),
      );
    },
    async saveSettings(patch) {
      const settings = { ...state.value.settings, ...patch };
      await window.moxi.invoke("appearance.set", settings);
      state.value = { ...state.value, settings };
    },
    download(action) {
      if (action === "pause" || action === "resume")
        void window.moxi.invoke(
          action === "pause" ? "download.pause" : "download.resume",
          undefined,
        );
      else void window.moxi.invoke("client.retry", undefined);
    },
  };
}
