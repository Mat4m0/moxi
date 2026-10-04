import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  confirmHealthy,
  createClientCache,
  createPatchTransport,
  PATCH_ROOT,
  stageCandidate,
} from "./index.ts";
import type { Generations } from "./index.ts";

const dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const third = "00000000-0000-4000-8000-000000000003";

it.each([
  [
    { active: null, candidate: first, previous: null },
    first,
    { active: first, candidate: null, previous: null },
  ],
  [
    { active: first, candidate: second, previous: null },
    second,
    { active: second, candidate: null, previous: first },
  ],
  [
    { active: second, candidate: third, previous: first },
    third,
    { active: third, candidate: null, previous: second },
  ],
] satisfies Array<[Generations, string, Generations]>)(
  "retains the last healthy generation after confirmation (%j)",
  (state, token, expected) => {
    expect(confirmHealthy(state, token)).toEqual(expected);
  },
);

it.each([
  [{ active: first, candidate: second, previous: null }, first],
  [{ active: first, candidate: null, previous: null }, first],
  [{ active: null, candidate: second, previous: null }, third],
] satisfies Array<[Generations, string]>)(
  "rejects stale health proofs instead of promoting another client (%j)",
  (state, token) => {
    expect(() => confirmHealthy(state, token)).toThrow("Stale client generation token.");
  },
);

it("keeps active and previous clients while replacing an unconfirmed candidate", () => {
  expect(
    stageCandidate(
      { active: second, candidate: third, previous: first },
      "00000000-0000-4000-8000-000000000004",
    ),
  ).toEqual({
    active: second,
    candidate: "00000000-0000-4000-8000-000000000004",
    previous: first,
  });
});

it("stops a failing service after four attempts with bounded backoff", async () => {
  vi.useFakeTimers();
  const http = vi.fn<typeof fetch>(async () => new Response("busy", { status: 503 }));
  const started = Date.now();
  const result = createPatchTransport(http)(`${PATCH_ROOT}/manifest.json`, 100);
  const assertion = expect(result).rejects.toThrow("HTTP 503");
  await vi.runAllTimersAsync();
  await assertion;
  expect(http).toHaveBeenCalledTimes(4);
  expect(Date.now() - started).toBe(7000);
});

it.each([
  ["declared overflow", () => new Response("ok", { headers: { "content-length": "4" } })],
  ["streamed overflow", () => new Response("four")],
  [
    "redirect",
    () => new Response(null, { status: 302, headers: { location: "https://example.com" } }),
  ],
  ["missing resource", () => new Response(null, { status: 404 })],
] as const)("refuses %s without retrying or following redirects", async (_label, response) => {
  const http = vi.fn<typeof fetch>(async () => response());
  await expect(createPatchTransport(http)(`${PATCH_ROOT}/manifest.json`, 3)).rejects.toThrow();
  expect(http).toHaveBeenCalledTimes(1);
  expect(http.mock.calls[0]?.[1]?.redirect).toBe("manual");
});

it.each([
  "https://patching.1.arenanetworks.com.evil.test/x",
  "http://patching.1.arenanetworks.com/x",
  "https://user@patching.1.arenanetworks.com/x",
  "https://guildwars.com/x",
])("refuses an unapproved patch destination %s before HTTP", async (url) => {
  const http = vi.fn<typeof fetch>();
  await expect(createPatchTransport(http)(url, 3)).rejects.toThrow("not allowed");
  expect(http).not.toHaveBeenCalled();
});

it("holds total manifest and chunk HTTP concurrency to eight", async () => {
  let release!: () => void;
  let eight!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    eight = resolve;
  });
  let active = 0;
  let peak = 0;
  let calls = 0;
  const http: typeof fetch = async () => {
    active++;
    calls++;
    peak = Math.max(peak, active);
    if (calls === 8) eight();
    await gate;
    active--;
    return new Response("ok");
  };
  const requests = [createPatchTransport(http), createPatchTransport(http)];
  const work = Promise.all(
    Array.from({ length: 20 }, (_, i) => requests[i % 2]!(`${PATCH_ROOT}/${i}.bin`, 2)),
  );
  await started;
  expect(calls).toBe(8);
  release();
  await work;
  expect(calls).toBe(20);
  expect(peak).toBe(8);
});

async function fixture(compression = "none", wrongBytes?: Uint8Array, stable = false) {
  const dir = await mkdtemp(join(tmpdir(), "moxi-client-"));
  dirs.push(dir);
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const manifest = JSON.stringify({
    compressionMode: compression,
    chunkSize: 4,
    files: ["Gw.jspi.js", "Gw.jspi.wasm", "version.json", "Gw.snapshot"].map((name) => ({
      name,
      size: 4,
      chunkHashes: [hash],
    })),
  });
  let build = 0;
  const http: typeof fetch = async (url) =>
    (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).endsWith(
      "manifest.json",
    )
      ? new Response(manifest.slice(0, -1) + `,"build":${stable ? 0 : ++build}}`)
      : new Response(Buffer.from(wrongBytes ?? bytes));
  return { dir, cache: createClientCache(dir, http) };
}

