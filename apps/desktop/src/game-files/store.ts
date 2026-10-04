import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { chunkLength, contentHash, decode, verify } from "./chunks.ts";
import type { Compression } from "./chunks.ts";
import { GameFileError } from "./errors.ts";
import type { ManifestFile } from "./manifest.ts";

export interface ChunkStoreOptions {
  dir: string;
  fetchChunk: (hash: string, expectedLength: number, signal?: AbortSignal) => Promise<Uint8Array>;
  compression?: Compression;
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function createChunkStore({ dir, fetchChunk, compression = "none" }: ChunkStoreOptions) {
  const listeners = new Set<() => void>();
  const hashes = new Set<string>();
  const inflight = new Map<string, { length: number; work: Promise<Uint8Array> }>();
  const ready = mkdir(dir, { recursive: true }).then(async () => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isFile() && /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/.test(entry.name))
        hashes.add(entry.name);
    }
  });
  let active = 0;
  let background = 0;
  const waiting: Array<{ hash: string; background: boolean; start(): void }> = [];
  function drain() {
    while (active < 8) {
      const index = waiting.findIndex((job) => !job.background);
      const next = index >= 0 ? index : background < 2 ? 0 : -1;
      if (next < 0 || !waiting.length) return;
      waiting.splice(next, 1)[0]!.start();
    }
  }
  function schedule(hash: string, length: number, lowPriority: boolean, signal?: AbortSignal) {
    return new Promise<Uint8Array>((resolve, reject) => {
      const job = {
        hash,
        background: lowPriority,
        start() {
          signal?.removeEventListener("abort", cancel);
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          active++;
          const low = job.background;
          if (low) background++;
          void load(hash, length, signal)
            .then(resolve, reject)
            .finally(() => {
              active--;
              if (low) background--;
              drain();
            });
        },
      };
      function cancel() {
        const index = waiting.indexOf(job);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal?.reason);
      }
      signal?.addEventListener("abort", cancel, { once: true });
      waiting.push(job);
      drain();
    });
  }
  async function load(hash: string, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    await ready;
    signal?.throwIfAborted();
    const path = join(dir, hash);
    if (hashes.has(hash))
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
    const bytes = new Uint8Array(
      await decode(await fetchChunk(hash, length, signal), compression, length),
    );
    signal?.throwIfAborted();
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
      for (const listener of listeners) listener();
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
  function read(
    value: string,
    expectedLength: number,
    lowPriority = false,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const hash = contentHash(value);
    chunkLength(expectedLength);
    const pending = inflight.get(hash);
    if (pending) {
      if (pending.length !== expectedLength)
        throw new GameFileError("chunk_length", "One chunk hash has conflicting lengths.");
      if (!lowPriority) {
        // A client read must not remain behind queued background work.
        for (const job of waiting) if (job.hash === hash) job.background = false;
        drain();
      }
      return pending.work.then(
        (bytes) => bytes.slice(),
        (error: unknown) => {
          if (!lowPriority && error instanceof Error && error.name === "AbortError")
            return read(value, expectedLength);
          throw error;
        },
      );
    }
    const work = schedule(hash, expectedLength, lowPriority, signal).finally(() => {
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
  async function residency(file: ManifestFile) {
    await ready;
    const bytes = file.chunkHashes.reduce(
      (sum, hash, index) =>
        sum + (hashes.has(hash) ? Math.min(file.chunkSize, file.size - index * file.chunkSize) : 0),
      0,
    );
    return { bytes, totalBytes: file.size };
  }
  return {
    residency,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async fill(
      file: ManifestFile,
      options: { signal: AbortSignal; onProgress(bytes: number, total: number): void },
    ) {
      const controller = new AbortController();
      const signal = AbortSignal.any([options.signal, controller.signal]);
      await ready;
      const report = async () => {
        const { bytes, totalBytes } = await residency(file);
        options.onProgress(bytes, totalBytes);
      };
      await report();
      let index = 0;
      async function worker() {
        while (index < file.chunkHashes.length) {
          signal.throwIfAborted();
          const current = index++;
          const hash = file.chunkHashes[current]!;
          if (hashes.has(hash)) continue;
          await read(
            hash,
            Math.min(file.chunkSize, file.size - current * file.chunkSize),
            true,
            signal,
          );
          await report();
        }
      }
      const run = () =>
        worker().catch((error: unknown) => {
          controller.abort();
          throw error;
        });
      const results = await Promise.allSettled([run(), run()]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
      await report();
    },
    read,
    readRange,
    async resident(): Promise<ReadonlySet<string>> {
      await ready;
      return new Set(hashes);
    },
  };
}

export type ChunkStore = ReturnType<typeof createChunkStore>;
