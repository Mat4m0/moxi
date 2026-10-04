import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { hubPortMessage, windowChannels, type WindowKind } from "@moxi/contracts/windows";
import type { ChannelName } from "@moxi/contracts";
export function exposeBridge(kind: WindowKind) {
  contextBridge.exposeInMainWorld("moxi", {
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
