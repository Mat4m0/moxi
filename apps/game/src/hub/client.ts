import { reactive } from "vue";
import { emptyHubState } from "@moxi/sdk/host";
import type { HubPort, HubToast, HubToHost } from "@moxi/sdk/host";
import type { ActionResult, Observed, Slice } from "@moxi/sdk";

export const host = reactive(emptyHubState());
let port: HubPort | undefined;
let seq = 0;
const pending = new Map<number, (viewId: string | null) => void>();
let performAction:
  | ((op: "game.loadBuild" | "game.travel", args: unknown) => Promise<ActionResult>)
  | undefined;
const post = (message: HubToHost) => {
  if (!port) throw new Error("The Hub port is not connected");
  port.post(message);
};

export function connectHub(connection: HubPort) {
  port = connection;
  connection.listen((message) => {
    if (message.t === "state") Object.assign(host, message.state);
    else if (message.t === "commandResult") {
      pending.get(message.requestId)?.(message.viewId);
      pending.delete(message.requestId);
    } else if (message.t === "gameAction") {
      void (
        performAction?.(message.op, message.args) ??
        Promise.resolve<ActionResult>({
          status: "refused",
          reason: "unsupported",
          message: "The game action is unavailable.",
        })
      ).then((result) => post({ t: "actionResult", requestId: message.requestId, result }));
    }
  });
}
export function onGameAction(handler: NonNullable<typeof performAction>) {
  performAction = handler;
}
export function publishFacts(values: Record<Slice, Observed<unknown>>) {
  post({ t: "facts", values });
}
export function startHubPlugins() {
  post({ t: "openHub" });
}
export function endHubSession() {
  for (const resolve of pending.values()) resolve(null);
  pending.clear();
  post({ t: "closeHub" });
}
export function query(text: string, scope: string | null) {
  post({ t: "query", text, scope });
}
export function runCommand(pluginId: string, commandId: string): Promise<string | null> {
  const requestId = ++seq;
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    post({ t: "command", requestId, pluginId, commandId });
  });
}
export function invoke(
  pluginId: string,
  surface: string,
  target: string,
  args?: unknown[],
  grant = true,
) {
  post({ t: "invoke", pluginId, surface, target, args, grant });
}
export function pushView(pluginId: string, surface: string, target: string) {
  const viewId = `view:${pluginId}:${crypto.randomUUID()}`;
  post({ t: "pushView", pluginId, surface, target, viewId });
  return viewId;
}
export function closeView(viewId: string) {
  post({ t: "closeView", viewId });
}
export function setEnabled(pluginId: string, enabled: boolean) {
  post({ t: "enabled", pluginId, enabled });
}
export function setSetting(pluginId: string, key: string, value: number | boolean) {
  post({ t: "setting", pluginId, key, value });
}
export function toast(plugin: string, toast: HubToast) {
  post({ t: "toast", plugin, toast });
}