it.each([
  ["hash mismatch", "none", new Uint8Array([4, 3, 2, 1]), "hash_mismatch"],
  ["decompression overflow", "gzip", gzipSync(new Uint8Array(100)), "chunk_decode"],
] as const)(
  "leaves no staged or published generation after %s",
  async (_label, compression, bytes, code) => {
    const { cache, dir } = await fixture(compression, bytes);
    await expect(cache.prepare()).rejects.toMatchObject({ code });
    expect(await readdir(join(dir, "generations"))).toEqual([]);
    expect(await cache.state()).toEqual({ active: null, candidate: null, previous: null });
    expect(await readdir(dir)).not.toContain(".generation-lock");
  },
);

it("keeps one previous directory after activation and rejects a stale session token", async () => {
  const { cache, dir } = await fixture();
  const a = await cache.prepare();
  expect(a.totalBytes).toBe(12);
  expect(a.hashes["Gw.jspi.wasm"]).toBe(
    "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
  );
  expect(await cache.state()).toEqual({
    active: null,
    candidate: a.generationToken,
    previous: null,
  });
  await cache.confirmHealthy(a.generationToken);
  const b = await cache.prepare();
  await expect(cache.confirmHealthy(a.generationToken)).rejects.toThrow("Stale");
  await cache.confirmHealthy(b.generationToken);
  expect(await cache.state()).toEqual({
    active: b.generationToken,
    candidate: null,
    previous: a.generationToken,
  });
  expect(await readFile(join(cache.directory(a.generationToken), "Gw.jspi.js"))).toEqual(
    Buffer.from([1, 2, 3, 4]),
  );
  const c = await cache.prepare();
  await cache.confirmHealthy(c.generationToken);
  expect((await readdir(join(dir, "generations"))).sort()).toEqual(
    [b.generationToken, c.generationToken].sort(),
  );
  const reopened = createClientCache(dir);
  expect(await reopened.state()).toEqual({
    active: c.generationToken,
    candidate: null,
    previous: b.generationToken,
  });
});

it("refuses to confirm a candidate whose official bytes changed on disk", async () => {
  const { cache } = await fixture();
  const candidate = await cache.prepare();
  await writeFile(
    join(cache.directory(candidate.generationToken), "Gw.jspi.wasm"),
    new Uint8Array([4, 3, 2, 1]),
  );
  await expect(cache.confirmHealthy(candidate.generationToken)).rejects.toMatchObject({
    code: "hash_mismatch",
  });
  expect(await cache.state()).toEqual({
    active: null,
    candidate: candidate.generationToken,
    previous: null,
  });
});

it("times out stalled requests and releases the slot after the retry bound", async () => {
  vi.useFakeTimers();
  const started = Date.now();
  const http = vi.fn<typeof fetch>(
    async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
      }),
  );
  const result = createPatchTransport(http)(`${PATCH_ROOT}/manifest.json`, 4);
  const assertion = expect(result).rejects.toThrow("timeout");
  await vi.runAllTimersAsync();
  await assertion;
  expect(http).toHaveBeenCalledTimes(4);
  expect(Date.now() - started).toBe(127000);
});

it("reuses a verified pending candidate so repeated preparation does not invalidate its health token", async () => {
  const { cache, dir } = await fixture("none", undefined, true);
  const first = await cache.prepare();
  const repeated = await cache.prepare();
  expect(repeated).toEqual(first);
  expect(await readdir(join(dir, "generations"))).toEqual([first.generationToken]);
  await cache.confirmHealthy(first.generationToken);
  expect(await cache.prepare()).toEqual(first);
  expect(await cache.state()).toEqual({
    active: first.generationToken,
    candidate: null,
    previous: null,
  });
});

it("recovers a dead writer's lock so a terminated preparation does not block the next launch", async () => {
  const child = spawn(process.execPath, ["-e", ""]);
  const pid = child.pid;
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error("Child failed"))));
  });
  if (!pid) throw new Error("Missing child pid");
  const { cache, dir } = await fixture();
  const lock = join(dir, ".generation-lock");
  await mkdir(lock);
  await writeFile(join(lock, String(pid)), "");
  const candidate = await cache.prepare();
  expect(await cache.state()).toEqual({
    active: null,
    candidate: candidate.generationToken,
    previous: null,
  });
  expect(await readdir(dir)).not.toContain(".generation-lock");
});

it("refuses a competing writer without removing the live writer's lock", async () => {
  const { cache, dir } = await fixture();
  const lock = join(dir, ".generation-lock");
  await mkdir(lock);
  await writeFile(join(lock, String(process.pid)), "");
  await expect(cache.prepare()).rejects.toThrow("Client cache is busy");
  expect(await readdir(lock)).toEqual([String(process.pid)]);
  expect(await cache.state()).toEqual({ active: null, candidate: null, previous: null });
});

it("reports artifact bytes monotonically without counting snapshot bytes", async () => {
  const { cache } = await fixture("none", undefined, true);
  const progress: number[][] = [];
  await cache.prepare((received, total) => progress.push([received, total]));
  expect(progress).toEqual([
    [0, 12],
    [4, 12],
    [8, 12],
    [12, 12],
  ]);
  const verified: number[][] = [];
  await cache.prepare((received, total) => verified.push([received, total]));
  expect(verified).toEqual([
    [0, 12],
    [12, 12],
  ]);
});
