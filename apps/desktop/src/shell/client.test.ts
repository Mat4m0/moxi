import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createClientCache } from "../game-files/client";
import { createClientRoutes } from "./client";

let dir: string;
afterEach(async () => {
  vi.useRealTimers();
  if (dir) await rm(dir, { recursive: true, force: true });
});
const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";

async function cache() {
  dir = await mkdtemp(join(tmpdir(), "moxi-client-routes-"));
  await mkdir(join(dir, "chunks"));
  for (const [token, text] of [
    [first, "old"],
    [second, "new"],
  ]) {
    const path = join(dir, "generations", token!);
    await mkdir(path, { recursive: true });
    const files = [];
    for (const [name, bytes] of [
      ["Gw.jspi.js", Buffer.from(text!)],
      ["Gw.jspi.wasm", Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])],
      ["version.json", Buffer.from("{}")],
      ["Gw.snapshot", Buffer.from([11, 22, 33, 44, 55])],
    ] as const) {
      const hash = createHash("sha256").update(bytes).digest("hex");
      await writeFile(join(dir, "chunks", hash), bytes);
      await writeFile(join(path, name), bytes);
      files.push({ name, size: bytes.length, chunkHashes: [hash] });
    }
    await writeFile(
      join(path, "manifest.json"),
      JSON.stringify({ compressionMode: "none", chunkSize: 16, files }),
    );
  }
  await writeFile(
    join(dir, "generations.json"),
    JSON.stringify({ active: null, candidate: first, previous: null }),
  );
  return createClientRoutes(dir, async () => {
    throw new Error("Unexpected external request");
  });
}

test("keeps glue, wasm and snapshot in one generation when the active client changes", async () => {
  const routes = await cache();
  expect(await routes.info()).toEqual({ generationToken: first, snapshotSize: 5 });
  await writeFile(
    join(dir, "generations.json"),
    JSON.stringify({ active: second, candidate: null, previous: first }),
  );
  const glue = await routes.handle(new Request("moxi://app/client/Gw.jspi.js"));
  expect(await glue?.text()).toBe("old");
  const wasm = await routes.handle(new Request("moxi://app/client/Gw.jspi.wasm"));
  expect(wasm?.headers.get("Content-Type")).toBe("application/wasm");
  expect(Array.from(new Uint8Array(await wasm!.arrayBuffer()))).toEqual([
    0, 97, 115, 109, 1, 0, 0, 0,
  ]);
  const snapshot = await routes.handle(
    new Request("moxi://app/client/Gw.snapshot", { headers: { Range: "bytes=1-3" } }),
  );
  expect(snapshot?.status).toBe(206);
  expect(snapshot?.headers.get("Content-Range")).toBe("bytes 1-3/5");
  expect(Array.from(new Uint8Array(await snapshot!.arrayBuffer()))).toEqual([22, 33, 44]);
  expect(await createClientRoutes(dir).info()).toEqual({
    generationToken: second,
    snapshotSize: 5,
  });
});

test.each([
  "",
  "bytes=0-5",
  "bytes=3-1",
  "bytes=0-1,3-4",
  "bytes=-1",
  "bytes=9007199254740992-9007199254740993",
])("refuses an invalid snapshot range instead of returning unrelated bytes (%s)", async (range) => {
  const routes = await cache();
  const response = await routes.handle(
    new Request("moxi://app/client/Gw.snapshot", { headers: { Range: range } }),
  );
  expect(response?.status).toBe(416);
  expect(response?.headers.get("Content-Range")).toBe("bytes */5");
});

test("does not expose arbitrary cache files through the client protocol", async () => {
  const routes = await cache();
  for (const path of ["manifest.json", "generations.json", "%2e%2e%2fmanifest.json"]) {
    expect((await routes.handle(new Request(`moxi://app/client/${path}`)))?.status).toBe(404);
  }
});

test("refuses unconnected or foreign health and accepts repeated health without promoting twice", async () => {
  const routes = await cache();
  await routes.info();
  await expect(routes.confirmHealthy(second, true, true)).rejects.toThrow(
    "Stale client generation token.",
  );
  expect(await routes.confirmHealthy(first, false, true)).toBe(false);
  await routes.confirmHealthy(first, true, true);
  await routes.confirmHealthy(first, true, true);
  await createClientRoutes(dir).confirmHealthy(first, true, true);
  expect(JSON.parse(await readFile(join(dir, "generations.json"), "utf8"))).toEqual({
    active: first,
    candidate: null,
    previous: null,
    failed: null,
  });
});

