import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { chunkLength, contentHash, decode, verify } from "./chunks.ts";
import type { Compression } from "./chunks.ts";
import { GameFileError } from "./errors.ts";
import type { ManifestFile } from "./manifest.ts";

export interface ChunkStoreOptions {
  dir: string;
  fetchChunk: (hash: string, expectedLength: number) => Promise<Uint8Array>;
  compression?: Compression;
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function createChunkStore({ dir, fetchChunk, compression = "none" }: ChunkStoreOptions) {
  const hashes = new Set<string>();
  const inflight = new Map<string, { length: number; work: Promise<Uint8Array> }>();
  const ready = mkdir(dir, { recursive: true }).then(async () => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isFile() && /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/.test(entry.name))
        hashes.add(entry.name);
    }
  });
  let active = 0;
  const waiting: Array<() => void> = [];
  async function fetch(hash: string, length: number): Promise<Uint8Array> {
    if (active >= 8) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await fetchChunk(hash, length);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }
  async function load(hash: string, length: number): Promise<Uint8Array> {
    await ready;
    const path = join(dir, hash);
    try {
      const handle = await open(path, "r");
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== length)
          throw new GameFileError("chunk_length", "Cached chunk has invalid length.");
        const bytes = new Uint8Array(length);
        let offset = 0;
        while (offset < length) {
          const { bytesRead } = await handle.read(bytes, offset, length - offset, offset);
          if (!bytesRead) throw new GameFileError("chunk_length", "Cached chunk is truncated.");
          offset += bytesRead;
        }
        verify(hash, bytes, length);
        hashes.add(hash);
        return bytes;
      } finally {
        await handle.close();
      }
    } catch (error) {
      hashes.delete(hash);
      if (!missing(error)) {
        if (!(error instanceof GameFileError)) throw error;
        await unlink(path).catch((cause: unknown) => {
          if (!missing(cause)) throw cause;
        });
      }
    }
    const bytes = new Uint8Array(await decode(await fetch(hash, length), compression, length));
    verify(hash, bytes, length);
    const temp = join(dir, `${hash}.${process.pid}.${randomUUID()}.tmp`);
    try {
      const handle = await open(temp, "wx");
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, path);
      hashes.add(hash);
      // Node cannot open directories for syncing on Windows; the file is still synced.
      if (process.platform !== "win32") {
        const directory = await open(dir, "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } finally {
      await unlink(temp).catch((error: unknown) => {
        if (!missing(error)) throw error;
      });
    }
    return bytes;
  }
  function read(value: string, expectedLength: number): Promise<Uint8Array> {
    const hash = contentHash(value);
    chunkLength(expectedLength);
    const pending = inflight.get(hash);
    if (pending) {
      if (pending.length !== expectedLength)
        throw new GameFileError("chunk_length", "One chunk hash has conflicting lengths.");
      return pending.work.then((bytes) => bytes.slice());
    }
    const work = load(hash, expectedLength).finally(() => {
      inflight.delete(hash);
    });
    inflight.set(hash, { length: expectedLength, work });
    return work.then((bytes) => bytes.slice());
  }
  async function readRange(
    file: ManifestFile,
    offset: number,
    length: number,
  ): Promise<Uint8Array> {
    chunkLength(file.chunkSize);
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length <= 0 ||
      offset > file.size - length
    )
      throw new GameFileError("bad_range", "Range is outside the file.");
    const bytes = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      const position = offset + written;
      const index = Math.floor(position / file.chunkSize);
      const hash = file.chunkHashes[index];
      if (!hash) throw new GameFileError("chunk_count", "Missing file chunk.");
      const chunk = await read(hash, Math.min(file.chunkSize, file.size - index * file.chunkSize));
      const start = position % file.chunkSize;
      const take = Math.min(length - written, chunk.length - start);
      bytes.set(chunk.subarray(start, start + take), written);
      written += take;
    }
    return bytes;
  }
  return {
    read,
    readRange,
    async resident(): Promise<ReadonlySet<string>> {
      await ready;
      return new Set(hashes);
    },
  };
}

export type ChunkStore = ReturnType<typeof createChunkStore>;
