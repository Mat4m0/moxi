import { contextBridge, ipcRenderer } from "electron";
import { windowChannels, type WindowKind } from "@moxi/contracts/windows";
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
