import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { GameFileError } from "./errors.ts";
import { verify } from "./chunks.ts";
import { confirmHealthy, parseGenerations, stageCandidate } from "./generations.ts";
import type { Generations } from "./generations.ts";
import { parseManifest } from "./manifest.ts";
import { createChunkStore } from "./store.ts";
import { createPatchTransport, PATCH_ROOT } from "./transport.ts";

const artifacts = ["Gw.jspi.js", "Gw.jspi.wasm", "version.json"] as const;

async function syncDirectory(dir: string) {
  // Windows does not allow Node to open a directory for fsync.
  if (process.platform === "win32") return;
  const handle = await open(dir, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeSynced(path: string, bytes: Uint8Array) {
  const file = await open(path, "wx");
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

export function createClientCache(dir: string, fetchResponse: typeof fetch = fetch) {
  const request = createPatchTransport(fetchResponse);
  const generationsDir = join(dir, "generations");
  const statePath = join(dir, "generations.json");
  async function state(): Promise<Generations> {
    let bytes: string;
    try {
      bytes = await readFile(statePath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return { active: null, candidate: null, previous: null };
      throw error;
    }
    const json: unknown = JSON.parse(bytes);
    return parseGenerations(json);
  }
  async function publish(next: Generations) {
    const temp = join(dir, `${randomUUID()}.tmp`);
    try {
      await writeSynced(temp, Buffer.from(JSON.stringify(next)));
      await rename(temp, statePath);
      await syncDirectory(dir);
    } finally {
      await rm(temp, { force: true });
    }
  }
  async function locked<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(generationsDir, { recursive: true });
    const lock = join(dir, ".generation-lock");
    const attempt = join(dir, `${process.pid}-${randomUUID()}.lock`);
    await mkdir(attempt);
    try {
      await writeSynced(join(attempt, String(process.pid)), new Uint8Array());
      try {
        await rename(attempt, lock);
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            ["EEXIST", "ENOTEMPTY", "EPERM"].includes(String(error.code))
          )
        )
          throw error;
        const owners = await readdir(lock);
        const owner = owners.length === 1 ? owners[0] : undefined;
        if (!owner || !/^[1-9][0-9]*$/.test(owner))
          throw new Error("Client cache is busy. Try again shortly.");
        try {
          process.kill(Number(owner), 0);
          throw new Error("Client cache is busy. Try again shortly.");
        } catch (cause) {
          if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH")) throw cause;
        }
        // Only the writer that unlinks the dead owner's marker can reclaim its lock.
        await unlink(join(lock, owner));
        await rmdir(lock);
        await rename(attempt, lock);
      }
      try {
        return await operation();
      } finally {
        await rename(lock, attempt);
      }
    } finally {
      await rm(attempt, { recursive: true, force: true });
    }
  }
  async function discard(old: Generations, next: Generations) {
    for (const id of [old.active, old.candidate, old.previous]) {
      if (id && ![next.active, next.candidate, next.previous].includes(id))
        await rm(join(generationsDir, id), { recursive: true, force: true });
    }
  }
  async function verifyGeneration(
    generationToken: string,
    manifest: ReturnType<typeof parseManifest>,
  ) {
    const path = join(generationsDir, generationToken);
    const hashes: Record<string, string> = {};
    let totalBytes = 0;
    for (const name of artifacts) {
      const entry = [...manifest.files.values()].find((file) => file.name === name)!;
      const digest = createHash("sha256");
      const file = await open(join(path, name), "r");
      try {
        if ((await file.stat()).size !== entry.size)
          throw new GameFileError("chunk_length", "Client artifact has invalid size.");
        for (const [index, hash] of entry.chunkHashes.entries()) {
          const length = Math.min(entry.chunkSize, entry.size - index * entry.chunkSize);
          const bytes = new Uint8Array(length);
          let offset = 0;
          while (offset < length) {
            const { bytesRead } = await file.read(
              bytes,
              offset,
              length - offset,
              index * entry.chunkSize + offset,
            );
            if (!bytesRead)
              throw new GameFileError("chunk_length", "Client artifact is truncated.");
            offset += bytesRead;
          }
          verify(hash, bytes, length);
          digest.update(bytes);
        }
      } finally {
        await file.close();
      }
      hashes[name] = digest.digest("hex");
      totalBytes += entry.size;
    }
    return { generationToken, hashes, totalBytes };
  }
  return {
    state,
    directory: (generationToken: string) => {
      stageCandidate({ active: null, candidate: null, previous: null }, generationToken);
      return join(generationsDir, generationToken);
    },
    prepare: (progress?: (received: number, total: number) => void) =>
      locked(async () => {
        const manifestBytes = await request(`${PATCH_ROOT}/manifest.json`, 16 * 1024 * 1024);
        const manifest = parseManifest(manifestBytes);
        const total = [...manifest.files.values()]
          .filter((file) => artifacts.some((name) => name === file.name))
          .reduce((sum, file) => sum + file.size, 0);
        let received = 0;
        progress?.(0, total);
        const store = createChunkStore({
          dir: join(dir, "chunks"),
          compression: manifest.compression,
          fetchChunk: (hash, length) =>
            request(
              `${PATCH_ROOT}/${hash}.bin`,
              manifest.compression === "none"
                ? length
                : length + Math.max(65536, Math.ceil(length / 16)),
            ),
        });
        const old = await state();
        const existing = old.candidate ?? old.active;
        if (existing) {
          try {
            const stored = await readFile(join(generationsDir, existing, "manifest.json"));
            if (stored.equals(manifestBytes)) {
              const result = await verifyGeneration(existing, manifest);
              progress?.(total, total);
              return result;
            }
          } catch (error) {
            if (
              !(error instanceof GameFileError) &&
              !(error instanceof Error && "code" in error && error.code === "ENOENT")
            )
              throw error;
          }
        }
        const generationToken = randomUUID();
        const stage = join(generationsDir, `${generationToken}.stage`);
        const destination = join(generationsDir, generationToken);
        await mkdir(stage);
        let keepGeneration = false;
        try {
          const hashes: Record<string, string> = {};
          let totalBytes = 0;
          for (const name of artifacts) {
            const entry = [...manifest.files.values()].find((file) => file.name === name)!;
            const digest = createHash("sha256");
            const file = await open(join(stage, name), "wx");
            try {
              // Fetch a bounded batch so large manifests do not retain every chunk in memory.
              for (let start = 0; start < entry.chunkHashes.length; start += 8) {
                const batch = await Promise.allSettled(
                  entry.chunkHashes
                    .slice(start, start + 8)
                    .map((hash, offset) =>
                      store.read(
                        hash,
                        Math.min(entry.chunkSize, entry.size - (start + offset) * entry.chunkSize),
                      ),
                    ),
                );
                for (const result of batch) {
                  if (result.status === "rejected") throw result.reason;
                  await file.writeFile(result.value);
                  digest.update(result.value);
                  received += result.value.byteLength;
                }
                progress?.(received, total);
              }
              await file.sync();
            } finally {
              await file.close();
            }
            hashes[name] = digest.digest("hex");
            totalBytes += entry.size;
          }
          await writeSynced(join(stage, "manifest.json"), manifestBytes);
          await syncDirectory(stage);
          await rename(stage, destination);
          await syncDirectory(generationsDir);
          const next = stageCandidate(old, generationToken);
          // Once the state rename starts, preserve the synced generation even if fsync fails.
          keepGeneration = true;
          await publish(next);
          await discard(old, next);
          return { generationToken, hashes, totalBytes };
        } finally {
          await rm(stage, { recursive: true, force: true });
          if (!keepGeneration) await rm(destination, { recursive: true, force: true });
        }
      }),
    confirmHealthy: (generationToken: string) =>
      locked(async () => {
        const old = await state();
        if (old.active === generationToken && old.candidate === null) return old;
        const next = confirmHealthy(old, generationToken);
        const manifest = parseManifest(
          await readFile(join(generationsDir, generationToken, "manifest.json")),
        );
        await verifyGeneration(generationToken, manifest);
        await publish(next);
        await discard(old, next);
        return next;
      }),
  };
}
