import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createChunkStore, GameFileError, parseManifest } from "./index.ts";
import type { ManifestFile } from "./index.ts";

const hash = (bytes: Uint8Array, algorithm = "sha256") =>
  createHash(algorithm).update(bytes).digest("hex");
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const artifactNames = ["Gw.jspi.js", "Gw.jspi.wasm", "version.json", "Gw.snapshot"];
function manifest() {
  return {
    compressionMode: "none",
    chunkSize: 4,
    directories: [{ name: "root" }, { name: "nested" }],
    files: artifactNames.map((name) => ({
      name,
      size: 4,
      chunkHashes: ["a".repeat(64)],
      parentIndex: null as number | null,
    })),
  };
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "moxi-game-files-"));
  dirs.push(dir);
  return dir;
}

describe("manifest refusals", () => {
  it("rejects oversized input before attempting JSON parsing", () => {
    expect(() => parseManifest(new Uint8Array(16777217))).toThrow(
      expect.objectContaining({ code: "manifest_bytes" }),
    );
  });
  it.each([
    ["broken JSON", new TextEncoder().encode("{"), "manifest_format"],
    ["invalid UTF-8", new Uint8Array([255]), "manifest_format"],
    ["array root", encode([]), "manifest_format"],
    ["missing fields", encode({}), "manifest_format"],
    [
      "unsupported compression",
      encode({ ...manifest(), compressionMode: "zip" }),
      "bad_compression",
    ],
    ...[0, -1, 1.5, 16777217].map((chunkSize) => [
      `chunk size ${chunkSize}`,
      encode({ ...manifest(), chunkSize }),
      "bad_chunk_size",
    ]),
    [
      "directory count",
      encode({
        ...manifest(),
        directories: Array.from({ length: 4097 }, (_, i) => ({ name: `dir${i}` })),
      }),
      "manifest_directories",
    ],
    [
      "file count",
      encode({ ...manifest(), files: Array(4097).fill(manifest().files[0]) }),
      "manifest_files",
    ],
    ["non-array directories", encode({ ...manifest(), directories: {} }), "manifest_directories"],
    ["non-array files", encode({ ...manifest(), files: {} }), "manifest_files"],
    ["malformed directory", encode({ ...manifest(), directories: [null] }), "manifest_directories"],
    ["malformed file", encode({ ...manifest(), files: [null] }), "manifest_files"],
    ...[
      "",
      ".",
      "..",
      "__proto__",
      "prototype",
      "constructor",
      "a/b",
      "a\\b",
      "a\0b",
      "x".repeat(256),
    ].map((name) => [
      "unsafe name",
      encode({ ...manifest(), directories: [{ name }] }),
      "manifest_name",
    ]),
    ...[-1, 2, 0.5, "1"].map((parentIndex) => [
      "invalid parent",
      encode({ ...manifest(), directories: [{ name: "root", parentIndex }] }),
      "manifest_parent",
    ]),
    [
      "parent cycle",
      encode({
        ...manifest(),
        directories: [
          { name: "root" },
          { name: "a", parentIndex: 2 },
          { name: "b", parentIndex: 1 },
        ],
      }),
      "manifest_cycle",
    ],
    [
      "duplicate directories",
      encode({ ...manifest(), directories: [{ name: "a" }, { name: "a" }] }),
      "manifest_duplicate",
    ],
    [
      "duplicate files",
      encode({ ...manifest(), files: [...manifest().files, manifest().files[0]] }),
      "manifest_duplicate",
    ],
    [
      "file-directory collision",
      encode({ ...manifest(), directories: [{ name: "Gw.snapshot" }] }),
      "manifest_duplicate",
    ],
    [
      "empty file",
      encode({ ...manifest(), files: [{ ...manifest().files[0], size: 0 }] }),
      "manifest_size",
    ],
    [
      "wrong chunk count",
      encode({ ...manifest(), files: [{ ...manifest().files[0], chunkHashes: [] }] }),
      "chunk_count",
    ],
    [
      "invalid hash",
      encode({ ...manifest(), files: [{ ...manifest().files[0], chunkHashes: ["../bad"] }] }),
      "hash_format",
    ],
    [
      "conflicting hash lengths",
      encode({
        ...manifest(),
        files: [...manifest().files, { name: "extra", size: 3, chunkHashes: ["a".repeat(64)] }],
      }),
      "chunk_length",
    ],
    [
      "missing required artifact",
      encode({ ...manifest(), files: manifest().files.slice(1) }),
      "manifest_required",
    ],
    [
      "duplicate required basename",
      encode({
        ...manifest(),
        files: [...manifest().files, { ...manifest().files[0], parentIndex: 1 }],
      }),
      "manifest_required",
    ],
  ])("rejects %s rather than trusting invalid paths or chunk metadata", (_name, bytes, code) => {
    if (!(bytes instanceof Uint8Array)) throw new Error("Invalid test input");
    expect(() => parseManifest(bytes)).toThrow(expect.objectContaining({ code }));
  });
  it("accepts ArenaNet null and zero root parents and normalizes supported hashes", () => {
    const raw = manifest();
    raw.files[0]!.parentIndex = 0;
    raw.files[1]!.parentIndex = 1;
    raw.files[0]!.chunkHashes = ["A".repeat(32)];
    raw.files[1]!.chunkHashes = ["B".repeat(40)];
    const parsed = parseManifest(encode(raw));
    expect([...parsed.files.keys()]).toEqual([
      "Gw.jspi.js",
      "nested/Gw.jspi.wasm",
      "version.json",
      "Gw.snapshot",
    ]);
    expect(parsed.files.get("Gw.jspi.js")?.chunkHashes).toEqual(["a".repeat(32)]);
    expect(parsed.files.get("nested/Gw.jspi.wasm")?.chunkHashes).toEqual(["b".repeat(40)]);
  });
  it("resolves the maximum-depth valid directory chain without a stack overflow", () => {
    const raw = manifest();
    const directories = Array.from({ length: 4096 }, (_, i) => ({
      name: `d${i}`,
      parentIndex: i > 1 ? i - 1 : null,
    }));
    const parsed = parseManifest(
      encode({
        ...raw,
        directories,
        files: raw.files.map((file) => ({ ...file, parentIndex: 4095 })),
      }),
    );
    expect(parsed.files.size).toBe(4);
    expect([...parsed.files.keys()][0]?.startsWith("d1/d2/d3/")).toBe(true);
  });
});

