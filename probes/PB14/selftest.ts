// Node-only check of the probe's generation seeding against moxi's real client routes.
// Run: node probes/PB14/selftest.ts
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClientCache } from "../../apps/desktop/src/game-files/index.ts";
import { createClientRoutes } from "../../apps/desktop/src/shell/client.ts";
import { buildGeneration, installActive, preloadChunks, snapshotRanges, stageUpdate } from "./src/gen.ts";

const fixtureDir = resolve(import.meta.dirname, "../../tools/fixture-client");
const noNetwork: typeof fetch = () => Promise.reject(new Error("offline"));
const dir = await mkdtemp(join(tmpdir(), "pb14-selftest-"));
const sha = (bytes: ArrayBuffer) => createHash("sha256").update(Buffer.from(bytes)).digest("hex");
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${detail}`);
}
async function observe(routes: ReturnType<typeof createClientRoutes>) {
  const out: Record<string, string> = {};
  for (const name of ["Gw.jspi.js", "Gw.jspi.wasm"]) {
    const response = await routes.handle(new Request(`moxi://app/client/${name}`));
    out[name] = response ? sha(await response.arrayBuffer()) : "no response";
  }
  for (const range of snapshotRanges) {
    const response = await routes.handle(
      new Request("moxi://app/client/Gw.snapshot", { headers: { Range: `bytes=${range}` } }),
    );
    out[`Gw.snapshot ${range}`] = response
      ? response.status === 206
        ? sha(await response.arrayBuffer())
        : `status ${response.status}`
      : "no response";
  }
  return out;
}
try {
  const a = await buildGeneration(fixtureDir, "A");
  const b = await buildGeneration(fixtureDir, "B");
  check("generations differ", a.expected["Gw.jspi.wasm"] !== b.expected["Gw.jspi.wasm"]);
  await installActive(dir, a);
  await preloadChunks(dir, b);
  const cache = createClientCache(dir, noNetwork);
  const routes1 = createClientRoutes(dir, noNetwork, cache);
  const seen1 = await observe(routes1);
  check("window 1 gets A", JSON.stringify(seen1) === JSON.stringify(a.expected), JSON.stringify(seen1));
  check("A state active", (await cache.state()).active === a.token);
  await stageUpdate(dir, b);
  const state = await cache.state();
  check("B staged as candidate", state.candidate === b.token && state.active === a.token);
  const routes2 = createClientRoutes(dir, noNetwork, cache);
  const seen2 = await observe(routes2);
  check("window 2 gets B", JSON.stringify(seen2) === JSON.stringify(b.expected), JSON.stringify(seen2));
  const again = await observe(routes1);
  check("routes 1 still serve A after the update", JSON.stringify(again) === JSON.stringify(a.expected));
  // The product today: one global `client`, replaced at every game window creation.
  let client = routes1;
  client = routes2;
  const mixed = await observe(client);
  check("shared global makes window 1 read B (generation mixing)", JSON.stringify(mixed) === JSON.stringify(b.expected));
  console.log(JSON.stringify({ A: a.expected, B: b.expected }));
} finally {
  await rm(dir, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
