import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  confirmHealthy,
  createClientCache,
  parseManifest,
  stageCandidate,
} from "@moxi/desktop/game-files";

export async function seedFixtureClient(dir: string) {
  const generationToken = randomUUID();
  const cache = createClientCache(dir);
  const directory = cache.directory(generationToken);
  const files = [
    { name: "Gw.jspi.js", bytes: await readFile(new URL("./glue.js", import.meta.url)) },
    { name: "Gw.jspi.wasm", bytes: await readFile(new URL("./client.wasm", import.meta.url)) },
    { name: "Gw.snapshot", bytes: Buffer.from([4, 5, 6, 7]) },
    { name: "version.json", bytes: Buffer.from("{}") },
  ];
  const manifest = Buffer.from(
    JSON.stringify({
      compressionMode: "none",
      chunkSize: 65536,
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