describe("chunk store", () => {
  it("never publishes corrupt fetched bytes and retries after the rejected read", async () => {
    const dir = await tempDir();
    const bytes = new Uint8Array([1, 2, 3]);
    let calls = 0;
    const store = createChunkStore({
      dir,
      fetchChunk: async () => (++calls === 1 ? new Uint8Array([3, 2, 1]) : bytes),
    });
    await expect(store.read(hash(bytes), 3)).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(await readdir(dir)).toEqual([]);
    expect([...(await store.resident())]).toEqual([]);
    expect(await store.read(hash(bytes), 3)).toEqual(bytes);
    expect(calls).toBe(2);
    expect(await readFile(join(dir, hash(bytes)))).toEqual(Buffer.from([1, 2, 3]));
    expect(await readdir(dir)).toEqual([hash(bytes)]);
  });
  it("coalesces concurrent hash reads while keeping caller byte buffers independent", async () => {
    const dir = await tempDir();
    const bytes = new Uint8Array([1, 2, 3]);
    let calls = 0;
    const store = createChunkStore({
      dir,
      fetchChunk: async () => {
        calls++;
        return bytes;
      },
    });
    const [first, second] = await Promise.all([
      store.read(hash(bytes), 3),
      store.read(hash(bytes), 3),
    ]);
    first[0] = 9;
    expect(second).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toBe(1);
  });
  it("maps a partial range across three chunks without dropping boundary bytes", async () => {
    const dir = await tempDir();
    const chunks = [
      new Uint8Array([0, 1, 2, 3]),
      new Uint8Array([4, 5, 6, 7]),
      new Uint8Array([8, 9]),
    ];
    const file: ManifestFile = {
      name: "data",
      size: 10,
      chunkSize: 4,
      chunkHashes: chunks.map((bytes) => hash(bytes)),
    };
    const store = createChunkStore({
      dir,
      fetchChunk: async (h) => chunks[file.chunkHashes.indexOf(h)]!,
    });
    expect(await store.readRange(file, 2, 7)).toEqual(new Uint8Array([2, 3, 4, 5, 6, 7, 8]));
    for (const [offset, length] of [
      [-1, 1],
      [0, 0],
      [9, 2],
      [0.5, 1],
      [0, Number.MAX_SAFE_INTEGER],
    ]) {
      await expect(store.readRange(file, offset!, length!)).rejects.toMatchObject({
        code: "bad_range",
      });
    }
  });
  it.each([{ values: [9, 9, 9] }, { values: [9] }])(
    "replaces a pre-existing corrupt disk chunk $values",
    async ({ values }) => {
      const dir = await tempDir();
      const bytes = new Uint8Array([1, 2, 3]);
      const h = hash(bytes);
      await writeFile(join(dir, h), new Uint8Array(values));
      let calls = 0;
      const store = createChunkStore({
        dir,
        fetchChunk: async () => {
          calls++;
          return bytes;
        },
      });
      expect([...(await store.resident())]).toEqual([h]);
      expect(await store.read(h, 3)).toEqual(bytes);
      expect(await readFile(join(dir, h))).toEqual(Buffer.from([1, 2, 3]));
      expect(calls).toBe(1);
    },
  );
  it("tracks residency in memory and detects corruption even after an earlier verified read", async () => {
    const dir = await tempDir();
    const bytes = new Uint8Array([1, 2, 3]);
    const h = hash(bytes);
    let calls = 0;
    const store = createChunkStore({
      dir,
      fetchChunk: async () => {
        calls++;
        return bytes;
      },
    });
    await store.read(h, 3);
    await writeFile(join(dir, "b".repeat(64)), bytes);
    expect([...(await store.resident())]).toEqual([h]);
    await writeFile(join(dir, h), new Uint8Array([3, 2, 1]));
    expect(await store.read(h, 3)).toEqual(bytes);
    expect(calls).toBe(2);
  });
  it.each(["md5", "sha1", "sha256"])(
    "verifies %s hashes after gzip decoding",
    async (algorithm) => {
      const dir = await tempDir();
      const bytes = new Uint8Array([1, 2, 3]);
      const store = createChunkStore({
        dir,
        compression: "gzip",
        fetchChunk: async () => gzipSync(bytes),
      });
      expect(await store.read(hash(bytes, algorithm), 3)).toEqual(bytes);
      expect(await readFile(join(dir, hash(bytes, algorithm)))).toEqual(Buffer.from([1, 2, 3]));
    },
  );
  it.each([
    ["gzip expansion", "gzip", gzipSync(new Uint8Array(100)), "chunk_decode"],
    ["encoded overflow", "gzip", new Uint8Array(65540), "chunk_length"],
    ["short decoded data", "none", new Uint8Array([1]), "chunk_length"],
  ] as const)("refuses %s without publishing a chunk", async (_label, compression, data, code) => {
    const dir = await tempDir();
    const store = createChunkStore({ dir, compression, fetchChunk: async () => data });
    await expect(store.read("a".repeat(64), 3)).rejects.toMatchObject({ code });
    expect(await readdir(dir)).toEqual([]);
  });
  it("never exceeds eight concurrent fetches for different hashes", async () => {
    const dir = await tempDir();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const eight = new Promise<void>((resolve) => {
      started = resolve;
    });
    let active = 0;
    let peak = 0;
    let calls = 0;
    const chunks = Array.from({ length: 12 }, (_, i) => new Uint8Array([i]));
    const store = createChunkStore({
      dir,
      fetchChunk: async (h) => {
        active++;
        calls++;
        peak = Math.max(peak, active);
        if (calls === 8) started();
        await gate;
        active--;
        return chunks.find((bytes) => hash(bytes) === h)!;
      },
    });
    const reads = Promise.all(chunks.map((bytes) => store.read(hash(bytes), 1)));
    await eight;
    expect(calls).toBe(8);
    release();
    expect(await reads).toEqual(chunks);
    expect(peak).toBe(8);
    expect(calls).toBe(12);
  });
  it("rejects unsafe hashes and conflicting inflight lengths before fetching", async () => {
    const dir = await tempDir();
    let calls = 0;
    const bytes = new Uint8Array([1, 2, 3]);
    const store = createChunkStore({
      dir,
      fetchChunk: async () => {
        calls++;
        return bytes;
      },
    });
    expect(() => store.read("../file", 3)).toThrow(GameFileError);
    expect(() => store.read(hash(bytes), 0)).toThrow(
      expect.objectContaining({ code: "chunk_length" }),
    );
    const read = store.read(hash(bytes), 3);
    expect(() => store.read(hash(bytes), 2)).toThrow(
      expect.objectContaining({ code: "chunk_length" }),
    );
    await read;
    expect(calls).toBe(1);
  });
});
