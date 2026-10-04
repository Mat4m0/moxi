import type { ActionResult, Observed, Slice } from "./game.ts";
import type { HudNode } from "./nodes.ts";
import type { Manifest, ToastTone, WireItem, WireView } from "./protocol.ts";

export type PluginInstance = {
  manifest: Manifest;
  script: string;
  bytes: number;
  enabled: boolean;
  status: "stopped" | "starting" | "running" | "crashed";
  crashReason?: string | undefined;
  startMs?: number | undefined;
  items: WireItem[];
  hud: Record<string, HudNode | null>;
  subscriptions: Slice[];
  settings: Record<string, number | boolean>;
};
export type HubToast = {
  title: string;
  message?: string | undefined;
  tone?: ToastTone | undefined;
};
export type HubState = {
  plugins: Record<string, PluginInstance>;
  views: Record<string, { pluginId: string; view: WireView }>;
  queryResults: Record<string, WireItem[]>;
  toasts: (HubToast & { id: number; plugin: string })[];
  log: { at: number; text: string; tone: "info" | "refused" | "error" }[];
  gameActions: string[];
};
export type HubToHost =
  | { t: "openHub" }
  | { t: "closeHub" }
  | { t: "query"; text: string; scope: string | null }
  | { t: "command"; requestId: number; pluginId: string; commandId: string }
  | {
      t: "invoke";
      pluginId: string;
      surface: string;
      target: string;
      args?: unknown[] | undefined;
      grant: boolean;
    }
  | { t: "pushView"; pluginId: string; surface: string; target: string; viewId: string }
  | { t: "closeView"; viewId: string }
  | { t: "enabled"; pluginId: string; enabled: boolean }
  | { t: "setting"; pluginId: string; key: string; value: number | boolean }
  | { t: "toast"; plugin: string; toast: HubToast }
  | { t: "facts"; values: Record<Slice, Observed<unknown>> }
  | { t: "actionResult"; requestId: number; result: ActionResult };
export type HostToHub =
  | { t: "state"; state: HubState }
  | { t: "commandResult"; requestId: number; viewId: string | null }
  | { t: "gameAction"; requestId: number; op: "game.loadBuild" | "game.travel"; args: unknown };
export type HostPort = {
  post(message: HostToHub): void;
  listen(handler: (message: HubToHost) => void): void;
};
export type HubPort = {
  post(message: HubToHost): void;
  listen(handler: (message: HostToHub) => void): void;
};

export function emptyHubState(): HubState {
  return { plugins: {}, views: {}, queryResults: {}, toasts: [], log: [], gameActions: [] };
}
