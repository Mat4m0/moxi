import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createClientCache, parseManifest } from "../game-files/index.ts";

export function createClientRoutes(
  dir: string,
  fetchResponse: typeof fetch = fetch,
  cache = createClientCache(dir, fetchResponse),
) {
  async function openClient() {
    const state = await cache.state();
    const generationToken = state.candidate ?? state.active;
    if (!generationToken) throw new Error("Download the game client before playing.");
    const directory = cache.directory(generationToken);
    const manifest = parseManifest(await readFile(join(directory, "manifest.json")));
    const snapshot = [...manifest.files.values()].find((file) => file.name === "Gw.snapshot");
    if (!snapshot) throw new Error("The game snapshot is unavailable.");
    const store = cache.chunks(manifest);
    return { directory, generationToken, snapshot, store, started: Date.now() };
  }
  let client: ReturnType<typeof openClient> | undefined;
  const current = () => (client ??= openClient());
  let frameSeen = false;
  let confirmed = false;
  let failed = false;
  let ended = false;
  let lastAttempt = -Infinity;
  let confirmation: Promise<boolean> | undefined;
  return {
    reportFailure() {
      failed = true;
    },
    async end(crashed = false) {
      ended = true;
      failed ||= crashed;
      await confirmation?.catch(() => false);
      if (!client || confirmed) return false;
      const opened = await client;
      if (crashed || failed || Date.now() - opened.started >= 60_000) {
        const state = await cache.failCandidate(opened.generationToken);
        return state.failed === opened.generationToken;
      }
      return false;
    },
    async observe(progress: (bytes: number, total: number) => void) {
      const { store, snapshot } = await current();
      const report = () => {
        void store.residency(snapshot).then(({ bytes, totalBytes }) => progress(bytes, totalBytes));
      };
      const unsubscribe = store.subscribe(report);
      report();
      return unsubscribe;
    },
    async fill(options: { signal: AbortSignal; onProgress(bytes: number, total: number): void }) {
      const { store, snapshot } = await current();
      return store.fill(snapshot, options);
    },
    async confirmHealthy(token: string, connected: boolean, frame: boolean) {
      if (token !== (await current()).generationToken)
        throw new Error("Stale client generation token.");
      if (ended || failed) return false;
      frameSeen ||= frame;
      if (confirmed) return true;
      if (!connected || !frameSeen) return false;
      if (confirmation) return confirmation;
      if (Date.now() - lastAttempt < 1000) return false;
      lastAttempt = Date.now();
      confirmation = cache.confirmHealthy(token).then(() => {
        confirmed = true;
        return true;
      });
      try {
        return await confirmation;
      } finally {
        confirmation = undefined;
      }
    },
    async info() {
      const { generationToken, snapshot } = await current();
      return { generationToken, snapshotSize: snapshot.size };
    },
    async handle(request: Request): Promise<Response | undefined> {
      const url = new URL(request.url);
      if (url.protocol !== "moxi:" || url.host !== "app" || !url.pathname.startsWith("/client/"))
        return;
      if (request.method !== "GET") return new Response("Not found", { status: 404 });
      const name = url.pathname.slice("/client/".length);
      if (name !== "Gw.jspi.js" && name !== "Gw.jspi.wasm" && name !== "Gw.snapshot")
        return new Response("Not found", { status: 404 });
      try {
        const { directory, snapshot, store } = await current();
        if (name !== "Gw.snapshot") {
          const handle = await open(join(directory, name), "r");
          const file = handle.createReadStream();
          return new Response(Readable.toWeb(file), {
            headers: {
              "Content-Type": name.endsWith(".wasm") ? "application/wasm" : "text/javascript",
              "Cache-Control": "no-store",
            },
          });
        }
        const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get("Range") ?? "");
        const start = Number(range?.[1]);
        const end = Number(range?.[2]);
        const length = end - start + 1;
        if (
          !range ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          length <= 0 ||
          end >= snapshot.size ||
          length > 16 * 1024 * 1024
        ) {
          return new Response("Invalid snapshot range", {
            status: 416,
            headers: { "Content-Range": `bytes */${snapshot.size}` },
          });
        }
        const bytes = await store.readRange(snapshot, start, length);
        return new Response(Uint8Array.from(bytes), {
          status: 206,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(length),
            "Content-Range": `bytes ${start}-${end}/${snapshot.size}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
          },
        });
      } catch {
        return new Response("The game files could not be loaded. Run fetch-client and try again.", {
          status: 503,
        });
      }
    },
  };
}
