import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  confirmHealthy,
  createClientCache,
  parseManifest,
  stageCandidate,
} from "@moxi/desktop/game-files";

export async function seedOfflineClient(dir: string) {
  const generationToken = randomUUID();
  const cache = createClientCache(dir);
  const directory = cache.directory(generationToken);
  const files = [
    { name: "Gw.jspi.js", bytes: Buffer.from("Module.instantiateWasm({}, () => {});") },
    { name: "Gw.jspi.wasm", bytes: Buffer.from([0, 1, 2, 3]) },
    { name: "Gw.snapshot", bytes: Buffer.from([4, 5, 6, 7]) },
    { name: "version.json", bytes: Buffer.from("{}") },
  ];
  const manifest = Buffer.from(
    JSON.stringify({
      compressionMode: "none",
      chunkSize: 128,
      files: files.map(({ name, bytes }) => ({
        name,
        size: bytes.length,
        chunkHashes: [createHash("sha256").update(bytes).digest("hex")],
      })),
    }),
  );
  parseManifest(manifest);
  const state = confirmHealthy(
    stageCandidate({ active: null, candidate: null, previous: null }, generationToken),
    generationToken,
  );
  await mkdir(directory, { recursive: true });
  for (const { name, bytes } of files) await writeFile(join(directory, name), bytes);
  await writeFile(join(directory, "manifest.json"), manifest);
  await writeFile(join(dir, "generations.json"), JSON.stringify(state));
}
