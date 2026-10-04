import { hubPortMessage } from "@moxi/contracts";
import type { HubToHost, ToHost } from "@moxi/sdk/host";
import { PluginHost } from "./plugin-host.ts";

const sessions = new Map<number, { host: PluginHost; port: MessagePort }>();
const plugins = loadPlugins();
async function loadPlugins() {
  const base = new URL("plugins/", location.href);
  const index: unknown = await (await fetch(new URL("index.json", base))).json();
  if (!Array.isArray(index)) throw new Error("Invalid plugin index");
  return Promise.all(
    index.map(async (entry: unknown) => {
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
      const manifest: unknown = await (
        await fetch(new URL(entry.manifest.split("/").at(-1)!, base))
      ).json();
      return {
        manifest,
        script: new URL(entry.script.split("/").at(-1)!, base).href,
        bytes: entry.bytes,
      };
    }),
  );
}
window.addEventListener("message", (event: MessageEvent) => {
  if (
    event.source !== window ||
    event.data?.t !== hubPortMessage ||
    typeof event.data.id !== "number"
  )
    return;
  const id: number = event.data.id;
  const port = event.ports[0];
  if (!port) {
    sessions.get(id)?.host.dispose();
    sessions.get(id)?.port.close();
    sessions.delete(id);
    return;
  }
  const host = new PluginHost(
    {
      onClose: (handler) => port.addEventListener("close", handler),
      post: (message) => port.postMessage(message),
      listen: (handler) => {
        port.onmessage = (message: MessageEvent<HubToHost>) => handler(message.data);
        port.start();
      },
    },
    (script, name) => {
      const worker = new Worker(script, { type: "module", name });
      return {
        postMessage: (message) => worker.postMessage(message),
        listen: (handler, onError) => {
          worker.onmessage = (message: MessageEvent<ToHost>) => handler(message.data);
          worker.onerror = (error) => onError(error.message);
        },
        terminate: () => worker.terminate(),
      };
    },
    localStorage,
  );
  sessions.set(id, { host, port });
  port.addEventListener("close", () => {
    host.dispose();
    sessions.delete(id);
  });
  void plugins
    .then((entries) => {
      if (sessions.get(id)?.host !== host) return;
      for (const entry of entries) host.register(entry.manifest, entry.script, entry.bytes);
    })
    .catch(() => host.dispose());
});
window.postMessage("moxi-hub-ready", "*");
window.addEventListener(
  "pagehide",
  () => {
    for (const { host, port } of sessions.values()) {
      host.dispose();
      port.close();
    }
    sessions.clear();
  },
  { once: true },
);
