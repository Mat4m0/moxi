import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  createClientCache,
  createChunkStore,
  createPatchTransport,
  parseManifest,
  PATCH_ROOT,
} from "../game-files/index.ts";

export function createClientRoutes(dir: string, fetchResponse: typeof fetch = fetch) {
  const cache = createClientCache(dir, fetchResponse);
  async function openClient() {
    const state = await cache.state();
    // The first install has only a candidate; F2 must confirm a connection before promotion.
    const generationToken = state.active ?? state.candidate;
    if (!generationToken) throw new Error("Download the game client before playing.");
    const directory = cache.directory(generationToken);
    const manifest = parseManifest(await readFile(join(directory, "manifest.json")));
    const snapshot = [...manifest.files.values()].find((file) => file.name === "Gw.snapshot");
    if (!snapshot) throw new Error("The game snapshot is unavailable.");
    const request = createPatchTransport(fetchResponse);
    const store = createChunkStore({
      dir: join(dir, "chunks"),
      compression: manifest.compression,
      fetchChunk: (hash, length) =>
        request(`${PATCH_ROOT}/${hash}.bin`, length + Math.max(65536, Math.ceil(length / 16))),
    });
    return { directory, generationToken, snapshot, store };
  }
  let client: ReturnType<typeof openClient> | undefined;
  const current = () => (client ??= openClient());
  return {
    async confirmHealthy(token: string) {
      if (token !== (await current()).generationToken)
        throw new Error("Stale client generation token.");
      await cache.confirmHealthy(token);
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
