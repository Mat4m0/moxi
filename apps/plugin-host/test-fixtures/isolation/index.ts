import type { PluginContext } from "@moxi/sdk";

export default async function setup(ctx: PluginContext) {
  const probes: [string, () => unknown][] = [
    [
      "indexedDB",
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open("plugin-isolation-probe", 1);
          request.onsuccess = () => {
            request.result.close();
            resolve();
          };
          request.onerror = () => reject(request.error);
        }),
    ],
    ["cacheStorage", () => caches.open("plugin-isolation-probe")],
    ["client", () => fetch("moxi://app/client/Gw.snapshot")],
    ["game", () => fetch("moxi://app/game/")],
    ["https", () => fetch("https://example.com")],
    [
      "remoteImport",
      () => {
        const remote = "https://example.com/remote.js";
        return import(remote);
      },
    ],
    [
      "webSocket",
      () =>
        new Promise<void>((resolve, reject) => {
          const socket = new WebSocket("wss://example.com");
          socket.onopen = () => {
            socket.close();
            resolve();
          };
          socket.onerror = () => reject(new Error("WebSocket refused"));
        }),
    ],
    [
      "importScripts",
      () => {
        const load: unknown = Reflect.get(globalThis, "importScripts");
        if (typeof load !== "function") throw new Error("No importScripts");
        load("https://example.com/remote.js");
      },
    ],
  ];
  const results: Record<string, boolean> = { opaqueOrigin: location.origin === "null" };
  for (const [name, run] of probes) {
    try {
      await run();
      results[name] = false;
    } catch {
      results[name] = true;
    }
  }
  ctx.hub.items(() => [
    {
      id: "results",
      title: "Isolation probe complete",
      subtitle: JSON.stringify(results),
      actions: [],
    },
  ]);
}
