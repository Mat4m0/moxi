import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { hubPortMessage, windowChannels, type WindowKind } from "@moxi/contracts/windows";
import type {
  ChannelName,
  SocketEvent,
  AppearanceSettings,
  Readiness,
  Account,
  DocumentChange,
} from "@moxi/contracts";
export function exposeBridge(kind: WindowKind) {
  contextBridge.exposeInMainWorld("moxi", {
    ...(kind === "launcher"
      ? {
          onReadinessChanged(listener: (readiness: Readiness) => void) {
            const receive = (_event: IpcRendererEvent, readiness: Readiness) => listener(readiness);
            ipcRenderer.on("client.readiness.changed", receive);
            return () => ipcRenderer.removeListener("client.readiness.changed", receive);
          },
          onAccountsChanged(listener: (accounts: Account[]) => void) {
            const receive = (_event: IpcRendererEvent, accounts: Account[]) => listener(accounts);
            ipcRenderer.on("accounts.changed", receive);
            return () => ipcRenderer.removeListener("accounts.changed", receive);
          },
        }
      : {}),
    ...(kind === "pluginHost"
      ? {
          onDocumentChanged(listener: (change: DocumentChange) => void) {
            const receive = (_event: IpcRendererEvent, change: DocumentChange) => listener(change);
            ipcRenderer.on("plugin.doc.changed", receive);
            return () => ipcRenderer.removeListener("plugin.doc.changed", receive);
          },
        }
      : {}),
    ...(kind === "game"
      ? {
          onAppearanceChanged(listener: (settings: AppearanceSettings) => void) {
            const receive = (_event: IpcRendererEvent, settings: AppearanceSettings) =>
              listener(settings);
            ipcRenderer.on("appearance.changed", receive);
            return () => ipcRenderer.removeListener("appearance.changed", receive);
          },
          onSocketEvent(listener: (event: SocketEvent) => void) {
            const receive = (_event: IpcRendererEvent, message: SocketEvent) => listener(message);
            ipcRenderer.on("game.net.event", receive);
            return () => ipcRenderer.removeListener("game.net.event", receive);
          },
        }
      : {}),
    invoke(name: ChannelName, request: unknown): Promise<unknown> {
      if (!windowChannels[kind].some((allowed) => allowed === name))
        return Promise.reject(new Error("This window cannot use that action."));
      return ipcRenderer.invoke(name, request);
    },
  });
}

declare const window: {
  postMessage(message: unknown, origin: string, ports: IpcRendererEvent["ports"]): void;
  addEventListener(
    name: "message",
    handler: (event: { source: unknown; data: unknown }) => void,
  ): void;
};
export function forwardHubPort() {
  let ready = false;
  const pending: { id: unknown; ports: IpcRendererEvent["ports"] }[] = [];
  const forward = (id: unknown, ports: IpcRendererEvent["ports"]) =>
    window.postMessage({ t: hubPortMessage, id }, "*", ports);
  window.addEventListener("message", (message) => {
    if (message.source !== window || message.data !== "moxi-hub-ready") return;
    ready = true;
    for (const entry of pending.splice(0)) forward(entry.id, entry.ports);
  });
  ipcRenderer.on(hubPortMessage, (event, id: unknown) => {
    if (ready) forward(id, event.ports);
    else pending.push({ id, ports: event.ports });
  });
}
