import { hubPortMessage, type Bridge } from "@moxi/contracts";
import type { HubToHost } from "@moxi/sdk/host";
import { PluginHost } from "./plugin-host.ts";

const sessions = new Map<number, { host: PluginHost; port: MessagePort }>();
const plugins = loadPlugins();
declare global {
  interface Window {
    moxi: Bridge<"pluginHost">;
  }
}
async function loadPlugins() {
  // Main loads trusted bundles because the host's CSP also forbids its own fetches.
  const bundles = await window.moxi.invoke("plugin.bundles", undefined);
  return bundles.map(({ manifest, source, bytes }) => ({
    manifest,
    script: `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`,
    bytes,
  }));
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
          worker.onmessage = (message: MessageEvent<unknown>) => handler(message.data);
          worker.onerror = (error) => onError(error.message);
        },
        terminate: () => worker.terminate(),
      };
    },
    {
      read: (ref) => window.moxi.invoke("plugin.doc.read", ref),
      write: (request) => window.moxi.invoke("plugin.doc.write", request),
      onChange: (listener) => window.moxi.onDocumentChanged(listener),
    },
  );
  sessions.set(id, { host, port });
  port.addEventListener("close", () => sessions.delete(id));
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
