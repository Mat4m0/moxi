import type { HubToHost, ToHost } from "@moxi/sdk/host";
import { PluginHost } from "../plugin-host.ts";

const channel = new MessageChannel();
const host = new PluginHost(
  {
    post: (message) => channel.port1.postMessage(message),
    listen: (handler) => {
      channel.port1.onmessage = (event: MessageEvent<HubToHost>) => handler(event.data);
      channel.port1.start();
    },
  },
  (script, id) => {
    const worker = new Worker(script, { type: "module", name: id });
    return {
      postMessage: (message) => worker.postMessage(message),
      listen: (handler, onError) => {
        worker.onmessage = (event: MessageEvent<ToHost>) => handler(event.data);
        worker.onerror = (event) => onError(event.message);
      },
      terminate: () => worker.terminate(),
    };
  },
  localStorage,
);
window.postMessage({ t: "moxi-hub-port" }, location.origin, [channel.port2]);
window.addEventListener(
  "pagehide",
  () => {
    host.dispose();
    channel.port1.close();
  },
  { once: true },
);

const index: unknown = await (await fetch("/plugins/index.json")).json();
if (!Array.isArray(index)) throw new Error("Invalid plugin index");
for (const entry of index) {
  if (
    !entry ||
    typeof entry !== "object" ||
    !("manifest" in entry) ||
    typeof entry.manifest !== "string" ||
    !("script" in entry) ||
    typeof entry.script !== "string" ||
    !("bytes" in entry) ||
    typeof entry.bytes !== "number"
  )
    throw new Error("Invalid plugin index entry");
  const manifest: unknown = await (await fetch(entry.manifest)).json();
  host.register(manifest, entry.script, entry.bytes);
}