test("serves a downloaded update instead of ignoring it and retains the healthy client on promotion", async () => {
  await cache();
  await writeFile(
    join(dir, "generations.json"),
    JSON.stringify({ active: first, candidate: second, previous: null }),
  );
  const routes = createClientRoutes(dir);
  expect((await routes.info()).generationToken).toBe(second);
  expect(await (await routes.handle(new Request("moxi://app/client/Gw.jspi.js")))?.text()).toBe(
    "new",
  );
  expect(await routes.confirmHealthy(second, true, true)).toBe(true);
  expect(await createClientCache(dir).state()).toEqual({
    active: second,
    candidate: null,
    previous: first,
    failed: null,
  });
});

test("does not promote a connected client before it rendered a frame", async () => {
  const routes = await cache();
  expect(await routes.confirmHealthy(first, true, false)).toBe(false);
  expect(await createClientCache(dir).state()).toEqual({
    active: null,
    candidate: first,
    previous: null,
    failed: null,
  });
  expect(await routes.confirmHealthy(first, true, true)).toBe(true);
  expect(await createClientCache(dir).state()).toEqual({
    active: first,
    candidate: null,
    previous: null,
    failed: null,
  });
});

test("retries a locked confirmation on a later frame without retrying more than once per second", async () => {
  vi.useFakeTimers();
  const routes = await cache();
  await mkdir(join(dir, ".generation-lock"));
  await writeFile(join(dir, ".generation-lock", String(process.pid)), "");
  await expect(routes.confirmHealthy(first, true, true)).rejects.toThrow("busy");
  await rm(join(dir, ".generation-lock"), { recursive: true });
  expect(await routes.confirmHealthy(first, true, true)).toBe(false);
  vi.advanceTimersByTime(1000);
  expect(await routes.confirmHealthy(first, true, true)).toBe(true);
  expect(await createClientCache(dir).state()).toEqual({
    active: first,
    candidate: null,
    previous: null,
    failed: null,
  });
});

test.each([
  ["crash", 0, true, false, true],
  ["boot error", 0, false, true, true],
  ["unconfirmed minute", 60000, false, false, true],
  ["short close", 59999, false, false, false],
] as const)(
  "falls back only after a failed candidate session: %s",
  async (_name, elapsed, crashed, bootError, failed) => {
    vi.useFakeTimers();
    await cache();
    await writeFile(
      join(dir, "generations.json"),
      JSON.stringify({ active: first, candidate: second, previous: null }),
    );
    const routes = createClientRoutes(dir);
    await routes.info();
    if (bootError) routes.reportFailure();
    vi.advanceTimersByTime(elapsed);
    await routes.end(crashed);
    expect(await createClientCache(dir).state()).toEqual(
      failed
        ? { active: first, candidate: null, previous: null, failed: second }
        : { active: first, candidate: second, previous: null, failed: null },
    );
    expect((await createClientRoutes(dir).info()).generationToken).toBe(failed ? first : second);
    expect(await routes.confirmHealthy(second, true, true)).toBe(false);
  },
);

test("does not boot a failed first install again when there is no healthy fallback", async () => {
  const routes = await cache();
  await routes.info();
  routes.reportFailure();
  expect(await routes.end()).toBe(true);
  expect(await createClientCache(dir).state()).toEqual({
    active: null,
    candidate: null,
    previous: null,
    failed: first,
  });
  await expect(createClientRoutes(dir).info()).rejects.toThrow(
    "Download the game client before playing.",
  );
});

test("retains a frame reported before connection and promotes only after Main sees connection", async () => {
  const routes = await cache();
  expect(await routes.confirmHealthy(first, false, true)).toBe(false);
  expect(await routes.confirmHealthy(first, true, false)).toBe(true);
  expect(await createClientCache(dir).state()).toEqual({
    active: first,
    candidate: null,
    previous: null,
    failed: null,
  });
});
