import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { createChunkStore } from "./store.ts";
import type { ManifestFile } from "./manifest.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const bytes = [0, 1, 2, 3, 4].map((value) => new Uint8Array([value, value, value, value]));
const hashes = bytes.map((chunk) => createHash("sha256").update(chunk).digest("hex"));
const file: ManifestFile = { name: "Gw.snapshot", size: 20, chunkSize: 4, chunkHashes: hashes };

test("fill skips resident chunks and counts file bytes after a partial download", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moxi-fill-"));
  dirs.push(dir);
  const order: number[] = [];
  const store = createChunkStore({
    dir,
    fetchChunk: async (hash) => {
      const index = hashes.indexOf(hash);
      order.push(index);
      return bytes[index]!;
    },
  });
  await store.readRange(file, 4, 4);
  expect(await store.residency(file)).toEqual({ bytes: 4, totalBytes: 20 });
  await store.fill(file, { signal: new AbortController().signal, onProgress() {} });
  expect(order).toEqual([1, 0, 2, 3, 4]);
  expect(await store.residency(file)).toEqual({ bytes: 20, totalBytes: 20 });
  await store.fill(file, { signal: new AbortController().signal, onProgress() {} });
  expect(order).toEqual([1, 0, 2, 3, 4]);
});

test("client reads start before remaining background chunks and background uses only two slots", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moxi-fill-"));
  dirs.push(dir);
  const order: number[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const both = new Promise<void>((resolve) => {
    started = resolve;
  });
  const store = createChunkStore({
    dir,
    fetchChunk: async (hash) => {
      const index = hashes.indexOf(hash);
      order.push(index);
      if (order.length === 2) started();
      if (index < 2) await gate;
      return bytes[index]!;
    },
  });
  const fill = store.fill(
    { ...file, size: 8, chunkHashes: hashes.slice(0, 2) },
    { signal: new AbortController().signal, onProgress() {} },
  );
  await both;
  expect(order).toEqual([0, 1]);
  const queued = store.fill(
    { ...file, size: 8, chunkHashes: hashes.slice(2, 4) },
    { signal: new AbortController().signal, onProgress() {} },
  );
  expect(await store.readRange(file, 16, 4)).toEqual(new Uint8Array([4, 4, 4, 4]));
  expect(order).toEqual([0, 1, 4]);
  release();
  await Promise.all([fill, queued]);
  expect(order).toEqual([0, 1, 4, 2, 3]);
});

test("pause aborts unfinished chunks without publishing partial files and resume completes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moxi-fill-"));
  dirs.push(dir);
  let started!: () => void;
  const both = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  let pause = true;
  const store = createChunkStore({
    dir,
    fetchChunk: async (hash, _length, signal) => {
      if (pause) {
        calls++;
        if (calls === 2) started();
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      return bytes[hashes.indexOf(hash)]!;
    },
  });
  const controller = new AbortController();
  const fill = store.fill(file, { signal: controller.signal, onProgress() {} });
  const rejected = expect(fill).rejects.toMatchObject({ name: "AbortError" });
  await both;
  controller.abort();
  await rejected;
  expect(await readdir(dir)).toEqual([]);
  expect(await store.residency(file)).toEqual({ bytes: 0, totalBytes: 20 });
  pause = false;
  await store.fill(file, { signal: new AbortController().signal, onProgress() {} });
  expect(await store.residency(file)).toEqual({ bytes: 20, totalBytes: 20 });
  expect(await store.readRange(file, 0, 20)).toEqual(
    new Uint8Array([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]),
  );
});
