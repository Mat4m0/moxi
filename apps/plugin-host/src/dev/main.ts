import type { HubToHost, ToHost } from "@moxi/sdk/host";
import type { DocumentChange, DocumentRef, ResponseOf } from "@moxi/contracts";
import { PluginHost } from "../plugin-host.ts";

const channel = new MessageChannel();
const documents = new Map<string, NonNullable<ResponseOf<"plugin.doc.read">>>();
const listeners = new Set<(change: DocumentChange) => void>();
const key = (ref: DocumentRef) => JSON.stringify(ref);
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
  {
    read: (ref) => Promise.resolve(documents.get(key(ref)) ?? null),
    write: async ({ ref, value, expectedRevision }) => {
      const revision = documents.get(key(ref))?.revision ?? 0;
      if (revision !== expectedRevision) return { ok: false, revision };
      const stored = { value, revision: revision + 1 };
      documents.set(key(ref), stored);
      for (const listener of listeners) listener({ ref, ...stored });
      return { ok: true, revision: stored.revision };
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  },
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
  const source = await (await fetch(entry.script)).text();
  host.register(
    manifest,
    `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`,
    entry.bytes,
  );
}
