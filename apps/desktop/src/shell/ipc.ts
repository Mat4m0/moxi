import { ipcMain } from "electron";
import {
  channels,
  validateRequest,
  type ChannelName,
  type RequestOf,
  type ResponseOf,
  type WindowKind,
} from "@moxi/contracts";
export function handle<N extends ChannelName>(
  name: N,
  fn: (request: RequestOf<N>, owner: number) => ResponseOf<N> | Promise<ResponseOf<N>>,
  windowKind: (id: number) => WindowKind | undefined,
) {
  ipcMain.handle(name, async (event, input: unknown) => {
    try {
      if (event.senderFrame !== event.sender.mainFrame)
        throw new Error("Only the main frame can use app actions.");
      const request = validateRequest(name, windowKind(event.sender.id), input);
      const response = await fn(request, event.sender.id);
      return channels[name].response.assert(response);
    } catch {
      console.warn("[moxi] IPC rejected", name);
      throw new Error("This app action was rejected.");
    }
  });
}
